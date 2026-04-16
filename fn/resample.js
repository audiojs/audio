/**
 * Resample — change sample rate (virtual, non-destructive).
 *
 * a.resample(48000)     → plan-based resample to 48kHz (returns this, chainable)
 * a.resample(22050)     → downsample with anti-alias lowpass
 *
 * Structural op: changes segment rates + updates effective sampleRate.
 * Downsampling auto-inserts a lowpass at the new Nyquist to prevent aliasing.
 * Uses linear interpolation from the plan engine's readSource.
 */

import { seg } from '../plan.js'
import audio from '../core.js'

function resampleSegs(segs, factor) {
  let r = [], dst = 0
  for (let s of segs) {
    let count = Math.round(s[1] * factor)
    let rate = s[4] === null ? undefined : (s[3] || 1) / factor
    r.push(seg(s[0], count, dst, rate, s[4]))
    dst += count
  }
  return r
}

const resamplePlan = (segs, ctx) => {
  let targetRate = ctx.rate
  if (!targetRate) return segs
  let factor = targetRate / ctx.sampleRate
  if (factor === 1) return segs
  return resampleSegs(segs, factor)
}

audio.op('_resample_seg', { hidden: true, plan: resamplePlan, sr: (curSr, ctx) => ctx.rate || curSr })

audio.op('resample', {
  params: ['rate'],
  sr: (curSr, ctx) => ctx.rate || curSr,
  resolve: (ctx) => {
    let targetRate = ctx.rate
    if (!targetRate || targetRate === ctx.sampleRate) return false
    if (targetRate <= 0) throw new RangeError('resample: rate must be positive')
    let edits = []
    // Anti-alias lowpass for downsampling — filter at 45% of new Nyquist to prevent aliasing
    if (targetRate < ctx.sampleRate) edits.push(['lowpass', { freq: targetRate * 0.45 }])
    edits.push(['_resample_seg', { rate: Math.round(targetRate) }])
    return edits.length === 1 ? edits[0] : edits
  }
})
