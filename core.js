/**
 * audio core — paged audio container with plugin architecture.
 *
 * audio.fn       — instance prototype (like $.fn)
 * audio.stat     — stat descriptor registration/query (block, reduce, query)
 * audio.use      — plugin registration
 */

import decode from '@audio/decode'
import getType from 'audio-type'
import encode from '@audio/encode'
import convert, { parse as parseFmt } from 'pcm-convert'
import parseDuration from 'parse-duration'

audio.version = '2.6.1'

/** Parse time value: number passthrough, string via parse-duration or timecode. */
export function parseTime(v) {
  if (v == null) return v
  if (typeof v === 'number') { if (!Number.isFinite(v)) throw new Error(`Invalid time: ${v}`); return v }
  // Timecode: HH:MM:SS.mmm, MM:SS.mmm, or MM:SS
  let tc = v.match(/^(\d+):(\d{1,2})(?::(\d{1,2}))?(?:\.(\d+))?$/)
  if (tc) {
    let [, a, b, c, frac] = tc
    let s = c != null ? +a * 3600 + +b * 60 + +c : +a * 60 + +b
    if (frac) s += +('0.' + frac)
    return s
  }
  let s = parseDuration(v, 's')
  if (s != null && isFinite(s)) return s
  throw new Error(`Invalid time: ${v}`)
}


// ── Entry Points ─────────────────────────────────────────────────────────

/** Create audio from any source. Sync — returns instance immediately.
 *  Thenable: `await audio('file.mp3')` waits for full decode.
 *  Edits can be chained before decode completes. */
export default function audio(source, opts = {}) {
  // Worker-hosted engine — same call shape, runs in a Worker (import 'audio/worker' enables it)
  if (opts.worker) {
    let aw = globalThis[Symbol.for('audio.worker')]
    if (!aw) throw new Error('audio: { worker } requires `import "audio/worker"` first — the worker facade stays out of the main bundle')
    return aw(source, opts)
  }
  // No source → pushable instance (tape recorder — push, record, stop)
  if (source == null) {
    let sr = opts.sampleRate || 44100, ch = opts.channels || 1
    let waiters = []
    let notify = () => { for (let w of waiters.splice(0)) w(); scheduleEvict(a) }
    let a = create([], sr, ch, 0, opts, null)
    a.decoded = false
    a.recording = false
    a._.push = true  // marks this instance as pushable — only these finalize on stop()
    a._.acc = pageAccumulator({ pages: a.pages, notify, ondata: (...args) => emit(a, 'data', ...args) })
    a._.waiters = waiters
    return a
  }
  // Restore from serialized document
  if (source && typeof source === 'object' && !Array.isArray(source) && source.edits) {
    if (!source.source) throw new TypeError('audio: cannot restore document without source reference')
    let a = audio(source.source, opts)
    if (a.run) for (let e of source.edits) a.run(e)
    return a
  }
  // Concat from array of sources
  if (Array.isArray(source) && source.length && !(source[0] instanceof Float32Array)) {
    let instances = source.map(s => s?.pages ? s : audio(s, opts))
    let first = instances[0].clip ? instances[0].clip() : audio.from(instances[0])
    if (!first.insert) throw new Error('audio([...]): concat requires insert plugin — import "audio" instead of "audio/core.js"')
    let xf = opts?.crossfade
    for (let i = 1; i < instances.length; i++) {
      let d = Array.isArray(xf) ? xf[i - 1] : xf
      if (d && first.crossfade) first.crossfade(instances[i], d, opts?.curve)
      else first.insert(instances[i])
    }
    let loading = instances.filter(s => !s.decoded)
    if (loading.length) {
      first.ready = Promise.all(loading.map(s => s.ready)).then(() => { delete first.then; delete first.catch; return true })
      first.ready.catch(e => emit(first, 'error', e))
      makeThenable(first)
    }
    return first
  }
  // From AudioBuffer
  if (source?.getChannelData && source?.numberOfChannels) return audio.from(source, opts)
  // From PCM arrays or silence duration
  if (Array.isArray(source) && source[0] instanceof Float32Array || typeof source === 'number') {
    let a = audio.from(source, opts)
    if (audio.evict && a.cache && a.budget !== Infinity) {
      a.ready = audio.evict(a).then(() => { delete a.then; delete a.catch; return true })
      a.ready.catch(e => emit(a, 'error', e))
      makeThenable(a)
    }
    return a
  }
  // From encoded source (file, URL, buffer)
  let ref = typeof source === 'string' ? source : source instanceof URL ? source.href : null
  let pages = [], waiters = []
  let notify = () => { for (let w of waiters.splice(0)) w(); scheduleEvict(a) }
  // 'data' must not be observable before 'metadata' — queue until metadata fires, then flush in order.
  let dataQueue = [], metaEmitted = false
  let emitData = (...args) => metaEmitted ? emit(a, 'data', ...args) : dataQueue.push(args)
  let a = create(pages, 0, 0, 0, { ...opts, source: ref }, null)
  a._.waiters = waiters
  a.decoded = false

  let readyResolve, readyReject
  a._.ready = new Promise((r, j) => { readyResolve = r; readyReject = j })
  a._.ready.catch(() => {})  // suppress unhandled rejection

  a.ready = (async () => {
    try {
      if (opts.storage === 'persistent') {
        if (!audio.opfsCache) throw new Error('Persistent storage requires cache module (import "./cache.js")')
        try { opts = { ...opts, cache: await audio.opfsCache(), budget: opts.budget ?? await audio.detectBudget?.() ?? audio.DEFAULT_BUDGET ?? Infinity } }
        catch { throw new Error('OPFS not available (required by storage: "persistent")') }
        if (a._.disposed) return true
        a.cache = opts.cache
        a.budget = opts.budget
      }
      let result = await decodeSource(source, { pages, notify, ondata: emitData, disposed: () => a._.disposed })
      if (a._.disposed) return true
      a.sampleRate = result.sampleRate
      a._.ch = result.channels
      a._.fmtV = -1  // invalidate cached format
      if (result.acc) a._.acc = result.acc
      if (result.estDuration) a._.estDur = result.estDuration
      if (result.header) { a._.header = result.header; a._.format = result.format }
      emit(a, 'metadata', { sampleRate: result.sampleRate, channels: result.channels, estDuration: result.estDuration })
      metaEmitted = true
      for (let args of dataQueue.splice(0)) emit(a, 'data', ...args)
      readyResolve()

      let final = await result.decoding
      if (a._.disposed) return true
      a._.len = final.length
      a._.lenV = -1
      a.stats = final.stats
      if (final.header) { a._.header = final.header; a._.metaDone = false }
      a.decoded = true
      notify()
      audio.evict?.(a)
      delete a.then; delete a.catch  // clear thenable before resolve to prevent unwrap loop
      return true
    } catch (e) {
      if (a._.disposed) return true
      readyReject(e)
      emit(a, 'error', e)
      throw e
    }
  })()
  a.ready.catch(() => {})  // suppress unhandled rejection; errors surface through LOAD or await
  makeThenable(a)

  return a
}

