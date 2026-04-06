const mix = (chs, ctx) => {
  let source = ctx.args[0], sr = ctx.sampleRate
  let p = ctx.at != null ? Math.round(ctx.at * sr) : 0
  let src = ctx.render(source)
  return chs.map((ch, c) => {
    let o = new Float32Array(ch), m = src[c] || src[0]
    let n = ctx.duration != null ? Math.round(ctx.duration * sr) : m.length
    for (let i = 0; i < Math.min(n, m.length) && Math.max(0, p) + i < o.length; i++) o[Math.max(0, p) + i] += m[i]
    return o
  })
}

export default (audio) => { audio.op.mix = mix }
