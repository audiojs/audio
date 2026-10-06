/**
 * Azimuth: a stereo pair's channels lined up in time and polarity (iZotope RX Azimuth).
 *
 * a.azimuth()                      → the second channel moved onto the first: how late it is, measured over time
 * a.azimuth(0.12)                  → the second channel 0.12 ms earlier (negative: later), as set; a curve { t, v } too
 * a.azimuth({ channel: [2, 3] })   → another pair (each channel after the first is moved onto it)
 *
 * A tape head out of square with the tape (its azimuth) plays one track a little before the other; so do two mics at
 * different distances, and a cable wired backwards inverts one. The pair then sums thin in mono, its highs combed away.
 * Unset, the delay is measured every second (Welch frames of 85 ms, half overlapped): the generalized cross-correlation
 * of the two channels (Knapp & Carter, "The generalized correlation method for estimation of time delay", IEEE Trans.
 * ASSP 24(4), 1976), each frequency weighed by its coherence as their maximum-likelihood weighting has it, γ²/(1 − γ²),
 * searched ±2 ms and refined between samples by Newton's method on the correlation itself, not on its samples. Its sign
 * says the polarity. A second counts where the correlation at its peak holds 0.8 of what a pure delay would give: a
 * mix's own delays (a Haas-panned part, a stereo delay, a spaced pair's room) hold less where they lead (0.3 to 0.76
 * on MUSDB18 mixes), the program as a whole, offset or not, more (0.8 to 1). Their median says whether the pair is out
 * of line: within a tenth of a sample, polarity as it was, it is left as it came, sample for sample (the opening 7 s of 25
 * MUSDB18 test mixes: their median 0.06 samples at most); else each second's delay is the median of it and its counted
 * neighbours two either side, straight from one to the next, so a tape's azimuth that wanders as it plays is followed.
 * Measured on speech delayed by a known fraction (an exact FFT shift), the delay comes back within 0.0001 samples.
 * The second channel is read where the first is, between samples by @audio's Lanczos interpolator (16 zero crossings
 * a side, fn/resample.js), its polarity turned if it was inverted; the first is not touched. Streams 2 ms and 16
 * samples behind (the shift's reach and the interpolator's); with a range, the shift rises from 0 over its first 10 ms
 * and back over its last.
 */
import audio, { arrived, parseTime } from '../core.js'
import { isCurve, curveFn } from '../plan.js'
import { sincInterp } from './resample.js'
import { fft } from 'fourier-transform'

const ALIGN = Symbol('azimuth.align')
// the search reach, s; a measurement every WIN s; frames of FRAME s; a second counts at RHO of a pure delay's peak;
// a pair within TOL samples is left alone; ramps at a range's edges, s; the interpolator's reach, samples
const REACH = 0.002, WIN = 1, FRAME = 0.085, RHO = 0.8, TOL = 0.1, RAMP = 0.01, HALF = 16

const isAuto = v => v == null || v === 'auto'
/** How far the shift may reach, in samples: as measured (the search), as set, or a function's (the search's tenfold). */
function reach(o, sr) {
  let v = o.delay
  if (isAuto(v)) return Math.ceil(REACH * sr)
  if (typeof v === 'number') return Math.ceil(Math.abs(v) * sr / 1000)
  if (isCurve(v)) return Math.ceil(Math.max(...v.v.map(Math.abs)) * sr / 1000)
  return Math.ceil(10 * REACH * sr)
}
const latency = (o, sr) => reach(o, sr) + HALF + 1

function check(o) {
  let v = o.delay
  if (!(isAuto(v) || Number.isFinite(v) || typeof v === 'function' || isCurve(v)))
    throw new TypeError(`azimuth: delay is ms, a curve { t, v } or t => ms, or 'auto', not ${JSON.stringify(v)}`)
}

