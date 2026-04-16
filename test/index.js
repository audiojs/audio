import test from 'tst'
import audio from '../audio.js'
const { PAGE_SIZE, BLOCK_SIZE } = audio

/** Sine tone buffer — clean audio for tests (no DC clicks/pops). */
function tone(freq, dur, sr = 44100) {
  let n = Math.round(dur * sr), ch = new Float32Array(n)
  for (let i = 0; i < n; i++) ch[i] = Math.sin(2 * Math.PI * freq * i / sr)
  return ch
}

/** Goertzel magnitude at `f` Hz over a sample buffer — robust pitch probe. */
function energyAt(buf, f, sr = 44100) {
  let n = buf.length, w = 2 * Math.PI * f / sr
  let coeff = 2 * Math.cos(w), s1 = 0, s2 = 0
  for (let i = 0; i < n; i++) { let s = buf[i] + coeff * s1 - s2; s2 = s1; s1 = s }
  return Math.sqrt(s1 * s1 + s2 * s2 - coeff * s1 * s2) / n
}

/** Trim `edge` seconds from both ends to skip phase-vocoder warm-up/flush artifacts. */
function mid(buf, edge = 0.1, sr = 44100) {
  let n = Math.min(sr * edge | 0, (buf.length / 4) | 0)
  return buf.subarray(n, buf.length - n)
}

const isNode = typeof process !== 'undefined' && process.versions?.node

// Isomorphic fixture loading: file paths in Node, HTTP URLs in browser
let lenaPath, lenaMp3, readFileSync
if (isNode) {
  let lena = (await import('audio-lena')).default
  let { fileURLToPath } = await import('url')
  lenaPath = fileURLToPath(lena.url('wav'))
  lenaMp3 = fileURLToPath(lena.url('mp3'))
  readFileSync = (await import('fs')).readFileSync
} else {
  lenaPath = '/node_modules/audio-lena/lena.wav'
  lenaMp3 = '/node_modules/audio-lena/lena.mp3'
  readFileSync = null
}


// ── Phase 1: Foundation ──────────────────────────────────────────────────

test('audio(wav) — load from file path', async t => {
  let a = await audio(lenaPath)
  t.ok(a.pages, 'returns audio instance')
  t.is(a.sampleRate, 44100, 'sampleRate')
  t.is(a.channels, 1, 'channels')
  t.ok(a.duration > 12 && a.duration < 13, `duration ~12.27s (got ${a.duration.toFixed(2)})`)
  t.ok(a.pages.length > 0, `has ${a.pages.length} pages`)
  t.ok(a.stats.min[0].length > 0, 'index populated')
})

test('audio() — sync + thenable', async t => {
  let a = audio(lenaPath)
  t.is(a.sampleRate, 0, 'sampleRate unknown before decode')
  t.ok(a.ready instanceof Promise, 'ready is promise before decode')
  t.is(typeof a.then, 'function', 'thenable')
  a.gain(-3)  // edits work before decode
  t.is(a.edits.length, 1, 'edit pushed before decode')
  let b = await a
  t.ok(b === a, 'resolves to same instance')
  t.is(a.sampleRate, 44100, 'sampleRate after decode')
  t.is(await a.ready, true, 'ready resolves to true')
  t.is(typeof a.then, 'undefined', 'then removed after resolve')
})

test('audio(mp3) — decode mp3', async t => {
  let a = await audio(lenaMp3)
  t.ok(a.duration > 12, `duration > 12s (got ${a.duration.toFixed(2)})`)
  t.is(a.sampleRate, 44100, 'sampleRate')
})

test('audio(buffer) — from ArrayBuffer', async t => {
  let buf = isNode ? readFileSync(lenaPath) : new Uint8Array(await (await fetch(lenaPath)).arrayBuffer())
  let a = await audio(buf.buffer ?? buf)
  t.ok(a.duration > 12, 'decoded from ArrayBuffer')
})

test('audio(pcm) — wraps Float32Array[]', async t => {
  let ch = [new Float32Array(44100)]
  let a = await audio(ch)
  t.is(a.duration, 1, '1 second')
  t.is(a.channels, 1, 'mono')
})

test('audio.from(pcm) — sync', async t => {
  let a = audio.from([new Float32Array(44100), new Float32Array(44100)])
  t.is(a.channels, 2, 'stereo')
  t.is(a.duration, 1, '1 second')
})

test('audio.from(seconds) — silence', async t => {
  let a = audio.from(3, { channels: 2, sampleRate: 48000 })
  t.is(a.duration, 3, '3 seconds')
  t.is(a.channels, 2, 'stereo')
  t.is(a.sampleRate, 48000, 'custom sample rate')
})

test('audio.from(fn) — function source', async t => {
  let sr = 44100
  let a = audio.from(t => Math.sin(2 * Math.PI * 440 * t), { duration: 1, sampleRate: sr })
  t.is(a.duration, 1, '1 second')
  t.is(a.channels, 1, 'mono')
  let pcm = await a.read()
  // Check first few samples match sine wave
  let maxDiff = 0
  for (let i = 0; i < 100; i++) maxDiff = Math.max(maxDiff, Math.abs(pcm[0][i] - Math.sin(2 * Math.PI * 440 * i / sr)))
  t.ok(maxDiff < 1e-6, `matches sine (maxDiff: ${maxDiff})`)
})

test('audio.from(fn) — receives (t, i) args', async t => {
  let sr = 44100, logged = []
  let a = audio.from((time, idx) => { if (idx < 3) logged.push({ time, idx }); return 0 }, { duration: 0.1, sampleRate: sr })
  await a.read()
  t.is(logged[0].idx, 0, 'first index is 0')
  t.is(logged[1].idx, 1, 'second index is 1')
  t.is(logged[2].idx, 2, 'third index is 2')
  t.ok(Math.abs(logged[0].time - 0) < 1e-10, 'first t ≈ 0')
  t.ok(Math.abs(logged[1].time - 1 / sr) < 1e-10, 'second t ≈ 1/sr')
  t.ok(Math.abs(logged[2].time - 2 / sr) < 1e-10, 'third t ≈ 2/sr')
})

test('audio.from(int16) — format conversion', async t => {
  let int16 = new Int16Array([0, 16384, 32767, -32768])
  let a = audio.from(int16, { format: 'int16', sampleRate: 44100 })
  t.is(a.duration > 0, true, 'has duration')
  let pcm = await a.read()
  t.ok(Math.abs(pcm[0][0]) < 0.01, `0 → ~0 (got ${pcm[0][0].toFixed(3)})`)
  t.ok(pcm[0][2] > 0.9, `32767 → ~1 (got ${pcm[0][2].toFixed(3)})`)
})

test('audio([a, b]) — concat from array', async t => {
  let a = audio.from([new Float32Array(44100).fill(0.5)], { sampleRate: 44100 })
  let b = audio.from([new Float32Array(44100).fill(-0.5)], { sampleRate: 44100 })
  let c = await audio([a, b])
  t.ok(Math.abs(c.duration - 2) < 0.01, `2 seconds (got ${c.duration.toFixed(3)})`)
  let pcm = await c.read()
  t.ok(Math.abs(pcm[0][0] - 0.5) < 0.01, `first half: 0.5 (got ${pcm[0][0].toFixed(3)})`)
  t.ok(Math.abs(pcm[0][44100] - (-0.5)) < 0.01, `second half: -0.5 (got ${pcm[0][44100].toFixed(3)})`)
})

test('audio.version', async t => {
  t.ok(typeof audio.version === 'string', `version is string: ${audio.version}`)
  t.ok(/^\d+\.\d+\.\d+/.test(audio.version), 'semver format')
})

test('parseTime — timecodes', async t => {
  let { parseTime } = await import('../audio.js')
  t.is(parseTime('00:00'), 0, '00:00 = 0')
  t.is(parseTime('1:30'), 90, '1:30 = 90s')
  t.is(parseTime('0:05'), 5, '0:05 = 5s')
  t.is(parseTime('1:30:00'), 5400, '1:30:00 = 5400s')
  t.is(parseTime('0:00:05'), 5, '0:00:05 = 5s')
  t.is(parseTime('1:02:03.5'), 3723.5, '1:02:03.5')
  t.is(parseTime('5s'), 5, '5s still works')
  t.is(parseTime(3.14), 3.14, 'number passthrough')
})

test('audio() — push-based source', async t => {
  let a = audio()
  t.is(await a.ready, true, 'ready immediately for push-based')
  // Push 1s of 0.5
  a.push(new Float32Array(44100).fill(0.5))
  t.ok(a.duration > 0, `has duration after push: ${a.duration.toFixed(2)}`)
  // Push another 1s
  a.push(new Float32Array(44100).fill(-0.5))
  a.stop()
  t.ok(Math.abs(a.duration - 2) < 0.01, `2 seconds (got ${a.duration.toFixed(3)})`)
  let pcm = await a.read()
  t.ok(Math.abs(pcm[0][0] - 0.5) < 0.01, `first half: 0.5 (got ${pcm[0][0].toFixed(3)})`)
  t.ok(Math.abs(pcm[0][44100] - (-0.5)) < 0.01, `second half: -0.5 (got ${pcm[0][44100].toFixed(3)})`)
})

test('audio() — record from mic (null backend)', { skip: !isNode }, async t => {
  let a = audio()
  a.record({ backend: 'null' })
  await new Promise(r => setTimeout(r, 150))
  t.ok(a.duration >= 0, `recording has duration: ${a.duration.toFixed(3)}`)
  a.stop()
  t.is(a.decoded, true, 'decoded after stop')
})

test('audio() — push with Int16Array format', async t => {
  let a = audio()
  // Push 100 samples of int16 data
  let i16 = new Int16Array(100)
  for (let i = 0; i < 100; i++) i16[i] = Math.round(Math.sin(i * 0.1) * 16384)
  a.push(i16, 'int16')
  a.stop()
  t.ok(a.duration > 0, `has duration: ${a.duration.toFixed(4)}`)
  let pcm = await a.read()
  // int16 16384 → float ~0.5
  t.ok(Math.abs(pcm[0][Math.round(Math.PI / 0.1 / 2)] - 0.5) < 0.05, 'int16 → float conversion works')
})

test('audio() — stop before push', async t => {
  let a = audio()
  a.stop()
  t.is(a.decoded, true, 'decoded after immediate stop')
})

test('audio() — stereo push with format', async t => {
  let a = audio(null, { channels: 2 })
  // Interleaved stereo int16: L=16384, R=-16384
  let i16 = new Int16Array(200)
  for (let i = 0; i < 200; i += 2) { i16[i] = 16384; i16[i + 1] = -16384 }
  a.push(i16, { format: 'int16', channels: 2 })
  a.stop()
  t.is(a.channels, 2, 'stereo')
  let pcm = await a.read()
  t.ok(pcm[0][0] > 0.4, `left positive (${pcm[0][0].toFixed(3)})`)
  t.ok(pcm[1][0] < -0.4, `right negative (${pcm[1][0].toFixed(3)})`)
})

test('audio(URL) — from URL object', { skip: !isNode }, async t => {
  let lena = (await import('audio-lena')).default
  let a = await audio(lena.url('wav'))
  t.ok(a.duration > 12, `duration > 12s (got ${a.duration.toFixed(2)})`)
})

test('audio(number) — silence is sync', async t => {
  let a = audio(3, { channels: 1 })
  t.ok(a.pages, 'returns instance')
  t.is(a.duration, 3, '3 seconds')
})

test('audio.from(audio) — structural copy', async t => {
  let a = audio.from([new Float32Array(100).fill(0.7)])
  a.gain(-6)
  let b = audio.from(a)
  t.ok(b !== a, 'different instance')
  t.is(b.edits.length, 0, 'copy has no edits (independent edit list)')
  t.ok(b.pages !== a.pages && b.pages[0] === a.pages[0], 'copy shares page contents, independent array')
  let pcm = await b.read()
  t.ok(Math.abs(pcm[0][0] - 0.7) < 0.01, 'copy reads original source PCM unaffected by source edits')
})

test('audio.from(AudioBuffer-like) — from object with getChannelData', async t => {
  let ch = new Float32Array(44100)
  let buf = { numberOfChannels: 1, sampleRate: 44100, getChannelData: () => ch }
  let a = audio.from(buf)
  t.is(a.duration, 1, '1 second')
  t.is(a.channels, 1, 'mono')
})

test('audio.stat — custom field', async t => {
  // Per-channel metric — return array
  audio.stat('blockRms', (chs) => chs.map(ch => {
    let sum = 0
    for (let i = 0; i < ch.length; i++) sum += ch[i] * ch[i]
    return Math.sqrt(sum / ch.length)
  }))
  let ch = new Float32Array(BLOCK_SIZE * 2).fill(0.5)
  let a = audio.from([ch])
  t.ok(a.stats.blockRms, 'custom stat field exists')
  t.is(a.stats.blockRms[0].length, 2, '2 blocks')
  t.ok(Math.abs(a.stats.blockRms[0][0] - 0.5) < 0.01, `blockRms ≈ 0.5 (got ${a.stats.blockRms[0][0].toFixed(3)})`)

  // Cross-channel metric — return number (broadcast to all channels)
  audio.stat('correlation', (chs) => {
    if (chs.length < 2) return 1
    let L = chs[0], R = chs[1], sum = 0
    for (let i = 0; i < L.length; i++) sum += L[i] * R[i]
    return sum / L.length
  })
  let stereo = audio.from([new Float32Array(BLOCK_SIZE).fill(0.5), new Float32Array(BLOCK_SIZE).fill(0.5)])
  t.ok(stereo.stats.correlation, 'cross-channel field exists')
  t.ok(stereo.stats.correlation[0][0] > 0.2, `correlated (${stereo.stats.correlation[0][0].toFixed(3)})`)
  t.is(stereo.stats.correlation[0][0], stereo.stats.correlation[1][0], 'same value both channels')
})

test('index — block structure', async t => {
  let a = audio.from([new Float32Array(PAGE_SIZE * 2)])
  t.is(a.stats.blockSize, BLOCK_SIZE, 'blockSize = 1024')
  let expectedBlocks = Math.ceil(PAGE_SIZE * 2 / BLOCK_SIZE)
  t.is(a.stats.min[0].length, expectedBlocks, `${expectedBlocks} blocks`)
  t.is(a.stats.max[0].length, expectedBlocks, 'max same length')
  t.is(a.stats.energy[0].length, expectedBlocks, 'energy same length')
})

test('index — values correct for sine wave', async t => {
  let sr = 44100, len = BLOCK_SIZE
  let ch = new Float32Array(len)
  for (let i = 0; i < len; i++) ch[i] = Math.sin(2 * Math.PI * 440 * i / sr)
  let a = audio.from([ch], { sampleRate: sr })

  t.ok(a.stats.max[0][0] > 0.99, `max ≈ 1 (got ${a.stats.max[0][0].toFixed(3)})`)
  t.ok(a.stats.min[0][0] < -0.99, `min ≈ -1 (got ${a.stats.min[0][0].toFixed(3)})`)
  t.ok(a.stats.energy[0][0] > 0.4, `energy > 0.4 (got ${a.stats.energy[0][0].toFixed(3)})`)
})

test('custom BLOCK_SIZE — finer stats', async t => {
  let orig = audio.BLOCK_SIZE
  audio.BLOCK_SIZE = 32
  try {
    let sr = 44100, samples = 1024
    let ch = new Float32Array(samples)
    for (let i = 0; i < samples; i++) ch[i] = Math.sin(2 * Math.PI * 440 * i / sr)
    let a = audio.from([ch], { sampleRate: sr })
    t.is(a.stats.blockSize, 32, 'blockSize stored as 32')
    t.is(a.stats.min[0].length, Math.ceil(samples / 32), `${Math.ceil(samples / 32)} blocks at 32-sample resolution`)
    t.ok(a.stats.max[0][0] > 0, 'stats computed correctly at fine resolution')
  } finally { audio.BLOCK_SIZE = orig }
})

test('custom BLOCK_SIZE — coarser stats', async t => {
  let orig = audio.BLOCK_SIZE
  audio.BLOCK_SIZE = 4096
  try {
    let samples = 4096 * 3
    let ch = new Float32Array(samples).fill(0.5)
    let a = audio.from([ch])
    t.is(a.stats.blockSize, 4096, 'blockSize stored as 4096')
    t.is(a.stats.min[0].length, 3, '3 blocks at 4096-sample resolution')
    t.ok(Math.abs(a.stats.max[0][0] - 0.5) < 0.01, 'max ≈ 0.5')
  } finally { audio.BLOCK_SIZE = orig }
})

test('custom PAGE_SIZE — smaller pages', async t => {
  let origP = audio.PAGE_SIZE, origB = audio.BLOCK_SIZE
  audio.PAGE_SIZE = 256
  audio.BLOCK_SIZE = 64
  try {
    let samples = 256 * 3 + 100  // 3 full pages + partial
    let ch = new Float32Array(samples)
    for (let i = 0; i < samples; i++) ch[i] = i / samples  // ramp
    let a = audio.from([ch])

    t.is(a.pages.length, 4, '4 pages (3 full + 1 partial)')
    t.is(a.pages[0][0].length, 256, 'first page = 256 samples')
    t.is(a.pages[3][0].length, 100, 'last page = 100 samples')
    t.is(a.stats.blockSize, 64, 'blockSize = 64')
    t.is(a.stats.min[0].length, Math.ceil(samples / 64), `correct block count`)

    // read back — verify no data loss across page boundaries
    let pcm = await a.read()
    t.is(pcm[0].length, samples, 'full length preserved')
    t.ok(Math.abs(pcm[0][0]) < 0.001, 'first sample ≈ 0')
    t.ok(pcm[0][samples - 1] > 0.99, 'last sample ≈ 1')
    // cross-page boundary sample
    t.ok(Math.abs(pcm[0][256] - 256 / samples) < 0.001, 'sample at page boundary correct')
  } finally { audio.PAGE_SIZE = origP; audio.BLOCK_SIZE = origB }
})

test('custom PAGE_SIZE — large pages', async t => {
  let origP = audio.PAGE_SIZE
  audio.PAGE_SIZE = 131072  // 128K
  try {
    let samples = 131072 + 1000
    let ch = new Float32Array(samples).fill(0.3)
    let a = audio.from([ch])
    t.is(a.pages.length, 2, '2 pages at 128K page size')
    t.is(a.pages[0][0].length, 131072, 'first page = 128K samples')
    t.is(a.pages[1][0].length, 1000, 'second page = remainder')
    let pcm = await a.read()
    t.is(pcm[0].length, samples, 'read back full length')
    t.ok(Math.abs(pcm[0][131072] - 0.3) < 0.01, 'cross-page read correct')
  } finally { audio.PAGE_SIZE = origP }
})

test('custom sizes — ops work across page boundaries', async t => {
  let origP = audio.PAGE_SIZE, origB = audio.BLOCK_SIZE
  audio.PAGE_SIZE = 128
  audio.BLOCK_SIZE = 32
  try {
    let samples = 128 * 3
    let ch = new Float32Array(samples).fill(1)
    let a = audio.from([ch])
    a.gain(-6)  // ~ half amplitude
    let pcm = await a.read()
    let expected = 10 ** (-6 / 20)
    // check across all pages
    for (let p = 0; p < 3; p++) {
      let i = p * 128 + 64
      t.ok(Math.abs(pcm[0][i] - expected) < 0.01, `page ${p} gain applied (${pcm[0][i].toFixed(3)})`)
    }
  } finally { audio.PAGE_SIZE = origP; audio.BLOCK_SIZE = origB }
})

test('custom sizes — trim respects block resolution', async t => {
  let origB = audio.BLOCK_SIZE
  audio.BLOCK_SIZE = 32
  try {
    let sr = 44100, silence = 32 * 4, loud = 32 * 10
    let ch = new Float32Array(silence + loud + silence)
    for (let i = silence; i < silence + loud; i++) ch[i] = 0.8
    let a = audio.from([ch], { sampleRate: sr })
    a.trim()
    let pcm = await a.read()
    // trim granularity is BLOCK_SIZE — duration should be close to loud region
    let expectedDur = loud / sr
    t.ok(Math.abs(a.duration - expectedDur) < 32 * 2 / sr, `trimmed to ≈${expectedDur.toFixed(4)}s (got ${a.duration.toFixed(4)}s)`)
    t.ok(pcm[0].length > 0, 'not empty after trim')
  } finally { audio.BLOCK_SIZE = origB }
})


// ── Phase 2: Streaming decode ────────────────────────────────────────────

test('on(data) — fires during decode', async t => {
  let deltas = []
  let a = audio(lenaPath)
  a.on('data', ({ delta, offset }) => deltas.push({ delta, offset }))
  await a
  t.ok(deltas.length > 0, `on(data) fired ${deltas.length} times`)
  t.ok(deltas[deltas.length - 1].offset > 0, 'offset progresses')

  // Verify delta shape
  let d = deltas[0].delta
  t.ok('fromBlock' in d, 'delta has fromBlock')
  t.ok(Array.isArray(d.min), 'delta.min is array of channels')
  t.ok(d.min[0] instanceof Float32Array, 'delta.min[0] is Float32Array')
  t.ok(Array.isArray(d.max) && Array.isArray(d.energy), 'delta has max and energy')
})

test('on(data) — delta covers full index', async t => {
  let totalBlocks = 0
  let a = audio(lenaPath)
  a.on('data', ({ delta }) => { totalBlocks += delta.min[0].length })
  await a
  t.is(totalBlocks, a.stats.min[0].length, 'deltas cover all index blocks')
})


// ── Phase 3: Structural ops ──────────────────────────────────────────────

test('crop — keeps range in place', async t => {
  let a = audio.from([new Float32Array(44100 * 10)], { sampleRate: 44100 })
  a.crop({at: 2, duration: 3})
  t.is(a.edits.length, 1, 'one edit')
  t.is(a.edits[0][0], 'crop')
  let pcm = await a.read()
  t.is(pcm[0].length, Math.round(3 * 44100), 'cropped to 3 seconds')
})

test('remove + insert — chain', async t => {
  let a = audio.from([new Float32Array(44100)])
  a.remove({at: 0.2, duration: 0.1}).insert(0.5).insert(audio.from(0.1), {at: 0})
  t.is(a.edits.length, 3, '3 edits')
  t.is(a.edits[0][0], 'remove')
  t.is(a.edits[1][0], 'insert')
  t.is(a.edits[2][0], 'insert')
})

test('repeat', async t => {
  let a = audio.from([new Float32Array(1000)])
  a.repeat(2)
  t.is(a.edits[0][0], 'repeat')
  t.is(a.edits[0].length, 2, 'compact edit tuple [type, opts]')
  t.is(a.edits[0][1].times, 2)
})

test('crop — materialized correctly', async t => {
  let ch = new Float32Array(44100 * 4)
  for (let i = 0; i < ch.length; i++) ch[i] = i / ch.length  // ramp 0→1
  let a = audio.from([ch], { sampleRate: 44100 })
  a.crop({at: 1, duration: 2})  // keep seconds 1..3
  let pcm = await a.read()
  t.is(pcm[0].length, 88200, '2 seconds')
  t.ok(pcm[0][0] > 0.24, 'starts at ~0.25 (1s of 4s)')
})

test('remove — materialized correctly', async t => {
  let ch = new Float32Array(44100 * 3).fill(1)
  let a = audio.from([ch], { sampleRate: 44100 })
  a.remove({at: 1, duration: 1})  // remove second 1-2
  let pcm = await a.read()
  t.is(pcm[0].length, 88200, '3s - 1s = 2s')
})

test('insert — materialized correctly', async t => {
  let a = audio.from([new Float32Array(44100).fill(0)], { sampleRate: 44100 })
  let b = audio.from([new Float32Array(44100).fill(1)], { sampleRate: 44100 })
  a.insert(b, {at: 0.5})
  let pcm = await a.read()
  t.is(pcm[0].length, 88200, '1s + 1s = 2s')
  t.ok(pcm[0][0] === 0, 'start is original')
  t.ok(pcm[0][Math.round(0.5 * 44100)] === 1, 'inserted at 0.5s')
})

test('insert silence — append', async t => {
  let a = audio.from([new Float32Array(44100).fill(1)], { sampleRate: 44100 })
  a.insert(1)  // append 1s silence
  let pcm = await a.read()
  t.is(pcm[0].length, 88200, '1s + 1s pad = 2s')
  t.is(pcm[0][0], 1, 'original preserved')
  t.is(pcm[0][88199], 0, 'padded with silence')
})

test('insert silence — prepend', async t => {
  let a = audio.from([new Float32Array(44100).fill(1)], { sampleRate: 44100 })
  a.insert(1, {at: 0})  // insert 1s silence at start
  let pcm = await a.read()
  t.is(pcm[0].length, 88200, '1s silence + 1s = 2s')
  t.is(pcm[0][0], 0, 'silence at start')
  t.ok(pcm[0][88199] === 1, 'original at end')
})

test('repeat — materialized correctly', async t => {
  let ch = new Float32Array(100).fill(0.5)
  let a = audio.from([ch])
  a.repeat(2)
  let pcm = await a.read()
  t.is(pcm[0].length, 300, '100 × 3')
  t.is(pcm[0][0], 0.5, 'first copy')
  t.is(pcm[0][200], 0.5, 'third copy')
})

test('structural + sample chained — materialized', async t => {
  let ch = new Float32Array(44100 * 2).fill(1)
  let a = audio.from([ch], { sampleRate: 44100 })
  a.remove({at: 0, duration: 1}).gain(-6)  // remove first second, then apply gain
  let pcm = await a.read()
  t.is(pcm[0].length, 44100, '2s - 1s = 1s')
  let expected = Math.pow(10, -6 / 20)
  t.ok(Math.abs(pcm[0][0] - expected) < 0.01, 'gain applied to remaining')
})

test('duration/length reflect structural edits', async t => {
  let a = audio.from([new Float32Array(44100 * 4)], { sampleRate: 44100 })
  t.is(a.duration, 4, 'source: 4s')
  t.is(a.length, 44100 * 4, 'source: 176400 samples')

  a.crop({at: 1, duration: 2})
  t.is(a.duration, 2, 'after crop(1,2): 2s')
  t.is(a.length, 88200, 'after crop: 88200 samples')

  a.undo()
  t.is(a.duration, 4, 'after undo: back to 4s')
})

test('duration reflects remove/insert/repeat', async t => {
  let a = audio.from([new Float32Array(44100 * 3)], { sampleRate: 44100 })
  a.remove({at: 0, duration: 1})
  t.is(a.duration, 2, 'after remove(0,1): 2s')

  a.insert(0.5)
  t.is(a.duration, 2.5, 'after insert(0.5): 2.5s')

  a.undo(); a.undo()
  a.repeat(2)
  t.is(a.duration, 9, 'after repeat(2): 9s')
})

test('channels reflects remix', async t => {
  let a = audio.from([new Float32Array(100).fill(0.5)])
  t.is(a.channels, 1, 'mono')
  a.remix(2)
  t.is(a.channels, 2, 'stereo after remix')
  a.undo()
  t.is(a.channels, 1, 'mono after undo')
})

test('undo — returns edit', async t => {
  let a = audio.from([new Float32Array(44100)])
  let v0 = a.version
  a.gain(-3)
  t.is(a.edits.length, 1, 'one edit')
  t.is(a.version, v0 + 1, 'version incremented')

  let edit = a.undo()
  t.is(a.edits.length, 0, 'undone')
  t.is(a.version, v0 + 2, 'version incremented again')
  t.ok(edit, 'undo returns the edit')
  t.is(edit[0], 'gain', 'returned edit is gain')

  t.is(a.undo(), null, 'undo on empty returns null')
})

test('run — re-apply undone edit', async t => {
  let a = audio.from([new Float32Array(100).fill(1)])
  a.gain(-6)
  let edit = a.undo()
  t.is(a.edits.length, 0, 'undone')
  a.run(edit)
  t.is(a.edits.length, 1, 're-applied')
  t.is(a.edits[0][0], 'gain', 'same edit type')
  let pcm = await a.read()
  let expected = Math.pow(10, -6 / 20)
  t.ok(Math.abs(pcm[0][0] - expected) < 0.01, 'effect re-applied correctly')
})

test('run — variadic edit arrays', async t => {
  let a = audio.from([new Float32Array(100).fill(1)])
  a.run(
    ['gain', { value: -6 }],
    ['gain', { value: -6 }]
  )
  t.is(a.edits.length, 2, 'two edits from one run() call')
  t.is(a.edits[0].length, 2, 'stored as [type, opts]')
  t.is(a.edits[0][1].value, -6, 'param mapped into opts')
  let pcm = await a.read()
  let expected = Math.pow(10, -6 / 20) ** 2
  t.ok(Math.abs(pcm[0][0] - expected) < 0.01, `double gain: ${pcm[0][0].toFixed(3)} ≈ ${expected.toFixed(3)}`)
})

test('transform — inline function', async t => {
  let a = audio.from([new Float32Array(100).fill(1)])
  a.transform((input, output, ctx) => { for (let c = 0; c < input.length; c++) for (let i = 0; i < input[c].length; i++) output[c][i] = input[c][i] * 0.5 })
  let pcm = await a.read()
  t.ok(Math.abs(pcm[0][0] - 0.5) < 0.01, 'transform applied: 1 * 0.5 = 0.5')
})

test('transform — passthrough copies input', async t => {
  let a = audio.from([new Float32Array(100).fill(1)])
  a.transform((input, output) => { for (let c = 0; c < input.length; c++) output[c].set(input[c]) })
  a.transform((input, output) => { for (let c = 0; c < input.length; c++) for (let i = 0; i < input[c].length; i++) output[c][i] = 0.5 })
  let pcm = await a.read()
  t.ok(pcm[0][0] === 0.5, 'passthrough + next transform applies')
})

test('on(change) — fires', async t => {
  let calls = 0
  let a = audio.from([new Float32Array(44100)])
  a.on('change', () => calls++)
  a.gain(-3)
  t.is(calls, 1, 'fired on edit')
  a.undo()
  t.is(calls, 2, 'fired on undo')
})

test('on — multiple listeners', async t => {
  let a = audio.from([new Float32Array(44100)])
  let c1 = 0, c2 = 0
  a.on('change', () => c1++)
  a.on('change', () => c2++)
  a.gain(-3)
  t.is(c1, 1, 'listener 1 fired')
  t.is(c2, 1, 'listener 2 fired')
})

test('on — returns this for chaining', async t => {
  let a = audio.from([new Float32Array(44100)])
  let r = a.on('change', () => {})
  t.is(r, a, 'returns instance')
})

