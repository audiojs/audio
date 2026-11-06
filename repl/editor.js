import sprae from '../assets/sprae.js'
import engine from './engine.js'
import codeEditor from './script.js'
import view, { KINDS } from './view.js'
import { ops, previews, GROUPS, labelOf, icons as groupIcons } from './ops.js'
import { source, steps as stepsOf, focus, addTake } from './code.js'
import scales from './scale.js'
import time, { UNITS } from './time.js'
import opIcons from './icons.js'
import hint from './hint.js'
import md from './markdown.js'
import { connectAgent, pickAgent, partsOf, showChat, newChat, openChat, dropChat, visit, elapsed, sendChat, chatKey, wire as wireChat } from './editor/chat.js'
import { wire as wireClipboard } from './editor/clipboard.js'
import { command, shortcut, tip, scriptKeys, pressed } from './editor/commands.js'
import { root, params, EMBED, UI, STACKED, AGENTED, SHOWN, QUICK, GIVEN, formats, ENCODING, writtenDepth, cutFormats, frameRates, KEEPS, LOOK, looks, specMethods, WAVE, waveLooks, levelList, curves, glyphs, gripModes, displays, SHUTTLE, times, tenths, rates, layouts, specs, stored, oneOf, sideOf } from './editor/config.js'
import { ed, rk, pl, output, incoming, rechoose, shown, carded, queued, turning, assign } from './editor/context.js'
import { remember, undoList, goTo, editSelection, warp, carry, toTab, addOp, spread, flatten, switchTake } from './editor/edits.js'
import { lengthOf, pickFiles, openFiles, taken, recover, useSample, useCode, useRecipe, openSearch, closeSearch, typeSearch, runSearch, preview, useResult, exportFiles, exportCuts, share, wire as wireFiles } from './editor/files.js'
import { bytes, mac, keys, clock, stamp, ruled, label, note } from './editor/format.js'
import { wire as wireKeys } from './editor/keys.js'
import { paint, setDisplay, laneGroups, setScale, setLevels, setLook, resizePanel, flipView, wire as wireLook } from './editor/look.js'
import { bar, openDropdown, dropToggle, placeList, contextMenu, openTools, closePalette, quick, toolKey, soundMenu, opsMenu, saveMenu, closeMenus, wire as wireMenus } from './editor/menus.js'
import { writing, store, later, wire as wirePersist } from './editor/persist.js'
import { playerOf, toggleAB, toggleLoop, plays, playPress, playClick, togglePlay, toggleTabMute, onscrub, wire as wirePlay } from './editor/play.js'
import { meter, describe, markLevel, unmarkLevel, pickReading, pickSpec, seekTo, listen } from './editor/readouts.js'
import { placed, toggleRecording, take, recorder, armRecording, startRecording, stopRecording, reach, span, useTakeOf, forkRange, takeList, wire as wireRecording } from './editor/recording.js'
import { schedule, evaluate, stop, standIn, scheduleCheck, wire as wireRun } from './editor/run.js'
import { docOf, initialDocs, retitle, tabPress, tabOver, tabRenamed, switchTab, scrollTabs, inSight, newTab, dragTab, closeTab, wire as wireTabs } from './editor/tabs.js'
import { guidesOf } from './editor/tools.js'
import { trackMenu, layerLook, toggleLock, fitField, roomMenu, toggleMute, focusOn, trackOf, laneName, untrack, wire as wireTracks } from './editor/tracks.js'
import { resampleTo, remixTo, channelActions, silence, stretch, trim, crossfade, lift, unmark, nameMarker, relabel, remark, fade, setGrip, setCurve, envelope, pitchline, envelopeShown, shiftOf, shift, tone, formant } from './editor/writers.js'

// The editor: its output, and at its right a panel that opens and closes, as Luminar's: the tools, every method by kind,
// one click adding it; the edits, the chain that makes the output as a stack of steps; the same chain as code; and the
// export, the output checked against a spec and saved as a file. Every change to the script runs it; the output is drawn,
// measured and played. Selecting, cutting or applying a method on the waveform, or a slider in the stack, writes the
// script.
// wiring it: the page waits for its first frame, not for the window's load, which an await below may outlast
// (index.html)
root.dataset.boot = 'wiring'

// One editor writes at a time (persist.js)
wirePersist()

