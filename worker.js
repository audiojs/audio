/**
 * audio/worker — the whole engine in a Worker, one file, two faces:
 *
 * On the MAIN thread it exports the facade — imports none of the engine, stays a
 * few KB. Inside a WORKER it self-hosts: loads the engine via dynamic import and
 * speaks the protocol (open/call/sub/stream) on a port of its own. The default spawn
 * runs this same file as the worker entry.
 *
 *   import audioWorker from 'audio/worker'
 *   let a = audioWorker('track.mp3')
 *   a.gain(-3).fade(0.5)                              // ops mirror the worker registry
 *   let [mins, maxs] = await a.stat(['min','max'], { bins: 640 })
 *   let pcm = await a.read({ at: 1, duration: 2 })    // transferred, zero-copy
 *   await a.save('out.wav')
 *
 * The edit list is the protocol: ops post `[type, opts]` tuples, the worker
 * replays them through the real engine — undo, serialization and stream≡read
 * come along for free. Facades sharing one worker can reference each other
 * (`a.mix(b)`), resolved worker-side by instance id.
 *
 * Custom worker (extra codecs, plugins, the app's own code): an entry that imports them, then this file:
 *   import '@audio/decode-aac'
 *   import { expose } from 'audio/worker'      // self-hosts; codecs registered first
 *   self.onmessage = e => { ... self.postMessage({ output: expose(a) }) }   // the app's own messages
 * and on the page: audioWorker('a.m4a', { worker }), or audioWorker.adopt(id, { worker }) for an instance it made.
 * The engine talks on a MessageChannel handed over once ({ '@audio': port }), so the app's messages on the Worker
 * never meet its protocol.
 *
 * Boundary deviations from the local API (all async by nature):
 *  - clip()/split()/clone() return Promise<facade>
 *  - op errors surface on the 'error' event and reject the next awaited call;
 *    use `await a.run([type, opts])` for strict per-op errors
 *  - function-valued params don't cross — use breakpoint curves {t, v} (serializable
 *    automation, sampled by the engine like functions)
 *  - play() renders in the worker straight into the page's AudioWorklet (deck.js), past the main thread;
 *    Node: @audio/speaker
 */

import { open, context, TAKE } from './deck.js'   // the output (no engine deps)

// ── Self-host: imported inside a Worker, this module becomes the engine host ──
const nodeWT = typeof process !== 'undefined' && process.versions?.node
  ? await import('node:worker_threads').catch(() => null) : null
let hosted = null   // the host's registry, when this module runs in a worker
if ((typeof WorkerGlobalScope !== 'undefined' && self instanceof WorkerGlobalScope) || (nodeWT && !nodeWT.isMainThread)) hosted = host(nodeWT?.parentPort)

const listen = (port, fn) => port.on ? port.on('message', fn) : port.onmessage = e => fn(e.data)
const isPort = v => typeof MessagePort !== 'undefined' && v instanceof MessagePort

// ── Channel: one worker, many instances ─────────────────────────────────

function channel(workerOrPromise) {
  let pending = new Map(), routes = new Map(), nextId = 1, queue = []
  let port = null, worker = null, closed = false
  const rejectPending = error => {
    for (const p of pending.values()) p.reject(error)
    pending.clear()
    queue = []
  }
  const post = (msg, transfer) => {
    try { port.postMessage(msg, transfer || []) }
    catch (error) {
      const request = pending.get(msg.id)
      pending.delete(msg.id)
      request?.reject(error)
    }
  }

  Promise.resolve(workerOrPromise).then(w => {
    worker = w
    // the engine's own port: the Worker's messages stay the app's
    let mc = new MessageChannel()
    w.postMessage({ '@audio': mc.port2 }, [mc.port2])
    port = mc.port1
    listen(port, msg => {
      if (msg.id != null) {
        let p = pending.get(msg.id)
        if (!p) return
        pending.delete(msg.id)
        if (msg.snapshot) p.facade?._snap(msg.snapshot)
        msg.error ? p.reject(remoteErr(msg.error)) : p.resolve(msg.result)
      } else if (msg.event) {
        routes.get(msg.inst)?.(msg)
      }
    })
    for (let [m, t] of queue.splice(0)) post(m, t)
  }, error => { closed = true; rejectPending(error) })

  return {
    route: (inst, cb) => closed ? cb({ event: '_close' }) : routes.set(inst, cb),
    unroute: inst => routes.delete(inst),
    send(msg, transfer, facade) {
      if (closed) return Promise.reject(new Error('audio/worker: worker closed'))
      return new Promise((resolve, reject) => {
        msg.id = nextId++
        pending.set(msg.id, { resolve, reject, facade })
        port ? post(msg, transfer) : queue.push([msg, transfer])
      })
    },
    close() {
      const done = this.send({ type: 'close' })
      closed = true
      for (const route of routes.values()) route({ event: '_close' })
      routes.clear()
      return done.finally(() => {
        rejectPending(new Error('audio/worker: worker closed'))
        port?.close()
        worker?.terminate?.()
      })
    },
  }
}