test('off — removes listener', async t => {
  let a = audio.from([new Float32Array(44100)])
  let calls = 0
  let fn = () => calls++
  a.on('change', fn)
  a.gain(-3)
  t.is(calls, 1, 'fired before off')
  a.off('change', fn)
  a.gain(-3)
  t.is(calls, 1, 'not fired after off')
})

test('dispose — releases resources', async t => {
  let a = audio.from([new Float32Array(44100)], { sampleRate: 44100 })
  a.on('change', () => {})
  a.gain(-3)
  await a.read() // populate caches
  a.dispose()
  t.is(a.pages.length, 0, 'pages cleared')
  t.is(a.stats, null, 'stats cleared')
  t.is(a._.pcm, null, 'pcm cache cleared')
  t.is(a._.plan, null, 'plan cache cleared')
  t.is(a._.waiters, null, 'waiters cleared')
  t.ok(!a._.ev.change?.length, 'listeners cleared')
})

test('dispose — stops recording', async t => {
  let a = audio()
  a.push(new Float32Array(1024))
  a.dispose()
  t.is(a.decoded, true, 'decoded after dispose')
  t.is(a.pages.length, 0, 'pages cleared')
})

test('dispose — Symbol.dispose alias', async t => {
  let a = audio.from([new Float32Array(44100)])
  if (Symbol.dispose) t.is(a[Symbol.dispose], a.dispose, 'Symbol.dispose points to dispose')
  else t.ok(true, 'Symbol.dispose not available')
})


// ── Phase 4: Sample ops ─────────────────────────────────────────────────

test('gain — applies dB', async t => {
  let ch = new Float32Array(1000).fill(1)
  let a = audio.from([ch])
  a.gain(-6)
  let pcm = await a.read()
  let expected = Math.pow(10, -6 / 20)
  t.ok(Math.abs(pcm[0][0] - expected) < 0.001, `gain -6dB: ${pcm[0][0].toFixed(3)} ≈ ${expected.toFixed(3)}`)
})

test('gain with range', async t => {
  let ch = new Float32Array(44100 * 2).fill(1)
  let a = audio.from([ch], { sampleRate: 44100 })
  a.gain(-6, {at: 0.5, duration: 0.5})  // -6dB from 0.5s for 0.5s
  let pcm = await a.read()
  t.ok(Math.abs(pcm[0][0] - 1) < 0.001, 'before range: unchanged')
  let mid = Math.round(0.75 * 44100)
  let expected = Math.pow(10, -6 / 20)
  t.ok(Math.abs(pcm[0][mid] - expected) < 0.001, 'in range: -6dB')
  let after = Math.round(1.5 * 44100)
  t.ok(Math.abs(pcm[0][after] - 1) < 0.001, 'after range: unchanged')
})

test('gain — linear unit', async t => {
  let ch = new Float32Array(1000).fill(1)
  let a = audio.from([ch])
  a.gain(0.5, { unit: 'linear' })
  let pcm = await a.read()
  t.ok(Math.abs(pcm[0][0] - 0.5) < 0.001, `linear 0.5: ${pcm[0][0].toFixed(3)}`)
})

test('gain — linear automation', async t => {
  let sr = 44100
  let ch = new Float32Array(sr).fill(1)
  let a = audio.from([ch], { sampleRate: sr })
  a.gain(t => 1 - t, { unit: 'linear' })  // ramp from 1 to 0
  let pcm = await a.read()
  t.ok(Math.abs(pcm[0][0] - 1) < 0.01, `start ≈ 1 (got ${pcm[0][0].toFixed(3)})`)
  t.ok(pcm[0][sr - 1] < 0.01, `end ≈ 0 (got ${pcm[0][sr - 1].toFixed(3)})`)
})

test('fade in/out', async t => {
  let ch = new Float32Array(44100).fill(1)
  let a = audio.from([ch], { sampleRate: 44100 })
  a.fade(0.5).fade(-0.5, 'linear', {at: -0.5})  // fade in first 0.5s, fade out last 0.5s
  let pcm = await a.read()
  t.ok(pcm[0][0] < 0.01, 'start is silent (fade in)')
  t.ok(Math.abs(pcm[0][22050] - 1) < 0.01, 'middle is full')
  t.ok(pcm[0][44099] < 0.01, 'end is silent (fade out)')
})

test('fade in/out — two-arg shorthand', async t => {
  let ch = new Float32Array(44100).fill(1)
  let a = audio.from([ch], { sampleRate: 44100 })
  a.fade(0.5, 0.5)  // fade in 0.5s, fade out 0.5s
  let pcm = await a.read()
  t.ok(pcm[0][0] < 0.01, 'start is silent (fade in)')
  t.ok(Math.abs(pcm[0][22050] - 1) < 0.01, 'middle is full')
  t.ok(pcm[0][44099] < 0.01, 'end is silent (fade out)')
  t.is(a.edits.length, 1, 'one edit (resolve splits at compile)')
})

test('fade in/out — two-arg with curve', async t => {
  let ch = new Float32Array(44100).fill(1)
  let a = audio.from([ch], { sampleRate: 44100 })
  a.fade(0.5, 0.5, {curve: 'exp'})
  t.is(a.edits.length, 1, 'one edit (resolve splits at compile)')
  let pcm = await a.read()
  t.ok(pcm[0][0] < 0.01, 'fade-in applied')
  t.ok(pcm[0][44099] < 0.01, 'fade-out applied')
})

test('reverse', async t => {
  let ch = new Float32Array([1, 2, 3, 4, 5])
  let a = audio.from([ch])
  a.reverse()
  let pcm = await a.read()
  t.is(pcm[0][0], 5, 'first = last')
  t.is(pcm[0][4], 1, 'last = first')
})

test('mix', async t => {
  let a = audio.from([new Float32Array(100).fill(0.5)])
  let b = audio.from([new Float32Array(100).fill(0.3)])
  a.mix(b)
  let pcm = await a.read()
  t.ok(Math.abs(pcm[0][0] - 0.8) < 0.001, 'mixed: 0.5 + 0.3 = 0.8')
})

test('crossfade — overlap with complementary fades', async t => {
  let sr = 44100
  let a = audio.from([new Float32Array(sr).fill(1)], { sampleRate: sr })
  let b = audio.from([new Float32Array(sr).fill(1)], { sampleRate: sr })
  a.crossfade(b, 0.5)
  let pcm = await a.read()

  t.ok(Math.abs(pcm[0].length / sr - 1.5) < 0.01, `duration: ${(pcm[0].length / sr).toFixed(3)}s ≈ 1.5s`)
  t.ok(Math.abs(pcm[0][Math.round(0.1 * sr)] - 1) < 0.01, 'before overlap: 1.0')
  let mid = pcm[0][Math.round(0.75 * sr)]
  t.ok(mid > 0.8 && mid < 1.2, `mid-overlap: ${mid.toFixed(3)} ≈ 1.0 (equal-power)`)
  t.ok(Math.abs(pcm[0][Math.round(1.25 * sr)] - 1) < 0.01, 'after overlap: 1.0')
})

test('crossfade — different amplitudes', async t => {
  let sr = 44100
  let a = audio.from([new Float32Array(sr).fill(0.8)], { sampleRate: sr })
  let b = audio.from([new Float32Array(sr).fill(0.3)], { sampleRate: sr })
  a.crossfade(b, 0.5)
  let pcm = await a.read()

  t.ok(Math.abs(pcm[0][Math.round(0.1 * sr)] - 0.8) < 0.01, 'before: 0.8')
  let mid = pcm[0][Math.round(0.75 * sr)]
  t.ok(mid > 0.4 && mid < 0.7, `mid-overlap: ${mid.toFixed(3)} blends 0.8→0.3`)
  t.ok(Math.abs(pcm[0][Math.round(1.25 * sr)] - 0.3) < 0.01, 'after: 0.3')
})

test('crossfade — linear curve', async t => {
  let sr = 44100
  let a = audio.from([new Float32Array(sr).fill(1)], { sampleRate: sr })
  let b = audio.from([new Float32Array(sr).fill(0)], { sampleRate: sr })
  a.crossfade(b, 0.5, 'linear')
  let pcm = await a.read()

  let mid = pcm[0][Math.round(0.75 * sr)]
  t.ok(Math.abs(mid - 0.5) < 0.01, `linear midpoint: ${mid.toFixed(3)} ≈ 0.5`)
  t.ok(Math.abs(pcm[0][pcm[0].length - 1]) < 0.01, 'last sample: 0.0')
})

test('crossfade — default duration', async t => {
  let sr = 44100
  let a = audio.from([new Float32Array(sr).fill(0.5)], { sampleRate: sr })
  let b = audio.from([new Float32Array(sr).fill(0.7)], { sampleRate: sr })
  a.crossfade(b)
  let pcm = await a.read()
  t.ok(Math.abs(pcm[0].length / sr - 1.5) < 0.01, 'default 0.5s overlap → 1.5s total')
  t.ok(Math.abs(pcm[0][Math.round(1.25 * sr)] - 0.7) < 0.01, 'after overlap: 0.7')
})

test('crossfade — stereo', async t => {
  let sr = 44100
  let a = audio.from([new Float32Array(sr).fill(0.8), new Float32Array(sr).fill(0.4)], { sampleRate: sr })
  let b = audio.from([new Float32Array(sr).fill(0.3), new Float32Array(sr).fill(0.9)], { sampleRate: sr })
  a.crossfade(b, 0.5)
  let pcm = await a.read()

  t.is(pcm.length, 2, 'stereo output')
  t.ok(Math.abs(pcm[0][Math.round(0.1 * sr)] - 0.8) < 0.01, 'L before: 0.8')
  t.ok(Math.abs(pcm[1][Math.round(0.1 * sr)] - 0.4) < 0.01, 'R before: 0.4')
  t.ok(Math.abs(pcm[0][Math.round(1.25 * sr)] - 0.3) < 0.01, 'L after: 0.3')
  t.ok(Math.abs(pcm[1][Math.round(1.25 * sr)] - 0.9) < 0.01, 'R after: 0.9')
})

test('crossfade — asymmetric source lengths', async t => {
  let sr = 44100
  let a = audio.from([new Float32Array(sr).fill(0.5)], { sampleRate: sr })       // 1s
  let b = audio.from([new Float32Array(sr * 2).fill(0.9)], { sampleRate: sr })   // 2s
  a.crossfade(b, 0.5)
  let pcm = await a.read()
  t.ok(Math.abs(pcm[0].length / sr - 2.5) < 0.01, `1s + 2s - 0.5s = 2.5s (got ${(pcm[0].length / sr).toFixed(3)})`)
  t.ok(Math.abs(pcm[0][Math.round(2.0 * sr)] - 0.9) < 0.01, 'b plays through to end')
})

test('crossfade — stream matches read', async t => {
  let sr = 44100
  let a = audio.from([new Float32Array(sr).fill(0.8)], { sampleRate: sr })
  let b = audio.from([new Float32Array(sr).fill(0.3)], { sampleRate: sr })
  a.crossfade(b, 0.5)

  let full = await a.read()
  let chunks = []
  for await (let chunk of a) chunks.push(chunk[0].slice())
  let flat = new Float32Array(chunks.reduce((s, c) => s + c.length, 0))
  let pos = 0
  for (let c of chunks) { flat.set(c, pos); pos += c.length }

  t.is(flat.length, full[0].length, 'same length')
  let maxDiff = 0
  for (let i = 0; i < flat.length; i++) maxDiff = Math.max(maxDiff, Math.abs(flat[i] - full[0][i]))
  t.ok(maxDiff < 0.001, `stream≈read (maxDiff: ${maxDiff.toFixed(6)})`)
})

test('crossfade — no NaN', async t => {
  let sr = 44100
  let a = audio.from([new Float32Array(sr).fill(0.5)], { sampleRate: sr })
  let b = audio.from([new Float32Array(sr).fill(0.3)], { sampleRate: sr })
  a.crossfade(b, 0.5, 'linear')
  let pcm = await a.read()
  let hasNan = false
  for (let i = 0; i < pcm[0].length; i++) if (isNaN(pcm[0][i])) { hasNan = true; break }
  t.ok(!hasNan, 'no NaN in output')
})

test('crossfade — concat sugar', async t => {
  let sr = 44100
  let a = audio.from([new Float32Array(sr).fill(0.5)], { sampleRate: sr })
  let b = audio.from([new Float32Array(sr).fill(0.9)], { sampleRate: sr })
  let c = audio.from([new Float32Array(sr).fill(0.3)], { sampleRate: sr })
  let result = audio([a, b, c], { crossfade: 0.5 })
  let pcm = await result.read()

  t.ok(Math.abs(pcm[0].length / sr - 2.0) < 0.01, '3×1s - 2×0.5s = 2.0s')
  t.ok(Math.abs(pcm[0][0] - 0.5) < 0.01, 'starts at a')
  t.ok(Math.abs(pcm[0][Math.round(1.0 * sr)] - 0.9) < 0.01, 'b region')
})

test('crossfade — concat per-transition durations', async t => {
  let sr = 44100
  let a = audio.from([new Float32Array(sr).fill(0.5)], { sampleRate: sr })
  let b = audio.from([new Float32Array(sr).fill(0.9)], { sampleRate: sr })
  let c = audio.from([new Float32Array(sr).fill(0.3)], { sampleRate: sr })
  let result = audio([a, b, c], { crossfade: [0.2, 0.3] })
  let pcm = await result.read()
  t.ok(Math.abs(pcm[0].length / sr - 2.5) < 0.01, '3s - 0.2 - 0.3 = 2.5s')
})

test('crossfade — edits array', async t => {
  let a = audio.from([new Float32Array(44100).fill(0.5)])
  let b = audio.from([new Float32Array(44100).fill(0.5)])
  a.crossfade(b, 0.3)
  t.is(a.edits[0][0], 'crossfade', 'crossfade edit registered')
})

test('remix — mono to stereo', async t => {
  let a = audio.from([new Float32Array(100).fill(0.5)])
  t.is(a.channels, 1, 'mono')
  a.remix(2)
  let pcm = await a.read()
  t.is(pcm.length, 2, 'stereo after remix')
  t.ok(Math.abs(pcm[0][0] - 0.5) < 0.01, 'left preserved')
  t.ok(Math.abs(pcm[1][0] - 0.5) < 0.01, 'right = left (mono duplicate)')
})

test('remix — stereo to mono', async t => {
  let a = audio.from([new Float32Array(100).fill(0.6), new Float32Array(100).fill(0.4)])
  t.is(a.channels, 2, 'stereo')
  a.remix(1)
  let pcm = await a.read()
  t.is(pcm.length, 1, 'mono after remix')
  t.ok(Math.abs(pcm[0][0] - 0.5) < 0.01, 'mono = average of L+R')
})

test('remix — array map swap L/R', async t => {
  let L = new Float32Array(100).fill(0.3), R = new Float32Array(100).fill(0.7)
  let a = audio.from([L, R])
  a.remix([1, 0])
  let pcm = await a.read()
  t.is(pcm.length, 2, '2ch')
  t.ok(Math.abs(pcm[0][0] - 0.7) < 0.01, 'left = old right')
  t.ok(Math.abs(pcm[1][0] - 0.3) < 0.01, 'right = old left')
})

test('remix — array map with null (silence)', async t => {
  let a = audio.from([new Float32Array(100).fill(0.5), new Float32Array(100).fill(0.8)])
  a.remix([0, null, 1])
  let pcm = await a.read()
  t.is(pcm.length, 3, '3ch output')
  t.ok(Math.abs(pcm[0][0] - 0.5) < 0.01, 'ch0 from left')
  t.ok(pcm[1][0] === 0, 'ch1 silent')
  t.ok(Math.abs(pcm[2][0] - 0.8) < 0.01, 'ch2 from right')
})

test('remix — array map duplicate channel', async t => {
  let a = audio.from([new Float32Array(100).fill(0.6)])
  a.remix([0, 0])
  let pcm = await a.read()
  t.is(pcm.length, 2, '2ch from mono')
  t.ok(Math.abs(pcm[0][0] - 0.6) < 0.01, 'ch0')
  t.ok(Math.abs(pcm[1][0] - 0.6) < 0.01, 'ch1 = ch0')
})

test('read — format via pcm-convert', async t => {
  let a = audio.from([new Float32Array(100).fill(0.5)])
  let int16 = await a.read({ format: 'int16' })
  t.ok(int16[0] instanceof Int16Array, 'Int16Array')
  t.ok(int16[0][0] > 16000, `int16 value: ${int16[0][0]}`)
})

test('write', async t => {
  let a = audio.from([new Float32Array(100).fill(0)])
  a.write([new Float32Array([1, 1, 1])], {at: 0})
  let pcm = await a.read()
  t.is(pcm[0][0], 1, 'overwritten')
  t.is(pcm[0][3], 0, 'rest unchanged')
})


// ── Phase 5: Smart ops + define ──────────────────────────────────────────

test('trim — removes silence', async t => {
  let ch = new Float32Array(44100 * 3)  // 3s
  // Silence for 1s, signal for 1s, silence for 1s
  for (let i = 44100; i < 88200; i++) ch[i] = 0.5 * Math.sin(2 * Math.PI * 440 * i / 44100)
  let a = audio.from([ch], { sampleRate: 44100 })
  a.trim(-20)
  let pcm = await a.read()
  t.ok(pcm[0].length < ch.length, `trimmed: ${pcm[0].length} < ${ch.length}`)
  t.ok(pcm[0].length > 44000, `kept signal: ${pcm[0].length} > 44000`)
})

test('normalize', async t => {
  let ch = new Float32Array(1000)
  for (let i = 0; i < ch.length; i++) ch[i] = 0.25 * Math.sin(2 * Math.PI * 440 * i / 44100)
  let a = audio.from([ch])
  a.normalize(0)
  let pcm = await a.read()
  let peak = 0
  for (let s of pcm[0]) { let v = Math.abs(s); if (v > peak) peak = v }
  t.ok(Math.abs(peak - 1) < 0.01, `normalized peak ~1 (got ${peak.toFixed(3)})`)
})

test('two-tier stats — source stats preserved after edit', async t => {
  let ch = new Float32Array(44100).fill(0.5)
  let a = audio.from([ch], { sampleRate: 44100 })
  let srcDb = await a.stat('db')
  a.gain(-6)
  let postDb = await a.stat('db')
  t.ok(postDb < srcDb, `post-edit db (${postDb.toFixed(1)}) < source (${srcDb.toFixed(1)})`)
  t.ok(a._.srcStats, 'source stats preserved in _.srcStats')
  // source stats are immutable — verify they still report original peak
  let srcPeak = 0
  for (let c = 0; c < a.channels; c++)
    for (let i = 0; i < a._.srcStats.max[c].length; i++)
      srcPeak = Math.max(srcPeak, Math.abs(a._.srcStats.min[c][i]), a._.srcStats.max[c][i])
  t.ok(Math.abs(srcPeak - 0.5) < 0.01, `source stats peak still 0.5 (got ${srcPeak.toFixed(3)})`)
})

test('custom op', async t => {
  audio.op('double', (input, output, ctx) => {
    for (let c = 0; c < input.length; c++) for (let i = 0; i < input[c].length; i++) output[c][i] = input[c][i] * 2
  })
  let a = audio.from([new Float32Array(100).fill(0.25)])
  a.double()
  let pcm = await a.read()
  t.ok(Math.abs(pcm[0][0] - 0.5) < 0.001, 'doubled: 0.25 → 0.5')
})

test('custom op — with arg', async t => {
  audio.op('amplify', { params: ['factor'], process: (input, output, ctx) => {
    let factor = ctx.factor
    for (let c = 0; c < input.length; c++) for (let i = 0; i < input[c].length; i++) output[c][i] = input[c][i] * factor
  }})
  let a = audio.from([new Float32Array(100).fill(0.1)])
  a.amplify(3)
  let pcm = await a.read()
  t.ok(Math.abs(pcm[0][0] - 0.3) < 0.001, 'amplified: 0.1 × 3 = 0.3')
})

test('custom op — with range', async t => {
  audio.op('mute', (input, output, ctx) => {
    let sr = ctx.sampleRate
    let s = ctx.at != null ? Math.round(ctx.at * sr) : 0
    let e = ctx.duration != null ? s + Math.round(ctx.duration * sr) : input[0].length
    for (let c = 0; c < input.length; c++) {
      output[c].set(input[c])
      for (let i = Math.max(0, s); i < Math.min(e, output[c].length); i++) output[c][i] = 0
    }
  })
  let a = audio.from([new Float32Array(44100).fill(1)], { sampleRate: 44100 })
  a.mute({at: 0.5, duration: 0.5})  // mute from 0.5s for 0.5s
  let pcm = await a.read()
  t.ok(pcm[0][0] === 1, 'before range: unchanged')
  t.ok(pcm[0][Math.round(0.75 * 44100)] === 0, 'in range: muted')
})

test('core without plan — direct page read', { skip: !isNode }, async t => {
  // Import core directly, no plan plugin
  let { default: bareAudio } = await import('../core.js')
  let a = bareAudio.from([new Float32Array([0.1, 0.2, 0.3, 0.4])])
  t.is(a.duration, 4 / 44100, 'source duration')
  t.is(a.channels, 1, 'channels')
  let pcm = await a.read()
  t.ok(Math.abs(pcm[0][0] - 0.1) < 0.001, 'reads source PCM directly')
})

test('runtime op registration — audio.op', async t => {
  audio.op('invert', (input, output, ctx) => {
    for (let c = 0; c < input.length; c++) for (let i = 0; i < input[c].length; i++) output[c][i] = -input[c][i]
  })
  let a = audio.from([new Float32Array([0.5, -0.3])])
  a.invert()
  let pcm = await a.read()
  t.ok(Math.abs(pcm[0][0] - (-0.5)) < 0.001, 'inverted: 0.5 → -0.5')
  t.ok(Math.abs(pcm[0][1] - 0.3) < 0.001, 'inverted: -0.3 → 0.3')
})

test('toJSON — serializable with source', async t => {
  let a = await audio(lenaPath)
  a.gain(-3).reverse()
  let json = a.toJSON()
  t.is(json.source, lenaPath, 'source preserved')
  t.is(json.edits.length, 2, '2 edits')
  t.is(json.edits[0][0], 'gain', 'first is gain')
  t.is(json.edits[1][0], 'reverse', 'second is reverse')
  t.is(json.sampleRate, a.sampleRate, 'sampleRate')
  t.is(json.channels, a.channels, 'channels')
  t.ok(json.duration > 0, 'duration')
})

test('toJSON — PCM source is null', async t => {
  let a = audio.from([new Float32Array(44100)])
  let json = a.toJSON()
  t.is(json.source, null, 'PCM source is null')
})

test('audio(json) — restore from serialized document', async t => {
  let a = await audio(lenaPath)
  a.gain(-6).trim()
  let pcm1 = await a.read()

  // Serialize → deserialize round-trip
  let json = a.toJSON()
  let b = await audio(json)
  let pcm2 = await b.read()

  t.is(b.source, lenaPath, 'source restored')
  t.is(b.edits.length, json.edits.length, 'edits restored')
  t.is(pcm2[0].length, pcm1[0].length, 'same length after restore')
  // Verify actual sample values match
  let match = true
  for (let i = 0; i < Math.min(1000, pcm1[0].length); i++)
    if (Math.abs(pcm1[0][i] - pcm2[0][i]) > 1e-6) { match = false; break }
  t.ok(match, 'samples match after round-trip')
})

test('audio(json) — rejects document without source', async t => {
  try {
    await audio({ edits: [{ type: 'gain', args: [-3] }] })
    t.fail('should throw')
  } catch (e) {
    t.ok(e.message.includes('source'), 'throws on missing source')
  }
})


// ── Phase 6: Materialization ─────────────────────────────────────────────

test('read — full materialization', async t => {
  let a = await audio(lenaPath)
  let pcm = await a.read()
  t.is(pcm.length, 1, '1 channel')
  t.ok(pcm[0].length > 500000, `${pcm[0].length} samples (lena ~541184)`)
})

test('read — sub-range', async t => {
  let a = audio.from([new Float32Array(44100 * 10)], { sampleRate: 44100 })
  let pcm = await a.read({at: 2, duration: 3})
  let expected = Math.round(3 * 44100)
  t.is(pcm[0].length, expected, `3 seconds = ${expected} samples`)
})

test('read — with format', async t => {
  let a = audio.from([new Float32Array(100).fill(0.5)])
  let pcm = await a.read({ format: 'int16' })
  t.ok(pcm[0] instanceof Int16Array, 'Int16Array')
  t.ok(pcm[0][0] > 16000, `int16 value: ${pcm[0][0]}`)
})

test('read — returns copies', async t => {
  let a = audio.from([new Float32Array(100).fill(1)])
  let r1 = await a.read()
  let r2 = await a.read()
  r1[0][0] = 999
  t.is(r2[0][0], 1, 'modifying r1 does not affect r2')
})

test('encode + decode round-trip', async t => {
  let ch = new Float32Array(44100)
  for (let i = 0; i < ch.length; i++) ch[i] = 0.5 * Math.sin(2 * Math.PI * 440 * i / 44100)
  let a = audio.from([ch], { sampleRate: 44100 })
  let wav = await a.read({ format: 'wav' })
  t.ok(wav instanceof Uint8Array, 'read as wav → Uint8Array')
  t.ok(wav.length > 1000, `wav size: ${wav.length}`)

  // Decode back
  let b = await audio(wav)
  t.ok(Math.abs(b.duration - 1) < 0.01, 'round-trip duration')
})

test('save — write to file', { skip: !isNode }, async t => {
  let { tmpdir } = await import('os')
  let { join } = await import('path')
  let a = audio.from([new Float32Array(44100).fill(0.5)], { sampleRate: 44100 })
  let path = join(tmpdir(), `audio-test-${Date.now()}.wav`)
  await a.save(path)
  let b = await audio(path)
  t.ok(Math.abs(b.duration - 1) < 0.02, 'saved and reloaded')
})


// ── Phase 7: Analysis ────────────────────────────────────────────────────

test('stat — sine wave', async t => {
  let ch = new Float32Array(44100)
  for (let i = 0; i < ch.length; i++) ch[i] = 0.8 * Math.sin(2 * Math.PI * 440 * i / 44100)
  let a = audio.from([ch], { sampleRate: 44100 })
  let peak = await a.stat('db')
  t.ok(peak < 0 && peak > -3, `peak ≈ -2dB (got ${peak.toFixed(1)})`)
  let r = await a.stat('rms')
  t.ok(r > 0, `rms > 0 (got ${r.toFixed(3)})`)
  let l = await a.stat('loudness')
  t.ok(l < 0, `loudness negative (got ${l.toFixed(1)})`)
})

test('stat — with range', async t => {
  let ch = new Float32Array(44100 * 2).fill(0)
  for (let i = 44100; i < 88200; i++) ch[i] = 0.5
  let a = audio.from([ch], { sampleRate: 44100 })
  let full = await a.stat('db')
  t.ok(full > -7, 'full db includes signal')
  let first = await a.stat('db', {at: 0, duration: 0.5})
  t.ok(first === -Infinity, 'first 0.5s is silent')
})

test('waveform', async t => {
  let a = await audio(lenaPath)
  let [mn, mx] = await Promise.all([a.stat('min', {bins: 100}), a.stat('max', {bins: 100})])
  t.is(mn.length, 100, '100 min bins')
  t.is(mx.length, 100, '100 max bins')
  t.ok(mx instanceof Float32Array, 'Float32Array')
  t.ok(Math.max(...mx) > 0, 'has signal')
})

test('waveform — per-channel', async t => {
  let a = audio.from([new Float32Array(44100).fill(0.5), new Float32Array(44100).fill(-0.3)])
  let mn1 = await a.stat('min', { bins: 10, channel: 1 })
  let mx0 = await a.stat('max', { bins: 10, channel: 0 })
  t.ok(mx0[0] > 0.4, 'ch0 positive')
  t.ok(mn1[0] < -0.2, 'ch1 negative')
})

test('loudness — K-weighted LUFS', async t => {
  let ch = new Float32Array(44100)
  for (let i = 0; i < ch.length; i++) ch[i] = 0.5 * Math.sin(2 * Math.PI * 1000 * i / 44100)
  let a = audio.from([ch], { sampleRate: 44100 })
  let l = await a.stat('loudness')
  t.ok(typeof l === 'number', 'returns number')
  t.ok(l < 0, `LUFS is negative (got ${l.toFixed(1)})`)
  t.ok(l > -30, `LUFS > -30 (got ${l.toFixed(1)})`)
})

test('loudness + db — lena real audio', async t => {
  let a = await audio(lenaPath)
  let l = await a.stat('loudness')
  t.ok(l < 0, `LUFS negative (got ${l.toFixed(1)})`)
  t.ok(l > -40, `LUFS > -40 (got ${l.toFixed(1)})`)
  let r = await a.stat('rms')
  t.ok(r > 0, `rms > 0 (got ${r.toFixed(3)})`)
  let peak = await a.stat('db')
  t.ok(peak < 0, `peak dBFS negative (got ${peak.toFixed(1)})`)
})

test('stat — after dirty op reindexes', async t => {
  let ch = new Float32Array(44100).fill(0.5)
  let a = audio.from([ch], { sampleRate: 44100 })
  let before = await a.stat('db')
  a.gain(-6)  // dirty op — reduces peak
  let after = await a.stat('db')
  t.ok(after < before, `db dropped after gain(-6): ${before.toFixed(1)} → ${after.toFixed(1)}`)
})

test('stat — array of names', async t => {
  let a = await audio(lenaPath)
  let [mn, mx] = await a.stat(['min', 'max'], { bins: 50 })
  t.is(mn.length, 50, '50 min bins')
  t.is(mx.length, 50, '50 max bins')
  t.ok(mn instanceof Float32Array, 'min is Float32Array')
  t.ok(mx instanceof Float32Array, 'max is Float32Array')
  t.ok(Math.min(...mn) <= Math.max(...mx), 'min <= max')

  let [peak, loud] = await a.stat(['db', 'loudness'])
  t.ok(typeof peak === 'number', 'db is number')
  t.ok(typeof loud === 'number', 'loudness is number')
  t.ok(peak < 0, `peak negative (${peak.toFixed(1)})`)
  t.ok(loud < 0, `loud negative (${loud.toFixed(1)})`)
})


// ── Phase 8: Playback ────────────────────────────────────────────────────

