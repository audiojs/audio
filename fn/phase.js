/**
 * Phase: polarity, and every frequency's phase turned by one angle (iZotope RX Phase).
 *
 * a.phase(180)                         → polarity inverted: every sample negated
 * a.phase(180, { channel: 1 })         → the right channel's polarity alone
 * a.phase(90)                          → each frequency's phase 90° on: the Hilbert transform, magnitudes kept
 * a.phase({ t: [0, 10], v: [0, 90] })  → turning from 0° to 90° over 10 s (degrees, as the gain line's points)
 * a.phase()                            → turned over time by the angle that lowers the peaks most
 *
 * A turn by θ is y = x·cos θ − H{x}·sin θ, H the Hilbert transform: a sinusoid's phase moves by θ, its amplitude stays,
 * so the magnitude spectrum, the RMS and the loudness are the input's, and a turn by −θ after it gives the input back.
 * 180° is x negated, at no latency (without a range); 0° the input, sample for sample.
 * H is the ideal (2/π)/n at odd n under a Kaiser window, β 10 (Oppenheim & Schafer, Discrete-Time Signal Processing,
 * 3rd ed., §7.6 and §12.4.3), 2D + 1 taps, D the power of two nearest 93 ms less one (4095 at 44.1 and 48 kHz): its
 * magnitude within 0.0002 dB of 1 from 20 Hz to 20 Hz under Nyquist (0.5 dB down at 10 Hz). It runs by overlap-save
 * FFT in blocks of 2D + 2, so the turn streams 3D + 2 samples behind (0.28 s at 44.1 kHz).
 *
 * Unset (or 'auto'), the angle is found from the sound (RX's adaptive phase rotation): a voice's waveform leans to one
 * side (the glottis closes faster than it opens), and turned it stands more evenly about zero, its peaks lower for the
 * same RMS. Its input is read first (as denoise learns its noise): every 0.2 s its peak is measured, exactly, under every
 * turn there from each 5° step to each within 30° of it, the angle moving straight between steps; the path through
 * them whose peaks are lowest (their 8th powers summed: the loudest weigh most) is the one taken, at most 150° a second
 * (a 0.42 Hz shift while it moves, no pitch to hear). Channels turn together, the stereo image kept. Where no path
 * lowers the peak below the best single angle, that angle; the peak never rises. On VoiceBank's clean test sentences
 * (the first 30 of each speaker), the peak 0.7 dB lower on average for p232, up to 2.9, and 0.8 for p257, up to 1.8;
 * where the two alternate, each sentence peak-normalized, each 1.3 to 2.9 dB lower, where no single angle lowers both.
 *
 * With a range ({ at, duration }), the angle rises from 0 over its first 10 ms and back over its last, its edges
 * untouched. Each output sample turns by the angle at its own time.
 */
import audio, { arrived, parseTime } from '../core.js'
import { isCurve, curveFn } from '../plan.js'
import { fft, ifft } from 'fourier-transform'

const TURNS = Symbol('phase.turns'), RAMP = 0.01, REACH = 0.093, BETA = 10
// the search: a node every SEG s, STEPS angles over half a turn (|y| repeats every 180°), at most WIDE steps apart
const SEG = 0.2, STEPS = 36, WIDE = 6
const rad = Math.PI / 180

const i0 = x => { let s = 1, t = 1; for (let k = 1; k < 80; k++) s += t *= (x / 2 / k) ** 2; return s }

// The transformer at a rate: its causal taps' spectrum on an FFT of N = 4(D + 1), blocks of B = N / 2 (N − B ≥ 2D,
// the taps' reach, so the block's last B outputs are the linear convolution)
let designs = new Map()
function design(sr) {
  let d = designs.get(sr)
  if (d) return d
  let D = 2 ** Math.round(Math.log2(REACH * sr)) - 1, N = 4 * (D + 1), B = N / 2, h = new Float64Array(N)
  for (let n = 1; n <= D; n += 2) { let v = 2 / (Math.PI * n) * i0(BETA * Math.sqrt(1 - (n / (D + 1)) ** 2)) / i0(BETA); h[D + n] = v; h[D - n] = -v }
  let [re, im] = fft(h)
  designs.set(sr, d = { D, N, B, Hr: Float64Array.from(re), Hi: Float64Array.from(im) })
  return d
}

/** Hilbert transformer over a stream: write channels' samples; every B written, `dry` and `hil` hold, per channel, the
 *  B samples D before them and their transform (the input's sample j of the block at dry[j], D later than written). */
