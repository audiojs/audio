// Scripts to start from, the Recipes panel's and the File menu's. `$src` is the sound open as it is, its edits kept: a
// recipe that is one chain on it goes after the script's own (over the selection, when there is one), one of statements
// takes the script's sound for its source (repl.js useRecipe). A recipe made for a delivery spec names it: the page checks the output against it
// (fn/check.js). Their sources, their measured results and the ones still to join: .work/recipes.md.
export default [
  ['Clean up', 'Podcast voice', 'Tidy a spoken recording for a podcast', `$src
  .highpass(80)
  .trim()
  .normalize('podcast')
  .fade(0.05, 0.05)`, 'podcast'],
  ['Clean up', 'Enhance speech', 'Less noise and hum, a clear voice', `$src
  .highpass(80)
  .dehum()
  .omlsa()
  .normalize(-16, 'lufs', { ceiling: false })
  .deesser()
  .normalize('podcast')`, 'podcast'],
  ['Clean up', 'Enhance speech, neural', 'DeepFilterNet3: less noise, moving noise too, a clear voice', `$src
  .highpass(80)
  .dehum()
  .deepfilter()
  .normalize(-16, 'lufs', { ceiling: false })
  .deesser()
  .normalize('podcast')`, 'podcast'],
  ['Clean up', 'Reduce noise', 'Lower steady background noise', `$src.omlsa()`],
  ['Clean up', 'Reduce noise, neural', 'DeepFilterNet3: steady and moving background noise', `$src.deepfilter()`],
  ['Clean up', 'Remove hum', 'Mains hum: 50 Hz, or 60 Hz in the Americas', `$src.dehum({ freq: 50 })`],
  ['Clean up', 'Remove room echo', 'Less reverb on a voice recorded in a bare room', `$src
  .highpass(80)
  .dereverb()`],
  ['Clean up', 'Breaths, clicks, pops', 'Mouth clicks, plosive thumps, breaths pulled down', `$src
  .declick()
  .deplosive()
  .debreath({ range: -12 })`],
  ['Clean up', 'Shorten pauses', 'Silences longer than 0.3 s become 0.3 s', `$src.shrink(0.3)`],
  ['Clean up', 'Room tone for silence', 'Digital silence filled with the room the voice was recorded in', `$src.roomtone()`],
  ['Clean up', 'Restore vinyl', 'Clicks and crackle out, rumble taken from the side alone (Macaulay 1978), the bass kept', `$src
  .declick()
  .decrackle()
  .midside({ mode: 'encode' })
  .highpass(100, 4, { channel: 1 })
  .midside({ mode: 'decode' })
  .highpass(20, 4)`],
  ['Clean up', 'Field recording', 'Wind, rumble, hum and steady noise, in that order, then podcast loudness', `$src
  .dewind()
  .highpass(100, 4)
  .dehum({ freq: 60, harmonics: 3 })
  .denoise(15, { noise: { at: 0, d: 1.5 } })
  .normalize('podcast')`, 'podcast'],
  ['Clean up', 'Interview, two mics', 'One mic per channel: both voices level, each mic\'s bleed of the other cut between turns, podcast loudness', `let a = $src.highpass(80)
let [l, r] = await a.stat('loudness', { channel: [0, 1] })
a.gain(-20 - l, { channel: 0 })
  .gain(-20 - r, { channel: 1 })
  .expander({ threshold: -40, ratio: 3, range: 20, release: 150 })
  .leveler({ target: -20, frame: 0.5, maxGain: 10 })
  .remix(1)
  .normalize('podcast')`, 'podcast'],
  ['Clean up', 'Repair clipping', 'Rebuild flattened peaks', `$src.declip().normalize(-1)`],
  ['Level', 'Loudness for streaming', '−14 LUFS, peaks under −1 dBTP', `$src.normalize('spotify')`, 'spotify'],
  ['Level', 'Loudness for broadcast', 'EBU R 128: −23 LUFS', `$src.normalize('broadcast')`, 'broadcast'],
  ['Level', 'Measure loudness', 'Integrated loudness, peak and loudness range', `let a = $src
let [lufs, peak, range] = await a.stat(['loudness', 'db', 'lra'])
console.log(\`\${lufs.toFixed(1)} LUFS · peak \${peak.toFixed(1)} dBFS · range \${range.toFixed(1)} LU\`)
a`],
  ['Deliver', 'Audiobook chapter', 'ACX: RMS −23 to −18 dB, peaks under −3 dB, room tone at each end, 44.1 kHz', `$src
  .highpass(80)
  .dehum()
  .omlsa()
  .normalize(-20, 'rms', { ceiling: false })
  .compressor({ threshold: -14, ratio: 3 })
  .normalize(-20, 'rms', { ceiling: -3.5 })
  .trim()
  .pad(1.5, 2)
  .roomtone()
  .resample(44100)`, 'acx'],
  ['Deliver', 'Audiobook chapter, neural', 'ACX, with RNNoise: RMS −23 to −18 dB, peaks under −3 dB, room tone at each end, 44.1 kHz', `$src
  .highpass(80)
  .dehum()
  .rnnoise()
  .normalize(-20, 'rms', { ceiling: false })
  .compressor({ threshold: -14, ratio: 3 })
  .normalize(-20, 'rms', { ceiling: -3.5 })
  .trim()
  .pad(1.5, 2)
  .roomtone()
  .resample(44100)`, 'acx'],
  ['Deliver', 'Podcast episode', 'Apple Podcasts: −16 LUFS, peaks under −1 dBTP', `$src
  .highpass(80)
  .omlsa({ gMin: -12 })
  .normalize(-16, 'lufs', { ceiling: false })
  .deesser()
  .normalize('podcast')`, 'podcast'],
  ['Deliver', 'Film or series (Netflix)', 'Dialogue at −27 LUFS, peaks under −2 dBTP: measured, then set', `let a = $src.highpass(80)
let [L, D] = await a.stat(['loudness', 'dialog'])
a.normalize(-27 + L - D, 'lufs', { ceiling: -2 })`, 'netflix'],
  ['Deliver', 'US television (ATSC A/85)', 'Dialogue at −24 LUFS, peaks under −2 dBTP: measured, then set', `let a = $src.highpass(80)
let [L, D] = await a.stat(['loudness', 'dialog'])
a.normalize(-24 + L - D, 'lufs', { ceiling: -2 })`],
  ['Deliver', 'Narration, tightened', 'Long pauses cut to 0.6 s, level held; then drag the pitch curve (T) to reshape a phrase', `$src
  .highpass(80)
  .omlsa({ gMin: -12 })
  .shrink(0.6)
  .leveler({ target: -20 })
  .normalize('podcast')`, 'podcast'],
  ['Master', 'Master to a reference', 'Open a track named reference.wav: its tone, width and loudness', `$src.master(audio('reference.wav'))`, 'spotify'],
  ['Master', 'Master a song', 'Gentle multiband glue, streaming loudness under −1 dBTP', `$src
  .highpass(25)
  .multiband({ threshold: -20, ratio: 2 })
  .normalize('spotify')`, 'spotify'],
  ['Master', 'Music master for streaming', 'Staged, glued 2:1, −14 LUFS under −1 dBTP', `$src
  .highpass(20, 4)
  .normalize(-18, 'lufs', { ceiling: false })
  .vca({ threshold: -24, ratio: 2, attack: 30, release: 300 })
  .normalize(-14, 'lufs', { ceiling: -1 })`, 'spotify'],
  ['Master', 'Mastering chain, dither last', 'Corrective EQ, glue, tone, the limiter, 44.1 kHz, then 16-bit dither, last of all (Katz)', `$src
  .highpass(20, 4)
  .normalize(-18, 'lufs', { ceiling: false })
  .eq(250, -1, 1)
  .vca({ threshold: -24, ratio: 2, attack: 30, release: 300 })
  .highshelf(10000, 1)
  .normalize(-14, 'lufs', { ceiling: -1 })
  .resample(44100)
  .dither(16)`, 'spotify'],
  ['Master', 'Mix-bus glue', 'An SSL bus compressor\'s gentle 2:1, about 1 dB, holding a mix together (Robjohns, SOS 2006)', `$src
  .normalize(-18, 'lufs', { ceiling: false })
  .vca({ threshold: -24, ratio: 2, attack: 30, release: 300 })`],
  ['Mix', 'De-ess a voice', 'Sibilance around 7.5 kHz pulled down, after the compression (Senior, SOS 2009)', `$src
  .normalize(-18, 'lufs')
  .deesser({ mode: 'band', fc: 7500, Q: 1 })`],
  ['Mix', 'Vocal, 1176 into LA-2A', 'Fast peaks caught, then an even level: series compression, as Universal Audio pairs them', `$src
  .highpass(80)
  .normalize(-18, 'lufs', { ceiling: false })
  .fet({ threshold: -12, ratio: 4, attack: 0.2, release: 50 })
  .opto({ threshold: -20, ratio: 3 })
  .deesser()
  .normalize(-18, 'lufs')`],
  ['Mix', 'Warm a vocal', 'Lows 50 to 150 Hz up 2 dB, the top rolled off as tape does, after a light 1.4:1 compression (White, SOS 2001)', `$src
  .normalize(-18, 'lufs', { ceiling: false })
  .compressor({ threshold: -24, ratio: 1.4, attack: 10, release: 150 })
  .eq(90, 2, 0.9)
  .tape({ mix: 0.5 })
  .normalize(-18, 'lufs')`],
  ['Mix', 'Parallel compression', 'A 20:1 copy under the voice: quiet passages up about 5 dB, loud ones as they were (Robjohns, SOS 2013)', `let dry = $src.normalize(-18, 'lufs', { ceiling: false })
let wet = dry.clone().compressor({ threshold: -25, ratio: 20, knee: 0, attack: 0.1, release: 100 })
dry.mix(wet).normalize(-18, 'lufs')`],
  ['Mix', 'Plate on a send', 'Abbey Road\'s: only 600 Hz to 10 kHz reaches the plate, 12 dB under the voice, so the space has no mud (Owsinski)', `let dry = $src
let send = dry.clone().highpass(600).lowpass(10000).plate({ decay: 0.6, damping: 0.3, mix: 1 })
dry.mix(send, 0, -12)`],
  ['Mix', 'Double a vocal (ADT)', 'A copy 4 to 8 ms late, its delay drifting, as Abbey Road\'s automatic double tracking (1966)', `$src.chorus({ rate: 0.3, depth: 0.3, delay: 0.006, voices: 1 })`],
  ['Mix', 'Slapback', 'One repeat 135 ms late, 9.5 dB under: Sun Studio\'s tape slap on Elvis', `$src.delay({ time: 0.135, feedback: 0, mix: 0.25 })`],
  ['Mix', 'Music bed under a voice', 'Open a track named music.wav: it plays 12 dB under the voice, 15 dB lower while it speaks', `let voice = $src.normalize(-18, 'lufs', { ceiling: false })
let bed = audio('music.wav').normalize(-30, 'lufs', { ceiling: false }).ducker({ key: voice.clone(), threshold: -40, range: -15, attack: 20, release: 500 })
voice.mix(bed).normalize('podcast')`, 'podcast'],
  ['Mix', 'Pultec low end', 'Boost and cut the lows at once: weight at 30 Hz, less mud at 120 Hz', `$src
  .lowshelf(60, 4)
  .eq(120, -2, 1)`],
  ['Mix', 'Mono bass', 'Below 120 Hz the same in both speakers, as vinyl and clubs need', `$src
  .midside({ mode: 'encode' })
  .highpass(120, 4, { channel: 1 })
  .midside({ mode: 'decode' })`],
  ['Master', 'AI track, settled', 'Suno or Udio: less mud and fizz, low end in mono, some dynamics back', `$src
  .midside({ mode: 'encode' })
  .highpass(120, { channel: 1 })
  .midside({ mode: 'decode' })
  .eq(500, -2, 1)
  .dyneq({ fc: 6500, threshold: -30, ratio: 3 })
  .unlimit({ amount: 3 })
  .normalize('spotify')`, 'spotify'],
  ['Edit', 'Ringtone', 'The first 30 seconds, faded', `$src
  .crop({ at: 0, d: 30 })
  .fade(0.5, 2)
  .normalize(-1)`],
  ['Edit', 'Loop', 'Trim the silence, then repeat', `$src.trim().repeat(4)`],
  ['Edit', 'Reverse', 'Play it backwards', `$src.reverse()`],
  ['Transform', 'Slow down', 'Longer, same pitch', `$src.stretch(1.25)`],
  ['Transform', 'Shift pitch', 'Lower by three semitones, same length', `$src.pitch(-3)`],
  ['Transform', 'Remove vocals', 'Karaoke: drop what is panned to the centre', `$src.vocals('remove')`],
  ['Transform', 'Isolate vocals', 'Keep what is panned to the centre', `$src.vocals()`],
  ['Transform', 'Telephone', 'A narrow, worn line: 300 Hz to 3.4 kHz, as ITU-T G.712 has it', `$src
  .remix(1)
  .highpass(300, 4)
  .lowpass(3400, 4)
  .distortion({ drive: 0.2 })
  .normalize(-18, 'lufs')`],
  ['Transform', 'AM radio', 'A voice off an AM set: mono, 100 Hz to 4.5 kHz, hiss, squeezed (Orban)', `let a = await $src.normalize(-18, 'lufs', { ceiling: false })
a.remix(1)
  .mix(audio.from(a.duration).noise(), 0, -38)
  .highpass(100, 4)
  .lowpass(4500, 8)
  .compressor({ threshold: -24, ratio: 4 })
  .normalize(-18, 'lufs')`],
  ['Transform', 'Hall', 'A large room around it', `$src.freeverb({ room: 0.85, mix: 0.3 })`],
  ['Transform', 'Lo-fi', 'Worn tape and vinyl', `$src.lofi()`],
  ['Generate', 'Tone', 'Any function of time t, in seconds', `audio.from(t => 0.5 * Math.sin(2 * Math.PI * 440 * t), { d: 2 })`],
  ['Generate', 'Zaps', 'A pitch falling from high, struck four times a second', `audio.from(t => {
  let s = t % 0.25
  return Math.sin(2 * Math.PI * (120 * s + 18 * (1 - Math.exp(-40 * s)))) * Math.exp(-12 * s)
}, { d: 2 })`],
  ['Generate', 'Beat', 'Kick and snare', `let kick = audio.from(0.5).kick(), snare = audio.from(0.5).snare()
audio([kick, snare, kick, kick, snare, kick, snare, snare])`],
  ['Generate', 'Game sound', 'Coin, laser, jump…', `audio.from(0.6).sfx({ preset: 'coin' })`],
  ['Generate', 'Noise', 'White, pink or brown', `audio.from(3).noise({ color: 'pink' })`],
  ['Analyze', 'Key and tempo', 'Musical key and beats per minute', `let a = $src
let key = await a.stat('key'), bpm = await a.stat('bpm')
console.log(key.label, key.mode, '·', Math.round(bpm), 'BPM')
a`],
  ['Analyze', 'Notes', 'Pitches over time', `let a = $src
console.log(await a.stat('notes'))
a`],
  ['Batch', 'Same edits, every file', 'Open several files; Export saves each', `for (let name of files)
  audio(name)
    .trim()
    .normalize('podcast')
    .save(name.replace(/\\.\\w+$/, '-clean.wav'))`]
].map(([group, name, text, code, spec]) => ({ group, name, text, code, spec }))
