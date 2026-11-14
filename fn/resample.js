/**
 * Resample — change sample rate (virtual, non-destructive).
 *
 * a.resample(48000)                 → linear interpolation (default, fast)
 * a.resample(22050)                 → downsample with anti-alias sinc
 * a.resample(48000, {type:'sinc'})  → windowed-sinc (Lanczos, 16 zero crossings each side, polyphase table), high quality
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
import { sinc } from './dsp.js'
import audio from '../core.js'

// ── Sinc interpolator (Lanczos-windowed) ───────────────────────────────

// SINC_HALF zero crossings of the lowpass each side: 32 taps at or above the source rate. Downsampling stretches
// the kernel by 1/scale to cut at the new Nyquist and widens the taps with it, so the lowpass keeps its zero
// crossings, and with them its transition band and stopband, up to MAX_HALF taps each side (margin: the context
// plan.js reads around each block).
const SINC_HALF = 16, MAX_HALF = 64
// Lanczos: the sinc under the central lobe of one `a` times wider, zero at the support's ends (±a zero crossings)
const lanczos = (x, a) => sinc(x) * sinc(x / a)

// The kernel tabulated at fractional offsets (+1 row to close the interval) with each row's sum for DC
// normalization; a sample between two rows blends their dot products linearly. PHASES rows at the source rate,
// scale times as many for a stretched kernel, as much smoother: ~150 dB SNR against evaluating sin per tap.
const PHASES = 2048
let banks = new Map()
function bank(scale) {
  let b = banks.get(scale)
  if (b) return b
  let half = Math.min(MAX_HALF, Math.ceil(SINC_HALF / scale - 1e-9)), taps = 2 * half, a = half * scale
  let P = Math.ceil(PHASES * scale), T = new Float64Array((P + 1) * taps), W = new Float64Array(P + 1)
  for (let p = 0; p <= P; p++) {
    let w = 0
    for (let j = 0; j < taps; j++) w += T[p * taps + j] = lanczos((j + 1 - half - p / P) * scale, a)
    W[p] = w
  }
  banks.set(scale, b = { T, W, P, half, taps, a })
  return b
}

/** Plug-in interpolator: `(src, target, tOff, n, rate, phase) => void`. `band`: the lowpass, as a share of the
 *  source's Nyquist, where a resampling before this one read it narrower than this rate does. */
export function sincInterp(src, target, tOff, n, rate, phase = 0, band = 1) {
  let absR = Math.abs(rate), rev = rate < 0
  let scale = Math.min(absR > 1 ? 1 / absR : 1, band)  // widen kernel for downsample (anti-alias)
  let k = bank(scale), { half, taps } = k, len = src.length
  // positions are monotone in i, so the outputs whose taps all lie in src are one run, i0..i1; those either side
  // reach past it
  let inside = i => { let s0 = Math.floor(at(i, n, absR, rev, phase)) + 1 - half; return s0 >= 0 && s0 + taps <= len }
  let i0 = 0, i1 = n
  while (i0 < n && !inside(i0)) i0++
  while (i1 > i0 && !inside(i1 - 1)) i1--
  for (let i = 0; i < i0; i++) target[tOff + i] = edge(src, at(i, n, absR, rev, phase), scale, k)
  for (let i = i1; i < n; i++) target[tOff + i] = edge(src, at(i, n, absR, rev, phase), scale, k)
  // the kernel reads and writes float32: other arrays, and short runs, in the loop
  let m = i1 - i0 >= 16 && sincInterp.simd && src instanceof Float32Array && target instanceof Float32Array && kernel()
  ;(m ? simdDots : dots)(src, target, tOff, n, absR, rev, phase, k, i0, i1, m)
}
sincInterp.margin = MAX_HALF
// false: the JS loop, as where WebAssembly SIMD does not run; the same bits either way
sincInterp.simd = true

// output i's source position
const at = (i, n, absR, rev, phase) => (rev ? n - 1 - i : i) * absR + phase

/** Outputs i0..i1, every tap inside src: two dot products with adjacent rows of the table, blended (resample.wat
 *  computes the same in WebAssembly SIMD, sum for sum) */
