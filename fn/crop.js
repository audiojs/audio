import { sliceSegs, planOffset } from '../plan.js'

export { sliceSegs as cropSegs }

const cropPlan = (segs, ctx) => {
  let { total, length } = ctx
  let s = planOffset(ctx.offset, total)
  return sliceSegs(segs, s, Math.max(0, Math.min(length ?? total - s, total - s)))
}

import audio from '../core.js'
audio.op('crop', { plan: cropPlan })
