import { opRange } from '../plan.js'

const write = (input, output, ctx) => {
  let data = ctx.data, len = input[0].length
  let [p, end] = opRange(ctx, len)
  let srcOff = Math.max(0, -p), dstOff = Math.max(0, p)
  for (let c = 0; c < input.length; c++) {
    output[c].set(input[c])
    let s = Array.isArray(data) ? (data[c] || data[0]) : data
    for (let i = srcOff; i < s.length && dstOff + i - srcOff < end; i++) output[c][dstOff + i - srcOff] = s[i]
  }
}

import audio from '../core.js'
audio.op('write', { params: ['data'], process: write })
