/**
 * audio core — paged audio container with plugin architecture.
 *
 * audio.fn   — instance prototype (like $.fn)
 * audio.op   — ops dict, wired to fn by use()
 * audio.stat — stats dict
 * audio.hook — single-slot hooks
 * audio.run  — op dispatch (history replaces)
 * audio.use  — plugin registration
 */

import encode from 'audio-encode'
import convert from 'pcm-convert'
import { SILENCE, PAGE_SIZE, BLOCK_SIZE } from './plan.js'
import { statFields, statSession, buildStats } from './stats.js'
import { evict, restorePages, opfsCache, DEFAULT_BUDGET } from './cache.js'
import { paginate, resolveSource, estimateSize, decodeSource, decodeWorker } from './decode.js'
import { ops, render, buildPlan, streamPlan, streamPcm, readPages, readPlan } from './render.js'

export { PAGE_SIZE, BLOCK_SIZE, opfsCache, ops, render }
export { decodeSource } from './decode.js'


// ── Entry Points ─────────────────────────────────────────────────────────

/** Create audio from any source. Always async. */
export default async function audio(source, opts = {}) {
  if (source && typeof source === 'object' && !Array.isArray(source) && source.edits) {
    if (!source.source) throw new TypeError('audio: cannot restore document without source reference')
    let a = await audio(source.source, opts)
    for (let e of source.edits) pushEdit(a, e)
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

/** Instance prototype — like $.fn. Plugins add methods directly. */
const proto = {}
audio.fn = proto

/** Single-slot hooks. Chain prev manually. */
audio.hook = { create: null }

/** Op dispatch — called via .call(instance). History replaces this. */
audio.run = function(name, args, opts) {
  let nargs = ops[name]?.length || 0
  let opArgs = args.slice(0, nargs), offset = args[nargs] ?? opts?.at, duration = args[nargs + 1] ?? opts?.dur
  return pushEdit(this, { type: name, args: opArgs, offset, duration })
}

/** Register plugins. Each receives audio. Wires audio.op entries to audio.fn after. */
audio.use = function(...plugins) {
  for (let p of plugins) p(audio)
  for (let name of Object.keys(ops)) {
    if (proto[name]) continue
    proto[name] = function(...a) {
      let opts = a.length && typeof a[a.length - 1] === 'object'
        && !(a[a.length - 1] instanceof Float32Array)
        && !a[a.length - 1]?.pages ? a.pop() : {}
      return audio.run.call(this, name, a, opts)
    }
  }
}

/** Register a stat. Block stat: factory → fn(channels, ctx) → number[]|number.
 *  Query stat: fn({stats, channels, from, to}, ...args) with .query = true. */
audio.stat = function(name, fn) {
  if (typeof fn !== 'function') throw new TypeError(`audio.stat: expected function for '${name}'`)
  if (statFields[name] || proto[name]) throw new Error(`audio.stat: '${name}' already registered`)
  if (fn.query) {
    let n = fn.args || 0
    proto[name] = async function(...args) {
      let extra = args.slice(0, n), offset = args[n], duration = args[n + 1]
      if (typeof offset === 'object') { extra.push(offset); offset = undefined; duration = undefined }
      else if (typeof duration === 'object') { extra.push(duration); duration = undefined }
      return fn(await this.query(offset, duration), ...extra)
    }
  } else {
    statFields[name] = fn.length > 0 ? () => fn : fn
  }
}

/** Register a named op. init(...params) → processor(channels, ctx) → channels. */
audio.op = function(name, init) {
  if (typeof init !== 'function') throw new TypeError(`audio.op: expected function for '${name}'`)
  if (ops[name]) throw new Error(`audio.op: '${name}' already registered`)
  let nargs = init.length
  ops[name] = init
  proto[name] = function(...args) {
    let opArgs = args.slice(0, nargs), offset = args[nargs], duration = args[nargs + 1]
    return pushEdit(this, { type: name, args: opArgs, offset, duration })
  }
}



// ── Create ───────────────────────────────────────────────────────────────

/** Create audio instance with pages and metadata. */
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
  a._ = { ch, len: length, lenC: length, lenV: 0, chC: ch, chV: 0, pcm: null, pcmV: -1, statsV: -1, cursor: 0 }
  return a
}

/** Create from planar Float32Array channels. */
function fromChannels(channelData, opts = {}) {
  let sr = opts.sampleRate || 44100
  return create(paginate(channelData), sr, channelData.length, channelData[0].length, opts, buildStats(channelData, channelData.length, sr))
}

/** Create silence of given duration. */
function fromSilence(seconds, opts = {}) {
  let sr = opts.sampleRate || 44100, ch = opts.channels || 1
  return fromChannels(Array.from({ length: ch }, () => new Float32Array(Math.round(seconds * sr))), { ...opts, sampleRate: sr })
}

/** Decode encoded audio into pages + stats. Auto-detect OPFS for large files. */
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
    : await decodeSource(buf, opts.onprogress)
  let a = create(result.pages, result.sampleRate, result.channels, result.length, opts, result.stats)
  if (a.cache && a.budget < Infinity) await evict(a)
  return a
}


