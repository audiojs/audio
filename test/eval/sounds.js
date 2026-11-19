// The eval's sounds: real voices from voices/ (their sources and licences in voices/LICENSE.md), everything else made
// here from a seed, so a sound is the same on every machine and every run.
import { readFileSync } from 'node:fs'
import audio from '../../audio.js'
import { highpass, lowpass, cascade, state } from '@audio/biquad'

const voices = new URL('./voices/', import.meta.url)

/** A file of voices/ as { x: Float32Array (its first channel), fs } */
export async function voice(name) {
  let a = audio(readFileSync(new URL(name + '.flac', voices))), [x] = await a.read()
  return { x, fs: a.sampleRate }
}

// mulberry32: 32 bits of state, the same sequence in every engine
export function rng(seed) {
  let a = seed >>> 0
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
}
const gauss = r => { let u = 0; while (!u) u = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * r()) }

export const power = (x, a = 0, b = x.length) => { let s = 0; for (let i = a; i < b; i++) s += x[i] * x[i]; return s / Math.max(1, b - a) }
const scaled = (x, g) => x.map(v => v * g)

/** Pink noise: white through Kellet's filter (the "refined" one, within 0.05 dB of 1/f from 9.2 Hz to fs/2 at 44.1 kHz) */
export function pink(n, seed) {
  let r = rng(seed), b = [0, 0, 0, 0, 0, 0, 0], y = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    let w = gauss(r)
    b[0] = .99886 * b[0] + w * .0555179; b[1] = .99332 * b[1] + w * .0750759; b[2] = .969 * b[2] + w * .153852
    b[3] = .8665 * b[3] + w * .3104856; b[4] = .55 * b[4] + w * .5329522; b[5] = -.7616 * b[5] - w * .016898
    y[i] = (b[0] + b[1] + b[2] + b[3] + b[4] + b[5] + b[6] + w * .5362) * 0.11; b[6] = w * .115926
  }
  return y
}

/** Noise that moves: pink, its level swung 8 dB either way by three slow sines (0.31, 0.73, 1.9 Hz) */
export function moving(n, fs, seed) {
  let y = pink(n, seed), r = rng(seed + 1), ph = [r(), r(), r()].map(p => 2 * Math.PI * p)
  for (let i = 0; i < n; i++) { let t = i / fs, m = (Math.sin(2 * Math.PI * .31 * t + ph[0]) + Math.sin(2 * Math.PI * .73 * t + ph[1]) + Math.sin(2 * Math.PI * 1.9 * t + ph[2])) * 8 / 3; y[i] *= 10 ** (m / 20) }
  return y
}

/** A band: Butterworth high- and low-pass, `order` poles each */
export function band(x, lo, hi, fs, order = 4) {
  let f = []
  for (let k = 0; k < order / 2; k++) { if (lo) f.push(highpass(lo, Math.SQRT1_2, fs)); if (hi) f.push(lowpass(hi, Math.SQRT1_2, fs)) }
  return cascade(Float32Array.from(x), f, f.map(() => state()))
}

/** The voice's active level: the mean power of its 20 ms frames within 30 dB of the loudest (ITU-T P.56's purpose, a
 *  simpler threshold: the frames that hold the voice, not its pauses) */
export function active(x, fs) {
  let n = Math.round(0.02 * fs), e = []
  for (let i = 0; i + n <= x.length; i += n) e.push(power(x, i, i + n))
  let top = Math.max(...e), on = e.filter(v => v >= top * 1e-3)
  return on.reduce((s, v) => s + v, 0) / on.length
}

/** Phrases joined with `gap` s of silence before, between and after them: { s, on } (on: 1 where a phrase is) */
export function join(parts, gap, fs) {
  let g = Math.round(gap * fs), n = parts.reduce((t, p) => t + p.length + g, g), s = new Float32Array(n), on = new Uint8Array(n), o = g
  for (let p of parts) { s.set(p, o); on.fill(1, o, o + p.length); o += p.length + g }
  return { s, on }
}

/** s with noise under it at `snr` dB under its active level */
export function under(s, noise, snr, fs) {
  let g = Math.sqrt(active(s, fs) / power(noise) * 10 ** (-snr / 10))
  return s.map((v, i) => v + g * noise[i])
}

