import { dcOffsets, peakDb, rmsDb, lufsDb, lufsFromEnergy } from './loudness.js'
import audio, { resolveChannels } from '../core.js'

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
        stats.clipping[c][i] = (stats.min[c][i] <= -1 || stats.max[c][i] >= 1) ? Math.max(1, stats.clipping[c][i]) : 0
    }
    // energy: k-weighting high-passes, DC offset has no effect
  }
})

// ── True-peak ceiling ────────────────────────────────────────────────────
// 4× reconstruction per ITU-R BS.1770-4 Annex 2. The Annex's 48-tap example filter
// under-reads content near Nyquist (−0.9 dB on full-band noise, worse at 44.1 kHz where
// its passband scales down), so the detector uses the 32-tap Lanczos kernel of
// @audio/loudness-truepeak at the same 4× points: the ceiling holds what `stat truepeak`
// reads. With the newest input at n, phases ¼ ½ ¾ land inside the interval (n−16, n−15).
const HALF = 16, TAPS = 2 * HALF, MID = HALF, LOOK = 0.005, RELEASE = 0.1
const sinc = x => x === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x)
const TPF = [0.25, 0.5, 0.75].map(f => {
  let h = new Float64Array(TAPS), w = 0            // h[j] weighs x[n − j]
  for (let j = 0; j < TAPS; j++) { let x = HALF - j - f; w += h[j] = sinc(x) * sinc(x / HALF) }
  return h.map(v => v / w)
})
// |y_p| ≤ S·max|x| over the taps: below lim/S no phase can exceed lim, so the FIR is skipped
const S = Math.max(...TPF.map(h => h.reduce((s, v) => s + Math.abs(v), 0)))

/** Channel-linked lookahead limiter holding the reconstructed (true) peak at `limit` dBTP.
 *  Required gain g[m] covers the samples and 4× interpolants on both sides of m; a sliding
 *  minimum over the lookahead window, then its moving average, gives a smooth gain that
 *  provably stays ≤ g at every output sample (each averaged minimum spans that sample);
 *  release only ever pulls the gain further down. Output is delayed MID + lookahead. */
function ceiling(input, output, ctx) {
  let nch = input.length, len = input[0].length, sr = ctx.sampleRate
  let st = ctx._tp
  if (!st) {
    let L = Math.round(LOOK * sr), W = L + 1, D = MID + L
    st = ctx._tp = {
      L, W, D, n: 0, hot: -1, rPrev: 1, env: 1, sum: W, ai: 0, qh: 0, qt: 0, di: 0,
      avg: new Float64Array(W).fill(1), qv: new Float64Array(W), qn: new Float64Array(W),
      ext: Array.from({ length: nch }, () => new Float32Array(TAPS - 1 + len)),
      dl: Array.from({ length: nch }, () => new Float32Array(D)),
      rel: 1 - Math.exp(-1 / (RELEASE * sr)),
    }
  }
  let { L, W, D, avg, qv, qn, dl, rel } = st
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
      if (n <= st.hot) for (let p = 0; p < TPF.length; p++) {
        let h = TPF[p], y = 0
        for (let k = 0; k < TAPS; k++) y += h[k] * e[i + TAPS - 1 - k]
        if (y < 0) y = -y
        if (y > pk) pk = y
      }
    }
    let r = pk > lim && m >= r0 && m < r1 ? lim / pk : 1
    let g = r < st.rPrev ? r : st.rPrev
    st.rPrev = r
    // sliding minimum of g over [m − L, m] (monotonic deque, capacity W)
    while (st.qt > st.qh && qv[(st.qt - 1) % W] >= g) st.qt--
    qv[st.qt % W] = g; qn[st.qt % W] = m; st.qt++
    if (qn[st.qh % W] < m - L) st.qh++
    let mn = qv[st.qh % W]
    // its moving average over the same span → the gain for output sample m − L
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
  latency: (o, sr) => MID + Math.round(LOOK * sr),
  process: ceiling,
})

/** Loudness after `gain` dB and the ceiling, from block stats: a block model of the limiter,
 *  each block at the gain its sample peak needs (channel-linked), held down by the release
 *  across later blocks, energy scaled by gain². Blocks don't carry how peaks fall inside them,
 *  so against rendered output it errs by the material: within 0.01 LU while limiting takes
 *  < 0.2 LU, up to ±0.2 LU at 2 LU and ±0.5 LU at 5–9 LU of limiting (speech high, dense music low). */
function limitedLufs(stats, chs, sr, gainDb, ceilDb) {
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
  return lufsFromEnergy(energy, chs, sr, bs)
}

/** Target → { targetDb, mode }. Presets are integrated loudness; numbers take `mode`. */
function parseTarget(target, mode) {
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

    let { targetDb, mode } = parseTarget(ctx.target, ctx.mode)
    // Loudness targets hold a -1 dBTP true-peak ceiling by default (Apple Podcasts, Spotify,
    // EBU R 128, AES TD1008); `ceiling: false` turns it off, a number moves it. Adaptive gain
    // rises before it has heard the loudest part: the ceiling always guards it (the target
    // itself in peak mode)
    let ceiling = ctx.ceiling === false ? null : ctx.ceiling ?? (mode === 'lufs' ? -1 : ctx.adaptive ? (mode === 'peak' ? targetDb : -1) : null)

    let totalCh = stats.min.length
    let { chs } = resolveChannels(ctx.channel, totalCh)

    let dcOff = new Float64Array(totalCh)
    if (ctx.dc !== false && stats.dc) dcOff = dcOffsets(stats, chs)
    let hasDc = chs.some(c => Math.abs(dcOff[c]) > 1e-10)

    let levelDb
    if (mode === 'lufs') levelDb = lufsDb(stats, chs, sampleRate)
    else if (mode === 'rms') levelDb = rmsDb(stats, chs, dcOff)
    else levelDb = peakDb(stats, chs, dcOff)

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
    if (mode === 'lufs' && peakDb(stats, chs, dcOff) + gain[1].value > ceiling - 3) {
      let g0 = gain[1].value, slope = 1
      const step = (measure, n) => {
        for (let k = 0, prev = null; k < n; k++) {
          let got = measure(gain[1].value)
          if (got == null) return
          let err = targetDb - got
          if (Math.abs(err) < 0.005) return
          if (prev) slope = Math.min(1, Math.max(0.05, (got - prev.got) / (gain[1].value - prev.g)))
          prev = { got, g: gain[1].value }
          let next = Math.min(g0 + 12, gain[1].value + err / slope)
          if (next === gain[1].value) return
          gain[1].value = next
        }
      }
      step(g => limitedLufs(stats, chs, sampleRate, g, ceiling), 8)
      if (ctx.measure && !ctx.adaptive) step(() => lufsDb(ctx.measure(edits), chs, sampleRate), 4)
    }
    return edits
  }
})
