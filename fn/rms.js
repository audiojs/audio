export default (audio) => {
  audio.fn.rms = async function(offset, duration) {
    let { stats, channels, from, to } = await this.query(offset, duration)
    let sum = 0, n = 0
    for (let c = 0; c < channels; c++)
      for (let i = from; i < Math.min(to, stats.energy[c].length); i++) { sum += stats.energy[c][i]; n++ }
    return n ? Math.sqrt(sum / n) : 0
  }
}
