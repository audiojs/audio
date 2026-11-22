/**
 * Dither — TPDF dithering for bit-depth reduction.
 *
 * a.dither(16)               → TPDF dither to 16-bit (default)
 * a.dither(8)                → TPDF dither to 8-bit
 * a.dither(16, {shape:true}) → noise-shaping dither (push noise to high freq)
 *
 * Noise shaping: 2nd-order error feedback with NTF = (1 − z⁻¹)².
 * Quantization noise is high-pass shaped — audibly quieter at given bit depth.
 *
 * The noise is a function of its place: sample i of channel c gets the same two draws on every render, whichever
 * block holds it, so a sound read twice, streamed, or read from its middle is one sound (Math.random gave each
 * render its own noise). The draws are a 32-bit integer hash of the place (lowbias32: C. Wellons, "Prospecting for
 * Hash Functions", 2018).
 */

const mix = x => { x ^= x >>> 16; x = Math.imul(x, 0x7feb352d); x ^= x >>> 15; x = Math.imul(x, 0x846ca68b); return (x ^ x >>> 16) >>> 0 }
/** TPDF noise of ±1 at sample i of the channel seeded `s`: the difference of two uniform draws */
const tpdf = (s, i) => (mix(s ^ 2 * i) - mix(s ^ 2 * i + 1)) / 4294967296

const dither = (input, output, ctx) => {
  let bits = ctx.bits ?? 16
  let levels = (1 << (bits - 1)) - 1
  let inv = 1 / levels
  // the block's first sample on the op's timeline
  let i0 = Math.round((ctx.blockOffset || 0) * ctx.sampleRate)

  // C(z) = 2z⁻¹ − z⁻²  ⇒  NTF = 1 − C(z) = (1 − z⁻¹)²
  if (ctx.shape) {
    if (!ctx._ditherState) ctx._ditherState = input.map(() => ({ e1: 0, e2: 0 }))
    for (let c = 0; c < input.length; c++) {
      let inp = input[c], out = output[c], st = ctx._ditherState[c], s = mix(c + 1)
      let e1 = st.e1, e2 = st.e2
      for (let i = 0; i < inp.length; i++) {
        let u = inp[i] - 2 * e1 + e2
        let y = Math.round((u + tpdf(s, i0 + i) * inv) * levels) * inv
        out[i] = y
        e2 = e1; e1 = y - u
      }
      st.e1 = e1; st.e2 = e2
    }
    return
  }
  for (let c = 0; c < input.length; c++) {
    let inp = input[c], out = output[c], s = mix(c + 1)
    for (let i = 0; i < inp.length; i++)
      out[i] = Math.round((inp[i] + tpdf(s, i0 + i) * inv) * levels) * inv
  }
}

import audio from '../core.js'
audio.op('dither', { params: ['bits'], process: dither })
