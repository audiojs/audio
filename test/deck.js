/**
 * Playback, offline: the deck (deck.js) rendered a quantum at a time as the audio thread would, fed by a voice
 * (fn/play.js) over a MessageChannel, recorded and checked sample by sample: gapless, loop seams, edits and
 * hand-offs heard where they happen, crossfaded, never stepped. The same code runs in the AudioWorklet.
 */
import test from 'tst'
import audio from '../audio.js'
import { Deck, whereHeard, context, open } from '../deck.js'
import { voice } from '../fn/play.js'

const tick = () => new Promise(r => setImmediate(r))
const sine = (f, A, dur, sr) => audio.from(t => A * Math.sin(2 * Math.PI * f * t), { duration: dur, sampleRate: sr })
const steps = (x, from = 1, to = x.length) => { let m = 0; for (let i = Math.max(1, from); i < Math.min(to, x.length); i++) m = Math.max(m, Math.abs(x[i] - x[i - 1])); return m }

/** A deck fed by voices and rendered offline, a quantum at a time, letting the voice run between reports as it would
 *  beside an audio thread. It renders once the audio is there, as a real deck would long since have it: a voice
 *  renders ahead many times faster than it plays. */
function rig(sr, ch = 2) {
  let reports = [], feed = null, ended = false
  let deck = new Deck(sr, ch, m => { reports.push(m); if (m.end != null) ended = true; feed?.postMessage(m) })
  let out = Array.from({ length: ch }, () => []), q = Array.from({ length: ch }, () => new Float32Array(128)), frame = 0
  const ready = () => {
    let c = deck.cur, n = deck.next
    // a splice coming up waits for its audio
    if (n && !n.run.ended && n.run.n < 4096 && (n.at == null || !c || deck.x / c.sr + 0.01 >= n.at)) return false
    if (!c) return ended || !!n
    return c.ended || c.t0 + c.n - deck.x > 4096
  }
  return {
    deck, reports, out,
    get frame() { return frame },
    port() {
      let { port1, port2 } = new MessageChannel()
      if (feed) { feed.removeAllListeners('message'); feed.close() }
      feed = port1
      feed.on('message', m => deck.feed(m))
      deck.got = 0; ended = false
      return port2
    },
    async play(frames) {
      for (let end = frame + frames; frame < end; frame += 128) {
        if (!(frame & 1023)) await tick()
        for (let k = 0; k < 2000 && !ready(); k++) await tick()
        deck.render(q, 128, frame)
        for (let c = 0; c < ch; c++) out[c].push(...q[c])
      }
    },
    until: async cond => { for (let k = 0; k < 2000 && !cond(); k++) await tick() },
    close() { feed?.close() },
  }
}

test('deck: a unit-rate run is a bit-exact copy; other rates through a windowed sinc (> 90 dB)', async t => {
  let x = Float32Array.from({ length: 44100 }, (_, i) => 0.5 * Math.sin(2 * Math.PI * 441 * i / 44100))
  const play = (srOut, rate = 1) => {
    let d = new Deck(srOut, 2, () => {}, { rate }), out = [], q = [new Float32Array(128), new Float32Array(128)]
    d.feed({ run: 1, sr: 44100, pos: 0 })
    for (let o = 0; o < x.length; o += 1024) d.feed({ run: 1, data: [x.slice(o, o + 1024)] })
    d.feed({ run: 1, end: 1 })
    for (let f = 0; f < 3e5 && (d.cur || !out.length); f += 128) { d.render(q, 128, f); out.push(...q[0]) }
    return Float32Array.from(out)
  }
  // the 5 ms fade-in and the 5 ms end fade aside
  let out = play(44100), R = 221
  t.ok(out.subarray(R, x.length - R).every((v, i) => v === x[i + R]), 'unit rate: the samples themselves')
  // against the ideal sine at the output rate
  const snr = (y, f, sr, from, to) => { let e = 0, p = 0; for (let i = from; i < to; i++) { let v = 0.5 * Math.sin(2 * Math.PI * f * i / sr); e += (y[i] - v) ** 2; p += v * v } return 10 * Math.log10(p / e) }
  let up = snr(play(48000), 441, 48000, 1000, 40000), fast = snr(play(44100, 2), 882, 44100, 3000, 20000)
  t.ok(up > 90, `44.1 → 48 kHz: ${up.toFixed(1)} dB`)
  t.ok(fast > 90, `playbackRate 2: ${fast.toFixed(1)} dB`)
})

