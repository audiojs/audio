import sprae from '../assets/sprae.js'
import engine from './engine.js'
import editor from './editor.js'
import view from './view.js'
import player from './player.js'
import stack from './stack.js'
import { mark as drawMark } from '../logo/mark.js'
import recipes from './recipes.js'
import { ops, methods, guides, previews, GROUPS, CURVES, icons as groupIcons } from './ops.js'
import { prepare, error, append, source, chain, number, rollback, residual, setArg } from './code.js'
import { builtins, sample, record, search, credit, unique } from './sources.js'
import scales from './scale.js'
import menubar from './menu.js'
import { levels, spectra, cycle, trace } from './meters.js'
import time, { UNITS } from './time.js'

// The REPL: its output, and at its right a panel that opens and closes, as Luminar's: the tools, every method by kind,
// one click adding it; the edits, the chain that makes the output as a stack of steps; the same chain as code; and the
// export, the output checked against a spec and saved as a file. Every change to the script runs it; the output is drawn,
// measured and played. Selecting, cutting or applying a method on the waveform, or a slider in the stack, writes the
// script.
const root = document.querySelector('#repl')
const DEFAULT = `audio('chime.wav')
  .trim()
  .normalize(-1)
  .fade(0.02, 0.1)`
const generators = [
  ['Tone', '440 Hz, any function of time', `audio.from(t => 0.5 * Math.sin(2 * Math.PI * 440 * t), { duration: 2 })`],
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
const mime = { wav: 'audio/wav', flac: 'audio/flac', mp3: 'audio/mpeg', ogg: 'audio/ogg', aiff: 'audio/aiff', m4a: 'audio/mp4' }
const icons = {
  cut: 'M8.1 8.1 21 21M8.1 15.9 21 3M9 6a3 3 0 1 1-6 0 3 3 0 0 1 6 0m0 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0',
  copy: 'M8 8h13v13H8zM16 8V3H3v13h5',
  paste: 'M8 5H3v16h18V5h-5M8 3h8v4H8z',
  remove: 'M7 4H4v16h3M17 4h3v16h-3M8 12h8',
  crop: 'M7 2v13a2 2 0 0 0 2 2h13M2 7h13a2 2 0 0 1 2 2v13',
  repair: 'm4 14 6 6 10-10-6-6ZM9 11l1 1m2-2 1 1m-2 3 1 1m2-2 1 1'
}
// What the picture shows besides the sound, each a thing to grab where it is, none a mode: the hits (its onsets, on the
// time row: a click puts the caret on one, a drag moves it and the audio around it stretches), the pitch curve (a voiced
// stretch drags up or down), the gain line (its points drag; a press on the line adds one), the meters at the right
const overlays = [['hits', 'Hits', 'The hits found: cues to snap to, slice at, and drag'], ['pitch', 'Pitch curve', 'A voice\'s pitch, its voiced stretches dragged up or down'], ['gain', 'Gain line', 'The gain curve, its points dragged'], ['meters', 'Meters', 'Level and spectrum at the right']]
// How the waveform's level axis writes levels: decibels from full scale, mirrored about the centre line, or the sample
// values themselves, signed
const levelList = [['db', 'Decibels', '−6dB', 'dB'], ['linear', 'Sample values', '0.5', '±1']].map(([name, label, example, short]) => ({ name, label, example, short }))
// The frequency scales the view settings choose between (scale.js)
const scaleNames = { log: 'Octaves', mel: 'Mel', lin: 'Hertz' }
// A fade's curves, as fn/fade.js names them, each drawn as it fades in (ops.js CURVES), as its handle on the picture draws it
const curves = [['linear', 'Linear'], ['exp', 'Exponential'], ['log', 'Logarithmic'], ['cos', 'S-curve']]
  .map(([name, label]) => ({ name, label, icon: 'M' + Array.from({ length: 13 }, (_, i) => `${4 + 16 * i / 12} ${+(20 - 16 * CURVES[name](i / 12)).toFixed(2)}`).join('L') }))
// What the picture shows, a tab each: the waveform, or the spectrogram, never both (each zooms its own way)
const displays = [['wave', 'Waveform', 'The waveform: levels over time', 'M4 10v4m4-8v12m4-15v18m4-14v10m4-6v2'], ['spec', 'Spectrogram', 'The spectrogram: frequencies over time', 'M4 5h16M4 9.5h10M4 14h13M4 18.5h6']].map(([name, label, title, icon]) => ({ name, label, title, icon }))
// Rates a sound resamples to, from the facts on the display
const rates = [[8000, 'Telephone'], [11025, ''], [16000, 'Speech'], [22050, ''], [32000, ''], [44100, 'CD'], [48000, 'Video'], [88200, ''], [96000, 'High resolution']]
  .map(([hz, text]) => ({ hz, label: `${+(hz / 1000).toFixed(3)}kHz`, text }))
// Delivery specs the output can be checked against (fn/check.js holds their rules and sources)
const specs = [['', 'Off', ''], ['podcast', 'Apple Podcasts', 'Apple'], ['streaming', 'Spotify', 'Spotify'], ['broadcast', 'EBU R 128', 'R 128'], ['acx', 'ACX audiobook', 'ACX'], ['netflix', 'Netflix', 'Netflix']]
  .map(([key, label, short]) => ({ key, label, short }))

// Stored per browser: the script and how the page was left.
const stored = (() => { try { return JSON.parse(localStorage.getItem('audio-repl')) || {} } catch { return {} } })()
const store = () => { try { localStorage.setItem('audio-repl', JSON.stringify({ docs: docs.map(d => ({ code: d.id === state.tab ? ed.code : d.code })), doc: docs.findIndex(d => d.id === state.tab), display: state.display, scale: state.scale, format: state.format, spec: state.spec, side: state.side, show: state.show, units: state.units, snap: state.snapping, curve: state.fadeCurve, levels: state.levels })) } catch {} }

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
// shows the same, in a hidden tab too.
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
// while the engine works it sways gently, the same whether a file arrives or an output renders
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
    work: { signal: 'sine', cycles: 1, speed: .25, hold: false, hover: 'none', amplitude: .45, axis: 0, hidden: true },
    rest: { signal: 'sine', cycles: 1, speed: 0, hold: false, hover: 'mimic', amplitude: 1, axis: 0, hidden: false },
  }[mode])
}

