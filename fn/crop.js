export function cropSegs(segs, off, len) {
  let r = [], end = off + len
  for (let s of segs) {
    let a = Math.max(s.out, off), b = Math.min(s.out + s.len, end)
    if (a < b) r.push({ src: s.src + a - s.out, out: a - off, len: b - a, ref: s.ref })
  }
  return r
}

const crop = (chs, ctx) => {
  let sr = ctx.sampleRate
  let s = ctx.at != null ? Math.round(ctx.at * sr) : 0
  let end = ctx.duration != null ? s + Math.round(ctx.duration * sr) : chs[0].length
  return chs.map(ch => ch.slice(Math.max(0, s), Math.min(end, ch.length)))
}

crop.dur = (len, sr, args, off, dur) => {
  let s = off != null ? (off < 0 ? len / sr + off : off) : 0
  return dur != null ? Math.round(dur * sr) : len - Math.round(s * sr)
}

crop.plan = (segs, total, sr, args, off, dur) => {
  let s = off != null ? Math.round((off < 0 ? total / sr + off : off) * sr) : 0
  return cropSegs(segs, s, dur != null ? Math.round(dur * sr) : total - s)
}

export default (audio) => { audio.op.crop = crop }
