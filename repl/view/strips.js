import clock from '../time.js'
import { markLane, marksOf, ownMarks, snappedTo, placed } from './data.js'
import { ghost, CHUNK, pointedBand, plot, spare, lanes, floor, inRoom, inLanes, roomLane, banded, rowEdge } from './geometry.js'
import { fine, nearCue } from './gestures.js'
import { EDGE, ONTO, HEAD, KINDS, mac, root, onedit, color, fades, sel2d, c, lookButton, rate, duration, units, hovered, markers, more, droppedNew, start, end, selection, band, cursor, playhead, cues, cueKinds, bounds, snapping, clips, aview, levelUnits, data, tracks, focus, across, sections, windows, lift, chosen, held, assign } from './model.js'
import { clipMarks } from './notes.js'
import { say, crossAt, washFrom, WASHED, lanesEnd, seenTo } from './overlay.js'
import { drag, hot, caretGhost, lined } from './pointer.js'
import { W, moved, invalidate, wash } from './render.js'
import { THIN, THICK } from './ruler.js'
import { ranges, carets } from './select.js'
import { x, X, time, snap, digits, seen, inside, fy, ay, sampled, decibel } from './scales.js'

// The strips under the lanes and across them: the measure, the fades at the view's edges, each band's look, the room
// under the tracks, the selection behind the sound, the cues, the markers and the names

