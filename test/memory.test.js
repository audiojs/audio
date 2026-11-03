// Real browser resource lifetimes.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { extname, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { library } from '../.site-build.js'

let server, browser, origin
const root = fileURLToPath(new URL('..', import.meta.url)).replace(/\/$/, '')
before(async () => {
  // the library as assets/audio.js has it, made from the source as it is, the committed file left alone
  const bundle = await library()
  server = createServer(async (req, res) => {
    const path = resolve(root, '.' + req.url.split('?')[0])
    if (!path.startsWith(root + sep)) return res.writeHead(403).end()
    if (req.url === '/api.html') return res.setHeader('content-type', 'text/html').end('<!doctype html><title>Memory tests</title>')
    try {
      const body = path === root + '/audio.js' || path === root + '/assets/audio.js' ? bundle : await readFile(path)
      res.setHeader('content-type', ({ '.js': 'text/javascript', '.html': 'text/html', '.css': 'text/css', '.svg': 'image/svg+xml' })[extname(path)] || 'application/octet-stream').end(body)
    } catch { res.writeHead(404).end() }
  })
  await new Promise(r => server.listen(0, '127.0.0.1', r))
  origin = `http://127.0.0.1:${server.address().port}`
  browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] })
})
after(async () => { await browser?.close(); if (server) await new Promise(r => server.close(r)) })

async function open(t, path = '/api.html') {
  const page = await browser.newPage()
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  t.after(async () => { await page.close(); assert.deepEqual(errors, []) })
  await page.route('**/*', route => route.request().url().startsWith(origin + '/') ? route.continue() : route.abort())
  await page.addInitScript(() => {
    // Counters do not retain contexts or buffers themselves.
    window.resources = { opened: 0, closed: 0, live: 0, peak: 0, sources: 0, activeSources: 0, sourcePeak: 0, decks: 0, decksLive: 0 }
    // playback decks (deck.js): an AudioWorkletNode each, disconnected when its playback ends
    const NativeNode = AudioWorkletNode
    window.AudioWorkletNode = class extends NativeNode {
      constructor(ctx, name, opts) {
        super(ctx, name, opts)
        if (name !== 'audio-deck') return
        resources.decks++
        resources.decksLive++
        let gone = false, disconnect = this.disconnect.bind(this)
        this.disconnect = (...args) => { if (!gone && !args.length) { gone = true; resources.decksLive-- } return disconnect(...args) }
      }
    }
    const Native = AudioContext
    window.AudioContext = class extends Native {
      constructor(opts) {
        super(opts)
        resources.opened++
        resources.live++
        resources.peak = Math.max(resources.peak, resources.live)
      }
      async close() {
        if (this.state === 'closed') return
        await super.close()
        resources.closed++
        resources.live--
      }
      createBufferSource() {
        const node = super.createBufferSource(), start = node.start.bind(node)
        node.start = (...args) => {
          start(...args)
          resources.sources++
          resources.activeSources++
          resources.sourcePeak = Math.max(resources.sourcePeak, resources.activeSources)
        }
        node.addEventListener('ended', () => resources.activeSources--, { once: true })
        return node
      }
    }
  })
  await page.goto(origin + path)
  return page
}

test('memory: repeated API playback reuses the page\'s one context and releases every deck', { timeout: 30000 }, async t => {
  const page = await open(t)
  const resources = await page.evaluate(async () => {
    const { default: audio } = await import('/assets/audio.js')
    const a = audio.from([new Float32Array(1024)], { sampleRate: 48000 })
    for (let i = 0; i < 12; i++) {
      const ended = new Promise(r => a.on('ended', r))
      a.play()
      await ended
      a.off('ended')
    }
    a.dispose()
    await new Promise(r => setTimeout(r, 100))
    return window.resources
  })
  t.diagnostic(JSON.stringify(resources))
  assert.equal(resources.opened, 1, 'one context for the page, made once')
  assert.equal(resources.decks, 12, 'a deck per playback')
  assert.equal(resources.decksLive, 0, 'every deck released')
})

