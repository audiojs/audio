import { test } from 'node:test'
import assert from 'node:assert/strict'
import audio from '../audio.js'
import decode from '@audio/decode'
import wav from '@audio/encode-wav'

test('memory: retained disposed instances release edits, render caches and source buffers', async () => {
  audio.op('memoryWhole', { whole(input, output) { output[0].set(input[0]) } })
  const source = audio.from([new Float32Array(48000).fill(.2)], { sampleRate: 48000 })
  const a = source.clone().memoryWhole().mix(source)
  await a.read()
  await a.stat('rms')
  assert(a._.wrc?.m.size > 0, 'whole-render cache was exercised')
  a.dispose()
  a.dispose()
  assert.equal(a.pages.length, 0)
  assert.equal(a.edits.length, 0, 'edit references no longer retain other clips')
  for (const key of ['pcm', 'plan', 'wrc', 'rsc', 'srcStats', 'header', 'acc']) assert.equal(a._[key], null, key)
  assert.equal(a.stats, null)
  assert.equal(a.block, null)
  assert.equal((await source.read())[0][0], Math.fround(.2), 'shared source remains usable')
  source.dispose()
})

test('memory: metadata retains at most 256 KiB of an encoded buffer', async () => {
  const source = audio.from([new Float32Array(300000)], { sampleRate: 48000 })
  const bytes = await source.encode('wav')
  assert(bytes.byteLength > 256 * 1024)
  const a = await audio(bytes)
  assert(a._.header.byteLength <= 256 * 1024)
  assert(a._.header.buffer.byteLength <= 256 * 1024, 'header does not pin the full encoded file')
  a.dispose()
  assert.equal(a._.header, null)
  source.dispose()
})

test('memory: interrupted decode frees the codec and settles a waiting stream', async () => {
  const source = audio.from([new Float32Array(300000)], { sampleRate: 48000 })
  const bytes = await source.encode('wav')
  const original = decode.wav
  let freed = 0
  decode.wav = async () => {
    const dec = await original(), free = dec.free
    dec.free = () => { freed++; free() }
    return dec
  }
  try {
    const a = audio(bytes)
    const stream = a.stream(), next = stream.next()
    a.dispose()
    assert.equal((await next).done, true)
    await a.ready
    assert.equal(freed, 1)
    assert.equal(a.pages.length, 0)
  } finally { decode.wav = original; source.dispose() }
})

test('memory: decode errors release the codec', async () => {
  const source = audio.from([new Float32Array(1024)])
  const bytes = await source.encode('wav'), original = decode.wav
  let freed = 0
  decode.wav = async () => {
    const dec = () => { throw Error('test decode failure') }
    dec.free = () => { freed++ }
    return dec
  }
  try {
    const a = audio(bytes)
    await assert.rejects(a.ready, /test decode failure/)
    assert.equal(freed, 1)
    a.dispose()
  } finally { decode.wav = original; source.dispose() }
})

test('memory: dispose during cache restore cannot repopulate released pages', async () => {
  for (const seek of [false, true]) {
    let release, reading
    const started = new Promise(r => { reading = r })
    const a = audio.from([new Float32Array(1024)], { cache: {
      has: async () => true,
      read: () => { reading(); return new Promise(r => { release = r }) }
    } })
    a.pages[0] = null
    const done = seek ? (a.seek(0), null) : audio.ensurePages(a)
    await started
    a.dispose()
    release([new Float32Array(1024)])
    await done
    await new Promise(r => setTimeout(r, 0))
    assert.equal(a.pages.length, 0)
    assert.equal(a.cache, null)
  }
})

test('memory: dispose wakes a stream waiting for more pushed data', async () => {
  const a = audio(null, { sampleRate: 48000 })
  const stream = a.stream(), next = stream.next()
  await new Promise(r => setTimeout(r, 0))
  a.dispose()
  assert.equal((await next).done, true)
})

test('memory: disposing cover art revokes its generated blob URL', async () => {
  const source = audio.from([new Float32Array(4800)], { sampleRate: 48000 })
  source.meta.pictures = [{ mime: 'image/png', type: 3, data: new Uint8Array([137, 80, 78, 71]) }]
  const a = await audio(await source.encode('flac'))
  const url = a.meta.pictures[0].url
  assert((await fetch(url)).ok)
  a.meta = {} // replacing metadata must not orphan an already generated URL
  a.dispose()
  await assert.rejects(fetch(url))
  source.dispose()
})

