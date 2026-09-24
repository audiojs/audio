/**
 * Pitch — shift pitch without changing duration.
 * semitones > 0 = higher, < 0 = lower.
 * Implementation: phase-lock time-stretch by pitch ratio, then resample block back to length.
 */

import audio from '../core.js'
import { initPhaseLockStream, phaseLockBlock, phaseLockLatency } from './stretch.js'

const pitchProc = (input, output, ctx) => {
  let semi = ctx.semitones
  if (!semi) {
    for (let c = 0; c < input.length; c++) output[c].set(input[c])
    return
  }
  let ratio = Math.pow(2, semi / 12)
  if (!ctx._state) ctx._state = initPhaseLockStream(input.length, ratio, ctx.sampleRate)
  phaseLockBlock(ctx._state, input, output, ctx)
}

// The phase-lock stream runs a fixed latency behind and handles its own range (see stretch.js).
const pitchLatency = (o, sr) => typeof o.semitones === 'number' && o.semitones ? phaseLockLatency(2 ** (o.semitones / 12), sr) : 0
audio.op('pitch', { params: ['semitones'], process: pitchProc, ranged: true, latency: pitchLatency })
