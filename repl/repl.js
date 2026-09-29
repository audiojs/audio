import sprae from '../assets/sprae.js'
import engine from './engine.js'
import editor from './editor.js'
import view from './view.js'
import player from './player.js'
import stack from './stack.js'
import { logo } from '../logo/logo.js'
import { motion } from '../logo/motion.js'
import recipes from './recipes.js'
import { ops, methods, guides, previews, GROUPS } from './ops.js'
import { prepare, error, append, source, chain, number, rollback, residual } from './code.js'
import { builtins, sample, record, search, credit, unique } from './sources.js'
import scales from './scale.js'
import menubar from './menu.js'
import { levels, spectra } from './meters.js'

// The REPL: its output, and beside it the chain that makes it, as a stack of steps or as the code: two views of one
// script, a tab each, in a panel that opens and closes. Every change to the script runs it; the output is drawn,
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
const overlays = [['hits', 'Hits'], ['pitch', 'Pitch curve'], ['gain', 'Gain line'], ['meters', 'Meters']]
// How times read: minutes and seconds, seconds, or samples
const unitsList = [['clock', 'Minutes and seconds', '0:05.000'], ['seconds', 'Seconds', '5.000 s'], ['samples', 'Samples', '240000']]
// What the picture shows, a tab each: the waveform, or the spectrogram, never both (each zooms its own way)
const displays = [['wave', 'Waveform', 'The waveform: levels over time'], ['spec', 'Spectrogram', 'The spectrogram: frequencies over time']].map(([name, label, title]) => ({ name, label, title }))
// Rates a sound resamples to, from the facts on the display
const rates = [[8000, 'Telephone'], [11025, ''], [16000, 'Speech'], [22050, ''], [32000, ''], [44100, 'CD'], [48000, 'Video'], [88200, ''], [96000, 'High resolution']]
  .map(([hz, text]) => ({ hz, label: `${+(hz / 1000).toFixed(3)} kHz`, text }))
// Delivery specs the output can be checked against (fn/check.js holds their rules and sources)
const specs = [['', 'Off', ''], ['podcast', 'Apple Podcasts', 'Apple'], ['streaming', 'Spotify', 'Spotify'], ['broadcast', 'EBU R 128', 'R 128'], ['acx', 'ACX audiobook', 'ACX'], ['netflix', 'Netflix', 'Netflix']]
  .map(([key, label, short]) => ({ key, label, short }))

// Stored per browser: the script and how the page was left.
const stored = (() => { try { return JSON.parse(localStorage.getItem('audio-repl')) || {} } catch { return {} } })()
const store = () => { try { localStorage.setItem('audio-repl', JSON.stringify({ code: ed.code, layout: state.layout, display: state.display, scale: state.scale, side_split: state.split, format: state.format, spec: state.spec, side: state.side, show: state.show, units: state.units })) } catch {} }

const clock = (t, digits = 3) => {
  const m = Math.floor(t / 60), s = t - m * 60
  return `${m}:${s.toFixed(digits).padStart(digits ? digits + 3 : 2, '0')}`
}
const dbfs = db => Number.isFinite(db) ? `${db < 0 ? '−' : ''}${Math.abs(db).toFixed(1)}` : '−∞'
// Keys as this platform names them
const mac = /Mac|iP(hone|ad|od)/.test(navigator.platform)
const keys = s => mac ? s : s.replace(/⌘/g, 'Ctrl+').replace(/⇧/g, 'Shift+').replace(/⌥/g, 'Alt+')
// A time in the units chosen: 0:05.000, 5.000 s, or its sample at the output's rate
const stamp = t => state.units === 'seconds' ? `${t.toFixed(3)} s` : state.units === 'samples' ? String(Math.round(t * (output?.sampleRate || 48000))) : clock(t)
const span = d => state.units === 'samples' ? `${Math.round(d * (output?.sampleRate || 48000))} samples` : `${d.toFixed(3)} s`
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
// what the output shows when not the whole chain (the stack): what live step `delta` takes out, or the chain rolled
// back to its first `back` steps
let viewing = { delta: null, back: null }

