/**
 * Pitch — shift pitch without changing duration.
 * semitones > 0 = higher, < 0 = lower: a number, a curve { t, v } (seconds of the timeline → semitones, straight
 * between its points and flat past its ends, as gain's), or a function t => semitones.
 * Implementation: the shifter of stretch.js, run only where the shift is not zero: a phase-locked vocoder read by a
 * cursor through its frames (any audio; the formants move with the pitch), or with { voice: true } a voice's own
 * glottal cycles re-spaced (@audio/tune-curve, TD-PSOLA: formants and consonants kept; one voice).
 */

import audio from '../core.js'
import { isCurve } from '../plan.js'
import { shifter, shiftBlock, shiftLatency, rangeOf } from './stretch.js'

// A voice: @audio/tune-curve's retuner (TD-PSOLA on the voice's cycles, one set for all channels), loaded with the op on
// first use, out of the bundle; missing, only a voice shift fails. What it runs behind, for voices down to 60 Hz, is
// known at plan time, before it loads (its latencyOf; the shifter checks the two agree).
const VOICE_HZ = 60
const voiceLatency = (sr, rmin) => {
  let dec = Math.max(1, Math.floor(sr / 11025)), Wd = 2 ** Math.ceil(Math.log2(2 * sr / dec / VOICE_HZ))
  let hop = Math.max(dec, Math.round(.005 * sr / dec) * dec)
  return Wd / 2 * dec + 2 * hop + Math.ceil(sr / VOICE_HZ * (3 + 1 / Math.min(1, rmin))) + 18
}
// a frame of YIN and two cycles before a span: the cycles found as they are where it starts
const voiceContext = sr => 2 ** Math.ceil(Math.log2(2 * sr / VOICE_HZ)) + Math.ceil(2 * sr / VOICE_HZ)

// What the shifter needs: the least ratio the shift takes, 1 included outside a range
const shape = o => {
  let s = o.semitones, ranged = o.at != null || o.duration != null
  let lo = typeof s === 'number' ? (s ? s : null) : isCurve(s) && s.v.some(v => v) ? s.v.reduce((m, v) => v < m ? v : m, Infinity) : null
  return lo == null ? null : { rmin: Math.min(2 ** (lo / 12), ranged ? 1 : Infinity) }
}

/** A curve at a time in seconds, as plan.js curveFn has it (straight between points, flat past the ends), searched
 *  from the point found last: the shifter asks in order, sample by sample. */
const curveAt = ({ t, v }) => {
  let i = 1, n = t.length
  return time => {
    if (time <= t[0]) return v[0]
    if (time >= t[n - 1]) return v[n - 1]
    while (t[i] < time) i++
    while (i > 1 && t[i - 1] >= time) i--
    return v[i - 1] + (v[i] - v[i - 1]) * ((time - t[i - 1]) / (t[i] - t[i - 1]))
  }
}

/** Where a curve is not zero, in samples: all but the stretches between points that are both zero (and before its
 *  first, after its last, if those are zero). */
function curveSpans({ t, v }, sr) {
  let n = t.length, zero = []
  if (!v[0]) zero.push([-Infinity, t[0]])
  for (let i = 0; i + 1 < n; i++) if (!v[i] && !v[i + 1]) zero.push([t[i], t[i + 1]])
  if (!v[n - 1]) zero.push([t[n - 1], Infinity])
  let spans = [], from = -Infinity
  for (let [a, b] of zero) {
    if (a > from) spans.push([from === -Infinity ? from : Math.floor(from * sr), Math.ceil(a * sr)])
    from = Math.max(from, b)
  }
  if (from < Infinity) spans.push([from === -Infinity ? from : Math.floor(from * sr), Infinity])
  return spans
}

const pitchProc = (input, output, ctx) => {
  let st = ctx._state
  if (st === undefined) {
    let sh = shape(ctx), sr = ctx.sampleRate, [a0, a1] = rangeOf(ctx), s = ctx.semitones
    // a number is read live, so a value patched in during playback ramps (plan.js patchProcs)
    let semi = isCurve(s) ? (f => n => f(n / sr))(curveAt(s)) : () => ctx.semitones, last = NaN, lr = 1
    // the ratio of a semitone value, kept while the value holds
    let ratioOf = v => v === last ? lr : (last = v, lr = 2 ** (v / 12))
    let spans = (isCurve(s) ? curveSpans(s, sr) : [[-Infinity, Infinity]])
      .map(([a, b]) => [Math.max(a, a0), Math.min(b, a1)]).filter(([a, b]) => b > a)
    // A range's edges glide, the shift ramping in (raised cosine) over the 10 ms after the crossfade from the input,
    // and out over the 10 ms before the one back into it: the shifted audio crosses with the input at the input's own
    // pitch, as near the same signal in, and out a steady phase apart, so neither crossfade beats.
    let G = Math.min(Math.round(.01 * sr), (a1 - a0) / 4)
    let edge = n => Math.max(0, Math.min(1, (n - a0 - G + .5) / G, (a1 - G - n - .5) / G))
    let ratio = n => {
      if (n < a0 || n >= a1) return 1
      let w = edge(n)
      return w >= 1 ? ratioOf(semi(n)) : w <= 0 ? 1 : 2 ** (semi(n) * (.5 - .5 * Math.cos(Math.PI * w)) / 12)
    }
    let voice = null
    if (sh && ctx.voice) {
      let tc = audio.op('pitch').mod?.retuner
      if (!tc) throw new Error('pitch({ voice: true }): install @audio/tune-curve')
      let make = r => tc(input.length, { ratio: r, sampleRate: sr, rmin: sh.rmin, minFreq: VOICE_HZ })
      voice = { latency: voiceLatency(sr, sh.rmin), context: voiceContext(sr), make }
    }
    st = ctx._state = sh && spans.length ? shifter(input.length, { sampleRate: sr, rmin: sh.rmin, spans, ratio, voice }) : null
  }
  if (!st) { for (let c = 0; c < input.length; c++) output[c].set(input[c]); return }
  shiftBlock(st, input, output, Math.round(ctx.blockOffset * ctx.sampleRate))
}

// The shifter runs a fixed latency behind and handles its own range: dry and shifted audio share that latency.
const pitchLatency = (o, sr) => {
  let sh = shape(o)
  return sh ? shiftLatency(sh.rmin, sr, undefined, o.voice ? voiceLatency(sr, sh.rmin) : undefined) : 0
}

audio.op('pitch', {
  params: ['semitones'],
  ranged: true,
  // a curve reaches the shifter as is, its points telling where the shift is zero
  fnArgs: ['semitones'],
  // A function becomes a curve at plan time, sampled every 5 ms over its range: where it is zero, and how low it goes
  // (the latency), are then known before any audio is.
  expand: ctx => {
    let f = ctx.semitones
    if (typeof f !== 'function') return
    let from = ctx.at != null ? (ctx.at < 0 ? ctx.totalDuration + ctx.at : ctx.at) : 0
    let to = ctx.duration != null ? from + ctx.duration : Math.max(from, ctx.totalDuration), t = [], v = []
    for (let k = 0, n = Math.max(1, Math.ceil((to - from) / .005)); k <= n; k++) {
      let x = from + (to - from) * k / n, y = +f(x)
      t.push(x); v.push(Number.isFinite(y) ? y : 0)
    }
    return [['pitch', { semitones: { t, v }, voice: ctx.voice }]]
  },
  load: () => import('@audio/tune-curve').catch(() => null),
  process: pitchProc,
  latency: pitchLatency
})
