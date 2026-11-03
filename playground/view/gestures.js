import { select, told, addCaret, setCursor } from '../view.js'
import { plot, floor } from './geometry.js'
import { EDGE, STICK, FINE, root, oncursor, onscrub, onaudition, duration, more, selection, band, cursor, cues, bounds, contour, gripMode, anchor, noted, assign } from './model.js'
import { median, noteAt, linePoints, valueAt, onLine, toneOf, toneAt, pointOn, knotOn } from './notes.js'
import { TOOLS, handled, gripAt } from './overlay.js'
import { drag, again, thirdAt } from './pointer.js'
import { x, time, snap, snapF, seen, stuck, pitchLine, ly, snapV, inside, fy, rowOf, fold, pointAt, lineLanes, pitchLanes } from './scales.js'
import { editing } from './strips.js'

// What a press starts, by where it lands and the keys held: the caret, a range, a handle, a cue, a box, a grip, a
// fade corner, the audio dragged

// What a press on the picture takes, as in a text and as in Figma. A caret's line, any of them, drags the caret, the
// others staying; the time row, a ruler's, the caret alone there, a drag from it a range; a range's edge,
// any of them, drags it, the others staying, on past the range's other edge turning it over from there; anywhere
// else, at once, the caret there and all else gone, and a drag from it a range. Shift sums: at once the selection, or
// the caret, out to the press from where it was begun (`origin`), as Shift and a click in a text, a drag going on with
// it. A drag inside the selection moves its audio, as selected text is dragged; clicked there, the caret there alone.
// Alt adds: another caret, or dragged another range (on the spectrogram with a band, another box); dragged inside the
// selection, a copy of its audio (Finder's and Figma's Alt-drag). ⌘ (Ctrl) on the spectrogram, a box of time and
// frequency, a band. Each keeps its distance from the pointer. `hear` is the time a drag sounds.
export function selectDown(event, px, py, t, L) {
  const row = py > plot().h, spec = !row && L.spec.find(rect => inside(rect, px, py))
  // inside the selection, but on a caret's line there (the time row put it there), the caret's
  const within = selection && !band && !row && py <= floor() && px > x(selection[0]) + EDGE && px < x(selection[1]) - EDGE && !caretAt(px, py) && !thirdAt(px, py)
  const box = spec && !within && (editing(event) || event.altKey && band) ? spec : null
  if (event.shiftKey && !event.altKey) {
    if (!again(before, px, py)) before = { at: performance.now(), px, py, range: selection && !band ? [...selection] : [cursor, cursor] }
    const o = origin()
    select(o, t, band, true, t)
    assign({ anchor: o })
    return { anchor: o, offset: 0, moved: true, keep: true, hear: t }
  }
  const [a, b] = selection ?? []
  if (within) return { carry: event.altKey ? 'copy' : 'move', a, b, x: px, y: py, to: a, moved: false, alt: event.altKey }
  // a range's edge, Alt held or not, its own: dragged as the caret held is, Alt showing every cue meanwhile
  const e = !row && !box && py <= floor() && edgeAt(px)
  if (e) {
    if (e.r) take(e.r)
    return { anchor: selection[1 - e.edge], edge: e.edge, offset: selection[e.edge] - t, moved: true, resizing: true, keep: true, hear: selection[e.edge] }
  }
  // a box sounds its band once it opens: a press alone has none. Another caret there at once, as the press goes down
  // (what was there kept, `was`, for a press held still: the caret's, no caret added), a drag on from it a range
  if (event.altKey && !row) {
    if (box) return { anchor: t, x: px, y: py, offset: 0, moved: false, adding: true, hear: null, box, f: snapF(box, py) }
    const was = { selection, band, cursor, more: [...more] }, n = more.length
    addCaret(t)
    return { anchor: t, x: px, y: py, offset: 0, moved: false, adding: true, placed: true, started: more.length > n, was, hear: t }
  }
  // The time row, a ruler's: pressed, the caret there alone, what is selected staying (up); dragged, a range, with
  // tracks through every lane (with Alt, another); held still, the caret, dragged (down)
  if (row) {
    if (event.altKey) return { anchor: t, x: px, y: py, offset: 0, moved: false, adding: true, hear: t, row: true }
    setCursor(stuck(t))
    return { anchor: t, x: px, y: py, offset: 0, moved: false, hear: cursor, row: true }
  }
  if (box) { select(0, 0); setCursor(t); return { anchor: t, x: px, y: py, offset: 0, box, f: snapF(box, py), moved: false, hear: null } }
  const c = caretAt(px, py)
  if (c) {
    if (c.r) take(c.r)
    const offset = cursor - t
    setCursor(stuck(snap(t + offset)))
    // a caret's line only clicked is a click: the caret there alone (up)
    return { caret: true, offset, moved: true, hear: cursor, from: cursor, keep: true, x: px, still: true }
  }
  select(0, 0)
  setCursor(t)
  return { anchor: t, x: px, y: py, offset: 0, moved: false, hear: t, spec }
}
// Where the selection was begun, the end Shift keeps: the edge its drag started from, else its start; with none, the
// caret
export const origin = () => !selection ? cursor : anchor === selection[1] ? selection[1] : selection[0]
// the caret or range gestures act on, as one of the others would hold it
export const current = () => selection ? band ? [...selection, ...band] : [...selection] : [cursor, cursor]
// A caret's line within reach, { r } (null r: the caret, inside a selection too, which it keeps; on the selection's
// edge, as a selection puts it, the edge's), and a range's edge, the nearest: { r (null: the selection), edge, 0 or 1, t }
export function caretAt(px, py) {
  if (py > floor()) return null
  const clear = !selection || selection.every(t => Math.abs(x(t) - x(cursor)) > EDGE)
  if (clear && Math.abs(x(cursor) - px) <= EDGE) return { r: null }
  const r = more.find(r => r.length === 2 && r[0] === r[1] && Math.abs(x(r[0]) - px) <= EDGE)
  return r ? { r } : null
}
export function edgeAt(px) {
  let best = null
  for (const r of [...selection && !band ? [null] : [], ...more.filter(r => r.length === 2 && r[1] > r[0])]) for (const edge of [0, 1]) {
    const t = (r ?? selection)[edge], d = Math.abs(x(t) - px)
    if (d <= EDGE && (!best || d < best.d)) best = { r, edge, t, d }
  }
  return best
}
// A press on a range's handles (the one under the pointer's, which becomes the one gestures act on): a fade from its
// corner; its level, pitch, intonation or formants from its pill, dragged up or down; its length from its grip, trimmed, stretched or
// sped. Each only clicked asks what it does (its curve, its mode). At a caret, silence opened. They come before
// anything else there, the gain line or the pitch curve under them included.
export function gripDown(px, py, L, event) {
  const grip = gripAt(L, px, py)
  if (!grip) return null
  const [kind] = grip, [p, q] = handled(), other = more.find(r => r.length === 2 && r[0] === p && r[1] === q)
  if (other) take(other)
  if (kind === 'gap') return { gap: true, at: cursor, to: cursor, x: px, offset: cursor - time(px) }
  const [a, b] = selection
  if (kind === 'level' || TOOLS.includes(kind)) return { pill: true, tool: kind, a, b, x: px, y: py, lane: L.all[0], moved: false }
  // each keeps the distance it was pressed at from the edge it moves
  return kind === 'stretch' ? { stretch: true, a, b, to: b, x: px, offset: b - time(px), mode: gripMode } : { fade: kind, a, b, x: px, offset: (kind === 'in' ? a : b) - time(px) }
}
// ⌘ (Ctrl) at a range's end, any range's: its length, as its grip sets it (trimmed, stretched or sped)
export function endDown(px, py, event) {
  const e = editing(event) && py <= floor() && edgeAt(px)
  if (!e || !e.edge) return null
  if (e.r) take(e.r)
  const [a, b] = selection
  return { stretch: true, end: true, a, b, to: b, x: px, offset: b - time(px), mode: gripMode }
}
// what its pill or a tool sets, up or down: its level; its pitch, its intonation (about the range's median pitch) or
// its formants
export const lifting = (rect, py, tool) => {
  const [a, b] = selection, ways = { pitch: { lift: 'pitch', ratio: 1, st: 0 }, intonation: { lift: 'intonation', k: 1, mid: median({ at: a, duration: b - a }) }, formant: { lift: 'formant', st: 0 } }
  return { a, b, rect, y: py, ...ways[tool] ?? { lift: 'gain', db: 0 } }
}
// Shift held while dragging a gain point keeps to one axis: the one the drag has gone further along from its press
export const lock = (event, px, py) => !event.shiftKey || drag?.x == null || drag?.y == null ? [px, py] : Math.abs(px - drag.x) >= Math.abs(py - drag.y) ? [px, drag.y] : [drag.x, py]
// One of the others, a range, a box or a caret, made the one gestures act on; the one there was, among the others
function take(r) {
  const i = more.indexOf(r)
  if (i < 0) return
  more.splice(i, 1)
  more.push(current())
  assign({ anchor: null })
  if (r.length === 4) { assign({ selection: [r[0], r[1]] }); assign({ band: [r[2], r[3]] }) }
  else if (r[1] > r[0]) { assign({ selection: [...r] }); assign({ band: null }) }
  else { assign({ band: null, selection: null }); assign({ cursor: r[0] }); oncursor(cursor) }
  told()
}
// Where a drag is: the pointer, or held ⌘ (Ctrl) a quarter as far from where ⌘ went down, as Blender's Shift and Logic's
// Control-Shift aim; nothing snaps meanwhile (Ableton's ⌘ drag bypasses the grid, Figma's Control its snapping). A box
// its ⌘ began goes as the pointer does, until ⌘ goes down again
// ⌘ (Ctrl) pressed while a range is dragged on the spectrogram makes it a box from where it began, as though held from
// the start; elsewhere, it is fine
export function aimed(event, px, py) {
  const a = drag.aim, on = editing(event), ex = a.ex + (px - a.px) * a.k, ey = a.ey + (py - a.py) * a.k
  if (on !== a.on) {
    if (on && drag.spec && !drag.box) Object.assign(drag, { box: drag.spec, f: snapF(drag.spec, drag.y) })
    Object.assign(a, { px, py, ex, ey, on, k: on && !drag.box ? FINE : 1 })
  }
  return [ex, ey]
}
export const fine = () => drag?.aim?.k < 1
// The moment a drag is at sounds, a band of it for a box; from the press on, every move sounds
export function scrub(d) {
  d.scrubbing = true
  root.style.cursor = 'none'
  onscrub(d.hear, d.band || null)
}
export function unscrub() {
  if (drag?.scrubbing) { drag.scrubbing = false; onscrub(null) }
}
// A cue's line, held ⌘ (Ctrl): pressed and let go, the caret on the cue; dragged, the cue moves, the audio either side
// stretching to meet it. Not the sound's own start or end (bounds), which warp holds
export const nearCue = (px, py, keys) => editing(keys) && py <= floor() ? seen().find(i => !bounds.has(cues[i]) && Math.abs(x(cues[i]) - px) <= STICK) ?? -1 : -1
export function cueDown(px, py, keys) {
  const i = nearCue(px, py, keys)
  if (i < 0) return null
  return { cue: i, to: cues[i], x: px, moved: false, offset: cues[i] - snap(time(px)), prev: cues[i - 1] ?? 0, next: cues[i + 1] ?? duration }
}
// The line edited where it is (the pitch's 0 while it has no points), within a few pixels of it, or a point; only a
// point (`point`), where the pitch curve's voiced stretches, under the line, come before its body
export function penDown(px, py, L, point = false) {
  const rect = lineLanes(L).find(r => inside(r, px, py))
  if (!rect || !onLine(rect, px, py) || point && pointAt(rect, px, py) < 0) return null
  const points = linePoints().map(p => [...p])
  let index = pointAt(rect, px, py), offset = [0, 0]
  // a grabbed point keeps its distance from the pointer instead of jumping to it
  if (index >= 0) { const [t, v] = points[index]; offset = [x(t) - px, ly(rect, v) - fold(rect, py)] }
  else {
    const t = snap(time(px))
    index = points.findIndex(p => p[0] > t)
    if (index < 0) index = points.length
    points.splice(index, 0, [t, snapV(rect, py)])
  }
  return { points, line: pitchLine() ? 'pitchline' : 'envelope', index, rect, offset, x: px, y: py, t0: points[index][0], before: JSON.stringify(linePoints()) }
}
// A point of the pitch line where it sits on the pitch curve: dragged up or down to the pitch the pointer is at (`hz`
// the curve's there when pressed, `v0` the point's value then), along time between its neighbours
export function toneDown(px, py, L) {
  const rect = contour?.f0.length && pitchLanes(L).find(r => inside(r, px, py))
  if (!rect) return null
  let index = pointOn(rect, px, py), points = linePoints().map(p => [...p])
  const knot = index < 0 ? knotOn(rect, px, py) : null
  if (index < 0 && knot == null) return null
  // a bend: made a point of the line, with the handles either side (the sound's ends past the first and the
  // last) where no point of the line is between, each at the value the line has there, so nothing changes till it moves
  if (knot != null) {
    const all = contour.knots, lo = all.filter(k => k < knot).at(-1) ?? 0, hi = all.find(k => k > knot) ?? duration
    const free = (a, b) => !points.some(([p]) => p > Math.min(a, b) && p < Math.max(a, b))
    const add = [knot, ...[lo, hi].filter(k => free(k, knot))].map(k => [k, valueAt(points, k)])
    points = [...points, ...add].sort((p, q) => p[0] - q[0])
    index = points.findIndex(p => p[0] === knot)
  }
  const [t, v0] = points[index], hz = toneAt(t)
  return { points, line: 'pitchline', tone: true, index, rect, hz, v0, offset: [x(t) - px, 0], x: px, y: py, t0: t, before: JSON.stringify(linePoints()) }
}
// A press on the pitch curve: dragged up or down, the whole pitch line with it (`base`, the line before; each point by
// as much, or with none one where it was pressed): all of the voice moved, as it moves under the pointer, heard over
// the voiced stretch pressed (frames [a, b]); let go where it was pressed, a point of the line there (tapped)
export function pitchDown(px, py, L) {
  const rect = contour?.f0.length && pitchLanes(L).find(r => inside(r, px, py))
  if (!rect) return null
  const { times, f0 } = contour, t = time(px)
  let i = 0
  while (i < times.length - 1 && times[i + 1] <= t) i++
  if (!f0[i] || Math.abs(fy(rect, toneOf(i)) - py) > 12) return null
  let a = i, b = i
  while (a > 0 && f0[a - 1]) a--
  while (b < f0.length - 1 && f0[b + 1]) b++
  const base = linePoints().map(p => [...p])
  return { run: [a, b], rect, x: px, y: py, at: snap(t), base, points: base, st: 0, moved: false }
}
// A press on a note of the edited track's notes lane: its span selected, as a double-click selects a word, and heard
// while held; dragged up or down, its pitch, by semitones (held ⌘, by cents), heard as it goes, as Melodyne's notes are
// dragged
export function noteDown(px, py, L, event) {
  if (event.shiftKey || event.altKey) return null
  const rect = L.notes.find(r => inside(r, px, py)), n = rect && noteAt(rect, px, py)
  if (!n) return null
  select(n.time, n.time + n.duration)
  // heard from its start while held, as it is, till dragged (its pitch then, as it goes: hear)
  onaudition({ at: n.time, duration: n.duration, whole: true })
  return { lift: 'pitch', a: n.time, b: n.time + n.duration, rect, x: px, y: py, ratio: 1, st: 0, rows: rowOf(rect), hz: n.freq, edges: apart(noted[rect.i] ?? [], n), heard: true }
}
// Where a note sung apart from the ones either side (BRIDGE s of quiet or more each side: a breath, a stop) moves
// whole, from its first cycle: half way into the quiet either side, BREATH s at most, [before, after]; null where it is
// tied to one, which it glides into and out of as a voice moves (fn/pitch.js)
const BRIDGE = .03, BREATH = .05
function apart(list, n) {
  const a = n.time, b = n.time + n.duration, before = list.filter(m => m.time + m.duration <= a + 1e-9).at(-1), after = list.find(m => m.time >= b - 1e-9)
  const pre = before ? a - before.time - before.duration : a, post = after ? after.time - b : duration - b
  return pre >= BRIDGE && post >= BRIDGE ? [a - Math.min(pre / 2, BREATH), b + Math.min(post / 2, BREATH)] : null
}
// A click on the pitch curve: a point of the pitch line there, at the value the line has, so nothing changes yet
export const tapped = d => d.base.some(p => Math.abs(p[0] - d.at) < .001) ? d.base : [...d.base, [d.at, valueAt(d.base, d.at)]].sort((p, q) => p[0] - q[0])
// where a point of the pitch line is heard as it is dragged: from the one before it to the one after, a second either
// side at most
export const heardAround = (pts, i) => { const t = pts[i][0], a = Math.max(pts[i - 1]?.[0] ?? 0, t - 1), b = Math.min(pts[i + 1]?.[0] ?? duration, t + 1); return { at: a, duration: Math.max(.05, b - a) } }
// Shift pressed, what was selected before its clicks began (or the caret): a double- or triple-click with Shift
// extends that to the fragment or the sound, as in a text Shift and a double-click extend by words, the first click's
// own extending (to its press) let go
export let before = null
