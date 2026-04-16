import { opRange } from '../plan.js'

const gain = (input, output, ctx) => {
  let lin = ctx.unit === 'linear', val = ctx.value ?? (lin ? 1 : 0)
  let len = input[0].length
  let [s, end] = opRange(ctx, len)
  let auto = typeof val === 'function', f = auto ? 0 : lin ? val : 10 ** (val / 20)
  let off = (ctx.blockOffset || 0) * ctx.sampleRate
  let toMul = lin ? v => v : v => 10 ** (v / 20)
  s = Math.max(0, Math.min(s, len)); end = Math.max(s, Math.min(end, len))
  // Smooth gain change across block when value is patched (progressive normalize)
  let pf = ctx._pg, ramp = !auto && pf != null && pf !== f
  ctx._pg = f
  for (let c = 0; c < input.length; c++) {
    let inp = input[c], out = output[c]
    if (s > 0) out.set(inp.subarray(0, s))
    if (ramp) {
      let n = end - s
      for (let i = s; i < end; i++) out[i] = inp[i] * (pf + (f - pf) * (i - s) / n)
    } else {
      for (let i = s; i < end; i++) out[i] = inp[i] * (auto ? toMul(val((off + i) / ctx.sampleRate)) : f)
    }
    if (end < len) out.set(inp.subarray(end), end)
  }
}

import audio from '../core.js'
audio.op('gain', {
  params: ['value'],
  process: gain,
  deriveStats: (stats, opts) => {
    let val = opts.value ?? 0
    if (typeof val === 'function') return false
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