/** At a peak of `peak` (linear) */
export const peaked = (x, peak) => { let m = 0; for (let v of x) m = Math.max(m, Math.abs(v)); return scaled(x, peak / m) }
/** At an RMS of `dbfs` */
export const at = (x, dbfs) => scaled(x, 10 ** (dbfs / 20) / Math.sqrt(power(x)))

/** Sines from `a` to `b` s of a take `dur` s long: [hz, amp] each, digital silence elsewhere */
export function sines(fs, dur, a, b, tones) {
  let x = new Float32Array(Math.round(dur * fs))
  for (let i = Math.round(a * fs); i < Math.round(b * fs); i++) for (let [f, g] of tones) x[i] += g * Math.sin(2 * Math.PI * f * i / fs)
  return x
}

/** Plucked strings (Karplus-Strong: a noise burst through a delay line and a two-point average), one every `every` s */
export function plucks(fs, dur, every, notes, seed) {
  let r = rng(seed), x = new Float32Array(Math.round(dur * fs))
  notes.forEach((f, k) => {
    let p = Math.round(fs / f), line = Float32Array.from({ length: p }, () => r() * 2 - 1), o = Math.round(k * every * fs)
    for (let i = 0; o + i < x.length && i < 1.5 * fs; i++) { let j = i % p, v = line[j]; line[j] = 0.498 * (v + line[(j + 1) % p]); x[o + i] += v }
  })
  return x
}

export const clip = (x, t) => x.map(v => Math.max(-t, Math.min(t, v)))

/** White noise */
export const white = (n, seed) => { let r = rng(seed); return Float32Array.from({ length: n }, () => gauss(r)) }

const VOICES = ['p232_013', 'p257_014', 'p232_052', 'p257_087']
const span = (x, fs, a, b) => x.slice(Math.round(a * fs), Math.round(b * fs))

/** The sounds the cases name: each { x: channels, fs } and what the case knows of it: s (the clean voice, aligned), on
 *  (1 where a phrase is), span ([a, b) s: the part a measure reads) */
