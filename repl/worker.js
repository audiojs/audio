// The REPL's engine, in a worker: it runs scripts against the audio library, so a long render or a runaway
// script never freezes the page. Built with the library into repl/dist/ (node .site-build.js).
// A file starts decoding when a script first names it, and the script runs at once, on a copy that follows the file
// as it arrives (clone). The output streams to the page as it renders; while a file arrives and the output has
// nothing yet (it needs the whole file, as trim and normalize do), the file itself streams, as it decodes.
import audio from '../audio.js'
import plugins from 'repl:plugins'
import { yin } from '@audio/pitch'
import reassign from './reassign.js'

// Registry plugins load from their chunks: the build writes one literal import per plugin.
audio.import = spec => plugins[spec]?.() ?? import(spec)

const AsyncFunction = (async () => {}).constructor
const LOOP_LIMIT = 5000
// The longest output the page holds as samples (it keeps a few copies): 30 channel-minutes at 48 kHz.
const PREVIEW_LIMIT = 30 * 60 * 48000

const files = new Map()        // virtual file name → Blob, or { channels, sampleRate } for generated audio
const sources = new Map()      // name → its instance, arriving or arrived; never edited: every run edits a clone
const outputs = new Map()      // run id → its output as it streams: { instance, pcm, length, sampleRate, done, … }
let run = null                 // the script running now: { created, saves }
let newest = 0                 // the run whose output streams: older streams stop

// Script calls that reach outside the page become REPL actions: save() marks an export for the Export button,
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
  throw Object.assign(new Error(`${name} is not open. Drop the file on the page or open it.`), { missing: name })
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

// `audio` as scripts see it: a named source opens from the page's files, and each run edits its own copy.
const track = a => (run?.created.push(a), a)
const api = new Proxy(function audio_(source, opts) {
  if (typeof source === 'string' && !opts) return track(open(source).clone())
  if (Array.isArray(source) && source.some(s => typeof s === 'string')) return track(audio(source.map(s => typeof s === 'string' ? api(s) : s), opts))
  return track(audio(source, opts))
}, {
  get: (target, key) => key === 'from' ? (...args) => track(audio.from(...args)) : audio[key]
})

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

// Runs a script: the reply says what it printed and whether it made a sound; the sound then streams (render).
async function execute({ id, code, names = [] }) {
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
    if (!output) { for (const r of outputs.values()) drop(r); dispose(run.created); return result }
    const record = { id, instance: output, created: run.created, saves: run.saves, names, pcm: null, length: 0, sampleRate: 0, done: false }
    record.finished = new Promise(resolve => { record.finish = resolve })
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
  r.finish(null)
}

const post = (message, transfer = []) => self.postMessage(message, transfer)

