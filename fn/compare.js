/**
 * Compare: what changed from a reference, the sound before an edit, to this sound, the after. It reports what it
 * measured and the condition it measured it under, and names no cause: each line is a measure's name, its numbers and
 * units, and that condition.
 *
 * await after.compare(before) → { lag, why, period, readings, gain, polarity, swapped, difference, voice, measures, changes }
 *
 * - measures: [{ name, unit, before, after, delta }], each sound measured alone, true whatever the edit was: duration,
 *   channels, sampleRate; loudness, lra, truepeak, noisefloor (the library's stats); from a pass over the samples:
 *   clipping (samples at 16-bit full scale or past it, every channel's), over (samples past full scale), dc (the
 *   channel's mean furthest from 0), correlation and width (side over mid, dB) of the first two channels, and the level
 *   of each octave band (IEC 61260-1:2014, base 10: G = 10^(3/10), §5.2 eq. 1; mid-bands 1000·G^x Hz, §5.3, §5.4 eq. 2;
 *   edges G^∓½ about them, 3.8 and 3.10; named by their nominal mid-bands, §5.5), its share of the mean square from a
 *   Welch spectrum (Hann frames near 0.2 s, half overlapped), in dB.
 * - lag: s, the lag the readings agree on over the stretches they read (this sound later there than the reference:
 *   positive), to 0.01 of a sample. It is read in four spans of each (two lined up at the starts, two at the ends: a
 *   length changed between them shows as the two pairs apart), each channel pair's correlation within ±WITHIN s; a
 *   span's reading is the lag its correlation peaks at, which a part of the span need not share (a cut inside it). A
 *   number where both sounds are SHORT s or longer, two spans at least share a waveform (RHO; one, where only one holds
 *   sound in both), every span and channel that shares one reads the same lag within TOL ms, and no correlation peaks
 *   again, past a dip under half of it, within AMBIG of its top; else null, `why` the first of these that fails:
 *   'short', 'unrelated', 'varies', 'repeats' (`period`: s from the top to that peak).
 *   readings: what each span read, { at, duration, channel, lag } (at and duration in this sound, s; lag in s, null
 *   where it shares no waveform; channel null where the channel counts differ and their downmixes are read).
 * - gain: dB of the least-squares gain from the reference, aligned at the lag, to this sound, each channel's sign taken
 *   off; polarity: each channel's, 1 or -1 (-1 where the reference turned holds over half of that channel's energy);
 *   swapped: of two channels, each correlates more with the other's reference; difference: dB of what is left once the
 *   reference at that gain and those signs is taken away, over the reference at that gain (-Infinity: nothing;
 *   +Infinity: none of it left; the channels' downmix where their counts differ).
 * - voice: { frames, change: { p10, p50, p90 }, under, over, silenced }: over the reference's voiced frames
 *   (@audio/vad's `voiced`, on the reference's channels' mean, WINDOW s at a time as the dialog stat reads it), the
 *   change of each frame's level in the voice band from before to after, dB, at the lag: its 10th, 50th and 90th
 *   percentiles (nearest rank); `under`, the share 10 dB or more under the median change, `over`, 10 dB or more over
 *   it; `silenced`, the share that stood 10 dB or more over the reference's noise floor and here stands under it, the
 *   floor moved by the loudness change (so a gain on everything moves none), or is zero (a choice: a frame heard clear
 *   of the noise the reference was recorded in, of which nothing stands out of it now). Null under VOICED s of
 *   voicing.
 * - gain, polarity, difference and voice are read at the lag: null where it is null; swapped, where the spans were read.
 * - changes: the lag, with the stretches read and those that share no waveform, or why there is none; then a line for
 *   each measure that moved past its resolution (THRESHOLDS).
 */
import { FULL } from '../core.js'
import { welch } from './match.js'
import { printed } from './loudness.js'
import { downmix, pow2 } from './dsp.js'
import { sincInterp } from './resample.js'
import { fft, ifft } from 'fourier-transform'
import { highpass, lowpass, cascade, state } from '@audio/biquad'

