// What the editor knows about each method: its group in the menu, what it does, its parameters for the sliders,
// and what it draws over the waveform while its call is being edited.
// Built-in ops are described here; registry plugins describe their own parameters (the engine reads their manifests).
// What each parameter does, in words, for the tooltip over its slider, is help.js's.
import audio from '../assets/audio.js'

// A parameter: { name, min, max, default, unit, step, log, values }. `values` makes it a choice; `selection` (what to
// select) makes it the selected range, or ranges, set from the picture, not a slider; `required`, the library has no
// default for it, so a new call writes this one.
const p = (name, min, max, def, unit = '', more) => ({ name, min, max, default: def, unit, ...more })
const hz = (name = 'freq', def = 1000, min = 20, max = 20000) => p(name, min, max, def, 'Hz', { log: true })
const db = (name, min, max, def) => p(name, min, max, def, 'dB', { step: .1 })
const sec = (name, max, def, min = 0) => p(name, min, max, def, 's', { step: .01 })
const choice = (name, values, def = values[0]) => ({ name, values, default: def })
const Q = (def = .707) => p('Q', .1, 30, def, '', { log: true })
const need = s => ({ ...s, required: true })

// Ops whose time range is the whole call: `.remove({ at, duration })`; with more after it: `.move({ at, duration, to })`.
const RANGE = [p('at', 0, 1, 0, 's', { step: .01 }), p('duration', 0, 1, 1, 's', { step: .01 })]

export const GROUPS = ['Edit', 'Level', 'Filter', 'Dynamics', 'Repair', 'Time & pitch', 'Effect', 'Color', 'Reverb', 'Space', 'Generate']

