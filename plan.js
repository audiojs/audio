/**
 * Plan — non-destructive edit pipeline.
 * Intercepts create/run/read/stream to track and materialize edits.
 */

import audio, { readPages, copyPages, walkPages, parseTime, LOAD, READ, emit } from './core.js'

let fn = audio.fn
let ops = {}

// ── Segments: [from, count, to, rate?, ref?, interp?] ────────────
// interp: optional `(src, target, tOff, n, rate, phase) => void` for custom
//   interpolation. May expose `.margin` (samples of context needed each side).
//   Falls back to built-in linear when omitted.
export function seg(from, count, to, rate, ref, interp) {
  let s = [from, count, to]
  if (rate != null && rate !== 1) s[3] = rate
  if (ref !== undefined) s[4] = ref
  if (interp) s[5] = interp
  return s
}

// ── Edit array: ['type', opts] ─────────────────────────────────────
// Normalized shape: compact tuple with options object only.
// e[0] = type, e[1] = opts (named params + range opts + extras)

// ── Range Helpers ────────────────────────────────────────────────

/** Normalize an offset in samples: negative = from-end, clamp to [0, total]. dflt used when offset is null. */
export function planOffset(offset, total, dflt = 0) {
  let s = offset ?? dflt
  if (s < 0) s = total + s
  return Math.min(Math.max(0, s), total)
}

/** Compute [start, end] sample range from a process ctx (at/duration) over a buffer of given len. */
export function opRange(ctx, len) {
  let sr = ctx.sampleRate
  let s = ctx.at != null ? Math.round(ctx.at * sr) : 0
  return [s, ctx.duration != null ? s + Math.round(ctx.duration * sr) : len]
}

// ── Op Registration ─────────────────────────────────────────────

function isOpts(v) {
  return v != null && typeof v === 'object' && !Array.isArray(v) && !ArrayBuffer.isView(v) && !v.pages && !v.getChannelData
}

/** Map positional args to named params on ctx. */
function mapParams(params, args, ctx) {
  if (params) for (let i = 0; i < params.length && i < args.length; i++) ctx[params[i]] = args[i]
}

/** Normalize edit options: parse time fields and sample aliases. */
function normalizeOpts(opts, sr) {
  let o = isOpts(opts) ? { ...opts } : {}
  if (o.at != null) o.at = parseTime(o.at)
  if (o.duration != null) o.duration = parseTime(o.duration)
  if (o.offset != null) { o.at = o.offset / sr; delete o.offset }
  if (o.length != null) { o.duration = o.length / sr; delete o.length }
  return o
}

/** Normalize an edit to compact ['type', opts] storage form. Accepts ['type'] or ['type', opts]. */
function normalizeEdit(edit, sr) {
  if (!Array.isArray(edit) || typeof edit[0] !== 'string') throw new TypeError('audio.run: edit must be [type, opts?]')
  let [type, opts] = edit
  return [type, normalizeOpts(opts || {}, sr)]
}

/** Detect functions deeply so non-serializable edits can be omitted from JSON. */
function hasFunction(v, seen = new Set()) {
  if (typeof v === 'function') return true
  if (!v || typeof v !== 'object') return false
  if (seen.has(v)) return false
  seen.add(v)
  if (Array.isArray(v)) return v.some(x => hasFunction(x, seen))
  for (let k in v) if (hasFunction(v[k], seen)) return true
  return false
}

/** Register/query op: audio.op(name, descriptor|process) */
audio.op = function(name, arg1, arg2, arg3) {
  if (!arguments.length) return ops
  if (arguments.length === 1) return ops[name]

  // Normalize to descriptor object
  let desc
  if (typeof arg1 !== 'function') {
    desc = arg1
  } else {
    let plan, opts
    if (typeof arg2 === 'function') { plan = arg2; opts = arg3 }
    else opts = arg2
    desc = { process: arg1 }
    if (plan) desc.plan = plan
    if (opts) Object.assign(desc, opts)
  }

  if (!fn[name] && !desc.hidden) {
    fn[name] = function(...a) {
      let hasOpts = a.length && isOpts(a.at(-1))
      let o = hasOpts ? { ...a.pop() } : {}
      let d = ops[name]
      if (d?.params) mapParams(d.params, a, o)
      else if (a.length) o.args = a
      return this.run([name, o])
    }
  }
  ops[name] = desc
}


