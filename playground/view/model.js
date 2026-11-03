import kept from '../kept.js'

// The view's model: its measures, kinds and notes, its pointers; what view() is given, the layers and GL mount() makes
// for it, and the state its API or more than one part writes, written from outside through assign(). view() is made
// once a page (editor.js is its one caller), so what it holds is the module's

// GAP between lanes is 2 px, as between the pictures and the meters. GUTTER holds the axis labels at most, seven
// characters (a frequency marked zoomed far in, 1.005k); the axis is as wide as the labels it has (axisWidth), five at
// full scale. STICK, how near the pointer takes a cue (held ⌘), and the levels zoomed onto full scale: either side, a
// 10 px reach; ONTO, how near a dragged time goes onto a cue or a marker, 3 px either side, so a drag goes where it is
// put but by what it meets
export const GUTTER = 48, RULER = 22, GAP = 2, EDGE = 6, SNAP = 6, STICK = 5, ONTO = 3, INSET = 3, NOTCH = Math.log(1.5)
// A band: a track's lane, or a sound's lanes all told, GAP px apart, and under it its foot, FOOT px: what is about the
// band but is not its sound, its takes' numbers, a selection's tools, a sound's look, its axis' last label, never over
// the sound; dragged, the band's height (Finder's column edge; with Alt, every band's), nothing drawn for it. A track's
// band its head line over it, HEAD px, where its layer is (editor.js layers: its look, its name, its mute and its
// lock), so a track never reads as a channel
export const HEAD = 20, FOOT = 18
// A track's lane TRACK px tall, a sound's lanes the picture all told, unless its foot is dragged (LOW px at least); more
// than the picture holds scroll up and down through it, as a DAW's tracks do, the room under the last always in reach:
// ROOM px at least (all there is under the last lane, a lane's foot dragged up giving it more). Pointed at, a new
// track's lane there, under tracks where the one made there will be and as tall as the last (editor.js anew), its part
// in sight; its centre line faint; pressed, its caret, which a take, a paste or a file dropped there makes a track of,
// as a layer in Figma is made by drawing, never added empty
export const TRACK = 160, LOW = 32, ROOM = 80
// What a band shows, its look drawn as it: a waveform's bars, a spectrogram's lines, a voice's notes rising
export const KINDS = {
  wave: ['Waveform', 'M4 10v4m4-8v12m4-15v18m4-14v10m4-6v2'],
  spec: ['Spectrogram', 'M4 5h16M4 9.5h10M4 14h13M4 18.5h6'],
  notes: ['Notes', 'M3 16h5m0-5h5m0-4h4m0 7h4']
}
// ⌘ (Ctrl) held while dragging aims finely: the pointer's moves go a quarter as far, and nothing snaps
export const FINE = .25
// A frequency's note, as a tuner says it, and how far off it is in cents, from `cents` off on (Infinity: the nearest
// note alone). Notes of equal temperament, A4 at 440 Hz, MIDI note 69 (ISO 16; MIDI 1.0)
export const NOTES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B']
export const midiOf = f => 69 + 12 * Math.log2(f / 440)
export const noteOf = (f, cents = 1) => {
  const m = midiOf(f), k = Math.round(m), ct = Math.round((m - k) * 100)
  return `${NOTES[(k % 12 + 12) % 12]}${Math.floor(k / 12) - 1}${Math.abs(ct) >= cents ? `${ct > 0 ? '+' : '−'}${Math.abs(ct)}ct` : ''}`
}
// The pitch curve's bends, as Praat's Manipulation editor shows them (Stylize pitch, 2 st; PitchTier_stylize,
// praat/fon/PitchTier.cpp): of each voiced stretch, the frame that the straight line between its neighbours (in Hz)
// misses by least goes, till the least missed is more than `res` semitones off; a stretch's ends stay. Times, s
export function stylize(times, f0, res = 2) {
  const knots = []
  for (let i = 0; i < f0.length; i++) {
    if (!f0[i]) continue
    let j = i
    while (j + 1 < f0.length && f0[j + 1]) j++
    const run = []
    for (let k = i; k <= j; k++) run.push([times[k], f0[k]])
    for (;;) {
      let best = 0, least = Infinity
      for (let k = 1; k < run.length - 1; k++) {
        const [ta, fa] = run[k - 1], [t, f] = run[k], [tb, fb] = run[k + 1], d = 12 * Math.abs(Math.log2(f / (fa + (fb - fa) / (tb - ta) * (t - ta))))
        if (d < least) { least = d; best = k }
      }
      if (!best || least > res) break
      run.splice(best, 1)
    }
    knots.push(...run.map(([t]) => t))
    i = j
  }
  return knots
}
// The page's one press, wherever it is: held HOLD ms within SLOP px of where it went down, it is held, and opens what
// the press holds, as a touch's long press does, a little sooner than iOS's (0.5 s): on the picture or its time row the
// caret, no selection, the sound under it as it is dragged (iOS's loupe); on Play the speed's line. Moved SLOP px before
// that, it is a drag: a range, a handle, a card, a tab, Play's search. Whatever else holds or drags takes these
export const HOLD = 400, SLOP = 3
// Pointers of their own: a stretch's, its two ends pushed apart, arrows out to bars (the resize arrows are the edges')
const pointer = (path, hx = 12, hy = 12) => `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' width='24' height='24' fill='none' stroke-linecap='round' stroke-linejoin='round'><path d='${path}' stroke='white' stroke-width='4'/><path d='${path}' stroke='black' stroke-width='1.5'/></svg>`)}") ${hx} ${hy}`
export const STRETCH = `${pointer('M3 7v10M21 7v10M7 12h10M10 9l-3 3 3 3M14 9l3 3-3 3')}, ew-resize`
// Shift's, the I-beam with a plus on the side the selection goes out to it from; Alt's, with a plus at its foot: another
export const EXTEND = [`${pointer('M6 9v6M3 12h6M13 5h4M15 5v14M13 19h4', 15)}, text`, `${pointer('M18 9v6M15 12h6M7 5h4M9 5v14M7 19h4', 9)}, text`]
export const ADD = `${pointer('M7 5h4M9 5v14M7 19h4M17 13v6M14 16h6', 9)}, copy`
export const mac = /Mac|iP(hone|ad|od)/.test(navigator.platform)
export const LEVELS = [0, -6, -12, -24, -48, -18, -36, -30, -60, -72, 6, 12]  // dBFS the level axis marks, halvings first, where they fit
export const TICK = 12                               // a tick's length on either axis, px
export const VOICE = [60, 1000]                      // a voice's range, Hz: a tune's notes drawn within it where no pitch curve is
export const GAIN = [-36, 12]                        // the gain line's scale, dB: the lane's centre line to its edges, 0 dB
                                              // three quarters of the way out, so a boost shows above it