function transformer(nch, sr, emit) {
  let { D, N, B, Hr, Hi } = design(sr), hist = Array.from({ length: nch }, () => new Float64Array(N))
  let R = new Float64Array(B + 1), I = new Float64Array(B + 1), y = new Float64Array(N)
  let t = { D, B, n: 0, dry: hist.map(() => new Float64Array(B)), hil: hist.map(() => new Float64Array(B)) }
  t.write = (x, from, to) => {
    for (let i = from; i < to;) {
      let k = Math.min(to - i, B - t.n)
      for (let c = 0; c < nch; c++) { let h = hist[c], s = x[c]; for (let j = 0; j < k; j++) h[B + t.n + j] = s ? s[i + j] : 0 }
      t.n += k; i += k
      if (t.n < B) continue
      for (let c = 0; c < nch; c++) {
        let h = hist[c], [re, im] = fft(h), dry = t.dry[c], hil = t.hil[c]
        for (let k = 0; k <= B; k++) { R[k] = re[k] * Hr[k] - im[k] * Hi[k]; I[k] = re[k] * Hi[k] + im[k] * Hr[k] }
        ifft(R, I, y)
        for (let j = 0; j < B; j++) { dry[j] = h[B + j - D]; hil[j] = y[B + j] }
        h.copyWithin(0, B)
      }
      t.n = 0
      emit?.(t.dry, t.hil)
    }
  }
  return t
}

const isAuto = v => v == null || v === 'auto'
const fixed = o => !isAuto(o.angle) && typeof o.angle === 'number'
// a turn that only negates or keeps: no transform, no latency (a range's ramps need the transform)
const flip = o => fixed(o) && o.at == null && o.duration == null && Math.abs(Math.sin(o.angle * rad)) < 1e-12
const latency = (o, sr) => { if (flip(o)) return 0; let { D, B } = design(sr); return B + D }

function check(o) {
  let v = o.angle
  if (!(isAuto(v) || Number.isFinite(v) || typeof v === 'function' || isCurve(v)))
    throw new TypeError(`phase: angle is degrees, a curve { t, v } or t => degrees, or 'auto', not ${JSON.stringify(v)}`)
}

function phase(input, output, ctx) {
  let sr = ctx.sampleRate, len = input[0].length, nch = input.length
  if (flip(ctx)) { let g = Math.cos(ctx.angle * rad) < 0 ? -1 : 1; for (let c = 0; c < nch; c++) for (let i = 0; i < len; i++) output[c][i] = g * input[c][i]; return }
  let st = ctx._ph
  if (!st) {
    let v = ctx.angle, turns = ctx[TURNS]
    if (isAuto(v) && !turns) throw new Error('phase: the angle is found before rendering, through read(), stream() or save()')
    let f = isAuto(v) ? curveFn(turns.curve) : typeof v === 'function' ? v : isCurve(v) ? curveFn(v) : null
    st = ctx._ph = { tr: transformer(nch, sr), f, c: Math.cos(v * rad), s: Math.sin(v * rad) }
    st.lat = st.tr.B + st.tr.D
  }
  // the range, absolute (ctx.at is block-relative), in samples of the timeline
  let p0 = Math.round((ctx.blockOffset || 0) * sr), ranged = ctx.at != null || ctx.duration != null
  let a0 = ctx.at != null ? Math.round((ctx.at + (ctx.blockOffset || 0)) * sr) : 0, a1 = ctx.duration != null ? a0 + Math.round(ctx.duration * sr) : Infinity
  let R = Math.max(1, Math.round(RAMP * sr)), { tr, f } = st
  for (let i = 0; i < len;) {
    let k = Math.min(len - i, tr.B - tr.n), at = tr.n
    for (let j = 0; j < k; j++) {
      // the sample this one turns, `lat` before it
      let m = p0 + i + j - st.lat, c = st.c, s = st.s
      let r = !ranged ? 1 : m < a0 || m >= a1 ? 0 : Math.min(1, (m - a0 + 0.5) / R, (a1 - m - 0.5) / R)
      if (f || r < 1) {
        let th = (f ? f(m / sr) : ctx.angle) * rad * Math.sin(r * Math.PI / 2) ** 2
        c = Math.cos(th); s = Math.sin(th)
      }
      for (let ch = 0; ch < nch; ch++) output[ch][i + j] = s ? c * tr.dry[ch][at + j] - s * tr.hil[ch][at + j] : c * tr.dry[ch][at + j]
    }
    tr.write(input, i, i + k)
    i += k
  }
}

/** Find the angle path for an unset angle: the edit's input (its range) read once, before rendering. */
async function prepare(a, index) {
  let o = a.edits[index][1]
  check(o)
  if (!isAuto(o.angle)) { delete o[TURNS]; return }
  await arrived(a)
  let chs = o.channel == null ? null : [o.channel].flat()
  let stamp = `${a.version}:${a._.len}:${o.at}:${o.duration}:${chs ?? ''}`
  if (o[TURNS]?.stamp === stamp) return
  let input = audio.from(a, { sampleRate: a._.sr })
  input.edits = a.edits.slice(0, index)
  input.version = index
  let sr = input.sampleRate, T = input.duration, at = parseTime(o.at) ?? 0, d = parseTime(o.duration)
  if (at < 0) at = Math.max(0, T + at)
  let n = Math.max(0, Math.round(Math.min(d ?? Infinity, T - at) * sr))
  let { t, v } = await turns(input.stream({ at, duration: n / sr }), n, sr, chs)
  o[TURNS] = { stamp, curve: { t: t.map(s => at + s), v } }
}

