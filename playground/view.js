import Waveform from '../assets/gl-waveform.js'
import Spectrogram from '../assets/gl-spectrogram.js'
import scales from './scale.js'
import { CURVES, CROSSFADES } from './ops.js'
import clock from './time.js'
import measure, { coloured, hue, temperature, colormap, inked, lightness, MAPS } from './tint.js'
import { GUTTER, RULER, GAP, EDGE, SNAP, STICK, ONTO, NOTCH, HEAD, FOOT, TRACK, LOW, ROOM, KINDS, FINE, NOTES, midiOf, noteOf, stylize, HOLD, SLOP, EXTEND, ADD, mac, LEVELS, TICK, VOICE, GAIN, GLIDE, root, onaxis, onselect, oncursor, onedit, onmode, onscrub, oncontext, onaudition, onfocus, ontake, onghost, onlayout, onheight, onbusy, onprobe, onsamples, onheard, keepRoom, closest, farthest, overshoot, timeRow, element, color, FORK, reel, fades, selectCanvas, specCanvas, waveCanvas, rowStrip, marksCanvas, meterStrip, barStrip, overlay, runway, head, headLines, headTick, headTime, gl, sgl, oc, sel2d, c, forkButton, lookButton, waves, specs, count, rate, duration, display, units, hovered, show, segments, markers, arriving, more, dropped, droppedNew, meters, recording, empty, asking, pieces, guest, start, end, fview, selection, band, cursor, playhead, played, speed, guides, nudge, steered, cues, bounds, ranks, envelope, shift, contour, snapping, fadeCurve, cueKinds, landed, clips, aview, levelUnits, gripMode, pitching, ruler, grid, levelStep, look, waveLook, data, tracks, focus, allLanes, sections, windows, windowsOf, leveled, anchor, scroll, reached, heights, lift, kinds, noted, zoomed, pictures, cruise, cruised, palette, moving, leavesOf, map, ruled, under, chosen, framed, unframed, pull, held, shaded, ahead, mount, assign } from './view/model.js'
import { say, paint, triangleAt, WASHED, washFrom, crossAt, lanesEnd, reach, seenTo, fitTo, TOOLS, handled, gripAt, gripPointer, meterAt, metered, glide, away } from './view/overlay.js'
export { KINDS, NOTES, noteOf, stylize, HOLD, SLOP } from './view/model.js'