/** Make instance thenable — await resolves after full decode. Self-removing to prevent infinite unwrap. */
function makeThenable(a) {
  a.then = function(resolve, reject) {
    return a.ready.then(() => { delete a.then; delete a.catch; return a }).then(resolve, reject)
  }
  a.catch = function(reject) { return a.then(null, reject) }
}

/** Sync creation from PCM data, AudioBuffer, audio instance, function, or seconds of silence. */
audio.from = function(source, opts = {}) {
  if (Array.isArray(source) && source[0] instanceof Float32Array) return fromChannels(source, opts)
  if (typeof source === 'number') return fromSilence(source, opts)
  if (typeof source === 'function') return fromFunction(source, opts)
  if (source?.pages) {
    return create([...source.pages], opts.sampleRate ?? source.sampleRate,
      opts.channels ?? source._.ch, source._.len,
      { source: source.source, storage: source.storage, cache: source.cache, budget: opts.budget ?? source.budget }, source.stats)
  }
  if (source?.getChannelData) {
    let chs = Array.from({ length: source.numberOfChannels }, (_, i) => new Float32Array(source.getChannelData(i)))
    return fromChannels(chs, { sampleRate: source.sampleRate, ...opts })
  }
  // Typed array with format conversion
  if (ArrayBuffer.isView(source) && opts.format) {
    let fmt = parseFmt(opts.format)
    let ch = fmt.channels || opts.channels || 1
    let sr = fmt.sampleRate || opts.sampleRate || 44100
    let src = { ...fmt, channels: ch }
    if (ch > 1 && src.interleaved == null) src.interleaved = true
    let pcm = convert(source, src, { dtype: 'float32', interleaved: false, channels: ch })
    let perCh = pcm.length / ch
    let chs = Array.from({ length: ch }, (_, c) => pcm.subarray(c * perCh, (c + 1) * perCh))
    return fromChannels(chs, { sampleRate: sr })
  }
  throw new TypeError('audio.from: expected Float32Array[], AudioBuffer, audio instance, function, or number')
}



// ── Plugin Architecture ─────────────────────────────────────────────────

const fn = {}

audio.fn = fn                    // instance prototype (like $.fn)

audio.BLOCK_SIZE = 1024
audio.PAGE_SIZE = 1024 * audio.BLOCK_SIZE

/** Internal protocol symbols for plugin overrides. */
export const LOAD = Symbol('load')
export const READ = Symbol('read')

/** Resolve a channel option to concrete indices: null → all, n → [n], [..] → per-channel. */
export function resolveChannels(channel, total) {
  let perCh = Array.isArray(channel)
  let chs = channel != null ? (perCh ? channel : [channel]) : Array.from({ length: total }, (_, i) => i)
  return { chs, perCh }
}

/** Emit event on instance. Snapshots listeners so a handler that (un)subscribes mid-emit
 *  cannot skip/duplicate others in this dispatch. */
export function emit(a, event, ...args) {
  let arr = a._.ev[event]
  if (arr) for (let cb of arr.slice()) cb(...args)
}
fn.on = function(event, cb) {
  (this._.ev[event] ??= []).push(cb)
  return this
}
fn.off = function(event, cb) {
  if (!event) { this._.ev = {}; return this }
  if (!cb) { delete this._.ev[event]; return this }
  let arr = this._.ev[event]
  if (arr) { let i = arr.indexOf(cb); if (i >= 0) arr.splice(i, 1) }
  return this
}
fn.dispose = function() {
  this._.disposed = true  // checked by in-flight decode/seek continuations to abort without mutating this instance
  this.stop()
  this._.ev = {}
  this._.meters = null
  this._.pcm = null
  this._.plan = null
  this.pages.length = 0
  this.stats = null
  this._.waiters = null
  this._.acc = null
}
if (Symbol.dispose) fn[Symbol.dispose] = fn.dispose

const isOp = p => typeof p === 'function' && Object.hasOwn(p, 'params') && typeof p.params === 'object'
const isStat = p => p != null && typeof p === 'object' && typeof p.stat === 'string' && typeof p.compute === 'function'
const isCodec = p => p != null && typeof p === 'object' && typeof p.codec === 'string' && (typeof p.decode === 'function' || typeof p.encode === 'function')

/** Register plugins. Each receives audio. A contract plugin (a factory function
 *  with an own `params` object — see audiojs/compile CONTRACT.md) is hosted natively as
 *  an op; its declared `tail` composes a trailing pad so decays are not truncated.
 *  A stat plugin ({ stat: name, compute(channels, opts) }) registers as a.stat(name).
 *  A codec plugin ({ codec: fmt, test?, decode?, encode? }) extends what audio() can
 *  open and what save()/encode() can write. A string resolves through the
 *  audio.plugins registry (dynamic import — returns a promise); every atom-, stat- or
 *  codec-shaped export of the target registers. */
