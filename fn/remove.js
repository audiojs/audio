import { seg, segSrcStart, planOffset } from '../plan.js'

export function removeSegs(segs, off, dur) {
  let r = [], end = off + dur
  for (let s of segs) {
    let se = s[2] + s[1]
    if (se <= off) r.push(s)
    else if (s[2] >= end) { let n = s.slice(); n[2] = s[2] - dur; r.push(n) }
    else {
      if (s[2] < off) r.push(seg(segSrcStart(s, s[2], off - s[2]), off - s[2], s[2], s[3], s[4], s[5]))
      if (se > end) r.push(seg(segSrcStart(s, end, se - end), se - end, off, s[3], s[4], s[5]))
    }
  }
  return r
}

const removePlan = (segs, ctx) => {
  let { total } = ctx
  let s = planOffset(ctx.offset, total)
  return removeSegs(segs, s, Math.min(ctx.length ?? (total - s), total - s))
}

import audio from '../core.js'
audio.op('remove', { plan: removePlan })