// name: [group, description, params] – params omitted for plugins (read from their manifests), `range` for range-only calls.
const table = {
  // Edit
  trim: ['Edit', 'Cut silence from both ends', [db('threshold', -80, 0, -40)]],
  shrink: ['Edit', 'Shorten pauses', [sec('gap', 2, .3), db('threshold', -80, 0, -40)]],
  crop: ['Edit', 'Keep a range, drop the rest', 'range'],
  remove: ['Edit', 'Delete a range and close the gap', 'range'],
  cut: ['Edit', 'Delete a range into the clipboard', 'range'],
  copy: ['Edit', 'Copy a range to the clipboard', 'range'],
  move: ['Edit', 'Slide a range to another time, over what is there', ['range', sec('to', 1, 0)]],
  paste: ['Edit', 'Insert the clipboard', [sec('at', 1, 0)]],
  insert: ['Edit', 'Insert audio or seconds of silence', [{ name: 'source' }, sec('at', 1, 0)]],
  pad: ['Edit', 'Add silence before and after', [sec('before', 5, .5), sec('after', 5, .5)]],
  repeat: ['Edit', 'Play it several times', [p('times', 1, 16, 2, '×', { step: 1 })]],
  reverse: ['Edit', 'Play backwards', []],
  // Level
  gain: ['Level', 'Change volume', [db('value', -36, 12, 0)]],
  normalize: ['Level', 'Set peak or loudness', [db('target', -36, 0, 0), choice('mode', ['peak', 'lufs', 'rms'])]],
  fade: ['Level', 'Fade in and out', [sec('in', 5, .5), sec('out', 5, .5), choice('curve', ['linear', 'exp', 'log', 'cos'])]],
  pan: ['Level', 'Balance left and right', [p('value', -1, 1, 0, '', { step: .01 })]],
  mix: ['Level', 'Layer another sound on top', [{ name: 'source' }, sec('at', 1, 0), db('gain', -36, 12, 0)]],
  crossfade: ['Level', 'Blend into another sound, or across the selection', [{ name: 'source' }, sec('duration', 10, .5), choice('curve', ['cos', 'equal', 'linear'])]],
  remix: ['Level', 'Change channel count', [choice('channels', [1, 2], 2)]],
  dither: ['Level', 'Add dither for a lower bit depth', [p('bits', 8, 24, 16, 'bit', { step: 1 })]],
  // Filter
  highpass: ['Filter', 'Cut lows', [need(hz('freq', 80)), choice('order', [2, 4, 6, 8], 2)]],
  lowpass: ['Filter', 'Cut highs', [need(hz('freq', 8000)), choice('order', [2, 4, 6, 8], 2)]],
  bandpass: ['Filter', 'Keep one band', [need(hz()), Q()]],
  notch: ['Filter', 'Remove one frequency', [need(hz('freq', 50)), Q(30)]],
  allpass: ['Filter', 'Shift phase around a frequency', [hz(), Q()]],
  // every frequency's phase turned by one angle, 180 the polarity; unset, the angle that lowers the peaks (fn/phase.js)
  phase: ['Filter', 'Turn the phase to lower the peaks, or flip polarity', [p('angle', -180, 180, 0, '°', { step: 1 })]],
  lowshelf: ['Filter', 'Boost or cut the lows', [hz('freq', 200), db('gain', -24, 24, 0), Q()]],
  highshelf: ['Filter', 'Boost or cut the highs', [hz('freq', 8000), db('gain', -24, 24, 0), Q()]],
  eq: ['Filter', 'Boost or cut a band', [hz(), db('gain', -24, 24, 0), Q(1)]],
  match: ['Filter', 'Match the tone of a reference', [{ name: 'source' }, p('amount', 0, 1, 1, '', { step: .01 })]],
  master: ['Filter', 'Master to a reference: its tone, width and loudness', [{ name: 'source' }]],
  crossover: ['Filter', 'Split into frequency bands', [hz('freq', 1000)]],
  geq: ['Filter', 'Ten-band graphic EQ'],
  tilt: ['Filter', 'Tilt the tone darker or brighter'],
  baxandall: ['Filter', 'Bass and treble tone controls'],
  dyneq: ['Filter', 'EQ band that reacts to level'],
  'spectral-tilt': ['Filter', 'Slope the spectrum by dB per octave'],
  moog: ['Filter', 'Moog ladder low-pass'],
  korg35: ['Filter', 'Korg MS-20 filter'],
  diode: ['Filter', 'Diode ladder filter (TB-303)'],
  oberheim: ['Filter', 'Oberheim SEM multimode filter'],
  variable: ['Filter', 'Smooth variable filter'],
  resonator: ['Filter', 'Ring at one frequency'],
  comb: ['Filter', 'Comb filter'],
  dcblocker: ['Filter', 'Remove DC offset'],
  emphasis: ['Filter', 'Pre-emphasis'],
  deemphasis: ['Filter', 'De-emphasis'],
  derivative: ['Filter', 'First difference'],
  integral: ['Filter', 'Running sum'],
  // Dynamics
  compressor: ['Dynamics', 'Even out loud and quiet parts'],
  limiter: ['Dynamics', 'Hold peaks under a ceiling'],
  gate: ['Dynamics', 'Silence the quiet parts'],
  expander: ['Dynamics', 'Push quiet parts further down'],
  deesser: ['Dynamics', 'Tame harsh s sounds'],
  leveler: ['Dynamics', 'Ride speech to an even level'],
  'transient-shaper': ['Dynamics', 'Shape attacks and sustain'],
  softclip: ['Dynamics', 'Round off peaks'],
  compand: ['Dynamics', 'Custom level curve'],
  unlimit: ['Dynamics', 'Restore over-limited peaks'],
  ducker: ['Dynamics', 'Lower this under another sound'],
  multiband: ['Dynamics', 'Compress lows, mids, highs apart'],
  fet: ['Dynamics', 'Fast FET compressor (1176 style)'],
  opto: ['Dynamics', 'Smooth optical compressor (LA-2A style)'],
  varimu: ['Dynamics', 'Tube vari-mu compressor'],
  vca: ['Dynamics', 'Clean bus compressor'],
  auto: ['Dynamics', 'Measure and build a chain automatically'],
  // Repair
  // the noise learned where it plays alone (the selection, set as `noise`), taken `reduction` dB down everywhere (fn/denoise.js)
  denoise: ['Repair', 'Remove a noise learned from where it plays alone', [db('reduction', 0, 40, 12), db('threshold', -10, 10, 0), { name: 'noise', selection: 'where the noise plays alone' }]],
  omlsa: ['Repair', 'Reduce background noise that changes'],
  // the noise `limit` dB down at most; 0 lets pauses fall to silence (fn/deepfilter.js)
  deepfilter: ['Repair', 'Clean speech with a neural model', [db('limit', 0, 40, 18), choice('music', ['pass', 'enhance'])]],
  rnnoise: ['Repair', 'Clean speech with a small neural model, as it streams'],
  wiener: ['Repair', 'Reduce noise, gentle'],
  specsub: ['Repair', 'Reduce noise by spectral subtraction'],
  dehum: ['Repair', 'Remove mains hum'],
  roomtone: ['Repair', 'Fill digital silence with the room tone', [db('threshold', -120, -60, -90)]],
  // the second channel moved onto the first; unset, the delay measured over time (fn/azimuth.js)
  azimuth: ['Repair', 'Line up a stereo pair in time and polarity', [p('delay', -2, 2, 0, 'ms', { step: .001 })]],
  dewow: ['Repair', 'Correct wow and flutter'],
  // the tonal, noisy and transient parts, each at its own level (fn/deconstruct.js)
  deconstruct: ['Repair', 'Rebalance tones, noise and attacks', [db('tonal', -60, 12, 0), db('noise', -60, 12, 0), db('transient', -60, 12, 0), p('separation', 1, 8, 2, '×', { step: .1 })]],
  // the clicks found everywhere, or in the selection alone, each rebuilt from around it (fn/declick.js)
  declick: ['Repair', 'Remove clicks', [p('threshold', 2, 30, 8, '×', { step: .5 }), p('longest', .5, 20, 6, 'ms', { step: .5 }), p('order', 8, 100, 32, '', { step: 1 })]],
  decrackle: ['Repair', 'Remove vinyl crackle'],
  declip: ['Repair', 'Rebuild clipped peaks'],
  dereverb: ['Repair', 'Reduce room echo'],
  deplosive: ['Repair', 'Soften p and b pops'],
  dewind: ['Repair', 'Reduce wind rumble'],
  debreath: ['Repair', 'Lower breaths between words'],
  defeedback: ['Repair', 'Suppress feedback howl'],
  debleed: ['Repair', 'Take a source\'s bleed out of a mic, given its track'],
  spectral: ['Repair', 'Change a band over a time range', [p('band', 20, 20000, [1000, 4000], 'Hz', { log: true }), db('gain', -60, 12, -60)]],
  repair: ['Repair', 'Rebuild a damaged range from its surroundings', 'range'],
  // Time & pitch
  speed: ['Time & pitch', 'Faster or slower, pitch follows', [p('rate', .25, 4, 1, '×', { step: .01, log: true })]],
  stretch: ['Time & pitch', 'Longer or shorter, same pitch', [p('factor', .25, 4, 1, '×', { step: .01, log: true })]],
  pitch: ['Time & pitch', 'Higher or lower, same length', [p('semitones', -24, 24, 0, 'st', { step: 1 })]],
  intonation: ['Time & pitch', 'A voice\'s rises and falls, wider or flatter', [p('factor', 0, 3, 1, '×', { step: .05 })]],
  formant: ['Time & pitch', 'Move a voice\'s formants, pitch kept', [p('semitones', -12, 12, 0, 'st', { step: .5 })]],
  'pitch-shift': ['Time & pitch', 'Pitch shift, choice of method'],
  'formant-shift': ['Time & pitch', 'Pitch shift keeping the voice'],
  vocoder: ['Time & pitch', 'Pitch shift by phase vocoder'],
  paulstretch: ['Time & pitch', 'Blurred, textural pitch shift'],
  tune: ['Time & pitch', 'Snap pitch to a scale'],
  resample: ['Time & pitch', 'Change the sample rate', [need(choice('rate', [8000, 16000, 22050, 32000, 44100, 48000, 96000], 48000))]],
  'stretch-paul': ['Time & pitch', 'Extreme stretch for drones'],
  'stretch-wsola': ['Time & pitch', 'Stretch speech, low CPU'],
  'stretch-psola': ['Time & pitch', 'Stretch a single voice'],
  'stretch-pvoc-lock': ['Time & pitch', 'Stretch by phase-locked vocoder'],
  'stretch-pvoc': ['Time & pitch', 'Stretch by phase vocoder'],
  'stretch-pghi': ['Time & pitch', 'Stretch by phase gradient'],
  'stretch-sms': ['Time & pitch', 'Stretch tonal material'],
  'stretch-transient': ['Time & pitch', 'Stretch keeping attacks'],
  'stretch-hybrid': ['Time & pitch', 'Stretch drums and tones apart'],
  // Effect
  delay: ['Effect', 'Echo'],
  pingpong: ['Effect', 'Echo bouncing left and right'],
  multitap: ['Effect', 'Several echoes'],
  chorus: ['Effect', 'Thicken with detuned copies'],
  flanger: ['Effect', 'Jet sweep'],
  phaser: ['Effect', 'Swirling phase sweep'],
  tremolo: ['Effect', 'Pulse the volume'],
  vibrato: ['Effect', 'Wobble the pitch'],
  autowah: ['Effect', 'Wah that follows the level'],
  wah: ['Effect', 'Swept wah'],
  rotary: ['Effect', 'Rotating speaker'],
  ringmod: ['Effect', 'Metallic ring modulation'],
  freqshift: ['Effect', 'Shift every frequency by Hz'],
  graindelay: ['Effect', 'Granular echo'],
  stutter: ['Effect', 'Repeat slices'],
  tapestop: ['Effect', 'Tape slowing to a stop'],
  bitcrusher: ['Effect', 'Fewer bits, lower rate'],
  lofi: ['Effect', 'Worn tape and vinyl'],
  slew: ['Effect', 'Limit how fast the wave can move'],
  noiseshaper: ['Effect', 'Requantize with shaped noise'],
  // encoded and decoded in place, lined up with the input: what the codec takes out is its step's Δ (fn/codec.js)
  codec: ['Effect', 'Hear it through a lossy codec', [choice('format', ['mp3', 'aac', 'opus', 'vorbis']), choice('bitrate', [32, 48, 64, 96, 128, 160, 192, 256, 320], 128)]],
  // Color
  distortion: ['Color', 'Distort'],
  tube: ['Color', 'Warm tube saturation'],
  tape: ['Color', 'Tape saturation'],
  transistor: ['Color', 'Console saturation'],
  waveshaper: ['Color', 'Waveshaping'],
  multisat: ['Color', 'Saturate bands apart'],
  exciter: ['Color', 'Add presence and air'],
  subbass: ['Color', 'Add perceived bass'],
  sbr: ['Color', 'Rebuild missing highs'],
  amp: ['Color', 'Guitar tube amp'],
  cabinet: ['Color', 'Speaker cabinet'],
  // Reverb
  freeverb: ['Reverb', 'Room reverb'],
  plate: ['Reverb', 'Plate reverb'],
  fdn: ['Reverb', 'Dense hall reverb'],
  spring: ['Reverb', 'Spring reverb'],
  shimmer: ['Reverb', 'Reverb with rising octaves'],
  schroeder: ['Reverb', 'Classic Schroeder reverb'],
  // Space
  vocals: ['Space', 'Keep or remove the centre voice', [choice('mode', ['isolate', 'remove'])]],
  isolate: ['Space', 'Centre channel isolation'],
  widener: ['Space', 'Widen the stereo image'],
  haas: ['Space', 'Stereo from a short delay'],
  panner: ['Space', 'Constant-power panner'],
  autopan: ['Space', 'Pan back and forth'],
  midside: ['Space', 'Mid/side width'],
  microshift: ['Space', 'Widen with detuned copies'],
  binaural: ['Space', 'Place around the head'],
  surround: ['Space', 'Upmix stereo to 5.1'],
  crossfeed: ['Space', 'Headphone crossfeed', [hz('freq', 700, 300, 1200), p('level', 0, 1, .3, '', { step: .01 })]],
  // Generate
  osc: ['Generate', 'Tone'],
  noise: ['Generate', 'White, pink or brown noise'],
  chirp: ['Generate', 'Frequency sweep'],
  pluck: ['Generate', 'Plucked string'],
  kick: ['Generate', 'Kick drum'],
  snare: ['Generate', 'Snare drum'],
  cymbal: ['Generate', 'Cymbal'],
  risset: ['Generate', 'Risset drum'],
  rhythm: ['Generate', 'Click track'],
  sfx: ['Generate', 'Game sound effect'],
  fm: ['Generate', 'FM tone'],
  modal: ['Generate', 'Struck bar, string or plate'],
  voice: ['Generate', 'Synth voice playing notes'],
  poly: ['Generate', 'Polyphonic synth'],
  adsr: ['Generate', 'Attack-decay-sustain-release envelope']
}

