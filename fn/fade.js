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

  // Adjustable fade: explicit start/end gain levels and/or mid-point skew
  // (mid = position of the half-amplitude point within the fade, 0..1).
  // Classic in/out fades (no levels) keep their legacy curve shapes.
  let { start, end, mid } = ctx
  let skew = mid > 0 && mid < 1 ? Math.log(0.5) / Math.log(mid) : 1
  let levels = start != null || end != null || skew !== 1
  let s0 = start ?? (fadeIn ? 0 : 1), s1 = end ?? (fadeIn ? 1 : 0)

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
      if (fi < 0 || fi >= samples) { out[i] = inp[i]; continue }
      let u = fi / samples
      out[i] = inp[i] * (levels
        ? s0 + (s1 - s0) * fn(skew === 1 ? u : u ** skew)
        : fn(fadeIn ? u : 1 - u))
    }
  }
}

import audio from '../core.js'
audio.op('fade', {
  params: ['in', 'out'],
  ranged: true,
  process: fade,
  expand: (ctx) => {
    if (typeof ctx.out !== 'number') return null
    let base = { ...(ctx.curve && { curve: ctx.curve }), ...(ctx.mid != null && { mid: ctx.mid }) }
    let edits = []
    if (typeof ctx.in === 'number') edits.push(['fade', { in: ctx.in, ...base }])
    edits.push(['fade', { in: -Math.abs(ctx.out), ...base }])
    return edits
  }
})
