/**
 * Resample — change sample rate (virtual, non-destructive).
 *
 * a.resample(48000)                 → linear interpolation (default, fast)
 * a.resample(22050)                 → downsample with anti-alias sinc
 * a.resample(48000, {type:'sinc'})  → 32-tap windowed-sinc (Lanczos), high quality
 *
 * Structural op: changes segment rates + updates effective sampleRate.
 *
 * Interpolation strategy:
 *   - Linear (default): plan.js built-in for upsampling / same-rate segment reads.
 *     Downsampling defaults to sinc so aliases are suppressed before decimation.
 *   - Sinc: pluggable interpolator function attached to segments; carries its own
 *     `.margin` so plan.js reads enough context. Built-in anti-aliasing via
 *     kernel widening on downsample, so no separate lowpass needed.
 */

import { seg } from '../plan.js'
import audio from '../core.js'

// ── Sinc interpolator (Lanczos-windowed, 32 taps) ──────────────────────

const SINC_HALF = 16
const sinc = x => x === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x)

/** Plug-in interpolator: `(src, target, tOff, n, rate, phase) => void`. */
function sincInterp(src, target, tOff, n, rate, phase = 0) {
  let absR = Math.abs(rate), rev = rate < 0
  let scale = absR > 1 ? 1 / absR : 1  // widen kernel for downsample (anti-alias)
  for (let i = 0; i < n; i++) {
    let pos = (rev ? n - 1 - i : i) * absR + phase
    let base = Math.floor(pos), frac = pos - base
    let sum = 0, w = 0
    for (let t = 1 - SINC_HALF; t <= SINC_HALF; t++) {
      let idx = base + t
      if (idx < 0 || idx >= src.length) continue
      let x = (t - frac) * scale
      let k = sinc(x) * sinc(x / SINC_HALF)
      sum += src[idx] * k; w += k
    }
    target[tOff + i] = w !== 0 ? sum / w : 0
  }
}
sincInterp.margin = SINC_HALF

const INTERP = { sinc: sincInterp }

function readRate(rate) {
  if (typeof rate !== 'number' || !Number.isFinite(rate) || rate <= 0)
    throw new RangeError('resample: rate must be a positive finite number')
  return Math.round(rate)
}

function readType(type) {
  if (type == null) return null
  if (!Object.hasOwn(INTERP, type) && type !== 'linear')
    throw new RangeError(`resample: unknown type "${type}"`)
  return type
}

// ── Plan op ────────────────────────────────────────────────────────────

function resampleSegs(segs, factor, interp) {
  let r = [], dst = 0
  for (let s of segs) {
    let count = Math.round(s[1] * factor)
    let rate = s[4] === null ? undefined : (s[3] || 1) / factor
    let nextInterp = interp === null ? undefined : interp || s[5]
    r.push(seg(s[0], count, dst, rate, s[4], s[4] === null ? undefined : nextInterp))
    dst += count
  }
  return r
}

const resamplePlan = (segs, ctx) => {
  let targetRate = readRate(ctx.rate)
  let factor = targetRate / ctx.sampleRate
  if (factor === 1) return segs
  let type = readType(ctx.type)
  let interp = type === 'linear' ? null : INTERP[type] || (factor < 1 ? sincInterp : undefined)
  return resampleSegs(segs, factor, interp)
}

audio.op('_resample_seg', { hidden: true, plan: resamplePlan, sr: (curSr, ctx) => readRate(ctx.rate) })

audio.op('resample', {
  params: ['rate'],
  sr: (curSr, ctx) => readRate(ctx.rate),
  resolve: (ctx) => {
    let targetRate = readRate(ctx.rate)
    let type = readType(ctx.type)
    if (targetRate === ctx.sampleRate) return false
    let opts = { rate: Math.round(targetRate) }
    if (type) opts.type = type
    return ['_resample_seg', opts]
  }
})
