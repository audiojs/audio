/**
 * Match: equalize toward a reference's tonal balance (match EQ), streaming.
 *
 * a.match(ref)                         → up to 8 parametric bands fitted to the reference/source spectrum ratio
 * a.match(ref, 0.6)                    → partial match (amount 0..1)
 * a.match(ref, { bands: 12, lookahead: 30 })
 *
 * The reference's long-term average spectrum is read in chunks; the source's accumulates as it
 * streams (Welch, 4096/2048 Hann). The op looks `lookahead` seconds ahead (default 10), so the
 * first sample already has a fit, then refits at 2×, 4×, 8×… that point: the spectrum converges
 * on the whole signal's while memory stays one lookahead, and a week-long stream refits ~20
 * times. Each fit: both spectra ⅓-octave smoothed, their ratio centered over 30 Hz–16 kHz and
 * fitted by @audio/eq-fit (peaks + edge shelves, ±12 dB per band); fits crossfade over 100 ms.
 * Tone only: each fit's loudness change is computed from the source spectrum through the EQ and
 * the K-weighting (BS.1770) and made up.
 */
import audio from '../core.js'
import { fft } from 'fourier-transform'
import { kWeighting } from '@audio/weighting'
import { peaking, lowshelf, highshelf, process as biquad, state } from '@audio/biquad'
import { refLen } from '../plan.js'

const FRAME = 4096, HOP = FRAME / 2, F0 = 30, F1 = 16000, XFADE = 0.1, TYPES = { peak: peaking, lowshelf, highshelf }
const HANN = Float64Array.from({ length: FRAME }, (_, i) => 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (FRAME - 1)))

/** Streaming Welch accumulator over a mono signal: power per bin, averaged over frames. */
function welch() {
  let buf = new Float64Array(FRAME), f = new Float64Array(FRAME), fill = 0, acc = new Float64Array(FRAME / 2 + 1), frames = 0
  return {
    push(x) {
      for (let i = 0; i < x.length; i++) {
        buf[fill++] = x[i]
        if (fill < FRAME) continue
        for (let k = 0; k < FRAME; k++) f[k] = buf[k] * HANN[k]
        let [re, im] = fft(f)
        for (let k = 0; k <= FRAME / 2; k++) acc[k] += re[k] * re[k] + im[k] * im[k]
        frames++; buf.copyWithin(0, HOP); fill = FRAME - HOP
      }
    },
    power: () => frames ? acc.map(v => v / frames) : null,
  }
}

const mono = (chs, n) => {
  let m = new Float64Array(n)
  for (let c of chs) for (let k = 0; k < n; k++) m[k] += c[k] / chs.length
  return m
}

/** Power spectrum → ⅓-octave smoothed f ↦ dB (null when silent). */
function smooth(p, fs) {
  if (!p) return null
  let n = p.length, s = new Float64Array(n + 1)
  for (let k = 0; k < n; k++) s[k + 1] = s[k] + p[k]
  if (s[n] < 1e-12) return null
  let db = new Float64Array(n), r = 2 ** (1 / 6)
  for (let k = 1; k < n; k++) { let lo = Math.max(1, Math.floor(k / r)), hi = Math.min(n - 1, Math.ceil(k * r)); db[k] = 10 * Math.log10((s[hi + 1] - s[lo]) / (hi - lo + 1) + 1e-20) }
  db[0] = db[1]
  return f => { let x = Math.min(n - 1, Math.max(0, f * FRAME / fs)), k = Math.floor(x); return k + 1 < n ? db[k] + (db[k + 1] - db[k]) * (x - k) : db[k] }
}

/** |K(f)|² per bin at this rate: the BS.1770 pre-filter's response, from its impulse. */
function kPower(sr) {
  let h = new Float32Array(FRAME); h[0] = 1
  kWeighting(h, { fs: sr })
  let [re, im] = fft(Float64Array.from(h))
  return Float64Array.from({ length: FRAME / 2 + 1 }, (_, k) => re[k] * re[k] + im[k] * im[k])
}

