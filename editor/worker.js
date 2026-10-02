// The editor's engine, in a worker: it runs scripts against the audio library, so a long render or a runaway
// script never freezes the page. Built with the library into editor/dist/ (node .site-build.js).
// A file starts decoding when a script first names it, and the script runs at once, on a copy that follows the file
// as it arrives (clone). The output streams to the page as it renders; while a file arrives and the output has
// nothing yet (it needs the whole file, as trim and normalize do), the file itself streams, as it decodes.
import audio from '../audio.js'
import plugins from 'editor:plugins'
import { attacks, hits } from '../fn/hits.js'
import { steadyTempo } from '../fn/beat.js'
import { contour as pitchOf } from '../fn/pitch-detect.js'

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
    record.rebased = rebased(record)
    if (record.rebased) record.created.push(record.rebased)
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

// A run whose script is the last output's with calls added after it (an edit made on the picture, a recipe, a step
// typed at the end) renders those calls on the last output's samples, not the whole script again from its sources:
// what they leave as it was passes through block by block, only what they change is processed (a ranged op copies the
// rest), so an edit lands at once wherever it is. The same source, the same edits before them (`sig`); anything else,
// or anything it cannot say is the same (a function, samples made in the script), renders whole, as before. The
// script's markers must be the last one's (a marker added renders whole); the output's are then the last output's,
// moved by the calls as they move the audio. Its length, its markers and its samples come from this; the script's own
// instance, unrendered, still says what else it holds (its cuts, its depth).
function rebased(r) {
  const b = [...outputs.values()].findLast(o => o.done && o !== r), root = roots.get(r.instance)
  if (!b || !root || roots.get(b.instance) !== root || b.names.join() !== r.names.join()) return null
  const was = b.instance.edits, now = r.instance.edits, marks = a => (a.meta, JSON.stringify(a._.markers ?? []))
  if (now.length < was.length || was.some((e, i) => sig(e) !== sig(now[i])) || [...was, ...now].some(e => sig(e) == null) || marks(b.instance) !== marks(r.instance)) return null
  try {
    const a = audio.from(pcmOf(b), { sampleRate: b.sampleRate })
    if (b.markers.length) a.markers = b.markers
    return a.run(...now.slice(was.length).map(([type, opts]) => [type, opts ? { ...opts } : {}]))
  } catch { return null }
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
    await relay((r.rebased ?? r.instance).stream(), alive, (at, channels) => {
      first = true
      keep(r, at, channels)
      post({ id: r.id, event: 'chunk', at, channels, sampleRate: r.sampleRate, ...expect(r) }, channels.map(c => c.buffer))
    }, () => r.instance.sampleRate)
    if (!alive()) return
    const pcm = pcmOf(r), length = r.length, sampleRate = r.sampleRate || r.instance.sampleRate
    const flat = audio.from(pcm.length ? pcm : [new Float32Array(0)], { sampleRate })
    const [peak, rms, loudness, clipped] = length ? await flat.stat(['db', 'rms', 'loudness', 'clipping']) : [-Infinity, 0, -Infinity, []]
    // where it clips: the blocks with a sample at full scale or past it (stat('clipping')), runs of them as [from, to] s
    const block = audio.BLOCK_SIZE / sampleRate, clips = []
    for (const t of clipped) clips.at(-1)?.[1] >= t - 1e-9 ? clips.at(-1)[1] = t + block : clips.push([t, t + block])
    const segments = { silences: await gaps(flat, PAUSE) }
    flat.dispose?.()
    if (!alive()) return
    r.done = true
    r.stats = { peak, rms, loudness }
    for (const o of outputs.values()) if (o !== r) drop(o)
    // its markers (mark()), where its edits put them
    const markers = r.markers = (r.rebased ?? r.instance).markers.filter(m => m.time <= length / sampleRate).map(({ time, label }) => ({ time, label }))
    post({ id: r.id, event: 'done', duration: length / sampleRate, sampleRate, channels: pcm.length, stats: r.stats, segments, markers, clips, bitDepth: r.instance.bitDepth ?? null })
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
  if (r.rebased) return { total: r.rebased.length }
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
async function exporting({ format, name, parts, options = {} }) {
  const r = await settled()
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
async function checking({ spec }) {
  const r = await settled()
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

// What an agent asks of the sound (the `measure` tool): `code`, prepared as a script is (code.js), runs on copies of the output
// shown (`out`, its markers) and of the file it opened (`src`), with the library, and changes nothing; its value, awaited,
// as JSON carries it
async function evaluate({ code }) {
  const r = await settled(), made = [], keep = a => (made.push(a), a)
  const out = r?.length ? keep(audio.from(pcmOf(r), { sampleRate: r.sampleRate })) : null, src = r && sources.get(r.names[0])
  if (out && r.markers?.length) out.markers = r.markers
  const started = performance.now()
  const guard = () => { if (performance.now() - started > LOOP_LIMIT) throw new RangeError(`A loop ran for ${LOOP_LIMIT / 1000} s; stopped it.`) }
  try {
    let value = await new AsyncFunction('audio', 'out', 'src', '__loop', '__out', code + '\n//# sourceURL=repl.js')(scoped(keep), out, src ? keep(src.clone()) : null, guard, x => new Out(x))
    if (value instanceof Out) value = value.value
    if (value && typeof value.then === 'function' && !isAudio(value)) value = await value
    return { value: plain(value) }
  } finally { dispose(made) }
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
  file: ({ name, data }) => { data ? files.set(name, data) : files.delete(name); forget(name); return {} },
  run: execute, cues, contour, listen, export: exporting, describe, check: checking, original, eval: evaluate
}
self.onmessage = async ({ data }) => {
  let reply
  try { reply = await handlers[data.type](data) }
  catch (error) { reply = { error: failure(error) } }
  const transfer = data.type === 'original' ? reply.channels?.map(c => c.buffer) : data.type === 'export' ? reply.files?.map(f => f.bytes.buffer) : []
  post({ id: data.id, ...reply }, transfer || [])
}
