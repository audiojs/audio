/**
 * Declick: clicks found and rebuilt from the sound around them (@audio/denoise-declick).
 *
 * a.declick()                            → every click: a vinyl tick, a bad splice, a mouth click on a voice
 * a.declick(5)                           → threshold 5: fainter ones too
 * a.declick({ at: 12.31, duration: 0.02 })  → the clicks there, seen on the spectrogram: looked for only there
 *
 * A click stands out of the AR prediction error by `threshold` times its local level and is rebuilt by least-squares
 * AR interpolation from 46 ms either side (the package's README, Measured). With a range, clicks are looked for only
 * there and none is passed over: not one like a voice's pulses 2.5–15 ms away, nor one longer than `longest` ms. A
 * click's rebuilt span may run past the range by its own length; nothing else changes, sample for sample.
 *
 * Streams: the kernel runs on spans of 16 analysis windows (W, 46 ms: 0.74 s), each with 4 windows of the sound
 * either side, on a grid counted from the timeline's start, so a render from anywhere matches the whole one; latency
 * and warm-up the span and its trailing context (0.93 s at 44.1 kHz). With a range, spans away from it pass through.
 */
import audio from '../core.js'

const W = sr => 2 ** Math.round(Math.log2(0.046 * sr))   // the kernel's analysis window
const span = sr => 16 * W(sr), context = sr => 4 * W(sr)
const delay = (o, sr) => span(sr) + context(sr)

function declick(input, output, ctx) {
  let nch = input.length, len = input[0].length, sr = ctx.sampleRate, H = span(sr), M = context(sr), D = H + M
  let st = ctx._dc
  if (!st) {
    let n = Math.round((ctx.blockOffset || 0) * sr)
    // the first span whose context has all arrived: earlier output is warm-up
    let k = n <= 0 ? 0 : Math.ceil((n + M) / H)
    st = ctx._dc = { n, k, base: n, buf: Array.from({ length: nch }, () => new Float32Array(H + 2 * M + len)), fill: 0, done: [] }
  }
  let end = Number.isFinite(ctx.totalDuration) ? Math.round(ctx.totalDuration * sr) : Infinity
  // the range, absolute: ctx.at is block-relative
  let s0 = ctx.at != null ? Math.round((ctx.at + (ctx.blockOffset || 0)) * sr) : ctx.duration != null ? 0 : null
  let s1 = s0 == null ? null : ctx.duration != null ? s0 + Math.round(ctx.duration * sr) : Infinity
  let mod = audio.op('declick').mod.default

  for (let i = 0; i < len; i++, st.n++) {
    let n = st.n
    if (n - st.base >= st.buf[0].length) grow(st)
    for (let c = 0; c < nch; c++) st.buf[c][n - st.base] = input[c][i]
    // span k rendered once its context has arrived, or the sound has ended
    let a = st.k * H
    if (a < end && (n + 1 >= a + H + M || n + 1 >= end)) {
      let i0 = Math.max(0, a - M, st.base), i1 = Math.min(n + 1, a + H + M, end), b = Math.min(a + H, end)
      let near = s0 == null || (a < s1 + M && a + H > s0 - M)
      let opts = { fs: sr, threshold: ctx.threshold, longest: ctx.longest, order: ctx.order }
      if (s0 != null) opts.regions = [{ at: (s0 - i0) / sr, duration: (Math.min(s1, i1) - s0) / sr }]
      st.done.push({ a, out: st.buf.map(x => {
        let seg = x.subarray(i0 - st.base, i1 - st.base)
        return (near ? mod(seg, opts) : seg).slice(a - i0, b - i0)
      }) })
      st.k++
      // keep the next span's leading context
      let keep = Math.max(st.base, st.k * H - M)
      if (keep > st.base) { for (let x of st.buf) x.copyWithin(0, keep - st.base, n + 1 - st.base); st.base = keep }
    }
    // out: the sample D earlier, from the span holding it
    let j = n - D
    while (st.done.length && j >= st.done[0].a + st.done[0].out[0].length) st.done.shift()
    let d = st.done[0]
    for (let c = 0; c < nch; c++) output[c][i] = d && j >= d.a ? d.out[c][j - d.a] : 0
  }
}
function grow(st) { st.buf = st.buf.map(x => { let y = new Float32Array(x.length * 2); y.set(x); return y }) }

audio.op('declick', {
  params: ['threshold', 'longest', 'order'],
  ranged: true,
  latency: delay,
  warmup: delay,
  load: () => import('@audio/denoise-declick'),
  process: declick,
})
