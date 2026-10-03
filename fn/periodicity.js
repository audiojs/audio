/**
 * Periodicity — where a voice sounds, how clean it is and how loud its periodic part: what a step of a chain left of
 * a voice, where level alone can't tell (a denoiser that removes only noise lowers the RMS too).
 *
 * a.stat('voicing', opts)   → the share of the range voiced, 0 to 1
 * a.stat('hnr', opts)       → harmonics-to-noise ratio, dB
 * a.stat('harmonic', opts)  → level of the periodic part, dB (a sine of amplitude A: 20·log10(A) − 3.01)
 *
 * voicing: contour()'s frames with a pitch (pYIN every 10 ms, the pitch curve the editor draws), of the channels' mean.
 * hnr and harmonic: Boersma's (1993) periodicity as Praat's Sound: To Harmonicity (ac) computes it, matched frame by
 *   frame: every 10 ms, the normalized autocorrelation r of 4.5 periods of 75 Hz in a Gaussian window (twice as long,
 *   0.12 s), the window's own autocorrelation divided out (eq. 9), its strongest peak found by sin(x)/x interpolation
 *   (eq. 22); a frame is voiced when that peak beats the silence threshold, 0.1 of the peak of what was read (eq. 23,
 *   voicing threshold 0). r is the share of the frame's power that is periodic (eq. 3): hnr is 10·log10(r / (1 − r))
 *   (eq. 4), averaged over the voiced frames as Praat's Get mean does (null where none is); harmonic is r times the
 *   frame's mean power P, averaged as power, an unvoiced frame's 0 (−Infinity where all are). Several channels are
 *   analysed together, as Praat does: their autocorrelations summed, P their mean.
 *
 * opts: { at, duration, channel }; `bins` as every stat's. The range is read with 0.06 s of context either side, so a
 * frame centred in it has its whole window; a frame belongs to the range or bin its centre is in. The silence
 * threshold and the voicing gate are relative to what was read.
 */

import { fft, ifft } from 'fourier-transform'
import audio, { LOAD, named, parseTime, pickChannels, perChannel } from '../core.js'
import { contours } from './pitch-detect.js'

// Praat's To Harmonicity (ac): time step (s), minimum pitch (Hz), silence threshold, periods per window
const STEP = .01, FLOOR = 75, SILENCE = .1, PERIODS = 4.5
// what is read either side of a range: half the window, s
const CONTEXT = PERIODS / FLOOR

// ── Boersma's periodicity, as Praat computes it ──────────────────

const GOLDEN = 1 - .6180339887498948, SQRT_EPS = Math.sqrt(2 ** -53)

/**
 * The periodicity of `n` samples of `nch` channels at `fs` Hz, as Praat 6.1's Sound_to_Harmonicity_ac runs
 * Sound_to_Pitch_any (method AC_GAUSS, voicing threshold, octave and path costs 0, ceiling the Nyquist frequency).
 * `push(chunk)` takes the next samples, an array per channel; `done()` gives each frame's centre `times` (s from the
 * first sample), `hnr` (dB, −200 unvoiced, as Praat's Harmonicity) and `periodic` power (r·P, 0 unvoiced).
 */
