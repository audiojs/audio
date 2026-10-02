/**
 * Stretch — time-stretch by factor, preserving pitch.
 * factor > 1 = slower (longer), factor < 1 = faster (shorter).
 * factor may be a function `t => f` or curve `{t, v}` (t = source-timeline seconds)
 * — sliding stretch: a continuous tempo envelope, output length = ∫factor dt.
 *
 * Two stages:
 *   1. Plan: segment rate = 1/factor, count *= factor: the timeline gets the target
 *      length, the range linearly resampled into it. Sliding factors emit one segment
 *      per quantum (a piecewise-constant rate, set at plan time, so ranged reads,
 *      seek, duration, serialization all follow the segment algebra).
 *   2. Process: the shifter below reads the source back through the plan's map and
 *      time-stretches it with a phase-locked vocoder, its output the timeline itself.
 *
 * The shifter (shifter / shiftBlock) is exported for pitch.js: the same vocoder, read by
 * a cursor at the ratio semitones give instead.
 */

import { seg, subSeg, spliceSegs, planOffset, isCurve, curveFn } from '../plan.js'
import audio from '../core.js'
import pvocLock from '@audio/stretch-pvoc-lock'

// pvocLock stretches time and keeps pitch, with a phase-locked vocoder (Laroche & Dolson 1999,
// @audio/stretch-pvoc-lock); a fractional cursor reads that stream at the rate it was stretched by, which shifts the
// pitch by that rate at a fixed block size.
// Both hops stay within a quarter frame, so phase advances measure frequency unambiguously: compression
// shortens the synthesis hop instead of lengthening the analysis hop, which past a frame skipped input and
// broke the frame buffer.
// Frames hold about 46 ms of the source (2048 samples at 44.1 kHz): the vocoder must resolve a low voice's or a
// bass's harmonics, or it smears neighbours into beats and a sub-octave (a 23 ms frame put 1200 cents of f0
// error on speech slowed 2×, and lost a 110 Hz tone's fundamental). Both pitch and stretch feed it the source at its
// own pitch, so one frame size serves both.
const frameOf = (sampleRate = 44100) => 2 ** Math.round(Math.log2(sampleRate * 2048 / 44100))
// floored, so the analysis hop (synthesis hop / r) stays within the quarter frame: rounded up, it went past it and
// the main lobe's outer bins wrapped (a steady tone at r = 0.3: sidebands at the frame rate 4 dB higher)
const synHopOf = (r, frame) => Math.max(1, Math.min(frame >> 2, Math.floor((frame >> 2) * r)))

/** Output samples the vocoder runs behind its input, for ratios down to rmin: its pOut plus one synthesis
 *  hop of margin, at r of its samples per output sample. Covers every block size for r in [0.05, 20] at 8, 44.1 and
 *  48 kHz, sliding ratios included (measured: a constant ratio needs (pOut + 2.4)/r). */
export const phaseLockLatency = (rmin, sampleRate) => {
  let frame = frameOf(sampleRate), synHop = synHopOf(rmin, frame)
  return Math.ceil((Math.round(frame / 2 * (rmin + 1)) + synHop) / rmin)
}

