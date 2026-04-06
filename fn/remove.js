function removeSegs(segs, off, dur) {
  let r = [], end = off + dur
  for (let s of segs) {
    let se = s.out + s.len
    if (se <= off) r.push(s)
    else if (s.out >= end) r.push({ ...s, out: s.out - dur })
    else {
      if (s.out < off) r.push({ src: s.src, out: s.out, len: off - s.out, ref: s.ref })
      if (se > end) r.push({ src: s.src + end - s.out, out: off, len: se - end, ref: s.ref })
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

remove.dur = (len, sr, args, off, dur) => len - Math.round((dur || 0) * sr)

remove.plan = (segs, total, sr, args, off, dur) => {
  let s = off != null ? Math.round((off < 0 ? total / sr + off : off) * sr) : 0
  return removeSegs(segs, s, Math.round((dur || 0) * sr))
}

export default (audio) => { audio.op.remove = remove }
