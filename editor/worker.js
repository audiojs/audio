// The editor's engine, in a worker: it runs scripts against the audio library, so a long render or a runaway
// script never freezes the page. Built with the library into editor/dist/ (node .site-build.js).
// A file starts decoding when a script first names it, and the script runs at once, on a copy that follows the file
// as it arrives (clone). The output streams to the page as it renders; while a file arrives and the output has
// nothing yet (it needs the whole file, as trim and normalize do), the file itself streams, as it decodes. What a chain
// made is kept by what made it, its steps too, so what was made before comes at once (renders kept, below).
import audio from '../audio.js'
import { loadOps } from '../core.js'
import plugins from 'editor:plugins'
import { attacks, hits } from '../fn/hits.js'
import { steadyTempo } from '../fn/beat.js'
import { contour as pitchOf } from '../fn/pitch-detect.js'
import { expose } from '../worker.js'
import { heard } from './heard.js'

// Registry plugins load from their chunks: the build writes one literal import per plugin.
audio.import = spec => plugins[spec]?.() ?? import(spec)

// Samples kept in the browser's own file system by a key, as a studio keeps its renders: each file its meta's length,
// its channels' count and length (three uint32), its meta as JSON (to a multiple of 4 bytes), then each channel's
// samples. Up to `max` bytes, the oldest let go first; the storage failing, nothing is kept, nothing found.
function disk(name, max) {
  const dir = async () => (await navigator.storage.getDirectory()).getDirectoryHandle(name, { create: true })
  // the names kept, read once: a key not there is not looked for (a run that has none starts at once)
  const kept = dir().then(async d => { const all = new Set(); for await (const k of d.keys()) all.add(k); return all }).catch(() => new Set())
  return {
    async get(key) {
      if (!(await kept).has(encodeURIComponent(key))) return null
      try {
        const file = await (await (await dir()).getFileHandle(encodeURIComponent(key))).getFile()
        const [m, k, n] = new Uint32Array(await file.slice(0, 12).arrayBuffer()), at = 12 + Math.ceil(m / 4) * 4
        if (!k || file.size !== at + k * n * 4) return null
        const meta = m ? JSON.parse(await file.slice(12, 12 + m).text()) : null, data = new Float32Array(await file.slice(at).arrayBuffer())
        return { meta, channels: Array.from({ length: k }, (_, c) => data.subarray(c * n, (c + 1) * n)) }
      } catch { return null }
    },
    async set(key, channels, meta = null) {
      const d = await dir(), json = new TextEncoder().encode(meta ? JSON.stringify(meta) : '')
      const out = await (await d.getFileHandle(encodeURIComponent(key), { create: true })).createWritable()
      await out.write(new Uint32Array([json.length, channels.length, channels[0]?.length ?? 0]))
      await out.write(json)
      if (json.length % 4) await out.write(new Uint8Array(4 - json.length % 4))
      for (const c of channels) await out.write(c)
      await out.close()
      const names = await kept, all = []
      names.add(encodeURIComponent(key))
      for await (const h of d.values()) if (h.kind === 'file' && !h.name.endsWith('.crswap')) { const f = await h.getFile(); all.push({ name: h.name, size: f.size, at: f.lastModified }) }
      let total = all.reduce((s, f) => s + f.size, 0)
      for (const f of all.sort((p, q) => p.at - q.at)) { if (total <= max) break; names.delete(f.name); await d.removeEntry(f.name).catch(() => {}); total -= f.size }
    }
  }
}
// What a model made of its input (core.js memo: deepfilter's enhancement, vocals' separation), by its key: a reload,
// another tab, a setting applied after the model read it back, the model not run again
const memos = disk('audio-editor-memo', 2 ** 30)
audio.memo = { get: async key => (await memos.get(key))?.channels ?? null, set: (key, channels) => memos.set(key, channels) }

const AsyncFunction = (async () => {}).constructor
const LOOP_LIMIT = 5000
// The longest output the page holds as samples (it keeps a few copies): 30 channel-minutes at 48 kHz.
const PREVIEW_LIMIT = 30 * 60 * 48000

const files = new Map()        // virtual file name → Blob, or { channels, sampleRate } for generated audio
const sources = new Map()      // name → its instance, arriving or arrived; never edited: every run edits a clone
const outputs = new Map()      // run id → its output as it streams: { tab, instance, pcm, length, sampleRate, done, … }; each tab's last kept
let run = null                 // the script running now: { created, saves }
let newest = 0                 // the run whose output streams: older streams stop

// Script calls that reach outside the page become editor actions: save() marks an export for the Export button,
// play() is the page's transport, record() is the page's Record button.
audio.fn.save = function (target, opts) { run?.saves.push({ instance: this, name: String(target ?? ''), opts }); return Promise.resolve(this) }
audio.fn.play = function () { return this }
audio.fn.record = function () { throw new Error('Record with the Record button; a script cannot open the microphone.') }

const isAudio = value => value != null && typeof value === 'object' && typeof value.read === 'function' && Array.isArray(value.edits)
const load = name => {
  const file = files.get(name)
  if (file && !(file instanceof Blob)) return audio.from(file.channels, { sampleRate: file.sampleRate })
  if (file || /^(https?|data|blob):/.test(name)) return audio(file || name)
  // a file the page never had, or lost with a reload: the page asks for it by name
  throw Object.assign(new Error(`${name} is not open here: open it, or drop it on the page`), { missing: name })
}
// A source opens once, the first time a script names it, and decodes while scripts run on it. One that won't decode
// is let go, so the next run tries again.
function open(name) {
  if (sources.has(name)) return sources.get(name)
  const a = load(name)
  sources.set(name, a)
  a.ready.catch(() => { if (sources.get(name) === a) sources.delete(name) })
  return a
}
const forget = name => { sources.get(name)?.dispose(); sources.delete(name) }
// What a failed source says: which file, and why
const opening = (name, error) => error.missing ? error : new Error(`Could not open ${name}: ${error.message}`)

// `audio` as scripts see it: a named source opens from the page's files, and each run edits its own copy, which knows
// the source it was copied from (`roots`); every instance made goes to `track`, to be let go with what made it
const roots = new WeakMap()
function scoped(track) {
  const api = new Proxy(function audio_(source, opts) {
    if (typeof source === 'string' && !opts) { const a = open(source).clone(); roots.set(a, open(source)); return track(a) }
    if (Array.isArray(source) && source.some(s => typeof s === 'string')) return track(audio(source.map(s => typeof s === 'string' ? api(s) : s), opts))
    return track(audio(source, opts))
  }, {
    get: (target, key) => key === 'from' ? (...args) => track(audio.from(...args)) : audio[key]
  })
  return api
}
const api = scoped(a => (run?.created.push(a), a))

