/**
 * Plan — non-destructive edit pipeline.
 * Intercepts create/run/read/stream to track and materialize edits.
 */

import audio, { readPages, copyPages, walkPages, parseTime, LOAD, READ, emit } from './core.js'

let fn = audio.fn
let ops = {}

// ── Segments: [src, count, dst, rate?, ref?] ────────────────────
export function seg(src, count, dst, rate, ref) {
  let s = [src, count, dst]
  if (rate != null && rate !== 1) s[3] = rate
  if (ref !== undefined) s[4] = ref
  return s
}

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
      let edit = { type: name, args: a }, last = a[a.length - 1]
      if (a.length && isOpts(last)) {
        let { at, duration, channel, offset, length, ...extra } = last
        edit.args = a.slice(0, -1)
        if (at != null) edit.at = parseTime(at)
        if (duration != null) edit.duration = parseTime(duration)
        if (offset != null) edit.offset = offset
        if (length != null) edit.length = length
        if (channel != null) edit.channel = channel
        Object.assign(edit, extra)
      }
      return this.run(edit)
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
    for (let edit of this.edits) { if (ops[edit.type]?.ch) ch = ops[edit.type].ch(ch, edit.args) }
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
  for (let { args } of a.edits) if (args?.[0]?.pages) await args[0][LOAD]()
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
  // Live decode streaming (no edits, still decoding)
  // Position-based: reads from full pages (zero-copy) or partial buffer (copied).
  // Granularity = decoder chunk size, NOT page size. Pages are for memory, not streaming.
  if (this._.waiters && !this.decoded && !this.edits.length) {
    let sr = this.sampleRate, acc = this._.acc, PS = audio.PAGE_SIZE
    let startSample = offset ? Math.round(offset * sr) : 0
    let endSample = duration != null ? startSample + Math.round(duration * sr) : Infinity
    let pos = startSample
    while (pos < endSample) {
      let available = acc ? this.pages.length * PS + acc.partialLen : this._.len
      while (pos >= available && !this.decoded) {
        await new Promise(r => this._.waiters.push(r))
        available = acc ? this.pages.length * PS + acc.partialLen : this._.len
      }
      if (pos >= available) break
      let end = Math.min(endSample, available)
      let pi = Math.floor(pos / PS), po = pos % PS
      if (pi < this.pages.length) {
        let page = this.pages[pi], e = Math.min(page[0].length - po, end - pos)
        yield page.map(ch => ch.subarray(po, po + e))
        pos += e
      } else if (acc) {
        let e = Math.min(acc.partialLen - po, end - pos)
        if (e > 0) { yield acc.partial.map(ch => ch.subarray(po, po + e).slice()); pos += e }
      }
    }
    return
  }

  // Edit-aware streaming (plan-based)
  await this.ready
  await this[LOAD]()
  await loadRefs(this)
  let plan = buildPlan(this)
  let seen = new Set()
  for (let s of plan.segs) if (s[4] && s[4] !== null && !seen.has(s[4])) { seen.add(s[4]); await s[4][LOAD]() }
  await ensurePlan(this, plan, offset, duration)
  for (let chunk of streamPlan(this, plan, offset, duration)) yield chunk
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
    if (!e.type) throw new TypeError('audio.run: edit must have type')
    let edit = { ...e, args: e.args || [] }
    if (edit.at != null) edit.at = parseTime(edit.at)
    if (edit.duration != null) edit.duration = parseTime(edit.duration)
    if (edit.offset != null) { edit.at = edit.offset / sr; delete edit.offset }
    if (edit.length != null) { edit.duration = edit.length / sr; delete edit.length }
    pushEdit(this, edit)
  }
  return this
}

fn.toJSON = function() {
  let edits = this.edits.filter(e => !e.args?.some(a => typeof a === 'function'))
  return { source: this.source, edits, sampleRate: this.sampleRate, channels: this.channels, duration: this.duration }
}

