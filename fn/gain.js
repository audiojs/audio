import { opRange } from '../history.js'

const gain = (chs, ctx) => {
  let val = ctx.args[0], lin = ctx.unit === 'linear'
  let [s, end] = opRange(ctx, chs[0].length)
  let auto = typeof val === 'function', f = auto ? 0 : lin ? val : 10 ** (val / 20)
  let off = (ctx.blockOffset || 0) * ctx.sampleRate
  let toMul = lin ? v => v : v => 10 ** (v / 20)
  for (let ch of chs)
    for (let i = Math.max(0, s); i < Math.min(end, ch.length); i++)
      ch[i] *= auto ? toMul(val((off + i) / ctx.sampleRate)) : f
  return chs
}

import audio from '../core.js'
audio.op('gain', gain)
