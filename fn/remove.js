import { seg, planOffset } from '../plan.js'

function removeSegs(segs, off, dur) {
  let r = [], end = off + dur
  for (let s of segs) {
    let se = s[2] + s[1]
    if (se <= off) r.push(s)
    else if (s[2] >= end) { let n = s.slice(); n[2] = s[2] - dur; r.push(n) }
    else {
      let absR = Math.abs(s[3] || 1)
      if (s[2] < off) r.push(seg(s[0], off - s[2], s[2], s[3], s[4]))
      if (se > end) r.push(seg(s[0] + (end - s[2]) * absR, se - end, off, s[3], s[4]))
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
