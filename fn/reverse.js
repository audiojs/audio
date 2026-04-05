function reverseSegs(segs, off, end) {
  let r = []
  for (let s of segs) {
    let se = s.out + s.len
    if (se <= off || s.out >= end) { r.push(s); continue }
    if (s.out < off) r.push({ src: s.src, out: s.out, len: off - s.out, ref: s.ref, rev: s.rev })
    let iStart = Math.max(s.out, off), iEnd = Math.min(se, end)
    r.push({ src: s.src + iStart - s.out, out: off + end - iEnd, len: iEnd - iStart, ref: s.ref, rev: !s.rev })
    if (se > end) r.push({ src: s.src + end - s.out, out: end, len: se - end, ref: s.ref, rev: s.rev })
  }
  r.sort((a, b) => a.out - b.out)
  return r
}

const reverse = (chs, ctx) => {
  let sr = ctx.sampleRate
  let offset = ctx.args[0] ?? ctx.offset
  let duration = ctx.args[1] ?? ctx.duration
  let s = offset != null ? Math.round(offset * sr) : 0
  let end = duration != null ? s + Math.round(duration * sr) : chs[0].length
  return chs.map(ch => { let o = new Float32Array(ch); o.subarray(s, Math.min(end, o.length)).reverse(); return o })
}

reverse.plan = (segs, total, sr, args, off, dur) => {
  let o = args[0] ?? off, d = args[1] ?? dur
  let s = o != null ? Math.round((o < 0 ? total / sr + o : o) * sr) : 0
  return reverseSegs(segs, s, s + (d != null ? Math.round(d * sr) : total - s))
}

export default (audio) => { audio.op.reverse = reverse }
