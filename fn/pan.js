/**
 * Pan — stereo balance control. -1 = full left, 0 = center, 1 = full right.
 * Linear attenuation — never boosts, only attenuates one channel.
 */

import { opRange } from '../plan.js'

const pan = (chs, ctx) => {
  let val = ctx.args[0] ?? 0 // -1..1 or t => value
  if (chs.length < 2) return false // mono: no-op
  let auto = typeof val === 'function'
  let [s, end] = opRange(ctx, chs[0].length)
  let off = (ctx.blockOffset || 0) * ctx.sampleRate
  if (!auto) {
    val = Math.max(-1, Math.min(1, val))
    let gL = val <= 0 ? 1 : 1 - val, gR = val >= 0 ? 1 : 1 + val, gains = [gL, gR]
    for (let c = 0; c < chs.length; c++) {
      let g = gains[c] ?? 1
      if (g === 1) continue
      for (let i = Math.max(0, s); i < Math.min(end, chs[c].length); i++) chs[c][i] *= g
    }
    return chs
  }
  // Automation: per-sample evaluation
  let L = chs[0], R = chs[1]
  for (let i = Math.max(0, s); i < Math.min(end, L.length); i++) {
    let p = Math.max(-1, Math.min(1, val((off + i) / ctx.sampleRate)))
    L[i] *= p <= 0 ? 1 : 1 - p
    R[i] *= p >= 0 ? 1 : 1 + p
  }
  return chs
}

import audio from '../core.js'
audio.op('pan', { process: pan })
