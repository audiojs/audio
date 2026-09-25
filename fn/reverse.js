import { subSeg, planOffset } from '../plan.js'

export function reverseSegs(segs, off, end) {
  let r = []
  for (let s of segs) {
    let se = s[2] + s[1]
    if (se <= off || s[2] >= end) { r.push(s); continue }
    if (s[2] < off) r.push(subSeg(s, s[2], off - s[2], s[2]))
    let iStart = Math.max(s[2], off), iEnd = Math.min(se, end)
    r.push(subSeg(s, iStart, iEnd - iStart, off + end - iEnd, iEnd - iStart, s[3], true))
    if (se > end) r.push(subSeg(s, end, se - end, end))
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
