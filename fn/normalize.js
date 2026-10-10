import { dcOffsets, peakDb, rmsDb, lufsDb, lufsFromStats, printed } from './loudness.js'
import audio, { resolveChannels, FULL, blockAt } from '../core.js'
import { buildPlan, render } from '../plan.js'

// Integrated-loudness presets (LUFS): Spotify (YouTube, Tidal and Amazon Music play at it too), Apple Podcasts, EBU R 128;
// 'streaming', Spotify's name before it had its own, still read
const PRESETS = { spotify: -14, podcast: -16, broadcast: -23 }, FORMER = { streaming: 'spotify' }
const MODES = ['peak', 'lufs', 'rms']


/** DC removal — subtracts per-channel offset. Internal to normalize. */
audio.op('dc', {
  hidden: true,
  params: ['shift'],
  process: (input, output, ctx) => {
    let shift = ctx.shift
    if (typeof shift === 'number') shift = [shift]
    let prev = ctx._pd
    ctx._pd = shift.slice ? shift.slice() : shift
    for (let c = 0; c < input.length; c++) {
      let d = shift[c % shift.length] || 0
      let pd = prev ? (prev[c % prev.length] || 0) : d
      let inp = input[c], out = output[c], len = inp.length
      if (Math.abs(d) < 1e-10 && Math.abs(pd) < 1e-10) { out.set(inp); continue }
      if (pd !== d) {
        for (let i = 0; i < len; i++) out[i] = inp[i] - (pd + (d - pd) * i / len)
      } else {
        for (let i = 0; i < len; i++) out[i] = inp[i] - d
      }
    }
  },
  deriveStats: (stats, opts) => {
    let shift = opts.shift
    if (typeof shift === 'number') shift = [shift]
    let ch = stats.min.length
    for (let c = 0; c < ch; c++) {
      let d = shift[c % shift.length] || 0
      if (Math.abs(d) < 1e-10) continue
      let n = stats.min[c].length
      for (let i = 0; i < n; i++) {
        // E[(x-d)²] = E[x²] - 2d·E[x] + d²
        if (stats.ms) stats.ms[c][i] = stats.ms[c][i] - 2 * d * stats.dc[c][i] + d * d
        stats.min[c][i] -= d
        stats.max[c][i] -= d
        if (stats.dc) stats.dc[c][i] -= d
      }
      if (stats.clipping) for (let i = 0; i < n; i++)
        stats.clipping[c][i] = (stats.min[c][i] <= -FULL || stats.max[c][i] >= FULL) ? Math.max(1, stats.clipping[c][i]) : 0
    }
    // energy: k-weighting high-passes, DC offset has no effect
  }
})

