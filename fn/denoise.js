/**
 * Denoise: learn a steady noise where it plays alone, remove it everywhere (iZotope RX Spectral De-noise, Learn).
 *
 * a.denoise({ noise: { at: 1.2, duration: 0.5 } })          → the noise learned there, 12 dB down everywhere
 * a.denoise(20, { noise: { at: 1.2, duration: 0.5 } })      → 20 dB down
 * a.denoise({ noise: { at: 1.2, duration: 0.5 }, at: 5, duration: 10 })  → only from 5 s to 15 s
 * a.denoise({ noise: [{ at: 0, duration: 0.4 }, { at: 7.1, duration: 0.3 }] })  → learned from both pauses
 * a.denoise(12, 3, { noise })                               → threshold 3 dB: the quiet just over the noise goes too
 * a.denoise({ noise: print })                               → a print saved from `await b.stat('print', { at, duration })`
 * a.denoise({ noise: { at: 1.2, duration: 0.5 }, band: [2000, 8000] })  → only 2 to 8 kHz: the rest as it was
 *
 * For hiss, hum and buzz, a fan, room tone, tape: noise that holds still. The print is the noise's power spectrum,
 * averaged over the frames inside `noise`, a range of the op's input (the audio as the edits before it leave it), or
 * several. Each channel learns its own. The gain is OM-LSA's (Cohen & Berdugo 2001) on that held noise,
 * @audio/denoise-omlsa with a `profile`: the log-spectral amplitude gain when speech is present, weighed against a
 * floor `reduction` dB down by the probability of presence, read from the a posteriori SNR at a fixed a priori SNR of
 * 15 dB (Gerkmann & Hendriks 2012) and set to 0 where Cohen's a priori absence, smoothed over time and neighbouring
 * bins, is 0.9 or more; frames of 32 ms (the power of two nearest), a quarter-frame hop. What stays of the noise is the
 * noise, `reduction` dB quieter, not tones: log kurtosis ratio 0.00 on steady noise at 12 to 20 dB (musical noise is
 * above 0); in the half second after music stops, 0.11 at 12 dB, 1.00 at 20 (@audio/denoise's scripts/broadband.mjs).
 * `threshold` raises the print by that many dB before the gain reads it (RX's Threshold): more of what is quiet counts
 * as noise. `reduction` 0 leaves the input.
 * `band` [low, high] Hz gains only the bins from low to high, each bin whose centre is inside; the others pass as they were,
 * so a noise found in a box of time and frequency (a whistle's band, a hiss above the voice) goes there alone.
 *
 * A print is dB per band, the bands 23.4375 Hz apart from 0 to 24 kHz (1025 values: the op's own bins at 48 and
 * 96 kHz), each the level white noise of that density would have: white noise of RMS 0.01 prints −40 throughout. Any
 * length spans 0 to 24 kHz evenly, interpolated in dB; one array serves every channel, an array of arrays one each.
 * The range is learned through the print, rounded to 0.01 dB, so a print taken from the same range renders the same.
 *
 * Streams: the print is learned before rendering (prepare) from the range alone, so a live source renders once the
 * range has arrived, a frame behind (latency: the frame − 1 samples). The print stays on the edit while the range's
 * samples stay the same: re-reads and later edits reuse it; a changed range or input relearns it.
 *
 * On the 824 VoiceBank+DEMAND test utterances, each one's noise learned from the half second before its speaker starts
 * (bench/denoise.mjs): PESQ 2.45 and DNSMOS OVRL 2.88, against 2.36 and 2.84 for omlsa() tracking the noise, 1.97 and
 * 2.68 unprocessed. Each channel is learned and gained apart: linking the channels' gains measured 0.6 dB less SNR gain
 * where their noises differ, 0.1 dB more where they are the same.
 */
import audio, { parseTime, named } from '../core.js'
import { fingerprint } from './vocals.js'

const LEARNED = Symbol('denoise.learned'), REDUCTION = 12
// the print's grid: 23.4375 Hz (24 kHz over 1024 bands), the bins of a 2048 frame at 48 kHz
const TOP = 24000, BANDS = 1024

/** The frame: the power of two nearest 32 ms, as @audio/denoise-omlsa's `frame`. */
export const frame = sr => 2 ** Math.round(Math.log2(0.032 * sr))

const lerp = (y, x) => { let i = Math.floor(x); return i >= y.length - 1 ? y[y.length - 1] : y[i] + (x - i) * (y[i + 1] - y[i]) }

/** Mean |X|² per bin (frames of `frame(sr)` inside each part) → the print; `parts`: arrays of one channel's samples. */
export async function learn(parts, sr) {
  let { stftAnalyse } = await import('@audio/stft')
  let N = frame(sr), K = N / 2 + 1, pw = new Float64Array(K), n = 0
  for (let x of parts) stftAnalyse(x, mag => { for (let k = 0; k < K; k++) pw[k] += mag[k] * mag[k]; n++ }, { frameSize: N, hopSize: N >> 2 })
  if (!n) throw new RangeError(`denoise: the noise range holds less than a frame (${(N / sr * 1000).toFixed(0)} ms at ${sr} Hz): too short, or past the end`)
  if (!pw.some(Boolean)) throw new RangeError('denoise: the noise range is digital silence: there is no noise to learn there')
  for (let k = 0; k < K; k++) pw[k] /= n
  return toPrint(pw, sr)
}

