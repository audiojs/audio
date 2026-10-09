/**
 * Page cache — LRU eviction to OPFS and lazy restore.
 * Self-registers on import — exposes opfsCache/evict/ensurePages on audio.
 */

import audio, { touchLru } from './core.js'

const DEFAULT_BUDGET = 500 * 1024 * 1024  // 500MB

/** Evict pages to cache until resident bytes fit within budget. True LRU, with a FIFO fallback
 *  for pages that were never read through walkPages (so `a._.lru` cannot see them) — otherwise
 *  those pages would be permanently unevictable the moment any other page becomes LRU-tracked. */
async function evict(a) {
  if (a._.disposed || !a.cache || a.budget === Infinity) return
  let bytes = p => p ? p.reduce((s, ch) => s + ch.byteLength, 0) : 0
  let current = a.pages.reduce((sum, p) => sum + bytes(p), 0)
  if (current <= a.budget) return
  let lru = a._.lru
  // Coldest first: untracked resident pages (never accessed, FIFO) before LRU-tracked pages (oldest→newest)
  let untracked = a.pages.reduce((acc, p, i) => { if (p && !lru?.has(i)) acc.push(i); return acc }, [])
  let order = [...untracked, ...(lru ? [...lru] : [])]
  for (let i of order) {
    if (current <= a.budget) break
    if (!a.pages[i]) continue
    await a.cache.write(i, a.pages[i])
    if (a._.disposed) return
    current -= bytes(a.pages[i])
    a.pages[i] = null
    lru?.delete(i)
  }
}

/** Restore evicted pages covering a sample range from cache. */
async function ensurePages(a, offset, duration) {
  if (a._.disposed || !a.cache) return
  let PS = audio.PAGE_SIZE, sr = a.sampleRate
  let s = offset != null ? Math.max(0, Math.round(offset * sr)) : 0
  let len = duration != null ? Math.round(duration * sr) : a._.len - s
  let p0 = Math.floor(s / PS), pEnd = Math.min(Math.ceil((s + len) / PS), a.pages.length)
  for (let i = p0; i < pEnd; i++) {
    if (a._.disposed) return
    if (a.pages[i] === null && await a.cache.has(i)) {
      if (a._.disposed) return
      const data = await a.cache.read(i)
      if (a._.disposed) return
      a.pages[i] = data
      touchLru(a, i)
    }
  }
}

/** Derive a page budget from the platform quota (Chrome: ~60% of disk — tracks device
 *  class). Quarter of quota, bounded to sane resident-RAM limits: floor keeps paging
 *  useful under tiny quotas, cap keeps residency near DEFAULT_BUDGET — instances
 *  share RAM (multiple tabs/tests), so a quota-scaled 2GB cap ballooned real usage.
 *  Null when estimate() is unavailable (Node, older browsers) — caller falls back. */
async function detectBudget() {
  try {
    let { quota } = await navigator.storage.estimate()
    if (!quota) return null
    return Math.max(64 * 1024 * 1024, Math.min(512 * 1024 * 1024, Math.floor(quota / 4)))
  } catch { return null }
}

/** An OPFS-backed page store, its own folder under `dirName`: instances made apart never share pages; copies of one
 *  (clone, audio.from(a)) share its store, as they share its pages. The folder holds a Web Lock while its store is in
 *  use, and goes once nothing references the store (FinalizationRegistry), or else with the next store made after the
 *  page, tab or worker that held it has gone. Browser only. */
async function opfsCache(dirName = 'audio-cache') {
  if (typeof navigator === 'undefined' || !navigator.storage?.getDirectory)
    throw new Error('OPFS not available in this environment')
  let root = await navigator.storage.getDirectory()
  let base = await root.getDirectoryHandle(dirName, { create: true })
  let id = crypto.randomUUID(), release = await hold(`${dirName}/${id}`)
  // the folders of stores gone go in the background: a new store never waits on them
  sweep(base, dirName).catch(() => {})
  let dir = await base.getDirectoryHandle(id, { create: true })

  // OPFS opens a file to one access handle or writable at a time, refusing a second (NoModificationAllowedError): a
  // page's reads and writes take turns, whoever asks for them (an eviction, a read restoring the page, a seek's prefetch)
  let turns = new Map()
  let turn = (i, fn) => {
    let p = (turns.get(i) ?? Promise.resolve()).catch(() => {}).then(fn)
    turns.set(i, p)
    p.catch(() => {}).finally(() => { if (turns.get(i) === p) turns.delete(i) })
    return p
  }

  let cache = {
    read: i => turn(i, async () => {
      let handle = await dir.getFileHandle(`p${i}`), view
      if (handle.createSyncAccessHandle) {
        let h = await handle.createSyncAccessHandle()
        try { view = new Float32Array(h.getSize() / 4); h.read(view, { at: 0 }) } finally { h.close() }
      }
      else view = new Float32Array(await (await handle.getFile()).arrayBuffer())
      let ch = view[0] | 0, samplesPerCh = ((view.length - 1) / ch) | 0
      let data = []
      for (let c = 0; c < ch; c++) data.push(view.slice(1 + c * samplesPerCh, 1 + (c + 1) * samplesPerCh))
      return data
    }),
    write: (i, data) => turn(i, async () => {
      let handle = await dir.getFileHandle(`p${i}`, { create: true })
      let total = 1 + data.reduce((s, ch) => s + ch.length, 0)
      let packed = new Float32Array(total)
      packed[0] = data.length
      let off = 1
      for (let ch of data) { packed.set(ch, off); off += ch.length }
      // in a worker, synchronously in place: several times faster than a writable stream, which copies to a swap file
      if (handle.createSyncAccessHandle) {
        let h = await handle.createSyncAccessHandle()
        try { h.truncate(0); h.write(packed, { at: 0 }) } finally { h.close() }
        return
      }
      let writable = await handle.createWritable()
      await writable.write(packed.buffer)
      await writable.close()
    }),
    has(i) {
      return dir.getFileHandle(`p${i}`).then(() => true, () => false)
    },
    async evict(i) {
      try { await dir.removeEntry(`p${i}`) } catch {}
    },
    async clear() {
      for await (let [name] of dir) await dir.removeEntry(name)
    }
  }
  gone?.register(cache, () => base.removeEntry(id, { recursive: true }).catch(() => {}).finally(release))
  return cache
}

// A store's folder held while it is in use: a Web Lock by its name, let go by the function returned; none where the
// platform has no locks
function hold(name) {
  let locks = navigator.locks
  if (!locks) return () => {}
  return new Promise(taken => locks.request(name, () => new Promise(release => taken(release))))
}
// The folders (and pages of an older layout, loose in the base) no lock holds: their stores have gone
async function sweep(base, dirName) {
  let locks = navigator.locks
  if (!locks) return
  let held = new Set((await locks.query()).held.map(l => l.name))
  for await (let [name] of base) if (!held.has(`${dirName}/${name}`)) await base.removeEntry(name, { recursive: true }).catch(() => {})
}
// Run once a store is let go of by everything: its folder goes
const gone = typeof FinalizationRegistry !== 'undefined' ? new FinalizationRegistry(done => done()) : null


// ── Self-register ────────────────────────────────────────────────


audio.opfsCache = opfsCache
audio.evict = evict
audio.ensurePages = ensurePages
audio.detectBudget = detectBudget
audio.DEFAULT_BUDGET = DEFAULT_BUDGET
