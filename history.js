/**
 * History — non-destructive edit pipeline.
 * Intercepts create/run/read/stream to track and materialize edits.
 */

import audio, { readPages, copyPages, walkPages, LOAD, READ } from './core.js'
import parseDuration from 'parse-duration'

function parseTime(v) {
  if (v == null) return v
  if (typeof v === 'number') return v
  let s = parseDuration(v, 's')
  if (s != null && isFinite(s)) return s
  throw new Error(`Invalid time: ${v}`)
}

/** Sentinel for silence segments in plans. */
export const SILENCE = Symbol('silence')

let fn = audio.fn

// ── Op Registration ─────────────────────────────────────────────

function isOpts(v) {
  return v != null && typeof v === 'object' && !Array.isArray(v) && !ArrayBuffer.isView(v) && !v.pages
    && ('at' in v || 'duration' in v || 'channel' in v || 'offset' in v || 'length' in v)
}

/** Register an op: audio.op(name, process, opts?) */
audio.op = function(name, process, opts) {
  let m = fn[name]
  if (!m) {
    m = fn[name] = function(...a) {
      let edit = { type: name, args: a }, last = a[a.length - 1]
      if (a.length && isOpts(last)) {
        let { at, duration, channel, offset, length } = last
        edit.args = a.slice(0, -1)
        if (at != null) edit.at = at
        if (duration != null) edit.duration = duration
        if (offset != null) edit.offset = offset
        if (length != null) edit.length = length
        if (channel != null) edit.channel = channel
      }
      return this.run(edit)
    }
  } else {
    fn[name] = m
  }
  m.process = process
  for (let k of ['plan', 'lower', 'outLen', 'ch', 'overlap']) {
    let v = opts?.[k] ?? process[k]
    if (v !== undefined) m[k] = v
  }
}


// ── Edit Tracking ───────────────────────────────────────────────

let prevCreate = audio.hook.create
audio.hook.create = (a) => {
  prevCreate?.(a)
  a.edits = []
  a.version = 0
  a.onchange = null
  a._.pcm = null; a._.pcmV = -1   // render cache
  a._.statsV = -1                   // stats cache version
  a._.lenC = a._.len; a._.lenV = 0  // virtual length cache
  a._.chC = a._.ch; a._.chV = 0    // virtual channels cache
}

/** Push an edit, bump version, notify. */
export function pushEdit(a, edit) {
  a.edits.push(edit)
  a.version++
  a.onchange?.()
}

/** Pop an edit, bump version, notify. */
export function popEdit(a) {
  let e = a.edits.pop()
  if (e) { a.version++; a.onchange?.() }
  return e
}


// ── Virtual Length/Channels ─────────────────────────────────────

Object.defineProperties(fn, {
  length: { get() {
    if (this._.lenV === this.version) return this._.lenC
    let len = this._.len, sr = this.sampleRate
    for (let { type, args = [], at, duration } of this.edits) {
      if (fn[type]?.outLen) {
        let offset = at != null ? Math.round(at * sr) : null
        let span = duration != null ? Math.round(duration * sr) : null
        len = fn[type].outLen(len, { sampleRate: sr, args, at, duration, offset, span })
      }
    }
    this._.lenC = len; this._.lenV = this.version
    return len
  }, configurable: true },
  channels: { get() {
    if (this._.chV === this.version) return this._.chC
    let ch = this._.ch
    for (let edit of this.edits) { if (fn[edit.type]?.ch) ch = fn[edit.type].ch(ch, edit.args) }
    this._.chC = ch; this._.chV = this.version
    return ch
  }, configurable: true },
})


// ── Read ───────────────────────────────────────────────────────────────

let prevRead = fn[READ]
fn[READ] = async function(offset, duration) {
  if (!this.edits.length) return prevRead.call(this, offset, duration)
  await this[LOAD]()
  for (let { args } of this.edits) if (args?.[0]?.pages) await args[0][LOAD]()

  return readPlan(this, buildPlan(this), offset, duration)
}


// ── Stream ─────────────────────────────────────────────────────

