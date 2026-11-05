import clock from '../time.js'
import { markLane, marksOf, ownMarks, snappedTo, placed } from './data.js'
import { ghost, CHUNK, pointedBand, plot, spare, lanes, floor, inRoom, own, inLanes, roomLane, banded, underRow } from './geometry.js'
import { fine, nearCue } from './gestures.js'
import { EDGE, ONTO, HEAD, FOOT, KINDS, timeRow, mac, root, onedit, color, fades, sel2d, c, lookButton, rate, duration, units, hovered, markers, more, droppedNew, start, end, selection, band, cursor, playhead, cues, cueKinds, bounds, snapping, clips, aview, levelUnits, data, tracks, focus, allLanes, sections, windows, lift, chosen, held, assign } from './model.js'
import { clipMarks } from './notes.js'
import { say, crossAt, washFrom, WASHED, lanesEnd, seenTo } from './overlay.js'
import { drag, hot, caretGhost } from './pointer.js'
import { W, moved, invalidate, wash } from './render.js'
import { THIN, THICK } from './ruler.js'
import { select, setCursor } from './select.js'
import { x, X, time, snap, digits, seen, inside, fy, ay, sampled, decibel } from './scales.js'

// The strips under the lanes and across them: the measure, the fades at the view's edges, each band's look, the room
// under the tracks, the selection behind the sound, the cues, the markers and the names

