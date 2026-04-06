/**
 * Cepstrum — mel-frequency cepstral coefficients (MFCCs).
 * FFT → mel bands → log → DCT-II. Used for pitch/timbre analysis.
 */

import { melSpectrum } from './spectrum.js'

// ── Core ────────────────────────────────────────────────────────

/**
 * Compute MFCCs from a block of samples.
 * @param {Float32Array} samples — mono PCM block (power-of-2 length)
 * @param {number} sr — sample rate
 * @param {object} [opts]
 * @param {number} [opts.bins=13] — number of cepstral coefficients
 * @param {number} [opts.nMel=40] — number of mel filterbank bands
 * @returns {Float32Array} cepstral coefficients
 */
export function mfcc(samples, sr, opts = {}) {
  let { bins = 13, nMel = 40 } = opts
  let mag = melSpectrum(samples, sr, { bins: nMel, weight: false })

  // Log mel energies
  let logMel = new Float32Array(nMel)
  for (let i = 0; i < nMel; i++) logMel[i] = Math.log(mag[i] ** 2 + 1e-10)

  // DCT-II → cepstral coefficients
  let out = new Float32Array(bins)
  for (let k = 0; k < bins; k++) {
    let sum = 0
    for (let n = 0; n < nMel; n++) sum += logMel[n] * Math.cos(Math.PI * k * (2 * n + 1) / (2 * nMel))
    out[k] = sum
  }
  return out
}

// ── Stat registration ───────────────────────────────────────────

export default (audio) => {
  /** a.stat('cepstrum', {bins}) → average MFCCs over range */
  audio.fn.cepstrum = async function(opts) {
    let bins = opts?.bins ?? 13
    let sr = this.sampleRate
    let N = 1024

    let pcm = await this.read({ at: opts?.at, duration: opts?.duration })
    let ch0 = pcm[0]

    let acc = new Float64Array(bins), cnt = 0
    for (let off = 0; off < ch0.length - N; off += N) {
      let block = ch0.subarray(off, off + N)
      let c = mfcc(block, sr, { bins })
      for (let k = 0; k < bins; k++) acc[k] += c[k]
      cnt++
    }

    if (cnt === 0) return new Float32Array(bins)
    let out = new Float32Array(bins)
    for (let k = 0; k < bins; k++) out[k] = acc[k] / cnt
    return out
  }
}
