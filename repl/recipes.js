// Scripts to start from, Process › Recipes' (where the link asks for them, ?ui= recipes). `$src` is the sound open as it is, its edits kept: a
// recipe that is one chain on it goes after the script's own (over the selection, when there is one), one of statements
// takes the script's sound for its source (repl.js useRecipe). A recipe made for a delivery spec names it: the page checks the output against it
// (fn/check.js). Their sources, their measured results and the ones still to join: .work/recipes.md; those the
// embedded chain offers (`offered`, below) have theirs beside each call.

// A recipe that is one chain on the sound, a call a line, each with where its numbers come from beside it
const steps = (...calls) => '$src' + calls.map(c => `\n  .${c}`).join('')
// The repair order three makers agree on, which those keep: what misleads every detector after it first (clipping,
// clicks), then the tonal (hum), then broadband noise, then breaths and sibilance, loudness last (iZotope, "Order of
// audio repair operations"; CEDAR, "Audio restoration"; Auphonic: "the loudness normalization must always be the last
// step"). 80 Hz, a voice's low-cut: Shure's KSM27 and Sound Devices' MM-1 manuals. An edit at its own defaults keeps
// the library's numbers (their sources in its README).
// Rumble is the record's vertical motion, the difference of its two channels (Macaulay, Wireless World 1978): taken
// from the side alone, the bass in the middle kept. A mono transfer, its channels summed, has that motion cancelled and
// no side to take it from: its code has none of those three steps (`mono`)
const vinyl = side => steps(
  'declip()',                            // CEDAR's order begins with declipping; untouched where no rail is found
  'declick()',                           // then the clicks, "always declick first" (CEDAR)
  'decrackle()',                         // then the crackle, the small impulses after the big ones (CEDAR)
  ...side ? ["midside({ mode: 'encode' })",
    'highpass(100, 4, { channel: 1 })',  // 100 Hz, 24 dB an octave: ours
    "midside({ mode: 'decode' })"] : [],
  'highpass(20, 4)',                     // the subsonic warp, CEDAR's DC filtering: 20 Hz, 24 dB an octave, ours
  'dewow()')                             // the speed's wander, after the filter (CEDAR); a steady disc untouched