export const GLIDE = .3                               // a playhead past the view's middle is drawn to it in this time constant, s


// What view() is given (editor.js), kept as it mounts: its element, its callbacks, its zoom's limits and overshoot
export let root, onaxis, onselect, oncursor, onedit, onmode, onscrub, oncontext, onaudition, onfocus, ontake, onfork, onghost, onlayout, onheight, onlook, onbusy, onprobe, onsamples, onheard, hint, keepRoom, closest, farthest, overshoot, timeRow
export const element = (tag, className, parent) => parent.appendChild(Object.assign(document.createElement(tag), { className }))
const layer = (name, parent = root) => element('canvas', name, parent)
export const color = name => style.getPropertyValue(name).trim()
// A range pointed at in its strip, no takes from where it starts: a fork (⌥, a branch) at its end inside it, where
// takes' numbers stand, as their own one, a press on it starting takes there (onfork, the marker)
export const FORK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 7h6l6 10h6M15 7h6"/></svg>'
// The element's layers, its GL contexts and buttons, made by mount() in this order, the DOM's order
export let cut, reel
export let fades
export let selectCanvas, specCanvas, waveCanvas
export let rowStrip, marksCanvas
export let meterStrip, barStrip, overlay
export let runway, head, headLines, headTick, headTime
export let gl
export let sgl
export let overlayKept, marksKept, selectKept
export let oc, mc, sel2d
export let c
let style
export let forkButton
export let lookButton
export let waves = [], specs = [], count = 0, rate = 44100, duration = 0, display = 'wave', units = 'clock', hovered = null
// what shows besides the sound; the pauses in it, for selecting and stepping as in a text
export let show = { hits: true, gain: true, meters: true, spectrum: true, keys: true, guides: true }, segments = { silences: [] }
// the output's markers: [{ time, label }], a range's with its duration, in the strips under the lanes; with tracks,
// each its track's (`track`, its name), its line in that track's lane alone, its triangle in that track's strip
export let markers = []
// an output arriving: { total, length, dim, fit }; total samples where known, `dim` while it is the file, not the output
export let arriving = null
// more ranges beside the selection, as a text editor's several selections: [[a, b], …], or on the spectrogram more
// boxes, as Photoshop's several selections: [[a, b, low, high], …]; edits act on them all
export let more = []
// where a file held over the picture would go in, or null; `droppedNew`, held over the room, into a new track
export let dropped = null, droppedNew = false
// the meters at the right edge: each channel's { rms, peak } and spectrum (dB per bin of `size` at `rate` Hz), or none
export let meters = null
// A take being recorded over the output (a tape's punch-in), or into nothing: from `at` s, its `length` samples at
// `rate`, the first `lead` of them before `at` (heard late, as the others played: editor.js aligned), left out as its
// output leaves them, a waveform and a spectrogram per channel, each drawn in its picture's lanes; the output it replaces hidden,
// the output after it where it is. The view keeps its scale and follows the take, its head held a tenth short of where
// the lanes end, clear of the meters, as a recording app's; into nothing, RECORD s across.
export let recording = null
// Nothing there (`empty`, set by the page: a tab with no sound, none coming): an empty track, as an empty page has its
// caret, its lane, the caret at its start, its time row over the RECORD s a take into it is first watched over; what a
// drop, a paste or a take puts there then
export let empty = false
// New output in place of the one shown (replace), its twins weighed for it where they are (`leaves`, set). One as long
// as it, at its rate, is drawn anew only where it differs (an edit over a range, a band taken out): the rest of each
// picture, its levels and the view stay as they are.
export let asking = 0
// The picture as an edit leaves it, before its output comes: pieces of the output as it is, each drawn where it goes
// (a move, a copy put in, a stretch, a level while dragged; a delete, a cut, a crop once written), [{ s0, s1, d0, d1,
// gain }] in seconds, the span it shows and the span it goes to; silence it opens, a piece at no level, drawn as a
// waveform draws silence (`silent`, standing in for none of the output). None: the output as it is.
export let pieces = null
export let guest = null
// the time shown [start, end], and the part of the spectrogram's frequency axis shown, 0..1 on its scale
export let start = 0, end = 0, fview = [0, 1], selection = null, band = null, cursor = 0, playhead = null, played = 0, speed = 1, guides = []
// followed, where the playhead is drawn past where it is, < a device pixel: the view's start on the pixels' grid
export let nudge = 0
// the view moved by hand while it plays (the wheel, the scrollbar, a zoom to a range): it stays where it was put, the
// playhead not followed till, seen in it, it passes its edge (playhead). A zoom, a pinch's too, only scales it (zoomSpan)
export let steered = false
// the cues, [t, …] s, in time order, null till they are found (a track just pressed, an output of a new length); how
// plain each is (`ranks`, time → how far the level steps across a hit, dB; Infinity for a pause's edge or a cue moved,
// which outrank every hit)
export let cues = null, bounds = new Set(), ranks = new Map(), envelope = null, shift = null, contour = null, snapping = true, fadeCurve = 'linear'
// each cue's kind, by its index: 'start' or 'end' of a sound, 'hit', or none (one a warp placed)
export let cueKinds = []
// a pitch or an intonation a tool let go on the selection: the pitch curve shows it until the output it makes comes
export let landed = null
// where the output clips, [[from, to], …] s: underlined red on the time row
export let clips = []
// the sample values a waveform lane shows, bottom to top: [-1, 1] full scale; zoomed in, a part of it, scrolled up or
// down (a quiet sound magnified); zoomed out, what goes over. And how the axis writes them: 'linear', the values, or
// 'db', mirrored about the centre line
export let aview = [-1, 1], levelUnits = 'linear'
// what the grip past a selection's end does to its length, chosen from a click on it: 'trim' (cut back, or silence
// added), 'stretch' (the pitch kept) or 'speed' (the pitch following, as a tape's); and whether pitch is edited: the
// pitch curve and the pitch line in place of the gain line (`pitchLine`)
export let gripMode = 'stretch', pitching = false
// how the time row marks time: 'labels' with their ticks, 'ticks' alone, or 'none'; the caret's, the pointer's and a
// selection's times show whatever it is
export let ruler = 'labels'
// how the lanes are ruled (paintGrid): 'marks', 'crosses', 'dots', 'lines' or 'none'
export let grid = 'none'
// the steps a selection's level goes up or down in, dB, as the pill is dragged
export let levelStep = 1
export let look = {}, picked = null
// how the waveform draws, as the lab's waveforms do (audiojs.github.io, lab/waveform): `colour` 'none', or for what it
// holds in frequency, a stretch at a time (tint.js coloured): 'bands', 'layers', 'centroid' or 'dominant', in the
// colormap `map` (tint.js MAPS, or 'grey', the screen's ink); `lanes` 'split', a lane each channel, or 'one', every
// channel in one lane, each its own hue; `fill` gl-waveform's density: 'density' (Gaussian, a full body), 'cloud'
// (Laplace, a soft cloud) or 'body' (one shade to about its RMS, soft past it); 'rms' (a lighter core as loud as its
// RMS) or 'flat' (the peaks alone, one shade); `weighting` its levels zoomed out as heard (weigh): 'none', 'k' or 'a'
export let waveLook = { colour: 'none', lanes: 'split', fill: 'density', map: 'temperature', weighting: 'none' }
// the channels' samples the pictures hold, for their colours
export let data = []
// Tracks (the script's sounds side by side in time, code.js tracks), a lane each, its channels averaged: [{ name, end,
// muted, locked }], its sound ending at `end` s; null, one sound, a lane per channel. Each its own colour, its
// waveform's and its layer's (tint); named, muted and locked in its layer (editor.js layers). A muted one's waveform
// dim, as the mix is without it; a locked one's taken by no press, as a locked layer is on Figma's canvas. The one edited
// (`focus`, its lane) holds the caret, the selection, their handles, the edits drawn ahead and what a step sets; the
// playhead and the time row run through them all. Each marker is its track's, marked in its strip: only the edited
// track's take a dragged time or a double-click onto them. A press in another lane makes it the one edited
// (`onfocus`), all else there was gone
export let tracks = null, focus = 0
// With tracks, a caret or a range is the edited track's alone; ranges dragged out on the time row run through every
// lane (`allLanes`), as a DAW's ruler selects across its tracks: an edit of them is every track's (editor.js spread), so
// a cut keeps them in time. Alt adds more of the same; a plain press in a lane makes the selection that track's again
export let allLanes = false
// Takes (editor.js places): where recordings of one stretch went in, one heard, the others turned off (`sections`,
// [{ at, end, on, names, lane, open }], `lane` the track's, or none for a sound's, a name '' an empty take's, `open`
// while one is there); each a section of its lanes, from where they go in to where the longest ends, drawn as a range
// marker is, always, its place pressed selecting it as a range marker's does, and at its end inside it their numbers,
// written as a range's name is, the one heard lit, then a fork (another take, as a range's): a press on one hears it,
// the one heard pressed again is turned off; on the fork an empty take is added there, for the next recording to go
// into, the fork off till one has (ontake, its index, the take's or 'add'). A range marked over the same place names
// it, its name at its start, these at its end. More than FOLD + 1: FOLD of
// them about the one heard, in sight as a pager keeps its page, … either side for those past them, a menu of them all
// (ontake 'more', the button)
export let sections = []
export let windows = null, windowsOf = 0
export let leveled = false, anchor = null
// what scrolls the view (the settings): 'bar', a thin bar at the time row's top; 'hover', the same bar shown only while
// it is reached for (barLight); or 'overview', the whole sound in a strip of its own under it (MAP)
export let scroll = 'bar'
export let reached = -Infinity
export let heights = {}, lift = 0
// What a band shows: a track's own, as chosen for it (`kinds`, by its name: 'wave', 'spec' or 'notes'), else the
// picture's (`display`), as Audacity's tracks each show a waveform or a spectrogram; a sound's lanes, the picture's
export let kinds = {}
// The notes each notes lane holds, by its index (worker.js notes); a lane's keys, [lo, hi] MIDI, a row each: its notes',
// two past them either way, two octaves at least about their middle; a voice's (VOICE) while it has none. Zoomed (a
// pinch, or Ctrl and the wheel, on its keys), its band's own (`zoomed`, by its name), a part of a row at
// either edge as it may be: the rows from lo − ½ to hi + ½
export let noted = {}, zoomed = {}
// A frame: the pictures when they changed, the overlay always; the pointer's readout redraws only the overlay
export let pictures = false
export let cruise = 0, cruised = 0
export let palette = null
export let moving = null
// The overview's waveform, drawn once for a sound, a size, the track edited and the look, over the sound alone (a view
// past its end narrows it, not drawn again), as a lane draws it: gl-waveform's envelope, pixel for pixel as its shader
// has it (mapPixel), in the lanes' fill and the lane's colour, a sound's coloured as its lanes are (mapColour). Each device pixel's column the lowest, highest and RMS
// of its samples over the channels shown, from the samples or a long sound's leaves (gl-waveform's peaks, [min, max,
// Σx², count] a 256 samples); its loudest at the strip's edges. A new canvas each time, as the strip lays a frame only
// where what it draws differs (kept.js): the one canvas drawn anew would draw as the same
export let leavesOf = null, map = null
export let ruled = '', under = null
// Markers: a line of one shows only as a ghost of the caret, where a press would put it: a moment's, its triangle or
// name pointed at in its strip, a range's end, its triangle; either's line neared in the lanes (markAt); a marker's
// end dragged, where it goes. Its triangle and name are its band's strip's (paintStrips). With tracks, a marker's line
// in its track's lane alone. A marker chosen, by a press on its triangle, lit in its strip: Delete takes it away
// the marker chosen, { time, duration }, till the caret or the selection goes elsewhere
export let chosen = null
// Editing pitch, the spectrogram's frequencies framed on the voice, as Praat's pitch panel is: from half its lowest to
// twice its highest (its 5th and 95th percentiles), so its rises and falls show and a pixel is a few cents; once, as
// its curve first comes, the frequencies as they were again when pitch is left (`unframed`)
export let framed = false, unframed = null
// Zoom the levels around the value u, which stays where it is on screen: from a thousandth of full scale across to
// eight times it, held at full scale on the way, a detent: a zoom that crosses it, or brings its line within STICK px of
// the lane's edge (`lh` px tall), lands on -1..1 exactly, and stays there until the zoom gathered there (`pull`) takes
// the line past STICK px again; a pinch's last small steps as the fingers lift leave it where it is.
// Zoomed in, what shows stays within full scale; zoomed out, it is centred on 0, what goes over either side.
export let pull = 1
export let held = {}
// the spectrogram's colours: its colormap's, or its levels in the skin's ink over the screen (tint.js inked), bent by
// its gamma, 17 stops as the colormaps have; made once a look and a skin, as the meter takes them each frame
export let shaded = null
export let ahead = false