// Spans of SPAN s at most, a quarter of the shorter sound; a lag searched within ±WITHIN s; the voice read WINDOW s at
// a time; its figures null under VOICED s of voiced frames (a choice: three words' length or so, under it the
// percentiles stand on a handful of frames)
const SPAN = 10, WITHIN = 5, WINDOW = 10, VOICED = 1
// Under SHORT s no lag is read: read whole, as one span, unrelated pieces of one voice under 2 s were given a lag in
// about a third of trials (50 ms to 1.5 s: 7 of 29 up to 14 of 43); from 2 s, read in four spans of 0.5 s or more,
// none (two unrelated pieces of 2 and 3 s, 52 trials)
const SHORT = 2
// A shared waveform: a channel's correlation peak holding RHO of its span's energy (√(Σx²·Σr²)). Measured over 10 s
// spans: halves of one voice that share nothing peak at 0.08, at 0.13 with one 60 Hz hum in both, two noises at 0.01; a
// voice a denoiser took 60 % of at 0.29, a copy at 1. A short span passes it by chance more often (in 43 of those 52
// pairs, two spans of 0.5 or 0.75 s or more passed it, at lags of their own): so two spans must, and agree
const RHO = 0.2
// A peak stands clear where no other, past a dip under half of it, comes within AMBIG of it, each lag's correlation
// over the energies of the samples the two share there (a lag of a sound that repeats shares fewer, and would read
// lower by that alone), among lags that share half the span or more. Measured: a voice against itself peaks a second
// time at 0.94 at most over spans of 0.5 s, 0.89 of 1 s, 0.72 of 3 s (lena, every quarter second); a 1 kHz tone, a
// sawtooth of 441 samples and a pulse train of 1000 at 1.000, a 60 Hz hum 20 dB over noise at 0.990 (a copy's noise
// tells its lag apart, 10 dB over noise at 0.91)
const AMBIG = 0.99
// The readings within TOL ms of each other: one lag. A copy delayed by a whole or a fractional lag reads the same whole
// lag in every span and channel, a denoised voice within a sample, a 4th-order filter's group delay up to 6.3 samples
// (0.14 ms) apart between spans whose spectra differ (measured: see the tests); a cut or an insert of 0.25 ms or more
// moves the timeline past it, a channel 20 samples (0.45 ms) later than the others stands apart
const TOL = 0.25
// A lag within FRAC of a whole sample is read as whole: the reference is not shifted between samples
const FRAC = 0.005
// The voice band, 300 to 3400 Hz, telephony's (ITU-T G.712): a frame's level read through a 2nd-order Butterworth high-
// and low-pass at its edges, so a change under or over it (a rumble filtered, a hiss) moves no frame by much
const BAND = [300, 3400]

// What change is worth a line, each the measure's resolution here (a choice, with its reason, where no document gives
// one); a line is said where a measure moved by more than it:
// - lag: 0.01 of a sample, the lag's own (FRAC); duration, channels, sample rate, polarity, a swap: any
// - loudness: 1 LU, the tolerance EBU R 128-2023 (h) permits "where attaining the Target Level is not achievable
//   practically" and Apple's "+/- 1 dB" around -16 LKFS
// - lra: 1 LU, a choice: no document names an LRA change worth telling (EBU Tech 3343-2023 §3.3 reads a lower LRA after
//   a chain as the sign of "a reduction process", without a number); the step loudness itself is held to
// - truepeak: 1 dB, a choice: over three times the ±0.3 dB R 128 (m) allows meters to read apart; and any move past -1
//   dBTP as printed (to 0.01), the ceiling of R 128 (m), Apple's recommendation and normalize()'s
// - noisefloor, width, an octave against the median change of the octaves: 3 dB, a choice: the power doubled or halved.
//   The octaves weighed: those within 60 dB of the loudest, before or after (a choice; a voice's 16 kHz octave, 66 dB
//   under its loudest, is left out)
// - clipping, over: any sample more or fewer
// - dc: 0.001 (-60 dBFS): a step that size at a cut stands where ACX holds the noise floor
// - correlation: 0.2, a choice: two channels that share nothing read within 0.02 of 0 over a few seconds (measured: a
//   voice against a noise 0.001, two halves of one voice 0.014, two noises 0.002), so a move of 0.2 is no estimate's
//   spread
// - difference: from 60 dB under the reference: a 16-bit save of a program at -20 dBFS (its TPDF dither and rounding,
//   2^-16 RMS: -96 dBFS) stands 76 dB under it; an edit of the content stands far over that
// - voice: a percentile 1 dB from no change (loudness's step), or a share of 1 %, a choice: omlsa() on a voice under
//   noise 30 dB down moves none of them, a word silenced, 0.3 s of 12, is 2.5 to 2.8 % of the frames. Its 10 dB (under,
//   over), a choice: a frame heard half as loud or twice (loudness halves for each 10 dB down: S. S. Stevens, "The
//   measurement of loudness", JASA 27, 1955)
const THRESHOLDS = { loudness: 1, lra: 1, truepeak: 1, noisefloor: 3, width: 3, band: 3, dc: 0.001, correlation: 0.2, difference: -60, voice: 1, share: 0.01, apart: 10 }

const G = 10 ** 0.3, OCTAVES = ['31.5 Hz', '63 Hz', '125 Hz', '250 Hz', '500 Hz', '1 kHz', '2 kHz', '4 kHz', '8 kHz', '16 kHz']
  .map((name, i) => { let f = 1000 * G ** (i - 5); return { name: `${name} octave`, lo: f / Math.sqrt(G), hi: f * Math.sqrt(G) } })