const remoteErr = e => { let err = new Error(e.message); if (e.stack) err.stack = e.stack; return err }

async function spawn(url) {
  if (typeof Worker !== 'undefined') return new Worker(url, { type: 'module' })
  let { Worker: NodeWorker } = await import('node:worker_threads')
  return new NodeWorker(url)
}

let shared = null
const sharedChannel = () => shared ??= channel(spawn(new URL(import.meta.url)))

// one channel per custom worker — a second channel on the same worker would
// double-consume messages and collide call ids; same-channel facades can ref each other
const workerChans = new WeakMap()
const workerChannel = w => {
  let chan = workerChans.get(w)
  if (!chan) workerChans.set(w, chan = channel(w))
  return chan
}

/** Terminate the shared worker (all default-channel facades die with it). */
export async function close() {
  if (!shared) return
  let c = shared; shared = null
  await c.close()
}

// ── Facade ───────────────────────────────────────────────────────────────

// Core async surface bridged explicitly; everything else the proxy treats as a
// chainable op — the worker registry is the source of truth, nothing duplicated here.
const ASYNC = ['read', 'stat', 'encode', 'save', 'undo', 'push', 'detect', 'toJSON']
const WRAPPED = ['clip', 'clone', 'split']  // return new instance(s) → sub-facades
// events the facade raises itself; any other needs a worker-side subscription
const LOCAL = ['change', 'error', 'play', 'pause', 'ended', 'timeupdate', 'volumechange', 'ratechange']
const EDIT = 0.02

/** Deep-encode outgoing values: sibling facades → {__ref}, functions rejected
 *  (can't cross the boundary — P3 breakpoint curves), containers copied. */
function encodeArg(v, chan) {
  if (typeof v === 'function') throw new TypeError('audio/worker: function params cannot cross the worker boundary — use a breakpoint curve { t: [...], v: [...] }')
  if (!v || typeof v !== 'object') return v
  if (v.__isAudioWorker) {
    if (v._chan !== chan) throw new TypeError('audio/worker: facades must share a worker to reference each other')
    return { __ref: v._inst }
  }
  if (ArrayBuffer.isView(v) || v instanceof ArrayBuffer || isPort(v)) return v
  if (typeof Blob !== 'undefined' && v instanceof Blob) return v  // File/Blob clone natively — deep copy would strip prototype props
  if (Array.isArray(v)) return v.map(x => encodeArg(x, chan))
  let o = {}
  for (let k of Object.keys(v)) o[k] = encodeArg(v[k], chan)
  return o
}
const encodeArgs = (args, chan) => args.map(v => encodeArg(v, chan))