test('deck: pause, resume and stop ramp over 5 ms; an underrun fades out, holds, and comes back where it held', async t => {
  let sr = 48000, A = 0.5, d = new Deck(sr, 1, m => reps.push(m)), reps = [], out = [], q = [new Float32Array(128)]
  let x = Float32Array.from({ length: sr }, (_, i) => A * Math.sin(2 * Math.PI * 1000 * i / sr))
  d.feed({ run: 1, sr, pos: 0 })
  d.feed({ run: 1, data: [x.slice(0, sr / 2)] })   // half of it: the rest arrives late
  const render = n => { for (let i = 0; i < n; i += 128) { d.render(q, 128, out.length); out.push(...q[0]) } }
  render(9600)
  d.set({ playing: false }); render(1280)
  d.set({ playing: true }); render(1280)
  let slope = 2 * Math.PI * 1000 * A / sr, ramp = A / 240
  t.ok(steps(out) <= slope + ramp, `pause and resume: no step (${steps(out).toFixed(4)} ≤ ${(slope + ramp).toFixed(4)})`)
  let held = reps.find(r => r.pos != null && r.speed === 0)
  t.ok(Math.abs(held.pos - (9600 + 240) / sr) < 2 / sr, `the head held where the fade out ended (${held.pos.toFixed(5)} s)`)
  render(sr / 2)   // runs past what came: fades out, holds
  let last = out.length
  t.ok(steps(out) <= slope + ramp, 'underrun: faded, not cut')
  t.ok(out.slice(last - 4800).every(v => v === 0), 'underrun: holds silent')
  let mark = reps.length, stop = reps.findLast(r => r.pos != null && r.speed === 0)
  d.feed({ run: 1, data: [x.slice(sr / 2)] }); d.feed({ run: 1, end: 1 })
  render(9600)
  t.ok(steps(out) <= slope + ramp, 'back without a step')
  let back = reps.slice(mark).find(r => r.pos != null && r.speed > 0)
  t.ok(back && back.pos === stop.pos, `resumes where it held: nothing skipped (${back?.pos.toFixed(5)} s)`)
  d.set({ stop: 1 }); render(1280)
  t.ok(reps.some(r => r.stopped != null) && d.done, 'stop: faded, then done')
  t.ok(steps(out) <= slope + ramp, 'stop: no step')
})

test('voice → deck: gapless, the source itself at unit rate', async t => {
  let sr = 44100, a = sine(441, 0.5, 1, sr), r = rig(sr)
  let v = voice(a, r.port())
  await r.play(sr + 4096)
  v.stop(); r.close()
  let [src] = await a.read(), out = r.out[0], R = 221
  t.ok(src.subarray(R, sr - R).every((s, i) => s === out[i + R]), 'every sample, no gap')
  t.ok(r.reports.some(m => m.end != null), 'the deck reports the end')
})