const db = p => p > 0 ? 10 * Math.log10(p) : -Infinity
const spread = t => Math.max(...t) - Math.min(...t)
const chans = n => Array.from({ length: n }, (_, c) => c)

/** A sound's own measures: its stats, then one pass over its samples (the spectrum, the samples at and past full scale,
 *  each channel's sum and square, the first two's product). A sample that is not a finite number makes every measure
 *  past it meaningless: an error naming where */
async function measure(a, who) {
  // the stats first: they wait for the sound to load and decode whole
  let [loudness, lra, truepeak, noisefloor] = await a.stat(['loudness', 'lra', 'truepeak', 'noisefloor'])
  let sr = a.sampleRate, nch = a.channels, N = pow2(sr / 5), w = chans(nch).map(() => welch(N))
  let n = 0, over = 0, clipping = 0, peak = 0, bad = 0, at = 0, xy = 0, sum = new Float64Array(nch), sq = new Float64Array(nch)
  for await (let chunk of a.stream()) {
    chunk.forEach((x, c) => {
      w[c].push(x)
      for (let i = 0; i < x.length; i++) {
        let v = x[i], m = Math.abs(v)
        if (!(m < Infinity)) { if (!bad++) at = n + i; continue }
        sum[c] += v; sq[c] += v * v
        if (m >= FULL) clipping++
        if (m > 1) over++
        if (m > peak) peak = m
      }
    })
    if (nch > 1) for (let i = 0, [l, r] = chunk; i < l.length; i++) xy += l[i] * r[i]
    n += chunk[0].length
  }
  if (bad) throw new RangeError(`compare: ${who} holds ${bad} sample${bad > 1 ? 's' : ''} not a finite number (NaN or ±Infinity), the first at ${(at / sr).toFixed(3)} s`)
  let m = { duration: a.duration, channels: nch, sampleRate: sr, loudness: loudness ?? -Infinity, lra, truepeak, noisefloor, peak, over, clipping,
    dc: n ? Array.from(sum, v => v / n).reduce((p, v) => Math.abs(v) > Math.abs(p) ? v : p, 0) : 0 }
  if (nch > 1) {
    let [xx, yy] = sq
    m.correlation = xx > 0 && yy > 0 ? xy / Math.sqrt(xx * yy) : 0
    m.width = db((xx + yy - 2 * xy) / (xx + yy + 2 * xy))
  }
  // each octave's share of the mean square: the bins of the one-sided spectrum (those inside the two ends doubled) in it
  let P = w.map(x => x.power())
  if (P[0]) {
    let k = (v, i) => i && i < N / 2 ? 2 * v : v, p = P[0].map((_, i) => k(P.reduce((q, x) => q + x[i], 0), i)), all = p.reduce((q, v) => q + v, 0)
    let total = sq.reduce((q, v) => q + v, 0) / nch / n
    m.bands = OCTAVES.filter(b => b.lo < sr / 2).map(b => {
      let e = 0
      for (let i = Math.ceil(b.lo * N / sr); i < Math.min(p.length, b.hi * N / sr); i++) e += p[i]
      return all > 0 ? db(total * e / all) : -Infinity
    })
  }
  return m
}

/** A sound's samples from `at` s, n at a time (fewer at its end, none after it) */
function reader(a, at) {
  let it = a.stream({ at })[Symbol.asyncIterator](), queue = [], have = 0, end = false
  let read = async n => {
    while (have < n && !end) {
      let r = await it.next()
      if (r.done) end = true
      else if (r.value[0].length) { queue.push(r.value.map(x => x.slice())); have += r.value[0].length }
    }
    let m = Math.min(n, have), out = Array.from({ length: a.channels }, () => new Float32Array(m))
    for (let o = 0; o < m;) {
      let q = queue[0], k = Math.min(q[0].length, m - o)
      out.forEach((x, c) => x.set(q[c].subarray(0, k), o))
      o += k
      if (k === q[0].length) queue.shift(); else queue[0] = q.map(x => x.subarray(k))
    }
    have -= m
    return out
  }
  read.close = () => it.return?.()
  return read
}

/** A reader's samples f of a sample later (x(i − f)), through the library's sinc (fn/resample.js: Lanczos, 16 zero
 *  crossings): its margin read ahead, before the start zeros */
function shifted(read, f, nch) {
  if (!f) return read
  let H = sincInterp.margin, past = chans(nch).map(() => new Float32Array(H)), ahead = past.map(() => new Float32Array(0)), end = false
  let out = async n => {
    while (ahead[0].length < n + H && !end) {
      let r = await read(Math.max(n, 4 * H))
      if (!r[0].length) end = true
      ahead = ahead.map((x, c) => { let y = new Float32Array(x.length + r[c].length); y.set(x); y.set(r[c], x.length); return y })
    }
    let m = Math.min(n, ahead[0].length)
    let z = ahead.map((x, c) => {
      let src = new Float32Array(2 * H + m), y = new Float32Array(m)
      src.set(past[c]); src.set(x.subarray(0, m + H), H)
      if (m) sincInterp(src, y, 0, m, 1, H - f)
      return y
    })
    past = past.map((p, c) => { let s = new Float32Array(H + m); s.set(p); s.set(ahead[c].subarray(0, m), H); return s.slice(m) })
    ahead = ahead.map(x => x.subarray(m))
    return z
  }
  out.close = read.close
  return out
}

