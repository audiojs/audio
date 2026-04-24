/**
 * Dither — TPDF dithering for bit-depth reduction.
 *
 * a.dither(16)               → TPDF dither to 16-bit (default)
 * a.dither(8)                → TPDF dither to 8-bit
 * a.dither(16, {shape:true}) → noise-shaping dither (push noise to high freq)
 *
 * Noise shaping: 2nd-order error feedback with NTF = (1 − z⁻¹)².
 * Quantization noise is high-pass shaped — audibly quieter at given bit depth.
 */

const dither = (input, output, ctx) => {
  let bits = ctx.bits ?? 16
  let levels = (1 << (bits - 1)) - 1
  let inv = 1 / levels

  // C(z) = 2z⁻¹ − z⁻²  ⇒  NTF = 1 − C(z) = (1 − z⁻¹)²
  if (ctx.shape) {
    if (!ctx._ditherState) ctx._ditherState = input.map(() => ({ e1: 0, e2: 0 }))
    for (let c = 0; c < input.length; c++) {
      let inp = input[c], out = output[c], st = ctx._ditherState[c]
      let e1 = st.e1, e2 = st.e2
      for (let i = 0; i < inp.length; i++) {
        let u = inp[i] - 2 * e1 + e2
        let y = Math.round((u + (Math.random() - Math.random()) * inv) * levels) * inv
        out[i] = y
        e2 = e1; e1 = y - u
      }
      st.e1 = e1; st.e2 = e2
    }
    return
  }
  for (let c = 0; c < input.length; c++) {
    let inp = input[c], out = output[c]
    for (let i = 0; i < inp.length; i++)
      out[i] = Math.round((inp[i] + (Math.random() - Math.random()) * inv) * levels) * inv
  }
}

import audio from '../core.js'
audio.op('dither', { params: ['bits'], process: dither })
