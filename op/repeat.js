import { planRepeat as repeatSegs } from './plan.js'

let repeat = (times) => (chs, { offset, duration, sampleRate: sr }) => {
  let t = times || 1
  if (offset == null) {
    return chs.map(ch => {
      let o = new Float32Array(ch.length * (t + 1))
      for (let i = 0; i <= t; i++) o.set(ch, i * ch.length)
      return o
    })
  }
  let s = Math.round(offset * sr)
  let e = duration != null ? s + Math.round(duration * sr) : chs[0].length
  let segLen = e - s
  return chs.map(ch => {
    let o = new Float32Array(ch.length + segLen * t)
    o.set(ch.subarray(0, s))
    for (let i = 0; i <= t; i++) o.set(ch.subarray(s, e), s + i * segLen)
    o.set(ch.subarray(e), s + (t + 1) * segLen)
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
  let s = off != null ? Math.round((off < 0 ? total / sr + off : off) * sr) : null
  return repeatSegs(segs, args[0] || 1, total, s, dur != null ? Math.round(dur * sr) : null)
}

export default repeat
