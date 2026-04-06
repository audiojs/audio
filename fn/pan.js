/**
 * Pan — stereo balance control. -1 = full left, 0 = center, 1 = full right.
 * Linear attenuation — never boosts, only attenuates one channel.
 */

const pan = (chs, ctx) => {
  let val = ctx.args[0] // -1..1 or t => value
  if (chs.length < 2) return false // mono: no-op
  let sr = ctx.sampleRate, auto = typeof val === 'function'
  let s = ctx.at != null ? Math.round(ctx.at * sr) : 0
  let end = ctx.duration != null ? s + Math.round(ctx.duration * sr) : chs[0].length
  let off = (ctx.blockOffset || 0) * sr
  if (!auto) {
    let gL = val <= 0 ? 1 : 1 - val, gR = val >= 0 ? 1 : 1 + val, gains = [gL, gR]
    return chs.map((ch, c) => {
      let g = gains[c] ?? 1
      if (g === 1) return ch
      let o = new Float32Array(ch)
      for (let i = Math.max(0, s); i < Math.min(end, o.length); i++) o[i] *= g
      return o
    })
  }
  // Automation: per-sample evaluation
  let L = new Float32Array(chs[0]), R = new Float32Array(chs[1])
  for (let i = Math.max(0, s); i < Math.min(end, L.length); i++) {
    let p = val((off + i) / sr)
    L[i] *= p <= 0 ? 1 : 1 - p
    R[i] *= p >= 0 ? 1 : 1 + p
  }
  return [L, R, ...chs.slice(2)]
}

export default (audio) => { audio.op.pan = pan }
