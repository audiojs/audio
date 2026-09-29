import Waveform from '../assets/gl-waveform.js'
import spectrogram from './spectrogram.js'
import scales from './scale.js'

// The output as a picture: the waveform or the spectrogram, one at a time. A lane per channel, apart by a gap: each
// channel reads on its own (a sound panned to one side, a different take); the caret, the playhead and a selection run
// through them all. Levels or frequencies on the right, the meters just before them; times on the row below, and the
// pointer's time there. Times go by the zoom's precision, a 1-2-5 step of a pixel or a little more, and read with all
// its decimals, so the script gets the numbers the view shows. Near a mark on the right (a frequency, a level) the
// pointer takes its value. The wheel on the times zooms time; on the frequencies, the frequencies; a click on them
// switches their scale.
// One gesture, select, as in a text: a press puts the caret and sounds the moment under it, a drag selects (on the
// spectrogram, a time and frequency box), a double-click selects between the cues (the hits found, the markers) around
// it, or the pause it is in, and a triple-click the phrase between longer pauses; the caret and a range's edges drag. A
// selection's top corners fade it, its bottom right corner transforms it: across, its length; up or down, its level
// (its pitch on the spectrogram). Shift held while dragging keeps to one axis. What else shows (`show`) is grabbed
// where it is, never through a mode: the cues (a drag of one on the time row moves it, the audio around it
// stretching), the gain line and its points, the pitch curve's voiced stretches. Holding the caret or dragging it, or
// an edge, hears the moment under it (`onscrub`; a box, only its band).
// The view never changes audio: edits go to the script through `onedit`.
const GUTTER = 52, RULER = 24, GAP = 12, EDGE = 6, SNAP = 6, CORNER = 12
const mac = /Mac|iP(hone|ad|od)/.test(navigator.platform)
const LEVELS = [0, -6, -12, -24]              // dBFS: amplitude 1, .5, .25, .063
const VOICE = [60, 1000]                      // the pitch axis when no spectrogram shows, Hz, on a log scale
const GAIN = [-36, 12]                        // the gain line's scale, dB: the lane's centre line to its edges, 0 dB
                                              // three quarters of the way out, so a boost shows above it