export const SOUNDS = {
  // the four voices, a second of silence around each, under noise (pink: stationary; moving: its level swinging) at snr
  async voices({ noise, snr }) {
    let vs = await Promise.all(VOICES.map(voice)), fs = vs[0].fs, { s, on } = join(vs.map(v => v.x), 1, fs)
    let x = noise ? under(s, noise === 'pink' ? pink(s.length, 1) : moving(s.length, fs, 2), snr, fs) : s
    return { x: [x], fs, s, on }
  },
  // noise alone, 6 s at an RMS of -30 dBFS
  async noise({ kind }) { let fs = 48000, n = 6 * fs; return { x: [at(kind === 'pink' ? pink(n, 3) : moving(n, fs, 4), -30)], fs } },
  // a radio channel over the voices: voice and channel noise in its band, 300 to 3400 Hz (telephony's, ITU-T G.712),
  // the noise `snr` dB under the voice, 3 s of the channel's noise between the phrases
  async radio({ snr }) {
    let vs = await Promise.all(VOICES.map(voice)), fs = vs[0].fs, { s, on } = join(vs.map(v => v.x), 3, fs)
    let v = band(s, 300, 3400, fs), x = under(v, band(white(s.length, 5), 300, 3400, fs), snr, fs)
    return { x: [x], fs, s: v, on }
  },
  // one word (the first of p232_052, 0.55 to 0.92 s), a second of quiet noise either side, 60 dB under the word
  async word() {
    let { x: w, fs } = await voice('p232_052'), { s, on } = join([span(w, fs, 0.55, 0.92)], 1, fs)
    return { x: [under(s, pink(s.length, 6), 60, fs)], fs, s, on }
  },
  // tones over digital silence: two 300 Hz bursts at 0.4 (0.3 to 1.7 s, 3.1 to 4.6 s of 6 s), or a C major triad held
  // from 0.5 to 5.5 s
  async tones({ kind, fs }) {
    if (kind === 'bursts') { let a = sines(fs, 6, 0.3, 1.7, [[300, 0.4]]), b = sines(fs, 6, 3.1, 4.6, [[300, 0.4]]); return { x: [a.map((v, i) => v + b[i])], fs } }
    return { x: [sines(fs, 6, 0.5, 5.5, [[261.63, 0.15], [329.63, 0.15], [392, 0.15]])], fs }
  },
  // a sung phrase as recorded (VocalSet's f2_caro_vibrato, its first 4.5 s)
  async sung() { let { x, fs } = await voice('f2_caro_vibrato'); return { x: [x], fs, s: x } },
  // a take clipped, its original beside it: a voice 6 dB under its peak (p232_013 from 0.6 s, 1 s, at 16 kHz), a C
  // major triad at 0.9 clipped at 0.5 (1 s, 16 kHz), uniform noise of ±0.5 clipped at 0.328 (0.25 s, 8 kHz): the
  // review's kind that comes back further from its original
  async clipped({ kind }) {
    if (kind === 'voice') {
      let { x, fs } = await voice('p232_013'), s = await audio.from([span(x, fs, 0.6, 1.6)], { sampleRate: fs }).resample(16000).read()
      let p = 0; for (let v of s[0]) p = Math.max(p, Math.abs(v))
      return { x: [clip(s[0], p / 2)], fs: 16000, s: s[0] }
    }
    if (kind === 'chord') { let s = sines(16000, 1, 0, 1, [[261.63, 0.3], [329.63, 0.3], [392, 0.3]]); return { x: [clip(s, 0.5)], fs: 16000, s } }
    let r = rng(7), s = Float32Array.from({ length: 2000 }, () => r() - 0.5)
    return { x: [clip(s, 0.328)], fs: 8000, s }
  },
  // for the shifters, 48 kHz: a take cut loud, the shift review's shape (0.5 s of p232_013 ending at sample 112800,
  // inside a word, at a peak of 0.99, then 1 s of zeros), read over its first 0.4 s. Of the 19 cuts of the four voices
  // ending where the voice's 256-sample RMS passes a quarter of its peak, every 50 ms, the one lpc 1.1.0 renders lowest
  async cut() { let { x, fs } = await voice('p232_013'), c = peaked(x.slice(112800 - fs / 2, 112800), 0.99), y = new Float32Array(c.length + fs); y.set(c); return { x: [y], fs, span: [0, 0.4] } },
  // two phrases, the second 12 dB under the first (p257_014 from 0.55 to 3.5 s at a peak of 0.9; 0.5 s of zeros;
  // p232_052 from 0.55 to 2.1 s), read over the second
  async phrases() {
    let [a, b] = await Promise.all([voice('p257_014'), voice('p232_052')]), fs = a.fs, p = peaked(span(a.x, fs, 0.55, 3.5), 0.9), q = span(b.x, fs, 0.55, 2.1)
    q = q.map(v => v * Math.sqrt(active(p, fs) / active(q, fs) * 10 ** -1.2))
    let gap = fs / 2, x = new Float32Array(p.length + gap + q.length); x.set(p); x.set(q, p.length + gap)
    return { x: [x], fs, span: [(p.length + gap) / fs, x.length / fs] }
  },
  // a pure tone from its first sample: 3 kHz at 0.5 for 0.25 s, then 0.25 s of zeros (the shift review's tones, at
  // the rate and frequency lpc 1.1.0 read worst shifted down), its onset at 0; read over its middle half, where a shift
  // of `shift` semitones puts it at f times `ratio`
  async tone({ shift }) { let fs = 48000, f = 3000; return { x: [sines(fs, 0.5, 0, 0.25, [[f, 0.5]])], fs, onset: 0, span: [0.0625, 0.1875], f, ratio: 2 ** (shift / 12) } },
  // two channels holding different sounds: a voice left (p257_087 from 0.55 to 2.5 s, at a peak of 0.9), plucked
  // strings right, 20 dB under it
  async pair() {
    let { x, fs } = await voice('p257_087'), l = peaked(span(x, fs, 0.55, 2.5), 0.9), r = plucks(fs, l.length / fs, 0.4, [196, 247, 294, 392, 330], 8)
    r = r.map(v => v * Math.sqrt(active(l, fs) / active(r, fs) * 0.01))
    return { x: [l, r], fs }
  },
}