// The output as a picture: the waveform, the spectrogram or the notes, a sound's lanes alike, each track's its own
// (`kinds`). A lane per channel, apart by a gap: each
// channel reads on its own (a sound panned to one side, a different take); the caret, the playhead, a selection and the
// cues are drawn in each lane, never across the gap, which holds no sound. With tracks, a lane per track, the one edited
// holding the caret and the selection (`tracks`). Levels (in dB or as sample values, `levels`)
// or frequencies on the right, each under its tick, the lowest frequency at the lane's foot; the meters just before
// them; times on the row right under the lanes (`ruler`), each label with its tick running down from them, and over
// them the times that matter now, the pointer's (where a press would take it), the caret's, a selection's, each tick
// joined to its line. Times go by the zoom's precision, a 1-2-5 step of a pixel or a little more, and read with all its
// decimals, so the script gets the numbers the view shows. Near a mark on the right (a frequency, a level) the pointer
// takes its value. The wheel scrolls, through time or through zoomed-in frequencies or levels; a pinch, or Ctrl and the
// wheel, zooms the axis under the pointer: time, the frequencies, or the levels (a quiet sound magnified, or what goes
// over full scale shown). Zoomed in, a faint scrollbar at the time row's top, over its ticks, says where the view is in the sound and
// drags it. On the spectrogram the pointer reads the level under it, marked on the spectrum meter, whose fill is the
// spectrogram's colours over its levels: the legend.
// One gesture, select, as in a text: a press puts the caret and sounds the moment under it, all else gone at once, a
// drag selects, a double-click the fragment around it (between the cues around it: where sounds start and end, where
// they hit, the markers), or the pause it is in, a triple-click the sound between the pauses either side; however made, a
// selection puts the caret at its start, the pointer an I-beam: a range is of time, no box. What there is stays when a
// press takes it: a caret's line, any of them, drags the caret; a range's edge, any of them, drags it, lighting when a
// press would take it, and meeting the other edge leaves a caret; inside it, a drag moves its audio, as selected text
// is dragged, the pointer a hand. The time row is a ruler, as a DAW's: pressed, the
// caret goes there alone, what is selected staying (Reaper's); dragged, a range; held still, the caret, dragged. The
// keys say how, the same everywhere, each its pointer: Shift sums (the selection, or the caret, extended to the press
// at once from where it was begun, as in a text, a drag going on with it; the I-beam with a chevron the way it goes).
// Alt adds (another caret, VS Code's, the one Shift then extends, or another range; dragged inside the selection, a
// copy of its audio, Finder's and Figma's Alt-drag; the I-beam with a plus), and measures, as Figma's Alt does: held,
// the pointer a cross, every cue showing where a press would snap, the pointer's place dashed out to the axes in the
// measuring red, and how far it is from what is selected, a line along the time row, its length on it. ⌘ (Ctrl) aims
// and empowers: held, the pointer a cross, the cue under it lit; what a press does: a range's end sets its length, as its grip does; the cues light and
// drag, the audio either side stretching; on the spectrogram a press makes a box of time and frequency, a band, as
// Photoshop's selections; and any drag aims finely (its moves a quarter as far, nothing snapping).
// A pressed or dragged time goes onto a cue (shown or not) or a marker within a few pixels of it, which lights, as
// Figma's objects snap (`snapping`). A range's handles, shown with the pointer on or by it, each do one thing, the
// range under the pointer's among several, say what when the pointer is on one, and a click on one turns it to its next way (`onmode`), as a
// tool's options cycle, no menu: its top corners, drawn as the fade they make, fade it (inward, from its edge; outward,
// the audio past it goes, crossfading into it; a click, the next curve); the pill on its top edge, dragged up or down,
// sets its level; the tools at its foot, side by side, a voice's pitch, intonation and formants, each dragged up or down
// (the pitch's clicked, its curve);
// the square past its end, a square's height off each lane's foot, trims it (cut back, or silence added), stretches it
// or speeds it (a click, the next). With none, the square past the caret pulls silence open there, as trimming out
// does. None while it plays. What else shows (`show`) is grabbed where it is, never through a mode: the cues (held ⌘),
// the gain line and its points; editing pitch (`pitching`), on the spectrogram framed on the voice, the pitch curve, dragged
// up or down the whole pitch line with it, a click on it a point of the line there, dragged, as RX's Dialogue Contour has
// them, and its bends, each dragged bending the voice between its neighbours, as Praat's Manipulation; on the
// waveform the pitch line itself. Holding the caret or dragging it, or an edge, hears the moment under it (`onscrub`; a box, only its band).
// What a drag does as it goes, what a handle or an edge does, is said by the pointer in the page's hints (`hint`,
// hint.js); a pitch, an intonation or formants dragged are heard as they will sound, from where they start (`onaudition`).
// The view never changes audio: edits go to the script through `onedit`.
let scale = 'log'
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
// each wave's twin from the weighed `leaves` of its samples, as weigh() makes them
function twinsFor(leaves) {
  if (leaves?.length !== waves.length) return
  twinned(new Map(waves.map((w, c) => { const twin = new Waveform(gl); twin.peaks(leaves[c], 0); return [w, twin] })))
  twinsOf = heardOf
  weighing = false
}
// With tracks, they are the edited track's lane's, or the lane they name (`lane`): a piece dropped into another track
// leaves its own lane for that one before the output comes. `guest`: a piece carried into another track's lane,
// drawn there over what it covers, as it is dragged and once dropped till the output comes: { lane, at, a, b, of },
// [a, b] of lane `of` going in at `at`. `frozen`: what an edit is still making, [{ lane, a, b }] (lane null: every
// one), hatched, no press taking it, nothing playing (onbusy), till its output comes, as Suno Studio's parts calculating
let frozen = []
const steer = () => { assign({ steered: playhead != null }); assign({ moving: null }) }
// how the spectrogram draws, gl-spectrogram's options: its colours, its depth in dB, its FFT size; and the levels its
// colours span, [floor, top] dB, the lanes' one scale once leveled (spectrograms), which the spectrum meter takes too
let decibels = null
// when the pictures were last drawn, and the overlay's read of the spectrogram put off till they hold still (loudness)
let drawn = 0
const untrack = () => { assign({ tracks: null }); assign({ allLanes: false }); delete root.dataset.tracks }
// a locked track's lane at a height
const lockedAt = py => !!tracks?.[laneAt(lanes(), py)]?.locked
// The caret in the room (`ghost`), a new track's to be: a take, a paste or a piece carried makes a track of it there
// (editor.js, told by onghost); a press anywhere else takes it back
let ghost = false
function haunt(t) {
  ghost = true
  assign({ allLanes: false })
  assign({ band: null, selection: null })
  assign({ more: [] })
  assign({ cursor: clamp(t) })
  oncursor(cursor)
  told()
  onghost(true)
  invalidate(true)
}
function unghost() { if (!ghost) return; ghost = false; onghost(false); invalidate(true) }
// The bands as they are laid out, told as they change (onlayout), for the layers to line up with: each band's top (its
// head line's), its lanes' top and height (a track's, or a sound's lanes' all told), and the room's, CSS px from the
// picture's top
let bandsLaid = ''
function layout(L) {
  const r = roomLane(L), [top, foot] = extent(L.all), hd = headOf(), rows = !duration ? [] : tracks ? L.all.map(([, y, , lh]) => ({ top: y - hd, y, h: lh })) : [{ top, y: top, h: foot - top }]
  const key = JSON.stringify([rows, r?.[1], r?.[3], plot().h])
  if (key !== bandsLaid) { bandsLaid = key; onlayout({ rows, room: r && { y: r[1], h: r[3] }, h: plot().h }) }
}
const FOLD = 3
// the section whose numbers are pointed at, or -1
const chips = []
let chipped = -1
function takeChip(i) {
  const el = element('div', 'takes', root)
  el.setAttribute('role', 'group')
  for (const type of ['pointerdown', 'pointerup', 'contextmenu', 'dblclick']) el.addEventListener(type, e => e.stopPropagation())
  el.addEventListener('pointerenter', () => { chipped = i; invalidate(true) })
  el.addEventListener('pointerleave', () => { if (chipped === i) chipped = -1; invalidate(true) })
  el.addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; e.stopPropagation(); ontake(i, b.value === 'add' || b.value === 'more' ? b.value : +b.value, b) })
  return el
}
// the section pointed at, on its place in the strip or its numbers, where nothing is dragged: its index, or -1
function takeHot(L) {
  if (drag) return -1
  if (chipped >= 0 && sections[chipped]) return chipped
  const m = hovered && stripAt(...hovered, L)
  return m?.kind === 'takes' ? m.i : -1
}
function placeTakes(L) {
  const all = L.all, end = lanesEnd(L), { h } = plot()
  while (chips.length < sections.length) chips.push(takeChip(chips.length))
  chips.forEach((el, i) => {
    const t = sections[i], rects = !t ? [] : t.lane == null ? all : [all[t.lane]].filter(Boolean)
    const x0 = t && X(t.at), x1 = t && Math.min(end, X(Math.min(t.end, duration))), bottom = rects.length ? Math.max(...rects.map(r => r[1] + r[3])) : 0
    const seen = rects.length && x1 >= 0 && x0 <= end && bottom + FOOT <= h
    el.hidden = !seen
    if (el.hidden) return
    const key = `${t.on} ${t.open} ${t.names.join()}`
    if (el.dataset.key !== key) {
      el.dataset.key = key
      el.ariaLabel = 'Takes'
      // FOLD of them about the one heard (from the first, none heard), … either side for those past them
      const n = t.names.length, a = n > FOLD + 1 ? Math.max(0, Math.min(n - FOLD, t.on - 1)) : 0, b = n > FOLD + 1 ? a + FOLD : n
      const take = k => `<button type="button" value="${k}" aria-pressed="${k === t.on}" title="Take ${k + 1}, ${t.names[k] || 'empty: R records into it'}${k === t.on ? ', heard' : ''}">${k + 1}</button>`
      const more = `<button type="button" value="more" class="takes-more" aria-haspopup="menu" aria-expanded="false" aria-label="All ${n} takes" title="All ${n} takes">…</button>`
      el.innerHTML = (a > 0 ? more : '') + Array.from({ length: b - a }, (_, k) => take(a + k)).join('') + (b < n ? more : '')
        + `<button type="button" value="add" class="takes-add" ${t.open ? 'aria-disabled="true" title="An empty take is there: R records into it"' : 'title="Another take"'} aria-label="Another take">${FORK}</button>`
    }
    // in its band's strip on a name's line, at its end inside it, as far from its end as a name is from its start (its
    // start free for a range's name over it), held at the picture's right while the section runs past it; each
    // number's padding (2 px) after it. Its top as a name's field's, not rounded, so its text lands on the name's rows
    const left = `${Math.round(Math.min(x1, end) - 2 - el.offsetWidth)}px`, at = `${fieldTop(bottom + NAMES, NAMEH)}px`
    if (el.style.left !== left || el.style.top !== at) Object.assign(el.style, { left, right: 'auto', top: at })
  })
}
function placeFork(L) {
  const m = !drag && hovered ? stripAt(...hovered, L) : null, mark = m?.kind === 'mark' && markers[m.i]
  const seen = mark?.duration && !sections.some(t => (t.lane ?? null) === markLane(mark) && Math.abs(X(t.at) - m.x0) < 1)
  forkButton.hidden = !seen
  if (!seen) return
  forkButton.dataset.i = m.i
  const left = `${Math.round(Math.min(m.x1, lanesEnd(L)) - 2 - forkButton.offsetWidth)}px`, top = `${fieldTop(m.y + NAMES, NAMEH)}px`
  if (forkButton.style.left !== left || forkButton.style.top !== top) Object.assign(forkButton.style, { left, top })
}
// A sound longer than the page holds (summary): drawn from its picture, the waveform from its leaves and the spectrogram
// from its spectra, its samples fetched where it is zoomed in (onsamples, a chunk of CHUNK at a time, as the pictures
// keep them): far enough for the waveform to want them (under WAVE samples a device px, where its columns stop being
// whole leaves) or for the spectrogram to draw them exactly (SPAN samples in view at most), half a view either side
// too. At most HELD samples a channel held, those farthest from the view let go first. `windows`: chunk → true once
// held, or the promise of it; null while the page holds the whole sound
const CHUNK = 65536, WAVE = 1024, SPAN = 2 ** 23, HELD = 2 ** 24
// `anchor`: where the selection was begun, the end Shift keeps (origin)
let W = 0, H = 0, dpr = 1, frame = 0
let drag = null
const pointers = new Map()
// on 'hover': how long it stays once let go (ms), when it was last reached for, whether it shows, the wait to hide it
const LINGER = 1000
let barOn = null, barTimer = 0
// Geometry, in CSS pixels; `gutter`, the axis' width at the right (fitAxis)
let gutter = GUTTER
// the time row's height: none where it is off (`ruler` 'off': an embedding page's big time says it all); in a band's
// strip (`timeRow` 'band'), the scrollbar's alone at the picture's foot
const rowH = () => ruler === 'off' ? 0 : timeRow === 'band' ? BAR + 2 : RULER
const plot = () => ({ w: Math.max(1, W - gutter), h: Math.max(1, H - rowH() - (scroll === 'overview' ? MAP : 0)) })
// a sound's channels in one lane: as the waveform's look has them, or its notes, a voice's, found on their mix
const merged = () => !tracks && (display === 'notes' || display === 'wave' && waveLook.lanes === 'one')
// Each band's height by its name, a track's or '' for a sound's, as its foot was dragged (onheight); the bands
// scrolled up `lift` px, as far as they and the room run past the picture (`spare` px); a track's head line over it
let spare = 0
const bandOf = i => tracks ? tracks[i]?.name ?? '' : ''
const headOf = () => tracks ? HEAD : 0
// the room kept under the lanes, with a sound or an empty track: a take into nothing, as it comes and done, in the
// same lane, nothing moving as it stops; none where the picture is all there is (`keepRoom` false: embedded, the lanes
// fill its frame)
const roomy = () => keepRoom && (duration || empty) ? ROOM : 0
const tallOf = name => Math.max(LOW, heights[name] ?? (tracks ? TRACK : plot().h - FOOT - roomy()))
const kindOf = i => (tracks && kinds[bandOf(i)]) || display
// The lanes, [x, y, w, h] each, with what it shows (`kind`) and its channel's or its track's index (`i`), a notes lane
// its keys (keysOf): `all` in order, and by kind, `wave`, `spec` and `notes`; `spectral`, whether any of the picture's
// shows the spectrogram (the meters' width, where they all end). Each track's band its head (headOf), its lane and its
// foot; a sound's lanes one band, its foot under the last
function lanes() {
  const { w, h } = plot(), n = merged() ? 1 : Math.max(1, count), kind = Array.from({ length: n }, (_, i) => kindOf(i)), hd = headOf()
  const each = tracks ? kind.map((_, i) => tallOf(bandOf(i))) : Array(n).fill((tallOf('') - GAP * (n - 1)) / n)
  const all = tracks ? each.reduce((s, lh) => s + hd + lh + FOOT, 0) : each.reduce((s, lh) => s + lh, 0) + GAP * (n - 1) + FOOT
  spare = Math.max(0, all + roomy() - h)
  assign({ lift: Math.max(0, Math.min(lift, spare)) })
  let y = -lift
  return sorted(each.map((lh, i) => { y += hd; const r = Object.assign([0, y, w, lh], { kind: kind[i], i, keys: kind[i] === 'notes' ? keysOf(i) : null }); y += lh + (tracks ? FOOT : GAP); return r }))
}
const sorted = (all, spectral = all.some(r => r.kind === 'spec')) => ({ all, wave: all.filter(r => r.kind === 'wave'), spec: all.filter(r => r.kind === 'spec'), notes: all.filter(r => r.kind === 'notes'), spectral })
const keyed = new WeakMap()
function keysOf(i) {
  const list = noted[i]
  if (zoomed[bandOf(i)]) return zoomed[bandOf(i)]
  if (list && keyed.has(list)) return keyed.get(list)
  let lo = Math.min(...(list ?? []).map(n => midiOf(n.freq))), hi = Math.max(...(list ?? []).map(n => midiOf(n.freq)))
  if (!(hi >= lo)) [lo, hi] = VOICE.map(midiOf)
  lo = Math.floor(lo) - 2; hi = Math.ceil(hi) + 2
  const short = 24 - (hi - lo)
  if (short > 0) { lo -= Math.floor(short / 2); hi += Math.ceil(short / 2) }
  if (list) keyed.set(list, [lo, hi])
  return [lo, hi]
}
// channel or track `i`'s lane among `rects`, or none
const laneOf = (rects, i) => rects.find(r => r.i === i)
// the lanes' top and bottom
const extent = rects => [Math.min(...rects.map(r => r[1])), Math.max(...rects.map(r => r[1] + r[3]))]
// the last lane's foot: under it, to the time row, the room (roomOf), nothing there to take hold of
const floor = (L = lanes()) => extent(L.all)[1]
// The room under the last band's foot: its top, where a new track's lane would be, or null where it is not in sight
function roomOf(L = lanes()) {
  const y = floor(L) + FOOT
  return duration && !recording && y < plot().h ? { y } : null
}
const inRoom = (py, L) => { const r = roomOf(L); return !!r && py >= r.y && py <= plot().h }
// the lanes the edited track's own things go in: its lane, with tracks; else all of them. The lane at a height, or -1
const own = L => tracks ? sorted(L.all.filter(r => r.i === focus), L.spectral) : L
const laneAt = (L, py) => L.all.findIndex(([, y, , lh]) => py >= y && py <= y + lh)
// a track's lane at a height, the gap under it too; -1 for none (the time row)
const trackAt = (L, py) => py > plot().h ? -1 : L.all.findIndex(([, y, , lh]) => py >= y - headOf() && py < y + lh + FOOT)
// A band's foot under its lanes: its name ('' a sound's), or null
function footAt(py, L = lanes()) {
  if (py > plot().h) return null
  const feet = tracks ? L.all.map(([, y, , lh], i) => [y + lh, bandOf(i)]) : [[floor(L), '']]
  return feet.find(([f]) => py >= f && py < f + FOOT)?.[1] ?? null
}
// a band's foot as it is dragged: its height as far as the pointer has gone, and with Alt (held as it was pressed or on
// the way) every band's, the others as they were where Alt is let go again
const bands = () => tracks ? tracks.map(t => t.name) : ['']
function resized() {
  const h = Math.max(LOW, Math.round(drag.h0 + drag.py - drag.y)), was = drag.from ??= { ...heights }
  assign({ heights: drag.all ? Object.fromEntries(bands().map(n => [n, h])) : { ...was, [drag.foot]: h } })
  invalidate()
}
// another track's lane pressed: it is the one edited now, nothing selected on it; a selection through every lane stays
// where the press takes hold of it (an edge, its audio), the lane's handles then its
function refocus(L, py, px) {
  const i = tracks ? trackAt(L, py) : -1
  if (i < 0 || i === focus) return
  assign({ focus: i })
  layout(lanes())
  const held = allLanes && selection && !band && px >= x(selection[0]) - EDGE && px <= x(selection[1]) + EDGE
  if (!held) { assign({ band: null, selection: null }); assign({ more: [] }); assign({ anchor: null }); assign({ allLanes: false }) }
  onfocus(i)
  told()
}
// the time row, at the picture's foot, level with the panel's and the bar's edge, the scrollbar between it and the
// lanes: its ticks TICK long from `tickTop` down, its labels beside their tops (row, their middle). A trial
// (`timeRow` 'band', ?row=band): in the strip of the band pointed at (rowBand), under its sound, its ticks from the
// strip's top, its labels level with the strip's names; none with that strip out of sight
const tickTop = () => timeRow === 'band' ? (rowBand()?.y ?? -H) + 1 : plot().h + rowH() - TICK - 2, row = () => tickTop() + 7
// the strip the time row is in ('band'): the band pointed at's, else the edited one's; or none, out of sight
function rowBand(L = lanes()) {
  const i = tracks && hovered && !drag ? trackAt(L, hovered[1]) : -1, s = strips(L).find(s => s.i === (tracks ? i >= 0 ? i : focus : null))
  return s && s.y >= 0 && s.y + FOOT <= plot().h ? s : null
}
// Zoomed in, the scrollbar at the time row's top, over its ticks, above its labels, as an overlay scrollbar is: the
// whole sound across the row (or as far as the view goes past its end), the thumb what shows, at least THUMB px. A
// press on it drags the view; beside it, the view centres there first. { x0, x1, total }, or null showing all of it
// Chosen in the settings, the overview takes the bar's place: the whole sound in a strip MAP px tall under the time
// row, as a minimap, the view's part of it lit, pressed and dragged as the thumb is
const BAR = 8, THUMB = 16, MAP = 28
function bar() {
  if (!duration || whole()) return null
  const total = Math.max(duration, end), w = plot().w, k = w / total, x0 = Math.min(start * k, w - THUMB)
  return { x0, x1: Math.max(x0 + THUMB, end * k), total }
}
const onBar = (px, py) => (scroll === 'overview' ? py >= H - MAP : py >= plot().h && py <= plot().h + BAR) && px >= 0 && px <= plot().w && !!barOn && !!bar()
const x = t => (t - start) / (end - start || 1) * plot().w
// a time's place on the device's own pixels, where the pictures put it: the marks over them move with them, a device pixel
// at a time, as the view scrolls
const X = t => Math.round(x(t) * dpr) / dpr
const time = px => start + px / plot().w * (end - start)
const clamp = t => Math.max(0, Math.min(duration, t))
// the 1-2-5 step just above `res`
const nice = res => { const p = 10 ** Math.floor(Math.log10(res)); return [1, 2, 5, 10].map(m => m * p).find(s => s >= res * (1 - 1e-9)) }
// Times go by the 1-2-5 step just above a pixel's time, down to a microsecond, and read with the decimals it needs, one
// at least: 5.0s, 5.05s, 5.000s. The frequency marks and level lines take the pointer within SNAP px.
const unit = () => Math.max(1e-6, nice((end - start || 1) / plot().w * (fine() ? FINE : 1)))
const digits = () => Math.max(1, Math.min(6, Math.ceil(-Math.log10(unit()) - 1e-9)))
const snap = t => clamp(free(t))
// past the end too: where audio moved or silence opened takes the sound on to it
const free = t => { const u = unit(); return Math.max(0, +(Math.round(t / u) * u).toFixed(digits())) }
const snapF = (rect, py) => !fine() && marks().find(f => Math.abs(fy(rect, f) - py) <= SNAP) || yf(rect, py)
// The cues at this scale, their indices: none within CROWD px of a plainer one (a pause's edge, a cue moved, then the
// larger step), as a map names its larger towns first, so zoomed out the main ones show, each sound's start and end,
// and zoomed in the rest come; in the view, the rank then the time deciding, the same each time. Zoom sets how many,
// in time; how quiet a sound may be for its cues is the pauses' level, the same at any zoom (worker.js GROUND)
const CROWD = 24
let crowd = null
function seen() {
  const w = plot().w, key = `${start} ${end} ${w}`
  if (crowd?.cues === cues && crowd.key === key) return crowd.list
  const taken = new Uint8Array(Math.ceil(w) + 2 * CROWD), list = []
  const order = (cues ?? []).map((t, i) => i).filter(i => x(cues[i]) >= 0 && x(cues[i]) <= w)
  order.sort((i, j) => (ranks.get(cues[j]) ?? Infinity) - (ranks.get(cues[i]) ?? Infinity) || i - j)
  for (const i of order) {
    const px = Math.round(x(cues[i])) + CROWD
    if (taken.subarray(px - CROWD + 1, px + CROWD).some(Boolean)) continue
    taken[px] = 1
    list.push(i)
  }
  crowd = { cues, key, list: list.sort((i, j) => i - j) }
  return crowd.list
}
// A time dragged within ONTO px of a cue or a marker goes onto it, as Figma's objects snap: where sounds start and
// end and where they hit, whether the cues show or not, those this scale shows (seen); never while ⌘ aims finely. The
// nearest, { t, d } with its distance in px, or null; a marker (or the takes' place) in reach before a cue, a cue by
// it one snap with it, the marker's
function stick(t) {
  if (!snapping || fine()) return null
  const nearest = list => list.reduce((best, q) => { const d = Math.abs(x(q) - x(t)); return d <= ONTO && (!best || d < best.d) ? { t: q, d } : best }, null)
  return nearest(ownMarks()) ?? nearest(seen().map(i => cues[i]))
}
const stuck = t => stick(t)?.t ?? t
// The line edited over the sound, on its own scale in each lane: the gain curve, dB, mirrored about the centre line as
// the waveform is (GAIN), by tenths of a dB; or, editing pitch, the pitch line, semitones, an octave up at
// the lane's top and one down at its foot, to the cent. Each snaps to 0
const pitchLine = () => pitching
const ly = ([, y, , lh], v, sign = 1) => y + lh / 2 - sign * (pitchLine() ? Math.max(-1, Math.min(1, v / 12)) : Math.max(0, Math.min(1, (v - GAIN[0]) / (GAIN[1] - GAIN[0])))) * lh / 2
const valueOf = ([, y, , lh], py) => pitchLine() ? (y + lh / 2 - py) / (lh / 2) * 12 : GAIN[0] + Math.min(1, Math.abs(py - y - lh / 2) / (lh / 2)) * (GAIN[1] - GAIN[0])
const snapV = (rect, py) => {
  const step = pitchLine() ? .01 : .1
  return Math.abs(ly(rect, 0) - fold(rect, py)) <= SNAP ? 0 : +(Math.round(valueOf(rect, py) / step) * step).toFixed(2)
}
const local = event => { const r = root.getBoundingClientRect(); return [event.clientX - r.left, event.clientY - r.top] }
const inside = ([lx, ly, lw, lh], px, py) => px >= lx && px <= lx + lw && py >= ly && py <= ly + lh
// Frequency ↔ y within a spectrogram's lane: the part of its scale shown; within a notes lane, its keys, a row each
const axis = () => scales[scale]
const freqs = () => [scales[scale].low, rate / 2]
const shown = () => fview
const fy = (rect, f, [lo, hi] = freqs(), [u0, u1] = shown()) => rect.keys ? keyY(rect, midiOf(f)) : rect[1] + rect[3] - (axis().at(Math.max(lo, f), lo, hi) - u0) / (u1 - u0) * rect[3]
const uy = ([, y, , lh], py, [u0, u1] = shown()) => u0 + (y + lh - py) / lh * (u1 - u0)
const yf = (rect, py, [lo, hi] = freqs()) => rect.keys ? 440 * 2 ** ((yKey(rect, py) - 69) / 12) : axis().of(uy(rect, py), lo, hi)
// A note's row in a notes lane (MIDI, a pitch's fractional): its middle's height; the note at a height
const rowOf = rect => rect[3] / (rect.keys[1] - rect.keys[0] + 1)
const keyY = (rect, m) => rect[1] + rect[3] - (m - rect.keys[0] + .5) * rowOf(rect)
const yKey = (rect, py) => rect.keys[0] - .5 + (rect[1] + rect[3] - py) / rowOf(rect)
// the keys whose rows show, wholly or in part (`whole`, those whose middles do), from the lowest
const keyRows = (rect, whole = false) => { const [lo, hi] = rect.keys, d = whole ? 0 : .5, out = []; for (let m = Math.ceil(lo - d); m <= Math.floor(hi + d); m++) out.push(m); return out }
// Sample value ↔ y in a lane: `sign` × `a` in the values it shows, kept within it
const ay = ([, y, , lh], a, sign = 1) => y + Math.max(0, Math.min(1, (aview[1] - sign * a) / (aview[1] - aview[0]))) * lh
const ya = ([, y, , lh], py) => aview[1] - (py - y) / lh * (aview[1] - aview[0])
// the gain curve mirrors about the centre line: either half grabs and drags it; the pitch curve is one line
const fold = ([, y, , lh], py) => pitchLine() ? py : y + lh / 2 - Math.abs(py - y - lh / 2)
const nearPoint = (rect, px, py) => ([t, v]) => Math.abs(x(t) - px) <= EDGE && Math.abs(ly(rect, v) - fold(rect, py)) <= EDGE + 2
// the point nearest the pointer among those near it, or -1
const pointAt = (rect, px, py) => {
  let best = -1, d = Infinity
  linePoints().forEach((p, i) => { const e = Math.hypot(x(p[0]) - px, ly(rect, p[1]) - fold(rect, py)); if (nearPoint(rect, px, py)(p) && e < d) { d = e; best = i } })
  return best
}
// Lanes the overlays draw in: amplitude over the waveform if it shows; the line edited, the gain's there too, the
// pitch's on the waveform alone (the spectrogram has its own: the pitch curve, the line's points on it)
const ampLanes = L => L.wave.length ? L.wave : L.spec
const lineLanes = L => pitchLine() ? L.wave : ampLanes(L)
// lanes on a pitch axis, where the pitch curve shows and is dragged: the spectrogram's, the notes'
const pitchLanes = L => [...L.spec, ...L.notes]
// A canvas resized is blank until drawn again, and the browser shows what is there at the next paint: drawn here,
// in the resize callback before that paint, a divider dragged never flashes an empty picture. Where the view starts
// and its scale stay: a panel opening beside it, or the window narrowing, shows less of the sound, never squeezes it.
function resize() {
  const r = root.getBoundingClientRect(), d = devicePixelRatio || 1, cw = Math.round(r.width * d), ch = Math.round(r.height * d), was = plot().w
  ground(r)
  const all = duration && W <= gutter + 1 && start <= 0 && Math.abs(end - duration) < 1e-9
  W = r.width; H = r.height; dpr = d
  // a sound fitted before the view had a width, fitted once it has one; else, a panel opened, the window narrowed, its
  // start and its scale kept
  if (all && W > gutter + 1) fitTo(0, duration)
  else if (duration && W > gutter + 1 && was > 1 && plot().w !== was) setRange(start, start + (end - start) / was * plot().w)
  if (overlay.width !== cw || overlay.height !== ch) { overlay.width = cw; overlay.height = ch }
  cancelAnimationFrame(frame)
  frame = 0; assign({ pictures: true })
  render()
}
// What an edit is still making: frozen, and said so (onbusy) as that starts or ends
function freeze(list) {
  const was = frozen.length > 0
  frozen = list
  if (was !== list.length > 0) onbusy(list.length > 0)
  invalidate(true)
}
// the lane what the edited track's edits freeze is in: its, with tracks; every one without
const own0 = () => tracks ? focus : null
// a press on what is frozen
const frozenAt = (px, py, L = lanes()) => { const t = time(px), i = laneAt(L, py); return i >= 0 && frozen.some(f => (f.lane == null || f.lane === i) && t >= f.a && t <= f.b) }
// What is frozen: a light passing along each lane it is in, as a part still calculating (a layer of its own the
// compositor runs, editor.css .veil), within the lanes' place
const veils = []
function placeFrozen(L) {
  const all = L.all, end = lanesEnd(L), { h } = plot(), rects = []
  for (const { lane, a, b } of frozen) for (const [, y, , lh] of lane == null ? all : [lane === 'room' ? roomLane(L) : all[lane]].filter(Boolean)) {
    const x0 = Math.max(0, X(a)), x1 = Math.min(end, X(Math.min(b, duration))), y0 = Math.max(0, y), y1 = Math.min(h, y + lh)
    if (x1 > x0 && y1 > y0) rects.push([x0, y0, x1 - x0, y1 - y0])
  }
  while (veils.length < rects.length) veils.push(element('div', 'veil', root))
  veils.forEach((el, i) => {
    const r = rects[i], css = r ? `left: ${Math.round(r[0])}px; top: ${Math.round(r[1])}px; width: ${Math.round(r[2])}px; height: ${Math.round(r[3])}px` : ''
    el.hidden = !r
    if (r && el.style.cssText !== css) el.style.cssText = css
  })
}
// The lane a piece is carried into (guest), as it will be: its own sound either side, the piece between, over what was
// there; each part in view, { k (the lane whose samples it shows), from, to (samples), x0, x1 (CSS px) }
// ('room': into a new track, under the last, the piece alone)
function carried(i) {
  const { at, a, b, of } = guest, out = []
  const part = (k, t0, t1, s0) => { const p = Math.max(t0, start), q = Math.min(t1, end); if (q > p) out.push({ k, from: (s0 + p - t0) * rate, to: (s0 + q - t0) * rate, x0: x(p), x1: x(q) }) }
  if (i !== 'room') part(i, 0, at, 0)
  part(of, at, at + b - a, a)
  if (i !== 'room') part(i, at + b - a, Infinity, at + b - a)
  return out
}
// The lane a new track would have in the room: under tracks, where the one made there has it, under its head line, as
// tall as the last's; under a sound, all the room. The part in the picture, or null
function roomLane(L = lanes()) {
  const r = roomOf(L), y = r && r.y + headOf(), h = r && Math.min(tracks ? L.all.at(-1)[3] : Infinity, plot().h - y)
  return h > 0 ? [0, y, plot().w, h] : null
}
// Each piece's part in view: where on screen (CSS px across the plot), the samples it shows, its level
function spans() {
  return pieces.flatMap(p => {
    const a = Math.max(p.d0, start), b = Math.min(p.d1, end), k = (p.s1 - p.s0) / (p.d1 - p.d0 || 1)
    return b > a ? [{ x0: x(a), x1: x(b), from: (p.s0 + (a - p.d0) * k) * rate, to: (p.s0 + (b - p.d0) * k) * rate, gain: p.gain ?? 1 }] : []
  })
}
// The output's pieces after an edit of [a, b]: moved to start at `to` over what is there, silence where it was
// (fn/move.js), a copy put in at `to` (what was there after it), stretched to end at `to` (what follows moving with
// it), `db` louder, silence (gone to another track); or gone (remove, cut), or all that stays (crop); or, silence opened
// at a until `to` (insert), what was after it after that. Silence an edit opens is drawn by the pictures from samples
// there are at this level: as a waveform draws silence, its centre line; as a spectrogram does, nothing
const SILENT = 1e-6
function arrange(kind, a, b, to = a, db = 0) {
  const T = duration, d = b - a, g = 10 ** (db / 20)
  const run = (list, at = 0) => list.filter(([s0, s1]) => s1 > s0).map(([s0, s1, gain = 1]) => { const p = { s0, s1, d0: at, d1: at + s1 - s0, gain }; at = p.d1; return p })
  const silent = (d0, d1) => ({ s0: 0, s1: Math.min(T, d1 - d0), d0, d1, gain: SILENT, silent: true })
  if (kind === 'move') return [...carve([...run([[0, a]]), silent(a, b), ...run([[b, T]], b), ...to > T ? [silent(T, to)] : []], to, to + d), { s0: a, s1: b, d0: to, d1: to + d, gain: 1 }]
  if (kind === 'copy') return run([[0, to], [a, b], [to, T]])
  if (kind === 'stretch') return [...run([[0, a]]), { s0: a, s1: b, d0: a, d1: to, gain: g }, ...run([[b, T]], to)]
  if (kind === 'gain') return run([[0, a], [a, b, g], [b, T]])
  if (kind === 'silence') return [...run([[0, a]]), silent(a, b), ...run([[b, T]], b)]
  if (kind === 'remove' || kind === 'cut') return run([[0, a], [b, T]])
  if (kind === 'insert') return [...run([[0, a]]), silent(a, to), ...run([[a, T]], to)]
  if (kind === 'removes') return run([...a.map((r, i) => [i ? a[i - 1][1] : 0, r[0]]), [a.at(-1)[1], T]])
  if (kind === 'gains') return run(a.flatMap((r, i) => [[i ? a[i - 1][1] : 0, r[0]], [r[0], r[1], g]]).concat([[a.at(-1)[1], T]]))
  if (kind === 'crop') return run([[a, b]])
  return null
}
// Pieces with what goes to [p, q) taken out of them: what lands there goes over it
const carve = (list, p, q) => list.flatMap(piece => {
  const k = (piece.s1 - piece.s0) / (piece.d1 - piece.d0 || 1), part = (d0, d1) => d1 > d0 ? [{ ...piece, s0: piece.s0 + (d0 - piece.d0) * k, s1: piece.s0 + (d1 - piece.d0) * k, d0, d1 }] : []
  return [...part(piece.d0, Math.min(piece.d1, p)), ...part(Math.max(piece.d0, q), piece.d1)]
})
// A time on the output now where the pieces shown take it (the cues, the markers move with the audio), or null where
// they take it out
function moved(t) {
  if (!pieces) return t
  const p = pieces.find(p => !p.silent && t >= p.s0 - 1e-9 && t <= p.s1 + 1e-9)
  return p ? p.d0 + (t - p.s0) * (p.d1 - p.d0) / (p.s1 - p.s0 || 1) : null
}
// A fade drawn at once: what it covers in 48 steps, each at its level on the fade's curve (fn/fade.js); in or out
// over [t0, t1]
function faded(kind, t0, t1, n = 48) {
  const len = t1 - t0, c = CURVES[fadeCurve], level = u => Math.max(1e-4, c(kind === 'in' ? u : 1 - u))
  const list = [[0, t0, 1], ...Array.from({ length: n }, (_, i) => [t0 + len * i / n, t0 + len * (i + 1) / n, level((i + .5) / n)]), [t1, duration, 1]]
  return list.filter(([s0, s1]) => s1 > s0).map(([s0, s1, gain]) => ({ s0, s1, d0: s0, d1: s1, gain }))
}
// A crossfade across [p, q] drawn at once, as remove() with a crossfade as long splices it (fn/crossfade.js, fn/remove.js):
// the range goes, and over its half-length either side of the seam the audio before it runs on, fading out, while the
// audio after it comes in early, fading in, on equal-power curves: the two drawn there over each other, each at its
// level in 24 steps, as they will sound together. Within the sound: the halves shrink at its ends.
const half = (p, q) => Math.min((q - p) / 2, p, duration - q)
function crossed(p, q, n = 24) {
  const h = half(p, q), len = 2 * h / n, L = q - p
  const ramp = (s, rise) => Array.from({ length: n }, (_, i) => {
    const u = (i + .5) / n, g = CROSSFADES.equal(rise ? u : 1 - u)
    return { s0: s + i * len, s1: s + (i + 1) * len, d0: p - h + i * len, d1: p - h + (i + 1) * len, gain: Math.max(1e-4, g) }
  })
  return [{ s0: 0, s1: p - h, d0: 0, d1: p - h, gain: 1 }, ...ramp(p - h, false), ...ramp(q - h, true), { s0: q + h, s1: duration, d0: p + h, d1: duration - L, gain: 1 }].filter(c => c.s1 > c.s0)
}
// How brightly the sound is drawn, set on the layers themselves so it fades (editor.css): nothing drawn yet, a file
// arriving (dim, as it is not the output yet), or a sound that is there. One sound never blinks out for the next:
// whatever shows stays until what replaces it is drawn over it, and only its light moves. What is drawn over the
// sound (its axes, its lanes' marks, the caret) comes with the first of it: empty lanes never show, waiting for it.
const SHADES = { none: 0, empty: 0, dim: .45, full: 1 }
let shade = 'none'
function light(name) {
  if (name === shade) return
  shade = name
  for (const canvas of [specCanvas, waveCanvas]) canvas.style.opacity = SHADES[name]
  for (const canvas of [overlay, marksCanvas, selectCanvas, rowStrip.g.canvas, meterStrip.g.canvas]) canvas.style.opacity = +(name !== 'none')
}
function invalidate(overlay = false) { pictures || assign({ pictures: !overlay }); frame ||= requestAnimationFrame(render) }
// The tape: the pictures as drawn, from where the view started then, AHEAD of a view's width past its right end, on the
// reel. The view scrolled or followed within them (the same span, the same size), the reel moves by as many device
// pixels, a layer the compositor moves (roll), nothing drawn again; past them, or at another span, drawn again from
// where the view is. A view's width further: drawn once in two thirds of the time the view takes to cross it.
// { start, end (s, all of them), W (CSS px across), view (the view's W then), H, dpr, span }
const AHEAD = .6
let tape = null, rolled = null
// the geometry the pictures are drawn in: the view's, AHEAD further (or the tape's as drawn, `t`), for `fn`
function onTape(fn, t = null) {
  const was = [start, end, W, hovered], w = plot().w, extra = Math.round(w * AHEAD)
  if (t) { assign({ start: t.start, end: t.end }); W = t.W; if (hovered) assign({ hovered: [hovered[0] + rolled / dpr, hovered[1]] }) }
  else { assign({ end: start + (end - start) * (w + extra) / w }); W += extra }
  try { return fn() } finally { assign({ start: was[0], end: was[1] }); W = was[2]; assign({ hovered: was[3] }) }
}
// where the view is on the tape, device px from its start; null where it is not on it whole
function onReel() {
  const t = tape
  if (!t || t.dpr !== dpr || t.H !== H || t.view !== W || Math.abs(end - start - t.span) > 1e-9 * t.span) return null
  // a third of what was drawn ahead still to come, so the reel, run on by itself while the page is busy, has some
  const px = (start - t.start) / t.span * plot().w
  return px > -1e-6 && px + W <= t.W - (t.W - t.view) / 3 + 1e-6 ? Math.round(px * dpr) : null
}
// The reel where the view is on it, `px` device px along. Followed (cruise, its device px a second), it runs on by an
// animation of its transform, which the compositor runs: however late or busy the page's thread, the pictures and
// what is drawn in time on them move on as smoothly as the display, to the tape's end at most. Set again only when it
// is off where that has it by more than a device pixel and a half (the view's start steps a whole one at a time), or
// its speed changes by more than the playhead's trimming of it (a twentieth), or it stops
// `cruised`: the frame's time the view's start was set for, followed, a frame or so before the reel is drawn there
let running = null
function roll(px, v = 0) {
  const now = v ? cruised : document.timeline?.currentTime ?? performance.now()
  if (running && v && Math.abs(running.v - v) <= v * .05 && Math.abs(running.px + running.v * (now - running.at) / 1000 - px) <= 1.5) { rolled = px; return }
  if (!running && !v && px === rolled) return
  running?.animation.cancel()
  running = null
  rolled = px
  reel.style.transform = `translateX(${-px / dpr}px)`
  const far = v > 0 && tape ? Math.round(tape.W * dpr) - Math.round(tape.view * dpr) - px : 0
  if (far <= 0) return
  const animation = reel.animate([{ transform: `translateX(${-px / dpr}px)` }, { transform: `translateX(${-(px + far) / dpr}px)` }], { duration: far / v * 1000, fill: 'forwards' })
  animation.startTime = now
  running = { px, v, at: now, animation }
}
function render() {
  frame = 0
  if (moving) moveOn()
  fitAxis()
  light(recording || data.length || windows || arriving?.length ? arriving?.dim ? 'dim' : 'full' : unwritten() ? 'empty' : 'none')
  // the grid ruled anew (a zoom, the level axis' units) draws the pictures again, as it is cut by the waveform drawn
  if (tape && onTape(() => gridKey(lanes()), tape) !== ruled) assign({ pictures: true })
  const at = pictures ? null : onReel()
  if (at != null) { roll(at, cruise); return paint(lanes()) }
  assign({ pictures: false })
  const view = W, span = end - start
  onTape(draw)
  if (tape) Object.assign(tape, { view, span })
  running?.animation.cancel()
  running = null
  rolled = null
  roll(0, cruise)
  paint(lanes())
}
// The pictures drawn on the tape, from where the view is
function draw() {
  const L = lanes(), from = start * rate, to = end * rate, cw = Math.round(W * dpr), ch = Math.round(H * dpr)
  // a view of no size (laid out none yet, hidden): nothing to draw on
  if (!cw || !ch) { tape = null; return }
  for (const canvas of [selectCanvas, specCanvas, waveCanvas, marksCanvas]) if (canvas.width !== cw || canvas.height !== ch) { canvas.width = cw; canvas.height = ch }
  reel.style.width = `${W}px`
  tape = { start, end, W, H, dpr }
  assign({ picked: null })
  drawn = performance.now()
  if (gl) {
    // the whole canvas cleared, whatever scissor a lane's drawing left: two renders in a task (snapshot) see no frame between
    gl.disable(gl.SCISSOR_TEST)
    gl.viewport(0, 0, waveCanvas.width, waveCanvas.height)
    gl.clearColor(0, 0, 0, 0)
    gl.clear(gl.COLOR_BUFFER_BIT)
    // the canvas's own device-to-CSS ratio, exact after rounding its size
    const ratio = waveCanvas.width / (W || 1)
    waves.forEach((wave, i) => {
      const rect = laneOf(L.wave, merged() ? 0 : i)
      if (!rect) return
      if (guest?.lane === i) { for (const p of carried(i)) drawWave(waves[p.k], p.k, rect, p.from, p.to, p.x0, p.x1, aview, ratio, undefined, p.k === i && tracks?.[i] ? X(tracks[i].end) : Infinity); return }
      if (!pieces || tracks && i !== (pieces.lane ?? focus)) return drawWave(wave, i, rect, from, to, 0, rect[2], aview, ratio, undefined, tracks?.[i] ? X(tracks[i].end) : Infinity)
      for (const p of spans()) drawWave(wave, i, rect, p.from, p.to, p.x0, p.x1, aview.map(v => v / p.gain), ratio)
    })
    // a piece carried into a new track: in the room, where its lane will be
    const room = guest?.lane === 'room' && roomLane(L)
    if (room) for (const p of carried('room')) drawWave(waves[p.k], p.k, room, p.from, p.to, p.x0, p.x1, aview, ratio)
    // a take being recorded, where it goes: its own waveform over what it replaces, drawn as the output's is (over a
    // notes lane too, whose notes are found once it is done)
    if (recording?.length) waves.forEach((_, i) => {
      if (tracks && i !== focus) return
      const c = Math.min(i, recording.waves.length - 1), rect = laneOf(L.wave, merged() ? 0 : i) ?? laneOf(L.notes, merged() ? 0 : i), [x0, x1] = takes()
      if (rect && x1 > x0) drawWave(recording.waves[c], i, rect, recording.lead, recording.length, x0, x1, aview, ratio, { x: recording.data?.[c].subarray(0, recording.length), rate: recording.rate, id: `take ${c}` })
    })
  }
  if (sgl) spectrograms(L, from, to)
  want(L, from, to)
  if (L.wave.length) weigh()
  paintGrid(L)
}
// A long sound's samples where the view needs them (windows): the chunks missing, fetched a run at a time, drawn as they
// come; then, past HELD, those farthest from the view let go
function want(L, from, to) {
  if (!windows || arriving || !onsamples) return
  const spp = (to - from) / Math.max(1, plot().w * dpr)
  if (!(spp < WAVE || L.spec.length && to - from <= SPAN)) return
  const span = to - from, n = Math.ceil(duration * rate / CHUNK), j0 = Math.max(0, Math.floor((from - span / 2) / CHUNK)), j1 = Math.min(n, Math.ceil((to + span / 2) / CHUNK))
  for (let j = j0; j < j1;) {
    if (windows.has(j)) { j++; continue }
    let k = j
    while (k < j1 && !windows.has(k)) k++
    fetch(j, k, (from + to) / 2)
    j = k
  }
}
// Chunks [j, k) fetched and drawn, `mid` where the view is
function fetch(j, k, mid) {
  const of = windowsOf, got = Promise.resolve(onsamples(j * CHUNK, Math.min(k * CHUNK, Math.round(duration * rate)))).catch(() => null)
  for (let i = j; i < k; i++) windows.set(i, got)
  got.then(channels => {
    if (of !== windowsOf) return
    if (!channels?.length) { for (let i = j; i < k; i++) windows.delete(i); return }
    channels.forEach((x, c) => { waves[c]?.set(x, j * CHUNK); specs[c]?.set(x, j * CHUNK) })
    for (let i = j; i < k; i++) windows.set(i, true)
    assign({ leveled: false })
    trim(mid)
    invalidate()
  })
}
// Past HELD samples a channel, the chunks farthest from `mid` let go: the pictures draw them from the leaves and spectra
// again
function trim(mid) {
  const all = [...windows].filter(([, v]) => v === true).map(([j]) => j)
  if (all.length * CHUNK <= HELD) return
  const gone = all.sort((p, q) => Math.abs((q + .5) * CHUNK - mid) - Math.abs((p + .5) * CHUNK - mid)).slice(0, all.length - HELD / CHUNK)
  for (const j of gone) { windows.delete(j); for (const p of [...waves, ...specs]) p.drop(j * CHUNK, (j + 1) * CHUNK) }
}
// A channel's waveform over [x0, x1) of its lane, samples [from, to): in its colour, or, a sound's (a track keeps its
// own), coloured for what it holds in frequency (tint.js coloured), a colour every 4 to 8 px, on a grid of the sound's
// own samples, so the colours stay put as the view scrolls; where it is silent, its own colour. The samples are the
// output's, or a take's (`src`); a stretch not yet whole is measured again each time, as a take fills it. `tints` keeps
// each stretch's measures, so a new colouring costs no spectra; `palette` the colormap's 256 colours and the
// lightness the colours take, the waveform's drawn into .5–.8, as a track's (tint), so they read on a light screen as
// on a dark one; made again as they or the skin change
const tints = new Map()
function tonesOf(map, n) {
  const L = Math.max(.5, Math.min(.8, lightness(rgba(color('--color-screen-wave')))))
  const of = map === 'temperature' ? u => temperature(u, L) : colormap((MAPS[map] ?? inked(rgba(color('--color-screen-bright')), 17)).map(rgba), rgba(color('--color-screen')))
  return { L, tones: Array.from({ length: n }, (_, k) => of(k / (n - 1))) }
}
const paletted = () => (palette ?? assign({ palette: tonesOf(waveLook.map, 256) }))
const tone = u => paletted().tones[Math.round(u * 255)]
// Weighted (waveLook.weighting), zoomed out the waveform is its levels as heard, zoomed in its samples as they are
// (weigh): from a leaf (256 samples) a px, where a low tone's cycles run together (100 Hz's two px at 48 kHz), its
// twin's; under a quarter of that, where they stand apart, its own; between, one fading into the other, as gl-waveform
// fades its line into its envelope, each the more opaque, 1 − t² and 1 − (1 − t)², so where both lie the fill thins a
// sixteenth at most
const LEAF = 256, heardShare = spp => Math.max(0, Math.min(1, Math.log2(spp / LEAF) / 2 + 1))
// `stop`: the px a track's sound ends at, its centre line with it
const MUTED = .4
function drawWave(wave, i, rect, from, to, x0, x1, amplitude, pixelRatio, src = { x: data[i], rate, id: i }, stop = Infinity) {
  const t = twinOf.has(wave) && x1 > x0 ? heardShare((to - from) / (x1 - x0)) : 0
  const both = [[wave, 1 - t * t], [twinOf.get(wave), 1 - (1 - t) ** 2]].filter(([w, k]) => w && k > 0)
  for (const [w] of both) w.update(FILLS[waveLook.fill] ?? FILLS.density)
  // a muted track's, as dim as the veil over its other pictures leaves them (MUTED of its colour)
  const hush = tracks?.[i]?.muted ? MUTED : 1
  const at = (c, a, b, p, q, s = 1) => {
    if (q > stop) { if (p >= stop) return; b = a + (b - a) * (stop - p) / (q - p); q = stop }
    for (const [w, k] of both) w.update({ color: k * hush < 1 ? [c[0], c[1], c[2], (c[3] ?? 1) * k * hush] : c, range: [a, b], viewport: [rect[0] + p, rect[1], q - p, rect[3]], pixelRatio, amplitude: s < 1 ? amplitude.map(v => v / s) : amplitude }).render()
  }
  if (waveLook.colour === 'none' || arriving || !src.x || x1 - x0 < 1 || to <= from) return at(hues[i], from, to, x0, x1)
  const spp = (to - from) / (x1 - x0), len = 2 ** Math.max(4, Math.ceil(Math.log2(spp * 4))), { L } = paletted()
  if (tints.size > 2e4) tints.clear()
  for (let k = Math.floor(from / len); k * len < to; k++) {
    const a = Math.max(from, k * len), b = Math.min(to, (k + 1) * len), key = `${src.id} ${len} ${k}`, p = x0 + (a - from) / spp, q = x0 + (b - from) / spp
    let m = tints.get(key)
    if (m === undefined) { m = measure(src.x, k * len, (k + 1) * len, src.rate); if ((k + 1) * len <= src.x.length) tints.set(key, m) }
    if (!m) { at(hues[i], a, b, p, q); continue }
    // a band under a hundredth of the height, none: drawn, it would be a line along the axis
    for (const [c, s] of coloured(waveLook.colour, m, tone, L)) if (s > .01) at(c, a, b, p, q, s)
  }
}
// Its levels as heard (waveLook.weighting): each wave's twin (`twinOf`, by the wave), gl-waveform's peaks of its samples
// weighted, which the worker reads through all of them (onheard: K, ITU-R BS.1770's, as loud as it sounds; A, IEC
// 61672's, as a sound level meter weighs it) and the twin holds alone: zoomed out past a leaf a px, as gl-waveform draws
// from its peaks, nothing more to fetch where it zooms in. `heardOf` counts the samples' changes, so the weighing of
// ones changed since is let go; the twins weighed for the one before drawn till the new come, where a part changed
let twinOf = new Map(), heardOf = 0, weighing = false, twinsOf = -1
const twinned = next => { for (const w of twinOf.values()) w.destroy(); twinOf = next }
function unheard(keep = false) { heardOf++; weighing = false; if (!keep) twinned(new Map()) }
function weigh() {
  const kind = waveLook.weighting
  if (!kind || kind === 'none' || !onheard || arriving || weighing || twinsOf === heardOf || !waves.length) return
  const of = heardOf, list = waves.slice()
  weighing = true
  Promise.resolve(onheard(kind)).catch(() => null).then(leaves => {
    if (of !== heardOf) return
    // none to be had now (an output on its way): asked again as it draws next
    weighing = false
    if (leaves?.length !== list.length) return
    twinned(new Map(list.map((w, c) => { const twin = new Waveform(gl); twin.peaks(leaves[c], 0); return [w, twin] })))
    twinsOf = of
    invalidate()
  })
}
// Each channel's spectrogram in its lane, the part of its scale shown; an edit's pieces each where it goes, at its
// level. One scale of levels for the lanes, the loudest channel's, so channels compare as they sound (each its own
// while an output arrives); a take's channels among them as it comes, so it shows as the output holding it will.
// Zoomed out, a render leaves columns short of frames: it draws again until they are whole.
// With no lane of its own, its canvas is cleared once and left so: a canvas drawn, even blank, is a window-wide layer
// composited again, each frame the view scrolls.
let blank = false
function spectrograms(L, from, to) {
  if (blank && !L.spec.length) return
  sgl.disable(sgl.SCISSOR_TEST)
  sgl.viewport(0, 0, specCanvas.width, specCanvas.height)
  sgl.clearColor(0, 0, 0, 0)
  sgl.clear(sgl.COLOR_BUFFER_BIT)
  if (blank = !L.spec.length) return
  const [lo, hi] = freqs(), band = fview.map(u => scales[scale].of(u, lo, hi)), ratio = specCanvas.width / (W || 1)
  const all = [...specs, ...recording?.specs ?? []]
  for (const sg of all) sg.update({ scale, band, pixelRatio: ratio })
  if (!leveled && !arriving && all.length) {
    const loudest = all.map(sg => sg.update({ levels: null }).levels).reduce((a, b) => b[1] > a[1] ? b : a)
    for (const sg of all) sg.update({ levels: loudest })
    decibels = loudest
    assign({ leveled: true })
  }
  specs.forEach((sg, i) => {
    const rect = laneOf(L.spec, i)
    if (!rect) return
    if (guest?.lane === i) { for (const p of carried(i)) specs[p.k]?.update({ range: [p.from, p.to], viewport: [rect[0] + p.x0, rect[1], p.x1 - p.x0, rect[3]], gain: 1 }).render(); return }
    if (!pieces || tracks && i !== (pieces.lane ?? focus)) return sg.update({ range: [from, to], viewport: rect, gain: 1 }).render()
    for (const p of spans()) sg.update({ range: [p.from, p.to], viewport: [rect[0] + p.x0, rect[1], p.x1 - p.x0, rect[3]], gain: p.gain }).render()
  })
  // (a piece carried into a new track shows in the room as its waveform: draw)
  // a take being recorded, where it goes: its own spectrogram over what it replaces
  if (recording?.length) L.spec.forEach(rect => {
    if (tracks && rect.i !== focus) return
    const sg = recording.specs[Math.min(rect.i, recording.specs.length - 1)], [x0, x1] = takes()
    if (sg && x1 > x0) sg.update({ range: [recording.lead, recording.length], viewport: [rect[0] + x0, rect[1], x1 - x0, rect[3]] }).render()
  })
  if (all.some(sg => sg.pending)) invalidate()
}
// What the lanes show changed, the picture's, a track's own, or the tracks themselves: a band, and the boxes beside it,
// gone where the edited lane shows no spectrogram; all of the sound shown still shown as the meters by the lanes widen
// or narrow
function reshow(change) {
  const was = lanesEnd(lanes()), all = !recording && duration && whole()
  change()
  if (band && kindOf(focus) !== 'spec') { assign({ band: null }); assign({ more: more.filter(r => r.length === 2) }); told() }
  if (all && lanesEnd(lanes()) !== was) fitTo(0, duration)
  invalidate()
}
// The picture as a PNG data URL, for an agent to look at: the waveform over the spectrogram, each with its rulers, of
// [a, b] s (what shows, else), at most `width` px across, every lane in each, whatever a track shows. Drawn, read and
// put back in one task: the screen never shows it
function snapshot(range, width = 1200) {
  const was = { start, end, display, hovered, kinds }, modes = sgl ? ['wave', 'spec'] : ['wave']
  if (range) { assign({ start: Math.max(0, range[0]) }); assign({ end: Math.max(start + 32 / rate, range[1]) }) }
  assign({ hovered: null })
  assign({ kinds: {} })
  const k = Math.min(1, width / overlay.width), w = Math.round(overlay.width * k), h = Math.round(overlay.height * k)
  const shot = Object.assign(document.createElement('canvas'), { width: w, height: h * modes.length }), g = shot.getContext('2d')
  g.fillStyle = color('--color-screen')
  g.fillRect(0, 0, w, shot.height)
  modes.forEach((mode, i) => {
    assign({ display: mode })
    // a spectrogram zoomed out fills its columns over several renders (spectrograms)
    for (let n = 0; n < 64 && (!n || specs.some(sg => sg.pending)); n++) { assign({ pictures: true }); render() }
    // the view's part of each, the reel's at its start
    for (const canvas of [selectCanvas, specCanvas, waveCanvas]) g.drawImage(canvas, 0, 0, overlay.width, overlay.height, 0, i * h, w, h)
    const row = rowStrip.g.canvas
    if (row.height) g.drawImage(row, 0, 0, overlay.width, row.height, 0, i * h + rowStrip.at * k, w, row.height * k)
    g.drawImage(marksCanvas, 0, 0, overlay.width, overlay.height, 0, i * h, w, h)
    for (const { g: { canvas }, at: [x0, y0] = [] } of barOn ? [meterStrip, barStrip] : [meterStrip]) if (canvas.width && canvas.height) g.drawImage(canvas, x0 * k, i * h + y0 * k, canvas.width * k, canvas.height * k)
    g.drawImage(overlay, 0, 0, overlay.width, overlay.height, 0, i * h, w, h)
  })
  assign({ start: was.start, end: was.end, display: was.display, hovered: was.hovered, kinds: was.kinds })
  cancelAnimationFrame(frame)
  assign({ pictures: true })
  render()
  return shot.toDataURL('image/png')
}
let touch = matchMedia('(hover: none)').matches
// What a drag on the pitch does, heard as it will sound (`onaudition`): from its first move, as it is at 0 too, and
// again each time it changes
function hear(d, changed, what) {
  if (!changed && d.heard) return
  d.heard = true
  onaudition(what)
}
// what a pitch drag is heard over: the voiced stretch of the pitch curve pressed, or the range its tool is on
function pitchRange(d) {
  if (!d.run) return { at: d.a, duration: d.b - d.a }
  const { times } = contour, hop = times[1] - times[0] || .01
  return { at: Math.max(0, times[d.run[0]] - hop / 2), duration: times[d.run[1]] - times[d.run[0]] + hop }
}
// How far a pitch goes, as a tuner says it: semitones and cents, and the note it goes from (`f`, Hz, the pitch curve's
// median over what moves, where it has one) and to
const semis = st => { const whole = Math.trunc(st), ct = Math.round(Math.abs(st - whole) * 100), sign = st > 0 ? '+' : st < 0 ? '−' : ''; return whole || !ct ? `${sign}${Math.abs(whole)}st${ct ? ` ${ct}ct` : ''}` : `${sign}${ct}ct` }
const pitchSays = (st = 0, f = 0, to = f * 2 ** (st / 12)) => f ? `${semis(st)}, ${noteOf(f)} → ${noteOf(to)}` : semis(st)
// How wide a voice's rises and falls go over the range, as the status bar gives a melody's compass (its 10th to 90th
// percentile), and as wide as the factor makes them
function intonationSays({ k, a, b }) {
  const st = voiced(a, b).map(f => 12 * Math.log2(f)), q = p => st[Math.floor(p * (st.length - 1))], wide = st.length > 1 ? q(.9) - q(.1) : 0
  return `×${k.toFixed(2)}${wide ? `, ${wide.toFixed(1)}st → ${(wide * Math.abs(k)).toFixed(1)}st wide` : ''}`
}
// the pitch curve's voiced frames over [a, b], Hz, low to high; their median
function voiced(a, b) { return contour?.f0.length ? [...contour.f0.filter((f, i) => f && contour.times[i] >= a && contour.times[i] <= b)].sort((p, q) => p - q) : [] }
function median({ at, duration }) { const list = voiced(at, at + duration); return list.length ? list[list.length >> 1] : 0 }
const pitched = (rect, L) => L.spec.includes(rect)
const clampY = ([, y, , lh], ly) => Math.max(y + 5, Math.min(y + lh - 5, ly))
// Marks [y, …] by a lane, the most important first, those there is room for: in the lane, `gap` px from each other and
// from what is there (`placed`, ys, added to)
function room([, y, , lh], list, placed = [], gap = size() + 6) {
  return list.filter(([ly]) => {
    const ty = Math.round(ly)
    if (ty < y || ty > y + lh || placed.some(p => Math.abs(p - ty) < gap)) return false
    placed.push(ty)
    return true
  })
}
// Marks [y, text] by a lane: each with room, its tick at its height, its label under it, clear of the pointer's value
// (`taken`, its y)
function ticks(rect, list, taken) {
  const w = plot().w
  for (const [ly, text] of room(rect, list, [taken].filter(v => v != null))) {
    const ty = Math.round(ly)
    c.fillStyle = color('--color-screen-rule')
    c.fillRect(w + 1, ty, TICK, 1)
    c.fillStyle = color('--color-screen-line-number')
    c.fillText(text, w + 1, ty + size() - 1)
  }
}
// The axis as wide as its labels, a pixel before them and 3 px after, GUTTER at most: the levels' in either unit and
// the spectrogram's frequencies', as they are zoomed now, whatever shows, and the pointer's value read out on it as
// precisely as they are zoomed (−0.03, −12.3, 1.23k; on the spectrogram, its level under it, −100), so nothing moves
// where the pictures end as one picture or unit turns to the other, as the pointer reads a value, or as the frequencies
// zoom. Five characters (−12.3dB, a level in six digits, took seven); more only for marks zoomed far in (−0.005)
function axisWidth() {
  const [lo, hi] = [scales[scale].low, rate / 2], hz = [reads(scales[scale].of(fview[0], lo, hi)), ...marks().map(hertz)], lane = [0, 0, 1, 1e4]
  const texts = [...levelMarks(lane, 'linear'), ...levelMarks(lane, 'db')].map(m => m[1]).concat(hz, aview.map(sampled), decibel(-98.9, 1), reads(1111), decibel(-100))
  c.font = label()
  return Math.min(GUTTER, Math.ceil(Math.max(TICK, ...texts.map(t => c.measureText(t).width))) + 4)
}
// The axis' width as its labels change it (what places them changed: `fitted`): the pictures drawn again to the new
// width, all of the sound still shown where all of it was, else the view keeping where it starts and its scale, as a
// panel opening beside it leaves them (resize); the page told (onaxis)
let fitted = ''
function fitAxis() {
  const key = [aview, fview, scale, rate, label()].join()
  if (key === fitted) return
  fitted = key
  const g = axisWidth(), was = plot().w, all = duration && start <= 0 && Math.abs(seenTo() - duration) < 1e-9 * duration
  onaxis(g)
  if (g === gutter) return
  gutter = g
  assign({ pictures: true })
  if (all) fitTo(0, duration)
  else if (duration && was > 1 && W > gutter + 1) setRange(start, start + (end - start) / was * plot().w)
}
// Frequencies, no unit (the axis is plainly hertz): the lowest the lane shows first, at its foot, as the pointer reads
// one (reads: zoomed in, wherever it falls); then the roundest
const hzMarks = rect => { const [, y, , lh] = rect; return [[y + lh, reads(yf(rect, y + lh))], ...marks().map(f => [fy(rect, f), hertz(f)])] }
// Notes, by name, a piano's white keys first, its C's the first of them, as a piano roll names its octaves
const KEYED = [0, 7, 4, 9, 2, 5, 11, 1, 3, 6, 8, 10]
const noteMarks = rect => keyRows(rect, true).sort((p, q) => KEYED.indexOf(p % 12) - KEYED.indexOf(q % 12) || p - q).map(m => [keyY(rect, m), `${NOTES[m % 12]}${Math.floor(m / 12) - 1}`])
// a lane's marks, as its axis has them: levels, frequencies or notes
const axisMarks = rect => rect.keys ? noteMarks(rect) : rect.kind === 'spec' ? hzMarks(rect) : levelMarks(rect)
// Levels within the values a lane shows, the most telling first: as sample values, 0 and full scale, then 1-2-5 steps
// of what shows; in dB, mirrored about 0 and clear of it, the halvings first, the top's 0 with its unit
function levelMarks(rect, units = levelUnits) {
  const [lo, hi] = aview, within = v => v >= lo - 1e-9 && v <= hi + 1e-9
  if (units === 'linear') return [...new Set([0, 1, -1, ...multiples(lo, hi, valueStep())])].filter(within).map(v => [ay(rect, v), linear(v)])
  const zero = ay(rect, 0)
  return LEVELS.flatMap(db => [1, -1].map(sign => [sign * 10 ** (db / 20), db, sign])).filter(([v]) => within(v) && Math.abs(ay(rect, v) - zero) >= 16)
    .map(([v, db, sign]) => [ay(rect, v), db ? `${db > 0 ? '+' : '−'}${Math.abs(db)}` : sign > 0 ? '0dB' : '0'])
}
const linear = v => v ? `${v < 0 ? '−' : ''}${+Math.abs(v).toPrecision(3)}` : '0'
// the 1-2-5 step the sample values are marked by, four or so across what a lane shows
const valueStep = () => nice((aview[1] - aview[0]) / 4)
// the multiples of `step` in [a, b], clear of float error
const multiples = (a, b, step) => { const out = []; for (let k = Math.ceil(a / step - 1e-9); k * step <= b + 1e-9; k++) out.push(+(k * step).toPrecision(12)); return out }
// Frequencies to mark, roundest first: the scale's own when all of it shows; zoomed in, the round values in view,
// 1-2-5 per decade across a wide span, even steps across a narrow one
function marks() {
  const [lo, hi] = [scales[scale].low, rate / 2], [fa, fb] = fview.map(u => scales[scale].of(u, lo, hi))
  if (fview[1] - fview[0] > .999) return scales[scale].labels.filter(f => f >= lo && f <= hi)
  const within = f => f >= fa && f <= fb, out = []
  if (scale !== 'lin' && fb / fa > 3) {
    for (const m of [1, 5, 2, 3, 4, 6, 7, 8, 9]) for (let p = 1e4; p >= 1; p /= 10) if (within(m * p)) out.push(m * p)
    return out
  }
  const step = nice((fb - fa) / 6)
  for (let f = Math.floor(fb / step) * step; f >= fa; f -= step) out.push(+f.toPrecision(12))
  return out
}
// a frequency as the axis writes it, no unit: 500, 1.25k, 20k
const hertz = f => f >= 1000 ? `${+(f / 1000).toFixed(3)}k` : `${+f.toFixed(f < 100 ? 1 : 0)}`
// A frequency the pointer reads, as the axis writes it: three significant digits, five characters at most (12.3k,
// 523, 52.3; a pixel of a lane on log paper is some 3% of the frequency there); finer, the marks zoomed in say it
const reads = f => f >= 1000 ? `${+(f / 1000).toPrecision(3)}k` : `${+f.toPrecision(3)}`
// the decimals of a 1-2-5 step: 0.5 has one, 0.05 two, 2 none
const places = step => Math.max(0, -Math.floor(Math.log10(step) + 1e-9))
// A sample value the pointer reads: two decimals (−0.03, 0.47), or as many as the marks have zoomed in (0.005 apart,
// −0.026), never wider than they are, so zooming moves the axis no more than its marks do; as wide wherever it is
const sampled = v => { const r = Math.abs(v).toFixed(Math.max(2, places(valueStep()))); return +r ? `${v < 0 ? '−' : ''}${r}` : '0' }
// A level in dB as the axis writes it, no unit: the waveform's axis says dB at its top, and the spectrogram's level,
// under the frequency read, is the one value there below 0. Whole, or to `fixed` places; at or under `floor`, none
const decibel = (v, fixed = 0, floor = -Infinity) => {
  if (!(v > floor)) return '−∞'
  const r = Math.abs(v).toFixed(fixed)
  return `${+r ? v < 0 ? '−' : '+' : ''}${r}`
}
// The level at y in a lane, as the axis writes it: a sample value (sampled), or decibels to a tenth (−12.3); on a mark's
// line, the mark's: within a pixel of it, so a quiet level by the centre line reads as it is, not as the 0 SNAP px
// about it would (±0.1 in a short lane)
function level(rect, py) {
  const mark = levelMarks(rect).find(([ly]) => Math.abs(ly - py) <= 1)
  if (mark) return mark[1]
  const a = ya(rect, py)
  return levelUnits === 'linear' ? sampled(a) : decibel(20 * Math.log10(Math.abs(a)), 1, -99)
}
// Held Alt, how far the pointer at `t` is from what is selected, or from the caret, as Figma's Alt measures: from the
// nearer edge to it, or inside the selection from each edge, { t, spans: [[from, to], …] }; none on an edge. While it
// plays, from the playhead, the caret moving
function measured(t) {
  const [a, b] = playhead != null ? [playhead, playhead] : selection ?? [cursor, cursor], spans = t > b ? [[b, t]] : t < a ? [[t, a]] : t > a && t < b ? [[a, t], [t, b]] : []
  return spans.length ? { t, spans } : null
}
// Measuring over the spectrogram, the time the meters read the spectrum at, the pointer's (onprobe), or null: told
// only as it changes
let probed = null
const probe = t => { if (t !== probed) onprobe(probed = t) }
// in the measuring red, where the pointer is, dashed out to the axes as Figma's guides: down to the time row, where
// its length is (paintRuler), and across to the level or frequency axis, where its value is
// `read`, a waveform's level there (waveAt), past the lane's edge: a small triangle at that edge pointing out to it
const DASHED = [4, 3]
function paintMeasure({ t }, py, rects, read = null) {
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
function waveAt(rect, t, py) {
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
function placeFades(L) {
  const end = lanesEnd(L), h = `${Math.round(floor(L))}px`, on = [start > 1e-9, duration && seenTo() < duration - 1e-9]
  fades.forEach((el, k) => {
    if (el.hidden !== !on[k]) el.hidden = !on[k]
    const left = `${Math.round(k ? end - FADE : 0)}px`
    if (on[k] && (el.style.left !== left || el.style.height !== h)) Object.assign(el.style, { left, height: h })
  })
}
// the box the ground the lanes lie on is painted on (the slab, or a page's): the first around the picture with a
// background of its own, where it is from the picture's top and how tall, for the fades to lay it where it lies
function ground(r) {
  let e = root.parentElement
  while (e && getComputedStyle(e).backgroundImage === 'none' && /^(transparent|rgba\(0, 0, 0, 0\))$/.test(getComputedStyle(e).backgroundColor)) e = e.parentElement
  const g = e?.getBoundingClientRect()
  if (!g) return
  root.style.setProperty('--ground-top', `${Math.round(g.top - r.top)}px`)
  root.style.setProperty('--ground-h', `${Math.round(g.height)}px`)
}
function placeLook(L) {
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
function paintRoom(L, at) {
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
const thumb = () => { const { h } = plot(), th = Math.max(24, h * h / (h + spare)); return { y: lift / spare * (h - th), h: th, room: h - th } }
const liftAt = (px, py) => spare > 0 && px >= W - LIFT && py <= plot().h
function paintLift(at) {
  if (!spare) return
  const t = thumb(), on = drag?.lifting || at && liftAt(...at)
  c.fillStyle = color('--color-screen-rule')
  c.fillRect(W - 4, 0, 3, plot().h)
  c.fillStyle = color(on ? '--color-screen-bright' : '--color-screen-soft')
  c.fillRect(W - 4, Math.round(t.y), 3, Math.round(t.h))
}
// A value by the pointer, on a patch of the screen so the labels under it give way
function tag(text, px, py, align, fill = color('--color-screen-bright'), pill = null) {
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
const accent = () => color('--color-screen-accent'), gauge = () => color('--color-screen-error')
// the picture's words, its numbers and tags: the skin's label size, in its mono font
const size = () => parseFloat(color('--font-size-label')) || 10, label = () => `${size()}px ${color('--font-mono')}`
// What a step sets, as hints over the output, never over the sound itself (`show.guides`): its range a bar on the time
// row, as a DAW's ruler marks a region; a level, its fades' ramps, a time, a frequency, a band, the notes it tunes to
function paintGuide(g, L) {
  // its words end where the lanes' pictures do, clear of the meters
  const { h } = plot(), all = L.all, end = lanesEnd(L)
  c.strokeStyle = c.fillStyle = accent()
  c.lineWidth = 1
  if (g.range && !g.band) {
    const a = X(g.range[0]), b = X(g.range[1])
    c.fillRect(a, h, Math.max(1, b - a), 2)
    // what the range is to the call (denoise's noise)
    if (g.label) { c.textAlign = 'left'; c.fillText(g.label, a + 5, all[0][1] + 10) }
  }
  if (g.notes) for (const rect of L.spec) paintNotes(g, rect, end)
  // a level or a time, a plain line, each end marked with a small cross, as Figma's measures end
  const line = (x0, y0, x1, y1) => { c.beginPath(); c.moveTo(x0, y0); c.lineTo(x1, y1); for (const [px, py] of [[x0, y0], [x1, y1]]) { c.moveTo(px - 2.5, py - 2.5); c.lineTo(px + 2.5, py + 2.5); c.moveTo(px - 2.5, py + 2.5); c.lineTo(px + 2.5, py - 2.5) } c.stroke() }
  if (g.level != null) for (const rect of L.wave) {
    const amp = 10 ** (g.level / 20), [, y, lw] = rect
    for (const sign of [1, -1]) { const ly = Math.round(ay(rect, amp, sign)) + .5; line(3, ly, Math.min(lw, end) - 3, ly) }
    c.textAlign = 'right'
    c.fillText(`${+g.level.toFixed(1)}dB`, end - 6, Math.max(y + 8, ay(rect, amp) - 7))
  }
  // a fade's ramp, [t0, t1, 'in' or 'out', curve]: its level along its curve (the library's; 'equal', a crossfade's equal
  // power, sin and cos), from silence on the centre line to the lane's edges, mirrored as the lane is
  if (g.ramps) for (const [, y, , lh] of ampLanes(L)) for (const [t0, t1, kind, name] of g.ramps) {
    const curve = CROSSFADES[name] ?? CURVES.linear, mid = y + lh / 2, half = lh / 2 - 2
    for (const sign of [1, -1]) {
      c.beginPath()
      for (let i = 0; i <= 32; i++) { const u = i / 32; c.lineTo(x(t0 + u * (t1 - t0)), mid - sign * half * curve(kind === 'in' ? u : 1 - u)) }
      c.stroke()
    }
  }
  if (g.at != null) {
    const px = X(g.at) + .5
    for (const [, y, , lh] of all) line(px, y + 3, px, y + lh - 3)
  }
  // the pitch over an edit, { before, after }, each { times, f0 } on one grid: before dashed and dim, after as the pitch
  // curve is, each named where in view they are furthest apart, on its own side; one the same as the other, said so
  if (g.pitch) for (const rect of L.spec) {
    const { before, after } = g.pitch, soft = color('--color-screen-soft')
    c.save()
    c.beginPath(); c.rect(...rect); c.clip()
    c.strokeStyle = soft; c.setLineDash([3, 3]); c.lineWidth = 1.25
    trace(rect, before.times, i => before.f0[i])
    c.setLineDash([]); c.strokeStyle = accent(); c.lineWidth = 1.5
    trace(rect, after.times, i => after.f0[i])
    c.restore()
    let far = -1, most = 0
    for (let i = 0; i < Math.min(before.f0.length, after.f0.length); i++) {
      const t = after.times[i], a = before.f0[i], b = after.f0[i], st = a && b ? Math.abs(12 * Math.log2(b / a)) : 0
      if (t >= start && t <= end && (far < 0 || st > most) && a && b) { most = st; far = i }
    }
    if (far < 0) continue
    const font = c.font, px = x(after.times[far]), yb = fy(rect, before.f0[far]), ya = fy(rect, after.f0[far]), up = ya < yb
    c.font = label()
    if (most < .25) tag('pitch kept', px, ya - 14, 'center', accent())
    else { tag('before', px, yb + (up ? 14 : -14), 'center', soft); tag('after', px, ya + (up ? -14 : 14), 'center', accent()) }
    c.font = font
  }
  if (g.freq != null || g.band) for (const rect of L.spec) {
    const lw = rect[2]
    if (g.band) {
      const [a, b] = g.range.map(x), top = fy(rect, g.band[1]), bottom = fy(rect, g.band[0])
      c.strokeRect(a + .5, top + .5, b - a, bottom - top)
    } else {
      const ly = Math.round(fy(rect, g.freq)) + .5
      c.setLineDash([4, 3]); c.beginPath(); c.moveTo(0, ly); c.lineTo(lw, ly); c.stroke(); c.setLineDash([])
      c.textAlign = 'right'
      c.fillText(g.freq >= 1000 ? `${+(g.freq / 1000).toFixed(2)}kHz` : `${Math.round(g.freq)}Hz`, end - 6, ly - 7)
    }
  }
}
// The notes a tune lands on (`notes`, MIDI, A4 at `a4`), a hairline each over its span on a spectrogram lane, as a
// tuner's staff: within the voice's range, a whole tone past it either way, as tune-snap decodes it (the pitch curve's
// over the span, else a voice's); the root's brighter. A line within a few pixels of the last gives way, a name at
// the span's end within a line's height
function paintNotes({ notes, root, a4, span = [0, duration] }, rect, end) {
  const xa = Math.max(0, X(span[0])), xb = Math.min(end, X(span[1]))
  if (xb - xa < 2) return
  const f0 = voiced(...span), tone = 2 ** (2 / 12), [lo, hi] = f0.length ? [f0[0] / tone, f0.at(-1) * tone] : VOICE
  let line = -Infinity, named = -Infinity
  c.save()
  c.beginPath(); c.rect(...rect); c.clip()
  c.textAlign = 'right'
  for (const m of notes) {
    const f = a4 * 2 ** ((m - 69) / 12), ly = Math.round(fy(rect, f)) + .5
    if (f < lo || f > hi || Math.abs(ly - line) < 4) continue
    line = ly
    c.globalAlpha = (m - root) % 12 ? .3 : .6
    c.beginPath(); c.moveTo(xa, ly); c.lineTo(xb, ly); c.stroke()
    if (Math.abs(ly - named) < 12) continue
    named = ly
    c.globalAlpha = .8
    c.fillText(`${NOTES[m % 12]}${Math.floor(m / 12) - 1}`, xb - 4, ly - 6)
  }
  c.restore()
}
// A notes lane, as Melodyne's: its rows a piano's keys, the white keys' the lighter, as the keys by it are (a DAW's
// piano roll: on a dark screen the white rows lifted, on a light one the black rows darkened); each note a blob over its span
// at its pitch, as thick as it is loud there (its level's square root, the lane's loudest frame a row thick, 6 px at
// least), its pitch as it goes drawn through it in the pitch curve's colour; the edited track's in the waveform's
// colour, another's softer, those the selection holds bright; a pitch dragged or let go, where it goes (bent), and an
// edit drawn ahead, where it takes them (moved: none it takes out)
const BLACK = [1, 3, 6, 8, 10]
function paintRoll(rect, end, on, sel) {
  const [, y, , lh] = rect, rh = rowOf(rect), list = noted[rect.i] ?? [], loud = loudest(list), thick = Math.max(6, rh) / 2
  const to = pieces && rect.i === (tracks ? pieces.lane ?? focus : 0) ? moved : t => t
  c.save()
  c.beginPath(); c.rect(0, y, end, lh); c.clip()
  const dark = lightness(rgba(color('--color-screen'))) < .5
  c.fillStyle = color('--color-screen-wave')
  c.globalAlpha = .05
  // each row a pixel short of the next, so two white ones side by side (E–F, B–C) stay two
  for (const m of keyRows(rect)) if (BLACK.includes(m % 12) !== dark) c.fillRect(0, Math.round(keyY(rect, m) - rh / 2), end, Math.max(1, Math.round(rh) - 1))
  c.globalAlpha = 1
  c.lineWidth = 1
  for (const n of list) {
    const a = to(n.time), b = to(n.time + n.duration), mid = n.time + n.duration / 2
    if (a == null || b == null) continue
    const x0 = X(a), x1 = X(b)
    if (x1 < 0 || x0 > end) continue
    const cy = keyY(rect, midiOf(bent(n.freq, mid))), xs = n.level.map((_, k) => Math.max(x0, Math.min(x1, X(to(n.t0 + k * n.hop) ?? a)))), hw = n.level.map(l => Math.max(1, thick * Math.sqrt(l / loud)))
    c.fillStyle = color(on && sel && mid >= sel[0] && mid <= sel[1] ? '--color-screen-bright' : on ? '--color-screen-wave' : '--color-screen-soft')
    c.beginPath()
    c.moveTo(x0, cy)
    xs.forEach((px, k) => c.lineTo(px, cy - hw[k]))
    c.lineTo(x1, cy)
    for (let k = xs.length - 1; k >= 0; k--) c.lineTo(xs[k], cy + hw[k])
    c.closePath()
    if (xs.length) c.fill()
    else c.fillRect(x0, cy - 1, Math.max(1, x1 - x0), 2)
    c.strokeStyle = accent()
    c.beginPath()
    let open = false
    n.f0.forEach((f, k) => { if (!f) { open = false; return } const py = keyY(rect, midiOf(bent(f, n.t0 + k * n.hop))); open ? c.lineTo(xs[k], py) : c.moveTo(xs[k], py); open = true })
    c.stroke()
  }
  c.restore()
}
// the loudest frame of a lane's notes
const peaks = new WeakMap()
function loudest(list) {
  if (!peaks.has(list)) { let top = 1e-9; for (const n of list) for (const l of n.level) top = Math.max(top, l); peaks.set(list, top) }
  return peaks.get(list)
}
// The note of a notes lane under the pointer, within a row's half (3 px at least) of its middle, or null
function noteAt(rect, px, py) {
  const reach = Math.max(6, rowOf(rect)) / 2 + 2
  return (noted[rect.i] ?? []).find(n => px >= X(n.time) - 2 && px <= X(n.time + n.duration) + 2 && Math.abs(keyY(rect, midiOf(bent(n.freq, n.time + n.duration / 2))) - py) <= reach) ?? null
}
// The time row: a label every step a time reads well in (1-2-5, and minutes'), at least 72 px apart, its tick running
// down from the lanes beside it; in samples, 1-2-5 steps of samples (`ruler`: labels and their ticks, ticks alone, or
// none). Over them the times that matter now (`marks`, most telling first), each its tick joined to its line in the
// lanes: the pointer's, the caret's or the playhead's, a selection's start and end; the labels under them give way. Each
// label after its tick, a range's start's before it where the range has no room for it.
const SECONDS = [1e-5, 2e-5, 5e-5, 1e-4, 2e-4, 5e-4, .001, .002, .005, .01, .02, .05, .1, .2, .5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600]
function labelled() {
  const pps = plot().w / (end - start || 1), steps = units === 'samples' ? [0, 1, 2, 3, 4, 5, 6, 7].flatMap(e => [1, 2, 5].map(m => m * 10 ** e / rate)) : SECONDS
  const step = steps.find(s => s * pps >= 72) ?? steps.at(-1)
  // the grid's finer step between: the largest of the steps that parts it evenly in three or more
  const minor = steps.findLast(s => s <= step / 3 * (1 + 1e-9) && Math.abs(step / s - Math.round(step / s)) < 1e-6)
  return { step, minor, digits: Math.max(0, Math.ceil(-Math.log10(step) - 1e-9)), first: Math.max(0, Math.ceil(start / step - 1e-9)) }
}
// `labels`: the time row's own times and ticks too (on the reel), or only these marks' (the playhead's); `clear`,
// [[x0, x1], …] px its own labels give way to
function paintRuler(marks, spans = [], labels = true, clear = []) {
  if (ruler === 'off' || timeRow === 'band' && !rowBand()) return null
  // the tick and chevron of what is out of sight (away) taken first: the labels give way to them
  const { w } = plot(), y = row(), { step, digits, first } = labelled(), taken = away && c === oc ? [[away.x0 - 2, away.x1 + 2]] : []
  c.textAlign = 'left'
  const shown = []
  // held Alt, each length measured, a line along the row in the measuring red, on a pill over the middle of its span, as
  // Figma draws and labels a gap it measures; the pills before all else here, the other labels giving way to them, the
  // ruler's to the line too
  const pills = spans.map(([p, q]) => {
    const text = stamp(q - p), tw = c.measureText(text).width, lx = Math.max(4, Math.min(lanesEnd(lanes()) - tw - 4, (X(p) + X(q) - tw) / 2))
    taken.push([lx - 5, lx + tw + 5])
    return { text, lx }
  })
  // a time past the lanes' end, under the meters, is out of sight as one before the view is: the edge says so (away)
  for (const m of marks) {
    const px = m.head ? x(m.at) : X(m.t), text = stamp(m.t), tw = c.measureText(text).width
    let lx = px + 4
    if (m.of && !m.edge && tw + 8 > x(m.of[1]) - x(m.of[0])) lx = px - 4 - tw
    lx = Math.max(0, Math.min(w - tw - 3, lx))
    if (px < 0 || px >= lanesEnd(lanes())) continue
    // no room for its time: none, or, an end measured from or to (keep), its tick alone
    if (taken.some(([a, b]) => lx + tw + 4 > a && lx - 4 < b)) { if (m.keep) shown.push({ ...m, px, text: null }); continue }
    taken.push([Math.min(px, lx - 4), Math.max(px + 1, lx + tw + 4)])
    shown.push({ ...m, px, lx, text })
  }
  for (const [p, q] of spans) taken.push([X(p), X(q)])
  taken.push(...clear)
  if (labels && ruler !== 'none') for (let i = first; i * step <= end + 1e-9; i++) {
    const t = i * step, px = X(t), text = stamp(t, digits), tw = c.measureText(text).width
    if (px + 4 + tw > w) break
    if (taken.some(([a, b]) => px + tw + 4 > a && px < b)) continue
    c.fillStyle = color('--color-screen-rule')
    c.fillRect(px, tickTop(), 1, TICK)
    if (ruler === 'labels') { c.fillStyle = color('--color-screen-line-number'); c.fillText(text, px + 4, y) }
  }
  c.fillStyle = gauge()
  for (const [p, q] of spans) c.fillRect(X(p), Math.round(y), X(q) - X(p), 1)
  for (const m of shown) {
    if (m.head) continue
    c.fillStyle = m.fill
    c.fillRect(m.px, tickTop(), 1, TICK)
    if (m.text) tag(m.text, m.lx, y, 'left')
  }
  for (const { text, lx } of pills) tag(text, lx, y, 'left', color('--color-screen-bright'), gauge())
  // the playhead's, where the ruler has room for it, for its own layer to show (layHead)
  return shown.find(m => m.head) ?? null
}
// The playhead's layer laid out as the overlay is: its line down the lanes, through the band alone with one selected on
// the spectrogram, and its tick and time on the time row where the ruler has room for them (`m`, none), relative to
// where the line is; each written only as it changes
let laid = ''
function layHead(L, m) {
  const { w, h } = plot(), lh = size() + 4
  // with tracks, the edited one's line bright, the others' as their names are, so the track edited reads at a glance
  const segs = (band ? L.spec.map(r => [Math.max(r[1], fy(r, band[1])), Math.min(r[1] + r[3], fy(r, band[0])), r.i]) : L.all.map(r => [r[1], r[1] + r[3], r.i])).map(([a, b, i]) => [Math.max(0, a), Math.min(h, b), !!tracks && i !== focus]).filter(([a, b]) => b > a)
  const key = `${w} ${h} ${row()} ${label()} ${segs.join(' ')}`
  if (key !== laid) {
    laid = key
    runway.style.width = `${w}px`
    headLines.replaceChildren(...segs.map(([a, b, other]) => Object.assign(document.createElement('i'), { className: other ? 'other' : '', style: `top: ${a}px; height: ${b - a}px` })))
    Object.assign(headTick.style, { top: `${tickTop()}px`, height: `${TICK}px` })
    Object.assign(headTime.style, { top: `${row() - lh / 2}px`, height: `${lh}px`, lineHeight: `${lh}px`, font: label() })
  }
  headTick.hidden = !m
  headTime.hidden = !m?.text
  if (!m) return
  if (headTick.dataset.fill !== m.fill) headTick.style.background = headTick.dataset.fill = m.fill
  if (!m.text) return
  if (headTime.textContent !== m.text) headTime.textContent = m.text
  const left = `${m.lx - m.px - 3}px`
  if (headTime.style.left !== left) headTime.style.left = left
}
// The playhead's layer where the playhead is (`px`, CSS px) at the frame's own time, and on at `v` px a second, the
// speed it plays at, by an animation of its transform, which the compositor runs: however late or busy the page's
// thread, it moves on as smoothly as the display. Set again only when it is off where that has it by a quarter of a
// device pixel (the clock trimmed, a jump, the view zoomed, another speed), or it stops or starts; followed, the view
// scrolls and the playhead stands (v 0), its layer set where it is
let sliding = null
function slide(px, v) {
  const now = document.timeline?.currentTime ?? performance.now()
  if (sliding && !sliding.v === !v && Math.abs(sliding.px + sliding.v * (now - sliding.at) / 1000 - px) < .25 / dpr) return
  const far = v > 0 ? plot().w + 2 - px : v < 0 ? px + 2 : 0, was = sliding?.animation
  head.style.transform = `translateX(${px}px)`
  const animation = far > 0 ? head.animate([{ transform: `translateX(${px}px)` }, { transform: `translateX(${px + Math.sign(v) * far}px)` }], { duration: far / Math.abs(v) * 1000, fill: 'forwards' }) : null
  if (animation) animation.startTime = now
  was?.cancel()
  sliding = { px, v, at: now, animation }
}
function unslide() {
  sliding?.animation?.cancel()
  sliding = null
  runway.hidden = true
}
const CHEVRON = 12
const sought = () => playhead != null ? [playhead, playhead] : selection ?? [cursor, cursor]
function awayOf(L) {
  const [a, b] = sought(), e = lanesEnd(L), side = X(b) < 0 ? -1 : X(a) >= e ? 1 : 0
  if (!side) return null
  // the playhead runs through every lane, the caret and the selection through the edited track's
  const T = playhead != null ? L : own(L), px = side < 0 ? 0 : Math.floor(e) - 1, rects = T.all
  // its chevron at the foot of its line, in the lanes, as the line's own (it was on the time row, apart from it)
  const y = Math.min(plot().h, extent(rects)[1]) - 7
  return { side, rects, px, y, x0: side < 0 ? px : px - CHEVRON + 1, x1: side < 0 ? px + CHEVRON : px + 1, fill: playhead != null ? color('--color-screen-bright') : caretColour() }
}
const onAway = (px, py) => !!away && Math.abs(py - away.y) <= 7 && px >= away.x0 - 2 && px <= away.x1 + 2
function paintAway(lit) {
  const { side, rects, px, fill, y } = away, tip = side < 0 ? px + 4 : px - 3, back = tip - side * 3.5
  c.fillStyle = c.strokeStyle = lit ? color('--color-screen-bright') : fill
  for (const [, ly, , lh] of rects) c.fillRect(px, ly, 1, lh)
  c.lineWidth = 1.25
  c.lineCap = c.lineJoin = 'round'
  c.beginPath(); c.moveTo(back, y - 3.5); c.lineTo(tip, y); c.lineTo(back, y + 3.5); c.stroke()
  c.lineWidth = 1
  c.lineCap = c.lineJoin = 'butt'
  if (lit) say(`To the ${playhead != null ? 'playhead' : selection ? 'selection' : 'caret'}`, side < 0 ? away.x1 + 4 : away.x0 - 4, y, side < 0 ? 'left' : 'right')
}
// The view brought to the playhead (following it again, as when it was not moved by hand), else to the caret or the
// selection, at its middle, the zoom kept; a selection too long for it shown whole
function bring() {
  const span = seenTo() - start, [a, b] = sought()
  assign({ steered: false })
  if (b - a > span * .9) return travel(a - (b - a) * .05, b + (b - a) * .05)
  // playing, toward the playhead as it moves on, following it from there
  const mid = () => playhead ?? (a + b) / 2
  travel(() => mid() - span / 2, () => mid() + span / 2)
}
function fitAll() { assign({ fview: [0, 1] }); assign({ aview: [-1, 1] }); assign({ zoomed: {} }); fitTo(0, duration) }
// All that is selected (every range) shown whole, or, shown so already, or with nothing selected, all of the sound
function frameSelected() {
  const all = ranges().filter(Boolean), a = all[0]?.[0], b = Math.max(...all.map(r => r[1]))
  const span = seenTo() - start
  if (!(b > a) || start <= a && seenTo() >= b && span < (b - a) * 1.2) { assign({ fview: [0, 1] }); assign({ aview: [-1, 1] }); assign({ zoomed: {} }); return travel(0, duration) }
  steer()
  travel(a - (b - a) * .05, b + (b - a) * .05)
}
// The view moved to show [a, b] (each a time, or a function of none for one that moves, as the playhead does) over
// MOVE s, eased out, its span changing by the same factor each frame, so a zoom out from deep in goes as evenly as a
// pan; at once where motion is reduced. A hand on the view (a press, the wheel, a key) stops it where it is
const MOVE = .3, calm = matchMedia('(prefers-reduced-motion: reduce)')
function travel(a, b) {
  const to = () => [typeof a === 'function' ? a() : a, typeof b === 'function' ? b() : b]
  if (calm.matches) { assign({ moving: null }); return fitTo(...to()) }
  assign({ moving: { s: start, e: seenTo(), to, t0: performance.now() } })
  invalidate()
}
function moveOn() {
  const { s, e, to, t0 } = moving, k = Math.min(1, (performance.now() - t0) / 1000 / MOVE), u = 1 - (1 - k) ** 3
  const [a, b] = to(), w = (e - s) * ((b - a) / (e - s)) ** u, mid = (s + e) / 2 + ((a + b) / 2 - (s + e) / 2) * u
  if (k >= 1) assign({ moving: null })
  fitTo(mid - w / 2, mid + w / 2)
}
// The scrollbar's thumb, a pixel under the lanes: THIN px, as a native overlay scrollbar's at rest; under the pointer or
// dragged, THICK and brighter, as the page's scrollbars draw theirs (editor.css)
const THIN = 4, THICK = 6
function paintBar() {
  if (scroll === 'overview') return paintMap()
  const b = bar()
  if (!b) return
  const lit = drag?.scroll || !drag && hovered && onBar(...hovered), t = lit ? THICK : THIN
  c.globalAlpha = lit ? .6 : .3
  c.fillStyle = color('--color-screen-soft')
  c.beginPath()
  c.roundRect(Math.round(b.x0), plot().h + 1, Math.round(b.x1 - b.x0), t, t / 2)
  c.fill()
  c.globalAlpha = 1
}
// On 'hover', the bar shown as an overlay scrollbar is: while the pointer is over the picture or drags the bar, gone as
// a mouse leaves it (leave); a LINGER after the view was scrolled or zoomed by hand with no mouse over it, by keys or a
// touch (setRange, `reached`); coming and going as the layers fade (editor.css). Hidden, a press where it was is the
// time row's
function barLight() {
  const now = performance.now()
  if (hovered || drag?.scroll) assign({ reached: now })
  const left = reached + LINGER - now, on = +(shade !== 'none' && (scroll !== 'hover' || left > 0))
  if (on !== barOn) barStrip.g.canvas.style.opacity = barOn = on
  if (on && scroll === 'hover' && !hovered && !drag?.scroll && !barTimer) barTimer = setTimeout(() => { barTimer = 0; invalidate(true) }, left + 1)
}
// The overview: the sound's peaks over all its channels, with tracks the edited one's, as far as the view goes past its
// end, each device pixel's (mapImage); over them the view's part lit, what is selected, and the caret or the playhead
function paintMap() {
  if (!duration) return
  const w = plot().w, y = H - MAP + 4, h = MAP - 7, total = Math.max(duration, end), k = w / total, b = bar()
  const img = mapImage(w, h)
  // what is selected behind the peaks, as in the lanes
  c.fillStyle = wash()
  for (const [p, q] of ranges().filter(Boolean)) c.fillRect(p * k, y, Math.max(1, (q - p) * k), h)
  if (img) c.drawImage(img, 0, y, duration * k, h)
  c.fillStyle = color('--color-screen-soft')
  if (b) { c.globalAlpha = drag?.scroll || !drag && hovered && onBar(...hovered) ? .3 : .18; c.fillRect(b.x0, y - 2, b.x1 - b.x0, h + 4); c.globalAlpha = 1 }
  c.fillStyle = playhead != null ? color('--color-screen-bright') : caretColour()
  c.fillRect(Math.round((playhead ?? cursor) * k * dpr) / dpr, y - 2, 1, h + 4)
}
function mapImage(w, h) {
  const all = data.length && data[0].length ? data : leavesOf, cols = Math.round(w * dpr), rows = Math.round(h * dpr)
  if (!all || cols < 1 || rows < 1) return null
  const pick = tracks ? Math.min(focus, all.length - 1) : -1, src = pick < 0 ? all : [all[pick]]
  const rgb = hues[pick] ?? rgba(color('--color-screen-wave')), look = [waveLook.fill, waveLook.colour, waveLook.map, ...rgb].join(), tinted = mapColour(cols, rgb)
  if (map?.all === all && map.pick === pick && map.look === look && map.cols === cols && map.rows === rows) return map.canvas
  const n = Math.round(duration * rate), lo = new Float32Array(cols).fill(Infinity), hi = new Float32Array(cols).fill(-Infinity), rms = new Float32Array(cols)
  for (let i = 0; i < cols; i++) {
    const a = Math.floor(i * n / cols), b = Math.min(n, Math.floor((i + 1) * n / cols))
    let sq = 0, m = 0
    for (const x of src) {
      if (all === data) for (let j = a; j < b; j++) { const v = x[j]; if (v < lo[i]) lo[i] = v; if (v > hi[i]) hi[i] = v; sq += v * v; m++ }
      else for (let j = Math.floor(a / 256); j < Math.ceil(b / 256); j++) { if (x[j * 4] < lo[i]) lo[i] = x[j * 4]; if (x[j * 4 + 1] > hi[i]) hi[i] = x[j * 4 + 1]; sq += x[j * 4 + 2]; m += x[j * 4 + 3] }
    }
    rms[i] = m ? Math.sqrt(sq / m) : 0
  }
  let peak = 1e-9
  for (let i = 0; i < cols; i++) if (hi[i] >= lo[i]) peak = Math.max(peak, -lo[i], hi[i])
  // each column's span and its RMS band within it, px down from the strip's top; top over bottom a gap
  const mid = rows / 2, k = mid / peak, top = hi.map(v => mid - v * k), bottom = lo.map(v => mid - v * k)
  const band = [...rms].map((v, i) => [Math.max(top[i], mid - v * k), Math.min(bottom[i], mid + v * k)])
  const canvas = document.createElement('canvas'), g = canvas.getContext('2d'), img = g.createImageData(cols, rows), hw = Math.max(dpr / 2, .5), R = Math.ceil(hw + .5)
  canvas.width = cols; canvas.height = rows
  for (let x = 0; x < cols; x++) {
    if (!(top[x] <= bottom[x])) continue
    let y0 = top[x], y1 = bottom[x]
    for (let i = Math.max(x - R, 0); i <= Math.min(x + R, cols - 1); i++) if (top[i] <= bottom[i]) { y0 = Math.min(y0, top[i]); y1 = Math.max(y1, bottom[i]) }
    for (let y = Math.max(0, Math.floor(y0 - hw - 1)); y < Math.min(rows, Math.ceil(y1 + hw + 1)); y++) {
      const [r, gr, b, a] = mapPixel(x, y + .5, top, bottom, band[x], mid, hw, R, tinted(x)), o = (y * cols + x) * 4
      if (a > 0) img.data.set([r * 255, gr * 255, b * 255, a * 255], o)
    }
  }
  g.putImageData(img, 0, 0)
  assign({ map: { all, pick, look, cols, rows, canvas } })
  return canvas
}
// Each column's colour in the overview, by its index: coloured as the lanes are zoomed all the way out (drawWave), a
// stretch's colours on the same grid of its samples, read from its first channel or the edited track's and kept with
// the lanes' (`tints`), the shares of several (three bands) mixed; else `rgb`, the lane's
function mapColour(cols, rgb) {
  const x = data[Math.max(0, tracks ? Math.min(focus, data.length - 1) : 0)], n = Math.round(duration * rate), id = tracks ? Math.min(focus, data.length - 1) : 0
  if (waveLook.colour === 'none' || !x?.length) return () => rgb
  const spp = n / cols, len = 2 ** Math.max(4, Math.ceil(Math.log2(spp * 4))), { L } = paletted(), by = new Map()
  return i => {
    const k = Math.floor(i * spp / len)
    if (by.has(k)) return by.get(k)
    const key = `${id} ${len} ${k}`
    let m = tints.get(key)
    if (m === undefined) { m = measure(x, k * len, (k + 1) * len, rate); if ((k + 1) * len <= x.length) tints.set(key, m) }
    const cs = m ? coloured(waveLook.colour, m, tone, L).filter(([, s]) => s > .01) : [], sum = cs.reduce((t, [, s]) => t + s, 0)
    const c = sum ? [0, 1, 2].map(j => cs.reduce((t, [c, s]) => t + c[j] * s, 0) / sum).concat(rgb[3] ?? 1) : rgb
    by.set(k, c)
    return c
  }
}
// gl-waveform's envelope at a pixel, its shader's in canvas rows (y down): [r, g, b, a], unpremultiplied. Its coverage,
// by the pixel's distance from the outline, each column's span at its centre joined to its neighbours'; the fill the
// look's (FILLS): a density, g = e^(−(v/α)^β) at v = y / RMS, the body in the colour as often as that, the rest in the
// peaks' (Gaussian's the colour at .3, none for the others), fading from the axis to a third at the column's extreme,
// the line within its half width of the axis; the RMS band in the colour within the peaks', the colour lightened by
// .45; or the colour alone
const DENSE = { density: [2, Math.SQRT2], cloud: [1, Math.SQRT1_2], body: [4, 1.720079974649039] }
function mapPixel(x, py, top, bottom, [b0, b1], mid, hw, R, [r, g, b, a = 1]) {
  const seg = (ax, ay, bx, by) => { const dx = bx - ax, dy = by - ay, t = Math.max(0, Math.min(1, (-ax * dx + (py - ay) * dy) / Math.max(dx * dx + dy * dy, 1e-12))); return Math.hypot(ax + dx * t, ay + dy * t - py) }
  let d = 1e9
  for (let i = Math.max(x - R, 0), was = false; i <= Math.min(x + R, top.length - 1); i++) {
    const cx = i - x, on = top[i] <= bottom[i]
    if (on) d = Math.min(d, Math.hypot(cx, Math.max(top[i] - py, py - bottom[i], 0)))
    if (on && was) d = Math.min(d, seg(cx - 1, top[i - 1], cx, top[i]), seg(cx - 1, bottom[i - 1], cx, bottom[i]))
    was = on
  }
  const c = Math.max(0, Math.min(1, hw + .5 - d)), fill = waveLook.fill
  if (!c) return [r, g, b, 0]
  if (DENSE[fill]) {
    const [beta, alpha] = DENSE[fill], y = Math.abs(py - mid), v = y / Math.max(b1 - mid, mid - b0, 1e-6)
    const e = y <= hw ? 1 : Math.exp(-((v / alpha) ** beta)), s = Math.max(0, Math.min(1, y / Math.max(py < mid ? mid - top[x] : bottom[x] - mid, 1e-6)))
    return [r, g, b, c * (a * e + (fill === 'density' ? a * .3 : 0) * (1 - e) * (1 - 2 / 3 * s))]
  }
  if (fill !== 'rms') return [r, g, b, a * c]
  const u = Math.max(0, Math.min(1, Math.min(b1, py + .5) - Math.max(b0, py - .5))), A = a * u + a * c * (1 - a * u)
  return [r, g, b].map(v => (v * a * u + (v + (1 - v) * .45) * a * c * (1 - a * u)) / A).concat(A)
}
// The lanes ruled (`grid`), between the pictures: over the spectrogram, as the screen shows it; behind the waveform,
// wholly hidden where it is, however faint its fill there. Where the time row's ticks meet the axis' on the right, a
// cross, and a dot where their finer steps meet ('marks'); the crosses alone ('crosses'); a dot at each, the ticks'
// larger ('dots'); or a faint line from each tick across the lanes ('lines'). None on a lane's edge, nor past where its
// sound ends: the grid stops there, as the waveform's centre line does (silence drawn as the level it is, nothing past
// the end), which says where the sound ends, no rule over it. A track ending sooner the same, the time past it still
// its lane's, to select and edit as the mix runs on.
// Drawn in the waveform's canvas once the waveforms are, on the GPU, nothing read back, nothing sent up but its rects:
// what the waveforms drew on the rows of its rects copied off the canvas, and each rect laid as that copy over the grid's colour, cut by it
// (its alpha raised 32-fold, so the faintest fill hides it): w + g (1 − 32 w.a) (1 − w.a), what a layer of the grid,
// cut, under a layer of the waveform composites to. A 2D layer of its own, cut by the waveform drawn into it, read the
// waveform back off the GPU (Safari: 30 ms a window-wide tape, as long again to raise its alpha) or queued a filter's
// window-wide passes (Chrome), each time the tape was drawn: frames the compositor missed as the view followed
let rules = []
const gridKey = L => [grid, duration, start, end, W, H, dpr, display, scale, levelUnits, units, rate, aview, fview, L.all.map(r => r.kind).join(), lanesEnd(L), tracks?.map(t => t.end), scroll].join()
function paintGrid(L) {
  const key = gridKey(L)
  if (key !== ruled) { assign({ ruled: key }); rules = rule(L) }
  if (!gl || gl.isContextLost() || !rules.some(([, r]) => r.length)) return
  const u = underlay(), { width, height } = waveCanvas
  gl.bindFramebuffer(gl.FRAMEBUFFER, null)
  gl.disable(gl.SCISSOR_TEST)
  gl.disable(gl.BLEND)
  gl.viewport(0, 0, width, height)
  gl.activeTexture(gl.TEXTURE1)
  if (u.size !== `${width} ${height}`) {
    u.size = `${width} ${height}`
    gl.deleteTexture(u.wave)
    gl.bindTexture(gl.TEXTURE_2D, u.wave = gl.createTexture())
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, width, height)
  }
  else gl.bindTexture(gl.TEXTURE_2D, u.wave)
  gl.useProgram(u.program)
  gl.bindVertexArray(u.vao)
  gl.bindBuffer(gl.ARRAY_BUFFER, u.rects)
  // each rect two triangles, one draw a colour: a rect an instance cost a software GL (SwiftShader) a draw each. The
  // rows they cover (bands, top to bottom, device px), the only rows of the waveforms copied
  if (u.laid !== rules) {
    u.laid = rules
    const all = rules.flatMap(([, r]) => r), xy = new Float32Array(all.length * 3), rows = []
    for (let i = 0, j = 0; i < all.length; i += 4, j += 12) {
      const x0 = all[i], y0 = all[i + 1], x1 = x0 + all[i + 2], y1 = y0 + all[i + 3]
      xy.set([x0, y0, x1, y0, x0, y1, x0, y1, x1, y0, x1, y1], j)
      rows.push([Math.floor(y0), Math.ceil(y1)])
    }
    gl.bufferData(gl.ARRAY_BUFFER, xy, gl.STATIC_DRAW)
    u.bands = rows.sort((a, b) => a[0] - b[0]).reduce((b, [y0, y1]) => (b.length && y0 <= b.at(-1)[1] ? b.at(-1)[1] = Math.max(b.at(-1)[1], y1) : b.push([y0, y1]), b), [])
  }
  for (const [y0, y1] of u.bands) gl.copyTexSubImage2D(gl.TEXTURE_2D, 0, 0, height - y1, 0, height - y1, width, y1 - y0)
  gl.uniform1i(u.at.wave, 1)
  gl.uniform2f(u.at.size, width, height)
  let at = 0
  for (const [fill, r, k] of rules) {
    const [cr, cg, cb, a] = rgba(fill), ca = Math.min(1, a * k)
    gl.uniform4f(u.at.fill, cr * ca, cg * ca, cb * ca, ca)
    if (r.length) gl.drawArrays(gl.TRIANGLES, at, r.length / 4 * 6)
    at += r.length / 4 * 6
  }
  gl.bindVertexArray(null)
  gl.bindBuffer(gl.ARRAY_BUFFER, null)
  gl.activeTexture(gl.TEXTURE0)
}
function underlay() {
  if (under) return under
  const program = gl.createProgram()
  for (const [type, src] of [
    [gl.VERTEX_SHADER, 'in vec2 p; uniform vec2 size; void main() { gl_Position = vec4(p.x / size.x * 2. - 1., 1. - p.y / size.y * 2., 0, 1); }'],
    [gl.FRAGMENT_SHADER, 'precision mediump float; uniform sampler2D wave; uniform vec4 fill; out vec4 o; void main() { vec4 w = texelFetch(wave, ivec2(gl_FragCoord.xy), 0); o = w + fill * (1. - min(1., 32. * w.a)) * (1. - w.a); }']
  ]) {
    const shader = gl.createShader(type)
    gl.shaderSource(shader, '#version 300 es\n' + src)
    gl.compileShader(shader)
    gl.attachShader(program, shader)
  }
  gl.bindAttribLocation(program, 0, 'p')
  gl.linkProgram(program)
  const vao = gl.createVertexArray(), rects = gl.createBuffer()
  gl.bindVertexArray(vao)
  gl.bindBuffer(gl.ARRAY_BUFFER, rects)
  gl.enableVertexAttribArray(0)
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)
  gl.bindVertexArray(null)
  const at = name => gl.getUniformLocation(program, name)
  return assign({ under: { program, vao, rects, wave: null, size: '', laid: null, bands: [], at: { wave: at('wave'), size: at('size'), fill: at('fill') } } })
}
// The grid ruled, made again only when what places it changes: [colour, rects, alpha], the rects [x, y, w, h, …] in
// device px, each within its lane and before where its sound ends: a line down from each of the time row's ticks, one
// across from each of the axis'; drawn over the same pixel twice, a rect lays it the same (paintGrid), so where two
// lines cross is no brighter
function rule(L) {
  const all = L.all, stop = lanesEnd(L), lines = []
  if (grid === 'none' || !duration) return []
  const { step } = labelled(), cols = []
  for (let i = Math.ceil(start / step - 1e-9); i * step <= end + 1e-9; i++) { const px = X(i * step); if (px >= 1 && px < stop) cols.push(px) }
  all.forEach((rect, i) => {
    const [, y, , lh] = rect, right = Math.min(stop, X(tracks?.[i]?.end ?? duration))
    const put = (px, py, w, h) => {
      const x0 = Math.max(0, px), x1 = Math.min(right, px + w), y0 = Math.max(y, py), y1 = Math.min(y + lh, py + h)
      if (x1 > x0 && y1 > y0) lines.push(x0 * dpr, y0 * dpr, (x1 - x0) * dpr, (y1 - y0) * dpr)
    }
    for (const px of cols) put(px, y, 1, lh)
    for (const ty of room(rect, axisMarks(rect)).map(([ly]) => Math.round(ly))) if (ty > y && ty < y + lh - 1) put(0, ty, stop, 1)
  })
  // the theme's whitespace marks, at half their strength as they run the lanes' length
  return [[color('--color-screen-grid'), lines, .5]]
}
// The selection, in each lane (a box on the spectrogram), and the other ranges: a wash over each, the one highlight in
// both pictures, the edge under the pointer (`hot`) or dragged lit, as it would move. The selection's colour, the
// inactive one while the picture is not focused, as an editor's selection goes when its focus is elsewhere; on a
// spectrogram its own, its speckle hiding a lift the waveform's even ground shows
const focused = () => document.hasFocus() && root.contains(document.activeElement)
const wash = (spec = false) => color(focused() ? spec ? '--color-screen-select-spectrum' : '--color-screen-select' : spec ? '--color-screen-select-spectrum-inactive' : '--color-screen-select-inactive')
// The caret the same way: the skin's while the picture has focus; else faint, IDLE of its alpha, as an editor's caret
// goes out with its focus, kept in sight here as where play starts. An embed shows it faint till it is pressed
const IDLE = .35
const caretColour = () => { const css = color('--color-screen-caret'); if (focused()) return css; const [r, g, b, a] = rgba(css); return `rgb(${r * 255} ${g * 255} ${b * 255} / ${a * IDLE})` }
function paintSelection(L, sel) {
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
function highlight(rects, a, b, fill, alpha = 1) {
  sel2d.globalAlpha = alpha
  for (const rect of rects) { const [, y, , lh] = rect; sel2d.fillStyle = typeof fill === 'function' ? fill(rect) : fill; sel2d.fillRect(Math.round(a), Math.round(y), Math.round(b - a), Math.round(lh)) }
  sel2d.globalAlpha = 1
}
// The edge dragged, or the one a press would take, any range's, lit as the line it would move: its first pixel or its
// last, over the handles
function paintEdge(L, sel) {
  const lit = drag?.resizing && sel && !band ? { edge: sel[0] === drag.anchor ? 1 : 0, t: sel[sel[0] === drag.anchor ? 1 : 0] } : !drag && hot
  if (!lit) return
  // an end's last pixel, but where the caret is on it (the end a drag left it at): the caret's line, lit, one line
  const px = X(lit.t) - (playhead == null && lit.t === cursor ? 0 : lit.edge)
  c.fillStyle = color('--color-screen-bright')
  if (px >= 0 && px < lanesEnd(L)) for (const [, y, , lh] of L.all) c.fillRect(px, y, 1, lh)
}
// a time as the whole page writes it, in the units chosen (time.js): 0:05, 5.0s, 240000
const stamp = (t, d = digits()) => clock(t, units, { digits: d, rate })
// Cues: shown only where they matter, never as a forest over the sound: the one dragged, bright where it will land;
// those a dragged edge or caret sits on (`lit`), and faint the ones either side of it (beside), as they are either side
// of the pointer plain over the edited track's lanes, the one a press would snap to brighter; held ⌘ (Ctrl), the one
// under the pointer a press would take; held Alt (`all`), every one, faint, as Figma shows what there is to snap to.
// The one a press would snap to, a sound's start, a hit or its end, with a short wash on the side its sound is on
// (washFrom)
const on = (lit, px) => lit.some(t => Math.abs(x(t) - px) < .5)
// The time a drag moves, as the caret or a range's end: the caret held, an edge, a range dragged out (Shift held before
// the press or after it), a marker's triangle moved (a range's end, the one held), else null
const dragged = () => drag?.caret ? cursor : drag?.resizing || drag?.anchor != null && drag.moved && !drag.box ? drag.hear
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
const editing = (keys = held) => !!(mac ? keys.metaKey : keys.ctrlKey)
function paintCues(rects, lit, all = false) {
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
function paintMarkers(all, lit, pointedAt) {
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
const same = (m, n) => m.track === n.track && !m.duration === !n.duration && Math.abs(m.time - n.time) < 5e-4
// The edited track's marker line in its lanes within EDGE px of the pointer, a moment's or a range's end: its time,
// where a press puts the caret; or null. Snapping as a drag does (stick): not with it off, nor while ⌘ aims finely
function markAt(px, py) {
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
const TRI = 5, MARKED = 9, NAMES = 6, NAMEH = 14
// where each marker's name is drawn, [{ i, from, to, y }] px: a click there names it anew (clicked)
let labels = []
const labelAt = (px, py) => labels.find(n => py >= n.y && py < n.y + FOOT && px >= n.from && px <= n.to)?.i ?? -1
// where a marker's name starts, its start at `x0`: past a moment's triangle, inside a range's, held in sight
const nameLeft = (moment, x0) => moment ? x0 + TRI + 3 : Math.max(x0, 0) + 4
// each band's strip: { y, i }, its top (its lanes' foot) and its track's index (null: a sound's)
const strips = L => tracks ? L.all.map(([, y, , lh], i) => ({ y: y + lh, i })) : L.all.length ? [{ y: floor(L), i: null }] : []
// what the strips hold: [{ kind: 'mark' (a marker's, `i` its index; a moment's x1 its x0, `moment`; one pulled apart
// into a range, a range) or 'takes' (`i`, the section's), x0, x1, y, rects }]
function stripped(L) {
  const of = new Map(strips(L).map(s => [s.i, s])), lanesOf = i => i == null ? L.all : [L.all[i]].filter(Boolean), out = []
  for (const [i, m] of markers.entries()) {
    const held = drag?.marker === i, at = held ? drag.to : placed(m), end = held ? drag.end : at + (m.duration ?? 0), s = of.get(markLane(m))
    if (s && at != null) out.push({ kind: 'mark', i, x0: X(at), x1: X(end), moment: !(end > at), y: s.y, rects: lanesOf(markLane(m)) })
  }
  sections.forEach((t, i) => { const s = of.get(t.lane ?? null); if (s) out.push({ kind: 'takes', i, x0: X(t.at), x1: X(Math.min(t.end, duration)), y: s.y, rects: lanesOf(t.lane ?? null) }) })
  return out
}
// which of a marker's triangles `px` is on: a moment's or a range's start's, 0; a range's end's, 1; else -1
function notch(m, px) {
  if (m.kind !== 'mark') return -1
  if (m.moment) return Math.abs(px - m.x0) <= TRI + 1 ? 0 : -1
  const start = px >= m.x0 - TRI && px <= m.x0 + 2, end = px >= m.x1 - 1 && px <= m.x1 + TRI + 1
  return start && (!end || px <= (m.x0 + m.x1) / 2) ? 0 : end ? 1 : -1
}
// what a press in a strip takes: a marker's triangle, a name, a range or the takes' place under it; or null
function stripAt(px, py, L = lanes()) {
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
function paintStrips(L, pointedAt, selected) {
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
let naming = null
// the top of a field `h` px tall whose text sits where a name drawn with its middle at `my` does: the canvas sets the
// em box's middle at `my`, the field its font's box in the middle of its line (a pixel lower, as a monospace font's
// ascent and descent fall)
function fieldTop(my, h) {
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
function rename(i) {
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
function paintOvers(L) {
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
// Where each lane's samples first cross full scale in each stretch that clips, { t, i: its lane, sign: +1 or −1 },
// read off the samples the page holds (none of a long sound's), once for those clips and samples
let crossings = null
function clipMarks() {
  if (crossings?.clips === clips && crossings.data === data) return crossings.marks
  const marks = []
  for (const [a, b] of clips) for (const [i, x] of data.entries()) {
    if (!x) continue
    let up = -1, down = -1
    for (let k = Math.max(0, Math.floor(a * rate)), end = Math.min(x.length, Math.ceil(b * rate)); k < end && (up < 0 || down < 0); k++) {
      if (up < 0 && x[k] >= 1) up = k
      if (down < 0 && x[k] <= -1) down = k
    }
    if (up >= 0) marks.push({ t: up / rate, i, sign: 1 })
    if (down >= 0) marks.push({ t: down / rate, i, sign: -1 })
  }
  crossings = { clips, data, marks }
  return marks
}
// The line edited: points joined by lines; the gain's mirrored below each lane's axis, the pitch's one line, its 0
// faint while it has no points (a press on it makes the first)
function paintLine(rects) {
  const pts = linePoints(), pitch = pitchLine()
  c.strokeStyle = c.fillStyle = accent()
  for (const rect of rects) for (const sign of pitch ? [1] : [1, -1]) {
    c.globalAlpha = sign > 0 ? pitch && !pts.length ? .35 : 1 : .4
    c.beginPath()
    if (!pts.length) { const y0 = pitch ? ly(rect, 0) : ay(rect, 1, sign); c.moveTo(0, y0); c.lineTo(rect[2], y0) }
    else {
      c.moveTo(0, ly(rect, pts[0][1], sign))
      for (const [t, v] of pts) c.lineTo(x(t), ly(rect, v, sign))
      c.lineTo(rect[2], ly(rect, pts.at(-1)[1], sign))
    }
    c.stroke()
    if (sign > 0) for (const [t, v] of pts) c.fillRect(X(t) - 3, Math.round(ly(rect, v)) - 3, 6, 6)
  }
  c.globalAlpha = 1
}
const linePoints = () => { const curve = pitchLine() ? shift : envelope; return drag?.points ?? (curve ? curve.t.map((t, i) => [t, curve.v[i]]) : []) }
const curveOf = pts => ({ t: pts.map(p => p[0]), v: pts.map(p => p[1]) })
// A line's value at t: straight between its points, flat past its ends (plan.js curveFn); 0 with none
function valueAt(pts, t) {
  if (!pts.length) return 0
  if (t <= pts[0][0]) return pts[0][1]
  for (let i = 1; i < pts.length; i++) if (t <= pts[i][0]) { const [t0, v0] = pts[i - 1], [t1, v1] = pts[i]; return v0 + (v1 - v0) * (t - t0) / (t1 - t0 || 1) }
  return pts.at(-1)[1]
}
function lineAt(t) { return valueAt(linePoints(), t) }
// a line that shows: the pitch's always, the gain's once there is a curve, or while its points are being made
const onLine = (rect, px, py) => (pitchLine() || envelope || drag?.points) && Math.abs(ly(rect, lineAt(time(px))) - fold(rect, py)) <= EDGE
// The pitch curve as it shows: the output's, moved as the pitch line has moved since it was measured (its edit on its
// way, a drag of it), and as the selection's pill dragged moves it. Frame i's pitch, Hz, 0 where it has none
function toneOf(i) {
  const { times, f0, basis } = contour, t = times[i]
  return f0[i] && bent(f0[i] * 2 ** ((lineAt(t) - valueAt(basis, t)) / 12), t)
}
// a pitch at t as a tool dragged over the selection makes it: higher or lower, or its rises and falls wider or
// flatter about the range's median (named apart from moved(t), the times an edit drawn ahead moves, which one function
// of both names had hidden: the cues and the markers stayed where they were till the output came)
function bent(f, t) {
  const d = drag?.lift ? drag : landed
  if (!d || t < d.a || t > d.b) return f
  return d.lift === 'pitch' ? f * d.ratio : d.lift === 'intonation' && d.mid ? d.mid * (f / d.mid) ** d.k : f
}
// The pitch curve at any t, where a point of the line sits on it: between two voiced frames straight in pitch, a gap
// crossed from one side to the other, past them the nearest, as the voice had it before the line; then as the line
// has it at t itself. 0 with no voice at all
function toneAt(t) {
  const { times, f0, basis } = contour, n = times.length, own = i => f0[i] * 2 ** (-valueAt(basis, times[i]) / 12)
  let lo = 0, hi = n - 1
  while (lo < hi) { const m = (lo + hi + 1) >> 1; if (times[m] <= t) lo = m; else hi = m - 1 }
  let a = lo, b = lo + 1
  while (a >= 0 && !f0[a]) a--
  while (b < n && !f0[b]) b++
  const fa = a >= 0 ? own(a) : 0, fb = b < n ? own(b) : 0
  if (!fa && !fb) return 0
  const f = !fa ? fb : !fb ? fa : fa * (fb / fa) ** Math.max(0, Math.min(1, (t - times[a]) / (times[b] - times[a])))
  return bent(f * 2 ** (lineAt(t) / 12), t)
}
// A pitch curve in a lane, a line per voiced stretch: frame i at times[i], its pitch hz(i) (0 where it has none)
function trace(rect, times, hz) {
  c.beginPath()
  let open = false
  for (let i = 0; i < times.length; i++) {
    const f = hz(i)
    if (!f || times[i] < start - .1 || times[i] > end + .1) { open = false; continue }
    const px = x(times[i]), py = fy(rect, f)
    open ? c.lineTo(px, py) : c.moveTo(px, py)
    open = true
  }
  c.stroke()
}
// The pitch curve, a line per voiced stretch, as it shows, and on it the pitch line's points
function paintContour(rects) {
  if (!contour?.f0.length) return
  const pts = linePoints()
  c.strokeStyle = c.fillStyle = accent()
  c.lineWidth = 1.5
  for (const rect of rects) {
    c.save()
    c.beginPath(); c.rect(...rect); c.clip()
    trace(rect, contour.times, toneOf)
    for (const [t] of pts) { const f = toneAt(t); if (f) c.fillRect(X(t) - 3, Math.round(fy(rect, f)) - 3, 6, 6) }
    for (const t of knots()) { const f = toneAt(t); if (f) c.strokeRect(X(t) - 2.5, Math.round(fy(rect, f)) - 2.5, 5, 5) }
    c.restore()
  }
  c.lineWidth = 1
}
// the time among `ts` within reach of the pointer where it sits on the pitch curve, the nearest; -1 for none
function nearestOn(rect, px, py, ts) {
  let best = -1, d = Infinity
  ts.forEach((t, i) => {
    const f = toneAt(t), dx = x(t) - px, dy = f ? fy(rect, f) - py : Infinity
    if (Math.abs(dx) <= EDGE && Math.abs(dy) <= EDGE + 2 && Math.hypot(dx, dy) < d) { d = Math.hypot(dx, dy); best = i }
  })
  return best
}
// the pitch line's point there
const pointOn = (rect, px, py) => nearestOn(rect, px, py, linePoints().map(p => p[0]))
// The curve's bends (stylize) as handles, hollow, the line's own points standing for those they cover: one
// dragged bends the voice from the handle before it to the one after, the curve elsewhere as it was
const knots = () => { const pts = linePoints(); return (contour?.knots || []).filter(t => !pts.some(([p]) => Math.abs(x(p) - x(t)) < EDGE)) }
const knotOn = (rect, px, py) => { const ks = knots(), i = nearestOn(rect, px, py, ks); return i < 0 ? null : ks[i] }
// From `zoom.in` samples across (32) to `zoom.out` times the whole across the lanes (4/3: it, and a quarter of the view
// room after it): the sound starts at the left, the room is on its right. A view an edit left past the sound's end (it got shorter) stays
// there until it is moved back. Scrolled or zoomed by hand (`past`), the sound's end goes on as far as `overshoot` of
// the view from its right (0.5, its middle): the tail comes out from under the meters and the labels to be edited, the
// room past it plain, the grid and the centre line ending with it. Zoom out 1 and overshoot 0: never any room past it
function setRange(a, b, past = false) {
  const min = Math.min(duration, closest / rate), k = reach()
  let span = Math.max(min, Math.min(Math.max(duration * farthest / k, recording ? RECORD : 0), b - a))
  const last = duration - span * (past ? Math.min(k, 1 - overshoot) : k)
  a = span * k <= duration || past ? Math.max(0, Math.min(Math.max(last, start), a)) : 0
  assign({ start: a }); assign({ end: a + span })
  if (past) assign({ reached: performance.now() })
  // the pictures drawn again only where the tape has not the view (render)
  invalidate(true)
}
// The frequencies shown, [u0, u1] on the scale: at least a 64th of it, within it
function setFreqs(u0, u1) {
  const span = Math.min(1, Math.max(1 / 64, u1 - u0)), a = Math.max(0, Math.min(1 - span, u0))
  assign({ fview: [a, a + span] })
  invalidate()
}
function frameVoice() {
  const f = contour?.f0.filter(f => f).sort((a, b) => a - b)
  if (!pitching || framed || !f?.length) return
  const [lo, hi] = [scales[scale].low, rate / 2], q = p => f[Math.floor(p * (f.length - 1))], at = hz => scales[scale].at(Math.max(lo, Math.min(hi, hz)), lo, hi)
  assign({ framed: true })
  unframed ?? assign({ unframed: fview })
  setFreqs(at(q(.05) / 2), at(q(.95) * 2))
}
// Time zoomed by `factor`, or to `span` s across, about the time `at`, which keeps its place on screen; the view on
// its way somewhere (travel) stopping where it is. While it plays followed, about the playhead, which goes on being
// followed: a zoom scales the view, it never takes it off the playhead, as a hand's scroll does (steer)
const zoom = (factor, at = (start + end) / 2) => zoomSpan((end - start) * factor, at)
function zoomSpan(span, at) {
  if (playhead != null && !steered) at = playhead + nudge
  assign({ moving: null })
  const k = (at - start) / (end - start || 1)
  setRange(at - k * span, at - k * span + span, true)
}
// the view shows all of the sound
const whole = () => start <= 0 && seenTo() >= duration - 1e-9
// zoom the frequencies around u, which stays where it is on screen
const zoomFreqs = (factor, u) => { const [u0, u1] = fview, k = (u - u0) / (u1 - u0), span = (u1 - u0) * factor; setFreqs(u - k * span, u - k * span + span) }
// Zoom a notes lane's keys around the key `m` (MIDI, fractional), which stays where it is on screen: from 4 rows to
// the piano's 88
function zoomKeys(rect, factor, m) {
  const [lo, hi] = rect.keys, span = hi - lo + 1, to = Math.max(4, Math.min(88, span * factor))
  setKeys(rect, m - (m - lo + .5) / span * to, to)
}
// A notes lane's keys, its band's: `span` rows up from the edge `e0`, within MIDI's
function setKeys(rect, e0, span = rect.keys[1] - rect.keys[0] + 1) {
  const a = Math.max(-.5, Math.min(127.5 - span, e0))
  assign({ zoomed: { ...zoomed, [bandOf(rect.i)]: [a + .5, a + span - .5] } })
  invalidate()
}
// Pointer: a press takes what is under it (down); two fingers pan and zoom, the wheel pans, a pinch or Ctrl+wheel zooms.
// The frequencies at the right of a spectrogram lane, and the spectrum drawn just before them: that lane, else null
const onFreqs = (px, py, L = lanes()) => px > (meters && show.spectrum ? meterAt(metered(L)) : plot().w) ? L.spec.find(r => py >= r[1] && py <= r[1] + r[3]) ?? null : null
// The keys at the right of a notes lane, and the piano by them: that lane, else null
const onKeys = (px, py, L = lanes()) => px > (show.keys ? meterAt(metered(L)) : plot().w) ? L.notes.find(r => py >= r[1] && py <= r[1] + r[3]) ?? null : null
// The levels at the right of a waveform lane, and its meter: that lane, else null
const onLevels = (px, py, L = lanes()) => px > plot().w - (meters && show.meters ? 10 : 0) ? L.wave.find(r => py >= r[1] && py <= r[1] + r[3]) ?? null : null
function zoomLevels(factor, u, lh) {
  const [lo, hi] = aview, was = hi - lo, to = Math.max(2e-3, Math.min(8, (was === 2 ? 2 * pull : was) * factor))
  const held = Math.abs(lh / to - lh / 2) <= STICK || was !== 2 && (was - 2) * (to - 2) < 0, span = held ? 2 : to
  assign({ pull: held && was === 2 ? to / 2 : 1 })
  const a = span >= 2 ? -span / 2 : u - (u - lo) / was * span
  scrollLevels(a, span)
}
// Scroll the levels: `span` of them from `a`, kept within full scale
function scrollLevels(a, span = aview[1] - aview[0]) {
  if (span < 2) a = Math.max(-1, Math.min(1 - span, a))
  assign({ aview: [a, a + span] })
  invalidate()
}
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
function setScale(name) {
  scale = root.dataset.scale = name
  assign({ fview: [0, 1] }); assign({ leveled: false })
  invalidate()
}
// [a, b] s brought into sight, as an editor scrolls to what it selects: moved to show it, zoomed out to fit it
function reveal(a, b = a) {
  const span = seenTo() - start
  if (b - a > span * .9) fitTo(a - (b - a) * .05, b + (b - a) * .05)
  else if (a < start || b > start + span) setRange(a - span * .1, a - span * .1 + end - start)
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
// A waveform and a spectrogram per channel; the spectrogram's silence is the page, seen through, its loudest its ink
// (the skin's spectrum: white, or a theme's). How bright the pair is drawn is the layers' own (light): dim while it is
// the file arriving, full once the output is there
// Each waveform its colour (`hues`): the screen's; in one lane, its channel's (the skin's, a theme's syntax hues), else
// a hue each evenly round at the waveform's lightness (tint.js);
// as gl-waveform takes it, [r, g, b, a], read once, so a stretch's colour and back costs no parsing
let hues = [], swatch = null
const rgba = css => {
  swatch ??= Object.assign(document.createElement('canvas'), { width: 1, height: 1 }).getContext('2d', { willReadFrequently: true })
  swatch.clearRect(0, 0, 1, 1)
  swatch.fillStyle = css
  swatch.fillRect(0, 0, 1, 1)
  return [...swatch.getImageData(0, 0, 1, 1).data].map(v => v / 255)
}
// channel i of n's hue in one lane: the skin's, while it has one for each, at the alpha where two cross both show
const channel = (i, n) => {
  const own = Array.from({ length: n }, (_, k) => color(`--color-screen-channel-${k + 1}`))
  return own.every(Boolean) ? [...rgba(own[i]).slice(0, 3), .75] : hue(i, n, lightness(rgba(color('--color-screen-wave'))))
}
const shades = () => (shaded ?? assign({ shaded: look.color ?? inked(rgba(color('--color-screen-bright')), 17, look.gamma ?? 1) }))
const FILLS = { density: { rms: false, density: 'gaussian' }, cloud: { rms: false, density: 'laplace' }, body: { rms: false, density: 'flat' }, rms: { rms: null, density: false }, flat: { rms: false, density: false } }
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
export { ownMarks, snappedTo, SIDES, unwritten, frozen, decibels, drawn, ghost, layout, chips, takeHot, placeTakes, placeFork, W, H, dpr, drag, gutter, plot, merged, spare, lanes, extent, own, laneAt, rowBand, MAP, onBar, X, time, free, snapF, seen, stick, stuck, pitchLine, inside, fy, yf, rowOf, keyY, keyRows, ay, ampLanes, pitchLanes, veils, placeFrozen, roomLane, half, invalidate, tape, rolled, onTape, running, touch, pitchRange, semis, pitchSays, intonationSays, median, pitched, clampY, ticks, hzMarks, noteMarks, levelMarks, reads, decibel, level, measured, probe, paintMeasure, waveAt, placeFades, placeLook, paintRoom, paintLift, tag, accent, gauge, size, label, paintGuide, BLACK, paintRoll, paintRuler, layHead, awayOf, onAway, paintAway, THICK, paintBar, barLight, wash, caretColour, paintSelection, highlight, paintEdge, stamp, dragged, editing, paintCues, paintMarkers, TRI, strips, stripped, stripAt, paintStrips, naming, paintOvers, paintLine, bent, toneAt, paintContour, setRange, hot, rgba, shades }