export function harmonicity(n, fs, nch = 1) {
  // Praat's sizes: the Gaussian window is twice as long as the periods asked
  let dx = 1 / fs, periods = 2 * PERIODS, dtw = periods / FLOOR
  let np = Math.floor(1 / dx / FLOOR), hp = (np >> 1) + 1, h = (Math.floor(dtw / dx) >> 1) - 1, nw = 2 * h
  let maxLag = Math.min(Math.floor(nw / periods) + 2, nw), B = Math.floor(nw * .25), N = 1, slots = Math.max(15, Math.floor(.5 / dx / FLOOR)) - 1
  while (N < nw * 1.25) N *= 2
  // frames fit symmetrically in the duration (Sampled_shortTermAnalysis); a frame's sample on the left of its centre,
  // from 0, as Sampled_xToLowIndex rounds it (the 1 added before the floor)
  let D = dx * n, nf = h < 2 || D < dtw ? 0 : Math.floor((D - dtw) / STEP) + 1, x1 = .5 * dx
  let t1 = .5 * D - .5 * nf * STEP + .5 * STEP, left = k => Math.floor((t1 + k * STEP - x1) / dx + 1) - 1

  // the window, its sum of squares and its normalized autocorrelation
  let w = new Float64Array(N), w2 = 0, mid = .5 * (nw + 1), edge = Math.exp(-12)
  for (let i = 1; i <= nw; i++) w2 += (w[i - 1] = (Math.exp(-48 * (i - mid) * (i - mid) / (nw + 1) / (nw + 1)) - edge) / (1 - edge)) ** 2
  let half = N / 2 + 1, pow = new Float64Array(half), zero = new Float64Array(half), ac = new Float64Array(N)
  let spectrum = fft(w)
  for (let k = 0; k < half; k++) pow[k] = spectrum[0][k] ** 2 + spectrum[1][k] ** 2
  let wr = ifft(pow, zero, new Float64Array(N)).map((v, _, a) => v / a[0])

  // r as Praat's lag array y[1 … 2B + 1] holds it, y[k] = r(k − B − 1), r(−τ) = r(τ): NUM_interpolate_sinc at X, depth
  // samples each side
  let y = new Float64Array(2 * B + 2), r = y.subarray(B + 1)
  function sinc(X, depth) {
    let ml = Math.floor(X), mr = ml + 1
    if (X === ml) return y[ml]
    depth = Math.min(depth, mr - 1, 2 * B + 1 - ml)
    return side(mr, 1, depth, Math.PI * (mr - X), ml + depth - X + 1, side(ml, -1, depth, Math.PI * (X - ml), X - mr + depth + 1, 0))
  }
  // s plus n terms from y[k] on, k stepping by dk: sin(a)/a, a = π·distance, tapered by a raised cosine of half-width d
  function side(k, dk, n, a, d, s) {
    let sh = .5 * Math.sin(a), ca = Math.cos(a / d), sa = Math.sin(a / d), cd = Math.cos(Math.PI / d), sd = Math.sin(Math.PI / d)
    for (let j = 0; j < n; j++, k += dk) {
      s += y[k] * (sh / a * (1 + ca))
      a += Math.PI
      let c = ca * cd - sa * sd
      sa = ca * sd + sa * cd; ca = c; sh = -sh
    }
    return s
  }
  // NUMminimize_brent of −sinc over [a, b], tolerance 1e-10: the maximum's place and height into bx, by
  let bx = 0, by = 0
  function brent(a, b) {
    let f = X => -sinc(X, 700), v = a + GOLDEN * (b - a), fv = f(v), x = v, wx = v, fx = fv, fw = fv
    for (let it = 1; it <= 60; it++) {
      let m = (a + b) / 2, tol = SQRT_EPS * Math.abs(x) + 1e-10 / 3
      if (Math.abs(x - m) + (b - a) / 2 <= 2 * tol) break
      let step = GOLDEN * (x < m ? b - x : a - x)
      if (Math.abs(x - wx) >= tol) {
        let t = (x - wx) * (fx - fv), q = (x - v) * (fx - fw), p = (x - v) * q - (x - wx) * t
        q = 2 * (q - t)
        if (q > 0) p = -p; else q = -q
        if (Math.abs(p) < Math.abs(step * q) && p > q * (a - x + 2 * tol) && p < q * (b - x - 2 * tol)) step = p / q
      }
      if (Math.abs(step) < tol) step = step > 0 ? tol : -tol
      let t = x + step, ft = f(t)
      if (ft <= fx) { if (t < x) b = x; else a = x; v = wx; wx = x; x = t; fv = fw; fw = fx; fx = ft }
      else {
        if (t < x) a = t; else b = t
        if (ft <= fw || wx === x) { v = wx; wx = t; fv = fw; fw = ft }
        else if (ft <= fv || v === x || v === wx) { v = t; fv = ft }
      }
    }
    bx = x; by = -fx
  }

  // per frame: the strongest voiced candidate's strength (−1: none), the local peak, the mean power; per candidate: its
  // lag and height (its first estimate, then the bound on it)
  let best = new Float64Array(nf), peak = new Float64Array(nf), power = new Float64Array(nf)
  let lag = new Int32Array(slots), height = new Float64Array(slots), frame = new Float64Array(N)
  function analyze(k, buf, o) {
    pow.fill(0)
    let L = left(k) + 1 - h - o, lp = 0, P = 0
    for (let c = 0; c < nch; c++) {
      // the local mean, a longest period either side; the window, the mean taken off
      let x = buf[c], mean = 0
      for (let i = L + h - np; i < L + h + np; i++) mean += x[i]
      mean /= 2 * np
      for (let j = 0; j < nw; j++) P += (frame[j] = (x[L + j] - mean) * w[j]) ** 2
      // the local peak, half a longest period either side of the centre
      for (let j = Math.max(0, h - hp); j < Math.min(nw, h + hp); j++) lp = Math.max(lp, Math.abs(frame[j]))
      let [re, im] = fft(frame)
      for (let i = 0; i < half; i++) pow[i] += re[i] * re[i] + im[i] * im[i]
    }
    ifft(pow, zero, ac)
    for (let i = 1; i <= B; i++) y[B + 1 - i] = r[i] = ac[i] / (ac[0] * wr[i])
    r[0] = 1
    peak[k] = lp; power[k] = P / (nch * w2); best[k] = -1
    if (!lp) return
    // candidates: the autocorrelation's positive maxima, their strength by parabolic place and sinc height; when there
    // are more than slots, the weakest gives way
    let m = 0
    for (let i = 2; i < maxLag && i < B; i++) {
      if (!(r[i] > 0 && r[i] > r[i - 1] && r[i] >= r[i + 1])) continue
      let dr = .5 * (r[i + 1] - r[i - 1]), d2r = 2 * r[i] - r[i - 1] - r[i + 1], f = 1 / dx / (i + dr / d2r)
      let s = sinc(1 / dx / f + B + 1, 30), j = m
      if (s > 1) s = 1 / s
      if (m < slots) m++
      else {
        j = 0
        for (let q = 1; q < slots; q++) if (height[q] < height[j]) j = q
        if (s <= height[j]) continue
      }
      lag[j] = i; height[j] = s
    }
    // each candidate's height maximized (sinc of depth 700, Brent), though only the strongest voiced one counts: one that
    // can't beat it is left. The autocorrelation's spectrum, the power, is never negative, so the normalized
    // autocorrelation ρ curves at most by its second moment Ω (rad²/sample²): a peak, within half a sample of a sample no
    // higher than r[i], is at most r[i] + Ω/8, over wr as r = ρ/wr. Candidates in order of that bound.
    let num = pow[half - 1] * Math.PI ** 2, den = pow[0] + pow[half - 1]
    for (let i = 1; i < half - 1; i++) { num += 2 * pow[i] * (2 * Math.PI * i / N) ** 2; den += 2 * pow[i] }
    for (let j = 0; j < m; j++) height[j] = r[lag[j]] + num / den / 8 / wr[lag[j] + 1]
    for (;;) {
      let j = -1
      for (let q = 0; q < m; q++) if (height[q] > best[k] && (j < 0 || height[q] > height[j])) j = q
      if (j < 0) break
      height[j] = -Infinity
      brent(lag[j] + B, lag[j] + B + 2)
      let s = by > 1 ? 1 / by : by
      if (1 / dx / (bx - B - 1) < .5 / dx && s > best[k]) best[k] = s
    }
  }

  // samples from the next frame's window on; each channel's extremes and sum, for the global peak
  let buf = Array.from({ length: nch }, () => new Float32Array(nw + 8192)), base = 0, len = 0, next = 0
  let lo = new Float64Array(nch).fill(Infinity), hi = new Float64Array(nch).fill(-Infinity), sum = new Float64Array(nch)
  return {
    push(chunk) {
      let m = chunk[0].length, keep = next < nf ? left(next) + 1 - h : base + len
      if (keep > base) { for (let b of buf) b.copyWithin(0, keep - base, len); len -= keep - base; base = keep }
      if (len + m > buf[0].length) buf = buf.map(b => { let z = new Float32Array(2 * (len + m)); z.set(b.subarray(0, len)); return z })
      for (let c = 0; c < nch; c++) {
        let x = chunk[c], b = buf[c]
        for (let i = 0; i < m; i++) { let v = b[len + i] = x[i]; sum[c] += v; if (v < lo[c]) lo[c] = v; if (v > hi[c]) hi[c] = v }
      }
      len += m
      for (; next < nf && left(next) + h < base + len; next++) analyze(next, buf, base)
    },
    done() {
      // the global peak, each channel's mean taken off; Praat's path finder, with no costs, takes each frame's strongest
      // candidate, the unvoiced one's strength the silence criterion
      let top = 0
      for (let c = 0; c < nch; c++) { let mean = sum[c] / n; top = Math.max(top, hi[c] - mean, mean - lo[c]) }
      let times = new Float64Array(nf), hnr = new Float64Array(nf), periodic = new Float64Array(nf)
      for (let k = 0; k < nf; k++) {
        times[k] = t1 + k * STEP
        let s = best[k], voiced = top > 0 && s > Math.max(0, 2 - (peak[k] > top ? 1 : peak[k] / top) / SILENCE)
        hnr[k] = !voiced ? -200 : s <= 1e-15 ? -150 : s > 1 - 1e-15 ? 150 : 10 * Math.log10(s / (1 - s))
        periodic[k] = voiced ? s * power[k] : 0
      }
      return { times, hnr, periodic }
    }
  }
}

