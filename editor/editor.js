import sprae from '../assets/sprae.js'
import engine from './engine.js'
import codeEditor from './script.js'
import view, { HOLD, NOTES, noteOf } from './view.js'
import player from './player.js'
import stack from './stack.js'
import { mark as drawMark } from '../logo/mark.js'
import recipes from './recipes.js'
import { ops, methods, guides, previews, GROUPS, CURVES, icons as groupIcons } from './ops.js'
import { prepare, error, append, source, chain, number, rollback, residual, setArg, declared, rename, steps as stepsOf, dropStep, moveStep, turnOff, turnOn } from './code.js'
import { builtins, sample, record, search, credit, unique } from './sources.js'
import scales from './scale.js'
import menubar from './menu.js'
import { levels, spectra, cycle, trace } from './meters.js'
import time, { UNITS } from './time.js'
import workshop from './workshop.js'
import opIcons from './icons.js'
import { keep, unkeep, kept } from './keep.js'
import hint from './hint.js'
import { methods as scrubbers } from './scrub-methods.js'
import agent from './agent.js'
import md from './markdown.js'
import doing, { noted } from './doing.js'

// The editor: its output, and at its right a panel that opens and closes, as Luminar's: the tools, every method by kind,
// one click adding it; the edits, the chain that makes the output as a stack of steps; the same chain as code; and the
// export, the output checked against a spec and saved as a file. Every change to the script runs it; the output is drawn,
// measured and played. Selecting, cutting or applying a method on the waveform, or a slider in the stack, writes the
// script.
const root = document.querySelector('#app')
const DEFAULT = `audio('chime.wav')
  .trim()
  .normalize(-1)
  .fade(0.02, 0.1)`
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
  repair: 'm4 14 6 6 10-10-6-6ZM9 11l1 1m2-2 1 1m-2 3 1 1m2-2 1 1'
}
// What the picture shows besides the sound, each a thing to grab where it is, none a mode: the cues (with ⌘ held, a
// drag of one moves it and the audio around it stretches), the pitch curve (dragged, the whole pitch line), the gain
// line (its points drag; a press on the line adds one), the meters at the right
const overlays = [['hits', 'Cues', 'Where sounds start and end, and where they hit: to snap to, select between, and drag with ⌘, each lit where it matters'], ['gain', 'Gain line', 'The gain curve, its points dragged'], ['meters', 'Meters', 'Level and spectrum at the right']]
// The cues (worker.js), both kinds as one: the edges of the pauses, where a voice's words or a solo's phrases start and
// end, and the hits, where the level jumps (a strike, a struck or plucked note, a sudden stop); one of each within 30 ms
// is one place, the edge's, which its attack placed
function cueTimes(edges, hits) {
  const near = t => edges.some(e => Math.abs(e - t) < .03)
  return [...edges, ...hits.filter(t => !near(t))].sort((a, b) => a - b)
}
// How the time row marks time: labels and their ticks, ticks alone, or nothing but the times that matter now (the caret's,
// the pointer's, a selection's)
const rulers = [['labels', 'Labels'], ['ticks', 'Ticks'], ['none', 'None']].map(([name, label]) => ({ name, label }))
// The spectrogram's look: grey from the screen to white, or a colormap (matplotlib's magma, inferno and viridis, 9 of
// their 256 entries, matplotlib/_cm_listed.py), bent by a gamma (a level's share of the range raised to it: under 1 the
// quiet parts show brighter); the dB from the loudest down to the floor; the FFT size, else 40 ms and more on a zoomed
// band (gl-spectrogram)
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
  colour: [['none', 'One colour', 'The screen\'s'], ['temperature', 'Temperature', 'Low warm, high cool: where its spectrum centres, as the colour of light']],
  lanes: [['split', 'A lane each', 'Each channel on its own'], ['one', 'One lane', 'All the channels over each other, each its own hue']],
  fill: [['density', 'Density', 'Brighter where the sound is most often'], ['rms', 'RMS', 'A lighter core as loud as its RMS'], ['flat', 'Flat', 'One shade from peak to peak']]
}
// the look as gl-spectrogram takes it: one colour (grey, even in lightness over the screen) or 17 stops of a colormap
function paint({ map, gamma, depth, size, method }) {
  const n = 17, u = k => (k / (n - 1)) ** gamma
  const at = (hex, t) => { const i = Math.min(hex.length - 2, Math.floor(t * (hex.length - 1))), f = t * (hex.length - 1) - i, rgb = h => [1, 3, 5].map(j => parseInt(h.slice(j, j + 2), 16)); return `rgb(${rgb(hex[i]).map((v, j) => Math.round(v + (rgb(hex[i + 1])[j] - v) * f)).join(' ')})` }
  const color = MAPS[map] ? Array.from({ length: n }, (_, k) => at(MAPS[map], u(k))) : gamma === 1 ? null : Array.from({ length: n }, (_, k) => `oklch(${(21 + 79 * u(k)).toFixed(2)}% 0 0)`)
  return { color, depth, size, method }
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
// The settings' icon to choose between (WORKSHOP), on the 24 grid of the others: three sliders with round thumbs, or
// two, set apart from the spectrogram's lines
const SETTINGS_ICONS = {
  three: 'M4 6h2m4 0h10M4 12h9m4 0h3M4 18h4m4 0h8M10 6a2 2 0 1 1-4 0 2 2 0 0 1 4 0Zm7 6a2 2 0 1 1-4 0 2 2 0 0 1 4 0Zm-5 6a2 2 0 1 1-4 0 2 2 0 0 1 4 0Z',
  two: 'M4 8h3m4 0h9M4 16h9m4 0h3M11 8a2 2 0 1 1-4 0 2 2 0 0 1 4 0Zm6 8a2 2 0 1 1-4 0 2 2 0 0 1 4 0Z'
}
// The recipes' icon and the agent's to choose between (WORKSHOP): a recipe book open, a flask, a wand with its spark;
// a chat with a spark in it, sparks alone, a small robot
const RECIPES_ICONS = {
  book: 'M12 6.5C10 5 7 4.5 4 5v13c3-.5 6 0 8 1.5 2-1.5 5-2 8-1.5V5c-3-.5-6 0-8 1.5Zm0 0v13',
  flask: 'M9 3h6m-5 0v6l-5 9a2 2 0 0 0 1.8 3h10.4a2 2 0 0 0 1.8-3l-5-9V3M7.5 15h9',
  wand: 'M5 19 15 9m2-6 .9 2.1L20 6l-2.1.9L17 9l-.9-2.1L14 6l2.1-.9Z'
}
const AGENT_ICONS = {
  spark: 'M4 5h16v11H9l-5 4ZM12 7.5l.8 1.9 1.9.8-1.9.8-.8 1.9-.8-1.9-1.9-.8 1.9-.8Z',
  sparks: 'M10 4l1.6 4.4L16 10l-4.4 1.6L10 16l-1.6-4.4L4 10l4.4-1.6ZM18 14l.8 2.2L21 17l-2.2.8L18 20l-.8-2.2L15 17l2.2-.8Z',
  bot: 'M5 9h14v10H5zM12 5v4M12 4.5h.01M9 13h.01M15 13h.01M9.5 16.5h5'
}
// What the picture shows, a tab each: the waveform, or the spectrogram, never both (each zooms its own way); the
// spectrogram's again, its frequencies on the next scale
const displays = [['wave', 'Waveform', 'M4 10v4m4-8v12m4-15v18m4-14v10m4-6v2'], ['spec', 'Spectrogram', 'M4 5h16M4 9.5h10M4 14h13M4 18.5h6']].map(([name, label, icon]) => ({ name, label, icon }))
const nextScale = name => { const list = Object.keys(scales); return list[(list.indexOf(name) + 1) % list.length] }
// Speeds: 0.1× to 10×, on a log scale (each doubling as far), 1× in the middle; those a list offers, as players' do; the
// pill's turn, as a messenger's voice notes go: 1×, 1.5×, 2×
const SPEEDS = {
  range: r => Number.isFinite(+r) && +r > 0 ? Math.max(.1, Math.min(10, +r)) : 1,
  at: r => (Math.log10(r) + 1) / 2,
  of: u => 10 ** (2 * Math.max(0, Math.min(1, u)) - 1),
  ticks: [.1, .5, 1, 2, 5, 10], list: [.5, .75, 1, 1.25, 1.5, 2, 3], turn: [1, 1.5, 2]
}
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
const specs = [['', 'Off', ''], ['podcast', 'Apple Podcasts', 'Apple'], ['streaming', 'Spotify', 'Spotify'], ['broadcast', 'EBU R 128', 'R 128'], ['acx', 'ACX audiobook', 'ACX'], ['netflix', 'Netflix', 'Netflix']]
  .map(([key, label, short]) => ({ key, label, short }))

// Stored per browser: the scripts, what each tab showed (its zoom), and how the page was left; under the name the
// editor had before, 'audio-repl', so what a browser kept is found
const stored = (() => { try { return JSON.parse(localStorage.getItem('audio-repl')) || {} } catch { return {} } })()
const store = () => { try { localStorage.setItem('audio-repl', JSON.stringify({ docs: docs.map(d => d.id === state.tab ? { code: ed.code, frame: d.frame ?? v?.frame, ...talks(d) } : { code: d.code, frame: d.frame, ...talks(d) }), doc: docs.findIndex(d => d.id === state.tab), display: state.display, scale: state.scale, format: state.format, encoding: state.encoding, spec: state.spec, cuts: { format: state.cutFormat, fps: state.fps }, side: state.side, show: state.show, units: state.units, snap: state.snapping, curve: state.fadeCurve, levels: state.levels, ruler: state.ruler, step: state.levelStep, look: state.look, wave: state.wave, agent: { url: state.bridgeUrl, key: state.bridgeKey }, splice: state.splice, scrub: state.scrub, grip: state.gripMode, pitch: state.pitch, panel: state.panel, speed: state.speed })) } catch {} }

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
const label = name => /^(https?|blob|data):/.test(name) ? decodeURIComponent(name.split(/[?#]/)[0].split('/').pop() || name) : name
const quote = s => `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`

const eng = engine()
let ed, v, rk
// the caret is where playback ends, as it is where it pauses
const pl = player({ onend: () => { state.playing = false; v.playhead = null; v.setCursor(pl.time); state.time = stamp(v.cursor); sway() } })
// the whole output the page has; the newest run's output as it arrives; the run whose output the view shows
let output = null, incoming = null, showing = 0
// the view holds the tab's sound as it was left (its lanes, its length, where it was looked at) until the sound comes
let holding = false
let timer = 0, ticker = 0, recorder = null, previewAudio = null, waiting = 0, waited = 0, original = null, checks = 0
// the script after each step of its history (remember), and how many steps back it was last
let steps = [], depthWas = 0
// the open documents, a tab each: [{ id, code, steps, depthWas }], the code of the one shown in the editor (switchTab)
let docs = [], docIds = 0
// what the output shows when not the whole chain (the stack): what live step `delta` takes out, or the chain rolled
// back to its first `back` steps
let viewing = { delta: null, back: null }

// The mark in the bar, drawn live (logo/mark.js): at rest it holds the logo's pose. Playing or recording, its wave is
// one cycle of what is heard, running through its window 2.5 times a second, as tall as it is loud; scrubbing, one
// cycle of the moment under the caret, turned by the caret's travel (2.5 turns for a second of it). The tab's icon
// shows the same, in a hidden tab too. Plain: nothing fades or blends, and what it shows next it shows at once.
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
// The caret under a scrub, and the RMS of the output there (the 50 ms around it)
let scrubbed = null
const beneath = () => !output ? 0 : Math.max(0, ...levels(output.channels, Math.round(scrubbed * output.sampleRate) - 1200, Math.round(scrubbed * output.sampleRate) + 1200).map(l => l.rms))
// while the engine works it turns gently, the same whether a file arrives or an output renders, no smaller or paler
let swaying = ''
function sway() {
  const mode = still.matches ? 'rest' : scrubbed != null && output?.duration ? 'scrub' : recorder && !state.recording?.pending ? 'record' : pl.playing ? 'play' : waiting || incoming ? 'work' : 'rest'
  if (mode === swaying) return
  swaying = mode
  heard.hz = 0
  logoMark?.set({
    scrub: { signal: () => (output && cycle(output.channels, scrubbed * output.sampleRate, output.sampleRate, heard, .5), heard.wave), cycles: () => cyclesOf(heard.hz), speed: 0, hold: true, hover: 'none', amplitude: () => swell(beneath()), axis: FAINT, hidden: false },
    record: { signal: () => (recorder?.trace(heard), heard.wave), cycles: () => cyclesOf(heard.hz), speed: PACE, hold: false, hover: 'none', amplitude: () => swell(recorder?.heard ?? 0), axis: FAINT, hidden: true },
    play: { signal: () => (pl.trace(heard), heard.wave), cycles: () => cyclesOf(heard.hz), speed: PACE, hold: false, hover: 'none', amplitude: () => swell(pl.level), axis: FAINT, hidden: true },
    work: { signal: 'sine', cycles: 1, speed: .25, hold: false, hover: 'none', amplitude: 1, axis: 0, hidden: true },
    rest: { signal: 'sine', cycles: 1, speed: 0, hold: false, hover: 'mimic', amplitude: 1, axis: 0, hidden: false },
  }[mode])
}

// the panel's tabs; one stored under a name it no longer has opens on the edits, and a closed panel stays closed
const sides = ['recipes', 'chat', 'edits', 'code', 'export'], sideOf = name => name == null ? null : sides.includes(name) ? name : 'edits'

const state = sprae(root, {
  format: stored.format || 'wav', encoding: { markers: true, ...stored.encoding }, snapping: stored.snap ?? true, fadeCurve: stored.curve || 'linear', gripMode: ['trim', 'speed'].includes(stored.grip) ? stored.grip : 'stretch', pitch: !!stored.pitch, settingsIcon: SETTINGS_ICONS.three, recipesIcon: RECIPES_ICONS.book, agentIcon: AGENT_ICONS.spark,
  overlayList: overlays.map(([name, label, title]) => ({ name, label, title })),
  unitList: UNITS.map(([name, label, example, short]) => ({ name, label, example, short })), levelList, levels: stored.levels === 'db' ? 'db' : 'linear',
  rulers, ruler: stored.ruler || 'labels', splices: [0, 5, 10, 20], splice: stored.splice ?? 10, steps: [.1, 1, 3], levelStep: stored.step || 1, look: { ...LOOK, ...stored.look }, wave: Object.fromEntries(Object.entries(WAVE).map(([k, d]) => [k, waveLooks[k].some(([v]) => v === stored.wave?.[k]) ? stored.wave[k] : d])),
  scrubs, scrub: scrubbers[stored.scrub] ? stored.scrub : 'hybrid',
  // the speed it plays at, the pitch kept; how it shows (WORKSHOP `speed`); the scale a held Play shows while dragged
  dropdown: null, get dropdownTitle() { return { settings: 'Settings', wave: 'Waveform', spec: 'Spectrogram' }[this.dropdown] ?? '' },
  get dropdownGroups() { return this.dropdown ? optionGroups(this.dropdown) : [] },
  speed: SPEEDS.range(stored.speed), speedLook: 'readout', speedAxis: null, speedTicks: SPEEDS.ticks.map(t => ({ t, label: `${t}×`, at: SPEEDS.at(t) })),
  get speedText() { return `${+this.speed.toFixed(this.speed < 1 ? 2 : 1)}×` },
  get speedAt() { return SPEEDS.at(this.speed) },
  display: stored.display === 'spec' ? 'spec' : 'wave', scale: scales[stored.scale] ? stored.scale : 'log', displays, rates, layouts, sound: null, viewing: '',
  show: { hits: true, gain: true, meters: true, ...stored.show }, units: stored.units || 'clock',
  side: sideOf(stored.side), panel: stored.panel ?? null, pick: 0, keys,
  tabs: [], tab: 0, name: 'untitled', length: '', hasOutput: false, whole: false, ran: false, problem: '', missing: '', notice: '', noticeKind: '', dropping: false,
  progress: '', loading: false, slow: false, lines: [], saves: [], exporting: false, shared: false, canUndo: false, canRedo: false,
  time: '0:00.000', span: 0, readout: '', heard: null, selection: null, band: null, ranges: 0, boxes: 0, carets: 1, pauses: false, canPaste: false, playing: false, loop: false, recording: null,
  specs, spec: stored.spec || '', report: null, checking: false, ab: false, abGain: 0, canCompare: false,
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
        .map(op => ({ label: op.name[0].toUpperCase() + op.name.slice(1), text: op.text, icon: opIcons[op.name] ?? groupIcons[name], title: `.${op.name}(): ${op.text}`, run: run(() => addOp(op.name)) })) }))
    ].filter(g => g.items.length)
    let i = 0
    for (const g of groups) for (const item of g.items) item.index = i++
    return groups
  },
  // what a tool acts on: the selection, each range, or all of it
  get toolTarget() { return this.band ? 'For the band selected; a method, for its time range' : this.ranges > 1 ? `For each of the ${this.ranges} ranges selected` : this.selection ? `For the selection, ${stamp(this.selection[0])}–${stamp(this.selection[1])}` : 'For all of it; select a range for that alone' },
  // The check, rule by rule, in the panel's Export tab: each rule, the output's value and mark, its limit
  get checkRows() {
    return (this.report?.rules || []).map(r => ({ name: r.name, unit: r.unit, limit: limit(r), note: r.note || '', after: value(r.value), afterMark: mark(r.pass), afterClass: verdict(r.pass) }))
  },
  setSpec(key) { state.spec = key; store(); scheduleCheck(0) },
  toggleAB,
  // The clock, in the units the settings choose: the playhead, or the caret, one time always, the ranges being on the
  // time row; after it how long all that is selected is, between bars as a length is marked. What is selected, in full, when
  // pointed at
  get timeText() { return this.time },
  get lengthText() { return this.span && !this.playing && !this.recording ? clock(this.span) : '' },
  get timeTitle() {
    const sel = this.selection, units = UNITS.find(u => u[0] === this.units)[1].toLowerCase()
    if (this.playing || this.recording || !this.span) return `${this.playing ? 'Playhead' : 'Caret'}, in ${units} (the settings)`
    const length = this.span, rate = output?.sampleRate || 44100, what = this.ranges > 1 || !sel ? `${this.ranges} ranges` : `${stamp(sel[0])}–${stamp(sel[1])}`
    return `Selected ${what}: ${clock(length)}, ${Math.round(length * rate)} samples`
  },
  get plotHelp() {
    return `${this.display === 'spec' ? 'Spectrogram' : 'Waveform'}. Click to put the caret and hear the moment there; drag to select a time range, a dragged edge or caret going onto the cues and markers near it; double-click selects the fragment between its cues, triple-click the sound between its pauses. Shift sums: a press or a drag extends the selection to it. Alt adds: another caret, range or fragment; dragged inside the selection, a copy of its audio, put in where it lands; held, how far the pointer is from the selection. ⌘ empowers: dragged inside the selection, its audio moves over what is there; a range's end sets its length; the cue under the pointer lights and drags; on the spectrogram, a box of time and frequency; a drag aims finely. A caret's line, the time row or a range's edge drags, the others staying. A range's top corners fade it, outward crossfading; its pill sets its level, the tools at its foot a voice's pitch, intonation and formants; the square past its end trims, stretches or speeds it, a click on each turning it to the next; with none, the square past the caret opens silence. Right-click for the edits there; ⌘P finds any. The wheel scrolls; a pinch, or Ctrl and the wheel, zooms the frequencies or the levels over them and time elsewhere.`
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
  // The agent: the bridge it is reached through and its key (kept in this browser), whether it is there, the agent it
  // runs ({ id, name }, chosen as the bridge started); the open tab's conversation, whether the agent is answering, the
  // tab's conversations, the message being written. Its words are Markdown (markdown.js)
  bridgeUrl: stored.agent?.url || 'http://127.0.0.1:7777', bridgeKey: stored.agent?.key || '', agentStatus: 'off', agentInfo: null,
  chat: [], chatBusy: false, chats: [], chatText: '',
  get agentNote() { return { off: 'Put the key in, then connect', connecting: 'Connecting…', offline: 'Not running: npx audio --bridge', replaced: 'Taken by another page', online: 'No agent on that machine: install Claude Code or Codex, then start the bridge again' }[this.agentStatus] },
  get chatTitle() { return this.chats.find(c => c.open)?.title ?? 'New conversation' },
  connectAgent, sendChat, chatKey, newChat, openChat, dropChat, showChat, md, partsOf, visit, tick: Date.now(), elapsed,
  undo: () => ed.undo(), resizePanel,
  // a display's tab says what it shows; the spectrogram's, shown, what a click on it again does: the next scale
  displayTitle(d) {
    const as = name => scaleNames[name].toLowerCase()
    const again = this.display === d.name && d.name === 'spec' ? `. Again: in ${as(nextScale(this.scale))}` : ''
    return (d.name === 'wave' ? 'The waveform: levels over time' : `The spectrogram: frequencies over time, in ${as(this.scale)}`) + again + '. Right-click: how it draws'
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
  cutFormats, frameRates, cutFormat: stored.cuts?.format ?? 'edl', fps: stored.cuts?.fps ?? null, exportName: '',
  // the file's name as it would be, and what the format does with the markers
  get exportBase() { return `${this.name === 'untitled' || this.name === 'generated' ? 'audio' : this.name.replace(/\.\w+$/, '').replace(/ \+ .*/, '')}-edited` },
  get markerNote() { return KEEPS[this.format] ?? `${this.format.toUpperCase()} keeps none` },
  get keepsMarkers() { return !!KEEPS[this.format] },
  // how large the file will be, where that is known before it is made: uncompressed samples, or a constant bitrate
  get fileSize() {
    const s = this.sound, sec = s && output?.duration, e = this.encoding
    if (!sec) return ''
    const bytes = this.format === 'wav' || this.format === 'aiff' ? sec * s.hz * s.count * (e.bitDepth ?? (output.bitDepth > 16 ? 24 : 16)) / 8 : this.format === 'mp3' && e.bitrate ? sec * e.bitrate * 125 : 0
    return !bytes ? '' : bytes >= 1e6 ? `${(bytes / 1e6).toFixed(1)}MB` : `${Math.max(1, Math.round(bytes / 1e3))}KB`
  },
  exportCuts,
  setScale,
  toggleSnap() { state.snapping = v.snapping = !state.snapping; store() },
  toggleShow, setUnits, setLevels, setRuler, setStep, setLook, setSplice, setScrub,
  setDisplay, looksAt, settingsMenu, dropToggle, toggleLoop, undoList, goTo, toggleRecording, resampleTo, remixTo,
  togglePlay, playPress, playClick, setSpeed, speedMenu, turnSpeed, SPEEDS, stop: () => eng.stop(), redo: () => ed.redo(), mac, share, exportFiles,
  switchTab, newTab, closeTab, dragTab, pickFiles, openFiles, startRecording, stopRecording, useSample, useCode, useRecipe, addOp, editSelection, toolKey, openTools,
  openSearch, closeSearch, runSearch, typeSearch, preview, useResult
})

// The page's hints (hint.js): what a number in the code sets, what a drag on the picture does, what a click just did
const hints = hint(document.body)
// The script editor, on the document shown, the files its tabs open kept from before
const first = await initialDocs()
// the kept files go to the engine as the page comes up, not before it: the first run waits for them (evaluate)
const restoring = restore()
ed = codeEditor(root.querySelector('.script-editor'), {
  hint: hints,
  doc: first.code,
  onchange(code, update) {
    const slider = !!update?.transactions.some(tr => tr.isUserEvent('input.slider'))
    state.canUndo = ed.canUndo
    state.canRedo = ed.canRedo
    remember(code, slider)
    retitle()
    v.envelope = envelopeOf(code)
    v.shift = shiftOf(code)
    schedule(slider ? 0 : 250)
    clearTimeout(store.timer)
    store.timer = setTimeout(store, 500)
  },
  oncaret: update => rk?.refresh(update),
  files: () => [...new Set([...eng.names, ...Object.keys(builtins)])],
  describe: name => eng.describe(name),
  keys: { 'Mod-Enter': togglePlay, 'Mod-s': () => exportFiles() }
})
ed.open(first.id)
state.tab = first.id
retitle()
store()

// The output view
v = view(root.querySelector('.plot'), {
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
  },
  // the caret put elsewhere while it plays: playback goes there, over what is selected now (all of it, if nothing)
  oncursor(t) { if (pl.playing) pl.play(plays(t)); else { state.time = stamp(t); meter(); pl.seek(t); listen() } },
  // an edit made on the picture: true once it is written in the script
  onedit(type, detail) { const act = { warp, envelope, pitch: shift, intonation: tone, formant, carry, tab: toTab, stretch, trim, lift, fade, crossfade, unmark, remark, relabel, pitchline, insert: silence }[type]; return !!(act ? act(detail, type) : editSelection(type, detail)) },
  // a handle clicked: its next way, in turn, as a tool's options cycle, no menu (a fade corner's curve, the grip's trim,
  // stretch or speed)
  onmode(kind) {
    const next = (list, now) => list[(list.findIndex(m => m.name === now) + 1) % list.length].name
    ;({ curve: () => setCurve(next(curves, state.fadeCurve)), grip: () => setGrip(next(gripModes, state.gripMode)) })[kind]()
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
    pl.audition(at, at + Math.min(o.duration, 2), a => o.curve ? a.pitch({ t: o.curve.t.map(t => t - at), v: o.curve.v }, voice)
      : o.pitch ? a.pitch(o.pitch, voice) : o.intonation != null && o.intonation !== 1 ? a.intonation(o.intonation) : o.formant ? a.formant(o.formant) : a)
  },
  hint: hints
})
v.display = state.display
v.scale = state.scale
v.units = state.units
v.levels = state.levels
v.ruler = state.ruler
v.levelStep = state.levelStep
v.spectrogram = paint(state.look)
v.waveform = state.wave
pl.scrubMode = state.scrub
// the speed kept from before
pl.rate = state.speed
// WORKSHOP: the settings' icon, the panel's edge, the switches' look
workshop(root.querySelector('.workshop'), o => { state.settingsIcon = SETTINGS_ICONS[o.settings]; root.dataset.resizer = o.resizer; state.recipesIcon = RECIPES_ICONS[o.recipes]; state.agentIcon = AGENT_ICONS[o.agent]; v.endMark = o.end; state.speedLook = o.speed })
// the panel as wide as it was left
if (state.panel) root.querySelector('.panes').style.setProperty('--panel', `${state.panel}px`)
v.show = state.show
v.snapping = state.snapping
v.fadeCurve = state.fadeCurve
v.gripMode = state.gripMode
v.pitching = state.pitch
v.envelope = envelopeOf(ed.code)
v.shift = shiftOf(ed.code)
// The sound shown as it was left, at once, before the engine is up: its lanes, its length, where it was looked at, dim
// and empty; the file comes into it as it arrives
if (first.frame?.duration > 0 && first.frame.rate > 0 && Number.isInteger(first.frame.channels) && first.frame.channels > 0 && first.frame.channels <= 32) {
  v.stream({ sampleRate: first.frame.rate, channels: first.frame.channels, total: Math.round(first.frame.duration * first.frame.rate), dim: true })
  holding = true
  aim()
}

