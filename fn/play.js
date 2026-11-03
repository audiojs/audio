/**
 * Playback: a voice renders the instance's timeline into a deck (deck.js), which plays it. The page's one
 * AudioContext in a browser, @audio/speaker in Node. The voice is shared with the worker, which runs it by its engine.
 */
import audio, { emit, pacer, fromEnd, named } from '../core.js'
import { emitMeter } from './meter.js'
import { timeline, context, playback, TAKE } from '../deck.js'

const AHEAD = 2      // seconds rendered ahead of what plays, when the audio is there: a busy thread does not starve it
const SEAM = 0.01    // a loop's seam: its last 10 ms crossfade (equal power) into the 10 ms before its start
const EDIT = 0.02    // into an edit or another instance: linear (the same sound, changed)
const JUMP = 0.01    // a seek: equal power (another moment)

const now = () => performance.now()
const cat = bs => bs[0].map((_, c) => { let o = new Float32Array(bs.reduce((n, b) => n + b[0].length, 0)), p = 0; for (let b of bs) { o.set(b[c], p); p += b[c].length } return o })
const cut = (b, i, j) => b.map(c => c.slice(i, j))
const listen = (port, fn) => port.on ? port.on('message', fn) : port.onmessage = e => fn(e.data)

/**
 * A voice: renders `a` into a deck's port, from `from` (seconds on its axis, default `at`) over the span
 * [at, at + duration) (to the end without a duration), and, looping, pass after pass along the axis. It renders
 * AHEAD of the deck's head and keeps up with the instance: an edit re-renders from a moment ahead of the head and
 * splices in there, crossfaded, so it is heard where it happens. `splice` places its first run into what the deck
 * plays (a hand-off); `runs` numbers its runs above an earlier voice's; `meter(block, run, pos, time)` sees each block
 * before it goes.
 */
export function voice(a, port, { at = 0, duration, loop = false, from, splice = null, runs = 0, meter, error } = {}) {
  let id = runs, live = 0, floor = 0, stopped = false, sent = 0, lat = 0.03, wake = null, queued = false
  let s = at, dur = duration, e = dur != null ? at + dur : null   // the span; its end unknown (null) until the audio's
  let deck = { pos: null, speed: 1, at: 0, buf: 0, got: 0 }
  let v0 = from ?? at, sp0 = splice                               // where the first run starts, and how it comes in

  listen(port, m => {
    if (m.got == null) return
    deck.buf = m.buf; deck.got = m.got
    if (m.pos != null && m.run >= floor) { deck.pos = m.pos; deck.speed = m.speed; deck.at = now() }
    wake?.()
  })
  const post = (m, t) => port.postMessage(m, t)
  const span = () => loop && e != null ? [s, e] : null
  // the deck's head now, on the axis; how far ahead of it a new run can come in (held: right there)
  const head = () => deck.pos == null ? null : deck.pos + (now() - deck.at) / 1000 * deck.speed
  const ahead = () => (lat + 0.01) * deck.speed

  // Blocks along the axis from v: the timeline to the span's end; looping, pass after pass, the last X of each
  // pass crossfading into the X before the span's start, so the seam goes on as the sound went on into the start
  async function* axis(v, sr, ch, rid) {
    let looping = loop, S = Math.round(s * sr), tail = null, X = 0
    let n0 = Math.round(timeline(v, span()) * sr)
    for (;;) {
      let E = e == null ? Infinity : Math.round(e * sr)
      if (looping && !tail) X = Math.max(1, Math.min(Math.round(SEAM * sr), E < Infinity ? (E - S) >> 2 : Infinity))
      let h = tail ? tail[0].length : 0, total = 0, held = [], H = 0, lead = tail ? [] : null
      for await (let b of source(n0, E, sr, ch)) {
        total += b[0].length
        if (lead) {
          lead.push(b)
          if (lead.reduce((n, l) => n + l[0].length, 0) < h) continue
          let all = cat(lead), n = all[0].length
          lead = null
          yield seam(tail, all, X)
          if (n === h) continue
          b = cut(all, h, n)
        }
        if (!looping) { yield b; continue }
        held.push(b); H += b[0].length
        while (H - held[0][0].length >= X) { let f = held.shift(); H -= f[0].length; yield f }
      }
      if (lead) yield seam(tail, cat([...lead, Array.from({ length: ch }, () => new Float32Array(h))]), X)
      if (!looping) return
      let end = n0 + total
      if (e == null || end < E) { e = end / sr; post({ run: rid, loop: span() }) }
      let L = end - S
      if (L <= 0 || !H) return
      let all = cat(held), k = Math.min(X, H)
      if (H > k) yield cut(all, 0, H - k)
      tail = cut(all, H - k, H)
      X = Math.max(k, Math.min(X, L >> 2))
      n0 = S - tail[0].length   // the next pass: its lead-in first
    }
  }
  // the timeline over [n0, E) in samples, silence before 0
  async function* source(n0, E, sr, ch) {
    if (n0 < 0) { yield Array.from({ length: ch }, () => new Float32Array(Math.min(-n0, E - n0))); n0 = 0 }
    if (n0 < E) yield* a.stream({ at: n0 / sr, duration: E < Infinity ? (E - n0) / sr : undefined })
  }
  const seam = (tail, lead, X) => tail.map((c, k) => {
    let h = c.length, l = lead[k] || lead[0], o = new Float32Array(h)
    for (let j = 0; j < h; j++) { let u = (X - h + j + 0.5) / X * Math.PI / 2; o[j] = c[j] * Math.cos(u) + l[j] * Math.sin(u) }
    return o
  })

  // One run: the axis from v into the deck, paced to stay AHEAD of its head
  async function run(v, sp) {
    let rid = live = ++id, t0 = now()
    wake?.()   // a run waiting on the deck gives way
    try {
      if (a._.ready) await a._.ready
      if (s < 0) { s = await fromEnd(a, s); e = dur != null ? s + dur : null; if (v < 0) v = v0 = s }
      if (rid !== live) return
      let sr = a.sampleRate, ch = a.channels || 1, pos = v, opened = false, pace = pacer()
      const begin = () => { opened = true; lat = Math.min(0.25, (now() - t0) / 1000); post({ run: rid, sr, pos: v, loop: span(), splice: sp }) }
      for await (let b of axis(v, sr, ch, rid)) {
        if (rid !== live) return
        if (!opened) begin()
        let n = b[0].length
        meter?.(b, rid, pos, timeline(pos, span()), sr)
        post({ run: rid, data: b }, b.map(c => c.buffer))
        sent += n / sr; pos += n / sr
        await pace()
        while (rid === live && deck.buf + sent - deck.got > AHEAD) await new Promise(r => wake = r)
      }
      if (rid !== live) return
      if (!opened) begin()
      post({ run: rid, end: 1 })
    } catch (err) { if (rid === live && !stopped) error?.(err) }
  }

  // An edit: render again from a moment ahead of the head, splicing in there (a burst of edits: once). With no report
  // yet, from where the run started: the deck brings a splice in aligned to its head, wherever that is by then.
  const change = () => {
    if (queued || stopped) return
    queued = true
    queueMicrotask(() => {
      queued = false
      if (stopped) return
      let h = head(), P = h == null ? v0 : h + ahead()
      run(P, { at: P, fade: EDIT })
    })
  }
  // A new span or loop from here on: a run on a fresh axis, spliced where the head will be
  const rebase = () => {
    let h = head(), P = h == null ? null : h + ahead(), was = span()
    let t = P == null ? v0 : timeline(P, was)
    if (loop && e != null) t = s + ((t - s) % (e - s) + (e - s)) % (e - s)
    anchor(t, P == null ? 0 : ahead())
    v0 = t; sp0 = null
    run(t, P == null ? null : { at: P, fade: EDIT })
  }
  const anchor = (pos, lead = 0) => { floor = id + 1; deck.pos = pos; deck.at = now() + lead / Math.max(deck.speed, 0.0625) * 1000 }

  a.on('change', change)
  run(v0, sp0)

  return {
    // a jump: { run, at } — the run it plays in, and where it went (a loop's seek stays in its span)
    seek(t) {
      if (loop && e != null && e > s) t = s + ((t - s) % (e - s) + (e - s)) % (e - s)
      t = Math.max(0, t)
      anchor(t)
      v0 = t; sp0 = null
      run(t, { at: null, fade: JUMP, power: true })
      return { run: live, at: t }
    },
    loop(v) { if (!!v !== loop) { loop = !!v; rebase() } },
    span(at, duration) { s = at; dur = duration; e = dur != null ? at + dur : null },
    stop() {
      if (stopped) return
      stopped = true; live = 0; wake?.()
      a.off('change', change)
      port.close()
    },
  }
}


