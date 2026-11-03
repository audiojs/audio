import sprae from '../assets/sprae.js'
import engine from './engine.js'
import codeEditor from './script.js'
import view, { KINDS } from './view.js'
import stack from './stack.js'
import recipes from './recipes.js'
import { ops, previews, GROUPS, labelOf, icons as groupIcons } from './ops.js'
import { source, steps as stepsOf, dropStep, tracks as tracksOf, focus, master as masterOf, addTake } from './code.js'
import { builtins } from './sources.js'
import scales from './scale.js'
import menubar from './menu.js'
import time, { UNITS } from './time.js'
import opIcons from './icons.js'
import hint from './hint.js'
import { methods as scrubbers } from './scrub-methods.js'
import md from './markdown.js'
import { THEMES } from './theme.js'
import { connectAgent, pickAgent, partsOf, showChat, newChat, openChat, dropChat, visit, elapsed, sendChat, chatKey, wire as wireChat } from './editor/chat.js'
import { wire as wireClipboard } from './editor/clipboard.js'
import { root, params, EMBED, UI, SHOWN, quickOf, QUICK, GIVEN, generators, formats, ENCODING, writtenDepth, DEPTH_USE, cutFormats, frameRates, KEEPS, icons, overlays, rulers, scrolls, grids, LOOK, looks, specMethods, WAVE, waveLooks, levelList, curves, glyphs, gripModes, SETTINGS_ICON, AGENT_ICON, RECIPES_ICON, displays, SPEEDS, SHUTTLE, times, tenths, scrubs, rates, layouts, specs, stored, oneOf, sideOf } from './editor/config.js'
import { ed, rk, pl, output, incoming, steps, rechoose, shown, carded, queued, assign } from './editor/context.js'
import { remember, undoList, goTo, editSelection, warp, carry, toTab, addOp, spread, flatten } from './editor/edits.js'
import { lengthOf, pickFiles, openFiles, taken, shelved, reopenable, unshelve, recover, useSample, NOTE, SOUND, useCode, useRecipe, openSearch, closeSearch, typeSearch, runSearch, preview, useResult, exportFiles, exportCuts, share, wire as wireFiles } from './editor/files.js'
import { bytes, mac, keys, clock, stamp, ruled, label, note } from './editor/format.js'
import { paint, worn, dress, setTheme, openTheme, settingSections, fold, lookMenu, resetView, toggleShow, setDisplay, laneGroups, setScale, setScrub, setUnits, setLevels, setRuler, setGrid, setStep, setSplice, setLook, resizePanel, flipView, wire as wireLook } from './editor/look.js'
import { writing, store, later, wire as wirePersist } from './editor/persist.js'
import { playerOf, toggleAB, toggleLoop, plays, playPress, setSpeed, playClick, togglePlay, toggleTabMute, onscrub, wire as wirePlay } from './editor/play.js'
import { meter, describe, markLevel, unmarkLevel, pickReading, pickHeard, listen } from './editor/readouts.js'
import { placed, toggleRecording, retakeHere, take, recorder, armRecording, startRecording, stopRecording, reach, span, takesHere, useTakeOf, forkRange, takeList, deletion, takesMenu, wire as wireRecording } from './editor/recording.js'
import { schedule, evaluate, stop, standIn, scheduleCheck, wire as wireRun } from './editor/run.js'
import { docOf, closed, initialDocs, retitle, tabPress, tabRenamed, switchTab, scrollTabs, inSight, newTab, dragTab, closeTab, reopenTab, wire as wireTabs } from './editor/tabs.js'
import { guidesOf } from './editor/tools.js'
import { trackMenu, layerPress, layerName, layerLook, layerMenu, toggleLock, renameLayer, fitField, renamed, nameNewTrack, roomMenu, toggleMute, focusOn, trackOf, laneName, newTrack, renameTrackTo, others, mastering, lineUp, matchUp, duckUnder, masterOut, untrack, detach, wire as wireTracks } from './editor/tracks.js'
import { resampleTo, remixTo, silence, stretch, trim, crossfade, lift, addMarker, unmark, relabel, remark, fade, setGrip, setPitch, setCurve, envelope, pitchline, envelopeShown, shiftOf, shift, tone, formant } from './editor/writers.js'

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
// the methods last used, the newest first (used)
let recent = Array.isArray(stored.recent) ? stored.recent.filter(n => typeof n === 'string').slice(0, 3) : []

const eng = engine()
assign({ eng })
// The channel samples the page holds of an output, 30 channel-minutes at 48 kHz: a longer one comes as its peaks, drawn
// from them, its samples fetched where the view zooms in (view.js summary), played by the engine (player.js)
eng.peaks = 30 * 60 * 48000
let v
// a copy made in another tab or window, pasted here (clipboard.js)
wireClipboard()
// the mark in the bar, drawn live (play.js)
wirePlay()

