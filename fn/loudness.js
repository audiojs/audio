import audio, { resolveChannels, LOAD } from '../core.js'
import kWeighting from '@audio/weighting-k'
import { state, step } from '@audio/biquad'

// ── LUFS measurement ─────────────────────────────────────────

// ITU-R BS.1770-5 Annex 1: gating blocks of 400 ms "to the nearest sample" overlapping by 75%, so one starts every
// 100 ms (eq. 3); absolute gate -70 LKFS (eq. 6), relative gate 10 LU under the absolute-gated loudness (eq. 7);
// -0.691 cancels the K-weighting gain at 997 Hz (eq. 2, Note 1). EBU Tech 3341 §2.2: momentary 0.4 s, short-term 3 s.
const GATE_HOP = 0.1, ABS_GATE = -70, REL_GATE = -10, LUFS_OFFSET = -0.691, MOMENTARY = 4, SHORTTERM = 30

/** Samples in a 100 ms step: libebur128 rounds the same way, so windows are 4 (400 ms) and 30 (3 s) steps. */
export const stepOf = sr => Math.round(sr * GATE_HOP)

/** A level as reports print it and delivery checks judge it: to 0.01 (dB, LUFS, LU). `normalize` lands when its
 *  measured loudness prints as the target, so a check's rule that switches at the target sees the target. */
export const printed = v => Math.round(v * 100) / 100

/** Channel weights G_i by channel count, in the layouts `remix` reads (WAV/SMPTE order). ITU-R BS.1770-5 Table 3:
 *  L/R/C 1.0, Ls/Rs 1.41; the LFE channel is not measured (Annex 1). 7.1 per Table 4: sides (60° ≤ |θ| ≤ 120°)
 *  1.41, backs (|θ| > 120°) 1.0. Other counts: all 1.0. */
export function channelWeights(n) {
  if (n === 4) return [1, 1, 1.41, 1.41]               // L R Ls Rs
  if (n === 5) return [1, 1, 1, 1.41, 1.41]            // L R C Ls Rs
  if (n === 6) return [1, 1, 1, 0, 1.41, 1.41]         // L R C LFE Ls Rs
  if (n === 8) return [1, 1, 1, 0, 1, 1, 1.41, 1.41]   // L R C LFE Lb Rb Ls Rs
  return null
}

/** Weighted K-energy (Σ_c G_c·Σ y²) of each whole 100 ms step inside blocks [from, to), the steps counted from block 0.
 *  A block's energy splits where the grid cuts it by its `kcut1`, `kcut2` shares (see the `energy` stat); stats
 *  without them take each block's energy as spread evenly, an estimate. */
function steps(stats, chs, sr, from = 0, to) {
  let E = stats.energy, bs = stats.blockSize, H = stepOf(sr), k1 = stats.kcut1, k2 = stats.kcut2, nb = E[0].length
  let G = channelWeights(E.length), out = [], z = 0, open = false
  to = Math.min(to ?? nb, nb)
  const part = (b, a, e) => { let s = 0; for (let c of chs) s += (G ? G[c] : 1) * E[c][b] * bs * (e(c) - a(c)); return s }
  for (let b = from; b < to; b++) {
    let p = b * bs, c1 = (H - p % H) % H, len = b === nb - 1 && stats.length ? stats.length - p : bs
    if (!c1) { if (open) out.push(z); z = 0; open = true }       // a step starts with the block
    let first = c1 || H, n = first < len ? Math.floor((len - 1 - first) / H) + 1 : 0   // cuts inside the block
    if (!n) { if (open) z += part(b, () => 0, () => len / bs); continue }
    let at1 = k1 ? c => k1[c][b] : () => first / bs, at2 = k2 ? c => k2[c][b] : () => (first + (n - 1) * H) / bs
    if (open) out.push(z + part(b, () => 0, at1))
    // steps whole inside the block (two cuts from 5120 Hz on; below, the middle ones split its energy evenly)
    for (let i = 1; i < n; i++) out.push(part(b, c => at1(c) + (at2(c) - at1(c)) * (i - 1) / (n - 1), c => at1(c) + (at2(c) - at1(c)) * i / (n - 1)))
    z = part(b, at2, () => len / bs); open = true
  }
  // a step ending with the last block ends on the grid: whole
  if (open && Math.min(to * bs, stats.length || Infinity) % H === 0) out.push(z)
  return out
}

/** Gated loudness of 100 ms step energies (BS.1770-5 eq. 3-7): 400 ms blocks every step, the incomplete one at the
 *  end unused. Null when every block is gated out. */