// A value as the console prints it.
function inspect(value, depth = 0) {
  if (typeof value === 'string') return depth ? JSON.stringify(value) : value
  if (typeof value === 'number') return Object.is(value, -0) ? '0' : String(+value.toPrecision(12))
  if (value == null || typeof value !== 'object') return typeof value === 'function' ? `ƒ ${value.name || '(anonymous)'}` : String(value)
  if (isAudio(value)) return `audio ${value.duration.toFixed(3)} s, ${value.channels} ch, ${value.sampleRate} Hz`
  if (ArrayBuffer.isView(value)) return `${value.constructor.name}(${value.length}) [${[...value.slice(0, 8)].map(v => inspect(v, 1)).join(', ')}${value.length > 8 ? ', …' : ''}]`
  if (depth > 2) return Array.isArray(value) ? '[…]' : '{…}'
  if (Array.isArray(value)) return `[${value.slice(0, 20).map(v => inspect(v, depth + 1)).join(', ')}${value.length > 20 ? `, … ${value.length - 20} more` : ''}]`
  if (value instanceof Map) return `Map(${value.size}) {${[...value].slice(0, 10).map(([k, v]) => `${inspect(k, depth + 1)} => ${inspect(v, depth + 1)}`).join(', ')}}`
  if (value instanceof Error) return `${value.name}: ${value.message}`
  return `{ ${Object.entries(value).slice(0, 20).map(([k, v]) => `${k}: ${inspect(v, depth + 1)}`).join(', ')} }`
}

// Where in the script an error happened: the line of its first frame in the script's own source.
let lineOffset = 0
try { new AsyncFunction('throw new Error()\n//# sourceURL=repl-probe.js')().catch(e => { lineOffset = +(e.stack?.match(/repl-probe\.js:(\d+)/)?.[1] ?? 1) - 1 }) } catch {}
const failure = error => {
  const at = error?.stack?.match(/repl\.js:(\d+):(\d+)/)
  return { message: error?.message ?? String(error), name: error?.name, ...(error?.missing && { missing: error.missing }), ...(at && { line: +at[1] - lineOffset, column: +at[2] }) }
}

// The script's last expression comes back boxed (code.js prepare), so a sound still arriving, which is thenable,
// is not waited out: its output streams instead.
class Out { constructor(value) { this.value = value } }
const out = value => new Out(value)

// Runs a script, the page's tab `tab`'s: the reply says what it printed and whether it made a sound; the sound then
// streams (render). Each tab's last output stays, for the page to show again as it was, measure and export, nothing run
// again; the newest run streams alone.
async function execute({ id, code, names = [], tab = null }) {
  const logs = [], log = level => (...args) => logs.push({ level, text: args.map(a => inspect(a)).join(' ') })
  const console = { log: log('log'), info: log('log'), debug: log('log'), warn: log('warn'), error: log('error'), table: log('log') }
  run = { created: [], saves: [] }
  try {
    for (const name of names) open(name)
    const started = performance.now()
    const guard = () => { if (performance.now() - started > LOOP_LIMIT) throw new RangeError(`A loop ran for ${LOOP_LIMIT / 1000} s; stopped it.`) }
    // Scripts see `audio`, `console` (to the page's console) and `files`, the names of the open files.
    let value = await new AsyncFunction('audio', 'console', 'files', '__loop', '__out', code + '\n//# sourceURL=repl.js')(api, console, [...files.keys()], guard, out)
    if (value instanceof Out) value = value.value
    if (value && typeof value.then === 'function' && !isAudio(value)) value = await value
    // The output is the script's value, or else the last audio it made (an analysis shows what it measured).
    const output = isAudio(value) ? value : run.created.findLast(a => !a._?.disposed) ?? null
    const result = { logs, saves: run.saves.map(s => s.name), output: !!output }
    if (!isAudio(value) && value !== undefined) result.value = inspect(value)
    // this run's output is the one that streams now; an older one still streaming stops
    newest = id
    for (const r of outputs.values()) if (!r.done) drop(r)
    if (!output) { for (const r of outputs.values()) if (r.tab === tab) drop(r); dispose(run.created); return result }
    const record = { id, tab, instance: output, created: run.created, saves: run.saves, names, pcm: null, length: 0, sampleRate: 0, done: false }
    record.finished = new Promise(resolve => { record.finish = resolve })
    record.keys = keysOf(output)
    record.based = based(record)
    if (record.based?.instance) record.created.push(record.based.instance)
    record.content = contentOf(code, names)
    outputs.set(id, record)
    render(record)
    return result
  } catch (error) {
    dispose(run.created)
    return { logs, error: failure(error) }
  } finally { run = null }
}
// Instances a run made, but for those in `keep`
function dispose(created, keep) {
  for (const a of created || []) if (a !== keep && !a._?.disposed) a.dispose?.()
}
// An output the page no longer needs: its instances go, and whoever waits for it hears it is gone
function drop(r) {
  outputs.delete(r.id)
  dispose(r.created)
  r.voice?.dispose()
  r.finish(null)
}

// ── Renders kept ──────────────────────────────────────────────
// What a chain made, kept by what made it (keysOf): the source it opens, the marks its script put, its edits up to a step.
// A run that starts as one kept renders only what follows it, on its samples (based): an edit added at the end, a step
// turned off or on, a card chosen, a tab shown again; what that leaves as it was passes through block by block, only
// what it changes is processed (a ranged op copies the rest). The steps of each output are kept too, once it has come and
// nothing else runs (checkpoints), so a step changed renders from the one before it. Kept here up to KEPT samples, the
// least lately used let go first; each output also in the browser's own file system by its script and the files it opens
// (renders), so a reload, or a tab shown for the first time since, shows it at once. Anything the edits can't say is the
// same (a function, samples made in the script) is kept no further than the step before it.
const KEPT = PREVIEW_LIMIT
const kept = new Map()         // key → { pcm, sampleRate, markers, regions, figures }
const renders = disk('audio-editor-renders', 2 ** 31)
function store(key, entry) {
  kept.delete(key)
  kept.set(key, entry)
  let total = 0
  for (const [k, e] of [...kept].reverse()) if ((total += e.pcm.length * (e.pcm[0]?.length ?? 0)) > KEPT) kept.delete(k)
}
function recall(key) {
  const e = kept.get(key)
  if (e) { kept.delete(key); kept.set(key, e) }
  return e
}
// what the script's marks are: those of the file it opens, or any it put (then only a whole output is a start: a mark
// put after a step would be lost on what the steps before it made)
const marksOf = a => (a.meta, JSON.stringify([a._.markers ?? [], a._.regions ?? [], a._.marks ?? []]))
// The keys of an output's start and of each step after it, [the source, its first edit, …]; none for a sound the script
// made from nothing
function keysOf(a) {
  const root = roots.get(a)
  if (!root) return Object.assign([], { marked: true })
  const marks = marksOf(a), keys = Object.assign([`${idOf(root)}|${marks}|`], { marked: marks !== marksOf(root) })
  for (const e of a.edits) { const s = sig(e); if (s == null) break; keys.push(`${keys.at(-1)}${s};`) }
  return keys
}
// A run's start: its whole output kept ({ hit }), else the longest of its starts kept with the steps after it on its
// samples ({ at, instance }); null, none (a clipboard a step before it filled, a paste would find empty)
function based(r) {
  const keys = r.keys, edits = r.instance.edits
  for (let k = keys.length - 1; k >= 0; k--) {
    const e = recall(keys[k])
    if (!e) continue
    if (k === edits.length) return { hit: e }
    try { return { at: k, instance: from(e, edits.slice(k)) } } catch { return null }
  }
  return null
}
// A sound kept, with `edits` after it
function from(e, edits) {
  const a = audio.from(e.pcm, { sampleRate: e.sampleRate })
  if (e.markers.length) a.markers = e.markers
  if (e.regions.length) a.regions = e.regions
  return edits.length ? a.run(...edits.map(([type, opts]) => [type, opts ? { ...opts } : {}])) : a
}
// An output's name in the browser's files: the build, the script, the files it opens, each by its name and size (a
// sound made here as the WAV it is kept as, 32-bit float); one it reads from elsewhere (a web address), which may change
// there, nothing kept
const build = fetch(import.meta.url).then(r => r.text()).then(digest).catch(() => null)
async function contentOf(code, names) {
  const sizes = names.map(n => { const f = files.get(n); return f instanceof Blob ? f.size : f?.channels ? 44 + f.channels.length * f.channels[0].length * 4 : null })
  const b = await build
  return b && !sizes.includes(null) ? digest(JSON.stringify([b, code, names, sizes])) : null
}
async function digest(text) {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))].map(x => x.toString(16).padStart(2, '0')).join('')
}