// the panel's tabs; one stored under a name it no longer has opens on the edits, and a closed panel stays closed
const sides = ['tools', 'edits', 'code', 'export'], sideOf = name => name == null ? null : sides.includes(name) ? name : 'edits'

const state = sprae(root, {
  format: stored.format || 'wav', snapping: stored.snap ?? true, fadeCurve: stored.curve || 'linear', curves,
  scaleList: Object.entries(scales).map(([name, sc]) => ({ name, label: scaleNames[name], text: sc.text })),
  overlayList: overlays.map(([name, label, title]) => ({ name, label, title })),
  unitList: UNITS.map(([name, label, example, short]) => ({ name, label, example, short })), levelList, levels: stored.levels === 'linear' ? 'linear' : 'db',
  display: stored.display === 'spec' ? 'spec' : 'wave', scale: stored.scale || 'log', displays, rates, sound: null, viewing: '',
  show: { hits: true, pitch: false, gain: true, meters: true, ...stored.show }, units: stored.units || 'clock',
  side: 'side' in stored ? sideOf(stored.side) : 'edits', bar: null, stepCount: 0,
  tabs: [], tab: 0, name: 'untitled', length: '', hasOutput: false, whole: false, ran: false, problem: '', notice: '', noticeKind: '', dropping: false,
  progress: '', loading: false, slow: false, lines: [], saves: [], exporting: false, shared: false, canUndo: false, canRedo: false,
  time: '0:00.000', readout: '', selection: null, band: null, ranges: 0, carets: 1, pauses: false, canPaste: false, playing: false, loop: false, recording: null,
  specs, spec: stored.spec || '', report: null, checking: false, ab: false, abGain: 0, canCompare: false,
  query: '', results: [], searching: false, searchState: '', previewing: -1,
  toolQuery: '', samples: Object.entries(builtins).map(([name, text]) => ({ name, text })), generators, formats, clock,
  get recipeGroups() { return [...new Set(recipes.map(r => r.group))].map(name => ({ name, items: recipes.filter(r => r.group === name) })) },
  // The tools: every method, by kind, its group's icon beside it; the words typed find them by name or by what they do
  get toolGroups() {
    const q = this.toolQuery.trim().toLowerCase()
    return GROUPS.map(name => ({ name, icon: groupIcons[name], items: Object.values(ops).filter(op => op.group === name && (!q || op.name.includes(q) || op.text.toLowerCase().includes(q)))
      .map(op => ({ ...op, label: op.name[0].toUpperCase() + op.name.slice(1) })) })).filter(g => g.items.length)
  },
  // what a tool acts on: the selection, each range, or all of it
  get toolTarget() { return this.band ? 'The band selected: the tools act on its time range' : this.ranges > 1 ? `Each of the ${this.ranges} ranges selected` : this.selection ? `The selection, ${stamp(this.selection[0])}–${stamp(this.selection[1])}` : 'All of it; select a range to act on that alone' },
  // Edits for what is selected, in a bar under it: a time range, a band of it on the spectrogram, or at the caret a paste
  get edits() {
    const t = (type, label, keys, icon = type) => ({ type, label, keys, icon: icons[icon] }), level = (type, label, text) => ({ type, label, text })
    if (this.band) return [t('remove', 'Remove this band', '⌫'), level('quieter', 'This band 6 dB quieter', '−6dB'), level('louder', 'This band 6 dB louder', '+6dB'), t('repair', 'Rebuild this band from its surroundings')]
    // several ranges: what acts on each alike; pauses, each shortened
    if (this.ranges > 1) return [t('remove', `Delete all ${this.ranges}`, '⌫'), level('quieter', `Each 3 dB quieter`, '−3dB'), level('louder', `Each 3 dB louder`, '+3dB'), ...(this.pauses ? [level('shorten', 'Shorten each pause to a quarter second', 'Shorten')] : []), level('denoise', `The noise alone in all ${this.ranges}: learned there, taken 12 dB down everywhere`, 'Denoise')]
    if (this.selection) return [t('cut', 'Cut', '⌘X'), t('copy', 'Copy', '⌘C'), t('remove', 'Delete', '⌫'), t('crop', 'Keep only this'), level('quieter', '3 dB quieter, eased in and out over 5 ms', '−3dB'), level('louder', '3 dB louder, eased in and out over 5 ms', '+3dB'), level('denoise', 'The noise alone: learned here, taken 12 dB down everywhere', 'Denoise')]
    // several carets: a paste at each, a marker at each
    if (this.carets > 1) return [...(this.canPaste ? [t('paste', `Paste at all ${this.carets}`, '⌘V')] : []), level('mark', `A marker at each of the ${this.carets} carets`, 'Mark each')]
    return this.canPaste ? [t('paste', 'Paste at the cursor', '⌘V')] : []
  },
  // The check, rule by rule, in the panel's Export tab: each rule, the output's value and mark, its limit
  get checkRows() {
    return (this.report?.rules || []).map(r => ({ name: r.name, unit: r.unit, limit: limit(r), note: r.note || '', after: value(r.value), afterMark: mark(r.pass), afterClass: verdict(r.pass) }))
  },
  setSpec(key) { state.spec = key; store(); scheduleCheck(0) },
  toggleAB,
  // The clock: the playhead, the caret, or a selection's start–end, and under it how long that is (several ranges: how
  // many, and how long in all), in the units the view settings choose
  get timeText() {
    const sel = this.selection
    if (this.playing || this.recording || !sel) return this.time
    return `${stamp(sel[0])}–${stamp(sel[1])}`
  },
  get spanText() {
    if (this.playing || this.recording || !this.selection) return ''
    return this.ranges > 1 ? `${this.ranges} ranges, ${clock(v.ranges.reduce((n, [p, q]) => n + q - p, 0))} in all` : clock(this.selection[1] - this.selection[0])
  },
  get timeTitle() {
    const what = this.playing ? 'Playhead' : this.selection ? 'Selection: its start, its end, and how long it is' : 'Caret'
    return `${what}, in ${UNITS.find(u => u[0] === this.units)[1].toLowerCase()} (the view settings)`
  },
  get plotHelp() {
    return `${this.display === 'spec' ? 'Spectrogram' : 'Waveform'}. Click to put the caret and hear the moment there, Alt-click for another caret; drag to select a time range, or on the spectrogram a time and frequency box, Shift keeping it to one axis; a dragged edge or caret snaps to the cues; double-click selects between the cues around it, triple-click a phrase. Drag a selection to move its audio, Alt-drag to copy it over; its top corners fade it (a click, the fade's curve), the pill on its top edge sets its level (on the spectrogram its pitch), the grip in its bottom right corner stretches it. The wheel scrolls; a pinch, or Ctrl and the wheel, zooms the frequencies or the levels over them and time elsewhere.`
  },
  setSide(name) { state.side = name; store() },
  toggleSide() { state.side = state.side ? null : 'edits'; store() },
  // the output as the whole chain makes it, from what a step takes out or the chain rolled back
  showAll: () => rk.choose(null), discard: () => rk.discard(),
  setFormat(name) { state.format = name; store() },
  // the checks and the file, in the panel
  openExport() { state.side = 'export'; store() },
  setScale(name) { state.scale = v.scale = name; store() },
  toggleSnap() { state.snapping = v.snapping = !state.snapping; store() },
  setCurve, toggleShow, setUnits, setLevels,
  setDisplay, toggleLoop, undoList, goTo, toggleRecording, resampleTo, remixTo,
  togglePlay, playPress, playClick, stop: () => eng.stop(), undo: () => ed.undo(), redo: () => ed.redo(), mac, share, exportFiles,
  switchTab, newTab, closeTab, pickFiles, openFiles, startRecording, stopRecording, useSample, useCode, useRecipe, addOp, editSelection, toolKey, openTools,
  openSearch, closeSearch, runSearch, typeSearch, preview, useResult
})