export const ops = Object.fromEntries(Object.entries(table).map(([name, [group, text, params]]) =>
  [name, { name, group, text, ...(params === 'range' || params?.[0] === 'range' ? { params: [...RANGE, ...params === 'range' ? [] : params.slice(1)], range: true } : params && { params }) }]))

// Instance methods, beside the edits above. `sink` ends a chain: the editor inserts edits before it. `edits`: it changes the
// sound in place, sample for sample.
export const methods = {
  stat: { text: 'Measure: loudness, peak, key, bpm…', async: true },
  detect: { text: 'Tempo, beats and onsets in one pass', async: true },
  read: { text: 'Rendered samples', async: true },
  encode: { text: 'Encoded bytes', async: true },
  save: { text: 'Export as a file', async: true, sink: true },
  play: { text: 'Play', sink: true },
  clone: { text: 'An independent copy' },
  clip: { text: 'An excerpt, sharing samples' },
  split: { text: 'Excerpts between times' },
  mark: { text: 'A marker at a time, or over a range, with a label' },
  undo: { text: 'Undo the last edit' },
  transform: { text: 'Process with your own function', edits: true },
  filter: { text: 'Filter by type name', edits: true },
  write: { text: 'Overwrite with samples or another sound, as a tape records', edits: true }
}