test('memory: worker disposal releases its deck', { timeout: 30000 }, async t => {
  const page = await open(t)
  const resources = await page.evaluate(async () => {
    const { default: audio, close } = await import('/worker.js')
    for (let i = 0; i < 6; i++) {
      const a = await audio([new Float32Array(4800)], { sampleRate: 48000 })
      await a.play()
      await a.dispose()
    }
    await close()
    await new Promise(r => setTimeout(r, 100))
    return window.resources
  })
  t.diagnostic(JSON.stringify(resources))
  assert.equal(resources.opened, 1, 'the page context')
  assert.equal(resources.decksLive, 0, 'every deck released')
})

test('memory: worker disposal drops mirrored edit buffers and rejects reuse', { timeout: 15000 }, async t => {
  const page = await open(t)
  const result = await page.evaluate(async () => {
    const { default: audio, close } = await import('/worker.js')
    const a = await audio([new Float32Array(1024)], { sampleRate: 48000 })
    a.mix([new Float32Array(1024).fill(.25)])
    await a.flush()
    const before = a.edits.length
    const pending = a.run(['gain', { value: -3 }])
    await Promise.resolve() // post the call so its snapshot can arrive after disposal
    const disposing = a.dispose()
    await pending
    await disposing
    const after = a.edits.length
    const error = await a.play().then(() => '', e => e.message)
    await a.dispose()
    await close()
    return { before, after, error, opened: resources.opened }
  })
  assert.equal(result.before, 1)
  assert.equal(result.after, 0)
  assert.match(result.error, /disposed/)
  assert.equal(result.opened, 0, 'disposed facades cannot allocate a new device')
})

test('memory: closing during worker open rejects waiters and a new worker remains usable', { timeout: 15000 }, async t => {
  const page = await open(t)
  const result = await page.evaluate(async () => {
    const { default: audio, close } = await import('/worker.js')
    const a = audio([new Float32Array([.25])], { sampleRate: 48000 })
    const ready = a.ready.then(() => '', e => e.message)
    await close()
    const error = await ready
    await a.dispose()
    const b = await audio([new Float32Array([-.5]), new Float32Array([.125])], { sampleRate: 48000 })
    const pcm = (await b.read()).map(c => [...c])
    await b.dispose()
    const waiting = audio(null, { sampleRate: 48000 })
    await waiting._ready
    const cancelled = waiting.ready.then(() => '', e => e.message)
    await waiting.dispose()
    await close()
    return { error, cancelled: await cancelled, pcm }
  })
  assert.match(result.error, /disposed/)
  assert.match(result.cancelled, /disposed/)
  assert.deepEqual(result.pcm, [[-.5], [.125]])
})

test('memory: rejected worker transfer settles and the next open succeeds', { timeout: 15000 }, async t => {
  const page = await open(t)
  const result = await page.evaluate(async () => {
    const { default: audio, close } = await import('/worker.js')
    const invalid = audio(() => 0) // functions cannot be structured-cloned
    const error = await invalid.ready.then(() => '', e => e.name)
    const valid = await audio([new Float32Array([.25])], { sampleRate: 48000 })
    const pcm = (await valid.read()).map(c => [...c])
    await valid.dispose()
    await close()
    return { error, pcm }
  })
  assert.equal(result.error, 'DataCloneError')
  assert.deepEqual(result.pcm, [[.25]])
})

