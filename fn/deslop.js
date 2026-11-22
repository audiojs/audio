/**
 * Deslop: a generated track (Suno, Udio and their kind) remastered by what it carries. A first hand.
 *
 * a.deslop()                        → what the track's own measurements ask for, then -14 LUFS under -1 dBTP
 * a.deslop({ intensity: 0.5 })      → the stages that shape the sound at half their depth
 * a.deslop({ target: 'podcast' })   → to another of normalize()'s loudness targets
 * await a.stat('slop')              → the measurements and the stages they plan, each with its reason; nothing changed
 *
 * Each stage is one of this library's own edits, planned from a measurement of the sound that reaches it, and none runs
 * without its evidence: `stat('slop')` gives `{ evidence, stages: [{ op, args, call, why }], code }`, `code` the chain as
 * calls to paste in deslop()'s place and change. In order:
 *
 *   declip      samples piled at full scale in runs (RUNS runs of three or more): a master pushed into its ceiling
 *   deconstruct the noise part of the top lowered, where 5 to 10 kHz reads as noise in nearly every frame. Each frame's
 *               spectral flatness there (the geometric over the arithmetic mean of its power bins: Johnston 1988; 1 a flat
 *               spectrum, a Hann frame of white noise about 0.56, e^-γ), over the louder half of the frames, at its 10th
 *               percentile: music with notes and silences in its top falls low there, a top filled with a steady hiss
 *               does not. From HAZE.from, up to HAZE.most dB at HAZE.full, the noise part alone, over 4 kHz
 *               (deconstruct()'s `band`): what holds a pitch and what strikes stay
 *   eq          a band over the 0.5 to 2 kHz band by more than finished music keeps it, cut by the excess, CUT dB at most
 *   normalize   the loudness a streaming service plays at, under its true-peak ceiling
 *
 * A stage needs the band it reads to be there: the haze stage a top within 40 dB of the 0.5 to 2 kHz band (under that
 * nothing of it is heard, and its flatness is the flatness of a floor), the tone stage a 0.5 to 2 kHz band within 20 dB
 * of the whole sound's level (a bell alone, a bass alone, has no such body to read a band against). Guards, not
 * figures of the reference set.
 *
 * The figures finished music keeps (KEPT) are the 90th percentiles of 23 productions under Creative Commons licences
 * (Josh Woodward, Chris Zabriskie, Scott Holmes, Tours: the Internet Archive's copies, the middle 120 s of each), set
 * against 16 generated tracks (Suno, Udio, Treblo, Tencent's song model: Wikimedia Commons' files and a cleaner's two
 * demos), measured 22 Nov 2026: audiojs.github.io .work/deslop/ holds the lists, the scripts and every figure. On them
 * the two sets differ less than their sellers' pages say: band levels, stereo width, crest and loudness range overlap;
 * the top's flatness is what parts them (10th percentile 0.23 against 0.14 in the middle of each set; 7 of the 16 over
 * 0.25, 2 of the 23), and one of the 23, a dense rock mix, reads as the haziest generated ones do: the measure says
 * what a top is made of, not who made it.
 *
 * What it leaves, by measurement: the faint steady lines a generator's decoder leaves at multiples of its frame rate
 * (Afchar, Meseguer-Brocal, Akesbi & Hennequin, "A Fourier Explanation of AI-music Artifacts", ISMIR 2025; on Suno's
 * files here every 200 Hz, 3 to 10 dB over the averaged spectrum round them) each stand 20 dB or more under the music in
 * their own critical band: nothing heard, so nothing is taken, and the file keeps what a service reads it by. It writes
 * no tag and removes none. It cannot give back what a generator never made: a top lowered is not a top repaired.
 * Not yet judged by ear: the depths are a first hand's.
 */
import audio, { emit } from '../core.js'
import { prepared, playback } from '../plan.js'
import { downmix, hann } from './dsp.js'
import { LOUDNESS, ALIAS } from './specs.js'
import { fft } from 'fourier-transform'
import './declip.js'
import './deconstruct.js'
import './filter.js'
import './normalize.js'

