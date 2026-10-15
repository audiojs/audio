/**
 * Speed — change playback rate. speed(2) = double speed (half duration),
 * speed(0.5) = half speed (double duration), speed(-1) = reverse.
 * {at, duration} scope the rate change to a range.
 * { type: 'sinc' } reads between samples by resample's Lanczos sinc (16 zero crossings, anti-aliased going faster),
 * not linearly: a rate near 1 (a clock's drift) leaves the top octave as it was.
 */

import { seg, spliceSegs, planOffset } from '../plan.js'
import { sincInterp } from './resample.js'

export function speedSegs(segs, rate, interp) {
  if (rate === 0) throw new RangeError('speed: rate cannot be 0')
  if (!rate || rate === 1) return segs
  let absR = Math.abs(rate)
  // placed by position, not accumulated count, so overlapping (crossfade) pairs stay aligned
  return segs.map(s => {
    let a = Math.round(s[2] / absR), b = Math.round((s[2] + s[1]) / absR)
    return seg(s[0], b - a, a, s[4] === null ? undefined : (s[3] || 1) * rate, s[4], s[4] === null || s[5]?.band ? s[5] : interp ?? s[5], s[6])
  })
}

const speedPlan = (segs, ctx) => {
  let { total, offset, length } = ctx, interp = ctx.type === 'sinc' ? sincInterp : undefined
  if (ctx.type != null && ctx.type !== 'sinc' && ctx.type !== 'linear') throw new RangeError(`speed: unknown type "${ctx.type}"`)
  if (offset == null && length == null) return speedSegs(segs, ctx.rate, interp)
  let at = planOffset(offset, total)
  return spliceSegs(segs, at, length ?? total - at, sub => speedSegs(sub, ctx.rate, interp))
}

import audio from '../core.js'
audio.op('speed', { params: ['rate'], plan: speedPlan })
