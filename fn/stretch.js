/**
 * Stretch — time-stretch by factor, preserving pitch.
 * factor > 1 = slower (longer), factor < 1 = faster (shorter).
 * Uses phase-locked vocoder via `time-stretch` package.
 *
 * Implementation: plan hook changes segment count + rate (same as speed),
 * then process layer corrects pitch via streaming phaseLock + resample.
 */

import { seg } from '../plan.js'
import { phaseLock } from 'time-stretch'
import audio from '../core.js'

// Plan: adjust segment durations — same math as speed(1/factor)
const stretchPlan = (segs, ctx) => {
  let factor = ctx.factor
  if (!factor || factor === 1) return segs
  let rate = 1 / factor
  let r = [], dst = 0
  for (let s of segs) {
    let count = Math.round(s[1] * factor)
    r.push(seg(s[0], count, dst, s[4] === null ? s[3] : (s[3] || 1) * rate, s[4]))
    dst += count
  }
  return r
}

// Process: correct pitch via streaming phaseLock.
// Plan resampled at rate=1/factor → pitch shifted by 1/factor.
// phaseLock with factor=1/factor shrinks audio, then resample restores block length.
// Net result: same-length block with original pitch.
const stretchDsp = (input, output, ctx) => {
  let factor = ctx.factor
  if (!factor || factor === 1) {
    for (let c = 0; c < input.length; c++) output[c].set(input[c])
    return
  }
  if (!ctx._pl) {
    ctx._pl = input.map(() => phaseLock({ factor: 1 / factor }))
    ctx._buf = input.map(() => [])
    ctx._pos = input.map(() => 0)
  }
  let len = input[0].length
  for (let c = 0; c < input.length; c++) {
    let chunk = ctx._pl[c](input[c])
    if (chunk.length) ctx._buf[c].push(chunk)
    let drained = drainBuf(ctx._buf[c], ctx._pos, c, len)
    output[c].set(drained)
  }
}

// Drain len samples from accumulated buffer chunks
function drainBuf(bufs, posArr, c, len) {
  let total = bufs.reduce((n, b) => n + b.length, 0) - posArr[c]
  // Resample available output to exactly len samples
  let available = Math.max(0, total)
  if (available === 0) return new Float32Array(len)
  // Collect all available samples
  let src = new Float32Array(available), pos = 0, skip = posArr[c]
  for (let b of bufs) {
    let start = Math.max(0, skip)
    let end = b.length
    skip -= b.length
    if (start < end) {
      let n = end - start
      src.set(b.subarray(start, end), pos)
      pos += n
    }
  }
  posArr[c] += available
  // Compact buffer
  while (bufs.length > 1 && posArr[c] >= bufs[0].length) {
    posArr[c] -= bufs[0].length
    bufs.shift()
  }
  // Resample to len
  if (available === len) return src
  let out = new Float32Array(len)
  let ratio = available / len
  for (let i = 0; i < len; i++) {
    let p = i * ratio, idx = p | 0, frac = p - idx
    out[i] = idx + 1 < available ? src[idx] + (src[idx + 1] - src[idx]) * frac : (src[idx] || 0)
  }
  return out
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
