/**
 * Align: a sound moved in time onto a reference it plays with: a part remade elsewhere (a voice sung again, a backing
 * generated anew) or recorded apart, put back where the original stood.
 *
 * a.align(ref)                  → a moved by the lag that lines it up with ref: silence put before it, or its head cut
 * a.align(ref, { within: 3 })   → the lag looked for within ±3 s (10 by default)
 * a.align(ref, { drift: false }) → the lag alone, no rate looked for
 *
 * The lag, D, where a's samples stand D after ref's: where the two share a waveform (a copy delayed, filtered, at another
 * level), the peak of their PHAT-weighted cross-correlation (GCC-PHAT, Knapp & Carter, IEEE TASSP 1976), to the sample,
 * once it stands 12 times over that correlation's RMS; else, a part remade, by the cross-correlation of the two onset
 * envelopes (spectral flux, log-compressed, frames of 1024 at 44.1 kHz and a quarter-frame hop, ~5.8 ms; summed over
 * their overlap, so of two lags a beat apart the nearer wins), which a remade part shares with its original where its
 * waveform does not, then the waveforms' peak within a hop of it. Read from the first `span` s of each (60), mono, ref at
 * a's rate. D > 0 cuts a's first D; D < 0 puts −D of silence before it; its end stays where it falls.
 *
 * Drift: where a and ref last 20 s each, a lag that grows along a is found as a rate, and a read at it before the lag is
 * taken: a copy on a clock running apart (two recorders of one take, a double-ender's sides) by its waveform at three
 * places, to the sample, read faster or slower, its pitch with it as a tape's (sinc between samples); a part played at
 * another tempo (remade at another BPM), within ±10 %, by its onsets, stretched to it, its pitch kept, or read as a copy
 * is where the rate is under 0.2 % (3.5 cents: no ear hears it as pitch). A part's drift under 10 ms across a is none.
 * bench/align.mjs, parts of a Divide and Remaster v3 clip and three MDB-stem-synth songs (60 to 218 s) stretched by 0.98
 * to 1.06 or sped 100 ppm, against the original: a's ends within 2 ms of where they belong, but for a film's music under
 * its dialogue (25 ms) and a sparse melody (8 ms; sped 100 ppm, 22 ms across it, no drift found); copies 20 and 50 ppm
 * off, within half a sample; none where none was made. 1 to 8 s a case on an M4 Max under load.
 *
 * The lag is found before rendering (a's input and ref read whole) and kept while both stay the same; a live stream
 * waits for its end.
 */
import audio, { arrived } from '../core.js'
import { fft, ifft } from 'fourier-transform'
import { fingerprint } from './vocals.js'

const ALIGNED = Symbol('align.lag'), WITHIN = 10, SPAN = 60

const mono = (chs, n) => {
  let m = new Float64Array(Math.min(n, chs[0]?.length ?? 0))
  for (let ch of chs) for (let i = 0; i < m.length; i++) m[i] += ch[i] / chs.length
  return m
}
const pow2 = n => 2 ** Math.ceil(Math.log2(Math.max(2, n)))

/** Onset envelope: per hop, the sum over bins of the rise in log magnitude (spectral flux), its mean taken off */
function envelope(x, N, H) {
  let K = N / 2 + 1, win = Float64Array.from({ length: N }, (_, i) => 0.5 - 0.5 * Math.cos(2 * Math.PI * i / N))
  let F = Math.max(0, Math.floor((x.length - N) / H) + 1), e = new Float64Array(F), prev = new Float64Array(K), f = new Float64Array(N)
  for (let t = 0; t < F; t++) {
    for (let i = 0; i < N; i++) f[i] = x[t * H + i] * win[i]
    let [re, im] = fft(f), s = 0
    for (let k = 0; k < K; k++) { let m = Math.log1p(1000 * Math.sqrt(re[k] * re[k] + im[k] * im[k])), d = m - prev[k]; if (d > 0 && t) s += d; prev[k] = m }
    e[t] = s
  }
  let mean = e.reduce((p, v) => p + v, 0) / (F || 1)
  for (let t = 0; t < F; t++) e[t] -= mean
  return e
}

/** The PHAT-weighted cross-correlation of x and r (Knapp & Carter 1976): cc[d mod M] peaks at the lag d of x behind r
 *  where the two share a waveform, a near delta whatever their spectra */
