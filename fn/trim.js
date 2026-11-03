import audio from '../core.js'
import { resolveThreshold, isLoud } from '../stats.js'

const trim = (input, output, ctx) => {
  // Resolve handles trim via crop (structural). Process fallback: passthrough.
  for (let c = 0; c < input.length; c++) output[c].set(input[c])
}

const trimResolve = (ctx) => {
  let { stats, sampleRate, totalDuration, threshold } = ctx
  if (!stats?.min || !stats?.energy) return null
  // blocks of the size the stats were made at, whatever BLOCK_SIZE is set to since
  let ch = stats.min.length, blocks = stats.min[0].length, bs = stats.blockSize
  let total = Math.round(totalDuration * sampleRate)
  let thresh = resolveThreshold(stats, ch, 0, stats.energy[0].length, threshold)

  // Progressive: the head trims at once; the tail is held back to the last loud block and
  // released as sound resumes, so trailing silence is never emitted and then contradicted
  if (stats.partial) {
    let s = 0, e = blocks - 1
    for (; s < blocks; s++) if (isLoud(stats, s, ch, thresh)) break
    if (s >= blocks) return ['crop', { at: 0, duration: 0 }]  // all silence so far
    for (; e > s; e--) if (isLoud(stats, e, ch, thresh)) break
    return ['crop', { at: s * bs / sampleRate, duration: (e + 1 - s) * bs / sampleRate }]
  }

  let s = 0, e = blocks - 1
  for (; s < blocks; s++) if (isLoud(stats, s, ch, thresh)) break
  for (; e >= s; e--) if (isLoud(stats, e, ch, thresh)) break
  e++

  if (s === 0 && e === blocks) return false
  if (s >= e) return ['crop', { at: 0, duration: 0 }]
  let startSample = s * bs
  let endSample = Math.min(e * bs, total)
  return ['crop', { at: startSample / sampleRate, duration: (endSample - startSample) / sampleRate }]
}

// The automatic threshold reads the whole input (its quietest tenth): on a live stream every cut
// waits for the end. A given threshold decides block by block, so trim streams.
audio.op('trim', { params: ['threshold'], process: trim, resolve: trimResolve, holdback: (o, sr, total) => o.threshold == null ? total : 0 })
