import { CURVES } from '../ops.js'
import { lightness } from '../tint.js'
import { ownMarks, snappedTo, SIDES, unwritten } from './data.js'
import { frozen, ghost, layout, chips, takeHot, placeTakes, placeFork, hotBand, pointedBand, plot, merged, spare, lanes, extent, own, through, banded, footH, veils, placeFrozen, roomLane, rowTop } from './geometry.js'
import { ONTO, INSET, midiOf, noteOf, STRETCH, root, scaled, within, ruler, hint, color, fades, rowStrip, marksCanvas, meterStrip, barStrip, overlayKept, marksKept, selectKept, oc, mc, sel2d, c, lookButton, specs, rate, duration, hovered, show, arriving, more, dropped, meters, recording, pieces, start, end, selection, band, cursor, playhead, guides, nudge, cues, envelope, fadeCurve, cueKinds, gripMode, LEVEL_STEP, picked, tracks, focus, across, scroll, noted, held, assign } from './model.js'
import { pitchRange, semis, pitchSays, intonationSays, median, pitched, clampY, paintGuide, BLACK, paintRoll, paintLine, bent, toneAt, paintContour, labelled } from './notes.js'
import { drag, touch, hot, opening } from './pointer.js'
import { decibels, drawn, W, H, dpr, half, invalidate, tape, rolled, onTape, running, wash, caretColour, rgba, shades } from './render.js'
import { paintRuler, layHead, awayOf, onAway, paintAway, paintBar, barLight } from './ruler.js'
import { gutter, onBar, X, time, free, snapF, seen, stick, stuck, pitchLine, inside, fy, yf, rowOf, keyY, keyRows, ay, ampLanes, pitchLanes, ticks, paintFoot, INTO, room, beside, axisMarks, hzMarks, noteMarks, levelMarks, levelTicks, reads, decibel, level, measured, probe, setRange } from './scales.js'
import { paintMeasure, waveAt, ghostOf, placeFades, placeLook, paintRoom, paintLift, tag, accent, gauge, size, label, paintSelection, highlight, paintEdge, stamp, dragged, editing, paintCues, paintMarkers, heads, stripped, stripAt, kin, paintStrips, naming, paintOvers, paintClipped } from './strips.js'

// The overlay, over the reel: the axes, the pointer's readouts, what is measured; on the reel, the marks drawn in time
// (markers, cues, carets, a range's edges) and its handles; the meters and the keys by the lanes' end

