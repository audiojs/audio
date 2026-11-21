/**
 * audio — full bundle with all built-in ops, stats, and methods.
 *
 * import audio from 'audio'
 * let a = await audio('file.mp3')
 * a.gain(-3).trim().normalize()
 * await a.save('out.wav')
 */

export { default } from './core.js'
export { parseTime, bitDepth } from './core.js'
export { render, wholeOf } from './plan.js'
export { keysOf, recall, keep, onto, prefix, rootOf, idOf } from './checkpoint.js'

import audio, { LOAD, loadOps, positional, blame, keeping } from './core.js'
import { opMethods, widening, builtin } from './plan.js'

// The package's ops, registered by the modules imported below (an import runs before this line): their edits' values
// are judged at the call (plan.js judge); an op registered later, the user's or a registry processor, is none of them
for (let d of Object.values(audio.op())) builtin.add(d)

// ── Plugin registry: name → package, loaded by dynamic import on first use (autowired:
// a.compressor() works without audio.use; the atom loads at the first render).
// Contract plugins from the @audio scope; grows with the published set.
const OPS = {
  compressor: '@audio/dynamics/compressor/audio',
  limiter: '@audio/dynamics/limiter/audio',
  gate: '@audio/dynamics/gate/audio',
  deesser: '@audio/dynamics/deesser/audio',
  softclip: '@audio/dynamics/softclip/audio',
  expander: '@audio/dynamics/expander/audio',
  compand: '@audio/dynamics/compand/audio',
  leveler: '@audio/dynamics/leveler/audio',
  'transient-shaper': '@audio/dynamics/transient-shaper/audio',
  unlimit: '@audio/dynamics/unlimit/audio',
  auto: '@audio/chain/audio',
  ducker: '@audio/dynamics/ducker/audio',
  dehum: '@audio/denoise/dehum/audio',
  specsub: '@audio/denoise/spectral/audio',
  wiener: '@audio/denoise/wiener/audio',
  omlsa: '@audio/denoise/omlsa/audio',
  deplosive: '@audio/denoise/deplosive/audio',
  dewind: '@audio/denoise/dewind/audio',
  dewow: '@audio/denoise/dewow/audio',
  debleed: '@audio/denoise/debleed/audio',
  declip: '@audio/denoise/declip/audio',
  decrackle: '@audio/denoise/decrackle/audio',
  debreath: '@audio/denoise/debreath/audio',
  desqueak: '@audio/denoise/desqueak/audio',
  // neural lane, optional package: RNNoise with its weights inside (deepfilter, its DeepFilterNet3, is fn/deepfilter.js)
  rnnoise: '@audio/neural-denoise/audio',
  // denoise-gate/-deesser merged into the dynamics atoms above (2026-07 near-dupe merge:
  // gate gained hysteresis + look-ahead; deesser gained mode 'band' dynamic peaking EQ)
  freeverb: '@audio/reverb/freeverb/audio',
  delay: '@audio/effect/delay/audio',
  chorus: '@audio/effect/chorus/audio',
  flanger: '@audio/effect/flanger/audio',
  phaser: '@audio/effect/phaser/audio',
  tremolo: '@audio/effect/tremolo/audio',
  vibrato: '@audio/effect/vibrato/audio',
  autowah: '@audio/effect/autowah/audio',
  wah: '@audio/effect/wah/audio',
  bitcrusher: '@audio/effect/bitcrusher/audio',
  distortion: '@audio/effect/distortion/audio',
  exciter: '@audio/effect/exciter/audio',
  ringmod: '@audio/effect/ringmod/audio',
  freqshift: '@audio/effect/freqshift/audio',
  multitap: '@audio/effect/multitap/audio',
  pingpong: '@audio/effect/pingpong/audio',
  slew: '@audio/effect/slew/audio',
  noiseshaper: '@audio/effect/noiseshaper/audio',
  lofi: '@audio/effect/lofi/audio',
  graindelay: '@audio/effect/graindelay/audio',
  stutter: '@audio/effect/stutter/audio',
  subbass: '@audio/effect/subbass/audio',
  sbr: '@audio/effect/sbr/audio',
  rotary: '@audio/effect/rotary/audio',
  tapestop: '@audio/effect/tapestop/audio',
  tube: '@audio/saturate/tube/audio',
  osc: '@audio/synth/osc/audio',
  fm: '@audio/synth/fm/audio',
  modal: '@audio/synth/modal/audio',
  isolate: '@audio/vocals/audio',
  widener: '@audio/spatial/widener/audio',
  haas: '@audio/spatial/haas/audio',
  panner: '@audio/spatial/panner/audio',
  autopan: '@audio/spatial/autopan/audio',
  midside: '@audio/spatial/midside/audio',
  microshift: '@audio/spatial/microshift/audio',
  binaural: '@audio/spatial/binaural/audio',
  surround: '@audio/spatial/surround/audio',
  'ambisonic-panner': '@audio/spatial/ambisonic/audio',
  'ambisonic-decoder': '@audio/spatial/ambisonic/audio',
  'ambisonic-rotate': '@audio/spatial/ambisonic/audio',
  vocoder: '@audio/shift/pvoc/audio',
  'formant-shift': '@audio/shift/formant/audio',
  paulstretch: '@audio/shift/paulstretch/audio',
  'pitch-shift': '@audio/shift/audio',
  // each of pitch-shift's methods alone, so pitch({ method }) loads that one (fn/pitch.js)
  'pitch-ola': '@audio/shift/ola/audio',
  'pitch-transient': '@audio/shift/transient/audio',
  'pitch-psola': '@audio/shift/psola/audio',
  'pitch-wsola': '@audio/shift/wsola/audio',
  'pitch-granular': '@audio/shift/granular/audio',
  'pitch-sms': '@audio/shift/sms/audio',
  'pitch-hpss': '@audio/shift/hpss/audio',
  'pitch-sample': '@audio/shift/sample/audio',
  'pitch-hybrid': '@audio/shift/hybrid/audio',
  'pitch-delay': '@audio/shift/delay/audio',
  'pitch-lpc': '@audio/shift/lpc/audio',
  tune: '@audio/tune/snap/audio',
  // @audio/tune-midi exists too — direct-import only (guide-note list isn't a scalar param)
  schroeder: '@audio/reverb/schroeder/audio',
  plate: '@audio/reverb/dattorro/audio',
  fdn: '@audio/reverb/fdn/audio',
  spring: '@audio/reverb/spring/audio',
  shimmer: '@audio/reverb/shimmer/audio',
  // @audio/reverb-convolution — a.convolve(ir) (fn/convolve.js: the IR is a file, an instance or samples)
  fet: '@audio/dynamics/fet/audio',
  opto: '@audio/dynamics/opto/audio',
  varimu: '@audio/dynamics/varimu/audio',
  vca: '@audio/dynamics/vca/audio',
  multiband: '@audio/dynamics/multiband/audio',
  moog: '@audio/filter/moog-ladder/audio',
  korg35: '@audio/filter/korg35/audio',
  diode: '@audio/filter/diode-ladder/audio',
  oberheim: '@audio/filter/oberheim/audio',
  resonator: '@audio/filter/resonator/audio',
  'spectral-tilt': '@audio/filter/spectral-tilt/audio',
  variable: '@audio/filter/variable/audio',
  comb: '@audio/filter/comb/audio',
  dcblocker: '@audio/filter/dcblocker/audio',
  emphasis: '@audio/filter/preemphasis/audio',
  deemphasis: '@audio/filter/preemphasis/audio',
  derivative: '@audio/filter/derivative/audio',
  integral: '@audio/filter/derivative/audio',
  'a-weighting': '@audio/weighting/a/audio',
  'b-weighting': '@audio/weighting/b/audio',
  'c-weighting': '@audio/weighting/c/audio',
  'd-weighting': '@audio/weighting/d/audio',
  'k-weighting': '@audio/weighting/k/audio',
  itu468: '@audio/weighting/itu468/audio',
  riaa: '@audio/weighting/riaa/audio',
  geq: '@audio/eq/graphic/audio',
  tilt: '@audio/eq/tilt/audio',
  baxandall: '@audio/eq/baxandall/audio',
  dyneq: '@audio/eq/dynamic/audio',
  // @audio/eq-fir / eq-crossover — direct-import only (response curves / SOS designers, not processors)
  tape: '@audio/saturate/tape/audio',
  transistor: '@audio/saturate/transistor/audio',
  waveshaper: '@audio/saturate/waveshaper/audio',
  multisat: '@audio/saturate/multiband/audio',
  amp: '@audio/amp/tube/audio',
  cabinet: '@audio/amp/cabinet/audio',
  defeedback: '@audio/defeedback/audio',
  noise: '@audio/synth/noise/audio',
  chirp: '@audio/synth/chirp/audio',
  pluck: '@audio/synth/pluck/audio',
  risset: '@audio/synth/risset/audio',
  rhythm: '@audio/synth/rhythm/audio',
  sfx: '@audio/synth/sfx/audio',
  kick: '@audio/synth/drum/audio',
  cymbal: '@audio/synth/drum/audio',
  snare: '@audio/synth/drum/audio',
  adsr: '@audio/synth/envelope/audio',
  voice: '@audio/synth/voice/audio',
  poly: '@audio/synth/poly/audio',
  tonewheel: '@audio/synth/tonewheel/audio',
  // ── Time-stretch (whole-render + frames hook — structural output length) ──
  'stretch-pvoc-lock': '@audio/stretch/pvoc-lock/audio',
  'stretch-pvoc': '@audio/stretch/pvoc/audio',
  'stretch-pvsola': '@audio/stretch/pvsola/audio',
  'stretch-pghi': '@audio/stretch/pghi/audio',
  'stretch-wsola': '@audio/stretch/wsola/audio',
  'stretch-psola': '@audio/stretch/psola/audio',
  'stretch-sms': '@audio/stretch/sms/audio',
  'stretch-transient': '@audio/stretch/transient/audio',
  'stretch-hybrid': '@audio/stretch/hybrid/audio',
  'stretch-paul': '@audio/stretch/paulstretch/audio',
  // ↑ note-event instruments: pass notes — a.voice({ notes: [{ time, midi|freq, duration, velocity }] })
  // @audio/synth-dtmf (digit string) / synth-wavetable (table arrays) — direct-import only
  // Codec plugins ({ codec, test?, decode?, encode? }) register the same way — none published yet
}

