import { lockedAt, haunt, unghost, pointers, plot, spare, tallOf, lanes, floor, inRoom, own, laneAt, trackAt, footAt, bands, resized, refocus, freeze, own0, frozenAt } from './geometry.js'
import { selectDown, origin, current, caretAt, edgeAt, gripDown, endDown, lifting, lock, aimed, fine, scrub, unscrub, nearCue, cueDown, penDown, toneDown, pitchDown, noteDown, tapped, heardAround } from './gestures.js'
import { EDGE, ONTO, FINE, HOLD, SLOP, EXTEND, ADD, root, onedit, onmode, onscrub, onaudition, onheight, duration, show, markers, more, pieces, start, end, fview, selection, band, cursor, playhead, steered, cues, envelope, shift, contour, fadeCurve, aview, levelStep, tracks, focus, allLanes, sections, heights, lift, held, assign } from './model.js'
import { hear, pitchRange, noteAt, linePoints, curveOf, onLine, pointOn, knotOn } from './notes.js'
import { lanesEnd, gripAt, gripPointer, glide } from './overlay.js'
import { arrange, faded, crossed, invalidate } from './render.js'
import { steer, onAway, bring } from './ruler.js'
import { bar, onBar, x, time, clamp, snap, free, snapF, stick, stuck, pitchLine, snapV, local, inside, uy, ya, fold, pointAt, lineLanes, pitchLanes, setRange, setFreqs, zoomSpan, onFreqs, onLevels, zoomLevels } from './scales.js'
import { around, select, told, addCaret, setCursor } from './select.js'
import { thumb, liftAt, editing, markAt, labelAt, notch, stripAt, rename } from './strips.js'

// The pointer: down, move, the drags, hover and leave, up, clicks and the context menu, on the picture and its time row

export let drag = null
export let touch = matchMedia('(hover: none)').matches
export function down(event) {
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
export function move(event) {
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
export function drags(event, px, py) {
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
export let hot = null, grabbing = false
export function hover(px, py, keys = held) {
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
export function leave(event) { assign({ hovered: null }); hot = null; if (event.pointerType !== 'touch') assign({ reached: -Infinity }); invalidate(true) }
export function up(event) {
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
export function clicked(event) {
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
export const again = (m, px, py) => !!m && performance.now() - m.at < 500 && Math.abs(px - m.px) < 4 && Math.abs(py - m.py) < 4
export const thirdAt = (px, py) => again(doubled, px, py)