fn[Symbol.asyncIterator] = fn.stream = async function*(opts) {
  let offset = opts?.at, duration = opts?.duration
  // Live decode streaming (no edits, still decoding)
  if (this._.waiters && !this.decoded && !this.edits.length) {
    let sr = this.sampleRate
    let startSample = offset ? Math.round(offset * sr) : 0
    let endSample = duration != null ? startSample + Math.round(duration * sr) : Infinity
    let pos = 0
    for (let i = 0; ; i++) {
      while (i >= this.pages.length && !this.decoded) await new Promise(r => this._.waiters.push(r))
      if (i >= this.pages.length) break
      let page = this.pages[i], pLen = page[0].length
      let pEnd = pos + pLen
      if (pEnd > startSample && pos < endSample) {
        let s = Math.max(startSample - pos, 0), e = Math.min(endSample - pos, pLen)
        if (s === 0 && e === pLen) yield page
        else yield page.map(ch => ch.subarray(s, e))
      }
      pos = pEnd
      if (pos >= endSample) break
    }
    return
  }

  // Edit-aware streaming (plan-based)
  if (this.loaded) await this.loaded
  await this[LOAD]()
  let plan = buildPlan(this)
  let seen = new Set()
  for (let s of plan.segs) if (s.ref && s.ref !== SILENCE && !seen.has(s.ref)) { seen.add(s.ref); await s.ref[LOAD]() }
  for (let chunk of streamPlan(this, plan, offset, duration)) yield chunk
}


// ── Query ─────────────────────────────────────────────────────────────

/** Resolve offset/duration from opts (for public methods that delegate to query). */
export function resolveRange(opts) {
  if (!opts) return [undefined, undefined]
  return [opts.at != null ? parseTime(opts.at) : undefined, opts.duration != null ? parseTime(opts.duration) : undefined]
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
    if (edit.offset != null) { edit.at = edit.offset / sr; delete edit.offset }
    if (edit.length != null) { edit.duration = edit.length / sr; delete edit.length }
    pushEdit(this, edit)
  }
  return this
}

fn.toJSON = function() {
  let edits = this.edits.filter(e => !e.args?.some(a => typeof a === 'function'))
  return { source: this.source, edits, sampleRate: this.sampleRate, channels: this._.ch, duration: this.duration }
}

fn.clone = function() {
  let b = audio.from(this)
  for (let e of this.edits) pushEdit(b, { ...e })
  return b
}


// ── Render Engine ──────────────────────────────────────────────

const MAX_FLAT_SIZE = 2 ** 29

/** Render all edits into flat PCM. Cached by version. For ctx.render (source instances in insert/mix). */
export function render(a) {
  if (a._.pcm && a._.pcmV === a.version) return a._.pcm
  if (!a.edits.length) { let r = readPages(a); a._.pcm = r; a._.pcmV = a.version; return r }
  if (a._.len > MAX_FLAT_SIZE) throw new Error(`Audio too large for flat render (${(a._.len / 1e6).toFixed(0)}M samples). Use streaming.`)
  let r = readPlan(a, buildPlan(a))
  a._.pcm = r; a._.pcmV = a.version
  return r
}

function planLen(segs) { let m = 0; for (let s of segs) m = Math.max(m, s.out + s.len); return m }

/** Build a read plan from edit list. Always succeeds — every op is plannable. */
export function buildPlan(a) {
  let sr = a.sampleRate, ch = a._.ch
  let segs = [{ src: 0, out: 0, len: a._.len }], pipeline = [], sawSample = false

  for (let edit of a.edits) {
    let { type, args = [], at, duration, channel, ...extra } = edit
    let op = fn[type]
    if (!op?.process) throw new Error(`Unknown op: ${type}`)

    // lower: try stats-aware replacement first
    if (op.lower) {
      let ctx = { ...extra, stats: a._.srcStats || a.stats, sampleRate: sr, channels: ch, channel, at, duration, length: planLen(segs) }
      let resolved = op.lower(args, ctx)
      if (resolved === false) continue
      if (resolved) {
        let edits = Array.isArray(resolved) ? resolved : [resolved]
        for (let r of edits) {
          if (channel != null && r.channel == null) r.channel = channel
          if (at != null && r.at == null) r.at = at
          if (duration != null && r.duration == null) r.duration = duration
          let rOp = fn[r.type]
          if (rOp?.plan && typeof rOp.plan === 'function') {
            let t = planLen(segs), rOffset = r.at != null ? Math.round(r.at * sr) : null, rSpan = r.duration != null ? Math.round(r.duration * sr) : null
            segs = rOp.plan(segs, { total: t, sampleRate: sr, args: r.args || [], at: r.at, duration: r.duration, offset: rOffset, span: rSpan })
          } else {
            sawSample = true
            pipeline.push(r)
          }
        }
        continue
      }
      // lowered null — fall through to plan or per-page
    }

    // plan: structural segment rewrite
    if (op.plan) {
      let t = planLen(segs), offset = at != null ? Math.round(at * sr) : null, span = duration != null ? Math.round(duration * sr) : null
      segs = op.plan(segs, { total: t, sampleRate: sr, args, at, duration, offset, span })
    } else {
      sawSample = true
      pipeline.push(edit)
    }
  }
  return { segs, pipeline, totalLen: planLen(segs), sr }
}