function facade(chan, opened) {
  let ev = {}, opErr = null, disposed = false, disposal
  let target = {
    __isAudioWorker: true,
    _chan: chan,
    _inst: null,
    _ready: null,
    sampleRate: 0, channels: 0, length: 0, duration: 0, version: 0,
    decoded: false, edits: [],

    _snap(s) { if (!disposed) Object.assign(target, s) },
    _emit(name, ...args) { for (let cb of (ev[name] || []).slice()) cb(...args) },

    _call(method, args = [], transfer) {
      if (disposed) return Promise.reject(new Error('audio/worker: instance disposed'))
      if (opErr) { let e = opErr; opErr = null; return Promise.reject(e) }
      let wire = encodeArgs(args, chan)  // validate before queuing — throw at the call site
      return target._ready.then(() => {
        if (disposed) throw new Error('audio/worker: instance disposed')
        return chan.send({ type: 'call', inst: target._inst, method, args: wire }, transfer, proxy)
      }).then(r => decodeResult(r))
    },

    on(name, cb) {
      ;(ev[name] ??= []).push(cb)
      if (!LOCAL.includes(name) && !ev[name]._sub) {
        ev[name]._sub = true
        target._ready.then(() => chan.send({ type: 'sub', inst: target._inst, event: name })).catch(() => {})
      }
      return proxy
    },
    off(name, cb) {
      if (!name) ev = {}
      else if (!cb) delete ev[name]
      else { let i = (ev[name] || []).indexOf(cb); if (i >= 0) ev[name].splice(i, 1) }
      return proxy
    },

    /** Apply one edit strictly — rejects on op error (ops are otherwise fire-and-forget). */
    run(edit) { return target._call('run', [edit]).then(() => {}) },
    /** Settle all posted ops (FIFO channel — resolves after everything before it). */
    flush() { return target._call('toJSON').then(() => {}) },

    async *stream(opts) {
      let sid = await target._call('_streamOpen', [opts])
      try {
        while (true) {
          let chunk = await target._call('_streamNext', [sid])
          if (!chunk) return
          yield chunk
        }
      } finally { target._call('_streamEnd', [sid]).catch(() => {}) }
    },

    // ── Transport: the worker renders straight into the page's deck (deck.js); the facade holds its clock
    playing: false, paused: false, ended: false, seeking: false, played: null,
    get currentTime() { let h = session?.tp?.heard(); return h && h.run >= session.seekRun ? h.time : ct },
    set currentTime(v) { ct = v },
    get volume() { return vol },
    set volume(v) { v = Math.max(0, Math.min(1, +v || 0)); if (vol !== v) { vol = v; level(); target._emit('volumechange') } },
    get muted() { return mute },
    set muted(v) { v = !!v; if (mute !== v) { mute = v; level(); target._emit('volumechange') } },
    get playbackRate() { return rate },
    set playbackRate(v) {
      v = Math.max(0.0625, Math.min(16, +v || 1))
      if (rate !== v) { rate = v; session?.tp?.set({ rate }); target._emit('ratechange') }
    },
    get loop() { return loop },
    set loop(v) { v = !!v; if (loop !== v) { loop = v; if (session) target._call('_loop', [v]).catch(() => {}) } },

    play(opts = {}) {
      if (disposed) return Promise.reject(new Error('audio/worker: instance disposed'))
      if (opts.volume != null) target.volume = opts.volume
      if (opts.rate != null) target.playbackRate = opts.rate
      if (opts.from) return handoff(opts.from, opts)
      if (session && target.playing) {
        if (opts.loop != null) target.loop = opts.loop
        if (opts.at != null || opts.duration !== undefined) {
          span = [opts.at ?? span[0], opts.duration]
          target._call('_span', span).catch(() => {})
          target.seek(span[0])
        }
        if (target.paused && !opts.paused) target.resume()
        return target.played
      }
      loop = !!opts.loop
      return begin({ at: opts.at ?? (target.ended ? 0 : ct), duration: opts.duration, paused: opts.paused })
    },
    pause() {
      if (!target.playing || target.paused) return proxy
      target.paused = true
      session?.tp?.set({ playing: false })
      target._emit('pause')
      return proxy
    },
    resume() {
      if (!target.paused) return proxy
      target.paused = false
      session?.tp?.set({ playing: true })
      target._emit('play')
      return proxy
    },
    // While it plays, the clock holds the place asked for until the worker says which run plays it (the speakers' run
    // before it is not), as the local deck's does; a later seek's answer is the one that counts
    seek(t) {
      ct = t = Math.max(0, t)
      if (!session || !target.playing) return target._call('seek', [t])
      target.seeking = true
      let s = session, n = ++s.seeks
      s.seekRun = Infinity
      let done = r => { if (s === session && n === s.seeks) { s.seekRun = r?.run ?? 0; if (r) ct = r.at } }
      return target._call('_seek', [t]).then(done, e => { done(); throw e })
    },
    stop() {
      end(false)
      return target._call('stop', [])
    },
    /** Live stats of what plays, released as it is heard: same arguments as the local meter() */
    meter(what, cb) {
      let opts = typeof what === 'string' || Array.isArray(what) ? { type: what } : what ?? {}
      let id = ++probeId, probe = { opts, cb, value: undefined, stop: null }
      probes.set(id, probe)
      target._call('_meter', [id, opts]).catch(() => {})
      probe.stop = () => { if (probes.delete(id)) target._call('_meter', [id, null]).catch(() => {}) }
      return probe
    },
    [TAKE]() {
      let s = session
      if (!s || !target.playing) return null
      let t = { tp: s.tp, head: s.tp?.head(), time: target.currentTime, span, loop, paused: target.paused, volume: vol, muted: mute, rate }
      s.taken = !!s.tp
      end(false)
      return t
    },

    dispose() {
      if (disposal) return disposal
      release()
      return disposal = target._ready.then(() => {
        let done = chan.send({ type: 'dispose', inst: target._inst }).catch(() => {})
        chan.unroute(target._inst)
        return done
      })
    },
  }

  for (let m of ASYNC) target[m] ??= (...args) => target._call(m, args)
  for (let m of WRAPPED) target[m] = (...args) => target._call(m, args)

  // ── Playback session ─────────────────────────────────────────────────
  let session = null, ct = 0, vol = 1, mute = false, rate = 1, loop = false, span = [0, undefined], probeId = 0
  let probes = new Map()
  const level = () => session?.tp?.set({ volume: mute ? 0 : vol })

  function begin(o, taken) {
    end(false)
    let s = session = { tp: null, taken: false, done: false, first: true, seekRun: 0, seeks: 0, ok: null, fail: null }
    target.playing = true; target.paused = !!o.paused; target.ended = false; target.seeking = false
    span = [o.at, o.duration]
    ct = o.time ?? Math.max(0, o.at)
    target.played = new Promise((r, j) => { s.ok = r; s.fail = j })
    target.played.catch(() => {})
    if (!target.paused) target._emit('play')
    ;(async () => {
      try {
        await target._ready
        // the rate and channels arrive with the source's header
        while (!target.sampleRate && !s.done) await new Promise(r => { let f = () => { target.off('change', f); r() }; target.on('change', f) })
        let tp = taken ?? await open({ channels: target.channels, sampleRate: target.sampleRate, playing: !target.paused, volume: mute ? 0 : vol, rate })
        if (s.done) { if (!taken) tp.stop(); return }
        s.tp = tp
        if (taken) tp.set({ playing: !target.paused, volume: mute ? 0 : vol, rate })
        tp.emit = (type, m) => {
          if (session !== s) return
          if (type === 'end') return end(true)
          if (type === 'error') return end(false, m)
          if (m.pos == null) return
          if (s.first && m.speed > 0) { s.first = false; s.ok() }
          if (target.seeking && m.run >= s.seekRun) target.seeking = false
          if (target.playing && !target.paused) target._emit('timeupdate', target.currentTime)
        }
        // the span and a seek asked for before the deck opened: as they are now
        let port = tp.port()
        await target._call('_play', [{ at: span[0], duration: span[1], loop, from: o.from ?? (target.seeking ? ct : undefined), splice: o.splice, runs: tp.runs(), port }], [port])
      } catch (e) { if (session === s) end(false, e) }
    })()
    return target.played
  }
  // playback ends: at its end, by stop(), an error, or taken over
  function end(natural, err) {
    let s = session
    if (!s || s.done) return
    s.done = true
    let h = s.tp?.heard()
    if (h && h.run >= s.seekRun) ct = h.time
    session = null
    if (!s.taken) s.tp?.stop()
    if (!disposed && target._inst != null) target._call('_stop', []).catch(() => {})
    target.playing = target.paused = target.seeking = false
    if (natural) target.ended = true
    if (err && s.first) s.fail(err)
    else s.ok()
    if (err && !s.first) target._emit('error', err)
    target._emit('ended')
  }
  function handoff(from, opts) {
    let t = from[TAKE]?.()
    if (t) {
      if (opts.volume == null) target.volume = t.volume
      if (opts.rate == null) target.playbackRate = t.rate
      target.muted = t.muted
    }
    loop = opts.loop ?? t?.loop ?? from.loop ?? false
    let sp = t?.span ?? [from.currentTime ?? 0, undefined]
    // the deck carries on when it has the channels; else a new one starts where the other stopped, over the same span
    if (!t?.tp || t.head == null || Math.max(2, target.channels | 0) > t.tp.ch) {
      t?.tp?.stop()
      return begin({ at: sp[0], duration: sp[1], paused: opts.paused ?? t?.paused, time: t?.time, from: t?.time })
    }
    let P = t.head + (t.paused ? 0 : 0.05 * t.rate)
    return begin({ at: sp[0], duration: sp[1], paused: t.paused, time: t.time, from: P, splice: { at: P, fade: EDIT } }, t.tp)
  }

  const release = () => {
    disposed = true
    end(false)
    target.edits.length = 0
    for (const check of [...waiters]) check(new Error('audio/worker: instance disposed'))
    ev = {}
  }

  // NB: never resolve a call promise with the proxy — it's a thenable gated on
  // `decoded`, so promise adoption would block chainable-method awaits on a source
  // that may never decode (pushables). Self-returns collapse to undefined.
  let decodeResult = r => {
    if (r?.__self) return undefined
    if (r?.__inst) return adopt(r)
    if (Array.isArray(r) && r[0]?.__inst) return r.map(adopt)
    return r
  }
  let adopt = r => facade(chan, Promise.resolve({ inst: r.__inst, snapshot: r.snapshot, ops: target._opNames }))

  let proxy = new Proxy(target, {
    get(t, prop) {
      if (prop in t) return t[prop]
      if (prop === 'then')
        return t.decoded ? undefined : (res, rej) => t._ready.then(() => waitDecoded()).then(() => proxy).then(res, rej)
      if (prop === 'catch') return rej => proxy.then?.(null, rej) ?? Promise.resolve(proxy)
      if (typeof prop !== 'string' || prop.startsWith('_')) return t[prop]
      // any other name: a chainable op — validated worker-side against the live registry
      return (...args) => {
        t._call(prop, args).catch(e => { opErr = e; t._emit('error', e) })
        return proxy
      }
    },
  })

  let waiters = new Set()
  let waitDecoded = () => disposed ? Promise.reject(new Error('audio/worker: instance disposed')) : target.decoded ? Promise.resolve() : new Promise((res, rej) => {
    let check = error => { if (error) { done(); rej(error) } else if (target.decoded) { done(); res() } }
    let onErr = e => { done(); rej(e) }
    let done = () => { let i = (ev.error || []).indexOf(onErr); if (i >= 0) ev.error.splice(i, 1); waiters.delete(check) }
    waiters.add(check)
    ;(ev.error ??= []).push(onErr)
  })

  // Resolve with a plain value — resolving with the (thenable) proxy would make
  // the promise adopt proxy.then, which waits on this very promise: deadlock.
  target._ready = opened.then(({ inst, snapshot, ops }) => {
    target._inst = inst
    if (disposed) return true
    target._opNames = ops
    target._snap(snapshot)
    chan.route(inst, msg => {
      if (msg.event === '_close') {
        release()
      } else if (msg.event === '_state') {
        target._snap(msg.snapshot)
        for (let w of [...waiters]) w()
        target._emit('change')
      } else if (msg.event === '_meter') {
        // values measured as the worker rendered, released as they are heard
        let [run, pos, vals] = msg.args
        session?.tp?.defer(run, pos, () => { for (let [id, v] of vals) { let p = probes.get(id); if (p) { p.value = v; p.cb?.(v) } } })
      } else if (msg.event === '_playerror') {
        let e = remoteErr(msg.args[0])
        console.error('Playback error:', e)
        end(false, e)
      } else if (msg.event === 'error') {
        target._emit('error', remoteErr(msg.args[0]))
      } else target._emit(msg.event, ...msg.args)
    })
    return true
  })
  target.ready = target._ready.then(() => waitDecoded()).then(() => true)
  target.ready.catch(() => {})

  return proxy
}

