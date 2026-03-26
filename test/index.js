import test from 'tst'
import audio from '../src/index.js'
import { PAGE_SIZE, BLOCK_SIZE } from '../src/index.js'
import lena from 'audio-lena'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { tmpdir } from 'os'
import { join } from 'path'

let lenaPath = fileURLToPath(lena.url('wav'))
let lenaMp3 = fileURLToPath(lena.url('mp3'))


// ── Phase 1: Foundation ──────────────────────────────────────────────────

test('audio(wav) — load from file path', async t => {
  let a = await audio(lenaPath)
  t.ok(a.pages, 'returns audio instance')
  t.is(a.sampleRate, 44100, 'sampleRate')
  t.is(a.channels, 1, 'channels')
  t.ok(a.duration > 12 && a.duration < 13, `duration ~12.27s (got ${a.duration.toFixed(2)})`)
  t.ok(a.pages.length > 0, `has ${a.pages.length} pages`)
  t.ok(a.index.min[0].length > 0, 'index populated')
})

test('audio(mp3) — decode mp3', async t => {
  let a = await audio(lenaMp3)
  t.ok(a.duration > 12, `duration > 12s (got ${a.duration.toFixed(2)})`)
  t.is(a.sampleRate, 44100, 'sampleRate')
  t.ok(a.source, 'encoded source retained')
})

test('audio(buffer) — from ArrayBuffer', async t => {
  let buf = readFileSync(lenaPath)
  let a = await audio(buf.buffer)
  t.ok(a.duration > 12, 'decoded from ArrayBuffer')
})