/** Fit an EQ carrying the source spectrum P toward `dst`, with the make-up that holds K-weighted loudness. */
function fitEq(ctx, P, dst, kp) {
  let sr = ctx.sampleRate, src = smooth(P, sr)
  if (!src || !dst) return null
  let N = 128, off = 0
  for (let i = 0; i < N; i++) { let f = F0 * (F1 / F0) ** (i / (N - 1)); off += dst(f) - src(f) }
  off /= N
  let amount = ctx.amount ?? 1, { default: fit, response } = audio.op('match').mod
  let { bands } = fit(f => amount * (dst(f) - src(f) - off), { fs: sr, bands: ctx.bands ?? 8, fMin: F0, fMax: F1, preamp: false })
  let H = response(bands, 0, sr), num = 0, den = 0
  for (let k = 1; k < P.length; k++) { let w = kp[k] * P[k]; den += w; num += w * 10 ** (H(k * sr / FRAME) / 10) }
  return { co: bands.map(b => TYPES[b.type](b.fc, b.Q, sr, b.gain)), gain: den > 0 && num > 0 ? Math.sqrt(den / num) : 1 }
}

/** An EQ with per-channel section states. */
const cascade = (eq, nch) => eq && { ...eq, st: Array.from({ length: nch }, () => eq.co.map(() => state())) }
function run(q, x, c) {
  let y = Float32Array.from(x)
  if (!q) return y
  for (let b = 0; b < q.co.length; b++) biquad(y, q.co[b], q.st[c][b])
  for (let i = 0; i < y.length; i++) y[i] *= q.gain
  return y
}

function match(input, output, ctx) {
  let nch = input.length, len = input[0].length, sr = ctx.sampleRate
  let st = ctx._m
  if (!st) {
    let ref = ctx.source, rsr = ref.sampleRate ?? sr, rn = refLen(ref, rsr), rw = welch()
    for (let off = 0; off < rn; off += 1 << 16) { let pcm = ctx.render(ref, off, Math.min(1 << 16, rn - off)); rw.push(mono(pcm, pcm[0].length)) }
    let L = Math.max(FRAME, Math.round((ctx.lookahead ?? 10) * sr))
    st = ctx._m = {
      L, n: 0, next: L, dst: smooth(rw.power(), rsr), kp: kPower(sr), sw: welch(), cur: null, prev: null, xf: 0,
      dl: Array.from({ length: nch }, () => ({ b: new Float32Array(L), i: 0 })),
    }
  }
  // analysis runs L ahead of the output; refit whenever the analyzed length doubles
  st.sw.push(mono(input, len))
  let end = st.n + len, X = Math.round(XFADE * sr)
  if (end >= st.next) {
    let eq = cascade(fitEq(ctx, st.sw.power(), st.dst, st.kp), nch)
    if (eq) { st.prev = st.cur; st.cur = eq; st.xf = st.prev ? X : 0 }
    while (st.next <= end) st.next *= 2
  }
  for (let c = 0; c < nch; c++) {
    let d = st.dl[c], x = new Float32Array(len)
    for (let i = 0; i < len; i++) { x[i] = d.b[d.i]; d.b[d.i] = input[c][i]; if (++d.i === st.L) d.i = 0 }
    let y = run(st.cur, x, c)
    if (st.xf > 0) {
      let p = run(st.prev, x, c)
      for (let i = 0; i < len && i < st.xf; i++) { let t = 1 - (st.xf - i) / X; y[i] = p[i] * (1 - t) + y[i] * t }
    }
    output[c].set(y)
  }
  if (st.xf > 0 && !(st.xf = Math.max(0, st.xf - len))) st.prev = null
  st.n = end
}

audio.op('match', {
  params: ['source', 'amount'],
  latency: (o, sr) => Math.max(FRAME, Math.round((o.lookahead ?? 10) * sr)),
  load: () => import('@audio/eq-fit'),
  process: match,
})
