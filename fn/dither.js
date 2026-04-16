/**
 * Dither — TPDF dithering for bit-depth reduction.
 *
 * a.dither(16)   → dither to 16-bit depth (default)
 * a.dither(8)    → dither to 8-bit depth
 *
 * Adds triangular probability density noise at ±1 LSB before quantization,
 * decorrelating quantization error from signal.
 */

const dither = (input, output, ctx) => {
  let bits = ctx.bits ?? 16
  let levels = (1 << (bits - 1)) - 1  // max positive value at target depth
  let inv = 1 / levels
  for (let c = 0; c < input.length; c++) {
    let inp = input[c], out = output[c]
    for (let i = 0; i < inp.length; i++) {
      // TPDF: sum of two uniform random values → triangular distribution, ±1 LSB
      let noise = (Math.random() - Math.random()) * inv
      out[i] = Math.round((inp[i] + noise) * levels) * inv
    }
  }
}

import audio from '../core.js'
audio.op('dither', { params: ['bits'], process: dither })
