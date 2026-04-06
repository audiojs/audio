import { kWeighting } from 'audio-filter/weighting'
import { lufsFromEnergy } from '../stats.js'

const PRESETS = { streaming: -14, podcast: -16, broadcast: -23 }
const GATE_WINDOW = 0.4, ABS_GATE = -70, REL_GATE = -10, LUFS_OFFSET = -0.691

const normalize = (chs, ctx) => {
  let targetDb = ctx.args[0], opts = ctx.args[1]
  let mode = 'peak', sr = ctx.sampleRate
  if (typeof targetDb === 'string') {
    if (!PRESETS[targetDb]) throw new Error(`normalize: unknown preset '${targetDb}'. Use: ${Object.keys(PRESETS).join(', ')}`)
    mode = 'lufs'; targetDb = PRESETS[targetDb]
  } else {
    targetDb = targetDb ?? 0
    if (typeof opts === 'string') { mode = opts }
    else if (opts?.mode) { mode = opts.mode }
  }
  let s = ctx.at != null ? Math.round(ctx.at * sr) : 0
  let end = ctx.duration != null ? s + Math.round(ctx.duration * sr) : chs[0].length

  // Measure only the target range
  let gain
  if (mode === 'lufs') {
    let kChs = chs.map(ch => { let k = new Float32Array(ch.subarray(s, end)); kWeighting(k, { fs: sr }); return k })
    let winSamples = Math.round(GATE_WINDOW * sr), gates = []
    for (let off = 0; off + winSamples <= kChs[0].length; off += winSamples) {
      let sum = 0
      for (let c = 0; c < kChs.length; c++)
        for (let i = off; i < off + winSamples; i++) { let v = kChs[c][i]; sum += v * v }
      gates.push(sum / (winSamples * kChs.length))
    }
    let absT = 10 ** (ABS_GATE / 10), gated = gates.filter(g => g > absT)
    if (!gated.length) return false
    let mean = gated.reduce((a, b) => a + b, 0) / gated.length
    let final = gated.filter(g => g > mean * 10 ** (REL_GATE / 10))
    if (!final.length) return false
    let lufs = LUFS_OFFSET + 10 * Math.log10(final.reduce((a, b) => a + b, 0) / final.length)
    gain = targetDb - lufs
  } else {
    let peak = 0
    for (let c = 0; c < chs.length; c++)
      for (let i = s; i < Math.min(end, chs[c].length); i++) { let v = Math.abs(chs[c][i]); if (v > peak) peak = v }
    if (!peak) return false
    gain = targetDb - 20 * Math.log10(peak)
  }
  // Apply gain only to the target range
  let f = 10 ** (gain / 20)
  return chs.map(ch => {
    let o = new Float32Array(ch)
    for (let i = s; i < Math.min(end, o.length); i++) o[i] *= f
    return o
  })
}

normalize.plan = false

normalize.resolve = (args, ctx) => {
  let { stats, sampleRate } = ctx
  if (!stats?.min) return null
  let targetDb, mode = 'peak'
  if (typeof args[0] === 'string') {
    if (!PRESETS[args[0]]) return null
    mode = 'lufs'; targetDb = PRESETS[args[0]]
  } else {
    targetDb = args[0] ?? 0
    let opts = args[1]
    if (typeof opts === 'string') { mode = opts }
    else if (opts?.mode) { mode = opts.mode }
  }
  let ch = stats.min.length, gainDb
  if (mode === 'lufs') {
    let lufs = lufsFromEnergy(stats.energy, ch, sampleRate, stats.blockSize)
    if (lufs == null) return false
    gainDb = targetDb - lufs
  } else {
    let peak = 0
    for (let c = 0; c < ch; c++)
      for (let i = 0; i < stats.min[c].length; i++)
        peak = Math.max(peak, Math.abs(stats.min[c][i]), Math.abs(stats.max[c][i]))
    if (!peak) return false
    gainDb = targetDb - 20 * Math.log10(peak)
  }
  return { type: 'gain', args: [gainDb] }
}

export default (audio) => { audio.op.normalize = normalize }