// ── Stats: frames of the range, in its spans ─────────────────────

// the last range each analysis read of an instance: hnr and harmonic, and their bins, share one pass
const last = new WeakMap()

/** The frames of a range from one pass over it: its samples, with CONTEXT either side within the audio, streamed into
 *  `analyzer(n, sr, nch)`; the range's spans (`spans`, or the range), each with the frames [k0, k1) centred in it, a
 *  span's end its own only at the range's end. */
async function spansOf(inst, opts, analyzer) {
  await inst[LOAD]()
  if (!inst.decoded && inst.ready) await inst.ready
  let { at, duration, channel, spans } = named(opts) ?? {}, sr = inst.sampleRate, T = inst.length / sr
  at = parseTime(at); duration = parseTime(duration)
  let t0 = at < 0 ? Math.max(0, T + at) : Math.min(at ?? 0, T), t1 = duration != null ? Math.min(T, t0 + duration) : T
  let s0 = Math.max(0, Math.round((t0 - CONTEXT) * sr)), s1 = Math.max(s0, Math.min(inst.length, Math.round((t1 + CONTEXT) * sr)))
  let read = last.get(inst) ?? last.set(inst, new Map()).get(inst), key = `${inst.version} ${s0} ${s1} ${channel}`
  if (read.get(analyzer)?.key !== key) read.set(analyzer, { key, frames: frames(inst, analyzer, s0, s1, channel) })
  let f = await read.get(analyzer).frames, at0 = s0 / sr, times = f.times, k = 0
  let span = ([s, e]) => {
    while (k > 0 && at0 + times[k - 1] >= s) k--
    while (k < times.length && at0 + times[k] < s) k++
    let k1 = k
    while (k1 < times.length && (at0 + times[k1] < e || e >= t1 && at0 + times[k1] <= e)) k1++
    return [k, k1]
  }
  return { frames: f, spans: (spans ?? [[t0, t1]]).map(span), whole: !spans }
}