test('memory: worker one-frame A → A → stereo B plays every frame, once', { timeout: 15000 }, async t => {
  const page = await open(t)
  const result = await page.evaluate(async () => {
    const { default: audio, close } = await import('/worker.js')
    // what reaches the destination: every deck feeds a tap too (a silent source keeps it running every quantum)
    const ctx = audio.context
    await ctx.resume()
    await ctx.audioWorklet.addModule(URL.createObjectURL(new Blob([`registerProcessor('tap', class extends AudioWorkletProcessor {
      process(i) { this.port.postMessage(i[0].map(c => c.slice())); return true } })`], { type: 'text/javascript' })))
    const tap = new AudioWorkletNode(ctx, 'tap', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] })
    const connect = AudioNode.prototype.connect, keep = new ConstantSourceNode(ctx, { offset: 0 })
    connect.call(tap, ctx.destination); connect.call(keep, tap); keep.start()
    AudioNode.prototype.connect = function (to, ...rest) { if (to === ctx.destination && this !== tap) connect.call(this, tap); return connect.call(this, to, ...rest) }
    let got = []
    tap.port.onmessage = e => got.push(e.data)
    const aPCM = [new Float32Array([.25])]
    const bPCM = [Float32Array.from({ length: 1025 }, (_, i) => i / 2048), new Float32Array(1025).fill(-.125)]
    // at the device's own rate, so each frame plays as one frame (a device at 44.1 kHz would resample 48 kHz's 1025 to 942)
    const sr = ctx.sampleRate, fade = Math.round(.005 * sr)
    const a = await audio(aPCM, { sampleRate: sr }), b = await audio(bPCM, { sampleRate: sr })
    const results = []
    for (const [clip, pcm] of [[a, aPCM], [a, aPCM], [b, bPCM]]) {
      got = []
      const ended = new Promise(r => clip.on('ended', r))
      await clip.play({ at: 0 })
      await ended
      clip.off('ended')
      await new Promise(r => setTimeout(r, 50))
      const L = got.flatMap(q => [...q[0]]), R = got.flatMap(q => [...(q[1] || q[0])])
      const on = L.map((v, i) => v !== 0 || R[i] !== 0), first = on.indexOf(true), n = on.lastIndexOf(true) + 1 - first
      // past the 5 ms fade in and before the fade out, the samples themselves
      const steady = pcm[0].length > 2 * fade ? pcm.map((c, k) => [...c.subarray(fade, c.length - fade)].every((v, i) => v === [L, R][k][first + fade + i])) : [true]
      results.push({ frames: pcm[0].length, n, steady })
    }
    await a.dispose(); await b.dispose(); await close()
    return results
  })
  for (const { frames, n, steady } of result) {
    assert.equal(n, frames, 'every frame, once: none lost, none repeated')
    assert(steady.every(Boolean), 'the samples themselves, channel by channel')
  }
})

test('memory: rapid API restart, paused stop and stream failure release the device', { timeout: 30000 }, async t => {
  const page = await open(t)
  const result = await page.evaluate(async () => {
    const { default: audio } = await import('/assets/audio.js')
    const a = audio.from([new Float32Array(48000)], { sampleRate: 48000 })
    const starts = []
    for (let i = 0; i < 20; i++) { a.play(); starts.push(a.played) }
    await a.played
    const running = a.playing
    a.pause()
    a.stop()
    await Promise.all(starts)
    a.play({ paused: true })
    a.dispose()
    await a.played
    const b = audio.from([new Float32Array(1024)], { sampleRate: 48000 })
    b.stream = async function* () { throw Error('test stream failure') }
    b.play()
    const error = await b.played.then(() => '', e => e.message)
    b.dispose()
    await new Promise(r => setTimeout(r, 300))
    return { running, error, ...resources }
  })
  assert.equal(result.running, true, 'an obsolete playback cannot stop its replacement')
  assert.equal(result.error, 'test stream failure')
  assert.equal(result.opened, 1, 'the page context')
  assert.equal(result.decksLive, 0, 'every deck released')
})

