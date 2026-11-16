import { ops, GROUPS, labelOf, rowOf, previews, format, hint, fromInput, named, toSlider, fromSlider, icons as groupIcons } from '../ops.js'
import { steps as stepsOf, dropStep, chain, rollback, number } from '../code.js'
import { builtins } from '../sources.js'
import menubar, { hinted, aim, cue } from '../menu.js'
import opIcons from '../icons.js'
import { SLOP } from '../view.js'
import { root, EMBED, STACKED, RECIPED, quickOf, QUICK, NEXT_EDITS, EDITS, SUGGESTS, formats, icons, glyphs, displays, stored, generators } from './config.js'
import { snapshot, item, keysOf } from './commands.js'
import { state, eng, v, ed, output, assign } from './context.js'
import { editSelection, addOp } from './edits.js'
import { pickFiles, reopenable, useSample, useCode, useRecipe, openSearch, callsOf, NOTE, SOUND, exportFiles } from './files.js'
import { keys } from './format.js'
import { later } from './persist.js'
import { ownSound } from './readouts.js'
import { toggleRecording, takesHere, takesMenu } from './recording.js'
import { schedule } from './run.js'
import { offered, codeFor, fits } from '../recipes.js'
import { OFFERS, rowFor } from '../kind.js'
import { others, trackMenu } from './tracks.js'

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
    { name: 'Edit', items: at('undo', 'redo', 'history', '-', 'cut', 'copy', 'paste', 'delete', 'crop', '-', 'mark', ...STACKED ? ['-', 'group', 'ungroup'] : []) },
    { name: 'Select', items: at('select.all', 'select.none', '-', 'select.fragment', 'select.sound', 'select.next', '-', 'caret') },
    { name: 'View', items: at(...displays.map(d => `display.${d.name}`), 'look.wave', 'look.spec', '-', 'minimap', 'grid', 'snap', 'pitch.curve', 'zoom', '-', 'panel', 'theme', '-', 'view.reset') },
    { name: 'Track', items: at('track.new', 'track.fromFile', 'track.move', 'track.voice', 'track.stems', '-', 'track.lineUp', 'track.match', 'track.duck', 'track.master', '-', 'track.toTab', 'track.delete') },
    { name: 'Process', items: [...RECIPED ? at('recipes', '-') : [], ...kinds().map(k => ({ ...k, disabled: s.none })), ...at('-', 'palette')] },
    { name: 'Transport', items: at('play', 'loop', 'compare', 'speed', '-', 'record', 'record.track', 'record.take', 'takes') },
    { name: 'Help', items: at('help.keys', 'help.library', 'help.source') }
  ]
}
// Every method by kind, a submenu each, for the output or what is selected (addOp), by name
const method = (name, open = true) => ({ label: labelOf(name), hint: ops[name].text, run: () => addOp(name, open), op: name })
const kinds = () => GROUPS.map(group => ({ label: group, icon: groupIcons[group], items: Object.values(ops).filter(op => op.group === group).map(op => method(op.name)) }))
// The methods last used (`recent`: addOp, from a menu or the palette), the newest first
export const used = name => { recent = [name, ...recent.filter(n => n !== name)].slice(0, 3); later() }
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
// Audacity's on a clip, in sections, no submenu to wait on or aim into. What the picture has a handle for leaves it (the
// fades, the corners; the level, the pill), how a track shows is its look's, and how it draws the settings'. First what
// the press means to do with what is there (`own`); then the methods it is most often given there (`leads`, as it words
// them: the level, the clicks taken out, a rebuild), always the same, in the same places, and the palette for every
// other (⌘P); the methods last used that are not among them, under Recent; last, the track's own (tracks.js trackMenu).
// At the caret: paste, a marker, the takes there
export function contextMenu() {
  const list = v.ranges, several = list.length > 1, here = takesHere(), s = snapshot()
  // an edit of what is selected: a command, worded and dimmed as here (`own`), or one only a context offers
  const use = (id, own) => item(id, s, own)
  const act = (label, type, when, icon) => ({ label, run: () => editSelection(type), disabled: !when, icon, op: type })
  const mark = label => item('mark', s, { label, tip: null, when: null, icon: glyphs.marker })
  const repair = [act(several || v.boxes.length > 1 ? 'Remove the clicks in each' : 'Remove the clicks here', 'declick', true, opIcons.declick), act('Rebuild from around it', 'repair', !several, opIcons.repair)]
  const track = v.tracks ? ['-', { group: 'Track' }, ...trackMenu(v.focus)] : []
  const sections = (own, leads = []) => {
    const again = recent.filter(n => ops[n] && !leads.some(it => it.op === n)).map(n => ({ ...method(n, false), hint: null, icon: opIcons[n] }))
    return [...own, '-', ...leads, item('palette', s, { label: 'Find an edit…', when: null, icon: glyphs.find }), ...again.length ? [{ group: 'Recent' }, ...again] : [], ...track]
  }
  // a band has no pill: its level stays here
  if (v.band) return sections([use('delete', { label: 'Delete the band', when: null, icon: opIcons.remove }), act('6 dB quieter', 'quieter', true, glyphs.down), act('6 dB louder', 'louder', true, glyphs.up)], repair)
  if (!list.length) return sections([
    use('paste', { label: v.carets.length > 1 ? `Paste at all ${v.carets.length} carets` : 'Paste', icon: opIcons.paste }),
    mark(v.carets.length > 1 ? 'A marker at each caret' : 'Add a marker'),
    ...here ? takesMenu(here) : []
  ])
  // (to a new track by a drag under the tracks; zoomed to by the length in the bar)
  return sections([
    use('cut', { when: () => !several, icon: opIcons.cut }), use('copy', { when: () => !several, icon: opIcons.copy }), use('paste', { when: () => state.canPaste && !several, icon: opIcons.paste }), use('delete', { when: null, icon: opIcons.remove }),
    use('crop', { when: () => !several, icon: opIcons.crop }),
    mark(several ? 'Mark each' : 'Mark it'),
    ...here ? takesMenu(here) : []
  ], [{ label: 'Normalize', run: () => addOp('normalize', false), icon: opIcons.normalize, op: 'normalize' }, ...repair])
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
// Embedded, the sound's ways in from its name over the picture, each a new sound in its place, one step undo takes
// back (files.js opening): a file; a take; New, an empty sound, nothing to play, Record taking it into nothing, the
// edits dimmed till there is a sound; a found one (Openverse, as the whole editor's search, its credit a line over it:
// files.js useResult); one generated (config.js generators, a submenu); the samples, past a hairline under a small head, as the list of
// edits parts its sections
export function soundMenu(event) {
  bar.at([
    { label: 'File…', hint: 'WAV, MP3, FLAC and more', icon: NOTE, run: () => pickFiles() },
    { label: state.recording ? 'Stop recording' : 'Record', hint: 'A new sound in its place', icon: 'M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10Z', run: () => toggleRecording(), disabled: state.playing },
    { label: 'New', hint: 'An empty sound', icon: 'M6 3h8l4 4v14H6zM14 3v4h4', run: () => useCode('') },
    { label: 'Find a sound…', hint: 'Freesound, Jamendo, Wikimedia', icon: 'm20 20-4.2-4.2M17 10.5a6.5 6.5 0 1 1-13 0 6.5 6.5 0 0 1 13 0', run: () => openSearch() },
    { label: 'Generate', icon: 'M3 12c2-6 4-6 6 0s4 6 6 0 4-6 6 0', items: generators.map(g => ({ label: g.name, hint: g.text, run: () => useCode(g.code) })) },
    '-',
    { group: 'Samples' },
    ...Object.entries(builtins).map(([name, text]) => ({ label: name, hint: text, icon: SOUND, checked: name === state.name, run: () => useSample(name, 'replace') }))
  ], 0, 0, event.currentTarget)
}
// Embedded, the edits suggested for the sound shown: for the page's own, the page's (?ops=); for another (opened,
// dropped, recorded), and for the page's own where it names none, what its kind is given next (config.js NEXT_EDITS),
// read as the recipes are (kind.js rowFor): till its kind is heard, or where that has no row, the general row, the
// page's edits where it names them
export function suggested() {
  if (QUICK.length && ownSound(state.name)) return QUICK
  return rowFor(QUICK.length ? { ...NEXT_EDITS, '': QUICK } : NEXT_EDITS, state.kind)
}
// The edits made, each with its place among the steps (`i`, code.js steps), in the chain's order, those bypassed (`on`
// false: commented out where they stand) among them, where they stand
export const madeSteps = code => stepsOf(code).map((s, i) => ({ ...s, i }))
// a made step's call as its settings take it: one bypassed says so (settings.js: set, it goes into its comment)
const callOf = s => s.on ? s.call : { ...s.call, off: true }
// Those, in their order, each with its values and a line on what it does: one made, its place in the chain (`n`, from
// 1), whether it is bypassed (`off`), pressed taken away (dropStep), as a switch turns a filter off; one not made, made
// as the menus make it; after them, the edits made by other means (a crop on the picture; a second of one)
export function quickEdits(code = ed.code) {
  const made = madeSteps(code), first = name => made.findIndex(s => s.name === name), list = suggested()
  const of = k => { const s = made[k]; return { label: labelOf(s.name), values: quickOf(s.text.slice(1))?.values ?? '', about: ops[s.name]?.text, n: k + 1, off: !s.on, run: () => ed.change(dropStep(ed.code, s.i)) } }
  return [
    ...list.map(q => first(q.name) < 0 ? { label: q.label, values: q.values, about: q.text, icon: q.icon, n: 0, name: q.name, args: q.args, run: () => addOp(q.name, false, q.args) } : of(first(q.name))),
    ...made.flatMap((s, k) => list.some(q => q.name === s.name) && first(s.name) === k ? [] : [of(k)])
  ]
}
// Embedded, the edits as the script has them now: how many are made (the plus counts them) and, laid as the chain,
// those made in the chain's order and those left to suggest (found by the field's search at their values): a list as
// long as it was told anew in place, its keys the same, laid again only when it grows or shrinks; the chain fitted to its row again after (fitChain), and
// the settings of an edit open followed (stepFollow). As the script changes, and as the sound shown or what it is
// heard to be does (readouts.js hearKind)
export function quicken(code = ed?.code) {
  if (!SUGGESTS || code == null) return
  state.made = stepsOf(code).filter(s => s.on).length
  if (EDITS === 'menu') return
  const all = quickEdits(code)
  for (const [name, list] of [['madeList', all.filter(e => e.n).sort((a, b) => a.n - b.n)], ['restList', all.filter(e => !e.n)]]) {
    if (list.length === state[name].length) list.forEach((e, i) => Object.assign(state[name][i], e))
    else state[name] = list
  }
  stepFollow(code)
  requestAnimationFrame(fitChain)
}
// Under one button, a menu of them: first the edits made, in their order, checked (one bypassed not); then those
// suggested not made. The button counts the edits made and heard (`made`)
export function opsMenu(event) {
  const all = quickEdits(), made = all.filter(e => e.n).sort((a, b) => a.n - b.n), rest = all.filter(e => !e.n)
  bar.at([
    ...made.map(e => ({ label: e.label, hint: e.values, about: e.about, checked: !e.off, run: e.run })),
    ...made.length && rest.length ? ['-'] : [],
    ...rest.map(e => ({ label: e.label, hint: e.values, about: e.about, icon: e.icon, run: e.run }))
  ], 0, 0, event.currentTarget)
}
// Embedded, the chain fitted to its row (?ui= edits chain): an edit made, or the field after them, that a long chain
// runs on to a line of its own has no bar before it, its room kept, so a line starts with an edit, never with a bar. In
// the order they are laid: while an edit is dragged along, the order it would leave them in (chain.js, their `order`)
export function fitChain() {
  const items = [...root.querySelectorAll('.chain-step, .chain-find')].sort((a, b) => (+a.style.order || 0) - (+b.style.order || 0))
  items.forEach((item, i) => item.toggleAttribute('data-wrap', i > 0 && item.offsetTop > items[i - 1].offsetTop + 2))
}
// Embedded, the chain's field (?ui= edits chain), Edit…, a button: pressed, a list under it of the edits a press makes
// of the sound as it is (`findable`), as a menu, a search at its top that the keys are in: a hairline between one
// group and the next; the recipes under their small head (recipes.js offered, those the sound's kind is offered first:
// kind.js OFFERS), then a row a kind (ops.js GROUPS, as the Process menu has them); a kind's edits open beside the list
// as a submenu, by the pointer over its row, a press, → or Enter, shut by ←, Escape or the pointer over another row of
// the first level (in a phone's frame, pressed, in the list's place, a way back over them), a tree to the keys. A row reads plainly (ops.js rowOf: Shrink pauses), the
// chain and the script showing the call. Typed in the search, every edit and every recipe whose name, values or what
// it does hold what is typed, flat, one group. One lit: ↑ ↓ move it, Enter makes it (a recipe: its whole chain, one
// step), the keys back on the field; a press makes one, the keys back with the page, so Space plays; Escape shuts the
// list, the keys on the field. The lit edit shows on the picture what it would do (ops.js hints). Not those a press has
// not what they need for: a range or a selection, another sound, the clipboard; nor a generator, which makes a sound
// and edits none
const pressable = op => !op.range && op.group !== 'Generate' && !op.params?.some(s => s.name === 'source' || s.selection) && op.name !== 'paste'
// an edit as a press makes it: what the library can't do without (addOp), else its first setting at its default, so
// what its row says it applies is what it applies (a trim at −40 dB, not a threshold of the library's own finding)
const pressed = op => {
  const need = (op.params ?? []).filter(s => s.required), first = op.params?.[0], text = v => typeof v === 'string' ? `'${v}'` : String(v)
  return need.length ? need.map(s => text(s.default)).join(', ') : ['number', 'string'].includes(typeof first?.default) ? text(first.default) : ''
}
// Silence's row of insert, which puts in a sound or seconds of silence (its `source`, so no row of its own): a second of
// silence at the caret, as Alt on the caret's line opens one on the picture; from the page (edits(), edit()) as from
// the row, the caret where it stands then. Pad, beside it, adds silence at both ends
const silence = group => ({ group, name: 'insert', args: null, call: 'insert(1)', label: 'Insert silence', values: '1s', about: 'A second of silence at the caret', icon: opIcons.insert ?? groupIcons[group], run: () => addOp('insert', false, `1, ${number(v.cursor, v.unit)}`) })
const every = GROUPS.flatMap(group => Object.values(ops).filter(op => op.group === group && pressable(op)).map(op => { const args = pressed(op); return { group, name: op.name, args, call: args ? `${op.name}(${args})` : op.name, label: rowOf(op.name), values: quickOf(`${op.name}(${args})`)?.values ?? '', about: op.text, icon: opIcons[op.name] ?? groupIcons[group], run: () => addOp(op.name, false, args || undefined) } }).concat(group === 'Silence' ? [silence(group)] : []))
// The one automatic edit made for the sound's kind (@audio/chain's auto(type): fn/auto.js), named for what it does to
// that kind and what it does in its tooltip: its chain is what it measures as it runs, so the list can't say it before.
// A sound with no word, or one of no voice, is music to it, which leaves a voice's repairs out (no noise bed taken, no
// room, no pops)
const AUTO = {
  speech: ['speech', 'Repair and level this voice', 'Measures the voice, then undoes only what it finds: clipping, clicks, pops, hum, a noise bed, a room, harsh s; evens its tone toward speech\'s; −16 LUFS, peaks under −1 dBTP'],
  'speech and music': ['voice-music', 'Repair and level this voice over music', 'Measures it, then undoes only what it finds: clipping, clicks, hum, the noise under the voice, harsh s; −16 LUFS, peaks under −1 dBTP'],
  music: ['music', 'Repair and level this song', 'Measures it, then undoes only what it finds: clipping, clicks, hum; a range wider than finished music keeps narrowed; −14 LUFS, peaks under −1 dBTP'],
  '': ['music', 'Repair and level this sound', 'Measures it, then undoes only what it finds: clipping, clicks, hum; a range wider than finished music keeps narrowed; −14 LUFS, peaks under −1 dBTP']
}
function automatic(kind) {
  const [type, label, what] = rowFor(AUTO, kind), args = `'${type}'`
  return { group: 'Auto', name: 'auto', args, call: `auto(${args})`, label, values: type, about: `${what}\nOne edit, Auto: its chain is what it measures as it runs`, icon: opIcons.auto ?? groupIcons.Dynamics, run: () => addOp('auto', false, args) }
}
// The recipes (recipes.js offered: each a chain on the sound, its own icon), those for a sound of its channels (an
// interview's two), those the sound's kind is offered first (kind.js OFFERS, read as NEXT is), then the rest in their
// order; each its code for the sound as it is (`channels`: a record's for one channel, recipes.js codeFor), how many
// edits it makes at the row's end, what it does and its edits in their order, each as its row and the chain say it
// (`Highpass 80Hz`; an arrow between, its values having commas), in its tooltip, a press putting its whole chain on the
// sound (files.js useRecipe; one that asks for a file, the reference a master matches, asks for it then)
function recipes(kind, channels) {
  const first = rowFor(OFFERS, kind), rank = p => first.includes(p.name) ? first.indexOf(p.name) : first.length
  return offered.filter(p => fits(p, channels)).sort((a, b) => rank(a) - rank(b)).map(p => {
    const calls = callsOf(codeFor(p, channels))?.map(c => { const q = quickOf(c), name = c.match(/^[\w$-]+/)[0]; return [rowOf(name), q?.values].filter(Boolean).join(' ') })
    return { group: 'Recipes', label: p.name, values: calls ? `${calls.length} edits` : 'script', about: calls ? `${p.text}\n${calls.join(' → ')}` : `${p.text}\nA script: it measures each mic, then sets them`, icon: p.icon, run: () => useRecipe(p) }
  })
}
// (the Recipes row's icon: layers, the chains they put on)
const RECIPE = 'M12 3 3 8l9 5 9-5-9-5ZM3 12l9 5 9-5M3 16l9 5 9-5'
// What the field finds, in its groups (named to a screen reader; Suggested by a small head too), each row its place
// among all (`at`, its id), its level (2, a kind's edits or the recipes, beside its row, in menus) and whether its value
// is a drag's to set (`drags`, findHold). With nothing typed: Suggested, a few ideas for this sound, four at most: the
// recipe its kind is offered first (kind.js OFFERS: a whole chain, its edits in its tooltip), then the edits it is
// suggested (`rest`: the page's ops for its own, its kind's for another's, suggested(), at the values they would be
// made with); then a row a kind, each kind's every edit beside it, a suggested one too; last, a row of the same make,
// Recipes, beside it the automatic edit made for the sound's kind, then every recipe, those for its kind first, the
// suggested one too. `open`, the kind (or Recipes) open; `kind`, what the sound is; `channels`, how many it has.
// Typed in, one group: every edit and recipe that holds the words, each once, a suggested edit at its values, those
// whose name begins with them first, then those whose name holds them, then their values, then what they do
const SHOWN = 4
export function findable(query, rest, open = '', kind = '', set = {}, channels) {
  const q = query.trim().toLowerCase(), sets = recipes(kind, channels), named = new Set(rest.map(e => e.name)), own = rowFor(OFFERS, kind)
  const made = sets.filter(p => own.includes(p.label)).slice(0, 1), edits = rest.map(e => ({ ...e, label: rowOf(e.name) }))
  // (a row that opens a submenu says no number at its end, which would read as a value to set: its chevron alone)
  const kinds = () => [...GROUPS.map(g => [g, every.filter(e => e.group === g).length]).filter(([, n]) => n).map(([g, n]) => ({ group: 'Kinds', kind: g, label: g, values: '', about: `${n} edits`, icon: groupIcons[g] })),
    { group: 'Kinds', kind: 'Recipes', label: 'Recipes', values: '', about: `${sets.length} recipes, a whole chain each, and the automatic edit for this sound`, icon: RECIPE }]
  const rank = e => { const name = e.label.toLowerCase(); return name.startsWith(q) ? 0 : name.includes(q) ? 1 : e.values?.toLowerCase().includes(q) ? 2 : e.about?.toLowerCase().includes(q) ? 3 : -1 }
  const all = !q ? [...[...made, ...edits].slice(0, SHOWN).map(e => ({ ...e, group: 'Suggested' })), ...kinds(), ...(open === 'Recipes' ? [automatic(kind), ...sets] : every.filter(e => e.group === open)).map(e => ({ ...e, group: open, level: 2 }))]
    : [...edits, ...every.filter(e => !named.has(e.name)), ...sets].map(e => [rank(e), e]).filter(([r]) => r >= 0).sort((a, b) => a[0] - b[0]).map(([, e]) => ({ ...e, group: 'Found' }))
  const groups = []
  all.forEach((e, at) => { const g = groups.at(-1)?.group === e.group ? groups.at(-1) : groups[groups.push({ group: e.group, sub: e.level === 2, head: e.level !== 2 && !q && e.group === 'Suggested' ? 'Suggested' : null, items: [] }) - 1]; g.items.push({ level: 1, ...valued(e, set), at }) })
  return groups
}
// A row as its values stand: an edit's, those a drag set (`set`, by its name: findHold) where it set them, made with
// them, each value apart (`parts`: its words, the comma after it but the last's, and whether a drag sets it); any other
// row's (a recipe's count), one part, set by none
function valued(e, set) {
  const args = e.name && set[e.name] != null ? set[e.name] : e.args, q = e.name && args != null && quickOf(`${e.name}(${args})`)
  if (!q) return { ...e, parts: e.values ? [{ i: -1, text: e.values, drags: false }] : [] }
  const vals = String(args).split(',').map(a => a.trim()), params = ops[e.name]?.params ?? []
  const parts = q.parts.map((text, i) => ({ i, text: i < q.parts.length - 1 ? `${text}, ` : text, drags: !!params[i] && !params[i].values && params[i].min != null && !Number.isNaN(+vals[i]) }))
  return args === e.args ? { ...e, parts } : { ...e, args, values: q.values, parts, run: () => addOp(e.name, false, args) }
}
// (the keys put on the field by the page, an edit taken away by them with none left: its focus opens nothing, chain.js)
export const focusQuietly = el => el?.focus()
const finds = () => root.querySelector('#edits-found'), field = () => root.querySelector('.chain-add'), search = () => root.querySelector('.found-search'), isOpen = () => !!finds()?.matches(':popover-open')
// The field, Edit…, a button, as a select's: pressed (Enter, Space), the list open, the keys in its search; pressed
// again, shut. ↓ or ↑ on it open it; a letter typed on it opens it and goes into the search
export function findToggle() { isOpen() ? findShut() : findOpen() }
export function findButtonKey(event) {
  const k = event.key
  if (k === 'ArrowDown' || k === 'ArrowUp') { event.preventDefault(); findOpen() }
  else if (k.length === 1 && k !== ' ' && !event.ctrlKey && !event.metaKey && !event.altKey) findOpen()
}
// (one or the other: the list open, an edit's settings shut, and their opening shuts the list: openStep)
export function findOpen() {
  const list = finds(), f = field()
  if (!list || !f || isOpen()) return
  closeStep(false)
  Object.assign(state, { findAt: 0, findKind: '', findDeep: false, finding: true })
  list.showPopover()
  // under the field, never over it, its left edge at the field's; as wide as a menu, or in a phone's frame (640 px and
  // under, as editor.css lays it) the frame, 8 px in from either side; as tall as the frame leaves under the field,
  // scrolled within where still cut short (cue)
  const r = f.getBoundingClientRect(), w = innerWidth <= 640 ? innerWidth - 16 : Math.min(innerWidth - 16, 360), top = r.bottom + 4, room = Math.max(80, innerHeight - 8 - top)
  Object.assign(list.style, { width: `${w}px`, left: `${Math.max(8, Math.min(r.left - 6, innerWidth - 8 - w))}px`, top: `${top}px`, maxHeight: `${room}px` })
  list.querySelector('.found-list').scrollTop = 0
  search()?.focus({ preventScroll: true })
  showHint()
}
// (shut: what a drag set of a row's values, not made, back to its own)
// (what was typed with it: the list opens again whole)
export function findShut() { aimed.stop(); if (isOpen()) finds().hidePopover(); Object.assign(state, { finding: false, findQuery: '', findKind: '', findDeep: false, findSet: {}, findHeld: null }); showHint() }
// The search left (Tab, a press outside, the window left): the list shut; by the field, its own press shuts it
export function findBlur(event) { if (event.relatedTarget !== field()) findShut() }
// The search's clear, once something is typed: emptied, the list whole again, the keys still in it
export function findClear() { Object.assign(state, { findQuery: '', findAt: 0, findKind: '', findDeep: false }); search()?.focus(); showHint() }
export function findInput(event) { Object.assign(state, { findQuery: event.target.value, findAt: 0, findKind: '', findDeep: false }); findOpen(); showHint() }
// An edit made from the list (`e`, with its values as they stand: findHold), the list shut, its search empty: by a
// press, the keys back with the page; by the keys, on the field, for the next. Its settings stay shut: its values were
// set in the list (findHold), and the edit pressed in the chain opens them
export function findMake(e, event) {
  if (!state.hasOutput) return
  e.run()
  findShut()
  if (event?.detail) search()?.blur()
  else focusQuietly(field())
}
// A row pressed: a kind's (or Recipes'), its edits open, the keys in them (menus); an edit or a recipe, made
export function findPress(e, event) { e.kind ? openKind(e.kind, true) : findMake(e, event) }
// Embedded, an edit the page asks for (embed.js edit(): `call` as its ops write one, `trim(-40)`, `reverse`), made as
// a row of the field makes it, once the sound is in: on the chain, the sound made again, a step of the history. One
// the editor does not know makes nothing, said in the console
export async function pageEdit(call) {
  const row = every.find(e => e.call === call), q = quickOf(call)
  if (!row && !q) return console.warn(`audio-repl: no edit ${call}`)
  while (!state.hasOutput) await new Promise(r => setTimeout(r, 100))
  row ? row.run() : addOp(q.name, false, q.args || undefined)
}
// Embedded, what the list offers the page (embed.js edits()), by kind, in its order, recipes left out: every edit a
// press makes, under its kind, as its row makes it, [{ kind, edits: [{ call, name, value, line }] }]: `call` what
// edit() takes (its own defaults, as the row's), `name` the row's words, `value` its value as the row shows it, `line`
// what it does, its tooltip
export const offer = () => GROUPS.map(kind => ({ kind, edits: every.filter(e => e.group === kind).map(e => ({ call: e.call, name: e.label, value: e.values, line: e.about })) })).filter(g => g.edits.length)
if (EMBED && parent !== window) addEventListener('message', e => {
  if (e.source !== parent) return
  if (e.data?.audio === 'edit') pageEdit(String(e.data.call))
  if (e.data?.audio === 'edits') parent.postMessage({ audio: 'edits', id: e.data.id, list: offer() }, '*')
})
// The pointer over a row lights it, on the level it is on; in menus the pointer over a kind opens its edits beside it,
// over another row of the first level shuts them (not in a phone's frame, where they open in the list's place, by a
// press alone). On its way to a kind's edits open beside the list, the rows of the first level it crosses let it pass,
// as the page's menus do (menu.js aim, the one rule): one takes it once it rests there
const aimed = aim()
export function findPoint(e, event) {
  const sub = state.findTree && state.findKind && e.level !== 2 && e.kind !== state.findKind && event?.pointerType === 'mouse' && innerWidth > 640 ? finds().querySelector('.found-group[data-sub]') : null
  aimed.move(event, sub, () => {
    if (!isOpen()) return
    state.findDeep = e.level === 2
    state.findAt = Math.max(0, state.found.findIndex(r => r.at === e.at))
    showHint()
    if (!state.findTree || e.level === 2 || event?.pointerType !== 'mouse' || innerWidth <= 640 || state.findKind === (e.kind ?? '')) return
    e.kind ? openKind(e.kind, false) : state.findKind = ''
  })
}
// A value of a row dragged across, as Play is held and dragged (play.js playPress): pressed and moved past SLOP, it
// follows the pointer over its setting's range as the edit's slider maps it (ops.js fromSlider, the range ACROSS px),
// the row's words and what the picture shows (ops.js hints) with it, a line at the row's foot as far along as the value
// is in its range (`findHeld`); each value its own (fade's in, its out). Let go, it stays so (`findSet`, by the edit's
// name), nothing made, the list open: a press on the row then makes the edit with its values as they stand, its
// settings opening on it. Escape puts the value back; the list shut, every value set goes back to its own. A press
// that does not move is the row's: made as it says. A value that is no number (a word, a choice) has no drag; a finger
// drags one across, a swipe up or down scrolling the list (editor.css touch-action)
const ACROSS = 320
export function findHold(e, i, event) {
  const s = ops[e.name]?.params?.[i], vals = e.args ? String(e.args).split(',').map(a => a.trim()) : []
  if (!e.parts?.[i]?.drags || !s || event.button || !event.isPrimary || !state.hasOutput) return
  const value = event.currentTarget, x0 = event.clientX, from = toSlider(s, +vals[i]), id = event.pointerId
  let moved = false
  const move = ev => {
    if (ev.pointerId !== id) return
    const dx = ev.clientX - x0
    if (!moved && Math.abs(dx) < SLOP) return
    if (!moved) { moved = true; value.setPointerCapture?.(id) }
    const at = Math.max(0, Math.min(1000, from + dx * 1000 / ACROSS)), args = vals.map((a, k) => k === i ? String(fromSlider(s, at)) : a).join(', ')
    const parts = valued({ ...e, args: e.args }, { [e.name]: args }).parts.map(p => p.text)
    state.findHeld = { at: e.at, args, parts, along: at / 1000 }
    state.findAt = Math.max(0, state.found.findIndex(r => r.at === e.at))
    showHint()
  }
  const end = (ev, keep) => {
    if (ev?.pointerId != null && ev.pointerId !== id) return
    for (const [type, f] of on) removeEventListener(type, f, true)
    const held = state.findHeld
    state.findHeld = null
    if (!moved) return
    // (the click the drag ends with is the drag's, making nothing)
    const stop = c => { c.preventDefault(); c.stopImmediatePropagation() }
    addEventListener('click', stop, { capture: true, once: true })
    setTimeout(() => removeEventListener('click', stop, true))
    if (keep && held) state.findSet = { ...state.findSet, [e.name]: held.args }
    showHint()
  }
  const on = [['pointermove', move], ['pointerup', ev => end(ev, true)], ['pointercancel', ev => end(ev, false)], ['keydown', ev => { if (ev.key === 'Escape' && moved) { ev.preventDefault(); ev.stopImmediatePropagation(); end(null, false) } }], ['blur', ev => { if (ev.target === window) end(null, false) }]]
  for (const [type, f] of on) addEventListener(type, f, true)
}
// a kind's edits open (menus), the keys in them where `deep`, else still on its row
function openKind(kind, deep) {
  Object.assign(state, { findKind: kind, findDeep: deep })
  if (deep) { state.findAt = 0; litInSight() }
  queueMicrotask(placeSub)
  showHint()
}
// back from a kind's edits to its row, the edits shut
export function findBack() {
  const kind = state.findKind
  Object.assign(state, { findKind: '', findDeep: false })
  state.findAt = Math.max(0, state.found.findIndex(r => r.kind === kind))
  litInSight()
  showHint()
}
// A kind's edits beside its row, as a submenu (a phone's frame has them in the list's place: editor.css): from the
// list's right edge, or its left where the frame has no room right of it, their top at the row's; within the frame,
// scrolled within
function placeSub() {
  const list = finds(), row = list?.querySelector('.found-row[aria-expanded="true"]'), sub = list?.querySelector('.found-group[data-sub]')
  if (!row || !sub || innerWidth <= 640) return
  const l = list.getBoundingClientRect(), r = row.getBoundingClientRect(), w = Math.min(300, innerWidth - 16), h = sub.scrollHeight
  const left = l.right + 4 + w <= innerWidth - 8 ? l.right + 4 : Math.max(8, l.left - 4 - w), top = Math.max(8, Math.min(r.top - 4, innerHeight - 8 - h))
  for (const [name, px] of [['--sub-x', left], ['--sub-y', top], ['--sub-w', w], ['--sub-h', innerHeight - 8 - top]]) list.style.setProperty(name, `${px}px`)
}
// the lit one in sight in the list
const litInSight = () => requestAnimationFrame(() => root.querySelector(`#edits-found-${state.litAt}`)?.scrollIntoView({ block: 'nearest' }))
export function findKey(event) {
  aimed.stop()
  const k = event.key, rows = state.found, n = rows.length, row = rows[state.lit], tree = state.findTree && isOpen()
  if (k === 'ArrowDown' || k === 'ArrowUp') {
    event.preventDefault()
    if (!isOpen()) return findOpen()
    if (n) { state.findAt = (state.lit + (k === 'ArrowDown' ? 1 : n - 1)) % n; litInSight(); showHint() }
  }
  // (→ or Enter on a kind's row opens its edits, the keys in them; ← back to its row)
  else if (tree && row?.kind && (k === 'ArrowRight' || k === 'Enter')) { event.preventDefault(); openKind(row.kind, true) }
  else if (tree && state.findDeep && k === 'ArrowLeft') { event.preventDefault(); findBack() }
  else if (k === 'Enter') { event.preventDefault(); if (!isOpen()) findOpen(); else if (row) findMake(row) }
  // (Escape: a kind's edits shut first, then the list)
  else if (k === 'Escape' && tree && state.findKind) { event.preventDefault(); event.stopPropagation(); findBack() }
  else if (k === 'Escape' && (isOpen() || state.findQuery)) { event.preventDefault(); event.stopPropagation(); findShut(); focusQuietly(field()) }
}
// What the edit lit in the list, or one being set in its settings, would do, drawn over the picture (ops.js hints),
// among the view's other guides, gone with it: of the sound shown, its samples (`sound`)
let marked = []
// and the threshold trim and shrink would find in it (`threshold`, dB: worker.js threshold, asked once an output, the
// hint drawn again once it comes)
function sound() {
  if (!output) return null
  if (output.threshold === undefined) { const out = output; out.threshold = null; eng.threshold(out.id).then(t => { out.threshold = t; if (out === output) state.finding ? showHint() : rolledIn() }, () => {}) }
  return { duration: output.duration, sampleRate: output.sampleRate, threshold: output.threshold, ...!output.long && output.channels && { channels: output.channels } }
}
function hintWith(marks) {
  if (!v) return
  v.guides = [...(v.guides ?? []).filter(g => !marked.includes(g)), ...marks]
  marked = marks
}
function showHint() {
  const e = state.finding && state.found[state.lit], held = state.findHeld?.at === e?.at ? state.findHeld : null
  hintWith(e?.name ? hint(e.name, named(e.name, held?.args ?? e.args), sound()) : [])
  // (and each row's tooltip, the list laid out anew: its value whole where its room cut it short, menu.js hinted; and
  // where it, or a kind's edits beside it, is cut short by the frame's foot, its cut edges said: menu.js cue)
  requestAnimationFrame(() => { if (!isOpen()) return; hinted(finds().querySelectorAll('.found-row')); cue(finds().querySelector('.found-list')); cue(finds().querySelector('.found-group[data-sub]')) })
}
// Embedded, an edit of the chain pressed (?ui= edits chain, `k` its place among those made): its settings drop from it,
// one shape with it, as the old widget's pill and its menu were (index.html #step-settings): what it does, then a slider
// or a choice each, as the edits' cards open to them (settings.js), then Remove (chain.js dropEdit); one with no
// settings, what it does and Remove. A press on it again or outside them, or Escape, closes them, the keys back on the
// edit. Its call followed as the code changes (a slider's own edits, an undo), by its place among those made; gone from
// there, another's, they close
let step = null
const panel = () => root.querySelector('#step-settings')
export async function openStep(k, event) {
  findShut()
  const open = panel().matches(':popover-open'), again = open && step?.k === k
  if (open) closeStep(false)
  const s = madeSteps(ed.code)[k]
  if (again || !state.hasOutput || !s) return
  const { default: settings } = await import('../settings.js'), card = { call: callOf(s), params: null }
  card.params = settings(card, { ed, describe: name => eng.describe(name), duration: () => v.duration, onpreview: (name, was, is) => { v.preview(fromInput(name, is) ? null : previews[name]?.(was, is, v.duration) ?? null); stepHint(s, is) }, onsettle: () => { if (!pointed) stepHint(null) }, onpoint: (name, args) => point(s, name, args) })
  step = { k, name: s.name, card }
  Object.assign(state, { stepOpen: k, stepTitle: labelOf(s.name), stepAbout: ops[s.name]?.text ?? '' })
  const p = panel()
  p.querySelector('.step-settings-body').replaceChildren(card.params.dom)
  await card.params.load()
  if (step?.card !== card) return
  p.showPopover()
  placeStep()
  // pressed by the keys, the keys on its first setting, else on Remove
  if (!event.detail) (p.querySelector('.step-settings-body :is(input, button)') ?? p.querySelector('.step-remove'))?.focus()
}
// Its tab over the edit, as wide and as tall; its body under it, as wide as a menu (or the tab, if wider), within the
// frame: its left edge at the edit's, else its right edge at the edit's, else 8 px in from the frame's side, the corner
// the tab stands on squared (`join`); as tall as the frame leaves under the edit, scrolled within. Again as the chain is
// laid anew (the frame resized) and as the edit's values change its width (stepFollow)
function placeStep() {
  const p = panel(), edit = step && root.querySelectorAll('.chain-step > .chain-edit')[step.k]
  if (!edit || !p.matches(':popover-open')) return
  const r = edit.getBoundingClientRect(), w = Math.min(innerWidth - 16, Math.max(264, Math.ceil(r.width)))
  const left = Math.max(8, Math.min(r.left + w <= innerWidth - 8 ? r.left : r.right - w, innerWidth - 8 - w))
  Object.assign(p.style, { left: `${left}px`, top: `${r.top}px`, width: `${w}px` })
  for (const [name, px] of [['--tab-x', r.left - left], ['--tab-w', r.width], ['--tab-h', r.height], ['--room', Math.max(80, innerHeight - 8 - r.bottom)]]) p.style.setProperty(name, `${px}px`)
  p.dataset.join = Math.abs(r.left - left) < 1 ? 'left' : Math.abs(left + w - r.right) < 1 ? 'right' : ''
}
// closed: the keys back on the edit where they were in the settings
export function closeStep(back = true) {
  const p = panel(), was = step
  step = null
  cancelAnimationFrame(unpoint)
  pointed = null
  stepHint(null)
  state.stepOpen = -1
  if (p?.matches(':popover-open')) p.hidePopover()
  if (back && was && p.contains(document.activeElement)) root.querySelector(`.chain-step:nth-child(${was.k + 1}) .chain-edit`)?.focus()
}
export function stepToggle(event) { if (event.newState === 'closed' && step) closeStep() }
// An edit's settings pointed at or set (a slider pointed at, focused or dragged): what it would do, drawn as the list
// draws it (ops.js hints), the part the setting pointed at governs whole, the rest quieter (a fade's in pointed at,
// its out a third as strong: each mark's `of`). One whose marks are of the sound it is given (a trim's cut) has the
// chain shown up to it meanwhile, kept to the steps before it (run.js rollback, saying nothing), and draws once that is
// the sound shown; let go and pointed away, the whole chain again
let rolled = null, drawing = null, pointed = null, unpoint = 0
// (a setting pointed at, its name and the call's values; none: gone a frame on, unless another is pointed at by then)
function point(s, name, args) {
  cancelAnimationFrame(unpoint)
  if (name) { pointed = name; return stepHint(s, args) }
  unpoint = requestAnimationFrame(() => { pointed = null; stepHint(null) })
}
function stepHint(s, args) {
  if (!s) {
    drawing = null
    hintWith([])
    if (rolled != null) { rolled = null; assign({ viewing: { delta: null, back: null } }); schedule(0) }
    return
  }
  drawing = () => hint(s.name, args, sound()).map(m => pointed && m.of && !m.of.includes(pointed) ? { ...m, quiet: true } : m)
  if (!fromInput(s.name, args)) return hintWith(drawing())
  if (rolled == null) {
    const at = chain(ed.code)?.calls.findIndex(k => k.dot === s.call.dot) ?? -1
    if (at < 0) return
    rolled = at
    assign({ viewing: { delta: null, back: at, quiet: true } })
    schedule(0)
    requestAnimationFrame(rolledIn)
  }
  else if (output?.code === rollback(ed.code, rolled)) hintWith(drawing())
}
// (drawn once the sound before the edit is the one shown)
function rolledIn() {
  if (rolled == null || !drawing) return
  if (output?.code === rollback(ed.code, rolled)) hintWith(drawing())
  else requestAnimationFrame(rolledIn)
}
function stepFollow(code) {
  if (!step) return
  const s = madeSteps(code)[step.k]
  if (!s || s.name !== step.name) return closeStep()
  step.card.call = callOf(s)
  step.card.params.refresh()
  requestAnimationFrame(placeStep)
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
      const r = by.getBoundingClientRect(), w = m.offsetWidth, h = m.offsetHeight, under = r.bottom + 6 + h <= innerHeight - 8
      // over it, held there by its foot, so what opens in it (the export's edit list) grows up, within the window
      Object.assign(m.style, { positionArea: 'none', inset: 'auto', margin: '0', left: `${Math.max(8, Math.min(r.left, innerWidth - 8 - w))}px`, ...under ? { top: `${r.bottom + 6}px`, maxHeight: '' } : { bottom: `${innerHeight - r.top + 6}px`, maxHeight: `${r.top - 14}px` } })
      cue(m)
    })
  }, true)
  // an edit's settings (openStep): Escape closes them, the keys back on the edit; so does a press outside them but on an
  // edit of the chain, whose own press opens or closes them
  panel()?.addEventListener('keydown', event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeStep() } })
  addEventListener('pointerdown', event => { if (step && !panel().contains(event.target) && !event.target.closest?.('.chain-edit')) closeStep() }, true)
  // the chain fitted to its row as it is laid out anew (the frame resized, an edit made or taken away), an edit's
  // settings with it
  if (root.querySelector('.embed-chain')) new ResizeObserver(() => { fitChain(); placeStep() }).observe(root.querySelector('.embed-chain'))
  // the pointer gone from the field's list and a kind's edits open beside it (inside it): nothing it was about to take
  finds()?.addEventListener('pointerleave', () => aimed.stop())
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
