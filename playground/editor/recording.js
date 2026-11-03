import { append, number, between, steps as stepsOf, turnOff, tracks as tracksOf, focus, takes, carried, useTake, dropTake, raise } from '../code.js'
import { builtins, sample, microphone, hold as holdInput, unique } from '../sources.js'
import opIcons from '../icons.js'
import { tape } from '../keep.js'
import { docs, lend, closeMenus } from '../editor.js'
import { root, DESKTOP, keep } from './config.js'
import { state, eng, v, ed, pl, output } from './context.js'
import { write, applied, changed } from './edits.js'
import { lengths, lengthOf, shelf, restoring, saving, taken, place } from './files.js'
import { clock, stamp, quote, note } from './format.js'
import { sway, follower, togglePlay } from './play.js'
import { meter } from './readouts.js'
import { focusOn, laneIndex, fetches, lanesOf, newTrack } from './tracks.js'

// Recording: a take, at the caret, into a new track as the others play, or as another take of one there; the takes'
// places on the picture, their menus

// the places of takes the picture shows (places)
export let placed = []
// Record pressed: with Shift (⇧R), into a new track as the others play
export function toggleRecording(event) { state.recording ? stopRecording() : event?.altKey ? retakeHere() : startRecording(!!event?.shiftKey && state.whole) }
// Another take of the recording at the caret (⌥R, Alt adds): into its place, from where it goes in to where it ends,
// one more take there; with none there, a recording from the caret, the first
export function retakeHere() {
  const run = state.whole && takesHere(true)
  return run && reach(run)[1] > run.at ? startRecording(false, run) : startRecording()
}
// Recording goes into the waveform as it comes, as a dictaphone's. Over the output, from the caret or the selection's
// start, what it covers is replaced, as a tape records on (a punch-in), and extended past the end: one write() step,
// undone as any edit. A selection ends it at its end; with the loop on, each pass starts over there and replaces the
// last, the take the one that was going when it stopped. With nothing open, the take is the sound. Stopped, the caret
// waits where the take ended, as a tape's head does: Record again goes on from there.
// Into a track, the other tracks play as it records (accompany), as a take is laid over a backing track; `fresh`, a new
// track first, empty, under the last (newTrack): ⇧R.
export let take = null
// the microphone a take records from, while it does
export let recorder = null
// The microphone opens as Record is pressed, ahead of its click (the press to the release saves a tenth of a second or
// so); a press no click follows lets it go. Once allowed, it opens as the pointer comes onto Record: the click then
// starts the take on the next block (sources.js keeps it open between takes)
let arming = null, unarm = 0, allowed = false
export function armRecording(event) {
  if (event.button || recorder || state.recording || arming) return
  arming = microphone({ channels: state.recordIn })
  arming.catch(() => {})
  unarm = setTimeout(() => { arming?.then(mic => mic.cancel(), () => {}); arming = null }, 2000)
}
export async function startRecording(fresh = false, run = null) {
  closeMenus()
  if (recorder || state.recording) return
  // the caret in the room under the lanes: a new track's, whatever starts the take (R, the button, the menu)
  if (!run && v.ghost && state.whole) fresh = true
  if (pl.playing) togglePlay()
  // the output the others play from, as it is before a new track (which adds nothing to it) runs again; another take of
  // a place (`run`), into it, as into a selection
  const out = output, into = state.whole, sel = into && run ? span(run) : into && !v.band ? v.selection : null
  if (fresh === true && into && !newTrack()) return
  const t = take = { into, at: into ? (sel ? sel[0] : v.cursor) : 0, until: sel ? sel[1] : null, samples: 0, pass: 0, passes: [], queue: [], frame: 0, started: false, over: into && !!state.track && out }
  const asked = arming ?? microphone({ channels: state.recordIn })
  clearTimeout(unarm)
  arming = null
  // until the microphone answers, Record blinks, armed, as a deck's does; a click on it then lets go
  state.recording = { pending: true, length: 0 }
  try {
    const mic = await asked
    allowed = true
    await restoring
    // stopped before the microphone came (another take may have started since): let go
    if (take !== t) return mic.cancel()
    recorder = mic
    // named as it starts, and written down as it comes (keep.js tape): a page closing on it keeps what it had
    t.name = unique(into ? 'take.wav' : 'recording.wav', taken())
    t.rate = mic.sampleRate
    t.tape = tape({ name: t.name, sampleRate: t.rate, onfail: () => note('This browser can’t store the take as it records: until it stops, closing the page loses it.', 'error') })
    // what it records goes to the tape, and, up to what the page holds, here too: the take whole should the tape fail
    t.held = []
    mic.take((block, at) => {
      t.first ??= at
      t.tape.write(block)
      if (t.held && (t.taken = (t.taken ?? 0) + block[0].length) * block.length <= eng.peaks) t.held.push(block)
      else t.held = null
      t.queue.push(block)
      t.frame ||= requestAnimationFrame(f => flush(t, f))
    })
    state.recording.pending = false
    sway()
    if (t.over) accompany(t)
  } catch (e) {
    if (take !== t) return
    state.recording = null
    recorder = take = null
    sway()
    note(e?.name === 'NotAllowedError' ? 'Microphone access was denied. Allow it in the browser to record.' : 'The microphone is not available.')
  }
}
// Each frame from the first block on: the blocks come since the last onto the picture, the playhead where the take has
// got to, drawn as it runs (follow). The blocks come in bursts, and late as the page is busy: where it has got to is the
// microphone's clock since the first (t0), never short of what came
function flush(t, frame = performance.now()) {
  t.frame = 0
  const blocks = t.queue.splice(0)
  if (take !== t) return
  const begin = () => v.take({ at: t.at, sampleRate: t.rate, channels: blocks[0].length })
  if (!t.started) { t.started = true; t.follow = follower(); begin(); state.hasOutput = true }
  // played over, each pass the samples the microphone heard as the others played it, `lead` on (aligned): it ends that
  // much later, so it runs to the selection's end too
  const room = t.until == null ? Infinity : Math.round((t.until - t.at) * t.rate), { lead } = t.over ? aligned(t, recorder) : { lead: 0 }
  for (const block of blocks) {
    // past the selection's end: with the loop on, the next pass, over it again (the others looping with it), the one
    // done a take (passes), shown as one at once (liveTakes); else the take ends
    if (t.samples - t.pass >= room + lead) {
      if (!state.loop) return stopRecording()
      // each pass `room` on from the one before, as the others loop by their own clock
      t.passes.push(t.pass)
      t.pass += room
      begin()
      liveTakes(t)
    }
    t.samples += block[0].length
    v.grow(block)
  }
  t.t0 ??= recorder.time - t.samples / t.rate
  if (t.heard && pl.playing && t.heard.length < 32) t.heard.push(pl.time - recorder.time)
  // played over, the take drawn lined up as its output will be, from where the others' clock is heard: no shift as it
  // stops and its output comes
  if (t.over) { const a = aligned(t, recorder); v.align(a.at, a.lead) }
  const got = Math.max(t.samples, Math.round((recorder.time - t.t0) * t.rate)), at = t.follow(t.at + Math.min(room, got - t.pass) / t.rate, frame, 1)
  v.speed = t.follow.speed
  v.playhead = at
  state.time = stamp(at)
  state.recording.length = (t.samples - t.pass) / t.rate
  meter()
  t.frame = requestAnimationFrame(f => flush(t, f))
}
export async function stopRecording() {
  const rec = recorder, t = take
  if (!rec) { state.recording = null; take = null; return }
  recorder = take = null
  cancelAnimationFrame(t.frame)
  rec.stop()
  if (t.over) { pl.pause(); lend(output) }
  // the blocks not drawn yet are the take's too, drawn now: the take as it stops is the take its output will show
  for (const block of t.queue.splice(0)) { t.samples += block[0].length; v.grow(block) }
  state.recording = null
  v.playhead = null
  sway()
  // the passes over the selection, the loop on, each a take (passes), the last too where it ran to the selection's end
  // or is all there is; played over, from the sample heard as the others were at its start (aligned)
  const rate = rec.sampleRate, { lead, at: from } = aligned(t, rec), room = t.until == null ? Infinity : Math.round((t.until - t.at) * rate)
  const length = Math.min(t.samples - t.pass - lead, room), cut = t.passes.length > 0 && length < room
  const parts = [...t.passes.map(p => [p + lead, room]), ...cut ? [] : [[t.pass + lead, length]]]
  if (!(parts[0][1] > 0)) { t.tape.drop(); if (t.into) v.take(null); return note('Nothing was recorded.') }
  // the caret at once where the take ends: what follows waits on the tape and the engine, frames in which it would
  // show where the take began
  if (t.into) v.setCursor(from + parts.at(-1)[1] / rate)
  const names = []
  for (const _ of parts) names.push(names.length ? unique('take.wav', new Set([...taken(), ...names])) : t.name)
  // each as it was written down as it came (keep.js tape), a file read from disk as the engine decodes it: none of it
  // held here; where the tape failed, what is held here, if that is all of it
  const wavs = []
  for (const [pass, n] of parts) wavs.push(await t.tape.wav(pass, n))
  const held = wavs.some(w => !w) && t.held && t.held[0].map((_, c) => { const x = new Float32Array(t.samples); let at = 0; for (const b of t.held) { x.set(b[c] ?? b[0], at); at += b[0].length } return x })
  const data = wavs.map((w, i) => w ?? (held && { channels: held.map(x => x.subarray(parts[i][0], parts[i][0] + parts[i][1])), sampleRate: rate }))
  if (!data.every(Boolean)) { t.tape.drop(); if (t.into) v.take(null); return note(`${names[0]} could not be kept in this browser: it was longer than the page holds.`, 'error') }
  // the tape's parts go once every take is kept
  const kept = names.map((name, i) => keep(name, data[i]))
  saving(Promise.all(kept.map((k, i) => k.then(file => {
    if (!file) return note(`${names[i]} could not be kept in this browser: export it to keep it.`, 'error')
    shelf.set(names[i], file)
    return true
  }))).then(all => all.every(Boolean) && t.tape.drop()))
  // the engine reads the file kept, else what there is
  for (const [i, name] of names.entries()) { lengths.set(name, parts[i][1] / rate); await eng.file(name, await kept[i] ?? data[i]) }
  const end = from + parts.at(-1)[1] / rate
  // the sound itself, the caret at its end once it shows (aim)
  if (!t.into) { note(`Recorded ${clock(end - from)}`); place(names, 'new'); docs.find(d => d.id === state.tab).view = { selection: null, band: null, more: [], cursor: end, anchor: end }; return }
  // to the microphone's sample, so a take recorded on from where this one ended meets it, no gap nor overlap between;
  // where takes went in before, one more of them (code.js retake), the newest heard
  if (!write(...names.map(name => `write(audio(${quote(name)}), { at: ${number(from, 1e-6)} })`))) return v.take(null)
  v.setCursor(end)
  const here = takes(ed.code).findLast(r => Math.abs(r.at - from) < 1e-6)?.list.length ?? 1
  note(`Recorded ${names.length > 1 ? `${names.length} takes of ` : ''}${clock(end - from)}${here > names.length ? `, ${here} takes here` : ''}${here > 1 ? ', the last heard: their numbers under the lanes switch them' : ': ⌥R records another take of it'}${cut ? '. The last pass, cut short, is left out' : ''}`)
}
// The others, as their speakers have them, the track it goes into muted (worker.js voice), from where it starts to the
// selection's end; once they play, where they are as the microphone's clock goes is read each frame (flush), both clocks
// at once
async function accompany(t) {
  const out = output ?? t.over, muted = [...state.muted, state.track]
  pl.out = null
  pl.set(out.channels, out.sampleRate, o => eng.voice({ ...o, output: out.id, muted }), out.length, fetches(out), lanesOf(out))
  await pl.play({ from: t.at, to: t.until, loop: state.loop && t.until != null })
  if (take === t && pl.playing) t.heard = []
}
// Where a take played over goes: the sample the microphone heard as the others were at its start, its `lead` samples
// before it let go, written there (at); one begun after it, where it was begun. What the speakers play now less the
// microphone's clock now (the median of the frames'), on the time of its first block, less its latency, is where that
// block was played over. Not played over, all of it, where it was begun
function aligned(t, rec) {
  if (!t.heard?.length) return { lead: 0, at: t.at }
  const d = [...t.heard].sort((p, q) => p - q)[t.heard.length >> 1], first = t.first - rec.latency + d
  const lead = Math.round((t.at - first) * rec.sampleRate)
  return lead >= 0 ? { lead, at: t.at } : { lead: 0, at: first }
}
// Where takes went in (code.js takes): from where a place's go in to where the longest of them ends, its files' lengths
// asked of the engine once (`lengths`, s; a file of none yet, nothing). On the picture, those of two takes or more,
// where the steps after them take the place (`shown`, code.js carried: a marker, a level, a delete past it leave it
// where it is, a delete before it moves it back), none where the script alone can't say (a trim, a stretch: `placed`,
// as the picture has them)
export const reach = run => [run.at, run.at + Math.max(0, ...run.list.map(x => Math.max(x.d ?? 0, x.empty ?? lengths.get(x.name) ?? 0)))]
// a place in the sound as it plays, where that is known, else at its takes' own step
export const span = run => run.shown ?? reach(run)
// Every track's, each its `track` (none without tracks) and its lane; those of the track edited returned
export function places() {
  const code = ed.code, names = tracksOf(code).map(t => t.name), all = [], shown = []
  try {
    for (const track of names.length ? names : [null]) {
      focus(track)
      const at = output?.tracks?.findIndex(t => t.name === track) ?? -1, lane = track == null ? null : at >= 0 ? at : names.indexOf(track)
      for (const r of takes(code)) {
        const run = { ...r, track, lane, shown: carried(code, r, reach(r)) }
        all.push(run)
        // two or more, or one empty (forked: forkRange) for a recording to go into
        if ((r.list.length > 1 || r.list.some(x => x.empty != null)) && run.shown) shown.push(run)
      }
    }
  } finally { focus(state.track) }
  const ask = [...new Set(all.flatMap(r => r.list.map(x => x.name)))].filter(n => n && !lengths.has(n))
  // asked once the files kept are read (restoring: on a visit's first run, not yet), each sent to the engine as a run
  // sends it; one it can't open asked again next time, its length nothing meanwhile (its place as long as the others')
  if (ask.length) {
    for (const n of ask) lengths.set(n, null)
    restoring.then(() => {
      for (const n of ask) if (!eng.has(n) && (shelf.has(n) || builtins[n])) eng.file(n, shelf.get(n) ?? sample(n))
      return eng.lengths(ask)
    }).then(got => { ask.forEach((n, i) => got[i] == null ? lengths.delete(n) : lengths.set(n, got[i])); if (got.some(x => x != null)) places() })
  }
  placed = shown
  v.takes = placed.map(section)
  return all.filter(r => r.track === (names.length ? state.track : null))
}
// a place of takes as the picture has it (view.js takes)
const section = r => ({ at: r.shown[0], end: r.shown[1], on: r.list.findIndex(x => x.on), names: r.list.map(x => x.name), lane: r.lane, open: r.list.some(x => x.empty != null) })
// Recording pass after pass over a selection (the loop on), its passes are takes of that place as they are done: with
// the takes there before, those done, the one recording lit, + off till it stops; the script takes them up then (places)
function liveTakes(t) {
  const lane = output?.tracks ? laneIndex() ?? null : null, run = placed.find(r => Math.abs(r.shown[0] - t.at) < 1e-6 && r.lane === lane)
  const names = [...(run?.list ?? []).filter(x => x.empty == null).map(x => x.name), ...t.passes.map((_, k) => `pass ${k + 1}`), 'recording']
  v.takes = [...placed.filter(r => r !== run).map(section), { at: t.at, end: Math.max(t.until, run ? run.shown[1] : 0), on: names.length - 1, names, lane, open: true }]
}
// The place the selection starts in, or the playhead or the caret is in (to where its takes end, the end too), of two
// takes or more, or `alone` of one too, in the track edited: the last there; else, of two or more, the last before it,
// else the first; null where none is
export function takesHere(alone = false) {
  const all = places(), t = state.playing ? pl.time : v.selection?.[0] ?? v.cursor, within = all.filter(r => span(r)[0] <= t + 1e-6 && span(r)[1] >= t - 1e-6)
  const many = all.filter(r => r.list.length > 1)
  return within.findLast(r => alone || r.list.length > 1) ?? (alone ? null : many.findLast(r => span(r)[0] <= t + 1e-6) ?? many[0] ?? null)
}
// A take there heard, the others turned off, as a take folder's are switched (Logic's): playing, it takes over where it
// plays; the one heard, turned off, the sound heard there as it was without them. One step, which Undo takes back
export function useTakeOf(run, k) {
  const heard = run.list[k].on, change = heard ? turnOff(ed.code, stepsOf(ed.code)[run.list[k].i].call) : onTop(run, useTake(ed.code, run.list[k].from))
  if (change) ed.change(change)
  note(heard ? 'No take heard here: the sound as it was' : `Take ${k + 1} of ${run.list.length}, ${run.list[k].name || 'empty'}`)
}
// A named range forked (its fork, view.js placeFork): takes start there, an empty take over it, turned off, the sound
// heard there as it was; Record records into it (retake), heard from then on, its place selected for that. One step,
// which Undo takes back
export function forkRange({ time, duration, track }) {
  if (state.recording) return
  if (track != null && track !== state.track) focusOn(track)
  const code = ed.code, call = `write(audio.from(${number(duration, v.unit)}), { at: ${number(time, v.unit)} })`, put = append(code, call)
  if (!put) return note('Open or generate a sound first.')
  const out = applied(code, put), step = stepsOf(out).findLast(x => out.slice(x.call.dot + 1, x.call.to) === call), off = step && turnOff(out, step.call)
  if (!off) return
  ed.change(between(code, changed(out, off)))
  v.select(time, Math.min(time + duration, v.duration))
  note('Takes here, the sound heard as it was: R records the first')
}
// The take heard there taken away, the one before it heard in its place; one step, which Undo takes back
function deleteTake(run) {
  const k = Math.max(0, run.list.findLastIndex(x => x.on)), change = dropTake(ed.code, run.list[k].from)
  if (!change) return
  ed.change(run.list.length > 1 ? onTop(run, change) : change)
  note(run.list.length > 1 ? `Take ${k + 1} deleted, ${run.list.length - 1} left here` : 'The take deleted')
}
// The takes there as a menu lists them, the one heard checked; the one heard, deleted; the context menu's, both
// A change to the takes of a place (`run`), they then brought over what is laid on their place after them (code.js
// raise), so the take heard there is heard, as a recording there is: one change of the script as it is, null for none
function onTop(run, change) {
  const code = ed.code, i = takes(code).findIndex(r => r.list[0].from === run.list[0].from), out = changed(code, change)
  const up = i >= 0 && takes(out)[i] && raise(out, takes(out)[i], lengthOf) || out
  return up === code ? null : between(code, up)
}
export const takeList = run => run.list.map((x, k) => ({ label: `Take ${k + 1}`, hint: x.name || 'empty', checked: x.on, run: () => useTakeOf(run, k) }))
export const deletion = run => ({ label: 'Delete take', hint: `Take ${Math.max(0, run.list.findLastIndex(x => x.on)) + 1}`, run: () => deleteTake(run), icon: opIcons.remove })
export const takesMenu = run => [{ label: 'Takes', hint: `${run.list.length} here`, items: takeList(run) }, deletion(run)]

export function wire() {
  navigator.permissions?.query({ name: 'microphone' }).then(p => { allowed ||= p.state === 'granted' }, () => {})
  // in the Mac app, as a DAW: the input open from the start, its permission asked as the app opens, a take on the next block
  if (DESKTOP) holdInput(state.recordIn)
  root.querySelector('button.record')?.addEventListener('pointerenter', () => {
    if (!allowed || recorder || state.recording || arming) return
    microphone({ channels: state.recordIn }).then(mic => mic.cancel(), () => {})
  })
}
