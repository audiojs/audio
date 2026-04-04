/**
 * History — non-destructive edit pipeline + render engine.
 * Wraps read/stream to apply edits at render time.
 * Overrides length/channels to walk edit hints.
 */

import { SILENCE, PAGE_SIZE, planLen } from './plan.js'
import { statSession, buildStats } from './stats.js'
import audio, { readPages } from './core.js'

let fn = audio.fn


// ── Render engine ───────────────────────────────────────────────

const MAX_FLAT_SIZE = 2 ** 29

/** Cached full render: reuse if version unchanged. */
export function render(a) {
  if (a._.pcm && a._.pcmV === a.version) return a._.pcm
  let sr = a.sampleRate, ch = a._.ch

  if (a._.len > MAX_FLAT_SIZE) {
    let plan = buildPlan(a)
    if (plan) return readPlan(a, plan)
    throw new Error(`Audio too large for full render (${(a._.len / 1e6).toFixed(0)}M samples). Use streaming.`)
  }

  let flat = Array.from({ length: ch }, () => new Float32Array(a._.len))
  let pos = 0
  for (let i = 0; i < a.pages.length; i++) {
    if (!a.pages[i]) { pos += PAGE_SIZE; continue }
    for (let c = 0; c < ch; c++) flat[c].set(a.pages[i][c], pos)
    pos += a.pages[i][0].length
  }

  for (let edit of a.edits) {
    let op = edit.type === '_fn' ? edit.fn : audio.op[edit.type]
    if (!op) throw new Error(`Unknown op: ${edit.type}`)
    let result = edit.type === '_fn'
      ? op(flat)
      : op(flat, { args: edit.args || [], sampleRate: sr, render })
    if (result === false || result === null) continue
    if (result) flat = result
  }

  a._.pcm = flat; a._.pcmV = a.version
  return flat
}

/** Build a read plan from edit list. Returns null if not streamable. */
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

