/**
 * Stretch — time-stretch by factor, preserving pitch.
 * factor > 1 = slower (longer), factor < 1 = faster (shorter).
 * factor may be a function `t => f` or curve `{t, v}` (t = source-timeline seconds)
 * — sliding stretch: a continuous tempo envelope, output length = ∫factor dt.
 *
 * Two-stage pipeline:
 *   1. Plan: segment rate = 1/factor, count *= factor — linear resample gives the
 *      target duration but pitch-shifted by 1/factor. Sliding factors emit one
 *      segment per quantum (piecewise-constant rate — plan-time, deterministic:
 *      ranged reads, seek, duration, serialization all follow the segment algebra).
 *   2. Process: pitch-shift streaming blocks by `factor` (phase-lock + drain) to
 *      restore the original pitch. Sliding factors drive the vocoder's per-frame
 *      hop function (fourier-transform ≥2.4) and the drain cursor per block.
 *
 * Streaming pitch-shift primitive (initPhaseLockStream / phaseLockBlock) is
 * exported for reuse by pitch.js — same phase-lock + resample, different
 * ratio source (semitones → ratio instead of factor).
 */

import { seg, segSrcStart, spliceSegs, planOffset, isCurve, curveFn } from '../plan.js'
import audio from '../core.js'
import { pvocLock } from '@audio/stretch'

// pvocLock stretches time by r and keeps pitch, with a phase-locked vocoder (Laroche & Dolson 1999,
// @audio/stretch-pvoc-lock); a fractional cursor then resamples that stream at rate r — one advance of r per
// output sample — pitch-shifting by r at a fixed block size.
// Both hops stay within a quarter frame, so phase advances measure frequency unambiguously: compression
// shortens the synthesis hop instead of lengthening the analysis hop, which past a frame skipped input and
// broke the frame buffer. The analysis hop is fractional, so the vocoder's average ratio is exactly r and the
// cursor consumes exactly what it produces, without drift.
// The vocoder emits a frame late. The cursor runs a fixed latency behind rather than stalling on an empty
// ring (a stall left a silent gap, then a click); the ops declare that latency and the engine reads ahead to
// compensate it. They handle their own range, so dry and processed audio share the one latency.
// The vocoder's first frame smears its onset across the frame (pre-echo), so processed audio would start and
// end mid-waveform; 5 ms raised-cosine ramps cross from dry to processed at both edges of the span.
// `ratio` may be a function `(t seconds of this stage's feed) => r` — sliding stretch; `rmin` is its floor.
// Frames last about 23 ms at any rate (1024 samples at 44.1 kHz): a longer frame smears attacks further.
const frameOf = (sampleRate = 44100) => 2 ** Math.round(Math.log2(sampleRate * 1024 / 44100))
const synHopOf = (r, frame) => Math.max(1, Math.min(frame >> 2, Math.round((frame >> 2) * r)))

/** Output samples the stage runs behind its input, for ratios down to rmin: the vocoder's frame fill plus the
 *  synthesis frame it holds back. Covers every block size for r in [0.05, 20] (measured). */
export const phaseLockLatency = (rmin, sampleRate) => {
  let frame = frameOf(sampleRate)
  return frame + Math.ceil((frame + synHopOf(rmin, frame)) / rmin)
}

export function initPhaseLockStream(nch, ratio, sampleRate = 44100, rmin = typeof ratio === 'function' ? ratio(0) : ratio) {
  let rate = typeof ratio === 'function' ? ratio : () => ratio, r0 = rate(0), frame = frameOf(sampleRate)
  let synHop = synHopOf(rmin, frame), lat = phaseLockLatency(rmin, sampleRate)
  let anaHop = fs => synHop / Math.max(1e-6, rate(Math.max(0, fs) / sampleRate))
  let opts = { frameSize: frame, hopSize: frame >> 2, synHop, anaHop, sampleRate, fs: sampleRate }
  return Array.from({ length: nch }, () => ({
    write: pvocLock(opts),
    ring: new Float32Array(4096),
    ringLen: 0,
    ringStart: 0,
    // Pre-roll: the cursor reaches the vocoder's first sample `lat` output samples after the feed starts.
    readPos: -lat * r0,
    ratio: r0,
    lat,
    // Out of range, input leaves through a delay line of the same length.
    delay: new Float32Array(lat),
    dp: 0,
    fed: 0,
    fade: Math.max(1, Math.round(.005 * sampleRate))
  }))
}

