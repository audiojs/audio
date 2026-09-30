import { opRange, refLen, renderAt } from '../plan.js'
import './pad.js'

// Overwrite from `at` with samples (Float32Array[], or one Float32Array for every channel) or another sound (an
// instance, as mix() takes one), each channel from the source's channel of the same number, or its last. What runs past
// the end extends it, as a tape records on: expand pads the end out first.
const write = (input, output, ctx) => {
  let data = ArrayBuffer.isView(ctx.data) ? [ctx.data] : ctx.data, sr = ctx.sampleRate, len = input[0].length
  for (let c = 0; c < input.length; c++) output[c].set(input[c])
  let [s, end] = opRange(ctx, len), srcOff = Math.max(0, -s), dstOff = Math.max(0, s)
  let n = Math.min(refLen(data, sr) - srcOff, len - dstOff, end - dstOff)
  if (n <= 0) return
  let src = renderAt(ctx.render, data, srcOff, n, sr)
  for (let c = 0; c < output.length; c++) output[c].set(src[Math.min(c, src.length - 1)].subarray(0, n), dstOff)
}

import audio from '../core.js'
audio.op('write', {
  params: ['data'],
  ranged: true,
  expand: ctx => {
    let data = ctx.data
    if (data == null || typeof data !== 'object') throw new TypeError('write: expected samples (Float32Array[]) or a sound to write')
    let at = ctx.at ?? 0, over = at + refLen(ArrayBuffer.isView(data) ? [data] : data, ctx.sampleRate) / ctx.sampleRate - ctx.totalDuration
    return over > 0 ? [['pad', { before: 0, after: over }], ['write', { data, at }]] : null
  },
  process: write
})