test('voice: a loop repeats its span, each seam the last 10 ms crossfading (equal power) into the 10 ms before its start', async t => {
  let sr = 44100, A = 0.5, a = sine(441, A, 1, sr), r = rig(sr)
  let s = 0.1, d = 0.25, S = Math.round(s * sr), L = Math.round(d * sr), X = Math.round(0.01 * sr)
  let v = voice(a, r.port(), { at: s, duration: d, loop: true })
  await r.play(4 * L)
  v.stop(); r.close()
  let [src] = await a.read(), out = r.out[0]
  // 110.25 periods: the seam meets a quarter period off; a cut would step by up to A√2
  let bound = 2 * Math.PI * 441 * A / sr + Math.PI * A / X
  t.ok(steps(out, 300) <= bound, `no step at the seams (${steps(out, 300).toFixed(4)} ≤ ${bound.toFixed(4)})`)
  t.ok(out.slice(221, L - X).every((v, i) => v === src[S + 221 + i]), 'the first pass is the span')
  let seamOk = true
  for (let j = 0; j < X; j++) {
    let u = (j + 0.5) / X * Math.PI / 2, want = Math.fround(src[S + L - X + j] * Math.cos(u) + src[S - X + j] * Math.sin(u))
    if (Math.abs(out[L - X + j] - want) > 1e-7) seamOk = false
  }
  t.ok(seamOk, 'the seam: the pass end blended into the lead-in, as the formula says')
  t.ok(out.slice(L, 2 * L).every((v, i) => v === out[L + L + i]), 'every pass after the first is the same')
  t.ok(out.slice(L, 2 * L - X).every((v, i) => v === src[S + i]), 'a pass starts on the span start')
})

test('voice: an edit re-renders from just ahead of the head and splices in there, linear over 20 ms', async t => {
  let sr = 44100, a = sine(441, 0.5, 2, sr), r = rig(sr)
  let [old] = await a.read()
  let v = voice(a, r.port())
  await r.play(Math.round(0.5 * sr))
  a.gain(-6)
  await r.until(() => r.deck.next)
  await r.play(sr)
  v.stop(); r.close()
  let [neu] = await a.read(), out = r.out[0], F = Math.round(0.02 * sr)
  // the crossfade's first frame is still all old: the first that differs is the one after it
  let k = out.findIndex((v, i) => i > 0.5 * sr && Math.abs(v - old[i]) > 1e-6) - 1
  t.ok(k > 0, 'the edit is heard')
  t.ok((k - 0.5 * sr) / sr < 0.1, `${((k - 0.5 * sr) / sr * 1000).toFixed(0)} ms past the head at the edit (the restart's own latency)`)
  let fit = 0
  for (let i = 0; i < F; i++) fit = Math.max(fit, Math.abs(out[k + i] - (old[k + i] * (1 - i / F) + neu[k + i] * i / F)))
  t.ok(fit < 1e-6, `a linear crossfade from the old render to the new, sample for sample (${fit.toExponential(1)})`)
  t.ok(out.slice(k + F, k + F + sr / 4).every((v, i) => v === neu[k + F + i]), 'then the edited render itself')
  let bound = 2 * Math.PI * 441 * 0.5 / sr + 0.25 / F, most = steps(out, 300, 2 * sr - 300)
  t.ok(most <= bound, `no step (${most.toFixed(4)} ≤ ${bound.toFixed(4)})`)
})

test('voice: another instance takes over at the head (hand-off), crossfaded, no gap', async t => {
  let sr = 48000, a = sine(300, 0.5, 2, sr), b = sine(300, 0.25, 2, sr), r = rig(sr)
  let va = voice(a, r.port(), { runs: 0 })
  await r.play(Math.round(0.4 * sr))
  // what b.play({ from: a }) does: a's voice lets go, b's continues its axis from just ahead of the head
  va.stop()
  let P = r.deck.x / sr + 0.05
  let vb = voice(b, r.port(), { runs: 1e6, from: P, splice: { at: P, fade: 0.02 } })
  await r.play(sr)
  vb.stop(); r.close()
  let out = r.out[0], [xa] = await a.read(), [xb] = await b.read(), k = Math.round(P * sr), F = Math.round(0.02 * sr)
  t.ok(out.slice(300, k).every((v, i) => v === xa[300 + i]), 'a until the splice')
  t.ok(out.slice(k + F, k + F + sr / 2).every((v, i) => v === xb[k + F + i]), 'b after it, at the same place')
  t.ok(steps(out, 300, k + sr / 2) <= 2 * Math.PI * 300 * 0.5 / sr + 0.25 / F + 1e-6, 'no step, no gap')
})