// An edit as a string to compare, or null where it holds what cannot be compared: a copy of a source as that source and
// its own edits; a function or samples, never the same as another's
const ids = new WeakMap()
let lastId = 0
const idOf = o => ids.get(o) ?? (ids.set(o, ++lastId), lastId)
function sig(v) {
  if (typeof v === 'function' || ArrayBuffer.isView(v)) return null
  if (v == null || typeof v !== 'object') return JSON.stringify(v) ?? 'undefined'
  if (isAudio(v)) { const root = roots.get(v), edits = sig(v.edits); return root && edits != null ? `a${idOf(root)}${edits}` : null }
  const parts = Array.isArray(v) ? v.map(sig) : Object.keys(v).sort().map(k => { const x = sig(v[k]); return x == null ? null : `${k}:${x}` })
  return parts.includes(null) ? null : Array.isArray(v) ? `[${parts}]` : `{${parts}}`
}

const post = (message, transfer = []) => self.postMessage(message, transfer)

// A run's output to the page as it renders, in pieces of about a tenth of a second, then its figures; one kept, at once,
// a few seconds a piece. While the files it opens are still arriving and it has nothing of its own yet, the first of them
// streams as it decodes. What it does is said as it does it: the steps it applies, and a step reading its input whole
// first (a model's run over it) by its own name while it does (announce)
async function render(r) {
  // the run's reply goes first
  await new Promise(resolve => setTimeout(resolve))
  const alive = () => newest === r.id
  let hit = r.based?.hit ?? null
  const content = await r.content
  if (!hit && content && alive()) {
    const got = await renders.get(content)
    if (got) { hit = { pcm: got.channels, ...got.meta }; if (keyed(r)) store(r.keys.at(-1), hit) }
  }
  if (!alive()) return
  if (hit) return replay(r, hit)
  const patched = await fragment(r)
  if (!alive()) return
  if (patched) {
    if (keyed(r)) store(r.keys.at(-1), patched)
    if (content) renders.set(content, patched.pcm, { ...patched, pcm: undefined }).catch(() => {})
    return replay(r, patched)
  }
  const name = r.names.find(n => sources.has(n) && !sources.get(n).decoded), a = r.based?.instance ?? r.instance
  let first = false
  if (name) arriving(r.id, name, () => alive() && !first)
  post({ id: r.id, event: 'doing', steps: a.edits.map(e => e[0]) })
  announce(a.edits)
  try {
    await relay(a.stream(), alive, (at, channels) => {
      first = true
      keep(r, at, channels)
      post({ id: r.id, event: 'chunk', at, channels, sampleRate: r.sampleRate, ...expect(r) }, channels.map(c => c.buffer))
    }, () => r.instance.sampleRate)
    if (!alive()) return
    r.sampleRate ||= r.instance.sampleRate
    r.pcm = pcmOf(r).map(c => c.slice())
    const figures = await figuresOf(r.pcm, r.sampleRate), end = r.length / r.sampleRate
    if (!alive()) return
    // its markers and its ranges (mark()), where its edits put them
    const markers = a.markers.filter(m => m.time <= end).map(({ time, label }) => ({ time, label }))
    const regions = a.regions.filter(g => g.at < end).map(({ at, duration, label }) => ({ at, duration: Math.min(duration, end - at), label }))
    const e = { pcm: r.pcm, sampleRate: r.sampleRate, markers, regions, figures, bitDepth: r.instance.bitDepth ?? null }
    if (keyed(r)) store(r.keys.at(-1), e)
    if (content) renders.set(content, e.pcm, { ...e, pcm: undefined }).catch(() => {})
    finish(r, e)
  } catch (error) {
    if (!alive()) return
    const failed = r.names.find(n => !sources.has(n))
    post({ id: r.id, event: 'error', error: failure(failed ? opening(failed, error) : error) })
    drop(r)
  }
}
// Whether a run's every edit has a key: its whole output can be kept
const keyed = r => r.keys.length === r.instance.edits.length + 1
// A kept output to the page at once, ten seconds a piece
async function replay(r, e) {
  const n = e.pcm[0]?.length ?? 0, piece = 10 * e.sampleRate
  Object.assign(r, { pcm: e.pcm, length: n, sampleRate: e.sampleRate })
  for (let at = 0; at < n; at += piece) {
    const channels = e.pcm.map(c => c.slice(at, at + piece))
    post({ id: r.id, event: 'chunk', at, channels, sampleRate: e.sampleRate, total: n }, channels.map(c => c.buffer))
  }
  // a step kept has no figures yet: read now, kept with it
  e.figures ??= await figuresOf(e.pcm, e.sampleRate)
  if (newest === r.id) finish(r, e)
}
// An output whole: the tab's, its others let go, its figures and markers to the page in one list in time order (a range
// with its duration); then, nothing else running, its steps kept
function finish(r, e) {
  r.done = true
  r.stats = e.figures.stats
  r.markers = e.markers
  r.regions = e.regions
  for (const o of outputs.values()) if (o !== r && o.tab === r.tab) drop(o)
  const markers = [...e.markers, ...e.regions.map(({ at, duration, label }) => ({ time: at, duration, label }))].sort((p, q) => p.time - q.time)
  post({ id: r.id, event: 'done', duration: r.length / r.sampleRate, sampleRate: r.sampleRate, channels: r.pcm.length, stats: e.figures.stats, segments: e.figures.segments, markers, clips: e.figures.clips, bitDepth: e.bitDepth ?? r.instance.bitDepth ?? null })
  r.finish(r)
  checkpoint(r)
}
// An output's figures: its peak, RMS and loudness; where it clips, the blocks with a sample at full scale or past it
// (stat('clipping')), runs of them as [from, to] s; its pauses
async function figuresOf(pcm, sampleRate) {
  const length = pcm[0]?.length ?? 0, flat = audio.from(pcm.length ? pcm : [new Float32Array(0)], { sampleRate })
  try {
    const [peak, rms, loudness, clipped] = length ? await flat.stat(['db', 'rms', 'loudness', 'clipping']) : [-Infinity, 0, -Infinity, []]
    const block = audio.BLOCK_SIZE / sampleRate, clips = []
    for (const t of clipped) clips.at(-1)?.[1] >= t - 1e-9 ? clips.at(-1)[1] = t + block : clips.push([t, t + block])
    return { stats: { peak, rms, loudness }, segments: { silences: await gaps(flat, PAUSE) }, clips }
  } finally { flat.dispose?.() }
}
// The steps of an output kept while nothing else runs, each rendered from the one before it: those that took long (CHEAP
// ms and more since the last one kept) and the one before the last edit, so a step changed, turned off or chosen renders
// from just before it. None for a script with marks of its own (a mark after a step would be lost on what came before it)
const CHEAP = 50
async function checkpoint(r) {
  const keys = r.keys, edits = r.instance.edits, n = Math.min(keys.length, edits.length), idle = () => newest === r.id && outputs.has(r.id)
  if (keys.marked) return
  let last = null, at = 0, cost = 0
  for (let k = 1; k < n; k++) {
    await new Promise(resolve => setTimeout(resolve))
    if (!idle()) return
    const known = recall(keys[k])
    if (known) { last = known; at = k; cost = 0; continue }
    // from the last step made, else (a paste whose copy came before it) from the source
    let a
    try { a = last ? from(last, edits.slice(at, k)) : prefix(r.instance, k) } catch { a = prefix(r.instance, k) }
    const started = performance.now()
    try {
      announce(a.edits)
      const pcm = await collect(a, idle)
      if (!pcm) return
      const e = { pcm, sampleRate: a.sampleRate, ...marksAt(a) }
      cost += performance.now() - started
      if (cost >= CHEAP || k === edits.length - 1) { store(keys[k], e); cost = 0 }
      last = e; at = k
    } catch { return }
    finally { a.dispose?.() }
  }
}
// An instance's samples, rendered a block at a time, giving way to whatever the page asks every 20 ms of work; null once
// `going()` says to stop
async function collect(a, going, blocks = a.stream()) {
  const parts = []
  let n = 0, t = performance.now()
  for await (const block of blocks) {
    parts.push(block)
    n += block[0].length
    if (performance.now() - t > 20) { await new Promise(resolve => setTimeout(resolve)); if (!going()) return null; t = performance.now() }
  }
  return (parts[0] ?? Array.from({ length: a.channels }, () => [])).map((_, c) => { const x = new Float32Array(n); let at = 0; for (const p of parts) { x.set(p[c], at); at += p[c].length } return x })
}
// An instance's sound, as kept: whole if it is, else rendered from the longest of its starts kept, then kept
async function made(a, keys = keysOf(a)) {
  const n = a.edits.length
  let b = a
  for (let k = Math.min(keys.length - 1, n); k >= 0; k--) {
    const e = recall(keys[k])
    if (!e) continue
    if (k === n) return e
    try { b = from(e, a.edits.slice(k)) } catch {}
    break
  }
  try {
    announce(b.edits)
    const e = { pcm: await b.read(), sampleRate: b.sampleRate, ...marksAt(b) }
    if (keys.length === n + 1) store(keys[n], e)
    return e
  } finally { if (b !== a) b.dispose?.() }
}
// Its markers and ranges, read, as the page has them
const marksAt = a => ({ markers: a.markers.map(({ time, label }) => ({ time, label })), regions: a.regions.map(({ at, duration, label }) => ({ at, duration, label })) })
// An edit over a range of the sound (a band taken out, a range made quieter) set again, turned off or on, put in or taken
// away, the steps after it working sample by sample or frame by frame (none reading the sound whole first, measuring it,
// moving time or changing its rate or channels): only around the range renders again, over the tab's last output. A
// lead of LEAD s renders first and goes (what the steps hold settles), then from MARGIN s before the range: there, and
// past its end, EDGE s at a time, it must come out as the last output had it. Not so at the start (a step that learns
// from all it has heard, a noise reduction's estimate), all of it renders as before, at the cost of a second at most;
// past the end, it renders on till it is (a tail, an echo), then stops. The same samples, in a fraction of the time
// where the steps after it are slow.
const LEAD = .5, MARGIN = .25, EDGE = .02
const local = ([type, opts]) => { const d = audio.op(type); return !!d && !['copy', 'cut', 'paste'].includes(type) && !(d.plan || d.whole || d.resolve || d.expand || d.prepare || d.sr || d.ch || d.frames) && !(opts?.at < 0) }
async function fragment(r) {
  const o = [...outputs.values()].findLast(x => x.done && x !== r && x.tab === r.tab && x.keys)
  if (!o || r.keys.marked || o.keys[0] !== r.keys[0] || !keyed(r) || !keyed(o)) return null
  const was = o.instance.edits.map(sig), now = r.instance.edits.map(sig)
  let p = 0, q = 0
  while (p < was.length && p < now.length && was[p] === now[p]) p++
  while (q < was.length - p && q < now.length - p && was[was.length - 1 - q] === now[now.length - 1 - q]) q++
  const changed = [...o.instance.edits.slice(p, was.length - q), ...r.instance.edits.slice(p, now.length - q)]
  const spans = changed.map(([, opts]) => opts?.at >= 0 && opts.duration > 0 ? [+opts.at, +opts.at + +opts.duration] : null)
  if (!changed.length || spans.includes(null)) return null
  // the start it renders from: the longest kept up to the change, every step from there working on its own
  let k = p
  while (k > 0 && !kept.has(r.keys[k])) k--
  const edits = r.instance.edits.slice(k)
  if (!edits.every(local) || !o.instance.edits.slice(k).every(local)) return null
  const base = recall(r.keys[k]), rate = o.sampleRate, n = o.length, e = Math.round(EDGE * rate)
  let a
  try { a = base ? from(base, edits) : prefix(r.instance, r.instance.edits.length) } catch { return null }
  try {
    if (a.sampleRate !== rate || a.channels !== o.pcm.length || a.length !== n) return null
    const at = t => Math.max(0, Math.min(n, Math.round(t * rate)))
    const s0 = at(Math.min(...spans.map(x => x[0])) - MARGIN), s1 = at(Math.max(...spans.map(x => x[1])) + MARGIN), lead = at(s0 / rate - LEAD)
    if (s0 === 0 && s1 === n) return null
    post({ id: r.id, event: 'doing', steps: edits.map(e => e[0]) })
    const got = o.pcm.map(c => new Float32Array(c.length)), same = (from, to) => got.every((c, ch) => { for (let i = from; i < to; i++) if (Math.abs(c[i] - o.pcm[ch][i]) > 1e-6) return false; return true })
    let pos = lead, checked = false, end = n, w = s1, t = performance.now()
    for await (const block of a.stream({ at: lead / rate })) {
      const len = Math.min(block[0].length, n - pos)
      block.forEach((c, ch) => got[ch].set(c.subarray(0, len), pos))
      pos += len
      if (!checked && pos >= s0 + e) { if (s0 > 0 && !same(s0, s0 + e)) return null; checked = true }
      // past the range, the first window as it was is where it ends
      while (checked && w + e <= pos && w < n && !same(w, w + e)) w += e
      if (checked && w + e <= pos && w < n) { end = w; break }
      if (performance.now() - t > 20) { await new Promise(resolve => setTimeout(resolve)); if (newest !== r.id) return null; t = performance.now() }
    }
    const pcm = o.pcm.map((c, ch) => { const x = c.slice(); x.set(got[ch].subarray(s0, end), s0); return x })
    return { pcm, sampleRate: rate, markers: o.markers, regions: o.regions, bitDepth: r.instance.bitDepth ?? null }
  } finally { a.dispose?.() }
}
// The output's first `k` edits on its source, as the source arrives
function prefix(a, k) {
  const b = a.clone()
  b.undo(b.edits.length - k)
  return b
}
// A step reading its input whole first (its op's prepare: deepfilter's model over it, vocals' separation) is said by
// its name to the run streaming, while it does
const announced = new WeakSet()
function announce(edits) {
  for (const [type] of edits) {
    const d = audio.op(type)
    if (!d?.prepare || announced.has(d)) continue
    const prepare = d.prepare
    d.prepare = async (a, i) => {
      const id = newest
      post({ id, event: 'doing', step: type })
      try { return await prepare(a, i) } finally { post({ id, event: 'doing', step: null }) }
    }
    announced.add(d)
  }
}
// How long the output will be: known once its files have all arrived; until then what the first still arriving says
// it lasts, with how much of it has come
function expect(r) {
  if (r.based) return { total: r.based.instance.length }
  if (r.instance.decoded) return { total: r.instance.length }
  const src = r.names.map(n => sources.get(n)).find(s => s && !s.decoded), estimate = src?._.estDur ?? null
  return { total: estimate && Math.round(estimate * r.sampleRate), loaded: src?._.acc ? src._.acc.length / src.sampleRate : null, estimate }
}
// A file as it decodes, to the page, while the output has nothing yet; all of it come, and the output still nothing (a
// model running over it, a level read from all of it), `arrived`: what is left is the rendering
async function arriving(id, name, alive) {
  const src = sources.get(name)
  try {
    await relay(src.stream(), alive, (at, channels) => post({ id, event: 'loading', name, at, channels, sampleRate: src.sampleRate, estimate: src._.estDur ?? null }, channels.map(c => c.buffer)), () => src.sampleRate)
    if (alive()) post({ id, event: 'arrived', name })
  } catch {}   // the output's own stream says what went wrong
}
// A stream's blocks, joined into pieces of a tenth of a second or what came in 50 ms, handed to `send(at, channels)`
async function relay(blocks, alive, send, rate) {
  let parts = [], n = 0, at = 0, sent = performance.now()
  const flush = () => {
    if (!n) return
    const channels = parts[0].map((_, c) => { const x = new Float32Array(n); let o = 0; for (const p of parts) { x.set(p[c], o); o += p[c].length } return x })
    send(at, channels)
    at += n; parts = []; n = 0; sent = performance.now()
  }
  for await (const block of blocks) {
    if (!alive()) return
    parts.push(block)
    n += block[0].length
    if (n >= (rate() || 48000) / 10 || performance.now() - sent > 50) flush()
  }
  if (alive()) flush()
}
// An output's samples as they come, in arrays that double as they fill
function keep(r, at, channels) {
  r.sampleRate ||= r.instance.sampleRate
  const end = at + channels[0].length
  if (end * channels.length > PREVIEW_LIMIT)
    throw new RangeError(`The output is over ${(end / r.sampleRate / 60).toFixed(1)} minutes of ${channels.length} channels, longer than the page previews (30 channel-minutes at 48 kHz). Crop it here, or run the script with Node or the CLI.`)
  if (!r.pcm || r.pcm[0].length < end || r.pcm.length !== channels.length) {
    const size = Math.max(end, 2 * (r.pcm?.[0].length || 0))
    r.pcm = channels.map((_, c) => { const x = new Float32Array(size); if (r.pcm?.[c]) x.set(r.pcm[c].subarray(0, r.length)); return x })
  }
  channels.forEach((x, c) => r.pcm[c].set(x, at))
  r.length = end
}
const pcmOf = r => r.pcm ? r.pcm.map(c => c.subarray(0, r.length)) : []
// The output the page shows in tab `tab` once its newest has rendered: its newest that finished
async function settled(tab = null) {
  for (;;) {
    const r = [...outputs.values()].findLast(o => o.tab === tab)
    if (!r || r.done) return r ?? null
    await r.finished
  }
}

