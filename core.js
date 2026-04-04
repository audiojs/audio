/**
 * audio core — paged audio container with plugin architecture.
 *
 * audio.fn   — instance prototype (like $.fn)
 * audio.op   — ops dict: audio.op.gain = fn
 * audio.stat — block stats dict: audio.stat.min = fn
 * audio.hook — single-slot hooks { create, beforeRead, read, beforeQuery }
 * audio.use  — plugin registration
 */

import encode from 'encode-audio'
import convert from 'pcm-convert'
import { PAGE_SIZE, BLOCK_SIZE } from './plan.js'
import { buildStats } from './stats.js'
import { evict, restorePages, opfsCache, DEFAULT_BUDGET } from './cache.js'
import { paginate, resolveSource, estimateSize, decodeSource, decodeWorker } from './decode.js'

// Static properties set after audio is defined (see below)


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
  if (Array.isArray(source) && source[0] instanceof Float32Array || typeof source === 'number') a = audio.from(source, opts)
  else {
    // Storage/budget check for encoded sources
    let storage = opts.storage || 'auto'
    if (storage === 'persistent') {
      try { opts = { ...opts, cache: await opfsCache(), budget: opts.budget ?? DEFAULT_BUDGET } }
      catch { throw new Error('OPFS not available (required by storage: "persistent")') }
    }
    a = await audio.open(source, opts)
    await a.loaded
    if (a.cache && a.budget < Infinity) await evict(a)
    return a
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

/** Open audio for streaming — resolves after first page, decodes in background.
 *  Instance has a.loaded promise (resolves when fully decoded). */
audio.open = async function(source, opts = {}) {
  let ref = typeof source === 'string' ? source : source instanceof URL ? source.href : null
  let pages = []
  // Notify/wait queue — resolve callbacks for consumers awaiting next decoded page
  let waiters = []
  let notify = () => { for (let w of waiters.splice(0)) w() }
  let result = await decodeSource(source, { pages, notify, statDict: audio.stat, onprogress: opts.onprogress })
  let a = create(pages, result.sampleRate, result.channels, 0, { ...opts, source: ref }, null)
  a._.waiters = waiters
  a.decoded = false

  a.loaded = result.decoding.then(final => {
    a._.len = final.length
    a._.lenV = -1  // invalidate cached length so history recomputes
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
audio.hook = { create: null, beforeRead: restorePages, read: null, beforeQuery: null, run: null }
audio.PAGE_SIZE = PAGE_SIZE
audio.BLOCK_SIZE = BLOCK_SIZE
audio.opfsCache = opfsCache

/** Register plugins. Each receives audio. Wires ops to fn after. */
audio.use = function(...plugins) {
  for (let p of plugins) p(audio)
  for (let name in audio.op) {
    if (fn[name]) continue
    fn[name] = function(...a) { return audio.hook.run.call(this, name, a) }
  }
}


// ── Pages ────────────────────────────────────────────────────────────────

/** Read range from source pages (no edits). */
export function readPages(a, offset, duration) {
  let sr = a.sampleRate, ch = a._.ch
  let s = offset != null ? Math.round(offset * sr) : 0
  let len = duration != null ? Math.round(duration * sr) : a._.len - s
  let out = Array.from({ length: ch }, () => new Float32Array(len))
  for (let c = 0; c < ch; c++) {
    let p0 = Math.floor(s / PAGE_SIZE), pos = p0 * PAGE_SIZE
    for (let p = p0; p < a.pages.length && pos < s + len; p++) {
      let pg = a.pages[p], pLen = pg ? pg[0].length : PAGE_SIZE
      if (pos + pLen > s && pg) {
        let rs = Math.max(s - pos, 0), re = Math.min(s + len - pos, pLen)
        out[c].set(pg[c].subarray(rs, re), Math.max(pos - s, 0))
      }
      pos += pLen
    }
  }
  return out
}


// ── Create ───────────────────────────────────────────────────────────────

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
  return create(paginate(channelData), sr, channelData.length, channelData[0].length, opts, buildStats(audio.stat, channelData, channelData.length, sr))
}

function fromSilence(seconds, opts = {}) {
  let sr = opts.sampleRate || 44100, ch = opts.channels || 1
  return fromChannels(Array.from({ length: ch }, () => new Float32Array(Math.round(seconds * sr))), { ...opts, sampleRate: sr })
}


// ── Prototype ───────────────────────────────────────────────────────────

Object.defineProperties(fn, {
  length: { get() { return this._.len }, configurable: true },
  duration: { get() { return this.length / this.sampleRate }, configurable: true },
  channels: { get() { return this._.ch }, configurable: true },
  // Cursor prefetches nearby pages from cache — no-op without persistent storage
  cursor: {
    get() { return this._.cursor },
    set(t) {
      this._.cursor = t
      if (this.cache) {
        let page = Math.floor(t * this.sampleRate / PAGE_SIZE)
        ;(async () => {
          for (let i = Math.max(0, page - 1); i <= Math.min(page + 2, this.pages.length - 1); i++)
            if (this.pages[i] === null && await this.cache.has(i)) this.pages[i] = await this.cache.read(i)
        })()
      }
    },
    configurable: true,
  },
})

fn.read = async function(offset, duration, opts) {
  if (typeof offset === 'object' && !opts) { opts = offset; offset = undefined }
  else if (typeof duration === 'object' && !opts) { opts = duration; duration = undefined }
  await audio.hook.beforeRead?.(this)
  let pcm = audio.hook.read
    ? await audio.hook.read(this, offset, duration)
    : readPages(this, offset, duration)
  let fmt = opts?.format
  if (!fmt) return pcm
  if (encode[fmt]) return encode[fmt](pcm, { sampleRate: this.sampleRate, ...opts?.meta })
  return pcm.map(ch => convert(ch, 'float32', fmt))
}

fn.query = async function(offset, duration) {
  await audio.hook.beforeRead?.(this)
  await audio.hook.beforeQuery?.(this)
  let sr = this.sampleRate, bs = this.stats.blockSize
  let first = Object.values(this.stats).find(v => v?.[0]?.length)
  let blocks = first?.[0]?.length || 0
  let from = offset != null ? Math.floor(offset * sr / bs) : 0
  let to = duration != null ? Math.ceil((offset + duration) * sr / bs) : blocks
  return { stats: this.stats, channels: this.channels, sampleRate: sr, from, to }
}
