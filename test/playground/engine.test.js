// The engine in a page, its worker and its runs, against the library in Node; the meters, the scrub, the sources; the
// server, the page and the helpers in page.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PerformanceObserver } from 'node:perf_hooks'
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import audio from '../../audio.js'
import { voiceTrack, stemTracks } from '../../playground/code.js'
import { boxed } from '../../playground/heard.js'
import { samples, RATE as SAMPLES } from '../../playground/samples.js'
import { vowel } from '../gen.js'
import { cycle, trace, ballistics, spectra } from '../../playground/meters.js'
import { page, origin, made, RATE, sine, peakDb, wavBytes, engine, scrubbed, clicked, attack, open } from './page.js'

// A voice gliding as speech does, ±4 semitones about 140 Hz twice a second, whose pitch moves within a frame: the pitch
// curve has it whole (contour(), pYIN), and the status bar's note over it, read off that curve, its compass, the 10th
// to the 90th percentile of the glide (YIN, which read it before, found half of it: too few to say a note)
test('engine: a voice gliding as speech does has a pitch curve whole, and a compass to say', async () => {
  const f = s => 140 * 2 ** (4 * Math.sin(2 * Math.PI * 2 * s) / 12), x = vowel(f, 2, 1, RATE)
  await page.goto(origin + '/blank.html')
  const { found, cents, pitch } = await page.evaluate(async channel => {
    const { default: engine } = await import('/playground/engine.js'), { prepare } = await import('/playground/code.js')
    const e = engine(new URL('/playground/dist/worker.js', location.href))
    await e.file('v.wav', { channels: [Float32Array.from(channel)], sampleRate: 48000 })
    const r = await e.render(prepare(`audio('v.wav')`)), { times, f0 } = await e.contour(r.id), { pitch } = await e.listen(r.id, [.2, 1.8], [0, 2])
    const inside = [...f0].filter((_, i) => times[i] > .05 && times[i] < 1.95), at = [...times].map((t, i) => [t, f0[i]]).filter(([t, h]) => h && t > .05 && t < 1.95)
    return { found: inside.filter(Boolean).length / inside.length, cents: at.map(([t, h]) => Math.abs(1200 * Math.log2(h / (140 * 2 ** (4 * Math.sin(2 * Math.PI * 2 * t) / 12))))).sort((p, q) => p - q), pitch }
  }, [...x])
  assert.ok(found > .97, `${(100 * found).toFixed(0)}% of its frames on the curve`)
  assert.ok(cents[cents.length >> 1] < 10, `${cents[cents.length >> 1].toFixed(1)} cents from its pitch, in the median`)
  // its compass: 140 Hz 4 semitones either way at most, the glide's extremes (111 and 176 Hz) past the percentiles
  assert.ok(pitch?.length === 2 && pitch[0] > 105 && pitch[0] < 125 && pitch[1] > 155 && pitch[1] < 182, JSON.stringify(pitch))
})

// A long file decoding, the worker answers the page meanwhile, at once: the decoder gives way with a task of its own
// (core.js yieldTask), not scheduler.yield(), whose turn comes before the tasks waiting, so that the worker said nothing
// till the file had all come (a 2 h MP3: 0% for 11 s, a click's sound none)
test('engine: a file decoding, the worker answers the page at once', async () => {
  const n = 360 * 44100, x = Float32Array.from({ length: n }, (_, i) => .3 * Math.sin(2 * Math.PI * 220 * i / 44100))
  const mp3 = Buffer.from(await audio.from([x], { sampleRate: 44100 }).encode('mp3')).toString('base64')
  await page.goto(origin + '/blank.html')
  const r = await page.evaluate(async b64 => {
    const { default: engine } = await import('/playground/engine.js'), { prepare } = await import('/playground/code.js')
    const e = engine(new URL('/playground/dist/worker.js', location.href)), bytes = await (await fetch('data:audio/mpeg;base64,' + b64)).arrayBuffer()
    await e.file('long.mp3', new Blob([bytes]))
    let started, done = false
    const loading = new Promise(resolve => { started = resolve })
    e.run(prepare(`audio('long.mp3')`), { loading: started, chunk: started, done: () => { done = true }, error: () => { done = true } })
    await loading
    // asked while it decodes: a tab closed, an answer of nothing to wait on
    const asked = [], t0 = performance.now()
    for (let k = 0; k < 5; k++) { const t = performance.now(); await e.close(1000 + k); asked.push(performance.now() - t); await new Promise(r => setTimeout(r, 30)) }
    return { asked, during: !done, took: performance.now() - t0 }
  }, mp3)
  assert.ok(r.during, `asked while it decoded (${r.took.toFixed(0)} ms)`)
  assert.ok(Math.max(...r.asked) < 100, `answered in ${r.asked.map(t => t.toFixed(0)).join(', ')} ms`)
})

// A run another takes the place of before it is whole is paused, not let go (worker.js pause): the same script asked
// for again (a step turned off and back on as it renders) goes on from where it was, sample for sample as it comes
// rendered whole at once; one left paused does nothing (its blocks counted by a step after it, `tick`): what is turned
// off costs nothing
test('engine: a run cut short goes on from where it was, its samples as rendered whole, and left alone does nothing', async () => {
  let seed = 7
  const x = Float32Array.from({ length: 30 * RATE }, (_, i) => .3 * Math.sin(2 * Math.PI * 330 * i / RATE) + .1 * ((seed = seed * 16807 % 2147483647) / 2147483647 - .5))
  await page.goto(origin + '/blank.html')
  const r = await page.evaluate(async channel => {
    const { default: engine } = await import('/playground/engine.js'), { prepare } = await import('/playground/code.js')
    const open = async name => { const e = engine(new URL('/playground/dist/worker.js', location.href)); await e.file(name, { channels: [Float32Array.from(channel)], sampleRate: 48000 }); return e }
    const TICK = `audio.op('tick', { process: (input, output) => { globalThis.ticks = (globalThis.ticks ?? 0) + 1; input.forEach((x, c) => output[c].set(x)) } })\n`
    const A = (f = 'n.wav') => prepare(`audio('${f}').omlsa()`), B = prepare(`audio('n.wav')`), C = (f = 'n.wav') => prepare(TICK + `audio('${f}').omlsa({ threshold: 0.5 }).tick()`)
    const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
    const timed = async (e, s) => { const t = performance.now(), o = await e.render(s); return { o: o.output, ms: performance.now() - t } }
    const ticks = async e => +(await e.run(prepare('globalThis.ticks ?? 0'))).value
    // rendered whole from the same samples under another name: the renders the browser keeps (worker.js renders) go by
    // the script and its files' names, so the same script would be found there, not made
    const fresh = await open('whole.wav'), whole = await timed(fresh, A('whole.wav')), wholeC = await timed(fresh, C('whole.wav'))
    const e = await open('n.wav')
    await e.render(B)
    // cut short a quarter of the way in, the source shown in its place; asked for again at once
    e.render(A())
    await sleep(whole.ms / 4)
    await e.render(B)
    const back = await timed(e, A())
    // cut short again, then left alone: it does nothing; asked for, it goes on from where it was
    e.render(C())
    await sleep(wholeC.ms / 4)
    await e.render(B)
    const paused = await ticks(e)
    await sleep(wholeC.ms)
    const still = await ticks(e), later = await timed(e, C())
    const diff = (p, q) => p.channels[0].length === q.channels[0].length ? p.channels[0].reduce((m, v, i) => Math.max(m, Math.abs(v - q.channels[0][i])), 0) : Infinity
    return { whole: whole.ms, back: back.ms, backDiff: diff(whole.o, back.o), laterDiff: diff(wholeC.o, later.o), paused, still }
  }, [...x])
  assert.equal(r.backDiff, 0, 'gone on from where it was: the same samples as rendered whole')
  assert.ok(r.back < r.whole * .9, `the rest of it alone: ${r.back.toFixed(0)} ms, whole ${r.whole.toFixed(0)} ms`)
  assert.ok(r.paused > 0, `it had begun: ${r.paused} blocks`)
  assert.equal(r.still, r.paused, 'left alone, not a block more')
  assert.equal(r.laterDiff, 0, 'asked for later, it goes on: the same samples')
})

// A step reading its input whole (any op's or plugin's prepare: rebalance's separation, declip's) can't be stopped but by
// the worker's end: turned off, or a setting of it changed, as it runs, the worker says it is held and is replaced, the
// pass gone with it; the very same step the newest run takes again (an edit added after it) runs on, the worker kept,
// the newest's own pass after it, never two at once. Stop during a pass replaces the worker
test('engine: a pass no run takes any more is stopped, the worker replaced; one taken again runs on, alone', async () => {
  const x = Float32Array.from({ length: 2 * RATE }, (_, i) => .3 * Math.sin(2 * Math.PI * 330 * i / RATE))
  await page.goto(origin + '/blank.html')
  const r = await page.evaluate(async channel => {
    const { default: engine } = await import('/playground/engine.js'), { prepare } = await import('/playground/code.js')
    const e = engine(new URL('/playground/dist/worker.js', location.href))
    let restarts = 0
    e.onrestart = () => restarts++
    await e.file('n.wav', { channels: [Float32Array.from(channel)], sampleRate: 48000 })
    // a pass of 1.5 s, giving way as a model on the GPU does, what it made kept on its edit as the ops keep theirs (asked
    // again, it is there): each turn counted, and how many run at once
    const SLOW = `const MADE = Symbol.for('made'); audio.op('slow', { params: ['k'], prepare: (a, i) => { const o = a.edits[i][1], g = globalThis; if (o[MADE]) return; return new Promise(done => { g.now = (g.now ?? 0) + 1; g.most = Math.max(g.most ?? 0, g.now); let i = 0; const t = setInterval(() => { g.turns = (g.turns ?? 0) + 1; if (++i === 30) { clearInterval(t); g.now--; o[MADE] = true; done() } }, 50) }) }, process: (input, output) => input.forEach((x, c) => output[c].set(x)) })\n`
    const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
    await e.render(prepare(`audio('n.wav')`))
    // an edit added after it as it runs: taken again, the newest's own after it
    e.render(prepare(SLOW + `audio('n.wav').slow(1)`))
    await sleep(300)
    const after = await e.render(prepare(SLOW + `audio('n.wav').slow(1).gain(-1)`)), kept = restarts
    // the steps of it kept meanwhile (checkpoint), a run of the same chain answers how many ran at once
    await sleep(2000)
    const most = +(await e.run(prepare(SLOW + `audio('n.wav').slow(1).gain(-1)\nglobalThis.most`))).value
    // a setting of it changed as it runs: let go of, the worker replaced (the steps kept after the last run done first)
    await sleep(2000)
    let was = restarts
    e.render(prepare(SLOW + `audio('n.wav').slow(2)`))
    await sleep(300)
    const changed = await e.render(prepare(SLOW + `audio('n.wav').slow(3)`)), onChange = restarts - was
    // turned off as it runs: let go of
    await sleep(2000)
    was = restarts
    e.render(prepare(SLOW + `audio('n.wav').slow(4)`))
    await sleep(300)
    const off = await e.render(prepare(`audio('n.wav')`)), onOff = restarts - was
    await sleep(500)
    const turns = +(await e.run(prepare('globalThis.turns ?? 0'))).value
    // Stop as it runs
    e.render(prepare(SLOW + `audio('n.wav').slow(5)`))
    await sleep(300)
    const stopped = await e.stop()
    const n = o => o.output?.channels[0].length
    return { kept, most, onChange, onOff, turns, stopped, after: n(after), changed: n(changed), off: n(off) }
  }, [...x])
  assert.equal(r.kept, 0, 'an edit added after it: the pass taken again, the worker kept')
  assert.equal(r.most, 1, 'the newest\'s own pass after the one in flight, never two at once')
  assert.equal(r.after, 2 * RATE)
  assert.equal(r.onChange, 1, 'a setting of it changed: the worker replaced')
  assert.equal(r.changed, 2 * RATE)
  assert.equal(r.onOff, 1, 'turned off: the worker replaced')
  assert.equal(r.off, 2 * RATE, 'the output without it, whole')
  assert.equal(r.turns, 0, 'no pass runs on in the worker after')
  assert.equal(r.stopped, true, 'Stop during a pass replaces the worker')
})

// A pass holding the worker deaf for longer than HELD at a time, as a model on the CPU does (wasm answers nothing while it
// runs): a newer run that still calls it (another track edited as it runs) waits for it, the worker kept, the pass not
// started over, which for a song's stems was minutes; one that calls it no more replaces the worker
test('engine: a pass holding the worker is waited for by a run that still calls it, never started over', async () => {
  const x = Float32Array.from({ length: RATE }, (_, i) => .3 * Math.sin(2 * Math.PI * 330 * i / RATE))
  await page.goto(origin + '/blank.html')
  const r = await page.evaluate(async channel => {
    const { default: engine } = await import('/playground/engine.js'), { prepare } = await import('/playground/code.js')
    const e = engine(new URL('/playground/dist/worker.js', location.href))
    let restarts = 0
    e.onrestart = () => restarts++
    await e.file('n.wav', { channels: [Float32Array.from(channel)], sampleRate: 48000 })
    // two stretches of 1.2 s, the worker deaf through each, a run sent in the first answered past HELD; made once for its
    // setting, as memo() keeps a model's
    const BUSY = `audio.op('busy', { params: ['k'], prepare: async (a, i) => { const k = a.edits[i][1].k, g = globalThis; if (g.made?.[k]) return; for (let n = 0; n < 2; n++) { const t = performance.now(); while (performance.now() - t < 1200); await new Promise(r => setTimeout(r)) } g.made = { ...g.made, [k]: true } }, process: (input, output) => input.forEach((x, c) => output[c].set(x)) })\n`
    const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
    await e.render(prepare(`audio('n.wav')`))
    e.render(prepare(BUSY + `let voice = audio('n.wav').busy(1)\n\nlet bed = audio('n.wav')`))
    await sleep(300)
    const edited = await e.render(prepare(BUSY + `let voice = audio('n.wav').busy(1)\n\nlet bed = audio('n.wav').gain(-6)`)), kept = restarts
    // the pass taken away as it runs
    e.render(prepare(BUSY + `audio('n.wav').busy(2)`))
    await sleep(300)
    await e.render(prepare(`audio('n.wav')`))
    return { kept, off: restarts - kept, tracks: edited.output?.tracks?.map(t => t.name), peak: Math.max(...edited.output.channels[0]) }
  }, [...x])
  assert.equal(r.kept, 0, 'another track edited as the pass holds the worker: the worker kept, the pass run on')
  // the voice track whole in the newer run's mix: the older run, let go mid-pass, kept no empty render of it
  assert.deepEqual(r.tracks, ['voice', 'bed'])
  assert.ok(Math.abs(r.peak - .3 * (1 + 10 ** (-6 / 20))) < 1e-3, `the newer run's mix: ${r.peak}`)
  assert.equal(r.off, 1, 'the pass taken away: the worker replaced')
})

