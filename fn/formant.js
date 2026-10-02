/**
 * Formant — move a sound's formants, the peaks of its spectral envelope (a voice's vowels, the size of the head it
 * comes from), without its pitch.
 *
 * a.formant(3)                  → formants 3 semitones up: a smaller, brighter voice, the same notes
 * a.formant(-2, { at: 1, d: 2 }) → 1–3 s, 2 semitones down: larger, darker
 *
 * semitones > 0 = up: a number, a curve { t, v } (seconds of the timeline → semitones, straight between points, flat
 * past its ends) or t => semitones, each frame read at its middle. Any sound, a voice above all; with pitch() it keeps a voice its own (pitch up, formants back
 * down), or makes it another's (Praat's Change gender: both).
 * Each STFT frame (2048 samples, 46 ms at 44.1 kHz, a quarter-frame hop; @audio/stft) keeps its phases and harmonics;
 * its envelope, the true envelope (Röbel & Rodet, DAFx 2005: cepstral smoothing raised to the spectrum's peaks, six
 * passes, quefrencies under 1.8 ms, so a voice up to 400 Hz keeps its harmonics out of it), is stretched along
 * frequency by the ratio, each bin scaled by the stretched envelope over its own, the frame's energy kept. Against
 * a vowel made with its formants moved (Peterson & Barney's /a/ through Klatt resonators, Rosenberg pulses at 110 and
 * 220 Hz, +3 and −4 semitones), its harmonics under 5 kHz land within 0.7 to 1.4 dB of it in the median, where the
 * vowel left as it was is 8.6 to 9.4 dB off (test/pro.js). Where the shift is 0 a frame is its input, so a range
 * meets the sound around it without a seam; the STFT runs over the range only (spectral()'s).
 */
import audio from '../core.js'
import { isCurve, curveFn } from '../plan.js'
import { regionStft } from './spectral.js'
import { fft, ifft } from 'fourier-transform'

// true envelope: passes, and its quefrency cutoff in seconds
const PASSES = 6, QUEFRENCY = .0018

// The envelope of a frame's log magnitudes `lm` (bins 0…half of an N-point FFT) into `env`: its cepstrum kept up to
// `order`, raised to the spectrum wherever the spectrum stands over it, again (true envelope)
function envelope(lm, env, N, order, s) {
  let half = N >> 1
  s.a.set(lm)
  for (let pass = 0; pass < PASSES; pass++) {
    s.im.fill(0)
    let cep = ifft(s.a, s.im)
    s.lift.fill(0)
    s.lift[0] = cep[0]
    for (let q = 1; q < order; q++) { s.lift[q] = cep[q]; s.lift[N - q] = cep[N - q] }
    let [re] = fft(s.lift)
    for (let k = 0; k <= half; k++) env[k] = re[k]
    if (pass + 1 < PASSES) for (let k = 0; k <= half; k++) s.a[k] = Math.max(lm[k], env[k])
  }
}

function formant(input, output, ctx) {
  let sr = ctx.sampleRate, s = ctx.semitones
  // a curve at the frame's time; a number read live, so a value patched in during playback takes
  let semi = isCurve(s) ? curveFn(s) : typeof s === 'function' ? s : () => +ctx.semitones || 0
  regionStft(input, output, ctx, audio.op('formant').mod, (mag, phase, mid, { s0, s1 }, st) => {
    let v = mid >= s0 && mid < s1 ? semi(mid / sr) : 0
    if (!v) return { mag, phase }
    let N = (mag.length - 1) * 2, half = N >> 1, r = 2 ** (v / 12)
    if (!st.env) Object.assign(st, { lm: new Float64Array(half + 1), env: new Float64Array(half + 1), out: new Float64Array(half + 1), a: new Float64Array(half + 1), im: new Float64Array(half + 1), lift: new Float64Array(N) })
    let { lm, env, out } = st
    for (let k = 0; k <= half; k++) lm[k] = Math.log(mag[k] + 1e-9)
    envelope(lm, env, N, Math.max(2, Math.round(QUEFRENCY * sr)), st)
    // each bin by the envelope r times lower over its own: what stood at f / r stands at f
    let e0 = 0, e1 = 0
    for (let k = 0; k <= half; k++) {
      let x = k / r, i = Math.floor(x), f = x - i, e = i >= half ? env[half] : env[i] + (env[i + 1] - env[i]) * f
      out[k] = mag[k] * Math.exp(e - env[k])
      e0 += mag[k] * mag[k]; e1 += out[k] * out[k]
    }
    let g = e1 > 0 ? Math.sqrt(e0 / e1) : 1
    for (let k = 0; k <= half; k++) out[k] *= g
    return { mag: out, phase }
  })
}

audio.op('formant', {
  params: ['semitones'],
  ranged: true,
  // a curve reaches the op as is: each frame reads it at its own time
  fnArgs: ['semitones'],
  latency: 2048,
  warmup: 3 * 2048,
  load: () => import('@audio/stft'),
  process: formant
})