// The output's channels averaged to one.
const mixdown = r => r.mix ??= r.pcm.length === 1 ? pcmOf(r)[0] : pcmOf(r)[0].map((_, i) => r.pcm.reduce((s, c) => s + c[i], 0) / r.pcm.length)

// The output named by the run that made it, once whole; null once a newer output has replaced it
async function whole(output) {
  const r = outputs.get(output)
  if (r && !r.done) await r.finished
  return r?.done ? r : null
}

// Its pauses, as a text's spaces: under the level its quiet tenth sets (trim.js), 60 ms at least between sounds
const PAUSE = .06
const gaps = async (a, min) => a.duration ? (await a.silence({ minDuration: min })).map(g => [g.at, g.at + g.duration]) : []

// The output's cues, in seconds: points to snap to, slice at and warp by. `edges` (a voice's, a solo instrument's): where
// each sound starts and ends, the edges of the pauses between them, as words are found; each start where its attack
// starts (fn/hits.js), each end where the quiet begins, at most a block (23 ms) after the sound falls under the level.
// `hits` (drums, struck notes, gates): where the level jumps, up where an attack starts, down where a sound stops, read
// the same both ways, so a reversed sound's are its own mirrored (fn/hits.js). After a closing warp() they are the cues
// of the audio before it, where its markers take them: stretching makes none, though its smear can read as hits.
// Null for an output a newer one has replaced: the page reads cues against the code that made them.
const FIND = {
  hits,
  edges: (pcm, rate) => reading(pcm, rate, async a => {
    const quiet = await gaps(a, PAUSE), end = pcm[0].length / rate
    const starts = attacks(quiet.map(g => g[1]).filter(t => t < end), pcm, rate)
    return [...quiet.map(g => g[0]).filter(t => t > 0), ...starts].sort((p, q) => p - q)
  })
}
// `pcm` read as audio for `read`, let go after
async function reading(pcm, rate, read) {
  const a = audio.from(pcm, { sampleRate: rate })
  try { return await read(a) } finally { a.dispose?.() }
}
async function cues({ output, kind = 'edges' }) {
  const r = await whole(output)
  if (!r) return { times: null }
  if (!r.length) return { times: [] }
  r.cues ??= {}
  r.cues[kind] ??= await found(r, FIND[kind])
  return { times: r.cues[kind] }
}
async function found(r, find) {
  const warp = r.instance.edits?.at(-1)
  if (warp?.[0] !== 'warp') return find(pcmOf(r), r.sampleRate)
  const before = r.instance.clone()
  before.undo()
  try {
    const pcm = await before.read()
    return carry(await find(pcm, r.sampleRate), warp[1].markers, pcm[0].length / r.sampleRate)
  } finally { before.dispose?.() }
}
// Times before a warp() to where its markers put them: straight between markers; the start and the end stay, but a
// marker at the end moves it (fn/warp.js).
function carry(times, markers, end) {
  const points = [[0, 0], ...[...markers].map(m => [+m[0], +m[1]]).filter(([s]) => s > 0).sort((a, b) => a[0] - b[0])]
  if (points.at(-1)[0] < end) points.push([end, end])
  return times.map(t => {
    let i = 1
    while (i < points.length - 1 && points[i][0] < t) i++
    const [s0, d0] = points[i - 1], [s1, d1] = points[i]
    return d0 + (t - s0) * (d1 - d0) / (s1 - s0 || 1)
  })
}

