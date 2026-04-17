import audio from '../core.js'
import { rMean } from './loudness.js'

let rMin = (values, from, to) => { let v = Infinity; for (let i = from; i < to; i++) if (values[i] < v) v = values[i]; return v === Infinity ? 0 : v }
let rMax = (values, from, to) => { let v = -Infinity; for (let i = from; i < to; i++) if (values[i] > v) v = values[i]; return v === -Infinity ? 0 : v }
let rSum = (values, from, to) => { let v = 0; for (let i = from; i < to; i++) v += values[i]; return v }

audio.stat('min', {
  block: (chs) => chs.map(ch => {
    let mn = Infinity
    for (let i = 0; i < ch.length; i++) if (ch[i] < mn) mn = ch[i]
    return mn
  }),
  reduce: rMin,
  query: (stats, chs, from, to) => {
    let v = Infinity
    for (let c of chs) for (let i = from; i < Math.min(to, stats.min[c].length); i++) if (stats.min[c][i] < v) v = stats.min[c][i]
    return v === Infinity ? 0 : v
  }
})

audio.stat('max', {
  block: (chs) => chs.map(ch => {
    let mx = -Infinity
    for (let i = 0; i < ch.length; i++) if (ch[i] > mx) mx = ch[i]
    return mx
  }),
  reduce: rMax,
  query: (stats, chs, from, to) => {
    let v = -Infinity
    for (let c of chs) for (let i = from; i < Math.min(to, stats.max[c].length); i++) if (stats.max[c][i] > v) v = stats.max[c][i]
    return v === -Infinity ? 0 : v
  }
})

audio.stat('dc', {
  block: (chs) => chs.map(ch => {
    let sum = 0
    for (let i = 0; i < ch.length; i++) sum += ch[i]
    return sum / ch.length
  }),
  reduce: rMean
})

audio.stat('clipping', {
  block: (chs) => chs.map(ch => {
    let n = 0
    for (let i = 0; i < ch.length; i++) if (ch[i] >= 1 || ch[i] <= -1) n++
    return n
  }),
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
  block: (chs) => chs.map(ch => {
    let sum = 0
    for (let i = 0; i < ch.length; i++) sum += ch[i] * ch[i]
    return sum / ch.length
  }),
  reduce: rMean,
})

audio.stat('rms', {
  query: (stats, chs, from, to) => {
    if (!stats.ms) return 0
    let sum = 0, n = 0
    for (let c of chs)
      for (let i = from; i < Math.min(to, stats.ms[c].length); i++) { sum += stats.ms[c][i]; n++ }
    return n ? Math.sqrt(sum / n) : 0
  }
})

audio.stat('peak', {
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
    let sum = 0, n = 0
    for (let c of chs)
      for (let i = from; i < Math.min(to, stats.ms[c].length); i++) { sum += stats.ms[c][i]; n++ }
    let rms = n ? Math.sqrt(sum / n) : 0
    return (peak > 0 && rms > 0) ? 20 * Math.log10(peak / rms) : 0
  }
})

audio.stat('correlation', {
  block: (chs) => {
    if (chs.length < 2) return 0
    let sum = 0, n = chs[0].length
    for (let i = 0; i < n; i++) sum += chs[0][i] * chs[1][i]
    return sum / n
  },
  reduce: rMean,
  query: (stats, chs, from, to) => {
    if (chs.length < 2) return 1
    if (!stats.correlation || !stats.ms) return 0
    // correlation block stores scalar (L*R mean) — same in all channels
    let corr = stats.correlation[0], ms = stats.ms
    let xy = 0, xx = 0, yy = 0, n = 0
    let end = Math.min(to, corr.length)
    for (let i = from; i < end; i++) { xy += corr[i]; xx += ms[0][i]; yy += ms[1][i]; n++ }
    if (!n || xx === 0 || yy === 0) return 0
    return (xy / n) / Math.sqrt((xx / n) * (yy / n))
  }
})