function gate(z, H) {
  let n = z.length - MOMENTARY + 1, absT = 10 ** ((ABS_GATE - LUFS_OFFSET) / 10), P = new Float64Array(Math.max(0, n)), sum = 0, cnt = 0
  for (let j = 0; j < n; j++) {
    let s = 0
    for (let i = j; i < j + MOMENTARY; i++) s += z[i]
    if ((P[j] = s / (MOMENTARY * H)) > absT) { sum += P[j]; cnt++ }
  }
  if (!cnt) return null
  let relT = sum / cnt * 10 ** (REL_GATE / 10)
  sum = cnt = 0
  for (let p of P) if (p > absT && p > relT) { sum += p; cnt++ }
  return cnt ? LUFS_OFFSET + 10 * Math.log10(sum / cnt) : null
}

/** Integrated loudness (LUFS) of block stats, blocks [from, to): BS.1770-5 over the 100 ms grid from block 0, exact
 *  with the `energy` stat's cut shares; a range measures the whole steps inside it. Null if silent or all gated. */
export function lufsFromStats(stats, chs, sampleRate, from = 0, to) {
  if (typeof chs === 'number') chs = Array.from({ length: chs }, (_, i) => i)
  return gate(steps(stats, chs, sampleRate, from, to), stepOf(sampleRate))
}

/** Integrated loudness from block energies alone: each block's energy spread evenly over it, an estimate. */
export function lufsFromEnergy(energy, chs, sampleRate, blockSize, from = 0, to) {
  return lufsFromStats({ energy, blockSize }, chs, sampleRate, from, to)
}

// ── Measurement from stats (DC-aware, channel-scoped) ───────────

/** Mean of a per-block mean (dc, ms) over blocks [from, to), each block weighed by its samples: the last block of the
 *  stats can be short (`length`). */
export function blockMean(values, stats, from = 0, to = values.length) {
  let bs = stats.blockSize, last = values.length - 1, sum = 0, n = 0
  for (let i = from, e = Math.min(to, values.length); i < e; i++) { let w = i === last && stats.length ? stats.length - i * bs : bs; sum += values[i] * w; n += w }
  return n ? sum / n : 0
}

/** Per-channel DC offset from block stats, blocks [from, to). */
export function dcOffsets(stats, chs, from, to) {
  let off = new Float64Array(stats.dc.length)
  for (let c of chs) off[c] = blockMean(stats.dc[c], stats, from, to)
  return off
}

/** Peak amplitude in dB after DC removal, blocks [from, to). Returns null if silent. */
export function peakDb(stats, chs, dcOff, from = 0, to = Infinity) {
  let peak = 0
  for (let c of chs) {
    let d = dcOff?.[c] || 0
    for (let i = from, e = Math.min(to, stats.min[c].length); i < e; i++)
      peak = Math.max(peak, Math.abs(stats.min[c][i] - d), Math.abs(stats.max[c][i] - d))
  }
  return peak ? 20 * Math.log10(peak) : null
}

/** RMS level in dB after DC removal, blocks [from, to). Returns null if silent/missing. */
export function rmsDb(stats, chs, dcOff, from, to) {
  if (!stats.ms) return null
  let totalE = 0
  // E[x²] = E[(x-dc)²] + dc²  →  E[(x-dc)²] = E[x²] - dc²
  for (let c of chs) { let d = dcOff?.[c] || 0; totalE += blockMean(stats.ms[c], stats, from, to) - d * d }
  return chs.length && totalE > 0 ? 10 * Math.log10(totalE / chs.length) : null
}

/** LUFS loudness level, blocks [from, to). Returns null if silent. */
export function lufsDb(stats, chs, sampleRate, from, to) {
  return lufsFromStats(stats, chs, sampleRate, from, to)
}

// ── Stats ────────────────────────────────────────────────────────

export let rMean = (values, from, to, stats) => blockMean(values, stats, from, to)

/** K-weighted mean square of each channel's block (BS.1770-5 eq. 1), and where the 100 ms grid of the gating blocks
 *  cuts it, the grid counted from the start of the stats: `kcut1`, `kcut2`, the block's energy before its first and
 *  before its last cut, over its mean square times the block size (for a whole block, its share). With them the
 *  gating blocks sum exactly from block stats at 5120 Hz and up (two cuts a block at most); a gain scales the mean
 *  square and leaves them. They hold only where blocks move by whole steps (`period`). */
