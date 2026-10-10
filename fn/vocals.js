/**
 * Vocals — vocal isolation / removal.
 *
 * a.vocals()          → isolate center (vocals) — keeps mid, discards side
 * a.vocals('remove')  → remove center (vocals) — keeps side, discards mid
 * a.vocals({ model: 'umxhq' })   → isolate by a separation model
 * a.vocals('remove', { model })  → the input minus the model's vocals
 *
 * SoX `oops` equivalent. Works on stereo material where vocals are panned center.
 * Mono input is passed through unchanged.
 *
 * `model` runs @audio/neural-separate (optional package, loaded on first use): 'mel-roformer' (Kim's
 * Mel-Band RoFormer, MIT weights, the vocals alone, on WebGPU where there is one: MUSDB18 previews' vocals
 * 12.08 dB SDR against SCNet-large's 11.00), 'scnet-large' or
 * 'scnet' (SCNet, MIT weights, hosted), 'umxhq' (Open-Unmix, MIT weights), 'htdemucs' or
 * 'htdemucs_ft' (Hybrid Transformer Demucs, weights for research only). The edit's whole input is
 * separated once before rendering and kept on the edit while that input stays the same. The two
 * modes add back to the input, sample for sample: a voice and the rest, each repaired on its own
 * and mixed, one model run between them (core.js memo). Weights are produced by the package's export scripts
 * into ~/.cache/audiojs/neural, or served from `weights` (a URL or directory); `device` picks
 * the ONNX Runtime backend. Mono separates as stereo; channels past the first two pass through.
 */

import { isolate, remove } from '@audio/vocals'
import audio, { arrived, memo } from '../core.js'

const SEPARATED = Symbol('vocals.separated')

const loadNeural = () => audio.import('@audio/neural-separate').catch(e => { throw new Error(`vocals({ model }): install @audio/neural-separate (${e.message})`) })

/** FNV-1a over the input's sample bits: the separation is reused while this matches (deepfilter's enhancement too). */
export function fingerprint(chs) {
  let h = 0x811c9dc5
  for (let ch of chs) { let u = new Uint32Array(ch.buffer, ch.byteOffset, ch.length); for (let i = 0; i < u.length; i++) h = Math.imul(h ^ u[i], 0x01000193) }
  return `${chs.length}:${chs[0]?.length ?? 0}:${h >>> 0}`
}

/** Separate the edit's input (the audio as the edits before it leave it), ahead of rendering. */
async function prepare(a, index) {
  let o = a.edits[index][1]
  if (!o?.model) return
  let { default: separate, models } = await loadNeural()
  if (!Object.hasOwn(models, o.model)) throw new Error(`vocals({ model }): unknown model '${o.model}', expected ${Object.keys(models).join(', ')}`)
  await arrived(a)
  // same instance state as last time: the input is too (read() and stream() both prepare)
  let stamp = `${a.version}:${a._.len}:${o.model}:${o.weights ?? ''}`, sep = o[SEPARATED]
  if (sep?.stamp === stamp) return
  let input = audio.from(a, { sampleRate: a._.sr })
  input.edits = a.edits.slice(0, index)
  input.version = index
  let pcm = await input.read()
  let key = `${o.model}:${o.weights ?? ''}:${fingerprint(pcm)}`
  if (sep?.key === key) { sep.stamp = stamp; return }
  // the separation kept by the model and its input (core.js memo): a reload, another tab, the mode changed, read it back
  let [l, r] = await memo(`vocals:${o.model}:${o.weights ?? ''}:${input.sampleRate}:${fingerprint(pcm)}`, async () =>
    (await separate(pcm.slice(0, 2), { sampleRate: input.sampleRate, model: o.model, targets: ['vocals'], weights: o.weights, device: o.device })).stems.vocals)
  o[SEPARATED] = { key, stamp, vocals: pcm.length === 1 ? [l.map((v, i) => (v + r[i]) / 2)] : [l, r] }
}

const vocals = (input, output, ctx) => {
  let mode = ctx.mode || 'isolate'
  for (let c = 0; c < input.length; c++) output[c].set(input[c])
  if (ctx.model) {
    let sep = ctx[SEPARATED]
    if (!sep) throw new Error('vocals({ model }): separation runs before rendering, through read(), stream() or save()')
    let len = input[0].length, off = Math.round((ctx.blockOffset || 0) * ctx.sampleRate)
    sep.vocals.forEach((v, c) => {
      for (let i = 0, j = off; i < len; i++, j++) { let s = j >= 0 && j < v.length ? v[j] : 0; output[c][i] = mode === 'remove' ? input[c][i] - s : s }
    })
    return
  }
  if (input.length < 2) return
  // isolate/remove mutate their two args in place; extra channels (already
  // copied above) are untouched since the kernel only sees output[0..1].
  ;(mode === 'remove' ? remove : isolate)([output[0], output[1]])
}

audio.op('vocals', { params: ['mode'], process: vocals, prepare })
