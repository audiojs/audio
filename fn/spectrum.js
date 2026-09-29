/**
 * Mel-frequency spectrum — FFT → mel-binned magnitudes.
 * Core analysis primitive for spectrum display, spectrogram, feature extraction.
 * Used by stat system (`a.stat('spectrum')`) and CLI playback visualization.
 */

import fft from 'fourier-transform'
import hann from 'window-function/hann'
import aWeighting from '@audio/weighting-a'

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
 * Magnitude spectrum of a Hann-windowed block; of one block per channel, the root of their mean power: a stereo
 * signal's spectrum, where the spectrum of the channels' mean sample would cancel what is out of phase.
 * The result is valid until the next call.
 * @param {Float32Array|Float32Array[]} block – mono PCM block, or one per channel (power-of-2 length)
 * @returns {Float64Array} N/2 magnitudes
 */
export function magnitude(block) {
  let chs = ArrayBuffer.isView(block) ? [block] : block, N = chs[0].length, win = hannWin(N)
  let buf = scratch[N] ??= new Float32Array(N), pow
  for (let ch of chs) {
    for (let i = 0; i < N; i++) buf[i] = ch[i] * win[i]
    let mag = fft(buf)
    if (chs.length === 1) return mag
    pow ??= (pows[N] ??= new Float64Array(mag.length)).fill(0)
    for (let k = 0; k < mag.length; k++) pow[k] += mag[k] ** 2
  }
  for (let k = 0; k < pow.length; k++) pow[k] = Math.sqrt(pow[k] / chs.length)
  return pow
}

let scratch = {}, pows = {}

/**
 * Compute mel-binned magnitude spectrum from a block of samples.
 * Triangular overlapping mel filterbank — Davis & Mermelstein (1980), HTK/librosa convention:
 * bins+2 mel-spaced points define `bins` filters, each a triangle spanning points [b, b+2] and
 * peaking (weight 1) at point b+1; per-filter output is the weighted-mean power, sqrt'd back to
 * a magnitude (HTK-style unnormalized weights, not slaney area-normalized).
 * @param {Float32Array|Float32Array[]} samples – mono PCM block, or one per channel (see magnitude); power-of-2 length
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
  let mag = magnitude(samples), N = mag.length * 2

  let bank = melBank(N, sr, bins, fMin, fMax, weight)
  let out = new Float32Array(bins)
  for (let b = 0; b < bins; b++) {
    let { k, w, wsum, gain } = bank[b], sum = 0
    for (let j = 0; j < k.length; j++) sum += w[j] * mag[k[j]] ** 2
    let rms = wsum > 0 ? Math.sqrt(sum / wsum) : 0
    if (weight) rms *= gain
    out[b] = rms
  }
  return out
}

/** The filterbank for a block size, rate and band layout, built once rather than per block: per band
 *  the FFT bins it covers, their triangle weights and sum, and the A-weighting gain at its center. */
let banks = new Map()
function melBank(N, sr, bins, fMin, fMax, weight) {
  let key = `${N} ${sr} ${bins} ${fMin} ${fMax} ${weight}`, bank = banks.get(key)
  if (bank) return bank
  let mMin = toMel(fMin), mMax = toMel(fMax), binHz = sr / N, last = (N >> 1) - 1
  let hz = new Float32Array(bins + 2)
  for (let i = 0; i < hz.length; i++) hz[i] = fromMel(mMin + (mMax - mMin) * i / (bins + 1))
  bank = []
  for (let b = 0; b < bins; b++) {
    let fLo = hz[b], fMid = hz[b + 1], fHi = hz[b + 2]
    let kLo = Math.max(1, Math.floor(fLo / binHz)), kHi = Math.min(last, Math.ceil(fHi / binHz))
    let k = [], w = [], wsum = 0
    for (let j = kLo; j <= kHi; j++) {
      let f = j * binHz
      let v = f <= fMid ? (f - fLo) / (fMid - fLo || 1) : (fHi - f) / (fHi - fMid || 1)
      if (v <= 0) continue
      k.push(j); w.push(v); wsum += v
    }
    // digital response at the actual rate (a-weighting ignored its sr arg)
    bank.push({ k: Int32Array.from(k), w: Float64Array.from(w), wsum, gain: weight ? aWeighting.response(fMid, sr) : 1 })
  }
  banks.set(key, bank)
  return bank
}


