/**
 * Page cache — LRU eviction to OPFS and lazy restore.
 * Self-registers on import — overrides [LOAD], exposes opfsCache/evict/ensurePages on audio.
 */

import audio, { LOAD } from './core.js'

const DEFAULT_BUDGET = 500 * 1024 * 1024  // 500MB

/** Evict pages to cache until resident bytes fit within budget. True LRU. */
async function evict(a) {
  if (!a.cache || a.budget === Infinity) return
  let bytes = p => p ? p.reduce((s, ch) => s + ch.byteLength, 0) : 0
  let current = a.pages.reduce((sum, p) => sum + bytes(p), 0)
  if (current <= a.budget) return
  // Build eviction order: LRU (oldest first) if tracked, else FIFO fallback
  let order = a._.lru && a._.lru.size
    ? [...a._.lru]
    : a.pages.map((_, i) => i)
  for (let i of order) {
    if (current <= a.budget) break
    if (!a.pages[i]) continue
    await a.cache.write(i, a.pages[i])
    current -= bytes(a.pages[i])
    a.pages[i] = null
    if (a._.lru) a._.lru.delete(i)
  }
}

/** Restore evicted pages covering a sample range from cache. */
async function ensurePages(a, offset, duration) {
  if (!a.cache) return
  let PS = audio.PAGE_SIZE, sr = a.sampleRate
  let s = offset != null ? Math.max(0, Math.round(offset * sr)) : 0
  let len = duration != null ? Math.round(duration * sr) : a._.len - s
  let p0 = Math.floor(s / PS), pEnd = Math.min(Math.ceil((s + len) / PS), a.pages.length)
  for (let i = p0; i < pEnd; i++)
    if (a.pages[i] === null && await a.cache.has(i)) a.pages[i] = await a.cache.read(i)
}

/** Create an OPFS-backed cache backend. Browser only. */
async function opfsCache(dirName = 'audio-cache') {
  if (typeof navigator === 'undefined' || !navigator.storage?.getDirectory)
    throw new Error('OPFS not available in this environment')
  let root = await navigator.storage.getDirectory()
  let dir = await root.getDirectoryHandle(dirName, { create: true })

  return {
    async read(i) {
      let handle = await dir.getFileHandle(`p${i}`)
      let file = await handle.getFile()
      let buf = await file.arrayBuffer()
      let view = new Float32Array(buf)
      let ch = view[0] | 0, samplesPerCh = ((view.length - 1) / ch) | 0
      let data = []
      for (let c = 0; c < ch; c++) data.push(view.slice(1 + c * samplesPerCh, 1 + (c + 1) * samplesPerCh))
      return data
    },
    async write(i, data) {
      let handle = await dir.getFileHandle(`p${i}`, { create: true })
      let writable = await handle.createWritable()
      let total = 1 + data.reduce((s, ch) => s + ch.length, 0)
      let packed = new Float32Array(total)
      packed[0] = data.length
      let off = 1
      for (let ch of data) { packed.set(ch, off); off += ch.length }
      await writable.write(packed.buffer)
      await writable.close()
    },
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
}


// ── Self-register ────────────────────────────────────────────────

let origLoad = audio.fn[LOAD]
audio.fn[LOAD] = async function() {
  await origLoad.call(this)
  if (!this._.lru) this._.lru = new Set()
}

audio.opfsCache = opfsCache
audio.evict = evict
audio.ensurePages = ensurePages
audio.DEFAULT_BUDGET = DEFAULT_BUDGET