// The script editor, on the document shown
const first = await initialDocs()
ed = editor(root.querySelector('.editor'), {
  doc: first.code,
  onchange(code, update) {
    const slider = !!update?.transactions.some(tr => tr.isUserEvent('input.slider'))
    state.canUndo = ed.canUndo
    state.canRedo = ed.canRedo
    remember(code, slider)
    retitle()
    v.envelope = envelopeOf(code)
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
  onselect(selection, band, ranges = []) {
    state.selection = selection
    // the caret goes to the selection's start (view.js); once the selection is gone the clock and play start there
    if (selection && !pl.playing) { state.time = stamp(selection[0]); pl.seek(selection[0]) }
    state.band = band
    state.ranges = ranges.length
    state.carets = v?.carets.length ?? 1
    // every range a pause of the output (its silences, worker.js), give or take a pause's block
    state.pauses = ranges.length > 1 && ranges.every(([a, b]) => output?.segments?.silences.some(([p, q]) => Math.abs(p - a) < .03 && Math.abs(q - b) < .03))
    describe()
    meter()
  },
  // the caret put elsewhere while it plays: playback goes there, over what is selected now (all of it, if nothing)
  oncursor(t) { if (pl.playing) pl.play(plays(t)); else { state.time = stamp(t); meter(); pl.seek(t) } },
  // an edit made on the picture: true once it is written in the script
  onedit(type, detail) { const act = { warp, envelope, pitch: shift, carry, stretch, lift, fade, unmark, remark }[type]; return !!(act ? act(detail, type) : editSelection(type, detail)) },
  // a fade's corner clicked: the curves it can take, where it is
  oncurve({ x, y }) { const menu = root.querySelector('#fade-menu'); Object.assign(menu.style, { left: `${x}px`, top: `${y + 6}px` }); menu.showPopover() },
  onscrub,
  onbox: follow
})
v.display = state.display
v.scale = state.scale
v.units = state.units
v.levels = state.levels
v.show = state.show
v.snapping = state.snapping
v.fadeCurve = state.fadeCurve
v.envelope = envelopeOf(ed.code)

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
  onsteps(n) { state.stepCount = n },
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
  const edit = (label, type, key, when) => ({ label, keys: key && keys(key), run: () => editSelection(type), disabled: !when })
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
      edit('Keep only the selection', 'crop', '', sel && !band),
      '-',
      edit(band ? '6 dB quieter' : '3 dB quieter', 'quieter', '', sel),
      edit(band ? '6 dB louder' : '3 dB louder', 'louder', '', sel),
      edit('Rebuild the band from around it', 'repair', '', band),
      edit('Take this noise out everywhere', 'denoise', '', sel && !band),
      { label: sel ? 'Apply a tool to the selection…' : 'Add a tool…', run: () => openTools(), disabled: none },
      '-',
      { label: 'Add a marker', keys: 'M', run: addMarker, disabled: none },
      { label: 'A double-click on a marker takes it away', disabled: true }
    ] },
    { name: 'Select', title: 'All, none, a sound or a phrase; the caret by sounds and phrases', items: [
      { label: 'All', keys: keys('⌘A'), run: () => v.select(0, v.duration), disabled: none },
      { label: 'None', keys: 'Esc', run: () => v.select(0, 0), disabled: !sel },
      '-',
      { label: 'The sound at the caret', keys: 'double-click', run: () => v.around?.('sound'), disabled: none },
      { label: 'The phrase at the caret', keys: 'triple-click', run: () => v.around?.('phrase'), disabled: none },
      { label: 'The next one like it, too', keys: keys('⌘D'), run: () => v.addNext(), disabled: !sel || !!band },
      { label: 'Another range: Alt and drag', disabled: true },
      '-',
      { label: 'Caret to the next sound', keys: keys('⌥→'), run: () => v.step?.('sound', 1), disabled: none },
      { label: 'Caret to the sound before', keys: keys('⌥←'), run: () => v.step?.('sound', -1), disabled: none },
      { label: 'Caret to the next phrase', keys: keys('⌘→'), run: () => v.step?.('phrase', 1), disabled: none },
      { label: 'Caret to the phrase before', keys: keys('⌘←'), run: () => v.step?.('phrase', -1), disabled: none },
      { label: 'Caret to the start', keys: 'Home', run: () => v.setCursor(0), disabled: none },
      { label: 'Caret to the end', keys: 'End', run: () => v.setCursor(v.duration), disabled: none },
      '-',
      { label: 'Shift with any of these extends the selection', disabled: true }
    ] },
    { name: 'View', title: 'Waveform and spectrogram, what shows on them; zoom; panels; units', items: [
      ...displays.map(d => check(d.label, state.display === d.name, () => setDisplay(d.name))),
      { label: 'Frequency scale', items: Object.entries(scales).map(([name, sc]) => check(scaleNames[name], state.scale === name, () => state.setScale(name), { hint: sc.text })) },
      '-',
      ...overlays.map(([name, label]) => check(label, state.show[name], () => toggleShow(name))),
      check('Snap to cues and markers', state.snapping, () => state.toggleSnap()),
      '-',
      { label: 'Zoom in', keys: '=', run: () => v.zoom(.5), disabled: none },
      { label: 'Zoom out', keys: '−', run: () => v.zoom(2), disabled: none },
      { label: 'Zoom to the selection', run: () => v.zoomTo(...sel), disabled: !sel },
      { label: 'Show all of it', keys: '0', run: () => v.fit(), disabled: none },
      '-',
      check('The panel', !!state.side, () => state.toggleSide()),
      check('Its tools', state.side === 'tools', () => state.setSide('tools')),
      check('Its edits', state.side === 'edits', () => state.setSide('edits')),
      check('Its code', state.side === 'code', () => state.setSide('code')),
      check('Its export', state.side === 'export', () => state.setSide('export')),
      { label: 'Times in', items: UNITS.map(([name, label, example]) => check(label, state.units === name, () => setUnits(name), { hint: example })) },
      { label: 'Levels in', items: levelList.map(l => check(l.label, state.levels === l.name, () => setLevels(l.name), { hint: l.example })) },
      '-',
      { label: 'Reset the view', run: resetView }
    ] },
    { name: 'Process', title: 'Every method by kind, for the output or the selection', items: [
      ...GROUPS.map(group => ({ label: group, items: Object.values(ops).filter(op => op.group === group).map(op => ({ label: op.name, hint: op.text, run: () => addOp(op.name) })), disabled: none })),
      '-',
      { label: 'Find a tool…', run: () => openTools(), disabled: none }
    ] },
    { name: 'Play', title: 'Play, loop, hear it before the edits; delivery checks', items: [
      { label: state.playing ? 'Pause' : sel ? 'Play the selection' : 'Play from the caret', keys: 'Space', run: togglePlay, disabled: !whole },
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
menubar(root.querySelector('.menubar'), menus)
// the keys in the help as this platform names them
for (const dt of root.querySelectorAll('.help-list dt')) dt.textContent = keys(dt.textContent)
// The tools, from a menu or the bar of edits: the panel opens on them, the words to find one in hand
function openTools() {
  closeMenus()
  state.side = 'tools'
  store()
  requestAnimationFrame(() => root.querySelector('.tool-search')?.focus())
}
function resetView() {
  v.fit()
  state.display = v.display = 'wave'
  state.show = { hits: true, pitch: false, gain: true, meters: true }
  setUnits('clock')
  setLevels('db')
  marks()
  store()
}

// The bar of edits follows what is selected, centred under it and kept inside the picture: under a range (it spans
// the lanes, so the bar sits at their foot, clear of the grip that stretches it), under a box on the spectrogram or
// over it where there is no room, at the caret for a paste. None while a drag goes on.
function follow(box) {
  if (!box) { state.bar = null; return }
  const edits = root.querySelector('.edits'), plot = root.querySelector('.plot'), w = edits.offsetWidth || 240, h = edits.offsetHeight || 36
  const x = Math.max(w / 2 + 4, Math.min(box.width - w / 2 - 4, (box.x0 + box.x1) / 2))
  const y = box.band ? (box.y1 + 6 + h <= box.height ? box.y1 + 6 : Math.max(4, box.y0 - 6 - h)) : box.y1 - h - 22
  state.bar = { x: Math.round(x), y: Math.round(Math.min(y, plot.clientHeight - h - 4)) }
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
  if (syntax) return
  const doc = ed.view.state.doc
  ed.errors(e?.line && e.line <= doc.lines ? [{ from: doc.line(e.line).from, to: doc.line(e.line).to, message: e.message }] : [])
  state.canPaste = !!chain(ed.code)?.calls.some(c => c.name === 'copy' || c.name === 'cut')
  // an edit drawn ahead of its output that failed: the picture goes back to the output there is
  if (e) { v.expect(null); if (!state.hasOutput) entitle(names, false); return }
  // exports follow the output the page shows: the last run that succeeded
  state.saves = result.saves || []
  entitle(names, !!result.output || state.hasOutput)
  if (result.output) { coming.id = result.id; incoming = coming; state.loading = !state.hasOutput; return }
  incoming = null
  state.loading = false
  settle(null)
}

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
    if (!a.preview && state.hasOutput && !fresh(names)) return status()
    if (!a.preview) {
      a.preview = true
      showing = 0
      v.stream({ sampleRate: m.sampleRate, channels: m.channels.length, total: m.estimate ? Math.round(m.estimate * m.sampleRate) : null, dim: true })
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
    else if (a.preview || !state.hasOutput || performance.now() - a.started > 150) begin(a)
    status()
  }
  a.done = m => {
    if (!current()) return
    incoming = null
    const length = Math.round(m.duration * m.sampleRate)
    const channels = Array.from({ length: m.channels }, (_, c) => {
      const x = new Float32Array(length)
      for (const p of a.parts) x.set(p.channels[c].subarray(0, Math.max(0, length - p.at)), p.at)
      return x
    })
    a.parts = []
    if (a.on) v.finish()
    settle({ id: a.id, names, channels, sampleRate: m.sampleRate, duration: m.duration, stats: m.stats, segments: m.segments, markers: m.markers, bitDepth: m.bitDepth, code: a.code, editor: a.editor }, !a.on)
    status()
  }
  a.error = m => {
    if (!current()) return
    incoming = null
    state.problem = m.error.message
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
// The view shows an output as it arrives; the player has what has come
function begin(a) {
  a.on = true
  a.preview = false
  showing = a.id
  v.stream({ sampleRate: a.sampleRate, channels: a.channels, total: a.total })
  for (const p of a.parts) v.append(p.channels)
  state.hasOutput = true
  state.loading = false
}
// A whole output (or none) becomes the page's: drawn (unless it was drawn as it came), played, measured
function settle(out, draw = true) {
  output = out
  const has = !!out?.duration
  showing = has ? out.id : 0
  state.hasOutput = has
  state.whole = has
  state.loading = false
  if (draw) v.set(has ? out.channels : [], out?.sampleRate)
  v.segments = out?.segments
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
  else if (a && now - a.last > 400) { text = 'Rendering…'; since = a.last }
  state.progress = text && since != null && now - since > 1000 ? `${text} ${((now - since) / 1000).toFixed(1)}s` : text
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
  document.title = `${state.name === 'untitled' ? '' : state.name + ' · '}audio repl`
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

// What the picture shows besides the sound, as the View menu says: the hits, the pitch curve, the gain line, meters.
async function marks() {
  v.show = state.show
  if (!state.whole) return
  // the cues whether they show or not: a double-click selects between them, ⌥ and the arrows step by them. They are the
  // hits of the output shown, read against the code that made it; once the code has moved on (a cue dragged), the
  // output coming brings its own, and the cues the view moved stay till then
  const out = output, times = await eng.onsets(out.id)
  if (times && out === output && out.editor === ed.code) v.cues = cuesOf(times, out.code)
  if (state.show.pitch) { const f0 = await eng.contour(out.id); if (out === output) v.contour = f0 }
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
function setDisplay(name) {
  state.display = v.display = name
  store()
}

// What the output is, at the status bar's right: its levels (the output's peak and loudness, the selection's peak and
// RMS, or the band selected), then its rate, channels and depth, a click away from resampling and remixing.
const hertz = f => f >= 1000 ? `${+(f / 1000).toFixed(2)}kHz` : `${Math.round(f)}Hz`
function describe() {
  state.sound = null
  if (!output?.duration) { state.readout = ''; return }
  const { sampleRate, channels, stats, bitDepth } = output, k = channels.length
  state.sound = { hz: sampleRate, rate: `${+(sampleRate / 1000).toFixed(3)}kHz`, count: k, channels: k === 1 ? 'mono' : k === 2 ? 'stereo' : `${k} ch`, depth: bitDepth ? `${bitDepth}-bit` : '' }
  const sel = state.selection
  if (!sel) { state.readout = [`peak ${dbfs(stats.peak)}dBFS`, Number.isFinite(stats.loudness) ? `${dbfs(stats.loudness)}LUFS` : ''].filter(Boolean).join(' · '); return }
  const [a, b] = sel, rate = output.sampleRate, from = Math.floor(a * rate), to = Math.ceil(b * rate)
  let peak = 0, sum = 0, n = 0
  for (const ch of output.channels) for (let i = from; i < to && i < ch.length; i++) { const x = ch[i]; sum += x * x; n++; if (Math.abs(x) > peak) peak = Math.abs(x) }
  state.readout = state.band ? `${hertz(state.band[0])}–${hertz(state.band[1])}` : `peak ${dbfs(20 * Math.log10(peak))}dB · RMS ${dbfs(10 * Math.log10(sum / Math.max(1, n)))}dB`
}
function setUnits(name) {
  state.units = v.units = name
  state.time = stamp(pl.playing ? pl.time : v.cursor)
  describe()
  store()
}
function setLevels(name) { state.levels = v.levels = name; store() }
function toggleLoop() { state.loop = !state.loop; pl.loop = state.loop }
// The sound's rate or channels changed from the display: the chain's last resample() or remix() set again, else one
// added at its end
function resampleTo(hz) { closeMenus(); retune('resample', hz, output?.sampleRate) }
function remixTo(n) { closeMenus(); retune('remix', n, output?.channels.length) }
function retune(name, value, now) {
  const last = lastEdit(ed.code, name), arg = last?.call.args[0]
  if (arg?.kind === 'number') return ed.change({ from: arg.from, to: arg.to, insert: String(value) })
  if (value !== now) write(`${name}(${value})`)
}
function toggleRecording() { state.recording ? stopRecording() : startRecording() }

// History: the script after each step it took, named by what changed (said), for the list under Undo. Typing merged
// into a step changes it in place; a slider's step is taken where it comes to rest.
function remember(code, sliding) {
  const [back, ahead] = ed.depth
  if (sliding && back === depthWas) return
  depthWas = back
  if (steps[back]?.code !== code) steps[back] = { code, label: back ? said(steps[back - 1]?.code ?? '', code) : 'The script as it opened' }
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
const verbs = { remove: 'Delete', cut: 'Cut', copy: 'Copy', paste: 'Paste', crop: 'Keep only', gain: 'Level', spectral: 'Band level', repair: 'Rebuild', stretch: 'Stretch', pitch: 'Pitch', warp: 'Move a hit', fade: 'Fade' }
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
const plays = (at = v.cursor) => v.selection ? { from: v.selection[0], to: v.selection[1], loop: state.loop, band: v.band } : { from: 0, loop: state.loop, start: at >= v.duration ? 0 : at }
// Play answers the press, as a transport key does, not the release; a key or a script clicking it (detail 0) still works
function playPress(event) { if (event.button === 0) togglePlay() }
function playClick(event) { if (!event.detail) togglePlay() }
async function togglePlay() {
  if (!state.whole) return
  if (pl.playing) {
    pl.pause()
    cancelAnimationFrame(ticker)
    state.playing = false
    v.playhead = null
    v.setCursor(pl.time)
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
    return !!write(at.sort((p, q) => q - p).map(t => `paste(${number(t, v.unit)})`).join('.'))
  }
  // an op that learns from the selection takes it whole, every range
  if (ops[type]?.params?.some(s => s.selection)) return addOp(type)
  const all = Array.isArray(range?.[0]) ? range : !v.band && v.ranges.length > 1 ? v.ranges : null
  if (all?.length > 1) return editRanges(type, all)
  if (all) range = all[0]
  if (!range) return
  if (type === 'quieter' || type === 'louder') return v.band ? bandLevel(type === 'louder' ? 1 : -1, range) : level(type === 'louder' ? 3 : -3, range)
  const [a, b] = range, s = t => number(t, v.unit), span = `{ at: ${s(a)}, duration: ${s(b - a)} }`, band = v.band
  const hz = band && `[${band.map(f => Math.round(f)).join(', ')}]`
  const call = band ? { remove: `spectral(${hz}, ${span})`, repair: `repair(${hz}, ${span})` }[type]
    : `${type}(${span})`
  if (!call || !write(call)) return false
  if (band) return true
  // what the edit leaves, drawn at once from the picture there is, until its output comes
  if (type === 'remove' || type === 'cut' || type === 'crop') v.expect(type, range)
  v.select(0, 0)
  v.setCursor(type === 'crop' ? 0 : a)
  return true
}

// Several ranges at once, each alike, in one step: taken out from the last back, so each time holds for the ones before
// it; each louder or quieter on the one gain curve; each pause shortened to a quarter second (shrink keeps its first)
function editRanges(type, list) {
  const s = t => number(t, v.unit), back = [...list].sort((p, q) => q[0] - p[0])
  if (type === 'quieter' || type === 'louder') return level(type === 'louder' ? 3 : -3, list)
  const calls = type === 'remove' ? back.map(([a, b]) => `remove({ at: ${s(a)}, duration: ${s(b - a)} })`)
    : type === 'shorten' ? back.map(([a, b]) => `shrink(0.25, { at: ${s(a)}, duration: ${s(b - a)} })`) : null
  if (!calls || !write(calls.join('.'))) return false
  if (type === 'remove') v.expect('remove', list)
  v.select(0, 0)
  v.setCursor(list[0][0])
  return true
}

// The chain's last edit, before a closing save() or play(), when it is `name`.
function lastEdit(code, name) {
  const calls = chain(code)?.calls.filter(k => !methods[k.name]?.sink) || [], call = calls.at(-1)
  return call?.name === name ? { call, before: calls.at(-2)?.to ?? chain(code).root.to } : null
}
const pair = ([s, d]) => `[${number(s)}, ${number(d)}]`
const markersOf = last => Array.isArray(last?.call.args[0]?.value) ? last.call.args[0].value.map(p => [...p]) : []
// Cues: the hits found in the output, the last warp()'s markers standing in for those they placed, so a cue dragged
// again is the marker it made, not a hit found near it. A hit at the very start is the start, which warp() holds.
function cuesOf(onsets, code) {
  const placed = markersOf(lastEdit(code, 'warp')).map(p => p[1])
  return [...onsets.filter(t => t > 0 && !placed.some(d => Math.abs(d - t) < .03)), ...placed].sort((a, b) => a - b)
}

// A cue dragged from `from` to `to` between its neighbours: one warp() call, updated as cues keep moving. Its markers
// are in the timeline before it; times on the page are after it, so they go back through its map first.
function warp({ from, to, prev, next }) {
  const code = ed.code, last = lastEdit(code, 'warp'), T = v.duration
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

// A selection's audio dragged elsewhere: cut and pasted where it lands, the rest closing up behind it; with Alt, a
// copy of it over what is there. One step, so one undo.
function carry({ at, duration, to, copy }) {
  const s = t => number(t, v.unit), span = `{ at: ${s(at)}, duration: ${s(duration)} }`
  return write(copy ? `copy(${span}).remove({ at: ${s(to)}, duration: ${s(duration)} }).paste(${s(to)})` : `cut(${span}).paste(${s(to)})`)
}
// A selection stretched from its end, pitch kept; what follows moves with it
function stretch({ at, duration, factor }) {
  return write(`stretch(${number(factor, .001)}, { at: ${number(at, v.unit)}, duration: ${number(duration, v.unit)} })`)
}
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
function remark({ time, to }) {
  const call = markCall(time), at = call?.args[0]
  if (!at) return note('This marker comes from the file; no mark() in the script sets it.')
  ed.change({ from: at.from, to: at.to, insert: number(Math.max(0, at.value + to - time), v.unit) })
  return true
}
// A fade in or out over [from, to], from a selection's corner: from its edge inward, or centred on its edge; on its
// curve, unless it is the straight one fade() takes by default
function fade({ kind, from, to, curve = 'linear' }) {
  const s = t => number(t, v.unit)
  return write(`fade(${s(kind === 'in' ? to - from : from - to)}, { at: ${s(from)}${curve === 'linear' ? '' : `, curve: '${curve}'`} })`)
}
// The curve fades take from the corners, chosen from one: the fade just made there takes it too, when it is the
// chain's last step and one a corner makes (its time in an options object)
function setCurve(name) {
  root.querySelector('#fade-menu').hidePopover()
  state.fadeCurve = v.fadeCurve = name
  store()
  const last = lastEdit(ed.code, 'fade')?.call
  if (last?.args.find(a => a.kind === 'object')?.props.some(p => p.name === 'at')) ed.change(setArg(last, 'curve', name))
}

// The gain line's points: one gain() curve in dB, updated in place; no points removes it.
function envelope({ t, v: dbs }) {
  const code = ed.code, last = lastEdit(code, 'gain'), curve = last && curveOf(last.call)
  const text = `{ t: [${t.map(x => number(x)).join(', ')}], v: [${dbs.map(x => number(x, .1)).join(', ')}] }`
  if (curve && !t.length) return ed.change({ from: last.before, to: last.call.to, insert: '' }), true
  if (curve) return ed.change({ from: last.call.list.from + 1, to: last.call.list.to - 1, insert: text }), true
  return !!(t.length && write(`gain(${text})`))
}
// hoisted: the page draws the gain line of the script it opens with before this line runs
function curveOf(call) { const o = call?.args[0]; const t = o?.props?.find(p => p.name === 't')?.value, v = o?.props?.find(p => p.name === 'v')?.value; return Array.isArray(t) && Array.isArray(v) && t.length === v.length ? { t, v } : null }
// The curve the gain line shows: the chain's last gain() curve.
function envelopeOf(code) {
  const calls = chain(code)?.calls || []
  for (let i = calls.length - 1; i >= 0; i--) if (calls[i].name === 'gain') { const curve = curveOf(calls[i]); if (curve) return curve }
  return null
}

// A voiced stretch moved by some semitones: pitch() over its range; moving the same stretch again adds to it. Found
// again in the shifted output, its edges can move by a pitch frame (512 samples at 11 kHz, 46 ms), so they match to 50 ms.
function shift({ at, duration, semitones }) {
  const code = ed.code, last = lastEdit(code, 'pitch'), range = last?.call.args.find(a => a.kind === 'object')?.props
  const [a, d] = ['at', 'duration'].map(name => range?.find(p => p.name === name)?.value)
  const same = Math.abs(a - at) < .05 && Math.abs(a + d - at - duration) < .05
  const first = last?.call.args[0]
  if (same && first?.kind === 'number') return ed.change({ from: first.from, to: first.to, insert: number(first.value + semitones, .1) })
  write(`pitch(${number(semitones, .1)}, { at: ${number(at)}, duration: ${number(duration)} })`)
}
// A range `db` quieter or louder: a trapezoid added to the one gain curve the gain line draws, ramps of 5 ms (at most
// a quarter of the range) at its edges, so the level changes without a click; again adds again. Both are straight
// lines in dB between their points, flat past their ends (plan.js curveFn), so their sum is one too, at the points of
// both. The picture shows the change at once.
function level(db, span, draw = true) {
  const list = Array.isArray(span[0]) ? span : [span], T = v.duration, last = lastEdit(ed.code, 'gain'), curve = last && curveOf(last.call)
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
  const band = v.band.map(f => Math.round(f)), s = t => number(t, v.unit), last = lastEdit(ed.code, 'spectral'), args = last?.call.args
  const same = args && JSON.stringify(args[0]?.value) === JSON.stringify(band) && args[1]?.kind === 'number' && (() => {
    const range = args[2]?.props, at = range?.find(p => p.name === 'at')?.value, d = range?.find(p => p.name === 'duration')?.value
    return Math.abs(at - a) < 1e-3 && Math.abs(at + d - b) < 1e-3
  })()
  if (same) return ed.change({ from: args[1].from, to: args[1].to, insert: number(args[1].value + 6 * sign, .1) })
  write(`spectral([${band.join(', ')}], ${6 * sign}, { at: ${s(a)}, duration: ${s(b - a)} })`)
}

// A tool added: its call at the end of the chain, on the selection (each range) if there is one; its card is the one
// chosen among the edits, open, its sliders in hand (the panel turns to them from the tools), and the code's caret goes
// into it.
function addOp(name) {
  const op = ops[name], learn = op?.params?.find(s => s.selection), several = v.ranges.length > 1 && !v.band
  const span = ([a, b]) => `{ at: ${number(a, v.unit)}, duration: ${number(b - a, v.unit)} }`
  const call = args => /^[\w$]+$/.test(name) ? `${name}(${args})` : `['${name}'](${args})`
  const add = text => {
    const change = write(text)
    if (!change) return
    // the last call it wrote, where its "(" is
    const end = change.from + change.insert.length, at = chain(ed.code)?.calls.findLast(k => k.list.from >= change.from && k.list.from < end)?.list.from
    if (at == null) return
    ed.select(at + 1)
    if (state.side === 'tools') { state.side = 'edits'; store() }
    rk.choose(at)
  }
  // what it learns from is what is selected (denoise: where the noise plays alone), every range of it; it acts on all
  if (learn) {
    const list = v.band ? [] : several ? [...v.ranges].sort((p, q) => p[0] - q[0]) : v.selection ? [v.selection] : []
    if (!list.length) return note(`Select ${learn.selection} first.`)
    return add(call(`{ ${learn.name}: ${list.length > 1 ? `[${list.map(span).join(', ')}]` : span(list[0])} }`))
  }
  // several ranges: the method on each, from the last back, in one step
  const needs = (op.params || []).slice(0, (op.params || []).findLastIndex(s => s.required) + 1).map(s => typeof s.default === 'string' ? quote(s.default) : String(s.default))
  if (several) return add([...v.ranges].sort((p, q) => q[0] - p[0]).map(r => call([...needs, span(r)].join(', '))).join('.'))
  // a selection of all of it is no range at all; what the library can't do without is written, set to its default
  const sel = v.selection && (v.selection[0] > v.unit / 2 || v.selection[1] < v.duration - v.unit / 2) ? v.selection : null
  add(call([...needs, sel ? span(sel) : op.range ? `{ at: 0, duration: ${number(v.duration)} }` : ''].filter(Boolean).join(', ')))
}
function write(call) {
  const change = append(ed.code, call)
  if (!change) { note('Open or generate a sound first.'); return null }
  ed.change(change)
  return change
}
// Enter in the tools' search adds the first found; Escape clears the words
function toolKey(event) {
  if (event.key === 'Escape' && state.toolQuery) { event.preventDefault(); state.toolQuery = '' }
  if (event.key !== 'Enter') return
  const first = state.toolGroups[0]?.items[0]
  if (first) addOp(first.name)
}
// A word over the picture for a few seconds: a hint, or what went wrong (`error`), longer
function note(text, kind = '') {
  state.notice = text
  state.noticeKind = kind
  clearTimeout(note.timer)
  note.timer = setTimeout(() => state.notice = '', kind === 'error' ? 8000 : 4000)
}

// Sources. A new sound opens in a tab of its own, or in the tab shown if it is empty; a file dropped on the waveform
// joins it at the end; one dropped on the script is written where it lands.
function pickFiles() { closeMenus(); root.querySelector('.file-input').click() }
async function openFiles(list, how = 'new', at = null) {
  root.querySelector('.file-input').value = ''
  const files = list.filter(f => /^(audio|video)\//.test(f.type) || /\.(wav|mp3|flac|ogg|oga|opus|m4a|aac|aiff?|caf|webm|mp4|mov|wma|amr|mka)$/i.test(f.name))
  if (!files.length) return note(list.length ? 'Those are not audio files.' : '')
  const names = []
  for (const file of files) {
    const name = unique(file.name, new Set(eng.names.filter(n => !names.includes(n))))
    await eng.file(name, file)
    names.push(name)
  }
  place(names, how, at)
}
function place(names, how, at = null) {
  // what went wrong with the last sound no longer holds
  state.problem = ''
  const code = ed.code, src = source(code), list = names.map(quote)
  const expr = list.length > 1 ? `[${list.join(', ')}]` : list[0]
  if (how === 'at' && at != null) return ed.change({ from: at, insert: `audio(${expr})` })
  if (how === 'join' && src?.array) return ed.change({ from: src.array[1] - 1, insert: ', ' + list.join(', ') })
  if (how === 'join' && src?.strings.length === 1) return ed.change({ from: src.strings[0].from, to: src.strings[0].to, insert: `[${[quote(src.strings[0].name), ...list].join(', ')}]` })
  if (how === 'join' && chain(code)) return write(`insert(audio(${expr}))`)
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
function useRecipe(recipe) {
  closeMenus()
  const src = source(ed.code)?.text ?? `audio('chime.wav')`
  ed.change({ from: 0, to: ed.code.length, insert: recipe.code.replaceAll('$src', src) })
  // a recipe made for a spec checks against it
  if (recipe.spec && recipe.spec !== state.spec) { state.spec = recipe.spec; store() }
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
  const begin = () => t.into ? v.take({ at: t.at, sampleRate: t.rate, channels: blocks[0].length }) : v.stream({ sampleRate: t.rate, channels: blocks[0].length, total: null })
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
    t.into ? v.grow(block) : v.append(block)
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
  await eng.file(name, { channels, sampleRate: got.sampleRate })
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
    const src = source(ed.code), base = (src?.strings[0] ? label(src.strings[0].name).replace(/\.\w+$/, '') : 'audio') + '-edited'
    const { files = [], error: failed } = await eng.export({ format: state.format, name: base, parts: parts === true })
    if (failed) throw new Error(failed.message)
    for (const file of files) {
      const url = URL.createObjectURL(new Blob([file.bytes], { type: mime[file.type] || 'application/octet-stream' }))
      Object.assign(document.createElement('a'), { href: url, download: file.name }).click()
      setTimeout(() => URL.revokeObjectURL(url), 10000)
    }
  } catch (e) { note(`Export failed: ${e.message}`) }
  finally { state.exporting = false }
}

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
  const list = stored.docs?.length ? stored.docs.map(d => d.code) : [stored.code ?? DEFAULT]
  let at = Math.max(0, Math.min(stored.doc ?? 0, list.length - 1))
  const hash = location.hash.match(/^#code=([\w-]+)/)?.[1]
  if (hash) try {
    const bytes = Uint8Array.from(atob(hash.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0))
    const code = await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).text()
    at = list.includes(code) ? list.indexOf(code) : list.push(code) - 1
  } catch {}
  docs = list.map(code => ({ id: ++docIds, code }))
  return docs[at]
}

// Tabs over the picture, as an audio editor's open files: a script each, with its own history (the editor keeps it) and
// its own steps (remember). A sound opened goes into a tab of its own, unless the tab shown is empty.
// each tab named by the sound its script opens (nameOf), the one shown as its script now reads; the others kept
function retitle() { state.tabs = docs.map(d => ({ id: d.id, name: d.id === state.tab ? nameOf(ed.code) : d.name ??= nameOf(d.code) })) }
function nameOf(code) { const s = source(code)?.strings; return s?.length ? s.map(x => label(x.name)).join(' + ') : chain(code) ? 'generated' : 'untitled' }
function switchTab(id) {
  if (id === state.tab || !docs.some(d => d.id === id)) return
  const was = docs.find(d => d.id === state.tab), next = docs.find(d => d.id === id)
  if (was) Object.assign(was, { code: ed.code, name: nameOf(ed.code), steps, depthWas })
  ;({ steps = [], depthWas = 0 } = next)
  state.tab = id
  viewing = { delta: null, back: null }
  v.select(0, 0)
  v.setCursor(0)
  ed.open(id, next.code)
  rk?.refresh()
  retitle()
  store()
}
function newTab(code = '') {
  const doc = { id: ++docIds, code }
  docs.push(doc)
  switchTab(doc.id)
  return doc
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
root.addEventListener('dragover', event => {
  if (!event.dataTransfer?.types.includes('Files')) return
  event.preventDefault()
  event.stopPropagation()
  state.dropping = true
}, true)
root.addEventListener('dragleave', event => { if (!root.contains(event.relatedTarget)) state.dropping = false })
root.addEventListener('drop', event => {
  if (!event.dataTransfer?.files.length) return
  event.preventDefault()
  event.stopPropagation()
  state.dropping = false
  const inEditor = event.target.closest('.editor'), onView = event.target.closest('.view')
  const at = inEditor ? ed.view.posAtCoords({ x: event.clientX, y: event.clientY }) : null
  openFiles([...event.dataTransfer.files], inEditor && at != null ? 'at' : onView && state.hasOutput ? 'join' : 'new', at)
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
  else if (event.key === ' ' && !typing && !event.target.closest('button, a')) { event.preventDefault(); togglePlay() }
  else if (mod && event.key.toLowerCase() === 's') { event.preventDefault(); exportFiles() }
  else if (mod && event.key.toLowerCase() === 'o') { event.preventDefault(); pickFiles() }
})
// Buttons around the picture act without taking focus: Space stays play, and the picture or the script keeps its keys
root.addEventListener('mousedown', event => { if (event.target.closest('.status button, .tabs button, .files button, .edits button, .tool, .discard, .link, .viewing, .view-settings, #view-menu button, #fade-menu button')) event.preventDefault() })
// The first touch of the page opens the audio device, so the first play starts at once
for (const type of ['pointerdown', 'keydown']) addEventListener(type, () => pl.warm(), { capture: true, once: true })
addEventListener('pagehide', () => { pl.close(); recorder?.cancel() })

evaluate()
