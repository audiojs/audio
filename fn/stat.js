import audio, { FULL } from '../core.js'
import { rMean, blockMean } from './loudness.js'

let rMin = (values, from, to) => { let v = Infinity; for (let i = from; i < to; i++) if (values[i] < v) v = values[i]; return v === Infinity ? 0 : v }
let rMax = (values, from, to) => { let v = -Infinity; for (let i = from; i < to; i++) if (values[i] > v) v = values[i]; return v === -Infinity ? 0 : v }
const FULL2 = FULL * FULL
let rSum = (values, from, to) => { let v = 0; for (let i = from; i < to; i++) v += values[i]; return v }

/** One pass per channel serves min, max, dc, clipping, ms and correlation (block record). */
function core(chs) {
  let n = chs[0].length, min = [], max = [], dc = [], clipping = [], ms = [], xy = 0
  for (let c = 0; c < chs.length; c++) {
    let x = chs[c], mn = Infinity, mx = -Infinity, s = 0, q = 0, k = 0
    for (let i = 0; i < n; i++) {
      let v = x[i], v2 = v * v
      if (v < mn) mn = v
      if (v > mx) mx = v
      s += v
      q += v2
      if (v2 >= FULL2) k++  // |v| ≥ full scale, NaN excluded
    }
    min.push(mn); max.push(mx); dc.push(s / n); clipping.push(k); ms.push(q / n)
  }
  if (chs.length > 1) {
    let l = chs[0], r = chs[1]
    for (let i = 0; i < n; i++) xy += l[i] * r[i]
    xy /= n
  }
  return { min, max, dc, clipping, ms, correlation: xy }
}

audio.stat('min', {
  block: core,
  reduce: rMin,
  query: (stats, chs, from, to) => {
    let v = Infinity
    for (let c of chs) for (let i = from; i < Math.min(to, stats.min[c].length); i++) if (stats.min[c][i] < v) v = stats.min[c][i]
    return v === Infinity ? 0 : v
  }
})

audio.stat('max', {
  block: core,
  reduce: rMax,
  query: (stats, chs, from, to) => {
    let v = -Infinity
    for (let c of chs) for (let i = from; i < Math.min(to, stats.max[c].length); i++) if (stats.max[c][i] > v) v = stats.max[c][i]
    return v === -Infinity ? 0 : v
  }
})

audio.stat('dc', {
  block: core,
  reduce: rMean
})

audio.stat('clipping', {
  block: core,
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
  block: core,
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
  query: (stats, chs, from, to) => {
    if (!stats.min || !stats.max) return 0
    let v = 0
    for (let c of chs) {
      let mn = stats.min[c], mx = stats.max[c], end = Math.min(to, mn.length)
      for (let i = from; i < end; i++) {
        let a = mn[i] < 0 ? -mn[i] : mn[i], b = mx[i] < 0 ? -mx[i] : mx[i]
        if (a > v) v = a
        if (b > v) v = b
      }
    }
    return v
  }
})

audio.stat('crest', {
  fields: ['min', 'max', 'ms'],
  query: (stats, chs, from, to) => {
    if (!stats.min || !stats.max || !stats.ms) return 0
    let peak = 0
    for (let c of chs) {
      let mn = stats.min[c], mx = stats.max[c], end = Math.min(to, mn.length)
      for (let i = from; i < end; i++) {
        let a = mn[i] < 0 ? -mn[i] : mn[i], b = mx[i] < 0 ? -mx[i] : mx[i]
        if (a > peak) peak = a
        if (b > peak) peak = b
      }
    }
    let rms = Math.sqrt(meanSquare(stats, chs, from, to))
    return (peak > 0 && rms > 0) ? 20 * Math.log10(peak / rms) : 0
  }
})

audio.stat('correlation', {
  fields: ['correlation', 'ms'],
  block: core,
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
