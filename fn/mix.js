const mix = (chs, ctx) => {
  let source = ctx.args[0], sr = ctx.sampleRate, chLen = chs[0].length
  if (typeof source === 'number') throw new TypeError('mix: expected audio instance or Float32Array[], not a number')
  let sLen = Array.isArray(source) ? source[0].length : source.length
  let p = ctx.at != null ? Math.round(ctx.at * sr) : 0
  let srcOff = Math.max(0, -p), dstOff = Math.max(0, p)
  let n = Math.min(sLen - srcOff, chLen - dstOff)
  if (ctx.duration != null) n = Math.min(n, Math.round(ctx.duration * sr) - srcOff)
  if (n <= 0) return chs
  let src = ctx.render(source, srcOff, n)
  for (let c = 0; c < chs.length; c++) {
    let m = src[c % src.length]
    for (let i = 0; i < n; i++) chs[c][dstOff + i] += m[i]
  }
  return chs
}

import audio from '../core.js'
audio.op('mix', mix)