// ── True-peak ceiling ────────────────────────────────────────────────────
// 4× reconstruction per ITU-R BS.1770-5 Annex 2, read as @audio/loudness-truepeak reads it:
// the 96-tap Kaiser-windowed sinc (β 8) at the 4× points, and a parabola through each local
// maximum of them and its neighbours, where a limited waveform peaks between the points. The
// band-limited peak of the output (read 32× through a Kaiser sinc, β 14, 64 samples a side)
// stays within 0.005 dB of the ceiling at 16-48 kHz, 0.013 dB at 8 kHz and on full-band noise
// 0.008 dB (speech and noise limited 20 dB). (The Annex's 48-tap example filter
// under-reads content near Nyquist, -0.9 dB on full-band noise; the 32-tap Lanczos kernel
// before this one let limited speech out up to 0.22 dB over the ceiling at 8 kHz, 0.06 at
// 16 kHz.) With the newest input at n, phases ¼ ½ ¾ land inside the interval (n−48, n−47).
const HALF = 48, TAPS = 2 * HALF, MID = HALF, LOOK = 0.005, RELEASE = 0.1, BETA = 8
const sinc = x => x === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x)
const i0 = x => { let s = 1, t = 1; for (let k = 1; k < 50; k++) s += t *= (x / 2 / k) ** 2; return s }
// The ¼ filter, the ¾ its mirror, the ½ its own: folded about the middle, each pair of taps x[n − k], x[n − 95 + k]
// reads as their sum and difference, 3 products a pair for the 3 phases (ODD: half the ¼ filter's odd part)
const fir = f => { let h = new Float64Array(TAPS), w = 0; for (let j = 0; j < TAPS; j++) { let x = HALF - j - f; w += h[j] = sinc(x) * i0(BETA * Math.sqrt(1 - (x / HALF) ** 2)) / i0(BETA) }; return h.map(v => v / w) }
const QTR = fir(0.25), HLF = fir(0.5)
const EVEN = new Float64Array(HALF), ODD = new Float64Array(HALF), MIDF = new Float64Array(HALF)
for (let k = 0; k < HALF; k++) { EVEN[k] = (QTR[k] + QTR[TAPS - 1 - k]) / 2; ODD[k] = (QTR[k] - QTR[TAPS - 1 - k]) / 2; MIDF[k] = (HLF[k] + HLF[TAPS - 1 - k]) / 2 }
// |y_p| ≤ Σ |h_k|·|x[n − k]| ≤ Σ over blocks of 8 samples of the block's max |x| times its taps' Σ|h|, the most of the 3
// phases and of the 8 windows starting in a block: BOUND[j] weighs block j of the 13 the 8 windows reach, one bound for
// all 8. A parabola's vertex ≤ 9/8 of its peak point: where 9/8 of that bound stays under the ceiling no estimate can
// reach it, and the FIR is skipped
const BLK = 8, NB = TAPS / BLK + 1, BOUND = new Float64Array(NB)
for (let r = 0; r < BLK; r++) {
  let w = new Float64Array(NB)
  for (let k = 0; k < TAPS; k++) w[(r + TAPS - k) >> 3] += Math.max(Math.abs(QTR[k]), Math.abs(HLF[k]), Math.abs(QTR[TAPS - 1 - k]))
  for (let j = 0; j < NB; j++) if (w[j] > BOUND[j]) BOUND[j] = w[j]
}
// Where it can't skip a block's windows, a window is bound tighter by its 16 middle taps, taken exactly (CEN folded
// pairs), and the rest at their Σ|h| times the most the 8 windows reach (TAIL): on speech limited 3 dB the limiter
// takes a quarter of the time the FIR everywhere does, its gain the same to a float32 ulp
const CEN = 8, TAIL = Math.max(...[QTR, HLF].map(h => h.reduce((t, v, k) => k < HALF - CEN || k >= HALF + CEN ? t + Math.abs(v) : t, 0)))
/** Vertex of the parabola through equally spaced l, m, r when m is their maximum, else m. */
const vertex = (l, m, r) => { let c = 2 * m - l - r; return m >= l && m >= r && c > 0 ? m + (l - r) * (l - r) / (8 * c) : m }

/** The reconstructed peak of channels fed block by block → reach(input, t, pk): for each new sample x[n] of the block,
 *  pk[i] the most any channel reaches over the interval (n − MID, n − MID + 1), its two samples, its 4× points and the
 *  parabolas through them; exact wherever it can pass `t`, elsewhere the samples' (both then ≤ t). The FIR runs only
 *  where the bounds let an estimate pass t. */
