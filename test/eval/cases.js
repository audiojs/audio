// The eval's cases: a sound (a builder of sounds.js and its options), what is done to it, and what must hold of each
// measure (measures.js) after it.
//   do: [op, ...args] on the sound (a.op(...args).read()), { stat, use } (a.stat(name), a plan, once audio.use(use)
//       has registered it), or { call, opts }: a package's default export on the channels, as its own users call it
//   needs: optional packages the case runs on; where one is not installed the case is skipped, and said
//   hold: { measure: rule }. A rule: { harm: m } no harm: the take is not worse than the input on the measure by more
//       than m (read of the input the same way; where the measure has no reading of the input, against nothing
//       changed: 0); { back: true } no step back: not worse than its bound in bounds.json by more than the scatter
//       read there; both where both are given.
//
// The margins of no harm, each the step that a listener or the library itself takes as a change:
// - a shifted tone at the frequency asked, 3 dB, as a part's level
// - level of a part, 3 dB: the power doubled or halved, the step compare() reads an octave's or the noise floor's
//   change by (fn/compare.js THRESHOLDS)
// - balance, 1 dB: about the smallest interaural level difference heard (Mills, "Lateralization of high-frequency
//   tones", JASA 32, 1960: 0.5 to 1 dB)
// - onset, 6 dB: a tone's start at twice its own peak, the least a click can be and be heard over the tone (a choice)
// - SI-SDR and the bed, 0.5 dB; voice under, silenced, or lost where the input shows it (shown), 2.5 %: a word in 12 s
//   of speech (fn/compare.js: 0.3 s of a 12 s take is 2.5 to 2.8 % of its voiced frames)
// - ESTOI, 0.01 of 1 (a choice: its papers name no smallest step a listener takes; DeepFilterNet3 costs a clean
//   voice 0.005 and gains a voice in noise 0.08 to 0.18)
// - denoisers planned on a take that holds no noise: none
// - a pitch shift's length: not a frame more or less than its input's
const SHIFTERS = ['phase-lock', 'vocoder', 'formant', 'paulstretch', 'auto', 'ola', 'transient', 'psola', 'wsola', 'granular', 'sms', 'hpss', 'sample', 'hybrid', 'delay', 'lpc']
const DFN = { call: '@audio/neural-denoise', opts: { model: 'deepfilternet3' } }
const ND = ['@audio/neural-denoise']
// the packages whose versions a reading is recorded with, by what the case does
const SHIFT = { 'phase-lock': [], vocoder: ['@audio/shift-pvoc'], formant: ['@audio/shift-formant'], auto: ['@audio/shift'] }
const pkgs = d => d.call ? [d.call] : d.stat ? ['@audio/chain', '@audio/denoise-detect'] : {
  auto: ['@audio/chain', '@audio/denoise-detect', '@audio/neural-denoise'], deepfilter: ['@audio/neural-denoise'], declip: ['@audio/denoise-declip'],
  pitch: SHIFT[d[2]?.method] ?? [`@audio/shift-${d[2]?.method}`] }[d[0]]

