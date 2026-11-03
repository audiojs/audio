/**
 * Intonation: a voice's pitch made wider or flatter layer by layer (its melody about its median; in each note sung, its
 * centre about its note, its slow drift about its centre, its vibrato about its own line), its timing, formants and
 * consonants kept.
 *
 * a.intonation(1.5)                 → every rise and fall half as wide again
 * a.intonation(0, { at: 2, d: 3 })  → 2–5 s on one pitch, the voice's median there
 * a.modulation(0)                   → each note a smooth line: its vibrato and wobble gone, its drift kept
 * a.modulation(2)                   → each note's vibrato twice as wide
 * a.drift(0)                        → each note held at its centre, its vibrato kept
 * a.center(0)                       → each note's centre on its semitone, all that moves inside it kept
 * a.center(.5, { scale: 'major', root: 2 }) → half way onto D major's nearest notes
 *
 * factor: how far each layer lies from what it is measured about, as a multiple of how far it lay: 1 changes nothing,
 * 0 lays it on that, 2 doubles it, below 0 inverts it about it. intonation: each voiced moment's pitch about the range's
 * median (Praat's Change gender, its pitch range factor). center: a note's centre, the median of its middle half (past
 * the glides into and out of it), about the nearest note of `scale` (@audio/note's names, or degrees in semitones,
 * chromatic by default) up from `root` (semitones above C), A4 at `a4` Hz (440). drift: the note's own line about its
 * centre. modulation: the note's pitch about its own line. Melodyne's Pitch Center, Pitch Drift and Pitch Modulation,
 * 100% each 1 (helpcenter.celemony.com, Melodyne 5, Pitch modulation and drift); drift(0) with modulation(0) is a note
 * held flat at its centre.
 * The pitch, contour() every 5 ms (pYIN), over the range and half a second either side. The notes sung, Tony's (Mauch
 * et al., TENOR 2015; stat('notes'), the editor's notes): its stable state spreads 0.8 semitones, so a held note stays
 * one however it drifts or swings (a Viterbi over the semitones split a note drifting across the midpoint, and drift(0)
 * held each piece at its own centre: steps). A note's own line: its pitch less its centre, a mean over its vibrato's
 * period taken twice, a triangle that takes out that rate and its harmonics; the period where its fast part best
 * matches itself, 3.5 to 8.5 Hz, else 5.5 Hz's (which leaves 5% at most of a vibrato 4.5 to 8 Hz); past its ends, the
 * median of its first and last period. Each moment's move, (factor − 1) times its layer; where two notes
 * meet, one's crossing to the next's over a raised cosine 100 ms long (inside the gap between them, a quarter of either
 * at most), about the time a voice takes to move a semitone (Xu & Sun, JASA 111, 2002); between notes and past them,
 * straight from one's to the next's. Outside the range none; inside it the moves rise over 100 ms (a quarter of the
 * range at most) where the voice runs on across its edge, and at once where it starts or stops there. Then pitch()
 * along them, a voice's own glottal cycles re-spaced ({ voice: true }, @audio/tune-curve). One voice; the range is read
 * whole first.
 */
import audio, { resolveChannels } from '../core.js'
import { render, spanOf } from '../plan.js'
import { contour } from './pitch-detect.js'
import { notes as noted } from '@audio/pitch/pyin'

// frames of the pitch, s; what is read either side of the range (the notes across its edges whole, and pitch()'s
// context), s
const HOP = .005, CONTEXT = .5
// s: how much voice either side of a range's edge makes the voice run on across it
const BRIDGE = .03
// s: the vibrato's period unless another is found, and those looked for, 8.5 to 3.5 Hz
const PERIOD = 1 / 5.5, FASTEST = 1 / 8.5, SLOWEST = 1 / 3.5
// s: how long a move takes to change, from one note's to the next's, or into the range
const CROSS = .1

const rise = u => u <= 0 ? 0 : u >= 1 ? 1 : .5 - .5 * Math.cos(Math.PI * u)

// the median of the voiced values of x[a..b), undefined if none
function median(x, a = 0, b = x.length) {
  let v = []
  for (let i = a; i < b; i++) if (x[i] === x[i]) v.push(x[i])
  return v.sort((p, q) => p - q)[v.length >> 1]
}

// x with each gap (NaN) straight from the value before it to the one after, past the first and the last held; null if
// all of it is a gap
function fill(x) {
  let last = -1
  for (let i = 0; i <= x.length; i++) {
    if (i < x.length && x[i] !== x[i]) continue
    if (i === x.length && last < 0) return null
    let from = last < 0 ? x[i] : x[last], to = i < x.length ? x[i] : from
    for (let j = last + 1; j < i; j++) x[j] = from + (to - from) * (j - last) / (i - last)
    last = i
  }
  return x
}

