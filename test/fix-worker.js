/**
 * audio/worker P1 — facade over a worker-side engine.
 * Oracle: facade results ≡ local instance results, bit-exact (same engine, same edits).
 * Runs the real worker path via node worker_threads.
 */
import test from 'tst'
import { tone as genTone } from './gen.js'
import { File } from 'node:buffer'  // global only since Node 20; node:buffer.File (≡ the global, File extends Blob) works on 18.13+ too
import audio from '../audio.js'
import audioWorker, { close } from '../worker.js'

const tone = (freq, dur, sr = 44100, amp = 0.5) => genTone(freq, dur, amp, sr)
const eq = (a, b) => a.length === b.length && a.every((v, i) => v === b[i])

test('worker: open file, props mirror local instance', async t => {
  let w = await audioWorker('test/fixture.wav')
  let l = await audio('test/fixture.wav')
  t.is(w.sampleRate, l.sampleRate)
  t.is(w.channels, l.channels)
  t.is(w.length, l.length)
  t.ok(w.decoded, 'thenable resolves after decode')
})

test('worker: read ≡ local read, bit-exact, transferred', async t => {
  let w = await audioWorker('test/fixture.wav')
  let l = await audio('test/fixture.wav')
  let [wr, lr] = [await w.read(), await l.read()]
  t.is(wr.length, lr.length, 'channel count')
  t.ok(eq(wr[0], lr[0]), 'PCM bit-exact across the boundary')
})

test('worker: chained ops replay through the real engine', async t => {
  let w = await audioWorker('test/fixture.wav')
  let l = await audio('test/fixture.wav')
  w.gain(-3).crop({ at: 0.5, duration: 1 }).fade(0.1)
  l.gain(-3).crop({ at: 0.5, duration: 1 }).fade(0.1)
  let [wr, lr] = [await w.read(), await l.read()]
  t.ok(eq(wr[0], lr[0]), 'edited PCM bit-exact')
  t.is(w.edits.length, 3, 'edits mirrored')
  t.is(w.duration, l.duration, 'props synced after edits')
})

test('worker: stat + undo', async t => {
  let w = await audioWorker('test/fixture.wav')
  let l = await audio('test/fixture.wav')
  t.is(await w.stat('rms'), await l.stat('rms'), 'stat crosses the boundary')
  let [mins, maxs] = await w.stat(['min', 'max'], { bins: 64 })
  t.is(mins.length, 64, 'binned waveform query (wavearea path)')
  t.is(maxs.length, 64)
  w.gain(-6)
  await w.flush()
  t.is(w.edits.length, 1)
  await w.undo()
  t.is(w.edits.length, 0, 'undo synced')
})

test('worker: facades reference each other (mix by ref)', async t => {
  let a = await audioWorker('test/fixture.wav')
  let b = await audioWorker('test/fixture.wav')
  b.gain(-6)
  a.mix(b)
  let wr = await a.read()
  let la = await audio('test/fixture.wav')
  let lb = await audio('test/fixture.wav')
  lb.gain(-6)
  la.mix(lb)
  let lr = await la.read()
  t.ok(eq(wr[0], lr[0]), 'cross-facade ref resolved worker-side, bit-exact')
})

test('worker: clip returns a linked sub-facade', async t => {
  let w = await audioWorker('test/fixture.wav')
  let c = await w.clip({ at: 0.5, duration: 0.5 })
  t.ok(Math.abs(c.duration - 0.5) < 0.01, `sub-facade duration (${c.duration})`)
  let pcm = await c.read()
  let l = await audio('test/fixture.wav')
  let lc = l.clip({ at: 0.5, duration: 0.5 })
  t.ok(eq(pcm[0], (await lc.read())[0]), 'sub-facade read bit-exact')
})