/** Open a source in the engine worker. Same call shape as audio(source, opts);
 *  pass opts.worker to use your own worker (custom codecs/plugins). */
export default function audioWorker(source, opts = {}) {
  let { worker, ...rest } = opts
  let chan = worker && worker !== true ? workerChannel(worker) : sharedChannel()
  if (Array.isArray(source) && source.some(s => s?.__isAudioWorker))
    throw new TypeError('audio/worker: open plain sources, then combine with insert()/mix()/crossfade()')
  return facade(chan, chan.send({ type: 'open', source, opts: rest }))
}

/** A facade for an instance the worker's own code made and exposed (expose(a) in the worker gives the id). */
audioWorker.adopt = (id, { worker } = {}) => {
  if (!worker) throw new TypeError('audio/worker: adopt(id, { worker }) — the worker that exposed it')
  let chan = workerChannel(worker)
  return facade(chan, chan.send({ type: 'adopt', inst: id }))
}

/** The page's AudioContext, the one playback uses (shared with the engine's audio.context) */
Object.defineProperty(audioWorker, 'context', { get: () => context(), set: ctx => context(ctx), enumerable: true })

/** In a worker: register an instance the app made, for the page to adopt; returns its id (the same id again for the
 *  same instance). */
export function expose(a) {
  if (!hosted) throw new Error('audio/worker: expose() runs in a worker that imports audio/worker')
  return hosted.expose(a)
}

