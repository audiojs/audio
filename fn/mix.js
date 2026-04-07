const mix = (chs, ctx) => {
  let source = ctx.args[0], sr = ctx.sampleRate
  let p = ctx.at != null ? Math.round(ctx.at * sr) : 0
  let src = ctx.render(source)
  for (let c = 0; c < chs.length; c++) {
    let m = src[c] || src[0]
    let n = ctx.duration != null ? Math.round(ctx.duration * sr) : m.length
    for (let i = 0; i < Math.min(n, m.length) && Math.max(0, p) + i < chs[c].length; i++) chs[c][Math.max(0, p) + i] += m[i]
  }
  return chs
}

import audio from '../core.js'
audio.op('mix', mix)
