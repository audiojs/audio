/**
 * Silence detection stat — finds silent regions from block stats.
 * a.stat('silence', { threshold?, minDuration? }) → [{ at, duration }, ...]
 */

import audio from '../core.js'
import { queryRange } from '../stats.js'
import { autoThreshold } from './trim.js'

audio.fn.silence = async function(opts) {
  let { stats, ch, sr, from, to } = await queryRange(this, opts)
  let bs = stats.blockSize
  let minDur = opts?.minDuration ?? 0.1
  let threshold = opts?.threshold

  if (threshold == null) {
    let energies = []
    for (let c = 0; c < ch; c++)
      for (let i = from; i < to; i++) energies.push(stats.energy[c][i])
    threshold = autoThreshold(energies)
  }
  let thresh = 10 ** (threshold / 20)

  // Scan blocks for silence
  let segs = [], start = null
  for (let i = from; i < to; i++) {
    let loud = false
    for (let c = 0; c < ch; c++)
      if (Math.max(Math.abs(stats.min[c][i]), Math.abs(stats.max[c][i])) > thresh) { loud = true; break }
    if (!loud) {
      if (start == null) start = i
    } else if (start != null) {
      let segAt = start * bs / sr, segEnd = i * bs / sr
      if (segEnd - segAt >= minDur) segs.push({ at: segAt, duration: segEnd - segAt })
      start = null
    }
  }
  // Trailing silence
  if (start != null) {
    let segAt = start * bs / sr, segEnd = Math.min(to * bs / sr, this.duration)
    if (segEnd - segAt >= minDur) segs.push({ at: segAt, duration: segEnd - segAt })
  }

  return segs
}
