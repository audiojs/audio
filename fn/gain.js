import { opRange } from '../plan.js'

const gain = (input, output, ctx) => {
  let lin = ctx.unit === 'linear', val = ctx.value ?? (lin ? 1 : 0)
  let len = input[0].length
  let [s, end] = opRange(ctx, len)
  let auto = typeof val === 'function'
  let f = auto ? 0 : lin ? +val : 10 ** (+val / 20)
  if (!auto && Number.isNaN(f)) throw new TypeError(`gain: invalid value '${ctx.value}'`)
  let off = (ctx.blockOffset || 0) * ctx.sampleRate
  let toMul = lin ? v => v : v => 10 ** (v / 20)
  s = Math.max(0, Math.min(s, len)); end = Math.max(s, Math.min(end, len))
  for (let c = 0; c < input.length; c++) {
    let inp = input[c], out = output[c]
    if (s > 0) out.set(inp.subarray(0, s))
    for (let i = s; i < end; i++) out[i] = inp[i] * (auto ? toMul(val((off + i) / ctx.sampleRate)) : f)
    if (end < len) out.set(inp.subarray(end), end)
  }
}

import audio from '../core.js'
audio.op('gain', {
  params: ['value'],
  ranged: true,
  auto: 'sample',
  process: gain,
  deriveStats: (stats, opts) => {
    let val = opts.value ?? 0
    if (typeof val === 'function' || typeof val === 'object') return false  // automation fn or curve
    let lin = opts.unit === 'linear'
    let g = lin ? val : 10 ** (val / 20)
    let g2 = g * g
    let ch = stats.min.length
    for (let c = 0; c < ch; c++) {
      let n = stats.min[c].length
      for (let i = 0; i < n; i++) {
        let lo = stats.min[c][i] * g, hi = stats.max[c][i] * g
        stats.min[c][i] = Math.min(lo, hi)
        stats.max[c][i] = Math.max(lo, hi)
        if (stats.dc) stats.dc[c][i] *= g
        if (stats.ms) stats.ms[c][i] *= g2
        if (stats.energy) stats.energy[c][i] *= g2
      }
      if (stats.clipping) for (let i = 0; i < n; i++)
        stats.clipping[c][i] = (stats.min[c][i] <= -1 || stats.max[c][i] >= 1) ? Math.max(1, stats.clipping[c][i]) : 0
    }
  }
})