// a mean of x over P frames from i + lo, at each i (the window cut at x's ends)
function box(x, lo, P) {
  let n = x.length, s = new Float64Array(n + 1), out = new Float64Array(n)
  for (let i = 0; i < n; i++) s[i + 1] = s[i] + x[i]
  for (let i = 0; i < n; i++) { let a = Math.max(0, i + lo), b = Math.min(n, i + lo + P); out[i] = (s[b] - s[a]) / (b - a) }
  return out
}

// x smoothed by a triangle 2P − 1 frames wide: a mean over P frames, twice, the second half a frame back of the first
// where P is even, so the two centre; past its ends x held at the median of its first and last P frames
function tri(x, P) {
  let n = x.length, h = Math.min(P, n), pad = 2 * P, y = new Float64Array(n + 2 * pad)
  y.fill(median(x, 0, h), 0, pad); y.set(x, pad); y.fill(median(x, n - h, n), pad + n)
  return box(box(y, -(P >> 1), P), -((P - 1) >> 1), P).subarray(pad, pad + n)
}

// A note's vibrato period, frames: the lag at which its fast part (its pitch less a triangle over 5.5 Hz's period)
// best matches itself, 8.5 to 3.5 Hz and half the note at most, if that correlation is over .5; else 5.5 Hz's. A lag of
// two periods found is as good: the triangle takes out the rate's harmonics too
function periodOf(dev, hop) {
  let p0 = Math.round(PERIOD / hop), s = tri(dev, p0), e = dev.map((v, i) => v - s[i]), best = .5, lag = p0
  for (let L = Math.round(FASTEST / hop); L <= Math.min(Math.round(SLOWEST / hop), dev.length >> 1); L++) {
    let xy = 0, xx = 0, yy = 0
    for (let i = 0; i + L < e.length; i++) { xy += e[i] * e[i + L]; xx += e[i] * e[i]; yy += e[i + L] * e[i + L] }
    let r = xy / Math.sqrt(xx * yy || 1)
    if (r > best) { best = r; lag = L }
  }
  return lag
}

/** A note's layers over frames [a, b) of a voice's pitch `st` (semitones a frame, NaN unvoiced, a frame every `hop` s):
 *  { a, b, c (its centre, semitones), dev (its pitch less c, a frame each, straight across a gap), line (dev's own slow
 *  line), period (its vibrato's, s) }, null if none of it is voiced. */
export function layer(st, a, b, hop = HOP) {
  while (a < b && st[a] !== st[a]) a++
  while (b > a && st[b - 1] !== st[b - 1]) b--
  if (b - a < 2) return null
  let n = b - a, q = n >> 2, c = median(st, a + q, b - q) ?? median(st, a, b)
  let dev = fill(Float64Array.from(st.subarray(a, b), v => v - c)), P = periodOf(dev, hop)
  return { a, b, c, dev, line: tri(dev, P), period: P * hop }
}

// The notes the voice `x` (at `sr`) sings, in the layers of its pitch `st`, frames `hop` s apart: Tony's (stat('notes'),
// the editor's notes), whose frames hold a held note whole however it drifts
function notesOf(x, sr, st, hop) {
  return noted(x, { fs: sr }).map(({ time, duration }) =>
    layer(st, Math.max(0, Math.ceil(time / hop)), Math.min(st.length, Math.floor((time + duration) / hop) + 1), hop)).filter(Boolean)
}

// Each note's moves, `of(note)`: one for all its frames or one a frame; where two notes meet, one's crossing to the
// next's over CROSS, inside the gap between them, a quarter of either at most (@audio/tune-snap's); between notes and
// past them straight on. Null without notes
function noteMoves(T, notes, of, hop) {
  if (!notes.length) return null
  let move = new Float64Array(T).fill(NaN), mv = notes.map(g => { let m = of(g); return typeof m === 'number' ? new Float64Array(g.b - g.a).fill(m) : m })
  notes.forEach((g, k) => move.set(mv[k], g.a))
  for (let k = 0; k + 1 < notes.length; k++) {
    let g = notes[k], h = notes[k + 1], e = Math.max(0, Math.min(CROSS / hop / 2 - (h.a - g.b) / 2, (g.b - g.a) / 4, (h.b - h.a) / 4))
    if (!e) continue
    let a = g.b - e, b = h.a + e, p = mv[k], q = mv[k + 1]
    for (let i = Math.ceil(a); i < b; i++) {
      let from = p[Math.min(i, g.b - 1) - g.a], to = q[Math.max(i, h.a) - h.a]
      move[i] = from + (to - from) * rise((i + .5 - a) / (b - a))
    }
  }
  return fill(move)
}