// A step whose output doesn't line up with its input, sample for sample: a cut, a stretch, a new rate, a join, another
// count of channels; a method that isn't a change to the sound in place. What it takes out has no meaning (the stack's Δ).
export const reshapes = name => ['Edit', 'Time & pitch'].includes(ops[name]?.group) || ['remix', 'crossfade', 'warp'].includes(name) || !!methods[name] && !methods[name].edits

export const stats = {
  db: 'Peak level, dBFS', rms: 'RMS level', peak: 'Peak amplitude', loudness: 'Integrated loudness, LUFS',
  momentary: 'Max momentary loudness, LUFS', shortterm: 'Max short-term loudness, LUFS', dialog: 'Speech loudness, LUFS',
  truepeak: 'True peak, dBTP', lra: 'Loudness range, LU', crest: 'Peak to RMS, dB', dc: 'DC offset',
  clipping: 'Clipped samples', silence: 'Silent ranges', correlation: 'Stereo correlation',
  centroid: 'Brightness, Hz', flatness: 'Noisiness, 0–1', spectrum: 'Mel spectrum', cepstrum: 'MFCCs',
  bpm: 'Tempo', beats: 'Beat times', onsets: 'Onset times', notes: 'Notes', chords: 'Chords', key: 'Key',
  min: 'Minimum', max: 'Maximum', dr: 'Dynamic range', replaygain: 'ReplayGain', print: 'Noise print of a range, for denoise',
  voicing: 'Share voiced, 0–1', hnr: 'Harmonics to noise, dB', harmonic: 'Level of the periodic part, dB',
  similar: 'Places that sound like a range'
}

