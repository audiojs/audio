/**
 * Deck — the output: plays what a voice renders, at the speakers' rate. One AudioWorklet per playback on the
 * page's one AudioContext (Node: a pump into @audio/speaker). Engine-free: the worker facade uses it as is.
 *
 *   voice (engine: main thread or worker) ──port──▶ deck (audio thread) ──▶ speakers
 *                                          ◀─reports─         ──reports──▶ transport (main thread)
 *
 * A voice sends runs: its timeline as planar blocks at its own rate, placed on an axis in seconds (a loop's passes
 * follow one another on it). A run can replace what plays, crossfaded, where the playing run reaches a point (an
 * edit, a hand-off) or at once (a seek). The deck reads with a varispeed head (playbackRate, and the source rate to
 * the device rate through a windowed sinc; unit rate copies), ramps start, pause, stop and underrun, and reports
 * where its head is. A voice renders seconds ahead, so a busy thread does not starve the output; an edit replaces
 * that buffered future at once. The transport maps the reports to what the speakers play now (their latency
 * compensated): currentTime, and meters released when heard.
 */

// The deck core: plain JS, no imports, no outer names and no named inner functions (a bundler would rename or wrap
// those), since its source text is also the AudioWorklet processor's. The interpolation kernel: a windowed sinc of
// 16 zero crossings each side, tabulated at 256 points per crossing.
export class Deck {
  constructor(sampleRate, channels, report, init = {}) {
    this.sr = sampleRate
    this.ch = channels
    this.report = report
    this.runs = new Map()
    this.cur = null                 // the run playing, and its head: frames on its axis
    this.x = 0
    this.next = null                // a run waiting to splice in: { run, at, pos, fade, power }
    this.xf = null                  // a crossfade under way: { run, x } going out, x0 where the new run came in, n frames
    this.playing = init.playing ?? true
    this.stopping = false
    this.done = false
    this.vol = this.volT = init.volume ?? 1
    this.rate = this.rateT = init.rate ?? 1
    this.env = 0                    // start, pause, stop and underrun envelope
    this.moving = false
    this.starved = false
    this.R = Math.max(1, Math.round(sampleRate / 200))          // ramps of 5 ms
    this.kRate = 1 - Math.exp(-1 / (0.05 * sampleRate))          // playbackRate glides over ~50 ms, tape-style
    this.kVol = 1 - Math.exp(-1 / (0.005 * sampleRate))          // volume over ~5 ms
    this.got = 0                    // seconds received, for the voice's pacing
    this.due = 0                    // frames to the next report
    this.K = null                   // interpolation kernel, tabulated on first need
    this.w = new Float64Array(128)
    this.a = new Float64Array(channels)
    this.b = new Float64Array(channels)
  }

  // From the voice: { run, sr, pos, loop?, splice? } opens a run at `pos` seconds on its axis (`loop` [s, e]: the
  // axis runs on past e as passes of [s, e)); `splice` { at, fade, power } replaces what plays: where the playing
  // run reaches `at` (null: at once) crossfade over `fade` seconds (equal power, else linear) into this run at
  // pos + (head − at). { run, data } appends planar frames, { run, end } closes it, { run, loop } remaps it.
  feed(m) {
    if (m.sr) this.open(m)
    let r = this.runs.get(m.run)
    if (!r) return
    if (m.data) this.push(r, m.data)
    if (m.loop !== undefined) r.loop = m.loop
    if (m.end) r.ended = true
  }

  // From the transport: { playing }, { volume }, { rate }, { stop }
  set(m) {
    if (m.playing !== undefined) this.playing = !!m.playing
    if (m.volume !== undefined) this.volT = m.volume
    if (m.rate !== undefined) this.rateT = m.rate
    if (m.stop) this.stopping = true
  }

  open(m) {
    let r = { id: m.run, sr: m.sr, t0: Math.round(m.pos * m.sr), n: 0, cap: 0, tape: null, map: null, loop: m.loop ?? null, ended: false, played: false }
    this.runs.set(r.id, r)
    let s = m.splice
    if (!s && !this.cur && !this.next) { this.cur = r; this.x = r.t0; return }
    if (this.next) this.runs.delete(this.next.run.id)   // a newer splice supersedes one still waiting
    this.next = { run: r, at: s?.at ?? null, pos: m.pos, fade: s?.fade ?? 0.01, power: !!s?.power }
  }