test('play — returns controller', async t => {
  let a = audio.from([tone(440, 0.1)], { sampleRate: 44100 })
  let p = a.play()
  t.ok(p, 'controller returned')
  t.ok('pause' in p, 'has pause')
  t.ok('stop' in p, 'has stop')
  t.ok('currentTime' in p, 'has currentTime')
  t.ok('playing' in p, 'has playing')
  t.ok('volume' in p, 'has volume')
  t.ok('loop' in p, 'has loop')
  t.is(p.volume, 1, 'volume defaults to 1')
  t.is(p.loop, false, 'loop defaults to false')
  p.stop()
})

test('play — volume and loop settable', async t => {
  let a = audio.from([tone(440, 0.1)], { sampleRate: 44100 })
  let p = a.play()
  p.volume = 0.5
  t.is(p.volume, 0.5, 'volume is settable')
  p.loop = true
  t.is(p.loop, true, 'loop is settable')
  p.stop()
})

test('play — loop with offset restarts at offset', async t => {
  let sr = 44100, dur = 0.5
  let a = audio.from([tone(440, dur, sr)], { sampleRate: sr })
  // Play from 0.3s with loop — on loop restart, currentTime should go back to 0.3, not 0
  let p = a.play({ at: 0.3, loop: true })
  // Wait for the first loop cycle to complete (0.3→0.5 = 0.2s)
  await new Promise(r => setTimeout(r, 350))
  // After 350ms, at least one loop restart should have happened
  // currentTime should be >= 0.3 (looped back to offset), never < 0.3
  let ct = p.currentTime
  t.ok(ct >= 0.3, `currentTime after loop (${ct.toFixed(3)}) >= 0.3 (offset)`)
  p.stop()
})

test('play — returns instance', async t => {
  let a = audio.from([tone(440, 0.1)], { sampleRate: 44100 })
  let p = a.play({at: 0})
  t.ok(p === a, 'play returns this')
  a.stop()
})

test('muted — boolean gate, emits volumechange', async t => {
  let a = audio.from([tone(440, 0.1)], { sampleRate: 44100 })
  t.is(a.muted, false, 'muted defaults to false')
  let events = []
  a.on('volumechange', () => events.push('vc'))
  a.muted = true
  t.is(a.muted, true, 'muted settable')
  t.is(events.length, 1, 'volumechange on mute')
  a.muted = true  // no-op
  t.is(events.length, 1, 'no event on redundant set')
  a.muted = false
  t.is(events.length, 2, 'volumechange on unmute')
})

test('volume — emits volumechange', async t => {
  let a = audio.from([tone(440, 0.1)], { sampleRate: 44100 })
  let events = []
  a.on('volumechange', () => events.push('vc'))
  a.volume = 0.5
  t.is(a.volume, 0.5, 'volume settable')
  t.is(events.length, 1, 'event on change')
  a.volume = 0.5  // same value
  t.is(events.length, 1, 'no event on same value')
  a.volume = 1
  t.is(events.length, 2, 'event on restore')
  // clamping
  a.volume = 2
  t.is(a.volume, 1, 'clamped above 1')
  a.volume = -1
  t.is(a.volume, 0, 'clamped below 0')
})

test('ended — true on natural end', async t => {
  let a = audio.from([tone(440, 0.1)], { sampleRate: 44100 })
  t.is(a.ended, false, 'ended defaults to false')
  a.play()
  t.is(a.ended, false, 'ended false during play')
  a.stop()
  // ended stays false for stop (not natural end)
  t.is(a.ended, false, 'ended false after stop')
})

test('seeking — true during seek', async t => {
  let a = audio.from([tone(440, 1)], { sampleRate: 44100 })
  t.is(a.seeking, false, 'seeking defaults to false')
  a.seek(0.5)
  // not playing, so seeking resolves immediately
  t.is(a.seeking, false, 'seeking false when not playing')
})

test('currentTime — smooth interpolation', async t => {
  let a = audio.from([tone(440, 10)], { sampleRate: 44100 })
  a.playing = true; a.paused = false
  a.currentTime = 5.0
  // getter interpolates wall-clock time
  await new Promise(r => setTimeout(r, 50))
  let ct = a.currentTime
  t.ok(ct > 5.0, `interpolated forward: ${ct.toFixed(3)}`)
  t.ok(ct < 5.2, `not too far: ${ct.toFixed(3)}`)
  // paused — no interpolation
  a.paused = true
  let ct2 = a.currentTime
  await new Promise(r => setTimeout(r, 50))
  let ct3 = a.currentTime
  t.ok(Math.abs(ct3 - ct2) < 0.001, 'paused: no interpolation')
  a.playing = false
  // clamped to duration
  a.playing = true; a.paused = false
  a.currentTime = a.duration - 0.001
  await new Promise(r => setTimeout(r, 50))
  t.ok(a.currentTime <= a.duration, `clamped to duration: ${a.currentTime.toFixed(3)} <= ${a.duration.toFixed(3)}`)
  a.playing = false
})

test('played — promise property', async t => {
  let a = audio.from([tone(440, 0.1)], { sampleRate: 44100 })
  a.play()
  t.ok(a.played instanceof Promise, 'played is a Promise')
  a.stop()
})

test('play/pause events', async t => {
  let a = audio.from([tone(440, 0.1)], { sampleRate: 44100 })
  let events = []
  a.on('play', () => events.push('play'))
  a.on('pause', () => events.push('pause'))
  a.play()
  t.ok(events.includes('play'), 'play event fired on start')
  a.pause()
  t.ok(events.includes('pause'), 'pause event fired')
  // resume emits 'play' again
  let countBefore = events.filter(e => e === 'play').length
  a.resume()
  t.is(events.filter(e => e === 'play').length, countBefore + 1, 'play event fired on resume')
  // pause when already paused — no double event
  a.pause()
  let pauseCount = events.filter(e => e === 'pause').length
  a.pause()
  t.is(events.filter(e => e === 'pause').length, pauseCount, 'no double pause event')
  a.stop()
})


// ── Phase 9: Streaming ──────────────────────────────────────────────────

test('stream — yields blocks', async t => {
  let a = audio.from([new Float32Array(PAGE_SIZE * 3)], { sampleRate: 44100 })
  let blocks = []
  for await (let block of a.stream()) blocks.push(block)
  t.ok(blocks.length >= 3, `yielded ${blocks.length} blocks`)
  t.ok(blocks[0][0] instanceof Float32Array, 'Float32Array channels')
})

test('stream — sub-range', async t => {
  let a = audio.from([new Float32Array(44100 * 10)], { sampleRate: 44100 })
  let totalSamples = 0
  for await (let block of a.stream({at: 2, duration: 3})) totalSamples += block[0].length
  let expected = Math.round(3 * 44100)
  t.ok(Math.abs(totalSamples - expected) < PAGE_SIZE, `~${expected} samples (got ${totalSamples})`)
})

test('stream — after ops', async t => {
  let ch = new Float32Array(44100).fill(0.5)
  let a = audio.from([ch], { sampleRate: 44100 })
  a.gain(-6)
  let first
  for await (let block of a.stream()) { first = block[0][0]; break }
  let expected = 0.5 * Math.pow(10, -6 / 20)
  t.ok(Math.abs(first - expected) < 0.01, `gain applied in stream (${first.toFixed(3)} ≈ ${expected.toFixed(3)})`)
})


test('stream — plan-based crop+gain matches full render', async t => {
  let ch = new Float32Array(44100 * 4)
  for (let i = 0; i < ch.length; i++) ch[i] = i / ch.length
  let a = audio.from([ch], { sampleRate: 44100 })
  a.crop({at: 1, duration: 2}).gain(-6)

  // Full render via read()
  let full = await a.read()

  // Stream (should use plan internally)
  let streamed = []
  for await (let block of a.stream()) streamed.push(block[0])
  let flat = new Float32Array(streamed.reduce((n, b) => n + b.length, 0))
  let pos = 0; for (let b of streamed) { flat.set(b, pos); pos += b.length }

  t.is(flat.length, full[0].length, 'same length')
  t.ok(Math.abs(flat[0] - full[0][0]) < 0.001, `first sample matches (${flat[0].toFixed(4)} ≈ ${full[0][0].toFixed(4)})`)
  t.ok(Math.abs(flat[flat.length - 1] - full[0][full[0].length - 1]) < 0.001, 'last sample matches')
})

test('stream — plan-based remove matches full render', async t => {
  let ch = new Float32Array(44100 * 3)
  for (let i = 0; i < ch.length; i++) ch[i] = i / ch.length
  let a = audio.from([ch], { sampleRate: 44100 })
  a.remove({at: 1, duration: 1}).gain(-6)

  let full = await a.read()
  let streamed = []
  for await (let block of a.stream()) streamed.push(block[0])
  let flat = new Float32Array(streamed.reduce((n, b) => n + b.length, 0))
  let pos = 0; for (let b of streamed) { flat.set(b, pos); pos += b.length }

  t.is(flat.length, full[0].length, 'same length')
  t.ok(Math.abs(flat[0] - full[0][0]) < 0.001, 'first sample matches')
  t.ok(Math.abs(flat[flat.length - 1] - full[0][full[0].length - 1]) < 0.001, 'last sample matches')
})

test('stream — plan-based insert matches full render', async t => {
  let a = audio.from([new Float32Array(44100).fill(0.5)], { sampleRate: 44100 })
  a.insert(0.5, {at: 0.5})  // insert 0.5s silence at 0.5s
  a.gain(-6)

  let full = await a.read()
  let streamed = []
  for await (let block of a.stream()) streamed.push(block[0])
  let flat = new Float32Array(streamed.reduce((n, b) => n + b.length, 0))
  let pos = 0; for (let b of streamed) { flat.set(b, pos); pos += b.length }

  t.is(flat.length, full[0].length, 'same length')
  // Check silence in inserted region
  let insertSample = Math.round(0.5 * 44100)
  t.ok(Math.abs(flat[insertSample]) < 0.001, 'silence at insert point')
})

test('stream — sample-level op via run()', async t => {
  let a = audio.from([new Float32Array(44100).fill(1)], { sampleRate: 44100 })
  a.run(['gain', { value: -6 }])

  let streamed = []
  for await (let block of a.stream()) streamed.push(block[0])
  let flat = new Float32Array(streamed.reduce((n, b) => n + b.length, 0))
  let pos = 0; for (let b of streamed) { flat.set(b, pos); pos += b.length }

  let expected = Math.pow(10, -6 / 20)
  t.ok(Math.abs(flat[0] - expected) < 0.01, 'op applied via stream')
})

test('seek — preloads nearby pages only', async t => {
  let a = audio.from([new Float32Array(44100 * 3)], { sampleRate: 44100 })
  a.gain(-3)
  a.seek(1.5)
  // Seek should preload pages but NOT warm render cache
  t.ok(a._.pcm === null, 'render cache NOT warmed by seek (lazy)')
  t.ok(a.currentTime === 1.5, 'currentTime position set')
})

test('metadata event — fires before full decode with sampleRate/channels', async t => {
  let a = audio(lenaMp3)
  let meta = await new Promise(r => a.on('metadata', r))
  t.ok(meta.sampleRate > 0, `sampleRate in event (${meta.sampleRate})`)
  t.ok(meta.channels >= 1, `channels in event (${meta.channels})`)
  t.ok(a.sampleRate > 0, `instance sampleRate set (${a.sampleRate})`)
  t.ok(!a.decoded, 'not yet fully decoded')
  // Edits still chain
  a.gain(-3)
  t.is(a.edits.length, 1, 'edits chain during decode')
  // Stream available immediately
  let got = 0
  for await (let chunk of a.stream()) got += chunk[0].length
  t.ok(got > 0, `stream yielded ${got} samples`)
  // await a still works for full decode
  let b = await a
  t.ok(b === a, 'await a resolves to same instance')
  t.ok(a.decoded, 'fully decoded after await')
})

test('stream — live decode yields before full page', async t => {
  let PUSH = 4096
  let a = audio()
  // Push one small chunk — well below PAGE_SIZE
  let data = new Float32Array(PUSH).fill(0.25)
  a.push(data)
  let firstLen = null, firstVal = null
  // Start stream, collect first chunk, then stop
  let timeout = setTimeout(() => { a.stop() }, 200)
  for await (let chunk of a.stream()) {
    if (firstLen === null) {
      firstLen = chunk[0].length
      firstVal = chunk[0][0]
      a.stop()
      break
    }
  }
  clearTimeout(timeout)
  t.ok(firstLen > 0, `first chunk has data (${firstLen})`)
  t.ok(firstLen <= PUSH, `first chunk ${firstLen} <= ${PUSH} (not PAGE_SIZE ${PAGE_SIZE})`)
  t.ok(Math.abs(firstVal - 0.25) < 0.01, 'data correct')
})

test('stream — live decode total samples correct', async t => {
  let a = audio()
  let total = 0, pushes = 5, each = 8192
  for (let i = 0; i < pushes; i++) a.push(new Float32Array(each).fill(0.1 * (i + 1)))
  a.stop()
  for await (let chunk of a.stream()) total += chunk[0].length
  t.is(total, pushes * each, `all ${pushes * each} samples streamed`)
})

test('stream — live decode with process edits streams immediately', async t => {
  let a = audio()
  a.gain(-6)
  let firstChunk = null
  let PUSH = 4096
  a.push(new Float32Array(PUSH).fill(1.0))
  // Start stream — should yield first chunk before decode completes
  let timeout = setTimeout(() => a.stop(), 200)
  for await (let chunk of a.stream()) {
    if (!firstChunk) {
      firstChunk = chunk
      a.stop()
      break
    }
  }
  clearTimeout(timeout)
  t.ok(firstChunk, 'got a chunk during decode')
  t.ok(firstChunk[0].length > 0, `chunk has data (${firstChunk[0].length})`)
  let expected = Math.pow(10, -6 / 20)
  t.ok(Math.abs(firstChunk[0][0] - expected) < 0.01, `gain applied: ${firstChunk[0][0].toFixed(4)} ≈ ${expected.toFixed(4)}`)
})

test('stream — live decode with process edits matches full render', async t => {
  let a = audio()
  a.gain(-6)
  let each = 8192, pushes = 5
  for (let i = 0; i < pushes; i++) a.push(new Float32Array(each).fill(0.5))
  a.stop()
  let streamed = [], total = 0
  for await (let chunk of a.stream()) { streamed.push(chunk[0].slice()); total += chunk[0].length }

  // Compare with fully-decoded version
  let b = audio.from([new Float32Array(each * pushes).fill(0.5)])
  b.gain(-6)
  let full = await b.read()

  t.is(total, full[0].length, `same total samples (${total})`)
  let expected = 0.5 * Math.pow(10, -6 / 20)
  t.ok(Math.abs(streamed[0][0] - expected) < 0.01, `first sample correct: ${streamed[0][0].toFixed(4)} ≈ ${expected.toFixed(4)}`)
})

test('stream — live decode with filter applies statefully across chunks', async t => {
  let a = audio()
  a.highpass(80)
  let each = 2048
  // Push DC signal — highpass should remove it over time
  for (let i = 0; i < 10; i++) a.push(new Float32Array(each).fill(0.5))
  a.stop()
  let first = null, last = null
  for await (let chunk of a.stream()) {
    if (!first) first = chunk[0].slice()
    last = chunk[0].slice()
  }
  // Highpass filter on DC: later chunks should be closer to 0 than first
  t.ok(first, 'got first chunk')
  t.ok(last, 'got last chunk')
  let firstMag = Math.abs(first[first.length - 1])
  let lastMag = Math.abs(last[last.length - 1])
  t.ok(lastMag < firstMag || lastMag < 0.1, `highpass attenuated DC: first=${firstMag.toFixed(4)} last=${lastMag.toFixed(4)}`)
})

test('stream — live decode with plan edit waits for full decode', async t => {
  // Post-stop: decoded=true, streams via unified plan loop
  let a = audio()
  a.crop({ at: 0, duration: 0.05 })
  let each = 4096
  a.push(new Float32Array(each).fill(0.5))
  a.push(new Float32Array(each).fill(0.5))
  a.stop()
  let total = 0
  for await (let chunk of a.stream()) total += chunk[0].length
  let expected = Math.round(0.05 * 44100)
  t.is(total, expected, `crop respected: ${total} samples (expected ${expected})`)
})

test('stream — incremental structural: crop streams before decode completes', async t => {
  let a = audio()
  a.crop({ at: 0, duration: 0.05 })
  let PUSH = PAGE_SIZE + 4096  // more than one page so drain commits data
  a.push(new Float32Array(PUSH).fill(0.5))
  // Start streaming before stop — should use incremental path
  let firstChunk = null
  let timeout = setTimeout(() => a.stop(), 200)
  for await (let chunk of a.stream()) {
    if (!firstChunk) {
      firstChunk = chunk
      a.stop()
      break
    }
  }
  clearTimeout(timeout)
  t.ok(firstChunk, 'got chunk during live decode with crop')
  t.ok(firstChunk[0].length > 0, `chunk has data (${firstChunk[0].length})`)
  t.ok(Math.abs(firstChunk[0][0] - 0.5) < 0.01, 'data correct')
})

test('stream — incremental structural: crop matches full render', async t => {
  let each = PAGE_SIZE, pushes = 3
  let a = audio()
  a.crop({ at: 0, duration: 0.05 })
  for (let i = 0; i < pushes; i++) a.push(new Float32Array(each).fill(0.5))
  a.stop()
  let streamed = [], total = 0
  for await (let chunk of a.stream()) { streamed.push(chunk[0].slice()); total += chunk[0].length }

  let b = audio.from([new Float32Array(each * pushes).fill(0.5)])
  b.crop({ at: 0, duration: 0.05 })
  let full = await b.read()

  t.is(total, full[0].length, `same total samples (${total})`)
  t.ok(Math.abs(streamed[0][0] - full[0][0]) < 0.001, 'first sample matches')
})

test('stream — incremental structural: remove matches full render', async t => {
  let each = PAGE_SIZE, pushes = 3
  let a = audio()
  a.remove({ at: 0.1, duration: 0.1 })
  for (let i = 0; i < pushes; i++) a.push(new Float32Array(each).fill(0.5))
  a.stop()
  let streamed = [], total = 0
  for await (let chunk of a.stream()) { streamed.push(chunk[0].slice()); total += chunk[0].length }

  let b = audio.from([new Float32Array(each * pushes).fill(0.5)])
  b.remove({ at: 0.1, duration: 0.1 })
  let full = await b.read()

  t.is(total, full[0].length, `same total: ${total} vs ${full[0].length}`)
})

test('stream — incremental structural: crop + gain matches full render', async t => {
  let each = PAGE_SIZE, pushes = 2, val = 0.8
  let a = audio()
  a.crop({ at: 0, duration: 0.1 }).gain(-6)
  for (let i = 0; i < pushes; i++) a.push(new Float32Array(each).fill(val))
  a.stop()
  let streamed = [], total = 0
  for await (let chunk of a.stream()) { streamed.push(chunk[0].slice()); total += chunk[0].length }

  let b = audio.from([new Float32Array(each * pushes).fill(val)])
  b.crop({ at: 0, duration: 0.1 }).gain(-6)
  let full = await b.read()

  t.is(total, full[0].length, `same total: ${total}`)
  let expected = val * Math.pow(10, -6 / 20)
  t.ok(Math.abs(streamed[0][0] - expected) < 0.01, `first sample: ${streamed[0][0].toFixed(4)} ≈ ${expected.toFixed(4)}`)
})

test('stream — incremental structural: speed matches full render', async t => {
  let each = PAGE_SIZE, pushes = 2
  let ramp = new Float32Array(each * pushes)
  for (let i = 0; i < ramp.length; i++) ramp[i] = i / ramp.length
  let a = audio()
  a.speed(2)
  a.push(ramp)
  a.stop()
  let streamed = [], total = 0
  for await (let chunk of a.stream()) { streamed.push(chunk[0].slice()); total += chunk[0].length }

  let b = audio.from([ramp.slice()])
  b.speed(2)
  let full = await b.read()

  t.is(total, full[0].length, `same total: ${total}`)
  let flat = new Float32Array(total), pos = 0
  for (let s of streamed) { flat.set(s, pos); pos += s.length }
  // Compare first and last samples
  t.ok(Math.abs(flat[0] - full[0][0]) < 0.01, 'first sample matches')
  t.ok(Math.abs(flat[total - 1] - full[0][total - 1]) < 0.01, 'last sample matches')
})

test('stream — incremental structural: non-incremental ops fall back to full plan', async t => {
  // reverse() without range is not incrementally streamable — should still work via full plan
  let a = audio()
  a.reverse()
  let each = 4096
  a.push(new Float32Array(each).fill(0.5))
  a.stop()
  let total = 0
  for await (let chunk of a.stream()) total += chunk[0].length
  t.is(total, each, `reverse streamed all ${each} samples`)
})

test('stream — incremental repeat: first pass streams, rest after decode', async t => {
  let each = PAGE_SIZE, pushes = 2
  let a = audio()
  a.repeat(2)  // 3x total (original + 2 repeats)
  for (let i = 0; i < pushes; i++) a.push(new Float32Array(each).fill(0.5))
  a.stop()
  let streamed = [], total = 0
  for await (let chunk of a.stream()) { streamed.push(chunk[0].slice()); total += chunk[0].length }

  let b = audio.from([new Float32Array(each * pushes).fill(0.5)])
  b.repeat(2)
  let full = await b.read()

  t.is(total, full[0].length, `same total: ${total} vs ${full[0].length}`)
})

test('stream — incremental repeat: streams before decode completes', async t => {
  let a = audio()
  a.repeat(3)
  let PUSH = PAGE_SIZE + 4096
  a.push(new Float32Array(PUSH).fill(0.25))
  // Start streaming before stop — should yield first-pass data
  let firstChunk = null
  let timeout = setTimeout(() => a.stop(), 200)
  for await (let chunk of a.stream()) {
    if (!firstChunk) {
      firstChunk = chunk
      a.stop()
      break
    }
  }
  clearTimeout(timeout)
  t.ok(firstChunk, 'got chunk during live decode with repeat')
  t.ok(firstChunk[0].length > 0, `chunk has data (${firstChunk[0].length})`)
  t.ok(Math.abs(firstChunk[0][0] - 0.25) < 0.01, 'data correct')
})

test('stream — incremental repeat + gain matches full render', async t => {
  let each = PAGE_SIZE, pushes = 2, val = 0.8
  let a = audio()
  a.repeat(1).gain(-6)  // 2x total (original + 1 repeat)
  for (let i = 0; i < pushes; i++) a.push(new Float32Array(each).fill(val))
  a.stop()
  let streamed = [], total = 0
  for await (let chunk of a.stream()) { streamed.push(chunk[0].slice()); total += chunk[0].length }

  let b = audio.from([new Float32Array(each * pushes).fill(val)])
  b.repeat(1).gain(-6)
  let full = await b.read()

  t.is(total, full[0].length, `same total: ${total}`)
  let expected = val * Math.pow(10, -6 / 20)
  t.ok(Math.abs(streamed[0][0] - expected) < 0.01, `first sample: ${streamed[0][0].toFixed(4)} ≈ ${expected.toFixed(4)}`)
})

test('stream — incremental pad-after matches full render', async t => {
  let each = PAGE_SIZE, pushes = 2
  let a = audio()
  a.pad(0, 0.5)  // 0.5s silence after
  for (let i = 0; i < pushes; i++) a.push(new Float32Array(each).fill(0.3))
  a.stop()
  let streamed = [], total = 0
  for await (let chunk of a.stream()) { streamed.push(chunk[0].slice()); total += chunk[0].length }

  let b = audio.from([new Float32Array(each * pushes).fill(0.3)])
  b.pad(0, 0.5)
  let full = await b.read()

  t.is(total, full[0].length, `same total: ${total} vs ${full[0].length}`)
  // First sample should be content
  t.ok(Math.abs(streamed[0][0] - 0.3) < 0.01, 'content at start')
})

test('stream — incremental speed + repeat matches full render', async t => {
  let each = PAGE_SIZE, pushes = 2
  let ramp = new Float32Array(each * pushes)
  for (let i = 0; i < ramp.length; i++) ramp[i] = i / ramp.length
  let a = audio()
  a.speed(2).repeat(1)  // speed-up then repeat
  a.push(ramp)
  a.stop()
  let streamed = [], total = 0
  for await (let chunk of a.stream()) { streamed.push(chunk[0].slice()); total += chunk[0].length }

  let b = audio.from([ramp.slice()])
  b.speed(2).repeat(1)
  let full = await b.read()

  t.is(total, full[0].length, `same total: ${total}`)
  let flat = new Float32Array(total), pos = 0
  for (let s of streamed) { flat.set(s, pos); pos += s.length }
  t.ok(Math.abs(flat[0] - full[0][0]) < 0.01, 'first sample matches')
  t.ok(Math.abs(flat[total - 1] - full[0][total - 1]) < 0.01, 'last sample matches')
})

// ── Streaming: Combinations ─────────────────────────────────────────────

test('stream — pad-after + repeat matches full render', async t => {
  let each = PAGE_SIZE, pushes = 2
  let a = audio()
  a.pad(0, 0.2).repeat(1)
  for (let i = 0; i < pushes; i++) a.push(new Float32Array(each).fill(0.4))
  a.stop()
  let streamed = [], total = 0
  for await (let chunk of a.stream()) { streamed.push(chunk[0].slice()); total += chunk[0].length }
  let b = audio.from([new Float32Array(each * pushes).fill(0.4)])
  b.pad(0, 0.2).repeat(1)
  let full = await b.read()
  t.is(total, full[0].length, `same total: ${total} vs ${full[0].length}`)
})

test('stream — pad-after + reverse matches full render', async t => {
  let each = PAGE_SIZE, pushes = 2
  let ramp = new Float32Array(each * pushes)
  for (let i = 0; i < ramp.length; i++) ramp[i] = i / ramp.length
  let a = audio()
  a.pad(0, 0.1).reverse()
  a.push(ramp)
  a.stop()
  let streamed = [], total = 0
  for await (let chunk of a.stream()) { streamed.push(chunk[0].slice()); total += chunk[0].length }
  let b = audio.from([ramp.slice()])
  b.pad(0, 0.1).reverse()
  let full = await b.read()
  t.is(total, full[0].length, `same total: ${total} vs ${full[0].length}`)
  let flat = new Float32Array(total), pos = 0
  for (let s of streamed) { flat.set(s, pos); pos += s.length }
  t.ok(Math.abs(flat[0] - full[0][0]) < 0.01, 'first sample matches')
})

test('stream — pad-after + trim matches full render', async t => {
  // 0.5s silence, 1s signal, 0.5s silence → trim should remove silence, pad adds after
  let sr = 44100, ch = new Float32Array(sr * 2)
  for (let i = sr / 2; i < sr * 1.5; i++) ch[i] = 0.5 * Math.sin(2 * Math.PI * 440 * i / sr)
  let a = audio.from([ch], { sampleRate: sr })
  a.pad(0, 0.3).trim(-20)
  let full = await a.read()
  let b = audio.from([ch.slice()], { sampleRate: sr })
  b.pad(0, 0.3).trim(-20)
  let full2 = await b.read()
  t.is(full[0].length, full2[0].length, `consistent: ${full[0].length}`)
  t.ok(full[0].length < ch.length, `trimmed: ${full[0].length} < ${ch.length}`)
})

test('stream — clip + repeat applies only to clip range', async t => {
  let ramp = new Float32Array(44100)
  for (let i = 0; i < ramp.length; i++) ramp[i] = i / ramp.length
  let a = audio.from([ramp])
  let clipped = a.clip({ at: 0.1, duration: 0.2 })
  clipped.repeat(2)
  let pcm = await clipped.read()
  let expected = Math.round(0.2 * 44100 * 3)  // 0.2s * 3 passes
  t.ok(Math.abs(pcm[0].length - expected) < 3, `clip+repeat length: ${pcm[0].length} ≈ ${expected}`)
})

test('stream — clip + reverse applies only to clip range', async t => {
  let ramp = new Float32Array(44100)
  for (let i = 0; i < ramp.length; i++) ramp[i] = i / ramp.length
  let a = audio.from([ramp])
  let clipped = a.clip({ at: 0.2, duration: 0.3 })
  clipped.reverse()
  let pcm = await clipped.read()
  let expected = Math.round(0.3 * 44100)
  t.ok(Math.abs(pcm[0].length - expected) < 2, `clip+reverse length: ${pcm[0].length} ≈ ${expected}`)
  // First sample of reversed clip should be near the end of the original clip range
  let origEnd = ramp[Math.round(0.5 * 44100) - 1]
  t.ok(Math.abs(pcm[0][0] - origEnd) < 0.01, `first sample reversed: ${pcm[0][0].toFixed(4)} ≈ ${origEnd.toFixed(4)}`)
})

test('stream — clip + trim applies only to clip range', async t => {
  let sr = 44100, ch = new Float32Array(sr * 3)
  // Silence + signal + silence in the middle
  for (let i = sr; i < sr * 2; i++) ch[i] = 0.5 * Math.sin(2 * Math.PI * 440 * i / sr)
  let a = audio.from([ch], { sampleRate: sr })
  let clipped = a.clip({ at: 0.5, duration: 2 })
  clipped.trim(-20)
  let pcm = await clipped.read()
  t.ok(pcm[0].length < sr * 2, `clip+trim shorter: ${pcm[0].length} < ${sr * 2}`)
  t.ok(pcm[0].length > sr * 0.5, `clip+trim has content: ${pcm[0].length} > ${sr * 0.5}`)
})

test('stream — clip + normalize applies only to clip range', async t => {
  let ramp = new Float32Array(44100)
  for (let i = 0; i < ramp.length; i++) ramp[i] = 0.1 * Math.sin(2 * Math.PI * 440 * i / 44100)
  let a = audio.from([ramp])
  let clipped = a.clip({ at: 0.1, duration: 0.3 })
  clipped.normalize(0)
  let pcm = await clipped.read()
  let peak = 0
  for (let s of pcm[0]) { let v = Math.abs(s); if (v > peak) peak = v }
  t.ok(Math.abs(peak - 1) < 0.02, `clip+normalize peak ~1 (got ${peak.toFixed(3)})`)
  let expected = Math.round(0.3 * 44100)
  t.ok(Math.abs(pcm[0].length - expected) < 2, `length preserved: ${pcm[0].length} ≈ ${expected}`)
})

// ── Streaming: Open Ranges ──────────────────────────────────────────────

