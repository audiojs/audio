/**
 * Resample — change sample rate (virtual, non-destructive).
 *
 * a.resample(48000)                 → linear interpolation (default, fast)
 * a.resample(22050)                 → downsample with anti-alias sinc
 * a.resample(48000, {type:'sinc'})  → 32-tap windowed-sinc (Lanczos, polyphase table), high quality
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

const SINC_HALF = 16, TAPS = 2 * SINC_HALF
const sinc = x => x === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x)
// Lanczos window over the kernel's actual support: SINC_HALF taps each side span |x| ≤ SINC_HALF·scale
const lanczos = (x, scale) => sinc(x) * sinc(x / (SINC_HALF * scale))

// The kernel tabulated at PHASES fractional offsets (+1 row to close the interval) with each row's sum for DC
// normalization; a sample between two rows blends their dot products linearly. ~150 dB SNR against evaluating
// sin per tap, which cost 64 sin calls per output sample.
const PHASES = 2048
let banks = new Map()
function bank(scale) {
  let b = banks.get(scale)
  if (b) return b
  let T = new Float64Array((PHASES + 1) * TAPS), W = new Float64Array(PHASES + 1)
  for (let p = 0; p <= PHASES; p++) {
    let w = 0
    for (let j = 0; j < TAPS; j++) w += T[p * TAPS + j] = lanczos((j + 1 - SINC_HALF - p / PHASES) * scale, scale)
    W[p] = w
  }
  banks.set(scale, b = { T, W })
  return b
}

/** Plug-in interpolator: `(src, target, tOff, n, rate, phase) => void`. */
function sincInterp(src, target, tOff, n, rate, phase = 0) {
  let absR = Math.abs(rate), rev = rate < 0
  let scale = absR > 1 ? 1 / absR : 1  // widen kernel for downsample (anti-alias)
  let { T, W } = bank(scale), len = src.length
  for (let i = 0; i < n; i++) {
    let pos = (rev ? n - 1 - i : i) * absR + phase
    let base = Math.floor(pos), f = (pos - base) * PHASES, p = Math.floor(f), mu = f - p, s0 = base + 1 - SINC_HALF
    if (s0 < 0 || s0 + TAPS > len) { target[tOff + i] = edge(src, base, pos - base, scale); continue }
    let r0 = p * TAPS, r1 = r0 + TAPS, a0 = 0, a1 = 0, b0 = 0, b1 = 0
    for (let j = 0; j < TAPS; j += 2) {
      let x = src[s0 + j], y = src[s0 + j + 1]
      a0 += T[r0 + j] * x; a1 += T[r0 + j + 1] * y
      b0 += T[r1 + j] * x; b1 += T[r1 + j + 1] * y
    }
    let a = a0 + a1, w = W[p] + mu * (W[p + 1] - W[p])
    target[tOff + i] = w !== 0 ? (a + mu * (b0 + b1 - a)) / w : 0
  }
}
sincInterp.margin = SINC_HALF

/** One sample whose taps reach past the buffer: the taps inside, evaluated exactly, renormalized. */
function edge(src, base, frac, scale) {
  let sum = 0, w = 0
  for (let t = 1 - SINC_HALF; t <= SINC_HALF; t++) {
    let idx = base + t
    if (idx < 0 || idx >= src.length) continue
    let k = lanczos((t - frac) * scale, scale)
    sum += src[idx] * k; w += k
  }
  return w !== 0 ? sum / w : 0
}

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
  // placed by position, not accumulated count, so overlapping (crossfade) pairs stay aligned
  return segs.map(s => {
    let a = Math.round(s[2] * factor), b = Math.round((s[2] + s[1]) * factor)
    let rate = s[4] === null ? undefined : (s[3] || 1) / factor
    let nextInterp = interp === null ? undefined : interp || s[5]
    return seg(s[0], b - a, a, rate, s[4], s[4] === null ? undefined : nextInterp, s[6])
  })
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
  expand: (ctx) => {
    let targetRate = readRate(ctx.rate)
    let type = readType(ctx.type)
    if (targetRate === ctx.sampleRate) return false
    let opts = { rate: Math.round(targetRate) }
    if (type) opts.type = type
    return ['_resample_seg', opts]
  }
})