/** The cross-correlations of channel pairs by FFT, x's channels against r's: c(d) = Σ x[i]·r[i − d] at whole lags, and
 *  c.at(t) between them, the cross-spectrum's inverse transform read at t (the two spans band-limited, exact) */
function correlations(xs, rs) {
  let M = pow2(xs[0].length + rs[0].length), K = M / 2 + 1, spec = new Map()
  let of = (s, k) => spec.get(k) ?? spec.set(k, (() => { let a = new Float64Array(M); a.set(s); return fft(a).map(v => v.slice()) })()).get(k)
  return pairs => pairs.map(([i, j]) => {
    let [xr, xi] = of(xs[i], `x${i}`), [rr, ri] = of(rs[j], `r${j}`), gr = new Float64Array(K), gi = new Float64Array(K)
    for (let k = 0; k < K; k++) { gr[k] = xr[k] * rr[k] + xi[k] * ri[k]; gi[k] = xi[k] * rr[k] - xr[k] * ri[k] }
    let cc = ifft(gr, gi, new Float64Array(M)), c = d => cc[((d % M) + M) % M]
    c.at = t => {
      let th = 2 * Math.PI * t / M, wc = Math.cos(th), ws = Math.sin(th), u = 1, v = 0, s = 0
      for (let k = 1; k < K - 1; k++) { let w = u * wc - v * ws; v = u * ws + v * wc; u = w; s += gr[k] * u - gi[k] * v }
      return (gr[0] + gr[K - 1] * Math.cos(Math.PI * t) + 2 * s) / M
    }
    return c
  })
}

/** f's peak between d − 1 and d + 1, by golden section, where it passes v0 (f(d)): its t */
function refine(f, d, v0) {
  let lo = d - 1, hi = d + 1, R = (Math.sqrt(5) - 1) / 2, a = hi - R * (hi - lo), b = lo + R * (hi - lo), fa = f(a), fb = f(b)
  for (let k = 0; k < 40; k++) {
    if (fa < fb) { lo = a; a = b; fa = fb; b = lo + R * (hi - lo); fb = f(b) }
    else { hi = b; b = a; fb = fa; a = hi - R * (hi - lo); fa = f(a) }
  }
  let t = (lo + hi) / 2
  return f(t) > v0 ? t : d
}

const energies = x => { let p = new Float64Array(x.length + 1); for (let i = 0; i < x.length; i++) p[i + 1] = p[i] + x[i] * x[i]; return p }

/** What correlation c of x against r (each n samples) reads within ±max: { d, rho, v } its peak, rho over the span's
 *  energies; where it shares a waveform (RHO), `again`: the nearest lag it peaks at again within AMBIG of it */
function reading(c, x, r, max) {
  let n = x.length, px = energies(x), pr = energies(r), E = Math.sqrt(px[n] * pr[n])
  let d = 0, v = -1
  for (let k = -max; k <= max; k++) { let u = Math.abs(c(k)); if (u > v) v = u, d = k }
  let rho = E > 0 ? v / E : 0
  if (rho < RHO) return { d: null, rho, v }
  // each lag's correlation over the energies the two share there
  let u = k => { let i0 = Math.max(0, k), i1 = Math.min(n, n + k), e = (px[i1] - px[i0]) * (pr[i1 - k] - pr[i0 - k]); return e > 0 ? Math.abs(c(k)) / Math.sqrt(e) : 0 }
  let top = u(d), again = null
  for (let s of [-1, 1]) {
    let low = Infinity
    for (let k = d + s; Math.abs(k) <= Math.min(max, n >> 1); k += s) {
      let q = u(k)
      low = Math.min(low, q)
      if (low > top / 2 || q < AMBIG * top || q < u(k - 1) || q < u(k + 1)) continue
      if (again == null || Math.abs(k - d) < Math.abs(again - d)) again = k
      break
    }
  }
  return { d, rho, v, again }
}

/** The lag, in samples, of a behind b (a[i] ≈ b[i − tau]) that the spans' readings agree on: { tau, cross, readings };
 *  else { why, period?, cross, readings }. Each span read for each channel pair: straight, and of two channels crossed
 *  too, the pairing whose shared peaks hold more taken (cross: a swap) */
