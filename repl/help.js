// What each setting does, for someone who has not read a manual: the tooltip over a slider's label (stack.js), and which
// settings a card shows first. A text says what the setting is, what it does to the sound and which way to move it, with a
// plain name first where its label is cryptic, in two lines of the tooltip at the most (some 90 letters): what an op's
// docs say at length stays there. By op and setting; `*` is what a setting of that name means in every op that has it.
// The tests keep every setting of every op in here, built-in and plugin alike, and nothing that is not one, each in two
// lines.

// The settings a card shows, in order, and after `|` those it folds under Advanced: the engine's own, and those few touch. An
// op not listed shows them all.
export const layouts = {
  compressor: 'threshold ratio attack release knee makeup | link upThreshold upRatio upKnee upRange',
  gate: 'threshold range release | closeThreshold hold attack lookahead link',
  deesser: 'mode threshold range | split fc Q ratio knee attack release lookahead',
  expander: 'threshold ratio range | mode knee attack release link',
  leveler: 'target maxGain | frame smooth gate',
  unlimit: 'amount | drive adaptive crestTarget ceiling fastAttack fastRelease slowAttack slowRelease',
  ducker: 'threshold range attack release | ratio knee',
  debleed: 'attenuation | span',
  dewow: 'mode refFreq | smooth maxDeviation wow flutter',
  deconstruct: 'tonal noise transient | separation',
  multiband: 'low high threshold ratio makeup | upThreshold upRatio depth attack release',
  dyneq: 'mode fc Q threshold ratio maxGain | attack release',
  dehum: 'freq harmonics | adaptive tones',
  omlsa: 'gMin threshold | alphaDD qPrior xiFloor',
  deplosive: 'attenuation triggerRatio crossover | attack release',
  dewind: 'attenuation | cutoff',
  declick: 'threshold | longest order',
  decrackle: 'threshold | order',
  declip: 'clipLevel | order',
  debreath: 'range room | attack release',
  phaser: 'rate depth feedback | stages fc phase',
  autowah: 'sens base range Q | attack release',
  graindelay: 'time pitch feedback mix | grain spray jitter',
  rotary: 'hornSpeed drumSpeed depth mix | crossover hornInertia drumInertia micSpread',
  tune: 'scale root strength speed | tolerance a4',
  baxandall: 'bass treble | fBass fTreble',
  fm: 'freq ratio index amp | indexDecay indexFloor feedback attack release',
  modal: 'freq model t60 strike amp | nmodes damping inharmonicity exciter seed',
  freqshift: 'shift mix | taps',
  binaural: 'azimuth distance mix | headRadius',
  softclip: 'curve drive ceiling | oversample',
  wiener: 'xiFloor | rule alphaDD'
}