test('worker: clipboard chain, Undo, clone and JSON replay match local samples', async t => {
  const pcm = [Float32Array.of(.125, .25, .375, .5), Float32Array.of(-.125, -.25, -.375, -.5)]
  const w = await audioWorker(pcm, { sampleRate: 4 })
  const local = audio.from(pcm, { sampleRate: 4 })
  const edit = a => a.copy({ at: .25, duration: .5 }).remove({ at: .25, duration: .5 }).paste(0).paste()
  t.is(edit(w), w, 'chainable facade')
  edit(local)
  t.is(await w.read(), await local.read())
  t.is(w.edits.map(e => e[0]), ['copy', 'remove', 'paste', 'paste'])
  const undone = await w.undo(); local.undo()
  t.is(undone, ['paste', {}])
  const clone = await w.clone()
  clone.copy({ duration: .25 }).paste()
  w.paste(); local.paste()
  t.is(await w.read(), await local.read(), 'clone clipboard does not replace original clipboard')
  t.is((await clone.read())[0], Float32Array.of(.25, .375, .125, .5, .25))
  const doc = await w.toJSON(), replay = await audioWorker(pcm, { sampleRate: 4 })
  for (const e of doc.edits) await replay.run(e)
  t.is(await replay.read(), await w.read(), 'serialized edits replay without embedded PCM')
  const blocks = []
  for await (const block of w.stream()) blocks.push(...block[0])
  t.is(blocks, [...(await local.read())[0]], 'worker stream agrees')
  await Promise.all([w.dispose(), clone.dispose(), replay.dispose()])
})

test('worker: Paste without Copy reports an error and recovers with Copy', async t => {
  const w = await audioWorker([Float32Array.of(.25)], { sampleRate: 48000 })
  await t.rejects(() => w.run(['paste']), /clipboard/)
  t.is(w.edits.length, 0)
  w.copy().paste()
  t.is((await w.read())[0], Float32Array.of(.25, .25))
  await w.dispose()
})

test('worker: Cut is one edit and Undo restores the previous clipboard', async t => {
  const w = await audioWorker([Float32Array.of(.125, .25, .375, .5)], { sampleRate: 4 })
  try {
    w.copy(0, .25).cut(.25, .5).paste()
    t.is((await w.read())[0], Float32Array.of(.125, .5, .25, .375))
    t.is(await w.undo(), ['paste', {}])
    t.is(await w.undo(), ['cut', { at: .25, duration: .5 }])
    w.paste()
    t.is((await w.read())[0], Float32Array.of(.125, .25, .375, .5, .125))
  } finally { await w.dispose() }
})

test('worker: stream ≡ read across the boundary', async t => {
  let w = await audioWorker('test/fixture.wav')
  w.gain(-3)
  let read = await w.read()
  let total = 0, chunks = []
  for await (let c of w.stream()) { chunks.push(c[0]); total += c[0].length }
  t.is(total, read[0].length, 'stream length')
  let flat = new Float32Array(total), p = 0
  for (let c of chunks) { flat.set(c, p); p += c.length }
  let maxDiff = 0
  for (let i = 0; i < total; i++) maxDiff = Math.max(maxDiff, Math.abs(flat[i] - read[0][i]))
  t.ok(maxDiff < 1e-3, `stream≡read (maxDiff ${maxDiff})`)
})

test('worker: pushable instance', async t => {
  let w = audioWorker(null, { sampleRate: 44100, channels: 1 })
  await w.push(tone(440, 0.2))
  await w.stop()
  t.is(w.length, Math.round(0.2 * 44100), 'pushed samples accounted')
  let pcm = await w.read()
  t.ok(pcm[0].some(v => v !== 0), 'pushed PCM readable')
})

test('worker: encode + toJSON', async t => {
  let w = await audioWorker('test/fixture.wav')
  let bytes = await w.encode('wav')
  t.ok(bytes.byteLength > 1000, `encoded ${bytes.byteLength} bytes`)
  w.gain(-3)
  let doc = await w.toJSON()
  t.is(doc.edits.length, 1, 'serialized document crosses back')
})

test('worker: errors surface', async t => {
  let w = await audioWorker('test/fixture.wav')
  let err = null
  try { await w.run(['nosuchop', {}]) } catch (e) { err = e }
  t.ok(/nosuchop|Unknown/i.test(err?.message), `run() rejects (${err?.message})`)

  let err2 = null
  try { w.gain(t2 => t2) } catch (e) { err2 = e }
  t.ok(/function/.test(err2?.message), 'function params rejected at the call site')

  // fire-and-forget op error → 'error' event; once known, the next call rejects
  let errEvt = new Promise(r => w.on('error', r))
  w.gain(NaN)
  let e3 = await errEvt
  t.ok(/NaN/.test(e3?.message), 'op error emits error event')
  let err3 = null
  try { await w.read() } catch (e) { err3 = e }
  t.ok(/NaN/.test(err3?.message), 'pending op error rejects next call')
})

