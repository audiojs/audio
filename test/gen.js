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