const state = sprae(root, {
  format: oneOf(stored.format, formats.map(f => f.name), 'wav'), encoding: { markers: true, ...stored.encoding }, snapping: stored.snap ?? true, fadeCurve: oneOf(stored.curve, curves.map(c => c.name), 'linear'), gripMode: ['trim', 'speed'].includes(stored.grip) ? stored.grip : 'stretch', pitch: false, settingsIcon: SETTINGS_ICON, recipesIcon: RECIPES_ICON, agentIcon: AGENT_ICON,
  overlayList: overlays.map(([name, label, title]) => ({ name, label, title })),
  unitList: UNITS.map(([name, label, example, short]) => ({ name, label, example, short })), levelList, levels: oneOf(stored.levels, ['db'], 'linear'),
  rulers, ruler: SHOWN.length && !SHOWN.includes('ruler') ? 'off' : oneOf(stored.ruler, rulers.map(r => r.name), 'labels'), scroll: oneOf(stored.scroll, scrolls.map(s => s[0]), 'bar'), grid: oneOf(stored.grid, grids.map(g => g[0]), 'none'), splices: [0, 5, 10, 20], splice: oneOf(stored.splice, [0, 5, 10, 20], 10), steps: [.1, 1, 3], levelStep: oneOf(stored.step, [.1, 1, 3], 1), look: Object.fromEntries(Object.entries(LOOK).map(([k, d]) => [k, oneOf(stored.look?.[k], k === 'method' ? specMethods.map(m => m[0]) : looks[k], d)])), wave: Object.fromEntries(Object.entries(WAVE).map(([k, d]) => [k, waveLooks[k].some(([v]) => v === stored.wave?.[k]) ? stored.wave[k] : d])),
  scrubs, scrub: scrubbers[stored.scrub] ? stored.scrub : 'hybrid', recordIn: stored.record === 2 ? 2 : 1,
  reads: oneOf(SHOWN.find(w => ['peak', 'rms', 'loudness'].includes(w)) ?? stored.reads, ['peak', 'rms', 'loudness'], 'peak'), hears: oneOf(stored.hears, ['note', 'key', 'tempo'], 'note'),
  // the settings' sections while their panel shows, each folded or not as it was left (`folds`); the picture's groups
  // while its dropdown is open
  get settingSections() { return this.side === 'settings' ? settingSections(this) : [] }, folds: stored.folds && typeof stored.folds === 'object' ? stored.folds : {},
  // how a band shows, the dropdown its look opens: the band's name (a sound's ''), what each track shows, its own
  dropdown: false, dropLane: '', kinds: {}, get displayGroups() { return this.dropdown ? laneGroups(this.dropLane, this) : [] },
  get dropTitle() { const kind = (this.dropLane && this.kinds[this.dropLane]) || this.display; return `${this.dropLane ? `${this.dropLane}: ` : ''}${displays.find(d => d.name === kind).label}` },
  // the speed it plays at, the pitch kept; how far through the sound it plays (Play's ring); the scale a held Play shows
  // while dragged
  speed: 1, played: 0, speedAxis: null, shuttle: null, speedTicks: SHUTTLE.ticks.map(t => ({ t, label: times(t), at: SHUTTLE.at(t) })),
  get shuttleText() { return tenths(this.shuttle ?? this.speed) },
  get shuttleAt() { return SHUTTLE.at(this.shuttle ?? this.speed) },
  display: oneOf(stored.display, displays.map(d => d.name), 'wave'), scale: scales[stored.scale] ? stored.scale : 'log', rates, layouts, sound: null, viewing: '',
  show: { hits: true, gain: true, meters: true, spectrum: stored.show?.meters ?? true, keys: true, guides: true, ...stored.show }, units: oneOf(stored.units, UNITS.map(u => u[0]), 'clock'),
  embed: EMBED, quick: QUICK, made: 0, soundMenu, opsMenu, saveMenu, flipView, lookIcons: KINDS, full: '', side: sideOf(stored.side), panel: Number.isFinite(stored.panel) ? stored.panel : null, pick: 0, keys,
  tabs: [], marks: {}, sounding: {}, markWords: { working: 'Rendering', ready: 'Done' }, tab: 0, name: 'untitled', duration: 0, hasOutput: false, whole: false, ran: false, problem: '', missing: '', notice: '', noticeKind: '', dropping: false, track: null, muted: [], locked: [], frozen: false, layout: null, trackRows: null, ghost: false, renaming: null, renamingTab: null,
  progress: '', figure: '', arrived: null, working: false, loading: false, arriving: false, lines: [], saves: [], exporting: false, shared: false, canUndo: false, canRedo: false,
  time: '0:00.000', span: 0, readout: '', reading: { of: '', head: '', rows: [] }, heard: null, selection: null, band: null, ranges: 0, boxes: 0, carets: 1, pauses: false, canPaste: false, playing: false, loop: false, recording: null,
  // the ring in Play's place (status), unless it plays or records
  get halting() { return this.working && !this.playing && !this.recording },
  specs, spec: oneOf(stored.spec, specs.map(s => s.key), ''), report: null, checking: false, ab: false, abGain: 0, canCompare: false,
  query: '', results: [], searching: false, searchState: '', previewing: -1,
  toolQuery: '', formats, clock,
  get recipeGroups() { return [...new Set(recipes.map(r => r.group))].map(name => ({ name, items: recipes.filter(r => r.group === name) })) },
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
  // The check, rule by rule, in the panel's Export tab: each rule, the output's value and mark, its limit
  get checkRows() { return (this.report?.rules || []).map(ruled) },
  setSpec(key) { state.spec = key; store(); scheduleCheck(0) },
  toggleAB,
  // The clock, in the units the settings choose: the playhead, or the caret, one time always, the ranges being on the
  // time row; after it how long all that is selected is, between bars as a length is marked. What is selected, in full, when
  // pointed at
  get timeText() { return this.time },
  get lengthText() { return this.recording ? this.recording.length ? clock(this.recording.length) : '' : this.span ? clock(this.span) : this.lengthPending ? '…' : this.hasOutput ? clock(this.duration) : time(0, this.units, { digits: 3 }) },
  // a sound on its way, its length not yet known (the one shown before it no longer the one coming), the page's first
  // run too: an ellipsis, how far it has come in its title; no sound, its length nothing (read as the page mounts,
  // before `state` is: its own units)
  // The tracks' layers, a row each on its band's head line over its lane (layerPress): its look, its name, its mute and
  // its lock
  get layers() {
    const rows = this.layout?.rows ?? []
    return (this.trackRows ?? []).map((t, i) => ({ ...t, i, band: t.name, top: rows[i]?.top ?? 0, h: rows[i] ? rows[i].y - rows[i].top : 0, lane: rows[i] ? `${rows[i].y} ${rows[i].h}` : '', on: t.name === this.track, kind: this.kinds[t.name] || this.display }))
  },
  layerIcon: kind => KINDS[kind][1], layerKind: kind => KINDS[kind][0],
  get lengthPending() { return !this.recording && !this.span && (this.loading || this.arriving || !this.ran) },
  // the length is the whole sound's, none being selected
  get lengthWhole() { return !this.recording && !this.span },
  get length() { return this.duration ? clock(this.duration) : '' },
  // a click on the time brings the view to it; on the length, the selection shown whole, then all of it
  bringTime() { v.bring() },
  frameLength() { v.frameSelected() },
  get lengthTitle() { return this.recording ? 'Take' : this.lengthPending ? `Length\n${this.arrived == null ? 'On its way' : `${Math.floor(this.arrived * 100)}% here`}` : !this.span && !this.hasOutput ? 'Length\nNo sound' : `${this.span ? 'Selection' : 'Length'}\nClick to fit` },
  get timeTip() { return `${this.playing ? 'Playhead' : 'Caret'}\nClick to show` },
  get timeTitle() {
    const sel = this.selection
    if (this.playing || this.recording || !this.span) return ''
    const length = this.span, rate = output?.sampleRate || 44100, what = this.ranges > 1 || !sel ? `${this.ranges} ranges` : `${stamp(sel[0])}–${stamp(sel[1])}`
    return `Selected ${what}: ${clock(length)}, ${Math.round(length * rate)} samples`
  },
  get plotHelp() {
    return `${displays.find(d => d.name === this.display).label}. Click to put the caret and hear the moment there, by a marker's line on the marker; drag to select a time range, a dragged edge or caret going onto the cues and markers near it; double-click selects the fragment between its cues, triple-click the sound between its pauses. Shift sums: a press or a drag extends the selection to it. Alt adds: another caret, range or fragment; dragged inside the selection, a copy of its audio, put in where it lands; held, it measures: every cue to snap to, the pointer's place out to the axes, and how far it is from the selection, on the time row. Dragged inside the selection, its audio moves over what is there. ⌘ aims: held, the cue under the pointer, to drag; a range's end sets its length; the cue under the pointer drags; on the spectrogram, a box of time and frequency; a drag aims finely. A caret's line or a range's edge drags, the others staying. On the time row, a press moves the caret alone, a drag selects, a hold drags the caret. A range's top corners fade it, outward crossfading; its pill sets its level, the tools at its foot a voice's pitch, intonation and formants; the square past its end trims, stretches or speeds it, a click on each turning it to the next; with none, the square past the caret opens silence. Right-click for the edits there; ⌘P finds any. The wheel scrolls; a pinch, or Ctrl and the wheel, zooms the frequencies or the levels over them and time elsewhere. On the notes, a press on a note selects it; dragged up or down, a row a semitone.${this.track ? ` Tracks, a lane each, play together: a press in a lane edits its track, a marker over it its own, a held caret there hears it alone; dragged on the time row, a range runs through every track, an edit of it each one's; dragged into another track's lane, a selection's audio goes into that track; its layer, on a head line over its lane, names, mutes (with Alt, solos) and locks it, its look shows it as a waveform, a spectrogram or its notes, right-clicked its menu; its foot under its lane, dragged, its height (with Alt, every track's); under the last, a press puts a new track's caret, which a take, a paste or a file dropped there makes a track of; Move to a new track takes a selection to one of its own, Move the track to its own tab a track to a tab.` : ''}`
  },
  // a tab opens the panel on it; the tab shown, again, closes it (its tabs stay, to open it again)
  setSide(name) { state.side = state.side === name ? null : name; store() },
  toggleSide() { state.side = state.side ? null : 'edits'; store() },
  get sideTitle() { return { recipes: 'Recipes', chat: 'Agent', edits: 'Edits', code: 'Code', export: 'Export', settings: 'Settings' }[this.side] ?? 'Panel' },
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
  layerPress, layerName, layerLook, layerMenu, toggleLock, toggleMute, renameLayer, renamed, nameNewTrack, fitField,
  toggleShow, setUnits, setLevels, setRuler, setStep, setLook, setSplice, setScrub,
  blankView: on => { if (v) v.blank = on }, setDisplay, dropToggle, placeList, fold, toggleLoop, undoList, goTo, toggleRecording, resampleTo, remixTo, pickReading, pickHeard, markLevel, unmarkLevel,
  togglePlay, playPress, playClick, stop, redo: () => ed.redo(), mac, share, exportFiles,
  switchTab, tabPress, tabRenamed, newTab, closeTab, dragTab, scrollTabs, toggleTabMute, pickFiles, openFiles, startRecording, stopRecording, armRecording, useSample, useCode, useRecipe, addOp, editSelection, toolKey, openTools,
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
  keys: { 'Mod-Enter': togglePlay, 'Mod-s': () => exportFiles() }
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
  zoom: UI.zoom,
  overshoot: UI.overshoot,
  // a trial, ?row=band: the time row in the strip of the band pointed at, not at the picture's foot
  timeRow: params.get('row') === 'band' ? 'band' : 'foot',
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
  // a take's number pressed on its place, it heard; its …, all of them as a menu under it; its +, an empty take added
  // there, heard, its place selected, Record then recording into it, never at once (another track's: it is the one
  // edited then)
  ontake(i, k, button) {
    // while it records, its passes are shown, not yet written: nothing to switch
    const run = !state.recording && placed[i]
    if (!run) return
    if (run.track != null && run.track !== state.track) focusOn(run.track)
    if (k === 'more') return bar.at(takeList(run), 0, 0, button)
    if (k !== 'add') return useTakeOf(run, k)
    const [a, b] = reach(run), change = addTake(ed.code, run, b - a, lengthOf), [p, q] = span(run)
    if (!change) return note('An empty take is there already: R records into it')
    ed.change(change)
    v.select(p, Math.min(q, v.duration))
    note(`Take ${run.list.length + 1} added, empty: R records into it`)
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
  oncursor(t) { if (pl.playing) pl.play(plays(t)); else { state.time = stamp(t); meter(); pl.seek(t); listen(); later() } },
  // an edit made on the picture: true once it is written in the script
  // what a selection's handles and its audio dragged do, through every track the same, when it runs through them (spread)
  onedit(type, detail, data) {
    const act = { warp, envelope, pitch: shift, intonation: tone, formant, carry, tab: toTab, stretch, trim, lift, fade, crossfade, unmark, remark, relabel, pitchline, insert: silence, name: renameTrackTo }[type]
    const run = () => !!(act ? act(detail, type) : editSelection(type, detail, data))
    return ['carry', 'stretch', 'trim', 'lift', 'fade', 'crossfade'].includes(type) && !detail?.into ? spread(run) : run()
  },
  // a handle clicked: its next way, in turn, as a tool's options cycle, no menu (a fade corner's curve, the grip's trim,
  // stretch or speed; the pitch tool's curve shown or not)
  onmode(kind) {
    const next = (list, now) => list[(list.findIndex(m => m.name === now) + 1) % list.length].name
    ;({ curve: () => setCurve(next(curves, state.fadeCurve)), grip: () => setGrip(next(gripModes, state.gripMode)), pitch: () => setPitch(!state.pitch) })[kind]()
  },
  // a marker's own menu: its name, its going; else the edits for what is under the pointer
  oncontext({ x, y, marker, room, track }) { bar.at(room ? roomMenu() : track != null ? trackMenu(track) : marker ? [{ label: 'Name…', hint: marker.label || '', run: marker.rename, icon: glyphs.marker }, { label: 'Delete the marker', run: () => unmark(marker), icon: opIcons.remove }] : contextMenu(), x, y) },
  onscrub,
  // a pitch, an intonation or formants dragged, heard as they will sound: the first 2 s of what they move, through the
  // library's pitch() (a voice's: a semitones, or the pitch line's curve, its times from where it is heard),
  // intonation() or formant(), as the script will have it; at none, as it is. A range or a note held (`whole`), all of
  // it as it is
  onaudition(o) {
    if (!o) return pl.audition(null)
    const { at } = o, voice = { voice: true }
    pl.audition(at, at + (o.whole ? o.duration : Math.min(o.duration, 2)), o.curve ? ['pitch', { t: o.curve.t.map(t => t - at), v: o.curve.v }, voice]
      : o.pitch ? ['pitch', o.pitch, voice] : o.intonation != null && o.intonation !== 1 ? ['intonation', o.intonation] : o.formant ? ['formant', o.formant] : o.gain ? ['gain', o.gain] : null)
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
v.envelope = envelopeShown()
v.shift = shiftOf(ed.code)
// The sound shown as it was left, at once, before the engine is up
standIn(first)
// The page is wired: its menus, its tabs, its script and its picture are all laid out, in the frame the first paint
// already drew. Shown after the view's first frame, so what comes up is the sound where it was left, never an empty
// picture that fills in after (editor.css, data-boot).
requestAnimationFrame(() => requestAnimationFrame(() => root.removeAttribute('data-boot')))
// The edits, the stack of the chain's steps; the card under the pointer draws what it sets over the output (ops.js
// guides), and none pointed at, what the agent's last edit sets. What the output shows when it is not the whole chain
// (the chain up to the step chosen, what a step takes out) runs in place of the script.
assign({ rk: stack(root.querySelector('.steps'), {
  ed,
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

// The app menu: everything the page does, each where apps put it, with its keys (menu.js). Items that can't act now
// show, dimmed, so the menu also says what there is.
function menus() {
  const sel = v.selection, band = v.band, whole = state.whole, none = !whole, here = state.hasOutput && takesHere(), lately = reopenable(), names = others()
  const check = (label, checked, run, extra) => ({ label, checked, run, ...extra })
  const recipesMenu = [...new Set(recipes.map(r => r.group))].flatMap(group => [{ group }, ...recipes.filter(r => r.group === group).map(r => ({ label: r.name, hint: r.text, run: () => useRecipe(r) }))])
  // a track's own edits with another (others): one submenu each, that one's name picked
  const withOther = (label, hint, act) => ({ label, hint, items: names.map(name => ({ label: name, run: () => act(name) })), disabled: !names.length })
  return [
    // the sound: where it comes from, where it goes, its tab
    { name: 'File', items: [
      { label: 'New tab', hint: 'An empty track', run: () => newTab() },
      { label: 'Open file…', keys: keys('⌘O'), run: pickFiles },
      { label: 'Open recent', items: [...lately.map(r => ({ label: r.name, hint: r.meta, run: r.run })), '-', { label: 'Delete kept sounds…', hint: 'Opened or recorded here, in no tab', run: unshelve, disabled: !shelved().length }], disabled: !lately.length },
      { label: 'Find a sound…', tip: 'Freesound, Jamendo, Wikimedia', run: openSearch },
      { label: 'Sample or generate', items: [{ group: 'Samples' }, ...Object.entries(builtins).map(([name, text]) => ({ label: name, hint: text, run: () => useSample(name) })), { group: 'Generate' }, ...generators.map(g => ({ label: g.name, hint: g.text, run: () => useCode(g.code) }))] },
      '-',
      { label: state.saves.length > 1 ? `Export ${state.saves.length} files` : 'Export', keys: keys('⌘S'), run: exportFiles, disabled: none || state.exporting },
      { label: 'Export as', items: [
        ...formats.map(f => check(f.name.toUpperCase(), state.format === f.name, () => state.setFormat(f.name), { hint: f.text, disabled: state.saves.length > 0 })),
        '-',
        { label: 'Each part between markers', tip: 'A file per part', run: () => exportFiles(true), disabled: none || !output?.markers?.some(m => !m.duration) },
        { label: 'The track alone', hint: state.track ?? '', run: () => exportFiles(false, state.track), disabled: none || !state.track },
        { label: 'Each track', hint: state.track ? `${tracksOf(ed.code).length} files` : '', run: () => exportFiles(false, true), disabled: none || !state.track }
      ] },
      { label: 'Check against', items: specs.map(sp => check(sp.label, state.spec === sp.key, () => state.setSpec(sp.key))) },
      { label: 'Copy a link to this script', tip: 'Files opened here are not in it', run: share },
      '-',
      { label: 'Close tab', run: () => closeTab() },
      { label: 'Reopen closed tab', keys: keys('⇧⌘T'), run: reopenTab, disabled: !closed.length }
    ] },
    // what is selected, and the script's own history and groups
    { name: 'Edit', items: [
      { label: 'Undo', keys: keys('⌘Z'), run: () => ed.undo(), disabled: !state.canUndo },
      { label: 'Redo', keys: keys('⇧⌘Z'), run: () => ed.redo(), disabled: !state.canRedo },
      { label: 'History', items: undoList().map(step => check(step.label, step.current, () => goTo(step.index), { hint: step.ahead ? 'undone' : '' })), disabled: steps.length < 2 },
      '-',
      edit('Cut', 'cut', '⌘X', sel && !band),
      edit('Copy', 'copy', '⌘C', sel && !band),
      edit('Paste', 'paste', '⌘V', state.canPaste),
      edit('Delete', 'remove', '⌫', sel),
      edit('Crop', 'crop', 'K', sel && !band),
      '-',
      { label: sel ? 'Mark the selection' : 'Add a marker', keys: 'M', tip: 'A click on a marker\'s name renames it', run: addMarker, disabled: none },
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
      { label: 'The next one like it, too', keys: keys('⌘D'), tip: 'The next pause, or stretch between cues\nAlt and drag adds any other range', run: () => v.addNext(), disabled: !sel || !!band },
      '-',
      { label: 'Move the caret', hint: 'With Shift, the selection', items: [
        { label: 'To the next cue', keys: keys('⌥→'), run: () => v.step('fragment', 1) },
        { label: 'To the cue before', keys: keys('⌥←'), run: () => v.step('fragment', -1) },
        { label: 'To the next sound', keys: keys('⌘→'), run: () => v.step('sound', 1) },
        { label: 'To the sound before', keys: keys('⌘←'), run: () => v.step('sound', -1) },
        { label: 'To the start', keys: 'Home', run: () => v.setCursor(0) },
        { label: 'To the end', keys: 'End', run: () => v.setCursor(v.duration) }
      ], disabled: none }
    ] },
    { name: 'View', items: [
      ...displays.map(d => check(d.label, state.display === d.name, () => setDisplay(d.name))),
      lookMenu('wave'), lookMenu('spec'),
      { label: 'Grid', items: grids.map(([name, label, hint]) => check(label, state.grid === name, () => setGrid(name), { hint })) },
      '-',
      { label: 'Show', items: [
        ...overlays.map(([name, label, tip]) => check(label, state.show[name], () => toggleShow(name), { tip })),
        check('Pitch curve', state.pitch, () => setPitch(!state.pitch), { tip: 'The voice\'s pitch on the spectrogram, dragged whole or by its bends; a click on a selection\'s pitch tool shows it too' })
      ] },
      check('Snap to cues and markers', state.snapping, () => state.toggleSnap(), { tip: 'Hold Alt to see them' }),
      { label: 'Zoom', items: [
        { label: 'In', keys: '=', run: () => v.zoom(.5) },
        { label: 'Out', keys: '−', run: () => v.zoom(2) },
        { label: 'To the selection', run: () => v.zoomTo(...sel), disabled: !sel },
        { label: 'All of it', keys: '0', run: () => v.fit() }
      ], disabled: none },
      '-',
      { label: 'Panel', items: [
        check('Shown', !!state.side, () => state.toggleSide()),
        '-',
        ...[['recipes', 'Recipes'], ['chat', 'Agent'], ['edits', 'Edits'], ['code', 'Code'], ['export', 'Export'], ['settings', 'Settings']].map(([name, label]) => check(label, state.side === name, () => state.setSide(name)))
      ] },
      { label: 'Theme', items: [
        check('The screen', !worn, () => dress(null), { hint: 'Grey on black, as the site draws it' }),
        ...[['Light', /^light/], ['Dark', /^dark/], ['High contrast', /^hc/]].flatMap(([group, kind]) => ['-', { group }, ...THEMES.filter(t => kind.test(t.kind)).map(t => check(t.name, worn?.name === t.name, () => setTheme(t)))]),
        ...worn && !THEMES.some(t => t.name === worn.name) ? ['-', check(worn.name, true, () => {})] : [],
        '-',
        { label: 'Open a VS Code theme…', hint: 'Any theme\'s .json file', run: openTheme }
      ] },
      { label: 'Times in', items: UNITS.map(([name, label, example]) => check(label, state.units === name, () => setUnits(name), { hint: example })) },
      '-',
      { label: 'Reset the view', run: resetView }
    ] },
    // the sounds side by side: one made, split off, set against another, mixed, taken away
    { name: 'Track', items: [
      { label: 'New track', hint: 'Or double-click under the lanes', run: newTrack, disabled: none || mastering() },
      { label: 'New track from a file…', hint: 'Under the one edited, played with it', run: () => pickFiles('', true), disabled: none },
      edit('Move to a new track', 'track', '', sel && !band && state.ranges < 2),
      { label: 'Split the voice to a new track', hint: 'The rest stays here', run: () => editSelection('voice'), disabled: none || mastering() },
      { label: 'Split into four stems', hint: 'Voice, bass, drums; the rest stays here', run: () => editSelection('stems'), disabled: none || mastering() },
      '-',
      withOther('Line up with', 'In time, by where the two agree', lineUp),
      withOther('Match with', 'Its tone, then its loudness', matchUp),
      withOther('Duck under', 'Quieter while it sounds', duckUnder),
      { label: 'Add a master', hint: 'The tracks\' sum, through steps of its own', run: masterOut, disabled: !state.track || !!masterOf(ed.code) },
      '-',
      { label: 'Move the track to its own tab', hint: state.track ?? '', run: detach, disabled: !state.track || mastering() },
      { label: 'Delete the track', hint: state.track ?? '', run: untrack, disabled: !state.track }
    ] },
    { name: 'Process', items: [
      { label: 'Recipes', items: recipesMenu },
      '-',
      ...kinds().map(k => ({ ...k, disabled: none })),
      '-',
      { label: sel ? 'Find an edit for the selection…' : 'Find an edit…', keys: keys('⌘P'), run: () => openTools(), disabled: none }
    ] },
    // what plays and what records, the takes recorded
    { name: 'Transport', items: [
      { label: state.playing ? 'Pause' : sel ? 'Play the selection' : 'Play from the caret', keys: 'Space', tip: 'Hold Play and drag to rewind or skip', run: togglePlay, disabled: !whole || !!state.recording },
      check('Loop', state.loop, toggleLoop, { keys: 'L', disabled: !whole }),
      check('Hear it before the edits', state.ab, toggleAB, { keys: 'B', tip: 'The original, level-matched', disabled: !state.canCompare }),
      { label: 'Speed', hint: 'Pitch kept', items: SPEEDS.list.map(r => check(`${r}×`, state.speed === r, () => setSpeed(r))) },
      '-',
      { label: state.whole ? 'Record at the caret' : 'Record', keys: 'R', run: startRecording, disabled: !!state.recording },
      { label: 'Record a new track', hint: 'The others playing', keys: '⇧R', run: () => startRecording(true), disabled: !!state.recording || none },
      { label: 'Record another take', hint: 'Of the recording at the caret', keys: '⌥R', run: retakeHere, disabled: !!state.recording || none },
      here ? { label: 'Takes', hint: `${here.list.length} here`, items: [...takeList(here), '-', deletion(here)] }
        : { label: 'Takes', hint: 'Record again where a take went in, or with the loop on', disabled: true }
    ] },
    { name: 'Help', items: [
      { label: 'Mouse and keys', run: () => root.querySelector('dialog.help').showModal() },
      { label: 'The library, audio', run: () => open('https://github.com/audiojs/audio#readme', '_blank', 'noopener') },
      { label: 'This page’s source', run: () => open('https://github.com/audiojs/audio/tree/master/playground', '_blank', 'noopener') }
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
// How a band shows (its look, in its layer): a dropdown by it, as Figma's, every group in sight, no levels to go
// through; the look again, a press outside or Esc closes it, another band's moves it there
let dropOwner = null
// (`owner` by what it opens for: a layer's look drawn again, as the layers are, is the same look)
const sameOwner = (a, b) => !!a && !!b && (a === b || a.matches('.layer-look') && b.matches('.layer-look') && a.dataset.band === b.dataset.band)
function openDropdown(owner) {
  const panel = root.querySelector('.dropdown'), again = sameOwner(owner, dropOwner)
  if (panel.matches(':popover-open')) { closeDropdown(); if (again) return }
  dropOwner = owner
  state.dropdown = true
  owner.setAttribute('aria-expanded', 'true')
  panel.showPopover()
  // its right edge at its tab's, as wide as its groups, which fill in after it opens: held by that edge, not its left
  // (a layer's look, at the picture's left: its left edge at its owner's)
  const r = owner.getBoundingClientRect(), up = r.top > innerHeight - r.bottom
  Object.assign(panel.style, r.left + r.width / 2 < innerWidth / 2 ? { left: `${Math.max(8, r.left)}px`, right: 'auto' } : { left: 'auto', right: `${Math.max(8, innerWidth - r.right)}px` })
  // over its tab where the window has more room over it than under it (the bar's foot), held there by its own foot as
  // its groups fill in, else under it; within what is left of the window that
  // side, scrolled within: the groups fill in after it is placed
  Object.assign(panel.style, up ? { top: 'auto', bottom: `${innerHeight - r.top + 6}px`, maxHeight: `${r.top - 14}px` } : { top: `${r.bottom + 6}px`, bottom: 'auto', maxHeight: `${innerHeight - r.bottom - 14}px` })
}
// closed: at once by its button or a press outside, or by Esc (the popover's own toggle)
function closeDropdown() {
  const panel = root.querySelector('.dropdown')
  if (panel.matches(':popover-open')) panel.hidePopover()
  dropOwner?.setAttribute('aria-expanded', 'false')
  dropOwner = null
  state.dropdown = false
}
function dropToggle(event) { if (event.target === event.currentTarget && event.newState === 'closed' && dropOwner) closeDropdown() }
// A menu a button opens (popovertarget: the status bar's facts): under the button, its left
// edge at the button's, or over it where there is no room under it, within the window. Set as it opens: CSS anchor
// positioning leaves it in the window's middle in a browser that has no anchor from its button (implicit anchors: Chrome
// 133, not yet Safari nor Firefox, MDN). Placed as it opens: measured in the frame it first shows in, before that frame
// is painted (it shows only once its open is done, after this event, so not before), never seen where it does not stay
let invoker = null
addEventListener('click', event => { invoker = event.target.closest?.('[popovertarget]') ?? invoker }, true)
document.addEventListener('beforetoggle', event => {
  const m = event.target, by = invoker
  if (event.newState !== 'open' || !m.matches?.('.menu[popover]:not(.menubar-list)') || by?.getAttribute('popovertarget') !== m.id) return
  requestAnimationFrame(() => {
    const r = by.getBoundingClientRect(), w = m.offsetWidth, h = m.offsetHeight
    const top = r.bottom + 6 + h <= innerHeight - 8 ? r.bottom + 6 : Math.max(8, r.top - 6 - h)
    Object.assign(m.style, { positionArea: 'none', inset: 'auto', margin: '0', left: `${Math.max(8, Math.min(r.left, innerWidth - 8 - w))}px`, top: `${top}px` })
  })
}, true)
// A select in it, a look's (colours): its list under its button, as wide at least, or over it where the window ends
function placeList(event) {
  if (event.newState !== 'open') return
  const list = event.target, r = list.previousElementSibling.getBoundingClientRect(), h = list.offsetHeight
  const top = r.bottom + 4 + h > innerHeight - 8 ? Math.max(8, r.top - 4 - h) : r.bottom + 4
  Object.assign(list.style, { left: `${r.left}px`, top: `${top}px`, minWidth: `${r.width}px` })
}
// Esc with the keys in it (a choice just pressed) closes it too, the keys back on its button
root.querySelector('.dropdown').addEventListener('keydown', event => {
  // a select's list open in it closes alone, as a popover of its own
  if (event.key !== 'Escape' || event.target.closest('.select-list')) return
  event.preventDefault()
  const owner = dropOwner
  closeDropdown()
  owner?.focus()
})
// a press outside the dropdown and its button closes it
addEventListener('pointerdown', event => {
  const panel = root.querySelector('.dropdown')
  if (panel.matches(':popover-open') && !panel.contains(event.target) && !dropOwner?.contains(event.target) && !sameOwner(event.target.closest?.('.layer-look'), dropOwner)) closeDropdown()
}, true)
// The picture's context menu (a right-click on it): what is done to what is under the pointer and nothing else, as
// Audacity's on a clip. What the picture has a handle for leaves it (the fades, the corners; the level, the pill), and
// how it draws is the settings'. Then the methods last used, each written for it, and every method by kind, as Process
// has them, what the selection is most often given of each kind leading its list (a crossfade across it; the clicks
// taken out, a rebuild, the noise learned there), each a step of the chain; ⌘P finds any. At the caret: paste, a
// marker, all of it, and the methods for all of it
function contextMenu() {
  const list = v.ranges, several = list.length > 1, here = takesHere()
  const lead = (label, name) => ({ label, run: () => addOp(name, false), icon: opIcons[name], op: name })
  const act = (label, type, key, when, icon) => ({ ...edit(label, type, key, when), icon, op: type })
  const repair = [act(several || v.boxes.length > 1 ? 'Remove the clicks in each' : 'Remove the clicks here', 'declick', '', true, opIcons.declick), act('Rebuild from around it', 'repair', '', !several, opIcons.repair), act('Take this noise out everywhere', 'denoise', '', true, opIcons.denoise)]
  // what the press means to do with what is there, then every method under one Process, the last used first, none twice
  const process = (own, leads = {}) => [...own, '-', { label: 'Process', icon: groupIcons.Level, items: [...recents(leads).slice(1), ...recents(leads).length ? ['-'] : [], ...kinds(leads, false, own.map(it => it.op)), '-', { label: 'Find an edit…', keys: keys('⌘P'), run: () => openTools(), icon: glyphs.find }] }]
  // a band has no pill: its level stays here
  if (v.band) return process([act('Delete the band', 'remove', '⌫', true, opIcons.remove), act('6 dB quieter', 'quieter', '', true, glyphs.down), act('6 dB louder', 'louder', '', true, glyphs.up)], { Repair: repair })
  if (!list.length) return process([
    act(v.carets.length > 1 ? `Paste at all ${v.carets.length} carets` : 'Paste', 'paste', '⌘V', state.canPaste, opIcons.paste),
    { label: v.carets.length > 1 ? 'A marker at each caret' : 'Add a marker', keys: 'M', run: addMarker, icon: glyphs.marker },
    ...here ? takesMenu(here) : []
  ])
  // (to a new track by a drag under the tracks; zoomed to by the length in the bar)
  return [
    ...process([
      act('Cut', 'cut', '⌘X', !several, opIcons.cut), act('Copy', 'copy', '⌘C', !several, opIcons.copy), act('Paste', 'paste', '⌘V', state.canPaste && !several, opIcons.paste), act('Delete', 'remove', '⌫', true, opIcons.remove),
      act('Crop', 'crop', 'K', !several, opIcons.crop),
      { label: several ? 'Mark each' : 'Mark it', keys: 'M', run: addMarker, icon: glyphs.marker },
      ...here ? takesMenu(here) : []
    ], { Edit: [lead('Reverse', 'reverse')], Level: [lead('Crossfade across it', 'crossfade'), lead('Normalize', 'normalize')], Repair: repair })
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
  if (selection) return [t('crop', 'Crop', 'K'), t('remove', 'Delete', '⌫'), t('cut', 'Cut', '⌘X'), t('copy', 'Copy', '⌘C'), t('track', 'Move to a new track'), t('quieter', '3 dB quieter'), t('louder', '3 dB louder'), t('declick', 'The clicks here, taken out'), t('repair', 'Rebuild from its surroundings'), t('denoise', 'The noise here, taken 12 dB down everywhere', '', 'repair')]
  // several carets: a paste at each, a marker at each
  if (carets > 1) return [...(canPaste ? [t('paste', `Paste at all ${carets}`, '⌘V')] : []), t('mark', `A marker at each of the ${carets} carets`, 'M', 'paste')]
  return [...canPaste ? [t('paste', 'Paste at the caret', '⌘V')] : [], ...whole ? [t('voice', 'Split the voice to a new track', '', 'vocals'), t('stems', 'Split into four stems: voice, bass, drums, the rest', '', 'rebalance')] : []]
}
// a run's outputs said again after the engine restarts; the page's settled, for what drives it (run.js)
wireRun()
// whether a GPU splits the voice (tracks.js)
wireTracks()
// The palette's keys: the arrows go through what it found, Enter takes it, Escape closes it
function toolKey(event) {
  const items = state.toolGroups.flatMap(g => g.items), k = event.key
  if (k === 'ArrowDown' || k === 'ArrowUp') { event.preventDefault(); state.pick = (state.pick + (k === 'ArrowDown' ? 1 : items.length - 1)) % Math.max(1, items.length) }
  else if (k === 'Enter') { event.preventDefault(); items[Math.min(state.pick, items.length - 1)]?.run() }
  else if (k === 'Escape') { event.preventDefault(); closePalette() }
}
function soundMenu(event) {
  bar.at([
    { label: 'Open a file…', hint: 'WAV, MP3, FLAC and more', icon: NOTE, run: () => pickFiles() },
    { label: state.recording ? 'Stop recording' : 'Record', hint: 'Over the sound, from the caret', icon: 'M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10Z', run: () => toggleRecording(), disabled: state.playing },
    '-',
    ...Object.entries(builtins).map(([name, text]) => ({ label: name, hint: text, icon: SOUND, checked: name === state.name, run: () => useSample(name, 'replace') }))
  ], 0, 0, event.currentTarget)
}
// Embedded (?ops=), the page's quick edits under one button, each with a line on what it does: first the edits made, in
// their order, checked, one pressed taken away (dropStep), as a switch turns a filter off; then those of the page's not
// made, each made as the menus make it. The button counts the edits made (`made`)
function opsMenu(event) {
  const made = stepsOf(ed.code).map((s, i) => ({ ...s, i })).filter(s => s.on), rest = QUICK.filter(q => !made.some(s => s.name === q.name))
  bar.at([
    ...made.map(s => ({ label: labelOf(s.name), hint: quickOf(s.text.slice(1))?.values ?? '', about: ops[s.name]?.text, checked: true, run: () => ed.change(dropStep(ed.code, s.i)) })),
    ...made.length && rest.length ? ['-'] : [],
    ...rest.map(q => ({ label: q.label, hint: q.values, about: q.text, icon: q.icon, run: () => addOp(q.name, false, q.args) }))
  ], 0, 0, event.currentTarget)
}
// Embedded (?controls= save), the result saved in the format picked, as Export as picks one
function saveMenu(event) {
  bar.at(formats.map(f => ({ label: f.name.toUpperCase(), hint: f.text, checked: f.name === state.format, run: () => { state.setFormat(f.name); exportFiles() } })), 0, 0, event.currentTarget)
}
// Every popover over the page closed; the look's dropdown by closeDropdown, so its owner and state say so at once, not
// when the popover's toggle event comes
const closeMenus = () => { closeDropdown(); for (const menu of root.querySelectorAll('[popover]')) if (menu.matches(':popover-open')) menu.hidePopover() }
// the microphone ready for Record (recording.js)
wireRecording()
// the agent's bridge, connected if it has a key, and the conversation shown (chat.js)
wireChat()
// the strip of tabs faded where more of it is past either side (tabs.js)
wireTabs()

// Esc closes an open menu and does nothing else: the selection under it stays. A menu that has the keys (the menubar's)
// closes itself
document.addEventListener('keydown', event => {
  const open = event.key === 'Escape' && !event.target.closest?.('[popover], .menubar') && root.querySelector('[popover]:popover-open')
  if (!open) return
  event.preventDefault()
  event.stopPropagation()
  open.hidePopover()
}, true)
// The window left (another app; embedded, a press on the page around it): whatever is open over the page closes, its
// menus, lists and a look's dropdown, as on a press outside them (menu.js closes its own)
addEventListener('blur', closeMenus)
document.addEventListener('keydown', event => {
  const mod = event.metaKey || event.ctrlKey, typing = event.target.closest?.('.cm-editor, input, textarea, select, dialog')
  if (!typing && !mod && !event.altKey && event.key.toLowerCase() === 'b' && state.whole) { event.preventDefault(); toggleAB() }
  else if (!typing && !mod && !event.altKey && event.key.toLowerCase() === 'm' && state.whole) { event.preventDefault(); addMarker() }
  else if (!typing && !mod && !event.altKey && event.key.toLowerCase() === 'k' && state.selection && !state.band) { event.preventDefault(); editSelection('crop') }
  else if (!typing && !mod && !event.altKey && event.key.toLowerCase() === 'l' && state.whole) { event.preventDefault(); toggleLoop() }
  else if (!typing && !mod && event.code === 'KeyR' && !state.playing && state.shuttle == null && !state.halting && !event.repeat) { event.preventDefault(); state.recording ? stopRecording() : event.altKey ? retakeHere() : startRecording(event.shiftKey && state.whole) }
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
// A press in it gives it the keys, whatever took it: embedded, a frame a press doesn't focus (a button kept from taking
// focus, as above) would leave Space to the page around it, and miss leaving when the next press is there (blur)
addEventListener('pointerdown', () => document.hasFocus() || window.focus(), true)
// The first touch of the page opens the audio device, so the first play starts at once
for (const type of ['pointerdown', 'keydown']) addEventListener(type, () => pl.warm(), { capture: true, once: true })
// Leaving: the tabs stored, a take's last part written as it can be; while a take records, or a file is still being
// written, the browser asks first. Hidden (a phone's app switched away, a laptop's lid), stored too, as it may not come back
addEventListener('pagehide', () => { store(); take?.tape?.flush(); pl.close(); recorder?.cancel() })
addEventListener('beforeunload', event => { if (recorder || writing.size) event.preventDefault() })
document.addEventListener('visibilitychange', () => { if (document.hidden) { store(); take?.tape?.flush() } })

evaluate()
if (EMBED) store()
else if (!GIVEN) recover()
if (GIVEN && parent !== window) parent.postMessage({ ready: true }, location.origin)
export { recent, used, bar, openDropdown, closeMenus }