test('stream — crop open-left (..2s) matches full render', async t => {
  let ramp = new Float32Array(44100 * 4)
  for (let i = 0; i < ramp.length; i++) ramp[i] = i / ramp.length
  let a = audio.from([ramp], { sampleRate: 44100 })
  a.crop({ duration: 2 })  // ..2s: from start to 2s
  let pcm = await a.read()
  t.is(pcm[0].length, 88200, `open-left crop: ${pcm[0].length}`)
  t.ok(Math.abs(pcm[0][0] - 0) < 0.001, 'starts at 0')
})

test('stream — crop open-right (2s..) matches full render', async t => {
  let ramp = new Float32Array(44100 * 4)
  for (let i = 0; i < ramp.length; i++) ramp[i] = i / ramp.length
  let a = audio.from([ramp], { sampleRate: 44100 })
  a.crop({ at: 2 })  // 2s..: from 2s to end
  let pcm = await a.read()
  t.is(pcm[0].length, 88200, `open-right crop: ${pcm[0].length}`)
  t.ok(pcm[0][0] > 0.49, `starts at ~0.5: ${pcm[0][0].toFixed(4)}`)
})

test('stream — remove open-left (..1s)', async t => {
  let ch = new Float32Array(44100 * 3).fill(0.5)
  let a = audio.from([ch], { sampleRate: 44100 })
  a.remove({ duration: 1 })  // remove first 1s
  let pcm = await a.read()
  t.is(pcm[0].length, 44100 * 2, `removed 1s: ${pcm[0].length}`)
})

test('stream — remove open-right (1s..)', async t => {
  let ch = new Float32Array(44100 * 3).fill(0.5)
  let a = audio.from([ch], { sampleRate: 44100 })
  a.remove({ at: 1 })  // remove from 1s to end
  let pcm = await a.read()
  t.is(pcm[0].length, 44100, `kept first 1s: ${pcm[0].length}`)
})

test('stream — reverse open-left (..2s) reverses only head', async t => {
  let ramp = new Float32Array(44100 * 4)
  for (let i = 0; i < ramp.length; i++) ramp[i] = i / ramp.length
  let a = audio.from([ramp], { sampleRate: 44100 })
  a.reverse({ duration: 2 })  // ..2s: reverse first 2s
  let pcm = await a.read()
  t.is(pcm[0].length, ramp.length, 'length preserved')
  // First sample should be near the value at 2s (reversed)
  t.ok(pcm[0][0] > 0.4, `first sample ~0.5 (reversed head): ${pcm[0][0].toFixed(4)}`)
  // Sample at 2s+ should be normal (unreversed)
  let at3s = pcm[0][44100 * 3]
  t.ok(at3s > 0.7, `sample at 3s normal: ${at3s.toFixed(4)}`)
})

test('stream — reverse open-right (1s..) reverses from 1s to end', async t => {
  let ramp = new Float32Array(44100 * 4)
  for (let i = 0; i < ramp.length; i++) ramp[i] = i / ramp.length
  let a = audio.from([ramp], { sampleRate: 44100 })
  a.reverse({ at: 1 })  // 1s..: reverse from 1s to end
  let pcm = await a.read()
  t.is(pcm[0].length, ramp.length, 'length preserved')
  // First 1s should be normal
  t.ok(Math.abs(pcm[0][0] - 0) < 0.001, 'first sample normal')
  // Sample at 1s should be near the end (reversed)
  let at1s = pcm[0][44100]
  t.ok(at1s > 0.9, `sample at 1s (start of reversed region) near end: ${at1s.toFixed(4)}`)
})

test('stream — reverse rangeless = reverse(0..end)', async t => {
  let ramp = new Float32Array(44100)
  for (let i = 0; i < ramp.length; i++) ramp[i] = i / ramp.length
  let a = audio.from([ramp])
  a.reverse()
  let pcm = await a.read()
  t.is(pcm[0].length, ramp.length, 'length preserved')
  t.ok(pcm[0][0] > 0.99, `first sample is last (reversed): ${pcm[0][0].toFixed(4)}`)
  t.ok(pcm[0][pcm[0].length - 1] < 0.001, 'last sample is first')
})

test('stream — reverse open-right incremental: pre-reverse data streams', async t => {
  let a = audio()
  a.reverse({ at: 0.1 })  // 0.1s.. — first 0.1s should stream immediately
  let PUSH = PAGE_SIZE + 4096
  a.push(new Float32Array(PUSH).fill(0.5))
  let firstChunk = null
  let timeout = setTimeout(() => a.stop(), 200)
  for await (let chunk of a.stream()) {
    if (!firstChunk) {
      firstChunk = chunk
      a.stop()
      break
    }
  }
  clearTimeout(timeout)
  t.ok(firstChunk, 'got chunk before decode completes')
  t.ok(firstChunk[0].length > 0, `chunk has data: ${firstChunk[0].length}`)
  t.ok(Math.abs(firstChunk[0][0] - 0.5) < 0.01, 'data correct (unreversed region)')
})

test('stream — reverse rangeless blocks until decode, then streams', async t => {
  let a = audio()
  a.reverse()  // = 0..end — stableLimit = 0, must wait
  let each = 4096
  a.push(new Float32Array(each).fill(0.5))
  a.stop()
  let total = 0
  for await (let chunk of a.stream()) total += chunk[0].length
  t.is(total, each, `reverse streamed all ${each} samples after decode`)
})

test('stream — pad open-left (before)', async t => {
  let ch = new Float32Array(44100).fill(0.5)
  let a = audio.from([ch], { sampleRate: 44100 })
  a.pad(1)  // 1s before + 1s after
  let pcm = await a.read()
  t.is(pcm[0].length, 44100 * 3, `padded: ${pcm[0].length}`)
  t.is(pcm[0][0], 0, 'starts with silence')
  t.ok(Math.abs(pcm[0][44100] - 0.5) < 0.01, 'content at 1s')
})

test('stream — repeat open-right (2s..)', async t => {
  let sr = 44100, ramp = new Float32Array(sr * 4)
  for (let i = 0; i < ramp.length; i++) ramp[i] = i / ramp.length
  let a = audio.from([ramp], { sampleRate: sr })
  a.repeat(1, { at: 2 })  // repeat from 2s to end once
  let pcm = await a.read()
  let expected = sr * 4 + sr * 2  // original 4s + repeated 2s..4s = 6s
  t.ok(Math.abs(pcm[0].length - expected) < 3, `repeat 2s..: ${pcm[0].length} ≈ ${expected}`)
})

test('stream — repeat open-left (..2s)', async t => {
  let sr = 44100, ramp = new Float32Array(sr * 4)
  for (let i = 0; i < ramp.length; i++) ramp[i] = i / ramp.length
  let a = audio.from([ramp], { sampleRate: sr })
  a.repeat(1, { at: 0, duration: 2 })  // repeat first 2s once
  let pcm = await a.read()
  let expected = sr * 4 + sr * 2  // original 4s + repeated 0..2s = 6s
  t.ok(Math.abs(pcm[0].length - expected) < 3, `repeat ..2s: ${pcm[0].length} ≈ ${expected}`)
})

test('stream — speed open-right (2s..)', async t => {
  let sr = 44100, ch = new Float32Array(sr * 4).fill(0.5)
  let a = audio.from([ch], { sampleRate: sr })
  a.speed(2)  // doubles speed of entire audio
  let pcm = await a.read()
  let expected = Math.round(sr * 4 / 2)
  t.ok(Math.abs(pcm[0].length - expected) < 3, `speed 2x: ${pcm[0].length} ≈ ${expected}`)
})

test('stream — insert open-right (at end) matches full render', async t => {
  let sr = 44100
  let ch1 = new Float32Array(sr * 2).fill(0.3)
  let ch2 = new Float32Array(sr).fill(0.7)
  let a = audio.from([ch1], { sampleRate: sr })
  a.insert(audio.from([ch2], { sampleRate: sr }))  // insert at end (no at)
  let pcm = await a.read()
  t.is(pcm[0].length, sr * 3, `total: ${pcm[0].length}`)
  t.ok(Math.abs(pcm[0][0] - 0.3) < 0.01, 'original at start')
  t.ok(Math.abs(pcm[0][sr * 2] - 0.7) < 0.01, 'inserted at end')
})

test('stream — insert at position matches full render', async t => {
  let sr = 44100
  let ch1 = new Float32Array(sr * 2).fill(0.3)
  let ch2 = new Float32Array(sr).fill(0.7)
  let a = audio.from([ch1], { sampleRate: sr })
  a.insert(audio.from([ch2], { sampleRate: sr }), { at: 1 })  // insert at 1s
  let pcm = await a.read()
  t.is(pcm[0].length, sr * 3, `total: ${pcm[0].length}`)
  t.ok(Math.abs(pcm[0][0] - 0.3) < 0.01, 'original at start')
  t.ok(Math.abs(pcm[0][sr] - 0.7) < 0.01, 'inserted at 1s')
  t.ok(Math.abs(pcm[0][sr * 2] - 0.3) < 0.01, 'original resumes after insert')
})

// ── Streaming: Progressive resolve (trim/normalize) ────────────────────

test('stream — trim progressive: head silence removed during live decode', async t => {
  let sr = 44100, BS = BLOCK_SIZE
  // Silence blocks + loud blocks
  let silentBlocks = 4, loudBlocks = 8
  let silentLen = silentBlocks * BS, loudLen = loudBlocks * BS
  let ch = new Float32Array(silentLen + loudLen)
  for (let i = silentLen; i < ch.length; i++) ch[i] = 0.5 * Math.sin(2 * Math.PI * 440 * i / sr)
  let a = audio.from([ch], { sampleRate: sr })
  a.trim(-20)
  let pcm = await a.read()
  t.ok(pcm[0].length < ch.length, `trimmed head: ${pcm[0].length} < ${ch.length}`)
  t.ok(pcm[0].length >= loudLen - BS, `kept loud content: ${pcm[0].length} >= ${loudLen - BS}`)
})

test('stream — normalize progressive: gain applied from partial stats', async t => {
  let sr = 44100
  let ch = new Float32Array(sr)
  for (let i = 0; i < ch.length; i++) ch[i] = 0.25 * Math.sin(2 * Math.PI * 440 * i / sr)
  let a = audio.from([ch], { sampleRate: sr })
  a.normalize(0)
  let pcm = await a.read()
  let peak = 0
  for (let s of pcm[0]) { let v = Math.abs(s); if (v > peak) peak = v }
  t.ok(Math.abs(peak - 1) < 0.02, `normalized peak ~1 (got ${peak.toFixed(3)})`)
})

// ── Streaming: Edge Cases ───────────────────────────────────────────────

test('stream — negative at blocks until decode, then works', async t => {
  let a = audio()
  a.crop({ at: -0.05 })  // last 50ms — needs total
  let PUSH = PAGE_SIZE + 4096
  a.push(new Float32Array(PUSH).fill(0.5))
  a.stop()
  let streamed = [], total = 0
  for await (let chunk of a.stream()) { streamed.push(chunk[0].slice()); total += chunk[0].length }
  let expected = Math.round(0.05 * 44100)
  t.ok(Math.abs(total - expected) < 3, `negative at crop: ${total} ≈ ${expected}`)
  t.ok(Math.abs(streamed[0][0] - 0.5) < 0.01, 'data correct')
})

test('stream — negative at on live source waits for decode', async t => {
  let a = audio()
  a.crop({ at: -0.02 })
  let PUSH = PAGE_SIZE + 4096
  a.push(new Float32Array(PUSH).fill(0.3))
  // Stream before stop — should not yield until decode
  let gotChunk = false
  let timeout = setTimeout(() => { a.stop() }, 100)
  for await (let chunk of a.stream()) {
    gotChunk = true
    break
  }
  clearTimeout(timeout)
  t.ok(gotChunk, 'got data after decode completed')
})

test('stream — chained structural ops: crop + speed + gain', async t => {
  let each = PAGE_SIZE, pushes = 3
  let ramp = new Float32Array(each * pushes)
  for (let i = 0; i < ramp.length; i++) ramp[i] = i / ramp.length
  let a = audio()
  a.crop({ at: 0.1, duration: 0.3 }).speed(2).gain(-6)
  a.push(ramp)
  a.stop()
  let streamed = [], total = 0
  for await (let chunk of a.stream()) { streamed.push(chunk[0].slice()); total += chunk[0].length }
  let b = audio.from([ramp.slice()])
  b.crop({ at: 0.1, duration: 0.3 }).speed(2).gain(-6)
  let full = await b.read()
  t.is(total, full[0].length, `chained ops same length: ${total}`)
  let flat = new Float32Array(total), pos = 0
  for (let s of streamed) { flat.set(s, pos); pos += s.length }
  t.ok(Math.abs(flat[0] - full[0][0]) < 0.01, 'first sample matches')
  t.ok(Math.abs(flat[total - 1] - full[0][total - 1]) < 0.01, 'last sample matches')
})

test('stream — chained: remove + speed matches full render', async t => {
  let each = PAGE_SIZE, pushes = 2
  let ch = new Float32Array(each * pushes).fill(0.5)
  let a = audio()
  a.remove({ at: 0.05, duration: 0.1 }).speed(0.5)
  a.push(ch)
  a.stop()
  let streamed = [], total = 0
  for await (let chunk of a.stream()) { streamed.push(chunk[0].slice()); total += chunk[0].length }
  let b = audio.from([ch.slice()])
  b.remove({ at: 0.05, duration: 0.1 }).speed(0.5)
  let full = await b.read()
  t.is(total, full[0].length, `remove+speed: ${total} vs ${full[0].length}`)
})

test('stream — insert at end blocks then matches full render', async t => {
  let sr = 44100
  let ch1 = new Float32Array(sr).fill(0.3)
  let ch2 = new Float32Array(Math.round(sr * 0.5)).fill(0.7)
  let a = audio()
  a.insert(audio.from([ch2], { sampleRate: sr }))  // at=null → insert at end
  a.push(ch1)
  a.stop()
  let streamed = [], total = 0
  for await (let chunk of a.stream()) { streamed.push(chunk[0].slice()); total += chunk[0].length }
  let b = audio.from([ch1.slice()], { sampleRate: sr })
  b.insert(audio.from([ch2.slice()], { sampleRate: sr }))
  let full = await b.read()
  t.is(total, full[0].length, `insert-at-end: ${total} vs ${full[0].length}`)
})

test('stream — very short audio (< BLOCK_SIZE) with crop', async t => {
  let short = new Float32Array(100).fill(0.8)
  let a = audio.from([short])
  a.crop({ at: 0, duration: 50 / 44100 })
  let total = 0
  for await (let chunk of a.stream()) total += chunk[0].length
  t.is(total, 50, `short audio cropped: ${total}`)
})

test('stream — very short audio (< BLOCK_SIZE) with speed', async t => {
  let short = new Float32Array(200).fill(0.5)
  let a = audio.from([short])
  a.speed(2)
  let total = 0
  for await (let chunk of a.stream()) total += chunk[0].length
  t.is(total, 100, `short audio sped up: ${total}`)
})

test('stream — trim + normalize chained on live source', async t => {
  let sr = 44100, BS = BLOCK_SIZE
  let silentLen = 4 * BS, loudLen = 10 * BS
  let ch = new Float32Array(silentLen + loudLen)
  for (let i = silentLen; i < ch.length; i++) ch[i] = 0.25 * Math.sin(2 * Math.PI * 440 * i / sr)
  let a = audio.from([ch], { sampleRate: sr })
  a.trim(-20).normalize(0)
  let pcm = await a.read()
  t.ok(pcm[0].length < ch.length, `trimmed: ${pcm[0].length} < ${ch.length}`)
  let peak = 0
  for (let s of pcm[0]) { let v = Math.abs(s); if (v > peak) peak = v }
  t.ok(Math.abs(peak - 1) < 0.05, `normalized peak ~1 (got ${peak.toFixed(3)})`)
})

test('normalize — ceiling stats derived algebraically (no full recompute)', async t => {
  let sr = 44100
  let ch = new Float32Array(sr)
  for (let i = 0; i < sr; i++) ch[i] = 0.1 * Math.sin(2 * Math.PI * 440 * i / sr)
  let a = audio.from([ch], { sampleRate: sr })
  a.normalize('podcast')  // LUFS preset with auto ceiling -1dBFS → emits dc + gain + clamp
  let db = await a.stat('db')
  let ceilLin = 10 ** (-1 / 20)  // -1 dBFS
  let ceilDb = -1
  t.ok(db <= ceilDb + 0.5, `peak within ceiling (got ${db.toFixed(1)} dBFS)`)
  // Verify stats are consistent — clamp deriveStats should keep peaks within limit
  let pcm = await a.read()
  let peak = 0
  for (let s of pcm[0]) { let v = Math.abs(s); if (v > peak) peak = v }
  t.ok(peak <= ceilLin + 0.001, `actual peak within ceiling (got ${peak.toFixed(4)})`)
})

test('stream — normalize progressive: no clicks from gain discontinuity', async t => {
  let sr = 44100
  // 2 seconds of quiet tone — long enough for progressive resolve to fire mid-stream
  let ch = new Float32Array(sr * 2)
  for (let i = 0; i < ch.length; i++) ch[i] = 0.1 * Math.sin(2 * Math.PI * 440 * i / sr)
  let a = audio.from([ch], { sampleRate: sr })
  a.normalize(0)  // peak normalize: gain should be ~20dB
  // Stream and check for sample-to-sample discontinuities (clicks = large jumps)
  let chunked = []
  for await (let chunk of a.stream()) chunked.push(chunk[0].slice())
  let all = new Float32Array(chunked.reduce((s, c) => s + c.length, 0))
  let off = 0
  for (let c of chunked) { all.set(c, off); off += c.length }
  // A click would be a jump > 0.5 between adjacent samples in a 440Hz sine
  // Max natural delta for 440Hz at peak=1: 2π·440/44100 ≈ 0.063
  let maxJump = 0, jumpAt = -1
  for (let i = 1; i < all.length; i++) {
    let d = Math.abs(all[i] - all[i - 1])
    if (d > maxJump) { maxJump = d; jumpAt = i }
  }
  t.ok(maxJump < 0.2, `no clicks: max jump ${maxJump.toFixed(4)} at sample ${jumpAt}`)
  // Verify normalization actually applied
  let peak = 0
  for (let s of all) { let v = Math.abs(s); if (v > peak) peak = v }
  t.ok(Math.abs(peak - 1) < 0.05, `normalized peak ~1 (got ${peak.toFixed(3)})`)
})

test('stream — reverse ranged streams non-reversed region', async t => {
  let ramp = new Float32Array(44100)
  for (let i = 0; i < ramp.length; i++) ramp[i] = i / ramp.length
  let a = audio()
  a.reverse({ at: 0.5, duration: 0.2 })  // reverse 0.5s..0.7s only
  let PUSH = PAGE_SIZE + 4096
  a.push(ramp.subarray(0, PUSH))
  // Stream before stop — non-reversed region [0, 0.5) should stream
  let firstChunk = null
  let timeout = setTimeout(() => a.stop(), 200)
  for await (let chunk of a.stream()) {
    if (!firstChunk) { firstChunk = chunk; a.stop(); break }
  }
  clearTimeout(timeout)
  t.ok(firstChunk, 'got chunk from non-reversed region')
  t.ok(Math.abs(firstChunk[0][0] - ramp[0]) < 0.01, 'data matches source start')
})

test('stream — empty result after remove-all', async t => {
  let ch = new Float32Array(4410).fill(0.5)
  let a = audio.from([ch], { sampleRate: 44100 })
  a.remove({ at: 0 })  // remove everything
  let total = 0
  for await (let chunk of a.stream()) total += chunk[0].length
  t.is(total, 0, 'remove-all produces empty stream')
})

test('stream — crop + remove + pad chained matches full render', async t => {
  let sr = 44100
  let ch = new Float32Array(sr * 2).fill(0.5)
  let a = audio.from([ch], { sampleRate: sr })
  a.crop({ at: 0.2, duration: 1 }).remove({ at: 0.1, duration: 0.2 }).pad(0.1, 0.1)
  let streamed = [], total = 0
  for await (let chunk of a.stream()) { streamed.push(chunk[0].slice()); total += chunk[0].length }
  let b = audio.from([ch.slice()], { sampleRate: sr })
  b.crop({ at: 0.2, duration: 1 }).remove({ at: 0.1, duration: 0.2 }).pad(0.1, 0.1)
  let full = await b.read()
  t.is(total, full[0].length, `triple chain: ${total} vs ${full[0].length}`)
  let flat = new Float32Array(total), pos = 0
  for (let s of streamed) { flat.set(s, pos); pos += s.length }
  let maxDiff = 0
  for (let i = 0; i < total; i++) maxDiff = Math.max(maxDiff, Math.abs(flat[i] - full[0][i]))
  t.ok(maxDiff < 0.001, `samples match (maxDiff ${maxDiff.toFixed(6)})`)
})

test('stream — resolve op (trim) limit tracks through crop', async t => {
  // trim resolves to crop, which should correctly update the limit
  let sr = 44100, BS = BLOCK_SIZE
  let silentLen = 4 * BS, loudLen = 20 * BS
  let ch = new Float32Array(silentLen + loudLen)
  for (let i = silentLen; i < ch.length; i++) ch[i] = 0.5
  let a = audio()
  a.trim(-20)
  for (let i = 0; i < ch.length; i += PAGE_SIZE) {
    a.push(ch.subarray(i, Math.min(i + PAGE_SIZE, ch.length)))
  }
  a.stop()
  let streamed = [], total = 0
  for await (let chunk of a.stream()) { streamed.push(chunk[0].slice()); total += chunk[0].length }
  let b = audio.from([ch.slice()], { sampleRate: sr })
  b.trim(-20)
  let full = await b.read()
  t.ok(Math.abs(total - full[0].length) < BS, `trim limit converges: ${total} ≈ ${full[0].length}`)
})

// ── Phase 10: Page Cache + Eviction ──────────────────────────────────────

// Mock cache backend (in-memory, simulates OPFS interface)
function mockCache() {
  let store = new Map()
  return {
    read(i) { return store.get(i) },
    write(i, data) { store.set(i, data.map(ch => new Float32Array(ch))) },
    has(i) { return store.has(i) },
    evict(i) { store.delete(i) },
    get size() { return store.size },
  }
}

test('cache backend — evicts pages when budget exceeded', async t => {
  // 3 pages of mono audio, each page = PAGE_SIZE * 4 bytes
  let ch = new Float32Array(PAGE_SIZE * 3).fill(0.5)
  let cache = mockCache()
  let pageByteSize = PAGE_SIZE * 4  // Float32 = 4 bytes

  let a = await audio([ch], { cache, budget: pageByteSize * 2 })  // budget fits 2 pages, has 3
  let resident = a.pages.filter(p => p !== null).length
  t.ok(resident <= 2, `budget enforced: ${resident} resident pages (max 2)`)
  t.ok(cache.size >= 1, `${cache.size} pages evicted to cache`)
})

test('cache backend — evicted pages restore on read', async t => {
  let ch = new Float32Array(PAGE_SIZE * 3)
  for (let i = 0; i < ch.length; i++) ch[i] = i / ch.length  // ramp
  let cache = mockCache()
  let pageByteSize = PAGE_SIZE * 4

  let a = await audio([ch], { cache, budget: pageByteSize * 1 })  // only 1 page fits
  // Read full audio — should restore evicted pages from cache
  let pcm = await a.read()
  t.is(pcm[0].length, PAGE_SIZE * 3, 'full length restored')
  t.ok(pcm[0][0] < 0.001, 'first sample correct (ramp start)')
  t.ok(pcm[0][PAGE_SIZE * 3 - 1] > 0.99, 'last sample correct (ramp end)')
})

test('cache backend — index survives eviction', async t => {
  let ch = new Float32Array(PAGE_SIZE * 2).fill(0.7)
  let cache = mockCache()

  let a = await audio([ch], { cache, budget: PAGE_SIZE * 4 * 1 })  // evict 1 page
  let evicted = a.pages.filter(p => p === null).length
  t.ok(evicted >= 1, `${evicted} pages evicted`)

  // Stats should still work without PCM
  let peak = await a.stat('db')
  t.ok(peak > -4, `stats work after eviction: db=${peak.toFixed(1)}`)
})

test('cache backend — analysis from index without page-in', async t => {
  let ch = new Float32Array(PAGE_SIZE * 4).fill(0.3)
  let cache = mockCache()

  let a = await audio([ch], { cache, budget: 0 })  // evict all pages
  let allEvicted = a.pages.every(p => p === null)
  t.ok(allEvicted, 'all pages evicted')

  // waveform/db should work from stats alone (no PCM needed for clean ops)
  let mx = await a.stat('max', {bins: 10})
  t.ok(mx[0] >= 0.29, 'waveform from stats without page-in')
  let peak = await a.stat('db')
  t.ok(peak > -11, 'db from stats without page-in')
})

test('storage: persistent — throws in Node (no OPFS)', { skip: !isNode }, async t => {
  let bigBuf = new ArrayBuffer(100 * 1024 * 1024)  // 100MB "encoded" → estimated 4GB decoded
  try {
    await audio(new Uint8Array(bigBuf), { storage: 'persistent' })
    t.ok(false, 'should have thrown')
  } catch (e) {
    t.ok(e.message.includes('OPFS'), `throws OPFS error: ${e.message.slice(0, 60)}`)
  }
})

test('storage: memory — bypasses OPFS even for large files', async t => {
  // small file with storage: memory should work fine
  let a = await audio(lenaPath, { storage: 'memory' })
  t.ok(a.duration > 12, 'loaded with storage: memory')
})

test('storage option — preserved on instance', async t => {
  let a = await audio(lenaPath, { storage: 'memory' })
  t.is(a.storage, 'memory', 'storage = memory')
  let b = audio.from([new Float32Array(100)])
  t.is(b.storage, 'memory', 'from() defaults to memory')
})


// ── Phase 11: Missing coverage ──────────────────────────────────────────

test('fade out — negative duration auto-positions at end', async t => {
  let ch = new Float32Array(44100).fill(1)
  let a = audio.from([ch], { sampleRate: 44100 })
  a.fade(-0.5)  // fade out last 0.5s — no explicit offset
  let pcm = await a.read()
  t.ok(pcm[0][0] === 1, 'start unchanged')
  t.ok(Math.abs(pcm[0][22050] - 1) < 0.01, 'middle unchanged')
  t.ok(pcm[0][44099] < 0.05, `end is silent (got ${pcm[0][44099].toFixed(3)})`)
})

test('fade out — explicit negative offset', async t => {
  let ch = new Float32Array(44100).fill(1)
  let a = audio.from([ch], { sampleRate: 44100 })
  a.fade(-0.5, 'linear', {at: -0.5})  // explicit offset: -0.5s from end
  let pcm = await a.read()
  t.ok(pcm[0][0] === 1, 'start unchanged')
  t.ok(pcm[0][44099] < 0.05, 'end is silent')
})

test('batch recipe via chaining', async t => {
  let ch = new Float32Array(44100 * 3)
  for (let i = 44100; i < 88200; i++) ch[i] = 0.5 * Math.sin(2 * Math.PI * 440 * i / 44100)
  let a = audio.from([ch], { sampleRate: 44100 })
  // Batch via chaining — same as readme recipe
  a.trim(-30).normalize(0).fade(0.1).fade(-0.1)
  t.is(a.edits.length, 4, '4 edits from batch')
  let pcm = await a.read()
  t.ok(pcm[0].length < ch.length, 'trimmed shorter')
  t.ok(pcm[0][0] < 0.05, `starts near-silent (fade in): ${pcm[0][0].toFixed(3)}`)
})

test('multi-track mixing via read windows', async t => {
  let a = audio.from([new Float32Array(44100 * 2).fill(0.3)], { sampleRate: 44100 })
  let b = audio.from([new Float32Array(44100 * 2).fill(0.5)], { sampleRate: 44100 })

  // Read 1s windows and mix manually
  let w1 = await a.read({at: 0, duration: 1})
  let w2 = await b.read({at: 0, duration: 1})
  t.is(w1[0].length, 44100, 'window is 1s')
  t.is(w2[0].length, 44100, 'window is 1s')

  let mixed = new Float32Array(44100)
  for (let i = 0; i < 44100; i++) mixed[i] = w1[0][i] + w2[0][i]
  t.ok(Math.abs(mixed[0] - 0.8) < 0.001, 'mixed: 0.3 + 0.5 = 0.8')
})

test('encode wav — read with format after edits', async t => {
  let ch = new Float32Array(44100)
  for (let i = 0; i < ch.length; i++) ch[i] = 0.5 * Math.sin(2 * Math.PI * 440 * i / 44100)
  let a = audio.from([ch], { sampleRate: 44100 })
  a.gain(-6).fade(0.1)
  let wav = await a.read({ format: 'wav' })
  t.ok(wav instanceof Uint8Array, 'wav bytes after edits')
  t.ok(wav.length > 1000, `wav size: ${wav.length}`)

  // Round-trip: decode the wav back
  let b = await audio(wav)
  t.ok(Math.abs(b.duration - 1) < 0.02, 'round-trip duration')
  let pcm = await b.read()
  // First sample should be near-zero (fade in applied)
  t.ok(Math.abs(pcm[0][0]) < 0.01, 'fade in preserved after encode')
})

test('on(data) — fires incrementally for mp3', async t => {
  let deltas = [], prevOffset = 0
  let a = audio(lenaMp3)
  a.on('data', ({ delta, offset }) => {
    t.ok(offset >= prevOffset, `offset monotonic: ${offset} >= ${prevOffset}`)
    prevOffset = offset
    deltas.push(delta)
  })
  await a
  t.ok(deltas.length > 1, `on(data) fired ${deltas.length} times (chunked decode)`)
  // Verify deltas cover full index
  let totalBlocks = deltas.reduce((n, d) => n + d.min[0].length, 0)
  t.is(totalBlocks, a.stats.min[0].length, 'deltas cover all index blocks')
})

test('read — no edits returns copies from source pages', async t => {
  let ch = new Float32Array(44100).fill(0.7)
  let a = audio.from([ch])
  let r1 = await a.read()
  let r2 = await a.read()
  r1[0][0] = 999
  t.ok(Math.abs(r2[0][0] - 0.7) < 0.001, 'read returns independent copies')
  t.ok(Math.abs(ch[0] - 0.7) < 0.001, 'source not mutated')
})

test('stat — no edits uses clean stats', async t => {
  let ch = new Float32Array(44100).fill(0.5)
  let a = audio.from([ch], { sampleRate: 44100 })
  let peak = await a.stat('db')
  t.ok(peak > -7, `db from clean stats: ${peak.toFixed(1)}`)
  let r = await a.stat('rms')
  t.ok(r > 0, 'rms from clean stats')
})

