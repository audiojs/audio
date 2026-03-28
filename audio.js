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

/** Samples per page (2^16) */
export const PAGE_SIZE = 65536
/** Samples per index block */
export const BLOCK_SIZE = 1024

// BS.1770 loudness constants
const GATE_WINDOW = 0.4, ABS_GATE = -70, REL_GATE = -10, LUFS_OFFSET = -0.691


// ── Entry Points ─────────────────────────────────────────────────────────

/** Create audio from any source. Always async. File/URL/bytes → decode. PCM/number → wrap. */
export default async function audio(source, opts = {}) {
  if (Array.isArray(source) && source[0] instanceof Float32Array) return fromChannels(source, opts)
  if (typeof source === 'number') return fromSilence(source, opts)
  return fromEncoded(await resolve(source), opts)
}

/** Sync creation from PCM data, AudioBuffer, audio instance, or seconds of silence. */
audio.from = function(source, opts) {
  if (Array.isArray(source) && source[0] instanceof Float32Array) return fromChannels(source, opts)
  if (typeof source === 'number') return fromSilence(source, opts)
  if (source?.pages) {
    // Clone another audio instance — renders edits into fresh PCM
    let pcm = render(source)
    return fromChannels(pcm, { sampleRate: source.sampleRate, ...opts })
  }
  if (source?.getChannelData) {
    let chs = Array.from({ length: source.numberOfChannels }, (_, i) => new Float32Array(source.getChannelData(i)))
    return fromChannels(chs, { sampleRate: source.sampleRate, ...opts })
  }
  throw new TypeError('audio.from: expected Float32Array[], AudioBuffer, audio instance, or number')
}

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

/** Create audio instance with pages, index, and metadata. */
function create(pages, sampleRate, numberOfChannels, length, source, opts = {}, pcm) {
  let a = Object.create(proto)
  a.pages = pages
  a.sampleRate = sampleRate
  a.numberOfChannels = numberOfChannels
  a._len = length
  a.source = source
  a.storage = opts.storage || 'memory'
  a.cache = opts.cache || null         // cache backend: { read(i), write(i, data), has(i), evict(i) }
  a.budget = opts.budget ?? Infinity   // memory budget in bytes (default: unlimited)
  a.edits = []
  a.version = 0
  a.onchange = null
  a.index = buildIndex(pcm, numberOfChannels)

  // Auto-evict if budget exceeded
  if (a.cache && a.budget < Infinity) evictToFit(a)
  return a
}

/** Create from planar Float32Array channels. Split into pages, build index. */
function fromChannels(channelData, opts = {}) {
  let sr = opts.sampleRate || 44100
  return create(toPages(channelData), sr, channelData.length, channelData[0].length, null, opts, channelData)
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

  let { channelData, sampleRate } = await decode(buf)
  let a = create(toPages(channelData), sampleRate, channelData.length, channelData[0].length, buf, opts, channelData)

  if (opts.onprogress) {
    let blocks = a.index.min[0].length, bpp = Math.ceil(PAGE_SIZE / BLOCK_SIZE), prev = 0
    for (let p = 0; p < a.pages.length; p++) {
      let end = Math.min(prev + bpp, blocks)
      await opts.onprogress({
        delta: { fromBlock: prev, min: a.index.min.map(arr => arr.slice(prev, end)), max: a.index.max.map(arr => arr.slice(prev, end)), energy: a.index.energy.map(arr => arr.slice(prev, end)) },
        offset: end * BLOCK_SIZE / a.sampleRate, total: a._len / a.sampleRate,
      })
      prev = end
    }
  }
  return a
}


// ── Index ────────────────────────────────────────────────────────────────

/** Split channels into pages of PAGE_SIZE samples. */
function toPages(channelData) {
  let len = channelData[0].length, pages = []
  for (let off = 0; off < len; off += PAGE_SIZE)
    pages.push({ data: channelData.map(ch => ch.slice(off, Math.min(off + PAGE_SIZE, len))) })
  return pages
}