// Each track kept in the browser's files by what makes it alone (its file, its edits): a new worker, as a reload makes,
// has it at once, its pass not run again; the same track set otherwise is made anew. Its sum heard but a track muted,
// made as it plays (worker.js voice): the other track alone
test('engine: tracks come back from the browser\'s files, nothing made again; heard but one muted, the other alone', async () => {
  const x = Float32Array.from({ length: RATE }, (_, i) => .3 * Math.sin(2 * Math.PI * 330 * i / RATE))
  await page.goto(origin + '/blank.html')
  const r = await page.evaluate(async channel => {
    const { default: engine } = await import('/playground/engine.js'), { prepare } = await import('/playground/code.js')
    const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
    // a pass counted in the worker it runs in
    const OP = `audio.op('counted', { params: ['k'], prepare: () => { globalThis.runs = (globalThis.runs ?? 0) + 1 }, process: (input, output) => input.forEach((x, c) => output[c].set(x)) })\n`
    const script = k => prepare(OP + `let voice = audio('n.wav').counted(${k})\n\nlet bed = audio('n.wav').gain(-6)`)
    const fresh = async () => { const e = engine(new URL('/playground/dist/worker.js', location.href)); await e.file('n.wav', { channels: [Float32Array.from(channel)], sampleRate: 48000 }); return e }
    const runs = async e => +(await e.run(prepare('globalThis.runs ?? 0'))).value
    const first = await fresh(), made = await first.render(script(1))
    // heard but the bed muted: the voice alone, as it plays (asked before another run of the tab lets the output go)
    const { voice } = await first.voice({ output: made.id, muted: ['bed'] }), [heard] = await voice.read(), ranFirst = await runs(first)
    // kept in the background: a moment for it, then a worker of its own
    await sleep(1500)
    const second = await fresh(), again = await second.render(script(1)), ranAgain = await runs(second)
    const changed = await second.render(script(2)), ranChanged = await runs(second)
    const peak = c => Math.max(...c)
    return { ranFirst, ranAgain, ranChanged, same: peak(again.output.channels[0]), mixed: peak(made.output.channels[0]), heard: peak(heard), tracks: changed.output.tracks.map(t => t.name) }
  }, [...x])
  assert.ok(r.ranFirst >= 1, 'made the first time')
  assert.equal(r.ranAgain, 0, 'a new worker: the tracks from the browser\'s files, the pass not run')
  assert.ok(Math.abs(r.same - r.mixed) < 1e-6, 'the same mix')
  assert.ok(r.ranChanged >= 1, 'set otherwise: made anew')
  assert.deepEqual(r.tracks, ['voice', 'bed'])
  assert.ok(Math.abs(r.heard - .3) < 1e-3 && r.mixed > .44, `the bed muted, the voice alone: ${r.heard}, the mix ${r.mixed}`)
})

// A step rendering its input whole (a stretch, any plugin over all of it) holds the worker till it ends. The steps of an
// output kept after it (worker.js checkpoint) take what the output's render made of it, not making it again: taken away
// at once, nothing waits on it, and a step after it changed renders from it
test('engine: a step rendering its input whole is made once, kept from the render, never again behind the page\'s back', async () => {
  const x = Float32Array.from({ length: 2 * RATE }, (_, i) => .3 * Math.sin(2 * Math.PI * 330 * i / RATE))
  await page.goto(origin + '/blank.html')
  const r = await page.evaluate(async channel => {
    const { default: engine } = await import('/playground/engine.js'), { prepare } = await import('/playground/code.js')
    const e = engine(new URL('/playground/dist/worker.js', location.href))
    await e.file('n.wav', { channels: [Float32Array.from(channel)], sampleRate: 48000 })
    // a whole step of a second, at once, each time counted
    const HEAVY = `audio.op('heavy', { whole: (input, output) => { globalThis.wholes = (globalThis.wholes ?? 0) + 1; const t = performance.now(); while (performance.now() - t < 1000); input.forEach((x, c) => output[c].set(x)) } })\n`
    const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
    const timed = async code => { const t = performance.now(), o = await e.render(prepare(code)); return { n: o.output?.channels[0].length, ms: performance.now() - t } }
    const first = await timed(HEAVY + `audio('n.wav').heavy().gain(-1)`)
    await sleep(300)
    const tweaked = await timed(HEAVY + `audio('n.wav').heavy().gain(-2)`)
    const gone = await timed(`audio('n.wav').gain(-1)`)
    const wholes = +(await e.run(prepare('globalThis.wholes'))).value
    return { first, tweaked, gone, wholes }
  }, [...x])
  assert.ok(r.first.ms > 1000 && r.first.n === 2 * RATE, `made: ${r.first.ms.toFixed(0)} ms`)
  assert.equal(r.wholes, 1, 'made once: kept from the render, not made again')
  assert.ok(r.tweaked.ms < 500 && r.tweaked.n === 2 * RATE, `a step after it changed, from what it made: ${r.tweaked.ms.toFixed(0)} ms`)
  assert.ok(r.gone.ms < 500 && r.gone.n === 2 * RATE, `taken away, nothing waits on it: ${r.gone.ms.toFixed(0)} ms`)
})

// An edit added at the end of the script renders on the last output's samples (worker.js rebased), not the whole script
// again: the same samples as the whole script rendered afresh, for edits that keep the length, change it, learn from
// their input or measure it; the same script again, or one changed before its end (A, then B), renders whole, the same
test('engine: an edit added after the last output renders on its samples, as the whole script would', async () => {
  let seed = 3
  const noise = () => (seed = seed * 16807 % 2147483647) / 2147483647 - .5
  const x = [0, 1].map(c => Float32Array.from({ length: 3 * RATE }, (_, i) => .4 * Math.sin(2 * Math.PI * (220 + 110 * c) * i / RATE) + .05 * noise()))
  const base = `audio('x.wav').highpass(80).normalize(-1)`
  const scripts = [base, ...[
    `.spectral([1000, 4000], { at: 1, d: 0.5 })`,
    `.spectral([1000, 4000], { at: 1, d: 0.5 }).remove({ at: 2, d: 0.5, xfade: 0.01 })`,
    `.spectral([1000, 4000], { at: 1, d: 0.5 }).remove({ at: 2, d: 0.5, xfade: 0.01 }).denoise({ noise: { at: 0, d: 0.5 } }).normalize(-3)`,
    `.spectral([1000, 4000], { at: 1, d: 0.5 }).remove({ at: 2, d: 0.5, xfade: 0.01 }).denoise({ noise: { at: 0, d: 0.5 } }).normalize(-3)`,
    // a marker added renders whole; an edit after it carries the marker where the edit moves it
    `.mark(2.5, 'b')`,
    `.mark(2.5, 'b').remove({ at: 1, d: 0.5, xfade: 0.01 })`,
    `.mark(2.5, 'b').remove({ at: 1, d: 0.5, xfade: 0.01 }).mark({ at: 0.5, d: 1 }, 'r')`,
    `.mark(2.5, 'b').remove({ at: 1, d: 0.5, xfade: 0.01 }).mark({ at: 0.5, d: 1 }, 'r').remove({ at: 0.7, d: 0.2, xfade: 0.01 })`,
    // a paste of what an earlier step copied: nothing to paste on the last output's samples alone, so it renders whole
    `.copy({ at: 0.5, d: 0.25 })`,
    `.copy({ at: 0.5, d: 0.25 }).paste(2)`
  ].map(tail => base + tail), `audio('x.wav').highpass(100).normalize(-1).spectral([1000, 4000], { at: 1, d: 0.5 })`]
  const rebasing = await engine(scripts, { 'x.wav': x })
  for (const [i, code] of scripts.entries()) {
    const [whole] = await engine([code], { 'x.wav': x }), got = rebasing[i].output.channels, want = whole.output.channels
    assert.equal(got[0].length, want[0].length, code)
    assert.deepEqual(rebasing[i].output.markers, whole.output.markers, code)
    const diff = Math.max(...got.map((c, k) => c.reduce((m, v, j) => Math.max(m, Math.abs(v - want[k][j])), 0)))
    assert.ok(diff < 1e-6, `${code}: ${diff}`)
  }
})

// And at once: a band taken out of 30 s whose script spends seconds on its noise (omlsa(), about 2 s in Node) renders
// in a fraction of that, the noise reduction not run again
test('engine: an edit added after a slow chain lands in a fraction of the chain\'s time', async () => {
  const x = [0, 1].map(c => Float32Array.from({ length: 30 * RATE }, (_, i) => .3 * Math.sin(2 * Math.PI * (220 + c) * i / RATE) + .05 * Math.sin(i * i)))
  await page.goto(origin + '/blank.html')
  const [slow, edit] = await page.evaluate(async channels => {
    const { default: engine } = await import('/playground/engine.js'), { prepare } = await import('/playground/code.js')
    const e = engine(new URL('/playground/dist/worker.js', location.href))
    await e.file('x.wav', { channels: channels.map(c => Float32Array.from(c)), sampleRate: 48000 })
    const time = async code => { const t = performance.now(); const r = await e.render(prepare(code)); if (!r.output) throw new Error(r.error?.message); return performance.now() - t }
    return [await time(`audio('x.wav').omlsa()`), await time(`audio('x.wav').omlsa().spectral([1000, 4000], { at: 10, d: 0.5 })`)]
  }, x.map(c => [...c]))
  assert.ok(edit < slow / 4, `the edit ${edit.toFixed(0)} ms, the chain ${slow.toFixed(0)} ms`)
})

// A slow chain split into two tracks: each a copy of the sound they share (code.js parted), each starting from what is
// kept of it (worker.js: a copy knows its source, so its edits find the kept render), the noise reduction not run again
test('engine: tracks split from a slow chain land in a fraction of the chain\'s time', async () => {
  const x = [0, 1].map(c => Float32Array.from({ length: 30 * RATE }, (_, i) => .3 * Math.sin(2 * Math.PI * (220 + c) * i / RATE) + .05 * Math.sin(i * i)))
  await page.goto(origin + '/blank.html')
  const [slow, split, code] = await page.evaluate(async channels => {
    const { default: engine } = await import('/playground/engine.js'), { prepare, toTrack } = await import('/playground/code.js')
    const e = engine(new URL('/playground/dist/worker.js', location.href))
    await e.file('x.wav', { channels: channels.map(c => Float32Array.from(c)), sampleRate: 48000 })
    const time = async code => { const t = performance.now(); const r = await e.render(prepare(code)); if (!r.output) throw new Error(r.error?.message); return performance.now() - t }
    const one = `audio('x.wav').omlsa()`, two = toTrack(one, { at: '10', d: '1' }).code
    return [await time(one), await time(two), two]
  }, x.map(c => [...c]))
  assert.match(code, /^let xTake = audio\('x\.wav'\)\.omlsa\(\)\n\nlet x = xTake\.clone\(\)/)
  assert.ok(split < slow / 4, `the two tracks ${split.toFixed(0)} ms, the chain ${slow.toFixed(0)} ms`)
})

// Tracks: the script's sounds side by side, each made alone (its own edits, kept as any output is) and summed into the
// output from their starts: as long as the longest, a narrower one's channels in turn across the wider's (as mix() spreads
// a mono sound), one at another rate resampled to the first's (the library's resample()), every track's markers on it.
// Each track's own picture comes first: its channels averaged, its length. The same samples as the library in Node
test('engine: tracks are made each alone and played together, their sum as long as the longest', async () => {
  const a = [sine(1, 220, .3), sine(1, 330, .3)], b = [sine(.5, 440, .2, 24000)]
  const script = `let a = audio('a.wav')\n  .gain(-6)\n\nlet b = audio('b.wav')\n  .pad(0.25, 0)\n  .mark(0.5, 'b')`
  await page.goto(origin + '/blank.html')
  const got = await page.evaluate(async ({ a, b, script }) => {
    const { default: engine } = await import('/playground/engine.js'), { prepare } = await import('/playground/code.js')
    const e = engine(new URL('/playground/dist/worker.js', location.href))
    await e.file('a.wav', { channels: a.map(c => Float32Array.from(c)), sampleRate: 48000 })
    await e.file('b.wav', { channels: b.map(c => Float32Array.from(c)), sampleRate: 24000 })
    const r = await e.render(prepare(script))
    if (!r.output) throw new Error(r.error?.message ?? 'no output')
    const { channels, sampleRate, markers, tracks } = r.output
    return { channels: channels.map(c => [...c]), sampleRate, markers, tracks: tracks.map(t => ({ name: t.name, length: t.length, mono: [...t.mono] })), said: r.tracks }
  }, { a: a.map(c => [...c]), b: b.map(c => [...c]), script })
  const A = await audio.from(a, { sampleRate: RATE }).gain(-6).read()
  const B = await audio.from(await audio.from(b, { sampleRate: 24000 }).pad(.25, 0).read(), { sampleRate: 24000 }).resample(RATE).read()
  assert.deepEqual(got.said, ['a', 'b'], 'the run says its tracks')
  assert.deepEqual(got.tracks.map(t => [t.name, t.length]), [['a', RATE], ['b', B[0].length]])
  assert.equal(B[0].length, .75 * RATE)
  assert.equal(got.sampleRate, RATE)
  assert.equal(got.channels.length, 2)
  assert.equal(got.channels[0].length, RATE, 'as long as the longest')
  const off = (x, want) => x.reduce((m, v, i) => Math.max(m, Math.abs(v - want(i))), 0)
  for (const c of [0, 1]) assert.ok(off(got.channels[c], i => A[c][i] + (B[0][i] ?? 0)) < 1e-6, `channel ${c}: the sum`)
  assert.ok(off(got.tracks[0].mono, i => (A[0][i] + A[1][i]) / 2) < 1e-6, 'a track\'s picture, its channels averaged')
  assert.ok(off(got.tracks[1].mono, i => B[0][i]) < 1e-6)
  assert.deepEqual(got.markers.map(m => [+m.time.toFixed(6), m.label]), [[.5, 'b']], 'a track\'s markers on the mix')
})

