import { labelOf } from '../ops.js'
import { prepare, error, bare, source, chain, rollback, residual } from '../code.js'
import { builtins, sample } from '../sources.js'
import { docs, docOf, soundName, badges } from '../editor.js'
import { pastable } from './clipboard.js'
import { state, eng, v, ed, pl, output, incoming, timer, hush, steps, viewing, assign } from './context.js'
import { shelf, restoring } from './files.js'
import { clock, several, note } from './format.js'
import { sway, togglePlay } from './play.js'
import { marks, meter, describe } from './readouts.js'
import { places } from './recording.js'
import { lanesShown, showTracks, lane, hears, fetches, lanesOf } from './tracks.js'

// Running the script: a change scheduled, evaluated and sent to the engine; its reply shown, its output arriving and
// settled, what is waited on (ran, settled), what the status bar says it does, the check against a spec

// how many samples a piece of an arriving sound covers: its samples, or its leaves (256 each, the last as many as it has)
const extent = m => m.channels ? m.channels[0].length : m.peaks[0].length ? (m.peaks[0].length / 4 - 1) * 256 + m.peaks[0][m.peaks[0].length - 1] : 0
// a piece onto the view: its samples, or its leaves
const piece = m => m.peaks ? v.peaks(m.at, m.peaks, m.spectra) : v.append(m.channels)
// A sound arriving, with nothing whole to play, heard as it comes, as far as it has: its pieces pushed to the deck as
// they come. The file as it decodes (`what` 'file'), while the output has nothing; then the output (`output`), from its
// first piece, its pieces till then pushed at once, taking over where it plays. One that comes as its peaks waits to be
// whole
let arrivals = 0
function hear(a, m, what) {
  if (state.whole || !m.channels) return
  if (a.hearing === what) { eng.push(a.heard, m.channels); return pl.grow(m.channels[0].length) }
  const parts = what === 'output' ? a.parts : [m]
  a.hearing = what
  a.heard = `arriving ${++arrivals}`
  eng.arrive(a.heard, m.sampleRate, m.channels.length)
  for (const p of parts) eng.push(a.heard, p.channels)
  pl.out = null
  pl.arrive(m.sampleRate, o => eng.voice({ ...o, held: { key: a.heard } }), parts.reduce((n, p) => n + p.channels[0].length, 0))
  state.arriving = true
}
// the view holds the tab's sound as it was left (its lanes, its length, where it was looked at) until the sound comes
let holding = false
let checks = 0
// each tab's runs asked and not yet answered; the shown one's
// the runs asked and not yet answered, by tab; of them, those a mute asked (`hushed`), made unseen (perform)
// (`hush`: the next run is one); working, while any other is, or what one made still comes
export const asking = new Map(), hushed = new Map(), waiting = () => asking.get(state.tab) ?? 0
export const working = () => waiting() > (hushed.get(state.tab) ?? 0) || !!incoming && !incoming.quiet
// Runs the script a moment after the last change; a slider runs it at once. Newer runs replace waiting ones.
export function schedule(delay) { clearTimeout(timer); assign({ timer: setTimeout(() => { assign({ timer: 0 }); evaluate() }, delay) }) }
export async function evaluate() {
  const code = ed.code, quiet = hush
  assign({ hush: false })
  places()
  const syntax = error(code)
  if (syntax) {
    ed.errors([{ ...syntax, message: 'Syntax error' }])
    return show({ logs: [], error: { message: `Syntax error on line ${code.slice(0, syntax.from).split('\n').length}` } }, true)
  }
  // the whole chain, what one step of it takes out, or the chain rolled back, as the stack says
  const calls = chain(code)?.calls || [], { delta, back } = viewing, step = calls[delta]
  const runs = step ? residual(code, delta) : back != null ? rollback(code, back) : code
  const later = back != null ? calls.length - back : 0
  state.viewing = step ? `What ${labelOf(step.name)} takes out` : later > 0 ? `${back ? `Up to ${labelOf(calls[back - 1].name)}` : 'The source alone'}: ${later} later step${later > 1 ? 's' : ''} bypassed` : ''
  // a change to its comments alone (a bypassed step set, a note) runs nothing: the run asked last, and the output it
  // made, are this script's too; the same script asked again (a file it waited for come) runs
  if (sent?.tab === eng.tab && sent.code !== runs && bare(sent.code) === bare(runs)) {
    for (const o of [sent, output]) if (o?.code != null && bare(o.code) === bare(runs)) Object.assign(o, { code: runs, editor: code })
    if (!waiting() && !incoming && outcome) finished(outcome)
    return
  }
  return perform(runs, code, quiet)
}
// Runs `runs`, the editor holding `code`, its reply and output shown as they come; the last asked (sent)
let sent = null
// A run a mute asks (`quiet`) is made unseen: the mix again without the tracks muted, for the levels and the export, its
// lanes as they were; nothing says it works, nor does the picture take it up as it comes (heard already: toggleMute)
async function perform(runs, code, quiet = false) {
  // a script with nothing in it runs nothing, nothing else on its way: no sound, at once, the engine not waited for, so
  // an empty tab shows its empty track as the page comes up (and the run asked last is no longer this script's)
  if (!waiting() && !incoming && !bare(runs).trim()) { sent = null; show({ logs: [] }); return status() }
  const script = prepare(runs)
  await restoring
  // Built-in samples are made when a script first names one; the worker takes messages in order, so the file
  // arrives before the run that opens it, and runs stay in the order they were asked for.
  // A file kept opens as it was kept, before a sample of its name (one kept before names stayed clear of theirs)
  for (const name of script.names) if (!eng.has(name) && (shelf.has(name) || builtins[name])) eng.file(name, shelf.get(name) ?? sample(name))
  // the output keeps the code that made it (what ran, and what the editor had), and the tab it is for
  const tab = eng.tab, coming = sent = Object.assign(arrival(script.names), { code: runs, editor: code, tab, quiet })
  asking.set(tab, (asking.get(tab) ?? 0) + 1)
  if (quiet) hushed.set(tab, (hushed.get(tab) ?? 0) + 1)
  asked = script.names
  status()
  // the file shown as it is while the output is made, where the picture has nothing of it (worker.js render)
  const result = await eng.run({ ...script, muted: [...state.muted], preview: !state.hasOutput || fresh(script.names) }, coming)
  const left = asking.get(tab) - 1
  left > 0 ? asking.set(tab, left) : asking.delete(tab)
  if (quiet) { const n = hushed.get(tab) - 1; n > 0 ? hushed.set(tab, n) : hushed.delete(tab) }
  // another tab shown meanwhile: the reply is the one left's, its output made on for it there (arrival)
  if (!result.skipped && eng.tab === tab) show(result, false, script.names, coming)
  else if (!result.skipped && result.output && docOf(tab)) {
    Object.assign(coming, { id: result.id, said: { lines: saying(result), saves: result.saves || [], names: script.names } })
    docOf(tab).coming = coming
  }
  status()
}
// Stopped: what renders stops, and the edit that set it off is undone, as an editor's Cancel leaves an effect unapplied:
// the script goes back to the one the picture shows, which runs at once from what the worker kept (Redo applies the edit
// again). A worker held past stopping is replaced, and what it kept goes with it: the output shown is made again in the
// new one, and a tab shown again runs its script again
export async function stop() {
  const replaced = await eng.stop(), [back] = ed.depth
  if (output?.editor != null && back && steps[back - 1]?.code === output.editor) { const { label } = steps[back]; ed.undo(); note(`Stopped: ${label} undone, Redo applies it again`) }
  else if (replaced && output?.code) perform(output.code, output.editor)
}
// A run's reply: what the script printed in the console under it; what went wrong, in the status bar after the time
// and at its line in the script. The last output that ran stays. A sound it made
// then arrives (arrival).
function show(result, syntax = false, names = [], coming = null) {
  // the first result, whatever it is, says whether there is a sound: until then the view waits, not invites
  state.ran = true
  const lines = saying(result), e = result.error
  state.lines = lines
  const problem = e ? e.message + (e.line ? ` (line ${e.line})` : '') : ''
  state.problem = problem
  state.missing = e?.missing || ''
  if (syntax) return
  const line = e?.line && lineOf(ed.code, e.line)
  ed.errors(line ? [{ ...line, message: e.message }] : [])
  state.canPaste = pastable()
  // an edit drawn ahead of its output that failed: the picture goes back to the output there is
  if (e) { v.expect(null); if (!state.hasOutput) entitle(names, false); return finished({ ok: false, problem }) }
  // exports follow the output the page shows: the last run that succeeded
  state.saves = result.saves || []
  entitle(names, !!result.output || state.hasOutput)
  // what it said goes with its output, for its tab shown again (switchTab)
  if (result.output) { coming.id = result.id; coming.said = { lines, saves: state.saves, names }; assign({ incoming: docOf(coming.tab).coming = coming }); state.loading = !state.hasOutput; return }
  assign({ incoming: null })
  state.loading = false
  settle(null)
  finished({ ok: true, duration: 0 })
}
// What a run said: what it printed, then its value
const saying = result => [...result.logs || [], ...result.value != null ? [{ level: 'value', text: result.value }] : []]
// The script's line n, from 1: { from, to }, or null past its last
function lineOf(code, n) {
  const lines = code.split('\n')
  if (!(n >= 1 && n <= lines.length)) return null
  const from = lines.slice(0, n - 1).reduce((at, l) => at + l.length + 1, 0)
  return { from, to: from + lines[n - 1].length }
}
// What the run that made an output said, as it said it, its tab shown again: what it printed, its exports, no problem
export function retell({ lines, saves, names }) {
  Object.assign(state, { lines, saves, problem: '', missing: '' })
  ed.errors([])
  state.canPaste = pastable()
  entitle(names, true)
}
// A run's end, for whoever waits on it (an agent's edit): the output's length, or what went wrong; the last (outcome)
let waiters = [], outcome = null
export const ran = () => new Promise(resolve => waiters.push(resolve))
const finished = result => { outcome = result; for (const resolve of waiters.splice(0)) resolve(result) }
export const within = (promise, ms = 60000) => Promise.race([promise, new Promise(resolve => setTimeout(() => resolve({ ok: false, problem: 'Still running' }), ms))])
// How long a sound already shown holds whole before what is on its way shows in its place as it comes, ms
const WAIT = 250
// A run's output as it arrives. The view keeps what it shows until the new sound is whole, or for a moment: one that
// takes longer than that shows as it comes. A view with nothing, and a file new to it, shows it at once: the file
// itself as it decodes, dim, while the output has nothing yet (it waits for the whole file, as trim and normalize do).
// Its tab left as it comes (`away`: the tab's newest still), it comes on all the same, the tab's own once whole, shown
// at once when the tab is (switchTab), or as far as it has come (takeUp)
function arrival(names) {
  const a = { id: 0, names, parts: [], early: [], sampleRate: 0, channels: 0, total: null, started: performance.now(), last: performance.now(), on: false, preview: false, loaded: null }
  const current = () => incoming === a, away = () => !current() && docOf(a.tab)?.coming === a
  // nor while the picture holds a take recorded, or an edit drawn ahead, till the output that has it comes; nor over
  // another output of these files, shown till this one comes
  const held = () => !a.preview && (v.expecting || state.hasOutput && !fresh(names))
  // the file, dim, from what has come of it on
  const preview = () => {
    if (!current() || a.on || held() || !a.early?.length) return
    if (!a.preview) {
      const m = a.early.at(-1)
      a.preview = true
      assign({ showing: 0 })
      v.stream({ sampleRate: m.sampleRate, channels: (m.channels ?? m.peaks).length, total: m.estimate ? Math.round(m.estimate * m.sampleRate) : null, dim: true, keep: holding })
      aim(false, true)
      lend(null)
      state.whole = false
      state.hasOutput = true
      state.loading = true
    }
    for (const m of a.early.splice(0)) { piece(m); hear(a, m, 'file') }
    status()
  }
  a.loading = m => {
    if (!current() || a.on) return
    a.last = performance.now()
    a.loaded = { at: (m.at + extent(m)) / m.sampleRate, estimate: m.estimate }
    // taken up again as it decoded (takeUp): the file not drawn from part of the way in
    if (held() || !a.early) return status()
    a.early.push(m)
    // while the picture holds the sound as the page was left (`holding`) and the output is still about to come, kept: the
    // page opens the file it was left on, and shows it only once the output takes long enough to be worth saying, from
    // what has come of it by then (all of it, a file that decodes quickly, its steps then still to run)
    const wait = holding && !a.preview ? WAIT - (performance.now() - a.started) : 0
    if (wait > 0) { a.timer ??= setTimeout(preview, wait); return status() }
    preview()
  }
  // all of the file come, the output still nothing: decoded, it renders now
  a.arrived = () => {
    if (!current() || !a.loaded) return
    a.loaded = { ...a.loaded, whole: true }
    status()
  }
  // a script's tracks, before their mix: each its own picture (worker.js mixTracks), the mix then coming as any output
  a.tracks = m => { if (current() || away()) a.lanes = m.tracks }
  // what the engine does for it: the steps it applies, and one reading its input whole first (a model's run over it)
  // while it does
  a.doing = m => {
    if (!current() && !away()) return
    if (m.steps) a.steps = m.steps
    if ('step' in m) a.step = m.step
    status()
  }
  a.chunk = m => {
    if (!current() && !away()) return
    a.last = performance.now()
    a.sampleRate = m.sampleRate
    a.channels = (m.channels ?? m.peaks).length
    if (m.total) a.total = m.total
    // its file still arriving, how much has come
    a.loaded = m.loaded != null ? { at: m.loaded, estimate: m.estimate } : null
    a.parts.push(m)
    if (!current()) return
    hear(a, m, 'output')
    if (a.on) piece(m)
    // tracks' mix: the picture is theirs, drawn once it is whole (done)
    else if (a.lanes) {}
    // an edit the view drew ahead waits whole: the picture it drew holds till then, nothing moving; an output as long as
    // the one shown (an edit over a range, a band taken out) comes in over it as it renders, only where it differs
    else if (alike(a) && m.channels) { if (!v.expecting) v.patch(m.at, m.channels) }
    // the sound the page was left on stays whole until the output is whole too, which takes its place in one step
    // (done); drawn as it renders, it would first go back to nothing and fill again from the start. Only a picture with
    // nothing in it, or an output that takes longer than a moment, shows as it comes; and the file itself, dim, gives
    // way to the output at its first piece, as the engine stops sending the file then (worker.js arriving)
    else if (a.preview || !state.hasOutput && !holding || !v.expecting && performance.now() - a.started > WAIT) begin(a)
    status()
  }
  a.done = m => {
    // its tab left: the tab's own, to show when it is
    if (away()) { Object.assign(docOf(a.tab), { output: assemble(m), coming: null, ready: true }); return badges() }
    if (!current()) return
    assign({ incoming: null })
    unclaim()
    // an older script's output, while the picture holds an edit drawn ahead of a newer one: not the output it waits for,
    // which is on its way (the script changed since this one ran); taken for it, it would end the wait, and the newer
    // output, arriving unlooked-for, would show all of it again, the view moved under the pointer
    if (v.expecting && !a.on && a.editor !== ed.code) { a.parts = []; return status() }
    const out = assemble(m)
    if (a.on) v.finish()
    settle(out, !a.on, a.editor !== ed.code)
    finished({ ok: true, duration: m.duration, loudness: m.stats?.loudness, peak: m.stats?.peak })
    status()
  }
  // the output whole, from its pieces: its samples, or a long one's leaves (the page draws it from them)
  const assemble = m => {
    const length = Math.round(m.duration * m.sampleRate), leaves = Math.ceil(length / 256) * 4
    const channels = m.long ? null : Array.from({ length: m.channels }, (_, c) => {
      const x = new Float32Array(length)
      for (const p of a.parts) x.set(p.channels[c].subarray(0, Math.max(0, length - p.at)), p.at)
      return x
    })
    const peaks = m.long ? Array.from({ length: m.channels }, (_, c) => {
      const x = new Float32Array(leaves)
      for (const p of a.parts) if (p.peaks) x.set(p.peaks[c].subarray(0, Math.max(0, leaves - p.at / 64)), p.at / 64)
      return x
    }) : null
    // and its spectra, each column's bins after the last's
    const first = a.parts.find(p => p.spectra)?.spectra, bins = first && first.size / 2 + 1, cols = first && Math.ceil(length / first.hop)
    const spectra = m.long && first ? { size: first.size, hop: first.hop, levels: Array.from({ length: m.channels }, (_, c) => {
      const x = new Uint8Array(cols * bins)
      for (const p of a.parts) if (p.spectra) x.set(p.spectra.levels[c].subarray(0, Math.max(0, (cols - p.spectra.at) * bins)), p.spectra.at * bins)
      return x
    }) } : null
    // each track's picture as long as the mix, past its end silent: its samples, or a long one's leaves and spectra
    const tracks = a.lanes?.map(({ name, length: n, channels, silences }) => ({ name, length: n, channels, silences }))
    const lanes = !m.long && a.lanes?.map(t => { const x = new Float32Array(length); x.set(t.mono.subarray(0, length)); return x }) || null
    const pictures = m.long && a.lanes ? { leaves: a.lanes.map(t => t.leaves), spectra: { size: a.lanes[0].spectra.size, hop: a.lanes[0].spectra.hop, levels: a.lanes.map(t => t.spectra.levels) } } : null
    a.parts = []
    return { id: a.id, names, channels, peaks, spectra, long: !!m.long, length, sampleRate: m.sampleRate, duration: m.duration, stats: m.stats, segments: m.segments, markers: m.markers, clips: m.clips, bitDepth: m.bitDepth, code: a.code, editor: a.editor, said: a.said, tracks, lanes, pictures }
  }
  // no longer on its way, the tab's run, or gone: its tab left, it failed, or a newer run of the tab took its place, or
  // the worker was replaced; the tab runs its script again when it is shown
  const unclaim = () => { const d = docOf(a.tab); if (d?.coming === a) d.coming = null }
  const gone = () => { if (away()) { unclaim(); badges() } }
  a.skip = gone
  a.error = m => {
    if (!current()) return gone()
    assign({ incoming: null })
    unclaim()
    state.problem = m.error.message
    finished({ ok: false, problem: m.error.message })
    v.expect(null)
    // what showed of it goes: the last whole output comes back, or nothing
    if (a.on || a.preview) settle(output?.duration ? output : null)
    state.loading = false
    status()
  }
  return a
}
// A file the shown output doesn't open
const fresh = names => names.join() !== (output?.names || []).join()
// An output arriving as long as the one shown, at its rate, with its channels, of the same files
export const alike = a => !!output?.channels && !output.tracks && a.total != null && a.total === output.length && a.sampleRate === output.sampleRate && a.channels === output.channels.length && !fresh(a.names)
// The view shows an output as it arrives; the player has what has come
export function begin(a) {
  a.on = true
  a.preview = false
  assign({ showing: a.id })
  v.stream({ sampleRate: a.sampleRate, channels: a.channels, total: a.total })
  aim(false, true)
  for (const p of a.parts) piece(p)
  state.hasOutput = true
  state.loading = false
}
// A tab's sound held as it was left, before the engine has it (a reload; a tab not shown since): its lanes, its length,
// where it was looked at, dim and empty; the sound comes into it as it arrives
export function standIn(doc) {
  const f = doc?.frame
  if (!(f?.duration > 0 && f.rate > 0 && Number.isInteger(f.channels) && f.channels > 0 && f.channels <= 32)) return
  v.stream({ sampleRate: f.rate, channels: f.channels, total: Math.round(f.duration * f.rate), dim: true })
  holding = true
  aim(true)
}
// A whole output (or none) becomes the page's: drawn (unless it was drawn as it came), played, measured
// The tab's sound where it was looked at when it was left, and what was selected on it, before a switch or a reload:
// where it was looked at once, as soon as the sound starts arriving, so the view is where it was while the rest comes in;
// what was selected, and the caret, once all of it has come (`coming` till then, the caret waiting at its start, never
// past what has come), unless the caret was put elsewhere meanwhile
const START = { selection: null, band: null, more: [], cursor: 0, anchor: 0 }, deferred = new WeakSet()
function aim(held = false, coming = false) {
  const doc = docs.find(d => d.id === state.tab), view = doc?.view
  if (doc?.frame) { v.frame = doc.frame; doc.frame = null }
  // what was selected, once there is a sound to select on (not the lanes held for it)
  if (!view || held) return
  if (!(Number.isFinite(view.cursor) && Array.isArray(view.more))) { doc.view = null; return }
  if (coming) { if (!deferred.has(view)) { deferred.add(view); v.state = START } return }
  const now = v.state
  if (!deferred.has(view) || !now.selection && !now.more.length && now.cursor === 0) v.state = view
  doc.view = null
}
export function settle(out, draw = true, behind = false) {
  assign({ output: out })
  holding = false
  // the tab's own, to show at once when it is shown again
  const doc = docs.find(d => d.id === state.tab)
  if (doc) doc.output = out
  const has = !!out?.duration
  assign({ showing: has ? out.id : 0 })
  state.hasOutput = has
  state.whole = has
  state.arriving = false
  state.loading = false
  // tracks, a lane each, the one edited by its name
  showTracks(has ? lanesShown(out) : null)
  if (out?.tracks) v.focus = Math.max(0, out.tracks.findIndex(t => t.name === state.track))
  if (out?.long) v.summary(out.pictures?.leaves ?? out.peaks, out.length, out.sampleRate, out.pictures?.spectra ?? out.spectra)
  else if (draw) v.set(has ? out.lanes ?? out.channels : [], out?.sampleRate)
  else if (has) v.samples = out.channels
  if (has) aim()
  v.segments = lane(out)?.silences ? { silences: lane(out).silences } : out?.segments
  v.clips = out?.clips
  // the markers as the script has them: an older script's output, the newer one on its way, leaves those the view
  // drew ahead of it (made, named, moved) as they are
  if (!behind) v.markers = out?.markers
  // a tab shown again whose player plays its output already plays on as it is
  if (pl.out !== out || !has) lend(out)
  if (!has && pl.playing) togglePlay()
  state.duration = has ? out.duration : 0
  state.ab = false
  state.canCompare = has && !out.tracks && !!sourceName()
  describe()
  marks()
  meter()
  scheduleCheck()
}
// What the shown tab's player plays: output `out` (none: nothing), the output it holds (`out`) known by it
export function lend(out) {
  const has = !!out?.duration
  pl.out = has ? out : null
  pl.set(has ? out.channels : null, out?.sampleRate, has ? hears(out) : null, has ? out.length : 0, fetches(out), has ? lanesOf(out) : null)
}
// What the engine is doing, said after the time once it takes a moment: a file the view has not shown decoding, and
// how much of it has come; an output rendering, and how much of it. One word from the first run to the last output, so
// runs that follow one another (a file dropped opens in a tab, then runs) read as one. Play gives way to a ring of the
// same, its square the way out (`working`): at once while there is nothing to play, after two seconds over a sound there is.
let ticking = 0, asked = [], began = 0
export function status() {
  const now = performance.now(), a = incoming?.quiet ? null : incoming, asks = waiting() - (hushed.get(state.tab) ?? 0), busy = asks > 0 || !!a
  began = busy ? began || now : 0
  const names = asks ? asked : a?.names ?? [], opens = names.length > 0 && fresh(names)
  const last = a?.parts.at(-1), at = last ? last.at + extent(last) : 0
  // a file still arriving decodes; once all of it has come, what the output waits for is its steps, said by name: the one
  // reading its input whole first (a model's run over it) while it does, which says how long it has taken; else those it
  // applies, and how far they have come
  const decoding = !!a?.loaded && !a.loaded.whole
  let word = a?.step ? `Applying ${a.step}` : a?.steps?.length ? `Applying ${several(a.steps)}` : 'Rendering', share = null, figure = ''
  if (decoding) { word = 'Decoding'; share = a.loaded.estimate ? a.loaded.at / a.loaded.estimate : null }
  else if (opens && !last && !a?.loaded && !a?.steps) word = 'Decoding'
  else if (!asks && a?.total && !a.step) share = at / a.total
  // the figure after the words, apart from them: how far it has come, where the file says nothing of its length how much
  // of it has, else how long it has taken once that is a second
  if (share != null) figure = `${Math.min(99, Math.floor(share * 100))}%`
  else if (decoding) figure = clock(a.loaded.at, 0)
  else if (now - began > 1000) figure = `${((now - began) / 1000).toFixed(1)}s`
  const shown = busy && now - began > 200
  state.progress = shown ? word : ''
  state.figure = shown ? figure : ''
  state.arrived = share == null ? null : Math.min(.99, share)
  state.working = shown
  if (busy && !ticking) ticking = setInterval(status, 100)
  if (!busy && ticking) { clearInterval(ticking); ticking = 0 }
  sway()
}
// Named as its tab is (soundName), for the files a run opened where the script alone does not say, while a chain is being
// typed; so a file that failed to open is still named
function entitle(names, has) {
  state.name = soundName(ed.code, source(ed.code)?.strings.map(s => s.name) || names, has)
  document.title = `${state.name === 'untitled' ? '' : state.name + ' · '}audio playground`
}
// The one file the script opens, whose original the output compares with; none for generated or joined sources.
export const sourceName = () => { const s = source(ed.code)?.strings; return s?.length === 1 ? s[0].name : null }
// Checks the output against the chosen spec, a moment after it settles; a newer output's check replaces an older one's,
// which the page then ignores.
export function scheduleCheck(delay = 300) {
  clearTimeout(scheduleCheck.timer)
  if (!state.spec || !state.hasOutput) { state.report = null; state.checking = false; return }
  state.checking = true
  scheduleCheck.timer = setTimeout(async () => {
    const seq = ++checks, spec = state.spec, r = await eng.check(spec)
    if (seq !== checks || spec !== state.spec) return
    state.checking = false
    if (r.error) { state.report = null; return note(`Check failed: ${r.error.message}`) }
    state.report = r.output
  }, delay)
}

export function wire() {
  eng.onrestart = () => { for (const d of docs) if (d.output) d.output.said = null }
  // Settled, for whoever drives the page and waits on it (playground.test.js): the kept files read, no run waiting to
  // start, asked or on its way, and two frames drawn since
  globalThis.__settled = async () => {
    const frame = () => new Promise(requestAnimationFrame)
    await restoring
    while (timer || waiting() || incoming) await frame()
    await frame()
    await frame()
    return true
  }
}
