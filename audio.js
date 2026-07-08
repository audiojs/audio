/**
 * audio — full bundle with all built-in ops, stats, and methods.
 *
 * import audio from 'audio'
 * let a = await audio('file.mp3')
 * a.gain(-3).trim().normalize()
 * await a.save('out.wav')
 */

export { default } from './core.js'
export { parseTime } from './core.js'
export { render } from './plan.js'

import audio from './core.js'

// ── Module registry — audio.use('name') resolves through here (dynamic import).
// Contract audio-modules from the @audio scope; grows with the published set.
audio.modules = {
  compressor: '@audio/dynamics-compressor/audio-module',
  limiter: '@audio/dynamics-limiter/audio-module',
  gate: '@audio/dynamics-gate/audio-module',
  deesser: '@audio/dynamics-deesser/audio-module',
  softclip: '@audio/dynamics-softclip/audio-module',
  expander: '@audio/dynamics-expander/audio-module',
  compand: '@audio/dynamics-compand/audio-module',
  leveler: '@audio/dynamics-leveler/audio-module',
  'transient-shaper': '@audio/dynamics-transient-shaper/audio-module',
  ducker: '@audio/dynamics-ducker/audio-module',
  dehum: '@audio/denoise-dehum/audio-module',
  specsub: '@audio/denoise-spectral/audio-module',
  wiener: '@audio/denoise-wiener/audio-module',
  omlsa: '@audio/denoise-omlsa/audio-module',
  dereverb: '@audio/denoise-dereverb/audio-module',
  deplosive: '@audio/denoise-deplosive/audio-module',
  dewind: '@audio/denoise-dewind/audio-module',
  declick: '@audio/denoise-declick/audio-module',
  declip: '@audio/denoise-declip/audio-module',
  decrackle: '@audio/denoise-decrackle/audio-module',
  debreath: '@audio/denoise-debreath/audio-module',
  // @audio/denoise-gate exists too — direct-import only ('gate' names the dynamics gate)
  freeverb: '@audio/reverb-freeverb/audio-module',
  delay: '@audio/effect-delay/audio-module',
  chorus: '@audio/effect-chorus/audio-module',
  flanger: '@audio/effect-flanger/audio-module',
  phaser: '@audio/effect-phaser/audio-module',
  tremolo: '@audio/effect-tremolo/audio-module',
  vibrato: '@audio/effect-vibrato/audio-module',
  autowah: '@audio/effect-autowah/audio-module',
  wah: '@audio/effect-wah/audio-module',
  bitcrusher: '@audio/effect-bitcrusher/audio-module',
  distortion: '@audio/effect-distortion/audio-module',
  exciter: '@audio/effect-exciter/audio-module',
  ringmod: '@audio/effect-ringmod/audio-module',
  freqshift: '@audio/effect-freqshift/audio-module',
  multitap: '@audio/effect-multitap/audio-module',
  pingpong: '@audio/effect-pingpong/audio-module',
  slew: '@audio/effect-slew/audio-module',
  noiseshaper: '@audio/effect-noiseshaper/audio-module',
  lofi: '@audio/effect-lofi/audio-module',
  graindelay: '@audio/effect-graindelay/audio-module',
  stutter: '@audio/effect-stutter/audio-module',
  subbass: '@audio/effect-subbass/audio-module',
  sbr: '@audio/effect-sbr/audio-module',
  biquad: '@audio/filter-biquad/audio-module',
  yin: '@audio/pitch-yin/audio-module',
  tube: '@audio/saturate-tube/audio-module',
  osc: '@audio/synth-osc/audio-module',
  isolate: '@audio/vocals/audio-module',
}

// ── Infrastructure (self-register on import) ────────────────────────────

import './cache.js'
import './stats.js'
import './plan.js'

// ── Methods ─────────────────────────────────────────────────────────────

import './fn/clip.js'
import './fn/split.js'
import './fn/play.js'
import './fn/meter.js'
import './fn/meta.js'
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
import './fn/crossfade.js'
import './fn/vocals.js'
import './fn/dither.js'
import './fn/crossfeed.js'
import './fn/resample.js'

// ── Stats ───────────────────────────────────────────────────────────────

import './fn/stat.js'
import './fn/loudness.js'
import './fn/spectrum.js'
import './fn/cepstrum.js'
import './fn/silence.js'
import './fn/beat.js'
import './fn/pitch-detect.js'
