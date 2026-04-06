import { cropSegs } from './crop.js'

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

const repeat = (chs, ctx) => {
  let times = ctx.args[0] || 1, sr = ctx.sampleRate
  let at = ctx.at, dur = ctx.duration
  if (at == null) {
    return chs.map(ch => {
      let o = new Float32Array(ch.length * (times + 1))
      for (let i = 0; i <= times; i++) o.set(ch, i * ch.length)
      return o
    })
  }
  let s = Math.max(0, Math.round(at * sr))
  let e = dur != null ? s + Math.round(dur * sr) : chs[0].length
  let segLen = e - s
  return chs.map(ch => {
    let o = new Float32Array(ch.length + segLen * times)
    o.set(ch.subarray(0, s))
    for (let i = 0; i <= times; i++) o.set(ch.subarray(s, e), s + i * segLen)
    o.set(ch.subarray(e), s + (times + 1) * segLen)
    return o
  })
}

repeat.dur = (len, sr, args, off, dur) => {
  let t = args[0] || 1
  if (off == null) return len * (t + 1)
  let s = off < 0 ? len / sr + off : off
  return len + (dur != null ? Math.round(dur * sr) : len - Math.round(s * sr)) * t
}

repeat.plan = (segs, total, sr, args, off, dur) => {
  let offSamples = off != null ? Math.round((off < 0 ? total / sr + off : off) * sr) : null
  let durSamples = dur != null ? Math.round(dur * sr) : null
  return repeatSegs(segs, args[0] || 1, total, offSamples, durSamples)
}

export default (audio) => { audio.op.repeat = repeat }