// A run's output to the page as it renders, in pieces of about a tenth of a second, then its figures. While the files
// it opens are still arriving and it has nothing of its own yet, the first of them streams as it decodes.
async function render(r) {
  // the run's reply goes first
  await new Promise(resolve => setTimeout(resolve))
  const alive = () => newest === r.id
  const name = r.names.find(n => sources.has(n) && !sources.get(n).decoded)
  let first = false
  if (name) arriving(r.id, name, () => alive() && !first)
  try {
    await relay(r.instance.stream(), alive, (at, channels) => {
      first = true
      keep(r, at, channels)
      post({ id: r.id, event: 'chunk', at, channels, sampleRate: r.sampleRate, ...expect(r) }, channels.map(c => c.buffer))
    }, () => r.instance.sampleRate)
    if (!alive()) return
    const pcm = pcmOf(r), length = r.length, sampleRate = r.sampleRate || r.instance.sampleRate
    const flat = audio.from(pcm.length ? pcm : [new Float32Array(0)], { sampleRate })
    const [peak, rms, loudness] = length ? await flat.stat(['db', 'rms', 'loudness']) : [-Infinity, 0, -Infinity]
    // its pauses, as a text's spaces and line breaks: under the level its quiet tenth sets (trim.js), 60 ms between
    // sounds, 250 ms between phrases (a speaker's breath)
    const gaps = async min => length ? (await flat.silence({ minDuration: min })).map(g => [g.at, g.at + g.duration]) : []
    const segments = { silences: await gaps(.06), pauses: await gaps(.25) }
    flat.dispose?.()
    if (!alive()) return
    r.done = true
    r.stats = { peak, rms, loudness }
    for (const o of outputs.values()) if (o !== r) drop(o)
    // its markers (mark()), where its edits put them
    const markers = r.instance.markers.filter(m => m.time <= length / sampleRate).map(({ time, label }) => ({ time, label }))
    post({ id: r.id, event: 'done', duration: length / sampleRate, sampleRate, channels: pcm.length, stats: r.stats, segments, markers, bitDepth: r.instance.bitDepth ?? null })
    r.finish(r)
  } catch (error) {
    if (!alive()) return
    const failed = r.names.find(n => !sources.has(n))
    post({ id: r.id, event: 'error', error: failure(failed ? opening(failed, error) : error) })
    drop(r)
  }
}
// How long the output will be: known once its files have all arrived; until then what the first still arriving says
// it lasts, with how much of it has come
function expect(r) {
  if (r.instance.decoded) return { total: r.instance.length }
  const src = r.names.map(n => sources.get(n)).find(s => s && !s.decoded), estimate = src?._.estDur ?? null
  return { total: estimate && Math.round(estimate * r.sampleRate), loaded: src?._.acc ? src._.acc.length / src.sampleRate : null, estimate }
}
// A file as it decodes, to the page, while the output has nothing yet
async function arriving(id, name, alive) {
  const src = sources.get(name)
  try {
    await relay(src.stream(), alive, (at, channels) => post({ id, event: 'loading', name, at, channels, sampleRate: src.sampleRate, estimate: src._.estDur ?? null }, channels.map(c => c.buffer)), () => src.sampleRate)
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
// The output the page shows once the newest has rendered: the newest that finished
async function settled() {
  for (;;) {
    const r = [...outputs.values()].at(-1)
    if (!r || r.done) return r ?? null
    await r.finished
  }
}

// The output's channels averaged to one.
const mixdown = r => r.mix ??= r.pcm.length === 1 ? pcmOf(r)[0] : pcmOf(r)[0].map((_, i) => r.pcm.reduce((s, c) => s + c[i], 0) / r.pcm.length)

// Spectrograms of an output's channels between two sample offsets: `columns` frames by `rows` frequencies spaced
// evenly on a `scale` (scale.js) from `low` to `high` Hz (by default its floor to Nyquist), dB from -100 to 0 as bytes.
// Reassigned (reassign.js): each cell's energy moves to where its phase places it, so a full-scale sine reads about
// 0 dB on a line one row thin. `peak` is the loudest byte, which the picture draws as white. While the output still
// arrives, the frames whose samples are all in; asked again, the new frames are added to them.
function spectrum({ output, from, to, columns, rows = 512, scale = 'log', low, high, size = 2048 }) {
  const r = outputs.get(output)
  if (!r?.length) return { channels: [], columns, rows, peak: 0 }
  const key = [from, to, columns, rows, scale, low, high, size].join()
  const frames = r.frames?.key === key ? r.frames : r.frames = { key, power: r.pcm.map(() => new Float32Array(columns * rows)), next: 0 }
  const step = (to - from) / columns, all = r.done ? columns : Math.max(0, Math.min(columns, Math.floor((r.length - size / 2 - from) / step - .5) + 1))
  if (all > frames.next) {
    pcmOf(r).forEach((pcm, c) => reassign(pcm, { from, to, columns, rows, scale, low, high, size, sampleRate: r.sampleRate, cols: [frames.next, all], out: frames.power[c] }))
    frames.next = all
  }
  let peak = 0
  const channels = frames.power.map(power => {
    const bytes = new Uint8Array(power.length)
    for (let i = 0; i < power.length; i++) { const b = bytes[i] = Math.max(0, Math.min(255, Math.round((10 * Math.log10(power[i] + 1e-12) + 100) / 100 * 255))); if (b > peak) peak = b }
    return bytes
  })
  return { channels, columns, rows, peak, ready: all }
}

// Where the output's hits start, in seconds: cue points for warping. After a closing warp() they are the hits of
// the audio before it, where its markers take them: stretching makes no hits, though its smear can read as some.
async function onsets() {
  const r = await settled()
  if (!r?.length) return { times: [] }
  r.onsets ??= await hits(r)
  return { times: r.onsets }
}
async function hits(r) {
  const found = async pcm => [...await audio.from(pcm, { sampleRate: r.sampleRate }).stat('onsets')]
  const warp = r.instance.edits?.at(-1)
  if (warp?.[0] !== 'warp') return found(pcmOf(r))
  const before = r.instance.clone()
  before.undo()
  try {
    const pcm = await before.read()
    return carry(await found(pcm), warp[1].markers, pcm[0].length / r.sampleRate)
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

// The output's pitch: f0 in Hz every 10 ms, 0 where unvoiced or silent. YIN (de Cheveigné & Kawahara 2002) on the
// mono mix at about 11 kHz: averaging four samples before dropping three keeps voices, whose pitch stays under 1 kHz.
async function contour() {
  const r = await settled()
  if (!r?.length) return { times: [], f0: [] }
  if (r.contour) return r.contour
  const x = mixdown(r), d = Math.max(1, Math.floor(r.sampleRate / 11025)), fs = r.sampleRate / d
  const y = new Float32Array(Math.floor(x.length / d))
  for (let i = 0; i < y.length; i++) { let s = 0; for (let j = 0; j < d; j++) s += x[i * d + j]; y[i] = s / d }
  const size = 512, hop = Math.round(fs / 100), times = [], f0 = []
  for (let s = 0; s + size <= y.length; s += hop) {
    const frame = y.subarray(s, s + size)
    let power = 0
    for (const v of frame) power += v * v
    const p = power / size > 1e-6 ? yin(frame, { fs, minFreq: 60, maxFreq: 1000 }) : null
    times.push((s + size / 2) / fs)
    f0.push(p && p.clarity > .6 ? p.freq : 0)
  }
  return r.contour = { times: Float32Array.from(times), f0: Float32Array.from(f0) }
}

// Encoded files: each save() the script made, or the output in one format; or, with `parts`, each part of the output
// between its markers, named after the marker it starts at.
async function exporting({ format, name, parts }) {
  const r = await settled()
  if (!r) throw new Error('Nothing to export yet.')
  if (parts) {
    const marks = r.instance.markers.filter(m => m.time > 0 && m.time < r.length / r.sampleRate), pieces = await r.instance.split(...marks.map(m => m.time))
    const label = (i, m) => (m?.label || `${String(i + 1).padStart(2, '0')}`).replace(/[^\w .-]+/g, '-')
    return { files: await Promise.all(pieces.map(async (p, i) => ({ name: `${name}-${label(i, marks[i - 1])}.${format}`, type: format, bytes: await p.encode(format) }))) }
  }
  const targets = r.saves.length ? r.saves : [{ instance: r.instance, name }]
  const out = []
  for (const { instance, name, opts } of targets) {
    const type = (name.match(/\.(\w+)$/)?.[1] || format || 'wav').toLowerCase()
    out.push({ name: /\.\w+$/.test(name) ? name : `${name}.${type}`, type, bytes: await instance.encode(type, { ...opts, meta: opts?.meta }) })
  }
  return { files: out }
}

// Delivery checks (fn/check.js), the proof a chain meets a spec: the output, and the source it opened as it was
// before any edit. Each output and each source is checked once per spec.
const sourceChecks = new WeakMap()
async function checking({ spec, source }) {
  const r = await settled()
  if (!r?.length) return { output: null, input: null }
  const flat = () => { const a = audio.from(pcmOf(r), { sampleRate: r.sampleRate }); return a.check(spec).finally(() => a.dispose?.()) }
  const checks = r.checks ??= {}, src = source && sources.get(source)
  const inputs = src && (sourceChecks.get(src) || sourceChecks.set(src, {}).get(src))
  try { return { output: await (checks[spec] ??= flat()), input: src ? await (inputs[spec] ??= src.check(spec)) : null } }
  catch (error) { delete checks[spec]; if (inputs) delete inputs[spec]; throw error }
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

// A plugin's parameters, from its manifest; null for built-in ops and unknown names.
async function describe({ name }) {
  if (!audio.plugins[name]) return { params: null }
  if (!audio.op(name)) await audio.use(name)
  const op = audio.op(name)
  const spec = op?.plugin?.params || op?.atom?.params || null
  return { params: spec && JSON.parse(JSON.stringify(spec)) }
}

const handlers = {
  file: ({ name, data }) => { data ? files.set(name, data) : files.delete(name); forget(name); return {} },
  run: execute, spectrum, onsets, contour, export: exporting, describe, check: checking, original
}
self.onmessage = async ({ data }) => {
  let reply
  try { reply = await handlers[data.type](data) }
  catch (error) { reply = { error: failure(error) } }
  const transfer = data.type === 'spectrum' || data.type === 'original' ? reply.channels?.map(c => c.buffer) : data.type === 'export' ? reply.files?.map(f => f.bytes.buffer) : []
  post({ id: data.id, ...reply }, transfer || [])
}