/** ctx carries the stage's range: `at` in seconds relative to this block, `duration` in seconds. */
export function phaseLockBlock(state, input, output, ctx) {
  let sr = ctx?.sampleRate || 44100
  let a0 = ctx?.at != null ? Math.round(ctx.at * sr) : -Infinity
  let a1 = ctx?.duration != null ? (ctx.at != null ? a0 : -Math.round((ctx.blockOffset || 0) * sr)) + Math.round(ctx.duration * sr) : Infinity
  for (let c = 0; c < input.length; c++) processChannel(state[c], input[c], output[c], a0, a1)
}

function processChannel(s, input, output, a0, a1) {
  let len = input.length, lat = s.lat, whole = a0 === -Infinity && a1 === Infinity
  // The vocoder takes the in-range input, then one latency of silence past the range so its tail drains.
  let f0 = Math.max(0, Math.min(len, a0)), f1 = Math.max(f0, Math.min(len, a1 + lat))
  if (f1 > f0) {
    let feed = input.subarray(f0, f1)
    if (a1 < f1) { feed = feed.slice(); feed.fill(0, Math.max(0, a1 - f0)) }
    let chunk = s.write(feed)
    if (chunk.length) appendRing(s, chunk)
  }

  // Sliding stretch (s.map): the drain rate must match the factor that stretched
  // the CONTENT under the cursor — the ring lags the writer, so keying by wall
  // time would detune by f′·lag. The map converts ring position (vocoder-output
  // samples) → quantum, replaying exactly the spans the segments produced.
  let map = s.map, r = s.ratio, fade = s.fade
  for (let i = 0; i < len; i++) {
    let wet = 0
    if (i >= f0 && i < f1) {
      let p = s.readPos
      if (map) {
        while (s.j + 1 < map.sv.length && p >= map.sv[s.j + 1]) s.j++
        r = map.kf[s.j]
      }
      // 4-point cubic (Catmull-Rom): the cursor upsamples by 1/r, and linear interpolation's corners image there.
      let idx = Math.floor(p) - s.ringStart, ring = s.ring
      if (idx >= 0 && idx + 1 < s.ringLen) {
        let x0 = ring[idx], x1 = ring[idx + 1], xm = idx > 0 ? ring[idx - 1] : x0, x2 = idx + 2 < s.ringLen ? ring[idx + 2] : x1, f = p - Math.floor(p)
        wet = x0 + .5 * f * (x1 - xm + f * (2 * xm - 5 * x0 + 4 * x1 - x2 + f * (3 * (x0 - x1) + x2 - xm)))
      }
      s.readPos += r
      s.fed++
    }
    let dry = 0
    if (!whole) {
      dry = s.delay[s.dp]
      s.delay[s.dp] = input[i]
      s.dp = s.dp + 1 === lat ? 0 : s.dp + 1
    }
    // The sample leaving now entered `lat` samples ago (position q): from the range, it is the vocoder's,
    // ramped in over its first `fade` samples and out over its last.
    let q = i - lat, w = 0
    if (q >= a0 && q < a1) w = Math.max(0, Math.min(1, (s.fed - lat) / fade, (a1 - q) / fade))
    output[i] = w === 1 ? wet : w === 0 ? dry : dry + (wet - dry) * (.5 - .5 * Math.cos(Math.PI * w))
  }

  let drop = Math.floor(s.readPos) - 1 - s.ringStart
  if (drop > 0 && drop < s.ringLen) {
    s.ring.copyWithin(0, drop, s.ringLen)
    s.ringLen -= drop
    s.ringStart += drop
  }
}

function appendRing(s, chunk) {
  let need = s.ringLen + chunk.length
  if (need > s.ring.length) {
    let nb = new Float32Array(Math.max(need, s.ring.length * 2))
    nb.set(s.ring.subarray(0, s.ringLen))
    s.ring = nb
  }
  s.ring.set(chunk, s.ringLen)
  s.ringLen += chunk.length
}