function azimuth(input, output, ctx) {
  let sr = ctx.sampleRate, len = input[0].length, nch = input.length
  let st = ctx._az
  if (!st) {
    let v = ctx.delay, al = ctx[ALIGN]
    if (isAuto(v) && !al) throw new Error('azimuth: the delay is measured before rendering, through read(), stream() or save()')
    let L = latency(ctx, sr), cap = L + reach(ctx, sr) + HALF + 2
    // each channel after the first: its shift in ms over time, its polarity
    let chans = Array.from({ length: nch }, (_, c) => {
      if (!c) return null
      if (!isAuto(v)) return { f: typeof v === 'function' ? v : isCurve(v) ? curveFn(v) : () => v, sign: 1 }
      let m = al.chans[c - 1]
      return m && { f: curveFn(m.curve), sign: m.sign }
    })
    st = ctx._az = { L, cap, chans, buf: Array.from({ length: nch }, () => new Float32Array(cap + len)), fill: 0, b0: 0, one: new Float32Array(1) }
    st.b0 = Math.round((ctx.blockOffset || 0) * sr) - cap
    st.fill = cap
  }
  let { L, cap, chans, buf, one } = st, p0 = Math.round((ctx.blockOffset || 0) * sr)
  // the history: `cap` samples before this block, then the block
  if (buf[0].length < cap + len) st.buf = buf = buf.map(b => { let n = new Float32Array(cap + len); n.set(b.subarray(0, st.fill)); return n })
  let keep = Math.min(st.fill, cap)
  for (let c = 0; c < nch; c++) { buf[c].copyWithin(0, st.fill - keep, st.fill); buf[c].set(input[c], keep) }
  st.b0 = p0 - keep; st.fill = keep + len
  let ranged = ctx.at != null || ctx.duration != null, R = Math.max(1, Math.round(RAMP * sr))
  let a0 = ctx.at != null ? Math.round((ctx.at + (ctx.blockOffset || 0)) * sr) : 0, a1 = ctx.duration != null ? a0 + Math.round(ctx.duration * sr) : Infinity
  for (let c = 0; c < nch; c++) {
    let x = buf[c], y = output[c], ch = chans[c]
    for (let i = 0; i < len; i++) {
      // the sample `L` before this one, read where it lines up with the first channel
      let q = p0 + i - L, j = q - st.b0
      let r = !ranged ? 1 : q < a0 || q >= a1 ? 0 : Math.min(1, (q - a0 + 0.5) / R, (a1 - q - 0.5) / R)
      if (!ch || !r) { y[i] = j >= 0 ? x[j] : 0; continue }
      let w = r < 1 ? Math.sin(r * Math.PI / 2) ** 2 : 1, d = w * ch.f(q / sr) * sr / 1000, g = ch.sign < 0 ? 1 - 2 * w : 1
      if (!d) { y[i] = g * x[j]; continue }
      sincInterp(x, one, 0, 1, 1, j + d)
      y[i] = g * one[0]
    }
  }
}

/** Measure the delay and polarity of each channel after the first: the edit's input (its range) read once, before
 *  rendering. */
async function prepare(a, index) {
  let o = a.edits[index][1]
  check(o)
  if (!isAuto(o.delay)) { delete o[ALIGN]; return }
  await arrived(a)
  let chs = o.channel == null ? null : [o.channel].flat()
  let stamp = `${a.version}:${a._.len}:${o.at}:${o.duration}:${chs ?? ''}`
  if (o[ALIGN]?.stamp === stamp) return
  let input = audio.from(a, { sampleRate: a._.sr })
  input.edits = a.edits.slice(0, index)
  input.version = index
  let sr = input.sampleRate, T = input.duration, at = parseTime(o.at) ?? 0, d = parseTime(o.duration)
  if (at < 0) at = Math.max(0, T + at)
  let n = Math.max(0, Math.round(Math.min(d ?? Infinity, T - at) * sr))
  let chans = await measure(input.stream({ at, duration: n / sr }), sr, chs)
  o[ALIGN] = { stamp, chans: chans.map(m => m && { ...m, curve: { t: m.curve.t.map(s => at + s), v: m.curve.v } }) }
}