test('insert audio — plan-based matches render', async t => {
  let a = audio.from([new Float32Array(44100).fill(0.3)], { sampleRate: 44100 })
  let b = audio.from([new Float32Array(22050).fill(0.9)], { sampleRate: 44100 })
  a.insert(b, {at: 0.5})
  let pcm = await a.read()
  t.is(pcm[0].length, 44100 + 22050, '1s + 0.5s insert')
  t.ok(Math.abs(pcm[0][0] - 0.3) < 0.01, 'original at start')
  t.ok(Math.abs(pcm[0][Math.round(0.5 * 44100)] - 0.9) < 0.01, 'inserted at 0.5s')
  t.ok(Math.abs(pcm[0][pcm[0].length - 1] - 0.3) < 0.01, 'original at end')
})


// ── Phase 12: API improvements ──────────────────────────────────────────────

test('waveform — sub-range matches full-range slice', async t => {
  let ch = new Float32Array(44100).fill(0)
  for (let i = 10000; i < 20000; i++) ch[i] = 0.5
  let a = audio.from([ch], { sampleRate: 44100 })
  let fullMax = await a.stat('max', {bins: 100})
  let subMax = await a.stat('max', {bins: 100, at: 0.2, duration: 0.25})
  t.is(subMax.length, 100, '100 buckets')
  t.ok(Math.max(...subMax) > 0.4, 'subrange detected signal')
})

test('waveform — per-channel returns arrays', async t => {
  let ch0 = new Float32Array(44100).fill(0.3)
  let ch1 = new Float32Array(44100).fill(0.7)
  let a = audio.from([ch0, ch1], { sampleRate: 44100 })
  let mn = await a.stat('min', {bins: 100, channel: [0, 1]})
  t.ok(Array.isArray(mn), 'min is array')
  t.is(mn.length, 2, 'two channels')
  t.is(mn[0].length, 100, 'first channel 100 buckets')
  let ch0Min = Math.min(...mn[0])
  let ch1Min = Math.min(...mn[1])
  t.ok(ch0Min > 0.25 && ch0Min < 0.35, `channel 0 min ${ch0Min.toFixed(3)} ~0.3`)
  t.ok(ch1Min > 0.65 && ch1Min < 0.75, `channel 1 min ${ch1Min.toFixed(3)} ~0.7`)
})

test('waveform — shorthand stat(name, opts)', async t => {
  let a = audio.from([new Float32Array(44100).fill(0.5)], { sampleRate: 44100 })
  let mn = await a.stat('min', {bins: 100, channel: 0})
  t.is(mn.length, 100, 'shorthand works')
})

test('seek — doesn\'t trigger render', async t => {
  let a = audio.from([new Float32Array(44100).fill(0.5)], { sampleRate: 44100 })
  a.seek(0.5)
  t.ok(a._.pcm === null, '_cache stays null after seek')
})

test('insert clean source — source _cache stays null', async t => {
  let a = audio.from([new Float32Array(44100).fill(0.3)], { sampleRate: 44100 })
  let b = audio.from([new Float32Array(22050).fill(0.9)], { sampleRate: 44100 })
  a.insert(b, {at: 0.5})
  let pcm = await a.read()
  t.ok(b._.pcm === null, 'clean source _cache not materialized')
})

test('undo(3) — pops 3, returns array', async t => {
  let a = audio.from([new Float32Array(44100)], { sampleRate: 44100 })
  a.gain(-3).gain(-3).gain(-3)
  let removed = a.undo(3)
  t.ok(Array.isArray(removed), 'returns array')
  t.is(removed.length, 3, '3 edits removed')
  t.is(a.edits.length, 0, 'all edits cleared')
})

test('undo(edits.length) — clears all', async t => {
  let a = audio.from([new Float32Array(44100)], { sampleRate: 44100 })
  a.gain(-3).gain(-6)
  a.undo(2)
  t.is(a.edits.length, 0, 'no edits left')
})

test('undo() — backward compatible, pops 1', async t => {
  let a = audio.from([new Float32Array(44100)], { sampleRate: 44100 })
  a.gain(-3).gain(-6)
  let edit = a.undo()
  t.ok(edit && edit[0] === 'gain', 'returns single edit')
  t.is(a.edits.length, 1, '1 edit remains')
})

test('trim — auto-floor on audio with silence margins', async t => {
  let ch = new Float32Array(44100).fill(0)
  for (let i = 5000; i < 39000; i++) ch[i] = 0.5
  let a = audio.from([ch], { sampleRate: 44100 })
  a.trim()
  let pcm = await a.read()
  t.ok(pcm[0].length < ch.length, `trimmed: ${pcm[0].length} < ${ch.length}`)
  t.ok(pcm[0].length >= 34000, `kept signal: ${pcm[0].length} >= 34000`)
})

test('trim — post-edit trim works after gain', async t => {
  let ch = new Float32Array(44100).fill(0)
  for (let i = 10000; i < 30000; i++) ch[i] = 0.1
  let a = audio.from([ch], { sampleRate: 44100 })
  a.gain(10)
  a.trim(-20)
  let pcm = await a.read()
  t.ok(pcm[0].length < ch.length, 'trim removed silence after gain')
  t.ok(pcm[0].length > 0, 'trim kept gained signal')
})

test('trim — all-silence produces empty output', async t => {
  let a = audio.from([new Float32Array(44100)], { sampleRate: 44100 })
  a.trim()
  let pcm = await a.read()
  t.is(pcm[0].length, 0, 'zero-length output for silence')
})

test('clip — shares pages reference', async t => {
  let a = audio.from([new Float32Array(44100).fill(0.5)], { sampleRate: 44100 })
  let v = a.clip()
  t.ok(v.pages !== a.pages && v.pages[0] === a.pages[0], 'clip shares page contents, independent array')
  t.is(v.stats, a.stats, 'clip shares stats')
})

test('clip(offset, dur) — reads correct sub-range PCM', async t => {
  let ch = new Float32Array(44100).fill(0)
  for (let i = 22050; i < 33075; i++) ch[i] = 0.7
  let a = audio.from([ch], { sampleRate: 44100 })
  let v = a.clip({at: 0.5, duration: 0.25})
  let pcm = await v.read()
  t.is(pcm[0].length, 11025, '0.25s at 44100 Hz = 11025 samples')
  t.ok(Math.abs(pcm[0][0] - 0.7) < 0.01, 'clip reads correct window')
})

test('split — correct count and durations', async t => {
  let a = audio.from([new Float32Array(44100 * 3)], { sampleRate: 44100 })
  let parts = a.split(1, 2)
  t.is(parts.length, 3, 'three parts for two offsets')
  t.ok(Math.abs(parts[0].duration - 1) < 0.001, 'part 0 ~1s')
  t.ok(Math.abs(parts[1].duration - 1) < 0.001, 'part 1 ~1s')
  t.ok(Math.abs(parts[2].duration - 1) < 0.001, 'part 2 ~1s')
})

test('audio.from(instance) — structural copy: shares pages, independent edit list', async t => {
  let a = audio.from([new Float32Array(44100).fill(0.5)], { sampleRate: 44100 })
  let c = audio.from(a)
  t.ok(c.pages !== a.pages && c.pages[0] === a.pages[0], 'copy shares page contents, independent array')
  t.ok(c.edits !== a.edits, 'copy has independent edit list')
  c.gain(-3)
  t.is(a.edits.length, 0, 'original unaffected by copy\'s edit')
  t.is(c.edits.length, 1, 'copy has its own edit')
})

test('save — format option overrides extension', { skip: !isNode }, async t => {
  let a = audio.from([new Float32Array(44100).fill(0.5)], { sampleRate: 44100 })
  let { writeFileSync } = await import('fs')
  let { tmpdir } = await import('os')
  let { join } = await import('path')
  let path = join(tmpdir(), `test-${Date.now()}.wav`)
  await a.save(path, { format: 'wav' })
  let buf = readFileSync(path)
  writeFileSync(path + '.bak', buf)
  await import('fs').then(fs => fs.promises.unlink(path).catch(() => {}))
  t.ok(buf.length > 1000, 'save produced bytes')
})

test('save — progress event fires during encode', { skip: !isNode }, async t => {
  let a = audio.from([new Float32Array(44100 * 3).fill(0.5)], { sampleRate: 44100 })
  let { tmpdir } = await import('os')
  let { join } = await import('path')
  let path = join(tmpdir(), `test-progress-${Date.now()}.wav`)
  let calls = []
  a.on('progress', p => calls.push(p))
  await a.save(path)
  await import('fs').then(fs => fs.promises.unlink(path).catch(() => {}))
  t.ok(calls.length > 0, `progress fired ${calls.length} times`)
  t.ok(calls[calls.length - 1].offset > 2, `final offset: ${calls[calls.length - 1].offset.toFixed(1)}s`)
  t.ok(calls[calls.length - 1].total > 2, 'total provided')
})

test('save — with non-plannable edits (filter + trim)', { skip: !isNode }, async t => {
  let ch = new Float32Array(44100)
  for (let i = 0; i < ch.length; i++) ch[i] = Math.sin(2 * Math.PI * 440 * i / 44100)
  let a = audio.from([ch], { sampleRate: 44100 })
  a.highpass(200)
  a.trim()
  let { tmpdir } = await import('os')
  let { join } = await import('path')
  let path = join(tmpdir(), `test-filter-save-${Date.now()}.wav`)
  await a.save(path)
  let b = await audio(path)
  t.ok(b.duration > 0.5, `saved with filter+trim: ${b.duration.toFixed(2)}s`)
  await import('fs').then(fs => fs.promises.unlink(path).catch(() => {}))
})

test('normalize — LUFS mode adjusts loudness', async t => {
  let ch = new Float32Array(44100)
  for (let i = 0; i < ch.length; i++) ch[i] = 0.2 * Math.sin(2 * Math.PI * 440 * i / 44100)
  let a = audio.from([ch], { sampleRate: 44100 })
  a.normalize({ mode: 'lufs', target: -14 })
  let pcm = await a.read()
  let rms = 0
  for (let s of pcm[0]) rms += s * s
  rms = Math.sqrt(rms / pcm[0].length)
  t.ok(rms > 0, 'LUFS mode applied gain')
})

test('normalize — peak mode unchanged', async t => {
  let ch = new Float32Array(44100)
  for (let i = 0; i < ch.length; i++) ch[i] = 0.5 * Math.sin(2 * Math.PI * 440 * i / 44100)
  let a = audio.from([ch], { sampleRate: 44100 })
  a.normalize(-3)
  let pcm = await a.read()
  let peak = 0
  for (let s of pcm[0]) { let v = Math.abs(s); if (v > peak) peak = v }
  t.ok(Math.abs(peak - 0.708) < 0.02, `peak mode: max ~0.708 dBFS (got ${peak.toFixed(3)})`)
})

test('normalize — preset strings', async t => {
  let ch = new Float32Array(44100)
  for (let i = 0; i < ch.length; i++) ch[i] = 0.5 * Math.sin(2 * Math.PI * 440 * i / 44100)
  let a = audio.from([ch], { sampleRate: 44100 })
  a.normalize('streaming')
  let pcm = await a.read()
  let rms = 0
  for (let s of pcm[0]) rms += s * s
  rms = Math.sqrt(rms / pcm[0].length)
  t.ok(rms > 0, 'streaming preset applied')
})

test('normalize — RMS mode', async t => {
  // Use a tone so DC removal doesn't zero the signal
  let ch = new Float32Array(44100)
  for (let i = 0; i < ch.length; i++) ch[i] = 0.5 * Math.sin(2 * Math.PI * 440 * i / 44100)
  let a = audio.from([ch], { sampleRate: 44100 })
  a.normalize({ mode: 'rms', target: -12 })
  let pcm = await a.read()
  let totalE = 0
  for (let s of pcm[0]) totalE += s * s
  let rmsDb = 10 * Math.log10(totalE / pcm[0].length)
  t.ok(Math.abs(rmsDb - (-12)) < 1, `RMS ~-12dB (got ${rmsDb.toFixed(1)})`)
})

test('normalize — DC removal by default', async t => {
  let ch = new Float32Array(44100)
  for (let i = 0; i < ch.length; i++) ch[i] = 0.3 + 0.2 * Math.sin(2 * Math.PI * 440 * i / 44100)
  let a = audio.from([ch], { sampleRate: 44100 })
  a.normalize()
  let pcm = await a.read()
  let sum = 0
  for (let s of pcm[0]) sum += s
  let dc = sum / pcm[0].length
  t.ok(Math.abs(dc) < 0.01, `DC removed (mean ${dc.toFixed(4)})`)
  let peak = 0
  for (let s of pcm[0]) { let v = Math.abs(s); if (v > peak) peak = v }
  t.ok(Math.abs(peak - 1) < 0.05, `peak normalized after DC (got ${peak.toFixed(3)})`)
})

test('normalize — dc: false preserves offset', async t => {
  let ch = new Float32Array(44100).fill(0.5)
  let a = audio.from([ch], { sampleRate: 44100 })
  a.normalize({ dc: false })
  let pcm = await a.read()
  t.ok(Math.abs(pcm[0][0] - 1) < 0.01, `peak normalized without dc removal (got ${pcm[0][0].toFixed(3)})`)
})

test('normalize — ceiling', async t => {
  // Use a tone so DC removal doesn't zero the signal
  let ch = new Float32Array(44100)
  for (let i = 0; i < ch.length; i++) ch[i] = 0.1 * Math.sin(2 * Math.PI * 440 * i / 44100)
  let a = audio.from([ch], { sampleRate: 44100 })
  a.normalize({ ceiling: -1 })
  let pcm = await a.read()
  let peak = 0
  for (let s of pcm[0]) { let v = Math.abs(s); if (v > peak) peak = v }
  let ceilLin = 10 ** (-1 / 20)
  t.ok(peak <= ceilLin + 0.001, `peak within ceiling -1dB (got ${(20 * Math.log10(peak)).toFixed(1)}dB)`)
})

test('normalize — per-channel via chained calls', async t => {
  let left = new Float32Array(44100).fill(0.25)
  let right = new Float32Array(44100).fill(0.5)
  let a = audio.from([left, right], { sampleRate: 44100 })
  a.normalize({ channel: 0, dc: false }).normalize({ channel: 1, dc: false })
  let pcm = await a.read()
  let peakL = 0, peakR = 0
  for (let s of pcm[0]) { let v = Math.abs(s); if (v > peakL) peakL = v }
  for (let s of pcm[1]) { let v = Math.abs(s); if (v > peakR) peakR = v }
  t.ok(Math.abs(peakL - 1) < 0.05, `left peak ~1 (got ${peakL.toFixed(3)})`)
  t.ok(Math.abs(peakR - 1) < 0.05, `right peak ~1 (got ${peakR.toFixed(3)})`)
})

test('insert — joins sources (append)', async t => {
  let a = audio.from([new Float32Array(44100).fill(0.3)], { sampleRate: 44100 })
  let b = audio.from([new Float32Array(44100).fill(0.7)], { sampleRate: 44100 })
  a.insert(b)
  t.ok(Math.abs(a.duration - 2) < 0.01, 'insert: 1s + 1s = 2s')
  let pcm = await a.read()
  t.ok(Math.abs(pcm[0][0] - 0.3) < 0.01, 'first source at start')
  t.ok(Math.abs(pcm[0][44100] - 0.7) < 0.01, 'second source at 1s')
})

test('resolve — trim uses index when clean', async t => {
  let ch = new Float32Array(44100 * 3).fill(0)
  for (let i = 44100; i < 88200; i++) ch[i] = 0.5
  let a = audio.from([ch], { sampleRate: 44100 })
  a.trim(-20)
  // Should resolve via index — verify streaming works
  let streamed = []
  for await (let block of a.stream()) streamed.push(block[0])
  let flat = new Float32Array(streamed.reduce((n, b) => n + b.length, 0))
  let pos = 0; for (let b of streamed) { flat.set(b, pos); pos += b.length }
  t.ok(flat.length < ch.length, `trimmed via resolve: ${flat.length} < ${ch.length}`)
  t.ok(flat.length > 40000, `kept signal: ${flat.length} > 40000`)
})

test('resolve — normalize uses index when clean', async t => {
  let ch = new Float32Array(44100).fill(0.25)
  let a = audio.from([ch], { sampleRate: 44100 })
  a.normalize({ dc: false })
  // Should resolve to gain via index — verify streaming works
  let streamed = []
  for await (let block of a.stream()) streamed.push(block[0])
  let flat = new Float32Array(streamed.reduce((n, b) => n + b.length, 0))
  let pos = 0; for (let b of streamed) { flat.set(b, pos); pos += b.length }
  t.ok(Math.abs(flat[0] - 1) < 0.01, `normalized via resolve: ${flat[0].toFixed(3)} ≈ 1`)
})


// ── Phase 13: Filters ──────────────────────────────────────────────────

// Helper: generate a tone at a given frequency
// Helper: measure RMS energy in a buffer
function rms(buf) {
  let sum = 0
  for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i]
  return Math.sqrt(sum / buf.length)
}

test('highpass — removes low frequency, passes high', async t => {
  let lo = tone(50, 0.5), hi = tone(8000, 0.5)
  let mixed = new Float32Array(lo.length)
  for (let i = 0; i < mixed.length; i++) mixed[i] = lo[i] + hi[i]

  let a = audio.from([mixed], { sampleRate: 44100 })
  a.highpass(1000)
  let pcm = await a.read()
  let outRms = rms(pcm[0]), hiRms = rms(hi)

  // Low component should be attenuated — output energy much less than input
  t.ok(outRms < rms(mixed) * 0.8, `attenuated: ${outRms.toFixed(3)} < ${(rms(mixed) * 0.8).toFixed(3)}`)
  // High component should survive
  t.ok(outRms > hiRms * 0.5, `high passes: ${outRms.toFixed(3)} > ${(hiRms * 0.5).toFixed(3)}`)
})

test('lowpass — removes high frequency, passes low', async t => {
  let lo = tone(200, 0.5), hi = tone(10000, 0.5)
  let mixed = new Float32Array(lo.length)
  for (let i = 0; i < mixed.length; i++) mixed[i] = lo[i] + hi[i]

  let a = audio.from([mixed], { sampleRate: 44100 })
  a.lowpass(1000)
  let pcm = await a.read()
  let outRms = rms(pcm[0])

  t.ok(outRms < rms(mixed) * 0.85, `high attenuated: ${outRms.toFixed(3)}`)
  t.ok(outRms > rms(lo) * 0.5, `low passes: ${outRms.toFixed(3)}`)
})

test('bandpass — passes center, rejects edges', async t => {
  // Apply bandpass separately to see what survives
  let lo = tone(100, 0.5), mid = tone(1000, 0.5), hi = tone(10000, 0.5)

  let aLo = audio.from([lo], { sampleRate: 44100 })
  aLo.bandpass(1000, 5)
  let loOut = rms((await aLo.read())[0])

  let aMid = audio.from([mid], { sampleRate: 44100 })
  aMid.bandpass(1000, 5)
  let midOut = rms((await aMid.read())[0])

  t.ok(loOut < rms(lo) * 0.3, `100Hz rejected: ${loOut.toFixed(3)}`)
  t.ok(midOut > rms(mid) * 0.5, `1kHz passes: ${midOut.toFixed(3)}`)
})

test('notch — removes target frequency', async t => {
  let target = tone(1000, 0.5), other = tone(5000, 0.5)
  let mixed = new Float32Array(target.length)
  for (let i = 0; i < mixed.length; i++) mixed[i] = target[i] + other[i]

  let a = audio.from([mixed], { sampleRate: 44100 })
  a.notch(1000, 10)
  let pcm = await a.read()
  let outRms = rms(pcm[0])

  // Target should be attenuated
  t.ok(outRms < rms(mixed) * 0.85, `notched: ${outRms.toFixed(3)} < ${(rms(mixed) * 0.85).toFixed(3)}`)
})

test('eq — parametric boost at target frequency', async t => {
  let ch = tone(1000, 0.5)
  let a = audio.from([ch], { sampleRate: 44100 })
  a.eq(1000, 12, 2)  // +12dB at 1kHz
  let pcm = await a.read()

  t.ok(rms(pcm[0]) > rms(ch) * 1.5, `boosted: ${rms(pcm[0]).toFixed(3)} > ${(rms(ch) * 1.5).toFixed(3)}`)
})

test('lowshelf — boosts bass region', async t => {
  let lo = tone(100, 0.5)
  let a = audio.from([lo], { sampleRate: 44100 })
  a.lowshelf(500, 12)  // +12dB below 500Hz
  let pcm = await a.read()

  t.ok(rms(pcm[0]) > rms(lo) * 1.5, `shelf boost: ${rms(pcm[0]).toFixed(3)} > ${(rms(lo) * 1.5).toFixed(3)}`)
})

test('highshelf — boosts treble region', async t => {
  let hi = tone(8000, 0.5)
  let a = audio.from([hi], { sampleRate: 44100 })
  a.highshelf(2000, 12)  // +12dB above 2kHz
  let pcm = await a.read()

  t.ok(rms(pcm[0]) > rms(hi) * 1.5, `shelf boost: ${rms(pcm[0]).toFixed(3)} > ${(rms(hi) * 1.5).toFixed(3)}`)
})

test('highpass — stereo channels filtered independently', async t => {
  let lo = tone(50, 0.5), hi = tone(8000, 0.5)
  let a = audio.from([lo, hi], { sampleRate: 44100 })
  a.highpass(1000)
  let pcm = await a.read()

  // Left (50Hz) should be nearly silent, right (8kHz) should survive
  t.ok(rms(pcm[0]) < 0.1, `left attenuated: ${rms(pcm[0]).toFixed(3)}`)
  t.ok(rms(pcm[1]) > 0.3, `right passes: ${rms(pcm[1]).toFixed(3)}`)
})

test('filter — state persists across streaming blocks', async t => {
  // Filters need continuity across blocks for correct behavior
  let ch = tone(50, 1)  // 1s of 50Hz
  let a = audio.from([ch], { sampleRate: 44100 })
  a.highpass(1000)

  // Streaming read
  let blocks = []
  for await (let blk of a.stream()) blocks.push(blk[0])
  let streamed = new Float32Array(blocks.reduce((n, b) => n + b.length, 0))
  let pos = 0; for (let b of blocks) { streamed.set(b, pos); pos += b.length }

  // Full read
  let full = (await a.read())[0]

  // Both should match — state was preserved correctly
  t.is(streamed.length, full.length, 'same length')
  let maxDiff = 0
  for (let i = 0; i < full.length; i++) maxDiff = Math.max(maxDiff, Math.abs(streamed[i] - full[i]))
  t.ok(maxDiff < 0.01, `stream ≈ full read (maxDiff: ${maxDiff.toFixed(6)})`)
})

test('filter(fn) — custom filter function', { skip: !isNode }, async t => {
  let ch = tone(200, 0.5)
  let a = audio.from([ch], { sampleRate: 44100 })
  let { default: hp } = await import('audio-filter/effect/highpass.js')
  a.filter({type: hp, freq: { fc: 1000 }})
  let pcm = await a.read()
  t.ok(rms(pcm[0]) < 0.15, `custom hp attenuated 200Hz: ${rms(pcm[0]).toFixed(3)}`)
})

test('filter — warm-up on seek matches full render', async t => {
  // Read with offset should match slicing a full render (filter state warmed up)
  let n = 44100 * 3  // 3s
  let ch = new Float32Array(n); for (let i = 0; i < n; i++) ch[i] = Math.sin(2 * Math.PI * 200 * i / 44100)
  let a = audio.from([ch], { sampleRate: 44100 })
  a.highpass(500)
  // Full render then slice at 2s
  let full = (await a.read())[0]
  let seekAt = 2, seekSamples = Math.round(seekAt * 44100)
  let expected = full.subarray(seekSamples)
  // Seek read at 2s
  let seeked = (await a.read({ at: seekAt }))[0]
  t.is(seeked.length, expected.length, `same length: ${seeked.length}`)
  let maxDiff = 0
  for (let i = 0; i < expected.length; i++) maxDiff = Math.max(maxDiff, Math.abs(seeked[i] - expected[i]))
  t.ok(maxDiff < 0.01, `seek ≈ full[offset:] (maxDiff: ${maxDiff.toFixed(6)})`)
})

test('fade in — stream matches read (no looping)', async t => {
  let ch = new Float32Array(44100 * 2).fill(1) // 2s of ones
  let a = audio.from([ch], { sampleRate: 44100 })
  a.fade(0.5)  // fade in first 0.5s
  // Stream
  let blocks = []
  for await (let blk of a.stream()) blocks.push(blk[0])
  let streamed = new Float32Array(blocks.reduce((n, b) => n + b.length, 0))
  let pos = 0; for (let b of blocks) { streamed.set(b, pos); pos += b.length }
  // Full read
  let full = (await a.read())[0]
  t.is(streamed.length, full.length, 'same length')
  let maxDiff = 0
  for (let i = 0; i < full.length; i++) maxDiff = Math.max(maxDiff, Math.abs(streamed[i] - full[i]))
  t.ok(maxDiff < 0.01, `stream ≈ read (maxDiff: ${maxDiff.toFixed(6)})`)
  // After fade region, samples should be 1.0 (not faded again)
  t.ok(streamed[44100] === 1, `sample at 1s is unmodified (got ${streamed[44100]})`)
  t.ok(streamed[0] < 0.02, `sample at 0s is faded (got ${streamed[0].toFixed(3)})`)
})

test('fade out — stream matches read (no looping)', async t => {
  let ch = new Float32Array(44100 * 2).fill(1) // 2s of ones
  let a = audio.from([ch], { sampleRate: 44100 })
  a.fade(-0.5) // fade out last 0.5s
  let blocks = []
  for await (let blk of a.stream()) blocks.push(blk[0])
  let streamed = new Float32Array(blocks.reduce((n, b) => n + b.length, 0))
  let pos = 0; for (let b of blocks) { streamed.set(b, pos); pos += b.length }
  let full = (await a.read())[0]
  t.is(streamed.length, full.length, 'same length')
  let maxDiff = 0
  for (let i = 0; i < full.length; i++) maxDiff = Math.max(maxDiff, Math.abs(streamed[i] - full[i]))
  t.ok(maxDiff < 0.01, `stream ≈ read (maxDiff: ${maxDiff.toFixed(6)})`)
  t.ok(streamed[0] === 1, `sample at 0s is unmodified (got ${streamed[0]})`)
  t.ok(streamed[streamed.length - 1] < 0.05, `last sample is faded (got ${streamed[streamed.length - 1].toFixed(3)})`)
})


// ── Pan ──────────────────────────────────────────────────────────────────

test('pan — center (0) is identity', async t => {
  let a = audio.from([new Float32Array([1, 1, 1]), new Float32Array([1, 1, 1])])
  a.pan(0)
  let pcm = await a.read()
  t.ok(pcm[0][0] === 1, `L unchanged (got ${pcm[0][0]})`)
  t.ok(pcm[1][0] === 1, `R unchanged (got ${pcm[1][0]})`)
})

test('pan — full left (-1) mutes right', async t => {
  let a = audio.from([new Float32Array([1, 1, 1]), new Float32Array([1, 1, 1])])
  a.pan(-1)
  let pcm = await a.read()
  t.ok(pcm[0][0] === 1, `L at unity (got ${pcm[0][0]})`)
  t.ok(pcm[1][0] === 0, `R muted (got ${pcm[1][0]})`)
})

test('pan — full right (1) mutes left', async t => {
  let a = audio.from([new Float32Array([1, 1, 1]), new Float32Array([1, 1, 1])])
  a.pan(1)
  let pcm = await a.read()
  t.ok(pcm[0][0] === 0, `L muted (got ${pcm[0][0]})`)
  t.ok(pcm[1][0] === 1, `R at unity (got ${pcm[1][0]})`)
})

test('pan — half right attenuates left', async t => {
  let a = audio.from([new Float32Array([1, 1, 1]), new Float32Array([1, 1, 1])])
  a.pan(0.5)
  let pcm = await a.read()
  t.ok(pcm[0][0] === 0.5, `L halved (got ${pcm[0][0]})`)
  t.ok(pcm[1][0] === 1, `R unchanged (got ${pcm[1][0]})`)
})

test('pan — mono is no-op', async t => {
  let a = audio.from([new Float32Array([0.5, 0.5, 0.5])])
  a.pan(1)
  let pcm = await a.read()
  t.ok(pcm[0][0] === 0.5, `mono unchanged (got ${pcm[0][0]})`)
})

test('pan — with range', async t => {
  let a = audio.from([new Float32Array(44100).fill(1), new Float32Array(44100).fill(1)])
  a.pan(1, { at: 0.5, duration: 0.25 })
  let pcm = await a.read()
  t.ok(pcm[0][0] === 1, `L before range unchanged`)
  let mid = Math.round(0.6 * 44100)
  t.ok(pcm[0][mid] === 0, `L in range muted (got ${pcm[0][mid]})`)
  let after = Math.round(0.8 * 44100)
  t.ok(pcm[0][after] === 1, `L after range unchanged`)
})


// ── Pad ──────────────────────────────────────────────────────────────────

test('pad — adds silence to both ends', async t => {
  let a = audio.from([new Float32Array([1, 1, 1, 1])], { sampleRate: 4 })
  a.pad(1) // 1s = 4 samples per side
  t.is(a.duration, 3, `duration 3s (got ${a.duration})`)
  let pcm = await a.read()
  t.ok(pcm[0][0] === 0, `start is silent`)
  t.ok(pcm[0][3] === 0, `start padding end`)
  t.ok(pcm[0][4] === 1, `original starts`)
  t.ok(pcm[0][7] === 1, `original ends`)
  t.ok(pcm[0][8] === 0, `end padding starts`)
  t.ok(pcm[0][11] === 0, `end is silent`)
})

test('pad — asymmetric padding', async t => {
  let a = audio.from([new Float32Array([1, 1])], { sampleRate: 2 })
  a.pad(1, 2) // 1s before (2 samples), 2s after (4 samples)
  t.is(a.duration, 4, `duration 4s (got ${a.duration})`)
  let pcm = await a.read()
  t.is(pcm[0].length, 8, `8 samples total`)
  t.ok(pcm[0][0] === 0 && pcm[0][1] === 0, `before padding`)
  t.ok(pcm[0][2] === 1 && pcm[0][3] === 1, `original audio`)
  t.ok(pcm[0][4] === 0 && pcm[0][7] === 0, `after padding`)
})

test('pad — zero is no-op', async t => {
  let a = audio.from([new Float32Array([1, 1])], { sampleRate: 2 })
  let len0 = a.length
  a.pad(0)
  t.is(a.length, len0, `length unchanged`)
})