// ── Edit Tracking ───────────────────────────────────────────────

/** Push an edit, bump version, notify. */
export function pushEdit(a, edit) {
  a.edits.push(edit)
  a.version++
  emit(a, 'change')
}

/** Pop an edit, bump version, notify. */
export function popEdit(a) {
  let e = a.edits.pop()
  if (e) { a.version++; emit(a, 'change') }
  return e
}


// ── Virtual Length/Channels ─────────────────────────────────────

Object.defineProperties(fn, {
  sampleRate: { get() {
    if (!this.edits?.length) return this._.sr
    if (this._.srV === this.version) return this._.srC
    let sr = this._.sr
    for (let edit of this.edits) {
      let desc = ops[edit[0]]
      if (desc?.sr) sr = desc.sr(sr, edit[1] || {}) || sr
    }
    this._.srC = sr; this._.srV = this.version
    return sr
  }, set(v) { this._.sr = v }, enumerable: true, configurable: true },
  length: { get() {
    if (this._.lenV === this.version && this._.lenL === this._.len) return this._.lenC
    let len = this.edits.length ? buildPlan(this).totalLen : this._.len
    this._.lenC = len; this._.lenV = this.version; this._.lenL = this._.len
    return len
  }, configurable: true },
  channels: { get() {
    if (this._.chV === this.version) return this._.chC
    let ch = this._.ch
    for (let edit of this.edits) {
      let [type, o = {}] = edit
      let desc = ops[type]
      if (desc?.ch) {
        let { at, duration, channel, ...extra } = o
        ch = desc.ch(ch, extra) || ch
      }
    }
    this._.chC = ch; this._.chV = this.version
    return ch
  }, configurable: true },
})


// ── Read ───────────────────────────────────────────────────────────────

/** Ensure cache pages for the source ranges a plan will access. */
export async function ensurePlan(a, plan, offset, duration) {
  if (!audio.ensurePages) return
  let { segs, sr } = plan
  let s = Math.round((offset || 0) * sr)
  let e = duration != null ? s + Math.round(duration * sr) : plan.totalLen
  for (let sg of segs) {
    let iStart = Math.max(s, sg[2]), iEnd = Math.min(e, sg[2] + sg[1])
    if (iStart >= iEnd) continue
    let rate = sg[3] || 1, absR = Math.abs(rate), n = iEnd - iStart
    let margin = (sg[5] && sg[5].margin) || 0
    let srcStart = rate < 0
      ? sg[0] + (sg[1] - (iStart - sg[2]) - n) * absR
      : sg[0] + (iStart - sg[2]) * absR
    let srcLen = n * absR + 1 + 2 * margin
    let target = sg[4] === null ? null : sg[4] || a
    if (target) await audio.ensurePages(target, Math.max(0, srcStart - margin) / sr, srcLen / sr)
  }
}

async function loadRefs(a) {
  for (let edit of a.edits) { let a0 = edit[1]; if (a0?.pages) await a0[LOAD]() }
}

fn[READ] = async function(offset, duration) {
  if (!this.edits.length) {
    if (audio.ensurePages) await audio.ensurePages(this, offset, duration)
    return readPages(this, offset, duration)
  }
  await this[LOAD]()
  await loadRefs(this)

  let plan = buildPlan(this)
  await ensurePlan(this, plan, offset, duration)
  return readPlan(this, plan, offset, duration)
}


// ── Stream ─────────────────────────────────────────────────────