/** Mean |X|² per bin of `frame(sr)` Hann frames → the print (dB on the 23.4375 Hz grid, to 0.01 dB). */
export function toPrint(pw, sr) {
  let N = (pw.length - 1) * 2, U = 3 * N / 8, c = 10 * Math.log10(2 * TOP / sr)   // U: Σw² of the periodic Hann
  let db = Array.from(pw, v => 10 * Math.log10(v / U + 1e-30))
  return Array.from({ length: BANDS + 1 }, (_, j) => Math.round((lerp(db, j * TOP / BANDS * N / sr) + c) * 100) / 100)
}

/** The print → mean |X|² per bin of `frame(sr)` frames at `sr` (above 24 kHz: its last value). */
export function fromPrint(print, sr) {
  let N = frame(sr), U = 3 * N / 8, c = sr / 2 / TOP, n = print.length
  return Float64Array.from({ length: N / 2 + 1 }, (_, k) => U * c * 10 ** (lerp(print, n > 1 ? k * sr / N / TOP * (n - 1) : 0) / 10))
}

const isRange = r => r != null && typeof r === 'object' && !Array.isArray(r) && named(r).duration != null
const ranges = noise => isRange(noise) ? [noise] : Array.isArray(noise) && noise.length && noise.every(isRange) ? noise : null
const isPrint = p => Array.isArray(p) && p.length > 0 && p.every(v => typeof v === 'number' && Number.isFinite(v))
const prints = noise => isPrint(noise) ? [noise] : Array.isArray(noise) && noise.length && noise.every(isPrint) ? noise : null

function check(o) {
  let r = o.reduction ?? REDUCTION, t = o.threshold ?? 0
  if (typeof r !== 'number' || !(r >= 0)) throw new TypeError(`denoise: reduction is dB the noise goes down, 0 or more, not ${r}`)
  if (typeof t !== 'number' || !Number.isFinite(t)) throw new TypeError(`denoise: threshold is dB, not ${t}`)
  if (!ranges(o.noise) && !prints(o.noise))
    throw new TypeError('denoise: needs the noise: { noise: { at, duration } }, where it plays alone (or several such ranges, or a print from stat(\'print\'))')
  if (o.band != null && !(Array.isArray(o.band) && o.band.length === 2 && o.band.every(Number.isFinite) && o.band[0] >= 0 && o.band[0] < o.band[1]))
    throw new TypeError(`denoise: band is [low, high] Hz, 0 ≤ low < high, not ${JSON.stringify(o.band)}`)
}

/** Learn the print from the edit's `noise` range(s) of its input (the audio as the edits before it leave it). */
async function prepare(a, index) {
  let o = a.edits[index][1]
  check(o)
  let list = ranges(o.noise)
  if (!list) { delete o[LEARNED]; return }                // a print: nothing to learn, and no range's print stays
  list = list.map(named).map(r => ({ at: parseTime(r.at) ?? 0, duration: parseTime(r.duration) }))
  if (list.some(r => !(r.duration > 0))) throw new RangeError('denoise: a noise range needs a duration over 0 s')
  let chs = o.channel == null ? null : [o.channel].flat(), id = `${JSON.stringify(list)}:${chs ?? ''}`
  // same instance state as last time: the input is too (read() and stream() both prepare)
  let stamp = `${a.version}:${a._.len}:${id}`, done = o[LEARNED]
  if (done?.stamp === stamp) return
  let input = audio.from(a, { sampleRate: a._.sr })     // follows a source still arriving: the read waits for the range
  input.edits = a.edits.slice(0, index)
  input.version = index
  let parts = []
  for (let r of list) { let pcm = await input.read(r); parts.push(chs ? chs.map(c => pcm[c]) : pcm) }
  let sr = input.sampleRate, key = `${id}:${sr}:${parts.map(fingerprint).join()}`
  if (done?.key === key) { done.stamp = stamp; return }
  let learned = []
  for (let c = 0; c < parts[0].length; c++) learned.push(await learn(parts.map(p => p[c]), sr))
  o[LEARNED] = { key, stamp, sr, prints: learned }
}

/** One stream per channel: frames on the hop grid counted from 0, the first three before the start over zeros (so the
 *  start is covered as every other sample, not faded in), gains only in frames centred in the op's range, and a queue
 *  primed with frame − 1 zeros so every block comes out whole, that far behind. */