// ── Edit History ─────────────────────────────────────────────────────────

function pushEdit(a, edit) {
  a.edits.push(edit)
  a.version++
  a.onchange?.()
  return a
}

/** Rebuild stats from edits. */
function rebuildStats(a) {
  if (!a.edits.length) return
  let plan = buildPlan(a)
  if (!plan) { a.stats = buildStats(render(a), a._.ch, a.sampleRate); return }
  let s = statSession(a._.ch, a.sampleRate)
  for (let chunk of streamPlan(a, plan)) s.page(chunk)
  a.stats = s.done()
}


// ── Prototype Methods ───────────────────────────────────────────────────

/** Ensure stats are fresh, return stats + block range. */
proto.query = async function(offset, duration) {
  await restorePages(this)
  if (this.edits.length && this._.statsV !== this.version) {
    rebuildStats(this)
    this._.statsV = this.version
  }
  let sr = this.sampleRate, bs = this.stats.blockSize
  let first = Object.values(this.stats).find(v => v?.[0]?.length)
  let blocks = first?.[0]?.length || 0
  let from = offset != null ? Math.floor(offset * sr / bs) : 0
  let to = duration != null ? Math.ceil((offset + duration) * sr / bs) : blocks
  return { stats: this.stats, channels: this.channels, sampleRate: sr, from, to }
}

Object.defineProperties(proto, {
  length: { get() {
    if (this._.lenV === this.version) return this._.lenC
    let len = this._.len, sr = this.sampleRate
    for (let { type, args = [], offset: off, duration: dur } of this.edits) {
      let init = ops[type]
      if (init?.dur) len = init.dur(len, sr, args, off, dur)
    }
    this._.lenC = len; this._.lenV = this.version
    return len
  }},
  duration: { get() { return this.length / this.sampleRate }},
  channels: { get() {
    if (this._.chV === this.version) return this._.chC
    let ch = this._.ch
    for (let edit of this.edits) { let init = ops[edit.type]; if (init?.ch) ch = init.ch(ch, edit.args) }
    this._.chC = ch; this._.chV = this.version
    return ch
  }},
  cursor: {
    get() { return this._.cursor },
    set(t) {
      this._.cursor = t
      let page = Math.floor(t * this.sampleRate / PAGE_SIZE)
      if (this.cache) (async () => {
        for (let i = Math.max(0, page - 1); i <= Math.min(page + 2, this.pages.length - 1); i++)
          if (this.pages[i] === null && await this.cache.has(i)) this.pages[i] = await this.cache.read(i)
      })()
    }
  },
})

proto.read = async function(offset, duration, opts) {
  if (typeof offset === 'object' && !opts) { opts = offset; offset = undefined }
  else if (typeof duration === 'object' && !opts) { opts = duration; duration = undefined }
  let fmt = opts?.format
  await restorePages(this)
  for (let { args } of this.edits) if (args?.[0]?.pages) await restorePages(args[0])

  let pcm
  if (!this.edits.length) pcm = readPages(this, offset, duration)
  else {
    let plan = buildPlan(this)
    pcm = plan ? readPlan(this, plan, offset, duration) : render(this).map(ch => {
      if (offset == null) return ch.slice()
      let s = Math.round(offset * this.sampleRate)
      return ch.slice(s, duration != null ? s + Math.round(duration * this.sampleRate) : ch.length)
    })
  }

  if (fmt && encode[fmt]) return encode[fmt](pcm, { sampleRate: this.sampleRate, ...opts?.meta })
  if (fmt) return pcm.map(ch => convert(ch, 'float32', fmt))
  return pcm
}

proto[Symbol.asyncIterator] = proto.stream = async function*(offset, duration) {
  await restorePages(this)
  let plan = buildPlan(this)
  if (plan) {
    let seen = new Set(); for (let s of plan.segs) if (s.ref && s.ref !== SILENCE && !seen.has(s.ref)) { seen.add(s.ref); await restorePages(s.ref) }
    for (let chunk of streamPlan(this, plan, offset, duration)) yield chunk
  } else yield* streamPcm(render(this))
}

proto.toJSON = function() {
  return { source: this.source, edits: this.edits, sampleRate: this.sampleRate, channels: this._.ch, duration: this.duration }
}
