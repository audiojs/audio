/**
 * Canonical signal generators shared by test suites.
 * Deterministic (seeded noise) so reference values stay reproducible.
 */

export const SR = 44100

/** Sine tone buffer — clean audio (no DC clicks/pops). */
export function tone(freq, dur, amp = 0.5, sr = SR) {
  let n = Math.round(dur * sr), d = new Float32Array(n)
  for (let i = 0; i < n; i++) d[i] = amp * Math.sin(2 * Math.PI * freq * i / sr)
  return d
}

/** Exponential sine sweep f0→f1 (Farina ESS) — impulse/RT measurement workhorse. */
export function sweep(f0, f1, dur, amp = 0.5, sr = SR) {
  let n = Math.round(dur * sr), d = new Float32Array(n)
  let L = dur / Math.log(f1 / f0)
  for (let i = 0; i < n; i++) d[i] = amp * Math.sin(2 * Math.PI * f0 * L * (Math.exp(i / sr / L) - 1))
  return d
}

/** White noise — seeded LCG, identical across runs. */
export function noise(n, amp = 1, seed = 999) {
  let d = new Float32Array(n), r = seed >>> 0
  for (let i = 0; i < n; i++) { r = (r * 1664525 + 1013904223) >>> 0; d[i] = amp * (r / 2147483648 - 1) }
  return d
}

/** White Gaussian noise of unit variance, seeded (Box-Muller): Boersma's (1993) z_n, eq. 31. */
export function gauss(n, seed = 1) {
  let s = seed >>> 0, u = () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0, (s + .5) / 4294967296)
  return Float32Array.from({ length: n }, () => Math.sqrt(-2 * Math.log(u())) * Math.cos(2 * Math.PI * u()))
}

/** A pulse train at f0 as Boersma (1993) eq. 29 samples it, low-passed at the Nyquist frequency: its harmonics to there
 *  in cosine phase (the DC left out), peak `amp`. */
export function pulses(f0, dur, amp = 0.5, sr = SR) {
  let K = Math.floor(sr / 2 / f0)
  return Float32Array.from({ length: Math.round(dur * sr) }, (_, i) => { let s = 0; for (let k = 1; k <= K; k++) s += Math.cos(2 * Math.PI * k * f0 * i / sr); return amp * s / K })
}

/** Unit impulse (optionally positioned). */
export function impulse(n, amp = 1, at = 0) {
  let d = new Float32Array(n)
  d[at] = amp
  return d
}

/** Hann-windowed 440Hz bursts at each beat position. */
export function clickTrack(bpm, dur, sr = SR) {
  let n = Math.round(dur * sr), buf = new Float32Array(n)
  let beatSamples = Math.round(sr * 60 / bpm), clickLen = 2048
  for (let pos = 0; pos < n; pos += beatSamples)
    for (let i = 0; i < clickLen && pos + i < n; i++)
      buf[pos + i] += (0.5 - 0.5 * Math.cos(2 * Math.PI * i / clickLen)) * Math.sin(2 * Math.PI * 440 * i / sr)
  return buf
}

export const silence = n => new Float32Array(n)

/** RMS over an optional range. */
export function rms(d, from = 0, to = d.length) {
  let s = 0
  for (let i = from; i < to; i++) s += d[i] * d[i]
  return Math.sqrt(s / (to - from))
}

/** A voice: Rosenberg (1971) glottal pulses at f0 (Hz, or t => Hz), differentiated (lip radiation), through Klatt (1980)
 *  resonators at Peterson & Barney's (1952) male /a/ formants, 730, 1090, 2440 and 3400 Hz, each `k` times as high. */
export function vowel(f0, dur, k = 1, sr = 44100) {
  let rs = [[730, 90], [1090, 110], [2440, 170], [3400, 250]].map(([F, B]) => {
    let C = -Math.exp(-2 * Math.PI * B * k / sr), Bc = 2 * Math.exp(-Math.PI * B * k / sr) * Math.cos(2 * Math.PI * F * k / sr), A = 1 - Bc - C, y1 = 0, y2 = 0
    return x => { let y = A * x + Bc * y1 + C * y2; y2 = y1; y1 = y; return y }
  })
  let n = Math.round(dur * sr), d = new Float32Array(n), ph = 0, prev = 0, peak = 0
  for (let i = 0; i < n; i++) {
    ph += (typeof f0 === 'function' ? f0(i / sr) : f0) / sr
    if (ph >= 1) ph -= 1
    let g = ph < .4 ? .5 * (1 - Math.cos(Math.PI * ph / .4)) : ph < .56 ? Math.cos(Math.PI * (ph - .4) / .32) : 0, y = g - prev
    prev = g
    for (let r of rs) y = r(y)
    d[i] = y
  }
  for (let v of d) peak = Math.max(peak, Math.abs(v))
  return d.map(v => .3 * v / peak)
}
