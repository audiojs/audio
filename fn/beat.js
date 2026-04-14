/**
 * Beat detection — tempo estimation, beat grid, and onset detection.
 * Uses spectral flux onset detection with autocorrelation tempo estimation.
 *
 * a.stat('bpm', opts)     → number (BPM)
 * a.stat('beats', opts)   → Float64Array of beat timestamps (seconds)
 * a.stat('onsets', opts)  → Float64Array of onset timestamps (seconds)
 * a.detect(opts)          → { bpm, confidence, beats, onsets }
 *
 * opts: { at, duration, minBpm, maxBpm, delta, frameSize, hopSize }
 *   at/duration — restrict analysis to a time range
 *   minBpm/maxBpm — BPM search range (default 60–200)
 *   delta — onset peak-pick sensitivity multiplier (default 1.4, lower = more onsets)
 *   frameSize/hopSize — STFT parameters (default 2048/512)
 */

import { detect } from 'beat-detection'
import audio from '../core.js'

/** Buffer full mono signal from stream into a single Float32Array. */
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

/** Run full beat detection pipeline, stripping range opts before forwarding. */
async function runDetect(inst, opts) {
  let data = await collectMono(inst, opts)
  let { at, duration, ...detectOpts } = opts || {}
  return detect(data, { fs: inst.sampleRate, ...detectOpts })
}

/** Full result: { bpm, confidence, beats, onsets } */
audio.fn.detect = async function(opts) {
  return runDetect(this, opts)
}

/** a.stat('bpm') → number */
audio.fn.bpm = async function(opts) {
  let { bpm } = await runDetect(this, opts)
  return bpm
}

/** a.stat('beats') → Float64Array of beat timestamps (seconds) */
audio.fn.beats = async function(opts) {
  let { beats } = await runDetect(this, opts)
  return beats
}

/** a.stat('onsets') → Float64Array of onset timestamps (seconds) */
audio.fn.onsets = async function(opts) {
  let { onsets } = await runDetect(this, opts)
  return onsets
}