fn[Symbol.asyncIterator] = fn.stream = async function*(opts) {
  let offset = parseTime(opts?.at), duration = parseTime(opts?.duration)

  if (this._.ready) await this._.ready
  await loadRefs(this)

  let a = this, sr = a.sampleRate, BS = audio.BLOCK_SIZE
  let live = !!a._.waiters && !a.decoded
  if (!live) await a[LOAD]()

  let startSample = offset ? Math.round(offset * sr) : 0
  let endSample = duration != null ? startSample + Math.round(duration * sr) : Infinity
  let builtLen = 0, plan = null, procs = null, outPos = startSample, ensured = false
  let nch = a._.ch
  let bufA = Array.from({ length: nch }, () => new Float32Array(BS))
  let bufB = Array.from({ length: nch }, () => new Float32Array(BS))
  let xfadeRamp = 0, prevPipe = ''  // crossfade state + pipeline signature for change detection

  while (outPos < endSample) {
    let acc = a._.acc
    let avail = a.decoded ? a._.len : acc ? acc.length : a._.len

    if (avail > builtLen || (a.decoded && !ensured)) {
      builtLen = Math.max(builtLen, avail)
      plan = compilePlan(a, builtLen, a.decoded)
      let curPipe = pipelineSig(plan.pipeline)
      if (!procs) {
        procs = initProcs(plan.pipeline, plan.totalLen / sr, sr, nch)
        prevPipe = curPipe
        if (startSample > 0 && procs.length)
          outPos = Math.max(0, startSample - BS * 8)
      } else if (curPipe !== prevPipe) {
        // Structural pipeline change (ops added/removed) — full reinit with crossfade
        procs = initProcs(plan.pipeline, plan.totalLen / sr, sr, nch)
        prevPipe = curPipe
        xfadeRamp = Math.min(2048, Math.round(sr * 0.02))  // ~20ms crossfade to avoid click
      } else if (procs.length) {
        // Same structure, values refined — patch ctx in place (processes ramp internally)
        patchProcs(procs, plan.pipeline)
      }
      if (a.decoded && !ensured) {
        ensured = true
        if (endSample === Infinity) endSample = plan.totalLen
        let td = plan.totalLen / sr
        for (let p of procs) {
          p.ctx.totalDuration = td
          if (p.origAt != null && p.origAt < 0) p.at = td + p.origAt
        }
        await ensurePlan(a, plan, offset, duration)
        let seen = new Set()
        for (let s of plan.segs) if (s[4] && s[4] !== null && !seen.has(s[4])) { seen.add(s[4]); await s[4][LOAD]() }
      }
    }

    if (!plan || outPos >= plan.totalLen) {
      if (a.decoded) break
      await new Promise(r => a._.waiters.push(r))
      continue
    }

    let blockEnd = outPos < startSample ? startSample : Math.min(endSample, plan.totalLen, plan.limit)
    let len = Math.min(BS, blockEnd - outPos)
    if (len <= 0) { if (a.decoded) break; await new Promise(r => a._.waiters.push(r)); continue }

    let needed = maxSrcSample(plan.segs, outPos, outPos + len)
    if (needed > builtLen && !a.decoded) {
      await new Promise(r => a._.waiters.push(r))
      continue
    }

    for (let b of bufA) b.fill(0, 0, len)
    renderBlock(a, plan.segs, outPos, len, bufA)
    let out
    if (xfadeRamp > 0 && procs.length) {
      // Crossfade from dry (pre-proc) to wet (post-proc) to avoid click at pipeline transition
      let dry = bufA.map(b => b.slice(0, len))
      out = applyProcs(bufA, bufB, procs, outPos, sr)
      let n = Math.min(xfadeRamp, len)
      for (let c = 0; c < out.length; c++)
        for (let i = 0; i < n; i++) { let t = (xfadeRamp - n + i + 1) / xfadeRamp; out[c][i] = dry[c][i] * (1 - t) + out[c][i] * t }
      xfadeRamp -= n
    } else {
      out = procs.length ? applyProcs(bufA, bufB, procs, outPos, sr) : bufA
    }

    if (outPos >= startSample) yield out.map(b => b.slice(0, len))
    outPos += len
  }
}


// ── API ────────────────────────────────────────────────────────

fn.undo = function(n = 1) {
  if (!this.edits.length) return n === 1 ? null : []
  let removed = []
  for (let i = 0; i < n && this.edits.length; i++) removed.push(popEdit(this))
  return n === 1 ? removed[0] : removed
}

fn.run = function(...edits) {
  let sr = this.sampleRate
  for (let e of edits) {
    pushEdit(this, normalizeEdit(e, sr))
  }
  return this
}

