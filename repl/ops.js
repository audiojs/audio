// What the REPL knows about each method: its group in the menu, what it does, its parameters for the sliders,
// and what it draws over the waveform while its call is being edited.
// Built-in ops are described here; registry plugins describe their own parameters (the engine reads their manifests).

// A parameter: { name, min, max, default, unit, step, log, values }. `values` makes it a choice; `selection` (what to
// select) makes it the selected range, or ranges, set from the picture, not a slider.
const p = (name, min, max, def, unit = '', more) => ({ name, min, max, default: def, unit, ...more })
const hz = (name = 'freq', def = 1000, min = 20, max = 20000) => p(name, min, max, def, 'Hz', { log: true })
const db = (name, min, max, def) => p(name, min, max, def, 'dB', { step: .1 })
const sec = (name, max, def, min = 0) => p(name, min, max, def, 's', { step: .01 })
const choice = (name, values, def = values[0]) => ({ name, values, default: def })
const Q = (def = .707) => p('Q', .1, 30, def, '', { log: true })

// Ops whose time range is the whole call: `.remove({ at, duration })`.
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
  crossfade: ['Level', 'Blend into another sound', [{ name: 'source' }, sec('duration', 10, .5), choice('curve', ['cos', 'equal', 'linear'])]],
  remix: ['Level', 'Change channel count', [choice('channels', [1, 2], 2)]],
  dither: ['Level', 'Add dither for a lower bit depth', [p('bits', 8, 24, 16, 'bit', { step: 1 })]],
  // Filter
  highpass: ['Filter', 'Cut lows', [hz('freq', 80), choice('order', [2, 4, 6, 8], 2)]],
  lowpass: ['Filter', 'Cut highs', [hz('freq', 8000), choice('order', [2, 4, 6, 8], 2)]],
  bandpass: ['Filter', 'Keep one band', [hz(), Q()]],
  notch: ['Filter', 'Remove one frequency', [hz('freq', 50), Q(30)]],
  allpass: ['Filter', 'Shift phase around a frequency', [hz(), Q()]],
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
  // a noise floor 45 dB under the voice, the noise at least `limit` dB down; 0 lets pauses fall to silence (fn/deepfilter.js)
  deepfilter: ['Repair', 'Clean speech with a neural model', [db('limit', 0, 40, 12), db('floor', -80, -20, -45)]],
  rnnoise: ['Repair', 'Clean speech with a small neural model, as it streams'],
  wiener: ['Repair', 'Reduce noise, gentle'],
  specsub: ['Repair', 'Reduce noise by spectral subtraction'],
  dehum: ['Repair', 'Remove mains hum'],
  roomtone: ['Repair', 'Fill digital silence with the room tone', [db('threshold', -120, -60, -90)]],
  declick: ['Repair', 'Remove clicks'],
  decrackle: ['Repair', 'Remove vinyl crackle'],
  declip: ['Repair', 'Rebuild clipped peaks'],
  dereverb: ['Repair', 'Reduce room echo'],
  deplosive: ['Repair', 'Soften p and b pops'],
  dewind: ['Repair', 'Reduce wind rumble'],
  debreath: ['Repair', 'Lower breaths between words'],
  defeedback: ['Repair', 'Suppress feedback howl'],
  spectral: ['Repair', 'Change a band over a time range', [p('band', 20, 20000, [1000, 4000], 'Hz', { log: true }), db('gain', -60, 12, -60)]],
  repair: ['Repair', 'Rebuild a damaged range from its surroundings', 'range'],
  // Time & pitch
  speed: ['Time & pitch', 'Faster or slower, pitch follows', [p('rate', .25, 4, 1, '×', { step: .01, log: true })]],
  stretch: ['Time & pitch', 'Longer or shorter, same pitch', [p('factor', .25, 4, 1, '×', { step: .01, log: true })]],
  pitch: ['Time & pitch', 'Higher or lower, same length', [p('semitones', -24, 24, 0, 'st', { step: 1 })]],
  'pitch-shift': ['Time & pitch', 'Pitch shift, choice of method'],
  'formant-shift': ['Time & pitch', 'Pitch shift keeping the voice'],
  vocoder: ['Time & pitch', 'Pitch shift by phase vocoder'],
  paulstretch: ['Time & pitch', 'Blurred, textural pitch shift'],
  tune: ['Time & pitch', 'Snap pitch to a scale'],
  resample: ['Time & pitch', 'Change the sample rate', [choice('rate', [8000, 16000, 22050, 32000, 44100, 48000, 96000], 48000)]],
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
  [name, { name, group, text, ...(params === 'range' ? { params: RANGE, range: true } : params && { params }) }]))

