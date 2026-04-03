/**
 * audio — full bundle with all built-in ops, stats, and methods.
 *
 * import audio from 'audio'
 * let a = await audio('file.mp3')
 * a.gain(-3).trim().normalize()
 * await a.save('out.wav')
 */

import audio from './core.js'
export { default, PAGE_SIZE, BLOCK_SIZE, opfsCache } from './core.js'
export { render } from './history.js'
export const proto = audio.fn

// ── Plugins ─────────────────────────────────────────────────────────────

import history from './history.js'
import view from './fn/view.js'
import split from './fn/split.js'
import undo from './fn/undo.js'
import apply from './fn/apply.js'
import play from './fn/play.js'
import save from './fn/save.js'
import concat from './fn/concat.js'

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

import minStat from './fn/min.js'
import maxStat from './fn/max.js'
import energyStat from './fn/energy.js'
import db from './fn/db.js'
import rms from './fn/rms.js'
import loudness from './fn/loudness.js'
import peaks from './fn/peaks.js'

audio.use(
  // infrastructure
  history,
  // methods
  view, split, undo, apply, play, save, concat,
  // ops
  crop, remove, insert, repeat, gain, fade, reverse, mix, write, remix, trim, normalize,
  // stats
  minStat, maxStat, energyStat, db, rms, loudness, peaks,
)