// ── Shifter: a stage's pitch moved by a ratio over spans of its timeline ──
// The vocoder runs only over the spans the ratio is not 1 on, fed from a context before each (a frame and a
// crossfade), where it runs at ratio 1 and gives back its input to float precision: it starts on the input's own
// phases, not on a cut. Fed only the span itself, it saw the audio cut off at both edges and smeared that step
// across its frames: a broadband splash at each seam, 40 to 50 dB above what a crossfade of two pitches makes.
// The input outside a span stays as it was: the shifted audio comes in over the span's first 10 ms and goes back out
// over its last, at a constant power for the correlation the two have there (Fink, Holters & Zölzer 2016: linear
// for one signal, equal-power for unrelated ones), since by its end it has run ∫(ratio − 1) ahead of the input, a
// phase offset at every partial. Spans closer than the shifter's latency and a context run as one.
// The ratio holds over each sample, so R(t) = ∫ ratio up to t. Each frame's analysis hop spans the input over which
// R grows by one synthesis hop: frame k's centre is where R has grown by k hops, and the stretched stream has it k
// hops on, so the centres all lie on P(t) = R(t) + const, and the cursor reading there reads, at every sample, what
// the input had then, the pitch following the ratio exactly, steps and glides alike. The phase model is told each
// frame's distance from the one before, as far as the frame actually moved (fourier-transform reads it at a whole
// sample), not the next one's hop: a hop rounded at every frame put sidebands at the frame rate 13 dB higher.
// A stretch's plan has already time-scaled the audio, which put it at another pitch: its frames would straddle that
// step at the range's edges, and every one of them mix the two pitches. So a stretch reads the source back through
// the plan's own map (the content at t sits on the timeline at T(t)) and feeds the vocoder audio at the source's
// pitch; the vocoder stretches it by T′, and its output is the timeline itself, read at rate 1. Its crossfades join
// the source continued in its own time: into the range at its start, and aligned with what follows at its end.

/** Where shifted audio meets the input, a crossfade this long: 10 ms */
const fadeOf = sr => Math.max(1, Math.round(.01 * sr))

/** Samples a shifter runs behind its input: the vocoder's latency (or a voice engine's, `engine`), and the crossfade it
 *  looks across before the one back into the input. A stretch (`rmax`, its largest factor) waits for its input to reach
 *  the content a frame ahead, which the plan has put further on by the factor. */
export const shiftLatency = (rmin, sampleRate, rmax, engine) => {
  let N = frameOf(sampleRate), lat = engine ?? (rmax ? Math.ceil(N / 2 * (1 + rmax)) + synHopOf(rmin, N) + Math.ceil(ZC * rmax) + 4 : phaseLockLatency(rmin, sampleRate))
  return lat + fadeOf(sampleRate)
}

/** A shifter over a stage's timeline. `ratio(t)`: the ratio at content sample t; `spans`: [from, to) timeline samples
 *  it is not 1 on (sorted; to may be Infinity); `rmin`: the least ratio it takes, 1 included where it returns to it.
 *  A stretch passes `map`: { T(t): the timeline place of content t, U: its inverse, D: how much longer the timeline is
 *  after the range, rate(t): T′, rmax: its largest factor }. A voice passes `voice`: { make(ratio of seconds) → a
 *  retuner (@audio/tune-curve), latency, context }. */
export function shifter(nch, { sampleRate: sr, ratio, spans, rmin, map = null, voice = null }) {
  let N = frameOf(sr), X = fadeOf(sr), C = N + X + (voice ? voice.context : 0), lat = shiftLatency(rmin, sr, map?.rmax, voice?.latency), list = []
  for (let [a, b] of spans) {
    if (!(b > a)) continue
    if (list.length && a - list.at(-1)[1] < lat + C + 2 * X) list.at(-1)[1] = Math.max(list.at(-1)[1], b)
    else list.push([a, b])
  }
  return { nch, sr, ratio, rmin, N, X, C, lat, map, voice, spans: list, si: 0, hist: history(nch), cur: null, pos: new Float64Array(0) }
}

/** Shift one block: `input` holds timeline samples [n0, n0 + length), `output` gets the shifted timeline `lat`
 *  samples behind it. Any partition of the timeline into blocks gives the same samples. */