function dots(src, target, tOff, n, absR, rev, phase, { T, W, P, half, taps }, i0, i1) {
  for (let i = i0; i < i1; i++) {
    let pos = (rev ? n - 1 - i : i) * absR + phase
    let base = Math.floor(pos), f = (pos - base) * P, p = Math.floor(f), mu = f - p, s0 = base + 1 - half
    let r0 = p * taps, r1 = r0 + taps, a0 = 0, a1 = 0, b0 = 0, b1 = 0
    for (let j = 0; j < taps; j += 2) {
      let x = src[s0 + j], y = src[s0 + j + 1]
      a0 += T[r0 + j] * x; a1 += T[r0 + j + 1] * y
      b0 += T[r1 + j] * x; b1 += T[r1 + j + 1] * y
    }
    let a = a0 + a1, w = W[p] + mu * (W[p + 1] - W[p])
    target[tOff + i] = w !== 0 ? (a + mu * (b0 + b1 - a)) / w : 0
  }
}

/** One sample whose taps reach past the buffer: the taps inside, evaluated exactly, renormalized. */
function edge(src, pos, scale, { half, a }) {
  let base = Math.floor(pos), frac = pos - base, sum = 0, w = 0
  for (let t = 1 - half; t <= half; t++) {
    let idx = base + t
    if (idx < 0 || idx >= src.length) continue
    let k = lanczos((t - frac) * scale, a)
    sum += src[idx] * k; w += k
  }
  return w !== 0 ? sum / w : 0
}

