import { cropSegs } from './crop.js'
import { seg, planOffset } from '../plan.js'

function repeatSegs(segs, times, total, off, dur) {
  if (off == null) {
    let r = []
    for (let t = 0; t <= times; t++)
      for (let s of segs) { let n = s.slice(); n[2] = s[2] + total * t; r.push(n) }
    return r
  }
  let segLen = dur ?? (total - off), clip = cropSegs(segs, off, segLen), r = []
  for (let s of segs) {
    let se = s[2] + s[1]
    if (se <= off + segLen) r.push(s)
    else if (s[2] >= off + segLen) { let n = s.slice(); n[2] = s[2] + segLen * times; r.push(n) }
    else {
      let absR = Math.abs(s[3] || 1), split = off + segLen - s[2]
      r.push(seg(s[0], split, s[2], s[3], s[4]))
      r.push(seg(s[0] + split * absR, se - off - segLen, off + segLen * (times + 1), s[3], s[4]))
    }
  }
  for (let t = 1; t <= times; t++)
    for (let c of clip) { let n = c.slice(); n[2] = off + segLen * t + c[2]; r.push(n) }
  r.sort((a, b) => a[2] - b[2])
  return r
}

const repeatPlan = (segs, ctx) => {
  let { total, args, length } = ctx
  let off = ctx.offset != null ? planOffset(ctx.offset, total) : null
  return repeatSegs(segs, args[0] ?? 1, total, off, length)
}

import audio from '../core.js'
audio.op('repeat', { plan: repeatPlan })
