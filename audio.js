/**
 * audio — indexed, paged audio document with immutable source and declarative ops.
 *
 * import audio from 'audio'
 * let a = await audio('file.mp3')
 * a.gain(-3).trim().normalize()
 * await a.save('out.wav')
 */

import decode from 'audio-decode'
import encode from 'audio-encode'
import convert from 'pcm-convert'
import AudioBuffer from 'audio-buffer'
import { remix as remixChannels } from 'audio-buffer/util'
import { kWeighting } from 'audio-filter/weighting'
import getType from 'audio-type'

/** Samples per page (2^16) */
export const PAGE_SIZE = 65536
/** Samples per index block */
export const BLOCK_SIZE = 1024

// BS.1770 loudness constants
const GATE_WINDOW = 0.4, ABS_GATE = -70, REL_GATE = -10, LUFS_OFFSET = -0.691


// ── Entry Points ─────────────────────────────────────────────────────────

/** Create audio from any source. Always async. File/URL/bytes → decode. PCM/number → wrap. */
export default async function audio(source, opts = {}) {
  // Deserialize from JSON document: { source, edits, sampleRate, channels, duration }
  if (source && typeof source === 'object' && !Array.isArray(source) && source.edits) {
    if (!source.source) throw new TypeError('audio: cannot restore document without source reference')
    let a = await audio(source.source, opts)
    a.do(...source.edits)
    return a
  }
  let a
  if (Array.isArray(source) && source[0] instanceof Float32Array) a = fromChannels(source, opts)
  else if (typeof source === 'number') a = fromSilence(source, opts)
  else {
    let ref = typeof source === 'string' ? source : source instanceof URL ? source.href : null
    return fromEncoded(await resolve(source), { ...opts, source: ref })
  }
  if (a.cache && a.budget < Infinity) await evictToFit(a)
  return a
}

/** Sync creation from PCM data, AudioBuffer, audio instance, or seconds of silence. */
audio.from = function(source, opts = {}) {
  if (Array.isArray(source) && source[0] instanceof Float32Array) return fromChannels(source, opts)
  if (typeof source === 'number') return fromSilence(source, opts)
  if (source?.pages) {
    // AudioInstance — structural copy: share immutable pages, fresh edit list
    return create(source.pages, opts.sampleRate ?? source.sampleRate,
      opts.channels ?? source.numberOfChannels, source._len,
      { source: source.source, storage: source.storage, cache: source.cache }, source.index)
  }
  if (source?.getChannelData) {
    let chs = Array.from({ length: source.numberOfChannels }, (_, i) => new Float32Array(source.getChannelData(i)))
    return fromChannels(chs, { sampleRate: source.sampleRate, ...opts })
  }
  throw new TypeError('audio.from: expected Float32Array[], AudioBuffer, audio instance, or number')
}

/** Standard loudness targets (LUFS). */
audio.LUFS_STREAMING = -14  // YouTube, Spotify, Apple Music
audio.LUFS_PODCAST   = -16  // general podcast standard
audio.LUFS_BROADCAST = -23  // EBU R128 broadcast

/** Register a custom index field. fn(samples) → number, computed per-channel per-block during decode. */
audio.index = function(name, fn) {
  if (typeof fn !== 'function') throw new TypeError(`audio.index: expected function for '${name}'`)
  if (indexFields[name]) throw new Error(`audio.index: '${name}' already registered`)
  indexFields[name] = fn
}
const indexFields = {}

/** Register a named op. init(...params) → processor(channels, ctx) → channels. */
audio.op = function(name, init) {
  if (typeof init !== 'function') throw new TypeError(`audio.op: expected function for '${name}'`)
  if (ops[name]) throw new Error(`audio.op: '${name}' already registered`)
  let nargs = init.length  // init params = op args count
  ops[name] = { init, nargs }
  proto[name] = function(...args) {
    let opArgs = args.slice(0, nargs), offset = args[nargs], duration = args[nargs + 1]
    return pushEdit(this, { type: name, args: opArgs, offset, duration })
  }
}


// ── Source Resolution (browser + node) ───────────────────────────────────

/** Resolve source to ArrayBuffer. Fetch for URLs/browser, fs for Node file paths. */
async function resolve(source) {
  if (source instanceof ArrayBuffer) return source
  if (source instanceof Uint8Array) return source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength)
  if (source instanceof URL) return resolve(source.href)
  if (typeof source === 'string') {
    // Anything fetchable — URLs, browser paths, data URIs
    if (/^(https?|data|blob):/.test(source) || typeof window !== 'undefined')
      return (await fetch(source)).arrayBuffer()
    // file:// URI — convert to path
    if (source.startsWith('file:')) {
      let { fileURLToPath } = await import('url')
      source = fileURLToPath(source)
    }
    // File path — Node only
    let { readFile } = await import('fs/promises')
    let buf = await readFile(source)
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
  }
  throw new TypeError('audio: unsupported source type')
}


// ── Create ───────────────────────────────────────────────────────────────

/** Create audio instance with pages, pre-built index, and metadata. */
function create(pages, sampleRate, numberOfChannels, length, opts = {}, index) {
  let a = Object.create(proto)
  a.pages = pages
  a.sampleRate = sampleRate
  a.numberOfChannels = numberOfChannels
  a._len = length
  a.source = opts.source ?? null
  a.storage = opts.storage || 'memory'
  a.cache = opts.cache || null
  a.budget = opts.budget ?? Infinity
  a.edits = []
  a.version = 0
  a.onchange = null
  a._cache = null
  a._cacheVer = -1
  a.index = index

  return a
}

/** Create from planar Float32Array channels. Split into pages, build index. */
function fromChannels(channelData, opts = {}) {
  let sr = opts.sampleRate || 44100
  return create(toPages(channelData), sr, channelData.length, channelData[0].length, opts, buildIndex(channelData, channelData.length, sr))
}

/** Create silence of given duration. */
function fromSilence(seconds, opts = {}) {
  let sr = opts.sampleRate || 44100, ch = opts.channels || 1
  return fromChannels(Array.from({ length: ch }, () => new Float32Array(Math.round(seconds * sr))), { ...opts, sampleRate: sr })
}

/** Decode encoded audio, build pages + index. Auto-detect OPFS for large files. */
async function fromEncoded(buf, opts = {}) {
  let storage = opts.storage || 'auto'

  // Auto-detect: use OPFS for large files in browser
  if (storage === 'auto' || storage === 'persistent') {
    let estimatedSize = estimateDecodedSize(buf)
    let budget = opts.budget ?? DEFAULT_BUDGET
    if (estimatedSize > budget && !opts.cache) {
      try {
        opts = { ...opts, cache: await opfsCache(), budget }
      } catch {
        // OPFS not available
        if (storage === 'persistent') throw new Error('OPFS not available (required by storage: "persistent")')
        if (estimatedSize > budget * 4) throw new Error(`File too large (~${(estimatedSize / 1e6).toFixed(0)}MB decoded) and OPFS unavailable. Pass { storage: "memory" } to force.`)
        // Small enough to fit in memory — continue without cache
      }
    }
  }

  let result
  if (opts.decode === 'worker') {
    result = await decodeInWorker(buf, opts.onprogress)
  } else {
    result = await decodeBuf(buf, opts.onprogress)
  }
  let a = create(result.pages, result.sampleRate, result.channels, result.length, opts, result.index)
  if (a.cache && a.budget < Infinity) await evictToFit(a)
  return a
}