export function shiftBlock(st, input, output, n0) {
  let len = input[0].length, n1 = n0 + len, q0 = n0 - st.lat, h = st.hist
  push(h, input, n0)
  // a session opens once the input reaches its context, fed from there (from the input kept since, if it opened late)
  if (!st.cur) {
    while (st.si < st.spans.length && st.spans[st.si][1] <= q0) st.si++
    let sp = st.spans[st.si]
    if (sp && sp[0] - st.C < n1) st.cur = session(st, Math.max(sp[0] - st.C, h.start), sp)
  }
  let cur = st.cur
  if (cur) feed(st, cur, h, n1)
  if (!cur || q0 + len <= cur.e0 || q0 >= cur.e1) dryOut(h, output, q0, len)
  else mix(st, cur, output, q0, len)
  if (cur && q0 + len >= cur.e1) { st.cur = null; st.si++ }
  // the output reads on from q0 + len, a crossfade's source a few ms around it; a session opens from this block on
  trim(h, Math.min(q0 + len, n0) - Math.ceil((st.X + ZC) * (2 + (st.map?.rmax || 0))) - 4)
}

// The input as it arrives, from where the output reads it on: the unshifted audio, and what a session is fed from
const history = nch => ({ start: 0, len: 0, buf: Array.from({ length: nch }, () => new Float32Array(16384)) })
function push(h, input, n0) {
  let len = input[0].length
  if (h.start + h.len !== n0) { h.start = n0; h.len = 0 }
  if (h.len + len > h.buf[0].length) h.buf = h.buf.map(b => grown(b, h.len, h.len + len))
  for (let c = 0; c < h.buf.length; c++) h.buf[c].set(input[c], h.len)
  h.len += len
}
function trim(h, from) {
  let k = Math.min(h.len, from - h.start)
  if (k < h.buf[0].length >> 1) return
  for (let b of h.buf) b.copyWithin(0, k, h.len)
  h.start += k; h.len -= k
}
const dryAt = (h, c, n) => n >= h.start && n < h.start + h.len ? h.buf[c][n - h.start] : 0
// The input at a fractional place x, band-limited: a Kaiser-windowed sinc (β 8, 8 zero crossings a side; Kaiser 1974;
// 16 measured no better on a sine or on speech), low-passed at `cut` of Nyquist where the reader moves faster than the
// timeline. A stretch's plan put its range there by linear interpolation; read back with a cubic, a range sped up 20×
// imaged at −32 dB (Catmull-Rom on a tone at a fifth of the rate), and every frame took that junk for partials. Whole
// places read exactly.
const ZC = 8, RES = 512, I0 = x => { let s = 1, t = 1; for (let k = 1; k < 25; k++) { t *= (x / 2 / k) ** 2; s += t } return s }
const KERNEL = Float64Array.from({ length: ZC * RES + 2 }, (_, i) => {
  let x = i / RES
  return x >= ZC ? 0 : (x ? Math.sin(Math.PI * x) / (Math.PI * x) : 1) * I0(8 * Math.sqrt(1 - (x / ZC) ** 2)) / I0(8)
})
function dryBand(h, c, x, cut = 1) {
  let fl = Math.floor(x)
  if (x === fl) return dryAt(h, c, fl)
  let w = Math.ceil(ZC / cut), sum = 0, acc = 0
  for (let n = fl - w + 1; n <= fl + w; n++) {
    let d = Math.abs(x - n) * cut * RES, i = d | 0
    if (i >= ZC * RES) continue
    let k = KERNEL[i] + (KERNEL[i + 1] - KERNEL[i]) * (d - i)
    sum += k; acc += k * dryAt(h, c, n)
  }
  return acc / sum
}
function dryOut(h, output, q0, len) {
  for (let c = 0; c < output.length; c++) {
    let out = output[c], a = Math.max(0, h.start - q0), b = Math.min(len, h.start + h.len - q0)
    if (a > 0) out.fill(0, 0, Math.min(a, len))
    if (b > a) out.set(h.buf[c].subarray(q0 + a - h.start, q0 + b - h.start), a)
    if (b < len) out.fill(0, Math.max(0, b), len)
  }
}

