import { planReverse as reverseSegs } from '../plan.js'

let reverse = () => (chs, { offset, duration, sampleRate: sr }) => {
  let s = offset != null ? Math.round(offset * sr) : 0
  let end = duration != null ? s + Math.round(duration * sr) : chs[0].length
  return chs.map(ch => { let o = new Float32Array(ch); o.subarray(s, Math.min(end, o.length)).reverse(); return o })
}

reverse.plan = (segs, total, sr, _, off, dur) => {
  let s = off != null ? Math.round((off < 0 ? total / sr + off : off) * sr) : 0
  return reverseSegs(segs, s, s + (dur != null ? Math.round(dur * sr) : total - s))
}

export default (audio) => { audio.op('reverse', reverse) }
