/**
 * Stretch — time-stretch by factor, preserving pitch.
 * factor > 1 = slower (longer), factor < 1 = faster (shorter).
 *
 * Two-stage pipeline:
 *   1. Plan: set segment rate = 1/factor, count *= factor — linear resample
 *      gives the target duration but pitch-shifted by 1/factor.
 *   2. Process: pitch-shift streaming blocks by `factor` (phase-lock + drain)
 *      to restore the original pitch. Net result: same pitch, new duration.
 *
 * Streaming pitch-shift primitive (initPhaseLockStream / phaseLockBlock) is
 * exported for reuse by pitch.js — same phase-lock + resample, different
 * ratio source (semitones → ratio instead of factor).
 */

import { seg } from '../plan.js'
import audio from '../core.js'
import { vocoder } from 'time-stretch'

// vocoder({ factor: r, lock: true }) stretches time by r (keeps pitch) using
// a phase-locked vocoder. A persistent fractional cursor then resamples the
// stretched stream at rate r — one advance of `r` per output sample —
// pitch-shifting by r at fixed block size with stable pitch across block
// boundaries.
// Warm-up: while the vocoder has yet to emit anything the cursor stalls so no
// samples are skipped; emission resumes once the ring catches up.
export function initPhaseLockStream(nch, ratio) {
  return Array.from({ length: nch }, () => ({
    write: vocoder({ factor: ratio, lock: true, frameSize: 1024 }),
    ring: new Float32Array(4096),
    ringLen: 0,
    ringStart: 0,
    readPos: 0,
    ratio
  }))
}

export function phaseLockBlock(state, input, output) {
  for (let c = 0; c < input.length; c++) processChannel(state[c], input[c], output[c])
}

function processChannel(s, input, output) {
  let chunk = s.write(input)
  if (chunk.length) appendRing(s, chunk)

  let len = output.length, r = s.ratio
  for (let i = 0; i < len; i++) {
    let p = s.readPos
    let idx = Math.floor(p) - s.ringStart
    let frac = p - Math.floor(p)
    if (idx >= 0 && idx + 1 < s.ringLen) {
      output[i] = s.ring[idx] + (s.ring[idx + 1] - s.ring[idx]) * frac
      s.readPos += r
    } else {
      output[i] = 0
    }
  }

  let drop = Math.floor(s.readPos) - 1 - s.ringStart
  if (drop > 0 && drop < s.ringLen) {
    s.ring.copyWithin(0, drop, s.ringLen)
    s.ringLen -= drop
    s.ringStart += drop
  }
}

function appendRing(s, chunk) {
  let need = s.ringLen + chunk.length
  if (need > s.ring.length) {
    let nb = new Float32Array(Math.max(need, s.ring.length * 2))
    nb.set(s.ring.subarray(0, s.ringLen))
    s.ring = nb
  }
  s.ring.set(chunk, s.ringLen)
  s.ringLen += chunk.length
}

const stretchPlan = (segs, ctx) => {
  let factor = ctx.factor
  if (!factor || factor === 1) return segs
  let rate = 1 / factor
  let r = [], dst = 0
  for (let s of segs) {
    let count = Math.round(s[1] * factor)
    r.push(seg(s[0], count, dst, s[4] === null ? undefined : (s[3] || 1) * rate, s[4]))
    dst += count
  }
  return r
}

const stretchDsp = (input, output, ctx) => {
  let factor = ctx.factor
  if (!factor || factor === 1) {
    for (let c = 0; c < input.length; c++) output[c].set(input[c])
    return
  }
  if (!ctx._state) ctx._state = initPhaseLockStream(input.length, factor)
  phaseLockBlock(ctx._state, input, output)
}

audio.op('_stretch_seg', { params: ['factor'], plan: stretchPlan, hidden: true })
audio.op('_stretch_dsp', { params: ['factor'], process: stretchDsp, hidden: true })
audio.op('stretch', {
  params: ['factor'],
  resolve: (ctx) => {
    let f = ctx.factor
    if (!f || f === 1) return false
    if (f <= 0) throw new RangeError('stretch: factor must be positive')
    return [
      ['_stretch_seg', { factor: f }],
      ['_stretch_dsp', { factor: f }]
    ]
  }
})
