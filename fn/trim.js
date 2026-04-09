import audio from '../core.js'

export function autoThreshold(energies) {
  let vals = energies.filter(e => e > 0)
  if (!vals.length) return -40
  vals.sort((a, b) => a - b)
  let floor = vals[Math.floor(vals.length * 0.1)]
  return Math.max(-80, Math.min(-20, 10 * Math.log10(floor) + 12))
}

const trim = (chs, ctx) => {
  let threshold = ctx.args[0]
  if (threshold == null) {
    let energies = []
    for (let c = 0; c < chs.length; c++)
      for (let off = 0; off < chs[c].length; off += audio.BLOCK_SIZE) {
        let end = Math.min(off + audio.BLOCK_SIZE, chs[c].length), sum = 0
        for (let i = off; i < end; i++) sum += chs[c][i] * chs[c][i]
        energies.push(sum / (end - off))
      }
    threshold = autoThreshold(energies)
  }
  let thresh = 10 ** (threshold / 20)

  let len = chs[0].length, s = 0, e = len - 1
  for (; s < len; s++) { let loud = false; for (let c = 0; c < chs.length; c++) if (Math.abs(chs[c][s]) > thresh) { loud = true; break }; if (loud) break }
  for (; e >= s; e--) { let loud = false; for (let c = 0; c < chs.length; c++) if (Math.abs(chs[c][e]) > thresh) { loud = true; break }; if (loud) break }
  e++

  return s === 0 && e === len ? false : chs.map(ch => ch.slice(s, e))
}

const trimResolve = (args, { stats, sampleRate, totalDuration }) => {
  if (!stats?.min) return null
  let ch = stats.min.length, blocks = stats.min[0].length
  let threshold = args[0]
  let total = Math.round(totalDuration * sampleRate)

  if (threshold == null) {
    let energies = []
    for (let c = 0; c < ch; c++)
      for (let i = 0; i < stats.energy[c].length; i++) energies.push(stats.energy[c][i])
    threshold = autoThreshold(energies)
  }
  let thresh = 10 ** (threshold / 20)

  let s = 0, e = blocks - 1
  for (; s < blocks; s++) {
    let loud = false
    for (let c = 0; c < ch; c++)
      if (Math.max(Math.abs(stats.min[c][s]), Math.abs(stats.max[c][s])) > thresh) { loud = true; break }
    if (loud) break
  }
  for (; e >= s; e--) {
    let loud = false
    for (let c = 0; c < ch; c++)
      if (Math.max(Math.abs(stats.min[c][e]), Math.abs(stats.max[c][e])) > thresh) { loud = true; break }
    if (loud) break
  }
  e++

  if (s === 0 && e === blocks) return false
  if (s >= e) return { type: 'crop', args: [], at: 0, duration: 0 }
  let startSample = s * audio.BLOCK_SIZE
  let endSample = Math.min(e * audio.BLOCK_SIZE, total)
  return { type: 'crop', args: [], at: startSample / sampleRate, duration: (endSample - startSample) / sampleRate }
}

audio.op('trim', { process: trim, resolve: trimResolve })
