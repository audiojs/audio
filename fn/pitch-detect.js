/**
 * Pitch analysis — note events, chord sequence, key detection.
 *
 * a.stat('notes', opts)   → [{time, duration, freq, midi, note, clarity}]
 * a.stat('chords', opts)  → [{time, duration, label, root, quality, confidence}]
 * a.stat('key', opts)     → {tonic, mode, label, confidence}
 *
 * notes opts: { at, duration, frameSize=2048, hopSize, threshold=0.15, minClarity=0.5 }
 * chords opts: { at, duration, frameSize=4096, hopSize, method='nnls', selfProb }
 * key opts: { at, duration, frameSize=4096, method='nnls' }
 */

import { yin, chroma, chord, smoothChords, key } from 'pitch-detection'
import hann from 'window-function/hann'
import { analyzeBlocks } from './spectrum.js'
import audio from '../core.js'

const NOTES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
const toMidi = f => 69 + 12 * Math.log2(f / 440)
const toNote = midi => NOTES[((midi % 12) + 12) % 12] + ((midi / 12 | 0) - 1)

let wins = {}
let hannWin = n => wins[n] || (wins[n] = Float32Array.from({ length: n }, (_, i) => hann(i, n)))

/** Stream ch0 with overlapping frames of size N, hop H. */
async function streamFrames(inst, opts, N, hop, fn) {
  let rem = new Float32Array(0), pos = 0
  for await (let pcm of inst.stream({ at: opts?.at, duration: opts?.duration })) {
    let ch0 = pcm[0]
    if (!ch0?.length) continue
    let input = ch0
    if (rem.length) {
      input = new Float32Array(rem.length + ch0.length)
      input.set(rem, 0)
      input.set(ch0, rem.length)
    }
    let off = 0
    while (off + N <= input.length) {
      fn(input.subarray(off, off + N), pos / inst.sampleRate)
      off += hop
      pos += hop
    }
    rem = off < input.length ? input.slice(off) : new Float32Array(0)
  }
}

// ── Notes — monophonic pitch events ─────────────────────────────

audio.fn.notes = async function(opts) {
  let sr = this.sampleRate
  let N = opts?.frameSize ?? 2048
  let hop = opts?.hopSize ?? (N >> 1)
  let threshold = opts?.threshold ?? 0.15
  let minClarity = opts?.minClarity ?? 0.5
  let hopSec = hop / sr

  let events = [], cur = null
  let push = () => {
    if (!cur) return
    events.push({
      time: cur.time, duration: cur.end - cur.time,
      freq: cur.fs / cur.n, midi: cur.midi, note: cur.note, clarity: cur.cs / cur.n
    })
  }

  await streamFrames(this, opts, N, hop, (frame, time) => {
    let r = yin(frame, { fs: sr, threshold })
    if (r && r.clarity >= minClarity) {
      let midi = Math.round(toMidi(r.freq))
      if (cur && cur.midi === midi) {
        cur.end = time + hopSec; cur.fs += r.freq; cur.cs += r.clarity; cur.n++
      } else {
        push()
        cur = { time, end: time + hopSec, midi, note: toNote(midi), fs: r.freq, cs: r.clarity, n: 1 }
      }
    } else { push(); cur = null }
  })
  push()

  return events
}

// ── Chords — chord sequence via chroma + Viterbi ────────────────

audio.fn.chords = async function(opts) {
  let sr = this.sampleRate
  let N = opts?.frameSize ?? 4096
  let hop = opts?.hopSize ?? (N >> 1)
  let method = opts?.method ?? 'nnls'
  let hopSec = hop / sr, win = hannWin(N)

  let frames = [], buf = new Float32Array(N)
  await streamFrames(this, opts, N, hop, (frame, time) => {
    for (let i = 0; i < N; i++) buf[i] = frame[i] * win[i]
    frames.push({ time, chroma: chroma(buf, { fs: sr, method }) })
  })
  if (!frames.length) return []

  // All-silent frames → empty (Viterbi can't produce 'N')
  let hasEnergy = false
  for (let f of frames) { for (let v of f.chroma) if (v > 0) { hasEnergy = true; break }; if (hasEnergy) break }
  if (!hasEnergy) return []

  let smoothed = smoothChords(frames.map(f => f.chroma), { selfProb: opts?.selfProb })

  // Collapse consecutive identical chords with mean confidence
  let result = []
  for (let i = 0; i < smoothed.length; i++) {
    let s = smoothed[i], last = result[result.length - 1]
    let conf = chord(frames[i].chroma, { minConfidence: 0 }).confidence
    if (last && last.label === s.label) {
      last.duration = frames[i].time + hopSec - last.time
      last._cs += conf; last._cn++
    } else {
      result.push({ time: frames[i].time, duration: hopSec, ...s, confidence: conf, _cs: conf, _cn: 1 })
    }
  }
  for (let r of result) { r.confidence = r._cs / r._cn; delete r._cs; delete r._cn }

  return result
}

// ── Key — musical key via Krumhansl-Schmuckler ──────────────────

audio.fn.key = async function(opts) {
  let sr = this.sampleRate
  let N = opts?.frameSize ?? 4096
  let method = opts?.method ?? 'nnls'
  let win = hannWin(N), buf = new Float32Array(N)

  let { acc, cnt } = await analyzeBlocks(this, opts, N, 12, (block, acc) => {
    for (let i = 0; i < N; i++) buf[i] = block[i] * win[i]
    let c = chroma(buf, { fs: sr, method })
    for (let i = 0; i < 12; i++) acc[i] += c[i]
  })

  if (!cnt) return { tonic: -1, mode: 'major', label: 'N', confidence: 0 }

  let avg = new Float64Array(12), sum = 0
  for (let i = 0; i < 12; i++) { avg[i] = acc[i] / cnt; sum += avg[i] }
  if (!sum) return { tonic: -1, mode: 'major', label: 'N', confidence: 0 }

  return key(avg)
}
