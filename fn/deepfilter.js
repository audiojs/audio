/**
 * Deepfilter — speech enhancement by DeepFilterNet3 (Schröter et al., Interspeech 2023).
 *
 * a.deepfilter()                 → the noise 45 dB under the voice, or 12 dB down if it already is: room tone stays
 * a.deepfilter(20)               → 20 dB down at least
 * a.deepfilter(12, -50)          → the noise 50 dB under the voice
 * a.deepfilter({ floor: false }) → 12 dB down, no further
 * a.deepfilter(0)                → no limit: pauses can fall to digital silence
 * a.deepfilter({ weights, device })
 *
 * Runs @audio/neural-denoise (optional package, loaded on first use); the model, upstream's ONNX export
 * (8 MB), downloads on first use and is cached. The edit's whole input is enhanced once before rendering, in
 * 10 s chunks: the model's activations stay one chunk's at any length, the input and the result are held whole
 * (as vocals({ model })). The result stays on the edit while that input stays the same: re-reads and later
 * edits reuse it; a live stream waits for its end. Channels are enhanced apart, at 48 kHz (other rates
 * resampled in and out), the model's 30 ms delay removed.
 *
 * The input x is mixed back into the model's unlimited output y: (1 − a)·y + a·x, a = 10^(−L/20), so the noise
 * drops by L dB (the package's `limit` mixes the same per STFT bin; equal to 1.3e-7). L is `limit` (12 dB) or,
 * where the noise sits closer to the voice, as much as brings it `floor` dB (−45) under the input's integrated
 * loudness (ITU-R BS.1770). The noise is what the model takes out, x − y, in the pauses: the quietest tenth of
 * y's 0.4 s windows at a 0.1 s hop (as ACX Check reads a floor), windows holding digital silence left out. On the
 * 824 VoiceBank+DEMAND test utterances (noise 2.5 to 17.5 dB under the voice) PESQ is 3.10, against 2.67 at a
 * fixed 12 dB and 3.16 unlimited; on ten home narrations the floor keeps the room tone as 12 dB did (quietest
 * 500 ms at −92 to −64 dBFS; unlimited, down to −152, the digital silence ACX Check flags), DNSMOS equal
 * (audio bench/speech.mjs). RNNoise streams: the `rnnoise` registry op, same package.
 */

import audio, { arrived } from '../core.js'
import { fingerprint } from './vocals.js'

const ENHANCED = Symbol('deepfilter.enhanced'), LIMIT = 12, FLOOR = -45

const loadNeural = () => audio.import('@audio/neural-denoise').catch(e => { throw new Error(`deepfilter: install @audio/neural-denoise (${e.message})`) })

/** dB the noise must drop to sit `floor` dB under `loudness` (LUFS): the removal x − y in the quietest tenth (at least
 *  one) of y's 0.4 s windows at a 0.1 s hop, channels' mean squares averaged; windows holding digital silence (10 ms
 *  of x under −90 dBFS) left out. null where no window is left. */
export function noiseDrop(x, y, sampleRate, loudness, floor) {
  let H = Math.round(sampleRate / 10), nb = Math.floor(x[0].length / H), nc = x.length
  let quiet = 10 ** (-90 / 20), minRun = Math.round(0.01 * sampleRate), run = 0
  let ey = new Float64Array(nb), en = new Float64Array(nb), dead = new Uint8Array(nb)
  for (let b = 0; b < nb; b++) for (let i = b * H; i < (b + 1) * H; i++) {
    let q = true
    for (let c = 0; c < nc; c++) {
      let u = x[c][i], v = y[c][i]
      ey[b] += v * v; en[b] += (u - v) * (u - v)
      if (u >= quiet || u <= -quiet) q = false
    }
    run = q ? run + 1 : 0
    if (run >= minRun) dead[b] = dead[Math.max(0, b - 1)] = 1
  }
  let w = []
  for (let b = 0; b + 4 <= nb; b++) if (!(dead[b] | dead[b + 1] | dead[b + 2] | dead[b + 3]))
    w.push([ey[b] + ey[b + 1] + ey[b + 2] + ey[b + 3], en[b] + en[b + 1] + en[b + 2] + en[b + 3]])
  if (!w.length) return null
  w.sort((p, q) => p[0] - q[0])
  let k = Math.ceil(w.length / 10), e = 0
  for (let j = 0; j < k; j++) e += w[j][1]
  return 10 * Math.log10(e / (k * 4 * H * nc) + 1e-30) - loudness - floor
}

/** The attenuation, dB: `limit` (0: none, Infinity), raised to what the noise needs to sit `floor` under the voice. */
export async function attenuation(x, y, sampleRate, limit, floor) {
  if (limit === 0) return Infinity
  if (floor == null || floor === false) return limit
  let loudness = await audio.from(x, { sampleRate }).stat('loudness')
  let need = Number.isFinite(loudness) ? noiseDrop(x, y, sampleRate, loudness, floor) : null
  return need > limit ? need : limit
}

/** Enhance the edit's input (the audio as the edits before it leave it), ahead of rendering. */
async function prepare(a, index) {
  let o = a.edits[index][1], limit = o.limit ?? LIMIT, floor = o.floor === undefined ? FLOOR : o.floor
  if (typeof limit !== 'number' || !(limit >= 0)) throw new TypeError(`deepfilter: limit is dB, 0 or more (0: none), not ${limit}`)
  if (floor !== false && floor !== null && !(floor < 0)) throw new TypeError(`deepfilter: floor is dB under the voice's loudness, below 0 (false: none), not ${floor}`)
  let { default: denoise, load, MODEL } = await loadNeural()
  await arrived(a)
  // the channels it runs on, in the order the engine hands them to process()
  let chs = o.channel == null ? null : [o.channel].flat(), id = `${limit}:${floor}:${o.weights ?? ''}:${chs ?? ''}`
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
  let model = await load('deepfilternet3', { weights: o.weights, device: o.device }).catch(e => {
    throw new Error(`deepfilter: can't load DeepFilterNet3 from ${o.weights ?? MODEL} (${e.message}); it downloads once (8 MB) and is cached; { weights } takes another URL`)
  })
  let y
  try { y = await denoise(pcm, { sampleRate: input.sampleRate, model, limit: 0 }) }
  finally { model.free() }
  let drop = await attenuation(pcm, y, input.sampleRate, limit, floor), g = drop === Infinity ? 0 : 10 ** (-drop / 20)
  o[ENHANCED] = { key, stamp, drop, pcm: g ? y.map((v, c) => v.map((s, i) => (1 - g) * s + g * pcm[c][i])) : y }
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

audio.op('deepfilter', { params: ['limit', 'floor'], process: deepfilter, prepare })
