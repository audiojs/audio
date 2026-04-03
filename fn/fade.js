const CURVES = { linear: t => t, exp: t => t * t, log: t => Math.sqrt(t), cos: t => (1 - Math.cos(t * Math.PI)) / 2 }

const fade = (chs, ctx) => {
  let dur = ctx.args[0], curve = ctx.args[1]
  let fn = CURVES[curve] ?? CURVES.linear
  let fadeIn = dur > 0, n = Math.abs(dur)
  let sr = ctx.sampleRate, blockOffset = ctx.blockOffset || 0
  let offset = ctx.offset

  let fadeStart = offset != null
    ? Math.round((offset + blockOffset) * sr)
    : fadeIn ? Math.round(blockOffset * sr) : chs[0].length - Math.round(n * sr)
  let samples = Math.round(n * sr)
  let chunkStart = Math.round(blockOffset * sr)
  return chs.map(ch => {
    let o = new Float32Array(ch)
    for (let i = 0; i < o.length; i++) {
      let fi = chunkStart + i - fadeStart
      if (fi < 0 || fi >= samples) continue
      o[i] *= fn(fadeIn ? fi / samples : 1 - fi / samples)
    }
    return o
  })
}

export default (audio) => { audio.op('fade', fade) }