// A range moved to a track of its own (code.js toTrack) leaves the sound as it was: the two tracks' mix is the one
// track's output, for a range at its start, inside it and at its end. The same script again makes the same; one track
// changed, the other kept, makes what Node makes. Edges: a track with nothing in it (at another rate), tracks with nothing
// in them at all, a track's file not there
test('engine: a range moved to a track of its own sounds as before; again, changed, empty or missing', async () => {
  let seed = 7
  const noise = () => (seed = seed * 16807 % 2147483647) / 2147483647 - .5
  const x = [0, 1].map(c => Float32Array.from({ length: RATE }, (_, i) => .3 * Math.sin(2 * Math.PI * (220 + 110 * c) * i / RATE) + .1 * noise()))
  await page.goto(origin + '/blank.html')
  const got = await page.evaluate(async x => {
    const { default: engine } = await import('/playground/engine.js'), { prepare, toTrack } = await import('/playground/code.js')
    const e = engine(new URL('/playground/dist/worker.js', location.href))
    await e.file('x.wav', { channels: x.map(c => Float32Array.from(c)), sampleRate: 48000 })
    const run = async code => { const r = await e.render(prepare(code)); return r.output ? { channels: r.output.channels.map(c => [...c]), tracks: r.output.tracks?.map(t => [t.name, t.length]) ?? null, duration: r.output.duration } : { error: r.error?.message } }
    const one = `audio('x.wav')\n  .gain(-3)`, out = { one: await run(one), splits: [] }
    for (const [at, d] of [['0', '0.25'], ['0.5', '0.25'], ['0.75', '0.25']]) out.splits.push({ at, ...await run(toTrack(one, { at, d }).code) })
    const split = toTrack(one, { at: '0.5', d: '0.25' }).code
    out.again = await run(split)
    out.changed = await run(`${split}\n  .gain(-6)`)
    out.empty = await run(`let x = audio('x.wav')\nlet z = audio.from(0)`)
    out.nothing = await run(`let y = audio.from(0)\nlet z = audio.from(0)`)
    out.missing = await run(`let x = audio('x.wav')\nlet b = audio('nowhere.wav')`)
    return out
  }, x.map(c => [...c]))
  const A = await audio.from(x, { sampleRate: RATE }).gain(-3).read(), X = await audio.from(x, { sampleRate: RATE }).read()
  const off = (got, want) => Math.max(...got.map((c, k) => c.reduce((m, v, i) => Math.max(m, Math.abs(v - want(k, i))), 0)))
  assert.ok(off(got.one.channels, (k, i) => A[k][i]) < 1e-6)
  for (const s of got.splits) {
    assert.deepEqual(s.tracks?.map(t => t[0]), ['x', 'x2'], `from ${s.at}: two tracks`)
    assert.equal(s.channels[0].length, RATE, `from ${s.at}: as long`)
    assert.ok(off(s.channels, (k, i) => A[k][i]) < 1e-6, `from ${s.at}: the mix is the sound it was`)
  }
  assert.deepEqual(got.splits.map(s => s.tracks[1][1]), [RATE / 4, RATE * 3 / 4, RATE], 'each piece from 0 to its end')
  const { at, ...split } = got.splits[1]
  assert.deepEqual(got.again, split, 'the same script, the same')
  const k6 = 10 ** (-6 / 20), inside = i => i >= RATE / 2 && i < RATE * 3 / 4
  assert.ok(off(got.changed.channels, (k, i) => inside(i) ? A[k][i] * k6 : A[k][i]) < 1e-6, 'the piece 6 dB down, the rest kept')
  assert.deepEqual(got.empty.tracks, [['x', RATE], ['z', 0]])
  assert.ok(off(got.empty.channels, (k, i) => X[k][i]) < 1e-6, 'a track with nothing in it adds nothing')
  assert.deepEqual([got.nothing.duration, got.nothing.tracks?.map(t => t[1])], [0, [0, 0]], 'nothing at all')
  assert.match(got.missing.error, /nowhere\.wav/)
})

// Tracks past the channel samples the page holds (the mix's and each track's): the mix and every track come as their
// pictures (leaves and spectra, each track's as long as the mix, silence after its end), their samples where the view
// zooms in, each track's channels averaged
test('engine: tracks longer than the page holds come as pictures, each track\'s samples where it zooms in', async () => {
  const a = [sine(1, 220, .3), sine(1, 330, .3)], b = [sine(.5, 440, .2)]
  await page.goto(origin + '/blank.html')
  const got = await page.evaluate(async ({ a, b }) => {
    const { default: engine } = await import('/playground/engine.js'), { prepare } = await import('/playground/code.js')
    const e = engine(new URL('/playground/dist/worker.js', location.href))
    e.peaks = 48000
    await e.file('a.wav', { channels: a.map(c => Float32Array.from(c)), sampleRate: 48000 })
    await e.file('b.wav', { channels: b.map(c => Float32Array.from(c)), sampleRate: 48000 })
    const out = {}, done = new Promise(resolve => {
      e.run(prepare(`let a = audio('a.wav')\nlet b = audio('b.wav')`), {
        tracks: m => { out.tracks = m.tracks.map(t => ({ name: t.name, length: t.length, mono: !!t.mono, leaves: t.leaves?.length, levels: t.spectra?.levels.length, bins: t.spectra && t.spectra.size / 2 + 1, hop: t.spectra?.hop })) },
        chunk: m => { out.chunks = [...out.chunks ?? [], { long: m.long, samples: !!m.channels }] },
        done: m => resolve(m), error: m => resolve(m)
      }).then(r => { out.id = r.id })
    })
    const end = await done
    if (end.error) throw new Error(end.error.message)
    out.long = end.long
    out.lanes = (await e.samples(out.id, 12000, 36000)).map(c => [...c])
    return out
  }, { a: a.map(c => [...c]), b: b.map(c => [...c]) })
  assert.equal(got.long, true)
  assert.ok(got.chunks.every(c => c.long && !c.samples), 'the mix, as its picture')
  assert.deepEqual(got.tracks.map(t => [t.name, t.length, t.mono]), [['a', RATE, false], ['b', RATE / 2, false]])
  // a leaf of [min, max, Σx², count] per 256 samples (the last short), a column of bins per hop: the mix's length, each
  // track's
  for (const t of got.tracks) assert.equal(t.leaves, Math.ceil(RATE / 256) * 4, `${t.name}: its leaves as long as the mix`)
  for (const t of got.tracks) assert.equal(t.levels, Math.ceil(RATE / t.hop) * t.bins, `${t.name}: its columns as long as the mix`)
  const off = (x, want) => x.reduce((m, v, i) => Math.max(m, Math.abs(v - want(i))), 0)
  assert.ok(off(got.lanes[0], i => (a[0][12000 + i] + a[1][12000 + i]) / 2) < 1e-6, 'a: its channels averaged')
  assert.ok(off(got.lanes[1], i => b[0][12000 + i] ?? 0) < 1e-6, 'b: silence after its end')
})

// ── The script as code ─────────────────────────────────────────

// One cycle of a sine, whatever its pitch, stands as the logo's signals do: up, then down through zero at mid-period
// A digital peak meter's return: 20 dB in 1.7 s (IEC 60268-18); the peak held 1.5 s, then falling as fast
test('meters: as it plays, a peak rises at once and falls back 20 dB in 1.7 s; its mark holds 1.5 s, then falls', () => {
  const db = v => 20 * Math.log10(v), near = (a, b, what) => assert.ok(Math.abs(a - b) < 1e-6, `${what}: ${a} vs ${b}`)
  let m = ballistics([{ rms: .3, peak: .9 }], null, 0)
  assert.deepEqual(m[0], { rms: .3, peak: .9, hold: .9, held: 0 }, 'the first reading as it is')
  // silence after it, a tenth of a second a frame
  for (let i = 0; i < 17; i++) m = ballistics([{ rms: 0, peak: 0 }], m, .1)
  near(db(m[0].peak), db(.9) - 20, 'the peak 1.7 s on, 20 dB down')
  assert.equal(m[0].rms, 0, 'the RMS as read')
  // held 1.5 s, then falling at the same rate for the frames past it
  near(m[0].hold, .9 * 10 ** (-.2 / 1.7), 'the mark, 0.2 s of falling past 1.5 s held')
  m = ballistics([{ rms: .5, peak: 1 }], m, .1)
  assert.deepEqual([m[0].peak, m[0].hold, m[0].held], [1, 1, 0], 'a higher peak takes both at once')
})

test('meters: the bar\'s mark plays one cycle of what sounds, falling through zero at its middle, and its pitch; noise settles to a stir', () => {
  const rate = 48000, sine = f => [Float32Array.from({ length: rate }, (_, i) => .5 * Math.sin(2 * Math.PI * f * i / rate + 1))]
  for (const f of [55, 110, 440, 1500]) {
    const t = cycle(sine(f), rate / 2, rate, trace(), 1)
    const off = Math.max(...t.wave.map((v, j) => Math.abs(v - Math.sin(2 * Math.PI * j / 64))))
    assert(off < .1 && t.wave[31] > 0 && t.wave[33] < 0, `${f} Hz: ${off.toFixed(3)} off a sine cycle`)
    assert(Math.abs(t.hz / f - 1) < .01, `${f} Hz is heard as ${t.hz}`)
  }
  // Uniform noise never repeats: frames eased together average out
  let seed = 1
  const noise = [Float32Array.from({ length: rate }, () => (seed = seed * 16807 % 2147483647) / 2147483647 - .5)], stir = trace()
  for (let k = 0; k < 60; k++) cycle(noise, 4000 + k * 800, rate, stir)
  assert(Math.max(...stir.wave.map(Math.abs)) < .3, 'noise settles')
  // Silence stays flat
  assert(cycle([new Float32Array(rate)], rate / 2, rate, trace(), 1).wave.every(v => v === 0))
})

// A pitched-down fragment, a rumble, a slow drift: correlations that only fall off from lag 0. There is no pitch to find,
// and once a wave went NaN there the mark stayed empty for good
test('meters: a sound with no pitch in it, or samples that are no number, leave the wave a number and the last pitch kept', () => {
  const rate = 48000
  let seed = 7
  const rnd = () => (seed = seed * 16807 % 2147483647) / 2147483647 - .5
  const smooth = a => { let y = 0; return Float32Array.from({ length: rate }, () => (y += a * (rnd() - y))) }
  const tone = [Float32Array.from({ length: rate }, (_, i) => .5 * Math.sin(2 * Math.PI * 220 * i / rate))]
  const broken = Float32Array.from({ length: rate }, (_, i) => i % 7 === 0 ? NaN : i % 11 === 0 ? Infinity : .3 * Math.sin(2 * Math.PI * 100 * i / rate))
  const cases = {
    'a 12 Hz drift': [Float32Array.from({ length: rate }, (_, i) => .3 * Math.sin(2 * Math.PI * 12 * i / rate))],
    'a constant': [new Float32Array(rate).fill(.4)],
    'smooth noise': [smooth(.001)],
    'smoother noise': [smooth(.0003)],
    'samples that are no number': [broken],
  }
  for (const [name, x] of Object.entries(cases)) {
    const t = trace()
    cycle(tone, rate / 2, rate, t)
    const pitch = t.hz
    for (let k = 0; k < 20; k++) cycle(x, 20000 + k * 300, rate, t)
    assert.ok(t.wave.every(Number.isFinite), `${name}: the wave is a number`)
    assert.ok(Number.isFinite(t.hz) && t.hz > 0, `${name}: the pitch is a number, ${t.hz}`)
    if (!/noise|no number/.test(name)) assert.equal(t.hz, pitch, `${name}: nothing repeats, so the pitch it had stays`)
  }
})

// The pitch a caret sweeping a chord progression shows keeps to a note rather than wandering between it and its overtones
test('meters: the pitch holds to the note it had, where a fresh look at each moment would wander', () => {
  const rate = SAMPLES
  // moves of more than a fifth of an octave, from one look to the next, over the samples that hold a note
  const wander = (x, held) => {
    const t = trace()
    let last = 0, moves = 0
    for (let s = .2; s < x[0].length / rate - .3; s += .01) {
      if (!held) t.hz = 0
      cycle(x, s * rate, rate, t, .5)
      if (t.hz && last && Math.abs(Math.log2(t.hz / last)) > .2) moves++
      if (t.hz) last = t.hz
    }
    return moves
  }
  for (const name of ['rhodes', 'birdsong', 'chime']) {
    const x = samples[name].make(), free = wander(x, false), held = wander(x, true)
    assert(held * 1.5 < free, `${name}: ${held} moves held, ${free} fresh`)
  }
})