/** Samples [s0, s1) of the chosen channels (all by default) through `analyzer`: its frames. */
async function frames(inst, analyzer, s0, s1, channel) {
  let sr = inst.sampleRate, a = analyzer(s1 - s0, sr, channel == null ? inst.channels : 1)
  if (s1 > s0) for await (let chunk of inst.stream({ at: s0 / sr, duration: (s1 - s0) / sr })) a.push(pickChannels(chunk, channel))
  return a.done()
}

/** A frame stat: `of(frames, k0, k1)` over the range, or each of its spans (null as NaN). */
const frameStat = (analyzer, of) => perChannel(async function (opts) {
  let { frames, spans, whole } = await spansOf(this, opts, analyzer)
  return whole ? of(frames, ...spans[0]) : Float32Array.from(spans, ([k0, k1]) => of(frames, k0, k1) ?? NaN)
})

// pYIN's pitch of the channels' mean, as it streams
const pitched = (n, sr, nch) => {
  let write = contours(sr)
  return {
    push(chunk) {
      if (nch === 1) return write(chunk[0])
      let m = new Float32Array(chunk[0].length)
      for (let x of chunk) for (let i = 0; i < m.length; i++) m[i] += x[i] / nch
      write(m)
    },
    done: () => write()
  }
}

audio.stat('voicing', { spans: true })
audio.fn.voicing = frameStat(pitched, ({ f0 }, k0, k1) => {
  let v = 0
  for (let k = k0; k < k1; k++) if (f0[k] > 0) v++
  return k1 > k0 ? v / (k1 - k0) : null
})

audio.stat('hnr', { spans: true })
audio.fn.hnr = frameStat(harmonicity, ({ hnr }, k0, k1) => {
  let s = 0, v = 0
  for (let k = k0; k < k1; k++) if (hnr[k] !== -200) { s += hnr[k]; v++ }
  return v ? s / v : null
})

audio.stat('harmonic', { spans: true })
audio.fn.harmonic = frameStat(harmonicity, ({ periodic }, k0, k1) => {
  let s = 0
  for (let k = k0; k < k1; k++) s += periodic[k]
  return s > 0 ? 10 * Math.log10(s / (k1 - k0)) : -Infinity
})