/**
 * Decode encoded buffer into pages + index. Shared engine used by main thread and worker.
 * @param {ArrayBuffer} buf - encoded audio data
 * @param {Function} [onprogress] - called with { delta, offset, total } per page
 * @returns {{ pages, index, sampleRate, channels, length }}
 */
export async function decodeBuf(buf, onprogress) {
  let bytes = new Uint8Array(buf.buffer || buf)
  let format = getType(bytes)

  if (!format || !decode[format]) {
    let { channelData, sampleRate } = await decode(buf)
    return { pages: toPages(channelData), index: buildIndex(channelData, channelData.length, sampleRate), sampleRate, channels: channelData.length, length: channelData[0].length }
  }

  // Chunked decode — pages + K-weighted index built incrementally per page.
  let dec = await decode[format]()
  let pages = [], sampleRate = 0, channels = 0, totalLen = 0
  let pageBuf = null, pagePos = 0, kState = null
  let idxMin = null, idxMax = null, idxEnergy = null
  let customNames = Object.keys(indexFields), customIdx = {}
  let lastProgressBlock = 0, estTotal = estimateDecodedSize(buf) / 4

  function init(sr, ch) {
    sampleRate = sr; channels = ch
    pageBuf = Array.from({ length: ch }, () => new Float32Array(PAGE_SIZE))
    kState = Array.from({ length: ch }, () => ({ fs: sr }))
    idxMin = Array.from({ length: ch }, () => [])
    idxMax = Array.from({ length: ch }, () => [])
    idxEnergy = Array.from({ length: ch }, () => [])
    for (let name of customNames) customIdx[name] = Array.from({ length: ch }, () => [])
    estTotal = estTotal / (ch * sr)
  }

  function indexPage(page) {
    let len = page[0].length, blocks = Math.ceil(len / BLOCK_SIZE)
    let kPage = page.map((ch, c) => { let k = new Float32Array(ch); kWeighting(k, kState[c]); return k })
    for (let bi = 0; bi < blocks; bi++) {
      let off = bi * BLOCK_SIZE, end = Math.min(off + BLOCK_SIZE, len)
      for (let c = 0; c < channels; c++) {
        let mn = Infinity, mx = -Infinity, sum = 0
        for (let i = off; i < end; i++) { let v = page[c][i]; if (v < mn) mn = v; if (v > mx) mx = v }
        for (let i = off; i < end; i++) { let v = kPage[c][i]; sum += v * v }
        idxMin[c].push(mn); idxMax[c].push(mx); idxEnergy[c].push(sum / (end - off))
      }
      if (customNames.length) {
        let block = Array.from({ length: channels }, (_, c) => page[c].subarray(off, end))
        for (let name of customNames) {
          let v = indexFields[name](block)
          if (typeof v === 'number') for (let c = 0; c < channels; c++) customIdx[name][c].push(v)
          else for (let c = 0; c < channels; c++) customIdx[name][c].push(v[c])
        }
      }
    }
  }

  function emitDelta() {
    let cur = idxMin[0].length
    if (cur === lastProgressBlock) return
    let delta = { fromBlock: lastProgressBlock, min: idxMin.map(a => new Float32Array(a.slice(lastProgressBlock))), max: idxMax.map(a => new Float32Array(a.slice(lastProgressBlock))), energy: idxEnergy.map(a => new Float32Array(a.slice(lastProgressBlock))) }
    lastProgressBlock = cur
    return { delta, offset: totalLen / sampleRate, total: estTotal }
  }

  async function pushChunk(chData, sr) {
    if (!pageBuf) init(sr, chData.length)
    let chunkLen = chData[0].length, srcPos = 0
    while (srcPos < chunkLen) {
      let n = Math.min(chunkLen - srcPos, PAGE_SIZE - pagePos)
      for (let c = 0; c < channels; c++)
        pageBuf[c].set(chData[c].subarray(srcPos, srcPos + n), pagePos)
      srcPos += n; pagePos += n; totalLen += n
      if (pagePos === PAGE_SIZE) {
        indexPage(pageBuf)
        pages.push(pageBuf)
        pageBuf = Array.from({ length: channels }, () => new Float32Array(PAGE_SIZE))
        pagePos = 0
        if (onprogress) await onprogress(emitDelta())
      }
    }
  }

  // Feed — chunk for WASM streaming codecs, whole-file for simple decoders
  let STREAMABLE = new Set(['mp3', 'flac', 'opus', 'oga'])
  if (STREAMABLE.has(format)) {
    let FEED = 256 * 1024
    for (let off = 0; off < bytes.length; off += FEED) {
      let result = await dec(bytes.subarray(off, Math.min(off + FEED, bytes.length)))
      if (result.channelData.length) await pushChunk(result.channelData, result.sampleRate)
    }
  } else {
    let result = await dec(bytes)
    if (result.channelData.length) await pushChunk(result.channelData, result.sampleRate)
  }
  let flushed = await dec()
  if (flushed.channelData.length) await pushChunk(flushed.channelData, flushed.sampleRate)

  // Partial last page
  if (pagePos > 0) {
    let lastPage = pageBuf.map(ch => ch.slice(0, pagePos))
    indexPage(lastPage)
    pages.push(lastPage)
  }

  if (!sampleRate) throw new Error('audio: decoded no audio data')

  // Final progress
  if (onprogress) { let d = emitDelta(); if (d) await onprogress(d) }

  let index = { blockSize: BLOCK_SIZE, min: idxMin.map(a => new Float32Array(a)), max: idxMax.map(a => new Float32Array(a)), energy: idxEnergy.map(a => new Float32Array(a)) }
  for (let name of customNames) index[name] = customIdx[name].map(a => new Float32Array(a))
  return { pages, index, sampleRate, channels, length: totalLen }
}

