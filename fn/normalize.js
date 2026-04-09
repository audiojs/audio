import { dcOffsets, peakDb, rmsDb, lufsDb } from './loudness.js'
import audio from '../core.js'

const PRESETS = { streaming: -14, podcast: -16, broadcast: -23 }


/** DC removal op — subtracts per-channel offset. */
audio.op('dc', (chs, ctx) => {
  let offsets = ctx.args[0]  // number or number[]
  if (typeof offsets === 'number') offsets = [offsets]
  for (let c = 0; c < chs.length; c++) {
    let d = offsets[c % offsets.length] || 0
    if (Math.abs(d) < 1e-10) continue
    for (let i = 0; i < chs[c].length; i++) chs[c][i] -= d
  }
  return chs
})

/** Hard-clip samples to ±limit (linear). Used by ceiling normalization. */
audio.op('clip', (chs, ctx) => {
  let limit = ctx.args[0]
  for (let c = 0; c < chs.length; c++)
    for (let i = 0; i < chs[c].length; i++)
      chs[c][i] = Math.max(-limit, Math.min(limit, chs[c][i]))
  return chs
})

audio.op('normalize', {
  process: () => false,
  resolve: (args, ctx) => {
    let { stats, sampleRate } = ctx
    if (!stats?.min) return null

    let arg = args[0]
    let mode = typeof arg === 'string' ? 'lufs' : ctx.mode || 'peak'
    let targetDb = PRESETS[arg] ?? (typeof arg === 'number' ? arg : ctx.target ?? 0)
    let totalCh = stats.min.length
    let chs = ctx.channel != null ? (Array.isArray(ctx.channel) ? ctx.channel : [ctx.channel]) : Array.from({ length: totalCh }, (_, i) => i)

    let dcOff = new Float64Array(totalCh)
    if (ctx.dc !== false && stats.dc) dcOff = dcOffsets(stats, chs)
    let hasDc = chs.some(c => Math.abs(dcOff[c]) > 1e-10)

    let levelDb
    if (mode === 'lufs') levelDb = lufsDb(stats, chs, sampleRate)
    else if (mode === 'rms') levelDb = rmsDb(stats, chs, dcOff)
    else levelDb = peakDb(stats, chs, dcOff)

    if (levelDb == null) return mode === 'rms' ? null : false

    let edits = []
    if (hasDc) edits.push({ type: 'dc', args: [chs.map(c => dcOff[c])] })

    // Ceiling mode: normalize peak then clip at ceiling level
    if (ctx.ceiling != null) {
      let peakLevel = peakDb(stats, chs, dcOff)
      if (peakLevel == null) return false
      edits.push({ type: 'gain', args: [targetDb - peakLevel] })
      edits.push({ type: 'clip', args: [10 ** (ctx.ceiling / 20)] })
    } else {
      edits.push({ type: 'gain', args: [targetDb - levelDb] })
    }

    return edits.length === 1 ? edits[0] : edits
  },
  call(std, arg) {
    if (typeof arg === 'string' || typeof arg === 'number') return std.call(this, arg)
    if (arg != null && typeof arg === 'object') {
      let { target, mode, at, duration, channel, ...extra } = arg
      return std.call(this, target, { mode, at, duration, channel, ...extra })
    }
    return std.call(this)
  }
})