test('memory: one-frame A → A → stereo B decodes exactly across the final byte boundary', async () => {
  const a = [new Float32Array([.25])]
  const b = [new Float32Array([.25, -.5, .125]), new Float32Array([-.25, .5, -.125])]
  for (const pcm of [a, a, b]) {
    const encoder = await wav({ sampleRate: 48000, bitDepth: 32 })
    encoder.encode(pcm)
    const bytes = encoder.flush()
    for (const split of [bytes.length - 1, bytes.length]) {
      class SplitBlob extends Blob {
        stream() {
          return new ReadableStream({ start(controller) {
            controller.enqueue(bytes.subarray(0, split))
            if (split < bytes.length) controller.enqueue(bytes.subarray(split))
            controller.close()
          } })
        }
      }
      const decoded = await audio(new SplitBlob([bytes]))
      assert.equal(decoded.sampleRate, 48000)
      assert.deepEqual(await decoded.read(), pcm)
      const chunks = []
      for await (const chunk of decoded.stream()) chunks.push(chunk)
      assert.equal(chunks.length, 1)
      assert.deepEqual(chunks[0], pcm)
      decoded.dispose()
      assert.equal(decoded.pages.length, 0)
    }
  }
})

test('memory: zero-frame encoded input rejects and frees its decoder', async () => {
  const encoder = await wav({ sampleRate: 48000, bitDepth: 32 })
  encoder.encode([new Float32Array(0)])
  const bytes = encoder.flush(), original = decode.wav
  let freed = 0
  decode.wav = async () => {
    const dec = await original(), free = dec.free
    dec.free = () => { freed++; free() }
    return dec
  }
  try {
    const a = audio(bytes), waiting = a.stream().next()
    await assert.rejects(a.ready, /decoded no audio data/)
    await assert.rejects(waiting, /decoded no audio data/)
    assert.equal(freed, 1)
    a.dispose()
  } finally { decode.wav = original }
})

test('memory: disposal during eviction cannot restore a page slot', async () => {
  let release
  const a = audio.from([new Float32Array(1)], { budget: 0, cache: {
    write: () => new Promise(r => { release = r })
  } })
  const pending = audio.evict(a)
  assert(release)
  a.dispose()
  release()
  await pending
  assert.deepEqual(a.pages, [])
})

test('memory: disposing mid-decode cancels the byte stream and releases its reader', { timeout: 3000 }, async () => {
  const encoder = await wav({ sampleRate: 48000, bitDepth: 32 })
  encoder.encode([new Float32Array(300000)])
  const bytes = encoder.flush()
  let stream, cancelled
  const closed = new Promise(r => { cancelled = r })
  class Source extends Blob {
    stream() {
      let offset = 0
      return stream = new ReadableStream({
        pull(controller) {
          if (offset === bytes.length) return controller.close()
          const end = Math.min(offset + 65536, bytes.length)
          controller.enqueue(bytes.subarray(offset, end))
          offset = end
        },
        cancel() { assert(offset < bytes.length); cancelled() }
      })
    }
  }
  const a = audio(new Source([bytes]))
  a.on('metadata', () => a.dispose())
  await a.ready
  await closed
  await new Promise(r => setTimeout(r, 0))
  assert.equal(stream.locked, false)
  assert.deepEqual(a.pages, [])
})

test('memory: disposal aborts an unfinished URL fetch and settles readiness', { timeout: 3000 }, async () => {
  const original = globalThis.fetch
  let signal, began
  const started = new Promise(r => { began = r })
  globalThis.fetch = (_url, opts) => new Promise((_resolve, reject) => {
    signal = opts.signal
    signal.addEventListener('abort', () => reject(signal.reason), { once: true })
    began()
  })
  try {
    const a = audio(new URL('https://audio.invalid/pending.wav'))
    await started
    a.dispose()
    await a.ready
    assert.equal(signal.aborted, true)
    assert.equal((await a.stream().next()).done, true)
    assert.deepEqual(a.pages, [])
  } finally { globalThis.fetch = original }
})

test('memory: disposal cancels a stalled byte read before metadata', { timeout: 3000 }, async () => {
  const encoder = await wav({ sampleRate: 48000, bitDepth: 32 })
  encoder.encode([new Float32Array([.25])])
  const bytes = encoder.flush()
  let stream, stalled, cancelled = false
  const started = new Promise(r => { stalled = r })
  class Source extends Blob {
    stream() {
      return stream = new ReadableStream({ pull() { stalled() }, cancel() { cancelled = true } })
    }
  }
  const a = audio(new Source([bytes])), waiting = a.stream().next()
  await started
  a.dispose()
  await a.ready
  assert.equal((await waiting).done, true)
  assert.equal(cancelled, true)
  assert.equal(stream.locked, false)
})
