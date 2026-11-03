import Waveform from '../../assets/gl-waveform.js'
import scales from '../scale.js'
import { CURVES, CROSSFADES } from '../ops.js'
import measure, { coloured, hue, temperature, colormap, inked, lightness, MAPS } from '../tint.js'
import { scale, unwritten, takes, CHUNK, WAVE, SPAN, HELD, gutter, plot, merged, kindOf, lanes, laneOf, X, freqs, carried, roomLane, spans, room, fitAxis, axisMarks, setRange, whole, told } from '../view.js'
import { root, onsamples, onheard, color, reel, selectCanvas, specCanvas, waveCanvas, rowStrip, marksCanvas, meterStrip, barStrip, overlay, gl, sgl, waves, specs, rate, duration, display, units, hovered, arriving, more, recording, pieces, guest, start, end, fview, band, fadeCurve, aview, levelUnits, grid, look, waveLook, data, tracks, focus, windows, windowsOf, leveled, scroll, kinds, pictures, cruise, cruised, palette, moving, ruled, under, shaded, assign } from './model.js'
import { labelled } from './notes.js'
import { paint, lanesEnd, fitTo } from './overlay.js'
import { barOn, moveOn } from './ruler.js'
import { ground } from './strips.js'

// Drawing: the canvases sized, the render loop, the reel and its tape, the waveform and spectrogram per lane, their
// looks and colours, the levels weighted as heard, the grid, a snapshot

