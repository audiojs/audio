import Waveform from '../assets/gl-waveform.js'
import Spectrogram from '../assets/gl-spectrogram.js'
import { CURVES } from './ops.js'
import { frozen, untrack, ghost, unghost, layout, CHUNK, HELD, plot, lanes, inRoom, resized, freeze, own0 } from './view/geometry.js'
import { aimed } from './view/gestures.js'
import { stylize, GLIDE, color, runway, gl, sgl, waves, specs, count, rate, duration, display, hovered, markers, arriving, more, dropped, droppedNew, recording, empty, asking, pieces, start, end, fview, selection, band, cursor, playhead, played, speed, guides, nudge, steered, cues, ranks, cueKinds, aview, pitching, look, waveLook, data, tracks, focus, allLanes, sections, windows, windowsOf, anchor, moving, unframed, held, ahead, mount, assign } from './view/model.js'
import { lanesEnd, reach, seenTo, fitTo, metered } from './view/overlay.js'
import { drag, down, move, drags, hover, leave, up, clicked } from './view/pointer.js'
import { twinsFor, dpr, resize, arrange, moved, invalidate, tints, tonesOf, twinOf, unheard, reshow, snapshot, hues, rgba, channel, shades } from './view/render.js'
import { steer, slide, unslide, bring, fitAll, frameSelected } from './view/ruler.js'
import { scale, x, time, clamp, unit, snap, stuck, local, setRange, setFreqs, frameVoice, zoom, whole, scrollLevels, setScale, reveal } from './view/scales.js'
import { around, stepTo, wheel, select, told, ranges, carets, boxes, addNext, setCursor, context, key, wire as wireSelect } from './view/select.js'
import { same, rename } from './view/strips.js'
export { KINDS, NOTES, noteOf, stylize, HOLD, SLOP } from './view/model.js'
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
  // the paste, at the carets (select.js)
  wireSelect()
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
export { markLane, ownMarks, snappedTo, SIDES, placed, RECORD, unwritten, takes }
