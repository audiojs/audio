/**
 * audio/worker — the whole engine in a Worker, one file, two faces:
 *
 * On the MAIN thread it exports the facade — imports none of the engine, stays a
 * few KB. Inside a WORKER it self-hosts: loads the engine via dynamic import and
 * speaks the protocol (open/call/sub/stream) over postMessage. The default spawn
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
 * Custom worker (extra codecs, plugins): an entry that imports them, then this file:
 *   import '@audio/decode-aac'
 *   import 'audio/worker'      // self-hosts; codecs registered first
 * and pass it: audioWorker('a.m4a', { worker: new Worker(new URL('./my-worker.js', import.meta.url), { type: 'module' }) })
 *
 * Boundary deviations from the local API (all async by nature):
 *  - clip()/split()/clone() return Promise<facade>
 *  - op errors surface on the 'error' event and reject the next awaited call;
 *    use `await a.run([type, opts])` for strict per-op errors
 *  - function-valued params don't cross — use breakpoint curves {t, v} (serializable
 *    automation, sampled by the engine like functions)
 *  - play() pumps worker-rendered blocks into an AudioWorklet over its message port
 *    (browser — no SharedArrayBuffer/COOP-COEP needed) or @audio/speaker (node)
 */

import varispeed from './fn/varispeed.js'  // shared live-rate stage (no engine deps)

// ── Self-host: imported inside a Worker, this module becomes the engine host ──
const nodeWT = typeof process !== 'undefined' && process.versions?.node
  ? await import('node:worker_threads').catch(() => null) : null
if ((typeof WorkerGlobalScope !== 'undefined' && self instanceof WorkerGlobalScope) || (nodeWT && !nodeWT.isMainThread)) host(nodeWT?.parentPort)

// ── Channel: one worker, many instances ─────────────────────────────────

