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
export { parseTime } from './core.js'
export { render } from './plan.js'

// ── Infrastructure (self-register on import) ────────────────────────────

import './cache.js'
import './stats.js'
import './plan.js'

// ── Methods ─────────────────────────────────────────────────────────────

import './fn/clip.js'
import './fn/split.js'
import './fn/play.js'
import './fn/save.js'

// ── Ops ─────────────────────────────────────────────────────────────────

import './fn/crop.js'
import './fn/remove.js'
import './fn/insert.js'
import './fn/repeat.js'
import './fn/gain.js'
import './fn/fade.js'
import './fn/reverse.js'
import './fn/mix.js'
import './fn/write.js'
import './fn/remix.js'
import './fn/trim.js'
import './fn/normalize.js'
import './fn/filter.js'
import './fn/pan.js'
import './fn/pad.js'
import './fn/speed.js'
import './fn/stretch.js'
import './fn/pitch.js'
import './fn/transform.js'

// ── Stats ───────────────────────────────────────────────────────────────

import './fn/stat.js'
import './fn/loudness.js'
import './fn/spectrum.js'
import './fn/cepstrum.js'
import './fn/silence.js'
