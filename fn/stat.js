import audio from '../core.js'

let rMin = (src, from, to) => { let v = Infinity; for (let i = from; i < to; i++) if (src[i] < v) v = src[i]; return v === Infinity ? 0 : v }
let rMax = (src, from, to) => { let v = -Infinity; for (let i = from; i < to; i++) if (src[i] > v) v = src[i]; return v === -Infinity ? 0 : v }
let rSum = (src, from, to) => { let v = 0; for (let i = from; i < to; i++) v += src[i]; return v }
let rMean = (src, from, to) => { let n = to - from; if (!n) return 0; let v = 0; for (let i = from; i < to; i++) v += src[i]; return v / n }
let rRms = (src, from, to) => { let n = to - from; if (!n) return 0; let v = 0; for (let i = from; i < to; i++) v += src[i]; return Math.sqrt(v / n) }

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

audio.stat('clip', {
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
      for (let c of chs) n += stats.clip[c][i] || 0
      if (n > 0) times.push(i * bs / sr)
    }
    return new Float32Array(times)
  }
})

audio.stat('rms', {
  block: (chs) => chs.map(ch => {
    let sum = 0
    for (let i = 0; i < ch.length; i++) sum += ch[i] * ch[i]
    return sum / ch.length
  }),
  reduce: rRms,
  query: (stats, chs, from, to) => {
    let sum = 0, n = 0
    for (let c of chs)
      for (let i = from; i < Math.min(to, stats.rms[c].length); i++) { sum += stats.rms[c][i]; n++ }
    return n ? Math.sqrt(sum / n) : 0
  }
})