const eng = engine()
assign({ eng })
// The channel samples the page holds of an output, 30 channel-minutes at 48 kHz: a longer one comes as its peaks, drawn
// from them, its samples fetched where the view zooms in (view.js summary), played by the engine (player.js)
eng.peaks = 30 * 60 * 48000
// the view, made below, where tests patch it, and assigned to the context
let v
// a copy made in another tab or window, pasted here (clipboard.js)
wireClipboard()
// the mark in the bar, drawn live (play.js)
wirePlay()

// a time in samples of the sound, as a number reads
const samples = t => Math.round(t * (output?.sampleRate || 44100)).toLocaleString('en')
const state = sprae(root, {
  format: oneOf(stored.format, formats.map(f => f.name), 'wav'), encoding: { markers: true, ...stored.encoding }, snapping: stored.snap ?? true, fadeCurve: oneOf(stored.curve, curves.map(c => c.name), 'linear'), gripMode: ['trim', 'speed'].includes(stored.grip) ? stored.grip : 'stretch', pitch: false,
  levelList, levels: oneOf(stored.levels, ['db'], 'linear'),
  ruler: SHOWN.length && !SHOWN.includes('ruler') ? 'off' : 'labels', scroll: oneOf(UI.scroll ?? stored.scroll, ['bar', 'hover', 'overview'], 'hover'), grid: oneOf(stored.grid, ['none', 'lines'], 'none'), splice: Number.isFinite(UI.splice) ? UI.splice : 10, look: Object.fromEntries(Object.entries(LOOK).map(([k, d]) => [k, oneOf(stored.look?.[k], k === 'method' ? specMethods.map(m => m[0]) : looks[k], d)])), wave: Object.fromEntries(Object.entries(WAVE).map(([k, d]) => [k, waveLooks[k].some(([v]) => v === stored.wave?.[k]) ? stored.wave[k] : d])),
  reads: oneOf(SHOWN.find(w => ['peak', 'rms', 'loudness'].includes(w)) ?? stored.reads, ['peak', 'rms', 'loudness'], 'peak'),
  // the picture's groups
  // while its dropdown is open
  // how a band shows, the dropdown its look opens: the band's name (a sound's ''), what each track shows, its own
  dropdown: false, dropLane: '', kinds: {}, get displayGroups() { return this.dropdown ? laneGroups(this.dropLane, this) : [] },
  get dropTitle() { const kind = (this.dropLane && this.kinds[this.dropLane]) || this.display; return `${this.dropLane ? `${this.dropLane}: ` : ''}${displays.find(d => d.name === kind).label}` },
  // the speed it plays at, the pitch kept; how far through the sound it plays (Play's ring); the scale a held Play shows
  // while dragged
  speed: 1, played: 0, speedAxis: null, shuttle: null, speedTicks: SHUTTLE.ticks.map(t => ({ t, label: times(t), at: SHUTTLE.at(t) })),
  get shuttleText() { return tenths(this.shuttle ?? this.speed) },
  get shuttleAt() { return SHUTTLE.at(this.shuttle ?? this.speed) },
  display: oneOf(stored.display, displays.map(d => d.name), 'wave'), scale: scales[stored.scale] ? stored.scale : 'log', rates, layouts, sound: null, viewing: '',
  show: { meters: true, spectrum: true, keys: true, gain: true, guides: true }, units: oneOf(UI.units, UNITS.map(u => u[0]), 'clock'),
  embed: EMBED, stacked: STACKED, agented: AGENTED, quick: QUICK, made: 0, soundMenu, opsMenu, saveMenu, flipView, lookIcons: KINDS, full: '', side: sideOf(stored.side), panel: Number.isFinite(stored.panel) ? stored.panel : null, pick: 0, keys,
  // the commands' keys and tooltips, as the menus have them (commands.js)
  shortcut, tip,
  tabs: [], tabFacts: {}, marks: {}, sounding: {}, markWords: { working: 'Rendering', ready: 'Done' }, tab: 0, name: 'untitled', duration: 0, hasOutput: false, whole: false, ran: false, problem: '', missing: '', notice: '', noticeKind: '', dropping: false, track: null, muted: [], locked: [], frozen: false, layout: null, hotBand: -1, trackRows: null, ghost: false, renamingTab: null,
  progress: '', figure: '', arrived: null, working: false, loading: false, arriving: false, lines: [], saves: [], exporting: false, shared: false, canUndo: false, canRedo: false,
  time: '0:00.000', held: null, span: 0, readout: '', reading: { of: '', head: '', rows: [] }, heard: null, selection: null, band: null, ranges: 0, boxes: 0, carets: 1, pauses: false, canPaste: false, playing: false, loop: false, recording: null,
  // the ring in Play's place (status), unless it plays or records
  get halting() { return this.working && !this.playing && !this.recording },
  specs, spec: oneOf(stored.spec, specs.map(s => s.key), ''), report: null, checking: false, ab: false, abGain: 0, canCompare: false,
  query: '', results: [], searching: false, searchState: '', previewing: -1,
  toolQuery: '', formats, clock,
  // The palette: the edits for what is selected first, worded for it, then every method by kind, each its
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
  // The check, rule by rule, pointed at in the bar (its spec's name there): each rule, the output's value and mark, its limit
  get checkRows() { return (this.report?.rules || []).map(ruled) },
  setSpec(key) { state.spec = key; store(); scheduleCheck(0) },
  toggleAB,
  // The clock, in the config's units: the playhead, or the caret, one time always, the ranges being on the
  // time row; after it how long all that is selected is, between bars as a length is marked. What is selected, in full, when
  // pointed at
  get timeText() { return this.time },
  get lengthText() { return this.recording ? this.recording.length ? clock(this.recording.length) : '' : this.span ? clock(this.span) : this.lengthPending ? '…' : this.hasOutput ? clock(this.duration) : time(0, this.units, { digits: 3 }) },
  // a sound on its way, its length not yet known (the one shown before it no longer the one coming), the page's first
  // run too: an ellipsis, how far it has come in its title; no sound, its length nothing (read as the page mounts,
  // before `state` is: its own units)
  // The bands' layers, each over its band, head to foot (index.html .layers): its look, its lock; a sound alone, or none
  // yet, one track as any (view.js banded), its name the tab's, the one edited, no lock (embedded, none: its lanes fill
  // the picture, its look the view's own)
  get layers() {
    const rows = this.layout?.rows ?? [], alone = !this.trackRows && !EMBED && rows.length ? [{ name: this.tabs.find(t => t.id === this.tab)?.name ?? '', muted: null, single: true }] : null
    return (this.trackRows ?? alone ?? []).map((t, i) => ({ ...t, i, band: t.single ? '' : t.name, top: rows[i]?.top ?? 0, h: rows[i] ? rows[i].bottom - rows[i].top : 0, lane: rows[i] ? `${rows[i].y} ${rows[i].h}` : '', on: t.single || t.name === this.track, kind: (!t.single && this.kinds[t.name]) || this.display }))
  },
  layerIcon: kind => KINDS[kind][1], layerKind: kind => KINDS[kind][0],
  get lengthPending() { return !this.recording && !this.span && (this.loading || this.arriving || !this.ran) },
  // the length is the whole sound's, none being selected
  get lengthWhole() { return !this.recording && !this.span },
  get length() { return this.duration ? clock(this.duration) : '' },
  // a click on the time brings the view to it; on the length, the selection shown whole, then all of it
  bringTime() { v.bring() },
  frameLength() { v.frameSelected() },
  // pointed at, in samples
  get lengthTitle() { return this.recording ? 'Take' : this.lengthPending ? `Length\n${this.arrived == null ? 'On its way' : `${Math.floor(this.arrived * 100)}% here`}` : !this.span && !this.hasOutput ? 'Length\nNo sound' : `${this.span ? 'Selected length' : 'Total length'}\n${samples(this.span || this.duration)} samples` },
  get timeTip() { this.time; return `${this.playing ? 'Playhead' : 'Caret'}\nSample ${samples(v && this.playing ? pl.time : v?.cursor ?? 0)}` },
  get timeTitle() {
    const sel = this.selection
    if (this.playing || this.recording || !this.span) return ''
    const length = this.span, rate = output?.sampleRate || 44100, what = this.ranges > 1 || !sel ? `${this.ranges} ranges` : `${stamp(sel[0])}–${stamp(sel[1])}`
    return `Selected ${what}: ${clock(length)}, ${Math.round(length * rate)} samples`
  },
  get plotHelp() {
    return `${displays.find(d => d.name === this.display).label}. Click to put the caret and hear the moment there, by a marker's line on the marker; drag to select a time range, a dragged edge or caret going onto the cues and markers near it; double-click selects the fragment between its cues, triple-click the sound between its pauses. Shift sums: a press or a drag extends the selection to it. Alt adds: another caret, range or fragment; dragged inside the selection, a copy of its audio, put in where it lands; and goes the other way: at a range's end it trims, stretches or speeds it, on the caret's line it opens silence. Dragged inside the selection, its audio moves over what is there. ⌘ aims and measures: held, every cue to snap to, the one under the pointer to drag, the pointer's place out to the axes, and how far it is from the selection, on the time row; on the spectrogram, a box of time and frequency; a drag aims finely. A caret's line or a range's edge drags, the others staying. On the time row under the tracks, a press moves the caret alone, a drag selects through every track, a hold drags the caret. Over the lanes, a marker's tag over the caret, pointed at there and clicked, asks a name and puts a marker there with it (over the selection, a range of it; over several carets, one each, named alike); a marker's name pressed selects it and every other of its name, Delete takes them away, and an edge or the caret dragged then takes the marker with it. A range's top corners fade it, outward crossfading; its pill sets its level; on notes, the tools at its foot a voice's intonation and formants. Right-click for the edits there; ⌘P finds any. The wheel scrolls; a pinch, or Ctrl and the wheel, zooms the frequencies or the levels over them and time elsewhere. On the notes, a press on a note selects it; dragged up or down, a row a semitone.${this.track ? ` Tracks, a lane each, play together: a press in a lane edits its track, a marker over it its own, a held caret there hears it alone; dragged on the time row, a range runs through every track, dragged from a lane into others through those, an edit of it each one's; dragged into another track's lane, a selection's audio goes into that track; its menu (right-click, Track) mutes, solos, locks and takes it away, its look at its head's right shows it as a waveform, a spectrogram or its notes; its lanes' bottom edge, dragged, its height (with Alt, every track's); under the last, a press puts a new track's caret, which a take, a paste or a file dropped there makes a track of; Move to a new track takes a selection to one of its own, Move the track to its own tab a track to a tab.` : ''}`
  },
  // a tab opens the panel on it; the tab shown, again, closes it (its tabs stay, to open it again)
  setSide(name) { state.side = state.side === name ? null : name; store() },
  toggleSide() { state.side = state.side ? null : 'code'; store() },
  get sideTitle() { return { edits: 'Edits', code: 'Code' }[this.side] ?? 'Panel' },
  // The agent: the bridge it is reached through and its key (kept in this browser), whether it is there, the agents it
  // found ({ id, name, models: [{ id, name }] }), the one asked and its model (null: its own choice); the open tab's
  // conversation, whether the agent is answering, the page's conversations, the message being written, whether the line
  // under the code has its address and key open. Its words are Markdown (markdown.js)
  bridgeUrl: stored.agent?.url || 'http://127.0.0.1:7777', bridgeKey: stored.agent?.key || '', agentStatus: 'off', agents: [], agentInfo: null, agentModel: null,
  get agentLabel() { const m = this.agentInfo?.models?.find(m => m.id === this.agentModel); return this.agentInfo ? this.agentInfo.name + (m ? ` · ${m.name}` : '') : '' },
  chat: [], chatBusy: false, chats: [], chatText: '', agentSetup: false,
  get agentNote() { return { off: 'Put the key in, then connect', connecting: 'Connecting…', offline: 'Not running: npx audio --bridge', replaced: 'Taken by another page', online: 'No agent on that machine: install one (Claude Code, Codex, Pi, Gemini CLI, Kimi Code…), then start the bridge again' }[this.agentStatus] },
  get chatTitle() { return this.chats.find(c => c.open)?.title ?? 'New conversation' },
  connectAgent, pickAgent, sendChat, chatKey, newChat, openChat, dropChat, showChat, md, partsOf, visit, tick: Date.now(), elapsed,
  undo: () => command('undo').run(), resizePanel,
  // the output as the whole chain makes it, from what a step takes out or the chain rolled back
  showAll: () => rk.choose(null),
  setFormat(name) { state.format = name; store() },
  // the format's own setting, as its choices: its default (null) first, then each value the library writes
  get encodingParam() {
    const e = ENCODING[this.format]
    return e && { key: e[0], label: e[1], values: [null, ...e[2]].map(v => ({ value: v, label: v == null ? 'Default' : e[3](v) })) }
  },
  setEncoding(key, value) { state.encoding = { ...state.encoding, [key]: value }; store() },
  // What the rate and the channels come to, pointed at (index.html #rate-facts, #channels-facts; worker.js facts read
  // once an output): the rate, the highest frequency it holds (half the rate, Nyquist), where its sound ends, the
  // samples as the page edits them; the channels, how alike two are, which side is louder, how they sum to mono, or
  // each one's level
  soundFacts: null,
  get rateRows() {
    const s = this.sound, f = this.soundFacts
    if (!s) return []
    const nyquist = s.hz / 2, khz = hz => `${+(hz / 1000).toFixed(1)}kHz`
    return [['Rate', s.rate, 'samples a second'], ['Holds', `up to ${khz(nyquist)}`, 'half its rate'],
      ...f?.top ? [['Sound', `up to ${khz(f.top)}`, f.top < nyquist * .85 ? 'nothing above: a lower rate or a lossy file once' : 'all the way up']] : [],
      ['In memory', bytes(this.duration * s.hz * s.count * 4), '32-bit float, as edited']]
  },
  get channelRows() {
    const s = this.sound, f = this.soundFacts
    if (!s) return []
    const db = v => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(1)}dB`, names = { 6: ['L', 'R', 'C', 'LFE', 'Ls', 'Rs'], 8: ['L', 'R', 'C', 'LFE', 'Lb', 'Rb', 'Ls', 'Rs'] }[s.count]
    const head = ['Channels', s.channels, layouts.find(l => l.count === s.count)?.text ?? '']
    if (s.count === 2 && f?.correlation != null) {
      const c = f.correlation
      return [head, ['Alike', `${c >= 0 ? '+' : '−'}${Math.abs(c).toFixed(2)}`, c > .9 ? 'nearly one sound twice' : c > .3 ? 'mostly alike, some width' : c > -.2 ? 'wide, apart' : 'one inverted? its menu flips it'],
        ['Balance', Math.abs(f.balance) < .5 ? 'centred' : `${f.balance > 0 ? 'left' : 'right'} ${db(Math.abs(f.balance))}`, 'the louder side'],
        ['To mono', db(f.summed), 'summed, how much quieter']]
    }
    return [head, ...(f?.levels ?? []).length > 1 ? f.levels.map((l, i) => [names?.[i] ?? `${i + 1}`, Number.isFinite(l) ? `${l.toFixed(1)}dBFS` : 'silent', 'its level']) : []]
  },
  // a verdict's icons: passes, fails, says only, waits
  passIcon: 'M5 12.5 9.5 17 19 7.5', failIcon: 'm7 7 10 10M17 7 7 17', infoIcon: 'M6 12h12', waitIcon: 'M12 7v5l3 2',
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
  layerLook, toggleLock, toggleMute, fitField,
  setLevels, setLook,
  blankView: on => { if (v) v.blank = on }, setDisplay, dropToggle, placeList, toggleLoop, undoList, goTo, toggleRecording, resampleTo, remixTo, channelActions, pickReading, pickSpec, seekTo, markLevel, unmarkLevel,
  togglePlay, playPress, playClick, stop, redo: () => command('redo').run(), mac, share, exportFiles,
  switchTab, tabPress, tabOver, tabRenamed, newTab, closeTab, dragTab, scrollTabs, toggleTabMute, pickFiles, openFiles, startRecording, stopRecording, armRecording, useSample, useCode, useRecipe, addOp, editSelection, toolKey, openTools,
  openSearch, closeSearch, runSearch, typeSearch, preview, useResult
})
assign({ state })

// The page's hints (hint.js): what a number in the code sets, what a drag on the picture does
const hints = hint(document.body)
// Its controls' tooltips, popoff's: every title, its name, its keys and a word more, on a tag pointing at it; loaded
// aside, so the page is whole without it (the browser's own titles then)
import('../assets/popoff.js').then(({ default: popoff }) => popoff()).catch(() => {})
// The script editor, on the document shown, the files its tabs open kept from before
const first = await initialDocs()
assign({ pl: playerOf(first) })
// the files kept read as the page comes up; a file dropped anywhere opened (files.js)
wireFiles()
assign({ ed: codeEditor(root.querySelector('.script-editor'), {
  hint: hints,
  wrap: EMBED,
  // embedded, CodeMirror comes with the code pane, if the page asks for one, or with an undo
  lazy: EMBED,
  doc: first.code,
  onchange(code, update) {
    const slider = !!update?.transactions.some(tr => tr.isUserEvent('input.slider'))
    // typing waits for a pause in the keys; a change made whole (a file opened, an edit on the picture, a recipe, undo)
    // runs at once
    const typed = !!update?.transactions.some(tr => tr.isUserEvent('input.type') || tr.isUserEvent('delete'))
    state.canUndo = ed.canUndo
    state.canRedo = ed.canRedo
    if (QUICK.length) state.made = stepsOf(code).filter(s => s.on).length
    focusOn(state.track)
    remember(code, slider)
    retitle()
    v.envelope = envelopeShown()
    v.shift = shiftOf(code)
    schedule(typed ? 250 : 0)
    later()
  },
  oncaret: update => { rk?.refresh(update); if (rechoose !== undefined) { rk.choose(rechoose); assign({ rechoose: undefined }) } },
  // CodeMirror come, after the page shows (script.js): the edits made before it are its history now
  onready() { state.canUndo = ed.canUndo; state.canRedo = ed.canRedo; if (QUICK.length) state.made = stepsOf(ed.code).filter(s => s.on).length },
  files: () => [...taken()],
  describe: name => eng.describe(name),
  keys: scriptKeys()
}) })
ed.open(first.id)
state.tab = eng.tab = first.id
state.track = first.track
state.muted = first.muted
state.locked = first.locked
focus(first.track)
retitle()
inSight()
store()

// The theme worn, VS Code's followed in its webview (look.js)
wireLook()

// The output view
v = view(root.querySelector('.plot'), {
  // embedded, no room under the lanes for a new track: the sound fills the frame; how far it zooms and scrolls past the
  // sound's end, as the page asks (?ui= zoom, overshoot: README.md)
  keepRoom: !EMBED,
  track: Number.isFinite(UI.track) && UI.track > 0 ? UI.track : null,
  zoom: UI.zoom,
  overshoot: UI.overshoot,
  // which cues come first where they crowd, zoomed out (?ui= cues: README.md)
  cues: UI.cues,
  // the axis as wide as its labels: the display switch under it (editor.css --axis)
  onaxis: px => root.querySelector('.panes').style.setProperty('--axis', `${px}px`),
  // measuring on the spectrogram, the spectrum meter reads under the pointer, then where it did again
  onprobe: t => meter(null, t),
  // a long output's samples where the view zooms in
  onsamples: (from, to) => output?.long ? eng.samples(output.id, from, to) : null,
  // its levels as heard, weighted, read through the output once it is whole; none while another is on its way
  onheard: weighting => output && !incoming ? eng.heard(output.id, weighting) : null,
  // another track's lane pressed: it is the one edited
  onfocus(i) { const name = laneName(i); if (name) focusOn(name) },
  // the caret in the room under the lanes, a new track's to be, or back in the edited track
  onghost(on) { state.ghost = on; meter() },
  // a sound's look pressed, in its foot: how it shows, by it
  onlook(name, button) { state.dropLane = name; openDropdown(button) },
  // bands' feet dragged: their heights, the tab's, kept with it (null: as they were made)
  onheight(changes) {
    const d = docOf(state.tab)
    if (!d) return
    const h = { ...d.heights }
    for (const [name, px] of Object.entries(changes)) if (px == null) delete h[name]; else h[name] = px
    d.heights = h
    store()
  },
  // the bands laid out anew: the layers line up with them
  onlayout(layout) { state.layout = layout },
  // the band pointed at, its look shown
  onband(i) { state.hotBand = i },
  // a take's number pressed on its place, it heard; its …, all of them as a menu under it; its +, an empty take added
  // there, heard, its place selected, Record then recording into it, never at once (another track's: it is the one
  // edited then)
  ontake(i, k, button) {
    // while it records, its passes are shown, not yet written: nothing to switch
    const run = !state.recording && placed[i]
    if (!run) return
    if (run.track != null && run.track !== state.track) focusOn(run.track)
    if (k === 'more') return bar.at(takeList(run), 0, 0, button)
    if (k !== 'add') return useTakeOf(run, k - 1)
    const [a, b] = reach(run), change = addTake(ed.code, run, b - a, lengthOf), [p, q] = span(run)
    if (!change) return note('An empty take is there already: R records into it')
    ed.change(change)
    v.select(p, Math.min(q, v.duration))
    note(`Take ${run.list.length + 2} added, empty: R records into it`)
  },
  // a named range's fork pressed: takes start there
  onfork: forkRange,
  // an edit still being made over part of the picture: nothing more is edited there till its output comes; playing goes
  // on as ever, the output it makes taking over as it comes
  onbusy(on) {
    state.frozen = on
    // the edits asked meanwhile, in turn, each made once the one before it is
    while (!state.frozen && queued.length) queued.shift()()
  },
  onselect(selection, band, ranges = [], boxes = []) {
    state.selection = selection
    state.boxes = boxes.length
    // the clock reads the caret, where a drag left the selection's moving end (view.js select), as it stays once the
    // selection is gone; play starts at the selection's start
    if (selection && !pl.playing) { state.time = stamp(v.cursor); pl.seek(selection[0]) }
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
  oncursor(t) { if (pl.playing) { if (!turning) pl.play(plays(t)) } else { state.time = stamp(t); meter(); pl.seek(t); listen(); later() } },
  // an edit made on the picture: true once it is written in the script
  // what a selection's handles and its audio dragged do, through every track the same, when it runs through them (spread)
  onedit(type, detail, data) {
    const act = { warp, envelope, pitch: shift, intonation: tone, formant, carry, tab: toTab, stretch, trim, lift, fade, crossfade, unmark, remark, label: nameMarker, relabel, pitchline, insert: silence }[type]
    const run = () => !!(act ? act(detail, type) : editSelection(type, detail, data))
    return ['carry', 'stretch', 'trim', 'lift', 'fade', 'crossfade'].includes(type) && !detail?.into ? spread(run) : run()
  },
  // a handle clicked: its next way, in turn, as a tool's options cycle, no menu (a fade corner's curve, the end's trim,
  // stretch or speed)
  onmode(kind) {
    const next = (list, now) => list[(list.findIndex(m => m.name === now) + 1) % list.length].name
    ;({ curve: () => setCurve(next(curves, state.fadeCurve)), grip: () => setGrip(next(gripModes, state.gripMode)) })[kind]()
  },
  // a marker's own menu: its name, its going; else the edits for what is under the pointer
  oncontext({ x, y, marker, room, track }) { bar.at(room ? roomMenu() : track != null && v.tracks ? trackMenu(track) : marker ? [{ label: 'Name…', hint: marker.label || '', run: marker.rename, icon: glyphs.marker }, { label: 'Delete the marker', run: marker.remove, icon: opIcons.remove }] : contextMenu(), x, y) },
  // a key the picture doesn't take itself (its caret, the marker chosen, a paste): the command for it there, if any
  onkey(event) { const c = pressed(event, true); c?.run(event); return !!c },
  onscrub,
  // a pitch, an intonation or formants dragged, heard as they will sound: the first 2 s of what they move, through the
  // library's pitch() (a voice's: a semitones, or the pitch line's curve, its times from where it is heard),
  // intonation() or formant(), as the script will have it; at none, as it is. A range or a note held (`whole`), all of
  // it as it is; with tracks, of its own track (`track`, its lane) alone, the others muted
  onaudition(o) {
    if (!o) return pl.audition(null)
    const { at } = o, voice = { voice: true }, others = o.track != null && v.tracks?.length > 1 ? v.tracks.filter((t, i) => i !== o.track).map(t => t.name) : null
    pl.audition(at, at + (o.whole ? o.duration : Math.min(o.duration, 2)), o.curve ? ['pitch', { t: o.curve.t.map(t => t - at), v: o.curve.v }, voice]
      : o.pitch ? ['pitch', o.pitch, voice] : o.intonation != null && o.intonation !== 1 ? ['intonation', o.intonation] : o.formant ? ['formant', o.formant] : o.gain ? ['gain', o.gain] : null, others)
  },
  hint: hints
})
assign({ v })
v.heights = first.heights ?? {}
v.display = state.display
v.kinds = state.kinds = first.kinds ?? {}
v.scale = state.scale
v.units = state.units
v.levels = state.levels
v.ruler = state.ruler
v.scroll = state.scroll
v.grid = state.grid
v.spectrogram = paint(state.look)
v.waveform = state.wave
// the speed kept from before
pl.rate = state.speed
// the panel as wide as it was left
if (state.panel) root.querySelector('.panes').style.setProperty('--panel', `${state.panel}px`)
v.show = state.show
v.snapping = state.snapping
v.fadeCurve = state.fadeCurve
v.gripMode = state.gripMode
v.pitching = state.pitch
v.envelope = envelopeShown()
v.shift = shiftOf(ed.code)
// The sound shown as it was left, at once, before the engine is up
standIn(first)
// The page is wired: its menus, its tabs, its script and its picture are all laid out, in the frame the first paint
// already drew. Shown after the view's first frame, so what comes up is the sound where it was left, never an empty
// picture that fills in after (editor.css, data-boot).
requestAnimationFrame(() => requestAnimationFrame(() => root.removeAttribute('data-boot')))
// The edits, the stack of the chain's steps, where the page asks for them (config.js STACKED); the card under the
// pointer draws what it sets over the output (ops.js guides), and none pointed at, what the agent's last edit sets.
// What the output shows when it is not the whole chain (the chain up to the step chosen, what a step takes out) runs
// in place of the script.
const stack = STACKED && (await import('./stack.js')).default
if (stack) assign({ rk: stack(root.querySelector('.steps'), {
  ed,
  ontake: switchTake,
  describe: name => eng.describe(name),
  duration: () => v.duration,
  // the sound the chain starts from; with tracks, the track's name before it
  source: () => { const s = source(ed.code), files = s?.strings.length ? s.strings.map(x => label(x.name)).join(' + ') : null; return files && state.track ? `${state.track} · ${files}` : files },
  oncall(call, spec, values) { assign({ carded: !!(call && spec) }); v.guides = carded ? guidesOf(call, spec, values) : shown?.guides ?? [] },
  onview(next) { assign({ viewing: next }); schedule(0) },
  // a gain() curve chosen, its line on the picture, to edit; none else (envelopeShown)
  onchoose: () => { v.envelope = envelopeShown() },
  // a slider's move shows on the picture at once, where a level says it (ops.js previews), until its output comes
  onpreview(name, was, is) { v.preview(previews[name]?.(was, is, v.duration) ?? null) },
  // a row's own menu, right-clicked; the chain up to a row made one sound
  oncontext({ x, y, items }) { bar.at(items, x, y) },
  onflatten: to => flatten(to),
  // with tracks, the one edited: its card's × takes it away
  track: () => state.track,
  onuntrack: untrack,
  keys
}) })
// the track edited one the script has (a link's script, opened anew, has none chosen): set before the page's state is
// all made, so nothing it shows is asked for yet
state.track = trackOf(state.track)
focus(state.track)
rk.refresh()
remember(ed.code)

// the app menu, the dropdown's and the popover menus' placing and closing, the help's keys (menus.js)
wireMenus()
// a run's outputs said again after the engine restarts; the page's settled, for what drives it (run.js)
wireRun()
// whether a GPU splits the voice (tracks.js)
wireTracks()
// the microphone ready for Record (recording.js)
wireRecording()
// the agent's bridge, connected if it has a key, and the conversation shown (chat.js)
wireChat()
// the strip of tabs faded where more of it is past either side (tabs.js)
wireTabs()
// the page's keys, and the focus and audio device a first press brings (keys.js)
wireKeys()
// Leaving: the tabs stored, a take's last part written as it can be; while a take records, or a file is still being
// written, the browser asks first. Hidden (a phone's app switched away, a laptop's lid), stored too, as it may not come back
addEventListener('pagehide', () => { store(); take?.tape?.flush(); pl.close(); recorder?.cancel() })
addEventListener('beforeunload', event => { if (recorder || writing.size) event.preventDefault() })
document.addEventListener('visibilitychange', () => { if (document.hidden) { store(); take?.tape?.flush() } })

evaluate()
if (EMBED) store()
else if (!GIVEN) recover()
if (GIVEN && parent !== window) parent.postMessage({ ready: true }, location.origin)