let settle = 0
// The overlay: selection, guides, what shows besides the sound, caret, playhead, the pointer's readouts, axes. What a
// drag, a handle or an edge does is said in the page's hints, by the pointer (say), and goes when nothing says it.
let said = false
const self = {}
export function say(text, px, py, align = 'left', icon = '') {
  const r = root.getBoundingClientRect(), on = c === mc ? rolled / dpr : 0
  hint?.show(text, { x: r.left + px - on, y: r.top + py }, self, align, icon)
  said = true
}
// Both layers drawn: what is in time on the reel's marks, in the tape's geometry, the pointer where it is on the tape;
// then the overlay, in the view's
export function paint(L) {
  said = false
  layout(L)
  hotBand(L)
  const s = scene(L)
  if (tape) {
    assign({ c: mc })
    try { rowStrip.draw(() => marksKept.draw(() => selectKept.draw(() => onTape(() => marksOf(lanes(), s), tape)))) } finally { assign({ c: oc }) }
  }
  overlayKept.draw(() => overlayOf(L, s))
  const { w } = plot()
  onStrip(meterStrip, meterAt(METER) - 2, 0, w, H, () => duration && metered(L) && (meters || show.keys && L.notes.length) && paintMeters(L))
  onStrip(barStrip, 0, H - footH(), W, H, () => duration && paintBar())
  barLight()
  if (!said) hint?.hide(self)
}
// A strip of what changes as it plays, a canvas of its own the strip's size (x0 to x1, y0 to y1, CSS px in the view),
// drawn on in the view's geometry: frame after frame only it is laid and sent to the compositor, not the overlay
function onStrip(strip, x0, y0, x1, y1, fn) {
  const canvas = strip.g.canvas, px = Math.floor(x0 * dpr), py = Math.floor(y0 * dpr), cw = Math.max(0, Math.ceil(x1 * dpr) - px), ch = Math.max(0, Math.ceil(y1 * dpr) - py)
  if (canvas.width !== cw || canvas.height !== ch) { canvas.width = cw; canvas.height = ch }
  if (strip.at?.join() !== [px, py, cw, ch].join()) { strip.at = [px, py, cw, ch]; Object.assign(canvas.style, { left: `${px / dpr}px`, top: `${py / dpr}px`, width: `${cw / dpr}px`, height: `${ch / dpr}px` }) }
  assign({ c: strip.g })
  try { strip.draw(() => { c.setTransform(dpr, 0, 0, dpr, -px, -py); fn() }) } finally { assign({ c: oc }) }
}
// The time row on the reel, from the lanes' foot down, the tape's width (laid as the marks are, paint): drawn on in the
// tape's geometry, as the marks are
function onRow(fn) {
  const top = rowTop(), bottom = H
  const canvas = rowStrip.g.canvas, py = Math.floor(top * dpr), cw = marksCanvas.width, ch = Math.max(0, Math.round(bottom * dpr) - py)
  if (canvas.width !== cw || canvas.height !== ch) { canvas.width = cw; canvas.height = ch }
  if (rowStrip.at !== py) { rowStrip.at = py; Object.assign(canvas.style, { top: `${py / dpr}px`, height: `${ch / dpr}px` }) }
  const was = c
  assign({ c: rowStrip.g })
  try { c.setTransform(dpr, 0, 0, dpr, 0, -py); c.font = was.font; c.textBaseline = was.textBaseline; return fn() } finally { assign({ c: was }) }
}
// What both draw from, in the view's geometry: the selection as a drag has it, the pointer and what it measures
function scene(L) {
  const { w } = plot(), all = L.all
  // a crossfade dragged out of a range's start takes what is before it out: the range goes back by as much
  const back = drag?.cross && drag.fade === 'in' ? drag.span[1] - drag.span[0] : 0
  const sel = drag?.carry && drag.moved && !drag.out && drag.into == null ? [drag.to, drag.to + drag.b - drag.a] : drag?.stretch ? [drag.a, drag.to] : back ? [drag.a - back, drag.b - back] : selection
  // the pointer, read out on the axes: its time on the time row, as the script will get it (a dragged edge's, a snapped
  // one's), the labels there giving way to it; its level or frequency by its lane
  const at = hovered && hovered[0] >= 0 && hovered[0] <= w && !drag?.scroll && !onBar(...hovered) && !onAway(...hovered) ? hovered : null, lane = at && all.find(r => inside(r, ...at))
  // (past the end too, where nothing is yet: the time there all the same)
  // (where a press puts the caret: its ghost, ghostOf, on what it is by)
  const pointed = at && (drag?.span ? drag.p : drag?.stretch ? drag.to : drag?.hear ?? (ghostOf()?.t ?? stuck(free(time(at[0])))))
  // held ⌘ (Ctrl) over the picture, aiming, as Figma's Alt measures: every cue, where a press would snap (the caret
  // held, an edge or a range's end, dragged, where it would), the one under the pointer a press takes, and how far the
  // pointer is from what is selected, or from the caret (measured)
  const aiming = !!hovered && (!drag || dragged() != null) && editing(held), measure = !!hovered && !drag && editing(held) && lane ? measured(pointed) : null
  probe(measure && L.spec.includes(lane) && playhead == null ? pointed : null)
  // the times a drag's edges are at, or the caret dragged: the cues and markers they sit on light
  const lit = drag?.caret ? [cursor] : drag?.anchor != null || drag?.carry || drag?.stretch ? sel || [] : drag?.span || []
  return { sel, at, lane: at ? all.indexOf(lane) : -1, pointed, aiming, measure, ends: new Set(measure?.spans.flat()), lit }
}
// What is drawn in time, on the reel: the selection, the guides, the time row's times and the edges and caret on it,
// the cues, the markers, the lines edited, the carets, a range's handles; the pointer as it is on the tape
function marksOf(L, { sel, pointed, aiming, measure, ends, lit }) {
  const { w } = plot()
  for (const g of [c, sel2d]) { g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H) }
  if (!duration && !unwritten()) return
  c.font = label()
  c.textBaseline = 'middle'
  const all = L.all, dim = color('--color-screen-muted'), T = own(L), mine = T.all
  const at = hovered && hovered[0] >= 0 && !drag?.scroll ? hovered : null
  // the notes lanes' keys and notes, under all that is drawn over them, a muted track's veil too
  for (const rect of L.notes) paintRoll(rect, lanesEnd(L), !tracks || rect.i === focus, sel)
  // a muted track's spectrogram or notes veiled, under all that is drawn over them (its waveform drawn dim itself,
  // drawWave: the ground under it as it is)
  if (tracks) {
    c.fillStyle = color('--color-screen')
    c.globalAlpha = .6
    all.forEach((rect, i) => tracks[i]?.muted && rect.kind !== 'wave' && c.fillRect(0, rect[1], lanesEnd(L), rect[3]))
    c.globalAlpha = 1
  }
  // a waveform that ends before the view does (a track's before the longest, the sound's in the room zoomed out past
  // it), its centre line on, faint, to the view's end, as the room's new track's is: nothing there yet
  c.fillStyle = color('--color-screen-wave')
  c.globalAlpha = .35
  for (const r of L.wave) { const from = Math.max(0, X(tracks ? tracks[r.i]?.end ?? duration : duration)), to = lanesEnd(L); if (to > from) c.fillRect(from, Math.round(r[1] + r[3] / 2), to - from, 1) }
  c.globalAlpha = 1
  // what runs through time is drawn in each lane (`rects`: all of them, or the edited track's), never across the gap
  // between two, which holds no sound
  const across = (px, width, rects = all) => { for (const [, y, , lh] of rects) c.fillRect(px, y, width, lh) }
  // selection: a time range in every lane, or a box on the spectrogram
  paintSelection(through(L), sel)
  // a range or the takes' place pointed at in the strip (or their numbers), its stretch as a press would select it,
  // but where it is selected already; a range whose end is dragged, as it goes
  const selected = rect => wash(L.spec.includes(rect)), hotTake = takeHot(L), hotMark = drag || !hovered ? null : stripAt(...hovered, L)
  const pointedAt = hotTake >= 0 ? stripped(L).find(m => m.kind === 'takes' && m.i === hotTake) : drag?.marker != null ? stripped(L).find(m => m.kind === 'mark' && m.i === drag.marker) : hotMark
  const S = through(L), over = (r, p) => !!r && Math.abs(X(r[0]) - p.x0) < 1 && Math.abs(X(r[1]) - p.x1) < 1
  const already = p => !band && over(sel, p) && p.rects.every(r => S.all.includes(r))
  // (a moment is a time, no stretch: its line, as the caret's would be, paintMarkers); every range of its name with it
  const group = pointedAt?.kind === 'mark' && !drag ? kin(pointedAt.i) : []
  const alike = pointedAt ? [pointedAt, ...stripped(L).filter(m => m.kind === 'mark' && m.i !== pointedAt.i && group.includes(m.i))] : []
  for (const p of alike) if (!p.moment && !already(p) && !more.some(r => over(r, p))) highlight(p.rects, p.x0, p.x1, selected)
  // audio carried into another track's lane: where it lands there, its length lit, edged as a clip
  if (drag?.carry && drag.moved && drag.into != null && all[drag.into]) {
    const [, y, , lh] = all[drag.into], p = Math.max(0, X(drag.to)), q = Math.min(lanesEnd(L), X(drag.to + drag.b - drag.a))
    if (q > p) { sel2d.fillStyle = wash(); sel2d.fillRect(p, y, q - p, lh); c.fillStyle = color('--color-screen-bright'); c.fillRect(p, y, 1, lh); c.fillRect(q - 1, y, 1, lh) }
  }
  // the edited track's; one of the tracks mixed (`every`: a level the readout reads), on every lane
  if (show.guides) for (const guide of guides) paintGuide(guide, guide.every ? L : T)
  // a fade as it is dragged, the waveform under it drawn faded; a crossfade, its two curves across the seam
  if (drag?.span && drag.cross) { const [p, q] = drag.span, h = half(p, q); paintGuide({ ramps: [[p - h, p + h, 'out', 'equal'], [p - h, p + h, 'in', 'equal']] }, T) }
  else if (drag?.span) paintGuide({ ramps: [[...drag.span, drag.fade, fadeCurve]] }, T)
  // the times on the row, each tick the colour of the line it runs on from: the pointer's, where a press would put
  // the caret (what a drag moves, as it goes: the caret, an edge, a marker), the selection's start and end (an edge lit,
  // `hot` or dragged, bright); no caret's time of its own, the pointer's being the one asked about (the playhead's its
  // own layer's); a file held over the picture, where it goes in; an end measured from in the accent (gauge)
  const caret = color('--color-screen-caret'), bright = color('--color-screen-bright'), here = caretColour()
  const litEdge = drag?.resizing && sel ? sel[sel[0] === drag.anchor ? 1 : 0] : !drag && hot ? hot.t : null
  const edges = sel && !drag?.span ? sel.map((t, edge) => ({ t, fill: t === litEdge ? bright : caret, edge, of: sel })) : []
  const apart = t => !edges.some(m => X(m.t) === X(t))
  onRow(() => {
    paintRuler([
      ...(at && apart(pointed) ? [{ t: pointed, fill: drag ? bright : caret }] : []),
      ...edges,
      ...(dropped != null ? [{ t: dropped, fill: accent() }] : [])
    ].map(m => ends.has(m.t) ? { ...m, fill: gauge(), keep: true } : m), measure?.spans, true)
    paintClipped()
  })
  const hints = paintCues(mine, measure ? [...lit, measure.t] : lit, aiming)
  paintMarkers(L, lit, pointedAt, hints)
  paintStrips(L, pointedAt, already)
  paintOvers(L)
  // what is edited over the sound: its level (the gain line) or, editing pitch, its pitch (the pitch line on the
  // waveform, the pitch curve on the spectrogram)
  if (pitchLine()) { paintLine(T.wave); paintContour(pitchLanes(T)) }
  else if (show.gain && (envelope || drag?.points)) paintLine(ampLanes(T))
  // a line in each lane: the caret (and the others beside it); while an output arrives, where it has come to. With a
  // band selected on the spectrogram, the caret runs through the band alone, which is what plays. The caret in the
  // edited track's lane; the playhead, the caret moving, is its own layer's (slide). On the sheet (?ui= axis inside),
  // which runs to the frame's edges, one at an edge (the caret at 0:00, or at the sound's end with no room after it)
  // is held a pixel in: never on the frame's own last column nor past it, where it is not seen; the grid and the times
  // stay where they are
  const line = (t, fill, only = null, lanes = T) => {
    const at = X(t), px = within ? Math.max(1, Math.min(lanesEnd(L) - 2, at)) : at
    if (at < 0 || at > w) return
    c.fillStyle = fill
    if (!only) return across(px, 1, lanes.all)
    for (const rect of lanes.spec) { const y0 = Math.max(rect[1], fy(rect, only[1])), y1 = Math.min(rect[1] + rect[3], fy(rect, only[0])); c.fillRect(px, y0, 1, y1 - y0) }
  }
  if (arriving) line(arriving.length / rate, color('--color-screen-soft'), null, L)
  // what is still to come of it, where its length is known: the centre line across it, as silence has it
  if (arriving && arriving.total > arriving.length) {
    const a = Math.max(0, X(arriving.length / rate) + 1), b = Math.min(lanesEnd(L), X(arriving.total / rate))
    c.fillStyle = dim
    c.globalAlpha = .5
    if (b > a) for (const rect of L.wave) c.fillRect(a, Math.round(ay(rect, 0)), b - a, 1)
    c.globalAlpha = 1
  }
  if (playhead == null) line(cursor, here, band, ghost ? { all: [roomLane(L)].filter(Boolean), spec: [] } : T)
  // in the room, the caret a new track's: a plus by its top
  const room = ghost && playhead == null && roomLane(L)
  if (room) { c.fillStyle = here; c.fillRect(X(cursor) + 4, room[1] + 5, 7, 1); c.fillRect(X(cursor) + 7, room[1] + 2, 1, 7) }
  for (const r of more) if (r.length === 2 && r[0] === r[1]) line(r[0], here)
  if (!ghost) paintGrips(T, at)
  paintEdge(S, sel)
  // what is dragged gone onto a cue or a marker: a small cross where it went, the line itself its own colour, one snap
  // for all that is there (a cue within ONTO px of a marker, as stick has it, with it). A cue there, where the line
  // meets the waveform in each lane, at the waveform's top and foot
  // (a sound's start, where it rises from nothing, one on the centre line), a lane with no waveform at its top and
  // foot; a marker or the takes' place, centred on the lanes' edge, its name lit in the head (paintStrips). To the
  // side the sound it went onto is, a faint wash fading from it. In the accent, as the cues' lines are: hints
  const onto = dragged(), stuckTo = onto != null && stick(onto)
  if (stuckTo?.d < .5) {
    const rects = S.all, px = X(onto), here = t => Math.abs(X(t) - px) < 1, { side } = snappedTo(stuckTo.t)
    const cue = seen().find(i => Math.abs(X(cues[i]) - px) <= ONTO), head = ownMarks().some(here) ? heads(L).find(s => s.i === (tracks ? focus : null))?.edge : null
    // a clip's cross alike (paintOvers): a line a pixel wide, on pixels' middles
    c.strokeStyle = accent()
    c.lineWidth = 1
    if (head != null) crossAt(px + .5, Math.round(head) + .5)
    if (cue != null || head == null) for (const rect of rects) {
      const [, y, , lh] = rect, top = waveAt(rect, onto, y), low = top && waveAt(rect, onto, y + lh)
      for (const py of low ? [top.y, low.y] : [y + 3, y + lh - 3]) crossAt(px + .5, Math.round(py) + .5)
    }
    washFrom(px, cue != null ? SIDES[cueKinds[cue]] : side, rects, WASHED)
  }
}
// to the side the sound is of a line at `px` (`side`: 1 after it, -1 before, none: no wash), a wash of the accent
// fading from `a` to nothing WASH px off, a pixel clear of the line, so the line is its own colour whole. Each
// gradient kept by where it is and how strong: a frame drawn as the last is then the same list (kept.js), the marks
// not laid again as the reel follows the playhead under a pointer at rest
export const WASH = 8, WASHED = .25, washes = new Map()
export function washFrom(px, side, rects, a) {
  if (!side) return
  const from = px + (side > 0 ? 2 : -1), to = from + side * WASH, fill = accent(), key = `${from} ${to} ${a} ${fill}`
  let g = washes.get(key)
  if (!g) {
    if (washes.size > 64) washes.clear()
    const [r, gr, b] = rgba(fill).map(v => Math.round(v * 255)), tint = a => `rgb(${r} ${gr} ${b} / ${a})`
    g = c.createLinearGradient(from, 0, to, 0)
    g.addColorStop(0, tint(a)); g.addColorStop(1, tint(0))
    washes.set(key, g)
  }
  c.fillStyle = g
  for (const [, y, , lh] of rects) c.fillRect(Math.min(from, to), y, WASH, lh)
}
// a small cross, 4 px across (from one pixel's middle to another's, at a pixel's middle: crisp), in the stroke's colour
export function crossAt(px, py) {
  c.beginPath()
  c.moveTo(px - 2, py - 2); c.lineTo(px + 2, py + 2); c.moveTo(px - 2, py + 2); c.lineTo(px + 2, py - 2)
  c.stroke()
}
// What stays as the reel moves, in the view's geometry: the pointer's time and what it measures on the time row, the
// playhead's time, a file held over the picture, what is out of sight, the meters, the axes and the
// pointer's values on them, what a drag or an edge says
function overlayOf(L, { at, lane: li, measure, ends, pointed }) {
  const { w } = plot()
  c.setTransform(dpr, 0, 0, dpr, 0, 0)
  c.clearRect(0, 0, W, H)
  away = null
  if (!duration) { for (const el of [...veils, ...chips, ...fades, lookButton]) el.hidden = true; if (!unwritten()) return }
  away = awayOf(L)
  c.font = label()
  c.textBaseline = 'middle'
  const all = L.all, T = own(L), mine = T.all, lane = li >= 0 ? all[li] : null
  const caret = color('--color-screen-caret'), bright = color('--color-screen-bright')
  // the playhead's tick and time, its own layer's (layHead)
  if (playhead != null) layHead(L, paintRuler([{ t: playhead, at: playhead + nudge, fill: ends.has(playhead) ? gauge() : bright, head: true }], [], false))
  // a file held over the picture: where it goes in, a caret of its own, as a text editor shows where a drop lands
  if (dropped != null) { c.fillStyle = accent(); for (const [, y, , lh] of mine) c.fillRect(X(dropped), y, 2, lh); c.font = label(); tag('Insert here', X(dropped) + 6, extent(mine)[0] + 8, 'left', accent()) }
  if (away) paintAway(!drag && !!hovered && onAway(...hovered))
  // what is drawn of the lanes ends at the time row: a band scrolled past it, cut there; within the sheet, where the
  // row starts at the lanes' foot, there (a value, a tag, nothing of theirs over a time)
  c.save()
  c.beginPath()
  c.rect(0, 0, W, rowTop())
  c.clip()
  try { lanesOver() } finally { c.restore() }
  // (but the last lane's foot value, written under its line, in the time row's right end: scales.js footRoom)
  paintFoot()
  function lanesOver() {
    placeLook(L)
    placeFades(L)
    placeFrozen(L)
    placeTakes(L)
    placeFork(L)
    paintRoom(L, at)
    endLanes(L)
    // (the pointer over the bar is past the picture's width, where `at` stops)
    paintLift(!drag && hovered)
    // held ⌘, the pointer's guides out to the axes, at once, wherever it is over a lane: with what it measures, or on
    // the caret with nothing to; and as a drag sets a time, the caret held, an edge, a range Shift goes on with
    const guide = measure ?? (at && editing(held) ? dragged() != null ? { t: dragged() } : li >= 0 ? { t: pointed } : null : null)
    // over a waveform, the level read is the waveform's at the pointer's time (waveAt); held ⌘ or Ctrl, aiming, the
    // pointer's own, where its guide runs across
    const read = lane && !editing(held) && !held.ctrlKey ? waveAt(lane, time(at[0]), at[1]) : null
    if (guide) paintMeasure(guide, at[1], T.all)
    // a selection's edge under the pointer says which it is and where, held Alt its end what it does; a caret's line
    // held Alt, that silence opens there
    if (at && lane && hot && !drag) {
      const { t, edge } = hot, text = `${!edge ? 'Start' : held.altKey ? `${gripName('stretch')}, end` : 'End'} ${stamp(t)}`, ex = X(t)
      say(text, edge ? ex - 6 : ex + 6, clampY(lane, at[1]), edge ? 'right' : 'left')
    }
    if (at && lane && opening && !drag) say(`Insert silence at ${stamp(cursor)}`, X(cursor) + 6, clampY(lane, at[1]))
    // right axis: levels by the waveform, frequencies by the spectrogram (or the voice range for pitch), each label
    // under its tick
    c.textAlign = 'left'
    // the labels give way to the value read where it is written: at the waveform's level read, else the pointer's
    const near = rect => rect === lane ? Math.round(read?.y ?? at[1]) : null
    // the levels of the band pointed at (its head too): one scale in sight, not every lane's; with none pointed at,
    // none at all, the picture a player's then (embedded, the picture all there is: always)
    const bands = !banded() ? all : pointedBand < 0 ? [] : tracks ? [all[pointedBand]] : all
    for (const rect of bands.filter(r => r.kind === 'wave')) ticks(rect, levelMarks(rect), near(rect), levelTicks(rect))
    for (const rect of bands.filter(r => r.kind === 'spec')) ticks(rect, hzMarks(rect), near(rect))
    for (const rect of bands.filter(r => r.kind === 'notes')) ticks(rect, noteMarks(rect), near(rect))
    // the pointer's values; what a drag does, in a few words by it
    c.textAlign = 'left'
    // what a drag does, by the pointer wherever it is: past the picture's edge too, where silence is pulled out to
    const doing = drag && hovered && acting()
    if (doing) say(doing, hovered[0] + 12, hovered[1] - 16)
    // the pointer's frequency or level by its mark, as the axis has them: a small rhombus at the value, in the caret's
    // ink, at the scale (within the sheet, at its right edge over the lanes, where the values are written: scales.js
    // ticks); on a waveform showing both halves zoomed out, two, at the level and its mirror (waveAt), as its columns
    // stand on both sides of the centre
    if (at && lane) {
      const ly = Math.round(read?.y ?? at[1]), text = read?.text ?? (lane.keys ? noteOf(yf(lane, at[1]), 5) : pitched(lane, L) ? reads(snapF(lane, at[1])) : level(lane, at[1]))
      // (the marks over the tags, whole)
      const marks = () => { c.fillStyle = caret; for (const y of [ly, ...read?.mirror != null ? [Math.round(read.mirror)] : []]) rhombus(within ? W - INTO - RHOMB : w + 1 + RHOMB, y + .5) }
      const axis = (text, ty) => { if (within) return tag(text, W - INTO - c.measureText(text).width, ty, 'right-of'); c.save(); c.beginPath(); c.rect(w + 1, 0, W, H); c.clip(); tag(text, w + 1, ty, 'right-of'); c.restore() }
      const ty = beside(lane, ly), down = ty > ly
      axis(text, ty)
      marks()
      // on the spectrogram, the level its colour stands for under it, and where that falls on the spectrum meter's scale
      const db = pitched(lane, L) ? loudness(lane.i, lane, at) : null
      if (db == null) return
      // under the colours' floor (no energy there: below the lowest bin, −∞), as low as they show: under it
      const floor = decibels?.[0] ?? -Infinity
      axis(db < floor ? `<${decibel(floor)}` : decibel(db), down ? ty + size() + 2 : ty - size() - 2)
      // measuring, where its row crosses the spectrum meter, which shows the spectrum under the pointer (probe)
      if (measure && meters?.spectra && show.spectrum) { c.fillStyle = gauge(); c.fillRect(Math.round(meterX(meterAt(metered(L)), db)) - 1, ly - 1, 3, 3) }
    }
  
  }
}
// a value's mark on a scale: a rhombus RHOMB px from its middle to each point
const RHOMB = 3.5
function rhombus(px, py) {
  c.beginPath(); c.moveTo(px, py - RHOMB); c.lineTo(px + RHOMB, py); c.lineTo(px, py + RHOMB); c.lineTo(px - RHOMB, py); c.closePath(); c.fill()
}
// The level the spectrogram shows under the pointer, dB: the loudest cell of its column within 2 px of it, so a line a
// pixel thin reads as it is drawn (gl-spectrogram pick); none while an edit's pieces or a take stand for the output.
// Read off the GPU once per place until the pictures are drawn again (`picked`), not each frame the overlay is, and only
// once they hold still: a read waits for all the GPU has queued, which, as the view scrolls or zooms, is each frame's
// drawing, window-wide; till then none, the read coming STILL ms after the last. Followed, the reel running on, the
// pictures pass under the pointer and never hold still: none till it stops
const STILL = 120
function loudness(i, rect, [px, py]) {
  const sg = specs[i], key = `${i} ${px} ${py} ${rolled}`
  if (!sg || pieces || recording || running) return null
  if (picked?.key === key) return picked.db
  const since = performance.now() - drawn
  if (since < STILL) { clearTimeout(settle); settle = setTimeout(() => invalidate(true), STILL - since); return null }
  const col = sg.pick(px + rolled / dpr - rect[0])
  let db = null
  if (col) {
    const n = col.levels.length, k = n / rect[3], r = (rect[1] + rect[3] - py) * k
    db = -Infinity
    for (let j = Math.max(0, Math.floor(r - 2 * k)); j <= Math.min(n - 1, Math.ceil(r + 2 * k)); j++) db = Math.max(db, col.levels[j])
  }
  assign({ picked: { key, db } })
  return db
}
// What is drawn in the lanes (a selection, the cues, the pitch curve, the caret) ends where the pictures do (editor.css,
// --end): before the labels, or SPACE px before the meters when they show, a waveform's bar, a spectrogram's spectrum or
// a piano's keys, never behind them, nor between them and the labels. The meters keep their width from the first frame,
// whether they read anything yet or not, so a sound arriving never shortens the pictures under it
export const lanesEnd = L => metered(L) ? meterAt(metered(L)) - SPACE : plot().w
// The share of the view's span the lanes show: the sound's end, the view at it, sits TAIL px short of where they end,
// its last moment, and a caret or cue there, clear of the meters and the labels; the time there (seenTo); [a, b] shown
// across them (fitTo)
export const TAIL = 4
export const reach = () => W > gutter + 1 ? Math.max(.5, (lanesEnd(lanes()) - TAIL) / plot().w) : 1
export const seenTo = () => start + (end - start) * reach()
export const fitTo = (a, b) => setRange(a, a + (b - a) / reach())
let ends = null, footing = null
function endLanes(L) {
  const end = lanesEnd(L)
  if (W - end !== ends) { ends = W - end; root.style.setProperty('--end', `${ends}px`) }
  if (H - plot().h !== footing) { footing = H - plot().h; root.style.setProperty('--foot', `${footing}px`) }
  if (root.hasAttribute('data-deep') !== spare > 0) root.toggleAttribute('data-deep', spare > 0)
  c.save()
  c.globalCompositeOperation = 'destination-out'
  c.fillStyle = '#000'
  for (const [, y, , lh] of L.all) c.fillRect(end, y, W - end, lh)
  c.restore()
}
// A time range's handles, each clicked or dragged to do one thing, where the range is wide enough for them: in its top
// corners the fade each makes, a small square with the fade's curve in it as the fade menu draws it; the pill on its
// top edge its level; inside its foot, flush with it, side by side from its middle, where its notes show, the tools of
// a voice in it (TOOLS): its intonation, its formants (its pitch the notes dragged), no fades there; its length from Alt at its end. With several ranges, the one under the pointer has them.
// [kind, x, y] each, a square's x and y its centre; a fade being dragged stays under the
// pointer, where it reaches. Shown with the pointer on or by the range or the caret, none for one it is away from; to
// a touch or a pen, which may have no pointer to bring near (`touch`, the last press's or move's, at first the
// screen's), always.
export const BOX = 16, TOOLS = ['intonation', 'formant']
// the range, or the caret, the handles are for: the one the pointer is on or by among several, null by none; dragged or
// touched, the selection's
export function handled() {
  if (drag || touch) return selection ? [...selection] : [cursor, cursor]
  if (!hovered) return null
  const t = time(hovered[0]), by = (BOX + INSET + 4) * (end - start) / plot().w
  const all = [...(selection && !band ? [selection] : !selection ? [[cursor, cursor]] : []), ...more.filter(r => r.length === 2)]
  return all.find(([p, q]) => t >= p - by && t <= q + by) ?? null
}
function grips(L) {
  const all = L.all, [top, bottom] = extent(all), h = BOX / 2
  // each square on whole pixels, so crisp at any pixel ratio, notched: flush with the top and with the edge it sits by,
  // never over the caret's line (a pixel wide: on a range's start, its first; on its end, the one after its last, where
  // a drag leaves it); a range's end, its last pixel, lit only as it would move, then drawn over the square (paintEdge)
  const [a, b] = handled() ?? []
  // none while a name is written in place: the field's, nothing over it
  if (a == null || naming || band || playhead != null || frozen.length || drag?.carry || drag?.stretch || drag?.lift || drag?.pill) return []
  const xa = X(a), xb = X(b), out = []
  // a caret has none: silence opens at it held Alt (gapDown)
  if (a === b || drag && !drag.fade) return []
  // a voice's own tools only where its notes show (all the lanes notes'), its pitch there the notes themselves, dragged:
  // its intonation and formants, no fades; over a waveform or a spectrogram, its fades and level alone
  const fade = kind => drag?.fade === kind && drag.span ? X(drag.p) : kind === 'in' ? xa : xb, voiced = L.notes.length === all.length
  const tools = voiced ? TOOLS : []
  if (!voiced && xb - xa >= 2 * (BOX + INSET) + 8) out.push(['in', fade('in') + (cursor === a) + h, top + h], ['out', fade('out') - h, top + h])
  if (xb - xa >= 72 && !drag?.fade) out.push(['level', (xa + xb) / 2, top + 4], ...tools.map((kind, i) => [kind, Math.round((xa + xb) / 2 + (i - (tools.length - 1) / 2) * (BOX + 2)), bottom - h]))
  // each with the edge it works from (the level and the tools, the middle): none from one out of sight past the lanes'
  // end, under the meters
  const from = { in: xa, out: xb }
  return out.filter(([kind, gx]) => gx >= 0 && (from[kind] ?? gx) < lanesEnd(L))
}
// a grip within reach of the pointer: a square and a little round it, the pill its shape, a tool its square alone
const reachOf = kind => kind === 'level' ? [-16, 16, -7, 7] : TOOLS.includes(kind) ? [-BOX / 2, BOX / 2, -BOX / 2, BOX / 2] : [-BOX / 2 - 2, BOX / 2 + 2, -BOX / 2 - 2, BOX / 2 + 2]
export const gripAt = (L, px, py) => grips(L).find(([k, gx, gy]) => { const [x0, x1, y0, y1] = reachOf(k); return px - gx >= x0 && px - gx <= x1 && py - gy >= y0 && py - gy <= y1 })
// what each does, as its way is now (a click on it turns it to the next)
const CURVE_WORDS = { linear: 'linear', exp: 'exponential', log: 'logarithmic', cos: 'S-curve' }
// the pill's level in steps; the pitch in semitones, from the note the range has where the pitch curve has one
const gripName = kind => ({ in: `Fade in, ${CURVE_WORDS[fadeCurve]}`, out: `Fade out, ${CURVE_WORDS[fadeCurve]}`, level: `Level, by ${LEVEL_STEP}dB`, intonation: 'Intonation, wider or flatter', formant: 'Formants, by cents', stretch: { trim: 'Trim', stretch: 'Stretch', speed: 'Speed' }[gripMode] })[kind]
export const gripPointer = kind => kind === 'level' || TOOLS.includes(kind) ? 'ns-resize' : kind === 'stretch' && gripMode !== 'trim' ? STRETCH : 'ew-resize'
// Dark squares with no rim, each glyph in its own, soft lines on the screen's colour so they show over the waveform;
// the one under the pointer, or dragged, bright, and it says what it does
function paintGrips(L, at) {
  const list = grips(L), under = at && !drag && gripAt(L, ...at), busy = drag?.fade ?? (drag?.lift ? 'level' : null)
  const [top, bottom] = extent(L.all), h = BOX / 2
  c.lineCap = c.lineJoin = 'round'
  for (const [kind, gx, gy] of list) {
    const lit = color(under?.[0] === kind || busy === kind ? '--color-screen-bright' : '--color-screen-soft'), boxed = kind !== 'level'
    if (boxed) { c.fillStyle = color('--color-screen'); c.globalAlpha = .9; c.fillRect(gx - h, gy - h, BOX, BOX); c.globalAlpha = 1 }
    c.beginPath()
    // the fade's curve from silence to full level across the square, rising away from the edge it fades
    if (kind === 'in' || kind === 'out') {
      const dir = kind === 'in' ? 1 : -1, curve = CURVES[fadeCurve], span = BOX - 7
      for (let i = 0; i <= 12; i++) c.lineTo(gx - dir * span / 2 + dir * span * i / 12, gy + span / 2 - span * curve(i / 12))
    }
    else if (kind === 'level') { c.moveTo(gx - 8, gy); c.lineTo(gx + 8, gy) }
    // the tools: pitch an arrow up and down; intonation a wave widening; formants two peaks of an envelope
    else if (kind === 'intonation') for (let i = 0; i <= 12; i++) c.lineTo(gx - 6 + i, gy - (1 + 4 * i / 12) * Math.sin(Math.PI * i / 3))
    else if (kind === 'formant') { c.moveTo(gx - 6, gy + 4); c.quadraticCurveTo(gx - 3, gy - 6, gx, gy + 4); c.quadraticCurveTo(gx + 3, gy - 6, gx + 6, gy + 4) }
    if (!boxed) { c.strokeStyle = color('--color-screen'); c.lineWidth = kind === 'level' ? 5 : 3.5; c.stroke() }
    c.strokeStyle = lit
    c.lineWidth = kind === 'level' ? 2.5 : 1.5
    c.stroke()
  }
  c.lineWidth = 1
  c.lineCap = c.lineJoin = 'butt'
  if (under) {
    // what it does, beside it, under it in the upper half and over it in the lower
    const [kind, gx, gy] = under
    say(gripName(kind), kind === 'level' ? gx + 12 : gx + h + 4, kind === 'level' ? gy + 12 : gy < (top + bottom) / 2 ? gy + h + 8 : gy - h - 8)
  }
}
// The meters, where the picture fades out just before the labels, each on its lane's own scale: by a waveform, a bar
// mirrored as the lane is, as the waveform draws a sound: the RMS in the colour of its body, out to the peak in the
// colour of its edges (red at full scale), the peak held a while marked past it as it plays; by a spectrogram, the spectrum's outline, its level across on the
// spectrogram's own scale (its floor to its top, -90 to 0 dB till it has one), each frequency at its height in the
// lane, filled under it with the upper half of the spectrogram's colours, grey at the floor, the band selected in it lit;
// by a notes lane, a piano's keys (paintKeys)
const METER = 40, KEYS = 16
// where a meter column `w` px wide starts: SPACE px either side of it, the lanes before it, the axis' ticks after it (a
// pixel past the lanes' width), as far as the pictures, the meter and the axis are apart alike
export const SPACE = 6, meterAt = w => plot().w + 1 - SPACE - w
// the meters' column, each look's own as its options have it (`show`), as wide as the widest a lane shows: a
// spectrum's (METER), a piano's keys (KEYS), a waveform's bar (3); 0 for none, where the lanes have no scale to
// read them by (?ui= axis false), and where the values are written in the sheet's own squares (axis inside: nothing
// between the lanes and them). Each meter at its start
export const metered = L => !scaled || within ? 0 : Math.max(L.spectral && show.spectrum ? METER : 0, L.notes.length && show.keys ? KEYS : 0, L.wave.length && show.meters ? 3 : 0)
const meterX = (left, v, [lo, hi] = decibels ?? [-90, 0]) => left + Math.max(0, Math.min(1, (v - lo) / (hi - lo))) * METER
function paintMeters(L) {
  // with tracks, the band pointed at (its foot too, as the axis has it), else the edited one's
  const bar = meterAt(metered(L)), shown = rect => !tracks || rect.i === (pointedBand >= 0 ? pointedBand : focus)
  for (const rect of show.keys ? L.notes : []) paintKeys(rect, bar)
  if (show.meters && meters) L.wave.forEach(rect => {
    if (!shown(rect)) return
    // in one lane, the loudest channel's
    const m = merged() ? meters.levels?.reduce((p, q) => q.peak > p.peak ? q : p) : meters.levels?.[rect.i] ?? meters.levels?.[0]
    if (!m) return
    const [top, low, bottom] = [ay(rect, m.peak), ay(rect, m.rms), ay(rect, m.peak, -1)], high = ay(rect, m.rms, -1)
    c.fillStyle = m.peak >= 1 ? color('--color-screen-error') : color('--color-screen-wave')
    c.globalAlpha = .4
    c.fillRect(bar, top, 3, low - top)
    c.fillRect(bar, high, 3, bottom - high)
    c.globalAlpha = 1
    c.fillStyle = color('--color-screen-wave')
    c.fillRect(bar, low, 3, high - low)
    // as it plays, the highest peak a while, a mark either side, red at full scale
    if (m.hold == null || m.hold <= m.peak) return
    c.fillStyle = m.hold >= 1 ? color('--color-screen-error') : color('--color-screen-wave')
    c.fillRect(bar, Math.round(ay(rect, m.hold)), 3, 1)
    c.fillRect(bar, Math.round(ay(rect, m.hold, -1)) - 1, 3, 1)
  })
  // the spectrum read only where a spectrogram's lane draws it (the editor's meters read it as they are drawn)
  if (!L.spec.length || !show.spectrum) return
  const bins = meters?.spectra, size = meters?.size, left = bar
  if (!bins) return
  L.spec.filter(shown).forEach(rect => {
    const db = bins[rect.i] ?? bins[0], [, y, , lh] = rect, outline = new Path2D()
    outline.moveTo(left, y + lh)
    for (let py = y + lh; py >= y; py -= 2) {
      const k = yf(rect, py) / (meters.rate / size), k0 = Math.floor(k), f = k - k0
      const v = (db[k0] ?? -200) * (1 - f) + (db[k0 + 1] ?? -200) * f
      outline.lineTo(meterX(left, v), py)
    }
    outline.lineTo(left, y)
    // filled under the outline down to the floor in the spectrogram's colours, from the one halfway up its scale to its
    // top's: the body of the spectrum reads against the screen, never sinks into it
    const fill = c.createLinearGradient(left - METER, 0, left + METER, 0), stops = shades()
    stops.forEach((s, k) => fill.addColorStop(k / (stops.length - 1), s))
    c.globalAlpha = .7
    c.fillStyle = fill
    c.fill(outline)
    c.globalAlpha = .7
    c.strokeStyle = color('--color-screen-muted')
    c.stroke(outline)
    c.globalAlpha = 1
    // the band selected: its part of the spectrum, which is what plays
    if (band) {
      const b0 = Math.max(y, fy(rect, band[1])), b1 = Math.min(y + lh, fy(rect, band[0]))
      c.save()
      c.beginPath(); c.rect(left, b0, METER, b1 - b0); c.clip()
      c.globalAlpha = .5
      c.fillStyle = fill
      c.fill(outline)
      c.globalAlpha = 1
      c.strokeStyle = color('--color-screen-bright')
      c.stroke(outline)
      c.restore()
    }
  })
}
// By a notes lane, a piano's keys, KEYS px wide from `left`, a row each as the lane has them, as a piano roll's: the
// black keys short, at its start, the white ones running on behind them, a line where two meet (E–F, B–C, and by each
// black key's middle); the white keys the lighter on a dark screen as on a light one, as the lane's rows are
// (paintRoll). The note where it plays, or the caret is, lit in the pitch curve's colour, and its pitch there a line
// across, as a tuner reads it
function paintKeys(rect, left) {
  const [, y, , lh] = rect, rh = rowOf(rect), ink = color('--color-screen-wave'), dark = lightness(rgba(color('--color-screen'))) < .5, short = Math.round(KEYS * .6)
  const t = playhead ?? cursor, n = (noted[rect.i] ?? []).find(n => t >= n.time && t < n.time + n.duration), lit = n && Math.round(midiOf(bent(n.freq, n.time + n.duration / 2)))
  c.save()
  c.beginPath(); c.rect(left, y, KEYS, lh); c.clip()
  // the white keys' body, the black keys over it, then where two white keys meet: under a white key with a white one
  // over it, and by a black key's middle
  c.globalAlpha = dark ? .28 : .08
  c.fillStyle = ink
  c.fillRect(left, y, KEYS, lh)
  for (const m of keyRows(rect)) {
    const top = keyY(rect, m) - rh / 2, black = BLACK.includes(m % 12)
    c.fillStyle = dark ? color('--color-screen') : ink
    c.globalAlpha = dark ? 1 : .5
    if (black) c.fillRect(left, top, short, rh)
    c.globalAlpha = dark ? 1 : .25
    if (!black && !BLACK.includes((m + 1) % 12)) c.fillRect(left, Math.round(top), KEYS, 1)
    if (black) c.fillRect(left + short, Math.round(top + rh / 2), KEYS - short, 1)
    if (m !== lit) continue
    c.globalAlpha = 1
    c.fillStyle = accent()
    c.fillRect(left, top, black ? short : KEYS, rh)
  }
  // the pitch there, as it goes, a line across the keys
  const k = n && Math.round((t - n.t0) / n.hop), f = n?.f0[k]
  if (f) { c.globalAlpha = 1; c.fillStyle = color('--color-screen-bright'); c.fillRect(left, Math.round(keyY(rect, midiOf(bent(f, t)))), KEYS, 1) }
  c.restore()
}
// What a drag does, in a few words by the pointer
function acting() {
  const d = drag, st = v => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(1)}`
  if (d.carry && d.moved) return d.out ? `${d.carry} to a tab of its own` : d.into === 'room' ? `${d.carry} to a new track at ${stamp(d.to)}` : d.into != null ? `${d.carry} to ${tracks[d.into]?.name} at ${stamp(d.to)}` : `${d.carry} to ${stamp(d.to)}`
  if (d.stretch && d.mode === 'trim') return d.to < d.b ? `trim ${stamp(d.b - d.to)}` : `silence ${stamp(d.to - d.b)}`
  if (d.stretch) return `${d.mode} ×${((d.to - d.a) / (d.b - d.a)).toFixed(3)}, ${stamp(d.to - d.a)}`
  if (d.gap) return `silence ${stamp(d.to - d.at)}`
  if (d.lift === 'gain') return `${st(d.db)}dB`
  // the pitch curve, before the points it moves: how far, the note of the stretch pressed from and to, all of it moving
  if (d.run) return `${pitchSays(d.st, median(pitchRange(d)))}, all of it`
  // a point of the line: its value, as the line writes it; one on the pitch curve, the note it goes from and to
  if (d.points) { const [t, v] = d.points[d.index]; return d.line === 'pitchline' ? pitchSays(v, d.hz, d.hz && toneAt(t)) : `${st(v)}dB` }
  if (d.lift === 'pitch') return pitchSays(d.st, d.hz ?? median(pitchRange(d)))
  if (d.lift === 'intonation') return intonationSays(d)
  if (d.lift === 'formant') return `formants ${semis(d.st)}`
  if (d.span) return `${d.cross ? 'crossfade' : `fade ${d.fade}`} ${stamp(d.span[1] - d.span[0])}`
  // a range as it is made or resized: how long it is
  if ((d.resizing || d.anchor != null && !d.caret) && d.moved && selection) return stamp(selection[1] - selection[0])
  return ''
}
// A pitch dragged, to the cent
const semitones = ratio => Math.round(1200 * Math.log2(ratio)) / 100
// A tool's pitch or formants, by how far it is dragged from where it was pressed (`dy`, px, up +): by its square, a
// few cents near, semitones further, 12 its lanes' height away (the track's, a sound's all told: what is over the tools
// at their foot), to `most` either way, to the cent
export const glide = (dy, most) => { const L = own(lanes()), [a, b] = extent(L.all); return Math.max(-most, Math.min(most, Math.round(Math.sign(dy) * 1200 * (dy / (b - a)) ** 2) / 100)) }
// The playhead, else the caret or the selection, wholly out of sight, past the lanes' end under the meters too: it
// stays at the edge of the lanes it is past, as a sticky element does, its line as it is drawn in sight, and on the
// time row its tick with a chevron beside it pointing out to it, in place of its time, which the clock has; a press
// on the tick or the chevron brings the view to it (bring), lighting them and the line. { side (−1 before the view,
// 1 past it), rects (the lanes its line runs in), px (its line), x0, x1 (its tick and chevron on the time row),
// fill }; null in sight
export let away = null
