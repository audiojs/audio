/**
 * audio core — paged audio container with plugin architecture.
 *
 * audio.fn   — instance prototype (like $.fn)
 * audio.op   — ops dict: audio.op.gain = fn
 * audio.stat — block stats dict: audio.stat.min = fn
 * audio.hook — single-slot hooks { create }
 * audio.use  — plugin registration
 */

import decode from 'audio-decode'
import getType from 'audio-type'
import encode from 'encode-audio'
import convert from 'pcm-convert'


// ── Entry Points ─────────────────────────────────────────────────────────

/** Create audio from any source. Always async. */
export default async function audio(source, opts = {}) {
  // Restore from serialized document
  if (source && typeof source === 'object' && !Array.isArray(source) && source.edits) {
    if (!source.source) throw new TypeError('audio: cannot restore document without source reference')
    let a = await audio(source.source, opts)
    if (a.apply) for (let e of source.edits) a.apply(e)
    return a
  }
  // From PCM arrays or silence duration
  if (Array.isArray(source) && source[0] instanceof Float32Array || typeof source === 'number') {
    let a = audio.from(source, opts)
    await audio.evict?.(a)
    return a
  }
  // From encoded source (file, URL, buffer)
  if (opts.storage === 'persistent') {
    if (!audio.opfsCache) throw new Error('Persistent storage requires cache module (import "./cache.js")')
    try { opts = { ...opts, cache: await audio.opfsCache(), budget: opts.budget ?? audio.DEFAULT_BUDGET ?? Infinity } }
    catch { throw new Error('OPFS not available (required by storage: "persistent")') }
  }
  let a = await audio.open(source, opts)
  await a.loaded
  await audio.evict?.(a)
  return a
}

/** Sync creation from PCM data, AudioBuffer, audio instance, or seconds of silence. */
audio.from = function(source, opts = {}) {
  if (Array.isArray(source) && source[0] instanceof Float32Array) return fromChannels(source, opts)
  if (typeof source === 'number') return fromSilence(source, opts)
  if (source?.pages) {
    return create(source.pages, opts.sampleRate ?? source.sampleRate,
      opts.channels ?? source._.ch, source._.len,
      { source: source.source, storage: source.storage, cache: source.cache }, source.stats)
  }
  if (source?.getChannelData) {
    let chs = Array.from({ length: source.numberOfChannels }, (_, i) => new Float32Array(source.getChannelData(i)))
    return fromChannels(chs, { sampleRate: source.sampleRate, ...opts })
  }
  throw new TypeError('audio.from: expected Float32Array[], AudioBuffer, audio instance, or number')
}

/** Open encoded source for streaming decode. Instance has .loaded promise. */
audio.open = async function(source, opts = {}) {
  let ref = typeof source === 'string' ? source : source instanceof URL ? source.href : null
  let pages = [], waiters = []
  let notify = () => { for (let w of waiters.splice(0)) w() }
  let result = await decodeSource(source, { pages, notify, onprogress: opts.onprogress })
  let a = create(pages, result.sampleRate, result.channels, 0, { ...opts, source: ref }, null)
  a._.waiters = waiters
  a.decoded = false

  a.loaded = result.decoding.then(final => {
    a._.len = final.length
    a._.lenV = -1
    a.stats = final.stats
    a.decoded = true
    notify()
    return a
  })

  return a
}


// ── Plugin Architecture ─────────────────────────────────────────────────

const fn = {}

audio.fn = fn
audio.op = {}
audio.stat = {}
audio.hook = { create: null }
audio.PAGE_SIZE = 65536
audio.BLOCK_SIZE = 1024

/** Internal protocol symbols for plugin overrides. */
export const LOAD = Symbol('load')
export const READ = Symbol('read')
export const RUN = Symbol('run')

