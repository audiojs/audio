import Waveform from '../assets/gl-waveform.js'
import Spectrogram from '../assets/gl-spectrogram.js'
import { CURVES } from './ops.js'
import { frozen, untrack, lockedAt, ghost, haunt, unghost, layout, CHUNK, HELD, pointers, rowH, plot, spare, bandOf, tallOf, lanes, floor, inRoom, own, laneAt, trackAt, footAt, bands, resized, refocus, freeze, own0, frozenAt } from './view/geometry.js'
import { EDGE, STICK, ONTO, NOTCH, FINE, stylize, HOLD, SLOP, EXTEND, ADD, mac, GLIDE, root, onselect, oncursor, onedit, onmode, onscrub, oncontext, onaudition, onheight, color, runway, gl, sgl, waves, specs, count, rate, duration, display, hovered, show, segments, markers, arriving, more, dropped, droppedNew, recording, empty, asking, pieces, start, end, fview, selection, band, cursor, playhead, played, speed, guides, nudge, steered, cues, bounds, ranks, envelope, shift, contour, fadeCurve, cueKinds, aview, gripMode, pitching, levelStep, look, waveLook, data, tracks, focus, allLanes, sections, windows, windowsOf, anchor, heights, lift, noted, zoomed, moving, chosen, unframed, held, ahead, mount, assign } from './view/model.js'
import { hear, pitchRange, median, noteAt, linePoints, curveOf, valueAt, onLine, toneOf, toneAt, pointOn, knotOn } from './view/notes.js'
import { lanesEnd, reach, seenTo, fitTo, TOOLS, handled, gripAt, gripPointer, metered, glide } from './view/overlay.js'
import { twinsFor, dpr, resize, arrange, moved, faded, crossed, invalidate, tints, tonesOf, twinOf, unheard, reshow, snapshot, hues, rgba, channel, shades } from './view/render.js'
import { steer, slide, unslide, onAway, bring, fitAll, frameSelected } from './view/ruler.js'
import { scale, bar, onBar, x, time, clamp, unit, snap, free, snapF, seen, stick, stuck, pitchLine, ly, snapV, local, inside, fy, uy, rowOf, yKey, ya, fold, pointAt, lineLanes, pitchLanes, setRange, setFreqs, frameVoice, zoom, zoomSpan, whole, zoomFreqs, zoomKeys, setKeys, onFreqs, onKeys, onLevels, zoomLevels, scrollLevels, setScale, reveal } from './view/scales.js'
import { thumb, liftAt, editing, same, markAt, labelAt, notch, stripAt, rename } from './view/strips.js'
export { KINDS, NOTES, noteOf, stylize, HOLD, SLOP } from './view/model.js'
// the times a marker marks: a moment, or a range's start and end
const marked = m => m.duration ? [m.time, m.time + m.duration] : [m.time]
// a marker's lane with tracks (one of a track gone, the edited one's), null without: it runs through them all
const markLane = m => { if (!tracks) return null; const i = tracks.findIndex(t => t.name === m.track); return i < 0 ? focus : i }
// the edited track's markers: those a press, a drag, a double-click or an edit drawn ahead (moved) go by; every one
// without tracks
const ours = m => !tracks || markLane(m) === focus
// and the ends of the places takes went in there (sections), as a range marker's: what a dragged edge or a caret snaps to
// (a marker dragged, not to where it was)
const ownMarks = () => [...markers.filter((m, i) => ours(m) && i !== drag?.marker).flatMap(marked), ...ownTakes().flatMap(t => [t.at, Math.min(t.end, duration)])]
const ownTakes = () => sections.filter(t => t.lane == null || !tracks || t.lane === focus)
// What a dragged time went onto (stick): a marker, by its name (a range's start or end), as Figma names what an object
// snapped to, { text }; a sound's start or a hit, the takes' start, the side the sound is on, { side: 1 }; its end or
// the takes' end, { side: -1 }; a cue a warp placed, nothing. A marker's or the takes' place, in the strip: `strip`
function snappedTo(q) {
  for (const m of markers.filter(ours)) {
    const [a, b] = marked(m), name = m.label || 'Marker'
    if (q === a) return { text: b == null ? name : `${name} start`, strip: true }
    if (q === b) return { text: `${name} end`, strip: true }
  }
  for (const t of ownTakes()) if (q === t.at || q === Math.min(t.end, duration)) return { side: q === t.at ? 1 : -1, strip: true }
  const side = SIDES[cueKinds[cues?.indexOf(q) ?? -1]]
  return side ? { side } : {}
}
// the side a cue's sound is on, by its kind
const SIDES = { start: 1, hit: 1, end: -1 }
// where a marker is now: the edited track's where an edit drawn ahead takes it (null where it takes it out), another's
// where it is
const placed = m => ours(m) ? moved(m.time) : m.time
const RECORD = 10, unwritten = () => empty && !duration && !arriving && !recording && end > start
function taking() {
  const { at, total } = recording, last = at + (recording.length - recording.lead) / recording.rate
  assign({ duration: Math.max(total, last) })
  const span = end - start, head = span * .9 * lanesEnd(lanes()) / plot().w
  if (last > start + head) setRange(last - head, last - head + span, true)
  assign({ pieces: [{ s0: 0, s1: at, d0: 0, d1: at }, { s0: last, s1: total, d0: last, d1: total }].filter(p => p.s1 > p.s0) })
  invalidate()
}
// where the take is drawn, px from the plot's left
const takes = () => [x(recording.at), x(recording.at + (recording.length - recording.lead) / recording.rate)]
function ended() {
  if (!recording) return
  for (const picture of [...recording.waves, ...recording.specs]) picture.destroy()
  assign({ duration: recording.total })
  assign({ recording: null })
  assign({ leveled: false })
}
function put(channels, sampleRate, leaves = null) {
  channels ||= []
  const all = replace(channels[0]?.length ? channels[0].length / (sampleRate || rate) : 0)
  if (!arriving && !windows && channels.length && channels.length === data.length && (sampleRate || rate) === rate && channels.every((y, c) => y.length === data[c].length)) {
    ended()
    const [i0, i1] = changed(data, channels)
    assign({ data: channels })
    if (i1 > i0) channels.forEach((y, c) => { waves[c].set(y.subarray(i0, i1), i0); specs[c]?.set(y.subarray(i0, i1), i0) })
    tints.clear()
    // the twins of the samples before, where none came weighed for these, gone: never the last one's levels over them
    if (i1 > i0) unheard(!!leaves || !twinOf.size)
    twinsFor(leaves)
    return invalidate()
  }
  assign({ arriving: null })
  ended()
  assign({ count: channels.length }); assign({ rate: sampleRate || rate })
  assign({ duration: channels[0]?.length ? channels[0].length / rate : 0 })
  lay(count)
  assign({ windows: null }); assign({ windowsOf: windowsOf + 1 }); assign({ leavesOf: null })
  unheard()
  fill(assign({ data: channels }))
  renew(all)
  twinsFor(leaves)
}
let drag = null
let touch = matchMedia('(hover: none)').matches
function down(event) {
  touch = event.pointerType !== 'mouse'
  if (!duration || event.button > 0) return
  assign({ moving: null })
  root.setPointerCapture(event.pointerId)
  pointers.set(event.pointerId, local(event))
  if (pointers.size === 2) {
    unscrub()
    // a pinch zooms time; on the frequencies, the frequencies; on the levels, the levels
    const pinch = [...pointers.values()], mid = [(pinch[0][0] + pinch[1][0]) / 2, (pinch[0][1] + pinch[1][1]) / 2], rect = onFreqs(...mid)
    const levels = onLevels(...mid)
    drag = { pinch, range: [start, end], fview, u: rect ? uy(rect, mid[1]) : null, levels: levels && aview, value: levels && ya(levels, mid[1]), lh: levels?.[3] }
    return
  }
  // on the scrollbar, the view dragged: pressed beside the thumb, it centres there first
  const [px, py] = local(event)
  if (onBar(px, py)) {
    const b = bar(), span = end - start
    steer()
    if (px < b.x0 || px > b.x1) setRange(px / plot().w * b.total - span / 2, px / plot().w * b.total + span / 2, true)
    drag = { scroll: true, x: px, start, total: b.total, moved: true, keep: true }
    return invalidate()
  }
  // on the chevron at the edge the playhead or the caret is past, out of sight, the view brought to it
  if (onAway(px, py)) { bring(); return }
  // the scrollbar of the bands, the bands dragged; the room under the lanes, a new track's caret there (a press anywhere
  // else takes it back)
  if (liftAt(px, py)) { const t = thumb(); if (py < t.y || py > t.y + t.h) assign({ lift: Math.max(0, Math.min(spare, (py - t.h / 2) / t.room * spare)) }); drag = { lifting: true, y: py, lift0: lift }; return invalidate() }
  if (inRoom(py)) return haunt(snap(time(px)))
  unghost()
  // in a band's strip, the band then the one edited: a marker's triangle takes hold of it (a range's, that end), the
  // caret and what plays staying where they are, dragged, it moves, let go unmoved, the caret goes to it (up); in a
  // locked track's, nothing. A range or the takes' place: its stretch selected at once and heard from its start while
  // held, as it is; nothing more (dragged on, nothing moves). A name pressed, named anew as it is let go (clicked)
  const mark = !gripAt(own(lanes()), px, py) && stripAt(px, py)
  if (mark) {
    const locked = lockedAt(mark.rects[0]?.[1] ?? 0), edge = notch(mark, px), m = mark.kind === 'mark' ? markers[mark.i] : null
    if (!locked) refocus(lanes(), mark.rects[0]?.[1] ?? py, px)
    assign({ chosen: null })
    if (edge >= 0) {
      if (!locked) drag = { marker: mark.i, edge, split: !m.duration && event.altKey, x: px, to: m.time, end: m.time + (m.duration ?? 0), moved: false, aim: { px, py, ex: px, ey: py, on: editing(event), k: editing(event) ? FINE : 1 } }
      assign({ chosen: locked ? null : m })
      return invalidate(true)
    }
    if (m && !m.duration) return invalidate(true)
    const t = m ? null : sections[mark.i], a = m ? m.time : t.at, b = m ? m.time + m.duration : Math.min(t.end, duration)
    select(a, b)
    if (!(m && labelAt(px, py) === mark.i)) { onaudition({ at: a, duration: b - a, whole: true }); drag = { preview: true } }
    return invalidate(true)
  }
  // a band's foot, but where a selection's tools or takes are: its height, dragged
  const foot = footAt(py)
  if (foot != null && !gripAt(own(lanes()), px, py)) { drag = { foot, all: event.altKey, y: py, py, h0: tallOf(foot) }; return invalidate(true) }
  if (frozenAt(px, py)) return
  // a press in another track's lane makes it the one edited; in a locked one's, nothing
  if (lockedAt(py)) return
  refocus(lanes(), py, px)
  // on a marker's line, its time; within a few px of a cue, the cue's, as the pointer's time said (aimedAt), a range
  // begun there snapped from its start; held ⌘, where it is (aims finely, nothing snapping)
  const t = markAt(px, py) ?? (editing(event) ? snap(time(px)) : stuck(snap(time(px))))
  const L = own(lanes())
  drag = gripDown(px, py, L, event) || endDown(px, py, event) || (show.hits && cueDown(px, py, event)) || (show.gain && !pitchLine() && penDown(px, py, L)) || (pitchLine() && (toneDown(px, py, L) || penDown(px, py, L, true) || pitchDown(px, py, L) || penDown(px, py, L))) || noteDown(px, py, L, event) || selectDown(event, px, py, t, L)
  // ⌘ aims finely, but not what it took hold of: a box, audio carried, an end stretched, a cue
  drag.aim = { px, py, ex: px, ey: py, on: editing(event), k: editing(event) && !drag.box && !drag.carry && !drag.end && drag.cue == null ? FINE : 1 }
  // a plain press held still, Alt's too: the caret, dragged, no selection (no caret added)
  const d = drag
  if (d.anchor != null && !d.moved && !d.caret && !d.box && !d.keep) d.hold = setTimeout(() => {
    if (drag !== d || d.moved) return
    if (d.was) { assign({ selection: d.was.selection, band: d.was.band, cursor: d.was.cursor }); assign({ more: d.was.more }); told() }
    Object.assign(d, { caret: true, adding: false, offset: 0, from: cursor, keep: true })
    root.style.cursor = 'ew-resize'
  }, HOLD)
  // the moment under the caret sounds at once, for as long as it is held
  if (drag.hear != null) scrub(drag)
  invalidate()
}
// What a press on the picture takes, as in a text and as in Figma. A caret's line, any of them, drags the caret, the
// others staying; the time row, a ruler's, the caret alone there, a drag from it a range; a range's edge,
// any of them, drags it, the others staying, on past the range's other edge turning it over from there; anywhere
// else, at once, the caret there and all else gone, and a drag from it a range. Shift sums: at once the selection, or
// the caret, out to the press from where it was begun (`origin`), as Shift and a click in a text, a drag going on with
// it. A drag inside the selection moves its audio, as selected text is dragged; clicked there, the caret there alone.
// Alt adds: another caret, or dragged another range (on the spectrogram with a band, another box); dragged inside the
// selection, a copy of its audio (Finder's and Figma's Alt-drag). ⌘ (Ctrl) on the spectrogram, a box of time and
// frequency, a band. Each keeps its distance from the pointer. `hear` is the time a drag sounds.
function selectDown(event, px, py, t, L) {
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
const origin = () => !selection ? cursor : anchor === selection[1] ? selection[1] : selection[0]
// the caret or range gestures act on, as one of the others would hold it
const current = () => selection ? band ? [...selection, ...band] : [...selection] : [cursor, cursor]
// A caret's line within reach, { r } (null r: the caret, inside a selection too, which it keeps; on the selection's
// edge, as a selection puts it, the edge's), and a range's edge, the nearest: { r (null: the selection), edge, 0 or 1, t }
function caretAt(px, py) {
  if (py > floor()) return null
  const clear = !selection || selection.every(t => Math.abs(x(t) - x(cursor)) > EDGE)
  if (clear && Math.abs(x(cursor) - px) <= EDGE) return { r: null }
  const r = more.find(r => r.length === 2 && r[0] === r[1] && Math.abs(x(r[0]) - px) <= EDGE)
  return r ? { r } : null
}
function edgeAt(px) {
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
function gripDown(px, py, L, event) {
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
function endDown(px, py, event) {
  const e = editing(event) && py <= floor() && edgeAt(px)
  if (!e || !e.edge) return null
  if (e.r) take(e.r)
  const [a, b] = selection
  return { stretch: true, end: true, a, b, to: b, x: px, offset: b - time(px), mode: gripMode }
}
// what its pill or a tool sets, up or down: its level; its pitch, its intonation (about the range's median pitch) or
// its formants
const lifting = (rect, py, tool) => {
  const [a, b] = selection, ways = { pitch: { lift: 'pitch', ratio: 1, st: 0 }, intonation: { lift: 'intonation', k: 1, mid: median({ at: a, duration: b - a }) }, formant: { lift: 'formant', st: 0 } }
  return { a, b, rect, y: py, ...ways[tool] ?? { lift: 'gain', db: 0 } }
}
// Shift held while dragging a gain point keeps to one axis: the one the drag has gone further along from its press
const lock = (event, px, py) => !event.shiftKey || drag?.x == null || drag?.y == null ? [px, py] : Math.abs(px - drag.x) >= Math.abs(py - drag.y) ? [px, drag.y] : [drag.x, py]
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
function aimed(event, px, py) {
  const a = drag.aim, on = editing(event), ex = a.ex + (px - a.px) * a.k, ey = a.ey + (py - a.py) * a.k
  if (on !== a.on) {
    if (on && drag.spec && !drag.box) Object.assign(drag, { box: drag.spec, f: snapF(drag.spec, drag.y) })
    Object.assign(a, { px, py, ex, ey, on, k: on && !drag.box ? FINE : 1 })
  }
  return [ex, ey]
}
const fine = () => drag?.aim?.k < 1
// The moment a drag is at sounds, a band of it for a box; from the press on, every move sounds
function scrub(d) {
  d.scrubbing = true
  root.style.cursor = 'none'
  onscrub(d.hear, d.band || null)
}
function unscrub() {
  if (drag?.scrubbing) { drag.scrubbing = false; onscrub(null) }
}
// A cue's line, held ⌘ (Ctrl): pressed and let go, the caret on the cue; dragged, the cue moves, the audio either side
// stretching to meet it. Not the sound's own start or end (bounds), which warp holds
const nearCue = (px, py, keys) => editing(keys) && py <= floor() ? seen().find(i => !bounds.has(cues[i]) && Math.abs(x(cues[i]) - px) <= STICK) ?? -1 : -1
function cueDown(px, py, keys) {
  const i = nearCue(px, py, keys)
  if (i < 0) return null
  return { cue: i, to: cues[i], x: px, moved: false, offset: cues[i] - snap(time(px)), prev: cues[i - 1] ?? 0, next: cues[i + 1] ?? duration }
}
// The line edited where it is (the pitch's 0 while it has no points), within a few pixels of it, or a point; only a
// point (`point`), where the pitch curve's voiced stretches, under the line, come before its body
function penDown(px, py, L, point = false) {
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
function toneDown(px, py, L) {
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
function pitchDown(px, py, L) {
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
function noteDown(px, py, L, event) {
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
const tapped = d => d.base.some(p => Math.abs(p[0] - d.at) < .001) ? d.base : [...d.base, [d.at, valueAt(d.base, d.at)]].sort((p, q) => p[0] - q[0])
// where a point of the pitch line is heard as it is dragged: from the one before it to the one after, a second either
// side at most
const heardAround = (pts, i) => { const t = pts[i][0], a = Math.max(pts[i - 1]?.[0] ?? 0, t - 1), b = Math.min(pts[i + 1]?.[0] ?? duration, t + 1); return { at: a, duration: Math.max(.05, b - a) } }
function move(event) {
  const [px, py] = local(event)
  if (pointers.has(event.pointerId)) pointers.set(event.pointerId, local(event))
  if (drag?.pinch && pointers.size === 2) {
    const [a, b] = drag.pinch, [p, q] = [...pointers.values()], [r0, r1] = drag.range
    // on the frequencies or the levels, they zoom, by how far apart the fingers go up and down; else time
    // (each move from where the fingers went down: nothing gathered)
    if (drag.levels) { assign({ aview: drag.levels }); assign({ pull: 1 }); return zoomLevels(Math.abs(b[1] - a[1]) / Math.max(8, Math.abs(q[1] - p[1])), drag.value, drag.lh) }
    if (drag.u != null) {
      const k = Math.abs(b[1] - a[1]) / Math.max(8, Math.abs(q[1] - p[1])), [u0, u1] = drag.fview, f = (drag.u - u0) / (u1 - u0), fspan = (u1 - u0) * k
      return setFreqs(drag.u - f * fspan, drag.u - f * fspan + fspan)
    }
    // the fingers' middle holds its time, as they move it moving the view; while it plays followed, the playhead holds
    // its place instead, the fingers scaling the view alone (zoomSpan)
    const k = Math.abs(b[0] - a[0]) / Math.max(8, Math.abs(q[0] - p[0])), span = (r1 - r0) * k
    if (playhead != null && !steered) return zoomSpan(span, playhead)
    const center = r0 + (a[0] + b[0]) / 2 / plot().w * (r1 - r0)
    const at = (p[0] + q[0]) / 2 / plot().w
    steer()
    setRange(center - at * span, center - at * span + span, true)
    return
  }
  if (!drag) { touch = event.pointerType !== 'mouse'; assign({ hovered: event.pointerType === 'touch' ? null : [px, py] }); hover(px, py, event); return invalidate(true) }
  if (drag.pinch || drag.preview) return
  // a band's foot, its height as far as the pointer has gone; the scrollbar's thumb, the bands with it
  if (drag.foot != null) { drag.all = event.altKey; drag.py = py; return resized() }
  if (drag.lifting) { assign({ lift: Math.max(0, Math.min(spare, drag.lift0 + (py - drag.y) / thumb().room * spare)) }); return invalidate() }
  if (drag.scroll) { const a = drag.start + (px - drag.x) / plot().w * drag.total; steer(); return setRange(a, a + end - start, true) }
  // a level or a voice dragged with the pointer locked (lift): where it would be, its moves added up, past the window's
  // edge as far as it goes
  if (drag.locked && document.pointerLockElement === root) { drag.vy += event.movementY; drags(event, drag.x, drag.vy); return }
  drag.raw = [px, py]
  return drags(event, ...aimed(event, px, py))
}
// A move draws the overlay alone (the selection, the caret, the handles are its own), the pictures again only where
// the move lays the output's pieces out anew: a selection dragged on a phone redrew every picture each move, the
// waveform, the spectrogram and the grid cut by the waveform, each a window-wide layer
function drags(event, px, py) {
  const was = pieces
  // a lever (a level, a voice, the pitch curve all of it, up or down), the pointer hidden: what it does said where it
  // was pressed, only its value changing
  assign({ hovered: event.pointerType === 'touch' ? null : drag.lift || drag.run ? [drag.x, drag.y] : [px, py] })
  drag.last = [event, px, py]
  // a drag draws what it does (the helpers, the picture as it will be): the pointer goes while it does, once it moves
  if (drag.x == null || Math.abs(px - drag.x) >= SLOP || Math.abs(py - (drag.y ?? py)) >= SLOP) root.style.cursor = 'none'
  // a marker held by its triangle: a moment, it moves (held Alt as it was pressed, pulled apart into a range from it, as
  // Photoshop's split slider's triangle is); a range, the end held, as far as the other, onto it within ONTO px (one
  // there as it is let go: a moment, up); onto the cues and markers near it, as an edge goes (stuck)
  if (drag.marker != null) {
    if (!drag.moved && Math.abs(px - drag.x) < SLOP) return
    drag.moved = true
    const m = markers[drag.marker], to = t => stuck(snap(t + time(px) - time(drag.x)))
    if (drag.split) { const t = Math.min(duration, Math.max(0, to(m.time))); drag.edge = +(t > m.time); [drag.to, drag.end] = drag.edge ? [m.time, t] : [t, m.time] }
    else if (!m.duration) drag.to = drag.end = Math.min(duration, Math.max(0, to(m.time)))
    else if (drag.edge) { const t = Math.min(duration, Math.max(drag.to, to(m.time + m.duration))); drag.end = x(t) - x(drag.to) <= ONTO ? drag.to : t }
    else { const t = Math.max(0, Math.min(drag.end, to(m.time))); drag.to = x(drag.end) - x(t) <= ONTO ? drag.end : t }
    return invalidate(true)
  }
  if (drag.cue != null) {
    if (!drag.moved && Math.abs(px - drag.x) < SLOP) return
    drag.moved = true
    drag.to = Math.max(drag.prev + .01, Math.min(drag.next - .01, snap(time(px)) + drag.offset))
  }
  // the pitch curve, once it moves: up or down as a tool's pitch goes (glide), the whole pitch line with it
  else if (drag.run) {
    if (!drag.moved && Math.abs(px - drag.x) < SLOP && Math.abs(py - drag.y) < SLOP) return
    drag.moved = true
    const st = glide(drag.y - py, 24), range = pitchRange(drag), changed = st !== drag.st
    if (changed || !drag.heard) { drag.st = st; drag.points = drag.base.length ? drag.base.map(([t, v]) => [t, v + st]) : [[drag.at, st]] }
    hear(drag, changed, { ...range, curve: curveOf(drag.points) })
  }
  else if (drag.points) {
    // on the pitch curve, once it moves a few pixels
    if (drag.tone && !drag.moved) { if (Math.abs(px - drag.x) < SLOP && Math.abs(py - drag.y) < SLOP) return; drag.moved = true }
    const p = drag.points[drag.index], lo = drag.points[drag.index - 1]?.[0] ?? 0, hi = drag.points[drag.index + 1]?.[0] ?? duration, was = [...p]
    // a point moved only up or down keeps its time as it was, not taken to the zoom's step
    const [dx, dy] = drag.offset, [qx, qy] = lock(event, px, py)
    p[0] = qx === drag.x ? drag.t0 : Math.max(lo, Math.min(hi, snap(time(qx + dx))))
    // on the pitch curve: up or down from where it was, as a tool's pitch goes (glide)
    if (drag.tone) p[1] = +(drag.v0 + glide(drag.y - qy, 24)).toFixed(2)
    else p[1] = snapV(drag.rect, fold(drag.rect, qy) + dy)
    if (drag.line === 'pitchline') hear(drag, p[0] !== was[0] || p[1] !== was[1], { ...heardAround(drag.points, drag.index), curve: curveOf(drag.points) })
  }
  // the pill or a tool, its first move: up or down, its level, or a voice's pitch, intonation or formants. The pointer
  // locked meanwhile (Pointer Lock: Chrome 37, Firefox 50, Safari 10.1), so a drag goes on past the window's top or foot
  // as far as its scale does, the pointer back where it was pressed once let go
  else if (drag.pill) {
    if (Math.max(Math.abs(px - drag.x), Math.abs(py - drag.y)) < SLOP) return
    drag = { ...lifting(drag.lane, drag.y, drag.tool), aim: drag.aim, x: px, vy: py, locked: !!root.requestPointerLock }
    if (drag.locked) Promise.resolve(root.requestPointerLock()).catch(() => { if (drag) drag.locked = false })
    return drags(event, px, py)
  }
  // moved audio lands with its start or its end on a cue, whichever is nearer one, past the end too (silence opening
  // up to it); a copy goes in at a cue, anywhere up to the end. Up over the head, onto the tabs, it goes to a tab of
  // its own: the picture shows what it leaves (a move takes it out, the rest closing up), the pointer back to say so
  else if (drag.carry) {
    if (!drag.moved && Math.abs(px - drag.x) < SLOP && Math.abs(py - drag.y) < SLOP) return
    drag.moved = true
    drag.out = py < 0
    // down or up into another track's lane, it goes to that track (`into`), over what is there, as a clip dropped on
    // another track; none for a selection through every lane, which moves in each, nor into a locked track
    // under the last, into a new track there ('room'), as a clip dropped under a DAW's tracks
    const L = lanes(), lane = tracks && !allLanes && !drag.out ? trackAt(L, py) : -1
    drag.into = !allLanes && !drag.out && inRoom(py, L) ? 'room' : lane >= 0 && lane !== focus && !tracks?.[lane]?.locked ? lane : null
    root.style.cursor = drag.out ? (drag.carry === 'copy' ? 'copy' : 'grabbing') : 'none'
    const d = drag.b - drag.a, to = free(drag.a + time(px) - time(drag.x)), s = stick(to), e = drag.carry === 'move' && stick(to + d)
    drag.to = Math.max(0, Math.min(drag.carry === 'move' || drag.into != null ? Infinity : duration, s && (!e || s.d <= e.d) ? s.t : e ? e.t - d : to))
    // where it was, silence (moved) or as it is (copied) while it goes to another track
    assign({ pieces: drag.into != null ? drag.carry === 'move' ? arrange('silence', drag.a, drag.b) : null
      : drag.out ? drag.carry === 'move' ? arrange('remove', drag.a, drag.b) : null : arrange(drag.carry, drag.a, drag.b, drag.to) })
    // into another track, drawn there as it will go, over what it covers
    assign({ guest: drag.into != null ? { lane: drag.into, at: drag.to, a: drag.a, b: drag.b, of: focus } : null })
    if (drag.carry === 'move' && !drag.out && drag.into == null) overrun(drag.to + drag.b - drag.a)
    return invalidate()
  }
  // the grip: trimmed back to it, or silence added out to it; else stretched or sped, within a quarter and four times
  // the length (fn/stretch.js)
  else if (drag.stretch) {
    // a press that stays put is a click: it asks how (up)
    if (!drag.moved && Math.abs(px - drag.x) < SLOP) return
    drag.moved = true
    const { a, b } = drag, d = b - a, to = stuck(free(time(px) + drag.offset))
    if (drag.mode === 'trim') { drag.to = Math.max(a, to); assign({ pieces: drag.to < b ? arrange('remove', drag.to, b) : drag.to > b ? arrange('insert', b, b, drag.to) : null }) }
    else { drag.to = Math.max(a + d / 4, Math.min(a + d * 4, to)); assign({ pieces: arrange('stretch', a, b, drag.to) }) }
    overrun(drag.to)
  }
  // the lane's height is 24 dB, in half-dB steps, from −24 to +12
  else if (drag.lift === 'gain') {
    const was = drag.db
    drag.db = Math.max(-24, Math.min(12, +(Math.round((drag.y - py) / drag.rect[3] * 24 / levelStep) * levelStep).toFixed(1)))
    assign({ pieces: arrange('gain', drag.a, drag.b, drag.a, drag.db) })
    // heard at the level it goes to, as a pitch dragged is
    hear(drag, drag.db !== was, { at: drag.a, duration: drag.b - drag.a, gain: drag.db })
  }
  // pitch, ±24 semitones; a note's, a row a semitone (held ⌘, by cents)
  else if (drag.lift === 'pitch') {
    const rows = (drag.y - py) / drag.rows, st = drag.rows ? Math.max(-24, Math.min(24, fine() ? Math.round(rows * 100) / 100 : Math.round(rows))) : glide(drag.y - py, 24), changed = st !== drag.st
    drag.st = st; drag.ratio = 2 ** (st / 12)
    hear(drag, changed, { ...pitchRange(drag), pitch: st })
  }
  // intonation, a factor: up half a lane twice as wide, down half a lane a monotone, by 0.05 (held ⌘, 0.01), 0 to 3
  else if (drag.lift === 'intonation') {
    const k = 1 + (drag.y - py) / (drag.rect[3] / 2), step = fine() ? 100 : 20, was = drag.k
    drag.k = Math.max(0, Math.min(3, Math.round(k * step) / step))
    hear(drag, drag.k !== was, { ...pitchRange(drag), intonation: drag.k })
  }
  // formants, ±12 semitones
  else if (drag.lift === 'formant') {
    const st = glide(drag.y - py, 12), changed = st !== drag.st
    drag.st = st
    hear(drag, changed, { ...pitchRange(drag), formant: st })
  }
  // A fade's corner, dragged: inward, the fade runs from the edge to it; outward, past the edge, the audio out there
  // goes, what is before it crossfading into the range (or the range into what is after). It shows as it goes.
  else if (drag.fade) {
    // a press that stays put is a click: it asks for the curve (up)
    if (!drag.span && Math.abs(px - drag.x) < SLOP) return
    const { a, b } = drag, p = drag.p = clamp(stuck(snap(time(px) + drag.offset))), edge = drag.fade === 'in' ? a : b
    // back where it began, give or take a few pixels: nothing, as it will be let go
    if (Math.abs(x(p) - x(edge)) < SLOP) { drag.span = [edge, edge]; drag.cross = false; assign({ pieces: null }); return invalidate() }
    drag.cross = drag.fade === 'in' ? p < a : p > b
    drag.span = drag.fade === 'in' ? (drag.cross ? [p, a] : [a, Math.min(p, b)]) : (drag.cross ? [b, p] : [Math.max(p, a), b])
    assign({ pieces: drag.span[1] > drag.span[0] ? drag.cross ? crossed(...drag.span) : faded(drag.fade, ...drag.span) : null })
  }
  // silence pulled open at the caret, as far as the pointer goes: the rest waits after it
  else if (drag.gap) { drag.to = Math.max(drag.at, stuck(free(time(px) + drag.offset))); assign({ pieces: drag.to > drag.at ? arrange('insert', drag.at, drag.at, drag.to) : null }); overrun(drag.to) }
  else {
    if (!drag.moved && Math.abs(px - drag.x) < SLOP) return
    // a range starts on the cue its press was by, and its other end goes onto the one it comes near
    if (!drag.moved && !drag.caret) drag.anchor = stuck(drag.anchor)
    drag.moved = true
    if (drag.row && tracks) assign({ allLanes: true })
    drag.hear = stuck(snap(time(px) + drag.offset))
    // a caret dragged with Shift held becomes a range, from where it was pressed, still sounding as it goes
    if (drag.caret && event.shiftKey) { drag.caret = false; drag.anchor = drag.from }
    if (drag.caret) { if (Math.abs(px - drag.x) >= SLOP) drag.still = false; scrub(drag); setCursor(drag.hear) }
    // an edge dragged on past the other one's turns the range over, from that one, as a drag from it would make it;
    // onto it, the caret there
    else if (drag.resizing) {
      select(drag.anchor, drag.hear, band, true, drag.hear)
      if (selection) assign({ anchor: drag.anchor })
      else setCursor(drag.anchor)
      // a box's edge sounds its band
      drag.band = band
      scrub(drag)
    }
    // with Alt, another box beside the one (or ones) there are
    else if (drag.box) {
      const f = snapF(drag.box, py), fs = [Math.min(f, drag.f), Math.max(f, drag.f)]
      if (drag.adding && !drag.started) { drag.started = true; if (selection || more.length) more.push(current()) }
      select(drag.anchor, drag.hear, fs, !!drag.adding, drag.hear)
      drag.band = band
      scrub(drag)
    }
    else if (drag.adding) {
      // the caret or range there was stays beside the new one
      if (!drag.started) { drag.started = true; more.push(current()) }
      select(drag.anchor, drag.hear, null, true, drag.hear)
      assign({ anchor: drag.anchor })
      scrub(drag)
    }
    else { select(drag.anchor, drag.hear, drag.keep ? band : null, !!drag.keep, drag.hear); assign({ anchor: drag.anchor }); scrub(drag) }
  }
  invalidate(pieces === was)
}
// A drag that takes the sound on past its end (audio moved, silence opened or added, a stretch), out at the picture's
// right edge with what it moves (`reach`, the time it takes it to): the view widens to show where it reaches, a frame
// at a time while the pointer stays out there, as a timeline follows a clip dragged off it; so silence opens at the end
// as far as it is pulled. A stretch at its most stops it.
function overrun(reach) {
  const edge = lanesEnd(lanes()) - 8, k = (drag.last[1] - edge) / plot().w, was = end
  if (k <= 0 || x(reach) < edge - 8 || drag.overrun) return
  setRange(start, end + (end - start) * Math.min(.05, k))
  if (end > was) drag.overrun = requestAnimationFrame(() => { if (!drag?.overrun) return; drag.overrun = 0; drags(...drag.last) })
}
// What a press would grab, as the pointer: a handle; held ⌘ (Ctrl), a range's end to set its length, a cue's line;
// the selection's audio (held Alt to copy, ⌘ to move); a marker's triangle in its strip; the gain line or a point on
// it, a voiced stretch of the pitch curve, a range's edge (lit, `hot`) or a caret; held ⌘ or Alt over the lanes, a
// cross, aiming or measuring (⌘ on the spectrogram, a box of time and frequency). Else what a press does: the
// I-beam, a range of time; held Shift, with a chevron the way the selection goes out to it; held Alt, with a plus.
// What it grabs (`grabbing`), or the time row, a right-click leaves as it is (context).
let hot = null, grabbing = false
function hover(px, py, keys = held) {
  assign({ held: keys })
  // the scrollbar's arrow, as a scrollbar's is everywhere
  if (onBar(px, py)) { hot = null; grabbing = false; root.style.cursor = 'default'; return }
  if (onAway(px, py)) { hot = null; grabbing = false; root.style.cursor = 'pointer'; return }
  // the room under the lanes, a new track's caret, as a lane's
  if (liftAt(px, py)) { hot = null; grabbing = true; root.style.cursor = 'default'; return }
  if (inRoom(py)) { hot = null; grabbing = false; root.style.cursor = ''; return }
  // in a band's strip, a marker's triangle to drag; a name, a range or the takes' place, to press; elsewhere there,
  // the band's height to drag (where a selection's tools are not)
  const mark = !gripAt(own(lanes()), px, py) && stripAt(px, py)
  if (mark) { hot = null; grabbing = notch(mark, px) >= 0; root.style.cursor = grabbing ? 'ew-resize' : 'pointer'; return }
  if (footAt(py) != null && !gripAt(own(lanes()), px, py)) { hot = null; grabbing = true; root.style.cursor = 'row-resize'; return }
  // in another track's lane, nothing to take hold of but a selection through every lane: a press there makes it the
  // one edited
  const through = allLanes && selection && !band && px >= x(selection[0]) - EDGE && px <= x(selection[1]) + EDGE
  if (tracks && py <= plot().h && laneAt(lanes(), py) !== focus && !through) { hot = null; grabbing = false; root.style.cursor = ''; return }
  const L = own(lanes()), rect = (show.gain || pitchLine()) && lineLanes(L).find(r => inside(r, px, py)), spectral = L.spec.some(r => inside(r, px, py)) && editing(keys)
  const aim = (editing(keys) || keys.altKey) && L.all.some(r => inside(r, px, py))
  const tone = pitchLine() && contour?.f0.length && pitchLanes(L).find(r => inside(r, px, py))
  const handle = gripAt(L, px, py)?.[0], end = !handle && editing(keys) && py <= floor() && edgeAt(px)?.edge === 1
  const cue = !handle && !end && show.hits && nearCue(px, py, keys) >= 0
  const note = !handle && !end && !cue && !keys.shiftKey && !keys.altKey && L.notes.some(r => inside(r, px, py) && noteAt(r, px, py))
  const within = selection && !band && py <= floor() && px > x(selection[0]) + EDGE && px < x(selection[1]) - EDGE && !caretAt(px, py) && !thirdAt(px, py)
  const other = handle ? gripPointer(handle)
    : end ? gripPointer('stretch')
    : cue ? 'col-resize'
    : note ? 'ns-resize'
    : within ? keys.altKey ? 'copy' : 'grab'
    : rect && onLine(rect, px, py) && pointAt(rect, px, py) >= 0 || tone && (pointOn(tone, px, py) >= 0 || knotOn(tone, px, py) != null) ? 'move'
    : tone && pitchDown(px, py, L) || rect && onLine(rect, px, py) ? 'ns-resize' : null
  // Shift or Alt held, a press sums or adds wherever it is, an edge's or a caret's line too
  const plain = !keys.shiftKey && !keys.altKey, caret = plain && caretAt(px, py)
  hot = end || other == null && !spectral && plain && py <= floor() ? edgeAt(px) : null
  grabbing = other != null || !!hot || !!caret
  root.style.cursor = other ?? (keys.shiftKey && !keys.altKey ? EXTEND[time(px) < origin() ? 1 : 0] : grabbing ? 'ew-resize' : plain && markAt(px, py) != null ? 'pointer' : aim ? 'crosshair' : keys.altKey ? ADD : '')
}
// (a touch leaves as it lifts: the bar it scrolled by stays its LINGER)
function leave(event) { assign({ hovered: null }); hot = null; if (event.pointerType !== 'touch') assign({ reached: -Infinity }); invalidate(true) }
function up(event) {
  pointers.delete(event.pointerId)
  const d = drag
  drag = null
  if (d?.locked && document.pointerLockElement === root) document.exitPointerLock()
  clearTimeout(d?.hold)
  if (d?.overrun) cancelAnimationFrame(d.overrun)
  if (d?.pinch) { if (pointers.size) drag = d; return }
  if (!d) return
  if (d.lifting) return invalidate(true)
  if (d.preview) { onaudition(null); return invalidate(true) }
  if (d.foot != null) { onheight(Object.fromEntries((d.all ? bands() : [d.foot]).map(n => [n, tallOf(n)]))); hover(...local(event), event); return invalidate(true) }
  if (d.marker != null) {
    // a range's ends let go on each other, a moment there; a moment pulled apart, a range
    const m = markers[d.marker], length = d.end - d.to
    if (d.moved && (Math.abs(d.to - m.time) > 1e-6 || Math.abs(length - (m.duration ?? 0)) > 1e-6)) {
      assign({ markers: markers.with(d.marker, { ...m, time: d.to, duration: length || undefined }) })
      onedit('remark', { time: m.time, duration: m.duration, track: m.track, to: d.to, ...(length || m.duration) && { d: length } })
    }
    else if (!d.moved) { select(0, 0); setCursor(d.edge ? m.time + m.duration : m.time) }
    assign({ chosen: markers[d.marker] })
  }
  else if (d.cue != null) {
    // the cue sits where it was dropped at once, so a next drag before the output returns pins its neighbours right
    const from = cues[d.cue]
    if (!d.moved) { select(0, 0); setCursor(from) }
    else if (Math.abs(d.to - from) > 1e-4) { assign({ cues: cues.with(d.cue, d.to) }); assign({ ahead: true }); onedit('warp', { from, to: d.to, prev: d.prev, next: d.next }) }
  }
  // the pitch curve moved, or clicked: the whole pitch line moved, or a point of it there
  else if (d.run) { onaudition(null); if (!d.moved) onedit('pitchline', curveOf(tapped(d))); else if (d.st) onedit('pitchline', curveOf(d.points)) }
  else if (d.points) { if (d.line === 'pitchline') onaudition(null); if ((!d.tone || d.moved) && JSON.stringify(d.points) !== d.before) onedit(d.line, curveOf(d.points)) }
  // a drag that moved audio: the picture keeps the pieces where they went until the output comes (set, stream)
  else if (d.carry) {
    const length = d.b - d.a
    if (!d.moved) { const t = snap(time(local(event)[0])); if (d.alt) addCaret(t); else { select(0, 0); setCursor(t) } }
    else if (d.out) { if (!onedit('tab', { at: d.a, duration: length, copy: d.carry === 'copy' })) assign({ pieces: null }); else if (d.carry === 'move') { select(0, 0); setCursor(d.a) } }
    // into another track: that one edited then (onedit made it so), the piece selected where it landed in it; what it
    // left and where it went drawn so at once, both frozen, till the output comes
    else if (d.into != null) {
      const from = focus
      if (!onedit('carry', { at: d.a, duration: length, to: d.to, copy: d.carry === 'copy', into: d.into === 'room' ? 'new' : d.into })) { assign({ guest: null, pieces: null }); return invalidate() }
      if (pieces) pieces.lane = from
      freeze([...d.carry === 'move' ? [{ lane: from, a: d.a, b: d.b }] : [], { lane: d.into, a: d.to, b: d.to + length }])
      select(d.to, d.to + length)
    }
    else if (Math.abs(d.to - d.a) < 1e-9 || !onedit('carry', { at: d.a, duration: length, to: d.to, copy: d.carry === 'copy' })) assign({ pieces: null })
    // in its own lane: what it moves frozen till the output comes (a copy put in, all after it)
    else { freeze([{ lane: own0(), a: d.carry === 'copy' ? d.to : Math.min(d.a, d.to), b: d.carry === 'copy' ? d.to + length : Math.max(d.b, d.to + length) }]); select(d.to, d.to + length, null, true) }
  }
  else if ((d.stretch || d.pill) && !d.moved) { if (d.stretch && !d.end) onmode('grip'); else if (d.tool === 'pitch') onmode('pitch') }
  else if (d.stretch && d.mode === 'trim') {
    if (Math.abs(d.to - d.b) < 1e-9 || !onedit('trim', { at: d.a, end: d.b, to: d.to })) assign({ pieces: null })
    else { freeze([{ lane: own0(), a: Math.min(d.b, d.to), b: Math.max(d.b, d.to) }]); d.to > d.a ? select(d.a, d.to, null, true) : (select(0, 0), setCursor(d.a)) }
  }
  else if (d.stretch) {
    const factor = (d.to - d.a) / (d.b - d.a)
    if (Math.abs(factor - 1) < 1e-3 || !onedit('stretch', { at: d.a, duration: d.b - d.a, factor, speed: d.mode === 'speed' })) assign({ pieces: null })
    else { freeze([{ lane: own0(), a: d.a, b: d.to }]); select(d.a, d.to, null, true) }
  }
  else if (d.lift === 'gain') { onaudition(null); if (!d.db || !onedit('lift', { range: [d.a, d.b], db: d.db })) assign({ pieces: null }) }
  // the selection's pitch, intonation or formants: its pitch curve shown as the edit leaves it until the output it
  // makes is measured
  else if (d.lift === 'pitch' || d.lift === 'intonation' || d.lift === 'formant') {
    onaudition(null)
    const range = pitchRange(d), made = d.lift === 'pitch' ? d.st && onedit('pitch', { ...range, semitones: d.st, edges: d.edges }) : d.lift === 'intonation' ? d.k !== 1 && onedit('intonation', { ...range, factor: d.k }) : d.st && onedit('formant', { ...range, semitones: d.st })
    if (made && d.lift !== 'formant') assign({ landed: d })
  }
  else if (d.fade && !d.span) onmode('curve')
  // let go where it was pressed, give or take a few pixels: nothing
  else if (d.fade && Math.abs(x(d.p) - x(d.fade === 'in' ? d.a : d.b)) < SLOP) assign({ pieces: null })
  else if (d.fade && d.cross) {
    const [p, q] = d.span, length = q - p
    if (!(length > 0 && onedit('crossfade', { at: p, duration: length }))) assign({ pieces: null })
    else { freeze([{ lane: own0(), a: d.fade === 'in' ? p - length : p, b: d.fade === 'in' ? p : p + length }]); if (d.fade === 'in') select(d.a - length, d.b - length, null, true) }
  }
  else if (d.fade) { if (!(d.span[1] > d.span[0] && onedit('fade', { kind: d.fade, from: d.span[0], to: d.span[1], curve: fadeCurve }))) assign({ pieces: null }) }
  else if (d.gap) { if (!(d.to > d.at && onedit('insert', { at: d.at, duration: d.to - d.at }))) assign({ pieces: null }); else freeze([{ lane: own0(), a: d.at, b: d.to }]) }
  // (Alt's caret put down as it was pressed: placed)
  else if (d.adding && !d.moved) { if (!d.placed) addCaret(d.anchor) }
  else if (d.caret && d.still && (selection || more.length)) { assign({ band: null, selection: null }); assign({ more: [] }); told() }
  // a click on the time row moves the caret alone, as a ruler's does
  else if (!d.moved && (selection || more.length) && !d.keep && !d.row) { assign({ selection: null }); assign({ band: null }); assign({ more: [] }); told() }
  // the moment under it falls silent once what the press did is done: playback, paused for it, goes on from there
  if (d.scrubbing) { d.scrubbing = false; onscrub(null) }
  // the pointer back, as what is under it would have it
  hover(...local(event), event)
  invalidate()
}
// Clicks counted: a click on a marker's name, or a double-click on its place, names it; a double-click takes away the
// line's point under it (the pitch line's on the pitch curve too), or selects between the cues around it (or the
// pause it is in); a triple-click, the sound between the pauses either side
function clicked(event) {
  // a marker's name in its strip clicked, or its place double-clicked: named where its name is (the takes' place,
  // its press alone)
  const mark = !gripAt(own(lanes()), ...local(event)) && stripAt(...local(event))
  if (mark) return mark.kind === 'mark' && (event.detail === 2 || labelAt(...local(event)) === mark.i) && rename(mark.i)
  // a band's foot double-clicked: its height as it was made (with Alt, every band's)
  const foot = footAt(local(event)[1])
  if (foot != null && !gripAt(own(lanes()), ...local(event))) { if (event.detail === 2) { const names = event.altKey ? bands() : [foot], h = { ...heights }; for (const n of names) delete h[n]; assign({ heights: h }); onheight(Object.fromEntries(names.map(n => [n, null]))); invalidate() } return }
  // in the room under the lanes, or a locked track's lane, nothing more than a press does
  if (duration && !event.button && (inRoom(local(event)[1]) || lockedAt(local(event)[1]))) return
  if (!duration || event.detail < 2 || event.button > 0) return
  const [px, py] = local(event), L = own(lanes()), rect = (pitchLine() || show.gain) && lineLanes(L).find(r => inside(r, px, py))
  const tone = pitchLine() && contour?.f0.length && pitchLanes(L).find(r => inside(r, px, py))
  if (event.detail === 2 && (rect || tone) && (pitchLine() ? shift : envelope)) {
    const pts = linePoints(), i = rect ? pointAt(rect, px, py) : pointOn(tone, px, py)
    if (i >= 0) { pts.splice(i, 1); onedit(pitchLine() ? 'pitchline' : 'envelope', curveOf(pts)); return }
  }
  if (py > plot().h || px > plot().w) return
  if (event.detail === 2) doubled = { at: performance.now(), px, py }
  around(event.detail === 2 ? 'fragment' : 'sound', clamp(time(px)), event.altKey ? 'add' : event.shiftKey ? 'extend' : null)
}
// A double-click's time and place: a press there within half a second (an OS's double-click time, macOS's and
// Windows' 0.5 s by default) is a triple-click's third, never a drag of the audio the double one selected, which its
// pointer would offer (a hand) as the selection came under it
let doubled = null
const again = (m, px, py) => !!m && performance.now() - m.at < 500 && Math.abs(px - m.px) < 4 && Math.abs(py - m.py) < 4
const thirdAt = (px, py) => again(doubled, px, py)
// Shift pressed, what was selected before its clicks began (or the caret): a double- or triple-click with Shift
// extends that to the fragment or the sound, as in a text Shift and a double-click extend by words, the first click's
// own extending (to its press) let go
let before = null
// What a double- or triple-click takes at t: within a pause, the pause; else, double, the fragment between the cues
// either side (a sound's start or end, a hit, a marker); triple, the sound between the pause before and the one after,
// its edges where the cues have them. With Alt, another range beside those there are (the carets its clicks left gone);
// with Shift, what was selected (or the caret) as the clicks began, out to take it in too (`before`).
function around(kind, t = cursor, how = null) {
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
function stepTo(kind, dir, extend = false) {
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
function wheel(event) {
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
function select(a, b, f = null, keep = false, head = null) {
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
function told() {
  if (!selection && !more.some(r => r[1] > r[0])) assign({ allLanes: false })
  onselect(selection, band, ranges(), boxes())
}
// Every range selected, in time order; every caret, the one there is when nothing is selected and those beside it
const ranges = () => band ? [selection] : [...selection ? [selection] : [], ...more.filter(r => r.length === 2 && r[1] > r[0])].sort((p, q) => p[0] - q[0])
const carets = () => [...(selection ? [] : [cursor]), ...more.filter(r => r.length === 2 && r[0] === r[1]).map(([p]) => p)].sort((p, q) => p - q)
// every box selected on the spectrogram, [a, b, low, high] each, in time order
const boxes = () => [...band ? [[...selection, ...band]] : [], ...more.filter(r => r.length === 4)].sort((p, q) => p[0] - q[0])
// Another caret, as a text editor's (Alt and a click), the one gestures act on now (Shift extends it), what there was
// beside it; one there already goes
function addCaret(t) {
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
function addNext() {
  if (!selection || band) return
  const [a, b] = selection, last = Math.max(...ranges().map(r => r[1])), gaps = pauses(), list = edges('fragment')
  const near = (p, q) => Math.abs(p - q) < .03, on = t => list.some(c => Math.abs(c - t) < 1e-3)
  const next = gaps.some(([p, q]) => near(p, a) && near(q, b)) ? gaps.find(([p]) => p >= last - 1e-6)
    : on(a) && on(b) ? (() => { const i = list.findIndex(c => c >= last - 1e-3); return i >= 0 && i < list.length - 1 ? [list[i], list[i + 1]] : null })()
    : (() => { const g = gaps.find(([p]) => p > last + .03); if (!g) return null; const after = gaps.find(([p]) => p > g[1] + 1e-6); return [g[1], after ? after[0] : duration] })()
  if (next && next[1] > next[0]) { add(...next); reveal(next[1]) }
}
function setCursor(t) { assign({ chosen: null }); assign({ cursor: clamp(t) }); oncursor(cursor); invalidate(true) }
// A right-click, as in a text: outside what is selected it takes the caret there first, the selection gone; inside it,
// with several carets, or on what a press would grab (a caret, an edge, a handle: the pointer says so), all stays.
// Then the page's menu for it (`oncontext`), at the pointer
function context(event) {
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
function key(event) {
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
// Every lane's waveform the screen's colour, a track's as a channel's, or coloured as its look has it (drawWave); a
// sound's channels in one lane each its own hue
function lay(n) {
  while (waves.length > n) waves.pop().destroy()
  while (specs.length > n) specs.pop().destroy()
  for (let i = 0; i < n; i++) {
    hues[i] = !tracks && waveLook.lanes === 'one' && n > 1 ? channel(i, n) : rgba(color('--color-screen-wave'))
    waves[i] ||= new Waveform(gl)
    if (sgl) (specs[i] ||= new Spectrogram(sgl, { ...look })).update({ background: color('--color-screen'), color: shades() })
  }
}
// The samples [i0, i1) where two outputs of one length differ, in any channel; [0, 0] where none do
function changed(was, now) {
  let i0 = Infinity, i1 = 0
  now.forEach((y, c) => {
    const x = was[c]
    let a = 0, b = y.length
    while (a < b && x[a] === y[a]) a++
    if (a === b) return
    while (b > a && x[b - 1] === y[b - 1]) b--
    i0 = Math.min(i0, a); i1 = Math.max(i1, b)
  })
  return i1 > 0 ? [i0, i1] : [0, 0]
}
// Each channel's samples for its pictures: the whole output, or none yet of one arriving
const fill = channels => { tints.clear(); channels.forEach((data, i) => { waves[i].update({ data }); specs[i]?.update({ data, sampleRate: rate, levels: null }) }) }
// After new samples: the levels again, the selection and the caret within them, and the range kept where it still fits;
// for an output an edit here drew ahead (`stay`), even where the sound now ends before it, unless none of it is left
function renew(all) {
  assign({ leveled: false })
  if (!duration) { assign({ band: null, selection: null }); assign({ more: [] }); assign({ cursor: 0 }); assign({ start: 0 }); assign({ end: RECORD }); invalidate(); return }
  if (selection) assign({ selection: [Math.min(selection[0], duration), Math.min(selection[1], duration)] })
  if (selection && selection[1] - selection[0] <= 0) assign({ band: null, selection: null })
  assign({ more: more.map(([a, b, ...f]) => [Math.min(a, duration), Math.min(b, duration), ...f]).filter(([a, b]) => b > a || a === b && b < duration) })
  assign({ cursor: Math.min(cursor, duration) })
  if (all || end - start <= 0) fitTo(0, duration)
  // a sound arriving, its length not known yet, is kept within it once it is (finish)
  else if (!(arriving && arriving.total == null) && (start >= duration || !stay && seenTo() > duration + 1e-9)) { const a = duration - (seenTo() - start); setRange(a, a + end - start) }
  else invalidate()
}
// A paste: at the carets ⌘V was pressed at, the system's clipboard with it (a file copied elsewhere comes so); one
// ⌘V no paste follows by its key's release (a browser that pastes only where text is written), from the editor's own
// clipboard. WebKit pastes where nothing is written once its beforepaste is taken
const atCarets = () => (carets().length ? carets() : [cursor]).map(t => [t, t])
let pasting = null
const pasted = data => { if (pasting) onedit('paste', pasting, data); pasting = null }
// The modifiers, wherever the focus is: what a press would do shows at once, before the pointer moves
const modifier = event => {
  if (!['Meta', 'Control', 'Alt', 'Shift'].includes(event.key)) return
  assign({ held: event })
  if (drag?.foot != null && drag.all !== event.altKey) { drag.all = event.altKey; resized() }
  if (hovered && !drag) hover(...hovered, event)
  // pressed or let go during a drag, as though the pointer moved: a range on the spectrogram may become a box
  if (drag?.raw && !drag.pinch) { const keys = { pointerType: drag.last[0].pointerType, metaKey: event.metaKey, ctrlKey: event.ctrlKey, altKey: event.altKey, shiftKey: event.shiftKey }; drags(keys, ...aimed(keys, ...drag.raw)) }
  invalidate(true)
}
// A new output in place of the one shown. One an edit here drew ahead (`pieces`) takes its place without a move: the
// view where it was, at its scale, the cues and markers where the edit took them. Another shows all of it where all
// of the last showed; zoomed out past its end, the room on its right, at the same scale, while it fits there (a
// reload, an edit that shortens it); its cues go if its length changed (they were the last one's), until its own
// come, unless the view moved them to where they are in it (a cue dragged, `ahead`).
// What has arrived grown to `n` samples: past what was expected, or with nothing expected, as long as what has come;
// all of it shown as it grows, unless the view was zoomed in meanwhile
function grown(n) {
  arriving.length = Math.max(arriving.length, n)
  const all = arriving.fit && whole()
  if (arriving.length / rate > duration) assign({ duration: arriving.length / rate })
  if (all) fitTo(0, duration)
  else invalidate()
}
let stay = false
function replace(total) {
  const seen = seenTo(), roomy = seen > duration + 1e-9 && total != null && total <= seen
  const expected = stay = !!pieces, all = !duration || !expected && whole() && !roomy
  if (expected) {
    // the cues where the edit took them, each as plain as it was
    const kept = (cues ?? []).flatMap(t => moved(t) == null ? [] : [[t, moved(t)]])
    cues && assign({ cues: kept.map(([, m]) => m) })
    assign({ ranks: new Map(kept.map(([t, m]) => [m, ranks.get(t)])) })
    assign({ markers: markers.map(m => ({ ...m, time: placed(m) })).filter(m => m.time != null) })
  }
  else if (!ahead && total != null && Math.abs(total - duration) > 1e-9) assign({ cues: null })
  assign({ ahead: false })
  // an edit still being dragged keeps what it draws: the output arriving is an older one, from before the drag, and
  // the next move of the pointer lays the pieces out again over it
  if (!drag) { assign({ guest: null, pieces: null }); freeze([]) }
  return all
}

export default function view(root, { onaxis = () => {}, onselect = () => {}, oncursor = () => {}, onedit = () => {}, onmode = () => {}, onscrub = () => {}, oncontext = () => {}, onaudition = () => {}, onfocus = () => {}, ontake = () => {}, onfork = () => {}, onghost = () => {}, onlayout = () => {}, onheight = () => {}, onlook = () => {}, onbusy = () => {}, onprobe = () => {}, onsamples = null, onheard = null, hint = null, keepRoom = true, zoom: { in: closest = 32, out: farthest = 4 / 3 } = {}, overshoot = .5, timeRow = 'foot' } = {}) {
  mount(root, { onaxis, onselect, oncursor, onedit, onmode, onscrub, oncontext, onaudition, onfocus, ontake, onfork, onghost, onlayout, onheight, onlook, onbusy, onprobe, onsamples, onheard, hint, keepRoom, closest, farthest, overshoot, timeRow })
  root.tabIndex = 0
  root.addEventListener('pointerdown', down)
  root.addEventListener('pointermove', move)
  root.addEventListener('pointerup', up)
  root.addEventListener('pointercancel', up)
  root.addEventListener('pointerleave', leave)
  root.addEventListener('wheel', wheel, { passive: false })
  root.addEventListener('click', clicked)
  root.addEventListener('contextmenu', context)
  root.addEventListener('keydown', key)
  root.addEventListener('beforepaste', e => e.preventDefault())
  root.addEventListener('paste', e => { e.preventDefault(); pasting ??= atCarets(); pasted(e.clipboardData) })
  root.addEventListener('keyup', () => pasted())
  // the selection's colours follow the focus
  for (const type of ['focusin', 'focusout']) root.addEventListener(type, () => invalidate(true))
  addEventListener('focus', () => invalidate(true))
  addEventListener('keydown', modifier)
  addEventListener('keyup', modifier)
  addEventListener('blur', () => { assign({ held: {} }); if (hovered && !drag) hover(...hovered, held); invalidate(true) })
  new ResizeObserver(resize).observe(root)
  return {
    // New output in place of the one shown (put), in one step with all that is drawn of it: where the waveform is
    // weighted, its twins weighed first (onheard), the picture as it was meanwhile (an edit drawn ahead too), so no frame
    // shows the last output's levels over the new samples, nor none (unweighted) before its own come
    set(channels, sampleRate) {
      const kind = waveLook.weighting, ask = assign({ asking: asking + 1 })
      if (kind === 'none' || !onheard || !twinOf.size || !channels?.length) return put(channels, sampleRate)
      Promise.resolve(onheard(kind)).catch(() => null).then(leaves => { if (ask === asking) put(channels, sampleRate, leaves) })
    },

    // A sound longer than the page holds, in place of the one shown: drawn from its picture, each channel's `leaves`
    // (gl-waveform's peaks) and `spectra` ({ size, hop, levels }, gl-spectrogram's), `length` samples at `sampleRate`;
    // its samples come where it is zoomed in (want)
    summary(leaves, length, sampleRate, spectra) {
      assign({ asking: asking + 1 })
      const all = replace(length / (sampleRate || rate))
      assign({ arriving: null })
      ended()
      assign({ count: leaves.length }); assign({ rate: sampleRate || rate })
      assign({ duration: length / rate })
      lay(count)
      assign({ windows: new Map() }); assign({ windowsOf: windowsOf + 1 })
      unheard()
      fill(assign({ data: waves.map(() => new Float32Array(0)) }))
      assign({ data: [] })
      leaves.forEach((l, i) => waves[i].peaks(l, 0))
      assign({ leavesOf: leaves })
      if (spectra) specs.forEach((sg, i) => sg.spectra(spectra.levels[i], { size: spectra.size, hop: spectra.hop, length }))
      renew(all)
    },
    // A file held over the picture (a drag's event, or null when it leaves): where it would go in, the time under the
    // pointer, onto a cue or marker near it as a dragged caret goes; that time, or null
    dropAt(event) {
      assign({ dropped: event && duration ? stuck(snap(clamp(time(local(event)[0])))) : null })
      assign({ droppedNew: dropped != null && inRoom(local(event)[1]) })
      invalidate(true)
      return dropped
    },
    // whether a file held over the picture is over the room under the lanes: a new track's, where it is let go
    get dropsNew() { return droppedNew },
    // Samples of an output arriving as long as the one shown, from `at`: drawn where they differ from what shows, the
    // rest left as it is, so an edit's output comes in where it changes as it renders, nothing else drawn again. Not
    // where the waveform is weighted: its twins, the last output's, would draw its levels over the new samples; the
    // output comes whole then, with its own (set)
    patch(at, channels) {
      if (arriving || windows || twinOf.size || channels.length !== data.length) return
      channels.forEach((y, c) => {
        const x = data[c]
        let a = 0, b = Math.min(y.length, x.length - at)
        while (a < b && x[at + a] === y[a]) a++
        if (a === b) return
        while (b > a && x[at + b - 1] === y[b - 1]) b--
        waves[c].set(y.subarray(a, b), at + a)
        specs[c]?.set(y.subarray(a, b), at + a)
      })
      tints.clear()
      unheard(true)
      invalidate()
    },
    // An output as it arrives: stream() starts it, `total` samples long where that is known, else as long as what has
    // come, `dim` while it is the file arriving, not yet the output; append() adds each piece; finish() ends it, its
    // length what came. A new file shows all of it; an output in place of the one shown keeps the view where it is
    // (zoomed in, it stays zoomed in), and that output's length until its own is known. `keep`: the view stays where it
    // is, a new file too (one coming into the view as it was left)
    stream({ sampleRate, channels, total = null, dim = false, keep = false }) {
      assign({ asking: asking + 1 })
      untrack()
      const all = (replace(total == null ? null : total / (sampleRate || rate)) || dim) && !keep
      ended()
      assign({ count: channels }); assign({ rate: sampleRate || rate })
      assign({ arriving: { total, length: 0, dim, fit: all } })
      assign({ duration: total ? total / rate : all ? 0 : duration })
      lay(count)
      assign({ windows: null }); assign({ windowsOf: windowsOf + 1 }); assign({ leavesOf: null })
      unheard()
      fill(waves.map(() => new Float32Array(0)))
      assign({ data: [] })
      if (dim) { assign({ band: null, selection: null }); assign({ more: [] }) }
      renew(all)
    },
    append(channels) {
      if (!arriving) return
      channels.forEach((data, i) => { waves[i]?.push(data); specs[i]?.push(data) })
      grown(arriving.length + channels[0].length)
    },
    // A long sound's picture as it arrives: each channel's leaves from sample `at`, and its spectra ({ size, hop, at,
    // levels }: from their column `at`)
    peaks(at, leaves, spectra) {
      if (!arriving) return
      leaves.forEach((l, i) => waves[i]?.peaks(l, at))
      if (spectra) specs.forEach((sg, i) => sg.spectra(spectra.levels[i], spectra))
      const n = leaves[0].length / 4
      if (n) grown(at + (n - 1) * 256 + (leaves[0][4 * n - 1] || 256))
    },
    finish() {
      if (!arriving) return
      const all = arriving.fit && whole()
      assign({ duration: arriving.length / rate })
      assign({ arriving: null })
      lay(count)
      renew(all)
    },

    // A take recorded over the output from `at` s, drawn as it comes (take), grown by each block of channels (grow), and
    // drawn until the output that holds it arrives (set, stream); take(null) drops it at once
    take(opts) {
      assign({ asking: asking + 1 })
      ended()
      if (!opts) { assign({ pieces: null }); return invalidate() }
      const { at, sampleRate, channels } = opts
      // into nothing: its lanes, and the scale a take is watched at, full scale (±1) as a recording app's, held still as
      // it comes. Over a sound, the sound's
      if (!duration) { untrack(); assign({ count: channels }); assign({ rate: sampleRate }); lay(count); assign({ start: at }); assign({ end: at + RECORD }); assign({ aview: [-1, 1] }) }
      assign({ recording: { at, lead: 0, rate: sampleRate, length: 0, total: duration, data: Array.from({ length: channels }, () => new Float32Array(sampleRate)),
        waves: Array.from({ length: channels }, () => new Waveform(gl)),
        specs: sgl ? Array.from({ length: channels }, () => new Spectrogram(sgl, { background: color('--color-screen'), ...look, color: shades(), sampleRate })) : [] } })
      assign({ leveled: false })
      taking()
    },
    // A long take (past HELD samples a channel) is held as a long sound is: its samples let go behind the last HELD, the
    // waveform keeping its peaks there; its colours the waveform's own
    grow(blocks) {
      if (!recording) return
      const n = recording.length, m = blocks[0]?.length ?? 0
      if (m && n + m > HELD) recording.data = null
      if (m && recording.data) recording.data = recording.data.map((x, c) => {
        if (n + m > x.length) { const y = new Float32Array(Math.max(2 * x.length, n + m)); y.set(x.subarray(0, n)); x = y }
        x.set(blocks[c] ?? blocks[0], n)
        return x
      })
      if (m) for (const list of [recording.waves, recording.specs]) list.forEach((picture, c) => picture.push(blocks[c] ?? blocks[0]))
      // the chunk the last HELD has just left behind, whole
      const gone = Math.floor((n + m - HELD) / CHUNK)
      if (m && gone > Math.floor((n - HELD) / CHUNK) && gone > 0) for (const p of [...recording.waves, ...recording.specs]) p.drop((gone - 1) * CHUNK, gone * CHUNK)
      recording.length += m
      assign({ leveled: false })
      taking()
    },
    // The take lined up with what played as it was recorded (editor.js aligned): from `at` s, its first `lead` samples
    // left out, as its output will have it, so the take drawn as it comes is the take drawn once it is done
    align(at, lead) {
      if (!recording || recording.at === at && recording.lead === lead) return
      Object.assign(recording, { at, lead })
      taking()
    },
    get duration() { return duration },
    // The tracks the lanes are, [{ name, end, muted }] (set before their sound, set() or summary(): a lane each, its
    // channels averaged), or null; the one edited, by its lane. A sound streaming in is no tracks'
    set tracks(list) {
      reshow(() => {
        assign({ tracks: list?.length ? list : null })
        assign({ focus: Math.min(focus, (tracks?.length ?? 1) - 1) })
      })
      if (tracks) root.dataset.tracks = tracks.length
      else delete root.dataset.tracks
      lay(count)
      layout(lanes())
      invalidate()
    },
    get tracks() { return tracks },
    // the caret in the room, a new track's to be (haunt); let go, back in the edited track
    get ghost() { return ghost },
    // each band's height by its name (a track's, '' for a sound), as its foot was dragged (onheight)
    set heights(h) { assign({ heights: { ...h } }); layout(lanes()); invalidate() },
    set ghost(on) { if (!on) unghost() },
    get focus() { return focus },
    // (the bands laid out anew at once, the layers with them)
    set focus(i) { assign({ focus: Math.max(0, i) }); layout(lanes()); invalidate() },
    // the whole output's samples, once an output drawn as it arrived has all come: what its colours are read from, its
    // levels as heard weighed again
    set samples(channels) { assign({ data: channels || [] }); tints.clear(); unheard(true); invalidate() },
    // the colours a colormap gives the waveform, low to high, `n` of them as CSS colours: its previews
    tones: (map, n = 9) => tonesOf(map, n).tones.map(([r, g, b, a]) => `rgb(${[r, g, b].map(v => Math.round(v * 255)).join(' ')} / ${+a.toFixed(3)})`),
    // how the waveform draws: { colour, lanes, fill, map, weighting } (waveLook); weighed another way, weighed again
    set waveform(o) { const was = waveLook.weighting; assign({ waveLook: { ...waveLook, ...o } }); if (waveLook.weighting !== was) unheard(); lay(count); assign({ palette: null }); invalidate() },
    // an edit drawn ahead of its output: the output waits whole to take its place
    get expecting() { return !!pieces },
    get range() { return [start, end] },
    // What shows, as a tab keeps it and the page restores it: the time, the frequencies, the levels; none without a sound.
    // Set, it shows that again, within the sound as it is now
    // Set while the sound arrives, it shows that at once, the sound coming into it, its length not yet known: what arrives
    // no longer fits the view, and the view moves only as it is moved (finish() keeps it within the sound)
    // With it, the sound's shape, to lay the lanes out as they were before any of it comes: its length, rate, channels.
    // `seen`, the time the lanes showed up to, what the view comes back to, whatever the axis beside them is as wide as
    // then (its labels in a theme's font, say): all of the sound shown, all of it again; `range` alone, the plot's
    get frame() { return duration || arriving ? { range: [start, end], seen: seenTo(), freqs: [...fview], levels: [...aview], duration, rate, channels: count } : null },
    set frame(f) {
      const ok = p => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite) && p[1] > p[0]
      if (!f || !duration && !arriving) return
      if (ok(f.freqs)) setFreqs(...f.freqs)
      if (ok(f.levels)) scrollLevels(f.levels[0], Math.max(2e-3, Math.min(8, f.levels[1] - f.levels[0])))
      if (!ok(f.range)) return
      const [a] = f.range, b = Number.isFinite(f.seen) && f.seen > a ? a + (f.seen - a) / reach() : f.range[1]
      if (!arriving) return setRange(a, b, true)
      arriving.fit = false
      assign({ start: Math.max(0, a) }); assign({ end: Math.max(start + 32 / rate, b) })
      invalidate()
    },
    // What is selected, whole, as the history keeps it beside a step: the selection, its band, the others beside it,
    // the caret, where the selection was begun; set, all of it back as it was
    get state() { return { selection: selection && [...selection], band: band && [...band], more: more.map(r => [...r]), cursor, anchor, across: allLanes } },
    set state(s) {
      assign({ cursor: s.cursor, anchor: s.anchor })
      assign({ selection: s.selection && [...s.selection] }); assign({ band: s.band && [...s.band] }); assign({ more: s.more.map(r => [...r]) }); assign({ allLanes: !!s.across })
      if (!selection) oncursor(cursor)
      told()
      invalidate()
    },
    get selection() { return selection },
    get band() { return band },
    get cursor() { return cursor },
    // the time the pointer rounds to at this zoom, which the script's numbers keep
    get unit() { return unit() },
    get display() { return display },
    set display(mode) { reshow(() => { assign({ display: mode }) }) },
    // what each track shows, by its name, as chosen for it ('wave' or 'spec'); the others, the picture's
    set kinds(k) { reshow(() => { assign({ kinds: { ...k } }) }) },
    get scale() { return scale },
    set scale(name) { setScale(name) },
    // what shows besides the sound (hits, gain, guides), as the View menu has it, and the meters, as each look's options
    // have them (`meters` the waveform's level, `spectrum` the spectrogram's); with the meters, the spectrogram fades out
    // before its spectrum (repl.css), and the lanes end before them: all of the sound shown stays shown
    set show(flags) {
      const L = lanes(), was = metered(L)
      assign({ show: { ...flags } })
      if (metered(L) !== was && !recording && duration && whole()) fitTo(0, duration)
      invalidate()
    },
    // whether a dragged or pressed time goes onto a cue or marker near it; the curve the fade corners draw and make
    set snapping(on) { assign({ snapping: on }) },
    set fadeCurve(name) { assign({ fadeCurve: CURVES[name] ? name : 'linear' }); invalidate(true) },
    set units(name) { assign({ units: name }); invalidate(true) },
    // how the time row marks time: 'labels', 'ticks', 'none'
    set ruler(mode) { assign({ ruler: mode }); invalidate(true) },
    // what scrolls the view: 'bar', 'hover' or 'overview'
    set scroll(mode) { assign({ scroll: ['hover', 'overview'].includes(mode) ? mode : 'bar' }); invalidate() },
    // how the lanes are ruled: 'marks', 'crosses', 'dots', 'lines', 'none'
    set grid(name) { assign({ grid: name }); invalidate(true) },
    // the steps, dB, a selection's level goes in as its pill is dragged
    set levelStep(db) { assign({ levelStep: +db || 1 }) },
    // how the spectrogram draws: { map, gamma, depth, size } (repl.js spectrogram settings), as gl-spectrogram takes them
    set spectrogram(o) { assign({ look: o }); assign({ shaded: null, palette: null }); for (const sg of [...specs, ...recording?.specs ?? []]) sg.update({ ...look, color: shades() }); assign({ leveled: false }); invalidate() },
    // the skin changed (a theme worn, theme.js): every colour read from it read again, the pictures drawn again in them
    restyle() {
      assign({ map: null, shaded: null, palette: null }); assign({ ruled: '' })
      lay(count)
      for (const sg of recording?.specs ?? []) sg.update({ background: color('--color-screen'), color: shades() })
      invalidate()
    },
    // how the level axis writes levels: 'db' or 'linear'
    set levels(name) { assign({ levelUnits: name === 'linear' ? 'linear' : 'db' }); invalidate(true) },
    // what the meters read now: { levels: [{ rms, peak }], spectra: [dB per bin], size, rate }, or null
    set meters(m) { assign({ meters: m }); invalidate(true) },
    // the pauses: { silences: [[start, end], …] } in seconds
    set segments(list) { assign({ segments: list || { silences: [] } }) },
    // where the output clips: [[from, to], …] s
    set clips(list) { assign({ clips: list || [] }); invalidate(true) },
    // the output's markers, [{ time, duration?, label, track? }]
    set markers(list) { assign({ markers: list || [] }); invalidate(true) },
    // the places of takes, [{ at, end, on, names }] (placeTakes): drawn again only as they change
    set takes(list) { if (JSON.stringify(list || []) !== JSON.stringify(sections)) { assign({ sections: list || [] }); invalidate(true) } },
    // a marker just made, { time, duration? }: drawn at once, before the output that has it comes, its name asked for
    name(m) {
      m = { ...m, ...tracks && { track: tracks[focus]?.name } }
      if (!markers.some(n => same(n, m))) assign({ markers: [...markers, { ...m, label: '' }].sort((p, q) => p.time - q.time) })
      rename(markers.findIndex(n => same(n, m)))
    },
    // the cues found, [{ t, rank }] (s, how plain: the larger shown first where they crowd); null till they are
    set cues(list) {
      // the sound's own start and end among them (the edited track's), where none of its own is: shown and snapped to
      // as any, before any where they crowd
      // (`bounds`: theirs, which warp holds, so never dragged: nearCue)
      const end = tracks ? tracks[focus]?.end : duration, own = ([t, kind]) => t != null && !(kind === 'end' && t <= 0) && !list.some(c => Math.abs(c.t - t) < 1e-3)
      const added = list ? [[0, 'start'], [end, 'end']].filter(own).map(([t, kind]) => ({ t, kind, rank: Infinity })) : []
      assign({ bounds: new Set(added.map(c => c.t)) })
      list = list && [...list, ...added].sort((p, q) => p.t - q.t)
      assign({ cues: list?.map(c => c.t) ?? null }); assign({ ranks: new Map(list?.map(c => [c.t, c.rank])) }); assign({ cueKinds: list?.map(c => c.kind) ?? [] }); invalidate()
    },
    // what the grip does: 'trim', 'stretch' or 'speed'; whether pitch is edited
    set gripMode(mode) { assign({ gripMode: ['trim', 'speed'].includes(mode) ? mode : 'stretch' }); invalidate(true) },
    set pitching(on) {
      assign({ pitching: !!on })
      if (!pitching && unframed) { assign({ fview: unframed }); assign({ unframed: null }) }
      assign({ framed: false })
      frameVoice()
      invalidate()
    },
    set envelope(curve) { assign({ envelope: curve }); invalidate() },
    // the pitch line the script has, semitones { t, v }, the line edited when pitch is
    set shift(curve) { assign({ shift: curve }); invalidate() },
    // The output's pitch, { times, f0 } (Hz every 10 ms, 0 where there is none), and `shift`, the pitch line it was
    // measured with, so the curve shows the line's changes since at once
    set contour(track) {
      assign({ contour: track && { ...track, basis: track.shift ? track.shift.t.map((t, i) => [t, track.shift.v[i]]) : [], knots: stylize(track.times, track.f0) } })
      assign({ landed: null })
      frameVoice()
      invalidate()
    },
    // the notes each notes lane holds, by its index (a sound's, 0): [{ time, duration, freq, t0, hop, f0, level }]
    // (worker.js notes); a pitch let go on them shown where it went till they come again
    set notes(by) { assign({ noted: by || {} }); assign({ landed: null }); invalidate() },
    get guides() { return guides },
    // a tab with no sound, none coming: its empty track drawn (unwritten)
    set blank(on) { if (on === empty) return; assign({ empty: on }); if (!duration) renew(); invalidate() },
    set guides(list) { assign({ guides: list || [] }); invalidate() },
    // While playing, a zoomed view scrolls with the playhead held in the middle; at the ends the playhead walks. One
    // past the middle, played from a caret there, is drawn to it as the view glides: its lead on the middle a frame
    // before, e^(-dt / GLIDE) of it kept (`played`: that frame's time), so it settles in the middle at any speed. A jump
    // (a caret put elsewhere as it plays) leads from where it lands; one out of sight, a loop come round, is centred at
    // once. A view moved by hand (`steered`) is left where it is, ahead of the playhead or behind it, till the playhead,
    // seen in it, passes its edge: then it glides to the middle from there. The playhead is a layer of its own, moved by
    // the compositor (slide), at `speed`; the pictures are drawn again only as the view scrolls
    get playhead() { return playhead },
    set playhead(t) {
      // what the lanes show of the view, the meters' part of it hidden; followed, the view's start on the device pixels'
      // grid, so the pictures and the marks over them step together, a whole pixel at a time, and the playhead drawn on
      // the pixel it holds (`half` a whole number of them in, counted in pixels, not read back off the times, whose
      // rounding as the view moves would set it a pixel either way from frame to frame), past where it is by the rest of
      // one (nudge). `mid` is the middle the view aimed at, off the grid as the playhead is drawn; a clock standing a
      // frame leaves both as they are
      const span = end - start, to = seenTo(), px = Math.max(1, Math.round(plot().w * dpr)), q = span / px, half = Math.floor(Math.round(px * reach()) / 2) * q
      const mid = start - nudge + half, now = performance.now(), dt = played ? (now - played) / 1000 : 0
      const was = playhead == null || t < playhead || t - playhead > 8 * dt ? t : playhead, seen = was >= start && was <= to
      if (t == null || steered && seen && t > to) assign({ steered: false })
      assign({ playhead: t })
      assign({ played: t == null ? 0 : now })
      let scrolled = false, lead = Infinity
      if (t != null && !drag && !steered && !moving && !whole()) {
        const follow = a => { const g = Math.round(a / q) * q; setRange(g, g + span); assign({ nudge: start === g ? g - a : 0 }); scrolled = true }
        if (!seen) follow(t - half)
        else if (t > mid) { lead = Math.max(0, was - mid) * Math.exp(-dt / GLIDE); follow(t - half - lead) }
        else if (mid - t > q) assign({ nudge: 0 })
      } else assign({ nudge: 0 })
      // followed with the playhead held in the middle, the reel run by the compositor at the speed it plays at (roll)
      assign({ cruise: scrolled && lead < q ? speed * plot().w / (end - start || 1) * dpr : 0 })
      assign({ cruised: document.timeline?.currentTime ?? performance.now() })
      if (t == null) { assign({ speed: 1 }); unslide() }
      else { runway.hidden = false; slide(x(t + nudge), scrolled ? 0 : speed * plot().w / (end - start || 1)) }
      invalidate(true)
    },
    // how fast the playhead goes, its time a second: as it plays, its speed; back, under a search, less than 0; 1 till
    // the playhead goes
    get speed() { return speed },
    set speed(r) { assign({ speed: r }) },
    // The picture a step's new settings will leave, drawn at once from what shows: its level changed by `gain(t)` (ops.js
    // previews), step by step, a pixel's time apart where it is in view, until its output comes; null draws the output
    preview(gain) {
      if (!gain || !duration) { assign({ pieces: null }); return invalidate() }
      const fine = (end - start) / plot().w, coarse = duration / 256, cuts = []
      for (let t = 0; t < duration; t += t >= start - fine && t < end ? fine : coarse) cuts.push(t)
      cuts.push(duration)
      assign({ pieces: [] })
      for (let i = 1; i < cuts.length; i++) {
        const s0 = cuts[i - 1], s1 = cuts[i], g = gain((s0 + s1) / 2), last = pieces.at(-1)
        if (last && Math.abs(last.gain - g) < 1e-4) last.s1 = last.d1 = s1
        else pieces.push({ s0, s1, d0: s0, d1: s1, gain: g })
      }
      invalidate()
    },
    // The picture an edit of [a, b] will leave, drawn at once from what shows now, until its output comes: 'remove',
    // 'cut', 'crop', or 'gain' by `db`; null draws the output as it is
    expect(kind, range, db = 0) {
      assign({ pieces: !kind || !range ? null : Array.isArray(range[0]) ? arrange(kind === 'gain' ? 'gains' : 'removes', range, 0, 0, db) : arrange(kind, ...range, range[0], db) })
      if (!pieces) { assign({ guest: null }); freeze([]) }
      // frozen till the output comes: where a delete or a cut closed up, what came up to it as long as it was; a crop,
      // what it kept. A level, in place and drawn as it will be, none
      else if (kind !== 'gain') freeze((Array.isArray(range[0]) ? range : [range]).map(([a, b], i, all) => { const before = all.slice(0, i).reduce((n, [p, q]) => n + q - p, 0); return kind === 'crop' ? { lane: own0(), a: 0, b: b - a } : { lane: own0(), a: a - before, b: b - before } }))
      invalidate()
    },
    // whether an edit is still being made over part of the picture (frozen)
    get busy() { return frozen.length > 0 },
    // every range selected, in time order, and every caret; addNext() adds the next like the selection (⌘D); `across`,
    // with tracks, whether the ranges run through every track's lane, an edit of them every track's
    get ranges() { return ranges() }, get carets() { return carets() }, get boxes() { return boxes() }, addNext,
    get across() { return !!tracks && allLanes },
    select, setCursor, around, step: stepTo,
    zoom, zoomTo: (a, b) => { const pad = (b - a) * .05; steer(); fitTo(a - pad, b + pad) }, fit: fitAll, frameSelected, bring,
    // the picture of a range, for an agent; a range or a time brought into sight
    snapshot, reveal
  }
}
export { markLane, ownMarks, snappedTo, SIDES, placed, RECORD, unwritten, takes, drag, touch, fine, nearCue, hot, told, ranges }
