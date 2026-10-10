/**
 * Align: a sound moved in time onto a reference it plays with: a part remade elsewhere (a voice sung again, a backing
 * generated anew) or recorded apart, put back where the original stood.
 *
 * a.align(ref)                  → a moved by the lag that lines it up with ref: silence put before it, or its head cut
 * a.align(ref, { within: 3 })   → the lag looked for within ±3 s (10 by default)
 *
 * The lag, D, where a's samples stand D after ref's: where the two share a waveform (a copy delayed, filtered, at another
 * level), the peak of their PHAT-weighted cross-correlation (GCC-PHAT, Knapp & Carter, IEEE TASSP 1976), to the sample,
 * once it stands 12 times over that correlation's RMS; else, a part remade, by the cross-correlation of the two onset
 * envelopes (spectral flux, log-compressed, frames of 1024 at 44.1 kHz and a quarter-frame hop, ~5.8 ms; summed over
 * their overlap, so of two lags a beat apart the nearer wins), which a remade part shares with its original where its
 * waveform does not, then the waveforms' peak within a hop of it. Read from the first `span` s of each (60), mono, ref at
 * a's rate. D > 0 cuts a's first D; D < 0 puts −D of silence before it; its end stays where it falls. The lag is found before rendering (a's input and ref read whole) and kept while both stay the
 * same; a live stream waits for its end.
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
    for (let k = 0; k < K; k++) { let m = Math.log1p(1000 * Math.hypot(re[k], im[k])), d = m - prev[k]; if (d > 0 && t) s += d; prev[k] = m }
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
    let re = xr[k] * rr[k] + xi[k] * ri[k], im = xi[k] * rr[k] - xr[k] * ri[k], m = Math.hypot(re, im)
    if (m > 1e-20) gr[k] = re / m, gi[k] = im / m
  }
  return { cc: ifft(gr, gi, new Float64Array(M)), M }
}
// how far the waveforms' peak stands over their correlation's RMS (over every lag looked at) to be the lag: over ±10 s at
// 44.1 kHz, unrelated noises' highest stood 6.9 over it, a remade part's, the same attacks in another timbre, 18, a copy's 920
const SHARED = 12

/** The lag D, in samples, of x behind r (x[i] ≈ r[i − D]), |D| ≤ max: where they share a waveform, its correlation's
 *  peak; else the onset envelopes', then the waveforms' peak within a hop of it; 0 where neither is shared */
export function lag(x, r, sr, max = WITHIN * sr) {
  let { cc, M } = phat(x, r), at = d => cc[(d + M) % M], best = -Infinity, D = 0, ss = 0, n = 0
  max = Math.min(max, M / 2 - 1)
  for (let d = -max; d <= max; d++) { let v = at(d); ss += v * v; n++; if (v > best) best = v, D = d }
  if (best > SHARED * Math.sqrt(ss / n)) return D
  let N = pow2(1024 * sr / 44100), H = N / 4, ex = envelope(x, N, H), er = envelope(r, N, H), L = Math.floor(max / H), k0 = 0
  best = -Infinity
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

/** Find the lag of the edit's input (the audio as the edits before it leave it) behind ref, ahead of rendering. */
async function prepare(a, index) {
  let o = a.edits[index][1], ref = o.source
  if (!ref?.read && !Array.isArray(ref)) throw new TypeError('align: the reference is a sound (an audio instance) or its channels')
  await arrived(a)
  let stamp = `${a.version}:${a._.len}:${ref.version ?? ''}:${ref._?.len ?? ref[0]?.length}:${o.within ?? ''}:${o.span ?? ''}`, got = o[ALIGNED]
  if (got?.stamp === stamp) return
  let input = audio.from(a, { sampleRate: a._.sr })
  input.edits = a.edits.slice(0, index)
  input.version = index
  let pcm = await input.read(), sr = input.sampleRate
  let r = Array.isArray(ref) ? ref : (ref.sampleRate ?? sr) === sr ? await ref.read() : await audio.from(ref).resample(sr).read()
  let key = `${sr}:${o.within ?? ''}:${o.span ?? ''}:${fingerprint(pcm)}:${fingerprint(r)}`
  if (got?.key === key) { got.stamp = stamp; return }
  let n = Math.round((o.span ?? SPAN) * sr)
  o[ALIGNED] = { key, stamp, D: lag(mono(pcm, n), mono(r, n), sr, Math.round((o.within ?? WITHIN) * sr)), sr }
}

// the lag found: the head cut, or silence before it
function expand(ctx) {
  let got = ctx[ALIGNED]
  if (!got) throw new Error('align: the lag is found before rendering, through read(), stream() or save()')
  let { D, sr } = got
  return D > 0 ? ['crop', { at: D / sr }] : D < 0 ? ['pad', { before: -D / sr, after: 0 }] : false
}

audio.op('align', { params: ['source'], prepare, expand })
