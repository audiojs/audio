// What the meters at the view's right edge read: each channel's level, RMS and peak, and its spectrum, from the
// output's samples, over the 50 ms before the playhead as it plays, around the caret, or across a selection.

// RMS and peak of each channel over samples [from, to)
export function levels(channels, from, to) {
  return channels.map(x => {
    let sum = 0, peak = 0, n = 0
    for (let i = Math.max(0, from); i < to && i < x.length; i++, n++) { const v = x[i]; sum += v * v; if (v > peak) peak = v; else if (-v > peak) peak = -v }
    return { rms: n ? Math.sqrt(sum / n) : 0, peak }
  })
}

// Power spectra of each channel, dB per bin up to Nyquist, over samples [from, to): Welch's average of Hann frames of
// `size` hopping by half, at most `frames` of them spread evenly (a long selection is sampled, not read whole). A
// full-scale sine reads 0 dB at its bin: its peak is N/4 through Hann's coherent gain of a half, so |X|² · 16/N².
export function spectra(channels, from, to, { size = 4096, frames = 16 } = {}) {
  const n = Math.max(1, Math.min(frames, Math.floor((to - from - size) / (size / 2)) + 1)), step = n > 1 ? (to - from - size) / (n - 1) : 0
  const w = hann(size), re = new Float64Array(size), im = new Float64Array(size), norm = 16 / (size * size) / n
  return channels.map(x => {
    const power = new Float64Array(size / 2 + 1)
    for (let f = 0; f < n; f++) {
      const at = Math.round(from + f * step)
      for (let i = 0; i < size; i++) { const k = at + i; re[i] = (k >= 0 && k < x.length ? x[k] : 0) * w[i]; im[i] = 0 }
      fft(re, im)
      for (let k = 0; k <= size / 2; k++) power[k] += (re[k] * re[k] + im[k] * im[k]) * norm
    }
    return Float32Array.from(power, p => 10 * Math.log10(p + 1e-20))
  })
}

const windows = new Map()
const hann = size => windows.get(size) ?? windows.set(size, Float64Array.from({ length: size }, (_, i) => .5 - .5 * Math.cos(2 * Math.PI * i / size))).get(size)

// In place, radix 2 (Cooley & Tukey 1965), size a power of two
function fft(re, im) {
  const n = re.length
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]] }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const a = -2 * Math.PI / len, wr = Math.cos(a), wi = Math.sin(a)
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0
      for (let j = 0; j < len / 2; j++) {
        const k = i + j, l = k + len / 2, tr = re[l] * cr - im[l] * ci, ti = re[l] * ci + im[l] * cr
        re[l] = re[k] - tr; im[l] = im[k] - ti; re[k] += tr; im[k] += ti
        const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t
      }
    }
  }
}
