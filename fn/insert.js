import { seg, segSrcStart, planOffset } from '../plan.js'

export function insertSegs(segs, at, len, ref, rate) {
  let r = []
  for (let s of segs) {
    if (s[2] + s[1] <= at) r.push(s)
    else if (s[2] >= at) { let n = s.slice(); n[2] = s[2] + len; r.push(n) }
    else {
      let f = at - s[2]
      r.push(seg(segSrcStart(s, s[2], f), f, s[2], s[3], s[4], s[5]))
      r.push(seg(segSrcStart(s, at, s[1] - f), s[1] - f, at + len, s[3], s[4], s[5]))
    }
  }
  r.push(seg(0, len, at, rate, ref ?? null))
  r.sort((a, b) => a[2] - b[2])
  return r
}

const insertPlan = (segs, ctx) => {
  let { total, sampleRate: sr } = ctx
  let source = ctx.source, off = planOffset(ctx.offset, total, total)
  // Normalize raw sources to audio instances for plan segment refs
  if (typeof source !== 'number' && !source?.pages) source = audio.from(source, { sampleRate: sr })
  // Foreign sample rate → segment reads at srcSR/sr so pitch/duration are preserved
  let rate = typeof source !== 'number' && source.sampleRate !== sr ? source.sampleRate / sr : undefined
  let iLen = typeof source === 'number' ? Math.round(source * sr)
    : rate ? Math.round(source.length / rate) : source.length
  if (ctx.length != null) iLen = Math.min(iLen, ctx.length)
  return insertSegs(segs, off, iLen, typeof source === 'number' ? null : source, rate)
}

import audio from '../core.js'
audio.op('insert', { params: ['source'], plan: insertPlan })
