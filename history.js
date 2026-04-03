/**
 * History plugin — non-destructive edit pipeline.
 * Wraps read/stream to apply edits at render time.
 * Overrides length/channels to walk edit hints.
 * Adds: toJSON, stats rebuild on query.
 */

import { SILENCE } from './plan.js'
import { statSession, buildStats } from './stats.js'
import { restorePages } from './cache.js'
import { ops, render, buildPlan, streamPlan, streamPcm, readPlan } from './render.js'

export { render }

export default (audio) => {
  let fn = audio.fn

  // ── Override length/channels — walk edits via .dur/.ch hints ───────

  Object.defineProperties(fn, {
    length: { get() {
      if (this._.lenV === this.version) return this._.lenC
      let len = this._.len, sr = this.sampleRate
      for (let { type, args = [] } of this.edits) {
        let init = ops[type]
        if (init?.dur) len = init.dur(len, sr, args)
      }
      this._.lenC = len; this._.lenV = this.version
      return len
    }, configurable: true },
    channels: { get() {
      if (this._.chV === this.version) return this._.chC
      let ch = this._.ch
      for (let edit of this.edits) { let init = ops[edit.type]; if (init?.ch) ch = init.ch(ch, edit.args) }
      this._.chC = ch; this._.chV = this.version
      return ch
    }, configurable: true },
  })

  // ── Wrap read — apply edits via plan or full render ────────────────

  let _read = fn.read
  fn.read = async function(offset, duration, opts) {
    if (!this.edits.length) return _read.call(this, offset, duration, opts)

    if (typeof offset === 'object' && !opts) { opts = offset; offset = undefined }
    else if (typeof duration === 'object' && !opts) { opts = duration; duration = undefined }

    await restorePages(this)
    for (let { args } of this.edits) if (args?.[0]?.pages) await restorePages(args[0])

    let plan = buildPlan(this)
    let pcm = plan ? readPlan(this, plan, offset, duration) : render(this).map(ch => {
      if (offset == null) return ch.slice()
      let s = Math.round(offset * this.sampleRate)
      return ch.slice(s, duration != null ? s + Math.round(duration * this.sampleRate) : ch.length)
    })

    let fmt = opts?.format
    if (fmt) {
      let encode = (await import('audio-encode')).default
      let convert = (await import('pcm-convert')).default
      if (encode[fmt]) return encode[fmt](pcm, { sampleRate: this.sampleRate, ...opts?.meta })
      return pcm.map(ch => convert(ch, 'float32', fmt))
    }
    return pcm
  }

  // ── Wrap stream — apply edits via plan ─────────────────────────────

  fn[Symbol.asyncIterator] = fn.stream = async function*(offset, duration) {
    await restorePages(this)
    let plan = buildPlan(this)
    if (plan) {
      let seen = new Set()
      for (let s of plan.segs) if (s.ref && s.ref !== SILENCE && !seen.has(s.ref)) { seen.add(s.ref); await restorePages(s.ref) }
      for (let chunk of streamPlan(this, plan, offset, duration)) yield chunk
    } else yield* streamPcm(render(this))
  }

  // ── Wrap query — rebuild stats if dirty ────────────────────────────

  let _query = fn.query
  fn.query = async function(offset, duration) {
    if (this.edits.length && this._.statsV !== this.version) {
      rebuildStats(this)
      this._.statsV = this.version
    }
    return _query.call(this, offset, duration)
  }

  // ── toJSON ─────────────────────────────────────────────────────────

  fn.toJSON = function() {
    return { source: this.source, edits: this.edits, sampleRate: this.sampleRate, channels: this._.ch, duration: this.duration }
  }
}

function rebuildStats(a) {
  if (!a.edits.length) return
  let plan = buildPlan(a)
  if (!plan) { a.stats = buildStats(render(a), a._.ch, a.sampleRate); return }
  let s = statSession(a._.ch, a.sampleRate)
  for (let chunk of streamPlan(a, plan)) s.page(chunk)
  a.stats = s.done()
}