// P4 — `audio(src, { worker: true })` dispatches here once this module is imported.
// A global slot (not an engine import) keeps this facade out of the engine's graph
// and the engine out of this file — either can load without dragging in the other.
globalThis[Symbol.for('audio.worker')] = audioWorker

// ── Engine host — runs when this module is imported inside a Worker ──────
// The listener attaches synchronously: a page connects by handing over a port ({ '@audio': port }), which the
// engine speaks on from then (messages wait while the engine loads via dynamic import); every other message on the
// Worker is the app's. The engine chunk never loads on the main thread.
function host(nodePort) {
  const scope = nodePort || self
  const pending = []
  let handle = (msg, reply) => pending.push([msg, reply])
  const instances = new Map()   // id → audio instance
  const owners = new Map()      // id → the connection that opened or adopted it (its events go there)
  const ids = new WeakMap()     // instance → id
  const dataSubs = new Map()    // id → flush fn (replays 'data' buffered before the sub landed)
  let nextInst = 1

  const connect = port => listen(port, msg => handle(msg, (m, t) => port.postMessage(m, t || [])))
  const onMessage = e => {
    let d = nodePort ? e : e.data, port = d?.['@audio']
    if (!port) return
    e.stopImmediatePropagation?.()   // the app's own listeners never see the handshake
    connect(port)
  }
  nodePort ? nodePort.on('message', onMessage) : scope.addEventListener('message', onMessage)

  // Live instances in edit opts (mix/insert sources) aren't structured-cloneable —
  // replace with a marker; the facade's edits mirror is informational (undo depth, UI)
  const safeEdits = edits => edits.map(([t, o]) => [t, o && Object.fromEntries(
    Object.entries(o).map(([k, v]) => [k, v?.pages ? { __audio: true } : v]))])

  const snap = a => ({
    version: a.version, length: a.length, duration: a.duration,
    sampleRate: a.sampleRate, channels: a.channels, decoded: a.decoded,
    edits: safeEdits(a.edits),
  })

  const errObj = e => ({ message: e?.message ?? String(e), stack: e?.stack })

  function register(a) {
    if (ids.has(a)) return ids.get(a)
    let id = nextInst++
    instances.set(id, a)
    ids.set(a, id)
    let send = msg => { try { owners.get(id)?.(msg) } catch {} }
    let state = () => send({ event: '_state', inst: id, snapshot: snap(a) })
    a.on('change', state)
    a.on('metadata', state)
    a.on('error', e => send({ event: 'error', inst: id, args: [errObj(e)] }))
    a.ready?.then(state, () => {})  // decoded=true snapshot; rejection already emitted as 'error'
    // 'data' streams during decode, which starts at open — before the facade's 'sub' round-trip
    // lands. Attach the forwarder now and buffer until the sub arrives, else early deltas drop.
    let q = [], live = false
    a.on('data', (...args) => {
      if (live) send({ event: 'data', inst: id, args })
      else q.push(args)
    })
    dataSubs.set(id, () => { live = true; for (let args of q.splice(0)) send({ event: 'data', inst: id, args }) })
    return id
  }

  import('./audio.js').then(({ default: audio }) => {
    const { voice, emitMeter } = audio[Symbol.for('audio.play')]
    const streams = new Map()     // sid → { inst, iterator }
    const voices = new Map()      // id → the voice playing it into a page's deck
    const probes = new Map()      // `${id}:${probe}` → meter probe
    let nextStream = 1
    const ops = () => Object.entries(audio.op()).filter(([, d]) => !d.hidden).map(([n]) => n)

    // Methods whose fresh result buffers are safe to transfer (never views of live state)
    const TRANSFER = new Set(['read', 'encode'])

    /** Decode wire args: {__ref: id} → live instance; recurse into plain containers. */
    function decodeArgs(v) {
      if (!v || typeof v !== 'object') return v
      if (v.__ref) {
        let a = instances.get(v.__ref)
        if (!a) throw new Error(`audio/worker: unknown instance ref ${v.__ref}`)
        return a
      }
      if (Array.isArray(v)) return v.map(decodeArgs)
      if (ArrayBuffer.isView(v) || v instanceof ArrayBuffer || isPort(v)) return v
      if (typeof Blob !== 'undefined' && v instanceof Blob) return v  // File/Blob arrive cloned — pass through untouched
      let o = {}
      for (let k of Object.keys(v)) o[k] = decodeArgs(v[k])
      return o
    }

    /** Encode a call result: instances → refs, collect transferables for allowed methods. */
    function encodeResult(r, a, method, transfer, send) {
      if (r === a) return { __self: true }
      if (r?.pages) { let id = register(r); owners.set(id, send); return { __inst: id, snapshot: snap(r) } }
      if (Array.isArray(r) && r[0]?.pages) return r.map(x => encodeResult(x, a, method, transfer, send))
      if (TRANSFER.has(method)) {
        if (ArrayBuffer.isView(r)) transfer.push(r.buffer)
        else if (Array.isArray(r)) for (let ch of r) if (ArrayBuffer.isView(ch)) transfer.push(ch.buffer)
      }
      return r
    }

    // Playback: a voice renders the instance into the deck's port, straight to the audio thread; meters are
    // measured here as it renders and released on the page when heard
    const playback = {
      _play(a, id, [o], send) {
        voices.get(id)?.stop()
        voices.set(id, voice(a, o.port, {
          ...o,
          meter(b, run, pos, time, sr) {
            if (!a._.meters?.length) return
            let vals = []
            emitMeter(a, b, time, (p, v) => { if (p.id != null) vals.push([p.id, v]) })
            if (vals.length) send({ event: '_meter', inst: id, args: [run, pos + b[0].length / 2 / sr, vals] })
          },
          error: e => send({ event: '_playerror', inst: id, args: [errObj(e)] }),
        }))
      },
      _seek(a, id, [t]) { a.seek(t); return voices.get(id)?.seek(t) },
      _span(a, id, [at, duration]) { voices.get(id)?.span(at, duration) },
      _loop(a, id, [v]) { voices.get(id)?.loop(v) },
      _stop(a, id) { voices.get(id)?.stop(); voices.delete(id) },
      _meter(a, id, [pid, opts]) {
        let key = id + ':' + pid
        probes.get(key)?.stop()
        probes.delete(key)
        if (opts) { let p = a.meter(opts); p.id = pid; probes.set(key, p) }
      },
    }

    handle = async (msg, send) => {
      let { id, inst, type } = msg
      try {
        if (type === 'open' || type === 'adopt') {
          let n = inst
          if (type === 'open') n = register(audio(decodeArgs(msg.source), msg.opts || {}))
          else if (!instances.has(n)) throw new Error(`audio/worker: nothing exposed as ${n}`)
          owners.set(n, send)
          send({ id, result: { inst: n, ops: ops(), snapshot: snap(instances.get(n)) } })
          return
        }
        if (type === 'close') {
          for (let v of voices.values()) v.stop()
          for (let a of instances.values()) { try { a.dispose() } catch {} }
          instances.clear()
          dataSubs.clear()
          send({ id, result: true })
          // Let the environment reap the worker after the reply flushes
          setTimeout(() => (globalThis.close?.(), globalThis.process?.exit(0)), 0)
          return
        }

        let a = instances.get(inst)
        if (!a) throw new Error(`audio/worker: unknown instance ${inst}`)

        if (type === 'call') {
          let { method, args } = msg
          let transfer = []
          let result
          if (method === '_streamOpen') {
            let sid = nextStream++
            streams.set(sid, { inst, iterator: a.stream(...decodeArgs(args))[Symbol.asyncIterator]() })
            result = sid
          } else if (method === '_streamNext') {
            let it = streams.get(args[0])?.iterator
            if (!it) { send({ id, result: null }); return }
            let { value, done } = await it.next()
            if (done) { streams.delete(args[0]); result = null }
            else {
              result = value.map(ch => ch.slice())  // chunks are views of the live block buffer
              for (let ch of result) transfer.push(ch.buffer)
            }
          } else if (method === '_streamEnd') {
            streams.get(args[0])?.iterator.return?.().catch(() => {})
            streams.delete(args[0])
            result = true
          } else if (playback[method]) {
            result = playback[method](a, inst, decodeArgs(args), send) ?? null
          } else {
            if (typeof a[method] !== 'function') throw new TypeError(`audio/worker: no method '${method}'`)
            result = a[method](...decodeArgs(args))
            if (result?.then) result = await result
            // JSON path serializes nested instance sources properly; clone would choke on them
            if (method === 'toJSON') result = JSON.parse(JSON.stringify(result))
            // popped edits may hold live instances in opts (insert/mix source) — sanitize like snapshots
            else if (method === 'undo' && result != null)
              result = Array.isArray(result[0]) ? safeEdits(result) : safeEdits([result])[0]
            else result = encodeResult(result, a, method, transfer, send)
          }
          send({ id, result, snapshot: snap(a) }, transfer)
          return
        }
        if (type === 'sub') {
          // 'data' is pre-attached at register — flush the buffer and go live instead of double-subscribing.
          if (msg.event === 'data') dataSubs.get(inst)?.()
          else a.on(msg.event, (...args) => { try { owners.get(inst)?.({ event: msg.event, inst, args }) } catch {} })
          send({ id, result: true })
          return
        }
        if (type === 'dispose') {
          voices.get(inst)?.stop()
          voices.delete(inst)
          try { a.dispose() } catch {}
          for (const [sid, stream] of streams) if (stream.inst === inst) {
            stream.iterator.return?.().catch(() => {})
            streams.delete(sid)
          }
          instances.delete(inst)
          owners.delete(inst)
          dataSubs.delete(inst)
          send({ id, result: true })
          return
        }
        throw new Error(`audio/worker: unknown message type '${type}'`)
      } catch (e) {
        send({ id, error: errObj(e) })
      }
    }
    for (let [m, r] of pending.splice(0)) handle(m, r)
  })

  return { expose: register }
}
