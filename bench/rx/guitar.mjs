// iZotope RX 12 Guitar De-noise against `audio`'s desqueak() (@audio/denoise-desqueak), part by part: string squeaks
// added to clean guitar takes, and squeaks as recorded; pick attacks made harsher; amp hiss and buzz under the takes.
//
//   node bench/rx/guitar.mjs tune [squeak] [pick] [amp]   RX's grids on the tuning takes (their scores kept), the squeaks
//                                                         as recorded there
//   node bench/rx/guitar.mjs test [squeak] [real] [pick] [amp]   the tables (all if none)
//
// Takes: GuitarSet (Xi et al., ISMIR 2018, CC BY 4.0), the mic recordings of a solo acoustic guitar, 44.1 kHz, with
// their note annotations; tune players 00–02, test 03–05, ten takes each (one per style and mode). Every setting, ours
// and RX's, is chosen on tune; test reports. The takes hold squeaks of their own, so a change to a clean take is not by
// itself harm: harm is read on the notes' partials (`harm`).
// Squeaks synthesized from their physics (`squeak`, `squeaky`); squeaks as recorded, labelled on spectrograms (`REAL`);
// harsh picks (`picky`); amp noise (`ampNoise`): each says what it is and where its numbers come from.
// RX through bench/rx/host.py (Pedalboard, VST3; lag 0): at its defaults (Squeak on, sensitivity 3, reduction 4; Pick
// and Amp off), each part tuned on its own (the others bypassed) by SNR to the clean take on tune. Its Amp section learns
// only from its Learn button, no plugin parameter: hosted, it passes the take bit for bit at every setting, so RX 12
// Spectral De-noise with a print learned from the amp's second alone before the take stands for RX there (`SDN`).
// Scores in ~/.cache/audiojs/data/rx/guitar/scores-<split>.json, ours kept by a hash of the kernel they came from.
import { readFileSync, readdirSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createInterface } from 'node:readline'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { highpass, lowpass, bandpass, process as bq } from '@audio/biquad'
import { fft } from 'fourier-transform'
import { readWav, writeWav, op, lcg, median, table, DATA, OUT } from './lib.mjs'
import { rxRetry, scored } from './voice.mjs'

export const DIR = path.join(OUT, 'guitar'), GS = path.join(DATA, 'guitarset')
const db = v => 10 * Math.log10(v + 1e-30)
const gauss = r => { let u = r() || 1e-12; return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * r()) }
export const pct = (v, p) => { let s = Float64Array.from(v).sort(); return s[Math.floor(p * (s.length - 1))] }

// ---- takes: GuitarSet (Xi, Bittner, Pauwels, Ye & Bello, ISMIR 2018, CC BY 4.0), the mic recordings, 44.1 kHz mono.
// tune: players 00–02, test: players 03–05; per player the first take of each style (BN, Funk, Jazz, Rock, SS) and mode
// (comp, solo): 10 per player, 30 per split. Notes from the JAMS note_midi annotations: [onset s, duration s, MIDI, string
// 0–5, low E first].
export function takes(split) {
  let players = split === 'tune' ? ['00', '01', '02'] : ['03', '04', '05'], out = []
  let files = readdirSync(path.join(GS, 'audio_mono-mic')).filter(f => f.endsWith('_mic.wav')).sort()
  for (let p of players) for (let style of ['BN', 'Funk', 'Jazz', 'Rock', 'SS']) for (let mode of ['comp', 'solo']) {
    let f = files.find(f => f.startsWith(`${p}_${style}`) && f.includes(`_${mode}_`)), name = f.replace('_mic.wav', '')
    let { ch: [x], sr } = readWav(path.join(GS, 'audio_mono-mic', f))
    let j = JSON.parse(readFileSync(path.join(GS, 'annotation', name + '.jams'), 'utf8')), notes = []
    for (let a of j.annotations) if (a.namespace === 'note_midi') for (let d of a.data) notes.push([d.time, d.duration, d.value, +a.annotation_metadata.data_source])
    notes.sort((a, b) => a[0] - b[0])
    out.push({ name, x, sr, notes })
  }
  return out
}