// The view mounted on its element, once: what it is given kept, its layers made and laid in their order
export function mount(el, given) {
  root = el
  ;({ onaxis, onselect, oncursor, onedit, onmode, onscrub, oncontext, onaudition, onfocus, ontake, onfork, onghost, onlayout, onheight, onlook, onbusy, onprobe, onsamples, onheard, hint, keepRoom, closest, farthest, overshoot, timeRow } = given)
  // the selection under the pictures, as a selection is behind text: the sound drawn over it, a quiet spectrogram's
  // clear ground showing it; the grid over the spectrogram, under the waveform, in the waveform's canvas (paintGrid). The
  // pictures on a reel (roll), cut where the lanes end (editor.css --end): drawn past the view's right end, the reel
  // moved as the view moves within them, by the compositor, nothing drawn again
  cut = element('div', 'reel-cut', root), reel = element('div', 'reel', cut)
  // where the view stops short of the sound, its lanes fade out at that edge, as a list scrolled on does (placeFades)
  fades = [element('div', 'fade fade-start', root), element('div', 'fade fade-end', root)]
  selectCanvas = layer('select', reel), specCanvas = layer('spectrum', reel), waveCanvas = layer('waveform', reel)
  // over the pictures on the reel, what is drawn in time (marks): the markers, the cues, the carets, the ranges' edges
  // and handles; under them the time row's times and ticks, a strip of their own (onRow), so the pointer's time there,
  // which changes as the reel runs under a pointer held still, lays only the strip again. Over the reel, what stays as
  // it moves (overlay): the axes, the pointer's readouts, what is measured; under it, what changes as it plays, a strip
  // each (onStrip): the meters by the lanes' end, the scrollbar or the overview under the time row
  rowStrip = kept(layer('row', reel).getContext('2d')), marksCanvas = layer('marks', reel)
  meterStrip = kept(layer('meters').getContext('2d')), barStrip = kept(layer('scrollbar').getContext('2d')), overlay = layer('overlay')
  // the playhead as it moves, over the overlay: a layer of its own, its line down the lanes, its tick and time on the
  // time row, moved by the compositor (slide), within the lanes' width
  runway = element('div', 'playhead', root), head = element('div', 'head', runway), headLines = element('div', 'lines', head), headTick = element('i', 'tick', head), headTime = element('span', 'when', head)
  runway.hidden = true
  // gl-waveform draws its own anti-aliased coverage; the context needs premultiplied alpha, not multisampling
  gl = waveCanvas.getContext('webgl2', { premultipliedAlpha: true, antialias: false })
  // gl-spectrogram computes what a lane shows as it draws it, on the GPU, from the samples it holds: nothing to wait
  // for. It renders into float textures (EXT_color_buffer_float, which nearly every WebGL2 has)
  sgl = specCanvas.getContext('webgl2', { premultipliedAlpha: true, antialias: false })
  if (!sgl?.getExtension('EXT_color_buffer_float')) sgl = null
  // each 2D layer laid only as its drawing changes (kept.js): the reel's marks and selection, the overlay
  overlayKept = kept(overlay.getContext('2d')), marksKept = kept(marksCanvas.getContext('2d')), selectKept = kept(selectCanvas.getContext('2d'))
  oc = overlayKept.g, mc = marksKept.g, sel2d = selectKept.g
  // what the overlay's drawing draws on: the overlay, or, drawing what is in time, the reel's marks (paint)
  c = oc
  style = getComputedStyle(root)
  forkButton = element('button', 'fork', root)
  Object.assign(forkButton, { type: 'button', hidden: true, ariaLabel: 'Another take', title: 'Another take', innerHTML: FORK })
  for (const type of ['pointerdown', 'pointerup', 'contextmenu', 'dblclick']) forkButton.addEventListener(type, e => e.stopPropagation())
  forkButton.addEventListener('click', e => { e.stopPropagation(); const m = markers[+forkButton.dataset.i]; if (m) onfork(m) })
  // A sound's look, a button in its foot under its axis, drawn as what it shows: pressed, how it shows opens by it
  // (onlook: '', and the button). A track's is in its layer (editor.js layers)
  lookButton = Object.assign(element('button', 'lane-look', root), { type: 'button', hidden: true })
  lookButton.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path/></svg>'
  lookButton.setAttribute('aria-haspopup', 'dialog')
  lookButton.setAttribute('aria-expanded', 'false')
  for (const type of ['pointerdown', 'pointerup', 'contextmenu', 'dblclick']) lookButton.addEventListener(type, e => e.stopPropagation())
  lookButton.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') e.stopPropagation() })
  lookButton.addEventListener('click', e => { e.stopPropagation(); onlook('', lookButton) })
  // Its program, a vertex [x, y] device px from the canvas's top left; made again once the context is lost (asking the
  // GL whether it still holds it, isProgram, waits for all the GL has queued)
  waveCanvas.addEventListener('webglcontextlost', () => { under = null })
}

