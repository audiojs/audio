/**
 * Decode engine — streaming decode of any source into pages + stats.
 * Single path: pages array fills progressively, consumers await via notify.
 */

import decode from 'audio-decode'
import getType from 'audio-type'
import { PAGE_SIZE } from './plan.js'
import { statSession, buildStats } from './stats.js'

/** Split channels into pages of PAGE_SIZE samples. Uses subarray views — no copy. */
export function paginate(channelData) {
  let len = channelData[0].length, pages = []
  for (let off = 0; off < len; off += PAGE_SIZE)
    pages.push(channelData.map(ch => ch.subarray(off, Math.min(off + PAGE_SIZE, len))))
  return pages
}

/** Resolve source to ArrayBuffer. Fetch for URLs/browser, fs for Node file paths. */
export async function resolveSource(source) {
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

/** Rough estimate of decoded float32 byte count from encoded buffer. */
export function estimateSize(buf) {
  let h = new Uint8Array(buf, 0, 4), tag = String.fromCharCode(h[0], h[1], h[2], h[3])
  if (tag === 'RIFF' || tag === 'FORM') return buf.byteLength * 2
  if (tag === 'fLaC') return buf.byteLength * 5
  return buf.byteLength * 20
}

/** Detect format + prepare source. Returns { format, bytes?, reader? } */
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

/**
 * Decode any source into pages + stats.
 * Pages fill progressively — caller provides pages array + notify callback.
 *
 * Flow:
 *   1. detectSource → { format, bytes?, reader? }
 *   2. Non-streaming: decode whole buffer, paginate, return immediately
 *   3. Streaming: feed chunks → push() accumulates into page buffers → flush() emits full pages
 *      - STREAMABLE formats (mp3/flac/opus/oga) decode in FEED-sized chunks
 *      - Node file reader streams chunks directly
 *      - Non-streamable formats with reader: collect into bytes first
 *   4. Returns after first page; `decoding` promise resolves when done
 *
 * @param {string|ArrayBuffer|Uint8Array|URL} source
 * @param {object} [opts]
 * @param {Array} [opts.pages] — target array (created if omitted)
 * @param {Function} [opts.notify] — called after each page push
 * @param {Function} [opts.onprogress] — progress callback (worker compat)
 * @param {object} [opts.statDict] — stat functions
 */
export async function decodeSource(source, opts = {}) {
  let { pages = [], notify, onprogress, statDict } = opts
  let { format, bytes, reader } = await detectSource(source)

  // ── Non-streaming fallback ────────────────────────────────────────
  if (!format || !decode[format]) {
    if (!bytes) bytes = new Uint8Array(await resolveSource(source))
    let { channelData, sampleRate } = await decode(bytes.buffer || bytes)
    let ps = paginate(channelData)
    for (let p of ps) { pages.push(p); notify?.() }
    let stats = buildStats(statDict || {}, channelData, channelData.length, sampleRate)
    return { pages, sampleRate, channels: channelData.length, decoding: Promise.resolve({ stats, length: channelData[0].length }) }
  }

  // ── Streaming decode ──────────────────────────────────────────────
  let dec = await decode[format]()
  let sr = 0, ch = 0, totalLen = 0, pagePos = 0
  let pageBuf = null, session
  let yieldLoop = () => new Promise(r => setTimeout(r, 0))
  let firstResolve

  function flush(page) {
    session.page(page)
    pages.push(page)
    totalLen += page[0].length
    notify?.()
    if (firstResolve) { firstResolve(); firstResolve = null }
  }

  function push(chData, sampleRate) {
    if (!pageBuf) {
      sr = sampleRate; ch = chData.length
      pageBuf = Array.from({ length: ch }, () => new Float32Array(PAGE_SIZE))
      session = statSession(statDict || {}, ch, sr)
      if (estTotal) estTotal = estTotal / (ch * sr)
    }
    let srcPos = 0, chunkLen = chData[0].length
    while (srcPos < chunkLen) {
      let n = Math.min(chunkLen - srcPos, PAGE_SIZE - pagePos)
      for (let c = 0; c < ch; c++) pageBuf[c].set(chData[c].subarray(srcPos, srcPos + n), pagePos)
      srcPos += n; pagePos += n
      if (pagePos === PAGE_SIZE) {
        flush(pageBuf)
        if (onprogress) {
          let delta = session.delta()
          if (delta) onprogress({ delta, offset: totalLen / sr, total: estTotal, sampleRate: sr, channels: ch, pages })
        }
        pageBuf = Array.from({ length: ch }, () => new Float32Array(PAGE_SIZE))
        pagePos = 0
      }
    }
  }

  let STREAMABLE = new Set(['mp3', 'flac', 'opus', 'oga']), FEED = 64 * 1024

  // For non-streamable formats with a reader, collect into bytes
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

  // Wait for first page
  if (!pages.length) await new Promise(r => { firstResolve = r })
  if (!sr) throw new Error('audio: decoded no audio data')

  return { pages, sampleRate: sr, channels: ch, decoding }
}

/** Spawn worker.js, run decodeSource there, stream progress back. */
export function decodeWorker(buf, onprogress) {
  let worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' })
  return new Promise((resolve, reject) => {
    worker.onmessage = async (e) => {
      let { type, data } = e.data
      if (type === 'progress' && onprogress) await onprogress(data)
      else if (type === 'done') { worker.terminate(); resolve(data) }
      else if (type === 'error') { worker.terminate(); reject(new Error(data)) }
    }
    worker.onerror = (e) => { worker.terminate(); reject(e) }
    let transfer = buf instanceof ArrayBuffer ? [buf] : buf.buffer ? [buf.buffer] : []
    worker.postMessage({ buf }, transfer)
  })
}
