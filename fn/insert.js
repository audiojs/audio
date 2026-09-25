import { seg, subSeg, sliceSegs, fadeSegs, planOffset, planLen } from '../plan.js'
import { xfadeLen } from './remove.js'

export function insertSegs(segs, at, len, ref, rate, x = 0) {
  if (x > 0 && len > 1) return insertXfade(segs, at, len, [seg(0, len, 0, rate, ref ?? null)], Math.min(x, Math.floor(len / 2)))
  let r = []
  for (let s of segs) {
    if (s[2] + s[1] <= at) r.push(s)
    else if (s[2] >= at) { let n = s.slice(); n[2] = s[2] + len; r.push(n) }
    else {
      let f = at - s[2]
      r.push(subSeg(s, s[2], f, s[2]))
      r.push(subSeg(s, at, s[1] - f, at + len))
    }
  }
  r.push(seg(0, len, at, rate, ref ?? null))
  r.sort((a, b) => a[2] - b[2])
  return r
}

/** Insert B (length len) at `at` with equal-power crossfades of X samples at both seams,
 *  inside B's span so the length stays total + len. The host audio supplies the handles:
 *  at the entry seam it runs on past `at` while B fades in; at the exit seam it replays its
 *  last X samples before `at` fading in while B fades out. A seam at a file edge, with no
 *  handle to overlap, fades both sides in place instead. */
function insertXfade(segs, at, len, B, X) {
  let total = planLen(segs), A0 = sliceSegs(segs, 0, at), A1 = sliceSegs(segs, at, total - at)
  let r = [], put = (list, to) => { for (let s of list) { s[2] += to; r.push(s) } }
  let fade = (list, a, n, p0, p1) => fadeSegs(sliceSegs(list, a, n), n, p0, p1)
  // entry seam (A0 | B): overlap on A's continuation, else in place (append)
  let h1 = at > 0 ? Math.min(X, total - at) : 0, f1 = at > 0 && !h1 ? Math.min(X, at) : 0
  // exit seam (B | A1): overlap on A's tail before `at`, else in place (prepend)
  let h2 = total > at ? Math.min(X, at) : 0, f2 = total > at && !h2 ? Math.min(X, total - at) : 0
  let b0 = h1 || f1, b1 = h2 || f2

  put(sliceSegs(A0, 0, at - f1), 0)
  if (f1) put(fade(A0, at - f1, f1, 1, 0), at - f1)
  if (h1) put(fade(A1, 0, h1, 1, 0), at)
  if (b0) put(fade(B, 0, b0, 0, 1), at)
  put(sliceSegs(B, b0, len - b0 - b1), at + b0)
  if (b1) put(fade(B, len - b1, b1, 1, 0), at + len - b1)
  if (h2) put(fade(A0, at - h2, h2, 0, 1), at + len - h2)
  if (f2) put(fade(A1, 0, f2, 0, 1), at + len)
  put(sliceSegs(A1, f2, total - at - f2), at + len + f2)
  return r.sort((a, b) => a[2] - b[2])
}

const insertPlan = (segs, ctx) => {
  let { total, sampleRate: sr } = ctx
  let source = ctx.source, off = planOffset(ctx.offset, total, total)
  // Normalize raw sources to audio instances for plan segment refs
  if (typeof source !== 'number' && !source?.pages) source = audio.from(source, { sampleRate: sr })
  // Foreign sample rate → segment reads at srcSR/sr so pitch/duration are preserved
  let rate = typeof source !== 'number' && source.sampleRate !== sr ? source.sampleRate / sr : undefined
  let iLen = typeof source === 'number' ? Math.round(source * sr)
    : rate ? Math.round(source.length / rate) : source.length
  if (ctx.length != null) iLen = Math.min(iLen, ctx.length)
  return insertSegs(segs, off, iLen, typeof source === 'number' ? null : source, rate, xfadeLen(ctx))
}

import audio from '../core.js'
audio.op('insert', { params: ['source', 'at', 'crossfade'], plan: insertPlan })
