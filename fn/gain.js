const gain = (chs, ctx) => {
  let val = ctx.args[0], sr = ctx.sampleRate
  let s = ctx.at != null ? Math.round(ctx.at * sr) : 0
  let end = ctx.duration != null ? s + Math.round(ctx.duration * sr) : chs[0].length
  let auto = typeof val === 'function', f = auto ? 0 : 10 ** (val / 20)
  let off = (ctx.blockOffset || 0) * sr
  return chs.map(ch => {
    let o = new Float32Array(ch)
    for (let i = Math.max(0, s); i < Math.min(end, o.length); i++)
      o[i] *= auto ? 10 ** (val((off + i) / sr) / 20) : f
    return o
  })
}

export default (audio) => { audio.op.gain = gain }
