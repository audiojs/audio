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
// Contract plugins from the @audio scope; grows with the published set. A family's processors by its umbrella's entry
// (@audio/<family>/audio: its members' manifests together), the one a name asks for registered from it (core.js use).
const OPS = {
  compressor: '@audio/dynamics/audio',
  limiter: '@audio/dynamics/audio',
  gate: '@audio/dynamics/audio',
  deesser: '@audio/dynamics/audio',
  softclip: '@audio/dynamics/audio',
  expander: '@audio/dynamics/audio',
  compand: '@audio/dynamics/audio',
  leveler: '@audio/dynamics/audio',
  'transient-shaper': '@audio/dynamics/audio',
  unlimit: '@audio/dynamics/audio',
  auto: '@audio/chain/audio',
  ducker: '@audio/dynamics/audio',
  dehum: '@audio/denoise/audio',
  specsub: '@audio/denoise/audio',
  wiener: '@audio/denoise/audio',
  omlsa: '@audio/denoise/audio',
  deplosive: '@audio/denoise/audio',
  dewind: '@audio/denoise/audio',
  dewow: '@audio/denoise/audio',
  debleed: '@audio/denoise/audio',
  declip: '@audio/denoise/audio',
  decrackle: '@audio/denoise/audio',
  debreath: '@audio/denoise/audio',
  desqueak: '@audio/denoise/audio',
  // neural lane, optional package: RNNoise with its weights inside (deepfilter, its DeepFilterNet3, is fn/deepfilter.js)
  rnnoise: '@audio/neural-denoise/audio',
  // denoise-gate/-deesser merged into the dynamics atoms above (2026-07 near-dupe merge:
  // gate gained hysteresis + look-ahead; deesser gained mode 'band' dynamic peaking EQ)
  freeverb: '@audio/reverb/audio',
  delay: '@audio/effect/audio',
  chorus: '@audio/effect/audio',
  flanger: '@audio/effect/audio',
  phaser: '@audio/effect/audio',
  tremolo: '@audio/effect/audio',
  vibrato: '@audio/effect/audio',
  autowah: '@audio/effect/audio',
  wah: '@audio/effect/audio',
  bitcrusher: '@audio/effect/audio',
  distortion: '@audio/effect/audio',
  exciter: '@audio/effect/audio',
  ringmod: '@audio/effect/audio',
  freqshift: '@audio/effect/audio',
  multitap: '@audio/effect/audio',
  pingpong: '@audio/effect/audio',
  slew: '@audio/effect/audio',
  noiseshaper: '@audio/effect/audio',
  lofi: '@audio/effect/audio',
  graindelay: '@audio/effect/audio',
  stutter: '@audio/effect/audio',
  subbass: '@audio/effect/audio',
  sbr: '@audio/effect/audio',
  rotary: '@audio/effect/audio',
  tapestop: '@audio/effect/audio',
  tube: '@audio/saturate/audio',
  osc: '@audio/synth/audio',
  fm: '@audio/synth/audio',
  modal: '@audio/synth/audio',
  isolate: '@audio/vocals/audio',
  widener: '@audio/spatial/audio',
  haas: '@audio/spatial/audio',
  panner: '@audio/spatial/audio',
  autopan: '@audio/spatial/audio',
  midside: '@audio/spatial/audio',
  microshift: '@audio/spatial/audio',
  binaural: '@audio/spatial/audio',
  surround: '@audio/spatial/audio',
  'ambisonic-panner': '@audio/spatial/audio',
  'ambisonic-decoder': '@audio/spatial/audio',
  'ambisonic-rotate': '@audio/spatial/audio',
  vocoder: '@audio/shift/audio',
  'formant-shift': '@audio/shift/audio',
  paulstretch: '@audio/shift/audio',
  'pitch-shift': '@audio/shift/audio',
  // each of pitch-shift's methods under a name of its own, so pitch({ method }) registers that one (fn/pitch.js)
  'pitch-ola': '@audio/shift/audio',
  'pitch-transient': '@audio/shift/audio',
  'pitch-psola': '@audio/shift/audio',
  'pitch-wsola': '@audio/shift/audio',
  'pitch-granular': '@audio/shift/audio',
  'pitch-sms': '@audio/shift/audio',
  'pitch-hpss': '@audio/shift/audio',
  'pitch-sample': '@audio/shift/audio',
  'pitch-hybrid': '@audio/shift/audio',
  'pitch-delay': '@audio/shift/audio',
  'pitch-lpc': '@audio/shift/audio',
  tune: '@audio/tune/audio',
  // @audio/tune-midi exists too — direct-import only (guide-note list isn't a scalar param)
  schroeder: '@audio/reverb/audio',
  plate: '@audio/reverb/audio',
  fdn: '@audio/reverb/audio',
  spring: '@audio/reverb/audio',
  shimmer: '@audio/reverb/audio',
  // @audio/reverb-convolution — a.convolve(ir) (fn/convolve.js: the IR is a file, an instance or samples)
  fet: '@audio/dynamics/audio',
  opto: '@audio/dynamics/audio',
  varimu: '@audio/dynamics/audio',
  vca: '@audio/dynamics/audio',
  multiband: '@audio/dynamics/audio',
  moog: '@audio/filter/audio',
  korg35: '@audio/filter/audio',
  diode: '@audio/filter/audio',
  oberheim: '@audio/filter/audio',
  resonator: '@audio/filter/audio',
  'spectral-tilt': '@audio/filter/audio',
  variable: '@audio/filter/audio',
  comb: '@audio/filter/audio',
  dcblocker: '@audio/filter/audio',
  emphasis: '@audio/filter/audio',
  deemphasis: '@audio/filter/audio',
  derivative: '@audio/filter/audio',
  integral: '@audio/filter/audio',
  'a-weighting': '@audio/weighting/audio',
  'b-weighting': '@audio/weighting/audio',
  'c-weighting': '@audio/weighting/audio',
  'd-weighting': '@audio/weighting/audio',
  'k-weighting': '@audio/weighting/audio',
  itu468: '@audio/weighting/audio',
  riaa: '@audio/weighting/audio',
  geq: '@audio/eq/audio',
  tilt: '@audio/eq/audio',
  baxandall: '@audio/eq/audio',
  dyneq: '@audio/eq/audio',
  // @audio/eq-fir / eq-crossover — direct-import only (response curves / SOS designers, not processors)
  tape: '@audio/saturate/audio',
  transistor: '@audio/saturate/audio',
  waveshaper: '@audio/saturate/audio',
  multisat: '@audio/saturate/audio',
  amp: '@audio/amp/audio',
  cabinet: '@audio/amp/audio',
  defeedback: '@audio/defeedback/audio',
  noise: '@audio/synth/audio',
  chirp: '@audio/synth/audio',
  pluck: '@audio/synth/audio',
  risset: '@audio/synth/audio',
  rhythm: '@audio/synth/audio',
  sfx: '@audio/synth/audio',
  kick: '@audio/synth/audio',
  cymbal: '@audio/synth/audio',
  snare: '@audio/synth/audio',
  adsr: '@audio/synth/audio',
  voice: '@audio/synth/audio',
  poly: '@audio/synth/audio',
  tonewheel: '@audio/synth/audio',
  // ── Time-stretch (whole-render + frames hook — structural output length) ──
  'stretch-pvoc-lock': '@audio/stretch/audio',
  'stretch-pvoc': '@audio/stretch/audio',
  'stretch-pvsola': '@audio/stretch/audio',
  'stretch-pghi': '@audio/stretch/audio',
  'stretch-wsola': '@audio/stretch/audio',
  'stretch-psola': '@audio/stretch/audio',
  'stretch-sms': '@audio/stretch/audio',
  'stretch-transient': '@audio/stretch/audio',
  'stretch-hybrid': '@audio/stretch/audio',
  'stretch-paul': '@audio/stretch/audio',
  // ↑ note-event instruments: pass notes — a.voice({ notes: [{ time, midi|freq, duration, velocity }] })
  // @audio/synth-dtmf (digit string) / synth-wavetable (table arrays) — direct-import only
  // Codec plugins ({ codec, test?, decode?, encode? }) register the same way — none published yet
}

