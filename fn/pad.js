/**
 * Pad — add silence to start and/or end of audio.
 * pad(1) = 1s both sides. pad(1, 2) = 1s before, 2s after.
 */

import { SILENCE } from '../history.js'

const pad = (chs, ctx) => {
  let before = ctx.args[0] ?? 0
  let after = ctx.args.length > 1 ? ctx.args[1] : before
  let sr = ctx.sampleRate
  let bN = Math.round(before * sr), aN = Math.round(after * sr)
  if (bN === 0 && aN === 0) return false
  return chs.map(ch => {
    let o = new Float32Array(ch.length + bN + aN)
    o.set(ch, bN)
    return o
  })
}

pad.dur = (len, sr, args) => {
  let before = args[0] ?? 0, after = args.length > 1 ? args[1] : before
  return len + Math.round(before * sr) + Math.round(after * sr)
}

pad.plan = (segs, total, sr, args) => {
  let before = args[0] ?? 0, after = args.length > 1 ? args[1] : before
  let bN = Math.round(before * sr), aN = Math.round(after * sr)
  let r = segs.map(s => ({ ...s, out: s.out + bN }))
  if (bN > 0) r.unshift({ src: 0, out: 0, len: bN, ref: SILENCE })
  if (aN > 0) r.push({ src: 0, out: total + bN, len: aN, ref: SILENCE })
  return r
}

export default (audio) => { audio.op.pad = pad }