test('worker: Blob/File source survives the boundary (file input path)', async t => {
  let { readFile } = await import('fs/promises')
  let buf = await readFile('test/fixture.wav')
  let bytes = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
  let l = await audio(bytes.slice(0))
  let w = await audioWorker(new File([bytes], 'fixture.wav', { type: 'audio/wav' }))
  t.is(w.length, l.length, 'File decodes through the worker')
  t.ok(eq((await w.read())[0], (await l.read())[0]), 'PCM bit-exact')
})

test('worker: data events forward stat deltas without PCM', async t => {
  let w = audioWorker('test/fixture.wav')
  let deltas = []
  w.on('data', d => deltas.push(d))
  await w.ready
  // ready = metadata; deltas keep streaming while decode continues (slow runners
  // decode well past ready) — await full decode, then drain in-flight messages
  await w
  let expected = Math.ceil(w.length / audio.BLOCK_SIZE)
  let counted = () => deltas.reduce((n, d) => n + d.delta.min[0].length, 0)
  for (let i = 0; i < 50 && counted() < expected; i++) await new Promise(r => setTimeout(r, 10))
  t.ok(deltas.length > 0, `data events cross the boundary (${deltas.length})`)
  let blocks = 0
  for (let d of deltas) {
    t.ok(d.delta.min[0] instanceof Float32Array, 'delta stats arrive')
    t.is(d.pages, undefined, 'payload is {delta, offset, sampleRate, channels} — no pages (README contract)')
    blocks += d.delta.min[0].length
  }
  t.is(blocks, Math.ceil(w.length / audio.BLOCK_SIZE), 'deltas cover all blocks')
})

test('worker: custom worker shared across calls — one channel, refs work', async t => {
  let { Worker: NodeWorker } = await import('node:worker_threads')
  let w = new NodeWorker(new URL('../worker.js', import.meta.url))
  let a = await audioWorker('test/fixture.wav', { worker: w })
  let b = await audioWorker('test/fixture.wav', { worker: w })
  t.is(a.length, b.length, 'both facades opened without id cross-talk')
  a.mix(b)  // throws 'must share a worker' if each call made its own channel
  let pcm = await a.read()
  t.ok(pcm[0].length > 0, 'mix by ref across the same custom worker')
  await w.terminate()
})

test('worker: undo of a ref edit returns sanitized edit, not DataCloneError', async t => {
  let { Worker: NodeWorker } = await import('node:worker_threads')
  let w = new NodeWorker(new URL('../worker.js', import.meta.url))
  let a = await audioWorker('test/fixture.wav', { worker: w })
  let b = await audioWorker('test/fixture.wav', { worker: w })
  let base = a.length
  await a.run(['insert', { source: b, at: 0 }])
  t.ok(a.length > base, 'ref insert applied')
  let edit = await a.undo()
  t.is(edit[0], 'insert', 'popped edit returned')
  t.ok(edit[1].source?.__audio, 'live instance replaced with marker')
  t.is(a.length, base, 'undo restored length')
  await w.terminate()
})

test('worker: change events forward', async t => {
  let w = await audioWorker('test/fixture.wav')
  let changes = 0
  w.on('change', () => changes++)
  await w.run(['gain', { value: -3 }])
  t.ok(changes >= 1, `change event forwarded (${changes})`)
})

test('worker: close terminates shared worker', async t => {
  await close()
  t.ok(true, 'closed without hanging')
})

test('worker: breakpoint curves cross the boundary', async t => {
  let cv = { t: [0, 2], v: [0, -24] }
  let w = await audioWorker('test/fixture.wav')
  w.gain(cv)
  let l = await audio('test/fixture.wav')
  l.gain(cv)
  t.ok(eq((await w.read())[0], (await l.read())[0]), 'curve automation bit-exact across boundary')
  t.is((await w.toJSON()).edits.length, 1, 'curve edit serializes')
})

