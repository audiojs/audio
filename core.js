/**
 * audio core — paged audio container with plugin architecture.
 *
 * audio.fn   — instance prototype (like $.fn)
 * audio.op   — ops dict: audio.op.gain = fn
 * audio.stat — block stats dict: audio.stat.min = fn
 * audio.hook — single-slot hooks { create }
 * audio.run  — op dispatch, called via .call(instance)
 * audio.use  — plugin registration
 */

import encode from 'audio-encode'
import convert from 'pcm-convert'
import { PAGE_SIZE, BLOCK_SIZE } from './plan.js'
import { buildStats } from './stats.js'
import { evict, restorePages, opfsCache, DEFAULT_BUDGET } from './cache.js'
import { paginate, resolveSource, estimateSize, decodeSource, decodeWorker } from './decode.js'

export { PAGE_SIZE, BLOCK_SIZE, opfsCache }
export { decodeSource } from './decode.js'


// ── Entry Points ─────────────────────────────────────────────────────────

/** Create audio from any source. Always async. */
export default async function audio(source, opts = {}) {
  if (source && typeof source === 'object' && !Array.isArray(source) && source.edits) {
    if (!source.source) throw new TypeError('audio: cannot restore document without source reference')
    let a = await audio(source.source, opts)
    if (a.apply) for (let e of source.edits) a.apply(e)
    return a
  }
  let a
  if (Array.isArray(source) && source[0] instanceof Float32Array) a = fromChannels(source, opts)
  else if (typeof source === 'number') a = fromSilence(source, opts)
  else {
    let ref = typeof source === 'string' ? source : source instanceof URL ? source.href : null
    return fromEncoded(await resolveSource(source), { ...opts, source: ref })
  }
  if (a.cache && a.budget < Infinity) await evict(a)
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


// ── Plugin Architecture ─────────────────────────────────────────────────

const proto = {}

audio.fn = proto
audio.op = {}
audio.stat = {}
audio.hook = { create: null }

/** Op dispatch — pushes edit. Called via .call(instance). */
audio.run = function(name, args) {
  this.edits.push({ type: name, args })
  this.version++
  this.onchange?.()
  return this
}

/** Register plugins. Each receives audio. Wires ops to proto after. */
audio.use = function(...plugins) {
  for (let p of plugins) p(audio)
  for (let name in audio.op) {
    if (proto[name]) continue
    proto[name] = function(...a) { return audio.run.call(this, name, a) }
  }
}


// ── Format ───────────────────────────────────────────────────────────────

/** Encode PCM to a format. Shared by core read + history read. */
export function formatPcm(pcm, sr, opts) {
  let fmt = opts?.format
  if (!fmt) return pcm
  if (encode[fmt]) return encode[fmt](pcm, { sampleRate: sr, ...opts?.meta })
  return pcm.map(ch => convert(ch, 'float32', fmt))
}


// ── Pages ────────────────────────────────────────────────────────────────

/** Read samples directly from source pages. */
function readSource(a, c, srcOff, len, target, tOff) {
  let p0 = Math.floor(srcOff / PAGE_SIZE), pos = p0 * PAGE_SIZE
  for (let p = p0; p < a.pages.length && pos < srcOff + len; p++) {
    let pg = a.pages[p], pLen = pg ? pg[0].length : PAGE_SIZE
    if (pos + pLen > srcOff && pg) {
      let s = Math.max(srcOff - pos, 0), e = Math.min(srcOff + len - pos, pLen)
      target.set(pg[c].subarray(s, e), tOff + Math.max(pos - srcOff, 0))
    }
    pos += pLen
  }
}

/** Read range from source pages (no edits). */
export function readPages(a, offset, duration) {
  let sr = a.sampleRate, ch = a._.ch
  let s = offset != null ? Math.round(offset * sr) : 0
  let len = duration != null ? Math.round(duration * sr) : a._.len - s
  let out = Array.from({ length: ch }, () => new Float32Array(len))
  for (let c = 0; c < ch; c++) readSource(a, c, s, len, out[c], 0)
  return out
}


// ── Create ───────────────────────────────────────────────────────────────

function create(pages, sampleRate, ch, length, opts = {}, stats) {
  let a = Object.create(proto)
  a.pages = pages
  a.sampleRate = sampleRate
  a.source = opts.source ?? null
  a.storage = opts.storage || 'memory'
  a.cache = opts.cache || null
  a.budget = opts.budget ?? Infinity
  a.edits = []
  a.version = 0
  a.onchange = null
  a.stats = stats
  a._ = { ch, len: length, pcm: null, pcmV: -1, statsV: -1, cursor: 0 }
  audio.hook.create?.(a)
  return a
}

function fromChannels(channelData, opts = {}) {
  let sr = opts.sampleRate || 44100
  return create(paginate(channelData), sr, channelData.length, channelData[0].length, opts, buildStats(audio.stat, channelData, channelData.length, sr))
}

function fromSilence(seconds, opts = {}) {
  let sr = opts.sampleRate || 44100, ch = opts.channels || 1
  return fromChannels(Array.from({ length: ch }, () => new Float32Array(Math.round(seconds * sr))), { ...opts, sampleRate: sr })
}

async function fromEncoded(buf, opts = {}) {
  let storage = opts.storage || 'auto'
  if (storage === 'auto' || storage === 'persistent') {
    let estimated = estimateSize(buf)
    let budget = opts.budget ?? DEFAULT_BUDGET
    if (estimated > budget && !opts.cache) {
      try {
        opts = { ...opts, cache: await opfsCache(), budget }
      } catch {
        if (storage === 'persistent') throw new Error('OPFS not available (required by storage: "persistent")')
        if (estimated > budget * 4) throw new Error(`File too large (~${(estimated / 1e6).toFixed(0)}MB decoded) and OPFS unavailable. Pass { storage: "memory" } to force.`)
      }
    }
  }
  let result = opts.decode === 'worker'
    ? await decodeWorker(buf, opts.onprogress)
    : await decodeSource(buf, opts.onprogress, audio.stat)
  let a = create(result.pages, result.sampleRate, result.channels, result.length, opts, result.stats)
  if (a.cache && a.budget < Infinity) await evict(a)
  return a
}


// ── Prototype ───────────────────────────────────────────────────────────

Object.defineProperties(proto, {
  length: { get() { return this._.len }, configurable: true },
  duration: { get() { return this.length / this.sampleRate }, configurable: true },
  channels: { get() { return this._.ch }, configurable: true },
  cursor: {
    get() { return this._.cursor },
    set(t) {
      this._.cursor = t
      let page = Math.floor(t * this.sampleRate / PAGE_SIZE)
      if (this.cache) (async () => {
        for (let i = Math.max(0, page - 1); i <= Math.min(page + 2, this.pages.length - 1); i++)
          if (this.pages[i] === null && await this.cache.has(i)) this.pages[i] = await this.cache.read(i)
      })()
    },
    configurable: true,
  },
})

proto.read = async function(offset, duration, opts) {
  if (typeof offset === 'object' && !opts) { opts = offset; offset = undefined }
  else if (typeof duration === 'object' && !opts) { opts = duration; duration = undefined }
  await restorePages(this)
  return formatPcm(readPages(this, offset, duration), this.sampleRate, opts)
}

proto.query = async function(offset, duration) {
  await restorePages(this)
  let sr = this.sampleRate, bs = this.stats.blockSize
  let first = Object.values(this.stats).find(v => v?.[0]?.length)
  let blocks = first?.[0]?.length || 0
  let from = offset != null ? Math.floor(offset * sr / bs) : 0
  let to = duration != null ? Math.ceil((offset + duration) * sr / bs) : blocks
  return { stats: this.stats, channels: this.channels, sampleRate: sr, from, to }
}
