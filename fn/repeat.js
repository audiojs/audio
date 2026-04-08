import { cropSegs } from './crop.js'
import { seg } from '../history.js'

function repeatSegs(segs, times, total, off, dur) {
  if (off == null) {
    let r = []
    for (let t = 0; t <= times; t++)
      for (let s of segs) { let n = s.slice(); n[2] = s[2] + total * t; r.push(n) }
    return r
  }
  let segLen = dur ?? (total - off), clip = cropSegs(segs, off, segLen), r = []
  for (let s of segs) {
    let se = s[2] + s[1]
    if (se <= off + segLen) r.push(s)
    else if (s[2] >= off + segLen) { let n = s.slice(); n[2] = s[2] + segLen * times; r.push(n) }
    else {
      let absR = Math.abs(s[3] || 1), split = off + segLen - s[2]
      r.push(seg(s[0], split, s[2], s[3], s[4]))
      r.push(seg(s[0] + split * absR, se - off - segLen, off + segLen * (times + 1), s[3], s[4]))
    }
  }
  for (let t = 1; t <= times; t++)
    for (let c of clip) { let n = c.slice(); n[2] = off + segLen * t + c[2]; r.push(n) }
  r.sort((a, b) => a[2] - b[2])
  return r
}

const repeat = (chs, ctx) => {
  let times = ctx.args[0] ?? 1, sr = ctx.sampleRate
  let at = ctx.at, dur = ctx.duration
  if (at == null) {
    return chs.map(ch => {
      let o = new Float32Array(ch.length * (times + 1))
      for (let i = 0; i <= times; i++) o.set(ch, i * ch.length)
      return o
    })
  }
  let s = Math.max(0, Math.round(at * sr))
  let e = dur != null ? s + Math.round(dur * sr) : chs[0].length
  let segLen = e - s
  return chs.map(ch => {
    let o = new Float32Array(ch.length + segLen * times)
    o.set(ch.subarray(0, s))
    for (let i = 0; i <= times; i++) o.set(ch.subarray(s, e), s + i * segLen)
    o.set(ch.subarray(e), s + (times + 1) * segLen)
    return o
  })
}

const repeatPlan = (segs, ctx) => {
  let { total, args, offset, span } = ctx
  let off = offset != null ? (offset < 0 ? total + offset : offset) : null
  return repeatSegs(segs, args[0] ?? 1, total, off, span)
}

import audio from '../core.js'
audio.op('repeat', repeat, repeatPlan)