function kblock(chs, ctx) {
  let k = ctx.k ??= { fs: ctx.sampleRate }, H = stepOf(ctx.sampleRate), n = chs[0].length, nch = chs.length
  let p = ctx.pos ?? 0, first = (H - p % H) % H || H, last = first + Math.floor((n - 1 - first) / H) * H
  ctx.pos = p + n
  let energy = new Float64Array(nch), kcut1 = new Float64Array(nch), kcut2 = new Float64Array(nch)
  if (first >= n) return { energy: kWeighting.ms(chs, k, energy), kcut1, kcut2 }
  let at = 0, part = new Float64Array(nch)
  const run = to => {
    if (to > at) { kWeighting.ms(chs.map(x => x.subarray(at, to)), k, part); for (let c = 0; c < nch; c++) energy[c] += part[c] * (to - at) }
    at = to
  }
  run(first); kcut1.set(energy)
  run(last); kcut2.set(energy)
  run(n)
  for (let c = 0; c < nch; c++) {
    let u = energy[c] * audio.BLOCK_SIZE / n
    kcut1[c] = u > 0 ? kcut1[c] / u : 0; kcut2[c] = u > 0 ? kcut2[c] / u : 0
    energy[c] /= n
  }
  return { energy, kcut1, kcut2 }
}

audio.stat('energy', { block: kblock, reduce: rMean, extra: ['kcut1', 'kcut2'], period: stepOf })

audio.stat('db', {
  fields: ['min', 'max'],
  query: (stats, chs, from, to) => {
    let peak = 0
    for (let c of chs)
      for (let i = from; i < Math.min(to, stats.min[c].length); i++)
        peak = Math.max(peak, Math.abs(stats.min[c][i]), Math.abs(stats.max[c][i]))
    return peak > 0 ? 20 * Math.log10(peak) : -Infinity
  }
})

audio.stat('loudness', {
  fields: ['energy', 'kcut1', 'kcut2'],
  query: (stats, chs, from, to, sr) => lufsFromStats(stats, chs, sr, from, to) ?? -Infinity
})

/** Maximum loudness of a window of `steps` 100 ms steps, not gated, LUFS: EBU Tech 3341 §2.2 momentary (400 ms) and
 *  short-term (3 s); R 128 (o) takes their maxima as descriptors. Streams the rendered signal and slides the window
 *  sample by sample: a file-based meter must find a tone wherever it lies (Tech 3341 Table 1, cases 10 and 13).
 *  -Infinity under one window. */
function maxWindow(steps) {
  return async function(opts) {
    let sr = this.sampleRate, nch = this.channels, W = steps * stepOf(sr), G = channelWeights(nch)
    let { chs, perCh } = resolveChannels(opts?.channel, nch), sets = perCh ? chs.map(c => [c]) : [chs]
    let [shelf, rlb] = kWeighting.coefs(sr), st = Array.from({ length: nch }, () => [state(), state()])
    let ring = sets.map(() => new Float64Array(W)), sum = sets.map(() => 0), max = sets.map(() => 0), y = new Float64Array(nch), n = 0
    for await (let chunk of this.stream({ at: opts?.at, duration: opts?.duration })) {
      for (let i = 0, len = chunk[0].length; i < len; i++, n++) {
        for (let c of chs) { let v = step(rlb, st[c][1], step(shelf, st[c][0], chunk[c][i])); y[c] = (G ? G[c] : 1) * v * v }
        let j = n % W
        for (let s = 0; s < sets.length; s++) {
          let p = 0, r = ring[s]
          for (let c of sets[s]) p += y[c]
          sum[s] += p - r[j]; r[j] = p
          // re-add the window once per window length: running sums drift
          if (j === W - 1) { let e = 0; for (let q = 0; q < W; q++) e += r[q]; sum[s] = e }
          if (n >= W - 1 && sum[s] > max[s]) max[s] = sum[s]
        }
      }
    }
    let out = max.map(m => m > 0 ? LUFS_OFFSET + 10 * Math.log10(m / W) : -Infinity)
    return perCh ? out : out[0]
  }
}
audio.stat('momentary', {})
audio.fn.momentary = maxWindow(MOMENTARY)
audio.stat('shortterm', {})
audio.fn.shortterm = maxWindow(SHORTTERM)

/** Integrated loudness in bounded memory: gating-window powers binned at 0.01 LU (the
 *  histogram of libebur128), so the relative gate needs no history. ITU-R BS.1770-4 §5. */
