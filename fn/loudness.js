import audio from '../core.js'
import { kWeighting } from '@audio/weighting'

// ── LUFS measurement ─────────────────────────────────────────

const GATE_WINDOW = 0.4, GATE_HOP = 0.1, ABS_GATE = -70, REL_GATE = -10, LUFS_OFFSET = -0.691

/** Channel weights G_i by channel count, WAV/SMPTE order. ITU-R BS.1770-4 Table 3:
 *  L/R/C 1.0, Ls/Rs 1.41; the LFE channel is not measured (§1). 7.1 per Table 4:
 *  sides (60° ≤ |θ| ≤ 120°) 1.41, backs (|θ| > 120°) 1.0. Other counts: all 1.0. */
export function channelWeights(n) {
  if (n === 5) return [1, 1, 1, 1.41, 1.41]            // L R C Ls Rs
  if (n === 6) return [1, 1, 1, 0, 1.41, 1.41]         // L R C LFE Ls Rs
  if (n === 8) return [1, 1, 1, 0, 1, 1, 1.41, 1.41]   // L R C LFE Lb Rb Ls Rs
  return null
}

/**
 * Compute LUFS from block-level energy. Returns null if audio is silent.
 * ITU-R BS.1770-4 §2 eq.2: L_K = -0.691 + 10·log10(Σ_c G_c·z̄_c) — a SUM (not average) of
 * per-channel mean-square power, weighted per channelWeights (surround layouts by count).
 * §3: gating blocks are 400ms with 75% overlap (100ms hop), built over BLOCK_SIZE energy blocks.
 */
export function lufsFromEnergy(energy, chs, sampleRate, blockSize, from = 0, to, mask) {
  if (to == null) to = energy[0].length
  if (typeof chs === 'number') chs = Array.from({ length: chs }, (_, i) => i)
  let G = channelWeights(energy.length)
  let winBlocks = Math.round(GATE_WINDOW * sampleRate / blockSize)
  let hopBlocks = Math.max(1, Math.round(GATE_HOP * sampleRate / blockSize))
  let gates = []
  for (let i = from; i + winBlocks <= to; i += hopBlocks) {
    let we = i + winBlocks, sum = 0
    // mask (per block, e.g. speech activity): keep windows at least half covered
    if (mask) { let on = 0; for (let j = i; j < we; j++) on += mask[j]; if (on * 2 < winBlocks) continue }
    for (let c of chs) {
      let z = 0
      for (let j = i; j < we; j++) z += energy[c][j]
      sum += (G ? G[c] : 1) * z / winBlocks  // G_c·z̄_c: weighted per-channel mean square over this 400ms block
    }
    gates.push(sum)
  }
  let absT = 10 ** (ABS_GATE / 10), gated = gates.filter(g => g > absT)
  if (!gated.length) return null
  let mean = gated.reduce((a, b) => a + b, 0) / gated.length
  let final = gated.filter(g => g > mean * 10 ** (REL_GATE / 10))
  if (!final.length) return null
  return LUFS_OFFSET + 10 * Math.log10(final.reduce((a, b) => a + b, 0) / final.length)
}

// ── Measurement from stats (DC-aware, channel-scoped) ───────────

/** Per-channel DC offset from block stats. */
export function dcOffsets(stats, chs) {
  let off = new Float64Array(stats.dc.length)
  for (let c of chs) {
    let n = stats.dc[c].length
    if (!n) { off[c] = 0; continue }
    let sum = 0
    for (let i = 0; i < n; i++) sum += stats.dc[c][i]
    off[c] = sum / n
  }
  return off
}

/** Peak amplitude in dB after DC removal. Returns null if silent. */
export function peakDb(stats, chs, dcOff) {
  let peak = 0
  for (let c of chs) {
    let d = dcOff?.[c] || 0
    for (let i = 0; i < stats.min[c].length; i++)
      peak = Math.max(peak, Math.abs(stats.min[c][i] - d), Math.abs(stats.max[c][i] - d))
  }
  return peak ? 20 * Math.log10(peak) : null
}

