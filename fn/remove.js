import { seg } from '../history.js'

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

const remove = (chs, ctx) => {
  let sr = ctx.sampleRate
  let s = ctx.at != null ? Math.round(ctx.at * sr) : 0
  let d = ctx.duration != null ? Math.round(ctx.duration * sr) : 0
  s = Math.max(0, s)
  return chs.map(ch => {
    let o = new Float32Array(ch.length - d)
    o.set(ch.subarray(0, s))
    o.set(ch.subarray(s + d), s)
    return o
  })
}

const removePlan = (segs, ctx) => {
  let { total, offset, span } = ctx
  let s = offset != null ? Math.min(Math.max(0, offset < 0 ? total + offset : offset), total) : 0
  return removeSegs(segs, s, Math.min(span || 0, total - s))
}

import audio from '../core.js'
audio.op('remove', remove, removePlan)