function init(ctx, nch) {
  let { processor, stftStream } = audio.op('denoise').mod, sr = ctx.sampleRate, N = frame(sr), hop = N >> 2
  let learned = ctx[LEARNED], list = learned ? learned.prints : prints(ctx.noise)
  if (learned && learned.sr !== sr) throw new Error('denoise: the rate changed since the noise was learned')
  if (!list) throw new Error('denoise: the noise is learned before rendering, through read(), stream() or save()')
  let reduction = ctx.reduction ?? REDUCTION, thr = 10 ** ((ctx.threshold ?? 0) / 10)
  let n0 = Math.round((ctx.blockOffset || 0) * sr), g0 = Math.ceil(n0 / hop) * hop
  let st = { n: n0, g0, s0: -Infinity, s1: Infinity, chans: [] }
  // the band's bins, each whose centre is inside it; the rest kept as they were (`was`)
  let band = ctx.band, k0 = band ? Math.ceil(band[0] * N / sr) : 0, k1 = band ? Math.min(N / 2, Math.floor(band[1] * N / sr)) : N / 2
  let was = band && new Float32Array(N / 2 + 1)
  const gain = (proc, mag, phase) => {
    if (!band) return proc(mag, phase)
    was.set(mag)
    let out = proc(mag, phase)
    for (let k = 0; k <= N / 2; k++) if (k < k0 || k > k1) out.mag[k] = was[k]
    return out
  }
  for (let c = 0; c < nch; c++) {
    let profile = fromPrint(list[Math.min(c, list.length - 1)], sr).map(v => v * thr), f = 0
    let proc = reduction > 0 && processor({ fs: sr, frameSize: N, hopSize: hop, profile, gMin: -reduction })
    // the frame's middle in the op's timeline (an @audio/stft that says where its frame starts, ctx.pos, is taken at it)
    let visit = (mag, phase, state, sc) => {
      let mid = g0 - (N - hop) + (sc?.pos ?? f * hop) + N / 2
      f++
      return proc && mid >= st.s0 && mid < st.s1 ? gain(proc, mag, phase) : { mag, phase }
    }
    let stft = stftStream(visit, { fs: sr, frameSize: N, hopSize: hop })
    st.chans.push({ stft, q: new Float32Array(N << 2), len: N - 1, drop: N - hop - stft.write(new Float32Array(N - hop)).length })
  }
  return st
}

// append to a channel's queue, growing it
function push(ch, x) {
  if (ch.len + x.length > ch.q.length) { let q = new Float32Array(2 * (ch.len + x.length)); q.set(ch.q.subarray(0, ch.len)); ch.q = q }
  ch.q.set(x, ch.len); ch.len += x.length
}

function denoise(input, output, ctx) {
  let st = ctx._dn ??= init(ctx, input.length), sr = ctx.sampleRate, len = input[0].length
  // the op's own range (ranged op: ctx.at is block-relative), in samples of its timeline
  if (ctx.at != null) st.s0 = Math.round((ctx.at + (ctx.blockOffset || 0)) * sr)
  if (ctx.duration != null) st.s1 = Math.max(st.s0, 0) + Math.round(ctx.duration * sr)
  let skip = Math.max(0, Math.min(len, st.g0 - st.n))  // before the first frame on the grid: passed as it is
  for (let c = 0; c < input.length; c++) {
    let ch = st.chans[c], x = input[c], y = output[c]
    if (skip) push(ch, x.subarray(0, skip))
    if (skip < len) {
      let o = ch.stft.write(x.subarray(skip)), d = Math.min(ch.drop, o.length)   // the zeros' own output goes
      ch.drop -= d
      push(ch, o.subarray(d))
    }
    let n = Math.min(len, ch.len)
    y.set(ch.q.subarray(0, n)); y.fill(0, n)
    ch.q.copyWithin(0, n, ch.len); ch.len -= n
  }
  st.n += len
}

audio.op('denoise', {
  params: ['reduction', 'threshold'],
  ranged: true,
  latency: (o, sr) => frame(sr) - 1,
  warmup: (o, sr) => 4 * frame(sr),
  load: () => Promise.all([import('@audio/denoise-omlsa'), import('@audio/stft')]).then(([m, s]) => ({ ...m, ...s })),
  prepare,
  process: denoise,
})

// The print of a range, as `denoise({ noise })` takes it: a.stat('print', { at, duration }). The channels' powers
// averaged; `channel` picks one, an array of channels gives a print each.
audio.stat('print', {})
audio.fn.print = async function (opts = {}) {
  let { at, duration, channel } = opts
  let pcm = await this.read(at != null || duration != null ? { at, duration } : undefined), sr = this.sampleRate
  if (Array.isArray(channel)) return Promise.all(channel.map(c => learn([pcm[c]], sr)))
  let chs = channel != null ? [pcm[channel]] : pcm
  if (chs.length === 1) return learn(chs, sr)
  // one print for all: the channels' mean power (a mono mix would cancel what is out of phase)
  let per = await Promise.all(chs.map(x => learn([x], sr)))
  return per[0].map((_, j) => Math.round(10 * Math.log10(per.reduce((s, p) => s + 10 ** (p[j] / 10), 0) / per.length) * 100) / 100)
}
