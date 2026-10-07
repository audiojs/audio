/**
 * Rebalance: a song's vocals, bass, drums and the rest, each at its own level (iZotope RX Music Rebalance).
 * Scene: a soundtrack's dialogue, music and effects, each at its own level (iZotope RX Scene Rebalance).
 *
 * a.rebalance(6)                              → the vocals 6 dB up
 * a.rebalance({ vocals: -6, drums: 3 })       → the vocals down, the drums up
 * a.rebalance(-Infinity)                      → the vocals gone: a karaoke track
 * a.rebalance(0, -Infinity, -Infinity, -Infinity) → the vocals alone
 * a.rebalance(0, 0, -Infinity, 0, { model: 'htdemucs' })
 * a.scene(6)                                  → the dialogue 6 dB up
 * a.scene(0, -6)                              → the music under it 6 dB down
 * a.scene(-Infinity)                          → the dialogue gone: a music and effects track
 *
 * Gains in dB, in RX's order: vocals, bass, drums, other; dialogue, music, effects; −Infinity mutes. A separation
 * model splits the edit's input into the stems, s, and the output is the input plus each stem's change,
 * x + Σ (g − 1)·s: 0 dB each leaves the input sample for sample, and what the model gives no stem stays at its level.
 * Runs @audio/neural-separate (optional package, loaded on first use). rebalance's `model`: 'scnet-large' by default
 * (SCNet-large, Tong et al., ICASSP 2024, MIT weights), 'scnet' (a quarter of its size, a third of its time),
 * 'htdemucs' or 'htdemucs_ft' (weights for research only), 'umxhq' (Open-Unmix, MIT). scene's: 'mrx' by default (MRX,
 * Petermann et al., ICASSP 2022, trained on Divide and Remaster; MERL's MIT weights), 'tiger' (TIGER, Xu et al., ICLR
 * 2025; Apache-2.0 weights: on 30 of the test clips 12.68 · 10.24 · 8.06 dB against MRX's 10.92 · 5.17 · 5.72, at about
 * 50 times its time). Weights come from Hugging Face (audiojs/scnet-large, scnet, mrx, tiger-dnr: 8-bit weights, 45, 13,
 * 31 and 7 MB, each pinned to a commit and checked by its SHA-256), kept in the page's cache or ~/.cache/audiojs/neural,
 * or from `weights` (a URL or directory); `device` picks the ONNX Runtime backend. The whole input is separated once before
 * rendering and kept on the edit while it stays the same (core.js memo: gains moved, the stems are read back). A model
 * hearing stereo hears mono as stereo and gives the mean of its two stems (MRX and TIGER hear each channel apart);
 * channels past the first two pass through.
 * On MUSDB18's 50 test previews (bench/rx/separate.mjs), each stem soloed, BSSEval v4 SDR, the median over songs,
 * vocals · bass · drums · other: 10.75 · 8.17 · 10.30 · 6.94 dB; RX 12 Music Rebalance at Best 10.89 · 9.66 · 9.85 ·
 * 6.45, behind on 33, 32, 38 and 32 of the songs; the vocals 6 dB up 20.2 dB against RX's 19.5. On Divide and Remaster
 * v3's English test set (150 clips of 60 s, bench/rx/scene.mjs), SNR, the median over clips, dialogue · music · effects:
 * mrx 11.82 · 5.32 · 6.03 dB (the dialogue as deepfilter(0) takes it, 10.47; SCNet splitting the rest, music −0.7 and
 * effects 0.4 on 30 of the clips); its authors' Bandit v2 (CC BY-SA
 * weights, not run here) 15.6 · 10.4 · 9.9 on all 1200; the dialogue 6 dB up 18.9 dB from the true remix (7.2 left as
 * it is). RX 12 Scene Rebalance runs only in Pro Tools.
 */

import audio, { arrived, memo } from '../core.js'
import { fingerprint } from './vocals.js'

const lin = db => db == null ? 1 : 10 ** (db / 20)

/** An op setting the stems `STEMS` of model `MODEL` (or another of the package's that gives them) each at its level */
function rebalancer(name, STEMS, MODEL) {
  const SEPARATED = Symbol(name + '.separated')
  const loadNeural = () => audio.import('@audio/neural-separate').catch(e => { throw new Error(`${name}: install @audio/neural-separate (${e.message})`) })

  function check(o) {
    for (let s of STEMS) if (o[s] != null && !(typeof o[s] === 'number' && o[s] === o[s] && o[s] < Infinity)) throw new TypeError(`${name}: ${s} is dB (−Infinity mutes it), not ${o[s]}`)
  }

  /** Separate the edit's input (the audio as the edits before it leave it) into its stems, ahead of rendering. */
  async function prepare(a, index) {
    let o = a.edits[index][1], model = o.model ?? MODEL
    check(o)
    // every gain 0 dB: the input as it is, nothing to separate
    if (STEMS.every(s => lin(o[s]) === 1)) return
    let { default: separate, models } = await loadNeural()
    let fits = m => STEMS.every(s => models[m].targets?.includes(s))
    if (!Object.hasOwn(models, model) || !fits(model)) throw new Error(`${name}: unknown model '${model}', expected ${Object.keys(models).filter(fits).join(', ')}`)
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
    // stem s, channel c at K·s + c, K the channels the model gave back; a mono input heard as stereo: their mean
    let K = stems.length / STEMS.length, at = (s, c) => stems[K * STEMS.indexOf(s) + c]
    o[SEPARATED] = { key, stamp, stems: Object.fromEntries(STEMS.map(s => [s, pcm.length === 1 && K === 2 ? [at(s, 0).map((v, i) => (v + at(s, 1)[i]) / 2)] : Array.from({ length: K }, (_, c) => at(s, c))])) }
  }

  const process = (input, output, ctx) => {
    for (let c = 0; c < input.length; c++) output[c].set(input[c])
    let moves = STEMS.map(s => [s, lin(ctx[s]) - 1]).filter(([, d]) => d)
    if (!moves.length) return
    let sep = ctx[SEPARATED]
    if (!sep) throw new Error(`${name}: separation runs before rendering, through read(), stream() or save()`)
    let len = input[0].length, off = Math.round((ctx.blockOffset || 0) * ctx.sampleRate)
    for (let [s, d] of moves) sep.stems[s].forEach((v, c) => {
      for (let i = 0, j = off; i < len; i++, j++) if (j >= 0 && j < v.length) output[c][i] += d * v[j]
    })
  }

  return { params: STEMS, process, prepare }
}

audio.op('rebalance', rebalancer('rebalance', ['vocals', 'bass', 'drums', 'other'], 'scnet-large'))
audio.op('scene', rebalancer('scene', ['dialogue', 'music', 'effects'], 'mrx'))