export const texts = {
  // the words every op's setting of that name shares, where its own (below) does not say it otherwise
  '*': {
    at: 'Start. Where the range begins, in seconds from the start of the sound.',
    duration: 'Length. How long the range lasts, in seconds.',
    mix: 'How much of the effect is blended in: 0 is the original sound only, 1 is the effect only.',
    amp: 'How loud it plays, from silent (0) to full scale (1).',
    seed: 'Random seed: the same number, the same result.',
    link: 'Stereo link. At 0 each channel is turned down by its own level; at 1 all by the loudest.',
    factor: 'Length. 2 makes it twice as long and 0.5 half as long; the pitch stays.'
  },
  // Edit
  trim: {
    threshold: 'Silence level, in dB: quieter ends are cut; unset, it is found.'
  },
  shrink: {
    gap: 'Longest pause kept, in seconds. A pause longer than this is cut down to it.',
    threshold: 'Silence level, in dB: quieter is a pause; unset, it is found.',
    crossfade: 'Each cut faded over this long, in seconds; 0 is a hard cut. The length stays.'
  },
  move: {
    to: 'Where the range lands, in seconds. Its audio goes over what is there.'
  },
  paste: {
    at: 'Where the clipboard goes in, in seconds. What follows moves later.'
  },
  insert: {
    at: 'Where it goes in, in seconds. What follows moves later.'
  },
  pad: {
    before: 'Silence added before the start, in seconds.',
    after: 'Silence added after the end, in seconds.'
  },
  repeat: {
    times: 'How many extra times it plays after the first: 2 plays it three times in all.'
  },
  // Level
  gain: {
    value: 'Volume change, in dB: each 6 dB doubles or halves the wave.'
  },
  normalize: {
    target: 'The level it is brought to, in dB: its peak, loudness or average, as the mode says.',
    mode: 'What meets the target: peak, loudness (lufs) or average (rms).'
  },
  fade: {
    in: 'Fade in. How long the start takes to come up from silence, in seconds.',
    out: 'Fade out. How long the end takes to die away to silence, in seconds.',
    curve: 'Shape of the fade. linear is even, cos eases both ends, exp stays low longer, log high.'
  },
  pan: {
    value: 'Balance. -1 is all left, 0 is centred, 1 is all right. The far side is turned down; nothing is boosted.'
  },
  mix: {
    at: 'Where the other sound starts, in seconds.',
    gain: 'How loud the other sound is against this one, in dB.'
  },
  crossfade: {
    duration: 'How long the two sounds overlap while the first gives way to the second, in seconds.',
    curve: 'How the two trade places. equal keeps unlike sounds level; cos and linear suit like ones.'
  },
  remix: {
    channels: 'How many channels the sound ends up with: 1 is mono, 2 is stereo.'
  },
  dither: {
    bits: 'The bit depth it goes down to. A whisper of noise makes the rounding smooth, not grainy.'
  },
  // Filter
  highpass: {
    freq: 'Cutoff. Sound below this frequency is turned down.',
    order: 'Steepness past the cutoff: 2 is gentle, 12 dB an octave; 8 is steep, 48.'
  },
  lowpass: {
    freq: 'Cutoff. Sound above this frequency is turned down.',
    order: 'Steepness past the cutoff: 2 is gentle, 12 dB an octave; 8 is steep, 48.'
  },
  bandpass: {
    freq: 'Centre. The frequency that is kept; the rest falls away on either side.',
    Q: 'Width. Higher keeps a narrower band; lower keeps a wider one.'
  },
  notch: {
    freq: 'The frequency to remove, such as the 50 or 60 Hz of mains hum.',
    Q: 'Width of the cut. Higher removes a narrower slice and touches less of the sound around it.'
  },
  allpass: {
    freq: 'Where its phase shifts most, in Hz; the level stays the same at every frequency.',
    Q: 'How narrow the shifted region is: higher is more abrupt and more local.'
  },
  phase: {
    angle: 'How far the phase turns, in degrees; 180 flips it. Unset, the turn that lowers peaks most.'
  },
  lowshelf: {
    freq: 'Corner. Everything below it is raised or lowered by the gain.',
    gain: 'Boost above 0, cut below 0, in dB.',
    Q: 'Shelf shape. Higher adds a small overshoot at the corner; about 0.7 is smooth.'
  },
  highshelf: {
    freq: 'Corner. Everything above it is raised or lowered by the gain.',
    gain: 'Boost above 0, cut below 0, in dB.',
    Q: 'Shelf shape. Higher adds a small overshoot at the corner; about 0.7 is smooth.'
  },
  eq: {
    freq: 'Centre of the band that is boosted or cut.',
    gain: 'Boost above 0, cut below 0, in dB.',
    Q: 'Width. Higher is narrower and more pointed; lower is broader and gentler.'
  },
  match: {
    amount: 'How far the tone moves toward the reference: 0 changes nothing, 1 is the full match.'
  },
  crossover: {
    freq: 'Split point. The sound is divided into a band below it and a band above it.'
  },
  geq: {
    g31: 'Boost or cut of the band around 31 Hz, in dB.',
    g63: 'Boost or cut of the band around 63 Hz, in dB.',
    g125: 'Boost or cut of the band around 125 Hz, in dB.',
    g250: 'Boost or cut of the band around 250 Hz, in dB.',
    g500: 'Boost or cut of the band around 500 Hz, in dB.',
    g1k: 'Boost or cut of the band around 1 kHz, in dB.',
    g2k: 'Boost or cut of the band around 2 kHz, in dB.',
    g4k: 'Boost or cut of the band around 4 kHz, in dB.',
    g8k: 'Boost or cut of the band around 8 kHz, in dB.',
    g16k: 'Boost or cut of the band around 16 kHz, in dB.'
  },
  tilt: {
    gain: 'A see-saw at the pivot; above 0 the lows go up and highs down, warmer, below 0 brighter.',
    pivot: 'The frequency the see-saw balances around, in Hz. It stays level there.'
  },
  baxandall: {
    bass: 'Boost or cut of the lows, in dB.',
    treble: 'Boost or cut of the highs, in dB.',
    fBass: 'Where the bass control starts, in Hz: everything under it is raised or lowered.',
    fTreble: 'Where the treble control starts, in Hz: everything over it is raised or lowered.'
  },
  dyneq: {
    fc: 'Centre of the band that is watched and changed, in Hz.',
    Q: 'Width of the band. Higher is narrower and more pointed; lower is broader.',
    threshold: 'How loud the band must get, in dB, before it is changed. Lower reacts to quieter sound.',
    ratio: 'How firmly the band is changed once past the threshold. Higher is stronger.',
    attack: 'How fast it reacts when the band gets loud, in ms.',
    release: 'How fast it lets go when the band falls back, in ms.',
    maxGain: 'Most the band is turned down or up, in dB.',
    mode: 'down lowers the band when it gets loud, taming harshness; up raises it, bringing it out.'
  },
  'spectral-tilt': {
    slope: 'Each octave raised over the last, in dB: above 0 brighter, below darker. It adds up.'
  },
  moog: {
    fc: 'Cutoff, in Hz. lowpass lowers what is above it, highpass below, bandpass both sides.',
    resonance: 'Emphasis at the cutoff, 0 to 1: higher squelches and sings; at 1 it rings by itself.',
    drive: 'Push into the filter; above 1 adds warm distortion, below 1 is cleaner and quieter.',
    type: 'What is kept. lowpass the lows (the Moog sound), highpass the highs, bandpass a band.',
    poles: 'Steepness. 4 poles, 24 dB an octave, is the classic ladder; 2, 12 dB, gentler, brighter.'
  },
  korg35: {
    fc: 'Cutoff, in Hz. lowpass turns down sound above it, highpass turns down sound below it.',
    resonance: 'How hard its edge bites, 0 to 1; higher adds the MS-20\'s grit. It never rings by itself.',
    drive: 'Push into the filter; above 1 adds distortion, below 1 is cleaner and quieter.',
    type: 'lowpass keeps the lows and turns down the highs; highpass does the opposite.'
  },
  diode: {
    fc: 'Cutoff, in Hz: sound above it is turned down, 24 dB per octave.',
    resonance: 'Emphasis at the cutoff, 0 to 1.2: an acid bass\'s squelch; it rings by itself from 1.15.',
    drive: 'Push into the filter; above 1 adds distortion, below 1 is cleaner and quieter.'
  },
  oberheim: {
    fc: 'Cutoff or centre, in Hz: where the filter acts.',
    resonance: 'Emphasis at the cutoff, 0 to 1. Higher rings more.',
    type: 'lowpass keeps the lows, highpass the highs, bandpass a band at the cutoff, notch cuts it.'
  },
  variable: {
    fc: 'Cutoff or centre, in Hz. Moving it while it plays is smoothed, so it does not click.',
    Q: 'Sharpness. Higher is narrower, or adds a peak at the cutoff; 0.7 is smooth.',
    type: 'lowpass keeps the lows, highpass the highs, bandpass a band around the cutoff.'
  },
  resonator: {
    fc: 'The frequency it rings at, in Hz.',
    bw: 'How narrow the ringing is, in Hz. Smaller rings longer and purer; larger is shorter and duller.'
  },
  comb: {
    delay: 'Delay length, in ms; it sets the pitch: 10 ms puts teeth every 100 Hz. Shorter is higher.',
    gain: 'Strength of the delayed copy; negative flips it. Near 1, with feedback, it rings long.',
    type: 'feedforward adds one delayed copy, hollow; feedback keeps re-echoing it, a ringing tone.'
  },
  dcblocker: {
    R: 'Nearer 1 takes only the steady offset, keeping the bass; lower thins the lowest bass.'
  },
  emphasis: {
    alpha: 'How strongly the highs are raised over the lows; 0.97 is the usual setting for speech.'
  },
  deemphasis: {
    alpha: 'How strongly the highs are lowered; the emphasis\'s own value undoes it exactly.'
  },
  integral: {
    leak: 'How fast the total forgets. 1 keeps all and may drift; lower stops drift, thins the lows.'
  },
  // Dynamics
  compressor: {
    threshold: 'Where compression starts, in dB. Louder sound is turned down; lower catches more of it.',
    ratio: 'Ratio. At 4, each 4 dB over the threshold comes out 1 dB over; 20 is near a limiter.',
    knee: 'How gradually it sets in around the threshold: 0 is an abrupt corner, higher is a softer approach.',
    makeup: 'Gain added after compressing, in dB, to bring the level back up.',
    attack: 'How fast it reacts when the level rises. Fast catches short peaks; slow lets them through.',
    release: 'How fast it lets go after the level falls. Fast follows closely; slow sounds smoother.',
    upThreshold: 'Under this level, in dB, quiet sound is lifted toward it. Nothing while upRatio is 1.',
    upRatio: 'How firmly quiet sound is lifted: 1 does nothing; higher brings up detail, and noise.',
    upKnee: 'How gradually the lift sets in: 0 is an abrupt corner, higher is softer.',
    upRange: 'Most the lift can add, in dB, so near-silence is not turned up without end.'
  },
  limiter: {
    ceiling: 'Highest level allowed, in dB. Nothing gets past it; 0 is full scale.',
    lookahead: 'Look ahead, in ms, to ease each peak to the ceiling; longer is smoother, dips before it.',
    release: 'How fast it comes back, in ms. Short is louder but can distort bass; long is smoother.',
    truePeak: 'Keeps peaks between samples under it too, as a dBTP spec asks; it adds about 2 ms.'
  },
  gate: {
    threshold: 'Where the gate opens, in dB. Louder passes; quieter is turned down by the range.',
    closeThreshold: 'Where it closes again, in dB, a few under the threshold, so it does not flutter.',
    range: 'How far it turns sound down while closed, in dB: -90 near silence; -20 leaves a trace.',
    hold: 'How long it stays open after the sound falls, in ms, so it does not chatter on words.',
    attack: 'How fast the gate opens, in ms. Very short keeps the start of each sound; longer fades it in.',
    release: 'How fast the gate closes, in ms. Short cuts the tail off abruptly; long fades it out.',
    lookahead: 'How far ahead it listens, in ms, so it opens before a sound and never clips its start.'
  },
  expander: {
    mode: 'downward sinks quiet sound, a soft gate; upward lifts loud sound back from a squash.',
    threshold: 'Level, in dB, between quiet and loud: downward acts below it, upward above it.',
    ratio: 'How steeply. At 2, each dB under the threshold becomes 2 under; higher nears a gate.',
    knee: 'How gradually it sets in around the threshold: 0 is an abrupt corner, higher is a softer approach.',
    range: 'Most it changes the sound, in dB: how far quiet goes down, or loud goes up.',
    attack: 'How fast it follows the level as it rises, in ms. Short lets a new sound through at once.',
    release: 'How fast it follows a fall, in ms. Short sinks quiet sound quickly; long bridges gaps.'
  },
  deesser: {
    mode: 'What an s turns down. split the highs over the split, band a narrow range, broadband all.',
    split: 'In split mode, where the s range starts, in Hz; a voice\'s s lies above about 3.5 kHz.',
    fc: 'In band mode, where the harsh s sound sits, in Hz. Voices usually have it between 5 and 9 kHz.',
    Q: 'In band mode, the width of the range turned down. Higher is narrower and more precise.',
    threshold: 'How far an s must rise over the voice, in dB, to be cut; not a level. Lower catches more.',
    ratio: 'How firmly the s range is turned down once past the threshold. Higher is stronger.',
    range: 'Most it will turn an s down, in dB. About 6 to 8 tames it; much more and the voice starts to lisp.',
    knee: 'How gradually it sets in around the threshold.',
    attack: 'How fast it reacts when an s begins, in ms.',
    release: 'How fast it lets go after an s ends, in ms.',
    lookahead: 'How far ahead it listens, in ms, so the cut is in place as an s begins.'
  },
  leveler: {
    target: 'Average level each stretch of speech is brought to, in dB, quieter up, louder down.',
    maxGain: 'Most it will turn a stretch up or down, in dB. Stops very quiet parts being raised without end.',
    frame: 'Stretch measured, in seconds: short follows every word, long whole phrases.',
    smooth: 'How many stretches each change is blended across: higher is smoother; 0 follows each.',
    gate: 'Pauses, this many dB under the speech, keep its level, so the room is not raised.'
  },
  'transient-shaper': {
    attackGain: 'Punch, a factor, not dB. Above 0 sharpens each attack, below softens it, -1 removes it.',
    sustainGain: 'Body, a factor, not dB. Above 0 sounds ring and fill out; below, tighter and drier.'
  },
  softclip: {
    curve: 'Its shape. tanh and atan are smooth and warm, sin and cubic firmer, hard flat and harsh.',
    drive: 'Gain before the curve. Higher pushes more into it, more saturated and louder.',
    ceiling: 'Highest level the output reaches, as a share of full scale: 1 is full scale, 0.5 is 6 dB under.',
    oversample: 'The curve run at this many times the rate, against harsh highs; 1 is off.'
  },
  compand: {
    out0: 'Where -90 dB, near silence, comes out, in dB: higher lifts it, lower sinks it.',
    out1: 'Where -60 dB, very quiet, comes out, in dB: higher lifts it, lower sinks it.',
    out2: 'Where -20 dB, a loud passage, comes out, in dB: -20 leaves it, lower turns it down.',
    out3: 'Where 0 dB, the loudest peak, comes out, in dB: under 0 turns peaks down.',
    attack: 'How fast it follows the level when it rises, in ms.',
    release: 'How fast it follows the level when it falls, in ms.'
  },
  unlimit: {
    amount: 'The most it will lift any attack, in dB. This is the strength of the restoring.',
    drive: 'How much missing punch goes back: 1 restores attacks to the target; more overshoots.',
    adaptive: 'On lifts only attacks too weak, as a limiter leaves them; off exaggerates every attack.',
    crestTarget: 'A healthy attack\'s rise over its body, in dB; weaker ones are lifted toward it.',
    ceiling: 'Highest level allowed after the lift, in dB. The top of the range, 24, is out of reach: no limit.',
    fastAttack: 'How fast the quick level follower rises, in ms. It is the one that sees an attack: keep it short.',
    fastRelease: 'How fast the quick level follower falls, in ms.',
    slowAttack: 'How fast the slow level follower rises, in ms. It is what the quick one is compared with.',
    slowRelease: 'How fast the slow level follower falls, in ms.'
  },
  ducker: {
    threshold: 'The other sound\'s level, in dB, over which this one goes down; lower ducks on quieter.',
    ratio: 'How firmly this sound is turned down once the other passes the threshold. Higher is stronger.',
    knee: 'How gradually it sets in around the threshold: 0 is an abrupt corner, higher is a softer approach.',
    range: 'Most this sound is turned down, in dB. -24 leaves it clearly there under the other; -90 mutes it.',
    attack: 'How fast this sound gives way when the other begins, in ms.',
    release: 'How slowly it comes back after the other stops, in ms: short may pump; long is smoother.'
  },
  multiband: {
    low: 'Where the low band ends, in Hz. Sound below it is compressed on its own.',
    high: 'Where the high band starts, in Hz; between it and the low band\'s end is the mid band.',
    threshold: 'Level, in dB, where compression starts in each of the three bands. Lower catches more.',
    ratio: 'How firmly each band is turned down above the threshold. Higher is stronger.',
    upThreshold: 'Under this level, in dB, quiet sound in each band is lifted. Nothing while upRatio is 1.',
    upRatio: 'How firmly quiet sound is lifted: 1 does nothing; higher brings up detail, and noise.',
    depth: 'How much of the change is made: 0 none, 1 as set, 2 doubles every change in dB.',
    attack: 'How fast it reacts when the level rises. Fast catches short peaks; slow lets them through.',
    release: 'How fast it lets go after the level falls. Fast follows closely; slow sounds smoother.',
    makeup: 'Gain added after compressing, in dB, to bring the level back up.'
  },
  fet: {
    threshold: 'Where compression starts, in dB. Louder sound is turned down; lower catches more of it.',
    ratio: 'How firmly louder sound goes down; a FET works high: 4 is firm, 20 nearly a limiter.',
    knee: 'How gradually it sets in around the threshold: 0 is an abrupt corner, higher is a softer approach.',
    makeup: 'Gain added after compressing, in dB, to bring the level back up.',
    attack: 'How fast it reacts, in ms; a FET is quick enough to catch peaks under a millisecond.',
    release: 'How fast it lets go after the level falls. Fast follows closely; slow sounds smoother.'
  },
  opto: {
    threshold: 'Where compression starts, in dB. Louder sound is turned down; lower catches more of it.',
    ratio: 'How firmly louder sound goes down; an optical compressor stays gentle, 3 its own.',
    knee: 'How gradually it sets in; an optical\'s wide soft knee makes the start hard to hear.',
    makeup: 'Gain added after compressing, in dB, to bring the level back up.',
    attack: 'How fast it reacts when the level rises, in ms. Slow enough to let the start of a note through.'
  },
  varimu: {
    threshold: 'Where compression starts, in dB. Louder sound is turned down; lower catches more of it.',
    knee: 'How gradually it sets in; the ratio itself grows the further sound is over the threshold.',
    attack: 'How fast it reacts when the level rises, in ms. Slow, so the start of notes passes.',
    release: 'How fast it lets go after the level falls. Fast follows closely; slow sounds smoother.',
    makeup: 'Gain added after compressing, in dB, to bring the level back up.'
  },
  vca: {
    threshold: 'Where compression starts, in dB. Louder sound is turned down; lower catches more of it.',
    ratio: 'Ratio. At 4, each 4 dB over the threshold comes out 1 dB over; 20 is near a limiter.',
    knee: 'How gradually it sets in. 0 is an abrupt corner; a VCA compressor\'s is nearly hard.',
    makeup: 'Gain added after compressing, in dB, to bring the level back up.',
    attack: 'How fast it reacts when the level rises. Fast catches short peaks; slow lets them through.',
    release: 'How fast it lets go after the level falls. Fast follows closely; slow sounds smoother.'
  },
  auto: {
    type: 'What the sound is, speech, music or both; it picks the fixes and the loudness aimed for.',
    intensity: 'Strength of the fixes. 0 lightest, 1 as measured, 2 stronger; hum and clicks always go.',
    targetLufs: 'Loudness to aim for, in LUFS. 0 picks one for the type: -16 for speech, -14 for music.',
    ceiling: 'Highest peak allowed after levelling, in dB. -1 leaves room for streaming encoders.'
  },
  // Repair
  denoise: {
    reduction: 'How far the noise goes down, in dB; more risks a hollow, watery sound. 0 leaves it.',
    threshold: 'Noise taken as this many dB louder than learned: above 0 more goes, below 0 more stays.'
  },
  omlsa: {
    gMin: 'Most the noise goes down, in dB; more negative removes more, risks a watery voice.',
    threshold: 'Noise taken as this many dB louder than it seems: above 0 more goes, a voice\'s edges too.',
    alphaDD: 'Smoothing in time. Higher warbles less but is slower to catch the start of a word.',
    qPrior: 'How likely a moment is only noise: 0 finds it from the sound; from 0.9 up, all is noise.',
    xiFloor: 'Lowest signal-to-noise it assumes, in dB: lower takes more faint sound, higher spares it.'
  },
  recover: {
    cutoff: 'Where the take\'s highs end, in Hz, rebuilt above it. Unset, found where they fall away.'
  },
  deepfilter: {
    limit: 'Most the noise goes down, in dB; past 18 a voice sounds filtered. The last stop lifts the limit.',
    music: 'pass cleans speech and leaves music as it is; enhance cleans everything, dulling music.',
    floor: 'In pauses, noise the limit leaves nearer the voice than this, in dB, goes this far under; 0 is off.'
  },
  rnnoise: {
    limit: 'Most the noise goes down, in dB, so the model spares the voice; at 0 nothing is taken.',
    music: 'pass cleans speech and leaves music, after its first second or so; enhance cleans all.'
  },
  wiener: {
    rule: 'How much to remove is worked out. mmse-lsa leaves less warbling; wiener is the classic.',
    alphaDD: 'Smoothing in time. Higher warbles less but is slower to catch the start of a word.',
    xiFloor: 'Roughly how far the noise can go down, in dB; more negative removes more, more hollow.'
  },
  specsub: {
    alpha: 'Over-subtraction. Taking more than the noise leaves less of it, more warble; 0 picks it.',
    beta: 'Noise left, as a share of its power: 0.05 keeps 5%; more hides the warble as a hiss.'
  },
  dehum: {
    freq: 'The hum, in Hz, 50 or 60 for mains; 0 measures it. A set value is tuned within 0.4%.',
    harmonics: 'How many of the hum\'s multiples go; 0, all to 1 kHz and those that stand out to 8 kHz.',
    adaptive: 'With a set frequency, looks within half a hertz, not 0.4%: for a tape at the wrong speed.',
    tones: 'Also steady tones held through the take, not the hum\'s: a whine, a test tone, 15.7 kHz.'
  },
  roomtone: {
    threshold: 'Silence level. Quieter stretches count as digital silence, filled with the room\'s tone.'
  },
  azimuth: {
    delay: 'How late the second channel is, in ms, moved onto the first. Unset, measured as it goes.'
  },
  dewow: {
    mode: 'How the speed is read. partial off the notes, reference a steady tone, pitch one voice.',
    refFreq: 'The steady tone reference mode reads, in Hz: a pilot, or 50 or 60 for hum; 0 finds it.',
    smooth: 'Where wow ends and flutter begins, in seconds: slower changes are wow, faster flutter.',
    maxDeviation: 'The most the speed may be off, as a share: 0.05 is 5%; no correction goes further.',
    wow: 'Correct the slow speed changes: a warped or off-centre record, a stretched tape.',
    flutter: 'Correct fast speed changes, a tape\'s capstan and rollers; read from a steady tone only.'
  },
  rebalance: {
    vocals: 'The singing, in dB. 0 leaves it, -60 all but takes it out (karaoke); higher brings it up.',
    bass: 'Level of the bass, in dB. 0 leaves it; lower thins the low end, higher thickens it.',
    drums: 'The drums and percussion, in dB. 0 leaves them; lower softens the beat, higher punches.',
    other: 'The rest (guitars, keys, strings, pads), in dB: 0 leaves it, -60 all but takes it out.'
  },
  scene: {
    dialogue: 'The speech, in dB. Higher lifts it over the rest; -60 leaves a music and effects track.',
    music: 'The score and any songs, in dB. Lower makes room for the dialogue; -60 all but removes it.',
    effects: 'All else, footsteps to rain and the room, in dB: lower quiets the scene around the voices.',
    model: 'mrx is quick, a fifth of real time; tiger parts music and effects far better, 50× slower.'
  },
  deconstruct: {
    tonal: 'The tones (held notes, hum, vowels), in dB: 0 leaves them; -60 all but removes them.',
    noise: 'The noise, neither tone nor attack (hiss, breath, room), in dB: 0 leaves it, lower less.',
    transient: 'The attacks (clicks, consonants, drum hits), in dB: lower softens them, higher sharpens.',
    separation: 'How strict the split is. 1 parts all into tones or attacks; higher leaves more to noise.'
  },
  declick: {
    threshold: 'Detection threshold. How far a click stands out of the sound; lower finds fainter ones.',
    longest: 'Longest click rebuilt, in ms; a longer burst is taken for real sound, unless selected.',
    order: 'Model detail. How many samples predict the next; higher follows pitch better, slower.'
  },
  decrackle: {
    threshold: 'Detection threshold. How far a tick stands out of the sound; lower finds fainter crackle.',
    order: 'Model detail. How many samples either side predict each; higher follows pitch, slower.'
  },
  declip: {
    clipLevel: 'Where it was cut flat, as a share of full scale; 0 finds it and spares an uncut sound.',
    order: 'Model detail. How many samples predict the wave across a cut; higher is richer, slower.'
  },
  dereverb: {
    reduction: 'How far the room\'s echo goes down, in dB: 60 takes it all; 12 leaves a hint of it.',
    music: 'pass takes the room off speech alone, its bed too; enhance takes all that is not a voice.',
    method: 'roformer, a 60 MB model, takes the whole room; wpe needs none, takes 6 dB of late echo.'
  },
  restore: {
    strength: 'How much of the model\'s take. 1 its alone; lower mixes the take as it came back in.'
  },
  vocos: {
    crossover: 'Above this, in Hz, the sound is kept as it came: the vocoder makes nothing over 12 kHz.'
  },
  deplosive: {
    triggerRatio: 'How much stronger a pop\'s thump is than the voice: lower catches more; pitched lows pass.',
    attenuation: 'How far the low end is turned down during a pop, in dB.',
    crossover: 'Under this, in Hz, pops are found and turned down; between pops nothing is touched.',
    attack: 'How fast the low end is turned down once a pop is found.',
    release: 'How slowly the low end comes back after a pop. Longer is smoother.'
  },
  dewind: {
    attenuation: 'How far the wind goes down, in dB; a voice\'s harmonics over it stay. 0 takes nothing.',
    cutoff: 'Wind is taken up to this, in Hz; strong wind rushes to several kHz. Above, nothing.'
  },
  debreath: {
    range: 'How far each breath goes down, in dB, above 300 Hz, never under the room; -12 softens it.',
    room: 'The rest of each pause, in dB. 0 leaves it natural; lower makes it quieter, then dead.',
    attack: 'How long before speech the volume comes back, so a word\'s start is never cut.',
    release: 'How slowly the cut comes after speech ends: longer is smoother, shorter catches sooner.'
  },
  derustle: {
    reduction: 'How far under the voice a clip-on mic\'s rustle goes, in dB; 0 only to the room\'s tone.',
    ambience: 'Keeps the room\'s air and hum, 12 dB down, where rustle goes; off leaves silence there.'
  },
  desqueak: {
    squeak: 'Most a string squeak goes down, in dB; the notes under it stay. 0 leaves squeaks.',
    pick: 'Most a pick\'s click is softened, in dB, to the note\'s level after; -9 tames sharp ones.',
    amp: 'The amp\'s hiss, hum and buzz, in dB, learned where it is alone; -20 is typical.'
  },
  debleed: {
    attenuation: 'How far the bleed cancelling leaves goes down, in dB; lower takes more; 0 only cancels.',
    span: 'How long a stretch of the room is learned, in seconds; a bigger, echoing room wants more.'
  },
  defeedback: {
    notches: 'How many howl frequencies it cuts at once; when all are used, the shallowest is replaced.',
    Q: 'Width of each cut. Higher spares the sound around a howl, but a drifting howl slips past.',
    strength: 'How fast each cut deepens while a howl lasts: 1 is 9 dB a step, to 24; 0 does nothing.'
  },
  spectral: {
    gain: 'The selected band, in dB: -60 removes it, above 0 boosts it.'
  },
  // Time & pitch
  speed: {
    rate: 'Playback speed. 2 is twice as fast and an octave higher; 0.5 is half as fast and an octave lower.'
  },
  stretch: {
    method: 'phase-lock plays as it works; wsola for a voice, transient for drums, sms for held tones.'
  },
  pitch: {
    semitones: 'Pitch change in semitones. 12 is an octave up, -12 an octave down; the length stays.',
    method: 'phase-lock plays as it works; formant or psola keep a voice; transient drums; auto picks.'
  },
  intonation: {
    factor: 'How far the pitch strays from its middle: 1 leaves it, 0 is a monotone, 2 twice as wide.'
  },
  modulation: {
    factor: 'How wide each note\'s vibrato swings: 1 leaves it, 0 is smooth, 2 twice, -1 turns it over.'
  },
  drift: {
    factor: 'How far each note\'s slow line wanders: 1 leaves it, 0 holds its centre, 2 twice as far.'
  },
  center: {
    factor: 'How far each note\'s centre stays off its note: 1 leaves it, 0 on it; its vibrato stays.',
    scale: 'Which notes a centre may land on. chromatic every note, the others the scale at the root.',
    root: 'The scale\'s first note, in semitones up from C: 0 C, 2 D, 7 G, 9 A; not for chromatic.'
  },
  formant: {
    semitones: 'Formants moved, the pitch staying. Up a smaller, brighter voice, down darker; 3 is a lot.'
  },
  tune: {
    scale: 'Which notes it lands on. chromatic all, fixing only what is off; else the root\'s scale.',
    root: 'The scale\'s first note, in semitones up from C: 0 C, 2 D, 7 G, 9 A; not for chromatic.',
    a4: 'The A above middle C, in Hz, that every note is worked out from; 440 is standard.',
    tolerance: 'How far off a note may be, in cents, before it is corrected; closer is left as sung.',
    strength: 'How much of the correction. 1 snaps each note exactly, less part way, 0 does nothing.',
    speed: 'How long it may stray, in ms. 0 holds it on the note, stepped; 80 keeps the vibrato.'
  },
  resample: {
    rate: 'The new sample rate, in Hz. A lower rate keeps less of the high frequencies.'
  },
  // Effect
  delay: {
    time: 'The gap between the sound and its echo, in seconds.',
    feedback: 'How much of each echo feeds the next: 0 a single echo; higher a longer, slower trail.',
    sync: 'The gap as a note value at the tempo (1/4, 1/8d, 1/8t), not a time. off leaves the time.'
  },
  pingpong: {
    time: 'The gap between echoes, in seconds. Each echo lands on the other side.',
    feedback: 'How much of each echo feeds the next, on the other side; higher gives more bounces.',
    sync: 'The gap as a note value at the tempo, 2 s at the most, not a time. off leaves the time.'
  },
  multitap: {
    feedback: 'How much of the echoes feeds back: 0 the two set echoes only; higher adds a trail.'
  },
  chorus: {
    rate: 'How fast the copies drift in timing, in cycles per second. Slow is lush; fast is wobbly.',
    depth: 'How far the copies drift in timing, 0 to 1. More detunes them further; 0 gives no thickening.',
    delay: 'How far behind the copies run, in seconds: 10 to 30 ms is chorus; longer, a double.',
    voices: 'How many detuned copies are blended in. More sounds thicker, like a bigger ensemble.',
    phase: 'Each channel\'s copies against the one before\'s, in degrees: 90 spreads wide; 0 moves as one.'
  },
  flanger: {
    rate: 'How fast the sweep goes, in cycles per second: slow is a long whoosh, fast a warble.',
    depth: 'How far the sweep reaches, 0 to 1. More is a wider, more obvious whoosh.',
    delay: 'Centre delay of the sweep, in seconds: a few ms is the jet sound; longer nears a chorus.',
    feedback: 'How much feeds back into itself: higher is a fiercer whoosh with a metallic ring.',
    phase: 'Each channel\'s sweep ahead of the one before, in degrees: 90 spreads it wide; 0 moves as one.'
  },
  phaser: {
    rate: 'How fast the sweep goes, in cycles per second: slow is a long whoosh, fast a warble.',
    depth: 'How far the sweep reaches around the centre frequency, 0 to 1.',
    stages: 'How many filter stages swirl it: more notches and a deeper, more complex swirl.',
    feedback: 'How much feeds back into itself: higher is a stronger, more resonant swirl.',
    fc: 'Centre of the sweep, in Hz: the swirl moves around this pitch region.',
    phase: 'Each channel\'s sweep ahead of the one before, in degrees: 90 spreads it wide; 0 moves as one.'
  },
  tremolo: {
    rate: 'How many pulses of volume per second.',
    depth: 'How far the volume dips on each pulse: 0 is none, 1 dips to silence.',
    phase: 'Each channel\'s pulse ahead of the one before, in degrees: 0 together; 180 is an auto-pan.'
  },
  vibrato: {
    rate: 'How fast the pitch wobbles, in cycles per second.',
    depth: 'How wide the pitch wobbles, 0 none, 1 the widest; a faster rate widens it further.',
    phase: 'Each channel\'s wobble ahead of the one before, in degrees: 0 together; 180 swings pitches apart.'
  },
  autowah: {
    base: 'Lowest position of the filter, in Hz: where it rests when the sound is quiet.',
    range: 'How far above the base the filter opens when the sound is loud, in Hz.',
    Q: 'Sharpness of the filter. Higher is a more pronounced, vowel-like wah; lower is mild.',
    attack: 'How fast the filter opens when the sound gets louder. Short snaps open on every note.',
    release: 'How slowly the filter closes after the sound fades.',
    sens: 'How strongly the sound level moves the filter. Higher opens it further for the same volume.'
  },
  wah: {
    rate: 'How fast the filter sweeps up and down in auto mode, in cycles per second.',
    depth: 'How far the sweep reaches each way around the centre, in octaves. Auto mode only.',
    fc: 'Centre of the sweep, in Hz. In manual mode, where the filter is held still.',
    Q: 'Sharpness of the filter. Higher is a narrower, more vocal wah.',
    mode: 'auto sweeps at the rate; manual holds the filter at the centre, like a pedal left still.',
    phase: 'In auto mode, each channel\'s sweep ahead of the one before, in degrees: 0 together; 180 opposite.'
  },
  rotary: {
    hornSpeed: 'How fast the treble horn spins, in turns per second. 0.8 is the slow setting, 6.7 the fast one.',
    drumSpeed: 'How fast the bass drum spins, in turns per second. 0.7 is the slow setting, 5.9 the fast one.',
    depth: 'How strong the swirl of pitch and volume is, 0 to 1. 0 is none.',
    crossover: 'Where the sound splits, in Hz. Under it turns with the bass drum, over with the horn.',
    hornInertia: 'How long the horn takes to spin up, in seconds; from rest, the swirl builds over it.',
    drumInertia: 'How long the heavier bass drum takes to spin up to its speed, in seconds.',
    micSpread: 'Angle between the two mics, in radians: wider spreads the swirl; 1.57 is a quarter turn.'
  },
  ringmod: {
    fc: 'The tone it is multiplied by, in Hz: a few Hz pulse, a tremolo; higher bell-like, robotic.'
  },
  freqshift: {
    shift: 'Every frequency moved by this many Hz, up or down; harmonics break, voices turn metallic.',
    taps: 'The shifting filter\'s length: more follows the lows more truly, fewer is faster.'
  },
  graindelay: {
    time: 'Base delay before the grains play, in seconds.',
    spray: 'Random extra delay on each grain, in seconds, up to this; more scatters and blurs echoes.',
    pitch: 'Each grain transposed, in semitones; through feedback, echoes climb or fall in steps.',
    jitter: 'Random pitch on each grain, in semitones either way; more is shimmery, out of tune.',
    grain: 'Length of each grain, in seconds: short is grainy, long keeps the sound\'s shape.',
    feedback: 'How much of the grains feeds back to make more. Higher gives a longer, smeared trail.'
  },
  stutter: {
    interval: 'How often a slice is captured and repeated, in seconds.',
    slice: 'Length of the captured piece, in seconds: the part repeated for the rest of the interval.',
    decay: 'How much quieter each repeat gets, 0 to 1. 0 repeats at full level; higher fades them away.'
  },
  tapestop: {
    at: 'When the tape starts to stop (or start), in seconds from the beginning.',
    time: 'How long the slowdown (or speed-up) takes, in seconds.',
    curve: 'Its shape. 1 is steady, a brake; above 1 quick, then crawling; below 1 held, then falling.',
    direction: 'stop slows the sound to a halt; start winds it up from a standstill.',
    flutter: 'Random wobble in speed while it changes, 0 to 1, for a worn, unsteady tape.'
  },
  bitcrusher: {
    bits: 'Bits per sample. Fewer is grittier, 8 an old console\'s crunch; 1 passes only over half.',
    rate: 'Share of the rate kept. Lower holds each sample longer, aliased and lo-fi; 1 is all.'
  },
  lofi: {
    wow: 'Slow drift in pitch, as from an uneven tape or record, 0 to 1.',
    flutter: 'Fast, small wobble in pitch, 0 to 1.',
    noise: 'Level of the hiss in the background, 0 to 1.',
    crackle: 'How much vinyl crackle there is, in pops and ticks, 0 to 1.',
    lowpass: 'Top of the sound, in Hz, as old tape or radio rolls off its highs; lower is duller.',
    highpass: 'Bottom of the sound, in Hz, as a small speaker cuts its lows; higher is thinner.',
    drive: 'Tape saturation, 0 to 1. More rounds and warms the peaks.'
  },
  slew: {
    rise: 'Steepest rise allowed, in full scale per second; lower rounds sharp rises, duller.',
    fall: 'Steepest fall allowed, in full scale per second; lower rounds sharp falls, duller.'
  },
  noiseshaper: {
    bits: 'The bit depth rounded to; its noise pushed up to the highs, where it is least heard.'
  },
  codec: {
    format: 'The codec heard. Apple Music streams aac, Spotify\'s apps vorbis, YouTube opus and aac.',
    bitrate: 'Data per second, in kbps; lower smears attacks, cuts the top. 256 is near the original.'
  },
  // Color
  distortion: {
    drive: 'How hard the sound is pushed into the distortion, 0 to 1. More is grittier and louder.',
    type: 'soft and tanh round the peaks, hard flattens them, foldback bends them back, a buzz.'
  },
  tube: {
    drive: 'How hard the sound is pushed into the tube. More adds warmth, then crunch.',
    bias: 'Lopsidedness, 0 to 1. More adds even harmonics, the warm tube sound; 0 odd ones only.'
  },
  tape: {
    drive: 'How hard it is pushed into the tape: more adds warmth, then compression and crunch.',
    warmth: 'Softening of the highs, like the loss at a tape head, 0 to 1. More is darker and warmer.'
  },
  transistor: {
    drive: 'How hard the sound is pushed into the console stage. More adds firm, punchy odd harmonics.'
  },
  waveshaper: {
    drive: 'How hard it is pushed into a smooth clipping curve; more nears hard clipping.'
  },
  multisat: {
    low: 'Where the low band ends, in Hz. Each of the three bands is saturated on its own.',
    high: 'Where the high band starts, in Hz. What is between is the mid band.',
    drive: 'How hard each band is pushed into the tube saturation. More adds warmth, then crunch.'
  },
  exciter: {
    fc: 'New harmonics are made above this, in Hz: higher adds only air, lower presence too.',
    drive: 'How hard the highs are pushed to make harmonics, 0 to 1. More is brighter and edgier.',
    amount: 'How much of the added harmonics is mixed in, 0 to 1. The original sound stays at full level.'
  },
  subbass: {
    fc: 'Top of the bass built from, in Hz, turned into harmonics small speakers can play.',
    amount: 'How much of the added harmonics is mixed in, 0 to 1.',
    drive: 'How hard the bass is pushed to make harmonics, 0 to 1. More is stronger and grittier.',
    keep: 'Deep bass kept. 1 all of it, 0 the harmonics alone, for speakers that cannot play it.'
  },
  sbr: {
    fc: 'Where the real sound ends, in Hz, as 16 kHz in a low-bitrate MP3; highs rebuilt above.',
    amount: 'How much of the rebuilt highs is added, 0 to 1.',
    drive: 'How hard the band is pushed to make the highs, 0 to 1: more is brighter, rougher.'
  },
  amp: {
    gain: 'How hard the preamp is driven, 0 to 1. More is a harder, more distorted tone.',
    bass: 'Boost or cut of the lows (around 120 Hz), in dB.',
    mid: 'Boost or cut of the mids (around 650 Hz), in dB.',
    treble: 'Boost or cut of the highs (around 3.2 kHz), in dB.',
    level: 'How loud it comes out of the amp, 0 to 1. It does not change the tone.'
  },
  cabinet: {
    mix: 'Does nothing yet: the speaker simulation is always fully applied.'
  },
  // Reverb
  freeverb: {
    room: 'Room size, 0 to 1. Higher is a bigger room with a longer tail.',
    damp: 'How fast the highs die in the tail, 0 to 1: higher darker, lower brighter and metallic.'
  },
  plate: {
    decay: 'How long the reverb rings, 0 to 1. Higher is a longer tail.',
    damping: 'How fast the highs die in the tail, 0 to 1: higher darker, lower brighter and metallic.'
  },
  fdn: {
    decay: 'How long the reverb rings, from about 0.3 seconds at 0 to over 5 seconds at 1.',
    damping: 'How fast the highs die in the tail, 0 to 1: higher darker, lower brighter and metallic.'
  },
  spring: {
    decay: 'How long the reverb rings, 0 to 1. Higher is a longer tail.',
    tension: 'The boing, 0 to 1. Higher parts highs from lows in time, a chirp on every sound.',
    damping: 'How fast the highs die in the tail, 0 to 1: higher darker, lower brighter and metallic.'
  },
  shimmer: {
    decay: 'How long the reverb rings, 0 to 1. Higher is a longer tail.',
    shimmer: 'How much of the tail climbs an octave each pass, 0 to 1: more rises, a choir; 0 is plain.',
    damping: 'How fast the highs die in the tail, 0 to 1: higher darker, lower brighter and metallic.'
  },
  schroeder: {
    decay: 'How long the reverb rings. Near the top it rings for a very long time.',
    damping: 'How fast the highs die in the tail, 0 to 1: higher darker, lower brighter and metallic.'
  },
  // Space
  vocals: {
    mode: 'isolate keeps the centre of a stereo mix, where vocals usually sit; remove takes the centre out.'
  },
  widener: {
    width: 'Stereo width. 0 is mono, 1 as it is, higher wider; very high sounds hollow in mono.'
  },
  haas: {
    time: 'How long one side is delayed, in ms; under 35 ms it is heard as one wider sound.',
    channel: 'Which side is delayed. The sound seems to lean toward the other side.'
  },
  panner: {
    pan: 'Where between the speakers: -1 left, 0 centre, 1 right; it is first summed to mono.'
  },
  autopan: {
    rate: 'How fast it sweeps left and right, in cycles per second; it is first summed to mono.',
    depth: 'How far it sweeps: 0 stays in the centre, 1 goes right out to each side.'
  },
  midside: {
    mode: 'encode turns left and right into mid and side, to process apart; decode turns them back.',
    width: 'In decode mode, how wide the stereo is. 1 leaves it, 0 is mono, higher is wider.'
  },
  microshift: {
    cents: 'Left shifted up and right down, in cents; a few widen it without going out of tune.'
  },
  binaural: {
    azimuth: 'Direction, in degrees. 0 ahead, 90 right, -90 left, 180 as 0. Best on headphones.',
    distance: 'How far away the sound is, in metres. It only turns the level down: 2 m is half as loud as 1 m.',
    headRadius: 'Size of the head, in metres. Larger puts more delay between the ears; 0.0875 an adult.'
  },
  surround: {
    delay: 'How far the rears lag the front, in ms, so they stay ambience behind the front image.',
    lfeCut: 'Top of the subwoofer channel, in Hz. Bass under it is sent there.'
  },
  crossfeed: {
    freq: 'Only sound below this frequency leaks to the other ear.',
    level: 'How much of the other side is mixed into each ear: 0 is none, 0.5 is an even mix.'
  },
  // Generate
  osc: {
    freq: 'Pitch of the tone, in Hz. 440 is the note A.',
    detune: 'Moves the pitch off by this many cents (hundredths of a semitone). 100 is one semitone.',
    gain: 'How loud it plays, from silent (0) to full scale (1).',
    type: 'sine is pure, triangle soft, square hollow and buzzy, sawtooth bright and full.'
  },
  noise: {
    color: 'white is a bright hiss, pink like rain, brown a deep rumble; blue and violet thinner.',
    gain: 'How loud it plays, from silent (0) to full scale (1).'
  },
  chirp: {
    f0: 'Where the sweep starts, in Hz.',
    f1: 'Where the sweep ends, in Hz.',
    method: 'exp spends equal time in each octave, an even rise; linear most of it in the highest.'
  },
  pluck: {
    freq: 'Pitch of the string, in Hz.',
    damp: 'How slowly the string dies away. Closer to 1 rings longer; lower is a short, dull pluck.',
    seed: 'The start of the noise that plucks it: the same number always sounds the same.'
  },
  kick: {
    freq: 'The pitch the kick settles to, in Hz. Lower is a deeper boom.',
    drop: 'Where it starts over its pitch: at 3, four times higher, then falls; more is clickier.'
  },
  cymbal: {
    freq: 'Base pitch of the metallic tones, in Hz. Lower is a bigger, deeper crash; higher is a thinner ping.'
  },
  risset: {
    freq: 'Base pitch, in Hz; inharmonic partials ring above it, a soft tone an octave below.'
  },
  rhythm: {
    bpm: 'Tempo, in beats per minute.',
    beats: 'Beats in each bar. The first beat of every bar gets the accent pitch and is louder.',
    freq: 'Pitch of the ordinary clicks, in Hz.',
    accentFreq: 'Pitch of the accented click on the first beat of each bar, in Hz.'
  },
  sfx: {
    preset: 'Which game sound, from a pickup or a coin to a laser or an explosion.'
  },
  fm: {
    freq: 'Pitch of the tone, in Hz. 440 is the note A.',
    ratio: 'The modulator\'s speed against the main tone: whole numbers musical, others bells, metal.',
    index: 'How hard the modulator bends the tone, in radians: 0 a sine; more, brighter overtones.',
    indexDecay: 'How fast the brightness fades, in seconds: 0 holds it; a few seconds, a struck bell.',
    indexFloor: 'The index the brightness fades down to, in radians. Has no effect while indexDecay is 0.',
    feedback: 'The modulator fed back into itself, in radians: a little adds a saw\'s edge; much is noise.',
    attack: 'How long the tone takes to fade in at the start, in seconds.',
    release: 'How long the tone takes to fade out at the end, in seconds.'
  },
  modal: {
    freq: 'Pitch of the lowest ringing mode, in Hz.',
    model: 'What is struck. A string, bar (marimba), membrane (drum), plate (gong) or a tube.',
    nmodes: 'How many overtones ring together. More makes a richer, more complex tone.',
    t60: 'How long the lowest tone rings, in seconds, until it has faded by 60 dB.',
    damping: 'How much sooner high overtones die than low: 0 as long as the lowest; higher, mellower.',
    inharmonicity: 'String stiffness, overtones out of tune as a piano\'s; 0 a perfect string. String only.',
    strike: 'Where it is struck, 0 to 1. The middle full, near an end thin; not for membrane or plate.',
    exciter: 'What strikes it. impulse is a single sharp hit; noise a short burst, rougher and brushed.',
    seed: 'The start of the noise burst, with the noise exciter: the same number, the same hit.'
  },
  voice: {
    type: 'sine is pure, triangle soft, square hollow and buzzy, sawtooth bright and full.',
    attack: 'How long the sound takes to rise from silence to full level, in seconds.',
    decay: 'How long it then takes to fall to the sustain level, in seconds.',
    sustain: 'The level held while the note lasts, a share of full: 1 full, 0 dies after the decay.',
    release: 'How long the sound takes to fade out at the end, in seconds.',
    fc: 'Cutoff of its low-pass filter, in Hz: how bright it sounds; lower is duller.',
    envAmount: 'How much each note\'s envelope moves the filter: 0 still; 1 opens it at the note\'s start.'
  },
  poly: {
    voices: 'The most notes that can sound at once. When all are in use, the oldest is cut off for a new one.',
    type: 'sine is pure, triangle soft, square hollow and buzzy, sawtooth bright and full.'
  },
  adsr: {
    attack: 'How long the sound takes to rise from silence to full level, in seconds.',
    decay: 'How long it then takes to fall to the sustain level, in seconds.',
    sustain: 'The level held while the note lasts, a share of full: 1 full, 0 dies after the decay.',
    release: 'How long the sound takes to fade out at the end, in seconds.'
  }
}

// A setting's tooltip: its op's words, else its name's; undefined where there are none.
export const help = (op, name) => texts[op]?.[name] ?? texts['*'][name]

// A setting's line, in a few words under its control, where its op's docs say what it is (README, fn/): the Silence
// kind's for now; none where nothing is written, rather than one made up
const lines = {
  trim: { threshold: 'quieter than this at either end is cut; unset, found from the sound' },
  shrink: { gap: 'a pause longer than this is cut to it; 0 takes pauses out', threshold: 'quieter than this counts as a pause; unset, found from the sound', crossfade: 'each cut faded over this long; 0, a hard cut' },
  pad: { before: 'silence added before the start', after: 'silence added after the end' },
  insert: { at: 'where the silence goes in; what follows moves later' }
}
export const line = (op, name) => lines[op]?.[name]

// An op's settings by name, `names` as its manifest gives them: [those the card shows, those under Advanced]. A setting
// the layout does not name is shown.
export function layout(op, names) {
  const [front = '', more = ''] = (layouts[op] ?? '').split('|'), pick = s => s.split(/\s+/).filter(n => names.includes(n)), shown = pick(front), folded = pick(more)
  return [[...shown, ...names.filter(n => !shown.includes(n) && !folded.includes(n))], folded]
}
