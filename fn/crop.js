export function cropSegs(segs, off, len) {
  let r = [], end = off + len
  for (let s of segs) {
    let a = Math.max(s.out, off), b = Math.min(s.out + s.len, end)
    if (a < b) r.push({ src: s.src + a - s.out, out: a - off, len: b - a, ref: s.ref, rev: s.rev })
  }
  return r
}

const crop = (chs, ctx) => {
  let sr = ctx.sampleRate
  let s = ctx.at != null ? Math.round(ctx.at * sr) : 0
  let end = ctx.duration != null ? s + Math.round(ctx.duration * sr) : chs[0].length
  return chs.map(ch => ch.slice(Math.max(0, s), Math.min(end, ch.length)))
}

const cropOutLen = (len, ctx) => {
  let { offset, span } = ctx
  let s = offset != null ? (offset < 0 ? len + offset : offset) : 0
  return span ?? len - s
}

const cropPlan = (segs, ctx) => {
  let { total, offset, span } = ctx
  let s = offset != null ? (offset < 0 ? total + offset : offset) : 0
  return cropSegs(segs, s, span ?? total - s)
}

import audio from '../core.js'
audio.op('crop', crop, { outLen: cropOutLen, plan: cropPlan })