/** RMS level in dB after DC removal. Returns null if silent/missing. */
export function rmsDb(stats, chs, dcOff) {
  if (!stats.ms) return null
  let totalE = 0, n = 0
  for (let c of chs) {
    let d = dcOff?.[c] || 0
    // E[x²] = E[(x-dc)²] + dc²  →  E[(x-dc)²] = E[x²] - dc²
    for (let i = 0; i < stats.ms[c].length; i++) { totalE += stats.ms[c][i] - d * d; n++ }
  }
  return n && totalE > 0 ? 10 * Math.log10(totalE / n) : null
}

/** LUFS loudness level. Returns null if silent. */
export function lufsDb(stats, chs, sampleRate) {
  return lufsFromEnergy(stats.energy, chs, sampleRate, stats.blockSize) ?? null
}

// ── Stats ────────────────────────────────────────────────────────

export let rMean = (values, from, to) => { let n = to - from; if (!n) return 0; let v = 0; for (let i = from; i < to; i++) v += values[i]; return v / n }

audio.stat('energy', {
  block: (chs, ctx) => {
    if (!ctx.k) ctx.k = chs.map(() => ({ fs: ctx.sampleRate }))
    return chs.map((ch, c) => {
      let k = new Float32Array(ch)
      kWeighting(k, ctx.k[c])
      let sum = 0
      for (let i = 0; i < k.length; i++) sum += k[i] * k[i]
      return sum / k.length
    })
  },
  reduce: rMean
})

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
  fields: ['energy'],
  query: (stats, chs, from, to, sr) => {
    let v = lufsFromEnergy(stats.energy, chs, sr, stats.blockSize, from, to)
    return v ?? -Infinity
  }
})

/** Maximum loudness of a sliding window (no gating), LUFS: EBU Tech 3341 momentary (400 ms)
 *  and short-term (3 s), updated every 100 ms; R 128 uses their maxima as descriptors. */
function maxWindow(win) {
  return (stats, chs, from, to, sr) => {
    let e = stats.energy, bs = stats.blockSize, G = channelWeights(e.length)
    let W = Math.max(1, Math.round(win * sr / bs)), H = Math.max(1, Math.round(GATE_HOP * sr / bs)), max = 0
    for (let i = from; i + W <= to; i += H) {
      let sum = 0
      for (let c of chs) { let z = 0; for (let j = i; j < i + W; j++) z += e[c][j]; sum += (G ? G[c] : 1) * z / W }
      if (sum > max) max = sum
    }
    return max > 0 ? LUFS_OFFSET + 10 * Math.log10(max) : -Infinity
  }
}
audio.stat('momentary', { fields: ['energy'], query: maxWindow(0.4) })
audio.stat('shortterm', { fields: ['energy'], query: maxWindow(3) })

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

/** Dialog loudness, LUFS: BS.1770 integrated loudness of the speech only (AES TD1008 "Speech
 *  Loudness" / Dialog Integrated Loudness; Netflix delivers dialog-gated at -27 LKFS). Streams:
 *  speech is found by @audio/vad (frame energy above the noise floor, tonal spectrum) over
 *  10 s windows; each 100 ms sub-block keeps its K-weighted power and speech share; gating
 *  windows (400 ms, 100 ms hop) at least half speech count. -Infinity when no speech is found. */
audio.stat('dialog', {})
audio.fn.dialog = async function(opts) {
  let { vad } = await import('@audio/vad')
  let sr = this.sampleRate, nch = this.channels, G = channelWeights(nch), SUB = Math.round(sr / 10), WIN = 100 * SUB
  let k = Array.from({ length: nch }, () => ({ fs: sr })), acc = gated()
  let mono = new Float32Array(WIN), fill = 0, zs = [], z = 0, zn = 0, tail = []  // tail: last 3 sub-blocks
  const window = () => {
    let { active, hop } = vad(mono.subarray(0, fill), { fs: sr, frameSize: 1024, hopSize: 512 })
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
