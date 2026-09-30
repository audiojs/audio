import Waveform from '../assets/gl-waveform.js'
import Spectrogram from '../assets/gl-spectrogram.js'
import scales from './scale.js'
import { CURVES } from './ops.js'
import clock from './time.js'

// The output as a picture: the waveform or the spectrogram, one at a time. A lane per channel, apart by a gap: each
// channel reads on its own (a sound panned to one side, a different take); the caret, the playhead, a selection and the
// cues are drawn in each lane, never across the gap, which holds no sound. Levels (in dB or as sample values, `levels`)
// or frequencies on the right, each under its tick, the lowest frequency at the lane's foot; the meters just before
// them; times on the row below, each label with its tick beside it, and the pointer's time on the same row, where a
// press would take it. Times go by the zoom's precision, a 1-2-5 step of a pixel or a little more, and read with all its
// decimals, so the script gets the numbers the view shows. Near a mark on the right (a frequency, a level) the pointer
// takes its value. The wheel scrolls; a pinch, or Ctrl and the wheel, zooms the axis under the pointer: time, the
// frequencies, or the levels (a quiet sound magnified, or what goes over full scale shown).
// One gesture, select, as in a text: a press puts the caret and sounds the moment under it, a drag selects (on the
// spectrogram, a time and frequency box; with Shift, one axis of it, the other whole), a double-click selects between
// the cues (the hits found, the markers) around it, or the pause it is in, and a triple-click the phrase between longer
// pauses; however made, a selection puts the caret at its start. The caret and a range's edges drag, an edge lighting
// when a press would take it. Alt adds another caret, or with a drag another range, as a text editor's.
// A pressed or dragged time goes onto a cue or a marker within a few pixels of it, which lights, as Figma's objects snap
// (`snapping`). A selection's handles each do one thing, and say what when the pointer is on one, as its edges say which
// and where: its top corners, drawn as the fade they make, fade it (inward, from its edge; outward, a fade centred on its
// edge; a click asks for the fade's curve, `oncurve`), the pill on its top edge sets its level (on the spectrogram, its
// pitch), the grip in each lane's bottom right corner stretches it. What else shows (`show`) is grabbed where it is,
// never through a mode: the cues (a drag of one on the time row moves it, the audio around it stretching), the gain line
// and its points, the pitch curve's voiced stretches. Holding the caret or dragging it, or an edge, hears the moment
// under it (`onscrub`; a box, only its band).
// The view never changes audio: edits go to the script through `onedit`.
const GUTTER = 52, RULER = 24, GAP = 12, EDGE = 6, SNAP = 6, CORNER = 11, INSET = 3
const mac = /Mac|iP(hone|ad|od)/.test(navigator.platform)
const LEVELS = [0, -6, -12, -24, -48, -18, -36, -30, -60, -72, 6, 12]  // dBFS the level axis marks, halvings first, where they fit
const TICK = 12                               // a tick's length on either axis, px
const VOICE = [60, 1000]                      // the pitch axis when no spectrogram shows, Hz, on a log scale
const GAIN = [-36, 12]                        // the gain line's scale, dB: the lane's centre line to its edges, 0 dB
                                              // three quarters of the way out, so a boost shows above it