// Instance methods, beside the edits above. `sink` ends a chain: the REPL inserts edits before it. `edits`: it changes the
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
  mark: { text: 'A marker at a time, with a label' },
  undo: { text: 'Undo the last edit' },
  transform: { text: 'Process with your own function', edits: true },
  filter: { text: 'Filter by type name', edits: true },
  write: { text: 'Overwrite with samples', edits: true }
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
  min: 'Minimum', max: 'Maximum', dr: 'Dynamic range', replaygain: 'ReplayGain', print: 'Noise print of a range, for denoise'
}

export const presets = { normalize: ['podcast', 'streaming', 'broadcast'], vocals: ['isolate', 'remove'] }

// What a step's new settings do to the picture while its output renders, drawn at once: the factor they change the
// level by at time t of the output, from its settings before (`was`) and now (`is`), by name, the output `T` long; none
// where a level can't say it (a step that moves time, filters or compresses shows its output when it comes). A step
// with a range changes only there. The curves are fade()'s (fn/fade.js).
const CURVES = { linear: u => u, exp: u => u * u, log: u => Math.sqrt(u), cos: u => (1 - Math.cos(u * Math.PI)) / 2 }
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

// The value of a numeric parameter as the slider shows it.
export function format(value, { unit = '', step } = {}) {
  if (typeof value !== 'number') return String(value)
  const digits = step >= 1 ? 0 : Math.abs(value) >= 100 ? 0 : Math.abs(value) >= 10 ? 1 : 2
  const text = unit === 'Hz' && Math.abs(value) >= 1000 ? +(value / 1000).toFixed(2) + ' kHz' : +value.toFixed(digits) + (unit ? (unit === '×' ? '' : ' ') + unit : '')
  return value < 0 ? '−' + text.slice(1) : text
}

// A plugin manifest's params ({ threshold: { min, max, default, unit } }) as the REPL's list.
export const fromManifest = spec => Object.entries(spec || {}).map(([name, s]) => s.type === 'enum' ? choice(name, s.values, s.default)
  : s.type === 'bool' ? choice(name, [true, false], s.default)
  : p(name, s.min, s.max, s.default, s.unit || '', { step: s.step, log: s.curve === 'log' || (s.unit === 'Hz' && s.min > 0 && s.max / s.min >= 100) }))

// What a call draws over the output while it is being edited, from its argument values by name (seconds and dB).
// Times are in the output's timeline, exact when no later edit moves them.
export function guides(name, args, duration) {
  const out = []
  const range = args.at != null && args.duration != null ? [args.at, args.at + args.duration] : null
  if (ops[name]?.range) range && out.push({ range, dim: name === 'crop' ? 'outside' : 'inside' })
  else if (range) out.push({ range })
  // a level: a threshold (denoise's is an offset on its noise, none), a ceiling, a peak to reach
  const level = name === 'denoise' ? null : args.threshold ?? (name === 'limiter' ? args.ceiling : name === 'normalize' && typeof args.target === 'number' && args.mode !== 'lufs' && args.mode !== 'rms' ? args.target : null)
  if (typeof level === 'number') out.push({ level })
  if (name === 'fade') out.push({ fade: [args.in ?? .5, args.out ?? args.in ?? .5], duration })
  if (['paste', 'insert', 'mix'].includes(name) && typeof args.at === 'number') out.push({ at: args.at })
  const freq = args.freq ?? args.fc
  if (typeof freq === 'number' && ops[name] && ['Filter', 'Repair', 'Space'].includes(ops[name].group)) out.push({ freq })
  if (name === 'dehum' || (name === 'notch' && typeof freq === 'number')) for (let k = 2; k <= (args.harmonics ?? 1); k++) out.push({ freq: (freq ?? 50) * k })
  if (Array.isArray(args.band)) out.push({ band: args.band, range: range || [0, duration] })
  // where a noise is learned: each range it plays alone in
  for (const r of [args.noise].flat()) if (typeof r?.at === 'number' && typeof r.duration === 'number') out.push({ range: [r.at, r.at + r.duration], label: 'noise' })
  return out
}