fn.toJSON = function() {
  let edits = this.edits.filter(e => !hasFunction(e[1]))
  return { source: this.source, edits, sampleRate: this.sampleRate, channels: this.channels, duration: this.duration }
}

fn.clone = function() {
  let b = audio.from(this)
  for (let [type, opts] of this.edits) pushEdit(b, [type, opts ? { ...opts } : {}])
  return b
}


// ── Render Engine ──────────────────────────────────────────────

const MAX_FLAT_SIZE = 2 ** 29

/** Get sample length from any source type. */
export function srcLen(s) {
  return Array.isArray(s) ? s[0].length : s?.getChannelData ? s.length : s._.len
}

/** Render all edits into flat PCM, or read a slice. For ctx.render in PCM ops. */
export function render(a, offset, count) {
  // Raw Float32Array[]
  if (Array.isArray(a) && a[0] instanceof Float32Array) {
    return offset != null ? a.map(ch => ch.subarray(offset, offset + count)) : a
  }
  // AudioBuffer
  if (a?.getChannelData && !a.pages) {
    let chs = Array.from({ length: a.numberOfChannels }, (_, i) => new Float32Array(a.getChannelData(i)))
    return offset != null ? chs.map(ch => ch.subarray(offset, offset + count)) : chs
  }
  if (offset != null) return readRange(a, offset, count)
  if (a._.pcm && a._.pcmV === a.version) return a._.pcm
  if (!a.edits.length) { let r = readPages(a); a._.pcm = r; a._.pcmV = a.version; return r }
  let plan = buildPlan(a)
  let virtualLen = planLen(plan.segs)
  if (virtualLen > MAX_FLAT_SIZE) throw new Error(`Audio too large for flat render (${(virtualLen / 1e6).toFixed(0)}M samples). Use streaming.`)
  let r = readPlan(a, plan)
  a._.pcm = r; a._.pcmV = a.version
  return r
}

function planLen(segs) { let m = 0; for (let s of segs) m = Math.max(m, s[2] + s[1]); return m }

/** How a plan op transforms the safe output boundary during incremental decode. */
function adjustLimit(limit, type, ctx) {
  if (limit <= 0) return 0
  let { offset, length, sampleRate: sr } = ctx
  if (type === 'speed') return Math.round(limit / Math.abs(ctx.rate || 1))
  if (type === 'crop') {
    let at = offset ?? 0, dur = length ?? limit - at
    return Math.max(0, Math.min(dur, limit - at))
  }
  if (type === 'remove') {
    let at = offset ?? 0, dur = length ?? limit - at
    return at < limit ? limit - Math.min(dur, limit - at) : limit
  }
  if (type === 'insert') {
    if (offset != null && offset <= limit) {
      let iLen = typeof ctx.source === 'number' ? Math.round(ctx.source * sr) : (ctx.source?.length ?? 0)
      if (length != null) iLen = Math.min(iLen, length)
      return limit + iLen
    }
    return limit
  }
  if (type === 'repeat') {
    let at = offset ?? 0, dur = length ?? limit - at
    if (at < limit) return limit + dur * (ctx.times ?? 1)
    return limit
  }
  if (type === 'pad') return limit + Math.round((ctx.before ?? 0) * sr)
  if (type === 'reverse') return length == null ? Math.min(limit, offset ?? 0) : limit
  if (type === '_resample_seg') return Math.round(limit * (ctx.rate || sr) / sr)
  return limit
}

/** Build plan ctx for a plan hook or adjustLimit. */
function mkPlanCtx(total, sr, offset, length, extra) {
  return { total, sampleRate: sr, offset, length, ...extra }
}

/** Compile edit list into plan segments + pipeline for a given source length.
 *  final=true when source is fully decoded — all positions are determined. */