// The mark and the spectrum are read every frame it plays. A loop left unoptimized makes a heap number of each product,
// and the page stops to collect them over and over as it plays (a read past the samples' end did: 30 collections a
// second in Chrome)
test('meters: a frame of them as it plays leaves nothing to collect', async () => {
  const rate = 48000, x = [0, 1].map(c => Float32Array.from({ length: 6 * rate }, (_, i) => .5 * Math.sin(2 * Math.PI * 220 * i / rate + c)))
  const t = trace(), frame = i => { cycle(x, 4096 + i * 800, rate, t); spectra(x, i * 800, i * 800 + 4096, { size: 4096 }) }
  for (let i = 0; i < 100; i++) frame(i)
  let gcs = 0
  const seen = new PerformanceObserver(list => { gcs += list.getEntries().length })
  seen.observe({ entryTypes: ['gc'] })
  for (let i = 0; i < 300; i++) frame(i)
  await new Promise(r => setTimeout(r, 20))
  seen.disconnect()
  assert.ok(gcs <= 10, `${gcs} collections in 300 frames`)
})

// A click the caret crosses is an event: it plays once, as recorded, with nothing of it before it. A vocoder alone
// spreads it over the frames it falls in, a slow caret keeping it in many: 0.2 of its attack, 33 dB over the floor in the
// 20 ms before it.
test('scrub: a click dragged over at half speed, or back over it, plays once, as sharp as recorded, nothing smeared before it', async () => {
  const x = clicked()
  for (const [from, speed] of [[.4, .5], [.6, -.5]]) {
    const a = attack((await scrubbed([x], q => from * 48000 + q * 128 * speed, .4))[0], x)
    assert.ok(a.sharp > .8, `${speed}×: the attack at ${a.sharp.toFixed(2)} of the source's`)
    assert.ok(a.before < 3, `${speed}×: ${a.before.toFixed(1)} dB over the floor before it`)
  }
})

// Held on a click, the caret plays it once, then the floor around it: the attack is not held as a smeared noise
test('scrub: a caret held on a click plays it once, then holds the sound around it', async () => {
  const x = clicked(), out = (await scrubbed([x], () => 24000, .4))[0], a = attack(out, x)
  assert.ok(a.sharp > .5, `once, at ${a.sharp.toFixed(2)} of its attack`)
  const later = Math.max(...a.dy.slice(a.at + 0.03 * 48000).map(Math.abs))
  assert.ok(later < Math.abs(a.dy[a.at]) * .1, `then ${(later / Math.abs(a.dy[a.at])).toFixed(3)} of it at most`)
})

// Every channel as one image: a click in the left channel alone sounds in the left alone
test('scrub: a click in one channel sounds in that channel only', async () => {
  const left = clicked(), right = clicked(48000, 0), [l, r] = await scrubbed([left, right], q => .4 * 48000 + q * 64, .4)
  const a = attack(l, left), b = attack(r, left)
  assert.ok(a.sharp > .8, `left: the attack at ${a.sharp.toFixed(2)}`)
  assert.ok(b.sharp < .01, `right: ${b.sharp.toFixed(4)} of it`)
})

// A steady tone holds no onset: it scrubs as a tone, at its pitch and level
test('scrub: a steady tone dragged at its own speed plays at its pitch and level', async () => {
  const rate = 48000, x = Float32Array.from({ length: rate }, (_, i) => .5 * Math.sin(2 * Math.PI * 440 * i / rate))
  const y = (await scrubbed([x], q => .2 * rate + q * 128, .5))[0].subarray(.2 * rate)
  let crossings = 0
  for (let i = 1; i < y.length; i++) if (y[i - 1] < 0 && y[i] >= 0) crossings++
  const hz = crossings / (y.length / rate), db = 20 * Math.log10(Math.sqrt(y.reduce((s, v) => s + v * v, 0) / y.length) / (.5 / Math.SQRT2))
  assert.ok(Math.abs(hz - 440) < 5, `${hz.toFixed(1)} Hz`)
  assert.ok(Math.abs(db) < 1.5, `${db.toFixed(2)} dB`)
})

// At the edges nothing breaks: a sound shorter than a frame, silence, a caret before the start and past the end, and
// one that jumps 20,000 samples a quantum all play finite samples
test('scrub: short sounds, silence, a caret past either end or leaping stay finite, each way it sounds', async () => {
  const cases = [[[Float32Array.from({ length: 100 }, (_, i) => Math.sin(i))], q => q * 10], [[new Float32Array(48000)], q => q * 128], [[clicked()], () => -5000], [[clicked()], () => 90000], [[clicked(), clicked()], q => (q * 20000) % 48000]]
  for (const mode of ['hybrid', 'tape', 'loop', 'grains', 'bank', 'lines', 'random', 'vocoder']) for (const [x, caret] of cases) for (const c of await scrubbed(x, caret, .2, 48000, mode)) assert.ok(c.every(Number.isFinite), mode)
})

// The other ways a held caret sounds, the lab's (the settings; scrub-methods.js). Held on the Rhodes' chord, its vocoder,
// every bin's phase carried on, keeps more of what it plays in the chord's own partials (where the sound around the
// caret is within 30 dB of its loudest) than the vocoder whose untonal bins turn at random. Its tape's head plays the
// samples themselves at the caret's speed (after the head has caught up, the sound as recorded, a lag behind); held
// still, silence.
test('scrub: the lab\'s ways: its vocoder keeps a held chord in its partials; its tape plays the samples, silent when still', async () => {
  const x = samples.rhodes.make(), at = 2 * SAMPLES, N = 8192
  const power = y => Array.from({ length: N / 2 }, (_, k) => { let re = 0, im = 0; for (let i = 0; i < N; i += 2) { const w = .5 - .5 * Math.cos(2 * Math.PI * i / N), a = 2 * Math.PI * k * i / N; re += y[i] * w * Math.cos(a); im += y[i] * w * Math.sin(a) } return re * re + im * im })
  const around = power(x[0].subarray(at - N / 2, at + N / 2)), top = Math.max(...around)
  const share = async mode => { const y = await scrubbed(x, () => at, 1, SAMPLES, mode), p = power(y[0].subarray(y[0].length - N)); return p.reduce((a, v, k) => a + (around[k] > top / 1000 ? v : 0), 0) / p.reduce((a, b) => a + b, 0) }
  const noise = await share('hybrid'), vocoder = await share('vocoder')
  assert.ok(vocoder > noise + .05, `in the partials: vocoder ${vocoder.toFixed(3)}, vocoder + noise ${noise.toFixed(3)}`)
  const still = (await scrubbed(x, () => at, 1, SAMPLES, 'tape'))[0].subarray(SAMPLES / 2)
  assert.ok(Math.sqrt(still.reduce((a, v) => a + v * v, 0) / still.length) < 1e-3, 'a still tape: silence')
  const Q = 128, y = (await scrubbed(x, q => at + q * Q, 1, SAMPLES, 'tape'))[0], from = SAMPLES / 2, n = SAMPLES / 4
  // the lag that lines the two up best, and how alike they are there (normalised correlation)
  let best = 0
  for (let lag = 0; lag < 4000; lag += 4) {
    let xy = 0, xx = 0, yy = 0
    for (let i = from; i < from + n; i++) { const a = y[i], b = x[0][at + i - lag]; xy += a * b; xx += b * b; yy += a * a }
    best = Math.max(best, xy / Math.sqrt(xx * yy))
  }
  assert.ok(best > .95, `drawn at its speed, the sound as recorded: correlation ${best.toFixed(3)}`)
})

// ── Times and cues ─────────────────────────────────────────────

// Several boxes on the spectrogram play as the library makes them (heard.js boxed): each box's band over its time,
// silence around them. A 300 Hz and a 3 kHz tone together, 2 s; a box keeps 2–4 kHz over 0.2–0.6 s, another 100–500 Hz
// over 1.2–1.6 s. The 24 dB an octave filters leave the other tone 20 dB under at least (an octave and more away).
test('boxes: each plays its band over its time, silence around them', async () => {
  const sr = 44100, x = Float32Array.from({ length: sr * 2 }, (_, i) => .4 * Math.sin(2 * Math.PI * 300 * i / sr) + .4 * Math.sin(2 * Math.PI * 3000 * i / sr))
  const out = await boxed(audio.from([x, x], { sampleRate: sr }), [[.2, .6, 2000, 4000], [1.2, 1.6, 100, 500]]).read()
  const rms = (t0, t1) => { let s = 0, k = 0; for (let i = Math.round(t0 * sr); i < t1 * sr; i++, k++) s += out[0][i] ** 2; return Math.sqrt(s / k) }
  const hz = (t0, t1) => { let z = 0; for (let i = Math.round(t0 * sr) + 1; i < t1 * sr; i++) if (out[0][i - 1] < 0 && out[0][i] >= 0) z++; return z / (t1 - t0) }
  assert.equal(out.length, 2)
  assert.equal(out[0].length, x.length)
  assert.ok(Math.abs(hz(.3, .5) - 3000) < 20 && rms(.3, .5) > .2, `first box: ${hz(.3, .5)} Hz at ${rms(.3, .5)}`)
  assert.ok(Math.abs(hz(1.3, 1.5) - 300) < 10 && rms(1.3, 1.5) > .2, `second box: ${hz(1.3, 1.5)} Hz at ${rms(1.3, 1.5)}`)
  assert.equal(rms(.8, 1), 0, 'silence between')
  assert.equal(rms(1.8, 2), 0, 'and after')
  // boxes that meet in time sound together; one that runs to the end keeps the length
  const both = await boxed(audio.from([x], { sampleRate: sr }), [[.2, .6, 2000, 4000], [.4, 2, 100, 500]]).read()
  const at = (t0, t1) => { let s = 0, k = 0; for (let i = Math.round(t0 * sr); i < t1 * sr; i++, k++) s += both[0][i] ** 2; return Math.sqrt(s / k) }
  assert.equal(both[0].length, x.length)
  assert.ok(at(.45, .55) > at(.25, .35) * 1.3 && at(1.7, 1.9) > .2, `${at(.25, .35)} alone, ${at(.45, .55)} together, ${at(1.7, 1.9)} to the end`)
})

test('engine: output, peak and loudness match the library run in Node', async () => {
  const tone = [sine(1, 1000, 1), sine(1, 1000, .5)]
  const [r] = await engine([`audio('tone.wav').gain(-6)`], { 'tone.wav': tone })
  assert.equal(r.error, undefined)
  const local = audio.from(tone, { sampleRate: RATE }).gain(-6)
  const expected = await local.read()
  assert.equal(r.output.sampleRate, RATE)
  assert.equal(r.output.channels[0].length, expected[0].length)
  for (let c = 0; c < 2; c++) for (let i = 0; i < expected[c].length; i += 97) assert.ok(Math.abs(r.output.channels[c][i] - expected[c][i]) < 1e-6)
  // −6 dB of a full-scale sine: 20·log10(10^(−6/20)) = −6 dBFS
  assert.ok(Math.abs(r.output.stats.peak + 6) < .01, `peak ${r.output.stats.peak}`)
  assert.ok(Math.abs(r.output.stats.loudness - await audio.from(expected, { sampleRate: RATE }).stat('loudness')) < 1e-6)
})

test('engine: registry plugins load in the worker and render as they do in Node', async () => {
  const tone = [sine(1, 220, .9)]
  const script = `audio('tone.wav').compressor({ threshold: -30, ratio: 4 }).freeverb({ room: 0.7 })`
  const [r] = await engine([script], { 'tone.wav': tone })
  assert.equal(r.error, undefined)
  const expected = await audio.from(tone, { sampleRate: RATE }).compressor({ threshold: -30, ratio: 4 }).freeverb({ room: .7 }).read()
  assert.equal(r.output.channels[0].length, expected[0].length)
  let diff = 0
  for (let c = 0; c < expected.length; c++) for (let i = 0; i < expected[c].length; i++) diff = Math.max(diff, Math.abs(r.output.channels[c][i] - expected[c][i]))
  assert.ok(diff < 1e-5, `differs by ${diff}`)
})

// declip's rebuild on threads beside the engine's worker (jobs.js, parallel.js): the kernel's samples as Node makes
// them, to the last bit or two a browser's own Math may round otherwise; bit for bit wherever they are made (Node's
// tests, plugin-denoise.js, and declip's own)
test('engine: declip makes its jobs on threads beside the worker, the kernel\'s samples', async () => {
  const clipped = [sine(.3, 220, .9).map(v => Math.max(-.5, Math.min(.5, v + .2 * Math.sin(v * 40))))]
  const [r] = await engine([`audio('clipped.wav').declip()`], { 'clipped.wav': clipped })
  assert.equal(r.error, undefined)
  assert.ok(page.workers().length > 1, `threads beside the engine's worker: ${page.workers().length} workers`)
  const { default: kernel } = await import('@audio/denoise-declip'), expected = kernel(Float32Array.from(clipped[0]), { fs: RATE, clipLevel: 0, order: 256 })
  assert.ok(expected.some((v, i) => v !== Math.fround(clipped[0][i])), 'something rebuilt')
  let diff = 0
  for (let i = 0; i < expected.length; i++) diff = Math.max(diff, Math.abs(expected[i] - r.output.channels[0][i]))
  assert.ok(diff < 1e-6, `differs by ${diff}`)
})