function reacher(nch) {
  let ext = [], top = [], pks = new Float64Array(0)
  // each channel's |point| before x[m], the ¾ one of the interval before: exact where `known`, else its bound; the
  // bound of the 8 windows from the last block start
  let last = new Float64Array(nch), known = new Uint8Array(nch).fill(1), bound = new Float64Array(nch), most = new Float64Array(nch)
  return (input, t) => {
    let len = input[0].length, end = TAPS + len, cold = t * 8 / 9
    // each channel's TAPS samples before this block, then the block; the most of each 8 of them
    if (!ext.length || ext[0].length < end) {
      ext = input.map((_, c) => { let b = new Float32Array(end); if (ext[c]) b.set(ext[c].subarray(0, TAPS)); return b })
      top = ext.map(() => new Float32Array(Math.ceil(end / BLK)))
      pks = new Float64Array(len)
    }
    for (let c = 0; c < nch; c++) {
      let e = ext[c], q = top[c]
      e.set(input[c], TAPS)
      for (let j = 0, b = 0; j < end; j += BLK, b++) { let mx = 0; for (let i = j, z = Math.min(end, j + BLK); i < z; i++) { let v = e[i] < 0 ? -e[i] : e[i]; if (v > mx) mx = v }; q[b] = mx }
    }
    for (let i = 0; i < len; i++) {
      let pk = 0, o = i + TAPS   // e[o]: the newest sample, x[n]
      if (!(i & 7)) for (let c = 0, j = i >> 3; c < nch; c++) {
        let q = top[c], u = 0, mx = 0
        for (let k = 0; k < NB; k++) { let v = q[j + k]; u += BOUND[k] * v; if (v > mx) mx = v }
        bound[c] = u; most[c] = mx
      }
      for (let c = 0; c < nch; c++) {
        let e = ext[c], a = e[o - MID], b = e[o - MID + 1]   // x[n − MID], x[n − MID + 1]
        a = a < 0 ? -a : a; b = b < 0 ? -b : b
        if (a > pk) pk = a
        if (b > pk) pk = b
        // the window's bound: no point of this interval, nor a vertex over them, can pass t
        let l = last[c], hi = a > b ? a : b
        if (l > hi) hi = l
        // the 3 points from the middle taps first; the rest of the taps only where those can't bind them
        let s0 = 0, s1 = 0, s2 = 0
        if (hi <= cold) {
          if (bound[c] <= cold) { last[c] = bound[c]; known[c] = 0; continue }
          for (let k = HALF - CEN; k < HALF; k++) { let x = e[o - k], y = e[o - TAPS + 1 + k], s = x + y; s0 += EVEN[k] * s; s1 += ODD[k] * (x - y); s2 += MIDF[k] * s }
          let r = TAIL * most[c], u1 = s0 + s1, u3 = s0 - s1
          u1 = (u1 < 0 ? -u1 : u1) + r; u3 = (u3 < 0 ? -u3 : u3) + r
          if (u1 <= cold && u3 <= cold && (s2 < 0 ? -s2 : s2) + r <= cold) { last[c] = u3; known[c] = 0; continue }
        }
        else for (let k = HALF - CEN; k < HALF; k++) { let x = e[o - k], y = e[o - TAPS + 1 + k], s = x + y; s0 += EVEN[k] * s; s1 += ODD[k] * (x - y); s2 += MIDF[k] * s }
        // the ¾ point before, where it was bound only
        if (!known[c]) {
          let p = o - 1, s0 = 0, s1 = 0
          for (let k = 0; k < HALF; k++) { let x = e[p - k], y = e[p - TAPS + 1 + k]; s0 += EVEN[k] * (x + y); s1 += ODD[k] * (x - y) }
          l = s0 - s1; l = l < 0 ? -l : l; known[c] = 1
        }
        // the points a, ¼, ½, ¾, b in time order, each local maximum refined by its parabola
        for (let k = 0; k < HALF - CEN; k++) { let x = e[o - k], y = e[o - TAPS + 1 + k], s = x + y; s0 += EVEN[k] * s; s1 += ODD[k] * (x - y); s2 += MIDF[k] * s }
        let y1 = s0 + s1, y2 = s2, y3 = s0 - s1
        y1 = y1 < 0 ? -y1 : y1; y2 = y2 < 0 ? -y2 : y2; y3 = y3 < 0 ? -y3 : y3
        let v = vertex(l, a, y1)
        if (v > pk) pk = v
        if ((v = vertex(a, y1, y2)) > pk) pk = v
        if ((v = vertex(y1, y2, y3)) > pk) pk = v
        if ((v = vertex(y2, y3, b)) > pk) pk = v
        last[c] = y3
      }
      pks[i] = pk
    }
    for (let c = 0; c < nch; c++) ext[c].copyWithin(0, len, end)
    return pks
  }
}

/** Channel-linked lookahead limiter holding the reconstructed (true) peak at `limit` dBTP.
 *  Required gain g[m] covers the samples and 4× interpolants on both sides of m; a sliding
 *  minimum over the lookahead window widened by the kernel's reach (HALF) each side, then its
 *  moving average, gives a smooth gain that provably stays ≤ g at every output sample and holds
 *  flat at it over the HALF samples each side of m: an interpolant reads its taps at one gain.
 *  (Unwidened, the attack ramp crossed the kernel: 8 kHz speech limited 20 dB came out at
 *  -0.91 dBTP under a -1 ceiling.) Release only ever pulls the gain further down. Output is
 *  delayed MID + lookahead + HALF; where nothing reaches the ceiling, it is the input. Given `peaks` (peaksOf: its
 *  input's, read before its `gain` dB), it reads them where they hold at that gain, not again. */