function compilePlan(a, len, final) {
  let sr = a._.sr, ch = a._.ch
  let segs = [[0, len, 0]], pipeline = [], limit = len

  for (let edit of a.edits) {
    let [type, o = {}] = edit
    let { at, duration, channel, ...extra } = o
    let op = ops[type]
    if (!op) throw new Error(`Unknown op: ${type}`)

    if (!final && at != null && at < 0) limit = 0

    if (op.resolve) {
      let stats = a.srcStats
      let ctx = { stats, sampleRate: sr, channelCount: ch, channel, at, duration, totalDuration: planLen(segs) / sr, final, ...extra }
      let resolved = op.resolve(ctx)
      if (resolved === false) { if (op.sr) { let ns = op.sr(sr, extra); if (ns) sr = ns }; continue }
      if (resolved) {
        let edits = Array.isArray(resolved) && typeof resolved[0] !== 'string' ? resolved : [resolved]
        for (let re of edits) {
          re = normalizeEdit(re, sr)
          let [rType, rOpts = {}] = re
          let o = { ...rOpts }
          o.at ??= at; o.duration ??= duration; o.channel ??= channel
          re = [rType, o]
          let rOp = ops[rType]
          if (rOp?.plan && typeof rOp.plan === 'function') {
            let { at: rAt, duration: rDur, channel: rCh, ...rExtra } = o
            let t = planLen(segs), rOff = rAt != null ? Math.round(rAt * sr) : null, rLen = rDur != null ? Math.round(rDur * sr) : null
            let rpctx = mkPlanCtx(t, sr, rOff, rLen, rExtra)
            segs = rOp.plan(segs, rpctx)
            if (!final) limit = adjustLimit(limit, rType, rpctx)
          } else {
            pipeline.push(re)
          }
          if (rOp?.sr) { let ns = rOp.sr(sr, o); if (ns) sr = ns }
        }
        if (op.sr) { let ns = op.sr(sr, extra); if (ns) sr = ns }
        continue
      }
    }

    if (op.plan) {
      let t = planLen(segs), offset = at != null ? Math.round(at * sr) : null, length = duration != null ? Math.round(duration * sr) : null
      let pctx = mkPlanCtx(t, sr, offset, length, extra)
      segs = op.plan(segs, pctx)
      if (!final) limit = adjustLimit(limit, type, pctx)
    } else {
      pipeline.push(edit)
    }
    if (op.sr) { let ns = op.sr(sr, extra); if (ns) sr = ns }
  }
  let totalLen = planLen(segs)
  if (final) limit = totalLen
  return { segs, pipeline, totalLen, sr, limit: Math.max(0, limit) }
}

/** Sum ref versions to detect external mutations. */
function refVersion(a) {
  let v = 0
  for (let edit of a.edits) { let r = edit[1]; if (r?.pages && r.version) v += r.version }
  return v
}

/** Build a read plan from edit list. Always succeeds — every op is plannable. */
export function buildPlan(a) {
  let rv = refVersion(a)
  if (a._.plan && a._.planV === a.version && a._.planL === a._.len && a._.planR === rv) return a._.plan
  let plan = compilePlan(a, a._.len, true)
  a._.plan = plan; a._.planV = a.version; a._.planL = a._.len; a._.planR = rv
  return plan
}


// ── Plan Execution ─────────────────────────────────────────────

// Reusable resample buffer — avoids GC pressure during playback at non-unit rates
let _rsBuf = null, _rsLen = 0

/** Read channel samples from pages, resampled by rate. Optional `interp` function plugs in custom interpolation. */
function readSource(a, c, srcOff, n, target, tOff, rate, interp) {
  let r = rate || 1, absR = Math.abs(r)
  if (absR === 1) {
    let base = Math.floor(srcOff)
    if (r > 0) return copyPages(a, c, base, n, target, tOff)
    return walkPages(a, c, base, n, (pg, ch, s, e, off) => {
      for (let i = s; i < e; i++) target[tOff + (n - 1 - (off + i - s))] = pg[ch][i]
    })
  }
  let margin = (interp && interp.margin) || 0
  let base = Math.floor(srcOff), frac = srcOff - base
  let srcN = Math.ceil(frac + n * absR) + 1 + 2 * margin
  if (srcN > _rsLen) { _rsLen = srcN; _rsBuf = new Float32Array(srcN) }
  let buf = _rsBuf.subarray(0, srcN)
  buf.fill(0)
  let bufStart = base - margin
  let copyOff = bufStart < 0 ? -bufStart : 0
  let copyStart = Math.max(0, bufStart)
  let copyLen = srcN - copyOff
  if (copyLen > 0) copyPages(a, c, copyStart, copyLen, buf, copyOff)
  ;(interp || resample)(buf, target, tOff, n, r, margin + frac)
}

