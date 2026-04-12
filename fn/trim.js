import audio from '../core.js'

export function autoThreshold(energies) {
  let vals = energies.filter(e => e > 0)
  if (!vals.length) return -40
  vals.sort((a, b) => a - b)
  let floor = vals[Math.floor(vals.length * 0.1)]
  return Math.max(-80, Math.min(-20, 10 * Math.log10(floor) + 12))
}

/** Resolve dB threshold to linear. Auto-detects from energy stats when db is null. */
export function resolveThreshold(stats, ch, from, to, db) {
  if (db == null) {
    let energies = []
    for (let c = 0; c < ch; c++) for (let i = from; i < to; i++) energies.push(stats.energy[c][i])
    db = autoThreshold(energies)
  }
  return 10 ** (db / 20)
}

/** Check if block i is loud (any channel exceeds thresh). */
export let isLoud = (stats, i, ch, thresh) => {
  for (let c = 0; c < ch; c++)
    if (Math.max(Math.abs(stats.min[c][i]), Math.abs(stats.max[c][i])) > thresh) return true
  return false
}

const trim = (input, output, ctx) => {
  // Resolve handles trim via crop (structural). Process fallback: passthrough.
  for (let c = 0; c < input.length; c++) output[c].set(input[c])
}

const trimResolve = (ctx) => {
  let { stats, sampleRate, totalDuration, threshold } = ctx
  if (!stats?.min || !stats?.energy) return null
  let ch = stats.min.length, blocks = stats.min[0].length
  let total = Math.round(totalDuration * sampleRate)
  let thresh = resolveThreshold(stats, ch, 0, stats.energy[0].length, threshold)

  // Progressive: trim head immediately, tail after decode
  if (stats.partial) {
    let s = 0
    for (; s < blocks; s++) if (isLoud(stats, s, ch, thresh)) break
    if (s === 0) return false  // no head silence yet
    if (s >= blocks) return ['crop', { at: 0, duration: 0 }]  // all silence so far
    return ['crop', { at: (s * audio.BLOCK_SIZE) / sampleRate }]  // head only, open duration
  }

  let s = 0, e = blocks - 1
  for (; s < blocks; s++) if (isLoud(stats, s, ch, thresh)) break
  for (; e >= s; e--) if (isLoud(stats, e, ch, thresh)) break
  e++

  if (s === 0 && e === blocks) return false
  if (s >= e) return ['crop', { at: 0, duration: 0 }]
  let startSample = s * audio.BLOCK_SIZE
  let endSample = Math.min(e * audio.BLOCK_SIZE, total)
  return ['crop', { at: startSample / sampleRate, duration: (endSample - startSample) / sampleRate }]
}

audio.op('trim', { params: ['threshold'], process: trim, resolve: trimResolve })