function ceiling(input, output, ctx) {
  let nch = input.length, len = input[0].length, sr = ctx.sampleRate
  let st = ctx._tp
  if (!st) {
    let L = Math.round(LOOK * sr), W = L + 1, Q = W + 2 * HALF, D = MID + L + HALF
    st = ctx._tp = {
      L, W, Q, D, n: 0, rPrev: 1, env: 1, sum: W, ai: 0, qh: 0, qt: 0, qk: 0, di: 0, quiet: Q + W, reach: reacher(nch),
      avg: new Float64Array(W).fill(1), qv: new Float64Array(Q), qn: new Float64Array(Q),
      dl: Array.from({ length: nch }, () => new Float32Array(D)),
      rel: 1 - Math.exp(-1 / (RELEASE * sr)),
    }
  }
  let { L, W, Q, D, avg, qv, qn, dl, rel } = st
  // range gating in absolute input samples (ranged op: ctx.at is block-relative)
  let base = Math.round((ctx.blockOffset || 0) * sr), lim = 10 ** ((ctx.limit ?? -1) / 20)
  let P = ctx.peaks, s = P && 10 ** ((ctx.gain ?? 0) / 20)
  let pks = P && P.floor * s <= lim ? scaled(P, base, len, s, st) : st.reach(input, lim)
  let r0 = ctx.at != null ? base + Math.round(ctx.at * sr) : -Infinity
  let r1 = ctx.duration != null ? r0 + Math.round(ctx.duration * sr) : Infinity
  // the deque a ring: its head, the slot after its tail, how many it holds; how many samples in a row needed no limiting
  let n = st.n, rPrev = st.rPrev, env = st.env, sum = st.sum, ai = st.ai, qh = st.qh, qt = st.qt, qk = st.qk, di = st.di, quiet = st.quiet

  for (let i = 0; i < len; i++, n++) {
    let m = n - MID, pk = pks[i]
    let r = pk > lim && m >= r0 && m < r1 ? lim / pk : 1
    let g = r < rPrev ? r : rPrev
    rPrev = r
    // none to limit over the deque's span and the average's: both all 1 as they stand, the gain released toward 1
    quiet = g < 1 ? 0 : quiet + 1
    if (quiet > Q + W) {
      env = env > 1 - 2 ** -30 ? 1 : env + (1 - env) * rel
      for (let c = 0; c < nch; c++) { let d = dl[c]; output[c][i] = d[di] * env; d[di] = input[c][i] }
      di = di + 1 === D ? 0 : di + 1
      continue
    }
    // sliding minimum of g over [m − L − 2·HALF, m] (monotonic deque, capacity Q)
    while (qk && qv[qt ? qt - 1 : Q - 1] >= g) { qt = qt ? qt - 1 : Q - 1; qk-- }
    qv[qt] = g; qn[qt] = m; qt = qt + 1 === Q ? 0 : qt + 1; qk++
    if (qn[qh] < m - L - 2 * HALF) { qh = qh + 1 === Q ? 0 : qh + 1; qk-- }
    let mn = qv[qh]
    // its moving average over [m − L, m] → the gain for output sample m − L − HALF
    sum += mn - avg[ai]; avg[ai] = mn; ai = ai + 1 === W ? 0 : ai + 1
    // all 1 again, the sum is W, not what its rounding left (calm, above); the release, as close to 1 as a float32
    // sample tells, is 1
    if (quiet === Q + W) sum = W
    let G = sum / W
    env = G < env ? G : env + (G - env) * rel
    if (G === 1 && env > 1 - 2 ** -30) env = 1
    for (let c = 0; c < nch; c++) { let d = dl[c]; output[c][i] = d[di] * env; d[di] = input[c][i] }
    di = di + 1 === D ? 0 : di + 1
  }
  st.n = n; st.rPrev = rPrev; st.env = env; st.sum = sum; st.ai = ai; st.qh = qh; st.qt = qt; st.qk = qk; st.di = di; st.quiet = quiet
}

/** The reconstructed peaks of channels `chs` of `chunks` (blocks of channels, as ctx.stream gives them), as ceiling()
 *  reads them, sample n's over the interval (n − MID, n − MID + 1), those over `floor` (exact there): { floor, n, at,
 *  pk }, `n` of them, at samples `at`; past the end, the silence the ceiling reads. Read once, every pass of normalize
 *  after (each the ceiling at another gain) scales them, none reads them again. Null past BUDGET of them. */