// ── Block analysis helper ───────────────────────────────────────

/** Stream the chosen channels (all by default), buffer remainders, call fn(blocks, acc) per N-sample block, one block
 *  per channel. Returns {acc, cnt}. */
export async function analyzeBlocks(inst, opts, N, bins, fn) {
  let acc = new Float64Array(bins), cnt = 0, rem = []
  for await (let all of inst.stream({ at: opts?.at, duration: opts?.duration })) {
    let pcm = pickChannels(all, opts?.channel)
    if (!pcm[0]?.length) continue
    let input = pcm.map((ch, c) => {
      if (!rem[c]?.length) return ch
      let x = new Float32Array(rem[c].length + ch.length)
      x.set(rem[c], 0)
      x.set(ch, rem[c].length)
      return x
    })
    let len = input[0].length, limit = len - (len % N)
    for (let off = 0; off < limit; off += N) { fn(input.map(x => x.subarray(off, off + N)), acc); cnt++ }
    rem = input.map(x => x.slice(limit))
  }
  return { acc, cnt }
}

// ── Stat registration ───────────────────────────────────────────

import audio, { pickChannels, perChannel } from '../core.js'

audio.stat('spectrum', {})
audio.stat('centroid', {})
audio.stat('flatness', {})

/** a.stat('spectrum', {bins}) → average mel spectrum in dB over range, of the channels' mean power */
audio.fn.spectrum = perChannel(async function(opts) {
  let bins = opts?.bins ?? 128
  let spectOpts = { bins, fMin: opts?.fMin, fMax: opts?.fMax, weight: opts?.weight }
  let sr = this.sampleRate

  let { acc, cnt } = await analyzeBlocks(this, opts, 1024, bins, (blocks, acc) => {
    let mag = melSpectrum(blocks, sr, spectOpts)
    for (let b = 0; b < bins; b++) acc[b] += mag[b] ** 2
  })

  if (cnt === 0) return new Float32Array(bins)
  let out = new Float32Array(bins)
  for (let b = 0; b < bins; b++) out[b] = 20 * Math.log10(Math.sqrt(acc[b] / cnt) + 1e-10)
  return out
})

/** a.stat('centroid') → spectral centroid in Hz (brightness) */
audio.fn.centroid = perChannel(async function(opts) {
  let sr = this.sampleRate, N = 1024, binHz = sr / N
  let { acc, cnt } = await analyzeBlocks(this, opts, N, 1, (blocks, acc) => {
    let mag = magnitude(blocks)
    let num = 0, den = 0
    for (let k = 1; k < mag.length; k++) { num += k * binHz * mag[k]; den += mag[k] }
    acc[0] += den > 0 ? num / den : 0
  })
  return cnt > 0 ? acc[0] / cnt : 0
})

/**
 * a.stat('flatness') → spectral flatness 0..1 (0=tonal, 1=noise)
 * Computed over the POWER spectrum (mag², not mag) — Peeters 2004 §6.6 "Spectral Flatness";
 * matches librosa.feature.spectral_flatness's default power=2.0 convention.
 */
audio.fn.flatness = perChannel(async function(opts) {
  let { acc, cnt } = await analyzeBlocks(this, opts, 1024, 1, (blocks, acc) => {
    let mag = magnitude(blocks), n = mag.length - 1
    let logSum = 0, linSum = 0
    for (let k = 1; k < mag.length; k++) { let p = mag[k] ** 2; logSum += Math.log(p + 1e-20); linSum += p }
    let gm = Math.exp(logSum / n), am = linSum / n
    acc[0] += am > 0 ? gm / am : 0
  })
  return cnt > 0 ? acc[0] / cnt : 0
})
