const CURVES = { linear: t => t, exp: t => t * t, log: t => Math.sqrt(t), cos: t => (1 - Math.cos(t * Math.PI)) / 2 }

const fade = (dur, curve) => {
  let fn = CURVES[curve] ?? CURVES.linear
  let fadeIn = dur > 0, n = Math.abs(dur)

  return (chs, { offset, sampleRate: sr, blockOffset = 0 }) => {
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
}

export default (audio) => { audio.op('fade', fade) }