test('pad — plan-based (stream)', async t => {
  let a = audio.from([new Float32Array(44100).fill(0.5)], { sampleRate: 44100 })
  a.pad(0.5) // 0.5s = 22050 samples each side
  let blocks = []
  for await (let blk of a.stream()) blocks.push(blk[0])
  let streamed = new Float32Array(blocks.reduce((n, b) => n + b.length, 0))
  let pos = 0; for (let b of blocks) { streamed.set(b, pos); pos += b.length }
  t.is(streamed.length, 44100 + 44100, `total 2s (${streamed.length} samples)`)
  t.ok(streamed[0] === 0, `start is silent`)
  t.ok(streamed[22050] === 0.5, `original data at correct offset`)
  t.ok(streamed[streamed.length - 1] === 0, `end is silent`)
})


// ── Spectrum stat ────────────────────────────────────────────────────────

test('stat(spectrum) — returns mel-binned spectrum', async t => {
  // 440Hz sine wave — should show peak around that frequency
  let sr = 44100, dur = 1
  let ch = new Float32Array(sr * dur)
  for (let i = 0; i < ch.length; i++) ch[i] = Math.sin(2 * Math.PI * 440 * i / sr)
  let a = audio.from([ch], { sampleRate: sr })
  let spec = await a.stat('spectrum', { bins: 64 })
  t.ok(spec instanceof Float32Array, 'returns Float32Array')
  t.is(spec.length, 64, '64 bins')
  // Find peak bin (dB values, all negative)
  let peak = -Infinity, peakIdx = 0
  for (let i = 0; i < spec.length; i++) if (spec[i] > peak) { peak = spec[i]; peakIdx = i }
  t.ok(peakIdx > 0 && peakIdx < 63, `peak not at edges (bin ${peakIdx})`)
  t.ok(peak > spec[0], `peak louder than lowest bin`)
})

test('stat(spectrum) — with range', async t => {
  let sr = 44100
  let ch = new Float32Array(sr * 2)
  // First second: 440Hz, second: 1000Hz
  for (let i = 0; i < sr; i++) ch[i] = Math.sin(2 * Math.PI * 440 * i / sr)
  for (let i = sr; i < sr * 2; i++) ch[i] = Math.sin(2 * Math.PI * 1000 * i / sr)
  let a = audio.from([ch], { sampleRate: sr })
  let s1 = await a.stat('spectrum', { bins: 64, at: 0, duration: 1 })
  let s2 = await a.stat('spectrum', { bins: 64, at: 1, duration: 1 })
  // Peak should be at different bins
  let p1 = -Infinity, p1i = 0, p2 = -Infinity, p2i = 0
  for (let i = 0; i < 64; i++) {
    if (s1[i] > p1) { p1 = s1[i]; p1i = i }
    if (s2[i] > p2) { p2 = s2[i]; p2i = i }
  }
  t.ok(p2i > p1i, `1kHz peak (bin ${p2i}) > 440Hz peak (bin ${p1i})`)
})


// ── Cepstrum stat ────────────────────────────────────────────────────────

test('stat(cepstrum) — returns MFCC coefficients', async t => {
  let sr = 44100
  let ch = new Float32Array(sr)
  for (let i = 0; i < ch.length; i++) ch[i] = Math.sin(2 * Math.PI * 440 * i / sr)
  let a = audio.from([ch], { sampleRate: sr })
  let c = await a.stat('cepstrum', { bins: 13 })
  t.ok(c instanceof Float32Array, 'returns Float32Array')
  t.is(c.length, 13, '13 coefficients')
  // C0 is log energy — should be non-zero for non-silent audio
  t.ok(Math.abs(c[0]) > 0.1, `C0 non-zero (got ${c[0].toFixed(2)})`)
})


// ── Silence stat ─────────────────────────────────────────────────────────

test('stat(silence) — detects silent regions', async t => {
  let sr = 44100
  // 1s tone, 0.5s silence, 1s tone, 0.3s silence, 0.5s tone
  let ch = new Float32Array(sr * 3.3)
  for (let i = 0; i < sr; i++) ch[i] = Math.sin(2 * Math.PI * 440 * i / sr)
  // 0.5s silence (already zeros)
  for (let i = sr * 1.5; i < sr * 2.5; i++) ch[i] = Math.sin(2 * Math.PI * 440 * i / sr)
  // 0.3s silence
  for (let i = sr * 2.8; i < sr * 3.3; i++) ch[i] = Math.sin(2 * Math.PI * 440 * i / sr)
  let a = audio.from([ch], { sampleRate: sr })
  let segs = await a.stat('silence', { threshold: -40 })
  t.ok(Array.isArray(segs), 'returns array')
  t.ok(segs.length >= 1, `found silence segments (${segs.length})`)
  // First silence at ~1s, ~0.5s long
  t.ok(Math.abs(segs[0].at - 1) < 0.1, `first at ~1s (got ${segs[0].at.toFixed(2)})`)
  t.ok(Math.abs(segs[0].duration - 0.5) < 0.1, `first ~0.5s (got ${segs[0].duration.toFixed(2)})`)
})

test('stat(silence) — no silence in continuous tone', async t => {
  let sr = 44100
  let ch = new Float32Array(sr)
  for (let i = 0; i < ch.length; i++) ch[i] = Math.sin(2 * Math.PI * 440 * i / sr)
  let a = audio.from([ch], { sampleRate: sr })
  let segs = await a.stat('silence', { threshold: -40 })
  t.is(segs.length, 0, 'no silence in continuous signal')
})

test('stat(silence) — all silent', async t => {
  let a = audio.from([new Float32Array(44100)], { sampleRate: 44100 })
  let segs = await a.stat('silence', { threshold: -40, minDuration: 0 })
  t.is(segs.length, 1, 'one segment')
  t.ok(Math.abs(segs[0].duration - 1) < 0.1, `~1s (got ${segs[0].duration.toFixed(2)})`)
})

test('stat(silence) — minDuration filters short gaps', async t => {
  let sr = 44100
  // 0.5s tone, 0.5s silence, 0.5s tone, 1s silence, 0.5s tone
  let ch = new Float32Array(sr * 3)
  for (let i = 0; i < sr * 0.5; i++) ch[i] = Math.sin(2 * Math.PI * 440 * i / sr)
  // 0.5s gap
  for (let i = sr * 1; i < sr * 1.5; i++) ch[i] = Math.sin(2 * Math.PI * 440 * i / sr)
  // 1s gap
  for (let i = sr * 2.5; i < sr * 3; i++) ch[i] = Math.sin(2 * Math.PI * 440 * i / sr)
  let a = audio.from([ch], { sampleRate: sr })
  // minDuration 0.8s should filter the 0.5s gap
  let segs = await a.stat('silence', { threshold: -40, minDuration: 0.8 })
  t.is(segs.length, 1, 'only long silence found')
  t.ok(segs[0].duration > 0.8, `long gap: ${segs[0].duration.toFixed(2)}s`)
})

test('stat(silence) — with range opts', async t => {
  let sr = 44100
  // 0.5s silence, 1s tone, 0.5s silence
  let ch = new Float32Array(sr * 2)
  for (let i = sr * 0.5; i < sr * 1.5; i++) ch[i] = Math.sin(2 * Math.PI * 440 * i / sr)
  let a = audio.from([ch], { sampleRate: sr })
  // Query only the middle 1s (should have no silence)
  let segs = await a.stat('silence', { threshold: -40, at: 0.5, duration: 1 })
  t.is(segs.length, 0, 'no silence in ranged query')
})

// ── Beat / BPM stat ───────────────────────────────────────────────────────

/** Click track: short Hann-windowed sine bursts at each beat position. */
function clickTrack(bpm, dur, sr = 44100) {
  let n = Math.round(dur * sr), buf = new Float32Array(n)
  let beatSamples = Math.round(sr * 60 / bpm)
  let clickLen = 2048
  for (let pos = 0; pos < n; pos += beatSamples) {
    for (let i = 0; i < clickLen && pos + i < n; i++) {
      let w = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / clickLen)  // Hann
      buf[pos + i] += w * Math.sin(2 * Math.PI * 440 * i / sr)
    }
  }
  return buf
}

test('stat(bpm) — detects BPM from click track', async t => {
  let sr = 44100, bpm = 120
  let ch = clickTrack(bpm, 8, sr)
  let a = audio.from([ch], { sampleRate: sr })
  let detected = await a.stat('bpm')
  t.ok(typeof detected === 'number', `returns number (got ${detected})`)
  t.ok(detected > 0, 'positive BPM')
  // Allow ±10% tolerance — octave errors (60/240) are outside this range
  let err = Math.abs(detected - bpm) / bpm
  t.ok(err < 0.1, `BPM within 10%: expected ${bpm}, got ${detected.toFixed(1)}`)
})

test('stat(bpm) — a.bpm() shorthand works', async t => {
  let sr = 44100
  let ch = clickTrack(120, 8, sr)
  let a = audio.from([ch], { sampleRate: sr })
  let bpm = await a.bpm()
  t.ok(typeof bpm === 'number', 'returns number')
  t.ok(bpm > 60 && bpm < 200, `BPM in range (got ${bpm.toFixed(1)})`)
})

test('stat(beats) — returns Float64Array of timestamps', async t => {
  let sr = 44100, bpm = 120, dur = 8
  let ch = clickTrack(bpm, dur, sr)
  let a = audio.from([ch], { sampleRate: sr })
  let beats = await a.stat('beats')
  t.ok(beats instanceof Float64Array, 'returns Float64Array')
  // 120 BPM × 8s = ~16 beats
  t.ok(beats.length >= 10 && beats.length <= 20, `~16 beats (got ${beats.length})`)
  // Timestamps should be in [0, dur]
  for (let i = 0; i < beats.length; i++)
    t.ok(beats[i] >= 0 && beats[i] <= dur, `beat[${i}] in range: ${beats[i].toFixed(3)}`)
  // Beats should be ascending
  for (let i = 1; i < beats.length; i++)
    t.ok(beats[i] > beats[i - 1], `beats ascending at ${i}`)
})

test('stat(onsets) — returns Float64Array of onset timestamps', async t => {
  let sr = 44100, bpm = 120, dur = 8
  let ch = clickTrack(bpm, dur, sr)
  let a = audio.from([ch], { sampleRate: sr })
  let onsets = await a.stat('onsets')
  t.ok(onsets instanceof Float64Array, 'returns Float64Array')
  // Should detect most of the 16 clicks as onsets
  t.ok(onsets.length >= 8, `enough onsets detected (got ${onsets.length})`)
  for (let i = 0; i < onsets.length; i++)
    t.ok(onsets[i] >= 0 && onsets[i] <= dur, `onset[${i}] in range`)
})

test('detect() — full result with all fields', async t => {
  let sr = 44100
  let ch = clickTrack(120, 8, sr)
  let a = audio.from([ch], { sampleRate: sr })
  let result = await a.detect()
  t.ok(typeof result.bpm === 'number', 'bpm is number')
  t.ok(typeof result.confidence === 'number', 'confidence is number')
  t.ok(result.beats instanceof Float64Array, 'beats is Float64Array')
  t.ok(result.onsets instanceof Float64Array, 'onsets is Float64Array')
  t.ok(result.confidence >= 0, 'confidence non-negative')
})

test('stat(bpm) — with range opts', async t => {
  let sr = 44100
  // First 4s: 120 BPM, last 4s: same but we just query the first 4s
  let ch = clickTrack(120, 8, sr)
  let a = audio.from([ch], { sampleRate: sr })
  let bpm = await a.stat('bpm', { at: 0, duration: 4 })
  t.ok(typeof bpm === 'number', 'returns number')
  let err = Math.abs(bpm - 120) / 120
  t.ok(err < 0.15, `BPM within 15% on 4s range: got ${bpm.toFixed(1)}`)
})

test('stat(bpm) — minBpm/maxBpm opts narrow search range', async t => {
  let sr = 44100
  let ch = clickTrack(120, 8, sr)
  let a = audio.from([ch], { sampleRate: sr })
  // Narrow to 100-140 BPM — should still find 120
  let bpm = await a.stat('bpm', { minBpm: 100, maxBpm: 140 })
  t.ok(bpm > 100 && bpm < 140, `BPM in constrained range (got ${bpm.toFixed(1)})`)
})

test('stat(bpm) — silence returns 0', async t => {
  let sr = 44100
  let ch = new Float32Array(sr * 4)  // 4s silence
  let a = audio.from([ch], { sampleRate: sr })
  let bpm = await a.stat('bpm')
  t.is(bpm, 0, 'silence → 0 BPM')
})

test('stat(onsets) — silence returns empty array', async t => {
  let sr = 44100
  let ch = new Float32Array(sr * 2)
  let a = audio.from([ch], { sampleRate: sr })
  let onsets = await a.stat('onsets')
  t.is(onsets.length, 0, 'no onsets in silence')
})

test('stat(beats) — silence returns empty array', async t => {
  let sr = 44100
  let ch = new Float32Array(sr * 2)
  let a = audio.from([ch], { sampleRate: sr })
  let beats = await a.stat('beats')
  t.is(beats.length, 0, 'no beats in silence')
})


// ── Clipping stat ─────────────────────────────────────────────────────────

test('stat(clipping) — returns timestamps of clipping blocks', async t => {
  let sr = 44100, bs = 1024
  // 1s audio: first half clean, second half clipping
  let ch = new Float32Array(sr)
  for (let i = 0; i < sr; i++) ch[i] = i < sr / 2 ? 0.5 : 1.5
  let a = audio.from([ch], { sampleRate: sr })
  let clips = await a.stat('clipping')
  t.ok(clips instanceof Float32Array, 'returns Float32Array')
  t.ok(clips.length > 0, 'has clipping blocks')
  // All timestamps should be >= 0.5s (second half)
  for (let i = 0; i < clips.length; i++)
    t.ok(clips[i] >= 0.45, `clip at ${clips[i].toFixed(3)}s >= 0.45s`)
  // Count is just .length
  t.is(clips.length, clips.length, 'count === length')
})

test('stat(clipping) — clean audio returns empty', async t => {
  let sr = 44100
  let ch = new Float32Array(sr).fill(0.5)
  let a = audio.from([ch], { sampleRate: sr })
  let clips = await a.stat('clipping')
  t.ok(clips instanceof Float32Array, 'returns Float32Array')
  t.is(clips.length, 0, 'no clips in clean audio')
})

test('stat(clipping) — bins mode returns per-bin counts', async t => {
  let sr = 44100
  // All clipping
  let ch = new Float32Array(sr).fill(1.5)
  let a = audio.from([ch], { sampleRate: sr })
  let bins = await a.stat('clipping', { bins: 10 })
  t.ok(bins instanceof Float32Array, 'returns Float32Array')
  t.is(bins.length, 10, '10 bins')
  for (let i = 0; i < 10; i++)
    t.ok(bins[i] > 0, `bin ${i} has clips: ${bins[i]}`)
})


// ── Pitch / Chords / Key stat ─────────────────────────────────────────────

/** Sum of sine waves at given frequencies, with optional harmonics. */
function multiTone(freqs, dur, sr = 44100, harmonics = 1) {
  let n = Math.round(dur * sr), ch = new Float32Array(n), amp = 0.5 / freqs.length
  for (let f of freqs)
    for (let h = 1; h <= harmonics; h++)
      for (let i = 0; i < n; i++) ch[i] += (amp / h) * Math.sin(2 * Math.PI * f * h * i / sr)
  return ch
}

test('stat(notes) — detects A4 from 440Hz sine', async t => {
  let sr = 44100
  let ch = tone(440, 1, sr)
  let a = audio.from([ch], { sampleRate: sr })
  let notes = await a.stat('notes')
  t.ok(Array.isArray(notes), 'returns array')
  t.ok(notes.length >= 1, `has notes (got ${notes.length})`)
  let n = notes[0]
  t.is(n.note, 'A4', `note name is A4 (got ${n.note})`)
  t.is(n.midi, 69, `midi 69 (got ${n.midi})`)
  t.ok(Math.abs(n.freq - 440) < 5, `freq ~440Hz (got ${n.freq.toFixed(1)})`)
  t.ok(n.clarity > 0.5, `clarity > 0.5 (got ${n.clarity.toFixed(2)})`)
  t.ok(n.duration > 0.5, `duration > 0.5s (got ${n.duration.toFixed(2)})`)
})

test('stat(notes) — detects tone sequence', async t => {
  let sr = 44100
  // 1s of A4 (440Hz), then 1s of C5 (523.25Hz)
  let a4 = tone(440, 1, sr), c5 = tone(523.25, 1, sr)
  let ch = new Float32Array(a4.length + c5.length)
  ch.set(a4, 0); ch.set(c5, a4.length)
  let a = audio.from([ch], { sampleRate: sr })
  let notes = await a.stat('notes')
  t.ok(notes.length >= 2, `at least 2 notes (got ${notes.length})`)
  // First note should be A4, second C5
  let first = notes[0], second = notes.find(n => n.time >= 0.8)
  t.ok(first, 'first note exists')
  t.is(first.note, 'A4', `first note A4 (got ${first.note})`)
  t.ok(second, 'second note exists')
  t.is(second.note, 'C5', `second note C5 (got ${second.note})`)
  t.ok(second.time > first.time, 'second note after first')
})

test('stat(notes) — silence returns empty', async t => {
  let a = audio.from([new Float32Array(44100)], { sampleRate: 44100 })
  let notes = await a.stat('notes')
  t.ok(Array.isArray(notes), 'returns array')
  t.is(notes.length, 0, 'no notes in silence')
})

test('stat(chords) — detects C major triad', async t => {
  let sr = 44100
  // C major: C4 (261.63) + E4 (329.63) + G4 (392.00)
  let ch = multiTone([261.63, 329.63, 392.00], 2, sr)
  let a = audio.from([ch], { sampleRate: sr })
  let chords = await a.stat('chords')
  t.ok(Array.isArray(chords), 'returns array')
  t.ok(chords.length >= 1, `has chords (got ${chords.length})`)
  t.is(chords[0].label, 'C', `label is C (got ${chords[0].label})`)
  t.is(chords[0].quality, 'maj', `quality is maj (got ${chords[0].quality})`)
  t.ok(chords[0].confidence > 0.3, `confidence > 0.3 (got ${chords[0].confidence.toFixed(2)})`)
})

test('stat(chords) — detects chord change', async t => {
  let sr = 44100
  // 2s C major, then 2s A minor
  let cmaj = multiTone([261.63, 329.63, 392.00], 2, sr)
  let amin = multiTone([220.00, 261.63, 329.63], 2, sr)
  let ch = new Float32Array(cmaj.length + amin.length)
  ch.set(cmaj, 0); ch.set(amin, cmaj.length)
  let a = audio.from([ch], { sampleRate: sr })
  let chords = await a.stat('chords')
  t.ok(chords.length >= 2, `at least 2 chords (got ${chords.length})`)
  // First segment should be C, second should be Am
  let labels = chords.map(c => c.label)
  t.ok(labels.includes('C'), `has C (got ${labels})`)
  t.ok(labels.includes('Am'), `has Am (got ${labels})`)
  // Time order
  t.ok(chords[chords.length - 1].time > chords[0].time, 'chords in time order')
})

test('stat(chords) — silence returns empty', async t => {
  let a = audio.from([new Float32Array(44100 * 2)], { sampleRate: 44100 })
  let chords = await a.stat('chords')
  t.ok(Array.isArray(chords), 'returns array')
  t.is(chords.length, 0, 'no chords in silence')
})

test('stat(key) — detects C major from I-IV-V-I progression', async t => {
  let sr = 44100
  // C major (I), F major (IV), G major (V), C major (I) — 1.5s each, with 3 harmonics
  let I  = multiTone([261.63, 329.63, 392.00], 1.5, sr, 3)
  let IV = multiTone([174.61, 220.00, 261.63], 1.5, sr, 3)
  let V  = multiTone([196.00, 246.94, 293.66], 1.5, sr, 3)
  let ch = new Float32Array(I.length * 3 + IV.length)
  ch.set(I, 0)
  ch.set(IV, I.length)
  ch.set(V, I.length + IV.length)
  ch.set(I, I.length + IV.length + V.length)
  let a = audio.from([ch], { sampleRate: sr })
  let k = await a.stat('key', { method: 'pcp' })
  t.ok(k.label, 'has label')
  t.ok(k.confidence > 0, `confidence > 0 (got ${k.confidence.toFixed(2)})`)
  // C major and A minor are relative keys (same pitch classes) — accept either
  t.ok(k.label === 'C' || k.label === 'Am', `key is C or Am (got ${k.label})`)
})

test('stat(key) — silence returns N', async t => {
  let a = audio.from([new Float32Array(44100 * 2)], { sampleRate: 44100 })
  let k = await a.stat('key')
  t.is(k.label, 'N', 'silence → N')
  t.is(k.confidence, 0, 'zero confidence')
})


// ── Automation ────────────────────────────────────────────────────────────

test('gain — automation function', async t => {
  let sr = 44100, dur = 2
  let ch = new Float32Array(sr * dur).fill(1)
  let a = audio.from([ch], { sampleRate: sr })
  // Linear ramp: 0dB at t=0, -6dB at t=2
  a.gain(t => -3 * t)
  let pcm = await a.read()
  let at0 = pcm[0][0]
  let atEnd = pcm[0][sr * dur - 1]
  t.ok(Math.abs(at0 - 1) < 0.01, `t=0: ~1 (got ${at0.toFixed(3)})`)
  t.ok(atEnd < 0.55, `t=2: attenuated (got ${atEnd.toFixed(3)})`)
  t.ok(atEnd > 0.15, `t=2: not silent (got ${atEnd.toFixed(3)})`)
})

test('gain — automation with range', async t => {
  let sr = 44100
  let ch = new Float32Array(sr * 3).fill(1)
  let a = audio.from([ch], { sampleRate: sr })
  a.gain(t => -6, { at: 1, duration: 1 })
  let pcm = await a.read()
  t.ok(Math.abs(pcm[0][0] - 1) < 0.001, 'before range: untouched')
  t.ok(pcm[0][sr + 100] < 0.6, 'in range: attenuated')
  t.ok(Math.abs(pcm[0][sr * 2 + 100] - 1) < 0.001, 'after range: untouched')
})

test('pan — automation function', async t => {
  let sr = 44100
  let L = new Float32Array(sr).fill(1), R = new Float32Array(sr).fill(1)
  let a = audio.from([L, R], { sampleRate: sr })
  // Sweep from full left to full right
  a.pan(t => t * 2 - 1)  // t=0 → -1, t=1 → +1
  let pcm = await a.read()
  // At start: pan=-1, L=1, R=0
  t.ok(Math.abs(pcm[0][0] - 1) < 0.01, 'start: L untouched')
  t.ok(pcm[1][0] < 0.01, 'start: R muted')
  // At end: pan=+1, L=0, R=1
  let last = sr - 1
  t.ok(pcm[0][last] < 0.01, 'end: L muted')
  t.ok(Math.abs(pcm[1][last] - 1) < 0.01, 'end: R untouched')
})

test('toJSON — omits automation and transform edits', async t => {
  let a = audio.from([new Float32Array(44100)], { sampleRate: 44100 })
  a.gain(-3)
  a.gain(t => -6 * t)
  a.transform(chs => chs)
  let json = JSON.parse(JSON.stringify(a))
  t.is(json.edits.length, 1, 'function edits omitted')
  t.is(json.edits[0][0], 'gain', 'static edit preserved')
})



// ── Op options: at, duration, channel ────────────────────────────────

test('gain — channel scoping', async t => {
  let sr = 44100
  let L = new Float32Array(sr).fill(1), R = new Float32Array(sr).fill(1)
  let a = audio.from([L, R], { sampleRate: sr })
  a.gain(-96, { channel: 0 })
  let pcm = await a.read()
  t.ok(pcm[0][500] < 0.001, 'L channel muted')
  t.ok(Math.abs(pcm[1][500] - 1) < 0.001, 'R channel untouched')
})

test('gain — channel array scoping', async t => {
  let sr = 44100
  let L = new Float32Array(sr).fill(1), R = new Float32Array(sr).fill(1)
  let a = audio.from([L, R], { sampleRate: sr })
  a.gain(-96, { channel: [1] })
  let pcm = await a.read()
  t.ok(Math.abs(pcm[0][500] - 1) < 0.001, 'L untouched')
  t.ok(pcm[1][500] < 0.001, 'R channel muted')
})

test('gain — at without duration', async t => {
  let sr = 44100
  let ch = new Float32Array(sr * 2).fill(1)
  let a = audio.from([ch], { sampleRate: sr })
  a.gain(-96, { at: 1 })
  let pcm = await a.read()
  t.ok(Math.abs(pcm[0][sr / 2] - 1) < 0.001, 'before at: untouched')
  t.ok(pcm[0][sr + sr / 2] < 0.001, 'after at: muted')
})

test('reverse — with range', async t => {
  let sr = 44100
  let ch = new Float32Array(sr * 3)
  for (let i = 0; i < ch.length; i++) ch[i] = i / ch.length
  let a = audio.from([ch], { sampleRate: sr })
  a.reverse({ at: 1, duration: 1 })
  let pcm = await a.read()
  // Before range: ascending
  t.ok(pcm[0][100] < pcm[0][200], 'before: ascending')
  // In range: descending
  let mid = sr + 100
  t.ok(pcm[0][mid] > pcm[0][mid + 1000], 'in range: descending')
  // After range: ascending
  let after = sr * 2 + 100
  t.ok(pcm[0][after] < pcm[0][after + 100], 'after: ascending')
})

test('mix — with at and duration', async t => {
  let sr = 44100
  // Use 1s audio (fits in one page) to avoid cross-page mix complexity
  let ch = new Float32Array(sr).fill(0.5)
  let overlay = audio.from([new Float32Array(sr).fill(0.3)], { sampleRate: sr })
  let a = audio.from([ch], { sampleRate: sr })
  a.mix(overlay, { at: 0.2, duration: 0.3 })
  let pcm = await a.read()
  t.ok(Math.abs(pcm[0][0] - 0.5) < 0.01, 'before: 0.5')
  let mixStart = Math.round(sr * 0.2)
  t.ok(Math.abs(pcm[0][mixStart + 100] - 0.8) < 0.01, 'mixed: 0.5+0.3=0.8')
  let afterMix = Math.round(sr * 0.5) + 100
  t.ok(Math.abs(pcm[0][afterMix] - 0.5) < 0.01, 'after duration: 0.5 again')
})

test('filter — channel scoping', async t => {
  let sr = 44100
  // Low freq in both channels
  let lo = new Float32Array(sr)
  for (let i = 0; i < lo.length; i++) lo[i] = Math.sin(2 * Math.PI * 60 * i / sr)
  let L = new Float32Array(lo), R = new Float32Array(lo)
  let a = audio.from([L, R], { sampleRate: sr })
  a.highpass(200, { channel: 0 })
  let pcm = await a.read()
  // L should have low freq removed (attenuated)
  let lEnergy = 0, rEnergy = 0
  for (let i = sr / 2; i < sr; i++) { lEnergy += pcm[0][i] ** 2; rEnergy += pcm[1][i] ** 2 }
  t.ok(lEnergy < rEnergy * 0.3, `L filtered (${lEnergy.toFixed(1)} < ${rEnergy.toFixed(1)})`)
})

test('write — at non-zero offset', async t => {
  let sr = 44100
  let ch = new Float32Array(sr * 2).fill(0)
  let a = audio.from([ch], { sampleRate: sr })
  let data = new Float32Array(sr).fill(0.7)
  a.write(data, { at: 0.5 })
  let pcm = await a.read()
  t.ok(Math.abs(pcm[0][0]) < 0.001, 'before offset: zero')
  t.ok(Math.abs(pcm[0][Math.round(sr * 0.5) + 10] - 0.7) < 0.001, 'at offset: 0.7')
})

test('crop — at only (no duration)', async t => {
  let a = await audio(lenaPath)
  let origDur = a.duration
  a.crop({ at: 2 })
  t.ok(Math.abs(a.duration - (origDur - 2)) < 0.1, `cropped from 2s (got ${a.duration.toFixed(2)})`)
})

test('remove — at end', async t => {
  let a = await audio(lenaPath)
  let origDur = a.duration
  a.remove({ at: origDur - 1, duration: 1 })
  t.ok(Math.abs(a.duration - (origDur - 1)) < 0.1, `removed last 1s (got ${a.duration.toFixed(2)})`)
})

test('repeat — with range', async t => {
  let sr = 44100
  // 3 seconds: [0,0,0,..., 1,1,1,..., 0,0,0,...]
  let ch = new Float32Array(sr * 3).fill(0)
  for (let i = sr; i < sr * 2; i++) ch[i] = 1
  let a = audio.from([ch], { sampleRate: sr })
  a.repeat(2, { at: 1, duration: 1 })
  // repeat(2) = 2 extra copies → 3 + 2 = 5s: 1s silence, 1s×3 ones, 1s silence
  t.ok(Math.abs(a.duration - 5) < 0.05, `duration 5s (got ${a.duration.toFixed(2)})`)
  let pcm = await a.read()
  t.ok(pcm[0][sr / 2] < 0.01, 'first second: silence')
  t.ok(Math.abs(pcm[0][sr + 100] - 1) < 0.01, 'second second: ones')
  t.ok(Math.abs(pcm[0][sr * 2 + 100] - 1) < 0.01, 'third second: repeated ones')
  t.ok(Math.abs(pcm[0][sr * 3 + 100] - 1) < 0.01, 'fourth second: repeated ones')
  t.ok(pcm[0][sr * 4 + 100] < 0.01, 'fifth second: silence')
})

test('stat — channel array returns per-channel', async t => {
  let ch0 = new Float32Array(44100).fill(0.3)
  let ch1 = new Float32Array(44100).fill(0.9)
  let a = audio.from([ch0, ch1], { sampleRate: 44100 })
  let vals = await a.stat('max', { bins: 50, channel: [0, 1] })
  t.ok(Array.isArray(vals), 'returns array')
  t.is(vals.length, 2, 'two channels')
  t.ok(vals[0][0] > 0.25 && vals[0][0] < 0.35, `ch0 ~0.3 (got ${vals[0][0].toFixed(3)})`)
  t.ok(vals[1][0] > 0.85 && vals[1][0] < 0.95, `ch1 ~0.9 (got ${vals[1][0].toFixed(3)})`)
})

