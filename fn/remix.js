const remix = (chs, ctx) => {
  let arg = ctx.args[0], len = chs[0].length
  // array map: [0, 1, null, ...] — number = source ch, null = silence
  if (Array.isArray(arg)) {
    return arg.map(src =>
      src == null ? new Float32Array(len) : new Float32Array(chs[src % chs.length])
    )
  }
  let n = chs.length, m = arg
  if (n === m) return false
  if (m < n) {
    let out = new Float32Array(len)
    for (let c = 0; c < n; c++)
      for (let i = 0; i < len; i++) out[i] += chs[c][i]
    let inv = 1 / n
    for (let i = 0; i < len; i++) out[i] *= inv
    return Array.from({ length: m }, () => new Float32Array(out))
  }
  return Array.from({ length: m }, (_, c) => new Float32Array(chs[c % n]))
}

const remixCh = (_, args) => Array.isArray(args[0]) ? args[0].length : args[0]

import audio from '../core.js'
audio.op('remix', { process: remix, ch: remixCh })