// The output's pitch, the pitch curve the page draws: f0 in Hz every 10 ms, 0 where unvoiced or silent, the library's
// contour() (pYIN, as intonation() reads it) on the mono mix
async function contour({ output }) {
  const r = await whole(output)
  if (!r?.length) return { times: [], f0: [] }
  return r.contour ??= pitchOf(mixdown(r), r.sampleRate)
}

// What the output holds, as a musician says it (the status bar): the note over `note` [from, to] s, the tempo and key
// over `span`, each only where it is clear, else null.
// The note: the pitch curve's frames over the range (contour(), every 10 ms; the whole one if it was asked for), at most
// 2,000 (a median needs no more): past 20 s, a second at each of 20 places spread over it; where at least half are
// voiced: their median [f], or, if their middle half spans more than a semitone, a melody's
// compass, its 10th to 90th percentile [low, high]. Tempo (steadyTempo, the CLI's too: detect()'s spectral flux, within
// 1 BPM where stat('bpm') is 2 off, where the range and its halves agree within 4%, Gouyon et al. 2006) and key
// (stat('key') 'pcp': Krumhansl-Schmuckler over its chroma, one key over the range and its halves) only over 6 s at
// least, and over 3 minutes at most, so the reading (about 2 ms of work a second of sound, three times over) never holds
// up a run for long.
const STEADY = 6, MOST = 180, HEARD = 20
async function listen({ output, note, span }) {
  const r = await whole(output)
  if (!r?.length) return {}
  const rate = r.sampleRate, end = r.length / rate
  const [n0, n1] = [Math.max(0, note[0]), Math.min(end, note[1])], f0 = []
  if (r.contour) r.contour.times.forEach((t, i) => { if (t >= n0 && t <= n1) f0.push(r.contour.f0[i]) })
  else for (const [p, q] of n1 - n0 <= HEARD ? [[n0, n1]] : Array.from({ length: HEARD }, (_, k) => { const p = n0 + (n1 - n0 - 1) * k / (HEARD - 1); return [p, p + 1] }))
    f0.push(...pitchOf(mixdown(r).subarray(Math.round(p * rate), Math.round(q * rate)), rate).f0)
  const voiced = f0.filter(Boolean).sort((p, q) => p - q), at = q => voiced[Math.min(voiced.length - 1, Math.floor(q * voiced.length))]
  const pitch = voiced.length * 2 < f0.length || !voiced.length ? null : 1200 * Math.log2(at(.75) / at(.25)) > 100 ? [at(.1), at(.9)] : [at(.5)]
  const [a, b] = [Math.max(0, span[0]), Math.min(end, span[1])], key = `${a},${b}`
  r.heard ??= new Map()
  if (!r.heard.has(key)) r.heard.set(key, b - a < STEADY || b - a > MOST ? {} : await reading(pcmOf(r), rate, async x => {
    const half = (b - a) / 2, parts = [[a, b - a], [a, half], [a + half, half]].map(([at, duration]) => ({ at, duration }))
    const [bpm, keys] = await Promise.all([steadyTempo(x, parts[0]), Promise.all(parts.map(o => x.stat('key', { ...o, method: 'pcp' }).catch(() => null)))])
    return {
      bpm,
      key: keys[0] && keys[0].label !== 'N' && keys.every(k => k?.label === keys[0].label) ? { tonic: keys[0].tonic, mode: keys[0].mode } : null
    }
  }))
  return { pitch, ...r.heard.get(key) }
}