export default [
  // do no harm on a clean voice
  { id: 'clean voice: auto', sound: ['voices', {}], do: ['auto', 'speech'], hold: { under: { harm: 2.5, back: true }, silenced: { harm: 2.5, back: true }, lost: { back: true }, shown: { harm: 2.5, back: true }, estoi: { harm: 0.01, back: true } } },
  { id: 'clean voice: deepfilter', sound: ['voices', {}], do: ['deepfilter'], needs: ND, hold: { lost: { back: true }, shown: { harm: 2.5, back: true }, sisdr: { back: true }, estoi: { harm: 0.01, back: true } } },

  // voices in noise that stands still (pink) and that moves, at three SNRs: through DeepFilterNet3 as the package's own
  // users call it (its default limit and floor), and through audio's auto() at 5 dB
  ...['pink', 'moving'].flatMap(noise => [0, 5, 15].map(snr => (
    { id: `voice in ${noise} noise ${snr} dB: neural-denoise`, sound: ['voices', { noise, snr }], do: DFN, needs: ND, hold: { sisdr: { harm: 0.5, back: true }, bed: { harm: 0.5, back: true }, lost: { back: true }, shown: { harm: 2.5, back: true }, estoi: { harm: 0.01, back: true } } }))),
  // audio's deepfilter() mixes the model's output by the package's own mixback(): one take of each kind holds the two
  // together (the package's other calls read as its own, sample for sample, while audio calls it as the package expects)
  { id: 'voice in pink noise 5 dB: deepfilter', sound: ['voices', { noise: 'pink', snr: 5 }], do: ['deepfilter'], needs: ND, hold: { sisdr: { harm: 0.5, back: true }, bed: { harm: 0.5, back: true }, lost: { back: true }, shown: { harm: 2.5, back: true }, estoi: { harm: 0.01, back: true } } },
  ...['pink', 'moving'].map(noise => ({ id: `voice in ${noise} noise 5 dB: auto`, sound: ['voices', { noise, snr: 5 }], do: ['auto', 'speech'], hold: { sisdr: { harm: 0.5, back: true }, bed: { harm: 0.5, back: true }, lost: { back: true }, shown: { harm: 2.5, back: true }, estoi: { harm: 0.01, back: true } } })),

  // a take with no voice
  ...['pink', 'moving'].map(kind => ({ id: `${kind} noise alone: neural-denoise`, sound: ['noise', { kind }], do: DFN, needs: ND, hold: { left: { back: true } } })),
  { id: 'pink noise alone: deepfilter', sound: ['noise', { kind: 'pink' }], do: ['deepfilter'], needs: ND, hold: { left: { back: true } } },

  // the radio channel
  { id: 'radio 5 dB: auto', sound: ['radio', { snr: 5 }], do: ['auto', 'speech'], hold: { under: { harm: 2.5, back: true }, silenced: { harm: 2.5, back: true }, lost: { back: true }, shown: { harm: 2.5, back: true }, estoi: { harm: 0.01, back: true } } },

  // a short isolated word: 16 frames, where the 2.5 % margin (a word in 12 s of speech) is no line, so shown holds by its
  // bound alone
  { id: 'word: deepfilter', sound: ['word', {}], do: ['deepfilter'], needs: ND, hold: { lost: { back: true }, shown: { back: true } } },
  { id: 'word: auto', sound: ['word', {}], do: ['auto', 'speech'], hold: { lost: { back: true }, shown: { back: true } } },

  // a tone, a chord and a sung voice are no noise bed
  ...[8000, 48000].map(fs => ({ id: `tone bursts ${fs / 1000} kHz: the chain's plan`, sound: ['tones', { kind: 'bursts', fs }], do: { stat: 'chain', use: 'auto' }, hold: { denoisers: { harm: 0 } } })),
  { id: 'chord 48 kHz: the chain\'s plan', sound: ['tones', { kind: 'chord', fs: 48000 }], do: { stat: 'chain', use: 'auto' }, hold: { denoisers: { harm: 0 } } },
  { id: 'sung voice: the chain\'s plan', sound: ['sung', {}], do: { stat: 'chain', use: 'auto' }, hold: { denoisers: { harm: 0 } } },
  { id: 'sung voice: auto', sound: ['sung', {}], do: ['auto', 'speech'], hold: { under: { harm: 2.5, back: true }, silenced: { harm: 2.5, back: true }, shown: { harm: 2.5, back: true } } },
  { id: 'sung voice: deepfilter', sound: ['sung', {}], do: ['deepfilter'], needs: ND, hold: { lost: { back: true }, shown: { harm: 2.5, back: true } } },

  // declip comes back no further from the original than the clipped take was
  // (the voice's intelligibility too: a second of speech, 48 of ESTOI's frames where it needs 30)
  ...['voice', 'chord', 'uniform'].map(kind => ({ id: `clipped ${kind}: declip`, sound: ['clipped', { kind }], do: ['declip'], hold: { sisdr: { harm: 0, back: true }, ...kind === 'voice' && { estoi: { harm: 0.01, back: true } } } })),

  // each pitch shifter, 5 semitones up (the tone 5 down): level kept, the length kept either way, the tone where it was
  // asked, balance kept
  ...SHIFTERS.flatMap(method => [
    { id: `cut loud: pitch ${method}`, sound: ['cut', {}], do: ['pitch', 5, { method }], hold: { level: { harm: 3, back: true }, length: { harm: 0, back: true } } },
    { id: `two phrases 12 dB apart: pitch ${method}`, sound: ['phrases', {}], do: ['pitch', 5, { method }], hold: { level: { harm: 3, back: true } } },
    { id: `pure tone: pitch ${method}`, sound: ['tone', { shift: -5 }], do: ['pitch', -5, { method }], hold: { onset: { harm: 6, back: true }, tone: { harm: 3, back: true }, length: { harm: 0, back: true } } },
    { id: `two channels: pitch ${method}`, sound: ['pair', {}], do: ['pitch', 5, { method }], hold: { balance: { harm: 1, back: true } } },
  ]),
].map(c => ({ ...c, pkgs: pkgs(c.do) }))