/** The turn over time whose peaks are lowest, from a stream of n samples: { t: seconds, v: degrees } at each node. */
export async function turns(stream, n, sr, chs) {
  let F = Math.max(1, Math.round(SEG * sr)), K = Math.max(1, Math.ceil(n / F)), W = 2 * WIDE + 1
  let cost = new Float32Array(K * STEPS * W), nch = 0, tr = null, A = null, P = null, U = null, fill = 0, k = 0, m = 0
  // each segment's peak under each turn: node j's angle at its start, j + d's at its end, straight between
  const segment = () => {
    let len = fill, top = 0
    for (let i = 0; i < len; i++) top = Math.max(top, A[i])
    let C = cost.subarray(k * STEPS * W, (k + 1) * STEPS * W), cut = 0.5 * top
    // the samples that can be a peak under some turn: those whose envelope reaches the lowest peak any turn leaves;
    // looked for over half the top first, and further down only if a turn leaves a peak below that
    for (;;) {
      let idx = []
      for (let i = 0; i < len; i++) if (A[i] >= cut) idx.push(i)
      idx.sort((p, q) => A[q] - A[p])
      let low = Infinity
      for (let j = 0; j < STEPS; j++) for (let d = -WIDE; d <= WIDE; d++) {
        let t0 = j * Math.PI / STEPS, dt = d * Math.PI / STEPS, p = 0
        for (let i of idx) { if (A[i] <= p) break; let v = Math.abs(A[i] * Math.cos(P[i] + t0 + dt * U[i])); if (v > p) p = v }
        C[j * W + d + WIDE] = p
        if (p < low) low = p
      }
      if (low >= cut || cut === 0) break
      cut = low
    }
    k++; fill = 0
  }
  const take = (dry, hil) => {
    for (let j = 0; j < tr.B; j++, m++) {
      if (m < 0) continue
      if (m >= n) return
      let u = (m % F) / F
      for (let c = 0; c < nch; c++) { A[fill] = Math.hypot(dry[c][j], hil[c][j]); P[fill] = Math.atan2(hil[c][j], dry[c][j]); U[fill++] = u }
      if (fill === F * nch || m === n - 1) segment()
    }
  }
  for await (let block of stream) {
    let x = chs ? chs.map(c => block[c]) : block
    if (!tr) { nch = x.length; tr = transformer(nch, sr, take); m = -tr.D; A = new Float32Array(F * nch); P = new Float32Array(F * nch); U = new Float32Array(F * nch) }
    tr.write(x, 0, x[0].length)
  }
  if (!tr || !n) return { t: [0], v: [0] }
  // the tail: zeros through until the last sample has come out
  while (m < n) tr.write([], 0, tr.B - tr.n)

  // the path: dynamic programming over the nodes, the 8th powers of the segments' peaks summed (a step costs a hair,
  // so a path holds still where nothing is gained)
  let top = 0
  for (let s = 0; s < K; s++) top = Math.max(top, cost[(s * STEPS) * W + WIDE])
  if (!top) return { t: [0], v: [0] }
  let V = new Float64Array(STEPS), from = new Int16Array(K * STEPS), next = new Float64Array(STEPS)
  for (let s = 0; s < K; s++) {
    next.fill(Infinity)
    for (let j = 0; j < STEPS; j++) for (let d = -WIDE; d <= WIDE; d++) {
      let e = (j + d + STEPS) % STEPS, v = V[j] + (cost[(s * STEPS + j) * W + d + WIDE] / top) ** 8 + 1e-9 * Math.abs(d)
      if (v < next[e]) { next[e] = v; from[s * STEPS + e] = j }
    }
    V.set(next)
  }
  let j = V.indexOf(Math.min(...V)), path = new Int16Array(K + 1)
  path[K] = j
  for (let s = K - 1; s >= 0; s--) path[s] = j = from[s * STEPS + j]
  // its peak, and the best single angle's: the path only where it is lower
  let peak = 0, best = Infinity, bj = 0
  for (let s = 0; s < K; s++) { let d = (path[s + 1] - path[s] + STEPS + WIDE) % STEPS - WIDE; peak = Math.max(peak, cost[(s * STEPS + path[s]) * W + d + WIDE]) }
  for (let j = 0; j < STEPS; j++) { let p = 0; for (let s = 0; s < K; s++) p = Math.max(p, cost[(s * STEPS + j) * W + WIDE]); if (p < best) { best = p; bj = j } }
  if (peak >= best) return { t: [0], v: [bj * 180 / STEPS] }
  let t = [], v = [], deg = path[0] * 180 / STEPS
  for (let s = 0; s <= K; s++) {
    if (s) deg += ((path[s] - path[s - 1] + STEPS + WIDE) % STEPS - WIDE) * 180 / STEPS
    t.push(s * F / sr); v.push(deg)
  }
  return { t, v }
}

audio.op('phase', {
  params: ['angle'],
  ranged: true,
  // a curve reaches the op as is: each sample turns by the angle at its own time, `lat` before it
  fnArgs: ['angle'],
  latency,
  // the transform's history: a block's FFT reaches a block before it, the output a block and D behind
  warmup: (o, sr) => flip(o) ? 0 : 3 * design(sr).B,
  prepare,
  process: phase,
})
