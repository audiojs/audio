function repeatSegs(segs, times, total, off, dur) {
  if (off == null) {
    let r = []
    for (let t = 0; t <= times; t++)
      for (let s of segs) r.push({ ...s, out: s.out + total * t })
    return r
  }
  let segLen = dur ?? (total - off), clip = cropSegs(segs, off, segLen), r = []
  for (let s of segs) {
    let se = s.out + s.len
    if (se <= off + segLen) r.push(s)
    else if (s.out >= off + segLen) r.push({ ...s, out: s.out + segLen * times })
    else {
      r.push({ src: s.src, out: s.out, len: off + segLen - s.out, ref: s.ref })
      r.push({ src: s.src + off + segLen - s.out, out: off + segLen * (times + 1), len: se - off - segLen, ref: s.ref })
    }
  }
  for (let t = 1; t <= times; t++)
    for (let c of clip) r.push({ ...c, out: off + segLen * t + c.out })
  r.sort((a, b) => a.out - b.out)
  return r
}

function cropSegs(segs, off, len) {
  let r = [], end = off + len
  for (let s of segs) {
    let a = Math.max(s.out, off), b = Math.min(s.out + s.len, end)
    if (a < b) r.push({ src: s.src + a - s.out, out: a - off, len: b - a, ref: s.ref })
  }
  return r
}

const repeat = (chs, ctx) => {
  let times = ctx.args[0] || 1, sr = ctx.sampleRate
  let offset = ctx.args[1] ?? ctx.offset
  let duration = ctx.args[2] ?? ctx.duration
  if (offset == null) {
    return chs.map(ch => {
      let o = new Float32Array(ch.length * (times + 1))
      for (let i = 0; i <= times; i++) o.set(ch, i * ch.length)
      return o
    })
  }
  let s = Math.round(offset * sr)
  let e = duration != null ? s + Math.round(duration * sr) : chs[0].length
  let segLen = e - s
  return chs.map(ch => {
    let o = new Float32Array(ch.length + segLen * times)
    o.set(ch.subarray(0, s))
    for (let i = 0; i <= times; i++) o.set(ch.subarray(s, e), s + i * segLen)
    o.set(ch.subarray(e), s + (times + 1) * segLen)
    return o
  })
}

repeat.dur = (len, sr, args) => {
  let t = args[0] || 1, off = args[1], dur = args[2]
  if (off == null) return len * (t + 1)
  let s = off < 0 ? len / sr + off : off
  return len + (dur != null ? Math.round(dur * sr) : len - Math.round(s * sr)) * t
}

repeat.plan = (segs, total, sr, args) => {
  let off = args[1] != null ? Math.round((args[1] < 0 ? total / sr + args[1] : args[1]) * sr) : null
  let dur = args[2] != null ? Math.round(args[2] * sr) : null
  return repeatSegs(segs, args[0] || 1, total, off, dur)
}

export default (audio) => { audio.op.repeat = repeat }
