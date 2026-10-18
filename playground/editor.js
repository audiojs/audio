import sprae from '../assets/sprae.js'
import engine from './engine.js'
import codeEditor from './script.js'
import view, { HOLD, NOTES, noteOf } from './view.js'
import player from './player.js'
import stack, { valuesOf } from './stack.js'
import { mark as drawMark } from '../logo/mark.js'
import recipes from './recipes.js'
import { ops, methods, guides, previews, GROUPS, CURVES, fromManifest, reshapes, labelOf, icons as groupIcons } from './ops.js'
import { prepare, error, bare, offCalls, append, source, chain, number, rollback, residual, setArg, unsetArg, declared, rename, inline, between, steps as stepsOf, stages, mixed, dropStep, moveStep, turnOff, turnOn, tracks as tracksOf, focus, toTrack, voiceTrack, stemTracks, soundOf, addTrack, dropTrack, master as masterOf, addMaster } from './code.js'
import { builtins, sample, microphone, search, credit, unique } from './sources.js'
import scales from './scale.js'
import menubar from './menu.js'
import { levels, spectra, ballistics, cycle, trace } from './meters.js'
import time, { UNITS } from './time.js'
import opIcons from './icons.js'
import { keep as keepFile, unkeep, kept, tape, tapes, own, owner, claim } from './keep.js'
import hint from './hint.js'
import { methods as scrubbers } from './scrub-methods.js'
import agent from './agent.js'
import md from './markdown.js'
import doing, { measures, noted } from './doing.js'
import { THEMES, load, parse, skin, fonts, wear, webview, webviewFonts } from './theme.js'