test('engine: files decode in the worker; errors name their line; a runaway loop stops; values print', async () => {
  const bytes = await wavBytes([sine(.5, 440, .5)])
  const [decoded, failed, missing, value, looped] = await engine([
    `audio('in.wav')`,
    `let a = audio('in.wav')\na.nope()`,
    `audio('gone.wav')`,
    `await audio('in.wav').stat('db')`,
    `while (true) {}`
  ], { 'in.wav': bytes })
  assert.equal(decoded.output.channels[0].length, RATE / 2)
  assert.ok(Math.abs(peakDb(decoded.output.channels) - 20 * Math.log10(.5)) < .01)
  assert.equal(failed.error.line, 2)
  assert.match(failed.error.message, /nope/)
  assert.match(missing.error.message, /gone\.wav is not open/)
  assert.ok(Math.abs(+value.value - 20 * Math.log10(.5)) < .01, value.value)
  assert.match(looped.error.message, /loop ran/)
})

// What the agent measures (the measure tool, worker.js evaluate): a stat left unawaited in what it answers comes back
// awaited, not as {}, and each stat it took, on the output or the original, is noted with where it was taken and its
// value, for the chat to say whatever shape the answer takes: the same values the library gives
test('engine: a measure answers its stats awaited, and notes each one it took', async () => {
  await page.goto(origin + '/blank.html')
  const tone = [sine(1, 440, .5)]
  const r = await page.evaluate(async tone => {
    const { default: engine } = await import('/playground/engine.js'), { prepare } = await import('/playground/code.js')
    const e = engine(new URL('/playground/dist/worker.js', location.href))
    await e.file('a.wav', { channels: tone.map(c => Float32Array.from(c)), sampleRate: 48000 })
    await e.render(prepare(`audio('a.wav').gain(-6)`))
    return e.evaluate(prepare(`({ s: out.stat(['db', 'loudness']), lb: out.stat('loudness', { bins: 2 }), sil: out.silence(), was: src.stat('db') })`))
  }, tone.map(c => [...c]))
  const a = audio.from(tone, { sampleRate: RATE }), quiet = audio.from(tone, { sampleRate: RATE }).gain(-6)
  const [db, lufs] = await quiet.stat(['db', 'loudness']), was = await a.stat('db')
  assert.ok(Math.abs(r.value.s[0] - db) < 1e-4 && Math.abs(r.value.s[1] - lufs) < 1e-4, JSON.stringify(r.value.s))
  assert.equal(r.value.lb.length, 2)
  assert.deepEqual(r.value.sil, [])
  assert.ok(Math.abs(r.value.was - was) < 1e-4)
  assert.deepEqual(r.measured.map(m => [m.of, m.name, m.opts]), [['out', 'db', {}], ['out', 'loudness', {}], ['out', 'loudness', { bins: 2 }], ['out', 'silence', {}], ['src', 'db', {}]])
  assert.ok(Math.abs(r.measured[0].value - db) < 1e-4)
})

// A measure reads the edits (step(i), worker.js): the sound entering and leaving one, what it takes out, and where a time
// or range of the output was as it entered it, as the library gives them; a stage not made yet is made, the run going again
test('engine: a measure reads each edit, before and after it, what it takes out, where the output was', async () => {
  await page.goto(origin + '/blank.html')
  const tone = [sine(2, 440, .5)], code = `audio('a.wav').remove({ at: 0.5, d: 0.5 }).gain(-6).lowpass(200)`
  const r = await page.evaluate(async ({ tone, code }) => {
    const { default: engine } = await import('/playground/engine.js'), { prepare, stages } = await import('/playground/code.js')
    const e = engine(new URL('/playground/dist/worker.js', location.href))
    await e.file('a.wav', { channels: tone.map(c => Float32Array.from(c)), sampleRate: 48000 })
    await e.render(prepare(code))
    const steps = stages(code).map(s => ({ call: s.call, on: s.on, keeps: s.name !== 'remove', before: prepare(s.before), after: s.after && prepare(s.after) }))
    return e.evaluate({ ...prepare(`const s = step(1); [s.call, s.on, s.before.stat('db'), s.after.stat('db'), s.takes.stat('db'), s.where({ at: 0.6, d: 0.2 }), step(0).where({ at: 0.6, d: 0.2 }), step(0).takes, step(2).where(1.2), step(0).where(0.6), s.before.duration]`), steps })
  }, { tone: tone.map(c => [...c]), code })
  const [call, on, before, after, takes, here, there, none, moment, back, length] = r.value
  assert.deepEqual([call, on], ['gain(-6)', true])
  // the tone at 0.5 is −6.02 dBFS; −6 dB more after the gain; what the gain takes out, 1 − 10^(−6/20) of it
  assert.ok(Math.abs(before - 20 * Math.log10(.5)) < .01 && Math.abs(after - before + 6) < .01, `${before}, ${after}`)
  assert.ok(Math.abs(takes - 20 * Math.log10(.5 * (1 - 10 ** (-6 / 20)))) < .01, `${takes}`)
  assert.ok(Math.abs(here.at - .6) < 1e-3 && Math.abs(here.d - .2) < 1e-3, `no edit after the gain moves it: ${JSON.stringify(here)}`)
  assert.ok(Math.abs(there.at - 1.1) < 1e-3 && Math.abs(there.d - .2) < 1e-3, `before the remove, half a second later: ${JSON.stringify(there)}`)
  assert.equal(none, null, 'remove changes the timing: nothing taken to say')
  assert.ok(Math.abs(moment - 1.2) < 1e-3 && Math.abs(back - 1.1) < 1e-3, `a moment alike: ${moment}, ${back}`)
  assert.ok(Math.abs(length - 1.5) < 1e-6, 'times on a stage are its own')
  assert.deepEqual(r.measured.map(m => m.of), ['before gain(-6)', 'after gain(-6)', 'what gain(-6) takes out'])
})

// A measure is its value however the agent's code reads it, as Claude Code and Codex wrote it on the sounds in the page:
// unawaited and read at once (`out.stat('notes').map`), in a callback not async, in a sum, a comparison, a loop over it,
// one taken where another says, one after another in a loop; a binned stat's values plain numbers, mapped to text as
// text (a Float32Array maps to NaN), stat([…])'s values by name too (`L.rms`, as an agent read them), and one chained as
// a promise still one. The run that reads one too soon runs again
// once it is made: the values the library gives, each stat noted once, and a stat that fails says why
test('engine: a measure is its value however the code reads it', async () => {
  await page.goto(origin + '/blank.html')
  // a tone with a pause, 0.4 s to 0.6 s
  const tone = [sine(1, 440, .5).map((v, i) => i >= .4 * RATE && i < .6 * RATE ? 0 : v)]
  const codes = {
    notes: `out.stat('notes').map(n => n.note)`,
    sum: `out.stat('db') - src.stat('db')`,
    each: `[0, 0.6].map(at => +out.stat('db', { at, d: 0.4 }).toFixed(2))`,
    loop: `const at = []; for (const p of out.silence({ threshold: -40 })) at.push(+p.at.toFixed(2)); at`,
    where: `out.silence({ threshold: -40 }).map(p => out.stat('db', { at: p.at, d: p.duration }) < -60)`,
    steps: `let n = 0; for (let i = 0; i < 40; i++) if (out.stat('db', { at: i * 0.025, d: 0.025 }) > -60) n++; n`,
    text: `out.stat('db', { bins: 2 }).map(v => v.toFixed(1))`,
    names: `const s = out.stat(['db', 'loudness']); [s.db, s.loudness]`,
    // an edit the code makes, made once to the copy each run has: the stat the third run reads, as the first was
    edited: `out.gain(-6); [out.stat('db').toFixed(2), out.stat('loudness').toFixed(2)].map(Number)`,
    // a call that asks anew each run (random): runs run out, and say what to write instead
    random: `out.stat('db', { at: Math.random() / 2, d: 0.1 }).toFixed(1)`,
    then: `[out.stat('db').then(v => v + 1), out.stat('loudness') * 1]`,
    nope: `out.stat('nope').length`
  }
  const r = await page.evaluate(async ({ tone, codes }) => {
    const { default: engine } = await import('/playground/engine.js'), { prepare } = await import('/playground/code.js')
    const e = engine(new URL('/playground/dist/worker.js', location.href))
    await e.file('a.wav', { channels: tone.map(c => Float32Array.from(c)), sampleRate: 48000 })
    await e.render(prepare(`audio('a.wav').gain(-6)`))
    const out = {}
    for (const [k, code] of Object.entries(codes)) out[k] = await e.evaluate(prepare(code))
    return out
  }, { tone: tone.map(c => [...c]), codes })
  const a = audio.from(tone, { sampleRate: RATE }), quiet = audio.from(tone, { sampleRate: RATE }).gain(-6)
  const [db, lufs] = await quiet.stat(['db', 'loudness']), pauses = await quiet.silence({ threshold: -40 })
  let n = 0
  for (let i = 0; i < 40; i++) if (await quiet.stat('db', { at: i * 0.025, d: 0.025 }) > -60) n++
  for (const [k, v] of Object.entries(r)) if (k !== 'nope' && k !== 'random') assert.equal(v.error, undefined, `${k}: ${v.error?.message}`)
  assert.deepEqual(r.notes.value, (await quiet.stat('notes')).map(n => n.note))
  assert.ok(r.notes.value.length > 0)
  assert.ok(Math.abs(r.sum.value - (db - await a.stat('db'))) < 1e-4, r.sum.value)
  assert.deepEqual(r.each.value, [+(await quiet.stat('db', { at: 0, d: .4 })).toFixed(2), +(await quiet.stat('db', { at: .6, d: .4 })).toFixed(2)])
  assert.deepEqual(r.loop.value, pauses.map(p => +p.at.toFixed(2)))
  assert.equal(pauses.length, 1)
  assert.deepEqual(r.where.value, [true])
  assert.equal(r.steps.value, n)
  assert.deepEqual(r.text.value, Array.from(await quiet.stat('db', { bins: 2 }), v => v.toFixed(1)))
  assert.ok(Math.abs(r.names.value[0] - db) < 1e-4 && Math.abs(r.names.value[1] - lufs) < 1e-4, JSON.stringify(r.names.value))
  assert.ok(Math.abs(r.then.value[0] - (db + 1)) < 1e-4 && Math.abs(r.then.value[1] - lufs) < 1e-4, JSON.stringify(r.then.value))
  assert.deepEqual(r.sum.measured.map(m => [m.of, m.name]), [['out', 'db'], ['src', 'db']], 'each noted once, though it ran twice')
  assert.match(r.nope.error.message, /nope/)
  assert.deepEqual(r.edited.value, [+(db - 6).toFixed(2), +(lufs - 6).toFixed(2)])
  assert.match(r.random.error.message, /^out\.stat\('db', \{'at':[\d.]+,'d':0\.1\}\) is a promise: await it first, \(await out\.stat\(.*\)\)\.toFixed$/)
})

// deepfilter in the page as on Node: the same package and model (served from the cache Node keeps it in, as the page would
// fetch it from GitHub), run by the wasm build of the ONNX runtime the editor ships against onnxruntime-node. RNNoise,
// pure JS, its weights fetched beside its chunk, the same
test('engine: deepfilter and rnnoise run in the page, as on Node', async t => {
  const { MODEL } = await import('@audio/neural-denoise')
  const model = await readFile(join(process.env.AUDIO_NEURAL_CACHE || join(homedir(), '.cache', 'audiojs', 'neural'), createHash('sha256').update(MODEL).digest('hex'))).catch(() => null)
  if (!model) return t.skip('no DeepFilterNet3 model cached: run audio deepfilter once on Node')
  await page.route(MODEL, route => route.fulfill({ body: model, headers: { 'access-control-allow-origin': '*' } }))
  let seed = 1
  const noise = () => (seed = (seed * 16807) % 2147483647) / 2147483647 - .5
  const voice = vowel(t => 140 + 20 * Math.sin(2 * Math.PI * 3 * t), 1.5, 1, RATE).map(x => .3 * x + .02 * noise())
  const [df, rn] = await engine([`audio('in.wav').deepfilter()`, `audio('in.wav').rnnoise()`], { 'in.wav': [voice] })
  for (const [r, name] of [[df, 'deepfilter'], [rn, 'rnnoise']]) {
    assert.equal(r.error, undefined, `${name}: ${r.error?.message}`)
    const expected = (await audio.from([voice], { sampleRate: RATE })[name]().read())[0], got = r.output.channels[0]
    assert.equal(got.length, expected.length, name)
    let e = 0, d = 0
    for (let i = 0; i < got.length; i++) { e += expected[i] ** 2; d += (got[i] - expected[i]) ** 2 }
    assert.ok(10 * Math.log10(e / d) > 40, `${name}: ${(10 * Math.log10(e / d)).toFixed(1)} dB from Node's`)
  }
})

// Vocos in the page (onnxruntime-web's wasm), as on Node (onnxruntime-node): the phase it predicts follows the float
// rounding of each runtime, so the two are held to each other by their log-mel spectra, as the package holds its output
// to PyTorch's. Its model served from where export.py leaves it, given by `weights` until it is hosted
test('engine: vocos runs in the page, as on Node', async t => {
  const { MODEL, mel } = await import('@audio/neural-vocode').catch(() => ({}))
  const file = join(process.env.AUDIO_NEURAL_CACHE || join(homedir(), '.cache', 'audiojs', 'neural'), 'vocos', 'vocos.fp16.onnx')
  const model = mel && await readFile(file).catch(() => null)
  if (!model) return t.skip('no Vocos model: @audio/neural-vocode\'s scripts/export.py writes it')
  const url = MODEL?.href ?? 'https://vocos.test/vocos.fp16.onnx'
  await page.route(url, route => route.fulfill({ body: model, headers: { 'access-control-allow-origin': '*' } }))
  let seed = 5
  const noise = () => (seed = (seed * 16807) % 2147483647) / 2147483647 - .5
  const voice = vowel(t => 140 + 20 * Math.sin(2 * Math.PI * 3 * t), 1.5, 1, RATE).map(x => .3 * x + .002 * noise())
  const [r] = await engine([`audio('in.wav').vocos({ weights: '${url}' })`], { 'in.wav': [voice] })
  assert.equal(r.error, undefined, r.error?.message)
  const node = (await audio.from([voice], { sampleRate: RATE }).vocos({ weights: file }).read())[0], got = r.output.channels[0]
  assert.equal(got.length, node.length)
  // mean |log-mel difference| at 24 kHz, dB, over the cells within 60 dB of Node's peak
  const { default: resample } = await import('@audio/resample-sinc'), at24 = x => resample(x, { from: RATE, to: 24000 })
  const A = mel(at24(got)), B = mel(at24(node)), peak = Math.max(...B.data)
  let s = 0, k = 0
  for (let i = 0; i < B.data.length; i++) if (B.data[i] > peak - 60 * Math.LN10 / 20) s += Math.abs(A.data[i] - B.data[i]), k++
  assert.ok(s / k * 20 / Math.LN10 < 0.5, `${(s / k * 20 / Math.LN10).toFixed(3)} dB of log mel from Node's`)
})

