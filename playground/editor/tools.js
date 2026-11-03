import { valuesOf } from '../stack.js'
import { ops, guides, fromManifest, reshapes } from '../ops.js'
import { prepare, chain, number, setArg, unsetArg, steps as stepsOf, stages, mixed, dropStep, moveStep, turnOff, turnOn, tracks as tracksOf, useTake } from '../code.js'
import { docs, retitle, switchTab, closeTab } from '../editor.js'
import { bridge } from './chat.js'
import { formats, scaleNames } from './config.js'
import { state, eng, v, ed, rk, pl, output, shown, carded, assign } from './context.js'
import { write, applied } from './edits.js'
import { shelf, openFiles, encodingOf } from './files.js'
import { stamp } from './format.js'
import { shows, showAs } from './look.js'
import { toggleAB, togglePlay, onscrub } from './play.js'
import { ran, within, sourceName } from './run.js'
import { focusOn, laneIndex } from './tracks.js'

// The page as the agent's tools reach it (page): its state, the script, each edit and step, what it measures and
// hears; and the agent's last edit drawn over the output

// What a call sets, drawn over the output (ops.js guides), from its values by its parameters' names (`spec`)
export function guidesOf(call, spec, values = valuesOf(spec, call)) {
  const named = Object.fromEntries(spec.map((s, i) => [s.name, values[i]]))
  for (const arg of call.args) if (arg.kind === 'object') for (const p of arg.props) named[p.name] ??= p.value
  return guides(call.name, named, v.duration)
}
// The agent (agent.js): the user's own, through the local bridge, editing the sound open here with the page's tools,
// each named as the bridge's MCP server names it (bin/mcp.js --playground). What an edit does is answered once its run ends.
export const page = {
  state: () => ({
    script: ed.code, name: state.name, duration: output?.duration ?? 0, sampleRate: output?.sampleRate ?? null, channels: (output?.channels ?? output?.peaks)?.length ?? null,
    selection: v.selection, band: v.band, cursor: v.cursor, markers: output?.markers ?? [], problem: state.problem || null,
    stats: output?.stats ? { peak: output.stats.peak, loudness: output.stats.loudness } : null,
    steps: stepsOf(ed.code).map(({ text, on }) => ({ call: text.slice(1), on })), shown: shownStep(),
    tracks: output?.tracks?.map(t => ({ name: t.name, duration: t.length / output.sampleRate })) ?? null, track: state.track
  }),
  async script({ code }) {
    if (typeof code !== 'string') throw new Error('script: code is the whole script, a string')
    if (code === ed.code) return { ok: true, duration: output?.duration ?? 0, unchanged: true }
    whole()
    const done = ran()
    ed.change({ from: 0, to: ed.code.length, insert: code })
    return within(done)
  },
  async edit({ call }) {
    if (typeof call !== 'string' || !call.trim()) throw new Error('edit: call is one method call, e.g. "normalize(-16)"')
    const text = call.trim().replace(/^\./, ''), was = output, before = was && pitched(text) ? await eng.contour(was.id) : null
    whole()
    const done = ran()
    if (!write(text)) throw new Error('Open or generate a sound first')
    const r = await within(done)
    if (r.ok) await showEdit(text, was, before)
    return r
  },
  // the caret, a range, or a box of a range and a band (on the spectrogram, which then shows), brought into sight as the
  // user's own would be
  select({ at, d, duration = d, cursor, low, high, track }) {
    if (track != null && !tracksOf(ed.code).some(t => t.name === track)) throw new Error(`No track ${track}: state.tracks has ${output?.tracks?.map(t => t.name).join(', ') || 'none'}`)
    if (track != null) focusOn(track)
    const band = low != null && high != null && +high > +low ? [+low, +high] : null
    if (band && shows(state.track) !== 'spec') showAs('spec')
    if (cursor != null) { v.select(0, 0); v.setCursor(+cursor); v.reveal(v.cursor) }
    else if (at != null && duration != null) { v.select(+at, +at + +duration, band); v.reveal(...v.selection ?? [v.cursor]) }
    else v.select(0, 0)
    return { selection: v.selection, band: v.band, cursor: v.cursor, track: state.track }
  },
  // the caret moved as a held one is, the moment under it sounding: held still at `at` for d s, or swept to `to` over d s
  // (as long as the sweep, by default: as fast as it plays)
  async scrub({ at, to, d, duration = d }) {
    if (!state.whole) throw new Error('Nothing to scrub: open or generate a sound first')
    // at most 20 s, under the bridge's wait for an answer
    const T = output.duration, a = Math.max(0, Math.min(T, +at || 0)), b = to == null ? a : Math.max(0, Math.min(T, +to)), long = Math.max(.05, Math.min(20, +(duration ?? (Math.abs(b - a) || .5)) || .5))
    v.select(0, 0)
    v.reveal(Math.min(a, b), Math.max(a, b))
    const t0 = performance.now()
    for (let u = 0; u < 1;) {
      u = Math.min(1, (performance.now() - t0) / 1000 / long)
      const t = a + (b - a) * u
      v.setCursor(t)
      onscrub(t)
      await new Promise(resolve => setTimeout(resolve, 16))
    }
    onscrub(null)
    return { cursor: v.cursor }
  },
  // an edit of the chain, as its card's acts are: turned off or on, taken away, or moved to stand at `to` (steps as
  // state lists them); its call written anew; or turned off or on over a range of the output alone, its mix (stepMix)
  async step({ index, on, remove, to, call, at, d, duration = d }) {
    const n = stepsOf(ed.code).length, s = stepsOf(ed.code)[index]
    if (!s) throw new Error(`No edit ${index}: state lists ${n}`)
    if (call != null) {
      if (typeof call !== 'string' || !call.trim()) throw new Error('step: call is one method call, as `edit` takes it')
      if (!s.on) throw new Error(`Edit ${index} is off: turn it on to change it`)
      const text = '.' + call.trim().replace(/^\./, '')
      if (text === s.text) return { ok: true, unchanged: true }
      whole()
      const done = ran()
      ed.change({ from: s.call.from, to: s.call.to, insert: text })
      return within(done)
    }
    if (at != null || duration != null) return stepMix(index, on, +at, +duration)
    if (!remove && to == null && on == null) throw new Error('step: on, remove, to or call')
    if (!remove && to != null && (!(+to >= 0 && +to < n) || !s.on)) throw new Error(s.on ? `No place ${to} to move it to: there are ${n}` : `Edit ${index} is off: turn it on to move it`)
    if (!remove && (to != null ? +to === +index : !!on === s.on)) return { ok: true, unchanged: true }
    const change = remove ? dropStep(ed.code, index) : to != null ? moveStep(ed.code, index, +to) : on ? useTake(ed.code, s.call.from) ?? turnOn(ed.code, s.call) : turnOff(ed.code, s.call)
    if (!change) throw new Error(to != null ? `Edit ${index} stays among the steps it is with: those other tracks share, or this track's own` : `Edit ${index} cannot be commented out: its text holds */`)
    whole()
    const done = ran()
    ed.change(change)
    return within(done)
  },
  // a file on the user's machine, read through the bridge, in a tab of its own (the tab shown, if it is empty)
  async open({ path }) {
    if (typeof path !== 'string' || !path) throw new Error('open: path, a file on this machine')
    const file = await bridge.file(path), done = ran()
    await openFiles([file])
    return { ...await within(done), name: file.name }
  },
  // the output (a track alone), encoded as the path's extension says, or the file as it opened, its bytes as they are,
  // written to a file on the user's machine through the bridge: for the agent's own tools to take it from there
  async save({ path, track, original, force }) {
    if (typeof path !== 'string' || !path) throw new Error('save: path, a file on this machine to write')
    const type = path.match(/\.(\w+)$/)?.[1].toLowerCase()
    if (original) {
      const name = sourceName(), file = name && shelf.get(name), own = name?.match(/\.(\w+)$/)?.[1].toLowerCase()
      if (!file) throw new Error(name ? `${name} is not kept in this page: save the output` : 'A generated sound has no file as it opened')
      if (type !== own) throw new Error(`${name} is .${own}: save it as .${own}, or the output in any format`)
      return bridge.save(path, file, force)
    }
    if (!formats.some(f => f.name === type)) throw new Error(`save: a path ending in ${formats.map(f => '.' + f.name).join(', ')}`)
    const names = tracksOf(ed.code).map(t => t.name)
    if (track != null && !names.includes(track)) throw new Error(`No track ${track}: state.tracks has ${names.join(', ') || 'none'}`)
    await whole(true)
    const { files = [], error } = await eng.export({ format: type, name: 'output', options: encodingOf(type), saves: false, ...track != null && { track: names.indexOf(track) } })
    if (error) throw new Error(error.message)
    return bridge.save(path, files[0].bytes, force)
  },
  // the tabs, a sound each, as the strip shows them; with `to` one shown, the one every tool then acts on; with `close`
  // one closed (⇧⌘T opens it again)
  tabs({ to, close }) {
    if (to != null && close != null) throw new Error('tabs: to or close, not both')
    const id = i => { if (!docs[i]) throw new Error(`No tab ${i}: there are ${docs.length}`); return docs[i].id }
    if (close != null) closeTab(id(close))
    else if (to != null) switchTab(id(to))
    retitle()
    return state.tabs.map((t, index) => ({ index, name: t.name, shown: t.id === state.tab }))
  },
  // the output, or with `original` the file as it opened, level-matched (B); with `step`, the output up to that edit, or
  // what it takes out, as its card chosen in the Edits panel shows it (staying so until the agent's next edit or play)
  async play({ at, d, duration = d, original, step, takes }) {
    await (step != null ? showStep(+step, takes) : whole(true))
    if (original != null && !!original !== !!state.ab) await toggleAB()
    if (at != null) page.select({ at, duration: duration ?? Math.max(0, (output?.duration ?? 0) - at) })
    if (!pl.playing) await togglePlay()
    return { playing: pl.playing, original: !!state.ab }
  },
  // anything the library measures, on the output shown and its source, and the edits (step(i)), changing nothing (worker.js
  // evaluate); what it measured, stat by stat, told the chat besides (`tell`)
  async measure({ code }, tell) {
    if (typeof code !== 'string' || !code.trim()) throw new Error('measure: code is JavaScript, its last expression the answer')
    const r = await eng.evaluate({ ...prepare(code), steps: /\bstep\s*\(/.test(code) ? staging(ed.code) : [], track: laneIndex() })
    if (r.error) throw new Error(r.error.line ? `line ${r.error.line}: ${r.error.message}` : r.error.message)
    tell?.(r.measured)
    return r.value ?? null
  },
  // the picture, the waveform over the spectrogram, of [at, at + d] or of what shows (view.js snapshot); with `step`, of the
  // output up to that edit or what it takes out, the panel then as it was
  async look({ at, d, duration = d, step, takes }) {
    if (step != null) {
      const was = rk.shown()
      await showStep(+step, takes)
      try { return await page.look({ at, duration }) } finally { rk.choose(was.id, was.takes) }
    }
    if (!state.whole) throw new Error('Nothing drawn yet: open or generate a sound first')
    const a = at != null ? Math.max(0, +at) : null, range = a != null ? [a, duration != null ? a + +duration : output.duration] : null
    const [from, to] = range ?? v.range
    const toned = state.show.guides && shown?.code === ed.code && shown.guides.some(g => g.pitch)
    return { image: v.snapshot(range), text: `${stamp(from)} to ${stamp(to)}: the waveform, levels ${state.levels === 'db' ? 'in dB' : 'as sample values'}, over the spectrogram, frequencies in ${scaleNames[state.scale].toLowerCase()}${toned ? '; on it the pitch curve before your last edit, dashed, and after it' : ''}` }
  },
  stop() { if (pl.playing) togglePlay(); return { playing: false } },
  async check({ spec }) { const r = await eng.check(spec); if (r.error) throw new Error(r.error.message); return r.output },
  async undo() { if (!ed.canUndo) return { ok: false, problem: 'Nothing to undo' }; const done = ran(); ed.undo(); return within(done) },
  async redo() { if (!ed.canRedo) return { ok: false, problem: 'Nothing to redo' }; const done = ran(); ed.redo(); return within(done) }
}
// The agent's view of the Edits panel. State's step `index` as its card is known: where its "(" is (null: turned off)
const cardOf = index => { const s = stepsOf(ed.code)[index]; return s?.on ? s.call.list.from : null }
// what the output shows when not the whole chain: up to state's step `step` (-1, the sound alone), or what it takes out
function shownStep() {
  const { id, takes } = rk.shown()
  if (id == null) return null
  return { step: id === 'source' ? -1 : stepsOf(ed.code).findIndex(s => s.on && s.call.list.from === id), takes }
}
// the whole chain shown again, as Esc does: an agent's edit goes at its end, never dropping the steps after a card chosen;
// `wait`ed for, its output rendered
async function whole(wait = false) {
  if (rk.shown().id == null) return
  const done = wait && ran()
  rk.choose(null)
  if (done) await within(done)
}
// state's step `index` shown as its card chosen: the output up to it, or with `takes` what it takes out, once rendered
async function showStep(index, takes) {
  const s = stepsOf(ed.code)[index], id = cardOf(index)
  if (!s) throw new Error(`No edit ${index}: state lists ${stepsOf(ed.code).length}`)
  if (id == null) throw new Error(`Edit ${index} is off: turn it on to hear or see it`)
  if (takes && reshapes(s.name)) throw new Error(`.${s.name}() changes the timing: before and after it don't line up, so there is no difference to take`)
  const was = rk.shown()
  if (was.id === id && was.takes === !!takes) return
  const done = ran()
  rk.choose(id, !!takes)
  await within(done)
}
// The edits as a measure's step(i) reads them (code.js stages): the scripts each one's output enters and leaves it by,
// prepared, and whether it keeps the timing, so before less after is what it takes out
const staging = code => stages(code).map(s => ({ call: s.call, on: s.on, keeps: s.on && !reshapes(s.name), before: prepare(s.before), after: s.after && prepare(s.after) }))
// State's step `index` turned off (`on` false) or on over [at, at + d] of the output alone: the range as it was where the
// sound entered the step (measure's step(i).where), its mix there 0 (or 1), ramps of the splice setting outside it
async function stepMix(index, on, at, d) {
  const s = stepsOf(ed.code)[index]
  if (typeof on !== 'boolean') throw new Error('step: on, true or false, over { at, d }')
  if (!(d > 0) || !(at >= 0)) throw new Error('step: a range of the output, at ≥ 0 and d > 0 seconds')
  if (!s.on) throw new Error(`Edit ${index} is off: turn it on first`)
  // an effect's own mix (a reverb's dry/wet) is its own; one written as an expression, the agent's to rewrite
  const own = s.call.args.find(a => a.kind === 'object')?.props.find(p => p.name === 'mix'), spec = ops[s.name]?.params ?? fromManifest(await eng.describe(s.name))
  if (spec?.some(p => p.name === 'mix') || own && own.value === undefined) throw new Error(`.${s.name}() has a mix of its own: change it with call`)
  await whole(true)
  const r = await eng.evaluate({ ...prepare(`step(${index}).where({ at: ${at}, d: ${d} })`), steps: staging(ed.code), track: laneIndex() })
  if (r.error) throw new Error(r.error.message)
  const place = r.value
  if (!place) throw new Error(`${stamp(at)} to ${stamp(at + d)} is not in the sound as it enters .${s.name}(): an edit before it made it`)
  const mix = mixed(own?.value ?? 1, place.at, place.at + place.d, on ? 1 : 0, state.splice / 1000)
  const text = mix == null ? null : typeof mix === 'number' ? number(mix) : `{ t: [${mix.t.map(t => number(t, 1e-4)).join(', ')}], v: [${mix.v.map(x => number(x)).join(', ')}] }`
  const change = text == null ? unsetArg(s.call, 'mix') : setArg(s.call, 'mix', { raw: text })
  if (!change || applied(ed.code, change) === ed.code) return { ok: true, unchanged: true }
  const done = ran()
  ed.change(change)
  return { ...await within(done), mix: mix ?? 1 }
}
// An edit that moves pitch (Time & pitch: pitch, intonation, formant, tune…), by its call's name
const pitched = text => ops[text.match(/^([\w$]+)\s*\(/)?.[1]]?.group === 'Time & pitch'
// What the agent's edit `text` sets, drawn over the output as its card draws it pointed at, its range brought into view;
// for a pitch edit that keeps the length, the pitch curve over the output before it (`was`, its curve `before`), dashed,
// and after, the spectrogram showing. It stays while the script is as the edit left it, the agent's look seeing it too
async function showEdit(text, was, before) {
  const k = chain(ed.code)?.calls.findLast(k => ed.code.slice(k.dot + 1, k.to) === text), code = ed.code
  if (!k) return
  const list = guidesOf(k, ops[k.name]?.params ?? fromManifest(await eng.describe(k.name)))
  if (before?.f0.length && output && was && Math.abs(output.duration - was.duration) < 1e-3) {
    const after = await eng.contour(output.id)
    if (after.f0.length) list.push({ pitch: { before, after } })
  }
  if (ed.code !== code) return
  if (list.some(g => g.pitch) && shows(state.track) !== 'spec') showAs('spec')
  assign({ shown: { code, guides: list } })
  if (!carded) v.guides = list
  const range = list.find(g => g.range)?.range
  if (range) v.reveal(...range)
}
