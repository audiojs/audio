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
  compressor: '@audio/dynamics-compressor/audio',
  limiter: '@audio/dynamics-limiter/audio',
  gate: '@audio/dynamics-gate/audio',
  deesser: '@audio/dynamics-deesser/audio',
  softclip: '@audio/dynamics-softclip/audio',
  expander: '@audio/dynamics-expander/audio',
  compand: '@audio/dynamics-compand/audio',
  leveler: '@audio/dynamics-leveler/audio',
  'transient-shaper': '@audio/dynamics-transient-shaper/audio',
  ducker: '@audio/dynamics-ducker/audio',
  dehum: '@audio/denoise-dehum/audio',
  specsub: '@audio/denoise-spectral/audio',
  wiener: '@audio/denoise-wiener/audio',
  omlsa: '@audio/denoise-omlsa/audio',
  dereverb: '@audio/denoise-dereverb/audio',
  deplosive: '@audio/denoise-deplosive/audio',
  dewind: '@audio/denoise-dewind/audio',
  declick: '@audio/denoise-declick/audio',
  declip: '@audio/denoise-declip/audio',
  decrackle: '@audio/denoise-decrackle/audio',
  debreath: '@audio/denoise-debreath/audio',
  // @audio/denoise-gate exists too — direct-import only ('gate' names the dynamics gate)
  freeverb: '@audio/reverb-freeverb/audio',
  delay: '@audio/effect-delay/audio',
  chorus: '@audio/effect-chorus/audio',
  flanger: '@audio/effect-flanger/audio',
  phaser: '@audio/effect-phaser/audio',
  tremolo: '@audio/effect-tremolo/audio',
  vibrato: '@audio/effect-vibrato/audio',
  autowah: '@audio/effect-autowah/audio',
  wah: '@audio/effect-wah/audio',
  bitcrusher: '@audio/effect-bitcrusher/audio',
  distortion: '@audio/effect-distortion/audio',
  exciter: '@audio/effect-exciter/audio',
  ringmod: '@audio/effect-ringmod/audio',
  freqshift: '@audio/effect-freqshift/audio',
  multitap: '@audio/effect-multitap/audio',
  pingpong: '@audio/effect-pingpong/audio',
  slew: '@audio/effect-slew/audio',
  noiseshaper: '@audio/effect-noiseshaper/audio',
  lofi: '@audio/effect-lofi/audio',
  graindelay: '@audio/effect-graindelay/audio',
  stutter: '@audio/effect-stutter/audio',
  subbass: '@audio/effect-subbass/audio',
  sbr: '@audio/effect-sbr/audio',
  biquad: '@audio/filter-biquad/audio',
  yin: '@audio/pitch-yin/audio',
  tube: '@audio/saturate-tube/audio',
  osc: '@audio/synth-osc/audio',
  isolate: '@audio/vocals/audio',
  widener: '@audio/spatial-widener/audio',
  haas: '@audio/spatial-haas/audio',
  panner: '@audio/spatial-panner/audio',
  autopan: '@audio/spatial-autopan/audio',
  midside: '@audio/spatial-midside/audio',
  microshift: '@audio/spatial-microshift/audio',
  surround: '@audio/spatial-surround/audio',
  vocoder: '@audio/shift-pvoc/audio',
  'formant-shift': '@audio/shift-formant/audio',
  paulstretch: '@audio/shift-paulstretch/audio',
  'pitch-shift': '@audio/shift/audio',
  tune: '@audio/tune-snap/audio',
  // @audio/tune-midi exists too — direct-import only (guide-note list isn't a scalar param)
  schroeder: '@audio/reverb-schroeder/audio',
  plate: '@audio/reverb-dattorro/audio',
  fdn: '@audio/reverb-fdn/audio',
  spring: '@audio/reverb-spring/audio',
  shimmer: '@audio/reverb-shimmer/audio',
  // @audio/reverb-convolution — direct-import only (impulse response is an array, not a scalar param)
  fet: '@audio/dynamics-fet/audio',
  opto: '@audio/dynamics-opto/audio',
  varimu: '@audio/dynamics-varimu/audio',
  vca: '@audio/dynamics-vca/audio',
  multiband: '@audio/dynamics-multiband/audio',
  moog: '@audio/filter-moog-ladder/audio',
  korg35: '@audio/filter-korg35/audio',
  diode: '@audio/filter-diode-ladder/audio',
  oberheim: '@audio/filter-oberheim/audio',
  resonator: '@audio/filter-resonator/audio',
  'spectral-tilt': '@audio/filter-spectral-tilt/audio',
  variable: '@audio/filter-variable/audio',
  comb: '@audio/filter-comb/audio',
  dcblocker: '@audio/filter-dcblocker/audio',
  emphasis: '@audio/filter-preemphasis/audio',
  deemphasis: '@audio/filter-preemphasis/audio',
  geq: '@audio/eq-graphic/audio',
  tilt: '@audio/eq-tilt/audio',
  baxandall: '@audio/eq-baxandall/audio',
  dyneq: '@audio/eq-dynamic/audio',
  // @audio/eq-fir / eq-crossover — direct-import only (response curves / SOS designers, not processors)
  tape: '@audio/saturate-tape/audio',
  transistor: '@audio/saturate-transistor/audio',
  waveshaper: '@audio/saturate-waveshaper/audio',
  multisat: '@audio/saturate-multiband/audio',
  amp: '@audio/amp-tube/audio',
  cabinet: '@audio/amp-cabinet/audio',
  defeedback: '@audio/defeedback/audio',
  noise: '@audio/synth-noise/audio',
  chirp: '@audio/synth-chirp/audio',
  pluck: '@audio/synth-pluck/audio',
  risset: '@audio/synth-risset/audio',
  rhythm: '@audio/synth-rhythm/audio',
  sfx: '@audio/synth-sfx/audio',
  kick: '@audio/synth-drum/audio',
  cymbal: '@audio/synth-drum/audio',
  snare: '@audio/synth-drum/audio',
  adsr: '@audio/synth-envelope/audio',
  voice: '@audio/synth-voice/audio',
  poly: '@audio/synth-poly/audio',
  // ↑ note-event instruments: pass notes — a.voice({ notes: [{ time, midi|freq, duration, velocity }] })
  // @audio/synth-dtmf (digit string) / synth-wavetable (table arrays) — direct-import only
  // Codec atoms ({ codec, test?, decode?, encode? }) register the same way — none published yet

  // ── Stat atoms ({ stat, compute } — register as a.stat(name)) ────────────
  truepeak: '@audio/loudness-truepeak/audio',
  lra: '@audio/loudness-lra/audio',
  replaygain: '@audio/loudness-replaygain/audio',
  dr: '@audio/loudness-dr/audio',
  rolloff: '@audio/spectral-rolloff/audio',
  spread: '@audio/spectral-spread/audio',
  slope: '@audio/spectral-slope/audio',
  flux: '@audio/spectral-flux/audio',
  contrast: '@audio/spectral-contrast/audio',
  ltas: '@audio/spectral-ltas/audio',
  structure: '@audio/mir-structure/audio',
  tempogram: '@audio/mir-tempogram/audio',
  melody: '@audio/mir-melody/audio',
  downbeat: '@audio/mir-downbeat/audio',
  fingerprint: '@audio/mir-fingerprint/audio',
  drums: '@audio/mir-drums/audio',
  multif0: '@audio/mir-multif0/audio',
  transcribe: '@audio/mir-transcribe/audio',
  similarity: '@audio/mir-similarity/audio',
  coversong: '@audio/mir-coversong/audio',
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