// dereverb's model in the page, from its hosted revision (served here from the cache Node keeps it in), as on Node: the
// page once asked for opts.weights, the model not hosted. The music guard off, the model alone compared
test('engine: dereverb reads its hosted model in the page, as on Node', { timeout: 300000 }, async t => {
  const { models, REVISIONS } = await import('@audio/neural-separate'), p = models['dereverb-room']
  if (!REVISIONS['dereverb-room']) return t.skip('dereverb-room not hosted in the installed @audio/neural-separate')
  const model = await readFile(join(process.env.AUDIO_NEURAL_CACHE || join(homedir(), '.cache', 'audiojs', 'neural'), 'dereverb-room', p.file)).catch(() => null)
  if (!model) return t.skip('no dereverb-room cached: run audio dereverb once on Node')
  await page.route(`https://huggingface.co/${p.repo}/resolve/${REVISIONS['dereverb-room']}/${p.file}`, route => route.fulfill({ body: model, headers: { 'access-control-allow-origin': '*' } }))
  let seed = 7
  const noise = () => (seed = (seed * 16807) % 2147483647) / 2147483647 - .5
  const voice = vowel(t => 140 + 20 * Math.sin(2 * Math.PI * 3 * t), 1.5, 1, RATE).map(x => .3 * x + .002 * noise())
  const [r] = await engine([`audio('in.wav').dereverb({ music: 'enhance' })`], { 'in.wav': [voice] })
  assert.equal(r.error, undefined, r.error?.message)
  const node = (await audio.from([voice], { sampleRate: RATE }).dereverb({ music: 'enhance' }).read())[0], got = r.output.channels[0]
  assert.equal(got.length, node.length)
  let e = 0, d = 0
  for (let i = 0; i < got.length; i++) { e += node[i] ** 2; d += (got[i] - node[i]) ** 2 }
  assert.ok(10 * Math.log10(e / d) > 30, `${(10 * Math.log10(e / d)).toFixed(1)} dB from Node's`)
})

// The voice split to a track of its own (code.js voiceTrack) in the page, by SCNet-large here (the split's mechanics are
// the model's own: headless Chromium has no GPU for the RoFormer the page uses): its voice on it, the rest left on the
// first, so their mix is the sound as it was (the hosted model served from the cache Node keeps it in)
test('engine: the voice split to a track of its own, the rest left, sounds as before', async t => {
  const { models, REVISIONS } = await import('@audio/neural-separate'), p = models['scnet-large']
  const model = await readFile(join(process.env.AUDIO_NEURAL_CACHE || join(homedir(), '.cache', 'audiojs', 'neural'), 'scnet-large', p.file)).catch(() => null)
  if (!model) return t.skip('no SCNet-large cached: run audio rebalance once on Node')
  await page.route(`https://huggingface.co/${p.repo}/resolve/${REVISIONS['scnet-large']}/${p.file}`, route => route.fulfill({ body: model, headers: { 'access-control-allow-origin': '*' } }))
  let seed = 3
  const noise = () => (seed = (seed * 16807) % 2147483647) / 2147483647 - .5
  const sung = vowel(t => 220 + 30 * Math.sin(2 * Math.PI * 5 * t), 2, 1, RATE)
  const x = [0, 1].map(c => sung.map((v, i) => .3 * v + .15 * Math.sin(2 * Math.PI * (110 + 55 * c) * i / RATE) + .02 * noise()))
  const [split] = await engine([voiceTrack(`audio('x.wav')`, 'scnet-large').code], { 'x.wav': x })
  assert.equal(split.error, undefined, split.error?.message)
  assert.deepEqual(split.output.tracks.map(t => t.name), ['x', 'voice'])
  let e = 0, d = 0
  for (let c = 0; c < 2; c++) for (let i = 0; i < x[c].length; i++) { e += x[c][i] ** 2; d += (split.output.channels[c][i] - x[c][i]) ** 2 }
  assert.ok(10 * Math.log10(e / d) > 90, `the mix, ${(10 * Math.log10(e / d)).toFixed(1)} dB from the sound`)
})

// Four stems to four tracks (code.js stemTracks) in the page, by SCNet-large: the voice, the bass, the drums each on a
// track of their own, the rest left on the first, so their mix is the sound as it was
test('engine: four stems to four tracks sound as before', async t => {
  const { models, REVISIONS } = await import('@audio/neural-separate'), p = models['scnet-large']
  const model = await readFile(join(process.env.AUDIO_NEURAL_CACHE || join(homedir(), '.cache', 'audiojs', 'neural'), 'scnet-large', p.file)).catch(() => null)
  if (!model) return t.skip('no SCNet-large cached: run audio rebalance once on Node')
  await page.route(`https://huggingface.co/${p.repo}/resolve/${REVISIONS['scnet-large']}/${p.file}`, route => route.fulfill({ body: model, headers: { 'access-control-allow-origin': '*' } }))
  const sung = vowel(t => 220 + 30 * Math.sin(2 * Math.PI * 5 * t), 2, 1, RATE)
  const x = [0, 1].map(c => sung.map((v, i) => .3 * v + .15 * Math.sin(2 * Math.PI * (55 + 27.5 * c) * i / RATE) + .1 * (i % 11025 < 400 ? Math.sin(i * i / 4e5) : 0)))
  const [split] = await engine([stemTracks(`audio('x.wav')`).code], { 'x.wav': x })
  assert.equal(split.error, undefined, split.error?.message)
  assert.deepEqual(split.output.tracks.map(t => t.name), ['x', 'voice', 'bass', 'drums'])
  let e = 0, d = 0
  for (let c = 0; c < 2; c++) for (let i = 0; i < x[c].length; i++) { e += x[c][i] ** 2; d += (split.output.channels[c][i] - x[c][i]) ** 2 }
  assert.ok(10 * Math.log10(e / d) > 90, `the mix, ${(10 * Math.log10(e / d)).toFixed(1)} dB from the sound`)
})

// A master (code.js master): the output is its value, the tracks' sum through its own steps, each track a lane, it the
// last; a key read by name keeps its track (the bed ducked under the voice)
test('engine: a master is the output, the tracks\' sum through its steps, a lane of its own', async () => {
  const v = vowel(() => 180, 2, 1, RATE), bed = Float32Array.from({ length: 3 * RATE }, (_, i) => .2 * Math.sin(2 * Math.PI * 3000 * i / RATE))
  const script = `let voice = audio('v.wav')\n\nlet bed = audio('m.wav')\n  .ducker({ key: voice, range: -15 })\n\nvoice.clone().mix(bed)\n  .gain(-6)`
  const [r] = await engine([script], { 'v.wav': [v], 'm.wav': [bed] })
  assert.equal(r.error, undefined, r.error?.message)
  assert.deepEqual(r.output.tracks.map(t => t.name), ['voice', 'bed', 'master'])
  const a = audio.from([v], { sampleRate: RATE }), want = (await a.clone().mix(audio.from([bed], { sampleRate: RATE }).ducker({ key: a, range: -15 })).gain(-6).read())[0]
  const got = r.output.channels[0]
  assert.equal(got.length, want.length, 'as long as the track it copies')
  let e = 0, d = 0
  for (let i = 0; i < want.length; i++) { e += want[i] ** 2; d += (got[i] - want[i]) ** 2 }
  assert.ok(10 * Math.log10(e / d) > 60, `${(10 * Math.log10(e / d)).toFixed(1)} dB from Node's`)
})

test('engine: save() marks exports and export encodes them', async () => {
  await page.goto(origin + '/blank.html')
  const result = await page.evaluate(async () => {
    const { default: engine } = await import('/playground/engine.js'), { prepare } = await import('/playground/code.js')
    const e = engine(new URL('/playground/dist/worker.js', location.href))
    await e.file('a.wav', { channels: [Float32Array.from({ length: 4800 }, (_, i) => .5 * Math.sin(i / 10))], sampleRate: 48000 })
    const run = await e.run(prepare(`audio('a.wav').gain(-6).save('quiet.wav')`))
    const { files } = await e.export({ format: 'mp3', name: 'ignored' })
    return { saves: run.saves, files: files.map(f => ({ name: f.name, type: f.type, bytes: [...f.bytes] })) }
  })
  assert.deepEqual(result.saves, ['quiet.wav'])
  assert.equal(result.files.length, 1)
  assert.equal(result.files[0].name, 'quiet.wav')
  const pcm = await audio(new Uint8Array(result.files[0].bytes)).read()
  assert.equal(pcm[0].length, 4800)
  assert.ok(Math.abs(peakDb(pcm) - (20 * Math.log10(.5) - 6)) < .05)
})

// Runs go one at a time: one asked for while another runs waits, and a newer one asked for meanwhile replaces it. A
// script that runs takes over from an older output still streaming, which hears it was skipped.
test('engine: a run asked for while another runs waits; a newer one replaces it, which resolves skipped', async () => {
  await page.goto(origin + '/blank.html')
  const results = await page.evaluate(async () => {
    const { default: engine } = await import('/playground/engine.js'), { prepare } = await import('/playground/code.js')
    const e = engine(new URL('/playground/dist/worker.js', location.href))
    const runs = [1, 2, 3].map(seconds => e.render(prepare(`audio.from(${seconds})`)))
    return (await Promise.all(runs)).map(r => r.skipped ? 'skipped' : r.output.duration)
  })
  assert.ok(results[0] === 1 || results[0] === 'skipped', String(results[0]))
  assert.deepEqual(results.slice(1), ['skipped', 3])
})

// Each tab's newest run streams, another tab's beside it: a tab left as its output renders, its model's pass still
// running, renders on while the tab shown runs its scripts, and Stop there stops only its own (worker.js live)
test('engine: a tab left as it renders renders on, another tab running and stopping beside it', async () => {
  const x = Float32Array.from({ length: 2 * RATE }, (_, i) => .3 * Math.sin(2 * Math.PI * 330 * i / RATE))
  await page.goto(origin + '/blank.html')
  const r = await page.evaluate(async channel => {
    const { default: engine } = await import('/playground/engine.js'), { prepare } = await import('/playground/code.js')
    const e = engine(new URL('/playground/dist/worker.js', location.href))
    let restarts = 0
    e.onrestart = () => restarts++
    await e.file('n.wav', { channels: [Float32Array.from(channel)], sampleRate: 48000 })
    // a pass of 1.5 s, giving way as a model on the GPU does; a step slow on every block, giving way between them
    const SLOW = `audio.op('slow', { params: ['k'], prepare: () => new Promise(done => setTimeout(done, 1500)), process: (input, output) => input.forEach((x, c) => output[c].set(x)) })\n`
    const LAG = `audio.op('lag', { process: (input, output) => { const t = performance.now(); while (performance.now() - t < 4); input.forEach((x, c) => output[c].set(x)) } })\n`
    const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
    const events = []
    e.tab = 1
    const left = e.render(prepare(SLOW + `audio('n.wav').slow(1)`)).then(o => { events.push('left'); return o })
    await sleep(300)
    // the other tab shown: its runs, one after another, each its own output
    e.tab = 2
    const first = await e.render(prepare(`audio('n.wav').gain(-6)`))
    const second = await e.render(prepare(`audio('n.wav').gain(-12)`))
    events.push('shown')
    // and one stopped as it renders: the tab left goes on
    const stopping = e.render(prepare(LAG + `audio('n.wav').lag()`))
    await sleep(200)
    const replaced = await e.stop(), stopped = await stopping
    const done = await left
    const n = o => o.output?.channels[0].length ?? null
    return { events, restarts, replaced, left: n(done), skipped: !!done.skipped, first: n(first), second: n(second), stopped: n(stopped) }
  }, [...x])
  assert.deepEqual(r.events, ['shown', 'left'], 'the tab shown runs while the one left renders')
  assert.equal(r.skipped, false, 'the tab left is not skipped')
  assert.equal(r.left, 2 * RATE, 'the tab left renders whole')
  assert.equal(r.first, 2 * RATE)
  assert.equal(r.second, 2 * RATE)
  assert.equal(r.stopped, null, 'Stop stops the tab shown')
  assert.equal(r.replaced, false, 'nor is the worker replaced')
  assert.equal(r.restarts, 0)
})

test('engine: plugin parameters come from their manifests', async () => {
  await page.goto(origin + '/blank.html')
  const params = await page.evaluate(async () => {
    const { default: engine } = await import('/playground/engine.js')
    return engine(new URL('/playground/dist/worker.js', location.href)).describe('compressor')
  })
  const { compressor } = await import('@audio/dynamics-compressor/audio')
  assert.deepEqual(params, JSON.parse(JSON.stringify(compressor.params)))
})

// ── The page ───────────────────────────────────────────────────

