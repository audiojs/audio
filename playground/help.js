// What each setting does, for someone who has not read a manual: the tooltip over a slider's label (stack.js), and which
// settings a card shows first. A text says what the setting is, what it does to the sound and which way to move it, with a
// plain name first where its label is cryptic. By op and setting; `*` is what a setting of that name means in every op that
// has it. The tests keep every setting of every op in here, built-in and plugin alike, and nothing that is not one.

// The settings a card shows, in order, and after `|` those it folds under Advanced: the engine's own, and those few touch. An
// op not listed shows them all.
export const layouts = {
  compressor: 'threshold ratio attack release knee makeup | upThreshold upRatio upKnee upRange',
  gate: 'threshold range release | closeThreshold hold attack lookahead',
  deesser: 'mode fc threshold range | ratio Q knee attack release',
  expander: 'threshold ratio range | mode knee attack release',
  leveler: 'target maxGain | frame smooth gate',
  unlimit: 'amount | drive adaptive crestTarget ceiling fastAttack fastRelease slowAttack slowRelease',
  ducker: 'threshold range attack release | ratio knee',
  debleed: 'attenuation | span',
  multiband: 'low high threshold ratio makeup | upThreshold upRatio depth attack release',
  dyneq: 'mode fc Q threshold ratio maxGain | attack release',
  dehum: 'freq harmonics | adaptive',
  omlsa: 'gMin | alphaDD qPrior xiFloor',
  deplosive: 'attenuation triggerRatio crossover | attack release',
  dewind: 'attenuation | cutoff',
  declick: 'threshold | longest order',
  decrackle: 'threshold | order',
  declip: 'clipLevel | order',
  debreath: 'range | attack release',
  phaser: 'rate depth feedback | stages fc',
  autowah: 'sens base range Q | attack release',
  graindelay: 'time pitch feedback mix | grain spray jitter',
  rotary: 'hornSpeed drumSpeed depth mix | crossover hornInertia drumInertia micSpread',
  'pitch-shift': 'semitones content formant | method',
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
    seed: 'The starting point of its random choices: the same number always gives the same result, another gives another take.',
    factor: 'Length. 2 makes it twice as long and 0.5 half as long; the pitch stays.'
  },
  // Edit
  trim: {
    threshold: 'Silence level, in dB. Audio quieter than this at the start and the end is cut away. Left unset, it is found from the sound itself.'
  },
  shrink: {
    gap: 'Longest pause kept, in seconds. A pause longer than this is cut down to it.',
    threshold: 'Silence level, in dB. Audio quieter than this counts as a pause. Left unset, it is found from the sound itself.'
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
    value: 'Volume change. Above 0 is louder, below 0 quieter; every 6 dB doubles or halves the size of the wave.'
  },
  normalize: {
    target: 'Level to bring the sound to, in dB: the loudest peak in peak mode, the overall loudness in lufs mode, the average level in rms mode.',
    mode: 'What is measured to reach the target: the loudest peak, the perceived loudness (lufs, as streaming services measure it) or the average level (rms).'
  },
  fade: {
    in: 'Fade in. How long the start takes to come up from silence, in seconds.',
    out: 'Fade out. How long the end takes to die away to silence, in seconds.',
    curve: 'Shape of the fade. Linear changes the level evenly, cos eases at both ends, exp stays nearer silence for longer, log stays nearer full level.'
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
    curve: 'How the two trade places. equal keeps the loudness steady when the sounds differ; cos and linear suit the same or similar sounds, and dip a little for different ones.'
  },
  remix: {
    channels: 'How many channels the sound ends up with: 1 is mono, 2 is stereo.'
  },
  dither: {
    bits: 'The bit depth you are going down to. Dither adds a whisper of noise so rounding to fewer bits sounds smooth, not grainy.'
  },
  // Filter
  highpass: {
    freq: 'Cutoff. Sound below this frequency is turned down.',
    order: 'Steepness. How sharply sound past the cutoff falls away: 2 is gentle (12 dB per octave), 8 is steep (48).'
  },
  lowpass: {
    freq: 'Cutoff. Sound above this frequency is turned down.',
    order: 'Steepness. How sharply sound past the cutoff falls away: 2 is gentle (12 dB per octave), 8 is steep (48).'
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
    freq: 'Where the sound\'s timing (its phase) is shifted most, in Hz. The level stays the same at every frequency.',
    Q: 'How narrow the shifted region is: higher is more abrupt and more local.'
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
    gain: 'A see-saw around the pivot: above 0 raises the lows and lowers the highs by the same amount (warmer); below 0 does the opposite (brighter).',
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
    mode: 'down turns the band down when it gets loud, to tame harshness. up turns it up when it gets loud, to bring out what is strong.'
  },
  'spectral-tilt': {
    slope: 'How much each octave is raised over the one below, in dB: above 0 brightens, below 0 darkens, 0 does nothing. It adds up across the octaves, so large values change the loudness a lot.'
  },
  moog: {
    fc: 'Cutoff, in Hz: sound above it is turned down, 24 dB per octave.',
    resonance: 'Emphasis at the cutoff, 0 to 1. Higher gives the squelchy, singing edge of the classic filter; at 1 it rings by itself.',
    drive: 'How hard the sound is pushed into the filter, which saturates: above 1 adds warm distortion, below 1 is cleaner and quieter.'
  },
  korg35: {
    fc: 'Cutoff, in Hz: lowpass turns down sound above it, highpass turns down sound below it.',
    resonance: 'How aggressive the filter\'s edge gets, 0 to 1. Higher adds the bite and grit of the MS-20. It does not ring by itself.',
    drive: 'How hard the sound is pushed into the filter, which saturates: above 1 adds distortion, below 1 is cleaner and quieter.',
    type: 'lowpass keeps the lows and turns down the highs; highpass does the opposite.'
  },
  diode: {
    fc: 'Cutoff, in Hz: sound above it is turned down, 24 dB per octave.',
    resonance: 'Emphasis at the cutoff, 0 to 1.2. Higher gives the squelch of an acid bass line; it starts to ring by itself around 1.15.',
    drive: 'How hard the sound is pushed into the filter, which saturates: above 1 adds distortion, below 1 is cleaner and quieter.'
  },
  oberheim: {
    fc: 'Cutoff or centre, in Hz: where the filter acts.',
    resonance: 'Emphasis at the cutoff, 0 to 1. Higher rings more.',
    type: 'lowpass keeps the lows, highpass the highs, bandpass a band around the cutoff, notch removes a band around it.'
  },
  variable: {
    fc: 'Cutoff or centre, in Hz. Moving it while it plays is smoothed, so it does not click.',
    Q: 'Sharpness: higher is narrower, or adds a peak at the cutoff; 0.7 is smooth.',
    type: 'lowpass keeps the lows, highpass the highs, bandpass a band around the cutoff.'
  },
  resonator: {
    fc: 'The frequency it rings at, in Hz.',
    bw: 'How narrow the ringing is, in Hz. Smaller rings longer and purer; larger is shorter and duller.'
  },
  comb: {
    delay: 'Length of the delay, in ms. It sets the pitch the comb sounds at: 10 ms puts teeth every 100 Hz. Shorter is higher.',
    gain: 'Strength of the delayed copy; negative flips it. Higher is a stronger comb, and with feedback a longer ring. Near 1 it rings for a long time.',
    type: 'feedforward adds one delayed copy: a hollow, flanger-like sound. feedback keeps re-echoing it: a ringing, resonant tone.'
  },
  dcblocker: {
    R: 'How close to zero frequency the cut sits. Nearer 1 removes only the steady offset and keeps all the bass; lower also thins the lowest bass.'
  },
  emphasis: {
    alpha: 'How strongly the highs are raised over the lows. Higher is stronger; 0.97 is the usual setting for speech.'
  },
  deemphasis: {
    alpha: 'How strongly the highs are turned down against the lows. Use the value the emphasis used to undo it exactly.'
  },
  integral: {
    leak: 'How quickly the running total forgets what came before: 1 keeps everything, so it can drift; lower lets drift leak away, at the cost of the lowest frequencies.'
  },
  // Dynamics
  compressor: {
    threshold: 'Level where compression starts, in dB. Sound above it is turned down, sound below it is left alone. Lower catches more of the sound.',
    ratio: 'How firmly sound above the threshold is turned down. At 4, every 4 dB over the threshold comes out 1 dB over. Higher is stronger; 20 is close to a limiter.',
    knee: 'How gradually it sets in around the threshold: 0 is an abrupt corner, higher is a softer approach.',
    makeup: 'Gain added after compressing, in dB, to bring the level back up.',
    attack: 'How fast it reacts when the level rises. Fast catches short peaks; slow lets them through.',
    release: 'How fast it lets go after the level falls. Fast follows closely; slow sounds smoother.',
    upThreshold: 'Level, in dB, under which quiet sound is lifted toward it (upward compression). Does nothing while upRatio is 1.',
    upRatio: 'How firmly sound under upThreshold is lifted. 1 does nothing; higher brings up quiet detail, and noise with it.',
    upKnee: 'How gradually the lift sets in around upThreshold: 0 is an abrupt corner, higher is softer.',
    upRange: 'Most the lift can add, in dB, so near-silence is not turned up without end.'
  },
  limiter: {
    ceiling: 'Highest level allowed, in dB. Nothing gets past it; 0 is full scale.',
    lookahead: 'How far ahead it looks, in ms. It eases the volume down over this time so each peak arrives at the ceiling without clipping. Longer is smoother but dips the sound before a peak.',
    release: 'How fast the volume comes back after a peak, in ms. Short stays louder but can distort bass; long is smoother and may dull what follows.'
  },
  gate: {
    threshold: 'Level where the gate opens, in dB. Sound louder than this passes; quieter sound is turned down to the range.',
    closeThreshold: 'Level where the gate closes again, in dB. Keep it a few dB under the threshold so the gate does not flutter near one level. It does not move with the threshold.',
    range: 'How far the gate turns sound down while it is closed, in dB. -90 is near silence; a smaller drop, like -20, leaves the background faintly there.',
    hold: 'How long the gate stays open after the sound falls below the threshold, in ms. Stops it chattering on words that dip in and out.',
    attack: 'How fast the gate opens, in ms. Very short keeps the start of each sound; longer fades it in.',
    release: 'How fast the gate closes, in ms. Short cuts the tail off abruptly; long fades it out.',
    lookahead: 'How far ahead it listens, in ms, so the gate is already open when a sound arrives and never clips its start. 0 is off.'
  },
  expander: {
    mode: 'downward turns quiet sound further down, a softer gate. upward turns loud sound up, restoring dynamics that were squashed.',
    threshold: 'Level, in dB, that divides quiet from loud: downward mode acts below it, upward mode above it.',
    ratio: 'How steeply it pushes. At 2, every 1 dB under the threshold becomes 2 dB under it. Higher is closer to a gate.',
    knee: 'How gradually it sets in around the threshold: 0 is an abrupt corner, higher is a softer approach.',
    range: 'Most it will change the sound, in dB: how far quiet sound is turned down, or how far loud sound is turned up.',
    attack: 'How fast it follows the level as it rises, in ms. Short lets a new sound through at once.',
    release: 'How fast it follows the level as it falls, in ms. Short turns quiet sound down quickly; long keeps it open through short gaps.'
  },
  deesser: {
    mode: 'broadband turns the whole sound down while an s lasts; band turns down only the harsh range around fc, so the rest stays untouched.',
    fc: 'Where the harsh s sound sits, in Hz. Voices usually have it between 5 and 9 kHz.',
    Q: 'Width of the range that is watched, and in band mode turned down. Higher is narrower and more precise.',
    threshold: 'How far the s range must rise over the voice below it, in dB, before it is turned down: 0 is as loud as the voice. Not a level, so it works the same on a quiet or a loud recording. Lower catches softer s sounds.',
    ratio: 'How firmly the s range is turned down once past the threshold. Higher is stronger.',
    range: 'Most it will turn an s down, in dB. About 6 tames it; much more and the voice starts to lisp.',
    knee: 'How gradually it sets in around the threshold.',
    attack: 'How fast it reacts when an s begins, in ms.',
    release: 'How fast it lets go after an s ends, in ms.'
  },
  leveler: {
    target: 'The average level each stretch of speech is brought to, in dB. Quieter stretches are turned up toward it, louder ones down.',
    maxGain: 'Most it will turn a stretch up or down, in dB. Stops very quiet parts being raised without end.',
    frame: 'Length of each stretch it measures and adjusts, in seconds. Short follows every word; long follows whole phrases.',
    smooth: 'How many neighbouring stretches each volume change is blended across. Higher is smoother and slower to follow; 0 follows each stretch exactly.',
    gate: 'Pause detector. Stretches this many dB quieter than the speech are taken as pauses and keep the volume of the speech before them, so the room noise is not turned up between phrases.'
  },
  'transient-shaper': {
    attackGain: 'Punch. How strong the start of each sound is: 0 leaves it, above 0 sharpens attacks, below 0 softens them, -1 removes them. A factor, not dB.',
    sustainGain: 'Body. How strong what follows the start is: 0 leaves it, above 0 makes sounds ring and fill out, below 0 makes them tighter and drier. A factor, not dB.'
  },
  softclip: {
    curve: 'The shape of the rounding. tanh and atan are smooth and warm, sin and cubic are firmer, hard cuts flat at the ceiling and sounds harsh.',
    drive: 'Gain before the curve. Higher pushes more of the sound into the rounding, adding saturation and loudness; below 1 it is gentle.',
    ceiling: 'Highest level the output reaches, as a share of full scale: 1 is full scale, 0.5 is 6 dB under.',
    oversample: 'Runs the curve at this many times the sample rate to avoid harsh high tones from heavy clipping. 1 is off; higher is cleaner and slower.'
  },
  compand: {
    out0: 'Level that sound arriving at -90 dB (near silence) comes out at, in dB. The same number leaves it alone; higher lifts it, lower sinks it.',
    out1: 'Level that sound arriving at -60 dB (very quiet) comes out at, in dB. The same number leaves it alone; higher lifts it, lower sinks it.',
    out2: 'Level that sound arriving at -20 dB (a loud passage) comes out at, in dB. The same number leaves it alone; lower turns it down.',
    out3: 'Level that sound arriving at 0 dB (the loudest peak) comes out at, in dB. Under 0 turns the peaks down, as a compressor does.',
    attack: 'How fast it follows the level when it rises, in ms.',
    release: 'How fast it follows the level when it falls, in ms.'
  },
  unlimit: {
    amount: 'The most it will lift any attack, in dB. This is the strength of the restoring.',
    drive: 'How much of the missing punch is put back. 1 restores attacks to the target, less is gentler, more overshoots (up to the amount).',
    adaptive: 'On: lifts only attacks that are too weak, the kind a limiter squashes, and leaves healthy ones alone. Off: exaggerates every attack in proportion.',
    crestTarget: 'How strong a healthy attack is, in dB: how far its start stands over its body. Attacks weaker than this are taken as squashed and lifted toward it.',
    ceiling: 'Highest level allowed after the lift, in dB. The top of the range, 24, is out of reach: no limit.',
    fastAttack: 'How fast the quick level follower rises, in ms. It is the one that sees an attack: keep it short.',
    fastRelease: 'How fast the quick level follower falls, in ms.',
    slowAttack: 'How fast the slow level follower rises, in ms. It is what the quick one is compared with.',
    slowRelease: 'How fast the slow level follower falls, in ms.'
  },
  ducker: {
    threshold: 'Level of the other sound, in dB, above which this one is turned down. Lower ducks on quieter sounds.',
    ratio: 'How firmly this sound is turned down once the other passes the threshold. Higher is stronger.',
    knee: 'How gradually it sets in around the threshold: 0 is an abrupt corner, higher is a softer approach.',
    range: 'Most this sound is turned down, in dB. -24 leaves it clearly there under the other; -90 mutes it.',
    attack: 'How fast this sound gives way when the other begins, in ms.',
    release: 'How slowly it comes back after the other stops, in ms. Short brings it back fast and may pump; long is smoother.'
  },
  multiband: {
    low: 'Where the low band ends, in Hz. Sound below it is compressed on its own.',
    high: 'Where the high band starts, in Hz. Sound above it is compressed on its own; what is between is the mid band.',
    threshold: 'Level, in dB, where compression starts in each of the three bands. Lower catches more.',
    ratio: 'How firmly each band is turned down above the threshold. Higher is stronger.',
    upThreshold: 'Level, in dB, under which quiet sound in each band is lifted toward it. Does nothing while upRatio is 1.',
    upRatio: 'How firmly quiet sound under upThreshold is lifted. 1 does nothing; higher brings up quiet detail, and noise with it.',
    depth: 'How much of the change is applied: 0 leaves the sound as it was, 1 is as set, 2 doubles every change in dB.',
    attack: 'How fast it reacts when the level rises. Fast catches short peaks; slow lets them through.',
    release: 'How fast it lets go after the level falls. Fast follows closely; slow sounds smoother.',
    makeup: 'Gain added after compressing, in dB, to bring the level back up.'
  },
  fet: {
    threshold: 'Level where compression starts, in dB. Sound above it is turned down, sound below it is left alone. Lower catches more of the sound.',
    ratio: 'How firmly sound above the threshold is turned down. FET compressors work at high ratios: 4 is firm, 20 is nearly a limiter.',
    knee: 'How gradually it sets in around the threshold: 0 is an abrupt corner, higher is a softer approach.',
    makeup: 'Gain added after compressing, in dB, to bring the level back up.',
    attack: 'How fast it reacts when the level rises, in ms. A FET is very fast, so even peaks of a fraction of a millisecond are caught.',
    release: 'How fast it lets go after the level falls. Fast follows closely; slow sounds smoother.'
  },
  opto: {
    threshold: 'Level where compression starts, in dB. Sound above it is turned down, sound below it is left alone. Lower catches more of the sound.',
    ratio: 'How firmly sound above the threshold is turned down. An optical compressor stays gentle: 3 is its natural setting.',
    knee: 'How gradually it sets in around the threshold. An optical compressor has a wide soft knee, so the start is hard to hear.',
    makeup: 'Gain added after compressing, in dB, to bring the level back up.',
    attack: 'How fast it reacts when the level rises, in ms. Slow enough to let the start of a note through.'
  },
  varimu: {
    threshold: 'Level where compression starts, in dB. Sound above it is turned down, sound below it is left alone. Lower catches more of the sound.',
    knee: 'How gradually it sets in around the threshold. A wide knee eases the compression in. The ratio also grows by itself the further sound is over the threshold.',
    attack: 'How fast it reacts when the level rises, in ms. Slow, so the start of notes passes.',
    release: 'How fast it lets go after the level falls. Fast follows closely; slow sounds smoother.',
    makeup: 'Gain added after compressing, in dB, to bring the level back up.'
  },
  vca: {
    threshold: 'Level where compression starts, in dB. Sound above it is turned down, sound below it is left alone. Lower catches more of the sound.',
    ratio: 'How firmly sound above the threshold is turned down. At 4, every 4 dB over the threshold comes out 1 dB over. Higher is stronger; 20 is close to a limiter.',
    knee: 'How gradually it sets in around the threshold: 0 is an abrupt corner, higher is a softer approach. A VCA compressor has a nearly hard knee.',
    makeup: 'Gain added after compressing, in dB, to bring the level back up.',
    attack: 'How fast it reacts when the level rises. Fast catches short peaks; slow lets them through.',
    release: 'How fast it lets go after the level falls. Fast follows closely; slow sounds smoother.'
  },
  auto: {
    type: 'What the sound is: speech, music, or both. It decides which fixes are used and the loudness aimed for.',
    intensity: 'How strong the fixes are: 0 the lightest, 1 as measured, 2 stronger. Covers noise reduction, harshness, tone and compression; hum and clicks found are always removed.',
    targetLufs: 'Loudness to aim for, in LUFS. 0 picks one for the type: -16 for speech, -14 for music.',
    ceiling: 'Highest peak allowed after levelling, in dB. -1 leaves room for streaming encoders.'
  },
  // Repair
  denoise: {
    reduction: 'How far the noise is turned down, in dB, everywhere. More removes more, and risks a hollow, watery sound. 0 leaves the sound as it was.',
    threshold: 'Treats the noise as this many dB louder than it was learned: above 0, quiet sound just over the noise is removed too; below 0, more of it is kept.'
  },
  omlsa: {
    gMin: 'Most the noise is turned down, in dB. More negative removes more, and risks a hollow, watery voice.',
    alphaDD: 'Smoothing over time. How much each moment leans on the one before it when judging what is noise. Higher is steadier with fewer warbling leftovers, but slower to catch the start of a word.',
    qPrior: 'How likely any moment is assumed to be only noise. 0 works it out from the sound itself. A value above 0 sets it by hand; from 0.9 up, everything counts as noise and is turned down.',
    xiFloor: 'Lowest signal-to-noise ratio it assumes, in dB. Lower removes more of faint sounds close to the noise; higher protects them, but leaves more noise.'
  },
  deepfilter: {
    limit: 'The most the noise is turned down, in dB. Past 18 the voice itself starts to sound filtered, like a call. 0 lifts the limit: the model\'s full cleaning, and pauses can fall to digital silence.',
    music: 'pass leaves music as it is, songs included, and cleans only speech and noise. enhance cleans everything, which takes music down and dulls it.'
  },
  rnnoise: {
    limit: 'The most the noise is turned down, in dB. A limit keeps the model from damaging the voice. 0 lifts the limit.',
    music: 'pass leaves music as it is, songs included, and cleans only speech and noise. It decides as it plays: music is cleaned for its first second or so. enhance cleans everything.'
  },
  wiener: {
    rule: 'How the amount to remove is worked out. mmse-lsa leaves less warbling noise behind; wiener is the classic, simpler rule.',
    alphaDD: 'Smoothing over time. How much each moment leans on the one before it when judging what is noise. Higher is steadier with fewer warbling leftovers, but slower to catch the start of a word.',
    xiFloor: 'Roughly how far the noise can be turned down, in dB. More negative removes more and sounds more hollow.'
  },
  specsub: {
    alpha: 'Over-subtraction. How much more than the noise estimate is taken away. Higher removes more noise but leaves watery warbling on speech. 0 chooses it by itself: stronger where the noise is louder.',
    beta: 'Noise left behind, as a share of its power: 0.05 keeps 5%. Higher leaves a steady hiss that hides watery artifacts; lower removes more and sounds less natural.'
  },
  dehum: {
    freq: 'The hum frequency, in Hz: 50 or 60 for mains. 0 measures it from the sound. A set value is still tuned by measuring within 0.4%.',
    harmonics: 'How many multiples of the hum to remove, starting with the hum itself (50, 100, 150 Hz and so on). 0 removes all of them up to 1 kHz. Each is followed as it drifts and taken out alone, so music and voice beside it stay.',
    adaptive: 'With a set frequency, searches for the hum within about half a hertz of it instead of 0.4%: for hum off its nominal frequency, as from a tape running at the wrong speed.'
  },
  roomtone: {
    threshold: 'Silence level. Stretches quieter than this count as digital silence and are filled with the recording\'s own room tone.'
  },
  declick: {
    threshold: 'Detection threshold. How far a click must stand out of the sound around it, in multiples of its usual unpredictability. Lower finds fainter clicks (and may nibble the sound); higher, only loud ones.',
    longest: 'Longest click rebuilt, in milliseconds. A burst longer than this is taken for real sound and left alone, unless it is in the selection; a pop\'s ring is taken off with it if it dies away within this.',
    order: 'Model detail. How many earlier samples predict the next, so a click stands out from what the sound would do. Higher follows pitched sound more closely and runs slower.'
  },
  decrackle: {
    threshold: 'Detection threshold. How far a tick must stand out, both from what the sound before it predicts and from what the sound either side implies, to count as crackle. Lower finds fainter crackle and may touch the sound; higher, only clear ticks.',
    order: 'Model detail. How many samples either side predict each one, so a tick stands out from what the sound would do. Higher follows pitched sound more closely and runs slower.'
  },
  declip: {
    clipLevel: 'The level where the sound was cut flat, as a share of full scale, the same on both sides. 0 finds each side\'s from the sound, and leaves a sound that was never cut untouched.',
    order: 'Model detail. How many earlier samples are used to predict the wave across a cut peak. Higher follows rich music more closely and runs much slower.'
  },
  dereverb: {
    strength: 'How much of the room\'s echo is taken. Higher takes more of it and more of the voice with it; 0 takes only what it can cancel exactly, a dB or two. A take with no room to hear, or music with no pauses, is left as it came at any strength.'
  },
  deplosive: {
    triggerRatio: 'How much stronger the low thump must be than the rest of the voice to count as a pop. Lower catches more pops; higher catches only the worst. A voice or a bass note, whose low end has a pitch, is let through.',
    attenuation: 'How far the low end is turned down during a pop, in dB.',
    crossover: 'The frequency below which pops are found and turned down, in Hz. During a pop, sound an octave above it dips under 1 dB; between pops nothing is touched.',
    attack: 'How fast the low end is turned down once a pop is found.',
    release: 'How slowly the low end comes back after a pop. Longer is smoother.'
  },
  dewind: {
    attenuation: 'How far the wind is turned down, in dB. A voice\'s harmonics that stand over the wind keep their level; lower takes the wind further and leaves the voice drier. 0 takes nothing.',
    cutoff: 'The highest frequency wind is taken from, in Hz. Most wind lies under 500 Hz, but strong wind rushes up to several kHz, so by default it is taken up to 8 kHz. Nothing above it is touched, and with no wind nothing at all.'
  },
  debreath: {
    range: 'How far everything between phrases, breaths included, is turned down, in dB. -12 softens it; lower removes more and makes pauses unnaturally dead.',
    attack: 'How long before speech starts the volume comes back. It rises ahead of the word, so the start is never cut; longer is softer.',
    release: 'How slowly the cut is applied after speech ends. Longer is smoother; shorter turns breaths down sooner.'
  },
  debleed: {
    attenuation: 'How far the bleed that cancelling leaves is turned down, in dB. Lower takes more of it and, where the wanted sound and the bleed share a frequency, a little of the wanted sound; 0 only cancels.',
    span: 'How long a stretch of the room between the bleeding source and the mic is learned, in seconds: its delay and first reflections. A bigger, more echoing room wants more.'
  },
  defeedback: {
    notches: 'How many howl frequencies it can cut at once. Each one found gets its own narrow cut; when all are in use, the shallowest is replaced.',
    Q: 'Width of each cut. Higher is narrower: it takes out only the howl and spares the sound around it, but the howl can slip past if its pitch drifts.',
    strength: 'How deep each cut deepens per step while the howl lasts: 1 is full (9 dB a step, to 24 dB), lower is gentler, 0 does nothing.'
  },
  spectral: {
    gain: 'What happens to the selected band, in dB: -60 removes it, 0 leaves it as it is, above 0 boosts it.'
  },
  // Time & pitch
  speed: {
    rate: 'Playback speed. 2 is twice as fast and an octave higher; 0.5 is half as fast and an octave lower.'
  },
  pitch: {
    semitones: 'Pitch change in semitones. 12 is an octave up, -12 an octave down; the length stays.'
  },
  intonation: {
    factor: 'How far the voice\'s pitch strays from its middle, as a multiple: 1 leaves it, 0 is a monotone, 2 makes every rise and fall twice as wide.'
  },
  formant: {
    semitones: 'How far the formants move, in semitones, the pitch staying: up is a smaller, brighter voice, down a larger, darker one. 2 or 3 is a lot.'
  },
  'pitch-shift': {
    semitones: 'How far the pitch moves, in semitones: 12 is an octave up, -12 an octave down. The length stays.',
    method: 'The shifting method. auto chooses from the sound; the others suit particular jobs: formant or psola for voices, transient for drums, sms or phase-lock for tonal music, paulstretch or granular for textures.',
    content: 'A hint to auto about what the sound is: voice picks a method for single voices, tonal one for sustained notes. Ignored when a method is chosen.',
    formant: 'Keeps the voice\'s tone in place while the pitch moves, so a raised voice does not turn chipmunk. Works only with method auto.'
  },
  'formant-shift': {
    semitones: 'How far the pitch moves, in semitones: 12 is an octave up. The voice\'s tone stays where it was, so a raised voice does not turn chipmunk.'
  },
  vocoder: {
    semitones: 'How far the pitch moves, in semitones: 12 is an octave up, -12 an octave down. The length stays.'
  },
  paulstretch: {
    semitones: 'How far the pitch moves, in semitones: 12 is an octave up, -12 an octave down. Even at 0 the sound is smeared into a texture.',
    frame: 'Length of each grain, in seconds. Longer smears more: attacks melt into a smoother, more washed-out sound; shorter keeps more of the original\'s shape.'
  },
  tune: {
    scale: 'Which notes the pitch may land on. chromatic is every note, fixing only what is slightly off; the others restrict it to that scale around the root.',
    root: 'The note the scale starts on, in semitones up from C: 0 is C, 2 is D, 7 is G, 9 is A. Not used by the chromatic scale.',
    a4: 'The tuning of the note A above middle C, in Hz, that every note is worked out from. 440 is standard.',
    tolerance: 'How far off a note can be, in cents (hundredths of a semitone), before it is corrected. Notes closer than this are left as sung.',
    strength: 'How much of the correction is applied: 1 snaps each note to the exact pitch, less moves it part of the way, 0 does nothing.',
    speed: 'How long the pitch may stray from its note before it is pulled back, in milliseconds. 0 holds every moment on the note: the hard, stepped sound. 80 keeps the voice\'s vibrato and slides and takes out its slow drift; 400 only moves each note\'s centre.'
  },
  resample: {
    rate: 'The new sample rate, in Hz. A lower rate keeps less of the high frequencies.'
  },
  'stretch-paul': {
    factor: 'Length. 4 makes it four times as long; the pitch stays. It melts the sound into a drone, and is made for 8 or more.',
    frame: 'Length of each grain, in seconds. Longer smears more: attacks melt into a smoother, more washed-out sound; shorter keeps more of the original\'s shape.'
  },
  // Effect
  delay: {
    time: 'The gap between the sound and its echo, in seconds.',
    feedback: 'How much of each echo feeds the next. 0 gives a single echo; higher gives a longer trail that fades slowly.'
  },
  pingpong: {
    time: 'The gap between echoes, in seconds. Each echo lands on the other side.',
    feedback: 'How much of each echo feeds the next, which bounces to the other side. Higher gives more bounces.'
  },
  multitap: {
    feedback: 'How much of the echoes feeds back to make more. 0 gives the two set echoes only (at 0.25 s and 0.5 s); higher adds a repeating trail.'
  },
  chorus: {
    rate: 'How fast the copies drift in timing, in cycles per second. Slow is lush; fast is wobbly.',
    depth: 'How far the copies drift in timing, 0 to 1. More detunes them further; 0 gives no thickening.',
    delay: 'How far behind the copies run on average, in seconds. 10 to 30 ms is the classic chorus; shorter sounds metallic, longer like a double.',
    voices: 'How many detuned copies are blended in. More sounds thicker, like a bigger ensemble.'
  },
  flanger: {
    rate: 'How fast the sweep goes up and down, in cycles per second. Slow is a long whoosh; fast is a warble.',
    depth: 'How far the sweep reaches, 0 to 1. More is a wider, more obvious whoosh.',
    delay: 'Centre delay of the sweep, in seconds. A few ms or less gives the jet sound; longer is closer to a chorus.',
    feedback: 'How much of the effect feeds back into itself. Higher makes the whoosh more intense, with a ringing metallic edge.'
  },
  phaser: {
    rate: 'How fast the sweep goes up and down, in cycles per second. Slow is a long whoosh; fast is a warble.',
    depth: 'How far the sweep reaches around the centre frequency, 0 to 1.',
    stages: 'How many filter stages swirl the sound. More gives more notches and a deeper, more complex swirl.',
    feedback: 'How much of the effect feeds back into itself. Higher makes the swirl more pronounced and resonant.',
    fc: 'Centre of the sweep, in Hz: the swirl moves around this pitch region.'
  },
  tremolo: {
    rate: 'How many pulses of volume per second.',
    depth: 'How far the volume dips on each pulse: 0 is none, 1 dips to silence.'
  },
  vibrato: {
    rate: 'How fast the pitch wobbles, in cycles per second.',
    depth: 'How wide the pitch wobbles: 0 is none, 1 the widest. A faster rate widens it further.'
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
    mode: 'auto sweeps by itself at the rate; manual holds the filter still at the centre, like a pedal left in one place.'
  },
  rotary: {
    hornSpeed: 'How fast the treble horn spins, in turns per second. 0.8 is the slow setting, 6.7 the fast one.',
    drumSpeed: 'How fast the bass drum spins, in turns per second. 0.7 is the slow setting, 5.9 the fast one.',
    depth: 'How strong the swirl of pitch and volume is, 0 to 1. 0 is none.',
    crossover: 'Where the sound splits between the bass drum and the treble horn, in Hz. Under it turns with the drum, over it with the horn.',
    hornInertia: 'How long the horn takes to spin up to its speed, in seconds. It starts at rest, so the swirl builds over this time.',
    drumInertia: 'How long the heavier bass drum takes to spin up to its speed, in seconds.',
    micSpread: 'The angle between the two virtual microphones that listen to the speaker, in radians. Wider spreads the swirl further between left and right; 1.57 is a quarter turn.'
  },
  ringmod: {
    fc: 'Frequency of the tone the sound is multiplied by, in Hz. A few Hz pulse like a tremolo; higher gives a metallic, bell-like, robotic sound.'
  },
  freqshift: {
    shift: 'Moves every frequency up (positive) or down (negative) by this many Hz. Unlike a pitch shift it breaks harmonic relations, so voices turn metallic and strange.',
    taps: 'Length of the filter that does the shifting. More follows low frequencies more accurately; fewer is faster. Few need to change it.'
  },
  graindelay: {
    time: 'Base delay before the grains play, in seconds.',
    spray: 'Random extra delay added to each grain, up to this many seconds. More scatters the echoes in time and blurs them.',
    pitch: 'Transposes each grain, in semitones: 12 is an octave up. Through feedback, echoes climb or fall in steps.',
    jitter: 'Random pitch change on each grain, in semitones either way. More sounds shimmery and out of tune.',
    grain: 'Length of each grain, in seconds. Short is grainy and textured; long keeps more of the sound\'s shape.',
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
    curve: 'Shape of the slowdown. 1 is steady, like a real brake; above 1 it slows quickly at first and crawls to a stop; below 1 it holds speed, then falls away at the end.',
    direction: 'stop slows the sound to a halt; start winds it up from a standstill.',
    flutter: 'Random wobble in speed while it changes, 0 to 1, for a worn, unsteady tape.'
  },
  bitcrusher: {
    bits: 'How many bits describe each sample. Fewer is grittier and noisier; 8 is old-console crunch. At 1, only what passes half of full scale gets through.',
    rate: 'Share of the sample rate kept, 0.01 to 1. Lower holds each sample longer, giving a harsh, aliased, lo-fi sound; 0.25 keeps one in four. 1 changes nothing.'
  },
  lofi: {
    wow: 'Slow drift in pitch, as from an uneven tape or record, 0 to 1.',
    flutter: 'Fast, small wobble in pitch, 0 to 1.',
    noise: 'Level of the hiss in the background, 0 to 1.',
    crackle: 'How much vinyl crackle there is, in pops and ticks, 0 to 1.',
    lowpass: 'Top of the sound, in Hz: highs above it are rolled off, as in old tape or radio. Lower sounds duller.',
    highpass: 'Bottom of the sound, in Hz: lows under it are cut, as in a small speaker. Higher sounds thinner.',
    drive: 'Tape saturation, 0 to 1. More rounds and warms the peaks.'
  },
  slew: {
    rise: 'Steepest upward slope allowed, in full-scale units per second. Lower rounds off sharp rises and dulls the sound.',
    fall: 'Steepest downward slope allowed, in full-scale units per second. Lower rounds off sharp falls and dulls the sound.'
  },
  noiseshaper: {
    bits: 'The bit depth to round down to. The rounding noise is pushed toward the highest frequencies, where it is least audible; fewer bits is coarser and louder.'
  },
  // Color
  distortion: {
    drive: 'How hard the sound is pushed into the distortion, 0 to 1. More is grittier and louder.',
    type: 'The character. soft and tanh round the peaks warmly; hard flattens them harshly; foldback bends loud peaks back on themselves for a metallic buzz.'
  },
  tube: {
    drive: 'How hard the sound is pushed into the tube. More adds warmth, then crunch.',
    bias: 'Lopsidedness of the tube, 0 to 1. More adds even harmonics, the warm tube sound; 0 is even-handed, with odd harmonics only.'
  },
  tape: {
    drive: 'How hard the sound is pushed into the tape. More adds warmth, then compression and crunch.',
    warmth: 'Softening of the highs, like the loss at a tape head, 0 to 1. More is darker and warmer.'
  },
  transistor: {
    drive: 'How hard the sound is pushed into the console stage. More adds firm, punchy odd harmonics.'
  },
  waveshaper: {
    drive: 'How hard the sound is pushed into a smooth clipping curve. More is more saturated, ending near hard clipping.'
  },
  multisat: {
    low: 'Where the low band ends, in Hz. Each of the three bands is saturated on its own.',
    high: 'Where the high band starts, in Hz. What is between is the mid band.',
    drive: 'How hard each band is pushed into the tube saturation. More adds warmth, then crunch.'
  },
  exciter: {
    fc: 'The frequency above which new harmonics are made, in Hz. Higher adds only air; lower adds presence too.',
    drive: 'How hard the highs are pushed to make harmonics, 0 to 1. More is brighter and edgier.',
    amount: 'How much of the added harmonics is mixed in, 0 to 1. The original sound stays at full level.'
  },
  subbass: {
    fc: 'Top of the bass to build from, in Hz. Bass under it is turned into higher harmonics that small speakers can play.',
    amount: 'How much of the added harmonics is mixed in, 0 to 1.',
    drive: 'How hard the bass is pushed to make harmonics, 0 to 1. More is stronger and grittier.',
    keep: 'How much of the original deep bass is kept: 1 keeps it all, 0 replaces it with the harmonics alone, for speakers that cannot play it.'
  },
  sbr: {
    fc: 'Where the real sound runs out, in Hz, for example 16 kHz in a low-bitrate MP3. The highs are rebuilt above it from the band just below.',
    amount: 'How much of the rebuilt highs is added, 0 to 1.',
    drive: 'How hard the band is pushed to make the highs, 0 to 1. More makes more of them, brighter and rougher.'
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
    damp: 'How quickly the highs die away in the tail, 0 to 1. Higher is darker and softer; lower is brighter and more metallic.'
  },
  plate: {
    decay: 'How long the reverb rings, 0 to 1. Higher is a longer tail.',
    damping: 'How quickly the highs die away in the tail, 0 to 1. Higher is darker and softer; lower is brighter and more metallic.'
  },
  fdn: {
    decay: 'How long the reverb rings, from about 0.3 seconds at 0 to over 5 seconds at 1.',
    damping: 'How quickly the highs die away in the tail, 0 to 1. Higher is darker and softer; lower is brighter and more metallic.'
  },
  spring: {
    decay: 'How long the reverb rings, 0 to 1. Higher is a longer tail.',
    tension: 'How strong the spring\'s boing is, 0 to 1. Higher spreads the highs and lows apart in time, a more pronounced chirp on every sound.',
    damping: 'How quickly the highs die away in the tail, 0 to 1. Higher is darker and softer; lower is brighter and more metallic.'
  },
  shimmer: {
    decay: 'How long the reverb rings, 0 to 1. Higher is a longer tail.',
    shimmer: 'How much of the tail climbs an octave each time it goes round, 0 to 1. More is a brighter, rising, choir-like tail; 0 is a plain reverb.',
    damping: 'How quickly the highs die away in the tail, 0 to 1. Higher is darker and softer; lower is brighter and more metallic.'
  },
  schroeder: {
    decay: 'How long the reverb rings. Near the top it rings for a very long time.',
    damping: 'How quickly the highs die away in the tail, 0 to 1. Higher is darker and softer; lower is brighter and more metallic.'
  },
  // Space
  vocals: {
    mode: 'isolate keeps the centre of a stereo mix, where vocals usually sit; remove takes the centre out.'
  },
  widener: {
    width: 'How wide the stereo is: 0 is mono, 1 leaves it as it is, higher exaggerates the difference between left and right. Very high values sound hollow in mono.'
  },
  haas: {
    time: 'How long one side is delayed, in ms. Under about 35 ms the ear hears one wider sound, not an echo.',
    channel: 'Which side is delayed. The sound seems to lean toward the other side.'
  },
  panner: {
    pan: 'Position between the speakers: -1 is full left, 0 centre, 1 full right. The sound is first summed to mono.'
  },
  autopan: {
    rate: 'How fast the sound sweeps between left and right, in cycles per second. The sound is first summed to mono.',
    depth: 'How far it sweeps: 0 stays in the centre, 1 goes right out to each side.'
  },
  midside: {
    mode: 'encode turns left and right into mid (what they share) and side (how they differ), to be processed apart. decode turns them back.',
    width: 'Used in decode mode: how wide the stereo is. 1 leaves it, 0 is mono, higher is wider.'
  },
  microshift: {
    cents: 'How far the left copy is shifted up and the right copy down, in cents (hundredths of a semitone). A few cents widen the sound without it going out of tune.'
  },
  binaural: {
    azimuth: 'The direction the sound comes from, in degrees: 0 is straight ahead, 90 to the right, -90 to the left. It has no front or behind, so 180 sounds the same as 0. Best heard on headphones.',
    distance: 'How far away the sound is, in metres. It only turns the level down: 2 m is half as loud as 1 m.',
    headRadius: 'Size of the virtual head, in metres. A larger head puts more delay between the ears. 0.0875 is an average adult.'
  },
  surround: {
    delay: 'How long the rear speakers lag behind the front, in ms. The lag keeps the rear sound as ambience, behind the front image.',
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
    type: 'The shape of the wave. sine is pure, triangle is soft, square is hollow and buzzy, sawtooth is bright and full.'
  },
  noise: {
    color: 'The kind of noise. white is a bright hiss, pink is more natural like rain, brown is a deep rumble, blue and violet are thinner and brighter than white.',
    gain: 'How loud it plays, from silent (0) to full scale (1).'
  },
  chirp: {
    f0: 'Where the sweep starts, in Hz.',
    f1: 'Where the sweep ends, in Hz.',
    method: 'exp spends equal time in each octave, which sounds like an even rise. linear spends most of its time in the highest octaves.'
  },
  pluck: {
    freq: 'Pitch of the string, in Hz.',
    damp: 'How slowly the string dies away. Closer to 1 rings longer; lower is a short, dull pluck.',
    seed: 'The starting point of the noise that plucks it, so the same number always sounds the same. Another is another pluck.'
  },
  kick: {
    freq: 'The pitch the kick settles to, in Hz. Lower is a deeper boom.',
    drop: 'How far above that pitch the kick starts, as a multiple of it: at 3 it starts four times higher and falls. More is a harder, clickier thump.'
  },
  cymbal: {
    freq: 'Base pitch of the metallic tones, in Hz. Lower is a bigger, deeper crash; higher is a thinner ping.'
  },
  risset: {
    freq: 'Base pitch of the drum, in Hz. Its other partials ring above it at inharmonic multiples, with a soft tone an octave below.'
  },
  rhythm: {
    bpm: 'Tempo, in beats per minute.',
    beats: 'Beats in each bar. The first beat of every bar gets the accent pitch and is louder.',
    freq: 'Pitch of the ordinary clicks, in Hz.',
    accentFreq: 'Pitch of the accented click on the first beat of each bar, in Hz.'
  },
  sfx: {
    preset: 'Which game sound: pickup, laser, explosion, powerup, hit, jump, blip or coin.'
  },
  fm: {
    freq: 'Pitch of the tone, in Hz. 440 is the note A.',
    ratio: 'Speed of the modulating tone against the main one. Whole numbers (1, 2, 3) give clear, musical tones; other values give bells and metallic sounds.',
    index: 'How strongly the modulator bends the main tone, in radians. 0 is a plain sine; more adds brighter, richer overtones.',
    indexDecay: 'How quickly the brightness fades after the start, in seconds. 0 keeps it constant; a few seconds fades from bright to soft, like a struck bell.',
    indexFloor: 'The index the brightness fades down to, in radians. Has no effect while indexDecay is 0.',
    feedback: 'How much the modulator feeds back into itself, in radians. A little adds a saw-like edge; high values turn noisy.',
    attack: 'How long the tone takes to fade in at the start, in seconds.',
    release: 'How long the tone takes to fade out at the end, in seconds.'
  },
  modal: {
    freq: 'Pitch of the lowest ringing mode, in Hz.',
    model: 'What is struck: a string, a bar (xylophone, marimba), a membrane (drum skin), a plate (cymbal, gong), or a tube open at both ends or closed at one.',
    nmodes: 'How many overtones ring together. More makes a richer, more complex tone.',
    t60: 'How long the lowest tone rings, in seconds, until it has faded by 60 dB.',
    damping: 'How much sooner the high overtones die than the low ones. 0 lets them ring as long as the lowest; higher makes the sound mellow as it fades.',
    inharmonicity: 'Stiffness of a string, which pushes its overtones out of tune, as in a piano. 0 is a perfect string. String model only.',
    strike: 'Where along its length it is struck, 0 to 1. The middle gives a fuller tone, near an end a thinner one, and at an end nothing sounds. Not used by membrane and plate.',
    exciter: 'What strikes it: impulse is a single sharp hit, noise a short burst of noise, a rougher, brushed attack.',
    seed: 'The starting point of the noise burst, so the same number always gives the same hit. Used with the noise exciter only.'
  },
  voice: {
    type: 'The shape of the wave. sine is pure, triangle is soft, square is hollow and buzzy, sawtooth is bright and full.',
    attack: 'How long the sound takes to rise from silence to full level, in seconds.',
    decay: 'How long it then takes to fall to the sustain level, in seconds.',
    sustain: 'The level it holds at while the note lasts, as a share of full level: 1 is full, 0 dies away after the decay.',
    release: 'How long the sound takes to fade out at the end, in seconds.',
    fc: 'Cutoff of the voice\'s low-pass filter, in Hz: how bright it sounds. Lower is duller, higher is brighter.',
    envAmount: 'How much each note\'s envelope moves the filter. 0 keeps it still at the cutoff; 1 opens it as the note starts and closes it as it dies away.'
  },
  poly: {
    voices: 'The most notes that can sound at once. When all are in use, the oldest is cut off for a new one.',
    type: 'The shape of the wave. sine is pure, triangle is soft, square is hollow and buzzy, sawtooth is bright and full.'
  },
  adsr: {
    attack: 'How long the sound takes to rise from silence to full level, in seconds.',
    decay: 'How long it then takes to fall to the sustain level, in seconds.',
    sustain: 'The level it holds at while the note lasts, as a share of full level: 1 is full, 0 dies away after the decay.',
    release: 'How long the sound takes to fade out at the end, in seconds.'
  }
}

// A setting's tooltip: its op's words, else its name's; undefined where there are none.
export const help = (op, name) => texts[op]?.[name] ?? texts['*'][name]

// An op's settings by name, `names` as its manifest gives them: [those the card shows, those under Advanced]. A setting
// the layout does not name is shown.
export function layout(op, names) {
  const [front = '', more = ''] = (layouts[op] ?? '').split('|'), pick = s => s.split(/\s+/).filter(n => names.includes(n)), shown = pick(front), folded = pick(more)
  return [[...shown, ...names.filter(n => !shown.includes(n) && !folded.includes(n))], folded]
}