// in the measuring red, where the pointer is, dashed out to the axes as Figma's guides: down to the time row at the
// picture's foot, where its length is (paintRuler), and across to the level or frequency axis, where its value is
const DASHED = [4, 3]
export function paintMeasure({ t }, py, rects) {
  const px = X(t), { w } = plot(), y = Math.round(py), [y0, y1] = [y, plot().h]
  if (px < 0 || px > w) return
  c.fillStyle = gauge()
  for (let k = y0; k < y1; k += DASHED[0] + DASHED[1]) c.fillRect(px, k, 1, Math.min(DASHED[0], y1 - k))
  if (rects.some(r => inside(r, px, py))) for (let k = px; k < w; k += DASHED[0] + DASHED[1]) c.fillRect(k, y, Math.min(DASHED[0], w - k), 1)
}
// Over a waveform lane, the level read: the waveform's at time `t`, the peak of its samples under the
// pixel on the pointer's side of the centre line, so a clip past the levels shown reads as it is: { y, text } (y
// within the lane); null where the lane is no waveform's, or the page holds no samples there (a long sound's let go),
// the pointer's then
export function waveAt(rect, t, py) {
  const x = data[rect.i]
  if (rect.kind !== 'wave' || !x || t == null) return null
  const k = (end - start) / plot().w * rate, i0 = Math.max(0, Math.floor(t * rate - k / 2)), i1 = Math.min(x.length, Math.ceil(t * rate + k / 2) + 1)
  if (i1 <= i0 || windows && Array.from({ length: Math.floor((i1 - 1) / CHUNK) - Math.floor(i0 / CHUNK) + 1 }, (_, j) => Math.floor(i0 / CHUNK) + j).some(j => windows.get(j) !== true)) return null
  const [, top, , lh] = rect, up = py < top + lh / 2
  let v = 0
  for (let i = i0; i < i1; i++) if (up ? x[i] > v : x[i] < v) v = x[i]
  const y = top + (aview[1] - v) / (aview[1] - aview[0]) * lh
  return { y: Math.max(top, Math.min(top + lh - 1, y)), text: levelUnits === 'linear' ? sampled(v) : decibel(20 * Math.log10(Math.abs(v)), 1, -99) }
}
// The lanes faded at an edge the sound runs on past, out of the view (fades): from their start, scrolled on from its
// start; before their end, short of its end; each FADE px wide, as tall as the caret, over the pictures, under what is
// drawn over them: the ground they lie on (editor.css), laid where it lies (resize: `--ground-top`, `--ground-h`),
// from clear to whole. A small still layer of its own, never a mask over the moving pictures, which the compositor
// would apply each frame they roll
const FADE = 24
export function placeFades(L) {
  const end = lanesEnd(L), h = `${Math.round(floor(L))}px`, on = [start > 1e-9, duration && seenTo() < duration - 1e-9]
  fades.forEach((el, k) => {
    if (el.hidden !== !on[k]) el.hidden = !on[k]
    const left = `${Math.round(k ? end - FADE : 0)}px`
    if (on[k] && (el.style.left !== left || el.style.height !== h)) Object.assign(el.style, { left, height: h })
  })
}
// the box the ground the lanes lie on is painted on (the slab, or a page's): the first around the picture with a
// background of its own, where it is from the picture's top and how tall, for the fades to lay it where it lies
export function ground(r) {
  let e = root.parentElement
  while (e && getComputedStyle(e).backgroundImage === 'none' && /^(transparent|rgba\(0, 0, 0, 0\))$/.test(getComputedStyle(e).backgroundColor)) e = e.parentElement
  const g = e?.getBoundingClientRect()
  if (!g) return
  root.style.setProperty('--ground-top', `${Math.round(g.top - r.top)}px`)
  root.style.setProperty('--ground-h', `${Math.round(g.height)}px`)
}
export function placeLook(L) {
  const f = (L.all[0]?.[1] ?? 0) - HEAD, seen = duration && !banded() && f >= 0, top = `${Math.round(f + 1)}px`, left = `${Math.round(plot().w + 1)}px`, kind = L.all[0]?.kind
  if (lookButton.hidden !== !seen) lookButton.hidden = !seen
  if (!seen) return
  if (lookButton.style.top !== top || lookButton.style.left !== left) Object.assign(lookButton.style, { top, left })
  if (lookButton.dataset.kind === kind) return
  const [label, icon] = KINDS[kind]
  lookButton.dataset.kind = kind
  lookButton.querySelector('path').setAttribute('d', icon)
  lookButton.ariaLabel = label
  lookButton.title = `${label}\nClick for how it shows`
}
// The room under the lanes: pointed at, holding the caret (`ghost`) or a file held over it, a new track's lane there, as
// tall as the last, its centre line faint, as a lane with nothing in it yet; pointed at, named by the pointer, a plus
// before the words, and nothing else: no title, no waveform
export function paintRoom(L, at) {
  const lane = roomLane(L), on = at && !drag && inRoom(at[1], L)
  if (!lane || !on && !ghost && !droppedNew) return
  c.fillStyle = color('--color-screen-wave')
  c.globalAlpha = .35
  c.fillRect(0, Math.round(lane[1] + lane[3] / 2), lanesEnd(L), 1)
  c.globalAlpha = 1
  if (on) say('New track', at[0] + 12, at[1] - 16, 'left', 'M12 5v14M5 12h14')
}
// More bands than the picture holds: a scrollbar down its right edge, its thumb where those in sight are among them
// all, dragged as any is (liftAt), drawn as the time's (paintBar): a round thumb on no track, there while the pointer
// is over the picture, THICK and brighter under it
const LIFT = 6
export const thumb = () => { const { h } = plot(), th = Math.max(24, h * h / (h + spare)); return { y: lift / spare * (h - th), h: th, room: h - th } }
export const liftAt = (px, py) => spare > 0 && px >= W - LIFT && py <= plot().h
export function paintLift(at) {
  if (!spare || !hovered && !drag?.lifting) return
  const t = thumb(), on = drag?.lifting || at && liftAt(...at), tw = on ? THICK : THIN
  c.globalAlpha = on ? .6 : .3
  c.fillStyle = color('--color-screen-soft')
  c.beginPath()
  c.roundRect(W - tw - 1, Math.round(t.y), tw, Math.round(t.h), tw / 2)
  c.fill()
  c.globalAlpha = 1
}
// A value by the pointer, on a patch of the screen so the labels under it give way
export function tag(text, px, py, align, fill = color('--color-screen-bright'), pill = null) {
  const tw = c.measureText(text).width
  if (align === 'center') px = Math.max(tw / 2 + 3, Math.min(plot().w - tw / 2 - 3, px))
  // kept whole within the picture; `right-of`, a value on the axis, where it is, going on to the right
  if (align === 'left') px = Math.min(px, W - tw - 3)
  if (align === 'right-of') align = 'left'
  const left = align === 'center' ? px - tw / 2 : px
  const lh = size() + 4
  // on a patch of the screen; or a pill of its own colour, a little wider
  c.fillStyle = pill ?? color('--color-screen')
  if (pill) { c.beginPath(); c.roundRect(left - 4, py - lh / 2, tw + 8, lh, 3); c.fill() }
  else c.fillRect(left - 3, py - lh / 2, tw + 6, lh)
  c.fillStyle = fill
  c.textAlign = align
  c.fillText(text, px, py)
}
export const accent = () => color('--color-screen-accent'), gauge = () => color('--color-screen-error')
// the picture's words, its numbers and tags: the skin's label size, in its mono font
export const size = () => parseFloat(color('--font-size-label')) || 10, label = () => `${size()}px ${color('--font-mono')}`
export function paintSelection(L, sel) {
  const { w } = plot(), all = L.all, boxes = []
  // [x, y, width, height, on the spectrogram], clipped to the lane, on whole pixels
  const push = (a, b, y0, y1, spec) => { const p = Math.round(Math.max(a, 0)), q = Math.round(Math.min(b, w)); y0 = Math.round(y0); y1 = Math.round(y1); if (q > p && y1 > y0) boxes.push([p, y0, q - p, y1 - y0, spec]) }
  const lane = (rect, a, b, y0 = rect[1], y1 = rect[1] + rect[3]) => push(a, b, y0, y1, L.spec.includes(rect))
  if (sel) {
    const a = x(sel[0]), b = x(sel[1])
    if (band) for (const rect of L.spec) lane(rect, a, b, Math.max(rect[1], fy(rect, band[1])), Math.min(rect[1] + rect[3], fy(rect, band[0])))
    else for (const rect of all) lane(rect, a, b)
  }
  for (const [p, q, lo, hi] of drag?.carry ? [] : more) if (q > p) {
    if (lo == null) for (const rect of all) lane(rect, x(p), x(q))
    else for (const rect of L.spec) lane(rect, x(p), x(q), Math.max(rect[1], fy(rect, hi)), Math.min(rect[1] + rect[3], fy(rect, lo)))
  }
  for (const [px, py, bw, bh, spec] of boxes) { sel2d.fillStyle = wash(spec); sel2d.fillRect(px, py, bw, bh) }
}
// A stretch marked (a range marker's place, the takes'): [a, b] px in each lane filled under the pictures in the theme's
// range highlight, as VS Code fills a range it shows, never lined; pointed at, in the selection's colour, as the press
// there would select it (`fill`, a colour, or one a lane's)
export function highlight(rects, a, b, fill, alpha = 1) {
  sel2d.globalAlpha = alpha
  for (const rect of rects) { const [, y, , lh] = rect; sel2d.fillStyle = typeof fill === 'function' ? fill(rect) : fill; sel2d.fillRect(Math.round(a), Math.round(y), Math.round(b - a), Math.round(lh)) }
  sel2d.globalAlpha = 1
}
// The edge dragged, or the one a press would take, any range's, lit as the line it would move: its first pixel or its
// last, over the handles
export function paintEdge(L, sel) {
  const lit = drag?.resizing && sel && !band ? { edge: sel[0] === drag.anchor ? 1 : 0, t: sel[sel[0] === drag.anchor ? 1 : 0] } : !drag && hot
  if (!lit) return
  // an end's last pixel, but where the caret is on it (the end a drag left it at): the caret's line, lit, one line
  const px = X(lit.t) - (playhead == null && lit.t === cursor ? 0 : lit.edge)
  c.fillStyle = color('--color-screen-bright')
  if (px >= 0 && px < lanesEnd(L)) for (const [, y, , lh] of L.all) c.fillRect(px, y, 1, lh)
}
// a time as the whole page writes it, in the units chosen (time.js): 0:05, 5.0s, 240000
export const stamp = (t, d = digits()) => clock(t, units, { digits: d, rate })
// Cues: shown only where they matter, never a forest over the sound, as Figma shows its guides only as a thing is
// dragged: dragged (the caret held, an edge, a range dragged out, a marker's name), what it snaps to either side of
// where it is, faint: the cues, the markers' and the takes' ends; nothing on a plain hover; held ⌘ (Ctrl, `all`), all
// of them, faint, the one under the pointer a press would take brighter; the one dragged, bright where it will land;
// those an end measured to sits on (`lit`), lit. No words by them: where the sound is, a soft wash says (washFrom).
// The primary ones, where sounds and ranges start and end, the markers' and the takes', plainer than the secondary,
// the hits within. In the accent: there for now alone, what the caret or an end may become
const on = (lit, px) => lit.some(t => Math.abs(x(t) - px) < .5)
// The time a drag moves, as the caret or a range's end: the caret held, an edge, a range dragged out (Shift held before
// the press or after it), a marker's serif moved (a range's end, the one held), else null
export const dragged = () => drag?.caret ? cursor : drag?.resizing || drag?.anchor != null && drag.moved && !drag.box ? drag.hear
  : drag?.marker != null && drag.moved ? drag.edge ? drag.end : drag.to : null