// Icons, 24 × 24 strokes, one for each group of methods, beside its tools
export const icons = {
  Edit: 'M8.1 8.1 21 21M8.1 15.9 21 3M9 6a3 3 0 1 1-6 0 3 3 0 0 1 6 0m0 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0',
  Level: 'M3 18h18V6z',
  Filter: 'M3 8h8c4 0 5 4 6 7s2 4 4 4',
  Dynamics: 'M4 4v16h16M4 20l7-7c3-3 6-4 9-4',
  Repair: 'm4 14 6 6 10-10-6-6ZM9 11l1 1m2-2 1 1m-2 3 1 1m2-2 1 1',
  'Time & pitch': 'M12 7v5l3 2m6-2a9 9 0 1 1-18 0 9 9 0 0 1 18 0',
  Effect: 'M12 3v4m0 10v4M3 12h4m10 0h4M5.6 5.6l2.8 2.8m7.2 7.2 2.8 2.8m-12.8 0 2.8-2.8m7.2-7.2 2.8-2.8',
  Color: 'M12 21c-3.9 0-6-2.6-6-5.6 0-4.2 4-5.8 4-10.4 3.1 1.7 8 5.3 8 10.4 0 3-2.1 5.6-6 5.6Z',
  Reverb: 'M4 5v14m5-11v8m5-6v4m5-2.5v1',
  Space: 'M15 12a6 6 0 1 1-12 0 6 6 0 0 1 12 0m6 0a6 6 0 1 1-12 0 6 6 0 0 1 12 0',
  Generate: 'M3 12c2-6 4-6 6 0s4 6 6 0 4-6 6 0'
}