// ── Stat plugins ({ stat, compute }, registered as a.stat(name)) ──────────
const STATS = {
  // auto()'s plan alone: analyze and plan, nothing rendered (the manifest that hosts auto)
  chain: '@audio/chain/audio',
  truepeak: '@audio/loudness/audio',
  lra: '@audio/loudness/audio',
  replaygain: '@audio/loudness/audio',
  dr: '@audio/loudness/audio',
  'speech-contrast': '@audio/loudness/audio',
  sounds: '@audio/loudness/audio',
  rolloff: '@audio/spectral/audio',
  spread: '@audio/spectral/audio',
  slope: '@audio/spectral/audio',
  flux: '@audio/spectral/audio',
  contrast: '@audio/spectral/audio',
  ltas: '@audio/spectral/audio',
  zcr: '@audio/spectral/audio',
  structure: '@audio/mir/audio',
  tempogram: '@audio/mir/audio',
  melody: '@audio/mir/audio',
  downbeat: '@audio/mir/audio',
  fingerprint: '@audio/mir/audio',
  drums: '@audio/mir/audio',
  multif0: '@audio/mir/audio',
  transcribe: '@audio/mir/audio',
  similarity: '@audio/mir/audio',
  coversong: '@audio/mir/audio',
  chroma: '@audio/mir/audio',
  tonnetz: '@audio/mir/audio',
  // speech quality with no reference: DNSMOS P.835 { sig, bak, ovrl, segments }, each 1 to 5, over the whole range. The
  // optional @audio/neural-quality: its model (1.1 MB) is fetched on first use, onnxruntime installed beside it
  dnsmos: '@audio/neural-quality/audio',
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
// (pitch-shift); and a time stretch (time-stretch), whose length is the factor's, round(n · factor), each by its name. The ring they declare
// past that end renders only where an edit asks for it (`tail: true`: core.js keeping). test/plugin-ops.js holds the
// list to the packages installed
for (let name of ['dehum', 'specsub', 'wiener', 'omlsa', 'deplosive', 'dewind', 'dewow', 'debleed', 'declip', 'decrackle',
  'debreath', 'desqueak', 'rnnoise', 'deesser', 'vocoder', 'formant-shift', 'paulstretch', 'pitch-shift', 'pitch-ola', 'pitch-transient',
  'pitch-psola', 'pitch-wsola', 'pitch-granular', 'pitch-sms', 'pitch-hpss', 'pitch-sample', 'pitch-hybrid', 'pitch-delay',
  'pitch-lpc', 'stretch-pvoc-lock', 'stretch-pvoc', 'stretch-pvsola', 'stretch-pghi', 'stretch-wsola', 'stretch-psola',
  'stretch-sms', 'stretch-transient', 'stretch-hybrid', 'stretch-paul']) keeping.add(name)

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
