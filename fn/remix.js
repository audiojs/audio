const remix = (input, output, ctx) => {
  let arg = ctx.layout, len = input[0].length
  if (Array.isArray(arg)) {
    for (let c = 0; c < output.length; c++) {
      let src = arg[c]
      if (src == null) output[c].fill(0)
      else output[c].set(input[((src % input.length) + input.length) % input.length])
    }
    return
  }
  let n = input.length, m = arg
  if (n === m) { for (let c = 0; c < n; c++) output[c].set(input[c]); return }
  if (m < n) {
    output[0].fill(0)
    for (let c = 0; c < n; c++)
      for (let i = 0; i < len; i++) output[0][i] += input[c][i]
    let inv = 1 / n
    for (let i = 0; i < len; i++) output[0][i] *= inv
    for (let c = 1; c < m; c++) output[c].set(output[0])
    return
  }
  for (let c = 0; c < m; c++) output[c].set(input[c % n])
}

const remixCh = (curCh, ctx) => {
  let m = Array.isArray(ctx.layout) ? ctx.layout.length : ctx.layout
  return m === curCh ? 0 : m
}

import audio from '../core.js'
audio.op('remix', { params: ['layout'], process: remix, ch: remixCh })
