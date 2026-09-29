/**
 * Playback in a browser, recorded where it reaches the speakers: every node connected to the destination feeds a
 * recorder too, an AudioWorklet keeping each render quantum with its context frame. Real time, on the page's one
 * AudioContext, through the local engine and the worker facade. Run by test/browser.js (Playwright, Chromium).
 *
 * "Heard" is the output timestamp: getOutputTimestamp() maps the context frame the speakers play to performance time
 * (W3C Web Audio API, AudioContext.getOutputTimestamp).
 */
import test from 'tst'
import audio from '../audio.js'
import audioWorker from '../worker.js'
import Speaker from '@audio/speaker'

const ctx = audio.context, sr = ctx.sampleRate
await ctx.resume()

// ── The recorder ─────────────────────────────────────────────────────────
const REC = `registerProcessor('rec', class extends AudioWorkletProcessor {
  constructor() { super(); this.q = []; this.f = 0 }
  flush(width) {
    let n = this.q[0].length, ch = Array.from({ length: n }, (_, c) => { let o = new Float32Array(this.q.length * 128); this.q.forEach((b, k) => o.set(b[c] || b[0], k * 128)); return o })
    this.port.postMessage({ frame: this.f, ch, width })
    this.q = []
  }
  process(i) {
    let x = i[0]
    // a batch holds contiguous quanta only
    if (this.q.length && currentFrame !== this.f + 128 * this.q.length) this.flush(x.length)
    if (!this.q.length) this.f = currentFrame
    this.q.push(Array.from({ length: Math.max(2, x.length) }, (_, c) => x[c] ? x[c].slice() : x[0] ? x[0].slice() : new Float32Array(128)))
    if (this.q.length === 8) this.flush(x.length)
    return true
  }
})`
await ctx.audioWorklet.addModule(URL.createObjectURL(new Blob([REC], { type: 'text/javascript' })))
const rec = new AudioWorkletNode(ctx, 'rec', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] })
const connect = AudioNode.prototype.connect
connect.call(rec, ctx.destination)
// a silent source keeps the recorder's input live, so it runs every quantum whatever else connects
let keep = new ConstantSourceNode(ctx, { offset: 0 })
connect.call(keep, rec)
keep.start()
let reports = []   // what decks report (diagnostics)
AudioNode.prototype.connect = function (target, ...rest) {
  if (target === ctx.destination && this !== rec) { connect.call(this, rec); this.port?.addEventListener('message', e => reports.push(e.data)) }
  return connect.call(this, target, ...rest)
}
let chunks = []
rec.port.onmessage = e => chunks.push(e.data)
// channel c of what reached the destination over context frames [f0, f1)
const tape = (f0, f1, c = 0) => {
  f0 = Math.floor(f0); f1 = Math.floor(f1)
  let out = new Float32Array(Math.max(0, f1 - f0))
  for (let k of chunks) {
    let a = Math.max(f0, k.frame), b = Math.min(f1, k.frame + k.ch[0].length)
    if (a < b) out.set((k.ch[c] || k.ch[0]).subarray(a - k.frame, b - k.frame), a - f0)
  }
  return out
}
const recorded = f => chunks.length && chunks.at(-1).frame + chunks.at(-1).ch[0].length > f