// The mark in the bar, drawn live: at rest it holds the logo's pose; playing, it travels and swells with what is heard,
// and so does the tab's icon, in a hidden tab too. Without WebGL the static mark stays.
const wordmark = root.querySelector('.bar .wordmark'), canvas = wordmark.querySelector('.logo canvas')
const drawn = logo(canvas, { clear: true, fit: 'width', onresize: () => logoMark?.set({}) })
const logoMark = drawn && motion(drawn, canvas, { area: wordmark, hover: { speed: .15, cycles: 1.5 }, tap: false, favicon: true })
if (drawn) {
  drawn.set({ figure: getComputedStyle(wordmark).color, window: 'cosine', gradient: 'rectangular' })
  canvas.hidden = false
  wordmark.querySelector('.logo svg').remove()
}
// Heard RMS to the wave's height: a sliver of it at −48 dBFS and below, all of it at full scale
const swell = rms => .15 + .85 * Math.min(1, Math.max(0, 1 + 20 * Math.log10(rms + 1e-9) / 48))
const still = matchMedia('(prefers-reduced-motion: reduce)')
// while the engine works it sways gently, the same whether a file arrives or an output renders
let swaying = ''
function sway() {
  const mode = still.matches ? 'rest' : pl.playing ? 'play' : waiting || incoming ? 'work' : 'rest'
  if (mode === swaying) return
  swaying = mode
  logoMark?.set(mode === 'play' ? { speed: .5, amplitude: () => swell(pl.level), hidden: true } : mode === 'work' ? { speed: .25, amplitude: .45, hidden: true } : { speed: 0, amplitude: 1, hidden: false })
}