/** A run of the vocoder over the span [e0, e1) of the timeline, fed from timeline sample S (content U(S)). */
function session(st, S, [e0, e1]) {
  let { nch, sr, ratio, rmin, N, map, voice } = st, half = N >> 1, synHop = synHopOf(rmin, N), u0 = map ? map.U(S) : S
  // a voice: one retuner for all channels, its cycles laid on the timeline as they were found (read at rate 1)
  if (voice) {
    let tc = voice.make(x => ratio(S + x * sr))
    if (tc.latency + st.X > st.lat) throw new Error(`pitch: the voice engine runs ${tc.latency} samples behind, over the ${st.lat - st.X} declared`)
    return { S, u0, e0: Math.max(e0, S), e1, fed: 0, tc, voc: Array.from({ length: nch }, ring), rate: () => 1, t: 0, p: 0 }
  }
  // the content, from u0 on, and its ratio, per sample
  let rate = n => ratio(u0 + n)
  // the input a frame spans: from its centre a, as far as R grows by a synthesis hop
  let span = a => {
    let n = Math.floor(a), t = a, acc = 0
    for (;;) {
      let r = rate(n), take = (n + 1 - t) * r
      if (acc + take >= synHop) return t + (synHop - acc) / r - a
      acc += take; t = ++n
    }
  }
  // frame 0 starts a frame before the feed (fourier-transform/stft pads it): its centre at −half, where the cursor's
  // stretched position is half − pOut
  let init = span(-half), pOut = Math.round(half * (synHop / init + 1)), p = half - pOut
  for (let n = -half; n < 0; n++) p += rate(n)
  let fr = { base: 0, hop: [], next: -half }
  let hop = k => {
    while (fr.base + fr.hop.length <= k) { let h = fr.base + fr.hop.length ? span(fr.next) : init; fr.hop.push(h); fr.next += h }
    return fr.hop[k - fr.base]
  }
  // each channel's vocoder asks for hops: with its context once per frame (the distance from the frame before), then
  // without, to place the next (fourier-transform/stft); asks before the first frame are its construction
  let vocoder = () => {
    let kf = 0, ka = 0, on = false, last = 0
    let anaHop = (fs, ctx) => {
      if (ctx === null || (!ctx && !on)) return init
      if (ctx) { on = true; let d = kf++ ? fs - last : init; last = fs; return d }
      return hop(ka++)
    }
    return { ...ring(), write: pvocLock({ frameSize: N, hopSize: N >> 2, synHop, anaHop, sampleRate: sr, fs: sr }), frames: () => kf }
  }
  // Fed from inside the span (the timeline's start, or a reader seeking into it), the vocoder starts cold and its first
  // frames smear what follows back over the start: it fades in from the input there.
  return { S, u0, e0: Math.max(e0, S), e1, fed: 0, voc: Array.from({ length: nch }, vocoder), fr, rate, t: 0, p, buf: null }
}

/** Feed the session the content its input has reached by timeline sample n1 (a stretch: what the map puts there). */
function feed(st, cur, h, n1) {
  let { map } = st, from = cur.fed, to
  if (!map) to = n1 - cur.S
  else {
    // the content whose place, with the reader's taps, the input has reached
    let edge = n1 - 1 - Math.ceil(ZC * map.rmax)
    to = Math.floor(map.U(edge)) - cur.u0
    while (to > from && map.T(cur.u0 + to) > edge) to--
  }
  if (to <= from) return
  let nch = cur.voc.length
  if (cur.tc) {
    let res = cur.tc.write(h.buf.map(b => b.subarray(cur.S + from - h.start, cur.S + to - h.start)))
    for (let c = 0; c < nch; c++) append(cur.voc[c], res[c])
    cur.fed = to
    return
  }
  for (let c = 0; c < nch; c++) {
    let v = cur.voc[c], x
    if (!map) x = h.buf[c].subarray(cur.S + from - h.start, cur.S + to - h.start)
    else {
      x = (cur.buf ??= [])[c] = cur.buf[c]?.length >= to - from ? cur.buf[c].subarray(0, to - from) : new Float32Array(to - from)
      for (let i = 0; i < to - from; i++) { let u = cur.u0 + from + i; x[i] = dryBand(h, c, map.T(u), Math.min(1, 1 / map.rate(u))) }
    }
    append(v, v.write(x))
  }
  cur.fed = to
  // hops the vocoders have used go
  let k = Math.min(...cur.voc.map(v => v.frames())) - 2 - cur.fr.base
  if (k > 256) { cur.fr.hop.splice(0, k); cur.fr.base += k }
}

