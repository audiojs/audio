import { seg } from '../history.js'

export function cropSegs(segs, off, len) {
  let r = [], end = off + len
  for (let s of segs) {
    let a = Math.max(s[2], off), b = Math.min(s[2] + s[1], end)
    if (a < b) r.push(seg(s[0] + (a - s[2]) * Math.abs(s[3] || 1), b - a, a - off, s[3], s[4]))
  }
  return r
}

const crop = (chs, ctx) => {
  let sr = ctx.sampleRate
  let s = ctx.at != null ? Math.round(ctx.at * sr) : 0
  let end = ctx.duration != null ? s + Math.round(ctx.duration * sr) : chs[0].length
  return chs.map(ch => ch.slice(Math.max(0, s), Math.min(end, ch.length)))
}

const cropPlan = (segs, ctx) => {
  let { total, offset, span } = ctx
  let s = offset != null ? Math.min(Math.max(0, offset < 0 ? total + offset : offset), total) : 0
  return cropSegs(segs, s, Math.max(0, Math.min(span ?? total - s, total - s)))
}

import audio from '../core.js'
audio.op('crop', crop, cropPlan)
