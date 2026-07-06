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
 * Triangular overlapping mel filterbank — Davis & Mermelstein (1980), HTK/librosa convention:
 * bins+2 mel-spaced points define `bins` filters, each a triangle spanning points [b, b+2] and
 * peaking (weight 1) at point b+1; per-filter output is the weighted-mean power, sqrt'd back to
 * a magnitude (HTK-style unnormalized weights, not slaney area-normalized).
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
  let { bins = 128, fMin = 30, fMax = Math.min(sr / 2, 20000), weight = true } = opts
  let N = samples.length, win = hannWin(N)
  let buf = new Float32Array(N)
  for (let i = 0; i < N; i++) buf[i] = samples[i] * win[i]
  let mag = fft(buf)

  let mMin = toMel(fMin), mMax = toMel(fMax), binHz = sr / N
  let out = new Float32Array(bins)

  let hz = new Float32Array(bins + 2)
  for (let i = 0; i < hz.length; i++) hz[i] = fromMel(mMin + (mMax - mMin) * i / (bins + 1))

  for (let b = 0; b < bins; b++) {
    let fLo = hz[b], fMid = hz[b + 1], fHi = hz[b + 2]
    let kLo = Math.max(1, Math.floor(fLo / binHz)), kHi = Math.min(mag.length - 1, Math.ceil(fHi / binHz))
    let sum = 0, wsum = 0
    for (let k = kLo; k <= kHi; k++) {
      let f = k * binHz
      let w = f <= fMid ? (f - fLo) / (fMid - fLo || 1) : (fHi - f) / (fHi - fMid || 1)
      if (w <= 0) continue
      sum += w * mag[k] ** 2
      wsum += w
    }
    let rms = wsum > 0 ? Math.sqrt(sum / wsum) : 0
    if (weight) rms *= aWeight(fMid, sr)
    out[b] = rms
  }
  return out
}


// ── Block analysis helper ───────────────────────────────────────

/** Stream ch0, buffer remainder, call fn(block, acc) per N-sample block. Returns {acc, cnt}. */
export async function analyzeBlocks(inst, opts, N, bins, fn) {
  let acc = new Float64Array(bins), cnt = 0, rem = new Float32Array(0)
  for await (let pcm of inst.stream({ at: opts?.at, duration: opts?.duration })) {
    let ch0 = pcm[0]
    if (!ch0 || !ch0.length) continue
    let input = ch0
    if (rem.length) {
      input = new Float32Array(rem.length + ch0.length)
      input.set(rem, 0)
      input.set(ch0, rem.length)
    }
    let limit = input.length - (input.length % N)
    for (let off = 0; off < limit; off += N) { fn(input.subarray(off, off + N), acc); cnt++ }
    rem = limit < input.length ? input.slice(limit) : new Float32Array(0)
  }
  return { acc, cnt }
}

// ── Stat registration ───────────────────────────────────────────

import audio from '../core.js'

audio.stat('spectrum', {})
audio.stat('centroid', {})
audio.stat('flatness', {})

/** a.stat('spectrum', {bins}) → average mel spectrum in dB over range */
audio.fn.spectrum = async function(opts) {
  let bins = opts?.bins ?? 128
  let spectOpts = { bins, fMin: opts?.fMin, fMax: opts?.fMax, weight: opts?.weight }
  let sr = this.sampleRate

  let { acc, cnt } = await analyzeBlocks(this, opts, 1024, bins, (block, acc) => {
    let mag = melSpectrum(block, sr, spectOpts)
    for (let b = 0; b < bins; b++) acc[b] += mag[b] ** 2
  })

  if (cnt === 0) return new Float32Array(bins)
  let out = new Float32Array(bins)
  for (let b = 0; b < bins; b++) out[b] = 20 * Math.log10(Math.sqrt(acc[b] / cnt) + 1e-10)
  return out
}

/** a.stat('centroid') → spectral centroid in Hz (brightness) */
audio.fn.centroid = async function(opts) {
  let sr = this.sampleRate, N = 1024, win = hannWin(N), buf = new Float32Array(N), binHz = sr / N
  let { acc, cnt } = await analyzeBlocks(this, opts, N, 1, (block, acc) => {
    for (let i = 0; i < N; i++) buf[i] = block[i] * win[i]
    let mag = fft(buf)
    let num = 0, den = 0
    for (let k = 1; k < mag.length; k++) { num += k * binHz * mag[k]; den += mag[k] }
    acc[0] += den > 0 ? num / den : 0
  })
  return cnt > 0 ? acc[0] / cnt : 0
}

/**
 * a.stat('flatness') → spectral flatness 0..1 (0=tonal, 1=noise)
 * Computed over the POWER spectrum (mag², not mag) — Peeters 2004 §6.6 "Spectral Flatness";
 * matches librosa.feature.spectral_flatness's default power=2.0 convention.
 */
audio.fn.flatness = async function(opts) {
  let N = 1024, win = hannWin(N), buf = new Float32Array(N)
  let { acc, cnt } = await analyzeBlocks(this, opts, N, 1, (block, acc) => {
    for (let i = 0; i < N; i++) buf[i] = block[i] * win[i]
    let mag = fft(buf), n = mag.length - 1
    let logSum = 0, linSum = 0
    for (let k = 1; k < mag.length; k++) { let p = mag[k] ** 2; logSum += Math.log(p + 1e-20); linSum += p }
    let gm = Math.exp(logSum / n), am = linSum / n
    acc[0] += am > 0 ? gm / am : 0
  })
  return cnt > 0 ? acc[0] / cnt : 0
}
