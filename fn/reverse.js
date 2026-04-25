import { seg, planOffset } from '../plan.js'

export function reverseSegs(segs, off, end) {
  let r = []
  for (let s of segs) {
    let se = s[2] + s[1]
    if (se <= off || s[2] >= end) { r.push(s); continue }
    let absR = Math.abs(s[3] || 1)
    if (s[2] < off) r.push(seg(s[0], off - s[2], s[2], s[3], s[4], s[5]))
    let iStart = Math.max(s[2], off), iEnd = Math.min(se, end)
    r.push(seg(s[0] + (iStart - s[2]) * absR, iEnd - iStart, off + end - iEnd, -(s[3] || 1), s[4], s[5]))
    if (se > end) r.push(seg(s[0] + (end - s[2]) * absR, se - end, end, s[3], s[4], s[5]))
  }
  r.sort((a, b) => a[2] - b[2])
  return r
}

const reversePlan = (segs, ctx) => {
  let { total, length } = ctx
  let s = planOffset(ctx.offset, total)
  return reverseSegs(segs, s, s + (length ?? total - s))
}

import audio from '../core.js'
audio.op('reverse', { plan: reversePlan })
