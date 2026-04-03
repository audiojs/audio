export default (audio) => {
  audio.fn.db = async function(offset, duration) {
    let { stats, channels, from, to } = await this.query(offset, duration)
    let peak = 0
    for (let c = 0; c < channels; c++)
      for (let i = from; i < Math.min(to, stats.min[c].length); i++)
        peak = Math.max(peak, Math.abs(stats.min[c][i]), Math.abs(stats.max[c][i]))
    return peak > 0 ? 20 * Math.log10(peak) : -Infinity
  }
}