const CUTS = ['edl', 'otio', 'fcpxml']
// Encoded files: each save() the script made, as it says, or the output in one format, with the page's `options` for it
// (the library's encode options: a depth, a bitrate, a quality, no markers); or, with `parts`, each part of the output
// between its markers, named after the marker it starts at.
async function exporting({ format, name, parts, options = {}, tab }) {
  const r = await settled(tab)
  if (!r) throw new Error('Nothing to export yet.')
  // an edit list: the cuts, as text (the library's cuts())
  if (CUTS.includes(format)) return { files: [{ name: `${name}.${format}`, type: format, bytes: new TextEncoder().encode(await r.instance.cuts(format, options)) }] }
  if (parts) {
    const marks = r.instance.markers.filter(m => m.time > 0 && m.time < r.length / r.sampleRate), pieces = await r.instance.split(...marks.map(m => m.time))
    const label = (i, m) => (m?.label || `${String(i + 1).padStart(2, '0')}`).replace(/[^\w .-]+/g, '-')
    return { files: await Promise.all(pieces.map(async (p, i) => ({ name: `${name}-${label(i, marks[i - 1])}.${format}`, type: format, bytes: await p.encode(format, options) }))) }
  }
  const targets = r.saves.length ? r.saves : [{ instance: r.instance, name, opts: options }]
  const out = []
  for (const { instance, name, opts } of targets) {
    const type = (name.match(/\.(\w+)$/)?.[1] || format || 'wav').toLowerCase()
    out.push({ name: /\.\w+$/.test(name) ? name : `${name}.${type}`, type, bytes: await instance.encode(type, { ...opts, meta: opts?.meta }) })
  }
  return { files: out }
}

// Delivery checks (fn/check.js), the proof a chain meets a spec: the output, checked once per spec.
async function checking({ spec, tab }) {
  const r = await settled(tab)
  if (!r?.length) return { output: null }
  const flat = () => { const a = audio.from(pcmOf(r), { sampleRate: r.sampleRate }); return a.check(spec).finally(() => a.dispose?.()) }
  const checks = r.checks ??= {}
  try { return { output: await (checks[spec] ??= flat()) } }
  catch (error) { delete checks[spec]; throw error }
}

// The source as it opened, for listening against the output at the same place: a copy, at the output's loudness
// (BS.1770), so the comparison hears what the chain did, not that it is louder.
async function original({ source, loudness }) {
  const src = sources.get(source)
  if (!src) return { channels: null }
  const [pcm, own] = await Promise.all([src.read(), src.stat('loudness')])
  if (pcm[0].length * pcm.length > PREVIEW_LIMIT) return { channels: null }
  const gain = Number.isFinite(loudness) && Number.isFinite(own) ? loudness - own : 0, k = 10 ** (gain / 20)
  return { channels: pcm.map(c => c.map(v => v * k)), sampleRate: src.sampleRate, gain }
}

// What plays (player.js): an output (`output`, the run that made it), or the file it opened (`source`, at the output's
// `loudness`, as original() has it), as the page asks to hear it (heard.js): a band of it, its boxes, or a moment of it
// [from, to] through an edit, [type, ...args] (a pitch dragged). The page adopts it (audio/worker) and plays it, rendered
// here into the page's deck as it plays; it lets it go when done. Each a copy of one kept with the output, sharing its
// samples
const levels = new WeakMap()
async function voice({ output, source, loudness, ...as }) {
  let a
  if (source != null) {
    const src = sources.get(source)
    if (!src) return { inst: null }
    if (!levels.has(src)) levels.set(src, src.stat('loudness'))
    const own = await levels.get(src)
    a = src.clone().gain(Number.isFinite(loudness) && Number.isFinite(own) ? loudness - own : 0)
  } else {
    const r = await whole(output)
    if (!r) return { inst: null }
    a = (r.voice ??= audio.from(pcmOf(r), { sampleRate: r.sampleRate })).clone()
  }
  if (as.edit && !audio.op(as.edit[0])) await audio.use(as.edit[0])
  // its ops' modules loaded before the page reads it: a whole op (intonation) renders as its length is read
  const b = heard(a, as)
  await loadOps(b)
  return { inst: expose(b) }
}