// The layers' moves, by the op, of the voice { st, hop, inside (whether a frame is in the range), notes() }: a move a
// frame, semitones, or null for none
const LAYERS = {
  // each voiced frame about the range's median
  intonation({ st, inside }, k) {
    let mid = median(st.filter((_, i) => inside(i)))
    return mid === undefined ? null : fill(st.map(s => (k - 1) * (s - mid)))
  },
  modulation: (v, k) => noteMoves(v.st.length, v.notes(), g => g.dev.map((d, i) => (k - 1) * (d - g.line[i])), v.hop),
  drift: (v, k) => noteMoves(v.st.length, v.notes(), g => g.line.map(l => (k - 1) * l), v.hop),
  // the scale's note nearest the centre (of two as near, the lower)
  center(v, k, { scale = 'chromatic', root = 0 }) {
    let deg = typeof scale === 'string' ? (scale === 'chromatic' ? [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] : SCALES?.[scale]) : scale
    if (!deg?.length) throw new RangeError(SCALES ? `center: unknown scale '${scale}': ${Object.keys(SCALES).join(', ')}` : `center: scale '${scale}' needs @audio/note`)
    let r = ((Math.round(root) % 12) + 12) % 12, on = m => deg.includes(((m - r) % 12 + 12) % 12)
    let target = c => { let best = NaN; for (let m = Math.floor(c) - 6; m <= Math.ceil(c) + 6; m++) if (on(m) && !(Math.abs(m - c) >= Math.abs(best - c))) best = m; return best }
    return noteMoves(v.st.length, v.notes(), g => (k - 1) * (g.c - target(g.c)), v.hop)
  }
}
// scales by name, @audio/note's, loaded with center()
let SCALES

// The range's voice, its pitch, and pitch() along the moves its layer makes: none outside the range, rising over CROSS
// where the voice runs on across an edge (BRIDGE of it either side), at once where it does not
function reshape(name) {
  return (input, output, ctx) => {
    for (let c = 0; c < input.length; c++) output[c].set(input[c])
    let k = +ctx.factor, sr = ctx.sampleRate, n = input[0].length
    if (!Number.isFinite(k) || k === 1 || !n) return
    let [a0, a1] = spanOf(n, ctx.at, ctx.duration, sr)
    if (a1 <= a0) return
    // the voice: the channels' mean over the range and its context, and its pitch in semitones from A4 (NaN unvoiced)
    let p0 = Math.max(0, a0 - Math.round(CONTEXT * sr)), p1 = Math.min(n, a1 + Math.round(CONTEXT * sr))
    let { chs } = resolveChannels(ctx.channel, input.length), x = new Float32Array(p1 - p0), a4 = +ctx.a4 || 440
    for (let c of chs) for (let i = 0; i < x.length; i++) x[i] += input[c][p0 + i] / chs.length
    let { times, f0 } = contour(x, sr, { hop: HOP }), hop = times.length > 1 ? times[1] - times[0] : HOP
    let st = Float64Array.from(f0, f => f > 0 ? 69 + 12 * Math.log2(f / a4) : NaN)
    // the range, s0 to s1 s on this timeline, its frames [i0, i1), and how much of its move each takes
    let s0 = (a0 - p0) / sr, s1 = (a1 - p0) / sr, i0 = times.findIndex(t => t >= s0), i1 = times.findIndex(t => t >= s1)
    if (i0 < 0) return
    if (i1 < 0) i1 = times.length
    let move = LAYERS[name]({ st, hop, inside: i => i >= i0 && i < i1, notes: () => notesOf(x, sr, st, hop) }, k, ctx)
    if (!move) return
    let b = Math.round(BRIDGE / hop), R = Math.max(1, Math.min(CROSS / hop, (i1 - i0) / 4))
    let across = i => { for (let j = i - b; j < i + b; j++) if (j < 0 || j >= st.length || st[j] !== st[j]) return false; return true }
    let rin = across(i0), rout = across(i1)
    let v = Array.from(move, (m, i) => i < i0 || i >= i1 ? 0 : m * Math.min(rin ? rise((i - i0 + .5) / R) : 1, rout ? rise((i1 - i - .5) / R) : 1))
    if (!v.some(Boolean)) return
    // 0 at the range's ends themselves, so what pitch() shifts starts and stops there
    let t = Array.from(times)
    if (i1 < t.length && t[i1] > s1) { t.splice(i1, 0, s1); v.splice(i1, 0, 0) }
    if (t[i0] > s0) { t.splice(i0, 0, s0); v.splice(i0, 0, 0) } else v[i0] = 0
    // pitch() along them over the range and its context, on its own timeline from p0: where they are 0 the input
    let pitch = audio.op('pitch'), engine = audio.op(name).mod
    if (!engine) throw new Error(`${name}: install @audio/tune`)
    pitch.mod ??= engine
    let y = render(audio.from(chs.map(c => input[c].slice(p0, p1)), { sampleRate: sr }).pitch({ t, v }, { voice: true }))
    chs.forEach((c, j) => output[c].set(y[j], p0))
  }
}

// pitch({ voice: true })'s engine, which they run
const curve = () => import('@audio/tune/curve').catch(() => null)
for (let name of ['intonation', 'modulation', 'drift', 'center']) audio.op(name, {
  params: ['factor'],
  load: name === 'center' ? () => import('@audio/note').then(m => { SCALES = m.SCALES }, () => {}).then(curve) : curve,
  whole: reshape(name)
})
