/**
 * Store — sounds kept by a key: in the browser's own file system (OPFS) where there is one, else in memory.
 * Self-registers on import — exposes audio.store.
 *
 *   let kept = audio.store('renders', { max: 2 ** 30 })
 *   await kept.set(key, sound, { label: 'take 2' })   // a sound (streamed in) or channels, and a meta of the host's
 *   await kept.get(key)                               // its channels, read whole; null where there are none
 *   await kept.open(key)                              // { sound, meta }: a sound over its pages, its stats with it
 *
 * Its get(key) and set(key, channels) are those audio.memo takes. Up to `max` bytes, the oldest let go first, never
 * one in use.
 */

import audio, { yieldTask } from './core.js'

/** A store of sounds by key: the browser's files under `name` where there are any, else (no name, Node) memory.
 *  `audio.store({ max })`: in memory */
function store(name, opts = {}) {
  if (name && typeof name === 'object') [name, opts] = [null, name]
  return name != null && typeof navigator !== 'undefined' && navigator.storage?.getDirectory ? opfs(name, opts) : memory(opts)
}

// ── In memory ───────────────────────────────────────────────────

/** Kept as given: the very sound and meta come back (a sound to edit is cloned first), the least lately used let go
 *  first once they hold more than `max` bytes, the one just kept never */
function memory({ max = Infinity } = {}) {
  let all = new Map()
  let touch = key => { let e = all.get(key); if (e) { all.delete(key); all.set(key, e) } return e }
  return {
    async has(key) { return all.has(key) },
    async get(key) { let e = touch(key); return !e ? null : e.value.pages ? e.value.read() : e.value },
    async open(key) {
      let e = touch(key)
      return !e ? null : { sound: e.value.pages ? e.value : audio.from(e.value, { sampleRate: e.meta?.sampleRate }), meta: e.meta }
    },
    async set(key, value, meta = null) {
      all.delete(key)
      all.set(key, { value, meta, size: bytes(value) })
      let total = 0
      for (let [k, e] of [...all].reverse()) if ((total += e.size) > max && k !== key) all.delete(k)
    },
    async delete(key) { all.delete(key) },
    async keys() { return [...all.keys()] }
  }
}
const bytes = v => v.pages ? v.length * v.channels * 4 : v.reduce((s, c) => s + c.byteLength, 0)

// ── In the browser's files ──────────────────────────────────────

/** Each key a file in the folder `name`: three uint32 (its head's length, its channels' count and length), its head as
 *  JSON ({ v, sampleRate }) to a multiple of 4 bytes, each channel's samples; then its tail's length, its tail as JSON
 *  (the block stats and the meta), to 4 bytes, the bytes of the typed arrays in it. Written whole or not at all
 *  (createWritable: aside, then swapped in). `max`: bytes, or a promise of them. The storage failing, nothing is kept,
 *  nothing found. */
