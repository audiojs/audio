import { planInsert as insertSegs, SILENCE } from '../plan.js'

let insert = (source) => (chs, { offset, duration, sampleRate: sr, render }) => {
  let src = typeof source === 'number'
    ? Array.from({ length: chs.length }, () => new Float32Array(Math.round(source * sr)))
    : render(source)
  if (duration != null) {
    let n = Math.round(duration * sr)
    src = src.map(ch => ch.slice(0, n))
  }
  let p = Math.round((offset ?? chs[0].length / sr) * sr)
  return chs.map((ch, c) => {
    let ins = src[c] || new Float32Array(src[0].length)
    let o = new Float32Array(ch.length + ins.length)
    o.set(ch.subarray(0, p))
    o.set(ins, p)
    o.set(ch.subarray(p), p + ins.length)
    return o
  })
}

insert.dur = (len, sr, args, off, dur) => {
  let n = typeof args[0] === 'number' ? Math.round(args[0] * sr) : args[0]?.length || 0
  return len + (dur != null ? Math.min(n, Math.round(dur * sr)) : n)
}

insert.plan = (segs, total, sr, args, off, dur) => {
  let s = off != null ? Math.round((off < 0 ? total / sr + off : off) * sr) : null
  let source = args[0], at = s ?? total
  let iLen = typeof source === 'number' ? Math.round(source * sr) : source.length
  if (dur != null) iLen = Math.min(iLen, Math.round(dur * sr))
  return insertSegs(segs, at, iLen, typeof source === 'number' ? null : source)
}

export default (audio) => { audio.op('insert', insert) }