test('memory: worker renders at most its lookahead ahead and ended waits for playback', { timeout: 15000 }, async t => {
  const page = await open(t)
  const result = await page.evaluate(async () => {
    // the deck reports how much audio waits ahead of its head (buf, seconds)
    let peak = 0
    const Native = AudioWorkletNode
    window.AudioWorkletNode = class extends Native {
      constructor(...args) {
        super(...args)
        this.port.addEventListener('message', e => { if (e.data.buf != null) peak = Math.max(peak, e.data.buf) })
      }
    }
    const { default: audio, close } = await import('/worker.js')
    const long = await audio([new Float32Array(48000 * 5)], { sampleRate: 48000 })
    await long.play()
    await new Promise(r => setTimeout(r, 1000))
    await long.stop()
    const a = await audio([new Float32Array(48000)], { sampleRate: 48000 })
    const ended = new Promise(r => a.on('ended', r)), start = performance.now()
    await a.play()
    await ended
    const elapsed = performance.now() - start, position = a.currentTime
    await long.dispose()
    await a.dispose()
    await close()
    await new Promise(r => setTimeout(r, 300))
    return { ahead: peak, elapsed, position, ...resources }
  })
  t.diagnostic(JSON.stringify(result))
  assert(result.ahead > 1 && result.ahead <= 2.05, `rendered ahead, within its 2 s (${result.ahead.toFixed(2)} s)`)
  assert(result.elapsed >= 800, 'ended waits for actual playback')
  assert(result.position >= .99, 'the position runs to the end')
  assert.equal(result.decksLive, 0, 'every deck released')
})

test('memory: worker disposed during worklet startup releases the late deck', { timeout: 15000 }, async t => {
  const page = await open(t)
  const result = await page.evaluate(async () => {
    const add = Worklet.prototype.addModule
    let release
    Worklet.prototype.addModule = function(...args) {
      return new Promise(r => { release = () => r(add.apply(this, args)) })
    }
    const { default: audio, close } = await import('/worker.js')
    const a = await audio([new Float32Array(4800)], { sampleRate: 48000 })
    const playing = a.play()
    await a.dispose()
    release()
    await playing
    await close()
    await new Promise(r => setTimeout(r, 300))
    return resources
  })
  assert.equal(result.decksLive, 0, 'a deck made late is released too')
})

test('memory: stopping during microphone permission releases the late stream', { timeout: 15000 }, async t => {
  const page = await open(t)
  await page.evaluate(async () => {
    const get = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices)
    navigator.mediaDevices.getUserMedia = async (...args) => {
      const stream = await get(...args)
      window.tracks = stream.getTracks()
      await new Promise(r => { window.releaseMic = r })
      return stream
    }
    const { default: audio } = await import('/assets/audio.js')
    window.recording = audio()
    recording.record()
  })
  await page.waitForFunction(() => window.releaseMic)
  await page.evaluate(() => { recording.dispose(); releaseMic() })
  await page.waitForFunction(() => tracks.every(track => track.readyState === 'ended') && resources.live === 0)
})

test('memory: microphone denial permits retry and repeated capture releases every track', { timeout: 15000 }, async t => {
  const page = await open(t)
  const failed = await page.evaluate(async () => {
    const get = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices)
    let deny = true
    window.tracks = []
    navigator.mediaDevices.getUserMedia = async (...args) => {
      if (deny) { deny = false; throw new DOMException('test denial', 'NotAllowedError') }
      const stream = await get(...args)
      tracks.push(...stream.getTracks())
      return stream
    }
    const { default: audio } = await import('/assets/audio.js')
    window.recording = audio(null, { sampleRate: 48000 })
    const failed = new Promise(r => recording.on('error', e => r(e.name)))
    recording.record()
    return { error: await failed, recording: recording.recording }
  })
  assert.deepEqual(failed, { error: 'NotAllowedError', recording: false })
  for (let i = 0; i < 2; i++) {
    const before = await page.evaluate(() => { const n = recording.length; recording.record(); return n })
    await page.waitForFunction(n => recording.length > n, before)
    await page.evaluate(() => recording.stop())
    await page.waitForFunction(() => tracks.every(track => track.readyState === 'ended') && resources.live === 0)
  }
  await page.evaluate(() => recording.dispose())
})

