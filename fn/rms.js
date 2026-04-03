/** RMS level from K-weighted energy. */
function rms({ stats, channels, from, to }) {
  let sum = 0, n = 0
  for (let c = 0; c < channels; c++)
    for (let i = from; i < Math.min(to, stats.energy[c].length); i++) { sum += stats.energy[c][i]; n++ }
  return n ? Math.sqrt(sum / n) : 0
}
rms.query = true
export default rms
