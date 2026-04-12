import audio from '../core.js'

audio.op('transform', {
  params: ['fn'],
  process: (input, output, ctx) => ctx.fn(input, output, ctx)
})