// in the measuring red, where the pointer is, dashed out to the axes as Figma's guides: down to the time row (the
// band's, 'band'), where its length is (paintRuler), and across to the level or frequency axis, where its value is
const DASHED = [4, 3]
export function paintMeasure({ t }, py, rects) {
  const px = X(t), { w } = plot(), h = timeRow === 'band' ? underRow()?.y ?? plot().h : plot().h, y = Math.round(py)
  if (px < 0 || px > w) return
  c.fillStyle = gauge()
  for (let k = y; k < h; k += DASHED[0] + DASHED[1]) c.fillRect(px, k, 1, Math.min(DASHED[0], h - k))
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
  const f = floor(L), seen = duration && !banded() && f + FOOT <= plot().h, top = `${Math.round(f + 1)}px`, left = `${Math.round(plot().w + 1)}px`, kind = L.all[0]?.kind
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
// The room under the lanes: pointed at, holding the caret (`ghost`) or a file held over it, a new track's lane there,
// its centre line faint, as a lane with nothing in it yet; pointed at, named by the pointer
export function paintRoom(L, at) {
  const lane = roomLane(L), on = at && !drag && inRoom(at[1], L)
  // the placeholder by it lit as it is pointed at (editor.css .layer-new)
  if (root.hasAttribute('data-room') !== !!(lane && on)) root.toggleAttribute('data-room', !!(lane && on))
  if (!lane || !on && !ghost && !droppedNew) return
  c.fillStyle = color('--color-screen-wave')
  c.globalAlpha = .35
  c.fillRect(0, Math.round(lane[1] + lane[3] / 2), lanesEnd(L), 1)
  c.globalAlpha = 1
  // with tracks, its title to be names it (editor.js layers); without, the pointer does
  if (on && !tracks) say('New track', at[0] + 12, at[1] - 16)
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
// dragged: dragged (the caret held, an edge, a range dragged out, a marker's triangle), what it snaps to either side of
// where it is, faint: the cues, the markers' and the takes' ends; nothing on a plain hover; held ⌘ (Ctrl, `all`), all
// of them, faint, the one under the pointer a press would take brighter; the one dragged, bright where it will land;
// those an end measured to sits on (`lit`), lit. No words by them: where the sound is, a soft wash says (washFrom).
// The primary ones, where sounds and ranges start and end, the markers' and the takes', plainer than the secondary,
// the hits within
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
// band's, gone onto what it is by, the side of the sound there washed softly; a marker's end or a moment pointed at in
// the head; a marker dragged
export function paintMarkers(all, lit, pointedAt) {
  const lanesOf = m => markLane(m) == null ? all : [all[markLane(m)]].filter(Boolean), ghosts = new Map()
  const edge = pointedAt?.kind === 'mark' && hovered && !drag ? notch(pointedAt, hovered[0]) : -1, g = ghostOf()
  const bandOf = i => i == null ? all : [all[i]].filter(Boolean)
  if (edge >= 0 || pointedAt?.moment && !drag) ghosts.set(edge === 1 ? pointedAt.x1 : pointedAt.x0, pointedAt.rects)
  if (drag?.marker != null && drag.moved) ghosts.set(X(dragged()), lanesOf(markers[drag.marker]))
  c.fillStyle = color('--color-screen-caret')
  c.globalAlpha = .5
  for (const [px, rects] of ghosts) if (px >= 0 && px <= plot().w && !on(lit, px)) for (const [, y, , lh] of rects) c.fillRect(px, y, 1, lh)
  c.globalAlpha = 1
  // the caret to be grey, as a ghost of it
  if (!g || on(lit, X(g.t))) return
  c.fillStyle = color('--color-screen-muted')
  for (const [, y, , lh] of bandOf(g.i)) c.fillRect(X(g.t), y, 1, lh)
  if (Math.abs(X(g.t) - X(time(hovered[0]))) < .5) return
  const { side } = snappedTo(g.t, g.i), end = tracks ? tracks[g.i]?.end ?? duration : duration
  washFrom(X(g.t), side ?? (g.t <= 1e-9 ? 1 : Math.abs(g.t - end) < 1e-9 ? -1 : 0), bandOf(g.i), WASHED / 2)
}
// two markers one: the same track's, of the same kind at the same time, to half a millisecond (an output's, from the
// time written)
export const same = (m, n) => m.track === n.track && !m.duration === !n.duration && Math.abs(m.time - n.time) < 5e-4
// ── The strips, each band's rows along its lanes: over them its head, under them its foot. In the head (banded;
// embedded, no head: the foot) its markers by their names alone, as a transcript letters its sounds over them: a
// range's over its stretch from its start, cut short where it has no room, a moment's from its time; one with no name
// its number among the band's, faint. A name pointed at lights the stretch it names over the sound, as a press there
// would select it: pressed, a range selected and heard while held; a moment's name pressed, the caret there, dragged,
// it moves; a range's ends, REACH px either side, drag (one let go on the other, a moment; a moment's held Alt, pulled
// apart into a range, as Photoshop's split slider's), snapping as an edge does; double-clicked, named anew. Anywhere
// else in the head the pointer is a marker's (a triangle pointing down): over the selection a click puts a range of it,
// elsewhere a moment, its line a ghost there till then, where a press would put the caret; put, it is chosen, a moment
// the caret's, and its name asked for, none needed (nameAt, placeMarker). What forks the sound stands
// there too, at the end of what it forks, inside it: the takes' numbers (placeTakes), a range's or the selection's fork
// (placeFork); the foot is the time row's alone ('band')
export const REACH = 4, NAMES = 6, NAMEH = 14
// where a name starts: at its marker's start, `x0`, its first letter's edge the caret's line there; held in sight
const nameLeft = x0 => Math.max(x0, 0)
// Each band's rows: { y, h, edge, dir, i }, its top and height, the lanes' edge it lies along and which way from it
// (1 down, under the lanes; -1 up, over them), its track's index (null: a sound's). Its feet, under the lanes; its
// heads, over them where there is a head line (banded), else its feet
const rows = (L, at, dir, h) => (tracks ? L.all.map((r, i) => ({ edge: at(r), i })) : L.all.length ? [{ edge: dir > 0 ? floor(L) : L.all[0][1], i: null }] : []).map(r => ({ ...r, y: dir > 0 ? r.edge : r.edge - h, h, dir }))
export const feet = L => rows(L, ([, y, , lh]) => y + lh, 1, FOOT)
export const heads = L => banded() ? rows(L, ([, y]) => y, -1, HEAD) : feet(L)
// a marker's name as shown: its own, or its number among its band's, by time
const nameOf = (m, i) => m.label || `${markers.filter(n => markLane(n) === markLane(m) && (n.time < m.time || n.time === m.time && markers.indexOf(n) < i)).length + 1}`
const wide = text => { c.font = label(); return c.measureText(text).width }
// what the heads hold: [{ kind: 'mark' (a marker's, `i` its index, `text` its name; a moment's x1 its name's end,
// `moment`; one pulled apart into a range, a range) or 'takes' (`i`, the section's: their numbers at its end, inside
// it), x0, x1, rects, and its row's y, h, edge, dir }]
export function stripped(L) {
  const up = new Map(heads(L).map(s => [s.i, s])), lanesOf = i => i == null ? L.all : [L.all[i]].filter(Boolean), out = []
  for (const [i, m] of markers.entries()) {
    const held = drag?.marker === i, at = held ? drag.to : placed(m), end = held ? drag.end : at + (m.duration ?? 0), s = up.get(markLane(m)), text = nameOf(m, i)
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
  c.fillRect(lx - 2, row.dir > 0 ? row.edge : row.edge - MARKED - 2, tw + 4, MARKED + 2)
  c.fillStyle = ink
  c.fillText(text, lx, row.edge + row.dir * NAMES)
}
const MARKED = 9
export function paintStrips(L, pointedAt, selected) {
  // the edited band's (every band's through every lane), the others' faint
  // (a marker's line pointed at in the lanes, its name lit too)
  // (a time a drag or the caret to be went onto, its name lit too)
  const w = lanesEnd(L), edited = i => !tracks || allLanes || i === focus, g = ghostOf(), near = dragged() ?? (g?.i === (tracks ? focus : null) ? g.t : null)
  c.textAlign = 'left'
  for (const m of stripped(L)) {
    if (m.kind !== 'mark' || m.x1 + REACH < 0 || m.x0 - REACH > w) continue
    // lit: pointed at, there or over the sound (within), or active (its stretch selected, the marker chosen or
    // dragged), its stretch lit over the sound alone from the strip (marksOf); a name of its own in the marks' colour, a
    // number faint; the accent is the hints' alone
    const mark = markers[m.i], lit = selected(m) || chosen && same(chosen, mark) || drag?.marker === m.i || pointedAt?.kind === m.kind && pointedAt.i === m.i || within(m) || near != null && (Math.abs(X(near) - m.x0) < .5 || !m.moment && Math.abs(X(near) - m.x1) < .5)
    const ink = color(lit ? '--color-screen-bright' : !mark.label || !edited(markLane(mark)) ? '--color-screen-muted' : '--color-screen-mark')
    // its name, cut short where a range's end leaves too little room (none while it is written in place)
    const lx = nameLeft(m.x0), room = m.moment ? Infinity : Math.min(m.x1, w) - lx - 2
    if (naming && same(naming, mark) || room < 8) continue
    nameOn(m, m.text, lx, room, ink)
  }
  // the marker to be over the caret, a faint plus, lit pointed at, saying so; elsewhere, where a click would put one (a
  // moment's time; a range's, the selection, which shows already): a ghost of its line, faint, down its band's lanes,
  // as the caret's would be
  const blank = nameAt(L), plus = placeholder(L)
  if (plus) {
    c.globalAlpha = blank?.on ? 1 : .6
    c.fillStyle = color(blank?.on ? '--color-screen-bright' : '--color-screen-muted')
    c.fillText('+', plus.x0, plus.row.edge + plus.row.dir * NAMES)
    c.globalAlpha = 1
    if (blank?.on) say(plus.b > plus.a ? 'Name the selection' : 'Name the caret\'s place', plus.x1 + 6, plus.row.edge + plus.row.dir * NAMES)
  }
  if (blank && !blank.on && blank.a === blank.b && blank.x0 <= w) {
    c.fillStyle = color('--color-screen-caret')
    c.globalAlpha = .5
    for (const [, y, , lh] of L.all.filter(r => !tracks || r.i === focus)) c.fillRect(Math.round(blank.x0), y, 1, lh)
    c.globalAlpha = 1
  }
}
// The marker to be, over the caret in the edited band's head while that band is pointed at, where none is: a plus
// where its name would start, { row, a, b, x0, x1 } (a range's: the selection's, from its start); none while it plays,
// nor in a player's view, a band not pointed at
export function placeholder(L) {
  if (drag || naming || playhead != null || !banded() || !duration || pointedBand !== (tracks ? focus : 0)) return null
  const row = heads(L).find(s => s.i === (tracks ? focus : null)), [a, b] = selection && !band && selection[1] > selection[0] ? selection : [cursor, cursor]
  const x0 = nameLeft(X(a)), x1 = x0 + wide('+')
  return row && x0 <= lanesEnd(L) && !stripAt(x0 + 1, row.y + row.h / 2, L) && !stripAt(x1 - 1, row.y + row.h / 2, L) ? { row, a, b, x0, x1 } : null
}
// A name to write, pointed at in the edited band's head where no marker is: the marker to be, its plus or by it
// (placeholder, `on`), at the caret's time exactly; over the selection (no band), a range of it; elsewhere a moment,
// where a press there would put the caret. { row, x0, x1, a, b, on }, or null
export function nameAt(L, at = hovered) {
  if (!at || drag || naming || !banded() || !duration) return null
  const row = heads(L).find(s => s.i === (tracks ? focus : null)), [px, py] = at
  if (!row || py < row.y || py >= row.y + row.h || px < 0 || px > lanesEnd(L) || stripAt(px, py, L)) return null
  const plus = placeholder(L)
  if (plus && px >= plus.x0 - REACH && px <= plus.x1 + REACH) return { ...plus, x1: X(plus.b), on: true }
  const sel = selection && !band && selection[1] > selection[0] && px >= X(selection[0]) && px <= X(selection[1])
  const [a, b] = sel ? selection : [caretTo(px), caretTo(px)]
  return { row, x0: X(a), x1: X(b), a, b }
}
// A marker put where nameAt has it, at once (a click there): written, chosen, a moment's time the caret's, and its
// name asked for (onedit: the page's v.name), which it may well go without, its number shown then
export function placeMarker({ a, b }) {
  if (b === a) { select(0, 0); setCursor(a) }
  if (!onedit('label', { time: a, duration: b - a })) return
  // (the one just put: of its kind, the nearest, its time written to the zoom's step)
  assign({ chosen: markers.filter(m => !m.duration === !(b > a)).reduce((p, m) => !p || Math.abs(m.time - a) < Math.abs(p.time - a) ? m : p, null) })
  invalidate(true)
}
// A first marker's name asked for at `t` in the edited band's head (a track just made): a field there; Enter or a
// click away writes the marker with the name, nothing written none; Escape, none
export function askName(t) {
  const row = heads(lanes()).find(s => s.i === (tracks ? focus : null))
  if (!row || naming) return
  const input = named('', 'Name', nameLeft(X(t)), row.edge + row.dir * NAMES)
  naming = { time: t, duration: 0, track: tracks?.[focus]?.name, input }
  let done = false
  const end = keep => {
    if (done) return
    done = true
    input.remove()
    naming = null
    invalidate(true)
    const label = input.value.trim()
    if (keep && label) onedit('label', { time: t, duration: 0, label })
  }
  for (const type of ['pointerdown', 'click', 'contextmenu', 'wheel']) input.addEventListener(type, e => e.stopPropagation())
  input.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') end(true); else if (e.key === 'Escape') end(false) })
  input.addEventListener('blur', () => end(true))
  invalidate(true)
  input.focus()
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
// A field where a name is drawn, its text where the name's is (left at `lx`, its middle at `my`), as wide as it, plain:
// the name written on in place
function named(value, aria, lx, my) {
  const input = root.appendChild(Object.assign(document.createElement('input'), { className: 'marker-name', value, ariaLabel: aria, spellcheck: false }))
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
  const input = named(m.label || '', 'Name', nameLeft(X(placed(m) ?? m.time)), strip.edge + strip.dir * NAMES)
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
// Past full scale: zoomed out, a waveform lane's values beyond ±1 tinted red, where a sound clips; and on the time row,
// a red line under each stretch that clips
export function paintOvers(L) {
  const { w, h } = plot()
  c.fillStyle = color('--color-screen-error')
  c.globalAlpha = .07
  if (aview[1] > 1 || aview[0] < -1) for (const rect of L.wave) {
    const [, y, lw, lh] = rect, top = ay(rect, 1), low = ay(rect, 1, -1)
    if (top > y) c.fillRect(0, y, lw, top - y)
    if (low < y + lh) c.fillRect(0, low, lw, y + lh - low)
  }
  c.globalAlpha = 1
  // on the time row's top: under the picture, or ('band') the band's foot it is in
  const under = timeRow === 'band' ? underRow(L)?.y : h
  for (const [a, b] of clips) {
    const [p, q] = [moved(a), moved(b)].map(t => t == null ? null : Math.max(0, Math.min(w, x(t))))
    if (p != null && q != null && q >= 0 && p <= w && under != null) c.fillRect(Math.round(p), under, Math.max(1, Math.round(q - p)), 2)
  }
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
