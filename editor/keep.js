// Files opened here (picked, dropped, recorded), kept in this browser by the name the scripts call them, so a reload
// opens them again: a script names its file, and without it could only say it is gone. Built-in samples are made again
// instead. Kept in the site's own file system (the origin private file system, navigator.storage.getDirectory()): a
// copy streamed to disk, never whole in memory however large, read back as a File that reads from disk as it is read,
// and nothing to ask permission for, the site's storage being its own. Within the site's quota (MDN, Storage quotas and
// eviction criteria: Chromium 60% of the disk; Firefox 10% of it or 10 GiB, whichever is less, and 50% once persisted;
// Safari about 60%), asked to persist so it is not evicted. A recording is kept as a 32-bit float WAV. A copy is written
// whole or not at all (createWritable writes aside and swaps in on close). Storage failing (a private window, a full
// disk, a browser before createWritable: Chrome 86, Firefox 111, Safari 26, MDN browser-compat-data) keeps nothing,
// quietly: the file stays open until the page closes, as before.
const DIR = 'audio-repl-files'  // the name the editor had before: what a browser kept is found
const dir = async () => (await navigator.storage.getDirectory()).getDirectoryHandle(DIR, { create: true })
// a name as a file's name there, which takes no slash
const key = name => encodeURIComponent(name)

export async function keep(name, data) {
  try {
    navigator.storage.persist?.().catch(() => {})
    const out = await (await (await dir()).getFileHandle(key(name), { create: true })).createWritable()
    await (data.channels ? wav(data) : data).stream().pipeTo(out)
  } catch {}
}
export async function unkeep(name) { try { await (await dir()).removeEntry(key(name)) } catch {} }
// every file kept, name → File
export async function kept() {
  const all = new Map()
  try { for await (const [k, h] of (await dir()).entries()) if (h.kind === 'file' && !k.endsWith('.crswap')) all.set(decodeURIComponent(k), await h.getFile()) } catch {}
  return all
}

// Samples as a WAV file: 32-bit float (WAVE_FORMAT_IEEE_FLOAT, 3), the channels interleaved
function wav({ channels, sampleRate }) {
  const k = channels.length, n = channels[0]?.length ?? 0, head = new DataView(new ArrayBuffer(44)), data = new Float32Array(n * k)
  for (let c = 0; c < k; c++) for (let i = 0; i < n; i++) data[i * k + c] = channels[c][i]
  const text = (at, s) => { for (let i = 0; i < s.length; i++) head.setUint8(at + i, s.charCodeAt(i)) }
  text(0, 'RIFF'); head.setUint32(4, 36 + data.byteLength, true); text(8, 'WAVEfmt '); head.setUint32(16, 16, true)
  head.setUint16(20, 3, true); head.setUint16(22, k, true); head.setUint32(24, sampleRate, true); head.setUint32(28, sampleRate * k * 4, true)
  head.setUint16(32, k * 4, true); head.setUint16(34, 32, true); text(36, 'data'); head.setUint32(40, data.byteLength, true)
  return new Blob([head, data], { type: 'audio/wav' })
}
