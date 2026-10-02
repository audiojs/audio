/**
 * Beat detection — tempo, beat grid, onsets.
 *
 * a.stat('bpm', opts)     → number (BPM) — instant, from existing energy blocks
 * a.stat('beats', opts)   → Float64Array of beat timestamps (seconds)
 * a.stat('onsets', opts)  → Float64Array of onset timestamps (seconds)
 * a.detect(opts)          → { bpm, confidence, beats, onsets } — high-fidelity via spectral flux
 * steadyTempo(a, { at, duration }) → BPM or null: detect()'s, only where the whole range holds it
 *
 * stat opts: { at, duration, minBpm, maxBpm, delta, channel }
 * detect opts: + { frameSize, hopSize }
 *
 * The stat variants derive BPM from the energy block stat already computed during decode —
 * no second stream. detect() streams the channels' mean through spectral flux for higher precision.
 */

import combTempo from '@audio/beat-tempo/comb'
import detect from '@audio/beat-detect'
import { beatTrack } from '@audio/beat'
import { peakPick, ODF } from '@audio/onset'
import audio, { mono, perChannel } from '../core.js'

// ── Energy ODF from block stats ──────────────────────────────────

/** Build energy-flux ODF from existing energy block stat. Returns null if silent. */
function energyOdf(stats, from, to, sr) {
  let energy = stats.energy
  if (!energy?.length) return null
  let n = to - from, ch = energy.length

  // Average channels to mono energy envelope, and the block before the range: silence before the start
  let en = new Float64Array(n), before = 0
  for (let c = 0; c < ch; c++) {
    for (let i = 0; i < n; i++) en[i] += energy[c][from + i]
    if (from > 0) before += energy[c][from - 1]
  }
  if (ch > 1) { for (let i = 0; i < n; i++) en[i] /= ch; before /= ch }

  // Positive first differences = energy flux ODF; the first block rises from the one before it, so a sound that
  // starts struck has its onset at the start
  let odf = new Float64Array(n)
  for (let i = 0; i < n; i++) { let d = en[i] - (i ? en[i - 1] : before); if (d > 0) odf[i] = d }

  let any = false
  for (let i = 0; i < n; i++) if (odf[i] > 0) { any = true; break }
  if (!any) return null

  return { odf, energy: en, before, nFrames: n, hopSize: stats.blockSize, fs: sr }
}

// Onsets: peaks of the flux over its local mean that make the sound louder, their block holding at least 1 dB more
// energy than the quieter of the two before it, about the least change of level heard. Onsets are relative changes
// (Klapuri, ICASSP 1999); smaller swells, like the beating of partials in a decay, pass the local mean only because
// a decay's flux is small everywhere.
const RISE = 10 ** (1 / 10)
function pickOnsets({ odf, energy, before, hopSize }, sr, opts) {
  let pick = { hopSize, fs: sr, ...opts }
  let rises = f => energy[f] >= RISE * Math.min(f > 0 ? energy[f - 1] : before, f > 1 ? energy[f - 2] : before)
  return peakPick(odf, pick).filter(t => rises(Math.round(t * pick.fs / pick.hopSize)))
}

// ── Stat descriptors (instant — read from existing energy blocks) ─

audio.stat('bpm', {
  fields: ['energy'],
  query: (stats, chs, from, to, sr, opts) => {
    let odfData = energyOdf(stats, from, to, sr)
    if (!odfData) return 0
    let minConf = opts?.minConfidence ?? 0.05
    let { bpm, confidence } = combTempo(null, { [ODF]: odfData, fs: sr, ...opts })
    return confidence >= minConf ? bpm : 0
  }
})

audio.stat('beats', {
  fields: ['energy'],
  query: (stats, chs, from, to, sr, opts) => {
    let odfData = energyOdf(stats, from, to, sr)
    if (!odfData) return new Float64Array(0)
    // Ellis's dynamic-programming tracker (JNMR 2007) on the flux, at combTempo's tempo: it follows the beats
    // where a fixed grid drifts off with the tempo, and takes the strong onsets for the beats, not the off-beats
    return beatTrack(null, { [ODF]: odfData, fs: sr, ...opts }).beats
  }
})

audio.stat('onsets', {
  fields: ['energy'],
  query: (stats, chs, from, to, sr, opts) => {
    let odfData = energyOdf(stats, from, to, sr)
    return odfData ? pickOnsets(odfData, sr, opts) : new Float64Array(0)
  }
})

// ── Convenience shorthands ───────────────────────────────────────

audio.fn.bpm = async function(opts) { return this.stat('bpm', opts) }
audio.fn.beats = async function(opts) { return this.stat('beats', opts) }
audio.fn.onsets = async function(opts) { return this.stat('onsets', opts) }

// ── High-fidelity via spectral flux (second stream, more accurate) ─

// The channels' mean. BabySlakh's 20 tracks mixed to stereo from their stems, drums hard right: beats F 0.70 (mir_eval,
// 70 ms), the first channel alone 0.55; per-channel flux summed and the flux of the channels' mean power score within
// 0.01 of the mean
async function collectMono(inst, opts) {
  let chunks = [], total = 0
  for await (let m of mono(inst, opts)) { chunks.push(m.slice()); total += m.length }
  let buf = new Float32Array(total), off = 0
  for (let c of chunks) { buf.set(c, off); off += c.length }
  return buf
}

/** Full spectral-flux pipeline: { bpm, confidence, beats, onsets }. More precise than stat('bpm'). */
audio.fn.detect = perChannel(async function(opts) {
  let data = await collectMono(this, opts)
  let { at, duration, channel, ...detectOpts } = opts || {}
  return detect(data, { fs: this.sampleRate, ...detectOpts })
})

// ── Steady tempo: one the whole range holds ──────────────────────

// The tempo of `a` over [at, at + duration] s where it is clear, else null (speech, rubato, a change of tempo): detect()'s
// over the range and over each half within 4% of each other, as tempo estimates are scored (Gouyon et al., "An
// experimental comparison of audio tempo induction algorithms", IEEE TASLP 14(5), 2006, "Accuracy 1"). Judged over 6 s
// at least, a half then holding 3 beats at 60 BPM, and over 3 minutes at most, the middle of a longer range, past an
// intro and outro: detect() takes about 2 ms a second of sound, three times over.
const STEADY = 6, MOST = 180
export async function steadyTempo(a, { at = 0, duration = Infinity } = {}) {
  duration = Math.min(duration, a.duration - at)
  if (!(duration >= STEADY)) return null
  if (duration > MOST) { at += (duration - MOST) / 2; duration = MOST }
  let half = duration / 2
  let [bpm, ...halves] = await Promise.all([[at, duration], [at, half], [at + half, half]].map(([at, duration]) => a.detect({ at, duration }).then(d => d.bpm)))
  return bpm > 0 && halves.every(h => Math.abs(h - bpm) <= .04 * bpm) ? bpm : null
}