audio.use = function(...plugins) {
  let loads = null
  for (let p of plugins) {
    if (typeof p === 'string') {
      let spec = audio.plugins?.[p] ?? audio.atoms?.[p]  // .atoms — deprecated ≤2.5 name
      if (!spec) throw new Error(`audio.use: unknown plugin '${p}' — not in audio.plugins registry`)
      ;(loads ??= []).push(import(spec).then(ns => {
        for (let k of Object.keys(ns)) { if (isOp(ns[k])) useOp(ns[k]); else if (isStat(ns[k])) useStat(ns[k]); else if (isCodec(ns[k])) useCodec(ns[k]) }
      }, e => { throw new Error(`audio.use('${p}'): install ${spec.split('/').slice(0, 2).join('/')} — ${e.message}`) }))
    }
    else if (isOp(p)) useOp(p)
    else if (isStat(p)) useStat(p)
    else if (isCodec(p)) useCodec(p)
    else p(audio)
  }
  return loads ? Promise.all(loads).then(() => audio) : audio
}

/** Register a codec plugin: { codec: fmt, test?(bytes) → bool, decode?(bytes) →
 *  { channelData, sampleRate } | Promise, encode?(opts) → enc } (enc(chunk) →
 *  bytes, enc() → flush). test() sniffs headers where magic-byte detection draws
 *  a blank. A package may carry one half (decode-X / encode-X manifests) —
 *  registrations merge by format name. Codec atoms *extend*: bundled umbrella
 *  codecs win for formats they already serve (streaming decode stays streaming). */
function useCodec(m) {
  let reg = (audio.codecs ??= {})
  reg[m.codec] = { ...reg[m.codec], ...m }
}


/** Register a stat plugin: whole-signal analysis `compute(channels, { sampleRate, ...opts })`.
 *  The host reads the (ranged) PCM and hands it over — the batch shape every analysis
 *  kernel already is. Option values that are audio instances (e.g. similarity's `ref`)
 *  are pre-rendered to channel data. */
function useStat(m) {
  if (!audio.stat) throw new Error('audio.use(stat): stat registry required — import "audio", not "audio/core.js"')
  let name = m.stat
  audio.stat(name, {})  // name registered; fn.stat dispatches to the instance method below
  audio.fn[name] = async function(opts) {
    let { at, duration, ...rest } = opts || {}
    for (let k in rest) if (rest[k]?.pages && rest[k].read) rest[k] = await rest[k].read()
    let pcm = await this.read(at != null || duration != null ? { at, duration } : undefined)
    return m.compute(pcm, { sampleRate: this.sampleRate, ...rest })
  }
}

/** Map a contract plugin (audio.js manifest factory) to an op descriptor. The contract is a convention, not a
 *  library — audio consumes it natively: params read off the factory, per-instance
 *  state on the proc ctx, smoothing left to engine sub-block automation (it already
 *  ramps patched values click-free), currentTime from blockOffset. */