export default function view(root, { spectrum, onselect = () => {}, oncursor = () => {}, onedit = () => {}, onscale = () => {}, onscrub = () => {}, onbox = () => {} } = {}) {
  const layer = name => root.appendChild(Object.assign(document.createElement('canvas'), { className: name }))
  const specCanvas = layer('spectrum'), waveCanvas = layer('waveform'), overlay = layer('overlay')
  const spec = spectrogram(specCanvas)
  // gl-waveform draws its own anti-aliased coverage; the context needs premultiplied alpha, not multisampling
  const gl = waveCanvas.getContext('webgl2', { premultipliedAlpha: true, antialias: false })
  const c = overlay.getContext('2d')
  const style = getComputedStyle(root)
  const color = name => style.getPropertyValue(name).trim()
  let waves = [], count = 0, rate = 44100, duration = 0, display = 'wave', scale = 'log', units = 'clock', hovered = null
  // what shows besides the sound; the pauses in it, short and long, for selecting and stepping as in a text
  let show = { hits: true, pitch: false, gain: true, meters: true }, segments = { silences: [], pauses: [] }
  // the output's markers: [{ time, label }], flags on the time row
  let markers = []
  // an output arriving: { total, length, dim, fit }; total samples where known, `dim` while it is the file, not the output
  let arriving = null, fetched = 0
  // more ranges beside the selection, as a text editor's several selections: [[a, b], …]; edits act on them all
  let more = []
  // the meters at the right edge: each channel's { rms, peak } and spectrum (dB per bin of `size` at `rate`), or none
  let meters = null
  // The picture as an edit leaves it, before its output comes: pieces of the output as it is, each drawn where it goes
  // (a move, a copy over, a stretch, a level while dragged; a delete, a cut, a crop once written), [{ s0, s1, d0, d1,
  // gain }] in seconds, the span it shows and the span it goes to. None: the output as it is.
  let pieces = null
  // the time shown [start, end], and the part of the spectrogram's frequency axis shown, 0..1 on its scale
  let start = 0, end = 0, fview = [0, 1], selection = null, band = null, cursor = 0, playhead = null, guides = []
  let cues = [], envelope = null, contour = null
  let W = 0, H = 0, dpr = 1, frame = 0, specTimer = 0, version = 0, covered = null, whole = false, fetching = false, again = false, drag = null, anchor = null
  const pointers = new Map()

  // Geometry, in CSS pixels
  const plot = () => ({ w: Math.max(1, W - GUTTER), h: Math.max(1, H - RULER) })
  function lanes() {
    const { w, h } = plot(), n = Math.max(1, count), lh = (h - GAP * (n - 1)) / n
    const stack = Array.from({ length: n }, (_, i) => [0, i * (lh + GAP), w, lh])
    return shape() === 'spec' ? { wave: [], spec: stack } : { wave: stack, spec: [] }
  }
  // the lanes' top and bottom: what runs through them all (the caret, the playhead, a time selection) spans the gaps
  const extent = rects => [Math.min(...rects.map(r => r[1])), Math.max(...rects.map(r => r[1] + r[3]))]
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
  // Amplitude ↔ y: 0 dB at the lane's edges, silence on its axis
  const ay = ([, y, , lh], amp, sign = 1) => y + lh / 2 - sign * Math.min(1, amp) * lh / 2
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
  // in the resize callback before that paint, a divider dragged never flashes an empty picture. Sharper spectrogram
  // frames for the new size are fetched once the drag settles.
  function resize() {
    const r = root.getBoundingClientRect(), d = devicePixelRatio || 1, cw = Math.round(r.width * d), ch = Math.round(r.height * d)
    W = r.width; H = r.height; dpr = d
    for (const canvas of [specCanvas, waveCanvas, overlay]) if (canvas.width !== cw || canvas.height !== ch) { canvas.width = cw; canvas.height = ch }
    cancelAnimationFrame(frame)
    frame = 0; pictures = true
    render()
    refreshSpectrum()
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
  // A fade drawn at once: what it covers in 48 steps, each at its level on the curve fade() takes by default, a line
  // (fn/fade.js); `len` long, in from `a` or out to `b`
  function faded(kind, a, b, len, n = 48) {
    const f0 = kind === 'in' ? a : b - len, level = u => Math.max(1e-4, kind === 'in' ? u : 1 - u)
    const list = [[0, f0, 1], ...Array.from({ length: n }, (_, i) => [f0 + len * i / n, f0 + len * (i + 1) / n, level((i + .5) / n)]), [f0 + len, duration, 1]]
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
        if (!pieces) return wave.update({ range: [from, to], viewport: rect, pixelRatio: ratio, amplitude: null }).render()
        for (const p of spans()) wave.update({ range: [p.from, p.to], viewport: [rect[0] + p.x0, rect[1], p.x1 - p.x0, rect[3]], pixelRatio: ratio, amplitude: [-1 / p.gain, 1 / p.gain] }).render()
      })
    }
    if (spec) spec.render(L.spec.map(rect => rect.map(v => Math.round(v * dpr))), from, to, fview, pieces && spans().map(p => ({ x0: p.x0 * dpr, x1: p.x1 * dpr, from: p.from, to: p.to })))
    paint(L)
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
    const all = [...L.wave, ...L.spec], dim = color('--color-screen-dim'), [top, bottom] = extent(all)
    // selection: a time range through all the lanes, or a box on the spectrogram
    c.fillStyle = color('--color-screen-select')
    const sel = drag?.carry && drag.moved ? [drag.to, drag.to + drag.b - drag.a] : drag?.stretch || drag?.transform ? [drag.a, drag.to] : selection
    if (sel) {
      const a = x(sel[0]), b = x(sel[1])
      if (band) for (const rect of L.spec) {
        const y0 = Math.max(rect[1], fy(rect, band[1])), y1 = Math.min(rect[1] + rect[3], fy(rect, band[0]))
        if (y1 > y0) c.fillRect(a, y0, b - a, y1 - y0)
      }
      else c.fillRect(a, top, b - a, bottom - top)
    }
    for (const [p, q] of drag?.carry ? [] : more) c.fillRect(x(p), top, x(q) - x(p), bottom - top)
    // a time selection's handles: its top corners fade it in and out, its bottom right corner transforms it
    if (selection && !band && !drag?.carry) {
      const [a, b] = sel || selection, xa = Math.round(x(a)), xb = Math.round(x(b))
      c.fillStyle = c.strokeStyle = color('--color-screen-soft')
      c.fillRect(xa, top, 5, 5)
      c.fillRect(xb - 5, top, 5, 5)
      c.beginPath()
      for (const k of [9, 5]) { c.moveTo(xb - k, bottom - 1.5); c.lineTo(xb - 1.5, bottom - k) }
      c.stroke()
      if (drag?.fade && drag.len > 0) paintGuide(drag.fade === 'in' ? { fade: [drag.len, 0], at0: a, duration: b } : { fade: [0, drag.len], at0: a, duration: b }, L)
    }
    for (const guide of guides) paintGuide(guide, L)
    paintRuler()
    if (show.hits) paintCues(top, bottom)
    paintMarkers(all)
    if (show.gain && (envelope || drag?.points)) paintEnvelope(ampLanes(L))
    if (show.pitch) paintContour(pitchLanes(L))
    // one line through the lanes: the caret, or while it plays the playhead, which is the caret moving; while an output
    // arrives, where it has come to
    const line = (t, fill) => { const px = Math.round(x(t)); if (px < 0 || px > w) return; c.fillStyle = fill; c.fillRect(px, top, 1, bottom - top) }
    if (arriving) line(arriving.length / rate, color('--color-screen-soft'))
    if (playhead != null) line(playhead, color('--color-screen-bright'))
    else line(cursor, color('--color-screen-muted'))
    // the pointer, read out on the axes: its time on the ruler, its level or frequency by its lane
    const at = hovered && hovered[0] >= 0 && hovered[0] <= w ? hovered : null, lane = at && all.find(r => inside(r, ...at))
    if (meters && show.meters) paintMeters(L)
    // right axis: levels by the waveform, the minus sign their tick; frequencies by the spectrogram (or the voice
    // range for pitch). Labels sit on their value, nudged inside the lane at its edges.
    c.fillStyle = dim
    c.textAlign = 'left'
    const near = rect => rect === lane ? clampY(lane, at[1]) : null
    for (const rect of L.wave) {
      if (show.pitch && contour?.f0.length && !L.spec.length) { hz(rect, near(rect)); continue }
      // mirrored about the centre line, 0 dB at both edges
      labels(rect, LEVELS.flatMap(level => [1, -1].map(sign => [ay(rect, 10 ** (level / 20), sign), level ? `−${-level}` : '0 dB'])), near(rect))
    }
    for (const rect of L.spec) hz(rect, near(rect))
    // the spectrogram's scale, named in the corner under its frequencies; a click on them switches it
    if (L.spec.length) c.fillText(scale, w + 1, H - 6)
    // the pointer's values: its time below, as a press there would take it; its level or frequency by its lane
    c.textAlign = 'left'
    const row = H - 6, hint = at && (units === 'samples' ? String(Math.round(snap(time(at[0])) * rate)) : clock(snap(time(at[0])), digits()))
    const doing = drag && at && acting()
    if (doing) { c.font = `11px ${color('--font-mono')}`; tag(doing, Math.min(at[0] + 12, w - c.measureText(doing).width - 6), Math.max(12, at[1] - 16), 'left'); c.font = `10px ${color('--font-mono')}` }
    if (at) {
      c.fillStyle = color('--color-screen-muted')
      c.fillRect(Math.round(at[0]), H - 10, 1, 10)
      tag(hint, Math.min(at[0] + 4, w - c.measureText(hint).width - 3), row, 'left')
      if (lane) tag(pitched(lane, L) ? hertz(snapF(lane, at[1])) : decibels(lane, at[1]), w + 1, clampY(lane, at[1]), 'left')
    }
  }
  // The meters, where the picture fades out just before the labels, each on its lane's own scale: by a waveform, a bar
  // as tall as the RMS with a tick at the peak, mirrored as the lane is (red at full scale); by a spectrogram, the
  // spectrum's outline, its level across (-90 to 0 dB), each frequency at its height in the lane
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
      c.globalAlpha = .12
      c.fillStyle = color('--color-screen-soft')
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
    if (d.carry && d.moved) return `${d.carry === 'copy' ? 'copy over' : 'move'} to ${clock(d.to, digits())}`
    if (d.stretch) return `×${((d.to - d.a) / (d.b - d.a)).toFixed(3)}, ${clock(d.to - d.a, digits())}`
    if (d.lift === 'gain') return `${st(d.db)} dB`
    if (d.lift === 'pitch') return `${st(Math.round(12 * Math.log2(d.ratio) * 10) / 10)} semitones`
    if (d.fade) return `fade ${d.fade} ${clock(d.len, digits())}`
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
  // Labels [y, text, with unit] from the most important down, each where it has room, clear of the pointer's value at
  // `taken`; one given `with unit` says it when it is the top label placed
  function labels(rect, list, taken = null) {
    const placed = []
    for (const [ly, text, unit] of list) {
      const y = clampY(rect, ly)
      if ((taken != null && Math.abs(taken - y) < 12) || placed.some(p => Math.abs(p[0] - y) < 12)) continue
      placed.push([y, text, unit])
    }
    const top = placed.reduce((a, p) => p[0] < a[0] ? p : a, placed[0])
    for (const p of placed) c.fillText(p === top && p[2] ? p[2] : p[1], plot().w + 1, p[0])
  }
  const hz = (rect, taken) => labels(rect, marks().map(f => [fy(rect, f), f >= 1000 ? `${+(f / 1000).toFixed(3)}k` : `${+f.toFixed(1)}`, f >= 1000 ? `${+(f / 1000).toFixed(3)} kHz` : `${+f.toFixed(1)} Hz`]), taken)
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
  const hertz = f => f >= 1000 ? `${+(f / 1000).toFixed(f >= 1e4 ? 1 : 2)} kHz` : `${Math.round(f)} Hz`
  function decibels(rect, py) {
    const [, y, , lh] = rect, level = LEVELS.find(l => [1, -1].some(sign => Math.abs(ay(rect, 10 ** (l / 20), sign) - py) <= SNAP))
    const v = level ?? 20 * Math.log10(Math.abs(py - y - lh / 2) / (lh / 2))
    return v > -99 ? `${v < 0 ? '−' : ''}${Math.abs(v).toFixed(level != null ? 0 : 1)} dB` : '−∞ dB'
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
  function paintGuide(g, L) {
    const { w, h } = plot()
    c.strokeStyle = c.fillStyle = accent()
    c.lineWidth = 1
    if (g.range && !g.band) {
      const a = x(g.range[0]), b = x(g.range[1])
      c.globalAlpha = .14
      if (g.dim === 'outside') { c.fillStyle = color('--color-bezel'); c.globalAlpha = .55; c.fillRect(0, 0, a, h); c.fillRect(b, 0, w - b, h) }
      else c.fillRect(a, 0, b - a, h)
      c.globalAlpha = 1
      c.fillStyle = accent()
      c.fillRect(Math.round(a), 0, 1, h); c.fillRect(Math.round(b), 0, 1, h)
      // what the range is to the call (denoise's noise)
      if (g.label) { c.textAlign = 'left'; c.fillText(g.label, Math.round(a) + 5, 10) }
    }
    if (g.level != null) for (const rect of L.wave) {
      const amp = 10 ** (g.level / 20), [, y, lw, lh] = rect
      c.setLineDash([4, 3])
      for (const sign of [1, -1]) { const ly = Math.round(ay(rect, amp, sign)) + .5; c.beginPath(); c.moveTo(0, ly); c.lineTo(lw, ly); c.stroke() }
      c.setLineDash([])
      c.textAlign = 'right'
      c.fillText(`${+g.level.toFixed(1)} dB`, lw - 6, Math.max(y + 8, ay(rect, amp) - 7))
    }
    if (g.fade) for (const [, y, , lh] of L.wave) {
      const [fin, fout] = g.fade, t0 = g.at0 ?? 0, mid = y + lh / 2, top = y + 2, bottom = y + lh - 2
      c.beginPath()
      if (fin) { c.moveTo(x(t0), mid); c.lineTo(x(t0 + fin), top); c.moveTo(x(t0), mid); c.lineTo(x(t0 + fin), bottom) }
      if (fout) { c.moveTo(x(g.duration - fout), top); c.lineTo(x(g.duration), mid); c.lineTo(x(g.duration - fout), bottom) }
      c.stroke()
    }
    if (g.at != null) { c.setLineDash([2, 3]); const px = Math.round(x(g.at)) + .5; c.beginPath(); c.moveTo(px, 0); c.lineTo(px, h); c.stroke(); c.setLineDash([]) }
    if (g.freq != null || g.band) for (const rect of L.spec) {
      const lw = rect[2]
      if (g.band) {
        const [a, b] = g.range.map(x), top = fy(rect, g.band[1]), bottom = fy(rect, g.band[0])
        c.strokeRect(a + .5, top + .5, b - a, bottom - top)
      } else {
        const ly = Math.round(fy(rect, g.freq)) + .5
        c.setLineDash([4, 3]); c.beginPath(); c.moveTo(0, ly); c.lineTo(lw, ly); c.stroke(); c.setLineDash([])
        c.textAlign = 'right'
        c.fillText(g.freq >= 1000 ? `${+(g.freq / 1000).toFixed(2)} kHz` : `${Math.round(g.freq)} Hz`, lw - 6, ly - 7)
      }
    }
  }

  // The time row: ticks every `minor`, taller and labelled every `major`, steps a time reads well in (1-2-5, and
  // minutes'), the labels at least 72 px apart; in samples, 1-2-5 steps of samples
  const SECONDS = [1e-5, 2e-5, 5e-5, 1e-4, 2e-4, 5e-4, .001, .002, .005, .01, .02, .05, .1, .2, .5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600]
  const multiple = (p, q) => Math.abs(p / q - Math.round(p / q)) < 1e-6
  function paintRuler() {
    const { w, h } = plot(), pps = w / (end - start || 1)
    const steps = units === 'samples' ? [0, 1, 2, 3, 4, 5, 6, 7].flatMap(e => [1, 2, 5].map(m => m * 10 ** e / rate)) : SECONDS
    const major = steps.find(s => s * pps >= 72) ?? steps.at(-1), minor = steps.find(s => s < major && s * pps >= 7 && multiple(major, s)) ?? major
    const digits = Math.max(0, Math.ceil(-Math.log10(major) - 1e-9))
    c.fillStyle = color('--color-screen-dim')
    c.textAlign = 'left'
    for (let i = Math.max(0, Math.ceil(start / minor - 1e-9)); i * minor <= end + 1e-9; i++) {
      const t = i * minor, px = Math.round(x(t)), big = multiple(t, major)
      if (px > w) break
      c.fillRect(px, h, 1, big ? 6 : 3)
      const text = big && stamp(t, digits)
      if (text && px + 3 + c.measureText(text).width <= w) c.fillText(text, px + 3, h + 16)
    }
  }
  // a time on the ruler, in the units chosen: 0:05, 5.0s, 240000
  const stamp = (t, digits) => units === 'samples' ? String(Math.round(t * rate)) : units === 'seconds' ? `${t.toFixed(digits)}s`
    : `${Math.floor(t / 60 + 1e-9)}:${(t - Math.floor(t / 60 + 1e-9) * 60).toFixed(digits).padStart(digits ? digits + 3 : 2, '0')}`
  // Cues: a line through the lanes each, and on the time row a tick where a press takes one; the one dragged is bright
  // where it will land
  function paintCues(top, bottom) {
    const h = plot().h
    c.fillStyle = accent()
    for (const [i, t] of cues.entries()) {
      const moving = drag?.cue === i, px = Math.round(x(moving ? drag.to : t))
      if (px < 0 || px > plot().w) continue
      c.globalAlpha = moving ? .9 : .22
      c.fillRect(px, top, 1, bottom - top)
      c.globalAlpha = moving ? 1 : .7
      c.fillRect(px, h, 1, 9)
    }
    c.globalAlpha = 1
  }
  // Markers: a flag each at the time row's top, its label beside it; a thin line up through the lanes
  function paintMarkers(rects) {
    const top = Math.min(...rects.map(r => r[1])), h = plot().h
    c.textAlign = 'left'
    for (const [i, { time, label }] of markers.entries()) {
      const px = Math.round(x(drag?.marker === i ? drag.to : time))
      if (px < 0 || px > plot().w) continue
      c.fillStyle = color('--color-screen-bright')
      c.globalAlpha = .25
      c.fillRect(px, top, 1, h - top)
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

  // Spectrogram frames for a little more than the visible range, a moment after the view settles, so panning and
  // following playback draw from frames already there. One fetch at a time; a request during it fetches again after.
  function refreshSpectrum(delay = 120) {
    clearTimeout(specTimer)
    if (!spec || !spectrum || !duration || !W || display === 'wave') return
    specTimer = setTimeout(fetchFrames, delay)
  }
  async function fetchFrames() {
    if (fetching) { again = true; return }
    fetching = true
    const v = version, span = end - start, fspan = fview[1] - fview[0], [lo, hi] = freqs(), lh = lanes().spec[0]?.[3] || 256
    // the whole output first, once: what is white, and what shows wherever the view goes before sharper frames come
    if (!whole) {
      const all = Math.round(duration * rate), columns = Math.min(4096, Math.max(64, Math.round(plot().w * dpr)))
      const frames = await spectrum({ from: 0, to: all, columns, rows: Math.min(1024, Math.max(64, Math.round(lh * dpr))), scale })
      if (v === version && frames?.channels?.length && display !== 'wave') { spec.set(frames, 0, all, [0, 1], true); whole = true; invalidate() }
      // all of it in view: the whole frames are as sharp as the view can show
      if (start <= 0 && end >= duration && fspan > .999) {
        fetching = false
        covered = [0, duration, span, 0, 1, fspan]
        if (again) { again = false; fetchFrames() }
        return
      }
    }
    const from = Math.floor(Math.max(0, start - span / 2) * rate), to = Math.ceil(Math.min(duration, end + span / 2) * rate)
    const ua = Math.max(0, fview[0] - fspan / 2), ub = Math.min(1, fview[1] + fspan / 2)
    const columns = Math.min(4096, Math.max(16, Math.round(plot().w * dpr / 2 * (to - from) / (span * rate))))
    const rows = Math.min(2048, Math.max(64, Math.round(lh * dpr * (ub - ua) / fspan)))
    const frames = await spectrum({ from, to, columns, rows, scale, low: scales[scale].of(ua, lo, hi), high: scales[scale].of(ub, lo, hi) })
    fetching = false
    if (v === version && frames?.channels?.length && display !== 'wave') {
      spec.set(frames, from, to, [ua, ub])
      covered = [from / rate, to / rate, span, ua, ub, fspan]
      invalidate()
    }
    if (again) { again = false; fetchFrames() }
  }

  // From 32 samples across to eight times the whole, a bird's view: the sound starts at the left, the room is on its right
  function setRange(a, b, settle = true) {
    const min = Math.min(duration, 32 / rate)
    let span = Math.max(min, Math.min(duration * 8, b - a))
    a = span <= duration ? Math.max(0, Math.min(duration - span, a)) : 0
    start = a; end = a + span
    moved(settle)
  }
  // The frequencies shown, [u0, u1] on the scale: at least a 64th of it, within it
  function setFreqs(u0, u1, settle = true) {
    const span = Math.min(1, Math.max(1 / 64, u1 - u0)), a = Math.max(0, Math.min(1 - span, u0))
    fview = [a, a + span]
    moved(settle)
  }
  function moved(settle) {
    invalidate()
    if (settle) return refreshSpectrum()
    // outside the frames, or zoomed well past their detail: fetch now
    const [a, b, span, ua, ub, fspan] = covered || []
    if (covered && (start < a || end > b || end - start < span / 1.5 || fview[0] < ua || fview[1] > ub || fview[1] - fview[0] < fspan / 1.5)) refreshSpectrum(0)
  }
  const zoom = (factor, at = (start + end) / 2) => setRange(at - (at - start) * factor, at + (end - at) * factor)
  // zoom the frequencies around u, which stays where it is on screen
  const zoomFreqs = (factor, u) => { const [u0, u1] = fview, k = (u - u0) / (u1 - u0), span = (u1 - u0) * factor; setFreqs(u - k * span, u - k * span + span) }

  // Pointer: a press takes what is under it (down); two fingers pan and zoom, the wheel pans, a pinch or Ctrl+wheel zooms.
  // The spectrogram's frequencies, and its scale's name in the corner under them: a click switches the scale
  const onScale = (px, py, L = lanes()) => display !== 'wave' && px > plot().w && (py > plot().h || L.spec.some(r => py >= r[1] && py <= r[1] + r[3]))
  // the frequencies at the right of a spectrogram lane: that lane, else null
  const onFreqs = (px, py, L = lanes()) => px > plot().w ? L.spec.find(r => py >= r[1] && py <= r[1] + r[3]) ?? null : null
  const nextScale = () => { const names = Object.keys(scales); return names[(names.indexOf(scale) + 1) % names.length] }
  function down(event) {
    if (!duration || event.button > 0) return
    if (onScale(...local(event))) { setScale(nextScale()); return onscale(scale) }
    root.setPointerCapture(event.pointerId)
    pointers.set(event.pointerId, local(event))
    if (pointers.size === 2) {
      unscrub()
      // a pinch zooms time; on the frequencies, the frequencies
      const pinch = [...pointers.values()], mid = [(pinch[0][0] + pinch[1][0]) / 2, (pinch[0][1] + pinch[1][1]) / 2], rect = onFreqs(...mid)
      drag = { pinch, range: [start, end], fview, u: rect ? uy(rect, mid[1]) : null }
      return
    }
    const [px, py] = local(event), t = snap(time(px)), L = lanes()
    anchor = null
    const flag = nearMarker(px, py)
    // a flag: the caret goes to it; dragged, the marker moves
    if (flag >= 0) { if (selection) select(0, 0); setCursor(markers[flag].time); drag = { marker: flag, x: px, to: markers[flag].time, moved: false }; return invalidate() }
    drag = (show.hits && cueDown(px, py)) || (show.gain && penDown(px, py, L)) || (show.pitch && pitchDown(px, py, L)) || selectDown(event, px, py, t, L)
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
    // Alt and a press outside the ranges: one more
    if (event.altKey && !box && selection && !band && py <= plot().h) return { anchor: t, x: px, offset: 0, moved: false, adding: true }
    if (!event.shiftKey && edge == null && nearCaret(px, py)) {
      if (selection) select(0, 0)
      const offset = py > plot().h ? 0 : cursor - t
      setCursor(snap(t + offset))
      return { caret: true, offset, moved: true, hear: cursor }
    }
    if (box && !event.shiftKey) { setCursor(t); return { anchor: t, x: px, offset: 0, box, f: snapF(box, py), moved: false, hear: t } }
    const d = edge != null ? { anchor: selection[1 - edge], offset: selection[edge] - t, moved: true }
      : event.shiftKey ? { anchor: selection ? selection[Math.abs(t - selection[0]) < Math.abs(t - selection[1]) ? 1 : 0] : cursor, offset: 0, moved: true }
      : { anchor: t, x: px, offset: 0, moved: false }
    d.hear = snap(t + d.offset)
    if (d.moved) select(d.anchor, d.hear)
    else setCursor(t)
    return d
  }
  // What a time selection gives a press, beyond resizing it: its top corners its fades; its bottom right corner, as a
  // text box's, transforms the sound it holds: across, its length (what follows moves with it), up or down its level on
  // the waveform, its pitch on the spectrogram. Held with ⌘ (Ctrl), the same by its end and its body. Its body the
  // audio itself, dragged to move it or, with Alt, to copy it over what is there, a press and release putting the caret
  // there as in a text
  function holds(event, px, py, L) {
    if (!selection || band || py > plot().h) return null
    const all = [...L.wave, ...L.spec], [a, b] = selection, lane = all.find(r => inside(r, px, py)), within = px > x(a) + EDGE && px < x(b) - EDGE
    const mod = mac ? event.metaKey : event.ctrlKey, [top, bottom] = extent(all)
    if (!lane) return null
    if (py - top <= CORNER && !mod && Math.abs(px - x(a)) <= CORNER) return { fade: 'in', a, b, len: 0 }
    if (py - top <= CORNER && !mod && Math.abs(px - x(b)) <= CORNER) return { fade: 'out', a, b, len: 0 }
    if (bottom - py <= CORNER && px <= x(b) + 2 && x(b) - px <= CORNER) return { transform: true, a, b, to: b, x: px, y: py, rect: lane, spec: L.spec.includes(lane), db: 0, ratio: 1 }
    if (mod && Math.abs(x(b) - px) <= EDGE) return { stretch: true, a, b, to: b }
    if (mod && within) return L.spec.includes(lane) ? { lift: 'pitch', a, b, rect: lane, y: py, ratio: 1 } : { lift: 'gain', a, b, rect: lane, y: py, db: 0 }
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
    more.push(selection)
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
      // on the frequencies, they zoom, around the pinch, by how far apart the fingers go up and down; else time
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
    else if (drag.carry) {
      if (!drag.moved && Math.abs(px - drag.x) < 3) return
      drag.moved = true
      const d = drag.b - drag.a
      drag.to = Math.max(0, Math.min(duration - d, snap(drag.a + time(px) - time(drag.x))))
      pieces = arrange(drag.carry, drag.a, drag.b, drag.to)
    }
    // stretch keeps within a quarter and four times the length (fn/stretch.js)
    else if (drag.stretch) {
      const d = drag.b - drag.a
      drag.to = Math.max(drag.a + d / 4, Math.min(drag.a + d * 4, snap(time(px))))
      pieces = arrange('stretch', drag.a, drag.b, drag.to)
    }
    // the lane's height is 24 dB, in half-dB steps, from −24 to +12
    else if (drag.lift === 'gain') {
      drag.db = Math.max(-24, Math.min(12, Math.round((drag.y - py) / drag.rect[3] * 48) / 2))
      pieces = arrange('gain', drag.a, drag.b, drag.a, drag.db)
    }
    else if (drag.lift === 'pitch') drag.ratio = yf(drag.rect, py) / yf(drag.rect, drag.y)
    // the corner: across, the length, a quarter to four times it; up or down, the level in half dB (the lane's height is
    // 24 dB) or the pitch; the picture shows both at once
    else if (drag.transform) {
      const [qx, qy] = lock(event, px, py), d = drag.b - drag.a
      drag.to = Math.max(drag.a + d / 4, Math.min(drag.a + d * 4, snap(drag.b + time(qx) - time(drag.x))))
      if (drag.spec) drag.ratio = yf(drag.rect, qy) / yf(drag.rect, drag.y)
      else drag.db = Math.max(-24, Math.min(12, Math.round((drag.y - qy) / drag.rect[3] * 48) / 2))
      pieces = arrange('stretch', drag.a, drag.b, drag.to, drag.db)
    }
    // a fade shows on the waveform as it is dragged
    else if (drag.fade) {
      const len = drag.fade === 'in' ? time(px) - drag.a : drag.b - time(px)
      drag.len = Math.max(0, Math.min(drag.b - drag.a, snap(len)))
      pieces = drag.len > 0 ? faded(drag.fade, drag.a, drag.b, drag.len) : null
    }
    else {
      if (!drag.moved && Math.abs(px - drag.x) < 3) return
      drag.moved = true
      drag.hear = snap(time(px) + drag.offset)
      if (drag.caret) { scrub(drag); setCursor(drag.hear) }
      else if (drag.box) {
        const f = snapF(drag.box, py)
        select(drag.anchor, drag.hear, [Math.min(f, drag.f), Math.max(f, drag.f)])
        drag.band = band
        scrub(drag)
      }
      else if (drag.adding) { if (!drag.started) { drag.started = true; if (selection) more.push(selection) } select(drag.anchor, drag.hear, null, true); scrub(drag) }
      else { select(drag.anchor, drag.hear); scrub(drag) }
    }
    invalidate()
  }
  // What a press would grab, as the pointer: a hit's tick, the gain line or a point on it, a voiced stretch of the pitch
  // curve, a selection's edge or the caret; a caret over the waveform, a cross over the spectrogram's time and frequency
  let held = {}
  function hover(px, py, keys = held) {
    held = keys
    const L = lanes(), rect = show.gain && ampLanes(L).find(r => inside(r, px, py)), spectral = L.spec.some(r => inside(r, px, py))
    const scaling = onScale(px, py, L), grip = holds(keys, px, py, L)
    root.title = scaling ? `Frequency scale: ${scales[scale].text}. Click for ${nextScale()}` : ''
    root.style.cursor = scaling ? 'pointer'
      : grip?.fade ? 'ew-resize'
      : grip?.transform ? 'nwse-resize'
      : grip?.stretch ? 'col-resize'
      : grip?.lift ? 'ns-resize'
      : grip?.carry ? (grip.carry === 'copy' ? 'copy' : 'grab')
      : nearMarker(px, py) >= 0 ? 'pointer'
      : show.hits && nearCue(px, py) >= 0 ? 'col-resize'
      : rect && onLine(rect, px, py) ? (pointAt(rect, px, py) >= 0 ? 'move' : 'ns-resize')
      : show.pitch && pitchDown(px, py, L) ? 'ns-resize'
      : nearEdge(px) != null || nearCaret(px, py) ? 'ew-resize'
      : spectral ? 'crosshair' : ''
  }
  function leave() { hovered = null; invalidate(true) }
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
      else if (Math.abs(d.to - d.a) < 1e-9 || !onedit(d.carry, { at: d.a, duration: length, to: d.to })) pieces = null
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
    else if (d.fade) { if (!(d.len > 0 && onedit('fade', { kind: d.fade, at: d.a, duration: d.b - d.a, length: d.len }))) pieces = null }
    // the corner: the length first, then the level or pitch of what it became; the picture keeps both until the output
    else if (d.transform) {
      const factor = (d.to - d.a) / (d.b - d.a), stretched = Math.abs(factor - 1) >= 1e-3, semitones = Math.round(12 * Math.log2(d.ratio) * 10) / 10
      let wrote = stretched && onedit('stretch', { at: d.a, duration: d.b - d.a, factor })
      const b = wrote ? d.to : d.b
      if (d.db) wrote = onedit('lift', { range: [d.a, b], db: d.db, drawn: true }) || wrote
      if (semitones) wrote = onedit('pitch', { at: d.a, duration: b - d.a, semitones }) || wrote
      if (!wrote) pieces = null
      else if (stretched) select(d.a, b)
    }
    else if (d.adding && !d.moved) {}
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
    if (py > plot().h || onScale(px, py, L)) return
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
    else { anchor = null; if (selection) select(0, 0); setCursor(to) }
    reveal(to)
  }
  // The wheel on the frequencies zooms them, on the times it zooms time, and elsewhere with Ctrl or ⌘ (a trackpad's
  // pinch) too; else it pans
  function wheel(event) {
    if (!duration) return
    event.preventDefault()
    const [px, py] = local(event), span = end - start, rect = lanes().spec.find(r => inside(r, px, py)), freqs = onFreqs(px, py)
    const lines = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 400 : 1, across = Math.abs(event.deltaX) > Math.abs(event.deltaY)
    const factor = Math.exp(Math.max(-50, Math.min(50, event.deltaY * lines)) * .01)
    if (freqs) return zoomFreqs(factor, uy(freqs, py))
    if (event.ctrlKey || event.metaKey || py > plot().h && !across) return zoom(factor, clamp(time(px)))
    // up and down over zoomed-in frequencies moves through them; otherwise the wheel moves through time
    if (rect && fview[1] - fview[0] < 1 && Math.abs(event.deltaY) > Math.abs(event.deltaX)) {
      const du = event.deltaY * lines / rect[3] * (fview[1] - fview[0])
      return setFreqs(fview[0] - du, fview[1] - du)
    }
    const delta = (Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY) * lines
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
    onselect(selection, band, ranges())
    invalidate()
  }
  // Every range selected, in time order
  const ranges = () => selection && !band ? [selection, ...more].sort((p, q) => p[0] - q[0]) : selection ? [selection] : []
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
    fview = [0, 1]; covered = null; whole = false; version++
    refreshSpectrum(0); invalidate()
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
    else if (k === '0' && !mod) { fview = [0, 1]; setRange(0, duration) }
    else if (k === 'Escape' && selection) select(0, 0)
    else if (mod && k.toLowerCase() === 'd') addNext()
    else if (mod && k.toLowerCase() === 'a') select(0, duration)
    else if ((k === 'Delete' || k === 'Backspace') && selection) onedit('remove', band ? selection : ranges())
    else if (mod && k.toLowerCase() === 'x' && selection && !band) onedit('cut', selection)
    else if (mod && k.toLowerCase() === 'c' && selection && !band) onedit('copy', selection)
    else if (mod && k.toLowerCase() === 'v') onedit('paste', [cursor, cursor])
    else if (mod && k.toLowerCase() === 'z') onedit(event.shiftKey ? 'redo' : 'undo')
    else if (mod && k.toLowerCase() === 'y') onedit('redo')
    else return
    event.preventDefault()
  }

  // A waveform per channel, dim while it is the file arriving
  function lay(n, dim = false) {
    while (waves.length > n) waves.pop().destroy()
    for (let i = 0; i < n; i++) (waves[i] ||= new Waveform(gl, { rms: false, density: true })).update({ color: color(dim ? '--color-screen-wave-dim' : '--color-screen-wave') })
  }
  // After new samples: frames again, the selection and the caret within them, and the range kept where it still fits
  function renew(all) {
    covered = null; whole = false
    version++
    if (!duration) { spec?.clear(); selection = band = null; start = end = 0; invalidate(); return }
    if (selection) selection = [Math.min(selection[0], duration), Math.min(selection[1], duration)]
    if (selection && selection[1] - selection[0] <= 0) selection = band = null
    more = more.map(([a, b]) => [Math.min(a, duration), Math.min(b, duration)]).filter(([a, b]) => b > a)
    cursor = Math.min(cursor, duration)
    // A view of everything stays everything; a zoomed view keeps its place where it still fits.
    if (all || end - start <= 0) setRange(0, duration, false)
    else if (end > duration) setRange(duration - (end - start), duration, false)
    else invalidate()
    refreshSpectrum(0)
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
      pieces = null
      channels ||= []
      count = channels.length; rate = sampleRate || rate
      duration = channels[0]?.length ? channels[0].length / rate : 0
      lay(count)
      channels.forEach((data, i) => waves[i].update({ data }))
      renew(all)
    },
    // An output as it arrives: stream() starts it, `total` samples long where that is known, else as long as what has
    // come, `dim` while it is the file arriving, not yet the output; append() adds each piece; finish() ends it, its
    // length what came. The view shows it all, unless it was zoomed into an output of the same length.
    stream({ sampleRate, channels, total = null, dim = false }) {
      const all = !duration || start <= 0 && end >= duration || arriving?.fit || dim || !total
      count = channels; rate = sampleRate || rate
      arriving = { total, length: 0, dim, fit: all }
      pieces = null
      duration = total ? total / rate : 0
      lay(count, dim)
      for (const wave of waves) wave.update({ data: new Float32Array(0) })
      if (dim) { selection = band = null; more = [] }
      renew(all)
    },
    append(channels) {
      if (!arriving) return
      channels.forEach((data, i) => waves[i]?.push(data))
      arriving.length += channels[0].length
      // past what was expected, or with nothing expected: as long as what has come
      if (arriving.length / rate > duration) duration = arriving.length / rate
      if (arriving.fit) setRange(0, duration, false)
      else invalidate()
      // sharper as it comes: frames for what has arrived, each computed once (worker.js spectrum)
      if (!arriving.dim && performance.now() - fetched > 400) { fetched = performance.now(); whole = false; refreshSpectrum(0) }
    },
    finish() {
      if (!arriving) return
      const all = arriving.fit
      duration = arriving.length / rate
      arriving = null
      lay(count)
      renew(all)
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
      display = mode; covered = null; whole = false; version++
      if (mode === 'wave') { spec?.clear(); if (band) { band = null; onselect(selection, null) } }
      refreshSpectrum(0); invalidate()
    },
    get scale() { return scale },
    set scale(name) { setScale(name) },
    // what shows besides the sound (hits, pitch, gain, meters), as the View menu has it
    set show(flags) { show = { ...flags }; invalidate() },
    set units(name) { units = name; invalidate(true) },
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
      if (t != null && !drag && span < duration && (t > start + span / 2 || t < start)) setRange(t - span / 2, t + span / 2, false)
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
    // every range selected, in time order; addNext() adds the next like the selection (⌘D)
    get ranges() { return ranges() }, addNext,
    select, setCursor, around, step: stepTo,
    zoom, zoomTo: (a, b) => { const pad = (b - a) * .05; setRange(a - pad, b + pad) }, fit: () => { fview = [0, 1]; setRange(0, duration) }
  }
}

// A time with all its decimals: 5.0s, 5.000s; minutes past a minute, 1:05.0
function clock(t, digits) {
  if (t < 60) return `${t.toFixed(digits)}s`
  const m = Math.floor(t / 60), s = (t - m * 60).toFixed(digits)
  return `${m}:${s.padStart(digits + 3, '0')}`
}
