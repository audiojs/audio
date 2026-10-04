/**
 * Deepfilter — speech enhancement by DeepFilterNet3 (Schröter et al., Interspeech 2023).
 *
 * a.deepfilter()                 → the noise down 18 dB at most: room tone stays, the voice keeps its sound
 * a.deepfilter(12)               → gentler: 12 dB at most
 * a.deepfilter(0)                → no limit: the model's whole removal, pauses can fall to digital silence
 * a.deepfilter({ weights, device })
 *
 * Runs @audio/neural-denoise (optional package, loaded on first use); the model, upstream's ONNX export
 * (8 MB), downloads on first use and is cached. The edit's whole input is enhanced once before rendering, in
 * 10 s chunks: the model's activations stay one chunk's at any length, the input and the result are held whole
 * (as vocals({ model })). The result stays on the edit while that input stays the same: re-reads and later
 * edits reuse it; a live stream waits for its end. Channels are enhanced apart, at 48 kHz (other rates
 * resampled in and out), the model's 30 ms delay removed.
 *
 * The input x is mixed back into the model's unlimited output y: (1 − a)·y + a·x, a = 10^(−limit/20), so nothing
 * drops by more than `limit` dB (upstream's atten_lim_db; the package's `limit` mixes the same per STFT bin). 18 dB
 * is the most before the voice itself suffers: on VoiceBank+DEMAND (noise 2.5 to 17.5 dB under the voice) DNSMOS
 * SIG holds from 12 to 18 dB and falls past it, the voice filtered, while BAK and PESQ rise (PESQ 2.90 at 18, 3.15
 * unlimited, 2.67 at 12); on ten home narrations OVRL equals the unlimited output's, room tone left at −93 to −59
 * dBFS (package README, Accuracy). The package hears the input with its speech at −20 dBFS (the model is not
 * level-free: quiet takes kept their noise, after a stretch of digital silence most), keeps the sustained voicing
 * the model takes for noise (VocalSet's held notes come out 1.9 dB down instead of 39; in noise at 15 dB SNR, 3.4),
 * and from 0.3 has the model hear the bands a band-limited input left empty (a 16 kHz file, a codec's low-pass) as
 * the noise floor it trained with, not as silence it never heard: VoiceBank+DEMAND at 16 kHz, PESQ 2.83 instead of
 * 2.72 at 18 dB; full-band and 44.1 kHz input as before. Speech only: music loses 8 to 16 dB in every band, and
 * nothing tells it from noisy speech well enough to pass it through. RNNoise streams: the `rnnoise` registry op,
 * same package.
 */

import audio, { arrived, memo } from '../core.js'
import { fingerprint } from './vocals.js'

const ENHANCED = Symbol('deepfilter.enhanced'), LIMIT = 18

const loadNeural = () => audio.import('@audio/neural-denoise').catch(e => { throw new Error(`deepfilter: install @audio/neural-denoise (${e.message})`) })

/** Enhance the edit's input (the audio as the edits before it leave it), ahead of rendering. */
async function prepare(a, index) {
  let o = a.edits[index][1], limit = o.limit ?? LIMIT
  if (typeof limit !== 'number' || !(limit >= 0)) throw new TypeError(`deepfilter: limit is dB, 0 or more (0: none), not ${limit}`)
  let { default: denoise, load, MODEL } = await loadNeural()
  await arrived(a)
  // the channels it runs on, in the order the engine hands them to process()
  let chs = o.channel == null ? null : [o.channel].flat(), id = `${limit}:${o.weights ?? ''}:${chs ?? ''}`
  // same instance state as last time: the input is too (read() and stream() both prepare)
  let stamp = `${a.version}:${a._.len}:${id}`, done = o[ENHANCED]
  if (done?.stamp === stamp) return
  let input = audio.from(a, { sampleRate: a._.sr })
  input.edits = a.edits.slice(0, index)
  input.version = index
  let pcm = await input.read()
  if (chs) pcm = chs.map(c => pcm[c])
  let key = `${id}:${fingerprint(pcm)}`
  if (done?.key === key) { done.stamp = stamp; return }
  if (!pcm[0]?.length) { o[ENHANCED] = { key, stamp, pcm }; return }
  // the model's output kept by how it runs (heard at -20 dBFS, held voicing kept: neural-denoise 0.2; a band-limited
  // input's empty bands heard as a noise floor: 0.3), the model and its input (core.js memo), never by the limit,
  // applied after it: a reload, another tab, the limit moved, read it back
  let y = await memo(`deepfilternet3:-20dBFS,voice,edge:${o.weights ?? ''}:${input.sampleRate}:${fingerprint(pcm)}`, async () => {
    let model = await load('deepfilternet3', { weights: o.weights, device: o.device }).catch(e => {
      throw new Error(`deepfilter: can't load DeepFilterNet3 from ${o.weights ?? MODEL} (${e.message}); it downloads once (8 MB) and is cached; { weights } takes another URL`)
    })
    try { return await denoise(pcm, { sampleRate: input.sampleRate, model, limit: 0 }) }
    finally { model.free() }
  })
  let g = limit ? 10 ** (-limit / 20) : 0
  o[ENHANCED] = { key, stamp, pcm: g ? y.map((v, c) => v.map((s, i) => (1 - g) * s + g * pcm[c][i])) : y }
}

const deepfilter = (input, output, ctx) => {
  let done = ctx[ENHANCED]
  if (!done) throw new Error('deepfilter: enhancement runs before rendering, through read(), stream() or save()')
  let len = input[0].length, off = Math.round((ctx.blockOffset || 0) * ctx.sampleRate)
  for (let c = 0; c < input.length; c++) {
    let v = done.pcm[c], y = output[c]
    for (let i = 0, j = off; i < len; i++, j++) y[i] = j >= 0 && j < v.length ? v[j] : 0
  }
}

audio.op('deepfilter', { params: ['limit'], process: deepfilter, prepare })
