import Waveform from '../assets/gl-waveform.js'
import Spectrogram from '../assets/gl-spectrogram.js'
import scales from './scale.js'
import { CURVES, CROSSFADES } from './ops.js'
import clock from './time.js'
import tint, { hue } from './tint.js'

// The output as a picture: the waveform or the spectrogram, one at a time. A lane per channel, apart by a gap: each
// channel reads on its own (a sound panned to one side, a different take); the caret, the playhead, a selection and the
// cues are drawn in each lane, never across the gap, which holds no sound. Levels (in dB or as sample values, `levels`)
// or frequencies on the right, each under its tick, the lowest frequency at the lane's foot; the meters just before
// them; times on the row right under the lanes (`ruler`), each label with its tick running down from them, and over
// them the times that matter now, the pointer's (where a press would take it), the caret's, a selection's, each tick
// joined to its line. Times go by the zoom's precision, a 1-2-5 step of a pixel or a little more, and read with all its
// decimals, so the script gets the numbers the view shows. Near a mark on the right (a frequency, a level) the pointer
// takes its value. The wheel scrolls, through time or through zoomed-in frequencies or levels; a pinch, or Ctrl and the
// wheel, zooms the axis under the pointer: time, the frequencies, or the levels (a quiet sound magnified, or what goes
// over full scale shown).
// One gesture, select, as in a text: a press puts the caret and sounds the moment under it, all else gone at once, a
// drag selects, a double-click the fragment around it (between the cues around it: where sounds start and end, where
// they hit, the markers), or the pause it is in, a triple-click the sound between the pauses either side; however made, a
// selection puts the caret at its start. What there is stays when a press takes it: a caret's line, any of them, or the time row (the
// caret alone moves, as Audacity's timeline) drags the caret; a range's edge, any of them, drags it, lighting when a
// press would take it, and meeting the other edge leaves a caret. The keys say how, the same everywhere, each its
// pointer: Shift sums (the selection, or the caret, extended to the press at once from where it was begun, as in a
// text, a drag going on with it; the pointer an I-beam with a chevron the way it goes). Alt adds (another caret, VS
// Code's, the one Shift then extends, or another range; dragged inside the selection, a copy of its audio, Finder's
// and Figma's Alt-drag; the pointer with a plus), and measures, as Figma's: how far the pointer is from what is
// selected. ⌘ (Ctrl) empowers what a press does: inside the selection its audio moves (Finder's ⌘-drag); a range's end
// sets its length, as its grip does; the cues light and drag, the audio either side stretching; on the spectrogram a
// press makes a box of time and frequency, a band, as Photoshop's selections; and any drag aims finely (its moves a
// quarter as far, nothing snapping).
// A pressed or dragged time goes onto a cue (shown or not) or a marker within a few pixels of it, which lights, as
// Figma's objects snap (`snapping`). A range's handles each do one thing, the range under the pointer's
// among several, say what when the pointer is on one, and a click on one turns it to its next way (`onmode`), as a
// tool's options cycle, no menu: its top corners, drawn as the fade they make, fade it (inward, from its edge; outward,
// the audio past it goes, crossfading into it; a click, the next curve); the pill on its top edge, dragged up or down,
// sets its level; the tools at its foot, side by side, a voice's pitch, intonation and formants, each dragged up or down;
// the square past its end, a square's height off each lane's foot, trims it (cut back, or silence added), stretches it
// or speeds it (a click, the next). With none, the square past the caret pulls silence open there, as trimming out
// does. None while it plays. What else shows (`show`) is grabbed where it is, never through a mode: the cues (held ⌘),
// the gain line and its points; editing pitch (`pitching`), on the spectrogram the pitch curve, dragged up or down the
// whole pitch line with it, a click on it a point of the line there, dragged, as RX's Dialogue Contour has them; on the
// waveform the pitch line itself. Holding the caret or dragging it, or an edge, hears the moment under it (`onscrub`; a box, only its band).
// What a drag does as it goes, what a handle or an edge does, is said by the pointer in the page's hints (`hint`,
// hint.js); a pitch, an intonation or formants dragged are heard as they will sound, from where they start (`onaudition`).
// The view never changes audio: edits go to the script through `onedit`.
// GAP between lanes is 2 px, as between the pictures and the meters. GUTTER holds the axis labels, the widest a
// frequency's (22.05k); STICK, how near a dragged time goes onto a cue or a marker
const GUTTER = 40, RULER = 22, GAP = 2, EDGE = 6, SNAP = 6, STICK = 3, INSET = 3
// ⌘ (Ctrl) held while dragging aims finely: the pointer's moves go a quarter as far, and nothing snaps
const FINE = .25
// A frequency's note, as a tuner says it, and how far off it is in cents, from `cents` off on (Infinity: the nearest
// note alone). Notes of equal temperament, A4 at 440 Hz, MIDI note 69 (ISO 16; MIDI 1.0)
export const NOTES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B']
export const noteOf = (f, cents = 1) => {
  const m = 69 + 12 * Math.log2(f / 440), k = Math.round(m), ct = Math.round((m - k) * 100)
  return `${NOTES[(k % 12 + 12) % 12]}${Math.floor(k / 12) - 1}${Math.abs(ct) >= cents ? `${ct > 0 ? '+' : '−'}${Math.abs(ct)}ct` : ''}`
}
// A press held this long without moving, as a touch's long press puts a text's caret (iOS's loupe): no selection, the
// caret, and the sound under it as it is dragged
export const HOLD = 500
// Pointers of their own: a stretch's arrows out from a wave, time pulled longer (the resize arrows are the edges')
const pointer = (path, hx = 12, hy = 12) => `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' width='24' height='24' fill='none' stroke-linecap='round' stroke-linejoin='round'><path d='${path}' stroke='white' stroke-width='4'/><path d='${path}' stroke='black' stroke-width='1.5'/></svg>`)}") ${hx} ${hy}`
const STRETCH = `${pointer('M5 8.5 1.5 12 5 15.5M19 8.5l3.5 3.5-3.5 3.5M5 12c1.75-4.5 5.25-4.5 7 0s5.25 4.5 7 0')}, ew-resize`
// Shift's, the I-beam with a chevron the way the selection goes out to it; Alt's, with a plus: another
const EXTEND = [`${pointer('M5 9l3 3-3 3M13 5h4M15 5v14M13 19h4', 15)}, text`, `${pointer('M19 9l-3 3 3 3M7 5h4M9 5v14M7 19h4', 9)}, text`]
const ADD = `${pointer('M7 5h4M9 5v14M7 19h4M17 13v6M14 16h6', 9)}, copy`
const mac = /Mac|iP(hone|ad|od)/.test(navigator.platform)
const LEVELS = [0, -6, -12, -24, -48, -18, -36, -30, -60, -72, 6, 12]  // dBFS the level axis marks, halvings first, where they fit
const TICK = 12                               // a tick's length on either axis, px
const MINOR = 6                               // the grid's finer steps at least this far apart, px
const VOICE = [60, 1000]                      // the pitch axis when no spectrogram shows, Hz, on a log scale
const GAIN = [-36, 12]                        // the gain line's scale, dB: the lane's centre line to its edges, 0 dB
                                              // three quarters of the way out, so a boost shows above it

