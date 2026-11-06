// Files opened here (picked, dropped, recorded), kept in this browser by the name the scripts call them, so a reload
// opens them again: a script names its file, and without it could only say it is gone. Built-in samples are made again
// instead. Kept in the site's own file system (the origin private file system, navigator.storage.getDirectory()): a
// copy streamed to disk, never whole in memory however large, read back as a File that reads from disk as it is read,
// and nothing to ask permission for, the site's storage being its own. Within the site's quota (MDN, Storage quotas and
// eviction criteria: Chromium 60% of the disk; Firefox 10% of it or 10 GiB, whichever is less, and 50% once persisted;
// Safari about 60%), asked to persist so it is not evicted. A recording is kept as a 32-bit float WAV. A copy is written
// whole or not at all (createWritable writes aside and swaps in on close). Nothing kept is let go but by the editor's
// own word (unkeep), which it says only when asked to. Storage failing (a private window, a full disk, a browser before
// createWritable: Chrome 86, Firefox 111, Safari 26, MDN browser-compat-data) keeps nothing, and keep says so (null).
const DIR = 'audio-repl-files'  // the name the editor had before: what a browser kept is found
const home = () => navigator.storage.getDirectory()
const dir = async () => (await home()).getDirectoryHandle(DIR, { create: true })
// a name as a file's name there, which takes no slash
const key = name => encodeURIComponent(name)
// a file written whole: aside, then swapped in
async function put(d, name, data) {
  const out = await (await d.getFileHandle(name, { create: true })).createWritable()
  await new Blob([data]).stream().pipeTo(out)
}

// The file kept, as it reads back; null when it could not be
export async function keep(name, data) {
  try {
    navigator.storage.persist?.().catch(() => {})
    const h = await (await dir()).getFileHandle(key(name), { create: true }), out = await h.createWritable()
    await (data.channels ? wav(data) : data).stream().pipeTo(out)
    return await h.getFile()
  } catch { return null }
}
export async function unkeep(name) { try { await (await dir()).removeEntry(key(name)) } catch {} }
// every file kept, name → File
export async function kept() {
  const all = new Map()
  try { for await (const [k, h] of (await dir()).entries()) if (h.kind === 'file' && !k.endsWith('.crswap')) all.set(decodeURIComponent(k), await h.getFile()) } catch {}
  return all
}

// A take, kept as it comes: its samples, interleaved, a part each second, each part written whole, so a page closing
// as it records (a crash, a reload, a closed window) loses at most the second under way. The parts wait in a folder of
// their own (TAPES) until the take is kept as a file (keep), and are let go after; any found there on the next visit
// are a take the page closed on, kept then (tapes). Writing failing, `onfail` hears it once.
const TAPES = 'audio-repl-takes'
const tapesDir = async () => (await home()).getDirectoryHandle(TAPES, { create: true })
const PART = /^\d{6}$/
export function tape({ name, sampleRate, onfail }) {
  const at = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  let folder = null, buf = null, k = 0, n = 0, part = 0, ok = true, chain = Promise.resolve()
  const meta = extra => JSON.stringify({ name, sampleRate, channels: k, ...extra })
  const run = job => chain = chain.then(async () => {
    if (!ok) return
    try { folder ??= await (await tapesDir()).getDirectoryHandle(at, { create: true }); await job(folder) }
    catch { ok = false; onfail?.() }
  })
  // what is held, written as the next part; the take's facts first, before its first
  const flush = () => {
    if (!n) return chain
    const data = buf.slice(0, n * k), first = part === 0, label = String(part++).padStart(6, '0')
    n = 0
    return run(async d => { if (first) await put(d, 'take.json', meta()); await put(d, label, data) })
  }
  return {
    write(block) {
      if (!buf) { k = block.length; buf = new Float32Array(sampleRate * k) }
      for (let i = 0, m = block[0].length; i < m; i++) {
        for (let c = 0; c < k; c++) buf[n * k + c] = (block[c] ?? block[0])[i]
        if (++n === sampleRate) flush()
      }
    },
    flush,
    // The take as a WAV, from its sample `from`, `length` of them; what it is written down as first, so a page closing
    // before it is kept keeps the same; null when it could not be written
    async wav(from = 0, length = null) {
      // no sample written: no file, nor a folder for one
      if (!part && !n) return null
      await flush()
      await run(d => put(d, 'take.json', meta({ from, length })))
      return ok && folder ? assemble(folder, { sampleRate, channels: k, from, length }) : null
    },
    drop: () => chain.then(() => folder && tapesDir().then(d => d.removeEntry(at, { recursive: true }))).catch(() => {})
  }
}
// The takes a page closed on: [{ name, wav, drop }], each its WAV, read from disk as it is read; none of samples, let go
export async function tapes() {
  const out = []
  try {
    const root = await tapesDir()
    for await (const [at, d] of root.entries()) {
      if (d.kind !== 'directory') continue
      const drop = () => root.removeEntry(at, { recursive: true }).catch(() => {})
      let has = false
      for await (const n of d.keys()) if (PART.test(n)) { has = true; break }
      if (!has) { drop(); continue }
      // its facts are written before its first part: a folder of parts without them is left as it is
      const meta = await d.getFileHandle('take.json').then(h => h.getFile()).then(f => f.text()).then(JSON.parse).catch(() => null)
      if (!meta?.sampleRate || !meta.channels) continue
      out.push({ name: meta.name ?? null, wav: await assemble(d, meta), drop })
    }
  } catch {}
  return out
}
async function assemble(d, { sampleRate, channels, from = 0, length = null }) {
  const names = []
  for await (const n of d.keys()) if (PART.test(n)) names.push(n)
  const data = new Blob(await Promise.all(names.sort().map(n => d.getFileHandle(n).then(h => h.getFile()))))
  const frame = channels * 4, start = Math.min(from * frame, data.size), end = length == null ? data.size : Math.min(data.size, start + length * frame)
  return new Blob([header(channels, sampleRate, Math.floor((end - start) / frame)), data.slice(start, start + Math.floor((end - start) / frame) * frame)], { type: 'audio/wav' })
}