// a buffer of `have` samples, room for `need`; the shifted audio's ring, from ringStart on
const grown = (b, have, need) => { let nb = new Float32Array(Math.max(2 * b.length, need)); nb.set(b.subarray(0, have)); return nb }
const ring = () => ({ ring: new Float32Array(8192), ringStart: 0, ringLen: 0 })
function append(v, chunk) {
  if (!chunk.length) return
  if (v.ringLen + chunk.length > v.ring.length) v.ring = grown(v.ring, v.ringLen, v.ringLen + chunk.length)
  v.ring.set(chunk, v.ringLen)
  v.ringLen += chunk.length
}

// 4-point cubic (Catmull-Rom): the cursor upsamples by 1/r, and linear interpolation's corners image there.
// Before the stream's first sample is silence (the vocoder places its first output up to half a sample late).
function readAt(v, p) {
  let fl = Math.floor(p), idx = fl - v.ringStart, ring = v.ring, n = v.ringLen
  if (idx < -2 || idx + 1 >= n) return 0
  let x0 = idx >= 0 ? ring[idx] : 0, x1 = idx >= -1 ? ring[idx + 1] : 0, f = p - fl
  if (!f) return x0
  let xm = idx >= 1 ? ring[idx - 1] : 0, x2 = idx + 2 < n ? ring[idx + 2] : x1
  return x0 + .5 * f * (x1 - xm + f * (2 * xm - 5 * x0 + 4 * x1 - x2 + f * (3 * (x0 - x1) + x2 - xm)))
}

/** Constant-power crossfade gains out of one signal into another that correlates ρ with it over the crossfade (Fink,
 *  Holters & Zölzer, "Signal-matched power-complementary cross-fading and dynamic processing", EURASIP JASP 2016):
 *  cos and sin over √(1 + 2ρ·cos·sin) at progress u ∈ [0, 1]: linear for one signal (ρ = 1), equal-power for unrelated
 *  ones (ρ = 0). */
const xfade = (u, rho) => {
  let a = u * Math.PI / 2, c = Math.cos(a), s = Math.sin(a), k = 1 / Math.sqrt(1 + 2 * rho * c * s)
  return [c * k, s * k]
}

// Where the cursor reads at timeline sample q: the content q is (the same for a pitch), on through R; a stretch's
// stretched stream is the timeline, so it reads on at rate 1.
function cursorAt(st, cur, q) {
  if (st.map || st.voice) return cur.p + (q - cur.S)
  let t = cur.t, p = cur.p
  for (; t < q - cur.S; t++) p += cur.rate(t)
  return p
}
// The audio the shifted audio crosses with at timeline sample q: the input, or for a stretch the source continued in
// its own time, from the range's start (into it) or aligned with what follows it (out of it)
const refAt = (st, h, c, q, back) => {
  if (!st.map) return dryAt(h, c, q)
  let u = back ? q - st.map.D : q
  return dryBand(h, c, st.map.T(u), Math.min(1, 1 / st.map.rate(u)))
}

/** Correlation of the shifted audio with what it crosses over timeline samples [q0, q0 + n), all channels */
function correlation(st, cur, h, q0, n, nch, back) {
  let xy = 0, xx = 0, yy = 0, p = cursorAt(st, cur, q0)
  for (let i = 0; i < n; i++, p += st.map || st.voice ? 1 : cur.rate(q0 + i - cur.S))
    for (let c = 0; c < nch; c++) { let w = readAt(cur.voc[c], p), d = refAt(st, h, c, q0 + i, back); xy += w * d; xx += w * w; yy += d * d }
  return Math.max(-.5, Math.min(1, xx && yy ? xy / Math.sqrt(xx * yy) : 0))
}

