/**
 * Pitch — shift pitch without changing duration.
 * semitones > 0 = higher, < 0 = lower.
 * Implementation: time-stretch by pitch ratio via phaseLock, then resample back to original length.
 */

import { phaseLock } from 'time-stretch'
import audio from '../core.js'

const pitchProc = (input, output, ctx) => {
  let semi = ctx.semitones
  if (!semi) {
    for (let c = 0; c < input.length; c++) output[c].set(input[c])
    return
  }
  let ratio = Math.pow(2, semi / 12)
  if (!ctx._pl) {
    ctx._pl = input.map(() => phaseLock({ factor: ratio }))
    ctx._buf = input.map(() => [])
    ctx._pos = input.map(() => 0)
  }
  let len = input[0].length
  for (let c = 0; c < input.length; c++) {
    let chunk = ctx._pl[c](input[c])
    if (chunk.length) ctx._buf[c].push(chunk)
    let drained = drain(ctx._buf[c], ctx._pos, c, len)
    output[c].set(drained)
  }
}

function drain(bufs, posArr, c, len) {
  let total = bufs.reduce((n, b) => n + b.length, 0) - posArr[c]
  if (total === 0) return new Float32Array(len)
  let src = new Float32Array(total), pos = 0, skip = posArr[c]
  for (let b of bufs) {
    let start = Math.max(0, skip)
    skip -= b.length
    if (start < b.length) { let n = b.length - start; src.set(b.subarray(start), pos); pos += n }
  }
  posArr[c] += total
  while (bufs.length > 1 && posArr[c] >= bufs[0].length) { posArr[c] -= bufs[0].length; bufs.shift() }
  if (total === len) return src
  let out = new Float32Array(len), r = total / len
  for (let i = 0; i < len; i++) {
    let p = i * r, idx = p | 0, frac = p - idx
    out[i] = idx + 1 < total ? src[idx] + (src[idx + 1] - src[idx]) * frac : (src[idx] || 0)
  }
  return out
}

audio.op('pitch', { params: ['semitones'], process: pitchProc })
