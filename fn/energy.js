import { kWeighting } from 'audio-filter/weighting'

/** Per-block K-weighted mean square energy (BS.1770). Stateful — K-weighting filter carries state between blocks. */
export default () => {
  let kState = null
  return (channels, ctx) => {
    if (!kState) kState = channels.map(() => ({ fs: ctx.sampleRate }))
    return channels.map((ch, c) => {
      let k = new Float32Array(ch)
      kWeighting(k, kState[c])
      let sum = 0
      for (let i = 0; i < k.length; i++) sum += k[i] * k[i]
      return sum / k.length
    })
  }
}
