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
  if (at != null && at < 0) at = (ctx.length || chs[0].length) / sr + at

  let totalSamples = ctx.length || chs[0].length + Math.round(blockOffset * sr)
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
audio.op('fade', fade)

const fadeEdits = (...a) => {
  let last = a[a.length - 1]
  let opts = typeof last === 'object' ? a.pop()
    : typeof last === 'string' ? { curve: a.pop() } : null
  if (typeof a[a.length - 1] === 'string') opts = { ...opts, curve: a.pop() }
  let [inDur, outDur] = a
  let curve = opts?.curve

  if (outDur != null) {
    let inEdit = { type: 'fade', args: [Math.abs(inDur)] }
    let outEdit = { type: 'fade', args: [-Math.abs(outDur)] }
    if (curve) { inEdit.curve = curve; outEdit.curve = curve }
    if (opts) {
      let { curve: _, ...rest } = opts
      if (Object.keys(rest).length) { Object.assign(inEdit, rest); Object.assign(outEdit, rest) }
    }
    return [inEdit, outEdit]
  }

  let edit = { type: 'fade', args: [inDur] }
  if (curve) edit.curve = curve
  if (opts) {
    if (opts.at != null) edit.at = opts.at
    if (opts.duration != null) edit.duration = opts.duration
    if (opts.channel != null) edit.channel = opts.channel
  }
  return edit
}

// wrap to desugar fade args (in/out durations, curve, options)
audio.fn.fade = Object.assign(
  function(...a) { return this.run(...[].concat(fadeEdits(...a))) },
  audio.fn.fade
)
