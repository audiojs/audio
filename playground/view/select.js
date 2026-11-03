import { ownMarks } from '../view.js'
import { ghost, unghost, rowH, plot, spare, bandOf, lanes, inRoom, refocus } from './geometry.js'
import { origin, current, before } from './gestures.js'
import { EDGE, NOTCH, mac, root, onselect, oncursor, onedit, oncontext, duration, hovered, segments, markers, more, start, end, fview, selection, band, cursor, playhead, cues, aview, tracks, focus, anchor, lift, zoomed, chosen, held, assign } from './model.js'
import { fitTo } from './overlay.js'
import { drag, grabbing, hover } from './pointer.js'
import { moved, invalidate } from './render.js'
import { steer } from './ruler.js'
import { x, time, clamp, unit, snap, seen, stuck, local, inside, uy, rowOf, yKey, ya, setRange, setFreqs, zoom, zoomFreqs, zoomKeys, setKeys, onFreqs, onKeys, onLevels, zoomLevels, scrollLevels, reveal } from './scales.js'
import { same, stripAt, rename } from './strips.js'

// The selection: put, extended, added to, stepped through by its cues and pauses; the wheel; the picture's keys;
// the paste at the carets

// What a double- or triple-click takes at t: within a pause, the pause; else, double, the fragment between the cues
// either side (a sound's start or end, a hit, a marker); triple, the sound between the pause before and the one after,
// its edges where the cues have them. With Alt, another range beside those there are (the carets its clicks left gone);
// with Shift, what was selected (or the caret) as the clicks began, out to take it in too (`before`).
export function around(kind, t = cursor, how = null) {
  const list = edges(kind)
  const [a, b] = pauses().find(([a, b]) => t >= a && t <= b) ?? [list.findLast(c => c <= t) ?? 0, list.find(c => c > t) ?? duration]
  if (how === 'add') { assign({ more: more.filter(r => !(r[0] === r[1] && r[0] >= a && r[0] <= b)) }); add(a, b) }
  else if (how === 'extend') { const [p, q] = before && performance.now() - before.at < 1000 ? before.range : selection ?? [cursor, cursor]; select(Math.min(p, a), Math.max(q, b), null, true) }
  else select(a, b)
}
// Where the caret steps, as a text's words and lines, and what the clicks take: the cues (found, the edited track's
// markers), the fragments' edges, those this zoom shows (seen; past the view, all), as snapping takes them, or till
// they are found, the pauses' edges they are found from; the pauses' edges, the sounds', a pause that ends where a cue
// is (the two found within 30 ms of each other) ending at the cue. An edit drawn ahead takes them where it moves them,
// as they are drawn.
function edges(kind) {
  const at = list => list.map(moved).filter(t => t != null), found = at(cues ?? []), onCue = t => found.find(c => Math.abs(c - t) < .03) ?? t
  const kept = new Set(seen()), shown = at((cues ?? []).filter((t, i) => kept.has(i) || x(t) < 0 || x(t) > plot().w))
  const all = [0, duration, ...tail(), ...at(ownMarks()), ...(kind === 'fragment' && cues ? shown : at(pauses().flat()).map(onCue))].filter(t => t >= 0 && t <= duration)
  return [...new Set(all.map(t => +t.toFixed(6)))].sort((a, b) => a - b)
}
// The edited track's end, where it ends before the mix does ([end], else none), and its pauses with the time past it
// one of them: its lane runs on silent to the mix's end, so a click there takes that, and one on its sound stops at it
const tail = () => { const e = tracks?.[focus]?.end; return e != null && e < duration - 1e-6 ? [e] : [] }
function pauses() {
  const [e] = tail(), list = segments.silences, last = list.at(-1)
  if (e == null) return list
  return last && last[1] >= e - 1e-3 ? [...list.slice(0, -1), [last[0], duration]] : [...list, [e, duration]]
}
// an edge within three pixels of the caret is where it is: a hit found a few ms after the pause it ends is one place
export function stepTo(kind, dir, extend = false) {
  const head = selection ? (selection[0] === origin() ? selection[1] : selection[0]) : cursor, near = Math.max(1e-4, unit() * 3)
  const list = edges(kind), to = dir > 0 ? list.find(t => t > head + near) ?? duration : list.findLast(t => t < head - near) ?? 0
  if (extend) { assign({ anchor: origin() }); select(anchor, to, null, false, to) }
  else setCursor(to)
  reveal(to)
}
// The wheel scrolls, as everywhere: up and down over zoomed-in frequencies (on the spectrogram, its frequencies or
// the spectrum beside them) or zoomed-in levels (on the waveform) moves through them, else through time. A pinch, or
// Ctrl or ⌘ and the wheel (a mouse without a pinch), zooms the axis under the pointer: the frequencies or the levels
// there, time elsewhere.
export function wheel(event) {
  if (!duration) return
  event.preventDefault()
  // the keys as the wheel has them held, its pinch's Ctrl aside: one let go or pressed while the page heard no key (a
  // gesture under way) shows as it is
  if (['metaKey', 'altKey', 'shiftKey'].some(k => !!held[k] !== event[k])) {
    assign({ held: { metaKey: event.metaKey, altKey: event.altKey, shiftKey: event.shiftKey, ctrlKey: !!held.ctrlKey } })
    if (hovered && !drag) hover(...hovered, held)
    invalidate(true)
  }
  const [px, py] = local(event), span = end - start, L = lanes(), freqs = onFreqs(px, py, L), rect = freqs || L.spec.find(r => inside(r, px, py))
  const lines = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 400 : 1, across = Math.abs(event.deltaX) > Math.abs(event.deltaY)
  // A zoom's factor. A trackpad's pinch comes as the wheel with Ctrl, though no key is held (Chrome's: −100·ln s of
  // deltaY all told for a spread s): the span goes by 1/s², twice as far as the fingers spread, so a few pinches go from
  // all of a sound to its samples; its events merged, as when the page lags behind, go as far as one by one. Ctrl or ⌘
  // held, the wheel a fifth as keen, a mouse's notch (100) half again, a trackpad's swipe as gently: at most
  // NOTCH a turn of it, however far it says it went
  const pinch = event.ctrlKey && !held.ctrlKey && !held.metaKey, z = event.deltaY * lines * (pinch ? .02 : .004)
  const factor = Math.exp(pinch ? z : Math.max(-NOTCH, Math.min(NOTCH, z)))
  const levels = onLevels(px, py, L), wave = levels || L.wave.find(r => inside(r, px, py))
  // the levels a quarter as keen: their span goes by a quarter of the octaves time's does
  const keys = onKeys(px, py, L), notes = keys || L.notes.find(r => inside(r, px, py))
  if (event.ctrlKey || event.metaKey) return freqs ? zoomFreqs(factor, uy(freqs, py)) : keys ? zoomKeys(keys, factor, yKey(keys, py)) : levels ? zoomLevels(factor ** .25, ya(levels, py), levels[3]) : zoom(factor, clamp(time(px)))
  if (rect && fview[1] - fview[0] < 1 && !across) {
    const du = event.deltaY * lines / rect[3] * (fview[1] - fview[0])
    return setFreqs(fview[0] - du, fview[1] - du)
  }
  // zoomed keys scroll up and down over their lane, as zoomed-in frequencies do
  if (notes && zoomed[bandOf(notes.i)] && !across) return setKeys(notes, notes.keys[0] - .5 - event.deltaY * lines / rowOf(notes))
  // zoomed-in levels scroll up and down over the waveform, as zoomed-in frequencies do over the spectrogram
  // more bands than the picture holds: up and down through them, as a DAW's tracks (zoomed-in levels then on their
  // axis alone); time by a swipe across, or Shift
  if (spare && !across && !event.shiftKey && py <= plot().h && !levels) { assign({ lift: Math.max(0, Math.min(spare, lift + event.deltaY * lines)) }); return invalidate() }
  if (wave && aview[1] - aview[0] < 2 && !across) return scrollLevels(aview[0] - event.deltaY * lines / wave[3] * (aview[1] - aview[0]))
  const delta = (across ? event.deltaX : event.deltaY) * lines
  steer()
  setRange(start + delta / plot().w * span, end + delta / plot().w * span, true)
}
// `head`: the end a drag, Shift or the keys moved, where the caret goes, as a text's (and a snapped end its line); else
// its start
export function select(a, b, f = null, keep = false, head = null) {
  assign({ chosen: null })
  assign({ selection: a === b ? null : [Math.min(a, b), Math.max(a, b)] })
  assign({ band: selection && f && f[1] > f[0] ? f : null })
  if (!keep) assign({ more: [] })
  // a range that overlaps others takes them in (boxes stay boxes, a band apart whenever they meet)
  if (selection && !band && more.length) {
    const ranges = more.filter(r => r.length === 2)
    for (const r of ranges.filter(r => r[0] <= selection[1] && r[1] >= selection[0])) assign({ selection: [Math.min(selection[0], r[0]), Math.max(selection[1], r[1])] })
    assign({ more: more.filter(r => r.length > 2 || r[1] < selection[0] || r[0] > selection[1]) })
  }
  if (selection) assign({ cursor: head ?? selection[0] })
  told()
  invalidate(true)
}
// nothing selected, nothing runs through every lane
export function told() {
  if (!selection && !more.some(r => r[1] > r[0])) assign({ allLanes: false })
  onselect(selection, band, ranges(), boxes())
}
// Every range selected, in time order; every caret, the one there is when nothing is selected and those beside it
export const ranges = () => band ? [selection] : [...selection ? [selection] : [], ...more.filter(r => r.length === 2 && r[1] > r[0])].sort((p, q) => p[0] - q[0])
export const carets = () => [...(selection ? [] : [cursor]), ...more.filter(r => r.length === 2 && r[0] === r[1]).map(([p]) => p)].sort((p, q) => p - q)
// every box selected on the spectrogram, [a, b, low, high] each, in time order
export const boxes = () => [...band ? [[...selection, ...band]] : [], ...more.filter(r => r.length === 4)].sort((p, q) => p[0] - q[0])
// Another caret, as a text editor's (Alt and a click), the one gestures act on now (Shift extends it), what there was
// beside it; one there already goes
export function addCaret(t) {
  const i = more.findIndex(r => r.length === 2 && r[0] === r[1] && Math.abs(x(r[0]) - x(t)) <= EDGE)
  if (i >= 0) more.splice(i, 1)
  else if (selection || Math.abs(x(cursor) - x(t)) > EDGE) { more.push(current()); assign({ band: null, selection: null }); assign({ cursor: clamp(t) }); oncursor(cursor) }
  told()
  invalidate(true)
}
// Another range beside those there are, which becomes the one gestures act on; the caret there was stays beside it
// only among several
function add(a, b) {
  if (selection && !band) more.push(selection)
  else if (!selection && more.length) more.push([cursor, cursor])
  select(a, b, null, true)
}
// The next range like the selection after the last one: a pause if it is one; a stretch between cues if it is one;
// else a sound between pauses
export function addNext() {
  if (!selection || band) return
  const [a, b] = selection, last = Math.max(...ranges().map(r => r[1])), gaps = pauses(), list = edges('fragment')
  const near = (p, q) => Math.abs(p - q) < .03, on = t => list.some(c => Math.abs(c - t) < 1e-3)
  const next = gaps.some(([p, q]) => near(p, a) && near(q, b)) ? gaps.find(([p]) => p >= last - 1e-6)
    : on(a) && on(b) ? (() => { const i = list.findIndex(c => c >= last - 1e-3); return i >= 0 && i < list.length - 1 ? [list[i], list[i + 1]] : null })()
    : (() => { const g = gaps.find(([p]) => p > last + .03); if (!g) return null; const after = gaps.find(([p]) => p > g[1] + 1e-6); return [g[1], after ? after[0] : duration] })()
  if (next && next[1] > next[0]) { add(...next); reveal(next[1]) }
}
export function setCursor(t) { assign({ chosen: null }); assign({ cursor: clamp(t) }); oncursor(cursor); invalidate(true) }
// A right-click, as in a text: outside what is selected it takes the caret there first, the selection gone; inside it,
// with several carets, or on what a press would grab (a caret, an edge, a handle: the pointer says so), all stays.
// Then the page's menu for it (`oncontext`), at the pointer
export function context(event) {
  event.preventDefault()
  const [px, py] = local(event), t = clamp(time(px))
  if (!duration || px > plot().w || py > plot().h + rowH()) return
  // in the room under the lanes, a track to make
  if (inRoom(py)) return oncontext({ x: event.clientX, y: event.clientY, room: true })
  // on a marker's place in its strip, its own: name it, take it away
  const mark = stripAt(px, py), flag = mark?.kind === 'mark' ? mark.i : -1
  if (flag >= 0) return oncontext({ x: event.clientX, y: event.clientY, marker: { ...markers[flag], rename: () => rename(flag) } })
  // in another track's lane, that track's: it is the one edited
  const was = focus
  refocus(lanes(), py)
  const kept = focus === was && (grabbing || py > plot().h || (selection ? [selection, ...more].some(r => r[1] > r[0] && t >= r[0] && t <= r[1]) : more.length > 0))
  if (!kept) { select(0, 0); setCursor(stuck(snap(t))) }
  oncontext({ x: event.clientX, y: event.clientY })
}
// Keys while the view has focus: arrows move the caret a hundredth of the view, by cues or sounds as a text's
// words or lines, the selection kept; Shift extends the selection from where it started. Space and the transport
// belong to the page.
export function key(event) {
  assign({ moving: null })
  const mod = event.metaKey || event.ctrlKey, step = (end - start) / 100, k = event.key
  // the room's caret goes back into the edited track as a caret moves, or Esc; R and a paste are its own
  if (ghost && (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'Escape'].includes(k))) unghost()
  const to = t => {
    if (event.shiftKey) {
      assign({ anchor: origin() })
      select(anchor, t, null, false, t)
    } else setCursor(t)
    reveal(t)
  }
  const head = selection ? (selection[0] === origin() ? selection[1] : selection[0]) : cursor
  // as in a text: by cues as by words (⌥ on a Mac, Ctrl elsewhere), by sounds as by lines (⌘ on a Mac, Ctrl ↑ ↓); to the
  // start or the end as to a text's (⌘ ↑ ↓ on a Mac, Home and End)
  const word = mac ? event.altKey && !event.metaKey : event.ctrlKey && !event.altKey
  const line = mac ? event.metaKey && !event.altKey : false, dir = { ArrowLeft: -1, ArrowUp: -1, ArrowRight: 1, ArrowDown: 1 }[k]
  if (dir && (k === 'ArrowLeft' || k === 'ArrowRight') && (word || line)) stepTo(line ? 'sound' : 'fragment', dir, event.shiftKey)
  else if (dir && (k === 'ArrowUp' || k === 'ArrowDown') && (word || event.altKey && mac)) stepTo('sound', dir, event.shiftKey)
  else if (k === 'ArrowLeft' || k === 'ArrowRight') to(clamp((event.shiftKey ? head : cursor) + (k === 'ArrowLeft' ? -step : step)))
  else if (k === 'Home' || k === 'End' || line && (k === 'ArrowUp' || k === 'ArrowDown')) to(k === 'Home' || k === 'ArrowUp' ? 0 : duration)
  else if (k === '=' || k === '+') zoom(.5, playhead ?? (selection ? (selection[0] + selection[1]) / 2 : cursor))
  else if (k === '-' || k === '_') zoom(2, playhead ?? cursor)
  else if (k === '0' && !mod) { assign({ fview: [0, 1] }); assign({ aview: [-1, 1] }); assign({ zoomed: {} }); fitTo(0, duration) }
  else if (k === 'Escape' && chosen) { assign({ chosen: null }); invalidate(true) }
  else if (k === 'Escape' && (selection || more.length)) select(0, 0)
  else if (mod && k.toLowerCase() === 'd') addNext()
  else if (mod && k.toLowerCase() === 'a') select(0, duration)
  // the marker chosen goes before what is selected: its triangle dragged leaves the selection as it was
  else if ((k === 'Delete' || k === 'Backspace') && chosen) { const m = chosen; assign({ chosen: null }); if (onedit('unmark', m)) assign({ markers: markers.filter(n => !same(n, m)) }); invalidate(true) }
  else if ((k === 'Delete' || k === 'Backspace') && ranges().length) onedit('remove', band ? selection : ranges())
  else if (mod && k.toLowerCase() === 'x' && selection && !band) onedit('cut', selection)
  else if (mod && k.toLowerCase() === 'c' && selection && !band) onedit('copy', selection)
  // ⌘V: the browser's paste, its clipboard with it (pasted)
  else if (mod && k.toLowerCase() === 'v') { pasted(); pasting = atCarets(); return }
  else if (mod && k.toLowerCase() === 'z') onedit(event.shiftKey ? 'redo' : 'undo')
  else if (mod && k.toLowerCase() === 'y') onedit('redo')
  else return
  event.preventDefault()
}
// A paste: at the carets ⌘V was pressed at, the system's clipboard with it (a file copied elsewhere comes so); one
// ⌘V no paste follows by its key's release (a browser that pastes only where text is written), from the editor's own
// clipboard. WebKit pastes where nothing is written once its beforepaste is taken
const atCarets = () => (carets().length ? carets() : [cursor]).map(t => [t, t])
let pasting = null
const pasted = data => { if (pasting) onedit('paste', pasting, data); pasting = null }

// The paste listened for on the picture, where view() wires it (view.js)
export function wire() {
  root.addEventListener('beforepaste', e => e.preventDefault())
  root.addEventListener('paste', e => { e.preventDefault(); pasting ??= atCarets(); pasted(e.clipboardData) })
  root.addEventListener('keyup', () => pasted())
}
