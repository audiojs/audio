import { markLane } from './data.js'
import { RULER, GAP, EDGE, HEAD, FOOT, TRACK, LOW, ROOM, midiOf, TICK, VOICE, root, oncursor, onfocus, ontake, onghost, onlayout, onband, onbusy, keepRoom, timeRow, element, keep, FORK, forkButton, count, rate, duration, display, hovered, markers, recording, empty, pieces, guest, start, end, selection, band, cursor, ruler, waveLook, tracks, focus, allLanes, sections, scroll, heights, lift, kinds, noted, zoomed, assign } from './model.js'
import { lanesEnd } from './overlay.js'
import { drag } from './pointer.js'
import { W, H, invalidate } from './render.js'
import { gutter, x, X, time, clamp } from './scales.js'
import { told } from './select.js'
import { NAMES, NAMEH, feet, heads, stripAt, fieldTop, forks } from './strips.js'

// Geometry: the bands and their lanes, the rooms under the tracks, each track's height, the takes' places and the
// frozen pieces, laid out

// With tracks, they are the edited track's lane's, or the lane they name (`lane`): a piece dropped into another track
// leaves its own lane for that one before the output comes. `guest`: a piece carried into another track's lane,
// drawn there over what it covers, as it is dragged and once dropped till the output comes: { lane, at, a, b, of },
// [a, b] of lane `of` going in at `at`. `frozen`: what an edit is still making, [{ lane, a, b }] (lane null: every
// one), hatched, no press taking it, nothing playing (onbusy), till its output comes, as Suno Studio's parts calculating
export let frozen = []
export const untrack = () => { assign({ tracks: null }); assign({ allLanes: false }); delete root.dataset.tracks }
// a locked track's lane at a height
export const lockedAt = py => !!tracks?.[laneAt(lanes(), py)]?.locked
// The caret in the room (`ghost`), a new track's to be: a take, a paste or a piece carried makes a track of it there
// (editor.js, told by onghost); a press anywhere else takes it back
export let ghost = false
export function haunt(t) {
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
export function unghost() { if (!ghost) return; ghost = false; onghost(false); invalidate(true) }
// The bands as they are laid out, told as they change (onlayout), for the layers to line up with: each band's top (its
// head line's), its lanes' top and height (a track's, or a sound's lanes' all told), its foot's bottom, and the room's,
// CSS px from the picture's top
let bandsLaid = ''
export function layout(L) {
  const r = roomLane(L), [top, foot] = extent(L.all), hd = headOf(), rows = !duration && !empty ? [] : tracks ? L.all.map(([, y, , lh]) => ({ top: y - hd, y, h: lh, bottom: y + lh + FOOT })) : [{ top: top - hd, y: top, h: foot - top, bottom: foot + FOOT }]
  const key = JSON.stringify([rows, r?.[1], r?.[3], plot().h])
  if (key !== bandsLaid) { bandsLaid = key; onlayout({ rows, room: r && { y: r[1], h: r[3] }, h: plot().h }) }
}
// the band pointed at, from its head to its foot, told as it changes (onband), for its look to show: its index (a
// sound's, 0), or -1
export let pointedBand = -2
export function hotBand(L) {
  const [top, bottom] = L.all.length ? extent(L.all) : [0, -1], py = hovered?.[1]
  const i = py == null ? -1 : tracks ? trackAt(L, py) : py >= top - headOf() && py < bottom + FOOT ? 0 : -1
  if (i !== pointedBand) { pointedBand = i; onband(i) }
}
const FOLD = 3
// the section whose numbers are pointed at, or -1
export const chips = []
let chipped = -1
function takeChip(i) {
  const el = element('div', 'takes', root)
  el.setAttribute('role', 'group')
  for (const type of ['pointerdown', 'pointerup', 'contextmenu', 'dblclick']) el.addEventListener(type, e => e.stopPropagation())
  el.addEventListener('pointerdown', keep)
  el.addEventListener('pointerenter', () => { chipped = i; invalidate(true) })
  el.addEventListener('pointerleave', () => { if (chipped === i) chipped = -1; invalidate(true) })
  el.addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; e.stopPropagation(); ontake(i, b.value === 'add' || b.value === 'more' ? b.value : +b.value, b) })
  return el
}
// the section pointed at, on its place in the strip or its numbers, where nothing is dragged: its index, or -1
export function takeHot(L) {
  if (drag) return -1
  if (chipped >= 0 && sections[chipped]) return chipped
  const m = hovered && stripAt(...hovered, L)
  return m?.kind === 'takes' ? m.i : -1
}
// the middle of a name's text on a band's head row
const onHead = row => row.edge + row.dir * NAMES
export function placeTakes(L) {
  const end = lanesEnd(L), { h } = plot(), over = new Map(heads(L).map(s => [s.i, s]))
  while (chips.length < sections.length) chips.push(takeChip(chips.length))
  chips.forEach((el, i) => {
    const t = sections[i], row = t && over.get(tracks ? t.lane ?? null : null)
    const x0 = t && X(t.at), x1 = t && Math.min(end, X(Math.min(t.end, duration)))
    const seen = !!row && x1 >= 0 && x0 <= end && row.y >= 0 && row.y + row.h <= h
    el.hidden = !seen
    if (el.hidden) return
    const key = `${t.on} ${t.open} ${t.names.join()}`
    if (el.dataset.key !== key) {
      el.dataset.key = key
      el.ariaLabel = 'Takes'
      // FOLD of them about the one heard (from the first, none heard), … either side for those past them
      const n = t.names.length, a = n > FOLD + 1 ? Math.max(0, Math.min(n - FOLD, t.on - 1)) : 0, b = n > FOLD + 1 ? a + FOLD : n
      const take = k => `<button type="button" value="${k}" aria-pressed="${k === t.on}" title="Take ${k + 1}, ${k ? t.names[k] || 'empty: R records into it' : 'the sound as it was'}${k === t.on ? ', heard' : ''}">${k + 1}</button>`
      const more = `<button type="button" value="more" class="takes-more" aria-haspopup="menu" aria-expanded="false" aria-label="All ${n} takes" title="All ${n} takes">…</button>`
      el.innerHTML = (a > 0 ? more : '') + Array.from({ length: b - a }, (_, k) => take(a + k)).join('') + (b < n ? more : '')
        + `<button type="button" value="add" class="takes-add" ${t.open ? 'aria-disabled="true" title="An empty take is there: R records into it"' : 'title="Another take"'} aria-label="Another take">${FORK}</button>`
    }
    // in its band's head, on the names' row, at its end inside it (held in at the picture's right while the place runs
    // past it), its start free for a range's name over it; each number's padding (2 px) after it. Its top as a name's
    // field's, not rounded, so its text lands on a name's rows
    const left = `${Math.round(Math.min(x1, end) - 2 - el.offsetWidth)}px`, at = `${fieldTop(onHead(row), NAMEH)}px`
    if (el.style.left !== left || el.style.top !== at) Object.assign(el.style, { left, right: 'auto', top: at })
  })
}
// The selection's fork, at its end inside it on its band's head, as the takes' numbers are where takes are: pressed,
// takes start there (onfork); or, with none, a range's pointed at in a head. None where takes start already
// what the fork forks, { time, duration, track, i (its lane, null a sound's), row (its head) }, or null
export function forkOf(L) {
  const m = !drag && hovered ? stripAt(...hovered, L) : null, i = tracks ? focus : null
  const sel = !drag && selection && !band && selection[1] > selection[0] && !sections.some(t => (t.lane ?? null) === i && Math.abs(X(t.at) - X(selection[0])) < 1)
  const at = sel ? { time: selection[0], duration: selection[1] - selection[0], track: tracks?.[focus]?.name ?? null, i } : m && forks(m) ? { ...markers[m.i], i: markLane(markers[m.i]) } : null
  const row = at && heads(L).find(s => s.i === (tracks ? at.i : null))
  return row && X(at.time) <= lanesEnd(L) && X(at.time + at.duration) >= 0 && row.y >= 0 && row.y + row.h <= plot().h ? { ...at, row } : null
}
export function placeFork(L) {
  const at = forkOf(L), seen = !!at, row = at?.row, x1 = at && Math.min(X(at.time + at.duration), lanesEnd(L))
  forkButton.hidden = !seen
  forkButton.at = seen ? at : null
  if (!seen) return
  const left = `${Math.round(x1 - 2 - forkButton.offsetWidth)}px`, top = `${fieldTop(onHead(row), NAMEH)}px`
  if (forkButton.style.left !== left || forkButton.style.top !== top) Object.assign(forkButton.style, { left, top })
}
// A sound longer than the page holds (summary): drawn from its picture, the waveform from its leaves and the spectrogram
// from its spectra, its samples fetched where it is zoomed in (onsamples, a chunk of CHUNK at a time, as the pictures
// keep them): far enough for the waveform to want them (under WAVE samples a device px, where its columns stop being
// whole leaves) or for the spectrogram to draw them exactly (SPAN samples in view at most), half a view either side
// too. At most HELD samples a channel held, those farthest from the view let go first. `windows`: chunk → true once
// held, or the promise of it; null while the page holds the whole sound
export const CHUNK = 65536, WAVE = 1024, SPAN = 2 ** 23, HELD = 2 ** 24
export const pointers = new Map()
// on 'hover': how long it stays once let go (ms), when it was last reached for, whether it shows, the wait to hide it
export const LINGER = 1000
// the time row's height: none where it is off (`ruler` 'off': an embedding page's big time says it all); in a band's
// foot (`timeRow` 'band'), the scrollbar's alone at the picture's foot
export const rowH = () => ruler === 'off' ? 0 : timeRow === 'band' ? BAR + 2 : RULER
export const plot = () => ({ w: Math.max(1, W - gutter), h: Math.max(1, H - rowH() - (scroll === 'overview' ? MAP : 0)) })
// a sound's channels in one lane: as the waveform's look has them, or its notes, a voice's, found on their mix
export const merged = () => !tracks && (display === 'notes' || display === 'wave' && waveLook.lanes === 'one')
// Each band's height by its name, a track's or '' for a sound's, as its foot was dragged (onheight); the bands
// scrolled up `lift` px, as far as they and the room run past the picture (`spare` px); a track's head line over it.
// A sound is a track as any is (`banded`): its head line, TRACK px, the room under it, an empty tab's track too; but
// where the picture is all there is (`keepRoom` false: embedded), its lanes fill it
export let spare = 0
export const bandOf = i => tracks ? tracks[i]?.name ?? '' : ''
export const banded = () => !!tracks || keepRoom
const headOf = () => banded() ? HEAD : 0
// the room kept under the lanes, with a sound or an empty track: a take into nothing, as it comes and done, in the
// same lane, nothing moving as it stops
const roomy = () => keepRoom && (duration || empty) ? ROOM : 0
export const tallOf = name => Math.max(LOW, heights[name] ?? (banded() ? TRACK : plot().h - FOOT - roomy()))
export const kindOf = i => (tracks && kinds[bandOf(i)]) || display
// The lanes, [x, y, w, h] each, with what it shows (`kind`) and its channel's or its track's index (`i`), a notes lane
// its keys (keysOf): `all` in order, and by kind, `wave`, `spec` and `notes`; `spectral`, whether any of the picture's
// shows the spectrogram (the meters' width, where they all end). Each track's band its head (headOf), its lane and its
// foot; a sound's lanes one band, its foot under the last
export function lanes() {
  const { w, h } = plot(), n = merged() ? 1 : Math.max(1, count), kind = Array.from({ length: n }, (_, i) => kindOf(i)), hd = headOf()
  const each = tracks ? kind.map((_, i) => tallOf(bandOf(i))) : Array(n).fill((tallOf('') - GAP * (n - 1)) / n)
  const all = tracks ? each.reduce((s, lh) => s + hd + lh + FOOT, 0) : hd + each.reduce((s, lh) => s + lh, 0) + GAP * (n - 1) + FOOT
  spare = Math.max(0, all + roomy() - h)
  assign({ lift: Math.max(0, Math.min(lift, spare)) })
  let y = -lift
  // `open`: nothing right under it (a track's lane, a sound's last channel's), where its axis' last label may go
  return sorted(each.map((lh, i) => { if (tracks || !i) y += hd; const r = Object.assign([0, y, w, lh], { kind: kind[i], i, keys: kind[i] === 'notes' ? keysOf(i) : null, open: !!tracks || i === n - 1 }); y += lh + (tracks ? FOOT : GAP); return r }))
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
export const laneOf = (rects, i) => rects.find(r => r.i === i)
// the lanes' top and bottom
export const extent = rects => [Math.min(...rects.map(r => r[1])), Math.max(...rects.map(r => r[1] + r[3]))]
// the last lane's foot: under it, to the time row, the room (roomOf), nothing there to take hold of
export const floor = (L = lanes()) => extent(L.all)[1]
// The room under the last band's foot: its top, where a new track's lane would be, or null where it is not in sight
function roomOf(L = lanes()) {
  const y = floor(L) + FOOT
  return duration && !recording && y < plot().h ? { y } : null
}
export const inRoom = (py, L) => { const r = roomOf(L); return !!r && py >= r.y && py <= plot().h }
// the lanes the edited track's own things go in: its lane, with tracks; else all of them. The lane at a height, or -1
export const own = L => tracks ? sorted(L.all.filter(r => r.i === focus), L.spectral) : L
export const laneAt = (L, py) => L.all.findIndex(([, y, , lh]) => py >= y && py <= y + lh)
// whether a height is over `rects`, the gaps between them too
export const inLanes = (rects, py) => { const [top, bottom] = extent(rects); return py >= top && py <= bottom }
// a track's lane at a height, the gap under it too; -1 for none (the time row)
export const trackAt = (L, py) => py > plot().h ? -1 : L.all.findIndex(([, y, , lh]) => py >= y - headOf() && py < y + lh + FOOT)
// A band's foot under its lanes, to drag its height ('band': its last GRIP px, the rest its time row's): its name (''
// a sound's), or null
export const GRIP = 4
const feetOf = L => tracks ? L.all.map(([, y, , lh], i) => [y + lh, bandOf(i)]) : [[floor(L), '']]
export function footAt(py, L = lanes()) {
  if (py > plot().h) return null
  return feetOf(L).find(([f]) => py >= (timeRow === 'band' ? f + FOOT - GRIP : f) && py < f + FOOT)?.[1] ?? null
}
// the time row, a ruler's, where a press puts the caret alone and a drag selects through every lane: under the
// picture, or ('band') a band's foot but its grip
export const rulerAt = (py, L = lanes()) => py > plot().h || timeRow === 'band' && feetOf(L).some(([f]) => py >= f && py < f + FOOT - GRIP)
// a band's foot as it is dragged: its height as far as the pointer has gone, and with Alt (held as it was pressed or on
// the way) every band's, the others as they were where Alt is let go again
export const bands = () => tracks ? tracks.map(t => t.name) : ['']
export function resized() {
  const h = Math.max(LOW, Math.round(drag.h0 + drag.py - drag.y)), was = drag.from ??= { ...heights }
  assign({ heights: drag.all ? Object.fromEntries(bands().map(n => [n, h])) : { ...was, [drag.foot]: h } })
  invalidate()
}
// another track's lane pressed: it is the one edited now, nothing selected on it; a selection through every lane stays
// where the press takes hold of it (an edge, its audio), the lane's handles then its
export function refocus(L, py, px) {
  const i = tracks ? trackAt(L, py) : -1
  if (i < 0 || i === focus) return
  assign({ focus: i })
  layout(lanes())
  const held = allLanes && selection && !band && px >= x(selection[0]) - EDGE && px <= x(selection[1]) + EDGE
  if (!held) { assign({ band: null, selection: null }); assign({ more: [] }); assign({ anchor: null }); assign({ allLanes: false }) }
  onfocus(i)
  told()
}
// The time row ('band', the page's): in the foot of the band pointed at (rowBand), under its sound, its ticks from the
// lanes' foot on (the caret's line going on down into its tick, no gap), its labels beside their tops (row, their
// middle); none with that foot out of sight. Embedded ('foot'): at the picture's foot, level with the bar's edge, the scrollbar between it and the lanes,
// its ticks TICK long from `tickTop` down
export const tickTop = () => timeRow === 'band' ? rowBand()?.y ?? -H : plot().h + rowH() - TICK - 2, row = () => tickTop() + 7
// the foot the time row is in ('band'): the band pointed at's (as a drag goes, the edited one's); none pointed at, none,
// the picture a player's then, nothing ruled over it, as an embedded one is (as its level axis, overlay.js); or none,
// out of sight
export function rowBand(L = lanes()) {
  const i = drag ? focus : pointedBand, s = i >= 0 && feet(L).find(s => s.i === (tracks ? i : null))
  return s && s.y >= 0 && s.y + FOOT <= plot().h ? s : null
}
// where what is underlined on the time row is ('band'): the foot it is in, else, pointed nowhere, the edited band's, so
// a clip stays marked under its sound with the row away
export const underRow = (L = lanes()) => rowBand(L) ?? feet(L).find(s => s.i === (tracks ? focus : null)) ?? null
// Zoomed in, the scrollbar at the time row's top, over its ticks, above its labels, as an overlay scrollbar is: the
// whole sound across the row (or as far as the view goes past its end), the thumb what shows, at least THUMB px. A
// press on it drags the view; beside it, the view centres there first. { x0, x1, total }, or null showing all of it
// Chosen in the settings, the overview takes the bar's place: the whole sound in a strip MAP px tall under the time
// row, as a minimap, the view's part of it lit, pressed and dragged as the thumb is
export const BAR = 8, THUMB = 16, MAP = 28
// What an edit is still making: frozen, and said so (onbusy) as that starts or ends
export function freeze(list) {
  const was = frozen.length > 0
  frozen = list
  if (was !== list.length > 0) onbusy(list.length > 0)
  invalidate(true)
}
// the lane what the edited track's edits freeze is in: its, with tracks; every one without
export const own0 = () => tracks ? focus : null
// a press on what is frozen
export const frozenAt = (px, py, L = lanes()) => { const t = time(px), i = laneAt(L, py); return i >= 0 && frozen.some(f => (f.lane == null || f.lane === i) && t >= f.a && t <= f.b) }
// What is frozen: a light passing along each lane it is in, as a part still calculating (a layer of its own the
// compositor runs, editor.css .veil), within the lanes' place
export const veils = []
export function placeFrozen(L) {
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
export function carried(i) {
  const { at, a, b, of } = guest, out = []
  const part = (k, t0, t1, s0) => { const p = Math.max(t0, start), q = Math.min(t1, end); if (q > p) out.push({ k, from: (s0 + p - t0) * rate, to: (s0 + q - t0) * rate, x0: x(p), x1: x(q) }) }
  if (i !== 'room') part(i, 0, at, 0)
  part(of, at, at + b - a, a)
  if (i !== 'room') part(i, at + b - a, Infinity, at + b - a)
  return out
}
// The lane a new track would have in the room: under tracks, where the one made there has it, under its head line, as
// tall as the last's; under a sound, as tall as its band (embedded, all the room). The part in the picture, or null
export function roomLane(L = lanes()) {
  const r = roomOf(L), y = r && r.y + headOf(), h = r && Math.min(tracks ? L.all.at(-1)[3] : banded() ? tallOf('') : Infinity, plot().h - y)
  return h > 0 ? [0, y, plot().w, h] : null
}
// Each piece's part in view: where on screen (CSS px across the plot), the samples it shows, its level
export function spans() {
  return pieces.flatMap(p => {
    const a = Math.max(p.d0, start), b = Math.min(p.d1, end), k = (p.s1 - p.s0) / (p.d1 - p.d0 || 1)
    return b > a ? [{ x0: x(a), x1: x(b), from: (p.s0 + (a - p.d0) * k) * rate, to: (p.s0 + (b - p.d0) * k) * rate, gain: p.gain ?? 1 }] : []
  })
}
