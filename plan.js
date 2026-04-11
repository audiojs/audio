/**
 * Plan — non-destructive edit pipeline.
 * Intercepts create/run/read/stream to track and materialize edits.
 */

import audio, { readPages, copyPages, walkPages, parseTime, LOAD, READ, emit } from './core.js'

let fn = audio.fn
let ops = {}

// ── Segments: [from, count, to, rate?, ref?] ────────────────────
export function seg(from, count, to, rate, ref) {
  let s = [from, count, to]
  if (rate != null && rate !== 1) s[3] = rate
  if (ref !== undefined) s[4] = ref
  return s
}

// ── Edit array: ['type', ...args, {}] ────────────────────────────
// Normalized shape: trailing opts {} always present.
// e[0] = type, e.slice(1,-1) = args, e.at(-1) = opts

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

/** Register/query op: audio.op(name, descriptor|process) */
audio.op = function(name, arg1, arg2, arg3) {
  if (!arguments.length) return ops
  if (arguments.length === 1) return ops[name]

  // Normalize to descriptor object
  let desc
  if (typeof arg1 !== 'function') {
    desc = arg1
  } else {
    // Legacy positional: audio.op(name, process, plan?, opts?)
    let plan, opts
    if (typeof arg2 === 'function') { plan = arg2; opts = arg3 }
    else opts = arg2
    desc = { process: arg1 }
    if (plan) desc.plan = plan
    if (opts) Object.assign(desc, opts)
  }

  if (!fn[name] && !desc.hidden) {
    let stdMethod = function(...a) {
      return this.run(a.length ? [name, ...a] : [name])
    }
    fn[name] = desc.call
      ? function(...a) { return desc.call.call(this, stdMethod, ...a) }
      : stdMethod
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
  length: { get() {
    if (this._.lenV === this.version) return this._.lenC
    let len = this.edits.length ? buildPlan(this).totalLen : this._.len
    this._.lenC = len; this._.lenV = this.version
    return len
  }, configurable: true },
  channels: { get() {
    if (this._.chV === this.version) return this._.chC
    let ch = this._.ch
    for (let edit of this.edits) { let op = ops[edit[0]]; if (op?.ch) ch = op.ch(ch, edit.slice(1, -1)) }
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
    let absR = Math.abs(sg[3] || 1)
    let srcStart = sg[0] + (iStart - sg[2]) * absR
    let srcLen = (iEnd - iStart) * absR + 1
    let target = sg[4] === null ? null : sg[4] || a
    if (target) await audio.ensurePages(target, srcStart / sr, srcLen / sr)
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

  while (outPos < endSample) {
    let acc = a._.acc
    if (acc && !a.decoded) acc.drain()
    let avail = a.decoded ? a._.len : acc ? acc.length : a._.len

    if (avail > builtLen || (a.decoded && !ensured)) {
      builtLen = Math.max(builtLen, avail)
      plan = compilePlan(a, builtLen, a.decoded)
      if (!procs) {
        procs = initProcs(plan.pipeline, plan.totalLen / sr, sr)
        if (startSample > 0 && procs.length)
          outPos = Math.max(0, startSample - BS * 8)
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

    let chunk = renderBlock(a, plan.segs, outPos, len)
    chunk = applyProcs(chunk, procs, outPos, sr)

    if (outPos >= startSample) yield chunk
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
    if (!Array.isArray(e)) throw new TypeError('audio.run: edit must be array')
    if (typeof e[0] !== 'string') throw new TypeError('audio.run: edit must have type')
    // Normalize: always trailing opts {}
    if (isOpts(e.at(-1))) {
      let o = { ...e.at(-1) }
      if (o.at != null) o.at = parseTime(o.at)
      if (o.duration != null) o.duration = parseTime(o.duration)
      if (o.offset != null) { o.at = o.offset / sr; delete o.offset }
      if (o.length != null) { o.duration = o.length / sr; delete o.length }
      e = [...e.slice(0, -1), o]
    } else {
      e = [...e, {}]
    }
    pushEdit(this, e)
  }
  return this
}

fn.toJSON = function() {
  let edits = this.edits.filter(e => !e.slice(1, -1).some(a => typeof a === 'function'))
  return { source: this.source, edits, sampleRate: this.sampleRate, channels: this.channels, duration: this.duration }
}

fn.clone = function() {
  let b = audio.from(this)
  for (let e of this.edits) pushEdit(b, [...e])
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
function adjustLimit(limit, type, args, offset, length, sr) {
  if (limit <= 0) return 0
  if (type === 'speed') return Math.round(limit / Math.abs(args[0] || 1))
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
      let iLen = typeof args[0] === 'number' ? Math.round(args[0] * sr) : (args[0]?.length ?? 0)
      if (length != null) iLen = Math.min(iLen, length)
      return limit + iLen
    }
    return limit
  }
  if (type === 'pad') return limit + Math.round((args[0] ?? 0) * sr)
  if (type === 'reverse') return length == null ? Math.min(limit, offset ?? 0) : limit
  return limit
}

/** Compile edit list into plan segments + pipeline for a given source length.
 *  final=true when source is fully decoded — all positions are determined. */
function compilePlan(a, len, final) {
  let sr = a.sampleRate, ch = a._.ch
  let segs = [[0, len, 0]], pipeline = [], limit = len

  for (let edit of a.edits) {
    let type = edit[0], args = edit.slice(1, -1), { at, duration, channel, ...extra } = edit.at(-1)
    let op = ops[type]
    if (!op) throw new Error(`Unknown op: ${type}`)

    if (!final && at != null && at < 0) limit = 0

    if (op.resolve) {
      let stats = a._.srcStats || a.stats || a._.acc?.stats
      let ctx = { stats, sampleRate: sr, channelCount: ch, channel, at, duration, totalDuration: planLen(segs) / sr, ...extra }
      let resolved = op.resolve(args, ctx)
      if (resolved === false) continue
      if (resolved) {
        let edits = Array.isArray(resolved) && typeof resolved[0] !== 'string' ? resolved : [resolved]
        for (let re of edits) {
          if (!isOpts(re.at(-1))) re = [...re, {}]
          let o = re.at(-1)
          o.at ??= at; o.duration ??= duration; o.channel ??= channel
          let rOp = ops[re[0]]
          if (rOp?.plan && typeof rOp.plan === 'function') {
            let t = planLen(segs), rOff = o.at != null ? Math.round(o.at * sr) : null, rLen = o.duration != null ? Math.round(o.duration * sr) : null
            segs = rOp.plan(segs, { total: t, sampleRate: sr, args: re.slice(1, -1), offset: rOff, length: rLen })
            if (!final) limit = adjustLimit(limit, re[0], re.slice(1, -1), rOff, rLen, sr)
          } else {
            pipeline.push(re)
          }
        }
        continue
      }
    }

    if (op.plan) {
      let t = planLen(segs), offset = at != null ? Math.round(at * sr) : null, length = duration != null ? Math.round(duration * sr) : null
      segs = op.plan(segs, { total: t, sampleRate: sr, args, offset, length })
      if (!final) limit = adjustLimit(limit, type, args, offset, length, sr)
    } else {
      pipeline.push(edit)
    }
  }
  let totalLen = planLen(segs)
  if (final) limit = totalLen
  return { segs, pipeline, totalLen, sr, limit: Math.max(0, limit) }
}

/** Build a read plan from edit list. Always succeeds — every op is plannable. */
export function buildPlan(a) {
  if (a._.plan && a._.planV === a.version) return a._.plan
  let plan = compilePlan(a, a._.len, true)
  a._.plan = plan; a._.planV = a.version
  return plan
}


// ── Plan Execution ─────────────────────────────────────────────

// Reusable resample buffer — avoids GC pressure during playback at non-unit rates
let _rsBuf = null, _rsLen = 0

/** Read channel samples from pages, resampled by rate. */
function readSource(a, c, srcOff, n, target, tOff, rate) {
  let r = rate || 1, absR = Math.abs(r)
  if (absR === 1) {
    if (r > 0) return copyPages(a, c, srcOff, n, target, tOff)
    return walkPages(a, c, srcOff, n, (pg, ch, s, e, off) => {
      for (let i = s; i < e; i++) target[tOff + (n - 1 - (off + i - s))] = pg[ch][i]
    })
  }
  let srcN = Math.ceil(n * absR) + 1
  if (srcN > _rsLen) { _rsLen = srcN; _rsBuf = new Float32Array(srcN) }
  let buf = _rsBuf.subarray(0, srcN)
  buf.fill(0)
  copyPages(a, c, srcOff, srcN, buf, 0)
  resample(buf, target, tOff, n, r)
}

/** Linear interpolation resample: src buffer → n output samples at given rate. */
function resample(src, target, tOff, n, rate) {
  let absR = Math.abs(rate), rev = rate < 0
  for (let i = 0; i < n; i++) {
    let pos = (rev ? n - 1 - i : i) * absR
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

/** Render one output block from plan segments. */
function renderBlock(a, segs, outOff, len) {
  let chunk = Array.from({ length: a._.ch }, () => new Float32Array(len))
  for (let sg of segs) {
    let iStart = Math.max(outOff, sg[2]), iEnd = Math.min(outOff + len, sg[2] + sg[1])
    if (iStart >= iEnd) continue
    let rate = sg[3] || 1, ref = sg[4], absR = Math.abs(rate)
    let n = iEnd - iStart, dstOff = iStart - outOff
    let srcStart = rate < 0
      ? sg[0] + (sg[1] - (iStart - sg[2]) - n) * absR
      : sg[0] + (iStart - sg[2]) * absR
    if (ref === null) {
      // zero-filled by default
    } else if (ref) {
      if (ref.edits.length === 0) {
        for (let c = 0; c < a._.ch; c++)
          readSource(ref, c % ref._.ch, srcStart, n, chunk[c], dstOff, rate)
      } else {
        let srcN = Math.ceil(n * absR) + 1
        let srcPcm = readRange(ref, srcStart, srcN)
        for (let c = 0; c < a._.ch; c++) {
          let src = srcPcm[c % srcPcm.length]
          if (absR === 1) {
            if (rate < 0) { for (let i = 0; i < n; i++) chunk[c][dstOff + i] = src[n - 1 - i] }
            else chunk[c].set(src.subarray(0, n), dstOff)
          } else resample(src, chunk[c], dstOff, n, rate)
        }
      }
    } else {
      for (let c = 0; c < a._.ch; c++) readSource(a, c, srcStart, n, chunk[c], dstOff, rate)
    }
  }
  return chunk
}

/** Apply process pipeline to a chunk. Returns (possibly replaced) chunk. */
function applyProcs(chunk, procs, outOff, sr) {
  let blockOff = outOff / sr
  for (let proc of procs) {
    let { op, at, channel, ctx } = proc
    if (!op) continue
    ctx.at = at != null ? at - blockOff : undefined
    ctx.blockOffset = blockOff
    if (channel != null) {
      let chs = typeof channel === 'number' ? [channel] : channel
      let sub = chs.map(c => chunk[c])
      let result = op(sub, ctx)
      if (result && result !== false) for (let i = 0; i < chs.length; i++) chunk[chs[i]] = result[i]
    } else {
      let result = op(chunk, ctx)
      if (result === false || result === null) continue
      if (result) chunk = result
    }
  }
  return chunk
}

/** Initialize process pipeline contexts from plan. */
function initProcs(pipeline, totalDur, sr) {
  return pipeline.map(ed => {
    let { at, duration: dur, channel, ...extra } = ed.at(-1)
    return {
      op: ops[ed[0]].process,
      origAt: at,
      at: at != null && at < 0 ? totalDur + at : at,
      dur,
      channel,
      ctx: { args: ed.slice(1, -1), duration: dur, sampleRate: sr, totalDuration: totalDur, render, ...extra }
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
    let rate = sg[3] || 1, absR = Math.abs(rate)
    let n = iEnd - iStart
    let srcStart = rate < 0
      ? sg[0] + (sg[1] - (iStart - sg[2]) - n) * absR
      : sg[0] + (iStart - sg[2]) * absR
    max = Math.max(max, Math.ceil(srcStart + n * absR) + 1)
  }
  return max
}

/** Stream chunks from a read plan. */
export function* streamPlan(a, plan, offset, duration) {
  let { segs, pipeline, totalLen, sr } = plan
  let s = Math.round((offset || 0) * sr), e = duration != null ? s + Math.round(duration * sr) : totalLen
  let procs = initProcs(pipeline, totalLen / sr, sr)

  // Warm up stateful ops (filters) when seeking — render prior blocks silently to settle IIR state
  let WARMUP = 8  // ~185ms at 44.1kHz — enough for most IIR filters to settle
  let ws = (s > 0 && procs.length) ? Math.max(0, s - audio.BLOCK_SIZE * WARMUP) : s

  for (let outOff = ws; outOff < e; outOff += audio.BLOCK_SIZE) {
    let blockEnd = outOff < s ? s : e
    let len = Math.min(audio.BLOCK_SIZE, blockEnd - outOff)
    let chunk = renderBlock(a, segs, outOff, len)
    chunk = applyProcs(chunk, procs, outOff, sr)
    if (outOff >= s) yield chunk
  }
}

function readPlan(a, plan, offset, duration) {
  let chunks = []
  for (let chunk of streamPlan(a, plan, offset, duration)) chunks.push(chunk)
  if (!chunks.length) return Array.from({ length: a.channels }, () => new Float32Array(0))
  let ch = chunks[0].length, totalLen = chunks.reduce((n, c) => n + c[0].length, 0)
  return Array.from({ length: ch }, (_, c) => {
    let out = new Float32Array(totalLen), pos = 0
    for (let chunk of chunks) { out.set(chunk[c], pos); pos += chunk[0].length }
    return out
  })
}