export const presets = { normalize: ['podcast', 'streaming', 'broadcast'], vocals: ['isolate', 'remove'], codec: ['mp3', 'aac', 'opus', 'vorbis'] }

// What a step's new settings do to the picture while its output renders, drawn at once: the factor they change the
// level by at time t of the output, from its settings before (`was`) and now (`is`), by name, the output `T` long; none
// where a level can't say it (a step that moves time, filters or compresses shows its output when it comes). A step
// with a range changes only there. The curves are fade()'s, and a crossfade's, its equal power too, as the library has them.
export const CURVES = audio.op('fade').curves, CROSSFADES = audio.op('crossfade').curves
const within = (s, f) => s.at == null && s.duration == null ? f : t => t >= (s.at ?? 0) && t < (s.at ?? 0) + (s.duration ?? Infinity) ? f(t) : 1
function fading({ in: a = .5, out, curve }, T) {
  const c = CURVES[curve] ?? CURVES.linear, fin = a > 0 ? a : 0, fout = a < 0 ? -a : Math.abs(out ?? 0)
  return t => (fin && t < fin ? c(t / fin) : 1) * (fout && t > T - fout ? c((T - t) / fout) : 1)
}
export const previews = {
  gain: (was, is) => typeof was.value === 'number' && typeof is.value === 'number' ? within(is, () => 10 ** ((is.value - was.value) / 20)) : null,
  normalize: (was, is) => typeof is.target === 'number' && (was.mode ?? 'peak') === (is.mode ?? 'peak') ? () => 10 ** ((is.target - (was.target ?? 0)) / 20) : null,
  fade(was, is, T) {
    if (was.at != null || is.at != null) return null
    const a = fading(was, T), b = fading(is, T)
    return t => { const g = a(t), h = b(t); return g > 1e-3 ? h / g : h > 1e-3 ? 1e3 : 1 }
  }
}

// The value of a numeric parameter as the slider shows it, its unit right after it (−1dB, 8kHz, 0.5s).
export function format(value, { unit = '', step } = {}) {
  if (typeof value !== 'number') return String(value)
  const digits = step >= 1 ? 0 : Math.abs(value) >= 100 ? 0 : Math.abs(value) >= 10 ? 1 : 2
  const text = unit === 'Hz' && Math.abs(value) >= 1000 ? +(value / 1000).toFixed(2) + 'kHz' : +value.toFixed(digits) + unit
  return value < 0 ? '−' + text.slice(1) : text
}

