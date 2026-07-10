import test from 'tst'
import audio from '../audio.js'  // full bundle (matches test/index.js) — concat test needs .insert(), metadata test needs stats.js wired for 'data'
import { File } from 'node:buffer'  // global only since Node 20; node:buffer.File (≡ the global, File extends Blob) works on 18.13+ too
import { emit } from '../core.js'
import { execFileSync } from 'child_process'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const fixtureWav = join(__dirname, 'fixture.wav')  // 44100Hz mono, 2s (88200 samples) — verified with `await audio(fixtureWav)` at the console

/** Minimal 44-byte canonical PCM WAVE header (RIFF/WAVE/fmt /data), per the de facto
 *  reference layout in "Multimedia Programming Interface and Data Specifications 1.0"
 *  (Microsoft/IBM, 1991) — same shape used by node_modules/@audio/decode-wav. */
function makeWav({ dataLen, actualBytes }) {
  let buf = new Uint8Array(44 + actualBytes)
  let dv = new DataView(buf.buffer)
  buf.set([0x52, 0x49, 0x46, 0x46], 0)               // 'RIFF'
  dv.setUint32(4, 36 + dataLen, true)                // chunk size
  buf.set([0x57, 0x41, 0x56, 0x45], 8)                // 'WAVE'
  buf.set([0x66, 0x6d, 0x74, 0x20], 12)               // 'fmt '
  dv.setUint32(16, 16, true)                          // fmt chunk size
  dv.setUint16(20, 1, true)                           // PCM
  dv.setUint16(22, 1, true)                           // mono
  dv.setUint32(24, 44100, true)                       // sampleRate
  dv.setUint32(28, 44100 * 2, true)                   // byteRate
  dv.setUint16(32, 2, true)                           // blockAlign
  dv.setUint16(34, 16, true)                           // bitsPerSample
  buf.set([0x64, 0x61, 0x74, 0x61], 36)               // 'data'
  dv.setUint32(40, dataLen, true)                     // declared data size
  return buf
}

// ── Fix 1: fn.stop() must not finalize a streaming file decode ──────────────

test('fix core.js:379 — stop() during streaming file decode keeps decoding (only pushable sources finalize)', async t => {
  let a = audio(fixtureWav)
  let waited = 0
  while (!a._.acc && waited < 2000) { await new Promise(r => setTimeout(r, 1)); waited += 1 }
  t.ok(a._.acc, 'caught mid-decode window (streaming accumulator present)')
  t.ok(!a.decoded, 'not decoded yet')
  a.stop()  // ordinary transport call — must be a no-op for a non-pushable (file decode) instance
  t.is(a.decoded, false, 'stop() does not force decoded=true on a streaming file decode')
  t.is(a.length, 0, 'length not corrupted to a stale value by stop()')
  await a.ready
  t.is(a.decoded, true, 'decode still completes normally')
  t.is(a.length, 88200, 'full length recovered — fixture.wav is 88200 samples @44100Hz/2s')
})

test('fix core.js:379 — stop() still finalizes a genuinely pushable instance', t => {
  let a = audio(null, { sampleRate: 44100, channels: 1 })
  a.push(new Float32Array(10))
  t.is(a.decoded, false, 'not decoded while still pushing')
  a.stop()
  t.is(a.decoded, true, 'pushable instance finalizes on stop()')
})

// ── Fix 2: dispose() must not let in-flight decode resurrect the instance ───

test('fix core.js:216 — dispose() mid-decode stays disposed, no resurrection', async t => {
  let a = audio(fixtureWav)
  a.dispose()
  t.is(a.pages.length, 0, 'pages cleared immediately')
  t.is(a.decoded, false, 'decoded flag untouched by dispose')
  await new Promise(r => setTimeout(r, 400))  // let the background decode (fixture.wav ~2s) run past completion
  t.is(a.pages.length, 0, 'pages still empty — background decode did not resurrect it')
  t.is(a.decoded, false, 'decoded still false')
  t.is(a.stats, null, 'stats still cleared')
})

// ── Fix 3: emit() must snapshot listeners ───────────────────────────────────

test('fix core.js:197 — emit() snapshots listeners so a self-unsubscribing callback does not skip later ones', t => {
  let a = audio.from([new Float32Array(4)], { sampleRate: 44100 })
  let fired = []
  let cb2 = () => { fired.push('cb2'); a.off('foo', cb2) }
  a.on('foo', () => fired.push('cb1'))
  a.on('foo', cb2)
  a.on('foo', () => fired.push('cb3'))
  emit(a, 'foo')
  t.is(fired, ['cb1', 'cb2', 'cb3'], 'all three listeners fire in order despite cb2 unsubscribing itself mid-emit')
})