const state = sprae(root, {
  layout: stored.layout || (innerWidth < 900 ? 'column' : 'row'), split: stored.side_split || 30, format: stored.format || 'wav',
  display: stored.display === 'spec' ? 'spec' : 'wave', scale: stored.scale || 'log', displays, rates, sound: null, viewing: '',
  show: { hits: true, pitch: false, gain: true, meters: true, ...stored.show }, units: stored.units || 'clock',
  side: 'side' in stored ? stored.side : 'stack', bar: null,
  name: 'untitled', length: '', hasOutput: false, whole: false, ran: false, problem: '', notice: '', dropping: false,
  progress: '', loading: false, slow: false, lines: [], saves: [], exporting: false, shared: false, canUndo: false, canRedo: false, steps: [],
  time: '0:00.000', facts: '', readout: '', selection: null, band: null, ranges: 0, pauses: false, canPaste: false, playing: false, loop: false, recording: null,
  specs, spec: stored.spec || '', report: null, before: null, checking: false, ab: false, abGain: 0, canCompare: false,
  query: '', results: [], searching: false, searchState: '', previewing: -1,
  opQuery: '', samples: Object.entries(builtins).map(([name, text]) => ({ name, text })), generators, formats, clock,
  get recipeGroups() { return [...new Set(recipes.map(r => r.group))].map(name => ({ name, items: recipes.filter(r => r.group === name) })) },
  get opGroups() {
    const q = this.opQuery.trim().toLowerCase()
    return GROUPS.map(name => ({ name, items: Object.values(ops).filter(op => op.group === name && (!q || op.name.includes(q) || op.text.toLowerCase().includes(q))) })).filter(g => g.items.length)
  },
  // Edits for what is selected, in a bar under it: a time range, a band of it on the spectrogram, or at the caret a paste
  get edits() {
    const t = (type, label, keys, icon = type) => ({ type, label, keys, icon: icons[icon] }), level = (type, label, text) => ({ type, label, text })
    if (this.band) return [t('remove', 'Remove this band', '⌫'), level('quieter', 'This band 6 dB quieter', '−6 dB'), level('louder', 'This band 6 dB louder', '+6 dB'), t('repair', 'Rebuild this band from its surroundings')]
    // several ranges: what acts on each alike; pauses, each shortened
    if (this.ranges > 1) return [t('remove', `Delete all ${this.ranges}`, '⌫'), level('quieter', `Each 3 dB quieter`, '−3 dB'), level('louder', `Each 3 dB louder`, '+3 dB'), ...(this.pauses ? [level('shorten', 'Shorten each pause to a quarter second', 'Shorten')] : []), level('denoise', `The noise alone in all ${this.ranges}: learned there, taken 12 dB down everywhere`, 'Denoise')]
    if (this.selection) return [t('cut', 'Cut', '⌘X'), t('copy', 'Copy', '⌘C'), t('remove', 'Delete', '⌫'), t('crop', 'Keep only this'), level('quieter', '3 dB quieter, eased in and out over 5 ms', '−3 dB'), level('louder', '3 dB louder, eased in and out over 5 ms', '+3 dB'), level('denoise', 'The noise alone: learned here, taken 12 dB down everywhere', 'Denoise')]
    return this.canPaste ? [t('paste', 'Paste at the cursor', '⌘V')] : []
  },
  // The check: a verdict on the bar, rule by rule in its panel, the source beside the output
  get checkLabel() {
    const s = specs.find(s => s.key === this.spec)
    if (!this.spec) return 'Check'
    if (!this.report) return this.checking ? 'Checking…' : s.short
    const failed = this.report.rules.filter(r => r.pass === false).length
    return `${mark(this.report.pass)} ${s.short}${failed ? ` · ${failed}` : ''}`
  },
  get checkTitle() {
    if (!this.spec) return 'Check the output against a delivery spec: Apple Podcasts, Spotify, EBU R 128, ACX or Netflix'
    if (!this.report) return `Checking against ${specs.find(s => s.key === this.spec).label}…`
    const failed = this.report.rules.filter(r => r.pass === false).map(r => r.name)
    return `${this.report.name}: ${failed.length ? 'fails ' + failed.join(', ') : 'passes'}. Open for each rule, before and after`
  },
  get checkClass() { return this.report && !this.checking ? verdict(this.report.pass) : '' },
  get checkRows() {
    const before = this.before?.rules || []
    return (this.report?.rules || []).map((r, i) => ({
      name: r.name, unit: r.unit, limit: limit(r), note: r.note || before[i]?.note || '',
      after: value(r.value), afterMark: mark(r.pass), afterClass: verdict(r.pass),
      before: before[i] ? value(before[i].value) : '', beforeMark: before[i] ? mark(before[i].pass) : '', beforeClass: before[i] ? verdict(before[i].pass) : ''
    }))
  },
  get abTitle() {
    if (!this.canCompare) return 'Before the edits: open a file to compare with'
    const gain = `${this.abGain >= 0 ? '+' : '−'}${Math.abs(this.abGain).toFixed(1)} dB`
    return this.ab ? `Hearing before the edits: the file as it opened, level-matched (${gain}). Press to hear after (B)` : 'Hear before the edits: the file as it opened, level-matched, at the same place (B)'
  },
  setSpec(key) { state.spec = key; store(); scheduleCheck(0) },
  toggleAB,
  // The clock: the playhead, the caret, or a selection's start–end, in the units chosen; a click changes the units
  get timeText() {
    const sel = this.selection
    if (this.playing || !sel) return this.time
    return `${stamp(sel[0])}–${stamp(sel[1])}`
  },
  get timeTitle() {
    const what = this.playing ? 'Playhead' : this.selection ? 'Selection start and end' : 'Caret'
    return `${what}, in ${unitsList.find(u => u[0] === this.units)[1].toLowerCase()}. Click for ${unitsList[(unitsList.findIndex(u => u[0] === this.units) + 1) % unitsList.length][1].toLowerCase()}`
  },
  get undoTitle() { const now = this.steps.find(s => s.current); return `Undo${now && this.canUndo ? `: ${now.label}` : ''} (${keys('⌘Z')})` },
  get plotHelp() {
    return `${this.display === 'spec' ? 'Spectrogram' : 'Waveform'}. Click to put the caret and hear the moment there; drag to select a time range, or on the spectrogram a time and frequency box; double-click selects between the cues around it, triple-click a phrase. Drag a selection to move its audio, Alt-drag to copy it over; drag its bottom right corner across to stretch it, up or down to change its level or, on the spectrogram, its pitch. The wheel pans; on the times it zooms time, on the frequencies the frequencies.`
  },
  toggleLayout() { state.layout = state.layout === 'row' ? 'column' : 'row'; store() },
  setSide(name) { state.side = name; store() },
  toggleSide() { state.side = state.side ? null : 'stack'; store() },
  setFormat(name) { state.format = name; document.querySelector('#format-menu').hidePopover(); store() },
  setDisplay, cycleUnits, toggleLoop, undoList, goTo, toggleRecording, resampleTo, remixTo,
  togglePlay, playPress, playClick, stop: () => eng.stop(), undo: () => ed.undo(), redo: () => ed.redo(), mac, share, exportFiles,
  pickFiles, openFiles, startRecording, stopRecording, useSample, useCode, useRecipe, addOp, editSelection, opKey,
  openSearch, closeSearch, runSearch, typeSearch, preview, useResult,
  resizeStart, resizeKey
})