function gated() {
  const LO = ABS_GATE, STEP = 0.01, BINS = 9000
  let count = new Float64Array(BINS), sum = new Float64Array(BINS), n = 0, total = 0
  return {
    add(z) {
      let l = LUFS_OFFSET + 10 * Math.log10(z)
      if (!(l > ABS_GATE)) return
      let i = Math.min(BINS - 1, Math.floor((l - LO) / STEP))
      count[i]++; sum[i] += z; n++; total += z
    },
    value() {
      if (!n) return null
      let rel = LUFS_OFFSET + 10 * Math.log10(total / n) + REL_GATE, c = 0, z = 0
      for (let i = Math.max(0, Math.floor((rel - LO) / STEP)); i < BINS; i++) { c += count[i]; z += sum[i] }
      return c ? LUFS_OFFSET + 10 * Math.log10(z / c) : null
    },
  }
}

/** Noise floor, dB: RMS of the quietest 0.4 s, windows every 0.1 s, full windows only, the
 *  channels' mean squares averaged: ACX Check 2.4.2-1 (Steve Daulton) `getfloor`, sample-exact.
 *  Blocks can't stand in: 5 ms of a word inside a 0.4 s pause outweighs its room tone. Streams;
 *  under 0.4 s the whole signal is the one window. */
audio.stat('noisefloor', {})
audio.fn.noisefloor = async function(opts) {
  // its rate known first: a file just opened has none until its header is read
  await this[LOAD]()
  let sr = this.sampleRate, W = Math.round(0.4 * sr), H = Math.round(sr / 10)
  let ring = new Float64Array(W), n = 0, min = Infinity
  for await (let chunk of this.stream({ at: opts?.at, duration: opts?.duration })) {
    let nch = chunk.length, len = chunk[0].length
    for (let i = 0; i < len; i++, n++) {
      let s = 0
      for (let c = 0; c < nch; c++) s += chunk[c][i] * chunk[c][i]
      ring[n % W] = s / nch
      if (n + 1 >= W && (n + 1 - W) % H === 0) {
        let z = 0
        for (let j = 0; j < W; j++) z += ring[j]
        if (z < min) min = z
      }
    }
  }
  if (n < W) { min = 0; for (let j = 0; j < n; j++) min += ring[j]; min *= W / (n || 1) }
  return min > 0 ? 10 * Math.log10(min / W) : -Infinity
}

/** Dialog loudness, LUFS: BS.1770 integrated loudness of the speech only (AES TD1008 "Speech
 *  Loudness" / Dialog Integrated Loudness; Netflix delivers dialog-gated at -27 LKFS). Streams:
 *  speech is found by @audio/vad (sound over a tracked noise floor, grown from voicing) over
 *  10 s windows; each 100 ms sub-block keeps its K-weighted power and speech share; gating
 *  windows (400 ms, 100 ms hop) at least half speech count. -Infinity when no speech is found. */
audio.stat('dialog', {})
audio.fn.dialog = async function(opts) {
  await this[LOAD]()
  let { vad } = await import('@audio/vad')
  let sr = this.sampleRate, nch = this.channels, G = channelWeights(nch), SUB = Math.round(sr / 10), WIN = 100 * SUB
  let k = Array.from({ length: nch }, () => ({ fs: sr })), acc = gated()
  let mono = new Float32Array(WIN), fill = 0, zs = [], z = 0, zn = 0, tail = []  // tail: last 3 sub-blocks
  const window = () => {
    let { active, hop } = vad(mono.subarray(0, fill), { fs: sr })
    let subs = zs.map((z, j) => {
      let a0 = Math.floor(j * SUB / hop), a1 = Math.min(active.length, Math.ceil((j + 1) * SUB / hop)), on = 0
      for (let a = a0; a < a1; a++) on += active[a]
      return { z, s: a1 > a0 ? on / (a1 - a0) : 0 }
    })
    for (let b of subs) {
      tail.push(b)
      if (tail.length > 4) tail.shift()
      if (tail.length === 4 && tail.reduce((s, t) => s + t.s, 0) >= 2) acc.add(tail.reduce((s, t) => s + t.z, 0) / 4)
    }
    fill = 0; zs = []
  }
  for await (let chunk of this.stream({ at: opts?.at, duration: opts?.duration })) {
    let n = chunk[0].length, w = chunk.map((ch, c) => { let x = Float32Array.from(ch); kWeighting(x, k[c]); return x })
    for (let i = 0; i < n; i++) {
      let m = 0
      for (let c = 0; c < nch; c++) { z += (G ? G[c] : 1) * w[c][i] * w[c][i]; m += chunk[c][i] / nch }
      mono[fill++] = m
      if (++zn === SUB) { zs.push(z / SUB); z = zn = 0 }
      if (fill === WIN) window()
    }
  }
  if (zs.length) window()
  return acc.value() ?? -Infinity
}