  push(r, d) {
    let len = d[0].length
    if (!r.tape) {
      r.cap = 1 << Math.max(14, 32 - Math.clz32(len))
      r.tape = d.map(() => new Float32Array(r.cap))
      // a mono run fills the first two outputs, as speakers up-mix it; others map one to one
      r.map = Int8Array.from({ length: this.ch }, (_, c) => c < d.length ? c : d.length === 1 && c < 2 ? 0 : -1)
    }
    if (r.n + len > r.cap) {
      let h = r === this.cur ? this.x : this.xf && r === this.xf.run ? this.xf.x : r.t0
      let k = Math.max(0, Math.min(r.n, Math.floor(h) - 64 - r.t0))
      if (k) { for (let t of r.tape) t.copyWithin(0, k, r.n); r.t0 += k; r.n -= k }
      if (r.n + len > r.cap) {
        r.cap = 1 << (32 - Math.clz32(r.n + len - 1))
        r.tape = r.tape.map(t => { let u = new Float32Array(r.cap); u.set(t.subarray(0, r.n)); return u })
      }
    }
    for (let c = 0; c < r.tape.length; c++) r.tape[c].set(d[c] || d[0], r.n)
    r.n += len
    this.got += len / r.sr
  }

  render(out, n, frame) {
    let N = out.length, A = this.a, B = this.b
    for (let i = 0; i < n; i++) {
      if (this.rate !== this.rateT) { this.rate += (this.rateT - this.rate) * this.kRate; if (Math.abs(this.rateT - this.rate) < 1e-4) this.rate = this.rateT }
      if (this.vol !== this.volT) { this.vol += (this.volT - this.vol) * this.kVol; if (Math.abs(this.volT - this.vol) < 1e-5) this.vol = this.volT }
      if (this.next && !this.xf) this.splice(frame + i)
      let r = this.cur
      if (r) this.starve(r)
      let want = this.playing && !this.stopping && !this.starved && !!r
      this.env = want ? Math.min(1, this.env + 1 / this.R) : Math.max(0, this.env - 1 / this.R)
      // the head holds while silent (paused, stopped, underrun, idle); a hold starting or ending is reported
      if ((this.env > 0) !== this.moving) { this.moving = this.env > 0; this.post(frame + i) }
      if (!this.moving) {
        for (let c = 0; c < N; c++) out[c][i] = 0
        if (this.stopping && !this.done) { this.done = true; this.report({ stopped: frame + i }) }
        continue
      }
      let step = this.rate * r.sr / this.sr, g = this.env * this.vol
      // a run's end fades over the last 5 ms, so a span cut mid-sound ends without a click
      if (r.ended && !this.next) { let left = (r.t0 + r.n - this.x) / step; if (left < this.R) g *= Math.max(0, left) / this.R }
      this.read(r, this.x, step, A)
      r.played = true
      let f = this.xf
      if (f) {
        let fs = this.rate * f.run.sr / this.sr, t = Math.min(1, (this.x - f.x0) / f.n)
        let u = f.power ? Math.cos(t * Math.PI / 2) : 1 - t, v = f.power ? Math.sin(t * Math.PI / 2) : t
        this.read(f.run, f.x, fs, B)
        for (let c = 0; c < N; c++) out[c][i] = (B[c] * u + A[c] * v) * g
        f.x += fs
      } else for (let c = 0; c < N; c++) out[c][i] = A[c] * g
      this.x += step
      if (f && this.x - f.x0 >= f.n) { this.runs.delete(f.run.id); this.xf = null; this.post(frame + i + 1) }
      if (r.ended && !this.next && this.x >= r.t0 + r.n) {
        this.env = 0; this.moving = false
        this.post(frame + i + 1)          // where it ended, held
        this.runs.delete(r.id); this.cur = null
        this.report({ end: frame + i + 1 })
      }
    }
    if ((this.due -= n) <= 0) { this.due += 1024; this.post(frame + n) }
  }

  // Start a waiting run when the playing one reaches its point and it has audio there; late, it comes in aligned
  splice(f) {
    let s = this.next, r = s.run, c = this.cur, x
    if (s.at == null || !c) x = r.t0
    else {
      let sec = this.x / c.sr
      if (sec < s.at && !(c.ended && this.x >= c.t0 + c.n) && this.moving) return
      x = r.sr === c.sr && s.pos === s.at ? Math.max(r.t0, this.x) : Math.max(r.t0, (s.pos + Math.max(0, sec - s.at)) * r.sr)
    }
    let step = this.rate * r.sr / this.sr
    if (!r.ended && r.t0 + r.n - x < this.R * step + 16 * Math.min(4, Math.max(1, step)) + 1) return
    this.next = null
    if (c && this.moving) this.xf = { run: c, x: this.x, x0: x, n: Math.max(1, s.fade * r.sr), power: s.power }
    else if (c) this.runs.delete(c.id)   // nothing sounding: cut
    this.cur = r; this.x = x; this.starved = false
    this.post(f)
  }

