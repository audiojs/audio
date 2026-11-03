import recipes from '../recipes.js'
import { tracks as tracksOf, master as masterOf } from '../code.js'
import { builtins } from '../sources.js'
import { UNITS } from '../time.js'
import { THEMES } from '../theme.js'
import { root, generators, formats, overlays, grids, displays, SPEEDS, specs } from './config.js'
import { state, v, ed, rk, output, steps } from './context.js'
import { undoList, goTo, editSelection } from './edits.js'
import { pickFiles, shelved, unshelve, useSample, useCode, useRecipe, openSearch, exportFiles, share } from './files.js'
import { keys } from './format.js'
import { worn, dress, setTheme, openTheme, lookMenu, resetView, toggleShow, setDisplay, setUnits, setGrid } from './look.js'
import { openTools } from './menus.js'
import { toggleAB, toggleLoop, setSpeed, togglePlay } from './play.js'
import { retakeHere, startRecording, stopRecording, takeList, deletion } from './recording.js'
import { closed, newTab, closeTab, reopenTab } from './tabs.js'
import { newTrack, mastering, lineUp, matchUp, duckUnder, masterOut, untrack, detach } from './tracks.js'
import { addMarker, setPitch } from './writers.js'

// The page's commands: each act the menus offer, its keys, its tooltip, the help's line, the agent's tool and the Mac's
// menu bar, written once. A command is { id, label, keys, run, when?, press?, scope?, checked?, items?, hint?, tip?,
// edit?, script? }:
// - `label`, `hint`, `checked`, `items` and `when` (whether it can act now, else a menu dims it) may read `s`, what the
//   menus see as one opens (snapshot)
// - `keys` as the page shows them on this platform; `press`, the key that runs it, where `scope` lets it: 'page' not
//   while a field or the script is written in, 'any' there too, 'view' from the picture alone (view.js onkey). A press
//   tests what the key acts on as the keys always have, which a menu's `when` may not
// - `run(x)`: x the key's event when a key ran it, what the agent names (a tab), or nothing (a menu)
// - `edit`, the edit of the selection it makes (edits.js editSelection), by which the palette finds its keys;
//   `script`, its key in the script editor (CodeMirror's name)

const mod = e => e.metaKey || e.ctrlKey, is = (e, k) => e.key.toLowerCase() === k
// a letter alone, Shift or not
const plain = (e, k) => !mod(e) && !e.altKey && is(e, k)
// R where it is on the keyboard (⌥R writes another letter): not while it plays, its speed is held or it halts, nor held
// down
const rKey = e => !mod(e) && e.code === 'KeyR' && !state.playing && state.shuttle == null && !state.halting && !e.repeat
// while it records, R stops it, with Shift or Alt too
const recorded = act => () => state.recording ? stopRecording() : act()
const check = (label, checked, run, extra) => ({ label, checked, run, ...extra })