function mix(st, cur, output, q0, len) {
  let h = st.hist, { S, e0, e1 } = cur, nch = output.length
  // into the shifted audio over the span's first X samples, back over its last (half the span each, if shorter)
  let X = Math.min(st.X, Math.floor((e1 - e0) / 2)), inAt = e0 > -Infinity ? e0 : -Infinity, outAt = e1 < Infinity ? e1 - X : Infinity
  // the correlations of the crossfades, measured from the cursor before it moves on past them
  if (cur.gi == null && inAt > -Infinity && q0 + len > inAt) cur.gi = S <= e0 - st.C ? correlation(st, cur, h, inAt, X, nch, false) : 1
  if (cur.go == null && q0 + len > outAt) cur.go = correlation(st, cur, h, outAt, X, nch, true)
  if (st.pos.length < len) st.pos = new Float64Array(len)
  let pos = st.pos
  // the cursor, P(t + 1) = P(t) + ratio(t) (a stretch: + 1)
  for (let i = 0; i < len; i++) {
    let t = q0 + i - S
    if (t < 0) continue
    if (st.map || st.voice) { pos[i] = cur.p + t; continue }
    while (cur.t < t) cur.p += cur.rate(cur.t++)
    pos[i] = cur.p
  }
  for (let c = 0; c < nch; c++) {
    let out = output[c], v = cur.voc[c]
    for (let i = 0; i < len; i++) {
      let q = q0 + i
      if (q < e0 || q >= e1 || q < S) { out[i] = dryAt(h, c, q); continue }
      let y = readAt(v, pos[i])
      if (q < inAt + X) { let [gd, gy] = xfade((q - inAt + .5) / X, cur.gi); out[i] = gd * refAt(st, h, c, q, false) + gy * y }
      else if (q >= outAt) { let [gy, gd] = xfade((q - outAt + .5) / X, cur.go); out[i] = gy * y + gd * refAt(st, h, c, q, true) }
      else out[i] = y
    }
    // what the cursor has read past goes
    let back = st.map || st.voice ? cur.p + (q0 + len - 1 - S) : cur.p, drop = Math.floor(back) - 2 - v.ringStart
    if (drop > 0 && drop < v.ringLen) { v.ring.copyWithin(0, drop, v.ringLen); v.ringLen -= drop; v.ringStart += drop }
  }
}

function stretchSegs(segs, factor) {
  let rate = 1 / factor
  // placed by position, not accumulated count, so overlapping (crossfade) pairs stay aligned
  return segs.map(s => {
    let a = Math.round(s[2] * factor), b = Math.round((s[2] + s[1]) * factor)
    return seg(s[0], b - a, a, s[4] === null ? undefined : (s[3] || 1) * rate, s[4], s[5], s[6])
  })
}

// Sliding: one segment per source quantum, each with its own constant rate —
// the piecewise-constant decomposition of a continuous factor envelope.
// `fv[k]` covers source samples [k·q, (k+1)·q) of the spliced sub-range.
function slidingSegs(segs, fv, q) {
  // output position of pre-stretch position x: whole quanta at their rounded length (as
  // adjustLimit counts them), then the part inside quantum k
  let cum = [0]
  for (let k = 0; k < fv.length; k++) cum.push(cum[k] + Math.round(q * fv[k]))
  let F = x => { let k = Math.min(Math.floor(x / q), fv.length - 1); return cum[k] + Math.round((x - k * q) * fv[k]) }
  let r = []
  for (let s of segs) {
    let done = 0
    while (done < s[1]) {
      let srcPos = s[2] + done  // pre-stretch output coords of the sub-range
      let k = Math.min(Math.floor(srcPos / q), fv.length - 1)
      let take = Math.min(s[1] - done, (k + 1) * q - srcPos)
      let a = F(srcPos), b = F(srcPos + take)
      if (b > a) r.push(subSeg(s, srcPos, take, a, b - a, s[4] === null ? undefined : (s[3] || 1) / fv[k]))
      done += take
    }
  }
  return r
}

