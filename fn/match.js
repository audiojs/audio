/**
 * Match: equalize toward a reference's tonal balance (match EQ).
 *
 * a.match(ref)                   → up to 8 parametric bands fitted to the reference/source spectrum ratio
 * a.match(ref, 0.6)              → partial match (amount 0..1)
 * a.match(ref, { bands: 12 })    → more bands
 *
 * Long-term average spectra of both (@audio/spectral-ltas, Welch 4096) are ⅓-octave smoothed;
 * their ratio, centered over 30 Hz–16 kHz, is fitted by @audio/eq-fit (peaks + edge
 * shelves, ±12 dB per band) and applied as a biquad cascade. Tone only: integrated loudness is
 * measured before and after and held. Whole-signal: the curve needs every frame of both.
 */
import audio from '../core.js'
import { peaking, lowshelf, highshelf, process as biquad, state } from '@audio/biquad'
import { lufs } from './loudness.js'

const FRAME = 4096, F0 = 30, F1 = 16000, TYPES = { peak: peaking, lowshelf, highshelf }

const mono = chs => {
  if (chs.length === 1) return chs[0]
  let n = chs[0].length, m = new Float32Array(n)
  for (let c of chs) for (let i = 0; i < n; i++) m[i] += c[i] / chs.length
  return m
}

/** ⅓-octave power-smoothed spectrum as f → dB (linear interpolation between bins). */
function spectrum(ltas, pcm, fs) {
  let mag = ltas(mono(pcm), { frameSize: FRAME }), n = mag.length
  let p = new Float64Array(n + 1)  // prefix sums of power
  for (let k = 0; k < n; k++) p[k + 1] = p[k] + mag[k] * mag[k]
  let db = new Float64Array(n), r = 2 ** (1 / 6)
  for (let k = 1; k < n; k++) {
    let lo = Math.max(1, Math.floor(k / r)), hi = Math.min(n - 1, Math.ceil(k * r))
    db[k] = 10 * Math.log10((p[hi + 1] - p[lo]) / (hi - lo + 1) + 1e-20)
  }
  db[0] = db[1]
  let silent = p[n] < 1e-12
  return silent ? null : f => {
    let x = Math.min(n - 1, Math.max(0, f * FRAME / fs)), k = Math.floor(x), t = x - k
    return k + 1 < n ? db[k] + (db[k + 1] - db[k]) * t : db[k]
  }
}

function match(input, output, ctx) {
  for (let c = 0; c < input.length; c++) output[c].set(input[c])
  let [{ default: ltas }, { default: fit }] = audio.op('match').mod
  let sr = ctx.sampleRate, ref = ctx.render(ctx.source)
  let src = spectrum(ltas, input, sr), dst = spectrum(ltas, ref, ctx.source.sampleRate ?? sr)
  if (!src || !dst) return  // nothing to match against

  // center the difference (mean over a log grid) so bands spend their ±12 dB on shape
  let N = 128, off = 0
  for (let i = 0; i < N; i++) { let f = F0 * (F1 / F0) ** (i / (N - 1)); off += dst(f) - src(f) }
  off /= N
  let amount = ctx.amount ?? 1
  let { bands } = fit(f => amount * (dst(f) - src(f) - off), { fs: sr, bands: ctx.bands ?? 8, fMin: F0, fMax: F1, preamp: false })

  for (let b of bands) {
    let co = TYPES[b.type](b.fc, b.Q, sr, b.gain)
    for (let c = 0; c < output.length; c++) biquad(output[c], co, state())
  }
  // tone only: hold integrated loudness (BS.1770) where it was
  let l0 = lufs(input, sr), l1 = lufs(output, sr)
  if (l0 != null && l1 != null) { let k = 10 ** ((l0 - l1) / 20); for (let ch of output) for (let i = 0; i < ch.length; i++) ch[i] *= k }
}

audio.op('match', {
  params: ['source', 'amount'],
  load: () => Promise.all([import('@audio/spectral-ltas'), import('@audio/eq-fit')]),
  whole: match,
})
