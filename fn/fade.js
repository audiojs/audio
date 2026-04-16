export const CURVES = {
  linear: t => t,
  exp: t => t * t,
  log: t => Math.sqrt(t),
  cos: t => (1 - Math.cos(t * Math.PI)) / 2
}

const fade = (input, output, ctx) => {
  let dur = ctx.in
  if (!dur) { for (let c = 0; c < input.length; c++) output[c].set(input[c]); return }
  let fn = CURVES[ctx.curve] ?? CURVES.linear
  let fadeIn = dur > 0, n = Math.abs(dur)
  let sr = ctx.sampleRate, blockOffset = ctx.blockOffset || 0
  let at = ctx.at != null ? ctx.at + blockOffset : undefined
  if (at != null && at < 0) at = ctx.totalDuration + at

  let totalSamples = Math.round((ctx.totalDuration || input[0].length / sr + blockOffset) * sr)
  let fadeStart = at != null
    ? Math.round(at * sr)
    : fadeIn ? 0 : totalSamples - Math.round(n * sr)
  let samples = Math.round(n * sr)
  let chunkStart = Math.round(blockOffset * sr)
  for (let c = 0; c < input.length; c++) {
    let inp = input[c], out = output[c]
    for (let i = 0; i < inp.length; i++) {
      let fi = chunkStart + i - fadeStart
      out[i] = (fi >= 0 && fi < samples) ? inp[i] * fn(fadeIn ? fi / samples : 1 - fi / samples) : inp[i]
    }
  }
}

import audio from '../core.js'
audio.op('fade', {
  params: ['in', 'out'],
  process: fade,
  resolve: (ctx) => {
    if (typeof ctx.out !== 'number') return null
    let base = ctx.curve ? { curve: ctx.curve } : {}
    let edits = []
    if (typeof ctx.in === 'number') edits.push(['fade', { in: ctx.in, ...base }])
    edits.push(['fade', { in: -Math.abs(ctx.out), ...base }])
    return edits
  }
})