function phat(x, r) {
  let M = pow2(x.length + r.length), a = new Float64Array(M), b = new Float64Array(M)
  a.set(x); b.set(r)
  let [xr, xi] = fft(a).map(v => v.slice()), [rr, ri] = fft(b), K = M / 2 + 1, gr = new Float64Array(K), gi = new Float64Array(K)
  for (let k = 0; k < K; k++) {
    let re = xr[k] * rr[k] + xi[k] * ri[k], im = xi[k] * rr[k] - xr[k] * ri[k], m = Math.sqrt(re * re + im * im)
    if (m > 1e-20) gr[k] = re / m, gi[k] = im / m
  }
  return { cc: ifft(gr, gi, new Float64Array(M)), M }
}
// how far the waveforms' peak stands over their correlation's RMS (over every lag looked at) to be the lag: over ±10 s at
// 44.1 kHz, unrelated noises' highest stood 6.9 over it, a remade part's, the same attacks in another timbre, 18, a copy's 920
const SHARED = 12

/** The peak D of x's PHAT correlation with r over |d| ≤ max, whether it stands SHARED times over its RMS (the two share
 *  a waveform), and the correlation at(d) */
function waveform(x, r, max) {
  let { cc, M } = phat(x, r), at = d => cc[(d + M) % M], best = -Infinity, D = 0, ss = 0, n = 0
  max = Math.min(max, M / 2 - 1)
  for (let d = -max; d <= max; d++) { let v = at(d); ss += v * v; n++; if (v > best) best = v, D = d }
  return { D, shared: best > SHARED * Math.sqrt(ss / n), at, max }
}

/** The lag D, in samples, of x behind r (x[i] ≈ r[i − D]), |D| ≤ max: where they share a waveform, its correlation's
 *  peak; else the onset envelopes', then the waveforms' peak within a hop of it; 0 where neither is shared */
export function lag(x, r, sr, max = WITHIN * sr) {
  let w = waveform(x, r, max), { at } = w, D = w.D, best = -Infinity
  if (w.shared) return D
  max = w.max
  let N = pow2(1024 * sr / 44100), H = N / 4, ex = envelope(x, N, H), er = envelope(r, N, H), L = Math.floor(max / H), k0 = 0
  for (let k = -L; k <= L; k++) {
    let s = 0
    for (let t = Math.max(0, -k); t < er.length && t + k < ex.length; t++) s += ex[t + k] * er[t]
    if (s > best) best = s, k0 = k
  }
  // no attack the two share (silence, a sound shorter than a frame): left where it is
  if (!(best > 0)) return 0
  best = -Infinity
  for (let d = Math.max(-max, (k0 - 1) * H), e = Math.min(max, (k0 + 1) * H); d <= e; d++) if (at(d) > best) best = at(d), D = d
  return D
}

// Drift: a copy recorded on a clock running apart (two recorders of one take), or a part played at another tempo (remade
// at another BPM): its lag grows along it, `a[τ] ≈ r[ρτ − b]`. A copy's by its waveform, to the sample; a part's rate
// within ±RATE searched on the onset envelopes, coarse to fine: thinned by 16 (smoothed; each step drifts half a frame
// across a), the TOP best rates looked at again thinned by 4, the best of those at full rate; then ρ and b set by the
// lags of a's first and last thirds against r read at that rate, to a fraction of a frame. Looked for where a and ref
// last LONG s each; a part's drift under DRIFT s across a is none.
const RATE = 0.1, TOP = 8, LONG = 20, DRIFT = 0.01, WINDOW = 3

