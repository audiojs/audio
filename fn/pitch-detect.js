/**
 * Pitch analysis — note events, chord sequence, key detection.
 *
 * a.stat('notes', opts)   → [{time, duration, freq, midi, note, clarity}]
 * a.stat('notes', { poly: true }) → [{time, duration, freq, midi, note, velocity, bends}]
 * a.stat('notes', { robust: true }) → as notes, through noise and rooms
 * a.stat('chords', opts)  → [{time, duration, label, root, quality, confidence}]
 * a.stat('key', opts)     → {tonic, mode, label, confidence}
 *
 * notes opts: { at, duration, minFreq=50, maxFreq=2000, frameSize, hopSize, minDuration=0.1 }
 * poly notes: Basic Pitch (Bittner et al., ICASSP 2022) through the optional
 *   @audio/neural-transcribe, loaded on first use (its model downloads once); takes
 *   { minFreq, maxFreq, minDuration, onsetThreshold, frameThreshold }. `bends` are cents from the
 *   note's pitch per 11.6 ms frame, in 33.3-cent steps; in-tune notes read 0.
 * robust notes: pYIN's stage 1 from the optional @audio/neural-pitch (loaded on first use, weights
 *   inside): a 6,066-parameter network's pitch posterior in place of YIN's candidates; the pitch HMM
 *   and Tony's note model stay. Vocadito note onsets, F: 0.76 against YIN's 0.53 at 0 dB SNR, 0.67
 *   against 0.63 in a measured room; clean, YIN ends notes better (offsets 0.65 against 0.61), so it
 *   stays the default (neural-pitch README, Benchmark).
 * chords and key: NNLS Chroma (Mauch & Dixon, ISMIR 2010) of the channels' mean, as the reference
 *   plugin computes it (c4dm/nnls-chroma, matched stage by stage): frames of `frameSize` (16384 at
 *   44.1 kHz, 0.34 to 0.51 s at other rates) every `hopSize` (frameSize/8), concert A read from the
 *   audio unless `tuning` (Hz) is given.
 * chords opts: { at, duration, frameSize, hopSize, tuning, boostN=0.1 }: Chordino's chord model on
 *   bass and treble chroma. quality: maj, min, 7, maj7, min7, maj6, min6, dim, aug, hdim7, or N;
 *   bass: the pitch class in the bass (label 'C/E'). The first frame is always N (its prior).
 * key opts: { at, duration, frameSize, hopSize, tuning, method='nnls' | 'pcp' }: Krumhansl-Schmuckler
 *   on the mean treble chroma ('pcp': Fujishima chroma of 4096-sample blocks).
 *
 * Chords and key are chroma analysis, loaded on first use: NNLS Chroma and Chordino
 * (@audio/mir-nnls-chroma, @audio/mir-chordino) are GPL-2.0-or-later and install by choice;
 * key's 'pcp' needs only the MIT @audio/mir-chroma and @audio/mir-key, installed with audio.
 */

import { notes as noteTracker, track } from '@audio/pitch-pyin'
import { name as midiToName } from '@audio/note'
import hann from 'window-function/hann'
import audio, { mono, pickChannels, perChannel } from '../core.js'

const need = (what, pkgs, p) => p.catch(e => { throw new Error(`${what}: install ${pkgs} (${e.message})`) })
const loadChords = () => need('chords', '@audio/mir-nnls-chroma @audio/mir-chordino (GPL-2.0-or-later)',
  Promise.all([import('@audio/mir-nnls-chroma'), import('@audio/mir-chordino')]))
const loadKey = pcp => pcp
  ? need('key', '@audio/mir-chroma @audio/mir-key', Promise.all([import('@audio/mir-chroma'), import('@audio/mir-key')]))
  : need('key', '@audio/mir-nnls-chroma (GPL-2.0-or-later) @audio/mir-key', Promise.all([import('@audio/mir-nnls-chroma'), import('@audio/mir-key')]))

let neural
const loadNeural = () => neural ??= import('@audio/neural-transcribe').then(m => m.default,
  e => { neural = null; throw new Error(`notes({ poly: true }): install @audio/neural-transcribe (${e.message})`) })

let stage1
const loadStage1 = () => stage1 ??= import('@audio/neural-pitch').then(m => m.candidates,
  e => { stage1 = null; throw new Error(`notes({ robust: true }): install @audio/neural-pitch (${e.message})`) })

let wins = {}
let hannWin = n => wins[n] || (wins[n] = Float32Array.from({ length: n }, (_, i) => hann(i, n)))

/** NNLS chromagram of the range, and where it ends (s). */
async function chromagramOf(inst, opts, chromagram) {
  let write = chromagram({ fs: inst.sampleRate, blockSize: opts?.frameSize, stepSize: opts?.hopSize, tuning: opts?.tuning }), n = 0
  for await (let m of mono(inst, opts)) { write(m); n += m.length }
  return { ...write(), end: n / inst.sampleRate }
}

// ── Contour — a voice's pitch as it goes ────────────────────────

