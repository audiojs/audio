import { ops, CURVES, labelOf, format, icons as groupIcons } from '../ops.js'
import opIcons from '../icons.js'
import { keep as keepFile } from '../keep.js'
import { MAPS } from '../tint.js'
import { NEXT } from '../kind.js'

// The editor as the page is given it: its root, the link's parameters, what this browser stored, and the lists and
// constants its menus and exports offer

export const root = document.querySelector('#app')
// Embedded in another page (embed.js, <audio-repl>): one script, the link's; nothing read from this browser or kept in
// it, no other editor's tabs touched; its panel and its picture as the page asks (?panel=code|edits|none, ?display=spec)
export const params = new URLSearchParams(location.search), EMBED = params.has('embed')
// In the Mac app (?desktop, index.html): the input held as a DAW holds it (below, sources.js hold)
export const DESKTOP = params.has('desktop')
// The app's one config, a JSON (?ui=, embed.js builds it; README.md): what the View menu leaves out, as a page or a link
// asks it, embedded or not. panel, display, controls (the parts shown, index.html and editor.css name them; a level among
// them what the readout reads, without ruler no time row, and a selection's fork only where named), ops (the edits a press away for the page's own sound,
// as `stretch(1.25)`; another's follow its kind: menus.js suggested),
// background (the page's ground, to sit on and to fade into), zoom and overshoot (how far time zooms, and scrolls past
// the sound's end), scroll (what scrolls it: `bar`, `hover`, `overview`), wheel (which way it is the picture's: `across`,
// up and down left to the page, or `both`), grid (how the lanes are ruled: `none`, `lines`, `paper`), axis (false: no
// scale at the lanes' right; `inside`: the values and the time row written in the sheet the grid rules), kind (what the
// page's own sound is, in a word, said where a kind is said; another sound's is heard: readouts.js), about (what more
// the page says of its own sound, its word's tooltip: ABOUT, below), inset (embedded, how
// far the sound's name and the bar stand in from the frame's sides, the picture its whole width) and font (`sans`: its
// words in one face, its picture's labels smaller; both set before the first paint, index.html), edits (how the quick edits are laid:
// `menu` or `chain`, EDITS, below),
// cues (what shows first where they crowd),
// units (how time reads: time.js UNITS), splice (the ms an edit's seams crossfade over), channels (of a take over
// nothing). A link from before it, ?panel= and ?display=, reads the same.
export const UI = (() => { try { return { ...EMBED && { panel: params.get('panel') ?? undefined, display: params.get('display') ?? undefined }, ...JSON.parse(params.get('ui') || '{}') } } catch { return {} } })()
export const SHOWN = Array.isArray(UI.controls) ? UI.controls : []
// each quick edit: its call, with its own arguments or, as the menus write it, the defaults the library can't do
// without; its icon; its arguments as the edit's own settings read, each in its unit (none where one is not a plain
// value: a range, a curve), parted by commas, as a call parts them, and each apart (`parts`, the field's list drags each:
// menus.js findHold); null for a call not of the edits (ops.js)
export const quickOf = call => {
  const [, name, args] = String(call).match(/^([\w-]+)(?:\(([^)]*)\))?$/) ?? []
  if (!ops[name]) return null
  const parts = args && !/[{[]/.test(args) ? args.split(',').map((a, i) => format(Number.isNaN(+a) ? a.trim().replace(/^['"]|['"]$/g, '') : +a, ops[name].params?.[i])) : []
  return { name, args, icon: opIcons[name] ?? groupIcons[ops[name].group], label: labelOf(name), text: ops[name].text, values: parts.join(', '), parts }
}
export const QUICK = (Array.isArray(UI.ops) ? UI.ops : []).map(quickOf).filter(Boolean)
// the edits suggested for each kind of sound (kind.js NEXT), as the quick edits are
export const NEXT_EDITS = Object.fromEntries(Object.entries(NEXT).map(([kind, calls]) => [kind, calls.map(quickOf).filter(Boolean)]))
// how they are laid: under one button, a menu of them (`menu`); or the row over the picture as the chain itself
// (`chain`): the sound's name, those made after it in their order, a field to add one (its list: Suggested, the recipe
// for the sound's kind and these edits, then every edit by kind and the recipes), the history, the save at its end
export const EDITS = UI.edits === 'chain' ? 'chain' : 'menu'
// whether the page has a place for what a sound is offered: embedded, the chain (its list's recipes), or the menu
// behind a plus where the page names its own edits; a page of its own has none (its menus and palette hold every edit)
export const SUGGESTS = EMBED && (EDITS === 'chain' || QUICK.length > 0)
// What the page says its own sound is, in a word (`birdsong`, `speech`): said while that sound is the one shown, where
// there is a place for it. A sound of the reader's is listened to instead (readouts.js hearKind, worker.js kind)
export const KIND = typeof UI.kind === 'string' ? UI.kind.trim().slice(0, 40) : ''
// What more the page says of its own sound, who made it, where, when (`A blackbird\nDiana Tudor, xeno-canto 1059970`):
// the first of its word's tooltip, for as long as that sound is the one shown (readouts.js kindTip)
export const ABOUT = typeof UI.about === 'string' ? UI.about.trim() : ''
// whether the page has a place where a sound's kind is said: as a page of its own, by each sound's name in its tab,
// after a thin rule; embedded, with the edits the chain, by the level in the bar, not with the menu behind a plus
export const SAYS_KIND = !EMBED || EDITS === 'chain'
// Embedded where the bar names no Record (?ui= controls without record): a take, started from the sound's menu, is
// stopped by Play, a stop sign while it records (play.js playPress, index.html .play); where Record is shown, its own
export const PLAY_STOPS = EMBED && SHOWN.length > 0 && !SHOWN.includes('record')
// A page given whole in its link, ?state=<what the page keeps, as JSON>: its tabs, what each selects, its panels, as a
// page left them (repl/themes.html stages its specimens so); like an embedded one, nothing read from this
// browser or kept in it, no other editor's tabs touched; dressed by the page around it (below)
export const GIVEN = !EMBED && params.has('state') ? (() => { try { return JSON.parse(params.get('state')) ?? {} } catch { return {} } })() : null
export const APART = EMBED || !!GIVEN
// a sound opened or recorded, kept for the next visit; embedded, held for this one alone: a file opened as it is, a
// take's (a WAV read from its tape's parts on disk, which are let go of once it is kept: recording.js) read into memory,
// so the sound is there to read again (an undo and a redo)
export const keep = APART ? async (name, data) => data instanceof Blob && !(data instanceof File) ? new Blob([await data.arrayBuffer()], { type: data.type }) : data : keepFile
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
// The cues (worker.js), both kinds as one, [{ t, rank, kind }]: the edges of the pauses, where a voice's words or a solo's
// phrases start and end, and the hits, where the level jumps up (a strike, a struck or plucked note, a word struck);
// one of each within 30 ms is one place, the edge's, which its attack placed
export function cueTimes(edges, hits) {
  const near = t => edges.some(e => Math.abs(e.t - t) < .03)
  return [...edges, ...hits.filter(h => !near(h.t))].sort((a, b) => a.t - b.t)
}
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
// The frequency scales a lane's look chooses between (scale.js)
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
// aside under another name, not written over; a value the page has no longer, its default. Embedded, nothing is kept:
// the page's own (?ui=) stand in, as the page is first shown: its panel, its display, its scroll, the waveform's look
// (wave) and the spectrogram's (spec), each setting one of its list (editor.js), any other its default
export const KEY = 'audio-repl'
export const stored = EMBED ? { side: UI.panel === 'none' ? null : UI.panel || 'code', display: UI.display, scroll: UI.scroll, wave: UI.wave, look: UI.spec } : GIVEN ?? (() => {
  let raw = null
  try { raw = localStorage.getItem(KEY); const s = JSON.parse(raw); return s && typeof s === 'object' ? s : {} }
  catch { try { raw && localStorage.setItem(KEY + '-unread', raw) } catch {} return {} }
})()
export const oneOf = (value, list, fallback) => list.includes(value) ? value : fallback
export const docsOf = list => Array.isArray(list) ? list.filter(d => typeof d?.code === 'string') : []
// The edits as a stack of cards (stack.js), the chain's steps each with its settings: only where the page asks for them
// (?ui= edits, or a panel of them), never loaded otherwise, the code being where the chain is written by hand
export const STACKED = UI.edits === true || UI.panel === 'edits'
// The agent, a line under the code to ask it by (chat.js), and the recipes, Process › Recipes putting one's chain in the
// code: each only where the page asks for it (?ui= agent, recipes), the page itself the picture and the code
export const AGENTED = UI.agent === true, RECIPED = UI.recipes === true
// the panel's tabs, the code's and the edits'; one stored under a name it no longer has opens on the code, and a closed
// panel stays closed
export const sides = [...STACKED ? ['edits'] : [], 'code'], sideOf = name => name == null ? null : sides.includes(name) ? name : 'code'
