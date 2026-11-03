import sprae from '../assets/sprae.js'
import engine from './engine.js'
import codeEditor from './script.js'
import view, { HOLD, SLOP, KINDS } from './view.js'
import player from './player.js'
import stack, { valuesOf } from './stack.js'
import { mark as drawMark, sways, PACE } from '../logo/mark.js'
import recipes from './recipes.js'
import { ops, guides, previews, GROUPS, fromManifest, reshapes, labelOf, icons as groupIcons } from './ops.js'
import { prepare, error, bare, append, source, chain, number, rollback, residual, setArg, unsetArg, declared, rename, between, steps as stepsOf, stages, mixed, dropStep, moveStep, turnOff, turnOn, tracks as tracksOf, focus, addTrack, master as masterOf, takes, carried, useTake, addTake, dropTake, raise } from './code.js'
import { builtins, sample, microphone, hold as holdInput, search, credit, unique } from './sources.js'
import scales from './scale.js'
import menubar from './menu.js'
import { levels, cycle, trace } from './meters.js'
import time, { UNITS } from './time.js'
import opIcons from './icons.js'
import { unkeep, kept, tape, tapes } from './keep.js'
import hint from './hint.js'
import { methods as scrubbers } from './scrub-methods.js'
import agent from './agent.js'
import md from './markdown.js'
import doing, { measures, noted } from './doing.js'
import { THEMES } from './theme.js'
import { pastable, intoNew, wire as wireClipboard } from './editor/clipboard.js'
import { root, params, EMBED, DESKTOP, UI, SHOWN, quickOf, QUICK, GIVEN, APART, keep, generators, formats, ENCODING, writtenDepth, DEPTH_USE, mime, cutFormats, frameRates, KEEPS, icons, overlays, rulers, scrolls, grids, LOOK, looks, specMethods, WAVE, waveLooks, levelList, scaleNames, curves, glyphs, gripModes, SETTINGS_ICON, AGENT_ICON, RECIPES_ICON, displays, SPEEDS, SHUTTLE, times, tenths, scrubs, rates, layouts, specs, stored, oneOf, docsOf, sideOf } from './editor/config.js'
import { ed, rk, pl, output, incoming, timer, hush, steps, depthWas, rechoose, viewing, shown, carded, queued, assign } from './editor/context.js'
import { remember, undoList, goTo, editSelection, warp, carry, toTab, addOp, write, applied, changed, spread, flatten } from './editor/edits.js'
import { bytes, ago, mac, keys, clock, stamp, ruled, label, quote, several, note } from './editor/format.js'
import { paint, worn, dress, setTheme, openTheme, settingSections, fold, lookMenu, resetView, toggleShow, setDisplay, laneGroups, shows, showAs, setScale, setScrub, setUnits, setLevels, setRuler, setGrid, setStep, setSplice, setLook, resizePanel, flipView, wire as wireLook } from './editor/look.js'
import { writing, owning, saved, store, later, wire as wirePersist } from './editor/persist.js'
import { marks, meter, describe, markLevel, unmarkLevel, pickReading, pickHeard, listen, live, chordAt } from './editor/readouts.js'
import { trackMenu, layerPress, layerName, layerLook, layerMenu, toggleLock, renameLayer, fieldFocus, fitField, renamed, nameNewTrack, roomMenu, lanesShown, showTracks, toggleMute, focusOn, trackOf, laneName, lane, laneIndex, hears, fetches, lanesOf, newTrack, renameTrackTo, others, mastering, lineUp, matchUp, duckUnder, masterOut, retrack, untrack, detach, attach, wire as wireTracks } from './editor/tracks.js'
import { resampleTo, remixTo, splice, silence, stretch, trim, crossfade, lift, addMarker, unmark, relabel, remark, fade, setGrip, setPitch, setCurve, envelope, pitchline, envelopeShown, shiftOf, shift, tone, formant } from './editor/writers.js'

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
// The agent's conversations, the page's whichever tab shows (the chat, below): at most CHATS, the oldest first, the one
// open its `chatId`; those kept before as each tab's own, the closed ones' too, gathered
const CHATS = 30
const talk = (() => {
  const kept = Array.isArray(stored.chats) ? stored.chats : [...docsOf(stored.docs), ...docsOf(stored.closed)].flatMap(d => Array.isArray(d.chats) ? d.chats : [])
  const chats = kept.filter(c => Array.isArray(c?.messages)).sort((a, b) => (a.at ?? 0) - (b.at ?? 0)).slice(-CHATS)
  return { chats, chatId: 'chats' in stored ? stored.chat ?? null : docsOf(stored.docs)[stored.doc ?? 0]?.chat ?? null }
})()

const eng = engine()
assign({ eng })
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
let v
// Each tab plays on its own, as a browser's tabs do: one left as it plays plays on, heard with the one shown, its speaker
// on its tab muting it (toggleTabMute). `pl`, the shown tab's player (switchTab), each tab's made as it is first shown
const playerOf = doc => doc.player ??= Object.assign(player({ onend: () => ended(doc) }), { scrubMode: state.scrub })
// the caret is where playback ends, as it is where it pauses; a tab not shown, its speaker goes
function ended(doc) {
  if (doc.player !== pl) return sway()
  state.playing = false; state.speed = pl.rate = 1; v.playhead = null; v.setCursor(pl.time); state.time = stamp(v.cursor); sway()
}
// the view holds the tab's sound as it was left (its lanes, its length, where it was looked at) until the sound comes
let holding = false
let ticker = 0, recorder = null, previewAudio = null, original = null, checks = 0
// the files' lengths, s, and the places of takes the picture shows (places)
const lengths = new Map(), lengthOf = name => lengths.get(name)
let placed = []
// each tab's runs asked and not yet answered; the shown one's
// the runs asked and not yet answered, by tab; of them, those a mute asked (`hushed`), made unseen (perform)
// (`hush`: the next run is one); working, while any other is, or what one made still comes
const asking = new Map(), hushed = new Map(), waiting = () => asking.get(state.tab) ?? 0
const working = () => waiting() > (hushed.get(state.tab) ?? 0) || !!incoming && !incoming.quiet
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
// a copy made in another tab or window, pasted here (clipboard.js)
wireClipboard()

