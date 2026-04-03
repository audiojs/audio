/**
 * Render engine — apply edits to source pages, produce PCM.
 */

import audio, { readPages } from './core.js'
import { SILENCE, PAGE_SIZE, planLen } from './plan.js'

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
    // Forward read — delegate to core's readPages path
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

export function* streamPcm(pcm) {
  for (let off = 0; off < pcm[0].length; off += PAGE_SIZE)
    yield pcm.map(ch => ch.slice(off, Math.min(off + PAGE_SIZE, pcm[0].length)))
}

export function readPlan(a, plan, offset, duration) {
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