/** x thinned by w: the mean of each w frames */
const thin = (x, w) => w === 1 ? x : Float64Array.from({ length: Math.floor(x.length / w) }, (_, i) => { let s = 0; for (let j = 0; j < w; j++) s += x[i * w + j]; return s / w })
/** x read at ρ·(from + t), linear between samples, n long (by default as long as x lasts), 0 past its end */
const rated = (x, rho, from = 0, n = Math.floor((x.length - 1) / rho - from) + 1) => Float64Array.from({ length: Math.max(0, n) }, (_, t) => {
  let p = rho * (from + t), i = Math.floor(p), f = p - i
  return i < 0 || i >= x.length ? 0 : i + 1 < x.length ? x[i] * (1 - f) + x[i + 1] * f : x[i]
})
/** x's cross-correlation with any y up to `ny` long, by FFT, x's spectrum made once: c(y)[d mod M], x[t] ≈ y[t − d] */
function against(x, ny) {
  let M = pow2(x.length + ny), a = new Float64Array(M), b = new Float64Array(M), K = M / 2 + 1, gr = new Float64Array(K), gi = new Float64Array(K), out = new Float64Array(M)
  a.set(x)
  let [xr, xi] = fft(a).map(v => v.slice())
  return y => {
    b.fill(0); b.set(y.subarray(0, M))
    let [yr, yi] = fft(b), e = 0
    for (let k = 0; k < K; k++) gr[k] = xr[k] * yr[k] + xi[k] * yi[k], gi[k] = xi[k] * yr[k] - xr[k] * yi[k]
    for (let i = 0; i < y.length; i++) e += y[i] * y[i]
    let cc = ifft(gr, gi, out), n = Math.sqrt(e) || 1
    return d => cc[(d + M) % M] / n
  }
}
/** The highest of c(d) over d in [lo, hi], to a fraction (a parabola through it and its neighbours): { d, v } */
function top(c, lo, hi) {
  let D = lo, v = -Infinity
  for (let d = lo; d <= hi; d++) if (c(d) > v) v = c(d), D = d
  let y0 = D > lo ? c(D - 1) : v, y2 = D < hi ? c(D + 1) : v, den = y0 - 2 * v + y2
  return { d: D + (den < 0 ? 0.5 * (y0 - y2) / den : 0), v }
}

/** The rate and lag of x behind r where it drifts, `x[τ] ≈ r[ρτ − b]` (b in samples, `shared` where a copy), ρ 1 for a
 *  copy that holds its lag; null where nothing drifts DRIFT s across x, or x or r is under LONG s. Mono, max the lag at
 *  the start looked for (samples). */
export function drift(x, r, sr, max = WITHIN * sr) {
  if (Math.min(x.length, r.length) < LONG * sr) return null
  // the onset envelopes: the rate searched coarse to fine
  let N = pow2(1024 * sr / 44100), H = N / 4, ex = envelope(x, N, H), er = envelope(r, N, H), L = Math.ceil(max / H)
  // the best rates at thinning w among `rates`, each scored by its lag's correlation over ±L
  let best = (w, rates) => {
    let c = against(thin(ex, w), Math.ceil(er.length / w / (1 - RATE)) + 1), rw = thin(er, w), l = Math.ceil(L / w)
    return rates.map(rho => ({ rho, ...top(c(rated(rw, rho)), -l, l) })).sort((p, q) => q.v - p.v)
  }
  let step = w => 0.5 * w / ex.length, grid = (around, w, span) => around.flatMap(p => Array.from({ length: 2 * span + 1 }, (_, i) => p.rho + (i - span) * step(w)))
  let coarse = best(16, Array.from({ length: Math.floor(2 * RATE / step(16)) + 1 }, (_, i) => 1 - RATE + i * step(16)))
  // local peaks over the rates, the TOP highest
  let peaks = coarse.slice().sort((p, q) => p.rho - q.rho).filter((p, i, a) => (!i || p.v >= a[i - 1].v) && (i === a.length - 1 || p.v >= a[i + 1].v)).sort((p, q) => q.v - p.v).slice(0, TOP)
  let [mid] = best(4, grid(peaks, 4, 12)), [fine] = best(1, grid([mid], 1, 4))
  // a's first and last thirds, each alone, against r read at that rate: their lags d (frames) at their middles
  let rw = rated(er, fine.rho), T = Math.floor(ex.length / 3), lo = Math.floor(fine.d) - 4, hi = lo + 9
  let third = a0 => { let xs = new Float64Array(ex.length); xs.set(ex.subarray(a0, a0 + T), a0); return top(against(xs, rw.length)(rw), lo, hi) }
  let t1 = T / 2, t2 = ex.length - T / 2, g1 = fine.rho * (t1 - third(0).d), g2 = fine.rho * (t2 - third(ex.length - T).d)
  // where the two disagree with the rate found by two frames or more across a (a sound of few attacks, legato), that rate
  let rho = (g2 - g1) / (t2 - t1), bf = rho * t1 - g1
  if (!(Math.abs(rho - fine.rho) * ex.length < 2)) rho = fine.rho, bf = rho * fine.d
  // frame t centred at tH + N/2: in samples
  let b = bf * H + (rho - 1) * N / 2
  // a copy (a clock's rate, under 0.2 %): the waveforms' lags (GCC-PHAT) at x's first and last sixth and its middle,
  // each over WINDOW s of it, within 16 frames of where the rate puts them; then found again against r read at the rate
  // the first two make (a clock 100 ppm off moves 13 samples in 3 s at 44.1 kHz: read at 1, the peak smears as wide);
  // the middle on their line (a part played anew may share stretches of waveform, at lags no line joins)
  if (Math.abs(rho - 1) < 0.002) {
    let n = 2 * Math.floor(Math.min(WINDOW * sr, x.length / 3) / 2), m = 16 * H
    // where x[c] stands in r, r read at rate k from around g0, where it is expected; null where no waveform is shared
    let at = (c, k, g0) => {
      let q = g0 / k - n / 2 - m, w = waveform(x.subarray(c - n / 2, c + n / 2), rated(r, k, q, n + 2 * m), 2 * m)
      return w.shared && Math.abs(w.D) < 2 * m - 1 ? k * (q + n / 2 - w.D) : null
    }
    let cs = [Math.round(x.length / 6), x.length >> 1, x.length - Math.round(x.length / 6)], g = cs.map(c => at(c, 1, rho * c - b))
    if (!g.includes(null)) {
      let k = (g[2] - g[0]) / (cs[2] - cs[0])
      g = cs.map((c, i) => at(c, k, g[i]))
      if (!g.includes(null)) {
        k = (g[2] - g[0]) / (cs[2] - cs[0])
        // its lag held to the sample: that lag, at 1
        if (Math.abs(g[1] - g[0] - k * (cs[1] - cs[0])) <= 2) return Math.abs(g[2] - g[0] - (cs[2] - cs[0])) < 2 ? { rho: 1, b: Math.round(cs[0] - g[0]), shared: true } : { rho: k, b: k * cs[0] - g[0], shared: true }
      }
    }
  }
  return Math.abs(rho - 1) * x.length >= DRIFT * sr ? { rho, b } : null
}