// The mark in the bar, drawn live (logo/mark.js): at rest it holds the logo's pose. Playing or recording, the logo's own
// wave runs through its window 2.5 times a second, a loop the compositor steps through (motion.js loop), so the page's
// thread is the playhead's and the take's alone; scrubbing, one cycle of the moment under the caret, turned by the
// caret's travel (2.5 turns for a second of it). The tab's icon shows the same, in a hidden tab too. Plain: nothing
// fades or blends, and what it shows next it shows at once.
const logoMark = drawMark(root.querySelector('.bar .wordmark')), heard = trace()
// Its cycles across the window follow the pitch it draws, smoothly: one at 100 Hz and below, a cycle and three quarters
// more for each octave up, at most three and a half
const cyclesOf = hz => hz ? Math.min(3.5, Math.max(1, 1 + .75 * Math.log2(hz / 100))) : 1
// Heard RMS to the wave's height: half of it at −48 dBFS and below, all of it at full scale. The mark only says that
// something sounds, so it is never flat; a silence is the faint axis alone, its wave nothing.
const swell = rms => { const loud = 1 + 20 * Math.log10(rms + 1e-9) / 48; return .5 + .5 * (loud > 0 ? Math.min(1, loud) : 0) }
const still = matchMedia('(prefers-reduced-motion: reduce)')
// The caret under a scrub, and the RMS of what it hears there (the 50 ms around it): the output, or a track's lane
let scrubbed = null
const beneath = () => { const w = output && pl.heard(scrubbed), i = w && Math.round(scrubbed * output.sampleRate) - w.from; return w ? Math.max(0, ...levels(w.x, i - 1200, i + 1200).map(l => l.rms)) : 0 }
// while the engine works it turns gently, the same whether a file arrives or an output renders, no smaller or paler
// (the moves themselves, ../logo/mark.js sways; scrubbing, the moment under the caret, as only this page hears it).
// Embedded, the page around it told each, and each turn of a scrub, for a mark of its own to move with it (embed.js)
const tell = EMBED && parent !== window ? message => parent.postMessage({ audio: 'mark', ...message }, '*') : () => {}
let swaying = ''
function sway() {
  const mode = still.matches ? 'rest' : scrubbed != null && output?.duration ? 'scrub' : recorder && !state.recording?.pending ? 'record' : docs.some(d => d.player?.playing) ? 'play' : working() ? 'work' : 'rest'
  badges()
  if (mode === swaying) return
  swaying = mode
  heard.hz = 0
  logoMark?.set(mode !== 'scrub' ? sways[mode] : { ...sways.scrub, signal: () => { const w = output && pl.heard(scrubbed); if (w) cycle(w.x, scrubbed * output.sampleRate - w.from, output.sampleRate, heard, .5); return heard.wave }, cycles: () => cyclesOf(heard.hz), amplitude: () => swell(beneath()) })
  tell({ mode })
}

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
// the kept files are listed as the page comes up, not before it: the first run waits for them (evaluate)
const restoring = APART ? Promise.resolve() : kept().then(files => { shelf = files })
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

// What a call sets, drawn over the output (ops.js guides), from its values by its parameters' names (`spec`)
function guidesOf(call, spec, values = valuesOf(spec, call)) {
  const named = Object.fromEntries(spec.map((s, i) => [s.name, values[i]]))
  for (const arg of call.args) if (arg.kind === 'object') for (const p of arg.props) named[p.name] ??= p.value
  return guides(call.name, named, v.duration)
}
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


// Runs the script a moment after the last change; a slider runs it at once. Newer runs replace waiting ones.
function schedule(delay) { clearTimeout(timer); assign({ timer: setTimeout(() => { assign({ timer: 0 }); evaluate() }, delay) }) }
async function evaluate() {
  const code = ed.code, quiet = hush
  assign({ hush: false })
  places()
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
  return perform(runs, code, quiet)
}
// Runs `runs`, the editor holding `code`, its reply and output shown as they come; the last asked (sent)
let sent = null
// A run a mute asks (`quiet`) is made unseen: the mix again without the tracks muted, for the levels and the export, its
// lanes as they were; nothing says it works, nor does the picture take it up as it comes (heard already: toggleMute)
async function perform(runs, code, quiet = false) {
  // a script with nothing in it runs nothing, nothing else on its way: no sound, at once, the engine not waited for, so
  // an empty tab shows its empty track as the page comes up (and the run asked last is no longer this script's)
  if (!waiting() && !incoming && !bare(runs).trim()) { sent = null; show({ logs: [] }); return status() }
  const script = prepare(runs)
  await restoring
  // Built-in samples are made when a script first names one; the worker takes messages in order, so the file
  // arrives before the run that opens it, and runs stay in the order they were asked for.
  // A file kept opens as it was kept, before a sample of its name (one kept before names stayed clear of theirs)
  for (const name of script.names) if (!eng.has(name) && (shelf.has(name) || builtins[name])) eng.file(name, shelf.get(name) ?? sample(name))
  // the output keeps the code that made it (what ran, and what the editor had), and the tab it is for
  const tab = eng.tab, coming = sent = Object.assign(arrival(script.names), { code: runs, editor: code, tab, quiet })
  asking.set(tab, (asking.get(tab) ?? 0) + 1)
  if (quiet) hushed.set(tab, (hushed.get(tab) ?? 0) + 1)
  asked = script.names
  status()
  // the file shown as it is while the output is made, where the picture has nothing of it (worker.js render)
  const result = await eng.run({ ...script, muted: [...state.muted], preview: !state.hasOutput || fresh(script.names) }, coming)
  const left = asking.get(tab) - 1
  left > 0 ? asking.set(tab, left) : asking.delete(tab)
  if (quiet) { const n = hushed.get(tab) - 1; n > 0 ? hushed.set(tab, n) : hushed.delete(tab) }
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
  state.canPaste = pastable()
  // an edit drawn ahead of its output that failed: the picture goes back to the output there is
  if (e) { v.expect(null); if (!state.hasOutput) entitle(names, false); return finished({ ok: false, problem }) }
  // exports follow the output the page shows: the last run that succeeded
  state.saves = result.saves || []
  entitle(names, !!result.output || state.hasOutput)
  // what it said goes with its output, for its tab shown again (switchTab)
  if (result.output) { coming.id = result.id; coming.said = { lines, saves: state.saves, names }; assign({ incoming: docOf(coming.tab).coming = coming }); state.loading = !state.hasOutput; return }
  assign({ incoming: null })
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
  state.canPaste = pastable()
  entitle(names, true)
}
// A run's end, for whoever waits on it (an agent's edit): the output's length, or what went wrong; the last (outcome)
let waiters = [], outcome = null
const ran = () => new Promise(resolve => waiters.push(resolve))
const finished = result => { outcome = result; for (const resolve of waiters.splice(0)) resolve(result) }
const within = (promise, ms = 60000) => Promise.race([promise, new Promise(resolve => setTimeout(() => resolve({ ok: false, problem: 'Still running' }), ms))])
// Settled, for whoever drives the page and waits on it (playground.test.js): the kept files read, no run waiting to
// start, asked or on its way, and two frames drawn since
globalThis.__settled = async () => {
  const frame = () => new Promise(requestAnimationFrame)
  await restoring
  while (timer || waiting() || incoming) await frame()
  await frame()
  await frame()
  return true
}

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
      assign({ showing: 0 })
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
    assign({ incoming: null })
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
    assign({ incoming: null })
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
  assign({ showing: a.id })
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
  assign({ output: out })
  holding = false
  // the tab's own, to show at once when it is shown again
  const doc = docs.find(d => d.id === state.tab)
  if (doc) doc.output = out
  const has = !!out?.duration
  assign({ showing: has ? out.id : 0 })
  state.hasOutput = has
  state.whole = has
  state.arriving = false
  state.loading = false
  // tracks, a lane each, the one edited by its name
  showTracks(has ? lanesShown(out) : null)
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