// ---- squeaks. A fingertip sliding along a wound string: each winding it crosses is an impact, so the noise is a pulse
// train at v/d (v the speed, d the winding's pitch) shaped by the string, with harmonics at multiples of that rate and
// an RMS proportional to v, plus static lines at the string's longitudinal modes (Pakarinen, Penttinen & Bank, "Analysis
// of handling noises on wound strings", JASA 122(6), EL197–EL202, 2007). Synthesized as their slide guitar model has it
// (Pakarinen, Välimäki & Puputti, NIME 2008, fig. 2): a pulse per winding, a resonator on the firing rate for the first
// harmonic, a filter for the longitudinal modes, a low-pass whose cutoff rises with the speed. The hand's move is
// minimum-jerk (Flash & Hogan, J. Neurosci. 5(7), 1985): x(τ) = D(10τ³ − 15τ⁴ + 6τ⁵), the speed peaking at 1.875 D/T
// mid-move, so the comb rises and falls. The winding's pitch d is the wrap wire's diameter, (gauge − core)/2 of a
// light phosphor-bronze set (.053/.042/.032/.024 over hex cores of about .018/.016/.0135/.0115 in): 0.44, 0.33, 0.24,
// 0.16 mm for E, A, D, G. The first longitudinal mode, c_L/2L with c_L = √(E·A_core/μ) (steel core, E = 200 GPa, μ from
// each string's tension and pitch at a 645 mm scale), is 1.4, 1.7, 1.8, 2.0 kHz. Peak speed 0.15–1.5 m/s
// (log-uniform), contact 40–300 ms (log-uniform): combs from about 0.3 to 9 kHz.
const WIND = [0.44e-3, 0.33e-3, 0.24e-3, 0.16e-3], LONG = [1380, 1670, 1820, 2020]
function biquadTV(y, coefAt, step = 32) {
  let z1 = 0, z2 = 0, c
  for (let i = 0; i < y.length; i++) {
    if (i % step === 0) c = coefAt(i)
    let x = y[i], o = c.b0 * x + z1
    z1 = c.b1 * x - c.a1 * o + z2; z2 = c.b2 * x - c.a2 * o; y[i] = o
  }
  return y
}
export function squeak(sr, r, s = Math.floor(r() * 4)) {
  let T = 0.04 * 7.5 ** r(), vmax = 0.15 * 10 ** r(), d = WIND[s], fL = LONG[s] * (0.95 + 0.1 * r())
  let n = Math.round(T * sr), D = vmax * T / 1.875, y = new Float64Array(n + Math.round(0.01 * sr))
  let pos = t => D * (10 * t ** 3 - 15 * t ** 4 + 6 * t ** 5), vel = t => 30 * D / T * t * t * (1 - t) ** 2
  // the impact: a noise burst decaying in 0.05–0.2 ms, alike at every winding (a share c of it the same, c 0.7–0.95: the
  // fingertip's skin and the stick-slip make no two alike), on a crossing jittered by 2 % of its period
  let tp = (0.05 + 0.15 * r()) * 1e-3 * sr, L = Math.ceil(6 * tp), c = 0.7 + 0.25 * r(), burst = () => Float64Array.from({ length: L }, () => gauss(r))
  let h0 = burst()
  for (let j = 1, i = 0, last = 0; ; j++) {
    while (i < n && pos(i / n) < j * d) i++
    if (i >= n) break
    let at = Math.round(i + 0.02 * (i - last) * gauss(r)), a = Math.sqrt(vel(i / n) / vmax) * (0.8 + 0.4 * r()), h1 = burst()
    last = i
    for (let k = 0; k < L && at + k < y.length; k++) if (at + k >= 0) y[at + k] += a * (c * h0[k] + Math.sqrt(1 - c * c) * h1[k]) * Math.exp(-k / tp)
  }
  let fc = i => Math.max(50, vel(Math.min(i, n - 1) / n) / d)
  let res = biquadTV(Float64Array.from(y), i => bandpass(Math.min(fc(i), sr / 2.5), 3, sr))
  let mix = new Float64Array(y.length)
  for (let k = 1; k <= 3 && k * fL < sr / 2.5; k++) { let m = Float64Array.from(y); bq(m, bandpass(k * fL, 30, sr)); for (let i = 0; i < m.length; i++) mix[i] += m[i] / k }
  for (let i = 0; i < y.length; i++) y[i] = y[i] + res[i] + 0.3 * mix[i]
  biquadTV(y, i => lowpass(Math.min(Math.max(4 * fc(i), 1500), 10000), 0.707, sr))
  bq(y, highpass(300, 0.707, sr))
  return { y, T, vmax, s }
}

// squeaks on a take: at position shifts (a note on a wound string, E A D G, 1.5 semitones or more from the one before
// on that string), six in ten, ending 5–40 ms before the new note; and one in about 6 s anywhere, on any wound
// string. None within 0.5 s of another. Each peaks (10 ms RMS) 10–30 dB under the take's 99th-percentile 10 ms frame
// (uniform in dB; the squeaks RX 12's own detector hears on the tuning takes peak 9–35 dB under it).
// → { y: take with squeaks, s: the squeaks alone, spans: [[a, b)] samples }
export function squeaky(t, seed) {
  let { x, sr, notes } = t, r = lcg(seed), s = new Float64Array(x.length), spans = [], at = []
  let ref = Math.sqrt(10 ** (pct(frames10(x, sr), 0.99) / 10))
  for (let str = 0; str < 4; str++) {
    let on = notes.filter(n => n[3] === str)
    for (let k = 1; k < on.length; k++) if (Math.abs(on[k][2] - on[k - 1][2]) >= 1.5 && on[k][0] - on[k - 1][0] > 0.15) at.push([on[k][0], str])
  }
  at.sort((a, b) => a[0] - b[0])
  let want = []
  for (let [t0, str] of at) if (r() < 0.6) want.push([t0 - 0.005 - 0.035 * r(), str, true])
  for (let t0 = 1 + 6 * r(); t0 < x.length / sr - 0.5; t0 += 3 + 6 * r()) want.push([t0, Math.floor(r() * 4), false])
  want.sort((a, b) => a[0] - b[0])
  for (let [t1, str, end] of want) {
    let q = squeak(sr, r, str), n = q.y.length, a = Math.round(end ? t1 * sr - q.T * sr : t1 * sr), b = a + n
    if (a < sr * 0.1 || b > x.length - sr * 0.1 || spans.some(([p, e]) => a < e + sr / 2 && b > p - sr / 2)) continue
    let pk = Math.max(...frames10(q.y, sr).map(v => Math.sqrt(10 ** (v / 10)))), g = ref * 10 ** (-(10 + 20 * r()) / 20) / pk
    for (let i = 0; i < n; i++) s[a + i] += g * q.y[i]
    spans.push([a, b])
  }
  spans.sort((p, q) => p[0] - q[0])
  return { y: Float32Array.from(x, (v, i) => v + s[i]), s, spans }
}
// 10 ms frames' energy, dB
export function frames10(x, sr) {
  let n = Math.round(sr / 100), m = Math.floor(x.length / n), e = new Float64Array(m)
  for (let k = 0; k < m; k++) { let s = 0; for (let i = k * n; i < k * n + n; i++) s += x[i] * x[i]; e[k] = db(s / n) }
  return e
}

// ---- picks. A pick's attack made harsher: at each onset (annotated starts within 30 ms one: a strum), its click (the
// loudest millisecond of 2–10 kHz within ±15 ms of the annotation), the 2–10 kHz band from 2 ms before it to 8 ms after
// (1 ms raised-cosine edges) raised 6–12 dB (uniform, seeded): x + (g − 1)·B(x)·w, B 4th-order Butterworth band-pass
// forward and backward (zero phase). The take as played is the target. → { y, spans: [[a, b)] }
const bp = (x, sr, lo, hi) => { let y = Float64Array.from(x); for (let c of [highpass(lo, 0.5412, sr), highpass(lo, 1.3066, sr), lowpass(hi, 0.5412, sr), lowpass(hi, 1.3066, sr)]) { bq(y, c); y.reverse(); bq(y, c); y.reverse() } return y }
export function picky(t, seed) {
  let { x, sr } = t, r = lcg(seed), B = bp(x, sr, 2000, 10000), y = Float32Array.from(x), spans = [], ms = v => Math.round(v * sr / 1000)
  for (let [o] of onsets(t)) {
    let best = o, bv = -1
    for (let c = o - ms(15); c < o + ms(15); c += ms(1)) { let e = 0; for (let i = c; i < c + ms(1); i++) e += (B[i] || 0) ** 2; if (e > bv) bv = e, best = c }
    let a = best - ms(2), b = best + ms(8), f = ms(1), g = 10 ** ((6 + 6 * r()) / 20) - 1
    if (a - f < 0 || b + f > x.length || (spans.length && a - f < spans[spans.length - 1][1] + ms(20))) continue
    for (let i = a - f; i < b + f; i++) { let d = i < a ? (a - i) / f : i >= b ? (i - b + 1) / f : 0; y[i] += g * B[i] * (0.5 + 0.5 * Math.cos(Math.PI * Math.min(1, d))) }
    spans.push([a - f, b + f])
  }
  return { y, spans, B }
}

