import { planInsert as insertSegs, SILENCE } from '../plan.js'

const insert = (chs, ctx) => {
  let source = ctx.args[0], sr = ctx.sampleRate
  let offset = ctx.args[1] ?? ctx.offset
  let duration = ctx.duration
  let src = typeof source === 'number'
    ? Array.from({ length: chs.length }, () => new Float32Array(Math.round(source * sr)))
    : ctx.render(source)
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

insert.dur = (len, sr, args) => {
  let n = typeof args[0] === 'number' ? Math.round(args[0] * sr) : args[0]?.length || 0
  return len + n
}

insert.plan = (segs, total, sr, args) => {
  let source = args[0], at = args[1] != null ? Math.round(args[1] * sr) : total
  let iLen = typeof source === 'number' ? Math.round(source * sr) : source.length
  return insertSegs(segs, at, iLen, typeof source === 'number' ? null : source)
}

export default (audio) => { audio.op.insert = insert }
