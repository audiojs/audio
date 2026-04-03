import { planCrop as cropSegs } from '../plan.js'

let crop = () => (chs, { offset = 0, duration, sampleRate: sr }) => {
  let s = Math.round(offset * sr)
  let end = duration != null ? s + Math.round(duration * sr) : chs[0].length
  return chs.map(ch => ch.slice(s, Math.min(end, ch.length)))
}

crop.dur = (len, sr, _, off, dur) => {
  let s = off != null ? (off < 0 ? len / sr + off : off) : 0
  return dur != null ? Math.round(dur * sr) : len - Math.round(s * sr)
}

crop.plan = (segs, total, sr, _, off, dur) => {
  let s = off != null ? Math.round((off < 0 ? total / sr + off : off) * sr) : 0
  return cropSegs(segs, s, dur != null ? Math.round(dur * sr) : total - s)
}

export default (audio) => { audio.op('crop', crop) }
