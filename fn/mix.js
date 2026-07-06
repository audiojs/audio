import { opRange, refLen, renderAt } from '../plan.js'

const mix = (input, output, ctx) => {
  let source = ctx.source, sr = ctx.sampleRate, chLen = input[0].length
  if (typeof source === 'number') throw new TypeError('mix: expected audio instance or Float32Array[], not a number')
  // Copy input→output first
  for (let c = 0; c < input.length; c++) output[c].set(input[c])
  let sLen = refLen(source, sr)
  let [s, end] = opRange(ctx, chLen)
  let srcOff = Math.max(0, -s), dstOff = Math.max(0, s)
  let n = Math.min(sLen - srcOff, chLen - dstOff, end - dstOff)
  if (n <= 0) return
  let src = renderAt(ctx.render, source, srcOff, n, sr)
  for (let c = 0; c < output.length; c++) {
    let m = src[c % src.length]
    for (let i = 0; i < n; i++) output[c][dstOff + i] += m[i]
  }
}

import audio from '../core.js'
audio.op('mix', { params: ['source'], ranged: true, process: mix })