test('memory: closing the shared worker releases its playing deck', { timeout: 15000 }, async t => {
  const page = await open(t)
  const result = await page.evaluate(async () => {
    const { default: audio, close } = await import('/worker.js')
    const a = await audio([new Float32Array(48000)], { sampleRate: 48000 })
    await a.play()
    await close()
    await new Promise(r => setTimeout(r, 300))
    return resources
  })
  assert.equal(result.decksLive, 0, 'closing the worker releases the deck it played')
})

test('memory: worker looping reuses its device and empty loops terminate', { timeout: 15000 }, async t => {
  const page = await open(t)
  const result = await page.evaluate(async () => {
    const { default: worker, close } = await import('/worker.js')
    const a = await worker([new Float32Array(4800)], { sampleRate: 48000 })
    let laps = 0, last = 0
    await a.play({ loop: true })
    // a pass is the position coming round again
    for (let i = 0; i < 60; i++) { await new Promise(r => setTimeout(r, 10)); let t = a.currentTime; if (t < last - 0.05) laps++; last = t }
    const opened = resources.opened
    await a.dispose()
    const { default: audio } = await import('/assets/audio.js')
    for (const factory of [audio, worker]) {
      const empty = await factory([new Float32Array(0)], { sampleRate: 48000 })
      const ended = new Promise(r => empty.on('ended', r))
      empty.play({ loop: true })
      await ended
      await empty.dispose()
    }
    await close()
    await new Promise(r => setTimeout(r, 300))
    return { laps, openedForLoops: opened, ...resources }
  })
  assert(result.laps >= 3, `looped (${result.laps} passes)`)
  assert.equal(result.openedForLoops, 1)
  assert.equal(result.decksLive, 0, 'every deck released')
})