// What an agent asks of the sound (the `measure` tool): `code`, prepared as a script is (code.js), runs on copies of the output
// shown (`out`, its markers) and of the file it opened (`src`), with the library, and changes nothing. What it measures on
// them is a value however the code reads it, awaited or not, in a callback, a sum or a loop (measuring): a run that read a
// measure before it was made, or never awaited one, runs again once all it asked for is made, each then answering at once.
// `step(i)` reads the edits (`steps`, as the page lists them, staged). Its value, awaited through, as JSON carries it;
// `measured`, what the last run measured, stat by stat ({ of: 'out' | 'src' | what step(i) read, name, opts, value }), for
// the page to say whatever shape the value takes
const RUNS = 1000
async function evaluate({ code, steps = [], tab }) {
  const r = await settled(tab), made = [], keep = a => (made.push(a), a), memo = []
  const run = new AsyncFunction('audio', 'out', 'src', 'step', '__loop', '__out', code + '\n//# sourceURL=repl.js')
  const base = r?.length ? keep(audio.from(pcmOf(r), { sampleRate: r.sampleRate })) : null, src = r && sources.get(r.names[0])
  try {
    // each run on copies of its own, which its edits change alone
    for (let n = 1; ; n++) {
      const out = base && keep(base.clone())
      if (out && r.markers?.length) out.markers = r.markers
      if (out && r.regions?.length) out.regions = r.regions
      const asked = { memo, at: 0, made: [], calls: [], short: false, waits: [] }, started = performance.now()
      const guard = () => { if (performance.now() - started > LOOP_LIMIT) throw new RangeError(`A loop ran for ${LOOP_LIMIT / 1000} s; stopped it.`) }
      let value, error = null
      try { value = await run(scoped(keep), measuring(out, 'out', asked), src ? measuring(keep(src.clone()), 'src', asked) : null, i => stepOf(steps, i, r, keep, asked), guard, x => new Out(x)) }
      catch (e) { error = e }
      if ((asked.short || asked.made.some(m => !m.awaited)) && n < RUNS) { await Promise.allSettled([...memo.map(m => m.promise), ...asked.waits]); continue }
      if (error) throw error
      if (value instanceof Out) value = value.value
      value = await settle(value)
      await Promise.allSettled(asked.calls.map(c => c.m.promise))
      const measured = asked.calls.filter(c => c.m.done && !c.m.error).map(({ m, j, ...c }) => ({ ...c, value: plain(j == null ? m.value : m.value?.[j]) }))
      return { value: plain(value), measured }
    }
  } finally { dispose(made) }
}
// An edit of the chain, as a measure reads it, `step(i)`, i its index in the page's steps (state's): its call, whether it
// is on; `before` and `after`, the sound as it enters it and as it leaves it, the chain rolled back to it as the Edits
// panel rolls back; `takes`, what it takes out, before less after, as its card's Δ (null where it changes the timing:
// before and after then don't line up); `where(t | { at, d })`, where a time or a range of the output was as the sound
// entered it, edits after it undone (null where it was not yet, or no longer, there). Times on before, after and takes
// are theirs. A stage not made yet stops the run, as a measure not made yet does, and the run goes again once it is.
function stepOf(steps, i, r, keep, asked) {
  const s = steps[i]
  if (!s) throw new RangeError(`No edit ${i}: the script has ${steps.length}${steps.length ? `, 0 to ${steps.length - 1}` : ''} (state's steps)`)
  const ready = script => {
    const got = staged(script)
    if (got.error) throw got.error
    if (got.value) return got.value
    asked.short = true; asked.waits.push(got.promise)
    throw new TypeError(`step(${i}) is still being made`)
  }
  const sound = (got, of) => {
    const a = keep(audio.from(got.pcm, { sampleRate: got.sampleRate }))
    if (got.markers?.length) a.markers = got.markers
    if (got.regions?.length) a.regions = got.regions
    return measuring(a, of, asked)
  }
  // both made at once: the one read first is seldom read alone
  const after = s.after ?? s.before
  staged(s.before), staged(after)
  return {
    call: s.call, on: s.on,
    get before() { return sound(ready(s.before), `before ${s.call}`) },
    get after() { return sound(ready(after), `after ${s.call}`) },
    get takes() {
      if (!s.keeps) return null
      const a = ready(s.before), b = ready(after), key = `${s.before.code}\0${after.code}`
      if (a.pcm[0]?.length !== b.pcm[0]?.length || a.pcm.length !== b.pcm.length) return null
      if (!stages.has(key)) stages.set(key, { value: { pcm: a.pcm.map((x, c) => x.map((v, k) => v - b.pcm[c][k])), sampleRate: a.sampleRate } })
      return sound(stages.get(key).value, `what ${s.call} takes out`)
    },
    where(at) {
      const got = ready(s.before), key = `${got.edits}:${JSON.stringify(at)}`
      if (!r?.instance) return null
      const places = r.places ??= new Map()
      if (!places.has(key)) places.set(key, placed(r.instance, at, got.edits))
      return places.get(key)
    }
  }
}
// `at`, a time or a range { at, d } of `full`'s output, where it was after its first `n` edits: marked on a copy, the
// edits after them undone, the mark kept to what it marked (fn/meta.js); a range's pieces as one span
function placed(full, at, n) {
  const range = at && typeof at === 'object', copy = full.clone(), label = '\u0000where'
  try {
    copy.mark(range ? { at: +at.at, duration: +(at.d ?? at.duration) } : +at, label)
    copy.undo(Math.max(0, copy.edits.length - n))
    if (!range) return copy.markers.find(m => m.label === label)?.time ?? null
    const pieces = copy.regions.filter(g => g.label === label)
    if (!pieces.length) return null
    const from = Math.min(...pieces.map(g => g.at)), to = Math.max(...pieces.map(g => g.at + g.duration))
    return { at: from, d: to - from }
  } finally { copy.dispose?.() }
}

// The stages step(i) reads, by their script: each made once as a run makes its output (made: from the longest of its starts
// kept, then kept with them), its samples kept with
// its markers and how many edits it has (and what a step takes out, by the pair it is the difference of); the oldest let go
// once they hold more than STAGED samples, all of them when a file changes. { value } once made, { error } if it failed,
// else { promise }
const STAGED = PREVIEW_LIMIT / 2
const stages = new Map()
function staged(script) {
  let s = stages.get(script.code)
  if (s) { stages.delete(script.code); stages.set(script.code, s); return s }
  s = { promise: null }
  s.promise = render(script).then(value => { s.value = value }, error => { s.error = error })
  stages.set(script.code, s)
  return s
  async function render({ code, names = [] }) {
    const created = [], track = a => (created.push(a), a), started = performance.now()
    const guard = () => { if (performance.now() - started > LOOP_LIMIT) throw new RangeError(`A loop ran for ${LOOP_LIMIT / 1000} s; stopped it.`) }
    try {
      for (const name of names) open(name)
      let a = await new AsyncFunction('audio', 'console', 'files', '__loop', '__out', code + '\n//# sourceURL=repl.js')(scoped(track), QUIET, [...files.keys()], guard, out)
      if (a instanceof Out) a = a.value
      if (!isAudio(a)) a = created.findLast(x => !x._?.disposed)
      if (!isAudio(a)) throw new Error('No sound at this edit')
      const { pcm, sampleRate, markers, regions } = await made(a)
      let total = pcm.length * (pcm[0]?.length ?? 0)
      for (const [k, v] of [...stages].reverse()) if (v.value && (total += v.value.pcm.length * (v.value.pcm[0]?.length ?? 0)) > STAGED) stages.delete(k)
      return { pcm, sampleRate, markers, regions, edits: a.edits.length }
    } finally { dispose(created) }
  }
}
const QUIET = Object.fromEntries(['log', 'info', 'debug', 'warn', 'error', 'table'].map(k => [k, () => {}]))

