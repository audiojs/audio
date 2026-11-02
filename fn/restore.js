/**
 * Restore — a voice back to a studio take, by a neural model.
 *
 * a.restore()                 → the model's take: the room, the noise, the codec and the missing top band gone, 48 kHz full band
 * a.restore(0.7)              → 70 % the model's, 30 % the input
 * a.restore({ weights, device })
 *
 * One network (@audio/neural-restore, optional package, loaded on first use; trained on English, French and Russian
 * speech and on singing, rooms, noise, microphones, codecs and band limits made on the fly) reads the STFT of the take
 * heard at −20 dBFS and writes the studio take's: a change of each bin's level, unbounded, so a band can come back from
 * nothing, and a turn of its phase. 17.9M parameters, 35 MB, one pass in runs of 10 s. On 24 degraded VoiceBank takes
 * (the package README's table): log-spectral distance 0.79 against deepfilter(0)'s 2.71, SI-SDR +6.0 dB against −2.1,
 * PESQ 2.40 against 2.07, DNSMOS OVRL 2.89 against 2.63 (the clean take's 2.95), the band to 24 kHz where deepfilter
 * leaves 16. Each channel apart, the edit's whole input once ahead of rendering, kept while that input stays the same.
 *
 * `strength` (1) mixes the input back: s · model + (1 − s) · input, for a take where damage is better than invention.
 * The weights are not hosted yet: in Node the neural cache's copy (the package's scripts/export.py writes it), in a page
 * /models/restore/restore.fp16.onnx on the page's own server, or `weights`.
 */

import audio, { arrived, memo } from '../core.js'
import { fingerprint } from './vocals.js'
import { playback } from './deepfilter.js'

const MADE = Symbol('restore.made')
// in a page or a worker: the copy its own server holds, until the weights are hosted
const LOCAL = globalThis.process?.release?.name !== 'node' && globalThis.location ? new URL('/models/restore/restore.fp16.onnx', globalThis.location.origin).href : undefined

/** The model's take of each channel of `pcm`, kept by its input (core.js memo). */
function restored(pcm, sampleRate, { weights = LOCAL, device } = {}) {
  return memo(`restore:${weights ?? ''}:${sampleRate}:${fingerprint(pcm)}`, async () => {
    let { default: restore } = await audio.import('@audio/neural-restore').catch(e => { throw new Error(`restore: install @audio/neural-restore (${e.message})`) })
    let out = []
    for (let x of pcm) out.push(await restore(x, { sampleRate, weights, backend: device }))
    return out
  })
}

// the options checked → the key of what they make of one input
function id(o) {
  let s = o.strength ?? 1
  if (typeof s !== 'number' || !(s >= 0 && s <= 1)) throw new TypeError(`restore: strength is 0 to 1, not ${s}`)
  return `${s}:${o.weights ?? ''}:${o.device ?? ''}`
}

/** The model's take of the edit's input (the audio as the edits before it leave it), ahead of rendering. */
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
  let s = o.strength ?? 1, made = pcm[0]?.length ? await restored(pcm, fs, o) : pcm
  if (s < 1) made = made.map((y, c) => {
    let x = pcm[c], z = new Float32Array(y.length)
    for (let i = 0; i < z.length; i++) z[i] = s * y[i] + (1 - s) * x[i]
    return z
  })
  o[MADE] = { key, stamp, pcm: made }
}

audio.op('restore', { params: ['strength'], prepare, process: playback('restore', MADE) })