// ── Helpers ──────────────────────────────────────────────────────────────
const sleep = ms => new Promise(r => setTimeout(r, ms))
const busy = ms => { let t = performance.now(); while (performance.now() - t < ms); }
const until = async (cond, ms = 5000) => { for (let t = performance.now(); !cond() && performance.now() - t < ms;) await sleep(5) }
const now = () => ctx.currentTime * sr
const stamp = () => { let s = ctx.getOutputTimestamp(); return s.contextTime > 0 ? s : { contextTime: ctx.currentTime - (ctx.outputLatency || 0) - (ctx.baseLatency || 0), performanceTime: performance.now() } }
// the context frame the speakers play now; the performance time a context frame plays at
const heardFrame = () => { let s = stamp(); return (s.contextTime + (performance.now() - s.performanceTime) / 1000) * sr }
const heardAt = f => { let s = stamp(); return s.performanceTime + (f / sr - s.contextTime) * 1000 }
// where there is sound
const sounding = (x, floor = 1e-4) => [x.findIndex(v => Math.abs(v) > floor), x.findLastIndex(v => Math.abs(v) > floor)]
// the largest second difference: a sine of amplitude A at f Hz has A·(2πf/sr)²; a gap or a click has orders more
const bend = (x, from = 1, to = x.length - 1) => { let m = 0, at = 0; for (let i = Math.max(1, from); i < Math.min(to, x.length - 1); i++) { let d = Math.abs(x[i + 1] - 2 * x[i] + x[i - 1]); if (d > m) { m = d; at = i } } bend.at = at; return m }
const sineBend = (f, A) => A * (2 * Math.PI * f / sr) ** 2
// the quietest 128 frames (a gap is silent): the smallest block peak
const hollow = x => { let m = Infinity; for (let i = 0; i + 128 <= x.length; i += 128) { let p = 0; for (let j = i; j < i + 128; j++) p = Math.max(p, Math.abs(x[j])); m = Math.min(m, p) } return m }
const peakOf = x => x.reduce((m, v) => Math.max(m, Math.abs(v)), 0)
const sine = (f, A, d, rate = 44100) => audio.from(t => A * Math.sin(2 * Math.PI * f * t), { duration: d, sampleRate: rate })
const ended = a => new Promise(r => a.on('ended', r))
const worker = url => new Worker(url, { type: 'module' })
const engine = worker('/test/dist/worker.js')

// ── Tests ────────────────────────────────────────────────────────────────

test('context: one per page, reachable, shared by the engine and the worker facade', t => {
  t.ok(ctx instanceof AudioContext, 'audio.context')
  t.is(audioWorker.context, ctx, 'audioWorker.context is the same one')
  t.is(ctx.state, 'running', 'running')
})

test('local: a sine plays gapless and click-free through a main thread busy for 0.5 s', { timeout: 20000 }, async t => {
  let a = sine(441, 0.5, 3), f0 = now()
  a.play()
  await a.played
  await sleep(500)
  busy(500)
  await ended(a)
  await sleep(50)
  let x = tape(f0, now()), [s, e] = sounding(x)
  let b = bend(x, s, e), fAt = f0 + bend.at
  t.ok(b < 3 * sineBend(441, 0.5), `no click, no gap: bend ${b.toExponential(1)} (the sine's ${sineBend(441, 0.5).toExponential(1)}) at ${((bend.at - s) / sr).toFixed(4)} s: ${Array.from(x.subarray(bend.at - 3, bend.at + 4), v => v.toFixed(4))} ${b > 0.01 ? JSON.stringify(reports.filter(r => Math.abs(r.frame - fAt) < 2200)) + ' chunks ' + JSON.stringify(chunks.filter(c => Math.abs(c.frame - fAt) < 2200).map(c => c.frame)) : ''}`)
  t.ok(hollow(x.subarray(s + 256, e - 256)) > 0.45, 'never silent inside')
  t.ok(Math.abs(e - s - 3 * sr) < 0.005 * sr, `all 3 s of it (${((e - s) / sr).toFixed(3)} s)`)
})

test('worker: renders straight into the worklet; a main thread busy for 2.5 s changes nothing', { timeout: 20000 }, async t => {
  let w = audioWorker(null, { worker: engine, sampleRate: 44100, channels: 1 })
  await w.push([Float32Array.from({ length: 6 * 44100 }, (_, i) => 0.5 * Math.sin(2 * Math.PI * 441 * i / 44100))])
  await w.stop()
  let f0 = now()
  await w.play()
  await sleep(1000)
  busy(2500)    // longer than the 2 s rendered ahead: only the worker's port to the worklet feeds it now
  await ended(w)
  await sleep(50)
  let x = tape(f0, now()), [s, e] = sounding(x)
  t.ok(bend(x, s, e) < 3 * sineBend(441, 0.5), `no click, no gap (${bend(x, s, e).toExponential(1)})`)
  t.ok(hollow(x.subarray(s + 256, e - 256)) > 0.45, 'never silent inside')
  t.ok(Math.abs(e - s - 6 * sr) < 0.005 * sr, `all 6 s of it (${((e - s) / sr).toFixed(3)} s)`)
  await w.dispose()
})