/** Read samples from source pages, optionally reversed. */
function readSource(a, c, srcOff, len, target, tOff, rev = false) {
  if (!rev) {
    let p0 = Math.floor(srcOff / PAGE_SIZE), pos = p0 * PAGE_SIZE
    for (let p = p0; p < a.pages.length && pos < srcOff + len; p++) {
      let pg = a.pages[p], pLen = pg ? pg[0].length : PAGE_SIZE
      if (pos + pLen > srcOff && pg) {
        let s = Math.max(srcOff - pos, 0), e = Math.min(srcOff + len - pos, pLen)
        target.set(pg[c].subarray(s, e), tOff + Math.max(pos - srcOff, 0))
      }
      pos += pLen
    }
  } else {
    let p0 = Math.floor(srcOff / PAGE_SIZE), pos = p0 * PAGE_SIZE
    for (let p = p0; p < a.pages.length && pos < srcOff + len; p++) {
      let pg = a.pages[p], pLen = pg ? pg[0].length : PAGE_SIZE
      if (pos + pLen > srcOff && pg) {
        let s = Math.max(srcOff - pos, 0), e = Math.min(srcOff + len - pos, pLen)
        for (let i = s; i < e; i++) target[tOff + (srcOff + len - 1 - (pos + i))] = pg[c][i]
      }
      pos += pLen
    }
  }
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
    dur: ed.duration
  }))

  for (let outOff = s; outOff < e; outOff += PAGE_SIZE) {
    let len = Math.min(PAGE_SIZE, e - outOff)
    let chunk = Array.from({ length: a._.ch }, () => new Float32Array(len))

    for (let seg of segs) {
      let iStart = Math.max(outOff, seg.out), iEnd = Math.min(outOff + len, seg.out + seg.len)
      if (iStart >= iEnd) continue
      let srcStart = seg.src + (iStart - seg.out), dstOff = iStart - outOff, n = iEnd - iStart
      if (seg.ref === SILENCE) {
        // zero-filled
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
    for (let { op, args, off, dur } of procs) {
      let adjOff = off != null ? off - blockOff : undefined
      let result = op(chunk, { args, offset: adjOff, duration: dur, sampleRate: sr, blockOffset: blockOff, render })
      if (result === false || result === null) continue
      if (result) chunk = result
    }

    yield chunk
  }
}

function* streamPcm(pcm) {
  for (let off = 0; off < pcm[0].length; off += PAGE_SIZE)
    yield pcm.map(ch => ch.slice(off, Math.min(off + PAGE_SIZE, pcm[0].length)))
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

// ── Init edit-tracking fields on each instance ────────────────────

let prev = audio.hook.create
audio.hook.create = (a) => {
  prev?.(a)
  a.edits = []
  a.version = 0
  a.onchange = null
  a._.pcm = null; a._.pcmV = -1  // render cache
  a._.statsV = -1                  // stats cache version
  a._.lenC = a._.len; a._.lenV = 0
  a._.chC = a._.ch; a._.chV = 0
}

// ── Op dispatch ───────────────────────────────────────────────────

audio.hook.run = function(name, args) {
  pushEdit(this, { type: name, args })
  return this
}

// ── Override length/channels — walk edit hints ─────────────────────

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


// ── Hook read — apply edits via plan or full render ────────────────

audio.hook.read = async function(a, offset, duration) {
  if (!a.edits.length) return readPages(a, offset, duration)

  for (let { args } of a.edits) if (args?.[0]?.pages) await audio.hook.beforeRead?.(args[0])

  let plan = buildPlan(a)
  return plan ? readPlan(a, plan, offset, duration) : render(a).map(ch => {
    if (offset == null) return ch.slice()
    let s = Math.round(offset * a.sampleRate)
    return ch.slice(s, duration != null ? s + Math.round(duration * a.sampleRate) : ch.length)
  })
}


// ── Wrap stream — apply edits via plan ─────────────────────────────

fn[Symbol.asyncIterator] = fn.stream = async function*(offset, duration) {
  // Streaming instance (still decoding) — yield pages as they arrive
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

  await audio.hook.beforeRead?.(this)
  let plan = buildPlan(this)
  if (plan) {
    let seen = new Set()
    for (let s of plan.segs) if (s.ref && s.ref !== SILENCE && !seen.has(s.ref)) { seen.add(s.ref); await audio.hook.beforeRead?.(s.ref) }
    for (let chunk of streamPlan(this, plan, offset, duration)) yield chunk
  } else yield* streamPcm(render(this))
}


// ── Hook query — rebuild stats if dirty ──────────────────────────

audio.hook.beforeQuery = async function(a) {
  if (a.edits.length && a._.statsV !== a.version) {
    let plan = buildPlan(a)
    if (!plan) a.stats = buildStats(audio.stat, render(a), a._.ch, a.sampleRate)
    else { let s = statSession(audio.stat, a._.ch, a.sampleRate); for (let chunk of streamPlan(a, plan)) s.page(chunk); a.stats = s.done() }
    a._.statsV = a.version
  }
}


// ── toJSON ───────────────────────────────────────────────────────

fn.toJSON = function() {
  return { source: this.source, edits: this.edits, sampleRate: this.sampleRate, channels: this._.ch, duration: this.duration }
}


// ── undo / apply ────────────────────────────────────────────────

/** Pop edit(s). n=1 returns single edit or null; n>1 returns array. */
fn.undo = function(n = 1) {
  if (!this.edits.length) return n === 1 ? null : []
  let removed = []
  for (let i = 0; i < n && this.edits.length; i++) removed.push(popEdit(this))
  return n === 1 ? removed[0] : removed
}

/** Re-apply edits. Accepts edit objects or inline functions. */
fn.apply = function(...edits) {
  for (let e of edits) {
    if (typeof e === 'function') pushEdit(this, { type: '_fn', fn: e })
    else if (Array.isArray(e.args)) pushEdit(this, e)
    else throw new TypeError('audio.apply: edit must have args array')
  }
  return this
}


// ── Helpers ─────────────────────────────────────────────────────

/** Push an edit, bump version, notify. */
export function pushEdit(a, edit) {
  a.edits.push(edit)
  a.version++
  a.onchange?.()
}

/** Pop an edit, bump version, notify. Returns removed edit or undefined. */
export function popEdit(a) {
  let e = a.edits.pop()
  if (e) { a.version++; a.onchange?.() }
  return e
}