function channel(workerOrPromise) {
  let pending = new Map(), routes = new Map(), nextId = 1, queue = []
  let worker = null

  Promise.resolve(workerOrPromise).then(w => {
    worker = w
    let recv = msg => {
      if (msg.id != null) {
        let p = pending.get(msg.id)
        if (!p) return
        pending.delete(msg.id)
        if (msg.snapshot) p.facade?._snap(msg.snapshot)
        msg.error ? p.reject(remoteErr(msg.error)) : p.resolve(msg.result)
      } else if (msg.event) {
        routes.get(msg.inst)?.(msg)
      }
    }
    w.addEventListener ? w.addEventListener('message', e => recv(e.data)) : w.on('message', recv)
    for (let [m, t] of queue.splice(0)) w.postMessage(m, t)
  })

  return {
    route: (inst, cb) => routes.set(inst, cb),
    unroute: inst => routes.delete(inst),
    send(msg, transfer, facade) {
      return new Promise((resolve, reject) => {
        msg.id = nextId++
        pending.set(msg.id, { resolve, reject, facade })
        worker ? worker.postMessage(msg, transfer || []) : queue.push([msg, transfer])
      })
    },
    close() { return this.send({ type: 'close' }).finally(() => worker?.terminate?.()) },
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
const ASYNC = ['read', 'stat', 'encode', 'save', 'undo', 'seek', 'stop', 'push', 'detect', 'toJSON']
const WRAPPED = ['clip', 'clone', 'split']  // return new instance(s) → sub-facades

/** Deep-encode outgoing values: sibling facades → {__ref}, functions rejected
 *  (can't cross the boundary — P3 breakpoint curves), containers copied. */
function encodeArg(v, chan) {
  if (typeof v === 'function') throw new TypeError('audio/worker: function params cannot cross the worker boundary — use a breakpoint curve { t: [...], v: [...] }')
  if (!v || typeof v !== 'object') return v
  if (v.__isAudioWorker) {
    if (v._chan !== chan) throw new TypeError('audio/worker: facades must share a worker to reference each other')
    return { __ref: v._inst }
  }
  if (ArrayBuffer.isView(v) || v instanceof ArrayBuffer) return v
  if (typeof Blob !== 'undefined' && v instanceof Blob) return v  // File/Blob clone natively — deep copy would strip prototype props
  if (Array.isArray(v)) return v.map(x => encodeArg(x, chan))
  let o = {}
  for (let k of Object.keys(v)) o[k] = encodeArg(v[k], chan)
  return o
}
const encodeArgs = (args, chan) => args.map(v => encodeArg(v, chan))

function facade(chan, opened) {
  let ev = {}, opErr = null
  let target = {
    __isAudioWorker: true,
    _chan: chan,
    _inst: null,
    _ready: null,
    sampleRate: 0, channels: 0, length: 0, duration: 0, version: 0,
    decoded: false, edits: [],

    _snap(s) { Object.assign(target, s) },
    _emit(name, ...args) { for (let cb of (ev[name] || []).slice()) cb(...args) },

    _call(method, args = [], transfer) {
      if (opErr) { let e = opErr; opErr = null; return Promise.reject(e) }
      let wire = encodeArgs(args, chan)  // validate before queuing — throw at the call site
      return target._ready.then(() =>
        chan.send({ type: 'call', inst: target._inst, method, args: wire }, transfer, proxy)
      ).then(r => decodeResult(r))
    },

    on(name, cb) {
      ;(ev[name] ??= []).push(cb)
      // lifecycle + transport events are emitted facade-side; anything else needs a worker-side sub
      if (!['change', 'error', 'play', 'pause', 'ended', 'timeupdate'].includes(name) && !ev[name]._sub) {
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

    // ── Transport — playback pumps worker-rendered blocks into a sink:
    // AudioWorklet over a message port (browser, no SAB/COOP-COEP needed)
    // or @audio/speaker (node). The worker only renders; the sink only plays.
    playing: false, paused: false, ended: false, currentTime: 0, volume: 1, loop: false,

    // Live playback speed — parity with the local engine: the pump runs a varispeed
    // stage, so setting this mid-playback ramps smoothly (~50ms, tape-style).
    get playbackRate() { return rate },
    set playbackRate(v) {
      v = Math.max(0.0625, Math.min(16, +v || 1))
      if (rate !== v) { rate = v; target._emit('ratechange') }
    },

    play(opts = {}) {
      if (target.playing && target.paused) {
        target.paused = false
        wake?.()
        sink?.playState(true)
        target._emit('play')
        return Promise.resolve()
      }
      if (target.playing) return Promise.resolve()
      if (opts.loop != null) target.loop = opts.loop
      if (opts.rate != null) target.playbackRate = opts.rate
      return new Promise((res, rej) => runPump(opts.at ?? target.currentTime ?? 0, res, rej))
    },
    pause() {
      if (!target.playing || target.paused) return proxy
      target.paused = true
      sink?.playState(false)
      target._emit('pause')
      return proxy
    },
    seek(t) {
      target.currentTime = Math.max(0, t)
      if (target.playing) {
        let resume = !target.paused
        killPump()
        if (resume) runPump(target.currentTime, () => {}, e => target._emit('error', e))
        else target.playing = false
      }
      return target._call('seek', [t])
    },
    stop() {
      killPump()
      target.playing = false; target.paused = false
      return target._call('stop', [])
    },

    dispose() {
      killPump()
      target.playing = false
      return target._ready.then(() => {
        let done = chan.send({ type: 'dispose', inst: target._inst }).catch(() => {})
        chan.unroute(target._inst)
        return done
      })
    },
  }

  for (let m of ASYNC) target[m] ??= (...args) => target._call(m, args)
  for (let m of WRAPPED) target[m] = (...args) => target._call(m, args)

  // ── Playback pump ────────────────────────────────────────────────────
  let sink = null, pumpGen = 0, wake = null, rate = 1

  let killPump = () => { pumpGen++; wake?.(); sink?.flush() }

  async function runPump(at, onStart, onErr) {
    let gen = ++pumpGen
    target.playing = true; target.paused = false; target.ended = false
    let sr = target.sampleRate, started = false
    try {
      sink ??= typeof AudioContext !== 'undefined'
        ? await workletSink(target, () => gen === pumpGen)
        : await speakerSink(target)
      sink.reset(at)
      sink.playState(true)
      target._emit('play')
      // Varispeed between the worker stream and the sink; each written block carries
      // its source end-position so sinks map output consumption → source time.
      let vs = varispeed(Math.max(1, target.channels), sr, () => rate)
      let put = async block => {
        await sink.write(block, target.volume, at + vs.pos / sr)
        if (!started) { started = true; onStart() }
      }
      streaming:
      for await (let chunk of target.stream({ at })) {
        if (gen !== pumpGen || !target.playing) break
        while (target.paused && gen === pumpGen && target.playing) await new Promise(r => wake = r)
        if (gen !== pumpGen || !target.playing) break
        vs.push(chunk)
        let block
        while (block = vs.pull(false)) {
          await put(block)
          if (gen !== pumpGen || !target.playing) break streaming
        }
      }
      if (gen === pumpGen && target.playing && !target.paused) {
        let block
        while ((block = vs.pull(true)) && gen === pumpGen && target.playing) await put(block)
        await sink.drain()
        if (gen === pumpGen && target.playing) {
          if (target.loop) { runPump(0, () => {}, onErr); return }
          target.playing = false; target.ended = true
          target._emit('timeupdate', target.currentTime)
          target._emit('ended')
        }
      }
    } catch (e) {
      if (gen === pumpGen) { target.playing = false; target._emit('error', e); if (!started) onErr(e) }
    } finally {
      if (!started) onStart()
    }
  }

  // Browser sink: persistent AudioWorkletNode fed over its port; consumption
  // reports drive backpressure and currentTime
  async function workletSink(t, live) {
    let actx = new AudioContext({ sampleRate: t.sampleRate })
    await actx.audioWorklet.addModule(workletURL())
    let node = new AudioWorkletNode(actx, 'audio-worker-sink', { outputChannelCount: [Math.max(1, t.channels)] })
    node.connect(actx.destination)
    let sent = 0, consumed = 0, onDrain = null, lastVol = 1
    // Output-frame → source-time map: one span per written block (varispeed makes
    // the mapping non-uniform, so consumption reports interpolate within their span)
    let segs = [], lastSrc = 0
    const AHEAD = 8192  // ~185ms of buffered audio ahead of the playhead
    node.port.onmessage = e => {
      consumed = e.data.consumed
      if (live()) {
        while (segs.length > 1 && segs[0].s1 <= consumed) segs.shift()
        let g = segs[0]
        if (g) t.currentTime = consumed >= g.s1 ? g.t1 : g.t0 + (consumed - g.s0) / (g.s1 - g.s0) * (g.t1 - g.t0)
        t._emit('timeupdate', t.currentTime)
      }
      onDrain?.()
    }
    return {
      reset(at) { node.port.postMessage({ type: 'flush' }); sent = consumed; segs = []; lastSrc = at },
      playState(on) { node.port.postMessage({ type: on ? 'play' : 'pause' }) },
      async write(chunk, volume, srcEnd = lastSrc + chunk[0].length / t.sampleRate) {
        if (volume !== lastVol) { lastVol = volume; node.port.postMessage({ volume }) }
        node.port.postMessage({ chunk }, chunk.map(c => c.buffer))
        segs.push({ s0: sent, s1: sent + chunk[0].length, t0: lastSrc, t1: srcEnd })
        lastSrc = srcEnd
        sent += chunk[0].length
        while (sent - consumed > AHEAD && live() && t.playing) {
          await new Promise(r => onDrain = r)
          onDrain = null
        }
      },
      async drain() { while (consumed < sent && live() && t.playing) { await new Promise(r => onDrain = r); onDrain = null } },
      flush() { node.port.postMessage({ type: 'flush' }) },
    }
  }

  // Node sink: @audio/speaker, inherently backpressured per write
  async function speakerSink(t) {
    let { default: Speaker } = await import('@audio/speaker')
    let ch = Math.max(1, t.channels)
    let write = null, lastSrc = 0
    return {
      reset(at) { write?.(null); write = Speaker({ sampleRate: t.sampleRate, channels: ch, bitDepth: 32 }); lastSrc = at },
      playState() {},
      write(chunk, volume, srcEnd = lastSrc + chunk[0].length / t.sampleRate) {
        let len = chunk[0].length, buf = new Float32Array(len * ch)
        for (let i = 0; i < len; i++) for (let c = 0; c < ch; c++)
          buf[i * ch + c] = (chunk[c] || chunk[0])[i] * volume
        lastSrc = srcEnd
        return new Promise(r => write(new Uint8Array(buf.buffer), () => {
          t.currentTime = srcEnd
          t._emit('timeupdate', t.currentTime)
          r()
        }))
      },
      async drain() {},
      flush() { write?.(null); write = null },
    }
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
  let adopt = r => {
    let f = facade(chan, Promise.resolve({ inst: r.__inst, snapshot: r.snapshot, ops: target._opNames }))
    return f
  }

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
  let waitDecoded = () => target.decoded ? Promise.resolve() : new Promise((res, rej) => {
    let check = () => { if (target.decoded) { done(); res() } }
    let onErr = e => { done(); rej(e) }
    let done = () => { let i = (ev.error || []).indexOf(onErr); if (i >= 0) ev.error.splice(i, 1); waiters.delete(check) }
    waiters.add(check)
    ;(ev.error ??= []).push(onErr)
  })

  // Resolve with a plain value — resolving with the (thenable) proxy would make
  // the promise adopt proxy.then, which waits on this very promise: deadlock.
  target._ready = opened.then(({ inst, snapshot, ops }) => {
    target._inst = inst
    target._opNames = ops
    target._snap(snapshot)
    chan.route(inst, msg => {
      if (msg.event === '_state') {
        target._snap(msg.snapshot)
        for (let w of [...waiters]) w()
        target._emit('change')
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

// P4 — `audio(src, { worker: true })` dispatches here once this module is imported.
// A global slot (not an engine import) keeps this facade out of the engine's graph
// and the engine out of this file — either can load without dragging in the other.
globalThis[Symbol.for('audio.worker')] = audioWorker

// ── Playback sink worklet — inlined so the whole worker bridge is one file.
// AudioWorkletProcessor fed rendered blocks over its port (no SharedArrayBuffer,
// works without COOP/COEP); posts throttled consumption reports for backpressure.

const WORKLET_SRC = `
class AudioWorkerSink extends AudioWorkletProcessor {
  constructor() {
    super()
    this.chunks = []
    this.offset = 0
    this.playing = false
    this.volume = 1
    this.consumed = 0
    this.reported = 0
    this.port.onmessage = e => {
      let m = e.data
      if (m.chunk) this.chunks.push(m.chunk)
      else if (m.type === 'play') this.playing = true
      else if (m.type === 'pause') this.playing = false
      else if (m.type === 'flush') { this.chunks = []; this.offset = 0 }
      if (m.volume != null) this.volume = m.volume
    }
  }
  process(inputs, outputs) {
    let out = outputs[0]
    if (!this.playing || !out[0]) return true
    let need = out[0].length, filled = 0
    while (filled < need && this.chunks.length) {
      let c = this.chunks[0]
      let n = Math.min(need - filled, c[0].length - this.offset)
      for (let ch = 0; ch < out.length; ch++) {
        let src = c[Math.min(ch, c.length - 1)]
        for (let i = 0; i < n; i++) out[ch][filled + i] = src[this.offset + i] * this.volume
      }
      this.offset += n
      filled += n
      if (this.offset >= c[0].length) { this.chunks.shift(); this.offset = 0 }
    }
    this.consumed += filled
    if (this.consumed - this.reported >= 2048 || (filled < need && this.consumed > this.reported)) {
      this.reported = this.consumed
      this.port.postMessage({ consumed: this.consumed })
    }
    return true
  }
}
registerProcessor('audio-worker-sink', AudioWorkerSink)
`
let _workletURL = null
const workletURL = () => _workletURL ??= URL.createObjectURL(new Blob([WORKLET_SRC], { type: 'text/javascript' }))

// ── Engine host — runs when this module is imported inside a Worker ──────
// Listener attaches synchronously (messages buffer while the engine loads via
// dynamic import, so nothing posted during startup is lost); the engine chunk
// never loads on the main thread.
function host(nodePort) {
  const port = nodePort || self
  const send = (msg, transfer) => port.postMessage(msg, transfer || [])
  const pending = []
  let handle = msg => pending.push(msg)
  port.on ? port.on('message', m => handle(m)) : port.addEventListener('message', e => handle(e.data))

  import('./audio.js').then(({ default: audio }) => {
    const instances = new Map()   // id → audio instance
    const streams = new Map()     // sid → async iterator
    const dataSubs = new Map()    // id → flush fn (replays 'data' buffered before the sub landed)
    let nextInst = 1, nextStream = 1

    // Methods whose fresh result buffers are safe to transfer (never views of live state)
    const TRANSFER = new Set(['read', 'encode'])

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
      let id = nextInst++
      instances.set(id, a)
      let state = () => { try { send({ event: '_state', inst: id, snapshot: snap(a) }) } catch {} }
      a.on('change', state)
      a.on('metadata', state)
      a.on('error', e => send({ event: 'error', inst: id, args: [errObj(e)] }))
      a.ready?.then(state, () => {})  // decoded=true snapshot; rejection already emitted as 'error'
      // 'data' streams during decode, which starts at open — before the facade's 'sub' round-trip
      // lands. Attach the forwarder now and buffer until the sub arrives, else early deltas drop.
      let q = [], live = false
      a.on('data', (...args) => {
        if (live) { try { send({ event: 'data', inst: id, args }) } catch {} }
        else q.push(args)
      })
      dataSubs.set(id, () => { live = true; for (let args of q.splice(0)) { try { send({ event: 'data', inst: id, args }) } catch {} } })
      return id
    }

    /** Decode wire args: {__ref: id} → live instance; recurse into plain containers. */
    function decodeArgs(v) {
      if (!v || typeof v !== 'object') return v
      if (v.__ref) {
        let a = instances.get(v.__ref)
        if (!a) throw new Error(`audio/worker: unknown instance ref ${v.__ref}`)
        return a
      }
      if (Array.isArray(v)) return v.map(decodeArgs)
      if (ArrayBuffer.isView(v) || v instanceof ArrayBuffer) return v
      if (typeof Blob !== 'undefined' && v instanceof Blob) return v  // File/Blob arrive cloned — pass through untouched
      let o = {}
      for (let k of Object.keys(v)) o[k] = decodeArgs(v[k])
      return o
    }

    /** Encode a call result: instances → refs, collect transferables for allowed methods. */
    function encodeResult(r, a, method, transfer) {
      if (r === a) return { __self: true }
      if (r?.pages) return { __inst: register(r), snapshot: snap(r) }
      if (Array.isArray(r) && r[0]?.pages) return r.map(x => encodeResult(x, a, method, transfer))
      if (TRANSFER.has(method)) {
        if (ArrayBuffer.isView(r)) transfer.push(r.buffer)
        else if (Array.isArray(r)) for (let ch of r) if (ArrayBuffer.isView(ch)) transfer.push(ch.buffer)
      }
      return r
    }

    handle = async msg => {
      let { id, inst, type } = msg
      try {
        if (type === 'open') {
          let a = audio(decodeArgs(msg.source), msg.opts || {})
          let ops = Object.entries(audio.op()).filter(([, d]) => !d.hidden).map(([n]) => n)
          send({ id, result: { inst: register(a), ops, snapshot: snap(a) } })
          return
        }
        if (type === 'close') {
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
            streams.set(sid, a.stream(...decodeArgs(args))[Symbol.asyncIterator]())
            result = sid
          } else if (method === '_streamNext') {
            let it = streams.get(args[0])
            let { value, done } = await it.next()
            if (done) { streams.delete(args[0]); result = null }
            else {
              result = value.map(ch => ch.slice())  // chunks are views of the live block buffer
              for (let ch of result) transfer.push(ch.buffer)
            }
          } else if (method === '_streamEnd') {
            streams.get(args[0])?.return?.()
            streams.delete(args[0])
            result = true
          } else {
            if (typeof a[method] !== 'function') throw new TypeError(`audio/worker: no method '${method}'`)
            result = a[method](...decodeArgs(args))
            if (result?.then) result = await result
            // JSON path serializes nested instance sources properly; clone would choke on them
            if (method === 'toJSON') result = JSON.parse(JSON.stringify(result))
            // popped edits may hold live instances in opts (insert/mix source) — sanitize like snapshots
            else if (method === 'undo' && result != null)
              result = Array.isArray(result[0]) ? safeEdits(result) : safeEdits([result])[0]
            else result = encodeResult(result, a, method, transfer)
          }
          send({ id, result, snapshot: snap(a) }, transfer)
          return
        }
        if (type === 'sub') {
          // 'data' is pre-attached at register — flush the buffer and go live instead of double-subscribing.
          if (msg.event === 'data') dataSubs.get(inst)?.()
          else a.on(msg.event, (...args) => { try { send({ event: msg.event, inst, args }) } catch {} })
          send({ id, result: true })
          return
        }
        if (type === 'dispose') {
          try { a.dispose() } catch {}
          instances.delete(inst)
          dataSubs.delete(inst)
          send({ id, result: true })
          return
        }
        throw new Error(`audio/worker: unknown message type '${type}'`)
      } catch (e) {
        send({ id, error: errObj(e) })
      }
    }
    for (let m of pending.splice(0)) handle(m)
  })
}