function useOp(m) {
  if (!audio.op) throw new Error('audio.use(module): op registry required — import "audio", not "audio/core.js"')
  let specs = m.params || {}
  let names = Object.keys(specs)
  let id = m.id || (m.name || 'module').replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase()
  // tail: seconds, or fn(ctx) of the actual params (mirrors latency's fn form) — a
  // feedback delay's decay depends on its feedback setting, not the declared maximum
  let tail = m.tail || 0

  let snapParams = get => {
    let s = {}
    for (let name of names) {
      let sp = specs[name], v = get(name) ?? sp.default
      s[name] = sp.type === 'number' ? new Float32Array([v]) : v
    }
    return s
  }
  // Declared latency → plan-level plugin delay compensation (fn form: once per instance)
  let latency = typeof m.latency === 'function'
    ? (o, sr) => m.latency({ sampleRate: sr, params: snapParams(n => o?.[n]) }) | 0
    : m.latency | 0

  let init = (ctx, maxBlock = audio.BLOCK_SIZE) => {
    let snapshot = snapParams(name => ctx[name])
    let mctx = {
      sampleRate: ctx.sampleRate, maxBlockSize: maxBlock, maxChannels: 32,
      render: 'offline', duration: ctx.totalDuration, currentTime: 0,
      params: snapshot, layouts: undefined, events: undefined,
      // events.out declaration validated; host routing of emissions is future work
      emit(name) { if (!(name in (m.events?.out || {}))) throw new Error(`emit: "${name}" not declared in events.out`) }
    }
    let st = { mctx, live: {}, bufs: {} }
    for (let name of names) if (specs[name].type === 'number') st.bufs[name] = new Float32Array(1)
    st.process = m(mctx)
    return st
  }

  let fill = (st, ctx) => {
    for (let name of names) {
      let sp = specs[name]
      let v = ctx[name] ?? sp.default
      if (sp.type === 'number') {
        if (v < sp.min) v = sp.min
        else if (v > sp.max) v = sp.max
        st.bufs[name][0] = v
        st.live[name] = st.bufs[name]
      } else st.live[name] = sp.type === 'enum' && !sp.values.includes(v) ? sp.default : v
    }
  }

  // Declared extra input buses (contract §channels) — bus 1 fed from ctx.key
  // (an audio instance / Float32Array[]), rendered per block, rate-reconciled
  let keyed = Array.isArray(m.channels?.inputs) && m.channels.inputs.length > 1

  // Declared fixed output count ≠ input (contract §channels, e.g. 2→5.1 upmix) →
  // op-level `ch` hook; the plan pipeline sizes that stage's buffers to it
  let busN = side => typeof side === 'number' ? side
    : Array.isArray(side) && typeof side[0] === 'number' ? side[0] : null
  let outN = busN(m.channels?.outputs)
  let ch = outN != null && outN !== busN(m.channels?.inputs) ? () => outN : undefined

  let process = (input, output, ctx) => {
    let st = ctx._am ??= init(ctx)
    st.mctx.currentTime = ctx.blockOffset || 0
    if (noteIn) feedEvents(st, ctx, input[0].length)
    fill(st, ctx)
    if (keyed && ctx.key != null && audio.renderAt) {
      let n = input[0].length
      let off = Math.round((ctx.blockOffset || 0) * ctx.sampleRate)
      st.process([input, audio.renderAt(ctx.render, ctx.key, off, n, ctx.sampleRate)], [output], st.live)
    } else st.process(keyed ? [input, undefined] : [input], [output], st.live)
  }

  // Per-block note feed for streaming instruments (contract §events): slice the
  // compiled slots to [blockStart, blockEnd), times rebased block-relative. Slot
  // objects are pooled per contract; binary search each block — streams can
  // restart or seek, so no monotonic cursor.
  let feedEvents = (st, ctx, frames) => {
    if (ctx.notes && st.slots?.src !== ctx.notes)
      st.slots = { src: ctx.notes, evs: noteSlots(ctx.notes, ctx.sampleRate), pool: [], view: [] }
    if (!st.slots) { st.mctx.events = ctx.notes === undefined ? st.mctx.events : undefined; return }
    let { evs, pool, view } = st.slots
    let b0 = Math.round((ctx.blockOffset || 0) * ctx.sampleRate), b1 = b0 + frames
    let lo = 0, hi = evs.length
    while (lo < hi) { let mid = (lo + hi) >> 1; if (evs[mid].time < b0) lo = mid + 1; else hi = mid }
    let n = 0
    for (let i = lo; i < evs.length && evs[i].time < b1; i++, n++) {
      let s = pool[n] ??= {}
      let e = evs[i]
      s.time = e.time - b0; s.type = e.type; s.kind = e.kind
      s.pitch = e.pitch; s.velocity = e.velocity; s.channel = e.channel; s.id = e.id
      view[n] = s
    }
    view.length = n
    st.mctx.events = view
  }

  // Declared note input (contract §events) — the offline host's event source is a
  // `notes` option: [{ time, midi | freq, duration?, velocity? }] compiled to the
  // contract's pooled slots ({ time: sample, type: 'note', kind: 'on'|'off', pitch,
  // velocity, channel, id }), sorted, on/off paired by id.
  let noteIn = m.events?.in?.includes('note')
  let noteSlots = (notes, sr) => {
    let evs = []
    for (let i = 0; i < notes.length; i++) {
      let n = notes[i]
      let pitch = n.midi ?? (n.freq != null ? 69 + 12 * Math.log2(n.freq / 440) : 69)
      let on = Math.round((n.time ?? 0) * sr)
      let velocity = n.velocity ?? 1
      evs.push({ time: on, type: 'note', kind: 'on', pitch, velocity, channel: 0, id: i })
      if (n.duration != null) evs.push({ time: on + Math.round(n.duration * sr), type: 'note', kind: 'off', pitch, velocity: 0, channel: 0, id: i })
    }
    return evs.sort((a, b) => a.time - b.time)
  }

  // streaming: false — the module needs the entire signal in one call; the plan
  // engine materializes the timeline and hosts it as a whole-render op
  if (m.streaming === false) {
    // Declared tail on a whole-render plugin → plan pads the materialized input with
    // that many seconds of silence so the decay renders instead of truncating (the
    // plugin still sees equal frames in/out — both sides extended).
    let wholeTail = typeof m.tail === 'function'
      ? (o, sr) => m.tail({ sampleRate: sr, params: snapParams(n => o?.[n]) })
      : m.tail || 0
    // Declared frames hook → structural output length (time-stretch class): the plan
    // sizes the output buffers by it and continues from the result's actual length.
    let frames = m.frames
      ? (n, o, sr) => m.frames(n, { sampleRate: sr, params: snapParams(k => o?.[k]) })
      : undefined
    return audio.op(id, {
      params: names, plugin: m, atom: m, ch, tail: wholeTail, frames,
      whole(input, output, ctx) {
        let st = init(ctx, input[0].length)
        if (noteIn && ctx.notes) st.mctx.events = noteSlots(ctx.notes, ctx.sampleRate)
        fill(st, ctx)
        st.process([input], [output], st.live)
      }
    })
  }

  if (!tail) return audio.op(id, { params: names, plugin: m, atom: m, latency, process, ch })

  // Declared tail: expand into pad + hidden proc at compile time — the user edit stays
  // one atomic entry (undo/serialize whole), the decay renders into the pad
  audio.op('_' + id, { params: names, hidden: true, plugin: m, atom: m, latency, process, ch })
  audio.op(id, {
    params: names, tail, plugin: m, atom: m, ch,
    expand: (ctx) => {
      let o = {}
      for (let k of names) if (ctx[k] !== undefined) o[k] = ctx[k]
      let t = typeof tail === 'function'
        ? tail({ sampleRate: ctx.sampleRate, params: snapParams(n => o[n]) })
        : tail
      return [['pad', { before: 0, after: t }], ['_' + id, o]]
    }
  })
}


// ── Instance ─────────────────────────────────────────────────────────────

