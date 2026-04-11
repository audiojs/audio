/**
 * Speed — change playback rate. speed(2) = double speed (half duration),
 * speed(0.5) = half speed (double duration), speed(-1) = reverse.
 */

import { seg } from '../plan.js'

export function speedSegs(segs, rate) {
  if (rate === 0) throw new RangeError('speed: rate cannot be 0')
  if (!rate || rate === 1) return segs
  let absR = Math.abs(rate)
  let r = [], dst = 0
  for (let s of segs) {
    let count = Math.round(s[1] / absR)
    r.push(seg(s[0], count, dst, s[4] === null ? s[3] : (s[3] || 1) * rate, s[4]))
    dst += count
  }
  return r
}

const speedPlan = (segs, ctx) => speedSegs(segs, ctx.args[0])

import audio from '../core.js'
audio.op('speed', { plan: speedPlan })
