// What the meters at the view's right edge read: each channel's level, RMS and peak, and its spectrum, from the
// output's samples, over the 50 ms before the playhead as it plays, around the caret, or across a selection; and the
// cycle the mark in the bar draws as it plays.

// RMS and peak of each channel over samples [from, to)
export function levels(channels, from, to) {
  return channels.map(x => {
    let sum = 0, peak = 0, n = 0
    for (let i = Math.max(0, from); i < to && i < x.length; i++, n++) { const v = x[i]; sum += v * v; if (v > peak) peak = v; else if (-v > peak) peak = -v }
    return { rms: n ? Math.sqrt(sum / n) : 0, peak }
  })
}

// The levels as a peak meter shows them as sound goes by, each channel's from the last frame's (`was`, `dt` s before):
// a peak rises at once and falls back 20 dB in 1.7 s, a digital peak meter's return (IEC 60268-18); its mark, `hold`,
// stays at the highest it reached HOLD s, then falls as fast, `held` s it has stayed. None before, the levels as read
const HOLD = 1.5
export function ballistics(levels, was, dt) {
  const fall = s => 10 ** (-Math.max(0, s) / 1.7)
  return levels.map((m, i) => {
    const w = was?.[i]
    if (!w) return { ...m, hold: m.peak, held: 0 }
    const peak = Math.max(m.peak, w.peak * fall(dt)), up = peak >= w.hold, held = up ? 0 : w.held + dt
    return { rms: m.rms, peak, hold: up ? peak : Math.max(peak, w.hold * fall(Math.min(dt, held - HOLD))), held }
  })
}

// Power spectra of each channel, dB per bin up to Nyquist, over samples [from, to): Welch's average of Hann frames of
// `size` hopping by half, at most `frames` of them spread evenly (a long selection is sampled, not read whole). A
// full-scale sine reads 0 dB at its bin: its peak is N/4 through Hann's coherent gain of a half, so |X|² · 16/N².
export function spectra(channels, from, to, { size = 4096, frames = 16 } = {}) {
  const n = Math.max(1, Math.min(frames, Math.floor((to - from - size) / (size / 2)) + 1)), step = n > 1 ? (to - from - size) / (n - 1) : 0
  const w = hann(size), re = new Float64Array(size), im = new Float64Array(size), norm = 16 / (size * size) / n
  return channels.map(x => {
    const power = new Float64Array(size / 2 + 1), db = new Float32Array(size / 2 + 1)
    for (let f = 0; f < n; f++) {
      const at = Math.round(from + f * step)
      for (let i = 0; i < size; i++) { const k = at + i; re[i] = (k >= 0 && k < x.length ? x[k] : 0) * w[i]; im[i] = 0 }
      fft(re, im)
      for (let k = 0; k <= size / 2; k++) power[k] += (re[k] * re[k] + im[k] * im[k]) * norm
    }
    // a loop, not Float32Array.from(power, …): that iterates, an object and a heap number a bin, 2049 a frame it plays
    for (let k = 0; k < db.length; k++) db[k] = 10 * Math.log10(power[k] + 1e-20)
    return db
  })
}

// What the mark in the bar draws of a sound: `wave`, one cycle of it, and `hz`, its pitch, kept between frames so a
// pitch that holds is not lost to the next frame's doubt
export const trace = (points = 64) => ({ wave: new Float32Array(points), hz: 0 })