fn.clone = function() {
  let b = audio.from(this)
  for (let e of this.edits) pushEdit(b, { ...e })
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

/** Build a read plan from edit list. Always succeeds — every op is plannable. */
export function buildPlan(a) {
  if (a._.plan && a._.planV === a.version) return a._.plan
  let sr = a.sampleRate, ch = a._.ch
  let segs = [[0, a._.len, 0]], pipeline = []

  for (let edit of a.edits) {
    let { type, args = [], at, duration, channel, ...extra } = edit
    let op = ops[type]
    if (!op) throw new Error(`Unknown op: ${type}`)

    // resolve: try stats-aware replacement first
    if (op.resolve) {
      let ctx = { ...extra, stats: a._.srcStats || a.stats, sampleRate: sr, channelCount: ch, channel, at, duration, totalDuration: planLen(segs) / sr }
      let resolved = op.resolve(args, ctx)
      if (resolved === false) continue
      if (resolved) {
        let edits = Array.isArray(resolved) ? resolved : [resolved]
        for (let r of edits) {
          if (channel != null && r.channel == null) r.channel = channel
          if (at != null && r.at == null) r.at = at
          if (duration != null && r.duration == null) r.duration = duration
          let rOp = ops[r.type]
          if (rOp?.plan && typeof rOp.plan === 'function') {
            let t = planLen(segs), rOffset = r.at != null ? Math.round(r.at * sr) : null, rLength = r.duration != null ? Math.round(r.duration * sr) : null
            segs = rOp.plan(segs, { total: t, sampleRate: sr, args: r.args || [], offset: rOffset, length: rLength })
          } else {
            pipeline.push(r)
          }
        }
        continue
      }
      // resolved null — fall through to plan or per-page
    }

    // plan: structural segment rewrite
    if (op.plan) {
      let t = planLen(segs), offset = at != null ? Math.round(at * sr) : null, length = duration != null ? Math.round(duration * sr) : null
      segs = op.plan(segs, { total: t, sampleRate: sr, args, offset, length })
    } else {
      pipeline.push(edit)
    }
  }
  let plan = { segs, pipeline, totalLen: planLen(segs), sr }
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

/** Stream chunks from a read plan. */
export function* streamPlan(a, plan, offset, duration) {
  let { segs, pipeline, totalLen, sr } = plan
  let s = Math.round((offset || 0) * sr), e = duration != null ? s + Math.round(duration * sr) : totalLen

  let totalDur = totalLen / sr
  let procs = pipeline.map(ed => {
    let m = ops[ed.type]
    let { type, args, at, duration, channel, ...extra } = ed
    return {
      op: m.process,
      at: at != null && at < 0 ? totalDur + at : at,
      dur: duration,
      channel,
      ctx: { ...extra, args: args || [], duration, sampleRate: sr, totalDuration: totalDur, render }
    }
  })

  // Warm up stateful ops (filters) when seeking — render prior blocks silently to settle IIR state
  let WARMUP = 8  // ~185ms at 44.1kHz — enough for most IIR filters to settle
  let ws = (s > 0 && procs.length) ? Math.max(0, s - audio.BLOCK_SIZE * WARMUP) : s

  for (let outOff = ws; outOff < e; outOff += audio.BLOCK_SIZE) {
    let blockEnd = outOff < s ? s : e
    let len = Math.min(audio.BLOCK_SIZE, blockEnd - outOff)
    let chunk = Array.from({ length: a._.ch }, () => new Float32Array(len))

    for (let sg of segs) {
      let iStart = Math.max(outOff, sg[2]), iEnd = Math.min(outOff + len, sg[2] + sg[1])
      if (iStart >= iEnd) continue
      let rate = sg[3] || 1, ref = sg[4], absR = Math.abs(rate)
      let n = iEnd - iStart, dstOff = iStart - outOff
      // For negative rate, read from the far end of the source range so reversal is globally correct across blocks
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