// The script editor
ed = editor(root.querySelector('.editor'), {
  doc: await initialCode(),
  onchange(code, update) {
    const slider = update.transactions.some(tr => tr.isUserEvent('input.slider'))
    state.canUndo = ed.canUndo
    state.canRedo = ed.canRedo
    remember(code, slider)
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

// The output view
v = view(root.querySelector('.plot'), {
  spectrum: request => eng.spectrum({ ...request, output: showing }),
  onselect(selection, band, ranges = []) {
    state.selection = selection
    state.band = band
    state.ranges = ranges.length
    // every range a pause of the output (its silences, worker.js), give or take a pause's block
    state.pauses = ranges.length > 1 && ranges.every(([a, b]) => output?.segments?.silences.some(([p, q]) => Math.abs(p - a) < .03 && Math.abs(q - b) < .03))
    describe()
    meter()
  },
  // the caret put elsewhere while it plays: playback goes there, over what is selected now (all of it, if nothing)
  oncursor(t) { if (pl.playing) pl.play(plays(t)); else { state.time = stamp(t); meter(); pl.seek(t) } },
  // an edit made on the picture: true once it is written in the script
  onedit(type, detail) { const act = { warp, envelope, pitch: shift, move: carry, copy: carry, stretch, lift, fade, unmark, remark }[type]; return !!(act ? act(detail, type) : editSelection(type, detail)) },
  onscale(name) { state.scale = name; store() },
  onscrub,
  onbox: follow
})
v.display = state.display
v.scale = state.scale
v.units = state.units
v.show = state.show
v.envelope = envelopeOf(ed.code)

// The stack beside the output; its card in hand draws what it sets over the output (ops.js guides). What the output
// shows when it is not the whole chain (what a step takes out, the chain rolled back) runs in place of the script.
rk = stack(root.querySelector('.steps'), {
  ed,
  describe: name => eng.describe(name),
  duration: () => v.duration,
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
  const edit = (label, type, key, when) => ({ label, keys: key && keys(key), run: () => editSelection(type), disabled: !when })
  return [
    { name: 'File', title: 'Open, record or find a sound; samples, generators, recipes; export', items: [
      { label: 'Open file…', keys: keys('⌘O'), run: pickFiles },
      { label: 'Record', run: startRecording, disabled: !!state.recording },
      { label: 'Find a sound…', run: openSearch },
      { label: 'Samples', items: Object.entries(builtins).map(([name, text]) => ({ label: name, hint: text, run: () => useSample(name) })) },
      { label: 'Generate', items: generators.map(g => ({ label: g.name, hint: g.text, run: () => useCode(g.code) })) },
      { label: 'Recipes', items: recipesMenu },
      '-',
      { label: state.saves.length > 1 ? `Export ${state.saves.length} files` : 'Export', keys: keys('⌘S'), run: exportFiles, disabled: none || state.exporting },
      { label: 'Export as', items: formats.map(f => check(f.name.toUpperCase(), state.format === f.name, () => state.setFormat(f.name), { hint: f.text })), disabled: state.saves.length > 0 },
      { label: 'Export the parts between markers', run: () => exportFiles(true), disabled: none || !output?.markers?.length },
      { label: 'Copy a link to this script', run: share }
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
      { label: sel ? 'Apply a method to the selection…' : 'Add a method…', run: () => openAdd(), disabled: none },
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
      { label: 'Frequency scale', items: Object.entries(scales).map(([name, sc]) => check({ log: 'Octaves', mel: 'Mel', lin: 'Hertz' }[name], state.scale === name, () => { v.scale = name; state.scale = name; store() }, { hint: sc.text })) },
      '-',
      ...overlays.map(([name, label]) => check(label, state.show[name], () => toggleShow(name))),
      '-',
      { label: 'Zoom in', keys: '=', run: () => v.zoom(.5), disabled: none },
      { label: 'Zoom out', keys: '−', run: () => v.zoom(2), disabled: none },
      { label: 'Zoom to the selection', run: () => v.zoomTo(...sel), disabled: !sel },
      { label: 'Show all of it', keys: '0', run: () => v.fit(), disabled: none },
      '-',
      check('The chain', !!state.side, () => state.toggleSide()),
      check('Its stack', state.side === 'stack', () => state.setSide('stack')),
      check('Its code', state.side === 'code', () => state.setSide('code')),
      check('The chain beside the output', state.layout === 'row', () => state.toggleLayout()),
      { label: 'Times in', items: unitsList.map(([name, label, example]) => check(label, state.units === name, () => setUnits(name), { hint: example })) },
      '-',
      { label: 'Reset the view', run: resetView }
    ] },
    { name: 'Process', title: 'Every method by kind, for the output or the selection', items: [
      ...GROUPS.map(group => ({ label: group, items: Object.values(ops).filter(op => op.group === group).map(op => ({ label: op.name, hint: op.text, run: () => addOp(op.name) })), disabled: none })),
      '-',
      { label: 'Find a method…', run: () => openAdd(), disabled: none }
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
// The method list, from a menu: at the stack's + where the stack shows, else under the bar
function openAdd() {
  const menu = document.querySelector('#add-menu'), at = root.querySelector('.add-step')
  const anchored = at?.offsetParent != null
  menu.classList.toggle('floating', !anchored)
  menu.showPopover(anchored ? { source: at } : undefined)
}
function resetView() {
  v.fit()
  state.display = v.display = 'wave'
  state.show = { hits: true, pitch: false, gain: true, meters: true }
  setUnits('clock')
  marks()
  store()
}

// The bar of edits follows what is selected, centred under it and kept inside the picture: under a range (it spans
// the lanes, so the bar sits at their foot), under a box on the spectrogram or over it where there is no room, at the
// caret for a paste. None while a drag goes on.
function follow(box) {
  if (!box) { state.bar = null; return }
  const edits = root.querySelector('.edits'), plot = root.querySelector('.plot'), w = edits.offsetWidth || 240, h = edits.offsetHeight || 36
  const x = Math.max(w / 2 + 4, Math.min(box.width - w / 2 - 4, (box.x0 + box.x1) / 2))
  // under a range it stands clear of the corner that transforms it
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
  state.viewing = step ? `What .${step.name}() takes out` : back != null && back < calls.length ? `Rolled back to ${back ? `.${calls[back - 1].name}()` : 'the source'}` : ''
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

// A run's reply: what the script printed in the console under it; what went wrong, once, in the bar beside the time,
// in place of the output's figures, and at its line in the script. The last output that ran stays. A sound it made
// then arrives (arrival).
function show(result, syntax = false, names = [], coming = null) {
  // the first result, whatever it is, says whether there is a sound: until then the view waits, not invites
  state.ran = true
  const lines = [...(result.logs || [])], e = result.error
  if (result.value != null) lines.push({ level: 'value', text: result.value })
  state.lines = lines
  state.problem = e ? e.message + (e.line ? ` (line ${e.line})` : '') : ''
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
  if (a?.loaded) text = a.loaded.estimate ? `Loading ${Math.min(99, Math.floor(a.loaded.at / a.loaded.estimate * 100))}%` : `Loading ${a.loaded.at.toFixed(1)} s`
  else if (waiting && now - waited > 300) { text = 'Running…'; since = waited }
  else if (a && now - a.last > 400) { text = 'Rendering…'; since = a.last }
  state.progress = text && since != null && now - since > 1000 ? `${text} ${((now - since) / 1000).toFixed(1)} s` : text
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

// Checks the output (and the file it came from) against the chosen spec, a moment after it settles; a newer output's
// check replaces an older one's, which the page then ignores.
function scheduleCheck(delay = 300) {
  clearTimeout(scheduleCheck.timer)
  if (!state.spec || !state.hasOutput) { state.report = state.before = null; state.checking = false; return }
  state.checking = true
  scheduleCheck.timer = setTimeout(async () => {
    const seq = ++checks, spec = state.spec, r = await eng.check(spec, sourceName())
    if (seq !== checks || spec !== state.spec) return
    state.checking = false
    if (r.error) { state.report = state.before = null; return note(`Check failed: ${r.error.message}`) }
    state.report = r.output
    state.before = r.input
  }, delay)
}

// A/B: the original at the same place, level-matched to the output; the next output, or B again, returns to it.
async function toggleAB() {
  const name = sourceName()
  if (!state.hasOutput) return
  if (state.ab || !name) { state.ab = false; pl.set(output.channels, output.sampleRate); return }
  const loudness = output.stats.loudness
  if (original?.name !== name || original.loudness !== loudness) {
    const r = await eng.original(name, loudness)
    if (!r.channels) return note(r.error?.message || 'The original is too long to hold beside the output.')
    original = { name, loudness, ...r }
  }
  state.ab = true
  state.abGain = original.gain
  pl.set(original.channels, original.sampleRate)
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

// The display's two rows: what the output is (its rate, channels, depth), or the selection's length, beside the loop
// switch; below, its levels: the output's peak and loudness, the selection's peak and RMS, or the band selected.
const hertz = f => f >= 1000 ? `${+(f / 1000).toFixed(2)} kHz` : `${Math.round(f)} Hz`
function describe() {
  state.sound = null
  if (!output?.duration) { state.facts = state.readout = ''; return }
  const sel = state.selection
  if (sel) {
    const [a, b] = sel, rate = output.sampleRate, from = Math.floor(a * rate), to = Math.ceil(b * rate)
    let peak = 0, sum = 0, n = 0
    for (const ch of output.channels) for (let i = from; i < to && i < ch.length; i++) { const x = ch[i]; sum += x * x; n++; if (Math.abs(x) > peak) peak = Math.abs(x) }
    state.facts = state.ranges > 1 ? `${state.ranges} ranges, ${span(v.ranges.reduce((n, [p, q]) => n + q - p, 0))} in all` : span(b - a)
    state.readout = state.band ? `${hertz(state.band[0])} – ${hertz(state.band[1])}` : `peak ${dbfs(20 * Math.log10(peak))} dB · RMS ${dbfs(10 * Math.log10(sum / Math.max(1, n)))} dB`
    return
  }
  const { sampleRate, channels, stats, bitDepth } = output, k = channels.length
  state.sound = { hz: sampleRate, rate: `${+(sampleRate / 1000).toFixed(3)} kHz`, count: k, channels: k === 1 ? 'mono' : k === 2 ? 'stereo' : `${k} ch`, depth: bitDepth ? `${bitDepth}-bit` : '' }
  state.readout = [`peak ${dbfs(stats.peak)} dBFS`, Number.isFinite(stats.loudness) ? `${dbfs(stats.loudness)} LUFS` : ''].filter(Boolean).join(' · ')
}
function cycleUnits() { setUnits(unitsList[(unitsList.findIndex(u => u[0] === state.units) + 1) % unitsList.length][0]) }
function setUnits(name) {
  state.units = v.units = name
  state.time = stamp(pl.playing ? pl.time : v.cursor)
  describe()
  store()
}
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
  document.querySelector('#history-menu').hidePopover()
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
  const where = typeof at === 'number' && typeof d === 'number' ? ` ${at.toFixed(2)}–${(at + d).toFixed(2)} s` : ''
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
    if (pl.playing) { resume = true; cancelAnimationFrame(ticker); state.playing = false; v.playhead = null; sway() }
    return pl.scrub(t, band)
  }
  pl.scrub(null)
  if (resume) { resume = false; togglePlay() }
}

// Edits made on the picture become calls at the end of the output chain, their times to the view's precision. A band
// selection edits only its frequencies.
function editSelection(type, range = v.selection) {
  if (type === 'undo' || type === 'redo') return ed[type]()
  // an op that learns from the selection takes it whole, every range
  if (ops[type]?.params?.some(s => s.selection)) return addOp(type)
  const all = Array.isArray(range?.[0]) ? range : !v.band && v.ranges.length > 1 ? v.ranges : null
  if (all?.length > 1) return editRanges(type, all)
  if (all) range = all[0]
  if (!range && type !== 'paste') return
  if (type === 'quieter' || type === 'louder') return v.band ? bandLevel(type === 'louder' ? 1 : -1, range) : level(type === 'louder' ? 3 : -3, range)
  const [a, b] = range || [v.cursor, v.cursor], s = t => number(t, v.unit), span = `{ at: ${s(a)}, duration: ${s(b - a)} }`, band = v.band
  const hz = band && `[${band.map(f => Math.round(f)).join(', ')}]`
  const call = type === 'paste' ? `paste(${s(a)})`
    : band ? { remove: `spectral(${hz}, ${span})`, repair: `repair(${hz}, ${span})` }[type]
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
function carry({ at, duration, to }, type) {
  const s = t => number(t, v.unit), span = `{ at: ${s(at)}, duration: ${s(duration)} }`
  return write(type === 'move' ? `cut(${span}).paste(${s(to)})` : `copy(${span}).remove({ at: ${s(to)}, duration: ${s(duration)} }).paste(${s(to)})`)
}
// A selection stretched from its end, pitch kept; what follows moves with it
function stretch({ at, duration, factor }) {
  return write(`stretch(${number(factor, .001)}, { at: ${number(at, v.unit)}, duration: ${number(duration, v.unit)} })`)
}
// A selection's level moved up or down by the pointer, onto the gain curve as a level change is
const lift = ({ range, db, drawn }) => level(db, range, !drawn)
// A marker at the caret, or where it plays while it plays: mark() at the chain's end (M)
function addMarker() {
  if (!state.whole) return
  return write(`mark(${number(pl.playing ? pl.time : v.cursor, v.unit)})`)
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
// A selection faded in from its start, or out to its end, over `length` s
function fade({ kind, at, duration, length }) {
  const s = t => number(t, v.unit)
  return write(kind === 'in' ? `fade(${s(length)}, { at: ${s(at)} })` : `fade(${s(-length)}, { at: ${s(at + duration - length)} })`)
}

// The gain line's points: one gain() curve in dB, updated in place; no points removes it.
function envelope({ t, v: dbs }) {
  const code = ed.code, last = lastEdit(code, 'gain'), curve = last && curveOf(last.call)
  const text = `{ t: [${t.map(x => number(x)).join(', ')}], v: [${dbs.map(x => number(x, .1)).join(', ')}] }`
  if (curve && !t.length) return ed.change({ from: last.before, to: last.call.to, insert: '' }), true
  if (curve) return ed.change({ from: last.call.list.from + 1, to: last.call.list.to - 1, insert: text }), true
  return !!(t.length && write(`gain(${text})`))
}
const curveOf = call => { const o = call?.args[0]; const t = o?.props?.find(p => p.name === 't')?.value, v = o?.props?.find(p => p.name === 'v')?.value; return Array.isArray(t) && Array.isArray(v) && t.length === v.length ? { t, v } : null }
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

function addOp(name) {
  document.querySelector('#add-menu').hidePopover()
  const op = ops[name], learn = op?.params?.find(s => s.selection), several = v.ranges.length > 1 && !v.band
  const span = ([a, b]) => `{ at: ${number(a, v.unit)}, duration: ${number(b - a, v.unit)} }`
  const call = args => /^[\w$]+$/.test(name) ? `${name}(${args})` : `['${name}'](${args})`
  // The caret goes into the new call, so its sliders open.
  const add = text => { const change = write(text); if (change) ed.select(change.from + change.insert.indexOf(text) + text.indexOf('(') + 1) }
  // what it learns from is what is selected (denoise: where the noise plays alone), every range of it; it acts on all
  if (learn) {
    const list = v.band ? [] : several ? [...v.ranges].sort((p, q) => p[0] - q[0]) : v.selection ? [v.selection] : []
    if (!list.length) return note(`Select ${learn.selection} first.`)
    return add(call(`{ ${learn.name}: ${list.length > 1 ? `[${list.map(span).join(', ')}]` : span(list[0])} }`))
  }
  // several ranges: the method on each, from the last back, in one step
  if (several) return write([...v.ranges].sort((p, q) => q[0] - p[0]).map(r => call(span(r))).join('.'))
  // a selection of all of it is no range at all
  const sel = v.selection && (v.selection[0] > v.unit / 2 || v.selection[1] < v.duration - v.unit / 2) ? v.selection : null
  add(call(sel ? span(sel) : op.range ? `{ at: 0, duration: ${number(v.duration)} }` : ''))
}
function write(call) {
  const change = append(ed.code, call)
  if (!change) { note('Open or generate a sound first.'); return null }
  ed.change(change)
  return change
}
function opKey(event) {
  if (event.key !== 'Enter') return
  const first = state.opGroups[0]?.items[0]
  if (first) addOp(first.name)
}
function note(text) { state.notice = text; clearTimeout(note.timer); note.timer = setTimeout(() => state.notice = '', 4000) }

// Sources. A new source replaces the one the output chain has (the same edits apply to it);
// a file dropped on the waveform joins it at the end; one dropped on the script is written where it lands.
function pickFiles() { closeMenus(); root.querySelector('.file-input').click() }
async function openFiles(list, how = 'replace', at = null) {
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
  ed.change(over(code, `audio(${expr})`))
}
// A new sound in the script: over the one it opens (a file, or the audio.from(…) making it), so the edits after it
// stay; into an empty script; else after what is written there, which stays too. `before` goes on a line above it.
function over(code, insert, before = '') {
  const src = source(code), c = src ? null : chain(code), made = c && code.slice(c.root.from, c.root.to) === 'audio' && c.calls[0]?.name === 'from'
  const at = src || (made && { from: c.root.from, to: c.calls[0].to })
  if (at) return before ? [{ from: code.lastIndexOf('\n', at.from - 1) + 1, insert: before + '\n' }, { from: at.from, to: at.to, insert }] : { from: at.from, to: at.to, insert }
  const text = (before ? before + '\n' : '') + insert
  return code.trim() ? { from: code.length, insert: `\n\n${text}` } : { from: 0, to: code.length, insert: text }
}
async function useSample(name) {
  closeMenus()
  if (!eng.has(name)) await eng.file(name, sample(name))
  place([name], 'replace')
}
function useCode(code) {
  closeMenus()
  state.problem = ''
  ed.change(over(ed.code, code))
}
function useRecipe(recipe) {
  closeMenus()
  const src = source(ed.code)?.text ?? `audio('chime.wav')`
  ed.change({ from: 0, to: ed.code.length, insert: recipe.code.replaceAll('$src', src) })
  // a recipe made for a spec checks against it
  if (recipe.spec && recipe.spec !== state.spec) { state.spec = recipe.spec; store() }
}
const closeMenus = () => { for (const menu of root.querySelectorAll('[popover]')) if (menu.matches(':popover-open')) menu.hidePopover() }

async function startRecording() {
  closeMenus()
  if (recorder || state.recording) return
  if (pl.playing) togglePlay()
  state.recording = { pending: true, time: '0:00.0', level: 0 }
  try {
    recorder = await record()
    if (!state.recording) return recorder.cancel()
    state.recording.pending = false
    const started = performance.now()
    recorder.clock = setInterval(() => {
      if (!state.recording) return
      state.recording.time = clock((performance.now() - started) / 1000, 1)
      state.recording.level = Math.min(1, recorder.level)
    }, 80)
  } catch (e) {
    state.recording = null
    recorder = null
    note(e?.name === 'NotAllowedError' ? 'Microphone access was denied. Allow it in the browser to record.' : 'The microphone is not available.')
  }
}
async function stopRecording() {
  const take = recorder
  if (!take) { state.recording = null; return }
  clearInterval(take.clock)
  recorder = null
  const audio = take.stop()
  state.recording = null
  if (!audio.channels[0]?.length) return note('Nothing was recorded.')
  const name = unique('recording.wav', new Set(eng.names))
  await eng.file(name, audio)
  place([name], 'replace')
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
// A found sound replaces the source, its credit on the line above the statement that opens it.
function useResult(r) {
  closeSearch()
  state.problem = ''
  ed.change(over(ed.code, `audio(${quote(r.url)})`, credit(r)))
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
async function initialCode() {
  const hash = location.hash.match(/^#code=([\w-]+)/)?.[1]
  if (hash) try {
    const bytes = Uint8Array.from(atob(hash.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0))
    return await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).text()
  } catch {}
  return stored.code ?? DEFAULT
}

// Resizing the panes
function resizeStart(event) {
  const panes = root.querySelector('.panes'), splitter = event.currentTarget
  splitter.setPointerCapture(event.pointerId)
  const move = e => {
    const r = panes.getBoundingClientRect(), row = state.layout === 'row'
    // the chain's panel, at the right or below: what is past the divider
    const fraction = row ? (e.clientX - r.left) / r.width : (e.clientY - r.top) / r.height
    state.split = Math.max(20, Math.min(60, (1 - fraction) * 100))
  }
  splitter.addEventListener('pointermove', move)
  splitter.addEventListener('pointerup', () => { splitter.removeEventListener('pointermove', move); store() }, { once: true })
}
function resizeKey(event) {
  const step = { ArrowLeft: 2, ArrowUp: 2, ArrowRight: -2, ArrowDown: -2 }[event.key]
  if (!step) return
  event.preventDefault()
  state.split = Math.max(20, Math.min(60, state.split + step))
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
  openFiles([...event.dataTransfer.files], inEditor && at != null ? 'at' : onView && state.hasOutput ? 'join' : 'replace', at)
}, true)

document.addEventListener('keydown', event => {
  const mod = event.metaKey || event.ctrlKey, typing = event.target.closest?.('.cm-editor, input, textarea, select, dialog')
  if (!typing && !mod && !event.altKey && event.key.toLowerCase() === 'b' && state.canCompare) { event.preventDefault(); toggleAB() }
  else if (!typing && !mod && !event.altKey && event.key.toLowerCase() === 'm' && state.whole) { event.preventDefault(); addMarker() }
  else if (event.key === ' ' && !typing && !event.target.closest('button, a')) { event.preventDefault(); togglePlay() }
  else if (mod && event.key.toLowerCase() === 's') { event.preventDefault(); exportFiles() }
  else if (mod && event.key.toLowerCase() === 'o') { event.preventDefault(); pickFiles() }
})
// Buttons around the picture act without taking focus: Space stays play, and the picture or the script keeps its keys
root.addEventListener('mousedown', event => { if (event.target.closest('.status button, .tabs button, .edits button, .add-step')) event.preventDefault() })
// The first touch of the page opens the audio device, so the first play starts at once
for (const type of ['pointerdown', 'keydown']) addEventListener(type, () => pl.warm(), { capture: true, once: true })
addEventListener('pagehide', () => { pl.close(); recorder?.cancel() })

evaluate()
