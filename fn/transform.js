import audio from '../core.js'

audio.op('transform', {
  params: ['fn'],
  fnArgs: ['fn'],
  // its options are the function's own
  nonfinite: true,
  process: (input, output, ctx) => ctx.fn(input, output, ctx)
})
