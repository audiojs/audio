/**
 * Deconstruct: a sound split into its tonal, noisy and transient parts, each at its own level (iZotope RX Deconstruct).
 *
 * a.deconstruct(0, -12)               → the noise (hiss, breath, room, a snare's rattle) 12 dB down, the rest as it was
 * a.deconstruct(0, 0, -6)             → the transients (clicks, attacks, consonants) 6 dB down
 * a.deconstruct(-Infinity, 0, 0)      → the tones gone: hum, a held note, feedback; what is not a tone stays
 * a.deconstruct(0, -Infinity, -Infinity, { separation: 3 }) → the tones alone, more strictly told apart
 * a.deconstruct(0, -6, 0, { band: [4000, 20000] }) → the noise 6 dB down over 4 kHz alone: under it the sound as it came
 *
 * Each STFT frame (the power of two nearest 46 ms, a quarter-frame hop, periodic Hann) is read by two median filters
 * (Fitzgerald, "Harmonic/percussive separation using median filtering", DAFx 2010): over time, each frequency's median
 * in the 0.2 s around it, which a tone holds and a click or a noise does not reach; over frequency, each frame's median
 * in the 400 Hz around it, which a click holds and a tone does not. A bin is tonal where the first stands `separation`
 * (2) times over the second, transient where the second stands so over the first, and noise where neither does: the
 * residual of Driedger, Müller & Disch, "Extending harmonic-percussive separation of audio signals", ISMIR 2014. The
 * masks are soft, a sigmoid of the two medians' log ratio, its slope 4 (Fitzgerald's Wiener mask is slope 2 at
 * separation 1; Driedger's binary masks, slope ∞), and sum to 1, so the parts add back to the input to float precision
 * and gains of 0 dB leave it as it came, sample for sample. The channels share the masks (their mean magnitude), so a
 * stereo image stays where it was. Streams 0.15 s behind (the time median's 0.1 s ahead, and a frame); with a range,
 * only frames centred in it change, those across its edges blending in and out, and past their reach the input stays
 * sample for sample. With a `band` [lo, hi] Hz the gains hold inside it and fade to 0 dB over a third of an octave
 * either side of each edge (a raised cosine in log frequency, half way at the edge itself; no fade at an edge at 0 or
 * at the Nyquist frequency and past it): outside, each frequency goes back as it came, so a part can be moved in the
 * top of a mix and its body left alone.
 */
import audio from '../core.js'
import { rangeOf } from '../plan.js'
import { hann } from './dsp.js'
import { fft, ifft } from 'fourier-transform'

// frame, s; the medians' reach: over time each side, s; over frequency each side, Hz (the masks' slope is 4)
const FRAME = 0.046, SPAN = 0.1, BAND = 200

const geom = sr => {
  let N = 2 ** Math.round(Math.log2(FRAME * sr)), H = N / 4
  return { N, H, M: Math.max(1, Math.round(SPAN * sr / H)), Q: Math.max(1, Math.round(BAND * N / sr)) }
}
const lin = db => db == null ? 1 : db === -Infinity ? 0 : 10 ** (db / 20)
// how far the gains hold at each of K frequencies of a frame of N: 1 in the band, 0 past a third of an octave from it
const THIRD = 2 ** (1 / 3)
function weights(band, K, N, sr) {
  let w = new Float64Array(K).fill(1)
  if (!band) return w
  let [lo, hi] = band
  // 0 under e / THIRD, 1 over e · THIRD, a raised cosine in log frequency between
  const rise = (f, e) => f <= e / THIRD ? 0 : f >= e * THIRD ? 1 : 0.5 - 0.5 * Math.cos(Math.PI * Math.log(f * THIRD / e) / Math.log(THIRD * THIRD))
  for (let b = 0; b < K; b++) {
    let f = b * sr / N
    w[b] = (lo > 0 ? rise(f, lo) : 1) * (hi < sr / 2 ? 1 - rise(f, hi) : 1)
  }
  return w
}
const flat = o => lin(o.tonal) === 1 && lin(o.noise) === 1 && lin(o.transient) === 1
// output sample s is whole once the last frame over it is made, M frames after it is read: M hops and a frame
const latency = (o, sr) => { if (flat(o)) return 0; let { N, H, M } = geom(sr); return M * H + N - 1 }

