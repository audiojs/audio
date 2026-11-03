import { NOTES, noteOf } from '../view.js'
import { levels, spectra, ballistics } from '../meters.js'
import { recorder, bar, laneIndex } from '../editor.js'
import { root, cueTimes, layouts } from './config.js'
import { state, eng, v, ed, pl, output, shown, carded, notesFor, assign } from './context.js'
import { cuesOf } from './edits.js'
import { dbfs, stamp, hertz, chordName } from './format.js'
import { shows } from './look.js'
import { store } from './persist.js'
import { shiftOf } from './writers.js'

// What the picture and the status bar read of the output: the marks over it (cues, notes, pitch), the meters, the
// level readout, what is heard at the caret, the chord as it plays

// What the picture shows besides the sound, as the View menu says: the cues, the pitch curve, the gain line, meters.
export async function marks() {
  notesShown()
  v.show = state.show
  if (shown && shown.code !== ed.code) { assign({ shown: null }); if (!carded) v.guides = [] }
  if (!state.whole) return
  // the cues whether they show or not: a double-click selects between them, ⌥ and the arrows step by them, an edge goes
  // onto them. They are the output's shown, read against the code that made it; once the code has moved on (a cue
  // dragged), the output coming brings its own, and the cues the view moved stay till then
  // with tracks, the edited track's
  const out = output, i = laneIndex(out), [edges, hits] = await Promise.all([eng.cues(out.id, 'edges', i), eng.cues(out.id, 'hits', i)])
  if (edges && hits && out === output && out.editor === ed.code && laneIndex() === i) v.cues = cuesOf(cueTimes(edges, hits), out.code)
  // the pitch curve, with the pitch line it was measured with, while pitch is edited: drawn on the spectrogram, the note
  // said over the range
  if (state.pitch) { const f0 = await eng.contour(out.id, i); if (out === output && laneIndex() === i) v.contour = { ...f0, shift: shiftOf(out.code) } }
}
export async function notesShown() {
  const out = output
  if (!state.whole || !out?.duration) return
  const names = out.tracks?.map(t => t.name), lanes = names ? names.flatMap((n, i) => shows(n) === 'notes' ? [i] : []) : state.display === 'notes' ? [0] : []
  const key = `${out.id} ${lanes}`
  if (key === notesFor) return
  assign({ notesFor: key })
  const found = await Promise.all(lanes.map(i => eng.notes(out.id, names ? i : undefined)))
  if (out === output && notesFor === key) v.notes = Object.fromEntries(lanes.map((i, k) => [i, found[k]]))
}
// The meters at the view's right: the output's level and spectrum where it is heard (the 50 ms before the playhead, a
// spectrum frame ending there), across the selection, or around the caret (meters.js), or around `probe`, a time
// measured on the spectrogram (view.js onprobe); as it plays or records, the level as a peak meter shows it, its peak
// held a while (ballistics, from the last frame's: `peaked`)
let peaked = null
export function meter(t = null, probe = null) {
  const size = 4096, now = performance.now()
  const live = l => { const dt = peaked ? (now - peaked.at) / 1000 : 0; peaked = { levels: ballistics(l, peaked?.levels, dt), at: now }; return peaked.levels }
  if (t == null && !recorder) peaked = null
  if (!state.show.meters && !state.show.spectrum) { v.meters = null; return }
  // the spectrum read once, and only where a spectrogram's lane draws it (view.js paintMeters): a selection dragged
  // over the waveform reads none, where each move read up to 16 frames a channel
  const read = (levels, f, rate) => { let got; return { levels, get spectra() { return got ??= f() }, size, rate } }
  // recording: what the microphone hears, the 50 ms just come
  if (recorder) {
    const x = recorder.recent, n = x[0]?.length ?? 0, rate = recorder.sampleRate
    v.meters = n ? read(live(levels(x, n - Math.round(rate * .05), n)), () => spectra(x, n - size, n, { size }), rate) : null
    return
  }
  // the caret in the room under the lanes, a new track's to be: nothing there yet to read
  if (!output?.duration || state.ghost && t == null && probe == null) { v.meters = null; return }
  // with tracks, each lane's own; a long output's, the samples about it the player has (none till they come)
  const rate = output.sampleRate, caret = probe ?? v.cursor, sel = t == null && probe == null && v.selection, at = t ?? (sel ? sel[0] : caret), w = output.tracks ? pl.lanes(at) : pl.near(at)
  if (!w) { v.meters = null; return }
  const [a, b] = t != null ? [t - .05, t] : sel || [caret - .025, caret + .025], from = Math.round(a * rate) - w.from, to = Math.round(b * rate) - w.from
  const c = Math.round(caret * rate) - w.from, [s0, s1] = t != null ? [to - size, to] : sel ? [from, Math.max(to, from + size)] : [c - size / 2, c + size / 2]
  const l = levels(w.x, from, to)
  v.meters = read(t != null ? live(l) : l, () => spectra(w.x, s0, s1, { size }), rate)
}
// What the output is, at the status bar's right: its level, short (the output's peak, or the selection's, or the band
// selected), all of them when pointed at (the loudness, the RMS); then its rate, channels and the depth it is written
// at, a click away from resampling, remixing and another depth.
// The peak of samples [from, to), where it is, the sum of their squares and how many: of `chs`, their samples; else of
// `leaves`, a long output's (gl-waveform's, 256 samples a leaf: min, max, sum of squares, count), those the range
// touches whole, within 256 samples at either end, the peak at its leaf's start. { peak, at, sum, n }
function levelsIn(chs, leaves, from, to) {
  let peak = 0, at = from, sum = 0, n = 0
  if (chs) for (const ch of chs) for (let i = from; i < to && i < ch.length; i++) { const x = ch[i]; sum += x * x; n++; if (Math.abs(x) > peak) { peak = Math.abs(x); at = i } }
  else for (const l of leaves) for (let j = Math.floor(from / 256); j < Math.min(Math.ceil(to / 256), l.length / 4); j++) {
    const p = Math.max(-l[4 * j], l[4 * j + 1])
    if (p > peak) { peak = p; at = j * 256 }
    sum += l[4 * j + 2]; n += l[4 * j + 3]
  }
  return { peak, at, sum, n }
}
// Each level as its menu says it (pickReading): of all of it, or of the selection, the loudness all of it's
let readings = {}
// What each level shows on the sound, pointed at (markLevel): the guides of what the readout reads (`readMarks`), and each
// row of its table its own (the fourth of the row): the peak where it is ({ at } s) and at its `level` dB on its own
// lane, the RMS at its level, the crest both
let readMarks = []
export function describe() {
  listen()
  state.sound = null
  state.reading = { of: '', head: '', rows: [] }
  readings = {}
  readMarks = []
  if (!output?.duration) { state.readout = ''; return }
  const { sampleRate, channels, peaks, stats, bitDepth } = output, k = (channels ?? peaks).length
  state.sound = { hz: sampleRate, rate: `${+(sampleRate / 1000).toFixed(3)}kHz`, count: k, channels: layouts.find(l => l.count === k)?.label ?? `${k} ch`, bits: bitDepth }
  const sel = state.selection, lufs = Number.isFinite(stats.loudness) ? `${dbfs(stats.loudness)}LUFS` : '−∞LUFS', clips = output.clips?.length
  // pointed at, every level in a table (index.html #levels), the peak's place among them, and marked on the sound (the
  // tracks mixed, having no lane of their own, on every track's: `every`)
  const table = (of, head, pk, rms, at, rows = [], reads = state.reads) => {
    const every = of === 'all' && !!output.tracks, peak = Number.isFinite(pk) ? [{ at, level: pk, every }] : [], mean = Number.isFinite(rms) ? [{ level: rms, every }] : []
    state.reading = { of, head, rows: [['Peak', `${dbfs(pk)}dBFS`, `at ${stamp(at)}`, peak], ['RMS', `${dbfs(rms)}dBFS`, '', mean], ['Crest', Number.isFinite(pk - rms) ? `${(pk - rms).toFixed(1)}dB` : '–', '', [...peak.map(({ level }) => ({ level, every })), ...mean]], ...rows] }
    readMarks = reads === 'rms' ? mean : reads === 'loudness' ? [] : peak
  }
  if (!sel) {
    // the measure chosen (pickReading), its value alone: the menu and the tip say which
    const r = state.reads
    // (the RMS a sample value, stat('rms'), the peak dBFS already); the peak's place read once an output
    const rms = 20 * Math.log10(stats.rms)
    state.readout = r === 'loudness' ? lufs : `${dbfs(r === 'rms' ? rms : stats.peak)}dBFS`
    readings = { peak: `${dbfs(stats.peak)}dBFS`, rms: `${dbfs(rms)}dBFS`, loudness: lufs }
    output.peakAt ??= levelsIn(channels, peaks, 0, Infinity).at / sampleRate
    table('all', output.tracks ? 'The tracks mixed' : '', stats.peak, rms, output.peakAt, [['Loudness', lufs, 'integrated'], ...clips ? [['Clipped', `${clips} ${clips > 1 ? 'places' : 'place'}`, '']] : []])
    return
  }
  const [a, b] = sel, rate = output.sampleRate, i = laneIndex(), own = output.lanes?.[i], leaves = output.pictures?.leaves[i]
  // the edited track's, with tracks
  const { peak, at, sum, n } = levelsIn(channels && (own ? [own] : channels), leaves ? [leaves] : peaks, Math.floor(a * rate), Math.ceil(b * rate))
  const pk = 20 * Math.log10(peak), rms = 10 * Math.log10(sum / Math.max(1, n))
  // a selection's peak or RMS; its loudness is all of it's, read on its own (the loudness of a part needs it whole)
  const r = state.reads === 'rms' ? 'rms' : 'peak'
  state.readout = state.boxes > 1 ? `${state.boxes} bands` : state.band ? `${hertz(state.band[0])}–${hertz(state.band[1])}` : `${dbfs(r === 'rms' ? rms : pk)}dBFS`
  if (state.boxes > 1 || state.band) return
  readings = { peak: `${dbfs(pk)}dBFS`, rms: `${dbfs(rms)}dBFS`, loudness: `${lufs}, all of it` }
  table('selection', `${output.tracks?.[i] ? `${output.tracks[i].name}, ` : ''}${stamp(a)}–${stamp(b)}`, pk, rms, at / rate, [], r)
}
// A level pointed at, marked on the sound (view.js paintGuide), the one alone: the readout, what it reads; a row of its
// table, that row's. Let go, the guides as they were
let levelMarks = []
export function markLevel(list = readMarks) {
  unmarkLevel()
  levelMarks = list.map(g => ({ ...g }))
  if (levelMarks.length) v.guides = [...v.guides, ...levelMarks]
}
export function unmarkLevel() {
  if (levelMarks.length) v.guides = v.guides.filter(g => !levelMarks.includes(g))
  levelMarks = []
}
// What the level reads (the readout pressed): the peak, the RMS or the loudness (all of it's), each with its value, kept
export function pickReading(event) {
  root.querySelector('#levels')?.hidePopover?.()
  const pick = name => () => { state.reads = name; store(); describe() }
  bar.at([['peak', 'Peak'], ['rms', 'RMS'], ['loudness', 'Loudness']].map(([name, label]) => ({ label, hint: readings[name] ?? '', checked: state.reads === name, run: pick(name) })), 0, 0, event.currentTarget)
}
// What is heard reads (it pressed): the note or the chords, the key, or the tempo, kept
export function pickHeard(event) {
  const pick = name => () => { state.hears = name; store(); listen() }
  bar.at([['note', 'Note or chord'], ['key', 'Key'], ['tempo', 'Tempo']].map(([name, label]) => ({ label, hint: hearings[name] ?? '', checked: state.hears === name, run: pick(name) })), 0, 0, event.currentTarget)
}
// each as its menu says it (listen), where it is clear
let hearings = {}
// What the sound holds, as a musician says it (worker.js listen()), before its levels: the note under the caret or over
// the selection, or where chords sound, the chords there (at most four, in order), the tempo and key of the selection
// or of all of it, each only where it is clear; with tracks, the edited one's; asked once the caret or the selection
// rests, and dropped if they or the track have moved on since. A note's cents from 5 on: less is about the least
// change of pitch heard (frequency DLs of 0.2–0.3% at mid frequencies, 3.5–5 cents: Moore, An Introduction to the
// Psychology of Hearing, 6th ed., 2012, ch. 6), and as close as the pitch curve reads a steady tone (1 cent off on 440 Hz)
let listening = 0
export function listen() {
  clearTimeout(listening)
  state.heard = null
  hearings = {}
  if (!output?.duration || pl.playing || state.band || state.boxes > 1) return
  const out = output, sel = state.selection, at = v.cursor, track = laneIndex(out), now = () => out === output && laneIndex() === track && `${state.selection}` === `${sel}` && (sel || v.cursor === at)
  listening = setTimeout(async () => {
    const r = await eng.listen(out.id, sel ? [...sel] : [at - .06, at + .06], sel ? [...sel] : [0, out.duration], track).catch(() => null)
    if (!r || !now()) return
    // what the key and the tempo were read over: a span past 3 min, its middle 3 (worker.js listen)
    const { pitch, bpm, key } = r, part = r.span && r.span[1] - r.span[0] < (sel ? sel[1] - sel[0] : out.duration) - 1e-3
    const over = part ? `${stamp(r.span[0])}–${stamp(r.span[1])}` : sel ? 'the selection' : 'all of it', where = sel ? 'over the selection' : 'at the caret', chords = r.chords?.map(chordName)
    const chord = chords?.length ? chords.slice(0, 4).join(' – ') + (chords.length > 4 ? ' …' : '') : null
    // the one thing chosen (pickHeard), said in a few words
    const note = pitch ? pitch.length > 1 ? `${noteOf(pitch[0], Infinity)}–${noteOf(pitch[1], Infinity)}` : noteOf(pitch[0], 5) : chord
    hearings = { note, key: key && `${NOTES[key.tonic]} ${key.mode}`, tempo: bpm && `${bpm} BPM` }
    // the key or the tempo chosen and none clear, said so, its menu still a press away (worker.js listen: 6 s at least,
    // its halves agreeing)
    state.heard = state.hears === 'key' ? key ? { text: hearings.key, title: `Key of ${over}` } : { text: 'no key', title: `No key clear in ${over}: 6 s at least, its halves in one key` }
      : state.hears === 'tempo' ? bpm ? { text: hearings.tempo, title: `Tempo of ${over}` } : { text: 'no tempo', title: `No steady tempo in ${over}: 6 s at least, its halves within 4%` }
      : pitch ? { text: note, title: pitch.length > 1 ? `Notes ${where}` : `Note ${where}` }
      : chord ? { text: chord, title: `${chords.length > 1 ? 'Chords' : 'Chord'} ${where}` } : null
  }, 250)
}
// The chord at the playhead as it plays, in the status bar (worker.js chords): the output's chords a block at a time, the
// one the playhead is in and the next a few seconds before it gets there, each asked for once; said as it changes
export let live = { id: null, track: undefined, blocks: [], asking: false, off: false, text: null }
export function chordAt(t) {
  if (live.id !== output?.id || live.track !== laneIndex()) live = { id: output?.id, track: laneIndex(), blocks: [], asking: false, off: false, text: null }
  const has = at => live.blocks.some(b => at >= b.from && at < b.to), want = [t, t + 5].find(at => at < v.duration && !has(at))
  if (want != null && live.id != null && !live.asking && !live.off) {
    const was = live
    was.asking = true
    eng.chords(was.id, want, was.track).then(b => { was.asking = false; if (b) was.blocks.push(b); else was.off = true }, () => { was.asking = false; was.off = true })
  }
  const c = live.blocks.flatMap(b => b.chords).find(c => t >= c.time && t < c.end), text = c ? chordName(c.label) : null
  if (text === live.text) return
  live.text = text
  if (state.hears === 'note') state.heard = text ? { text, title: 'Chord playing' } : null
}