const BUDGET = 1 << 22, MARGIN = 1
function peaksOf(chunks, chs, floor) {
  let reach = null, nch = 0, t = 0, P = { floor, n: 0, at: new Uint32Array(1024), pk: new Float32Array(1024) }
  const take = block => {
    let pks = reach(block, floor)
    for (let i = 0, len = block[0].length; i < len; i++, t++) if (pks[i] > floor) {
      if (P.n === P.at.length) {
        if (P.n >= BUDGET) return false
        let at = new Uint32Array(2 * P.n), pk = new Float32Array(2 * P.n)
        at.set(P.at); pk.set(P.pk); P.at = at; P.pk = pk
      }
      P.at[P.n] = t; P.pk[P.n++] = pks[i]
    }
    return true
  }
  for (let chunk of chunks) {
    let block = chs.map(c => chunk[c])
    if (!reach) { nch = block.length; reach = reacher(nch) }
    if (!take(block)) return null
  }
  return !reach || take(Array.from({ length: nch }, () => new Float32Array(TAPS))) ? P : null
}
/** Peaks of samples [at, at + len) times `s`, those under the floor 0, into the ceiling's state `st` */
function scaled(P, at, len, s, st) {
  let out = st.pks?.length >= len ? st.pks : st.pks = new Float64Array(len), lo = 0, hi = P.n
  out.fill(0, 0, len)
  while (lo < hi) { let mid = (lo + hi) >> 1; P.at[mid] < at ? lo = mid + 1 : hi = mid }
  for (let j = lo; j < P.n && P.at[j] < at + len; j++) out[P.at[j] - at] = P.pk[j] * s
  return out
}
/** Whether peaks times `gain` dB pass `limit` dBTP anywhere over samples [r0, r1) the ceiling puts out */
function over(P, gain, limit, r0, r1) {
  let t = 10 ** ((limit - gain) / 20)
  for (let j = 0; j < P.n; j++) { let m = P.at[j] - MID; if (P.pk[j] > t && m >= r0 && m < r1) return true }
  return false
}

/** True-peak ceiling (dBTP), internal to normalize. */
audio.op('ceiling', {
  hidden: true,
  ranged: true,
  params: ['limit'],
  latency: (o, sr) => MID + Math.round(LOOK * sr) + HALF,
  process: ceiling,
})

/** Loudness after `gain` dB and the ceiling, from block stats: a block model of the limiter,
 *  each block at the gain its sample peak needs (channel-linked), held down by the release
 *  across later blocks, energy scaled by gain². Blocks don't carry how peaks fall inside them,
 *  so against rendered output it errs by the material: within 0.01 LU while limiting takes
 *  < 0.2 LU, up to ±0.2 LU at 2 LU and ±0.5 LU at 5–9 LU of limiting (speech high, dense music low). */
function limitedLufs(stats, chs, sr, gainDb, ceilDb, from, to) {
  let G = 10 ** (gainDb / 20), c = 10 ** (ceilDb / 20), bs = stats.blockSize
  let k = 1 - Math.exp(-bs / (RELEASE * sr)), n = stats.energy[chs[0]].length, env = 1
  let energy = stats.energy.map(e => e)
  for (let ch of chs) energy[ch] = new Float32Array(n)
  for (let b = 0; b < n; b++) {
    let p = 0
    for (let ch of chs) { let lo = stats.min[ch][b], hi = stats.max[ch][b]; p = Math.max(p, lo < 0 ? -lo : lo, hi < 0 ? -hi : hi) }
    let r = p * G > c ? c / (p * G) : 1
    env = Math.min(r, env + (1 - env) * k)
    for (let ch of chs) energy[ch][b] = stats.energy[ch][b] * G * G * env * env
  }
  return lufsFromStats({ ...stats, energy }, chs, sr, from, to)
}

/** A reference's integrated loudness (BS.1770), from its block stats: decoded before the plan compiles (loadRefs),
 *  its own edits derived when they allow, rendered when they don't (an EQ). */