test('voice: a seek jumps there, crossfading (equal power) over 10 ms', async t => {
  let sr = 48000, a = sine(250, 0.5, 3, sr), r = rig(sr)
  let v = voice(a, r.port())
  await r.play(Math.round(0.3 * sr))
  let { run, at } = v.seek(2)
  t.is(at, 2, 'where it went')
  await r.until(() => r.deck.cur?.id === run || r.deck.next?.run.id === run)
  await r.play(sr / 2)
  v.stop(); r.close()
  let out = r.out[0], [src] = await a.read()
  let rep = r.reports.find(m => m.run === run && m.pos != null)
  t.ok(rep && rep.pos >= 2 && rep.pos < 2.05, `reports the new place once the crossfade is done (${rep?.pos.toFixed(3)})`)
  // the crossfade's first frame is still all old: the first that differs is the one after it
  let k = out.findIndex((v, i) => i > 0.3 * sr && Math.abs(v - src[i]) > 1e-6) - 1, F = Math.round(0.01 * sr)
  t.ok(out.slice(k + F, k + F + sr / 4).every((v, i) => v === src[2 * sr + F + i]), 'then the audio from 2 s on')
  t.ok(steps(out, 300) <= 2 * Math.PI * 250 * 0.5 / sr + Math.PI * 0.5 / F, 'no step')
})

test('play: meters report what is heard, when it is heard', async t => {
  let sr = 44100, x = new Float32Array(sr)
  for (let i = sr / 2; i < sr; i++) x[i] = 0.5 * Math.sin(2 * Math.PI * 440 * i / sr)
  let a = audio.from([x], { sampleRate: sr }), loud = null, values = []
  a.meter('rms', v => { values.push(v); if (v > 0.1 && loud == null) loud = a.currentTime })
  let peak = 0
  a.meter('peak', v => { peak = Math.max(peak, v) })
  a.play({ volume: 0 })
  await new Promise(r => a.on('ended', r))
  t.ok(loud != null && Math.abs(loud - 0.5) < 0.06, `the tone's rms first arrives when it is heard (at ${loud?.toFixed(3)} s of 0.5)`)
  let tone = values.filter(v => v > 0.1), mean = tone.reduce((s, v) => s + v, 0) / tone.length
  t.ok(Math.abs(mean - 0.5 / Math.SQRT2) < 0.01, `rms of a 0.5 sine: ${mean.toFixed(4)} (0.5/√2 = 0.3536)`)
  t.ok(Math.abs(peak - 0.5) < 0.01, `peak: ${peak.toFixed(4)}`)
})

test('play: play({ at }) while playing jumps without stopping; from another instance takes over its playback', async t => {
  let sr = 44100, a = sine(440, 0.5, 2, sr), b = sine(440, 0.25, 2, sr), ended = []
  a.on('ended', () => ended.push('a'))
  a.play({ volume: 0 })
  await a.played
  await new Promise(r => setTimeout(r, 150))
  a.play({ at: 1.5 })
  await new Promise(r => setTimeout(r, 150))
  t.ok(a.playing && a.currentTime >= 1.5, `jumped (${a.currentTime.toFixed(3)})`)
  b.play({ from: a })
  t.ok(!a.playing && ended.includes('a'), 'the other stops')
  t.ok(b.playing && b.volume === 0, 'volume carries over')
  await new Promise(r => setTimeout(r, 150))
  t.ok(b.currentTime > 1.5, `continues at the same place (${b.currentTime.toFixed(3)})`)
  b.stop()
})

// A loop over all of it, started at another place: play() then seek() before the deck has opened starts there, and
// the loop comes round to its own start
test('play: a seek right after play() starts it there; the loop still comes round to its start', async t => {
  let a = sine(440, 0.5, 1, 44100)
  a.play({ at: 0, loop: true, volume: 0 })
  a.seek(0.7)
  await a.played
  await new Promise(r => setTimeout(r, 60))
  t.ok(a.currentTime >= 0.7 && a.currentTime < 0.95, `started at the seek (${a.currentTime.toFixed(3)})`)
  await new Promise(r => setTimeout(r, 400))
  t.ok(a.playing && a.currentTime < 0.5, `came round to the loop's start (${a.currentTime.toFixed(3)})`)
  a.stop()
})