  // Underrun: fade out while the audio lasts, hold, and come back once there is 50 ms (at the start, enough to fade)
  starve(r) {
    if (r.ended) { this.starved = false; return }
    let step = Math.max(this.rate, this.rateT) * r.sr / this.sr
    let have = r.t0 + r.n - this.x, need = this.R * step + 16 * Math.min(4, Math.max(1, step)) + 1
    if (!this.starved) { if (have < need) this.starved = true }
    else if (have >= (r.played ? Math.max(need, 0.05 * r.sr) : need)) this.starved = false
  }

  // Frames of run r at head x into acc, one per output: a copy at unit step on a sample, else a windowed sinc,
  // widened below the source's Nyquist when the head runs faster than the output (to 4×)
  read(r, x, step, acc) {
    let N = this.ch, m = r.map, tape = r.tape, t0 = r.t0, n = r.n
    if (!tape) { for (let c = 0; c < N; c++) acc[c] = 0; return }
    let i0 = Math.floor(x), fr = x - i0
    if (fr === 0 && step === 1) {
      let k = i0 - t0, ok = k >= 0 && k < n
      for (let c = 0; c < N; c++) acc[c] = ok && m[c] >= 0 ? tape[m[c]][k] : 0
      return
    }
    let K = this.K || this.table(), sc = step > 1 ? Math.max(0.25, 1 / step) : 1
    let M = Math.ceil(16 / sc), w = this.w, W = 0, j0 = i0 - M + 1 - t0
    for (let j = 0; j < 2 * M; j++) {
      let u = Math.abs(j - M + 1 - fr) * sc * 256, k = u | 0
      let v = k < 4096 ? K[k] + (K[k + 1] - K[k]) * (u - k) : 0
      w[j] = v; W += v
    }
    let lo = Math.max(0, -j0), hi = Math.min(2 * M, n - j0)
    for (let c = 0; c < N; c++) {
      let s = m[c]
      if (s < 0 || hi <= lo) { acc[c] = 0; continue }
      let d = tape[s], sum = 0
      for (let j = lo; j < hi; j++) sum += w[j] * d[j0 + j]
      acc[c] = sum / W
    }
  }

  // sinc(u) · Kaiser(β 8.6) over |u| < 16, 256 points per zero crossing, read between them linearly
  table() {
    let K = new Float32Array(4098), d = this.bessel(8.6)
    for (let k = 0; k <= 4096; k++) {
      let u = k / 256, r = u / 16
      K[k] = (k ? Math.sin(Math.PI * u) / (Math.PI * u) : 1) * this.bessel(8.6 * Math.sqrt(Math.max(0, 1 - r * r))) / d
    }
    return this.K = K
  }
  bessel(x) {
    let s = 1, t = 1, q = x * x / 4
    for (let k = 1; k < 64 && t > s * 1e-12; k++) { t *= q / (k * k); s += t }
    return s
  }

  // Where the head is at output frame f: on the axis of the run heard (the outgoing one through a crossfade),
  // how fast it moves (0 while held), how much audio waits ahead, how much has come
  post(f) {
    let o = this.xf ? this.xf.run : this.cur, x = this.xf ? this.xf.x : this.x, c = this.cur, nx = this.next
    this.report({
      frame: f, pos: o ? x / o.sr : null, speed: this.moving ? this.rate : 0, run: o ? o.id : null, loop: o ? o.loop : null,
      buf: (c ? Math.max(0, c.t0 + c.n - this.x) / c.sr : 0) + (nx ? nx.run.n / nx.run.sr : 0), got: this.got
    })
  }
}

// The worklet: the deck in the audio thread. The transport talks on the node's port; a voice feeds it on its own
// port, handed over in { voice }, straight from wherever it renders (a worker's never touch the main thread).
const WORKLET = () => `const Deck = (${Deck});
registerProcessor('audio-deck', class extends AudioWorkletProcessor {
  constructor(o) {
    super()
    let feed = null
    this.deck = new Deck(sampleRate, o.outputChannelCount[0], m => { this.port.postMessage(m); if (feed) feed.postMessage(m) }, o.processorOptions)
    this.port.onmessage = e => {
      let m = e.data
      if (!m.voice) return this.deck.set(m)
      if (feed) { feed.onmessage = null; feed.close() }
      feed = m.voice
      feed.onmessage = e => this.deck.feed(e.data)
      this.deck.got = 0
    }
  }
  process(i, o) { this.deck.render(o[0], o[0][0].length, currentFrame); return !this.deck.done }
})`


