import { kWeighting } from 'audio-filter/weighting'

const GATE_WINDOW = 0.4, ABS_GATE = -70, REL_GATE = -10, LUFS_OFFSET = -0.691
const PRESETS = { streaming: -14, podcast: -16, broadcast: -23 }

function lufsFromEnergy(energy, ch, sampleRate, blockSize) {
  let winBlocks = Math.ceil(GATE_WINDOW * sampleRate / blockSize), gates = []
  let blocks = energy[0].length
  for (let i = 0; i < blocks; i += winBlocks) {
    let we = Math.min(i + winBlocks, blocks), sum = 0, n = 0
    for (let c = 0; c < ch; c++) for (let j = i; j < we; j++) { sum += energy[c][j]; n++ }
    if (n > 0) gates.push(sum / n)
  }
  let absT = 10 ** (ABS_GATE / 10), gated = gates.filter(g => g > absT)
  if (!gated.length) return null
  let mean = gated.reduce((a, b) => a + b, 0) / gated.length
  let final = gated.filter(g => g > mean * 10 ** (REL_GATE / 10))
  if (!final.length) return null
  return LUFS_OFFSET + 10 * Math.log10(final.reduce((a, b) => a + b, 0) / final.length)
}

const normalize = (chs, ctx) => {
  let targetDb = ctx.args[0], opts = ctx.args[1]
  let mode = 'peak', sr = ctx.sampleRate
  if (typeof targetDb === 'string') {
    if (!PRESETS[targetDb]) throw new Error(`normalize: unknown preset '${targetDb}'. Use: ${Object.keys(PRESETS).join(', ')}`)
    mode = 'lufs'; targetDb = PRESETS[targetDb]
  } else {
    targetDb = targetDb ?? 0
    if (typeof opts === 'string') mode = opts
    else if (opts?.mode) mode = opts.mode
  }

  let gain
  if (mode === 'lufs') {
    let kChs = chs.map(ch => { let k = new Float32Array(ch); kWeighting(k, { fs: sr }); return k })
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
      for (let i = 0; i < chs[c].length; i++) { let v = Math.abs(chs[c][i]); if (v > peak) peak = v }
    if (!peak) return false
    gain = targetDb - 20 * Math.log10(peak)
  }
  let f = 10 ** (gain / 20)
  return chs.map(ch => { let o = new Float32Array(ch); for (let i = 0; i < o.length; i++) o[i] *= f; return o })
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
    if (typeof opts === 'string') mode = opts
    else if (opts?.mode) mode = opts.mode
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
