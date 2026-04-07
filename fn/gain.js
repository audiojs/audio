const gain = (chs, ctx) => {
  let val = ctx.args[0], sr = ctx.sampleRate, lin = ctx.unit === 'linear'
  let s = ctx.at != null ? Math.round(ctx.at * sr) : 0
  let end = ctx.duration != null ? s + Math.round(ctx.duration * sr) : chs[0].length
  let auto = typeof val === 'function', f = auto ? 0 : lin ? val : 10 ** (val / 20)
  let off = (ctx.blockOffset || 0) * sr
  let toMul = lin ? v => v : v => 10 ** (v / 20)
  for (let ch of chs)
    for (let i = Math.max(0, s); i < Math.min(end, ch.length); i++)
      ch[i] *= auto ? toMul(val((off + i) / sr)) : f
  return chs
}

import audio from '../core.js'
audio.op('gain', gain)