function opfs(name, { max = Infinity } = {}) {
  let dir = navigator.storage.getDirectory().then(root => root.getDirectoryHandle(name, { create: true }))
  dir.catch(() => {})
  // the files there, listed once: a key not among them is not looked for (a run that has none starts at once)
  let names = dir.then(async d => { let all = new Set(); for await (let [f, h] of d) if (h.kind === 'file' && !f.endsWith('.crswap')) all.add(f); return all }).catch(() => new Set())
  let file = key => encodeURIComponent(key), lock = f => `${name}/${f.replace(/\.crswap$/, '')}`
  let has = async key => (await names).has(file(key))
  // a file read under its lock, shared: no writer swaps it meanwhile
  let reading = (key, fn) => locked(lock(file(key)), async () => fn(await (await (await dir).getFileHandle(file(key))).getFile()), { mode: 'shared' })

  // The oldest written let go first till what is kept is within `max`; one in use (read, written, a sound reading
  // from it) is let be. One pass at a time
  let evicting = Promise.resolve()
  let evict = () => evicting = evicting.then(async () => {
    let limit = await max
    if (!(limit < Infinity)) return
    let d = await dir, all = []
    for await (let [f, h] of d) if (h.kind === 'file') { let x = await h.getFile().catch(() => null); if (x) all.push({ f, size: x.size, at: x.lastModified }) }
    let total = all.reduce((s, x) => s + x.size, 0), kept = await names
    for (let x of all.sort((p, q) => p.at - q.at)) {
      if (total <= limit) break
      if (await locked(lock(x.f), held => held && d.removeEntry(x.f).then(() => true, () => false), { ifAvailable: true })) { total -= x.size; kept.delete(x.f) }
    }
  }).catch(() => {})

  return {
    has,
    async get(key) {
      if (!await has(key)) return null
      return reading(key, async f => {
        let h = await head(f)
        if (!h) return null
        let data = new Float32Array(await f.slice(h.at, h.end).arrayBuffer())
        return Array.from({ length: h.k }, (_, c) => data.subarray(c * h.n, (c + 1) * h.n))
      }).catch(() => null)
    },
    // The sound over the file's pages, none read till asked (`budget`: bytes of them held after), its stats; the file
    // held while the sound is (a shared lock, let go when the sound is collected): no one writes or removes it meanwhile
    async open(key, { budget } = {}) {
      if (!await has(key)) return null
      let release = await hold(lock(file(key)), 'shared')
      try {
        let f = await (await (await dir).getFileHandle(file(key))).getFile(), h = await head(f)
        if (!h) { release(); return null }
        let { stats = null, meta = null } = h.v === VERSION && f.size > h.end ? await tail(f, h.end) : {}
        let PS = audio.PAGE_SIZE, { k, n, at } = h
        let pages = {
          has: async i => i * PS < n,
          write: async () => {},
          read: i => Promise.all(Array.from({ length: k }, async (_, c) =>
            new Float32Array(await f.slice(at + (c * n + i * PS) * 4, at + (c * n + Math.min(n, (i + 1) * PS)) * 4).arrayBuffer())))
        }
        let sound = audio.from(pages, { length: n, channels: k, sampleRate: h.sampleRate ?? 44100, stats, budget })
        gone ? gone.register(sound, release) : release()
        return { sound, meta }
      } catch { release(); return null }
    },
    // A sound (read block by block, its stats counted as they pass, giving way to the rest of the thread as it goes) or
    // channels, and `meta`. A key in use (read, written, a sound reading from it) is let be: a key names what it holds
    async set(key, value, meta = null) {
      // the meta as it is now: what the host changes in it as the sound is written is not kept
      meta = pack(meta)
      let d = await dir, f = file(key), was = (await names).has(f)
      let wrote = await locked(lock(f), async held => {
        if (!held) return false
        let out = await (await d.getFileHandle(f, { create: true })).createWritable()
        try { await write(out, value, meta); await out.close() }
        catch (e) { await out.abort().catch(() => {}); if (!was) await d.removeEntry(f).catch(() => {}); throw e }
        return true
      }, { ifAvailable: true })
      if (!wrote) return
      ;(await names).add(f)
      await evict()
    },
    async delete(key) {
      let d = await dir, f = file(key)
      if (await locked(lock(f), held => held && d.removeEntry(f).then(() => true, () => false), { ifAvailable: true })) (await names).delete(f)
    },
    async keys() { return [...await names].map(decodeURIComponent) }
  }
}

const VERSION = 1
const pad = n => Math.ceil(n / 8) * 8
const text = v => new TextEncoder().encode(JSON.stringify(v))

/** A file's head: its channels' count and length, where its samples are, its rate; null for one cut short */
async function head(f) {
  let [m, k, n] = new Uint32Array(await f.slice(0, 12).arrayBuffer()), at = 12 + Math.ceil(m / 4) * 4, end = at + k * n * 4
  if (!k || f.size < end) return null
  return { ...m ? JSON.parse(await f.slice(12, 12 + m).text()) : {}, k, n, at, end }
}
async function tail(f, end) {
  let [l] = new Uint32Array(await f.slice(end, end + 4).arrayBuffer())
  return unpack(await f.slice(end + 4, end + 4 + l).text(), new Uint8Array(await f.slice(end + 4 + Math.ceil(l / 4) * 4).arrayBuffer()))
}

/** The file written into `out`: its head, its samples where each channel's go (a page of each at a time: few writes,
 *  each a long one), then its tail, the meta packed already */
