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

/** Source start sample for the sub-range [iStart, iStart+n) of segment sg (output coords).
 *  Reversed segments (rate < 0) read tail-first, so the sub-range anchors at the far end. */
export function segSrcStart(sg, iStart, n) {
  let rate = sg[3] || 1, absR = Math.abs(rate)
  return rate < 0
    ? sg[0] + (sg[1] - (iStart - sg[2]) - n) * absR
    : sg[0] + (iStart - sg[2]) * absR
}

/** Slice segments to the output range [off, off+len), rebased to 0. Rate-sign correct. */
export function sliceSegs(segs, off, len) {
  let r = [], end = off + len
  for (let s of segs) {
    let a = Math.max(s[2], off), b = Math.min(s[2] + s[1], end)
    if (a < b) r.push(seg(segSrcStart(s, a, b - a), b - a, a - off, s[3], s[4], s[5]))
  }
  return r
}

/** Rewrite the [at, at+len) output range of segs through fn(subSegs), shifting the tail. */
export function spliceSegs(segs, at, len, fn) {
  let total = planLen(segs)
  at = Math.max(0, Math.min(at, total))
  len = Math.max(0, Math.min(len ?? total - at, total - at))
  if (!len) return segs
  let mid = fn(sliceSegs(segs, at, len))
  let midLen = planLen(mid)
  let r = sliceSegs(segs, 0, at)
  for (let s of mid) { let n = s.slice(); n[2] += at; r.push(n) }
  for (let s of sliceSegs(segs, at + len, total - at - len)) { let n = s.slice(); n[2] += at + midLen; r.push(n) }
  return r
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
  // a breakpoint curve {t, v} is a positional param value, not an options bag
  return v != null && typeof v === 'object' && !Array.isArray(v) && !ArrayBuffer.isView(v) && !v.pages && !v.getChannelData && !isCurve(v)
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

/** Detect functions deeply so non-serializable edits can be omitted from JSON.
 *  Own keys only; audio-instance refs serialize via their own toJSON, typed arrays as data. */
function hasFunction(v, seen = new Set()) {
  if (typeof v === 'function') return true
  if (!v || typeof v !== 'object') return false
  if (v.pages || ArrayBuffer.isView(v)) return false
  if (seen.has(v)) return false
  seen.add(v)
  if (Array.isArray(v)) return v.some(x => hasFunction(x, seen))
  for (let k of Object.keys(v)) if (hasFunction(v[k], seen)) return true
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
      for (let k in o) if (typeof o[k] === 'number' && Number.isNaN(o[k])) throw new RangeError(`${name}: ${k} is NaN`)
      if (d?.ch && (o.at != null || o.duration != null)) throw new TypeError(`${name}: range options not supported for channel-changing ops`)
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

/** Effective output format after all edits — the single home for folding the
 *  edit list through op `.sr`/`.ch` hooks (lightweight: no segments, no resolve). */
function deriveFormat(a) {
  if (a._.fmtV === a.version) return a._.fmt
  let sr = a._.sr, ch = a._.ch
  for (let [type, o = {}] of a.edits) {
    let desc = ops[type]
    if (!desc) continue
    if (desc.sr) sr = desc.sr(sr, o) || sr
    if (desc.ch) { let { at, duration, channel, ...extra } = o; ch = desc.ch(ch, extra) || ch }
  }
  a._.fmt = { sr, ch }; a._.fmtV = a.version
  return a._.fmt
}

Object.defineProperties(fn, {
  sampleRate: {
    get() { return this.edits?.length ? deriveFormat(this).sr : this._.sr },
    set(v) { this._.sr = v; this._.fmtV = -1 },
    enumerable: true, configurable: true
  },
  length: { get() {
    if (this._.lenV === this.version && this._.lenL === this._.len) return this._.lenC
    let len = this.edits.length ? buildPlan(this).totalLen : this._.len
    this._.lenC = len; this._.lenV = this.version; this._.lenL = this._.len
    return len
  }, configurable: true },
  channels: {
    get() { return this.edits?.length ? deriveFormat(this).ch : this._.ch },
    configurable: true
  },
})


// ── Read ───────────────────────────────────────────────────────────────

/** Ensure cache pages for the source ranges a plan will access. */
export async function ensurePlan(a, plan, offset, duration) {
  if (!audio.ensurePages) return
  let { segs, sr } = plan
  let s = Math.round((offset || 0) * sr)
  let e = duration != null ? s + Math.round(duration * sr) : plan.totalLen
  e = Math.min(e + (plan.latency || 0), plan.totalLen)  // latency cursors read ahead
  // Prime ctx.render pull sources (mix/crossfade) — seconds are rate-invariant,
  // so the overlap maps directly to the ref's own timebase
  if (plan.pulls) for (let p of plan.pulls) {
    let S = s / sr, E = e / sr
    let o1 = Math.max(S, p.at), o2 = Math.min(E, p.at + p.ref.duration)
    if (o2 > o1) await audio.ensurePages(p.ref, o1 - p.at, o2 - o1)
  }
  for (let sg of segs) {
    let iStart = Math.max(s, sg[2]), iEnd = Math.min(e, sg[2] + sg[1])
    if (iStart >= iEnd) continue
    let rate = sg[3] || 1, absR = Math.abs(rate), n = iEnd - iStart
    let margin = (sg[5] && sg[5].margin) || 0
    let srcStart = segSrcStart(sg, iStart, n)
    let srcLen = n * absR + 1 + 2 * margin
    let target = sg[4] === null ? null : sg[4] || a
    if (target) await audio.ensurePages(target, Math.max(0, srcStart - margin) / sr, srcLen / sr)
  }
}

/** Visit every audio instance referenced by edit opts (insert/mix/crossfade sources). */
function eachRef(a, cb) {
  for (let edit of a.edits) {
    let o = edit[1]
    if (!o) continue
    for (let k in o) if (o[k]?.pages) cb(o[k])
  }
}

/** Await full decode of every referenced source — a ref's length/PCM must be
 *  settled before its plan segment or ctx.render pull reads from it. */
export async function loadRefs(a) {
  let refs = []
  eachRef(a, r => refs.push(r))
  for (let r of refs) { if (r.ready) await r.ready; await r[LOAD]() }
}

fn[READ] = async function(offset, duration) {
  if (!this.edits.length) {
    if (audio.ensurePages) await audio.ensurePages(this, offset, duration)
    return readPages(this, offset, duration)
  }
  await this[LOAD]()
  await loadRefs(this)

  let plan = buildPlan(this)
  let s = Math.round((offset || 0) * plan.sr)
  let e = duration != null ? s + Math.round(duration * plan.sr) : plan.totalLen
  if (e - s > MAX_FLAT_SIZE) throw new Error(`Audio too large for flat read (${((e - s) / 1e6).toFixed(0)}M samples). Use streaming.`)
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
  let durExplicit = duration != null
  let builtLen = 0, plan = null, procs = null, outPos = startSample, ensured = false
  let lastVer = a.version
  let T = 0  // pipeline latency — outPos runs in cursor space, T ahead of the timeline
  let nch = a._.ch
  let bufA = Array.from({ length: nch }, () => new Float32Array(BS))
  let xfadeRamp = 0, prevPipe = ''  // crossfade state + pipeline signature for change detection

  while (outPos < endSample + T) {
    let acc = a._.acc
    let avail = a.decoded ? a._.len : acc ? acc.length : a._.len

    // Rebuild the plan when new source data arrives, on the one-time post-decode pass,
    // or when edits were pushed mid-stream (live parameter/op changes during playback)
    if (avail > builtLen || (a.decoded && !ensured) || a.version !== lastVer) {
      let verChanged = plan != null && a.version !== lastVer
      lastVer = a.version
      builtLen = Math.max(builtLen, avail)
      plan = compilePlan(a, builtLen, a.decoded)
      // Whole-op ref may rewrite the pipeline input width (e.g. 2→5.1 upmix)
      if ((plan.ch ?? nch) !== nch) {
        nch = plan.ch
        bufA = Array.from({ length: nch }, () => new Float32Array(BS))
        procs = null
      }
      let curPipe = pipelineSig(plan.pipeline)
      if (!procs) {
        T = plan.latency
        procs = initProcs(plan.pipeline, plan.totalLen / sr, sr, nch)
        prevPipe = curPipe
        if ((startSample > 0 || T > 0) && procs.length)
          outPos = Math.max(0, startSample + T - BS * WARMUP)
      } else if (plan.latency !== T) {
        // Mid-stream latency change — keep content continuity: cursor c ↦ c + ΔT
        outPos += plan.latency - T; T = plan.latency
      }
      if (procs && curPipe !== prevPipe) {
        // Structural pipeline change (ops added/removed) — full reinit with crossfade
        procs = initProcs(plan.pipeline, plan.totalLen / sr, sr, nch)
        prevPipe = curPipe
        xfadeRamp = Math.min(2048, Math.round(sr * 0.02))  // ~20ms crossfade to avoid click
      } else if (procs.length) {
        // Same structure, values refined — patch ctx in place (ramped in applyProcs)
        patchProcs(procs, plan.pipeline)
      }
      if (a.decoded && (!ensured || verChanged)) {
        ensured = true
        if (endSample === Infinity || (verChanged && !durExplicit)) endSample = plan.totalLen
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

    if (!plan || outPos >= plan.totalLen + T) {
      if (a.decoded) break
      await new Promise(r => a._.waiters.push(r))
      continue
    }

    // Cursor bounds: pre-decode the limit gates determinism; post-decode cursors may
    // run T past totalLen to flush lookahead delay lines (renders as silence)
    let bound = a.decoded ? plan.totalLen + T : Math.min(plan.limit, plan.totalLen)
    let blockEnd = outPos < startSample + T ? startSample + T : Math.min(endSample + T, bound)
    let len = Math.min(BS, blockEnd - outPos)
    if (len <= 0) { if (a.decoded) break; await new Promise(r => a._.waiters.push(r)); continue }

    let needed = maxSrcSample(plan.segs, outPos, outPos + len)
    if (needed > builtLen && !a.decoded) {
      await new Promise(r => a._.waiters.push(r))
      continue
    }

    for (let b of bufA) b.fill(0, 0, len)
    renderBlock(a, plan.segs, outPos, len, bufA)
    let src = len < BS ? bufA.map(b => b.subarray(0, len)) : bufA
    let out
    if (xfadeRamp > 0 && procs.length) {
      // Crossfade from dry (pre-proc) to wet (post-proc) to avoid click at pipeline transition
      let dry = bufA.map(b => b.slice(0, len))
      out = applyProcs(src, procs, outPos, sr)
      let n = Math.min(xfadeRamp, len), nc = Math.min(dry.length, out.length)
      for (let c = 0; c < nc; c++)
        for (let i = 0; i < n; i++) { let t = (xfadeRamp - n + i + 1) / xfadeRamp; out[c][i] = dry[c][i] * (1 - t) + out[c][i] * t }
      xfadeRamp -= n
    } else {
      out = procs.length ? applyProcs(src, procs, outPos, sr) : src
    }

    if (outPos >= startSample + T) yield out.map(b => b.slice(0, len))
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
// Blocks rendered before a seek point to warm up stateful ops (filters, vocoders)
const WARMUP = 8

/** Get sample length from any source type. */
export function srcLen(s) {
  return Array.isArray(s) ? s[0].length : s?.getChannelData ? s.length : s._.len
}

/** Source length expressed in target-rate samples. */
export function refLen(source, sr) {
  let len = Array.isArray(source) ? source[0].length : source.length
  let ssr = source?.sampleRate
  return ssr && ssr !== sr ? Math.round(len * sr / ssr) : len
}

/** Render n target-rate samples at srcOff (target coords) from a source,
 *  resampling when the source's sample rate differs. */
audio.renderAt = renderAt  // sidechain bus reads in core's useAtom (no core→plan import)

export function renderAt(render, source, srcOff, n, sr) {
  let ssr = source?.sampleRate
  let ratio = ssr && ssr !== sr ? ssr / sr : 1
  if (ratio === 1) return render(source, srcOff, n)
  let src = render(source, Math.floor(srcOff * ratio), Math.ceil(n * ratio) + 1)
  return src.map(ch => { let o = new Float32Array(n); resample(ch, o, 0, n, ratio, srcOff * ratio % 1); return o })
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
      let s = ctx.source
      let iLen = typeof s === 'number' ? Math.round(s * sr)
        : s?.sampleRate && s.sampleRate !== sr ? Math.round((s.length ?? 0) * sr / s.sampleRate)
        : (s?.length ?? 0)
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
  if (type === '_stretch_seg') return Math.round(limit * (ctx.factor || 1))
  return limit
}

/** Build plan ctx for a plan hook or adjustLimit. */
function mkPlanCtx(total, sr, offset, length, extra) {
  return { total, sampleRate: sr, offset, length, ...extra }
}

/** Declared latency of a pipeline op in samples — number, or fn(opts, sr) for
 *  param-dependent lookahead. The render loop runs cursors this far ahead of the
 *  requested timeline so delayed output lands aligned (plugin delay compensation). */
function procLatency(desc, o, sr) {
  let l = desc?.latency
  return (typeof l === 'function' ? Math.round(l(o || {}, sr)) : l) || 0
}

/** Stats a resolve-stage op sees: source stats remapped through the structural segs
 *  + pipeline accumulated so far, so trim/normalize measure output space, not source
 *  space. Algebraic remap when possible; full synchronous stat pass at final when not;
 *  null during streaming when infeasible (op defers until final). */
function resolveCtxStats(a, segs, pipeline, sr, final) {
  let src = a.srcStats
  if (!src) return src
  if (!pipeline.length && segs.length === 1 && segs[0][0] === 0 && segs[0][2] === 0 && !segs[0][3] && segs[0][4] === undefined) return src
  let plan = { segs, pipeline, totalLen: planLen(segs), sr }
  let adapted = audio.adaptStats?.(src, plan, sr)
  if (adapted) return adapted
  if (!final || !audio.statSession) return null
  let key = a.version + ':' + plan.totalLen + ':' + segs.length + ':' + pipeline.length
  if (a._.rsc?.key === key) return a._.rsc.stats
  let s = audio.statSession(sr)
  for (let chunk of streamPlan(a, plan)) s.page(chunk)
  let stats = s.done()
  a._.rsc = { key, stats }
  return stats
}

/** Compile edit list into plan segments + pipeline for a given source length.
 *  final=true when source is fully decoded — all positions are determined. */
function compilePlan(a, len, final) {
  let sr = a._.sr, ch = a._.ch
  let segs = [[0, len, 0]], pipeline = [], limit = len, pulls = [], latency = 0

  // Pipeline push that also registers ctx.render pull sources (mix/crossfade)
  // so ensurePlan can prime their pages alongside segment refs.
  let pushProc = ed => {
    pipeline.push(ed)
    latency += procLatency(ops[ed[0]], ed[1], sr)
    let o = ed[1]
    if (o) for (let k in o) if (o[k]?.pages) pulls.push({ ref: o[k], at: o.at ?? 0 })
  }

  // Apply edits emitted by an expand/resolve hook: structural → segment rewrite,
  // otherwise pipeline. Inherits the parent edit's range unless overridden.
  let applyEmitted = (emitted, at, duration, channel) => {
    let edits = Array.isArray(emitted) && typeof emitted[0] !== 'string' ? emitted : [emitted]
    for (let re of edits) {
      re = normalizeEdit(re, sr)
      let [rType, rOpts = {}] = re
      let o = { ...rOpts }
      o.at ??= at; o.duration ??= duration; o.channel ??= channel
      re = [rType, o]
      let rOp = ops[rType]
      if (rOp?.whole) throw new Error(`audio: whole-render op '${rType}' cannot be emitted by expand/resolve`)
      if (rOp?.plan && typeof rOp.plan === 'function') {
        let { at: rAt, duration: rDur, channel: rCh, ...rExtra } = o
        let t = planLen(segs), rOff = rAt != null ? Math.round(rAt * sr) : null, rLen = rDur != null ? Math.round(rDur * sr) : null
        let rpctx = mkPlanCtx(t, sr, rOff, rLen, rExtra)
        segs = rOp.plan(segs, rpctx)
        if (!final) limit = adjustLimit(limit, rType, rpctx)
      } else {
        pushProc(re)
      }
      if (rOp?.sr) { let ns = rOp.sr(sr, o); if (ns) sr = ns }
    }
  }

  for (let edit of a.edits) {
    let [type, o = {}] = edit
    let { at, duration, channel, ...extra } = o
    let op = ops[type]
    if (!op) throw new Error(`Unknown op: ${type}`)

    if (!final && at != null && at < 0) limit = 0

    // Macro expansion — pure rewrite into simpler edits, never needs stats
    if (op.expand) {
      let ctx = { sampleRate: sr, channelCount: ch, channel, at, duration, totalDuration: planLen(segs) / sr, final, ...extra }
      let expanded = op.expand(ctx)
      if (expanded !== null && expanded !== undefined) {
        if (expanded !== false) applyEmitted(expanded, at, duration, channel)
        if (op.sr) { let ns = op.sr(sr, extra); if (ns) sr = ns }
        continue
      }
    }

    // Stat-conditioned resolve — decides from (remapped) stats, may defer until final
    if (op.resolve) {
      let stats = resolveCtxStats(a, segs, pipeline, sr, final)
      let ctx = { stats, sampleRate: sr, channelCount: ch, channel, at, duration, totalDuration: planLen(segs) / sr, final, ...extra }
      let resolved = op.resolve(ctx)
      if (resolved === false) { if (op.sr) { let ns = op.sr(sr, extra); if (ns) sr = ns }; continue }
      if (resolved) {
        applyEmitted(resolved, at, duration, channel)
        if (op.sr) { let ns = op.sr(sr, extra); if (ns) sr = ns }
        continue
      }
    }

    // Whole-render op (streaming: false modules) — needs the entire signal in one call.
    // At final: materialize the plan so far, process once, continue from the result as
    // a ref segment. During decode the output is indeterminate — limit stays 0.
    if (op.whole) {
      if (!final) { limit = 0; continue }
      let t = planLen(segs)
      if (t > MAX_FLAT_SIZE) throw new Error(`Audio too large for whole-render op '${type}' (${(t / 1e6).toFixed(0)}M samples)`)
      if (a._.wrc?.v !== a.version) a._.wrc = { v: a.version, m: new Map() }
      let key = a.edits.indexOf(edit) + ':' + a._.len + ':' + t
      let ref = a._.wrc.m.get(key)
      if (!ref) {
        let input = readPlan(a, { segs, pipeline, totalLen: t, sr, ch, latency, pulls })
        // channel-changing whole op (e.g. 2→5.1 upmix) — output owns its declared width
        let outCh = (op.ch && op.ch(input.length, extra)) || input.length
        let output = Array.from({ length: outCh }, () => new Float32Array(input[0].length))
        let wctx = { sampleRate: sr, channelCount: input.length, totalDuration: t / sr, at, duration, channel, render, ...extra }
        op.whole(input, output, wctx)
        a._.wrc.m.set(key, ref = audio.from(output, { sampleRate: sr }))
      }
      segs = [seg(0, ref._.len, 0, undefined, ref)]
      ch = ref._.ch
      pipeline = []; latency = 0; pulls = []
      if (op.sr) { let ns = op.sr(sr, extra); if (ns) sr = ns }
      continue
    }

    if (op.plan) {
      let t = planLen(segs), offset = at != null ? Math.round(at * sr) : null, length = duration != null ? Math.round(duration * sr) : null
      let pctx = mkPlanCtx(t, sr, offset, length, extra)
      segs = op.plan(segs, pctx)
      if (!final) limit = adjustLimit(limit, type, pctx)
    } else {
      pushProc(edit)
    }
    if (op.sr) { let ns = op.sr(sr, extra); if (ns) sr = ns }
  }
  let totalLen = planLen(segs)
  if (final) limit = totalLen
  // ch = pipeline input width — a._.ch unless a whole op rewrote the timeline to a
  // wider/narrower ref (pipeline stages fold their own widths via desc.ch in initProcs)
  return { segs, pipeline, totalLen, sr, ch, limit: Math.max(0, limit), pulls, latency }
}

/** Sum ref versions + lengths to detect external mutations (edits or decode growth). */
function refVersion(a) {
  let v = 0
  eachRef(a, r => v += r.version + r._.len)
  return v
}

// Instances mid-compile — a self-ref (a.insert(a)) re-enters via the length getter
const compileStack = new Set()

/** Build a read plan from edit list. Always succeeds — every op is plannable. */
export function buildPlan(a) {
  let rv = refVersion(a)
  if (a._.plan && a._.planV === a.version && a._.planL === a._.len && a._.planR === rv) return a._.plan
  if (compileStack.has(a)) throw new Error('audio: circular source reference')
  compileStack.add(a)
  try {
    let plan = compilePlan(a, a._.len, true)
    a._.plan = plan; a._.planV = a.version; a._.planL = a._.len; a._.planR = rv
    return plan
  } finally { compileStack.delete(a) }
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

// Instances currently being rendered as refs — a self/mutual ref would recurse forever
const refStack = new Set()

/** Read a sample range from an audio instance (handles edits via plan). */
function readRange(a, srcStart, n) {
  if (!a.edits.length) {
    return Array.from({ length: a._.ch }, (_, c) => {
      let out = new Float32Array(n)
      copyPages(a, c, srcStart, n, out, 0)
      return out
    })
  }
  if (refStack.has(a)) throw new Error('audio: circular source reference')
  refStack.add(a)
  try {
    let plan = buildPlan(a), sr = plan.sr
    return readPlan(a, plan, srcStart / sr, n / sr)
  } finally { refStack.delete(a) }
}

/** Render one output block from plan segments into pre-allocated chunk.
 *  chunk width = plan width (may differ from a._.ch after a channel-changing
 *  whole op) — ref channels wrap, self segs can't exceed the source width. */
function renderBlock(a, segs, outOff, len, chunk) {
  for (let sg of segs) {
    let iStart = Math.max(outOff, sg[2]), iEnd = Math.min(outOff + len, sg[2] + sg[1])
    if (iStart >= iEnd) continue
    let rate = sg[3] || 1, ref = sg[4], interp = sg[5], absR = Math.abs(rate)
    let n = iEnd - iStart, dstOff = iStart - outOff
    let srcStart = segSrcStart(sg, iStart, n)
    if (ref === null) {
      // zero-filled by default
    } else if (ref) {
      if (ref.edits.length === 0) {
        for (let c = 0; c < chunk.length; c++)
          readSource(ref, c % ref._.ch, srcStart, n, chunk[c], dstOff, rate, interp)
      } else {
        let margin = (interp && interp.margin) || 0
        let base = Math.floor(srcStart), frac = srcStart - base
        let srcN = Math.ceil(frac + n * absR) + 1 + 2 * margin
        let bufStart = base - margin
        let copyOff = bufStart < 0 ? -bufStart : 0
        let copyStart = Math.max(0, bufStart)
        let srcPcm = readRange(ref, copyStart, srcN - copyOff)
        for (let c = 0; c < chunk.length; c++) {
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
      for (let c = 0, N = Math.min(chunk.length, a._.ch); c < N; c++) readSource(a, c, srcStart, n, chunk[c], dstOff, rate, interp)
    }
  }
}

// Sub-block size for engine-resolved param changes (automation fns, patch ramps) —
// ~3ms at 44.1kHz: fine enough to avoid zipper noise without per-sample dispatch.
const SUB = 128

/** Breakpoint curve {t, v} (seconds → value) — the serializable stand-in for `t => v`
 *  automation; survives toJSON and the worker boundary. */
export const isCurve = x => x != null && typeof x === 'object' && x.t?.length > 0 && x.v?.length === x.t.length && typeof x.t[0] === 'number'

/** Curve → sampled function. Linear interpolation, clamped ends, t ascending. */
export function curveFn(c) {
  let { t, v } = c
  return time => {
    let n = t.length
    if (time <= t[0]) return v[0]
    if (time >= t[n - 1]) return v[n - 1]
    let i = 1
    while (t[i] < time) i++
    let f = (time - t[i - 1]) / (t[i] - t[i - 1])
    return v[i - 1] + (v[i] - v[i - 1]) * f
  }
}

/** Apply process pipeline to a block. Each proc owns output buffers sized to its
 *  stage's channel width (set in initProcs) — channel-count changes are a per-stage
 *  property, not a special case, and the hot path stays allocation-free. */
function applyProcs(bufA, procs, outOff, sr) {
  let cur = bufA
  for (let proc of procs) {
    let { op, at, dur, channel, ctx } = proc
    if (!op) continue
    let BS = cur[0].length
    // Stage buffers are BLOCK_SIZE; short blocks (boundaries, latency flush) narrow the view
    let out = proc.out[0].length === BS ? proc.out : proc.out.map(ch => ch.subarray(0, BS))
    // This stage's input content sits preLat cursor samples later than its timeline —
    // all time semantics (blockOffset, ranges, automation) shift back accordingly
    let tOff = outOff - proc.preLat

    let run = (i0, i1) => {
      ctx.blockOffset = (tOff + i0) / sr
      ctx.at = at != null ? at - ctx.blockOffset : undefined
      let full = i0 === 0 && i1 === BS
      let inV = full ? cur : cur.map(ch => ch.subarray(i0, i1))
      let outV = full ? out : out.map(ch => ch.subarray(i0, i1))
      if (channel != null) {
        let chs = typeof channel === 'number' ? [channel] : channel
        for (let c = 0; c < inV.length; c++) if (!chs.includes(c)) outV[c].set(inV[c])
        op(chs.map(c => inV[c]), chs.map(c => outV[c]), ctx)
      } else op(inV, outV, ctx)
    }

    // Engine-level range scoping for ops without native {at, duration} handling
    let s = 0, e = BS
    if (!proc.ranged && (at != null || dur != null)) {
      let a0 = at != null ? Math.round(at * sr) : 0
      let a1 = dur != null ? a0 + Math.round(dur * sr) : Infinity
      s = Math.max(0, Math.min(a0 - tOff, BS))
      e = Math.max(s, Math.min(a1 - tOff, BS))
      if (s > 0 || e < BS) for (let c = 0; c < out.length; c++) out[c].set(cur[c % cur.length])
      if (e <= s) { cur = out; continue }
    }

    let { autos, ramp } = proc
    if (autos || ramp) {
      // Sub-block param resolution: automation fns sampled at sub-block midpoints,
      // patched values ramped linearly across this block (click-free updates)
      for (let i = s; i < e; i += SUB) {
        let j = Math.min(i + SUB, e)
        if (autos) for (let k of autos) ctx[k] = proc.fns[k]((tOff + (i + j) / 2) / sr)
        if (ramp) { let p = (j - s) / (e - s); for (let k in ramp) ctx[k] = ramp[k][0] + (ramp[k][1] - ramp[k][0]) * p }
        run(i, j)
      }
      proc.ramp = ramp = null
    } else run(s, e)
    cur = out
  }
  return cur
}

/** Structural signature — op types only. Value changes patched in place. */
function pipelineSig(pipeline) {
  return pipeline.map(ed => ed[0]).join('|')
}

/** Patch proc contexts with updated parameter values (no reinit). Numeric changes
 *  ramp across the next block (applyProcs sub-block loop); function values re-captured. */
function patchProcs(procs, pipeline) {
  for (let i = 0; i < procs.length && i < pipeline.length; i++) {
    let p = procs[i], o = pipeline[i][1] || {}
    let { at, duration, channel, ...extra } = o
    let ramp = null
    for (let k in extra) {
      let v = extra[k]
      if (isCurve(v)) v = curveFn(v)
      if (typeof v === 'function') {
        if (p.fns?.[k]) p.fns[k] = v
        else if (p.desc.auto === 'sample') p.ctx[k] = v
        continue
      }
      if (typeof v === 'number' && typeof p.ctx[k] === 'number' && p.ctx[k] !== v) (ramp ??= {})[k] = [p.ctx[k], v]
      p.ctx[k] = v
    }
    if (ramp) p.ramp = ramp
  }
}

/** Initialize process pipeline contexts from plan. Each proc gets its own output
 *  buffers sized to its stage's channel width — zero allocation in the block loop. */
function initProcs(pipeline, totalDur, sr, nch) {
  let curCh = nch, BS = audio.BLOCK_SIZE, preLat = 0
  return pipeline.map(ed => {
    let desc = ops[ed[0]]
    let o = ed[1] || {}
    let { at, duration: dur, channel, ...extra } = o
    let ctx = { duration: dur, sampleRate: sr, totalDuration: totalDur, render, ...extra }
    let outCh = desc.ch ? desc.ch(curCh, ctx) : 0
    let w = outCh || curCh
    if (outCh) curCh = outCh
    // Cumulative latency of prior stages — this stage's input content sits preLat
    // cursor samples later than its timeline position
    let myPre = preLat
    preLat += procLatency(desc, o, sr)
    // Function-valued (or breakpoint-curve) params become engine automation unless the
    // op samples them itself (auto: 'sample') or declares genuine function args (fnArgs)
    let fns = null, autos = null
    for (let k in extra) {
      let val = extra[k]
      if (isCurve(val)) val = curveFn(val)
      if (typeof val !== 'function' || desc.fnArgs?.includes(k)) continue
      if (desc.auto === 'sample') { ctx[k] = val; continue }
      ;(fns ??= {})[k] = val; (autos ??= []).push(k)
      ctx[k] = val(0)
    }
    return {
      op: desc.process,
      desc,
      origAt: at,
      at: at != null && at < 0 ? totalDur + at : at,
      dur,
      channel,
      outCh,
      ranged: !!desc.ranged,
      preLat: myPre,
      out: Array.from({ length: w }, () => new Float32Array(BS)),
      fns, autos, ramp: null,
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
    max = Math.max(max, Math.ceil(segSrcStart(sg, iStart, n) + n * absR) + 1 + margin)
  }
  return max
}

/** Stream chunks from a read plan. Cursors run plan.latency ahead of the requested
 *  timeline (plugin delay compensation) — past-the-end cursors render silence, which
 *  flushes lookahead delay lines so the tail lands aligned. */
export function* streamPlan(a, plan, offset, duration) {
  let { segs, pipeline, totalLen, sr, ch = a._.ch, latency: T = 0 } = plan
  let s = Math.round((offset || 0) * sr), e = duration != null ? s + Math.round(duration * sr) : totalLen
  let procs = initProcs(pipeline, totalLen / sr, sr, ch)

  let sc = s + T, ec = e + T
  let ws = (sc > 0 && procs.length) ? Math.max(0, sc - audio.BLOCK_SIZE * WARMUP) : sc
  let BS = audio.BLOCK_SIZE, nch = ch
  let bufA = Array.from({ length: nch }, () => new Float32Array(BS))

  for (let outOff = ws; outOff < ec;) {
    let blockEnd = outOff < sc ? sc : ec
    let len = Math.min(BS, blockEnd - outOff)
    for (let b of bufA) b.fill(0, 0, len)
    renderBlock(a, segs, outOff, len, bufA)
    let src = len < BS ? bufA.map(b => b.subarray(0, len)) : bufA
    let out = procs.length ? applyProcs(src, procs, outOff, sr) : src
    if (outOff >= sc) yield out.map(b => b.subarray(0, len))
    outOff += len
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