async function lags(a, b) {
  let sr = a.sampleRate, L = Math.min(a.length, b.length), n = Math.min(Math.round(SPAN * sr), Math.floor(L / 4))
  let max = Math.min(Math.round(WITHIN * sr), n - 1), same = a.channels === b.channels, m = same ? a.channels : 1
  let read = async (s, i) => { let x = (await s.read({ at: i / sr, duration: n / sr })).map(c => Float64Array.from(c.subarray(0, n))); return same ? x : [downmix(x)] }
  let pairings = [chans(m).map(c => [c, c]), ...m === 2 ? [[[0, 1], [1, 0]]] : []], spans = []
  for (let [i, j] of [[0, 0], [n, n], [a.length - 2 * n, b.length - 2 * n], [a.length - n, b.length - n]]) {
    let x = await read(a, i), r = await read(b, j), of = correlations(x, r)
    spans.push({ i, j, by: pairings.map(g => of(g).map((c, k) => reading(c, x[g[k][0]], r[g[k][1]], max))) })
  }
  // the pairing whose shared peaks hold more over the spans
  let held = g => spans.reduce((s, p) => s + p.by[g].reduce((q, x) => q + (x.d == null ? 0 : x.v), 0), 0)
  let g = pairings.length > 1 && held(1) > held(0) ? 1 : 0, cross = g === 1, sec = v => v / sr
  let readings = spans.flatMap(p => p.by[g].map((x, c) => ({ at: sec(p.i), duration: sec(n), channel: same ? c : null, lag: x.d == null ? null : sec(x.d + p.i - p.j) })))
  let read0 = spans.filter(p => p.by[g].some(x => x.d != null)), sounding = spans.filter(p => p.by[g].some(x => x.v > 0))
  if (!read0.length || read0.length < Math.min(2, sounding.length)) return { why: 'unrelated', cross, readings }
  let lagged = readings.filter(x => x.lag != null).map(x => x.lag * sr)
  if (spread(lagged) > TOL * sr / 1000) return { why: 'varies', cross, readings }
  let rep = spans.flatMap(p => p.by[g].map((x, c) => ({ ...x, at: sec(p.i), duration: sec(n), channel: same ? c : null }))).find(x => x.again != null)
  if (rep) return { why: 'repeats', period: sec(Math.abs(rep.again - rep.d)), at: rep.at, duration: rep.duration, channel: rep.channel, cross, readings }
  // between samples on the first span that shares one: its pairs' correlations summed, each with its sign, at their
  // peak within TOL of the readings
  // the pairs of that span that share one alone: a pair that shares nothing there only adds its noise to the peak
  let { i, j, by } = read0[0], x = await read(a, i), r = await read(b, j), d0 = Math.round(lagged[0]) - i + j, d = d0
  let cs = correlations(x, r)(pairings[g]).filter((_, k) => by[g][k].d != null)
  // each lag's correlation over the n − |t| samples the two spans share there: summed over a falling count, a broad peak
  // (a tone over a DC offset) leans toward 0 by up to 0.02 sample
  let sum = k => cs.reduce((s, c) => s + Math.abs(c(k)), 0) / (n - Math.abs(k)), w = Math.ceil(TOL * sr / 1000)
  for (let k = Math.max(-max, d0 - w); k <= Math.min(max, d0 + w); k++) if (sum(k) > sum(d)) d = k
  let sg = cs.map(c => Math.sign(c(d)) || 1), f = t => cs.reduce((s, c, k) => s + sg[k] * c.at(t), 0) / (n - Math.abs(t))
  return { tau: refine(f, d, f(d)) + i - j, cross, readings }
}

/** What a reads sample by sample against b, aligned (a's channels tau samples behind b's, b at a's rate, its channels
 *  crossed where `cross`): gain, polarity, difference; the voice, its frames against b's noise floor `floor`
 *  and that floor moved by the loudness change `shift` */