test('fix core.js:201 — on/off still work as plain 2-arg API after removing the dead opts branch', t => {
  let a = audio.from([new Float32Array(4)], { sampleRate: 44100 })
  let n = 0
  let cb = () => n++
  a.on('x', cb)
  emit(a, 'x')
  a.off('x', cb)
  emit(a, 'x')
  t.is(n, 1, 'off() removes the exact callback, on() takes no 3rd arg')
})

// ── Fix 4: empty/truncated decode must reject, not hang ─────────────────────

test('fix core.js:669 — WAV with zero decoded samples rejects .ready and emits error (does not hang)', async t => {
  let errs = []
  let a = audio(makeWav({ dataLen: 0, actualBytes: 0 }).buffer)  // spec-legal empty data chunk
  a.on('error', e => errs.push(e.message))
  await t.rejects(() => a.ready, /decoded no audio data/, 'ready rejects')
  t.is(errs, ['audio: decoded no audio data'], 'error event fired exactly once')
})

test('fix core.js:669 — truncated WAV (declared data length, zero actual bytes) rejects too', async t => {
  let errs = []
  let a = audio(makeWav({ dataLen: 44100 * 2, actualBytes: 0 }).buffer)
  a.on('error', e => errs.push(e.message))
  await t.rejects(() => a.ready, /decoded no audio data/, 'ready rejects, does not hang')
  t.ok(errs.length === 1, 'error event fired')
})

// ── Fix 5: 'metadata' must precede first 'data' ─────────────────────────────

test('fix core.js:583 — metadata event fires before the first data event', async t => {
  let a = audio(fixtureWav)
  let order = []
  a.on('metadata', m => order.push('metadata'))
  a.on('data', d => order.push('data'))
  await a.ready
  t.ok(order.length > 0, 'events were observed')
  t.is(order[0], 'metadata', 'first event is metadata, not data')
})

// ── Fix 6: eviction integrity (budget always enforceable; seek-restore is tracked) ──

function memCache() {
  let store = new Map()
  return {
    async read(i) { return store.get(i) },
    async write(i, data) { store.set(i, data.map(ch => new Float32Array(ch))) },
    async has(i) { return store.has(i) },
  }
}

test('fix cache.js:17 + core.js:420 — budget stays enforceable after seek-prefetch restores untracked pages', async t => {
  const PAGE = audio.PAGE_SIZE
  let ch = new Float32Array(PAGE * 10).fill(0.5)
  let cache = memCache()
  let pageBytes = PAGE * 4
  let a = await audio([ch], { cache, budget: pageBytes })  // fits exactly 1 page resident

  // seek-prefetch several pages without ever reading them (they'd previously stay untracked forever)
  for (let page of [3, 6, 9]) {
    a.seek(page * PAGE / a.sampleRate)
    await new Promise(r => setTimeout(r, 20))
  }
  let residentAfterSeek = a.pages.filter(p => p !== null).length
  t.ok(residentAfterSeek > 1, `seek-prefetch restored pages (${residentAfterSeek} resident, over budget until next evict)`)

  await audio.evict(a)
  let bytes = p => p ? p.reduce((s, c) => s + c.byteLength, 0) : 0
  let resident = a.pages.reduce((s, p) => s + bytes(p), 0)
  t.ok(resident <= a.budget, `evict() enforces budget (resident=${resident}, budget=${a.budget})`)
})

test('fix core.js:420 + cache.js:38 — seek-restored and ensurePages-restored pages register in a._.lru', async t => {
  const PAGE = audio.PAGE_SIZE
  let ch = new Float32Array(PAGE * 4).fill(0.5)
  let cache = memCache()
  let a = await audio([ch], { cache, budget: PAGE * 4 })  // fits 1 page
  t.is(a._.lru.size, 0, 'no pages read yet — lru empty right after construction')

  a.seek(2 * PAGE / a.sampleRate)
  await new Promise(r => setTimeout(r, 20))
  t.ok(a._.lru.has(2), 'seek-prefetch registers the restored page in lru (treated as access)')

  await audio.ensurePages(a, 0, 1 / a.sampleRate)
  t.ok(a._.lru.has(0), 'ensurePages registers the restored page in lru too')
})