// ── Stat plugins ({ stat, compute }, registered as a.stat(name)) ──────────
const STATS = {
  // auto()'s plan alone: analyze and plan, nothing rendered (the manifest that hosts auto)
  chain: '@audio/chain/audio',
  truepeak: '@audio/loudness/truepeak/audio',
  lra: '@audio/loudness/lra/audio',
  replaygain: '@audio/loudness/replaygain/audio',
  dr: '@audio/loudness/dr/audio',
  'speech-contrast': '@audio/loudness/contrast/audio',
  sounds: '@audio/loudness/sounds/audio',
  rolloff: '@audio/spectral/rolloff/audio',
  spread: '@audio/spectral/spread/audio',
  slope: '@audio/spectral/slope/audio',
  flux: '@audio/spectral/flux/audio',
  contrast: '@audio/spectral/contrast/audio',
  ltas: '@audio/spectral/ltas/audio',
  zcr: '@audio/spectral/zcr/audio',
  structure: '@audio/mir/structure/audio',
  tempogram: '@audio/mir/tempogram/audio',
  melody: '@audio/mir/melody/audio',
  downbeat: '@audio/mir/downbeat/audio',
  fingerprint: '@audio/mir/fingerprint/audio',
  drums: '@audio/mir/drums/audio',
  multif0: '@audio/mir/multif0/audio',
  transcribe: '@audio/mir/transcribe/audio',
  similarity: '@audio/mir/similarity/audio',
  coversong: '@audio/mir/coversong/audio',
  chroma: '@audio/mir/chroma/audio',
  tonnetz: '@audio/mir/tonnetz/audio',
}
audio.plugins = { ...OPS, ...STATS }
audio.atoms = audio.plugins  // deprecated ≤2.5 name — same object, mutations visible through both