// ---- amp noise, from 1 s before the take (the amp on before the playing) to its end. Hiss: white noise through a
// guitar cabinet's band, 2nd-order high-pass at 80 Hz and low-pass at 5 kHz. Buzz: bench/rx/dehum.mjs's, the ground-loop
// and rectifier buzz of unbalanced connections (Whitlock, Jensen AN-004, 1995): 60 Hz (the takes were made in New York),
// odd harmonics at h^−½ and even at 0.3·h^−½, a first-order roll-off at 3 kHz, to 8 kHz, random phases, the frequency
// wandering ±0.05 Hz. Conditions, dB under the take's RMS: hiss −40, buzz −35, amp (both, −40 each).
export const AMP = { hiss: { hiss: -40 }, buzz: { buzz: -35 }, amp: { hiss: -40, buzz: -40 } }
export function ampNoise(t, cond, seed) {
  let { x, sr } = t, r = lcg(seed), P = sr, n = x.length + P, rms = Math.sqrt(E(x) / x.length), out = new Float64Array(n), c = AMP[cond]
  if (c.hiss) {
    let h = Float64Array.from({ length: n }, () => gauss(r)); bq(h, highpass(80, 0.7071, sr)); bq(h, lowpass(5000, 0.7071, sr))
    let g = rms * 10 ** (c.hiss / 20) / Math.sqrt(E(h) / n); for (let i = 0; i < n; i++) out[i] += g * h[i]
  }
  if (c.buzz) {
    let H = [], ph = 0, off = 0.05 * (2 * r() - 1), drift = 2 * Math.PI * r(), b = new Float64Array(n)
    for (let h = 1; h * 60 <= 8000; h++) H.push([h, (h % 2 ? 1 : 0.3) / Math.sqrt(h) / Math.hypot(1, h * 60 / 3000), 2 * Math.PI * r()])
    for (let i = 0; i < n; i++) { ph += 2 * Math.PI * (60 + off * Math.sin(2 * Math.PI * 0.1 * i / sr + drift)) / sr; let v = 0; for (let [h, a, q] of H) v += a * Math.sin(h * ph + q); b[i] = v }
    let g = rms * 10 ** (c.buzz / 20) / Math.sqrt(E(b) / n); for (let i = 0; i < n; i++) out[i] += g * b[i]
  }
  return { n: out, P }
}