/** Each channel after the first, against it: { curve: { t: s, v: ms }, sign } where it is out of line, else null. */
export async function measure(stream, sr, chs) {
  let N = 2 ** Math.round(Math.log2(FRAME * sr)), hop = N / 2, K = N / 2, per = Math.max(1, Math.round(WIN * sr / hop))
  let win = Float64Array.from({ length: N }, (_, i) => 0.5 - 0.5 * Math.cos(2 * Math.PI * i / N))
  let nch = 0, hist = null, fill = 0, frames = 0, t = 0, G = null, wins = []
  const start = () => G = Array.from({ length: nch }, () => ({ re: new Float64Array(K), im: new Float64Array(K), p: new Float64Array(K) }))
  const frame = () => {
    let X = hist.map(h => { let f = new Float64Array(N); for (let i = 0; i < N; i++) f[i] = h[i] * win[i]; let [re, im] = fft(f); return [Float64Array.from(re), Float64Array.from(im)] })
    for (let c = 0; c < nch; c++) {
      let [ar, ai] = X[0], [br, bi] = X[c], g = G[c]
      for (let k = 1; k < K; k++) {
        g.p[k] += br[k] * br[k] + bi[k] * bi[k]
        if (c) { g.re[k] += ar[k] * br[k] + ai[k] * bi[k]; g.im[k] += ai[k] * br[k] - ar[k] * bi[k] }
      }
    }
    if (++frames === per) { wins.push({ t: t + (per * hop + N - hop) / 2 / sr, est: G.slice(1).map((g, c) => estimate(g, G[0].p, sr, N)) }); frames = 0; t += per * hop / sr; start() }
  }
  for await (let block of stream) {
    let x = chs ? chs.map(c => block[c]) : block
    if (!hist) { nch = x.length; if (nch < 2) return []; hist = x.map(() => new Float64Array(N)); start() }
    for (let i = 0; i < x[0].length;) {
      let k = Math.min(x[0].length - i, N - fill)
      for (let c = 0; c < nch; c++) hist[c].set(x[c].subarray(i, i + k), fill)
      fill += k; i += k
      if (fill === N) { frame(); for (let h of hist) h.copyWithin(0, hop); fill = N - hop }
    }
  }
  if (!hist) return []
  if (frames >= per / 2 || !wins.length && frames) wins.push({ t: t + (frames * hop + N - hop) / 2 / sr, est: G.slice(1).map(g => estimate(g, G[0].p, sr, N)) })
  return Array.from({ length: nch - 1 }, (_, c) => {
    let sure = wins.map(w => ({ t: w.t, ...w.est[c] })).filter(e => e.rho >= RHO)
    if (!sure.length) return null
    let sign = sure.reduce((s, e) => s + e.rho * e.sign, 0) < 0 ? -1 : 1
    // each counted second's delay, the median of it and its two counted neighbours either side
    const median = list => { let s = list.map(e => e.tau).sort((p, q) => p - q); return s.length & 1 ? s[s.length >> 1] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2 }
    if (sign > 0 && Math.abs(median(sure)) < TOL) return null
    let v = sure.map((_, i) => median(sure.slice(Math.max(0, i - 2), i + 3)))
    return { sign, curve: { t: sure.map(e => e.t), v: v.map(d => d * 1000 / sr) } }
  })
}

/** The delay of b behind a in samples, from their cross- and auto-spectra summed over frames; its sign (polarity) and
 *  peak as a share of a pure delay's (rho). */
function estimate(g, pa, sr, N) {
  let K = N / 2, w = new Float64Array(K), ph = new Float64Array(K), om = new Float64Array(K), sum = 0
  for (let k = 1; k < K; k++) {
    let c = g.re[k] * g.re[k] + g.im[k] * g.im[k], q = pa[k] * g.p[k]
    if (!(q > 0)) continue
    let coh = Math.min(0.999, c / q)
    w[k] = coh / (1 - coh); ph[k] = Math.atan2(g.im[k], g.re[k]); om[k] = 2 * Math.PI * k / N; sum += w[k]
  }
  if (!sum) return { tau: 0, sign: 1, rho: 0 }
  const R = tau => { let s = 0; for (let k = 1; k < K; k++) if (w[k]) s += w[k] * Math.cos(ph[k] - om[k] * tau); return s }
  let L = Math.ceil(REACH * sr), best = 0, tau = 0
  for (let l = -L; l <= L; l++) { let r = R(l); if (Math.abs(r) > Math.abs(best)) { best = r; tau = l } }
  // Newton on the correlation's peak (its trough, the polarity inverted)
  let s = Math.sign(best) || 1
  for (let it = 0; it < 8; it++) {
    let d1 = 0, d2 = 0
    for (let k = 1; k < K; k++) if (w[k]) { let a = ph[k] - om[k] * tau; d1 += w[k] * om[k] * Math.sin(a); d2 -= w[k] * om[k] * om[k] * Math.cos(a) }
    d1 *= s; d2 *= s
    if (!(d2 < 0)) break
    let step = Math.max(-0.5, Math.min(0.5, -d1 / d2))
    tau += step
    if (Math.abs(step) < 1e-6) break
  }
  return { tau: Math.max(-L, Math.min(L, tau)), sign: s, rho: Math.abs(R(tau)) / sum }
}

audio.op('azimuth', {
  params: ['delay'],
  ranged: true,
  fnArgs: ['delay'],
  latency,
  warmup: latency,
  prepare,
  process: azimuth,
})
