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
 *
 * Where the model's voice still carries a room, the model hears the take again with the room's linear prediction taken
 * off: @audio/denoise-dereverb's weighted prediction error (Nakatani et al., IEEE TASLP 2010) alone, `dereverb(x,
 * { strength: 0 })`, which cancels the part of the late tail the frames 43 to 150 ms before predict, linearly, the voice
 * untouched. Whether there is a room is dereverb's own question (no dry take, a diffuse tail, pauses, neither a held
 * partial nor a beat), asked of the model's output and of the take: asked of the take alone, a noise floor read as a
 * tail in a fifth of the noisy takes. DeepFilterNet3 trained with reverberant speech in a tenth of its mixtures and
 * takes part of a room; the input mixed back is the take itself. In MIT IR Survey rooms with noise 5 dB under the voice
 * (bench/rx/isolate.mjs, test split, 81 of 103 takes heard again) PESQ 1.77 → 1.81, SI-SDR 5.7 → 6.2 dB, DNSMOS OVRL
 * 2.42 → 2.44 (RX 12 Dialogue Isolate, its reverb off: 1.80, 7.2, 2.51); a voice under a music bed as loud as itself
 * 1.63 → 1.67, OVRL 2.33 → 2.44 (13 of 103); noise, babble, clean speech and music alone as they were (0 to 2 of 103),
 * VoiceBank+DEMAND (2 of 824, PESQ 3.045) and the ten narrations (2 of 10, OVRL 3.225 → 3.224) too. The question
 * costs a dereverb fit of the model's output, about 0.1 s per second at 48 kHz; a take heard again, one of the take
 * and a second model run.
 */

import audio, { arrived, memo } from '../core.js'
import dereverb from '@audio/denoise-dereverb'
import { fingerprint } from './vocals.js'

const LIMIT = 18

// What the model hears again where its voice y still carries a room: the take with the room's prediction off (dereverb's
// WPE alone) in each channel where dereverb would take a room off y and off the take (null: nowhere, y stands). Asked
// of the voice, not of the take, so a noise floor, which reads as a tail in the take, is not taken for a room. The last
// answer kept, so moving the limit or the floor fits no room again.
let last
const changed = (a, b) => a.some((v, i) => v !== b[i])
export function roomless(pcm, y, sampleRate) {
  let key = `${sampleRate}:${fingerprint(pcm)}:${fingerprint(y)}`
  if (last?.key === key) return last.heard
  let heard = pcm.map((x, c) => {
    if (!changed(dereverb(y[c], { fs: sampleRate, strength: 0 }), y[c])) return x
    return dereverb(x, { fs: sampleRate, strength: 0 })
  })
  last = { key, heard: heard.some((h, c) => changed(h, pcm[c])) ? heard : null }
  return last.heard
}

/**
 * An op of the edit's input x and DeepFilterNet3's whole removal y (unlimited), made once ahead of rendering: per
 * channel, `finish(x, y, o, sampleRate, neural)` (neural: the package's exports), the options it reads named by
 * `id(o)`, which also checks them. deepfilter's, and derustle's (fn/derustle.js); the model's output is shared.
 * `again(pcm, y, sampleRate)`, when given, makes what the model hears again from the input and its first output, or
 * null (deepfilter's: roomless()).
 */
export function enhancer(name, id, finish, again) {
  const ENHANCED = Symbol(name + '.enhanced')
  const loadNeural = () => audio.import('@audio/neural-denoise').catch(e => { throw new Error(`${name}: install @audio/neural-denoise (${e.message})`) })

  /** Enhance the edit's input (the audio as the edits before it leave it), ahead of rendering. */
  async function prepare(a, index) {
    let o = a.edits[index][1], music = o.music ?? 'pass', own = id(o)
    if (music !== 'pass' && music !== 'enhance') throw new TypeError(`${name}: music is 'pass' or 'enhance', not ${music}`)
    let neural = await loadNeural(), { default: denoise, load, MODEL } = neural
    await arrived(a)
    // the channels it runs on, in the order the engine hands them to process()
    let chs = o.channel == null ? null : [o.channel].flat(), key0 = `${own}:${music}:${o.weights ?? ''}:${chs ?? ''}`
    // same instance state as last time: the input is too (read() and stream() both prepare)
    let stamp = `${a.version}:${a._.len}:${key0}`, done = o[ENHANCED]
    if (done?.stamp === stamp) return
    let input = audio.from(a, { sampleRate: a._.sr })
    input.edits = a.edits.slice(0, index)
    input.version = index
    let pcm = await input.read()
    if (chs) pcm = chs.map(c => pcm[c])
    let key = `${key0}:${fingerprint(pcm)}`
    if (done?.key === key) { done.stamp = stamp; return }
    if (!pcm[0]?.length) { o[ENHANCED] = { key, stamp, pcm }; return }
    // the model's output kept by how it runs (heard at -20 dBFS, held voicing kept: neural-denoise 0.2; a band-limited
    // input's empty bands heard as a noise floor: 0.3; music passed or not: 0.4), the model and its input (core.js memo),
    // never by what is made of it after: a reload, another tab, the limit moved, another op on it, read it back
    let run = x => memo(`deepfilternet3:-20dBFS,voice,edge,music-${music}:${o.weights ?? ''}:${input.sampleRate}:${fingerprint(x)}`, async () => {
      let model = await load('deepfilternet3', { weights: o.weights, device: o.device }).catch(e => {
        throw new Error(`${name}: can't load DeepFilterNet3 from ${o.weights ?? MODEL} (${e.message}); it downloads once (8 MB) and is cached; { weights } takes another URL`)
      })
      try { return await denoise(x, { sampleRate: input.sampleRate, model, limit: 0, music }) }
      finally { model.free() }
    })
    let y = await run(pcm), heard = again?.(pcm, y, input.sampleRate)
    if (heard) y = await run(heard)
    o[ENHANCED] = { key, stamp, pcm: y.map((v, c) => finish(pcm[c], v, o, input.sampleRate, neural)) }
  }

  const process = (input, output, ctx) => {
    let done = ctx[ENHANCED]
    if (!done) throw new Error(`${name}: enhancement runs before rendering, through read(), stream() or save()`)
    let len = input[0].length, off = Math.round((ctx.blockOffset || 0) * ctx.sampleRate)
    for (let c = 0; c < input.length; c++) {
      let v = done.pcm[c], y = output[c]
      for (let i = 0, j = off; i < len; i++, j++) y[i] = j >= 0 && j < v.length ? v[j] : 0
    }
  }

  return { prepare, process }
}

audio.op('deepfilter', {
  params: ['limit'],
  ...enhancer('deepfilter', o => {
    let limit = o.limit ?? LIMIT, floor = o.floor
    if (typeof limit !== 'number' || !(limit >= 0)) throw new TypeError(`deepfilter: limit is dB, 0 or more (0: none), not ${limit}`)
    if (floor != null && (typeof floor !== 'number' || !(floor >= 0))) throw new TypeError(`deepfilter: floor is dB under the voice, 0 or more (0: none), not ${floor}`)
    return `${limit}:${floor ?? ''}`
  }, (x, y, o, sampleRate, { mixback }) => {
    let limit = o.limit ?? LIMIT
    if (!limit) return y
    if (!mixback) throw new Error('deepfilter: needs @audio/neural-denoise 0.5 or later (its mixback())')
    return mixback(x, y, { limit, floor: o.floor, sampleRate })
  }, roomless),
})