// ---- squeaks as recorded (no clean reference). Per split, the places RX's squeak detector (its "output squeaks only",
// over −35 dB under the take's 99th-percentile 10 ms frame) and ours both mark (tune 95, test 125), looked at on their
// spectrograms (±120 ms, 0–12 kHz, 2026-10-07): squeaks where a sweep shows, an arch, a stacked comb, a curve that
// rises and falls between notes (tune 14, test 35); not, where a pluck, a strum or a click shows, partials after it
// and no sweep (tune 58, test 47; mostly the pick's touch before a pluck); the rest left unlabelled. [take, from s, to s].
// Ours was marked by its own detector of the day (regions of 20 ms or more); the test labels chose nothing.
export const REAL = {
  tune: {
    squeak: [['00_BN1-129-Eb_comp', 9.334, 9.439], ['00_BN1-129-Eb_comp', 16.776, 16.875], ['01_BN1-129-Eb_comp', 10.971, 11.04], ['01_BN1-129-Eb_solo', 12.945, 13.079], ['01_SS1-100-C#_solo', 5.764, 5.811], ['01_SS1-100-C#_solo', 15.494, 15.546], ['02_BN1-129-Eb_solo', 10.809, 10.91], ['02_BN1-129-Eb_solo', 11.128, 11.233], ['02_BN1-129-Eb_solo', 15.801, 15.92], ['02_Funk1-114-Ab_solo', 11.26, 11.36], ['02_Funk1-114-Ab_solo', 17.56, 17.618], ['02_Funk1-114-Ab_solo', 18.158, 18.24], ['02_Funk1-114-Ab_solo', 21.61, 21.693], ['02_Funk1-114-Ab_solo', 24.915, 24.967]],
    not: [['00_BN1-129-Eb_comp', 19.534, 19.557], ['00_BN1-129-Eb_solo', 15.824, 15.85], ['00_Funk1-114-Ab_comp', 22.372, 22.43], ['00_Funk1-114-Ab_solo', 12.353, 12.4], ['00_Funk1-114-Ab_solo', 13.52, 13.619], ['00_Funk1-114-Ab_solo', 16.492, 16.52], ['00_Jazz1-130-D_solo', 4.53, 4.557], ['00_Rock1-130-A_solo', 1.12, 1.15], ['00_Rock1-130-A_solo', 2.5, 2.53], ['00_Rock1-130-A_solo', 4.8, 4.88], ['00_Rock1-130-A_solo', 6.11, 6.17], ['00_Rock1-130-A_solo', 19.56, 19.627], ['00_SS1-100-C#_solo', 21.229, 21.27], ['01_BN1-129-Eb_comp', 5.074, 5.161], ['01_BN1-129-Eb_solo', 11.163, 11.186], ['01_BN1-129-Eb_solo', 20.35, 20.4], ['01_Funk1-114-Ab_comp', 3.286, 3.31], ['01_Funk1-114-Ab_comp', 3.779, 3.86], ['01_Funk1-114-Ab_comp', 4.331, 4.394], ['01_Funk1-114-Ab_comp', 6.3, 6.327], ['01_Funk1-114-Ab_comp', 11.43, 11.476], ['01_Funk1-114-Ab_comp', 12.098, 12.127], ['01_Funk1-114-Ab_comp', 24.29, 24.364], ['01_Funk1-114-Ab_solo', 7.44, 7.47], ['01_Funk1-114-Ab_solo', 11.16, 11.198], ['01_Funk1-114-Ab_solo', 12.49, 12.545], ['01_Funk1-114-Ab_solo', 12.8, 12.841], ['01_Funk1-114-Ab_solo', 22.071, 22.134], ['01_Funk1-114-Ab_solo', 23.998, 24.027], ['01_Jazz1-130-D_solo', 15.737, 15.8], ['01_Rock1-130-A_comp', 13.607, 13.624], ['01_Rock1-130-A_comp', 15.644, 15.726], ['01_Rock1-130-A_comp', 19.12, 19.156], ['01_Rock1-130-A_solo', 5.06, 5.085], ['01_Rock1-130-A_solo', 19.992, 20.02], ['01_Rock1-130-A_solo', 20.23, 20.271], ['01_Rock1-130-A_solo', 20.46, 20.492], ['01_Rock1-130-A_solo', 20.67, 20.72], ['01_Rock1-130-A_solo', 20.91, 20.939], ['01_Rock1-130-A_solo', 21.124, 21.182], ['01_Rock1-130-A_solo', 21.397, 21.43], ['01_SS1-100-C#_comp', 13.48, 13.52], ['01_SS1-100-C#_comp', 17.845, 17.885], ['01_SS1-100-C#_comp', 21.42, 21.484], ['01_SS1-100-C#_comp', 25.02, 25.072], ['01_SS1-100-C#_comp', 26.227, 26.279], ['01_SS1-100-C#_comp', 27.417, 27.475], ['01_SS1-100-C#_solo', 25.327, 25.34], ['02_BN1-129-Eb_comp', 21.85, 21.891], ['02_BN1-129-Eb_solo', 4.685, 4.719], ['02_BN1-129-Eb_solo', 8.12, 8.156], ['02_BN1-129-Eb_solo', 17.64, 17.699], ['02_BN1-129-Eb_solo', 19.598, 19.64], ['02_Funk1-114-Ab_solo', 19.83, 19.894], ['02_Rock1-130-A_solo', 4.81, 4.84], ['02_SS1-100-C#_comp', 6.32, 6.38], ['02_SS1-100-C#_comp', 12.28, 12.336], ['02_SS1-100-C#_solo', 11.68, 11.749]],
  },
  test: {
    squeak: [['03_BN1-129-Eb_comp', 18.216, 18.303], ['03_BN1-129-Eb_solo', 2.45, 2.5], ['03_BN1-129-Eb_solo', 8.98, 9.05], ['03_Funk1-114-Ab_solo', 15.871, 15.93], ['03_Funk1-114-Ab_solo', 18.698, 18.791], ['03_Jazz1-130-D_comp', 17.99, 18.013], ['03_Jazz1-130-D_solo', 7.094, 7.17], ['03_SS1-100-C#_comp', 21.397, 21.52], ['03_SS1-100-C#_solo', 0.94, 1.04], ['03_SS1-100-C#_solo', 1.544, 1.63], ['03_SS1-100-C#_solo', 1.92, 1.99], ['03_SS1-100-C#_solo', 4.632, 4.685], ['03_SS1-100-C#_solo', 5.143, 5.254], ['03_SS1-100-C#_solo', 6.089, 6.182], ['03_SS1-100-C#_solo', 6.57, 6.64], ['03_SS1-100-C#_solo', 10.72, 10.81], ['03_SS1-100-C#_solo', 12.41, 12.45], ['03_SS1-100-C#_solo', 12.829, 12.88], ['03_SS1-100-C#_solo', 14.96, 15.029], ['03_SS1-100-C#_solo', 15.39, 15.49], ['03_SS1-100-C#_solo', 18.669, 18.77], ['03_SS1-100-C#_solo', 21.37, 21.52], ['04_Funk1-114-Ab_comp', 15.6, 15.68], ['04_Funk1-114-Ab_comp', 21.885, 21.95], ['04_Funk1-114-Ab_comp', 24.88, 24.961], ['04_SS1-100-C#_comp', 21.397, 21.54], ['04_SS1-100-C#_solo', 5.793, 5.87], ['04_SS1-100-C#_solo', 12.295, 12.428], ['04_SS1-100-C#_solo', 16.45, 16.492], ['04_SS1-100-C#_solo', 24.956, 25.014], ['05_Jazz1-130-D_comp', 9.601, 9.712], ['05_Jazz1-130-D_solo', 6.978, 7.09], ['05_Rock1-130-A_solo', 5.8, 5.904], ['05_Rock1-130-A_solo', 21.74, 21.995], ['05_SS1-100-C#_solo', 17.699, 17.769]],
    not: [['03_BN1-129-Eb_comp', 7.047, 7.13], ['03_BN1-129-Eb_comp', 14.6, 14.611], ['03_BN1-129-Eb_comp', 16.109, 16.19], ['03_BN1-129-Eb_comp', 18.907, 18.953], ['03_Funk1-114-Ab_comp', 15.17, 15.331], ['03_Funk1-114-Ab_solo', 8.7, 8.737], ['03_Jazz1-130-D_solo', 11.9, 11.941], ['03_Jazz1-130-D_solo', 18.42, 18.489], ['03_Jazz1-130-D_solo', 20.4, 20.439], ['03_Rock1-130-A_comp', 9.68, 9.72], ['03_Rock1-130-A_solo', 10.34, 10.41], ['03_SS1-100-C#_solo', 8.09, 8.14], ['04_BN1-129-Eb_comp', 7.634, 7.715], ['04_BN1-129-Eb_comp', 17.194, 17.27], ['04_BN1-129-Eb_comp', 18.25, 18.332], ['04_Funk1-114-Ab_comp', 2.247, 2.31], ['04_Funk1-114-Ab_comp', 3.146, 3.17], ['04_Funk1-114-Ab_comp', 7.49, 7.552], ['04_Funk1-114-Ab_comp', 8.29, 8.319], ['04_Funk1-114-Ab_comp', 8.934, 8.986], ['04_Funk1-114-Ab_comp', 12.12, 12.15], ['04_Funk1-114-Ab_comp', 15.273, 15.325], ['04_Funk1-114-Ab_comp', 16.707, 16.771], ['04_Funk1-114-Ab_comp', 18.84, 18.87], ['04_Funk1-114-Ab_comp', 19.847, 19.905], ['04_Funk1-114-Ab_comp', 22.721, 22.785], ['04_Funk1-114-Ab_solo', 8.313, 8.342], ['04_Funk1-114-Ab_solo', 11.343, 11.407], ['04_Funk1-114-Ab_solo', 20.468, 20.61], ['04_Jazz1-130-D_comp', 14.547, 14.605], ['04_Jazz1-130-D_comp', 15.94, 16.09], ['04_Jazz1-130-D_comp', 16.962, 17.05], ['04_Jazz1-130-D_comp', 17.35, 17.438], ['04_Jazz1-130-D_solo', 15.88, 15.929], ['04_Jazz1-130-D_solo', 19.69, 19.743], ['04_Jazz1-130-D_solo', 20.81, 20.904], ['04_Rock1-130-A_comp', 14.472, 14.565], ['04_Rock1-130-A_solo', 3.29, 3.315], ['04_Rock1-130-A_solo', 13.15, 13.195], ['04_Rock1-130-A_solo', 18.73, 18.768], ['04_SS1-100-C#_comp', 14.17, 14.27], ['04_SS1-100-C#_solo', 19.987, 20.068], ['04_SS1-100-C#_solo', 23.21, 23.272], ['04_SS1-100-C#_solo', 24.787, 24.828], ['05_Funk1-114-Ab_solo', 11.38, 11.43], ['05_Funk1-114-Ab_solo', 12.65, 12.696], ['05_SS1-100-C#_solo', 3.74, 3.773]],
  },
}
// the 1–10 kHz energy a system takes from each, dB, the take as recorded through it
export async function realScore(sys, split) {
  let T = new Map(takes(split).map(t => [t.name, t])), out = { squeak: [], not: [] }, done = new Map()
  for (let kind of ['squeak', 'not']) for (let [name, a, b] of REAL[split][kind]) {
    let t = T.get(name)
    if (!done.has(name)) done.set(name, (await sys.fn({ ch: [t.x], sr: t.sr })).ch[0])
    let x = bp(t.x, t.sr, 1000, 10000), y = bp(done.get(name), t.sr, 1000, 10000), i = Math.round(a * t.sr), j = Math.round(b * t.sr)
    out[kind].push(db(E(x, i, j) / E(y, i, j)))
  }
  return out
}