// The writes from outside, by name: assign({ start: a, end: b }) sets each and gives back the last value, as `=` does
const set = {
  duration: x => duration = x, pieces: x => pieces = x, recording: x => recording = x, leveled: x => leveled = x,
  data: x => data = x, arriving: x => arriving = x, count: x => count = x, rate: x => rate = x,
  windows: x => windows = x, windowsOf: x => windowsOf = x, leavesOf: x => leavesOf = x, steered: x => steered = x,
  moving: x => moving = x, tracks: x => tracks = x, allLanes: x => allLanes = x, band: x => band = x,
  more: x => more = x, cursor: x => cursor = x, lift: x => lift = x, heights: x => heights = x, focus: x => focus = x,
  anchor: x => anchor = x, pictures: x => pictures = x, start: x => start = x, hovered: x => hovered = x,
  end: x => end = x, picked: x => picked = x, palette: x => palette = x, kinds: x => kinds = x,
  display: x => display = x, c: x => c = x, fview: x => fview = x, aview: x => aview = x, zoomed: x => zoomed = x,
  reached: x => reached = x, map: x => map = x, ruled: x => ruled = x, under: x => under = x,
  markers: x => markers = x, framed: x => framed = x, unframed: x => unframed = x, pull: x => pull = x,
  chosen: x => chosen = x, selection: x => selection = x, guest: x => guest = x, held: x => held = x,
  cues: x => cues = x, ahead: x => ahead = x, landed: x => landed = x, shaded: x => shaded = x, ranks: x => ranks = x,
  asking: x => asking = x, dropped: x => dropped = x, droppedNew: x => droppedNew = x, waveLook: x => waveLook = x,
  show: x => show = x, snapping: x => snapping = x, fadeCurve: x => fadeCurve = x, units: x => units = x,
  ruler: x => ruler = x, scroll: x => scroll = x, grid: x => grid = x, levelStep: x => levelStep = x,
  look: x => look = x, levelUnits: x => levelUnits = x, meters: x => meters = x, segments: x => segments = x,
  clips: x => clips = x, sections: x => sections = x, bounds: x => bounds = x, cueKinds: x => cueKinds = x,
  gripMode: x => gripMode = x, pitching: x => pitching = x, envelope: x => envelope = x, shift: x => shift = x,
  contour: x => contour = x, noted: x => noted = x, empty: x => empty = x, guides: x => guides = x,
  playhead: x => playhead = x, played: x => played = x, nudge: x => nudge = x, cruise: x => cruise = x,
  cruised: x => cruised = x, speed: x => speed = x
}
export function assign(o) { let x; for (const k in o) set[k](x = o[k]); return x }