// ── Fix 7: 'error' event fires on every async-producing branch of audio() ──

test('fix core.js:71 — concat branch emits error when a member source fails to decode', async t => {
  let bad = audio('/nonexistent-fix-core-test-xyz.wav')
  let good = audio.from([new Float32Array(100)], { sampleRate: 44100 })
  let merged = audio([good, bad])
  let errs = []
  merged.on('error', e => errs.push(e.message))
  await t.rejects(() => merged.ready, undefined, 'ready rejects')
  t.ok(errs.length > 0, 'error event fired for concat-branch failure')
})

// ── Fix 8: core.js's own default fn[READ] restores evicted pages ───────────

test('fix core.js:348 — core+cache (no plan.js) read restores evicted pages instead of returning silence', t => {
  // Runs in an isolated child process: importing plan.js anywhere in *this* test file's process
  // would permanently override audio.fn[READ] (module singleton), invalidating the check that
  // core.js's own default fn[READ] — not plan.js's — is the one doing the restoring.
  let script = `
    import audio from ${JSON.stringify(join(__dirname, '..', 'core.js'))}
    import ${JSON.stringify(join(__dirname, '..', 'cache.js'))}
    function memCache() {
      let store = new Map()
      return { async read(i){return store.get(i)}, async write(i,d){store.set(i,d)}, async has(i){return store.has(i)} }
    }
    let PAGE = audio.PAGE_SIZE
    let data = new Float32Array(PAGE * 3).fill(0.5)
    let cache = memCache()
    let a = audio.from([data], { sampleRate: 44100, cache, budget: PAGE * 4 * 1.5 })
    await audio.evict(a)
    let out = await a.read()
    let arr = out[0]
    let nonZero = 0
    for (let i = 0; i < arr.length; i++) if (arr[i] !== 0) nonZero++
    console.log(JSON.stringify({ len: arr.length, nonZero }))
  `
  let stdout = execFileSync(process.execPath, ['--input-type=module', '-e', script], { cwd: dirname(__dirname), encoding: 'utf8' })
  let { len, nonZero } = JSON.parse(stdout.trim().split('\n').pop())
  t.is(len, audio.PAGE_SIZE * 3, 'full length read back')
  t.is(nonZero, len, 'all samples non-zero — evicted pages were restored, not read back as silence')
})

test('fix core.js:552 — Blob/File/Response sources decode (README contract)', async t => {
  let { readFile } = await import('fs/promises')
  let buf = await readFile(fixtureWav)
  let bytes = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
  let ref = await audio(bytes.slice(0))

  let blob = await audio(new Blob([bytes]))
  t.is(blob.length, ref.length, 'Blob decodes to same length')
  let refPcm = (await ref.read())[0], blobPcm = (await blob.read())[0]
  t.ok(blobPcm.every((v, i) => v === refPcm[i]), 'Blob PCM bit-exact vs ArrayBuffer source')

  let file = await audio(new File([bytes], 'fixture.wav', { type: 'audio/wav' }))
  t.is(file.length, ref.length, 'File decodes to same length')

  let resp = await audio(new Response(bytes.slice(0)))
  t.is(resp.length, ref.length, 'Response decodes to same length')

  // Blob path streams — data events fire with deltas
  let deltas = 0
  let b2 = audio(new Blob([bytes]))
  b2.on('data', () => deltas++)
  await b2
  t.ok(deltas > 0, `Blob decode is streaming (${deltas} data events)`)
})

test('fix cache.js — detectBudget caps residency near DEFAULT_BUDGET, not GBs', async t => {
  let desc = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
  // huge quota (1TB disk) must not translate into a multi-GB resident budget —
  // instances share RAM across tabs/tests (2GB/instance ballooned real usage)
  let mock = q => Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { storage: { estimate: async () => ({ quota: q }) } } })
  mock(1024 * 2 ** 30)
  try {
    let b = await audio.detectBudget()
    t.ok(b <= 512 * 1024 * 1024, `budget capped (${(b / 2 ** 20) | 0}MB)`)
    t.ok(b >= 64 * 1024 * 1024, 'floor keeps paging useful')

    mock(256 * 2 ** 20)
    t.is(await audio.detectBudget(), 64 * 1024 * 1024, 'small quota clamps to the floor')
  } finally { desc ? Object.defineProperty(globalThis, 'navigator', desc) : delete globalThis.navigator }  // node <21: no navigator global to restore
})