// A plugin manifest's params ({ threshold: { min, max, default, unit } }) as the editor's list.
export const fromManifest = spec => Object.entries(spec || {}).map(([name, s]) => s.type === 'enum' ? choice(name, s.values, s.default)
  : s.type === 'bool' ? choice(name, [true, false], s.default)
  : p(name, s.min, s.max, s.default, s.unit || '', { step: s.step, log: s.curve === 'log' || (s.unit === 'Hz' && s.min > 0 && s.max / s.min >= 100) }))

// What a call draws over the output while it is being edited, from its argument values by name (seconds and dB).
// Times are in the output's timeline, exact when no later edit moves them.
export function guides(name, args, duration) {
  const out = []
  const range = args.at != null && args.duration != null ? [args.at, args.at + args.duration] : null
  if (range) out.push({ range })
  // a level: a threshold in dB (denoise's is an offset on its noise, declick's and decrackle's a multiple of the sound's
  // own error, deesser's the sibilance band over the voice body: none), a ceiling, a peak to reach
  const level = ['denoise', 'declick', 'decrackle', 'deesser'].includes(name) ? null : args.threshold ?? (name === 'limiter' ? args.ceiling : name === 'normalize' && typeof args.target === 'number' && args.mode !== 'lufs' && args.mode !== 'rms' ? args.target : null)
  if (typeof level === 'number') out.push({ level })
  // a fade's ramps along its curve: fade(in, out) at the ends; fade(d, { at }) one ramp from `at`, in over d, or out
  // (d < 0) over −d
  if (name === 'fade') {
    const d = typeof args.in === 'number' ? args.in : .5, at = typeof args.at === 'number' ? (args.at < 0 ? duration + args.at : args.at) : null
    const from = at ?? (d < 0 ? duration + d : 0), curve = CURVES[args.curve] ? args.curve : 'linear', ramps = [[from, from + Math.abs(d), d < 0 ? 'out' : 'in', curve]]
    if (d >= 0 && at == null && typeof args.out === 'number' && args.out) ramps.push([duration - Math.abs(args.out), duration, 'out', curve])
    out.push({ ramps })
  }
  if (['paste', 'insert', 'mix'].includes(name) && typeof args.at === 'number') out.push({ at: args.at })
  if (name === 'move' && typeof args.to === 'number') out.push({ at: args.to })
  const freq = args.freq ?? args.fc
  if (typeof freq === 'number' && ops[name] && ['Filter', 'Repair', 'Space'].includes(ops[name].group)) out.push({ freq })
  if (name === 'dehum' || (name === 'notch' && typeof freq === 'number')) for (let k = 2; k <= (args.harmonics ?? 1); k++) out.push({ freq: (freq ?? 50) * k })
  if (Array.isArray(args.band)) out.push({ band: args.band, range: range || [0, duration] })
  // where a noise is learned: each range it plays alone in
  for (const r of [args.noise].flat()) if (typeof r?.at === 'number' && typeof r.duration === 'number') out.push({ range: [r.at, r.at + r.duration], label: 'noise' })
  // the notes a tune lands on, over its range: its scale's, up from its root, as MIDI notes over the piano's, A4 at `a4`
  const degrees = name === 'tune' && SCALES[args.scale ?? 'chromatic']
  if (degrees) {
    const root = typeof args.root === 'number' ? args.root : 0
    const notes = Array.from({ length: 88 }, (_, i) => 21 + i).filter(m => degrees.includes(((m - root) % 12 + 12) % 12))
    out.push({ notes, root, a4: typeof args.a4 === 'number' ? args.a4 : 440, ...range && { span: range } })
  }
  return out
}
// The scales tune() snaps to, as semitones up from the root: @audio/note's SCALES, which @audio/tune-snap snaps by
export const SCALES = {
  chromatic: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  'harmonic-minor': [0, 2, 3, 5, 7, 8, 11],
  'melodic-minor': [0, 2, 3, 5, 7, 9, 11],
  'pentatonic-major': [0, 2, 4, 7, 9],
  'pentatonic-minor': [0, 3, 5, 7, 10],
  blues: [0, 3, 5, 6, 7, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  whole: [0, 2, 4, 6, 8, 10]
}
