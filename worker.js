/**
 * audio/worker — main-thread facade over an audio engine running in a Worker.
 * The whole library (decode, pages, plan, stats, cache) lives worker-side;
 * this file imports none of it, so the main bundle stays a few KB.
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
 * Custom worker (extra codecs, plugins): make an entry that imports them plus
 * 'audio/worker-host', and pass it via opts:
 *   audioWorker('a.m4a', { worker: new Worker(new URL('./my-worker.js', import.meta.url), { type: 'module' }) })
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

const HOST_URL = new URL('./worker-host.js', import.meta.url)

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
const sharedChannel = () => shared ??= channel(spawn(HOST_URL))

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
  let sink = null, pumpGen = 0, wake = null

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
      for await (let chunk of target.stream({ at })) {
        if (gen !== pumpGen || !target.playing) break
        while (target.paused && gen === pumpGen && target.playing) await new Promise(r => wake = r)
        if (gen !== pumpGen || !target.playing) break
        await sink.write(chunk, target.volume)
        if (!started) { started = true; onStart() }
      }
      if (gen === pumpGen && target.playing && !target.paused) {
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
    await actx.audioWorklet.addModule(new URL('./worker-worklet.js', import.meta.url))
    let node = new AudioWorkletNode(actx, 'audio-worker-sink', { outputChannelCount: [Math.max(1, t.channels)] })
    node.connect(actx.destination)
    let sent = 0, consumed = 0, base = 0, baseConsumed = 0, onDrain = null, lastVol = 1
    const AHEAD = 8192  // ~185ms of buffered audio ahead of the playhead
    node.port.onmessage = e => {
      consumed = e.data.consumed
      if (live()) {
        t.currentTime = base + (consumed - baseConsumed) / t.sampleRate
        t._emit('timeupdate', t.currentTime)
      }
      onDrain?.()
    }
    return {
      reset(at) { node.port.postMessage({ type: 'flush' }); base = at; baseConsumed = consumed; sent = consumed },
      playState(on) { node.port.postMessage({ type: on ? 'play' : 'pause' }) },
      async write(chunk, volume) {
        if (volume !== lastVol) { lastVol = volume; node.port.postMessage({ volume }) }
        node.port.postMessage({ chunk }, chunk.map(c => c.buffer))
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
    let write = null, base = 0, played = 0
    return {
      reset(at) { write?.(null); write = Speaker({ sampleRate: t.sampleRate, channels: ch, bitDepth: 32 }); base = at; played = 0 },
      playState() {},
      write(chunk, volume) {
        let len = chunk[0].length, buf = new Float32Array(len * ch)
        for (let i = 0; i < len; i++) for (let c = 0; c < ch; c++)
          buf[i * ch + c] = (chunk[c] || chunk[0])[i] * volume
        return new Promise(r => write(new Uint8Array(buf.buffer), () => {
          played += len
          t.currentTime = base + played / t.sampleRate
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
  let chan = worker ? workerChannel(worker) : sharedChannel()
  if (Array.isArray(source) && source.some(s => s?.__isAudioWorker))
    throw new TypeError('audio/worker: open plain sources, then combine with insert()/mix()/crossfade()')
  return facade(chan, chan.send({ type: 'open', source, opts: rest }))
}