/** Register plugins. Each receives audio. Wires ops to fn after. */
audio.use = function(...plugins) {
  for (let p of plugins) p(audio)
  for (let name in audio.op) {
    if (fn[name]) continue
    fn[name] = function(...a) { return this[RUN](name, a) }
  }
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

  a._ = {
    ch,            // source channel count
    len: length,   // source sample length
    cursor: 0,     // playback cursor position
    waiters: null, // decode notify queue (null when not streaming)
  }
  audio.hook.create?.(a)
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

Object.defineProperties(fn, {
  length: { get() { return this._.len }, configurable: true },
  duration: { get() { return this.length / this.sampleRate }, configurable: true },
  channels: { get() { return this._.ch }, configurable: true },
  cursor: {
    get() { return this._.cursor },
    set(t) {
      this._.cursor = t
      if (this.cache) {
        let page = Math.floor(t * this.sampleRate / audio.PAGE_SIZE)
        ;(async () => {
          for (let i = Math.max(0, page - 1); i <= Math.min(page + 2, this.pages.length - 1); i++)
            if (this.pages[i] === null && await this.cache.has(i)) this.pages[i] = await this.cache.read(i)
        })()
      }
    },
    configurable: true,
  },
})

fn[LOAD] = async function() {}
fn[READ] = function(offset, duration) { return readPages(this, offset, duration) }

fn.read = async function(offset, duration, opts) {
  if (typeof offset === 'object' && !opts) { opts = offset; offset = undefined }
  else if (typeof duration === 'object' && !opts) { opts = duration; duration = undefined }
  await this[LOAD]()
  let pcm = await this[READ](offset, duration)
  let fmt = opts?.format
  if (!fmt) return pcm
  if (encode[fmt]) return encode[fmt](pcm, { sampleRate: this.sampleRate, ...opts?.meta })
  return pcm.map(ch => convert(ch, 'float32', fmt))
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
  let s = offset != null ? Math.round(offset * sr) : 0
  let len = duration != null ? Math.round(duration * sr) : a._.len - s
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

/** Rough estimate of decoded float32 byte count. */
function estimateSize(buf) {
  let h = new Uint8Array(buf, 0, 4), tag = String.fromCharCode(h[0], h[1], h[2], h[3])
  if (tag === 'RIFF' || tag === 'FORM') return buf.byteLength * 2
  if (tag === 'fLaC') return buf.byteLength * 5
  return buf.byteLength * 20
}

/** Detect format + prepare source. */
async function detectSource(source) {
  if (source instanceof ArrayBuffer || source instanceof Uint8Array) {
    let bytes = new Uint8Array(source instanceof ArrayBuffer ? source : source.buffer || source)
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

const STREAMABLE = new Set(['mp3', 'flac', 'opus', 'oga'])

/** Decode any source into pages + stats. Pages fill progressively. */
async function decodeSource(source, opts = {}) {
  let { pages = [], notify, onprogress } = opts
  let { format, bytes, reader } = await detectSource(source)

  // Non-streaming fallback
  if (!format || !decode[format]) {
    if (!bytes) bytes = new Uint8Array(await resolveSource(source))
    let { channelData, sampleRate } = await decode(bytes.buffer || bytes)
    let ps = paginate(channelData)
    for (let p of ps) { pages.push(p); notify?.() }
    let stats = audio.statSession?.(sampleRate)?.page(channelData)?.done() ?? null
    return { pages, sampleRate, channels: channelData.length, decoding: Promise.resolve({ stats, length: channelData[0].length }) }
  }

  // Streaming decode
  let dec = await decode[format]()
  let sr = 0, ch = 0, totalLen = 0, pagePos = 0
  let pageBuf = null, session
  let yieldLoop = () => new Promise(r => setTimeout(r, 0))
  let firstResolve

  function flush(page) {
    session?.page(page)
    pages.push(page)
    totalLen += page[0].length
    notify?.()
    if (firstResolve) { firstResolve(); firstResolve = null }
  }

  function push(chData, sampleRate) {
    if (!pageBuf) {
      sr = sampleRate; ch = chData.length
      pageBuf = Array.from({ length: ch }, () => new Float32Array(audio.PAGE_SIZE))
      session = audio.statSession?.(sr)
      if (estTotal) estTotal = estTotal / (ch * sr)
    }
    let srcPos = 0, chunkLen = chData[0].length
    while (srcPos < chunkLen) {
      let n = Math.min(chunkLen - srcPos, audio.PAGE_SIZE - pagePos)
      for (let c = 0; c < ch; c++) pageBuf[c].set(chData[c].subarray(srcPos, srcPos + n), pagePos)
      srcPos += n; pagePos += n
      if (pagePos === audio.PAGE_SIZE) {
        flush(pageBuf)
        if (onprogress) {
          let delta = session?.delta()
          if (delta) onprogress({ delta, offset: totalLen / sr, total: estTotal, sampleRate: sr, channels: ch, pages })
        }
        pageBuf = Array.from({ length: ch }, () => new Float32Array(audio.PAGE_SIZE))
        pagePos = 0
      }
    }
  }

  // Collect non-streamable reader into bytes
  if (reader && !STREAMABLE.has(format)) {
    let chunks = [], total = 0; for await (let c of reader) { chunks.push(c); total += c.length }
    bytes = new Uint8Array(total); let pos = 0; for (let c of chunks) { bytes.set(c, pos); pos += c.length }
    reader = null
  }

  let estTotal = bytes ? estimateSize(bytes.buffer || bytes) / 4 : 0

  let decoding = (async () => {
    try {
      if (reader) {
        for await (let chunk of reader) {
          let buf = chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk)
          let r = await dec(buf)
          if (r.channelData.length) push(r.channelData, r.sampleRate)
          await yieldLoop()
        }
      } else if (STREAMABLE.has(format)) {
        let FEED = 64 * 1024
        for (let off = 0; off < bytes.length; off += FEED) {
          let r = await dec(bytes.subarray(off, Math.min(off + FEED, bytes.length)))
          if (r.channelData.length) push(r.channelData, r.sampleRate)
          await yieldLoop()
        }
      } else {
        let r = await dec(bytes)
        if (r.channelData.length) push(r.channelData, r.sampleRate)
      }
      let flushed = await dec()
      if (flushed.channelData.length) push(flushed.channelData, flushed.sampleRate)
      if (pagePos > 0) flush(pageBuf.map(c => c.slice(0, pagePos)))
      if (onprogress && session) {
        let delta = session.delta()
        if (delta) onprogress({ delta, offset: totalLen / sr, total: estTotal, sampleRate: sr, channels: ch, pages })
      }
    } catch (e) { if (firstResolve) firstResolve(); throw e }
    return { stats: session?.done(), length: totalLen }
  })()

  if (!pages.length) await new Promise(r => { firstResolve = r })
  if (!sr) throw new Error('audio: decoded no audio data')

  return { pages, sampleRate: sr, channels: ch, decoding }
}
