import { source, chain, number, between, tracks as tracksOf, focus, toTrack, voiceTrack, stemTracks, soundOf, addTrack, dropTrack, renameTrack, master as masterOf, addMaster } from '../code.js'
import opIcons from '../icons.js'
import { root, icons, glyphs, displays } from './config.js'
import { state, eng, v, ed, rk, pl, output, assign } from './context.js'
import { write } from './edits.js'
import { label, note } from './format.js'
import { setKind, trackKinds, shows } from './look.js'
import { bar, openDropdown } from './menus.js'
import { store } from './persist.js'
import { marks, describe } from './readouts.js'
import { startRecording } from './recording.js'
import { schedule } from './run.js'
import { docs, docOf, newTab, closeTab } from './tabs.js'
import { envelopeShown, shiftOf } from './writers.js'

// Tracks: their lanes and layers, the one edited, mute, solo and lock, a track made, named, moved, split out (a voice,
// stems), lined up, matched, ducked, mastered, taken away or to a tab

// A track's layer right-clicked: the track's own, named anew, heard alone, locked, shown as a waveform, a spectrogram
// or its notes, taken away (the others are a press away: a marker, an edit, on its lane)
export const trackMenu = i => [
  { label: 'Rename…', hint: state.track ?? '', run: () => renameLayer(laneName(i)), icon: glyphs.marker },
  { label: 'Solo', run: () => toggleMute(i, true), icon: icons.track },
  { label: 'Lock', checked: state.locked.includes(laneName(i)), run: () => toggleLock(laneName(i)) },
  '-',
  ...displays.map(d => ({ label: d.label, checked: shows(state.track) === d.name, run: () => setKind(state.track, d.name) })),
  '-',
  { label: 'Delete the track', hint: state.track ?? '', run: untrack, icon: opIcons.remove }
]
// The tracks' layers, each on its band's head line over its lane (view.js onlayout): its look (how it shows, the
// dropdown by it), its name (clicked, named anew), its mute (with Alt, solo) and its lock; pressed, the one edited, as
// a press in its lane makes it; right-clicked, its menu
export function layerPress(l, event) {
  if (event.detail > 1 || l.locked) return
  focusOn(l.name)
  v.focus = l.i
}
// its name clicked: in hand to write anew at once, as a field's text is, the track the one edited (a locked one stays
// as it is): another's, once its layers are laid out as that one's, so the field drawn is the one written in
export function layerName(l, event) {
  event.stopPropagation()
  if (l.locked || l.name === state.track) return renameLayer(l.name)
  layerPress(l, event)
  requestAnimationFrame(() => requestAnimationFrame(() => renameLayer(l.name)))
}
export function layerLook(l, event) { state.dropLane = l.band; openDropdown(event.currentTarget) }
export function layerMenu(l, event) {
  event.preventDefault()
  if (!l.locked) { focusOn(l.name); v.focus = l.i }
  bar.at(trackMenu(l.i), event.clientX, event.clientY)
}
// A track locked, or let go: no press in its lane takes it, as a locked layer on Figma's canvas, so it is never the one
// edited; locked while it is, the next it has not locked is (the one before, at the last); every one locked, it stays
export function toggleLock(name) {
  if (!name) return
  state.locked = state.locked.includes(name) ? state.locked.filter(n => n !== name) : [...state.locked, name]
  const names = tracksOf(ed.code).map(t => t.name), at = names.indexOf(name), free = n => !state.locked.includes(n)
  const next = [...names.slice(at + 1), ...names.slice(0, at).reverse()].find(free)
  if (name === state.track && !free(name) && next) { focusOn(next); v.focus = names.indexOf(next) }
  showTracks(output?.tracks ? lanesShown(output) : v.tracks?.map(t => ({ ...t, locked: state.locked.includes(t.name) })) ?? null)
  store()
}
// A layer's name written anew where it stands (Rename in its menu, its name clicked): Enter or a press elsewhere names
// the track (renameTrackTo), Esc leaves it
export function renameLayer(name) {
  if (!name) return
  state.renaming = name
  fieldFocus('.layer-field')
}
// A name's field, as it shows in place of the name: focused, its text selected, now and once it is drawn
export function fieldFocus(selector) {
  const field = () => { const el = root.querySelector(selector); if (el && document.activeElement !== el) { el.focus(); el.select() } }
  field()
  requestAnimationFrame(field)
}
// a name's field as wide as what is written in it, a character more for the caret (a monospace font's)
export function fitField(el) { el.style.width = `${Math.max(2, el.value.length) + 1}ch` }
export function renamed(event, l) {
  const input = event.currentTarget, to = input.value.trim()
  if (event.type === 'keydown' && event.key !== 'Enter' && event.key !== 'Escape') return
  event.stopPropagation()
  if (state.renaming !== l.name) return
  state.renaming = null
  if (event.key !== 'Escape' && to && to !== l.name) renameTrackTo({ from: l.name, to })
}
// The title a new track would have, under the last (index.html .layer-new): pressed, the track made, empty, its name in
// hand to write, as a layer named as it is made
export function nameNewTrack() { if (newTrack()) renameLayer(tracksOf(ed.code).at(-1)?.name) }
// Under the tracks, a track to make: empty, or recorded as the others play
export const roomMenu = () => [{ label: 'New track', run: newTrack, icon: icons.track }, { label: 'Record a new track', hint: 'The others playing', keys: '⇧R', run: () => startRecording(true), disabled: !!state.recording }]
// The tracks as their lanes show them, each muted or not, locked or not; none muted with a master, which mixes them as
// its script says
export const lanesShown = out => out?.tracks?.map(t => ({ name: t.name, end: t.length / out.sampleRate, muted: masterOf(ed.code) ? null : state.muted.includes(t.name), locked: state.locked.includes(t.name) })) ?? null
// The tracks the lanes show, the layers a row each with them
export function showTracks(list) {
  v.tracks = list
  state.trackRows = list
}
// A track muted, or heard again (its lane's index), or with Alt soloed: heard so at once, its lane saying so at once, the
// mix made again without it, or with it, unseen (perform, quiet)
export function toggleMute(i, solo = false) {
  const name = output?.tracks?.[i]?.name, names = output?.tracks?.map(t => t.name) ?? []
  // a lane laid out before the mix with it came (relane): heard as the mix it plays has it, nothing to mute there yet
  if (!name || name !== laneName(i) || masterOf(ed.code)) return
  // with Alt, solo: the others muted, it heard; pressed so again, every one heard
  const others = names.filter(n => n !== name), alone = others.every(n => state.muted.includes(n)) && !state.muted.includes(name)
  state.muted = solo ? alone ? [] : others : state.muted.includes(name) ? state.muted.filter(n => n !== name) : [...state.muted, name]
  showTracks(lanesShown(output))
  // heard at once: the tracks' sum made as it plays, those muted left out (worker.js voice), taking over where it plays;
  // the mix made again without them comes after, for the levels and the export, and takes over in its turn
  const out = output, muted = [...state.muted]
  pl.out = null
  pl.set(out.channels, out.sampleRate, o => eng.voice({ ...o, output: out.id, muted }), out.length, fetches(out), lanesOf(out))
  store()
  assign({ hush: true })
  schedule(0)
}
// The track edited (code.js focus), by its name: its chain is the one the edits show, the picture's handles draw on and
// every edit goes to. One the script no longer has gives way to its last track; none without tracks
export function focusOn(name) {
  name = trackOf(name)
  if (name === state.track) return focus(name)
  state.track = name
  focus(name)
  // its lane as the view lays them out: a track just made, named or taken away is laid out before the output with it
  // comes (relane)
  const i = v.tracks?.findIndex(t => t.name === name) ?? -1
  if (i >= 0) v.focus = i
  rk?.refresh()
  v.envelope = envelopeShown()
  v.shift = shiftOf(ed.code)
  if (output) v.segments = lane(output)?.silences ? { silences: lane(output).silences } : output.segments
  // its cues not yet found: a double-click goes by its pauses till they are
  v.cues = null
  marks()
  describe()
}
// Track `name` where the script has it (or its master), else its last track; null without tracks
export function trackOf(name) {
  const list = [...tracksOf(ed.code).map(t => t.name), ...masterOf(ed.code) ? [masterOf(ed.code).name] : []]
  return list.includes(name) ? name : list.at(-1) ?? null
}
// The track lane `i` is, by its name, as the view lays it out: a track just made or taken away is laid out before the
// output with it comes (relane), which has the tracks as they were
export function laneName(i) { return v.tracks?.[i]?.name }
// The output's track edited ({ name, length, silences }), or null; its index, or none, without tracks
export function lane(out = output) { return out?.tracks?.find(t => t.name === state.track) ?? null }
export function laneIndex(out = output) { const i = out?.tracks?.findIndex(t => t.name === state.track) ?? -1; return i < 0 ? undefined : i }
// What opens an output to play (player.js set): the engine's, rendered there as it plays; and a long one's samples near
// where it is heard, the engine's
// what plays of an output: in the deck, of the samples the page holds; a long one's, made by the engine
export const hears = out => o => eng.voice({ ...o, output: out.id, ...out.channels && { held: { key: out.id, channels: out.channels, sampleRate: out.sampleRate } } })
export const fetches = out => out?.long ? (from, to) => eng.samples(out.id, from, to, true) : null
// its tracks' lanes, for a scrub to hear one alone: the page's, or a long one's, the engine's
export const lanesOf = out => out?.lanes ?? (out?.long && out.tracks ? (from, to) => eng.samples(out.id, from, to) : null)
// The selection's audio to a track of its own, under this one, where it was in time; silence where it was, so the two
// sound as the one did, each then edited alone (code.js toTrack), the new one the track edited, its piece selected. One
// step. Tracks, a lane each, play together; export mixes them
export function toTrackOf(range = v.selection) {
  if (!range || v.band || v.ranges.length > 1) return false
  const s = t => number(t, v.unit), made = toTrack(ed.code, { at: s(range[0]), d: s(range[1] - range[0]) })
  if (!made) return note('This sound is made from another by its name: give it a track of its own in the code.'), false
  if (rk.shown().id != null) rk.choose(null)
  return retrack(made)
}
// A new track, empty (no length), under the last, the one edited then: what is recorded, pasted or dropped there goes
// in it, as on any. The sound shown its first track, where it has none
export function newTrack() {
  const under = tracksOf(ed.code).at(-1)?.name, made = chain(ed.code) && addTrack(ed.code, 'audio.from(0)', 'track', { last: true })
  if (!made) return note('This sound is made from another by its name: add a track to it in the code.'), false
  if (rk.shown().id != null) rk.choose(null)
  v.ghost = false
  anew(made.name, under)
  retrack(made)
  relane()
  return true
}
// a track as it is made: one made anew, or taken away, keeps nothing a track of its name had, its height, its mute, its
// lock nor what it shows; one made under the last (`under`, its name) as tall as that one, as the room under the lanes
// drew its lane (view.js roomLane)
export function anew(name, under = null) {
  const d = docOf(state.tab), h = under == null ? null : d?.heights?.[under] ?? null
  if (state.muted.includes(name)) state.muted = state.muted.filter(n => n !== name)
  if (state.locked.includes(name)) state.locked = state.locked.filter(n => n !== name)
  if (d && (d.heights?.[name] ?? null) !== h) {
    const { [name]: _, ...rest } = d.heights ?? {}
    d.heights = h == null ? rest : { ...rest, [name]: h }
    v.heights = d.heights
  }
  if (d?.kinds?.[name] != null) {
    const { [name]: _, ...rest } = d.kinds
    trackKinds(d, rest)
  }
  store()
}
// Tracks made or taken away drawn so at once, as the script now has them, before its output comes (the mix made again
// behind it): each track's lane as the output shows it, a new one silent; a sound with no tracks before, its channels
// one lane. Not with a master, nor for a sound longer than the page holds, whose lanes it has not
export function relane() {
  const out = output, names = tracksOf(ed.code).map(t => t.name)
  if (!out?.duration || out.long || masterOf(ed.code)) return
  // one left, the sound alone: its lane, till its channels come
  if (!names.length) { const i = out.tracks?.findIndex(t => t.name === state.track) ?? -1; if (i >= 0) { showTracks(null); v.set([out.lanes[i]], out.sampleRate) } return }
  const lanes = out.lanes ?? [out.channels.reduce((m, c) => { for (let i = 0; i < m.length; i++) m[i] += c[i] / out.channels.length; return m }, new Float32Array(out.length))]
  const by = new Map((out.tracks ?? [{ name: names[0], length: out.length }]).map((t, i) => [t.name, { lane: lanes[i], end: t.length / out.sampleRate }]))
  const silent = new Float32Array(out.length)
  showTracks(names.map(n => ({ name: n, end: by.get(n)?.end ?? 0, muted: state.muted.includes(n), locked: state.locked.includes(n) })))
  v.set(names.map(n => by.get(n)?.lane ?? silent), out.sampleRate)
  v.focus = Math.max(0, names.indexOf(state.track))
}
// A track named anew (its layer's name double-clicked, or Rename in its menu): its sound's name in the script (code.js
// renameTrack, a script's name made of the words), its height, its mute, its lock, what it shows and its being edited
// going with it
export function renameTrackTo({ from, to }) {
  const made = renameTrack(ed.code, from, to), d = docOf(state.tab)
  if (!made) return false
  if (d?.heights?.[from] != null) { const { [from]: h, ...rest } = d.heights; d.heights = { ...rest, [made.name]: h }; v.heights = d.heights }
  if (d?.kinds?.[from] != null) { const { [from]: k, ...rest } = d.kinds; trackKinds(d, { ...rest, [made.name]: k }) }
  state.muted = state.muted.map(n => n === from ? made.name : n)
  state.locked = state.locked.map(n => n === from ? made.name : n)
  if (state.track === from) { state.track = made.name; focus(made.name) }
  ed.change(between(ed.code, made.code))
  return true
}
// The voice to a track of its own under this one, by a separation model, the rest left here, so the two sound as the one
// did (code.js voiceTrack); the new one the track edited, for its own repairs. One step; the model runs once for both
export function voiceOut() {
  const made = voiceTrack(ed.code, gpu ? 'mel-roformer' : 'scnet-large')
  if (!made) return note('This sound is made from another by its name: give it a track of its own in the code.'), false
  if (rk.shown().id != null) rk.choose(null)
  return retrack(made)
}
// A song's voice, bass and drums each to a track of its own under this one, the rest left here, so the four sound as the
// one did (code.js stemTracks), by SCNet-large, the voice the track edited. One step; the model runs once for all four
export function stemsOut() {
  const made = stemTracks(ed.code)
  if (!made) return note('This sound is made from another by its name: give it a track of its own in the code.'), false
  if (rk.shown().id != null) rk.choose(null)
  return retrack(made)
}
// Whether this browser has a GPU for WebGPU, not a fallback (SwiftShader): the voice split's model is Mel-RoFormer there
// (a 464 MB download once, a few seconds a song's minute), SCNet-large elsewhere (45 MB, on the CPU, as fast as it gets)
let gpu = false
// The tracks other than the one edited, by name: what it may line up with, match, duck under; none for the master
export function others() { return state.track && !mastering() ? tracksOf(ed.code).map(t => t.name).filter(n => n !== state.track) : [] }
// Whether the one edited is the master (code.js master): the tracks' sum through steps of its own
export function mastering() { return !!state.track && masterOf(ed.code)?.name === state.track }
// The track edited lined up in time with track `name` (fn/align.js): a part remade elsewhere and opened as a new track,
// put where the original stood. Its reference that track's sound written out (code.js soundOf), not its name: one step
export function lineUp(name) {
  const ref = soundOf(ed.code, name)
  return !!ref && !!write(`align(${ref})`)
}
// The track edited matched to track `name`: its tone (match EQ), then its loudness (normalize to it), as a part remade
// takes the place of the one it stands in for. One step
export function matchUp(name) {
  const ref = soundOf(ed.code, name)
  return !!ref && !!write(`match(${ref})`, `normalize(${ref})`)
}
// The track edited ducked under track `name` while that one sounds (a sidechain, fn ducker's `key`): a voice over a music
// bed, the bed 15 dB down under it. Its key read by name: that track stays a track, heard (code.js tracks)
export function duckUnder(name) { return !!write(`ducker({ key: ${name}, range: -15 })`) }
// A master after the tracks: the longest a copy, each other mixed into it (code.js addMaster), the one edited then, for
// steps over their sum (loudness, a limiter, a bus compressor). One step
export function masterOut() {
  const lens = new Map(output?.tracks?.map(t => [t.name, t.length]) ?? []), names = tracksOf(ed.code).map(t => t.name)
  const made = addMaster(ed.code, names.reduce((p, q) => (lens.get(q) ?? 0) > (lens.get(p) ?? 0) ? q : p))
  if (!made) return false
  if (rk.shown().id != null) rk.choose(null)
  return retrack(made)
}
// The script with a track made, `made` ({ code, name }), that track the one edited from now on
export function retrack(made) {
  state.track = made.name
  focus(made.name)
  ed.change(between(ed.code, made.code))
  return true
}
// The track edited taken away, its steps with it; the one before it edited then, or with one left, the sound
export function untrack() {
  const change = state.track && dropTrack(ed.code, state.track)
  if (!change) return false
  anew(state.track)
  const list = tracksOf(ed.code).map(t => t.name), i = list.indexOf(state.track)
  state.track = list[i - 1] ?? list[i + 1]
  focus(state.track)
  v.select(0, 0)
  ed.change(change)
  relane()
  return true
}
// A track and a tab are one sound each, the one heard with the others, the other alone: either becomes the other.
// The track edited to a tab of its own, its steps with it (code.js soundOf), gone from here; one made from another
// sound here (a copy of it) stays, as it means nothing alone
export function detach() {
  const name = state.track, sound = name && soundOf(ed.code, name)
  if (!sound) return false
  const others = [...ed.code.matchAll(/\blet\s+([\w$]+)/g)].map(m => m[1]).filter(n => n !== name)
  if (others.some(n => new RegExp(`(^|[^\\w$.'"])${n.replace(/\$/g, '\\$')}\\b`).test(sound))) return note(`${name} is made from another sound here: it can't go to a tab alone.`)
  if (!untrack()) return false
  newTab(sound)
  return true
}
// Tab `id`'s sound a track of the one shown, under the one edited, the tab closed (reopened as any is): a script that is
// one sound, its chain; one of statements (tracks of its own, a measure) stays a tab
export function attach(id) {
  const d = docs.find(d => d.id === id), code = d?.code ?? '', c = chain(code), sound = c && code.slice(c.expr.from, c.expr.to)
  if (!sound || code.trim() !== sound.trim()) return note('That tab is more than one sound: it stays a tab.')
  const made = chain(ed.code) && addTrack(ed.code, sound, label(source(code)?.strings[0]?.name ?? 'track'))
  if (!made) return note('This sound is made from another by its name: add a track to it in the code.')
  retrack(made)
  closeTab(id)
  return true
}

export function wire() {
  navigator.gpu?.requestAdapter().then(a => { gpu = !!a && !a.info?.isFallbackAdapter && a.info?.architecture !== 'swiftshader' }, () => {})
}
