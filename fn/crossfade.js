import { opRange } from '../plan.js'
import audio from '../core.js'
import { CURVES } from './fade.js'
import './pad.js'

const crossfade = (input, output, ctx) => {
  let source = ctx.source, sr = ctx.sampleRate, chLen = input[0].length
  let fn = CURVES[ctx.curve] ?? CURVES.cos
  let fadeSamples = Math.round(ctx.fadeDuration * sr)
  let sLen = Array.isArray(source) ? source[0].length : source.length
  let [s] = opRange(ctx, chLen)
  let srcOff = Math.max(0, -s), dstOff = Math.max(0, s)
  let n = Math.min(sLen - srcOff, chLen - dstOff)
  if (n <= 0) { for (let c = 0; c < input.length; c++) output[c].set(input[c]); return }

  let src = ctx.render(source, srcOff, n)
  for (let c = 0; c < input.length; c++) {
    let inp = input[c], out = output[c], m = src[c % src.length]
    for (let i = 0; i < chLen; i++) {
      if (i < dstOff || i >= dstOff + n) { out[i] = inp[i]; continue }
      let si = srcOff + (i - dstOff)
      // Fade region: first fadeSamples of source
      if (si < fadeSamples) {
        let t = fn(si / fadeSamples)
        out[i] = inp[i] * (1 - t) + m[i - dstOff] * t
      } else {
        // Past fade: only source plays
        out[i] = m[i - dstOff]
      }
    }
  }
}

audio.op('crossfade', {
  params: ['source', 'duration', 'curve'],
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