// One cycle of what sounds at sample `at`, for the eye, as the logo's signals stand: a period sampled evenly from its
// start, falling through zero at mid-period, into t.wave; the pitch it is of, into t.hz. The channels summed and
// averaged down to about 16 kHz. The period is a peak of the normalized autocorrelation, 2 kHz to 50 Hz: the one the
// last frame had, if the sound still repeats there nearly as well as anywhere (within 80% of the best peak), else the
// shortest within 90% of the best; no peak of half a correlation (noise, a slow drift, what only ever falls off from
// lag 0) keeps the last pitch and shows 12 ms. A sample that is no number counts for silence.
// The cycle is set about the falling zero crossing nearest `at`; softened round by [1 2 1] / 4 24 times over, near a
// Gaussian 3.5 points wide (of the bar's 64), so its first few harmonics stay and a chord's or a hiss's fine wiggle
// goes; peak 1. Eased a share `ease` of the way into t.wave: a cycle that repeats holds its shape, what never repeats
// settles to a slow stir.
export function cycle(channels, at, rate, t, ease = .3) {
  const d = Math.max(1, Math.round(rate / 16000)), r = rate / d, lo = Math.floor(r / 2000), hi = Math.ceil(r / 50), n = 3 * hi, m = n - hi
  // two zeros past the end, where the longest lag reads: a read past it would leave the correlation below unoptimized,
  // each product a heap number, the page collecting garbage every frame it plays
  const x = new Float32Array(n + 2), from = Math.round(at) - (n >> 1) * d
  let mean = 0
  for (let k = 0; k < n; k++) {
    let sum = 0
    for (const ch of channels) for (let i = from + k * d, j = 0; j < d; i++, j++) if (i >= 0 && i < ch.length && Number.isFinite(ch[i])) sum += ch[i]
    mean += x[k] = sum / d
  }
  mean /= n
  for (let k = 0; k < n; k++) x[k] -= mean
  let e0 = 0
  for (let k = 0; k < m; k++) e0 += x[k] * x[k]
  const corr = new Float32Array(hi + 2)
  for (let l = lo - 1; l <= hi + 1; l++) {
    let xy = 0, yy = 0
    for (let k = 0; k < m; k++) { const y = x[k + l]; xy += x[k] * y; yy += y * y }
    corr[l] = xy / Math.sqrt(e0 * yy + 1e-30)
  }
  const peaked = l => l >= lo && l <= hi && corr[l] >= corr[l - 1] && corr[l] >= corr[l + 1]
  let best = 0
  for (let l = lo; l <= hi; l++) if (peaked(l) && corr[l] > best) best = corr[l]
  // a lag's peak, between the samples
  const refine = l => { const a = corr[l - 1], b = corr[l], c = corr[l + 1], bend = a - 2 * b + c; return l + (bend < 0 ? (a - c) / (2 * bend) : 0) }
  let period = t.hz ? r / t.hz : .012 * r
  if (best > .5) {
    let pick = 0
    // the last frame's pitch, within a semitone and a half either way
    if (t.hz) for (let l = Math.floor(r / t.hz / 1.09); l <= Math.ceil(r / t.hz * 1.09); l++) if (peaked(l) && corr[l] >= .8 * best && (!pick || corr[l] > corr[pick])) pick = l
    for (let l = lo; !pick && l <= hi; l++) if (corr[l] >= .9 * best && peaked(l)) pick = l
    period = refine(pick)
    t.hz = r / period
  }
  // off the axis by what a period about the middle holds, which the stretch's mean, not whole periods, left
  const mid = n >> 1, whole = Math.round(period)
  let offset = 0
  for (let k = mid - (whole >> 1); k < mid - (whole >> 1) + whole; k++) offset += x[k]
  for (let k = 0; k < n; k++) x[k] -= offset / whole
  const falls = k => k >= 0 && k + 1 < n && x[k] >= 0 && x[k + 1] < 0
  let centre = mid
  for (let off = 0; off < period; off++) {
    const k = falls(mid + off) ? mid + off : falls(mid - off - 1) ? mid - off - 1 : -1
    if (k >= 0) { centre = k + x[k] / (x[k] - x[k + 1]); break }
  }
  const read = p => { const i = Math.max(0, Math.min(n - 2, Math.floor(p))), f = p - i; return x[i] + (x[i + 1] - x[i]) * f }
  const P = t.wave.length, one = Float32Array.from(t.wave, (_, j) => read(centre + period * (j / P - .5)))
  if (!one.every(Number.isFinite)) return t
  for (let pass = 0; pass < 24; pass++) for (let j = 0, first = one[0], before = one[P - 1]; j < P; j++) {
    const here = one[j]
    one[j] = (before + 2 * here + (j + 1 < P ? one[j + 1] : first)) / 4
    before = here
  }
  const peak = one.reduce((p, v) => Math.max(p, Math.abs(v)), 1e-4)
  for (let j = 0; j < P; j++) t.wave[j] += (one[j] / peak - t.wave[j]) * ease
  return t
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
    if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t }
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
