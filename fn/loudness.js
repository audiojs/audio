import audio from '../core.js'
import kWeighting from 'audio-filter/weighting/k-weighting.js'

// ── LUFS measurement ─────────────────────────────────────────

const GATE_WINDOW = 0.4, ABS_GATE = -70, REL_GATE = -10, LUFS_OFFSET = -0.691

/** Compute LUFS from block-level energy. Returns null if audio is silent. */
export function lufsFromEnergy(energy, chs, sampleRate, blockSize, from = 0, to) {
  if (to == null) to = energy[0].length
  if (typeof chs === 'number') chs = Array.from({ length: chs }, (_, i) => i)
  let winBlocks = Math.ceil(GATE_WINDOW * sampleRate / blockSize), gates = []
  for (let i = from; i < to; i += winBlocks) {
    let we = Math.min(i + winBlocks, to), sum = 0, n = 0
    for (let c of chs) for (let j = i; j < we; j++) { sum += energy[c][j]; n++ }
    if (n > 0) gates.push(sum / n)
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
  if (!stats.rms) return null
  let totalE = 0, n = 0
  for (let c of chs) {
    let d = dcOff?.[c] || 0
    // E[x²] = E[(x-dc)²] + dc²  →  E[(x-dc)²] = E[x²] - dc²
    for (let i = 0; i < stats.rms[c].length; i++) { totalE += stats.rms[c][i] - d * d; n++ }
  }
  return n && totalE > 0 ? 10 * Math.log10(totalE / n) : null
}

/** LUFS loudness level. Returns null if silent. */
export function lufsDb(stats, chs, sampleRate) {
  return lufsFromEnergy(stats.energy, chs, sampleRate, stats.blockSize) ?? null
}

// ── Stats ────────────────────────────────────────────────────────

let rMean = (src, from, to) => { let n = to - from; if (!n) return 0; let v = 0; for (let i = from; i < to; i++) v += src[i]; return v / n }

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
  query: (stats, chs, from, to) => {
    let peak = 0
    for (let c of chs)
      for (let i = from; i < Math.min(to, stats.min[c].length); i++)
        peak = Math.max(peak, Math.abs(stats.min[c][i]), Math.abs(stats.max[c][i]))
    return peak > 0 ? 20 * Math.log10(peak) : -Infinity
  }
})

audio.stat('loudness', {
  query: (stats, chs, from, to, sr) => {
    let v = lufsFromEnergy(stats.energy, chs, sr, stats.blockSize, from, to)
    return v ?? -Infinity
  }
})
