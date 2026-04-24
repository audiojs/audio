/**
 * Resample — change sample rate (virtual, non-destructive).
 *
 * a.resample(48000)                 → linear interpolation (default, fast)
 * a.resample(22050)                 → downsample with anti-alias lowpass
 * a.resample(48000, {type:'sinc'})  → 32-tap windowed-sinc (Lanczos), high quality
 *
 * Structural op: changes segment rates + updates effective sampleRate.
 *
 * Interpolation strategy:
 *   - Linear (default): plan.js built-in. Adds anti-alias lowpass on downsample.
 *   - Sinc: pluggable interpolator function attached to segments; carries its own
 *     `.margin` so plan.js reads enough context. Built-in anti-aliasing via
 *     kernel widening on downsample, so no separate lowpass needed.
 *
 * Adding new interpolators: register on INTERP map, no plan.js changes needed.
 */

import { seg } from '../plan.js'
import audio from '../core.js'

// ── Sinc interpolator (Lanczos-windowed, 32 taps) ──────────────────────

const SINC_HALF = 16
const sinc = x => x === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x)

/** Plug-in interpolator: `(src, target, tOff, n, rate, margin) => void`. */
function sincInterp(src, target, tOff, n, rate, margin = 0) {
  let absR = Math.abs(rate), rev = rate < 0
  // Reverse falls back to linear (no perceptual gain reversing audio with sinc)
  if (rev) {
    for (let i = 0; i < n; i++) {
      let pos = (n - 1 - i) * absR
      let idx = pos | 0, frac = pos - idx
      target[tOff + i] = idx + 1 < src.length ? src[idx] + (src[idx + 1] - src[idx]) * frac : src[idx] || 0
    }
    return
  }
  let scale = absR > 1 ? 1 / absR : 1  // widen kernel for downsample (anti-alias)
  for (let i = 0; i < n; i++) {
    let pos = i * absR + margin
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

const INTERP = { sinc: sincInterp }  // registry — extend here for cubic, hermite, etc.

// ── Plan op ────────────────────────────────────────────────────────────

function resampleSegs(segs, factor, interp) {
  let r = [], dst = 0
  for (let s of segs) {
    let count = Math.round(s[1] * factor)
    let rate = s[4] === null ? undefined : (s[3] || 1) / factor
    r.push(seg(s[0], count, dst, rate, s[4], s[4] === null ? undefined : interp))
    dst += count
  }
  return r
}

const resamplePlan = (segs, ctx) => {
  let targetRate = ctx.rate
  if (!targetRate) return segs
  let factor = targetRate / ctx.sampleRate
  if (factor === 1) return segs
  return resampleSegs(segs, factor, INTERP[ctx.type])
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
    // Sinc has built-in anti-aliasing via widened kernel on downsample — no lowpass needed.
    if (targetRate < ctx.sampleRate && !INTERP[ctx.type])
      edits.push(['lowpass', { freq: targetRate * 0.45 }])
    let opts = { rate: Math.round(targetRate) }
    if (ctx.type) opts.type = ctx.type
    edits.push(['_resample_seg', opts])
    return edits.length === 1 ? edits[0] : edits
  }
})
