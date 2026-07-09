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
  schroeder: '@audio/reverb-schroeder/atom',
  plate: '@audio/reverb-dattorro/atom',
  fdn: '@audio/reverb-fdn/atom',
  spring: '@audio/reverb-spring/atom',
  shimmer: '@audio/reverb-shimmer/atom',
  // @audio/reverb-convolution — direct-import only (impulse response is an array, not a scalar param)
  fet: '@audio/dynamics-fet/atom',
  opto: '@audio/dynamics-opto/atom',
  varimu: '@audio/dynamics-varimu/atom',
  vca: '@audio/dynamics-vca/atom',
  multiband: '@audio/dynamics-multiband/atom',
  moog: '@audio/filter-moog-ladder/atom',
  korg35: '@audio/filter-korg35/atom',
  diode: '@audio/filter-diode-ladder/atom',
  oberheim: '@audio/filter-oberheim/atom',
  resonator: '@audio/filter-resonator/atom',
  'spectral-tilt': '@audio/filter-spectral-tilt/atom',
  variable: '@audio/filter-variable/atom',
  comb: '@audio/filter-comb/atom',
  dcblocker: '@audio/filter-dcblocker/atom',
  emphasis: '@audio/filter-preemphasis/atom',
  deemphasis: '@audio/filter-preemphasis/atom',
  geq: '@audio/eq-graphic/atom',
  tilt: '@audio/eq-tilt/atom',
  baxandall: '@audio/eq-baxandall/atom',
  dyneq: '@audio/eq-dynamic/atom',
  // @audio/eq-fir / eq-crossover — direct-import only (response curves / SOS designers, not processors)
  tape: '@audio/saturate-tape/atom',
  transistor: '@audio/saturate-transistor/atom',
  waveshaper: '@audio/saturate-waveshaper/atom',
  multisat: '@audio/saturate-multiband/atom',
  amp: '@audio/amp-tube/atom',
  cabinet: '@audio/amp-cabinet/atom',
  defeedback: '@audio/defeedback/atom',
  noise: '@audio/synth-noise/atom',
  chirp: '@audio/synth-chirp/atom',
  pluck: '@audio/synth-pluck/atom',
  risset: '@audio/synth-risset/atom',
  rhythm: '@audio/synth-rhythm/atom',
  sfx: '@audio/synth-sfx/atom',
  kick: '@audio/synth-drum/atom',
  cymbal: '@audio/synth-drum/atom',
  snare: '@audio/synth-drum/atom',
  adsr: '@audio/synth-envelope/atom',
  // @audio/synth-dtmf (digit string) / synth-wavetable (table arrays) / synth-voice+poly
  // (note events) — direct-import only until string/array params or event hosting exist

  // ── Stat atoms ({ stat, compute } — register as a.stat(name)) ────────────
  truepeak: '@audio/loudness-truepeak/stat',
  lra: '@audio/loudness-lra/stat',
  replaygain: '@audio/loudness-replaygain/stat',
  dr: '@audio/loudness-dr/stat',
  rolloff: '@audio/spectral-rolloff/stat',
  spread: '@audio/spectral-spread/stat',
  slope: '@audio/spectral-slope/stat',
  flux: '@audio/spectral-flux/stat',
  contrast: '@audio/spectral-contrast/stat',
  ltas: '@audio/spectral-ltas/stat',
  structure: '@audio/mir-structure/stat',
  tempogram: '@audio/mir-tempogram/stat',
  melody: '@audio/mir-melody/stat',
  downbeat: '@audio/mir-downbeat/stat',
  fingerprint: '@audio/mir-fingerprint/stat',
  drums: '@audio/mir-drums/stat',
  multif0: '@audio/mir-multif0/stat',
  transcribe: '@audio/mir-transcribe/stat',
  similarity: '@audio/mir-similarity/stat',
  coversong: '@audio/mir-coversong/stat',
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