// ---- measures
const E = (x, a = 0, b = x.length) => { let s = 0; for (let i = Math.max(0, a); i < Math.min(b, x.length); i++) s += x[i] * x[i]; return s }
const Ed = (x, y, a = 0, b = x.length) => { let s = 0; for (let i = Math.max(0, a); i < Math.min(b, x.length); i++) s += (x[i] - y[i]) ** 2; return s }
// onsets: annotated note starts, those within 30 ms merged (a strum is one attack); each with its notes' end (the
// latest among them, s)
export function onsets(t) {
  let o = []
  for (let n of t.notes) if (!o.length || n[0] - o[o.length - 1][0] > 0.03) o.push([n[0], n[0] + n[1]]); else o[o.length - 1][1] = Math.max(o[o.length - 1][1], n[0] + n[1])
  return o.map(([a, b]) => [Math.round(a * t.sr), Math.round(b * t.sr)])
}
// Harm on a clean take z = sys(x). The takes hold squeaks of their own (between and under notes, where the hand
// shifts), so a change to the take is not by itself harm: the notes are measured on their partials. Per annotated note
// (f0 from its MIDI pitch), the cells within ±1 bin of each partial k·f0 up to 10 kHz (1024-point frames, hop 256) where
// the partial stands clear, 10 dB or more over the spectrum's median ±8 bins around it, in its attack (frames centred in
// its first 40 ms) and its sustain (60 ms on to 20 ms before it ends): the level change, dB, under 1 kHz and over it; a
// squeak's noise there, 10 dB under, moves it by 0.4 dB at most. Also: the share of samples moved over one 16-bit step
// and the error, dB under the take (all that was changed, harm or the take's own squeaks taken).
export function harm(t, z) {
  let { x, sr, notes } = t, moved = 0, N = 1024, hop = 256
  for (let i = 0; i < x.length; i++) moved += Math.abs(z[i] - x[i]) > 2 ** -15
  let X = power(x, N, hop), Z = power(z, N, hop), M = X.map(p => p.map((_, k) => med(p, k - 8, k + 8))), out = { attL: [], attH: [], susL: [], susH: [] }
  for (let [on, dur, m] of notes) {
    let f0 = 440 * 2 ** ((m - 69) / 12), fr = s => Math.round((s * sr - N / 2) / hop)
    for (let [part, a, b] of [['att', fr(on), fr(on + 0.04)], ['sus', fr(on + 0.06), fr(on + dur - 0.02)]]) {
      let acc = { L: [0, 0], H: [0, 0] }
      for (let f = Math.max(0, a); f <= Math.min(b, X.length - 1); f++) for (let h = 1; h * f0 <= 10000; h++) {
        let c = Math.round(h * f0 * N / sr), g = h * f0 < 1000 ? acc.L : acc.H, m = M[f][c]
        for (let k = c - 1; k <= c + 1; k++) if (X[f][k] > 10 * m) g[0] += X[f][k], g[1] += Z[f][k]
      }
      for (let B of ['L', 'H']) out[part + B].push(acc[B][0] > 0 ? db(acc[B][1] / acc[B][0]) : NaN)
    }
  }
  return { moved: moved / x.length, err: db(E(x) / Ed(x, z)), ...out }
}
const med = (p, a, b) => { let v = Array.from(p.subarray(Math.max(0, a), b + 1)).sort((u, w) => u - w); return v[v.length >> 1] }
function power(x, N, hop) {
  let w = Float64Array.from({ length: N }, (_, i) => 0.5 - 0.5 * Math.cos(2 * Math.PI * i / N)), out = [], f = new Float64Array(N)
  for (let p = 0; p + N <= x.length; p += hop) { for (let i = 0; i < N; i++) f[i] = x[p + i] * w[i]; let [re, im] = fft(f); out.push(Float64Array.from({ length: N / 2 + 1 }, (_, k) => re[k] * re[k] + im[k] * im[k])) }
  return out
}

