import scales from '../scale.js'
import { ownMarks, RECORD } from './data.js'
import { plot, bandOf, lanes, BAR, THUMB, MAP } from './geometry.js'
import { fine } from './gestures.js'
import { cueKinds, cueOrder, bounds, GUTTER, EDGE, SNAP, STICK, ONTO, FINE, NOTES, midiOf, LEVELS, TICK, GAIN, root, onaxis, onprobe, closest, farthest, overshoot, color, c, rate, duration, show, meters, recording, start, end, fview, selection, cursor, playhead, nudge, steered, cues, ranks, contour, snapping, aview, levelUnits, pitching, scroll, zoomed, framed, unframed, pull, assign } from './model.js'
import { linePoints } from './notes.js'
import { reach, seenTo, fitTo, meterAt, metered } from './overlay.js'
import { W, H, dpr, invalidate } from './render.js'
import { barOn } from './ruler.js'
import { size, label } from './strips.js'

// Scales: time and value to pixels and back, the ticks' steps, the axis' width, zoom and pinch, the ranges in view

export let scale = 'log'
// Geometry, in CSS pixels; `gutter`, the axis' width at the right (fitAxis)
export let gutter = GUTTER
export function bar() {
  if (!duration || whole()) return null
  const total = Math.max(duration, end), w = plot().w, k = w / total, x0 = Math.min(start * k, w - THUMB)
  return { x0, x1: Math.max(x0 + THUMB, end * k), total }
}
export const onBar = (px, py) => (scroll === 'overview' ? py >= H - MAP : py >= plot().h && py <= plot().h + BAR) && px >= 0 && px <= plot().w && !!barOn && !!bar()
export const x = t => (t - start) / (end - start || 1) * plot().w
// a time's place on the device's own pixels, where the pictures put it: the marks over them move with them, a device pixel
// at a time, as the view scrolls
export const X = t => Math.round(x(t) * dpr) / dpr
export const time = px => start + px / plot().w * (end - start)
export const clamp = t => Math.max(0, Math.min(duration, t))
// the 1-2-5 step just above `res`
const nice = res => { const p = 10 ** Math.floor(Math.log10(res)); return [1, 2, 5, 10].map(m => m * p).find(s => s >= res * (1 - 1e-9)) }
// Times go by the 1-2-5 step just above a pixel's time, down to a microsecond, and read with the decimals it needs, one
// at least: 5.0s, 5.05s, 5.000s. The frequency marks and level lines take the pointer within SNAP px.
export const unit = () => Math.max(1e-6, nice((end - start || 1) / plot().w * (fine() ? FINE : 1)))
export const digits = () => Math.max(1, Math.min(6, Math.ceil(-Math.log10(unit()) - 1e-9)))
export const snap = t => clamp(free(t))
// past the end too: where audio moved or silence opened takes the sound on to it
export const free = t => { const u = unit(); return Math.max(0, +(Math.round(t / u) * u).toFixed(digits())) }
export const snapF = (rect, py) => !fine() && marks().find(f => Math.abs(fy(rect, f) - py) <= SNAP) || yf(rect, py)
// The cues at this scale, their indices: none within CROWD px of a plainer one, as a map names its larger towns first,
// so zoomed out the main ones show and zoomed in the rest come. Plainer first: by the page's order (`cueOrder`, the ui
// config's `cues`), 'chunks' (by default) the sound's own start and end and each chunk's, where a sound starts or falls
// quiet, before the onsets within (a voice's phrases selectable before its syllables); 'onsets' the hits first, as a
// sampler wants them; then the rank (a pause's edge, a cue moved, the larger step), then the time, the same each time. Zoom sets how many,
// in time; how quiet a sound may be for its cues is the pauses' level, the same at any zoom (worker.js GROUND)
const CROWD = 24
let crowd = null
export function seen() {
  const w = plot().w, key = `${start} ${end} ${w}`
  if (crowd?.cues === cues && crowd.key === key) return crowd.list
  const taken = new Uint8Array(Math.ceil(w) + 2 * CROWD), list = []
  const order = (cues ?? []).map((t, i) => i).filter(i => x(cues[i]) >= 0 && x(cues[i]) <= w)
  const edge = i => bounds.has(cues[i]) ? 2 : cueKinds[i] === 'hit' ? 0 : 1, first = i => cueOrder === 'onsets' ? -edge(i) : edge(i)
  order.sort((i, j) => first(j) - first(i) || (ranks.get(cues[j]) ?? Infinity) - (ranks.get(cues[i]) ?? Infinity) || i - j)
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
export function stick(t) {
  if (!snapping || fine()) return null
  const nearest = list => list.reduce((best, q) => { const d = Math.abs(x(q) - x(t)); return d <= ONTO && (!best || d < best.d) ? { t: q, d } : best }, null)
  return nearest(ownMarks()) ?? nearest(seen().map(i => cues[i]))
}
export const stuck = t => stick(t)?.t ?? t
// The line edited over the sound, on its own scale in each lane: the gain curve, dB, mirrored about the centre line as
// the waveform is (GAIN), by tenths of a dB; or, editing pitch, the pitch line, semitones, an octave up at
// the lane's top and one down at its foot, to the cent. Each snaps to 0
export const pitchLine = () => pitching
export const ly = ([, y, , lh], v, sign = 1) => y + lh / 2 - sign * (pitchLine() ? Math.max(-1, Math.min(1, v / 12)) : Math.max(0, Math.min(1, (v - GAIN[0]) / (GAIN[1] - GAIN[0])))) * lh / 2
const valueOf = ([, y, , lh], py) => pitchLine() ? (y + lh / 2 - py) / (lh / 2) * 12 : GAIN[0] + Math.min(1, Math.abs(py - y - lh / 2) / (lh / 2)) * (GAIN[1] - GAIN[0])
export const snapV = (rect, py) => {
  const step = pitchLine() ? .01 : .1
  return Math.abs(ly(rect, 0) - fold(rect, py)) <= SNAP ? 0 : +(Math.round(valueOf(rect, py) / step) * step).toFixed(2)
}
export const local = event => { const r = root.getBoundingClientRect(); return [event.clientX - r.left, event.clientY - r.top] }
export const inside = ([lx, ly, lw, lh], px, py) => px >= lx && px <= lx + lw && py >= ly && py <= ly + lh
// Frequency ↔ y within a spectrogram's lane: the part of its scale shown; within a notes lane, its keys, a row each
const axis = () => scales[scale]
export const freqs = () => [scales[scale].low, rate / 2]
const shown = () => fview
export const fy = (rect, f, [lo, hi] = freqs(), [u0, u1] = shown()) => rect.keys ? keyY(rect, midiOf(f)) : rect[1] + rect[3] - (axis().at(Math.max(lo, f), lo, hi) - u0) / (u1 - u0) * rect[3]
export const uy = ([, y, , lh], py, [u0, u1] = shown()) => u0 + (y + lh - py) / lh * (u1 - u0)
export const yf = (rect, py, [lo, hi] = freqs()) => rect.keys ? 440 * 2 ** ((yKey(rect, py) - 69) / 12) : axis().of(uy(rect, py), lo, hi)
// A note's row in a notes lane (MIDI, a pitch's fractional): its middle's height; the note at a height
export const rowOf = rect => rect[3] / (rect.keys[1] - rect.keys[0] + 1)
export const keyY = (rect, m) => rect[1] + rect[3] - (m - rect.keys[0] + .5) * rowOf(rect)
export const yKey = (rect, py) => rect.keys[0] - .5 + (rect[1] + rect[3] - py) / rowOf(rect)
// the keys whose rows show, wholly or in part (`whole`, those whose middles do), from the lowest
export const keyRows = (rect, whole = false) => { const [lo, hi] = rect.keys, d = whole ? 0 : .5, out = []; for (let m = Math.ceil(lo - d); m <= Math.floor(hi + d); m++) out.push(m); return out }
// Sample value ↔ y in a lane: `sign` × `a` in the values it shows, kept within it
export const ay = ([, y, , lh], a, sign = 1) => y + Math.max(0, Math.min(1, (aview[1] - sign * a) / (aview[1] - aview[0]))) * lh
export const ya = ([, y, , lh], py) => aview[1] - (py - y) / lh * (aview[1] - aview[0])
// the gain curve mirrors about the centre line: either half grabs and drags it; the pitch curve is one line
export const fold = ([, y, , lh], py) => pitchLine() ? py : y + lh / 2 - Math.abs(py - y - lh / 2)
const nearPoint = (rect, px, py) => ([t, v]) => Math.abs(x(t) - px) <= EDGE && Math.abs(ly(rect, v) - fold(rect, py)) <= EDGE + 2
// the point nearest the pointer among those near it, or -1
export const pointAt = (rect, px, py) => {
  let best = -1, d = Infinity
  linePoints().forEach((p, i) => { const e = Math.hypot(x(p[0]) - px, ly(rect, p[1]) - fold(rect, py)); if (nearPoint(rect, px, py)(p) && e < d) { d = e; best = i } })
  return best
}
// Lanes the overlays draw in: amplitude over the waveform if it shows; the line edited, the gain's there too, the
// pitch's on the waveform alone (the spectrogram has its own: the pitch curve, the line's points on it)
export const ampLanes = L => L.wave.length ? L.wave : L.spec
export const lineLanes = L => pitchLine() ? L.wave : ampLanes(L)
// lanes on a pitch axis, where the pitch curve shows and is dragged: the spectrogram's, the notes'
export const pitchLanes = L => [...L.spec, ...L.notes]
// Marks [y, …] by a lane, the most important first, those there is room for: in the lane, their labels (under or over
// their ticks: beside) `gap` px from each other's and from what is there (`placed`, the middles of labels there, added
// to). A level and its mirror (marks [y, text, pair] of one `pair`) both or neither, so the axis reads the same either
// side of the centre line
export function room(rect, list, placed = [], gap = size() + 4) {
  const inside = ([ly]) => Math.round(ly) >= rect[1] && Math.round(ly) <= rect[1] + rect[3], out = [], done = new Set()
  for (const m of list) {
    if (done.has(m)) continue
    const group = (m[2] == null ? [m] : list.filter(n => n[2] === m[2])).filter(inside)
    group.forEach(n => done.add(n))
    const my = group.map(([ly]) => beside(rect, Math.round(ly)))
    if (!group.length || my.some((p, i) => placed.some(q => Math.abs(q - p) < gap) || my.some((q, j) => j > i && Math.abs(q - p) < gap))) continue
    placed.push(...my)
    out.push(...group)
  }
  return out
}
// Marks [y, text] by a lane: each with room, its tick at its height, its label under it (over it only where another
// lane lies right under it, a channel's, so no label runs into it: `open`, the lane's own, false then); those clear of
// the pointer's value (`taken`, its y), each alone, its mirror staying
export const beside = (rect, ty) => rect.open !== false || ty + size() - 1 + size() / 2 <= rect[1] + rect[3] ? ty + size() - 1 : ty - size() + 2
// Marks ticked between them (`minor`, [y, …]) by a tick half as long, unlabelled, as a ruler's
export function ticks(rect, list, taken, minor = []) {
  const w = plot().w, clear = ([ly]) => taken == null || Math.abs(beside(rect, Math.round(ly)) - beside(rect, taken)) >= size() + 4
  c.fillStyle = color('--color-screen-rule')
  for (const [ly] of minor) if (Math.round(ly) >= rect[1] && Math.round(ly) <= rect[1] + rect[3]) c.fillRect(w + 1, Math.round(ly), TICK / 2, 1)
  for (const [ly, text] of room(rect, list).filter(clear)) {
    const ty = Math.round(ly)
    c.fillStyle = color('--color-screen-rule')
    c.fillRect(w + 1, ty, TICK, 1)
    c.fillStyle = color('--color-screen-line-number')
    c.fillText(text, w + 1, beside(rect, ty))
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
export function fitAxis() {
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
export const hzMarks = rect => { const [, y, , lh] = rect; return [[y + lh, reads(yf(rect, y + lh))], ...marks().map(f => [fy(rect, f), hertz(f)])] }
// Notes, by name, a piano's white keys first, its C's the first of them, as a piano roll names its octaves
const KEYED = [0, 7, 4, 9, 2, 5, 11, 1, 3, 6, 8, 10]
export const noteMarks = rect => keyRows(rect, true).sort((p, q) => KEYED.indexOf(p % 12) - KEYED.indexOf(q % 12) || p - q).map(m => [keyY(rect, m), `${NOTES[m % 12]}${Math.floor(m / 12) - 1}`])
// a lane's marks, as its axis has them: levels, frequencies or notes
export const axisMarks = rect => rect.keys ? noteMarks(rect) : rect.kind === 'spec' ? hzMarks(rect) : levelMarks(rect)
// Levels within the values a lane shows, the most telling first: as sample values, 0 and full scale, then 1-2-5 steps
// of what shows, as fine as the lane has room for (labelStep); in dB, mirrored about 0 and clear of it, the halvings first, the top's 0 with
// its unit
export function levelMarks(rect, units = levelUnits) {
  const [lo, hi] = aview, within = v => v >= lo - 1e-9 && v <= hi + 1e-9
  if (units === 'linear') return [...new Set([0, 1, -1, ...multiples(lo, hi, labelStep(rect))])].filter(within).map(v => [ay(rect, v), linear(v), Math.abs(v)])
  const zero = ay(rect, 0)
  return LEVELS.flatMap(db => [1, -1].map(sign => [sign * 10 ** (db / 20), db, sign])).filter(([v]) => within(v) && Math.abs(ay(rect, v) - zero) >= 16)
    .map(([v, db, sign]) => [ay(rect, v), db ? `${db > 0 ? '+' : '−'}${Math.abs(db)}` : sign > 0 ? '0dB' : '0', db])
}
const linear = v => v ? `${v < 0 ? '−' : ''}${+Math.abs(v).toPrecision(3)}` : '0'
// the 1-2-5 step the sample values are read to, four or so across what a lane shows. Labelled by the finest 1-2-5 step
// whose labels stand LABELLED px apart in the lane (1 across a short one, every 0.2 across a tall one), as the time
// row's; ticked between, unlabelled, by the finest 1-2-5 step that parts it evenly TICKED px apart (each 0.1, where
// there is room), as a ruler's
const LABELLED = 64, TICKED = 10, STEPS = [-4, -3, -2, -1, 0].flatMap(e => [1, 2, 5].map(m => +(m * 10 ** e).toPrecision(3)))
const valueStep = () => nice((aview[1] - aview[0]) / 4)
const perUnit = rect => Math.abs(ay(rect, 1) - ay(rect, 0))
const labelStep = rect => STEPS.find(s => s * perUnit(rect) >= LABELLED) ?? 1
const tickStep = rect => { const s = labelStep(rect); return STEPS.find(t => t < s && t * perUnit(rect) >= TICKED && Math.abs(s / t - Math.round(s / t)) < 1e-6) ?? null }
// the levels ticked between the labelled, as sample values, [y, …]; none in dB, whose marks are each labelled
export const levelTicks = rect => { const t = levelUnits === 'linear' && tickStep(rect); return t ? multiples(...aview, t).map(v => [ay(rect, v)]) : [] }
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
export const reads = f => f >= 1000 ? `${+(f / 1000).toPrecision(3)}k` : `${+f.toPrecision(3)}`
// the decimals of a 1-2-5 step: 0.5 has one, 0.05 two, 2 none
const places = step => Math.max(0, -Math.floor(Math.log10(step) + 1e-9))
// A sample value the pointer reads: two decimals (−0.03, 0.47), or as many as the marks have zoomed in (0.005 apart,
// −0.026), never wider than they are, so zooming moves the axis no more than its marks do; as wide wherever it is
export const sampled = v => { const r = Math.abs(v).toFixed(Math.max(2, places(valueStep()))); return +r ? `${v < 0 ? '−' : ''}${r}` : '0' }
// A level in dB as the axis writes it, no unit: the waveform's axis says dB at its top, and the spectrogram's level,
// under the frequency read, is the one value there below 0. Whole, or to `fixed` places; at or under `floor`, none
export const decibel = (v, fixed = 0, floor = -Infinity) => {
  if (!(v > floor)) return '−∞'
  const r = Math.abs(v).toFixed(fixed)
  return `${+r ? v < 0 ? '−' : '+' : ''}${r}`
}
// The level at y in a lane, as the axis writes it: a sample value (sampled), or decibels to a tenth (−12.3); on a mark's
// line, the mark's: within a pixel of it, so a quiet level by the centre line reads as it is, not as the 0 SNAP px
// about it would (±0.1 in a short lane)
export function level(rect, py) {
  const mark = [...levelMarks(rect), ...levelTicks(rect).map(([ly]) => [ly, sampled(ya(rect, ly))])].find(([ly]) => Math.abs(ly - py) <= 1)
  if (mark) return mark[1]
  const a = ya(rect, py)
  return levelUnits === 'linear' ? sampled(a) : decibel(20 * Math.log10(Math.abs(a)), 1, -99)
}
// Held ⌘ (Ctrl), how far the pointer at `t` is from what is selected, or from the caret, as Figma's Alt measures: from the
// nearer edge to it, or inside the selection from each edge, { t, spans: [[from, to], …] }; none on an edge. While it
// plays, from the playhead, the caret moving
export function measured(t) {
  const [a, b] = playhead != null ? [playhead, playhead] : selection ?? [cursor, cursor], spans = t > b ? [[b, t]] : t < a ? [[t, a]] : t > a && t < b ? [[a, t], [t, b]] : []
  return spans.length ? { t, spans } : null
}
// Measuring over the spectrogram, the time the meters read the spectrum at, the pointer's (onprobe), or null: told
// only as it changes
let probed = null
export const probe = t => { if (t !== probed) onprobe(probed = t) }
// From `zoom.in` samples across (32) to `zoom.out` times the whole across the lanes (4/3: it, and a quarter of the view
// room after it): the sound starts at the left, the room is on its right. A view an edit left past the sound's end (it got shorter) stays
// there until it is moved back. Scrolled or zoomed by hand (`past`), the sound's end goes on as far as `overshoot` of
// the view from its right (0.5, its middle): the tail comes out from under the meters and the labels to be edited, the
// room past it plain, the grid and the centre line ending with it. Zoom out 1 and overshoot 0: never any room past it
export function setRange(a, b, past = false) {
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
export function setFreqs(u0, u1) {
  const span = Math.min(1, Math.max(1 / 64, u1 - u0)), a = Math.max(0, Math.min(1 - span, u0))
  assign({ fview: [a, a + span] })
  invalidate()
}
export function frameVoice() {
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
export const zoom = (factor, at = (start + end) / 2) => zoomSpan((end - start) * factor, at)
export function zoomSpan(span, at) {
  if (playhead != null && !steered) at = playhead + nudge
  assign({ moving: null })
  const k = (at - start) / (end - start || 1)
  setRange(at - k * span, at - k * span + span, true)
}
// the view shows all of the sound
export const whole = () => start <= 0 && seenTo() >= duration - 1e-9
// zoom the frequencies around u, which stays where it is on screen
export const zoomFreqs = (factor, u) => { const [u0, u1] = fview, k = (u - u0) / (u1 - u0), span = (u1 - u0) * factor; setFreqs(u - k * span, u - k * span + span) }
// Zoom a notes lane's keys around the key `m` (MIDI, fractional), which stays where it is on screen: from 4 rows to
// the piano's 88
export function zoomKeys(rect, factor, m) {
  const [lo, hi] = rect.keys, span = hi - lo + 1, to = Math.max(4, Math.min(88, span * factor))
  setKeys(rect, m - (m - lo + .5) / span * to, to)
}
// A notes lane's keys, its band's: `span` rows up from the edge `e0`, within MIDI's
export function setKeys(rect, e0, span = rect.keys[1] - rect.keys[0] + 1) {
  const a = Math.max(-.5, Math.min(127.5 - span, e0))
  assign({ zoomed: { ...zoomed, [bandOf(rect.i)]: [a + .5, a + span - .5] } })
  invalidate()
}
// Pointer: a press takes what is under it (down); two fingers pan and zoom, the wheel pans, a pinch or Ctrl+wheel zooms.
// The frequencies at the right of a spectrogram lane, and the spectrum drawn just before them: that lane, else null
export const onFreqs = (px, py, L = lanes()) => px > (meters && show.spectrum ? meterAt(metered(L)) : plot().w) ? L.spec.find(r => py >= r[1] && py <= r[1] + r[3]) ?? null : null
// The keys at the right of a notes lane, and the piano by them: that lane, else null
export const onKeys = (px, py, L = lanes()) => px > (show.keys ? meterAt(metered(L)) : plot().w) ? L.notes.find(r => py >= r[1] && py <= r[1] + r[3]) ?? null : null
// The levels at the right of a waveform lane, and its meter: that lane, else null
export const onLevels = (px, py, L = lanes()) => px > plot().w - (meters && show.meters ? 10 : 0) ? L.wave.find(r => py >= r[1] && py <= r[1] + r[3]) ?? null : null
export function zoomLevels(factor, u, lh) {
  const [lo, hi] = aview, was = hi - lo, to = Math.max(2e-3, Math.min(8, (was === 2 ? 2 * pull : was) * factor))
  const held = Math.abs(lh / to - lh / 2) <= STICK || was !== 2 && (was - 2) * (to - 2) < 0, span = held ? 2 : to
  assign({ pull: held && was === 2 ? to / 2 : 1 })
  const a = span >= 2 ? -span / 2 : u - (u - lo) / was * span
  scrollLevels(a, span)
}
// Scroll the levels: `span` of them from `a`, kept within full scale
export function scrollLevels(a, span = aview[1] - aview[0]) {
  if (span < 2) a = Math.max(-1, Math.min(1 - span, a))
  assign({ aview: [a, a + span] })
  invalidate()
}
export function setScale(name) {
  scale = root.dataset.scale = name
  assign({ fview: [0, 1] }); assign({ leveled: false })
  invalidate()
}
// [a, b] s brought into sight, as an editor scrolls to what it selects: moved to show it, zoomed out to fit it
export function reveal(a, b = a) {
  const span = seenTo() - start
  if (b - a > span * .9) fitTo(a - (b - a) * .05, b + (b - a) * .05)
  else if (a < start || b > start + span) setRange(a - span * .1, a - span * .1 + end - start)
}