test('worker: playback pumps through the node sink', async t => {
  let w = await audioWorker('test/fixture.wav')
  let c = await w.clip({ at: 0, duration: 0.3 })
  let events = [], times = []
  c.on('play', () => events.push('play'))
  c.on('timeupdate', t2 => times.push(t2))
  c.on('ended', () => events.push('ended'))
  await new Promise((res, rej) => {
    c.on('ended', res)
    c.on('error', rej)
    c.play()
    setTimeout(() => rej(new Error('playback timeout')), 8000)
  })
  t.ok(events.includes('play') && events.includes('ended'), `transport events (${events.join(',')})`)
  t.ok(times.length > 0 && Math.abs(c.currentTime - 0.3) < 0.1, `currentTime tracked (${c.currentTime.toFixed(2)}s of 0.3s)`)
  t.ok(c.ended && !c.playing, 'final state')
})

test('worker: pause/resume/stop', async t => {
  let w = await audioWorker('test/fixture.wav')
  let c = await w.clip({ at: 0, duration: 1 })
  c.play()
  await new Promise(r => setTimeout(r, 150))
  c.pause()
  t.ok(c.playing && c.paused && !c.ended, 'paused mid-play')
  // currentTime is what the speakers play: it runs on while they play out what they had, then holds exactly
  let tPause = c.currentTime
  await new Promise(r => setTimeout(r, 150))
  let held = c.currentTime
  t.ok(held >= tPause && held - tPause < 0.15, `ran on only by the output latency (${((held - tPause) * 1000).toFixed(0)} ms)`)
  await new Promise(r => setTimeout(r, 120))
  t.is(c.currentTime, held, 'time holds while paused')
  c.play()
  await new Promise(r => setTimeout(r, 120))
  t.ok(c.currentTime > held && c.currentTime < held + 0.2, `resumes from where it held (${c.currentTime.toFixed(3)})`)
  await c.stop()
  t.ok(!c.playing, 'stopped')
})

test('worker: live playbackRate — varispeed pump, source-time currentTime', async t => {
  let w = audioWorker(null, { sampleRate: 44100, channels: 1 })
  let sr = 44100
  await w.push([genTone(440, 1, 0.2, sr)])
  await w.stop()
  t.is(w.playbackRate, 1, 'default rate')
  let rc = false
  w.on('ratechange', () => { rc = true })
  w.volume = 0

  // play() resolves on the first block out: clocks start there, opening the device is not the rate
  let ended = new Promise(r => w.on('ended', r))
  await w.play({ rate: 4 })
  let t0 = performance.now()
  await ended
  let wall = (performance.now() - t0) / 1000
  t.ok(wall < 0.6, `rate 4: 1s source in ${wall.toFixed(2)}s wall`)
  t.ok(rc, 'ratechange emitted')
  t.ok(Math.abs(w.currentTime - 1) < 0.05, `currentTime in source seconds (${w.currentTime.toFixed(2)})`)

  w.playbackRate = 1
  ended = new Promise(r => w.on('ended', r))
  await w.play({ at: 0 })
  t0 = performance.now()
  setTimeout(() => { w.playbackRate = 4 }, 200)
  await ended
  wall = (performance.now() - t0) / 1000
  t.ok(wall < 0.75, `live ramp 1→4 mid-play: ${wall.toFixed(2)}s wall (expect ≈0.4)`)
  await w.dispose()
})

test('worker: P4 — audio(src, {worker: true}) dispatches to the worker facade', async t => {
  let { default: audio } = await import('../audio.js')
  let a = audio(null, { worker: true, sampleRate: 44100, channels: 1 })
  t.is(a.__isAudioWorker, true, 'returns worker facade')
  await a.push([genTone(440, 0.1, 0.3, 44100)])
  await a.stop()
  a.gain(-6)
  let pcm = await a.read()
  t.ok(Math.abs(pcm[0][100] / genTone(440, 0.1, 0.3, 44100)[100] - 0.501) < 0.01, 'ops replay through the worker engine')
  await a.dispose()
})