async function pair(a, b, tau, cross, floor, shift) {
  let sr = a.sampleRate, W = Math.round(WINDOW * sr), same = a.channels === b.channels, m = same ? a.channels : 1
  let map = same ? (cross ? [1, 0] : chans(m)) : [0], D = Math.round(tau), f = Math.abs(tau - D) < FRAC ? 0 : tau - D, i0 = Math.max(0, D)
  let { vad } = await import('@audio/vad').catch(e => { throw new Error(`compare: the voice's frames need @audio/vad (${e.message})`) })
  // a[i0 + i] ≈ b[i0 − D + i]
  let ra = reader(a, i0 / sr), rb = shifted(reader(b, (i0 - D) / sr), f, b.channels)
  let xx = new Float64Array(m), xy = new Float64Array(m), yy = new Float64Array(m), changes = [], silent = 0, hop = 0
  let band = [highpass(BAND[0], Math.SQRT1_2, sr), lowpass(BAND[1], Math.SQRT1_2, sr)], states = chans(2 * m).map(() => [state(), state()])
  let energy = (chs, f, t) => { let e = 0; for (let ch of chs) for (let i = f; i < t; i++) e += ch[i] * ch[i]; return e }
  try {
    for (;;) {
      let y = await ra(W), x = await rb(W), n = Math.min(y[0]?.length ?? 0, x[0]?.length ?? 0)
      if (!n) break
      let [xs, ys] = same ? [map.map(c => x[c].subarray(0, n)), y.map(c => c.subarray(0, n))] : [[downmix(x, n, Float32Array)], [downmix(y, n, Float32Array)]]
      for (let c = 0; c < m; c++) for (let i = 0, p = xs[c], q = ys[c]; i < n; i++) { xx[c] += p[i] * p[i]; xy[c] += p[i] * q[i]; yy[c] += q[i] * q[i] }
      // the reference's voiced frames (found in its downmix), each one's level in the voice band, summed over the
      // channels (so channels that cancel in a downmix, one's polarity turned, lose no voice), before and after
      let v = vad(downmix(xs, n, Float32Array), { fs: sr }), [xb, yb] = [xs, ys].map((chs, s) => chs.map((ch, c) => cascade(Float32Array.from(ch), band, states[s * m + c])))
      hop = v.hop
      for (let k = 0; k < v.voiced.length; k++) if (v.voiced[k]) {
        let f = k * v.hop, t = Math.min(n, f + v.frameSize), e = energy(yb, f, t), e0 = energy(xb, f, t), level = q => db(q / (t - f) / m)
        changes.push(db(e) - db(e0))
        if (!(e > 0) || level(e) < floor + shift && level(e0) >= floor + THRESHOLDS.apart) silent++
      }
      if (n < W) break
    }
  } finally { ra.close(); rb.close() }
  // each channel's sign; the gain over all of them, signs taken off
  let sign = Array.from(xy, v => v < 0 ? -1 : 1), XX = xx.reduce((p, v) => p + v, 0), YY = yy.reduce((p, v) => p + v, 0), XY = xy.reduce((p, v) => p + Math.abs(v), 0)
  return {
    gain: XX > 0 && XY > 0 ? 20 * Math.log10(XY / XX) : null,
    // turned only where the turned reference is over half of that channel: of two that hardly correlate, the sign is noise
    polarity: sign.map((s, c) => s < 0 && xy[c] * xy[c] > xx[c] * yy[c] / 2 ? -1 : 1),
    // none of the reference in this sound (unrelated, or silent: muted is all of it gone, not nothing changed): +Infinity
    difference: !(XX > 0) ? null : XY === 0 ? Infinity : db(Math.max(0, YY * XX / (XY * XY) - 1)),
    voice: changes.length * hop < VOICED * sr ? null : voice(changes, silent),
  }
}

/** The voiced frames' changes (dB, after over before; -Infinity: nothing left), and how many were silenced */
function voice(changes, silent) {
  let n = changes.length, s = Float64Array.from(changes).sort(), at = p => s[Math.ceil(p * n) - 1], p50 = at(0.5)
  let share = keep => changes.filter(keep).length / n, A = THRESHOLDS.apart
  return { frames: n, change: { p10: at(0.1), p50, p90: at(0.9) }, under: share(v => v < p50 && v <= p50 - A), over: share(v => v > p50 && v >= p50 + A), silenced: silent / n }
}

// ── Lines ───────────────────────────────────────────────────────────────

const f2 = v => Number.isFinite(v) ? v.toFixed(2) : v < 0 ? '-∞' : '+∞'
const pct = v => `${(v * 100).toFixed(1)} %`

/** A line for each measure past its resolution, and the lag or why there is none (`t`: where a sound repeats, and in
 *  which channel) */