/** Linear interpolation resample: src buffer → n output samples at given rate. */
export function resample(src, target, tOff, n, rate, phase = 0) {
  let absR = Math.abs(rate), rev = rate < 0
  for (let i = 0; i < n; i++) {
    let pos = (rev ? n - 1 - i : i) * absR + phase
    let idx = pos | 0, frac = pos - idx
    target[tOff + i] = idx + 1 < src.length
      ? src[idx] + (src[idx + 1] - src[idx]) * frac
      : src[idx] || 0
  }
}

/** Read a sample range from an audio instance (handles edits via plan). */
function readRange(a, srcStart, n) {
  if (!a.edits.length) {
    return Array.from({ length: a._.ch }, (_, c) => {
      let out = new Float32Array(n)
      copyPages(a, c, srcStart, n, out, 0)
      return out
    })
  }
  let plan = buildPlan(a), sr = plan.sr
  return readPlan(a, plan, srcStart / sr, n / sr)
}

/** Render one output block from plan segments into pre-allocated chunk. */
function renderBlock(a, segs, outOff, len, chunk) {
  for (let sg of segs) {
    let iStart = Math.max(outOff, sg[2]), iEnd = Math.min(outOff + len, sg[2] + sg[1])
    if (iStart >= iEnd) continue
    let rate = sg[3] || 1, ref = sg[4], interp = sg[5], absR = Math.abs(rate)
    let n = iEnd - iStart, dstOff = iStart - outOff
    let srcStart = rate < 0
      ? sg[0] + (sg[1] - (iStart - sg[2]) - n) * absR
      : sg[0] + (iStart - sg[2]) * absR
    if (ref === null) {
      // zero-filled by default
    } else if (ref) {
      if (ref.edits.length === 0) {
        for (let c = 0; c < a._.ch; c++)
          readSource(ref, c % ref._.ch, srcStart, n, chunk[c], dstOff, rate, interp)
      } else {
        let margin = (interp && interp.margin) || 0
        let base = Math.floor(srcStart), frac = srcStart - base
        let srcN = Math.ceil(frac + n * absR) + 1 + 2 * margin
        let bufStart = base - margin
        let copyOff = bufStart < 0 ? -bufStart : 0
        let copyStart = Math.max(0, bufStart)
        let srcPcm = readRange(ref, copyStart, srcN - copyOff)
        for (let c = 0; c < a._.ch; c++) {
          let src = srcPcm[c % srcPcm.length]
          if (copyOff || src.length < srcN) {
            let buf = new Float32Array(srcN)
            buf.set(src.subarray(0, srcN - copyOff), copyOff)
            src = buf
          }
          if (absR === 1) {
            if (rate < 0) { for (let i = 0; i < n; i++) chunk[c][dstOff + i] = src[n - 1 - i] }
            else chunk[c].set(src.subarray(0, n), dstOff)
          } else (interp || resample)(src, chunk[c], dstOff, n, rate, margin + frac)
        }
      }
    } else {
      for (let c = 0; c < a._.ch; c++) readSource(a, c, srcStart, n, chunk[c], dstOff, rate, interp)
    }
  }
}

/** Apply process pipeline to a block, rotating between two pre-allocated buffers. */
function applyProcs(bufA, bufB, procs, outOff, sr) {
  let blockOff = outOff / sr
  let cur = bufA, next = bufB
  for (let proc of procs) {
    let { op, at, channel, ctx, outCh } = proc
    if (!op) continue
    ctx.at = at != null ? at - blockOff : undefined
    ctx.blockOffset = blockOff
    if (channel != null) {
      let chs = typeof channel === 'number' ? [channel] : channel
      // Copy non-scoped channels from cur→next
      for (let c = 0; c < cur.length; c++) if (!chs.includes(c)) next[c].set(cur[c])
      let sub_in = chs.map(c => cur[c])
      let sub_out = chs.map(c => next[c])
      op(sub_in, sub_out, ctx)
    } else {
      if (outCh) next = Array.from({ length: outCh }, () => new Float32Array(cur[0].length))
      op(cur, next, ctx)
    }
    let tmp = cur; cur = next; next = tmp
  }
  return cur
}

