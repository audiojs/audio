/**
 * Pitch — shift pitch without changing duration.
 * semitones > 0 = higher, < 0 = lower.
 * Implementation: time-stretch by pitch ratio via phaseLock, then resample back to original length.
 */

import { phaseLock } from 'time-stretch'
import audio from '../core.js'

const pitchProc = (chs, ctx) => {
  let semi = ctx.args[0]
  if (!semi) return chs
  let ratio = Math.pow(2, semi / 12)
  // phaseLock at factor=ratio stretches duration → pitch stays same.
  // Then resample output back to original length → pitch shifts, duration restores.
  if (!ctx._pl) {
    ctx._pl = chs.map(() => phaseLock({ factor: ratio }))
    ctx._buf = chs.map(() => [])
    ctx._pos = chs.map(() => 0)
  }
  let len = chs[0].length
  return chs.map((ch, c) => {
    let chunk = ctx._pl[c](ch)
    if (chunk.length) ctx._buf[c].push(chunk)
    return drain(ctx._buf[c], ctx._pos, c, len)
  })
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

audio.op('pitch', { process: pitchProc })
