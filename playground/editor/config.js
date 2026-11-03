import { ops, CURVES, labelOf, format, icons as groupIcons } from '../ops.js'
import opIcons from '../icons.js'
import { keep as keepFile } from '../keep.js'
import { methods as scrubbers } from '../scrub-methods.js'
import { MAPS } from '../tint.js'

// The editor as the page is given it: its root, the link's parameters, what this browser stored, and the lists and
// constants its menus, settings and exports offer

export const root = document.querySelector('#app')
// Embedded in another page (embed.js, <audio-repl>): one script, the link's; nothing read from this browser or kept in
// it, no other editor's tabs touched; its panel and its picture as the page asks (?panel=code|edits|none, ?display=spec)
export const params = new URLSearchParams(location.search), EMBED = params.has('embed')
// In the Mac app (?desktop, index.html): the input held as a DAW holds it (below, sources.js hold)
export const DESKTOP = params.has('desktop')
// Embedded, all the page asks of the picture and its parts, as one JSON (?ui=, embed.js builds it): panel, display,
// controls (the parts shown, index.html and editor.css name them; a level among them what the readout reads, and
// without ruler, no time row), ops (the edits a press away, as `stretch(1.25)`), background (the page's ground, to
// sit on and to fade into), zoom and overshoot (how far time zooms, and scrolls past the sound's end), scroll (what
// scrolls it: `scrolls`): README.md. A link from before it, ?panel= and ?display=, reads the same.
export const UI = !EMBED ? {} : (() => { try { return { panel: params.get('panel') ?? undefined, display: params.get('display') ?? undefined, ...JSON.parse(params.get('ui') || '{}') } } catch { return {} } })()
export const SHOWN = Array.isArray(UI.controls) ? UI.controls : []
// each quick edit: its call, with its own arguments or, as the menus write it, the defaults the library can't do
// without; its icon; its arguments as the edit's own settings read, each in its unit (none where one is not a plain
// value: a range, a curve); null for a call not of the edits (ops.js)
export const quickOf = call => {
  const [, name, args] = String(call).match(/^([\w-]+)(?:\(([^)]*)\))?$/) ?? []
  if (!ops[name]) return null
  const values = args && !/[{[]/.test(args) ? args.split(',').map((a, i) => format(Number.isNaN(+a) ? a.trim().replace(/^['"]|['"]$/g, '') : +a, ops[name].params?.[i])).join(' · ') : ''
  return { name, args, icon: opIcons[name] ?? groupIcons[ops[name].group], label: labelOf(name), text: ops[name].text, values }
}
export const QUICK = (Array.isArray(UI.ops) ? UI.ops : []).map(quickOf).filter(Boolean)
// A page given whole in its link, ?state=<what the page keeps, as JSON>: its tabs, what each selects, its panels, as a
// page left them (playground/themes.html stages its specimens so); like an embedded one, nothing read from this
// browser or kept in it, no other editor's tabs touched; dressed by the page around it (below)
export const GIVEN = !EMBED && params.has('state') ? (() => { try { return JSON.parse(params.get('state')) ?? {} } catch { return {} } })() : null
export const APART = EMBED || !!GIVEN
// a sound opened or recorded, kept for the next visit; embedded, held for this one alone, as it is
export const keep = APART ? async (name, data) => data : keepFile
export const generators = [
  ['Tone', '440 Hz, any function of time', `audio.from(t => 0.5 * Math.sin(2 * Math.PI * 440 * t), { d: 2 })`],
  ['Noise', 'White, pink or brown', `audio.from(3).noise({ color: 'pink' })`],
  ['Sweep', '20 Hz to 20 kHz', `audio.from(5).chirp()`],
  ['Pluck', 'A plucked string', `audio.from(2).pluck({ freq: 220 })`],
  ['Bell', 'A struck bar', `audio.from(3).modal({ freq: 440 })`],
  ['Kick', 'A kick drum', `audio.from(0.6).kick()`],
  ['Game sound', 'Coin, laser, jump…', `audio.from(0.6).sfx({ preset: 'coin' })`],
  ['Click track', '120 beats a minute', `audio.from(4).rhythm({ bpm: 120 })`],
  ['Silence', 'Three seconds', `audio.from(3)`]
].map(([name, text, code]) => ({ name, text, code }))
export const formats = [['wav', 'Uncompressed'], ['flac', 'Lossless, smaller'], ['mp3', 'Compressed'], ['ogg', 'Compressed, Vorbis'], ['aiff', 'Uncompressed, Apple']].map(([name, text]) => ({ name, text }))
// What a format is written with (the library's encode options, fn/save.js, audio.d.ts EncodeOpts): a lossless one's
// sample depth (the depths it writes; by default the source's, 16 when unknown), MP3's constant bitrate in kbps (by
// default its encoder's VBR), Ogg Vorbis's quality from 0 to 10; null, the default
export const ENCODING = {
  wav: ['bitDepth', 'Bits', [16, 24, 32], v => v === 32 ? '32 float' : `${v}`],
  aiff: ['bitDepth', 'Bits', [16, 24], v => `${v}`],
  flac: ['bitDepth', 'Bits', [16, 24], v => `${v}`],
  mp3: ['bitrate', 'Bitrate', [128, 192, 256, 320], v => `${v}k`],
  ogg: ['quality', 'Quality', [3, 5, 7, 9], v => `q${v}`]
}
// The depth a lossless format writes (fn/save.js encodeOpts): the one chosen, where the format writes it; else the
// smallest it writes that holds the source's, 16 for a source of 16 or less or of no depth (a lossy file, a generated
// sound); null for a lossy format. What each is for
export const writtenDepth = (format, chosen, source) => {
  const e = ENCODING[format]
  if (e?.[0] !== 'bitDepth') return null
  return e[2].includes(chosen) ? chosen : source > 16 ? e[2].find(d => d >= source) ?? e[2].at(-1) : 16
}
export const DEPTH_USE = { 16: 'CD, most players', 24: 'Masters, further editing', 32: 'Never clips' }
export const mime = { wav: 'audio/wav', flac: 'audio/flac', mp3: 'audio/mpeg', ogg: 'audio/ogg', aiff: 'audio/aiff', m4a: 'audio/mp4', edl: 'text/plain', otio: 'application/json', fcpxml: 'application/xml' }
// The cuts as an edit list for a video editor (the library's cuts(): where each piece of the source goes, at a frame
// rate), and the rates offered: the video's own (its file's), film, PAL, NTSC's and their round neighbours
export const cutFormats = [['edl', 'EDL', 'CMX 3600: every video editor reads it'], ['otio', 'OTIO', 'OpenTimelineIO: DaVinci Resolve, and others through its adapters'], ['fcpxml', 'FCPXML', 'Final Cut Pro']].map(([name, label, text]) => ({ name, label, text }))
export const frameRates = [null, 23.976, 24, 25, 29.97, 30]
// The formats that keep markers in the file (fn/save.js): a WAV's cue points, an MP3's chapters (ID3 CHAP)
export const KEEPS = { wav: 'as cue points', mp3: 'as chapters' }
// Icons of acts no method is (a method's own are icons.js's): a lane with a gap where a piece left it, the piece gone
// down to a lane of its own
export const icons = { track: 'M3 7h5m8 0h5M3 17h18M12 5v8m-3-3 3 3 3-3' }
// What the picture shows besides the sound, each a thing to grab where it is, none a mode: the cues (with ⌘ held, a
// drag of one moves it and the audio around it stretches), the pitch curve (dragged, the whole pitch line), the gain
// line (its points drag; a press on the line adds one). The meters at the right are each look's own (optionGroups):
// the waveform's level (`meters`), the spectrogram's spectrum (`spectrum`)
export const overlays = [['hits', 'Cues', 'Where sounds start, end and hit'], ['gain', 'Gain line', 'While its step is chosen in the edits: drag its points'], ['guides', 'Guides', 'What the hovered edit sets']]
// The cues (worker.js), both kinds as one, [{ t, rank, kind }]: the edges of the pauses, where a voice's words or a solo's
// phrases start and end, and the hits, where the level jumps up (a strike, a struck or plucked note, a word struck);
// one of each within 30 ms is one place, the edge's, which its attack placed
export function cueTimes(edges, hits) {
  const near = t => edges.some(e => Math.abs(e.t - t) < .03)
  return [...edges, ...hits.filter(h => !near(h.t))].sort((a, b) => a.t - b.t)
}
// How the time row marks time: labels and their ticks, ticks alone, or nothing but the times that matter now (the caret's,
// the pointer's, a selection's)
export const rulers = [['labels', 'Labels'], ['ticks', 'Ticks'], ['none', 'None']].map(([name, label]) => ({ name, label }))
// what scrolls the view, zoomed in: a bar at the time row's foot, always or only when reached for, or the whole sound
// under it, as a minimap
export const scrolls = [['bar', 'Bar', 'A thin bar at the time row\'s foot, the part of the sound in view'], ['hover', 'Bar on hover', 'The bar shown only while the pointer is over the picture, and for a second after the view is scrolled or zoomed by keys or touch'], ['overview', 'Overview', 'The whole sound in a strip under the time row, the part in view lit: pressed, the view goes there; dragged, it moves']]
// How the lanes are ruled (view.js paintGrid), behind the waveform and over the spectrogram, by the time row's ticks and
// the axis' on the right: bare, or a faint line from each tick
export const grids = [
  ['none', 'None', 'The lanes bare'],
  ['lines', 'Lines', 'A faint line from each tick across the lanes']
]
// The spectrogram's look: grey, the screen to its ink (white, or a theme's foreground), so the page shows through where
// the sound is quiet and the louder is the inkier; or a colormap (tint.js MAPS, the waveform's too: matplotlib's magma,
// inferno and viridis, and the colour of light); bent by a gamma (a level's share of the range raised to it: under 1
// the quiet parts show brighter); the dB from the loudest down to the floor; the FFT size, else 40 ms and more on a
// zoomed band (gl-spectrogram)
export const LOOK = { map: 'grey', gamma: 1, depth: 80, size: null, method: 'reassigned' }
export const looks = { map: ['grey', ...Object.keys(MAPS)], gamma: [.5, .75, 1, 1.5], depth: [60, 80, 100, 120], size: [null, 1024, 2048, 4096] }
// How a column draws its frames (gl-spectrogram's methods, after the lab's Seeing sound: audiojs.dev/lab/spectrogram),
// those an editor's display is served by, as RX's are (a plain STFT, reassignment, multi-resolution): measured against
// frames on tones, two tones 50 Hz apart, clicks, a chirp and noise, synchrosqueezing never beat reassignment (a click a
// frame wide, a fast chirp 9 Hz off where reassignment is 1 Hz), and Wigner–Ville drew a ghost between any two tones as
// bright as they are and tilted noise 8 dB up the octaves; neither is offered. Tapers neither: noise steadier, all else
// wider, a floor's reading, which the spectrum meter is for
export const specMethods = [
  ['frames', 'Frames', 'Each column its frame\'s spectrum, as it is: no sharper than the frame'],
  ['reassigned', 'Reassigned', 'Each bin\'s energy where its phase puts it: a tone one row thin, a click one column'],
  ['bands', 'By band', 'Long frames for the lows, short for the highs, as editors blend them']
]
// The colormaps, the spectrogram's and the waveform's one list (tint.js MAPS), each its name and what it is
export const mapNames = Object.fromEntries(['grey', ...Object.keys(MAPS)].map(m => [m, [m[0].toUpperCase() + m.slice(1), m === 'grey' ? 'The screen\'s ink, the page through it' : m === 'temperature' ? 'The colour of light: a coal\'s red, a candle\'s orange, daylight\'s white, a clear sky\'s blue' : `Matplotlib's ${m}`]]))
// The waveform's look (view.js waveLook, after the lab's waveforms, audiojs.dev/lab/waveform): coloured for what it holds
// in frequency, as DJ software and DAWs colour it (tint.js coloured), in a colormap; its levels zoomed out as heard
// (view.js weigh); its channels in a lane each or one, its fill. Ableton Live and Logic Pro colour none by frequency
export const WAVE = { colour: 'none', lanes: 'split', fill: 'density', map: 'temperature', weighting: 'none' }
export const waveLooks = {
  colour: [
    ['none', 'One colour', 'The screen\'s'],
    ['bands', 'RGB', 'Lows red, mids green, highs blue, mixed as light: as Serato, rekordbox and Mixxx colour it'],
    ['layers', 'Three bands', 'Lows, mids and highs each its own waveform, lows under mids under highs, in the colormap: as rekordbox\'s 3Band'],
    ['centroid', 'Centroid', 'Where its spectrum centres, in the colormap: as FL Studio colours it'],
    ['dominant', 'Dominant', 'Its strongest frequency in the colormap, greyer the noisier: as REAPER colours it']
  ],
  // low at a map's middle, high at the end that reads against the screen (tint.js colormap); temperature's warm low and
  // cool high, at the waveform's lightness
  map: Object.entries(mapNames).map(([m, [name, hint]]) => [m, name, hint]),
  // zoomed out, its levels weighted as the ear weighs them; zoomed in, its samples as they are. K first: against 97
  // listeners matching the loudness of broadcast sound, K's high-pass (RLB) read it best of 12 meters and A 11th, worse
  // than none at all (Soulodre 2004, Canadian Acoustics 32(3), Table 1)
  weighting: [['none', 'None', 'Its levels as they are'], ['k', 'K-weighted', 'Zoomed out, as loud as it sounds: ITU-R BS.1770\'s K, the loudness meters\' weighting; zoomed in, its samples'], ['a', 'A-weighted', 'Zoomed out, as a sound level meter weighs it, the ear at a quiet 40 phon: IEC 61672\'s A; zoomed in, its samples']],
  lanes: [['split', 'A lane each', 'Each channel on its own'], ['one', 'One lane', 'All the channels over each other, each its own hue']],
  // gl-waveform's three densities (the generalized normal at β 2, 1 and 4, Nadarajah 2005), its RMS band, its peaks
  fill: [['density', 'Density', 'Brighter where the sound is most often: a full body'], ['cloud', 'Cloud', 'A soft cloud, bright at the axis, fading early: as speech spreads (Gazor & Zhang 2003)'], ['body', 'Body', 'One shade to about its RMS, soft past it'], ['rms', 'RMS', 'A lighter core as loud as its RMS'], ['flat', 'Flat', 'One solid shade, peak to peak']]
}
// How the waveform's level axis writes levels: decibels from full scale, mirrored about the centre line, or the sample
// values themselves, signed
export const levelList = [['db', 'Decibels', '−6dB', 'dB'], ['linear', 'Sample values', '0.5', '±1']].map(([name, label, example, short]) => ({ name, label, example, short }))
// The frequency scales the settings choose between (scale.js)
export const scaleNames = { log: 'Octaves', mel: 'Mel', erb: 'ERB', lin: 'Hertz' }
// A fade's curves, as the library names them (audio.op('fade').curves), each drawn as it fades in, as its handle on the picture draws
// it; out, the other way
const curveIcon = (name, out = false) => 'M' + Array.from({ length: 13 }, (_, i) => `${out ? 20 - 16 * i / 12 : 4 + 16 * i / 12} ${+(20 - 16 * CURVES[name](i / 12)).toFixed(2)}`).join('L')
export const curves = [['linear', 'Linear'], ['exp', 'Exponential'], ['log', 'Logarithmic'], ['cos', 'S-curve']].map(([name, label]) => ({ name, label, icon: curveIcon(name) }))
// The context menu's own: up and down a level, a marker's place, all of it, zoom to it, find
export const glyphs = { up: 'M12 19V5m-6 6 6-6 6 6', down: 'M12 5v14m-6-6 6 6 6-6', marker: 'M6 21V4h11l-2.5 4 2.5 4H6', all: 'M4 8V4h4m8 0h4v4m0 8v4h-4M8 20H4v-4', zoom: 'M4 9V4h5m6 0h5v5m0 6v5h-5m-6 0H4v-5', find: 'M11 17a6 6 0 1 0 0-12 6 6 0 0 0 0 12Zm4.5-1.5L20 20' }
// What the grip past a selection's end does to its length, chosen from a click on it: cuts it back or adds silence
// (remove, insert), stretches it, the pitch kept (fn/stretch.js), or speeds it, the pitch following, as a tape
// (fn/speed.js)
export const gripModes = [['trim', 'Trim', 'Cut back, or silence added'], ['stretch', 'Stretch', 'The pitch kept'], ['speed', 'Speed', 'The pitch follows, as a tape’s']].map(([name, label, text]) => ({ name, label, text }))
// The settings' icon, on the 24 grid of the others: three faders lying down, as a phone's settings draw them, 16 units
// across as the others' weight is, their knobs 4.5 across, staggered; the agent's, a spark; the recipes', an open book
export const SETTINGS_ICON = 'M4 6h7.75m4.5 0H20M4 12h2.75m4.5 0H20M4 18h8.75m4.5 0H20M14 8.25a2.25 2.25 0 1 1 0-4.5 2.25 2.25 0 0 1 0 4.5Zm-5 6a2.25 2.25 0 1 1 0-4.5 2.25 2.25 0 0 1 0 4.5Zm6 6a2.25 2.25 0 1 1 0-4.5 2.25 2.25 0 0 1 0 4.5Z'
export const AGENT_ICON = 'M12 3c.6 4.7 4.3 8.4 9 9-4.7.6-8.4 4.3-9 9-.6-4.7-4.3-8.4-9-9 4.7-.6 8.4-4.3 9-9Z'
export const RECIPES_ICON = 'M3 5h5a4 4 0 0 1 4 4v11a3 3 0 0 0-3-3H3Zm18 0h-5a4 4 0 0 0-4 4v11a3 3 0 0 1 3-3h6Z'
// What a band shows: the waveform, the spectrogram or the notes, one at a time (each zooms its own way), chosen by its
// look (a sound's in its foot under its axis, a track's in its layer), from its track's menu, or for every band from View
export const displays = [['wave', 'Waveform', 'The samples, their levels on the axis'], ['spec', 'Spectrogram', 'Each frequency\'s level, as a colour'], ['notes', 'Notes', 'A voice\'s notes on a piano\'s rows']].map(([name, label, hint]) => ({ name, label, hint }))
// Speeds a playback can take from the Transport menu: 0.5× to 3×, as players offer them, a word still followed at 2×, a part
// learned slowly at half; the fastest at the top, up as faster. A speed lasts while it plays: stopped, 1× again
export const SPEEDS = {
  range: r => Number.isFinite(+r) && +r > 0 ? Math.max(.5, Math.min(3, +r)) : 1,
  list: [3, 2, 1.5, 1.25, 1, .75, .5]
}
// The shuttle, Play held and dragged: −2× to 4×, on a line, 40 px each 1×, a tenth a step; from where the speed is,
// as a shuttle ring turns from rest. Forward the deck plays at it, the pitch kept, as a broadcast CD player cues at 4×;
// at 0 and back the scrub voice hears the moments it passes, as a CD player's reverse cue does. Let go forward, it plays
// on at that speed; at 0 or back, it stops there
export const SHUTTLE = { min: -2, max: 4, px: 40, ticks: [-2, -1, 0, 1, 2, 3, 4] }
SHUTTLE.at = r => (r - SHUTTLE.min) / (SHUTTLE.max - SHUTTLE.min)
SHUTTLE.span = SHUTTLE.px * (SHUTTLE.max - SHUTTLE.min)
// a speed as the line's ticks say it, and as its mark does: a tenth always, so the mark keeps its width as it moves
export const times = r => r ? `${r < 0 ? '−' : ''}${+Math.abs(r).toFixed(2)}×` : '0'
export const tenths = r => `${r < 0 ? '−' : ''}${Math.abs(r).toFixed(1)}×`
// How a held caret sounds: the lab's eight ways (scrub-methods.js, their names its own), the closest first
export const scrubs = [['hybrid', 'Tones keep their phase, the rest turns at random: the closest to the sound'], ['vocoder', 'Every bin keeps its phase: the moment frozen'], ['random', 'Every bin a new random phase each hop, as Paulstretch'], ['bank', 'A noise oscillator for each band, 40 Hz to 16 kHz'], ['lines', 'The tonal peaks as lines of noise'], ['grains', 'Grains of 80 ms, one every 20 ms'], ['loop', 'The 80 ms around the caret, again and again'], ['tape', 'A reel\'s head chasing the caret: the pitch follows its speed, silent when still']]
  .map(([name, text]) => ({ name, label: scrubbers[name].name, text }))
// Rates a sound resamples to, from the facts on the display: the standard ones, each with what it is for, in a few words
// (audiojs/sample-rate, after Wikipedia's Sampling (signal processing) table)
export const rates = [[8000, 'Telephone, walkie-talkie'], [11025, 'Low-quality PCM'], [16000, 'VoIP, wideband speech'], [22050, 'Low-quality MPEG'], [44100, 'Audio CD, MP3'], [48000, 'Video, professional audio'], [88200, 'Pro recording for CD'], [96000, 'DVD-Audio, Blu-ray'], [176400, 'HDCD, CD production'], [192000, 'Pro video, Blu-ray'], [352800, 'DXD, SACD editing'], [384000, 'Highest in common software']]
  .map(([hz, text]) => ({ hz, label: `${+(hz / 1000).toFixed(3)}kHz`, text }))
// Layouts a sound remixes to, up to 7.1
export const layouts = [[1, 'mono', 'One channel, sides summed'], [2, 'stereo', 'Left and right'], [6, '5.1', 'Surround with LFE'], [8, '7.1', 'Surround, sides and back']]
  .map(([count, label, text]) => ({ count, label, text }))
// Delivery specs the output can be checked against (fn/check.js holds their rules and sources)
export const specs = [['', 'Off', ''], ['podcast', 'Apple Podcasts', 'Apple'], ['spotify', 'Spotify', 'Spotify'], ['broadcast', 'EBU R 128', 'R 128'], ['acx', 'ACX audiobook', 'ACX'], ['netflix', 'Netflix', 'Netflix']]
  .map(([key, label, short]) => ({ key, label, short }))
// Stored per browser: the scripts, what each tab showed (its zoom, its selection), the tabs closed, and how the page was
// left; under the name the editor had before, 'audio-repl', so what a browser kept is found. What does not read is set
// aside under another name, not written over; a value the page has no longer, its default.
export const KEY = 'audio-repl'
export const stored = EMBED ? { side: UI.panel === 'none' ? null : UI.panel || 'code', display: UI.display, scroll: UI.scroll } : GIVEN ?? (() => {
  let raw = null
  try { raw = localStorage.getItem(KEY); const s = JSON.parse(raw); return s && typeof s === 'object' ? s : {} }
  catch { try { raw && localStorage.setItem(KEY + '-unread', raw) } catch {} return {} }
})()
export const oneOf = (value, list, fallback) => list.includes(value) ? value : fallback
export const docsOf = list => Array.isArray(list) ? list.filter(d => typeof d?.code === 'string') : []
// the panel's tabs; one stored under a name it no longer has opens on the edits, and a closed panel stays closed
export const sides = ['recipes', 'chat', 'edits', 'code', 'export', 'settings'], sideOf = name => name == null ? null : sides.includes(name) ? name : 'edits'