/** Structural signature — op types only. Value changes patched in place. */
function pipelineSig(pipeline) {
  return pipeline.map(ed => ed[0]).join('|')
}

/** Patch proc contexts with updated parameter values (no reinit). */
function patchProcs(procs, pipeline) {
  for (let i = 0; i < procs.length && i < pipeline.length; i++) {
    let o = pipeline[i][1] || {}
    let { at, duration, channel, ...extra } = o
    Object.assign(procs[i].ctx, extra)
  }
}

/** Initialize process pipeline contexts from plan. */
function initProcs(pipeline, totalDur, sr, nch) {
  let curCh = nch
  return pipeline.map(ed => {
    let desc = ops[ed[0]]
    let o = ed[1] || {}
    let { at, duration: dur, channel, ...extra } = o
    let ctx = { duration: dur, sampleRate: sr, totalDuration: totalDur, render, ...extra }
    let outCh = desc.ch ? desc.ch(curCh, ctx) : 0
    if (outCh) curCh = outCh
    return {
      op: desc.process,
      desc,
      origAt: at,
      at: at != null && at < 0 ? totalDur + at : at,
      dur,
      channel,
      outCh,
      ctx
    }
  })
}

/** Maximum source sample needed by self-referencing segments for output range [start, end). */
function maxSrcSample(segs, start, end) {
  let max = 0
  for (let sg of segs) {
    let iStart = Math.max(start, sg[2]), iEnd = Math.min(end, sg[2] + sg[1])
    if (iStart >= iEnd) continue
    if (sg[4] === null || sg[4]) continue  // silence or external ref
    let rate = sg[3] || 1, absR = Math.abs(rate), margin = (sg[5] && sg[5].margin) || 0
    let n = iEnd - iStart
    let srcStart = rate < 0
      ? sg[0] + (sg[1] - (iStart - sg[2]) - n) * absR
      : sg[0] + (iStart - sg[2]) * absR
    max = Math.max(max, Math.ceil(srcStart + n * absR) + 1 + margin)
  }
  return max
}

/** Stream chunks from a read plan. */
export function* streamPlan(a, plan, offset, duration) {
  let { segs, pipeline, totalLen, sr } = plan
  let s = Math.round((offset || 0) * sr), e = duration != null ? s + Math.round(duration * sr) : totalLen
  let procs = initProcs(pipeline, totalLen / sr, sr, a._.ch)

  let WARMUP = 8
  let ws = (s > 0 && procs.length) ? Math.max(0, s - audio.BLOCK_SIZE * WARMUP) : s
  let BS = audio.BLOCK_SIZE, nch = a._.ch
  let bufA = Array.from({ length: nch }, () => new Float32Array(BS))
  let bufB = Array.from({ length: nch }, () => new Float32Array(BS))

  for (let outOff = ws; outOff < e; outOff += BS) {
    let blockEnd = outOff < s ? s : e
    let len = Math.min(BS, blockEnd - outOff)
    for (let b of bufA) b.fill(0, 0, len)
    renderBlock(a, segs, outOff, len, bufA)
    let out = procs.length ? applyProcs(bufA, bufB, procs, outOff, sr) : bufA
    if (outOff >= s) yield out.map(b => b.subarray(0, len))
  }
}

function readPlan(a, plan, offset, duration) {
  let { sr } = plan, out = null, nch = 0, pos = 0
  for (let chunk of streamPlan(a, plan, offset, duration)) {
    if (!out) {
      nch = chunk.length
      let s = Math.round((offset || 0) * sr), e = duration != null ? s + Math.round(duration * sr) : plan.totalLen
      out = Array.from({ length: nch }, () => new Float32Array(e - s))
    }
    let n = chunk[0].length
    for (let c = 0; c < nch; c++) out[c].set(chunk[c], pos)
    pos += n
  }
  if (!out) return Array.from({ length: a.channels }, () => new Float32Array(0))
  return pos < out[0].length ? out.map(ch => ch.subarray(0, pos)) : out
}
