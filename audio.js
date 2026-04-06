/**
 * audio — full bundle with all built-in ops, stats, and methods.
 *
 * import audio from 'audio'
 * let a = await audio('file.mp3')
 * a.gain(-3).trim().normalize()
 * await a.save('out.wav')
 */

import audio from './core.js'
export { default } from './core.js'
export { render } from './history.js'

// ── Infrastructure (self-register on import) ────────────────────────────

import './cache.js'
import './stats.js'
import './history.js'

// ── Plugins ─────────────────────────────────────────────────────────────

import view from './fn/view.js'
import split from './fn/split.js'
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
import filter from './fn/filter.js'
import pan from './fn/pan.js'
import pad from './fn/pad.js'
import transform from './fn/transform.js'

import stat from './fn/stat.js'
import spectrumStat from './fn/spectrum.js'
import cepstrumStat from './fn/cepstrum.js'

audio.use(
  // methods
  view, split, play, save, concat,
  // ops
  crop, remove, insert, repeat, gain, fade, reverse, mix, write, remix, trim, normalize, filter, pan, pad, transform,
  // stats
  stat, spectrumStat, cepstrumStat,
)
