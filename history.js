/**
 * History — non-destructive edit pipeline.
 * Intercepts create/run/read/stream to track and materialize edits.
 */

import audio, { readPages, copyPages, walkPages, LOAD, READ, RUN } from './core.js'

/** Sentinel for silence segments in plans. */
export const SILENCE = Symbol('silence')

let fn = audio.fn


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

fn[RUN] = function(name, args) {
  pushEdit(this, { type: name, args })
  return this
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
    for (let { type, args = [] } of this.edits) {
      let op = audio.op[type]
      if (op?.dur) len = op.dur(len, sr, args)
    }
    this._.lenC = len; this._.lenV = this.version
    return len
  }, configurable: true },
  channels: { get() {
    if (this._.chV === this.version) return this._.chC
    let ch = this._.ch
    for (let edit of this.edits) { let op = audio.op[edit.type]; if (op?.ch) ch = op.ch(ch, edit.args) }
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

  let plan = buildPlan(this)
  return plan ? readPlan(this, plan, offset, duration) : render(this).map(ch => {
    if (offset == null) return ch.slice()
    let s = Math.round(offset * this.sampleRate)
    return ch.slice(s, duration != null ? s + Math.round(duration * this.sampleRate) : ch.length)
  })
}


// ── Stream ─────────────────────────────────────────────────────

fn[Symbol.asyncIterator] = fn.stream = async function*(offset, duration) {
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

  // Edit-aware streaming (plan-based or render fallback)
  if (this.loaded) await this.loaded
  await this[LOAD]()
  let plan = buildPlan(this)
  if (plan) {
    let seen = new Set()
    for (let s of plan.segs) if (s.ref && s.ref !== SILENCE && !seen.has(s.ref)) { seen.add(s.ref); await s.ref[LOAD]() }
    for (let chunk of streamPlan(this, plan, offset, duration)) yield chunk
  } else yield* streamPcm(render(this), this.sampleRate, offset, duration)
}


// ── Query ─────────────────────────────────────────────────────────────

let prevQuery = fn.query
fn.query = async function(offset, duration) {
  if (this.edits.length && this._.statsV !== this.version && audio.statSession) {
    let plan = buildPlan(this)
    if (!plan) this.stats = audio.statSession(this.sampleRate).page(render(this)).done()
    else { let s = audio.statSession(this.sampleRate); for (let chunk of streamPlan(this, plan)) s.page(chunk); this.stats = s.done() }
    this._.statsV = this.version
  }
  return prevQuery.call(this, offset, duration)
}


// ── API ────────────────────────────────────────────────────────

fn.undo = function(n = 1) {
  if (!this.edits.length) return n === 1 ? null : []
  let removed = []
  for (let i = 0; i < n && this.edits.length; i++) removed.push(popEdit(this))
  return n === 1 ? removed[0] : removed
}

fn.apply = function(...edits) {
  for (let e of edits) {
    if (typeof e === 'function') pushEdit(this, { type: '_fn', fn: e })
    else if (Array.isArray(e.args)) pushEdit(this, e)
    else throw new TypeError('audio.apply: edit must have args array')
  }
  return this
}

fn.toJSON = function() {
  return { source: this.source, edits: this.edits, sampleRate: this.sampleRate, channels: this._.ch, duration: this.duration }
}


// ── Render Engine ──────────────────────────────────────────────

const MAX_FLAT_SIZE = 2 ** 29

/** Render all edits into flat PCM. Cached by version. */
export function render(a) {
  if (a._.pcm && a._.pcmV === a.version) return a._.pcm
  let sr = a.sampleRate, ch = a._.ch

  if (a._.len > MAX_FLAT_SIZE) {
    let plan = buildPlan(a)
    if (plan) return readPlan(a, plan)
    throw new Error(`Audio too large for full render (${(a._.len / 1e6).toFixed(0)}M samples). Use streaming.`)
  }

  let flat = readPages(a)

  for (let edit of a.edits) {
    let op = edit.type === '_fn' ? edit.fn : audio.op[edit.type]
    if (!op) throw new Error(`Unknown op: ${edit.type}`)
    let result = edit.type === '_fn'
      ? op(flat)
      : op(flat, { args: edit.args || [], sampleRate: sr, render, state: {} })
    if (result === false || result === null) continue
    if (result) flat = result
  }

  a._.pcm = flat; a._.pcmV = a.version
  return flat
}

function planLen(segs) { let m = 0; for (let s of segs) m = Math.max(m, s.out + s.len); return m }

/** Build a read plan from edit list. Returns null if not plannable. */
export function buildPlan(a) {
  let sr = a.sampleRate, ch = a._.ch
  let segs = [{ src: 0, out: 0, len: a._.len }], pipeline = [], sawSample = false

  for (let edit of a.edits) {
    let { type, args = [] } = edit
    if (type === '_fn') return null
    let op = audio.op[type]
    if (!op) return null

    if (op.plan === false) {
      if (op.resolve && !sawSample) {
        let ctx = { stats: a.stats, sampleRate: sr, channels: ch, length: planLen(segs) }
        let resolved = op.resolve(args, ctx)
        if (resolved === false) continue
        if (resolved) {
          let rOp = audio.op[resolved.type]
          if (rOp?.plan && typeof rOp.plan === 'function') {
            segs = rOp.plan(segs, planLen(segs), sr, resolved.args || [])
          } else {
            sawSample = true
            pipeline.push(resolved)
          }
          continue
        }
      }
      return null
    }
    if (op.plan) {
      if (sawSample) return null
      segs = op.plan(segs, planLen(segs), sr, args)
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
  let procs = pipeline.map(ed => ({
    op: audio.op[ed.type],
    args: ed.args || [],
    off: ed.offset != null && ed.offset < 0 ? totalDur + ed.offset : ed.offset,
    dur: ed.duration,
    state: {}
  }))

  for (let outOff = s; outOff < e; outOff += audio.PAGE_SIZE) {
    let len = Math.min(audio.PAGE_SIZE, e - outOff)
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
    for (let { op, args, off, dur, state } of procs) {
      let adjOff = off != null ? off - blockOff : undefined
      let result = op(chunk, { args, offset: adjOff, duration: dur, sampleRate: sr, blockOffset: blockOff, length: totalLen, render, state })
      if (result === false || result === null) continue
      if (result) chunk = result
    }

    yield chunk
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

function* streamPcm(pcm, sr, offset, duration) {
  let s = offset ? Math.round(offset * sr) : 0
  let e = duration != null ? s + Math.round(duration * sr) : pcm[0].length
  e = Math.min(e, pcm[0].length)
  for (let off = s; off < e; off += audio.PAGE_SIZE) {
    let end = Math.min(off + audio.PAGE_SIZE, e)
    yield pcm.map(ch => ch.slice(off, end))
  }
}