const recipes = [
  ['Clean up', 'Clean up a voice recording', 'Clicks, pops, rumble, hum, noise, breaths and harsh s off a voice, its level as it was', steps(
    'declick()',        // ACX names mouth clicks among its defects
    'deplosive()',      // before the high-pass: it hears a pop in the band under 80 Hz (@audio/denoise)
    'highpass(80)',     // 80 Hz, before the noise is modelled
    'dehum()',          // finds 50 or 60 Hz itself, untouched where there is none
    'deepfilter()',     // steady and moving noise, 18 dB down
    'debreath()',       // breaths 12 dB down, variable noise after the steady (iZotope)
    'deesser()')],      // last: de-essed after the rest (Senior, Sound On Sound 2009)
  ['Clean up', 'Podcast voice', 'Tidy a spoken recording for a podcast', `$src
  .highpass(80)
  .trim()
  .normalize('podcast')
  .fade(0.05, 0.05)`, 'podcast'],
  // A voice cleaned and leveled, as Dolby's Enhance and Auphonic's Adaptive Leveler do: Dolby's order (the rumble, the
  // hum, the noise, plosives and sibilance, the leveling, the loudness last under a limiter), iZotope's clicks first.
  // The leveler measured on twenty Spoken Wikipedia narrations (60 s each, CC BY-SA; bench/speech.mjs's spoken/ and
  // spoken-train/), each also with its second half 12 dB down, a speaker farther off; LRA by EBU Tech 3342, loudness by
  // ITU-R BS.1770, as the library's stats compute them; 2026-11-15), staged at −20 LUFS first: as recorded, 5.1 LU on
  // average to 2.8; the halves 12 dB apart, 15.5 to 5.7 (each 3.4 to 7.4 but one, 23.4 to 15.7); a voice already
  // leveled, leveled again, 2.9 to 2.7, 0.2 dB louder; the pauses ride with their own speaker (the floor under each
  // half's voice: median +0.2 dB); no peak over −0.5 dBFS. Unstaged, a take at −34 LUFS or under was only made louder
  // (its 9 dB spent before any leveling), the halves 15.5 LU to 11.0: hence the stage
  ['Clean up', 'Enhance speech', 'Clicks, pops, rumble, hum, noise and harsh s off a voice, its level held even, podcast loudness', steps(
    'declick()',
    'deplosive()',
    'highpass(80)',
    'dehum()',
    'deepfilter()',
    'deesser()',
    "normalize(-20, 'lufs', { ceiling: false })", // staged at the leveler's target, so a quiet take is leveled too: ours, measured above
    'leveler({ target: -20, maxGain: 9 })',       // −20, the library's target; 9 dB at most, ours (Dolby keeps speech within "9dB and 6dB")
    "normalize('podcast')"), 'podcast'],          // last: Apple Podcasts' −16 LKFS, true peak not over −1 dBFS
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
  ['Clean up', 'Restore a vinyl record', 'Clicks, crackle, rumble and wow off a transfer, the bass kept', vinyl(true), null, { mono: vinyl(false) }],
  ['Clean up', 'Clean up a location recording', 'Wind, rumble, hum and noise off a voice recorded outdoors', steps(
    'dewind()',          // first, before anything that learns the noise; the voice's low harmonics kept
    'highpass(100, 4)',  // what wind leaves under a voice: 100 Hz (trade sources, 80 to 120), 24 dB an octave, ours
    'dehum()',
    'deepfilter()')],
  // Auphonic's multitrack order: each mic's level, the bleed of the other cut between turns (an expander for its gate),
  // the voices leveled, mixed, the loudness last; −20 LUFS a mic, the expander's and the leveler's values ours. Two
  // channels, a mic each (`channels`): offered to such a sound alone
  ['Clean up', 'Interview, two mics', 'One mic per channel: voices level, bleed cut, podcast loudness', `let a = $src.highpass(80)
let [l, r] = await a.stat('loudness', { channel: [0, 1] })
a.gain(-20 - l, { channel: 0 })
  .gain(-20 - r, { channel: 1 })
  .expander({ threshold: -40, ratio: 3, range: 20, release: 150 })
  .leveler({ target: -20, frame: 0.5, maxGain: 10 })
  .remix(1)
  .normalize('podcast')`, 'podcast', { channels: 2 }],
  // Damage undone, any sound's: no noise step, as noise reduction lowers music's scores (@audio/chain README); each edit
  // returns the sound as it came where it finds nothing to undo, the level alone then set
  ['Clean up', 'Repair a damaged recording', 'Clipped peaks rebuilt, clicks and hum taken out where they are found, the peak at −1 dB', steps(
    'declip()',          // first: "nothing cuts deeper than clipping" (iZotope); untouched where no rail is found
    'declick()',         // then the clicks (CEDAR, iZotope); attacks and plucks left alone
    'dehum()',           // then the hum (CEDAR, iZotope); untouched without one
    'normalize(-1)')],   // the rebuilt peaks stand over the old rail, so the level comes down after: −1 dB, ours
  ['Level', 'Loudness for streaming', '−14 LUFS, peaks under −1 dBTP', `$src.normalize('spotify')`, 'spotify'],
  ['Level', 'Loudness for broadcast', 'EBU R 128: −23 LUFS', `$src.normalize('broadcast')`, 'broadcast'],
  ['Level', 'Measure loudness', 'Integrated loudness, peak and loudness range', `let a = $src
let [lufs, peak, range] = await a.stat(['loudness', 'db', 'lra'])
console.log(\`\${lufs.toFixed(1)} LUFS · peak \${peak.toFixed(1)} dBFS · range \${range.toFixed(1)} LU\`)
a`],
  ['Deliver', 'Audiobook chapter', 'ACX: RMS −23 to −18 dB, peaks under −3 dB, room tone', steps(
    'declick()',                                 // ACX rejects "mouse clicks, excessive mouth noise"
    'deplosive()',                               // and "plosives, microphone pops"; before the high-pass
    'highpass(80)',                              // ACX's route begins with a low roll-off for speech (Audacity's manual)
    'dehum()',
    'omlsa({ gMin: -12 })',                      // the floor under ACX's −60 dB RMS, not dead silence: 10 of 10 narrations at −12 (.work/pro.md)
    "normalize(-20, 'rms', { ceiling: -3.5 })",  // ACX's RMS −23 to −18 and peak −3: Audacity's ACX route, RMS −20 dB, its limiter at −3.5 dB
    'trim()',
    'pad(1.5, 2)',                               // inside ACX's 1 to 5 s of room tone at each end
    'roomtone()',                                // the pads filled with the take's own room, no digital silence
    'resample(44100)'), 'acx'],                  // ACX's 44.1 kHz, last; the half dB under −3 covers the 0.23 dB a resample moves a peak (.work/recipes.md)
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
  ['Deliver', 'Podcast episode', 'Apple Podcasts: −16 LUFS, peaks under −1 dBTP', steps(
    'highpass(80)',
    'dehum()',
    'deepfilter()',
    'deesser()',                                 // reads sibilance against the voice at any level: no level set for it
    "normalize('podcast')"), 'podcast'],         // Apple Podcasts: −16 LKFS ± 1, true peak not over −1 dBFS
  ['Deliver', 'Voice for broadcast or video', 'EBU R 128: −23 LUFS, peaks under −1 dBTP', steps(
    'highpass(80)',
    'dehum()',
    'deepfilter()',
    'deesser()',
    "normalize('broadcast')"), 'broadcast'],     // EBU R 128-2023: −23.0 LUFS, true peak not over −1 dBTP, the whole programme measured
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
  // Matched to a song the user gives (`asks`: the file it is asked for as it is put on, kept under that name), the
  // Matchering method: master() matches the reference's tone in mid and side, its width, its loudness under −1 dBTP
  ['Master', 'Master a song to a reference', 'The tone, width and loudness of a song you give', steps(
    'highpass(20, 4)',                       // the subsonic out first: ours
    "master(audio('reference.wav'))"), null, { asks: 'reference.wav' }],
  ['Master', 'Master a song', 'Gentle multiband glue, streaming loudness under −1 dBTP', `$src
  .highpass(25)
  .multiband({ threshold: -20, ratio: 2 })
  .normalize('spotify')`, 'spotify'],
  ['Master', 'Master a song for streaming', 'Glued 2:1, at the players\' level: −14 LUFS, peaks under −1 dBTP', steps(
    'highpass(20, 4)',                                         // the subsonic out before the dynamics hear it: ours
    "normalize(-18, 'lufs', { ceiling: false })",              // staged, so the threshold means the same on every mix: −18 (0 VU), a convention
    'vca({ threshold: -24, ratio: 2, attack: 30, release: 300 })', // 2:1, "relatively subtle and transparent" (Robjohns, SOS 2006); the rest ours
    "normalize(-14, 'lufs', { ceiling: -1 })"), 'spotify'],     // Spotify plays at −14 LUFS and asks true peak at or under −1 dB: a playback level, not a rule
  // Warm, as Ozone's Vintage chain (an EQ, then compression, then the limiter) and BandLab's Tape: the saturation before
  // the compressor (an order no one publishes)
  ['Master', 'Master a song, warm', 'The lows a decibel up, tape\'s saturation and soft top, glued 2:1, at the players\' level', steps(
    'highpass(20, 4)',                                         // ours
    "normalize(-18, 'lufs', { ceiling: false })",              // staged, −18 (0 VU), a convention
    'lowshelf(100, 1)',                                        // "a decibel or two" between 50 and 150 Hz (White, SOS 2001); 100 Hz and 1 dB ours
    'tape({ mix: 0.5 })',                                      // the top taken off is "a little warmer" (White, SOS 2001); half of it, ours
    'vca({ threshold: -24, ratio: 2, attack: 30, release: 300 })', // 2:1 (Robjohns, SOS 2006); the rest ours
    "normalize(-14, 'lufs', { ceiling: -1 })"), 'spotify'],     // Spotify's −14 LUFS, true peak at or under −1 dB
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
let bed = audio('music.wav').normalize(-30, 'lufs', { ceiling: false }).ducker({ key: voice, threshold: -40, range: -15, attack: 20, release: 500 })
voice.clone().mix(bed).normalize('podcast')`, 'podcast'],
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
].map(([group, name, text, code, spec, more]) => ({ group, name, text, code, spec, ...more }))
export default recipes
// The code a recipe puts on a sound of `channels`: its own for one channel where it has one (a record's), else as written
export const codeFor = (recipe, channels) => channels === 1 && recipe.mono || recipe.code
// Whether a recipe is for a sound of `channels` (an interview's two mics, a channel each); any, where it is not known
export const fits = (recipe, channels) => !recipe.channels || !channels || recipe.channels === channels

// The recipes the embedded chain offers (?ui= edits chain, menus.js: one block at the top of its list, after the one
// automatic edit made for the sound's kind), each a goal's whole chain of two edits or more, put on at once: a voice
// cleaned, enhanced, an episode, a chapter or a programme ready for its platform, an interview, a voice recorded
// outdoors, a record restored, a song mastered (for streaming, to a reference, warm), a damaged take repaired (each
// call's numbers and their sources above). One edit is no recipe: the list's kinds hold every edit. Each its own icon,
// drawn as the edits' are (repl/icons.js: a 24 grid, the stroke the row's), none an edit's. Those a sound's kind is
// offered first: kind.js OFFERS; the rest after them, in this order. Another joins as these do: a recipe above, its
// name and its icon here, the kinds it is for there. No room's echo: iZotope's two passes, the late tail first (wpe),
// then the model at 40 dB, took 4.9 dB more of the tail than the model alone and 1.7 dB more of the voice, PESQ
// 0.32 ± 0.08 lower, STOI 0.941 to 0.907 (46 reverberant VoiceBank takes in 19 MIT rooms: bench/rx/dereverb.mjs's test
// set and scores, 2026-11-15), so a room is the one edit, Dereverb, till a de-echo joins it
export const offered = [
  ['Clean up a voice recording', 'M12 3a3 3 0 0 0-3 3v5a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3ZM6 11a6 6 0 0 0 12 0M12 17v4M19 3v4M17 5h4'],
  ['Enhance speech', 'M2 4h20M2 20h20M4 10v4M8 8v8M12 9v6M16 8v8M20 10v4'],
  ['Podcast episode', 'M12 13.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3ZM8.5 15.5a5 5 0 1 1 7 0M5.6 18.4a9 9 0 1 1 12.8 0M12 13.5V21'],
  ['Audiobook chapter', 'M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5v-15ZM20 18v3H6.5M8 7h8'],
  ['Voice for broadcast or video', 'M3 8h18v12H3V8ZM8 3l4 5 4-5'],
  ['Interview, two mics', 'M7 3a2.5 2.5 0 0 0-2.5 2.5v4a2.5 2.5 0 0 0 5 0v-4A2.5 2.5 0 0 0 7 3ZM17 3a2.5 2.5 0 0 0-2.5 2.5v4a2.5 2.5 0 0 0 5 0v-4A2.5 2.5 0 0 0 17 3ZM7 12v9M17 12v9'],
  ['Clean up a location recording', 'M3 8h11a3 3 0 1 0-3-3M3 12h16a3 3 0 1 1-3 3M3 16h7'],
  ['Restore a vinyl record', 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM12 14a2 2 0 1 0 0-4 2 2 0 0 0 0 4ZM12 6.5A5.5 5.5 0 0 0 6.5 12'],
  ['Master a song for streaming', 'M4 20h16M6 17V11M10 17V6M14 17V9M18 17V4'],
  ['Master a song to a reference', 'M3 8c2-3 4-3 6 0s4 3 6 0 4-3 6 0M3 16c2-3 4-3 6 0s4 3 6 0 4-3 6 0'],
  ['Master a song, warm', 'M12 3c3 4 5 6.5 5 10a5 5 0 0 1-10 0c0-2 1-3.5 2-5 .5 2 1.5 3 3 3 0-3-1-5 0-8Z'],
  ['Repair a damaged recording', 'M2 12h2l2-7h4l2 7 2 7h4l2-7h2M3 5h18M3 19h18']
].map(([name, icon]) => ({ ...recipes.find(r => r.name === name), icon }))