function create(pages, sampleRate, ch, length, opts = {}, stats) {
  let a = Object.create(fn)
  a.pages = pages
  a.source = opts.source ?? null
  a.storage = opts.storage || 'memory'
  a.cache = opts.cache || null
  a.budget = opts.budget ?? Infinity
  a.stats = stats
  a.decoded = true
  a.ready = Promise.resolve(true)

  Object.defineProperty(a, '_', {
    value: {
      sr: sampleRate, // source sample rate
      ch,            // source channel count
      len: length,   // source sample length
      waiters: null, // decode notify queue (null when not streaming)
      ev: {},        // instance event listeners
      ct: 0, ctStamp: 0,    // currentTime wall-clock interpolation
      vol: 1, muted: false, // volume 0..1 linear with change events
      rate: 1, // playbackRate
      push: false,     // true only for pushable (audio(null)) instances — gates fn.stop()'s finalize branch
      disposed: false, // set by fn.dispose() — in-flight async continuations check this to abort
      evicting: false, // non-reentrant guard for scheduleEvict
    },
    writable: false, enumerable: false, configurable: false
  })

  // History (edit pipeline)
  a.edits = []
  a.version = 0
  a._.pcm = null; a._.pcmV = -1
  a._.plan = null; a._.planV = -1
  a._.statsV = -1
  a._.lenC = a._.len; a._.lenV = 0
  a._.fmt = null; a._.fmtV = -1  // effective sr/ch after edits (plan.js deriveFormat)

  // Playback (getter/setter for interpolation & events)
  Object.defineProperties(a, {
    currentTime: {
      get() {
        if (this.playing && !this.paused) {
          let t = this._.ct + (performance.now() - this._.ctStamp) / 1000 * (this._.rate || 1)
          let d = this.duration
          return d > 0 ? Math.min(t, d) : t
        }
        return this._.ct
      },
      set(v) { this._.ct = v; this._.ctStamp = performance.now() },
      enumerable: true, configurable: true
    },
    volume: {
      get() { return this._.vol },
      set(v) { v = Math.max(0, Math.min(1, +v || 0)); if (this._.vol !== v) { this._.vol = v; emit(this, 'volumechange') } },
      enumerable: true, configurable: true
    },
    muted: {
      get() { return this._.muted },
      set(v) { v = !!v; if (this._.muted !== v) { this._.muted = v; emit(this, 'volumechange') } },
      enumerable: true, configurable: true
    },
    playbackRate: {
      get() { return this._.rate },
      set(v) { v = Math.max(0.0625, Math.min(16, +v || 1)); if (this._.rate !== v) { this._.rate = v; emit(this, 'ratechange') } },
      enumerable: true, configurable: true
    },
  })
  a.playing = false; a.paused = false
  a.ended = false; a.seeking = false
  a.loop = false; a.block = null

  // Cache
  a._.lru = new Set()

  return a
}

function fromChannels(channelData, opts = {}) {
  let sr = opts.sampleRate || 44100
  return create(paginate(channelData), sr, channelData.length, channelData[0].length, opts, audio.statSession?.(sr).page(channelData).done())
}

function fromSilence(seconds, opts = {}) {
  let sr = opts.sampleRate || 44100, ch = opts.channels || 1
  return fromChannels(Array.from({ length: ch }, () => new Float32Array(Math.round(seconds * sr))), { ...opts, sampleRate: sr })
}

function fromFunction(fn, opts = {}) {
  let sr = opts.sampleRate || 44100, ch = opts.channels || 1
  let dur = opts.duration
  if (dur == null) throw new TypeError('audio.from(fn): duration required')
  let len = Math.round(dur * sr)
  let chs = Array.from({ length: ch }, () => new Float32Array(len))
  for (let i = 0; i < len; i++) {
    let v = fn(i / sr, i)
    if (typeof v === 'number') for (let c = 0; c < ch; c++) chs[c][i] = v
    else for (let c = 0; c < ch; c++) chs[c][i] = v[c] ?? 0
  }
  return fromChannels(chs, { sampleRate: sr })
}

Object.defineProperties(fn, {
  sampleRate: { get() { return this._.sr }, set(v) { this._.sr = v }, enumerable: true, configurable: true },
  length: { get() { return this._.len }, configurable: true },
  duration: { get() { return this.length / this.sampleRate }, configurable: true },
  channels: { get() { return this._.ch }, configurable: true },
  /** Source stats (pre-edit snapshot) — used by resolve-stage ops like normalize/trim. */
  srcStats: { get() { return this._.srcStats || this.stats || this._.acc?.stats }, configurable: true },
})

fn[LOAD] = async function() {
  if (this._.ready) await this._.ready; this._.acc?.drain()
}
/** Default read — restores any evicted pages first (no-op if cache.js isn't loaded or a has no cache). */
fn[READ] = async function(offset, duration) {
  if (audio.ensurePages) await audio.ensurePages(this, offset, duration)
  return readPages(this, offset, duration)
}

/** Push PCM data into a pushable instance. Accepts Float32Array[], Float32Array, or typed array with format. */
fn.push = function(data, fmt) {
  let acc = this._.acc
  if (!acc) throw new Error('push: instance is not pushable — create with audio()')
  let ch = this._.ch, sr = this.sampleRate
  let chData
  if (Array.isArray(data) && data[0] instanceof Float32Array) chData = data
  else if (data instanceof Float32Array) chData = [data]
  else if (ArrayBuffer.isView(data)) {
    let f = fmt || {}
    let srcFmt = typeof f === 'string' ? f : f.format || 'int16'
    let nch = f.channels || ch
    let src = { dtype: srcFmt, channels: nch }
    if (nch > 1) src.interleaved = true
    let pcm = convert(data, src, { dtype: 'float32', interleaved: false, channels: nch })
    let perCh = pcm.length / nch
    chData = Array.from({ length: nch }, (_, c) => pcm.subarray(c * perCh, (c + 1) * perCh))
  }
  else throw new TypeError('push: expected Float32Array[], Float32Array, or typed array')
  // Sync channel count on first push, validate on subsequent
  if (!this._.ch) { this._.ch = chData.length; this._.fmtV = -1 }
  else if (chData.length !== this._.ch) throw new TypeError(`push: expected ${this._.ch} channels, got ${chData.length}`)
  acc.push(chData, (fmt && fmt.sampleRate) || sr)
  this._.len = acc.length
  this._.lenV = -1
  scheduleEvict(this)
  return this
}

