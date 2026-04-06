/** Per-block DC offset (mean sample value). */
const dc = () => (channels) => channels.map(ch => {
  let sum = 0
  for (let i = 0; i < ch.length; i++) sum += ch[i]
  return sum / ch.length
})

export default (audio) => {
  audio.stat.dc = dc

  audio.fn.dc = async function(offset, duration) {
    let { stats, channels, from, to } = await this.query(offset, duration)
    let sum = 0, n = 0
    for (let c = 0; c < channels; c++)
      for (let i = from; i < Math.min(to, stats.dc[c].length); i++) { sum += stats.dc[c][i]; n++ }
    return n ? sum / n : 0
  }
}