test('worker: a custom worker speaks its own messages beside the engine, and exposes an instance to adopt', async t => {
  let { Worker: NodeWorker } = await import('node:worker_threads')
  let w = new NodeWorker(new URL('./worker-app.js', import.meta.url)), replies = []
  w.on('message', m => replies.push(m))
  let a = await audioWorker('test/fixture.wav', { worker: w })   // engine call ids start at 1, like the app's
  w.postMessage({ type: 'make', id: 1, duration: 0.5 })
  for (let i = 0; i < 200 && !replies.length; i++) await new Promise(r => setTimeout(r, 5))
  t.is(replies.length, 1, "the app hears its own replies only, the engine's travel on their own port")
  let { id, made, again } = replies[0]
  t.is(id, 1, 'its ids are its own')
  t.is(made, again, 'the same instance exposed twice: one id')
  let b = audioWorker.adopt(made, { worker: w })
  await b.ready
  t.ok(Math.abs(b.duration - 0.5) < 1e-9, 'the adopted facade mirrors the instance')
  let [pcm] = await b.read(), peak = pcm.reduce((m, v) => Math.max(m, Math.abs(v)), 0)
  t.ok(Math.abs(peak - 0.5 * 10 ** (-6 / 20)) < 1e-3, `its edits ride along (peak ${peak.toFixed(4)})`)
  b.gain(-6)
  let [pcm2] = await b.read()
  t.ok(Math.abs(pcm2[1000] / pcm[1000] - 10 ** (-6 / 20)) < 1e-4, 'the page edits it like any facade')
  t.ok((await a.read())[0].length > 0, 'the engine speaks on beside it')
  t.is(replies.length, 1, 'and never on the Worker')
  t.throws(() => audioWorker.adopt(made), /worker/, 'adopt needs the worker')
  await w.terminate()
})

test('worker: meters are measured in the worker and released when heard', async t => {
  let sr = 44100, x = new Float32Array(sr)
  for (let i = sr / 2; i < sr; i++) x[i] = 0.5 * Math.sin(2 * Math.PI * 440 * i / sr)
  let w = audioWorker(null, { sampleRate: sr, channels: 1 })
  await w.push([x])
  await w.stop()
  let loud = null, values = [], peak = 0
  let probe = w.meter('rms', v => { values.push(v); if (v > 0.1 && loud == null) loud = w.currentTime })
  w.meter('peak', v => { peak = Math.max(peak, v) })
  w.volume = 0
  let ended = new Promise(r => w.on('ended', r))
  await w.play()
  await ended
  t.ok(loud != null && Math.abs(loud - 0.5) < 0.06, `the tone's rms arrives when it is heard (at ${loud?.toFixed(3)} s of 0.5)`)
  let tone = values.filter(v => v > 0.1), mean = tone.reduce((s, v) => s + v, 0) / tone.length
  t.ok(Math.abs(mean - 0.5 / Math.SQRT2) < 0.01, `rms of a 0.5 sine ${mean.toFixed(4)} (0.3536)`)
  t.ok(Math.abs(peak - 0.5) < 0.01, `peak ${peak.toFixed(4)}`)
  t.ok(probe.value > 0.3, 'pull form: probe.value')
  probe.stop()
  await w.dispose()
})

test('worker: play({ from }) hands playback to another facade, or to a local instance, at the same place', async t => {
  let sr = 44100, tone = genTone(440, 3, 0.5, sr)
  let a = audioWorker(null, { sampleRate: sr, channels: 1 })
  await a.push([tone]); await a.stop()
  let b = await a.clone()
  b.gain(-6)
  a.volume = 0
  await a.play()
  await new Promise(r => setTimeout(r, 200))
  let aEnded = false
  a.on('ended', () => { aEnded = true })
  b.play({ from: a })
  t.ok(aEnded && !a.playing, 'the other stops')
  await new Promise(r => setTimeout(r, 250))
  t.ok(b.playing && b.volume === 0 && b.currentTime > 0.3, `b plays on from there (${b.currentTime.toFixed(3)})`)
  let l = audio.from([tone], { sampleRate: sr })
  l.play({ from: b })
  t.ok(!b.playing && l.playing, 'a local instance takes it over too')
  await new Promise(r => setTimeout(r, 200))
  t.ok(l.currentTime > 0.5, `and plays on (${l.currentTime.toFixed(3)})`)
  l.stop()
  await Promise.all([a.dispose(), b.dispose()])
})
