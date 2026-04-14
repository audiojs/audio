/**
 * Pitch — shift pitch without changing duration.
 * semitones > 0 = higher, < 0 = lower.
 * Implementation: phase-lock time-stretch by pitch ratio, then resample block back to length.
 */

import audio from '../core.js'
import { initPhaseLockStream, phaseLockBlock } from './stretch.js'

const pitchProc = (input, output, ctx) => {
  let semi = ctx.semitones
  if (!semi) {
    for (let c = 0; c < input.length; c++) output[c].set(input[c])
    return
  }
  let ratio = Math.pow(2, semi / 12)
  if (!ctx._state) ctx._state = initPhaseLockStream(input.length, ratio)
  phaseLockBlock(ctx._state, input, output)
}

audio.op('pitch', { params: ['semitones'], process: pitchProc })