// each wave's twin from the weighed `leaves` of its samples, as weigh() makes them
export function twinsFor(leaves) {
  if (leaves?.length !== waves.length) return
  twinned(new Map(waves.map((w, c) => { const twin = new Waveform(gl); twin.peaks(leaves[c], 0); return [w, twin] })))
  twinsOf = heardOf
  weighing = false
}
// how the spectrogram draws, gl-spectrogram's options: its colours, its depth in dB, its FFT size; and the levels its
// colours span, [floor, top] dB, the lanes' one scale once leveled (spectrograms), which the spectrum meter takes too
export let decibels = null
// when the pictures were last drawn, and the overlay's read of the spectrogram put off till they hold still (loudness)
export let drawn = 0
// `anchor`: where the selection was begun, the end Shift keeps (origin)
export let W = 0, H = 0, dpr = 1, frame = 0
// A canvas resized is blank until drawn again, and the browser shows what is there at the next paint: drawn here,
// in the resize callback before that paint, a divider dragged never flashes an empty picture. Where the view starts
// and its scale stay: a panel opening beside it, or the window narrowing, shows less of the sound, never squeezes it.
export function resize() {
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
// The output's pieces after an edit of [a, b]: moved to start at `to` over what is there, silence where it was
// (fn/move.js), a copy put in at `to` (what was there after it), stretched to end at `to` (what follows moving with
// it), `db` louder, silence (gone to another track); or gone (remove, cut), or all that stays (crop); or, silence opened
// at a until `to` (insert), what was after it after that. Silence an edit opens is drawn by the pictures from samples
// there are at this level: as a waveform draws silence, its centre line; as a spectrogram does, nothing
const SILENT = 1e-6
export function arrange(kind, a, b, to = a, db = 0) {
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
export function moved(t) {
  if (!pieces) return t
  const p = pieces.find(p => !p.silent && t >= p.s0 - 1e-9 && t <= p.s1 + 1e-9)
  return p ? p.d0 + (t - p.s0) * (p.d1 - p.d0) / (p.s1 - p.s0 || 1) : null
}
// A fade drawn at once: what it covers in 48 steps, each at its level on the fade's curve (fn/fade.js); in or out
// over [t0, t1]
export function faded(kind, t0, t1, n = 48) {
  const len = t1 - t0, c = CURVES[fadeCurve], level = u => Math.max(1e-4, c(kind === 'in' ? u : 1 - u))
  const list = [[0, t0, 1], ...Array.from({ length: n }, (_, i) => [t0 + len * i / n, t0 + len * (i + 1) / n, level((i + .5) / n)]), [t1, duration, 1]]
  return list.filter(([s0, s1]) => s1 > s0).map(([s0, s1, gain]) => ({ s0, s1, d0: s0, d1: s1, gain }))
}
// A crossfade across [p, q] drawn at once, as remove() with a crossfade as long splices it (fn/crossfade.js, fn/remove.js):
// the range goes, and over its half-length either side of the seam the audio before it runs on, fading out, while the
// audio after it comes in early, fading in, on equal-power curves: the two drawn there over each other, each at its
// level in 24 steps, as they will sound together. Within the sound: the halves shrink at its ends.
export const half = (p, q) => Math.min((q - p) / 2, p, duration - q)
export function crossed(p, q, n = 24) {
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
export let shade = 'none'
function light(name) {
  if (name === shade) return
  shade = name
  for (const canvas of [specCanvas, waveCanvas]) canvas.style.opacity = SHADES[name]
  for (const canvas of [overlay, marksCanvas, selectCanvas, rowStrip.g.canvas, meterStrip.g.canvas]) canvas.style.opacity = +(name !== 'none')
}
export function invalidate(overlay = false) { pictures || assign({ pictures: !overlay }); frame ||= requestAnimationFrame(render) }
// The tape: the pictures as drawn, from where the view started then, AHEAD of a view's width past its right end, on the
// reel. The view scrolled or followed within them (the same span, the same size), the reel moves by as many device
// pixels, a layer the compositor moves (roll), nothing drawn again; past them, or at another span, drawn again from
// where the view is. A view's width further: drawn once in two thirds of the time the view takes to cross it.
// { start, end (s, all of them), W (CSS px across), view (the view's W then), H, dpr, span }
const AHEAD = .6
export let tape = null, rolled = null
// the geometry the pictures are drawn in: the view's, AHEAD further (or the tape's as drawn, `t`), for `fn`
export function onTape(fn, t = null) {
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
export let running = null
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
export const tints = new Map()
export function tonesOf(map, n) {
  const L = Math.max(.5, Math.min(.8, lightness(rgba(color('--color-screen-wave')))))
  const of = map === 'temperature' ? u => temperature(u, L) : colormap((MAPS[map] ?? inked(rgba(color('--color-screen-bright')), 17)).map(rgba), rgba(color('--color-screen')))
  return { L, tones: Array.from({ length: n }, (_, k) => of(k / (n - 1))) }
}
export const paletted = () => (palette ?? assign({ palette: tonesOf(waveLook.map, 256) }))
export const tone = u => paletted().tones[Math.round(u * 255)]
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
export let twinOf = new Map(), heardOf = 0, weighing = false, twinsOf = -1
const twinned = next => { for (const w of twinOf.values()) w.destroy(); twinOf = next }
export function unheard(keep = false) { heardOf++; weighing = false; if (!keep) twinned(new Map()) }
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
export function reshow(change) {
  const was = lanesEnd(lanes()), all = !recording && duration && whole()
  change()
  if (band && kindOf(focus) !== 'spec') { assign({ band: null }); assign({ more: more.filter(r => r.length === 2) }); told() }
  if (all && lanesEnd(lanes()) !== was) fitTo(0, duration)
  invalidate()
}
// The picture as a PNG data URL, for an agent to look at: the waveform over the spectrogram, each with its rulers, of
// [a, b] s (what shows, else), at most `width` px across, every lane in each, whatever a track shows. Drawn, read and
// put back in one task: the screen never shows it
export function snapshot(range, width = 1200) {
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
export const wash = (spec = false) => color(focused() ? spec ? '--color-screen-select-spectrum' : '--color-screen-select' : spec ? '--color-screen-select-spectrum-inactive' : '--color-screen-select-inactive')
// The caret the same way: the skin's while the picture has focus; else faint, IDLE of its alpha, as an editor's caret
// goes out with its focus, kept in sight here as where play starts. An embed shows it faint till it is pressed
const IDLE = .35
export const caretColour = () => { const css = color('--color-screen-caret'); if (focused()) return css; const [r, g, b, a] = rgba(css); return `rgb(${r * 255} ${g * 255} ${b * 255} / ${a * IDLE})` }
// A waveform and a spectrogram per channel; the spectrogram's silence is the page, seen through, its loudest its ink
// (the skin's spectrum: white, or a theme's). How bright the pair is drawn is the layers' own (light): dim while it is
// the file arriving, full once the output is there
// Each waveform its colour (`hues`): the screen's; in one lane, its channel's (the skin's, a theme's syntax hues), else
// a hue each evenly round at the waveform's lightness (tint.js);
// as gl-waveform takes it, [r, g, b, a], read once, so a stretch's colour and back costs no parsing
export let hues = [], swatch = null
export const rgba = css => {
  swatch ??= Object.assign(document.createElement('canvas'), { width: 1, height: 1 }).getContext('2d', { willReadFrequently: true })
  swatch.clearRect(0, 0, 1, 1)
  swatch.fillStyle = css
  swatch.fillRect(0, 0, 1, 1)
  return [...swatch.getImageData(0, 0, 1, 1).data].map(v => v / 255)
}
// channel i of n's hue in one lane: the skin's, while it has one for each, at the alpha where two cross both show
export const channel = (i, n) => {
  const own = Array.from({ length: n }, (_, k) => color(`--color-screen-channel-${k + 1}`))
  return own.every(Boolean) ? [...rgba(own[i]).slice(0, 3), .75] : hue(i, n, lightness(rgba(color('--color-screen-wave'))))
}
export const shades = () => (shaded ?? assign({ shaded: look.color ?? inked(rgba(color('--color-screen-bright')), 17, look.gamma ?? 1) }))
const FILLS = { density: { rms: false, density: 'gaussian' }, cloud: { rms: false, density: 'laplace' }, body: { rms: false, density: 'flat' }, rms: { rms: null, density: false }, flat: { rms: false, density: false } }
