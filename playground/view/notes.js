import { CURVES, CROSSFADES } from '../ops.js'
import { lightness } from '../tint.js'
import { drag, plot, x, X, time, pitchLine, ly, fy, rowOf, keyY, keyRows, ay, fold, ampLanes } from '../view.js'
import { EDGE, NOTES, midiOf, noteOf, VOICE, onaudition, color, c, rate, duration, units, pieces, start, end, envelope, shift, contour, landed, clips, data, tracks, focus, noted } from './model.js'
import { lanesEnd } from './overlay.js'
import { moved, rgba } from './render.js'
import { tag, accent, label } from './strips.js'

// Pitch and notes: a frequency's place, the notes lane and its keys, a voice's notes and guides, the gain and pitch
// lines and their bends, the clips

// What a drag on the pitch does, heard as it will sound (`onaudition`): from its first move, as it is at 0 too, and
// again each time it changes
export function hear(d, changed, what) {
  if (!changed && d.heard) return
  d.heard = true
  onaudition(what)
}
// what a pitch drag is heard over: the voiced stretch of the pitch curve pressed, or the range its tool is on
export function pitchRange(d) {
  if (!d.run) return { at: d.a, duration: d.b - d.a }
  const { times } = contour, hop = times[1] - times[0] || .01
  return { at: Math.max(0, times[d.run[0]] - hop / 2), duration: times[d.run[1]] - times[d.run[0]] + hop }
}
// How far a pitch goes, as a tuner says it: semitones and cents, and the note it goes from (`f`, Hz, the pitch curve's
// median over what moves, where it has one) and to
export const semis = st => { const whole = Math.trunc(st), ct = Math.round(Math.abs(st - whole) * 100), sign = st > 0 ? '+' : st < 0 ? '−' : ''; return whole || !ct ? `${sign}${Math.abs(whole)}st${ct ? ` ${ct}ct` : ''}` : `${sign}${ct}ct` }
export const pitchSays = (st = 0, f = 0, to = f * 2 ** (st / 12)) => f ? `${semis(st)}, ${noteOf(f)} → ${noteOf(to)}` : semis(st)
// How wide a voice's rises and falls go over the range, as the status bar gives a melody's compass (its 10th to 90th
// percentile), and as wide as the factor makes them
export function intonationSays({ k, a, b }) {
  const st = voiced(a, b).map(f => 12 * Math.log2(f)), q = p => st[Math.floor(p * (st.length - 1))], wide = st.length > 1 ? q(.9) - q(.1) : 0
  return `×${k.toFixed(2)}${wide ? `, ${wide.toFixed(1)}st → ${(wide * Math.abs(k)).toFixed(1)}st wide` : ''}`
}
// the pitch curve's voiced frames over [a, b], Hz, low to high; their median
function voiced(a, b) { return contour?.f0.length ? [...contour.f0.filter((f, i) => f && contour.times[i] >= a && contour.times[i] <= b)].sort((p, q) => p - q) : [] }
export function median({ at, duration }) { const list = voiced(at, at + duration); return list.length ? list[list.length >> 1] : 0 }
export const pitched = (rect, L) => L.spec.includes(rect)
export const clampY = ([, y, , lh], ly) => Math.max(y + 5, Math.min(y + lh - 5, ly))
// What a step sets, as hints over the output, never over the sound itself (`show.guides`): its range a bar on the time
// row, as a DAW's ruler marks a region; a level, its fades' ramps, a time, a frequency, a band, the notes it tunes to
export function paintGuide(g, L) {
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
export const BLACK = [1, 3, 6, 8, 10]
export function paintRoll(rect, end, on, sel) {
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
export function noteAt(rect, px, py) {
  const reach = Math.max(6, rowOf(rect)) / 2 + 2
  return (noted[rect.i] ?? []).find(n => px >= X(n.time) - 2 && px <= X(n.time + n.duration) + 2 && Math.abs(keyY(rect, midiOf(bent(n.freq, n.time + n.duration / 2))) - py) <= reach) ?? null
}
// The time row: a label every step a time reads well in (1-2-5, and minutes'), at least 72 px apart, its tick running
// down from the lanes beside it; in samples, 1-2-5 steps of samples (`ruler`: labels and their ticks, ticks alone, or
// none). Over them the times that matter now (`marks`, most telling first), each its tick joined to its line in the
// lanes: the pointer's, the caret's or the playhead's, a selection's start and end; the labels under them give way. Each
// label after its tick, a range's start's before it where the range has no room for it.
const SECONDS = [1e-5, 2e-5, 5e-5, 1e-4, 2e-4, 5e-4, .001, .002, .005, .01, .02, .05, .1, .2, .5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600]
export function labelled() {
  const pps = plot().w / (end - start || 1), steps = units === 'samples' ? [0, 1, 2, 3, 4, 5, 6, 7].flatMap(e => [1, 2, 5].map(m => m * 10 ** e / rate)) : SECONDS
  const step = steps.find(s => s * pps >= 72) ?? steps.at(-1)
  // the grid's finer step between: the largest of the steps that parts it evenly in three or more
  const minor = steps.findLast(s => s <= step / 3 * (1 + 1e-9) && Math.abs(step / s - Math.round(step / s)) < 1e-6)
  return { step, minor, digits: Math.max(0, Math.ceil(-Math.log10(step) - 1e-9)), first: Math.max(0, Math.ceil(start / step - 1e-9)) }
}
// Where each lane's samples first cross full scale in each stretch that clips, { t, i: its lane, sign: +1 or −1 },
// read off the samples the page holds (none of a long sound's), once for those clips and samples
let crossings = null
export function clipMarks() {
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
export function paintLine(rects) {
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
export const linePoints = () => { const curve = pitchLine() ? shift : envelope; return drag?.points ?? (curve ? curve.t.map((t, i) => [t, curve.v[i]]) : []) }
export const curveOf = pts => ({ t: pts.map(p => p[0]), v: pts.map(p => p[1]) })
// A line's value at t: straight between its points, flat past its ends (plan.js curveFn); 0 with none
export function valueAt(pts, t) {
  if (!pts.length) return 0
  if (t <= pts[0][0]) return pts[0][1]
  for (let i = 1; i < pts.length; i++) if (t <= pts[i][0]) { const [t0, v0] = pts[i - 1], [t1, v1] = pts[i]; return v0 + (v1 - v0) * (t - t0) / (t1 - t0 || 1) }
  return pts.at(-1)[1]
}
function lineAt(t) { return valueAt(linePoints(), t) }
// a line that shows: the pitch's always, the gain's once there is a curve, or while its points are being made
export const onLine = (rect, px, py) => (pitchLine() || envelope || drag?.points) && Math.abs(ly(rect, lineAt(time(px))) - fold(rect, py)) <= EDGE
// The pitch curve as it shows: the output's, moved as the pitch line has moved since it was measured (its edit on its
// way, a drag of it), and as the selection's pill dragged moves it. Frame i's pitch, Hz, 0 where it has none
export function toneOf(i) {
  const { times, f0, basis } = contour, t = times[i]
  return f0[i] && bent(f0[i] * 2 ** ((lineAt(t) - valueAt(basis, t)) / 12), t)
}
// a pitch at t as a tool dragged over the selection makes it: higher or lower, or its rises and falls wider or
// flatter about the range's median (named apart from moved(t), the times an edit drawn ahead moves, which one function
// of both names had hidden: the cues and the markers stayed where they were till the output came)
export function bent(f, t) {
  const d = drag?.lift ? drag : landed
  if (!d || t < d.a || t > d.b) return f
  return d.lift === 'pitch' ? f * d.ratio : d.lift === 'intonation' && d.mid ? d.mid * (f / d.mid) ** d.k : f
}
// The pitch curve at any t, where a point of the line sits on it: between two voiced frames straight in pitch, a gap
// crossed from one side to the other, past them the nearest, as the voice had it before the line; then as the line
// has it at t itself. 0 with no voice at all
export function toneAt(t) {
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
export function paintContour(rects) {
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
export const pointOn = (rect, px, py) => nearestOn(rect, px, py, linePoints().map(p => p[0]))
// The curve's bends (stylize) as handles, hollow, the line's own points standing for those they cover: one
// dragged bends the voice from the handle before it to the one after, the curve elsewhere as it was
const knots = () => { const pts = linePoints(); return (contour?.knots || []).filter(t => !pts.some(([p]) => Math.abs(x(p) - x(t)) < EDGE)) }
export const knotOn = (rect, px, py) => { const ks = knots(), i = nearestOn(rect, px, py, ks); return i < 0 ? null : ks[i] }