test('start: under 30 ms from play() to sound, the audio there and the context warm', { timeout: 20000 }, async t => {
  for (let [name, make] of [['local', async () => sine(441, 0.5, 0.2)], ['worker', async () => {
    let w = audioWorker(null, { worker: engine, sampleRate: 44100, channels: 1 })
    await w.push([Float32Array.from({ length: 8820 }, (_, i) => 0.5 * Math.sin(2 * Math.PI * 441 * i / 44100))])
    await w.stop()
    return w
  }]]) {
    let a = await make(), f0 = now()
    a.play()
    await ended(a)
    await sleep(30)
    let x = tape(f0, now()), [s] = sounding(x)
    // on the context clock: from the frame being rendered at the call to the first frame that sounds; the device's
    // own latency (outputLatency + baseLatency) comes on top of both
    t.ok(s >= 0 && s / sr < 0.03, `${name}: ${(s / sr * 1000).toFixed(1)} ms (the device adds ${((ctx.outputLatency + ctx.baseLatency) * 1000).toFixed(1)} ms)`)
    a.dispose?.()
  }
})

test('loop: seamless seams, and the playhead (and a seek) stays in the span', { timeout: 20000 }, async t => {
  let a = sine(437, 0.5, 1), f0 = now(), times = []   // 109.25 periods a pass: a cut seam would click
  a.play({ at: 0.1, duration: 0.25, loop: true })
  await a.played
  for (let i = 0; i < 40; i++) { await sleep(20); times.push(a.currentTime) }
  a.seek(0.9)
  for (let i = 0; i < 10; i++) { await sleep(20); times.push(a.currentTime) }
  a.stop()
  await sleep(50)
  let x = tape(f0, now()), [s, e] = sounding(x)
  t.ok(bend(x, s + 300, e - 300) < 3 * sineBend(437, 0.5), `no click at the seams (${bend(x, s + 300, e - 300).toExponential(1)})`)
  t.ok(hollow(x.subarray(s + 300, e - 300)) > 0.3, 'no gap')
  t.ok(times.every(v => v >= 0.1 - 1e-6 && v <= 0.35 + 1e-6), `the playhead stays in [0.1, 0.35] (${Math.min(...times).toFixed(3)}..${Math.max(...times).toFixed(3)})`)
  t.ok(times.some((v, i) => i && v < times[i - 1] - 0.1), 'and wraps')
})

test('currentTime: what the speakers play, within 2 ms; held at pause, and resume goes on from there', { timeout: 20000 }, async t => {
  // a ramp: each sample tells where it is (0.1 + 0.4 t)
  let a = audio.from(t => 0.1 + 0.4 * t, { duration: 2, sampleRate: 44100 }), errs = []
  a.play()
  await a.played
  await sleep(150)
  for (let i = 0; i < 12; i++) {
    await sleep(30 + 30 * Math.random())
    let ct = a.currentTime, f = heardFrame()
    await until(() => recorded(f + 256))
    errs.push(Math.abs(ct - (tape(f, f + 1)[0] - 0.1) / 0.4))
  }
  let most = Math.max(...errs)
  t.ok(most < 0.002, `|currentTime − heard| ≤ ${(most * 1000).toFixed(2)} ms over ${errs.length} readings`)
  a.pause()
  await sleep(200)   // the speakers play out what they had
  let held = a.currentTime
  await sleep(100)
  t.is(a.currentTime, held, 'held while paused')
  let f1 = now()
  a.resume()
  await sleep(150)
  let x = tape(f1, now()), [s] = sounding(x), R = Math.round(sr / 200)
  let back = (x[s + 2 * R] - 0.1) / 0.4
  t.ok(Math.abs(back - (held + 2 * R / sr)) < 0.001, `resumes where it held: ${held.toFixed(4)} → ${back.toFixed(4)} two ramps in`)
  a.stop()
})

test('live edit: heard within 100 ms at the same place, crossfaded', { timeout: 20000 }, async t => {
  let a = sine(441, 0.5, 3)
  a.play()
  await a.played
  await sleep(500)
  let T0 = performance.now(), f0 = heardFrame()
  a.gain(-12)
  await sleep(400)
  a.stop()
  await sleep(50)
  let x = tape(f0, f0 + 0.4 * sr), k = 0
  while (k + 128 <= x.length && peakOf(x.subarray(k, k + 128)) > 0.45) k += 128
  let latency = heardAt(f0 + k) - T0
  t.ok(k + 128 <= x.length && latency < 100, `heard ${latency.toFixed(0)} ms after the edit`)
  t.ok(Math.abs(peakOf(x.subarray(k + 0.05 * sr, k + 0.1 * sr)) - 0.5 * 10 ** (-12 / 20)) < 0.005, 'the edited level')
  t.ok(bend(x) < 3 * sineBend(441, 0.5), `no click (${bend(x).toExponential(1)})`)
})