function check(o) {
  for (let k of ['tonal', 'noise', 'transient']) if (o[k] != null && !(typeof o[k] === 'number' && o[k] === o[k] && o[k] < Infinity)) throw new TypeError(`deconstruct: ${k} is dB (−Infinity removes it), not ${o[k]}`)
  if (o.separation != null && !(o.separation >= 1)) throw new RangeError(`deconstruct: separation is 1 or more, not ${o.separation}`)
  let b = o.band
  if (b != null && !(Array.isArray(b) && b.length === 2 && b[0] >= 0 && b[1] > b[0] && b[1] < Infinity)) throw new RangeError(`deconstruct: band is [lo, hi] Hz, 0 ≤ lo < hi, not ${JSON.stringify(b)}`)
}

/** Replace `old` by `v` in the sorted run s[o..o + n), keeping it sorted: a sliding median's step. */
function swap(s, o, n, old, v) {
  let lo = o, hi = o + n - 1
  while (lo < hi) { let m = (lo + hi) >> 1; if (s[m] < old) lo = m + 1; else hi = m }
  let i = lo
  if (v > old) while (i + 1 < o + n && s[i + 1] < v) { s[i] = s[i + 1]; i++ }
  else while (i > o && s[i - 1] > v) { s[i] = s[i - 1]; i-- }
  s[i] = v
}

function init(ctx, nch) {
  let sr = ctx.sampleRate, { N, H, M, Q } = geom(sr), K = N / 2 + 1, F = 2 * M + 1
  let L = M * H + N - 1, R = 2 ** Math.ceil(Math.log2(L + 2 * N))
  return {
    N, H, M, Q, K, F, L, R,
    g: [lin(ctx.tonal), lin(ctx.noise), lin(ctx.transient)], beta: ctx.separation ?? 2, w: weights(ctx.band, K, N, sr),
    win: hann(N),
    p: Math.round((ctx.blockOffset || 0) * sr),
    in: Array.from({ length: nch }, () => new Float64Array(N)), dry: Array.from({ length: nch }, () => new Float32Array(R)),
    out: Array.from({ length: nch }, () => new Float64Array(R)),
    // the last F frames: each channel's spectrum, and the channels' mean magnitude
    re: Array.from({ length: F }, () => Array.from({ length: nch }, () => new Float64Array(K))),
    im: Array.from({ length: F }, () => Array.from({ length: nch }, () => new Float64Array(K))),
    mag: Array.from({ length: F }, () => new Float64Array(K)),
    // each frequency's last F magnitudes, sorted (the time median's window); a frame's 2Q + 1 around a frequency, sorted
    hs: new Float64Array(K * F), ps: new Float64Array(2 * Q + 1), next: new Float64Array(K),
    count: 0, frame: new Float64Array(N), G: new Float64Array(K),
    yr: new Float64Array(K), yi: new Float64Array(K), y: new Float64Array(N)
  }
}

