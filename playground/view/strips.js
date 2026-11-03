import clock from '../time.js'
import { markLane, ownMarks, snappedTo, placed } from './data.js'
import { ghost, CHUNK, plot, spare, lanes, floor, inRoom, own, laneAt, roomLane } from './geometry.js'
import { fine, nearCue } from './gestures.js'
import { EDGE, FOOT, KINDS, mac, root, onedit, color, fades, sel2d, c, lookButton, rate, duration, units, hovered, markers, more, droppedNew, start, end, band, cursor, playhead, cues, snapping, clips, aview, levelUnits, data, tracks, focus, allLanes, sections, windows, lift, chosen, held, assign } from './model.js'
import { clipMarks } from './notes.js'
import { say, triangleAt, WASHED, washFrom, crossAt, lanesEnd, seenTo } from './overlay.js'
import { drag, hot } from './pointer.js'
import { W, moved, invalidate, wash } from './render.js'
import { x, X, time, digits, seen, stick, inside, fy, ay, sampled, decibel } from './scales.js'

// The strips under the lanes and across them: the measure, the fades at the view's edges, each band's look, the room
// under the tracks, the selection behind the sound, the cues, the markers and the names

// in the measuring red, where the pointer is, dashed out to the axes as Figma's guides: down to the time row, where
// its length is (paintRuler), and across to the level or frequency axis, where its value is
// `read`, a waveform's level there (waveAt), past the lane's edge: a small triangle at that edge pointing out to it
const DASHED = [4, 3]
export function paintMeasure({ t }, py, rects, read = null) {
  const px = X(t), { w, h } = plot(), y = Math.round(py)
  if (px < 0 || px > w) return
  c.fillStyle = gauge()
  for (let k = y; k < h; k += DASHED[0] + DASHED[1]) c.fillRect(px, k, 1, Math.min(DASHED[0], h - k))
  if (rects.some(r => inside(r, px, py))) for (let k = px; k < w; k += DASHED[0] + DASHED[1]) c.fillRect(k, y, Math.min(DASHED[0], w - k), 1)
  if (read?.past) triangleAt(px + .5, y + read.past * 5, -read.past)
}
// Held Alt over a waveform lane, the level measured: the waveform's at time `t`, the peak of its samples under the
// pixel on the pointer's side of the centre line, so a clip past the levels shown is measured as it is: { y, text,
// past } (y within the lane; past, 1 over its top, -1 under its foot, 0 inside); null where the lane is no waveform's,
// or the page holds no samples there (a long sound's let go), the pointer's then
export function waveAt(rect, t, py) {
  const x = data[rect.i]
  if (rect.kind !== 'wave' || !x || t == null) return null
  const k = (end - start) / plot().w * rate, i0 = Math.max(0, Math.floor(t * rate - k / 2)), i1 = Math.min(x.length, Math.ceil(t * rate + k / 2) + 1)
  if (i1 <= i0 || windows && Array.from({ length: Math.floor((i1 - 1) / CHUNK) - Math.floor(i0 / CHUNK) + 1 }, (_, j) => Math.floor(i0 / CHUNK) + j).some(j => windows.get(j) !== true)) return null
  const [, top, , lh] = rect, up = py < top + lh / 2
  let v = 0
  for (let i = i0; i < i1; i++) if (up ? x[i] > v : x[i] < v) v = x[i]
  const y = top + (aview[1] - v) / (aview[1] - aview[0]) * lh, past = y < top ? 1 : y > top + lh ? -1 : 0
  return { y: Math.max(top, Math.min(top + lh - 1, y)), past, text: levelUnits === 'linear' ? sampled(v) : decibel(20 * Math.log10(Math.abs(v)), 1, -99) }
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
  const f = floor(L), seen = duration && !tracks && f + FOOT <= plot().h, top = `${Math.round(f + 1)}px`, left = `${Math.round(plot().w + 1)}px`, kind = L.all[0]?.kind
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
// all, dragged as any is (liftAt)
const LIFT = 6
export const thumb = () => { const { h } = plot(), th = Math.max(24, h * h / (h + spare)); return { y: lift / spare * (h - th), h: th, room: h - th } }
export const liftAt = (px, py) => spare > 0 && px >= W - LIFT && py <= plot().h
export function paintLift(at) {
  if (!spare) return
  const t = thumb(), on = drag?.lifting || at && liftAt(...at)
  c.fillStyle = color('--color-screen-rule')
  c.fillRect(W - 4, 0, 3, plot().h)
  c.fillStyle = color(on ? '--color-screen-bright' : '--color-screen-soft')
  c.fillRect(W - 4, Math.round(t.y), 3, Math.round(t.h))
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
// Cues: shown only where they matter, never as a forest over the sound: the one dragged, bright where it will land;
// those a dragged edge or caret sits on (`lit`), and faint the ones either side of it (beside), as they are either side
// of the pointer plain over the edited track's lanes, the one a press would snap to brighter; held ⌘ (Ctrl), the one
// under the pointer a press would take; held Alt (`all`), every one, faint, as Figma shows what there is to snap to.
// The one a press would snap to, a sound's start, a hit or its end, with a short wash on the side its sound is on
// (washFrom)
const on = (lit, px) => lit.some(t => Math.abs(x(t) - px) < .5)
// The time a drag moves, as the caret or a range's end: the caret held, an edge, a range dragged out (Shift held before
// the press or after it), a marker's triangle moved (a range's end, the one held), else null
export const dragged = () => drag?.caret ? cursor : drag?.resizing || drag?.anchor != null && drag.moved && !drag.box ? drag.hear
  : drag?.marker != null && drag.moved ? drag.edge ? drag.end : drag.to : null
// the time dragged, or the pointer's plain over the edited track's lanes, snapping on (not held ⌘, which aims finely,
// nothing snapping), where a press there would put the caret
const aimedAt = () => dragged() ?? (!drag && hovered && snapping && !editing() && laneAt(own(lanes()), hovered[1]) >= 0 ? time(hovered[0]) : null)
// the cues this scale shows either side of it, faint, where it would go next, as the one it is on lights
function beside() {
  const t = aimedAt(), list = t == null ? [] : seen()
  const p = X(t), before = list.findLast(i => X(cues[i]) < p - .5), after = list.find(i => X(cues[i]) > p + .5)
  return [before, after].filter(i => i != null)
}
export const editing = (keys = held) => !!(mac ? keys.metaKey : keys.ctrlKey)
export function paintCues(rects, lit, all = false) {
  const hover = drag ? null : aimedAt(), onto = hover == null ? -1 : cues?.indexOf(stick(hover)?.t) ?? -1
  const near = !drag && hovered ? nearCue(...hovered, held) : -1, shown = new Set(all ? seen() : beside())
  for (const [i, t] of (cues ?? []).entries()) {
    const moving = drag?.cue === i, at = moving ? drag.to : moved(t), px = X(at)
    // a dragged line on it is that line alone, white, the crosses saying it snapped; held Alt, the time measured to lit
    if (at == null || px < 0 || px > plot().w || drag && on(lit, px) || !(moving || i === near || i === onto || on(lit, px) || shown.has(i))) continue
    const a = moving || on(lit, px) ? 1 : i === near || i === onto ? .7 : .4
    if (i === onto) washFrom(px, snappedTo(t).side, rects, a * WASHED)
    c.fillStyle = accent()
    c.globalAlpha = a
    for (const [, ly, , lh] of rects) c.fillRect(px, ly, 1, lh)
    c.globalAlpha = 1
  }
}
export function paintMarkers(all, lit, pointedAt) {
  const lanesOf = m => markLane(m) == null ? all : [all[markLane(m)]].filter(Boolean), ghosts = new Map()
  const near = hovered && !drag ? markAt(...hovered) : null, edge = pointedAt?.kind === 'mark' && hovered && !drag ? notch(pointedAt, hovered[0]) : -1
  if (near != null) ghosts.set(X(near), tracks ? [all[focus]].filter(Boolean) : all)
  if (edge >= 0 || pointedAt?.moment && !drag) ghosts.set(edge === 1 ? pointedAt.x1 : pointedAt.x0, pointedAt.rects)
  if (drag?.marker != null && drag.moved) ghosts.set(X(dragged()), lanesOf(markers[drag.marker]))
  c.fillStyle = color('--color-screen-caret')
  c.globalAlpha = .5
  for (const [px, rects] of ghosts) if (px >= 0 && px <= plot().w && !on(lit, px)) for (const [, y, , lh] of rects) c.fillRect(px, y, 1, lh)
  c.globalAlpha = 1
}
// two markers one: the same track's, of the same kind at the same time, to half a millisecond (an output's, from the
// time written)
export const same = (m, n) => m.track === n.track && !m.duration === !n.duration && Math.abs(m.time - n.time) < 5e-4
// The edited track's marker line in its lanes within EDGE px of the pointer, a moment's or a range's end: its time,
// where a press puts the caret; or null. Snapping as a drag does (stick): not with it off, nor while ⌘ aims finely
export function markAt(px, py) {
  if (!snapping || fine() || py > plot().h) return null
  let best = null
  for (const t of ownMarks().map(t => moved(t) ?? t)) if (Math.abs(x(t) - px) <= EDGE && (best == null || Math.abs(x(t) - px) < Math.abs(x(best) - px))) best = t
  return best
}
// ── The marks strip: each band's foot row, under its lanes, a map of what is marked on its time, as Photoshop's split
// slider marks a range under its bar: a range ◢ its name ◣, small half-triangles as tall as its name's capitals
// hanging from the lanes' foot, their upright edges at its start and its end (a selection's edges going on down them),
// its name after the first, cut short where it has no room, nothing between them, lit while it is active (its stretch
// selected, the marker chosen or dragged); a moment ▲ its name, the two halves one at its time; the takes' place as a
// range's, their numbers at its end inside it (placeTakes). Pressed, a range's or the takes' place selected and
// heard while held (down); a marker's triangle dragged, it moves (a range's, that end; a moment's held Alt, pulled
// apart into a range), snapping as an edge does, clicked, the caret goes to it and the marker is chosen; a name
// clicked, named in place (clicked); a press elsewhere in the strip the band's height (footAt). Over the sound,
// nothing of them but one pointed at, its stretch as a press would select it, or dragged, and a line as the caret
// would go (paintMarkers, marksOf)
export const TRI = 5, MARKED = 9, NAMES = 6, NAMEH = 14
// where each marker's name is drawn, [{ i, from, to, y }] px: a click there names it anew (clicked)
let labels = []
export const labelAt = (px, py) => labels.find(n => py >= n.y && py < n.y + FOOT && px >= n.from && px <= n.to)?.i ?? -1
// where a marker's name starts, its start at `x0`: past a moment's triangle, inside a range's, held in sight
const nameLeft = (moment, x0) => moment ? x0 + TRI + 3 : Math.max(x0, 0) + 4
// each band's strip: { y, i }, its top (its lanes' foot) and its track's index (null: a sound's)
export const strips = L => tracks ? L.all.map(([, y, , lh], i) => ({ y: y + lh, i })) : L.all.length ? [{ y: floor(L), i: null }] : []
// what the strips hold: [{ kind: 'mark' (a marker's, `i` its index; a moment's x1 its x0, `moment`; one pulled apart
// into a range, a range) or 'takes' (`i`, the section's), x0, x1, y, rects }]
export function stripped(L) {
  const of = new Map(strips(L).map(s => [s.i, s])), lanesOf = i => i == null ? L.all : [L.all[i]].filter(Boolean), out = []
  for (const [i, m] of markers.entries()) {
    const held = drag?.marker === i, at = held ? drag.to : placed(m), end = held ? drag.end : at + (m.duration ?? 0), s = of.get(markLane(m))
    if (s && at != null) out.push({ kind: 'mark', i, x0: X(at), x1: X(end), moment: !(end > at), y: s.y, rects: lanesOf(markLane(m)) })
  }
  sections.forEach((t, i) => { const s = of.get(t.lane ?? null); if (s) out.push({ kind: 'takes', i, x0: X(t.at), x1: X(Math.min(t.end, duration)), y: s.y, rects: lanesOf(t.lane ?? null) }) })
  return out
}
// which of a marker's triangles `px` is on: a moment's or a range's start's, 0; a range's end's, 1; else -1
export function notch(m, px) {
  if (m.kind !== 'mark') return -1
  if (m.moment) return Math.abs(px - m.x0) <= TRI + 1 ? 0 : -1
  const start = px >= m.x0 - TRI && px <= m.x0 + 2, end = px >= m.x1 - 1 && px <= m.x1 + TRI + 1
  return start && (!end || px <= (m.x0 + m.x1) / 2) ? 0 : end ? 1 : -1
}
// what a press in a strip takes: a marker's triangle, a name, a range or the takes' place under it; or null
export function stripAt(px, py, L = lanes()) {
  if (py > plot().h) return null
  const row = stripped(L).filter(m => py >= m.y && py < m.y + FOOT), named = labelAt(px, py)
  return row.find(m => notch(m, px) >= 0) ?? row.find(m => m.kind === 'mark' && m.i === named) ?? row.find(m => px >= m.x0 - TRI && px <= m.x1 + TRI) ?? null
}
// a marker's triangles standing on `y`, `h` px tall, in the fill's colour: a range's ◢ ending with x0's pixel and ◣
// from x1's (a line at a time, its pixel: the caret's, an edge's, under each), a moment's ▲ on x0's pixel
function bracket(x0, x1, y, h, moment) {
  c.beginPath()
  if (moment) { c.moveTo(x0 + .5 - TRI, y); c.lineTo(x0 + .5, y - h); c.lineTo(x0 + .5 + TRI, y); c.closePath() }
  else {
    c.moveTo(x0 + 1, y); c.lineTo(x0 + 1, y - h); c.lineTo(x0 + 1 - TRI, y); c.closePath()
    c.moveTo(x1, y); c.lineTo(x1, y - h); c.lineTo(x1 + TRI, y); c.closePath()
  }
  c.fill()
}
export function paintStrips(L, pointedAt, selected) {
  // the edited band's (every band's through every lane), the others' faint
  const w = lanesEnd(L), edited = i => !tracks || allLanes || i === focus
  c.textAlign = 'left'
  labels = []
  for (const m of stripped(L)) {
    if (m.x1 + TRI < 0 || m.x0 - TRI > w) continue
    // pointed at, lit, its stretch lit over the sound alone (marksOf); active (its stretch selected, the marker chosen
    // or dragged), lit too, nothing between its triangles either way (the accent is the hints' alone)
    const mark = m.kind === 'mark' && markers[m.i], active = selected(m) || mark && (chosen && same(chosen, mark) || drag?.marker === m.i)
    c.fillStyle = color(active || pointedAt?.kind === m.kind && pointedAt.i === m.i ? '--color-screen-bright' : !mark || edited(markLane(mark)) ? '--color-screen-mark' : '--color-screen-muted')
    bracket(m.x0, m.x1, m.y + MARKED, MARKED, m.moment)
    // its name, cut short where a range's end leaves too little room (none while it is written in place), where a
    // click names it anew (labelAt)
    const lx = nameLeft(m.moment, m.x0), room = m.moment ? Infinity : Math.min(m.x1, w) - lx - 6
    if (mark?.label && !(naming && same(naming, mark)) && room >= 12) {
      let text = mark.label
      while (text.length > 1 && c.measureText(text).width > room) text = text.slice(0, -2) + '…'
      const tw = c.measureText(text).width
      c.fillText(text, lx, m.y + NAMES)
      labels.push({ i: m.i, from: lx - 2, to: lx + tw + 2, y: m.y })
    }
  }
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
  const fit = () => { input.style.width = `${Math.max(2, input.value.length + 1)}ch` }
  Object.assign(input.style, { left: `${Math.round(lx)}px`, top: `${fieldTop(my, NAMEH)}px`, height: `${NAMEH}px`, lineHeight: `${NAMEH}px`, font: label() })
  fit()
  input.addEventListener('input', fit)
  return input
}
export function rename(i) {
  const m = markers[i], strip = m && strips(lanes()).find(s => s.i === markLane(m))
  if (!strip) return
  naming?.input.remove()
  const input = named(m.label || '', 'Name', nameLeft(!m.duration, X(placed(m) ?? m.time)), strip.y + NAMES)
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
// under the lanes, a red line under each stretch that clips
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
  for (const [a, b] of clips) {
    const [p, q] = [moved(a), moved(b)].map(t => t == null ? null : Math.max(0, Math.min(w, x(t))))
    if (p != null && q != null && q >= 0 && p <= w) c.fillRect(Math.round(p), h, Math.max(1, Math.round(q - p)), 2)
  }
  // and in each lane where its samples cross full scale, a small cross on the line they cross, where they first do
  c.strokeStyle = c.fillStyle
  c.lineWidth = 1.5
  for (const { t, i, sign } of clipMarks()) {
    const at = moved(t), rect = L.wave.find(r => r.i === i), py = rect && ay(rect, 1, sign)
    if (at == null || !rect || py < rect[1] || py > rect[1] + rect[3] || x(at) < 0 || x(at) > w) continue
    crossAt(X(at) + .5, py)
  }
  c.lineWidth = 1
}
