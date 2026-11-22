// What the editor knows about each method: its group in the menu, what it does, its parameters for the sliders,
// and what it draws over the waveform while its call is being edited.
// Built-in ops are described here; registry plugins describe their own parameters (the engine reads their manifests).
// What each parameter does, in words, for the tooltip over its slider, is help.js's.
import { FADES as CURVES, CROSSFADES } from '../fn/curves.js'

// A parameter: { name, min, max, default, unit, step, log, values }. `values` makes it a choice; `selection` (what to
// select) makes it the selected range, or ranges, set from the picture, not a slider; `required`, the library has no
// default for it, so a new call writes this one; `option`, the library takes it only by its name, in the options;
// `past`, the value at its slider's last place, past `max` (Infinity: a limit lifted).
const p = (name, min, max, def, unit = '', more) => ({ name, min, max, default: def, unit, ...more })
const hz = (name = 'freq', def = 1000, min = 20, max = 20000) => p(name, min, max, def, 'Hz', { log: true })
const db = (name, min, max, def) => p(name, min, max, def, 'dB', { step: .1 })
const sec = (name, max, def, min = 0) => p(name, min, max, def, 's', { step: .01 })
const choice = (name, values, def = values[0]) => ({ name, values, default: def })
const Q = (def = .707) => p('Q', .1, 30, def, '', { log: true })
const need = s => ({ ...s, required: true })

// Ops whose time range is the whole call: `.remove({ at, duration })`; with more after it: `.move({ at, duration, to })`.
const RANGE = [p('at', 0, 1, 0, 's', { step: .01 }), p('duration', 0, 1, 1, 's', { step: .01 })]

export const GROUPS = ['Edit', 'Silence', 'Level', 'Filter', 'Dynamics', 'Repair', 'Time & pitch', 'Effect', 'Color', 'Reverb', 'Space', 'Generate']

// The scales tune() and center() snap to, as semitones up from the root: @audio/note's SCALES, which @audio/tune-snap snaps by
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
  phrygian: [0, 1, 3, 5, 7, 8, 10],
  lydian: [0, 2, 4, 6, 7, 9, 11],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  locrian: [0, 1, 3, 5, 6, 8, 10],
  whole: [0, 2, 4, 6, 8, 10]
}