// One microphone, many handles (an arming and the take it became, a hover's): a handle let go stops only the take it took
test('sources: a microphone handle let go stops only its own take', async () => {
  await open()
  const [during, after] = await page.evaluate(async () => {
    const { microphone } = await import(new URL('/playground/sources.js', location.href).href)
    const a = await microphone(), b = await microphone()
    let n = 0
    b.take(() => n++)
    a.cancel()
    await new Promise(r => setTimeout(r, 300))
    const during = n
    b.stop()
    await new Promise(r => setTimeout(r, 200))
    return [during, n - during]
  })
  assert.ok(during > 0, `the take goes on after another handle let go: ${during} blocks`)
  assert.equal(after, 0, 'and stops with its own')
})

// A Mac's WebKit opens the microphone through a voice processor it lets go 3 s on (sources.js VPIO): low till then, then
// nothing a tenth of a second, then as it is; and nothing a moment as it starts, too. Here the same, made up: a tone at
// 0.05, nothing 120 ms at 0.4 s, at 0.05 again till 3 s, nothing 150 ms, then at 0.5. The microphone is ready once it
// comes back the second time, no sooner: a take's first block is at 0.5. Elsewhere (Chromium as it is here) it is ready
// as it opens, the other tests' takes
test('sources: on a Mac\'s WebKit, the microphone ready once its voice processor lets go, no sooner', async () => {
  await page.addInitScript(() => {
    for (const [k, v] of Object.entries({ vendor: 'Apple Computer, Inc.', platform: 'MacIntel', maxTouchPoints: 0 })) Object.defineProperty(Navigator.prototype, k, { configurable: true, get: () => v })
    navigator.mediaDevices.getUserMedia = async () => {
      const c = new AudioContext(), tone = new OscillatorNode(c, { frequency: 440 }), level = new GainNode(c, { gain: .05 }), out = c.createMediaStreamDestination()
      await c.resume()
      const t = c.currentTime
      level.gain.setValueAtTime(0, t + .4).setValueAtTime(.05, t + .52).setValueAtTime(0, t + 3).setValueAtTime(.5, t + 3.15)
      tone.connect(level).connect(out)
      tone.start()
      return out.stream
    }
  })
  await open()
  const { waited, first, least, again } = await page.evaluate(async () => {
    const { microphone } = await import(new URL('/playground/sources.js', location.href).href)
    const t0 = performance.now(), mic = await microphone(), waited = performance.now() - t0, peaks = []
    mic.take(([x]) => peaks.push(Math.max(...x.map(Math.abs))))
    await new Promise(r => setTimeout(r, 300))
    mic.stop()
    const t1 = performance.now()
    ;(await microphone()).cancel()
    return { waited, first: peaks[0], least: Math.min(...peaks), again: performance.now() - t1 }
  })
  assert.ok(waited > 3100 && waited < 4900, `ready ${waited.toFixed(0)} ms on: once it came back the second time`)
  assert.ok(first > .4 && least > .4, `the take as it is from its first block: ${first}, the least ${least}`)
  assert.ok(again < 200, `kept, the next take's ready at once: ${again.toFixed(0)} ms`)
})

// Where no silence comes (a device the voice processor leaves alone), ready SETTLE (5 s) on, no later
test('sources: on a Mac\'s WebKit, a microphone that never falls silent is ready 5 s on', async () => {
  await page.addInitScript(() => {
    for (const [k, v] of Object.entries({ vendor: 'Apple Computer, Inc.', platform: 'MacIntel', maxTouchPoints: 0 })) Object.defineProperty(Navigator.prototype, k, { configurable: true, get: () => v })
    navigator.mediaDevices.getUserMedia = async () => {
      const c = new AudioContext(), tone = new OscillatorNode(c, { frequency: 440 }), out = c.createMediaStreamDestination()
      await c.resume()
      tone.connect(out)
      tone.start()
      return out.stream
    }
  })
  await open()
  const waited = await page.evaluate(async () => {
    const { microphone } = await import(new URL('/playground/sources.js', location.href).href)
    const t0 = performance.now()
    ;(await microphone()).cancel()
    return performance.now() - t0
  })
  assert.ok(waited > 4900 && waited < 7000, `ready ${waited.toFixed(0)} ms on`)
})

// sources.js settling, block by block (128 samples): silence before any sound is none (the device starting); one under
// GAP (2048 samples) is none; one of GAP, then GAP of sound on end, is, not a block sooner; a dropout after it starts the
// count of sound again. Where it is done, the samples in by then, or null
test('sources: settling is done once a run of silence after sound has given way to sound GAP samples on end', async () => {
  await open()
  const at = await page.evaluate(async () => {
    const { settling } = await import(new URL('/playground/sources.js', location.href).href)
    const run = (...parts) => {
      let n = 0, done = null
      const s = settling(() => { done ??= n })
      for (const [v, k] of parts) for (let i = 0; i < k; i += 128) { n += 128; s(new Float32Array(128).fill(v)) }
      return done
    }
    // a silence ending in the input's first `soon` samples none: here 4096, a gap ending at 3072, none, one at 7168, one
    const soon = (...parts) => { let n = 0, done = null; const s = settling(() => { done ??= n }, 4096); for (const [v, k] of parts) for (let i = 0; i < k; i += 128) { n += 128; s(new Float32Array(128).fill(v)) } return done }
    return {
      early: soon([.1, 1024], [0, 2048], [.1, 2048], [0, 2048], [.1, 2048]),
      leading: run([0, 8192], [.1, 8192]),
      short: run([.1, 1024], [0, 1920], [.1, 8192]),
      exact: run([.1, 1024], [0, 2048], [.1, 2048]),
      shy: run([.1, 1024], [0, 2048], [.1, 1920]),
      again: run([.1, 1024], [0, 4096], [.1, 1024], [0, 256], [.1, 2048])
    }
  })
  assert.deepEqual(at, { early: 1024 + 2048 + 2048 + 2048 + 2048, leading: null, short: null, exact: 1024 + 2048 + 2048, shy: null, again: 1024 + 4096 + 1024 + 256 + 2048 })
})

// A plugin's op is a method before its module loads (at the first read): a script marking after it runs, its mark where it
// was put. Its output kept past a reload (renders kept), shown by a worker that never rendered it, has its edits wired
// for a step's where() all the same (an edit turned off over a range, step({ at, d }), reads it), a step before the
// plugin's too, whose stages never load it
test('engine: a plugin not loaded yet: a mark after it, and where() on its output kept from before', async () => {
  const script = `audio('a.wav')\n  .gain(-1)\n  .deesser()\n  .mark(0.5, 'm')`
  await page.goto(origin + '/blank.html')
  const got = await page.evaluate(async ({ a, script }) => {
    const { default: engine } = await import('/playground/engine.js'), { prepare, stages } = await import('/playground/code.js')
    const url = new URL('/playground/dist/worker.js', location.href), data = () => ({ channels: [Float32Array.from(a)], sampleRate: 48000 })
    const first = engine(url)
    await first.file('a.wav', data())
    const made = await first.render(prepare(script))
    if (!made.output) throw new Error(made.error?.message ?? 'no output')
    // kept in the browser's files whole, as for the next visit
    const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('audio-editor-renders', { create: true })
    const kept = async () => { for await (const h of dir.values()) if (h.kind === 'file' && !h.name.endsWith('.crswap') && (await h.getFile()).size > 4 * a.length) return true; return false }
    for (let n = 0; n < 100 && !await kept(); n++) await new Promise(r => setTimeout(r, 50))
    // another worker, as a reload starts one: its output the one kept, nothing rendered, the plugin not loaded
    const next = engine(url)
    await next.file('a.wav', data())
    const again = await next.render(prepare(script))
    const loaded = (await next.evaluate(prepare(`!!audio.op('deesser')`))).value
    // its parts between markers exported, then where(): each wires it alone
    const parts = await next.export({ format: 'wav', name: 'a', parts: true })
    const steps = stages(script).map(s => ({ call: s.call, on: s.on, keeps: s.on, before: prepare(s.before), after: s.after && prepare(s.after) }))
    const where = await next.evaluate({ ...prepare(`step(0).where(0.75)`), steps })
    return { markers: made.output.markers, again: again.output?.markers, loaded, parts: parts.error?.message ?? parts.files.map(f => f.name), where: where.error?.message ?? where.value }
  }, { a: [...sine(1, 220, .3)], script })
  assert.deepEqual(got.markers, [{ time: .5, label: 'm' }], 'the mark where it was put')
  assert.deepEqual(got.again, got.markers, 'kept')
  assert.equal(got.loaded, false, 'the plugin not loaded by showing it')
  assert.deepEqual(got.parts, ['a-01.wav', 'a-m.wav'], 'split at its marker')
  assert.equal(got.where, .75, 'where() on it, the plugin loaded for it')
})

// A file all come while the output has nothing yet (a model runs over all of it, deepfilter's): the engine says so,
// between the file's last piece and the output's first, and the page says it renders, not that it decodes
test('engine: a file all come, the output still nothing, is said between them', async t => {
  const { MODEL } = await import('@audio/neural-denoise')
  const model = await readFile(join(process.env.AUDIO_NEURAL_CACHE || join(homedir(), '.cache', 'audiojs', 'neural'), createHash('sha256').update(MODEL).digest('hex'))).catch(() => null)
  if (!model) return t.skip('no DeepFilterNet3 model cached: run audio deepfilter once on Node')
  await page.route(MODEL, route => route.fulfill({ body: model, headers: { 'access-control-allow-origin': '*' } }))
  await page.goto(origin + '/blank.html')
  const events = await page.evaluate(async url => {
    const { default: engine } = await import('/playground/engine.js'), { prepare } = await import('/playground/code.js')
    const e = engine(new URL('/playground/dist/worker.js', location.href)), seen = []
    await new Promise(done => e.run(prepare(`audio('${url}').deepfilter()`), {
      loading: () => seen.push('loading'), arrived: () => seen.push('arrived'), chunk: () => seen.push('chunk'),
      done: () => { seen.push('done'); done() }, error: m => { seen.push(m.error.message); done() }
    }))
    return seen
  }, `${origin}/slow/test/fixture.wav`)
  assert.deepEqual([...new Set(events)], ['loading', 'arrived', 'chunk', 'done'])
  assert.equal(events.filter(e => e === 'arrived').length, 1)
  assert.ok(events.lastIndexOf('loading') < events.indexOf('arrived') && events.indexOf('arrived') < events.indexOf('chunk'))
})

// What a model made of its input is kept in the browser by its key (core.js memo), read back whole, the model not run again
test('engine: what a model made is kept in the browser and read back', async () => {
  const [r] = await engine([`const k = 'test:' + Math.random(), x = [Float32Array.of(1, 2, 3), Float32Array.of(4, 5, 6)]
await audio.memo.set(k, x)
const y = await audio.memo.get(k)
;[y.length, ...y.map(c => [...c]), await audio.memo.get(k + '?')]`])
  assert.equal(r.error, undefined, r.error?.message)
  assert.equal(r.value, '[2, [1, 2, 3], [4, 5, 6], null]')
})

// Renders kept (worker.js): the steps of an output are kept once it has come, so a step bypassed, or one changed after a
// slow one (omlsa(), most of a second over 12 s), renders from the step before it, in a fraction of the chain's time; the
// chain's start chosen alone is kept already. The samples are those of the whole script rendered afresh
test('engine: a step bypassed or changed renders from the step before it, as the whole script would', async () => {
  const x = [0, 1].map(c => Float32Array.from({ length: 12 * RATE }, (_, i) => .3 * Math.sin(2 * Math.PI * (220 + c) * i / RATE) + .05 * Math.sin(i * i)))
  const chain = `audio('x.wav').omlsa().gain(-2).spectral([1000, 4000], { at: 10, d: 0.5 })`
  const later = [`audio('x.wav').omlsa().spectral([1000, 4000], { at: 10, d: 0.5 })`, `audio('x.wav').omlsa().gain(-3).spectral([1000, 4000], { at: 10, d: 0.5 })`, `audio('x.wav').omlsa()`]
  await page.goto(origin + '/blank.html')
  const r = await page.evaluate(async ({ channels, chain, later }) => {
    const { default: engine } = await import('/playground/engine.js'), { prepare } = await import('/playground/code.js')
    const e = engine(new URL('/playground/dist/worker.js', location.href))
    await e.file('x.wav', { channels: channels.map(c => Float32Array.from(c)), sampleRate: 48000 })
    const time = async code => { const t = performance.now(), r = await e.render(prepare(code)); if (!r.output) throw new Error(r.error?.message); return { ms: performance.now() - t, out: r.output.channels } }
    const first = await time(chain)
    // the steps kept while nothing else runs
    await new Promise(r => setTimeout(r, 3000))
    const got = []
    for (const code of later) got.push(await time(code))
    return { slow: first.ms, got: got.map(g => ({ ms: g.ms, out: g.out.map(c => [...c.subarray(0, 48000 * 12)]) })) }
  }, { channels: x.map(c => [...c]), chain, later })
  for (const [i, code] of later.entries()) {
    assert.ok(r.got[i].ms < r.slow / 4, `${code}: ${r.got[i].ms.toFixed(0)} ms, the chain ${r.slow.toFixed(0)} ms`)
    const [whole] = await engine([code], { 'x.wav': x }), want = whole.output.channels
    const diff = Math.max(...r.got[i].out.map((c, k) => c.reduce((m, v, j) => Math.max(m, Math.abs(v - want[k][j])), 0)))
    assert.ok(diff < 1e-6, `${code}: ${diff}`)
  }
})