// A store in the browser's own files (store.js): two pages of one origin, as two tabs, each a store over one folder.
// Sounds round trip whole, their stats and the typed arrays of their meta with them; read again by another store (a
// reload); past `max`, the oldest written goes, never one a sound still reads from. Two writers of one key at once:
// one writes, the other lets it be, and what is read is one of them whole, never a mix; a sound open on a key keeps
// reading it as it was while another page writes that key
test('memory: a store in the browser\'s files keeps sounds whole; two writers of one key leave one of them whole', { timeout: 60000 }, async t => {
  const context = await browser.newContext(), errors = []
  t.after(async () => { await context.close(); assert.deepEqual(errors, []) })
  const tab = async () => {
    const page = await context.newPage()
    page.on('pageerror', error => errors.push(error.message))
    await page.route('**/*', route => route.request().url().startsWith(origin + '/') ? route.continue() : route.abort())
    await page.goto(origin + '/api.html')
    await page.evaluate(async () => {
      const { default: audio } = await import('/assets/audio.js')
      // a sound of `n` samples a channel, each sample its channel and index (read back, it says where it came from)
      window.audio = audio
      window.made = (n, k, mark) => audio.from(Array.from({ length: k }, (_, c) => Float32Array.from({ length: n }, (_, i) => mark + c + i / n)), { sampleRate: 48000 })
      window.whole = (chs, n, k, mark) => chs?.length === k && chs.every((x, c) => x.length === n && x.every((v, i) => v === Math.fround(mark + c + i / n)))
    })
    return page
  }
  const [a, b] = [await tab(), await tab()]
  const name = `store-test-${Date.now()}`

  const trip = await a.evaluate(async name => {
    const kept = audio.store(name, { max: 64 * 2 ** 20 }), n = 3 * audio.PAGE_SIZE + 5
    await kept.set('chs', await made(1000, 2, 1).read())
    await kept.set('sound', made(n, 2, 2).gain(0), { label: 'two', picture: [Float32Array.of(1, 2, 3), Uint8Array.of(4, 5)], peak: -Infinity })
    const chs = await kept.get('chs'), { sound, meta } = await kept.open('sound')
    const again = audio.store(name)
    return {
      chs: whole(chs, 1000, 2, 1), shape: [sound.length, sound.channels, sound.sampleRate], held: sound.pages.filter(Boolean).length,
      read: whole(await sound.read(), n, 2, 2), stats: !!sound.stats?.max && sound.stats.max[0].length === Math.ceil(n / audio.BLOCK_SIZE),
      meta: [meta.label, [...meta.picture[0]], meta.picture[1] instanceof Uint8Array && [...meta.picture[1]], meta.peak],
      again: whole(await again.get('sound'), n, 2, 2), keys: (await again.keys()).sort()
    }
  }, name)
  assert.deepEqual(trip, { chs: true, shape: [3 * 1048576 + 5, 2, 48000], held: 0, read: true, stats: true, meta: ['two', [1, 2, 3], [4, 5], null], again: true, keys: ['chs', 'sound'] })

  // past max: the oldest written goes, but the one a sound still reads from
  const evicted = await a.evaluate(async name => {
    // room for three and a half of them, by the size one takes
    await audio.store(name + '-probe').set('probe', made(48000, 1, 3))
    const root = await navigator.storage.getDirectory(), probe = await (await (await root.getDirectoryHandle(name + '-probe')).getFileHandle('probe')).getFile()
    const kept = audio.store(name + '-max', { max: 3.5 * probe.size }), wait = () => new Promise(r => setTimeout(r, 20))
    for (const key of ['one', 'two']) { await kept.set(key, made(48000, 1, 3)); await wait() }
    const { sound } = await kept.open('one')
    for (const key of ['three', 'four']) { await kept.set(key, made(48000, 1, 3)); await wait() }
    return { keys: (await kept.keys()).sort(), reads: whole(await sound.read(), 48000, 1, 3) }
  }, name)
  assert.deepEqual(evicted, { keys: ['four', 'one', 'three'], reads: true }, 'two, the oldest not in use, gone')

  // two writers of one key at once, one in each page; a page reading it meanwhile sees nothing or one of them whole
  const n = 2 * 1048576 + 3
  const write = (page, mark) => page.evaluate(async ({ name, n, mark }) => { await audio.store(name).set('both', made(n, 2, mark)); return true }, { name, n, mark })
  const watch = a.evaluate(async ({ name, n }) => {
    const seen = new Set(), kept = () => audio.store(name)
    for (let i = 0; i < 40; i++) { const chs = await kept().get('both'); seen.add(!chs ? 'none' : whole(chs, n, 2, 10) ? 'a' : whole(chs, n, 2, 20) ? 'b' : 'torn'); await new Promise(r => setTimeout(r, 25)) }
    return [...seen]
  }, { name, n })
  await Promise.all([write(a, 10), write(b, 20)])
  const seen = await watch
  t.diagnostic(`read while written: ${seen}`)
  assert.ok(!seen.includes('torn'), `never a mix: ${seen}`)
  const read = page => page.evaluate(async ({ name, n }) => { const chs = await audio.store(name).get('both'); return whole(chs, n, 2, 10) ? 'a' : whole(chs, n, 2, 20) ? 'b' : 'torn' }, { name, n })
  const [ra, rb] = [await read(a), await read(b)]
  assert.ok(ra === rb && ra !== 'torn', `both pages read one of them whole: ${ra}, ${rb}`)

  // a sound open on the key in one page: another page's write lets it be, and the sound reads as it was
  const open = await a.evaluate(async ({ name, n }) => { window.openSound = (await audio.store(name).open('both')).sound; return true }, { name, n })
  assert.ok(open)
  await write(b, 30)
  const after = await a.evaluate(async ({ name, n }) => {
    const [x] = await openSound.read(), chs = await audio.store(name).get('both')
    return { sound: whole([x], n, 1, 10) || whole([x], n, 1, 20), stored: whole(chs, n, 2, 10) || whole(chs, n, 2, 20) }
  }, { name, n })
  assert.deepEqual(after, { sound: true, stored: true }, 'the key in use let be: the sound and the store read what was there')

  await a.evaluate(async name => { const root = await navigator.storage.getDirectory(); for (const d of [name, name + '-max', name + '-probe']) await root.removeEntry(d, { recursive: true }).catch(() => {}) }, name)
})
