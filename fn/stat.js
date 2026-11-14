import audio from '../core.js'
import { rMean, blockMean } from './loudness.js'
import { block } from './block.js'
import { peakOf } from '../stats.js'

let rMin = (values, from, to) => { let v = Infinity; for (let i = from; i < to; i++) if (values[i] < v) v = values[i]; return v === Infinity ? 0 : v }
let rMax = (values, from, to) => { let v = -Infinity; for (let i = from; i < to; i++) if (values[i] > v) v = values[i]; return v === -Infinity ? 0 : v }
let rSum = (values, from, to) => { let v = 0; for (let i = from; i < to; i++) v += values[i]; return v }

audio.stat('min', {
  block,
  reduce: rMin,
  query: (stats, chs, from, to) => {
    let v = Infinity
    for (let c of chs) for (let i = from; i < Math.min(to, stats.min[c].length); i++) if (stats.min[c][i] < v) v = stats.min[c][i]
    return v === Infinity ? 0 : v
  }
})

audio.stat('max', {
  block,
  reduce: rMax,
  query: (stats, chs, from, to) => {
    let v = -Infinity
    for (let c of chs) for (let i = from; i < Math.min(to, stats.max[c].length); i++) if (stats.max[c][i] > v) v = stats.max[c][i]
    return v === -Infinity ? 0 : v
  }
})

audio.stat('dc', {
  block,
  reduce: rMean
})

audio.stat('clipping', {
  block,
  reduce: rSum,
  query: (stats, chs, from, to, sr) => {
    let bs = stats.blockSize, times = []
    for (let i = from; i < to; i++) {
      let n = 0
      for (let c of chs) n += stats.clipping[c][i] || 0
      if (n > 0) times.push(i * bs / sr)
    }
    return new Float32Array(times)
  }
})

audio.stat('ms', {
  block,
  reduce: rMean,
})

/** RMS over the channels' mean squares averaged: ACX Check 2.4.2-1 `track-rms` (the root of the mean of both channels'
 *  mean squares), each block weighed by its samples. */
const meanSquare = (stats, chs, from, to) => {
  let sum = 0
  for (let c of chs) sum += blockMean(stats.ms[c], stats, from, Math.min(to, stats.ms[c].length))
  return chs.length ? sum / chs.length : 0
}

audio.stat('rms', {
  fields: ['ms'],
  query: (stats, chs, from, to) => stats.ms ? Math.sqrt(meanSquare(stats, chs, from, to)) : 0
})

audio.stat('peak', {
  fields: ['min', 'max'],
  query: (stats, chs, from, to) => stats.min && stats.max ? peakOf(stats, chs, from, to) : 0
})

audio.stat('crest', {
  fields: ['min', 'max', 'ms'],
  query: (stats, chs, from, to) => {
    if (!stats.min || !stats.max || !stats.ms) return 0
    let peak = peakOf(stats, chs, from, to), rms = Math.sqrt(meanSquare(stats, chs, from, to))
    return (peak > 0 && rms > 0) ? 20 * Math.log10(peak / rms) : 0
  }
})

audio.stat('correlation', {
  fields: ['correlation', 'ms'],
  block,
  reduce: rMean,
  query: (stats, chs, from, to) => {
    if (chs.length < 2) return 1
    if (!stats.correlation || !stats.ms) return 0
    // correlation block stores scalar (L*R mean) — same in all channels
    let corr = stats.correlation[0], ms = stats.ms
    let end = Math.min(to, corr.length)
    let xy = blockMean(corr, stats, from, end)
    let xx = blockMean(ms[0], stats, from, end), yy = blockMean(ms[1], stats, from, end)
    return xx > 0 && yy > 0 ? xy / Math.sqrt(xx * yy) : 0
  }
})
