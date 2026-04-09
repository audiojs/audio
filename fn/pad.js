/**
 * Pad — add silence to start and/or end of audio.
 * pad(1) = 1s both sides. pad(1, 2) = 1s before, 2s after.
 */

import { seg } from '../history.js'

const padPlan = (segs, ctx) => {
  let { total, sampleRate: sr, args } = ctx
  let before = args[0] ?? 0, after = args.length > 1 ? args[1] : before
  let bN = Math.round(before * sr), aN = Math.round(after * sr)
  let r = segs.map(s => { let n = s.slice(); n[2] = s[2] + bN; return n })
  if (bN > 0) r.unshift(seg(0, bN, 0, undefined, null))
  if (aN > 0) r.push(seg(0, aN, total + bN, undefined, null))
  return r
}

import audio from '../core.js'
audio.op('pad', null, padPlan)
