/**
 * Deepfilter — speech enhancement by DeepFilterNet3 (Schröter et al., Interspeech 2023).
 *
 * a.deepfilter()                 → quiet noise 18 dB down, room tone kept; noise near the voice down to 40 dB under it
 * a.deepfilter(12)               → gentler: quiet noise 12 dB down
 * a.deepfilter({ floor: 0 })     → every noise 18 dB down and no further, as before neural-denoise 0.5
 * a.deepfilter(0)                → no limit: the model's whole removal, pauses can fall to digital silence
 * a.deepfilter({ music: 'enhance' }) → music too (by default it passes through untouched)
 * a.deepfilter({ weights, device })
 *
 * Runs @audio/neural-denoise (optional package, loaded on first use); the model, upstream's ONNX export
 * (8 MB), downloads on first use and is cached. The edit's whole input is enhanced once before rendering, in
 * 10 s chunks: the model's activations stay one chunk's at any length, the input and the result are held whole
 * (as vocals({ model })). The result stays on the edit while that input stays the same: re-reads and later
 * edits reuse it; a live stream waits for its end. Channels are enhanced apart, at 48 kHz (other rates
 * resampled in and out), the model's 30 ms delay removed.
 *
 * The input x is mixed back into the model's unlimited output y by the package's mixback(): y + a·(x − y), the noise
 * the model took back at gain a. a = 10^(−limit/20): the noise drops by `limit` dB, 18 by default, the most before the
 * voice itself suffers (on VoiceBank+DEMAND DNSMOS SIG holds from 12 to 18 dB and falls past it), room tone kept: on
 * ten home narrations it stays at −93 to −59 dBFS. Where the noise stands closer to the voice than `floor` dB, 40 by
 * default, a falls until it lies there, frame by frame (the noise's power over 0.5 s against the voice's level).
 * Before neural-denoise 0.5 every noise went `limit` dB down and no further, so noise as loud as the voice stayed
 * 18 dB under it, where iZotope RX 12 Dialogue Isolate takes it all: in noise at −5, 0 and 5 dB SNR (bench/rx/
 * isolate.mjs, test split) PESQ 1.73, 2.07, 2.44 against RX's 2.00, 2.28, 2.56; with the floor 2.11, 2.43, 2.70, DNSMOS
 * SIG 3.21 to 3.39 against RX's 3.07 to 3.33. VoiceBank+DEMAND PESQ 3.05 (2.90 before, RX 2.72); the narrations'
 * DNSMOS the same to 0.001 (package README, Measured). The package hears the input with its speech at −20 dBFS (the
 * model is not level-free: quiet takes kept their noise, after a stretch of digital silence most), keeps the
 * sustained voicing the model takes for noise (VocalSet's held notes come out 1.9 dB down instead of 39; in noise at
 * 15 dB SNR, 3.4), and from 0.3 has the model hear the bands a band-limited input left empty (a 16 kHz file, a
 * codec's low-pass) as the noise floor it trained with, not as silence it never heard: VoiceBank+DEMAND at 16 kHz,
 * PESQ 2.83 instead of 2.72 at 18 dB; full-band and 44.1 kHz input as before. From 0.4 music passes through
 * untouched (`music: 'pass'`, the default): a speech/music/noise classifier (inaSpeechSegmenter's CNN, Doukhan et
 * al., ICASSP 2018) segments the input as ina does, and the model's output is kept only where it hears speech or
 * noise, the gain ramped over 200 ms at each switch; the model took 8 to 16 dB from every band of music. Speech
 * over a music bed counts as speech, songs as music (package README, Music); from 0.5 speech is favoured by 1 nat a
 * patch, as the stream decides, so a voice under a bed as loud as itself passes untouched in 37% of its frames, not
 * 51%. `music: 'enhance'` enhances everything, as before. RNNoise streams: the `rnnoise` registry op, same package.
 */

import audio, { arrived, memo } from '../core.js'
import { fingerprint } from './vocals.js'

const ENHANCED = Symbol('deepfilter.enhanced'), LIMIT = 18

const loadNeural = () => audio.import('@audio/neural-denoise').catch(e => { throw new Error(`deepfilter: install @audio/neural-denoise (${e.message})`) })

/** Enhance the edit's input (the audio as the edits before it leave it), ahead of rendering. */
async function prepare(a, index) {
  let o = a.edits[index][1], limit = o.limit ?? LIMIT, floor = o.floor, music = o.music ?? 'pass'
  if (typeof limit !== 'number' || !(limit >= 0)) throw new TypeError(`deepfilter: limit is dB, 0 or more (0: none), not ${limit}`)
  if (floor != null && (typeof floor !== 'number' || !(floor >= 0))) throw new TypeError(`deepfilter: floor is dB under the voice, 0 or more (0: none), not ${floor}`)
  if (music !== 'pass' && music !== 'enhance') throw new TypeError(`deepfilter: music is 'pass' or 'enhance', not ${music}`)
  let { default: denoise, load, MODEL, mixback } = await loadNeural()
  await arrived(a)
  // the channels it runs on, in the order the engine hands them to process()
  let chs = o.channel == null ? null : [o.channel].flat(), id = `${limit}:${floor ?? ''}:${music}:${o.weights ?? ''}:${chs ?? ''}`
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
  // input's empty bands heard as a noise floor: 0.3; music passed or not: 0.4), the model and its input (core.js memo),
  // never by the limit or the floor, applied after it: a reload, another tab, the limit moved, read it back
  let y = await memo(`deepfilternet3:-20dBFS,voice,edge,music-${music}:${o.weights ?? ''}:${input.sampleRate}:${fingerprint(pcm)}`, async () => {
    let model = await load('deepfilternet3', { weights: o.weights, device: o.device }).catch(e => {
      throw new Error(`deepfilter: can't load DeepFilterNet3 from ${o.weights ?? MODEL} (${e.message}); it downloads once (8 MB) and is cached; { weights } takes another URL`)
    })
    try { return await denoise(pcm, { sampleRate: input.sampleRate, model, limit: 0, music }) }
    finally { model.free() }
  })
  if (limit && !mixback) throw new Error('deepfilter: needs @audio/neural-denoise 0.5 or later (its mixback())')
  o[ENHANCED] = { key, stamp, pcm: limit ? y.map((v, c) => mixback(pcm[c], v, { limit, floor, sampleRate: input.sampleRate })) : y }
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
