/**
 * Similar: the other places that sound like a given one (iZotope RX Find Similar).
 *
 * await a.similar({ at: 12.3, duration: 0.4 })                    → [{ at, duration, score }], each one like it, in time order
 * await a.similar({ at: 12.3, duration: 0.2, band: [800, 1300] }) → a beep: only its band compared, the speech under it not
 * await a.similar({ at: 12.3, duration: 0.4 }, { threshold: 0.5 }) → looser: more found, some less alike
 * await a.stat('similar', { at: 12.3, duration: 0.4 })             → the same, as a stat
 *
 * Select one cough, click, bark or beep, and the rest of them are found, to repair or mark each. The sound is read as a
 * log-mel spectrogram (frames of 23 ms, a quarter-frame hop, 40 mel bands from 30 Hz, the channels' mean power), each
 * band as how far it stands over its own median, in dB (0 where it is under: the background, whatever it is, counts for
 * nothing). The selection's patch of it (every frame reaching into it, so a click's holds the quiet either side; its
 * bands within `band`, if given) is slid along the whole and compared at every hop by Pearson's correlation over the
 * patch: the same shape of energy over time and frequency, at any level within the background's reach. Each local best
 * within half the selection's length that reaches `threshold` (0.7) is one, as long as the selection; the selection
 * itself is not among them. A match starts within a hop (6 ms at 44.1 kHz) of its event.
 * Planted in a voice (audio-lena, test/rx.js), up to 10 dB apart: coughs (each a fresh draw of noise) find each other at
 * 0.88 and over, nothing else over 0.26; clicks at 0.72 and over, nothing else over 0.55; barks 0.85, nothing else over
 * 0.46; beeps, the voice going on under them, in their band, 0.82 and over, nothing else over 0.66.
 */
import audio, { parseTime, named } from '../core.js'
import { melSpectrum, melEdges } from './spectrum.js'

const FRAME = 0.023, BANDS = 40, FLOOR = 80, THRESHOLD = 0.7

/** Frame f is the N samples from f·H (Hann); its BANDS mel bands in dB over each band's median over the whole (the floor
 *  FLOOR dB under the loudest band anywhere), 0 where under it. */
async function spectrogram(a) {
  let sr = a.sampleRate, N = 2 ** Math.round(Math.log2(FRAME * sr)), H = N / 4, rows = [], ring = null, n = 0, top = 0
  for await (let block of a.stream()) {
    ring ??= block.map(() => new Float32Array(N))
    for (let i = 0; i < block[0].length; i++, n++) {
      for (let c = 0; c < block.length; c++) ring[c][n & (N - 1)] = block[c][i]
      if (n + 1 < N || (n + 1 - N) % H) continue
      let frame = ring.map(r => Float32Array.from({ length: N }, (_, k) => r[(n + 1 - N + k) & (N - 1)]))
      let p = Float64Array.from(melSpectrum(frame, sr, { bins: BANDS, weight: false }), v => v * v)
      for (let v of p) if (v > top) top = v
      rows.push(p)
    }
  }
  let F = rows.length, floor = top * 10 ** (-FLOOR / 10) || 1e-30, S = new Float32Array(F * BANDS), col = new Float32Array(F)
  for (let b = 0; b < BANDS; b++) {
    for (let f = 0; f < F; f++) col[f] = S[f * BANDS + b] = 10 * Math.log10(rows[f][b] + floor)
    let mid = col.sort()[F >> 1]
    for (let f = 0; f < F; f++) S[f * BANDS + b] = Math.max(0, S[f * BANDS + b] - mid)
  }
  return { S, F, N, H, sr }
}

/** Where the patch of frames [f0, f0 + K) × bands [b0, b1] of S recurs: Pearson's correlation at every frame, its local
 *  bests from `threshold` at least K/2 apart, the patch itself left out; [[frame, r]]. */
export function recur(S, F, f0, K, threshold = THRESHOLD, b0 = 0, b1 = BANDS - 1) {
  let B = b1 - b0 + 1, n = K * B, T = new Float64Array(n), mean = 0, tn = 0
  for (let k = 0, i = 0; k < K; k++) for (let b = b0; b <= b1; b++, i++) mean += T[i] = S[(f0 + k) * BANDS + b]
  mean /= n
  for (let i = 0; i < n; i++) { T[i] -= mean; tn += T[i] * T[i] }
  if (!(tn > 0) || F < K) return []
  // each window's sum and sum of squares, from running totals over frames
  let sum = new Float64Array(F + 1), sq = new Float64Array(F + 1)
  for (let f = 0; f < F; f++) { let s = 0, q = 0; for (let b = b0; b <= b1; b++) { let v = S[f * BANDS + b]; s += v; q += v * v } sum[f + 1] = sum[f] + s; sq[f + 1] = sq[f] + q }
  let r = new Float64Array(F - K + 1)
  for (let t = 0; t <= F - K; t++) {
    let x = 0
    for (let k = 0, i = 0; k < K; k++) { let o = (t + k) * BANDS + b0; for (let b = 0; b < B; b++, i++) x += T[i] * S[o + b] }
    let s = sum[t + K] - sum[t], v = sq[t + K] - sq[t] - s * s / n
    r[t] = v > 1e-9 * n ? x / Math.sqrt(tn * v) : 0
  }
  let out = [], R = Math.max(1, K >> 1)
  for (let t = 0; t < r.length; t++) {
    if (r[t] < threshold || Math.abs(t - f0) < R) continue
    let best = true
    for (let u = Math.max(0, t - R); best && u <= Math.min(r.length - 1, t + R); u++) if (r[u] > r[t] || r[u] === r[t] && u < t) best = false
    if (best) out.push([t, r[t]])
  }
  return out
}

audio.fn.similar = async function(range, opts) {
  let { at, duration, band, threshold = THRESHOLD } = { ...named(range), ...named(opts) }
  at = parseTime(at); duration = parseTime(duration)
  if (at == null || !(duration > 0)) throw new TypeError('similar: needs the sound to look for, { at, duration }')
  if (!(threshold > -1 && threshold <= 1)) throw new RangeError(`similar: threshold is a correlation, up to 1, not ${threshold}`)
  if (band != null && !(Array.isArray(band) && band.length === 2 && band[0] < band[1])) throw new TypeError(`similar: band is [low, high] Hz, not ${JSON.stringify(band)}`)
  let { S, F, N, H, sr } = await spectrogram(this)
  if (at < 0) at = Math.max(0, this.duration + at)
  // the selection's frames: every one that reaches into it, so a click's patch holds the quiet either side of it (a
  // cough's, sustained, does not); its bands: those centred in `band`, or the one nearest its middle
  let f0 = Math.max(0, Math.ceil((at * sr - N + 1) / H)), f1 = Math.min(F - 1, Math.floor(((at + duration) * sr - 1) / H))
  if (f1 < f0) return []
  let b0 = 0, b1 = BANDS - 1
  if (band) {
    let mid = melEdges(BANDS, sr).slice(1, -1), inside = mid.flatMap((f, b) => f >= band[0] && f <= band[1] ? [b] : [])
    if (inside.length) [b0, b1] = [inside[0], inside.at(-1)]
    else { let c = Math.sqrt(Math.max(band[0], 1) * band[1]); b0 = b1 = mid.reduce((m, f, b) => Math.abs(Math.log(f / c)) < Math.abs(Math.log(mid[m] / c)) ? b : m, 0) }
  }
  return recur(S, F, f0, f1 - f0 + 1, threshold, b0, b1).map(([t, score]) => ({ at: Math.max(0, at + (t - f0) * H / sr), duration, score }))
}
audio.stat('similar', {})