/** Build index from flat PCM: per-channel per-block min, max, energy (RMS²). */
function buildIndex(pcm, ch) {
  let len = pcm[0].length, totalBlocks = Math.ceil(len / BLOCK_SIZE)
  let idx = {
    blockSize: BLOCK_SIZE,
    min: Array.from({ length: ch }, () => new Float32Array(totalBlocks)),
    max: Array.from({ length: ch }, () => new Float32Array(totalBlocks)),
    energy: Array.from({ length: ch }, () => new Float32Array(totalBlocks)),
  }
  for (let bi = 0; bi < totalBlocks; bi++) {
    let off = bi * BLOCK_SIZE, end = Math.min(off + BLOCK_SIZE, len)
    for (let c = 0; c < ch; c++) {
      let mn = Infinity, mx = -Infinity, sum = 0
      for (let i = off; i < end; i++) { let v = pcm[c][i]; if (v < mn) mn = v; if (v > mx) mx = v; sum += v * v }
      idx.min[c][bi] = mn; idx.max[c][bi] = mx; idx.energy[c][bi] = sum / (end - off)
    }
  }
  return idx
}

// ── Page Cache (LRU eviction + restore) ──────────────────────────────────

/** Bytes of PCM data in a page (0 if evicted). */
function pageBytes(page) {
  if (!page.data) return 0
  return page.data.reduce((sum, ch) => sum + ch.byteLength, 0)
}

/** Total resident PCM bytes across all pages. */
function residentBytes(a) {
  return a.pages.reduce((sum, p) => sum + pageBytes(p), 0)
}

/** Evict pages to cache until resident bytes fit within budget. LRU from start. */
function evictToFit(a) {
  if (!a.cache || a.budget === Infinity) return
  // LRU: evict oldest-accessed pages first (simple: evict from start, skip recently used)
  let current = residentBytes(a)
  for (let i = 0; i < a.pages.length && current > a.budget; i++) {
    let page = a.pages[i]
    if (!page.data) continue
    // Write to cache before evicting
    a.cache.write(i, page.data)
    current -= pageBytes(page)
    page.data = null
  }
}