export const commands = [
  // File: the sound, where it comes from, where it goes, its tab
  { id: 'tab.new', label: 'New tab', hint: 'An empty track', run: () => newTab() },
  { id: 'file.open', label: 'Open file…', keys: keys('⌘O'), scope: 'any', press: e => mod(e) && is(e, 'o'), run: () => pickFiles() },
  { id: 'file.recent', label: 'Open recent', items: s => [...s.lately.map(r => ({ label: r.name, hint: r.meta, run: r.run })), '-', { label: 'Delete kept sounds…', hint: 'Opened or recorded here, in no tab', run: unshelve, disabled: !shelved().length }], when: s => !!s.lately.length },
  { id: 'sound.find', label: 'Find a sound…', tip: 'Freesound, Jamendo, Wikimedia', run: () => openSearch() },
  { id: 'sound.make', label: 'Sample or generate', items: () => [{ group: 'Samples' }, ...Object.entries(builtins).map(([name, text]) => ({ label: name, hint: text, run: () => useSample(name) })), { group: 'Generate' }, ...generators.map(g => ({ label: g.name, hint: g.text, run: () => useCode(g.code) }))] },
  { id: 'export', label: () => state.saves.length > 1 ? `Export ${state.saves.length} files` : 'Export', keys: keys('⌘S'), scope: 'any', press: e => mod(e) && is(e, 's'), script: 'Mod-s', when: s => !s.none && !state.exporting, run: () => exportFiles() },
  { id: 'export.as', label: 'Export as', items: s => [
    ...formats.map(f => check(f.name.toUpperCase(), state.format === f.name, () => state.setFormat(f.name), { hint: f.text, disabled: state.saves.length > 0 })),
    '-',
    ...['export.parts', 'export.track', 'export.tracks'].map(id => item(id, s))
  ] },
  { id: 'export.parts', label: 'Each part between markers', tip: 'A file per part', when: s => !s.none && !!output?.markers?.some(m => !m.duration), run: () => exportFiles(true) },
  { id: 'export.track', label: 'The track alone', hint: () => state.track ?? '', when: s => !s.none && !!state.track, run: () => exportFiles(false, state.track) },
  { id: 'export.tracks', label: 'Each track', hint: () => state.track ? `${tracksOf(ed.code).length} files` : '', when: s => !s.none && !!state.track, run: () => exportFiles(false, true) },
  { id: 'check', label: 'Check against', items: () => specs.map(sp => check(sp.label, state.spec === sp.key, () => state.setSpec(sp.key))) },
  { id: 'link.copy', label: 'Copy a link to this script', tip: 'Files opened here are not in it', run: () => share() },
  { id: 'tab.close', label: 'Close tab', run: id => closeTab(id) },
  { id: 'tab.reopen', label: 'Reopen closed tab', keys: keys('⇧⌘T'), scope: 'any', press: e => mod(e) && e.shiftKey && is(e, 't'), when: () => !!closed.length, run: () => reopenTab() },

  // Edit: what is selected, and the script's own history and groups
  { id: 'undo', label: 'Undo', keys: keys('⌘Z'), scope: 'view', press: e => mod(e) && is(e, 'z') && !e.shiftKey, when: () => ed.canUndo, run: () => ed.undo() },
  { id: 'redo', label: 'Redo', keys: keys('⇧⌘Z'), scope: 'view', press: e => mod(e) && (is(e, 'z') && e.shiftKey || is(e, 'y')), when: () => ed.canRedo, run: () => ed.redo() },
  { id: 'history', label: 'History', items: () => undoList().map(step => check(step.label, step.current, () => goTo(step.index), { hint: step.ahead ? 'undone' : '' })), when: () => steps.length >= 2 },
  { id: 'cut', label: 'Cut', keys: keys('⌘X'), edit: 'cut', scope: 'view', press: e => mod(e) && is(e, 'x') && v.selection && !v.band, when: s => s.sel && !s.band, run: () => editSelection('cut') },
  { id: 'copy', label: 'Copy', keys: keys('⌘C'), edit: 'copy', scope: 'view', press: e => mod(e) && is(e, 'c') && v.selection && !v.band, when: s => s.sel && !s.band, run: () => editSelection('copy') },
  // ⌘V the browser's paste, its clipboard with it (view.js)
  { id: 'paste', label: 'Paste', keys: keys('⌘V'), edit: 'paste', when: () => state.canPaste, run: () => editSelection('paste') },
  // the key, every range (a band, its box), as the picture has them; a menu, the selection
  { id: 'delete', label: 'Delete', keys: '⌫', edit: 'remove', scope: 'view', press: e => (e.key === 'Delete' || e.key === 'Backspace') && v.ranges.length > 0, when: s => s.sel, run: e => e ? editSelection('remove', v.band ? v.selection : v.ranges) : editSelection('remove') },
  { id: 'crop', label: 'Crop', keys: 'K', edit: 'crop', scope: 'page', press: e => plain(e, 'k') && state.selection && !state.band, when: s => s.sel && !s.band, run: () => editSelection('crop') },
  { id: 'mark', label: s => s.sel ? 'Mark the selection' : 'Add a marker', keys: 'M', tip: 'A click on a marker\'s name renames it', edit: 'mark', scope: 'page', press: e => plain(e, 'm') && state.whole, when: s => !s.none, run: () => addMarker() },
  // the edits picked made a group, or the group unmade (stack.js), but in a field being written
  { id: 'group', label: 'Group the edits', hint: 'Those picked with Shift, or the one chosen', keys: keys('⌘G'), scope: 'any', press: e => mod(e) && !e.shiftKey && is(e, 'g') && !e.target.closest?.('input, textarea, select, dialog'), when: s => !s.none, run: () => rk.group() },
  { id: 'ungroup', label: 'Ungroup', keys: keys('⇧⌘G'), scope: 'any', press: e => mod(e) && e.shiftKey && is(e, 'g') && !e.target.closest?.('input, textarea, select, dialog'), when: s => !s.none, run: () => rk.ungroup() },

  // Select
  { id: 'select.all', label: 'All', keys: keys('⌘A'), scope: 'view', press: e => mod(e) && is(e, 'a'), when: s => !s.none, run: () => v.select(0, v.duration) },
  // the key, whatever is selected (the ranges, the boxes, the carets beside the caret); a menu, the selection
  { id: 'select.none', label: 'None', keys: 'Esc', scope: 'view', press: e => e.key === 'Escape' && v.selected, when: s => !!s.sel, run: () => v.select(0, 0) },
  { id: 'select.fragment', label: 'The fragment at the caret', hint: 'between its cues', keys: 'double-click', when: s => !s.none, run: () => v.around('fragment') },
  { id: 'select.sound', label: 'The sound at the caret', hint: 'between its pauses', keys: 'triple-click', when: s => !s.none, run: () => v.around('sound') },
  { id: 'select.next', label: 'The next one like it, too', keys: keys('⌘D'), tip: 'The next pause, or stretch between cues\nAlt and drag adds any other range', scope: 'view', press: e => mod(e) && is(e, 'd'), when: s => !!s.sel && !s.band, run: () => v.addNext() },
  // the caret's keys are the picture's own (view.js key)
  { id: 'caret', label: 'Move the caret', hint: 'With Shift, the selection', items: s => ['caret.cue.next', 'caret.cue.back', 'caret.sound.next', 'caret.sound.back', 'caret.start', 'caret.end'].map(id => item(id, s)), when: s => !s.none },
  { id: 'caret.cue.next', label: 'To the next cue', keys: keys('⌥→'), run: () => v.step('fragment', 1) },
  { id: 'caret.cue.back', label: 'To the cue before', keys: keys('⌥←'), run: () => v.step('fragment', -1) },
  { id: 'caret.sound.next', label: 'To the next sound', keys: keys('⌘→'), run: () => v.step('sound', 1) },
  { id: 'caret.sound.back', label: 'To the sound before', keys: keys('⌘←'), run: () => v.step('sound', -1) },
  { id: 'caret.start', label: 'To the start', keys: 'Home', run: () => v.setCursor(0) },
  { id: 'caret.end', label: 'To the end', keys: 'End', run: () => v.setCursor(v.duration) },

  // View
  ...displays.map(d => ({ id: `display.${d.name}`, label: d.label, checked: () => state.display === d.name, run: () => setDisplay(d.name) })),
  { id: 'look.wave', label: 'Waveform options', items: () => lookMenu('wave') },
  { id: 'look.spec', label: 'Spectrogram options', items: () => lookMenu('spec') },
  { id: 'grid', label: 'Grid', items: () => grids.map(([name, label, hint]) => check(label, state.grid === name, () => setGrid(name), { hint })) },
  { id: 'show', label: 'Show', items: () => [
    ...overlays.map(([name, label, tip]) => check(label, state.show[name], () => toggleShow(name), { tip })),
    check('Pitch curve', state.pitch, () => setPitch(!state.pitch), { tip: 'The voice\'s pitch on the spectrogram, dragged whole or by its bends; a click on a selection\'s pitch tool shows it too' })
  ] },
  { id: 'snap', label: 'Snap to cues and markers', tip: 'Hold Alt to see them', checked: () => state.snapping, run: () => state.toggleSnap() },
  { id: 'zoom', label: 'Zoom', items: s => ['zoom.in', 'zoom.out', 'zoom.selection', 'zoom.all'].map(id => item(id, s)), when: s => !s.none },
  // the keys about the playhead, else the selection's middle or the caret (out: the playhead or the caret); a menu, about
  // the view's middle
  { id: 'zoom.in', label: 'In', keys: '=', scope: 'view', press: e => e.key === '=' || e.key === '+', run: e => e ? v.zoom(.5, v.playhead ?? (v.selection ? (v.selection[0] + v.selection[1]) / 2 : v.cursor)) : v.zoom(.5) },
  { id: 'zoom.out', label: 'Out', keys: '−', scope: 'view', press: e => e.key === '-' || e.key === '_', run: e => e ? v.zoom(2, v.playhead ?? v.cursor) : v.zoom(2) },
  { id: 'zoom.selection', label: 'To the selection', when: s => !!s.sel, run: () => v.zoomTo(...v.selection) },
  // the frequencies and the levels whole too
  { id: 'zoom.all', label: 'All of it', keys: '0', scope: 'view', press: e => e.key === '0' && !mod(e), run: () => v.fit() },
  { id: 'panel', label: 'Panel', items: () => [
    check('Shown', !!state.side, () => state.toggleSide()),
    '-',
    ...[['recipes', 'Recipes'], ['chat', 'Agent'], ['edits', 'Edits'], ['code', 'Code'], ['export', 'Export'], ['settings', 'Settings']].map(([name, label]) => check(label, state.side === name, () => state.setSide(name)))
  ] },
  { id: 'theme', label: 'Theme', items: () => [
    check('The screen', !worn, () => dress(null), { hint: 'Grey on black, as the site draws it' }),
    ...[['Light', /^light/], ['Dark', /^dark/], ['High contrast', /^hc/]].flatMap(([group, kind]) => ['-', { group }, ...THEMES.filter(t => kind.test(t.kind)).map(t => check(t.name, worn?.name === t.name, () => setTheme(t)))]),
    ...worn && !THEMES.some(t => t.name === worn.name) ? ['-', check(worn.name, true, () => {})] : [],
    '-',
    { label: 'Open a VS Code theme…', hint: 'Any theme\'s .json file', run: openTheme }
  ] },
  { id: 'units', label: 'Times in', items: () => UNITS.map(([name, label, example]) => check(label, state.units === name, () => setUnits(name), { hint: example })) },
  { id: 'view.reset', label: 'Reset the view', run: () => resetView() },

  // Track: the sounds side by side, one made, split off, set against another, mixed, taken away
  { id: 'track.new', label: 'New track', hint: 'Or double-click under the lanes', when: s => !s.none && !mastering(), run: () => newTrack() },
  { id: 'track.fromFile', label: 'New track from a file…', hint: 'Under the one edited, played with it', when: s => !s.none, run: () => pickFiles('', true) },
  { id: 'track.move', label: 'Move to a new track', edit: 'track', when: s => s.sel && !s.band && state.ranges < 2, run: () => editSelection('track') },
  { id: 'track.voice', label: 'Split the voice to a new track', hint: 'The rest stays here', edit: 'voice', when: s => !s.none && !mastering(), run: () => editSelection('voice') },
  { id: 'track.stems', label: 'Split into four stems', hint: 'Voice, bass, drums; the rest stays here', edit: 'stems', when: s => !s.none && !mastering(), run: () => editSelection('stems') },
  // a track's own edits with another (`names`): one submenu each, that one's name picked
  ...[['track.lineUp', 'Line up with', 'In time, by where the two agree', lineUp], ['track.match', 'Match with', 'Its tone, then its loudness', matchUp], ['track.duck', 'Duck under', 'Quieter while it sounds', duckUnder]]
    .map(([id, label, hint, act]) => ({ id, label, hint, items: s => s.names.map(name => ({ label: name, run: () => act(name) })), when: s => !!s.names.length })),
  { id: 'track.master', label: 'Add a master', hint: 'The tracks\' sum, through steps of its own', when: () => !!state.track && !masterOf(ed.code), run: () => masterOut() },
  { id: 'track.toTab', label: 'Move the track to its own tab', hint: () => state.track ?? '', when: () => !!state.track && !mastering(), run: () => detach() },
  { id: 'track.delete', label: 'Delete the track', hint: () => state.track ?? '', when: () => !!state.track, run: () => untrack() },

  // Process: the recipes, the methods by kind (menus.js kinds), the palette
  { id: 'recipes', label: 'Recipes', items: () => [...new Set(recipes.map(r => r.group))].flatMap(group => [{ group }, ...recipes.filter(r => r.group === group).map(r => ({ label: r.name, hint: r.text, run: () => useRecipe(r) }))]) },
  // ⌘P, as Figma's quick actions and Sublime's Goto Anything, or ⌘K, as Slack's, Linear's and GitHub's
  { id: 'palette', label: s => s.sel ? 'Find an edit for the selection…' : 'Find an edit…', keys: keys('⌘P'), scope: 'any', press: e => mod(e) && !e.shiftKey && (is(e, 'k') || is(e, 'p')), when: s => !s.none, run: () => openTools() },

  // Transport: what plays and what records, the takes recorded
  // Space stops a recording too; held, Play shuttles (play.js)
  { id: 'play', label: s => state.playing ? 'Pause' : s.sel ? 'Play the selection' : 'Play from the caret', keys: 'Space', tip: 'Hold Play and drag to rewind or skip', scope: 'page', press: e => e.key === ' ' && !e.target.closest('button, a'), script: 'Mod-Enter', when: s => s.whole && !state.recording, run: e => e && state.recording ? stopRecording() : togglePlay() },
  { id: 'loop', label: 'Loop', keys: 'L', scope: 'page', press: e => plain(e, 'l') && state.whole, checked: () => state.loop, when: s => !!s.whole, run: () => toggleLoop() },
  { id: 'compare', label: 'Hear it before the edits', keys: 'B', tip: 'The original, level-matched', scope: 'page', press: e => plain(e, 'b') && state.whole, checked: () => state.ab, when: () => state.canCompare, run: () => toggleAB() },
  { id: 'speed', label: 'Speed', hint: 'Pitch kept', items: () => SPEEDS.list.map(r => check(`${r}×`, state.speed === r, () => setSpeed(r))) },
  // R, ⇧R (with nothing to record over, R) and ⌥R (recording.js toggleRecording, Record's button)
  { id: 'record', label: () => state.whole ? 'Record at the caret' : 'Record', keys: 'R', scope: 'page', press: e => rKey(e) && !e.altKey && !(e.shiftKey && state.whole), when: () => !state.recording, run: recorded(() => startRecording()) },
  { id: 'record.track', label: 'Record a new track', hint: 'The others playing', keys: '⇧R', scope: 'page', press: e => rKey(e) && !e.altKey && e.shiftKey && state.whole, when: s => !state.recording && !s.none, run: recorded(() => startRecording(true)) },
  { id: 'record.take', label: 'Record another take', hint: 'Of the recording at the caret', keys: '⌥R', scope: 'page', press: e => rKey(e) && e.altKey, when: s => !state.recording && !s.none, run: recorded(() => retakeHere()) },
  { id: 'takes', label: 'Takes', hint: s => s.here ? `${s.here.list.length} here` : 'Record again where a take went in, or with the loop on', items: s => s.here ? [...takeList(s.here), '-', deletion(s.here)] : undefined, when: s => !!s.here },

  // Help
  { id: 'help.keys', label: 'Mouse and keys', run: () => root.querySelector('dialog.help').showModal() },
  { id: 'help.library', label: 'The library, audio', run: () => open('https://github.com/audiojs/audio#readme', '_blank', 'noopener') },
  { id: 'help.source', label: 'This page’s source', run: () => open('https://github.com/audiojs/audio/tree/master/playground', '_blank', 'noopener') }
]
const byId = new Map(commands.map(c => [c.id, c]))
export const command = id => byId.get(id)