// ── The page's AudioContext ──────────────────────────────────────────────
// One per page, made on first use (a play, or reading it), resumed by the first gesture; or the one an app sets
// before playing. Kept on a global symbol, so every copy of the library on the page (the engine, the worker facade,
// bundles of either) plays through the same one.

const KEY = Symbol.for('audio.context'), GESTURES = ['pointerdown', 'keydown', 'touchend']
// the deck's module, loaded once per context by whichever copy comes first (a processor name registers once)
const modules = globalThis[Symbol.for('audio.deck')] ??= new WeakMap()
let moduleURL = null

/** The page's AudioContext: get (made on first use), or set (null forgets it). Null where there is no Web Audio. */
export function context(ctx) {
  if (ctx !== undefined) { globalThis[KEY] = ctx || undefined; if (ctx) prime(ctx); return ctx || null }
  if (globalThis[KEY]) return globalThis[KEY]
  if (typeof AudioContext === 'undefined') return null
  let made = new AudioContext({ latencyHint: 'interactive' })
  globalThis[KEY] = made
  prime(made)
  return made
}

// The deck's module loads as the context is made, so the first play finds it ready; a suspended context resumes
// on the first gesture (autoplay policy)
function prime(ctx) {
  load(ctx).catch(() => {})
  if (ctx.state !== 'suspended' || typeof addEventListener !== 'function') return
  const go = () => ctx.resume().then(() => { if (ctx.state === 'running') for (let t of GESTURES) removeEventListener(t, go, true) }, () => {})
  for (let t of GESTURES) addEventListener(t, go, true)
}

function load(ctx) {
  let p = modules.get(ctx)
  if (!p) modules.set(ctx, p = !ctx.audioWorklet
    ? Promise.reject(new Error('audio: playback needs AudioWorklet, which a page has in a secure context (https, localhost)'))
    : ctx.audioWorklet.addModule(moduleURL ??= URL.createObjectURL(new Blob([WORKLET()], { type: 'text/javascript' }))))
  return p
}


// ── Devices: where a deck plays ──────────────────────────────────────────

async function webDevice(ctx, ch, init) {
  await load(ctx)
  if (ctx.state === 'suspended') ctx.resume().catch(() => {})
  let node = new AudioWorkletNode(ctx, 'audio-deck', { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [ch], processorOptions: init })
  node.connect(ctx.destination)
  let dev = {
    sr: ctx.sampleRate, ch, report: null,
    attach(port) { node.port.postMessage({ voice: port }, [port]) },
    set(m) { node.port.postMessage(m) },
    // the context frame the speakers play now: the output timestamp run on to now, else the render time less the
    // reported latencies; never back, as the speakers never go back: the two disagree while the device starts (its
    // latency is not known yet), and each new timestamp may land short of the last one run on
    heard() {
      let s = ctx.getOutputTimestamp?.(), t = s?.contextTime > 0 && s.performanceTime > 0
        ? s.contextTime + (performance.now() - s.performanceTime) / 1000
        : ctx.currentTime - (ctx.outputLatency || 0) - (ctx.baseLatency || 0)
      return far = Math.max(far, Math.min(t, ctx.currentTime) * ctx.sampleRate)
    },
    close() { if (closed) return; closed = true; node.port.onmessage = null; node.port.close(); node.disconnect() },
  }
  let closed = false, far = 0
  node.port.onmessage = e => dev.report?.(e.data)
  return dev
}

// Node: the deck renders 1024 frames at a time into @audio/speaker, which paces the writes. Closing lets the last
// buffer (a fade's end) play out.
async function nodeDevice(sr, ch, init) {
  let { default: Speaker } = await import('@audio/speaker')
  let write = Speaker({ sampleRate: sr, channels: ch, bitDepth: 32 }), B = 1024, frame = 0, live = true, closing = false, feed = null
  let out = Array.from({ length: ch }, () => new Float32Array(B)), buf = new Float32Array(B * ch), bytes = new Uint8Array(buf.buffer)
  const take = m => deck.feed(m)
  const shut = () => { feed?.close(); feed = null; write.close() }
  let dev = {
    sr, ch, report: null,
    attach(port) { if (feed) { feed.off?.('message', take); feed.close() } feed = port; feed.on('message', take); deck.got = 0 },
    set(m) { deck.set(m) },
    heard: () => Math.max(0, frame - B - 0.05 * sr),   // what is written, less the device ring (~50 ms)
    close() { closing = true },
  }
  let deck = new Deck(sr, ch, m => { dev.report?.(m); feed?.postMessage(m) }, init)
  const tick = err => {
    if (!live) return
    if (err) { live = false; shut(); dev.report?.({ error: err }); return }
    deck.render(out, B, frame)
    frame += B
    for (let i = 0; i < B; i++) for (let c = 0; c < ch; c++) buf[i * ch + c] = out[c][i]
    if (!closing && !deck.done) return write(bytes, tick)
    live = false
    write(bytes, () => write.flush(shut))
  }
  tick()
  return dev
}


