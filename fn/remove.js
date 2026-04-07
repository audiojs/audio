function removeSegs(segs, off, dur) {
  let r = [], end = off + dur
  for (let s of segs) {
    let se = s.out + s.len
    if (se <= off) r.push(s)
    else if (s.out >= end) r.push({ ...s, out: s.out - dur })
    else {
      if (s.out < off) r.push({ src: s.src, out: s.out, len: off - s.out, ref: s.ref, rev: s.rev })
      if (se > end) r.push({ src: s.src + end - s.out, out: off, len: se - end, ref: s.ref, rev: s.rev })
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

const removeOutLen = (len, ctx) => len - (ctx.span || 0)

const removePlan = (segs, ctx) => {
  let { total, offset, span } = ctx
  let s = offset != null ? (offset < 0 ? total + offset : offset) : 0
  return removeSegs(segs, s, span || 0)
}

import audio from '../core.js'
audio.op('remove', remove, { outLen: removeOutLen, plan: removePlan })
