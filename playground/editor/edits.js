import { ops, methods } from '../ops.js'
import { prepare, offCalls, append, source, chain, number, declared, inline, between, tracks as tracksOf, focus, soundOf, addTrack, master as masterOf, retake } from '../code.js'
import { unique } from '../sources.js'
import { clip, paste, pasteNew, pasting } from './clipboard.js'
import { keep } from './config.js'
import { state, eng, v, ed, rk, steps, depthWas, queued, assign } from './context.js'
import { lengthOf, shelf, saving, taken } from './files.js'
import { label, quote, brief, note } from './format.js'
import { used } from './menus.js'
import { store } from './persist.js'
import { newTab } from './tabs.js'
import { focusOn, laneName, toTrackOf, anew, voiceOut, stemsOut, mastering } from './tracks.js'
import { splice, seam, addMarker, level, bandLevel } from './writers.js'

// The script's edits: its history (undo, redo, each step's name), the selection's edits, a method added, the script
// written over a range, an edit spread through the tracks, the chain flattened

// History: the script after each step it took, named by what changed (said), for the list under Undo. Typing merged
// into a step changes it in place; a slider's step is taken where it comes to rest. Beside each step, what was selected
// on the picture (view.js state) and the card chosen in the edits, as it was made (`before`, the edit not yet drawn) and
// as it was left (`after`, when undone): undo brings back what was selected and chosen before the step, redo what was
// after it, as a text editor's history brings back its selections (CodeMirror keeps them in each of its events), and
// as Photoshop's history goes back to the state an action was taken from: an edit made with the output rolled back to a
// card takes the steps after it away, and undone, brings them back with the output rolled back to that card again.
// What is selected is the page's, not the sound's: it stays out of the script.
export function remember(code, sliding) {
  const [back, ahead] = ed.depth, was = depthWas, now = v?.state && { ...v.state, chosen: rk?.shown().id ?? null }
  if (sliding && back === was) return
  assign({ depthWas: back })
  const restore = s => { v.state = s; assign({ rechoose: s.chosen ?? null }) }
  // undone, an edit drawn ahead of its output is not coming: the picture goes back to the output there is
  if (back < was) { v.expect(null); if (steps[was]) steps[was].after = now; if (steps[back + 1]?.before) restore(steps[back + 1].before) }
  else if (back > was && steps[back]?.code === code && steps[back].after) restore(steps[back].after)
  if (steps[back]?.code !== code) steps[back] = { code, label: back ? said(steps[back - 1]?.code ?? '', code) : 'The script as it opened', before: back > was ? now : steps[back]?.before }
  steps.length = back + ahead + 1
}
export function undoList() {
  const [back] = ed.depth
  return steps.map((s, index) => ({ index, label: s?.label ?? '', current: index === back, ahead: index > back })).reverse()
}
export function goTo(index) {
  const [back] = ed.depth
  for (let i = back; i > index; i--) ed.undo()
  for (let i = back; i < index; i++) ed.redo()
}
// A step in a few words: the sound opened, a call added, removed or set again
const verbs = { remove: 'Delete', cut: 'Cut', copy: 'Copy', paste: 'Paste', move: 'Move', crop: 'Crop', gain: 'Level', spectral: 'Band level', repair: 'Rebuild', stretch: 'Stretch', pitch: 'Pitch', warp: 'Move a cue', fade: 'Fade', insert: 'Silence' }
function said(before, after) {
  // a track made or taken away, by its name; several, a split undone, by theirs
  const named = code => tracksOf(code).map(t => t.name), had = named(before), has = named(after)
  const made = has.length > had.length && has.findLast(t => !declared(before).has(t)), gone = has.length < had.length ? had.filter(t => !declared(after).has(t)) : []
  if (made) return `New track ${made}`
  if (gone.length) return `Delete track${gone.length > 1 ? 's' : ''} ${gone.join(', ')}`
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
  // a step bypassed, set anew
  const off = offCalls(before), on = offCalls(after), j = on.findIndex((o, j) => o.text !== off[j]?.text)
  if (i === was.length && i === now.length && off.length === on.length && j >= 0 && on[j].name === off[j].name) return `${on[j].name}, bypassed: ${brief(text(before, off[j]))} → ${brief(text(after, on[j]))}`
  return 'Edit the script'
}
function named(code, k) {
  const range = k.args.find(a => a.kind === 'object')?.props, at = range?.find(p => p.name === 'at')?.value, d = range?.find(p => p.name === 'duration')?.value
  const where = typeof at === 'number' && typeof d === 'number' ? ` ${at.toFixed(2)}–${(at + d).toFixed(2)}s` : ''
  return verbs[k.name] ? verbs[k.name] + where : `.${k.name}(${brief(code.slice(k.list.from + 1, k.list.to - 1).replace(/\s+/g, ' ').trim())})`
}
// Edits made on the picture become calls at the end of the output chain, their times to the view's precision. A band
// selection edits only its frequencies.
export function editSelection(type, range = v.selection, data = null) {
  if (type === 'undo' || type === 'redo') return ed[type]()
  // an edit still being made: this one once it is, on what was selected as it was asked (a level stepped thrice, each
  // on the last)
  if (state.frozen && !spreading) { queued.push(() => editSelection(type, range, data)); return true }
  if (type === 'mark') return addMarker()
  if (type === 'track') return toTrackOf(Array.isArray(range?.[0]) ? range[0] : range)
  if (type === 'voice') return voiceOut()
  if (type === 'stems') return stemsOut()
  // a paste at each caret, from the last back so each time holds for the ones before it
  if (type === 'paste') {
    if (v.ghost) return pasteNew(v.cursor)
    const at = (Array.isArray(range?.[0]) ? range.map(r => r[0]) : v.carets.length ? v.carets : [v.cursor]).sort((p, q) => q - p)
    return data ? !!pasting(at, data) : paste(at)
  }
  // a selection through every track: the same edit of each (spread)
  if (v.across && !spreading) return spread(() => editSelection(type, range))
  // an op that learns from the selection takes it whole, every range; declick looks for its clicks in each range or box
  if (ops[type]?.params?.some(s => s.selection)) return addOp(type)
  if (type === 'declick') return !!addOp(type, false)
  if (v.boxes.length > 1) return editBoxes(type, v.boxes)
  const all = Array.isArray(range?.[0]) ? range : !v.band && v.ranges.length > 1 ? v.ranges : null
  if (all?.length > 1) return editRanges(type, all)
  if (all) range = all[0]
  if (!range) return
  if (type === 'quieter' || type === 'louder') return v.band ? bandLevel(type === 'louder' ? 1 : -1, range) : level(type === 'louder' ? 3 : -3, range)
  const [a, b] = range, s = t => number(t, v.unit), span = `{ at: ${s(a)}, d: ${s(b - a)} }`, band = v.band
  // the clipboard holds the sound as it is before the cut
  if (!band && (type === 'copy' || type === 'cut')) clip(range)
  const hz = band && `[${band.map(f => Math.round(f)).join(', ')}]`
  const call = band ? { remove: `spectral(${hz}, ${span})`, repair: `repair(${hz}, ${span})` }[type]
    : type === 'remove' || type === 'cut' ? `${type}({ at: ${s(a)}, d: ${s(b - a)}${splice()} })` : `${type}(${span})`
  if (!call || !write(call)) return false
  // a rebuild is a method written here, not by addOp: one of the recent ones as well
  if (type === 'repair') used(type)
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
// The chain's last edit, before a closing save() or play(), when it is `name`: of its own steps, never one of a sound it
// copies, which other tracks share (code.js chain parts)
export function lastEdit(code, name) {
  const call = ownCalls(code).filter(k => !methods[k.name]?.sink).at(-1)
  return call?.name === name ? { call, before: call.prev } : null
}
// The steps of the chain's own statement
function ownCalls(code) { const c = chain(code); return c ? c.calls.filter(k => k.part === c.parts.length - 1) : [] }
// The edit to set again in place, when it is `name`: the script's last; while the output shows the chain up to a card
// chosen in the edits, that card's step, an edit of another kind then going in right after it (write())
export function amend(name) {
  const at = rk.at()
  if (!at) return lastEdit(ed.code, name)
  const c = chain(ed.code), calls = c?.calls ?? [], i = calls.findIndex(k => k.list && k.list.from === at.call?.list?.from)
  return i >= 0 && calls[i].name === name ? { call: calls[i], before: calls[i].prev } : null
}
const pair = ([s, d]) => `[${number(s)}, ${number(d)}]`
const markersOf = last => Array.isArray(last?.call.args[0]?.value) ? last.call.args[0].value.map(p => [...p]) : []
// Cues: those found in the output, the last warp()'s markers standing in for those they placed, so a cue dragged again
// is the marker it made, not one found near it. A cue at the very start is the start, which warp() holds.
export function cuesOf(found, code) {
  const placed = markersOf(lastEdit(code, 'warp')).map(p => p[1])
  return [...found.filter(c => c.t > 0 && !placed.some(d => Math.abs(d - c.t) < .03)), ...placed.map(t => ({ t, rank: Infinity }))].sort((a, b) => a.t - b.t)
}
// A cue dragged from `from` to `to` between its neighbours: one warp() call, updated as cues keep moving. Its markers
// are in the timeline before it; times on the page are after it, so they go back through its map first.
export function warp({ from, to, prev, next }) {
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
export function carry({ at, duration, to, copy, into }) {
  const s = t => number(t, v.unit)
  if (into != null) return carryInto({ at, duration, to, copy, into })
  return write(copy ? `copy({ at: ${s(at)}, d: ${s(duration)} }).paste(${s(to)}${seam()})` : `move({ at: ${s(at)}, d: ${s(duration)}, to: ${s(to)}${splice()} })`)
}
// ... dragged into another track's lane (`into`, its index): written over what is there in that track where it lands
// (write(), as move() lands it in its own), silence where it was (gain −∞ dB over it, as Move to a new track leaves),
// or with Alt left there too. The piece is this track's sound as it stands, written out (code.js soundOf: its name read
// would take it away as a track), cropped to it. One step, the track it went to the one edited
// Into a new track (`into` 'new', dropped under the last), one made for it first, empty: the sound shown its first
// track, where it had none
function carryInto({ at, duration, to, copy, into }) {
  const under = tracksOf(ed.code).at(-1)?.name, made = into === 'new' && !mastering() && addTrack(ed.code, 'audio.from(0)', 'track', { last: true })
  if (into === 'new' && !made) return false
  let code = made ? made.code : ed.code
  const from = state.track ?? (made && tracksOf(code)[0]?.name), name = made ? made.name : laneName(into), sound = from && soundOf(code, from), s = t => number(t, v.unit)
  if (!sound || !name || name === from || mastering() || masterOf(code)?.name === name) return false
  try {
    focus(name)
    const put = append(code, `write(${sound}.crop({ at: ${s(at)}, d: ${s(duration)} }), { at: ${s(to)} })`)
    if (!put) return false
    code = applied(code, put)
    if (!copy) {
      focus(from)
      const out = append(code, `gain(-Infinity, { at: ${s(at)}, d: ${s(duration)} })`)
      if (!out) return false
      code = applied(code, out)
    }
  } finally { focus(from) }
  ed.change(between(ed.code, code))
  if (made) { anew(name, under); state.track = name; focus(name) }
  else focusOn(name)
  return true
}
// A selection's audio dragged up onto the tabs: a tab of its own, its script this one's cropped to it, so its sound is
// the same (the chain as shown, rolled back or not); moved, it leaves this one, the rest closing up as a cut's, one step
export function toTab({ at, duration, copy }) {
  const s = t => number(t, v.unit), cut = rk.ahead(), whole = cut ? applied(ed.code, cut) : ed.code
  // with tracks, the edited one's chain alone
  const c = state.track && chain(whole), code = c ? inline(whole, c) : whole
  const change = append(code, `crop({ at: ${s(at)}, d: ${s(duration)} })`)
  if (!change || !copy && !write(`remove({ at: ${s(at)}, d: ${s(duration)}${splice()} })`)) return false
  newTab(applied(code, change))
  v.expect(null)
  return true
}
// A tool added: its call at the end of the chain, on the selection (each range) if there is one; its card is the one
// chosen among the edits, open, its sliders in hand (the panel turns to them from the palette and the menus, not from
// the context menu, which edits in place), and the code's caret goes into it. `args`, written as given, in place of the
// defaults (an embedding page's quick edits).
export function addOp(name, open = true, args) {
  // a selection through every track: each track's alike, no card opened (spread)
  if (v.across && !spreading) return spread(() => addOp(name, false))
  const op = ops[name], learn = op?.params?.find(s => s.selection), several = v.boxes.length > 1 ? v.boxes : v.ranges.length > 1 && !v.band ? v.ranges : null
  const span = ([a, b]) => `{ at: ${number(a, v.unit)}, d: ${number(b - a, v.unit)} }`
  const call = args => /^[\w$]+$/.test(name) ? `${name}(${args})` : `['${name}'](${args})`
  const add = text => {
    const change = write(text)
    if (!change) return
    used(name)
    // the last call it wrote, where its "(" is
    const end = change.from + change.insert.length, at = chain(ed.code)?.calls.findLast(k => k.list.from >= change.from && k.list.from < end)?.list.from
    if (at == null) return change
    ed.select(at + 1)
    if (open && state.side !== 'edits') { state.side = 'edits'; store() }
    if (state.side === 'edits') rk.choose(at)
    return change
  }
  // what it learns from is what is selected (denoise: where the noise plays alone), every range of it; it acts on all;
  // a box on the spectrogram, its time where the noise plays alone, its band where it goes (each box its own call)
  if (learn) {
    const boxes = !v.band ? [] : v.boxes.length > 1 ? v.boxes : [[...v.selection, ...v.band]]
    if (boxes.length && name === 'denoise') return add(boxes.map(([a, b, lo, hi]) => call(`{ ${learn.name}: ${span([a, b])}, band: [${Math.round(lo)}, ${Math.round(hi)}] }`)).join('.'))
    const list = v.band ? [] : several ? [...several].sort((p, q) => p[0] - q[0]) : v.selection ? [v.selection] : []
    if (!list.length) return note(`Select ${learn.selection} first.`)
    return add(call(`{ ${learn.name}: ${list.length > 1 ? `[${list.map(span).join(', ')}]` : span(list[0])} }`))
  }
  // several ranges, or boxes (each its time): the method on each, from the last back, in one step
  const needs = args != null ? [args] : (op.params || []).slice(0, (op.params || []).findLastIndex(s => s.required) + 1).map(s => typeof s.default === 'string' ? quote(s.default) : String(s.default))
  if (several) return add([...several].sort((p, q) => q[0] - p[0]).map(r => call([...needs, span(r)].join(', '))).join('.'))
  // a selection of all of it is no range at all; what the library can't do without is written, set to its default
  const sel = v.selection && (v.selection[0] > v.unit / 2 || v.selection[1] < v.duration - v.unit / 2) ? v.selection : null
  return add(call([...needs, sel ? span(sel) : op.range ? `{ at: 0, d: ${number(v.duration)} }` : ''].filter(Boolean).join(', ')))
}
// A call at the end of the chain, as one step. The output showing the chain up to a card chosen in the edits, it goes in
// right after that card, the steps after it kept, as a new layer goes over the one selected, and its own card is chosen
// then: the output shows up to it
export function write(...calls) {
  // no call, no change: an empty one would leave a dot
  calls = calls.filter(Boolean)
  if (!calls.length) return null
  const at = rk.at()
  let code = ed.code, change = null, after = at?.after
  for (const call of calls) {
    // a recording where another went in is one more take of that place (code.js retake)
    change = retake(code, call, lengthOf) ?? append(code, call, after)
    if (!change) { note('Open or generate a sound first.'); return null }
    code = applied(code, change)
    if (after != null) after = change.from + change.insert.length
  }
  // its card chosen once the edits have it (oncaret)
  if (at) assign({ rechoose: chain(code)?.calls.findLast(k => k.dot < after && k.list)?.list.from ?? null })
  ed.change(calls.length > 1 ? between(ed.code, code) : change)
  return change
}
export const applied = (code, { from, to = from, insert = '' }) => code.slice(0, from) + insert + code.slice(to)
// a change as the editor takes it, one or several over the same text, made to `code`
export const changed = (code, c) => (Array.isArray(c) ? c : [c]).filter(Boolean).sort((p, q) => q.from - p.from).reduce(applied, code)
// A selection through every track (view.js across): an edit of it is the same edit of each track, each in turn the one
// edited, what each makes gathered into one change, one step of the history, so a cut keeps them in time; the track
// edited before, edited after. Each edit reads and writes the script as the ones before it left it, `ed` standing in for
// the editor meanwhile, and `rk` for the edits, no card of one track's chosen for another's
export let spreading = false
export function spread(edit) {
  const names = tracksOf(ed.code).map(t => t.name)
  if (spreading || !v.across || names.length < 2 || mastering()) return edit()
  const real = ed, edits = rk, was = state.track
  let code = real.code, done = false
  assign({ ed: Object.create(real, { code: { get: () => code }, change: { value: c => { code = changed(code, c) } }, select: { value: () => {} } }) })
  assign({ rk: Object.create(edits, { at: { value: () => null }, choose: { value: () => {} } }) })
  spreading = true
  // (a locked track's left as it is)
  try { for (const name of names.filter(n => !state.locked.includes(n))) { focus(name); done = !!edit() || done } }
  finally { spreading = false; assign({ ed: real, rk: edits }); focus(was) }
  if (code !== real.code) real.change(between(real.code, code))
  return done
}
// The chain up to a step made one sound (`to`, where that step ends; all of it with none): rendered as it shows there
// (worker.js bake, from the renders kept), kept in this browser as a recording is, and the script opening it in place
// of the sound and the steps it holds, its markers marked on it again, the steps after it going on from it. One step of
// the history; the sound made stays kept, as a take does
export async function flatten(to = null) {
  const code = ed.code, c = chain(code)
  if (!c) return
  // the part of the chain it ends in: its own statement, or a sound it copies, flattened for every track sharing it
  const own = c.parts.at(-1), p = to == null ? own : c.parts.findLast(p => to >= p.expr.from && to <= p.expr.to) ?? own
  const end = to ?? own.calls.filter(k => !methods[k.name]?.sink).at(-1)?.to ?? own.head
  // named for the sound it starts from, flattened before or not: chime-flat.wav, chime-flat-2.wav
  const base = (source(code)?.strings[0]?.name ?? 'audio').replace(/^.*\//, '').replace(/\.\w+$/, '').replace(/-flat(-\d+)?$/, ''), name = unique(`${base}-flat.wav`, taken())
  note('Flattening…')
  // that part's sound alone, with tracks or not
  const r = await eng.bake(prepare(code.slice(0, end) + (p.name ? `\n${p.name}` : '')))
  if (r.error) return note(`Not flattened: ${r.error.message}`, 'error')
  if (ed.code !== code) return note('Not flattened: the script changed meanwhile')
  const data = { channels: r.channels, sampleRate: r.sampleRate }
  await eng.file(name, data)
  saving(keep(name, data).then(file => { if (file) shelf.set(name, file); else note(`${name} could not be kept in this browser: export it to keep it.`, 'error') }))
  // its marks, on lines of their own where the chain's calls are
  const at = p.calls.find(k => /\n[ \t]*$/.test(code.slice(0, k.dot))), sep = at ? `\n${code.slice(0, at.dot).match(/\n([ \t]*)$/)[1]}` : ''
  const said = label => label ? `, ${quote(label)}` : ''
  const marks = [...r.markers.map(m => `.mark(${number(m.time)}${said(m.label)})`), ...r.regions.map(g => `.mark({ at: ${number(g.at)}, d: ${number(g.duration)} }${said(g.label)})`)]
  ed.change({ from: p.expr.from, to: end, insert: `audio(${quote(name)})${marks.map(m => sep + m).join('')}` })
  note(`Flattened into ${name}`)
}