// Registry ops are methods from the start (a dashed name under its camelCase too); positional args wait as `args`
// until the op loads
for (let name in OPS) opMethods(name)

// The registry ops that can change a sound's width, as audio hosts their processors (core.js hostOp: a count on the
// output, or layouts other than the input's), each with the width it makes: a stereo processor, of the width it is
// given (two channels of a mono sound, any other width kept); one of a count of its own, that count; one with layouts
// of its own, a width no one knows before it loads (a `layouts` option picks): 0. So a width asked before one of them
// has loaded is the width it will make, and an error naming the op only where that is not known (plan.js
// deriveFormat). test/plugin-ops.js holds the list to the manifests installed
for (let name of ['debleed', 'pingpong', 'isolate', 'widener', 'haas', 'panner', 'autopan', 'midside', 'microshift',
  'binaural']) widening.set(name, n => n > 1 ? n : 2)
for (let [name, k] of [['rotary', 2], ['osc', 1], ['surround', 6]]) widening.set(name, k)
for (let name of ['ambisonic-panner', 'ambisonic-decoder']) widening.set(name, 0)

// The registry ops whose package's keywords say they keep a take's length: a repair (restoration), a pitch shift
// (pitch-shift); and a time stretch (time-stretch), whose length is the factor's, round(n · factor). The ring they declare
// past that end renders only where an edit asks for it (`tail: true`: core.js keeping). test/plugin-ops.js holds the
// list to the packages installed
for (let name of ['dehum', 'specsub', 'wiener', 'omlsa', 'deplosive', 'dewind', 'dewow', 'debleed', 'declip', 'decrackle',
  'debreath', 'desqueak', 'rnnoise', 'deesser', 'vocoder', 'formant-shift', 'paulstretch', 'pitch-shift', 'pitch-ola', 'pitch-transient',
  'pitch-psola', 'pitch-wsola', 'pitch-granular', 'pitch-sms', 'pitch-hpss', 'pitch-sample', 'pitch-hybrid', 'pitch-delay',
  'pitch-lpc', 'stretch-pvoc-lock', 'stretch-pvoc', 'stretch-pvsola', 'stretch-pghi', 'stretch-wsola', 'stretch-psola',
  'stretch-sms', 'stretch-transient', 'stretch-hybrid', 'stretch-paul']) keeping.add(OPS[name])