const stretchPlan = (segs, ctx) => {
  let { offset, length, total } = ctx
  if (ctx.fv) {
    let at = planOffset(offset, total)
    return spliceSegs(segs, at, length ?? total - at, sub => slidingSegs(sub, ctx.fv, ctx.q || 2048))
  }
  let factor = ctx.factor
  if (!factor || factor === 1) return segs
  if (offset == null && length == null) return stretchSegs(segs, factor)
  let at = planOffset(offset, total)
  return spliceSegs(segs, at, length ?? total - at, sub => stretchSegs(sub, factor))
}

// Piecewise factor lookup over the stage's own (post-stretch) timeline —
// `ot[k]` = output-time start of quantum k (seconds), `fv[k]` its factor.
function lookupAt(ot, fv, t) {
  let lo = 0, hi = ot.length
  while (lo < hi) { let m = (lo + hi) >> 1; if (ot[m] <= t) lo = m + 1; else hi = m }
  return fv[Math.max(0, Math.min(lo - 1, fv.length - 1))]
}

const minOf = a => a.reduce((m, v) => v < m ? v : m, Infinity)
const maxOf = a => a.reduce((m, v) => v > m ? v : m, -Infinity)

/** An op's range on the timeline, in samples: [a0, a1), as the engine hands it over (`at` relative to this block);
 *  unranged, the whole timeline. */
export const rangeOf = ctx => {
  let sr = ctx.sampleRate
  if (ctx.at == null && ctx.duration == null) return [-Infinity, Infinity]
  let a0 = ctx.at != null ? Math.round((ctx.at + (ctx.blockOffset || 0)) * sr) : 0
  return [a0, ctx.duration != null ? a0 + Math.round(ctx.duration * sr) : Infinity]
}

// The source back through the plan's map, stretched by the vocoder: the factor over the range (a sliding one per
// quantum), 1 outside it, where the vocoder runs only for its context and the crossfades. Ranged, the stretch also
// knows how long its range was: `n` samples of content.
const stretchShape = o => {
  let ranged = o.at != null || o.duration != null
  if (o.fv) return { rmin: Math.min(minOf(o.fv), ranged ? 1 : Infinity), rmax: Math.max(1, maxOf(o.fv)) }
  let f = o.factor
  return typeof f === 'number' && f > 0 && f !== 1 ? { rmin: ranged ? Math.min(1, f) : f, rmax: Math.max(1, f) } : null
}
const stretchLatency = (o, sr) => { let sh = stretchShape(o); return sh ? shiftLatency(sh.rmin, sr, sh.rmax) : 0 }

/** The plan's map of a stretch, content sample u → timeline T(u), and back: piecewise linear, the identity before the
 *  range and shifted by D after it. `knots`: [content, timeline, factor] at each piece's start, in order. */
function planMap(knots, u1, D) {
  // the last knot at or before x on key i (binary search: a sliding stretch has a knot per 2048 samples)
  let find = (x, i) => {
    let lo = 0, hi = knots.length - 1
    while (lo < hi) { let m = (lo + hi + 1) >> 1; if (knots[m][i] <= x) lo = m; else hi = m - 1 }
    return knots[lo]
  }
  let t1 = u1 + D
  let T = u => { if (u >= u1) return u + D; if (u < knots[0][0]) return u; let k = find(u, 0); return k[1] + (u - k[0]) * k[2] }
  let U = t => { if (t >= t1) return t - D; if (t < knots[0][1]) return t; let k = find(t, 1); return k[0] + (t - k[1]) / k[2] }
  let rate = u => u < knots[0][0] || u >= u1 ? 1 : find(u, 0)[2]
  return { T, U, D, rate }
}