async function write(out, value, meta) {
  let sound = value.pages ? value : null, k = sound ? sound.channels : value.length, n = sound ? sound.length : value[0]?.length ?? 0
  let h = text({ v: VERSION, ...sound && { sampleRate: sound.sampleRate } }), at = 12 + Math.ceil(h.length / 4) * 4
  let put = (data, position) => out.write({ type: 'write', position, data })
  await put(new Uint32Array([h.length, k, n]), 0)
  await put(h, 12)
  let stats = null
  if (!sound) for (let c = 0; c < k; c++) await put(value[c], at + c * n * 4)
  else {
    let session = audio.statSession(sound.sampleRate), PS = audio.PAGE_SIZE, buf = Array.from({ length: k }, () => new Float32Array(Math.max(1, Math.min(PS, n))))
    let pos = 0, from = 0, t = performance.now()
    let flush = async () => { for (let c = 0; c < k; c++) await put(buf[c].subarray(0, pos - from), at + (c * n + from) * 4); from = pos }
    for await (let block of sound.stream()) {
      let len = Math.min(block[0].length, n - pos), part = block.map(c => c.subarray(0, len))
      if (len <= 0) break
      session.page(part)
      for (let i = 0; i < len;) {
        let m = Math.min(len - i, buf[0].length - (pos - from))
        for (let c = 0; c < k; c++) buf[c].set(part[c].subarray(i, i + m), pos - from)
        pos += m; i += m
        if (pos - from === buf[0].length) await flush()
      }
      if (performance.now() - t > 20) { await yieldTask(); t = performance.now() }
    }
    if (pos > from) await flush()
    if (pos !== n) throw new Error(`store: ${pos} of ${n} samples`)
    stats = session.done()
  }
  let st = pack(stats, meta.data.length), json = new TextEncoder().encode(`{"meta":${meta.json},"stats":${st.json}}`), end = at + k * n * 4
  await put(new Uint32Array([json.length]), end)
  await put(json, end + 4)
  await put(meta.data, end + 4 + Math.ceil(json.length / 4) * 4)
  await put(st.data, end + 4 + Math.ceil(json.length / 4) * 4 + meta.data.length)
}

// A value as JSON and bytes, each typed array in it a reference to its bytes ({ $bytes: [type, length, offset] }, each
// to a multiple of 8 bytes, from `from` on); and back
const TYPED = { Float32Array, Float64Array, Int8Array, Uint8Array, Int16Array, Uint16Array, Int32Array, Uint32Array }
function pack(value, from = 0) {
  let parts = [], size = 0
  let json = JSON.stringify(value ?? null, (k, v) => {
    if (!ArrayBuffer.isView(v) || !TYPED[v.constructor.name]) return v
    let ref = { $bytes: [v.constructor.name, v.length, from + size] }
    parts.push([size, v]); size += pad(v.byteLength)
    return ref
  })
  let data = new Uint8Array(size)
  for (let [o, v] of parts) data.set(new Uint8Array(v.buffer, v.byteOffset, v.byteLength), o)
  return { json, data }
}
function unpack(json, data) {
  return JSON.parse(json, (k, v) => {
    if (!v?.$bytes) return v
    let [type, length, offset] = v.$bytes, T = TYPED[type]
    return new T(data.buffer.slice(data.byteOffset + offset, data.byteOffset + offset + length * T.BYTES_PER_ELEMENT))
  })
}

// ── Locks ───────────────────────────────────────────────────────

/** Every file the library keeps in the browser's file system is taken by a Web Lock named by its path: shared to read it
 *  or while a sound reads from it, exclusive to write or remove it (or to open it to a sync access handle, which the
 *  platform gives one at a time). `fn` runs holding it, given it, or null where `ifAvailable` and another holds it. Where
 *  the platform has no locks, one turn at a time in this thread. */
export function locked(name, fn, { mode = 'exclusive', ifAvailable = false } = {}) {
  let locks = typeof navigator !== 'undefined' && navigator.locks
  if (locks) return locks.request(name, { mode, ifAvailable }, fn)
  let busy = turns.has(name)
  if (ifAvailable && busy) return Promise.resolve().then(() => fn(null))
  let p = (turns.get(name) ?? Promise.resolve()).catch(() => {}).then(() => fn(true))
  turns.set(name, p)
  p.catch(() => {}).finally(() => { if (turns.get(name) === p) turns.delete(name) })
  return p
}
const turns = new Map()

/** A lock held till the function it resolves to is called: a folder or a file in use; none where the platform has no
 *  locks */
export function hold(name, mode = 'exclusive') {
  let locks = typeof navigator !== 'undefined' && navigator.locks
  if (!locks) return () => {}
  return new Promise(taken => locks.request(name, { mode }, () => new Promise(release => taken(release))))
}

// Run once what holds a lock is let go of by everything: the lock goes
export const gone = typeof FinalizationRegistry !== 'undefined' ? new FinalizationRegistry(done => done()) : null


// ── Self-register ────────────────────────────────────────────────

audio.store = store

export default store