// resample.wat, compiled by wat2wasm (1,336 bytes): dots(), four outputs a pass, each sum's even and odd taps the two
// lanes of a float64x2, as a0 and a1 (b0, b1) are in the loop: the same products added in the same order
const WASM = new Uint8Array([
  0,97,115,109,1,0,0,0,1,17,1,96,13,127,127,127,127,127,127,127,127,124,124,124,127,127,0,3,2,1,0,5,3,1,0,1,7,17,2,6,
  109,101,109,111,114,121,2,0,4,115,105,110,99,0,0,10,254,9,1,251,9,14,6,127,1,123,8,124,3,127,2,123,5,124,3,127,2,123,
  5,124,3,127,2,123,5,124,3,127,2,123,32,12,65,3,116,33,17,32,12,65,2,116,33,16,32,5,33,13,3,64,32,13,32,6,72,4,64,32,
  13,65,4,106,32,6,74,4,64,32,6,65,4,107,33,13,11,32,4,65,1,107,32,13,107,32,13,32,7,27,183,32,8,162,32,9,160,33,23,32,
  23,156,33,24,32,23,32,24,161,32,10,162,33,25,32,25,156,33,26,32,25,32,26,161,33,27,32,0,32,24,170,65,1,106,32,11,107,
  65,2,116,106,33,28,32,3,32,26,170,65,3,116,106,33,30,32,2,32,26,170,32,17,108,106,33,29,253,12,0,0,0,0,0,0,0,0,0,0,0,
  0,0,0,0,0,33,31,253,12,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,33,32,32,4,65,1,107,32,13,65,1,106,107,32,13,65,1,106,32,7,27,
  183,32,8,162,32,9,160,33,33,32,33,156,33,34,32,33,32,34,161,32,10,162,33,35,32,35,156,33,36,32,35,32,36,161,33,37,32,
  0,32,34,170,65,1,106,32,11,107,65,2,116,106,33,38,32,3,32,36,170,65,3,116,106,33,40,32,2,32,36,170,32,17,108,106,33,
  39,253,12,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,33,41,253,12,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,33,42,32,4,65,1,107,32,13,65,
  2,106,107,32,13,65,2,106,32,7,27,183,32,8,162,32,9,160,33,43,32,43,156,33,44,32,43,32,44,161,32,10,162,33,45,32,45,
  156,33,46,32,45,32,46,161,33,47,32,0,32,44,170,65,1,106,32,11,107,65,2,116,106,33,48,32,3,32,46,170,65,3,116,106,33,
  50,32,2,32,46,170,32,17,108,106,33,49,253,12,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,33,51,253,12,0,0,0,0,0,0,0,0,0,0,0,0,0,
  0,0,0,33,52,32,4,65,1,107,32,13,65,3,106,107,32,13,65,3,106,32,7,27,183,32,8,162,32,9,160,33,53,32,53,156,33,54,32,
  53,32,54,161,32,10,162,33,55,32,55,156,33,56,32,55,32,56,161,33,57,32,0,32,54,170,65,1,106,32,11,107,65,2,116,106,33,
  58,32,3,32,56,170,65,3,116,106,33,60,32,2,32,56,170,32,17,108,106,33,59,253,12,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,33,61,
  253,12,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,33,62,65,0,33,14,65,0,33,15,3,64,32,28,32,14,106,253,93,3,0,253,95,33,19,32,
  29,32,15,106,33,18,32,31,32,18,253,0,4,0,32,19,253,242,1,253,240,1,33,31,32,32,32,18,32,17,106,253,0,4,0,32,19,253,
  242,1,253,240,1,33,32,32,38,32,14,106,253,93,3,0,253,95,33,19,32,39,32,15,106,33,18,32,41,32,18,253,0,4,0,32,19,253,
  242,1,253,240,1,33,41,32,42,32,18,32,17,106,253,0,4,0,32,19,253,242,1,253,240,1,33,42,32,48,32,14,106,253,93,3,0,253,
  95,33,19,32,49,32,15,106,33,18,32,51,32,18,253,0,4,0,32,19,253,242,1,253,240,1,33,51,32,52,32,18,32,17,106,253,0,4,0,
  32,19,253,242,1,253,240,1,33,52,32,58,32,14,106,253,93,3,0,253,95,33,19,32,59,32,15,106,33,18,32,61,32,18,253,0,4,0,
  32,19,253,242,1,253,240,1,33,61,32,62,32,18,32,17,106,253,0,4,0,32,19,253,242,1,253,240,1,33,62,32,15,65,16,106,33,
  15,32,14,65,8,106,34,14,32,16,73,13,0,11,32,31,253,33,0,32,31,253,33,1,160,33,20,32,32,253,33,0,32,32,253,33,1,160,
  33,21,32,30,43,3,0,32,27,32,30,43,3,8,32,30,43,3,0,161,162,160,33,22,32,1,32,13,65,2,116,106,32,20,32,27,32,21,32,20,
  161,162,160,32,22,163,68,0,0,0,0,0,0,0,0,32,22,68,0,0,0,0,0,0,0,0,98,27,182,56,2,0,32,41,253,33,0,32,41,253,33,1,160,
  33,20,32,42,253,33,0,32,42,253,33,1,160,33,21,32,40,43,3,0,32,37,32,40,43,3,8,32,40,43,3,0,161,162,160,33,22,32,1,32,
  13,65,1,106,65,2,116,106,32,20,32,37,32,21,32,20,161,162,160,32,22,163,68,0,0,0,0,0,0,0,0,32,22,68,0,0,0,0,0,0,0,0,
  98,27,182,56,2,0,32,51,253,33,0,32,51,253,33,1,160,33,20,32,52,253,33,0,32,52,253,33,1,160,33,21,32,50,43,3,0,32,47,
  32,50,43,3,8,32,50,43,3,0,161,162,160,33,22,32,1,32,13,65,2,106,65,2,116,106,32,20,32,47,32,21,32,20,161,162,160,32,
  22,163,68,0,0,0,0,0,0,0,0,32,22,68,0,0,0,0,0,0,0,0,98,27,182,56,2,0,32,61,253,33,0,32,61,253,33,1,160,33,20,32,62,
  253,33,0,32,62,253,33,1,160,33,21,32,60,43,3,0,32,57,32,60,43,3,8,32,60,43,3,0,161,162,160,33,22,32,1,32,13,65,3,106,
  65,2,116,106,32,20,32,57,32,21,32,20,161,162,160,32,22,163,68,0,0,0,0,0,0,0,0,32,22,68,0,0,0,0,0,0,0,0,98,27,182,56,
  2,0,32,13,65,4,106,33,13,12,1,11,11,11,
])
// outputs a call at most, so the source copied in stays small however long the read
const CHUNK = 4096
let mod

