import { dcOffsets, peakDb, rmsDb, lufsDb, lufsFromStats, printed } from './loudness.js'
import audio, { resolveChannels, FULL } from '../core.js'
import { buildPlan, render } from '../plan.js'

// Integrated-loudness presets (LUFS): Spotify/YouTube, Apple Podcasts, EBU R 128
const PRESETS = { streaming: -14, podcast: -16, broadcast: -23 }
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
const TPF = [0.25, 0.5, 0.75].map(f => {
  let h = new Float64Array(TAPS), w = 0            // h[j] weighs x[n − j]
  for (let j = 0; j < TAPS; j++) { let x = HALF - j - f; w += h[j] = sinc(x) * i0(BETA * Math.sqrt(1 - (x / HALF) ** 2)) / i0(BETA) }
  return h.map(v => v / w)
})
// |y_p| ≤ S·max|x| over the taps, and a parabola's vertex ≤ 9/8 of its peak point: below
// lim/(9/8·S) no estimate can exceed lim, so the FIR is skipped
const S = 9 / 8 * Math.max(...TPF.map(h => h.reduce((s, v) => s + Math.abs(v), 0)))
/** Vertex of the parabola through equally spaced l, m, r when m is their maximum, else m. */
const vertex = (l, m, r) => { let c = 2 * m - l - r; return m >= l && m >= r && c > 0 ? m + (l - r) * (l - r) / (8 * c) : m }

/** Channel-linked lookahead limiter holding the reconstructed (true) peak at `limit` dBTP.
 *  Required gain g[m] covers the samples and 4× interpolants on both sides of m; a sliding
 *  minimum over the lookahead window widened by the kernel's reach (HALF) each side, then its
 *  moving average, gives a smooth gain that provably stays ≤ g at every output sample and holds
 *  flat at it over the HALF samples each side of m: an interpolant reads its taps at one gain.
 *  (Unwidened, the attack ramp crossed the kernel: 8 kHz speech limited 20 dB came out at
 *  -0.91 dBTP under a -1 ceiling.) Release only ever pulls the gain further down. Output is
 *  delayed MID + lookahead + HALF. */