export default function view(root, { onselect = () => {}, oncursor = () => {}, onedit = () => {}, oncurve = () => {}, onscrub = () => {}, onbox = () => {} } = {}) {
  const layer = name => root.appendChild(Object.assign(document.createElement('canvas'), { className: name }))
  const specCanvas = layer('spectrum'), waveCanvas = layer('waveform'), overlay = layer('overlay')
  // gl-waveform draws its own anti-aliased coverage; the context needs premultiplied alpha, not multisampling
  const gl = waveCanvas.getContext('webgl2', { premultipliedAlpha: true, antialias: false })
  // gl-spectrogram computes what a lane shows as it draws it, on the GPU, from the samples it holds: nothing to wait
  // for. It renders into float textures (EXT_color_buffer_float, which nearly every WebGL2 has)
  let sgl = specCanvas.getContext('webgl2', { premultipliedAlpha: true, antialias: false })
  if (!sgl?.getExtension('EXT_color_buffer_float')) sgl = null
  const c = overlay.getContext('2d')
  const style = getComputedStyle(root)
  const color = name => style.getPropertyValue(name).trim()
  let waves = [], specs = [], count = 0, rate = 44100, duration = 0, display = 'wave', scale = 'log', units = 'clock', hovered = null
  // what shows besides the sound; the pauses in it, short and long, for selecting and stepping as in a text
  let show = { hits: true, pitch: false, gain: true, meters: true }, segments = { silences: [], pauses: [] }
  // the output's markers: [{ time, label }], flags on the time row
  let markers = []
  // an output arriving: { total, length, dim, fit }; total samples where known, `dim` while it is the file, not the output
  let arriving = null
  // more ranges beside the selection, as a text editor's several selections: [[a, b], …]; edits act on them all
  let more = []
  // the meters at the right edge: each channel's { rms, peak } and spectrum (dB per bin of `size` at `rate`), or none
  let meters = null
  // A take being recorded over the output (a tape's punch-in): from `at` s, its `length` samples at `rate`, a waveform per
  // channel; the output it replaces hidden, the output after it where it is
  let recording = null
  function taking() {
    const { at, total } = recording, last = at + recording.length / recording.rate
    duration = Math.max(total, last)
    // the view follows the take past its right edge, as it follows the playhead
    if (last > end) setRange(last - (end - start) * .9, last + (end - start) * .1)
    pieces = [{ s0: 0, s1: at, d0: 0, d1: at }, { s0: last, s1: total, d0: last, d1: total }].filter(p => p.s1 > p.s0)
    invalidate()
  }
  function ended() {
    if (!recording) return
    for (const wave of recording.waves) wave.destroy()
    duration = recording.total
    recording = null
  }
  // The picture as an edit leaves it, before its output comes: pieces of the output as it is, each drawn where it goes
  // (a move, a copy over, a stretch, a level while dragged; a delete, a cut, a crop once written), [{ s0, s1, d0, d1,
  // gain }] in seconds, the span it shows and the span it goes to. None: the output as it is.
  let pieces = null
  // the time shown [start, end], and the part of the spectrogram's frequency axis shown, 0..1 on its scale
  let start = 0, end = 0, fview = [0, 1], selection = null, band = null, cursor = 0, playhead = null, guides = []
  let cues = [], envelope = null, contour = null, snapping = true, fadeCurve = 'linear'
  // the level at a waveform lane's edges (1 is full scale: less magnifies a quiet sound, more shows what goes over), and
  // how the axis writes levels: 'db', mirrored about the centre line, or 'linear', the sample values, signed
  let amp = 1, levelUnits = 'db'
  let W = 0, H = 0, dpr = 1, frame = 0, leveled = false, drag = null, anchor = null
  const pointers = new Map()

  // Geometry, in CSS pixels
  const plot = () => ({ w: Math.max(1, W - GUTTER), h: Math.max(1, H - RULER) })
  function lanes() {
    const { w, h } = plot(), n = Math.max(1, count), lh = (h - GAP * (n - 1)) / n
    const stack = Array.from({ length: n }, (_, i) => [0, i * (lh + GAP), w, lh])
    return shape() === 'spec' ? { wave: [], spec: stack } : { wave: stack, spec: [] }
  }
  // the lanes' top and bottom
  const extent = rects => [Math.min(...rects.map(r => r[1])), Math.max(...rects.map(r => r[1] + r[3]))]
  // the middle of the time row, where its labels, the cues' ticks and the pointer's time read
  const row = () => plot().h + RULER / 2
  // a file arriving shows as a waveform, whatever the picture shows: there are no frames of it yet
  const shape = () => arriving?.dim ? 'wave' : display
  const x = t => (t - start) / (end - start || 1) * plot().w
  const time = px => start + px / plot().w * (end - start)
  const clamp = t => Math.max(0, Math.min(duration, t))
  // the 1-2-5 step just above `res`
  const nice = res => { const p = 10 ** Math.floor(Math.log10(res)); return [1, 2, 5, 10].map(m => m * p).find(s => s >= res * (1 - 1e-9)) }
  // Times go by the 1-2-5 step just above a pixel's time, down to a microsecond, and read with the decimals it needs, one
  // at least: 5.0s, 5.05s, 5.000s. The frequency marks and level lines take the pointer within SNAP px.
  const unit = () => Math.max(1e-6, nice((end - start || 1) / plot().w))
  const digits = () => Math.max(1, Math.min(6, Math.ceil(-Math.log10(unit()) - 1e-9)))
  const snap = t => { const u = unit(); return clamp(+(Math.round(t / u) * u).toFixed(digits())) }
  const snapF = (rect, py) => marks().find(f => Math.abs(fy(rect, f) - py) <= SNAP) ?? yf(rect, py)
  // A time dragged within SNAP px of a cue (while they show) or a marker goes onto it, as Figma's objects snap: the
  // nearest, { t, d } with its distance in px, or null
  function stick(t) {
    let best = null
    if (!snapping) return best
    for (const q of [...(show.hits ? cues : []), ...markers.map(m => m.time)]) {
      const d = Math.abs(x(q) - x(t))
      if (d <= SNAP && (!best || d < best.d)) best = { t: q, d }
    }
    return best
  }
  const stuck = t => stick(t)?.t ?? t
  // The gain line in a lane, mirrored about its centre line: dB ↔ y on its own scale (GAIN), snapping to 0 dB
  const gy = ([, y, , lh], db, sign = 1) => y + lh / 2 - sign * Math.max(0, Math.min(1, (db - GAIN[0]) / (GAIN[1] - GAIN[0]))) * lh / 2
  const gainOf = ([, y, , lh], py) => GAIN[0] + Math.min(1, Math.abs(py - y - lh / 2) / (lh / 2)) * (GAIN[1] - GAIN[0])
  const snapDb = (rect, py) => Math.abs(gy(rect, 0) - fold(rect, py)) <= SNAP ? 0 : Math.round(gainOf(rect, py) * 10) / 10
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
  // Amplitude ↔ y: `amp` at the lane's edges, silence on its axis
  const ay = ([, y, , lh], a, sign = 1) => y + lh / 2 - sign * Math.min(1, a / amp) * lh / 2
  // the gain curve mirrors about the centre line: either half grabs and drags it
  const fold = ([, y, , lh], py) => y + lh / 2 - Math.abs(py - y - lh / 2)
  const nearPoint = (rect, px, py) => ([t, v]) => Math.abs(x(t) - px) <= EDGE && Math.abs(gy(rect, v) - fold(rect, py)) <= EDGE + 2
  // the point nearest the pointer among those near it, or -1
  const pointAt = (rect, px, py) => {
    let best = -1, d = Infinity
    envelopePoints().forEach((p, i) => { const e = Math.hypot(x(p[0]) - px, gy(rect, p[1]) - fold(rect, py)); if (nearPoint(rect, px, py)(p) && e < d) { d = e; best = i } })
    return best
  }
  // Lanes the overlays draw in: pitch over the spectrogram if it shows, amplitude over the waveform if it shows
  const ampLanes = L => L.wave.length ? L.wave : L.spec
  const pitchLanes = L => L.spec.length ? L.spec : L.wave

  // A canvas resized is blank until drawn again, and the browser shows what is there at the next paint: drawn here,
  // in the resize callback before that paint, a divider dragged never flashes an empty picture.
  function resize() {
    const r = root.getBoundingClientRect(), d = devicePixelRatio || 1, cw = Math.round(r.width * d), ch = Math.round(r.height * d)
    W = r.width; H = r.height; dpr = d
    for (const canvas of [specCanvas, waveCanvas, overlay]) if (canvas.width !== cw || canvas.height !== ch) { canvas.width = cw; canvas.height = ch }
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
  // The output's pieces after an edit of [a, b]: moved to start at `to` (the rest closing up behind it), copied over
  // what is at `to`, stretched to end at `to` (what follows moving with it), `db` louder; or gone (remove, cut), or all
  // that stays (crop)
  function arrange(kind, a, b, to = a, db = 0) {
    const T = duration, d = b - a, g = 10 ** (db / 20)
    const run = (list, at = 0) => list.filter(([s0, s1]) => s1 > s0).map(([s0, s1, gain = 1]) => { const p = { s0, s1, d0: at, d1: at + s1 - s0, gain }; at = p.d1; return p })
    if (kind === 'move') return run(to <= a ? [[0, to], [a, b], [to, a], [b, T]] : [[0, a], [b, b + to - a], [a, b], [b + to - a, T]])
    if (kind === 'copy') return run([[0, to], [a, b], [to + d, T]])
    if (kind === 'stretch') return [...run([[0, a]]), { s0: a, s1: b, d0: a, d1: to, gain: g }, ...run([[b, T]], to)]
    if (kind === 'gain') return run([[0, a], [a, b, g], [b, T]])
    if (kind === 'remove' || kind === 'cut') return run([[0, a], [b, T]])
    if (kind === 'removes') return run([...a.map((r, i) => [i ? a[i - 1][1] : 0, r[0]]), [a.at(-1)[1], T]])
    if (kind === 'gains') return run(a.flatMap((r, i) => [[i ? a[i - 1][1] : 0, r[0]], [r[0], r[1], g]]).concat([[a.at(-1)[1], T]]))
    if (kind === 'crop') return run([[a, b]])
    return null
  }
  // A fade drawn at once: what it covers in 48 steps, each at its level on the fade's curve (fn/fade.js); in or out
  // over [t0, t1]
  function faded(kind, t0, t1, n = 48) {
    const len = t1 - t0, c = CURVES[fadeCurve], level = u => Math.max(1e-4, c(kind === 'in' ? u : 1 - u))
    const list = [[0, t0, 1], ...Array.from({ length: n }, (_, i) => [t0 + len * i / n, t0 + len * (i + 1) / n, level((i + .5) / n)]), [t1, duration, 1]]
    return list.filter(([s0, s1]) => s1 > s0).map(([s0, s1, gain]) => ({ s0, s1, d0: s0, d1: s1, gain }))
  }

  // A frame: the pictures when they changed, the overlay always; the pointer's readout redraws only the overlay
  let pictures = false
  function invalidate(overlay = false) { pictures ||= !overlay; frame ||= requestAnimationFrame(render) }
  function render() {
    frame = 0
    const L = lanes(), from = start * rate, to = end * rate
    if (!pictures) return paint(L)
    pictures = false
    if (gl) {
      gl.viewport(0, 0, waveCanvas.width, waveCanvas.height)
      gl.clearColor(0, 0, 0, 0)
      gl.clear(gl.COLOR_BUFFER_BIT)
      // the canvas's own device-to-CSS ratio, exact after rounding its size
      const ratio = waveCanvas.width / (W || 1)
      waves.forEach((wave, i) => {
        const rect = L.wave[i]
        if (!rect) return
        if (!pieces) return wave.update({ range: [from, to], viewport: rect, pixelRatio: ratio, amplitude: [-amp, amp] }).render()
        for (const p of spans()) wave.update({ range: [p.from, p.to], viewport: [rect[0] + p.x0, rect[1], p.x1 - p.x0, rect[3]], pixelRatio: ratio, amplitude: [-amp / p.gain, amp / p.gain] }).render()
      })
      // a take being recorded, where it goes, in every lane of either picture: its own waveform over what it replaces
      if (recording?.length) [...L.wave, ...L.spec].forEach((rect, i) => {
        const wave = recording.waves[Math.min(i % Math.max(1, count), recording.waves.length - 1)], x0 = x(recording.at), x1 = x(recording.at + recording.length / recording.rate)
        if (x1 > x0) wave.update({ range: [0, recording.length], viewport: [rect[0] + x0, rect[1], x1 - x0, rect[3]], pixelRatio: ratio, amplitude: [-amp, amp] }).render()
      })
    }
    if (sgl) spectrograms(L, from, to)
    paint(L)
  }
  // Each channel's spectrogram in its lane, the part of its scale shown; an edit's pieces each where it goes, at its
  // level. One scale of levels for the lanes, the loudest channel's, so channels compare as they sound (each its own
  // while an output arrives). Zoomed out, a render leaves columns short of frames: it draws again until they are whole.
  function spectrograms(L, from, to) {
    sgl.disable(sgl.SCISSOR_TEST)
    sgl.viewport(0, 0, specCanvas.width, specCanvas.height)
    sgl.clearColor(0, 0, 0, 0)
    sgl.clear(sgl.COLOR_BUFFER_BIT)
    if (!L.spec.length || !specs.length) return
    const [lo, hi] = freqs(), band = fview.map(u => scales[scale].of(u, lo, hi)), ratio = specCanvas.width / (W || 1)
    for (const sg of specs) sg.update({ scale, band, pixelRatio: ratio })
    if (!leveled && !arriving) {
      const loudest = specs.map(sg => sg.update({ levels: null }).levels).reduce((a, b) => b[1] > a[1] ? b : a)
      for (const sg of specs) sg.update({ levels: loudest })
      leveled = true
    }
    specs.forEach((sg, i) => {
      const rect = L.spec[i]
      if (!rect) return
      if (!pieces) return sg.update({ range: [from, to], viewport: rect, gain: 1 }).render()
      for (const p of spans()) sg.update({ range: [p.from, p.to], viewport: [rect[0] + p.x0, rect[1], p.x1 - p.x0, rect[3]], gain: p.gain }).render()
    })
    if (specs.some(sg => sg.pending)) invalidate()
  }

  // The overlay: selection, guides, what shows besides the sound, caret, playhead, the pointer's readouts, axes.
  function paint(L) {
    const { w, h } = plot()
    c.setTransform(dpr, 0, 0, dpr, 0, 0)
    c.clearRect(0, 0, W, H)
    box(L)
    if (!duration) return
    c.font = `10px ${color('--font-mono')}`
    c.textBaseline = 'middle'
    const all = [...L.wave, ...L.spec], dim = color('--color-screen-dim')
    // what runs through time is drawn in each lane, never across the gap between two, which holds no sound
    const across = (px, width) => { for (const [, y, , lh] of all) c.fillRect(px, y, width, lh) }
    // selection: a time range in every lane, or a box on the spectrogram
    const sel = drag?.carry && drag.moved ? [drag.to, drag.to + drag.b - drag.a] : drag?.stretch ? [drag.a, drag.to] : selection
    paintSelection(L, sel)
    for (const guide of guides) paintGuide(guide, L, across)
    // a fade as it is dragged, the waveform under it drawn faded
    if (drag?.span) paintGuide({ ramps: [[...drag.span, drag.fade, fadeCurve]] }, L, across)
    // the pointer, read out on the axes: its time on the time row, as the script will get it (a dragged edge's, a snapped
    // one's), the labels there giving way to it; its level or frequency by its lane
    const at = hovered && hovered[0] >= 0 && hovered[0] <= w ? hovered : null, lane = at && all.find(r => inside(r, ...at))
    const pointed = at && (drag?.span ? drag.p : drag?.stretch ? drag.to : drag?.hear ?? stuck(snap(time(at[0]))))
    const hint = at && stamp(pointed)
    const px = at && Math.round(x(pointed)), hx = at && Math.min(px + 4, w - c.measureText(hint).width - 3)
    paintRuler(at && [px - 4, hx + c.measureText(hint).width + 4])
    // the times a drag's edges are at, or the caret dragged: the cues and markers they sit on light
    const lit = drag?.caret ? [cursor] : drag?.anchor != null || drag?.carry || drag?.stretch ? sel || [] : drag?.span || []
    if (show.hits) paintCues(all, lit)
    paintMarkers(all, lit)
    if (show.gain && (envelope || drag?.points)) paintEnvelope(ampLanes(L))
    if (show.pitch) paintContour(pitchLanes(L))
    // a line in each lane: the caret (and the others beside it), or while it plays the playhead, which is the caret
    // moving; while an output arrives, where it has come to
    const line = (t, fill) => { const px = Math.round(x(t)); if (px < 0 || px > w) return; c.fillStyle = fill; across(px, 1) }
    if (arriving) line(arriving.length / rate, color('--color-screen-soft'))
    if (playhead != null) line(playhead, color('--color-screen-bright'))
    else line(cursor, color('--color-screen-caret'))
    for (const [p, q] of more) if (q === p) line(p, color('--color-screen-caret'))
    fadeLanes(L)
    paintGrips(L, at)
    // a selection's edge under the pointer says which it is and where
    if (at && lane && hot != null && selection && !drag) {
      const t = selection[hot], text = `${hot ? 'End' : 'Start'} ${stamp(t)}`, tw = c.measureText(text).width, ex = Math.round(x(t))
      tag(text, hot ? ex - tw - 6 : ex + 6, clampY(lane, at[1]), 'left')
    }
    if (meters && show.meters) paintMeters(L)
    // right axis: levels by the waveform, frequencies by the spectrogram (or the voice range for pitch), each label
    // under its tick
    c.textAlign = 'left'
    const near = rect => rect === lane ? Math.round(at[1]) : null
    for (const rect of L.wave) {
      if (show.pitch && contour?.f0.length && !L.spec.length) { hz(rect, near(rect)); continue }
      ticks(rect, levelMarks(rect), near(rect))
    }
    for (const rect of L.spec) hz(rect, near(rect))
    // the pointer's values; what a drag does, in a few words by it
    c.textAlign = 'left'
    const doing = drag && at && acting()
    if (doing) { c.font = `11px ${color('--font-mono')}`; tag(doing, Math.min(at[0] + 12, w - c.measureText(doing).width - 6), Math.max(12, at[1] - 16), 'left'); c.font = `10px ${color('--font-mono')}` }
    if (at) {
      c.fillStyle = color('--color-screen-muted')
      c.fillRect(px, row() - 6, 1, 12)
      tag(hint, hx, row(), 'left')
      // a frequency under its tick, as the axis has them; a level on its line
      if (lane) {
        const ly = Math.round(at[1]), text = pitched(lane, L) ? hertz(snapF(lane, at[1])) : level(lane, at[1])
        c.fillStyle = color('--color-screen-bright')
        c.fillRect(w + 1, ly, TICK, 1)
        tag(text, w + 1, ly + 9, 'left')
      }
    }
  }
  // What is drawn in the lanes (a selection, the cues, the caret) fades out where the pictures do (repl.css): before
  // the labels, or before the spectrum on a spectrogram with meters, so a line runs on into the fade as the sound does,
  // and never across the spectrum or the labels. The same steps as the pictures' mask, an exponential: erased by .45,
  // .73, .90, .96 and all of it, 8, 16, 24, 28 and 32 px in.
  const FADE = [[0, 0], [.25, .45], [.5, .73], [.75, .9], [.875, .96], [1, 1]]
  function fadeLanes(L) {
    const { w } = plot(), end = L.spec.length && meters && show.meters ? w - METER - 4 : w
    const across = c.createLinearGradient(end - 32, 0, end, 0)
    for (const [u, a] of FADE) across.addColorStop(u, `rgba(0, 0, 0, ${a})`)
    c.save()
    c.globalCompositeOperation = 'destination-out'
    c.fillStyle = across
    for (const [, y, , lh] of [...L.wave, ...L.spec]) c.fillRect(end - 32, y, w - end + 32, lh)
    c.restore()
  }
  // A time selection's handles, each doing one thing, where it is wide enough for them: in its top corners the fade
  // each makes, its curve as the fade menu draws it, a little inside the edge; the pill on its top edge sets its level
  // (its pitch on the spectrogram); the grip in each lane's bottom right corner, as a text area's, stretches it.
  // [kind, x, y] each, a corner's x its edge; one being dragged stays under the pointer, where its fade reaches.
  function grips(L) {
    if (!selection || band || drag?.carry || drag?.stretch) return []
    const all = [...L.wave, ...L.spec], [top] = extent(all), [a, b] = selection, xa = x(a), xb = x(b), out = []
    if (xb - xa >= 2 * (CORNER + INSET) + 8) out.push(['in', drag?.fade === 'in' && drag.span ? x(drag.p) : xa, top], ['out', drag?.fade === 'out' && drag.span ? x(drag.p) : xb, top])
    if (xb - xa >= 72 && !drag?.fade) out.push(['level', (xa + xb) / 2, top + 4])
    if (xb - xa >= 20 && !drag?.fade) for (const [, y, , lh] of all) out.push(['stretch', xb, y + lh])
    return out.filter(([, gx]) => gx >= 0 && gx <= plot().w)
  }
  // a grip within reach of the pointer: a corner's curve and a little round it, the pill and the grip their shapes
  const reach = { in: [-2, CORNER + INSET + 3, -2, CORNER + INSET + 3], out: [-CORNER - INSET - 3, 2, -2, CORNER + INSET + 3], level: [-16, 16, -7, 7], stretch: [-14, 1, -14, 1] }
  const gripAt = (L, px, py) => grips(L).find(([k, gx, gy]) => { const [x0, x1, y0, y1] = reach[k]; return px - gx >= x0 && px - gx <= x1 && py - gy >= y0 && py - gy <= y1 })
  const gripName = (kind, L) => ({ in: 'Fade in', out: 'Fade out', level: L.spec.length ? 'Pitch' : 'Level', stretch: 'Stretch' })[kind]
  // Soft lines, over a halo of the screen's colour so they show over the waveform; the one under the pointer, or dragged,
  // bright, and it says what it does
  function paintGrips(L, at) {
    const list = grips(L), under = at && !drag && gripAt(L, ...at), busy = drag?.fade ?? (drag?.stretch ? 'stretch' : drag?.lift ? 'level' : null)
    c.lineCap = c.lineJoin = 'round'
    for (const [kind, gx, gy] of list) {
      c.beginPath()
      // the fade's curve from silence at the edge to full level, CORNER px across, INSET px in from the corner
      if (kind === 'in' || kind === 'out') {
        const dir = kind === 'in' ? 1 : -1, curve = CURVES[fadeCurve], x0 = gx + dir * INSET, y0 = gy + INSET
        for (let i = 0; i <= 12; i++) c.lineTo(x0 + dir * CORNER * i / 12, y0 + CORNER * (1 - curve(i / 12)))
      }
      else if (kind === 'level') { c.moveTo(gx - 8, gy); c.lineTo(gx + 8, gy) }
      else { c.moveTo(gx - 10, gy - 3); c.lineTo(gx - 3, gy - 10); c.moveTo(gx - 6, gy - 3); c.lineTo(gx - 3, gy - 6) }
      c.strokeStyle = color('--color-screen')
      c.lineWidth = kind === 'level' ? 5 : 3.5
      c.stroke()
      c.strokeStyle = color(under?.[0] === kind || busy === kind ? '--color-screen-bright' : '--color-screen-soft')
      c.lineWidth = kind === 'level' ? 2.5 : 1.5
      c.stroke()
    }
    c.lineWidth = 1
    c.lineCap = c.lineJoin = 'butt'
    if (under) {
      const [kind, gx, gy] = under, text = gripName(kind, L), tw = c.measureText(text).width
      tag(text, kind === 'out' ? gx - tw - 4 : kind === 'stretch' ? gx - 14 - tw : kind === 'in' ? gx + 4 : gx + 12, kind === 'stretch' ? gy - 7 : kind === 'level' ? gy + 12 : gy + CORNER + INSET + 10, 'left')
    }
  }
  // The meters, where the picture fades out just before the labels, each on its lane's own scale: by a waveform, a bar
  // as tall as the RMS with a tick at the peak, mirrored as the lane is (red at full scale); by a spectrogram, the
  // spectrum's outline, its level across (-90 to 0 dB), each frequency at its height in the lane, a gradient under it
  const METER = 40
  function paintMeters(L) {
    const { w } = plot(), bar = w - 7
    L.wave.forEach((rect, i) => {
      const m = meters.levels?.[i] ?? meters.levels?.[0]
      if (!m) return
      c.globalAlpha = .55
      c.fillStyle = color('--color-screen-soft')
      c.fillRect(bar, ay(rect, m.rms), 3, ay(rect, m.rms, -1) - ay(rect, m.rms))
      c.globalAlpha = 1
      c.fillStyle = m.peak >= 1 ? color('--color-screen-error') : color('--color-screen-bright')
      for (const sign of [1, -1]) c.fillRect(bar - 1, Math.round(ay(rect, m.peak, sign)), 5, 1)
    })
    const bins = meters.spectra, size = meters.size, left = w - METER - 2
    if (!bins) return
    L.spec.forEach((rect, i) => {
      const db = bins[i] ?? bins[0], [, y, , lh] = rect
      c.beginPath()
      c.moveTo(left, y + lh)
      for (let py = y + lh; py >= y; py -= 2) {
        const k = yf(rect, py) / (rate / size), k0 = Math.floor(k), f = k - k0
        const v = (db[k0] ?? -200) * (1 - f) + (db[k0 + 1] ?? -200) * f
        c.lineTo(left + Math.max(0, Math.min(1, (v + 90) / 90)) * METER, py)
      }
      c.lineTo(left, y)
      // filled under the outline, clear at the floor and brighter toward the loud end, as a level fills a meter
      const fill = c.createLinearGradient(left, 0, left + METER, 0), soft = color('--color-screen-soft')
      fill.addColorStop(0, 'transparent')
      fill.addColorStop(1, soft)
      c.globalAlpha = .4
      c.fillStyle = fill
      c.fill()
      c.globalAlpha = .7
      c.strokeStyle = color('--color-screen-muted')
      c.stroke()
      c.globalAlpha = 1
    })
  }
  // What a drag does, in a few words by the pointer
  function acting() {
    const d = drag, st = v => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(1)}`
    if (d.carry && d.moved) return `${d.carry === 'copy' ? 'copy over' : 'move'} to ${stamp(d.to)}`
    if (d.stretch) return `×${((d.to - d.a) / (d.b - d.a)).toFixed(3)}, ${stamp(d.to - d.a)}`
    if (d.lift === 'gain') return `${st(d.db)}dB`
    if (d.lift === 'pitch') return `${st(Math.round(12 * Math.log2(d.ratio) * 10) / 10)}st`
    if (d.span) return `fade ${d.fade} ${stamp(d.span[1] - d.span[0])}${d.fade === 'in' ? d.p < d.a ? ', centred on the start' : '' : d.p > d.b ? ', centred on the end' : ''}`
    return ''
  }
  // Where what is selected is, for what edits it: a range across the lanes, a band's box in the lowest spectrogram, or
  // the caret; none while a drag goes on or when it is out of view. Told only when it moves.
  let boxed = ''
  function box(L) {
    const { w, h } = plot(), a = selection ? x(selection[0]) : x(cursor), b = selection ? x(selection[1]) : a
    let out = null
    if (duration && !drag && b >= 0 && a <= w) {
      out = { x0: a, x1: b, y0: 0, y1: h, width: w, height: h, caret: !selection, band: !!band }
      const rect = band && L.spec.at(-1)
      if (rect) { out.y0 = Math.max(rect[1], fy(rect, band[1])); out.y1 = Math.min(rect[1] + rect[3], fy(rect, band[0])) }
    }
    const key = JSON.stringify(out)
    if (key !== boxed) { boxed = key; onbox(out) }
  }
  const pitched = (rect, L) => L.spec.includes(rect) || (show.pitch && !L.spec.length)
  const clampY = ([, y, , lh], ly) => Math.max(y + 5, Math.min(y + lh - 5, ly))
  // Marks [y, text] by a lane, the most important first: each where there is room, its tick at its height, its label
  // under it, clear of the pointer's value (`taken`, its y)
  function ticks(rect, list, taken) {
    const [, y, , lh] = rect, w = plot().w, placed = taken == null ? [] : [taken]
    for (const [ly, text] of list) {
      const ty = Math.round(ly)
      if (ty < y || ty > y + lh || placed.some(p => Math.abs(p - ty) < 16)) continue
      placed.push(ty)
      c.fillStyle = color('--color-screen-rule')
      c.fillRect(w + 1, ty, TICK, 1)
      c.fillStyle = color('--color-screen-dim')
      c.fillText(text, w + 1, ty + 9)
    }
  }
  // Frequencies, no unit (the axis is plainly hertz): the lowest the lane shows first, at its foot; then the roundest
  const hz = (rect, taken) => { const [, y, , lh] = rect; ticks(rect, [[y + lh, hertz(yf(rect, y + lh))], ...marks().map(f => [fy(rect, f), hertz(f)])], taken) }
  // Levels within the lane's edges, the most telling first: in dB mirrored about the centre line, clear of it, the top
  // edge's 0 with its unit; linear, the sample values in 1-2-5 steps, signed, the edges' first
  function levelMarks(rect) {
    if (levelUnits === 'linear') {
      const step = nice(amp / 2), n = Math.floor(amp / step + 1e-9), out = []
      for (let k = n; k >= 0; k--) for (const sign of k ? [1, -1] : [1]) out.push([ay(rect, k * step, sign), linear(sign * k * step)])
      return out
    }
    const [, y, , lh] = rect
    return LEVELS.filter(db => 10 ** (db / 20) <= amp * 1.0001 && y + lh / 2 - ay(rect, 10 ** (db / 20)) >= 16)
      .flatMap(db => [1, -1].map(sign => [ay(rect, 10 ** (db / 20), sign), db ? `${db > 0 ? '+' : '−'}${Math.abs(db)}` : sign > 0 ? '0dB' : '0']))
  }
  const linear = v => v ? `${v < 0 ? '−' : ''}${+Math.abs(v).toPrecision(3)}` : '0'
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
    const [, y, , lh] = rect, a = (y + lh / 2 - py) / (lh / 2) * amp
    if (levelUnits === 'linear') return linear(+a.toPrecision(2))
    const v = 20 * Math.log10(Math.abs(a))
    return v > -99 ? `${v < 0 ? '−' : '+'}${Math.abs(v).toFixed(1)}dB` : '−∞dB'
  }
  // A value by the pointer, on a patch of the screen so the labels under it give way
  function tag(text, px, py, align) {
    const tw = c.measureText(text).width
    if (align === 'center') px = Math.max(tw / 2 + 3, Math.min(plot().w - tw / 2 - 3, px))
    const left = align === 'center' ? px - tw / 2 : px
    c.fillStyle = color('--color-screen')
    c.fillRect(left - 3, py - 7, tw + 6, 14)
    c.fillStyle = color('--color-screen-bright')
    c.textAlign = align
    c.fillText(text, px, py)
  }
  const accent = () => color('--color-screen-accent')
  // What a step sets, over the output, in each lane (`across`): its range, a level, its fades' ramps, a time, a
  // frequency or a band
  function paintGuide(g, L, across) {
    const { w } = plot(), all = [...L.wave, ...L.spec]
    c.strokeStyle = c.fillStyle = accent()
    c.lineWidth = 1
    if (g.range && !g.band) {
      const a = x(g.range[0]), b = x(g.range[1])
      if (g.dim === 'outside') { c.fillStyle = color('--color-bezel'); c.globalAlpha = .55; across(0, a); across(b, w - b) }
      else { c.globalAlpha = .14; across(a, b - a) }
      c.globalAlpha = 1
      c.fillStyle = accent()
      across(Math.round(a), 1); across(Math.round(b), 1)
      // what the range is to the call (denoise's noise)
      if (g.label) { c.textAlign = 'left'; c.fillText(g.label, Math.round(a) + 5, all[0][1] + 10) }
    }
    if (g.level != null) for (const rect of L.wave) {
      const amp = 10 ** (g.level / 20), [, y, lw, lh] = rect
      c.setLineDash([4, 3])
      for (const sign of [1, -1]) { const ly = Math.round(ay(rect, amp, sign)) + .5; c.beginPath(); c.moveTo(0, ly); c.lineTo(lw, ly); c.stroke() }
      c.setLineDash([])
      c.textAlign = 'right'
      c.fillText(`${+g.level.toFixed(1)}dB`, lw - 6, Math.max(y + 8, ay(rect, amp) - 7))
    }
    // a fade's ramp, [t0, t1, 'in' or 'out', curve]: its level along its curve (fn/fade.js), from silence on the centre
    // line to the lane's edges, mirrored as the lane is
    if (g.ramps) for (const [, y, , lh] of ampLanes(L)) for (const [t0, t1, kind, name] of g.ramps) {
      const curve = CURVES[name] ?? CURVES.linear, mid = y + lh / 2, half = lh / 2 - 2
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
    if (g.freq != null || g.band) for (const rect of L.spec) {
      const lw = rect[2]
      if (g.band) {
        const [a, b] = g.range.map(x), top = fy(rect, g.band[1]), bottom = fy(rect, g.band[0])
        c.strokeRect(a + .5, top + .5, b - a, bottom - top)
      } else {
        const ly = Math.round(fy(rect, g.freq)) + .5
        c.setLineDash([4, 3]); c.beginPath(); c.moveTo(0, ly); c.lineTo(lw, ly); c.stroke(); c.setLineDash([])
        c.textAlign = 'right'
        c.fillText(g.freq >= 1000 ? `${+(g.freq / 1000).toFixed(2)}kHz` : `${Math.round(g.freq)}Hz`, lw - 6, ly - 7)
      }
    }
  }

  // The time row: a label every step a time reads well in (1-2-5, and minutes'), at least 72 px apart, its tick beside
  // it as tall as it; in samples, 1-2-5 steps of samples. None where the pointer's own time is (`taken`, [x0, x1]).
  const SECONDS = [1e-5, 2e-5, 5e-5, 1e-4, 2e-4, 5e-4, .001, .002, .005, .01, .02, .05, .1, .2, .5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600]
  function labelled() {
    const pps = plot().w / (end - start || 1), steps = units === 'samples' ? [0, 1, 2, 3, 4, 5, 6, 7].flatMap(e => [1, 2, 5].map(m => m * 10 ** e / rate)) : SECONDS
    const step = steps.find(s => s * pps >= 72) ?? steps.at(-1)
    return { step, digits: Math.max(0, Math.ceil(-Math.log10(step) - 1e-9)), first: Math.max(0, Math.ceil(start / step - 1e-9)) }
  }
  function paintRuler(taken) {
    const { w } = plot(), y = row(), { step, digits, first } = labelled()
    c.textAlign = 'left'
    for (let i = first; i * step <= end + 1e-9; i++) {
      const t = i * step, px = Math.round(x(t)), text = stamp(t, digits), tw = c.measureText(text).width
      if (px + 4 + tw > w) break
      if (taken && px + tw + 4 > taken[0] && px < taken[1]) continue
      c.fillStyle = color('--color-screen-rule')
      c.fillRect(px, y - 6, 1, 12)
      c.fillStyle = color('--color-screen-dim')
      c.fillText(text, px + 4, y)
    }
  }
  // The selection, in each lane (a box on the spectrogram), and the other ranges: a faint wash, the edge under the
  // pointer (`hot`) or dragged lit, as it would move
  function paintSelection(L, sel) {
    const { w } = plot(), all = [...L.wave, ...L.spec], boxes = []
    // [x, y, width, height], clipped to the lane, on whole pixels
    const push = (a, b, y0, y1) => { const p = Math.round(Math.max(a, 0)), q = Math.round(Math.min(b, w)); y0 = Math.round(y0); y1 = Math.round(y1); if (q > p && y1 > y0) boxes.push([p, y0, q - p, y1 - y0]) }
    if (sel) {
      const a = x(sel[0]), b = x(sel[1])
      if (band) for (const rect of L.spec) push(a, b, Math.max(rect[1], fy(rect, band[1])), Math.min(rect[1] + rect[3], fy(rect, band[0])))
      else for (const rect of all) push(a, b, rect[1], rect[1] + rect[3])
    }
    for (const [p, q] of drag?.carry ? [] : more) if (q > p) for (const rect of all) push(x(p), x(q), rect[1], rect[1] + rect[3])
    c.fillStyle = color('--color-screen-select')
    for (const b of boxes) c.fillRect(...b)
    const edge = !sel || band ? null : drag?.resizing ? (sel[0] === drag.anchor ? 1 : 0) : !drag && hot != null ? hot : null
    if (edge == null) return
    const px = Math.round(x(sel[edge])) - edge
    c.fillStyle = color('--color-screen-bright')
    if (px >= 0 && px <= w) for (const [, y, , lh] of all) c.fillRect(px, y, 1, lh)
  }
  // a time as the whole page writes it, in the units chosen (time.js): 0:05, 5.0s, 240000
  const stamp = (t, d = digits()) => clock(t, units, { digits: d, rate })
  // Cues: a line in each lane, and at the top of the time row, clear of its labels, a notch where a press takes one; the
  // one dragged is bright where it will land, and so are those a dragged edge sits on (`lit`)
  const on = (lit, px) => lit.some(t => Math.abs(x(t) - px) < .5)
  function paintCues(rects, lit) {
    const h = plot().h
    c.fillStyle = accent()
    for (const [i, t] of cues.entries()) {
      const moving = drag?.cue === i, px = Math.round(x(moving ? drag.to : t)), bright = moving || on(lit, px)
      if (px < 0 || px > plot().w) continue
      c.globalAlpha = bright ? 1 : .22
      for (const [, ly, , lh] of rects) c.fillRect(px, ly, 1, lh)
      c.globalAlpha = bright ? 1 : .7
      c.beginPath(); c.moveTo(px - 3.5, h + 1); c.lineTo(px + 4.5, h + 1); c.lineTo(px + .5, h + 6); c.fill()
    }
    c.globalAlpha = 1
  }
  // Markers: a flag each at the time row's top, its label beside it; a thin line in each lane, bright when a dragged
  // edge sits on it
  function paintMarkers(rects, lit) {
    const h = plot().h
    c.textAlign = 'left'
    for (const [i, { time, label }] of markers.entries()) {
      const px = Math.round(x(drag?.marker === i ? drag.to : time))
      if (px < 0 || px > plot().w) continue
      c.fillStyle = color('--color-screen-bright')
      c.globalAlpha = on(lit, px) ? .9 : .25
      for (const [, ly, , lh] of rects) c.fillRect(px, ly, 1, lh)
      c.globalAlpha = 1
      c.beginPath(); c.moveTo(px, h + 1); c.lineTo(px + 7, h + 4); c.lineTo(px, h + 8); c.fill()
      c.fillRect(px, h + 1, 1, 12)
      if (label) { c.fillStyle = color('--color-screen-soft'); c.fillText(label, px + 10, h + 6) }
    }
  }
  const nearMarker = (px, py) => py > plot().h ? markers.findIndex(m => Math.abs(x(m.time) - px) <= EDGE) : -1
  // The gain envelope: points joined by lines, mirrored below each lane's axis.
  function paintEnvelope(rects) {
    const pts = envelopePoints()
    c.strokeStyle = c.fillStyle = accent()
    for (const rect of rects) for (const sign of [1, -1]) {
      c.globalAlpha = sign > 0 ? 1 : .4
      c.beginPath()
      if (!pts.length) { c.moveTo(0, ay(rect, 1, sign)); c.lineTo(rect[2], ay(rect, 1, sign)) }
      else {
        c.moveTo(0, gy(rect, pts[0][1], sign))
        for (const [t, v] of pts) c.lineTo(x(t), gy(rect, v, sign))
        c.lineTo(rect[2], gy(rect, pts.at(-1)[1], sign))
      }
      c.stroke()
      if (sign > 0) for (const [t, v] of pts) c.fillRect(Math.round(x(t)) - 3, Math.round(gy(rect, v)) - 3, 6, 6)
    }
    c.globalAlpha = 1
  }
  const envelopePoints = () => drag?.points ?? (envelope ? envelope.t.map((t, i) => [t, envelope.v[i]]) : [])
  // The gain in dB the curve has at t: straight between its points, flat past its ends (plan.js curveFn)
  function gainAt(t) {
    const pts = envelopePoints()
    if (!pts.length) return 0
    if (t <= pts[0][0]) return pts[0][1]
    for (let i = 1; i < pts.length; i++) if (t <= pts[i][0]) { const [t0, v0] = pts[i - 1], [t1, v1] = pts[i]; return v0 + (v1 - v0) * (t - t0) / (t1 - t0 || 1) }
    return pts.at(-1)[1]
  }
  // a line that shows: there is a curve, or its points are being made
  const onLine = (rect, px, py) => (envelope || drag?.points) && Math.abs(gy(rect, gainAt(time(px))) - fold(rect, py)) <= EDGE
  // The pitch curve, a line per voiced stretch; the stretch being dragged shows its new pitch.
  function paintContour(rects) {
    if (!contour?.f0.length) return
    const { times, f0 } = contour
    c.strokeStyle = accent()
    c.lineWidth = 1.5
    for (const rect of rects) {
      c.save()
      c.beginPath(); c.rect(...rect); c.clip()
      c.beginPath()
      let open = false
      for (let i = 0; i < f0.length; i++) {
        const shifted = drag?.run && i >= drag.run[0] && i <= drag.run[1] ? f0[i] * drag.ratio : f0[i]
        if (!f0[i] || times[i] < start - .1 || times[i] > end + .1) { open = false; continue }
        const px = x(times[i]), py = fy(rect, shifted)
        open ? c.lineTo(px, py) : c.moveTo(px, py)
        open = true
      }
      c.stroke()
      c.restore()
    }
    c.lineWidth = 1
  }

  // From 32 samples across to eight times the whole, a bird's view: the sound starts at the left, the room is on its right
  function setRange(a, b) {
    const min = Math.min(duration, 32 / rate)
    let span = Math.max(min, Math.min(duration * 8, b - a))
    a = span <= duration ? Math.max(0, Math.min(duration - span, a)) : 0
    start = a; end = a + span
    invalidate()
  }
  // The frequencies shown, [u0, u1] on the scale: at least a 64th of it, within it
  function setFreqs(u0, u1) {
    const span = Math.min(1, Math.max(1 / 64, u1 - u0)), a = Math.max(0, Math.min(1 - span, u0))
    fview = [a, a + span]
    invalidate()
  }
  const zoom = (factor, at = (start + end) / 2) => setRange(at - (at - start) * factor, at + (end - at) * factor)
  // zoom the frequencies around u, which stays where it is on screen
  const zoomFreqs = (factor, u) => { const [u0, u1] = fview, k = (u - u0) / (u1 - u0), span = (u1 - u0) * factor; setFreqs(u - k * span, u - k * span + span) }

  // Pointer: a press takes what is under it (down); two fingers pan and zoom, the wheel pans, a pinch or Ctrl+wheel zooms.
  // The frequencies at the right of a spectrogram lane, and the spectrum drawn just before them: that lane, else null
  const onFreqs = (px, py, L = lanes()) => px > plot().w - (meters && show.meters ? METER + 2 : 0) ? L.spec.find(r => py >= r[1] && py <= r[1] + r[3]) ?? null : null
  // The levels at the right of a waveform lane, and its meter: that lane, else null
  const onLevels = (px, py, L = lanes()) => px > plot().w - (meters && show.meters ? 10 : 0) ? L.wave.find(r => py >= r[1] && py <= r[1] + r[3]) ?? null : null
  // Zoom the levels: the lane's edges from −60 dB (a thousandth of full scale) to +12 dB (four times it)
  const zoomLevels = factor => { amp = Math.max(1e-3, Math.min(4, amp * factor)); invalidate() }
  function down(event) {
    if (!duration || event.button > 0) return
    root.setPointerCapture(event.pointerId)
    pointers.set(event.pointerId, local(event))
    if (pointers.size === 2) {
      unscrub()
      // a pinch zooms time; on the frequencies, the frequencies; on the levels, the levels
      const pinch = [...pointers.values()], mid = [(pinch[0][0] + pinch[1][0]) / 2, (pinch[0][1] + pinch[1][1]) / 2], rect = onFreqs(...mid)
      drag = { pinch, range: [start, end], fview, u: rect ? uy(rect, mid[1]) : null, amp: onLevels(...mid) ? amp : null }
      return
    }
    const [px, py] = local(event), t = snap(time(px)), L = lanes()
    anchor = null
    const flag = nearMarker(px, py)
    // a flag: the caret goes to it; dragged, the marker moves
    if (flag >= 0) { if (selection) select(0, 0); setCursor(markers[flag].time); drag = { marker: flag, x: px, to: markers[flag].time, moved: false }; return invalidate() }
    drag = gripDown(px, py, L) || (show.hits && cueDown(px, py)) || (show.gain && penDown(px, py, L)) || (show.pitch && pitchDown(px, py, L)) || selectDown(event, px, py, t, L)
    // the moment under the caret sounds at once, for as long as it is held
    if (drag.hear != null) scrub(drag)
    invalidate()
  }
  // What a press on the picture takes: the caret, within a few pixels of it or anywhere on the time row below; a
  // range's edge; the caret and then a range from it, as in a text; on the spectrogram, a box. Each keeps its distance
  // from the pointer; Shift extends the range to it. `hear` is the time a drag sounds.
  const nearCaret = (px, py) => py > plot().h || !selection && Math.abs(x(cursor) - px) <= EDGE
  const nearEdge = px => selection && !band ? [0, 1].find(i => Math.abs(x(selection[i]) - px) <= EDGE) : undefined
  function selectDown(event, px, py, t, L) {
    if (more.length) pick(px)
    const box = L.spec.find(rect => inside(rect, px, py)), edge = nearEdge(px), grip = holds(event, px, py, L)
    if (grip) return grip
    // Alt and a press outside the ranges: another caret, or dragged, another range
    if (event.altKey && !box && !band && py <= plot().h) return { anchor: t, x: px, offset: 0, moved: false, adding: true }
    // any other press leaves one caret or range, as in a text
    if (!event.shiftKey && more.length) { more = []; onselect(selection, band, ranges()) }
    if (!event.shiftKey && edge == null && nearCaret(px, py)) {
      if (selection) select(0, 0)
      const offset = py > plot().h ? 0 : cursor - t
      setCursor(stuck(snap(t + offset)))
      return { caret: true, offset, moved: true, hear: cursor, from: cursor }
    }
    if (box && !event.shiftKey) { setCursor(t); return { anchor: t, x: px, y: py, offset: 0, box, f: snapF(box, py), moved: false, hear: t } }
    const d = edge != null ? { anchor: selection[1 - edge], offset: selection[edge] - t, moved: true, resizing: true }
      : event.shiftKey ? { anchor: selection ? selection[Math.abs(t - selection[0]) < Math.abs(t - selection[1]) ? 1 : 0] : cursor, offset: 0, moved: true }
      : { anchor: t, x: px, offset: 0, moved: false }
    d.hear = snap(t + d.offset)
    if (d.moved) select(d.anchor, d.hear)
    else setCursor(t)
    return d
  }
  // A press on one of a selection's handles: a fade from its dot, its level (or pitch) from its pill, its length from
  // its grip. They come before anything else there, the gain line or the pitch curve under them included.
  function gripDown(px, py, L) {
    const grip = gripAt(L, px, py)
    if (!grip) return null
    const [kind] = grip, [a, b] = selection
    if (kind === 'level') return lifting(L, [...L.wave, ...L.spec][0], py)
    // each keeps the distance it was pressed at from the edge it moves
    return kind === 'stretch' ? { stretch: true, a, b, to: b, offset: b - time(px) } : { fade: kind, a, b, x: px, offset: (kind === 'in' ? a : b) - time(px) }
  }
  // its level, up or down, on the waveform; its pitch on the spectrogram
  const lifting = (L, rect, py) => { const [a, b] = selection; return L.spec.includes(rect) ? { lift: 'pitch', a, b, rect, y: py, ratio: 1 } : { lift: 'gain', a, b, rect, y: py, db: 0 } }
  // What a time selection gives a press, beyond its handles and resizing it: held with ⌘ (Ctrl), its end stretches it
  // and its body sets its level (pitch). Its body is the audio itself, dragged to move it or, with Alt, to copy it over
  // what is there, a press and release putting the caret there as in a text
  function holds(event, px, py, L) {
    if (!selection || band || py > plot().h) return null
    const all = [...L.wave, ...L.spec], [a, b] = selection, lane = all.find(r => inside(r, px, py)), within = px > x(a) + EDGE && px < x(b) - EDGE
    const mod = mac ? event.metaKey : event.ctrlKey
    if (!lane) return null
    if (mod && Math.abs(x(b) - px) <= EDGE) return { stretch: true, a, b, to: b, offset: b - time(px) }
    if (mod && within) return lifting(L, lane, py)
    if (within && !event.shiftKey) return { carry: event.altKey ? 'copy' : 'move', a, b, x: px, to: a, moved: false }
    return null
  }
  // Shift held while dragging keeps to one axis: the one the drag has gone further along from its press
  const lock = (event, px, py) => !event.shiftKey || drag?.x == null || drag?.y == null ? [px, py] : Math.abs(px - drag.x) >= Math.abs(py - drag.y) ? [px, drag.y] : [drag.x, py]
  // A press inside one of the other ranges makes it the selection, so its gestures act on it
  function pick(px) {
    const i = more.findIndex(([a, b]) => px > x(a) + EDGE && px < x(b) - EDGE)
    if (i < 0) return
    const r = more.splice(i, 1)[0]
    more.push(selection ?? [cursor, cursor])
    selection = r
    onselect(selection, band, ranges())
  }
  // The moment a drag is at sounds, a band of it for a box; from the press on, every move sounds
  function scrub(d) {
    d.scrubbing = true
    onscrub(d.hear, d.band || null)
  }
  function unscrub() {
    if (drag?.scrubbing) { drag.scrubbing = false; onscrub(null) }
  }
  // A hit's tick on the time row. Pressed and let go, it puts the caret on the hit; dragged, it moves the hit.
  const nearCue = (px, py) => py > plot().h ? cues.findIndex(t => Math.abs(x(t) - px) <= EDGE) : -1
  function cueDown(px, py) {
    const i = nearCue(px, py)
    if (i < 0) return null
    return { cue: i, to: cues[i], x: px, moved: false, offset: cues[i] - snap(time(px)), prev: cues[i - 1] ?? 0, next: cues[i + 1] ?? duration }
  }
  // The gain line where it is (0 dB, the lanes' edges, while there is no curve), within a few pixels of it, or a point
  function penDown(px, py, L) {
    const rect = ampLanes(L).find(r => inside(r, px, py))
    if (!rect || !onLine(rect, px, py)) return null
    const points = envelopePoints().map(p => [...p])
    let index = pointAt(rect, px, py), offset = [0, 0]
    // a grabbed point keeps its distance from the pointer instead of jumping to it
    if (index >= 0) { const [t, v] = points[index]; offset = [x(t) - px, gy(rect, v) - fold(rect, py)] }
    else {
      const t = snap(time(px))
      index = points.findIndex(p => p[0] > t)
      if (index < 0) index = points.length
      points.splice(index, 0, [t, snapDb(rect, py)])
    }
    return { points, index, rect, offset, x: px, y: py, before: JSON.stringify(envelopePoints()) }
  }
  function pitchDown(px, py, L) {
    if (!contour?.f0.length) return null
    const rects = pitchLanes(L), rect = rects.find(r => inside(r, px, py))
    if (!rect) return null
    const { times, f0 } = contour
    let i = 0
    while (i < times.length - 1 && times[i + 1] <= time(px)) i++
    if (!f0[i] || Math.abs(fy(rect, f0[i]) - py) > 12) return null
    let a = i, b = i
    while (a > 0 && f0[a - 1]) a--
    while (b < f0.length - 1 && f0[b + 1]) b++
    return { run: [a, b], rect, y: py, ratio: 1 }
  }
  function move(event) {
    const [px, py] = local(event)
    if (pointers.has(event.pointerId)) pointers.set(event.pointerId, local(event))
    if (drag?.pinch && pointers.size === 2) {
      const [a, b] = drag.pinch, [p, q] = [...pointers.values()], [r0, r1] = drag.range
      // on the frequencies or the levels, they zoom, by how far apart the fingers go up and down; else time
      if (drag.amp != null) { amp = drag.amp; return zoomLevels(Math.abs(b[1] - a[1]) / Math.max(8, Math.abs(q[1] - p[1]))) }
      if (drag.u != null) {
        const k = Math.abs(b[1] - a[1]) / Math.max(8, Math.abs(q[1] - p[1])), [u0, u1] = drag.fview, f = (drag.u - u0) / (u1 - u0), fspan = (u1 - u0) * k
        return setFreqs(drag.u - f * fspan, drag.u - f * fspan + fspan)
      }
      const k = Math.abs(b[0] - a[0]) / Math.max(8, Math.abs(q[0] - p[0])), span = (r1 - r0) * k
      const center = r0 + (a[0] + b[0]) / 2 / plot().w * (r1 - r0)
      const at = (p[0] + q[0]) / 2 / plot().w
      setRange(center - at * span, center - at * span + span)
      return
    }
    hovered = event.pointerType === 'touch' ? null : [px, py]
    if (!drag) { hover(px, py, event); return invalidate(true) }
    if (drag.pinch) return
    if (drag.marker != null) {
      if (!drag.moved && Math.abs(px - drag.x) < 3) return
      drag.moved = true
      drag.to = snap(time(px))
      return invalidate(true)
    }
    if (drag.cue != null) {
      if (!drag.moved && Math.abs(px - drag.x) < 3) return
      drag.moved = true
      drag.to = Math.max(drag.prev + .01, Math.min(drag.next - .01, snap(time(px)) + drag.offset))
    }
    else if (drag.points) {
      const p = drag.points[drag.index], lo = drag.points[drag.index - 1]?.[0] ?? 0, hi = drag.points[drag.index + 1]?.[0] ?? duration
      const [dx, dy] = drag.offset, [qx, qy] = lock(event, px, py)
      p[0] = Math.max(lo, Math.min(hi, snap(time(qx + dx)))); p[1] = snapDb(drag.rect, fold(drag.rect, qy) + dy)
    }
    else if (drag.run) drag.ratio = yf(drag.rect, py) / yf(drag.rect, drag.y)
    // moved audio lands with its start or its end on a cue, whichever is nearer one
    else if (drag.carry) {
      if (!drag.moved && Math.abs(px - drag.x) < 3) return
      drag.moved = true
      const d = drag.b - drag.a, to = snap(drag.a + time(px) - time(drag.x)), s = stick(to), e = stick(to + d)
      drag.to = Math.max(0, Math.min(duration - d, s && (!e || s.d <= e.d) ? s.t : e ? e.t - d : to))
      pieces = arrange(drag.carry, drag.a, drag.b, drag.to)
    }
    // stretch keeps within a quarter and four times the length (fn/stretch.js)
    else if (drag.stretch) {
      const d = drag.b - drag.a
      drag.to = Math.max(drag.a + d / 4, Math.min(drag.a + d * 4, stuck(snap(time(px) + drag.offset))))
      pieces = arrange('stretch', drag.a, drag.b, drag.to)
    }
    // the lane's height is 24 dB, in half-dB steps, from −24 to +12
    else if (drag.lift === 'gain') {
      drag.db = Math.max(-24, Math.min(12, Math.round((drag.y - py) / drag.rect[3] * 48) / 2))
      pieces = arrange('gain', drag.a, drag.b, drag.a, drag.db)
    }
    else if (drag.lift === 'pitch') drag.ratio = yf(drag.rect, py) / yf(drag.rect, drag.y)
    // A fade's dot, dragged: inward, the fade runs from the edge to it; outward, past the edge, the fade is centred on
    // the edge, as far each side. It shows on the waveform as it goes.
    else if (drag.fade) {
      // a press that stays put is a click: it asks for the curve (up)
      if (!drag.span && Math.abs(px - drag.x) < 3) return
      const { a, b } = drag, p = drag.p = clamp(stuck(snap(time(px) + drag.offset)))
      drag.span = drag.fade === 'in' ? (p >= a ? [a, Math.min(p, b)] : [p, Math.min(b, 2 * a - p)])
        : (p <= b ? [Math.max(p, a), b] : [Math.max(a, 2 * b - p), p])
      pieces = drag.span[1] > drag.span[0] ? faded(drag.fade, ...drag.span) : null
    }
    else {
      if (!drag.moved && Math.abs(px - drag.x) < 3) return
      // a range starts on the cue its press was by, and its other end goes onto the one it comes near
      if (!drag.moved && !drag.caret) drag.anchor = stuck(drag.anchor)
      drag.moved = true
      drag.hear = stuck(snap(time(px) + drag.offset))
      // a caret dragged with Shift held becomes a range, from where it was pressed, still sounding as it goes
      if (drag.caret && event.shiftKey) { drag.caret = false; drag.anchor = drag.from }
      if (drag.caret) { scrub(drag); setCursor(drag.hear) }
      else if (drag.box) {
        // Shift keeps one axis of the box, the other whole: across, a time range of every frequency; up or down, a band
        // over all the time
        const f = snapF(drag.box, py), across = Math.abs(px - drag.x) >= Math.abs(py - drag.y), fs = [Math.min(f, drag.f), Math.max(f, drag.f)]
        if (event.shiftKey && across) select(drag.anchor, drag.hear)
        else if (event.shiftKey) select(0, duration, fs)
        else select(drag.anchor, drag.hear, fs)
        drag.band = band
        scrub(drag)
      }
      else if (drag.adding) {
        // the caret or range there was stays beside the new one
        if (!drag.started) { drag.started = true; more.push(selection ?? [cursor, cursor]) }
        select(drag.anchor, drag.hear, null, true)
        scrub(drag)
      }
      else { select(drag.anchor, drag.hear); scrub(drag) }
    }
    invalidate()
  }
  // What a press would grab, as the pointer: a hit's tick, the gain line or a point on it, a voiced stretch of the pitch
  // curve, a selection's edge (lit, `hot`; on the spectrogram a press there starts a box) or the caret; a caret over the
  // waveform, a cross over the spectrogram's time and frequency
  let held = {}, hot = null
  function hover(px, py, keys = held) {
    held = keys
    const L = lanes(), rect = show.gain && ampLanes(L).find(r => inside(r, px, py)), spectral = L.spec.some(r => inside(r, px, py))
    const handle = gripAt(L, px, py)?.[0], grip = !handle && holds(keys, px, py, L)
    const other = handle ? (handle === 'level' ? 'ns-resize' : 'ew-resize')
      : grip?.stretch ? 'col-resize'
      : grip?.lift ? 'ns-resize'
      : grip?.carry ? (grip.carry === 'copy' ? 'copy' : 'grab')
      : nearMarker(px, py) >= 0 ? 'pointer'
      : show.hits && nearCue(px, py) >= 0 ? 'col-resize'
      : rect && onLine(rect, px, py) ? (pointAt(rect, px, py) >= 0 ? 'move' : 'ns-resize')
      : show.pitch && pitchDown(px, py, L) ? 'ns-resize' : null
    hot = other == null && !spectral ? nearEdge(px) ?? null : null
    root.style.cursor = other ?? (hot != null || nearCaret(px, py) ? 'ew-resize' : spectral ? 'crosshair' : '')
  }
  function leave() { hovered = null; hot = null; invalidate(true) }
  function up(event) {
    pointers.delete(event.pointerId)
    const d = drag
    drag = null
    if (d?.pinch) { if (pointers.size) drag = d; return }
    if (!d) return
    if (d.marker != null) { const m = markers[d.marker]; if (d.moved && Math.abs(d.to - m.time) > 1e-6) { markers = markers.with(d.marker, { ...m, time: d.to }); onedit('remark', { time: m.time, to: d.to }) } }
    else if (d.cue != null) {
      // the cue sits where it was dropped at once, so a next drag before the output returns pins its neighbours right
      const from = cues[d.cue]
      if (!d.moved) { if (selection) select(0, 0); setCursor(from) }
      else if (Math.abs(d.to - from) > 1e-4) { cues = cues.with(d.cue, d.to); onedit('warp', { from, to: d.to, prev: d.prev, next: d.next }) }
    }
    else if (d.points) { if (JSON.stringify(d.points) !== d.before) onedit('envelope', { t: d.points.map(p => p[0]), v: d.points.map(p => p[1]) }) }
    else if (d.run) {
      const semitones = Math.round(12 * Math.log2(d.ratio) * 10) / 10, { times } = contour, hop = times[1] - times[0] || .01
      if (semitones) onedit('pitch', { at: Math.max(0, times[d.run[0]] - hop / 2), duration: times[d.run[1]] - times[d.run[0]] + hop, semitones })
    }
    // a drag that moved audio: the picture keeps the pieces where they went until the output comes (set, stream)
    else if (d.carry) {
      const length = d.b - d.a
      if (!d.moved) { select(0, 0); setCursor(snap(time(local(event)[0]))) }
      else if (Math.abs(d.to - d.a) < 1e-9 || !onedit('carry', { at: d.a, duration: length, to: d.to, copy: d.carry === 'copy' })) pieces = null
      else select(d.to, d.to + length)
    }
    else if (d.stretch) {
      const factor = (d.to - d.a) / (d.b - d.a)
      if (Math.abs(factor - 1) < 1e-3 || !onedit('stretch', { at: d.a, duration: d.b - d.a, factor })) pieces = null
      else select(d.a, d.to)
    }
    else if (d.lift === 'gain') { if (!d.db || !onedit('lift', { range: [d.a, d.b], db: d.db })) pieces = null }
    else if (d.lift === 'pitch') {
      const semitones = Math.round(12 * Math.log2(d.ratio) * 10) / 10
      if (semitones) onedit('pitch', { at: d.a, duration: d.b - d.a, semitones })
    }
    else if (d.fade && !d.span) { const r = root.getBoundingClientRect(), [top] = extent([...lanes().wave, ...lanes().spec]); oncurve({ kind: d.fade, x: r.left + x(d.fade === 'in' ? d.a : d.b), y: r.top + top + CORNER + INSET }) }
    else if (d.fade) { if (!(d.span[1] > d.span[0] && onedit('fade', { kind: d.fade, from: d.span[0], to: d.span[1], curve: fadeCurve }))) pieces = null }
    else if (d.adding && !d.moved) addCaret(d.anchor)
    else if (!d.moved && selection) { selection = null; band = null; more = []; onselect(null, null, []) }
    // the moment under it falls silent once what the press did is done: playback, paused for it, goes on from there
    if (d.scrubbing) { d.scrubbing = false; onscrub(null) }
    invalidate()
  }
  // Clicks counted: a double-click takes away the gain point under it, or selects between the cues around it (or the
  // pause it is in); a triple-click, the phrase between longer pauses
  function clicked(event) {
    if (!duration || event.detail < 2 || event.button > 0) return
    const [px, py] = local(event), L = lanes(), rect = show.gain && ampLanes(L).find(r => inside(r, px, py)), flag = nearMarker(px, py)
    if (flag >= 0) return onedit('unmark', markers[flag])
    if (event.detail === 2 && rect && envelope) {
      const pts = envelopePoints(), i = pointAt(rect, px, py)
      if (i >= 0) { pts.splice(i, 1); onedit('envelope', { t: pts.map(p => p[0]), v: pts.map(p => p[1]) }); return }
    }
    if (py > plot().h || px > plot().w) return
    around(event.detail === 2 ? 'sound' : 'phrase', clamp(time(px)))
  }
  // What a double- or triple-click takes at t: within a pause, the pause; else, double, the stretch between the cues
  // either side, as a sampler slices at its hits; triple, the phrase between the pause before and the one after
  function around(kind, t = cursor) {
    const gaps = kind === 'sound' ? segments.silences : segments.pauses
    const inside = gaps.find(([a, b]) => t >= a && t <= b)
    if (inside) return select(...inside)
    if (kind === 'sound') { const list = edges('sound'); return select(list.findLast(c => c <= t) ?? 0, list.find(c => c > t) ?? duration) }
    const before = gaps.findLast(([, b]) => b <= t), after = gaps.find(([a]) => a >= t)
    select(before ? before[1] : 0, after ? after[0] : duration)
  }
  // Where the caret steps, as a text's words and lines: the cues (the hits found, the markers) as words; the edges of the
  // longer pauses as lines, a pause that ends where a hit starts (the two found within 30 ms of each other) ending at
  // the hit
  function edges(kind) {
    const onHit = t => cues.find(c => Math.abs(c - t) < .03) ?? t
    const all = [0, duration, ...markers.map(m => m.time), ...(kind === 'sound' ? cues : segments.pauses.flat().map(onHit))].filter(t => t >= 0 && t <= duration)
    return [...new Set(all.map(t => +t.toFixed(6)))].sort((a, b) => a - b)
  }
  // an edge within three pixels of the caret is where it is: a hit found a few ms after the pause it ends is one place
  function stepTo(kind, dir, extend = false) {
    const head = selection ? (selection[0] === (anchor ?? selection[0]) ? selection[1] : selection[0]) : cursor, near = Math.max(1e-4, unit() * 3)
    const list = edges(kind), to = dir > 0 ? list.find(t => t > head + near) ?? duration : list.findLast(t => t < head - near) ?? 0
    if (extend) { anchor = selection ? anchor ?? selection[0] : cursor; select(anchor, to) }
    else { anchor = null; if (selection || more.length) select(0, 0); setCursor(to) }
    reveal(to)
  }
  // The wheel scrolls, as everywhere: up and down over zoomed-in frequencies (on the spectrogram, its frequencies or
  // the spectrum beside them) moves through them, else through time. A pinch, or Ctrl or ⌘ and the wheel (a mouse
  // without a pinch), zooms the axis under the pointer: the frequencies there, time elsewhere.
  function wheel(event) {
    if (!duration) return
    event.preventDefault()
    const [px, py] = local(event), span = end - start, L = lanes(), freqs = onFreqs(px, py, L), rect = freqs || L.spec.find(r => inside(r, px, py))
    const lines = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 400 : 1, across = Math.abs(event.deltaX) > Math.abs(event.deltaY)
    const factor = Math.exp(Math.max(-50, Math.min(50, event.deltaY * lines)) * .01)
    if (event.ctrlKey || event.metaKey) return freqs ? zoomFreqs(factor, uy(freqs, py)) : onLevels(px, py, L) ? zoomLevels(factor) : zoom(factor, clamp(time(px)))
    if (rect && fview[1] - fview[0] < 1 && !across) {
      const du = event.deltaY * lines / rect[3] * (fview[1] - fview[0])
      return setFreqs(fview[0] - du, fview[1] - du)
    }
    const delta = (across ? event.deltaX : event.deltaY) * lines
    setRange(start + delta / plot().w * span, end + delta / plot().w * span)
  }
  function select(a, b, f = null, keep = false) {
    selection = a === b ? null : [Math.min(a, b), Math.max(a, b)]
    band = selection && f && f[1] > f[0] ? f : null
    if (!keep || band) more = []
    // a range that overlaps others takes them in
    if (selection && more.length) {
      for (const r of more.filter(r => r[0] <= selection[1] && r[1] >= selection[0])) selection = [Math.min(selection[0], r[0]), Math.max(selection[1], r[1])]
      more = more.filter(r => r[1] < selection[0] || r[0] > selection[1])
    }
    // the caret at its start, as a text's
    if (selection) cursor = selection[0]
    onselect(selection, band, ranges())
    invalidate()
  }
  // Every range selected, in time order; every caret, the one there is when nothing is selected and those beside it
  const ranges = () => selection && !band ? [selection, ...more.filter(([p, q]) => q > p)].sort((p, q) => p[0] - q[0]) : selection ? [selection] : []
  const carets = () => [...(selection ? [] : [cursor]), ...more.filter(([p, q]) => p === q).map(([p]) => p)].sort((p, q) => p - q)
  // Another caret, as a text editor's (Alt and a click): the caret there was stays beside it, and a selection stays the
  // one its gestures act on; one there already goes
  function addCaret(t) {
    const i = more.findIndex(([p, q]) => p === q && Math.abs(x(p) - x(t)) <= EDGE)
    if (i >= 0) more.splice(i, 1)
    else if (selection) more.push([clamp(t), clamp(t)])
    else if (Math.abs(x(cursor) - x(t)) > EDGE) { more.push([cursor, cursor]); cursor = clamp(t); oncursor(cursor) }
    onselect(selection, band, ranges())
    invalidate()
  }
  // Another range beside the selection, which becomes the one gestures act on
  function add(a, b) {
    if (selection && !band) more.push(selection)
    select(a, b, null, true)
  }
  // The next range like the selection after the last one: a pause if it is one; a stretch between cues if it is one;
  // else a sound between pauses
  function addNext() {
    if (!selection || band) return
    const [a, b] = selection, last = Math.max(...ranges().map(r => r[1])), gaps = segments.silences, list = edges('sound')
    const near = (p, q) => Math.abs(p - q) < .03, on = t => list.some(c => Math.abs(c - t) < 1e-3)
    const next = gaps.some(([p, q]) => near(p, a) && near(q, b)) ? gaps.find(([p]) => p >= last - 1e-6)
      : on(a) && on(b) ? (() => { const i = list.findIndex(c => c >= last - 1e-3); return i >= 0 && i < list.length - 1 ? [list[i], list[i + 1]] : null })()
      : (() => { const g = gaps.find(([p]) => p > last + .03); if (!g) return null; const after = gaps.find(([p]) => p > g[1] + 1e-6); return [g[1], after ? after[0] : duration] })()
    if (next && next[1] > next[0]) { add(...next); reveal(next[1]) }
  }
  function setCursor(t) { cursor = clamp(t); oncursor(cursor); invalidate() }
  function setScale(name) {
    scale = root.dataset.scale = name
    fview = [0, 1]; leveled = false
    invalidate()
  }
  function reveal(t) {
    const span = end - start
    if (t < start || t > end) setRange(t - span * .1, t + span * .9)
  }

  // Keys while the view has focus: arrows move the caret a hundredth of the view, by sounds or phrases as a text's
  // words or lines; Shift extends the selection from where it started. Space and the transport belong to the page.
  function key(event) {
    const mod = event.metaKey || event.ctrlKey, step = (end - start) / 100, k = event.key
    if (['Meta', 'Control', 'Alt', 'Shift'].includes(k)) { if (hovered && !drag) hover(...hovered, event); return }
    const to = t => {
      if (event.shiftKey) {
        anchor = selection ? anchor ?? selection[0] : cursor
        select(anchor, t)
      } else { anchor = null; selection = null; band = null; more = []; onselect(null, null, []); setCursor(t) }
      reveal(t)
    }
    const head = selection ? (selection[0] === (anchor ?? selection[0]) ? selection[1] : selection[0]) : cursor
    // as in a text: by sounds as by words (⌥ on a Mac, Ctrl elsewhere), by phrases as by lines (⌘ on a Mac, Ctrl ↑ ↓)
    const mac = /Mac|iP(hone|ad|od)/.test(navigator.platform), word = mac ? event.altKey && !event.metaKey : event.ctrlKey && !event.altKey
    const line = mac ? event.metaKey && !event.altKey : false, dir = { ArrowLeft: -1, ArrowUp: -1, ArrowRight: 1, ArrowDown: 1 }[k]
    if (dir && (k === 'ArrowLeft' || k === 'ArrowRight') && (word || line)) stepTo(line ? 'phrase' : 'sound', dir, event.shiftKey)
    else if (dir && (k === 'ArrowUp' || k === 'ArrowDown') && (word || event.altKey && mac)) stepTo('phrase', dir, event.shiftKey)
    else if (k === 'ArrowLeft' || k === 'ArrowRight') to(clamp((event.shiftKey ? head : cursor) + (k === 'ArrowLeft' ? -step : step)))
    else if (k === 'Home' || k === 'End') to(k === 'Home' ? 0 : duration)
    else if (k === '=' || k === '+') zoom(.5, playhead ?? (selection ? (selection[0] + selection[1]) / 2 : cursor))
    else if (k === '-' || k === '_') zoom(2, playhead ?? cursor)
    else if (k === '0' && !mod) { fview = [0, 1]; amp = 1; setRange(0, duration) }
    else if (k === 'Escape' && (selection || more.length)) select(0, 0)
    else if (mod && k.toLowerCase() === 'd') addNext()
    else if (mod && k.toLowerCase() === 'a') select(0, duration)
    else if ((k === 'Delete' || k === 'Backspace') && selection) onedit('remove', band ? selection : ranges())
    else if (mod && k.toLowerCase() === 'x' && selection && !band) onedit('cut', selection)
    else if (mod && k.toLowerCase() === 'c' && selection && !band) onedit('copy', selection)
    else if (mod && k.toLowerCase() === 'v') onedit('paste', (carets().length ? carets() : [cursor]).map(t => [t, t]))
    else if (mod && k.toLowerCase() === 'z') onedit(event.shiftKey ? 'redo' : 'undo')
    else if (mod && k.toLowerCase() === 'y') onedit('redo')
    else return
    event.preventDefault()
  }

  // A waveform and a spectrogram per channel, dim while it is the file arriving; the spectrogram's silence is the
  // screen, its loudest white
  function lay(n, dim = false) {
    while (waves.length > n) waves.pop().destroy()
    while (specs.length > n) specs.pop().destroy()
    for (let i = 0; i < n; i++) {
      (waves[i] ||= new Waveform(gl, { rms: false, density: true })).update({ color: color(dim ? '--color-screen-wave-dim' : '--color-screen-wave') })
      if (sgl) (specs[i] ||= new Spectrogram(sgl, { background: color('--color-screen') })).update({ color: dim ? color('--color-screen-wave-dim') : null })
    }
  }
  // Each channel's samples for its pictures: the whole output, or none yet of one arriving
  const fill = channels => channels.forEach((data, i) => { waves[i].update({ data }); specs[i]?.update({ data, sampleRate: rate, levels: null }) })
  // After new samples: the levels again, the selection and the caret within them, and the range kept where it still fits
  function renew(all) {
    leveled = false
    if (!duration) { selection = band = null; start = end = 0; invalidate(); return }
    if (selection) selection = [Math.min(selection[0], duration), Math.min(selection[1], duration)]
    if (selection && selection[1] - selection[0] <= 0) selection = band = null
    more = more.map(([a, b]) => [Math.min(a, duration), Math.min(b, duration)]).filter(([a, b]) => b > a || a === b && b < duration)
    cursor = Math.min(cursor, duration)
    // A view of everything stays everything; a zoomed view keeps its place where it still fits.
    if (all || end - start <= 0) setRange(0, duration)
    else if (end > duration) setRange(duration - (end - start), duration)
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
  root.addEventListener('keydown', key)
  root.addEventListener('keyup', event => { if (hovered && !drag && ['Meta', 'Control', 'Alt', 'Shift'].includes(event.key)) hover(...hovered, event) })
  new ResizeObserver(resize).observe(root)

  return {
    // New output: keeps the view's range where it still fits, else shows all of it.
    set(channels, sampleRate) {
      const all = !duration || start <= 0 && end >= duration || arriving?.fit
      arriving = null
      ended()
      pieces = null
      channels ||= []
      count = channels.length; rate = sampleRate || rate
      duration = channels[0]?.length ? channels[0].length / rate : 0
      lay(count)
      fill(channels)
      renew(all)
    },
    // An output as it arrives: stream() starts it, `total` samples long where that is known, else as long as what has
    // come, `dim` while it is the file arriving, not yet the output; append() adds each piece; finish() ends it, its
    // length what came. The view shows it all, unless it was zoomed into an output of the same length.
    stream({ sampleRate, channels, total = null, dim = false }) {
      const all = !duration || start <= 0 && end >= duration || arriving?.fit || dim || !total
      ended()
      count = channels; rate = sampleRate || rate
      arriving = { total, length: 0, dim, fit: all }
      pieces = null
      duration = total ? total / rate : 0
      lay(count, dim)
      fill(waves.map(() => new Float32Array(0)))
      if (dim) { selection = band = null; more = [] }
      renew(all)
    },
    append(channels) {
      if (!arriving) return
      channels.forEach((data, i) => { waves[i]?.push(data); specs[i]?.push(data) })
      arriving.length += channels[0].length
      // past what was expected, or with nothing expected: as long as what has come
      if (arriving.length / rate > duration) duration = arriving.length / rate
      if (arriving.fit) setRange(0, duration)
      else invalidate()
    },
    finish() {
      if (!arriving) return
      const all = arriving.fit
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
      recording = { at, rate: sampleRate, length: 0, total: duration, waves: Array.from({ length: channels }, () => new Waveform(gl, { rms: false, density: true, color: color('--color-screen-wave') })) }
      taking()
    },
    grow(blocks) {
      if (!recording) return
      blocks[0] && recording.waves.forEach((wave, c) => wave.push(blocks[c] ?? blocks[0]))
      recording.length += blocks[0]?.length ?? 0
      taking()
    },
    get duration() { return duration },
    get range() { return [start, end] },
    get selection() { return selection },
    get band() { return band },
    get cursor() { return cursor },
    // the time the pointer rounds to at this zoom, which the script's numbers keep
    get unit() { return unit() },
    get display() { return display },
    set display(mode) {
      display = mode
      if (mode === 'wave' && band) { band = null; onselect(selection, null) }
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
    // how the level axis writes levels: 'db' or 'linear'
    set levels(name) { levelUnits = name === 'linear' ? 'linear' : 'db'; invalidate(true) },
    // what the meters read now: { levels: [{ rms, peak }], spectra: [dB per bin], size }, or null
    set meters(m) { meters = m; invalidate(true) },
    // the pauses, short and long: [[start, end], …] in seconds each
    set segments(list) { segments = list || { silences: [], pauses: [] } },
    // the output's markers, [{ time, label }]
    set markers(list) { markers = list || []; invalidate(true) },
    set cues(list) { cues = list || []; invalidate() },
    set envelope(curve) { envelope = curve; invalidate() },
    set contour(track) { contour = track; invalidate() },
    set guides(list) { guides = list || []; invalidate() },
    // While playing, a zoomed view scrolls with the playhead held in the middle; at the ends the playhead walks.
    set playhead(t) {
      playhead = t
      const span = end - start
      if (t != null && !drag && span < duration && (t > start + span / 2 || t < start)) setRange(t - span / 2, t + span / 2)
      invalidate()
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
    get ranges() { return ranges() }, get carets() { return carets() }, addNext,
    select, setCursor, around, step: stepTo,
    zoom, zoomTo: (a, b) => { const pad = (b - a) * .05; setRange(a - pad, b + pad) }, fit: () => { fview = [0, 1]; amp = 1; setRange(0, duration) }
  }
}
