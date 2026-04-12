/**
 * Pan — stereo balance control. -1 = full left, 0 = center, 1 = full right.
 * Linear attenuation — never boosts, only attenuates one channel.
 */

import { opRange } from '../plan.js'

const pan = (input, output, ctx) => {
  let val = ctx.value ?? 0
  let len = input[0].length
  if (input.length < 2) {
    for (let c = 0; c < input.length; c++) output[c].set(input[c])
    return
  }
  let auto = typeof val === 'function'
  let [s, end] = opRange(ctx, len)
  let off = (ctx.blockOffset || 0) * ctx.sampleRate
  s = Math.max(0, Math.min(s, len)); end = Math.max(s, Math.min(end, len))
  if (!auto) {
    val = Math.max(-1, Math.min(1, val))
    let gL = val <= 0 ? 1 : 1 - val, gR = val >= 0 ? 1 : 1 + val, gains = [gL, gR]
    for (let c = 0; c < input.length; c++) {
      let inp = input[c], out = output[c], g = gains[c] ?? 1
      if (s > 0) out.set(inp.subarray(0, s))
      for (let i = s; i < end; i++) out[i] = inp[i] * g
      if (end < len) out.set(inp.subarray(end), end)
    }
    return
  }
  // Copy non-L/R channels, then apply automation to L/R
  for (let c = 2; c < input.length; c++) output[c].set(input[c])
  let inL = input[0], inR = input[1], outL = output[0], outR = output[1]
  if (s > 0) { outL.set(inL.subarray(0, s)); outR.set(inR.subarray(0, s)) }
  for (let i = s; i < end; i++) {
    let p = Math.max(-1, Math.min(1, val((off + i) / ctx.sampleRate)))
    outL[i] = inL[i] * (p <= 0 ? 1 : 1 - p)
    outR[i] = inR[i] * (p >= 0 ? 1 : 1 + p)
  }
  if (end < len) { outL.set(inL.subarray(end), end); outR.set(inR.subarray(end), end) }
}

import audio from '../core.js'
audio.op('pan', { params: ['value'], process: pan })
