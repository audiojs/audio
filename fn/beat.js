/**
 * Beat detection — tempo, beat grid, onsets.
 *
 * a.stat('bpm', opts)     → number (BPM) — instant, from existing energy blocks
 * a.stat('beats', opts)   → Float64Array of beat timestamps (seconds)
 * a.stat('onsets', opts)  → Float64Array of onset timestamps (seconds)
 * a.detect(opts)          → { bpm, confidence, beats, onsets } — high-fidelity via spectral flux
 *
 * stat opts: { at, duration, minBpm, maxBpm, delta, channel }
 * detect opts: + { frameSize, hopSize }
 *
 * The stat variants derive BPM from the energy block stat already computed during decode —
 * no second stream. detect() streams raw audio through spectral flux for higher precision.
 */

import { combTempo, peakPick, detect } from 'beat-detection'
import audio from '../core.js'

// ── Energy ODF from block stats ──────────────────────────────────

/** Build energy-flux ODF from existing energy block stat. Returns null if silent. */
function energyOdf(stats, from, to, sr) {
  let energy = stats.energy
  if (!energy?.length) return null
  let n = to - from, ch = energy.length

  // Average channels to mono energy envelope
  let en = new Float64Array(n)
  for (let c = 0; c < ch; c++)
    for (let i = 0; i < n; i++) en[i] += energy[c][from + i]
  if (ch > 1) for (let i = 0; i < n; i++) en[i] /= ch

  // Positive first differences = energy flux ODF
  let odf = new Float64Array(n)
  for (let i = 1; i < n; i++) { let d = en[i] - en[i - 1]; if (d > 0) odf[i] = d }

  let any = false
  for (let i = 0; i < n; i++) if (odf[i] > 0) { any = true; break }
  if (!any) return null

  return { odf, nFrames: n, hopSize: stats.blockSize, fs: sr }
}

/** Phase-align beat grid with detected onsets. */
function beatGrid(bpm, onsets, blockCount, blockSize, sr) {
  let duration = blockCount * blockSize / sr
  let iv = 60 / bpm
  let bestPhase = 0, bestScore = -Infinity
  for (let p = 0; p < 20; p++) {
    let phase = (p / 20) * iv, score = 0
    for (let o of onsets) {
      let d = ((o - phase) % iv + iv) % iv
      score -= d < iv / 2 ? d : iv - d
    }
    if (score > bestScore) { bestScore = score; bestPhase = phase }
  }
  let beats = []
  for (let t = bestPhase; t < duration; t += iv) beats.push(t)
  if (beats.length && beats[0] > iv * 0.25) beats.unshift(Math.max(0, beats[0] - iv))
  return new Float64Array(beats)
}

// ── Stat descriptors (instant — read from existing energy blocks) ─

audio.stat('bpm', {
  query: (stats, chs, from, to, sr, opts) => {
    let odfData = energyOdf(stats, from, to, sr)
    if (!odfData) return 0
    let minConf = opts?.minConfidence ?? 0.05
    let { bpm, confidence } = combTempo(null, { _odf: odfData, fs: sr, ...opts })
    return confidence >= minConf ? bpm : 0
  }
})

audio.stat('beats', {
  query: (stats, chs, from, to, sr, opts) => {
    let odfData = energyOdf(stats, from, to, sr)
    if (!odfData) return new Float64Array(0)
    let onsets = peakPick(odfData.odf, { hopSize: stats.blockSize, fs: sr, ...opts })
    let { bpm } = combTempo(null, { _odf: odfData, fs: sr, ...opts })
    if (bpm <= 0 || !onsets.length) return new Float64Array(0)
    return beatGrid(bpm, onsets, to - from, stats.blockSize, sr)
  }
})

audio.stat('onsets', {
  query: (stats, chs, from, to, sr, opts) => {
    let odfData = energyOdf(stats, from, to, sr)
    if (!odfData) return new Float64Array(0)
    return peakPick(odfData.odf, { hopSize: stats.blockSize, fs: sr, ...opts })
  }
})

// ── Convenience shorthands ───────────────────────────────────────

audio.fn.bpm = async function(opts) { return this.stat('bpm', opts) }
audio.fn.beats = async function(opts) { return this.stat('beats', opts) }
audio.fn.onsets = async function(opts) { return this.stat('onsets', opts) }

// ── High-fidelity via spectral flux (second stream, more accurate) ─

async function collectMono(inst, opts) {
  let chunks = [], total = 0
  for await (let pcm of inst.stream({ at: opts?.at, duration: opts?.duration })) {
    let ch0 = pcm[0]
    if (ch0?.length) { chunks.push(ch0.slice()); total += ch0.length }
  }
  let buf = new Float32Array(total), off = 0
  for (let c of chunks) { buf.set(c, off); off += c.length }
  return buf
}

/** Full spectral-flux pipeline: { bpm, confidence, beats, onsets }. More precise than stat('bpm'). */
audio.fn.detect = async function(opts) {
  let data = await collectMono(this, opts)
  let { at, duration, ...detectOpts } = opts || {}
  return detect(data, { fs: this.sampleRate, ...detectOpts })
}
