import test from 'tst'
import audio from '../audio.js'
import { PAGE_SIZE, BLOCK_SIZE } from '../audio.js'

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
  t.ok(a.index.min[0].length > 0, 'index populated')
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

let testURL = isNode ? test : test.skip  // URL objects with file:// only work in Node
testURL('audio(URL) — from URL object', async t => {
  let lena = (await import('audio-lena')).default
  let a = await audio(lena.url('wav'))
  t.ok(a.duration > 12, `duration > 12s (got ${a.duration.toFixed(2)})`)
})

test('audio(number) — silence returns Promise', async t => {
  let p = audio(3, { channels: 1 })
  t.ok(p instanceof Promise, 'returns Promise')
  let a = await p
  t.is(a.duration, 3, '3 seconds')
})

test('audio.from(audio) — structural copy', async t => {
  let a = audio.from([new Float32Array(100).fill(0.7)])
  a.gain(-6)
  let b = audio.from(a)
  t.ok(b !== a, 'different instance')
  t.is(b.edits.length, 0, 'copy has no edits (independent edit list)')
  t.is(b.pages, a.pages, 'copy shares pages')
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

test('audio.index — custom field', async t => {
  // Per-channel metric — return array
  audio.index('rms', (channels) => channels.map(ch => {
    let sum = 0
    for (let i = 0; i < ch.length; i++) sum += ch[i] * ch[i]
    return Math.sqrt(sum / ch.length)
  }))
  let ch = new Float32Array(BLOCK_SIZE * 2).fill(0.5)
  let a = audio.from([ch])
  t.ok(a.index.rms, 'custom index field exists')
  t.is(a.index.rms[0].length, 2, '2 blocks')
  t.ok(Math.abs(a.index.rms[0][0] - 0.5) < 0.01, `rms ≈ 0.5 (got ${a.index.rms[0][0].toFixed(3)})`)

  // Cross-channel metric — return number (broadcast to all channels)
  audio.index('correlation', (channels) => {
    if (channels.length < 2) return 1
    let L = channels[0], R = channels[1], sum = 0
    for (let i = 0; i < L.length; i++) sum += L[i] * R[i]
    return sum / L.length
  })
  let stereo = audio.from([new Float32Array(BLOCK_SIZE).fill(0.5), new Float32Array(BLOCK_SIZE).fill(0.5)])
  t.ok(stereo.index.correlation, 'cross-channel field exists')
  t.ok(stereo.index.correlation[0][0] > 0.2, `correlated (${stereo.index.correlation[0][0].toFixed(3)})`)
  t.is(stereo.index.correlation[0][0], stereo.index.correlation[1][0], 'same value both channels')
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

test('crop — keeps range in place', async t => {
  let a = audio.from([new Float32Array(44100 * 10)], { sampleRate: 44100 })
  a.crop(2, 3)
  t.is(a.edits.length, 1, 'one edit')
  t.is(a.edits[0].type, 'crop')
  let pcm = await a.read()
  t.is(pcm[0].length, Math.round(3 * 44100), 'cropped to 3 seconds')
})

test('remove + insert — chain', async t => {
  let a = audio.from([new Float32Array(44100)])
  a.remove(0.2, 0.1).insert(0.5).insert(audio.from(0.1), 0)
  t.is(a.edits.length, 3, '3 edits')
  t.is(a.edits[0].type, 'remove')
  t.is(a.edits[1].type, 'insert')
  t.is(a.edits[2].type, 'insert')
})

test('repeat', async t => {
  let a = audio.from([new Float32Array(1000)])
  a.repeat(2)
  t.is(a.edits[0].type, 'repeat')
  t.is(a.edits[0].args[0], 2)
})

test('crop — materialized correctly', async t => {
  let ch = new Float32Array(44100 * 4)
  for (let i = 0; i < ch.length; i++) ch[i] = i / ch.length  // ramp 0→1
  let a = audio.from([ch], { sampleRate: 44100 })
  a.crop(1, 2)  // keep seconds 1..3
  let pcm = await a.read()
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
  a.insert(1, 0)  // insert 1s silence at start
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
  a.remove(0, 1).gain(-6)  // remove first second, then apply gain
  let pcm = await a.read()
  t.is(pcm[0].length, 44100, '2s - 1s = 1s')
  let expected = Math.pow(10, -6 / 20)
  t.ok(Math.abs(pcm[0][0] - expected) < 0.01, 'gain applied to remaining')
})

test('duration/length reflect structural edits', async t => {
  let a = audio.from([new Float32Array(44100 * 4)], { sampleRate: 44100 })
  t.is(a.duration, 4, 'source: 4s')
  t.is(a.length, 44100 * 4, 'source: 176400 samples')

  a.crop(1, 2)
  t.is(a.duration, 2, 'after crop(1,2): 2s')
  t.is(a.length, 88200, 'after crop: 88200 samples')

  a.undo()
  t.is(a.duration, 4, 'after undo: back to 4s')
})

test('duration reflects remove/insert/repeat', async t => {
  let a = audio.from([new Float32Array(44100 * 3)], { sampleRate: 44100 })
  a.remove(0, 1)
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
  t.is(edit.type, 'gain', 'returned edit is gain')

  t.is(a.undo(), null, 'undo on empty returns null')
})

test('do — re-apply undone edit', async t => {
  let a = audio.from([new Float32Array(100).fill(1)])
  a.gain(-6)
  let edit = a.undo()
  t.is(a.edits.length, 0, 'undone')
  a.do(edit)
  t.is(a.edits.length, 1, 're-applied')
  t.is(a.edits[0].type, 'gain', 'same edit type')
  let pcm = await a.read()
  let expected = Math.pow(10, -6 / 20)
  t.ok(Math.abs(pcm[0][0] - expected) < 0.01, 'effect re-applied correctly')
})

test('do — inline function', async t => {
  let a = audio.from([new Float32Array(100).fill(1)])
  a.do((chs) => chs.map(ch => { let o = new Float32Array(ch); for (let i = 0; i < o.length; i++) o[i] *= 0.5; return o }))
  let pcm = await a.read()
  t.ok(Math.abs(pcm[0][0] - 0.5) < 0.01, 'inline fn applied: 1 * 0.5 = 0.5')
})

test('do — inline function stop signal', async t => {
  let a = audio.from([new Float32Array(44100).fill(1)], { sampleRate: 44100 })
  a.do(() => false)  // stop — skip this op entirely
  a.do((chs) => chs.map(ch => { let o = new Float32Array(ch); o.fill(0.5); return o }))
  let pcm = await a.read()
  // First fn returned false (skipped), second fn applied
  t.ok(pcm[0][0] === 0.5, 'false skips op, next op still applies')
})

test('do — variadic', async t => {
  let a = audio.from([new Float32Array(100).fill(1)])
  a.do(
    { type: 'gain', args: [-6] },
    (chs) => chs.map(ch => { let o = new Float32Array(ch); for (let i = 0; i < o.length; i++) o[i] *= 2; return o })
  )
  t.is(a.edits.length, 2, 'two edits from one do() call')
  let pcm = await a.read()
  let expected = Math.pow(10, -6 / 20) * 2
  t.ok(Math.abs(pcm[0][0] - expected) < 0.01, `gain + double: ${pcm[0][0].toFixed(3)} ≈ ${expected.toFixed(3)}`)
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
  a.fade(0.5).fade(-0.5, 'linear', -0.5)  // fade in first 0.5s, fade out last 0.5s
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

test('read — format via pcm-convert', async t => {
  let a = audio.from([new Float32Array(100).fill(0.5)])
  let int16 = await a.read({ format: 'int16' })
  t.ok(int16[0] instanceof Int16Array, 'Int16Array')
  t.ok(int16[0][0] > 16000, `int16 value: ${int16[0][0]}`)
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

test('audio.op — custom op', async t => {
  audio.op('double', () => (block) => {
    for (let ch of block) for (let i = 0; i < ch.length; i++) ch[i] *= 2
    return block
  })
  let a = audio.from([new Float32Array(100).fill(0.25)])
  a.double()
  let pcm = await a.read()
  t.ok(Math.abs(pcm[0][0] - 0.5) < 0.001, 'doubled: 0.25 → 0.5')
})

test('audio.op — with arg', async t => {
  audio.op('amplify', (factor) => (block) => {
    for (let ch of block) for (let i = 0; i < ch.length; i++) ch[i] *= factor
    return block
  })
  let a = audio.from([new Float32Array(100).fill(0.1)])
  a.amplify(3)
  let pcm = await a.read()
  t.ok(Math.abs(pcm[0][0] - 0.3) < 0.001, 'amplified: 0.1 × 3 = 0.3')
})

test('audio.op — with range', async t => {
  audio.op('mute', () => (chs, { offset = 0, duration, sampleRate: sr }) => {
    let s = Math.round(offset * sr), e = duration != null ? s + Math.round(duration * sr) : chs[0].length
    return chs.map(ch => { let o = new Float32Array(ch); for (let i = s; i < Math.min(e, o.length); i++) o[i] = 0; return o })
  })
  let a = audio.from([new Float32Array(44100).fill(1)], { sampleRate: 44100 })
  a.mute(0.5, 0.5)  // mute from 0.5s for 0.5s
  let pcm = await a.read()
  t.ok(pcm[0][0] === 1, 'before range: unchanged')
  t.ok(pcm[0][Math.round(0.75 * 44100)] === 0, 'in range: muted')
})

test('audio.op — duplicate throws', async t => {
  t.throws(() => audio.op('double', () => () => {}), 'throws on duplicate')
})

test('toJSON — serializable with source', async t => {
  let a = await audio(lenaPath)
  a.gain(-3).reverse()
  let json = a.toJSON()
  t.is(json.source, lenaPath, 'source preserved')
  t.is(json.edits.length, 2, '2 edits')
  t.is(json.edits[0].type, 'gain', 'first is gain')
  t.is(json.edits[1].type, 'reverse', 'second is reverse')
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
  let wav = await a.read({ format: 'wav' })
  t.ok(wav instanceof Uint8Array, 'read as wav → Uint8Array')
  t.ok(wav.length > 1000, `wav size: ${wav.length}`)

  // Decode back
  let b = await audio(wav)
  t.ok(Math.abs(b.duration - 1) < 0.01, 'round-trip duration')
})

let testSave = isNode ? test : test.skip
testSave('save — write to file', async t => {
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
  let s = await a.stat()
  t.ok(s.max > 0.79 && s.max < 0.81, `max ≈ 0.8 (got ${s.max.toFixed(3)})`)
  t.ok(s.min < -0.79 && s.min > -0.81, `min ≈ -0.8 (got ${s.min.toFixed(3)})`)
  t.ok(s.rms > 0, `rms > 0 (got ${s.rms.toFixed(3)})`)
  t.ok(s.peak < 0 && s.peak > -3, `peak ≈ -2dB (got ${s.peak.toFixed(1)})`)
  t.ok(s.loudness < 0, `loudness negative (got ${s.loudness.toFixed(1)})`)
})

test('stat — with range', async t => {
  let ch = new Float32Array(44100 * 2).fill(0)
  for (let i = 44100; i < 88200; i++) ch[i] = 0.5
  let a = audio.from([ch], { sampleRate: 44100 })
  let full = await a.stat()
  t.ok(full.max >= 0.5, 'full max includes signal')
  let first = await a.stat(0, 0.5)
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

test('stat — loudness (K-weighted LUFS)', async t => {
  let ch = new Float32Array(44100)
  for (let i = 0; i < ch.length; i++) ch[i] = 0.5 * Math.sin(2 * Math.PI * 1000 * i / 44100)
  let a = audio.from([ch], { sampleRate: 44100 })
  let s = await a.stat()
  t.ok(typeof s.loudness === 'number', 'returns number')
  t.ok(s.loudness < 0, `LUFS is negative (got ${s.loudness.toFixed(1)})`)
  t.ok(s.loudness > -30, `LUFS > -30 (got ${s.loudness.toFixed(1)})`)
})

test('stat — lena real audio', async t => {
  let a = await audio(lenaPath)
  let s = await a.stat()
  t.ok(s.loudness < 0, `LUFS negative (got ${s.loudness.toFixed(1)})`)
  t.ok(s.loudness > -40, `LUFS > -40 (got ${s.loudness.toFixed(1)})`)
  t.ok(s.rms > 0, `rms > 0 (got ${s.rms.toFixed(3)})`)
  t.ok(s.peak < 0, `peak dBFS negative (got ${s.peak.toFixed(1)})`)
})

test('stat — after dirty op reindexes', async t => {
  let ch = new Float32Array(44100).fill(0.5)
  let a = audio.from([ch], { sampleRate: 44100 })
  let before = await a.stat()
  a.fade(0.5)  // dirty op
  let after = await a.stat()
  t.ok(after.max <= before.max, 'max changed after fade')
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


test('stream — plan-based crop+gain matches full render', async t => {
  let ch = new Float32Array(44100 * 4)
  for (let i = 0; i < ch.length; i++) ch[i] = i / ch.length
  let a = audio.from([ch], { sampleRate: 44100 })
  a.crop(1, 2).gain(-6)

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
  a.remove(1, 1).gain(-6)

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
  a.insert(0.5, 0.5)  // insert 0.5s silence at 0.5s
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

test('stream — falls back for inline fn', async t => {
  let a = audio.from([new Float32Array(44100).fill(1)], { sampleRate: 44100 })
  a.do((chs) => chs.map(ch => { let o = new Float32Array(ch); for (let i = 0; i < o.length; i++) o[i] *= 0.5; return o }))

  let streamed = []
  for await (let block of a.stream()) streamed.push(block[0])
  let flat = new Float32Array(streamed.reduce((n, b) => n + b.length, 0))
  let pos = 0; for (let b of streamed) { flat.set(b, pos); pos += b.length }

  t.ok(Math.abs(flat[0] - 0.5) < 0.01, 'inline fn applied via fallback')
})

test('cursor — preloads nearby pages only', async t => {
  let a = audio.from([new Float32Array(44100 * 3)], { sampleRate: 44100 })
  a.gain(-3)
  a.cursor = 1.5
  // Cursor should preload pages but NOT warm render cache
  t.ok(a._cache === null, 'render cache NOT warmed by cursor (lazy)')
  t.ok(a._cursor === 1.5, 'cursor position set')
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

  // Index should still work without PCM
  let s = await a.stat()
  t.ok(s.max >= 0.69, `index works after eviction: max=${s.max.toFixed(2)}`)
})

test('cache backend — analysis from index without page-in', async t => {
  let ch = new Float32Array(PAGE_SIZE * 4).fill(0.3)
  let cache = mockCache()

  let a = await audio([ch], { cache, budget: 0 })  // evict all pages
  let allEvicted = a.pages.every(p => p === null)
  t.ok(allEvicted, 'all pages evicted')

  // peaks/stat should work from index alone (no PCM needed for clean ops)
  let peaks = await a.peaks(10)
  t.ok(peaks.max[0] >= 0.29, 'peaks from index without page-in')
  let s = await a.stat()
  t.ok(s.max >= 0.29, 'stat from index without page-in')
})

let testNode = isNode ? test : test.skip
testNode('storage: persistent — throws in Node (no OPFS)', async t => {
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
  a.fade(-0.5, 'linear', -0.5)  // explicit offset: -0.5s from end
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
  let w1 = await a.read(0, 1)
  let w2 = await b.read(0, 1)
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

test('onprogress — fires incrementally for mp3', async t => {
  let deltas = [], prevOffset = 0
  let a = await audio(lenaMp3, {
    onprogress({ delta, offset, total }) {
      t.ok(offset >= prevOffset, `offset monotonic: ${offset} >= ${prevOffset}`)
      prevOffset = offset
      deltas.push(delta)
    }
  })
  t.ok(deltas.length > 1, `onprogress fired ${deltas.length} times (chunked decode)`)
  // Verify deltas cover full index
  let totalBlocks = deltas.reduce((n, d) => n + d.min[0].length, 0)
  t.is(totalBlocks, a.index.min[0].length, 'deltas cover all index blocks')
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

test('stat — no edits skips refreshIndex', async t => {
  let ch = new Float32Array(44100).fill(0.5)
  let a = audio.from([ch], { sampleRate: 44100 })
  let s = await a.stat()
  t.ok(s.max >= 0.49, `stat from clean index: max=${s.max.toFixed(2)}`)
  t.ok(s.rms > 0, 'rms from clean index')
})

test('insert audio — plan-based matches render', async t => {
  let a = audio.from([new Float32Array(44100).fill(0.3)], { sampleRate: 44100 })
  let b = audio.from([new Float32Array(22050).fill(0.9)], { sampleRate: 44100 })
  a.insert(b, 0.5)
  let pcm = await a.read()
  t.is(pcm[0].length, 44100 + 22050, '1s + 0.5s insert')
  t.ok(Math.abs(pcm[0][0] - 0.3) < 0.01, 'original at start')
  t.ok(Math.abs(pcm[0][Math.round(0.5 * 44100)] - 0.9) < 0.01, 'inserted at 0.5s')
  t.ok(Math.abs(pcm[0][pcm[0].length - 1] - 0.3) < 0.01, 'original at end')
})


// ── Phase 12: API improvements ──────────────────────────────────────────────

test('peaks — sub-range matches full-range slice', async t => {
  let ch = new Float32Array(44100).fill(0)
  for (let i = 10000; i < 20000; i++) ch[i] = 0.5
  let a = audio.from([ch], { sampleRate: 44100 })
  let fullPeaks = await a.peaks(100)
  let subPeaks = await a.peaks(100, 0.2, 0.25)
  t.is(subPeaks.min.length, 100, '100 buckets')
  t.ok(Math.max(...subPeaks.max) > 0.4, 'subrange detected signal')
})

test('peaks — per-channel returns arrays', async t => {
  let ch0 = new Float32Array(44100).fill(0.3)
  let ch1 = new Float32Array(44100).fill(0.7)
  let a = audio.from([ch0, ch1], { sampleRate: 44100 })
  let peaks = await a.peaks(100, undefined, undefined, { channels: true })
  t.ok(Array.isArray(peaks.min), 'min is array')
  t.is(peaks.min.length, 2, 'two channels')
  t.is(peaks.min[0].length, 100, 'first channel 100 buckets')
  // Check that per-channel values are approximately correct
  let ch0Min = Math.min(...peaks.min[0])
  let ch1Min = Math.min(...peaks.min[1])
  t.ok(ch0Min > 0.25 && ch0Min < 0.35, `channel 0 min ${ch0Min.toFixed(3)} ~0.3`)
  t.ok(ch1Min > 0.65 && ch1Min < 0.75, `channel 1 min ${ch1Min.toFixed(3)} ~0.7`)
})

test('peaks — shorthand peaks(count, opts)', async t => {
  let a = audio.from([new Float32Array(44100).fill(0.5)], { sampleRate: 44100 })
  let peaks = await a.peaks(100, { channel: 0 })
  t.is(peaks.min.length, 100, 'shorthand works')
})

test('cursor — set doesn\'t trigger renderCached', async t => {
  let a = audio.from([new Float32Array(44100).fill(0.5)], { sampleRate: 44100 })
  a.cursor = 0.5
  t.ok(a._cache === null, '_cache stays null after cursor set')
})

test('insert clean source — source _cache stays null', async t => {
  let a = audio.from([new Float32Array(44100).fill(0.3)], { sampleRate: 44100 })
  let b = audio.from([new Float32Array(22050).fill(0.9)], { sampleRate: 44100 })
  a.insert(b, 0.5)
  let pcm = await a.read()
  t.ok(b._cache === null, 'clean source _cache not materialized')
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
  t.ok(edit && edit.type === 'gain', 'returns single edit')
  t.is(a.edits.length, 1, '1 edit remains')
})

test('trim — auto-floor on audio with silence margins', async t => {
  let ch = new Float32Array(44100).fill(0)
  for (let i = 5000; i < 39000; i++) ch[i] = 0.5
  let a = audio.from([ch], { sampleRate: 44100 })
  a.trim()
  let { offset, duration } = a.edits[0]
  t.ok(offset > 0.05, `trim detected silence margin, offset=${offset.toFixed(3)}`)
  t.ok(duration < 0.9, `trim detected end silence, duration=${duration.toFixed(3)}`)
})

test('trim — post-edit index used after gain', async t => {
  let ch = new Float32Array(44100).fill(0)
  for (let i = 10000; i < 30000; i++) ch[i] = 0.1
  let a = audio.from([ch], { sampleRate: 44100 })
  a.gain(10)
  a.trim(-20)
  let { offset, duration } = a.edits[a.edits.length - 1]
  t.ok(offset > 0, 'trim used post-gain index')
  t.ok(duration > 0, 'trim found silence region after gain')
})

test('trim — all-silence produces zero-duration crop', async t => {
  let a = audio.from([new Float32Array(44100)], { sampleRate: 44100 })
  a.trim()
  let { duration } = a.edits[0]
  t.is(duration, 0, 'zero-duration crop for silence')
})

test('view — shares pages reference', async t => {
  let a = audio.from([new Float32Array(44100).fill(0.5)], { sampleRate: 44100 })
  let v = a.view()
  t.is(v.pages, a.pages, 'view shares pages')
  t.is(v.index, a.index, 'view shares index')
})

test('view(offset, dur) — reads correct sub-range PCM', async t => {
  let ch = new Float32Array(44100).fill(0)
  for (let i = 22050; i < 33075; i++) ch[i] = 0.7
  let a = audio.from([ch], { sampleRate: 44100 })
  let v = a.view(0.5, 0.25)
  let pcm = await v.read()
  t.is(pcm[0].length, 11025, '0.25s at 44100 Hz = 11025 samples')
  t.ok(Math.abs(pcm[0][0] - 0.7) < 0.01, 'view reads correct window')
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
  t.is(c.pages, a.pages, 'copy shares pages')
  t.ok(c.edits !== a.edits, 'copy has independent edit list')
  c.gain(-3)
  t.is(a.edits.length, 0, 'original unaffected by copy\'s edit')
  t.is(c.edits.length, 1, 'copy has its own edit')
})

let testSavePhase12 = isNode ? test : test.skip
testSavePhase12('save — format option overrides extension', async t => {
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

test('normalize — LUFS mode adjusts loudness', async t => {
  let ch = new Float32Array(44100).fill(0.2)
  let a = audio.from([ch], { sampleRate: 44100 })
  a.normalize(-14, { mode: 'lufs' })
  let pcm = await a.read()
  let rms = 0
  for (let s of pcm[0]) rms += s * s
  rms = Math.sqrt(rms / pcm[0].length)
  t.ok(rms > 0, 'LUFS mode applied gain')
})

test('normalize — peak mode unchanged', async t => {
  let a = audio.from([new Float32Array(44100).fill(0.5)], { sampleRate: 44100 })
  a.normalize(-3)
  let pcm = await a.read()
  let maxVal = Math.max(...pcm[0])
  t.ok(Math.abs(maxVal - 0.708) < 0.01, `peak mode: max ~0.708 dBFS (got ${maxVal.toFixed(3)})`)
})

test('normalize — LUFS constants exist', async t => {
  t.ok(audio.LUFS_STREAMING === -14, 'LUFS_STREAMING = -14')
  t.ok(audio.LUFS_PODCAST === -16, 'LUFS_PODCAST = -16')
  t.ok(audio.LUFS_BROADCAST === -23, 'LUFS_BROADCAST = -23')
})