// name: [group, description, params] – params omitted for plugins (read from their manifests), `range` for range-only calls.
const table = {
  // Edit, and Silence: what is quiet at its ends, between its sounds, before and after it
  trim: ['Silence', 'Cut silence from both ends', [db('threshold', -80, 0, -40)]],
  shrink: ['Silence', 'Shorten pauses', [sec('gap', 2, .3), db('threshold', -80, 0, -40), sec('crossfade', .05, 0)]],
  crop: ['Edit', 'Keep a range, drop the rest', 'range'],
  remove: ['Edit', 'Delete a range and close the gap', 'range'],
  cut: ['Edit', 'Delete a range into the clipboard', 'range'],
  copy: ['Edit', 'Copy a range to the clipboard', 'range'],
  move: ['Edit', 'Slide a range to another time, over what is there', ['range', sec('to', 1, 0)]],
  paste: ['Edit', 'Insert the clipboard', [sec('at', 1, 0)]],
  insert: ['Edit', 'Insert audio or seconds of silence', [{ name: 'source' }, sec('at', 1, 0)]],
  pad: ['Silence', 'Add silence before and after', [sec('before', 5, .5), sec('after', 5, .5)]],
  repeat: ['Time & pitch', 'Play it several times', [p('times', 1, 16, 2, '×', { step: 1 })]],
  reverse: ['Time & pitch', 'Play backwards', []],
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
  master: ['Filter', 'Match a reference\'s tone, width and loudness', [{ name: 'source' }]],
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
  comb: ['Filter', 'Peaks and dips along one pitch\'s harmonics'],
  dcblocker: ['Filter', 'Remove DC offset'],
  emphasis: ['Filter', 'Boost the highs, for de-emphasis to undo'],
  deemphasis: ['Filter', 'Undo pre-emphasis after decoding'],
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
  denoise: ['Repair', 'Remove a noise learned where it plays alone', [db('reduction', 0, 40, 12), db('threshold', -10, 10, 0), { name: 'noise', selection: 'where the noise plays alone' }]],
  omlsa: ['Repair', 'Reduce background noise that changes'],
  // the noise `limit` dB down at most; with none (Infinity, its slider's last place) pauses can fall to silence
  // (fn/deepfilter.js)
  deepfilter: ['Repair', 'Take the noise off speech with a neural model', [{ ...db('limit', 0, 40, 18), past: Infinity }, { ...choice('music', ['pass', 'enhance']), option: true }, { ...db('floor', 0, 60, 40), option: true }]],
  rnnoise: ['Repair', 'Take the noise off speech as it streams'],
  wiener: ['Repair', 'Reduce noise, gentle'],
  specsub: ['Repair', 'Reduce noise by spectral subtraction'],
  dehum: ['Repair', 'Remove mains hum'],
  roomtone: ['Repair', 'Fill digital silence with the room tone', [db('threshold', -120, -60, -90)]],
  // the second channel moved onto the first; unset, the delay measured over time (fn/azimuth.js)
  azimuth: ['Repair', 'Line up a stereo pair in time and polarity', [p('delay', -2, 2, 0, 'ms', { step: .001 })]],
  dewow: ['Repair', 'Correct wow and flutter'],
  // a song's four stems, each at its own level, by a separation model (fn/rebalance.js)
  rebalance: ['Repair', 'Vocals, bass, drums or the rest up or down', [db('vocals', -60, 12, 0), db('bass', -60, 12, 0), db('drums', -60, 12, 0), db('other', -60, 12, 0)]],
  // a soundtrack's dialogue, music and effects, each at its own level, by a separation model (fn/rebalance.js)
  scene: ['Repair', 'Turn dialogue, music or effects up or down', [db('dialogue', -60, 12, 0), db('music', -60, 12, 0), db('effects', -60, 12, 0), { ...choice('model', ['mrx', 'tiger']), option: true }]],
  // the tonal, noisy and transient parts, each at its own level (fn/deconstruct.js)
  deconstruct: ['Repair', 'Rebalance tones, noise and attacks', [db('tonal', -60, 12, 0), db('noise', -60, 12, 0), db('transient', -60, 12, 0), p('separation', 1, 8, 2, '×', { step: .1, option: true })]],
  // the clicks found everywhere, or in the selection alone, each rebuilt from around it (fn/declick.js)
  declick: ['Repair', 'Remove clicks', [p('threshold', 2, 30, 8, '×', { step: .5 }), p('longest', .5, 20, 6, 'ms', { step: .5 }), p('order', 8, 100, 32, '', { step: 1 })]],
  decrackle: ['Repair', 'Remove vinyl crackle'],
  declip: ['Repair', 'Rebuild clipped peaks'],
  // a voice's band lost above a cutoff, rebuilt from its own harmonics (fn/recover.js)
  recover: ['Repair', 'Rebuild lost highs from a voice\'s harmonics', [hz('cutoff', 4000, 1000, 20000)]],
  // the room `reduction` dB down by a trained model, music passed; or the classical kernel (fn/dereverb.js)
  dereverb: ['Repair', 'Remove room echo from a voice', [db('reduction', 0, 60, 60), { ...choice('music', ['pass', 'enhance']), option: true }, { ...choice('method', ['roformer', 'wpe']), option: true }]],
  // a voice made again by a neural vocoder, the input kept above the crossover (fn/vocos.js)
  vocos: ['Repair', 'Rebuild a synthetic voice with a neural vocoder', [{ ...hz('crossover', 11000, 2000, 12000), option: true }]],
  // a voice back to a studio take by a neural model, the input mixed back by 1 − strength (fn/restore.js)
  restore: ['Repair', 'A voice to a studio take, by a neural model', [p('strength', 0, 1, 1, '', { step: .01 })]],
  deplosive: ['Repair', 'Soften p and b pops'],
  dewind: ['Repair', 'Reduce wind rumble'],
  debreath: ['Repair', 'Lower breaths between words'],
  // a clip-on mic's clothing rustle off the voice, the room's steady tone kept (fn/derustle.js)
  derustle: ['Repair', 'Remove clothing rustle from a clip-on mic', [db('reduction', 0, 60, 45), { ...choice('ambience', [true, false]), option: true }]],
  desqueak: ['Repair', 'Lower string squeaks, harsh picks, amp hiss'],
  defeedback: ['Repair', 'Suppress feedback howl'],
  debleed: ['Repair', 'Take a source\'s bleed out of a mic, given its track'],
  spectral: ['Repair', 'Change a band over a time range', [p('band', 20, 20000, [1000, 4000], 'Hz', { log: true }), db('gain', -60, 12, -60)]],
  repair: ['Repair', 'Rebuild a damaged range from its surroundings', 'range'],
  // Time & pitch
  speed: ['Time & pitch', 'Faster or slower, pitch follows', [p('rate', .25, 4, 1, '×', { step: .01, log: true })]],
  // its algorithm a choice, each but the vocoder its own module, loaded only when chosen (fn/stretch.js)
  stretch: ['Time & pitch', 'Longer or shorter, same pitch', [p('factor', .25, 4, 1, '×', { step: .01, log: true }), { ...choice('method', ['phase-lock', 'vocoder', 'pghi', 'wsola', 'psola', 'sms', 'transient', 'hybrid', 'paulstretch']), option: true }]],
  // its algorithm a choice, each but the vocoder its own module, loaded only when chosen (fn/pitch.js)
  pitch: ['Time & pitch', 'Higher or lower, same length', [p('semitones', -24, 24, 0, 'st', { step: 1 }), { ...choice('method', ['phase-lock', 'vocoder', 'formant', 'psola', 'wsola', 'lpc', 'transient', 'hybrid', 'hpss', 'sms', 'sample', 'delay', 'ola', 'granular', 'paulstretch', 'auto']), option: true }]],
  intonation: ['Time & pitch', 'A voice\'s rises and falls, wider or flatter', [p('factor', 0, 3, 1, '×', { step: .05 })]],
  // each note's layer (fn/intonation.js): its vibrato about its line, its line about its centre, its centre about its note
  modulation: ['Time & pitch', 'A voice\'s vibrato in each note, deeper or flatter', [p('factor', -1, 3, 1, '×', { step: .05 })]],
  drift: ['Time & pitch', 'A voice\'s slow wander in each note, more or less', [p('factor', 0, 3, 1, '×', { step: .05 })]],
  center: ['Time & pitch', 'Each note centred on its note, vibrato kept', [p('factor', 0, 2, 1, '×', { step: .05 }), { ...choice('scale', Object.keys(SCALES)), option: true }, p('root', 0, 11, 0, '', { step: 1, option: true })]],
  formant: ['Time & pitch', 'Move a voice\'s formants, pitch kept', [p('semitones', -12, 12, 0, 'st', { step: .5 })]],
  tune: ['Time & pitch', 'Snap pitch to a scale'],
  resample: ['Time & pitch', 'Change the sample rate', [need(choice('rate', [8000, 16000, 22050, 32000, 44100, 48000, 96000], 48000))]],
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
  distortion: ['Color', 'Saturate by bending the wave non-linearly'],
  tube: ['Color', 'Warm tube saturation'],
  tape: ['Color', 'Tape saturation'],
  transistor: ['Color', 'Console saturation'],
  waveshaper: ['Color', 'Bend the wave through tanh or your own curve'],
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
  isolate: ['Space', 'Keep the centre of the mix, drop the sides'],
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

// A method's name as the menus and the edits write it: capitalized, its words apart, an acronym in capitals
const LABELS = { eq: 'EQ', geq: 'GEQ', dyneq: 'DynEQ', fm: 'FM', sbr: 'SBR', omlsa: 'OMLSA', fdn: 'FDN', adsr: 'ADSR', fet: 'FET', vca: 'VCA', rnnoise: 'RNNoise', dcblocker: 'DC blocker', sfx: 'SFX', lofi: 'Lo-fi' }
export const labelOf = name => LABELS[name] ?? name[0].toUpperCase() + name.slice(1).replaceAll('-', ' ')
// What a row of a list of edits calls one whose name alone does not say what it acts on: its name, then that, so the
// list reads plainly while the chain and the script show the call (editor/menus.js findable)
const ROWS = { trim: 'Trim silence', shrink: 'Shrink pauses', pad: 'Pad with silence' }
export const rowOf = name => ROWS[name] ?? labelOf(name)

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
export const reshapes = name => ['Edit', 'Silence', 'Time & pitch'].includes(ops[name]?.group) || ['remix', 'crossfade', 'warp'].includes(name) || !!methods[name] && !methods[name].edits

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
  Silence: 'M3 12h18M5 8v8M8 10v4M16 10v4M19 8v8',
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

export const presets = { normalize: ['podcast', 'spotify', 'broadcast'], vocals: ['isolate', 'remove'], codec: ['mp3', 'aac', 'opus', 'vorbis'] }

// What a step's new settings do to the picture while its output renders, drawn at once: the factor they change the
// level by at time t of the output, from its settings before (`was`) and now (`is`), by name, the output `T` long; none
// where a level can't say it (a step that moves time, filters or compresses shows its output when it comes). A step
// with a range changes only there. The curves are fade()'s, and a crossfade's, its equal power too, as the library has them.
export { CURVES, CROSSFADES }
const within = (s, f) => s.at == null && s.duration == null ? f : t => t >= (s.at ?? 0) && t < (s.at ?? 0) + (s.duration ?? Infinity) ? f(t) : 1
function fading({ in: a = .5, out, curve }, T) {
  const c = CURVES[curve] ?? CURVES.linear, fin = a > 0 ? a : 0, fout = a < 0 ? -a : Math.abs(out ?? 0)
  return t => (fin && t < fin ? c(t / fin) : 1) * (fout && t > T - fout ? c((T - t) / fout) : 1)
}
export const previews = {
  // (from silence, a value of −Infinity, no factor says it)
  gain: (was, is) => Number.isFinite(was.value) && typeof is.value === 'number' ? within(is, () => 10 ** ((is.value - was.value) / 20)) : null,
  normalize: (was, is) => typeof is.target === 'number' && (was.mode ?? 'peak') === (is.mode ?? 'peak') ? () => 10 ** ((is.target - (was.target ?? 0)) / 20) : null,
  fade(was, is, T) {
    if (was.at != null || is.at != null) return null
    const a = fading(was, T), b = fading(is, T)
    return t => { const g = a(t), h = b(t); return g > 1e-3 ? h / g : h > 1e-3 ? 1e3 : 1 }
  }
}
// What a step's new settings do to time where they scale it, a stretch's or a speed's: where that begins, s, the start
// of its range (0, all of it; the earlier of the two where the range moves), from settings `was` to `is` on an output
// `T` long. What is before it keeps its times; what is after it scales as the output's length comes to be, a method's
// own limit in it (of stretch(8), wsola stretches 4× at most: its factor's max), so each time keeps to the moment of the
// sound it marked (editor/run.js carry). None for a step that keeps time, or moves it otherwise (a cut, silence added):
// those times stay as they are
const begun = ({ at }, T) => typeof at === 'number' ? Math.max(0, at < 0 ? T + at : at) : 0
const scaled = (was, is, T) => Math.min(begun(was, T), begun(is, T))
export const retimes = { stretch: scaled, speed: scaled }
// A time on an output `T0` s long to the same moment of the sound on one `T1` s long, scaled from `at` on (retimes);
// none where the two are as long, or nothing follows `at` to scale
export const retimer = (at, T0, T1) => !(T0 > at && T1 > at) || Math.abs(T1 - T0) < 1e-9 ? null : t => t <= at ? t : at + (t - at) * (T1 - at) / (T0 - at)

// The value of a numeric parameter as the slider shows it, its unit right after it (−1dB, 8kHz, 0.5s).
export function format(value, { unit = '', step } = {}) {
  if (typeof value !== 'number') return String(value)
  if (value === Infinity || value === -Infinity) return (value < 0 ? '−∞' : '∞') + unit
  const digits = step >= 1 ? 0 : Math.abs(value) >= 100 ? 0 : Math.abs(value) >= 10 ? 1 : 2
  const text = unit === 'Hz' && Math.abs(value) >= 1000 ? +(value / 1000).toFixed(2) + 'kHz' : +value.toFixed(digits) + unit
  return value < 0 ? '−' + text.slice(1) : text
}

// A number's place on its slider, 0..1000: linear, or logarithmic for frequencies and ratios (`log`); and the value at
// a place, rounded to its step (a log one's to three figures, a linear one's with none to a thousandth of its range),
// written short: one mapping for an edit's settings (settings.js) and a value dragged on a row of the edits' list
// (editor/menus.js findHold). An infinite value stands at its end of the slider, and the last place is `past` where a
// setting has one
export const toSlider = (s, v) => v === Infinity ? 1000 : v === -Infinity ? 0 : s.log && s.min > 0 ? Math.log(v / s.min) / Math.log(s.max / s.min) * 1000 : (v - s.min) / (s.max - s.min) * 1000
export function fromSlider(s, x) {
  if (s.past !== undefined && x >= 1000) return s.past
  const at = Math.max(0, Math.min(1000, x)), raw = s.log && s.min > 0 ? s.min * (s.max / s.min) ** (at / 1000) : s.min + at / 1000 * (s.max - s.min)
  const step = s.step ?? (s.log ? Math.max(.01, 10 ** (Math.floor(Math.log10(Math.max(raw, 1e-9))) - 2)) : (s.max - s.min) / 1000)
  return +(Math.round(raw / step) * step).toFixed(Math.max(0, Math.min(6, Math.ceil(-Math.log10(step)))))
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

// What an edit would do to a sound, as marks on the picture (the view's guides: what it would cut away, the level it
// would bring the peak to, a fade's ramps): pointed at, an edit shows what it would do; pressed, it does it. Each edit
// answers for itself, `marks(args, sound)`: its arguments by name, as written (none given, none assumed: the library's
// own defaults are its, said where they are), and the sound it would be given, { duration, sampleRate, channels } (its
// samples; none where the page holds a long one as its peaks alone; `threshold`, the one trim and shrink find in it
// where none is given, as the library finds it, once the engine has read it). `input` (or, of its arguments, whether):
// its marks are of that sound, so an edit already made, which has changed the sound shown, is drawn over the sound
// before it. An edit with no hint, or one that cannot be drawn truthfully from these (a loudness target), draws none:
// never a guess. One vocabulary, as the picture's own hints have it (view/notes.js
// paintGuide), all of it in the guides' colour (the accent's cyan): filled, half transparent, what the edit takes away
// or changes: a span of time cut (`cut`), what a fade takes off (`ramps` with `fill`), the levels a peak moves through
// (`level` from `from`), the frequencies a filter cuts (`cutHz`); a line for what it sets or keeps: where the sound kept
// starts and ends, a fade's curve, the level a peak goes to, a cutoff (`freq`). None
// where every sample changes alike and a fill would say no more than the name (reverse, a speed, a pitch), nor where
// what it adds has no room on the picture (pad, repeat)
export const hints = {
  // the ends its threshold leaves, as the library's trim reads them (fn/trim.js, louds): cut, what is before the first
  // loud block and after the last; all of it, none being loud. None given, its own, as the library finds it in that
  // sound (the sound's `threshold`, read off its block stats by the engine: worker.js threshold)
  trim: { input: true, of: ['threshold'], marks({ threshold: given }, { duration, sampleRate, channels, threshold: found }) {
    const threshold = given ?? found
    if (typeof threshold !== 'number' || !channels?.length) return null
    const loud = louds(threshold, channels), s = loud.indexOf(true), e = loud.lastIndexOf(true)
    if (s < 0) return [{ cut: [0, duration] }]
    const from = s * BLOCK / sampleRate, to = Math.min((e + 1) * BLOCK, channels[0].length) / sampleRate
    return [from > 0 && { cut: [0, from] }, to < duration && { cut: [to, duration] }].filter(Boolean)
  } },
  // each pause it shortens, as the library's shrink reads them (fn/shrink.js): a run of quiet blocks keeps its first
  // `gap` s (0.3, the library's), the rest of it cut, where that is a block or more. None given, its own threshold, as
  // trim's; a range is not read here
  shrink: { input: true, of: ['gap', 'threshold'], marks({ gap = .3, threshold: given, at, duration: d }, { sampleRate, channels, threshold: found }) {
    const threshold = given ?? found
    if (typeof threshold !== 'number' || typeof gap !== 'number' || at != null || d != null || !channels?.length) return null
    const loud = louds(threshold, channels), keep = Math.round(Math.max(0, gap) * sampleRate), out = []
    const close = (s, end) => { const from = s * BLOCK + keep; if (end - from >= BLOCK) out.push({ cut: [from / sampleRate, end / sampleRate] }) }
    let start = -1
    loud.forEach((on, i) => { if (!on && start < 0) start = i; else if (on && start >= 0) { close(start, i * BLOCK); start = -1 } })
    if (start >= 0) close(start, channels[0].length)
    return out
  } },
  // what it keeps, its range (`at`, `duration`, from the end where `at` is less than 0), the rest cut
  crop: { input: true, of: ['at', 'duration'], marks(args, { duration }) {
    const r = span(args, duration)
    return r && [r[0] > 0 && { cut: [0, r[0]] }, r[1] < duration && { cut: [r[1], duration] }].filter(Boolean)
  } },
  // what it takes out, its range
  remove: { input: true, of: ['at', 'duration'], marks: (args, { duration }) => { const r = span(args, duration); return r && r[1] > r[0] ? [{ cut: r }] : null } },
  // its ramps along its curve, what each takes off filled, each its own (the first its `in`'s, the second its `out`'s);
  // none with no length given (the library's fade() fades nothing)
  fade: { marks: (args, { duration }) => typeof args.in === 'number' ? guides('fade', args, duration).flatMap(g => g.ramps ? g.ramps.map((r, i) => ({ ramps: [r], fill: true, of: [i ? 'out' : 'in', 'curve'] })) : [g]) : null },
  // the level it brings the peak to, a line each side of the centre (0 dBFS where none is given, the library's), from
  // the peak the sound has, where its samples are here; a loudness target (lufs, rms, a delivery spec) is no line on a
  // waveform, nor a range's peak
  normalize: { input: args => peakTarget(args) != null, of: ['target', 'mode'], marks(args, sound) {
    const level = peakTarget(args), from = sound.channels?.length ? peakOf(sound) : null
    return level == null ? null : [{ level, ...Number.isFinite(from) && { from } }]
  } },
  // the peak it moves, by its value, from the peak the sound has (over its range, where it has one, there alone); none
  // at 0 dB
  gain: { input: true, of: ['value', 'at', 'duration'], marks(args, sound) {
    const { value } = args, r = args.at != null || (args.duration ?? args.d) != null ? span(args, sound.duration) : [0, sound.duration]
    if (typeof value !== 'number' || !value || !r || !sound.channels?.length) return null
    const from = peakOf(sound, ...r)
    return Number.isFinite(from) ? [{ level: from + value, from, span: r }] : null
  } },
  // the frequencies it cuts, below its cutoff or above it, on a spectrogram (a waveform has no frequencies to fill)
  highpass: { of: ['freq'], marks: ({ freq }) => typeof freq === 'number' ? [{ cutHz: [0, freq] }, { freq }] : null },
  lowpass: { of: ['freq'], marks: ({ freq }, { sampleRate }) => typeof freq === 'number' ? [{ cutHz: [freq, sampleRate / 2] }, { freq }] : null }
}
// Whether an edit's hint, given these arguments, is of the sound it is given (`input`)
export const fromInput = (name, args = {}) => { const i = hints[name]?.input; return typeof i === 'function' ? !!i(args) : !!i }
// each mark with the settings it follows (`of`: its edit's, `of` on the hint, where it does not say its own: a fade's two
// ramps), so a setting pointed at in an edit's settings marks its own part (editor/menus.js stepHint)
export const hint = (name, args, sound) => ((sound && hints[name]?.marks(args ?? {}, sound)) || []).map(m => ({ of: hints[name].of ?? null, ...m }))
// A sound in blocks of 1024 samples (core.js BLOCK_SIZE), each loud where any channel's peak in it is over `threshold`
// dB, as the library's trim and shrink read it (stats.js isLoud)
const BLOCK = 1024
function louds(threshold, channels) {
  const over = 10 ** (threshold / 20), total = channels[0].length
  return Array.from({ length: Math.ceil(total / BLOCK) }, (_, i) => channels.some(ch => { for (let j = i * BLOCK, end = Math.min(total, j + BLOCK); j < end; j++) if (Math.abs(ch[j]) > over) return true; return false }))
}
// a sound's peak over [a, b) s, dBFS (−Infinity: silent there)
function peakOf({ sampleRate, channels }, a = 0, b = Infinity) {
  let top = 0
  for (const ch of channels) for (let i = Math.max(0, Math.floor(a * sampleRate)), end = Math.min(ch.length, Math.ceil(b * sampleRate)); i < end; i++) { const v = Math.abs(ch[i]); if (v > top) top = v }
  return top ? 20 * Math.log10(top) : -Infinity
}
// a range's [start, end] s, written as `at` and `duration` (`d` short), `at` from the end where less than 0; null where
// either is not a number
function span({ at, duration, d = duration }, total) {
  if (typeof at !== 'number' || typeof d !== 'number') return null
  const a = at < 0 ? total + at : at
  return [Math.max(0, a), Math.min(total, a + d)]
}
// normalize's peak target, dBFS: a number (0 where none is given, the library's), the mode a peak's, no range; else null
const peakTarget = ({ target, mode, at, duration, d }) => (mode ?? 'peak') === 'peak' && at == null && (duration ?? d) == null && (target == null || typeof target === 'number') ? target ?? 0 : null
// A call's arguments by name, from what it is written with ('-40', "'podcast', 'lufs'"): each a number or a word, by its
// place in the edit's parameters; none where it is written with none
export function named(name, text = '') {
  const spec = ops[name]?.params ?? [], vals = String(text ?? '').trim() ? String(text).split(',').map(a => a.trim()) : []
  return Object.fromEntries(vals.map((a, i) => [spec[i]?.name, Number.isNaN(+a) ? a.replace(/^['"`]|['"`]$/g, '') : +a]).filter(([k]) => k))
}
