import { chain, number, setArg, focus } from '../code.js'
import { lane, closeMenus } from '../editor.js'
import { state, v, ed, rk, pl, output } from './context.js'
import { lastEdit, amend, write } from './edits.js'
import { quote, note } from './format.js'
import { shows, showAs } from './look.js'
import { store } from './persist.js'
import { marks } from './readouts.js'

// The edits the picture writes into the script: silence, stretch, trim, crossfade, fades, markers, the pitch and gain
// lines, levels; and a sound resampled, remixed, retuned

// The sound's rate or channels changed from the display: the chain's last resample() or remix() set again, else one
// added at its end
export function resampleTo(hz) { closeMenus(); retune('resample', hz, output?.sampleRate) }
// Down, the ITU-R BS.775 downmix (remix(n), fn/remix.js); up from mono, the sound in the centre (5.1, 7.1) or on both
// sides; from stereo to 5.1 the matrix upmix (surround(): the mid in the centre, the side delayed into the surrounds,
// the LFE lowpassed), on to 7.1 the surrounds in the back pair too, as from 5.1
export function remixTo(n) {
  closeMenus()
  const now = output?.channels.length, wide = 'remix([0, 1, 2, 3, 4, 5, 4, 5])'
  if (!now || n === now) return
  if (n < now || now === 1 && n === 2) return retune('remix', n, now)
  write(now === 1 ? `remix([${Array.from({ length: n }, (_, c) => c === 2 ? 0 : 'null').join(', ')}])` : now === 2 ? `surround()${n === 8 ? `.${wide}` : ''}` : now === 6 && n === 8 ? wide : `remix(${n})`)
}
function retune(name, value, now) {
  const last = amend(name), arg = last?.call.args[0]
  if (arg?.kind === 'number') return ed.change({ from: arg.from, to: arg.to, insert: String(value) })
  if (value !== now) write(`${name}(${value})`)
}
// Where an edit makes a seam (audio taken out and what is either side meets, audio or silence put in, a range moved
// over): an equal-power crossfade that long across it, so it makes no click (the settings; none, 5, 10 or 20 ms, 10 by
// default), the length as it would be without it (fn/remove.js, fn/insert.js, fn/move.js); in an options object, or
// after a paste's time
export const splice = () => state.splice ? `, xfade: ${state.splice / 1000}` : ''
export const seam = () => state.splice ? `, ${state.splice / 1000}` : ''
// Silence pulled open at the caret: insert() of its length there
export function silence({ at, duration }) { return write(`insert(${number(duration, v.unit)}, { at: ${number(at, v.unit)}${splice()} })`) }
// A selection stretched from its end, pitch kept, or sped up or slowed down, the pitch following (its rate, the length's
// inverse); what follows moves with it
// To the sample it was drawn: the range at the view's precision, its factor (or speed) such that it ends where the drag
// let go, so nothing after it moves when the output comes
export function stretch({ at, duration, factor, speed }) {
  const a = number(at, v.unit), d = number(duration, v.unit), n = samplesOf(a, d)
  return write(`${speed ? 'speed' : 'stretch'}(${exact(n, Math.round((at + duration * factor - a) * output.sampleRate), speed)}, { at: ${a}, d: ${d} })`)
}
// The samples a range of the output holds, as the library counts them: from round(at × rate), round(d × rate), or to the end
const samplesOf = (at, d) => Math.min(Math.round(d * output.sampleRate), (lane()?.length ?? Math.round(output.duration * output.sampleRate)) - Math.round(at * output.sampleRate))
// A stretch's factor, or a speed, that makes a range of n samples N long, to the fewest places from 3 that do: the
// library makes it round(n × factor), round(n / speed) samples (fn/stretch.js, fn/speed.js)
function exact(n, N, speed) {
  for (let places = 3; ; places++) {
    const k = +(speed ? n / N : N / n).toFixed(places)
    if (places >= 9 || Math.round(speed ? n / k : n * k) === N) return k
  }
}
// A selection's end moved by the grip, trimming: back, the audio from there to the end goes, the seam crossfaded as a
// delete's; out, silence added there
export function trim({ end, to }) {
  const s = t => number(t, v.unit)
  return write(to < end ? `remove({ at: ${s(to)}, d: ${s(end - to)}${splice()} })` : `insert(${s(to - end)}, { at: ${s(end)}${splice()} })`)
}
// The audio a fade's corner is dragged out over goes, what is either side crossfading across it (fn/crossfade.js)
// (one that comes to no length at the view's precision is none)
export function crossfade({ at, duration }) { const d = number(duration, v.unit); return +d > 0 && write(`crossfade({ at: ${number(at, v.unit)}, d: ${d} })`) }
// A selection's level moved up or down by the pointer, onto the gain curve as a level change is
export const lift = ({ range, db, drawn }) => level(db, range, !drawn)
// A marker at the caret, at each when there are several, or where it plays while it plays; over what is selected, a
// range marked: mark() at the chain's end (M). One made, not playing, its name is asked for where it is written
export function addMarker() {
  if (!state.whole) return
  const s = t => number(t, v.unit), playing = pl.playing
  const spans = playing ? [[pl.time, pl.time]] : [...v.ranges, ...v.carets.map(t => [t, t])].sort((p, q) => p[0] - q[0])
  if (!spans.length) return
  const made = write(spans.map(([a, b]) => b > a ? `mark({ at: ${s(a)}, d: ${s(b - a)} })` : `mark(${s(a)})`).join('.')), [[a, b]] = spans
  if (made && !playing && spans.length === 1) v.name({ time: +s(a), ...b > a && { duration: +s(b - a) } })
  return made
}
// The time a mark() call marks: its number, or its range's start
const markedAt = call => call.name === 'mark' ? call.args[0]?.kind === 'object' ? call.args[0].value?.at : call.args[0]?.value : undefined
// The mark() call that set a marker: the one of its kind, a moment or a range, nearest its time and length; of two
// alike, the later. With tracks, in its track's chain
function markCall({ time, duration = 0, track }) {
  focus(track ?? state.track)
  const all = chain(ed.code)?.calls || []
  focus(state.track)
  const calls = all.filter(k => typeof markedAt(k) === 'number' && !duration === (k.args[0].kind === 'number'))
  const far = k => Math.abs(markedAt(k) - time) + Math.abs((k.args[0].value?.duration ?? 0) - duration)
  return calls.reduce((a, k) => !a || far(k) <= far(a) ? k : a, null)
}
const unmarked = () => note('This marker comes from the file; no mark() in the script sets it.')
// A marker taken away (from its menu), or moved (a drag of its triangle): its mark() call gone, or its time moved
// as much (a range's end dragged, its length too: `d`; a moment pulled apart, a range from then on, its time an options
// object; a range's ends let go on each other, `d` 0, a moment, its time a number), the edits after it being what they
// were
export function unmark(marker) {
  const call = markCall(marker)
  if (!call) return unmarked()
  ed.change({ from: call.dot ?? call.from, to: call.to, insert: '' })
  return true
}
// A marker named, or its name taken away: its mark() call's label
export function relabel({ label, ...marker }) {
  const call = markCall(marker)
  if (!call) return unmarked()
  const [at, named] = call.args
  if (label || named) ed.change({ from: at.to, to: named?.to ?? at.to, insert: label ? `, ${quote(label)}` : '' })
  return true
}
export function remark({ to, d, ...marker }) {
  const arg = markCall(marker)?.args[0], [at, length] = arg?.kind === 'object' ? ['at', 'duration'].map(name => arg.props.find(p => p.name === name)) : [arg]
  if (typeof at?.value !== 'number') return unmarked()
  const s = t => number(Math.max(0, t), v.unit), set = (p, t) => ({ from: p.valueFrom ?? p.from, to: p.valueTo ?? p.to, insert: s(t) })
  if (arg.kind !== 'object' && d) ed.change({ from: arg.from, to: arg.to, insert: `{ at: ${s(at.value + to - marker.time)}, d: ${s(d)} }` })
  else if (arg.kind === 'object' && d === 0) ed.change({ from: arg.from, to: arg.to, insert: s(at.value + to - marker.time) })
  else ed.change([set(at, at.value + to - marker.time), d != null && typeof length?.value === 'number' && set(length, length.value + d - marker.duration)].filter(Boolean))
  return true
}
// A fade in or out over [from, to], from a selection's corner: from its edge inward, or centred on its edge; on its
// curve, unless it is the straight one fade() takes by default
export function fade({ kind, from, to, curve = 'linear' }) {
  const s = t => number(t, v.unit), d = s(kind === 'in' ? to - from : from - to)
  return +d !== 0 && write(`fade(${d}, { at: ${s(from)}${curve === 'linear' ? '' : `, curve: '${curve}'`} })`)
}
// What the grip does, turned from a click on it: a stretch just made there changes to a speed with it, or back, when it
// is the chain's last step and one the grip makes (a factor and a range)
export function setGrip(name) {
  state.gripMode = v.gripMode = name
  store()
  if (name === 'trim') return
  const last = amend(name === 'speed' ? 'stretch' : 'speed')?.call, k = +last?.args[0]?.value, span = last?.args.find(a => a.kind === 'object')
  if (!k || !span) return
  // the length it has kept, to the sample, where its range says how many samples it holds
  const at = span.props?.find(p => p.name === 'at')?.value, d = span.props?.find(p => p.name === 'duration')?.value, n = typeof at === 'number' && typeof d === 'number' && output ? samplesOf(at, d) : 0
  const to = n ? exact(n, Math.round(name === 'speed' ? n * k : n / k), name === 'speed') : number(1 / k, .001)
  ed.change({ from: last.dot + 1, to: last.to, insert: `${name}(${to}, ${ed.code.slice(span.from, span.to)})` })
}
// Pitch edited, or not (View, Pitch curve; a click on the pitch tool). Pitch shows on the spectrogram or the notes:
// editing it, the edited track's lane turns from its waveform to the spectrogram (a sound's, the picture); done, to the
// waveform again, if it turned for this. A mode, not a setting: never stored, so a page opened later shows no pitch line
// nobody asked for there
let pitchFrom = null
export function setPitch(on) {
  state.pitch = v.pitching = on
  if (on && shows(state.track) === 'wave') { pitchFrom = { name: state.track, kind: shows(state.track) }; showAs('spec') }
  else if (!on && pitchFrom) { if (shows(pitchFrom.name) === 'spec') showAs(pitchFrom.kind, pitchFrom.name); pitchFrom = null }
  store()
  marks()
}
// The curve fades take from the corners, turned from a click on one: the fade just made there takes it too, when it is
// the chain's last step and one a corner makes (its time in an options object)
export function setCurve(name) {
  state.fadeCurve = v.fadeCurve = name
  store()
  const last = amend('fade')?.call
  if (last?.args.find(a => a.kind === 'object')?.props.some(p => p.name === 'at')) ed.change(setArg(last, 'curve', name))
}
// A line's points: one curve call, updated in place, the chain's last when it is one; no points removes it. The gain
// line's a gain() in dB; the pitch line's a pitch() in semitones (to the cent), a voice's (`also`: { voice: true }),
// whose curve it edits
function curveEdit(name, step, { t, v }, also = '') {
  const last = amend(name), curve = last && curveOf(last.call)
  const text = `{ t: [${t.map(x => number(x)).join(', ')}], v: [${v.map(x => number(x, step)).join(', ')}] }`
  if (curve && !t.length) return ed.change({ from: last.before, to: last.call.to, insert: '' }), true
  if (curve) return ed.change({ from: last.call.args[0].from, to: last.call.args[0].to, insert: text }), true
  return !!(t.length && write(`${name}(${text}${also})`))
}
export const envelope = points => curveEdit('gain', .1, points), pitchline = points => curveEdit('pitch', .01, points, ', { voice: true }')
// hoisted: the page draws the gain line of the script it opens with before this line runs
function curveOf(call) { const o = call?.args[0]; const t = o?.props?.find(p => p.name === 't')?.value, v = o?.props?.find(p => p.name === 'v')?.value; return Array.isArray(t) && Array.isArray(v) && t.length === v.length ? { t, v } : null }
// The gain line: the curve of the gain() step chosen in the edits, while it is, to edit; else none, the level's curve
// out of sight while nothing works on it (hoisted: the page draws the line of the script it opens with before it runs)
export function envelopeShown() {
  const id = rk?.shown().id, k = typeof id === 'number' ? chain(ed.code)?.calls.find(c => c.list?.from === id) : null
  return k?.name === 'gain' ? curveOf(k) : null
}
// The pitch line's: a pitch() curve that is the chain's last edit, the one the line sets again in place; one before
// another edit is the output's as it is, and the line starts anew (hoisted, as envelopeShown)
export function shiftOf(code) { return curveOf(lastEdit(code, 'pitch')?.call) }
// A selection's voice, by its tools: its pitch moved some semitones, to the cent, pitch() a voice's over it;
// its intonation, intonation() over it; its formants, formant(). The same again over the same range sets the same
// call: its semitones added to, its factor multiplied. Its edges match to 50 ms (a pitch frame, 46 ms).
function voiced(name, value, { at, duration }, join, step, also = '') {
  const last = amend(name), range = last?.call.args.find(a => a.kind === 'object')?.props
  const [a, d] = ['at', 'duration'].map(n => range?.find(p => p.name === n)?.value)
  const same = Math.abs(a - at) < .05 && Math.abs(a + d - at - duration) < .05
  const first = last?.call.args[0]
  if (same && first?.kind === 'number') return ed.change({ from: first.from, to: first.to, insert: number(join(first.value, value), step) }), true
  return write(`${name}(${number(value, step)}, { at: ${number(at)}, d: ${number(duration)}${also} })`)
}
export function shift(o) { return o.edges ? stepped(o) : voiced('pitch', o.semitones, o, (p, q) => p + q, .01, ', voice: true') }
// A note sung apart moved (`edges`, the quiet either side, view.js apart): its pitch curve stepping there, in the quiet,
// so it moves from its first cycle to its last, no glide in or out (a range's edges glide as a voice moves, fn/pitch.js);
// again, the same steps' height added to
function stepped({ semitones, edges: [p, q] }) {
  const t = [p, p + .001, q - .001, q].map(x => +x.toFixed(3)), last = amend('pitch'), curve = last && curveOf(last.call)
  if (curve && curve.t.length === 4 && curve.t.every((x, i) => Math.abs(x - t[i]) < .002)) {
    const arg = last.call.args[0], v = curve.v[1] + semitones
    return ed.change({ from: arg.from, to: arg.to, insert: `{ t: [${curve.t.join(', ')}], v: [0, ${number(v, .01)}, ${number(v, .01)}, 0] }` }), true
  }
  return write(`pitch({ t: [${t.join(', ')}], v: [0, ${number(semitones, .01)}, ${number(semitones, .01)}, 0] }, { voice: true })`)
}
export function tone(o) { return voiced('intonation', o.factor, o, (p, q) => p * q, .01) }
export function formant(o) { return voiced('formant', o.semitones, o, (p, q) => p + q, .01) }
// A range `db` quieter or louder: a trapezoid added to the one gain curve the gain line draws, ramps of 5 ms (at most
// a quarter of the range) at its edges, so the level changes without a click; again adds again. Both are straight
// lines in dB between their points, flat past their ends (plan.js curveFn), so their sum is one too, at the points of
// both. The picture shows the change at once.
export function level(db, span, draw = true) {
  const list = Array.isArray(span[0]) ? span : [span], T = v.duration, last = amend('gain'), curve = last && curveOf(last.call)
  if (draw) v.expect('gain', list.length > 1 ? list : list[0], db)
  const e = t => curve ? curveAt(curve, t) : 0
  // each range's trapezoid; a range at either end of the output has no ramp there
  const add = t => list.reduce((sum, [a, b]) => {
    const r = Math.min(.005, (b - a) / 4)
    return sum + (t < a || t > b ? 0 : a > 0 && t < a + r ? db * (t - a) / r : b < T && t > b - r ? db * (b - t) / r : db)
  }, 0)
  const points = list.flatMap(([a, b]) => { const r = Math.min(.005, (b - a) / 4); return [a, ...(a > 0 ? [a + r] : []), ...(b < T ? [b - r] : []), b] })
  const times = [...new Set([...(curve?.t || []), ...points].map(t => +number(t)))].sort((x, y) => x - y)
  const done = envelope({ t: times, v: times.map(t => e(t) + add(t)) })
  if (!done && draw) v.expect(null)
  return done
}
// A gain curve's value at t, as the library reads it (plan.js curveFn): straight between points, flat past the ends
function curveAt({ t: ts, v: vs }, t) {
  const n = ts.length
  if (t <= ts[0]) return vs[0]
  if (t >= ts[n - 1]) return vs[n - 1]
  let i = 1
  while (ts[i] < t) i++
  return vs[i - 1] + (vs[i] - vs[i - 1]) * (t - ts[i - 1]) / (ts[i] - ts[i - 1])
}
// A band 6 dB quieter or louder: spectral() over it; again on the same band and range changes the same call.
export function bandLevel(sign, [a, b]) {
  const band = v.band.map(f => Math.round(f)), s = t => number(t, v.unit), last = amend('spectral'), args = last?.call.args
  const same = args && JSON.stringify(args[0]?.value) === JSON.stringify(band) && args[1]?.kind === 'number' && (() => {
    const range = args[2]?.props, at = range?.find(p => p.name === 'at')?.value, d = range?.find(p => p.name === 'duration')?.value
    return Math.abs(at - a) < 1e-3 && Math.abs(at + d - b) < 1e-3
  })()
  if (same) return ed.change({ from: args[1].from, to: args[1].to, insert: number(args[1].value + 6 * sign, .1) })
  write(`spectral([${band.join(', ')}], ${6 * sign}, { at: ${s(a)}, d: ${s(b - a)} })`)
}