/** The kernel's instance with its memory: the banks copied in as first used, a scratch for the source and the
 *  outputs; null where WebAssembly SIMD does not run */
function kernel() {
  if (mod !== undefined) return mod
  try {
    let { exports } = new WebAssembly.Instance(new WebAssembly.Module(WASM))
    mod = { sinc: exports.sinc, mem: exports.memory, top: 0, x: 0, cap: 0, F32: null, F64: null }
  } catch { mod = null }
  return mod
}

// bytes at the top of the kernel's memory, grown to hold them (the views follow the new buffer)
function alloc(m, bytes) {
  let p = m.top, more = Math.ceil((m.top += bytes + 15 & ~15) / 65536) - m.mem.buffer.byteLength / 65536
  if (more > 0) m.mem.grow(more)
  if (m.F32?.buffer !== m.mem.buffer) { m.F32 = new Float32Array(m.mem.buffer); m.F64 = new Float64Array(m.mem.buffer) }
  return p
}

function simdDots(src, target, tOff, n, absR, rev, phase, k, i0, i1, m) {
  let { P, half, taps } = k, t = k.wasm ??= place(m, k)
  for (let c = i0, e; c < i1; c = e) {
    e = i1 - c < CHUNK + 4 ? i1 : c + CHUNK  // four at least: the kernel's last pass takes four
    // the source outputs c..e read, from the lowest position's first tap to the highest's last, then the outputs
    let lo = Math.floor(at(rev ? e - 1 : c, n, absR, rev, phase)) + 1 - half
    let hi = Math.floor(at(rev ? c : e - 1, n, absR, rev, phase)) + 1 - half + taps
    if (hi - lo + e - c > m.cap) m.x = alloc(m, 4 * (m.cap = 2 * (hi - lo + e - c)))
    let y = m.x + 4 * (hi - lo)
    m.F32.set(src.subarray(lo, hi), m.x / 4)
    m.sinc(m.x - 4 * lo, y - 4 * c, t[0], t[1], n, c, e, rev ? 1 : 0, absR, phase, P, half, taps)
    target.set(m.F32.subarray(y / 4, y / 4 + e - c), tOff + c)
  }
}

// a bank's rows and sums, copied into the kernel's memory: their addresses
function place(m, { T, W }) {
  let t = alloc(m, T.byteLength), w = alloc(m, W.byteLength)
  m.F64.set(T, t / 8); m.F64.set(W, w / 8)
  return [t, w]
}

const INTERP = { sinc: sincInterp }

// A chain of resamples reads its source once, at the product of their rates, so a rate the chain went down to and
// back up from would vanish (44.1 kHz → 8 kHz → 44.1 kHz read at 1, all of it): the narrowest band the chain passed,
// as a share of the source's Nyquist, stays the read's lowpass.
const bands = new Map()
function bandSinc(band) {
  let f = bands.get(band)
  if (!f) {
    f = (src, target, tOff, n, rate, phase) => sincInterp(src, target, tOff, n, rate, phase, band)
    f.margin = MAX_HALF
    f.band = band
    bands.set(band, f)
  }
  return f
}

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
    // the narrowest band read so far: this read's own, or one before it went down further
    let was = Math.min(s[5]?.band ?? 1, 1 / Math.max(1, Math.abs(s[3] || 1))), now = 1 / Math.max(1, Math.abs(rate || 1))
    let nextInterp = interp === null ? undefined : was < now ? bandSinc(was) : interp || (s[5]?.band ? undefined : s[5])
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

audio.op('_resample_seg', { hidden: true, plan: resamplePlan, sr: (curSr, ctx) => readRate(ctx.rate),
  limit: (limit, ctx) => Math.round(limit * (ctx.rate || ctx.sampleRate) / ctx.sampleRate) })

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