/** Read frame k (it starts at kH, its last sample just arrived) into the ring; make frame k − M once its neighbours are. */
function step(st, k, a0, a1) {
  let { N, H, M, K, F, win, frame, next, hs } = st, nch = st.in.length, slot = ((k % F) + F) % F, mag = st.mag[slot]
  next.fill(0)
  for (let c = 0; c < nch; c++) {
    let x = st.in[c], s = k * H
    for (let i = 0; i < N; i++) frame[i] = x[(s + i) & (N - 1)] * win[i]
    let [re, im] = fft(frame)
    st.re[slot][c].set(re.subarray(0, K)); st.im[slot][c].set(im.subarray(0, K))
    for (let b = 0; b < K; b++) next[b] += Math.sqrt(re[b] * re[b] + im[b] * im[b]) / nch
  }
  // the frame replaces the one F before it in each frequency's sorted window
  for (let b = 0; b < K; b++) { swap(hs, b * F, F, mag[b], next[b]); mag[b] = next[b] }
  st.count++
  let j = k - M, js = ((j % F) + F) % F, centre = j * H + N / 2
  if (st.count <= M) return
  // gains only in frames centred in the range: elsewhere the frame goes back as it came
  let G = st.G, [gt, gn, gp] = st.g, beta = st.beta, Q = st.Q, W = 2 * Q + 1, mj = st.mag[js], ps = st.ps, w = st.w
  if (centre >= a0 && centre < a1) {
    // the frequency median slides along the frame, the frame reflected at its ends (as librosa's hpss filters)
    const at = b => mj[b < 0 ? -b : b > K - 1 ? 2 * (K - 1) - b : b]
    for (let i = 0; i < W; i++) ps[i] = at(i - Q)
    ps.sort()
    for (let b = 0; b < K; b++) {
      let h = hs[b * F + M], p = ps[Q]
      // soft masks on the medians' ratio: tonal over `beta`·transient, transient over `beta`·tonal, noise between
      let r = h > 0 ? beta * p / h : Infinity, u = p > 0 ? beta * h / p : Infinity
      r *= r; u *= u
      let mt = 1 / (1 + r * r), mp = 1 / (1 + u * u)
      // (the masks sum to 1: at weight 0 the gain is 1, the frequency as it came)
      G[b] = 1 + w[b] * (gt * mt + gp * mp + gn * (1 - mt - mp) - 1)
      if (b < K - 1) swap(ps, 0, W, at(b - Q), at(b + Q + 1))
    }
  } else G.fill(1)
  for (let c = 0; c < nch; c++) {
    let re = st.re[js][c], im = st.im[js][c], yr = st.yr, yi = st.yi
    for (let b = 0; b < K; b++) { yr[b] = re[b] * G[b]; yi[b] = im[b] * G[b] }
    ifft(yr, yi, st.y)
    let o = st.out[c], s = j * H, R = st.R
    // overlap-add with the window again; Σw² over a quarter-frame hop is 1.5
    for (let i = 0; i < N; i++) o[(s + i) & (R - 1)] += st.y[i] * win[i] / 1.5
  }
}

function deconstruct(input, output, ctx) {
  let len = input[0].length, nch = input.length
  if (flat(ctx)) { for (let c = 0; c < nch; c++) output[c].set(input[c]); return }
  let st = ctx._dc ??= init(ctx, nch), sr = ctx.sampleRate, { N, H, L, R } = st
  let [a0, a1] = rangeOf(ctx)
  for (let i = 0; i < len; i++, st.p++) {
    let p = st.p
    for (let c = 0; c < nch; c++) { st.in[c][p & (N - 1)] = input[c][i]; st.dry[c][p & (R - 1)] = input[c][i] }
    if ((p + 1) % H === 0) step(st, (p + 1 - N) / H, a0, a1)
    // out of every changed frame's reach (a frame centred in the range reaches half a frame past it): the input itself
    let q = p - L, near = q >= a0 - N / 2 && q < a1 + N / 2, r = q & (R - 1)
    for (let c = 0; c < nch; c++) { let o = st.out[c]; output[c][i] = q < 0 ? 0 : near ? o[r] : st.dry[c][r]; o[r] = 0 }
  }
}

audio.op('deconstruct', {
  params: ['tonal', 'noise', 'transient'],
  nonfinite: { tonal: { '-Infinity': 'taken out' }, noise: { '-Infinity': 'taken out' }, transient: { '-Infinity': 'taken out' } },
  ranged: true,
  latency,
  // a frame and the time median's frames before the first sample made
  warmup: (o, sr) => { if (flat(o)) return 0; let { N, H, M } = geom(sr); return latency(o, sr) + N + M * H },
  process: (input, output, ctx) => { if (!ctx._dc) check(ctx); deconstruct(input, output, ctx) },
})
