/**
 * Page cache — LRU eviction to OPFS and restore.
 * Self-registers on import — overrides [LOAD], exposes opfsCache/evict on audio.
 */

import audio, { LOAD } from './core.js'

const DEFAULT_BUDGET = 500 * 1024 * 1024  // 500MB

/** Evict pages to cache until resident bytes fit within budget. LRU from start. */
async function evict(a) {
  if (!a.cache || a.budget === Infinity) return
  let bytes = p => p ? p.reduce((s, ch) => s + ch.byteLength, 0) : 0
  let current = a.pages.reduce((sum, p) => sum + bytes(p), 0)
  for (let i = 0; i < a.pages.length && current > a.budget; i++) {
    if (!a.pages[i]) continue
    await a.cache.write(i, a.pages[i])
    current -= bytes(a.pages[i])
    a.pages[i] = null
  }
}

/** Restore all evicted pages from cache backend. */
async function restorePages() {
  if (!this.cache) return
  for (let i = 0; i < this.pages.length; i++)
    if (this.pages[i] === null && await this.cache.has(i)) this.pages[i] = await this.cache.read(i)
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
      let ch = view[0], samplesPerCh = (view.length - 1) / ch
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

audio.fn[LOAD] = restorePages
audio.opfsCache = opfsCache
audio.evict = evict
audio.DEFAULT_BUDGET = DEFAULT_BUDGET
