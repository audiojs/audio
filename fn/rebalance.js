/**
 * Rebalance: a song's vocals, bass, drums and the rest, each at its own level (iZotope RX Music Rebalance).
 *
 * a.rebalance(6)                              → the vocals 6 dB up
 * a.rebalance({ vocals: -6, drums: 3 })       → the vocals down, the drums up
 * a.rebalance(-Infinity)                      → the vocals gone: a karaoke track
 * a.rebalance(0, -Infinity, -Infinity, -Infinity) → the vocals alone
 * a.rebalance(0, 0, -Infinity, 0, { model: 'htdemucs' })
 *
 * Gains in dB, in RX's order: vocals, bass, drums, other; −Infinity mutes. A separation model splits the edit's input
 * into the four stems, s, and the output is the input plus each stem's change, x + Σ (g − 1)·s: 0 dB each leaves the
 * input sample for sample, and what the model gives no stem stays at its level. Runs @audio/neural-separate
 * (optional package, loaded on first use); `model` 'scnet-large' by default (SCNet-large, Tong et al., ICASSP 2024,
 * MIT weights), 'scnet' (a quarter of its size, a third of its time), 'htdemucs' or 'htdemucs_ft' (weights for
 * research only), 'umxhq' (Open-Unmix, MIT). Its weights are exported once by the package's scripts into
 * ~/.cache/audiojs/neural, or served from `weights` (a URL or directory); `device` picks the ONNX Runtime backend. The
 * whole input is separated once before rendering and kept on the edit while it stays the same (core.js memo: gains
 * moved, the stems are read back). Mono separates as stereo; channels past the first two pass through.
 * On MUSDB18's 50 test previews (bench/rx/separate.mjs), each stem soloed, BSSEval v4 SDR, the median over songs,
 * vocals · bass · drums · other: 10.75 · 8.17 · 10.30 · 6.94 dB; RX 12 Music Rebalance at Best 10.89 · 9.66 · 9.85 ·
 * 6.45, behind on 33, 32, 38 and 32 of the songs; the vocals 6 dB up 20.2 dB against RX's 19.5.
 */

import audio, { arrived, memo } from '../core.js'
import { fingerprint } from './vocals.js'

const STEMS = ['vocals', 'bass', 'drums', 'other'], MODEL = 'scnet-large', SEPARATED = Symbol('rebalance.separated')

const loadNeural = () => audio.import('@audio/neural-separate').catch(e => { throw new Error(`rebalance: install @audio/neural-separate (${e.message})`) })
const lin = db => db == null ? 1 : 10 ** (db / 20)

function check(o) {
  for (let s of STEMS) if (o[s] != null && !(typeof o[s] === 'number' && o[s] === o[s] && o[s] < Infinity)) throw new TypeError(`rebalance: ${s} is dB (−Infinity mutes it), not ${o[s]}`)
}

/** Separate the edit's input (the audio as the edits before it leave it) into its stems, ahead of rendering. */
async function prepare(a, index) {
  let o = a.edits[index][1], model = o.model ?? MODEL
  check(o)
  // every gain 0 dB: the input as it is, nothing to separate
  if (STEMS.every(s => lin(o[s]) === 1)) return
  let { default: separate, models } = await loadNeural()
  if (!Object.hasOwn(models, model)) throw new Error(`rebalance: unknown model '${model}', expected ${Object.keys(models).join(', ')}`)
  await arrived(a)
  // same instance state as last time: the input is too (read() and stream() both prepare)
  let stamp = `${a.version}:${a._.len}:${model}:${o.weights ?? ''}`, sep = o[SEPARATED]
  if (sep?.stamp === stamp) return
  let input = audio.from(a, { sampleRate: a._.sr })
  input.edits = a.edits.slice(0, index)
  input.version = index
  let pcm = await input.read(), key = `${model}:${o.weights ?? ''}:${fingerprint(pcm)}`
  if (sep?.key === key) { sep.stamp = stamp; return }
  // the stems kept by the model and its input (core.js memo), never by the gains: moved, they are read back
  let stems = await memo(`stems:${model}:${o.weights ?? ''}:${input.sampleRate}:${fingerprint(pcm)}`, async () => {
    let { stems } = await separate(pcm.slice(0, 2), { sampleRate: input.sampleRate, model, weights: o.weights, device: o.device })
    return STEMS.flatMap(s => stems[s])
  })
  // stem s, channel c at 2s + c; a mono input heard as the mean of the two
  let at = (s, c) => stems[2 * STEMS.indexOf(s) + c]
  o[SEPARATED] = { key, stamp, stems: Object.fromEntries(STEMS.map(s => [s, pcm.length === 1 ? [at(s, 0).map((v, i) => (v + at(s, 1)[i]) / 2)] : [at(s, 0), at(s, 1)]])) }
}

const rebalance = (input, output, ctx) => {
  for (let c = 0; c < input.length; c++) output[c].set(input[c])
  let moves = STEMS.map(s => [s, lin(ctx[s]) - 1]).filter(([, d]) => d)
  if (!moves.length) return
  let sep = ctx[SEPARATED]
  if (!sep) throw new Error('rebalance: separation runs before rendering, through read(), stream() or save()')
  let len = input[0].length, off = Math.round((ctx.blockOffset || 0) * ctx.sampleRate)
  for (let [s, d] of moves) sep.stems[s].forEach((v, c) => {
    for (let i = 0, j = off; i < len; i++, j++) if (j >= 0 && j < v.length) output[c][i] += d * v[j]
  })
}

audio.op('rebalance', { params: STEMS, process: rebalance, prepare })
