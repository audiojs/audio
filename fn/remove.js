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
  let offset = ctx.args[0] ?? ctx.offset ?? 0
  let duration = ctx.args[1] ?? ctx.duration ?? 0
  let s = Math.round(offset * sr), d = Math.round(duration * sr)
  return chs.map(ch => {
    let o = new Float32Array(ch.length - d)
    o.set(ch.subarray(0, s))
    o.set(ch.subarray(s + d), s)
    return o
  })
}

remove.dur = (len, sr, args, off, dur) => len - Math.round(((args[1] ?? dur) || 0) * sr)

remove.plan = (segs, total, sr, args, off, dur) => {
  let o = args[0] ?? off, d = args[1] ?? dur
  let s = o != null ? Math.round((o < 0 ? total / sr + o : o) * sr) : 0
  return removeSegs(segs, s, Math.round((d || 0) * sr))
}

export default (audio) => { audio.op.remove = remove }