// An output is kept in the browser by its script and the files it opens: another worker (a reload) has it at once, the
// same samples; the file changed (another size), it renders again
test('engine: an output is kept for the next visit by its script and its files', async () => {
  await page.goto(origin + '/blank.html')
  const r = await page.evaluate(async () => {
    const { default: engine } = await import('/playground/engine.js'), { prepare } = await import('/playground/code.js')
    const tone = n => ({ channels: [Float32Array.from({ length: n }, (_, i) => .5 * Math.sin(i / 9))], sampleRate: 48000 })
    const code = `audio('t.wav').omlsa().gain(-1)`, run = async file => {
      const e = engine(new URL('/playground/dist/worker.js', location.href))
      await e.file('t.wav', file)
      const seen = [], reply = await new Promise(done => e.run(prepare(code), { doing: m => seen.push(m), done: m => done(m), error: m => done(m) }))
      // kept as it is written, a moment after
      await new Promise(r => setTimeout(r, 500))
      e.stop()
      return { seen, duration: reply.duration }
    }
    const first = await run(tone(20 * 48000))
    const again = await run(tone(20 * 48000)), other = await run(tone(19 * 48000))
    return { first, again, other }
  })
  assert.deepEqual(r.first.seen[0]?.steps, ['omlsa', 'gain'], 'made: its steps applied')
  assert.equal(r.again.duration, 20)
  assert.deepEqual(r.again.seen, [], 'kept: nothing applied')
  assert.equal(r.other.duration, 19, 'another file, made again')
  assert.deepEqual(r.other.seen[0], { id: r.other.seen[0].id, event: 'doing', steps: ['omlsa', 'gain'] })
})

// A long output kept: its picture the one it rendered with, read back after a reload; one made where the page drew no
// picture keeps none (none made in the background, where it would hold up the next render), and draws it on its return
test('engine: a long output kept comes back after a reload as the picture it was made with, or one drawn then', async () => {
  await page.goto(origin + '/blank.html')
  const r = await page.evaluate(async () => {
    const { default: engine } = await import('/playground/engine.js'), { prepare } = await import('/playground/code.js')
    const file = { channels: [Float32Array.from({ length: 5 * 48000 }, (_, i) => .5 * Math.sin(i / 9) * Math.sin(i / 20000))], sampleRate: 48000 }
    const run = async (code, peaks) => {
      const e = engine(new URL('/playground/dist/worker.js', location.href))
      e.peaks = peaks
      await e.file('t.wav', file)
      const parts = [], seen = []
      const done = await new Promise(resolve => e.run(prepare(code), { doing: m => seen.push(m), chunk: m => parts.push(m), done: resolve, error: resolve }))
      // kept as it is written, a moment after
      await new Promise(resolve => setTimeout(resolve, 500))
      e.stop()
      const flat = f => parts.flatMap(p => p.peaks ? [...f(p)] : [])
      return { made: seen.length > 0, long: done.long, leaves: flat(p => p.peaks[0]), levels: flat(p => p.spectra.levels[0]), grid: parts.find(p => p.spectra)?.spectra && (({ size, hop }) => ({ size, hop }))(parts.find(p => p.spectra).spectra) }
    }
    // the same sound by two scripts (kept apart by their text)
    const unique = Math.random().toFixed(6), drawn = `audio('t.wav').gain(-${unique})`, plain = `audio('t.wav')\n  .gain(-${unique})`
    return { drawn: await run(drawn, 48000), back: await run(drawn, 48000), plain: await run(plain, 0), drawnThen: await run(plain, 48000) }
  })
  assert.ok(r.drawn.made && r.drawn.long && r.drawn.leaves.length && r.drawn.levels.length, 'made, drawn as its picture')
  assert.ok(!r.back.made && r.back.long, 'kept: nothing applied')
  assert.deepEqual([r.back.leaves, r.back.levels, r.back.grid], [r.drawn.leaves, r.drawn.levels, r.drawn.grid], 'the picture it was made with')
  assert.ok(r.plain.made && !r.plain.leaves.length, 'no picture drawn: samples')
  assert.ok(!r.drawnThen.made && r.drawnThen.long, 'kept, no picture with it: nothing applied')
  assert.deepEqual([r.drawnThen.leaves, r.drawnThen.levels, r.drawnThen.grid], [r.drawn.leaves, r.drawn.levels, r.drawn.grid], 'its picture drawn on its return, as it would have been made')
})

// A page holding `peaks` channel samples gets an output longer than that as its picture (worker.js feed), as it renders
// and kept: each leaf its 256 samples' own [min, max, Σx², count], the last one short, each piece from a leaf's start;
// each spectra column each bin's mean power over its Hann frames of 2048 (40 ms at 48 kHz) every 1024 samples,
// as a byte (dB + 150) · 1.6, within a byte of a textbook FFT in doubles. One it holds comes as samples. samples() reads
// any range, clamped to the output; null once a newer one replaced it. The long one arrives over a slow connection (a
// second of it), so it renders as it comes, in pieces; made in memory, it may render whole before a second piece is due
test('engine: past what the page holds, an output comes as its peaks and spectra, each its samples\' own', async () => {
  const n = 96096
  made.set('long.wav', await wavBytes([Float32Array.from({ length: n }, (_, i) => Math.sin(i / 17) * (.2 + i / n)), Float32Array.from({ length: n }, (_, i) => Math.sin(i / 900) / 3)]))
  await page.goto(origin + '/blank.html')
  const r = await page.evaluate(async slow => {
    const { default: engine } = await import('/playground/engine.js'), { prepare } = await import('/playground/code.js')
    const e = engine(new URL('/playground/dist/worker.js', location.href))
    e.peaks = 48000
    const run = code => new Promise(done => { const parts = []; e.run(prepare(code), { chunk: m => parts.push(m), done: m => done({ parts, done: m }), error: m => done({ error: m.error?.message }) }) })
    // the leaves of each channel, as they should be
    const want = x => Array.from({ length: Math.ceil(x.length / 256) }, (_, j) => {
      let lo = Infinity, hi = -Infinity, q = 0, n = 0
      for (let i = j * 256; i < Math.min(x.length, j * 256 + 256); i++) { const y = x[i]; if (y < lo) lo = y; if (y > hi) hi = y; q += y * y; n++ }
      return [lo, hi, Math.fround(q), n]
    }).flat()
    // the spectra of each channel, as they should be: a textbook radix-2 FFT in doubles, each column its frames' mean power
    // (gl-spectrogram's combine)
    const fft = (re, im) => {
      const n = re.length
      for (let i = 1, j = 0; i < n; i++) { let b = n >> 1; for (; j & b; b >>= 1) j ^= b; j ^= b; if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]] } }
      for (let len = 2; len <= n; len <<= 1) for (let i = 0; i < n; i += len) for (let k = 0; k < len / 2; k++) {
        const a = -2 * Math.PI * k / len, c = Math.cos(a), s = Math.sin(a), p = i + k, q = p + len / 2, vr = re[q] * c - im[q] * s, vi = re[q] * s + im[q] * c
        re[q] = re[p] - vr; im[q] = im[p] - vi; re[p] += vr; im[p] += vi
      }
    }
    const spectraOf = (x, N, hop) => {
      const bins = N / 2 + 1, cols = Math.ceil(x.length / hop), sum = new Float64Array(cols * bins), count = new Float64Array(cols)
      for (let t = N / 2; t - N / 2 < x.length; t += N / 2) {
        const o = Math.floor(t / hop)
        if (o >= cols) break
        const re = Float64Array.from({ length: N }, (_, i) => { const k = t - N / 2 + i; return k < x.length ? x[k] * (.5 - .5 * Math.cos(2 * Math.PI * i / N)) : 0 }), im = new Float64Array(N)
        fft(re, im)
        count[o]++
        for (let k = 0; k < bins; k++) sum[o * bins + k] += (re[k] ** 2 + im[k] ** 2) / (N / 4) ** 2
      }
      return Uint8Array.from(sum, (p, i) => (p /= count[Math.floor(i / bins)] || 1) > 0 ? Math.max(1, Math.min(255, Math.round((10 * Math.log10(p) + 150) * 1.6))) : 0)
    }
    const check = async ({ parts, done, error }) => {
      if (error) return { error }
      const n = Math.round(done.duration * done.sampleRate), pcm = await e.samples(done.id, 0, n)
      const leaves = pcm.map((_, c) => parts.flatMap(p => p.peaks ? [...p.peaks[c]] : []))
      const given = parts.find(p => p.spectra)?.spectra, levels = given && pcm.map((_, c) => parts.flatMap(p => p.spectra ? [...p.spectra.levels[c]] : []))
      const off = given ? Math.max(...pcm.map((x, c) => { const w = spectraOf(x, given.size, given.hop); return w.length === levels[c].length ? Math.max(...w.map((v, i) => Math.abs(v - levels[c][i]))) : Infinity })) : null
      let at = 0, aligned = true
      for (const p of parts) { if (p.peaks && p.at !== at) aligned = false; if (p.peaks) at += p.peaks[0].length / 4 * 256 }
      return {
        n, long: done.long, pieces: parts.length, kinds: [...new Set(parts.map(p => p.peaks ? 'peaks' : 'samples'))], aligned,
        exact: pcm.every((x, c) => JSON.stringify(leaves[c]) === JSON.stringify(want(x))),
        spectra: given && { size: given.size, hop: given.hop, off }, last: leaves[0].slice(-1)[0], id: done.id
      }
    }
    // files, so what they make is kept
    const tone = async (name, n) => { await e.file(name, { channels: [Float32Array.from({ length: n }, (_, i) => Math.sin(i / 17) * (.2 + i / n)), Float32Array.from({ length: n }, (_, i) => Math.sin(i / 900) / 3)], sampleRate: 48000 }); return `audio('${name}').gain(-1)` }
    const long = await check(await run(`audio('${slow}').gain(-1)`)), kept = await check(await run(`audio('${slow}').gain(-1)`))
    const edges = [[-10, 300], [96091, 96200], [10, 10]].map(([a, b]) => e.samples(kept.id, a, b).then(x => x?.map(c => c.length)))
    const even = await check(await run(await tone('even.wav', 25600))), short = await check(await run(`audio.from(t => Math.sin(t * 3000), { duration: .5, sampleRate: 48000 })`))
    return { long, kept, edges: await Promise.all(edges), even, short, gone: await e.samples(long.id, 0, 10) }
  }, `${origin}/slow/long.wav?ms=10`)
  made.delete('long.wav')
  assert.ok(r.long.long && r.long.kinds.join() === 'peaks' && r.long.pieces > 1, `rendered: as peaks, in ${r.long.pieces} pieces`)
  assert.ok(r.long.aligned && r.long.exact, 'each piece from where the last left off, each leaf its samples\' own')
  assert.equal(r.long.last, 96096 - 375 * 256, 'the last leaf holds what is left')
  assert.deepEqual(r.long.spectra, { size: 2048, hop: 2048, off: r.long.spectra.off }, 'spectra of 40 ms frames, a column each 2048 samples')
  assert.ok(r.long.spectra.off <= 1 && r.kept.spectra?.off <= 1 && r.even.spectra?.off <= 1, `spectra within a byte of the FFT in doubles: ${[r.long, r.kept, r.even].map(x => x.spectra?.off)}`)
  assert.ok(r.kept.long && r.kept.exact && r.kept.pieces === 1, 'kept: its leaves at once')
  assert.deepEqual(r.edges, [[300, 300], [5, 5], [0, 0]], 'samples() clamped to the output')
  assert.ok(r.even.long && r.even.exact && r.even.last === 256, 'a length of whole leaves: the last one whole')
  assert.ok(!r.short.long && r.short.kinds.join() === 'samples', 'within what the page holds: samples')
  assert.equal(r.gone, null, 'replaced: none')
})

// A ranged edit (a band taken out, a range made quieter) put in, turned off or set again, under steps that work frame by
// frame (formant(), more than a second over 15 s), renders again only around its range, over the last output
// (worker.js fragment): the samples the whole script makes afresh, in a fraction of its time
test('engine: a ranged edit under slow frame-by-frame steps renders again only around its range', async () => {
  const x = [0, 1].map(c => Float32Array.from({ length: 15 * RATE }, (_, i) => .3 * Math.sin(2 * Math.PI * (220 + c) * i / RATE) + .05 * Math.sin(i * i)))
  const chain = t => `audio('x.wav')${t}.formant(1.2).compressor()`
  const first = chain(''), later = [chain(`.gain(-6, { at: 6, d: 0.5 })`), chain(`.gain(-6, { at: 6, d: 0.5 }).spectral([1000, 4000], { at: 10, d: 0.5 })`), chain(`.spectral([1000, 4000], { at: 10, d: 0.5 })`)]
  await page.goto(origin + '/blank.html')
  const r = await page.evaluate(async ({ channels, first, later }) => {
    const { default: engine } = await import('/playground/engine.js'), { prepare } = await import('/playground/code.js')
    const e = engine(new URL('/playground/dist/worker.js', location.href))
    await e.file('x.wav', { channels: channels.map(c => Float32Array.from(c)), sampleRate: 48000 })
    const time = async code => { const t = performance.now(), r = await e.render(prepare(code)); if (!r.output) throw new Error(r.error?.message); return { ms: performance.now() - t, out: [...r.output.channels[0]] } }
    // made twice whole: the second, its steps' code loaded, is what a render takes
    await time(chain('.gain(-1)'))
    const slow = (await time(first)).ms, got = []
    for (const code of later) got.push(await time(code))
    return { slow, got }
    function chain(t) { return `audio('x.wav')${t}.formant(1.2).compressor()` }
  }, { channels: x.map(c => [...c]), first, later })
  for (const [i, code] of later.entries()) {
    // about a fifth of it here, more on a shared runner whose timings jump (a quarter ran out there once)
    assert.ok(r.got[i].ms < r.slow / 3, `${code}: ${r.got[i].ms.toFixed(0)} ms, the chain ${r.slow.toFixed(0)} ms`)
    const [whole] = await engine([code], { 'x.wav': x }), want = whole.output.channels[0]
    const diff = r.got[i].out.reduce((m, v, j) => Math.max(m, Math.abs(v - want[j])), 0)
    assert.ok(diff < 1e-6, `${code}: ${diff}`)
  }
})