// a system on the squeaky take: error gone over each squeak (10 ms either side), pooled and per squeak; the squeak's own
// time-frequency cells (where it outweighs the take, 1024-point frames, hop 256) taken, dB; SNR to the clean take; the
// error elsewhere, dB under the take
export function squeakScore(t, d, y) {
  let { x, sr } = t, w = Math.round(0.01 * sr), e0 = 0, e1 = 0, per = [], out0 = 0, out1 = 0, inside = new Uint8Array(x.length)
  for (let [a, b] of d.spans) {
    let p = Ed(d.y, x, a - w, b + w), q = Ed(y, x, a - w, b + w)
    e0 += p; e1 += q; per.push(db(p / q))
    inside.fill(1, Math.max(0, a - w), Math.min(x.length, b + w))
  }
  for (let i = 0; i < x.length; i++) if (!inside[i]) out0 += x[i] * x[i], out1 += (y[i] - x[i]) ** 2
  let tf = tfGone(x, d.s, Float64Array.from(y, (v, i) => v - x[i]), d.spans, w)
  return { e0, e1, per, tf, snr: [E(x), Ed(x, y)], out: [out0, out1] }
}
function tfGone(x, s, r, spans, w) {
  let N = 1024, hop = 256, win = Float64Array.from({ length: N }, (_, i) => 0.5 - 0.5 * Math.cos(2 * Math.PI * i / N)), S = 0, R = 0
  let spec = (v, p) => { let f = new Float64Array(N); for (let i = 0; i < N; i++) f[i] = (v[p + i] || 0) * win[i]; let [re, im] = fft(f); return re.map((a, k) => a * a + im[k] * im[k]) }
  for (let [a, b] of spans) for (let p = a - w - N / 2; p + N / 2 < b + w; p += hop) {
    if (p < 0 || p + N > x.length) continue
    let X = spec(x, p), Sq = spec(s, p), Rr = spec(r, p)
    for (let k = 0; k < X.length; k++) if (Sq[k] > X[k]) S += Sq[k], R += Rr[k]
  }
  return [S, R]
}

// a system on the harsh-picked take: error gone over each attack (5 ms before, 20 ms after), pooled and per attack; the
// 2–10 kHz level left over the attacks, dB over the take's own (the boost: 6–12); SNR to the take; error elsewhere
export function pickScore(t, d, y) {
  let { x, sr } = t, w0 = Math.round(0.005 * sr), w1 = Math.round(0.02 * sr), e0 = 0, e1 = 0, per = [], inside = new Uint8Array(x.length), out0 = 0, out1 = 0
  let Bx = d.B, By = bp(y, sr, 2000, 10000), left = []
  for (let [a, b] of d.spans) {
    let p = Ed(d.y, x, a - w0, b + w1), q = Ed(y, x, a - w0, b + w1); e0 += p; e1 += q; per.push(db(p / q))
    left.push(db(E(By, a, b) / E(Bx, a, b))); inside.fill(1, Math.max(0, a - w0), Math.min(x.length, b + w1))
  }
  for (let i = 0; i < x.length; i++) if (!inside[i]) out0 += x[i] * x[i], out1 += (y[i] - x[i]) ** 2
  return { e0, e1, per, left, snr: [E(x), Ed(x, y)], out: [out0, out1] }
}
// a system under amp noise, by phase inversion (Hagerman & Olofsson, Acta Acustica 90(2), 2004): y± = sys(x ± n), the
// noise left (y₊ − y₋)/2 and the guitar (y₊ + y₋)/2, over the take (the lead-in left out): noise down, dB, over the
// take and where it is heard (10 ms frames where the guitar stands under 6 dB over it); the guitar's SDR; SNR of y₊ to the take; its partials (harm()) kept
export async function ampScore(sys, t, cond, seed) {
  let { n, P } = ampNoise(t, cond, seed), { x, sr } = t, L = x.length + P
  let mk = sgn => Float32Array.from({ length: L }, (_, i) => (i >= P ? x[i - P] : 0) + sgn * n[i])
  let yp = (await sys.fn({ ch: [mk(1)], sr })).ch[0].subarray(P), ym = (await sys.fn({ ch: [mk(-1)], sr })).ch[0].subarray(P)
  let res = Float64Array.from(yp, (v, i) => (v - ym[i]) / 2), gtr = Float32Array.from(yp, (v, i) => (v + ym[i]) / 2), nn = n.subarray(P)
  let w = Math.round(0.01 * sr), g0 = 0, g1 = 0
  for (let i = 0; i + w <= x.length; i += w) if (E(x, i, i + w) < 4 * E(nn, i, i + w)) g0 += E(nn, i, i + w), g1 += E(res, i, i + w)
  return { nd: [E(nn), E(res)], gap: [g0, g1], sdr: [E(x), Ed(gtr, x)], snr: [E(x), Ed(yp, x)], noisy: [E(x), E(nn)], h: harm(t, gtr) }
}

// ---- systems
const ident = async y => y
const kept = (name, p) => ({ name, key: name.replace(/[^a-z0-9]+/gi, '-') + Object.entries(p).map(([k, v]) => `-${k}${v}`).join(''), fn: rxRetry('Guitar De-noise', p) })
// RX as it ships: squeak on (sensitivity 3, reduction 4), pick and amp bypassed
export const RX = (p = {}, name) => kept(name || (Object.keys(p).length ? `RX tuned (${Object.entries(p).map(([k, v]) => `${k} ${v}`).join(', ')})` : 'RX defaults'), p)

// RX 12 Spectral De-noise on a print learned from the amp's second alone before the take: its Learn button is no plugin
// parameter, so bench/rx/denoise.py learns it as the plugin's adaptive mode does over the lead-in, then holds it (that
// file says how, and what it checked). The plugin path RX offers for amp noise: Guitar De-noise's Amp section learns
// only from its Learn button, and hosted it passes the take bit for bit at every setting.
let py, pending = [], seq = 0
function learnJob(j) {
  if (!py) {
    py = spawn(process.env.RX_PYTHON || path.join(os.homedir(), '.cache', 'audiojs', 'venv', 'bin', 'python'), [path.join(path.dirname(new URL(import.meta.url).pathname), 'denoise.py'), 'learn'], { stdio: ['pipe', 'pipe', 'ignore'] })
    createInterface({ input: py.stdout }).on('line', l => { let r = JSON.parse(l), p = pending.shift(); r.error ? p.reject(new Error(r.error)) : p.resolve(r.out) })
    py.on('exit', c => { for (let p of pending.splice(0)) p.reject(new Error(`denoise.py exited ${c}`)); py = null })
  }
  py.stdout.ref?.()
  return new Promise((resolve, reject) => { pending.push({ resolve, reject }); py.stdin.write(JSON.stringify(j) + '\n') }).finally(() => { if (!pending.length && py) { py.stdin.unref?.(); py.stdout.unref?.(); py.unref() } })
}
export const SDN = (p = {}) => ({
  name: `RX Spectral De-noise, learned${Object.keys(p).length ? ` (${Object.entries(p).map(([k, v]) => `${k} ${v}`).join(', ')})` : ''}`,
  key: 'sdnL' + Object.entries(p).map(([k, v]) => `-${k}${v}`).join(''),
  fn: async ({ ch, sr }) => {
    let tmp = path.join(DIR, 'tmp', `${process.pid}-${seq++}`), i = tmp + '-in.wav', o = tmp + '-out.wav'
    writeWav(i, ch, sr)
    try { await learnJob({ plugin: 'Spectral De-noise', params: p, lead: [0, 1], in: i, out: o }); return readWav(o) }
    finally { for (let f of [i, o]) existsSync(f) && rmSync(f) }
  }
})

