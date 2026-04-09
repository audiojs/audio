const CURVES = {
  linear: t => t,
  exp: t => t * t,
  log: t => Math.sqrt(t),
  cos: t => (1 - Math.cos(t * Math.PI)) / 2
}

const fade = (chs, ctx) => {
  let dur = ctx.args[0]
  let fn = CURVES[ctx.curve] ?? CURVES.linear
  let fadeIn = dur > 0, n = Math.abs(dur)
  let sr = ctx.sampleRate, blockOffset = ctx.blockOffset || 0
  let at = ctx.at != null ? ctx.at + blockOffset : undefined
  if (at != null && at < 0) at = ctx.totalDuration + at

  let totalSamples = Math.round((ctx.totalDuration || chs[0].length / sr + blockOffset) * sr)
  let fadeStart = at != null
    ? Math.round(at * sr)
    : fadeIn ? 0 : totalSamples - Math.round(n * sr)
  let samples = Math.round(n * sr)
  let chunkStart = Math.round(blockOffset * sr)
  for (let ch of chs)
    for (let i = 0; i < ch.length; i++) {
      let fi = chunkStart + i - fadeStart
      if (fi < 0 || fi >= samples) continue
      ch[i] *= fn(fadeIn ? fi / samples : 1 - fi / samples)
    }
  return chs
}

import audio from '../core.js'
audio.op('fade', fade, {
  call(std, ...a) {
    let last = a[a.length - 1]
    let opts = typeof last === 'object' ? a.pop()
      : typeof last === 'string' ? { curve: a.pop() } : null
    if (typeof a[a.length - 1] === 'string') opts = { ...opts, curve: a.pop() }
    let [inDur, outDur] = a

    if (outDur != null) {
      std.call(this, Math.abs(inDur), opts || {})
      return std.call(this, -Math.abs(outDur), opts || {})
    }
    return opts ? std.call(this, inDur, opts) : std.call(this, inDur)
  }
})