export const editing = (keys = held) => !!(mac ? keys.metaKey : keys.ctrlKey)
export function paintCues(rects, lit, all = false) {
  const t0 = dragged(), times = seen().map(i => cues[i]), marks = ownMarks(), lines = new Map()
  const pool = (all || dragged() != null ? [...times, ...marks] : [...times.filter(t => bounds.has(t)), ...marks]).sort((p, q) => p - q)
  // a line at a time, as it is drawn (moved), the brightest asked for it; none on a dragged line (that line alone, white,
  // the crosses saying it snapped)
  const put = (t, a) => {
    const at = t == null ? null : moved(t), px = at == null ? null : X(at)
    if (px != null && px >= 0 && px <= plot().w && !(drag && on(lit, px)) && !(lines.get(px)?.a >= a)) lines.set(px, { t, a })
  }
  const faint = t => cueKinds[cues?.indexOf(t) ?? -1] === 'hit' ? .25 : .4
  if (all) for (const t of pool) put(t, faint(t))
  if (t0 != null && snapping) { const p = X(t0), was = pool.findLast(t => X(t) < p - .5), next = pool.find(t => X(t) > p + .5); put(was, faint(was)); put(next, faint(next)) }
  const near = !drag && hovered ? nearCue(...hovered, held) : -1
  if (near >= 0) put(cues[near], .7)
  for (const t of drag ? [] : lit) put(times.find(c => Math.abs(X(c) - X(t)) < .5), 1)
  if (drag?.cue != null) lines.set(X(drag.to), { t: drag.to, a: 1 })
  c.fillStyle = accent()
  for (const [px, { a }] of lines) {
    c.globalAlpha = a
    for (const [, ly, , lh] of rects) c.fillRect(px, ly, 1, lh)
  }
  c.globalAlpha = 1
  return [...lines.keys()]
}
// Where a press over a band (`i`, a track's index; null, the sound's) puts the caret: the time under the pointer to
// the zoom's step, gone onto what is by it, as a drag goes (stick). Within EDGE px a primary place: where the band's
// sound starts and ends, a marker's line, a range's end, the takes' ends; else, in the edited band, within ONTO px a
// secondary one, a cue this scale shows (a sound's start or end within, a hit). Never with snapping off, nor while ⌘
// aims finely (`keys` held)
export function caretTo(px, i = tracks ? focus : null, keys = held) {
  const t = snap(time(px)), own = i === (tracks ? focus : null)
  if (!snapping || fine() || editing(keys)) return t
  const near = (list, d) => list.reduce((b, q) => Math.abs(x(q) - px) <= d && (b == null || Math.abs(x(q) - px) < Math.abs(x(b) - px)) ? q : b, null)
  const ends = [0, tracks ? tracks[i]?.end ?? duration : duration], marks = marksOf(i).map(t => own ? moved(t) ?? t : t)
  return near([...ends, ...marks.filter(t => t != null)], EDGE) ?? (own ? near(seen().map(k => cues[k]), ONTO) : null) ?? t
}
// The caret's ghost as it is drawn, { t, i }: where a press at the pointer would put it now, onto what it is by as that
// comes (an output's markers, its cues), the pointer still; or null
export const ghostOf = () => !drag && hovered && caretGhost ? { t: caretTo(hovered[0], caretGhost.i), i: caretGhost.i } : null
// Ghosts of lines, faint, as the caret's would be: where a press over a band would put the caret (caretGhost), any
// band's, in the caret's own colour, see-through, gone onto what it is by, the side of the sound there washed softly; a
// marker's end or a moment pointed at in its head, every other moment of its name with it; a marker dragged. And the
// edited band's markers' lines, grey, always there to go by: a moment's, a range's ends
export function paintMarkers(L, lit, pointedAt, hints = []) {
  const all = L.all, lanesOf = m => markLane(m) == null ? all : [all[markLane(m)]].filter(Boolean), ghosts = new Map(), marks = stripped(L).filter(m => m.kind === 'mark')
  const edge = pointedAt?.kind === 'mark' && hovered && !drag ? notch(pointedAt, hovered[0]) : -1, g = ghostOf(), group = pointedAt?.kind === 'mark' && !drag ? kin(pointedAt.i) : []
  const bandOf = i => i == null ? all : [all[i]].filter(Boolean), w = lanesEnd(L)
  if (edge >= 0 || pointedAt?.moment && !drag) ghosts.set(edge === 1 ? pointedAt.x1 : pointedAt.x0, pointedAt.rects)
  for (const m of marks) if (m.moment && m.i !== pointedAt?.i && group.includes(m.i)) ghosts.set(m.x0, m.rects)
  if (drag?.marker != null && drag.moved) ghosts.set(X(dragged()), lanesOf(markers[drag.marker]))
  // (none where a ghost is, or a hint's line, which takes its place)
  const ghosted = px => [...ghosts.keys(), ...hints, ...g ? [X(g.t)] : []].some(q => Math.abs(q - px) < 1)
  c.fillStyle = color('--color-screen-muted')
  c.globalAlpha = .6
  for (const m of marks) if (!tracks || markLane(markers[m.i]) === focus) for (const px of m.moment ? [m.x0] : [m.x0, m.x1]) if (px >= 0 && px <= w && !on(lit, px) && !ghosted(px)) for (const [, y, , lh] of m.rects) c.fillRect(Math.round(px), y, 1, lh)
  c.fillStyle = color('--color-screen-caret')
  c.globalAlpha = .5
  for (const [px, rects] of ghosts) if (px >= 0 && px <= plot().w && !on(lit, px)) for (const [, y, , lh] of rects) c.fillRect(px, y, 1, lh)
  // the caret to be, a ghost of it
  if (g && !on(lit, X(g.t))) for (const [, y, , lh] of bandOf(g.i)) c.fillRect(X(g.t), y, 1, lh)
  c.globalAlpha = 1
  // the side of the sound the ghost went onto, or the line a press takes is on (an edge's, the caret's): pointed at
  // anywhere on it, the wash stays
  const to = g ?? (!drag && hovered && lined)
  if (!to) return
  const { side } = snappedTo(to.t, to.i), end = tracks ? tracks[to.i]?.end ?? duration : duration
  washFrom(X(to.t), side ?? (to.t <= 1e-9 ? 1 : Math.abs(to.t - end) < 1e-9 ? -1 : 0), bandOf(to.i), WASHED / 2)
}
// two markers one: the same track's, of the same kind at the same time, to half a millisecond (an output's, from the
// time written)
export const same = (m, n) => m.track === n.track && !m.duration === !n.duration && Math.abs(m.time - n.time) < 5e-4
// ── The strips, each band's head over its lanes (embedded too). In it its markers by their names alone, as a
// document's headings over what they name: a range's over its stretch from its start, cut short where it has no room,
// a moment's from its time; one with no name its number among the band's, as they were made, faint. A name pointed at
// lights the stretch it names over the sound, every other of its name in the band with it, as a press there selects
// them all, as a text's occurrences are: pressed, the ranges selected, the one pressed heard while held; a moment's
// name pressed, the carets there, dragged, it moves; a range's ends, REACH px either side, drag (one let go on the
// other, a moment; a moment's held Alt, pulled apart into a range, as Photoshop's split slider's), snapping as an edge
// does; double-clicked, named anew. Over a caret, or a range's start, while the pointer is over the head there, a
// marker's tag, faint, lit on it (placeholders): clicked, a name written there, the number its marker would have faint
// in the field, the markers put with it at each caret and range, alike, nothing written putting them with their
// numbers (ask). Anywhere else in the head a press is the lanes': the caret, a range.
// What forks the sound stands there too, at the end of what it forks, inside it: the takes' numbers (placeTakes), a
// range's or the selection's fork (placeFork)
export const REACH = 4, NAMES = 6, NAMEH = 14
// where a name starts: at its marker's start, `x0`, its first letter's edge the caret's line there; held in sight
const nameLeft = x0 => Math.max(x0, 0)
// Each band's head: { y, h, edge, i }, its top and height, the lanes' edge it lies along, its track's index (null: a
// sound's)
export const heads = L => (tracks ? L.all.map(r => ({ edge: r[1], i: r.i })) : L.all.length ? [{ edge: L.all[0][1], i: null }] : []).map(r => ({ ...r, y: r.edge - HEAD, h: HEAD }))
// A marker's number among its band's, as they were made (`n`, the page's: its mark() among its track's), else by time;
// its name as shown, its own or that number; the number the band's next one has
const numberOf = m => m.n ?? markers.filter(n => markLane(n) === markLane(m) && (n.time < m.time || n.time === m.time && markers.indexOf(n) < markers.indexOf(m))).length + 1
const nameOf = m => m.label || `${numberOf(m)}`
export const nextOf = lane => Math.max(0, ...markers.filter(m => markLane(m) === lane).map(numberOf)) + 1
// the markers a press on marker `i`'s name takes, by index: every one of its name in its band; one with none, itself
export const kin = i => { const m = markers[i]; return m?.label ? markers.flatMap((n, j) => n.label === m.label && markLane(n) === markLane(m) ? [j] : []) : [i] }
const wide = text => { c.font = label(); return c.measureText(text).width }
// what the heads hold: [{ kind: 'mark' (a marker's, `i` its index, `text` its name; a moment's x1 its name's end,
// `moment`; one pulled apart into a range, a range) or 'takes' (`i`, the section's: their numbers at its end, inside
// it), x0, x1, rects, and its row's y, h, edge }]. A marker a drag of the selection's edge or the caret takes with it
// (`bound`: one the selection was made from, pointer.js) where they are
export function stripped(L) {
  const up = new Map(heads(L).map(s => [s.i, s])), lanesOf = i => i == null ? L.all : [L.all[i]].filter(Boolean), out = []
  for (const [i, m] of markers.entries()) {
    const held = drag?.marker === i, tied = drag?.bound === m && drag.moved, span = tied && m.duration && selection
    const at = held ? drag.to : tied ? span ? selection[0] : cursor : placed(m), end = held ? drag.end : tied ? span ? selection[1] : at : at + (m.duration ?? 0), s = up.get(markLane(m)), text = nameOf(m)
    if (s && at != null) out.push({ ...s, kind: 'mark', i, text, x0: X(at), x1: end > at ? X(end) : nameLeft(X(at)) + wide(text) + 2, moment: !(end > at), rects: lanesOf(markLane(m)) })
  }
  sections.forEach((t, i) => { const s = up.get(t.lane ?? null); if (s) out.push({ ...s, kind: 'takes', i, x0: X(t.at), x1: X(Math.min(t.end, duration)), rects: lanesOf(t.lane ?? null) }) })
  return out
}
// whether a range has a fork: one with no takes from its start (placeFork)
export const forks = m => m.kind === 'mark' && !!markers[m.i]?.duration && !sections.some(t => (t.lane ?? null) === markLane(markers[m.i]) && Math.abs(X(t.at) - m.x0) < 1)
// which end of a marker `px` takes: a moment's (its name too, which drags it), or a range's start, 0; a range's end, 1;
// else -1
export function notch(m, px) {
  if (m.kind !== 'mark') return -1
  if (m.moment) return px >= m.x0 - REACH && px <= m.x1 ? 0 : -1
  const start = Math.abs(px - m.x0) <= REACH, end = Math.abs(px - m.x1) <= REACH
  return start && (!end || px <= (m.x0 + m.x1) / 2) ? 0 : end ? 1 : -1
}
// what a press in a strip takes: a marker's end, a range or the takes' place under it; or null
export function stripAt(px, py, L = lanes()) {
  if (py > plot().h) return null
  const row = stripped(L).filter(m => py >= m.y && py < m.y + m.h)
  return row.find(m => notch(m, px) >= 0) ?? row.find(m => px >= m.x0 - REACH && px <= m.x1 + REACH) ?? null
}
// whether the pointer is over what a range or the takes' place marks: its lanes, the gaps between them too
const within = m => !!hovered && !drag && m.x1 > m.x0 && !m.moment && hovered[0] >= m.x0 && hovered[0] <= m.x1 && inLanes(m.rects, hovered[1])
// a name on a row, cut short to `room` px, on its ground
function nameOn(row, text, lx, room, ink) {
  while (text.length > 1 && c.measureText(text).width > room) text = text.slice(0, -2) + '…'
  const tw = c.measureText(text).width
  c.fillStyle = color('--color-screen')
  c.fillRect(lx - 2, row.edge - MARKED - 2, tw + 4, MARKED + 2)
  c.fillStyle = ink
  c.fillText(text, lx, row.edge - NAMES)
}
const MARKED = 9
export function paintStrips(L, pointedAt, selected) {
  // the edited band's (every band's a selection runs through), the others' faint. Lit: pointed at, every one of its
  // name with it, there or over the sound (within); active (its stretch selected, the marker chosen or dragged); where
  // a drag or the caret's ghost, in its band, went onto it
  const w = lanesEnd(L), edited = i => !tracks || !!across?.includes(i) || i === focus, g = ghostOf(), group = pointedAt?.kind === 'mark' ? kin(pointedAt.i) : []
  const near = dragged() != null ? { t: dragged(), i: tracks ? focus : null } : g
  c.textAlign = 'left'
  for (const m of stripped(L)) {
    if (m.kind !== 'mark' || m.x1 + REACH < 0 || m.x0 - REACH > w) continue
    // a name of its own in the marks' colour, a number faint
    const mark = markers[m.i], at = near && markLane(mark) === near.i ? X(near.t) : null
    const lit = selected(m) || chosen && same(chosen, mark) || drag?.marker === m.i || group.includes(m.i) || within(m) || at != null && (Math.abs(at - m.x0) < .5 || !m.moment && Math.abs(at - m.x1) < .5)
    const ink = color(lit ? '--color-screen-bright' : !mark.label || !edited(markLane(mark)) ? '--color-screen-muted' : '--color-screen-mark')
    // its name, cut short where a range's end leaves too little room (none while it is written in place)
    const lx = nameLeft(m.x0), room = m.moment ? Infinity : Math.min(m.x1, w) - lx - 2
    if (naming && same(naming, mark) || room < 8) continue
    nameOn(m, m.text, lx, room, ink)
  }
  // the marker to be, a tag over the caret the pointer is over the head by, faint; lit on it
  const to = nearTag(L)
  if (to) pin(to.row, to.ix, color(nameAt(L) ? '--color-screen-bright' : '--color-screen-muted'))
}
// A marker's tag, as a map's pin: a square, its point down on the line at `ix` px
const TAG = 8, NEAR = 12
function pin(row, ix, ink) {
  const l = Math.round(ix - TAG / 2) + .5, top = row.edge - 14 + .5, side = top + TAG - 2, tip = row.edge - 2
  c.strokeStyle = ink
  c.lineWidth = 1
  c.beginPath(); c.moveTo(l, top); c.lineTo(l + TAG - 1, top); c.lineTo(l + TAG - 1, side); c.lineTo(ix + .5, tip); c.lineTo(l, side); c.closePath(); c.stroke()
}
// the marker to be whose tag the pointer is over the head by, NEAR px either side
function nearTag(L, at = hovered) {
  if (!at || drag || naming) return null
  const [px, py] = at
  return placeholders(L).find(p => py >= p.row.y && py < p.row.y + p.row.h && Math.abs(px - p.ix) <= NEAR) ?? null
}
// The markers to be, over the edited band's carets and ranges while that band is pointed at, where no name is: each
// with the number it would have, where its name would start (a range's from its start), [{ row, a, b, x0, x1, text }];
// none while one is dragged or named, while it plays, in a player's view or with the band not pointed at
const spans = () => band ? [[cursor, cursor]] : [...ranges(), ...carets().map(t => [t, t])].sort((p, q) => p[0] - q[0])
export function placeholders(L) {
  if (drag || naming || playhead != null || !banded() || !duration || pointedBand !== (tracks ? focus : 0)) return []
  const row = heads(L).find(s => s.i === (tracks ? focus : null)), n = nextOf(tracks ? focus : null)
  if (!row) return []
  // (none over a name, a range's under its stretch past its name too, pressed there taking the number)
  const names = stripped(L).filter(m => m.kind === 'mark' && m.y === row.y).map(m => [nameLeft(m.x0), nameLeft(m.x0) + wide(m.text)])
  const all = spans().map(([a, b], k) => { const text = `${n + k}`, x0 = nameLeft(X(a)), ix = Math.round(X(a)); return { row, a, b, x0, ix, text } })
  return all.filter(p => p.x0 <= lanesEnd(L) && !names.some(([a, b]) => p.ix + TAG / 2 + 2 > a && p.ix - TAG / 2 - 2 < b))
}
// The marker to be pointed at, its tag within REACH px: it, with `all` (every one, named together), or null
export function nameAt(L, at = hovered) {
  if (!at || drag || naming) return null
  const all = placeholders(L), [px, py] = at, p = all.find(p => py >= p.row.y && py < p.row.y + p.row.h && Math.abs(px - p.ix) <= TAG / 2 + REACH)
  return p ? { ...p, all } : null
}
// One clicked: a name written where its number is, put at each (ask)
export const placeMarker = p => ask(p.all.map(q => [q.a, q.b]), p.x0, p.text, true)
// A first marker's name asked for at `t` (a track just made): put only if named
export const askName = t => ask([[t, t]], nameLeft(X(t)), 'Name', false)
// A name asked for in the edited band's head, its field at `lx`, `hint` faint in it: Enter or a click away puts a
// marker at each of `list` ([[a, b], …], a moment where a = b), the name written, alike; nothing written, with none,
// their numbers showing (`bare`; else none put); Escape, none
function ask(list, lx, hint, bare) {
  const row = heads(lanes()).find(s => s.i === (tracks ? focus : null))
  if (!row || naming) return
  const input = named('', 'Name', lx, row.edge - NAMES, hint)
  naming = { input }
  let done = false
  const end = keep => {
    if (done) return
    done = true
    input.remove()
    naming = null
    invalidate(true)
    const label = input.value.trim()
    if (keep && (label || bare)) put(list, label)
  }
  for (const type of ['pointerdown', 'click', 'contextmenu', 'wheel']) input.addEventListener(type, e => e.stopPropagation())
  input.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') end(true); else if (e.key === 'Escape') end(false) })
  input.addEventListener('blur', () => end(true))
  invalidate(true)
  input.focus()
}
// Markers put (onedit 'label'), drawn at once, before the output that has them comes, each its number, the band's next
// on; the first chosen
function put(list, label) {
  const track = tracks?.[focus]?.name, n = nextOf(tracks ? focus : null)
  if (!onedit('label', { spans: list, label })) return
  const made = list.map(([a, b], k) => ({ time: a, ...b > a && { duration: b - a }, label, ...track != null && { track }, n: n + k }))
  assign({ markers: [...markers, ...made.filter(m => !markers.some(o => same(o, m)))].sort((p, q) => p.time - q.time) })
  assign({ chosen: made[0] })
  invalidate(true)
}
// A marker's name written where it is: a field over it, Enter or a click away keeps it, Escape leaves it as it was
export let naming = null
// the top of a field `h` px tall whose text sits where a name drawn with its middle at `my` does: the canvas sets the
// em box's middle at `my`, the field its font's box in the middle of its line (a pixel lower, as a monospace font's
// ascent and descent fall)
export function fieldTop(my, h) {
  const was = [c.font, c.textBaseline]
  c.font = label()
  c.textBaseline = 'alphabetic'
  const m = c.measureText('H'), A = m.fontBoundingBoxAscent ?? size(), D = m.fontBoundingBoxDescent ?? 0
  c.textBaseline = 'middle'
  const under = m.actualBoundingBoxAscent - c.measureText('H').actualBoundingBoxAscent
  ;[c.font, c.textBaseline] = was
  return my + under - (h - A - D) / 2 - A
}
// A field where a name is drawn, its text where the name's is (left at `lx`, its middle at `my`), as wide as it, plain,
// `hint` faint in it while empty: the name written on in place
function named(value, aria, lx, my, hint = '') {
  const input = root.appendChild(Object.assign(document.createElement('input'), { className: 'marker-name', value, placeholder: hint, ariaLabel: aria, spellcheck: false }))
  const fit = () => { input.style.width = `${Math.max(2, (input.value || input.placeholder).length + 1)}ch` }
  Object.assign(input.style, { left: `${Math.round(lx)}px`, top: `${fieldTop(my, NAMEH)}px`, height: `${NAMEH}px`, lineHeight: `${NAMEH}px`, font: label() })
  fit()
  input.addEventListener('input', fit)
  return input
}
export function rename(i) {
  const m = markers[i], strip = m && heads(lanes()).find(s => s.i === markLane(m))
  if (!strip) return
  naming?.input.remove()
  const input = named(m.label || '', 'Name', nameLeft(X(placed(m) ?? m.time)), strip.edge - NAMES, `${numberOf(m)}`)
  naming = { time: m.time, duration: m.duration, track: m.track, input }
  let done = false
  const end = keep => {
    if (done) return
    done = true
    input.remove()
    naming = null
    invalidate(true)
    // named at once, as a dragged marker stays where it was let go, till the output that has it comes: the marker as
    // it is now, the output having come meanwhile
    const label = input.value.trim(), j = markers.findIndex(n => same(n, m)), now = markers[j] ?? m
    if (keep && label !== (now.label || '') && onedit('relabel', { time: now.time, duration: now.duration, track: now.track, label }) && j >= 0) assign({ markers: markers.with(j, { ...now, label }) })
  }
  // the field's own keys and presses stay its own
  for (const type of ['pointerdown', 'click', 'contextmenu', 'wheel']) input.addEventListener(type, e => e.stopPropagation())
  input.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') end(true); else if (e.key === 'Escape') end(false) })
  input.addEventListener('blur', () => end(true))
  invalidate(true)
  input.focus()
  input.select()
}
// Past full scale: zoomed out, a waveform lane's values beyond ±1 tinted red, where a sound clips; and on the time row
// (paintClipped), a red line by the lanes along each stretch that clips
export function paintOvers(L) {
  const { w } = plot()
  c.fillStyle = color('--color-screen-error')
  c.globalAlpha = .07
  if (aview[1] > 1 || aview[0] < -1) for (const rect of L.wave) {
    const [, y, lw, lh] = rect, top = ay(rect, 1), low = ay(rect, 1, -1)
    if (top > y) c.fillRect(0, y, lw, top - y)
    if (low < y + lh) c.fillRect(0, low, lw, y + lh - low)
  }
  c.globalAlpha = 1
  // and in each lane where its samples cross full scale, a small cross on the line they cross, where they first do
  // the same cross as a snap's (overlay.js: a pixel wide, on pixels' middles), in the clip's red
  c.strokeStyle = c.fillStyle
  c.lineWidth = 1
  for (const { t, i, sign } of clipMarks()) {
    const at = moved(t), rect = L.wave.find(r => r.i === i), py = rect && ay(rect, 1, sign)
    if (at == null || !rect || py < rect[1] || py > rect[1] + rect[3] || x(at) < 0 || x(at) > w) continue
    crossAt(X(at) + .5, Math.round(py) + .5)
  }
}
export function paintClipped() {
  const { w } = plot(), at = rowEdge()
  c.fillStyle = gauge()
  for (const [a, b] of clips) {
    const [p, q] = [moved(a), moved(b)].map(t => t == null ? null : Math.max(0, Math.min(w, x(t))))
    if (p != null && q != null && q >= 0 && p <= w) c.fillRect(Math.round(p), at, Math.max(1, Math.round(q - p)), 2)
  }
}