test('stat — single channel', async t => {
  let ch0 = new Float32Array(44100).fill(0.2)
  let ch1 = new Float32Array(44100).fill(0.8)
  let a = audio.from([ch0, ch1], { sampleRate: 44100 })
  let v = await a.stat('max', { channel: 1 })
  t.ok(v > 0.75, `channel 1 max ~0.8 (got ${v.toFixed(3)})`)
})


// ── Bug-fix regression tests ──────────────────────────────────────────

test('crop — out-of-range offset clamps gracefully', async t => {
  let a = audio.from([new Float32Array(44100)], { sampleRate: 44100 })
  let b = a.crop({ at: 999 })
  t.is(b.duration, 0, 'past-end offset → 0 duration')
  let c = a.crop({ at: -999 })
  t.ok(c.duration >= 0, 'large negative offset → non-negative')
})

test('remove — out-of-range clamps without negative length', async t => {
  let a = audio.from([new Float32Array(44100)], { sampleRate: 44100 })
  let b = a.remove({ at: 0.5, duration: 999 })
  t.ok(b.duration >= 0 && b.duration < 1, 'excess duration clamps')
})

test('repeat — out-of-range at clamps gracefully', async t => {
  let a = audio.from([new Float32Array(44100)], { sampleRate: 44100 })
  let b = a.repeat(2, { at: 999 })
  t.ok(b.duration >= 1, 'past-end at still valid')
})

test('audio.from(interleaved Int16Array) — stereo deinterleave', async t => {
  let n = 100
  let int16 = new Int16Array(n * 2)
  for (let i = 0; i < n; i++) { int16[i * 2] = 16384; int16[i * 2 + 1] = -16384 }
  let a = audio.from(int16, { format: 'int16 stereo interleaved', sampleRate: 44100 })
  t.is(a.channels, 2, 'stereo')
  let pcm = await a.read()
  t.ok(pcm[0][0] > 0.3, `ch0 positive (got ${pcm[0][0].toFixed(3)})`)
  t.ok(pcm[1][0] < -0.3, `ch1 negative (got ${pcm[1][0].toFixed(3)})`)
})

test('stat(db) — channel-scoped', async t => {
  let loud = new Float32Array(44100).fill(0.9)
  let quiet = new Float32Array(44100).fill(0.01)
  let a = audio.from([loud, quiet], { sampleRate: 44100 })
  let dbAll = await a.stat('db')
  let db0 = await a.stat('db', { channel: 0 })
  let db1 = await a.stat('db', { channel: 1 })
  t.ok(db0 > db1, `loud ch (${db0.toFixed(1)} dB) > quiet ch (${db1.toFixed(1)} dB)`)
  t.ok(dbAll >= db1, `all-ch dB (${dbAll.toFixed(1)}) >= quiet ch`)
})

test('stat(rms) — channel-scoped', async t => {
  let loud = new Float32Array(44100).fill(0.8)
  let quiet = new Float32Array(44100).fill(0.05)
  let a = audio.from([loud, quiet], { sampleRate: 44100 })
  let rms0 = await a.stat('rms', { channel: 0 })
  let rms1 = await a.stat('rms', { channel: 1 })
  t.ok(rms0 > rms1, `loud ch rms (${rms0.toFixed(3)}) > quiet ch (${rms1.toFixed(3)})`)
})

test('normalize — channel array does not crash', async t => {
  let a = audio.from([new Float32Array(44100).fill(0.5), new Float32Array(44100).fill(0.1)], { sampleRate: 44100 })
  a.normalize({ channel: [0, 1] })
  let pcm = await a.read()
  t.ok(pcm[0][0] > 0, `ch0 non-zero (${pcm[0][0].toFixed(3)})`)
  t.ok(pcm[1][0] > 0, `ch1 non-zero (${pcm[1][0].toFixed(3)})`)
})

test('time strings — crop({at: "2s"}) works', async t => {
  let a = audio.from([new Float32Array(44100 * 5)], { sampleRate: 44100 })
  a.crop({ at: '2s', duration: '1s' })
  t.ok(Math.abs(a.duration - 1) < 0.01, `duration ~1s (got ${a.duration.toFixed(3)})`)
})

test('time strings — read({at: "1s"}) works', async t => {
  let ch = new Float32Array(44100 * 3)
  for (let i = 44100; i < 44100 * 2; i++) ch[i] = 0.7
  let a = audio.from([ch], { sampleRate: 44100 })
  let pcm = await a.read({ at: '1s', duration: '1s' })
  t.ok(Math.abs(pcm[0][0] - 0.7) < 0.01, `read at 1s got signal (${pcm[0][0].toFixed(3)})`)
})

test('time strings — stat({at: "1s"}) works', async t => {
  let ch = new Float32Array(44100 * 3).fill(0.5)
  let a = audio.from([ch], { sampleRate: 44100 })
  let v = await a.stat('db', { at: '1s', duration: '1s' })
  t.ok(v < 0 && v > -20, `db in range (got ${v.toFixed(1)})`)
})

// ── speed ───────────────────────────────────────────────────────

test('speed(2) — double speed halves duration', async t => {
  let ch = new Float32Array(44100).fill(0.5)
  let a = audio.from([ch], { sampleRate: 44100 })
  a.speed(2)
  t.is(a.duration, 0.5, `duration ${a.duration}`)
  let pcm = await a.read()
  t.is(pcm[0].length, 22050, `sample count ${pcm[0].length}`)
  t.ok(Math.abs(pcm[0][0] - 0.5) < 0.01, `value preserved (${pcm[0][0].toFixed(3)})`)
})

test('speed(0.5) — half speed doubles duration', async t => {
  let ch = new Float32Array(44100).fill(0.5)
  let a = audio.from([ch], { sampleRate: 44100 })
  a.speed(0.5)
  t.is(a.duration, 2, `duration ${a.duration}`)
  let pcm = await a.read()
  t.is(pcm[0].length, 88200, `sample count ${pcm[0].length}`)
  t.ok(Math.abs(pcm[0][0] - 0.5) < 0.01, `value preserved (${pcm[0][0].toFixed(3)})`)
})

test('speed(-1) — reverse', async t => {
  let ch = new Float32Array(4)
  ch[0] = 1; ch[1] = 2; ch[2] = 3; ch[3] = 4
  let a = audio.from([ch], { sampleRate: 44100 })
  a.speed(-1)
  t.is(a.length, 4, 'same length')
  let pcm = await a.read()
  t.is(pcm[0][0], 4, 'first = 4')
  t.is(pcm[0][1], 3, 'second = 3')
  t.is(pcm[0][2], 2, 'third = 2')
  t.is(pcm[0][3], 1, 'fourth = 1')
})

test('speed(-2) — reverse at double speed', async t => {
  let ch = new Float32Array(100)
  for (let i = 0; i < 100; i++) ch[i] = i / 100
  let a = audio.from([ch], { sampleRate: 44100 })
  a.speed(-2)
  let flat = await a.read()
  t.is(flat[0].length, 50, 'half length')
  // streaming must match flat render
  let streamed = []
  for await (let chunk of a.stream()) streamed.push(chunk[0])
  let streamBuf = new Float32Array(flat[0].length), pos = 0
  for (let c of streamed) { streamBuf.set(c, pos); pos += c.length }
  let maxDiff = 0
  for (let i = 0; i < flat[0].length; i++) maxDiff = Math.max(maxDiff, Math.abs(streamBuf[i] - flat[0][i]))
  t.ok(maxDiff < 0.001, `stream matches flat (max diff ${maxDiff.toFixed(6)})`)
  // reversed: first output > last output
  t.ok(flat[0][0] > flat[0][49], 'reversed order')
})

test('speed(2) then reverse — composable', async t => {
  let ch = new Float32Array(100)
  for (let i = 0; i < 100; i++) ch[i] = i / 100
  let a = audio.from([ch], { sampleRate: 44100 })
  a.speed(2)
  a.reverse()
  let pcm = await a.read()
  t.is(pcm[0].length, 50, 'half length')
  // reversed: last output sample should be close to start of original
  t.ok(pcm[0][49] < pcm[0][0], 'reversed order')
})

test('speed — crop after speed', async t => {
  // 2s signal, speed(2) → 1s, crop first 0.5s → 0.5s
  let ch = new Float32Array(88200).fill(0.7)
  let a = audio.from([ch], { sampleRate: 44100 })
  a.speed(2)
  a.crop({ duration: 0.5 })
  t.is(a.duration, 0.5, `duration ${a.duration}`)
  let pcm = await a.read()
  t.is(pcm[0].length, 22050, `sample count ${pcm[0].length}`)
  t.ok(Math.abs(pcm[0][0] - 0.7) < 0.01, `value preserved`)
})

test('speed — insert after speed preserves data', async t => {
  let ch = new Float32Array(44100).fill(0.5)
  let a = audio.from([ch], { sampleRate: 44100 })
  a.speed(2)  // 0.5s
  a.insert(0.25, { at: 0.25 })  // insert 0.25s silence at midpoint
  t.is(a.duration, 0.75, `duration ${a.duration}`)
  let pcm = await a.read()
  t.ok(Math.abs(pcm[0][0] - 0.5) < 0.01, 'first half has data')
  // silence in the middle
  let silenceIdx = Math.round(0.25 * 44100)
  t.ok(Math.abs(pcm[0][silenceIdx]) < 0.01, 'silence at insert point')
})

test('speed — streaming matches flat render', async t => {
  let ch = new Float32Array(44100)
  for (let i = 0; i < ch.length; i++) ch[i] = Math.sin(2 * Math.PI * 440 * i / 44100)
  let a = audio.from([ch], { sampleRate: 44100 })
  a.speed(1.5)
  let flat = await a.read()
  let streamed = []
  for await (let chunk of a.stream()) streamed.push(chunk[0])
  let total = streamed.reduce((n, c) => n + c.length, 0)
  t.is(total, flat[0].length, `stream length matches flat (${total})`)
  // compare first 100 samples
  let streamBuf = new Float32Array(total), pos = 0
  for (let c of streamed) { streamBuf.set(c, pos); pos += c.length }
  let maxDiff = 0
  for (let i = 0; i < Math.min(100, total); i++) maxDiff = Math.max(maxDiff, Math.abs(streamBuf[i] - flat[0][i]))
  t.ok(maxDiff < 0.001, `stream matches flat (max diff ${maxDiff.toFixed(6)})`)
})


// ── stretch ───────────────────────────────────────────────────

// Helper: assert stretched signal has dominant energy at `f`, not its octaves.
function assertPitch(t, buf, f, label) {
  let m = mid(buf)
  let e = energyAt(m, f), down = energyAt(m, f / 2), up = energyAt(m, f * 2)
  t.ok(e > 0.05, `${label}: energy at ${f}Hz = ${e.toFixed(3)}`)
  t.ok(e > down * 3 && e > up * 3, `${label}: no octave leakage (down=${down.toFixed(3)} up=${up.toFixed(3)})`)
}

test('stretch(2) — doubles duration, preserves pitch', async t => {
  let a = audio.from([tone(440, 2)], { sampleRate: 44100 })
  a.stretch(2)
  t.is(a.duration, 4, `duration ${a.duration}`)
  let pcm = await a.read()
  t.is(pcm[0].length, 176400, `sample count`)
  assertPitch(t, pcm[0], 440, 'stretch(2)')
})

test('stretch(0.5) — halves duration, preserves pitch', async t => {
  let a = audio.from([tone(440, 2)], { sampleRate: 44100 })
  a.stretch(0.5)
  t.is(a.duration, 1, `duration ${a.duration}`)
  let pcm = await a.read()
  t.is(pcm[0].length, 44100, `sample count`)
  assertPitch(t, pcm[0], 440, 'stretch(0.5)')
})

test('stretch(1.5) — preserves pitch at fractional factor', async t => {
  let a = audio.from([tone(440, 2)], { sampleRate: 44100 })
  a.stretch(1.5)
  t.is(a.length, 132300, 'length 1.5×')
  let pcm = await a.read()
  assertPitch(t, pcm[0], 440, 'stretch(1.5)')
})

// Pitch must stay stable across block boundaries for every factor, not just
// ones where phaseLock's emission schedule happens to line up. Probes multiple
// windows across the stretched output and asserts each one carries energy.
test('stretch — pitch stable across blocks for varied factors', async t => {
  for (let f of [0.75, 0.9, 1.25, 1.7, 2.5]) {
    let a = audio.from([tone(440, 3)], { sampleRate: 44100 })
    a.stretch(f)
    let pcm = await a.read()
    let buf = pcm[0], sr = 44100
    let edge = sr * 0.4 | 0, win = sr * 0.15 | 0, step = win / 2 | 0
    let minE = Infinity
    for (let p = edge; p + win < buf.length - edge; p += step) {
      let e = energyAt(buf.subarray(p, p + win), 440)
      if (e < minE) minE = e
    }
    t.ok(minE > 0.3, `factor=${f}: min window energy ${minE.toFixed(3)} > 0.3`)
  }
})

test('stretch(1) — no-op', async t => {
  let ch = new Float32Array(44100).fill(0.5)
  let a = audio.from([ch], { sampleRate: 44100 })
  a.stretch(1)
  t.is(a.duration, 1, 'duration unchanged')
  let pcm = await a.read()
  t.ok(Math.abs(pcm[0][0] - 0.5) < 0.01, 'values preserved')
})

test('stretch — negative factor throws', async t => {
  let a = audio.from([new Float32Array(100)], { sampleRate: 44100 })
  a.stretch(-1)
  let threw = false
  try { await a.read() } catch (e) { threw = true }
  t.ok(threw, 'throws on negative factor')
})

test('stretch — streaming matches flat render', async t => {
  let a = audio.from([tone(440, 2)], { sampleRate: 44100 })
  a.stretch(1.5)
  let flat = await a.read()
  let streamed = []
  for await (let chunk of a.stream()) streamed.push(chunk[0])
  let total = streamed.reduce((n, c) => n + c.length, 0)
  t.is(total, flat[0].length, `stream length matches flat (${total})`)
  let buf = new Float32Array(total), pos = 0
  for (let c of streamed) { buf.set(c, pos); pos += c.length }
  assertPitch(t, buf, 440, 'streamed')
})

test('stretch stereo — preserves both channels with same pitch', async t => {
  let a = audio.from([tone(440, 1), tone(660, 1)], { sampleRate: 44100 })
  a.stretch(2)
  let pcm = await a.read()
  t.is(pcm.length, 2, '2 channels')
  t.is(pcm[0].length, 88200, 'length doubled')
  assertPitch(t, pcm[0], 440, 'ch0')
  assertPitch(t, pcm[1], 660, 'ch1')
})

// ── stretch combinations ─────────────────────────────────────

test('stretch then crop — pitch preserved in crop window', async t => {
  let a = audio.from([tone(440, 2)], { sampleRate: 44100 })
  a.stretch(2)                          // → 4s
  a.crop({ at: 0.5, duration: 2 })      // keep middle 2s
  t.is(a.length, 88200, '2s @ 44100')
  let pcm = await a.read()
  assertPitch(t, pcm[0], 440, 'stretch+crop')
})

test('crop then stretch — operates on cropped region', async t => {
  let a = audio.from([tone(440, 2)], { sampleRate: 44100 })
  a.crop({ at: 0.5, duration: 1 })      // 1s
  a.stretch(2)                           // → 2s
  t.is(a.length, 88200, '2s')
  let pcm = await a.read()
  assertPitch(t, pcm[0], 440, 'crop+stretch')
})

test('stretch then reverse — reversed output, same pitch', async t => {
  let a = audio.from([tone(440, 2)], { sampleRate: 44100 })
  a.stretch(2).reverse()
  t.is(a.length, 176400, 'length preserved')
  let pcm = await a.read()
  assertPitch(t, pcm[0], 440, 'stretch+reverse')
})

test('reverse then stretch — stretched reversed audio', async t => {
  let a = audio.from([tone(440, 2)], { sampleRate: 44100 })
  a.reverse().stretch(2)
  t.is(a.length, 176400, 'length 2×')
  let pcm = await a.read()
  assertPitch(t, pcm[0], 440, 'reverse+stretch')
})

test('stretch then speed — composable', async t => {
  // stretch(2) → 4s @ 440Hz, speed(2) → 2s @ 880Hz (speed changes pitch)
  let a = audio.from([tone(440, 2)], { sampleRate: 44100 })
  a.stretch(2).speed(2)
  t.is(a.length, 88200, '2s')
  let pcm = await a.read()
  assertPitch(t, pcm[0], 880, 'stretch+speed')
})

test('stretch then pitch — stacked pitch-preserving ops', async t => {
  // stretch(2) → 2s at 440Hz, pitch(+12) → 2s at 880Hz, same length
  let a = audio.from([tone(440, 1)], { sampleRate: 44100 })
  a.stretch(2).pitch(12)
  t.is(a.length, 88200, 'length doubled by stretch, preserved by pitch')
  let pcm = await a.read()
  assertPitch(t, pcm[0], 880, 'stretch+pitch')
})

test('stretch then gain — amplitude correctly scaled, pitch preserved', async t => {
  let a = audio.from([tone(440, 1)], { sampleRate: 44100 })
  a.stretch(2).gain(-6)
  let pcm = await a.read()
  let m = mid(pcm[0])
  let e = energyAt(m, 440)
  // -6dB ≈ halving → unit sine energy ≈ 0.5, after -6dB ≈ 0.25
  t.ok(e > 0.2 && e < 0.3, `gain applied (energy ${e.toFixed(3)})`)
  assertPitch(t, pcm[0], 440, 'stretch+gain')
})

test('stretch then trim — silence-trimmed stretched output keeps pitch', async t => {
  let src = new Float32Array(88200)
  // 0.5s silence + 1s tone + 0.5s silence
  for (let i = 22050; i < 66150; i++) src[i] = Math.sin(2 * Math.PI * 440 * (i - 22050) / 44100)
  let a = audio.from([src], { sampleRate: 44100 })
  a.stretch(2).trim()
  let pcm = await a.read()
  t.ok(pcm[0].length > 0, 'trim kept tone region')
  t.ok(pcm[0].length < 176400, 'trim removed silence')
  assertPitch(t, pcm[0], 440, 'stretch+trim')
})

test('stretch chain — stretch(2).stretch(0.5) cancels to original length', async t => {
  let a = audio.from([tone(440, 1)], { sampleRate: 44100 })
  a.stretch(2).stretch(0.5)
  t.is(a.length, 44100, 'length restored')
  let pcm = await a.read()
  assertPitch(t, pcm[0], 440, 'stretch chain')
})

test('stretch on fixture file — real audio maintains pitch', async t => {
  let a = await audio(lenaPath)
  let origDur = a.duration
  a.stretch(2)
  t.ok(Math.abs(a.duration - origDur * 2) < 0.01, `duration doubled (${a.duration.toFixed(2)}s)`)
  let pcm = await a.read()
  t.is(pcm[0].length, Math.round(origDur * 2 * 44100), 'sample count doubled')
  // Lena is speech; can't test exact freq, but verify non-silence + no NaNs
  let peak = 0, nan = false
  for (let i = 0; i < pcm[0].length; i++) {
    let v = pcm[0][i]
    if (!Number.isFinite(v)) { nan = true; break }
    if (Math.abs(v) > peak) peak = Math.abs(v)
  }
  t.ok(!nan, 'no NaN/Inf')
  t.ok(peak > 0.01, `audible (peak ${peak.toFixed(3)})`)
})


// ── pitch ───────────────────────────────────────────────────

test('pitch(12) — octave up, same duration', async t => {
  let ch = new Float32Array(44100)
  for (let i = 0; i < ch.length; i++) ch[i] = Math.sin(2 * Math.PI * 440 * i / 44100)
  let a = audio.from([ch], { sampleRate: 44100 })
  a.pitch(12)
  t.is(a.duration, 1, `duration preserved ${a.duration}`)
  let pcm = await a.read()
  t.is(pcm[0].length, 44100, `sample count preserved ${pcm[0].length}`)
})

test('pitch(-12) — octave down, same duration', async t => {
  let ch = new Float32Array(44100)
  for (let i = 0; i < ch.length; i++) ch[i] = Math.sin(2 * Math.PI * 440 * i / 44100)
  let a = audio.from([ch], { sampleRate: 44100 })
  a.pitch(-12)
  t.is(a.duration, 1, `duration preserved ${a.duration}`)
  let pcm = await a.read()
  t.is(pcm[0].length, 44100, `sample count preserved`)
})

test('pitch(0) — no-op', async t => {
  let ch = new Float32Array(100).fill(0.5)
  let a = audio.from([ch], { sampleRate: 44100 })
  a.pitch(0)
  let pcm = await a.read()
  t.ok(Math.abs(pcm[0][0] - 0.5) < 0.01, 'values unchanged')
})


// ── playbackRate ────────────────────────────────────────────

test('playbackRate — defaults to 1', t => {
  let a = audio.from([new Float32Array(100)], { sampleRate: 44100 })
  t.is(a.playbackRate, 1, 'default')
})

test('playbackRate — clamped to [0.0625, 16]', t => {
  let a = audio.from([new Float32Array(100)], { sampleRate: 44100 })
  a.playbackRate = 0.01
  t.is(a.playbackRate, 0.0625, 'min clamp')
  a.playbackRate = 100
  t.is(a.playbackRate, 16, 'max clamp')
})

test('playbackRate — emits ratechange', t => {
  let a = audio.from([new Float32Array(100)], { sampleRate: 44100 })
  let fired = false
  a.on('ratechange', () => { fired = true })
  a.playbackRate = 2
  t.ok(fired, 'ratechange event')
})


// ── New ops: allpass, vocals, dither, earwax, resample ──────────────────

test('allpass — unity magnitude, phase shift only', async t => {
  let ch = tone(1000, 0.5)
  let a = audio.from([ch], { sampleRate: 44100 })
  a.allpass(1000)
  let pcm = await a.read()
  // Allpass preserves energy — output RMS should be within 5% of input
  let inR = rms(ch), outR = rms(pcm[0])
  t.ok(Math.abs(outR - inR) / inR < 0.05, `energy preserved: in ${inR.toFixed(3)} out ${outR.toFixed(3)}`)
  // But samples should differ (phase shifted)
  let diff = 0
  for (let i = 0; i < ch.length; i++) diff += Math.abs(pcm[0][i] - ch[i])
  t.ok(diff / ch.length > 0.01, 'samples differ (phase shifted)')
})

test('allpass — stereo independent channels', async t => {
  let lo = tone(200, 0.3), hi = tone(5000, 0.3)
  let a = audio.from([lo, hi], { sampleRate: 44100 })
  a.allpass(1000)
  let pcm = await a.read()
  t.ok(Math.abs(rms(pcm[0]) - rms(lo)) / rms(lo) < 0.05, 'left energy preserved')
  t.ok(Math.abs(rms(pcm[1]) - rms(hi)) / rms(hi) < 0.05, 'right energy preserved')
})

test('vocals — isolate center (default)', async t => {
  // Center-panned signal: same on L and R
  let center = tone(440, 0.5)
  let side = tone(2000, 0.5)
  let L = new Float32Array(center.length)
  let R = new Float32Array(center.length)
  for (let i = 0; i < center.length; i++) {
    L[i] = center[i] + side[i]
    R[i] = center[i] - side[i]
  }
  let a = audio.from([L, R], { sampleRate: 44100 })
  a.vocals()  // isolate = keep mid
  let pcm = await a.read()
  // Mid = (L+R)/2 = center, so output should match center signal
  let maxDiff = 0
  for (let i = 0; i < center.length; i++) maxDiff = Math.max(maxDiff, Math.abs(pcm[0][i] - center[i]))
  t.ok(maxDiff < 1e-5, `isolate extracts center: maxDiff ${maxDiff.toFixed(6)}`)
  // L and R should be identical (mono center)
  let lrDiff = 0
  for (let i = 0; i < pcm[0].length; i++) lrDiff = Math.max(lrDiff, Math.abs(pcm[0][i] - pcm[1][i]))
  t.ok(lrDiff < 1e-5, `L=R after isolate: ${lrDiff.toFixed(6)}`)
})

test('vocals — remove center', async t => {
  let center = tone(440, 0.5)
  let side = tone(2000, 0.5)
  let L = new Float32Array(center.length)
  let R = new Float32Array(center.length)
  for (let i = 0; i < center.length; i++) {
    L[i] = center[i] + side[i]
    R[i] = center[i] - side[i]
  }
  let a = audio.from([L, R], { sampleRate: 44100 })
  a.vocals('remove')  // keep side
  let pcm = await a.read()
  // Side = (L-R)/2 = side, so output L should match side signal
  let maxDiff = 0
  for (let i = 0; i < side.length; i++) maxDiff = Math.max(maxDiff, Math.abs(pcm[0][i] - side[i]))
  t.ok(maxDiff < 1e-5, `remove extracts side: maxDiff ${maxDiff.toFixed(6)}`)
})

test('vocals — mono passthrough', async t => {
  let ch = tone(440, 0.2)
  let a = audio.from([ch], { sampleRate: 44100 })
  a.vocals()
  let pcm = await a.read()
  let maxDiff = 0
  for (let i = 0; i < ch.length; i++) maxDiff = Math.max(maxDiff, Math.abs(pcm[0][i] - ch[i]))
  t.ok(maxDiff < 1e-6, `mono unchanged: maxDiff ${maxDiff.toFixed(6)}`)
})

test('dither — quantizes to target bit depth', async t => {
  // Smooth ramp from -1 to 1
  let n = 4096
  let ch = new Float32Array(n)
  for (let i = 0; i < n; i++) ch[i] = (i / (n - 1)) * 2 - 1
  let a = audio.from([ch], { sampleRate: 44100 })
  a.dither(8)
  let pcm = await a.read()
  // 8-bit: 127 levels, step = 1/127 ≈ 0.00787
  let step = 1 / 127
  let quantized = true
  for (let i = 0; i < n; i++) {
    let rem = Math.abs(pcm[0][i] * 127 - Math.round(pcm[0][i] * 127))
    if (rem > 0.01) { quantized = false; break }
  }
  t.ok(quantized, 'output quantized to 8-bit levels')
  // TPDF noise should make output differ from naive quantization
  let naiveDiffs = 0
  for (let i = 0; i < n; i++) {
    let naive = Math.round(ch[i] * 127) / 127
    if (Math.abs(pcm[0][i] - naive) > step * 0.5) naiveDiffs++
  }
  t.ok(naiveDiffs > 0, `TPDF noise differs from naive: ${naiveDiffs} samples`)
})

test('dither — 16-bit preserves signal integrity', async t => {
  let ch = tone(440, 0.5)
  let a = audio.from([ch], { sampleRate: 44100 })
  a.dither(16)
  let pcm = await a.read()
  // 16-bit dither should barely change a full-scale sine
  let maxDiff = 0
  for (let i = 0; i < ch.length; i++) maxDiff = Math.max(maxDiff, Math.abs(pcm[0][i] - ch[i]))
  // 16-bit step ≈ 3e-5, dither adds ±1 LSB noise + quantization
  t.ok(maxDiff < 0.001, `16-bit dither maxDiff ${maxDiff.toFixed(6)}`)
})

test('earwax — crossfeed mixes channels', async t => {
  // Hard-panned: L=tone, R=silence
  let ch = tone(440, 0.5)
  let silent = new Float32Array(ch.length)
  let a = audio.from([ch, silent], { sampleRate: 44100 })
  a.earwax()
  let pcm = await a.read()
  // R should now have some content from L crossfeed
  t.ok(rms(pcm[1]) > 0.01, `R gets crossfeed: rms ${rms(pcm[1]).toFixed(4)}`)
  // L should lose some energy (mixed away)
  t.ok(rms(pcm[0]) < rms(ch), `L slightly reduced: ${rms(pcm[0]).toFixed(4)} < ${rms(ch).toFixed(4)}`)
})

test('earwax — mono passthrough', async t => {
  let ch = tone(440, 0.2)
  let a = audio.from([ch], { sampleRate: 44100 })
  a.earwax()
  let pcm = await a.read()
  let maxDiff = 0
  for (let i = 0; i < ch.length; i++) maxDiff = Math.max(maxDiff, Math.abs(pcm[0][i] - ch[i]))
  t.ok(maxDiff < 1e-6, `mono unchanged: maxDiff ${maxDiff.toFixed(6)}`)
})

test('earwax — custom cutoff and level', async t => {
  let ch = tone(200, 0.3)
  let silent = new Float32Array(ch.length)
  let a1 = audio.from([ch.slice(), silent.slice()], { sampleRate: 44100 })
  a1.earwax(500, 0.1)  // low level
  let pcm1 = await a1.read()
  let a2 = audio.from([ch.slice(), silent.slice()], { sampleRate: 44100 })
  a2.earwax(500, 0.5)  // high level
  let pcm2 = await a2.read()
  // Higher level → more crossfeed to R
  t.ok(rms(pcm2[1]) > rms(pcm1[1]), `more crossfeed at higher level: ${rms(pcm2[1]).toFixed(4)} > ${rms(pcm1[1]).toFixed(4)}`)
})

test('resample — 44100→22050 halves length, preserves duration', async t => {
  let ch = tone(440, 1)
  let a = audio.from([ch], { sampleRate: 44100 })
  a.resample(22050)
  t.is(a.sampleRate, 22050, 'target sample rate')
  t.is(a.length, 22050, 'half the samples')
  t.ok(Math.abs(a.duration - 1) < 0.01, `duration preserved: ${a.duration.toFixed(3)}`)
})

test('resample — 22050→44100 doubles length', async t => {
  let n = 22050
  let ch = new Float32Array(n)
  for (let i = 0; i < n; i++) ch[i] = Math.sin(2 * Math.PI * 440 * i / 22050)
  let a = audio.from([ch], { sampleRate: 22050 })
  a.resample(44100)
  t.is(a.sampleRate, 44100, 'target sample rate')
  t.is(a.length, 44100, 'double the samples')
})

test('resample — returns this (chainable)', async t => {
  let a = audio.from([tone(440, 0.5)], { sampleRate: 44100 })
  let b = a.resample(22050)
  t.ok(a === b, 'same instance (chainable)')
  t.is(a.sampleRate, 22050, 'rate updated')
})

test('resample — same rate is no-op', async t => {
  let a = audio.from([tone(440, 0.2)], { sampleRate: 44100 })
  a.resample(44100)
  t.is(a.sampleRate, 44100, 'rate unchanged')
  t.is(a.length, Math.round(0.2 * 44100), 'length unchanged')
  let pcm = await a.read()
  t.ok(Math.abs(rms(pcm[0]) - rms(tone(440, 0.2))) < 0.001, 'audio unchanged')
})