// ── The instance's transport ─────────────────────────────────────────────

/** The page's AudioContext, which playback uses: made on first use, resumed by the first gesture; set one before
 *  playing to use it. The same one as audioWorker.context. Null in Node. */
Object.defineProperty(audio, 'context', { get: () => context(), set: ctx => context(ctx), enumerable: true, configurable: true })
// the worker host plays through the engine it loads (one module: a bundle of audio.js carries these along)
audio[Symbol.for('audio.play')] = { voice, emitMeter }

// The instance's side of its playback (deck.js playback): its voice renders here, and what it renders is measured here
// as it is heard (a.block, meters)
const side = a => ({
  x: a,
  get s() { return a._.play }, set s(s) { a._.play = s },
  get ct() { return a._.ct }, set ct(t) { a._.ct = t },
  emit: (type, ...args) => emit(a, type, ...args),
  ready: () => a._.ready,
  voice: (tp, o, s) => voice(a, tp.port(), {
    ...o,
    // the block heard: kept (a copy: the block itself goes to the deck) and measured when it plays
    meter: (b, run, pos, time, sr) => {
      let k = b.map(c => c.slice())
      tp.defer(run, pos + b[0].length / 2 / sr, () => { a.block = k[0]; if (a._.meters?.length) emitMeter(a, k, time) })
    },
    error: s.fail,
  }),
})

/** play({ at, duration, loop, volume, rate, preservesPitch, paused, from }): `at` defaults to where playback is (the
 *  start once ended). Playing already, it goes to `at` (or the new span) without a gap. `from`: take over that
 *  instance's playback where it is, crossfaded: its span, loop, volume, rate and pause; it stops. At a `rate` other
 *  than 1 the pitch is kept, as a media element keeps it (deck.js: WSOLA), unless `preservesPitch` is false: then it
 *  follows the speed, as a tape's. */
audio.fn.play = function(opts = {}) {
  opts = named(opts)
  if (this._.disposed) throw new Error('audio: instance disposed')
  let s = this._.play
  playback(side(this), opts)
  if (this._.play !== s) this.block = null   // a playback begun: no block heard yet
  return this
}

let proto = audio.fn
proto.pause = function() { this._.play?.pause(); return this }
proto.resume = function() { this._.play?.resume(); return this }
/** Let go of playback for another instance to continue it (deck.js TAKE) */
proto[TAKE] = function() { return this._.play?.take() ?? null }
