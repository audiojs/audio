/** Per-chunk inline transform. `a.transform(fn)` → fn(channels, ctx) each chunk. */
const _transform = (chs, ctx) => ctx.args[0](chs, ctx)

import audio from '../core.js'
audio.op('_transform', _transform)
audio.fn.transform = function(f) { return this.run({ type: '_transform', args: [f] }) }