const MADE = Symbol('deslop.made')
// what finished music keeps, the reference set's 90th percentiles: each band's level over the 0.5 to 2 kHz band's, dB,
// and the top's flatness
export const KEPT = { pres: -1.5, high: -10.2, air: -17.0, flat: 0.22 }
// the bands the tone stage reads, and where it cuts each: its edges Hz, then the cut's centre Hz and Q
const BANDS = { pres: [2000, 6000, 3500, 0.9], high: [6000, 12000, 8500, 0.9], air: [12000, 16000, 14000, 1.2] }
// the haze stage: none under `from`, `most` dB of the noise part at `full` and over; a stage under `least` dB is not planned
const HAZE = { from: 0.25, full: 0.40, most: -6, least: 2, band: 4000 }
const CUT = 4, RUNS = 20, RAIL = 0.999
// a band is there to be read: the top over the body, the body over the whole sound, dB
const THERE = { top: -40, body: -20 }
const db = p => 10 * Math.log10(p + 1e-30)

/** Welch power spectrum of x: Hann frames of N, half overlapped → power a bin, 0..N/2 */
function welch(x, N) {
  let w = hann(N), P = new Float64Array(N / 2 + 1), buf = new Float64Array(N), n = 0
  for (let s = 0; s + N <= x.length; s += N / 2, n++) {
    for (let i = 0; i < N; i++) buf[i] = x[s + i] * w[i]
    let [re, im] = fft(buf)
    for (let k = 0; k <= N / 2; k++) P[k] += re[k] * re[k] + im[k] * im[k]
  }
  if (n) for (let k = 0; k <= N / 2; k++) P[k] /= n
  return P
}

/** What the stages are planned from → { pres, high, air: each band over the 0.5 to 2 kHz band, dB; flat, flatMid: the
 *  flatness of 5 to 10 kHz at its 10th percentile and its median; body: the 0.5 to 2 kHz band over the whole sound, dB; runs: runs of three or more samples at full scale,
 *  railed: their share of the samples }. The channels' mean is read; the rails, each channel. */
export function measure(channels, sr) {
  let x = downmix(channels), N = 16384
  while (N > 256 && N > x.length) N /= 2
  let P = welch(x, N), level = (lo, hi) => { let s = 0; for (let k = Math.max(1, Math.ceil(lo * N / sr)); k <= Math.min(N / 2, Math.floor(hi * N / sr)); k++) s += P[k]; return db(s) }
  let ref = level(500, 2000), out = { body: ref - level(20, sr / 2) }
  for (let k in BANDS) out[k] = level(BANDS[k][0], BANDS[k][1]) - ref
  // each frame's flatness in 5 to 10 kHz, over the frames that hold the band's upper half of energy
  let M = 2048, w = hann(M), buf = new Float64Array(M), k0 = Math.ceil(5000 * M / sr), k1 = Math.min(M / 2, Math.floor(10000 * M / sr)), nb = k1 - k0 + 1, frames = []
  if (nb > 8) for (let s = 0; s + M <= x.length; s += M / 2) {
    for (let i = 0; i < M; i++) buf[i] = x[s + i] * w[i]
    let [re, im] = fft(buf), lg = 0, sum = 0
    for (let k = k0; k <= k1; k++) { let p = re[k] * re[k] + im[k] * im[k]; lg += Math.log(p + 1e-20); sum += p }
    frames.push([sum, Math.exp(lg / nb) / (sum / nb + 1e-30)])
  }
  let half = [...frames].sort((a, b) => a[0] - b[0])[frames.length >> 1]?.[0] ?? 0
  let flat = frames.filter(f => f[0] >= half && f[0] > 0).map(f => f[1]).sort((a, b) => a - b)
  out.flat = flat[Math.floor(flat.length * 0.1)] ?? 0
  out.flatMid = flat[flat.length >> 1] ?? 0
  let rail = 0, runs = 0, total = 0
  for (let c of channels) {
    let run = 0
    for (let i = 0; i < c.length; i++) {
      if (c[i] >= RAIL || c[i] <= -RAIL) { rail++; run++ } else { if (run >= 3) runs++; run = 0 }
    }
    if (run >= 3) runs++
    total += c.length
  }
  out.runs = runs
  out.railed = total ? rail / total : 0
  return out
}