// A WAV file's 44 bytes before its samples: 32-bit float (WAVE_FORMAT_IEEE_FLOAT, 3), `k` channels interleaved
function header(k, sampleRate, frames) {
  const head = new DataView(new ArrayBuffer(44)), bytes = frames * k * 4
  const text = (at, s) => { for (let i = 0; i < s.length; i++) head.setUint8(at + i, s.charCodeAt(i)) }
  text(0, 'RIFF'); head.setUint32(4, 36 + bytes, true); text(8, 'WAVEfmt '); head.setUint32(16, 16, true)
  head.setUint16(20, 3, true); head.setUint16(22, k, true); head.setUint32(24, sampleRate, true); head.setUint32(28, sampleRate * k * 4, true)
  head.setUint16(32, k * 4, true); head.setUint16(34, 32, true); text(36, 'data'); head.setUint32(40, bytes, true)
  return head
}
// Samples as a WAV file
function wav({ channels, sampleRate }) {
  const k = channels.length, n = channels[0]?.length ?? 0, data = new Float32Array(n * k)
  for (let c = 0; c < k; c++) for (let i = 0; i < n; i++) data[i * k + c] = channels[c][i]
  return new Blob([header(k, sampleRate, n), data], { type: 'audio/wav' })
}

// One editor writes at a time. Two in one browser would each store the tabs as they have them, the later over the
// other's. The first page holds a lock (Web Locks: Chrome 69, Firefox 96, Safari 15.4); another, asked by the person
// (`ask`, resolving when they say so), has the first finish what it does (`give`: a take kept, the tabs stored) and let
// go (claim). A page that let go, or had it taken, hears `lost`. `owner()` says, synchronously, whether this page is
// still the one: the last to take it wrote its mark, and a page writes nothing before it has.
const LOCK = 'audio-repl', MARK = 'audio-repl-owner', me = `${Date.now()}-${Math.random().toString(36).slice(2)}`
const after = (ms, value) => new Promise(r => setTimeout(r, ms, value))
// (none there, the site's data cleared: still this one)
export const owner = () => { try { return (localStorage.getItem(MARK) ?? me) === me } catch { return true } }
// True once this page holds it, having read the stored tabs as they are; false when it had to ask for it, what it read
// before then perhaps behind what the other page stored as it let go (the page reloads to read it again)
export async function own({ ask, give, lost }) {
  if (!navigator.locks) return mark()
  const channel = new BroadcastChannel(LOCK)
  let release = null, gone = false
  const leave = () => { if (!gone) { gone = true; channel.close(); lost() } }
  // true once held, false when not to be had now; held, until it is let go or taken
  const take = (options = {}) => new Promise((got, failed) => {
    let held = false
    navigator.locks.request(LOCK, options, lock => {
      if (!lock) return got(false)
      held = true
      got(true)
      return new Promise(r => release = r)
    }).then(() => held && leave(), e => held ? leave() : failed(e))
  })
  if (!await take({ ifAvailable: true })) {
    // a page reloading lets go as it unloads, a moment after this one asks; one closed lets go whenever it closes
    const waiting = new AbortController(), free = take({ signal: waiting.signal }).catch(() => false)
    if (!await Promise.race([free, after(1500, false)])) {
      if (await Promise.race([ask().then(() => true), free.then(() => false)])) { waiting.abort(); await claim() }
      channel.close()
      return false
    }
  }
  channel.onmessage = async ({ data }) => { if (data === 'give' && !gone) { await give(); release?.() } }
  addEventListener('storage', e => { if (e.key === MARK && !owner()) leave() })
  return mark()
}
function mark() { try { localStorage.setItem(MARK, me) } catch {} return true }
// The page holding the lock lets go: asked to, or, not answering in ten seconds (a frozen tab), it is taken from it
export async function claim() {
  if (!navigator.locks) return
  const channel = new BroadcastChannel(LOCK), waiting = new AbortController()
  const free = navigator.locks.request(LOCK, { signal: waiting.signal }, () => true).catch(() => false)
  channel.postMessage('give')
  if (!await Promise.race([free, after(10000, false)])) { waiting.abort(); await navigator.locks.request(LOCK, { steal: true }, () => {}) }
  channel.close()
}