function lines(rows, p, sr, t) {
  let T = THRESHOLDS, out = [], r = Object.fromEntries(rows.map(x => [x.name, x])), off = x => x && x.before !== x.after
  let past = (x, t) => x && x.delta != null && Math.abs(x.delta) > t
  let samples = s => { let n = s * sr, w = Math.round(n); return Math.abs(n - w) < FRAC ? `${w} sample${Math.abs(w) === 1 ? '' : 's'}` : `${n.toFixed(2)} samples` }
  let span = s => Math.abs(s) < 1 ? `${(s * 1000).toFixed(1)} ms (${samples(s)})` : `${s.toFixed(3)} s`
  // the stretches read, those apart by less than the printed step (0.01 s) as one
  let from = xs => { let t = []; for (let x of [...xs].sort((u, v) => u.at - v.at)) { let e = t[t.length - 1]; if (e && x.at < e[1] + 0.005) e[1] = Math.max(e[1], x.at + x.duration); else t.push([x.at, x.at + x.duration]) } return t.map(([u, v]) => `from ${u.toFixed(2)} s to ${v.toFixed(2)} s`).join(', ') }
  let named = c => c == null || r.channels.after === 1 ? '' : r.channels.after === 2 ? ['left ', 'right '][c] : `channel ${c + 1} `
  let none = '; no gain, polarity, difference or voice read'
  let shared = p.readings.filter(x => x.lag != null), spans = new Set(p.readings.map(x => x.at)).size
  // the lag, at 0 too, and the stretches its readings were read over; then those that share no waveform with before,
  // a span whose every channel shares none, or a channel of a span whose others do: no stretch reads as read that was
  // not. A silent sound has no reading: its lag is taken as 0
  if (p.lag != null) {
    let whole = p.readings.filter((x, i, a) => a.findIndex(y => y.at === x.at) === i && a.every(y => y.at !== x.at || y.lag == null))
    let part = p.readings.filter(x => x.lag == null && !whole.some(y => y.at === x.at)), ch = c => r.channels.after === 2 ? `the ${named(c)}channel` : named(c).trim()
    let apart = [...whole.length ? [from(whole)] : [], ...[...new Set(part.map(x => x.channel))].map(c => `in ${ch(c)} ${from(part.filter(x => x.channel === c))}`)]
    let gone = apart.length ? `; no waveform shared with before ${apart.join(' and ')}` : ''
    out.push(p.readings.length ? `lag ${p.lag === 0 ? '0' : span(p.lag)}, read ${from(shared)}${gone}` : 'lag 0, not read: this sound holds no sound')
  }
  if (p.why === 'short') out.push(`no lag: ${Math.min(r.duration.before, r.duration.after).toFixed(3)} s, under the ${SHORT} s a lag is read over${none}`)
  if (p.why === 'repeats') out.push(`no lag: ${!named(t.channel) ? 'its' : r.channels.after === 2 ? `the ${named(t.channel)}channel's` : `${named(t.channel).trim()}'s`} correlation with before peaks again within ${pct(1 - AMBIG)} of its top ${span(p.period)} from it, ${from([t])}${none}`)
  if (p.why === 'varies') {
    let groups = new Map()
    for (let x of shared) { let k = `${named(x.channel)}${span(x.lag)}`; groups.set(k, [...groups.get(k) ?? [], x]) }
    out.push(`no lag: the readings differ by more than ${TOL} ms: ${[...groups].map(([k, xs]) => `${k} ${from(xs)}`).join('; ')}${none}`)
  }
  if (p.why === 'unrelated') out.push(spans ? `no lag: ${new Set(shared.map(x => x.at)).size} of ${spans} spans share a waveform with before (a correlation of ${RHO} or more within ±${WITHIN} s)${none}` : `no lag: before holds no sound${none}`)
  if (p.polarity?.includes(-1)) out.push(`polarity ${p.polarity.join(', ')}${p.polarity.length > 1 ? ` (${p.polarity.map((_, c) => named(c).trim() || `channel ${c + 1}`).join(', ')})` : ''}`)
  if (p.swapped) out.push('left and right read crossed: the crossed pairs\' correlation peaks hold more than the straight pairs\'')
  let d = r.duration.delta
  if (Math.round(Math.abs(d) * sr) >= 1) out.push(`length ${r.duration.before.toFixed(3)} → ${r.duration.after.toFixed(3)} s, ${span(Math.abs(d))} ${d < 0 ? 'shorter' : 'longer'}`)
  if (off(r.channels)) out.push(`channels ${r.channels.before} → ${r.channels.after}`)
  if (off(r.sampleRate)) out.push(`sample rate ${r.sampleRate.before} → ${r.sampleRate.after} Hz`)
  let moved = (label, x, tail = '') => `${label} ${f2(x.before)} → ${f2(x.after)} ${x.unit}${tail}`
  if (past(r.loudness, T.loudness)) out.push(moved('loudness', r.loudness))
  if (past(r.lra, T.lra)) out.push(moved('loudness range', r.lra))
  // the ceiling judged as printed, to 0.01 dB, as check() judges it: a limiter lands on it at -0.9999, and that is not over
  let tp = r.truepeak, over = printed(tp.after) > -1 && !(printed(tp.before) > -1)
  if (past(tp, T.truepeak) || over) out.push(moved('true peak', tp, over ? ', over the -1 dBTP ceiling' : ''))
  if (past(r.noisefloor, T.noisefloor)) out.push(moved('noise floor', r.noisefloor))
  // each octave against the median change of the octaves that hold sound (within 60 dB of the loudest) on both sides
  let bands = rows.filter(x => x.name.endsWith(' octave') && x.delta != null), top = Math.max(...bands.flatMap(x => [x.before, x.after]))
  let held = bands.filter(x => Math.max(x.before, x.after) >= top - 60 && Number.isFinite(x.delta)), mid = held.map(x => x.delta).sort((x, y) => x - y)
  let med = mid.length ? (mid[(mid.length - 1) >> 1] + mid[mid.length >> 1]) / 2 : 0
  for (let x of held) if (Math.abs(x.delta - med) > T.band) out.push(moved(x.name, x, `, ${f2(x.delta - med)} dB against the octaves' median change (${f2(med)} dB)`))
  if (past(r.width, T.width)) out.push(moved('width (side over mid)', r.width))
  if (past(r.correlation, T.correlation)) out.push(`L/R correlation ${r.correlation.before.toFixed(2)} → ${r.correlation.after.toFixed(2)}`)
  if (off(r.clipping)) out.push(`clipped samples ${r.clipping.before} → ${r.clipping.after}`)
  if (off(r.over)) out.push(`samples past full scale ${r.over.before} → ${r.over.after}`)
  if (past(r.dc, T.dc)) out.push(`DC ${r.dc.before.toFixed(4)} → ${r.dc.after.toFixed(4)}`)
  if (p.difference != null && p.difference >= T.difference) out.push(`difference ${f2(p.difference)} dB at the lag and gain`)
  let v = p.voice
  if (v && (Object.values(v.change).some(c => !(Math.abs(c) <= T.voice)) || [v.under, v.over, v.silenced].some(s => s > T.share))) {
    let shares = [[`${T.apart} dB or more under the median`, v.under], [`${T.apart} dB or more over it`, v.over], [`from ${T.apart} dB over before's noise floor (${f2(r.noisefloor.before)} dB) to under it, moved by the loudness change, or to zero`, v.silenced]].filter(([, s]) => s > 0)
    out.push(`voice band of ${v.frames} voiced frames: median change ${f2(v.change.p50)} dB, 10th ${f2(v.change.p10)}, 90th ${f2(v.change.p90)}${shares.map(([k, s]) => `; ${pct(s)} ${k}`).join('')}`)
  }
  return out
}