// The editor: its output, and at its right a panel that opens and closes, as Luminar's: the tools, every method by kind,
// one click adding it; the edits, the chain that makes the output as a stack of steps; the same chain as code; and the
// export, the output checked against a spec and saved as a file. Every change to the script runs it; the output is drawn,
// measured and played. Selecting, cutting or applying a method on the waveform, or a slider in the stack, writes the
// script.
const root = document.querySelector('#app')
// wiring it: the page waits for its first frame, not for the window's load, which an await below may outlast
// (playground.html)
root.dataset.boot = 'wiring'
// Embedded in another page (embed.js, <audio-repl>): one script, the link's; nothing read from this browser or kept in
// it, no other editor's tabs touched; its panel and its picture as the page asks (?panel=code|edits|none, ?display=spec)
const params = new URLSearchParams(location.search), EMBED = params.has('embed')
// a sound opened or recorded, kept for the next visit; embedded, held for this one alone, as it is
const keep = EMBED ? async (name, data) => data : keepFile
const generators = [
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
const formats = [['wav', 'Uncompressed'], ['flac', 'Lossless, smaller'], ['mp3', 'Compressed'], ['ogg', 'Compressed, Vorbis'], ['aiff', 'Uncompressed, Apple']].map(([name, text]) => ({ name, text }))
// What a format is written with (the library's encode options, fn/save.js, audio.d.ts EncodeOpts): a lossless one's
// sample depth (the depths it writes; by default the source's, 16 when unknown), MP3's constant bitrate in kbps (by
// default its encoder's VBR), Ogg Vorbis's quality from 0 to 10; null, the default
const ENCODING = {
  wav: ['bitDepth', 'Bits', [16, 24, 32], v => v === 32 ? '32 float' : `${v}`],
  aiff: ['bitDepth', 'Bits', [16, 24], v => `${v}`],
  flac: ['bitDepth', 'Bits', [16, 24], v => `${v}`],
  mp3: ['bitrate', 'Bitrate', [128, 192, 256, 320], v => `${v}k`],
  ogg: ['quality', 'Quality', [3, 5, 7, 9], v => `q${v}`]
}
// The depth a lossless format writes (fn/save.js encodeOpts): the one chosen, where the format writes it; else the
// smallest it writes that holds the source's, 16 for a source of 16 or less or of no depth (a lossy file, a generated
// sound); null for a lossy format. What each is for
const writtenDepth = (format, chosen, source) => {
  const e = ENCODING[format]
  if (e?.[0] !== 'bitDepth') return null
  return e[2].includes(chosen) ? chosen : source > 16 ? e[2].find(d => d >= source) ?? e[2].at(-1) : 16
}
const DEPTH_USE = { 16: 'CD, most players', 24: 'Masters, further editing', 32: 'Never clips' }
const mime = { wav: 'audio/wav', flac: 'audio/flac', mp3: 'audio/mpeg', ogg: 'audio/ogg', aiff: 'audio/aiff', m4a: 'audio/mp4', edl: 'text/plain', otio: 'application/json', fcpxml: 'application/xml' }
// The cuts as an edit list for a video editor (the library's cuts(): where each piece of the source goes, at a frame
// rate), and the rates offered: the video's own (its file's), film, PAL, NTSC's and their round neighbours
const cutFormats = [['edl', 'EDL', 'CMX 3600: every video editor reads it'], ['otio', 'OTIO', 'OpenTimelineIO: DaVinci Resolve, and others through its adapters'], ['fcpxml', 'FCPXML', 'Final Cut Pro']].map(([name, label, text]) => ({ name, label, text }))
const frameRates = [null, 23.976, 24, 25, 29.97, 30]
// The formats that keep markers in the file (fn/save.js): a WAV's cue points, an MP3's chapters (ID3 CHAP)
const KEEPS = { wav: 'as cue points', mp3: 'as chapters' }
const icons = {
  cut: 'M8.1 8.1 21 21M8.1 15.9 21 3M9 6a3 3 0 1 1-6 0 3 3 0 0 1 6 0m0 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0',
  copy: 'M8 8h13v13H8zM16 8V3H3v13h5',
  paste: 'M8 5H3v16h18V5h-5M8 3h8v4H8z',
  remove: 'M7 4H4v16h3M17 4h3v16h-3M8 12h8',
  crop: 'M7 2v13a2 2 0 0 0 2 2h13M2 7h13a2 2 0 0 1 2 2v13',
  // a lane with a gap where a piece left it, the piece gone down to a lane of its own
  track: 'M3 7h5m8 0h5M3 17h18M12 5v8m-3-3 3 3 3-3',
  repair: 'm4 14 6 6 10-10-6-6ZM9 11l1 1m2-2 1 1m-2 3 1 1m2-2 1 1'
}
// What the picture shows besides the sound, each a thing to grab where it is, none a mode: the cues (with ⌘ held, a
// drag of one moves it and the audio around it stretches), the pitch curve (dragged, the whole pitch line), the gain
// line (its points drag; a press on the line adds one), the meters at the right
const overlays = [['hits', 'Cues', 'Where sounds start, end and hit'], ['gain', 'Gain line', 'Drag its points'], ['meters', 'Meters', 'Level and spectrum'], ['guides', 'Guides', 'What the hovered edit sets']]
// The cues (worker.js), both kinds as one, [{ t, rank }]: the edges of the pauses, where a voice's words or a solo's
// phrases start and end, and the hits, where the level jumps up (a strike, a struck or plucked note, a word struck);
// one of each within 30 ms is one place, the edge's, which its attack placed
function cueTimes(edges, hits) {
  const near = t => edges.some(e => Math.abs(e.t - t) < .03)
  return [...edges, ...hits.filter(h => !near(h.t))].sort((a, b) => a.t - b.t)
}
// How the time row marks time: labels and their ticks, ticks alone, or nothing but the times that matter now (the caret's,
// the pointer's, a selection's)
const rulers = [['labels', 'Labels'], ['ticks', 'Ticks'], ['none', 'None']].map(([name, label]) => ({ name, label }))
// what scrolls the view, zoomed in: a bar at the time row's foot, or the whole sound under it, as a minimap
const scrolls = [['bar', 'Bar', 'A thin bar at the time row\'s foot, the part of the sound in view'], ['overview', 'Overview', 'The whole sound in a strip under the time row, the part in view lit: pressed, the view goes there; dragged, it moves']]
// How the lanes are ruled (view.js paintGrid), behind the waveform and over the spectrogram, by the time row's ticks and
// the axis' on the right
const grids = [
  ['marks', 'Crosses + dots', 'A cross where the ticks meet, a dot where their finer steps do'],
  ['crosses', 'Crosses', 'A cross where the ticks meet'],
  ['dots', 'Dots', 'A dot where the ticks meet, and where their finer steps do'],
  ['lines', 'Lines', 'A faint line from each tick across the lanes'],
  ['none', 'None', 'The lanes bare']
]
// The spectrogram's look: grey, the screen to its ink (white, or a theme's foreground), so the page shows through where
// the sound is quiet and the louder is the inkier; or a colormap (matplotlib's magma, inferno and viridis, 9 of their 256 entries,
// matplotlib/_cm_listed.py); bent by a gamma (a level's share of the range raised to it: under 1 the quiet parts show
// brighter); the dB from the loudest down to the floor; the FFT size, else 40 ms and more on a zoomed band
// (gl-spectrogram)
const MAPS = {
  magma: ['#000004', '#1c1044', '#4f127b', '#812581', '#b5367a', '#e55064', '#fb8761', '#fec287', '#fcfdbf'],
  inferno: ['#000004', '#1f0c48', '#550f6d', '#88226a', '#ba3655', '#e35933', '#f98c0a', '#f9c932', '#fcffa4'],
  viridis: ['#440154', '#472c7a', '#3b518b', '#2c718e', '#21908d', '#27ad81', '#5cc863', '#aadc32', '#fde725']
}
const LOOK = { map: 'grey', gamma: 1, depth: 80, size: null, method: 'reassigned' }
const looks = { map: ['grey', ...Object.keys(MAPS)], gamma: [.5, .75, 1, 1.5], depth: [60, 80, 100, 120], size: [null, 1024, 2048, 4096] }
// How a column draws its frames (gl-spectrogram's methods, after the lab's Seeing sound: audiojs.dev/lab/spectrogram)
const specMethods = [
  ['frames', 'Frames', 'Each column its frame\'s spectrum, as it is: no sharper than the frame'],
  ['reassigned', 'Reassigned', 'Each bin\'s energy where its phase puts it: a tone one row thin, a click one column'],
  ['synchrosqueezed', 'Squeezed', 'Moved in frequency only: tones thin, time as the frames have it'],
  ['bands', 'By band', 'Long frames for the lows, short for the highs, as editors blend them'],
  ['tapers', 'Tapers', 'Three tapers averaged: noise steadier, tones kept'],
  ['wigner', 'Wigner–Ville', 'No frames: a line as thin as it is, and a ghost between any two']
]
// The waveform's look (view.js waveLook, after the lab's waveforms): coloured for what it holds, its channels in a lane
// each or one, its fill
const WAVE = { colour: 'none', lanes: 'split', fill: 'density' }
const waveLooks = {
  colour: [['none', 'One colour', 'The screen\'s'], ['temperature', 'Temperature', 'Low warm, high cool: where its spectrum centres, as the colour of light'], ['colormap', 'Colormap', 'Where its spectrum centres, in the spectrogram\'s colours: low at their middle, high at their top']],
  lanes: [['split', 'A lane each', 'Each channel on its own'], ['one', 'One lane', 'All the channels over each other, each its own hue']],
  fill: [['density', 'Density', 'Brighter where the sound is most often'], ['rms', 'RMS', 'A lighter core as loud as its RMS'], ['flat', 'Flat', 'One solid shade, peak to peak']]
}
// the look as gl-spectrogram takes it: 17 stops of a colormap, bent by the gamma; grey's none, its levels the skin's
// ink over the screen, which the picture makes (view.js shades)
function paint({ map, gamma, depth, size, method }) {
  const n = 17, u = k => (k / (n - 1)) ** gamma
  const at = (hex, t) => { const i = Math.min(hex.length - 2, Math.floor(t * (hex.length - 1))), f = t * (hex.length - 1) - i, rgb = h => [1, 3, 5].map(j => parseInt(h.slice(j, j + 2), 16)); return `rgb(${rgb(hex[i]).map((v, j) => Math.round(v + (rgb(hex[i + 1])[j] - v) * f)).join(' ')})` }
  return { color: MAPS[map] ? Array.from({ length: n }, (_, k) => at(MAPS[map], u(k))) : null, gamma, depth, size, method }
}
// How the waveform's level axis writes levels: decibels from full scale, mirrored about the centre line, or the sample
// values themselves, signed
const levelList = [['db', 'Decibels', '−6dB', 'dB'], ['linear', 'Sample values', '0.5', '±1']].map(([name, label, example, short]) => ({ name, label, example, short }))
// The frequency scales the settings choose between (scale.js)
const scaleNames = { log: 'Octaves', mel: 'Mel', erb: 'ERB', lin: 'Hertz' }
// A fade's curves, as the library names them (audio.op('fade').curves), each drawn as it fades in, as its handle on the picture draws
// it; out, the other way
const curveIcon = (name, out = false) => 'M' + Array.from({ length: 13 }, (_, i) => `${out ? 20 - 16 * i / 12 : 4 + 16 * i / 12} ${+(20 - 16 * CURVES[name](i / 12)).toFixed(2)}`).join('L')
const curves = [['linear', 'Linear'], ['exp', 'Exponential'], ['log', 'Logarithmic'], ['cos', 'S-curve']].map(([name, label]) => ({ name, label, icon: curveIcon(name) }))
// The context menu's own: up and down a level, a marker's flag, all of it, zoom to it, find
const glyphs = { up: 'M12 19V5m-6 6 6-6 6 6', down: 'M12 5v14m-6-6 6 6 6-6', marker: 'M6 21V4h11l-2.5 4 2.5 4H6', all: 'M4 8V4h4m8 0h4v4m0 8v4h-4M8 20H4v-4', zoom: 'M4 9V4h5m6 0h5v5m0 6v5h-5m-6 0H4v-5', find: 'M11 17a6 6 0 1 0 0-12 6 6 0 0 0 0 12Zm4.5-1.5L20 20' }
// What the grip past a selection's end does to its length, chosen from a click on it: cuts it back or adds silence
// (remove, insert), stretches it, the pitch kept (fn/stretch.js), or speeds it, the pitch following, as a tape
// (fn/speed.js)
const gripModes = [['trim', 'Trim', 'Cut back, or silence added'], ['stretch', 'Stretch', 'The pitch kept'], ['speed', 'Speed', 'The pitch follows, as a tape’s']].map(([name, label, text]) => ({ name, label, text }))
// The settings' icon, on the 24 grid of the others: two faders, upright as a mixer's, set apart from the waveform's and
// the spectrogram's lines; the agent's, a
// spark; the recipes', an open book
const SETTINGS_ICON = 'M6 3v3.5m0 5V21M18 3v9.5m0 5V21M6 11.5a2.5 2.5 0 1 1 0-5 2.5 2.5 0 0 1 0 5Zm12 6a2.5 2.5 0 1 1 0-5 2.5 2.5 0 0 1 0 5Z'
const AGENT_ICON = 'M12 3c.6 4.7 4.3 8.4 9 9-4.7.6-8.4 4.3-9 9-.6-4.7-4.3-8.4-9-9 4.7-.6 8.4-4.3 9-9Z'
const RECIPES_ICON = 'M3 5h5a4 4 0 0 1 4 4v11a3 3 0 0 0-3-3H3Zm18 0h-5a4 4 0 0 0-4 4v11a3 3 0 0 1 3-3h6Z'
// What the picture shows, a tab each: the waveform, or the spectrogram, never both (each zooms its own way); the
// spectrogram's again, its frequencies on the next scale
const displays = [['wave', 'Waveform', 'M4 10v4m4-8v12m4-15v18m4-14v10m4-6v2'], ['spec', 'Spectrogram', 'M4 5h16M4 9.5h10M4 14h13M4 18.5h6']].map(([name, label, icon]) => ({ name, label, icon }))
const nextScale = name => { const list = Object.keys(scales); return list[(list.indexOf(name) + 1) % list.length] }
// Speeds a playback can take from the Play menu: 0.5× to 3×, as players offer them, a word still followed at 2×, a part
// learned slowly at half; the fastest at the top, up as faster. A speed lasts while it plays: stopped, 1× again
const SPEEDS = {
  range: r => Number.isFinite(+r) && +r > 0 ? Math.max(.5, Math.min(3, +r)) : 1,
  list: [3, 2, 1.5, 1.25, 1, .75, .5]
}
// The shuttle, Play held and dragged: −2× to 4×, on a line, 40 px each 1×, a tenth a step; from where the speed is,
// as a shuttle ring turns from rest. Forward the deck plays at it, the pitch kept, as a broadcast CD player cues at 4×;
// at 0 and back the scrub voice hears the moments it passes, as a CD player's reverse cue does. Let go forward, it plays
// on at that speed; at 0 or back, it stops there
const SHUTTLE = { min: -2, max: 4, px: 40, ticks: [-2, -1, 0, 1, 2, 3, 4] }
SHUTTLE.at = r => (r - SHUTTLE.min) / (SHUTTLE.max - SHUTTLE.min)
SHUTTLE.span = SHUTTLE.px * (SHUTTLE.max - SHUTTLE.min)
// a speed as the line's ticks say it, and as its mark does: a tenth always, so the mark keeps its width as it moves
const times = r => r ? `${r < 0 ? '−' : ''}${+Math.abs(r).toFixed(2)}×` : '0'
const tenths = r => `${r < 0 ? '−' : ''}${Math.abs(r).toFixed(1)}×`
// How a held caret sounds: the lab's eight ways (scrub-methods.js, their names its own), the closest first
const scrubs = [['hybrid', 'Tones keep their phase, the rest turns at random: the closest to the sound'], ['vocoder', 'Every bin keeps its phase: the moment frozen'], ['random', 'Every bin a new random phase each hop, as Paulstretch'], ['bank', 'A noise oscillator for each band, 40 Hz to 16 kHz'], ['lines', 'The tonal peaks as lines of noise'], ['grains', 'Grains of 80 ms, one every 20 ms'], ['loop', 'The 80 ms around the caret, again and again'], ['tape', 'A reel\'s head chasing the caret: the pitch follows its speed, silent when still']]
  .map(([name, text]) => ({ name, label: scrubbers[name].name, text }))
// Rates a sound resamples to, from the facts on the display: the standard ones, each with what it is for, in a few words
// (audiojs/sample-rate, after Wikipedia's Sampling (signal processing) table)
const rates = [[8000, 'Telephone, walkie-talkie'], [11025, 'Low-quality PCM'], [16000, 'VoIP, wideband speech'], [22050, 'Low-quality MPEG'], [44100, 'Audio CD, MP3'], [48000, 'Video, professional audio'], [88200, 'Pro recording for CD'], [96000, 'DVD-Audio, Blu-ray'], [176400, 'HDCD, CD production'], [192000, 'Pro video, Blu-ray'], [352800, 'DXD, SACD editing'], [384000, 'Highest in common software']]
  .map(([hz, text]) => ({ hz, label: `${+(hz / 1000).toFixed(3)}kHz`, text }))
// Layouts a sound remixes to, up to 7.1
const layouts = [[1, 'mono', 'One channel, sides summed'], [2, 'stereo', 'Left and right'], [6, '5.1', 'Surround with LFE'], [8, '7.1', 'Surround, sides and back']]
  .map(([count, label, text]) => ({ count, label, text }))
// Delivery specs the output can be checked against (fn/check.js holds their rules and sources)
const specs = [['', 'Off', ''], ['podcast', 'Apple Podcasts', 'Apple'], ['spotify', 'Spotify', 'Spotify'], ['broadcast', 'EBU R 128', 'R 128'], ['acx', 'ACX audiobook', 'ACX'], ['netflix', 'Netflix', 'Netflix']]
  .map(([key, label, short]) => ({ key, label, short }))

// One editor writes at a time (keep.js own): opened in a second tab, it asks there to be used there, and once the first
// has stored what it has, reads it again; the first, asked, keeps its take, stores, and says where it is now, a click
// bringing it back. Nothing waits for it: the page comes up as it was stored, writing nothing until it is the one.
const elsewhere = document.querySelector('dialog.elsewhere')
// the files being written to the browser's storage (hold), which the page waits for before it steps aside
const writing = new Set()
elsewhere.addEventListener('cancel', event => event.preventDefault())
// (a dialog's field or button is focused as it opens, not marked autofocus: a frame in another site's page is refused that, aloud)
const away = run => { const go = elsewhere.querySelector('button'); go.onclick = run; if (!elsewhere.open) { elsewhere.showModal(); go.focus() } }
const back = async () => { await claim(); location.reload() }
const owning = EMBED ? Promise.resolve() : own({
  ask: () => new Promise(away),
  give: async () => { if (recorder) await stopRecording(); await Promise.all(writing); store() },
  lost: () => { pl.close(); recorder?.cancel(); away(back) }
}).then(fresh => { if (!fresh) return location.reload(), new Promise(() => {}); if (elsewhere.open) elsewhere.close(); store() })

// Stored per browser: the scripts, what each tab showed (its zoom, its selection), the tabs closed, and how the page was
// left; under the name the editor had before, 'audio-repl', so what a browser kept is found. What does not read is set
// aside under another name, not written over; a value the page has no longer, its default.
const KEY = 'audio-repl'
const stored = EMBED ? { side: params.get('panel') === 'none' ? null : params.get('panel') || 'code', display: params.get('display') } : (() => {
  let raw = null
  try { raw = localStorage.getItem(KEY); const s = JSON.parse(raw); return s && typeof s === 'object' ? s : {} }
  catch { try { raw && localStorage.setItem(KEY + '-unread', raw) } catch {} return {} }
})()
const oneOf = (value, list, fallback) => list.includes(value) ? value : fallback
const docsOf = list => Array.isArray(list) ? list.filter(d => typeof d?.code === 'string') : []
// the methods last used, the newest first (used)
let recent = Array.isArray(stored.recent) ? stored.recent.filter(n => typeof n === 'string').slice(0, 3) : []
// The agent's conversations, the page's whichever tab shows (the chat, below): at most CHATS, the oldest first, the one
// open its `chatId`; those kept before as each tab's own, the closed ones' too, gathered
const CHATS = 30
const talk = (() => {
  const kept = Array.isArray(stored.chats) ? stored.chats : [...docsOf(stored.docs), ...docsOf(stored.closed)].flatMap(d => Array.isArray(d.chats) ? d.chats : [])
  const chats = kept.filter(c => Array.isArray(c?.messages)).sort((a, b) => (a.at ?? 0) - (b.at ?? 0)).slice(-CHATS)
  return { chats, chatId: 'chats' in stored ? stored.chat ?? null : docsOf(stored.docs)[stored.doc ?? 0]?.chat ?? null }
})()
// A tab as it is kept: its script, where it was looked at and what was selected
const saved = d => {
  const shown = d.id === state.tab
  return { code: shown ? ed.code : d.code, frame: d.frame ?? (shown ? v?.frame : null), view: d.view ?? (shown ? v?.state : null), track: shown ? state.track : d.track ?? null, muted: shown ? state.muted : d.muted ?? [] }
}
// the storage full, the tabs and the settings are kept without their conversations, and the page says so, once
let full = false
const store = () => {
  // embedded, what the page keeps is its link to the whole editor, the script as it reads now
  if (EMBED) return ed && link(ed.code).then(code => state.full = `${location.pathname}#code=${code}`)
  if (!ed || !owner()) return
  const all = { docs: docs.map(saved), doc: docs.findIndex(d => d.id === state.tab), closed: closed.map(({ doc, ...c }) => doc ? { ...saved(doc), at: c.at, shut: c.shut } : c), display: state.display, scale: state.scale, format: state.format, encoding: state.encoding, spec: state.spec, cuts: { format: state.cutFormat, fps: state.fps }, side: state.side, show: state.show, units: state.units, snap: state.snapping, curve: state.fadeCurve, levels: state.levels, ruler: state.ruler, scroll: state.scroll, grid: state.grid, step: state.levelStep, look: state.look, wave: state.wave, agent: { url: state.bridgeUrl, key: state.bridgeKey }, splice: state.splice, scrub: state.scrub, record: state.recordIn, grip: state.gripMode, panel: state.panel, folds: state.folds, recent, ...talks() }
  try { localStorage.setItem(KEY, JSON.stringify(all)); full = false }
  catch {
    const { chats, chat, ...bare } = all
    try { localStorage.setItem(KEY, JSON.stringify(bare)) } catch {}
    if (!full) note('The browser’s storage for this page is full: the agent’s conversations are not kept.', 'error')
    full = true
  }
}
// stored a moment after the last of a run of changes (typing, selecting)
const later = () => { clearTimeout(store.timer); store.timer = setTimeout(store, 500) }

// A number and its unit as the page writes them: the unit right after the value, no space (−1.0dB, 44.1kHz)
const dbfs = db => Number.isFinite(db) ? `${db < 0 ? '−' : ''}${Math.abs(db).toFixed(1)}` : '−∞'
// Keys as this platform names them
const mac = /Mac|iP(hone|ad|od)/.test(navigator.platform)
const keys = s => mac ? s : s.replace(/⌘/g, 'Ctrl+').replace(/⇧/g, 'Shift+').replace(/⌥/g, 'Alt+')
// A time, or a length of time, in the units chosen, as the view writes them (time.js): 0:05.000, 5.000s, 240000
const clock = (t, digits = 3) => time(t, state.units, { digits, rate: output?.sampleRate })
const stamp = t => clock(t)
// A check's numbers as the page prints them: to 0.01 as judged, whole numbers whole, a true minus sign
const minus = s => s.replace(/^-/, '−')
const value = v => Number.isFinite(v) ? minus(Number.isInteger(v) ? String(v) : v.toFixed(2)) : v < 0 ? '−∞' : '∞'
const limit = ({ min, max }) => min != null && max != null ? (min === max ? `= ${value(min)}` : `${value(min)} to ${value(max)}`) : max != null ? `≤ ${value(max)}` : min != null ? `≥ ${value(min)}` : ''
const mark = pass => pass == null ? '·' : pass ? '✓' : '✗'
const verdict = pass => pass == null ? 'info' : pass ? 'pass' : 'fail'
// a check's rule as its table's row: its name, the output's value and mark, its limit (the Export tab's, the chat's)
const ruled = r => ({ name: r.name, unit: r.unit, limit: limit(r), note: r.note || '', after: value(r.value), afterMark: mark(r.pass), afterClass: verdict(r.pass) })
const label = name => /^(https?|blob|data):/.test(name) ? decodeURIComponent(name.split(/[?#]/)[0].split('/').pop() || name) : name
const quote = s => `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`

const eng = engine()
// The channel samples the page holds of an output, 30 channel-minutes at 48 kHz: a longer one comes as its peaks, drawn
// from them, its samples fetched where the view zooms in (view.js summary), played by the engine (player.js)
eng.peaks = 30 * 60 * 48000
// how many samples a piece of an arriving sound covers: its samples, or its leaves (256 each, the last as many as it has)
const extent = m => m.channels ? m.channels[0].length : m.peaks[0].length ? (m.peaks[0].length / 4 - 1) * 256 + m.peaks[0][m.peaks[0].length - 1] : 0
// a piece onto the view: its samples, or its leaves
const piece = m => m.peaks ? v.peaks(m.at, m.peaks, m.spectra) : v.append(m.channels)
// A sound arriving, with nothing whole to play, heard as it comes, as far as it has: its pieces pushed to the deck as
// they come. The file as it decodes (`what` 'file'), while the output has nothing; then the output (`output`), from its
// first piece, its pieces till then pushed at once, taking over where it plays. One that comes as its peaks waits to be
// whole
let arrivals = 0
function hear(a, m, what) {
  if (state.whole || !m.channels) return
  if (a.hearing === what) { eng.push(a.heard, m.channels); return pl.grow(m.channels[0].length) }
  const parts = what === 'output' ? a.parts : [m]
  a.hearing = what
  a.heard = `arriving ${++arrivals}`
  eng.arrive(a.heard, m.sampleRate, m.channels.length)
  for (const p of parts) eng.push(a.heard, p.channels)
  pl.out = null
  pl.arrive(m.sampleRate, o => eng.voice({ ...o, held: { key: a.heard } }), parts.reduce((n, p) => n + p.channels[0].length, 0))
  state.arriving = true
}
let ed, v, rk
// Each tab plays on its own, as a browser's tabs do: one left as it plays plays on, heard with the one shown, its speaker
// on its tab muting it (toggleTabMute). `pl`, the shown tab's player (switchTab), each tab's made as it is first shown
const playerOf = doc => doc.player ??= Object.assign(player({ onend: () => ended(doc) }), { scrubMode: state.scrub })
let pl = null
// the caret is where playback ends, as it is where it pauses; a tab not shown, its speaker goes
function ended(doc) {
  if (doc.player !== pl) return sway()
  state.playing = false; state.speed = pl.rate = 1; v.playhead = null; v.setCursor(pl.time); state.time = stamp(v.cursor); sway()
}
// the whole output the page has; the newest run's output as it arrives; the run whose output the view shows
let output = null, incoming = null, showing = 0
// the view holds the tab's sound as it was left (its lanes, its length, where it was looked at) until the sound comes
let holding = false
let timer = 0, ticker = 0, recorder = null, previewAudio = null, original = null, checks = 0
// each tab's runs asked and not yet answered; the shown one's
const asking = new Map(), waiting = () => asking.get(state.tab) ?? 0
// the script after each step of its history (remember), and how many steps back it was last
let steps = [], depthWas = 0
// the card of the edits an undo or a redo brings back to, once the edits have seen the script it brings back (remember)
let rechoose
// the open documents, a tab each: [{ id, code, steps, depthWas }], the code of the one shown in the editor (switchTab);
// each with its last output, and the one on its way (`coming`), made on with the tab left, `ready` till it is seen
let docs = [], docIds = 0
const docOf = id => docs.find(d => d.id === id)
// the tabs closed, the last last, each as it is kept and where it was ({ ...saved, at }); one closed since the page
// opened is still the tab itself (doc), its history with it
const CLOSED = 20
let closed = docsOf(stored.closed).slice(-CLOSED)
// the files kept in this browser, name → File (hold)
let shelf = new Map()
// what the output shows when not the whole chain (the stack): what live step `delta` takes out, or the chain rolled
// back to its first `back` steps
let viewing = { delta: null, back: null }

// The mark in the bar, drawn live (logo/mark.js): at rest it holds the logo's pose. Playing or recording, the logo's own
// wave runs through its window 2.5 times a second, a loop the compositor steps through (motion.js loop), so the page's
// thread is the playhead's and the take's alone; scrubbing, one cycle of the moment under the caret, turned by the
// caret's travel (2.5 turns for a second of it). The tab's icon shows the same, in a hidden tab too. Plain: nothing
// fades or blends, and what it shows next it shows at once.
const logoMark = drawMark(root.querySelector('.bar .wordmark')), heard = trace()
const PACE = 2.5
// Its cycles across the window follow the pitch it draws, smoothly: one at 100 Hz and below, a cycle and three quarters
// more for each octave up, at most three and a half
const cyclesOf = hz => hz ? Math.min(3.5, Math.max(1, 1 + .75 * Math.log2(hz / 100))) : 1
// Heard RMS to the wave's height: half of it at −48 dBFS and below, all of it at full scale. The mark only says that
// something sounds, so it is never flat; a silence is the faint axis alone, its wave nothing.
const swell = rms => { const loud = 1 + 20 * Math.log10(rms + 1e-9) / 48; return .5 + .5 * (loud > 0 ? Math.min(1, loud) : 0) }
// How much of the ink the zero axis takes while the mark shows a sound: half, as the waveform's own axis does
const FAINT = .5
const still = matchMedia('(prefers-reduced-motion: reduce)')
// The caret under a scrub, and the RMS of what it hears there (the 50 ms around it): the output, or a track's lane
let scrubbed = null
const beneath = () => { const w = output && pl.heard(scrubbed), i = w && Math.round(scrubbed * output.sampleRate) - w.from; return w ? Math.max(0, ...levels(w.x, i - 1200, i + 1200).map(l => l.rms)) : 0 }
// while the engine works it turns gently, the same whether a file arrives or an output renders, no smaller or paler
let swaying = ''
function sway() {
  const mode = still.matches ? 'rest' : scrubbed != null && output?.duration ? 'scrub' : recorder && !state.recording?.pending ? 'record' : docs.some(d => d.player?.playing) ? 'play' : waiting() || incoming ? 'work' : 'rest'
  badges()
  if (mode === swaying) return
  swaying = mode
  heard.hz = 0
  logoMark?.set({
    scrub: { loop: 0, signal: () => { const w = output && pl.heard(scrubbed); if (w) cycle(w.x, scrubbed * output.sampleRate - w.from, output.sampleRate, heard, .5); return heard.wave }, cycles: () => cyclesOf(heard.hz), speed: 0, hold: true, hover: 'none', amplitude: () => swell(beneath()), axis: FAINT, hidden: false },
    record: { signal: 'sine', cycles: 1, speed: PACE, loop: PACE, hold: false, hover: 'none', amplitude: 1, axis: FAINT, hidden: true },
    play: { signal: 'sine', cycles: 1, speed: PACE, loop: PACE, hold: false, hover: 'none', amplitude: 1, axis: FAINT, hidden: true },
    work: { signal: 'sine', cycles: 1, speed: .25, loop: 0, hold: false, hover: 'none', amplitude: 1, axis: 0, hidden: true },
    rest: { signal: 'sine', cycles: 1, speed: 0, loop: 0, hold: false, hover: 'mimic', amplitude: 1, axis: 0, hidden: false },
  }[mode])
}

// the panel's tabs; one stored under a name it no longer has opens on the edits, and a closed panel stays closed
const sides = ['recipes', 'chat', 'edits', 'code', 'export'], sideOf = name => name == null ? null : sides.includes(name) ? name : 'edits'

const state = sprae(root, {
  format: oneOf(stored.format, formats.map(f => f.name), 'wav'), encoding: { markers: true, ...stored.encoding }, snapping: stored.snap ?? true, fadeCurve: oneOf(stored.curve, curves.map(c => c.name), 'linear'), gripMode: ['trim', 'speed'].includes(stored.grip) ? stored.grip : 'stretch', pitch: false, settingsIcon: SETTINGS_ICON, recipesIcon: RECIPES_ICON, agentIcon: AGENT_ICON,
  overlayList: overlays.map(([name, label, title]) => ({ name, label, title })),
  unitList: UNITS.map(([name, label, example, short]) => ({ name, label, example, short })), levelList, levels: oneOf(stored.levels, ['db'], 'linear'),
  rulers, ruler: oneOf(stored.ruler, rulers.map(r => r.name), 'labels'), scroll: oneOf(stored.scroll, scrolls.map(s => s[0]), 'bar'), grid: oneOf(stored.grid, grids.map(g => g[0]), 'marks'), splices: [0, 5, 10, 20], splice: oneOf(stored.splice, [0, 5, 10, 20], 10), steps: [.1, 1, 3], levelStep: oneOf(stored.step, [.1, 1, 3], 1), look: Object.fromEntries(Object.entries(LOOK).map(([k, d]) => [k, oneOf(stored.look?.[k], k === 'method' ? specMethods.map(m => m[0]) : looks[k], d)])), wave: Object.fromEntries(Object.entries(WAVE).map(([k, d]) => [k, waveLooks[k].some(([v]) => v === stored.wave?.[k]) ? stored.wave[k] : d])),
  scrubs, scrub: scrubbers[stored.scrub] ? stored.scrub : 'hybrid', recordIn: stored.record === 2 ? 2 : 1,
  // the speed it plays at, the pitch kept; how far through the sound it plays (Play's ring); the scale a held Play shows
  // while dragged
  dropdown: false, get dropdownSections() { return this.dropdown ? settingSections() : [] },
  folds: stored.folds && typeof stored.folds === 'object' ? stored.folds : {},
  speed: 1, played: 0, speedAxis: null, shuttle: null, speedTicks: SHUTTLE.ticks.map(t => ({ t, label: times(t), at: SHUTTLE.at(t) })),
  get shuttleText() { return tenths(this.shuttle ?? this.speed) },
  get shuttleAt() { return SHUTTLE.at(this.shuttle ?? this.speed) },
  display: stored.display === 'spec' ? 'spec' : 'wave', scale: scales[stored.scale] ? stored.scale : 'log', displays, rates, layouts, sound: null, viewing: '',
  show: { hits: true, gain: true, meters: true, guides: true, ...stored.show }, units: oneOf(stored.units, UNITS.map(u => u[0]), 'clock'),
  embed: EMBED, full: '', side: sideOf(stored.side), panel: Number.isFinite(stored.panel) ? stored.panel : null, pick: 0, keys,
  tabs: [], marks: {}, sounding: {}, markWords: { working: 'Rendering', ready: 'Done' }, recents: [], tab: 0, name: 'untitled', duration: 0, hasOutput: false, whole: false, ran: false, problem: '', missing: '', notice: '', noticeKind: '', dropping: false, track: null, muted: [],
  progress: '', figure: '', arrived: null, working: false, loading: false, arriving: false, lines: [], saves: [], exporting: false, shared: false, canUndo: false, canRedo: false,
  time: '0:00.000', span: 0, readout: '', readoutTip: '', heard: null, selection: null, band: null, ranges: 0, boxes: 0, carets: 1, pauses: false, canPaste: false, playing: false, loop: false, recording: null,
  // the ring in Play's place (status), unless it plays or records
  get halting() { return this.working && !this.playing && !this.recording },
  specs, spec: oneOf(stored.spec, specs.map(s => s.key), ''), report: null, checking: false, ab: false, abGain: 0, canCompare: false,
  query: '', results: [], searching: false, searchState: '', previewing: -1,
  toolQuery: '', samples: Object.entries(builtins).map(([name, text]) => ({ name, text })), generators, formats, clock,
  get recipeGroups() { return [...new Set(recipes.map(r => r.group))].map(name => ({ name, items: recipes.filter(r => r.group === name) })) },
  // The palette: the edits for what is selected first, as the Edit menu has them, then every method by kind, each its
  // own icon (icons.js); the words typed find them by name or by what they do. Numbered in order, for the arrow keys.
  get toolGroups() {
    const q = this.toolQuery.trim().toLowerCase(), found = (...words) => !q || words.some(w => w.toLowerCase().includes(q))
    const run = act => () => { closePalette(); act() }
    const groups = [
      { name: this.boxes > 1 ? `For the ${this.boxes} bands` : this.band ? 'For the band' : this.ranges > 1 ? `For the ${this.ranges} ranges` : this.selection ? 'For the selection' : 'At the caret', items: quick(this).filter(e => found(e.label)).map(e => ({ ...e, run: run(() => editSelection(e.type)) })) },
      ...GROUPS.map(name => ({ name, items: Object.values(ops).filter(op => op.group === name && found(op.name, op.text))
        .map(op => ({ label: labelOf(op.name), text: op.text, icon: opIcons[op.name] ?? groupIcons[name], title: `.${op.name}(): ${op.text}`, run: run(() => addOp(op.name)) })) }))
    ].filter(g => g.items.length)
    let i = 0
    for (const g of groups) for (const item of g.items) item.index = i++
    return groups
  },
  // what a tool acts on: the selection, each range, or all of it
  get toolTarget() { return this.band ? 'For the band selected; a method, for its time range' : this.ranges > 1 ? `For each of the ${this.ranges} ranges selected` : this.selection ? `For the selection, ${stamp(this.selection[0])}–${stamp(this.selection[1])}` : 'For all of it; select a range for that alone' },
  // The check, rule by rule, in the panel's Export tab: each rule, the output's value and mark, its limit
  get checkRows() { return (this.report?.rules || []).map(ruled) },
  setSpec(key) { state.spec = key; store(); scheduleCheck(0) },
  toggleAB,
  // The clock, in the units the settings choose: the playhead, or the caret, one time always, the ranges being on the
  // time row; after it how long all that is selected is, between bars as a length is marked. What is selected, in full, when
  // pointed at
  get timeText() { return this.time },
  get lengthText() { return this.recording ? this.recording.length ? clock(this.recording.length) : '' : this.span || this.duration ? clock(this.span || this.duration) : '' },
  // the length is the whole sound's, none being selected
  get lengthWhole() { return !this.recording && !this.span },
  get length() { return this.duration ? clock(this.duration) : '' },
  // a click on the time brings the view to it; on the length, the selection shown whole, then all of it
  bringTime() { v.bring() },
  frameLength() { v.frameSelected() },
  get lengthTitle() { return this.recording ? 'Take' : `${this.span ? 'Selection' : 'Length'}\nClick to fit` },
  get timeTip() { return `${this.playing ? 'Playhead' : 'Caret'}\nClick to show` },
  get timeTitle() {
    const sel = this.selection
    if (this.playing || this.recording || !this.span) return ''
    const length = this.span, rate = output?.sampleRate || 44100, what = this.ranges > 1 || !sel ? `${this.ranges} ranges` : `${stamp(sel[0])}–${stamp(sel[1])}`
    return `Selected ${what}: ${clock(length)}, ${Math.round(length * rate)} samples`
  },
  get plotHelp() {
    return `${this.display === 'spec' ? 'Spectrogram' : 'Waveform'}. Click to put the caret and hear the moment there, by a marker's line on the marker; drag to select a time range, a dragged edge or caret going onto the cues and markers near it; double-click selects the fragment between its cues, triple-click the sound between its pauses. Shift sums: a press or a drag extends the selection to it. Alt adds: another caret, range or fragment; dragged inside the selection, a copy of its audio, put in where it lands; held, it measures: every cue to snap to, the pointer's place out to the axes, and how far it is from the selection, on the time row. ⌘ aims: held, the cue under the pointer, to drag; dragged inside the selection, its audio moves over what is there; a range's end sets its length; the cue under the pointer drags; on the spectrogram, a box of time and frequency; a drag aims finely. A caret's line, the time row or a range's edge drags, the others staying. A range's top corners fade it, outward crossfading; its pill sets its level, the tools at its foot a voice's pitch, intonation and formants; the square past its end trims, stretches or speeds it, a click on each turning it to the next; with none, the square past the caret opens silence. Right-click for the edits there; ⌘P finds any. The wheel scrolls; a pinch, or Ctrl and the wheel, zooms the frequencies or the levels over them and time elsewhere.${this.track ? ` Tracks, a lane each, play together: a press in a lane edits its track, a marker over it its own, a held caret there hears it alone; dragged on the time row, a range runs through every track, an edit of it each one's; ⌘-dragged into another track's lane, a selection's audio goes into that track; the speaker by its name mutes it; Move to a new track takes a selection to one of its own, Move the track to its own tab a track to a tab.` : ''}`
  },
  // a tab opens the panel on it; the tab shown, again, closes it (its tabs stay, to open it again)
  setSide(name) { state.side = state.side === name ? null : name; store() },
  toggleSide() { state.side = state.side ? null : 'edits'; store() },
  get sideTitle() { return { recipes: 'Recipes', chat: 'Agent', edits: 'Edits', code: 'Code', export: 'Export' }[this.side] ?? 'Panel' },
  // The recipes by group, those whose words have every word typed
  scenarioQuery: '',
  get scenarioGroups() {
    const words = this.scenarioQuery.toLowerCase().split(/\s+/).filter(Boolean), has = r => words.every(w => `${r.group} ${r.name} ${r.text} ${r.spec ?? ''}`.toLowerCase().includes(w))
    return [...new Set(recipes.map(r => r.group))].map(name => ({ name, items: recipes.filter(r => r.group === name && has(r)) })).filter(g => g.items.length)
  },
  // The agent: the bridge it is reached through and its key (kept in this browser), whether it is there, the agents it
  // found ({ id, name, models: [{ id, name }] }), the one asked and its model (null: its own choice); the open tab's
  // conversation, whether the agent is answering, the page's conversations, the message being written. Its words are
  // Markdown (markdown.js)
  bridgeUrl: stored.agent?.url || 'http://127.0.0.1:7777', bridgeKey: stored.agent?.key || '', agentStatus: 'off', agents: [], agentInfo: null, agentModel: null,
  get agentLabel() { const m = this.agentInfo?.models?.find(m => m.id === this.agentModel); return this.agentInfo ? this.agentInfo.name + (m ? ` · ${m.name}` : '') : '' },
  chat: [], chatBusy: false, chats: [], chatText: '',
  get agentNote() { return { off: 'Put the key in, then connect', connecting: 'Connecting…', offline: 'Not running: npx audio --bridge', replaced: 'Taken by another page', online: 'No agent on that machine: install one (Claude Code, Codex, Pi, Gemini CLI, Kimi Code…), then start the bridge again' }[this.agentStatus] },
  get chatTitle() { return this.chats.find(c => c.open)?.title ?? 'New conversation' },
  connectAgent, pickAgent, sendChat, chatKey, newChat, openChat, dropChat, showChat, md, partsOf, visit, tick: Date.now(), elapsed,
  undo: () => ed.undo(), resizePanel,
  // a display's tab says what it shows; the spectrogram's, shown, what a click on it again does: the next scale
  displayTitle(d) {
    const as = name => scaleNames[name].toLowerCase()
    const again = this.display === d.name && d.name === 'spec' ? `\nClick for ${as(nextScale(this.scale))}` : ''
    return d.name === 'wave' ? 'Waveform' : `Spectrogram${again}`
  },
  // the output as the whole chain makes it, from what a step takes out or the chain rolled back
  showAll: () => rk.choose(null),
  setFormat(name) { state.format = name; store() },
  // the format's own setting, as its choices: its default (null) first, then each value the library writes
  get encodingParam() {
    const e = ENCODING[this.format]
    return e && { key: e[0], label: e[1], values: [null, ...e[2]].map(v => ({ value: v, label: v == null ? 'Default' : e[3](v) })) }
  },
  setEncoding(key, value) { state.encoding = { ...state.encoding, [key]: value }; store() },
  // The depth the export writes, in the bar after the rate and the channels: the source's kept, or another chosen
  // there or in Export, for the lossless formats (the edits run in 32-bit float); the depths the format writes
  get depth() { return this.sound && writtenDepth(this.format, this.encoding.bitDepth, this.sound.bits) },
  get depths() { return [null, ...ENCODING[this.format]?.[2] ?? []].map(d => ({ bits: d, label: d == null ? 'As the file' : `${d}-bit${d === 32 ? ' float' : ''}`, text: d == null ? `${writtenDepth(this.format, null, this.sound?.bits)}-bit` : DEPTH_USE[d] })) },
  pickDepth(d) { closeMenus(); state.setEncoding('bitDepth', d) },
  cutFormats, frameRates, cutFormat: oneOf(stored.cuts?.format, cutFormats.map(c => c.name), 'edl'), fps: oneOf(stored.cuts?.fps, frameRates, null), exportName: '',
  // the file's name as it would be, and what the format does with the markers
  get exportBase() { return `${this.name === 'untitled' || this.name === 'generated' ? 'audio' : this.name.replace(/\.\w+$/, '').replace(/ \+ .*/, '')}-edited` },
  get markerNote() { return KEEPS[this.format] ?? `${this.format.toUpperCase()} keeps none` },
  get keepsMarkers() { return !!KEEPS[this.format] },
  // how large the file will be, where that is known before it is made: uncompressed samples, or a constant bitrate
  get fileSize() {
    const s = this.sound, sec = s && output?.duration, e = this.encoding
    if (!sec) return ''
    const n = this.format === 'wav' || this.format === 'aiff' ? sec * s.hz * s.count * writtenDepth(this.format, e.bitDepth, s.bits) / 8 : this.format === 'mp3' && e.bitrate ? sec * e.bitrate * 125 : 0
    return n ? bytes(n) : ''
  },
  exportCuts,
  setScale,
  toggleSnap() { state.snapping = v.snapping = !state.snapping; store() },
  toggleShow, setUnits, setLevels, setRuler, setStep, setLook, setSplice, setScrub,
  setDisplay, settingsMenu, dropToggle, fold, toggleLoop, undoList, goTo, toggleRecording, resampleTo, remixTo,
  togglePlay, playPress, playClick, stop, redo: () => ed.redo(), mac, share, exportFiles,
  switchTab, newTab, closeTab, dragTab, scrollTabs, toggleTabMute, pickFiles, openFiles, startRecording, stopRecording, armRecording, useSample, useCode, useRecipe, addOp, editSelection, toolKey, openTools,
  openSearch, closeSearch, runSearch, typeSearch, preview, useResult
})

// The page's hints (hint.js): what a number in the code sets, what a drag on the picture does, what a click just did
const hints = hint(document.body)
// Its controls' tooltips, popoff's: every title, its name, its keys and a word more, on a tag pointing at it; loaded
// aside, so the page is whole without it (the browser's own titles then)
import('../assets/popoff.js').then(({ default: popoff }) => popoff()).catch(() => {})
// The script editor, on the document shown, the files its tabs open kept from before
const first = await initialDocs()
pl = playerOf(first)
// the kept files are listed as the page comes up, not before it: the first run waits for them (evaluate)
const restoring = EMBED ? Promise.resolve() : kept().then(files => { shelf = files; restock() })
ed = codeEditor(root.querySelector('.script-editor'), {
  hint: hints,
  wrap: EMBED,
  doc: first.code,
  onchange(code, update) {
    const slider = !!update?.transactions.some(tr => tr.isUserEvent('input.slider'))
    // typing waits for a pause in the keys; a change made whole (a file opened, an edit on the picture, a recipe, undo)
    // runs at once
    const typed = !!update?.transactions.some(tr => tr.isUserEvent('input.type') || tr.isUserEvent('delete'))
    state.canUndo = ed.canUndo
    state.canRedo = ed.canRedo
    focusOn(state.track)
    remember(code, slider)
    retitle()
    v.envelope = envelopeOf(code)
    v.shift = shiftOf(code)
    schedule(typed ? 250 : 0)
    later()
  },
  oncaret: update => { rk?.refresh(update); if (rechoose !== undefined) { rk.choose(rechoose); rechoose = undefined } },
  // CodeMirror come, after the page shows (script.js): the edits made before it are its history now
  onready() { state.canUndo = ed.canUndo; state.canRedo = ed.canRedo },
  files: () => [...taken()],
  describe: name => eng.describe(name),
  keys: { 'Mod-Enter': togglePlay, 'Mod-s': () => exportFiles() }
})
ed.open(first.id)
state.tab = eng.tab = first.id
state.track = first.track
state.muted = first.muted
focus(first.track)
retitle()
inSight()
store()

// The theme worn (theme.js): one of VS Code's, those it ships or one opened from a file, kept whole (`audio-theme`) so
// the page comes up in it and reads it again by the mapping of the day, with VS Code's fonts; none, the screen's own
// skin. In a VS Code webview, the one VS Code wears and the fonts it has set, followed as they change
let worn = null
const dressed = theme => ({ ...skin(theme), ...fonts() })
try { worn = JSON.parse(localStorage.getItem('audio-theme')); wear(worn && dressed(worn.theme)) } catch { worn = null }
function dress(next) {
  worn = next
  wear(worn && dressed(worn.theme))
  v.restyle()
  try { worn ? localStorage.setItem('audio-theme', JSON.stringify(worn)) : localStorage.removeItem('audio-theme') } catch {}
}
const setTheme = async t => dress(t && { name: t.name, theme: await load(new URL(`./themes/${t.file}`, import.meta.url).href, { kind: t.kind }) })
function openTheme() {
  const input = Object.assign(document.createElement('input'), { type: 'file', accept: '.json,application/json' })
  input.onchange = async () => {
    const file = input.files[0]
    if (!file) return
    try { const own = parse(await file.text()); dress({ name: own.name ?? file.name.replace(/\.json$/i, ''), theme: await load(null, { theme: own }) }) }
    catch (e) { note(`${file.name} is not a VS Code colour theme: ${e.message}`, 'error') }
  }
  input.click()
}
if (webview()) {
  const follow = () => { worn = { name: 'VS Code', theme: webview() }; wear({ ...skin(worn.theme), ...webviewFonts() }); v?.restyle() }
  follow()
  // VS Code marks the body with the theme's kind and id as it changes; the colours it sets on the root, as the skin's
  // are, so the root is not watched
  new MutationObserver(follow).observe(document.body, { attributes: true, attributeFilter: ['class', 'data-vscode-theme-id'] })
}

// The output view
v = view(root.querySelector('.plot'), {
  // the axis as wide as its labels: the settings' button over it (editor.css --axis)
  onaxis: px => root.querySelector('.panes').style.setProperty('--axis', `${px}px`),
  // measuring on the spectrogram, the spectrum meter reads under the pointer, then where it did again
  onprobe: t => meter(null, t),
  // a long output's samples where the view zooms in
  onsamples: (from, to) => output?.long ? eng.samples(output.id, from, to) : null,
  // another track's lane pressed: it is the one edited
  onfocus(i) { const t = output?.tracks?.[i]; if (t) focusOn(t.name) },
  // a track's mute pressed
  onmute: toggleMute,
  onselect(selection, band, ranges = [], boxes = []) {
    state.selection = selection
    state.boxes = boxes.length
    // the caret goes to the selection's start (view.js); once the selection is gone the clock and play start there
    if (selection && !pl.playing) { state.time = stamp(selection[0]); pl.seek(selection[0]) }
    state.band = band
    state.ranges = ranges.length
    // how long all that is selected is, every range of it
    state.span = ranges.reduce((n, [p, q]) => n + q - p, 0)
    state.carets = v?.carets.length ?? 1
    // every range a pause of the output (its silences, worker.js), give or take a pause's block
    state.pauses = ranges.length > 1 && ranges.every(([a, b]) => output?.segments?.silences.some(([p, q]) => Math.abs(p - a) < .03 && Math.abs(q - b) < .03))
    describe()
    meter()
    later()
  },
  // the caret put elsewhere while it plays: playback goes there, over what is selected now (all of it, if nothing)
  oncursor(t) { if (pl.playing) pl.play(plays(t)); else { state.time = stamp(t); meter(); pl.seek(t); listen(); later() } },
  // an edit made on the picture: true once it is written in the script
  // what a selection's handles and its audio dragged do, through every track the same, when it runs through them (spread)
  onedit(type, detail) {
    const act = { warp, envelope, pitch: shift, intonation: tone, formant, carry, tab: toTab, stretch, trim, lift, fade, crossfade, unmark, remark, relabel, pitchline, insert: silence }[type]
    const run = () => !!(act ? act(detail, type) : editSelection(type, detail))
    return ['carry', 'stretch', 'trim', 'lift', 'fade', 'crossfade'].includes(type) && !detail?.into ? spread(run) : run()
  },
  // a handle clicked: its next way, in turn, as a tool's options cycle, no menu (a fade corner's curve, the grip's trim,
  // stretch or speed; the pitch tool's curve shown or not)
  onmode(kind) {
    const next = (list, now) => list[(list.findIndex(m => m.name === now) + 1) % list.length].name
    ;({ curve: () => setCurve(next(curves, state.fadeCurve)), grip: () => setGrip(next(gripModes, state.gripMode)), pitch: () => setPitch(!state.pitch) })[kind]()
  },
  // a flag's own menu: its name, its going; else the edits for what is under the pointer
  oncontext({ x, y, marker }) { bar.at(marker ? [{ label: 'Name…', hint: marker.label || '', run: marker.rename, icon: glyphs.marker }, { label: 'Delete the marker', run: () => unmark(marker), icon: icons.remove }] : contextMenu(), x, y) },
  onscrub,
  // a pitch, an intonation or formants dragged, heard as they will sound: the first 2 s of what they move, through the
  // library's pitch() (a voice's: a semitones, or the pitch line's curve, its times from where it is heard),
  // intonation() or formant(), as the script will have it; at none, as it is
  onaudition(o) {
    if (!o) return pl.audition(null)
    const { at } = o, voice = { voice: true }
    pl.audition(at, at + Math.min(o.duration, 2), o.curve ? ['pitch', { t: o.curve.t.map(t => t - at), v: o.curve.v }, voice]
      : o.pitch ? ['pitch', o.pitch, voice] : o.intonation != null && o.intonation !== 1 ? ['intonation', o.intonation] : o.formant ? ['formant', o.formant] : null)
  },
  hint: hints
})
v.display = state.display
v.scale = state.scale
v.units = state.units
v.levels = state.levels
v.ruler = state.ruler
v.scroll = state.scroll
v.grid = state.grid
v.levelStep = state.levelStep
v.spectrogram = paint(state.look)
v.waveform = state.wave
pl.scrubMode = state.scrub
// the speed kept from before
pl.rate = state.speed
// the panel as wide as it was left
if (state.panel) root.querySelector('.panes').style.setProperty('--panel', `${state.panel}px`)
v.show = state.show
v.snapping = state.snapping
v.fadeCurve = state.fadeCurve
v.gripMode = state.gripMode
v.pitching = state.pitch
v.envelope = envelopeOf(ed.code)
v.shift = shiftOf(ed.code)
// The sound shown as it was left, at once, before the engine is up
standIn(first)
// The page is wired: its menus, its tabs, its script and its picture are all laid out, in the frame the first paint
// already drew. Shown after the view's first frame, so what comes up is the sound where it was left, never an empty
// picture that fills in after (editor.css, data-boot).
requestAnimationFrame(() => requestAnimationFrame(() => root.removeAttribute('data-boot')))

// What a call sets, drawn over the output (ops.js guides), from its values by its parameters' names (`spec`)
function guidesOf(call, spec, values = valuesOf(spec, call)) {
  const named = Object.fromEntries(spec.map((s, i) => [s.name, values[i]]))
  for (const arg of call.args) if (arg.kind === 'object') for (const p of arg.props) named[p.name] ??= p.value
  return guides(call.name, named, v.duration)
}
// The agent's last edit, drawn over the output while the script is as it left it (showEdit): { code, guides }
let shown = null, carded = false
// The edits, the stack of the chain's steps; the card under the pointer draws what it sets over the output (ops.js
// guides), and none pointed at, what the agent's last edit sets. What the output shows when it is not the whole chain
// (the chain up to the step chosen, what a step takes out) runs in place of the script.
rk = stack(root.querySelector('.steps'), {
  ed,
  describe: name => eng.describe(name),
  duration: () => v.duration,
  // the sound the chain starts from; with tracks, the track's name before it
  source: () => { const s = source(ed.code), files = s?.strings.length ? s.strings.map(x => label(x.name)).join(' + ') : null; return files && state.track ? `${state.track} · ${files}` : files },
  oncall(call, spec, values) { carded = !!(call && spec); v.guides = carded ? guidesOf(call, spec, values) : shown?.guides ?? [] },
  onview(next) { viewing = next; schedule(0) },
  // a slider's move shows on the picture at once, where a level says it (ops.js previews), until its output comes
  onpreview(name, was, is) { v.preview(previews[name]?.(was, is, v.duration) ?? null) },
  // a row's own menu, right-clicked; the chain up to a row made one sound
  oncontext({ x, y, items }) { bar.at(items, x, y) },
  onflatten: to => flatten(to),
  // with tracks, the one edited: its card's × takes it away
  track: () => state.track,
  onuntrack: untrack,
  keys
})
// the track edited one the script has (a link's script, opened anew, has none chosen): set before the page's state is
// all made, so nothing it shows is asked for yet
state.track = trackOf(state.track)
focus(state.track)
rk.refresh()
remember(ed.code)

// The app menu: everything the page does, each where apps put it, with its keys (menu.js). Items that can't act now
// show, dimmed, so the menu also says what there is.
function menus() {
  const sel = v.selection, band = v.band, whole = state.whole, none = !whole, spare = shelved()
  const check = (label, checked, run, extra) => ({ label, checked, run, ...extra })
  const recipesMenu = [...new Set(recipes.map(r => r.group))].flatMap(group => [{ group }, ...recipes.filter(r => r.group === group).map(r => ({ label: r.name, hint: r.text, run: () => useRecipe(r) }))])
  return [
    { name: 'File', items: [
      { label: 'New tab', hint: 'An empty script', run: () => newTab() },
      { label: 'Open file…', keys: keys('⌘O'), run: pickFiles },
      { label: 'Open as a new track…', hint: 'Under the one edited, played with it', run: () => pickFiles('', true), disabled: none },
      { label: state.whole ? 'Record at the caret' : 'Record', keys: 'R', run: startRecording, disabled: !!state.recording },
      { label: 'Find a sound…', tip: 'Freesound, Jamendo, Wikimedia', run: openSearch },
      { label: 'Kept sounds', hint: 'Opened or recorded here, in no tab', items: [...spare.map(([name, f]) => ({ label: name, hint: `${bytes(f.size)}, ${ago(f.lastModified)}`, run: () => place([name], 'new') })), '-', { label: 'Delete them…', run: unshelve }], disabled: !spare.length },
      { label: 'Samples', items: Object.entries(builtins).map(([name, text]) => ({ label: name, hint: text, run: () => useSample(name) })) },
      { label: 'Generate', items: generators.map(g => ({ label: g.name, hint: g.text, run: () => useCode(g.code) })) },
      { label: 'Recipes', items: recipesMenu },
      '-',
      { label: state.saves.length > 1 ? `Export ${state.saves.length} files` : 'Export', keys: keys('⌘S'), run: exportFiles, disabled: none || state.exporting },
      { label: 'Export as', items: formats.map(f => check(f.name.toUpperCase(), state.format === f.name, () => state.setFormat(f.name), { hint: f.text })), disabled: state.saves.length > 0 },
      { label: 'Export the parts between markers', tip: 'A file per part', run: () => exportFiles(true), disabled: none || !output?.markers?.some(m => !m.duration) },
      { label: 'Export the track alone', hint: state.track ?? '', run: () => exportFiles(false, state.track), disabled: none || !state.track },
      { label: 'Export each track', hint: state.track ? `${tracksOf(ed.code).length} files` : '', run: () => exportFiles(false, true), disabled: none || !state.track },
      { label: 'Copy a link to this script', tip: 'Files opened here are not in it', run: share },
      '-',
      { label: 'Close tab', run: () => closeTab() },
      { label: 'Reopen closed tab', keys: keys('⇧⌘T'), run: reopenTab, disabled: !closed.length }
    ] },
    { name: 'Edit', items: [
      { label: 'Undo', keys: keys('⌘Z'), run: () => ed.undo(), disabled: !state.canUndo },
      { label: 'Redo', keys: keys('⇧⌘Z'), run: () => ed.redo(), disabled: !state.canRedo },
      { label: 'History', items: undoList().map(step => check(step.label, step.current, () => goTo(step.index), { hint: step.ahead ? 'undone' : '' })), disabled: steps.length < 2 },
      '-',
      edit('Cut', 'cut', '⌘X', sel && !band),
      edit('Copy', 'copy', '⌘C', sel && !band),
      edit('Paste', 'paste', '⌘V', state.canPaste),
      edit('Delete', 'remove', '⌫', sel),
      edit('Keep only the selection', 'crop', 'K', sel && !band),
      edit('Move to a new track', 'track', '', sel && !band && state.ranges < 2),
      { label: 'Split the voice to a new track', hint: 'The rest stays here', run: () => editSelection('voice'), disabled: none || mastering() },
      { label: 'Split into four stems', hint: 'Voice, bass, drums; the rest stays here', run: () => editSelection('stems'), disabled: none || mastering() },
      { label: 'Line up with', hint: 'In time, by where the two agree', items: others().map(name => ({ label: name, run: () => lineUp(name) })), disabled: !others().length },
      { label: 'Match with', hint: 'Its tone, then its loudness', items: others().map(name => ({ label: name, run: () => matchUp(name) })), disabled: !others().length },
      { label: 'Duck under', hint: 'Quieter while it sounds', items: others().map(name => ({ label: name, run: () => duckUnder(name) })), disabled: !others().length },
      { label: 'Add a master', hint: 'The tracks\' sum, through steps of its own', run: masterOut, disabled: !state.track || !!masterOf(ed.code) },
      { label: 'Move the track to its own tab', hint: state.track ?? '', run: detach, disabled: !state.track || mastering() },
      { label: 'Delete the track', hint: state.track ?? '', run: untrack, disabled: !state.track },
      '-',
      edit(band ? '6 dB quieter' : '3 dB quieter', 'quieter', '', sel),
      edit(band ? '6 dB louder' : '3 dB louder', 'louder', '', sel),
      edit(band ? 'Rebuild the band from around it' : 'Rebuild from around it', 'repair', '', band || (sel && state.ranges < 2)),
      edit('Remove the clicks there', 'declick', '', sel),
      edit('Take this noise out everywhere', 'denoise', '', sel, 'The selection is the noise print'),
      { label: sel ? 'Find an edit for the selection…' : 'Find an edit…', keys: keys('⌘P'), run: () => openTools(), disabled: none },
      '-',
      { label: sel ? 'Mark the selection' : 'Add a marker', keys: 'M', run: addMarker, disabled: none },
      { label: 'A click on a marker\'s name renames it', disabled: true },
      '-',
      { label: 'Group the edits', hint: 'Those picked with Shift, or the one chosen', keys: keys('⌘G'), run: () => rk.group(), disabled: none },
      { label: 'Ungroup', keys: keys('⇧⌘G'), run: () => rk.ungroup(), disabled: none }
    ] },
    { name: 'Select', items: [
      { label: 'All', keys: keys('⌘A'), run: () => v.select(0, v.duration), disabled: none },
      { label: 'None', keys: 'Esc', run: () => v.select(0, 0), disabled: !sel },
      '-',
      { label: 'The fragment at the caret', hint: 'between its cues', keys: 'double-click', run: () => v.around('fragment'), disabled: none },
      { label: 'The sound at the caret', hint: 'between its pauses', keys: 'triple-click', run: () => v.around('sound'), disabled: none },
      { label: 'The next one like it, too', keys: keys('⌘D'), tip: 'The next pause, or stretch between cues', run: () => v.addNext(), disabled: !sel || !!band },
      { label: 'Another range: Alt and drag', disabled: true },
      '-',
      { label: 'Caret to the next cue', keys: keys('⌥→'), run: () => v.step('fragment', 1), disabled: none },
      { label: 'Caret to the cue before', keys: keys('⌥←'), run: () => v.step('fragment', -1), disabled: none },
      { label: 'Caret to the next sound', keys: keys('⌘→'), run: () => v.step('sound', 1), disabled: none },
      { label: 'Caret to the sound before', keys: keys('⌘←'), run: () => v.step('sound', -1), disabled: none },
      { label: 'Caret to the start', keys: 'Home', run: () => v.setCursor(0), disabled: none },
      { label: 'Caret to the end', keys: 'End', run: () => v.setCursor(v.duration), disabled: none },
      '-',
      { label: 'Shift with any of these extends the selection', disabled: true }
    ] },
    { name: 'View', items: [
      ...displays.map(d => check(d.label, state.display === d.name, () => setDisplay(d.name))),
      lookMenu('wave'), lookMenu('spec'),
      { label: 'Grid', items: grids.map(([name, label, hint]) => check(label, state.grid === name, () => setGrid(name), { hint })) },
      { label: 'Theme', items: [
        check('The screen', !worn, () => dress(null), { hint: 'Grey on black, as the site draws it' }),
        ...[['Light', /^light/], ['Dark', /^dark/], ['High contrast', /^hc/]].flatMap(([group, kind]) => ['-', { group }, ...THEMES.filter(t => kind.test(t.kind)).map(t => check(t.name, worn?.name === t.name, () => setTheme(t)))]),
        ...worn && !THEMES.some(t => t.name === worn.name) ? ['-', check(worn.name, true, () => {})] : [],
        '-',
        { label: 'Open a VS Code theme…', hint: 'Any theme\'s .json file', run: openTheme }
      ] },
      '-',
      ...overlays.map(([name, label, tip]) => check(label, state.show[name], () => toggleShow(name), { tip })),
      check('Pitch curve', state.pitch, () => setPitch(!state.pitch), { hint: 'The voice\'s pitch on the spectrogram, dragged whole or by its bends; a click on a selection\'s pitch tool shows it too' }),
      check('Snap to cues and markers', state.snapping, () => state.toggleSnap(), { tip: 'Hold Alt to see them' }),
      '-',
      { label: 'Zoom in', keys: '=', run: () => v.zoom(.5), disabled: none },
      { label: 'Zoom out', keys: '−', run: () => v.zoom(2), disabled: none },
      { label: 'Zoom to the selection', run: () => v.zoomTo(...sel), disabled: !sel },
      { label: 'Show all of it', keys: '0', run: () => v.fit(), disabled: none },
      '-',
      check('The panel', !!state.side, () => state.toggleSide()),
      check('Its edits', state.side === 'edits', () => state.setSide('edits')),
      check('Its code', state.side === 'code', () => state.setSide('code')),
      check('Its export', state.side === 'export', () => state.setSide('export')),
      { label: 'Times in', items: UNITS.map(([name, label, example]) => check(label, state.units === name, () => setUnits(name), { hint: example })) },
      '-',
      { label: 'Reset the view', run: resetView }
    ] },
    { name: 'Process', items: [
      ...kinds().map(k => ({ ...k, disabled: none })),
      '-',
      { label: 'Find an edit…', keys: keys('⌘P'), run: () => openTools(), disabled: none }
    ] },
    { name: 'Play', items: [
      { label: state.playing ? 'Pause' : sel ? 'Play the selection' : 'Play from the caret', keys: 'Space', tip: 'Hold Play and drag to rewind or skip', run: togglePlay, disabled: !whole || !!state.recording },
      check('Loop', state.loop, toggleLoop, { keys: 'L', disabled: !whole }),
      check('Hear it before the edits', state.ab, toggleAB, { keys: 'B', tip: 'The original, level-matched', disabled: !state.canCompare }),
      { label: 'Speed', hint: 'Pitch kept', items: SPEEDS.list.map(r => check(`${r}×`, state.speed === r, () => setSpeed(r))) },
      '-',
      { label: 'Check against', items: specs.map(sp => check(sp.label, state.spec === sp.key, () => state.setSpec(sp.key))) }
    ] },
    { name: 'Help', items: [
      { label: 'Mouse and keys', run: () => root.querySelector('dialog.help').showModal() },
      { label: 'The library, audio', run: () => open('https://github.com/audiojs/audio#readme', '_blank', 'noopener') },
      { label: 'This page’s source', run: () => open('https://github.com/audiojs/audio/tree/master/repl', '_blank', 'noopener') }
    ] }
  ]
}
// Every method by kind, a submenu each, for the output or what is selected (addOp): first what the selection is most
// often given of that kind (`lead`, by group), then every other method of it by name, but those the menu has already
// (`skip`: a context menu's Cut, Copy, Paste)
const method = (name, open = true) => ({ label: labelOf(name), hint: ops[name].text, run: () => addOp(name, open), op: name })
const kinds = (lead = {}, open = true, skip = []) => GROUPS.map(group => ({ label: group, icon: groupIcons[group], items: [
  ...lead[group] ? [...lead[group], '-'] : [],
  ...Object.values(ops).filter(op => op.group === group && !skip.includes(op.name) && !lead[group]?.some(it => it.op === op.name)).map(op => method(op.name, open))
] }))
// The methods last used (`recent`: addOp, from a menu or the palette), the newest first; the context menu offers them
// again, each as that context words it where it has its own item for it (`lead`), else by its name
const used = name => { recent = [name, ...recent.filter(n => n !== name)].slice(0, 3); later() }
const recents = (lead = {}) => {
  const own = Object.values(lead).flat(), list = recent.filter(n => ops[n]).map(n => own.find(it => it.op === n) ?? { ...method(n, false), icon: opIcons[n] })
  return list.length ? ['-', { group: 'Recent' }, ...list] : []
}
// an edit of the selection, as a menu item: dimmed while there is nothing it can act on
const edit = (label, type, key, when, tip) => ({ label, keys: key && keys(key), tip, run: () => editSelection(type), disabled: !when })
const bar = menubar(root.querySelector('.menubar'), menus)
// What the settings hold, group by group: each its choices, what the chosen one does said under them; a section of
// them by kind (sections): what shows over the sound and how time reads; how an edit steps and joins; how a held caret
// sounds and a take records; how each picture draws, the waveform's colour, lanes, fill and level units, the
// spectrogram's method, frequency scale, colours, gamma, range and FFT size
function optionGroups(kind) {
  const group = (label, list, now, set) => ({ label, options: list.map(([value, name, hint]) => ({ label: name, hint, on: now === value, run: () => set(value) })) })
  if (kind === 'wave') return [
    group('Colour', waveLooks.colour, state.wave.colour, c => setWave('colour', c)),
    group('Channels', waveLooks.lanes, state.wave.lanes, c => setWave('lanes', c)),
    group('Fill', waveLooks.fill, state.wave.fill, c => setWave('fill', c)),
    group('Levels in', levelList.map(l => [l.name, l.label, `The level axis in ${l.label.toLowerCase()}: ${l.example}`]), state.levels, setLevels)
  ]
  if (kind === 'spec') return [
    group('Method', specMethods, state.look.method, m => setLook('method', m)),
    group('Frequency scale', Object.entries(scales).map(([name, sc]) => [name, scaleNames[name], sc.text[0].toUpperCase() + sc.text.slice(1)]), state.scale, setScale),
    group('Colours', looks.map.map(m => [m, m[0].toUpperCase() + m.slice(1), m === 'grey' ? 'The screen\'s ink, the page through it' : `Matplotlib's ${m}`]), state.look.map, m => setLook('map', m)),
    group('Gamma', looks.gamma.map(g => [g, `γ${g}`, g < 1 ? 'Quiet parts brighter' : g > 1 ? 'Quiet parts darker' : 'Levels even']), state.look.gamma, g => setLook('gamma', g)),
    group('Range', looks.depth.map(d => [d, `${d}dB`, `From the loudest down ${d} dB to the floor`]), state.look.depth, d => setLook('depth', d)),
    group('FFT size', looks.size.map(n => [n, n ? String(n) : 'Auto', n ? `Frames of ${n} samples` : 'Frames of 40 ms, longer on a zoomed band']), state.look.size, n => setLook('size', n))
  ]
  if (kind === 'edit') return [
    group('Level steps', state.steps.map(db => [db, `${db}dB`, `A selection's level, dragged by its pill, goes ${db} dB a step`]), state.levelStep, setStep),
    group('Splices', state.splices.map(ms => [ms, ms ? `${ms}ms` : 'Off', ms ? `An edit's seams crossfaded over ${ms} ms, so they make no click` : 'At a seam, either side meets as it is']), state.splice, setSplice)
  ]
  if (kind === 'play') return [
    group('Scrub', scrubs.map(m => [m.name, m.label, m.text]), state.scrub, setScrub),
    group('Record in', [[1, 'Mono', 'One channel, the input\'s first: a voice, one microphone'], [2, 'Stereo', 'Two channels, as the input gives them: a stereo pair, an interface\'s two inputs']], state.recordIn, setRecordIn)
  ]
  return [
    { label: 'Show over the sound', note: 'Each on or off', options: [
      ...state.overlayList.map(o => ({ label: o.label, hint: o.title, on: !!state.show[o.name], run: () => toggleShow(o.name) })),
      { label: 'Snap', hint: 'To cues and markers; hold Alt to see them', on: state.snapping, run: () => state.toggleSnap() }
    ] },
    group('Times in', state.unitList.map(u => [u.name, u.short, `${u.label}: ${u.example}`]), state.units, setUnits),
    group('Time row', rulers.map(r => [r.name, r.label, r.name === 'none' ? 'Only the times that matter now' : r.name === 'ticks' ? 'Ticks along the time row, no labels' : 'The times along the row, labelled']), state.ruler, setRuler),
    group('Scroll', scrolls, state.scroll, setScroll),
    group('Grid', grids, state.grid, setGrid)
  ]
}
// The settings' sections, each folded to its name and what is chosen in it, opened by a press, kept so (`folds`)
const sections = [['view', 'View'], ['edit', 'Editing'], ['play', 'Scrub and record'], ...displays.map(d => [d.name, d.label])]
const settingSections = () => sections.map(([kind, label]) => {
  const groups = optionGroups(kind)
  return { kind, label, groups, open: !!state.folds[kind], chosen: groups.flatMap(g => g.options.filter(o => o.on).map(o => o.label)).join(', ') }
})
function fold(kind, open) {
  if (!!state.folds[kind] === open) return
  state.folds = { ...state.folds, [kind]: open }
  store()
}
// the View menu's submenus, the same groups
function lookMenu(kind) {
  return { label: kind === 'wave' ? 'Waveform' : 'Spectrogram', items: optionGroups(kind).map(g => ({ label: g.label, items: g.options.map(o => ({ label: o.label, hint: o.hint, checked: o.on, run: o.run })) })) }
}
// The settings (their button): a dropdown under it, its sections folded to a row each, unfolded in place, no levels to
// go through; the button again, a press outside or Esc closes it
let dropOwner = null
function openDropdown(owner) {
  const panel = root.querySelector('.dropdown')
  if (panel.matches(':popover-open')) return closeDropdown()
  dropOwner = owner
  state.dropdown = true
  owner.setAttribute('aria-expanded', 'true')
  panel.showPopover()
  const r = owner.getBoundingClientRect(), w = panel.offsetWidth, h = panel.offsetHeight
  panel.style.left = `${Math.max(8, Math.min(innerWidth - w - 8, r.right - w))}px`
  const top = r.bottom + 6 + h > innerHeight - 8 ? Math.max(8, r.top - 6 - h) : r.bottom + 6
  // what is left of the window below it, scrolled within: the groups fill in after it is placed, the settings' taller
  // than a short window
  panel.style.top = `${top}px`
  panel.style.maxHeight = `${innerHeight - 8 - top}px`
}
// closed: at once by its button or a press outside, or by Esc (the popover's own toggle)
function closeDropdown() {
  const panel = root.querySelector('.dropdown')
  if (panel.matches(':popover-open')) panel.hidePopover()
  dropOwner?.setAttribute('aria-expanded', 'false')
  dropOwner = null
  state.dropdown = false
}
function dropToggle(event) { if (event.newState === 'closed' && dropOwner) closeDropdown() }
function settingsMenu(event) { openDropdown(event.currentTarget) }
// a press outside the dropdown and its button closes it
addEventListener('pointerdown', event => {
  const panel = root.querySelector('.dropdown')
  if (panel.matches(':popover-open') && !panel.contains(event.target) && !dropOwner?.contains(event.target)) closeDropdown()
}, true)
// The picture's context menu (a right-click on it): what is done to what is under the pointer and nothing else, as
// Audacity's on a clip. What the picture has a handle for leaves it (the fades, the corners; the level, the pill), and
// how it draws is the settings'. Then the methods last used, each written for it, and every method by kind, as Process
// has them, what the selection is most often given of each kind leading its list (a crossfade across it; the clicks
// taken out, a rebuild, the noise learned there), each a step of the chain; ⌘P finds any. At the caret: paste, a
// marker, all of it, and the methods for all of it
function contextMenu() {
  const list = v.ranges, several = list.length > 1
  const lead = (label, name) => ({ label, run: () => addOp(name, false), icon: opIcons[name], op: name })
  const act = (label, type, key, when, icon) => ({ ...edit(label, type, key, when), icon, op: type })
  // with tracks, the one edited taken away
  const untracking = state.track ? [...mastering() ? [] : [{ label: 'Move the track to its own tab', hint: state.track, run: detach, icon: icons.track }], { label: 'Delete the track', hint: state.track, run: untrack, icon: icons.remove }] : []
  const repair = [act(several || v.boxes.length > 1 ? 'Remove the clicks in each' : 'Remove the clicks here', 'declick', '', true, opIcons.declick), act('Rebuild from around it', 'repair', '', !several, icons.repair), act('Take this noise out everywhere', 'denoise', '', true, opIcons.denoise)]
  // the menu's own edits, then the methods, none of them again
  const process = (own, leads = {}) => [...own, ...recents(leads), '-', ...kinds(leads, false, own.map(it => it.op)), { label: 'Find an edit…', keys: keys('⌘P'), run: () => openTools(), icon: glyphs.find }]
  // a band has no pill: its level stays here
  if (v.band) return process([act('Delete the band', 'remove', '⌫', true, icons.remove), act('6 dB quieter', 'quieter', '', true, glyphs.down), act('6 dB louder', 'louder', '', true, glyphs.up)], { Repair: repair })
  if (!list.length) return process([
    act(v.carets.length > 1 ? `Paste at all ${v.carets.length} carets` : 'Paste', 'paste', '⌘V', state.canPaste, icons.paste),
    { label: v.carets.length > 1 ? 'A marker at each caret' : 'Add a marker', keys: 'M', run: addMarker, icon: glyphs.marker },
    { label: 'Select all', keys: keys('⌘A'), run: () => v.select(0, v.duration), icon: glyphs.all },
    ...mastering() ? [] : [{ label: 'Split the voice to a new track', run: () => editSelection('voice'), icon: opIcons.vocals },
      { label: 'Split into four stems', run: () => editSelection('stems'), icon: opIcons.rebalance }],
    ...untracking
  ])
  const [a, b] = v.selection ?? list[0]
  return [
    ...process([
      act('Cut', 'cut', '⌘X', !several, icons.cut), act('Copy', 'copy', '⌘C', !several, icons.copy), act('Paste', 'paste', '⌘V', state.canPaste && !several, icons.paste), act('Delete', 'remove', '⌫', true, icons.remove),
      act('Keep only this', 'crop', 'K', !several, icons.crop),
      act('Move to a new track', 'track', '', !several, icons.track),
      ...untracking
    ], { Edit: [lead('Reverse', 'reverse')], Level: [lead('Crossfade across it', 'crossfade'), lead('Normalize', 'normalize')], Repair: repair }),
    '-',
    { label: several ? 'Mark each' : 'Mark it', keys: 'M', run: addMarker, icon: glyphs.marker },
    { label: 'Zoom to it', run: () => v.zoomTo(a, b), icon: glyphs.zoom }
  ]
}
// the keys in the help as this platform names them
for (const dt of root.querySelectorAll('.help-list dt')) dt.textContent = keys(dt.textContent)
// The palette, a notch over the picture (⌘P, as Figma's quick actions and Sublime's Goto Anything, or ⌘K, as Slack's,
// Linear's and GitHub's; the menus, Add an edit at the foot of the edits), the words to find
// one in hand
function openTools() {
  closeMenus()
  const palette = root.querySelector('#palette'), r = root.querySelector('.view').getBoundingClientRect()
  Object.assign(palette.style, { left: `${r.left + r.width / 2}px`, top: `${r.top + 4}px` })
  state.toolQuery = ''
  state.pick = 0
  if (!palette.matches(':popover-open')) palette.showPopover()
  palette.querySelector('input').focus()
}
const closePalette = () => root.querySelector('#palette').hidePopover()
// The edits for what is selected: a time range, a band of it on the spectrogram, several ranges, or at the caret a paste
function quick({ band, boxes, ranges, selection, carets, canPaste, pauses, whole }) {
  const t = (type, label, keys, icon = type) => ({ type, label, keys, icon: icons[icon] ?? opIcons[icon] ?? groupIcons.Level })
  if (boxes > 1) return [t('remove', `Remove all ${boxes} bands`, '⌫'), t('quieter', 'Each 6 dB quieter'), t('louder', 'Each 6 dB louder'), t('repair', 'Rebuild each from its surroundings'), t('declick', 'The clicks in each, taken out'), t('denoise', 'The noise in each, taken 12 dB down in its band everywhere', '', 'repair')]
  if (band) return [t('remove', 'Remove this band', '⌫'), t('quieter', 'This band 6 dB quieter'), t('louder', 'This band 6 dB louder'), t('repair', 'Rebuild this band from its surroundings'), t('declick', 'The clicks here, taken out'), t('denoise', 'The noise here, taken 12 dB down in this band everywhere', '', 'repair')]
  // several ranges: what acts on each alike; pauses, each shortened
  if (ranges > 1) return [t('remove', `Delete all ${ranges}`, '⌫'), t('quieter', 'Each 3 dB quieter'), t('louder', 'Each 3 dB louder'), ...(pauses ? [t('shorten', 'Shorten each pause to a quarter second', '', 'cut')] : []), t('declick', 'The clicks in each, taken out'), t('denoise', `The noise alone in all ${ranges}: learned there, taken 12 dB down everywhere`, '', 'repair')]
  if (selection) return [t('crop', 'Keep only this', 'K'), t('remove', 'Delete', '⌫'), t('cut', 'Cut', '⌘X'), t('copy', 'Copy', '⌘C'), t('track', 'Move to a new track'), t('quieter', '3 dB quieter'), t('louder', '3 dB louder'), t('declick', 'The clicks here, taken out'), t('repair', 'Rebuild from its surroundings'), t('denoise', 'The noise here, taken 12 dB down everywhere', '', 'repair')]
  // several carets: a paste at each, a marker at each
  if (carets > 1) return [...(canPaste ? [t('paste', `Paste at all ${carets}`, '⌘V')] : []), t('mark', `A marker at each of the ${carets} carets`, 'M', 'paste')]
  return [...canPaste ? [t('paste', 'Paste at the caret', '⌘V')] : [], ...whole ? [t('voice', 'Split the voice to a new track', '', 'vocals'), t('stems', 'Split into four stems: voice, bass, drums, the rest', '', 'rebalance')] : []]
}
function resetView() {
  v.fit()
  state.display = v.display = 'wave'
  state.show = { hits: true, gain: true, meters: true }
  setUnits('clock')
  setLevels('linear')
  setRuler('labels')
  setGrid('marks')
  state.look = { ...LOOK }
  v.spectrogram = paint(state.look)
  state.wave = { ...WAVE }
  v.waveform = state.wave
  marks()
  store()
}


// Runs the script a moment after the last change; a slider runs it at once. Newer runs replace waiting ones.
function schedule(delay) { clearTimeout(timer); timer = setTimeout(evaluate, delay) }
async function evaluate() {
  const code = ed.code
  const syntax = error(code)
  if (syntax) {
    ed.errors([{ ...syntax, message: 'Syntax error' }])
    return show({ logs: [], error: { message: `Syntax error on line ${code.slice(0, syntax.from).split('\n').length}` } }, true)
  }
  // the whole chain, what one step of it takes out, or the chain rolled back, as the stack says
  const calls = chain(code)?.calls || [], { delta, back } = viewing, step = calls[delta]
  const runs = step ? residual(code, delta) : back != null ? rollback(code, back) : code
  const later = back != null ? calls.length - back : 0
  state.viewing = step ? `What ${labelOf(step.name)} takes out` : later > 0 ? `${back ? `Up to ${labelOf(calls[back - 1].name)}` : 'The source alone'}: ${later} later step${later > 1 ? 's' : ''} bypassed` : ''
  // a change to its comments alone (a bypassed step set, a note) runs nothing: the run asked last, and the output it
  // made, are this script's too; the same script asked again (a file it waited for come) runs
  if (sent?.tab === eng.tab && sent.code !== runs && bare(sent.code) === bare(runs)) {
    for (const o of [sent, output]) if (o?.code != null && bare(o.code) === bare(runs)) Object.assign(o, { code: runs, editor: code })
    if (!waiting() && !incoming && outcome) finished(outcome)
    return
  }
  return perform(runs, code)
}
// Runs `runs`, the editor holding `code`, its reply and output shown as they come; the last asked (sent)
let sent = null
async function perform(runs, code) {
  // a script with nothing in it runs nothing, nothing else on its way: no sound, at once, the engine not waited for, so
  // an empty tab offers its ways in as the page comes up (and the run asked last is no longer this script's)
  if (!waiting() && !incoming && !bare(runs).trim()) { sent = null; show({ logs: [] }); return status() }
  const script = prepare(runs)
  await restoring
  // Built-in samples are made when a script first names one; the worker takes messages in order, so the file
  // arrives before the run that opens it, and runs stay in the order they were asked for.
  // A file kept opens as it was kept, before a sample of its name (one kept before names stayed clear of theirs)
  for (const name of script.names) if (!eng.has(name) && (shelf.has(name) || builtins[name])) eng.file(name, shelf.get(name) ?? sample(name))
  // the output keeps the code that made it (what ran, and what the editor had), and the tab it is for
  const tab = eng.tab, coming = sent = Object.assign(arrival(script.names), { code: runs, editor: code, tab })
  asking.set(tab, (asking.get(tab) ?? 0) + 1)
  asked = script.names
  status()
  // the file shown as it is while the output is made, where the picture has nothing of it (worker.js render)
  const result = await eng.run({ ...script, muted: [...state.muted], preview: !state.hasOutput || fresh(script.names) }, coming)
  const left = asking.get(tab) - 1
  left > 0 ? asking.set(tab, left) : asking.delete(tab)
  // another tab shown meanwhile: the reply is the one left's, its output made on for it there (arrival)
  if (!result.skipped && eng.tab === tab) show(result, false, script.names, coming)
  else if (!result.skipped && result.output && docOf(tab)) {
    Object.assign(coming, { id: result.id, said: { lines: saying(result), saves: result.saves || [], names: script.names } })
    docOf(tab).coming = coming
  }
  status()
}
// Stopped: what renders stops, and the edit that set it off is undone, as an editor's Cancel leaves an effect unapplied:
// the script goes back to the one the picture shows, which runs at once from what the worker kept (Redo applies the edit
// again). A worker held past stopping is replaced, and what it kept goes with it: the output shown is made again in the
// new one, and a tab shown again runs its script again
async function stop() {
  const replaced = await eng.stop(), [back] = ed.depth
  if (output?.editor != null && back && steps[back - 1]?.code === output.editor) { const { label } = steps[back]; ed.undo(); note(`Stopped: ${label} undone, Redo applies it again`) }
  else if (replaced && output?.code) perform(output.code, output.editor)
}
eng.onrestart = () => { for (const d of docs) if (d.output) d.output.said = null }

// A run's reply: what the script printed in the console under it; what went wrong, in the status bar after the time
// and at its line in the script. The last output that ran stays. A sound it made
// then arrives (arrival).
function show(result, syntax = false, names = [], coming = null) {
  // the first result, whatever it is, says whether there is a sound: until then the view waits, not invites
  state.ran = true
  const lines = saying(result), e = result.error
  state.lines = lines
  const problem = e ? e.message + (e.line ? ` (line ${e.line})` : '') : ''
  state.problem = problem
  state.missing = e?.missing || ''
  if (syntax) return
  const line = e?.line && lineOf(ed.code, e.line)
  ed.errors(line ? [{ ...line, message: e.message }] : [])
  state.canPaste = !!chain(ed.code)?.calls.some(c => c.name === 'copy' || c.name === 'cut')
  // an edit drawn ahead of its output that failed: the picture goes back to the output there is
  if (e) { v.expect(null); if (!state.hasOutput) entitle(names, false); return finished({ ok: false, problem }) }
  // exports follow the output the page shows: the last run that succeeded
  state.saves = result.saves || []
  entitle(names, !!result.output || state.hasOutput)
  // what it said goes with its output, for its tab shown again (switchTab)
  if (result.output) { coming.id = result.id; coming.said = { lines, saves: state.saves, names }; incoming = docOf(coming.tab).coming = coming; state.loading = !state.hasOutput; return }
  incoming = null
  state.loading = false
  settle(null)
  finished({ ok: true, duration: 0 })
}
// What a run said: what it printed, then its value
const saying = result => [...result.logs || [], ...result.value != null ? [{ level: 'value', text: result.value }] : []]
// The script's line n, from 1: { from, to }, or null past its last
function lineOf(code, n) {
  const lines = code.split('\n')
  if (!(n >= 1 && n <= lines.length)) return null
  const from = lines.slice(0, n - 1).reduce((at, l) => at + l.length + 1, 0)
  return { from, to: from + lines[n - 1].length }
}
// What the run that made an output said, as it said it, its tab shown again: what it printed, its exports, no problem
function retell({ lines, saves, names }) {
  Object.assign(state, { lines, saves, problem: '', missing: '' })
  ed.errors([])
  state.canPaste = !!chain(ed.code)?.calls.some(c => c.name === 'copy' || c.name === 'cut')
  entitle(names, true)
}
// A run's end, for whoever waits on it (an agent's edit): the output's length, or what went wrong; the last (outcome)
let waiters = [], outcome = null
const ran = () => new Promise(resolve => waiters.push(resolve))
const finished = result => { outcome = result; for (const resolve of waiters.splice(0)) resolve(result) }
const within = (promise, ms = 60000) => Promise.race([promise, new Promise(resolve => setTimeout(() => resolve({ ok: false, problem: 'Still running' }), ms))])

// How long a sound already shown holds whole before what is on its way shows in its place as it comes, ms
const WAIT = 250
// A run's output as it arrives. The view keeps what it shows until the new sound is whole, or for a moment: one that
// takes longer than that shows as it comes. A view with nothing, and a file new to it, shows it at once: the file
// itself as it decodes, dim, while the output has nothing yet (it waits for the whole file, as trim and normalize do).
// Its tab left as it comes (`away`: the tab's newest still), it comes on all the same, the tab's own once whole, shown
// at once when the tab is (switchTab), or as far as it has come (takeUp)
function arrival(names) {
  const a = { id: 0, names, parts: [], early: [], sampleRate: 0, channels: 0, total: null, started: performance.now(), last: performance.now(), on: false, preview: false, loaded: null }
  const current = () => incoming === a, away = () => !current() && docOf(a.tab)?.coming === a
  // nor while the picture holds a take recorded, or an edit drawn ahead, till the output that has it comes; nor over
  // another output of these files, shown till this one comes
  const held = () => !a.preview && (v.expecting || state.hasOutput && !fresh(names))
  // the file, dim, from what has come of it on
  const preview = () => {
    if (!current() || a.on || held() || !a.early?.length) return
    if (!a.preview) {
      const m = a.early.at(-1)
      a.preview = true
      showing = 0
      v.stream({ sampleRate: m.sampleRate, channels: (m.channels ?? m.peaks).length, total: m.estimate ? Math.round(m.estimate * m.sampleRate) : null, dim: true, keep: holding })
      aim(false, true)
      lend(null)
      state.whole = false
      state.hasOutput = true
      state.loading = true
    }
    for (const m of a.early.splice(0)) { piece(m); hear(a, m, 'file') }
    status()
  }
  a.loading = m => {
    if (!current() || a.on) return
    a.last = performance.now()
    a.loaded = { at: (m.at + extent(m)) / m.sampleRate, estimate: m.estimate }
    // taken up again as it decoded (takeUp): the file not drawn from part of the way in
    if (held() || !a.early) return status()
    a.early.push(m)
    // while the picture holds the sound as the page was left (`holding`) and the output is still about to come, kept: the
    // page opens the file it was left on, and shows it only once the output takes long enough to be worth saying, from
    // what has come of it by then (all of it, a file that decodes quickly, its steps then still to run)
    const wait = holding && !a.preview ? WAIT - (performance.now() - a.started) : 0
    if (wait > 0) { a.timer ??= setTimeout(preview, wait); return status() }
    preview()
  }
  // all of the file come, the output still nothing: decoded, it renders now
  a.arrived = () => {
    if (!current() || !a.loaded) return
    a.loaded = { ...a.loaded, whole: true }
    status()
  }
  // a script's tracks, before their mix: each its own picture (worker.js mixTracks), the mix then coming as any output
  a.tracks = m => { if (current() || away()) a.lanes = m.tracks }
  // what the engine does for it: the steps it applies, and one reading its input whole first (a model's run over it)
  // while it does
  a.doing = m => {
    if (!current() && !away()) return
    if (m.steps) a.steps = m.steps
    if ('step' in m) a.step = m.step
    status()
  }
  a.chunk = m => {
    if (!current() && !away()) return
    a.last = performance.now()
    a.sampleRate = m.sampleRate
    a.channels = (m.channels ?? m.peaks).length
    if (m.total) a.total = m.total
    // its file still arriving, how much has come
    a.loaded = m.loaded != null ? { at: m.loaded, estimate: m.estimate } : null
    a.parts.push(m)
    if (!current()) return
    hear(a, m, 'output')
    if (a.on) piece(m)
    // tracks' mix: the picture is theirs, drawn once it is whole (done)
    else if (a.lanes) {}
    // an edit the view drew ahead waits whole: the picture it drew holds till then, nothing moving; an output as long as
    // the one shown (an edit over a range, a band taken out) comes in over it as it renders, only where it differs
    else if (alike(a) && m.channels) { if (!v.expecting) v.patch(m.at, m.channels) }
    // the sound the page was left on stays whole until the output is whole too, which takes its place in one step
    // (done); drawn as it renders, it would first go back to nothing and fill again from the start. Only a picture with
    // nothing in it, or an output that takes longer than a moment, shows as it comes; and the file itself, dim, gives
    // way to the output at its first piece, as the engine stops sending the file then (worker.js arriving)
    else if (a.preview || !state.hasOutput && !holding || !v.expecting && performance.now() - a.started > WAIT) begin(a)
    status()
  }
  a.done = m => {
    // its tab left: the tab's own, to show when it is
    if (away()) { Object.assign(docOf(a.tab), { output: assemble(m), coming: null, ready: true }); return badges() }
    if (!current()) return
    incoming = null
    unclaim()
    // an older script's output, while the picture holds an edit drawn ahead of a newer one: not the output it waits for,
    // which is on its way (the script changed since this one ran); taken for it, it would end the wait, and the newer
    // output, arriving unlooked-for, would show all of it again, the view moved under the pointer
    if (v.expecting && !a.on && a.editor !== ed.code) { a.parts = []; return status() }
    const out = assemble(m)
    if (a.on) v.finish()
    settle(out, !a.on, a.editor !== ed.code)
    finished({ ok: true, duration: m.duration, loudness: m.stats?.loudness, peak: m.stats?.peak })
    status()
  }
  // the output whole, from its pieces: its samples, or a long one's leaves (the page draws it from them)
  const assemble = m => {
    const length = Math.round(m.duration * m.sampleRate), leaves = Math.ceil(length / 256) * 4
    const channels = m.long ? null : Array.from({ length: m.channels }, (_, c) => {
      const x = new Float32Array(length)
      for (const p of a.parts) x.set(p.channels[c].subarray(0, Math.max(0, length - p.at)), p.at)
      return x
    })
    const peaks = m.long ? Array.from({ length: m.channels }, (_, c) => {
      const x = new Float32Array(leaves)
      for (const p of a.parts) if (p.peaks) x.set(p.peaks[c].subarray(0, Math.max(0, leaves - p.at / 64)), p.at / 64)
      return x
    }) : null
    // and its spectra, each column's bins after the last's
    const first = a.parts.find(p => p.spectra)?.spectra, bins = first && first.size / 2 + 1, cols = first && Math.ceil(length / first.hop)
    const spectra = m.long && first ? { size: first.size, hop: first.hop, levels: Array.from({ length: m.channels }, (_, c) => {
      const x = new Uint8Array(cols * bins)
      for (const p of a.parts) if (p.spectra) x.set(p.spectra.levels[c].subarray(0, Math.max(0, (cols - p.spectra.at) * bins)), p.spectra.at * bins)
      return x
    }) } : null
    // each track's picture as long as the mix, past its end silent: its samples, or a long one's leaves and spectra
    const tracks = a.lanes?.map(({ name, length: n, channels, silences }) => ({ name, length: n, channels, silences }))
    const lanes = !m.long && a.lanes?.map(t => { const x = new Float32Array(length); x.set(t.mono.subarray(0, length)); return x }) || null
    const pictures = m.long && a.lanes ? { leaves: a.lanes.map(t => t.leaves), spectra: { size: a.lanes[0].spectra.size, hop: a.lanes[0].spectra.hop, levels: a.lanes.map(t => t.spectra.levels) } } : null
    a.parts = []
    return { id: a.id, names, channels, peaks, spectra, long: !!m.long, length, sampleRate: m.sampleRate, duration: m.duration, stats: m.stats, segments: m.segments, markers: m.markers, clips: m.clips, bitDepth: m.bitDepth, code: a.code, editor: a.editor, said: a.said, tracks, lanes, pictures }
  }
  // no longer on its way, the tab's run, or gone: its tab left, it failed, or a newer run of the tab took its place, or
  // the worker was replaced; the tab runs its script again when it is shown
  const unclaim = () => { const d = docOf(a.tab); if (d?.coming === a) d.coming = null }
  const gone = () => { if (away()) { unclaim(); badges() } }
  a.skip = gone
  a.error = m => {
    if (!current()) return gone()
    incoming = null
    unclaim()
    state.problem = m.error.message
    finished({ ok: false, problem: m.error.message })
    v.expect(null)
    // what showed of it goes: the last whole output comes back, or nothing
    if (a.on || a.preview) settle(output?.duration ? output : null)
    state.loading = false
    status()
  }
  return a
}
// A file the shown output doesn't open
const fresh = names => names.join() !== (output?.names || []).join()
// An output arriving as long as the one shown, at its rate, with its channels, of the same files
const alike = a => !!output?.channels && !output.tracks && a.total != null && a.total === output.length && a.sampleRate === output.sampleRate && a.channels === output.channels.length && !fresh(a.names)
// The view shows an output as it arrives; the player has what has come
function begin(a) {
  a.on = true
  a.preview = false
  showing = a.id
  v.stream({ sampleRate: a.sampleRate, channels: a.channels, total: a.total })
  aim(false, true)
  for (const p of a.parts) piece(p)
  state.hasOutput = true
  state.loading = false
}
// A tab's sound held as it was left, before the engine has it (a reload; a tab not shown since): its lanes, its length,
// where it was looked at, dim and empty; the sound comes into it as it arrives
function standIn(doc) {
  const f = doc?.frame
  if (!(f?.duration > 0 && f.rate > 0 && Number.isInteger(f.channels) && f.channels > 0 && f.channels <= 32)) return
  v.stream({ sampleRate: f.rate, channels: f.channels, total: Math.round(f.duration * f.rate), dim: true })
  holding = true
  aim(true)
}
// A whole output (or none) becomes the page's: drawn (unless it was drawn as it came), played, measured
// The tab's sound where it was looked at when it was left, and what was selected on it, before a switch or a reload:
// where it was looked at once, as soon as the sound starts arriving, so the view is where it was while the rest comes in;
// what was selected, and the caret, once all of it has come (`coming` till then, the caret waiting at its start, never
// past what has come), unless the caret was put elsewhere meanwhile
const START = { selection: null, band: null, more: [], cursor: 0, anchor: 0 }, deferred = new WeakSet()
function aim(held = false, coming = false) {
  const doc = docs.find(d => d.id === state.tab), view = doc?.view
  if (doc?.frame) { v.frame = doc.frame; doc.frame = null }
  // what was selected, once there is a sound to select on (not the lanes held for it)
  if (!view || held) return
  if (!(Number.isFinite(view.cursor) && Array.isArray(view.more))) { doc.view = null; return }
  if (coming) { if (!deferred.has(view)) { deferred.add(view); v.state = START } return }
  const now = v.state
  if (!deferred.has(view) || !now.selection && !now.more.length && now.cursor === 0) v.state = view
  doc.view = null
}
function settle(out, draw = true, behind = false) {
  output = out
  holding = false
  // the tab's own, to show at once when it is shown again
  const doc = docs.find(d => d.id === state.tab)
  if (doc) doc.output = out
  const has = !!out?.duration
  showing = has ? out.id : 0
  state.hasOutput = has
  state.whole = has
  state.arriving = false
  state.loading = false
  // tracks, a lane each, the one edited by its name
  v.tracks = has ? lanesShown(out) : null
  if (out?.tracks) v.focus = Math.max(0, out.tracks.findIndex(t => t.name === state.track))
  if (out?.long) v.summary(out.pictures?.leaves ?? out.peaks, out.length, out.sampleRate, out.pictures?.spectra ?? out.spectra)
  else if (draw) v.set(has ? out.lanes ?? out.channels : [], out?.sampleRate)
  else if (has) v.samples = out.channels
  if (has) aim()
  v.segments = lane(out)?.silences ? { silences: lane(out).silences } : out?.segments
  v.clips = out?.clips
  // the markers as the script has them: an older script's output, the newer one on its way, leaves those the view
  // drew ahead of it (made, named, moved) as they are
  if (!behind) v.markers = out?.markers
  // a tab shown again whose player plays its output already plays on as it is
  if (pl.out !== out || !has) lend(out)
  if (!has && pl.playing) togglePlay()
  state.duration = has ? out.duration : 0
  state.ab = false
  state.canCompare = has && !out.tracks && !!sourceName()
  if (!has) restock()
  describe()
  marks()
  meter()
  scheduleCheck()
}
// What the shown tab's player plays: output `out` (none: nothing), the output it holds (`out`) known by it
function lend(out) {
  const has = !!out?.duration
  pl.out = has ? out : null
  pl.set(has ? out.channels : null, out?.sampleRate, has ? hears(out) : null, has ? out.length : 0, fetches(out), has ? lanesOf(out) : null)
}
// The tracks as their lanes show them, each muted or not; none muted with a master, which mixes them as its script says
const lanesShown = out => out?.tracks?.map(t => ({ name: t.name, end: t.length / out.sampleRate, muted: masterOf(ed.code) ? null : state.muted.includes(t.name) })) ?? null
// A track muted, or heard again (its lane's index): the mix made again without it, or with it; its lane says so at once
function toggleMute(i) {
  const name = output?.tracks?.[i]?.name
  if (!name || masterOf(ed.code)) return
  state.muted = state.muted.includes(name) ? state.muted.filter(n => n !== name) : [...state.muted, name]
  v.tracks = lanesShown(output)
  // heard at once: the tracks' sum made as it plays, those muted left out (worker.js voice), taking over where it plays;
  // the mix made again without them comes after, for the levels and the export, and takes over in its turn
  const out = output, muted = [...state.muted]
  pl.out = null
  pl.set(out.channels, out.sampleRate, o => eng.voice({ ...o, output: out.id, muted }), out.length, fetches(out), lanesOf(out))
  store()
  schedule(0)
}
// The track edited (code.js focus), by its name: its chain is the one the edits show, the picture's handles draw on and
// every edit goes to. One the script no longer has gives way to its last track; none without tracks
function focusOn(name) {
  name = trackOf(name)
  if (name === state.track) return focus(name)
  state.track = name
  focus(name)
  const i = output?.tracks?.findIndex(t => t.name === name) ?? -1
  if (i >= 0) v.focus = i
  rk?.refresh()
  v.envelope = envelopeOf(ed.code)
  v.shift = shiftOf(ed.code)
  if (output) v.segments = lane(output)?.silences ? { silences: lane(output).silences } : output.segments
  // its cues not yet found: a double-click goes by its pauses till they are
  v.cues = null
  marks()
  describe()
}
// Track `name` where the script has it (or its master), else its last track; null without tracks
function trackOf(name) {
  const list = [...tracksOf(ed.code).map(t => t.name), ...masterOf(ed.code) ? [masterOf(ed.code).name] : []]
  return list.includes(name) ? name : list.at(-1) ?? null
}
// The output's track edited ({ name, length, silences }), or null; its index, or none, without tracks
function lane(out = output) { return out?.tracks?.find(t => t.name === state.track) ?? null }
function laneIndex(out = output) { const i = out?.tracks?.findIndex(t => t.name === state.track) ?? -1; return i < 0 ? undefined : i }

// What the engine is doing, said after the time once it takes a moment: a file the view has not shown decoding, and
// how much of it has come; an output rendering, and how much of it. One word from the first run to the last output, so
// runs that follow one another (a file dropped opens in a tab, then runs) read as one. Play gives way to a ring of the
// same, its square the way out (`working`): at once while there is nothing to play, after two seconds over a sound there is.
let ticking = 0, asked = [], began = 0
// steps by name, two at most, the rest counted: "highpass, compressor and 8 more"
const several = list => list.length > 2 ? `${list.slice(0, 2).join(', ')} and ${list.length - 2} more` : list.join(' and ')
function status() {
  const now = performance.now(), a = incoming, asks = waiting(), busy = !!(asks || a)
  began = busy ? began || now : 0
  const names = asks ? asked : a?.names ?? [], opens = names.length > 0 && fresh(names)
  const last = a?.parts.at(-1), at = last ? last.at + extent(last) : 0
  // a file still arriving decodes; once all of it has come, what the output waits for is its steps, said by name: the one
  // reading its input whole first (a model's run over it) while it does, which says how long it has taken; else those it
  // applies, and how far they have come
  const decoding = !!a?.loaded && !a.loaded.whole
  let word = a?.step ? `Applying ${a.step}` : a?.steps?.length ? `Applying ${several(a.steps)}` : 'Rendering', share = null, figure = ''
  if (decoding) { word = 'Decoding'; share = a.loaded.estimate ? a.loaded.at / a.loaded.estimate : null }
  else if (opens && !last && !a?.loaded && !a?.steps) word = 'Decoding'
  else if (!asks && a?.total && !a.step) share = at / a.total
  // the figure after the words, apart from them: how far it has come, where the file says nothing of its length how much
  // of it has, else how long it has taken once that is a second
  if (share != null) figure = `${Math.min(99, Math.floor(share * 100))}%`
  else if (decoding) figure = clock(a.loaded.at, 0)
  else if (now - began > 1000) figure = `${((now - began) / 1000).toFixed(1)}s`
  const shown = busy && now - began > 200
  state.progress = shown ? word : ''
  state.figure = shown ? figure : ''
  state.arrived = share == null ? null : Math.min(.99, share)
  state.working = shown
  if (busy && !ticking) ticking = setInterval(status, 100)
  if (!busy && ticking) { clearInterval(ticking); ticking = 0 }
  sway()
}

// Named for its source, or for the files the script opens, while a chain is being typed; so a file that failed to open
// is still named
function entitle(names, has) {
  // with tracks, every file they open
  const opened = tracksOf(ed.code).length ? [...new Set(names)] : source(ed.code)?.strings.map(s => s.name) || names
  state.name = opened.length ? opened.map(label).join(' + ') : has ? 'generated' : 'untitled'
  document.title = `${state.name === 'untitled' ? '' : state.name + ' · '}audio playground`
}

// The one file the script opens, whose original the output compares with; none for generated or joined sources.
const sourceName = () => { const s = source(ed.code)?.strings; return s?.length === 1 ? s[0].name : null }

// Checks the output against the chosen spec, a moment after it settles; a newer output's check replaces an older one's,
// which the page then ignores.
function scheduleCheck(delay = 300) {
  clearTimeout(scheduleCheck.timer)
  if (!state.spec || !state.hasOutput) { state.report = null; state.checking = false; return }
  state.checking = true
  scheduleCheck.timer = setTimeout(async () => {
    const seq = ++checks, spec = state.spec, r = await eng.check(spec)
    if (seq !== checks || spec !== state.spec) return
    state.checking = false
    if (r.error) { state.report = null; return note(`Check failed: ${r.error.message}`) }
    state.report = r.output
  }, delay)
}

// What opens an output to play (player.js set): the engine's, rendered there as it plays; and a long one's samples near
// where it is heard, the engine's
// what plays of an output: in the deck, of the samples the page holds; a long one's, made by the engine
const hears = out => o => eng.voice({ ...o, output: out.id, ...out.channels && { held: { key: out.id, channels: out.channels, sampleRate: out.sampleRate } } })
const fetches = out => out?.long ? (from, to) => eng.samples(out.id, from, to, true) : null
// its tracks' lanes, for a scrub to hear one alone: the page's, or a long one's, the engine's
const lanesOf = out => out?.lanes ?? (out?.long && out.tracks ? (from, to) => eng.samples(out.id, from, to) : null)

// A/B: the original at the same place, level-matched to the output; the next output, or B again, returns to it.
// B, or Play > Hear it before the edits; the word over the picture says which is heard
async function toggleAB() {
  const name = sourceName()
  if (!state.hasOutput) return
  if (!name) return note('A generated sound has no file as it opened to hear it against.')
  if (state.ab) { state.ab = false; lend(output); return note('Hearing the output, after the edits') }
  const loudness = output.stats.loudness
  if (original?.name !== name || original.loudness !== loudness) {
    const r = await eng.original(name, loudness)
    if (!r.sampleRate) return note(r.error?.message || 'The file as it opened is no longer open.')
    original = { name, loudness, ...r }
  }
  state.ab = true
  state.abGain = original.gain
  pl.out = null
  pl.set(original.channels, original.sampleRate, o => eng.voice({ ...o, source: name, loudness, ...original.channels && { held: { key: `original ${name} ${loudness}`, channels: original.channels, sampleRate: original.sampleRate } } }), original.length)
  note(`Hearing before the edits: the file as it opened, level-matched (${original.gain >= 0 ? '+' : '−'}${Math.abs(original.gain).toFixed(1)}dB). B for after`)
}

// What the picture shows besides the sound, as the View menu says: the cues, the pitch curve, the gain line, meters.
async function marks() {
  v.show = state.show
  if (shown && shown.code !== ed.code) { shown = null; if (!carded) v.guides = [] }
  if (!state.whole) return
  // the cues whether they show or not: a double-click selects between them, ⌥ and the arrows step by them, an edge goes
  // onto them. They are the output's shown, read against the code that made it; once the code has moved on (a cue
  // dragged), the output coming brings its own, and the cues the view moved stay till then
  // with tracks, the edited track's
  const out = output, i = laneIndex(out), [edges, hits] = await Promise.all([eng.cues(out.id, 'edges', i), eng.cues(out.id, 'hits', i)])
  if (edges && hits && out === output && out.editor === ed.code && laneIndex() === i) v.cues = cuesOf(cueTimes(edges, hits), out.code)
  // the pitch curve, with the pitch line it was measured with, while pitch is edited: drawn on the spectrogram, the note
  // said over the range
  if (state.pitch) { const f0 = await eng.contour(out.id, i); if (out === output && laneIndex() === i) v.contour = { ...f0, shift: shiftOf(out.code) } }
}
function toggleShow(name) {
  state.show = { ...state.show, [name]: !state.show[name] }
  store()
  marks()
  meter()
}
// The meters at the view's right: the output's level and spectrum where it is heard (the 50 ms before the playhead, a
// spectrum frame ending there), across the selection, or around the caret (meters.js), or around `probe`, a time
// measured on the spectrogram (view.js onprobe); as it plays or records, the level as a peak meter shows it, its peak
// held a while (ballistics, from the last frame's: `peaked`)
let peaked = null
function meter(t = null, probe = null) {
  const size = 4096, now = performance.now()
  const live = l => { const dt = peaked ? (now - peaked.at) / 1000 : 0; peaked = { levels: ballistics(l, peaked?.levels, dt), at: now }; return peaked.levels }
  if (t == null && !recorder) peaked = null
  if (!state.show.meters) { v.meters = null; return }
  // the spectrum read once, and only where a spectrogram's lane draws it (view.js paintMeters): a selection dragged
  // over the waveform reads none, where each move read up to 16 frames a channel
  const read = (levels, f, rate) => { let got; return { levels, get spectra() { return got ??= f() }, size, rate } }
  // recording: what the microphone hears, the 50 ms just come
  if (recorder) {
    const x = recorder.recent, n = x[0]?.length ?? 0, rate = recorder.sampleRate
    v.meters = n ? read(live(levels(x, n - Math.round(rate * .05), n)), () => spectra(x, n - size, n, { size }), rate) : null
    return
  }
  if (!output?.duration) { v.meters = null; return }
  // with tracks, each lane's own; a long output's, the samples about it the player has (none till they come)
  const rate = output.sampleRate, caret = probe ?? v.cursor, sel = t == null && probe == null && v.selection, at = t ?? (sel ? sel[0] : caret), w = output.tracks ? pl.lanes(at) : pl.near(at)
  if (!w) { v.meters = null; return }
  const [a, b] = t != null ? [t - .05, t] : sel || [caret - .025, caret + .025], from = Math.round(a * rate) - w.from, to = Math.round(b * rate) - w.from
  const c = Math.round(caret * rate) - w.from, [s0, s1] = t != null ? [to - size, to] : sel ? [from, Math.max(to, from + size)] : [c - size / 2, c + size / 2]
  const l = levels(w.x, from, to)
  v.meters = read(t != null ? live(l) : l, () => spectra(w.x, s0, s1, { size }), rate)
}
// The picture's switch: the waveform or the spectrogram; the spectrogram's again, its frequencies on the next scale
// (octaves, mel, hertz), said by it a moment
function setDisplay(name, event) {
  if (name === 'spec' && state.display === 'spec') {
    setScale(nextScale(state.scale))
    return hints.flash(scaleNames[state.scale], event?.currentTarget ?? root.querySelector('.display [aria-selected="true"]'), 'display')
  }
  state.display = v.display = name
  store()
}
function setScale(name) { state.scale = v.scale = name; store() }
function setWave(key, value) { state.wave = { ...state.wave, [key]: value }; v.waveform = state.wave; store() }
// How a held caret sounds (scrub.js), one of the lab's ways
function setScrub(name) { state.scrub = name; for (const d of docs) if (d.player) d.player.scrubMode = name; store() }

// What the output is, at the status bar's right: its level, short (the output's peak, or the selection's, or the band
// selected), all of them when pointed at (the loudness, the RMS); then its rate, channels and the depth it is written
// at, a click away from resampling, remixing and another depth.
const hertz = f => f >= 1000 ? `${+(f / 1000).toFixed(2)}kHz` : `${Math.round(f)}Hz`
function describe() {
  listen()
  state.sound = null
  if (!output?.duration) { state.readout = state.readoutTip = ''; return }
  const { sampleRate, channels, peaks, stats, bitDepth } = output, k = (channels ?? peaks).length
  state.sound = { hz: sampleRate, rate: `${+(sampleRate / 1000).toFixed(3)}kHz`, count: k, channels: layouts.find(l => l.count === k)?.label ?? `${k} ch`, bits: bitDepth }
  const sel = state.selection
  if (!sel) {
    state.readout = `peak ${dbfs(stats.peak)}dBFS`
    state.readoutTip = `Loudness ${Number.isFinite(stats.loudness) ? `${dbfs(stats.loudness)} LUFS` : '−∞'}`
    return
  }
  const [a, b] = sel, rate = output.sampleRate, from = Math.floor(a * rate), to = Math.ceil(b * rate), i = laneIndex(), own = output.lanes?.[i], leaves = output.pictures?.leaves[i]
  let peak = 0, sum = 0, n = 0
  // the edited track's, with tracks
  if (channels) for (const ch of own ? [own] : channels) for (let i = from; i < to && i < ch.length; i++) { const x = ch[i]; sum += x * x; n++; if (Math.abs(x) > peak) peak = Math.abs(x) }
  // a long output's from its leaves, those the selection touches whole: within 256 samples at either end
  else for (const l of leaves ? [leaves] : peaks) for (let j = Math.floor(from / 256); j < Math.min(Math.ceil(to / 256), l.length / 4); j++) { peak = Math.max(peak, -l[4 * j], l[4 * j + 1]); sum += l[4 * j + 2]; n += l[4 * j + 3] }
  const pk = dbfs(20 * Math.log10(peak)), rms = dbfs(10 * Math.log10(sum / Math.max(1, n)))
  state.readout = state.boxes > 1 ? `${state.boxes} bands` : state.band ? `${hertz(state.band[0])}–${hertz(state.band[1])}` : `peak ${pk}dBFS`
  state.readoutTip = state.boxes > 1 || state.band ? '' : `RMS ${rms} dBFS`
}
// What the sound holds, as a musician says it (worker.js listen()), before its levels: the note under the caret or over
// the selection, the tempo and key of the selection or of all of it, each only where it is clear; asked once the caret
// or the selection rests, and dropped if they have moved on since. A note's cents from 5 on: less is about the least
// change of pitch heard (frequency DLs of 0.2–0.3% at mid frequencies, 3.5–5 cents: Moore, An Introduction to the
// Psychology of Hearing, 6th ed., 2012, ch. 6), and as close as the pitch curve reads a steady tone (1 cent off on 440 Hz)
let listening = 0
function listen() {
  clearTimeout(listening)
  state.heard = null
  if (!output?.duration || pl.playing || state.band || state.boxes > 1) return
  const out = output, sel = state.selection, at = v.cursor, now = () => out === output && `${state.selection}` === `${sel}` && (sel || v.cursor === at)
  listening = setTimeout(async () => {
    const r = await eng.listen(out.id, sel ? [...sel] : [at - .06, at + .06], sel ? [...sel] : [0, out.duration]).catch(() => null)
    if (!r || !now()) return
    const { pitch, bpm, key } = r, over = sel ? 'the selection' : 'all of it'
    const said = [pitch && (pitch.length > 1 ? `${noteOf(pitch[0], Infinity)}–${noteOf(pitch[1], Infinity)}` : noteOf(pitch[0], 5)), bpm && `${bpm} BPM`, key && `${NOTES[key.tonic]} ${key.mode}`].filter(Boolean)
    state.heard = said.length ? {
      text: said.join(' · '),
      title: [pitch && (pitch.length > 1 ? `Its notes, ${said[0]}: the pitch's range over the selection (pYIN, 10th to 90th percentile)` : `The note ${said[0]}: ${sel ? 'the pitch over the selection, its median' : 'the pitch at the caret'} (pYIN; A4 at 440 Hz)`),
        bpm && `${bpm} BPM, the tempo of ${over}: its halves agree within 4%`, key && `${NOTES[key.tonic]} ${key.mode}, the key of ${over} (Krumhansl-Schmuckler): its halves agree`].filter(Boolean).join('. ')
    } : null
  }, 250)
}
function setRecordIn(n) { state.recordIn = n; store() }
function setUnits(name) {
  state.units = v.units = name
  state.time = stamp(pl.playing ? pl.time : v.cursor)
  describe()
  store()
}
function setLevels(name) { state.levels = v.levels = name; store() }
function setRuler(mode) { state.ruler = v.ruler = mode; store() }
function setScroll(mode) { state.scroll = v.scroll = mode; store() }
function setGrid(name) { state.grid = v.grid = name; store() }
function setStep(db) { state.levelStep = v.levelStep = db; store() }
function setSplice(ms) { state.splice = ms; store() }
function setLook(key, value) { state.look = { ...state.look, [key]: value }; v.spectrogram = paint(state.look); store() }
function toggleLoop() { state.loop = !state.loop; pl.loop = state.loop }
// The sound's rate or channels changed from the display: the chain's last resample() or remix() set again, else one
// added at its end
function resampleTo(hz) { closeMenus(); retune('resample', hz, output?.sampleRate) }
// Down, the ITU-R BS.775 downmix (remix(n), fn/remix.js); up from mono, the sound in the centre (5.1, 7.1) or on both
// sides; from stereo to 5.1 the matrix upmix (surround(): the mid in the centre, the side delayed into the surrounds,
// the LFE lowpassed), on to 7.1 the surrounds in the back pair too, as from 5.1
function remixTo(n) {
  closeMenus()
  const now = output?.channels.length, wide = 'remix([0, 1, 2, 3, 4, 5, 4, 5])'
  if (!now || n === now) return
  if (n < now || now === 1 && n === 2) return retune('remix', n, now)
  write(now === 1 ? `remix([${Array.from({ length: n }, (_, c) => c === 2 ? 0 : 'null').join(', ')}])` : now === 2 ? `surround()${n === 8 ? `.${wide}` : ''}` : now === 6 && n === 8 ? wide : `remix(${n})`)
}
function retune(name, value, now) {
  const last = amend(name), arg = last?.call.args[0]
  if (arg?.kind === 'number') return ed.change({ from: arg.from, to: arg.to, insert: String(value) })
  if (value !== now) write(`${name}(${value})`)
}
function toggleRecording() { state.recording ? stopRecording() : startRecording() }

// The panel's left edge, dragged: its width, from 280 px to two thirds of the output's, kept in this browser
function resizePanel(event) {
  const panes = root.querySelector('.panes'), side = root.querySelector('.side-slab'), from = event.clientX, was = side.getBoundingClientRect().width
  event.preventDefault()
  event.target.setPointerCapture(event.pointerId)
  const go = e => { state.panel = Math.round(Math.max(280, Math.min(panes.clientWidth * 2 / 3, was + from - e.clientX))); panes.style.setProperty('--panel', `${state.panel}px`) }
  const stop = () => { event.target.removeEventListener('pointermove', go); store() }
  event.target.addEventListener('pointermove', go)
  event.target.addEventListener('lostpointercapture', stop, { once: true })
}

// History: the script after each step it took, named by what changed (said), for the list under Undo. Typing merged
// into a step changes it in place; a slider's step is taken where it comes to rest. Beside each step, what was selected
// on the picture (view.js state) and the card chosen in the edits, as it was made (`before`, the edit not yet drawn) and
// as it was left (`after`, when undone): undo brings back what was selected and chosen before the step, redo what was
// after it, as a text editor's history brings back its selections (CodeMirror keeps them in each of its events), and
// as Photoshop's history goes back to the state an action was taken from: an edit made with the output rolled back to a
// card takes the steps after it away, and undone, brings them back with the output rolled back to that card again.
// What is selected is the page's, not the sound's: it stays out of the script.
function remember(code, sliding) {
  const [back, ahead] = ed.depth, was = depthWas, now = v?.state && { ...v.state, chosen: rk?.shown().id ?? null }
  if (sliding && back === was) return
  depthWas = back
  const restore = s => { v.state = s; rechoose = s.chosen ?? null }
  // undone, an edit drawn ahead of its output is not coming: the picture goes back to the output there is
  if (back < was) { v.expect(null); if (steps[was]) steps[was].after = now; if (steps[back + 1]?.before) restore(steps[back + 1].before) }
  else if (back > was && steps[back]?.code === code && steps[back].after) restore(steps[back].after)
  if (steps[back]?.code !== code) steps[back] = { code, label: back ? said(steps[back - 1]?.code ?? '', code) : 'The script as it opened', before: back > was ? now : steps[back]?.before }
  steps.length = back + ahead + 1
}
function undoList() {
  const [back] = ed.depth
  return steps.map((s, index) => ({ index, label: s?.label ?? '', current: index === back, ahead: index > back })).reverse()
}
function goTo(index) {
  const [back] = ed.depth
  for (let i = back; i > index; i--) ed.undo()
  for (let i = back; i < index; i++) ed.redo()
}
// A step in a few words: the sound opened, a call added, removed or set again
const verbs = { remove: 'Delete', cut: 'Cut', copy: 'Copy', paste: 'Paste', move: 'Move', crop: 'Keep only', gain: 'Level', spectral: 'Band level', repair: 'Rebuild', stretch: 'Stretch', pitch: 'Pitch', warp: 'Move a cue', fade: 'Fade', insert: 'Silence' }
function said(before, after) {
  // a track made or taken away, by its name; several, a split undone, by theirs
  const named = code => tracksOf(code).map(t => t.name), had = named(before), has = named(after)
  const made = has.length > had.length && has.findLast(t => !declared(before).has(t)), gone = has.length < had.length ? had.filter(t => !declared(after).has(t)) : []
  if (made) return `New track ${made}`
  if (gone.length) return `Delete track${gone.length > 1 ? 's' : ''} ${gone.join(', ')}`
  const was = chain(before)?.calls || [], now = chain(after)?.calls || []
  const text = (code, k) => code.slice(k.list.from + 1, k.list.to - 1).replace(/\s+/g, ' ').trim()
  const same = (i, j) => was[i]?.name === now[j]?.name && text(before, was[i]) === text(after, now[j])
  const opened = x => source(x)?.text ?? ''
  if (opened(before) !== opened(after)) { const names = source(after)?.strings.map(x => label(x.name)); return names?.length ? `Open ${names.join(' + ')}` : 'Change the sound' }
  let i = 0
  while (i < was.length && i < now.length && same(i, i)) i++
  const rest = (d, e) => { for (let k = 0; i + k + d < was.length || i + k + e < now.length; k++) if (!same(i + k + d, i + k + e)) return false; return true }
  if (now.length === was.length + 1 && rest(0, 1)) return named(after, now[i])
  if (was.length === now.length + 1 && rest(1, 0)) return `Remove .${was[i].name}()`
  if (was.length === now.length && i < now.length && was[i].name === now[i].name && rest(1, 1)) return `${now[i].name}: ${brief(text(before, was[i]))} → ${brief(text(after, now[i]))}`
  // a step bypassed, set anew
  const off = offCalls(before), on = offCalls(after), j = on.findIndex((o, j) => o.text !== off[j]?.text)
  if (i === was.length && i === now.length && off.length === on.length && j >= 0 && on[j].name === off[j].name) return `${on[j].name}, bypassed: ${brief(text(before, off[j]))} → ${brief(text(after, on[j]))}`
  return 'Edit the script'
}
const brief = t => t.length > 28 ? t.slice(0, 27) + '…' : t || '()'
function named(code, k) {
  const range = k.args.find(a => a.kind === 'object')?.props, at = range?.find(p => p.name === 'at')?.value, d = range?.find(p => p.name === 'duration')?.value
  const where = typeof at === 'number' && typeof d === 'number' ? ` ${at.toFixed(2)}–${(at + d).toFixed(2)}s` : ''
  return verbs[k.name] ? verbs[k.name] + where : `.${k.name}(${brief(code.slice(k.list.from + 1, k.list.to - 1).replace(/\s+/g, ' ').trim())})`
}

// Transport
// What plays: the selection, looped or not, a band of it alone; else all of it, looped or not, from the caret (from the
// start once the caret is at the end)
// what Play plays: several boxes, each its band over its time, from the first to the last; a selection (a band of it),
// from the caret if it is inside it, as where playback paused there; else from the caret on
const plays = (at = v.cursor) => v.boxes.length > 1 ? { from: v.boxes[0][0], to: Math.max(...v.boxes.map(b => b[1])), loop: state.loop, boxes: v.boxes }
  : v.selection ? { from: v.selection[0], to: v.selection[1], loop: state.loop, band: v.band, start: at > v.selection[0] && at < v.selection[1] ? at : v.selection[0] }
  : { from: 0, loop: state.loop, start: at >= v.duration ? 0 : at }
// A head drawn as it runs, from a clock that comes in steps: the device's as it plays, the samples come as it records.
// Read at the frame's own time, not when its callback runs, which a busy page makes later by a few ms now and then.
// The steps: Chrome's device clock a fraction of a ms off where the last ran on to, Firefox's and Safari's moved by the
// audio callbacks, the microphone's blocks by theirs, standing between. Drawn toward the clock by a time constant, the
// head took each step for a change of speed, a tenth and more faster, then slower, several times a second. So it runs
// on by the frames' own time at the speed, as a video's frames follow its sound, the speed trimmed by its lead on the
// clock over LOCK, never by more than TRIM: a step's few ms trim it by a hundredth, nothing the eye takes for a change
// of speed, and a lead that stays is caught up in about a second. A clock ahead by more than JUMP (a seek, a loop come
// round) is taken at once, as is one gone back (the caret put back); one standing behind by as much (starved) is waited
// for, never run further past, as one not yet moved (the device starting) is.
// follow(clock, frame time, speed) → where the head is drawn; follow.speed, how fast it goes from there (0 standing)
const LOCK = .5, TRIM = .1, JUMP = .05
function follower() {
  let clock = null, shown = null, then = 0, moved = false
  const follow = (c, now, r) => {
    const heard = c - (performance.now() - now) / 1000 * r
    let t = heard, k = 1
    if (clock != null && c >= clock) {
      const dt = (now - then) / 1000, run = shown + dt * r, lead = heard - run
      k = !moved || lead < -JUMP ? 0 : lead >= JUMP ? 1 : 1 + Math.max(-TRIM, Math.min(TRIM, lead / LOCK))
      t = !moved ? Math.max(shown, heard) : lead >= JUMP ? heard : lead < -JUMP ? shown : run + dt * r * (k - 1)
    }
    moved ||= clock != null && c > clock
    clock = c; shown = t; then = now
    follow.speed = moved ? r * k : 0
    return t
  }
  return follow
}
// Play answers the press, as a transport key does, not the release; a key or a script clicking it (detail 0) still works.
// Held and dragged across, it searches (SHUTTLE): a line over it, the pointer hidden, a tenth of 1× each 4 px from the
// speed it plays at, a step taken only three quarters of the way to the next, so a hand resting between two holds one;
// let go forward, it plays on at that speed, at 0 or back it stops there. Held still for HOLD, the line shows, to be
// seen or dragged. So a press while it plays pauses at its release, unless it was dragged or held, the caret where the
// playhead got to, as a key's pause leaves it.
function playPress(event) {
  if (event.button !== 0 || state.recording) return
  const button = event.currentTarget, x0 = event.clientX, was = pl.playing, step = SHUTTLE.px / 10
  let moved = false, shown = false, at = state.speed * 10, back = null
  if (!was) togglePlay()
  button.setPointerCapture?.(event.pointerId)
  // the line where it starts, the speed there over Play, within the window
  const show = () => {
    if (shown) return
    shown = true
    const r = button.getBoundingClientRect()
    state.speedAxis = { left: Math.max(8, Math.min(innerWidth - SHUTTLE.span - 36, r.left + r.width / 2 - 14 - SHUTTLE.at(state.speed) * SHUTTLE.span)), top: r.top, span: SHUTTLE.span }
    root.classList.add('shuttling')
  }
  const held = setTimeout(show, HOLD)
  // at 0 and back, the deck stops and the scrub voice hears the moments the line passes, the playhead with them, each
  // frame as far as the speed goes in it; forward again, or let go, the deck plays on from there
  const rewind = () => {
    let then = performance.now(), t = v.playhead ?? pl.time
    const frame = now => {
      t = Math.max(0, Math.min(v.duration, t + state.shuttle * (now - then) / 1000))
      then = now
      onscrub(t)
      v.speed = t > 0 && t < v.duration ? state.shuttle : 0
      v.playhead = t; state.time = stamp(t); state.played = t / (v.duration || 1)
      back.id = requestAnimationFrame(frame)
    }
    back = { id: requestAnimationFrame(frame), at: () => t }
  }
  // the search back stopped: the playhead, its line run back, goes, the caret where it stood (forward again, playing
  // brings the playhead back from there)
  const halt = () => {
    cancelAnimationFrame(back.id)
    const t = back.at()
    back = null
    resume = false
    onscrub(null)
    v.playhead = null
    v.setCursor(t)
  }
  const forward = () => { halt(); togglePlay() }
  const move = e => {
    const dx = e.clientX - x0
    if (!moved && !shown && Math.abs(dx) < 4) return
    moved = true
    show()
    const to = Math.max(SHUTTLE.min * 10, Math.min(SHUTTLE.max * 10, state.speed * 10 + dx / step))
    if (Math.abs(to - at) < .75) return
    at = Math.round(to)
    const r = state.shuttle = at / 10
    if (r > 0) { pl.rate = r; if (back) forward() }
    else if (!back) rewind()
  }
  const up = () => {
    for (const [type, f] of on) button.removeEventListener(type, f)
    clearTimeout(held)
    state.speedAxis = null
    root.classList.remove('shuttling')
    if (back) { halt(); state.speed = pl.rate = 1 }
    else if (moved) state.speed = pl.rate
    state.shuttle = null
    if (!shown && was) togglePlay()
  }
  const on = [['pointermove', move], ['pointerup', up], ['pointercancel', up]]
  for (const [type, f] of on) button.addEventListener(type, f)
}
// The speed of this playback, 0.5× to 3×, the pitch kept
function setSpeed(r) { state.speed = pl.rate = SPEEDS.range(r) }
function playClick(event) { if (!event.detail) togglePlay() }
// Playing and recording are one or the other: while it records, Play is off (Space stops the recording)
async function togglePlay() {
  if (!(state.whole || state.arriving) || state.recording) return
  // paused, the caret where the playhead line is, what was last heard: the line becomes it, nothing jumps
  if (pl.playing) {
    const t = v.playhead ?? pl.time
    pl.pause()
    cancelAnimationFrame(ticker)
    state.playing = false
    state.speed = pl.rate = 1
    v.playhead = null
    v.setCursor(t)
    sway()
    return
  }
  state.playing = true
  // The clock follows once the device has started. A band selection plays only its frequencies.
  const p = pl
  await p.play(plays())
  if (p !== pl) return
  if (!pl.playing) { state.playing = false; return }
  sway()
  chase()
}
// The playhead where the speakers are at the frame's own time, drawn as it runs (follow): the shown tab's, till it stops
// or another tab shows
function chase() {
  cancelAnimationFrame(ticker)
  const follow = follower(), p = pl
  const tick = frame => {
    if (!p.playing || p !== pl) return
    const t = follow(p.time, frame ?? performance.now(), p.rate)
    v.speed = follow.speed
    v.playhead = t; state.time = stamp(t); state.played = t / (v.duration || 1); meter(t)
    ticker = requestAnimationFrame(tick)
  }
  tick()
}
// A tab's speaker pressed: its playback muted, or heard again, as it plays on
function toggleTabMute(id) {
  const p = docOf(id)?.player
  if (!p) return
  p.muted = !p.muted
  badges()
}

// Scrubbing: the moment under a held or dragged caret, or an edge, sounds; playback pauses for it and plays on from the
// caret, or the selection, when the pointer lets go.
let resume = false
function onscrub(t, band) {
  if (t != null) {
    if (pl.playing) { resume = true; cancelAnimationFrame(ticker); state.playing = false; v.playhead = null }
    // the mark turns with the caret's travel
    if (scrubbed != null) logoMark?.turn(PACE * (t - scrubbed))
    scrubbed = t
    sway()
    // with tracks, the one edited alone, as its lane shows it
    return pl.scrub(t, band, laneIndex())
  }
  scrubbed = null
  pl.scrub(null)
  if (resume) { resume = false; togglePlay() }
  sway()
}

// Edits made on the picture become calls at the end of the output chain, their times to the view's precision. A band
// selection edits only its frequencies.
function editSelection(type, range = v.selection) {
  if (type === 'undo' || type === 'redo') return ed[type]()
  if (type === 'mark') return addMarker()
  if (type === 'track') return toTrackOf(Array.isArray(range?.[0]) ? range[0] : range)
  if (type === 'voice') return voiceOut()
  if (type === 'stems') return stemsOut()
  // a paste at each caret, from the last back so each time holds for the ones before it
  if (type === 'paste') {
    const at = Array.isArray(range?.[0]) ? range.map(r => r[0]) : v.carets.length ? v.carets : [v.cursor]
    return !!write(at.sort((p, q) => q - p).map(t => `paste(${number(t, v.unit)}${seam()})`).join('.'))
  }
  // a selection through every track: the same edit of each (spread)
  if (v.across && !spreading) return spread(() => editSelection(type, range))
  // an op that learns from the selection takes it whole, every range; declick looks for its clicks in each range or box
  if (ops[type]?.params?.some(s => s.selection)) return addOp(type)
  if (type === 'declick') return !!addOp(type, false)
  if (v.boxes.length > 1) return editBoxes(type, v.boxes)
  const all = Array.isArray(range?.[0]) ? range : !v.band && v.ranges.length > 1 ? v.ranges : null
  if (all?.length > 1) return editRanges(type, all)
  if (all) range = all[0]
  if (!range) return
  if (type === 'quieter' || type === 'louder') return v.band ? bandLevel(type === 'louder' ? 1 : -1, range) : level(type === 'louder' ? 3 : -3, range)
  const [a, b] = range, s = t => number(t, v.unit), span = `{ at: ${s(a)}, d: ${s(b - a)} }`, band = v.band
  const hz = band && `[${band.map(f => Math.round(f)).join(', ')}]`
  const call = band ? { remove: `spectral(${hz}, ${span})`, repair: `repair(${hz}, ${span})` }[type]
    : type === 'remove' || type === 'cut' ? `${type}({ at: ${s(a)}, d: ${s(b - a)}${splice()} })` : `${type}(${span})`
  if (!call || !write(call)) return false
  // a rebuild is a method written here, not by addOp: one of the recent ones as well
  if (type === 'repair') used(type)
  // the selection stays where the audio stays (a copy, as in any editor: the next edit takes it); where the range goes,
  // what the edit leaves is drawn at once from the picture there is, until its output comes, the caret where it was
  if (band || !['remove', 'cut', 'crop'].includes(type)) return true
  v.expect(type, range)
  v.select(0, 0)
  v.setCursor(type === 'crop' ? 0 : a)
  return true
}

// Several ranges at once, each alike, in one step: taken out from the last back, so each time holds for the ones before
// it; each louder or quieter on the one gain curve; each pause shortened to a quarter second (shrink keeps its first)
function editRanges(type, list) {
  const s = t => number(t, v.unit), back = [...list].sort((p, q) => q[0] - p[0])
  if (type === 'quieter' || type === 'louder') return level(type === 'louder' ? 3 : -3, list)
  const calls = type === 'remove' ? back.map(([a, b]) => `remove({ at: ${s(a)}, d: ${s(b - a)}${splice()} })`)
    : type === 'shorten' ? back.map(([a, b]) => `shrink(0.25, { at: ${s(a)}, d: ${s(b - a)} })`) : null
  if (!calls || !write(calls.join('.'))) return false
  if (type === 'remove') v.expect('remove', list)
  v.select(0, 0)
  v.setCursor(list[0][0])
  return true
}

// Several boxes on the spectrogram at once, each alike, in one step: each band over its time taken out, 6 dB quieter or
// louder (spectral), or rebuilt from around it (repair)
function editBoxes(type, list) {
  const s = t => number(t, v.unit), hz = (lo, hi) => `[${Math.round(lo)}, ${Math.round(hi)}]`, span = (a, b) => `{ at: ${s(a)}, d: ${s(b - a)} }`
  const call = { remove: (a, b, lo, hi) => `spectral(${hz(lo, hi)}, ${span(a, b)})`, quieter: (a, b, lo, hi) => `spectral(${hz(lo, hi)}, -6, ${span(a, b)})`,
    louder: (a, b, lo, hi) => `spectral(${hz(lo, hi)}, 6, ${span(a, b)})`, repair: (a, b, lo, hi) => `repair(${hz(lo, hi)}, ${span(a, b)})` }[type]
  if (!call) return false
  // the boxes stay, as a single band's does: the audio keeps its times
  return !!write(list.map(box => call(...box)).join('.'))
}

// The chain's last edit, before a closing save() or play(), when it is `name`: of its own steps, never one of a sound it
// copies, which other tracks share (code.js chain parts)
function lastEdit(code, name) {
  const call = ownCalls(code).filter(k => !methods[k.name]?.sink).at(-1)
  return call?.name === name ? { call, before: call.prev } : null
}
// The steps of the chain's own statement
function ownCalls(code) { const c = chain(code); return c ? c.calls.filter(k => k.part === c.parts.length - 1) : [] }
// The edit to set again in place, when it is `name`: the script's last; while the output shows the chain up to a card
// chosen in the edits, that card's step, an edit of another kind then going in right after it (write())
function amend(name) {
  const at = rk.at()
  if (!at) return lastEdit(ed.code, name)
  const c = chain(ed.code), calls = c?.calls ?? [], i = calls.findIndex(k => k.list && k.list.from === at.call?.list?.from)
  return i >= 0 && calls[i].name === name ? { call: calls[i], before: calls[i].prev } : null
}
const pair = ([s, d]) => `[${number(s)}, ${number(d)}]`
const markersOf = last => Array.isArray(last?.call.args[0]?.value) ? last.call.args[0].value.map(p => [...p]) : []
// Cues: those found in the output, the last warp()'s markers standing in for those they placed, so a cue dragged again
// is the marker it made, not one found near it. A cue at the very start is the start, which warp() holds.
function cuesOf(found, code) {
  const placed = markersOf(lastEdit(code, 'warp')).map(p => p[1])
  return [...found.filter(c => c.t > 0 && !placed.some(d => Math.abs(d - c.t) < .03)), ...placed.map(t => ({ t, rank: Infinity }))].sort((a, b) => a.t - b.t)
}

// A cue dragged from `from` to `to` between its neighbours: one warp() call, updated as cues keep moving. Its markers
// are in the timeline before it; times on the page are after it, so they go back through its map first.
function warp({ from, to, prev, next }) {
  const last = amend('warp'), T = v.duration
  const pairs = markersOf(last)
  const points = [[0, 0], ...pairs, ...(pairs.at(-1)?.[1] === T ? [] : [[T, T]])]
  const back = d => {
    let i = 1
    while (i < points.length - 1 && points[i][1] < d) i++
    const [s0, d0] = points[i - 1], [s1, d1] = points[i]
    return s0 + (d - d0) * (s1 - s0) / (d1 - d0 || 1)
  }
  // a cue on one of its markers is that marker: its source time stays as written
  const placed = t => pairs.find(([, d]) => Math.abs(d - t) < 1e-3)
  const moved = [[placed(from)?.[0] ?? back(from), to], ...[prev, next].filter(t => t > 1e-6 && t < T - 1e-6).map(t => placed(t) ?? [back(t), t])]
  const markers = [...pairs.filter(([s]) => !moved.some(m => Math.abs(m[0] - s) < 1e-3)), ...moved]
    .map(([s, d]) => [+number(s), +number(d)]).sort((a, b) => a[0] - b[0])
  const text = `[${markers.map(pair).join(', ')}]`
  if (last) ed.change({ from: last.call.list.from + 1, to: last.call.list.to - 1, insert: text })
  else write(`warp(${text})`)
}

// A selection's audio dragged elsewhere: moved over what is where it lands, silence where it was, as a graphic
// editor's object or a DAW's clip slides (fn/move.js); with Alt, a copy of it put in where it lands, what was there
// moving on after it, as a text's dragged copy goes in. One step, so one undo.
function carry({ at, duration, to, copy, into }) {
  const s = t => number(t, v.unit)
  if (into != null) return carryInto({ at, duration, to, copy, into })
  return write(copy ? `copy({ at: ${s(at)}, d: ${s(duration)} }).paste(${s(to)}${seam()})` : `move({ at: ${s(at)}, d: ${s(duration)}, to: ${s(to)}${splice()} })`)
}
// ... dragged into another track's lane (`into`, its index): written over what is there in that track where it lands
// (write(), as move() lands it in its own), silence where it was (gain −∞ dB over it, as Move to a new track leaves),
// or with Alt left there too. The piece is this track's sound as it stands, written out (code.js soundOf: its name read
// would take it away as a track), cropped to it. One step, the track it went to the one edited
function carryInto({ at, duration, to, copy, into }) {
  const from = state.track, name = output?.tracks?.[into]?.name, sound = from && soundOf(ed.code, from), s = t => number(t, v.unit)
  if (!sound || !name || name === from || mastering() || masterOf(ed.code)?.name === name) return false
  let code = ed.code
  try {
    focus(name)
    const put = append(code, `write(${sound}.crop({ at: ${s(at)}, d: ${s(duration)} }), { at: ${s(to)} })`)
    if (!put) return false
    code = applied(code, put)
    if (!copy) {
      focus(from)
      const out = append(code, `gain(-Infinity, { at: ${s(at)}, d: ${s(duration)} })`)
      if (!out) return false
      code = applied(code, out)
    }
  } finally { focus(from) }
  ed.change(between(ed.code, code))
  focusOn(name)
  return true
}
// A selection's audio dragged up onto the tabs: a tab of its own, its script this one's cropped to it, so its sound is
// the same (the chain as shown, rolled back or not); moved, it leaves this one, the rest closing up as a cut's, one step
function toTab({ at, duration, copy }) {
  const s = t => number(t, v.unit), cut = rk.ahead(), whole = cut ? applied(ed.code, cut) : ed.code
  // with tracks, the edited one's chain alone
  const c = state.track && chain(whole), code = c ? inline(whole, c) : whole
  const change = append(code, `crop({ at: ${s(at)}, d: ${s(duration)} })`)
  if (!change || !copy && !write(`remove({ at: ${s(at)}, d: ${s(duration)}${splice()} })`)) return false
  newTab(applied(code, change))
  v.expect(null)
  return true
}
// The selection's audio to a track of its own, under this one, where it was in time; silence where it was, so the two
// sound as the one did, each then edited alone (code.js toTrack), the new one the track edited, its piece selected. One
// step. Tracks, a lane each, play together; export mixes them
function toTrackOf(range = v.selection) {
  if (!range || v.band || v.ranges.length > 1) return false
  const s = t => number(t, v.unit), made = toTrack(ed.code, { at: s(range[0]), d: s(range[1] - range[0]) })
  if (!made) return note('This sound is made from another by its name: give it a track of its own in the code.'), false
  if (rk.shown().id != null) rk.choose(null)
  return retrack(made)
}
// The voice to a track of its own under this one, by a separation model, the rest left here, so the two sound as the one
// did (code.js voiceTrack); the new one the track edited, for its own repairs. One step; the model runs once for both
function voiceOut() {
  const made = voiceTrack(ed.code, gpu ? 'mel-roformer' : 'scnet-large')
  if (!made) return note('This sound is made from another by its name: give it a track of its own in the code.'), false
  if (rk.shown().id != null) rk.choose(null)
  return retrack(made)
}
// A song's voice, bass and drums each to a track of its own under this one, the rest left here, so the four sound as the
// one did (code.js stemTracks), by SCNet-large, the voice the track edited. One step; the model runs once for all four
function stemsOut() {
  const made = stemTracks(ed.code)
  if (!made) return note('This sound is made from another by its name: give it a track of its own in the code.'), false
  if (rk.shown().id != null) rk.choose(null)
  return retrack(made)
}
// Whether this browser has a GPU for WebGPU, not a fallback (SwiftShader): the voice split's model is Mel-RoFormer there
// (a 464 MB download once, a few seconds a song's minute), SCNet-large elsewhere (45 MB, on the CPU, as fast as it gets)
let gpu = false
navigator.gpu?.requestAdapter().then(a => { gpu = !!a && !a.info?.isFallbackAdapter && a.info?.architecture !== 'swiftshader' }, () => {})
// The tracks other than the one edited, by name: what it may line up with, match, duck under; none for the master
function others() { return state.track && !mastering() ? tracksOf(ed.code).map(t => t.name).filter(n => n !== state.track) : [] }
// Whether the one edited is the master (code.js master): the tracks' sum through steps of its own
function mastering() { return !!state.track && masterOf(ed.code)?.name === state.track }
// The track edited lined up in time with track `name` (fn/align.js): a part remade elsewhere and opened as a new track,
// put where the original stood. Its reference that track's sound written out (code.js soundOf), not its name: one step
function lineUp(name) {
  const ref = soundOf(ed.code, name)
  return !!ref && !!write(`align(${ref})`)
}
// The track edited matched to track `name`: its tone (match EQ), then its loudness (normalize to it), as a part remade
// takes the place of the one it stands in for. One step
function matchUp(name) {
  const ref = soundOf(ed.code, name)
  return !!ref && !!write(`match(${ref})`, `normalize(${ref})`)
}
// The track edited ducked under track `name` while that one sounds (a sidechain, fn ducker's `key`): a voice over a music
// bed, the bed 15 dB down under it. Its key read by name: that track stays a track, heard (code.js tracks)
function duckUnder(name) { return !!write(`ducker({ key: ${name}, range: -15 })`) }
// A master after the tracks: the longest a copy, each other mixed into it (code.js addMaster), the one edited then, for
// steps over their sum (loudness, a limiter, a bus compressor). One step
function masterOut() {
  const lens = new Map(output?.tracks?.map(t => [t.name, t.length]) ?? []), names = tracksOf(ed.code).map(t => t.name)
  const made = addMaster(ed.code, names.reduce((p, q) => (lens.get(q) ?? 0) > (lens.get(p) ?? 0) ? q : p))
  if (!made) return false
  if (rk.shown().id != null) rk.choose(null)
  return retrack(made)
}
// The script with a track made, `made` ({ code, name }), that track the one edited from now on
function retrack(made) {
  state.track = made.name
  focus(made.name)
  ed.change(between(ed.code, made.code))
  return true
}
// The track edited taken away, its steps with it; the one before it edited then, or with one left, the sound
function untrack() {
  const change = state.track && dropTrack(ed.code, state.track)
  if (!change) return false
  const list = tracksOf(ed.code).map(t => t.name), i = list.indexOf(state.track)
  state.track = list[i - 1] ?? list[i + 1]
  focus(state.track)
  v.select(0, 0)
  ed.change(change)
  return true
}
// A track and a tab are one sound each, the one heard with the others, the other alone: either becomes the other.
// The track edited to a tab of its own, its steps with it (code.js soundOf), gone from here; one made from another
// sound here (a copy of it) stays, as it means nothing alone
function detach() {
  const name = state.track, sound = name && soundOf(ed.code, name)
  if (!sound) return false
  const others = [...ed.code.matchAll(/\blet\s+([\w$]+)/g)].map(m => m[1]).filter(n => n !== name)
  if (others.some(n => new RegExp(`(^|[^\\w$.'"])${n.replace(/\$/g, '\\$')}\\b`).test(sound))) return note(`${name} is made from another sound here: it can't go to a tab alone.`)
  if (!untrack()) return false
  newTab(sound)
  return true
}
// Tab `id`'s sound a track of the one shown, under the one edited, the tab closed (reopened as any is): a script that is
// one sound, its chain; one of statements (tracks of its own, a measure) stays a tab
function attach(id) {
  const d = docs.find(d => d.id === id), code = d?.code ?? '', c = chain(code), sound = c && code.slice(c.expr.from, c.expr.to)
  if (!sound || code.trim() !== sound.trim()) return note('That tab is more than one sound: it stays a tab.')
  const made = chain(ed.code) && addTrack(ed.code, sound, label(source(code)?.strings[0]?.name ?? 'track'))
  if (!made) return note('This sound is made from another by its name: add a track to it in the code.')
  retrack(made)
  closeTab(id)
  return true
}
// Where an edit makes a seam (audio taken out and what is either side meets, audio or silence put in, a range moved
// over): an equal-power crossfade that long across it, so it makes no click (the settings; none, 5, 10 or 20 ms, 10 by
// default), the length as it would be without it (fn/remove.js, fn/insert.js, fn/move.js); in an options object, or
// after a paste's time
const splice = () => state.splice ? `, xfade: ${state.splice / 1000}` : ''
const seam = () => state.splice ? `, ${state.splice / 1000}` : ''
// Silence pulled open at the caret: insert() of its length there
function silence({ at, duration }) { return write(`insert(${number(duration, v.unit)}, { at: ${number(at, v.unit)}${splice()} })`) }
// A selection stretched from its end, pitch kept, or sped up or slowed down, the pitch following (its rate, the length's
// inverse); what follows moves with it
// To the sample it was drawn: the range at the view's precision, its factor (or speed) such that it ends where the drag
// let go, so nothing after it moves when the output comes
function stretch({ at, duration, factor, speed }) {
  const a = number(at, v.unit), d = number(duration, v.unit), n = samplesOf(a, d)
  return write(`${speed ? 'speed' : 'stretch'}(${exact(n, Math.round((at + duration * factor - a) * output.sampleRate), speed)}, { at: ${a}, d: ${d} })`)
}
// The samples a range of the output holds, as the library counts them: from round(at × rate), round(d × rate), or to the end
const samplesOf = (at, d) => Math.min(Math.round(d * output.sampleRate), (lane()?.length ?? Math.round(output.duration * output.sampleRate)) - Math.round(at * output.sampleRate))
// A stretch's factor, or a speed, that makes a range of n samples N long, to the fewest places from 3 that do: the
// library makes it round(n × factor), round(n / speed) samples (fn/stretch.js, fn/speed.js)
function exact(n, N, speed) {
  for (let places = 3; ; places++) {
    const k = +(speed ? n / N : N / n).toFixed(places)
    if (places >= 9 || Math.round(speed ? n / k : n * k) === N) return k
  }
}
// A selection's end moved by the grip, trimming: back, the audio from there to the end goes, the seam crossfaded as a
// delete's; out, silence added there
function trim({ end, to }) {
  const s = t => number(t, v.unit)
  return write(to < end ? `remove({ at: ${s(to)}, d: ${s(end - to)}${splice()} })` : `insert(${s(to - end)}, { at: ${s(end)}${splice()} })`)
}
// The audio a fade's corner is dragged out over goes, what is either side crossfading across it (fn/crossfade.js)
// (one that comes to no length at the view's precision is none)
function crossfade({ at, duration }) { const d = number(duration, v.unit); return +d > 0 && write(`crossfade({ at: ${number(at, v.unit)}, d: ${d} })`) }
// A selection's level moved up or down by the pointer, onto the gain curve as a level change is
const lift = ({ range, db, drawn }) => level(db, range, !drawn)
// A marker at the caret, at each when there are several, or where it plays while it plays; over what is selected, a
// range marked: mark() at the chain's end (M). One made, not playing, its name is asked for over its flag
function addMarker() {
  if (!state.whole) return
  const s = t => number(t, v.unit), playing = pl.playing
  const spans = playing ? [[pl.time, pl.time]] : [...v.ranges, ...v.carets.map(t => [t, t])].sort((p, q) => p[0] - q[0])
  if (!spans.length) return
  const made = write(spans.map(([a, b]) => b > a ? `mark({ at: ${s(a)}, d: ${s(b - a)} })` : `mark(${s(a)})`).join('.')), [[a, b]] = spans
  if (made && !playing && spans.length === 1) v.name({ time: +s(a), ...b > a && { duration: +s(b - a) } })
  return made
}
// The time a mark() call marks: its number, or its range's start
const markedAt = call => call.name === 'mark' ? call.args[0]?.kind === 'object' ? call.args[0].value?.at : call.args[0]?.value : undefined
// The mark() call that set a marker: the one of its kind, a moment or a range, nearest its time and length; of two
// alike, the later. With tracks, in its track's chain
function markCall({ time, duration = 0, track }) {
  focus(track ?? state.track)
  const all = chain(ed.code)?.calls || []
  focus(state.track)
  const calls = all.filter(k => typeof markedAt(k) === 'number' && !duration === (k.args[0].kind === 'number'))
  const far = k => Math.abs(markedAt(k) - time) + Math.abs((k.args[0].value?.duration ?? 0) - duration)
  return calls.reduce((a, k) => !a || far(k) <= far(a) ? k : a, null)
}
const unmarked = () => note('This marker comes from the file; no mark() in the script sets it.')
// A marker taken away (from its flag's menu), or moved (a drag of it): its mark() call gone, or its time moved
// as much, the edits after it being what they were
function unmark(marker) {
  const call = markCall(marker)
  if (!call) return unmarked()
  ed.change({ from: call.dot ?? call.from, to: call.to, insert: '' })
  return true
}
// A marker named, or its name taken away: its mark() call's label
function relabel({ label, ...marker }) {
  const call = markCall(marker)
  if (!call) return unmarked()
  const [at, named] = call.args
  if (label || named) ed.change({ from: at.to, to: named?.to ?? at.to, insert: label ? `, ${quote(label)}` : '' })
  return true
}
function remark({ to, ...marker }) {
  const arg = markCall(marker)?.args[0], at = arg?.kind === 'object' ? arg.props.find(p => p.name === 'at') : arg
  if (typeof at?.value !== 'number') return unmarked()
  ed.change({ from: at.valueFrom ?? at.from, to: at.valueTo ?? at.to, insert: number(Math.max(0, at.value + to - marker.time), v.unit) })
  return true
}
// A fade in or out over [from, to], from a selection's corner: from its edge inward, or centred on its edge; on its
// curve, unless it is the straight one fade() takes by default
function fade({ kind, from, to, curve = 'linear' }) {
  const s = t => number(t, v.unit), d = s(kind === 'in' ? to - from : from - to)
  return +d !== 0 && write(`fade(${d}, { at: ${s(from)}${curve === 'linear' ? '' : `, curve: '${curve}'`} })`)
}
// What the grip does, turned from a click on it: a stretch just made there changes to a speed with it, or back, when it
// is the chain's last step and one the grip makes (a factor and a range)
function setGrip(name) {
  state.gripMode = v.gripMode = name
  store()
  if (name === 'trim') return
  const last = amend(name === 'speed' ? 'stretch' : 'speed')?.call, k = +last?.args[0]?.value, span = last?.args.find(a => a.kind === 'object')
  if (!k || !span) return
  // the length it has kept, to the sample, where its range says how many samples it holds
  const at = span.props?.find(p => p.name === 'at')?.value, d = span.props?.find(p => p.name === 'duration')?.value, n = typeof at === 'number' && typeof d === 'number' && output ? samplesOf(at, d) : 0
  const to = n ? exact(n, Math.round(name === 'speed' ? n * k : n / k), name === 'speed') : number(1 / k, .001)
  ed.change({ from: last.dot + 1, to: last.to, insert: `${name}(${to}, ${ed.code.slice(span.from, span.to)})` })
}
// Pitch edited, or not (View, Pitch curve; a click on the pitch tool). Pitch shows on the spectrogram: editing it, the picture turns to it; done,
// to the waveform again, if it turned for this. A mode, not a setting: never stored, so a page opened later shows no pitch
// line nobody asked for there
let pitchFrom = null
function setPitch(on) {
  state.pitch = v.pitching = on
  if (on && state.display !== 'spec') { pitchFrom = state.display; setDisplay('spec') }
  else if (!on && pitchFrom) { if (state.display === 'spec') setDisplay(pitchFrom); pitchFrom = null }
  store()
  marks()
}
// The curve fades take from the corners, turned from a click on one: the fade just made there takes it too, when it is
// the chain's last step and one a corner makes (its time in an options object)
function setCurve(name) {
  state.fadeCurve = v.fadeCurve = name
  store()
  const last = amend('fade')?.call
  if (last?.args.find(a => a.kind === 'object')?.props.some(p => p.name === 'at')) ed.change(setArg(last, 'curve', name))
}

// A line's points: one curve call, updated in place, the chain's last when it is one; no points removes it. The gain
// line's a gain() in dB; the pitch line's a pitch() in semitones (to the cent), a voice's (`also`: { voice: true }),
// whose curve it edits
function curveEdit(name, step, { t, v }, also = '') {
  const last = amend(name), curve = last && curveOf(last.call)
  const text = `{ t: [${t.map(x => number(x)).join(', ')}], v: [${v.map(x => number(x, step)).join(', ')}] }`
  if (curve && !t.length) return ed.change({ from: last.before, to: last.call.to, insert: '' }), true
  if (curve) return ed.change({ from: last.call.args[0].from, to: last.call.args[0].to, insert: text }), true
  return !!(t.length && write(`${name}(${text}${also})`))
}
const envelope = points => curveEdit('gain', .1, points), pitchline = points => curveEdit('pitch', .01, points, ', { voice: true }')
// hoisted: the page draws the gain line of the script it opens with before this line runs
function curveOf(call) { const o = call?.args[0]; const t = o?.props?.find(p => p.name === 't')?.value, v = o?.props?.find(p => p.name === 'v')?.value; return Array.isArray(t) && Array.isArray(v) && t.length === v.length ? { t, v } : null }
// The curve a line shows: the last gain() curve of the chain's own steps, the gain line's
function envelopeOf(code, name = 'gain') {
  const calls = ownCalls(code)
  for (let i = calls.length - 1; i >= 0; i--) if (calls[i].name === name) { const curve = curveOf(calls[i]); if (curve) return curve }
  return null
}
// The pitch line's: a pitch() curve that is the chain's last edit, the one the line sets again in place; one before
// another edit is the output's as it is, and the line starts anew (hoisted, as envelopeOf)
function shiftOf(code) { return curveOf(lastEdit(code, 'pitch')?.call) }

// A selection's voice, by its tools: its pitch moved some semitones, to the cent, pitch() a voice's over it;
// its intonation, intonation() over it; its formants, formant(). The same again over the same range sets the same
// call: its semitones added to, its factor multiplied. Its edges match to 50 ms (a pitch frame, 46 ms).
function voiced(name, value, { at, duration }, join, step, also = '') {
  const last = amend(name), range = last?.call.args.find(a => a.kind === 'object')?.props
  const [a, d] = ['at', 'duration'].map(n => range?.find(p => p.name === n)?.value)
  const same = Math.abs(a - at) < .05 && Math.abs(a + d - at - duration) < .05
  const first = last?.call.args[0]
  if (same && first?.kind === 'number') return ed.change({ from: first.from, to: first.to, insert: number(join(first.value, value), step) }), true
  return write(`${name}(${number(value, step)}, { at: ${number(at)}, d: ${number(duration)}${also} })`)
}
function shift(o) { return voiced('pitch', o.semitones, o, (p, q) => p + q, .01, ', voice: true') }
function tone(o) { return voiced('intonation', o.factor, o, (p, q) => p * q, .01) }
function formant(o) { return voiced('formant', o.semitones, o, (p, q) => p + q, .01) }
// A range `db` quieter or louder: a trapezoid added to the one gain curve the gain line draws, ramps of 5 ms (at most
// a quarter of the range) at its edges, so the level changes without a click; again adds again. Both are straight
// lines in dB between their points, flat past their ends (plan.js curveFn), so their sum is one too, at the points of
// both. The picture shows the change at once.
function level(db, span, draw = true) {
  const list = Array.isArray(span[0]) ? span : [span], T = v.duration, last = amend('gain'), curve = last && curveOf(last.call)
  if (draw) v.expect('gain', list.length > 1 ? list : list[0], db)
  const e = t => curve ? curveAt(curve, t) : 0
  // each range's trapezoid; a range at either end of the output has no ramp there
  const add = t => list.reduce((sum, [a, b]) => {
    const r = Math.min(.005, (b - a) / 4)
    return sum + (t < a || t > b ? 0 : a > 0 && t < a + r ? db * (t - a) / r : b < T && t > b - r ? db * (b - t) / r : db)
  }, 0)
  const points = list.flatMap(([a, b]) => { const r = Math.min(.005, (b - a) / 4); return [a, ...(a > 0 ? [a + r] : []), ...(b < T ? [b - r] : []), b] })
  const times = [...new Set([...(curve?.t || []), ...points].map(t => +number(t)))].sort((x, y) => x - y)
  const done = envelope({ t: times, v: times.map(t => e(t) + add(t)) })
  if (!done && draw) v.expect(null)
  return done
}
// A gain curve's value at t, as the library reads it (plan.js curveFn): straight between points, flat past the ends
function curveAt({ t: ts, v: vs }, t) {
  const n = ts.length
  if (t <= ts[0]) return vs[0]
  if (t >= ts[n - 1]) return vs[n - 1]
  let i = 1
  while (ts[i] < t) i++
  return vs[i - 1] + (vs[i] - vs[i - 1]) * (t - ts[i - 1]) / (ts[i] - ts[i - 1])
}
// A band 6 dB quieter or louder: spectral() over it; again on the same band and range changes the same call.
function bandLevel(sign, [a, b]) {
  const band = v.band.map(f => Math.round(f)), s = t => number(t, v.unit), last = amend('spectral'), args = last?.call.args
  const same = args && JSON.stringify(args[0]?.value) === JSON.stringify(band) && args[1]?.kind === 'number' && (() => {
    const range = args[2]?.props, at = range?.find(p => p.name === 'at')?.value, d = range?.find(p => p.name === 'duration')?.value
    return Math.abs(at - a) < 1e-3 && Math.abs(at + d - b) < 1e-3
  })()
  if (same) return ed.change({ from: args[1].from, to: args[1].to, insert: number(args[1].value + 6 * sign, .1) })
  write(`spectral([${band.join(', ')}], ${6 * sign}, { at: ${s(a)}, d: ${s(b - a)} })`)
}

// A tool added: its call at the end of the chain, on the selection (each range) if there is one; its card is the one
// chosen among the edits, open, its sliders in hand (the panel turns to them from the palette and the menus, not from
// the context menu, which edits in place), and the code's caret goes into it.
function addOp(name, open = true) {
  // a selection through every track: each track's alike, no card opened (spread)
  if (v.across && !spreading) return spread(() => addOp(name, false))
  const op = ops[name], learn = op?.params?.find(s => s.selection), several = v.boxes.length > 1 ? v.boxes : v.ranges.length > 1 && !v.band ? v.ranges : null
  const span = ([a, b]) => `{ at: ${number(a, v.unit)}, d: ${number(b - a, v.unit)} }`
  const call = args => /^[\w$]+$/.test(name) ? `${name}(${args})` : `['${name}'](${args})`
  const add = text => {
    const change = write(text)
    if (!change) return
    used(name)
    // the last call it wrote, where its "(" is
    const end = change.from + change.insert.length, at = chain(ed.code)?.calls.findLast(k => k.list.from >= change.from && k.list.from < end)?.list.from
    if (at == null) return change
    ed.select(at + 1)
    if (open && state.side !== 'edits') { state.side = 'edits'; store() }
    if (state.side === 'edits') rk.choose(at)
    return change
  }
  // what it learns from is what is selected (denoise: where the noise plays alone), every range of it; it acts on all;
  // a box on the spectrogram, its time where the noise plays alone, its band where it goes (each box its own call)
  if (learn) {
    const boxes = !v.band ? [] : v.boxes.length > 1 ? v.boxes : [[...v.selection, ...v.band]]
    if (boxes.length && name === 'denoise') return add(boxes.map(([a, b, lo, hi]) => call(`{ ${learn.name}: ${span([a, b])}, band: [${Math.round(lo)}, ${Math.round(hi)}] }`)).join('.'))
    const list = v.band ? [] : several ? [...several].sort((p, q) => p[0] - q[0]) : v.selection ? [v.selection] : []
    if (!list.length) return note(`Select ${learn.selection} first.`)
    return add(call(`{ ${learn.name}: ${list.length > 1 ? `[${list.map(span).join(', ')}]` : span(list[0])} }`))
  }
  // several ranges, or boxes (each its time): the method on each, from the last back, in one step
  const needs = (op.params || []).slice(0, (op.params || []).findLastIndex(s => s.required) + 1).map(s => typeof s.default === 'string' ? quote(s.default) : String(s.default))
  if (several) return add([...several].sort((p, q) => q[0] - p[0]).map(r => call([...needs, span(r)].join(', '))).join('.'))
  // a selection of all of it is no range at all; what the library can't do without is written, set to its default
  const sel = v.selection && (v.selection[0] > v.unit / 2 || v.selection[1] < v.duration - v.unit / 2) ? v.selection : null
  return add(call([...needs, sel ? span(sel) : op.range ? `{ at: 0, d: ${number(v.duration)} }` : ''].filter(Boolean).join(', ')))
}
// A call at the end of the chain, as one step. The output showing the chain up to a card chosen in the edits, it goes in
// right after that card, the steps after it kept, as a new layer goes over the one selected, and its own card is chosen
// then: the output shows up to it
function write(...calls) {
  // no call, no change: an empty one would leave a dot
  calls = calls.filter(Boolean)
  if (!calls.length) return null
  const at = rk.at()
  let code = ed.code, change = null, after = at?.after
  for (const call of calls) {
    change = append(code, call, after)
    if (!change) { note('Open or generate a sound first.'); return null }
    code = applied(code, change)
    if (after != null) after = change.from + change.insert.length
  }
  // its card chosen once the edits have it (oncaret)
  if (at) rechoose = chain(code)?.calls.findLast(k => k.dot < after && k.list)?.list.from ?? null
  ed.change(calls.length > 1 ? between(ed.code, code) : change)
  return change
}
const applied = (code, { from, to = from, insert }) => code.slice(0, from) + insert + code.slice(to)
// a change as the editor takes it, one or several over the same text, made to `code`
const changed = (code, c) => (Array.isArray(c) ? c : [c]).filter(Boolean).sort((p, q) => q.from - p.from).reduce(applied, code)
// A selection through every track (view.js across): an edit of it is the same edit of each track, each in turn the one
// edited, what each makes gathered into one change, one step of the history, so a cut keeps them in time; the track
// edited before, edited after. Each edit reads and writes the script as the ones before it left it, `ed` standing in for
// the editor meanwhile, and `rk` for the edits, no card of one track's chosen for another's
let spreading = false
function spread(edit) {
  const names = tracksOf(ed.code).map(t => t.name)
  if (spreading || !v.across || names.length < 2 || mastering()) return edit()
  const real = ed, edits = rk, was = state.track
  let code = real.code, done = false
  ed = Object.create(real, { code: { get: () => code }, change: { value: c => { code = changed(code, c) } }, select: { value: () => {} } })
  rk = Object.create(edits, { at: { value: () => null }, choose: { value: () => {} } })
  spreading = true
  try { for (const name of names) { focus(name); done = !!edit() || done } }
  finally { spreading = false; ed = real; rk = edits; focus(was) }
  if (code !== real.code) real.change(between(real.code, code))
  return done
}
// The chain up to a step made one sound (`to`, where that step ends; all of it with none): rendered as it shows there
// (worker.js bake, from the renders kept), kept in this browser as a recording is, and the script opening it in place
// of the sound and the steps it holds, its markers marked on it again, the steps after it going on from it. One step of
// the history; the sound made stays kept, as a take does
async function flatten(to = null) {
  const code = ed.code, c = chain(code)
  if (!c) return
  // the part of the chain it ends in: its own statement, or a sound it copies, flattened for every track sharing it
  const own = c.parts.at(-1), p = to == null ? own : c.parts.findLast(p => to >= p.expr.from && to <= p.expr.to) ?? own
  const end = to ?? own.calls.filter(k => !methods[k.name]?.sink).at(-1)?.to ?? own.head
  // named for the sound it starts from, flattened before or not: chime-flat.wav, chime-flat-2.wav
  const base = (source(code)?.strings[0]?.name ?? 'audio').replace(/^.*\//, '').replace(/\.\w+$/, '').replace(/-flat(-\d+)?$/, ''), name = unique(`${base}-flat.wav`, taken())
  note('Flattening…')
  // that part's sound alone, with tracks or not
  const r = await eng.bake(prepare(code.slice(0, end) + (p.name ? `\n${p.name}` : '')))
  if (r.error) return note(`Not flattened: ${r.error.message}`, 'error')
  if (ed.code !== code) return note('Not flattened: the script changed meanwhile')
  const data = { channels: r.channels, sampleRate: r.sampleRate }
  await eng.file(name, data)
  saving(keep(name, data).then(file => { if (file) shelf.set(name, file); else note(`${name} could not be kept in this browser: export it to keep it.`, 'error') }))
  // its marks, on lines of their own where the chain's calls are
  const at = p.calls.find(k => /\n[ \t]*$/.test(code.slice(0, k.dot))), sep = at ? `\n${code.slice(0, at.dot).match(/\n([ \t]*)$/)[1]}` : ''
  const said = label => label ? `, ${quote(label)}` : ''
  const marks = [...r.markers.map(m => `.mark(${number(m.time)}${said(m.label)})`), ...r.regions.map(g => `.mark({ at: ${number(g.at)}, d: ${number(g.duration)} }${said(g.label)})`)]
  ed.change({ from: p.expr.from, to: end, insert: `audio(${quote(name)})${marks.map(m => sep + m).join('')}` })
  note(`Flattened into ${name}`)
}
// The palette's keys: the arrows go through what it found, Enter takes it, Escape closes it
function toolKey(event) {
  const items = state.toolGroups.flatMap(g => g.items), k = event.key
  if (k === 'ArrowDown' || k === 'ArrowUp') { event.preventDefault(); state.pick = (state.pick + (k === 'ArrowDown' ? 1 : items.length - 1)) % Math.max(1, items.length) }
  else if (k === 'Enter') { event.preventDefault(); items[Math.min(state.pick, items.length - 1)]?.run() }
  else if (k === 'Escape') { event.preventDefault(); closePalette() }
}
// A word over the picture for a few seconds: a hint, or what went wrong (`error`), longer
function note(text, kind = '') {
  state.notice = text
  state.noticeKind = kind
  clearTimeout(note.timer)
  note.timer = setTimeout(() => state.notice = '', kind === 'error' ? 8000 : 4000)
}

// Sources. A new sound opens in a tab of its own, or in the tab shown if it is empty; several at once, a track each in
// one tab, played together, unless dropped on the tabs: a tab each. A file dropped on the waveform goes in where it is
// dropped; one dropped on the script is written where it lands. A file the script opens that is not here
// (`missing`) takes the one opened for it (Open it…), or one by its name, and the script runs again.
// `track`: those picked open as tracks of their own, under the one edited
let relink = '', asTrack = false
function pickFiles(missing = '', track = false) { closeMenus(); relink = typeof missing === 'string' ? missing : ''; asTrack = track === true; root.querySelector('.file-input').click() }
async function openFiles(list, how = 'new', at = null) {
  root.querySelector('.file-input').value = ''
  if (asTrack) { asTrack = false; how = 'track' }
  const files = list.filter(f => /^(audio|video)\//.test(f.type) || /\.(wav|mp3|flac|ogg|oga|opus|m4a|aac|aiff?|caf|webm|mp4|mov|wma|amr|mka)$/i.test(f.name))
  const into = relink || files.find(f => f.name === state.missing) && state.missing
  relink = ''
  if (!files.length) return note(list.length ? 'Those are not audio files.' : '')
  if (into) { await hold(into, files.find(f => f.name === into) ?? files[0]); state.problem = state.missing = ''; return schedule(0) }
  await restoring
  const names = []
  for (const file of files) {
    const name = unique(file.name, taken())
    await hold(name, file)
    names.push(name)
  }
  place(names, how, at)
}
// A file the scripts open by name, kept for the next visit (keep.js); one the browser can't keep is said to be so, and
// what that means: a file opened, to be opened again; a recording, the only copy there is, to be exported
function hold(name, data, lost = 'open it again on the next visit') {
  saving(keep(name, data).then(file => { if (file) shelf.set(name, file); else note(`${name} could not be kept in this browser: ${lost}.`, 'error'); return file }))
  return eng.file(name, data)
}
function saving(write) { writing.add(write); write.finally(() => writing.delete(write)); return write }
// The files kept (keep.js), name → File: each goes to the engine when a script first opens it (evaluate). None is let
// go but when asked (Kept sounds, in the File menu): a tab closed, a step undone, keeps its files for coming back to.
// the names a new file can't take: a file open, kept, or a sample's
const taken = () => new Set([...eng.names, ...shelf.keys(), ...Object.keys(builtins)])
// The kept files no open tab opens, the newest first, as the File menu lists them
function shelved() {
  const open = new Set(docs.flatMap(d => prepare(d.id === state.tab ? ed.code : d.code).names))
  return [...shelf].filter(([name]) => !open.has(name)).sort(([, a], [, b]) => b.lastModified - a.lastModified)
}
// What an empty tab offers to open again, the newest first: the tabs closed, each with its edits, as it was left; the
// files kept that no tab opens (a tab closed that opens one stands for it)
const RECENT = 8
function restock() {
  if (!ed) return
  const tabs = closed.map((c, i) => {
    const names = prepare(c.code).names, edits = chain(c.code)?.calls.length ?? 0
    return { key: `tab ${i}`, kind: 'tab', names, name: names.length ? names.map(label).join(' + ') : c.code.trim().split('\n')[0].slice(0, 40) || 'untitled', when: c.shut ?? 0,
      meta: [edits ? `${edits} edit${edits > 1 ? 's' : ''}` : '', c.shut ? `closed ${ago(c.shut).replace(/^now$/, 'just now')}` : 'closed'].filter(Boolean).join(', '), run: () => reopenTab(i) }
  })
  const opened = new Set(tabs.flatMap(t => t.names))
  const files = shelved().filter(([name]) => !opened.has(name)).map(([name, f]) => ({ key: `file ${name}`, kind: 'file', name, when: f.lastModified, meta: `${bytes(f.size)}, ${ago(f.lastModified)}`, run: () => place([name], 'new') }))
  state.recents = [...tabs.reverse(), ...files].sort((a, b) => b.when - a.when).slice(0, RECENT)
}
// They go, once the person has said so
async function unshelve() {
  const list = shelved(), them = list.length > 1 ? 'them' : 'it'
  if (!list.length || !confirm(`Delete ${list.length > 1 ? `the ${list.length} sounds` : list[0][0]} kept in this browser (${bytes(list.reduce((n, [, f]) => n + f.size, 0))})? No tab opens ${them} now; deleted, ${them} can't be brought back.`)) return
  for (const [name] of list) { await unkeep(name); shelf.delete(name) }
  restock()
}
const bytes = n => n >= 1e6 ? `${(n / 1e6).toFixed(1)}MB` : `${Math.max(1, Math.round(n / 1e3))}KB`
// Takes the page closed on as they recorded (keep.js tapes), kept as files, each under the name it was to have; one no
// tab opens, in a tab of its own
async function recover() {
  await owning
  await restoring
  let found = 0
  for (const t of await tapes()) {
    const name = t.name && !taken().has(t.name) ? t.name : unique(t.name ?? 'recording.wav', taken())
    const file = await saving(keep(name, t.wav))
    if (!file) { note('A recording the page closed on could not be kept in this browser: it waits there for the next visit.', 'error'); continue }
    shelf.set(name, file)
    t.drop()
    found++
    if (!docs.some(d => prepare(d.id === state.tab ? ed.code : d.code).names.includes(name))) place([name], 'new')
    note(`${name}, recorded as the page closed, is kept.`)
  }
  if (found) schedule(0)
}
function place(names, how, at = null) {
  // what went wrong with the last sound no longer holds
  state.problem = ''
  const code = ed.code, list = names.map(quote)
  const expr = list.length > 1 ? `[${list.join(', ')}]` : list[0]
  if (how === 'at' && at != null) return ed.change({ from: at, insert: `audio(${expr})` })
  // in at a time on the picture, the seams crossfaded as an edit's are
  if (how === 'insert' && at != null && chain(code)) return write(`insert(audio(${expr}), { at: ${number(at, v.unit)}${splice()} })`)
  // each a track of its own, under the one edited, the last of them edited after
  if (how === 'track' && chain(code)) {
    const made = tracked(code, names)
    return made ? retrack(made) : note('This sound is made from another by its name: add a track to it in the code.')
  }
  if (how === 'tabs') { for (const name of names) opening(`audio(${quote(name)})`); return }
  if (names.length < 2) return opening(`audio(${expr})`)
  // a track each, the first edited
  const made = tracked(`audio(${list[0]})`, names.slice(1))
  if (ed.code.trim()) newTab()
  state.track = tracksOf(made.code)[0].name
  ed.change({ from: 0, to: ed.code.length, insert: made.code })
}
// `names` each a track of its own under the one `code` edits, in turn: { code, name } of the last, or null where that
// sound is none of its own
function tracked(code, names) {
  let made = { code }
  for (const name of names) {
    made = addTrack(made.code, `audio(${quote(name)})`, name)
    if (!made) return null
    focus(made.name)
  }
  return made
}
// A new sound, in a tab of its own unless the one shown is empty; `before` on a line above the statement that opens it
function opening(insert, before = '') {
  if (ed.code.trim()) newTab()
  ed.change({ from: 0, to: ed.code.length, insert: (before ? before + '\n' : '') + insert })
}
async function useSample(name) {
  closeMenus()
  if (!eng.has(name)) await eng.file(name, sample(name))
  place([name], 'new')
}
function useCode(code) {
  closeMenus()
  state.problem = ''
  opening(code)
}
// A recipe onto the sound as it is, nothing of it rewritten (its edits, the takes recorded into it). A chain of calls
// goes after the chain's own, one step, under the recipe's name, one card of the edits; each call over the selection
// when there is one (every op takes a trailing range), over each range from the last back when there are several. A
// script of statements (a measure, then a level set from it) takes the script's sound as it stands for its source, all
// of it; one that makes a sound opens a tab of its own. With nothing open, the chime.
function useRecipe(recipe) {
  closeMenus()
  if (!recipe.code.includes('$src')) return opening(recipe.code)
  // a recipe made for a spec checks against it
  if (recipe.spec && recipe.spec !== state.spec) { state.spec = recipe.spec; store() }
  const now = chain(ed.code)
  if (!now) return ed.change({ from: 0, to: ed.code.length, insert: recipe.code.replaceAll('$src', `audio('chime.wav')`) })
  const calls = callsOf(recipe.code)
  if (calls) {
    const sel = v.selection && (v.selection[0] > v.unit / 2 || v.selection[1] < v.duration - v.unit / 2) ? v.selection : null
    const spans = v.ranges.length > 1 ? [...v.ranges].sort((p, q) => q[0] - p[0]) : sel ? [sel] : [null]
    // several calls are one step of the edits, under the recipe's name (code.js groups)
    return write(...spans.flatMap(span => { const list = calls.map(k => span ? over(k, span) : k); return list.length > 1 ? [{ name: recipe.name, calls: list }] : list }))
  }
  // the script's statements before its last stay; its last's sound is the recipe's source, the recipe's names that are
  // taken there given a number (a2, lufs2)
  if (state.track) return note('This recipe takes the sound whole: use it on a track in a tab of its own.')
  const before = ed.code.slice(0, now.statement.from), sound = ed.code.slice(now.expr.from, now.expr.to), taken = declared(before), names = {}
  for (const name of declared(recipe.code)) if (taken.has(name)) { let n = 2; while (taken.has(name + n)) n++; names[name] = name + n }
  ed.change({ from: now.statement.from, to: ed.code.length, insert: rename(recipe.code, names).replaceAll('$src', sound) })
}
// A recipe's calls, each as it is written, when it is one chain on its source; else null
function callsOf(code) {
  const text = code.replace('$src', 'x'), c = chain(text)
  if (!c || c.statement.from !== 0 || text.slice(c.root.from, c.root.to) !== 'x') return null
  return c.calls.map(k => text.slice(k.dot + 1, k.to))
}
// A call over a range: its options' at and d set (setArg)
function over(call, [a, b]) {
  let text = `x.${call}`
  for (const [key, value] of [['at', +number(a, v.unit)], ['duration', +number(b - a, v.unit)]]) text = applied(text, setArg(chain(text).calls[0], key, value))
  return text.slice(2)
}
const closeMenus = () => { for (const menu of root.querySelectorAll('[popover]')) if (menu.matches(':popover-open')) menu.hidePopover() }

// Recording goes into the waveform as it comes, as a dictaphone's. Over the output, from the caret or the selection's
// start, what it covers is replaced, as a tape records on (a punch-in), and extended past the end: one write() step,
// undone as any edit. A selection ends it at its end; with the loop on, each pass starts over there and replaces the
// last, the take the one that was going when it stopped. With nothing open, the take is the sound. Stopped, the caret
// waits where the take ended, as a tape's head does: Record again goes on from there.
let take = null
// The microphone opens as Record is pressed, ahead of its click (the press to the release saves a tenth of a second or
// so); a press no click follows lets it go
let arming = null, unarm = 0
function armRecording(event) {
  if (event.button || recorder || state.recording || arming) return
  arming = microphone({ channels: state.recordIn })
  arming.catch(() => {})
  unarm = setTimeout(() => { arming?.then(mic => mic.cancel(), () => {}); arming = null }, 2000)
}
async function startRecording() {
  closeMenus()
  if (recorder || state.recording) return
  if (pl.playing) togglePlay()
  const into = state.whole, sel = into && !v.band ? v.selection : null
  const t = take = { into, at: into ? (sel ? sel[0] : v.cursor) : 0, until: sel ? sel[1] : null, samples: 0, pass: 0, queue: [], frame: 0, started: false }
  const asked = arming ?? microphone({ channels: state.recordIn })
  clearTimeout(unarm)
  arming = null
  // until the microphone answers, Record blinks, armed, as a deck's does; a click on it then lets go
  state.recording = { pending: true, length: 0 }
  try {
    const mic = await asked
    await restoring
    // stopped before the microphone came (another take may have started since): let go
    if (take !== t) return mic.cancel()
    recorder = mic
    // named as it starts, and written down as it comes (keep.js tape): a page closing on it keeps what it had
    t.name = unique(into ? 'take.wav' : 'recording.wav', taken())
    t.rate = mic.sampleRate
    t.tape = tape({ name: t.name, sampleRate: t.rate, onfail: () => note('This browser can’t store the take as it records: until it stops, closing the page loses it.', 'error') })
    // what it records goes to the tape, and, up to what the page holds, here too: the take whole should the tape fail
    t.held = []
    mic.take(block => {
      t.tape.write(block)
      if (t.held && (t.taken = (t.taken ?? 0) + block[0].length) * block.length <= eng.peaks) t.held.push(block)
      else t.held = null
      t.queue.push(block)
      t.frame ||= requestAnimationFrame(f => flush(t, f))
    })
    state.recording.pending = false
    sway()
  } catch (e) {
    if (take !== t) return
    state.recording = null
    recorder = take = null
    sway()
    note(e?.name === 'NotAllowedError' ? 'Microphone access was denied. Allow it in the browser to record.' : 'The microphone is not available.')
  }
}
// Each frame from the first block on: the blocks come since the last onto the picture, the playhead where the take has
// got to, drawn as it runs (follow). The blocks come in bursts, and late as the page is busy: where it has got to is the
// microphone's clock since the first (t0), never short of what came
function flush(t, frame = performance.now()) {
  t.frame = 0
  const blocks = t.queue.splice(0)
  if (take !== t) return
  const begin = () => v.take({ at: t.at, sampleRate: t.rate, channels: blocks[0].length })
  if (!t.started) { t.started = true; t.follow = follower(); begin(); state.hasOutput = true }
  const room = t.until == null ? Infinity : Math.round((t.until - t.at) * t.rate)
  for (const block of blocks) {
    // past the selection's end: with the loop on, the next pass, over it again; else the take ends
    if (t.samples - t.pass >= room) {
      if (!state.loop) return stopRecording()
      t.pass = t.samples
      begin()
    }
    t.samples += block[0].length
    v.grow(block)
  }
  t.t0 ??= recorder.time - t.samples / t.rate
  const got = Math.max(t.samples, Math.round((recorder.time - t.t0) * t.rate)), at = t.follow(t.at + Math.min(room, got - t.pass) / t.rate, frame, 1)
  v.speed = t.follow.speed
  v.playhead = at
  state.time = stamp(at)
  state.recording.length = (t.samples - t.pass) / t.rate
  meter()
  t.frame = requestAnimationFrame(f => flush(t, f))
}
async function stopRecording() {
  const rec = recorder, t = take
  if (!rec) { state.recording = null; take = null; return }
  recorder = take = null
  cancelAnimationFrame(t.frame)
  rec.stop()
  // the blocks not drawn yet are the take's too
  for (const block of t.queue.splice(0)) t.samples += block[0].length
  state.recording = null
  v.playhead = null
  sway()
  // the last pass, to the selection's end
  const rate = rec.sampleRate, length = Math.min(t.samples - t.pass, t.until == null ? Infinity : Math.round((t.until - t.at) * rate))
  if (!(length > 0)) { t.tape.drop(); if (t.into) v.take(null); return note('Nothing was recorded.') }
  // the take as it was written down as it came (keep.js tape), a file read from disk as the engine decodes it: none of
  // it held here; where the tape failed, what is held here, if that is all of it
  const name = t.name, wav = await t.tape.wav(t.pass, length)
  const data = wav ?? (t.held && { channels: t.held[0].map((_, c) => { const x = new Float32Array(t.samples); let at = 0; for (const b of t.held) { x.set(b[c] ?? b[0], at); at += b[0].length } return x.subarray(t.pass, t.pass + length) }), sampleRate: rate })
  if (!data) { t.tape.drop(); if (t.into) v.take(null); return note(`${name} could not be kept in this browser: it was longer than the page holds.`, 'error') }
  const kept = keep(name, data)
  saving(kept.then(file => {
    if (!file) return note(`${name} could not be kept in this browser: export it to keep it.`, 'error')
    shelf.set(name, file)
    return t.tape.drop()
  }))
  // the engine reads the file kept (the tape's parts go once it is), else what there is
  await eng.file(name, await kept ?? data)
  const end = t.at + length / rate
  note(`Recorded ${clock(end - t.at)}`)
  // the sound itself, the caret at its end once it shows (aim)
  if (!t.into) { place([name], 'new'); docs.find(d => d.id === state.tab).view = { selection: null, band: null, more: [], cursor: end, anchor: end }; return }
  // to the microphone's sample, so a take recorded on from where this one ended meets it, no gap nor overlap between
  if (!write(`write(audio(${quote(name)}), { at: ${number(t.at, 1e-6)} })`)) return v.take(null)
  v.setCursor(end)
}

// Sound search
function openSearch() { closeMenus(); const d = root.querySelector('dialog.search'); d.showModal(); d.querySelector('input[type=search]').focus() }
function closeSearch() { previewAudio?.pause(); state.previewing = -1; root.querySelector('dialog.search').close() }
// Searching as the words are typed, half a second after the last key; Enter searches at once. A newer search
// supersedes an older one still under way.
let searches = 0, searched = '', searchAbort = null
function typeSearch(event) {
  state.query = event.target.value
  clearTimeout(typeSearch.timer)
  typeSearch.timer = setTimeout(runSearch, 500)
}
async function runSearch() {
  clearTimeout(typeSearch.timer)
  const q = state.query.trim()
  if (q === searched) return
  searched = q
  searchAbort?.abort()
  const seq = ++searches
  if (!q) { state.results = []; state.searchState = ''; state.searching = false; return }
  const abort = searchAbort = new AbortController()
  state.searching = true
  state.searchState = 'Searching…'
  try {
    const { results, total } = await search(q, { signal: abort.signal })
    if (seq !== searches) return
    state.results = results
    state.searchState = results.length ? `${total.toLocaleString()} sounds` : 'Nothing found. Try other words.'
  } catch (e) { if (seq === searches && e.name !== 'AbortError') { state.searchState = e.message; searched = '' } }
  finally { if (seq === searches) state.searching = false }
}
function preview(i) {
  previewAudio?.pause()
  if (state.previewing === i) { state.previewing = -1; return }
  previewAudio = new Audio(state.results[i].url)
  previewAudio.onended = () => state.previewing = -1
  previewAudio.play().catch(() => { state.previewing = -1; state.searchState = 'This sound cannot play here.' })
  state.previewing = i
}
// A found sound, its credit on the line above the statement that opens it
function useResult(r) {
  closeSearch()
  state.problem = ''
  opening(`audio(${quote(r.url)})`, credit(r))
}

// Export: each save() the script makes, or the output as one file.
async function exportFiles(parts = false, track = null) {
  if (!state.hasOutput || state.exporting) return
  state.exporting = true
  try {
    const base = state.exportName.trim().replace(/\.\w+$/, '') || state.exportBase, options = encodingOf(state.format)
    // a track alone, by its index among the tracks; every track, a file each (`track` true)
    const names = tracksOf(ed.code).map(t => t.name), each = track === true ? names.map((_, i) => ({ track: i })) : names.includes(track) ? [{ track: names.indexOf(track) }] : [{}]
    for (const one of each) {
      const { files = [], error: failed } = await eng.export({ format: state.format, name: base, parts: parts === true, options, ...one })
      if (failed) throw new Error(failed.message)
      for (const file of files) download(file)
    }
  } catch (e) { note(`Export failed: ${e.message}`) }
  finally { state.exporting = false }
}
// What a format is encoded with: its setting, the markers in the file or none (WAV's cue chunk, MP3's and M4A's chapters)
function encodingOf(format) {
  const e = ENCODING[format], value = e && state.encoding[e[0]]
  return { ...e?.[2].includes(value) && { [e[0]]: value }, ...!state.encoding.markers && { markers: [], regions: [] } }
}

// The cuts as an edit list, a text file, for the video it came from (a cut podcast's picture cut alike)
async function exportCuts() {
  if (!state.hasOutput || state.exporting) return
  state.exporting = true
  store()
  try {
    // the rate chosen, else the video's own; the file the cuts are of named, as it was opened (a file dropped has no path)
    const file = source(ed.code)?.strings[0]?.name
    const { files = [], error: failed } = await eng.export({ format: state.cutFormat, name: state.exportName.trim().replace(/\.\w+$/, '') || state.exportBase, options: { ...state.fps && { fps: state.fps }, ...file && { url: file } } })
    if (failed) throw new Error(failed.message)
    for (const file of files) download(file)
  } catch (e) { note(`Export failed: ${e.message}`) }
  finally { state.exporting = false }
}
function download(file) {
  const url = URL.createObjectURL(new Blob([file.bytes], { type: mime[file.type] || 'application/octet-stream' }))
  Object.assign(document.createElement('a'), { href: url, download: file.name }).click()
  setTimeout(() => URL.revokeObjectURL(url), 10000)
}

// The agent (agent.js): the user's own, through the local bridge, editing the sound open here with the page's tools,
// each named as the bridge's MCP server names it (bin/mcp.js --playground). What an edit does is answered once its run ends.
const page = {
  state: () => ({
    script: ed.code, name: state.name, duration: output?.duration ?? 0, sampleRate: output?.sampleRate ?? null, channels: (output?.channels ?? output?.peaks)?.length ?? null,
    selection: v.selection, band: v.band, cursor: v.cursor, markers: output?.markers ?? [], problem: state.problem || null,
    stats: output?.stats ? { peak: output.stats.peak, loudness: output.stats.loudness } : null,
    steps: stepsOf(ed.code).map(({ text, on }) => ({ call: text.slice(1), on })), shown: shownStep(),
    tracks: output?.tracks?.map(t => ({ name: t.name, duration: t.length / output.sampleRate })) ?? null, track: state.track
  }),
  async script({ code }) {
    if (typeof code !== 'string') throw new Error('script: code is the whole script, a string')
    if (code === ed.code) return { ok: true, duration: output?.duration ?? 0, unchanged: true }
    whole()
    const done = ran()
    ed.change({ from: 0, to: ed.code.length, insert: code })
    return within(done)
  },
  async edit({ call }) {
    if (typeof call !== 'string' || !call.trim()) throw new Error('edit: call is one method call, e.g. "normalize(-16)"')
    const text = call.trim().replace(/^\./, ''), was = output, before = was && pitched(text) ? await eng.contour(was.id) : null
    whole()
    const done = ran()
    if (!write(text)) throw new Error('Open or generate a sound first')
    const r = await within(done)
    if (r.ok) await showEdit(text, was, before)
    return r
  },
  // the caret, a range, or a box of a range and a band (on the spectrogram, which then shows), brought into sight as the
  // user's own would be
  select({ at, d, duration = d, cursor, low, high, track }) {
    if (track != null && !tracksOf(ed.code).some(t => t.name === track)) throw new Error(`No track ${track}: state.tracks has ${output?.tracks?.map(t => t.name).join(', ') || 'none'}`)
    if (track != null) focusOn(track)
    const band = low != null && high != null && +high > +low ? [+low, +high] : null
    if (band && state.display !== 'spec') setDisplay('spec')
    if (cursor != null) { v.select(0, 0); v.setCursor(+cursor); v.reveal(v.cursor) }
    else if (at != null && duration != null) { v.select(+at, +at + +duration, band); v.reveal(...v.selection ?? [v.cursor]) }
    else v.select(0, 0)
    return { selection: v.selection, band: v.band, cursor: v.cursor, track: state.track }
  },
  // the caret moved as a held one is, the moment under it sounding: held still at `at` for d s, or swept to `to` over d s
  // (as long as the sweep, by default: as fast as it plays)
  async scrub({ at, to, d, duration = d }) {
    if (!state.whole) throw new Error('Nothing to scrub: open or generate a sound first')
    // at most 20 s, under the bridge's wait for an answer
    const T = output.duration, a = Math.max(0, Math.min(T, +at || 0)), b = to == null ? a : Math.max(0, Math.min(T, +to)), long = Math.max(.05, Math.min(20, +(duration ?? (Math.abs(b - a) || .5)) || .5))
    v.select(0, 0)
    v.reveal(Math.min(a, b), Math.max(a, b))
    const t0 = performance.now()
    for (let u = 0; u < 1;) {
      u = Math.min(1, (performance.now() - t0) / 1000 / long)
      const t = a + (b - a) * u
      v.setCursor(t)
      onscrub(t)
      await new Promise(resolve => setTimeout(resolve, 16))
    }
    onscrub(null)
    return { cursor: v.cursor }
  },
  // an edit of the chain, as its card's acts are: turned off or on, taken away, or moved to stand at `to` (steps as
  // state lists them); its call written anew; or turned off or on over a range of the output alone, its mix (stepMix)
  async step({ index, on, remove, to, call, at, d, duration = d }) {
    const n = stepsOf(ed.code).length, s = stepsOf(ed.code)[index]
    if (!s) throw new Error(`No edit ${index}: state lists ${n}`)
    if (call != null) {
      if (typeof call !== 'string' || !call.trim()) throw new Error('step: call is one method call, as `edit` takes it')
      if (!s.on) throw new Error(`Edit ${index} is off: turn it on to change it`)
      const text = '.' + call.trim().replace(/^\./, '')
      if (text === s.text) return { ok: true, unchanged: true }
      whole()
      const done = ran()
      ed.change({ from: s.call.from, to: s.call.to, insert: text })
      return within(done)
    }
    if (at != null || duration != null) return stepMix(index, on, +at, +duration)
    if (!remove && to == null && on == null) throw new Error('step: on, remove, to or call')
    if (!remove && to != null && (!(+to >= 0 && +to < n) || !s.on)) throw new Error(s.on ? `No place ${to} to move it to: there are ${n}` : `Edit ${index} is off: turn it on to move it`)
    if (!remove && (to != null ? +to === +index : !!on === s.on)) return { ok: true, unchanged: true }
    const change = remove ? dropStep(ed.code, index) : to != null ? moveStep(ed.code, index, +to) : on ? turnOn(ed.code, s.call) : turnOff(ed.code, s.call)
    if (!change) throw new Error(to != null ? `Edit ${index} stays among the steps it is with: those other tracks share, or this track's own` : `Edit ${index} cannot be commented out: its text holds */`)
    whole()
    const done = ran()
    ed.change(change)
    return within(done)
  },
  // a file on the user's machine, read through the bridge, in a tab of its own (the tab shown, if it is empty)
  async open({ path }) {
    if (typeof path !== 'string' || !path) throw new Error('open: path, a file on this machine')
    const file = await bridge.file(path), done = ran()
    await openFiles([file])
    return { ...await within(done), name: file.name }
  },
  // the output (a track alone), encoded as the path's extension says, or the file as it opened, its bytes as they are,
  // written to a file on the user's machine through the bridge: for the agent's own tools to take it from there
  async save({ path, track, original, force }) {
    if (typeof path !== 'string' || !path) throw new Error('save: path, a file on this machine to write')
    const type = path.match(/\.(\w+)$/)?.[1].toLowerCase()
    if (original) {
      const name = sourceName(), file = name && shelf.get(name), own = name?.match(/\.(\w+)$/)?.[1].toLowerCase()
      if (!file) throw new Error(name ? `${name} is not kept in this page: save the output` : 'A generated sound has no file as it opened')
      if (type !== own) throw new Error(`${name} is .${own}: save it as .${own}, or the output in any format`)
      return bridge.save(path, file, force)
    }
    if (!formats.some(f => f.name === type)) throw new Error(`save: a path ending in ${formats.map(f => '.' + f.name).join(', ')}`)
    const names = tracksOf(ed.code).map(t => t.name)
    if (track != null && !names.includes(track)) throw new Error(`No track ${track}: state.tracks has ${names.join(', ') || 'none'}`)
    await whole(true)
    const { files = [], error } = await eng.export({ format: type, name: 'output', options: encodingOf(type), saves: false, ...track != null && { track: names.indexOf(track) } })
    if (error) throw new Error(error.message)
    return bridge.save(path, files[0].bytes, force)
  },
  // the tabs, a sound each, as the strip shows them; with `to` one shown, the one every tool then acts on; with `close`
  // one closed (⇧⌘T opens it again)
  tabs({ to, close }) {
    if (to != null && close != null) throw new Error('tabs: to or close, not both')
    const id = i => { if (!docs[i]) throw new Error(`No tab ${i}: there are ${docs.length}`); return docs[i].id }
    if (close != null) closeTab(id(close))
    else if (to != null) switchTab(id(to))
    retitle()
    return state.tabs.map((t, index) => ({ index, name: t.name, shown: t.id === state.tab }))
  },
  // the output, or with `original` the file as it opened, level-matched (B); with `step`, the output up to that edit, or
  // what it takes out, as its card chosen in the Edits panel shows it (staying so until the agent's next edit or play)
  async play({ at, d, duration = d, original, step, takes }) {
    await (step != null ? showStep(+step, takes) : whole(true))
    if (original != null && !!original !== !!state.ab) await toggleAB()
    if (at != null) page.select({ at, duration: duration ?? Math.max(0, (output?.duration ?? 0) - at) })
    if (!pl.playing) await togglePlay()
    return { playing: pl.playing, original: !!state.ab }
  },
  // anything the library measures, on the output shown and its source, and the edits (step(i)), changing nothing (worker.js
  // evaluate); what it measured, stat by stat, told the chat besides (`tell`)
  async measure({ code }, tell) {
    if (typeof code !== 'string' || !code.trim()) throw new Error('measure: code is JavaScript, its last expression the answer')
    const r = await eng.evaluate({ ...prepare(code), steps: /\bstep\s*\(/.test(code) ? staging(ed.code) : [], track: laneIndex() })
    if (r.error) throw new Error(r.error.line ? `line ${r.error.line}: ${r.error.message}` : r.error.message)
    tell?.(r.measured)
    return r.value ?? null
  },
  // the picture, the waveform over the spectrogram, of [at, at + d] or of what shows (view.js snapshot); with `step`, of the
  // output up to that edit or what it takes out, the panel then as it was
  async look({ at, d, duration = d, step, takes }) {
    if (step != null) {
      const was = rk.shown()
      await showStep(+step, takes)
      try { return await page.look({ at, duration }) } finally { rk.choose(was.id, was.takes) }
    }
    if (!state.whole) throw new Error('Nothing drawn yet: open or generate a sound first')
    const a = at != null ? Math.max(0, +at) : null, range = a != null ? [a, duration != null ? a + +duration : output.duration] : null
    const [from, to] = range ?? v.range
    const toned = state.show.guides && shown?.code === ed.code && shown.guides.some(g => g.pitch)
    return { image: v.snapshot(range), text: `${stamp(from)} to ${stamp(to)}: the waveform, levels ${state.levels === 'db' ? 'in dB' : 'as sample values'}, over the spectrogram, frequencies in ${scaleNames[state.scale].toLowerCase()}${toned ? '; on it the pitch curve before your last edit, dashed, and after it' : ''}` }
  },
  stop() { if (pl.playing) togglePlay(); return { playing: false } },
  async check({ spec }) { const r = await eng.check(spec); if (r.error) throw new Error(r.error.message); return r.output },
  async undo() { if (!ed.canUndo) return { ok: false, problem: 'Nothing to undo' }; const done = ran(); ed.undo(); return within(done) },
  async redo() { if (!ed.canRedo) return { ok: false, problem: 'Nothing to redo' }; const done = ran(); ed.redo(); return within(done) }
}
// The agent's view of the Edits panel. State's step `index` as its card is known: where its "(" is (null: turned off)
const cardOf = index => { const s = stepsOf(ed.code)[index]; return s?.on ? s.call.list.from : null }
// what the output shows when not the whole chain: up to state's step `step` (-1, the sound alone), or what it takes out
function shownStep() {
  const { id, takes } = rk.shown()
  if (id == null) return null
  return { step: id === 'source' ? -1 : stepsOf(ed.code).findIndex(s => s.on && s.call.list.from === id), takes }
}
// the whole chain shown again, as Esc does: an agent's edit goes at its end, never dropping the steps after a card chosen;
// `wait`ed for, its output rendered
async function whole(wait = false) {
  if (rk.shown().id == null) return
  const done = wait && ran()
  rk.choose(null)
  if (done) await within(done)
}
// state's step `index` shown as its card chosen: the output up to it, or with `takes` what it takes out, once rendered
async function showStep(index, takes) {
  const s = stepsOf(ed.code)[index], id = cardOf(index)
  if (!s) throw new Error(`No edit ${index}: state lists ${stepsOf(ed.code).length}`)
  if (id == null) throw new Error(`Edit ${index} is off: turn it on to hear or see it`)
  if (takes && reshapes(s.name)) throw new Error(`.${s.name}() changes the timing: before and after it don't line up, so there is no difference to take`)
  const was = rk.shown()
  if (was.id === id && was.takes === !!takes) return
  const done = ran()
  rk.choose(id, !!takes)
  await within(done)
}
// The edits as a measure's step(i) reads them (code.js stages): the scripts each one's output enters and leaves it by,
// prepared, and whether it keeps the timing, so before less after is what it takes out
const staging = code => stages(code).map(s => ({ call: s.call, on: s.on, keeps: s.on && !reshapes(s.name), before: prepare(s.before), after: s.after && prepare(s.after) }))
// State's step `index` turned off (`on` false) or on over [at, at + d] of the output alone: the range as it was where the
// sound entered the step (measure's step(i).where), its mix there 0 (or 1), ramps of the splice setting outside it
async function stepMix(index, on, at, d) {
  const s = stepsOf(ed.code)[index]
  if (typeof on !== 'boolean') throw new Error('step: on, true or false, over { at, d }')
  if (!(d > 0) || !(at >= 0)) throw new Error('step: a range of the output, at ≥ 0 and d > 0 seconds')
  if (!s.on) throw new Error(`Edit ${index} is off: turn it on first`)
  // an effect's own mix (a reverb's dry/wet) is its own; one written as an expression, the agent's to rewrite
  const own = s.call.args.find(a => a.kind === 'object')?.props.find(p => p.name === 'mix'), spec = ops[s.name]?.params ?? fromManifest(await eng.describe(s.name))
  if (spec?.some(p => p.name === 'mix') || own && own.value === undefined) throw new Error(`.${s.name}() has a mix of its own: change it with call`)
  await whole(true)
  const r = await eng.evaluate({ ...prepare(`step(${index}).where({ at: ${at}, d: ${d} })`), steps: staging(ed.code), track: laneIndex() })
  if (r.error) throw new Error(r.error.message)
  const place = r.value
  if (!place) throw new Error(`${stamp(at)} to ${stamp(at + d)} is not in the sound as it enters .${s.name}(): an edit before it made it`)
  const mix = mixed(own?.value ?? 1, place.at, place.at + place.d, on ? 1 : 0, state.splice / 1000)
  const text = mix == null ? null : typeof mix === 'number' ? number(mix) : `{ t: [${mix.t.map(t => number(t, 1e-4)).join(', ')}], v: [${mix.v.map(x => number(x)).join(', ')}] }`
  const change = text == null ? unsetArg(s.call, 'mix') : setArg(s.call, 'mix', { raw: text })
  if (!change || applied(ed.code, change) === ed.code) return { ok: true, unchanged: true }
  const done = ran()
  ed.change(change)
  return { ...await within(done), mix: mix ?? 1 }
}

// An edit that moves pitch (Time & pitch: pitch, intonation, formant, tune…), by its call's name
const pitched = text => ops[text.match(/^([\w$]+)\s*\(/)?.[1]]?.group === 'Time & pitch'
// What the agent's edit `text` sets, drawn over the output as its card draws it pointed at, its range brought into view;
// for a pitch edit that keeps the length, the pitch curve over the output before it (`was`, its curve `before`), dashed,
// and after, the spectrogram showing. It stays while the script is as the edit left it, the agent's look seeing it too
async function showEdit(text, was, before) {
  const k = chain(ed.code)?.calls.findLast(k => ed.code.slice(k.dot + 1, k.to) === text), code = ed.code
  if (!k) return
  const list = guidesOf(k, ops[k.name]?.params ?? fromManifest(await eng.describe(k.name)))
  if (before?.f0.length && output && was && Math.abs(output.duration - was.duration) < 1e-3) {
    const after = await eng.contour(output.id)
    if (after.f0.length) list.push({ pitch: { before, after } })
  }
  if (ed.code !== code) return
  if (list.some(g => g.pitch) && state.display !== 'spec') setDisplay('spec')
  shown = { code, guides: list }
  if (!carded) v.guides = list
  const range = list.find(g => g.range)?.range
  if (range) v.reveal(...range)
}
// The page's answers to the agent's last calls, by tool and arguments, and what a tool told the chat besides: what each
// came to, said beside its step (noted, measures)
const answers = []
const answering = (tool, args, at, result, error, told) => { answers.push({ tool, key: JSON.stringify(args ?? {}), at, result, error, told }); answers.splice(0, answers.length - 32) }
const bridge = agent({
  tools: Object.fromEntries(Object.entries(page).map(([tool, f]) => [tool, async args => {
    const at = Date.now()
    let told
    try { const r = await f(args, x => told = x); answering(tool, args, at, r, null, told); return r } catch (e) { answering(tool, args, at, null, e.message); throw e }
  }])),
  // online, the agents the bridge found on its machine, its first one first (none: it found none)
  onstatus(status, hello) { state.agentStatus = status; if (hello) { state.agents = hello.agents ?? (hello.agent ? [hello.agent] : []); askAgent() } },
  onchat: answer
})
function connectAgent() { store(); bridge.connect(state.bridgeUrl.trim(), state.bridgeKey.trim()) }
// The agent the next message goes to, among those the bridge found: the one just picked, else the open conversation's,
// else the one last picked, else the bridge's first; and its model, as it was picked with it, if the agent has it (none:
// the agent's own choice). Another agent than a conversation's own is told what was said
let picked = null, pickedModel = null
function askAgent() {
  const c = conversation(), a = state.agentInfo = [c?.agent, picked].map(id => state.agents.find(a => a.id === id)).find(Boolean) ?? state.agents[0] ?? null
  const model = c && a?.id === c.agent ? c.model : a?.id === picked ? pickedModel : null
  state.agentModel = a?.models?.some(m => m.id === model) ? model : null
}
function pickAgent(id, model = null) { picked = id; pickedModel = model; state.agentInfo = state.agents.find(a => a.id === id) ?? state.agentInfo; state.agentModel = model; root.querySelector('#agents-menu')?.hidePopover() }
if (state.bridgeKey) connectAgent()

// The conversations (`talk`) are the page's, not a tab's: the agent goes on with one whichever tab it or the user shows,
// `open` and `tabs` included. Each { id, at, title, agent, session, messages }, the one open its `chatId` (null: a new
// one, begun by its first message), at most CHATS. A message is the
// user's { role, text }, or the agent's { role, parts, running, doing, since, started, pending, turn, error }: its
// words and its finished calls in the order they came ({ text } | { step, failed }), the calls running, what it does now.
// The agent's session goes on with a conversation where that agent began it; another agent, or one that lost it, is told
// what was said (bin/bridge.js)
const conversation = () => talk.chats.find(c => c.id === talk.chatId) ?? null
// as kept: an answer the page closed on says so
function talks() { return talk.chats.length ? { chats: talk.chats.map(c => ({ ...c, messages: c.messages.map(({ role, text, parts, error, pending }) => ({ role, ...text != null && { text }, ...parts && { parts }, ...(error || pending) && { error: error || 'Cut off: the page closed before the answer ended' } })) })), chat: talk.chatId } : {} }
// an agent's message as it shows, its words and calls in turn; its words alone, as told to an agent that did not hear them
function partsOf(m) { return m.role === 'user' ? [] : m.parts ?? (m.text ? [{ text: m.text }] : []) }
const wordsOf = m => m.role === 'user' ? m.text : partsOf(m).filter(p => p.text).map(p => p.text.trim()).join('\n\n')
// a time as a list of past things says it
const ago = t => { const s = (Date.now() - t) / 1000; return s < 60 ? 'now' : s < 3600 ? `${Math.floor(s / 60)} min ago` : s < 86400 ? `${Math.floor(s / 3600)} h ago` : new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) }
// What shows: the open conversation, whether its agent is answering; the others, newest first
function showMessages(c) { state.chat = c?.messages ?? []; state.chatBusy = !!c?.messages.at(-1)?.pending }
function showChat() {
  const c = conversation()
  showMessages(c)
  askAgent()
  state.chats = talk.chats.toReversed().map(x => ({ id: x.id, title: x.title, when: ago(x.at), open: x === c }))
  following = true
}
function newChat() { talk.chatId = null; showChat(); store(); root.querySelector('.chat-form textarea')?.focus() }
function openChat(id) { talk.chatId = id; showChat(); store(); root.querySelector('#chats-menu')?.hidePopover() }
// A conversation deleted, its answer under way stopped; the open one, a new one in its place
function dropChat(id) {
  const c = talk.chats.find(x => x.id === id), last = c?.messages.at(-1)
  if (!c) return
  if (last?.pending && last.turn) bridge.stop(last.turn)
  talk.chats = talk.chats.filter(x => x !== c)
  if (talk.chatId === id) talk.chatId = null
  showChat()
  store()
  if (!state.chats.length) root.querySelector('#chats-menu')?.hidePopover()
}
// A turn under way → its conversation, wherever it is; a turn's events that come before the page knows it, held
const turns = new Map(), early = new Map()
function told(c, change) {
  c.messages = [...c.messages.slice(0, -1), { ...c.messages.at(-1), ...change(c.messages.at(-1)) }]
  if (c === conversation()) showMessages(c)
}
// The turn as it happens: its words as they come; each call said as the user would say it (doing.js), running, then
// done, or refused, in its place among the words; its session (to go on with); its end. Meanwhile what it does: its
// agent starting, thinking (or composing a call, or reading what a call answered), the call running, its words being
// written, said by themselves
const sayAs = { time: t => stamp(t), spec: k => specs.find(x => x.key === k)?.label ?? k }
function answer(m) {
  const tool = m.tool, c = turns.get(m.turn), call = tool && { ...doing(tool, m.input, sayAs), tool, input: m.input, id: m.id, at: Date.now() }
  if (!c) { if (early.size > 8) early.clear(); return early.set(m.turn, [...early.get(m.turn) ?? [], m]) }
  if (m.session) c.session = m.session
  told(c, last => {
    let parts = partsOf(last), running = last.running ?? []
    if (m.text) parts = parts.at(-1)?.text != null ? [...parts.slice(0, -1), { text: parts.at(-1).text + m.text }] : [...parts, { text: m.text }]
    if (call) running = [...running, call]
    // a call's answer, by its id: parallel calls answer in any order; what it came to, as the page answered the same call
    // begun since the agent said it makes it (a moment before, its events and the call racing to the page)
    const done = m.answered && (running.find(r => r.id === m.answered) ?? running[0])
    if (done) {
      const key = JSON.stringify(done.input ?? {}), a = answers.findLast(x => x.tool === done.tool && x.key === key && x.at > done.at - 250)
      const note = a ? a.error ?? noted(done.tool, done.input, a.result, a.told) : '', rows = a && !a.error && tabled(done.tool, a)
      parts = [...parts, { step: rows && done.tool === 'measure' ? 'Measured' : done.then, ...note && { note }, ...rows && { rows }, ...done.show && { show: done.show }, ...m.failed && { failed: true } }]
      running = running.filter(r => r !== done)
    }
    if (m.done) { parts = [...parts, ...running.map(r => ({ step: r.then, ...m.error && { failed: true } }))]; running = [] }
    return {
      parts, running, started: last.started || !!m.session,
      doing: m.done ? '' : running.length ? running[0].now : m.text ? '' : m.thinking || m.answered || m.session && !last.started ? 'Thinking' : last.doing,
      ...m.done && { pending: false, error: m.error || '' }
    }
  })
  if (m.done) { turns.delete(m.turn); c.at = Date.now(); store() }
}
// What a call came to, as a table under its step: a check's rules, as the Export tab shows them; what a measure measured,
// where it measured more than one thing; none else
function tabled(tool, { result, told }) {
  if (tool === 'check') return result?.rules?.length ? result.rules.map(ruled) : null
  const rows = tool === 'measure' ? measures(told, sayAs) : []
  return rows.length > 1 ? rows : null
}
// A step's place on the sound, gone to: its range (and band) selected, its time the caret, its edit chosen among the edits
function visit(show) {
  if (show.range) page.select({ at: show.range[0], d: show.range[1] - show.range[0], low: show.band?.[0], high: show.band?.[1] })
  else if (show.caret != null) page.select({ cursor: show.caret })
  else if (show.edit) {
    const k = chain(ed.code)?.calls.findLast(k => ed.code.slice(k.dot + 1, k.to) === show.edit)
    if (!k) return note('That edit is no longer in the chain')
    state.side = 'edits'
    rk.choose(k.list.from)
  }
}
// How long a turn has run, kept current while one runs
function elapsed(since, now) { const s = Math.floor((now - since) / 1000); return !since || s < 1 ? '' : s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s` }
setInterval(() => { if (state.chatBusy || turns.size) state.tick = Date.now() }, 1000)
// A message to the agent, or, while it answers, the agent stopped
async function sendChat() {
  const open = conversation(), last = open?.messages.at(-1), id = state.agentInfo?.id, model = state.agentModel, text = state.chatText.trim()
  if (last?.pending) return last.turn && bridge.stop(last.turn)
  if (!text || !id) return
  const c = open ?? { id: Date.now(), title: text.replace(/\s+/g, ' ').slice(0, 120), agent: id, session: null, messages: [] }
  if (!open) { talk.chats.push(c); talk.chats.splice(0, talk.chats.length - CHATS); talk.chatId = c.id }
  const history = c.messages.map(m => ({ role: m.role, text: wordsOf(m) })).filter(m => m.text), session = c.agent === id ? c.session : null
  Object.assign(c, { agent: id, model, at: Date.now(), messages: [...c.messages, { role: 'user', text }, { role: 'agent', parts: [], running: [], doing: `Starting ${state.agentInfo.name}`, since: Date.now(), pending: true, turn: null, error: '' }] })
  state.chatText = ''
  showChat()
  store()
  try {
    const turn = await bridge.chat(text, session, history, id, model)
    turns.set(turn, c)
    told(c, () => ({ turn }))
    for (const m of early.get(turn) ?? []) answer(m)
    early.delete(turn)
  } catch (e) { told(c, () => ({ pending: false, error: e.message })); store() }
}
// Enter sends, Shift and Enter is a new line
function chatKey(event) { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); sendChat() } }
// The conversation keeps its newest words in sight as they come, unless scrolled up to read
const chatLog = root.querySelector('.chat-log')
let following = true
chatLog.addEventListener('scroll', () => { following = chatLog.scrollHeight - chatLog.scrollTop - chatLog.clientHeight < 32 })
new MutationObserver(() => { if (following) chatLog.scrollTop = chatLog.scrollHeight }).observe(chatLog, { childList: true, subtree: true, characterData: true })
showChat()

// Share: the script travels in the link, compressed. Opened files stay on this device; samples and URLs travel.
async function link(script) {
  const bytes = await new Response(new Blob([script]).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer()
  return btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
async function share() {
  const code = await link(ed.code)
  history.replaceState(null, '', '#code=' + code)
  try { await navigator.clipboard.writeText(location.href); state.shared = true; setTimeout(() => state.shared = false, 1800) }
  catch { note('Copy the link from the address bar.') }
  // Samples and web addresses travel in the link; files opened here do not.
  const local = prepare(ed.code).names.filter(name => (eng.has(name) || shelf.has(name)) && !builtins[name])
  if (local.length) note(`Link copied. ${local.join(', ')} ${local.length > 1 ? 'stay' : 'stays'} on this device: whoever opens the link opens ${local.length > 1 ? 'them' : 'it'} too.`)
}
// The documents as the page was left, each a tab, and the one shown; a link's script is shown, in a tab of its own
// unless one holds it already. A first visit opens on an empty tab: the ways in (open, record, find a sound, a sample),
// not a sound nobody chose
async function initialDocs() {
  const list = EMBED ? [] : docsOf(stored.docs).length ? docsOf(stored.docs) : typeof stored.code === 'string' ? [{ code: stored.code }] : []
  let at = Math.max(0, Math.min(stored.doc ?? 0, list.length - 1))
  const hash = location.hash.match(/^#code=([\w-]+)/)?.[1]
  if (hash) try {
    const bytes = Uint8Array.from(atob(hash.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0))
    const code = await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).text()
    at = list.findIndex(d => d.code === code)
    if (at < 0) at = list.push({ code }) - 1
  } catch {}
  if (!list.length) at = list.push({ code: '' }) - 1
  // taken once: the tab it went into is kept, its script changed as it may be, and a reload is no second visit; embedded,
  // the link is all there is, so a reload runs it again
  if (hash && !EMBED) history.replaceState(null, '', location.pathname + location.search)
  docs = list.map(({ code, frame, view, track, muted }) => ({ id: ++docIds, code, frame, view, track: typeof track === 'string' ? track : null, muted: Array.isArray(muted) ? muted.filter(n => typeof n === 'string') : [] }))
  return docs[at]
}

// Tabs over the picture, as an audio editor's open files: a script each, with its own history (the editor keeps it), its
// own steps (remember) and its last output, shown at once when it is (settle). A sound opened goes into a tab of its own,
// unless the tab shown is empty.
// each tab named by the sound its script opens (nameOf), the one shown as its script now reads; the others kept
function retitle() { state.tabs = docs.map(d => ({ id: d.id, name: d.id === state.tab ? nameOf(ed.code) : d.name ??= nameOf(d.code) })) }
function nameOf(code) { const s = tracksOf(code).length ? [...new Set(prepare(code).names)] : source(code)?.strings.map(x => x.name); return s?.length ? s.map(label).join(' + ') : chain(code) ? 'generated' : 'untitled' }
function switchTab(id) {
  if (id === state.tab || !docs.some(d => d.id === id)) return
  const was = docs.find(d => d.id === state.tab), next = docs.find(d => d.id === id)
  if (was) Object.assign(was, { code: ed.code, name: nameOf(ed.code), steps, depthWas, frame: was.frame ?? v.frame, view: was.view ?? v.state, track: state.track, muted: state.muted })
  ;({ steps = [], depthWas = 0 } = next)
  state.tab = eng.tab = id
  // the tab left plays on, if it plays, its player its own; the one shown plays as it was left, its playhead running
  cancelAnimationFrame(ticker)
  v.playhead = null
  pl = playerOf(next)
  state.playing = pl.playing
  state.speed = pl.rate
  // its track edited, as it was left (its script, opened, keeps it valid: focusOn)
  state.track = next.track ?? null
  state.muted = next.muted ?? []
  focus(state.track)
  viewing = { delta: null, back: null }
  v.select(0, 0)
  v.setCursor(0)
  // its sound at once, as it was last shown (none for a new one); while that is what its script makes as it reads now,
  // with what its run said, nothing runs again, else its script runs. One still on its way, as its script reads now,
  // is taken up where it has come to (takeUp)
  incoming = null
  settle(next.output ?? null)
  if (!next.output) standIn(next)
  if (pl.playing) chase()
  ed.open(id, next.code)
  const out = next.output, a = next.coming
  if (a?.said && a.code === a.editor && a.editor === ed.code) { clearTimeout(timer); state.viewing = ''; retell(a.said); takeUp(a) }
  else if (out?.said && out.code === out.editor && out.editor === ed.code) { clearTimeout(timer); state.viewing = ''; retell(out.said) }
  next.ready = false
  status()
  rk?.refresh()
  retitle()
  inSight()
  store()
}
// A tab's run on its way, the tab shown again: the picture it comes into as far as it has come, over the sound shown
// where it is as long as that (alike), else in its place; the file it decodes not drawn from part of the way in, and
// heard from its next piece
function takeUp(a) {
  incoming = a
  a.early = null
  a.preview = false
  a.hearing = null
  if (!a.parts.length || a.lanes) a.on = false
  else if (!a.on && alike(a) && a.parts.every(p => p.channels)) for (const p of a.parts) v.patch(p.at, p.channels)
  else begin(a)
  state.loading = !state.hasOutput
  status()
}
// Each tab's mark, in its close button's place till that is pointed at: its sound on its way, playing (the tab shown),
// or made while the tab was not shown, till it is
// Its speaker, before its name, while it plays or is muted, as a browser's tab's: 'playing' or 'muted' (sounding)
function badges() {
  const marks = {}, sounding = {}
  for (const d of docs) {
    const shown = d.id === state.tab
    const m = (shown ? state.working : asking.get(d.id) || d.coming) ? 'working' : d.ready ? 'ready' : null
    if (m) marks[d.id] = m
    if (d.player?.muted) sounding[d.id] = 'muted'
    else if (shown ? state.playing : d.player?.playing) sounding[d.id] = 'playing'
  }
  if (JSON.stringify(marks) !== JSON.stringify(state.marks)) state.marks = marks
  if (JSON.stringify(sounding) !== JSON.stringify(state.sounding)) state.sounding = sounding
}
// More tabs than fit scroll, as a code editor's: the wheel, up and down as across, moves them along; the tab shown is
// brought into sight
function scrollTabs(event) {
  const strip = event.currentTarget
  if (Math.abs(event.deltaY) <= Math.abs(event.deltaX) || strip.scrollWidth <= strip.clientWidth) return
  event.preventDefault()
  strip.scrollLeft += event.deltaY
}
function inSight() { requestAnimationFrame(() => root.querySelector('.file.current')?.scrollIntoView({ block: 'nearest', inline: 'nearest' })) }
function newTab(code = '') {
  const doc = { id: ++docIds, code }
  docs.push(doc)
  switchTab(doc.id)
  return doc
}
// A tab dragged along the others is held under the pointer, the others stepping aside as it passes their middles, and
// goes where it is let go, as a browser's tabs do; a press that stays put is a click
function dragTab(event, id) {
  if (event.button) return
  const el = event.currentTarget.closest('.file'), tabs = [...el.parentElement.querySelectorAll('.file')], from = tabs.indexOf(el)
  const boxes = tabs.map(t => t.getBoundingClientRect()), step = boxes[from].width + 2, x0 = event.clientX, center = b => b.left + b.width / 2
  let moved = false, to = from
  const plotBox = root.querySelector('.plot').getBoundingClientRect(), y0 = event.clientY
  // down onto the picture, another tab's sound goes in as a track (attach)
  const onto = e => id !== state.tab && state.hasOutput && e.clientX >= plotBox.left && e.clientX <= plotBox.right && e.clientY >= plotBox.top && e.clientY <= plotBox.bottom
  const move = e => {
    const dx = e.clientX - x0, dy = e.clientY - y0
    if (!moved && Math.abs(dx) < 4 && Math.abs(dy) < 4) return
    moved = true
    el.classList.add('dragging')
    state.dropping = onto(e) ? 'track' : false
    if (state.dropping) { el.style.transform = `translate(${dx}px, ${dy}px)`; tabs.forEach(t => { if (t !== el) t.style.transform = '' }); to = from; return }
    el.style.transform = `translateX(${dx}px)`
    // a neighbour gives way once the tab dragged covers half of it: its leading edge past the neighbour's middle
    const left = boxes[from].left + dx, right = boxes[from].right + dx
    to = from
    boxes.forEach((b, i) => { if (i > from && right > center(b)) to = Math.max(to, i); if (i < from && left < center(b)) to = Math.min(to, i) })
    tabs.forEach((t, i) => { if (i !== from) t.style.transform = i >= Math.min(from, to) && i <= Math.max(from, to) ? `translateX(${to > from ? -step : step}px)` : '' })
  }
  const up = e => {
    removeEventListener('pointermove', move); removeEventListener('pointerup', up); removeEventListener('pointercancel', up)
    if (!moved) return
    const track = e.type === 'pointerup' && onto(e)
    state.dropping = false
    // laid out in the new order at once, nothing sliding back to where it was
    for (const t of tabs) { t.style.transition = 'none'; t.style.transform = ''; t.classList.remove('dragging') }
    if (to !== from) { docs.splice(to, 0, docs.splice(from, 1)[0]); retitle(); store() }
    requestAnimationFrame(() => requestAnimationFrame(() => { for (const t of tabs) t.style.transition = '' }))
    if (track) attach(id)
  }
  addEventListener('pointermove', move)
  addEventListener('pointerup', up)
  addEventListener('pointercancel', up)
}
// Closing the last tab leaves an empty one; closing the one shown shows its neighbour. A tab closed with anything in it
// opens again where it was (⇧⌘T, as a browser's), as it was left: in this visit, the tab itself, its history with it;
// after a reload, as it was kept. Its sound is drawn again, not held while it is closed.
function closeTab(id = state.tab) {
  const i = docs.findIndex(d => d.id === id)
  if (i < 0) return
  const doc = docs[i], kept = saved(doc)
  if (docs.length > 1 && id === state.tab) switchTab(docs[i + 1]?.id ?? docs[i - 1].id)
  else if (docs.length === 1) newTab()
  docs.splice(i, 1)
  eng.close(id)
  // what it plays stops with it
  doc.player?.dispose()
  doc.player = null
  doc.coming = null
  doc.ready = false
  if (kept.code.trim()) {
    doc.output = null
    closed.push({ ...kept, at: i, shut: Date.now(), doc })
    for (const c of closed.splice(0, closed.length - CLOSED)) if (c.doc) ed.close(c.doc.id)
  } else ed.close(id)
  retitle()
  store()
  restock()
}
// the last closed, or the one at `i` (the recent ones listed on an empty tab, which it takes the place of)
function reopenTab(i = closed.length - 1) {
  const [c] = closed.splice(i, 1)
  if (!c) return
  const doc = c.doc ?? { id: ++docIds, code: c.code, frame: c.frame, view: c.view, track: c.track ?? null, muted: c.muted ?? [] }
  const blank = !ed.code.trim() ? state.tab : null
  docs.splice(Math.min(c.at ?? docs.length, docs.length), 0, doc)
  switchTab(doc.id)
  if (blank != null) closeTab(blank)
  restock()
}


// Files dropped anywhere. Capturing, so the editor never reads audio as text.
// Held over the picture with a sound in it, a file goes in where the caret it shows is; over the tabs, into a tab of its
// own, each; over the script, where the text caret is; elsewhere, it opens, several a track each. What it would do shows as it is held (`dropping`).
const dropping = event => event.target.closest?.('.files') ? 'tab' : event.target.closest?.('.plot') && state.hasOutput ? 'insert' : 'open'
root.addEventListener('dragover', event => {
  if (!event.dataTransfer?.types.includes('Files')) return
  event.preventDefault()
  event.stopPropagation()
  state.dropping = dropping(event)
  v.dropAt(state.dropping === 'insert' ? event : null)
}, true)
root.addEventListener('dragleave', event => { if (!root.contains(event.relatedTarget)) { state.dropping = false; v.dropAt(null) } })
root.addEventListener('drop', event => {
  if (!event.dataTransfer?.files.length) return
  event.preventDefault()
  event.stopPropagation()
  const how = dropping(event), t = how === 'insert' ? v.dropAt(event) : null
  state.dropping = false
  v.dropAt(null)
  const inEditor = event.target.closest('.script-editor'), at = inEditor ? ed.view?.posAtCoords({ x: event.clientX, y: event.clientY }) ?? null : null
  openFiles([...event.dataTransfer.files], inEditor && at != null ? 'at' : how === 'insert' && t != null ? 'insert' : how === 'tab' ? 'tabs' : 'new', inEditor ? at : t)
}, true)

// Esc closes an open menu and does nothing else: the selection under it stays. A menu that has the keys (the menubar's)
// closes itself
document.addEventListener('keydown', event => {
  const open = event.key === 'Escape' && !event.target.closest?.('[popover], .menubar') && root.querySelector('[popover]:popover-open')
  if (!open) return
  event.preventDefault()
  event.stopPropagation()
  open.hidePopover()
}, true)
document.addEventListener('keydown', event => {
  const mod = event.metaKey || event.ctrlKey, typing = event.target.closest?.('.cm-editor, input, textarea, select, dialog')
  if (!typing && !mod && !event.altKey && event.key.toLowerCase() === 'b' && state.whole) { event.preventDefault(); toggleAB() }
  else if (!typing && !mod && !event.altKey && event.key.toLowerCase() === 'm' && state.whole) { event.preventDefault(); addMarker() }
  else if (!typing && !mod && !event.altKey && event.key.toLowerCase() === 'k' && state.selection && !state.band) { event.preventDefault(); editSelection('crop') }
  else if (!typing && !mod && !event.altKey && event.key.toLowerCase() === 'l' && state.whole) { event.preventDefault(); toggleLoop() }
  else if (!typing && !mod && !event.altKey && event.key.toLowerCase() === 'r' && !state.playing && state.shuttle == null && !state.halting && !event.repeat) { event.preventDefault(); toggleRecording() }
  else if (event.key === ' ' && !typing && !event.target.closest('button, a')) { event.preventDefault(); state.recording ? stopRecording() : togglePlay() }
  else if (mod && event.shiftKey && event.key.toLowerCase() === 't') { event.preventDefault(); reopenTab() }
  else if (mod && event.key.toLowerCase() === 's') { event.preventDefault(); exportFiles() }
  else if (mod && event.key.toLowerCase() === 'o') { event.preventDefault(); pickFiles() }
  else if (mod && !event.shiftKey && (event.key.toLowerCase() === 'k' || event.key.toLowerCase() === 'p')) { event.preventDefault(); openTools() }
  // the edits picked made a group, or the group unmade (stack.js), but in a field being written
  else if (mod && event.key.toLowerCase() === 'g' && !event.target.closest?.('input, textarea, select, dialog')) { event.preventDefault(); event.shiftKey ? rk.ungroup() : rk.group() }
})
// Buttons around the picture act without taking focus: Space stays play, and the picture or the script keeps its keys
root.addEventListener('mousedown', event => { if (event.target.closest('.status button, .tabs button, .history button, .panel-head button, .files button, .add-step, .viewing')) event.preventDefault() })
// The first touch of the page opens the audio device, so the first play starts at once
for (const type of ['pointerdown', 'keydown']) addEventListener(type, () => pl.warm(), { capture: true, once: true })
// Leaving: the tabs stored, a take's last part written as it can be; while a take records, or a file is still being
// written, the browser asks first. Hidden (a phone's app switched away, a laptop's lid), stored too, as it may not come back
addEventListener('pagehide', () => { store(); take?.tape?.flush(); pl.close(); recorder?.cancel() })
addEventListener('beforeunload', event => { if (recorder || writing.size) event.preventDefault() })
document.addEventListener('visibilitychange', () => { if (document.hidden) { store(); take?.tape?.flush() } })

evaluate()
if (EMBED) store()
else recover()
