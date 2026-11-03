import recipes from '../recipes.js'
import { ops, GROUPS, labelOf, icons as groupIcons } from '../ops.js'
import { steps as stepsOf, dropStep, tracks as tracksOf, master as masterOf } from '../code.js'
import { builtins } from '../sources.js'
import menubar from '../menu.js'
import { UNITS } from '../time.js'
import opIcons from '../icons.js'
import { THEMES } from '../theme.js'
import { root, quickOf, QUICK, generators, formats, icons, overlays, grids, glyphs, displays, SPEEDS, specs, stored } from './config.js'
import { state, v, ed, rk, output, steps } from './context.js'
import { undoList, goTo, editSelection, addOp } from './edits.js'
import { pickFiles, shelved, reopenable, unshelve, useSample, NOTE, SOUND, useCode, useRecipe, openSearch, exportFiles, share } from './files.js'
import { keys } from './format.js'
import { worn, dress, setTheme, openTheme, lookMenu, resetView, toggleShow, setDisplay, setUnits, setGrid } from './look.js'
import { later } from './persist.js'
import { toggleAB, toggleLoop, setSpeed, togglePlay } from './play.js'
import { toggleRecording, retakeHere, startRecording, takesHere, takeList, deletion, takesMenu } from './recording.js'
import { closed, newTab, closeTab, reopenTab } from './tabs.js'
import { newTrack, others, mastering, lineUp, matchUp, duckUnder, masterOut, untrack, detach } from './tracks.js'
import { addMarker, setPitch } from './writers.js'

// Menus: the app menu, the context menu, the picture's dropdown and the palette, the menus a button opens, each
// placed and closed

