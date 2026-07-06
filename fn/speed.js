/**
 * Speed — change playback rate. speed(2) = double speed (half duration),
 * speed(0.5) = half speed (double duration), speed(-1) = reverse.
 * {at, duration} scope the rate change to a range.
 */

import { seg, spliceSegs, planOffset } from '../plan.js'

export function speedSegs(segs, rate) {
  if (rate === 0) throw new RangeError('speed: rate cannot be 0')
  if (!rate || rate === 1) return segs
  let absR = Math.abs(rate)
  let r = [], dst = 0
  for (let s of segs) {
    let count = Math.round(s[1] / absR)
    r.push(seg(s[0], count, dst, s[4] === null ? undefined : (s[3] || 1) * rate, s[4], s[5]))
    dst += count
  }
  return r
}

const speedPlan = (segs, ctx) => {
  let { total, offset, length } = ctx
  if (offset == null && length == null) return speedSegs(segs, ctx.rate)
  let at = planOffset(offset, total)
  return spliceSegs(segs, at, length ?? total - at, sub => speedSegs(sub, ctx.rate))
}

import audio from '../core.js'
audio.op('speed', { params: ['rate'], plan: speedPlan })
