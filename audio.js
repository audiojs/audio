/**
 * audio — full bundle with all built-in ops.
 *
 * import audio from 'audio'
 * let a = await audio('file.mp3')
 * a.gain(-3).trim().normalize()
 * await a.save('out.wav')
 */

import audio from './core.js'
export { default, ops, PAGE_SIZE, BLOCK_SIZE, decodeBuf, opfsCache } from './core.js'

// ── Ops ─────────────────────────────────────────────────────────────────

import crop from './op/crop.js'
import remove from './op/remove.js'
import insert from './op/insert.js'
import repeat from './op/repeat.js'
import gain from './op/gain.js'
import fade from './op/fade.js'
import reverse from './op/reverse.js'
import mix from './op/mix.js'
import write from './op/write.js'
import remix from './op/remix.js'
import trim from './op/trim.js'
import normalize from './op/normalize.js'

audio.op('crop', crop)
audio.op('remove', remove)
audio.op('insert', insert)
audio.op('repeat', repeat)
audio.op('gain', gain)
audio.op('fade', fade)
audio.op('reverse', reverse)
audio.op('mix', mix)
audio.op('write', write)
audio.op('remix', remix)
audio.op('trim', trim)
audio.op('normalize', normalize)
