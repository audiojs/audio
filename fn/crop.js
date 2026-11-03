import { sliceSegs, planOffset } from '../plan.js'

export { sliceSegs as cropSegs }

const cropPlan = (segs, ctx) => {
  let { total, length } = ctx
  let s = planOffset(ctx.offset, total)
  return sliceSegs(segs, s, Math.max(0, Math.min(length ?? total - s, total - s)))
}

import audio from '../core.js'
// of `limit` input samples, the output that is final: those in the range
const limit = (limit, { offset, length }) => { let at = offset ?? 0; return Math.max(0, Math.min(length ?? limit - at, limit - at)) }

audio.op('crop', { plan: cropPlan, limit })
