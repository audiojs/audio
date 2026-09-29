/**
 * Match: equalize toward a reference's tonal balance (match EQ), streaming.
 *
 * a.match(ref)                         → up to 8 parametric bands fitted to the reference/source spectrum ratio
 * a.match(ref, 0.6)                    → partial match (amount 0..1)
 * a.match(ref, { bands: 12, lookahead: 30 })
 * a.match(ref, { midside: true })      → stereo: mid and side each matched to the reference's (Matchering's split)
 * a.master(ref)                        → match in mid/side, then the reference's integrated loudness under -1 dBTP
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
import kWeighting from '@audio/weighting-k'
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

/** Mid (L+R)/2 and side (L−R)/2 of a stereo buffer; decoded back as L = M + S, R = M − S. */
const mid = (l, r) => l.map((v, i) => (v + r[i]) / 2), side = (l, r) => l.map((v, i) => (v - r[i]) / 2)

function match(input, output, ctx) {
  let nch = input.length, len = input[0].length, sr = ctx.sampleRate
  let st = ctx._m
  if (!st) {
    let ref = ctx.source, rsr = ref.sampleRate ?? sr, rn = refLen(ref, rsr)
    // parts matched separately: the channels' mix, or a stereo pair's mid and side
    let ms = !!ctx.midside && nch === 2, parts = ms ? [ch => mid(ch[0], ch[1]), ch => side(ch[0], ch[1])] : [ch => mono(ch, ch[0].length)]
    let rw = parts.map(() => welch())
    for (let off = 0; off < rn; off += 1 << 16) {
      let pcm = ctx.render(ref, off, Math.min(1 << 16, rn - off))
      // a mono reference is all mid: the mid matches it, the side stays as it is
      parts.forEach((f, p) => !ms ? rw[p].push(mono(pcm, pcm[0].length)) : pcm.length > 1 ? rw[p].push(f(pcm)) : p === 0 && rw[0].push(pcm[0]))
    }
    let L = Math.max(FRAME, Math.round((ctx.lookahead ?? 10) * sr))
    st = ctx._m = {
      L, n: 0, next: L, ms, parts, kp: kPower(sr), xf: 0,
      p: rw.map(w => ({ ref: w.power(), dst: smooth(w.power(), rsr), sw: welch(), cur: null, prev: null })),
      dl: Array.from({ length: nch }, () => ({ b: new Float32Array(L), i: 0 })),
    }
  }
  // analysis runs L ahead of the output; refit whenever the analyzed length doubles
  st.parts.forEach((f, p) => st.p[p].sw.push(st.ms ? f(input) : mono(input, len)))
  let end = st.n + len, X = Math.round(XFADE * sr)
  if (end >= st.next) {
    let fitted = st.p.map(q => cascade(fitEq(ctx, q.sw.power(), q.dst, st.kp), st.ms ? 1 : nch))
    // width: each fit holds its part's loudness; the side then takes the reference's side-to-mid ratio (K-weighted)
    if (st.ms && fitted[1]) {
      let k = P => P ? P.reduce((a, v, j) => a + st.kp[j] * v, 0) : 0
      let [rm, rs, sm, ss] = [k(st.p[0].ref), k(st.p[1].ref), k(st.p[0].sw.power()), k(st.p[1].sw.power())]
      // clamped to ±12 dB; `amount` scales it in dB, as it scales the EQ
      if (rm > 0 && rs > 0 && sm > 0 && ss > 0) fitted[1].gain *= Math.min(4, Math.max(0.25, Math.sqrt((rs / rm) / (ss / sm)) ** (ctx.amount ?? 1)))
    }
    if (fitted.some(Boolean)) { st.p.forEach((q, i) => { q.prev = q.cur; q.cur = fitted[i] ?? q.cur }); st.xf = st.p.some(q => q.prev) ? X : 0 }
    while (st.next <= end) st.next *= 2
  }
  // the delayed input, per channel
  let x = st.dl.map((d, c) => { let y = new Float32Array(len), inp = input[c]; for (let i = 0; i < len; i++) { y[i] = d.b[d.i]; d.b[d.i] = inp[i]; if (++d.i === st.L) d.i = 0 } return y })
  // each part through its EQ, the previous fit crossfading out
  const eq = (q, sig, c) => {
    let y = run(q.cur, sig, c)
    if (st.xf > 0 && q.prev) { let p = run(q.prev, sig, c); for (let i = 0; i < len && i < st.xf; i++) { let t = 1 - (st.xf - i) / X; y[i] = p[i] * (1 - t) + y[i] * t } }
    return y
  }
  if (st.ms) {
    let m = eq(st.p[0], mid(x[0], x[1]), 0), s = eq(st.p[1], side(x[0], x[1]), 0)
    for (let i = 0; i < len; i++) { output[0][i] = m[i] + s[i]; output[1][i] = m[i] - s[i] }
  } else for (let c = 0; c < nch; c++) output[c].set(eq(st.p[0], x[c], c))
  if (st.xf > 0 && !(st.xf = Math.max(0, st.xf - len))) st.p.forEach(q => q.prev = null)
  st.n = end
}

audio.op('match', {
  params: ['source', 'amount'],
  latency: (o, sr) => Math.max(FRAME, Math.round((o.lookahead ?? 10) * sr)),
  load: () => import('@audio/eq-fit'),
  process: match,
})

/** Master to a reference, Matchering's way: its tone in mid and side, then its integrated loudness (BS.1770), a
 *  true-peak ceiling at -1 dBTP (`ceiling` moves it). Matchering matches RMS of the loudest 15 s pieces and limits
 *  sample peaks at -0.016 dBFS; gated loudness weighs the loud parts, and inter-sample peaks stay under the ceiling. */
audio.fn.master = function(ref, opts = {}) {
  let { ceiling, amount, ...rest } = opts
  return this.match(ref, { midside: true, ...(amount != null && { amount }), ...rest }).normalize(ref, ceiling != null ? { ceiling } : undefined)
}