/** after.compare(before): see above */
export default async function compare(ref) {
  if (!ref?.stream) throw new TypeError('compare: the reference is a sound (an audio instance): out.compare(src)')
  // ops edit in place: the same instance holds no before
  if (ref === this && this.edits?.length) throw new TypeError('compare: the reference is this sound, its edits its own: clone it before editing (let out = src.clone().gain(-6); await out.compare(src))')
  let [A, B] = [await measure(this, 'this sound'), await measure(ref, 'the reference')], sr = this.sampleRate
  // the reference at this sound's rate, for what is read sample by sample
  // (a clone keeps its edits: audio.from(ref) holds its source's samples, not what its edits make of them)
  let b = ref.sampleRate === sr ? ref : ref.clone().resample(sr, { type: 'sinc' })
  // a silent sound is all of the reference gone at any lag: read at 0
  let t = Math.min(this.length, b.length) < SHORT * sr ? { why: 'short' } : !(B.peak > 0) ? { why: 'unrelated' } : !(A.peak > 0) ? { tau: 0 } : await lags(this, b)
  let tau = t.tau == null ? null : Math.abs(t.tau - Math.round(t.tau)) < FRAC ? Math.round(t.tau) || 0 : t.tau
  // the noise floor on one grid: ACX's windows step 0.1 s from each sound's start, and a lag moves them
  let D = tau == null ? 0 : Math.round(tau)
  if (D > 0) A.noisefloor = await this.stat('noisefloor', { at: D / sr })
  if (D < 0) B.noisefloor = await ref.stat('noisefloor', { at: -D / sr })
  let p = { lag: tau == null ? null : tau / sr, why: t.why ?? null, period: t.period ?? null, readings: t.readings ?? [], swapped: t.readings ? t.cross : null,
    ...tau != null ? await pair(this, b, tau, t.cross, B.noisefloor ?? -Infinity, Number.isFinite(A.loudness - B.loudness) ? A.loudness - B.loudness : 0) : { gain: null, polarity: null, difference: null, voice: null } }
  let row = (name, unit, before, after) => ({ name, unit, before, after, delta: before == null || after == null ? null : before === after ? 0 : after - before })
  let rows = [
    row('duration', 's', B.duration, A.duration), row('channels', '', B.channels, A.channels), row('sampleRate', 'Hz', B.sampleRate, A.sampleRate),
    row('loudness', 'LUFS', B.loudness, A.loudness), row('lra', 'LU', B.lra, A.lra), row('truepeak', 'dBTP', B.truepeak, A.truepeak),
    row('noisefloor', 'dB', B.noisefloor, A.noisefloor), row('clipping', 'samples', B.clipping, A.clipping), row('over', 'samples', B.over, A.over), row('dc', '', B.dc, A.dc),
    ...A.channels > 1 || B.channels > 1 ? [row('correlation', '', B.correlation, A.correlation), row('width', 'dB', B.width, A.width)] : [],
    ...OCTAVES.flatMap((o, i) => B.bands?.[i] != null || A.bands?.[i] != null ? [row(o.name, 'dB', B.bands?.[i], A.bands?.[i])] : []),
  ]
  return { ...p, measures: rows, changes: lines(rows, p, sr, t) }
}