// The edits, the stack of the chain's steps; the card under the pointer draws what it sets over the output (ops.js
// guides). What the output shows when it is not the whole chain (the chain up to the step chosen, what a step takes out)
// runs in place of the script.
rk = stack(root.querySelector('.steps'), {
  ed,
  describe: name => eng.describe(name),
  duration: () => v.duration,
  source: () => { const s = source(ed.code); return s?.strings.length ? s.strings.map(x => label(x.name)).join(' + ') : null },
  oncall(call, spec, values) {
    if (!call || !spec) { v.guides = []; return }
    const named = Object.fromEntries(spec.map((s, i) => [s.name, values[i]]))
    for (const arg of call.args) if (arg.kind === 'object') for (const p of arg.props) named[p.name] ??= p.value
    v.guides = guides(call.name, named, v.duration)
  },
  onview(next) { viewing = next; schedule(0) },
  // a slider's move shows on the picture at once, where a level says it (ops.js previews), until its output comes
  onpreview(name, was, is) { v.preview(previews[name]?.(was, is, v.duration) ?? null) }
})
rk.refresh()
remember(ed.code)

// The app menu: everything the page does, each where apps put it, with its keys (menu.js). Items that can't act now
// show, dimmed, so the menu also says what there is.
function menus() {
  const sel = v.selection, band = v.band, whole = state.whole, none = !whole
  const check = (label, checked, run, extra) => ({ label, checked, run, ...extra })
  const recipesMenu = [...new Set(recipes.map(r => r.group))].flatMap(group => [{ group }, ...recipes.filter(r => r.group === group).map(r => ({ label: r.name, hint: r.text, run: () => useRecipe(r) }))])
  return [
    { name: 'File', title: 'A new tab; open, record or find a sound; samples, generators, recipes; export', items: [
      { label: 'New tab', hint: 'An empty script', run: () => newTab() },
      { label: 'Open file…', keys: keys('⌘O'), run: pickFiles },
      { label: state.whole ? 'Record at the caret' : 'Record', hint: state.whole ? 'Over what is there, as a tape' : '', run: startRecording, disabled: !!state.recording },
      { label: 'Find a sound…', run: openSearch },
      { label: 'Samples', items: Object.entries(builtins).map(([name, text]) => ({ label: name, hint: text, run: () => useSample(name) })) },
      { label: 'Generate', items: generators.map(g => ({ label: g.name, hint: g.text, run: () => useCode(g.code) })) },
      { label: 'Recipes', items: recipesMenu },
      '-',
      { label: state.saves.length > 1 ? `Export ${state.saves.length} files` : 'Export', keys: keys('⌘S'), run: exportFiles, disabled: none || state.exporting },
      { label: 'Export as', items: formats.map(f => check(f.name.toUpperCase(), state.format === f.name, () => state.setFormat(f.name), { hint: f.text })), disabled: state.saves.length > 0 },
      { label: 'Export the parts between markers', run: () => exportFiles(true), disabled: none || !output?.markers?.length },
      { label: 'Copy a link to this script', run: share },
      '-',
      { label: 'Close tab', hint: 'Its script and its edits go', run: () => closeTab() }
    ] },
    { name: 'Edit', title: 'Undo and history; cut, copy, paste, delete; levels; methods', items: [
      { label: 'Undo', keys: keys('⌘Z'), run: () => ed.undo(), disabled: !state.canUndo },
      { label: 'Redo', keys: keys('⇧⌘Z'), run: () => ed.redo(), disabled: !state.canRedo },
      { label: 'History', items: undoList().map(step => check(step.label, step.current, () => goTo(step.index), { hint: step.ahead ? 'undone' : '' })), disabled: steps.length < 2 },
      '-',
      edit('Cut', 'cut', '⌘X', sel && !band),
      edit('Copy', 'copy', '⌘C', sel && !band),
      edit('Paste', 'paste', '⌘V', state.canPaste),
      edit('Delete', 'remove', '⌫', sel),
      edit('Keep only the selection', 'crop', 'K', sel && !band),
      '-',
      edit(band ? '6 dB quieter' : '3 dB quieter', 'quieter', '', sel),
      edit(band ? '6 dB louder' : '3 dB louder', 'louder', '', sel),
      edit('Rebuild the band from around it', 'repair', '', band),
      edit('Take this noise out everywhere', 'denoise', '', sel),
      { label: sel ? 'Find an edit for the selection…' : 'Find an edit…', keys: keys('⌘P'), run: () => openTools(), disabled: none },
      '-',
      { label: 'Add a marker', keys: 'M', run: addMarker, disabled: none },
      { label: 'A double-click on a marker\'s flag names it', disabled: true }
    ] },
    { name: 'Select', title: 'All, none, a fragment or a sound; the caret by cues and sounds', items: [
      { label: 'All', keys: keys('⌘A'), run: () => v.select(0, v.duration), disabled: none },
      { label: 'None', keys: 'Esc', run: () => v.select(0, 0), disabled: !sel },
      '-',
      { label: 'The fragment at the caret', hint: 'between its cues', keys: 'double-click', run: () => v.around('fragment'), disabled: none },
      { label: 'The sound at the caret', hint: 'between its pauses', keys: 'triple-click', run: () => v.around('sound'), disabled: none },
      { label: 'The next one like it, too', keys: keys('⌘D'), run: () => v.addNext(), disabled: !sel || !!band },
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
    { name: 'View', title: 'Waveform and spectrogram, what shows on them; zoom; panels; units', items: [
      ...displays.map(d => check(d.label, state.display === d.name, () => setDisplay(d.name))),
      lookMenu('wave'), lookMenu('spec'),
      '-',
      ...overlays.map(([name, label]) => check(label, state.show[name], () => toggleShow(name))),
      check('Edit pitch', state.pitch, () => setPitch(!state.pitch), { hint: 'The pitch curve on the spectrogram, dragged whole, its points made and dragged' }),
      check('Snap to cues and markers', state.snapping, () => state.toggleSnap()),
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
    { name: 'Process', title: 'Every method by kind, for the output or the selection', items: [
      ...GROUPS.map(group => ({ label: group, items: Object.values(ops).filter(op => op.group === group).map(op => ({ label: op.name, hint: op.text, run: () => addOp(op.name) })), disabled: none })),
      '-',
      { label: 'Find an edit…', keys: keys('⌘P'), run: () => openTools(), disabled: none }
    ] },
    { name: 'Play', title: 'Play, loop, hear it before the edits; delivery checks', items: [
      { label: state.playing ? 'Pause' : sel ? 'Play the selection' : 'Play from the caret', keys: 'Space', run: togglePlay, disabled: !whole || !!state.recording },
      check('Loop', state.loop, toggleLoop, { disabled: !whole }),
      check('Hear it before the edits', state.ab, toggleAB, { keys: 'B', disabled: !state.canCompare }),
      '-',
      { label: 'Check against', items: specs.map(sp => check(sp.label, state.spec === sp.key, () => state.setSpec(sp.key))) }
    ] },
    { name: 'Help', title: 'Mouse and keys; the library', items: [
      { label: 'Mouse and keys', run: () => root.querySelector('dialog.help').showModal() },
      { label: 'The library, audio', run: () => open('https://github.com/audiojs/audio#readme', '_blank', 'noopener') },
      { label: 'This page’s source', run: () => open('https://github.com/audiojs/audio/tree/master/repl', '_blank', 'noopener') }
    ] }
  ]
}
// an edit of the selection, as a menu item: dimmed while there is nothing it can act on
const edit = (label, type, key, when) => ({ label, keys: key && keys(key), run: () => editSelection(type), disabled: !when })
const bar = menubar(root.querySelector('.menubar'), menus)
// What a picture's options and the settings hold, group by group: each its choices, what the chosen one does said under
// them. The waveform's colour, lanes, fill and level units; the spectrogram's method, frequency scale, colours, gamma,
// range and FFT size; the settings, what holds everywhere, whichever picture shows
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
    group('Colours', looks.map.map(m => [m, m[0].toUpperCase() + m.slice(1), m === 'grey' ? 'From the screen to white' : `Matplotlib's ${m}`]), state.look.map, m => setLook('map', m)),
    group('Gamma', looks.gamma.map(g => [g, `γ${g}`, g < 1 ? 'Quiet parts brighter' : g > 1 ? 'Quiet parts darker' : 'Levels even']), state.look.gamma, g => setLook('gamma', g)),
    group('Range', looks.depth.map(d => [d, `${d}dB`, `From the loudest down ${d} dB to the floor`]), state.look.depth, d => setLook('depth', d)),
    group('FFT size', looks.size.map(n => [n, n ? String(n) : 'Auto', n ? `Frames of ${n} samples` : 'Frames of 40 ms, longer on a zoomed band']), state.look.size, n => setLook('size', n))
  ]
  return [
    { label: 'Show over the sound', note: 'Each on or off', options: [
      ...state.overlayList.map(o => ({ label: o.label, hint: o.title, on: !!state.show[o.name], run: () => toggleShow(o.name) })),
      { label: 'Snap', hint: 'A dragged edge or caret goes onto a cue or marker a few pixels from it', on: state.snapping, run: () => state.toggleSnap() }
    ] },
    group('Scrub', scrubs.map(m => [m.name, m.label, m.text]), state.scrub, setScrub),
    group('Times in', state.unitList.map(u => [u.name, u.short, `${u.label}: ${u.example}`]), state.units, setUnits),
    group('Level steps', state.steps.map(db => [db, `${db}dB`, `A selection's level, dragged by its pill, goes ${db} dB a step`]), state.levelStep, setStep),
    group('Splices', state.splices.map(ms => [ms, ms ? `${ms}ms` : 'Off', ms ? `An edit's seams crossfaded over ${ms} ms, so they make no click` : 'At a seam, either side meets as it is']), state.splice, setSplice),
    group('Time row', rulers.map(r => [r.name, r.label, r.name === 'none' ? 'Only the times that matter now' : r.name === 'ticks' ? 'Ticks along the time row, no labels' : 'The times along the row, labelled']), state.ruler, setRuler)
  ]
}
// the View menu's submenus, the same groups
function lookMenu(kind) {
  return { label: kind === 'wave' ? 'Waveform' : 'Spectrogram', items: optionGroups(kind).map(g => ({ label: g.label, items: g.options.map(o => ({ label: o.label, hint: o.hint, checked: o.on, run: o.run })) })) }
}
// A picture's options (a right-click on its switch) or the settings (their button): a dropdown under it, every group in
// sight at once, no levels to go through; the button again, a press outside or Esc closes it
let dropOwner = null
function openDropdown(kind, owner) {
  const panel = root.querySelector('.dropdown'), open = panel.matches(':popover-open')
  if (open && dropOwner === owner && state.dropdown === kind) return closeDropdown()
  if (open) closeDropdown()
  dropOwner = owner
  state.dropdown = kind
  owner.setAttribute('aria-expanded', 'true')
  panel.showPopover()
  const r = owner.getBoundingClientRect(), w = panel.offsetWidth, h = panel.offsetHeight
  panel.style.left = `${Math.max(8, Math.min(innerWidth - w - 8, r.right - w))}px`
  panel.style.top = `${r.bottom + 6 + h > innerHeight - 8 ? Math.max(8, r.top - 6 - h) : r.bottom + 6}px`
}
// closed: at once by its button or a press outside, or by Esc (the popover's own toggle)
function closeDropdown() {
  const panel = root.querySelector('.dropdown')
  if (panel.matches(':popover-open')) panel.hidePopover()
  dropOwner?.setAttribute('aria-expanded', 'false')
  dropOwner = null
  state.dropdown = null
}
function dropToggle(event) { if (event.newState === 'closed' && dropOwner) closeDropdown() }
function settingsMenu(event) { openDropdown('settings', event.currentTarget) }
// a press outside the dropdown and its button closes it
addEventListener('pointerdown', event => {
  const panel = root.querySelector('.dropdown')
  if (panel.matches(':popover-open') && !panel.contains(event.target) && !dropOwner?.contains(event.target)) closeDropdown()
}, true)
// The picture's context menu (a right-click on it): what the Edit menu does to what is under the pointer, and what a
// selection is most often given (fades with the corners' curve, a crossfade across it, reverse, normalize), each a step
// of the chain; ⌘P finds the rest. At the caret: paste, a marker, all of it
function contextMenu() {
  const list = v.ranges, several = list.length > 1, find = { label: 'Find an edit…', keys: keys('⌘P'), run: () => openTools(), icon: glyphs.find }
  const method = (label, name) => ({ label, run: () => addOp(name, false), icon: opIcons[name] })
  const act = (label, type, key, when, icon) => ({ ...edit(label, type, key, when), icon })
  // and last, how the picture draws: its options, under its switch
  const look = ['-', { label: state.display === 'spec' ? 'How the spectrogram draws…' : 'How the waveform draws…', run: () => looksAt(root.querySelector('.display [aria-selected="true"]')) }]
  if (v.band) return [act('Delete the band', 'remove', '⌫', true, icons.remove), act('6 dB quieter', 'quieter', '', true, glyphs.down), act('6 dB louder', 'louder', '', true, glyphs.up), act('Rebuild from around it', 'repair', '', true, icons.repair), act('Take this noise out everywhere', 'denoise', '', true, opIcons.denoise), '-', find, ...look]
  if (!list.length) return [
    act(v.carets.length > 1 ? `Paste at all ${v.carets.length} carets` : 'Paste', 'paste', '⌘V', state.canPaste, icons.paste),
    { label: v.carets.length > 1 ? 'A marker at each caret' : 'Add a marker', keys: 'M', run: addMarker, icon: glyphs.marker },
    { label: 'Select all', keys: keys('⌘A'), run: () => v.select(0, v.duration), icon: glyphs.all },
    '-', find, ...look
  ]
  const [a, b] = v.selection ?? list[0]
  return [
    act('Cut', 'cut', '⌘X', !several, icons.cut), act('Copy', 'copy', '⌘C', !several, icons.copy), act('Paste', 'paste', '⌘V', state.canPaste && !several, icons.paste), act('Delete', 'remove', '⌫', true, icons.remove),
    act('Keep only this', 'crop', 'K', !several, icons.crop),
    '-',
    { label: 'Fade in', run: () => fade({ kind: 'in', from: a, to: b, curve: state.fadeCurve }), disabled: several, icon: curveIcon(state.fadeCurve) },
    { label: 'Fade out', run: () => fade({ kind: 'out', from: a, to: b, curve: state.fadeCurve }), disabled: several, icon: curveIcon(state.fadeCurve, true) },
    method('Crossfade across it', 'crossfade'),
    act('3 dB louder', 'louder', '', true, glyphs.up), act('3 dB quieter', 'quieter', '', true, glyphs.down),
    method('Reverse', 'reverse'), method('Normalize', 'normalize'),
    act('Take this noise out everywhere', 'denoise', '', true, opIcons.denoise),
    '-',
    { label: 'Zoom to it', run: () => v.zoomTo(a, b), icon: glyphs.zoom },
    find, ...look
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
function quick({ band, boxes, ranges, selection, carets, canPaste, pauses }) {
  const t = (type, label, keys, icon = type) => ({ type, label, keys, icon: icons[icon] ?? groupIcons.Level })
  if (boxes > 1) return [t('remove', `Remove all ${boxes} bands`, '⌫'), t('quieter', 'Each 6 dB quieter'), t('louder', 'Each 6 dB louder'), t('repair', 'Rebuild each from its surroundings'), t('denoise', 'The noise in each, taken 12 dB down in its band everywhere', '', 'repair')]
  if (band) return [t('remove', 'Remove this band', '⌫'), t('quieter', 'This band 6 dB quieter'), t('louder', 'This band 6 dB louder'), t('repair', 'Rebuild this band from its surroundings'), t('denoise', 'The noise here, taken 12 dB down in this band everywhere', '', 'repair')]
  // several ranges: what acts on each alike; pauses, each shortened
  if (ranges > 1) return [t('remove', `Delete all ${ranges}`, '⌫'), t('quieter', 'Each 3 dB quieter'), t('louder', 'Each 3 dB louder'), ...(pauses ? [t('shorten', 'Shorten each pause to a quarter second', '', 'cut')] : []), t('denoise', `The noise alone in all ${ranges}: learned there, taken 12 dB down everywhere`, '', 'repair')]
  if (selection) return [t('crop', 'Keep only this', 'K'), t('remove', 'Delete', '⌫'), t('cut', 'Cut', '⌘X'), t('copy', 'Copy', '⌘C'), t('quieter', '3 dB quieter'), t('louder', '3 dB louder'), t('denoise', 'The noise here, taken 12 dB down everywhere', '', 'repair')]
  // several carets: a paste at each, a marker at each
  if (carets > 1) return [...(canPaste ? [t('paste', `Paste at all ${carets}`, '⌘V')] : []), t('mark', `A marker at each of the ${carets} carets`, 'M', 'paste')]
  return canPaste ? [t('paste', 'Paste at the caret', '⌘V')] : []
}
function resetView() {
  v.fit()
  state.display = v.display = 'wave'
  state.show = { hits: true, gain: true, meters: true }
  setUnits('clock')
  setLevels('linear')
  setRuler('labels')
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
    return show({ logs: [], error: { message: `Syntax error on line ${ed.view.state.doc.lineAt(syntax.from).number}` } }, true)
  }
  // the whole chain, what one step of it takes out, or the chain rolled back, as the stack says
  const calls = chain(code)?.calls || [], { delta, back } = viewing, step = calls[delta]
  const runs = step ? residual(code, delta) : back != null ? rollback(code, back) : code
  state.viewing = step ? `What .${step.name}() takes out` : back != null && back < calls.length ? back ? `Up to .${calls[back - 1].name}()` : 'The source alone' : ''
  const script = prepare(runs)
  await restoring
  // Built-in samples are made when a script first names one; the worker takes messages in order, so the file
  // arrives before the run that opens it, and runs stay in the order they were asked for.
  for (const name of script.names) if (!eng.has(name) && builtins[name]) eng.file(name, sample(name))
  // the output keeps the code that made it (what ran, and what the editor had)
  const coming = Object.assign(arrival(script.names), { code: runs, editor: code })
  if (!waiting++) waited = performance.now()
  status()
  const result = await eng.run(script, coming)
  waiting--
  if (!result.skipped) show(result, false, script.names, coming)
  status()
}

// A run's reply: what the script printed in the console under it; what went wrong, in the status bar after the time
// and at its line in the script. The last output that ran stays. A sound it made
// then arrives (arrival).
function show(result, syntax = false, names = [], coming = null) {
  // the first result, whatever it is, says whether there is a sound: until then the view waits, not invites
  state.ran = true
  const lines = [...(result.logs || [])], e = result.error
  if (result.value != null) lines.push({ level: 'value', text: result.value })
  state.lines = lines
  const problem = e ? e.message + (e.line ? ` (line ${e.line})` : '') : ''
  state.problem = problem
  state.missing = e?.missing || ''
  if (syntax) return
  const doc = ed.view.state.doc
  ed.errors(e?.line && e.line <= doc.lines ? [{ from: doc.line(e.line).from, to: doc.line(e.line).to, message: e.message }] : [])
  state.canPaste = !!chain(ed.code)?.calls.some(c => c.name === 'copy' || c.name === 'cut')
  // an edit drawn ahead of its output that failed: the picture goes back to the output there is
  if (e) { v.expect(null); if (!state.hasOutput) entitle(names, false); return finished({ ok: false, problem }) }
  // exports follow the output the page shows: the last run that succeeded
  state.saves = result.saves || []
  entitle(names, !!result.output || state.hasOutput)
  if (result.output) { coming.id = result.id; incoming = coming; state.loading = !state.hasOutput; return }
  incoming = null
  state.loading = false
  settle(null)
  finished({ ok: true, duration: 0 })
}
// A run's end, for whoever waits on it (an agent's edit): the output's length, or what went wrong
let waiters = []
const ran = () => new Promise(resolve => waiters.push(resolve))
const finished = result => { for (const resolve of waiters.splice(0)) resolve(result) }
const within = (promise, ms = 60000) => Promise.race([promise, new Promise(resolve => setTimeout(() => resolve({ ok: false, problem: 'Still running' }), ms))])

// A run's output as it arrives. The view keeps the last output until the new one is whole, or for a moment: one that
// takes longer shows as it comes. A view with nothing, or a file new to it, shows at once: the file itself as it
// decodes, dim, while the output has nothing yet (it waits for the whole file, as trim and normalize do).
function arrival(names) {
  const a = { id: 0, names, parts: [], sampleRate: 0, channels: 0, total: null, started: performance.now(), last: performance.now(), on: false, preview: false, loaded: null }
  const current = () => incoming === a
  a.loading = m => {
    if (!current() || a.on) return
    a.last = performance.now()
    a.loaded = { at: (m.at + m.channels[0].length) / m.sampleRate, estimate: m.estimate }
    // nor while the picture holds a take recorded, or an edit drawn ahead, till the output that has it comes
    if (!a.preview && (v.expecting || state.hasOutput && !fresh(names))) return status()
    if (!a.preview) {
      a.preview = true
      showing = 0
      v.stream({ sampleRate: m.sampleRate, channels: m.channels.length, total: m.estimate ? Math.round(m.estimate * m.sampleRate) : null, dim: true, keep: holding })
      aim()
      pl.set(null)
      state.whole = false
      state.hasOutput = true
      state.loading = true
    }
    v.append(m.channels)
    status()
  }
  a.chunk = m => {
    if (!current()) return
    a.last = performance.now()
    a.sampleRate = m.sampleRate
    a.channels = m.channels.length
    if (m.total) a.total = m.total
    // its file still arriving, how much has come
    a.loaded = m.loaded != null ? { at: m.loaded, estimate: m.estimate } : null
    a.parts.push(m)
    if (a.on) v.append(m.channels)
    // an edit the view drew ahead waits whole: the picture it drew holds till then, nothing moving; an output as long as
    // the one shown (an edit over a range, a band taken out) comes in over it as it renders, only where it differs
    else if (alike(a)) { if (!v.expecting) v.patch(m.at, m.channels) }
    else if (a.preview || !state.hasOutput || !v.expecting && performance.now() - a.started > 150) begin(a)
    status()
  }
  a.done = m => {
    if (!current()) return
    incoming = null
    // an older script's output, while the picture holds an edit drawn ahead of a newer one: not the output it waits for,
    // which is on its way (the script changed since this one ran); taken for it, it would end the wait, and the newer
    // output, arriving unlooked-for, would show all of it again, the view moved under the pointer
    if (v.expecting && !a.on && a.editor !== ed.code) { a.parts = []; return status() }
    const length = Math.round(m.duration * m.sampleRate)
    const channels = Array.from({ length: m.channels }, (_, c) => {
      const x = new Float32Array(length)
      for (const p of a.parts) x.set(p.channels[c].subarray(0, Math.max(0, length - p.at)), p.at)
      return x
    })
    a.parts = []
    if (a.on) v.finish()
    settle({ id: a.id, names, channels, sampleRate: m.sampleRate, duration: m.duration, stats: m.stats, segments: m.segments, markers: m.markers, clips: m.clips, bitDepth: m.bitDepth, code: a.code, editor: a.editor }, !a.on)
    finished({ ok: true, duration: m.duration, loudness: m.stats?.loudness, peak: m.stats?.peak })
    status()
  }
  a.error = m => {
    if (!current()) return
    incoming = null
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
const alike = a => !!output && a.total != null && a.total === output.channels[0]?.length && a.sampleRate === output.sampleRate && a.channels === output.channels.length && !fresh(a.names)
// The view shows an output as it arrives; the player has what has come
function begin(a) {
  a.on = true
  a.preview = false
  showing = a.id
  v.stream({ sampleRate: a.sampleRate, channels: a.channels, total: a.total })
  aim()
  for (const p of a.parts) v.append(p.channels)
  state.hasOutput = true
  state.loading = false
}
// A whole output (or none) becomes the page's: drawn (unless it was drawn as it came), played, measured
// The tab's sound where it was looked at when it was left, before a switch or a reload: once, as soon as the sound
// starts arriving, so the view is where it was while the rest comes in
function aim() {
  const doc = docs.find(d => d.id === state.tab)
  if (doc?.frame) { v.frame = doc.frame; doc.frame = null }
}
function settle(out, draw = true) {
  output = out
  holding = false
  // the tab's own, to show at once when it is shown again
  const doc = docs.find(d => d.id === state.tab)
  if (doc) doc.output = out
  const has = !!out?.duration
  showing = has ? out.id : 0
  state.hasOutput = has
  state.whole = has
  state.loading = false
  if (draw) v.set(has ? out.channels : [], out?.sampleRate)
  else if (has) v.samples = out.channels
  if (has) aim()
  v.segments = out?.segments
  v.clips = out?.clips
  v.markers = out?.markers
  pl.set(has ? out.channels : null, out?.sampleRate)
  if (!has && pl.playing) togglePlay()
  state.length = has ? clock(out.duration) : ''
  state.ab = false
  state.canCompare = has && !!sourceName()
  describe()
  marks()
  meter()
  scheduleCheck()
}

// What the engine is doing, said beside the time while it takes a moment: a file arriving, and how much of it; a
// script running; an output rendering. Stop shows once a run has taken two seconds.
let ticking = 0
function status() {
  const now = performance.now(), a = incoming
  let text = '', since = null
  if (a?.loaded) text = a.loaded.estimate ? `Loading ${Math.min(99, Math.floor(a.loaded.at / a.loaded.estimate * 100))}%` : `Loading ${a.loaded.at.toFixed(1)}s`
  else if (waiting && now - waited > 300) { text = 'Running…'; since = waited }
  // an output on its way, a moment after it set off: how much of it has come, where its length is known
  else if (a && now - a.started > 150) { const done = a.parts.at(-1), at = done ? done.at + done.channels[0].length : 0; text = a.total ? `Rendering ${Math.min(99, Math.floor(at / a.total * 100))}%` : 'Rendering…'; since = a.started }
  // how long it has taken, once it takes a second, where no share of it says how far it is
  state.progress = text && since != null && !text.endsWith('%') && now - since > 1000 ? `${text} ${((now - since) / 1000).toFixed(1)}s` : text
  state.slow = since != null && now - since > 2000
  const busy = waiting || a
  if (busy && !ticking) ticking = setInterval(status, 100)
  if (!busy && ticking) { clearInterval(ticking); ticking = 0 }
  sway()
}

// Named for its source, or for the files the script opens, while a chain is being typed; so a file that failed to open
// is still named
function entitle(names, has) {
  const opened = source(ed.code)?.strings.map(s => s.name) || names
  state.name = opened.length ? opened.map(label).join(' + ') : has ? 'generated' : 'untitled'
  document.title = `${state.name === 'untitled' ? '' : state.name + ' · '}audio editor`
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

// A/B: the original at the same place, level-matched to the output; the next output, or B again, returns to it.
// B, or Play > Hear it before the edits; the word over the picture says which is heard
async function toggleAB() {
  const name = sourceName()
  if (!state.hasOutput) return
  if (!name) return note('A generated sound has no file as it opened to hear it against.')
  if (state.ab) { state.ab = false; pl.set(output.channels, output.sampleRate); return note('Hearing the output, after the edits') }
  const loudness = output.stats.loudness
  if (original?.name !== name || original.loudness !== loudness) {
    const r = await eng.original(name, loudness)
    if (!r.channels) return note(r.error?.message || 'The original is too long to hold beside the output.')
    original = { name, loudness, ...r }
  }
  state.ab = true
  state.abGain = original.gain
  pl.set(original.channels, original.sampleRate)
  note(`Hearing before the edits: the file as it opened, level-matched (${original.gain >= 0 ? '+' : '−'}${Math.abs(original.gain).toFixed(1)}dB). B for after`)
}

// What the picture shows besides the sound, as the View menu says: the cues, the pitch curve, the gain line, meters.
async function marks() {
  v.show = state.show
  if (!state.whole) return
  // the cues whether they show or not: a double-click selects between them, ⌥ and the arrows step by them, an edge goes
  // onto them. They are the output's shown, read against the code that made it; once the code has moved on (a cue
  // dragged), the output coming brings its own, and the cues the view moved stay till then
  const out = output, [edges, hits] = await Promise.all([eng.cues(out.id, 'edges'), eng.cues(out.id, 'hits')])
  if (edges && hits && out === output && out.editor === ed.code) v.cues = cuesOf(cueTimes(edges, hits), out.code)
  // the pitch curve, with the pitch line it was measured with, while pitch is edited: drawn on the spectrogram, the note
  // said over the range
  if (state.pitch) { const f0 = await eng.contour(out.id); if (out === output) v.contour = { ...f0, shift: shiftOf(out.code) } }
}
function toggleShow(name) {
  state.show = { ...state.show, [name]: !state.show[name] }
  store()
  marks()
  meter()
}
// The meters at the view's right: the output's level and spectrum where it is heard (the 50 ms before the playhead, a
// spectrum frame ending there), across the selection, or around the caret (meters.js)
function meter(t = null) {
  if (!state.show.meters || !output?.duration) { v.meters = null; return }
  const rate = output.sampleRate, x = output.channels, size = 4096, sel = t == null && v.selection
  const [a, b] = t != null ? [t - .05, t] : sel || [v.cursor - .025, v.cursor + .025], from = Math.round(a * rate), to = Math.round(b * rate)
  const [s0, s1] = t != null ? [to - size, to] : sel ? [from, Math.max(to, from + size)] : [Math.round(v.cursor * rate) - size / 2, Math.round(v.cursor * rate) + size / 2]
  v.meters = { levels: levels(x, from, to), spectra: spectra(x, s0, s1, { size }), size }
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
// How the waveform or the spectrogram draws, its menu under its tab right-clicked, shown at once
function looksAt(el, name = state.display) {
  if (name !== state.display) setDisplay(name)
  openDropdown(name, el)
}
function setWave(key, value) { state.wave = { ...state.wave, [key]: value }; v.waveform = state.wave; store() }
// How a held caret sounds (scrub.js), one of the lab's ways
function setScrub(name) { state.scrub = pl.scrubMode = name; store() }

// What the output is, at the status bar's right: its levels (the output's peak and loudness, the selection's peak and
// RMS, or the band selected), then its rate, channels and depth, a click away from resampling and remixing.
const hertz = f => f >= 1000 ? `${+(f / 1000).toFixed(2)}kHz` : `${Math.round(f)}Hz`
function describe() {
  listen()
  state.sound = null
  if (!output?.duration) { state.readout = ''; return }
  const { sampleRate, channels, stats, bitDepth } = output, k = channels.length
  state.sound = { hz: sampleRate, rate: `${+(sampleRate / 1000).toFixed(3)}kHz`, count: k, channels: layouts.find(l => l.count === k)?.label ?? `${k} ch`, depth: bitDepth ? `${bitDepth}-bit` : '' }
  const sel = state.selection
  if (!sel) { state.readout = [`peak ${dbfs(stats.peak)}dBFS`, Number.isFinite(stats.loudness) ? `${dbfs(stats.loudness)}LUFS` : ''].filter(Boolean).join(' '); return }
  const [a, b] = sel, rate = output.sampleRate, from = Math.floor(a * rate), to = Math.ceil(b * rate)
  let peak = 0, sum = 0, n = 0
  for (const ch of output.channels) for (let i = from; i < to && i < ch.length; i++) { const x = ch[i]; sum += x * x; n++; if (Math.abs(x) > peak) peak = Math.abs(x) }
  state.readout = state.boxes > 1 ? `${state.boxes} bands` : state.band ? `${hertz(state.band[0])}–${hertz(state.band[1])}` : `peak ${dbfs(20 * Math.log10(peak))}dB RMS ${dbfs(10 * Math.log10(sum / Math.max(1, n)))}dB`
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
function setUnits(name) {
  state.units = v.units = name
  state.time = stamp(pl.playing ? pl.time : v.cursor)
  describe()
  store()
}
function setLevels(name) { state.levels = v.levels = name; store() }
function setRuler(mode) { state.ruler = v.ruler = mode; store() }
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
// on the picture (view.js state) as it was made (`before`, the edit not yet drawn) and as it was left (`after`, when
// undone): undo brings back what was selected before the step, redo what was selected after it, as a text editor's
// history brings back its selections (CodeMirror keeps them in each of its events). The selection is the page's, not
// the sound's: it stays out of the script.
function remember(code, sliding) {
  const [back, ahead] = ed.depth, was = depthWas, now = v?.state
  if (sliding && back === was) return
  depthWas = back
  // undone, an edit drawn ahead of its output is not coming: the picture goes back to the output there is
  if (back < was) { v.expect(null); if (steps[was]) steps[was].after = now; if (steps[back + 1]?.before) v.state = steps[back + 1].before }
  else if (back > was && steps[back]?.code === code && steps[back].after) v.state = steps[back].after
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
// Play answers the press, as a transport key does, not the release; a key or a script clicking it (detail 0) still works.
// Held and dragged across, it sets the speed (setSpeed): a scale shows over it, 0.1× to 10×, the pointer hidden, the
// speed going twice or half as fast each 32 px; let go, the speed stays, shown by Play (WORKSHOP `speed`). So a press
// while it plays pauses at its release, unless it was dragged, with the caret where it was pressed.
const OCTAVE = 32, AXIS = OCTAVE * Math.log2(100)
function playPress(event) {
  if (event.button !== 0 || state.recording) return
  const button = event.currentTarget, x0 = event.clientX, was = pl.playing, t0 = pl.time, from = state.speed
  let moved = false
  if (!was) togglePlay()
  button.setPointerCapture?.(event.pointerId)
  const move = e => {
    const dx = e.clientX - x0
    if (!moved && Math.abs(dx) < 4) return
    // the scale where it starts, the speed there over Play, within the window
    if (!moved) { moved = true; const r = button.getBoundingClientRect(); state.speedAxis = { left: Math.max(8, Math.min(innerWidth - AXIS - 36, r.left + r.width / 2 - 14 - SPEEDS.at(from) * AXIS)), top: r.top }; root.classList.add('shuttling') }
    setSpeed(from * 2 ** (dx / OCTAVE))
  }
  const up = () => {
    for (const [type, f] of on) button.removeEventListener(type, f)
    state.speedAxis = null
    root.classList.remove('shuttling')
    if (!moved && was) togglePlay(t0)
  }
  const on = [['pointermove', move], ['pointerup', up], ['pointercancel', up]]
  for (const [type, f] of on) button.addEventListener(type, f)
}
// The speed, 0.1× to 10×, the pitch kept; 1× within 3% of it, so a drag back finds it
function setSpeed(r) {
  r = SPEEDS.range(r)
  state.speed = pl.rate = Math.abs(Math.log2(r)) < .04 ? 1 : +r.toPrecision(2)
  store()
}
// The speeds as a list, a right-click on Play; the pill's turn
function speedMenu(event) {
  event.preventDefault()
  bar.at(SPEEDS.list.map(r => ({ label: `${r}×`, checked: state.speed === r, run: () => setSpeed(r) })), 0, 0, event.currentTarget)
}
function turnSpeed() { setSpeed(SPEEDS.turn.find(r => r > state.speed + 1e-9) ?? SPEEDS.turn[0]) }
function playClick(event) { if (!event.detail) togglePlay() }
// Playing and recording are one or the other: while it records, Play is off (Space stops the recording)
async function togglePlay(at) {
  if (!state.whole || state.recording) return
  if (pl.playing) {
    pl.pause()
    cancelAnimationFrame(ticker)
    state.playing = false
    v.playhead = null
    v.setCursor(at ?? pl.time)
    sway()
    return
  }
  state.playing = true
  // The clock follows once the device has started. A band selection plays only its frequencies.
  await pl.play(plays())
  if (!pl.playing) { state.playing = false; return }
  sway()
  const tick = () => { if (!pl.playing) return; const t = pl.time; v.playhead = t; state.time = stamp(t); meter(t); ticker = requestAnimationFrame(tick) }
  tick()
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
    return pl.scrub(t, band)
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
  // a paste at each caret, from the last back so each time holds for the ones before it
  if (type === 'paste') {
    const at = Array.isArray(range?.[0]) ? range.map(r => r[0]) : v.carets.length ? v.carets : [v.cursor]
    return !!write(at.sort((p, q) => q - p).map(t => `paste(${number(t, v.unit)}${seam()})`).join('.'))
  }
  // an op that learns from the selection takes it whole, every range
  if (ops[type]?.params?.some(s => s.selection)) return addOp(type)
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

// The chain's last edit, before a closing save() or play(), when it is `name`.
function lastEdit(code, name) {
  const calls = chain(code)?.calls.filter(k => !methods[k.name]?.sink) || [], call = calls.at(-1)
  return call?.name === name ? { call, before: calls.at(-2)?.to ?? chain(code).root.to } : null
}
// The script's last edit, to set again in place, when it is `name` and it is what shows: none while the output shows
// the chain rolled back to an earlier step (the edits), the edit then going after that step (write())
const amend = name => rk.ahead() ? null : lastEdit(ed.code, name)
const pair = ([s, d]) => `[${number(s)}, ${number(d)}]`
const markersOf = last => Array.isArray(last?.call.args[0]?.value) ? last.call.args[0].value.map(p => [...p]) : []
// Cues: those found in the output, the last warp()'s markers standing in for those they placed, so a cue dragged again
// is the marker it made, not one found near it. A cue at the very start is the start, which warp() holds.
function cuesOf(found, code) {
  const placed = markersOf(lastEdit(code, 'warp')).map(p => p[1])
  return [...found.filter(t => t > 0 && !placed.some(d => Math.abs(d - t) < .03)), ...placed].sort((a, b) => a - b)
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
function carry({ at, duration, to, copy }) {
  const s = t => number(t, v.unit)
  return write(copy ? `copy({ at: ${s(at)}, d: ${s(duration)} }).paste(${s(to)}${seam()})` : `move({ at: ${s(at)}, d: ${s(duration)}, to: ${s(to)}${splice()} })`)
}
// A selection's audio dragged up onto the tabs: a tab of its own, its script this one's cropped to it, so its sound is
// the same (the chain as shown, rolled back or not); moved, it leaves this one, the rest closing up as a cut's, one step
function toTab({ at, duration, copy }) {
  const s = t => number(t, v.unit), cut = rk.ahead(), code = cut ? applied(ed.code, cut) : ed.code
  const change = append(code, `crop({ at: ${s(at)}, d: ${s(duration)} })`)
  if (!change || !copy && !write(`remove({ at: ${s(at)}, d: ${s(duration)}${splice()} })`)) return false
  newTab(applied(code, change))
  v.expect(null)
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
const samplesOf = (at, d) => Math.min(Math.round(d * output.sampleRate), Math.round(output.duration * output.sampleRate) - Math.round(at * output.sampleRate))
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
// A marker at the caret, at each when there are several, or where it plays while it plays: mark() at the chain's end (M)
function addMarker() {
  if (!state.whole) return
  return write((pl.playing ? [pl.time] : v.carets).map(t => `mark(${number(t, v.unit)})`).join('.'))
}
// The mark() call that set a marker: the one whose time is nearest
function markCall(time) {
  const calls = (chain(ed.code)?.calls || []).filter(k => k.name === 'mark' && typeof k.args[0]?.value === 'number')
  return calls.reduce((a, k) => !a || Math.abs(k.args[0].value - time) < Math.abs(a.args[0].value - time) ? k : a, null)
}
// A marker taken away (a double-click on its flag), or moved (a drag of it): its mark() call gone, or its time moved
// as much, the edits after it being what they were
function unmark({ time }) {
  const call = markCall(time)
  if (!call) return note('This marker comes from the file; no mark() in the script sets it.')
  ed.change({ from: call.dot ?? call.from, to: call.to, insert: '' })
  return true
}
// A marker named, or its name taken away: its mark() call's label
function relabel({ time, label }) {
  const call = markCall(time)
  if (!call) return note('This marker comes from the file; no mark() in the script sets it.')
  const named = call.args[1]
  if (!label) return named ? (ed.change({ from: call.args[0].to, to: named.to, insert: '' }), true) : true
  ed.change(setArg(call, 1, label))
  return true
}
function remark({ time, to }) {
  const call = markCall(time), at = call?.args[0]
  if (!at) return note('This marker comes from the file; no mark() in the script sets it.')
  ed.change({ from: at.from, to: at.to, insert: number(Math.max(0, at.value + to - time), v.unit) })
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
// Pitch edited, or not (View, Edit pitch). Pitch shows on the spectrogram: editing it, the picture turns to it; done,
// to the waveform again, if it turned for this
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
// The curve a line shows: the chain's last gain() curve, the gain line's
function envelopeOf(code, name = 'gain') {
  const calls = chain(code)?.calls || []
  for (let i = calls.length - 1; i >= 0; i--) if (calls[i].name === name) { const curve = curveOf(calls[i]); if (curve) return curve }
  return null
}
// The pitch line's: a pitch() curve that is the chain's last edit, the one the line sets again in place; one before
// another edit is the output's as it is, and the line starts anew (hoisted, as envelopeOf)
function shiftOf(code) { return curveOf(lastEdit(code, 'pitch')?.call) }

// A selection's voice, by its tools: its pitch moved some semitones (whole, or to the cent), pitch() a voice's over it;
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
  const op = ops[name], learn = op?.params?.find(s => s.selection), several = v.ranges.length > 1 && !v.band
  const span = ([a, b]) => `{ at: ${number(a, v.unit)}, d: ${number(b - a, v.unit)} }`
  const call = args => /^[\w$]+$/.test(name) ? `${name}(${args})` : `['${name}'](${args})`
  const add = text => {
    const change = write(text)
    if (!change) return
    // the last call it wrote, where its "(" is
    const end = change.from + change.insert.length, at = chain(ed.code)?.calls.findLast(k => k.list.from >= change.from && k.list.from < end)?.list.from
    if (at == null) return
    ed.select(at + 1)
    if (open && state.side !== 'edits') { state.side = 'edits'; store() }
    if (state.side === 'edits') rk.choose(at)
  }
  // what it learns from is what is selected (denoise: where the noise plays alone), every range of it; it acts on all;
  // a box on the spectrogram, its time where the noise plays alone, its band where it goes (each box its own call)
  if (learn) {
    const boxes = !v.band ? [] : v.boxes.length > 1 ? v.boxes : [[...v.selection, ...v.band]]
    if (boxes.length && name === 'denoise') return add(boxes.map(([a, b, lo, hi]) => call(`{ ${learn.name}: ${span([a, b])}, band: [${Math.round(lo)}, ${Math.round(hi)}] }`)).join('.'))
    const list = v.band ? [] : several ? [...v.ranges].sort((p, q) => p[0] - q[0]) : v.selection ? [v.selection] : []
    if (!list.length) return note(`Select ${learn.selection} first.`)
    return add(call(`{ ${learn.name}: ${list.length > 1 ? `[${list.map(span).join(', ')}]` : span(list[0])} }`))
  }
  // several ranges: the method on each, from the last back, in one step
  const needs = (op.params || []).slice(0, (op.params || []).findLastIndex(s => s.required) + 1).map(s => typeof s.default === 'string' ? quote(s.default) : String(s.default))
  if (several) return add([...v.ranges].sort((p, q) => q[0] - p[0]).map(r => call([...needs, span(r)].join(', '))).join('.'))
  // a selection of all of it is no range at all; what the library can't do without is written, set to its default
  const sel = v.selection && (v.selection[0] > v.unit / 2 || v.selection[1] < v.duration - v.unit / 2) ? v.selection : null
  add(call([...needs, sel ? span(sel) : op.range ? `{ at: 0, d: ${number(v.duration)} }` : ''].filter(Boolean).join(', ')))
}
// A call at the end of the chain, as one step. The output showing the chain rolled back to a step (the edits), the
// steps after it go first, in the same step: the edit is made on what shows
function write(...calls) {
  const cut = rk.ahead()
  let code = cut ? applied(ed.code, cut) : ed.code, change = null
  for (const call of calls) {
    change = append(code, call)
    if (!change) { note('Open or generate a sound first.'); return null }
    code = applied(code, change)
  }
  ed.change(cut || calls.length > 1 ? between(ed.code, code) : change)
  return change
}
const applied = (code, { from, to = from, insert }) => code.slice(0, from) + insert + code.slice(to)
// the one change that makes b of a: what lies between the start and the end they share
function between(a, b) {
  let i = 0, j = 0
  while (i < a.length && i < b.length && a[i] === b[i]) i++
  while (j < a.length - i && j < b.length - i && a[a.length - 1 - j] === b[b.length - 1 - j]) j++
  return { from: i, to: a.length - j, insert: b.slice(i, b.length - j) }
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

// Sources. A new sound opens in a tab of its own, or in the tab shown if it is empty; a file dropped on the waveform
// joins it at the end; one dropped on the script is written where it lands. A file the script opens that is not here
// (`missing`) takes the one opened for it (Open it…), or one by its name, and the script runs again.
let relink = ''
function pickFiles(missing = '') { closeMenus(); relink = typeof missing === 'string' ? missing : ''; root.querySelector('.file-input').click() }
async function openFiles(list, how = 'new', at = null) {
  root.querySelector('.file-input').value = ''
  const files = list.filter(f => /^(audio|video)\//.test(f.type) || /\.(wav|mp3|flac|ogg|oga|opus|m4a|aac|aiff?|caf|webm|mp4|mov|wma|amr|mka)$/i.test(f.name))
  const into = relink || files.find(f => f.name === state.missing) && state.missing
  relink = ''
  if (!files.length) return note(list.length ? 'Those are not audio files.' : '')
  if (into) { await hold(into, files.find(f => f.name === into) ?? files[0]); state.problem = state.missing = ''; return schedule(0) }
  const names = []
  for (const file of files) {
    const name = unique(file.name, new Set(eng.names.filter(n => !names.includes(n))))
    await hold(name, file)
    names.push(name)
  }
  place(names, how, at)
}
// A file the scripts open by name, kept for the next visit (keep.js)
function hold(name, data) { keep(name, data); return eng.file(name, data) }
// The kept files a tab's script still opens, open again; the rest let go
async function restore() {
  const named = new Set(docs.flatMap(d => [...prepare(d.code).names]))
  for (const [name, file] of await kept()) !named.has(name) || builtins[name] ? unkeep(name) : await eng.file(name, file)
}
function place(names, how, at = null) {
  // what went wrong with the last sound no longer holds
  state.problem = ''
  const code = ed.code, list = names.map(quote)
  const expr = list.length > 1 ? `[${list.join(', ')}]` : list[0]
  if (how === 'at' && at != null) return ed.change({ from: at, insert: `audio(${expr})` })
  // in at a time on the picture, the seams crossfaded as an edit's are
  if (how === 'insert' && at != null && chain(code)) return write(`insert(audio(${expr}), { at: ${number(at, v.unit)}${splice()} })`)
  opening(`audio(${expr})`)
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
// last, the take the one that was going when it stopped. With nothing open, the take is the sound.
let take = null
async function startRecording() {
  closeMenus()
  if (recorder || state.recording) return
  if (pl.playing) togglePlay()
  const into = state.whole, sel = into && !v.band ? v.selection : null
  const t = take = { into, at: into ? (sel ? sel[0] : v.cursor) : 0, until: sel ? sel[1] : null, samples: 0, pass: 0, queue: [], frame: 0, started: false }
  state.recording = { pending: true }
  try {
    recorder = await record({ onblock: block => { t.queue.push(block); t.frame ||= requestAnimationFrame(() => flush(t)) } })
    if (!state.recording) return recorder.cancel()
    t.rate = recorder.sampleRate
    state.recording.pending = false
    sway()
  } catch (e) {
    state.recording = null
    recorder = take = null
    sway()
    note(e?.name === 'NotAllowedError' ? 'Microphone access was denied. Allow it in the browser to record.' : 'The microphone is not available.')
  }
}
// The blocks come since the last frame: onto the picture, the playhead where the take has got to
function flush(t) {
  t.frame = 0
  const blocks = t.queue.splice(0)
  if (take !== t || !blocks.length) return
  const begin = () => v.take({ at: t.at, sampleRate: t.rate, channels: blocks[0].length })
  if (!t.started) { t.started = true; begin(); state.hasOutput = true }
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
  const at = t.at + (t.samples - t.pass) / t.rate
  v.playhead = at
  state.time = stamp(at)
}
async function stopRecording() {
  const rec = recorder, t = take
  if (!rec) { state.recording = null; return }
  recorder = take = null
  cancelAnimationFrame(t.frame)
  const got = rec.stop()
  state.recording = null
  v.playhead = null
  sway()
  // the last pass, to the selection's end
  const length = t.until == null ? Infinity : Math.round((t.until - t.at) * got.sampleRate)
  const channels = got.channels.map(c => c.slice(t.pass, t.pass + length))
  if (!channels[0]?.length) { if (t.into) v.take(null); return note('Nothing was recorded.') }
  const name = unique(t.into ? 'take.wav' : 'recording.wav', new Set(eng.names))
  await hold(name, { channels, sampleRate: got.sampleRate })
  if (!t.into) return place([name], 'new')
  if (!write(`write(audio(${quote(name)}), { at: ${number(t.at, v.unit)} })`)) return v.take(null)
  v.setCursor(t.at + channels[0].length / got.sampleRate)
}

// Sound search
function openSearch() { closeMenus(); root.querySelector('dialog.search').showModal() }
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
async function exportFiles(parts = false) {
  if (!state.hasOutput || state.exporting) return
  state.exporting = true
  try {
    const base = state.exportName.trim().replace(/\.\w+$/, '') || state.exportBase
    // the format's setting, the markers in the file or none (WAV's cue chunk, MP3's and M4A's chapters)
    const e = ENCODING[state.format], value = e && state.encoding[e[0]], options = { ...value != null && { [e[0]]: value }, ...!state.encoding.markers && { markers: [], regions: [] } }
    const { files = [], error: failed } = await eng.export({ format: state.format, name: base, parts: parts === true, options })
    if (failed) throw new Error(failed.message)
    for (const file of files) download(file)
  } catch (e) { note(`Export failed: ${e.message}`) }
  finally { state.exporting = false }
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
// each named as the bridge's MCP server names it (bin/mcp.js --editor). What an edit does is answered once its run ends.
const page = {
  state: () => ({
    script: ed.code, name: state.name, duration: output?.duration ?? 0, sampleRate: output?.sampleRate ?? null, channels: output?.channels.length ?? null,
    selection: v.selection, band: v.band, cursor: v.cursor, markers: output?.markers ?? [], problem: state.problem || null,
    stats: output?.stats ? { peak: output.stats.peak, loudness: output.stats.loudness } : null,
    steps: stepsOf(ed.code).map(({ text, on }) => ({ call: text.slice(1), on }))
  }),
  async script({ code }) {
    if (typeof code !== 'string') throw new Error('script: code is the whole script, a string')
    if (code === ed.code) return { ok: true, duration: output?.duration ?? 0, unchanged: true }
    const done = ran()
    ed.change({ from: 0, to: ed.code.length, insert: code })
    return within(done)
  },
  async edit({ call }) {
    if (typeof call !== 'string' || !call.trim()) throw new Error('edit: call is one method call, e.g. "normalize(-16)"')
    const done = ran()
    if (!write(call.trim().replace(/^\./, ''))) throw new Error('Open or generate a sound first')
    return within(done)
  },
  // the caret, a range, or a box of a range and a band (on the spectrogram, which then shows), brought into sight as the
  // user's own would be
  select({ at, d, duration = d, cursor, low, high }) {
    const band = low != null && high != null && +high > +low ? [+low, +high] : null
    if (band && state.display !== 'spec') setDisplay('spec')
    if (cursor != null) { v.select(0, 0); v.setCursor(+cursor); v.reveal(v.cursor) }
    else if (at != null && duration != null) { v.select(+at, +at + +duration, band); v.reveal(...v.selection ?? [v.cursor]) }
    else v.select(0, 0)
    return { selection: v.selection, band: v.band, cursor: v.cursor }
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
  // state lists them)
  async step({ index, on, remove, to }) {
    const n = stepsOf(ed.code).length, s = stepsOf(ed.code)[index]
    if (!s) throw new Error(`No edit ${index}: state lists ${n}`)
    if (!remove && to == null && on == null) throw new Error('step: on, remove or to')
    if (!remove && to != null && (!(+to >= 0 && +to < n) || !s.on)) throw new Error(s.on ? `No place ${to} to move it to: there are ${n}` : `Edit ${index} is off: turn it on to move it`)
    if (!remove && (to != null ? +to === +index : !!on === s.on)) return { ok: true, unchanged: true }
    const change = remove ? dropStep(ed.code, index) : to != null ? moveStep(ed.code, index, +to) : on ? turnOn(ed.code, s.call) : turnOff(ed.code, s.call)
    if (!change) throw new Error(`Edit ${index} cannot be commented out: its text holds */`)
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
  // the output, or with `original` the file as it opened, level-matched (B)
  async play({ at, d, duration = d, original }) {
    if (original != null && !!original !== !!state.ab) await toggleAB()
    if (at != null) page.select({ at, duration: duration ?? Math.max(0, (output?.duration ?? 0) - at) })
    if (!pl.playing) await togglePlay()
    return { playing: pl.playing, original: !!state.ab }
  },
  // anything the library measures, on the output shown and its source, changing nothing (worker.js evaluate)
  async measure({ code }) {
    if (typeof code !== 'string' || !code.trim()) throw new Error('measure: code is JavaScript, its last expression the answer')
    const r = await eng.evaluate(prepare(code))
    if (r.error) throw new Error(r.error.line ? `line ${r.error.line}: ${r.error.message}` : r.error.message)
    return r.value ?? null
  },
  // the picture, the waveform over the spectrogram, of [at, at + d] or of what shows (view.js snapshot)
  look({ at, d, duration = d }) {
    if (!state.whole) throw new Error('Nothing drawn yet: open or generate a sound first')
    const a = at != null ? Math.max(0, +at) : null, range = a != null ? [a, duration != null ? a + +duration : output.duration] : null
    const [from, to] = range ?? v.range
    return { image: v.snapshot(range), text: `${stamp(from)} to ${stamp(to)}: the waveform, levels ${state.levels === 'db' ? 'in dB' : 'as sample values'}, over the spectrogram, frequencies in ${scaleNames[state.scale].toLowerCase()}` }
  },
  stop() { if (pl.playing) togglePlay(); return { playing: false } },
  async check({ spec }) { const r = await eng.check(spec); if (r.error) throw new Error(r.error.message); return r.output },
  async undo() { if (!ed.canUndo) return { ok: false, problem: 'Nothing to undo' }; const done = ran(); ed.undo(); return within(done) },
  async redo() { if (!ed.canRedo) return { ok: false, problem: 'Nothing to redo' }; const done = ran(); ed.redo(); return within(done) }
}
// The page's answers to the agent's last calls, by tool and arguments: what each came to, said beside its step (noted)
const answers = []
const answering = (tool, args, at, result, error) => { answers.push({ tool, key: JSON.stringify(args ?? {}), at, result, error }); answers.splice(0, answers.length - 32) }
const bridge = agent({
  tools: Object.fromEntries(Object.entries(page).map(([tool, f]) => [tool, async args => {
    const at = Date.now()
    try { const r = await f(args); answering(tool, args, at, r); return r } catch (e) { answering(tool, args, at, null, e.message); throw e }
  }])),
  // online, its agent as the bridge started with it ({ id, name }, or null where it found none)
  onstatus(status, hello) { state.agentStatus = status; if (hello) state.agentInfo = hello.agent },
  onchat: answer
})
function connectAgent() { store(); bridge.connect(state.bridgeUrl.trim(), state.bridgeKey.trim()) }
if (state.bridgeKey) connectAgent()

// The conversations are a tab's own, as its script and edits are, kept with it: { id, at, title, agent, session,
// messages }, the one open its `chatId` (null: a new one, begun by its first message), at most CHATS. A message is the
// user's { role, text }, or the agent's { role, parts, running, doing, since, started, pending, turn, error }: its
// words and its finished calls in the order they came ({ text } | { step, failed }), the calls running, what it does now.
// The agent's session goes on with a conversation where that agent began it; another agent, or one that lost it, is told
// what was said (bin/bridge.js)
const CHATS = 30
const chatsOf = d => d ? d.chats ??= [] : []
const docOf = () => docs.find(d => d.id === state.tab)
const conversation = (d = docOf()) => chatsOf(d).find(c => c.id === d.chatId) ?? null
// as kept: an answer the page closed on says so
const talks = d => d.chats?.length ? { chats: d.chats.map(c => ({ ...c, messages: c.messages.map(({ role, text, parts, error, pending }) => ({ role, ...text != null && { text }, ...parts && { parts }, ...(error || pending) && { error: error || 'Cut off: the page closed before the answer ended' } })) })), chat: d.chatId } : {}
// an agent's message as it shows, its words and calls in turn; its words alone, as told to an agent that did not hear them
function partsOf(m) { return m.role === 'user' ? [] : m.parts ?? (m.text ? [{ text: m.text }] : []) }
const wordsOf = m => m.role === 'user' ? m.text : partsOf(m).filter(p => p.text).map(p => p.text.trim()).join('\n\n')
// a time as a list of past things says it
const ago = t => { const s = (Date.now() - t) / 1000; return s < 60 ? 'now' : s < 3600 ? `${Math.floor(s / 60)} min ago` : s < 86400 ? `${Math.floor(s / 3600)} h ago` : new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) }
// What shows: the open conversation, whether its agent is answering; the tab's others, newest first
function showMessages(c) { state.chat = c?.messages ?? []; state.chatBusy = !!c?.messages.at(-1)?.pending }
function showChat() {
  const c = conversation()
  showMessages(c)
  state.chats = chatsOf(docOf()).toReversed().map(x => ({ id: x.id, title: x.title, when: ago(x.at), open: x === c }))
  following = true
}
function newChat() { const d = docOf(); if (d) d.chatId = null; showChat(); store(); root.querySelector('.chat-form textarea')?.focus() }
function openChat(id) { const d = docOf(); if (d) d.chatId = id; showChat(); store(); root.querySelector('#chats-menu')?.hidePopover() }
// A conversation deleted, its answer under way stopped; the open one, a new one in its place
function dropChat(id) {
  const d = docOf(), c = chatsOf(d).find(x => x.id === id), last = c?.messages.at(-1)
  if (!c) return
  if (last?.pending && last.turn) bridge.stop(last.turn)
  d.chats = d.chats.filter(x => x !== c)
  if (d.chatId === id) d.chatId = null
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
      const key = JSON.stringify(done.input ?? {}), a = answers.findLast(x => x.tool === done.tool && x.key === key && x.at > done.at - 250), note = a ? a.error ?? noted(done.tool, done.input, a.result) : ''
      parts = [...parts, { step: done.then, ...note && { note }, ...done.show && { show: done.show }, ...m.failed && { failed: true } }]
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
  const d = docOf(), open = conversation(d), last = open?.messages.at(-1), id = state.agentInfo?.id, text = state.chatText.trim()
  if (last?.pending) return last.turn && bridge.stop(last.turn)
  if (!text || !id || !d) return
  const c = open ?? { id: Date.now(), title: text.replace(/\s+/g, ' ').slice(0, 120), agent: id, session: null, messages: [] }
  if (!open) { chatsOf(d).push(c); d.chats.splice(0, d.chats.length - CHATS); d.chatId = c.id }
  const history = c.messages.map(m => ({ role: m.role, text: wordsOf(m) })).filter(m => m.text), session = c.agent === id ? c.session : null
  Object.assign(c, { agent: id, at: Date.now(), messages: [...c.messages, { role: 'user', text }, { role: 'agent', parts: [], running: [], doing: `Starting ${state.agentInfo.name}`, since: Date.now(), pending: true, turn: null, error: '' }] })
  state.chatText = ''
  showChat()
  store()
  try {
    const turn = await bridge.chat(text, session, history)
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
async function share() {
  const bytes = await new Response(new Blob([ed.code]).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer()
  const code = btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  history.replaceState(null, '', '#code=' + code)
  try { await navigator.clipboard.writeText(location.href); state.shared = true; setTimeout(() => state.shared = false, 1800) }
  catch { note('Copy the link from the address bar.') }
  // Samples and web addresses travel in the link; files opened here do not.
  const local = prepare(ed.code).names.filter(name => eng.has(name) && !builtins[name])
  if (local.length) note(`Link copied. ${local.join(', ')} ${local.length > 1 ? 'stay' : 'stays'} on this device: whoever opens the link opens ${local.length > 1 ? 'them' : 'it'} too.`)
}
// The documents as the page was left, each a tab, and the one shown; a link's script is shown, in a tab of its own
// unless one holds it already
async function initialDocs() {
  const list = stored.docs?.length ? stored.docs : [{ code: stored.code ?? DEFAULT }]
  let at = Math.max(0, Math.min(stored.doc ?? 0, list.length - 1))
  const hash = location.hash.match(/^#code=([\w-]+)/)?.[1]
  if (hash) try {
    const bytes = Uint8Array.from(atob(hash.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0))
    const code = await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).text()
    at = list.findIndex(d => d.code === code)
    if (at < 0) at = list.push({ code }) - 1
  } catch {}
  docs = list.map(({ code, frame, chats, chat }) => ({ id: ++docIds, code, frame, chats, chatId: chat ?? null }))
  return docs[at]
}

// Tabs over the picture, as an audio editor's open files: a script each, with its own history (the editor keeps it), its
// own steps (remember) and its last output, shown at once when it is (settle). A sound opened goes into a tab of its own,
// unless the tab shown is empty.
// each tab named by the sound its script opens (nameOf), the one shown as its script now reads; the others kept
function retitle() { state.tabs = docs.map(d => ({ id: d.id, name: d.id === state.tab ? nameOf(ed.code) : d.name ??= nameOf(d.code) })) }
function nameOf(code) { const s = source(code)?.strings; return s?.length ? s.map(x => label(x.name)).join(' + ') : chain(code) ? 'generated' : 'untitled' }
function switchTab(id) {
  if (id === state.tab || !docs.some(d => d.id === id)) return
  const was = docs.find(d => d.id === state.tab), next = docs.find(d => d.id === id)
  if (was) Object.assign(was, { code: ed.code, name: nameOf(ed.code), steps, depthWas, frame: was.frame ?? v.frame })
  ;({ steps = [], depthWas = 0 } = next)
  state.tab = id
  viewing = { delta: null, back: null }
  v.select(0, 0)
  v.setCursor(0)
  // its sound at once, as it was last shown (none for a new one), till its script runs again
  incoming = null
  settle(next.output ?? null)
  ed.open(id, next.code)
  rk?.refresh()
  retitle()
  showChat()
  store()
}
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
  const move = e => {
    const dx = e.clientX - x0
    if (!moved && Math.abs(dx) < 4) return
    moved = true
    el.classList.add('dragging')
    el.style.transform = `translateX(${dx}px)`
    // a neighbour gives way once the tab dragged covers half of it: its leading edge past the neighbour's middle
    const left = boxes[from].left + dx, right = boxes[from].right + dx
    to = from
    boxes.forEach((b, i) => { if (i > from && right > center(b)) to = Math.max(to, i); if (i < from && left < center(b)) to = Math.min(to, i) })
    tabs.forEach((t, i) => { if (i !== from) t.style.transform = i >= Math.min(from, to) && i <= Math.max(from, to) ? `translateX(${to > from ? -step : step}px)` : '' })
  }
  const up = () => {
    removeEventListener('pointermove', move); removeEventListener('pointerup', up); removeEventListener('pointercancel', up)
    if (!moved) return
    // laid out in the new order at once, nothing sliding back to where it was
    for (const t of tabs) { t.style.transition = 'none'; t.style.transform = ''; t.classList.remove('dragging') }
    if (to !== from) { docs.splice(to, 0, docs.splice(from, 1)[0]); retitle(); store() }
    requestAnimationFrame(() => requestAnimationFrame(() => { for (const t of tabs) t.style.transition = '' }))
  }
  addEventListener('pointermove', move)
  addEventListener('pointerup', up)
  addEventListener('pointercancel', up)
}
// Closing the last tab leaves an empty one; closing the one shown shows its neighbour
function closeTab(id = state.tab) {
  const i = docs.findIndex(d => d.id === id)
  if (i < 0) return
  if (docs.length > 1 && id === state.tab) switchTab(docs[i + 1]?.id ?? docs[i - 1].id)
  else if (docs.length === 1) newTab()
  docs.splice(i, 1)
  ed.close(id)
  retitle()
  store()
}


// Files dropped anywhere. Capturing, so the editor never reads audio as text.
// Held over the picture with a sound in it, a file goes in where the caret it shows is; over the tabs, into a tab of its
// own; over the script, where the text caret is; elsewhere, it opens. What it would do shows as it is held (`dropping`).
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
  const inEditor = event.target.closest('.script-editor'), at = inEditor ? ed.view.posAtCoords({ x: event.clientX, y: event.clientY }) : null
  if (how === 'tab') newTab()
  openFiles([...event.dataTransfer.files], inEditor && at != null ? 'at' : how === 'insert' && t != null ? 'insert' : 'new', inEditor ? at : t)
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
  else if (event.key === ' ' && !typing && !event.target.closest('button, a')) { event.preventDefault(); state.recording ? stopRecording() : togglePlay() }
  else if (mod && event.key.toLowerCase() === 's') { event.preventDefault(); exportFiles() }
  else if (mod && event.key.toLowerCase() === 'o') { event.preventDefault(); pickFiles() }
  else if (mod && !event.shiftKey && (event.key.toLowerCase() === 'k' || event.key.toLowerCase() === 'p')) { event.preventDefault(); openTools() }
})
// Buttons around the picture act without taking focus: Space stays play, and the picture or the script keeps its keys
root.addEventListener('mousedown', event => { if (event.target.closest('.status button, .tabs button, .history button, .panel-head button, .files button, .add-step, .viewing')) event.preventDefault() })
// The first touch of the page opens the audio device, so the first play starts at once
for (const type of ['pointerdown', 'keydown']) addEventListener(type, () => pl.warm(), { capture: true, once: true })
addEventListener('pagehide', () => { store(); pl.close(); recorder?.cancel() })

evaluate()
