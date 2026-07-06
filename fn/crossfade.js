import { opRange, refLen, renderAt } from '../plan.js'
import audio from '../core.js'
import { CURVES } from './fade.js'
import './pad.js'

// Curve semantics over fade progress x ∈ [0,1]:
//   'cos'/'linear'/... (CURVES) — complementary-amplitude weights: g_out + g_in = 1.
//     Constant amplitude for correlated/identical material; −3 dB power dip at the
//     midpoint for uncorrelated material.
//   'equal' — equal-power law: g_out = cos(xπ/2), g_in = sin(xπ/2), g²+g² = 1
//     (W3C Web Audio equal-power panning law). Constant power for uncorrelated
//     material (two different songs); +3 dB amplitude bump for identical material.
const crossfade = (input, output, ctx) => {
  let source = ctx.source, sr = ctx.sampleRate, chLen = input[0].length
  let equal = ctx.curve === 'equal'
  let fn = equal ? null : CURVES[ctx.curve] ?? CURVES.cos
  let fadeSamples = Math.round(ctx.fadeDuration * sr)
  let sLen = refLen(source, sr)
  let [s] = opRange(ctx, chLen)
  let srcOff = Math.max(0, -s), dstOff = Math.max(0, s)
  let n = Math.min(sLen - srcOff, chLen - dstOff)
  if (n <= 0) { for (let c = 0; c < input.length; c++) output[c].set(input[c]); return }

  let src = renderAt(ctx.render, source, srcOff, n, sr)
  for (let c = 0; c < input.length; c++) {
    let inp = input[c], out = output[c], m = src[c % src.length]
    for (let i = 0; i < chLen; i++) {
      if (i < dstOff || i >= dstOff + n) { out[i] = inp[i]; continue }
      let si = srcOff + (i - dstOff)
      // Fade region: first fadeSamples of source
      if (si < fadeSamples) {
        let x = si / fadeSamples
        if (equal) out[i] = inp[i] * Math.cos(x * Math.PI / 2) + m[i - dstOff] * Math.sin(x * Math.PI / 2)
        else { let t = fn(x); out[i] = inp[i] * (1 - t) + m[i - dstOff] * t }
      } else {
        // Past fade: only source plays
        out[i] = m[i - dstOff]
      }
    }
  }
}

audio.op('crossfade', {
  params: ['source', 'duration', 'curve'],
  ranged: true,
  resolve: (ctx) => {
    let dur = ctx.duration || 0.5
    let curve = ctx.curve || 'cos'
    let source = ctx.source
    if (!source?.pages) source = audio.from(source, { sampleRate: ctx.sampleRate })

    let srcDur = source.duration
    // at = absolute position where crossfade starts (before pad extends the tail).
    // pad appends silence after existing content, so absolute positions are stable.
    let at = Math.max(0, ctx.totalDuration - dur)

    return [
      ['pad', { before: 0, after: Math.max(0, srcDur - dur) }],
      ['crossfade', { source, at, fadeDuration: dur, curve, duration: srcDur }],
    ]
  },
  process: crossfade,
})