// The playhead from the deck's reports runs on between them, but only as far as the audio the deck had waiting: a
// starved deck (or late reports, on a loaded machine) holds it, and it never steps back when the next report comes
test('transport: the heard position runs on from the last report, never past the audio the deck had', t => {
  let sr = 48000, marks = [{ frame: 0, pos: 1, speed: 1, run: 1, loop: null, buf: 0.5 }]
  t.is(whereHeard(marks, sr * 0.25, sr).pos, 1.25, 'a quarter second on')
  t.is(whereHeard(marks, sr * 2, sr).pos, 1.5, 'starved: held where its audio ended')
  marks.push({ frame: sr * 2, pos: 1.5, speed: 1, run: 1, loop: null, buf: 1 })
  t.is(whereHeard(marks, sr * 2.5, sr).pos, 2, 'on again once more came, never back')
  t.is(whereHeard([{ frame: 0, pos: 3, speed: 0, run: 1, loop: null, buf: 1 }], sr, sr).pos, 3, 'held (speed 0): stays')
  t.ok(Math.abs(whereHeard([{ frame: 0, pos: 1.9, speed: 1, run: 1, loop: [1, 2], buf: 1 }], sr * 0.3, sr).time - 1.2) < 1e-9, 'a loop wraps into its span')
  t.is(whereHeard([], 0, sr), null, 'no report yet')
  // a glitching device skips frames: their numbers pass, the deck renders none, its next report says so
  let skipped = [{ frame: 896, pos: 2 + 128 / sr, speed: 1, run: 1, loop: null, buf: 2 }, { frame: 2048, pos: 2 + 1024 / sr, speed: 1, run: 1, loop: null, buf: 2 }]
  t.is(whereHeard(skipped, 2000, sr).pos, 2 + 1024 / sr, 'held where the next report has the head, not run on past it')
  t.is(whereHeard(skipped, 2048, sr).pos, 2 + 1024 / sr, 'and on from there')
})

// What the speakers play never goes back. While the device starts, its timestamp is not there yet, and the render time
// less a latency still unknown runs ahead of it; the timestamp, once there, lands short: the playhead holds, then runs on.
test('transport: the device clock never steps back, as the output timestamp takes over from the render time', async t => {
  let sr = 48000, node = null, clock = { currentTime: 1280 / sr, outputLatency: 0, stamp: { contextTime: 1024 / sr, performanceTime: 0 } }
  let ctx = {
    sampleRate: sr, state: 'running', destination: {}, baseLatency: 256 / sr, audioWorklet: { addModule: async () => {} },
    get currentTime() { return clock.currentTime }, get outputLatency() { return clock.outputLatency },
    getOutputTimestamp: () => ({ ...clock.stamp }),
  }
  globalThis.AudioWorkletNode = class { constructor() { node = this; this.port = { postMessage() {}, close() {} } } connect() {} disconnect() {} }
  try {
    context(ctx)
    let tp = await open({ channels: 2 })
    node.port.onmessage({ data: { frame: 768, pos: 2, speed: 1, buf: 0.6, run: 1, loop: null } })
    let a = tp.heard().time
    t.ok(Math.abs(a - (2 + 256 / sr)) < 1e-9, `no timestamp: 26.7 ms rendered less 5.3 ms of latency, frame 1024 (${a})`)
    Object.assign(clock, { currentTime: 0.0427, outputLatency: 0.024, stamp: { contextTime: 0.0101, performanceTime: performance.now() } })
    let b = tp.heard().time
    t.ok(b >= a, `the timestamp, short of it, holds it there (${b})`)
    clock.stamp = { contextTime: 0.03, performanceTime: performance.now() }
    let c = tp.heard().time
    t.ok(Math.abs(c - (2 + (0.03 * sr - 768) / sr)) < 1e-4, `and it runs on once past (${c})`)
    tp.stop()
  } finally { context(null); delete globalThis.AudioWorkletNode }
})
