import { ops, GROUPS, labelOf, icons as groupIcons } from '../ops.js'
import { steps as stepsOf, dropStep } from '../code.js'
import { builtins } from '../sources.js'
import menubar from '../menu.js'
import opIcons from '../icons.js'
import { root, quickOf, QUICK, formats, icons, glyphs, displays, stored } from './config.js'
import { command, snapshot, item, keysOf } from './commands.js'
import { state, v, ed } from './context.js'
import { editSelection, addOp } from './edits.js'
import { pickFiles, reopenable, useSample, NOTE, SOUND, exportFiles } from './files.js'
import { keys } from './format.js'
import { later } from './persist.js'
import { toggleRecording, takesHere, takesMenu } from './recording.js'
import { others } from './tracks.js'

// Menus: the app menu, the context menu, the picture's dropdown and the palette, the menus a button opens, each
// placed and closed

// the methods last used, the newest first (used)
export let recent = Array.isArray(stored.recent) ? stored.recent.filter(n => typeof n === 'string').slice(0, 3) : []
// The app menu: everything the page does, each where apps put it, with its keys (menu.js), as the commands have it
// (commands.js). Items that can't act now show, dimmed, so the menu also says what there is.
function menus() {
  const s = { ...snapshot(), here: state.hasOutput && takesHere(), lately: reopenable(), names: others() }
  const at = (...ids) => ids.map(id => id === '-' ? '-' : item(id, s))
  return [
    { name: 'File', items: at('tab.new', 'file.open', 'file.recent', 'sound.find', 'sound.make', '-', 'export', 'export.as', 'check', 'link.copy', '-', 'tab.close', 'tab.reopen') },
    { name: 'Edit', items: at('undo', 'redo', 'history', '-', 'cut', 'copy', 'paste', 'delete', 'crop', '-', 'mark', '-', 'group', 'ungroup') },
    { name: 'Select', items: at('select.all', 'select.none', '-', 'select.fragment', 'select.sound', 'select.next', '-', 'caret') },
    { name: 'View', items: at(...displays.map(d => `display.${d.name}`), 'look.wave', 'look.spec', 'grid', '-', 'show', 'snap', 'zoom', '-', 'panel', 'theme', 'units', '-', 'view.reset') },
    { name: 'Track', items: at('track.new', 'track.fromFile', 'track.move', 'track.voice', 'track.stems', '-', 'track.lineUp', 'track.match', 'track.duck', 'track.master', '-', 'track.toTab', 'track.delete') },
    { name: 'Process', items: [...at('recipes', '-'), ...kinds().map(k => ({ ...k, disabled: s.none })), ...at('-', 'palette')] },
    { name: 'Transport', items: at('play', 'loop', 'compare', 'speed', '-', 'record', 'record.track', 'record.take', 'takes') },
    { name: 'Help', items: at('help.keys', 'help.library', 'help.source') }
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
  const list = v.ranges, several = list.length > 1, here = takesHere(), s = snapshot()
  const lead = (label, name) => ({ label, run: () => addOp(name, false), icon: opIcons[name], op: name })
  // an edit of what is selected (`op`, its type, which the methods' lists then leave out): a command, worded and dimmed
  // as here (`own`), or one only a context offers
  const use = (id, own) => ({ ...item(id, s, own), op: command(id).edit })
  const act = (label, type, when, icon) => ({ label, run: () => editSelection(type), disabled: !when, icon, op: type })
  const mark = label => item('mark', s, { label, tip: null, when: null, icon: glyphs.marker })
  const repair = [act(several || v.boxes.length > 1 ? 'Remove the clicks in each' : 'Remove the clicks here', 'declick', true, opIcons.declick), act('Rebuild from around it', 'repair', !several, opIcons.repair), act('Take this noise out everywhere', 'denoise', true, opIcons.denoise)]
  // what the press means to do with what is there, then every method under one Process, the last used first, none twice
  const process = (own, leads = {}) => [...own, '-', { label: 'Process', icon: groupIcons.Level, items: [...recents(leads).slice(1), ...recents(leads).length ? ['-'] : [], ...kinds(leads, false, own.map(it => it.op)), '-', item('palette', s, { label: 'Find an edit…', when: null, icon: glyphs.find })] }]
  // a band has no pill: its level stays here
  if (v.band) return process([use('delete', { label: 'Delete the band', when: null, icon: opIcons.remove }), act('6 dB quieter', 'quieter', true, glyphs.down), act('6 dB louder', 'louder', true, glyphs.up)], { Repair: repair })
  if (!list.length) return process([
    use('paste', { label: v.carets.length > 1 ? `Paste at all ${v.carets.length} carets` : 'Paste', icon: opIcons.paste }),
    mark(v.carets.length > 1 ? 'A marker at each caret' : 'Add a marker'),
    ...here ? takesMenu(here) : []
  ])
  // (to a new track by a drag under the tracks; zoomed to by the length in the bar)
  return [
    ...process([
      use('cut', { when: () => !several, icon: opIcons.cut }), use('copy', { when: () => !several, icon: opIcons.copy }), use('paste', { when: () => state.canPaste && !several, icon: opIcons.paste }), use('delete', { when: null, icon: opIcons.remove }),
      use('crop', { when: () => !several, icon: opIcons.crop }),
      mark(several ? 'Mark each' : 'Mark it'),
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
  // each with the keys of the command that makes it (commands.js)
  const t = (type, label, icon = type) => ({ type, label, keys: keysOf(type), icon: icons[icon] ?? opIcons[icon] ?? groupIcons.Level })
  if (boxes > 1) return [t('remove', `Remove all ${boxes} bands`), t('quieter', 'Each 6 dB quieter'), t('louder', 'Each 6 dB louder'), t('repair', 'Rebuild each from its surroundings'), t('declick', 'The clicks in each, taken out'), t('denoise', 'The noise in each, taken 12 dB down in its band everywhere', 'repair')]
  if (band) return [t('remove', 'Remove this band'), t('quieter', 'This band 6 dB quieter'), t('louder', 'This band 6 dB louder'), t('repair', 'Rebuild this band from its surroundings'), t('declick', 'The clicks here, taken out'), t('denoise', 'The noise here, taken 12 dB down in this band everywhere', 'repair')]
  // several ranges: what acts on each alike; pauses, each shortened
  if (ranges > 1) return [t('remove', `Delete all ${ranges}`), t('quieter', 'Each 3 dB quieter'), t('louder', 'Each 3 dB louder'), ...(pauses ? [t('shorten', 'Shorten each pause to a quarter second', 'cut')] : []), t('declick', 'The clicks in each, taken out'), t('denoise', `The noise alone in all ${ranges}: learned there, taken 12 dB down everywhere`, 'repair')]
  if (selection) return [t('crop', 'Crop'), t('remove', 'Delete'), t('cut', 'Cut'), t('copy', 'Copy'), t('track', 'Move to a new track'), t('quieter', '3 dB quieter'), t('louder', '3 dB louder'), t('declick', 'The clicks here, taken out'), t('repair', 'Rebuild from its surroundings'), t('denoise', 'The noise here, taken 12 dB down everywhere', 'repair')]
  // several carets: a paste at each, a marker at each
  if (carets > 1) return [...(canPaste ? [t('paste', `Paste at all ${carets}`)] : []), t('mark', `A marker at each of the ${carets} carets`, 'paste')]
  return [...canPaste ? [t('paste', 'Paste at the caret')] : [], ...whole ? [t('voice', 'Split the voice to a new track', 'vocals'), t('stems', 'Split into four stems: voice, bass, drums, the rest', 'rebalance')] : []]
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
