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
  if (!a.cache || a.budget === Infinity) return
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
    current -= bytes(a.pages[i])
    a.pages[i] = null
    lru?.delete(i)
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
    if (a.pages[i] === null && await a.cache.has(i)) { a.pages[i] = await a.cache.read(i); touchLru(a, i) }
}

/** Derive a page budget from the platform quota (Chrome: ~60% of disk — tracks device
 *  class). Quarter of quota, bounded to sane resident-RAM limits: floor keeps paging
 *  useful under tiny quotas, cap keeps desktops from ballooning residency.
 *  Null when estimate() is unavailable (Node, older browsers) — caller falls back. */
async function detectBudget() {
  try {
    let { quota } = await navigator.storage.estimate()
    if (!quota) return null
    return Math.max(64 * 1024 * 1024, Math.min(2 * 1024 * 1024 * 1024, Math.floor(quota / 4)))
  } catch { return null }
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


audio.opfsCache = opfsCache
audio.evict = evict
audio.ensurePages = ensurePages
audio.detectBudget = detectBudget
audio.DEFAULT_BUDGET = DEFAULT_BUDGET
