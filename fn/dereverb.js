/**
 * Dereverb — the room off a voice.
 *
 * a.dereverb()                     → the room off a voice by a trained model, 60 dB down: as far as it goes
 * a.dereverb(12)                   → the room 12 dB down, the rest of it kept
 * a.dereverb({ music: 'enhance' }) → music too (by default it passes untouched)
 * a.dereverb({ method: 'wpe' })    → no model: linear prediction and a late-reverb gain (@audio/denoise-dereverb)
 * a.dereverb({ weights, device })
 *
 * 'roformer' (the default) runs anvuew's room de-reverb (huggingface.co/anvuew/dereverb_room, GPL-3.0 weights), a mono
 * Band-Split RoFormer (Lu, Wang, Kong, Hung, ICASSP 2024) trained on voices in rooms simulated with pyroomacoustics, by
 * @audio/neural-separate (optional package, loaded on first use; the model, 60 MB, downloads once and is cached). Each
 * channel apart, at 44.1 kHz (other rates resampled in and out), the edit's whole input once ahead of rendering, kept
 * while that input stays the same: moving `reduction` runs no model again. Its output y is the voice dry, its early
 * reflections and its tail gone alike; `reduction` mixes back what it took, y + 10^(−reduction/20)·(x − y) (0: the
 * input as it came, no model run): 60 dB by default, which scores as the model's whole output does (reverberant
 * VoiceBank in MIT rooms: PESQ 2.65 at 60 and whole, 2.61 at 40, 2.48 at 30, 2.13 at 20, 1.73 at 12; the input 1.39).
 *
 * To the model all that is not a voice is room: music (MUSDB18 previews, GuitarSet, sung tones, four pieces) loses
 * 6 dB in its worst octave as it is, and 9 dB of itself in a room. So music passes (`music: 'pass'`):
 * @audio/neural-denoise's guard (inaSpeechSegmenter's speech/music/noise CNN, segments over the whole input, the
 * model's output ramped in and out over 200 ms, as deepfilter's) keeps the input where it hears music both in the take
 * and in the model's voice; a voice over a music bed counts as speech, and the bed goes with the room. Music through
 * it comes back within 0.9 dB in every octave (MUSDB18 previews, GuitarSet, four pieces: as they are, cut into phrases,
 * in a room; bench/rx/dereverb.mjs); sung tones, a voice to the model and to the guard, lose up to 6 dB in an octave in
 * a room. `music: 'enhance'` takes the guard off.
 *
 * 'wpe' runs @audio/denoise-dereverb's kernel: weighted prediction error (Nakatani et al., IEEE TASLP 2010) and a
 * late-reverb gain, no model, no download, about 6 dB of the late tail; a dry take, one without pauses, or music comes
 * back untouched (its `strength`, 0–4, and `music` options; `reduction` is the model's).
 */

import audio, { arrived, memo } from '../core.js'
import { fingerprint } from './vocals.js'
import { playback } from './deepfilter.js'

const REDUCTION = 60, METHODS = ['roformer', 'wpe'], MUSIC = ['pass', 'enhance']
const MADE = Symbol('dereverb.made')

const need = (spec, why) => audio.import(spec).catch(e => { throw new Error(`dereverb: install ${spec} ${why} (${e.message})`) })

/** The model's dry voice of each channel of `pcm`, kept by its input (core.js memo). */
export function dry(pcm, sampleRate, { weights, device } = {}) {
  return memo(`dereverb-room:${weights ?? ''}:${sampleRate}:${fingerprint(pcm)}`, async () => {
    let { default: separate, models } = await need('@audio/neural-separate', "(the model), or dereverb({ method: 'wpe' }) for none")
    if (!models['dereverb-room']) throw new Error('dereverb: needs @audio/neural-separate 0.6 or later (its dereverb-room model)')
    return (await separate(pcm, { sampleRate, model: 'dereverb-room', weights, device })).stems.dry
  })
}

/** Per sample of each channel of `pcm`, 0 where the guard hears music, 1 elsewhere, ramped; kept by its input. */
function guard(pcm, sampleRate) {
  return memo(`dereverb-guard:${sampleRate}:${fingerprint(pcm)}`, async () => {
    let { guard } = await need('@audio/neural-denoise', "(its music guard), or dereverb({ music: 'enhance' }) for none")
    if (!guard) throw new Error('dereverb: needs @audio/neural-denoise 0.6 or later (its guard)')
    return Promise.all(pcm.map(x => guard(x, sampleRate)))
  })
}

// the options checked → the key of what they make of one input
function id(o) {
  let method = o.method ?? 'roformer', music = o.music ?? 'pass', r = o.reduction ?? REDUCTION
  if (!METHODS.includes(method)) throw new TypeError(`dereverb: method is ${METHODS.join(' or ')}, not ${method}`)
  if (!MUSIC.includes(music)) throw new TypeError(`dereverb: music is ${MUSIC.join(' or ')}, not ${music}`)
  if (typeof r !== 'number' || !(r >= 0)) throw new TypeError(`dereverb: reduction is dB, 0 or more, not ${r}`)
  return method === 'wpe' ? `wpe:${o.strength ?? 1}:${music}` : `roformer:${r}:${music}:${o.weights ?? ''}`
}

/** Dereverb the edit's input (the audio as the edits before it leave it), ahead of rendering. */
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
  o[MADE] = { key, stamp, pcm: pcm[0]?.length ? await dereverbed(pcm, fs, o) : pcm }
}

async function dereverbed(pcm, fs, o) {
  if (o.method === 'wpe') {
    let { default: wpe } = await import('@audio/denoise/dereverb').catch(e => { throw new Error(`dereverb: install @audio/denoise (${e.message})`) })
    return pcm.map(x => wpe(x, { fs, strength: o.strength, music: o.music }))
  }
  let a = 10 ** (-(o.reduction ?? REDUCTION) / 20), g = null
  if (a === 1) return pcm   // reduction 0: nothing taken, no model run
  let y = await dry(pcm, fs, o)
  // the model's where the guard hears speech in the take or in the model's voice: a long room makes a voice ring on
  // like a held note, and the guard heard music in 16 % of reverberant VoiceBank (27 % of the long takes), in none
  // once the room is off; music the model mangles mostly stays music to it
  if ((o.music ?? 'pass') === 'pass') {
    let gx = await guard(pcm, fs)
    g = gx.every(v => v.every(w => w === 1)) ? null : (await guard(y, fs)).map((v, c) => v.map((w, i) => Math.max(w, gx[c][i])))
    if (g?.every(v => v.every(w => w === 0))) return pcm
  }
  // the room mixed back at a, then the input where the guard hears music: y + a·(x − y), blended by g
  return pcm.map((x, c) => Float32Array.from(x, (v, i) => {
    let w = g ? g[c][i] : 1, z = y[c][i] + a * (v - y[c][i])
    return w === 1 ? z : w === 0 ? v : w * z + (1 - w) * v
  }))
}

audio.op('dereverb', { params: ['reduction'], prepare, process: playback('dereverb', MADE) })
