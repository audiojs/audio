/**
 * audio core — paged audio container with plugin architecture.
 *
 * audio.fn       — instance prototype (like $.fn)
 * audio.stat     — block-level stat functions (indexed during decode)
 * audio.on       — lifecycle callbacks (e.g. audio.on('create', fn))
 * audio.use      — plugin registration
 */

import decode from 'audio-decode'
import getType from 'audio-type'
import encode from 'encode-audio'
import convert, { parse as parseFmt } from 'pcm-convert'
import parseDuration from 'parse-duration'

audio.version = '2.0.0'

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
  // No source → pushable instance (tape recorder — push, record, stop)
  if (source == null) {
    let sr = opts.sampleRate || 44100, ch = opts.channels || 1
    let waiters = []
    let notify = () => { for (let w of waiters.splice(0)) w() }
    let a = create([], sr, ch, 0, opts, null)
    a.decoded = false
    a.recording = false
    a._.acc = pageAccumulator({ pages: a.pages, notify, onprogress: (...args) => emit(a, 'progress', ...args) })
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
    let first = instances[0].view ? instances[0].view() : audio.from(instances[0])
    if (!first.insert) throw new Error('audio([...]): concat requires insert plugin — import "audio" instead of "audio/core.js"')
    for (let i = 1; i < instances.length; i++) first.insert(instances[i])
    let loading = instances.filter(s => !s.decoded)
    if (loading.length) {
      first.ready = Promise.all(loading.map(s => s.ready)).then(() => { delete first.then; delete first.catch; return true })
      first.ready.catch(() => {})
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
      a.ready.catch(() => {})
      makeThenable(a)
    }
    return a
  }
  // From encoded source (file, URL, buffer)
  let ref = typeof source === 'string' ? source : source instanceof URL ? source.href : null
  let pages = [], waiters = []
  let notify = () => { for (let w of waiters.splice(0)) w() }
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
        try { opts = { ...opts, cache: await audio.opfsCache(), budget: opts.budget ?? audio.DEFAULT_BUDGET ?? Infinity } }
        catch { throw new Error('OPFS not available (required by storage: "persistent")') }
        a.cache = opts.cache
        a.budget = opts.budget
      }
      let result = await decodeSource(source, { pages, notify, onprogress: (...args) => emit(a, 'progress', ...args) })
      a.sampleRate = result.sampleRate
      a._.ch = result.channels
      a._.chV = -1  // invalidate cached channels
      readyResolve()

      let final = await result.decoding
      a._.len = final.length
      a._.lenV = -1
      a.stats = final.stats
      a.decoded = true
      notify()
      audio.evict?.(a)
      delete a.then; delete a.catch  // clear thenable before resolve to prevent unwrap loop
      return true
    } catch (e) {
      readyReject(e)
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

/** Open source for streaming — returns instance once metadata (sampleRate, channels) is available.
 *  Decode continues in background. For immediate playback before full decode. */
audio.open = async function(source, opts) {
  let a = audio(source, opts)
  if (a._.ready) await a._.ready
  return a
}

/** Sync creation from PCM data, AudioBuffer, audio instance, function, or seconds of silence. */
audio.from = function(source, opts = {}) {
  if (Array.isArray(source) && source[0] instanceof Float32Array) return fromChannels(source, opts)
  if (typeof source === 'number') return fromSilence(source, opts)
  if (typeof source === 'function') return fromFunction(source, opts)
  if (source?.pages) {
    return create(source.pages, opts.sampleRate ?? source.sampleRate,
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
audio.stat = {}                  // block-level stats, pre-indexed during decode (min, max, energy)
let hooks = { create: [] }
audio.on = (event, fn) => { (hooks[event] ??= []).push(fn) }
audio.PAGE_SIZE = 65536
audio.BLOCK_SIZE = 1024

/** Internal protocol symbols for plugin overrides. */
export const LOAD = Symbol('load')
export const READ = Symbol('read')

/** Emit event on instance. */
export function emit(a, event, ...args) {
  let arr = a._.ev[event]
  if (arr) for (let cb of arr) cb(...args)
}
fn.on = function(event, cb) { (this._.ev[event] ??= []).push(cb); return this }
fn.off = function(event, cb) {
  if (!event) { this._.ev = {}; return this }
  if (!cb) { delete this._.ev[event]; return this }
  let arr = this._.ev[event]
  if (arr) { let i = arr.indexOf(cb); if (i >= 0) arr.splice(i, 1) }
  return this
}
fn.dispose = function() {
  this.stop()
  this._.ev = {}
  this._.pcm = null
  this._.plan = null
  this.pages.length = 0
  this.stats = null
  this._.waiters = null
  this._.acc = null
}
fn[Symbol.dispose] = fn.dispose

/** Register plugins. Each receives audio. */
audio.use = function(...plugins) {
  for (let p of plugins) p(audio)
}


// ── Instance ─────────────────────────────────────────────────────────────

function create(pages, sampleRate, ch, length, opts = {}, stats) {
  let a = Object.create(fn)
  a.pages = pages
  a.sampleRate = sampleRate
  a.source = opts.source ?? null
  a.storage = opts.storage || 'memory'
  a.cache = opts.cache || null
  a.budget = opts.budget ?? Infinity
  a.stats = stats
  a.decoded = true
  a.ready = Promise.resolve(true)

  a._ = {
    ch,            // source channel count
    len: length,   // source sample length
    waiters: null, // decode notify queue (null when not streaming)
    ev: {},        // instance event listeners
  }
  a.currentTime = 0
  for (let cb of hooks.create) cb(a)
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
  length: { get() { return this._.len }, configurable: true },
  duration: { get() { return this.length / this.sampleRate }, configurable: true },
  channels: { get() { return this._.ch }, configurable: true },

})

fn[LOAD] = async function() { if (this._.ready) await this._.ready; this._.acc?.drain() }
fn[READ] = function(offset, duration) { return readPages(this, offset, duration) }

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
  acc.push(chData, (fmt && fmt.sampleRate) || sr)
  this._.len = acc.length
  this._.lenV = -1
  return this
}

/** Stop recording and/or finalize pushable stream. Drain partial page, signal EOF to waiting streams. No-op on non-pushable. */
fn.stop = function() {
  if (this.recording) {
    this.recording = false
    if (this._._mic) { this._._mic(null); this._._mic = null }
  }
  if (this._.acc && !this.decoded) {
    this._.acc.drain()
    this.decoded = true
    if (this._.waiters) for (let w of this._.waiters.splice(0)) w()
  }
  return this
}

/** Start recording from mic. Pushes PCM chunks until .stop(). Requires audio-mic (npm i audio-mic). */
fn.record = function(opts = {}) {
  if (!this._.acc) throw new Error('record: instance is not pushable — create with audio()')
  if (this.recording) return this
  this.recording = true
  this.decoded = false
  let self = this, sr = this.sampleRate, ch = this._.ch
  let _rec = (async () => {
    try {
      let { default: mic } = await import('audio-mic')
      let read = mic({ sampleRate: sr, channels: ch, bitDepth: 16, ...opts })
      self._._mic = read
      read((err, buf) => {
        if (!self.recording) return
        if (err || !buf) return
        self.push(new Int16Array(buf.buffer, buf.byteOffset, buf.byteLength / 2), 'int16')
      })
    } catch (e) {
      self.recording = false
      self.decoded = true
      if (self._.waiters) for (let w of self._.waiters.splice(0)) w()
      throw e.code === 'ERR_MODULE_NOT_FOUND' ? new Error('record: audio-mic not installed — npm i audio-mic') : e
    }
  })()
  _rec.catch(() => {})  // suppress unhandled rejection; surfaces through .ready/.stop
  return this
}

fn.seek = function(t) {
  t = Math.max(0, t)
  this.currentTime = t
  if (this.cache) {
    let page = Math.floor(t * this.sampleRate / audio.PAGE_SIZE)
    ;(async () => {
      for (let i = Math.max(0, page - 1); i <= Math.min(page + 2, this.pages.length - 1); i++)
        if (this.pages[i] === null && await this.cache.has(i)) this.pages[i] = await this.cache.read(i)
    })()
  }
  if (this.playing) { this._._seekTo = t; if (this._._wake) this._._wake() }
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

/** Walk pages of instance a, calling visitor(page, channel, start, end) for each overlapping page. */
export function walkPages(a, c, srcOff, len, visitor) {
  let p0 = Math.floor(srcOff / audio.PAGE_SIZE), pos = p0 * audio.PAGE_SIZE
  for (let p = p0; p < a.pages.length && pos < srcOff + len; p++) {
    let pg = a.pages[p], pLen = pg ? pg[0].length : audio.PAGE_SIZE
    if (pos + pLen > srcOff && pg) {
      let s = Math.max(srcOff - pos, 0), e = Math.min(srcOff + len - pos, pLen)
      if (a._.lru) { a._.lru.delete(p); a._.lru.add(p) }
      visitor(pg, c, s, e, Math.max(pos - srcOff, 0))
    }
    pos += pLen
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

/** Resolve source to ArrayBuffer. */
async function resolveSource(source) {
  if (source instanceof ArrayBuffer) return source
  if (source instanceof Uint8Array) return source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength)
  if (source instanceof URL) return resolveSource(source.href)
  if (typeof source === 'string') {
    if (/^(https?|data|blob):/.test(source) || typeof window !== 'undefined')
      return (await fetch(source)).arrayBuffer()
    if (source.startsWith('file:')) {
      let { fileURLToPath } = await import('url')
      source = fileURLToPath(source)
    }
    let { readFile } = await import('fs/promises')
    let buf = await readFile(source)
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
  }
  throw new TypeError('audio: unsupported source type')
}

/** Detect format + prepare source. */
async function detectSource(source) {
  if (source instanceof ArrayBuffer || source instanceof Uint8Array) {
    let bytes = source instanceof ArrayBuffer
      ? new Uint8Array(source)
      : source.byteOffset || source.byteLength !== source.buffer.byteLength
        ? new Uint8Array(source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength))
        : new Uint8Array(source.buffer)
    return { format: getType(bytes), bytes }
  }
  if (typeof source === 'string' && !/^(https?|data|blob):/.test(source) && typeof window === 'undefined') {
    let path = source
    if (source.startsWith('file:')) { let { fileURLToPath } = await import('url'); path = fileURLToPath(source) }
    let { open } = await import('fs/promises')
    let fh = await open(path, 'r')
    let hdr = new Uint8Array(12)
    await fh.read(hdr, 0, 12, 0)
    await fh.close()
    let format = getType(new Uint8Array(hdr))
    let { createReadStream } = await import('fs')
    return { format, reader: createReadStream(path) }
  }
  let buf = await resolveSource(source)
  let bytes = new Uint8Array(buf)
  return { format: getType(bytes), bytes }
}

/** Universal page accumulator — push(chData, sampleRate) interface.
 *  Used by decodeSource and audio() push instances. This IS the universal source adapter. */
function pageAccumulator(opts = {}) {
  let { pages = [], notify, onprogress } = opts
  let sr = 0, ch = 0, totalLen = 0, pagePos = 0
  let pageBuf = null, session

  function emit(page) {
    session?.page(page)
    pages.push(page)
    totalLen += page[0].length
    notify?.()
  }

  return {
    pages,
    get sampleRate() { return sr },
    get channels() { return ch },
    get length() { return totalLen + pagePos },
    push(chData, sampleRate) {
      if (!pageBuf) {
        sr = sampleRate; ch = chData.length
        pageBuf = Array.from({ length: ch }, () => new Float32Array(audio.PAGE_SIZE))
        session = audio.statSession?.(sr)
      }
      let srcPos = 0, chunkLen = chData[0].length
      while (srcPos < chunkLen) {
        let n = Math.min(chunkLen - srcPos, audio.PAGE_SIZE - pagePos)
        for (let c = 0; c < ch; c++) pageBuf[c].set(chData[c].subarray(srcPos, srcPos + n), pagePos)
        srcPos += n; pagePos += n
        if (pagePos === audio.PAGE_SIZE) {
          emit(pageBuf)
          if (onprogress) {
            let delta = session?.delta()
            if (delta) onprogress({ delta, offset: totalLen / sr, sampleRate: sr, channels: ch, pages })
          }
          pageBuf = Array.from({ length: ch }, () => new Float32Array(audio.PAGE_SIZE))
          pagePos = 0
        }
      }
    },
    /** Flush partial page into pages array. Non-destructive — accumulator stays open. */
    drain() {
      if (pagePos > 0) {
        emit(pageBuf.map(c => c.slice(0, pagePos)))
        if (onprogress) {
          let delta = session?.delta()
          if (delta) onprogress({ delta, offset: totalLen / sr, sampleRate: sr, channels: ch, pages })
        }
        pageBuf = Array.from({ length: ch }, () => new Float32Array(audio.PAGE_SIZE))
        pagePos = 0
      }
    },
    done() {
      if (pagePos > 0) emit(pageBuf.map(c => c.slice(0, pagePos)))
      if (onprogress && session) {
        let delta = session.delta()
        if (delta) onprogress({ delta, offset: totalLen / sr, sampleRate: sr, channels: ch, pages })
      }
      return { stats: session?.done(), length: totalLen }
    }
  }
}

/** Decode any source into pages + stats. Pages fill progressively. */
async function decodeSource(source, opts = {}) {
  let { format, bytes, reader } = await detectSource(source)

  // Non-streaming fallback
  if (!format || !decode[format]) {
    if (!bytes) bytes = new Uint8Array(await resolveSource(source))
    let { channelData, sampleRate } = await decode(bytes.buffer || bytes)
    let pages = opts.pages || []
    let ps = paginate(channelData)
    for (let p of ps) { pages.push(p); opts.notify?.() }
    let stats = audio.statSession?.(sampleRate)?.page(channelData)?.done() ?? null
    return { pages, sampleRate, channels: channelData.length, decoding: Promise.resolve({ stats, length: channelData[0].length }) }
  }

  // Streaming decode
  let dec = await decode[format]()
  let yieldLoop = () => new Promise(r => setTimeout(r, 0))
  let firstResolve
  let origNotify = opts.notify
  let acc = pageAccumulator({
    pages: opts.pages,
    onprogress: opts.onprogress,
    notify: () => { origNotify?.(); if (firstResolve) { firstResolve(); firstResolve = null } }
  })

  let decoding = (async () => {
    try {
      if (reader) {
        for await (let chunk of reader) {
          let buf = chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk)
          let r = await dec(buf)
          if (r.channelData.length) acc.push(r.channelData, r.sampleRate)
          await yieldLoop()
        }
      } else {
        let FEED = 64 * 1024
        for (let off = 0; off < bytes.length; off += FEED) {
          let r = await dec(bytes.subarray(off, Math.min(off + FEED, bytes.length)))
          if (r.channelData.length) acc.push(r.channelData, r.sampleRate)
          await yieldLoop()
        }
      }
      let flushed = await dec()
      if (flushed.channelData.length) acc.push(flushed.channelData, flushed.sampleRate)
      let final = acc.done()
      return final
    } catch (e) { if (firstResolve) firstResolve(); throw e }
  })()

  if (!acc.pages.length) await new Promise(r => { firstResolve = r })
  if (!acc.sampleRate) throw new Error('audio: decoded no audio data')

  return { pages: acc.pages, sampleRate: acc.sampleRate, channels: acc.channels, decoding }
}