/** Spawn worker.js, run decodeBuf there, stream progress back. */
function decodeInWorker(buf, onprogress) {
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


// ── Index ────────────────────────────────────────────────────────────────

/** Split channels into pages of PAGE_SIZE samples. Uses subarray views — no copy. */
function toPages(channelData) {
  let len = channelData[0].length, pages = []
  for (let off = 0; off < len; off += PAGE_SIZE)
    pages.push(channelData.map(ch => ch.subarray(off, Math.min(off + PAGE_SIZE, len))))
  return pages
}

/** Build index from flat PCM: per-channel per-block min, max, energy (K-weighted RMS²) + custom fields. */
function buildIndex(pcm, ch, sr = 44100) {
  let len = pcm[0].length, totalBlocks = Math.ceil(len / BLOCK_SIZE)
  let idx = {
    blockSize: BLOCK_SIZE,
    min: Array.from({ length: ch }, () => new Float32Array(totalBlocks)),
    max: Array.from({ length: ch }, () => new Float32Array(totalBlocks)),
    energy: Array.from({ length: ch }, () => new Float32Array(totalBlocks)),
  }
  let customNames = Object.keys(indexFields)
  for (let name of customNames) idx[name] = Array.from({ length: ch }, () => new Float32Array(totalBlocks))

  // K-weight full PCM per channel (stateful filter — must process contiguously)
  let kPcm = pcm.map(ch => { let out = new Float32Array(ch); return kWeighting(out, { fs: sr }) })

  for (let bi = 0; bi < totalBlocks; bi++) {
    let off = bi * BLOCK_SIZE, end = Math.min(off + BLOCK_SIZE, len)
    for (let c = 0; c < ch; c++) {
      let mn = Infinity, mx = -Infinity, sum = 0
      for (let i = off; i < end; i++) { let v = pcm[c][i]; if (v < mn) mn = v; if (v > mx) mx = v }
      // Energy from K-weighted PCM (BS.1770 compliant)
      for (let i = off; i < end; i++) { let v = kPcm[c][i]; sum += v * v }
      idx.min[c][bi] = mn; idx.max[c][bi] = mx; idx.energy[c][bi] = sum / (end - off)
    }
    if (customNames.length) {
      let block = Array.from({ length: ch }, (_, c) => pcm[c].subarray(off, end))
      for (let name of customNames) {
        let v = indexFields[name](block)
        if (typeof v === 'number') for (let c = 0; c < ch; c++) idx[name][c][bi] = v
        else for (let c = 0; c < ch; c++) idx[name][c][bi] = v[c]
      }
    }
  }
  return idx
}

// ── Page Cache (LRU eviction + restore) ──────────────────────────────────

/** Bytes of PCM data in a page (0 if evicted). */
function pageBytes(page) {
  if (!page) return 0
  return page.reduce((sum, ch) => sum + ch.byteLength, 0)
}

/** Evict pages to cache until resident bytes fit within budget. LRU from start. */
async function evictToFit(a) {
  if (!a.cache || a.budget === Infinity) return
  let current = a.pages.reduce((sum, p) => sum + pageBytes(p), 0)
  for (let i = 0; i < a.pages.length && current > a.budget; i++) {
    if (!a.pages[i]) continue
    await a.cache.write(i, a.pages[i])
    current -= pageBytes(a.pages[i])
    a.pages[i] = null
  }
}

/** Restore all evicted pages from cache backend. */
async function ensurePages(a) {
  if (!a.cache) return
  for (let i = 0; i < a.pages.length; i++)
    if (a.pages[i] === null && await a.cache.has(i)) a.pages[i] = await a.cache.read(i)
}

/** Rebuild index from materialized output when edits exist. */
function refreshIndex(a) {
  if (!a.edits.length) return
  let pcm = renderCached(a)
  a.index = buildIndex(pcm, pcm.length, a.sampleRate)
}

/** Rebuild index by streaming through planChunks — no full PCM buffer in memory. Fallback to refreshIndex for unstreamable edits. */
function rebuildIndexStreaming(a) {
  if (!a.edits.length) return
  let plan = buildPlan(a)
  if (!plan) { refreshIndex(a); return }
  let ch = a.numberOfChannels, totalBlocks = Math.ceil(plan.totalLen / BLOCK_SIZE)
  let idx = {
    blockSize: BLOCK_SIZE,
    min:    Array.from({ length: ch }, () => new Float32Array(totalBlocks).fill(Infinity)),
    max:    Array.from({ length: ch }, () => new Float32Array(totalBlocks).fill(-Infinity)),
    energy: Array.from({ length: ch }, () => new Float32Array(totalBlocks))
  }
  let sampleOff = 0
  for (let chunk of planChunks(a, plan)) {
    for (let c = 0; c < ch; c++) for (let i = 0; i < chunk[c].length; i++) {
      let b = Math.floor((sampleOff + i) / BLOCK_SIZE), v = chunk[c][i]
      if (v < idx.min[c][b]) idx.min[c][b] = v
      if (v > idx.max[c][b]) idx.max[c][b] = v
      idx.energy[c][b] += v * v / BLOCK_SIZE
    }
    sampleOff += chunk[0].length
  }
  for (let c = 0; c < ch; c++) for (let b = 0; b < totalBlocks; b++) {
    if (idx.min[c][b] === Infinity) idx.min[c][b] = 0
    if (idx.max[c][b] === -Infinity) idx.max[c][b] = 0
  }
  a.index = idx
}


// ── Edit History ─────────────────────────────────────────────────────────

/** Push edit to list, bump version, notify. */
function pushEdit(a, edit) {
  a.edits.push(edit)
  a.version++
  a.onchange?.()
  return a
}


// ── Ops Registry ─────────────────────────────────────────────────────────
// All ops registered via audio.op(). init(...params) → processor(channels, ctx) → channels.

const ops = {}


// ── Render (apply edits to source pages → PCM) ──────────────────────────

/** Cached full render: reuse if version unchanged. Internal — returns shared reference. */
function renderCached(a) {
  if (a._cache && a._cacheVer === a.version) return a._cache
  let sr = a.sampleRate, ch = a.numberOfChannels

  // Flatten pages — restore evicted pages from cache on demand
  let flat = Array.from({ length: ch }, () => new Float32Array(a._len))
  let pos = 0
  for (let i = 0; i < a.pages.length; i++) {
    if (!a.pages[i]) { pos += PAGE_SIZE; continue }
    for (let c = 0; c < ch; c++) flat[c].set(a.pages[i][c], pos)
    pos += a.pages[i][0].length
  }

  // Apply edits — one path for all ops
  for (let edit of a.edits) {
    let processor = edit.type === '_fn'
      ? edit.fn                           // inline via .do(fn)
      : ops[edit.type]?.init(...(edit.args || []))  // registered via audio.op()

    if (!processor) throw new Error(`Unknown op: ${edit.type}`)
    // Normalize negative offset: -1 = 1s from end
    let off = edit.offset != null && edit.offset < 0 ? flat[0].length / sr + edit.offset : edit.offset
    let result = processor(flat, { offset: off, duration: edit.duration, sampleRate: sr })
    if (result === false || result === null) continue  // skip this op
    if (result) flat = result
  }

  a._cache = flat
  a._cacheVer = a.version
  return flat
}


// ── Read Plan (streaming render) ─────────────────────────────────────
// Structural edits → segment map. Sample edits → pipeline.
// Stream: read source pages per plan, apply pipeline per chunk. No full render.

const STRUCTURAL = new Set(['crop', 'remove', 'insert', 'repeat', 'reverse'])

function planLen(segs) { let m = 0; for (let s of segs) m = Math.max(m, s.out + s.len); return m }

function planCrop(segs, off, len) {
  let r = [], end = off + len
  for (let s of segs) {
    let a = Math.max(s.out, off), b = Math.min(s.out + s.len, end)
    if (a < b) r.push({ src: s.src + a - s.out, out: a - off, len: b - a, ref: s.ref })
  }
  return r
}

function planRemove(segs, off, dur) {
  let r = [], end = off + dur
  for (let s of segs) {
    let se = s.out + s.len
    if (se <= off) r.push(s)
    else if (s.out >= end) r.push({ ...s, out: s.out - dur })
    else {
      if (s.out < off) r.push({ src: s.src, out: s.out, len: off - s.out, ref: s.ref })
      if (se > end) r.push({ src: s.src + end - s.out, out: off, len: se - end, ref: s.ref })
    }
  }
  return r
}

const SILENCE = Symbol('silence')

function planInsert(segs, at, len, ref) {
  let r = []
  for (let s of segs) {
    if (s.out + s.len <= at) r.push(s)
    else if (s.out >= at) r.push({ ...s, out: s.out + len })
    else {
      let f = at - s.out
      r.push({ src: s.src, out: s.out, len: f, ref: s.ref })
      r.push({ src: s.src + f, out: at + len, len: s.len - f, ref: s.ref })
    }
  }
  // Always add the inserted segment: ref for audio, SILENCE sentinel for silence
  r.push({ src: 0, out: at, len, ref: ref || SILENCE })
  r.sort((a, b) => a.out - b.out)
  return r
}

function planRepeat(segs, times, total, off, dur) {
  if (off == null) {
    let r = []
    for (let t = 0; t <= times; t++)
      for (let s of segs) r.push({ ...s, out: s.out + total * t })
    return r
  }
  let segLen = dur ?? (total - off), clip = planCrop(segs, off, segLen), r = []
  for (let s of segs) {
    let se = s.out + s.len
    if (se <= off + segLen) r.push(s)
    else if (s.out >= off + segLen) r.push({ ...s, out: s.out + segLen * times })
    else {
      r.push({ src: s.src, out: s.out, len: off + segLen - s.out, ref: s.ref })
      r.push({ src: s.src + off + segLen - s.out, out: off + segLen * (times + 1), len: se - off - segLen, ref: s.ref })
    }
  }
  for (let t = 1; t <= times; t++)
    for (let c of clip) r.push({ ...c, out: off + segLen * t + c.out })
  r.sort((a, b) => a.out - b.out)
  return r
}

function planReverse(segs, off, end) {
  let r = []
  for (let s of segs) {
    let se = s.out + s.len
    if (se <= off || s.out >= end) { r.push(s); continue }
    if (s.out < off) r.push({ src: s.src, out: s.out, len: off - s.out, ref: s.ref, rev: s.rev })
    let iStart = Math.max(s.out, off), iEnd = Math.min(se, end)
    r.push({ src: s.src + iStart - s.out, out: off + end - iEnd, len: iEnd - iStart, ref: s.ref, rev: !s.rev })
    if (se > end) r.push({ src: s.src + end - s.out, out: end, len: se - end, ref: s.ref, rev: s.rev })
  }
  r.sort((a, b) => a.out - b.out)
  return r
}

/** Build a read plan from edit list. Returns null if not streamable. */
function buildPlan(a) {
  let sr = a.sampleRate, segs = [{ src: 0, out: 0, len: a._len }], pipeline = [], sawSample = false

  for (let edit of a.edits) {
    let { type, args = [], offset: eOff, duration: eDur } = edit
    if (type === '_fn') return null  // inline fns need full buffer

    if (STRUCTURAL.has(type)) {
      if (sawSample) return null  // sample before structural → can't stream
      let total = planLen(segs)
      let s = eOff != null ? Math.round((eOff < 0 ? total / sr + eOff : eOff) * sr) : null

      if (type === 'crop') segs = planCrop(segs, s || 0, eDur != null ? Math.round(eDur * sr) : total - (s || 0))
      else if (type === 'remove') segs = planRemove(segs, s || 0, Math.round((eDur || 0) * sr))
      else if (type === 'insert') {
        let source = args[0], at = s ?? total
        let iLen = typeof source === 'number' ? Math.round(source * sr) : source.length
        if (eDur != null) iLen = Math.min(iLen, Math.round(eDur * sr))
        segs = planInsert(segs, at, iLen, typeof source === 'number' ? null : source)
      }
      else if (type === 'repeat') segs = planRepeat(segs, args[0] || 1, total, eOff != null ? s : null, eDur != null ? Math.round(eDur * sr) : null)
      else if (type === 'reverse') { let rOff = s ?? 0; segs = planReverse(segs, rOff, rOff + (eDur != null ? Math.round(eDur * sr) : total - rOff)) }
    } else {
      if (!ops[type]) return null
      sawSample = true
      pipeline.push(edit)
    }
  }
  return { segs, pipeline, totalLen: planLen(segs), sr }
}

/** Read samples directly from source pages at [srcOff, srcOff+len). rev reads backwards. */
function readSource(a, c, srcOff, len, target, tOff, rev = false) {
  let pos = 0
  for (let p = 0; p < a.pages.length && pos < srcOff + len; p++) {
    let pg = a.pages[p], pLen = pg ? pg[0].length : PAGE_SIZE
    if (pos + pLen > srcOff) {
      let s = Math.max(srcOff - pos, 0), e = Math.min(srcOff + len - pos, pLen)
      if (pg) {
        if (rev) {
          for (let i = s; i < e; i++) target[tOff + (srcOff + len - 1 - (pos + i))] = pg[c][i]
        } else {
          target.set(pg[c].subarray(s, e), tOff + Math.max(pos - srcOff, 0))
        }
      }
    }
    pos += pLen
  }
}

/** Stream chunks from a read plan. Yields Float32Array[] per chunk. */
function* planChunks(a, plan, offset, duration) {
  let { segs, pipeline, totalLen, sr } = plan
  let s = Math.round((offset || 0) * sr), e = duration != null ? s + Math.round(duration * sr) : totalLen

  // Instantiate sample op processors (resolve negative offsets)
  let totalDur = totalLen / sr
  let procs = pipeline.map(ed => ({ proc: ops[ed.type].init(...(ed.args || [])), off: ed.offset != null && ed.offset < 0 ? totalDur + ed.offset : ed.offset, dur: ed.duration }))

  for (let outOff = s; outOff < e; outOff += PAGE_SIZE) {
    let len = Math.min(PAGE_SIZE, e - outOff)
    let chunk = Array.from({ length: a.numberOfChannels }, () => new Float32Array(len))

    // Fill from plan segments
    for (let seg of segs) {
      let iStart = Math.max(outOff, seg.out), iEnd = Math.min(outOff + len, seg.out + seg.len)
      if (iStart >= iEnd) continue
      let srcStart = seg.src + (iStart - seg.out), dstOff = iStart - outOff, n = iEnd - iStart
      if (seg.ref === SILENCE) {
        // Silence — chunk already zero-filled
      } else if (seg.ref) {
        if (seg.ref.edits.length === 0) {
          // Clean source — stream directly from pages
          for (let c = 0; c < a.numberOfChannels; c++)
            readSource(seg.ref, c % seg.ref.numberOfChannels, srcStart, n, chunk[c], dstOff, seg.rev)
        } else {
          // Source with edits — materialize full render
          let srcPcm = renderCached(seg.ref)
          for (let c = 0; c < a.numberOfChannels; c++) {
            let src = srcPcm[c % srcPcm.length]
            if (seg.rev) { for (let i = 0; i < n; i++) chunk[c][dstOff + i] = src[srcStart + n - 1 - i] }
            else chunk[c].set(src.subarray(srcStart, srcStart + n), dstOff)
          }
        }
      } else {
        for (let c = 0; c < a.numberOfChannels; c++) readSource(a, c, srcStart, n, chunk[c], dstOff, seg.rev)
      }
    }

    // Apply sample pipeline with translated offset + blockOffset
    let blockOff = outOff / sr
    for (let { proc, off, dur } of procs) {
      let adjOff = off != null ? off - blockOff : undefined
      let result = proc(chunk, { offset: adjOff, duration: dur, sampleRate: sr, blockOffset: blockOff })
      if (result === false || result === null) continue
      if (result) chunk = result
    }

    yield chunk
  }
}


/** Yield PAGE_SIZE chunks from a flat PCM render. */
function* chunksFromPcm(pcm) {
  for (let off = 0; off < pcm[0].length; off += PAGE_SIZE)
    yield pcm.map(ch => ch.slice(off, Math.min(off + PAGE_SIZE, pcm[0].length)))
}

/** Read directly from source pages (no edits). */
function readPages(a, offset, duration) {
  let sr = a.sampleRate, ch = a.numberOfChannels
  let s = offset != null ? Math.round(offset * sr) : 0
  let len = duration != null ? Math.round(duration * sr) : a._len - s
  let out = Array.from({ length: ch }, () => new Float32Array(len))
  for (let c = 0; c < ch; c++) readSource(a, c, s, len, out[c], 0)
  return out
}

/** Collect plan chunks into flat channel arrays. */
function readPlan(a, plan, offset, duration) {
  let chunks = []
  for (let chunk of planChunks(a, plan, offset, duration)) chunks.push(chunk)
  if (!chunks.length) return Array.from({ length: a.channels }, () => new Float32Array(0))
  let ch = chunks[0].length, totalLen = chunks.reduce((n, c) => n + c[0].length, 0)
  return Array.from({ length: ch }, (_, c) => {
    let out = new Float32Array(totalLen), pos = 0
    for (let chunk of chunks) { out.set(chunk[c], pos); pos += chunk[0].length }
    return out
  })
}


// ── Prototype (methods on every audio instance) ──────────────────────────

const proto = {
  get length() {
    let len = this._len, sr = this.sampleRate
    for (let { type, args = [], offset: off, duration: dur } of this.edits) {
      if (type === 'crop') {
        let s = off != null ? (off < 0 ? len / sr + off : off) : 0
        len = dur != null ? Math.round(dur * sr) : len - Math.round(s * sr)
      } else if (type === 'remove') len -= Math.round((dur || 0) * sr)
      else if (type === 'insert') {
        let n = typeof args[0] === 'number' ? Math.round(args[0] * sr) : args[0]?.length || 0
        len += dur != null ? Math.min(n, Math.round(dur * sr)) : n
      } else if (type === 'repeat') {
        let t = args[0] || 1
        if (off == null) len *= t + 1
        else {
          let s = off < 0 ? len / sr + off : off
          len += (dur != null ? Math.round(dur * sr) : len - Math.round(s * sr)) * t
        }
      }
    }
    return len
  },
  get duration() { return this.length / this.sampleRate },
  get channels() {
    let ch = this.numberOfChannels
    for (let edit of this.edits) if (edit.type === 'remix') ch = edit.args[0]
    return ch
  },

  // Smart ops — analyze index, then queue a basic op
  trim(threshold) {
    if (this.edits.length) rebuildIndexStreaming(this)
    if (threshold === undefined) {
      let energies = []
      for (let c = 0; c < this.numberOfChannels; c++)
        for (let e of this.index.energy[c]) if (e > 0) energies.push(e)
      if (energies.length) {
        energies.sort((a, b) => a - b)
        let floor = energies[Math.floor(energies.length * 0.1)]
        threshold = Math.max(-80, Math.min(-20, 10 * Math.log10(floor) + 12))
      } else threshold = -40
    }
    let thresh = 10 ** (threshold / 20), blocks = this.index.min[0].length
    let s = 0, e = blocks - 1
    for (; s < blocks; s++) if (isBlockLoud(this, s, thresh)) break
    for (; e >= s; e--) if (isBlockLoud(this, e, thresh)) break
    let ss = findThresholdCrossing(this, s, thresh, 'start'), se = findThresholdCrossing(this, e, thresh, 'end')
    return pushEdit(this, { type: 'crop', args: [], offset: ss / this.sampleRate, duration: Math.max(0, (se - ss) / this.sampleRate) })
  },
  normalize(targetDb = 0, { mode = 'peak' } = {}) {
    if (mode === 'lufs') {
      let eSum = 0, n = 0
      for (let c = 0; c < this.numberOfChannels; c++)
        for (let e of this.index.energy[c]) { eSum += e; n++ }
      if (!eSum) return this
      let lufs = LUFS_OFFSET + 10 * Math.log10(eSum / n)
      return pushEdit(this, { type: 'gain', args: [targetDb - lufs] })
    }
    let peak = 0
    for (let c = 0; c < this.numberOfChannels; c++)
      for (let i = 0; i < this.index.max[c].length; i++)
        peak = Math.max(peak, Math.abs(this.index.max[c][i]), Math.abs(this.index.min[c][i]))
    if (!peak) return this
    return pushEdit(this, { type: 'gain', args: [targetDb - 20 * Math.log10(peak)] })
  },

  undo(n = 1) {
    if (!this.edits.length) return n === 1 ? null : []
    let removed = []
    for (let i = 0; i < n && this.edits.length; i++) {
      removed.push(this.edits.pop())
      this.version++
    }
    if (removed.length) this.onchange?.()
    return n === 1 ? removed[0] : removed
  },
  do(...edits) {
    for (let e of edits) {
      if (typeof e === 'function') pushEdit(this, { type: '_fn', fn: e })
      else if (Array.isArray(e.args)) pushEdit(this, e)
      else throw new TypeError(`audio.do: edit must have args array`)
    }
    return this
  },

  // Views — create shared instances
  view(offset, duration) {
    let inst = create(this.pages, this.sampleRate, this.numberOfChannels, this._len,
      { source: this.source, storage: this.storage, cache: this.cache }, this.index)
    return offset != null || duration != null
      ? pushEdit(inst, { type: 'crop', args: [], offset: offset ?? 0,
          duration: duration ?? Math.max(0, this.duration - (offset ?? 0)) })
      : inst
  },
  split(...args) {
    let offsets = Array.isArray(args[0]) ? args[0] : args
    let dur = this.duration
    let cuts = [0, ...[...offsets].sort((a, b) => a - b).filter(t => t > 0 && t < dur), dur]
    return cuts.slice(0, -1).map((start, i) => this.view(start, cuts[i + 1] - start))
  },

  // Output — read() is the universal output. Format determines return type.
  async read(offset, duration, opts) {
    // Normalize args: read(opts), read(offset, opts), read(offset, duration, opts)
    if (typeof offset === 'object' && !opts) { opts = offset; offset = undefined }
    else if (typeof duration === 'object' && !opts) { opts = duration; duration = undefined }
    let fmt = opts?.format
    await ensurePages(this)

    // No edits → read directly from source pages (zero-copy for full read)
    let pcm
    if (!this.edits.length) pcm = readPages(this, offset, duration)
    else {
      // Plan-based streaming when possible, full render fallback
      let plan = buildPlan(this)
      pcm = plan ? readPlan(this, plan, offset, duration) : renderCached(this).map(ch => {
        if (offset == null) return ch.slice()
        let s = Math.round(offset * this.sampleRate)
        return ch.slice(s, duration != null ? s + Math.round(duration * this.sampleRate) : ch.length)
      })
    }

    // Codec format → encode to bytes
    if (fmt && encode[fmt]) return encode[fmt](pcm, { sampleRate: this.sampleRate, ...opts?.meta })

    // PCM format conversion via pcm-convert
    if (fmt) return pcm.map(ch => convert(ch, 'float32', fmt))

    return pcm
  },
  async save(target, opts = {}) {
    let fmt = opts.format ?? (typeof target === 'string' ? target.split('.').pop() : 'wav')
    let bytes = await this.read({ format: fmt, meta: opts.meta })
    if (typeof target === 'string') {
      let { writeFile } = await import('fs/promises')
      await writeFile(target, Buffer.from(bytes))
    } else if (target?.write) { await target.write(bytes); await target.close?.() }
  },

  // Analysis — uses index directly when clean; rebuilds from rendered PCM when dirty
  async stat(offset, duration) {
    await ensurePages(this)
    if (this.edits.length) rebuildIndexStreaming(this)
    let { min, max, energy } = this.index
    let sb = offset != null ? Math.floor(offset * this.sampleRate / BLOCK_SIZE) : 0
    let eb = duration != null ? Math.ceil((offset + duration) * this.sampleRate / BLOCK_SIZE) : min[0].length
    // min, max, rms from index
    let mn = Infinity, mx = -Infinity, eSum = 0, eN = 0
    for (let c = 0; c < this.numberOfChannels; c++)
      for (let i = sb; i < Math.min(eb, min[c].length); i++) {
        if (min[c][i] < mn) mn = min[c][i]; if (max[c][i] > mx) mx = max[c][i]
        eSum += energy[c][i]; eN++
      }
    let rms = eN ? Math.sqrt(eSum / eN) : 0
    let peak = Math.max(Math.abs(mn), Math.abs(mx))
    let peakDb = peak > 0 ? 20 * Math.log10(peak) : -Infinity
    // LUFS: BS.1770 gating over K-weighted energy
    let winBlocks = Math.ceil(GATE_WINDOW * this.sampleRate / BLOCK_SIZE), gates = []
    for (let i = sb; i < eb; i += winBlocks) {
      let we = Math.min(i + winBlocks, eb), sum = 0, n = 0
      for (let c = 0; c < this.numberOfChannels; c++) for (let j = i; j < we; j++) { sum += energy[c][j]; n++ }
      if (n > 0) gates.push(sum / n)
    }
    let absT = 10 ** (ABS_GATE / 10), gated = gates.filter(g => g > absT)
    let loudness = -Infinity
    if (gated.length) {
      let mean = gated.reduce((a, b) => a + b, 0) / gated.length
      let final = gated.filter(g => g > mean * 10 ** (REL_GATE / 10))
      if (final.length) loudness = LUFS_OFFSET + 10 * Math.log10(final.reduce((a, b) => a + b, 0) / final.length)
    }
    return { min: mn, max: mx, rms, peak: peakDb, loudness }
  },
  async peaks(count, offset, duration, opts) {
    // Support shorthand: peaks(count, opts)
    if (typeof offset === 'object') { opts = offset; offset = undefined; duration = undefined }
    await ensurePages(this)
    if (this.edits.length) rebuildIndexStreaming(this)
    let { min, max } = this.index, sr = this.sampleRate
    let sb = offset != null ? Math.floor(offset * sr / BLOCK_SIZE) : 0
    let eb = duration != null ? Math.ceil((offset + duration) * sr / BLOCK_SIZE) : min[0].length
    let total = eb - sb, bpp = total / count

    if (opts?.channels) {
      return {
        min: Array.from({ length: this.numberOfChannels }, (_, c) => {
          let out = new Float32Array(count)
          for (let i = 0; i < count; i++) {
            let from = sb + Math.floor(i * bpp), to = sb + Math.floor((i + 1) * bpp)
            if (to <= from) to = from + 1  // Ensure at least one block per bucket
            let v = Infinity
            for (let j = from; j < Math.min(to, eb); j++) if (min[c][j] < v) v = min[c][j]
            out[i] = v === Infinity ? 0 : v
          }
          return out
        }),
        max: Array.from({ length: this.numberOfChannels }, (_, c) => {
          let out = new Float32Array(count)
          for (let i = 0; i < count; i++) {
            let from = sb + Math.floor(i * bpp), to = sb + Math.floor((i + 1) * bpp)
            if (to <= from) to = from + 1  // Ensure at least one block per bucket
            let v = -Infinity
            for (let j = from; j < Math.min(to, eb); j++) if (max[c][j] > v) v = max[c][j]
            out[i] = v === -Infinity ? 0 : v
          }
          return out
        })
      }
    }
    let cS = opts?.channel ?? 0, cE = opts?.channel != null ? cS + 1 : this.numberOfChannels
    let outMin = new Float32Array(count), outMax = new Float32Array(count)
    for (let i = 0; i < count; i++) {
      let from = sb + Math.floor(i * bpp), to = sb + Math.floor((i + 1) * bpp)
      if (to <= from) to = from + 1  // Ensure at least one block per bucket when bpp < 1
      let mn = Infinity, mx = -Infinity
      for (let c = cS; c < cE; c++) for (let j = from; j < Math.min(to, eb); j++) {
        if (min[c][j] < mn) mn = min[c][j]; if (max[c][j] > mx) mx = max[c][j]
      }
      outMin[i] = mn === Infinity ? 0 : mn; outMax[i] = mx === -Infinity ? 0 : mx
    }
    return { min: outMin, max: outMax }
  },

  // Playback — Web Audio API in browser, audio-speaker in Node
  play(offset = 0, duration) {
    let a = this
    let isNode = typeof process !== 'undefined' && process.versions?.node
    let ctrl = { playing: false, currentTime: offset, ontimeupdate: null, onended: null,
      pause() { ctrl.playing = false },
      stop() { ctrl.playing = false; ctrl._stopRequested = true; ctrl._source?.stop?.(); ctrl._source?.disconnect?.() } }

    if (isNode) {
      return playNode(a, offset, duration, ctrl)
    } else {
      return playBrowser(a, offset, duration, ctrl)
    }
  },

  // Streaming — plan-based when possible, otherwise cached render
  async *stream(offset, duration) {
    await ensurePages(this)
    let plan = buildPlan(this)
    if (plan) {
      let seen = new Set(); for (let s of plan.segs) if (s.ref && s.ref !== SILENCE && !seen.has(s.ref)) { seen.add(s.ref); await ensurePages(s.ref) }
      for (let chunk of planChunks(this, plan, offset, duration)) yield chunk
    } else yield* chunksFromPcm(renderCached(this))
  },

  /** Cursor position (seconds). Preloads nearby pages for immediate playback. */
  get cursor() { return this._cursor || 0 },
  set cursor(t) {
    this._cursor = t
    let page = Math.floor(t * this.sampleRate / PAGE_SIZE)
    if (this.cache) (async () => {
      for (let i = Math.max(0, page - 1); i <= Math.min(page + 2, this.pages.length - 1); i++)
        if (this.pages[i] === null && await this.cache.has(i)) this.pages[i] = await this.cache.read(i)
    })()
  },

  toJSON() { return { source: this.source, edits: this.edits, sampleRate: this.sampleRate, channels: this.numberOfChannels, duration: this.duration } },
}


// ── Playback Backends ───────────────────────────────────────────────────

/** Node.js playback via audio-speaker. */
function playNode(a, offset, duration, ctrl) {
  ;(async () => {
    try {
      await ensurePages(a)
      let plan = buildPlan(a)
      if (plan) { let seen = new Set(); for (let s of plan.segs) if (s.ref && s.ref !== SILENCE && !seen.has(s.ref)) { seen.add(s.ref); await ensurePages(s.ref) } }
      let Speaker = (await import('audio-speaker')).default
      let ch = a.channels
      let write = Speaker({ sampleRate: a.sampleRate, channels: ch, bitDepth: 32 })
      ctrl.playing = true

      let chunks = plan ? planChunks(a, plan, offset, duration) : chunksFromPcm(renderCached(a))

      let played = 0
      for (let chunk of chunks) {
        if (!ctrl.playing) break
        let len = chunk[0].length
        let buf = new Float32Array(len * ch)
        for (let i = 0; i < len; i++) for (let c = 0; c < ch; c++) buf[i * ch + c] = (chunk[c] || chunk[0])[i]
        await new Promise(r => write(new Uint8Array(buf.buffer), r))
        played += len
        ctrl.currentTime = offset + played / a.sampleRate
        ctrl.ontimeupdate?.(ctrl.currentTime)
      }
      write(null); ctrl.playing = false; ctrl.onended?.()
    } catch (err) {
      console.error('Playback error:', err)
      ctrl.playing = false
    }
  })()
  return ctrl
}

/** Browser playback via Web Audio API. */
function playBrowser(a, offset, duration, ctrl) {
  ;(async () => {
    try {
      await ensurePages(a)
      let plan = buildPlan(a)
      if (plan) { let seen = new Set(); for (let s of plan.segs) if (s.ref && s.ref !== SILENCE && !seen.has(s.ref)) { seen.add(s.ref); await ensurePages(s.ref) } }

      // Get Web Audio API context
      let AudioContextClass = window.AudioContext || window.webkitAudioContext
      let ctx = new AudioContextClass()
      let ch = a.channels

      // Render audio to buffer (or stream for large files)
      let pcm = plan ? readPlan(a, plan, offset, duration) : renderCached(a).map(ch => {
        if (offset == null) return ch.slice()
        let s = Math.round(offset * a.sampleRate)
        return ch.slice(s, duration != null ? s + Math.round(duration * a.sampleRate) : ch.length)
      })

      // Create AudioBuffer
      let buf = ctx.createBuffer(ch, pcm[0].length, a.sampleRate)
      for (let c = 0; c < ch; c++) buf.getChannelData(c).set(pcm[c])

      // Create and start source
      let source = ctx.createBufferSource()
      source.buffer = buf
      source.connect(ctx.destination)

      ctrl._source = source
      ctrl.playing = true
      let startTime = ctx.currentTime - offset
      source.start(0, offset)

      // Update currentTime periodically
      let updateInterval = setInterval(() => {
        if (ctrl.playing) {
          let elapsed = ctx.currentTime - startTime
          ctrl.currentTime = Math.max(offset, Math.min(offset + buf.duration, elapsed))
          ctrl.ontimeupdate?.(ctrl.currentTime)
        } else {
          clearInterval(updateInterval)
        }
      }, 50)

      // Handle end
      source.onended = () => {
        clearInterval(updateInterval)
        ctrl.playing = false
        ctrl.currentTime = offset + buf.duration
        ctrl.onended?.()
      }
    } catch (err) {
      console.error('Playback error:', err)
      ctrl.playing = false
    }
  })()
  return ctrl
}


// ── Helpers ──────────────────────────────────────────────────────────────

/** Check if any channel in this block exceeds threshold (for trim). */
function isBlockLoud(a, block, thresh) {
  for (let c = 0; c < a.numberOfChannels; c++)
    if (Math.abs(a.index.max[c][block]) > thresh || Math.abs(a.index.min[c][block]) > thresh) return true
  return false
}

/** Find exact sample where audio crosses threshold within a block (trim precision). */
function findThresholdCrossing(a, blockIdx, thresh, side) {
  let sampleStart = blockIdx * BLOCK_SIZE, pageIdx = Math.floor(sampleStart / PAGE_SIZE), pg = a.pages[pageIdx]
  if (!pg) return sampleStart
  let off = sampleStart - pageIdx * PAGE_SIZE, end = Math.min(off + BLOCK_SIZE, pg[0].length)
  if (side === 'start') {
    for (let i = off; i < end; i++) for (let c = 0; c < a.numberOfChannels; c++)
      if (Math.abs(pg[c][i]) > thresh) return pageIdx * PAGE_SIZE + i
  } else {
    for (let i = end - 1; i >= off; i--) for (let c = 0; c < a.numberOfChannels; c++)
      if (Math.abs(pg[c][i]) > thresh) return pageIdx * PAGE_SIZE + i + 1
  }
  return sampleStart
}

// ── OPFS Cache Backend ───────────────────────────────────────────────────

/** Create an OPFS-backed cache backend. Browser only. */
export async function opfsCache(dirName = 'audio-cache') {
  if (typeof navigator === 'undefined' || !navigator.storage?.getDirectory)
    throw new Error('OPFS not available in this environment')
  let root = await navigator.storage.getDirectory()
  let dir = await root.getDirectoryHandle(dirName, { create: true })

  return {
    async read(i) {
      let handle = await dir.getFileHandle(`p${i}`)
      let file = await handle.getFile()
      let buf = await file.arrayBuffer()
      // Reconstruct planar channels from interleaved storage: [channels, ...data]
      let view = new Float32Array(buf)
      let ch = view[0], samplesPerCh = (view.length - 1) / ch
      let data = []
      for (let c = 0; c < ch; c++) data.push(view.slice(1 + c * samplesPerCh, 1 + (c + 1) * samplesPerCh))
      return data
    },
    async write(i, data) {
      let handle = await dir.getFileHandle(`p${i}`, { create: true })
      let writable = await handle.createWritable()
      // Store as: [channelCount, ...ch0, ...ch1, ...]
      let total = 1 + data.reduce((s, ch) => s + ch.length, 0)
      let packed = new Float32Array(total)
      packed[0] = data.length
      let off = 1
      for (let ch of data) { packed.set(ch, off); off += ch.length }
      await writable.write(packed.buffer)
      await writable.close()
    },
    has(i) {
      return dir.getFileHandle(`p${i}`).then(() => true, () => false)
    },
    async evict(i) {
      try { await dir.removeEntry(`p${i}`) } catch {}
    },
    async clear() {
      for await (let [name] of dir) await dir.removeEntry(name)
    }
  }
}

/** Rough estimate of decoded float32 byte count from encoded buffer. Peeks at format. */
function estimateDecodedSize(buf) {
  let h = new Uint8Array(buf, 0, 4), tag = String.fromCharCode(h[0], h[1], h[2], h[3])
  if (tag === 'RIFF' || tag === 'FORM') return buf.byteLength * 2  // WAV/AIFF: int16→float32
  if (tag === 'fLaC') return buf.byteLength * 5                     // FLAC: lossless
  return buf.byteLength * 20                                        // lossy: MP3/OGG/AAC
}

const DEFAULT_BUDGET = 500 * 1024 * 1024  // 500MB


// ── Built-in Ops ─────────────────────────────────────────────────────────
// Registered via audio.op() — same mechanism as custom ops.

audio.op('crop', () => (chs, { offset = 0, duration, sampleRate: sr }) => {
  let s = Math.round(offset * sr)
  let end = duration != null ? s + Math.round(duration * sr) : chs[0].length
  return chs.map(ch => ch.slice(s, Math.min(end, ch.length)))
})

audio.op('remove', () => (chs, { offset = 0, duration = 0, sampleRate: sr }) => {
  let s = Math.round(offset * sr), d = Math.round(duration * sr)
  return chs.map(ch => {
    let o = new Float32Array(ch.length - d)
    o.set(ch.subarray(0, s))
    o.set(ch.subarray(s + d), s)
    return o
  })
})

audio.op('insert', (source) => (chs, { offset, duration, sampleRate: sr }) => {
    let src = typeof source === 'number'
      ? Array.from({ length: chs.length }, () => new Float32Array(Math.round(source * sr)))
      : renderCached(source)
    // Crop source to duration if specified
    if (duration != null) {
      let n = Math.round(duration * sr)
      src = src.map(ch => ch.slice(0, n))
    }
    let p = Math.round((offset ?? chs[0].length / sr) * sr)
    return chs.map((ch, c) => {
      let ins = src[c] || new Float32Array(src[0].length)
      let o = new Float32Array(ch.length + ins.length)
      o.set(ch.subarray(0, p))
      o.set(ins, p)
      o.set(ch.subarray(p), p + ins.length)
      return o
    })
})

audio.op('repeat', (times) => (chs, { offset, duration, sampleRate: sr }) => {
  let t = times || 1
  if (offset == null) {
    // Repeat whole audio
    return chs.map(ch => {
      let o = new Float32Array(ch.length * (t + 1))
      for (let i = 0; i <= t; i++) o.set(ch, i * ch.length)
      return o
    })
  }
  // Repeat a segment in place: [before][segment × (t+1)][after]
  let s = Math.round(offset * sr)
  let e = duration != null ? s + Math.round(duration * sr) : chs[0].length
  let segLen = e - s
  return chs.map(ch => {
    let o = new Float32Array(ch.length + segLen * t)
    o.set(ch.subarray(0, s))
    for (let i = 0; i <= t; i++) o.set(ch.subarray(s, e), s + i * segLen)
    o.set(ch.subarray(e), s + (t + 1) * segLen)
    return o
  })
})

audio.op('gain', (db) => (chs, { offset, duration, sampleRate: sr }) => {
  let f = 10 ** (db / 20)
  let s = offset != null ? Math.round(offset * sr) : 0
  let end = duration != null ? s + Math.round(duration * sr) : chs[0].length
  return chs.map(ch => {
    let o = new Float32Array(ch)
    for (let i = s; i < Math.min(end, o.length); i++) o[i] *= f
    return o
  })
})

const FADE_CURVES = { linear: t => t, exp: t => t * t, log: t => Math.sqrt(t), cos: t => (1 - Math.cos(t * Math.PI)) / 2 }

audio.op('fade', (dur, curve) => {
  let fn = FADE_CURVES[curve] ?? FADE_CURVES.linear
  let fadeIn = dur > 0, n = Math.abs(dur)

  return (chs, { offset, sampleRate: sr, blockOffset = 0 }) => {
    // Fade-out with no explicit offset → auto-position at end
    let fadeStart = offset != null
      ? Math.round((offset + blockOffset) * sr)
      : fadeIn ? Math.round(blockOffset * sr) : chs[0].length - Math.round(n * sr)
    let samples = Math.round(n * sr)
    let chunkStart = Math.round(blockOffset * sr)
    return chs.map(ch => {
      let o = new Float32Array(ch)
      for (let i = 0; i < o.length; i++) {
        let fi = chunkStart + i - fadeStart
        if (fi < 0 || fi >= samples) continue
        o[i] *= fn(fadeIn ? fi / samples : 1 - fi / samples)
      }
      return o
    })
  }
})

audio.op('reverse', () => (chs, { offset, duration, sampleRate: sr }) => {
  let s = offset != null ? Math.round(offset * sr) : 0
  let end = duration != null ? s + Math.round(duration * sr) : chs[0].length
  return chs.map(ch => { let o = new Float32Array(ch); o.subarray(s, Math.min(end, o.length)).reverse(); return o })
})

audio.op('mix', (source) => (chs, { offset, duration, sampleRate: sr }) => {
  let p = offset != null ? Math.round(offset * sr) : 0, src = renderCached(source)
  return chs.map((ch, c) => {
    let o = new Float32Array(ch), m = src[c] || src[0]
    let n = duration != null ? Math.round(duration * sr) : m.length
    for (let i = 0; i < Math.min(n, m.length) && p + i < o.length; i++) o[p + i] += m[i]
    return o
  })
})

audio.op('write', (data) => (chs, { offset = 0, sampleRate: sr }) => {
  let p = Math.round(offset * sr)
  return chs.map((ch, c) => {
    let o = new Float32Array(ch)
    let s = Array.isArray(data) ? (data[c] || data[0]) : data
    for (let i = 0; i < s.length && p + i < o.length; i++) o[p + i] = s[i]
    return o
  })
})

/** Remix channels: mono→stereo, stereo→mono, etc. Uses audio-buffer/util remix. */
audio.op('remix', (channels) => (chs, { sampleRate: sr }) => {
  // Bridge to AudioBuffer for remix
  let buf = new AudioBuffer(chs.length, chs[0].length, sr)
  for (let c = 0; c < chs.length; c++) buf.getChannelData(c).set(chs[c])
  let out = remixChannels(buf, channels)
  return Array.from({ length: out.numberOfChannels }, (_, c) => new Float32Array(out.getChannelData(c)))
})