export default function view(root, { onselect = () => {}, oncursor = () => {}, onedit = () => {}, onmode = () => {}, onscrub = () => {}, oncontext = () => {}, onaudition = () => {}, hint = null } = {}) {
  const layer = name => root.appendChild(Object.assign(document.createElement('canvas'), { className: name }))
  // the grid between the pictures: over the spectrogram, under the waveform
  const specCanvas = layer('spectrum'), gridCanvas = layer('grid'), waveCanvas = layer('waveform'), overlay = layer('overlay')
  // gl-waveform draws its own anti-aliased coverage; the context needs premultiplied alpha, not multisampling
  const gl = waveCanvas.getContext('webgl2', { premultipliedAlpha: true, antialias: false })
  // gl-spectrogram computes what a lane shows as it draws it, on the GPU, from the samples it holds: nothing to wait
  // for. It renders into float textures (EXT_color_buffer_float, which nearly every WebGL2 has)
  let sgl = specCanvas.getContext('webgl2', { premultipliedAlpha: true, antialias: false })
  if (!sgl?.getExtension('EXT_color_buffer_float')) sgl = null
  const c = overlay.getContext('2d'), gc = gridCanvas.getContext('2d')
  // the grid as ruled, kept while it stays where it is; the waveform as a solid shape, to cut the grid by (paintGrid)
  const ruling = document.createElement('canvas'), rc = ruling.getContext('2d'), solid = document.createElement('canvas'), sc = solid.getContext('2d')
  const style = getComputedStyle(root)
  const color = name => style.getPropertyValue(name).trim()
  let waves = [], specs = [], count = 0, rate = 44100, duration = 0, display = 'wave', scale = 'log', units = 'clock', hovered = null
  // what shows besides the sound; the pauses in it, for selecting and stepping as in a text
  let show = { hits: true, gain: true, meters: true, guides: true }, segments = { silences: [] }
  // the output's markers: [{ time, label }], a range's with its duration, flags over the lanes
  let markers = []
  // the times a marker marks: a moment, or a range's start and end
  const marked = m => m.duration ? [m.time, m.time + m.duration] : [m.time]
  // an output arriving: { total, length, dim, fit }; total samples where known, `dim` while it is the file, not the output
  let arriving = null
  // more ranges beside the selection, as a text editor's several selections: [[a, b], …], or on the spectrogram more
  // boxes, as Photoshop's several selections: [[a, b, low, high], …]; edits act on them all
  let more = []
  // where a file held over the picture would go in, or null
  let dropped = null
  // the meters at the right edge: each channel's { rms, peak } and spectrum (dB per bin of `size` at `rate` Hz), or none
  let meters = null
  // A take being recorded over the output (a tape's punch-in), or into nothing: from `at` s, its `length` samples at
  // `rate`, a waveform and a spectrogram per channel, each drawn in its picture's lanes; the output it replaces hidden,
  // the output after it where it is. The view keeps its scale and follows the take, its head held a tenth short of where
  // the lanes end, clear of the meters, as a recording app's; into nothing, RECORD s across.
  let recording = null
  const RECORD = 10
  function taking() {
    const { at, total } = recording, last = at + recording.length / recording.rate
    duration = Math.max(total, last)
    const span = end - start, head = span * .9 * lanesEnd(lanes()) / plot().w
    if (last > start + head) setRange(last - head, last - head + span, true)
    pieces = [{ s0: 0, s1: at, d0: 0, d1: at }, { s0: last, s1: total, d0: last, d1: total }].filter(p => p.s1 > p.s0)
    invalidate()
  }
  // where the take is drawn, px from the plot's left
  const takes = () => [x(recording.at), x(recording.at + recording.length / recording.rate)]
  function ended() {
    if (!recording) return
    for (const picture of [...recording.waves, ...recording.specs]) picture.destroy()
    duration = recording.total
    recording = null
    leveled = false
  }
  // The picture as an edit leaves it, before its output comes: pieces of the output as it is, each drawn where it goes
  // (a move, a copy put in, a stretch, a level while dragged; a delete, a cut, a crop once written), [{ s0, s1, d0, d1,
  // gain }] in seconds, the span it shows and the span it goes to; silence it opens, a piece at no level, drawn as a
  // waveform draws silence (`silent`, standing in for none of the output). None: the output as it is.
  let pieces = null
  // the time shown [start, end], and the part of the spectrogram's frequency axis shown, 0..1 on its scale
  let start = 0, end = 0, fview = [0, 1], selection = null, band = null, cursor = 0, playhead = null, guides = []
  let cues = [], envelope = null, shift = null, contour = null, snapping = true, fadeCurve = 'linear'
  // a pitch or an intonation a tool let go on the selection: the pitch curve shows it until the output it makes comes
  let landed = null
  // where the output clips, [[from, to], …] s: underlined red on the time row
  let clips = []
  // the sample values a waveform lane shows, bottom to top: [-1, 1] full scale; zoomed in, a part of it, scrolled up or
  // down (a quiet sound magnified); zoomed out, what goes over. And how the axis writes them: 'linear', the values, or
  // 'db', mirrored about the centre line
  let aview = [-1, 1], levelUnits = 'linear'
  // what the grip past a selection's end does to its length, chosen from a click on it: 'trim' (cut back, or silence
  // added), 'stretch' (the pitch kept) or 'speed' (the pitch following, as a tape's); and whether pitch is edited: the
  // pitch curve and the pitch line in place of the gain line (`pitchLine`)
  let gripMode = 'stretch', pitching = false
  // how the time row marks time: 'labels' with their ticks, 'ticks' alone, or 'none'; the caret's, the pointer's and a
  // selection's times show whatever it is
  let ruler = 'labels'
  // how the sound's end shows, past which the view scrolls (WORKSHOP): 'line', 'hatch', 'dots', 'ruler'
  let endMark = 'line'
  // how the lanes are ruled (WORKSHOP, paintGrid): 'marks', 'crosses', 'dots' or 'none'
  let grid = 'none'
  // the steps a selection's level goes up or down in, dB, as the pill is dragged
  let levelStep = 1
  // how the spectrogram draws, gl-spectrogram's options: its colours, its depth in dB, its FFT size
  let look = {}
  // how the waveform draws, as the lab's waveforms do (audiojs.github.io, lab/waveform): `colour` 'none', or
  // 'temperature' (its spectral centroid as the colour of light, low warm, high cool), a stretch at a time (tint.js); `lanes` 'split', a lane each channel, or 'one', every channel in one lane, each its own hue; `fill`
  // 'density' (brighter where the sound is most often), 'rms' (a lighter core as loud as its RMS) or 'flat'
  let waveLook = { colour: 'none', lanes: 'split', fill: 'density' }
  // the channels' samples the pictures hold, for their colours
  let data = []
  // `anchor`: where the selection was begun, the end Shift keeps (origin)
  let W = 0, H = 0, dpr = 1, frame = 0, leveled = false, drag = null, anchor = null
  const pointers = new Map()

  // Geometry, in CSS pixels
  const plot = () => ({ w: Math.max(1, W - GUTTER), h: Math.max(1, H - RULER) })
  const merged = () => display === 'wave' && waveLook.lanes === 'one'
  function lanes() {
    const { w, h } = plot(), n = merged() ? 1 : Math.max(1, count), lh = (h - GAP * (n - 1)) / n
    const stack = Array.from({ length: n }, (_, i) => [0, i * (lh + GAP), w, lh])
    return display === 'spec' ? { wave: [], spec: stack } : { wave: stack, spec: [] }
  }
  // the lanes' top and bottom
  const extent = rects => [Math.min(...rects.map(r => r[1])), Math.max(...rects.map(r => r[1] + r[3]))]
  // the time row, right under the lanes: its ticks run down from them, its labels beside their tops
  const row = () => plot().h + 7
  const x = t => (t - start) / (end - start || 1) * plot().w
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
  // A time dragged within STICK px of a cue or a marker goes onto it, as Figma's objects snap: where sounds start and
  // end and where they hit, whether the cues show or not; never while ⌘ aims finely. The nearest, { t, d } with its
  // distance in px, or null
  function stick(t) {
    let best = null
    if (!snapping || fine()) return best
    for (const q of [...cues, ...markers.flatMap(marked)]) {
      const d = Math.abs(x(q) - x(t))
      if (d <= STICK && (!best || d < best.d)) best = { t: q, d }
    }
    return best
  }
  const stuck = t => stick(t)?.t ?? t
  // The line edited over the sound, on its own scale in each lane: the gain curve, dB, mirrored about the centre line as
  // the waveform is (GAIN), by tenths of a dB; or, editing pitch, the pitch line, semitones, an octave up at
  // the lane's top and one down at its foot, by whole semitones (held ⌘, cents). Each snaps to 0
  const pitchLine = () => pitching
  const ly = ([, y, , lh], v, sign = 1) => y + lh / 2 - sign * (pitchLine() ? Math.max(-1, Math.min(1, v / 12)) : Math.max(0, Math.min(1, (v - GAIN[0]) / (GAIN[1] - GAIN[0])))) * lh / 2
  const valueOf = ([, y, , lh], py) => pitchLine() ? (y + lh / 2 - py) / (lh / 2) * 12 : GAIN[0] + Math.min(1, Math.abs(py - y - lh / 2) / (lh / 2)) * (GAIN[1] - GAIN[0])
  const snapV = (rect, py) => {
    const step = pitchLine() ? fine() ? .01 : 1 : .1
    return Math.abs(ly(rect, 0) - fold(rect, py)) <= SNAP ? 0 : +(Math.round(valueOf(rect, py) / step) * step).toFixed(2)
  }
  const local = event => { const r = root.getBoundingClientRect(); return [event.clientX - r.left, event.clientY - r.top] }
  const inside = ([lx, ly, lw, lh], px, py) => px >= lx && px <= lx + lw && py >= ly && py <= ly + lh
  // Frequency ↔ y within a lane: the part of the spectrogram's scale shown; with no spectrogram, the voice range the
  // pitch curve uses
  const axis = () => display === 'wave' ? scales.log : scales[scale]
  const freqs = () => display === 'wave' ? VOICE : [scales[scale].low, rate / 2]
  const shown = () => display === 'wave' ? [0, 1] : fview
  const fy = ([, y, , lh], f, [lo, hi] = freqs(), [u0, u1] = shown()) => y + lh - (axis().at(Math.max(lo, f), lo, hi) - u0) / (u1 - u0) * lh
  const uy = ([, y, , lh], py, [u0, u1] = shown()) => u0 + (y + lh - py) / lh * (u1 - u0)
  const yf = (rect, py, [lo, hi] = freqs()) => axis().of(uy(rect, py), lo, hi)
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

  // A canvas resized is blank until drawn again, and the browser shows what is there at the next paint: drawn here,
  // in the resize callback before that paint, a divider dragged never flashes an empty picture. Where the view starts
  // and its scale stay: a panel opening beside it, or the window narrowing, shows less of the sound, never squeezes it.
  function resize() {
    const r = root.getBoundingClientRect(), d = devicePixelRatio || 1, cw = Math.round(r.width * d), ch = Math.round(r.height * d), was = plot().w
    W = r.width; H = r.height; dpr = d
    if (duration && W > GUTTER + 1 && was > 1 && plot().w !== was) setRange(start, start + (end - start) / was * plot().w)
    for (const canvas of [specCanvas, gridCanvas, waveCanvas, overlay, ruling, solid]) if (canvas.width !== cw || canvas.height !== ch) { canvas.width = cw; canvas.height = ch }
    cancelAnimationFrame(frame)
    frame = 0; pictures = true
    render()
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
  // it), `db` louder; or gone (remove, cut), or all that stays (crop); or, silence opened at a until `to` (insert), what
  // was after it after that. Silence an edit opens is drawn by the pictures from samples there are at this level: as a
  // waveform draws silence, its centre line; as a spectrogram does, nothing
  const SILENT = 1e-6
  function arrange(kind, a, b, to = a, db = 0) {
    const T = duration, d = b - a, g = 10 ** (db / 20)
    const run = (list, at = 0) => list.filter(([s0, s1]) => s1 > s0).map(([s0, s1, gain = 1]) => { const p = { s0, s1, d0: at, d1: at + s1 - s0, gain }; at = p.d1; return p })
    const silent = (d0, d1) => ({ s0: 0, s1: Math.min(T, d1 - d0), d0, d1, gain: SILENT, silent: true })
    if (kind === 'move') return [...carve([...run([[0, a]]), silent(a, b), ...run([[b, T]], b), ...to > T ? [silent(T, to)] : []], to, to + d), { s0: a, s1: b, d0: to, d1: to + d, gain: 1 }]
    if (kind === 'copy') return run([[0, to], [a, b], [to, T]])
    if (kind === 'stretch') return [...run([[0, a]]), { s0: a, s1: b, d0: a, d1: to, gain: g }, ...run([[b, T]], to)]
    if (kind === 'gain') return run([[0, a], [a, b, g], [b, T]])
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
  const SHADES = { none: 0, dim: .45, full: 1 }
  let shade = 'none'
  function light(name) {
    if (name === shade) return
    shade = name
    for (const canvas of [specCanvas, gridCanvas, waveCanvas]) canvas.style.opacity = SHADES[name]
    overlay.style.opacity = +(name !== 'none')
  }
  // A frame: the pictures when they changed, the overlay always; the pointer's readout redraws only the overlay
  let pictures = false
  function invalidate(overlay = false) { pictures ||= !overlay; frame ||= requestAnimationFrame(render) }
  function render() {
    frame = 0
    const L = lanes(), from = start * rate, to = end * rate
    light(recording || data.length || arriving?.length ? arriving?.dim ? 'dim' : 'full' : 'none')
    // the grid ruled anew (a zoom, the level axis' units) draws the pictures again, as it is cut by the waveform drawn
    if (gridKey(L) !== ruled) pictures = true
    if (!pictures) return paint(L)
    pictures = false
    if (gl) {
      // the whole canvas cleared, whatever scissor a lane's drawing left: two renders in a task (snapshot) see no frame between
      gl.disable(gl.SCISSOR_TEST)
      gl.viewport(0, 0, waveCanvas.width, waveCanvas.height)
      gl.clearColor(0, 0, 0, 0)
      gl.clear(gl.COLOR_BUFFER_BIT)
      // the canvas's own device-to-CSS ratio, exact after rounding its size
      const ratio = waveCanvas.width / (W || 1)
      waves.forEach((wave, i) => {
        const rect = L.wave[merged() ? 0 : i]
        if (!rect) return
        if (!pieces) return drawWave(wave, i, rect, from, to, 0, rect[2], aview, ratio)
        for (const p of spans()) drawWave(wave, i, rect, p.from, p.to, p.x0, p.x1, aview.map(v => v / p.gain), ratio)
      })
      // a take being recorded, where it goes: its own waveform over what it replaces, drawn as the output's is
      if (recording?.length) waves.forEach((_, i) => {
        const c = Math.min(i, recording.waves.length - 1), rect = L.wave[merged() ? 0 : i], [x0, x1] = takes()
        if (rect && x1 > x0) drawWave(recording.waves[c], i, rect, 0, recording.length, x0, x1, aview, ratio, { x: recording.data[c].subarray(0, recording.length), rate: recording.rate, id: `take ${c}` })
      })
    }
    if (sgl) spectrograms(L, from, to)
    paintGrid(L)
    paint(L)
  }
  // A channel's waveform over [x0, x1) of its lane, samples [from, to): in its colour, or coloured for what it holds
  // (tint.js), a colour every 4 to 8 px, on a grid of the sound's own samples, so the colours stay put as the view
  // scrolls; where it is silent, its own colour. The samples are the output's, or a take's (`src`); a stretch not yet
  // whole is coloured again each time, as a take fills it
  const tints = new Map()
  function drawWave(wave, i, rect, from, to, x0, x1, amplitude, pixelRatio, src = { x: data[i], rate, id: i }) {
    const at = (a, b, p, q) => wave.update({ range: [a, b], viewport: [rect[0] + p, rect[1], q - p, rect[3]], pixelRatio, amplitude }).render()
    wave.update({ ...FILLS[waveLook.fill] ?? FILLS.density, color: hues[i] })
    if (waveLook.colour === 'none' || arriving || !src.x || x1 - x0 < 1 || to <= from) return at(from, to, x0, x1)
    const spp = (to - from) / (x1 - x0), len = 2 ** Math.max(4, Math.ceil(Math.log2(spp * 4)))
    if (tints.size > 2e4) tints.clear()
    for (let k = Math.floor(from / len); k * len < to; k++) {
      const a = Math.max(from, k * len), b = Math.min(to, (k + 1) * len), key = `${src.id} ${len} ${k}`
      let c = tints.get(key)
      if (c === undefined) { c = tint(waveLook.colour, src.x, k * len, (k + 1) * len, src.rate); if ((k + 1) * len <= src.x.length) tints.set(key, c) }
      wave.update({ color: c ?? hues[i] })
      at(a, b, x0 + (a - from) / spp, x0 + (b - from) / spp)
    }
  }

  // Each channel's spectrogram in its lane, the part of its scale shown; an edit's pieces each where it goes, at its
  // level. One scale of levels for the lanes, the loudest channel's, so channels compare as they sound (each its own
  // while an output arrives); a take's channels among them as it comes, so it shows as the output holding it will.
  // Zoomed out, a render leaves columns short of frames: it draws again until they are whole.
  function spectrograms(L, from, to) {
    sgl.disable(sgl.SCISSOR_TEST)
    sgl.viewport(0, 0, specCanvas.width, specCanvas.height)
    sgl.clearColor(0, 0, 0, 0)
    sgl.clear(sgl.COLOR_BUFFER_BIT)
    if (!L.spec.length) return
    const [lo, hi] = freqs(), band = fview.map(u => scales[scale].of(u, lo, hi)), ratio = specCanvas.width / (W || 1)
    const all = [...specs, ...recording?.specs ?? []]
    for (const sg of all) sg.update({ scale, band, pixelRatio: ratio })
    if (!leveled && !arriving && all.length) {
      const loudest = all.map(sg => sg.update({ levels: null }).levels).reduce((a, b) => b[1] > a[1] ? b : a)
      for (const sg of all) sg.update({ levels: loudest })
      leveled = true
    }
    specs.forEach((sg, i) => {
      const rect = L.spec[i]
      if (!rect) return
      if (!pieces) return sg.update({ range: [from, to], viewport: rect, gain: 1 }).render()
      for (const p of spans()) sg.update({ range: [p.from, p.to], viewport: [rect[0] + p.x0, rect[1], p.x1 - p.x0, rect[3]], gain: p.gain }).render()
    })
    // a take being recorded, where it goes: its own spectrogram over what it replaces
    if (recording?.length) L.spec.forEach((rect, i) => {
      const sg = recording.specs[Math.min(i, recording.specs.length - 1)], [x0, x1] = takes()
      if (sg && x1 > x0) sg.update({ range: [0, recording.length], viewport: [rect[0] + x0, rect[1], x1 - x0, rect[3]] }).render()
    })
    if (all.some(sg => sg.pending)) invalidate()
  }

  // The picture as a PNG data URL, for an agent to look at: the waveform over the spectrogram, each with its rulers, of
  // [a, b] s (what shows, else), at most `width` px across. Drawn, read and put back in one task: the screen never shows it
  function snapshot(range, width = 1200) {
    const was = { start, end, display, hovered }, modes = sgl ? ['wave', 'spec'] : ['wave']
    if (range) { start = Math.max(0, range[0]); end = Math.max(start + 32 / rate, range[1]) }
    hovered = null
    const k = Math.min(1, width / overlay.width), w = Math.round(overlay.width * k), h = Math.round(overlay.height * k)
    const shot = Object.assign(document.createElement('canvas'), { width: w, height: h * modes.length }), g = shot.getContext('2d')
    g.fillStyle = color('--color-screen')
    g.fillRect(0, 0, w, shot.height)
    modes.forEach((mode, i) => {
      display = mode
      // a spectrogram zoomed out fills its columns over several renders (spectrograms)
      for (let n = 0; n < 64 && (!n || specs.some(sg => sg.pending)); n++) { pictures = true; render() }
      for (const canvas of [specCanvas, gridCanvas, waveCanvas, overlay]) g.drawImage(canvas, 0, i * h, w, h)
    })
    ;({ start, end, display, hovered } = was)
    cancelAnimationFrame(frame)
    pictures = true
    render()
    return shot.toDataURL('image/png')
  }

  // The overlay: selection, guides, what shows besides the sound, caret, playhead, the pointer's readouts, axes. What a
  // drag, a handle or an edge does is said in the page's hints, by the pointer (say), and goes when nothing says it.
  let said = false
  const self = {}
  function say(text, px, py, align = 'left') {
    const r = root.getBoundingClientRect()
    hint?.show(text, { x: r.left + px, y: r.top + py }, self, align)
    said = true
  }
  function paint(L) {
    said = false
    overlayOf(L)
    if (!said) hint?.hide(self)
  }
  function overlayOf(L) {
    const { w, h } = plot()
    c.setTransform(dpr, 0, 0, dpr, 0, 0)
    c.clearRect(0, 0, W, H)
    if (!duration) return
    c.font = `10px ${color('--font-mono')}`
    c.textBaseline = 'middle'
    const all = [...L.wave, ...L.spec], dim = color('--color-screen-dim')
    // what runs through time is drawn in each lane, never across the gap between two, which holds no sound
    const across = (px, width) => { for (const [, y, , lh] of all) c.fillRect(px, y, width, lh) }
    // selection: a time range in every lane, or a box on the spectrogram
    // a crossfade dragged out of a range's start takes what is before it out: the range goes back by as much
    const back = drag?.cross && drag.fade === 'in' ? drag.span[1] - drag.span[0] : 0
    const sel = drag?.carry && drag.moved && !drag.out ? [drag.to, drag.to + drag.b - drag.a] : drag?.stretch ? [drag.a, drag.to] : back ? [drag.a - back, drag.b - back] : selection
    paintSelection(L, sel)
    paintEnd(L)
    if (show.guides) for (const guide of guides) paintGuide(guide, L)
    // a fade as it is dragged, the waveform under it drawn faded; a crossfade, its two curves across the seam
    if (drag?.span && drag.cross) { const [p, q] = drag.span, h = half(p, q); paintGuide({ ramps: [[p - h, p + h, 'out', 'equal'], [p - h, p + h, 'in', 'equal']] }, L) }
    else if (drag?.span) paintGuide({ ramps: [[...drag.span, drag.fade, fadeCurve]] }, L)
    // the pointer, read out on the axes: its time on the time row, as the script will get it (a dragged edge's, a snapped
    // one's), the labels there giving way to it; its level or frequency by its lane
    const at = hovered && hovered[0] >= 0 && hovered[0] <= w ? hovered : null, lane = at && all.find(r => inside(r, ...at))
    const pointed = at && (drag?.span ? drag.p : drag?.stretch ? drag.to : drag?.hear ?? stuck(snap(time(at[0]))))
    // the times on the row, each tick the colour of the line it runs on from: an edge lit (`hot`, or dragged) bright
    const caret = color('--color-screen-caret'), bright = color('--color-screen-bright')
    const litEdge = drag?.resizing && sel ? sel[sel[0] === drag.anchor ? 1 : 0] : !drag && hot ? hot.t : null
    const edges = sel && !drag?.span ? sel.map((t, edge) => ({ t, fill: t === litEdge ? bright : caret, edge, of: sel })) : []
    // the pointer's time, or the caret's, where an edge is: the edge's, which says as much
    const apart = t => !edges.some(m => Math.round(x(m.t)) === Math.round(x(t)))
    paintRuler([
      ...(at && apart(pointed) ? [{ t: pointed, fill: caret }] : []),
      ...edges,
      ...(playhead != null ? [{ t: playhead, fill: bright }] : apart(cursor) ? [{ t: cursor, fill: caret }] : []),
      ...(dropped != null ? [{ t: dropped, fill: accent() }] : [])
    ])
    // a file held over the picture: where it goes in, a caret of its own, as a text editor shows where a drop lands
    if (dropped != null) { c.fillStyle = accent(); across(Math.round(x(dropped)), 2); c.font = `10px ${color('--font-mono')}`; tag('Insert here', Math.round(x(dropped)) + 6, extent(all)[0] + 8, 'left', accent()) }
    // the times a drag's edges are at, or the caret dragged: the cues and markers they sit on light
    const lit = drag?.caret ? [cursor] : drag?.anchor != null || drag?.carry || drag?.stretch ? sel || [] : drag?.span || []
    if (show.hits) paintCues(all, lit)
    paintMarkers(all, lit)
    paintOvers(L)
    // what is edited over the sound: its level (the gain line) or, editing pitch, its pitch (the pitch line on the
    // waveform, the pitch curve on the spectrogram)
    if (pitchLine()) { paintLine(L.wave); paintContour(L.spec) }
    else if (show.gain && (envelope || drag?.points)) paintLine(ampLanes(L))
    // a line in each lane: the caret (and the others beside it), or while it plays the playhead, which is the caret
    // moving; while an output arrives, where it has come to
    // moving; while an output arrives, where it has come to. With a band selected on the spectrogram, the caret and the
    // playhead run through the band alone, which is what plays
    const line = (t, fill, only = null) => {
      const px = Math.round(x(t))
      if (px < 0 || px > w) return
      c.fillStyle = fill
      if (!only) return across(px, 1)
      for (const rect of L.spec) { const y0 = Math.max(rect[1], fy(rect, only[1])), y1 = Math.min(rect[1] + rect[3], fy(rect, only[0])); c.fillRect(px, y0, 1, y1 - y0) }
    }
    if (arriving) line(arriving.length / rate, color('--color-screen-soft'))
    if (playhead != null) line(playhead, color('--color-screen-bright'), band)
    else line(cursor, caret, band)
    for (const r of more) if (r.length === 2 && r[0] === r[1]) line(r[0], caret)
    endLanes(L)
    paintGrips(L, at)
    paintEdge(L, sel)
    if (at && lane && held.altKey && !drag) paintMeasure(at)
    // a selection's edge under the pointer says which it is and where
    if (at && lane && hot && !drag) {
      const { t, edge } = hot, text = `${!edge ? 'Start' : editing(held) ? `${gripName('stretch')}, end` : 'End'} ${stamp(t)}`, ex = Math.round(x(t))
      say(text, edge ? ex - 6 : ex + 6, clampY(lane, at[1]), edge ? 'right' : 'left')
    }
    if (meters && show.meters) paintMeters(L)
    // right axis: levels by the waveform, frequencies by the spectrogram (or the voice range for pitch), each label
    // under its tick
    c.textAlign = 'left'
    const near = rect => rect === lane ? Math.round(at[1]) : null
    for (const rect of L.wave) ticks(rect, levelMarks(rect), near(rect))
    for (const rect of L.spec) ticks(rect, hzMarks(rect), near(rect))
    // the pointer's values; what a drag does, in a few words by it
    c.textAlign = 'left'
    // what a drag does, by the pointer wherever it is: past the picture's edge too, where silence is pulled out to
    const doing = drag && hovered && acting()
    if (doing) say(doing, hovered[0] + 12, hovered[1] - 16)
    // the pointer's frequency or level under its tick, as the axis has them, its tick the caret's
    if (at && lane) {
      const ly = Math.round(at[1]), text = pitched(lane, L) ? hertz(snapF(lane, at[1])) : level(lane, at[1])
      c.fillStyle = caret
      c.fillRect(w + 1, ly, TICK, 1)
      tag(text, w + 1, ly + 9, 'left')
    }
  }
  // What is drawn in the lanes (a selection, the cues, the pitch curve, the caret) ends where the pictures do (editor.css,
  // --end): before the labels, or 2 px before the meters when they show, a waveform's bar or a spectrogram's spectrum,
  // never behind them. The meters keep their width from the first frame, whether they read anything yet or not, so a
  // sound arriving never shortens the pictures under it
  const lanesEnd = L => { const { w } = plot(); return show.meters ? (L.spec.length ? w - METER - 2 : w - 7) - 2 : w }
  let ends = null
  function endLanes(L) {
    const { w } = plot(), end = lanesEnd(L)
    if (W - end !== ends) { ends = W - end; root.style.setProperty('--end', `${ends}px`) }
    c.save()
    c.globalCompositeOperation = 'destination-out'
    c.fillStyle = '#000'
    for (const [, y, , lh] of [...L.wave, ...L.spec]) c.fillRect(end, y, w - end, lh)
    c.restore()
  }
  // A time range's handles, each clicked or dragged to do one thing, where the range is wide enough for them: in its top
  // corners the fade each makes, a small square with the fade's curve in it as the fade menu draws it; the pill on its
  // top edge its level; at its foot, side by side, the tools of a voice in it (TOOLS): its pitch, its intonation, its
  // formants; a square with ↔ just past its end its length, from the end only. With several ranges, the one under the pointer has them. With none, at the caret (the one under the pointer),
  // a square pulls silence open. [kind, x, y] each, a square's x and y its centre; a fade being dragged stays under the
  // pointer, where it reaches.
  const BOX = 16, TOOLS = ['pitch', 'intonation', 'formant']
  // the range, or the caret, the handles are for: the one the pointer is on or by among several, else the selection's
  function handled() {
    if (drag || !hovered) return selection ? [...selection] : [cursor, cursor]
    const t = time(hovered[0]), by = (BOX + INSET + 4) * (end - start) / plot().w
    const all = [...(selection && !band ? [selection] : !selection ? [[cursor, cursor]] : []), ...more.filter(r => r.length === 2)]
    return all.find(([p, q]) => t >= p - by && t <= q + by) ?? (selection ? [...selection] : [cursor, cursor])
  }
  function grips(L) {
    const all = [...L.wave, ...L.spec], [top, bottom] = extent(all), h = BOX / 2
    // each square on whole pixels, so crisp at any pixel ratio, notched: flush with the top and with the line it sits by,
    // never over it: the caret's, which a range's start has (a pixel wide, its first); a range's end, its last pixel,
    // lit only as it would move, then drawn over the square (paintEdge)
    // in each lane, a square's height off its foot: off the middle, where the sound is, and away from the fades at the
    // top; low, as others stretch from low (Audacity's clip handles: the top pair trims, the lower pair, a clock on it,
    // sets the speed; Cubase and Nuendo stretch from an event's lower corners). By the square's left
    const lower = left => all.map(([, y, , lh]) => [left + h, Math.round(y + lh - BOX * 1.5)])
    if (band || playhead != null || drag?.carry || drag?.stretch || drag?.lift || drag?.pill) return []
    const [a, b] = handled(), xa = Math.round(x(a)), xb = Math.round(x(b)), out = []
    // a caret: silence to pull open where the grip would be, a stretch of nothing; at the end, where there is no room
    // past it, before it
    if (a === b) {
      const at = Math.round(x(drag?.gap ? drag.to : a)), left = at + 1 + BOX <= lanesEnd(L) ? at + 1 : at - BOX
      return duration && (!drag || drag.gap) && at >= 0 && left >= 0 ? lower(left).map(p => ['gap', ...p]) : []
    }
    if (drag && !drag.fade) return []
    const fade = kind => drag?.fade === kind && drag.span ? Math.round(x(drag.p)) : kind === 'in' ? xa : xb
    if (xb - xa >= 2 * (BOX + INSET) + 8) out.push(['in', fade('in') + 1 + h, top + h], ['out', fade('out') - h, top + h])
    if (xb - xa >= 72 && !drag?.fade) out.push(['level', (xa + xb) / 2, top + 4], ...TOOLS.map((kind, i) => [kind, Math.round((xa + xb) / 2) + (i - 1) * (BOX + 2), bottom - h]))
    if (xb - xa >= 20 && !drag?.fade) out.push(...lower(xb).map(p => ['stretch', ...p]))
    return out.filter(([, gx]) => gx >= 0 && gx <= plot().w)
  }
  // a grip within reach of the pointer: a square and a little round it, the pill its shape, a tool its square alone
  const reachOf = kind => kind === 'level' ? [-16, 16, -7, 7] : TOOLS.includes(kind) ? [-BOX / 2, BOX / 2, -BOX / 2, BOX / 2] : [-BOX / 2 - 2, BOX / 2 + 2, -BOX / 2 - 2, BOX / 2 + 2]
  const gripAt = (L, px, py) => grips(L).find(([k, gx, gy]) => { const [x0, x1, y0, y1] = reachOf(k); return px - gx >= x0 && px - gx <= x1 && py - gy >= y0 && py - gy <= y1 })
  // what each does, as its way is now (a click on it turns it to the next)
  const CURVE_WORDS = { linear: 'linear', exp: 'exponential', log: 'logarithmic', cos: 'S-curve' }
  // the pill's level in steps; the pitch in semitones, from the note the range has where the pitch curve has one
  const gripName = kind => ({ in: `Fade in, ${CURVE_WORDS[fadeCurve]}`, out: `Fade out, ${CURVE_WORDS[fadeCurve]}`, level: `Level, by ${levelStep}dB`, pitch: pitchName(), intonation: 'Intonation, wider or flatter', formant: 'Formants, by semitones', stretch: { trim: 'Trim', stretch: 'Stretch', speed: 'Speed' }[gripMode], gap: 'Insert silence' })[kind]
  const pitchName = () => { const f = selection && median({ at: selection[0], duration: selection[1] - selection[0] }); return `Pitch${f ? ` ${noteOf(f)}` : ''}, by semitones` }
  const gripPointer = kind => kind === 'level' || TOOLS.includes(kind) ? 'ns-resize' : kind === 'stretch' && gripMode !== 'trim' ? STRETCH : 'ew-resize'
  // Dark squares with no rim, each glyph in its own, soft lines on the screen's colour so they show over the waveform;
  // the one under the pointer, or dragged, bright, and it says what it does
  function paintGrips(L, at) {
    const list = grips(L), under = at && !drag && gripAt(L, ...at), busy = drag?.fade ?? (drag?.stretch ? 'stretch' : drag?.lift ? 'level' : drag?.gap ? 'gap' : null)
    const [top, bottom] = extent([...L.wave, ...L.spec]), h = BOX / 2
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
      else if (kind === 'pitch') { c.moveTo(gx, gy - 5); c.lineTo(gx, gy + 5); c.moveTo(gx - 2.5, gy - 2.5); c.lineTo(gx, gy - 5); c.lineTo(gx + 2.5, gy - 2.5); c.moveTo(gx - 2.5, gy + 2.5); c.lineTo(gx, gy + 5); c.lineTo(gx + 2.5, gy + 2.5) }
      else if (kind === 'intonation') for (let i = 0; i <= 12; i++) c.lineTo(gx - 6 + i, gy - (1 + 4 * i / 12) * Math.sin(Math.PI * i / 3))
      else if (kind === 'formant') { c.moveTo(gx - 6, gy + 4); c.quadraticCurveTo(gx - 3, gy - 6, gx, gy + 4); c.quadraticCurveTo(gx + 3, gy - 6, gx + 6, gy + 4) }
      // trim, as Audacity's: a play triangle into a bracket, the end it moves; silence opened at a caret is trimming out
      else if (kind === 'gap' || gripMode === 'trim') { c.moveTo(gx - 5, gy - 4); c.lineTo(gx, gy); c.lineTo(gx - 5, gy + 4); c.closePath(); c.moveTo(gx + 2, gy - 5); c.lineTo(gx + 5, gy - 5); c.lineTo(gx + 5, gy + 5); c.lineTo(gx + 2, gy + 5) }
      // speed, as Audacity's: a clock
      else if (gripMode === 'speed') { c.arc(gx, gy, 5, 0, 2 * Math.PI); c.moveTo(gx, gy); c.lineTo(gx, gy - 3); c.moveTo(gx, gy); c.lineTo(gx + 2.5, gy) }
      // stretch: a double arrow
      else { c.moveTo(gx - 5, gy); c.lineTo(gx + 5, gy); c.moveTo(gx - 2.5, gy - 2.5); c.lineTo(gx - 5, gy); c.lineTo(gx - 2.5, gy + 2.5); c.moveTo(gx + 2.5, gy - 2.5); c.lineTo(gx + 5, gy); c.lineTo(gx + 2.5, gy + 2.5) }
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
  // colour of its edges (red at full scale); by a spectrogram, the spectrum's outline, its level across (-90 to 0 dB),
  // each frequency at its height in the lane, a gradient under it, the band selected in it lit
  const METER = 40
  function paintMeters(L) {
    const { w } = plot(), bar = w - 7
    L.wave.forEach((rect, i) => {
      // in one lane, the loudest channel's
      const m = merged() ? meters.levels?.reduce((p, q) => q.peak > p.peak ? q : p) : meters.levels?.[i] ?? meters.levels?.[0]
      if (!m) return
      const [top, low, bottom] = [ay(rect, m.peak), ay(rect, m.rms), ay(rect, m.peak, -1)], high = ay(rect, m.rms, -1)
      c.fillStyle = m.peak >= 1 ? color('--color-screen-error') : color('--color-screen-wave')
      c.globalAlpha = .4
      c.fillRect(bar, top, 3, low - top)
      c.fillRect(bar, high, 3, bottom - high)
      c.globalAlpha = 1
      c.fillStyle = color('--color-screen-wave')
      c.fillRect(bar, low, 3, high - low)
    })
    const bins = meters.spectra, size = meters.size, left = w - METER - 2
    if (!bins) return
    L.spec.forEach((rect, i) => {
      const db = bins[i] ?? bins[0], [, y, , lh] = rect, outline = new Path2D()
      outline.moveTo(left, y + lh)
      for (let py = y + lh; py >= y; py -= 2) {
        const k = yf(rect, py) / (meters.rate / size), k0 = Math.floor(k), f = k - k0
        const v = (db[k0] ?? -200) * (1 - f) + (db[k0 + 1] ?? -200) * f
        outline.lineTo(left + Math.max(0, Math.min(1, (v + 90) / 90)) * METER, py)
      }
      outline.lineTo(left, y)
      // filled under the outline down to the floor, brighter toward the loud end, as a level fills a meter
      const fill = c.createLinearGradient(left, 0, left + METER, 0), soft = color('--color-screen-soft')
      fill.addColorStop(0, 'transparent')
      fill.addColorStop(1, soft)
      c.globalAlpha = .22
      c.fillStyle = soft
      c.fill(outline)
      c.globalAlpha = .45
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
  // What a drag does, in a few words by the pointer
  function acting() {
    const d = drag, st = v => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(1)}`
    if (d.carry && d.moved) return d.out ? `${d.carry} to a tab of its own` : `${d.carry} to ${stamp(d.to)}`
    if (d.stretch && d.mode === 'trim') return d.to < d.b ? `trim ${stamp(d.b - d.to)}` : `silence ${stamp(d.to - d.b)}`
    if (d.stretch) return `${d.mode} ×${((d.to - d.a) / (d.b - d.a)).toFixed(3)}, ${stamp(d.to - d.a)}`
    if (d.gap) return `silence ${stamp(d.to - d.at)}`
    if (d.lift === 'gain') return `${st(d.db)}dB`
    // the pitch curve, before the points it moves: how far, the note of the stretch pressed from and to, all of it moving
    if (d.run) return `${pitchSays(d.st, median(pitchRange(d)))}, all of it`
    // a point of the line: its value, as the line writes it; one on the pitch curve, the note it goes from and to
    if (d.points) { const [t, v] = d.points[d.index]; return d.line === 'pitchline' ? pitchSays(v, d.hz, d.hz && toneAt(t)) : `${st(v)}dB` }
    if (d.lift === 'pitch') return pitchSays(d.st, median(pitchRange(d)))
    if (d.lift === 'intonation') return intonationSays(d)
    if (d.lift === 'formant') return `formants ${semis(d.st)}`
    if (d.span) return `${d.cross ? 'crossfade' : `fade ${d.fade}`} ${stamp(d.span[1] - d.span[0])}`
    // a range as it is made or resized: how long it is
    if ((d.resizing || d.anchor != null && !d.caret) && d.moved && selection) return stamp(selection[1] - selection[0])
    return ''
  }
  // A pitch dragged, or formants: in whole semitones, as a keyboard has them; held ⌘, in cents
  const semitones = ratio => { const st = 12 * Math.log2(ratio); return fine() ? Math.round(st * 100) / 100 : Math.round(st) }
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
  const semis = st => { const whole = Math.trunc(st), ct = Math.round(Math.abs(st - whole) * 100); return `${st > 0 ? '+' : st < 0 ? '−' : ''}${Math.abs(whole)}st${ct ? ` ${ct}ct` : ''}` }
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
  function room([, y, , lh], list, placed = [], gap = 16) {
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
    for (const [ly, text] of room(rect, list, taken == null ? [] : [taken])) {
      const ty = Math.round(ly)
      c.fillStyle = color('--color-screen-rule')
      c.fillRect(w + 1, ty, TICK, 1)
      c.fillStyle = color('--color-screen-dim')
      c.fillText(text, w + 1, ty + 9)
    }
  }
  // Frequencies, no unit (the axis is plainly hertz): the lowest the lane shows first, at its foot; then the roundest
  const hzMarks = rect => { const [, y, , lh] = rect; return [[y + lh, hertz(yf(rect, y + lh))], ...marks().map(f => [fy(rect, f), hertz(f)])] }
  // Levels within the values a lane shows, the most telling first: as sample values, 0 and full scale, then 1-2-5 steps
  // of what shows; in dB, mirrored about 0 and clear of it, the halvings first, the top's 0 with its unit
  function levelMarks(rect) {
    const [lo, hi] = aview, within = v => v >= lo - 1e-9 && v <= hi + 1e-9
    if (levelUnits === 'linear') return [...new Set([0, 1, -1, ...multiples(lo, hi, valueStep())])].filter(within).map(v => [ay(rect, v), linear(v)])
    const zero = ay(rect, 0)
    return LEVELS.flatMap(db => [1, -1].map(sign => [sign * 10 ** (db / 20), db, sign])).filter(([v]) => within(v) && Math.abs(ay(rect, v) - zero) >= 16)
      .map(([v, db, sign]) => [ay(rect, v), db ? `${db > 0 ? '+' : '−'}${Math.abs(db)}` : sign > 0 ? '0dB' : '0'])
  }
  const linear = v => v ? `${v < 0 ? '−' : ''}${+Math.abs(v).toPrecision(3)}` : '0'
  // the 1-2-5 step the sample values are marked by, four or so across what a lane shows
  const valueStep = () => nice((aview[1] - aview[0]) / 4)
  // the multiples of `step` in [a, b], clear of float error
  const multiples = (a, b, step) => { const out = []; for (let k = Math.ceil(a / step - 1e-9); k * step <= b + 1e-9; k++) out.push(+(k * step).toPrecision(12)); return out }
  // The finer step between marks `step` apart, at `ppu` px a unit, for the grid's dots: a fifth (a quarter of a 2), else
  // a half, as long as they are MINOR px apart
  const finer = (step, ppu) => [step / (Math.round(step / 10 ** Math.floor(Math.log10(step))) === 2 ? 4 : 5), step / 2].find(s => s * ppu >= MINOR)
  // The finer steps between a lane's marks, [y] each, for the grid's dots: sample values by their finer step (0.1, 0.2, …
  // between 0, 0.5 and 1); decibels every 3 dB from the top in, till they crowd towards the centre line; frequencies by
  // decades as log paper has them, 1 to 9 of each, roundest first, or where the marks go in even steps (a linear axis, a
  // narrow span zoomed in, as marks() has them) by their finer step
  function fineMarks(rect) {
    const lh = rect[3]
    if (display === 'spec') {
      const [lo, hi] = freqs(), [fa, fb] = fview.map(u => scales[scale].of(u, lo, hi)), whole = fview[1] - fview[0] > .999
      const even = scale === 'lin' ? whole ? 5000 : nice((fb - fa) / 6) : !whole && fb / fa <= 3 ? nice((fb - fa) / 6) : 0
      if (even) { const step = finer(even, lh / (fb - fa)); return step ? multiples(fa, fb, step).map(f => [fy(rect, f)]) : [] }
      return [1, 5, 2, 3, 4, 6, 7, 8, 9].flatMap(m => [1e4, 1e3, 100, 10].map(p => m * p)).filter(f => f >= fa && f <= fb).map(f => [fy(rect, f)])
    }
    const [lo, hi] = aview, ppu = lh / (hi - lo)
    if (levelUnits === 'linear') { const step = finer(valueStep(), ppu); return step ? multiples(lo, hi, step).map(v => [ay(rect, v)]) : [] }
    const out = []
    for (let db = 12; (10 ** (db / 20) - 10 ** ((db - 3) / 20)) * ppu >= MINOR; db -= 3) for (const v of [10 ** (db / 20), -(10 ** (db / 20))]) if (v >= lo && v <= hi) out.push([ay(rect, v)])
    return out
  }
  // Frequencies to mark, roundest first: the scale's own when all of it shows; zoomed in, the round values in view,
  // 1-2-5 per decade across a wide span, even steps across a narrow one
  function marks() {
    if (display === 'wave') return [1000, 500, 200, 100]
    const [lo, hi] = freqs(), [fa, fb] = fview.map(u => scales[scale].of(u, lo, hi))
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
  // The level at y in a lane, as the axis writes it; near a mark, the mark's
  function level(rect, py) {
    const mark = levelMarks(rect).find(([ly]) => Math.abs(ly - py) <= SNAP)
    if (mark) return levelUnits === 'db' && mark[1] !== '0dB' ? `${mark[1]}dB` : mark[1]
    const a = ya(rect, py)
    if (levelUnits === 'linear') return linear(+a.toPrecision(2))
    const v = 20 * Math.log10(Math.abs(a))
    return v > -99 ? `${v < 0 ? '−' : '+'}${Math.abs(v).toFixed(1)}dB` : '−∞dB'
  }
  // Held Alt, how far the pointer is from what is selected, or from the caret, as Figma's Alt measures: a helper line at
  // the pointer's height from the nearer edge to it, its length over it; none inside the selection
  function paintMeasure(at) {
    const [a, b] = selection ?? [cursor, cursor], t = stuck(snap(time(at[0]))), from = t > b ? b : t < a ? a : null
    const p = from == null ? 0 : Math.round(x(from)), q = Math.round(x(t)), y = Math.round(at[1])
    if (from == null || Math.abs(q - p) < 12) return
    c.fillStyle = accent()
    c.fillRect(Math.min(p, q), y, Math.abs(q - p), 1)
    c.fillRect(p, y - 3, 1, 7)
    tag(stamp(Math.abs(t - from)), (p + q) / 2, y - 10, 'center', accent())
  }
  // A value by the pointer, on a patch of the screen so the labels under it give way
  function tag(text, px, py, align, fill = color('--color-screen-bright')) {
    const tw = c.measureText(text).width
    if (align === 'center') px = Math.max(tw / 2 + 3, Math.min(plot().w - tw / 2 - 3, px))
    const left = align === 'center' ? px - tw / 2 : px
    c.fillStyle = color('--color-screen')
    c.fillRect(left - 3, py - 7, tw + 6, 14)
    c.fillStyle = fill
    c.textAlign = align
    c.fillText(text, px, py)
  }
  const accent = () => color('--color-screen-accent')
  // What a step sets, as hints over the output, never over the sound itself (`show.guides`): its range a bar on the time
  // row, as a DAW's ruler marks a region; a level, its fades' ramps, a time, a frequency, a band, the notes it tunes to
  function paintGuide(g, L) {
    // its words end where the lanes' pictures do, clear of the meters
    const { h } = plot(), all = [...L.wave, ...L.spec], end = lanesEnd(L)
    c.strokeStyle = c.fillStyle = accent()
    c.lineWidth = 1
    if (g.range && !g.band) {
      const a = Math.round(x(g.range[0])), b = Math.round(x(g.range[1]))
      c.fillRect(a, h, Math.max(1, b - a), 2)
      // what the range is to the call (denoise's noise)
      if (g.label) { c.textAlign = 'left'; c.fillText(g.label, a + 5, all[0][1] + 10) }
    }
    if (g.notes) for (const rect of L.spec) paintNotes(g, rect, end)
    if (g.level != null) for (const rect of L.wave) {
      const amp = 10 ** (g.level / 20), [, y, lw, lh] = rect
      c.setLineDash([4, 3])
      for (const sign of [1, -1]) { const ly = Math.round(ay(rect, amp, sign)) + .5; c.beginPath(); c.moveTo(0, ly); c.lineTo(lw, ly); c.stroke() }
      c.setLineDash([])
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
      const px = Math.round(x(g.at)) + .5
      c.setLineDash([2, 3])
      for (const [, y, , lh] of all) { c.beginPath(); c.moveTo(px, y); c.lineTo(px, y + lh); c.stroke() }
      c.setLineDash([])
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
      c.font = `10px ${color('--font-mono')}`
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
    const xa = Math.max(0, Math.round(x(span[0]))), xb = Math.min(end, Math.round(x(span[1])))
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
  function paintRuler(marks) {
    const { w, h } = plot(), y = row(), { step, digits, first } = labelled(), taken = []
    c.textAlign = 'left'
    const shown = []
    for (const m of marks) {
      const px = Math.round(x(m.t)), text = stamp(m.t), tw = c.measureText(text).width
      let lx = px + 4
      if (m.of && !m.edge && tw + 8 > x(m.of[1]) - x(m.of[0])) lx = px - 4 - tw
      lx = Math.max(0, Math.min(w - tw - 3, lx))
      if (px < 0 || px > w || taken.some(([a, b]) => lx + tw + 4 > a && lx - 4 < b)) continue
      taken.push([Math.min(px, lx - 4), Math.max(px + 1, lx + tw + 4)])
      shown.push({ ...m, px, lx, text })
    }
    // the end shown by the time row alone (`endMark` 'ruler'): no ticks past it, no label running into its tick
    const cut = endMark === 'ruler' ? Math.round(x(duration)) : Infinity
    if (ruler !== 'none') for (let i = first; i * step <= end + 1e-9; i++) {
      const t = i * step, px = Math.round(x(t)), text = stamp(t, digits), tw = c.measureText(text).width
      if (px + 4 + tw > w || px > cut) break
      if (taken.some(([a, b]) => px + tw + 4 > a && px < b)) continue
      c.fillStyle = color('--color-screen-rule')
      c.fillRect(px, h, 1, TICK)
      if (ruler === 'labels' && px + 4 + tw < cut - 3) { c.fillStyle = color('--color-screen-dim'); c.fillText(text, px + 4, y) }
    }
    for (const m of shown) {
      c.fillStyle = m.fill
      c.fillRect(m.px, h, 1, TICK)
      tag(m.text, m.lx, y, 'left')
    }
  }
  // The lanes ruled (WORKSHOP `grid`), on a layer of their own between the pictures: over the spectrogram, as the screen
  // shows it; behind the waveform, wholly hidden where it is, however faint its fill there. Where the time row's ticks
  // meet the axis' on the right, a cross, and a dot where their finer steps meet ('marks'); the crosses alone
  // ('crosses'); or a dot at each, the ticks' larger ('dots'). None on a lane's edge.
  let ruled = ''
  const gridKey = L => [grid, duration, start, end, W, H, dpr, display, scale, levelUnits, units, rate, aview, fview, L.wave.length + L.spec.length, lanesEnd(L)].join()
  function paintGrid(L) {
    const key = gridKey(L)
    if (key !== ruled) { ruled = key; rule(L) }
    gc.setTransform(1, 0, 0, 1, 0, 0)
    gc.clearRect(0, 0, gridCanvas.width, gridCanvas.height)
    if (grid === 'none' || !duration) return
    gc.drawImage(ruling, 0, 0)
    if (!gl || !L.wave.length) return
    // the waveform's shape made solid, each pixel it touches at all opaque (its alpha doubled five times over), cut out
    sc.globalCompositeOperation = 'copy'
    sc.drawImage(waveCanvas, 0, 0)
    sc.globalCompositeOperation = 'lighter'
    for (let i = 0; i < 5; i++) sc.drawImage(solid, 0, 0)
    gc.globalCompositeOperation = 'destination-out'
    gc.drawImage(solid, 0, 0)
    gc.globalCompositeOperation = 'source-over'
  }
  // The grid ruled, drawn again only when what places it changes
  function rule(L) {
    const all = [...L.wave, ...L.spec], stop = lanesEnd(L)
    rc.setTransform(dpr, 0, 0, dpr, 0, 0)
    rc.clearRect(0, 0, W, H)
    if (grid === 'none' || !duration) return
    // the times: the time row's steps, and the finer steps between them, [px, a tick's]
    const { step, minor: sub = step } = labelled(), n = Math.round(step / sub), cols = []
    for (let i = Math.ceil(start / sub - 1e-9); i * sub <= end + 1e-9; i++) {
      const px = Math.round(x(i * sub))
      if (px >= 1 && px < stop) cols.push([px, i % n === 0])
    }
    // one path a colour, filled once: where a cross's arms meet is no brighter
    const marks = new Path2D(), dots = new Path2D()
    for (const rect of all) {
      const [, y, , lh] = rect, inner = ty => ty > y && ty < y + lh - 1
      const ticked = room(rect, display === 'spec' ? hzMarks(rect) : levelMarks(rect)).map(([ly]) => Math.round(ly))
      const between = room(rect, fineMarks(rect), [...ticked], MINOR).map(([ly]) => Math.round(ly))
      const rows = [...ticked.filter(inner).map(ty => [ty, true]), ...between.filter(inner).map(ty => [ty, false])]
      for (const [px, a] of cols) for (const [ty, b] of rows) {
        if (a && b && grid === 'dots') { dots.rect(px - 1, ty, 3, 1); dots.rect(px, ty - 1, 1, 3) }
        else if (a && b) { marks.rect(px - 3, ty, 7, 1); marks.rect(px, ty - 3, 1, 7) }
        else if (grid !== 'crosses') dots.rect(px, ty, 1, 1)
      }
    }
    rc.save()
    rc.beginPath()
    for (const [, y, , lh] of all) rc.rect(0, y, stop, lh)
    rc.clip()
    rc.fillStyle = color('--color-screen-grid')
    rc.fill(marks)
    rc.fillStyle = color('--color-screen-grid-dot')
    rc.fill(dots)
    rc.restore()
  }
  // The selection, in each lane (a box on the spectrogram), and the other ranges: a wash over each, the one highlight in
  // both pictures, the edge under the pointer (`hot`) or dragged lit, as it would move. A wash lifts a waveform's even
  // dark ground at once, where a spectrogram's speckle hides the same lift: its lanes take a wash that lifts as plainly.
  function paintSelection(L, sel) {
    const { w } = plot(), all = [...L.wave, ...L.spec], boxes = []
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
    const wash = [color('--color-screen-select'), color('--color-screen-select-spectrum')]
    for (const [px, py, bw, bh, spec] of boxes) { c.fillStyle = wash[+spec]; c.fillRect(px, py, bw, bh) }
  }
  // Where the sound ends, where the view shows past it (WORKSHOP `endMark`): a rule down the lanes, or a dotted one; the
  // room past it hatched; or nothing in the lanes, the time row's ticks stopping there (paintRuler) and a tick of its own
  function paintEnd(L) {
    const px = Math.round(x(duration)), stop = lanesEnd(L), all = [...L.wave, ...L.spec], [top, bottom] = extent(all)
    if (px < 0 || px >= stop) return
    c.fillStyle = c.strokeStyle = color('--color-screen-rule')
    if (endMark === 'hatch') {
      c.save()
      c.beginPath()
      for (const [, y, , lh] of all) c.rect(px, y, stop - px, lh)
      c.clip()
      c.beginPath()
      for (let k = px - (bottom - top); k < stop; k += 7) { c.moveTo(k, bottom); c.lineTo(k + bottom - top, top) }
      c.stroke()
      c.restore()
    }
    else if (endMark === 'dots') { c.fillStyle = color('--color-screen-dim'); for (const [, y, , lh] of all) for (let k = y + 1; k < y + lh; k += 4) c.fillRect(px, k, 1, 1) }
    else if (endMark === 'ruler') { c.fillStyle = color('--color-screen-dim'); c.fillRect(px, plot().h, 1, TICK) }
    else for (const [, y, , lh] of all) c.fillRect(px, y, 1, lh)
  }
  // The edge dragged, or the one a press would take, any range's, lit as the line it would move: its first pixel or its
  // last, over the handles
  function paintEdge(L, sel) {
    const lit = drag?.resizing && sel && !band ? { edge: sel[0] === drag.anchor ? 1 : 0, t: sel[sel[0] === drag.anchor ? 1 : 0] } : !drag && hot
    if (!lit) return
    const px = Math.round(x(lit.t)) - lit.edge
    c.fillStyle = color('--color-screen-bright')
    if (px >= 0 && px < lanesEnd(L)) for (const [, y, , lh] of [...L.wave, ...L.spec]) c.fillRect(px, y, 1, lh)
  }
  // a time as the whole page writes it, in the units chosen (time.js): 0:05, 5.0s, 240000
  const stamp = (t, d = digits()) => clock(t, units, { digits: d, rate })
  // Cues: shown only where they matter, never as a forest over the sound: the one dragged, bright where it will land;
  // those a dragged edge or caret sits on (`lit`); held ⌘ (Ctrl), the one under the pointer a press would take
  const on = (lit, px) => lit.some(t => Math.abs(x(t) - px) < .5)
  const editing = (keys = held) => !!(mac ? keys.metaKey : keys.ctrlKey)
  function paintCues(rects, lit) {
    const near = !drag && hovered ? nearCue(...hovered, held) : -1
    c.fillStyle = accent()
    for (const [i, t] of cues.entries()) {
      const moving = drag?.cue === i, at = moving ? drag.to : moved(t), px = Math.round(x(at))
      if (at == null || px < 0 || px > plot().w || !(moving || i === near || on(lit, px))) continue
      c.globalAlpha = moving || on(lit, px) ? 1 : .7
      for (const [, ly, , lh] of rects) c.fillRect(px, ly, 1, lh)
    }
    c.globalAlpha = 1
  }
  // Markers: a dashed line down each lane, as Audition draws them, apart from the caret's solid one and lit when a
  // dragged edge sits on it; a flag at its top, as a timeline's markers stand over its tracks, its name beside it (a
  // click on the name or a double-click on the flag names it). A range: a line at each end, a bar over the lanes between
  // them, the flag at its start. The marker chosen, by a press on its flag, in the accent: Delete takes it away
  const FLAG = 12, DASH = 3
  // where each name is drawn, [{ i, from, to }] px, for a click on it; the marker chosen, { time, duration? }, till the
  // caret or the selection goes elsewhere
  let names = [], chosen = null
  function paintMarkers(rects, lit) {
    const [top] = extent(rects), w = plot().w, L = lanes(), near = hovered && !drag ? markAt(...hovered) : null
    c.textAlign = 'left'
    names = []
    for (const [i, { time, duration, label }] of markers.entries()) {
      const at = drag?.marker === i ? drag.to : moved(time), px = Math.round(x(at)), ex = duration ? Math.round(x(at + duration)) : px
      if (at == null || ex < 0 || px > w) continue
      c.fillStyle = chosen && same(chosen, markers[i]) ? accent() : color('--color-screen-bright')
      for (const p of new Set([px, ex])) {
        c.globalAlpha = on(lit, p) || near != null && p === Math.round(x(near)) ? 1 : .7
        for (const [, ly, , lh] of rects) for (let k = ly; k < ly + lh; k += DASH * 2) c.fillRect(p, k, 1, Math.min(DASH, ly + lh - k))
      }
      c.globalAlpha = .5
      if (duration) { c.fillRect(px, top, ex - px, 3); c.fillRect(ex, top, 1, FLAG) }
      c.globalAlpha = 1
      c.fillRect(px, top, 1, FLAG)
      c.beginPath(); c.moveTo(px, top); c.lineTo(px + 7, top + 3); c.lineTo(px, top + 6); c.fill()
      if (!label || naming && same(naming, markers[i])) continue
      // past a handle in the corner of a range on it
      const lx = gripAt(L, px + 10, top + 6) ? px + INSET + BOX + 4 : px + 10
      tag(label, lx, top + 6, 'left', color('--color-screen-soft'))
      names.push({ i, from: lx - 3, to: lx + 3 + c.measureText(label).width })
    }
  }
  // two markers one: the same kind at the same time, to half a millisecond (an output's, from the time written)
  const same = (m, n) => !m.duration === !n.duration && Math.abs(m.time - n.time) < 5e-4
  // The marker under the pointer on the flags' row: a flag by its line, else the range whose bar is there; or a name
  function nearMarker(px, py) {
    if (py > FLAG + 2) return -1
    const flag = markers.findIndex(m => Math.abs(x(moved(m.time) ?? m.time) - px) <= EDGE)
    return flag >= 0 ? flag : markers.findIndex(m => m.duration && px >= x(moved(m.time) ?? m.time) && px <= x((moved(m.time) ?? m.time) + m.duration))
  }
  const nameAt = (px, py) => py <= FLAG + 2 ? names.find(n => px >= n.from && px <= n.to)?.i ?? -1 : -1
  // The marker line in the lanes within EDGE px of the pointer, a moment's or a range's end: its time, where a press
  // puts the caret; or null. Snapping as a drag does (stick): not with it off, nor while ⌘ aims finely
  function markAt(px, py) {
    if (!snapping || fine() || py <= FLAG + 2 || py > plot().h) return null
    let best = null
    for (const t of markers.flatMap(marked).map(t => moved(t) ?? t)) if (Math.abs(x(t) - px) <= EDGE && (best == null || Math.abs(x(t) - px) < Math.abs(x(best) - px))) best = t
    return best
  }
  // A flag's name written where it is: a field over it, Enter or a click away keeps it, Escape leaves it as it was
  let naming = null
  function rename(i) {
    const m = markers[i]
    if (!m) return
    naming?.input.remove()
    const input = root.appendChild(Object.assign(document.createElement('input'), { className: 'marker-name', value: m.label || '', placeholder: 'Name', spellcheck: false }))
    Object.assign(input.style, { left: `${Math.round(x(moved(m.time) ?? m.time)) + 8}px`, top: '0px' })
    naming = { time: m.time, duration: m.duration, input }
    let done = false
    const end = keep => {
      if (done) return
      done = true
      input.remove()
      naming = null
      invalidate(true)
      // named at once, as a dragged flag stays where it was let go, till the output that has it comes: the marker as it
      // is now, the output having come meanwhile
      const label = input.value.trim(), j = markers.findIndex(n => same(n, m)), now = markers[j] ?? m
      if (keep && label !== (now.label || '') && onedit('relabel', { time: now.time, duration: now.duration, label }) && j >= 0) markers = markers.with(j, { ...now, label })
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
      if (sign > 0) for (const [t, v] of pts) c.fillRect(Math.round(x(t)) - 3, Math.round(ly(rect, v)) - 3, 6, 6)
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
      for (const [t] of pts) { const f = toneAt(t); if (f) c.fillRect(Math.round(x(t)) - 3, Math.round(fy(rect, f)) - 3, 6, 6) }
      c.restore()
    }
    c.lineWidth = 1
  }
  // the pitch line's point within reach of the pointer where it sits on the pitch curve, the nearest; -1 for none
  function pointOn(rect, px, py) {
    let best = -1, d = Infinity
    linePoints().forEach(([t], i) => {
      const f = toneAt(t), dx = x(t) - px, dy = f ? fy(rect, f) - py : Infinity
      if (Math.abs(dx) <= EDGE && Math.abs(dy) <= EDGE + 2 && Math.hypot(dx, dy) < d) { d = Math.hypot(dx, dy); best = i }
    })
    return best
  }

  // From 32 samples across to eight times the whole, a bird's view: the sound starts at the left, the room is on its right.
  // A view an edit left past the sound's end (it got shorter) stays there until it is moved back.
  // Scrolled or zoomed by hand (`past`), the sound's end goes on as far as the view's middle: the tail comes out from
  // under the meters and the labels to be edited, the room past it shown as past the end (`endMark`)
  function setRange(a, b, past = false) {
    const min = Math.min(duration, 32 / rate)
    let span = Math.max(min, Math.min(Math.max(duration * 8, recording ? RECORD : 0), b - a))
    const last = past ? duration - span / 2 : duration - span
    a = span <= duration || past ? Math.max(0, Math.min(Math.max(last, start), a)) : 0
    start = a; end = a + span
    invalidate()
  }
  // The frequencies shown, [u0, u1] on the scale: at least a 64th of it, within it
  function setFreqs(u0, u1) {
    const span = Math.min(1, Math.max(1 / 64, u1 - u0)), a = Math.max(0, Math.min(1 - span, u0))
    fview = [a, a + span]
    invalidate()
  }
  const zoom = (factor, at = (start + end) / 2) => setRange(at - (at - start) * factor, at + (end - at) * factor, true)
  // the view shows all of the sound
  const whole = () => start <= 0 && end >= duration - 1e-9
  // zoom the frequencies around u, which stays where it is on screen
  const zoomFreqs = (factor, u) => { const [u0, u1] = fview, k = (u - u0) / (u1 - u0), span = (u1 - u0) * factor; setFreqs(u - k * span, u - k * span + span) }

  // Pointer: a press takes what is under it (down); two fingers pan and zoom, the wheel pans, a pinch or Ctrl+wheel zooms.
  // The frequencies at the right of a spectrogram lane, and the spectrum drawn just before them: that lane, else null
  const onFreqs = (px, py, L = lanes()) => px > plot().w - (meters && show.meters ? METER + 2 : 0) ? L.spec.find(r => py >= r[1] && py <= r[1] + r[3]) ?? null : null
  // The levels at the right of a waveform lane, and its meter: that lane, else null
  const onLevels = (px, py, L = lanes()) => px > plot().w - (meters && show.meters ? 10 : 0) ? L.wave.find(r => py >= r[1] && py <= r[1] + r[3]) ?? null : null
  // Zoom the levels around the value u, which stays where it is on screen: from a thousandth of full scale across to
  // eight times it, stopping at full scale on the way (a zoom that reaches it or passes it lands on -1..1 exactly, the
  // next leaves it).
  // Zoomed in, what shows stays within full scale; zoomed out, it is centred on 0, what goes over either side.
  function zoomLevels(factor, u = (aview[0] + aview[1]) / 2) {
    const [lo, hi] = aview, was = hi - lo
    let span = Math.max(2e-3, Math.min(8, was * factor))
    // onto full scale only on the way to it: a step that crosses it or comes within 6% of it; leaving it, never back
    if (was !== 2 && ((was - 2) * (span - 2) < 0 || Math.abs(span - 2) < .12 && Math.abs(span - 2) < Math.abs(was - 2))) span = 2
    const a = span >= 2 ? -span / 2 : u - (u - lo) / was * span
    scrollLevels(a, span)
  }
  // Scroll the levels: `span` of them from `a`, kept within full scale
  function scrollLevels(a, span = aview[1] - aview[0]) {
    if (span < 2) a = Math.max(-1, Math.min(1 - span, a))
    aview = [a, a + span]
    invalidate()
  }
  function down(event) {
    if (!duration || event.button > 0) return
    root.setPointerCapture(event.pointerId)
    pointers.set(event.pointerId, local(event))
    if (pointers.size === 2) {
      unscrub()
      // a pinch zooms time; on the frequencies, the frequencies; on the levels, the levels
      const pinch = [...pointers.values()], mid = [(pinch[0][0] + pinch[1][0]) / 2, (pinch[0][1] + pinch[1][1]) / 2], rect = onFreqs(...mid)
      const levels = onLevels(...mid)
      drag = { pinch, range: [start, end], fview, u: rect ? uy(rect, mid[1]) : null, levels: levels && aview, value: levels && ya(levels, mid[1]) }
      return
    }
    // on a marker's line, its time
    const [px, py] = local(event), t = markAt(px, py) ?? snap(time(px)), L = lanes()
    // a handle over a flag is the handle's; a marker's name is named when the click comes (clicked)
    const grip = gripAt(L, px, py)
    if (!grip && nameAt(px, py) >= 0) return
    const flag = grip ? -1 : nearMarker(px, py)
    // a flag: dragged, the marker moves, the caret and what plays staying where they are; clicked, the caret goes to it,
    // a range's selects it (let go)
    if (flag >= 0) chosen = markers[flag]
    drag = flag >= 0 ? { marker: flag, x: px, to: markers[flag].time, moved: false }
      : gripDown(px, py, L, event) || endDown(px, py, event) || (show.hits && cueDown(px, py, event)) || (show.gain && !pitchLine() && penDown(px, py, L)) || (pitchLine() && (toneDown(px, py, L) || penDown(px, py, L, true) || pitchDown(px, py, L) || penDown(px, py, L))) || selectDown(event, px, py, t, L)
    // ⌘ aims finely, but not what it took hold of: a box, audio carried, an end stretched, a cue
    drag.aim = { px, py, ex: px, ey: py, on: editing(event), k: editing(event) && !drag.box && !drag.carry && !drag.end && drag.cue == null ? FINE : 1 }
    // a plain press held still: the caret, dragged, no selection
    const d = drag
    if (d.anchor != null && !d.moved && !d.caret && !d.adding && !d.box && !d.keep) d.hold = setTimeout(() => {
      if (drag !== d || d.moved) return
      Object.assign(d, { caret: true, offset: 0, from: cursor, keep: true })
      root.style.cursor = 'ew-resize'
    }, HOLD)
    // the moment under the caret sounds at once, for as long as it is held
    if (drag.hear != null) scrub(drag)
    invalidate()
  }
  // What a press on the picture takes, as in a text and as in Figma. A caret's line, any of them, or the time row (the
  // caret alone, as Audacity's timeline moves the play position) drags the caret, the others staying; a range's edge,
  // any of them, drags it, the others staying, and meeting the range's other edge it leaves the caret there; anywhere
  // else, at once, the caret there and all else gone, and a drag from it a range. Shift sums: at once the selection, or
  // the caret, out to the press from where it was begun (`origin`), as Shift and a click in a text, a drag going on with
  // it. Alt adds: another caret, or dragged another range (on the spectrogram with a band, another box); dragged inside
  // the selection, a copy of its audio (Finder's and Figma's Alt-drag). ⌘ (Ctrl) and a drag inside the selection moves
  // its audio (Finder's ⌘-drag); on the spectrogram elsewhere, a box of time and frequency, a band. Each keeps its
  // distance from the pointer. `hear` is the time a drag sounds.
  function selectDown(event, px, py, t, L) {
    const row = py > plot().h, spec = !row && L.spec.find(rect => inside(rect, px, py))
    const within = selection && !band && !row && px > x(selection[0]) + EDGE && px < x(selection[1]) - EDGE
    const box = spec && !within && (editing(event) || event.altKey && band) ? spec : null
    if (event.shiftKey && !event.altKey) { const o = origin(); select(o, t, band, true); anchor = o; return { anchor: o, offset: 0, moved: true, keep: true, hear: t } }
    const [a, b] = selection ?? []
    if (within && (event.altKey || editing(event))) return { carry: event.altKey ? 'copy' : 'move', a, b, x: px, y: py, to: a, moved: false, alt: event.altKey }
    // a box sounds its band once it opens: a press alone has none
    if (event.altKey && !row) return { anchor: t, x: px, y: py, offset: 0, moved: false, adding: true, hear: box ? null : t, ...box && { box, f: snapF(box, py) } }
    if (box) { select(0, 0); setCursor(t); return { anchor: t, x: px, y: py, offset: 0, box, f: snapF(box, py), moved: false, hear: null } }
    const c = caretAt(px, py)
    if (c || row) {
      if (c?.r) take(c.r)
      const offset = row ? 0 : cursor - t
      setCursor(stuck(snap(t + offset)))
      // a caret's line only clicked is a click: the caret there alone (up)
      return { caret: true, offset, moved: true, hear: cursor, from: cursor, keep: true, x: px, still: !row }
    }
    const e = edgeAt(px)
    if (e) {
      if (e.r) take(e.r)
      return { anchor: selection[1 - e.edge], edge: e.edge, offset: selection[e.edge] - t, moved: true, resizing: true, keep: true, hear: selection[e.edge] }
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
    if (py > plot().h) return null
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
    if (kind === 'level' || TOOLS.includes(kind)) return { pill: true, tool: kind, a, b, x: px, y: py, lane: [...L.wave, ...L.spec][0], moved: false }
    // each keeps the distance it was pressed at from the edge it moves
    return kind === 'stretch' ? { stretch: true, a, b, to: b, x: px, offset: b - time(px), mode: gripMode } : { fade: kind, a, b, x: px, offset: (kind === 'in' ? a : b) - time(px) }
  }
  // ⌘ (Ctrl) at a range's end, any range's: its length, as its grip sets it (trimmed, stretched or sped)
  function endDown(px, py, event) {
    const e = editing(event) && py <= plot().h && edgeAt(px)
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
    anchor = null
    if (r.length === 4) { selection = [r[0], r[1]]; band = [r[2], r[3]] }
    else if (r[1] > r[0]) { selection = [...r]; band = null }
    else { selection = band = null; cursor = r[0]; oncursor(cursor) }
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
  // stretching to meet it
  const nearCue = (px, py, keys) => editing(keys) && py <= plot().h ? cues.findIndex(t => Math.abs(x(t) - px) <= STICK) : -1
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
    const rect = contour?.f0.length && L.spec.find(r => inside(r, px, py)), index = rect ? pointOn(rect, px, py) : -1
    if (index < 0) return null
    const points = linePoints().map(p => [...p]), [t, v0] = points[index], hz = toneAt(t)
    return { points, line: 'pitchline', tone: true, index, rect, hz, v0, offset: [x(t) - px, fy(rect, hz) - py], x: px, y: py, t0: t, before: JSON.stringify(linePoints()) }
  }
  // A press on the pitch curve: dragged up or down, the whole pitch line with it (`base`, the line before; each point by
  // as much, or with none one where it was pressed): all of the voice moved, as it moves under the pointer, heard over
  // the voiced stretch pressed (frames [a, b]); let go where it was pressed, a point of the line there (tapped)
  function pitchDown(px, py, L) {
    const rect = contour?.f0.length && L.spec.find(r => inside(r, px, py))
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
      if (drag.levels) { aview = drag.levels; return zoomLevels(Math.abs(b[1] - a[1]) / Math.max(8, Math.abs(q[1] - p[1])), drag.value) }
      if (drag.u != null) {
        const k = Math.abs(b[1] - a[1]) / Math.max(8, Math.abs(q[1] - p[1])), [u0, u1] = drag.fview, f = (drag.u - u0) / (u1 - u0), fspan = (u1 - u0) * k
        return setFreqs(drag.u - f * fspan, drag.u - f * fspan + fspan)
      }
      const k = Math.abs(b[0] - a[0]) / Math.max(8, Math.abs(q[0] - p[0])), span = (r1 - r0) * k
      const center = r0 + (a[0] + b[0]) / 2 / plot().w * (r1 - r0)
      const at = (p[0] + q[0]) / 2 / plot().w
      setRange(center - at * span, center - at * span + span, true)
      return
    }
    if (!drag) { hovered = event.pointerType === 'touch' ? null : [px, py]; hover(px, py, event); return invalidate(true) }
    if (drag.pinch) return
    drag.raw = [px, py]
    return drags(event, ...aimed(event, px, py))
  }
  function drags(event, px, py) {
    hovered = event.pointerType === 'touch' ? null : [px, py]
    drag.last = [event, px, py]
    // a drag draws what it does (the helpers, the picture as it will be): the pointer goes while it does, once it moves
    if (drag.x == null || Math.abs(px - drag.x) >= 3 || Math.abs(py - (drag.y ?? py)) >= 3) root.style.cursor = 'none'
    if (drag.marker != null) {
      if (!drag.moved && Math.abs(px - drag.x) < 3) return
      drag.moved = true
      drag.to = Math.min(duration, Math.max(0, snap(markers[drag.marker].time + time(px) - time(drag.x))))
      return invalidate(true)
    }
    if (drag.cue != null) {
      if (!drag.moved && Math.abs(px - drag.x) < 3) return
      drag.moved = true
      drag.to = Math.max(drag.prev + .01, Math.min(drag.next - .01, snap(time(px)) + drag.offset))
    }
    // the pitch curve, once it moves: up or down by semitones, the whole pitch line with it
    else if (drag.run) {
      if (!drag.moved && Math.abs(px - drag.x) < 3 && Math.abs(py - drag.y) < 3) return
      drag.moved = true
      const st = semitones(yf(drag.rect, py) / yf(drag.rect, drag.y)), range = pitchRange(drag), changed = st !== drag.st
      if (changed || !drag.heard) { drag.st = st; drag.points = drag.base.length ? drag.base.map(([t, v]) => [t, v + st]) : [[drag.at, st]] }
      hear(drag, changed, { ...range, curve: curveOf(drag.points) })
    }
    else if (drag.points) {
      // on the pitch curve, once it moves a few pixels
      if (drag.tone && !drag.moved) { if (Math.abs(px - drag.x) < 3 && Math.abs(py - drag.y) < 3) return; drag.moved = true }
      const p = drag.points[drag.index], lo = drag.points[drag.index - 1]?.[0] ?? 0, hi = drag.points[drag.index + 1]?.[0] ?? duration, was = [...p]
      // a point moved only up or down keeps its time as it was, not taken to the zoom's step
      const [dx, dy] = drag.offset, [qx, qy] = lock(event, px, py)
      p[0] = qx === drag.x ? drag.t0 : Math.max(lo, Math.min(hi, snap(time(qx + dx))))
      // on the pitch curve: to the pitch the pointer is at, in whole semitones (held ⌘, cents), 0 within reach of where it
      // would be at 0
      if (drag.tone) {
        const zero = fy(drag.rect, drag.hz * 2 ** (-drag.v0 / 12)), v = drag.v0 + 12 * Math.log2(yf(drag.rect, qy + dy) / drag.hz)
        p[1] = Math.abs(qy + dy - zero) <= SNAP ? 0 : fine() ? Math.round(v * 100) / 100 : Math.round(v)
      }
      else p[1] = snapV(drag.rect, fold(drag.rect, qy) + dy)
      if (drag.line === 'pitchline') hear(drag, p[0] !== was[0] || p[1] !== was[1], { ...heardAround(drag.points, drag.index), curve: curveOf(drag.points) })
    }
    // the pill or a tool, its first move: up or down, its level, or a voice's pitch, intonation or formants
    else if (drag.pill) {
      if (Math.max(Math.abs(px - drag.x), Math.abs(py - drag.y)) < 3) return
      drag = { ...lifting(drag.lane, drag.y, drag.tool), aim: drag.aim }
      return drags(event, px, py)
    }
    // moved audio lands with its start or its end on a cue, whichever is nearer one, past the end too (silence opening
    // up to it); a copy goes in at a cue, anywhere up to the end. Up over the head, onto the tabs, it goes to a tab of
    // its own: the picture shows what it leaves (a move takes it out, the rest closing up), the pointer back to say so
    else if (drag.carry) {
      if (!drag.moved && Math.abs(px - drag.x) < 3) return
      drag.moved = true
      drag.out = py < 0
      root.style.cursor = drag.out ? (drag.carry === 'copy' ? 'copy' : 'grabbing') : 'none'
      const d = drag.b - drag.a, to = free(drag.a + time(px) - time(drag.x)), s = stick(to), e = drag.carry === 'move' && stick(to + d)
      drag.to = Math.max(0, Math.min(drag.carry === 'move' ? Infinity : duration, s && (!e || s.d <= e.d) ? s.t : e ? e.t - d : to))
      pieces = drag.out ? drag.carry === 'move' ? arrange('remove', drag.a, drag.b) : null : arrange(drag.carry, drag.a, drag.b, drag.to)
      if (drag.carry === 'move' && !drag.out) overrun(drag.to + drag.b - drag.a)
      return invalidate()
    }
    // the grip: trimmed back to it, or silence added out to it; else stretched or sped, within a quarter and four times
    // the length (fn/stretch.js)
    else if (drag.stretch) {
      // a press that stays put is a click: it asks how (up)
      if (!drag.moved && Math.abs(px - drag.x) < 3) return
      drag.moved = true
      const { a, b } = drag, d = b - a, to = stuck(free(time(px) + drag.offset))
      if (drag.mode === 'trim') { drag.to = Math.max(a, to); pieces = drag.to < b ? arrange('remove', drag.to, b) : drag.to > b ? arrange('insert', b, b, drag.to) : null }
      else { drag.to = Math.max(a + d / 4, Math.min(a + d * 4, to)); pieces = arrange('stretch', a, b, drag.to) }
      overrun(drag.to)
    }
    // the lane's height is 24 dB, in half-dB steps, from −24 to +12
    else if (drag.lift === 'gain') {
      drag.db = Math.max(-24, Math.min(12, +(Math.round((drag.y - py) / drag.rect[3] * 24 / levelStep) * levelStep).toFixed(1)))
      pieces = arrange('gain', drag.a, drag.b, drag.a, drag.db)
    }
    // pitch, by semitones (by the pitch axis's frequencies: the spectrogram's, or on the waveform the voice's, VOICE)
    else if (drag.lift === 'pitch') {
      const st = semitones(yf(drag.rect, py) / yf(drag.rect, drag.y)), changed = st !== drag.st
      drag.st = st; drag.ratio = 2 ** (st / 12)
      hear(drag, changed, { ...pitchRange(drag), pitch: st })
    }
    // intonation, a factor: up half a lane twice as wide, down half a lane a monotone, by 0.05 (held ⌘, 0.01), 0 to 3
    else if (drag.lift === 'intonation') {
      const k = 1 + (drag.y - py) / (drag.rect[3] / 2), step = fine() ? 100 : 20, was = drag.k
      drag.k = Math.max(0, Math.min(3, Math.round(k * step) / step))
      hear(drag, drag.k !== was, { ...pitchRange(drag), intonation: drag.k })
    }
    // formants, by semitones on the pitch line's scale (half a lane an octave), ±12
    else if (drag.lift === 'formant') {
      const st = Math.max(-12, Math.min(12, semitones(2 ** ((drag.y - py) / (drag.rect[3] / 2))))), changed = st !== drag.st
      drag.st = st
      hear(drag, changed, { ...pitchRange(drag), formant: st })
    }
    // A fade's corner, dragged: inward, the fade runs from the edge to it; outward, past the edge, the audio out there
    // goes, what is before it crossfading into the range (or the range into what is after). It shows as it goes.
    else if (drag.fade) {
      // a press that stays put is a click: it asks for the curve (up)
      if (!drag.span && Math.abs(px - drag.x) < 3) return
      const { a, b } = drag, p = drag.p = clamp(stuck(snap(time(px) + drag.offset))), edge = drag.fade === 'in' ? a : b
      // back where it began, give or take a few pixels: nothing, as it will be let go
      if (Math.abs(x(p) - x(edge)) < 3) { drag.span = [edge, edge]; drag.cross = false; pieces = null; return invalidate() }
      drag.cross = drag.fade === 'in' ? p < a : p > b
      drag.span = drag.fade === 'in' ? (drag.cross ? [p, a] : [a, Math.min(p, b)]) : (drag.cross ? [b, p] : [Math.max(p, a), b])
      pieces = drag.span[1] > drag.span[0] ? drag.cross ? crossed(...drag.span) : faded(drag.fade, ...drag.span) : null
    }
    // silence pulled open at the caret, as far as the pointer goes: the rest waits after it
    else if (drag.gap) { drag.to = Math.max(drag.at, stuck(free(time(px) + drag.offset))); pieces = drag.to > drag.at ? arrange('insert', drag.at, drag.at, drag.to) : null; overrun(drag.to) }
    else {
      if (!drag.moved && Math.abs(px - drag.x) < 3) return
      // a range starts on the cue its press was by, and its other end goes onto the one it comes near
      if (!drag.moved && !drag.caret) drag.anchor = stuck(drag.anchor)
      drag.moved = true
      drag.hear = stuck(snap(time(px) + drag.offset))
      // a caret dragged with Shift held becomes a range, from where it was pressed, still sounding as it goes
      if (drag.caret && event.shiftKey) { drag.caret = false; drag.anchor = drag.from }
      if (drag.caret) { if (Math.abs(px - drag.x) >= 3) drag.still = false; scrub(drag); setCursor(drag.hear) }
      // an edge dragged onto the other one's leaves the caret there
      else if (drag.resizing) {
        if (drag.edge ? drag.hear <= drag.anchor : drag.hear >= drag.anchor) { select(drag.anchor, drag.anchor, null, true); setCursor(drag.anchor) }
        else { select(drag.anchor, drag.hear, band, true); anchor = drag.anchor }
        // a box's edge sounds its band
        drag.band = band
        scrub(drag)
      }
      // with Alt, another box beside the one (or ones) there are
      else if (drag.box) {
        const f = snapF(drag.box, py), fs = [Math.min(f, drag.f), Math.max(f, drag.f)]
        if (drag.adding && !drag.started) { drag.started = true; if (selection || more.length) more.push(current()) }
        select(drag.anchor, drag.hear, fs, !!drag.adding)
        drag.band = band
        scrub(drag)
      }
      else if (drag.adding) {
        // the caret or range there was stays beside the new one
        if (!drag.started) { drag.started = true; more.push(current()) }
        select(drag.anchor, drag.hear, null, true)
        anchor = drag.anchor
        scrub(drag)
      }
      else { select(drag.anchor, drag.hear, drag.keep ? band : null, !!drag.keep); anchor = drag.anchor; scrub(drag) }
    }
    invalidate()
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
  // the selection's audio (held Alt to copy, ⌘ to move); a marker's flag, the gain line or a point on it, a voiced
  // stretch of the pitch curve, a range's edge (lit, `hot`) or a caret, or the time row; held ⌘ over the spectrogram, a
  // cross for a box of time and frequency. Else what a press does: held Shift, the I-beam with a chevron the way the
  // selection goes out to it; held Alt, with a plus. What it grabs (`grabbing`) a right-click leaves as it is (context).
  let held = {}, hot = null, grabbing = false
  function hover(px, py, keys = held) {
    held = keys
    const L = lanes(), rect = (show.gain || pitchLine()) && lineLanes(L).find(r => inside(r, px, py)), spectral = L.spec.some(r => inside(r, px, py)) && editing(keys)
    const tone = pitchLine() && contour?.f0.length && L.spec.find(r => inside(r, px, py))
    const handle = gripAt(L, px, py)?.[0], end = !handle && editing(keys) && py <= plot().h && edgeAt(px)?.edge === 1
    const cue = !handle && !end && show.hits && nearCue(px, py, keys) >= 0
    const within = selection && !band && py <= plot().h && px > x(selection[0]) + EDGE && px < x(selection[1]) - EDGE
    const other = handle ? gripPointer(handle)
      : end ? gripPointer('stretch')
      : cue ? 'col-resize'
      : within && keys.altKey ? 'copy'
      : within && editing(keys) ? 'move'
      : nameAt(px, py) >= 0 ? 'text'
      : nearMarker(px, py) >= 0 ? 'pointer'
      : rect && onLine(rect, px, py) && pointAt(rect, px, py) >= 0 || tone && pointOn(tone, px, py) >= 0 ? 'move'
      : tone && pitchDown(px, py, L) || rect && onLine(rect, px, py) ? 'ns-resize' : null
    // Shift or Alt held, a press sums or adds wherever it is, an edge's or a caret's line too
    const plain = !keys.shiftKey && !keys.altKey, caret = plain && caretAt(px, py)
    hot = end || other == null && !spectral && plain ? edgeAt(px) : null
    grabbing = other != null || !!hot || !!caret || plain && py > plot().h
    root.style.cursor = other ?? (keys.shiftKey && !keys.altKey ? EXTEND[time(px) < origin() ? 1 : 0] : grabbing ? 'ew-resize' : plain && markAt(px, py) != null ? 'pointer' : spectral ? 'crosshair' : keys.altKey ? ADD : '')
  }
  function leave() { hovered = null; hot = null; invalidate(true) }
  function up(event) {
    pointers.delete(event.pointerId)
    const d = drag
    drag = null
    clearTimeout(d?.hold)
    if (d?.overrun) cancelAnimationFrame(d.overrun)
    if (d?.pinch) { if (pointers.size) drag = d; return }
    if (!d) return
    if (d.marker != null) {
      const m = markers[d.marker]
      if (d.moved && Math.abs(d.to - m.time) > 1e-6) { markers = markers.with(d.marker, { ...m, time: d.to }); onedit('remark', { time: m.time, duration: m.duration, to: d.to }) }
      else if (!d.moved) m.duration ? select(m.time, m.time + m.duration) : (select(0, 0), setCursor(m.time))
      chosen = markers[d.marker]
    }
    else if (d.cue != null) {
      // the cue sits where it was dropped at once, so a next drag before the output returns pins its neighbours right
      const from = cues[d.cue]
      if (!d.moved) { select(0, 0); setCursor(from) }
      else if (Math.abs(d.to - from) > 1e-4) { cues = cues.with(d.cue, d.to); ahead = true; onedit('warp', { from, to: d.to, prev: d.prev, next: d.next }) }
    }
    // the pitch curve moved, or clicked: the whole pitch line moved, or a point of it there
    else if (d.run) { onaudition(null); if (!d.moved) onedit('pitchline', curveOf(tapped(d))); else if (d.st) onedit('pitchline', curveOf(d.points)) }
    else if (d.points) { if (d.line === 'pitchline') onaudition(null); if (JSON.stringify(d.points) !== d.before) onedit(d.line, curveOf(d.points)) }
    // a drag that moved audio: the picture keeps the pieces where they went until the output comes (set, stream)
    else if (d.carry) {
      const length = d.b - d.a
      if (!d.moved) { const t = snap(time(local(event)[0])); if (d.alt) addCaret(t); else { select(0, 0); setCursor(t) } }
      else if (d.out) { if (!onedit('tab', { at: d.a, duration: length, copy: d.carry === 'copy' })) pieces = null; else if (d.carry === 'move') { select(0, 0); setCursor(d.a) } }
      else if (Math.abs(d.to - d.a) < 1e-9 || !onedit('carry', { at: d.a, duration: length, to: d.to, copy: d.carry === 'copy' })) pieces = null
      else select(d.to, d.to + length, null, true)
    }
    else if ((d.stretch || d.pill) && !d.moved) { if (d.stretch && !d.end) onmode('grip') }
    else if (d.stretch && d.mode === 'trim') {
      if (Math.abs(d.to - d.b) < 1e-9 || !onedit('trim', { at: d.a, end: d.b, to: d.to })) pieces = null
      else d.to > d.a ? select(d.a, d.to, null, true) : (select(0, 0), setCursor(d.a))
    }
    else if (d.stretch) {
      const factor = (d.to - d.a) / (d.b - d.a)
      if (Math.abs(factor - 1) < 1e-3 || !onedit('stretch', { at: d.a, duration: d.b - d.a, factor, speed: d.mode === 'speed' })) pieces = null
      else select(d.a, d.to, null, true)
    }
    else if (d.lift === 'gain') { if (!d.db || !onedit('lift', { range: [d.a, d.b], db: d.db })) pieces = null }
    // the selection's pitch, intonation or formants: its pitch curve shown as the edit leaves it until the output it
    // makes is measured
    else if (d.lift === 'pitch' || d.lift === 'intonation' || d.lift === 'formant') {
      onaudition(null)
      const range = pitchRange(d), made = d.lift === 'pitch' ? d.st && onedit('pitch', { ...range, semitones: d.st }) : d.lift === 'intonation' ? d.k !== 1 && onedit('intonation', { ...range, factor: d.k }) : d.st && onedit('formant', { ...range, semitones: d.st })
      if (made && d.lift !== 'formant') landed = d
    }
    else if (d.fade && !d.span) onmode('curve')
    // let go where it was pressed, give or take a few pixels: nothing
    else if (d.fade && Math.abs(x(d.p) - x(d.fade === 'in' ? d.a : d.b)) < 3) pieces = null
    else if (d.fade && d.cross) {
      const [p, q] = d.span, length = q - p
      if (!(length > 0 && onedit('crossfade', { at: p, duration: length }))) pieces = null
      else if (d.fade === 'in') select(d.a - length, d.b - length, null, true)
    }
    else if (d.fade) { if (!(d.span[1] > d.span[0] && onedit('fade', { kind: d.fade, from: d.span[0], to: d.span[1], curve: fadeCurve }))) pieces = null }
    else if (d.gap) { if (!(d.to > d.at && onedit('insert', { at: d.at, duration: d.to - d.at }))) pieces = null }
    else if (d.adding && !d.moved) addCaret(d.anchor)
    else if (d.caret && d.still && (selection || more.length)) { selection = band = null; more = []; told() }
    else if (!d.moved && (selection || more.length) && !d.keep) { selection = null; band = null; more = []; told() }
    // the moment under it falls silent once what the press did is done: playback, paused for it, goes on from there
    if (d.scrubbing) { d.scrubbing = false; onscrub(null) }
    // the pointer back, as what is under it would have it
    hover(...local(event), event)
    invalidate()
  }
  // Clicks counted: a click on a marker's name, or a double-click on its flag, names it; a double-click takes away the
  // line's point under it (the pitch line's on the pitch curve too), or selects between the cues around it (or the
  // pause it is in); a triple-click, the sound between the pauses either side
  function clicked(event) {
    const named = gripAt(lanes(), ...local(event)) ? -1 : nameAt(...local(event))
    if (named >= 0) return event.detail === 1 && rename(named)
    if (!duration || event.detail < 2 || event.button > 0) return
    const [px, py] = local(event), L = lanes(), rect = (pitchLine() || show.gain) && lineLanes(L).find(r => inside(r, px, py)), flag = nearMarker(px, py)
    const tone = pitchLine() && contour?.f0.length && L.spec.find(r => inside(r, px, py))
    if (flag >= 0) return rename(flag)
    if (event.detail === 2 && (rect || tone) && (pitchLine() ? shift : envelope)) {
      const pts = linePoints(), i = rect ? pointAt(rect, px, py) : pointOn(tone, px, py)
      if (i >= 0) { pts.splice(i, 1); onedit(pitchLine() ? 'pitchline' : 'envelope', curveOf(pts)); return }
    }
    if (py > plot().h || px > plot().w) return
    around(event.detail === 2 ? 'fragment' : 'sound', clamp(time(px)), event.altKey ? 'add' : event.shiftKey ? 'extend' : null)
  }
  // What a double- or triple-click takes at t: within a pause, the pause; else, double, the fragment between the cues
  // either side (a sound's start or end, a hit, a marker); triple, the sound between the pause before and the one after,
  // its edges where the cues have them. With Alt, another range beside those there are (the carets its clicks left gone);
  // with Shift, the selection out to it.
  function around(kind, t = cursor, how = null) {
    const list = edges(kind)
    const [a, b] = segments.silences.find(([a, b]) => t >= a && t <= b) ?? [list.findLast(c => c <= t) ?? 0, list.find(c => c > t) ?? duration]
    if (how === 'add') { more = more.filter(r => !(r[0] === r[1] && r[0] >= a && r[0] <= b)); add(a, b) }
    else if (how === 'extend' && selection) select(Math.min(selection[0], a), Math.max(selection[1], b), null, true)
    else select(a, b)
  }
  // Where the caret steps, as a text's words and lines, and what the clicks take: the cues (found, the markers), the
  // fragments' edges; the pauses' edges, the sounds', a pause that ends where a cue is (the two found within 30 ms of each
  // other) ending at the cue. An edit drawn ahead takes them where it moves them, as they are drawn.
  function edges(kind) {
    const at = list => list.map(moved).filter(t => t != null), shown = at(cues), onCue = t => shown.find(c => Math.abs(c - t) < .03) ?? t
    const all = [0, duration, ...at(markers.flatMap(marked)), ...(kind === 'fragment' ? shown : at(segments.silences.flat()).map(onCue))].filter(t => t >= 0 && t <= duration)
    return [...new Set(all.map(t => +t.toFixed(6)))].sort((a, b) => a - b)
  }
  // an edge within three pixels of the caret is where it is: a hit found a few ms after the pause it ends is one place
  function stepTo(kind, dir, extend = false) {
    const head = selection ? (selection[0] === origin() ? selection[1] : selection[0]) : cursor, near = Math.max(1e-4, unit() * 3)
    const list = edges(kind), to = dir > 0 ? list.find(t => t > head + near) ?? duration : list.findLast(t => t < head - near) ?? 0
    if (extend) { anchor = origin(); select(anchor, to) }
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
    const [px, py] = local(event), span = end - start, L = lanes(), freqs = onFreqs(px, py, L), rect = freqs || L.spec.find(r => inside(r, px, py))
    const lines = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 400 : 1, across = Math.abs(event.deltaX) > Math.abs(event.deltaY)
    const factor = Math.exp(Math.max(-50, Math.min(50, event.deltaY * lines)) * .01)
    const levels = onLevels(px, py, L), wave = levels || L.wave.find(r => inside(r, px, py))
    if (event.ctrlKey || event.metaKey) return freqs ? zoomFreqs(factor, uy(freqs, py)) : levels ? zoomLevels(factor, ya(levels, py)) : zoom(factor, clamp(time(px)))
    if (rect && fview[1] - fview[0] < 1 && !across) {
      const du = event.deltaY * lines / rect[3] * (fview[1] - fview[0])
      return setFreqs(fview[0] - du, fview[1] - du)
    }
    // zoomed-in levels scroll up and down over the waveform, as zoomed-in frequencies do over the spectrogram
    if (wave && aview[1] - aview[0] < 2 && !across) return scrollLevels(aview[0] - event.deltaY * lines / wave[3] * (aview[1] - aview[0]))
    const delta = (across ? event.deltaX : event.deltaY) * lines
    setRange(start + delta / plot().w * span, end + delta / plot().w * span, true)
  }
  function select(a, b, f = null, keep = false) {
    chosen = null
    selection = a === b ? null : [Math.min(a, b), Math.max(a, b)]
    band = selection && f && f[1] > f[0] ? f : null
    if (!keep) more = []
    // a range that overlaps others takes them in (boxes stay boxes, a band apart whenever they meet)
    if (selection && !band && more.length) {
      const ranges = more.filter(r => r.length === 2)
      for (const r of ranges.filter(r => r[0] <= selection[1] && r[1] >= selection[0])) selection = [Math.min(selection[0], r[0]), Math.max(selection[1], r[1])]
      more = more.filter(r => r.length > 2 || r[1] < selection[0] || r[0] > selection[1])
    }
    // the caret at its start, as a text's
    if (selection) cursor = selection[0]
    told()
    invalidate()
  }
  const told = () => onselect(selection, band, ranges(), boxes())
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
    else if (selection || Math.abs(x(cursor) - x(t)) > EDGE) { more.push(current()); selection = band = null; cursor = clamp(t); oncursor(cursor) }
    told()
    invalidate()
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
    const [a, b] = selection, last = Math.max(...ranges().map(r => r[1])), gaps = segments.silences, list = edges('fragment')
    const near = (p, q) => Math.abs(p - q) < .03, on = t => list.some(c => Math.abs(c - t) < 1e-3)
    const next = gaps.some(([p, q]) => near(p, a) && near(q, b)) ? gaps.find(([p]) => p >= last - 1e-6)
      : on(a) && on(b) ? (() => { const i = list.findIndex(c => c >= last - 1e-3); return i >= 0 && i < list.length - 1 ? [list[i], list[i + 1]] : null })()
      : (() => { const g = gaps.find(([p]) => p > last + .03); if (!g) return null; const after = gaps.find(([p]) => p > g[1] + 1e-6); return [g[1], after ? after[0] : duration] })()
    if (next && next[1] > next[0]) { add(...next); reveal(next[1]) }
  }
  function setCursor(t) { chosen = null; cursor = clamp(t); oncursor(cursor); invalidate() }
  // A right-click, as in a text: outside what is selected it takes the caret there first, the selection gone; inside it,
  // with several carets, or on what a press would grab (a caret, an edge, a handle: the pointer says so), all stays.
  // Then the page's menu for it (`oncontext`), at the pointer
  function context(event) {
    event.preventDefault()
    const [px, py] = local(event), t = clamp(time(px))
    if (!duration || px > plot().w || py > plot().h + RULER) return
    // on a flag, the marker's own: name it, take it away
    const flag = nearMarker(px, py)
    if (flag >= 0) return oncontext({ x: event.clientX, y: event.clientY, marker: { ...markers[flag], rename: () => rename(flag) } })
    const kept = grabbing || (selection ? [selection, ...more].some(r => r[1] > r[0] && t >= r[0] && t <= r[1]) : more.length > 0)
    if (!kept) { select(0, 0); setCursor(stuck(snap(t))) }
    oncontext({ x: event.clientX, y: event.clientY })
  }
  function setScale(name) {
    scale = root.dataset.scale = name
    fview = [0, 1]; leveled = false
    invalidate()
  }
  // [a, b] s brought into sight, as an editor scrolls to what it selects: moved to show it, zoomed out to fit it
  function reveal(a, b = a) {
    const span = end - start
    if (b - a > span * .9) setRange(a - (b - a) * .05, b + (b - a) * .05)
    else if (a < start || b > end) setRange(a - span * .1, a + span * .9)
  }

  // Keys while the view has focus: arrows move the caret a hundredth of the view, by cues or sounds as a text's
  // words or lines, the selection kept; Shift extends the selection from where it started. Space and the transport
  // belong to the page.
  function key(event) {
    const mod = event.metaKey || event.ctrlKey, step = (end - start) / 100, k = event.key
    const to = t => {
      if (event.shiftKey) {
        anchor = origin()
        select(anchor, t)
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
    else if (k === '0' && !mod) { fview = [0, 1]; aview = [-1, 1]; setRange(0, duration) }
    else if (k === 'Escape' && chosen) { chosen = null; invalidate(true) }
    else if (k === 'Escape' && (selection || more.length)) select(0, 0)
    else if (mod && k.toLowerCase() === 'd') addNext()
    else if (mod && k.toLowerCase() === 'a') select(0, duration)
    // the marker chosen goes before what is selected: a range's flag pressed selects its audio, which stays
    else if ((k === 'Delete' || k === 'Backspace') && chosen) { const m = chosen; chosen = null; if (onedit('unmark', m)) markers = markers.filter(n => !same(n, m)); invalidate(true) }
    else if ((k === 'Delete' || k === 'Backspace') && ranges().length) onedit('remove', band ? selection : ranges())
    else if (mod && k.toLowerCase() === 'x' && selection && !band) onedit('cut', selection)
    else if (mod && k.toLowerCase() === 'c' && selection && !band) onedit('copy', selection)
    else if (mod && k.toLowerCase() === 'v') onedit('paste', (carets().length ? carets() : [cursor]).map(t => [t, t]))
    else if (mod && k.toLowerCase() === 'z') onedit(event.shiftKey ? 'redo' : 'undo')
    else if (mod && k.toLowerCase() === 'y') onedit('redo')
    else return
    event.preventDefault()
  }

  // A waveform and a spectrogram per channel; the spectrogram's silence is the page, seen through, its loudest white. How bright the
  // pair is drawn is the layers' own (light): dim while it is the file arriving, full once the output is there
  // Each waveform its colour (`hues`): the screen's; in one lane, its channel's hue (tint.js);
  // as gl-waveform takes it, [r, g, b, a], read once, so a stretch's colour and back costs no parsing
  let hues = [], swatch = null
  const rgba = css => {
    swatch ??= Object.assign(document.createElement('canvas'), { width: 1, height: 1 }).getContext('2d', { willReadFrequently: true })
    swatch.clearRect(0, 0, 1, 1)
    swatch.fillStyle = css
    swatch.fillRect(0, 0, 1, 1)
    return [...swatch.getImageData(0, 0, 1, 1).data].map(v => v / 255)
  }
  const FILLS = { density: { rms: false, density: true }, rms: { rms: null, density: false }, flat: { rms: false, density: false } }
  function lay(n) {
    while (waves.length > n) waves.pop().destroy()
    while (specs.length > n) specs.pop().destroy()
    for (let i = 0; i < n; i++) {
      hues[i] = waveLook.lanes === 'one' && n > 1 ? hue(i, n) : rgba(color('--color-screen-wave'))
      waves[i] ||= new Waveform(gl)
      if (sgl) (specs[i] ||= new Spectrogram(sgl, { background: color('--color-screen'), ...look })).update({ color: look.color ?? null })
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
    leveled = false
    if (!duration) { selection = band = null; start = end = 0; invalidate(); return }
    if (selection) selection = [Math.min(selection[0], duration), Math.min(selection[1], duration)]
    if (selection && selection[1] - selection[0] <= 0) selection = band = null
    more = more.map(([a, b, ...f]) => [Math.min(a, duration), Math.min(b, duration), ...f]).filter(([a, b]) => b > a || a === b && b < duration)
    cursor = Math.min(cursor, duration)
    if (all || end - start <= 0) setRange(0, duration)
    // a sound arriving, its length not known yet, is kept within it once it is (finish)
    else if (!(arriving && arriving.total == null) && (start >= duration || !stay && end > duration)) setRange(duration - (end - start), duration)
    else invalidate()
  }

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
  // The modifiers, wherever the focus is: what a press would do shows at once, before the pointer moves
  const modifier = event => {
    if (!['Meta', 'Control', 'Alt', 'Shift'].includes(event.key)) return
    held = event
    if (hovered && !drag) hover(...hovered, event)
    // pressed or let go during a drag, as though the pointer moved: a range on the spectrogram may become a box
    if (drag?.raw && !drag.pinch) { const keys = { pointerType: drag.last[0].pointerType, metaKey: event.metaKey, ctrlKey: event.ctrlKey, altKey: event.altKey, shiftKey: event.shiftKey }; drags(keys, ...aimed(keys, ...drag.raw)) }
    invalidate(true)
  }
  addEventListener('keydown', modifier)
  addEventListener('keyup', modifier)
  addEventListener('blur', () => { held = {}; if (hovered && !drag) hover(...hovered, held); invalidate(true) })
  new ResizeObserver(resize).observe(root)

  // A new output in place of the one shown. One an edit here drew ahead (`pieces`) takes its place without a move: the
  // view where it was, at its scale, the cues and markers where the edit took them. Another shows all of it where all
  // of the last showed; zoomed out past its end, the room on its right, at the same scale, while it fits there (a
  // reload, an edit that shortens it); its cues go if its length changed (they were the last one's), until its own
  // come, unless the view moved them to where they are in it (a cue dragged, `ahead`).
  let ahead = false, stay = false
  function replace(total) {
    const roomy = end > duration + 1e-9 && total != null && total <= end
    const expected = stay = !!pieces, all = !duration || !expected && whole() && !roomy
    if (expected) { cues = cues.map(moved).filter(t => t != null); markers = markers.map(m => ({ ...m, time: moved(m.time) })).filter(m => m.time != null) }
    else if (!ahead && total != null && Math.abs(total - duration) > 1e-9) cues = []
    ahead = false
    // an edit still being dragged keeps what it draws: the output arriving is an older one, from before the drag, and
    // the next move of the pointer lays the pieces out again over it
    if (!drag) pieces = null
    return all
  }

  return {
    // New output in place of the one shown (replace). One as long as it, at its rate, is drawn anew only where it differs
    // (an edit over a range, a band taken out): the rest of each picture, its levels and the view stay as they are.
    set(channels, sampleRate) {
      channels ||= []
      const all = replace(channels[0]?.length ? channels[0].length / (sampleRate || rate) : 0)
      if (!arriving && channels.length && channels.length === data.length && (sampleRate || rate) === rate && channels.every((y, c) => y.length === data[c].length)) {
        ended()
        const [i0, i1] = changed(data, channels)
        data = channels
        if (i1 > i0) channels.forEach((y, c) => { waves[c].set(y.subarray(i0, i1), i0); specs[c]?.set(y.subarray(i0, i1), i0) })
        tints.clear()
        return invalidate()
      }
      arriving = null
      ended()
      count = channels.length; rate = sampleRate || rate
      duration = channels[0]?.length ? channels[0].length / rate : 0
      lay(count)
      fill(data = channels)
      renew(all)
    },
    // A file held over the picture (a drag's event, or null when it leaves): where it would go in, the time under the
    // pointer, onto a cue or marker near it as a dragged caret goes; that time, or null
    dropAt(event) {
      dropped = event && duration ? stuck(snap(clamp(time(local(event)[0])))) : null
      invalidate(true)
      return dropped
    },
    // Samples of an output arriving as long as the one shown, from `at`: drawn where they differ from what shows, the
    // rest left as it is, so an edit's output comes in where it changes as it renders, nothing else drawn again
    patch(at, channels) {
      if (arriving || channels.length !== data.length) return
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
      invalidate()
    },
    // An output as it arrives: stream() starts it, `total` samples long where that is known, else as long as what has
    // come, `dim` while it is the file arriving, not yet the output; append() adds each piece; finish() ends it, its
    // length what came. A new file shows all of it; an output in place of the one shown keeps the view where it is
    // (zoomed in, it stays zoomed in), and that output's length until its own is known. `keep`: the view stays where it
    // is, a new file too (one coming into the view as it was left)
    stream({ sampleRate, channels, total = null, dim = false, keep = false }) {
      const all = (replace(total == null ? null : total / (sampleRate || rate)) || dim) && !keep
      ended()
      count = channels; rate = sampleRate || rate
      arriving = { total, length: 0, dim, fit: all }
      duration = total ? total / rate : all ? 0 : duration
      lay(count)
      fill(waves.map(() => new Float32Array(0)))
      data = []
      if (dim) { selection = band = null; more = [] }
      renew(all)
    },
    append(channels) {
      if (!arriving) return
      channels.forEach((data, i) => { waves[i]?.push(data); specs[i]?.push(data) })
      arriving.length += channels[0].length
      // past what was expected, or with nothing expected: as long as what has come; all of it shown as it grows, unless
      // the view was zoomed in meanwhile
      const all = arriving.fit && whole()
      if (arriving.length / rate > duration) duration = arriving.length / rate
      if (all) setRange(0, duration)
      else invalidate()
    },
    finish() {
      if (!arriving) return
      const all = arriving.fit && whole()
      duration = arriving.length / rate
      arriving = null
      lay(count)
      renew(all)
    },
    // A take recorded over the output from `at` s, drawn as it comes (take), grown by each block of channels (grow), and
    // drawn until the output that holds it arrives (set, stream); take(null) drops it at once
    take(opts) {
      ended()
      if (!opts) { pieces = null; return invalidate() }
      const { at, sampleRate, channels } = opts
      // into nothing: its lanes, and the scale a take is watched at
      if (!duration) { count = channels; rate = sampleRate; lay(count); start = at; end = at + RECORD }
      recording = { at, rate: sampleRate, length: 0, total: duration, data: Array.from({ length: channels }, () => new Float32Array(sampleRate)),
        waves: Array.from({ length: channels }, () => new Waveform(gl)),
        specs: sgl ? Array.from({ length: channels }, () => new Spectrogram(sgl, { background: color('--color-screen'), ...look, color: look.color ?? null, sampleRate })) : [] }
      leveled = false
      taking()
    },
    grow(blocks) {
      if (!recording) return
      const n = recording.length, m = blocks[0]?.length ?? 0
      if (m) recording.data = recording.data.map((x, c) => {
        if (n + m > x.length) { const y = new Float32Array(Math.max(2 * x.length, n + m)); y.set(x.subarray(0, n)); x = y }
        x.set(blocks[c] ?? blocks[0], n)
        return x
      })
      if (m) for (const list of [recording.waves, recording.specs]) list.forEach((picture, c) => picture.push(blocks[c] ?? blocks[0]))
      recording.length += m
      leveled = false
      taking()
    },
    get duration() { return duration },
    // the whole output's samples, once an output drawn as it arrived has all come: what its colours are read from
    set samples(channels) { data = channels || []; tints.clear(); invalidate() },
    // how the waveform draws: { colour, lanes, fill } (waveLook)
    set waveform(o) { waveLook = { ...waveLook, ...o }; lay(count); tints.clear(); invalidate() },
    // an edit drawn ahead of its output: the output waits whole to take its place
    get expecting() { return !!pieces },
    get range() { return [start, end] },
    // What shows, as a tab keeps it and the page restores it: the time, the frequencies, the levels; none without a sound.
    // Set, it shows that again, within the sound as it is now
    // Set while the sound arrives, it shows that at once, the sound coming into it, its length not yet known: what arrives
    // no longer fits the view, and the view moves only as it is moved (finish() keeps it within the sound)
    // With it, the sound's shape, to lay the lanes out as they were before any of it comes: its length, rate, channels
    get frame() { return duration || arriving ? { range: [start, end], freqs: [...fview], levels: [...aview], duration, rate, channels: count } : null },
    set frame(f) {
      const ok = p => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite) && p[1] > p[0]
      if (!f || !duration && !arriving) return
      if (ok(f.freqs)) setFreqs(...f.freqs)
      if (ok(f.levels)) scrollLevels(f.levels[0], Math.max(2e-3, Math.min(8, f.levels[1] - f.levels[0])))
      if (!ok(f.range)) return
      if (!arriving) return setRange(...f.range, true)
      arriving.fit = false
      start = Math.max(0, f.range[0]); end = Math.max(start + 32 / rate, f.range[1])
      invalidate()
    },
    // What is selected, whole, as the history keeps it beside a step: the selection, its band, the others beside it,
    // the caret, where the selection was begun; set, all of it back as it was
    get state() { return { selection: selection && [...selection], band: band && [...band], more: more.map(r => [...r]), cursor, anchor } },
    set state(s) {
      ({ cursor, anchor } = s)
      selection = s.selection && [...s.selection]; band = s.band && [...s.band]; more = s.more.map(r => [...r])
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
    set display(mode) {
      display = mode
      if (mode === 'wave' && band) { band = null; more = more.filter(r => r.length === 2); told() }
      invalidate()
    },
    get scale() { return scale },
    set scale(name) { setScale(name) },
    // what shows besides the sound (hits, pitch, gain, meters), as the View menu has it; with the meters, the
    // spectrogram fades out before its spectrum (repl.css)
    set show(flags) { show = { ...flags }; root.toggleAttribute('data-meters', !!show.meters); invalidate() },
    // whether a dragged or pressed time goes onto a cue or marker near it; the curve the fade corners draw and make
    set snapping(on) { snapping = on },
    set fadeCurve(name) { fadeCurve = CURVES[name] ? name : 'linear'; invalidate(true) },
    set units(name) { units = name; invalidate(true) },
    // how the time row marks time: 'labels', 'ticks', 'none'
    set ruler(mode) { ruler = mode; invalidate(true) },
    // how the sound's end shows (WORKSHOP): 'line', 'hatch', 'dots', 'ruler'
    set endMark(name) { endMark = name; invalidate(true) },
    // how the lanes are ruled (WORKSHOP): 'marks', 'crosses', 'dots', 'none'
    set grid(name) { grid = name; invalidate(true) },
    // the steps, dB, a selection's level goes in as its pill is dragged
    set levelStep(db) { levelStep = +db || 1 },
    // how the spectrogram draws: { map, gamma, depth, size } (repl.js spectrogram settings), as gl-spectrogram takes them
    set spectrogram(o) { look = o; for (const sg of [...specs, ...recording?.specs ?? []]) sg.update(look); leveled = false; invalidate() },
    // how the level axis writes levels: 'db' or 'linear'
    set levels(name) { levelUnits = name === 'linear' ? 'linear' : 'db'; invalidate(true) },
    // what the meters read now: { levels: [{ rms, peak }], spectra: [dB per bin], size, rate }, or null
    set meters(m) { meters = m; invalidate(true) },
    // the pauses: { silences: [[start, end], …] } in seconds
    set segments(list) { segments = list || { silences: [] } },
    // where the output clips: [[from, to], …] s
    set clips(list) { clips = list || []; invalidate(true) },
    // the output's markers, [{ time, duration?, label }]
    set markers(list) { markers = list || []; invalidate(true) },
    // a marker just made, { time, duration? }: drawn at once, before the output that has it comes, its name asked for
    name(m) {
      if (!markers.some(n => same(n, m))) markers = [...markers, { ...m, label: '' }].sort((p, q) => p.time - q.time)
      rename(markers.findIndex(n => same(n, m)))
    },
    set cues(list) { cues = list || []; invalidate() },
    // what the grip does: 'trim', 'stretch' or 'speed'; whether pitch is edited
    set gripMode(mode) { gripMode = ['trim', 'speed'].includes(mode) ? mode : 'stretch'; invalidate(true) },
    set pitching(on) { pitching = !!on; invalidate(true) },
    set envelope(curve) { envelope = curve; invalidate() },
    // the pitch line the script has, semitones { t, v }, the line edited when pitch is
    set shift(curve) { shift = curve; invalidate() },
    // The output's pitch, { times, f0 } (Hz every 10 ms, 0 where there is none), and `shift`, the pitch line it was
    // measured with, so the curve shows the line's changes since at once
    set contour(track) {
      contour = track && { ...track, basis: track.shift ? track.shift.t.map((t, i) => [t, track.shift.v[i]]) : [] }
      landed = null
      invalidate()
    },
    set guides(list) { guides = list || []; invalidate() },
    // While playing, a zoomed view scrolls with the playhead held in the middle; at the ends the playhead walks. The
    // playhead is the overlay's: the pictures are drawn again only as the view scrolls
    set playhead(t) {
      playhead = t
      const span = end - start
      if (t != null && !drag && span < duration && (t > start + span / 2 || t < start)) setRange(t - span / 2, t + span / 2)
      invalidate(true)
    },
    // The picture a step's new settings will leave, drawn at once from what shows: its level changed by `gain(t)` (ops.js
    // previews), step by step, a pixel's time apart where it is in view, until its output comes; null draws the output
    preview(gain) {
      if (!gain || !duration) { pieces = null; return invalidate() }
      const fine = (end - start) / plot().w, coarse = duration / 256, cuts = []
      for (let t = 0; t < duration; t += t >= start - fine && t < end ? fine : coarse) cuts.push(t)
      cuts.push(duration)
      pieces = []
      for (let i = 1; i < cuts.length; i++) {
        const s0 = cuts[i - 1], s1 = cuts[i], g = gain((s0 + s1) / 2), last = pieces.at(-1)
        if (last && Math.abs(last.gain - g) < 1e-4) last.s1 = last.d1 = s1
        else pieces.push({ s0, s1, d0: s0, d1: s1, gain: g })
      }
      invalidate()
    },
    // The picture an edit of [a, b] will leave, drawn at once from what shows now, until its output comes: 'remove',
    // 'cut', 'crop', or 'gain' by `db`; null draws the output as it is
    expect(kind, range, db = 0) { pieces = !kind || !range ? null : Array.isArray(range[0]) ? arrange(kind === 'gain' ? 'gains' : 'removes', range, 0, 0, db) : arrange(kind, ...range, range[0], db); invalidate() },
    // every range selected, in time order, and every caret; addNext() adds the next like the selection (⌘D)
    get ranges() { return ranges() }, get carets() { return carets() }, get boxes() { return boxes() }, addNext,
    select, setCursor, around, step: stepTo,
    zoom, zoomTo: (a, b) => { const pad = (b - a) * .05; setRange(a - pad, b + pad) }, fit: () => { fview = [0, 1]; aview = [-1, 1]; setRange(0, duration) },
    // the picture of a range, for an agent; a range or a time brought into sight
    snapshot, reveal
  }
}
