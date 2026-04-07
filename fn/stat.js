import audio from '../core.js'
import { kWeighting } from 'audio-filter/weighting'

/** Per-block minimum amplitude. */
const min = () => (channels) => channels.map(ch => {
  let mn = Infinity
  for (let i = 0; i < ch.length; i++) if (ch[i] < mn) mn = ch[i]
  return mn
})

/** Per-block maximum amplitude. */
const max = () => (channels) => channels.map(ch => {
  let mx = -Infinity
  for (let i = 0; i < ch.length; i++) if (ch[i] > mx) mx = ch[i]
  return mx
})

/** Per-block DC offset (mean sample value). */
const dc = () => (channels) => channels.map(ch => {
  let sum = 0
  for (let i = 0; i < ch.length; i++) sum += ch[i]
  return sum / ch.length
})

/** Per-block clipping count (samples at ±1.0). */
const clip = () => (channels) => channels.map(ch => {
  let n = 0
  for (let i = 0; i < ch.length; i++) if (ch[i] >= 1 || ch[i] <= -1) n++
  return n
})

/** Per-block raw mean square energy (for RMS). */
const rms = () => (channels) => channels.map(ch => {
  let sum = 0
  for (let i = 0; i < ch.length; i++) sum += ch[i] * ch[i]
  return sum / ch.length
})

/** Per-block K-weighted mean square energy (BS.1770). Stateful — K-weighting filter carries state between blocks. */
const energy = () => {
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

audio.stat.min = min
audio.stat.max = max
audio.stat.dc = dc
audio.stat.clip = clip
audio.stat.rms = rms
audio.stat.energy = energy
