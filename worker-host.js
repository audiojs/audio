/**
 * Worker-side engine host — the full audio library running inside a Worker,
 * speaking the audio/worker protocol (open/call/sub/stream) over postMessage.
 *
 * Default entry for `audio/worker`'s facade. For a custom worker (extra codecs,
 * plugins), make your own entry — imports register before any message arrives:
 *
 *   import '@audio/aac-decode'     // extra codecs, custom ops…
 *   import 'audio/worker-host'     // wires the message loop
 *
 * Isomorphic: browser Worker (self) or node worker_threads (parentPort).
 */

import audio from './audio.js'

const port = typeof self !== 'undefined' && typeof self.postMessage === 'function'
  ? self
  : (await import('node:worker_threads')).parentPort
const send = (msg, transfer) => port.postMessage(msg, transfer || [])
const listen = cb => port.on ? port.on('message', cb) : port.addEventListener('message', e => cb(e.data))

const instances = new Map()   // id → audio instance
const streams = new Map()     // sid → async iterator
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

function register(a) {
  let id = nextInst++
  instances.set(id, a)
  let state = () => { try { send({ event: '_state', inst: id, snapshot: snap(a) }) } catch {} }
  a.on('change', state)
  a.on('metadata', state)
  a.on('error', e => send({ event: 'error', inst: id, args: [errObj(e)] }))
  a.ready?.then(state, () => {})  // decoded=true snapshot; rejection already emitted as 'error'
  return id
}

const errObj = e => ({ message: e?.message ?? String(e), stack: e?.stack })

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

listen(async msg => {
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
        result = method === 'toJSON' ? JSON.parse(JSON.stringify(result)) : encodeResult(result, a, method, transfer)
      }
      send({ id, result, snapshot: snap(a) }, transfer)
      return
    }
    if (type === 'sub') {
      a.on(msg.event, (...args) => { try { send({ event: msg.event, inst, args }) } catch {} })
      send({ id, result: true })
      return
    }
    if (type === 'dispose') {
      try { a.dispose() } catch {}
      instances.delete(inst)
      send({ id, result: true })
      return
    }
    throw new Error(`audio/worker: unknown message type '${type}'`)
  } catch (e) {
    send({ id, error: errObj(e) })
  }
})