function refLoudness(ref) {
  let src = ref.srcStats, st = ref.edits?.length ? src && audio.adaptStats(src, buildPlan(ref), ref.sampleRate) : src
  if (!st?.kcut1) {
    let s = audio.statSession(ref.sampleRate), n = ref.length
    for (let o = 0; o < n; o += 1 << 16) s.page(render(ref, o, Math.min(1 << 16, n - o)))
    st = s.done()
  }
  let v = st.energy?.length ? lufsFromStats(st, st.energy.length, ref.sampleRate) : null
  if (v == null) throw new RangeError('normalize: the reference is silent')
  return v
}

/** Target → { targetDb, mode }. Presets are integrated loudness; numbers take `mode`; a reference, its loudness. */
function parseTarget(target, mode) {
  if (target?.pages) {
    if (mode != null && mode !== 'lufs') throw new RangeError(`normalize: a reference is matched in loudness (lufs), not ${mode}`)
    return { targetDb: refLoudness(target), mode: 'lufs' }
  }
  if (typeof target === 'string') {
    target = FORMER[target] ?? target
    if (!Object.hasOwn(PRESETS, target)) throw new RangeError(`normalize: unknown preset '${target}' (${Object.keys(PRESETS).join(', ')}), or a number with mode peak|lufs|rms`)
    if (mode != null && mode !== 'lufs') throw new RangeError(`normalize: preset '${target}' is loudness (lufs), not ${mode}`)
    return { targetDb: PRESETS[target], mode: 'lufs' }
  }
  if (mode != null && !MODES.includes(mode)) throw new RangeError(`normalize: unknown mode '${mode}' (${MODES.join(', ')})`)
  return { targetDb: typeof target === 'number' ? target : 0, mode: mode || 'peak' }
}

