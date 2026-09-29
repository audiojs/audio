import { fft } from 'fourier-transform'
import scales from './scale.js'

// A reassigned spectrogram (Kodera, Gendrin & de Villedary 1976; Auger & Flandrin 1995): each STFT cell's energy moves
// to the time and frequency its phase says it came from, so steady tones draw as thin lines and hits as sharp edges.
// Three FFTs a frame: with the Hann window h, its derivative dh, and the time-weighted window t·h. For a cell X at bin k,
//   frequency  k̂ = k − N / 2π · Im(X_dh · X̄) / |X|²      time  t̂ = t + Re(X_th · X̄) / |X|²  (samples)
// Returns power per column × row for `columns` frames over samples [from, to), rows spaced evenly on the `scale`
// (scale.js: log, mel or lin) from `low` to `high` Hz: a full-scale sine sums to about 1 in its row. Rows, not bins,
// keep the reassigned frequency's sub-bin precision where a log or mel axis stretches the low bins. `cols` computes only
// those frames, adding them to `out`: frames computed in turns sum to the frames computed at once.
const kernels = new Map()
function kernel(size) {
  if (kernels.has(size)) return kernels.get(size)
  const h = new Float64Array(size), dh = new Float64Array(size), th = new Float64Array(size)
  for (let n = 0; n < size; n++) {
    const phase = 2 * Math.PI * n / size
    h[n] = .5 - .5 * Math.cos(phase)
    dh[n] = Math.PI / size * Math.sin(phase)
    th[n] = (n - size / 2) * h[n]
  }
  // Power of a unit sine: (N/4)² at its bin with Hann's coherent gain of 1/2; its main lobe holds 1.5× that (ENBW).
  const gain = 1 / (1.5 * (size / 4) ** 2)
  const k = { h, dh, th, gain }
  kernels.set(size, k)
  return k
}

export default function reassign(x, { from = 0, to = x.length, columns, size = 2048, rows = 512, scale = 'log', low = scales[scale].low, high, sampleRate = 44100, cols = [0, columns], out = new Float32Array(columns * rows) }) {
  const { h, dh, th, gain } = kernel(size), bins = size / 2, half = bins + 1
  const step = (to - from) / columns
  // bin (fractional) → row; below low, or reassigned below 0 Hz, it is out of range
  const hz = sampleRate / size, top = high ?? sampleRate / 2, { at } = scales[scale]
  const row = f => Math.floor(at(f * hz, low, top) * rows)
  const frame = [new Float64Array(size), new Float64Array(size), new Float64Array(size)]
  const X = [[new Float64Array(half), new Float64Array(half)], [new Float64Array(half), new Float64Array(half)], [new Float64Array(half), new Float64Array(half)]]
  for (let col = cols[0]; col < cols[1]; col++) {
    const center = from + (col + .5) * step, start = Math.round(center) - bins
    for (let i = 0; i < size; i++) {
      const k = start + i, v = k >= 0 && k < x.length ? x[k] : 0
      frame[0][i] = v * h[i]; frame[1][i] = v * dh[i]; frame[2][i] = v * th[i]
    }
    fft(frame[0], X[0]); fft(frame[1], X[1]); fft(frame[2], X[2])
    const [re, im] = X[0], [dre, dim] = X[1], [tre, tim] = X[2]
    for (let k = 0; k < bins; k++) {
      const power = re[k] * re[k] + im[k] * im[k]
      if (power < 1e-12) continue
      // X_dh · X̄ and X_th · X̄
      const f = k - bins / Math.PI * (dim[k] * re[k] - dre[k] * im[k]) / power
      const t = start + bins + (tre[k] * re[k] + tim[k] * im[k]) / power
      const c = Math.floor((t - from) / step), r = row(f)
      if (c < 0 || c >= columns || !(r >= 0 && r < rows)) continue
      out[c * rows + r] += power * gain
    }
  }
  return out
}
