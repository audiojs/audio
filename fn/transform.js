import audio from '../core.js'

audio.op('transform', {
  process: (chs, ctx) => ctx.args[0](chs, ctx),
  call(std, f) { return this.run({ type: 'transform', args: [f] }) }
})