// What the menus see as one opens (`s`): what is selected, whether there is a sound (`none`: not yet); the app menu adds
// the takes at the caret, the sounds to open again and the other tracks (menus.js)
export const snapshot = () => ({ sel: v.selection, band: v.band, whole: state.whole, none: !state.whole })
// A command as a menu's item: its words and state as `s` has them, the menu's own (`own`: a context's words, its icon)
// over them; `id` for the Mac's menu bar to run it by (desktop/app.js)
export function item(id, s, own) {
  const c = { ...byId.get(id), ...own }, at = x => typeof x === 'function' ? x(s) : x
  return {
    id, label: at(c.label), keys: c.keys, hint: at(c.hint), tip: c.tip, icon: c.icon,
    ...c.run && { run: () => c.run() },
    ...'checked' in c && { checked: at(c.checked) },
    ...c.items && { items: at(c.items) },
    ...c.when && { disabled: !c.when(s) }
  }
}

// Keys: those of commands, a space between (the help's, the tooltips'); a tooltip's words and keys, its label's
export const shortcut = (...ids) => ids.map(id => byId.get(id).keys).join(' ')
export const tip = id => `${byId.get(id).label} (${byId.get(id).keys})`
// the palette's: those of the command that makes the edit `type`
export const keysOf = type => commands.find(c => c.edit === type)?.keys
// the script editor's (script.js keys)
export const scriptKeys = () => Object.fromEntries(commands.filter(c => c.script).map(c => [c.script, () => c.run()]))
// The command a key runs where it was pressed: the page's (keys.js), or the picture's (`view`: view.js onkey)
export function pressed(event, view = false) {
  const typing = event.target.closest?.('.cm-editor, input, textarea, select, dialog')
  return commands.find(c => c.press && (view ? c.scope === 'view' : c.scope === 'any' || c.scope === 'page' && !typing) && c.press(event))
}