const f1 = v => +v.toFixed(1)
const through = async (x, sr, op, args) => audio.from(x, { sampleRate: sr })[op](...args).read()
// a stage as its call reads
const call = (op, args) => `.${op}(${args.map(a => typeof a === 'string' ? `'${a}'` : JSON.stringify(a).replace(/"(\w+)":/g, '$1: ').replace(/^{/, '{ ').replace(/}$/, ' }').replace(/,/g, ', ')).join(', ')})`

/** The track through its stages, each planned from the sound reaching it → { channels, evidence, stages }.
 *  `say(name)`: each stage as it starts. */
export async function render(channels, { sampleRate: sr, intensity = 1, target = 'spotify' } = {}, say = () => {}) {
  let x = channels, stages = [], evidence = measure(x, sr), now = evidence
  const run = async (op, args, why) => { say(op); x = await through(x, sr, op, args); now = measure(x, sr); stages.push({ op, args, call: call(op, args), why }) }
  if (now.runs >= RUNS) await run('declip', [], `${now.runs} runs of three samples or more at full scale, ${(100 * now.railed).toFixed(2)} % of the samples`)
  let noise = f1(HAZE.most * intensity * Math.min(1, Math.max(0, now.flat - HAZE.from) / (HAZE.full - HAZE.from)))
  if (-noise >= HAZE.least && now.high > THERE.top) await run('deconstruct', [0, noise, 0, { band: [HAZE.band, sr / 2] }],
    `5 to 10 kHz reads as noise in nearly every frame: flatness ${now.flat.toFixed(2)} at its 10th percentile, where finished music keeps ${KEPT.flat} or under`)
  for (let k in BANDS) {
    let [lo, hi, fc, Q] = BANDS[k], over = now[k] - KEPT[k]
    if (over * intensity >= 1 && now.body > THERE.body && fc < sr * 0.45) await run('eq', [fc, -f1(Math.min(CUT, over * intensity)), Q],
      `${lo / 1000} to ${hi / 1000} kHz stands ${now[k].toFixed(1)} dB over the 0.5 to 2 kHz band, ${over.toFixed(1)} dB more than finished music keeps (${KEPT[k]})`)
  }
  let lufs = LOUDNESS[ALIAS[target] ?? target] ?? target
  await run('normalize', [target], `to ${typeof lufs === 'number' ? `${lufs} LUFS` : lufs} under -1 dBTP`)
  return { channels: x, evidence, stages }
}

const own = o => {
  let i = o.intensity ?? 1
  if (typeof i !== 'number' || !(i >= 0 && i <= 2)) throw new RangeError(`deslop: intensity is 0 to 2, not ${i}`)
  return `${i}:${o.target ?? 'spotify'}`
}
const opts = o => ({ intensity: o.intensity ?? 1, target: o.target ?? 'spotify' })

// the op and its stat as audio.js registers them: this module loads on their first use, out of a page's bundle
export const prepare = prepared(MADE, own, async (pcm, sampleRate, o, a) => (await render(pcm, { sampleRate, ...opts(o) }, name => emit(a, 'doing', { op: 'deslop', stages: [name] }))).channels)
export const process = playback('deslop', MADE)

/** What a track carries and the stages it plans, nothing changed: a.stat('slop'). The plan is made by running it (each
 *  stage is planned from the sound the ones before it leave). */
export async function plan(o = {}) {
  own(o)
  let { at, duration, ...rest } = o, pcm = await this.read(at != null || duration != null ? { at, duration } : undefined)
  let { evidence, stages } = await render(pcm, { sampleRate: this.sampleRate, ...opts(rest) })
  return { evidence, stages, code: stages.map(s => s.call).join('') }
}