/** Stop recording and/or finalize pushable stream. Drain partial page, signal EOF to waiting streams.
 *  No-op on non-pushable — an ordinary file/URL decode also populates `_.acc` (streaming codec buffer)
 *  while mid-decode, and must not be finalized by a transport-level stop(). */
fn.stop = function() {
  this.playing = false; this.paused = false; this.seeking = false
  if (this._._wake) this._._wake()
  if (this.recording) {
    this.recording = false
    if (this._._mic) { this._._mic(null); this._._mic = null }
  }
  if (this._.push && this._.acc && !this.decoded) {
    this._.acc.drain()
    this.decoded = true
    if (this._.waiters) for (let w of this._.waiters.splice(0)) w()
  }
  return this
}

/** Start recording from mic. Pushes PCM chunks until .stop(). Requires @audio/mic (npm i @audio/mic). */
fn.record = function(opts = {}) {
  if (!this._.acc) throw new Error('record: instance is not pushable — create with audio()')
  if (this.recording) return this
  this.recording = true
  this.decoded = false
  let self = this, sr = this.sampleRate, ch = this._.ch
  let _rec = (async () => {
    let { default: mic } = await import('@audio/mic')
    let read = mic({ sampleRate: sr, channels: ch, bitDepth: 16, ...opts })
    self._._mic = read
    read((err, buf) => {
      if (!self.recording) return
      if (err || !buf) return
      self.push(new Int16Array(buf.buffer, buf.byteOffset, buf.byteLength / 2), 'int16')
    })
  })()
  _rec.catch(() => {})  // suppress unhandled rejection; surfaces through .ready/.stop
  return this
}

fn.seek = function(t) {
  t = Math.max(0, t)
  this.seeking = true
  this.currentTime = t
  if (this.cache) {
    let page = Math.floor(t * this.sampleRate / audio.PAGE_SIZE)
    ;(async () => {
      for (let i = Math.max(0, page - 1); i <= Math.min(page + 2, this.pages.length - 1); i++) {
        if (this._.disposed) return
        if (this.pages[i] === null && await this.cache.has(i)) {
          if (this._.disposed) return
          this.pages[i] = await this.cache.read(i)
          touchLru(this, i)  // restoring counts as access — keeps it eligible for normal LRU aging
        }
      }
    })().catch(() => {})
  }
  if (this.playing) { this._._seekTo = t; if (this._._wake) this._._wake() }
  else this.seeking = false
  return this
}

fn.read = async function(opts) {
  if (typeof opts !== 'object' || opts === null) opts = {}
  let { at, duration, format, channel, meta } = opts
  at = parseTime(at); duration = parseTime(duration)
  await this[LOAD]()
  let pcm = await this[READ](at, duration)
  if (channel != null) pcm = [pcm[channel]]
  if (!format) return channel != null ? pcm[0] : pcm
  let converted = encode[format] ? await encode[format](pcm, { sampleRate: this.sampleRate, ...meta }) : pcm.map(ch => convert(ch, 'float32', format))
  return channel != null ? (Array.isArray(converted) ? converted[0] : converted) : converted
}


// ── Pages ────────────────────────────────────────────────────────────────

/** Split channels into pages of PAGE_SIZE samples. */
function paginate(channelData) {
  let len = channelData[0].length, pages = []
  for (let off = 0; off < len; off += audio.PAGE_SIZE)
    pages.push(channelData.map(ch => ch.subarray(off, Math.min(off + audio.PAGE_SIZE, len))))
  return pages
}

/** Mark page i as most-recently-used (LRU eviction order = insertion order of this Set). */
export function touchLru(a, i) {
  let lru = a._.lru
  if (lru && lru._last !== i) { lru.delete(i); lru.add(i); lru._last = i }
}

/** Non-reentrant, budget-guarded eviction trigger — called from progressive decode/push
 *  page-emit paths so a growing instance never holds more than `budget` resident regardless
 *  of whether/when its full decode (or push stream) ever completes. No-op without cache.js. */
function scheduleEvict(a) {
  if (!a.cache || !audio.evict || a._.evicting) return
  a._.evicting = true
  audio.evict(a).catch(() => {}).then(() => { a._.evicting = false })
}

/** Walk pages of instance a, calling visitor(page, channel, start, end) for each overlapping page. */
export function walkPages(a, c, srcOff, len, visitor) {
  let pages = a.pages, PS = audio.PAGE_SIZE
  let p0 = Math.floor(srcOff / PS), pos = p0 * PS
  for (let p = p0; p < pages.length && pos < srcOff + len; p++) {
    let pg = pages[p], pLen = pg ? pg[0].length : PS
    if (pos + pLen > srcOff && pg) {
      let s = Math.max(srcOff - pos, 0), e = Math.min(srcOff + len - pos, pLen)
      touchLru(a, p)
      visitor(pg, c, s, e, Math.max(pos - srcOff, 0))
    }
    pos += pLen
  }
  // Read from accumulator partial buffer if it extends beyond emitted pages
  let acc = a._.acc
  if (acc && pos < srcOff + len) {
    let partial = acc.partial
    if (partial) {
      let s = Math.max(srcOff - pos, 0), e = Math.min(srcOff + len - pos, partial[0].length)
      if (e > s) visitor(partial, c, s, e, Math.max(pos - srcOff, 0))
    }
  }
}

/** Copy channel c from a's pages into target buffer. */
export function copyPages(a, c, srcOff, len, target, tOff) {
  walkPages(a, c, srcOff, len, (pg, ch, s, e, off) => target.set(pg[ch].subarray(s, e), tOff + off))
}