// A sound whose calls that answer later (a stat, silence(), detect(), read()…) are kept in `asked.memo` by their place in
// the run and what they asked: made once, such a call answers its value at once on the runs after, or a promise of it
// where the code took it as one (awaited, or .then). First made, it answers a promise, which read before it settles
// (`out.stat('melody').f0`, a sum, a loop over it) stops the run; one that failed throws its error where it is read. A
// measure's arrays are plain, as its answer shows them (a typed one maps to numbers alone), and stat([…]) answers each
// value by its name too, `.rms`, as a RegExp match carries `.index`. Each stat by its name (a list of them, each),
// silence() and detect() are noted in `asked.calls`.
const MEASURES = new Set(['stat', 'silence', 'detect']), THEN = new Set(['then', 'catch', 'finally'])
function measuring(a, of, asked) {
  if (!a) return a
  return new Proxy(a, {
    get(t, k) {
      const v = Reflect.get(t, k, t)
      if (typeof v !== 'function') return v
      if (THEN.has(k)) return v.bind(t)
      return (...args) => {
        const said = `${of}.${String(k)}(${args.filter(x => x !== undefined).map(shown).join(', ')})`, i = asked.at++
        let m = asked.memo[i]?.said === said ? asked.memo[i] : null
        if (!m) {
          const x = v.apply(t, args)
          if (!(x instanceof Promise)) return x
          const p = MEASURES.has(k) ? x.then(y => k === 'stat' && Array.isArray(args[0]) ? byName(arrays(y), args[0]) : arrays(y)) : x
          m = asked.memo[i] = { said, promise: p }
          m.promise.then(value => Object.assign(m, { done: true, value }), error => Object.assign(m, { done: true, error }))
          asked.made.push(m)
        }
        if (MEASURES.has(k)) note(asked.calls, of, k, args, m)
        return m.done && !m.error && !m.awaited ? m.value : later(m, asked)
      }
    }
  })
}
// A call not answered yet: a promise to await, which read before it settles stops the run (evaluate runs it again), and
// once failed throws its error. Its words, should the runs run out: what to write instead
const later = (m, asked) => new Proxy(m.promise, {
  get(t, k) {
    if (THEN.has(k)) return m.awaited = true, t[k].bind(t)
    if (m.error) throw m.error
    m.awaited = false, asked.short = true
    throw new TypeError(`${m.said} is a promise: await it first, (await ${m.said})${typeof k === 'symbol' ? '' : /^\d+$/.test(k) ? `[${k}]` : `.${k}`}`)
  }
})
const note = (calls, of, k, args, m) => {
  const [name, opts] = k === 'stat' ? args : [k, args[0]]
  if (Array.isArray(name)) name.forEach((n, j) => calls.push({ of, name: n, opts: where(opts), m, j }))
  else calls.push({ of, name, opts: where(opts), m })
}
// an argument as the call's words say it: a sound by what it is, samples by how many
const shown = x => { try { return JSON.stringify(x, (k, v) => v instanceof Promise ? 'a promise' : isAudio(v) ? 'audio' : ArrayBuffer.isView(v) ? `${v.length} samples` : v)?.replace(/"/g, "'") ?? String(x) } catch { return '…' } }
// stat([names]) answers by position; its values by name too, where a name is no array's own (`length`)
const byName = (list, names) => Object.assign(list, Object.fromEntries(names.map((n, i) => [n, list[i]]).filter(([n]) => typeof n === 'string' && !(n in list))))
// A value with its typed arrays plain, through arrays and plain objects
function arrays(v, depth = 0) {
  if (ArrayBuffer.isView(v) && !(v instanceof DataView)) return Array.from(v)
  if (depth > 12 || v == null || typeof v !== 'object') return v
  if (Array.isArray(v)) return v.map(x => arrays(x, depth + 1))
  return Object.getPrototypeOf(v) === Object.prototype ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, arrays(x, depth + 1)])) : v
}
// where a stat was taken: its range, its bins, its channel
const where = (o = {}) => o && typeof o === 'object' ? Object.fromEntries(['at', 'd', 'duration', 'bins', 'channel'].filter(k => o[k] != null).map(k => [k, o[k]])) : {}
// A value with every promise in it awaited, through arrays and plain objects
async function settle(v, depth = 0) {
  if (v instanceof Promise || v && typeof v.then === 'function' && !isAudio(v)) v = await v
  if (depth > 12 || v == null || typeof v !== 'object' || isAudio(v) || ArrayBuffer.isView(v)) return v
  if (Array.isArray(v)) return Promise.all(v.map(x => settle(x, depth + 1)))
  if (Object.getPrototypeOf(v) !== Object.prototype) return v
  return Object.fromEntries(await Promise.all(Object.entries(v).map(async ([k, x]) => [k, await settle(x, depth + 1)])))
}
// A value as JSON carries it: arrays whole, typed or not, numbers to 7 digits, those JSON has no word for as text (an
// output's silence is -Infinity dB); a sound, what it is
function plain(v, depth = 0) {
  if (typeof v === 'number') return Number.isInteger(v) ? v : Number.isFinite(v) ? +v.toPrecision(7) : String(v)
  if (typeof v === 'bigint') return String(v)
  if (v == null || typeof v !== 'object') return typeof v === 'function' ? undefined : v
  if (depth > 12) return null
  if (isAudio(v)) return { duration: v.duration, channels: v.channels, sampleRate: v.sampleRate }
  if (ArrayBuffer.isView(v) || Array.isArray(v)) return Array.from(v, x => plain(x, depth + 1) ?? null)
  if (v instanceof Map) v = Object.fromEntries(v)
  if (v instanceof Error) return { error: v.message }
  return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, plain(x, depth + 1)]))
}

// A plugin's parameters, from its manifest; null for built-in ops and unknown names.
async function describe({ name }) {
  if (!audio.plugins[name]) return { params: null }
  if (!audio.op(name)) await audio.use(name)
  const op = audio.op(name)
  const spec = op?.plugin?.params || op?.atom?.params || null
  return { params: spec && JSON.parse(JSON.stringify(spec)) }
}

const handlers = {
  // a file changed: what was made of it goes
  file: ({ name, data }) => {
    const was = sources.get(name)
    if (was) for (const k of kept.keys()) if (k.startsWith(`${idOf(was)}|`)) kept.delete(k)
    data ? files.set(name, data) : files.delete(name); forget(name); stages.clear(); return {}
  },
  run: execute, cues, contour, listen, export: exporting, describe, check: checking, original, voice, eval: evaluate,
  // a tab closed: its output goes
  close: ({ tab }) => { for (const r of outputs.values()) if (r.tab === tab) drop(r); return {} },
  // a script's sound whole, as the edits make it there (the chain flattened up to a step): from the renders kept, as a
  // step(i) is made, its markers with it
  bake: async script => {
    const s = staged(script)
    await s.promise
    if (s.error) throw s.error
    const { pcm, sampleRate, markers, regions } = s.value
    return { channels: pcm.map(c => c.slice()), sampleRate, markers, regions }
  }
}
self.onmessage = async ({ data }) => {
  let reply
  try { reply = await handlers[data.type](data) }
  catch (error) { reply = { error: failure(error) } }
  const transfer = data.type === 'original' || data.type === 'bake' ? reply.channels?.map(c => c.buffer) : data.type === 'export' ? reply.files?.map(f => f.bytes.buffer) : []
  post({ id: data.id, ...reply }, transfer || [])
}
