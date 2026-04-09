
import { seg, planOffset } from '../history.js'

function insertSegs(segs, at, len, ref) {
  let r = []
  for (let s of segs) {
    if (s[2] + s[1] <= at) r.push(s)
    else if (s[2] >= at) { let n = s.slice(); n[2] = s[2] + len; r.push(n) }
    else {
      let f = at - s[2], absR = Math.abs(s[3] || 1)
      r.push(seg(s[0], f, s[2], s[3], s[4]))
      r.push(seg(s[0] + f * absR, s[1] - f, at + len, s[3], s[4]))
    }
  }
  r.push(seg(0, len, at, undefined, ref ?? null))
  r.sort((a, b) => a[2] - b[2])
  return r
}

const insert = (chs, ctx) => {
  let source = ctx.args[0], sr = ctx.sampleRate
  let at = ctx.at, duration = ctx.duration
  let src = typeof source === 'number'
    ? Array.from({ length: chs.length }, () => new Float32Array(Math.round(source * sr)))
    : ctx.render(source)
  if (duration != null) {
    let n = Math.round(duration * sr)
    src = src.map(ch => ch.slice(0, n))
  }
  let p = Math.round((at ?? chs[0].length / sr) * sr)
  return chs.map((ch, c) => {
    let ins = src[c] || new Float32Array(src[0].length)
    let o = new Float32Array(ch.length + ins.length)
    o.set(ch.subarray(0, p))
    o.set(ins, p)
    o.set(ch.subarray(p), p + ins.length)
    return o
  })
}

const insertPlan = (segs, ctx) => {
  let { total, sampleRate: sr, args } = ctx
  let source = args[0], off = planOffset(ctx.offset, total, total)
  // Normalize raw sources to audio instances for plan segment refs
  if (typeof source !== 'number' && !source?.pages) source = audio.from(source, { sampleRate: sr })
  let iLen = typeof source === 'number' ? Math.round(source * sr) : source.length
  if (ctx.span != null) iLen = Math.min(iLen, ctx.span)
  return insertSegs(segs, off, iLen, typeof source === 'number' ? null : source)
}

import audio from '../core.js'
audio.op('insert', insert, insertPlan)