// ── Plan Execution ─────────────────────────────────────────────

/** Read channel samples from pages, optionally reversed. */
function readSource(a, c, srcOff, len, target, tOff, rev) {
  if (!rev) return copyPages(a, c, srcOff, len, target, tOff)
  walkPages(a, c, srcOff, len, (pg, ch, s, e, off) => {
    for (let i = s; i < e; i++) target[tOff + (len - 1 - (off + i - s))] = pg[ch][i]
  })
}

/** Stream chunks from a read plan. */
export function* streamPlan(a, plan, offset, duration) {
  let { segs, pipeline, totalLen, sr } = plan
  let s = Math.round((offset || 0) * sr), e = duration != null ? s + Math.round(duration * sr) : totalLen

  let totalDur = totalLen / sr
  let procs = pipeline.map(ed => {
    let m = fn[ed.type]
    let { type, args, at, duration, channel, ...extra } = ed
    return {
      op: m.process, args: args || [],
      at: at != null && at < 0 ? totalDur + at : at,
      dur: duration,
      channel,
      overlap: m.overlap || 0,
      tail: null,
      state: {},
      extra
    }
  })

  // Warm up stateful ops (filters) when seeking — render prior page(s) silently to settle state
  let ws = (s > 0 && procs.length) ? Math.max(0, s - audio.PAGE_SIZE) : s

  for (let outOff = ws; outOff < e; outOff += audio.PAGE_SIZE) {
    let pageEnd = outOff < s ? s : e
    let len = Math.min(audio.PAGE_SIZE, pageEnd - outOff)
    let chunk = Array.from({ length: a._.ch }, () => new Float32Array(len))

    for (let seg of segs) {
      let iStart = Math.max(outOff, seg.out), iEnd = Math.min(outOff + len, seg.out + seg.len)
      if (iStart >= iEnd) continue
      let srcStart = seg.src + (iStart - seg.out), dstOff = iStart - outOff, n = iEnd - iStart
      if (seg.ref === SILENCE) {
        // zero-filled by default
      } else if (seg.ref) {
        if (seg.ref.edits.length === 0) {
          for (let c = 0; c < a._.ch; c++)
            readSource(seg.ref, c % seg.ref._.ch, srcStart, n, chunk[c], dstOff, seg.rev)
        } else {
          let srcPcm = render(seg.ref)
          for (let c = 0; c < a._.ch; c++) {
            let src = srcPcm[c % srcPcm.length]
            if (seg.rev) { for (let i = 0; i < n; i++) chunk[c][dstOff + i] = src[srcStart + n - 1 - i] }
            else chunk[c].set(src.subarray(srcStart, srcStart + n), dstOff)
          }
        }
      } else {
        for (let c = 0; c < a._.ch; c++) readSource(a, c, srcStart, n, chunk[c], dstOff, seg.rev)
      }
    }

    let blockOff = outOff / sr
    for (let proc of procs) {
      let { op, args, at, dur, channel, overlap, state, extra } = proc
      let adjAt = at != null ? at - blockOff : undefined
      let ctx = { ...extra, args, at: adjAt, duration: dur, sampleRate: sr, blockOffset: blockOff, length: totalLen, render, state }

      // Windowed op: prepend prior tail, process, trim overlap
      if (overlap > 0) {
        let src = channel != null ? (typeof channel === 'number' ? [channel] : channel).map(c => chunk[c]) : chunk
        let extended = proc.tail
          ? src.map((ch, i) => { let x = new Float32Array(proc.tail[i].length + ch.length); x.set(proc.tail[i]); x.set(ch, proc.tail[i].length); return x })
          : src
        ctx.overlap = proc.tail ? proc.tail[0].length : 0
        let result = op(extended, ctx)
        if (result && result !== false) {
          let skip = ctx.overlap
          if (channel != null) {
            let chs = typeof channel === 'number' ? [channel] : channel
            for (let i = 0; i < chs.length; i++) chunk[chs[i]] = result[i].subarray(skip, skip + chunk[0].length)
          } else {
            chunk = result.map(ch => ch.subarray(skip, skip + chunk[0].length))
          }
        }
        // Store tail for next page
        proc.tail = src.map(ch => ch.subarray(Math.max(0, ch.length - overlap)))
      } else if (channel != null) {
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