test('hand-off: another instance takes over where playback is, no gap, no click', { timeout: 20000 }, async t => {
  let a = sine(441, 0.5, 3), b = a.clone().gain(-6), f0 = now()
  a.play()
  await a.played
  await sleep(400)
  b.play({ from: a })
  t.ok(!a.playing && b.playing, 'the other stops')
  await sleep(400)
  b.stop()
  await sleep(50)
  let x = tape(f0, now()), [s, e] = sounding(x)
  t.ok(bend(x, s + 300, e - 300) < 3 * sineBend(441, 0.5), `no click (${bend(x, s + 300, e - 300).toExponential(1)})`)
  t.ok(hollow(x.subarray(s + 300, e - 300)) > 0.2, 'no gap')
  t.ok(Math.abs(peakOf(x.subarray(s + 0.1 * sr, s + 0.2 * sr)) - 0.5) < 0.005 && Math.abs(peakOf(x.subarray(e - 0.2 * sr, e - 0.1 * sr)) - 0.25) < 0.005, 'from the one to the other')
})

test('worker: an app worker speaks its own messages, exposes its outputs; the page follows a new one while playing', { timeout: 20000 }, async t => {
  let w = worker('/test/dist/worker-app.js'), replies = []
  w.onmessage = e => replies.push(e.data)
  const make = async (id, gain) => {
    w.postMessage({ type: 'make', id, duration: 3, gain, freq: 441 })
    await until(() => replies.some(r => r.id === id))
    return audioWorker.adopt(replies.find(r => r.id === id).made, { worker: w })
  }
  let one = await make(1, -6), f0 = now()
  await one.play()
  await sleep(400)
  let two = await make(2, -12)
  two.play({ from: one })
  await sleep(400)
  await two.stop()
  await sleep(50)
  let x = tape(f0, now()), [s, e] = sounding(x)
  t.is(replies.length, 2, "the app's messages and the engine's never meet")
  t.ok(bend(x, s + 300, e - 300) < 3 * sineBend(441, 0.25), `no click (${bend(x, s + 300, e - 300).toExponential(1)})`)
  t.ok(hollow(x.subarray(s + 300, e - 300)) > 0.1, 'no gap')
  t.ok(Math.abs(peakOf(x.subarray(e - 0.2 * sr, e - 0.1 * sr)) - 0.5 * 10 ** (-12 / 20)) < 0.005, 'the new output plays on')
  w.terminate()
})

test('meters: known signals, released when heard (local and worker)', { timeout: 20000 }, async t => {
  let x = new Float32Array(44100)
  for (let i = 22050; i < 44100; i++) x[i] = 0.5 * Math.sin(2 * Math.PI * 1000 * i / 44100)
  // the mel band a 1 kHz tone falls in (fn/spectrum.js: 64 bands, 30 Hz to 20 kHz)
  let mel = f => 2595 * Math.log10(1 + f / 700), lo = mel(30), hi = mel(20000)
  let centers = Array.from({ length: 64 }, (_, b) => 700 * (10 ** ((lo + (hi - lo) * (b + 1) / 65) / 2595) - 1))
  let band = centers.reduce((k, c, b) => Math.abs(c - 1000) < Math.abs(centers[k] - 1000) ? b : k, 0)
  for (let [name, a] of [['local', audio.from([x], { sampleRate: 44100 })], ['worker', await (async () => {
    let w = audioWorker(null, { worker: engine, sampleRate: 44100, channels: 1 })
    await w.push([x]); await w.stop()
    return w
  })()]]) {
    let loud = null, rms = [], peak = 0, spec = null
    a.meter('rms', v => { rms.push(v); if (v > 0.1 && loud == null) loud = a.currentTime })
    a.meter('peak', v => { peak = Math.max(peak, v) })
    a.meter({ type: 'spectrum', bins: 64 }, v => { spec = v })
    a.play()
    await ended(a)
    let tone = rms.filter(v => v > 0.3).sort((p, q) => p - q), mid = tone[tone.length >> 1]
    t.ok(loud != null && Math.abs(loud - 0.5) < 0.03, `${name}: the tone's first value arrives as it is heard (${loud?.toFixed(3)} s of 0.5)`)
    t.ok(Math.abs(mid - 0.5 / Math.SQRT2) < 0.002, `${name}: rms ${mid.toFixed(4)} (0.5/√2 = 0.3536)`)
    t.ok(Math.abs(peak - 0.5) < 0.002, `${name}: peak ${peak.toFixed(4)}`)
    let top = spec.reduce((k, v, b) => v > spec[k] ? b : k, 0)
    t.ok(Math.abs(top - band) <= 1, `${name}: spectrum peaks in band ${top} (1 kHz: ${band})`)
    a.dispose()
  }
})

