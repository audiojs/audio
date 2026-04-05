function cropSegs(segs, off, len) {
  let r = [], end = off + len
  for (let s of segs) {
    let a = Math.max(s.out, off), b = Math.min(s.out + s.len, end)
    if (a < b) r.push({ src: s.src + a - s.out, out: a - off, len: b - a, ref: s.ref })
  }
  return r
}

const crop = (chs, ctx) => {
  let sr = ctx.sampleRate
  let offset = ctx.args[0] ?? ctx.offset ?? 0
  let duration = ctx.args[1] ?? ctx.duration
  let s = Math.round(offset * sr)
  let end = duration != null ? s + Math.round(duration * sr) : chs[0].length
  return chs.map(ch => ch.slice(s, Math.min(end, ch.length)))
}

crop.dur = (len, sr, args, off, dur) => {
  let o = args[0] ?? off, d = args[1] ?? dur
  let s = o != null ? (o < 0 ? len / sr + o : o) : 0
  return d != null ? Math.round(d * sr) : len - Math.round(s * sr)
}

crop.plan = (segs, total, sr, args, off, dur) => {
  let o = args[0] ?? off, d = args[1] ?? dur
  let s = o != null ? Math.round((o < 0 ? total / sr + o : o) * sr) : 0
  return cropSegs(segs, s, d != null ? Math.round(d * sr) : total - s)
}

export default (audio) => { audio.op.crop = crop }