/** A voice's pitch every `hop` s over one channel `x` at `fs`: { times (s, each frame's centre), f0 (Hz, 0 where there
 *  is none) }. pYIN's Viterbi path (Mauch & Dixon, ICASSP 2014), from `minFreq` to `maxFreq`, on `x` averaged in
 *  groups to about 11 kHz (a voice's pitch stays under 1 kHz); a frame whose peak is under 0.03 of the loudest is
 *  silent, as Praat's silence threshold has it (Boersma 1993), for pYIN's model holds its lowest pitch through a pause.
 *  On a lecture against Praat (Sound: To Pitch (ac), 60 to 600 Hz): 85% of its voiced frames found, 10 cents from it
 *  in the median, 6% of its unvoiced ones taken for voiced; YIN's dip under .15 finds 45%. */
export function contour(x, fs, { hop = .01, minFreq = 60, maxFreq = 1000 } = {}) {
  let d = Math.max(1, Math.floor(fs / 11025)), fsd = fs / d, y = new Float32Array(Math.floor(x.length / d)), top = 0
  for (let i = 0; i < y.length; i++) { let s = 0; for (let j = 0; j < d; j++) s += x[i * d + j]; y[i] = s / d; top = Math.max(top, Math.abs(y[i])) }
  let H = Math.max(1, Math.round(hop * fsd)), { times, f0 } = track(y, { fs: fsd, minFreq, maxFreq, hopSize: H })
  // the frame's peak, over its YIN window either side of its centre
  let W = 2 ** Math.ceil(Math.log2(2 * fsd / minFreq)) >> 1
  for (let i = 0; i < f0.length; i++) {
    if (!f0[i]) continue
    let c = Math.round(times[i] * fsd), m = 0
    for (let k = Math.max(0, c - W); k < Math.min(y.length, c + W); k++) m = Math.max(m, Math.abs(y[k]))
    if (m < .03 * top) f0[i] = 0
  }
  return { times: Float32Array.from(times), f0 }
}

// ── Notes — monophonic pitch events ─────────────────────────────

audio.stat('notes', {})
audio.stat('chords', {})
audio.stat('key', {})

// pYIN's Viterbi-smoothed f0 of the channels' mean, segmented by Tony's note HMM (@audio/pitch-pyin): vibrato and
// scoops stay inside a note, a note played again on its pitch splits at the level rise.
// Frames stream through, so memory holds the notes, not the audio. `robust` hands the HMM a
// network's candidates instead of YIN's (pitch-pyin's `candidates` hook).
audio.fn.notes = perChannel(async function(opts) {
  if (opts?.poly) return polyNotes(this, opts)
  let write = noteTracker({ ...opts, fs: this.sampleRate, ...(opts?.robust && { candidates: await loadStage1() }) }), events = []
  for await (let m of mono(this, opts)) events.push(...write(m))
  events.push(...write())
  return events.map(({ time, duration, freq, midi, clarity }) => ({ time, duration, freq, midi, note: midiToName(midi), clarity }))
})

// Polyphonic: Basic Pitch reads the whole range at once (its posteriors take about 9 MB per
// minute). Times are relative to `at`, as in the monophonic path.
async function polyNotes(inst, { at, duration, channel, poly, frameSize, hopSize, ...opts }) {
  let transcribe = await loadNeural()
  let notes = await transcribe(pickChannels(await inst.read({ at, duration }), channel), { ...opts, sampleRate: inst.sampleRate })
  return notes.map(({ time, duration, freq, midi, velocity, bends }) => ({ time, duration, freq, midi, note: midiToName(midi), velocity, bends }))
}

// ── Chords — Chordino on NNLS chroma ────────────────────────────

audio.fn.chords = perChannel(async function(opts) {
  let [{ default: chromagram }, { default: chordino }] = await loadChords()
  let cg = await chromagramOf(this, opts, chromagram)
  // silence has no chords
  if (!cg.treble.some(c => c.some(v => v > 0))) return []
  return chordino(cg, { boostN: opts?.boostN, end: cg.end })
})

// ── Key — Krumhansl-Schmuckler on the mean chroma ───────────────

audio.fn.key = perChannel(async function(opts) {
  let pcp = opts?.method === 'pcp', [{ default: chroma }, { default: key }] = await loadKey(pcp)
  let avg = new Float64Array(12), sum = 0
  if (pcp) {
    let N = opts?.frameSize ?? 4096, win = hannWin(N), buf = new Float32Array(N), fill = 0
    for await (let m of mono(this, opts)) for (let i = 0; i < m.length; i++) {
      buf[fill] = m[i] * win[fill]
      if (++fill < N) continue
      let c = chroma(buf, { fs: this.sampleRate })
      for (let k = 0; k < 12; k++) avg[k] += c[k]
      fill = 0
    }
  } else {
    for (let c of (await chromagramOf(this, opts, chroma)).treble) for (let k = 0; k < 12; k++) avg[k] += c[k]
  }
  for (let k = 0; k < 12; k++) sum += avg[k]
  if (!sum) return { tonic: -1, mode: 'major', label: 'N', confidence: 0 }
  return key(avg)
})
