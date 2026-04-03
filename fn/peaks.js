/** Downsampled min/max peaks for visualization. */
function peaks({ stats, channels, from, to }, count, opts) {
  let bpp = (to - from) / count

  function scan(src, c, cmp, zero) {
    let out = new Float32Array(count)
    for (let i = 0; i < count; i++) {
      let a = from + Math.floor(i * bpp), b = Math.min(from + Math.floor((i + 1) * bpp), to)
      if (b <= a) b = a + 1
      let v = zero
      for (let j = a; j < b; j++) if (cmp(src[c][j], v)) v = src[c][j]
      out[i] = v === zero ? 0 : v
    }
    return out
  }

  let lt = (a, b) => a < b, gt = (a, b) => a > b
  if (opts?.channels) {
    return {
      min: Array.from({ length: channels }, (_, c) => scan(stats.min, c, lt, Infinity)),
      max: Array.from({ length: channels }, (_, c) => scan(stats.max, c, gt, -Infinity))
    }
  }
  let cS = opts?.channel ?? 0, cE = opts?.channel != null ? cS + 1 : channels
  let outMin = new Float32Array(count), outMax = new Float32Array(count)
  for (let i = 0; i < count; i++) {
    let a = from + Math.floor(i * bpp), b = Math.min(from + Math.floor((i + 1) * bpp), to)
    if (b <= a) b = a + 1
    let mn = Infinity, mx = -Infinity
    for (let c = cS; c < cE; c++) for (let j = a; j < b; j++) {
      if (stats.min[c][j] < mn) mn = stats.min[c][j]; if (stats.max[c][j] > mx) mx = stats.max[c][j]
    }
    outMin[i] = mn === Infinity ? 0 : mn; outMax[i] = mx === -Infinity ? 0 : mx
  }
  return { min: outMin, max: outMax }
}
peaks.query = true
peaks.args = 1  // count comes before offset/duration
export default peaks
