import { planRemove as removeSegs } from './plan.js'

let remove = () => (chs, { offset = 0, duration = 0, sampleRate: sr }) => {
  let s = Math.round(offset * sr), d = Math.round(duration * sr)
  return chs.map(ch => {
    let o = new Float32Array(ch.length - d)
    o.set(ch.subarray(0, s))
    o.set(ch.subarray(s + d), s)
    return o
  })
}

remove.dur = (len, sr, _, off, dur) => len - Math.round((dur || 0) * sr)

remove.plan = (segs, total, sr, _, off, dur) => {
  let s = off != null ? Math.round((off < 0 ? total / sr + off : off) * sr) : 0
  return removeSegs(segs, s, Math.round((dur || 0) * sr))
}

export default remove