// What the engine is doing, said after the time once it takes a moment: a file the view has not shown decoding, and
// how much of it has come; an output rendering, and how much of it. One word from the first run to the last output, so
// runs that follow one another (a file dropped opens in a tab, then runs) read as one. Play gives way to a ring of the
// same, its square the way out (`working`): at once while there is nothing to play, after two seconds over a sound there is.
let ticking = 0, asked = [], began = 0
function status() {
  const now = performance.now(), a = incoming?.quiet ? null : incoming, asks = waiting() - (hushed.get(state.tab) ?? 0), busy = asks > 0 || !!a
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

// Named as its tab is (soundName), for the files a run opened where the script alone does not say, while a chain is being
// typed; so a file that failed to open is still named
function entitle(names, has) {
  state.name = soundName(ed.code, source(ed.code)?.strings.map(s => s.name) || names, has)
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
function toggleLoop() { state.loop = !state.loop; pl.loop = state.loop }
// Record pressed: with Shift (⇧R), into a new track as the others play
function toggleRecording(event) { state.recording ? stopRecording() : event?.altKey ? retakeHere() : startRecording(!!event?.shiftKey && state.whole) }
// Another take of the recording at the caret (⌥R, Alt adds): into its place, from where it goes in to where it ends,
// one more take there; with none there, a recording from the caret, the first
function retakeHere() {
  const run = state.whole && takesHere(true)
  return run && reach(run)[1] > run.at ? startRecording(false, run) : startRecording()
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
// let go forward, it plays on at that speed, at 0 or back it stops there. Held still for HOLD (within SLOP), as the
// picture's caret is, the line shows, to be seen or dragged. So a press while it plays pauses at its release, unless it
// was dragged or held, the caret where the playhead got to, as a key's pause leaves it.
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
    if (!moved && !shown && Math.abs(dx) < SLOP) return
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
  live.text = undefined
  const tick = frame => {
    if (!p.playing || p !== pl) return
    const t = follow(p.time, frame ?? performance.now(), p.rate)
    v.speed = follow.speed
    v.playhead = t; state.time = stamp(t); state.played = t / (v.duration || 1); meter(t); chordAt(t)
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
    if (scrubbed != null) logoMark?.turn(PACE * (t - scrubbed)), tell({ turn: PACE * (t - scrubbed) })
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
// whether a GPU splits the voice (tracks.js)
wireTracks()
// The palette's keys: the arrows go through what it found, Enter takes it, Escape closes it
function toolKey(event) {
  const items = state.toolGroups.flatMap(g => g.items), k = event.key
  if (k === 'ArrowDown' || k === 'ArrowUp') { event.preventDefault(); state.pick = (state.pick + (k === 'ArrowDown' ? 1 : items.length - 1)) % Math.max(1, items.length) }
  else if (k === 'Enter') { event.preventDefault(); items[Math.min(state.pick, items.length - 1)]?.run() }
  else if (k === 'Escape') { event.preventDefault(); closePalette() }
}

// Sources. A new sound opens in a tab of its own, or in the tab shown if it is empty; several at once, a track each in
// one tab, played together, unless dropped on the tabs: a tab each. A file dropped on the waveform goes in where it is
// dropped; one dropped on the script is written where it lands. A file the script opens that is not here
// (`missing`) takes the one opened for it (Open it…), or one by its name, and the script runs again.
// `track`: those picked open as tracks of their own, under the one edited
let relink = '', asTrack = false
const audible = f => /^(audio|video)\//.test(f.type) || /\.(wav|mp3|flac|ogg|oga|opus|m4a|aac|aiff?|caf|webm|mp4|mov|wma|amr|mka)$/i.test(f.name)
function pickFiles(missing = '', track = false) { closeMenus(); relink = typeof missing === 'string' ? missing : ''; asTrack = track === true; root.querySelector('.file-input').click() }
async function openFiles(list, how = 'new', at = null) {
  root.querySelector('.file-input').value = ''
  if (asTrack) { asTrack = false; how = 'track' }
  const files = list.filter(audible)
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
// go but when asked (File › Open recent › Delete kept sounds): a tab closed, a step undone, keeps its files for coming back to.
// the names a new file can't take: a file open, kept, or a sample's
const taken = () => new Set([...eng.names, ...shelf.keys(), ...Object.keys(builtins)])
// The kept files no open tab opens, the newest first, as the File menu lists them
function shelved() {
  const open = new Set(docs.flatMap(d => prepare(d.id === state.tab ? ed.code : d.code).names))
  return [...shelf].filter(([name]) => !open.has(name)).sort(([, a], [, b]) => b.lastModified - a.lastModified)
}
// What File › Open recent offers, the newest first: the tabs closed, each with its edits, as it was left; the files kept
// that no tab opens (a tab closed that opens one stands for it)
function reopenable() {
  const tabs = closed.map((c, i) => {
    const names = prepare(c.code).names, edits = chain(c.code)?.calls.length ?? 0
    return { key: `tab ${i}`, kind: 'tab', names, name: names.length ? names.map(label).join(' + ') : c.code.trim().split('\n')[0].slice(0, 40) || 'untitled', when: c.shut ?? 0,
      meta: [edits ? `${edits} edit${edits > 1 ? 's' : ''}` : '', c.shut ? `closed ${ago(c.shut).replace(/^now$/, 'just now')}` : 'closed'].filter(Boolean).join(', '), run: () => reopenTab(i) }
  })
  const opened = new Set(tabs.flatMap(t => t.names))
  const files = shelved().filter(([name]) => !opened.has(name)).map(([name, f]) => ({ key: `file ${name}`, kind: 'file', name, when: f.lastModified, meta: `${bytes(f.size)}, ${ago(f.lastModified)}`, run: () => place([name], 'new') }))
  return [...tabs.reverse(), ...files].sort((a, b) => b.when - a.when)
}
// They go, once the person has said so
async function unshelve() {
  const list = shelved(), them = list.length > 1 ? 'them' : 'it'
  if (!list.length || !confirm(`Delete ${list.length > 1 ? `the ${list.length} sounds` : list[0][0]} kept in this browser (${bytes(list.reduce((n, [, f]) => n + f.size, 0))})? No tab opens ${them} now; deleted, ${them} can't be brought back.`)) return
  for (const [name] of list) { await unkeep(name); shelf.delete(name) }
}
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
  // in at a time on the picture (at each of several, the last first), the seams crossfaded as an edit's are
  // under the lanes, a track of its own there
  if (how === 'room' && at != null) return intoNew(`audio(${expr})`, at, names[0])
  if (how === 'insert' && at != null && chain(code)) return write([at].flat().map(t => `insert(audio(${expr}), { at: ${number(t, v.unit)}${splice()} })`).join('.'))
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
async function useSample(name, how = 'new') {
  closeMenus()
  if (!eng.has(name)) await eng.file(name, sample(name))
  place([name], how)
}
// Embedded (?controls= sound), the sound's ways in from its name over the picture, each in its place: a file, a take
// (as Record makes one), a sample
const NOTE = 'M9 18V5l12-2v13M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0m12-2a3 3 0 1 1-6 0 3 3 0 0 1 6 0', SOUND = 'M4 10v4m4-8v12m4-15v18m4-14v10m4-6v2'
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
// Every popover over the page closed; the look's dropdown by closeDropdown, so its owner and state say so at once, not
// when the popover's toggle event comes
const closeMenus = () => { closeDropdown(); for (const menu of root.querySelectorAll('[popover]')) if (menu.matches(':popover-open')) menu.hidePopover() }

// Recording goes into the waveform as it comes, as a dictaphone's. Over the output, from the caret or the selection's
// start, what it covers is replaced, as a tape records on (a punch-in), and extended past the end: one write() step,
// undone as any edit. A selection ends it at its end; with the loop on, each pass starts over there and replaces the
// last, the take the one that was going when it stopped. With nothing open, the take is the sound. Stopped, the caret
// waits where the take ended, as a tape's head does: Record again goes on from there.
// Into a track, the other tracks play as it records (accompany), as a take is laid over a backing track; `fresh`, a new
// track first, empty, under the last (newTrack): ⇧R.
let take = null
// The microphone opens as Record is pressed, ahead of its click (the press to the release saves a tenth of a second or
// so); a press no click follows lets it go. Once allowed, it opens as the pointer comes onto Record: the click then
// starts the take on the next block (sources.js keeps it open between takes)
let arming = null, unarm = 0, allowed = false
navigator.permissions?.query({ name: 'microphone' }).then(p => { allowed ||= p.state === 'granted' }, () => {})
// in the Mac app, as a DAW: the input open from the start, its permission asked as the app opens, a take on the next block
if (DESKTOP) holdInput(state.recordIn)
function armRecording(event) {
  if (event.button || recorder || state.recording || arming) return
  arming = microphone({ channels: state.recordIn })
  arming.catch(() => {})
  unarm = setTimeout(() => { arming?.then(mic => mic.cancel(), () => {}); arming = null }, 2000)
}
root.querySelector('button.record')?.addEventListener('pointerenter', () => {
  if (!allowed || recorder || state.recording || arming) return
  microphone({ channels: state.recordIn }).then(mic => mic.cancel(), () => {})
})
async function startRecording(fresh = false, run = null) {
  closeMenus()
  if (recorder || state.recording) return
  // the caret in the room under the lanes: a new track's, whatever starts the take (R, the button, the menu)
  if (!run && v.ghost && state.whole) fresh = true
  if (pl.playing) togglePlay()
  // the output the others play from, as it is before a new track (which adds nothing to it) runs again; another take of
  // a place (`run`), into it, as into a selection
  const out = output, into = state.whole, sel = into && run ? span(run) : into && !v.band ? v.selection : null
  if (fresh === true && into && !newTrack()) return
  const t = take = { into, at: into ? (sel ? sel[0] : v.cursor) : 0, until: sel ? sel[1] : null, samples: 0, pass: 0, passes: [], queue: [], frame: 0, started: false, over: into && !!state.track && out }
  const asked = arming ?? microphone({ channels: state.recordIn })
  clearTimeout(unarm)
  arming = null
  // until the microphone answers, Record blinks, armed, as a deck's does; a click on it then lets go
  state.recording = { pending: true, length: 0 }
  try {
    const mic = await asked
    allowed = true
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
    mic.take((block, at) => {
      t.first ??= at
      t.tape.write(block)
      if (t.held && (t.taken = (t.taken ?? 0) + block[0].length) * block.length <= eng.peaks) t.held.push(block)
      else t.held = null
      t.queue.push(block)
      t.frame ||= requestAnimationFrame(f => flush(t, f))
    })
    state.recording.pending = false
    sway()
    if (t.over) accompany(t)
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
  // played over, each pass the samples the microphone heard as the others played it, `lead` on (aligned): it ends that
  // much later, so it runs to the selection's end too
  const room = t.until == null ? Infinity : Math.round((t.until - t.at) * t.rate), { lead } = t.over ? aligned(t, recorder) : { lead: 0 }
  for (const block of blocks) {
    // past the selection's end: with the loop on, the next pass, over it again (the others looping with it), the one
    // done a take (passes), shown as one at once (liveTakes); else the take ends
    if (t.samples - t.pass >= room + lead) {
      if (!state.loop) return stopRecording()
      // each pass `room` on from the one before, as the others loop by their own clock
      t.passes.push(t.pass)
      t.pass += room
      begin()
      liveTakes(t)
    }
    t.samples += block[0].length
    v.grow(block)
  }
  t.t0 ??= recorder.time - t.samples / t.rate
  if (t.heard && pl.playing && t.heard.length < 32) t.heard.push(pl.time - recorder.time)
  // played over, the take drawn lined up as its output will be, from where the others' clock is heard: no shift as it
  // stops and its output comes
  if (t.over) { const a = aligned(t, recorder); v.align(a.at, a.lead) }
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
  if (t.over) { pl.pause(); lend(output) }
  // the blocks not drawn yet are the take's too, drawn now: the take as it stops is the take its output will show
  for (const block of t.queue.splice(0)) { t.samples += block[0].length; v.grow(block) }
  state.recording = null
  v.playhead = null
  sway()
  // the passes over the selection, the loop on, each a take (passes), the last too where it ran to the selection's end
  // or is all there is; played over, from the sample heard as the others were at its start (aligned)
  const rate = rec.sampleRate, { lead, at: from } = aligned(t, rec), room = t.until == null ? Infinity : Math.round((t.until - t.at) * rate)
  const length = Math.min(t.samples - t.pass - lead, room), cut = t.passes.length > 0 && length < room
  const parts = [...t.passes.map(p => [p + lead, room]), ...cut ? [] : [[t.pass + lead, length]]]
  if (!(parts[0][1] > 0)) { t.tape.drop(); if (t.into) v.take(null); return note('Nothing was recorded.') }
  // the caret at once where the take ends: what follows waits on the tape and the engine, frames in which it would
  // show where the take began
  if (t.into) v.setCursor(from + parts.at(-1)[1] / rate)
  const names = []
  for (const _ of parts) names.push(names.length ? unique('take.wav', new Set([...taken(), ...names])) : t.name)
  // each as it was written down as it came (keep.js tape), a file read from disk as the engine decodes it: none of it
  // held here; where the tape failed, what is held here, if that is all of it
  const wavs = []
  for (const [pass, n] of parts) wavs.push(await t.tape.wav(pass, n))
  const held = wavs.some(w => !w) && t.held && t.held[0].map((_, c) => { const x = new Float32Array(t.samples); let at = 0; for (const b of t.held) { x.set(b[c] ?? b[0], at); at += b[0].length } return x })
  const data = wavs.map((w, i) => w ?? (held && { channels: held.map(x => x.subarray(parts[i][0], parts[i][0] + parts[i][1])), sampleRate: rate }))
  if (!data.every(Boolean)) { t.tape.drop(); if (t.into) v.take(null); return note(`${names[0]} could not be kept in this browser: it was longer than the page holds.`, 'error') }
  // the tape's parts go once every take is kept
  const kept = names.map((name, i) => keep(name, data[i]))
  saving(Promise.all(kept.map((k, i) => k.then(file => {
    if (!file) return note(`${names[i]} could not be kept in this browser: export it to keep it.`, 'error')
    shelf.set(names[i], file)
    return true
  }))).then(all => all.every(Boolean) && t.tape.drop()))
  // the engine reads the file kept, else what there is
  for (const [i, name] of names.entries()) { lengths.set(name, parts[i][1] / rate); await eng.file(name, await kept[i] ?? data[i]) }
  const end = from + parts.at(-1)[1] / rate
  // the sound itself, the caret at its end once it shows (aim)
  if (!t.into) { note(`Recorded ${clock(end - from)}`); place(names, 'new'); docs.find(d => d.id === state.tab).view = { selection: null, band: null, more: [], cursor: end, anchor: end }; return }
  // to the microphone's sample, so a take recorded on from where this one ended meets it, no gap nor overlap between;
  // where takes went in before, one more of them (code.js retake), the newest heard
  if (!write(...names.map(name => `write(audio(${quote(name)}), { at: ${number(from, 1e-6)} })`))) return v.take(null)
  v.setCursor(end)
  const here = takes(ed.code).findLast(r => Math.abs(r.at - from) < 1e-6)?.list.length ?? 1
  note(`Recorded ${names.length > 1 ? `${names.length} takes of ` : ''}${clock(end - from)}${here > names.length ? `, ${here} takes here` : ''}${here > 1 ? ', the last heard: their numbers under the lanes switch them' : ': ⌥R records another take of it'}${cut ? '. The last pass, cut short, is left out' : ''}`)
}
// The others, as their speakers have them, the track it goes into muted (worker.js voice), from where it starts to the
// selection's end; once they play, where they are as the microphone's clock goes is read each frame (flush), both clocks
// at once
async function accompany(t) {
  const out = output ?? t.over, muted = [...state.muted, state.track]
  pl.out = null
  pl.set(out.channels, out.sampleRate, o => eng.voice({ ...o, output: out.id, muted }), out.length, fetches(out), lanesOf(out))
  await pl.play({ from: t.at, to: t.until, loop: state.loop && t.until != null })
  if (take === t && pl.playing) t.heard = []
}
// Where a take played over goes: the sample the microphone heard as the others were at its start, its `lead` samples
// before it let go, written there (at); one begun after it, where it was begun. What the speakers play now less the
// microphone's clock now (the median of the frames'), on the time of its first block, less its latency, is where that
// block was played over. Not played over, all of it, where it was begun
function aligned(t, rec) {
  if (!t.heard?.length) return { lead: 0, at: t.at }
  const d = [...t.heard].sort((p, q) => p - q)[t.heard.length >> 1], first = t.first - rec.latency + d
  const lead = Math.round((t.at - first) * rec.sampleRate)
  return lead >= 0 ? { lead, at: t.at } : { lead: 0, at: first }
}

// Where takes went in (code.js takes): from where a place's go in to where the longest of them ends, its files' lengths
// asked of the engine once (`lengths`, s; a file of none yet, nothing). On the picture, those of two takes or more,
// where the steps after them take the place (`shown`, code.js carried: a marker, a level, a delete past it leave it
// where it is, a delete before it moves it back), none where the script alone can't say (a trim, a stretch: `placed`,
// as the picture has them)
const reach = run => [run.at, run.at + Math.max(0, ...run.list.map(x => Math.max(x.d ?? 0, x.empty ?? lengths.get(x.name) ?? 0)))]
// a place in the sound as it plays, where that is known, else at its takes' own step
const span = run => run.shown ?? reach(run)
// Every track's, each its `track` (none without tracks) and its lane; those of the track edited returned
function places() {
  const code = ed.code, names = tracksOf(code).map(t => t.name), all = [], shown = []
  try {
    for (const track of names.length ? names : [null]) {
      focus(track)
      const at = output?.tracks?.findIndex(t => t.name === track) ?? -1, lane = track == null ? null : at >= 0 ? at : names.indexOf(track)
      for (const r of takes(code)) {
        const run = { ...r, track, lane, shown: carried(code, r, reach(r)) }
        all.push(run)
        // two or more, or one empty (forked: forkRange) for a recording to go into
        if ((r.list.length > 1 || r.list.some(x => x.empty != null)) && run.shown) shown.push(run)
      }
    }
  } finally { focus(state.track) }
  const ask = [...new Set(all.flatMap(r => r.list.map(x => x.name)))].filter(n => n && !lengths.has(n))
  // asked once the files kept are read (restoring: on a visit's first run, not yet), each sent to the engine as a run
  // sends it; one it can't open asked again next time, its length nothing meanwhile (its place as long as the others')
  if (ask.length) {
    for (const n of ask) lengths.set(n, null)
    restoring.then(() => {
      for (const n of ask) if (!eng.has(n) && (shelf.has(n) || builtins[n])) eng.file(n, shelf.get(n) ?? sample(n))
      return eng.lengths(ask)
    }).then(got => { ask.forEach((n, i) => got[i] == null ? lengths.delete(n) : lengths.set(n, got[i])); if (got.some(x => x != null)) places() })
  }
  placed = shown
  v.takes = placed.map(section)
  return all.filter(r => r.track === (names.length ? state.track : null))
}
// a place of takes as the picture has it (view.js takes)
const section = r => ({ at: r.shown[0], end: r.shown[1], on: r.list.findIndex(x => x.on), names: r.list.map(x => x.name), lane: r.lane, open: r.list.some(x => x.empty != null) })
// Recording pass after pass over a selection (the loop on), its passes are takes of that place as they are done: with
// the takes there before, those done, the one recording lit, + off till it stops; the script takes them up then (places)
function liveTakes(t) {
  const lane = output?.tracks ? laneIndex() ?? null : null, run = placed.find(r => Math.abs(r.shown[0] - t.at) < 1e-6 && r.lane === lane)
  const names = [...(run?.list ?? []).filter(x => x.empty == null).map(x => x.name), ...t.passes.map((_, k) => `pass ${k + 1}`), 'recording']
  v.takes = [...placed.filter(r => r !== run).map(section), { at: t.at, end: Math.max(t.until, run ? run.shown[1] : 0), on: names.length - 1, names, lane, open: true }]
}
// The place the selection starts in, or the playhead or the caret is in (to where its takes end, the end too), of two
// takes or more, or `alone` of one too, in the track edited: the last there; else, of two or more, the last before it,
// else the first; null where none is
function takesHere(alone = false) {
  const all = places(), t = state.playing ? pl.time : v.selection?.[0] ?? v.cursor, within = all.filter(r => span(r)[0] <= t + 1e-6 && span(r)[1] >= t - 1e-6)
  const many = all.filter(r => r.list.length > 1)
  return within.findLast(r => alone || r.list.length > 1) ?? (alone ? null : many.findLast(r => span(r)[0] <= t + 1e-6) ?? many[0] ?? null)
}
// A take there heard, the others turned off, as a take folder's are switched (Logic's): playing, it takes over where it
// plays; the one heard, turned off, the sound heard there as it was without them. One step, which Undo takes back
function useTakeOf(run, k) {
  const heard = run.list[k].on, change = heard ? turnOff(ed.code, stepsOf(ed.code)[run.list[k].i].call) : onTop(run, useTake(ed.code, run.list[k].from))
  if (change) ed.change(change)
  note(heard ? 'No take heard here: the sound as it was' : `Take ${k + 1} of ${run.list.length}, ${run.list[k].name || 'empty'}`)
}
// A named range forked (its fork, view.js placeFork): takes start there, an empty take over it, turned off, the sound
// heard there as it was; Record records into it (retake), heard from then on, its place selected for that. One step,
// which Undo takes back
function forkRange({ time, duration, track }) {
  if (state.recording) return
  if (track != null && track !== state.track) focusOn(track)
  const code = ed.code, call = `write(audio.from(${number(duration, v.unit)}), { at: ${number(time, v.unit)} })`, put = append(code, call)
  if (!put) return note('Open or generate a sound first.')
  const out = applied(code, put), step = stepsOf(out).findLast(x => out.slice(x.call.dot + 1, x.call.to) === call), off = step && turnOff(out, step.call)
  if (!off) return
  ed.change(between(code, changed(out, off)))
  v.select(time, Math.min(time + duration, v.duration))
  note('Takes here, the sound heard as it was: R records the first')
}
// The take heard there taken away, the one before it heard in its place; one step, which Undo takes back
function deleteTake(run) {
  const k = Math.max(0, run.list.findLastIndex(x => x.on)), change = dropTake(ed.code, run.list[k].from)
  if (!change) return
  ed.change(run.list.length > 1 ? onTop(run, change) : change)
  note(run.list.length > 1 ? `Take ${k + 1} deleted, ${run.list.length - 1} left here` : 'The take deleted')
}
// The takes there as a menu lists them, the one heard checked; the one heard, deleted; the context menu's, both
// A change to the takes of a place (`run`), they then brought over what is laid on their place after them (code.js
// raise), so the take heard there is heard, as a recording there is: one change of the script as it is, null for none
function onTop(run, change) {
  const code = ed.code, i = takes(code).findIndex(r => r.list[0].from === run.list[0].from), out = changed(code, change)
  const up = i >= 0 && takes(out)[i] && raise(out, takes(out)[i], lengthOf) || out
  return up === code ? null : between(code, up)
}
const takeList = run => run.list.map((x, k) => ({ label: `Take ${k + 1}`, hint: x.name || 'empty', checked: x.on, run: () => useTakeOf(run, k) }))
const deletion = run => ({ label: 'Delete take', hint: `Take ${Math.max(0, run.list.findLastIndex(x => x.on)) + 1}`, run: () => deleteTake(run), icon: opIcons.remove })
const takesMenu = run => [{ label: 'Takes', hint: `${run.list.length} here`, items: takeList(run) }, deletion(run)]

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
    if (band && shows(state.track) !== 'spec') showAs('spec')
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
    const change = remove ? dropStep(ed.code, index) : to != null ? moveStep(ed.code, index, +to) : on ? useTake(ed.code, s.call.from) ?? turnOn(ed.code, s.call) : turnOff(ed.code, s.call)
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
  if (list.some(g => g.pitch) && shows(state.track) !== 'spec') showAs('spec')
  assign({ shown: { code, guides: list } })
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
// unless one holds it already. A first visit opens on an empty tab, an empty track ready for a take or a drop,
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
  const names = list => Array.isArray(list) ? list.filter(n => typeof n === 'string') : []
  docs = list.map(({ code, title, frame, view, track, muted, locked, heights, kinds }) => ({ id: ++docIds, code, title: typeof title === 'string' && title ? title : null, frame, view, track: typeof track === 'string' ? track : null, muted: names(muted), locked: names(locked),
    heights: heights && typeof heights === 'object' ? Object.fromEntries(Object.entries(heights).filter(([, h]) => Number.isFinite(h))) : {},
    kinds: kinds && typeof kinds === 'object' ? Object.fromEntries(Object.entries(kinds).filter(([, k]) => displays.some(d => d.name === k))) : {} }))
  return docs[at]
}

// Tabs over the picture, as an audio editor's open files: a script each, with its own history (the editor keeps it), its
// own steps (remember) and its last output, shown at once when it is (settle). A sound opened goes into a tab of its own,
// unless the tab shown is empty.
// each tab named by the sound its script opens (nameOf), the one shown as its script now reads; the others kept
function retitle() { state.tabs = docs.map(d => ({ id: d.id, name: d.title ?? (d.id === state.tab ? nameOf(ed.code) : d.name ??= nameOf(d.code)) })) }
// A tab pressed: another, shown; the one shown, its name in hand to write anew, as a track's (a click is enough):
// Enter or a press elsewhere keeps it, its title over its sound's name (emptied, the sound's again), Esc leaves it
function tabPress(id) {
  if (id !== state.tab) return switchTab(id)
  if (tabMoved) return
  state.renamingTab = id
  fieldFocus('.file-field')
}
function tabRenamed(event, t) {
  const to = event.currentTarget.value.trim()
  if (event.type === 'keydown' && event.key !== 'Enter' && event.key !== 'Escape') return
  event.stopPropagation()
  if (state.renamingTab !== t.id) return
  state.renamingTab = null
  const d = docs.find(d => d.id === t.id)
  if (!d || event.key === 'Escape') return
  d.title = to && to !== nameOf(d.id === state.tab ? ed.code : d.code) ? to : null
  retitle()
  store()
}
function nameOf(code) { return soundName(code, source(code)?.strings.map(x => x.name), !!chain(code)) }
// A sound's name: with tracks, theirs, as their layers have them (not every file their takes open, a dozen, none of them
// the track); else the files it opens; else 'generated' (`made`) or 'untitled'
function soundName(code, files, made) {
  const tracks = tracksOf(code).map(t => t.name)
  return tracks.length ? tracks.join(' + ') : files?.length ? files.map(label).join(' + ') : made ? 'generated' : 'untitled'
}
function switchTab(id) {
  if (id === state.tab || !docs.some(d => d.id === id)) return
  const was = docs.find(d => d.id === state.tab), next = docs.find(d => d.id === id)
  if (was) Object.assign(was, { code: ed.code, name: nameOf(ed.code), steps, depthWas, frame: was.frame ?? v.frame, view: was.view ?? v.state, track: state.track, muted: state.muted, locked: state.locked })
  assign({ steps: next.steps ?? [], depthWas: next.depthWas ?? 0 })
  state.tab = eng.tab = id
  // the edits the tab left waited to make go with it
  assign({ queued: [] })
  // the tab left plays on, if it plays, its player its own; the one shown plays as it was left, its playhead running
  cancelAnimationFrame(ticker)
  v.playhead = null
  assign({ pl: playerOf(next) })
  state.playing = pl.playing
  state.speed = pl.rate
  // its track edited, as it was left (its script, opened, keeps it valid: focusOn)
  state.track = next.track ?? null
  state.muted = next.muted ?? []
  state.locked = next.locked ?? []
  v.heights = next.heights ?? {}
  v.kinds = state.kinds = next.kinds ?? {}
  v.notes = {}
  assign({ notesFor: '' })
  focus(state.track)
  assign({ viewing: { delta: null, back: null } })
  v.select(0, 0)
  v.setCursor(0)
  // its sound at once, as it was last shown (none for a new one); while that is what its script makes as it reads now,
  // with what its run said, nothing runs again, else its script runs. One still on its way, as its script reads now,
  // is taken up where it has come to (takeUp)
  assign({ incoming: null })
  settle(next.output ?? null)
  if (!next.output) standIn(next)
  if (pl.playing) chase()
  ed.open(id, next.code)
  // its takes' places, as its script has them: a run, which would place them, may not come
  places()
  const out = next.output, a = next.coming
  if (a?.said && a.code === a.editor && a.editor === ed.code) { clearTimeout(timer); assign({ timer: 0 }); state.viewing = ''; retell(a.said); takeUp(a) }
  else if (out?.said && out.code === out.editor && out.editor === ed.code) { clearTimeout(timer); assign({ timer: 0 }); state.viewing = ''; retell(out.said) }
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
  assign({ incoming: a })
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
// brought into sight, the strip scrolled alone (scrollIntoView scrolls a page the editor is framed in, too)
function scrollTabs(event) {
  const strip = event.currentTarget
  if (Math.abs(event.deltaY) <= Math.abs(event.deltaX) || strip.scrollWidth <= strip.clientWidth) return
  event.preventDefault()
  strip.scrollLeft += event.deltaY
}
function inSight() {
  requestAnimationFrame(() => {
    const tab = root.querySelector('.file.current'), strip = tab?.parentElement
    if (!tab) return
    const t = tab.getBoundingClientRect(), s = strip.getBoundingClientRect()
    strip.scrollLeft += t.left < s.left ? t.left - s.left : t.right > s.right ? t.right - s.right : 0
  })
}
// Which sides of the tabs have more past them, faded out to it (editor.css): as they scroll, as the strip or the tabs
// change size, as tabs come and go
const tabStrip = root.querySelector('.files-list')
function tabEdges() {
  const a = tabStrip.scrollLeft > 1, b = tabStrip.scrollLeft + tabStrip.clientWidth < tabStrip.scrollWidth - 1, more = a && b ? 'both' : a ? 'start' : b ? 'end' : ''
  if ((tabStrip.dataset.more ?? '') !== more) more ? tabStrip.dataset.more = more : delete tabStrip.dataset.more
}
tabStrip.addEventListener('scroll', tabEdges, { passive: true })
new ResizeObserver(tabEdges).observe(tabStrip)
new MutationObserver(tabEdges).observe(tabStrip, { childList: true, subtree: true })
function newTab(code = '') {
  const doc = { id: ++docIds, code }
  docs.push(doc)
  switchTab(doc.id)
  return doc
}
// A tab dragged along the others is held under the pointer, the others stepping aside as it passes their middles, and
// goes where it is let go, as a browser's tabs do; a press that stays put is a click
// a tab dragged, not clicked: the click its letting go makes names nothing (tabPress)
let tabMoved = false
function dragTab(event, id) {
  tabMoved = false
  if (event.button) return
  const el = event.currentTarget.closest('.file'), tabs = [...el.parentElement.querySelectorAll('.file')], from = tabs.indexOf(el)
  const boxes = tabs.map(t => t.getBoundingClientRect()), step = boxes[from].width + 2, x0 = event.clientX, center = b => b.left + b.width / 2
  let moved = false, to = from
  const plotBox = root.querySelector('.plot').getBoundingClientRect(), y0 = event.clientY
  // down onto the picture, another tab's sound goes in as a track (attach)
  const onto = e => id !== state.tab && state.hasOutput && e.clientX >= plotBox.left && e.clientX <= plotBox.right && e.clientY >= plotBox.top && e.clientY <= plotBox.bottom
  const move = e => {
    const dx = e.clientX - x0, dy = e.clientY - y0
    if (!moved && Math.abs(dx) < SLOP && Math.abs(dy) < SLOP) return
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
    tabMoved = true
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
}
// the last closed, or the one at `i` (File › Open recent), in place of an empty tab
function reopenTab(i = closed.length - 1) {
  const [c] = closed.splice(i, 1)
  if (!c) return
  const doc = c.doc ?? { id: ++docIds, code: c.code, frame: c.frame, view: c.view, track: c.track ?? null, muted: c.muted ?? [] }
  const blank = !ed.code.trim() ? state.tab : null
  docs.splice(Math.min(c.at ?? docs.length, docs.length), 0, doc)
  switchTab(doc.id)
  if (blank != null) closeTab(blank)
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
  const t = dropping(event) === 'insert' ? v.dropAt(event) : null, how = t != null && v.dropsNew ? 'room' : dropping(event)
  state.dropping = false
  v.dropAt(null)
  const inEditor = event.target.closest('.script-editor'), at = inEditor ? ed.view?.posAtCoords({ x: event.clientX, y: event.clientY }) ?? null : null
  openFiles([...event.dataTransfer.files], inEditor && at != null ? 'at' : (how === 'insert' || how === 'room') && t != null ? how : how === 'tab' ? 'tabs' : 'new', inEditor ? at : t)
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
export { recent, recorder, lengthOf, docs, docOf, closed, shelf, used, bar, openDropdown, schedule, audible, openFiles, saving, taken, closeMenus, startRecording, stopRecording, talks, link, newTab, closeTab }