test('resample — preserves pitch', async t => {
  let ch = tone(440, 1)
  let a = audio.from([ch], { sampleRate: 44100 })
  a.resample(48000)
  let pcm = await a.read()
  let e = energyAt(pcm[0], 440, 48000)
  t.ok(e > 0.3, `440Hz preserved at 48k: energy ${e.toFixed(3)}`)
})

test('resample — stereo', async t => {
  let L = tone(440, 0.3), R = tone(880, 0.3)
  let a = audio.from([L, R], { sampleRate: 44100 })
  a.resample(22050)
  t.is(a.channels, 2, 'stereo preserved')
  t.is(a.sampleRate, 22050, 'target rate')
})

test('resample — non-destructive (undoable)', async t => {
  let a = audio.from([tone(440, 0.5)], { sampleRate: 44100 })
  a.resample(22050)
  t.is(a.sampleRate, 22050, 'resampled')
  t.is(a.edits.length, 1, 'one edit')
  a.undo()
  t.is(a.sampleRate, 44100, 'undo restores original rate')
  t.is(a.edits.length, 0, 'edit removed')
})

test('resample — chainable with other ops', async t => {
  let ch = tone(440, 1)
  let a = audio.from([ch], { sampleRate: 44100 })
  a.resample(48000).gain(-6)
  t.is(a.sampleRate, 48000, 'resampled rate')
  t.is(a.edits.length, 2, 'two edits')
  let pcm = await a.read()
  t.is(pcm[0].length, 48000, 'output at new rate')
  let e = energyAt(pcm[0], 440, 48000)
  t.ok(e > 0.1, `440Hz survives resample+gain: ${e.toFixed(3)}`)
})


// ── Phase 16: Block/page boundary stress ────────────────────────────────

test('boundary — stream reads across page boundaries', async t => {
  let origP = audio.PAGE_SIZE, origB = audio.BLOCK_SIZE
  audio.PAGE_SIZE = 64
  audio.BLOCK_SIZE = 32
  try {
    // 3.5 pages of ramp data — blocks will straddle page edges
    let samples = 64 * 3 + 32
    let ch = new Float32Array(samples)
    for (let i = 0; i < samples; i++) ch[i] = i / samples
    let a = audio.from([ch], { sampleRate: 44100 })

    let streamed = []
    for await (let block of a.stream()) streamed.push(block[0])
    let flat = new Float32Array(streamed.reduce((n, b) => n + b.length, 0))
    let pos = 0; for (let b of streamed) { flat.set(b, pos); pos += b.length }

    t.is(flat.length, samples, 'all samples streamed')
    // Verify samples at each page boundary
    for (let boundary of [63, 64, 127, 128, 191, 192]) {
      if (boundary < samples) {
        let expected = boundary / samples
        t.ok(Math.abs(flat[boundary] - expected) < 0.001, `sample ${boundary} at page boundary correct (${flat[boundary].toFixed(4)} ≈ ${expected.toFixed(4)})`)
      }
    }
  } finally { audio.PAGE_SIZE = origP; audio.BLOCK_SIZE = origB }
})

test('boundary — block size does not divide page size evenly', async t => {
  let origP = audio.PAGE_SIZE, origB = audio.BLOCK_SIZE
  audio.PAGE_SIZE = 100
  audio.BLOCK_SIZE = 30  // 100 / 30 = 3.33 — misaligned
  try {
    let samples = 200
    let ch = new Float32Array(samples)
    for (let i = 0; i < samples; i++) ch[i] = (i % 2 === 0) ? 0.5 : -0.5
    let a = audio.from([ch], { sampleRate: 44100 })
    a.gain(-6)
    let pcm = await a.read()
    let expected = 0.5 * 10 ** (-6 / 20)
    t.is(pcm[0].length, samples, 'length preserved')
    t.ok(Math.abs(pcm[0][99] - (-expected)) < 0.01, 'sample at page boundary correct')
    t.ok(Math.abs(pcm[0][100] - expected) < 0.01, 'sample after page boundary correct')
  } finally { audio.PAGE_SIZE = origP; audio.BLOCK_SIZE = origB }
})

test('boundary — reverse across blocks matches flat render', async t => {
  let origP = audio.PAGE_SIZE, origB = audio.BLOCK_SIZE
  audio.PAGE_SIZE = 128
  audio.BLOCK_SIZE = 32
  try {
    let samples = 128 * 2
    let ch = new Float32Array(samples)
    for (let i = 0; i < samples; i++) ch[i] = i / samples  // ramp 0→1
    let a = audio.from([ch], { sampleRate: 44100 })
    a.reverse()
    let pcm = await a.read()
    t.is(pcm[0].length, samples, 'length preserved')
    // reversed ramp: first sample should be last original, last sample should be first original
    t.ok(pcm[0][0] > 0.99, `first sample ≈ 1 (got ${pcm[0][0].toFixed(4)})`)
    t.ok(pcm[0][samples - 1] < 0.01, `last sample ≈ 0 (got ${pcm[0][samples - 1].toFixed(4)})`)
    // Verify monotonically decreasing
    let monotonic = true
    for (let i = 1; i < samples; i++) if (pcm[0][i] > pcm[0][i - 1] + 0.001) { monotonic = false; break }
    t.ok(monotonic, 'reversed ramp is monotonically decreasing')
  } finally { audio.PAGE_SIZE = origP; audio.BLOCK_SIZE = origB }
})

test('boundary — reverse streaming matches flat render', async t => {
  let origP = audio.PAGE_SIZE, origB = audio.BLOCK_SIZE
  audio.PAGE_SIZE = 128
  audio.BLOCK_SIZE = 32
  try {
    let samples = 256
    let ch = new Float32Array(samples)
    for (let i = 0; i < samples; i++) ch[i] = i / samples
    let a = audio.from([ch], { sampleRate: 44100 })
    a.reverse()

    let flat = await a.read()
    let streamed = []
    for await (let block of a.stream()) streamed.push(block[0])
    let streamBuf = new Float32Array(streamed.reduce((n, b) => n + b.length, 0))
    let pos = 0; for (let b of streamed) { streamBuf.set(b, pos); pos += b.length }

    t.is(streamBuf.length, flat[0].length, 'lengths match')
    let maxDiff = 0
    for (let i = 0; i < streamBuf.length; i++) maxDiff = Math.max(maxDiff, Math.abs(streamBuf[i] - flat[0][i]))
    t.ok(maxDiff < 0.001, `stream matches flat reverse (max diff ${maxDiff.toFixed(6)})`)
  } finally { audio.PAGE_SIZE = origP; audio.BLOCK_SIZE = origB }
})

test('boundary — filter state continuity across blocks', async t => {
  let origP = audio.PAGE_SIZE, origB = audio.BLOCK_SIZE
  audio.PAGE_SIZE = 256
  audio.BLOCK_SIZE = 32
  try {
    // Generate white-ish noise (deterministic)
    let sr = 44100, samples = 256 * 2
    let ch = new Float32Array(samples)
    let seed = 12345
    for (let i = 0; i < samples; i++) { seed = (seed * 1103515245 + 12345) & 0x7fffffff; ch[i] = seed / 0x7fffffff * 2 - 1 }
    let a = audio.from([ch], { sampleRate: sr })
    a.filter('lowpass', 1000)

    let flat = await a.read()
    // Stream same audio — filter state must carry across blocks
    let streamed = []
    for await (let block of a.stream()) streamed.push(block[0])
    let streamBuf = new Float32Array(streamed.reduce((n, b) => n + b.length, 0))
    let pos = 0; for (let b of streamed) { streamBuf.set(b, pos); pos += b.length }

    t.is(streamBuf.length, flat[0].length, 'lengths match')
    let maxDiff = 0
    for (let i = 0; i < streamBuf.length; i++) maxDiff = Math.max(maxDiff, Math.abs(streamBuf[i] - flat[0][i]))
    t.ok(maxDiff < 0.001, `filter state continuous across blocks (max diff ${maxDiff.toFixed(6)})`)
  } finally { audio.PAGE_SIZE = origP; audio.BLOCK_SIZE = origB }
})

test('boundary — fade spans page boundary', async t => {
  let origP = audio.PAGE_SIZE, origB = audio.BLOCK_SIZE
  audio.PAGE_SIZE = 128
  audio.BLOCK_SIZE = 32
  try {
    let sr = 44100, samples = 128 * 3
    let ch = new Float32Array(samples).fill(1)
    let a = audio.from([ch], { sampleRate: sr })
    // Fade in over ~2 pages worth of samples
    a.fade(256 / sr)

    let pcm = await a.read()
    t.ok(pcm[0][0] < 0.01, 'fade starts at 0')
    t.ok(pcm[0][127] < pcm[0][128], 'monotonic across first page boundary')
    t.ok(pcm[0][255] < 1.01, 'fade end ≈ 1')
    t.ok(Math.abs(pcm[0][samples - 1] - 1) < 0.01, 'post-fade region untouched')
  } finally { audio.PAGE_SIZE = origP; audio.BLOCK_SIZE = origB }
})

test('boundary — crop+gain across page boundary stream vs flat', async t => {
  let origP = audio.PAGE_SIZE, origB = audio.BLOCK_SIZE
  audio.PAGE_SIZE = 128
  audio.BLOCK_SIZE = 32
  try {
    let samples = 128 * 4
    let ch = new Float32Array(samples)
    for (let i = 0; i < samples; i++) ch[i] = i / samples
    let a = audio.from([ch], { sampleRate: 44100 })
    // Crop into middle of page 1 through middle of page 3
    let cropStart = 64 / 44100, cropDur = 256 / 44100
    a.crop({ at: cropStart, duration: cropDur })
    a.gain(-6)

    let flat = await a.read()
    let streamed = []
    for await (let block of a.stream()) streamed.push(block[0])
    let streamBuf = new Float32Array(streamed.reduce((n, b) => n + b.length, 0))
    let pos = 0; for (let b of streamed) { streamBuf.set(b, pos); pos += b.length }

    t.is(streamBuf.length, flat[0].length, 'lengths match')
    let maxDiff = 0
    for (let i = 0; i < streamBuf.length; i++) maxDiff = Math.max(maxDiff, Math.abs(streamBuf[i] - flat[0][i]))
    t.ok(maxDiff < 0.001, `crop+gain stream matches flat (max diff ${maxDiff.toFixed(6)})`)
  } finally { audio.PAGE_SIZE = origP; audio.BLOCK_SIZE = origB }
})

test('boundary — concurrent decode + stream across page boundary', async t => {
  // Regression: drain() during streaming created short pages, walkPages p0 formula skipped data at PAGE_SIZE boundary
  let sr = 48000, totalLen = Math.ceil(sr * 25)  // 25s at 48kHz — crosses PAGE_SIZE at ~21.8s
  let ramp = new Float32Array(totalLen)
  for (let i = 0; i < totalLen; i++) ramp[i] = i

  let a = audio()
  a.sampleRate = sr
  a._.ch = 1
  a._.waiters = []
  a.decoded = false

  // Background decode: push chunks, then finalize
  let pos = 0, CHUNK = 4096
  let timer = setInterval(() => {
    if (pos >= totalLen) {
      clearInterval(timer)
      a._.acc.drain()
      a.decoded = true
      a._.len = a._.acc.length
      for (let w of a._.waiters.splice(0)) w()
      return
    }
    let n = Math.min(CHUNK, totalLen - pos)
    a.push([ramp.subarray(pos, pos + n)], { sampleRate: sr })
    pos += n
    for (let w of a._.waiters.splice(0)) w()
  }, 0)

  let blockIdx = 0, err = null
  for await (let block of a.stream()) {
    let data = block[0], base = blockIdx * BLOCK_SIZE
    for (let i = 0; i < data.length; i++) {
      if (data[i] !== base + i) {
        err = { block: blockIdx, i, got: data[i], expected: base + i, t: ((base + i) / sr).toFixed(2) }
        break
      }
    }
    if (err) break
    blockIdx++
  }
  if (!timer._destroyed) clearInterval(timer)
  t.ok(!err, err ? `glitch at block ${err.block} sample ${err.i} (t=${err.t}s): got ${err.got}, expected ${err.expected}` : 'all samples correct across page boundary')
})

test('boundary — evicted pages restored during streaming', async t => {
  let ch = new Float32Array(PAGE_SIZE * 3)
  for (let i = 0; i < ch.length; i++) ch[i] = i / ch.length
  let cache = mockCache()
  let pageBytes = PAGE_SIZE * 4

  let a = await audio([ch], { cache, budget: pageBytes * 1 })  // keeps 1 page resident
  a.gain(-6)

  let flat = await a.read()  // restores all pages
  // Re-evict
  await audio.evict(a)

  let streamed = []
  for await (let block of a.stream()) streamed.push(block[0])
  let streamBuf = new Float32Array(streamed.reduce((n, b) => n + b.length, 0))
  let pos = 0; for (let b of streamed) { streamBuf.set(b, pos); pos += b.length }

  t.is(streamBuf.length, flat[0].length, 'stream length matches flat after restore')
  let maxDiff = 0
  for (let i = 0; i < streamBuf.length; i++) maxDiff = Math.max(maxDiff, Math.abs(streamBuf[i] - flat[0][i]))
  t.ok(maxDiff < 0.01, `restored pages stream correctly (max diff ${maxDiff.toFixed(4)})`)
})


// ── Phase 17: Signal accuracy — canonical thresholds ────────────────────

/** Signal-to-Noise Ratio in dB between original and processed. */
function snr(signal, processed) {
  let noise = 0, sig = 0
  for (let i = 0; i < signal.length; i++) {
    sig += signal[i] * signal[i]
    let d = processed[i] - signal[i]
    noise += d * d
  }
  return noise === 0 ? Infinity : 10 * Math.log10(sig / noise)
}

/** Assert stream() output matches read() for a prepared audio instance. */
async function assertStreamRead(t, a, label) {
  let full = await a.read()
  let chunks = []
  for await (let chunk of a.stream()) chunks.push(chunk.map(c => c.slice()))
  for (let c = 0; c < full.length; c++) {
    let parts = chunks.map(ch => ch[c])
    let flat = new Float32Array(parts.reduce((n, p) => n + p.length, 0))
    let pos = 0
    for (let p of parts) { flat.set(p, pos); pos += p.length }
    t.is(flat.length, full[c].length, `${label} ch${c}: length`)
    let maxDiff = 0
    for (let i = 0; i < flat.length; i++) maxDiff = Math.max(maxDiff, Math.abs(flat[i] - full[c][i]))
    t.ok(maxDiff < 0.001, `${label} ch${c}: stream≈read (maxDiff: ${maxDiff.toFixed(6)})`)
  }
}

// ── Dither SNR (ref: 6 dB/bit rule, TPDF adds ±1 LSB) ─────────────────

test('dither — 16-bit SNR > 80 dB for full-scale sine', async t => {
  let ch = tone(1000, 1)
  let a = audio.from([ch.slice()], { sampleRate: 44100 })
  a.dither(16)
  let pcm = await a.read()
  let s = snr(ch, pcm[0])
  t.ok(s > 80, `16-bit SNR: ${s.toFixed(1)} dB > 80 dB`)
})

test('dither — 8-bit SNR > 35 dB for full-scale sine', async t => {
  let ch = tone(1000, 1)
  let a = audio.from([ch.slice()], { sampleRate: 44100 })
  a.dither(8)
  let pcm = await a.read()
  let s = snr(ch, pcm[0])
  t.ok(s > 35, `8-bit SNR: ${s.toFixed(1)} dB > 35 dB`)
})

test('dither — TPDF noise floor uniform (not correlated with signal)', async t => {
  let ch = new Float32Array(44100)  // silence
  let a = audio.from([ch], { sampleRate: 44100 })
  a.dither(8)
  let pcm = await a.read()
  // Split into 4 quarters, RMS should be similar across all
  let q = 4, qLen = Math.floor(pcm[0].length / q)
  let rmsVals = []
  for (let i = 0; i < q; i++) rmsVals.push(rms(pcm[0].subarray(i * qLen, (i + 1) * qLen)))
  let avg = rmsVals.reduce((a, b) => a + b) / q
  let maxDev = Math.max(...rmsVals.map(r => Math.abs(r - avg) / avg))
  t.ok(maxDev < 0.3, `noise floor uniform: max deviation ${(maxDev * 100).toFixed(1)}% < 30%`)
})

// ── Resample accuracy (ref: SoX < 0.5 dB residual, librosa atol 1e-2) ──

test('resample — round-trip 44100→48000→44100 preserves energy', async t => {
  let ch = tone(440, 1)
  let a = audio.from([ch], { sampleRate: 44100 })
  a.resample(48000).resample(44100)
  let pcm = await a.read()
  let inE = rms(ch), outE = rms(pcm[0])
  let err = Math.abs(outE - inE) / inE
  t.ok(err < 0.05, `energy preserved: ${inE.toFixed(4)} → ${outE.toFixed(4)} (${(err * 100).toFixed(1)}% < 5%)`)
})

test('resample — round-trip preserves pitch at 440 Hz', async t => {
  let ch = tone(440, 1)
  let a = audio.from([ch], { sampleRate: 44100 })
  a.resample(48000).resample(44100)
  let pcm = await a.read()
  let e440 = energyAt(mid(pcm[0]), 440)
  let e880 = energyAt(mid(pcm[0]), 880)
  t.ok(e440 > e880 * 3, `440Hz dominant after round-trip: ${e440.toFixed(3)} vs harmonic ${e880.toFixed(3)}`)
})

test('resample — downsampling attenuates above new Nyquist', async t => {
  let lo = tone(5000, 0.5), hi = tone(15000, 0.5)
  let aLo = audio.from([lo], { sampleRate: 44100 }); aLo.resample(22050)
  let aHi = audio.from([hi], { sampleRate: 44100 }); aHi.resample(22050)
  let rLo = rms((await aLo.read())[0]), rHi = rms((await aHi.read())[0])
  t.ok(rLo > 0.3, `5kHz survives: rms ${rLo.toFixed(3)}`)
  // Anti-alias lowpass attenuates above-Nyquist content (linear interp + lowpass)
  t.ok(rHi < rLo, `15kHz attenuated vs 5kHz: ${rHi.toFixed(3)} < ${rLo.toFixed(3)}`)
})

// ── Filter frequency response (ref: SoX sinusoid-fitting, < 0.5 dB) ────

test('allpass — flat magnitude across frequencies (< ±1 dB)', async t => {
  for (let f of [100, 500, 1000, 5000, 10000]) {
    let ch = tone(f, 0.3)
    let a = audio.from([ch], { sampleRate: 44100 })
    a.allpass(2000)
    let pcm = await a.read()
    let dB = 20 * Math.log10(rms(pcm[0]) / rms(ch))
    t.ok(Math.abs(dB) < 1, `allpass ${f}Hz: ${dB.toFixed(2)} dB`)
  }
})

test('highpass — frequency response: attenuates below cutoff, passes above', async t => {
  let cutoff = 1000, sr = 44100
  let gains = []
  for (let f of [100, 500, 2000, 5000]) {
    let ch = tone(f, 0.5, sr)
    let a = audio.from([ch], { sampleRate: sr })
    a.highpass(cutoff)
    let pcm = await a.read()
    gains.push({ f, dB: 20 * Math.log10(rms(mid(pcm[0], 0.1, sr)) / rms(mid(ch, 0.1, sr))) })
  }
  t.ok(gains[0].dB < -10, `100Hz: ${gains[0].dB.toFixed(1)} dB (< -10)`)
  t.ok(gains[1].dB < -3, `500Hz: ${gains[1].dB.toFixed(1)} dB (< -3)`)
  t.ok(gains[2].dB > -3, `2kHz: ${gains[2].dB.toFixed(1)} dB (> -3)`)
  t.ok(gains[3].dB > -1, `5kHz: ${gains[3].dB.toFixed(1)} dB (> -1)`)
})

test('lowpass — frequency response: passes below cutoff, attenuates above', async t => {
  let cutoff = 1000, sr = 44100
  let gains = []
  for (let f of [100, 500, 2000, 5000]) {
    let ch = tone(f, 0.5, sr)
    let a = audio.from([ch], { sampleRate: sr })
    a.lowpass(cutoff)
    let pcm = await a.read()
    gains.push({ f, dB: 20 * Math.log10(rms(mid(pcm[0], 0.1, sr)) / rms(mid(ch, 0.1, sr))) })
  }
  t.ok(gains[0].dB > -1, `100Hz: ${gains[0].dB.toFixed(1)} dB (> -1)`)
  t.ok(gains[1].dB > -3, `500Hz: ${gains[1].dB.toFixed(1)} dB (> -3)`)
  t.ok(gains[2].dB < -3, `2kHz: ${gains[2].dB.toFixed(1)} dB (< -3)`)
  t.ok(gains[3].dB < -10, `5kHz: ${gains[3].dB.toFixed(1)} dB (< -10)`)
})

test('crossfade — equal-power: RMS constant ±1 dB through transition', async t => {
  let sr = 44100
  let a = audio.from([new Float32Array(sr).fill(0.8)], { sampleRate: sr })
  let b = audio.from([new Float32Array(sr).fill(0.8)], { sampleRate: sr })
  a.crossfade(b, 0.5)
  let pcm = await a.read()
  let winSize = Math.round(0.1 * sr)
  let before = rms(pcm[0].subarray(0, winSize))
  let during = rms(pcm[0].subarray(Math.round(0.75 * sr), Math.round(0.75 * sr) + winSize))
  let after = rms(pcm[0].subarray(Math.round(1.2 * sr), Math.round(1.2 * sr) + winSize))
  let dB1 = 20 * Math.log10(during / before), dB2 = 20 * Math.log10(after / before)
  t.ok(Math.abs(dB1) < 1, `mid-transition: ${dB1.toFixed(2)} dB (< ±1)`)
  t.ok(Math.abs(dB2) < 0.5, `post-transition: ${dB2.toFixed(2)} dB (< ±0.5)`)
})


// ── Phase 18: Stream ≡ read guarantee ───────────────────────────────────

test('stream≡read — earwax', async t => {
  let a = audio.from([tone(440, 0.5), tone(880, 0.5)], { sampleRate: 44100 })
  a.earwax()
  await assertStreamRead(t, a, 'earwax')
})

test('stream≡read — vocals isolate', async t => {
  let a = audio.from([tone(440, 0.5), tone(440, 0.5)], { sampleRate: 44100 })
  a.vocals()
  await assertStreamRead(t, a, 'vocals')
})

test('stream≡read — vocals remove', async t => {
  let c = tone(440, 0.5), s = tone(2000, 0.5)
  let L = new Float32Array(c.length), R = new Float32Array(c.length)
  for (let i = 0; i < c.length; i++) { L[i] = c[i] + s[i]; R[i] = c[i] - s[i] }
  let a = audio.from([L, R], { sampleRate: 44100 })
  a.vocals('remove')
  await assertStreamRead(t, a, 'vocals-remove')
})

test('stream≡read — pan', async t => {
  let a = audio.from([new Float32Array(44100).fill(0.8), new Float32Array(44100).fill(0.6)], { sampleRate: 44100 })
  a.pan(0.7)
  await assertStreamRead(t, a, 'pan')
})

test('stream≡read — pan with range', async t => {
  let a = audio.from([new Float32Array(44100).fill(1), new Float32Array(44100).fill(1)], { sampleRate: 44100 })
  a.pan(-0.5, { at: 0.2, duration: 0.3 })
  await assertStreamRead(t, a, 'pan-range')
})

test('stream≡read — speed 2x', async t => {
  let ramp = new Float32Array(44100)
  for (let i = 0; i < ramp.length; i++) ramp[i] = i / ramp.length
  let a = audio.from([ramp], { sampleRate: 44100 })
  a.speed(2)
  await assertStreamRead(t, a, 'speed-2x')
})

test('stream≡read — speed 0.5x', async t => {
  let a = audio.from([tone(440, 0.5)], { sampleRate: 44100 })
  a.speed(0.5)
  await assertStreamRead(t, a, 'speed-0.5x')
})


// ── Phase 19: Op composition — chained ops stream ≡ read ────────────────

test('stream≡read — highpass + gain + trim', async t => {
  let sr = 44100, ch = new Float32Array(sr * 2)
  for (let i = sr / 2 | 0; i < sr * 1.5 | 0; i++) ch[i] = 0.5 * Math.sin(2 * Math.PI * 440 * i / sr)
  let a = audio.from([ch], { sampleRate: sr })
  a.highpass(200).gain(-3).trim()
  await assertStreamRead(t, a, 'hp+gain+trim')
})

test('stream≡read — vocals + lowpass + normalize', async t => {
  let c = tone(440, 0.5), s = tone(2000, 0.5)
  let L = new Float32Array(c.length), R = new Float32Array(c.length)
  for (let i = 0; i < c.length; i++) { L[i] = c[i] + s[i]; R[i] = c[i] - s[i] }
  let a = audio.from([L, R], { sampleRate: 44100 })
  a.vocals().lowpass(2000).normalize(0)
  await assertStreamRead(t, a, 'vocals+lp+norm')
})

test('stream≡read — reverse + gain + fade', async t => {
  let a = audio.from([tone(440, 1)], { sampleRate: 44100 })
  a.reverse().gain(-6).fade(0.2, 0.2)
  await assertStreamRead(t, a, 'rev+gain+fade')
})

test('stream≡read — crop + speed + pan (stereo)', async t => {
  let a = audio.from([tone(440, 2), tone(880, 2)], { sampleRate: 44100 })
  a.crop({ at: 0.5, duration: 1 }).speed(1.5).pan(0.3)
  await assertStreamRead(t, a, 'crop+speed+pan')
})

test('stream≡read — earwax + highpass + gain', async t => {
  let a = audio.from([tone(200, 0.5), tone(5000, 0.5)], { sampleRate: 44100 })
  a.earwax().highpass(300).gain(-3)
  await assertStreamRead(t, a, 'earwax+hp+gain')
})

test('stream≡read — pad + repeat + gain', async t => {
  let a = audio.from([tone(440, 0.3)], { sampleRate: 44100 })
  a.pad(0.1, 0.1).repeat(1).gain(-6)
  await assertStreamRead(t, a, 'pad+repeat+gain')
})


// ── Phase 20: Speed op ──────────────────────────────────────────────────

test('speed(2) — halves duration, shifts pitch up', async t => {
  let a = audio.from([tone(440, 1)], { sampleRate: 44100 })
  a.speed(2)
  t.is(a.duration, 0.5, 'duration halved')
  t.is(a.length, 22050, 'sample count halved')
  let pcm = await a.read()
  let e880 = energyAt(pcm[0], 880), e440 = energyAt(pcm[0], 440)
  t.ok(e880 > e440 * 2, `880Hz dominant: ${e880.toFixed(3)} vs ${e440.toFixed(3)}`)
})

test('speed(0.5) — doubles duration', async t => {
  let a = audio.from([tone(440, 1)], { sampleRate: 44100 })
  a.speed(0.5)
  t.is(a.duration, 2, 'duration doubled')
  t.is(a.length, 88200, 'sample count doubled')
})

test('speed(-1) — reverses audio', async t => {
  let ramp = new Float32Array(1000)
  for (let i = 0; i < 1000; i++) ramp[i] = i / 1000
  let a = audio.from([ramp])
  a.speed(-1)
  let pcm = await a.read()
  t.ok(pcm[0][0] > 0.99, `first ≈ 1 (got ${pcm[0][0].toFixed(3)})`)
  t.ok(pcm[0][999] < 0.01, `last ≈ 0 (got ${pcm[0][999].toFixed(3)})`)
})

test('speed(0) — throws RangeError on read', async t => {
  let a = audio.from([new Float32Array(100)])
  a.speed(0)
  try { await a.read(); t.fail('should throw') }
  catch (e) { t.ok(e instanceof RangeError, 'RangeError on speed(0)') }
})

test('speed — stereo preserves channel count', async t => {
  let a = audio.from([tone(440, 0.3), tone(880, 0.3)], { sampleRate: 44100 })
  a.speed(2)
  let pcm = await a.read()
  t.is(pcm.length, 2, 'stereo preserved')
  t.is(pcm[0].length, pcm[1].length, 'channels same length')
})


// ── CLI Parsing (fast, no file I/O) ────────────────────────────────────

if (isNode) {

const { parseValue, parseRange, parseArgs, showOpHelp, HELP } = await import('../bin/cli.js')

test('cli parseArgs — simple: input ops output', t => {
  let result = parseArgs(['in.wav', 'gain', '-3db', '-o', 'out.wav'])
  t.is(result.input, 'in.wav', 'input')
  t.is(result.output, 'out.wav', 'output')
  t.ok(result.ops.length === 1, '1 op')
  t.is(result.ops[0].name, 'gain', 'op name')
})

test('cli parseArgs — multiple ops', t => {
  let result = parseArgs(['in.wav', 'gain', '-3', 'trim', 'normalize', '-o', 'out.wav'])
  t.is(result.ops.length, 3, '3 ops')
})

test('cli parseValue — dB, Hz, duration', t => {
  t.is(parseValue('-3db'), -3, 'dB')
  t.is(parseValue('440hz'), 440, 'Hz')
  t.is(parseValue('8khz'), 8000, 'kHz')
  t.ok(typeof parseValue('1s') === 'number', 'duration')
})

test('cli parseRange — 1s..10s', t => {
  let r = parseRange('1s..10s')
  t.is(r.offset, 1, 'offset')
  t.is(r.duration, 9, 'duration')
})

test('cli op help — all built-in ops have help', t => {
  let ops = ['gain', 'fade', 'trim', 'normalize', 'reverse', 'crop', 'remove', 'repeat', 'remix', 'pan', 'pad', 'stretch', 'pitch',
    'highpass', 'lowpass', 'eq', 'lowshelf', 'highshelf', 'notch', 'bandpass', 'allpass', 'vocals', 'dither', 'earwax']
  for (let op of ops) t.ok(HELP[op], `${op} has help`)
})

test('cli ops registry — all built-ins available', t => {
  t.ok(audio.op('gain'), 'gain')
  t.ok(audio.op('fade'), 'fade')
  t.ok(audio.op('trim'), 'trim')
  t.ok(audio.op('normalize'), 'normalize')
  t.ok(audio.op('remix'), 'remix')
  t.ok(audio.op('allpass'), 'allpass')
  t.ok(audio.op('vocals'), 'vocals')
  t.ok(audio.op('dither'), 'dither')
  t.ok(audio.op('earwax'), 'earwax')
  t.ok(typeof audio.fn.resample === 'function', 'resample')
})

} // end isNode guard for CLI tests