/** Read range from source pages (no edits). */
export function readPages(a, offset, duration) {
  let sr = a.sampleRate, ch = a._.ch
  let s = offset != null ? Math.min(Math.max(Math.round(offset * sr), 0), a._.len) : 0
  let len = duration != null ? Math.round(duration * sr) : a._.len - s
  len = Math.min(Math.max(len, 0), a._.len - s)
  let out = Array.from({ length: ch }, () => new Float32Array(len))
  for (let c = 0; c < ch; c++) copyPages(a, c, s, len, out[c], 0)
  return out
}


// ── Decode ───────────────────────────────────────────────────────────────

/** Convert a file: URL string to a filesystem path; other strings pass through. */
async function toPath(source) {
  if (!source.startsWith('file:')) return source
  let { fileURLToPath } = await import('url')
  return fileURLToPath(source)
}

/** Resolve source to ArrayBuffer. */
async function resolveSource(source) {
  if (source instanceof ArrayBuffer) return source
  if (source instanceof Uint8Array) return source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength)
  if (source instanceof URL) return resolveSource(source.href)
  if (typeof Blob !== 'undefined' && source instanceof Blob) return source.arrayBuffer()
  if (typeof Response !== 'undefined' && source instanceof Response) return source.arrayBuffer()
  if (typeof source === 'string') {
    if (/^(https?|data|blob):/.test(source) || typeof window !== 'undefined')
      return (await fetch(source)).arrayBuffer()
    source = await toPath(source)
    let { readFile } = await import('fs/promises')
    let buf = await readFile(source)
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
  }
  throw new TypeError('audio: unsupported source type')
}

/** Detect format + prepare source. */
const detectType = bytes => getType(bytes) || sniffCodecLocal(bytes)
const sniffCodecLocal = bytes => { for (let k in audio.codecs || {}) if (audio.codecs[k].test?.(bytes)) return k }

async function detectSource(source) {
  if (source instanceof ArrayBuffer || source instanceof Uint8Array) {
    let bytes = source instanceof ArrayBuffer
      ? new Uint8Array(source)
      : source.byteOffset || source.byteLength !== source.buffer.byteLength
        ? new Uint8Array(source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength))
        : new Uint8Array(source.buffer)
    return { format: detectType(bytes), bytes }
  }
  if (typeof source === 'string' && !/^(https?|data|blob):/.test(source) && typeof window === 'undefined') {
    let path = await toPath(source)
    let { open, stat } = await import('fs/promises')
    let fh = await open(path, 'r')
    let hdr = new Uint8Array(12)
    await fh.read(hdr, 0, 12, 0)
    await fh.close()
    let format = detectType(new Uint8Array(hdr))
    let fileSize = (await stat(path)).size
    let { createReadStream } = await import('fs')
    return { format, reader: createReadStream(path), fileSize }
  }
  // Blob/File — sniff format from a header slice, stream the body (file input path)
  if (typeof Blob !== 'undefined' && source instanceof Blob) {
    let hdr = new Uint8Array(await source.slice(0, 12).arrayBuffer())
    return { format: detectType(hdr), reader: iterateStream(source.stream()), fileSize: source.size }
  }
  let buf = await resolveSource(source)
  let bytes = new Uint8Array(buf)
  return { format: detectType(bytes), bytes }
}

/** Async-iterate a web ReadableStream (Safari has no native async iteration). */
async function* iterateStream(stream) {
  let reader = stream.getReader()
  try {
    while (true) {
      let { done, value } = await reader.read()
      if (done) return
      yield value
    }
  } finally { reader.releaseLock() }
}

/** Universal page accumulator — push(chData, sampleRate) interface.
 *  Used by decodeSource and audio() push instances. This IS the universal source adapter. */
function pageAccumulator(opts = {}) {
  let { pages = [], notify, ondata } = opts
  let sr = 0, ch = 0, totalLen = 0, pagePos = 0
  let pageBuf = null, session

  function emit(page) {
    pages.push(page)
    totalLen += page[0].length
    notify?.()
  }

  return {
    pages,
    get sampleRate() { return sr },
    get channels() { return ch },
    get length() { return totalLen + pagePos },
    get partial() { return pagePos > 0 ? pageBuf.map(c => c.subarray(0, pagePos)) : null },
    get partialLen() { return pagePos },
    get stats() { return session?.snapshot?.() ?? null },
    push(chData, sampleRate) {
      if (!pageBuf) {
        sr = sampleRate; ch = chData.length
        pageBuf = Array.from({ length: ch }, () => new Float32Array(audio.PAGE_SIZE))
        session = audio.statSession?.(sr)
      }
      session?.page(chData)
      let srcPos = 0, chunkLen = chData[0].length
      while (srcPos < chunkLen) {
        let n = Math.min(chunkLen - srcPos, audio.PAGE_SIZE - pagePos)
        for (let c = 0; c < ch; c++) pageBuf[c].set(chData[c].subarray(srcPos, srcPos + n), pagePos)
        srcPos += n; pagePos += n
        if (pagePos === audio.PAGE_SIZE) {
          emit(pageBuf)
          pageBuf = Array.from({ length: ch }, () => new Float32Array(audio.PAGE_SIZE))
          pagePos = 0
        }
      }
      if (ondata) {
        let delta = session?.delta()
        if (delta) ondata({ delta, offset: (totalLen + pagePos) / sr, sampleRate: sr, channels: ch })
      }
      notify?.()
    },
    /** Flush partial page into pages array. Non-destructive — accumulator stays open. */
    drain() {
      if (pagePos > 0) {
        emit(pageBuf.map(c => c.slice(0, pagePos)))
        pageBuf = Array.from({ length: ch }, () => new Float32Array(audio.PAGE_SIZE))
        pagePos = 0
      }
    },
    done() {
      if (pagePos > 0) emit(pageBuf.map(c => c.slice(0, pagePos)))
      session?.flush()
      if (ondata && session) {
        let delta = session.delta()
        if (delta) ondata({ delta, offset: totalLen / sr, sampleRate: sr, channels: ch })
      }
      return { stats: session?.done(), length: totalLen }
    }
  }
}

