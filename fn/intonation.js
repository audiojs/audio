/**
 * Intonation — a voice's rises and falls made wider or flatter about its median pitch: more or less melody in its
 * speech; its timing, formants and consonants kept.
 *
 * a.intonation(1.5)                 → every rise and fall half as wide again
 * a.intonation(0, { at: 2, d: 3 })  → 2–5 s on one pitch, the voice's median there
 *
 * factor: how far each voiced moment's pitch lies from the median, in semitones, as a multiple of how far it lay:
 * 1 changes nothing, 0 is a monotone, below 0 turns rises into falls (Praat's Change gender, its pitch range factor;
 * Melodyne's Pitch Modulation).
 * The range's pitch, contour() every 5 ms (pYIN); the median of its voiced frames; each voiced frame moved by
 * (factor − 1) times its distance from it, a gap crossed straight from the move before it to the one after; then
 * pitch() along those moves, a voice's own glottal cycles re-spaced ({ voice: true }, @audio/tune-curve), which
 * glides into the range and out of it. One voice. The range is read whole first.
 */
import audio, { resolveChannels } from '../core.js'
import { render } from '../plan.js'
import { contour } from './pitch-detect.js'

// frames of the pitch, s; what pitch() reads before and after the range (its context, a frame and two cycles at
// 60 Hz, and its crossfades), s
const HOP = .005, CONTEXT = .2

function intonation(input, output, ctx) {
  for (let c = 0; c < input.length; c++) output[c].set(input[c])
  let k = +ctx.factor, sr = ctx.sampleRate, n = input[0].length
  if (!Number.isFinite(k) || k === 1 || !n) return
  let at = ctx.at == null ? 0 : ctx.at < 0 ? n / sr + ctx.at : ctx.at
  let a0 = Math.max(0, Math.round(at * sr)), a1 = Math.min(n, ctx.duration == null ? n : a0 + Math.round(ctx.duration * sr))
  if (a1 <= a0) return
  // the voice: the channels' mean over the range, and its pitch in semitones (NaN unvoiced)
  let { chs } = resolveChannels(ctx.channel, input.length), x = new Float32Array(a1 - a0)
  for (let c of chs) for (let i = 0; i < x.length; i++) x[i] += input[c][a0 + i] / chs.length
  let { times, f0 } = contour(x, sr, { hop: HOP }), st = Array.from(f0, f => f > 0 ? 12 * Math.log2(f) : NaN)
  let voiced = st.filter(s => s === s).sort((p, q) => p - q)
  if (!voiced.length) return
  // each frame's move: a voiced one's own; a gap's straight between the moves either side (past the first and last
  // voiced frames, theirs)
  let mid = voiced[voiced.length >> 1], move = st.map(s => s === s ? (k - 1) * (s - mid) : NaN), last = -1
  for (let i = 0; i <= move.length; i++) {
    if (i < move.length && move[i] !== move[i]) continue
    let from = last < 0 ? move[i] : move[last], to = i < move.length ? move[i] : from
    for (let j = last + 1; j < i; j++) move[j] = from + (to - from) * (j - last) / (i - last)
    last = i
  }
  // pitch() over the range, with its context around it, on its own timeline from p0
  let pitch = audio.op('pitch'), engine = audio.op('intonation').mod
  if (!engine) throw new Error('intonation: install @audio/tune-curve')
  pitch.mod ??= engine
  let p0 = Math.max(0, a0 - Math.round(CONTEXT * sr)), p1 = Math.min(n, a1 + Math.round(CONTEXT * sr)), off = (a0 - p0) / sr
  let y = render(audio.from(chs.map(c => input[c].slice(p0, p1)), { sampleRate: sr })
    .pitch({ t: Array.from(times, ti => off + ti), v: move }, { voice: true, at: off, duration: (a1 - a0) / sr }))
  chs.forEach((c, j) => output[c].set(y[j], p0))
}

audio.op('intonation', {
  params: ['factor'],
  // pitch({ voice: true })'s engine, which it runs
  load: () => import('@audio/tune-curve').catch(() => null),
  whole: intonation
})