const stretchDsp = (input, output, ctx) => {
  let st = ctx._state
  if (st === undefined) {
    let sh = stretchShape(ctx), sr = ctx.sampleRate, [a0, a1] = rangeOf(ctx), map = null
    if (sh) {
      let from = Math.max(0, a0)
      if (ctx.fv) {
        // quantum k: content [from + k·q, …) at timeline ot[k], scaled by fv[k]
        let q = ctx.q || 2048, knots = ctx.fv.map((f, k) => [from + k * q, Math.round(ctx.ot[k] * sr), f]), u1 = from + (ctx.n ?? Infinity)
        map = planMap(knots, u1, Number.isFinite(u1) ? a1 - u1 : 0)
      } else {
        let n = ctx.n ?? Infinity, u1 = from + n
        map = planMap([[from, from, ctx.factor]], u1, Number.isFinite(u1) ? a1 - u1 : 0)
      }
      map.rmax = sh.rmax
    }
    st = ctx._state = sh && shifter(input.length, { sampleRate: sr, rmin: sh.rmin, ratio: map.rate, spans: [[a0, a1]], map })
  }
  if (!st) { for (let c = 0; c < input.length; c++) output[c].set(input[c]); return }
  shiftBlock(st, input, output, Math.round(ctx.blockOffset * ctx.sampleRate))
}

audio.op('_stretch_seg', { params: ['factor'], plan: stretchPlan, hidden: true })
audio.op('_stretch_dsp', { params: ['factor'], process: stretchDsp, hidden: true, ranged: true, latency: stretchLatency })
audio.op('stretch', {
  params: ['factor'],
  streamable: true,
  expand: (ctx) => {
    let f = ctx.factor
    if (!f || f === 1) return false

    // Sliding stretch — fn or curve factor over source-timeline seconds: sample
    // per quantum into piecewise tables. Deterministic at plan time; re-expanded
    // as the timeline grows during progressive decode.
    let fn = typeof f === 'function' ? f : isCurve(f) ? curveFn(f) : null
    if (fn) {
      let sr = ctx.sampleRate, q = 2048
      let from = ctx.at != null ? (ctx.at < 0 ? ctx.totalDuration + ctx.at : ctx.at) : 0
      let span = ctx.duration != null ? ctx.duration : ctx.totalDuration - from
      let spanN = Math.max(0, Math.round(span * sr))
      let nq = Math.max(1, Math.ceil(spanN / q))
      let fv = new Array(nq), ot = new Array(nq)
      let tOut = from  // pre-range output ≡ source (unstretched before the range)
      for (let k = 0; k < nq; k++) {
        let take = Math.min(q, spanN - k * q)
        let mid = from + (k * q + take / 2) / sr
        let v = fn(mid)
        fv[k] = Math.max(0.05, Math.min(20, Number.isFinite(v) ? v : 1))
        ot[k] = tOut
        tOut += Math.round(take * fv[k]) / sr
      }
      // _stretch_seg splices in pre-stretch (source) coords; _stretch_dsp works on
      // the stretched timeline — same at, span = Σ quanta output
      let ranged = ctx.at != null || ctx.duration != null
      let dsp = { fv, ot, q, at: ctx.at != null ? from : undefined, duration: ranged ? tOut - from : undefined, n: ranged ? spanN : undefined }
      return [
        ['_stretch_seg', { fv, q, at: ctx.at, duration: ctx.duration }],
        ['_stretch_dsp', dsp]
      ]
    }

    if (f <= 0) throw new RangeError('stretch: factor must be positive')
    // _stretch_seg inherits {at, duration} in pre-stretch coords (segment splice);
    // _stretch_dsp works post-stretch: same at, duration scaled by the factor
    // the stretched range, as long as the plan makes it: round(round(duration · sr) · factor) samples
    let dsp = { factor: f }
    if (ctx.duration != null) { dsp.n = Math.round(ctx.duration * ctx.sampleRate); dsp.duration = Math.round(dsp.n * f) / ctx.sampleRate }
    return [
      ['_stretch_seg', { factor: f }],
      ['_stretch_dsp', dsp]
    ]
  }
})
