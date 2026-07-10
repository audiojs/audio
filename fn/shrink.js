import audio from '../core.js'
import { resolveThreshold, isLoud } from './trim.js'

const shrink = (input, output, ctx) => {
  // Resolve handles shrink via removes (structural). Process fallback: passthrough.
  for (let c = 0; c < input.length; c++) output[c].set(input[c])
}

/** Compress silent pauses to a target gap, throughout — FFmpeg `silenceremove` /
 *  Audacity truncate-silence. A silent run longer than `gap` keeps its first `gap`
 *  seconds, the remainder is removed. Stat-conditioned like trim: emits concrete
 *  removes once block stats exist; positions are pre-shifted for prior removes. */
const shrinkResolve = (ctx) => {
  let { stats, sampleRate: sr, totalDuration, threshold, at, duration } = ctx
  if (!stats?.min || !stats?.energy) return null
  let ch = stats.min.length, blocks = stats.min[0].length
  let bs = audio.BLOCK_SIZE
  let total = Math.round(totalDuration * sr)
  let thresh = resolveThreshold(stats, ch, 0, stats.energy[0].length, threshold)
  let gapSamples = Math.round(Math.max(0, ctx.gap ?? 0.3) * sr)

  // Ranged shrink compresses only pauses inside [at, at+duration]
  if (at != null && at < 0) at = totalDuration + at
  let from = at != null ? Math.max(0, Math.floor(at * sr / bs)) : 0
  let to = duration != null ? Math.min(blocks, Math.ceil(((at ?? 0) + duration) * sr / bs)) : blocks

  let edits = [], shift = 0, start = null
  const close = (s, endSample) => {
    let startSample = s * bs, cut = endSample - startSample - gapSamples
    if (cut < bs) return  // sub-block savings — not worth a splice
    edits.push(['remove', { at: (startSample + gapSamples) / sr - shift, duration: cut / sr }])
    shift += cut / sr
  }
  for (let i = from; i < to; i++) {
    if (!isLoud(stats, i, ch, thresh)) { if (start == null) start = i }
    else if (start != null) { close(start, i * bs); start = null }
  }
  // Trailing run closes at the scan edge: a range end always, end-of-audio only once stats are final
  if (start != null && (to < blocks || !stats.partial)) close(start, Math.min(to * bs, total))
  return edits.length ? edits : false
}

audio.op('shrink', { params: ['gap', 'threshold'], process: shrink, resolve: shrinkResolve })
