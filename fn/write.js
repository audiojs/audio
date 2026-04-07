const write = (chs, ctx) => {
  let data = ctx.args[0], sr = ctx.sampleRate
  let p = ctx.at != null ? Math.round(ctx.at * sr) : 0
  p = Math.max(0, p)
  for (let c = 0; c < chs.length; c++) {
    let s = Array.isArray(data) ? (data[c] || data[0]) : data
    for (let i = 0; i < s.length && p + i < chs[c].length; i++) chs[c][p + i] = s[i]
  }
  return chs
}

import audio from '../core.js'
audio.op('write', write)
