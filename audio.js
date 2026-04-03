/**
 * audio — full bundle with all built-in ops and stats.
 *
 * import audio from 'audio'
 * let a = await audio('file.mp3')
 * a.gain(-3).trim().normalize()
 * await a.save('out.wav')
 */

import audio from './core.js'
export { default, ops, PAGE_SIZE, BLOCK_SIZE, opfsCache } from './core.js'
export const proto = audio.fn

// ── Fns ─────────────────────────────────────────────────────────────────

import view from './fn/view.js'
import split from './fn/split.js'
import undo from './fn/undo.js'
import apply from './fn/apply.js'
import play from './fn/play.js'
import save from './fn/save.js'
import concat from './fn/concat.js'

audio.fn_register('view', view)
audio.fn_register('split', split)
audio.fn_register('undo', undo)
audio.fn_register('apply', apply)
audio.fn_register('play', play)
audio.fn_register('save', save)
audio.fn_register('concat', concat)

// Static concat — convenience wrapper over instance method
audio.concat = function(...sources) {
  if (!sources.length) throw new TypeError('audio.concat: expected at least one source')
  let first = audio.from(sources[0])
  return first.concat(...sources.slice(1))
}

// ── Ops ─────────────────────────────────────────────────────────────────

import crop from './fn/crop.js'
import remove from './fn/remove.js'
import insert from './fn/insert.js'
import repeat from './fn/repeat.js'
import gain from './fn/gain.js'
import fade from './fn/fade.js'
import reverse from './fn/reverse.js'
import mix from './fn/mix.js'
import write from './fn/write.js'
import remix from './fn/remix.js'
import trim from './fn/trim.js'
import normalize from './fn/normalize.js'

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

// ── Stats ───────────────────────────────────────────────────────────────

import minStat from './fn/min.js'
import maxStat from './fn/max.js'
import energyStat from './fn/energy.js'
import db from './fn/db.js'
import rms from './fn/rms.js'
import loudness from './fn/loudness.js'
import peaks from './fn/peaks.js'

audio.stat('min', minStat)
audio.stat('max', maxStat)
audio.stat('energy', energyStat)
audio.stat('db', db)
audio.stat('rms', rms)
audio.stat('loudness', loudness)
audio.stat('peaks', peaks)