// Normalizing sets one gain for the whole selection (Audacity, iZotope RX, FFmpeg loudnorm
// linear): on a live stream it waits for the end. `adaptive: true` starts at once, the gain
// following what it has heard so far, the ceiling guarding what it hasn't.
audio.op('normalize', {
  params: ['target', 'mode'],
  holdback: (o, sr, total) => o.adaptive ? 0 : total,
  process: (input, output) => { for (let c = 0; c < input.length; c++) output[c].set(input[c]) },
  resolve: (ctx) => {
    let { stats, sampleRate } = ctx
    if (!stats?.min) return null
    // Need minimum ~0.4s of blocks for stable LUFS gating
    if (!ctx.final) {
      let blocks = stats.min[0]?.length || 0
      let minBlocks = Math.ceil(0.4 * sampleRate / (stats.blockSize || 1024))
      if (blocks < minBlocks) return null
    }

    if (ctx.target?.pages && !ctx.target.decoded) return null  // a reference still decoding
    let { targetDb, mode } = parseTarget(ctx.target, ctx.mode)
    // Loudness targets hold a -1 dBTP true-peak ceiling by default (Apple Podcasts, Spotify,
    // EBU R 128, AES TD1008); `ceiling: false` turns it off, a number moves it. Adaptive gain
    // rises before it has heard the loudest part: the ceiling always guards it (the target
    // itself in peak mode)
    let ceiling = ctx.ceiling === false ? null : ctx.ceiling ?? (mode === 'lufs' ? -1 : ctx.adaptive ? (mode === 'peak' ? targetDb : -1) : null)

    let totalCh = stats.min.length
    let { chs } = resolveChannels(ctx.channel, totalCh)
    // a selection (at, duration) is measured alone, to the block (the whole timeline measured it, and a quiet
    // selection in a loud file got the file's gain)
    let bs = stats.blockSize || audio.BLOCK_SIZE, at = ctx.at == null ? 0 : ctx.at < 0 ? ctx.totalDuration + ctx.at : ctx.at
    let from = blockAt(at, sampleRate, bs), to = ctx.duration == null ? Infinity : blockAt(at + ctx.duration, sampleRate, bs, Math.ceil)

    let dcOff = new Float64Array(totalCh)
    if (ctx.dc !== false && stats.dc) dcOff = dcOffsets(stats, chs, from, to)
    let hasDc = chs.some(c => Math.abs(dcOff[c]) > 1e-10)

    let levelDb
    if (mode === 'lufs') levelDb = lufsDb(stats, chs, sampleRate, from, to)
    else if (mode === 'rms') levelDb = rmsDb(stats, chs, dcOff, from, to)
    else levelDb = peakDb(stats, chs, dcOff, from, to)

    if (levelDb == null) return false

    let edits = [], gain = ['gain', { value: targetDb - levelDb }]
    if (hasDc) edits.push(['dc', { shift: chs.map(c => dcOff[c]) }])
    edits.push(gain)
    if (ceiling == null) return edits.length === 1 ? edits[0] : edits

    // Limiting takes loudness off the peaks: made back up by secant steps (loudness rises slower than gain while the
    // limiter works), first on a block model of the limiter, then, once the whole signal is known, on measured renders,
    // to the target exactly. Adaptive gain stays on the model: it refines with the stats like the gain itself.
    // True peaks stay within ~3 dB of sample peaks: below that the limiter never engages.
    let g0 = gain[1].value, makeup = mode === 'lufs' && peakDb(stats, chs, dcOff, from, to) + g0 > ceiling - 3, slope = 1
    // Loudness only rises with gain, and limiting only takes it away: the answer lies between the
    // static gain and 12 dB of make-up over it. Each measure narrows that bracket; a secant step
    // that leaves it halves it instead (a slope carried from the model sent an 8 kHz take from
    // 37.8 dB to 16.9 dB of gain, and four renders ended 0.07 LU short). It lands when the loudness
    // prints as the target, to 0.01 as `check` judges it: a rule that switches at the target
    // (Spotify's -2 dBTP past -14 LUFS) then sees the target, not a hair over. Out of steps, it
    // keeps the loudest gain it measured under the target (the static gain, if none: limiting only
    // takes loudness away), never the step it had not measured (that one printed -13.98 on its way
    // to -14, and the check then asked for -2 dBTP).
    const step = (measure, n) => {
      let lo = g0, hi = g0 + 12, top = true, under = null   // top: hi is the cap, not a measure
      for (let k = 0, prev = null; k < n; k++) {
        let g = gain[1].value, got = measure(g)
        if (got == null) return
        if (printed(got) === printed(targetDb)) return
        let err = targetDb - got
        if (err > 0) { if (!under || got > under.got) under = { g, got }; if (g >= g0 + 12) return; lo = g } else { hi = g; top = false }
        if (prev) slope = Math.min(1, Math.max(0.05, (got - prev.got) / (g - prev.g)))
        prev = { got, g }
        let next = Math.min(g0 + 12, g + err / slope)
        if (!(next > lo && (next < hi || top && next === hi))) next = (lo + hi) / 2
        gain[1].value = next
      }
      gain[1].value = under ? under.g : g0
    }
    if (makeup) step(g => limitedLufs(stats, chs, sampleRate, g, ceiling, from, to), 8)

    // True-peak limiting, never clipping (AES TD1008 §5A: "When upward normalization would
    // cause clipping, peak limiting is required"), and only then: once the whole signal is known,
    // its true peaks, read once before the gain (peaksOf), say whether the static gain passes the
    // ceiling anywhere. Where not, the gain alone meets the target, nothing more rendered; where so,
    // every measured render and the output scale them, none reads them again. Made up, they hold
    // exactly MARGIN dB past the model's gain, as far as the measured steps go from it (a step
    // past that reads its own).
    let peaks = null, limit = ['ceiling', { limit: ceiling }]
    if (ctx.stream && !ctx.adaptive) {
      let r0 = ctx.at == null ? -Infinity : Math.round(at * sampleRate), r1 = ctx.duration == null ? Infinity : r0 + Math.round(ctx.duration * sampleRate)
      peaks = peaksOf(ctx.stream(hasDc ? edits[0] : ['gain', { value: 0 }]), chs, 10 ** ((ceiling - (makeup ? gain[1].value + MARGIN : g0)) / 20))
      if (peaks && !over(peaks, g0, ceiling, r0, r1)) { gain[1].value = g0; return edits.length === 1 ? edits[0] : edits }
      if (peaks) Object.assign(limit[1], { peaks, gain: gain[1].value })
    }
    edits.push(limit)
    if (makeup && ctx.measure && !ctx.adaptive) {
      step(g => { limit[1].gain = g; return lufsDb(ctx.measure(edits, ['energy']), chs, sampleRate, from, to) }, 6)
      limit[1].gain = gain[1].value
    }
    return edits
  }
})
