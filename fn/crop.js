import { seg, planOffset } from '../plan.js'

export function cropSegs(segs, off, len) {
  let r = [], end = off + len
  for (let s of segs) {
    let a = Math.max(s[2], off), b = Math.min(s[2] + s[1], end)
    if (a < b) r.push(seg(s[0] + (a - s[2]) * Math.abs(s[3] || 1), b - a, a - off, s[3], s[4]))
  }
  return r
}

const cropPlan = (segs, ctx) => {
  let { total, length } = ctx
  let s = planOffset(ctx.offset, total)
  return cropSegs(segs, s, Math.max(0, Math.min(length ?? total - s, total - s)))
}

import audio from '../core.js'
audio.op('crop', { plan: cropPlan })
