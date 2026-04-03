const mix = (chs, ctx) => {
  let source = ctx.args[0], sr = ctx.sampleRate
  let offset = ctx.args[1] ?? ctx.offset
  let duration = ctx.args[2] ?? ctx.duration
  let p = offset != null ? Math.round(offset * sr) : 0
  let src = ctx.render(source)
  return chs.map((ch, c) => {
    let o = new Float32Array(ch), m = src[c] || src[0]
    let n = duration != null ? Math.round(duration * sr) : m.length
    for (let i = 0; i < Math.min(n, m.length) && p + i < o.length; i++) o[p + i] += m[i]
    return o
  })
}

export default (audio) => { audio.op('mix', mix) }
