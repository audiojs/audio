/**
 * Decode engine — streaming decode of encoded audio into pages + stats.
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

/**
 * Decode encoded buffer into pages + stats.
 * Streams when format supports it; falls back to whole-file decode.
 */
export async function decodeSource(buf, onprogress, statDict) {
  let bytes = new Uint8Array(buf.buffer || buf)
  let format = getType(bytes)

  // Non-streaming fallback
  if (!format || !decode[format]) {
    let { channelData, sampleRate } = await decode(buf)
    return { pages: paginate(channelData), stats: buildStats(statDict || {}, channelData, channelData.length, sampleRate), sampleRate, channels: channelData.length, length: channelData[0].length }
  }

  // Chunked streaming decode
  let dec = await decode[format]()
  let pages = [], sr = 0, ch = 0, totalLen = 0, pagePos = 0
  let pageBuf = null, session
  let estTotal = estimateSize(buf) / 4

  function flush(page) {
    session.page(page)
    pages.push(page)
  }

  async function push(chData, sampleRate) {
    if (!pageBuf) {
      sr = sampleRate; ch = chData.length
      pageBuf = Array.from({ length: ch }, () => new Float32Array(PAGE_SIZE))
      session = statSession(statDict || {}, ch, sr)
      estTotal = estTotal / (ch * sr)
    }
    let srcPos = 0, chunkLen = chData[0].length
    while (srcPos < chunkLen) {
      let n = Math.min(chunkLen - srcPos, PAGE_SIZE - pagePos)
      for (let c = 0; c < ch; c++) pageBuf[c].set(chData[c].subarray(srcPos, srcPos + n), pagePos)
      srcPos += n; pagePos += n; totalLen += n
      if (pagePos === PAGE_SIZE) {
        flush(pageBuf)
        if (onprogress) {
          let delta = session.delta()
          if (delta) await onprogress({ delta, offset: totalLen / sr, total: estTotal, sampleRate: sr, channels: ch, pages })
        }
        pageBuf = Array.from({ length: ch }, () => new Float32Array(PAGE_SIZE))
        pagePos = 0
      }
    }
  }

  // Feed decoder — chunked for streaming codecs, whole-file for others
  let STREAMABLE = new Set(['mp3', 'flac', 'opus', 'oga']), FEED = 256 * 1024
  let feed = STREAMABLE.has(format)
    ? async () => { for (let off = 0; off < bytes.length; off += FEED) { let r = await dec(bytes.subarray(off, Math.min(off + FEED, bytes.length))); if (r.channelData.length) await push(r.channelData, r.sampleRate) } }
    : async () => { let r = await dec(bytes); if (r.channelData.length) await push(r.channelData, r.sampleRate) }
  await feed()
  let flushed = await dec()
  if (flushed.channelData.length) await push(flushed.channelData, flushed.sampleRate)

  // Partial last page
  if (pagePos > 0) flush(pageBuf.map(c => c.slice(0, pagePos)))
  if (!sr) throw new Error('audio: decoded no audio data')

  // Final progress
  if (onprogress) {
    let delta = session.delta()
    if (delta) await onprogress({ delta, offset: totalLen / sr, total: estTotal, sampleRate: sr, channels: ch, pages })
  }

  return { pages, stats: session.done(), sampleRate: sr, channels: ch, length: totalLen }
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
