/**
 * Silence detection stat — finds silent regions from block stats.
 * a.stat('silence', { threshold?, minDuration? }) → [{ at, duration }, ...]
 */

import audio from '../core.js'
import { queryRange } from '../stats.js'
import { resolveThreshold, isLoud } from './trim.js'

audio.fn.silence = async function(opts) {
  let { stats, ch, sr, from, to } = await queryRange(this, opts)
  let bs = stats.blockSize
  let minDur = opts?.minDuration ?? 0.1
  let thresh = resolveThreshold(stats, ch, from, to, opts?.threshold)

  // Scan blocks for silence
  let segs = [], start = null
  for (let i = from; i < to; i++) {
    if (!isLoud(stats, i, ch, thresh)) {
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

audio.stat('silence', {})
audio.stat('silence', { query: null })
