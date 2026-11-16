// What a sound is, in a word, from what two listeners say of the stretches of it they are given (worker.js kind).
//
// The first, inaSpeechSegmenter's speech/music/noise classifier (@audio/neural-denoise 0.7's segments(): its weights
// are in the package, nothing fetched), tells speech from music from the rest. On that package's labelled test sets
// (its scripts/accuracy.mjs kinds test) it names 98.2% or more of the active frames of speech as speech (clean, in
// noise, under hiss, over a music bed, narrated) and all of a song's, an accompaniment's and a band's as music. A
// voice singing alone falls between the two (57% music, 38% speech). What is neither it calls noise, and of noise
// alone (DEMAND's rooms and streets) it takes 14% of the frames for speech and 8% for music. So its speech and its
// music are said, and its noise is not: a blackbird is noise to it, and so is a door.
//
// The second, YAMNet (@audio/neural-tag: AudioSet's 521 classes; its model, 7.5 MB, and the ONNX runtime fetched on
// first use), is asked only where the first has no word: it names the rest, a blackbird, a trumpet, rain, a telephone
// (`called`, below). Nothing is said that neither can say.

// What of a sound is heard: the whole of it up to LISTENED s, in equal parts of STRETCH s at most; past that, stretches
// of STRETCH s spread evenly from its start to its end. In parts, each a task of its own in the worker, so that it is
// never held longer than one takes: the first listener's work on a minute in one piece would hold it about a second.
// The price, read off 19 excerpts of 12 to 55 s heard whole and in parts (2026-11-12): 18 the same word, the one that
// differs on the bar (speech 77%, music 23% whole; 75%, 25% in parts); a park's 30 s 0% speech whole, 40% in parts
export const LISTENED = 60, STRETCH = 10
/** spans(end) → [[from, to]], in seconds: the stretches heard of a sound `end` s long; none of an empty one */
export function spans(end) {
  const n = Math.ceil(end / STRETCH), k = LISTENED / STRETCH
  return end <= LISTENED ? Array.from({ length: n }, (_, i) => [end * i / n, end * (i + 1) / n]) : Array.from({ length: k }, (_, i) => { const p = (end - STRETCH) * i / (k - 1); return [p, p + STRETCH] })
}

// every sample under this, −70 dBFS: silence
const QUIET = 10 ** (-70 / 20)
// two kinds are both said where each holds this share of the time heard, or more
const BOTH = .25

/** shares(parts) → the share of the time heard each kind holds, { speech, music, noise }: parts, a stretch's segments each ([{ kind, start, end }]) */
export function shares(parts) {
  const held = { speech: 0, music: 0, noise: 0 }
  for (const segments of parts) for (const { kind, start, end } of segments) held[kind] += end - start
  const all = held.speech + held.music + held.noise
  return all ? { speech: held.speech / all, music: held.music / all, noise: held.noise / all } : null
}

/** word(shares) → 'speech', 'music', 'speech and music' (each a quarter of it or more), or '' where it is mostly neither: unnamed */
export const word = s => !s ? '' : s.speech >= BOTH && s.music >= BOTH ? 'speech and music' : s.speech >= s.music && s.speech >= s.noise ? 'speech' : s.music >= s.noise ? 'music' : ''

