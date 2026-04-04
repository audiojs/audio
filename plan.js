/**
 * Plan utilities for structural ops.
 * Pure functions operating on segment arrays — no core dependency.
 */

/** Sentinel for silence segments in plans */
export const SILENCE = Symbol('silence')

/** Samples per page (2^16) */
export const PAGE_SIZE = 65536

/** Samples per stat block */
export const BLOCK_SIZE = 1024

export function planLen(segs) { let m = 0; for (let s of segs) m = Math.max(m, s.out + s.len); return m }

export function planCrop(segs, off, len) {
  let r = [], end = off + len
  for (let s of segs) {
    let a = Math.max(s.out, off), b = Math.min(s.out + s.len, end)
    if (a < b) r.push({ src: s.src + a - s.out, out: a - off, len: b - a, ref: s.ref })
  }
  return r
}

export function planRemove(segs, off, dur) {
  let r = [], end = off + dur
  for (let s of segs) {
    let se = s.out + s.len
    if (se <= off) r.push(s)
    else if (s.out >= end) r.push({ ...s, out: s.out - dur })
    else {
      if (s.out < off) r.push({ src: s.src, out: s.out, len: off - s.out, ref: s.ref })
      if (se > end) r.push({ src: s.src + end - s.out, out: off, len: se - end, ref: s.ref })
    }
  }
  return r
}

export function planInsert(segs, at, len, ref) {
  let r = []
  for (let s of segs) {
    if (s.out + s.len <= at) r.push(s)
    else if (s.out >= at) r.push({ ...s, out: s.out + len })
    else {
      let f = at - s.out
      r.push({ src: s.src, out: s.out, len: f, ref: s.ref })
      r.push({ src: s.src + f, out: at + len, len: s.len - f, ref: s.ref })
    }
  }
  r.push({ src: 0, out: at, len, ref: ref || SILENCE })
  r.sort((a, b) => a.out - b.out)
  return r
}

export function planRepeat(segs, times, total, off, dur) {
  if (off == null) {
    let r = []
    for (let t = 0; t <= times; t++)
      for (let s of segs) r.push({ ...s, out: s.out + total * t })
    return r
  }
  let segLen = dur ?? (total - off), clip = planCrop(segs, off, segLen), r = []
  for (let s of segs) {
    let se = s.out + s.len
    if (se <= off + segLen) r.push(s)
    else if (s.out >= off + segLen) r.push({ ...s, out: s.out + segLen * times })
    else {
      r.push({ src: s.src, out: s.out, len: off + segLen - s.out, ref: s.ref })
      r.push({ src: s.src + off + segLen - s.out, out: off + segLen * (times + 1), len: se - off - segLen, ref: s.ref })
    }
  }
  for (let t = 1; t <= times; t++)
    for (let c of clip) r.push({ ...c, out: off + segLen * t + c.out })
  r.sort((a, b) => a.out - b.out)
  return r
}

export function planReverse(segs, off, end) {
  let r = []
  for (let s of segs) {
    let se = s.out + s.len
    if (se <= off || s.out >= end) { r.push(s); continue }
    if (s.out < off) r.push({ src: s.src, out: s.out, len: off - s.out, ref: s.ref, rev: s.rev })
    let iStart = Math.max(s.out, off), iEnd = Math.min(se, end)
    r.push({ src: s.src + iStart - s.out, out: off + end - iEnd, len: iEnd - iStart, ref: s.ref, rev: !s.rev })
    if (se > end) r.push({ src: s.src + end - s.out, out: end, len: se - end, ref: s.ref, rev: s.rev })
  }
  r.sort((a, b) => a.out - b.out)
  return r
}
