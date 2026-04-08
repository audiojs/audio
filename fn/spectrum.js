/**
 * Mel-frequency spectrum — FFT → mel-binned magnitudes.
 * Core analysis primitive for spectrum display, spectrogram, feature extraction.
 * Used by stat system (`a.stat('spectrum')`) and CLI playback visualization.
 */

import fft from 'fourier-transform'
import hann from 'window-function/hann'
import { a as aWeight } from 'a-weighting'

// ── Mel scale ───────────────────────────────────────────────────

export let toMel = f => 2595 * Math.log10(1 + f / 700)
export let fromMel = m => 700 * (10 ** (m / 2595) - 1)

// ── Window cache ────────────────────────────────────────────────

let windows = {}
function hannWin(n) {
  if (windows[n]) return windows[n]
  let w = new Float32Array(n)
  for (let i = 0; i < n; i++) w[i] = hann(i, n)
  return (windows[n] = w)
}

// ── Core ────────────────────────────────────────────────────────

/**
 * Compute mel-binned magnitude spectrum from a block of samples.
 * @param {Float32Array} samples — mono PCM block (length should be power of 2)
 * @param {number} sr — sample rate
 * @param {object} [opts]
 * @param {number} [opts.bins=128] — number of mel frequency bins
 * @param {number} [opts.fMin=30] — minimum frequency Hz
 * @param {number} [opts.fMax] — maximum frequency Hz (default: min(sr/2, 20000))
 * @param {boolean} [opts.weight=true] — apply A-weighting (perceptual loudness)
 * @returns {Float32Array} magnitude per mel bin (linear scale)
 */
export function melSpectrum(samples, sr, opts = {}) {
  let { bins = 128, fMin = 30, fMax = Math.min(sr / 2, 20000), weight = true, kWeight } = opts
  if (kWeight != null) weight = kWeight // back-compat
  let N = samples.length, win = hannWin(N)
  let buf = new Float32Array(N)
  for (let i = 0; i < N; i++) buf[i] = samples[i] * win[i]
  let mag = fft(buf)

  let mMin = toMel(fMin), mMax = toMel(fMax), binHz = sr / N
  let out = new Float32Array(bins)

  for (let b = 0; b < bins; b++) {
    let f0 = fromMel(mMin + (mMax - mMin) * b / bins)
    let f1 = fromMel(mMin + (mMax - mMin) * (b + 1) / bins)
    let k0 = Math.max(1, Math.floor(f0 / binHz))
    let k1 = Math.min(mag.length - 1, Math.ceil(f1 / binHz))
    let sum = 0, cnt = 0
    for (let k = k0; k <= k1; k++) { sum += mag[k] ** 2; cnt++ }
    let rms = cnt > 0 ? Math.sqrt(sum / cnt) : 0
    if (weight) rms *= aWeight((f0 + f1) / 2, sr)
    out[b] = rms
  }
  return out
}

/**
 * Compute mel-binned spectrum in dB from a block of samples.
 * @returns {Float32Array} dB per mel bin
 */
export function melSpectrumDb(samples, sr, opts = {}) {
  let mag = melSpectrum(samples, sr, opts)
  for (let i = 0; i < mag.length; i++) mag[i] = 20 * Math.log10(mag[i] + 1e-10)
  return mag
}

// ── Stat registration ───────────────────────────────────────────

import audio from '../core.js'

/** a.stat('spectrum', {bins}) → average mel spectrum in dB over range */
audio.fn.spectrum = async function(opts) {
  let bins = opts?.bins ?? 128
  let spectOpts = { bins, fMin: opts?.fMin, fMax: opts?.fMax, weight: opts?.weight }
  let sr = this.sampleRate
  let N = 1024  // FFT size

  let acc = new Float64Array(bins), cnt = 0
  let rem = new Float32Array(0)

  for await (let pcm of this.stream({ at: opts?.at, duration: opts?.duration })) {
    let ch0 = pcm[0]
    if (!ch0 || !ch0.length) continue

    let input = ch0
    if (rem.length) {
      input = new Float32Array(rem.length + ch0.length)
      input.set(rem, 0)
      input.set(ch0, rem.length)
    }

    let limit = input.length - (input.length % N)
    for (let off = 0; off < limit; off += N) {
      let block = input.subarray(off, off + N)
      let mag = melSpectrum(block, sr, spectOpts)
      for (let b = 0; b < bins; b++) acc[b] += mag[b] ** 2
      cnt++
    }

    rem = limit < input.length ? input.slice(limit) : new Float32Array(0)
  }

  if (cnt === 0) return new Float32Array(bins)
  let out = new Float32Array(bins)
  for (let b = 0; b < bins; b++) out[b] = 20 * Math.log10(Math.sqrt(acc[b] / cnt) + 1e-10)
  return out
}