// What YAMNet's classes are called here: the particular ones, and the general ones, which give way to any particular
// one. A class names the sound where its mean score over what was heard is NAMED or more: its scores are not
// calibrated across classes (its model card says so), so the bar is high. Of the instruments' families (brass,
// woodwind, bowed, plucked, mallet) none is said: it called a bassoon a brass instrument (0.58) and a celesta a
// vibraphone (0.36), a blackbird a bird's song (0.73), a violin, a clarinet, a trumpet and a harp by their names
// (0.58 to 0.69), a guitar and a piano music alone (their own 0.23 and 0.42); read off the EBU's SQAM excerpts and
// this site's blackbird, 2026-11-12. Its Silence is not said: silence is what is under QUIET, and a quiet river bank
// (DEMAND's, Silence 0.60) is none
const NAMED = .5
const GENERAL = { Speech: 'speech', Music: 'music', Animal: 'animal', Bird: 'birds', Insect: 'insects', Water: 'water', Vehicle: 'vehicle', Engine: 'engine', Noise: 'noise' }
const PARTICULAR = {
  Laughter: 'laughter', 'Baby cry, infant cry': 'baby crying', Singing: 'singing', Choir: 'choir', Rapping: 'rap', Humming: 'humming', Whistling: 'whistling', Snoring: 'snoring', Cough: 'coughing',
  'Walk, footsteps': 'footsteps', Clapping: 'clapping', Applause: 'applause', Cheering: 'cheering', Crowd: 'crowd', 'Heart sounds, heartbeat': 'heartbeat',
  Dog: 'dog', Bark: 'dog barking', Cat: 'cat', Purr: 'cat purring', Meow: 'cat', Horse: 'horse', 'Cattle, bovinae': 'cattle', Pig: 'pig', Sheep: 'sheep', Goat: 'goat', 'Chicken, rooster': 'chickens', Duck: 'ducks',
  'Bird vocalization, bird call, bird song': 'birdsong', 'Chirp, tweet': 'birdsong', 'Pigeon, dove': 'pigeons', Crow: 'crows', Owl: 'owl', Cricket: 'crickets', 'Bee, wasp, etc.': 'bees', Frog: 'frogs', 'Whale vocalization': 'whale song',
  Guitar: 'guitar', 'Electric guitar': 'electric guitar', 'Bass guitar': 'bass guitar', 'Acoustic guitar': 'acoustic guitar', Banjo: 'banjo', Sitar: 'sitar', Mandolin: 'mandolin', Ukulele: 'ukulele',
  Piano: 'piano', 'Electric piano': 'electric piano', Organ: 'organ', Synthesizer: 'synthesizer', Harpsichord: 'harpsichord',
  'Drum kit': 'drums', 'Drum machine': 'drum machine', Drum: 'drums', Timpani: 'timpani', Tabla: 'tabla', Cymbal: 'cymbals', Gong: 'gong', 'Marimba, xylophone': 'marimba', Glockenspiel: 'glockenspiel', Vibraphone: 'vibraphone', Steelpan: 'steelpan',
  Orchestra: 'orchestra', 'French horn': 'french horn', Trumpet: 'trumpet', Trombone: 'trombone', 'Violin, fiddle': 'violin', Cello: 'cello', 'Double bass': 'double bass', Flute: 'flute', Saxophone: 'saxophone', Clarinet: 'clarinet', Harp: 'harp',
  Bell: 'bell', 'Church bell': 'church bells', Harmonica: 'harmonica', Accordion: 'accordion', Bagpipes: 'bagpipes', Didgeridoo: 'didgeridoo', Theremin: 'theremin', 'Singing bowl': 'singing bowl', Beatboxing: 'beatboxing', Opera: 'opera', 'A capella': 'a cappella',
  Wind: 'wind', 'Wind noise (microphone)': 'wind noise', Thunderstorm: 'thunderstorm', Thunder: 'thunder', Rain: 'rain', 'Rain on surface': 'rain', Stream: 'stream', Waterfall: 'waterfall', Ocean: 'ocean', 'Waves, surf': 'waves', Fire: 'fire',
  Car: 'car', 'Traffic noise, roadway noise': 'traffic', Train: 'train', 'Subway, metro, underground': 'subway', Aircraft: 'aircraft', Helicopter: 'helicopter', Motorcycle: 'motorcycle', Siren: 'siren',
  Typing: 'typing', 'Computer keyboard': 'typing', 'Vacuum cleaner': 'vacuum cleaner', 'Dishes, pots, and pans': 'dishes', Door: 'door', Knock: 'knocking', Alarm: 'alarm', Telephone: 'telephone', 'Telephone bell ringing': 'telephone ringing', Ringtone: 'ringtone', 'Dial tone': 'dial tone', 'Busy signal': 'busy signal', 'Alarm clock': 'alarm clock', 'Tick-tock': 'clock ticking',
  Explosion: 'explosion', Fireworks: 'fireworks', 'Beep, bleep': 'beep', 'Sine wave': 'sine tone', 'White noise': 'white noise', 'Pink noise': 'pink noise', Static: 'static', 'Mains hum': 'mains hum'
}
/**
 * likest(tags) → [[word, score]]: what YAMNet heard the sound as, tags its classes scored ([{ name, score }], the means
 * over the sound): the classes of NAMED or more that have a word here, the particular ones where there are any, else the
 * general ones (a blackbird's Animal, Wild animals and Bird, 0.80 each, say no more than its bird song, 0.73), by score,
 * each word once at its best
 */
export function likest(tags) {
  const named = tags.filter(t => t.score >= NAMED), words = named.some(t => PARTICULAR[t.name]) ? PARTICULAR : GENERAL
  return named.filter(t => words[t.name]).sort((a, b) => b.score - a.score).map(t => [words[t.name], t.score]).filter(([w], i, all) => all.findIndex(([v]) => v === w) === i)
}
/** called(tags) → the word for what YAMNet heard: the best particular class of NAMED or more, else the best general one, else '' (likest's first) */
export const called = tags => likest(tags)[0]?.[0] ?? ''