function stretchSegs(segs, factor) {
  let rate = 1 / factor
  let r = [], dst = 0
  for (let s of segs) {
    let count = Math.round(s[1] * factor)
    r.push(seg(s[0], count, dst, s[4] === null ? undefined : (s[3] || 1) * rate, s[4], s[5]))
    dst += count
  }
  return r
}

// Sliding: one segment per source quantum, each with its own constant rate —
// the piecewise-constant decomposition of a continuous factor envelope.
// `fv[k]` covers source samples [k·q, (k+1)·q) of the spliced sub-range.
function slidingSegs(segs, fv, q) {
  let r = [], dst = 0
  for (let s of segs) {
    let done = 0
    while (done < s[1]) {
      let srcPos = s[2] + done  // pre-stretch output coords of the sub-range
      let k = Math.min(Math.floor(srcPos / q), fv.length - 1)
      let take = Math.min(s[1] - done, (k + 1) * q - srcPos)
      let f = fv[k]
      let count = Math.round(take * f)
      if (count > 0) r.push(seg(segSrcStart(s, srcPos, take), count, dst, s[4] === null ? undefined : (s[3] || 1) / f, s[4], s[5]))
      dst += count
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

const stretchDsp = (input, output, ctx) => {
  // Sliding: ot/fv tables (output-time quantum breakpoints). The vocoder gets a
  // live hop fn anchored at this stage's first fed block; the drain follows a
  // ring-position → quantum map (see processChannel).
  if (ctx.fv && ctx.ot) {
    let st = ctx._state
    if (!st) {
      let base = ctx.blockOffset || 0, sr = ctx.sampleRate
      let fn = t => lookupAt(ctx.ot, ctx.fv, base + t)
      st = ctx._state = initPhaseLockStream(input.length, fn, sr, Math.min(...ctx.fv))
      // vocoder-output sample breakpoints since feed start, one factor per span
      let ot = ctx.ot, fv = ctx.fv
      let k0 = 0
      while (k0 + 1 < ot.length && ot[k0 + 1] <= base) k0++
      let sv = [0], kf = [fv[k0]], acc = 0
      for (let k = k0; k + 1 < ot.length; k++) {
        acc += (ot[k + 1] - Math.max(ot[k], base)) * fv[k] * sr
        sv.push(acc)
        kf.push(fv[k + 1])
      }
      let map = { sv, kf }
      for (let s of st) { s.map = map; s.j = 0 }
    }
    phaseLockBlock(st, input, output, ctx)
    return
  }
  let factor = ctx.factor
  if (!factor || factor === 1) {
    for (let c = 0; c < input.length; c++) output[c].set(input[c])
    return
  }
  if (!ctx._state) ctx._state = initPhaseLockStream(input.length, factor, ctx.sampleRate)
  phaseLockBlock(ctx._state, input, output, ctx)
}

audio.op('_stretch_seg', { params: ['factor'], plan: stretchPlan, hidden: true })
const stretchLatency = (o, sr) => o.fv ? phaseLockLatency(Math.min(...o.fv), sr) : typeof o.factor === 'number' && o.factor > 0 && o.factor !== 1 ? phaseLockLatency(o.factor, sr) : 0
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
      let dsp = { fv, ot, at: ctx.at != null ? from : undefined, duration: ctx.at != null || ctx.duration != null ? tOut - from : undefined }
      return [
        ['_stretch_seg', { fv, q, at: ctx.at, duration: ctx.duration }],
        ['_stretch_dsp', dsp]
      ]
    }

    if (f <= 0) throw new RangeError('stretch: factor must be positive')
    // _stretch_seg inherits {at, duration} in pre-stretch coords (segment splice);
    // _stretch_dsp works post-stretch: same at, duration scaled by the factor
    let dsp = { factor: f }
    if (ctx.duration != null) dsp.duration = ctx.duration * f
    return [
      ['_stretch_seg', { factor: f }],
      ['_stretch_dsp', dsp]
    ]
  }
})
