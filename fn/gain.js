const gain = (chs, ctx) => {
  let db = ctx.args[0], f = 10 ** (db / 20), sr = ctx.sampleRate
  let offset = ctx.args[1] ?? ctx.offset
  let duration = ctx.args[2] ?? ctx.duration
  let s = offset != null ? Math.round(offset * sr) : 0
  let end = duration != null ? s + Math.round(duration * sr) : chs[0].length
  return chs.map(ch => {
    let o = new Float32Array(ch)
    for (let i = s; i < Math.min(end, o.length); i++) o[i] *= f
    return o
  })
}

export default (audio) => { audio.op.gain = gain }
