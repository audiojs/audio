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

// ── Atom registry — audio.use('name') resolves through here (dynamic import).
// Contract atoms from the @audio scope; grows with the published set.
audio.atoms = {
  compressor: '@audio/dynamics-compressor/atom',
  limiter: '@audio/dynamics-limiter/atom',
  gate: '@audio/dynamics-gate/atom',
  deesser: '@audio/dynamics-deesser/atom',
  softclip: '@audio/dynamics-softclip/atom',
  expander: '@audio/dynamics-expander/atom',
  compand: '@audio/dynamics-compand/atom',
  leveler: '@audio/dynamics-leveler/atom',
  'transient-shaper': '@audio/dynamics-transient-shaper/atom',
  ducker: '@audio/dynamics-ducker/atom',
  dehum: '@audio/denoise-dehum/atom',
  specsub: '@audio/denoise-spectral/atom',
  wiener: '@audio/denoise-wiener/atom',
  omlsa: '@audio/denoise-omlsa/atom',
  dereverb: '@audio/denoise-dereverb/atom',
  deplosive: '@audio/denoise-deplosive/atom',
  dewind: '@audio/denoise-dewind/atom',
  declick: '@audio/denoise-declick/atom',
  declip: '@audio/denoise-declip/atom',
  decrackle: '@audio/denoise-decrackle/atom',
  debreath: '@audio/denoise-debreath/atom',
  // @audio/denoise-gate exists too — direct-import only ('gate' names the dynamics gate)
  freeverb: '@audio/reverb-freeverb/atom',
  delay: '@audio/effect-delay/atom',
  chorus: '@audio/effect-chorus/atom',
  flanger: '@audio/effect-flanger/atom',
  phaser: '@audio/effect-phaser/atom',
  tremolo: '@audio/effect-tremolo/atom',
  vibrato: '@audio/effect-vibrato/atom',
  autowah: '@audio/effect-autowah/atom',
  wah: '@audio/effect-wah/atom',
  bitcrusher: '@audio/effect-bitcrusher/atom',
  distortion: '@audio/effect-distortion/atom',
  exciter: '@audio/effect-exciter/atom',
  ringmod: '@audio/effect-ringmod/atom',
  freqshift: '@audio/effect-freqshift/atom',
  multitap: '@audio/effect-multitap/atom',
  pingpong: '@audio/effect-pingpong/atom',
  slew: '@audio/effect-slew/atom',
  noiseshaper: '@audio/effect-noiseshaper/atom',
  lofi: '@audio/effect-lofi/atom',
  graindelay: '@audio/effect-graindelay/atom',
  stutter: '@audio/effect-stutter/atom',
  subbass: '@audio/effect-subbass/atom',
  sbr: '@audio/effect-sbr/atom',
  biquad: '@audio/filter-biquad/atom',
  yin: '@audio/pitch-yin/atom',
  tube: '@audio/saturate-tube/atom',
  osc: '@audio/synth-osc/atom',
  isolate: '@audio/vocals/atom',
  widener: '@audio/spatial-widener/atom',
  haas: '@audio/spatial-haas/atom',
  panner: '@audio/spatial-panner/atom',
  autopan: '@audio/spatial-autopan/atom',
  midside: '@audio/spatial-midside/atom',
  microshift: '@audio/spatial-microshift/atom',
  surround: '@audio/spatial-surround/atom',
  vocoder: '@audio/shift-pvoc/atom',
  'formant-shift': '@audio/shift-formant/atom',
  paulstretch: '@audio/shift-paulstretch/atom',
  'pitch-shift': '@audio/shift/atom',
  tune: '@audio/tune-snap/atom',
  // @audio/tune-midi exists too — direct-import only (guide-note list isn't a scalar param)
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
