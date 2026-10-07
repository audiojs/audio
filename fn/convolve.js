/**
 * Convolve: the sound through an impulse response, a room, a plate, a cabinet or a microphone as captured
 * (Pedalboard's Convolution).
 *
 * a.convolve('hall.wav')                 → the sound as it rings in the hall, all wet
 * a.convolve('hall.wav', 0.25)           → a quarter wet (`mix`, 0 to 1, a curve too)
 * a.convolve(cab, { normalize: true })   → the IR scaled to unit energy: about the sound's own level
 * a.convolve([left, right])              → IR samples, at the sound's rate
 *
 * The IR: a file or URL, an audio instance (as its edits make it) or channels of samples. At the stage's rate
 * (resampled, sinc). Channel c rings through the IR's channel c, wrapping: a stereo IR on a mono sound uses its
 * left only (`remix(2)` first for both). No latency (a direct head, FFT partitions growing behind it), and the IR's
 * length rendered past the end, its decay (`tail: false`, none; a number, seconds).
 */

import audio, { arrived } from '../core.js'
import { convolver } from '@audio/reverb-convolution'

const IR = Symbol('convolve.ir'), RUN = Symbol('convolve.run')

/** The IR at the stage's rate, its channels' samples, held by the edit until its source or settings change. */
async function prepare(a, index) {
  let o = a.edits[index][1], src = o.ir
  if (src == null || src === '' || src.length === 0) throw new RangeError('convolve: an impulse response is needed: a file, an audio instance or samples')
  await arrived(a)
  let stage = audio.from(a, { sampleRate: a._.sr })
  stage.edits = a.edits.slice(0, index)
  stage.version = index
  let sr = stage.sampleRate
  let ref = typeof src === 'string' || src?.pages ? src : null, stamp = `${sr}:${!!o.normalize}:${ref?.version ?? ''}`
  if (o[IR]?.src === src && o[IR].stamp === stamp) return
  // samples: one channel or several, typed arrays or, back from JSON, their index-keyed objects
  let chs = ref ? null : typeof src[0] === 'number' ? [src] : Array.isArray(src) ? src : Object.values(src)
  let ir = typeof src === 'string' ? audio(src) : ref ?? audio.from(chs.map(c => Float32Array.from(ArrayBuffer.isView(c) || Array.isArray(c) ? c : Object.values(c))), { sampleRate: sr })
  await ir.ready
  let pcm = await ir.read()
  if (ir.sampleRate !== sr) pcm = await audio.from(pcm, { sampleRate: ir.sampleRate }).resample(sr, { type: 'sinc' }).read()
  if (!pcm.length || !pcm[0].length) throw new RangeError('convolve: the impulse response is empty')
  if (o.normalize) {
    // the loudest channel at unit energy, the others as they stand to it
    let e = Math.max(...pcm.map(c => c.reduce((s, v) => s + v * v, 0))), g = e > 0 ? 1 / Math.sqrt(e) : 1
    pcm = pcm.map(c => c.map(v => v * g))
  }
  o[IR] = { src, stamp, pcm, length: pcm[0].length }
  return true  // the plan compiles again: the tail is the IR's length
}

/** Each channel through its IR, one convolver per channel for the render. */
function process(input, output, ctx) {
  let ir = ctx[IR]
  if (!ir) throw new Error('convolve: the impulse response loads before rendering, through read(), stream() or save()')
  let cs = ctx[RUN] ??= input.map((_, c) => convolver(ir.pcm[c % ir.pcm.length]))
  for (let c = 0; c < input.length; c++) cs[c].write(input[c], output[c])
}

audio.op('_convolve', {
  params: ['ir'], hidden: true, process,
  warmup: o => o[IR]?.length ?? 0,  // a render from mid-timeline hears the input the IR reaches back over
})

audio.op('convolve', {
  params: ['ir', 'mix'], prepare,
  // the convolver, the mix blended by the engine; its decay as a pad (as a plugin's tail): the edit stays one
  expand: ctx => {
    let ir = ctx[IR], o = { ir: ctx.ir, [IR]: ir }
    if (ctx.mix != null) o.mix = ctx.mix
    let t = ctx.tail === false ? 0 : typeof ctx.tail === 'number' ? ctx.tail : ir ? (ir.length - 1) / ctx.sampleRate : 0
    return t > 0 ? [['pad', { before: 0, after: t }], ['_convolve', o]] : [['_convolve', o]]
  },
})
