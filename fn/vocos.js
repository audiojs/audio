/**
 * Vocos — a voice made again from its mel spectrogram, by a neural vocoder.
 *
 * a.vocos()                  → made again by Vocos below 11 kHz, the input kept above
 * a.vocos({ crossover: 0 })  → Vocos's alone: nothing above 12 kHz
 * a.vocos({ weights, device })
 *
 * Vocos (Siuzdak, ICLR 2024, arXiv:2306.00814; charactr's vocos-mel-24khz, MIT, trained on LibriTTS) predicts each STFT
 * frame's magnitude and phase from a 24 kHz mel spectrogram, by @audio/neural-vocode (optional package, loaded on first
 * use; the model, 27 MB, downloads once and is cached). So what another vocoder left in a voice gives way to Vocos's
 * own: a TTS's frames ringing on, the faint copies of each frame 10, 20, 30 ms later that its phase rebuilt slightly
 * differently leaves (a 36 s TTS take: its cepstrum's peaks at 20 and 30 ms, 0.020 and 0.010, down to 0.0003 and 0.0005,
 * the background's level). Each channel apart, the edit's whole input once ahead of rendering, kept while that input
 * stays the same.
 *
 * Vocos makes nothing above 12 kHz. Above `crossover` Hz (11000) the input is kept: Vocos's below through a Linkwitz-Riley
 * lowpass, the input above through its highpass, the two summing flat; 0 takes Vocos's alone. A speech vocoder: music,
 * and tones of exact period (their spectrum's floor far under any recording's), come back altered or silent.
 */

import audio, { arrived, memo } from '../core.js'
import { fingerprint } from './vocals.js'
import { playback } from './deepfilter.js'
import { highpass, lowpass } from '@audio/filter/biquad'

const CROSSOVER = 11000, TOP = 12000
const MADE = Symbol('vocos.made')

/** Vocos's take of each channel of `pcm`, kept by its input (core.js memo). */
function vocoded(pcm, sampleRate, { weights, device } = {}) {
  return memo(`vocos:${weights ?? ''}:${sampleRate}:${fingerprint(pcm)}`, async () => {
    let { default: vocode } = await audio.import('@audio/neural-vocode').catch(e => { throw new Error(`vocos: install @audio/neural-vocode (${e.message})`) })
    let out = []
    for (let x of pcm) out.push(await vocode(x, { sampleRate, weights, backend: device }))
    return out
  })
}

// x through two Butterworth sections at f: a Linkwitz-Riley 4th order (`pass`: lowpass or highpass), a copy
function lr4(pass, x, f, fs) {
  let y = Float32Array.from(x)
  for (let k = 0; k < 2; k++) pass(y, { fc: f, fs, Q: Math.SQRT1_2 })
  return y
}

// the options checked → the key of what they make of one input
function id(o) {
  let f = o.crossover ?? CROSSOVER
  if (typeof f !== 'number' || !(f >= 0 && f <= TOP)) throw new TypeError(`vocos: crossover is Hz, 0 to ${TOP} (Vocos makes nothing above), not ${f}`)
  return `${f}:${o.weights ?? ''}:${o.device ?? ''}`
}

/** Vocos's take of the edit's input (the audio as the edits before it leave it), ahead of rendering. */
async function prepare(a, index) {
  let o = a.edits[index][1], own = id(o)
  await arrived(a)
  let chs = o.channel == null ? null : [o.channel].flat(), key0 = `${own}:${chs ?? ''}`
  // same instance state as last time: the input is too (read() and stream() both prepare)
  let stamp = `${a.version}:${a._.len}:${key0}`, done = o[MADE]
  if (done?.stamp === stamp) return
  let input = audio.from(a, { sampleRate: a._.sr })
  input.edits = a.edits.slice(0, index)
  input.version = index
  let pcm = await input.read(), fs = input.sampleRate
  if (chs) pcm = chs.map(c => pcm[c])
  let key = `${key0}:${fingerprint(pcm)}`
  if (done?.key === key) { done.stamp = stamp; return }
  let f = o.crossover ?? CROSSOVER, made = pcm[0]?.length ? await vocoded(pcm, fs, o) : pcm
  // the input above the crossover, where Vocos has nothing or little (none to keep below Nyquist: Vocos's alone)
  if (pcm[0]?.length && f > 0 && f < fs / 2) made = made.map((v, c) => {
    let lo = lr4(lowpass, v, f, fs), hi = lr4(highpass, pcm[c], f, fs)
    for (let i = 0; i < lo.length; i++) lo[i] += hi[i]
    return lo
  })
  o[MADE] = { key, stamp, pcm: made }
}

audio.op('vocos', { params: [], prepare, process: playback('vocos', MADE) })
