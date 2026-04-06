const write = (chs, ctx) => {
  let data = ctx.args[0], sr = ctx.sampleRate
  let p = ctx.at != null ? Math.round(ctx.at * sr) : 0
  p = Math.max(0, p)
  return chs.map((ch, c) => {
    let o = new Float32Array(ch)
    let s = Array.isArray(data) ? (data[c] || data[0]) : data
    for (let i = 0; i < s.length && p + i < o.length; i++) o[p + i] = s[i]
    return o
  })
}

export default (audio) => { audio.op.write = write }
