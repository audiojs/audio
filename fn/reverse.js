function reverseSegs(segs, off, end) {
  let r = []
  for (let s of segs) {
    let se = s.out + s.len
    if (se <= off || s.out >= end) { r.push(s); continue }
    if (s.out < off) r.push({ src: s.src, out: s.out, len: off - s.out, ref: s.ref, rev: s.rev })
    let iStart = Math.max(s.out, off), iEnd = Math.min(se, end)
    r.push({ src: s.src + iStart - s.out, out: off + end - iEnd, len: iEnd - iStart, ref: s.ref, rev: !s.rev })
    if (se > end) r.push({ src: s.src + end - s.out, out: end, len: se - end, ref: s.ref, rev: s.rev })
  }
  r.sort((a, b) => a.out - b.out)
  return r
}

const reverse = (chs, ctx) => {
  let sr = ctx.sampleRate
  let s = ctx.at != null ? Math.round(ctx.at * sr) : 0
  let end = ctx.duration != null ? s + Math.round(ctx.duration * sr) : chs[0].length
  s = Math.max(0, s)
  for (let ch of chs) ch.subarray(s, Math.min(end, ch.length)).reverse()
  return chs
}

const reversePlan = (segs, ctx) => {
  let { total, offset, span } = ctx
  let s = offset != null ? (offset < 0 ? total + offset : offset) : 0
  return reverseSegs(segs, s, s + (span ?? total - s))
}

import audio from '../core.js'
audio.op('reverse', reverse, { plan: reversePlan })
