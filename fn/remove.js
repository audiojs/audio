import { subSeg, sliceSegs, fadeSegs, planOffset, planLen } from '../plan.js'
import { parseTime } from '../core.js'

/** Remove [off, off + dur). With a crossfade of `x` samples the splice is equal-power and
 *  centered: the left side runs on into the cut while it fades out, the right side starts
 *  early while it fades in, so the length is still total − dur. The overlap shrinks to fit
 *  at the file edges. */
export function removeSegs(segs, off, dur, x = 0) {
  let end = off + dur, total = planLen(segs)
  let h = dur > 0 ? Math.min(Math.floor(x / 2), off, total - end) : 0
  if (h > 0) {
    let r = sliceSegs(segs, 0, off - h)
    for (let s of fadeSegs(sliceSegs(segs, off - h, 2 * h), 2 * h, 1, 0)) { s[2] += off - h; r.push(s) }
    for (let s of fadeSegs(sliceSegs(segs, end - h, 2 * h), 2 * h, 0, 1)) { s[2] += off - h; r.push(s) }
    for (let s of sliceSegs(segs, end + h, total - end - h)) { s[2] += off + h; r.push(s) }
    return r.sort((a, b) => a[2] - b[2])
  }
  let r = []
  for (let s of segs) {
    let se = s[2] + s[1]
    if (se <= off) r.push(s)
    else if (s[2] >= end) { let n = s.slice(); n[2] = s[2] - dur; r.push(n) }
    else {
      if (s[2] < off) r.push(subSeg(s, s[2], off - s[2], s[2]))
      if (se > end) r.push(subSeg(s, end, se - end, off))
    }
  }
  return r
}

/** Crossfade length in samples, from seconds or a duration string ('10ms'). */
export const xfadeLen = (ctx) => Math.max(0, Math.round((parseTime(ctx.crossfade) || 0) * ctx.sampleRate))

const removePlan = (segs, ctx) => {
  let { total } = ctx
  let s = planOffset(ctx.offset, total)
  return removeSegs(segs, s, Math.max(0, Math.min(ctx.length ?? (total - s), total - s)), xfadeLen(ctx))
}

import audio from '../core.js'
audio.op('remove', { params: ['at', 'duration', 'crossfade'], plan: removePlan })