// RX at the best SNR on tune (`node bench/rx/guitar.mjs tune squeak pick amp`, 2026-10-07); ours as the user sets it
const TUNED = {
  squeak: {},                                                     // its defaults: the grid's best (28.03 dB)
  pick: { squeak_bypass: true, pick_bypass: false, pick_sensitivity: 2, pick_attack: 0.1, pick_reduction: 5 },
  amp: { quality: 'Extreme', linked_reduction_db: 20 },           // Spectral De-noise, learned
}
const OURS = { squeak: 'desqueak()', pick: 'desqueak({ squeak: 0, pick: -9 })', amp: 'desqueak({ squeak: 0, amp: -20 })' }
// our scores are kept by the kernel they came from
const KERNEL = createHash('sha1').update(readFileSync(new URL('../../node_modules/@audio/denoise-desqueak/desqueak.js', import.meta.url))).digest('hex').slice(0, 8)

export async function run(sys, split, kind) {
  let T = takes(split), acc = { e0: 0, e1: 0, per: [], tf: [0, 0], snr: [0, 0], out: [0, 0], moved: 0, n: 0, err: [0, 0], attL: [], attH: [], susL: [], susH: [] }
  for (let [i, t] of T.entries()) {
    if (kind === 'squeak') {
      let d = squeaky(t, 100 + i), y = (await sys.fn({ ch: [d.y], sr: t.sr })).ch[0], m = squeakScore(t, d, y)
      acc.e0 += m.e0; acc.e1 += m.e1; acc.per.push(...m.per)
      for (let k of ['tf', 'snr', 'out']) acc[k][0] += m[k][0], acc[k][1] += m[k][1]
    } else if (kind === 'pick') {
      let d = picky(t, 200 + i), y = (await sys.fn({ ch: [d.y], sr: t.sr })).ch[0], m = pickScore(t, d, y)
      acc.e0 += m.e0; acc.e1 += m.e1; acc.per.push(...m.per); (acc.left ||= []).push(...m.left)
      for (let k of ['snr', 'out']) acc[k][0] += m[k][0], acc[k][1] += m[k][1]
    } else if (kind in AMP) {
      let m = await ampScore(sys, t, kind, 300 + i)
      for (let k of ['nd', 'gap', 'sdr', 'snr', 'noisy']) (acc[k] ||= [0, 0]), acc[k][0] += m[k][0], acc[k][1] += m[k][1]
      for (let k of ['attL', 'attH', 'susL', 'susH']) acc[k].push(...m.h[k].filter(Number.isFinite))
    } else if (kind === 'clean') {
      let z = (await sys.fn({ ch: [t.x], sr: t.sr })).ch[0], h = harm(t, z)
      acc.moved += h.moved * t.x.length; acc.n += t.x.length; acc.err[0] += E(t.x); acc.err[1] += Ed(t.x, z); for (let k of ['attL', 'attH', 'susL', 'susH']) acc[k].push(...h[k].filter(Number.isFinite))
    }
  }
  let big = v => v.filter(c => Math.abs(c) > 1).length / v.length
  if (kind === 'pick') return { gone: db(acc.e0 / acc.e1), med: median(acc.per), left: median(acc.left), snr: db(acc.snr[0] / acc.snr[1]), out: db(acc.out[0] / acc.out[1]), count: acc.per.length }
  if (kind in AMP) return { nd: db(acc.nd[0] / acc.nd[1]), gap: db(acc.gap[0] / acc.gap[1]), sdr: db(acc.sdr[0] / acc.sdr[1]), snr: db(acc.snr[0] / acc.snr[1]), input: db(acc.noisy[0] / acc.noisy[1]), ...Object.fromEntries(['attL', 'attH', 'susL', 'susH'].flatMap(k => [[k, median(acc[k].map(Math.abs))], [k + 'Big', big(acc[k])]])) }
  if (kind === 'squeak') return { gone: db(acc.e0 / acc.e1), med: median(acc.per), p10: pct(acc.per, 0.1), tf: db(acc.tf[0] / acc.tf[1]), snr: db(acc.snr[0] / acc.snr[1]), out: db(acc.out[0] / acc.out[1]), count: acc.per.length }
  return { moved: acc.moved / acc.n, err: db(acc.err[0] / acc.err[1]), ...Object.fromEntries(['attL', 'attH', 'susL', 'susH'].flatMap(k => [[k, median(acc[k].map(Math.abs))], [k + 'Big', big(acc[k])]])), notes: acc.attL.length }
}
export const score = (sys, split, kind) => sys.key ? scored(path.join(DIR, `scores-${split}.json`), `${kind}-${sys.key}`, () => run(sys, split, kind)) : run(sys, split, kind)

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  mkdirSync(DIR, { recursive: true })
  let [split = 'test', ...what] = process.argv.slice(2)
  let f1 = v => Number.isFinite(v) ? v.toFixed(1) : '∞', pc = v => (100 * v).toFixed(1) + ' %'
  if (split === 'tune' && what.includes('amp')) {
    for (let quality of ['Simple', 'Advanced', 'Extreme']) for (let linked_reduction_db of [12, 20, 30]) {
      let s = SDN({ quality, linked_reduction_db }), q = await score(s, 'tune', 'amp')
      console.error(s.name, f1(q.snr), f1(q.gap), f1(q.sdr), pc(q.susHBig))
    }
  }
  if (split === 'tune' && what.includes('pick')) {
    for (let [pick_sensitivity, pick_attack, pick_reduction] of [3, 6, 10].flatMap(s => [0.3, 1, 3].flatMap(a => [5, 10].map(r => [s, a, r]))).concat([0, 1, 2].flatMap(s => [0.1, 0.3].flatMap(a => [3, 5, 8].map(r => [s, a, r]))))) {
      let s = RX({ squeak_bypass: true, pick_bypass: false, pick_sensitivity, pick_attack, pick_reduction }), q = await score(s, 'tune', 'pick')
      console.error(s.name, f1(q.snr), f1(q.gone), f1(q.med), f1(q.left), f1(q.out))
    }
  }
  if (split === 'tune' && (!what.length || what.includes('squeak'))) {
    for (let squeak_sensitivity of [1, 3, 5, 7, 10]) for (let squeak_reduction of [2, 4, 6, 8, 10]) {
      let s = RX({ squeak_sensitivity, squeak_reduction }), q = await score(s, 'tune', 'squeak')
      console.error(s.name, f1(q.snr), f1(q.gone), f1(q.med), f1(q.tf), f1(q.out))
    }
  }
  const input = { name: 'input', fn: ident }, ours = s => ({ name: `ours, ${s}`, key: `ours-${s.replace(/[^a-z0-9]+/gi, '')}-${KERNEL}`, fn: op(s) })
  if (split === 'tune') {
    for (let [kind, s] of [['squeak', RX(TUNED.squeak)], ['pick', RX(TUNED.pick)], ['amp', SDN(TUNED.amp)]]) console.error('tuned', kind, s.name, JSON.stringify(await score(s, 'tune', kind)))
    // the squeaks as recorded on the tuning takes: what chose 45 ms as a squeak's least length (20 ms took the pick's
    // touch before a pluck down a median 5.8 dB)
    for (let s of [RX(), ours(OURS.squeak)]) { let r = await scored(path.join(DIR, 'scores-tune.json'), `real-${s.key}`, () => realScore(s, 'tune')); console.error('as recorded', s.name, 'squeaks', f1(median(r.squeak)), 'not', f1(median(r.not))) }
  }
  if (split !== 'test') process.exit(0)
  const f2 = v => Number.isFinite(v) ? v.toFixed(2) : '∞', T = takes('test'), mins = (T.reduce((s, t) => s + t.x.length / t.sr, 0) / 60).toFixed(1)
  if (!what.length || what.includes('squeak')) {
    let rows = []
    for (let s of [input, RX(), ours(OURS.squeak)]) {
      let q = await score(s, 'test', 'squeak'), c = await score(s, 'test', 'clean')
      rows.push([s.name, `${f1(q.gone)} · ${f1(q.med)}`, f1(q.tf), f1(q.snr), f1(q.out), pc(c.moved), pc(c.attHBig), pc(c.susHBig), `${pc(c.attLBig)} · ${pc(c.susLBig)}`])
    }
    console.log(`\nSqueaks: ${T.length} GuitarSet test takes (players 03–05, ${mins} min), ${(await score(input, 'test', 'squeak')).count} squeaks synthesized; RX tuned on players 00–02: its defaults (sensitivity 3, reduction 4) had the best SNR\n`)
    console.log(table(['', 'squeak error gone, pooled · median (dB)', 'its cells gone (dB)', 'SNR to the take (dB)', 'error elsewhere (dB under)', 'clean: samples moved', 'clean: attacks moved > 1 dB, partials over 1 kHz', 'sustains', 'under 1 kHz: attacks · sustains'], rows))
  }
  if (!what.length || what.includes('real')) {
    let rows = []
    for (let s of [RX(), ours(OURS.squeak)]) {
      let r = await scored(path.join(DIR, 'scores-test.json'), `real-${s.key}`, () => realScore(s, 'test')), sh = (v, d) => pc(v.filter(u => u >= d).length / v.length)
      rows.push([s.name, `${f1(median(r.squeak))} · ${sh(r.squeak, 3)}`, `${f1(median(r.not))} · ${sh(r.not, 1)}`])
    }
    console.log(`\nSqueaks as recorded: ${REAL.test.squeak.length} on the test takes, and ${REAL.test.not.length} plucks, strums and clicks both detectors mark\n`)
    console.log(table(['', 'squeaks: 1–10 kHz down, median · 3 dB or more', 'not squeaks: median · 1 dB or more'], rows))
  }
  if (!what.length || what.includes('pick')) {
    let rows = []
    for (let s of [input, RX({ squeak_bypass: true, pick_bypass: false }, 'RX, Pick on at its defaults'), RX(TUNED.pick), ours(OURS.pick)]) {
      let q = await score(s, 'test', 'pick'), c = s === input ? null : await score(s, 'test', 'clean')
      rows.push([s.name, `${f1(q.gone)} · ${f1(q.med)}`, f1(q.left), f1(q.snr), f1(q.out), c ? `${pc(c.attLBig)} · ${pc(c.susHBig)} · ${pc(c.susLBig)}` : ''])
    }
    console.log(`\nPicks: the same takes, ${(await score(input, 'test', 'pick')).count} attacks made 6–12 dB harsher over 2–10 kHz\n`)
    console.log(table(['', 'harshness gone, pooled · median (dB)', '2–10 kHz left over the take (dB)', 'SNR to the take (dB)', 'error elsewhere (dB under)', 'clean: moved > 1 dB, attacks under 1 kHz · sustains over · under'], rows))
  }
  if (!what.length || what.includes('amp')) {
    for (let cond of Object.keys(AMP)) {
      let rows = []
      for (let s of [input, RX({ squeak_bypass: true, amp_bypass: false }, 'RX Guitar De-noise, Amp on (any setting)'), SDN(), SDN(TUNED.amp), ours(OURS.amp)]) {
        let q = await score(s, 'test', cond)
        rows.push([s.name, f1(q.gap), f1(q.nd), f2(q.sdr), f1(q.snr), `${pc(q.attHBig)} · ${pc(q.susHBig)}`])
      }
      console.log(`\nAmp noise, ${cond} (${Object.entries(AMP[cond]).map(([k, v]) => `${k} ${v} dB`).join(', ')} under the take, 1 s of it alone first)\n`)
      console.log(table(['', 'noise down where heard (dB)', 'over the take (dB)', 'guitar SDR (dB)', 'SNR (dB)', 'partials over 1 kHz moved > 1 dB: attacks · sustains'], rows))
    }
  }
  process.exit(0)
}