/** Estimate duration from file size, format, sampleRate, channels.
 *  Display-only placeholder heuristics (assumed VBR/bitrate) — feeds CLI progress only, never decode/render. */
function estimateDuration(fileSize, format, sampleRate, channels) {
  if (!fileSize || !sampleRate || !channels) return null
  if (format === 'wav') return Math.max(0, (fileSize - 44) / (sampleRate * channels * 2))  // 16-bit PCM
  if (format === 'flac') return fileSize / (sampleRate * channels * 0.7)  // ~56% compression typical
  if (format === 'mp3') return fileSize / (128000 / 8)  // assume 128kbps
  if (format === 'ogg' || format === 'opus') return fileSize / (96000 / 8)  // assume 96kbps
  return null
}

/** Decode any source into pages + stats. Pages fill progressively. */
/** Browser fallback — decode via WebAudio (OfflineAudioContext) for codecs beyond
 *  the bundled set (platform-provided aac/m4a/…). Null when unavailable/undecodable. */
async function waDecode(bytes) {
  let OAC = globalThis.OfflineAudioContext || globalThis.webkitOfflineAudioContext
  if (!OAC) return null
  try {
    // decodeAudioData detaches the buffer — hand it a copy
    let ab = await new OAC(1, 1, 44100).decodeAudioData(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))
    let channelData = []
    for (let c = 0; c < ab.numberOfChannels; c++) channelData.push(ab.getChannelData(c))
    return { channelData, sampleRate: ab.sampleRate }
  } catch { return null }
}

async function decodeSource(source, opts = {}) {
  let { format, bytes, reader, fileSize } = await detectSource(source)

  // Non-streaming fallback — registered codec atoms decode whole-buffer here too
  if (!format || !decode[format]) {
    if (!bytes) bytes = new Uint8Array(await resolveSource(source))
    let dec = format && audio.codecs?.[format]?.decode
    let decoded
    if (dec) decoded = await dec(bytes)
    else try { decoded = await decode(bytes.buffer || bytes) }
    catch (e) { decoded = await waDecode(bytes); if (!decoded) throw e }
    let { channelData, sampleRate } = decoded
    let pages = opts.pages || []
    if (!opts.disposed?.()) for (let p of paginate(channelData)) { pages.push(p); opts.notify?.() }
    let stats = audio.statSession?.(sampleRate)?.page(channelData)?.done() ?? null
    let header = bytes.subarray(0, Math.min(bytes.length, 256 * 1024))
    return { pages, sampleRate, channels: channelData.length, header, format, decoding: Promise.resolve({ stats, length: channelData[0].length }) }
  }

  // Streaming decode
  let dec = await decode[format]()
  let t = performance.now()
  let yieldLoop = () => {
    let now = performance.now()
    if (now - t > 8) { t = now; return new Promise(r => setTimeout(r, 0)) }
  }
  let firstResolve
  let origNotify = opts.notify
  let disposed = opts.disposed || (() => false)
  let firstReady = new Promise(r => { firstResolve = r })
  let resolveFirst = () => { if (firstResolve) { let f = firstResolve; firstResolve = null; f() } }
  let acc = pageAccumulator({
    pages: opts.pages,
    ondata: opts.ondata,
    notify: () => { origNotify?.(); resolveFirst() }
  })

  // Accumulate first ~256KB for meta parsing (ID3v2, FLAC blocks, WAV chunks before `data`).
  let HEADER_CAP = 256 * 1024, headerChunks = [], headerLen = 0, headerDone = false, headerBytes = null
  let addHeader = buf => {
    if (headerDone || !headerChunks) return
    headerChunks.push(buf)
    headerLen += buf.length
    if (headerLen >= HEADER_CAP) headerDone = true
  }
  let flushHeader = () => {
    if (headerBytes) return headerBytes
    if (!headerChunks) return new Uint8Array(0)
    headerBytes = new Uint8Array(headerLen)
    let pos = 0
    for (let c of headerChunks) { headerBytes.set(c, pos); pos += c.length }
    headerChunks = null
    return headerBytes
  }

  let decoding = (async () => {
    try {
      if (reader) {
        for await (let chunk of reader) {
          if (disposed()) return { stats: null, length: acc.length }
          let buf = chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk)
          addHeader(buf)
          let r = await dec(buf)
          if (disposed()) return { stats: null, length: acc.length }
          if (r.channelData.length) acc.push(r.channelData, r.sampleRate)
          await yieldLoop()
        }
      } else {
        addHeader(bytes)
        let FEED = 64 * 1024
        for (let off = 0; off < bytes.length; off += FEED) {
          if (disposed()) return { stats: null, length: acc.length }
          let r = await dec(bytes.subarray(off, Math.min(off + FEED, bytes.length)))
          if (disposed()) return { stats: null, length: acc.length }
          if (r.channelData.length) acc.push(r.channelData, r.sampleRate)
          await yieldLoop()
        }
      }
      if (disposed()) return { stats: null, length: acc.length }
      let flushed = await dec()
      if (disposed()) return { stats: null, length: acc.length }
      if (flushed.channelData.length) acc.push(flushed.channelData, flushed.sampleRate)
      let final = acc.done()
      final.header = flushHeader()
      return final
    } finally {
      // Guarantees firstReady settles even on a clean decode that pushed zero samples (empty/truncated
      // input) — otherwise `await firstReady` below hangs forever with no reject/error either.
      resolveFirst()
    }
  })()

  await firstReady
  if (!acc.sampleRate) throw new Error('audio: decoded no audio data')

  let estDuration = estimateDuration(fileSize || bytes?.length, format, acc.sampleRate, acc.channels)
  return { pages: acc.pages, sampleRate: acc.sampleRate, channels: acc.channels, header: flushHeader(), format, decoding, acc, estDuration }
}