function ceiling(input, output, ctx) {
  let nch = input.length, len = input[0].length, sr = ctx.sampleRate
  let st = ctx._tp
  if (!st) {
    let L = Math.round(LOOK * sr), W = L + 1, Q = W + 2 * HALF, D = MID + L + HALF
    st = ctx._tp = {
      L, W, Q, D, n: 0, hot: -1, rPrev: 1, env: 1, sum: W, ai: 0, qh: 0, qt: 0, di: 0,
      avg: new Float64Array(W).fill(1), qv: new Float64Array(Q), qn: new Float64Array(Q),
      ext: Array.from({ length: nch }, () => new Float32Array(TAPS - 1 + len)),
      dl: Array.from({ length: nch }, () => new Float32Array(D)),
      last: new Float64Array(nch),   // each channel's |point| before x[m], the ¾ one of the interval before
      rel: 1 - Math.exp(-1 / (RELEASE * sr)),
    }
  }
  let { L, W, Q, D, avg, qv, qn, dl, rel, last } = st
  if (st.ext[0].length < TAPS - 1 + len) st.ext = st.ext.map(e => { let b = new Float32Array(TAPS - 1 + len); b.set(e.subarray(0, TAPS - 1)); return b })
  let ext = st.ext
  for (let c = 0; c < nch; c++) ext[c].set(input[c], TAPS - 1)
  let lim = 10 ** ((ctx.limit ?? -1) / 20), cold = lim / S
  // range gating in absolute input samples (ranged op: ctx.at is block-relative)
  let base = Math.round((ctx.blockOffset || 0) * sr)
  let r0 = ctx.at != null ? base + Math.round(ctx.at * sr) : -Infinity
  let r1 = ctx.duration != null ? r0 + Math.round(ctx.duration * sr) : Infinity

  for (let i = 0; i < len; i++) {
    let n = st.n, m = n - MID, pk = 0
    for (let c = 0; c < nch; c++) {
      let e = ext[c], x = e[i + TAPS - 1]
      if ((x < 0 ? -x : x) > cold) st.hot = n + TAPS
      let a = e[i + TAPS - 1 - MID], b = e[i + TAPS - MID]   // x[n − MID], x[n − MID + 1]
      a = a < 0 ? -a : a; b = b < 0 ? -b : b
      if (a > pk) pk = a
      if (b > pk) pk = b
      if (n > st.hot) { last[c] = 0; continue }
      // the points a, ¼, ½, ¾, b in time order, each local maximum refined by its parabola
      let l = last[c], q = a
      for (let p = 0; p < TPF.length; p++) {
        // four running sums: independent adds pipeline
        let h = TPF[p], o = i + TAPS - 1, y0 = 0, y1 = 0, y2 = 0, y3 = 0
        for (let k = 0; k < TAPS; k += 4) { y0 += h[k] * e[o - k]; y1 += h[k + 1] * e[o - k - 1]; y2 += h[k + 2] * e[o - k - 2]; y3 += h[k + 3] * e[o - k - 3] }
        let y = y0 + y1 + y2 + y3
        if (y < 0) y = -y
        let v = vertex(l, q, y)
        if (v > pk) pk = v
        l = q; q = y
      }
      let v = vertex(l, q, b)
      if (v > pk) pk = v
      last[c] = q
    }
    let r = pk > lim && m >= r0 && m < r1 ? lim / pk : 1
    let g = r < st.rPrev ? r : st.rPrev
    st.rPrev = r
    // sliding minimum of g over [m − L − 2·HALF, m] (monotonic deque, capacity Q)
    while (st.qt > st.qh && qv[(st.qt - 1) % Q] >= g) st.qt--
    qv[st.qt % Q] = g; qn[st.qt % Q] = m; st.qt++
    if (qn[st.qh % Q] < m - L - 2 * HALF) st.qh++
    let mn = qv[st.qh % Q]
    // its moving average over [m − L, m] → the gain for output sample m − L − HALF
    st.sum += mn - avg[st.ai]; avg[st.ai] = mn; st.ai = (st.ai + 1) % W
    let G = st.sum / W
    st.env = G < st.env ? G : st.env + (G - st.env) * rel
    let gain = st.env, di = st.di
    for (let c = 0; c < nch; c++) { let d = dl[c]; output[c][i] = d[di] * gain; d[di] = ext[c][i + TAPS - 1] }
    st.di = (di + 1) % D
    st.n++
  }
  for (let c = 0; c < nch; c++) ext[c].copyWithin(0, len, len + TAPS - 1)
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
  let st = ref.edits?.length ? audio.adaptStats(ref._.srcStats ?? ref.stats, buildPlan(ref), ref.sampleRate) : ref.stats
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
    if (!(target in PRESETS)) throw new RangeError(`normalize: unknown preset '${target}' (${Object.keys(PRESETS).join(', ')}), or a number with mode peak|lufs|rms`)
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
    let from = Math.floor(at * sampleRate / bs), to = ctx.duration == null ? Infinity : Math.ceil((at + ctx.duration) * sampleRate / bs)

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

    // True-peak limiting, never clipping (AES TD1008 §5A: "When upward normalization would
    // cause clipping, peak limiting is required")
    edits.push(['ceiling', { limit: ceiling }])
    // Limiting takes loudness off the peaks: make it back up by secant steps (loudness rises
    // slower than gain while the limiter works), first on a block model of the limiter, then,
    // once the whole signal is known, on measured renders, to the target exactly. Adaptive gain
    // stays on the model: it refines with the stats like the gain itself.
    // True peaks stay within ~3 dB of sample peaks: below that the limiter never engages.
    if (mode === 'lufs' && peakDb(stats, chs, dcOff, from, to) + gain[1].value > ceiling - 3) {
      // Loudness only rises with gain, and limiting only takes it away: the answer lies between the
      // static gain and 12 dB of make-up over it. Each measure narrows that bracket; a secant step
      // that leaves it halves it instead (a slope carried from the model sent an 8 kHz take from
      // 37.8 dB to 16.9 dB of gain, and four renders ended 0.07 LU short). It lands when the loudness
      // prints as the target, to 0.01 as `check` judges it: a rule that switches at the target
      // (Spotify's -2 dBTP past -14 LUFS) then sees the target, not a hair over. Out of steps, it
      // keeps the loudest gain it measured under the target (the static gain, if none: limiting only
      // takes loudness away), never the step it had not measured (that one printed -13.98 on its way
      // to -14, and the check then asked for -2 dBTP).
      let g0 = gain[1].value, slope = 1
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
      step(g => limitedLufs(stats, chs, sampleRate, g, ceiling, from, to), 8)
      if (ctx.measure && !ctx.adaptive) step(() => lufsDb(ctx.measure(edits), chs, sampleRate, from, to), 6)
    }
    return edits
  }
})