test('audio(pcm) — wraps Float32Array[]', async t => {
  let ch = [new Float32Array(44100)]
  let a = await audio(ch)
  t.is(a.duration, 1, '1 second')
  t.is(a.channels, 1, 'mono')
  t.ok(!a.source, 'no encoded source (resident)')
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

test('audio(URL) — from URL object', async t => {
  let a = await audio(lena.url('wav'))
  t.ok(a.duration > 12, `duration > 12s (got ${a.duration.toFixed(2)})`)
})

test('audio(number) — silence returns Promise', async t => {
  let p = audio(3, { channels: 1 })
  t.ok(p instanceof Promise, 'returns Promise')
  let a = await p
  t.is(a.duration, 3, '3 seconds')
})

test('audio.from(AudioBuffer-like) — from object with getChannelData', async t => {
  let ch = new Float32Array(44100)
  let buf = { numberOfChannels: 1, sampleRate: 44100, getChannelData: () => ch }
  let a = audio.from(buf)
  t.is(a.duration, 1, '1 second')
  t.is(a.channels, 1, 'mono')
})

test('index — block structure', async t => {
  let a = audio.from([new Float32Array(PAGE_SIZE * 2)])
  t.is(a.index.blockSize, BLOCK_SIZE, 'blockSize = 1024')
  let expectedBlocks = Math.ceil(PAGE_SIZE * 2 / BLOCK_SIZE)
  t.is(a.index.min[0].length, expectedBlocks, `${expectedBlocks} blocks`)
  t.is(a.index.max[0].length, expectedBlocks, 'max same length')
  t.is(a.index.energy[0].length, expectedBlocks, 'energy same length')
})

test('index — values correct for sine wave', async t => {
  let sr = 44100, len = BLOCK_SIZE
  let ch = new Float32Array(len)
  for (let i = 0; i < len; i++) ch[i] = Math.sin(2 * Math.PI * 440 * i / sr)
  let a = audio.from([ch], { sampleRate: sr })

  t.ok(a.index.max[0][0] > 0.99, `max ≈ 1 (got ${a.index.max[0][0].toFixed(3)})`)
  t.ok(a.index.min[0][0] < -0.99, `min ≈ -1 (got ${a.index.min[0][0].toFixed(3)})`)
  t.ok(a.index.energy[0][0] > 0.4, `energy > 0.4 (got ${a.index.energy[0][0].toFixed(3)})`)
})


// ── Phase 2: Streaming decode ────────────────────────────────────────────

test('onprogress — fires during decode', async t => {
  let deltas = []
  await audio(lenaPath, {
    onprogress({ delta, offset, total }) {
      deltas.push({ delta, offset, total })
    }
  })
  t.ok(deltas.length > 0, `onprogress fired ${deltas.length} times`)
  t.ok(deltas[0].total > 12, 'total duration reported')
  t.ok(deltas[deltas.length - 1].offset > 0, 'offset progresses')

  // Verify delta shape
  let d = deltas[0].delta
  t.ok('fromBlock' in d, 'delta has fromBlock')
  t.ok(Array.isArray(d.min), 'delta.min is array of channels')
  t.ok(d.min[0] instanceof Float32Array, 'delta.min[0] is Float32Array')
  t.ok(Array.isArray(d.max) && Array.isArray(d.energy), 'delta has max and energy')
})

test('onprogress — delta covers full index', async t => {
  let totalBlocks = 0
  let a = await audio(lenaPath, {
    onprogress({ delta }) { totalBlocks += delta.min[0].length }
  })
  t.is(totalBlocks, a.index.min[0].length, 'deltas cover all index blocks')
})


// ── Phase 3: Structural ops ──────────────────────────────────────────────

test('slice — returns new Audio', async t => {
  let a = audio.from([new Float32Array(44100 * 10)], { sampleRate: 44100 })
  let b = a.slice(2, 3)
  t.ok(b !== a, 'different instance')
  t.ok(b.edits.length === 1, 'has slice edit')
  t.is(b.edits[0].type, 'slice')
})

test('remove + insert + pad — chain', async t => {
  let a = audio.from([new Float32Array(44100)])
  a.remove(0.2, 0.1).pad(0.5).insert(audio.from(0.1), 0)
  t.is(a.edits.length, 3, '3 edits')
  t.is(a.edits[0].type, 'remove')
  t.is(a.edits[1].type, 'pad')
  t.is(a.edits[2].type, 'insert')
})

test('repeat', async t => {
  let a = audio.from([new Float32Array(1000)])
  a.repeat(2)
  t.is(a.edits[0].type, 'repeat')
  t.is(a.edits[0].times, 2)
})

test('slice — materialized correctly', async t => {
  let ch = new Float32Array(44100 * 4)
  for (let i = 0; i < ch.length; i++) ch[i] = i / ch.length  // ramp 0→1
  let a = audio.from([ch], { sampleRate: 44100 })
  let b = a.slice(1, 2)  // seconds 1-3
  let pcm = await b.read()
  t.is(pcm[0].length, 88200, '2 seconds')
  t.ok(pcm[0][0] > 0.24, 'starts at ~0.25 (1s of 4s)')
})

test('remove — materialized correctly', async t => {
  let ch = new Float32Array(44100 * 3).fill(1)
  let a = audio.from([ch], { sampleRate: 44100 })
  a.remove(1, 1)  // remove second 1-2
  let pcm = await a.read()
  t.is(pcm[0].length, 88200, '3s - 1s = 2s')
})

test('insert — materialized correctly', async t => {
  let a = audio.from([new Float32Array(44100).fill(0)], { sampleRate: 44100 })
  let b = audio.from([new Float32Array(44100).fill(1)], { sampleRate: 44100 })
  a.insert(b, 0.5)
  let pcm = await a.read()
  t.is(pcm[0].length, 88200, '1s + 1s = 2s')
  t.ok(pcm[0][0] === 0, 'start is original')
  t.ok(pcm[0][Math.round(0.5 * 44100)] === 1, 'inserted at 0.5s')
})

test('pad — materialized correctly', async t => {
  let a = audio.from([new Float32Array(44100).fill(1)], { sampleRate: 44100 })
  a.pad(1)  // pad 1s at end
  let pcm = await a.read()
  t.is(pcm[0].length, 88200, '1s + 1s pad = 2s')
  t.is(pcm[0][0], 1, 'original preserved')
  t.is(pcm[0][88199], 0, 'padded with silence')
})

test('pad start — materialized correctly', async t => {
  let a = audio.from([new Float32Array(44100).fill(1)], { sampleRate: 44100 })
  a.pad(1, { side: 'start' })
  let pcm = await a.read()
  t.is(pcm[0].length, 88200, '1s pad + 1s = 2s')
  t.is(pcm[0][0], 0, 'silence at start')
  t.is(pcm[0][88199], 1, 'original at end')
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
  a.remove(0, 1).gain(-6)  // remove first second, then apply gain
  let pcm = await a.read()
  t.is(pcm[0].length, 44100, '2s - 1s = 1s')
  let expected = Math.pow(10, -6 / 20)
  t.ok(Math.abs(pcm[0][0] - expected) < 0.01, 'gain applied to remaining')
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
  t.is(edit.type, 'gain', 'returned edit is gain')

  t.is(a.undo(), null, 'undo on empty returns null')
})

test('onchange — fires', async t => {
  let calls = 0
  let a = audio.from([new Float32Array(44100)])
  a.onchange = () => calls++
  a.gain(-3)
  t.is(calls, 1, 'fired on edit')
  a.undo()
  t.is(calls, 2, 'fired on undo')
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
  a.gain(-6, 0.5, 0.5)  // -6dB from 0.5s for 0.5s
  let pcm = await a.read()
  t.ok(Math.abs(pcm[0][0] - 1) < 0.001, 'before range: unchanged')
  let mid = Math.round(0.75 * 44100)
  let expected = Math.pow(10, -6 / 20)
  t.ok(Math.abs(pcm[0][mid] - expected) < 0.001, 'in range: -6dB')
  let after = Math.round(1.5 * 44100)
  t.ok(Math.abs(pcm[0][after] - 1) < 0.001, 'after range: unchanged')
})

test('fade in/out', async t => {
  let ch = new Float32Array(44100).fill(1)
  let a = audio.from([ch], { sampleRate: 44100 })
  a.fade(0.5).fade(-0.5)
  let pcm = await a.read()
  t.ok(pcm[0][0] < 0.01, 'start is silent (fade in)')
  t.ok(Math.abs(pcm[0][22050] - 1) < 0.01, 'middle is full')
  t.ok(pcm[0][44099] < 0.01, 'end is silent (fade out)')
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

test('write', async t => {
  let a = audio.from([new Float32Array(100).fill(0)])
  a.write([new Float32Array([1, 1, 1])], 0)
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
  let ch = new Float32Array(1000).fill(0.25)
  let a = audio.from([ch])
  a.normalize(0)
  let pcm = await a.read()
  t.ok(Math.abs(pcm[0][0] - 1) < 0.01, `normalized to ~1 (got ${pcm[0][0].toFixed(3)})`)
})

test('audio.define — custom op', async t => {
  audio.define('double', (block) => {
    for (let ch of block) for (let i = 0; i < ch.length; i++) ch[i] *= 2
    return block
  })
  let a = audio.from([new Float32Array(100).fill(0.25)])
  a.double()
  let pcm = await a.read()
  t.ok(Math.abs(pcm[0][0] - 0.5) < 0.001, 'doubled: 0.25 → 0.5')
})

test('audio.define — with arg', async t => {
  audio.define('amplify', { args: 1 }, (block, factor) => {
    for (let ch of block) for (let i = 0; i < ch.length; i++) ch[i] *= factor
    return block
  })
  let a = audio.from([new Float32Array(100).fill(0.1)])
  a.amplify(3)
  let pcm = await a.read()
  t.ok(Math.abs(pcm[0][0] - 0.3) < 0.001, 'amplified: 0.1 × 3 = 0.3')
})

test('audio.define — with range', async t => {
  audio.define('mute', (block) => {
    for (let ch of block) ch.fill(0)
    return block
  })
  let a = audio.from([new Float32Array(44100).fill(1)], { sampleRate: 44100 })
  a.mute(0.5, 0.5)  // mute from 0.5s for 0.5s
  let pcm = await a.read()
  t.ok(pcm[0][0] === 1, 'before range: unchanged')
  t.ok(pcm[0][Math.round(0.75 * 44100)] === 0, 'in range: muted')
})

test('audio.define — duplicate throws', async t => {
  t.throws(() => audio.define('double', () => {}), 'throws on duplicate')
})

test('toJSON — serializable', async t => {
  let a = audio.from([new Float32Array(44100)])
  a.gain(-3).reverse()
  let json = a.toJSON()
  t.is(json.edits.length, 2, '2 edits')
  t.is(json.edits[0].type, 'gain', 'first is gain')
  t.is(json.edits[1].type, 'reverse', 'second is reverse')
})


// ── Phase 6: Materialization ─────────────────────────────────────────────

test('read — full materialization', async t => {
  let a = await audio(lenaPath)
  let pcm = await a.read()
  t.is(pcm.length, 1, '1 channel')
  t.is(pcm[0].length, lena.samplesCount, `${lena.samplesCount} samples`)
})

test('read — sub-range', async t => {
  let a = audio.from([new Float32Array(44100 * 10)], { sampleRate: 44100 })
  let pcm = await a.read(2, 3)
  let expected = Math.round(3 * 44100)
  t.is(pcm[0].length, expected, `3 seconds = ${expected} samples`)
})

test('read — with format', async t => {
  let a = audio.from([new Float32Array(100).fill(0.5)])
  let pcm = await a.read(null, null, { format: 'int16' })
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
  let wav = await a.encode('wav')
  t.ok(wav instanceof Uint8Array, 'encoded to Uint8Array')
  t.ok(wav.length > 1000, `wav size: ${wav.length}`)

  // Decode back
  let b = await audio(wav)
  t.ok(Math.abs(b.duration - 1) < 0.01, 'round-trip duration')
})

test('save — write to file', async t => {
  let a = audio.from([new Float32Array(44100).fill(0.5)], { sampleRate: 44100 })
  let path = join(tmpdir(), `audio-test-${Date.now()}.wav`)
  await a.save(path)
  let b = await audio(path)
  t.ok(Math.abs(b.duration - 1) < 0.02, 'saved and reloaded')
})


// ── Phase 7: Analysis ────────────────────────────────────────────────────

test('limits — sine wave', async t => {
  let ch = new Float32Array(44100)
  for (let i = 0; i < ch.length; i++) ch[i] = 0.8 * Math.sin(2 * Math.PI * 440 * i / 44100)
  let a = audio.from([ch], { sampleRate: 44100 })
  let { min, max } = await a.limits()
  t.ok(max > 0.79 && max < 0.81, `max ≈ 0.8 (got ${max.toFixed(3)})`)
  t.ok(min < -0.79 && min > -0.81, `min ≈ -0.8 (got ${min.toFixed(3)})`)
})

test('limits — with range', async t => {
  let ch = new Float32Array(44100 * 2).fill(0)
  for (let i = 44100; i < 88200; i++) ch[i] = 0.5
  let a = audio.from([ch], { sampleRate: 44100 })
  let full = await a.limits()
  t.ok(full.max >= 0.5, 'full max includes signal')
  let first = await a.limits(0, 0.5)
  t.ok(first.max < 0.01, 'first 0.5s is silent')
})

test('peaks', async t => {
  let a = await audio(lenaPath)
  let p = await a.peaks(100)
  t.is(p.min.length, 100, '100 min peaks')
  t.is(p.max.length, 100, '100 max peaks')
  t.ok(p.max instanceof Float32Array, 'Float32Array')
  t.ok(Math.max(...p.max) > 0, 'has signal')
})

test('peaks — per-channel', async t => {
  let a = audio.from([new Float32Array(44100).fill(0.5), new Float32Array(44100).fill(-0.3)])
  let p0 = await a.peaks(10, { channel: 0 })
  let p1 = await a.peaks(10, { channel: 1 })
  t.ok(p0.max[0] > 0.4, 'ch0 positive')
  t.ok(p1.min[0] < -0.2, 'ch1 negative')
})

test('loudness', async t => {
  let ch = new Float32Array(44100)
  for (let i = 0; i < ch.length; i++) ch[i] = 0.5 * Math.sin(2 * Math.PI * 1000 * i / 44100)
  let a = audio.from([ch], { sampleRate: 44100 })
  let lufs = await a.loudness()
  t.ok(typeof lufs === 'number', 'returns number')
  t.ok(lufs < 0, `LUFS is negative (got ${lufs.toFixed(1)})`)
  t.ok(lufs > -30, `LUFS > -30 (got ${lufs.toFixed(1)})`)
})

test('loudness — lena real audio', async t => {
  let a = await audio(lenaPath)
  let lufs = await a.loudness()
  t.ok(lufs < 0, `LUFS negative (got ${lufs.toFixed(1)})`)
  t.ok(lufs > -40, `LUFS > -40 (got ${lufs.toFixed(1)})`)
})

test('analysis after dirty op — reindexes', async t => {
  let ch = new Float32Array(44100).fill(0.5)
  let a = audio.from([ch], { sampleRate: 44100 })
  let before = await a.limits()
  a.fade(0.5)  // dirty op
  let after = await a.limits()
  t.ok(after.min < before.min || after.max <= before.max, 'limits changed after fade')
})


// ── Phase 8: Playback ────────────────────────────────────────────────────

test('play — returns controller', async t => {
  let a = audio.from([new Float32Array(4410)], { sampleRate: 44100 })
  let p = a.play()
  t.ok(p, 'controller returned')
  t.ok('pause' in p, 'has pause')
  t.ok('stop' in p, 'has stop')
  t.ok('currentTime' in p, 'has currentTime')
  t.ok('playing' in p, 'has playing')
  p.stop()
})

test('play — parallel controllers', async t => {
  let a = audio.from([new Float32Array(4410)], { sampleRate: 44100 })
  let p1 = a.play(0)
  let p2 = a.play(0)
  t.ok(p1 !== p2, 'different controllers')
  p1.stop()
  p2.stop()
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
  for await (let block of a.stream(2, 3)) totalSamples += block[0].length
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