/** Load every registry op an instance's edits name (dynamic import), then map the
 *  positional args recorded before it loaded onto its params, and settle its options as a call to it loaded would
 *  (plan.js normalizeEdit); so for the sources its edits take (mix, insert, a key),
 *  which its plan reads synchronously: an insert's length, a normalize measuring a mix. */
async function autowire(a, seen = new Set()) {
  if (seen.has(a)) return
  seen.add(a)
  // a failure is said of its edit (core.js blame); one of a sound an edit takes, of that edit
  for (let [j, e] of a.edits.entries()) try {
    let [type, o] = e, d = audio.op(type)
    if (!d && audio.plugins[type]) { await audio.use(type); d = audio.op(type) }
    if (o?.args && d?.params) {
      let { args, ...rest } = o, p = positional(d, args)
      if (args.length > p.length) throw new TypeError(`${type}: expected at most ${p.length} arguments (${p.join(', ')}), got ${args.length}`)
      p.forEach((k, i) => { if (i < args.length) rest[k] = args[i] })
      e[1] = rest
    }
    if (e[1]) d?.settle?.(e[1])
  } catch (err) { throw blame(err, a, j) }
  for (let [j, [, o]] of a.edits.entries()) for (let k in o) if (o[k]?.edits?.length) try { await autowire(o[k], seen); await loadOps(o[k]) } catch (err) { throw blame(err, a, j) }
}
let load = audio.fn[LOAD], stream = audio.fn.stream
audio.fn[LOAD] = async function() { if (this.edits?.length) await autowire(this); return load.call(this) }
// a live (still decoding) stream skips LOAD: wire before its first plan too; and so does a file encoded or saved as it
// decodes, which plans from its length before it streams
audio.fn.stream = audio.fn[Symbol.asyncIterator] = async function*(opts) {
  if (this.edits?.length) { await autowire(this); await loadOps(this) }
  yield* stream.call(this, opts)
}
for (let name of ['encode', 'save']) {
  let f = audio.fn[name]
  audio.fn[name] = async function(...args) {
    if (this.edits?.length) { await autowire(this); await loadOps(this) }
    return f.apply(this, args)
  }
}

// ── Infrastructure (self-register on import) ────────────────────────────

import './store.js'
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
import './fn/check.js'
import './fn/cuts.js'

// compare (what changed from a sound before) reads two sounds whole: its module loads on first use, as the registry's
// plugins do, out of a page's bundle (.esbuild.js leaves it beside dist/); it reads the sounds through their methods
audio.fn.compare = async function(ref) { return (await import('./fn/compare.js')).default.call(this, ref) }

// ── Ops ─────────────────────────────────────────────────────────────────

import './fn/crop.js'
import './fn/remove.js'
import './fn/insert.js'
import './fn/copy.js'
import './fn/cut.js'
import './fn/paste.js'
import './fn/move.js'
import './fn/repeat.js'
import './fn/gain.js'
import './fn/fade.js'
import './fn/reverse.js'
import './fn/mix.js'
import './fn/write.js'
import './fn/remix.js'
import './fn/trim.js'
import './fn/shrink.js'
import './fn/normalize.js'
import './fn/filter.js'
import './fn/pan.js'
import './fn/pad.js'
import './fn/plugin.js'
import './fn/convolve.js'
import './fn/speed.js'
import './fn/stretch.js'
import './fn/warp.js'
import './fn/pitch.js'
import './fn/intonation.js'
import './fn/formant.js'
import './fn/transform.js'
import './fn/crossfade.js'
import './fn/crossover.js'
import './fn/match.js'
import './fn/align.js'
import './fn/spectral.js'
import './fn/vocals.js'
import './fn/rebalance.js'
import './fn/deepfilter.js'
import './fn/dereverb.js'
import './fn/vocos.js'
import './fn/restore.js'
import './fn/auto.js'
import './fn/declip.js'
import './fn/recover.js'
import './fn/derustle.js'
import './fn/denoise.js'
import './fn/declick.js'
import './fn/dither.js'
import './fn/crossfeed.js'
import './fn/roomtone.js'
import './fn/phase.js'
import './fn/azimuth.js'
import './fn/codec.js'
import './fn/deconstruct.js'
import './fn/resample.js'

// ── Stats ───────────────────────────────────────────────────────────────

import './fn/stat.js'
import './fn/loudness.js'
import './fn/spectrum.js'
import './fn/cepstrum.js'
import './fn/silence.js'
import './fn/hits.js'
import './fn/similar.js'
import './fn/beat.js'
import './fn/pitch-detect.js'
import './fn/periodicity.js'