/** Rebuild index from materialized output when edits exist. */
function refreshIndex(a) {
  if (!a.edits.length) return
  let pcm = render(a)
  a.index = buildIndex(pcm, pcm.length)
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

/** Materialize audio: flatten pages → apply edits → extract range. */
function render(a, offset, duration) {
  let sr = a.sampleRate, ch = a.numberOfChannels

  // Flatten pages — restore evicted pages from cache on demand
  let flat = Array.from({ length: ch }, () => new Float32Array(a._len))
  let pos = 0
  for (let i = 0; i < a.pages.length; i++) {
    let page = a.pages[i]
    if (!page.data && a.cache?.has(i)) page.data = a.cache.read(i)  // sync page-in
    if (!page.data) { pos += PAGE_SIZE; continue }
    for (let c = 0; c < ch; c++) flat[c].set(page.data[c], pos)
    pos += page.data[0].length
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

  // Extract range
  if (offset != null) {
    let s = Math.round(offset * sr), e = duration != null ? s + Math.round(duration * sr) : flat[0].length
    flat = flat.map(ch => ch.slice(s, Math.min(e, ch.length)))
  }
  return flat
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
  trim(threshold = -40) {
    let thresh = 10 ** (threshold / 20), blocks = this.index.min[0].length
    let s = 0, e = blocks - 1
    for (; s < blocks; s++) if (isBlockLoud(this, s, thresh)) break
    for (; e >= s; e--) if (isBlockLoud(this, e, thresh)) break
    let ss = findThresholdCrossing(this, s, thresh, 'start'), se = findThresholdCrossing(this, e, thresh, 'end')
    return pushEdit(this, { type: 'crop', args: [], offset: ss / this.sampleRate, duration: Math.max(0, (se - ss) / this.sampleRate) })
  },
  normalize(targetDb = 0) {
    let peak = 0
    for (let c = 0; c < this.numberOfChannels; c++)
      for (let i = 0; i < this.index.max[c].length; i++)
        peak = Math.max(peak, Math.abs(this.index.max[c][i]), Math.abs(this.index.min[c][i]))
    return pushEdit(this, { type: 'gain', args: [targetDb - (peak > 0 ? 20 * Math.log10(peak) : -Infinity)] })
  },

  undo() {
    if (!this.edits.length) return null
    let edit = this.edits.pop()
    this.version++
    this.onchange?.()
    return edit
  },
  do(...edits) {
    for (let e of edits) {
      if (typeof e === 'function') pushEdit(this, { type: '_fn', fn: e })
      else if (e.args) pushEdit(this, e)  // new format: { type, args, offset?, duration? }
      else {
        // Old/macro format: { type, ...params }. Extract args from the op's init.
        let { type, offset, duration, ...rest } = e
        let op = ops[type]
        let args = op ? Object.values(rest).slice(0, op.nargs) : []
        pushEdit(this, { type, args, offset, duration })
      }
    }
    return this
  },

  // Output — read() is the universal output. Format determines return type.
  async read(offset, duration, opts) {
    // Normalize args: read(opts), read(offset, opts), read(offset, duration, opts)
    if (typeof offset === 'object' && !opts) { opts = offset; offset = undefined }
    else if (typeof duration === 'object' && !opts) { opts = duration; duration = undefined }
    let fmt = opts?.format
    let pcm = render(this, offset, duration)

    // Codec format → encode to bytes
    if (fmt && encode[fmt]) return encode[fmt](pcm, { sampleRate: this.sampleRate })

    // PCM format conversion via pcm-convert
    if (fmt) return pcm.map(ch => convert(ch, 'float32', fmt))

    return pcm
  },
  async save(target) {
    let format = typeof target === 'string' ? target.split('.').pop() : 'wav'
    let bytes = await this.read({ format })
    if (typeof target === 'string') {
      let { writeFile } = await import('fs/promises')
      await writeFile(target, Buffer.from(bytes))
    } else if (target?.write) { await target.write(bytes); await target.close?.() }
  },

  // Analysis
  async limits(offset, duration) {
    refreshIndex(this)
    let { min, max } = this.index
    let sb = offset != null ? Math.floor(offset * this.sampleRate / BLOCK_SIZE) : 0
    let eb = duration != null ? Math.ceil((offset + duration) * this.sampleRate / BLOCK_SIZE) : min[0].length
    let mn = Infinity, mx = -Infinity
    for (let c = 0; c < this.numberOfChannels; c++)
      for (let i = sb; i < Math.min(eb, min[c].length); i++) { if (min[c][i] < mn) mn = min[c][i]; if (max[c][i] > mx) mx = max[c][i] }
    return { min: mn, max: mx }
  },
  async loudness(offset, duration) {
    refreshIndex(this)
    let { energy } = this.index
    let sb = offset != null ? Math.floor(offset * this.sampleRate / BLOCK_SIZE) : 0
    let eb = duration != null ? Math.ceil((offset + duration) * this.sampleRate / BLOCK_SIZE) : energy[0].length
    let winBlocks = Math.ceil(GATE_WINDOW * this.sampleRate / BLOCK_SIZE), gates = []
    for (let i = sb; i < eb; i += winBlocks) {
      let we = Math.min(i + winBlocks, eb), sum = 0, n = 0
      for (let c = 0; c < this.numberOfChannels; c++) for (let j = i; j < we; j++) { sum += energy[c][j]; n++ }
      if (n > 0) gates.push(sum / n)
    }
    let absT = 10 ** (ABS_GATE / 10), gated = gates.filter(g => g > absT)
    if (!gated.length) return -Infinity
    let mean = gated.reduce((a, b) => a + b, 0) / gated.length
    let final = gated.filter(g => g > mean * 10 ** (REL_GATE / 10))
    if (!final.length) return -Infinity
    return LUFS_OFFSET + 10 * Math.log10(final.reduce((a, b) => a + b, 0) / final.length)
  },
  async peaks(count, opts) {
    refreshIndex(this)
    let { min, max } = this.index, ch = opts?.channel, total = min[0].length, bpp = total / count
    let outMin = new Float32Array(count), outMax = new Float32Array(count)
    let cS = ch != null ? ch : 0, cE = ch != null ? ch + 1 : this.numberOfChannels
    for (let i = 0; i < count; i++) {
      let from = Math.floor(i * bpp), to = Math.floor((i + 1) * bpp), mn = Infinity, mx = -Infinity
      for (let c = cS; c < cE; c++) for (let j = from; j < Math.min(to, total); j++) { if (min[c][j] < mn) mn = min[c][j]; if (max[c][j] > mx) mx = max[c][j] }
      outMin[i] = mn === Infinity ? 0 : mn; outMax[i] = mx === -Infinity ? 0 : mx
    }
    return { min: outMin, max: outMax }
  },

  // Playback — returns controller, starts async. Browser: WAA. Node: audio-speaker.
  play(offset = 0, duration) {
    let a = this, pcm = render(a, offset, duration)
    let ctrl = { playing: false, currentTime: offset, ontimeupdate: null, onended: null,
      pause() { ctrl.playing = false; ctrl._node?.stop?.() },
      stop() { ctrl.playing = false; ctrl._node?.stop?.() },
      _node: null }

    // Browser — Web Audio API
    if (typeof AudioContext !== 'undefined' || typeof webkitAudioContext !== 'undefined') {
      let AC = typeof AudioContext !== 'undefined' ? AudioContext : webkitAudioContext
      let ctx = new AC({ sampleRate: a.sampleRate })
      let buf = ctx.createBuffer(a.numberOfChannels, pcm[0].length, a.sampleRate)
      for (let c = 0; c < a.numberOfChannels; c++) buf.copyToChannel(pcm[c], c)
      let src = ctx.createBufferSource()
      src.buffer = buf
      src.connect(ctx.destination)
      src.start(0)
      ctrl.playing = true
      ctrl._node = src
      // Track time
      let startTime = ctx.currentTime
      let iv = setInterval(() => {
        if (!ctrl.playing) { clearInterval(iv); return }
        ctrl.currentTime = offset + (ctx.currentTime - startTime)
        ctrl.ontimeupdate?.(ctrl.currentTime)
      }, 50)
      src.onended = () => { ctrl.playing = false; clearInterval(iv); ctrl.onended?.(); ctx.close() }
    }
    // Node — audio-speaker (lazy-loaded)
    else {
      ;(async () => {
        ctrl.playing = true
        let speaker
        try { speaker = (await import('audio-speaker')).default } catch { }
        if (!speaker) { ctrl.playing = false; return }
        let write = speaker({ sampleRate: a.sampleRate, channels: a.numberOfChannels })
        let chunk = Math.round(a.sampleRate * 0.1)
        for (let off = 0; off < pcm[0].length && ctrl.playing; off += chunk) {
          let end = Math.min(off + chunk, pcm[0].length)
          let interleaved = new Float32Array((end - off) * a.numberOfChannels)
          for (let i = 0; i < end - off; i++) for (let c = 0; c < a.numberOfChannels; c++) interleaved[i * a.numberOfChannels + c] = pcm[c][off + i]
          await new Promise(resolve => write(Buffer.from(interleaved.buffer), resolve))
          ctrl.currentTime = offset + (off + end) / 2 / a.sampleRate
          ctrl.ontimeupdate?.(ctrl.currentTime)
        }
        write(null); ctrl.playing = false; ctrl.onended?.()
      })()
    }
    return ctrl
  },

  // Streaming
  async *stream(offset, duration) {
    let pcm = render(this, offset, duration), len = pcm[0].length
    for (let off = 0; off < len; off += PAGE_SIZE) yield pcm.map(ch => ch.slice(off, Math.min(off + PAGE_SIZE, len)))
  },

  toJSON() { return { edits: this.edits, sampleRate: this.sampleRate, channels: this.numberOfChannels, duration: this.duration } },
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
  let sampleStart = blockIdx * BLOCK_SIZE, pageIdx = Math.floor(sampleStart / PAGE_SIZE), page = a.pages[pageIdx]
  if (!page?.data) return sampleStart
  let off = sampleStart - pageIdx * PAGE_SIZE, end = Math.min(off + BLOCK_SIZE, page.data[0].length)
  if (side === 'start') {
    for (let i = off; i < end; i++) for (let c = 0; c < a.numberOfChannels; c++)
      if (Math.abs(page.data[c][i]) > thresh) return pageIdx * PAGE_SIZE + i
  } else {
    for (let i = end - 1; i >= off; i--) for (let c = 0; c < a.numberOfChannels; c++)
      if (Math.abs(page.data[c][i]) > thresh) return pageIdx * PAGE_SIZE + i + 1
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
      : render(source)
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

audio.op('fade', (dur, curve) => {
  curve = curve || 'linear'
  let curves = { linear: t => t, exp: t => t * t, log: t => Math.sqrt(t), cos: t => (1 - Math.cos(t * Math.PI)) / 2 }
  let fn = curves[curve] || curves.linear
  let fadeIn = dur > 0, n = Math.abs(dur)

  return (chs, { offset = 0, sampleRate: sr }) => {
    let s = Math.round(offset * sr)
    let samples = Math.round(n * sr)
    return chs.map(ch => {
      let o = new Float32Array(ch)
      for (let i = 0; i < samples && s + i < o.length; i++) {
        o[Math.max(0, s + i)] *= fn(fadeIn ? i / samples : 1 - i / samples)
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
  let p = offset != null ? Math.round(offset * sr) : 0, src = render(source)
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