// the methods last used, the newest first (used)
export let recent = Array.isArray(stored.recent) ? stored.recent.filter(n => typeof n === 'string').slice(0, 3) : []
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
export const used = name => { recent = [name, ...recent.filter(n => n !== name)].slice(0, 3); later() }
const recents = (lead = {}) => {
  const own = Object.values(lead).flat(), list = recent.filter(n => ops[n]).map(n => own.find(it => it.op === n) ?? { ...method(n, false), icon: opIcons[n] })
  return list.length ? ['-', { group: 'Recent' }, ...list] : []
}
// an edit of the selection, as a menu item: dimmed while there is nothing it can act on
const edit = (label, type, key, when, tip) => ({ label, keys: key && keys(key), tip, run: () => editSelection(type), disabled: !when })
export let bar
// How a band shows (its look, in its layer): a dropdown by it, as Figma's, every group in sight, no levels to go
// through; the look again, a press outside or Esc closes it, another band's moves it there
let dropOwner = null
// (`owner` by what it opens for: a layer's look drawn again, as the layers are, is the same look)
const sameOwner = (a, b) => !!a && !!b && (a === b || a.matches('.layer-look') && b.matches('.layer-look') && a.dataset.band === b.dataset.band)
export function openDropdown(owner) {
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
export function dropToggle(event) { if (event.target === event.currentTarget && event.newState === 'closed' && dropOwner) closeDropdown() }
// A menu a button opens (popovertarget: the status bar's facts): under the button, its left
// edge at the button's, or over it where there is no room under it, within the window. Set as it opens: CSS anchor
// positioning leaves it in the window's middle in a browser that has no anchor from its button (implicit anchors: Chrome
// 133, not yet Safari nor Firefox, MDN). Placed as it opens: measured in the frame it first shows in, before that frame
// is painted (it shows only once its open is done, after this event, so not before), never seen where it does not stay
let invoker = null
// A select in it, a look's (colours): its list under its button, as wide at least, or over it where the window ends
export function placeList(event) {
  if (event.newState !== 'open') return
  const list = event.target, r = list.previousElementSibling.getBoundingClientRect(), h = list.offsetHeight
  const top = r.bottom + 4 + h > innerHeight - 8 ? Math.max(8, r.top - 4 - h) : r.bottom + 4
  Object.assign(list.style, { left: `${r.left}px`, top: `${top}px`, minWidth: `${r.width}px` })
}
// The picture's context menu (a right-click on it): what is done to what is under the pointer and nothing else, as
// Audacity's on a clip. What the picture has a handle for leaves it (the fades, the corners; the level, the pill), and
// how it draws is the settings'. Then the methods last used, each written for it, and every method by kind, as Process
// has them, what the selection is most often given of each kind leading its list (a crossfade across it; the clicks
// taken out, a rebuild, the noise learned there), each a step of the chain; ⌘P finds any. At the caret: paste, a
// marker, all of it, and the methods for all of it
export function contextMenu() {
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
// The palette, a notch over the picture (⌘P, as Figma's quick actions and Sublime's Goto Anything, or ⌘K, as Slack's,
// Linear's and GitHub's; the menus, Add an edit at the foot of the edits), the words to find
// one in hand
export function openTools() {
  closeMenus()
  const palette = root.querySelector('#palette'), r = root.querySelector('.view').getBoundingClientRect()
  Object.assign(palette.style, { left: `${r.left + r.width / 2}px`, top: `${r.top + 4}px` })
  state.toolQuery = ''
  state.pick = 0
  if (!palette.matches(':popover-open')) palette.showPopover()
  palette.querySelector('input').focus()
}
export const closePalette = () => root.querySelector('#palette').hidePopover()
// The edits for what is selected: a time range, a band of it on the spectrogram, several ranges, or at the caret a paste
export function quick({ band, boxes, ranges, selection, carets, canPaste, pauses, whole }) {
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
// The palette's keys: the arrows go through what it found, Enter takes it, Escape closes it
export function toolKey(event) {
  const items = state.toolGroups.flatMap(g => g.items), k = event.key
  if (k === 'ArrowDown' || k === 'ArrowUp') { event.preventDefault(); state.pick = (state.pick + (k === 'ArrowDown' ? 1 : items.length - 1)) % Math.max(1, items.length) }
  else if (k === 'Enter') { event.preventDefault(); items[Math.min(state.pick, items.length - 1)]?.run() }
  else if (k === 'Escape') { event.preventDefault(); closePalette() }
}
export function soundMenu(event) {
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
export function opsMenu(event) {
  const made = stepsOf(ed.code).map((s, i) => ({ ...s, i })).filter(s => s.on), rest = QUICK.filter(q => !made.some(s => s.name === q.name))
  bar.at([
    ...made.map(s => ({ label: labelOf(s.name), hint: quickOf(s.text.slice(1))?.values ?? '', about: ops[s.name]?.text, checked: true, run: () => ed.change(dropStep(ed.code, s.i)) })),
    ...made.length && rest.length ? ['-'] : [],
    ...rest.map(q => ({ label: q.label, hint: q.values, about: q.text, icon: q.icon, run: () => addOp(q.name, false, q.args) }))
  ], 0, 0, event.currentTarget)
}
// Embedded (?controls= save), the result saved in the format picked, as Export as picks one
export function saveMenu(event) {
  bar.at(formats.map(f => ({ label: f.name.toUpperCase(), hint: f.text, checked: f.name === state.format, run: () => { state.setFormat(f.name); exportFiles() } })), 0, 0, event.currentTarget)
}
// Every popover over the page closed; the look's dropdown by closeDropdown, so its owner and state say so at once, not
// when the popover's toggle event comes
export const closeMenus = () => { closeDropdown(); for (const menu of root.querySelectorAll('[popover]')) if (menu.matches(':popover-open')) menu.hidePopover() }

export function wire() {
  bar = menubar(root.querySelector('.menubar'), menus)
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
  // the keys in the help as this platform names them
  for (const dt of root.querySelectorAll('.help-list dt')) dt.textContent = keys(dt.textContent)
}