// ── Transport: the main thread's side of a deck ──────────────────────────

/** Open a deck: channels as the source has (two at least: mono plays on both), the rate the device runs at
 *  (the page's context; Node: sampleRate). */
export async function open({ channels, sampleRate, playing = true, volume = 1, rate = 1 } = {}) {
  let ctx = context(), ch = Math.max(2, channels | 0), init = { playing, volume, rate }
  return transport(ctx ? await webDevice(ctx, ch, init) : await nodeDevice(sampleRate, ch, init))
}

// The axis to the timeline: a loop's passes run on past its end
export const timeline = (v, loop) => !loop || v < loop[1] || !(loop[1] > loop[0]) ? v : loop[0] + (v - loop[1]) % (loop[1] - loop[0])

/** Where the speakers are at device frame `f`, from the deck's reports: the last at or before it, run on at its speed
 *  for the frames since, never past the audio the deck had waiting then (buf), nor past where its next report in the
 *  same run has the head (frames a glitching device skipped are numbered, never played), so the playhead of a starved
 *  deck, or one whose reports come late, holds and never steps back. { run, pos on the axis, time on the timeline } */
export function whereHeard(marks, f, sr) {
  let i = marks.length - 1
  while (i > 0 && marks[i].frame > f) i--
  let r = marks[i], n = marks[i + 1]
  if (!r) return null
  let pos = r.pos + Math.min(Math.max(0, f - r.frame) / sr * r.speed, r.buf ?? Infinity)
  if (n?.run === r.run && n.pos < pos) pos = n.pos
  return { run: r.run, pos, time: timeline(pos, r.loop) }
}

function transport(dev) {
  let marks = [], last = null, q = [], end = null, runs = 0, stopped = false
  let tp = {
    sr: dev.sr, ch: dev.ch,
    emit: null,                    // (type, value): 'report' (each report), 'end' (heard the end), 'error'
    // a port for a voice: its run ids start above every earlier voice's
    port() { let { port1, port2 } = new MessageChannel(); dev.attach(port1); return port2 },
    runs() { return runs += 1e6 },
    set(m) { if (!stopped) dev.set(m) },
    // the deck's head now, on the axis: its last report, run on, as far as the audio it had
    head() { return last && last.pos + Math.min((performance.now() - last.at) / 1000 * last.speed, last.buf ?? Infinity) },
    // what the speakers play now: { run, pos on the axis, time on the timeline }
    heard() { return whereHeard(marks, dev.heard(), dev.sr) },
    // call fn once position `pos` of run `run` is heard (meters); dropped if its run is replaced first
    defer(run, pos, fn) { q.push({ run, pos, fn }) },
    stop() {
      if (stopped) return
      stopped = true
      dev.set({ stop: 1 })
      setTimeout(() => dev.close(), 250)   // a suspended context reports nothing
    },
  }
  const release = all => {
    let h = all ? null : tp.heard()
    if (!all && !h) return
    while (q.length) {
      let e = q[0]
      if (h && (e.run > h.run || e.run === h.run && e.pos > h.pos)) break
      q.shift()
      if (all || e.run === h.run) e.fn()
    }
  }
  dev.report = m => {
    if (m.stopped != null) return dev.close()
    if (m.error) return tp.emit?.('error', m.error)
    if (m.end != null) end = m.end
    if (m.pos != null) {
      m.at = performance.now()
      last = m
      marks.push(m)
      // keep what the speakers are still to play, and the mark before it
      if (marks.length > 64) { let f = dev.heard(); while (marks.length > 2 && marks[1].frame <= f) marks.shift() }
    }
    if (stopped) return
    release(false)
    tp.emit?.('report', m)
    if (end != null && dev.heard() >= end) { end = null; release(true); tp.emit?.('end') }
  }
  return tp
}

/** Taking over another's playback (b.play({ from: a })): an instance or facade answers [TAKE]() with its
 *  transport and settings, and lets go of it. */
export const TAKE = Symbol.for('audio.take')
