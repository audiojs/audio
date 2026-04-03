let remix = (channels) => (chs) => {
  let n = chs.length, m = channels
  if (n === m) return false
  if (m < n) {
    // Downmix: average all channels
    let out = new Float32Array(chs[0].length)
    for (let c = 0; c < n; c++)
      for (let i = 0; i < out.length; i++) out[i] += chs[c][i]
    let inv = 1 / n
    for (let i = 0; i < out.length; i++) out[i] *= inv
    return Array.from({ length: m }, () => new Float32Array(out))
  }
  // Upmix: replicate channels cyclically
  return Array.from({ length: m }, (_, c) => new Float32Array(chs[c % n]))
}

remix.ch = (_, args) => args[0]

export default remix
