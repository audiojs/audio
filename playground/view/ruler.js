import measure, { coloured } from '../tint.js'
import { ranges } from '../view.js'
import { LINGER, plot, lanes, extent, own, tickTop, row, rowBand, MAP } from './geometry.js'
import { TICK, timeRow, color, barStrip, runway, head, headLines, headTick, headTime, oc, c, rate, duration, hovered, start, end, selection, band, cursor, playhead, ruler, waveLook, data, tracks, focus, scroll, reached, moving, leavesOf, map, assign } from './model.js'
import { labelled } from './notes.js'
import { say, lanesEnd, seenTo, fitTo, away } from './overlay.js'
import { drag } from './pointer.js'
import { H, dpr, shade, invalidate, tints, paletted, tone, wash, caretColour, hues, rgba } from './render.js'
import { bar, onBar, x, X, fy } from './scales.js'
import { tag, gauge, size, label, stamp } from './strips.js'

// The time row and what moves along it: the ticks and times, the playhead followed and steered, the scrollbar and the
// overview

export const steer = () => { assign({ steered: playhead != null }); assign({ moving: null }) }
export let barOn = null, barTimer = 0
// `labels`: the time row's own times and ticks too (on the reel), or only these marks' (the playhead's); `clear`,
// [[x0, x1], …] px its own labels give way to
export function paintRuler(marks, spans = [], labels = true, clear = []) {
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
export function layHead(L, m) {
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
export function slide(px, v) {
  const now = document.timeline?.currentTime ?? performance.now()
  if (sliding && !sliding.v === !v && Math.abs(sliding.px + sliding.v * (now - sliding.at) / 1000 - px) < .25 / dpr) return
  const far = v > 0 ? plot().w + 2 - px : v < 0 ? px + 2 : 0, was = sliding?.animation
  head.style.transform = `translateX(${px}px)`
  const animation = far > 0 ? head.animate([{ transform: `translateX(${px}px)` }, { transform: `translateX(${px + Math.sign(v) * far}px)` }], { duration: far / Math.abs(v) * 1000, fill: 'forwards' }) : null
  if (animation) animation.startTime = now
  was?.cancel()
  sliding = { px, v, at: now, animation }
}
export function unslide() {
  sliding?.animation?.cancel()
  sliding = null
  runway.hidden = true
}
const CHEVRON = 12
const sought = () => playhead != null ? [playhead, playhead] : selection ?? [cursor, cursor]
export function awayOf(L) {
  const [a, b] = sought(), e = lanesEnd(L), side = X(b) < 0 ? -1 : X(a) >= e ? 1 : 0
  if (!side) return null
  // the playhead runs through every lane, the caret and the selection through the edited track's
  const T = playhead != null ? L : own(L), px = side < 0 ? 0 : Math.floor(e) - 1, rects = T.all
  // its chevron at the foot of its line, in the lanes, as the line's own (it was on the time row, apart from it)
  const y = Math.min(plot().h, extent(rects)[1]) - 7
  return { side, rects, px, y, x0: side < 0 ? px : px - CHEVRON + 1, x1: side < 0 ? px + CHEVRON : px + 1, fill: playhead != null ? color('--color-screen-bright') : caretColour() }
}
export const onAway = (px, py) => !!away && Math.abs(py - away.y) <= 7 && px >= away.x0 - 2 && px <= away.x1 + 2
export function paintAway(lit) {
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
export function bring() {
  const span = seenTo() - start, [a, b] = sought()
  assign({ steered: false })
  if (b - a > span * .9) return travel(a - (b - a) * .05, b + (b - a) * .05)
  // playing, toward the playhead as it moves on, following it from there
  const mid = () => playhead ?? (a + b) / 2
  travel(() => mid() - span / 2, () => mid() + span / 2)
}
export function fitAll() { assign({ fview: [0, 1] }); assign({ aview: [-1, 1] }); assign({ zoomed: {} }); fitTo(0, duration) }
// All that is selected (every range) shown whole, or, shown so already, or with nothing selected, all of the sound
export function frameSelected() {
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
export function moveOn() {
  const { s, e, to, t0 } = moving, k = Math.min(1, (performance.now() - t0) / 1000 / MOVE), u = 1 - (1 - k) ** 3
  const [a, b] = to(), w = (e - s) * ((b - a) / (e - s)) ** u, mid = (s + e) / 2 + ((a + b) / 2 - (s + e) / 2) * u
  if (k >= 1) assign({ moving: null })
  fitTo(mid - w / 2, mid + w / 2)
}
// The scrollbar's thumb, a pixel under the lanes: THIN px, as a native overlay scrollbar's at rest; under the pointer or
// dragged, THICK and brighter, as the page's scrollbars draw theirs (editor.css)
export const THIN = 4, THICK = 6
export function paintBar() {
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
export function barLight() {
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