// What each kind of sound is commonly given next: the edits an embedded editor suggests for a sound of the reader's,
// and for the page's own where the page names none (repl/editor/menus.js suggested), by the word for it, in the order
// they go in a chain, each a call as an embedding page's ops write it (repl/editor/config.js quickOf); '', the general
// row: a sound with no word, or a word with no row. Each a step of the recipes (repl/recipes.js; their sources,
// .work/recipes.md), its values a preset of the library's (fn/specs.js, fn/check.js its sources) or the edit's own
// default. A word heard here and not in it (silence, an instrument, a bird, rain) has no practice named for it yet
export const NEXT = {
  // the edits any sound is given: trimmed (the library's threshold), normalized (its peak to 0 dBFS, the library's),
  // faded in and out (0.5 s each, a fade's own settings as its card opens: repl/ops.js)
  '': ['trim', 'normalize', 'fade(0.5, 0.5)'],
  // the Podcast voice and Narration recipes' order: the rumble, handling and plosive thumps under a voice, below 80 Hz;
  // the noise (DeepFilterNet3, 18 dB down, fn/deepfilter.js); every pause to 0.3 s (shrink's own); Apple Podcasts'
  // −16 LUFS, peaks under −1 dBTP
  speech: ['highpass(80)', 'deepfilter', 'shrink(0.3)', "normalize('podcast')"],
  // a song as a player learns it, as Transcribe! and Moises slow, transpose and take the voice out of one (the Slow
  // down and Shift pitch recipes: 1.25× as long, three semitones down; Remove vocals: the centre taken out); Spotify's
  // playback level, −14 LUFS, peaks under −1 dBTP
  music: ['stretch(1.25)', 'pitch(-3)', "vocals('remove')", "normalize('spotify')"],
  // a voice over a bed, an episode or a scene: the noise taken off the voice and the music passed untouched
  // (deepfilter's own `music: 'pass'`); the episode at Apple Podcasts' −16 LUFS, which is of the whole of it
  'speech and music': ['deepfilter', "normalize('podcast')"]
}
// The recipes each kind is offered first (repl/recipes.js offered, by name), as NEXT gives its edits: the same kinds,
// a sound with no word or a word with no row offered the general row (''), the rest of the recipes after the row in
// their own order. A voice: cleaned, its platforms, enhanced; music: mastered for streaming, to a reference, warm, a
// record, a damaged take; a voice over a bed: the episode, the voice, the master; wind or hum heard: the clean-up of a
// voice recorded outdoors, made for them (it takes wind and hum away, so a sound of rain or of a blackbird is not
// offered it first); anything else: the one repair that harms no sound, a damaged one's (where nothing is damaged, the
// peak alone set to −1 dB)
export const OFFERS = {
  '': ['Repair a damaged recording'],
  speech: ['Clean up a voice recording', 'Podcast episode', 'Audiobook chapter', 'Voice for broadcast or video', 'Enhance speech'],
  music: ['Master a song for streaming', 'Master a song to a reference', 'Master a song, warm', 'Restore a vinyl record', 'Repair a damaged recording'],
  'speech and music': ['Podcast episode', 'Clean up a voice recording', 'Master a song for streaming'],
  'wind noise': ['Clean up a location recording'],
  'mains hum': ['Clean up a location recording']
}
/** rowFor(table, kind) → a kind's own row of NEXT or OFFERS, else the general one: the one rule both are read by */
export const rowFor = (table, kind) => kind && Object.hasOwn(table, kind) ? table[kind] : table['']

/**
 * kindOf(heard, rate, { segments, tag }) → { kind, shares, tags, like }: what the stretches `heard` (mono, at `rate`)
 * are, in a word; 'silence' where nothing sounds; '' where no listener is there to say or what is heard has no name
 * here. `segments`, the first listener (@audio/neural-denoise's); `tag`, the second ((x, rate) → every class scored,
 * @audio/neural-tag's), asked where the first has no word, over the stretches end to end; `tags`, its five best then;
 * `like`, the first three of likest over all it scored ([[word, score]]), what it heard the sound as.
 */
export async function kindOf(heard, rate, { segments, tag } = {}) {
  if (!heard.some(x => x.some(v => v >= QUIET || v <= -QUIET))) return { kind: 'silence' }
  let held = null
  if (segments) { const parts = []; for (const x of heard) parts.push(await segments(x, rate)); held = shares(parts) }
  const kind = word(held)
  if (kind || !tag) return { kind, ...held && { shares: held } }
  const all = new Float32Array(heard.reduce((n, x) => n + x.length, 0))
  heard.reduce((at, x) => (all.set(x, at), at + x.length), 0)
  const tags = await tag(all, rate).catch(() => null)
  return { kind: tags ? called(tags) : '', ...held && { shares: held }, ...tags && { tags: [...tags].sort((a, b) => b.score - a.score).slice(0, 5).map(({ name, score }) => ({ name, score })), like: likest(tags).slice(0, 3) } }
}
