/** Per-block clipping count (samples at ±1.0). */
const clip = () => (channels) => channels.map(ch => {
  let n = 0
  for (let i = 0; i < ch.length; i++) if (ch[i] >= 1 || ch[i] <= -1) n++
  return n
})

export default (audio) => {
  audio.stat.clip = clip

  audio.fn.clip = async function(offset, duration) {
    let { stats, channels, from, to } = await this.query(offset, duration)
    let total = 0
    for (let c = 0; c < channels; c++)
      for (let i = from; i < Math.min(to, stats.clip[c].length); i++) total += stats.clip[c][i]
    return total
  }
}
