import { dcOffsets, peakDb, rmsDb, lufsDb } from '../stats.js'
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

function normalizeEdit(arg) {
  let edit = { type: 'normalize', args: [] }

  if (typeof arg === 'string' || typeof arg === 'number') {
    edit.args = [arg]
  } else if (arg != null && typeof arg === 'object') {
    let { target, mode, at, duration, channel, ...extra } = arg
    if (target != null) edit.target = target
    if (mode) edit.mode = mode
    if (at != null) edit.at = at
    if (duration != null) edit.duration = duration
    if (channel != null) edit.channel = channel
    Object.assign(edit, extra)
  }

  return edit
}

audio.op('normalize', () => { }, {
  lower: (args, ctx) => {
    let { stats, sampleRate } = ctx
    if (!stats?.min) return null
    if (ctx.ceiling != null) return null  // ceiling needs per-sample clipping — can't do from stats

    let arg = args[0]
    let mode = typeof arg === 'string' ? 'lufs' : ctx.mode || 'peak'
    let targetDb = PRESETS[arg] ?? (typeof arg === 'number' ? arg : ctx.target ?? 0)
    let totalCh = stats.min.length
    let chs = ctx.channel != null ? [ctx.channel] : Array.from({ length: totalCh }, (_, i) => i)

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
    edits.push({ type: 'gain', args: [targetDb - levelDb] })
    return edits.length === 1 ? edits[0] : edits
  }
})

// wrap to desugar normalize args (string preset, number target, options object)
audio.fn.normalize = Object.assign(
  function(arg) { return this.run(normalizeEdit(arg)) },
  audio.fn.normalize
)
