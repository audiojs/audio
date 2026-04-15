import { dcOffsets, peakDb, rmsDb, lufsDb } from './loudness.js'
import audio from '../core.js'

const PRESETS = { streaming: -14, podcast: -16, broadcast: -23 }


/** DC removal — subtracts per-channel offset. Internal to normalize. */
audio.op('dc', {
  hidden: true,
  params: ['shift'],
  process: (input, output, ctx) => {
    let shift = ctx.shift
    if (typeof shift === 'number') shift = [shift]
    let prev = ctx._pd
    ctx._pd = shift.slice ? shift.slice() : shift
    for (let c = 0; c < input.length; c++) {
      let d = shift[c % shift.length] || 0
      let pd = prev ? (prev[c % prev.length] || 0) : d
      let inp = input[c], out = output[c], len = inp.length
      if (Math.abs(d) < 1e-10 && Math.abs(pd) < 1e-10) { out.set(inp); continue }
      if (pd !== d) {
        for (let i = 0; i < len; i++) out[i] = inp[i] - (pd + (d - pd) * i / len)
      } else {
        for (let i = 0; i < len; i++) out[i] = inp[i] - d
      }
    }
  },
  deriveStats: (stats, opts) => {
    let shift = opts.shift
    if (typeof shift === 'number') shift = [shift]
    let ch = stats.min.length
    for (let c = 0; c < ch; c++) {
      let d = shift[c % shift.length] || 0
      if (Math.abs(d) < 1e-10) continue
      let n = stats.min[c].length
      for (let i = 0; i < n; i++) {
        // E[(x-d)²] = E[x²] - 2d·E[x] + d²
        if (stats.rms) stats.rms[c][i] = stats.rms[c][i] - 2 * d * stats.dc[c][i] + d * d
        stats.min[c][i] -= d
        stats.max[c][i] -= d
        if (stats.dc) stats.dc[c][i] -= d
      }
      if (stats.clipping) for (let i = 0; i < n; i++)
        stats.clipping[c][i] = (stats.min[c][i] <= -1 || stats.max[c][i] >= 1) ? Math.max(1, stats.clipping[c][i]) : 0
    }
    // energy: k-weighting high-passes, DC offset has no effect
  }
})

/** Clamp samples to ±limit (linear). Internal to normalize. */
audio.op('clamp', {
  hidden: true,
  pointwise: true,
  params: ['limit'],
  process: (input, output, ctx) => {
    let limit = ctx.limit
    for (let c = 0; c < input.length; c++)
      for (let i = 0; i < input[c].length; i++)
        output[c][i] = Math.max(-limit, Math.min(limit, input[c][i]))
  }
})

audio.op('normalize', {
  params: ['target'],
  streamable: true,
  process: (input, output) => { for (let c = 0; c < input.length; c++) output[c].set(input[c]) },
  resolve: (ctx) => {
    let { stats, sampleRate } = ctx
    if (!stats?.min) return null
    // Need minimum ~0.4s of blocks for stable LUFS gating
    if (!ctx.final) {
      let blocks = stats.min[0]?.length || 0
      let minBlocks = Math.ceil(0.4 * sampleRate / (stats.blockSize || 1024))
      if (blocks < minBlocks) return null
    }

    let target = ctx.target
    let mode = typeof target === 'string' ? 'lufs' : ctx.mode || 'peak'
    let targetDb = PRESETS[target] ?? (typeof target === 'number' ? target : 0)

    // For LUFS target profiles, default to -1dBFS ceiling to prevent massive clipping
    let ceiling = ctx.ceiling
    if (ceiling == null && typeof target === 'string') ceiling = -1

    let totalCh = stats.min.length
    let chs = ctx.channel != null ? (Array.isArray(ctx.channel) ? ctx.channel : [ctx.channel]) : Array.from({ length: totalCh }, (_, i) => i)

    let dcOff = new Float64Array(totalCh)
    if (ctx.dc !== false && stats.dc) dcOff = dcOffsets(stats, chs)
    let hasDc = chs.some(c => Math.abs(dcOff[c]) > 1e-10)

    let levelDb
    if (mode === 'lufs') levelDb = lufsDb(stats, chs, sampleRate)
    else if (mode === 'rms') levelDb = rmsDb(stats, chs, dcOff)
    else levelDb = peakDb(stats, chs, dcOff)

    if (levelDb == null) return false

    let edits = []
    if (hasDc) edits.push(['dc', { shift: chs.map(c => dcOff[c]) }])

    // Ceiling mode: normalize peak then clip at ceiling level
    if (ceiling != null) {
      let peakLevel = peakDb(stats, chs, dcOff)
      if (peakLevel == null) return false
      edits.push(['gain', { value: targetDb - levelDb }])
      edits.push(['clamp', { limit: 10 ** (ceiling / 20) }])
    } else {
      edits.push(['gain', { value: targetDb - levelDb }])
    }

    return edits.length === 1 ? edits[0] : edits
  }
})