test('pause, resume, seek and stop ramp: no click', { timeout: 20000 }, async t => {
  let a = sine(441, 0.5, 4), f0 = now()
  a.play()
  await a.played
  await sleep(200); a.pause()
  await sleep(150); a.resume()
  await sleep(150); a.seek(2.5)
  await sleep(150); a.pause(); a.seek(1); a.resume()
  await sleep(150); a.stop()
  await sleep(50)
  let x = tape(f0, now())
  t.ok(bend(x) < 3 * sineBend(441, 0.5), `no click anywhere (${bend(x).toExponential(1)})`)
})

test('progressive: a pushed source plays what has come, and goes on as more comes', { timeout: 20000 }, async t => {
  let tone = Float32Array.from({ length: 44100 }, (_, i) => 0.5 * Math.sin(2 * Math.PI * 441 * i / 44100))
  let a = audio(null, { sampleRate: 44100, channels: 1 }), f0 = now()
  a.push(tone.slice(0, 13230))              // 0.3 s
  a.play()
  await a.played
  await sleep(600)                          // it ran out: fades, waits
  a.push(tone.slice(13230, 26460))          // 0.3 s more
  await sleep(600)
  a.stop()
  await sleep(50)
  let x = tape(f0, now()), parts = [], on = false
  for (let i = 0; i + 128 <= x.length; i += 128) { let p = peakOf(x.subarray(i, i + 128)) > 0.1; if (p && !on) parts.push(i); on = p }
  t.is(parts.length, 2, 'what came, then the rest once it came')
  t.ok(bend(x) < 3 * sineBend(441, 0.5), `faded at the gap, no click (${bend(x).toExponential(1)})`)
})

test('channels: as the source has them, the device downmixes', { timeout: 20000 }, async t => {
  let n = 44100 / 2, chs = Array.from({ length: 6 }, (_, c) => c === 2 ? Float32Array.from({ length: n }, (_, i) => 0.5 * Math.sin(2 * Math.PI * 441 * i / 44100)) : new Float32Array(n))
  let a = audio.from(chs, { sampleRate: 44100 }), f0 = now()
  a.play()
  await ended(a)
  await sleep(50)
  let k = chunks.find(c => c.frame >= f0 + 0.1 * sr)
  t.is(k?.width, 6, 'six channels reach the destination')
  t.ok(peakOf(tape(f0, now(), 2)) > 0.45 && peakOf(tape(f0, now(), 0)) < 1e-6, 'each on its own channel')
})

test('@audio/speaker: chunks play back to back, no gap', { timeout: 20000 }, async t => {
  let write = Speaker({ context: ctx, channels: 1, bitDepth: 32 }), f0 = now(), n = 1024
  t.is(write.context, ctx, 'plays into the context given')
  for (let k = 0; k < 64; k++) {
    let c = Float32Array.from({ length: n }, (_, i) => 0.5 * Math.sin(2 * Math.PI * 441 * (k * n + i) / sr))
    if (!k) for (let i = 0; i < 64; i++) c[i] *= i / 64
    await new Promise(r => write(new Uint8Array(c.buffer), r))
  }
  await new Promise(r => write(null, r))
  await sleep(50)
  let x = tape(f0, now()), [s, e] = sounding(x)
  t.ok(bend(x, s, e) < 3 * sineBend(441, 0.5), `no gap between chunks (${bend(x, s, e).toExponential(1)})`)
  t.ok(Math.abs(e - s - 64 * n) < 64, `all of it (${e - s} of ${64 * n} frames)`)
})
