import { BLOCK_SIZE } from './plan.js'

/** Auto-detect threshold from energy data (bottom 10th percentile + 12dB). */
function autoThreshold(energies) {
  let vals = energies.filter(e => e > 0)
  if (!vals.length) return -40
  vals.sort((a, b) => a - b)
  let floor = vals[Math.floor(vals.length * 0.1)]
  return Math.max(-80, Math.min(-20, 10 * Math.log10(floor) + 12))
}

let trim = (threshold) => (chs) => {
  let thresh
  if (threshold == null) {
    let energies = []
    for (let c = 0; c < chs.length; c++)
      for (let off = 0; off < chs[c].length; off += BLOCK_SIZE) {
        let end = Math.min(off + BLOCK_SIZE, chs[c].length), sum = 0
        for (let i = off; i < end; i++) sum += chs[c][i] * chs[c][i]
        energies.push(sum / (end - off))
      }
    threshold = autoThreshold(energies)
  }
  thresh = 10 ** (threshold / 20)

  let len = chs[0].length, s = 0, e = len - 1
  for (; s < len; s++) { let loud = false; for (let c = 0; c < chs.length; c++) if (Math.abs(chs[c][s]) > thresh) { loud = true; break }; if (loud) break }
  for (; e >= s; e--) { let loud = false; for (let c = 0; c < chs.length; c++) if (Math.abs(chs[c][e]) > thresh) { loud = true; break }; if (loud) break }
  e++

  return s === 0 && e === len ? false : chs.map(ch => ch.slice(s, e))
}

trim.plan = false

/** Resolve from index — block-level precision, avoids full render when index is clean. */
trim.resolve = ([threshold], { index, sampleRate, length }) => {
  if (!index?.min) return null
  let ch = index.min.length, blocks = index.min[0].length

  // Auto-detect threshold from index energy
  if (threshold == null) {
    let energies = []
    for (let c = 0; c < ch; c++)
      for (let i = 0; i < index.energy[c].length; i++) energies.push(index.energy[c][i])
    threshold = autoThreshold(energies)
  }
  let thresh = 10 ** (threshold / 20)

  let s = 0, e = blocks - 1
  for (; s < blocks; s++) {
    let loud = false
    for (let c = 0; c < ch; c++)
      if (Math.max(Math.abs(index.min[c][s]), Math.abs(index.max[c][s])) > thresh) { loud = true; break }
    if (loud) break
  }
  for (; e >= s; e--) {
    let loud = false
    for (let c = 0; c < ch; c++)
      if (Math.max(Math.abs(index.min[c][e]), Math.abs(index.max[c][e])) > thresh) { loud = true; break }
    if (loud) break
  }
  e++

  if (s === 0 && e === blocks) return false
  if (s >= e) return { type: 'crop', args: [], offset: 0, duration: 0 }
  let startSample = s * BLOCK_SIZE
  let endSample = Math.min(e * BLOCK_SIZE, length)
  return { type: 'crop', args: [], offset: startSample / sampleRate, duration: (endSample - startSample) / sampleRate }
}

export default trim
