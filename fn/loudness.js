/** Integrated LUFS (BS.1770, K-weighted, gated). */
const GATE_WINDOW = 0.4, ABS_GATE = -70, REL_GATE = -10, LUFS_OFFSET = -0.691

function loudness({ stats, channels, sampleRate, from, to }) {
  let winBlocks = Math.ceil(GATE_WINDOW * sampleRate / stats.blockSize), gates = []
  for (let i = from; i < to; i += winBlocks) {
    let we = Math.min(i + winBlocks, to), sum = 0, n = 0
    for (let c = 0; c < channels; c++) for (let j = i; j < we; j++) { sum += stats.energy[c][j]; n++ }
    if (n > 0) gates.push(sum / n)
  }
  let absT = 10 ** (ABS_GATE / 10), gated = gates.filter(g => g > absT)
  if (!gated.length) return -Infinity
  let mean = gated.reduce((a, b) => a + b, 0) / gated.length
  let final = gated.filter(g => g > mean * 10 ** (REL_GATE / 10))
  if (!final.length) return -Infinity
  return LUFS_OFFSET + 10 * Math.log10(final.reduce((a, b) => a + b, 0) / final.length)
}
loudness.query = true

export default (audio) => { audio.stat('loudness', loudness) }