/** Find the lag of the edit's input (the audio as the edits before it leave it) behind ref, ahead of rendering. */
async function prepare(a, index) {
  let o = a.edits[index][1], ref = o.source
  if (!ref?.read && !Array.isArray(ref)) throw new TypeError('align: the reference is a sound (an audio instance) or its channels')
  await arrived(a)
  let opts = `${o.within ?? ''}:${o.span ?? ''}:${o.drift ?? ''}`, stamp = `${a.version}:${a._.len}:${ref.version ?? ''}:${ref._?.len ?? ref[0]?.length}:${opts}`, got = o[ALIGNED]
  if (got?.stamp === stamp) return
  let input = audio.from(a, { sampleRate: a._.sr })
  input.edits = a.edits.slice(0, index)
  input.version = index
  let pcm = await input.read(), sr = input.sampleRate
  let r = Array.isArray(ref) ? ref : (ref.sampleRate ?? sr) === sr ? await ref.read() : await audio.from(ref).resample(sr).read()
  let key = `${sr}:${opts}:${fingerprint(pcm)}:${fingerprint(r)}`
  if (got?.key === key) { got.stamp = stamp; return }
  let n = Math.round((o.span ?? SPAN) * sr), max = Math.round((o.within ?? WITHIN) * sr)
  let d = o.drift === false ? null : drift(mono(pcm, Infinity), mono(r, Infinity), sr, max)
  o[ALIGNED] = { key, stamp, sr, ...d ? { D: d.b, rho: d.rho !== 1 && d.rho, shared: d.shared } : { D: lag(mono(pcm, n), mono(r, n), sr, max) } }
}

// the lag found: the head cut, or silence before it; where it drifts, the rate first: a copy (or a rate no ear hears as
// pitch, under 0.2 %, 3.5 cents) read faster or slower, its pitch with it, as a tape at another speed (sinc between
// samples); a part played at another tempo stretched, its pitch kept
function expand(ctx) {
  let got = ctx[ALIGNED]
  if (!got) throw new Error('align: the lag is found before rendering, through read(), stream() or save()')
  let { D, sr, rho } = got, edits = []
  if (rho) edits.push(...got.shared || Math.abs(rho - 1) < 0.002 ? [['speed', { rate: 1 / rho, type: 'sinc' }]] : audio.op('stretch').expand({ ...ctx, factor: rho }) || [])
  if (Math.round(D)) edits.push(D > 0 ? ['crop', { at: D / sr }] : ['pad', { before: -D / sr, after: 0 }])
  return edits.length ? edits : false
}

audio.op('align', { params: ['source'], prepare, expand })
