// Editor: npm run test:playground. The engine runs in a real browser worker; its output is compared with the library in Node,
// the command-line translation with the CLI itself. All requests stay local.
import { test, before, after, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { PerformanceObserver } from 'node:perf_hooks'
import { readFile, readdir, writeFile, mkdtemp, rm } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { homedir, tmpdir } from 'node:os'
import { dirname, extname, join, relative, resolve, sep } from 'node:path'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import wav from '@audio/encode-wav'
import audio from '../audio.js'
import { prepare, error, bare, chain, append, source, callAt, setArg, cli, groups, steps, dropStep, moveStep, moveLines, group, ungroup, renameGroup, turnOff, turnOn, tracks, focus, toTrack, voiceTrack, stemTracks, soundOf, written, addTrack, dropTrack, renameTrack, splitOf, master, addMaster, rollback, stages, sharing, residual, takes, carried, useTake, retake, addTake, dropTake, raise } from '../playground/code.js'
import { ops, guides, previews, SCALES } from '../playground/ops.js'
import { SCALES as NOTE_SCALES, snapMidi } from '@audio/note'
import { help, layout, layouts, texts } from '../playground/help.js'
import { boxed } from '../playground/heard.js'
import opIcons from '../playground/icons.js'
import clock from '../playground/time.js'
import { samples, RATE as SAMPLES } from '../playground/samples.js'
import { vowel } from './gen.js'
import recipes from '../playground/recipes.js'
import { cycle, trace, ballistics, spectra } from '../playground/meters.js'
import md from '../playground/markdown.js'
import doing, { measures, noted } from '../playground/doing.js'
import '../.site-build.js'

const root = fileURLToPath(new URL('..', import.meta.url)).replace(/\/$/, '')
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.wasm': 'application/wasm' }
let server, browser, page, origin, errors
// The page as a visitor left it on the chime's script, which a first visit opened on until it opened on an empty tab:
// what most tests start from. Stored only where nothing is, so a test's own storage, and the page's as it goes, stand
const CHIME = `audio('chime.wav')\n  .trim()\n  .normalize(-1)\n  .fade(0.02, 0.1)`
const chimeLeft = target => target.addInitScript(code => {
  if (location.pathname === '/playground/' && !new URLSearchParams(location.search).has('embed') && localStorage.getItem('audio-repl') == null) localStorage.setItem('audio-repl', JSON.stringify({ code }))
}, CHIME)

before(async () => {
  server = createServer(async (req, res) => {
    const url = req.url.split('?')[0]
    if (url === '/blank.html') { res.writeHead(200, { 'content-type': 'text/html' }).end('<!doctype html><title>blank</title>'); return }
    // a file over a slow connection: 8 KB every 120 ms, its length said up front
    if (url.startsWith('/slow/')) {
      const data = await readFile(resolve(root, '.' + url.slice(5))), ms = +(req.url.match(/[?&]ms=(\d+)/)?.[1] ?? 120)
      res.writeHead(200, { 'content-type': 'audio/wav', 'content-length': data.length })
      for (let i = 0; i < data.length; i += 8192) { res.write(data.subarray(i, i + 8192)); await new Promise(r => setTimeout(r, ms)) }
      res.end()
      return
    }
    const path = resolve(root, '.' + (url === '/' ? '/playground/' : url) + (url.endsWith('/') ? 'index.html' : ''))
    if (!path.startsWith(root + sep)) { res.writeHead(403).end(); return }
    // cross-origin isolated, as .site-serve.js serves it (sw.js stays out: a page reloaded under a test would lose it)
    // read before the head is sent: a file not there is a 404, not a head sent twice and a reply that never ends
    try { const body = await readFile(path); res.writeHead(200, { 'content-type': types[extname(path)] || 'application/octet-stream', 'cross-origin-opener-policy': 'same-origin', 'cross-origin-embedder-policy': 'credentialless' }).end(body) }
    catch { res.writeHead(404).end() }
  })
  await new Promise(r => server.listen(0, '127.0.0.1', r))
  origin = `http://127.0.0.1:${server.address().port}`
  // a fake microphone plays a tone, granted without asking
  browser = await chromium.launch({ args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] })
})
after(async () => { await browser?.close(); if (server) await new Promise(r => server.close(r)) })
beforeEach(async () => {
  page = await browser.newPage()
  await chimeLeft(page)
  // the page opens with its panel closed, the picture whole: the code is written through its panel (write), and a test of
  // a panel opens it
  await page.addInitScript(() => {
    // the script, its lines as the editor has them, the code panel open or not
    globalThis.scriptText = () => [...document.querySelectorAll('.cm-content .cm-line')].map(l => l.textContent).join('\n')
    // what is drawn over the sound as it shows: the reel's time row and marks (view.js marksOf: the time row's times, the
    // carets, the cues, the markers…) where the reel is, cut where the lanes end, under the overlay; a canvas the
    // overlay's size, its box the overlay's
    globalThis.__overlay = () => {
      const plot = document.querySelector('.plot'), o = plot.querySelector('canvas.overlay'), m = plot.querySelector('canvas.marks'), row = plot.querySelector('canvas.row'), k = o.width / o.clientWidth
      const shift = -new DOMMatrix(getComputedStyle(plot.querySelector('.reel')).transform).m41 * k, end = Math.round(parseFloat(getComputedStyle(plot).getPropertyValue('--end')) * k)
      const cv = Object.assign(document.createElement('canvas'), { width: o.width, height: o.height }), g = cv.getContext('2d')
      if (row?.width && row.height && o.width > end) g.drawImage(row, Math.round(shift), 0, o.width - end, row.height, 0, Math.round(row.offsetTop * k), o.width - end, row.height)
      if (m?.width && o.width > end) g.drawImage(m, Math.round(shift), 0, o.width - end, o.height, 0, 0, o.width - end, o.height)
      g.drawImage(o, 0, 0)
      Object.defineProperties(cv, { clientWidth: { value: o.clientWidth }, clientHeight: { value: o.clientHeight }, getBoundingClientRect: { value: () => o.getBoundingClientRect() } })
      return cv
    }
  })
  errors = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); if (/^(SCRUB|NEAR|POST|AWAIT)/.test(msg.text())) console.log(msg.text()) })
  await page.route('**/*', route => {
    if (route.request().url().startsWith(origin + '/')) return route.continue()
    errors.push(`External request: ${route.request().url()}`)
    return route.abort()
  })
})
afterEach(async () => { await page?.close(); assert.deepEqual(errors, []) })

const RATE = 48000
const sine = (seconds, frequency, amplitude = 1, rate = RATE) => Float32Array.from({ length: Math.round(seconds * rate) }, (_, i) => amplitude * Math.sin(2 * Math.PI * frequency * i / rate))
const peakDb = channels => 20 * Math.log10(Math.max(...channels.map(c => c.reduce((m, v) => Math.max(m, Math.abs(v)), 0))))
async function wavBytes(channels, sampleRate = RATE) {
  const encoder = await wav({ sampleRate, bitDepth: 32 })
  const head = encoder.encode(channels), tail = encoder.flush()
  return Buffer.concat([Buffer.from(head), Buffer.from(tail)])
}

// Runs scripts through the editor's own engine in the browser. `files` are { name: channels } or { name: bytes }.
async function engine(scripts, files = {}) {
  await page.goto(origin + '/blank.html')
  return page.evaluate(async ({ scripts, files }) => {
    const { default: engine } = await import('/playground/engine.js'), { prepare } = await import('/playground/code.js')
    const e = engine(new URL('/playground/dist/worker.js', location.href))
    for (const [name, data] of Object.entries(files))
      await e.file(name, data.bytes ? new Blob([new Uint8Array(data.bytes)]) : { channels: data.map(c => Float32Array.from(c)), sampleRate: 48000 })
    const out = []
    for (const code of scripts) {
      const r = await e.render(prepare(code))
      out.push({ ...r, output: r.output && { ...r.output, channels: r.output.channels.map(c => [...c]) } })
    }
    return out
  }, { scripts, files: Object.fromEntries(Object.entries(files).map(([k, v]) => [k, Buffer.isBuffer(v) ? { bytes: [...v] } : v.map(c => [...c])])) })
}

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

// What the agent does while it answers (doing.js), as the page's user would say it, from the call alone
test('doing: an agent\'s tool call said as the user would say it, only what the call names', () => {
  const time = t => `${t}s`, spec = k => ({ podcast: 'Apple Podcasts' })[k] ?? k
  const say = (tool, input) => doing(tool, input, { time, spec }).now
  assert.equal(say('state', {}), 'Reading the sound')
  assert.equal(say('measure', { code: "out.stat(['loudness', 'truepeak', 'lra'])" }), 'Measuring loudness, true peak, and loudness range')
  assert.equal(say('measure', { code: "out.stat('loudness', { bins: 35 })" }), 'Measuring loudness over time')
  assert.equal(say('measure', { code: "src.stat('dialog')" }), 'Measuring dialogue loudness of the original')
  assert.equal(say('measure', { code: 'out.silence({ threshold: -45 })' }), 'Measuring pauses')
  assert.equal(say('measure', { code: 'out.duration' }), 'Measuring', 'no stat named: no guess')
  assert.equal(say('look', { at: 1, d: 2 }), 'Looking at 1s–3s')
  assert.equal(say('look', {}), 'Looking at the picture')
  assert.equal(say('edit', { call: "normalize('podcast')" }), "Applying normalize('podcast')")
  assert.equal(say('edit', { call: "mark(12.5, 'hum')" }), 'Marking “hum” at 12.5s')
  assert.equal(say('edit', { call: "mark({ at: 2, d: 1.5 }, 'chorus')" }), 'Marking “chorus” 2s–3.5s')
  assert.equal(say('check', { spec: 'podcast' }), 'Checking against Apple Podcasts')
  assert.equal(say('play', { original: true, at: 4 }), 'Playing the original from 4s')
  assert.equal(say('select', { cursor: 0 }), 'Putting the caret at 0s')
  assert.equal(say('Bash', { command: 'ls ~/Downloads', description: 'List the downloads' }), 'List the downloads', 'the agent\'s own words for it')
  assert.equal(say('command_execution', { command: 'ffprobe a.wav\nmore' }), 'Running ffprobe a.wav')
  assert.equal(say('Read', { file_path: '/Users/me/voice.wav' }), 'Reading voice.wav')
  assert.equal(say('WebFetch', { url: 'not a url' }), 'Reading a page')
  assert.equal(say('measure'), 'Measuring', 'no input')
  assert.equal(say('mcp_unknown', {}), 'mcp_unknown', 'a tool it does not know, by its name')
  // once done, the same in the past
  assert.deepEqual(doing('measure', { code: "out.stat('lra')" }), { now: 'Measuring loudness range', then: 'Measured loudness range', show: null })
  assert.deepEqual(doing('edit', { call: "mark(1, 'breath')" }, { time }), { now: 'Marking “breath” at 1s', then: 'Marked “breath” at 1s', show: { caret: 1 } })
  assert.deepEqual(doing('undo', {}), { now: 'Undoing', then: 'Undid', show: null })
  assert.deepEqual(doing('Bash', { description: 'List the downloads' }), { now: 'List the downloads', then: 'List the downloads', show: null })
  // where on the sound it acted, to go to
  assert.deepEqual(doing('select', { at: 1, d: 2, low: 3000, high: 4000 }, { time }), { now: 'Selecting 1s–3s, 3kHz–4kHz', then: 'Selected 1s–3s, 3kHz–4kHz', show: { range: [1, 3], band: [3000, 4000] } })
  assert.deepEqual(doing('edit', { call: "normalize('podcast')" }).show, { edit: "normalize('podcast')" })
  assert.deepEqual(doing('scrub', { at: 1, to: 3 }, { time }), { now: 'Scrubbing 1s–3s', then: 'Scrubbed 1s–3s', show: { caret: 3 } })
  assert.equal(doing('step', { index: 2, to: 0 }).then, 'Moved edit 3 to 1')
  assert.equal(doing('step', { index: 0, on: false }).then, 'Turned off edit 1')
  assert.equal(doing('open', { path: '/Users/me/voice.wav' }).then, 'Opened voice.wav')
})

// What a call came to, said beside its step: values in their units, a series by its span, an edit by the output after it
test('doing: what a call came to, from what the page answered', () => {
  assert.equal(noted('measure', { code: "out.stat(['loudness', 'truepeak'])" }, [-21.123, -0.913]), '−21.12LUFS, −0.91dBTP')
  assert.equal(noted('measure', { code: "out.stat('loudness', { bins: 4 })" }, [-20, -21, '-Infinity', -19]), '4 values, −21\u00a0to\u00a0−19LUFS', 'silence left out of the span, the span held together')
  assert.equal(noted('measure', { code: "out.stat('db')" }, '-Infinity'), '−∞dBFS')
  assert.equal(noted('measure', { code: 'out.duration' }, 6.524), '6.52')
  assert.equal(noted('measure', { code: 'out.silence()' }, [{ at: 1, duration: .5 }]), '[{"at":1,"duration":0.5}]')
  assert.equal(noted('measure', { code: 'x' }, 'a'.repeat(80)).length, 60, 'long, cut')
  assert.equal(noted('measure', { code: 'x' }, undefined), '')
  assert.equal(noted('edit', { call: 'gain(-3)' }, { ok: true, duration: 6, loudness: -16.04, peak: -1 }), 'now −16.04LUFS, peak −1dBFS')
  assert.equal(noted('edit', { call: 'nope()' }, { ok: false, problem: 'nope is not a function' }), 'nope is not a function')
  assert.equal(noted('check', { spec: 'podcast' }, { pass: false, rules: [{ name: 'Loudness', pass: false }, { name: 'True peak', pass: true }] }), 'fails loudness')
  assert.equal(noted('check', { spec: 'podcast' }, { pass: true, rules: [] }), 'passes')
  assert.equal(noted('play', {}, { playing: true }), '')
  assert.equal(noted('state', {}, { duration: 6.4, sampleRate: 44100, channels: 2 }), '6.4s, 2 ch, 44.1kHz')
  assert.equal(noted('state', {}, { duration: 0, sampleRate: null, channels: null, problem: null }), 'no sound open', 'a new tab: no sound, not "null ch"')
  assert.equal(noted('state', {}, { duration: 0, sampleRate: null, channels: null, problem: 'nope is not defined' }), 'nope is not defined', 'a script that fails: why')
  assert.equal(noted('measure', { code: 'x' }, { nf: -49.3 }, [{ of: 'out', name: 'noisefloor', opts: {}, value: -49.30758 }]), '−49.31dBFS', 'one stat noted: its value, whatever the answer')
  assert.equal(noted('measure', { code: 'x' }, { a: 1, b: 2 }, [{ name: 'db', value: -1 }, { name: 'lra', value: 4 }]), '', 'several: the table says them')
})

// What a measure measured, stat by stat as the page noted it (worker.js evaluate), as rows: its name, where it was taken,
// its value as the page writes it. Peak and RMS are sample values (stats.js), their dBFS is db
test('doing: what a measure measured, stat by stat, its rows', () => {
  const time = t => `${t}s`, row = (name, value, opts = {}, of = 'out') => measures([{ of, name, opts, value }], { time })[0]
  assert.deepEqual(row('loudness', -27.20224), { name: 'Loudness', after: '−27.2LUFS' })
  assert.deepEqual(row('truepeak', -14.659), { name: 'True peak', after: '−14.66dBTP' })
  assert.deepEqual(row('noisefloor', -51.57, {}, 'src'), { name: 'Noise floor, original', after: '−51.57dBFS' })
  assert.deepEqual(row('peak', .30049), { name: 'Peak', after: '0.3' })
  assert.deepEqual(row('correlation', 1), { name: 'Stereo correlation', after: '1' })
  assert.deepEqual(row('centroid', 2079.7), { name: 'Brightness', after: '2.08kHz' })
  assert.deepEqual(row('loudness', [-20, -21, '-Infinity', -19, 'NaN'], { bins: 5 }), { name: 'Loudness over time', after: '5 values, −21\u00a0to\u00a0−19LUFS' })
  assert.deepEqual(row('db', -3, { at: 1, d: 2, channel: 0 }), { name: 'Peak, 1s–3s, channel 1', after: '−3dBFS' })
  assert.deepEqual(row('spectrum', Array(64).fill(-40), { bins: 64 }), { name: 'Spectrum', after: '64 bands' })
  assert.deepEqual(row('silence', [{ at: 1, duration: .5 }, { at: 3, duration: 1.25 }]), { name: 'Pauses', after: '2, the longest 1.25s' })
  assert.deepEqual(row('silence', []), { name: 'Pauses', after: 'none' })
  assert.deepEqual(row('clipping', []), { name: 'Clipping', after: 'none' })
  assert.deepEqual(row('onsets', [0, 1.5]), { name: 'Onsets', after: '2' })
  assert.deepEqual(row('key', { tonic: 9, mode: 'minor', label: 'Am' }), { name: 'Key', after: 'Am' })
  assert.deepEqual(row('detect', { bpm: 120, beats: [0, .5] }), { name: 'Tempo', after: '120 BPM' })
  assert.deepEqual(row('replaygain', { gain: -6.0876, lufs: -11.9 }), { name: 'ReplayGain', after: '−6.09dB' })
  assert.deepEqual(row('notes', [{ midi: 64, note: 'E4' }, { midi: 57, note: 'A3' }]), { name: 'Notes', after: '2, A3 to E4' })
  assert.deepEqual(row('melody', { times: [0, 1, 2], f0: [220, 0, 440], voiced: [true, false, true] }), { name: 'Melody', after: '220Hz to 440Hz' })
  assert.deepEqual(measures(undefined), [])
})

// The agent's words (markdown.js): what it writes as GitHub renders it, every character escaped, links only to the web
test('markdown: an agent\'s answer as GitHub shows it, nothing in it markup of its own', () => {
  assert.equal(md('**To meet the spec:** raise it 5 dB. `normalize(\'podcast\')` keeps\nthe peak.'), '<p><strong>To meet the spec:</strong> raise it 5 dB. <code>normalize(&#39;podcast&#39;)</code> keeps\nthe peak.</p>')
  assert.equal(md('| | Value |\n|---|--:|\n| Loudness | −21.1 LUFS |'), '<div class="md-table"><table><thead><tr><th></th><th class="right">Value</th></tr></thead><tbody><tr><td>Loudness</td><td class="right">−21.1 LUFS</td></tr></tbody></table></div>')
  assert.equal(md('1. **One**\n   - a\n   - b\n2. Two'), '<ol><li><strong>One</strong><ul><li>a</li><li>b</li></ul></li><li>Two</li></ol>')
  assert.equal(md('- a\n\n- b'), '<ul><li><p>a</p></li><li><p>b</p></li></ul>', 'loose')
  assert.equal(md('## Add\n\n> said\n\n---'), '<h2>Add</h2><blockquote><p>said</p></blockquote><hr>')
  assert.equal(md('```js\nx < 1 && y\n```'), '<pre><code>x &lt; 1 &amp;&amp; y</code></pre>')
  assert.equal(md('```\nstill coming'), '<pre><code>still coming</code></pre>', 'an open fence, as it streams in')
  assert.equal(md('snake_case and 5 * 3 * 2, ~~gone~~ \\*kept\\*'), '<p>snake_case and 5 * 3 * 2, <del>gone</del> *kept*</p>')
  assert.equal(md('<img src=x onerror=alert(1)> [x](javascript:alert(1)) [y](https://a.dev/?q=1&r=2)'), '<p>&lt;img src=x onerror=alert(1)&gt; x) <a href="https://a.dev/?q=1&amp;r=2" target="_blank" rel="noopener noreferrer">y</a></p>')
  assert.equal(md('see https://audiojs.dev/editor.'), '<p>see <a href="https://audiojs.dev/editor" target="_blank" rel="noopener noreferrer">https://audiojs.dev/editor</a>.</p>')
  assert.equal(md('line  \nbreak'), '<p>line<br>break</p>')
})

// Layers, as the edits panel moves them: a step before or after another, set in as that one is, so into a group or out of
// one; a group moved whole among the steps outside groups; steps made a group under a comment of its name, the group
// unmade or named anew; a step put in right after another (append's `after`); a step turned off and on by its comment
// marks alone, its text where it was
test('code: layers moved by their lines, made a group, unmade, named; a step put in after another; turned off by its marks', () => {
  const apply = (code, change) => [change].flat().sort((p, q) => q.from - p.from).reduce((c, x) => c.slice(0, x.from) + (x.insert ?? '') + c.slice(x.to ?? x.from), code)
  const a = `audio('a.wav')\n  .gain(-3)\n  .reverse()\n  .highpass(80)\n  .fade(1)`, at = (code, name) => { const s = steps(code).find(s => s.name === name).call; return { from: s.from, to: s.to } }
  const g = apply(a, group(a, 1, 2, 'Montage'))
  assert.equal(g, `audio('a.wav')\n  .gain(-3)\n  // Montage\n    .reverse()\n    .highpass(80)\n  .fade(1)`)
  assert.deepEqual(groups(g).map(x => x.name), ['Montage'])
  assert.equal(group(g, 0, 1), null, 'not across a group')
  const [m] = groups(g)
  assert.equal(apply(g, moveLines(g, at(g, 'fade'), m, { into: true })), `audio('a.wav')\n  .gain(-3)\n  // Montage\n    .fade(1)\n    .reverse()\n    .highpass(80)`, 'into the group, first')
  assert.equal(apply(g, moveLines(g, at(g, 'gain'), at(g, 'highpass'), { after: true })), `audio('a.wav')\n  // Montage\n    .reverse()\n    .highpass(80)\n    .gain(-3)\n  .fade(1)`, 'set in as the step it lands by')
  assert.equal(apply(g, moveLines(g, at(g, 'reverse'), at(g, 'fade'), { after: true })), `audio('a.wav')\n  .gain(-3)\n  // Montage\n    .highpass(80)\n  .fade(1)\n  .reverse()`, 'out of it')
  assert.equal(apply(g, moveLines(g, m, at(g, 'fade'), { after: true })), `audio('a.wav')\n  .gain(-3)\n  .fade(1)\n  // Montage\n    .reverse()\n    .highpass(80)`, 'a group whole')
  assert.equal(moveLines(g, m, at(g, 'reverse')), null, 'not into itself')
  assert.equal(apply(g, ungroup(g, m)), a)
  assert.equal(apply(g, renameGroup(g, m, ' Cuts ')), g.replace('Montage', 'Cuts'))
  assert.equal(renameGroup(g, m, '  '), null)
  assert.equal(apply(a, append(a, 'gain(-6)', at(a, 'gain').to)), `audio('a.wav')\n  .gain(-3)\n  .gain(-6)\n  .reverse()\n  .highpass(80)\n  .fade(1)`)
  const b = `audio('a.wav').gain(-3).fade(1)`
  assert.equal(apply(b, append(b, 'trim()', b.indexOf('.fade'))), `audio('a.wav').gain(-3).trim().fade(1)`, 'on one line')
  const c = `audio('a.wav').gain(-3).fade(1)`, off = apply(c, turnOff(c, chain(c).calls[0]))
  assert.equal(off, `audio('a.wav')/* .gain(-3) */.fade(1)`)
  assert.equal(apply(off, turnOn(off, steps(off)[0].call)), c)
  // one turned off, set where it stands, in its comment: the script runs as it did
  const d = `audio('a.wav')\n  // .gain(-3)\n  .fade(1)`, set = apply(d, setArg(steps(d)[0].call, 0, -6))
  assert.equal(set, `audio('a.wav')\n  // .gain(-6)\n  .fade(1)`)
  assert.equal(apply(off, setArg(steps(off)[0].call, 0, -6)), `audio('a.wav')/* .gain(-6) */.fade(1)`)
  const e = `audio('a.wav')/* .gate({ threshold: -40 }) */`
  assert.equal(apply(e, setArg(steps(e)[0].call, 'threshold', -50)), `audio('a.wav')/* .gate({ threshold: -50 }) */`)
  const f = `audio('a.wav')\n  // .fade()`
  assert.equal(apply(f, setArg(steps(f)[0].call, 0, .5)), `audio('a.wav')\n  // .fade(0.5)`, 'its first setting')
  assert.equal(bare(set), bare(d), 'comments aside, the same script')
  assert.notEqual(bare(c), bare(off), 'a step turned off is another')
  assert.equal(bare(`a /* b\nc */ d // e`), `a  \n  d  `, 'its line breaks kept')
})

// Takes: recordings of one place, a write() of each side by side, one heard, the others turned off. One recorded where
// another went in joins it, after it, heard, the one heard before turned off, the steps after them kept after them; one
// turned on is heard alone. A write of a sound made in the script, or with more than where it goes, is no take
test('code: takes of one place side by side, one heard; another recorded there joins them; one turned on, the others off', () => {
  const apply = (code, change) => [change].flat().sort((p, q) => q.from - p.from).reduce((c, x) => c.slice(0, x.from) + (x.insert ?? '') + c.slice(x.to ?? x.from), code)
  const at2 = name => `write(audio('${name}'), { at: 2 })`
  const a = `audio('a.wav')\n  .gain(-3)\n  .write(audio('take.wav'), { at: 2 })\n  .fade(1)`
  assert.deepEqual(takes(a).map(r => [r.at, r.list.map(x => [x.name, x.on])]), [[2, [['take.wav', true]]]], 'a recording alone, a take of one')
  const b = apply(a, retake(a, at2('take-2.wav')))
  assert.equal(b, `audio('a.wav')\n  .gain(-3)\n  // .write(audio('take.wav'), { at: 2 })\n  .write(audio('take-2.wav'), { at: 2 })\n  .fade(1)`)
  const c = apply(b, retake(b, at2('take-3.wav')))
  assert.deepEqual(takes(c).map(r => r.list.map(x => [x.name, x.on])), [[['take.wav', false], ['take-2.wav', false], ['take-3.wav', true]]])
  assert.equal(retake(c, `write(audio('x.wav'), { at: 3 })`), null, 'another place: none there')
  assert.equal(retake(c, `gain(-1)`), null, 'no recording')
  const [run] = takes(c), first = apply(c, useTake(c, run.list[0].from))
  assert.equal(first, `audio('a.wav')\n  .gain(-3)\n  .write(audio('take.wav'), { at: 2 })\n  // .write(audio('take-2.wav'), { at: 2 })\n  // .write(audio('take-3.wav'), { at: 2 })\n  .fade(1)`)
  assert.equal(useTake(first, takes(first)[0].list[0].from), null, 'heard alone already')
  assert.equal(useTake(first, steps(first).find(s => s.name === 'fade').call.from), null, 'no take')
  // on one line: turned off within it, the new one after the sound
  const d = `audio('a.wav').write(audio('take.wav'), { at: 2 })`, e = apply(d, retake(d, at2('take-2.wav')))
  assert.deepEqual(takes(e).map(r => r.list.map(x => [x.name, x.on])), [[['take-2.wav', true], ['take.wav', false]]])
  // no takes: a sound made in the script, a write with more than its place and its length, two places apart
  assert.deepEqual(takes(`audio('a.wav')\n  .write(audio('b.wav').gain(-3), { at: 2 })\n  .write(audio('c.wav'), { at: 2, channel: 1 })`), [])
  assert.deepEqual(takes(`audio('a.wav')\n  .write(audio('b.wav'), { at: 2 })\n  .write(audio('c.wav'), { at: 3 })`).map(r => r.list.length), [1, 1])
  // nothing to read or join: no script, a group of calls, a take in the steps a copy shares (its own part's alone join)
  assert.deepEqual([takes(''), useTake('', 0), retake('', at2('t.wav')), retake(a, { name: 'Group', calls: ['gain(-1)'] })], [[], null, null, null])
  const g = `let take = audio('a.wav')\n  .write(audio('take.wav'), { at: 2 })\n\nlet copy = take.clone()\n  .gain(-1)`
  assert.equal(retake(g, at2('take-2.wav')), null, 'not into the steps it shares')
  assert.deepEqual(takes(g).map(r => r.part), [0])
})

// An empty take added to a place (+ on its numbers): silence as long as the place, heard, the others off; no second while
// it is there; a recording there goes into it, heard. The take heard deleted, the one before heard in its place
test('code: an empty take added, recorded into; the one heard deleted, the one before heard', () => {
  const apply = (code, change) => [change].flat().sort((p, q) => q.from - p.from).reduce((c, x) => c.slice(0, x.from) + (x.insert ?? '') + c.slice(x.to ?? x.from), code)
  const a = `audio('a.wav')\n  // .write(audio('take.wav'), { at: 2 })\n  .write(audio('take-2.wav'), { at: 2 })`
  const b = apply(a, addTake(a, takes(a)[0], 1.5))
  assert.equal(b, `audio('a.wav')\n  // .write(audio('take.wav'), { at: 2 })\n  // .write(audio('take-2.wav'), { at: 2 })\n  .write(audio.from(1.5), { at: 2 })`)
  assert.deepEqual(takes(b)[0].list.map(x => [x.name, x.on, x.empty ?? null]), [['take.wav', false, null], ['take-2.wav', false, null], ['', true, 1.5]])
  assert.equal(addTake(b, takes(b)[0], 1.5), null, 'one empty take at a time')
  // recorded into, the empty one heard or not
  // (the place's length kept: what is not recorded of it is silence, not what was there before)
  const filled = `audio('a.wav')\n  // .write(audio('take.wav'), { at: 2 })\n  // .write(audio('take-2.wav'), { at: 2 })\n  .write(audio('take-3.wav'), { at: 2, d: 1.5 })`
  assert.equal(apply(b, retake(b, `write(audio('take-3.wav'), { at: 2 })`)), filled)
  const off = apply(b, useTake(b, takes(b)[0].list[0].from))
  assert.equal(apply(off, retake(off, `write(audio('take-3.wav'), { at: 2 })`)), filled)
  // the one heard deleted, the one before heard; the first deleted, the next
  assert.deepEqual(takes(filled)[0].list.map(x => x.d ?? null), [null, null, 1.5])
  // another recorded there writes over the place too
  assert.match(apply(filled, retake(filled, `write(audio('take-4.wav'), { at: 2 })`)), /\.write\(audio\('take-4\.wav'\), \{ at: 2, d: 1\.5 \}\)$/)
  assert.equal(apply(filled, dropTake(filled, takes(filled)[0].list[2].from)), `audio('a.wav')\n  // .write(audio('take.wav'), { at: 2 })\n  .write(audio('take-2.wav'), { at: 2 })`)
  const first = apply(filled, useTake(filled, takes(filled)[0].list[0].from))
  assert.equal(apply(first, dropTake(first, takes(first)[0].list[0].from)), `audio('a.wav')\n  .write(audio('take-2.wav'), { at: 2 })\n  // .write(audio('take-3.wav'), { at: 2, d: 1.5 })`)
  assert.equal(dropTake(a, 999), null, 'no take there')
})

// Takes under a write after them over their place (a recording at another caret): one more recorded there brings them
// over it, the newest heard (it once stayed under it, unheard, the picture going back to what covered it as it stopped);
// past writes alone, which sound the same in either order where they cover nothing of each other's place, those that
// don't cover it (as long as their files are, `len`; one of no length known may) left after them
test('code: takes under a later write brought over it as one more is recorded there, past writes alone', () => {
  const apply = (code, change) => [change].flat().sort((p, q) => q.from - p.from).reduce((c, x) => c.slice(0, x.from) + (x.insert ?? '') + c.slice(x.to ?? x.from), code)
  const at2 = name => `write(audio('${name}'), { at: 2 })`, len = name => ({ 'take.wav': 3, 'take-2.wav': 3, 'over.wav': 2, 'far.wav': 1 })[name]
  // over.wav, 3 to 5 s, over their place, 2 to 5: they go after it, as they stood, the new one heard; the fade after
  // them still after them
  const a = `audio('a.wav')\n  .write(audio('take.wav'), { at: 2 })\n  .write(audio('over.wav'), { at: 3 })\n  .fade(1)`
  assert.equal(apply(a, retake(a, at2('take-2.wav'), len)), `audio('a.wav')\n  .write(audio('over.wav'), { at: 3 })\n  // .write(audio('take.wav'), { at: 2 })\n  .write(audio('take-2.wav'), { at: 2 })\n  .fade(1)`)
  // far.wav, 6 to 7 s, past it: left after them, the takes where they stand; of no length known, it may cover it
  const b = `audio('a.wav')\n  .write(audio('take.wav'), { at: 2 })\n  .write(audio('far.wav'), { at: 6 })`
  assert.equal(apply(b, retake(b, at2('take-2.wav'), len)), `audio('a.wav')\n  // .write(audio('take.wav'), { at: 2 })\n  .write(audio('take-2.wav'), { at: 2 })\n  .write(audio('far.wav'), { at: 6 })`)
  assert.equal(apply(b, retake(b, at2('take-2.wav'))), `audio('a.wav')\n  .write(audio('far.wav'), { at: 6 })\n  // .write(audio('take.wav'), { at: 2 })\n  .write(audio('take-2.wav'), { at: 2 })`)
  // a step that changes the sound between: past it, it would no longer change them; none (the page writes the
  // recording on top, a take of its own)
  const c = `audio('a.wav')\n  .write(audio('take.wav'), { at: 2 })\n  .gain(-3)\n  .write(audio('over.wav'), { at: 3 })`
  assert.equal(retake(c, at2('take-2.wav'), len), null)
  assert.equal(raise(c, takes(c)[0], len), null)
  // as they stand, turned off or heard, past a step turned off; nothing over them, as it is
  const d = `audio('a.wav')\n  // .write(audio('take.wav'), { at: 2 })\n  .write(audio('take-2.wav'), { at: 2 })\n  // .gain(-3)\n  .write(audio('over.wav'), { at: 3 })`
  assert.equal(raise(d, takes(d)[0], len), `audio('a.wav')\n  // .gain(-3)\n  .write(audio('over.wav'), { at: 3 })\n  // .write(audio('take.wav'), { at: 2 })\n  .write(audio('take-2.wav'), { at: 2 })`)
  assert.equal(raise(b, takes(b)[0], len), b)
  // an empty take added there brought over it too, heard, for the next recording to go into
  assert.equal(apply(d, addTake(d, takes(d)[0], 3, len)), `audio('a.wav')\n  // .gain(-3)\n  .write(audio('over.wav'), { at: 3 })\n  // .write(audio('take.wav'), { at: 2 })\n  // .write(audio('take-2.wav'), { at: 2 })\n  .write(audio.from(3), { at: 2 })`)
})

// Where takes' place is once the steps after them are done: where it was past a step that keeps time (a fade, a marker,
// a delete past its end, a step turned off); a delete before it moves it back by as much, one over its end cuts it
// short, a crop moves it to the crop's start, a pad on by the silence before; gone with a delete of all of it; unknown
// past a step whose time the script alone doesn't say (a trim)
test('code: takes\' place carried through the steps after them', () => {
  const a = `audio('a.wav')\n  // .write(audio('take.wav'), { at: 2 })\n  .write(audio('take-2.wav'), { at: 2 })`
  const at = tail => { const code = `${a}\n  ${tail}`; return carried(code, takes(code)[0], [2, 5]) }
  assert.deepEqual(carried(a, takes(a)[0], [2, 5]), [2, 5])
  for (const tail of ['.fade(1)', '.mark(1, \'A\')', '.remove({ at: 7, d: 2 })', '.remove({ at: 5, d: 1 })', '// .trim()', '.gain(-3, { at: 0, d: 1 })']) assert.deepEqual(at(tail), [2, 5], tail)
  assert.deepEqual(at('.remove({ at: 0.5, d: 1 })'), [1, 4], 'a delete before it')
  assert.deepEqual(at('.cut({ at: 0, d: 0.5, xfade: 0.01 })'), [1.5, 4.5], 'a cut before it, crossfaded: as long as without')
  assert.deepEqual(at('.remove({ at: 4, d: 2 })'), [2, 4], 'a delete over its end')
  assert.deepEqual(at('.remove(1, 2)'), [1, 3], 'its place and length as arguments')
  assert.deepEqual(at('.crop({ at: 1, d: 10 })'), [1, 4])
  assert.deepEqual(at('.pad(1, 2)'), [3, 6])
  // a delete ending where it starts, or starting where it ends, at the boundary: moved back whole, or left as it is
  assert.deepEqual([at('.remove({ at: 1, d: 1 })'), at('.remove({ at: 5, d: 1 })')], [[1, 4], [2, 5]])
  assert.deepEqual([at('.remove({ at: 1, d: 6 })'), at('.crop({ at: 0, d: 1 })'), at('.trim()'), at('.speed(2)'), at('.remove({ at: start, d: 1 })'), at('.remove({ at: -1, d: 1 })'), at('.remove({ at: 1 })'), at('.pad({ before: 1 })')], [null, null, null, null, null, null, null, null], 'gone, or not for the script to say')
  // one after another, each where the one before left it
  assert.deepEqual(at('.remove({ at: 9, d: 1 })\n  .remove({ at: 0, d: 1 })\n  .pad(0.5)'), [1.5, 4.5])
})

// The chain's edits as an agent acts on them (step): listed in order, those turned off among them; one taken away,
// on its line or within one; one moved, before or after another, a group's comment staying where it stands
test('code: the edits listed in order, one taken away or moved where it stands', () => {
  const apply = (code, change) => [change].flat().sort((p, q) => q.from - p.from).reduce((c, x) => c.slice(0, x.from) + (x.insert ?? '') + c.slice(x.to ?? x.from), code)
  const a = `audio('a.wav')\n  .trim()\n  // .gain(-3)\n  .normalize(-1)\n  .fade(0.1)`
  assert.deepEqual(steps(a).map(s => [s.text, s.on]), [['.trim()', true], ['.gain(-3)', false], ['.normalize(-1)', true], ['.fade(0.1)', true]])
  assert.equal(apply(a, moveStep(a, 0, 3)), `audio('a.wav')\n  // .gain(-3)\n  .normalize(-1)\n  .fade(0.1)\n  .trim()`, 'to the end')
  assert.equal(apply(a, moveStep(a, 3, 0)), `audio('a.wav')\n  .fade(0.1)\n  .trim()\n  // .gain(-3)\n  .normalize(-1)`, 'to the start')
  assert.equal(apply(a, moveStep(a, 2, 1)), `audio('a.wav')\n  .trim()\n  .normalize(-1)\n  // .gain(-3)\n  .fade(0.1)`, 'before one turned off')
  assert.equal(moveStep(a, 1, 0), null, 'one turned off stays put')
  assert.equal(moveStep(a, 0, 0), null)
  assert.equal(moveStep(a, 0, 9), null)
  assert.equal(apply(a, dropStep(a, 1)), `audio('a.wav')\n  .trim()\n  .normalize(-1)\n  .fade(0.1)`, 'one turned off, taken away')
  assert.equal(apply(a, dropStep(a, 0)), `audio('a.wav')\n  // .gain(-3)\n  .normalize(-1)\n  .fade(0.1)`)
  const b = `audio('a.wav').trim().normalize(-1)`
  assert.equal(apply(b, moveStep(b, 1, 0)), `audio('a.wav').normalize(-1).trim()`, 'on one line')
  assert.equal(apply(b, dropStep(b, 0)), `audio('a.wav').normalize(-1)`)
  assert.deepEqual(steps(`audio.from(3).noise({ color: 'pink' }).gain(-3)`).map(s => s.text), [".noise({ color: 'pink' })", '.gain(-3)'], 'audio.from() makes the sound: no edit')
  const c = `audio('a.wav')\n  // Vinyl\n  .declick()\n  .decrackle()`
  assert.equal(apply(c, moveStep(c, 1, 0)), `audio('a.wav')\n  // Vinyl\n  .decrackle()\n  .declick()`, "a group's name stays over it")
  assert.deepEqual([steps(''), dropStep('', 0), moveStep('x', 0, 1)], [[], null, null], 'no chain')
})

// Tracks: sounds declared side by side that nothing else reads, the last of them the script's last statement, returned by
// name; one edited at a time (focus), its chain the one the edits list and every edit joins, the others kept as they are.
// A range moved to a track of its own: cropped and put back at its time; silence where it was. The voice split to one:
// the model's voice there, the rest here. The steps the track had are both parts' then, written once: its sound so far
// declared apart (`chimeTake`), each part a copy of it, its chain those shared steps and then its own
test('code: tracks are the sounds declared that nothing reads, edited one at a time; a range moved to one of its own', () => {
  const apply = (code, change) => code.slice(0, change.from) + change.insert + code.slice(change.to ?? change.from)
  const names = code => tracks(code).map(t => t.name)
  assert.deepEqual(names(`let a = audio('a.wav')\nlet b = audio('b.wav')`), ['a', 'b'])
  assert.deepEqual(names(`let a = audio.from(3).noise()\nconst b = await audio('b.wav').trim()`), ['a', 'b'], 'made, awaited')
  for (const code of [
    `let a = audio('a.wav')`,
    `let a = audio('a.wav')\nlet b = audio('b.wav')\na.mix(b)`,
    `let noise = audio('n.wav')\nlet v = audio('v.wav').denoise({ noise })`,
    `let a = audio('a.wav')\nlet b = a.clone().gain(-3)`,
    `let a = audio('a.wav')\nlet b = audio('b.wav')\nconsole.log(1)`
  ]) assert.deepEqual(names(code), [], code)
  assert.match(prepare(`let a = audio('a.wav')\nlet b = audio('b.wav')`).code, /;return __out\(\{ a, b \}, true\)$/)
  // the sound moved out of: named for its file, declared; the piece under it
  const one = `audio('chime.wav')\n  .trim()\n  .normalize(-1)`, made = toTrack(one, { at: '0.5', d: '0.25' })
  assert.equal(made.name, 'chime2')
  assert.equal(made.code, `let chimeTake = audio('chime.wav')\n  .trim()\n  .normalize(-1)\n\nlet chime = chimeTake.clone()\n  .gain(-Infinity, { at: 0.5, d: 0.25 })\n\nlet chime2 = chimeTake.clone()\n  .crop({ at: 0.5, d: 0.25 })\n  .pad(0.5, 0)`)
  assert.equal(toTrack(`audio('chime.wav')`, { at: '0', d: '1' }).code, `let chime = audio('chime.wav')\n  .gain(-Infinity, { at: 0, d: 1 })\n\nlet chime2 = audio('chime.wav')\n  .crop({ at: 0, d: 1 })`, 'from the start: no pad')
  assert.equal(toTrack(`let a = audio('a.wav')\na.gain(-3)`, { at: '0', d: '1' }), null, 'a chain on a name: no sound of its own')
  // the voice split to a track of its own: the model's voice there, the rest here, the chain as it stood under both
  const sung = voiceTrack(one)
  assert.equal(sung.name, 'voice')
  assert.equal(sung.code, `let chimeTake = audio('chime.wav')\n  .trim()\n  .normalize(-1)\n\nlet chime = chimeTake.clone()\n  .vocals('remove', { model: 'mel-roformer' })\n\nlet voice = chimeTake.clone()\n  .vocals({ model: 'mel-roformer' })`)
  assert.deepEqual(names(voiceTrack(sung.code).code), ['chime', 'voice', 'voice2'], 'again: the voice, the last, split, named on')
  assert.equal(voiceTrack(`let a = audio('a.wav')\na.gain(-3)`), null, 'a chain on a name: no sound of its own')
  // four stems to four tracks: the voice, the bass, the drums each alone, the rest (with the residual) here
  const solo = k => `rebalance(${[0, 1, 2, 3].map(i => i === k ? 0 : '-Infinity').join(', ')}, { residual: -Infinity })`, four = stemTracks(one)
  assert.equal(four.name, 'voice')
  assert.equal(four.code, `let chimeTake = audio('chime.wav')\n  .trim()\n  .normalize(-1)\n\nlet chime = chimeTake.clone()\n  .rebalance(-Infinity, -Infinity, -Infinity)\n\n${['voice', 'bass', 'drums'].map((n, k) => `let ${n} = chimeTake.clone()\n  .${solo(k)}`).join('\n\n')}`)
  assert.equal(stemTracks(`audio('a.wav')`).code, `let a = audio('a.wav')\n  .rebalance(-Infinity, -Infinity, -Infinity)\n\n${['voice', 'bass', 'drums'].map((n, k) => `let ${n} = audio('a.wav')\n  .${solo(k)}`).join('\n\n')}`, 'no steps: each from the file')
  assert.deepEqual(names(stemTracks(four.code).code), ['chime', 'voice', 'bass', 'drums', 'voice2', 'bass2', 'drums2'], 'again: the last split, named on')
  // a track's sound on one line, for another to line up with: its steps turned off left out, no name read, the sound it
  // copies written into it (a track declared before that sound reads it too)
  assert.equal(soundOf(sung.code, 'voice'), `audio('chime.wav').trim().normalize(-1).vocals({ model: 'mel-roformer' })`)
  assert.equal(soundOf(`let a = await audio('a .wav')\n  // .fade(1)\n  .gain(-3) /* .trim() */  .reverse()\n\nlet b = audio('b.wav')`, 'a'), `audio('a .wav').gain(-3).reverse()`)
  assert.equal(soundOf(sung.code, 'nothing'), null)
  // the sound the page edits, as another tab pastes a piece of it: its sinks (save, play) left out, a comment in one too,
  // the sound a copy starts from written into it; none without a chain
  assert.equal(written(`audio('a.wav')\n  .gain(-3) // louder\n  // .lowpass(200)\n  .fade(0.1)\n  .save('x.wav' /* here */)`), `audio('a.wav').gain(-3).fade(0.1)`)
  assert.equal(written(`let a = audio('a.wav').trim()\nlet b = a.clone().gain(-3).play()`), `audio('a.wav').trim().gain(-3)`)
  assert.equal(written(`audio('a.wav')`), `audio('a.wav')`)
  assert.equal(written(''), null)
  try {
    // the first edited: its steps, an edit joining it, rolled back with the other kept, a measure's stages of it alone
    focus('chime')
    const two = made.code
    assert.deepEqual(steps(two).map(s => [s.text, s.call.part]), [['.trim()', 0], ['.normalize(-1)', 0], ['.gain(-Infinity, { at: 0.5, d: 0.25 })', 1]], 'the shared steps, then its own')
    assert.deepEqual(sharing(two), [['chime2'], []])
    assert.equal(apply(two, append(two, 'reverse()')), two.replace('0.25 })\n\n', '0.25 })\n  .reverse()\n\n'), 'an edit joins its own steps')
    // rolled back into the shared steps: its own statement the sound copied up to there, the other track's as it was
    assert.equal(rollback(two, 1), two.replace(`let chime = chimeTake.clone()\n  .gain(-Infinity, { at: 0.5, d: 0.25 })`, `let chime = audio('chime.wav')\n  .trim()`))
    assert.equal(rollback(two, 2), two.replace(`\n  .gain(-Infinity, { at: 0.5, d: 0.25 })\n\nlet chime2`, `\n\nlet chime2`).replace(`let chime = chimeTake.clone()`, `let chime = audio('chime.wav')\n  .trim()\n  .normalize(-1)`))
    assert.equal(rollback(two, 0), two.replace(`let chime = chimeTake.clone()\n  .gain(-Infinity, { at: 0.5, d: 0.25 })`, `let chime = audio('chime.wav')`), 'to the sound alone')
    assert.equal(rollback(two, 3), two, 'all of it: as it is')
    assert.ok(stages(two).every(s => s.before.endsWith('\nchime') && s.after.endsWith('\nchime')))
    // what a shared step takes out: the sound before it written out, the step on a copy
    assert.match(residual(two, 1), /\nconst __before = audio\('chime\.wav'\)\n {2}\.trim\(\)\n__before\.clone\(\)\.mix\(__before\.clone\(\)\.normalize\(-1\)/)
    // a step stays in its part: no move or group across the copy
    assert.equal(moveStep(two, 1, 2), null)
    assert.equal(group(two, 1, 2), null)
    // again: the next piece right under it, named on, the steps the track has of its own shared in turn
    const again = toTrack(two, { at: '1', d: '0.5' }).code
    assert.deepEqual(names(again), ['chime', 'chime3', 'chime2'])
    assert.match(again, /let chimeTake2 = chimeTake\.clone\(\)\n {2}\.gain\(-Infinity, \{ at: 0\.5, d: 0\.25 \}\)\n\nlet chime = chimeTake2\.clone\(\)\n {2}\.gain\(-Infinity, \{ at: 1, d: 0\.5 \}\)\n\nlet chime3 = chimeTake2\.clone\(\)/)
    assert.deepEqual(chain(again).parts.map(p => p.name), ['chimeTake', 'chimeTake2', 'chime'])
    // one of three taken away: the sound it shared with one other goes into that one, the one all three share stays
    assert.equal(apply(again, dropTrack(again, 'chime3')), `let chimeTake = audio('chime.wav')\n  .trim()\n  .normalize(-1)\n\nlet chime = chimeTake.clone()\n  .gain(-Infinity, { at: 0.5, d: 0.25 })\n  .gain(-Infinity, { at: 1, d: 0.5 })\n\nlet chime2 = chimeTake.clone()\n  .crop({ at: 0.5, d: 0.25 })\n  .pad(0.5, 0)`)
    // a step turned off is the track's own too: shared once it parts, back with the steps when they rejoin
    const muted = toTrack(`let a = audio('a.wav')\n  // .fade(1)`, { at: '0', d: '1' }).code
    assert.equal(muted, `let aTake = audio('a.wav')\n  // .fade(1)\n\nlet a = aTake.clone()\n  .gain(-Infinity, { at: 0, d: 1 })\n\nlet a2 = aTake.clone()\n  .crop({ at: 0, d: 1 })`)
    assert.equal(apply(muted, dropTrack(muted, 'a2')), `let a = audio('a.wav')\n  // .fade(1)\n  .gain(-Infinity, { at: 0, d: 1 })`)
    // steps turned off are each track's own, to the next statement
    const off = `let a = audio('a.wav')\n  .trim()\n  // .fade(1)\n\nlet b = audio('b.wav')\n  // .gain(-3)\n  .reverse()`
    focus('a')
    assert.deepEqual(steps(off).map(s => [s.text, s.on]), [['.trim()', true], ['.fade(1)', false]])
    focus('b')
    assert.deepEqual(steps(off).map(s => [s.text, s.on]), [['.gain(-3)', false], ['.reverse()', true]])
    // a file a track of its own, named for it; a track taken away, its steps and the blank line before it with it
    focus('chime')
    assert.equal(addTrack(one, `audio('My take-2.wav')`, 'My take-2.wav').code, `let chime = audio('chime.wav')\n  .trim()\n  .normalize(-1)\n\nlet myTake2 = audio('My take-2.wav')`)
    assert.equal(addTrack(one, `audio('audio.wav')`, 'audio.wav').name, 'sound', 'no name the script cannot take')
    // a file under the track edited; an empty one, made under the lanes, under the last, whichever is edited
    focus('a')
    assert.equal(addTrack(off, `audio('c.wav')`, 'c.wav').code, `let a = audio('a.wav')\n  .trim()\n  // .fade(1)\n\nlet c = audio('c.wav')\n\nlet b = audio('b.wav')\n  // .gain(-3)\n  .reverse()`)
    assert.equal(addTrack(off, 'audio.from(0)', 'track', { last: true }).code, `${off}\n\nlet track = audio.from(0)`)
    focus('chime')
    // the other part taken away, the shared steps go back into the one left: one sound, as before they parted
    assert.equal(apply(two, dropTrack(two, 'chime2')), `let chime = audio('chime.wav')\n  .trim()\n  .normalize(-1)\n  .gain(-Infinity, { at: 0.5, d: 0.25 })`)
    assert.equal(apply(two, dropTrack(two, 'chime')), `let chime2 = audio('chime.wav')\n  .trim()\n  .normalize(-1)\n  .crop({ at: 0.5, d: 0.25 })\n  .pad(0.5, 0)`)
    assert.equal(apply(off, dropTrack(off, 'a')), `let b = audio('b.wav')\n  // .gain(-3)\n  .reverse()`)
    assert.equal(dropTrack(one, 'chime'), null)
    const three = `let a = audio('a.wav')\n\nlet b = audio('b.wav')\n  .gain(-3)\n\nlet c = audio('c.wav')`
    assert.equal(apply(three, dropTrack(three, 'b')), `let a = audio('a.wav')\n\nlet c = audio('c.wav')`, 'one between others')
    // the step a model's split parted a track by, taken away from any of its parts: the split with it, the sound whole
    // again, the steps shared before it back in it, those after it on that part kept; any other step, itself alone
    const split = stemTracks(one).code + '\n  .gain(-6)'
    for (const name of ['chime', 'voice', 'drums']) {
      focus(name)
      const i = steps(split).findIndex(s => s.name === 'rebalance' && s.call.part === 1)
      assert.equal(apply(split, dropStep(split, i)), `let ${name} = audio('chime.wav')\n  .trim()\n  .normalize(-1)${name === 'drums' ? '\n  .gain(-6)' : ''}`, `the split undone from ${name}`)
    }
    focus('drums')
    assert.equal(apply(split, dropStep(split, steps(split).findIndex(s => s.name === 'gain'))), stemTracks(one).code, 'a step after it: itself alone')
    const bypassed = apply(split, turnOff(split, steps(split).find(s => s.name === 'rebalance' && s.call.part === 1).call))
    assert.equal(apply(bypassed, dropStep(bypassed, steps(bypassed).findIndex(s => s.name === 'rebalance' && !s.on))), split.replace('\n  .rebalance(-Infinity, -Infinity, 0, -Infinity, { residual: -Infinity })', ''), 'turned off, then taken away: itself alone, the split as it was')
    focus('voice')
    const sung2 = voiceTrack(`audio('a.wav')`).code
    assert.equal(apply(sung2, dropStep(sung2, 0)), `let voice = audio('a.wav')`, 'the voice split undone')
    focus('chime')
    assert.equal(apply(two, dropStep(two, 2)), two.replace(`\n  .gain(-Infinity, { at: 0.5, d: 0.25 })`, ''), 'a range moved to a track of its own is no model\'s split: the silence alone')
    assert.deepEqual(splitOf(`let a = audio('a.wav')\n  .vocals()\n\nlet b = audio('b.wav')\n  .vocals()`, 'a'), [], 'another file: no split')
  } finally { focus(null) }
  // none edited: the last
  assert.equal(chain(made.code).declared, 'chime2')
})

// A sidechain's key keeps the track it reads (a voice the bed ducks under is still heard); a master, the last statement a
// copy of one track with the others mixed in, then steps of its own, leaves them tracks and is edited as one: its steps
// those after the mix; tracks made, opened or taken away keep it mixing every track; a key's step goes with its track
// A track named anew as a script names a sound, every reference to it with it (a key that ducks another under it), a
// name no other sound has; a name that makes none, the one it has, or no such track: nothing
test('code: a track renamed, its references with it, to a name of its own', () => {
  const code = "let chime = audio('chime.wav')\n\nlet track = audio.from(0)\n  .write(audio('take.wav'), { at: 1 })\n\nlet bed = audio('rhodes.wav').ducker({ key: track, range: -15 })"
  assert.deepEqual(renameTrack(code, 'track', 'Lead vocal'), { name: 'leadVocal', code: code.replace('let track', 'let leadVocal').replace('key: track', 'key: leadVocal') })
  assert.equal(renameTrack(code, 'track', 'chime').name, 'chime2')
  for (const [from, to] of [['track', '!!!'], ['track', 'track'], ['nope', 'x']]) assert.equal(renameTrack(code, from, to), null, `${from} → ${to}`)
})

test('code: a key keeps a track; a master mixes the tracks, then steps of its own', () => {
  const apply = (code, change) => code.slice(0, change.from) + change.insert + code.slice(change.to ?? change.from)
  const names = code => tracks(code).map(t => t.name)
  const duck = `let voice = audio('v.wav')\n  .deepfilter()\n\nlet bed = audio('m.wav')\n  .ducker({ key: voice, range: -15 })`
  assert.deepEqual(names(duck), ['voice', 'bed'], 'a key: both tracks')
  assert.deepEqual(names(`let voice = audio('v.wav')\nlet bed = audio('m.wav').ducker({ key: voice.clone() })`), ['voice', 'bed'], 'a key a copy of it: both')
  assert.deepEqual(names(`let noise = audio('n.wav')\nlet v = audio('v.wav').denoise({ noise })`), [], 'a noise print feeds the one it learns for')
  assert.equal(master(duck), null)
  const mixed = `${duck}\n\nvoice.clone().mix(bed)\n  .normalize('podcast')`
  assert.deepEqual(names(mixed), ['voice', 'bed'], 'a master: the tracks it mixes')
  assert.deepEqual([master(mixed).name, master(mixed).names], ['master', ['voice', 'bed']])
  assert.match(prepare(mixed).code, /return __out\(\{ voice, bed \}, true, \{ name: "master", value: voice\.clone\(\)\.mix\(bed\)\n {2}\.normalize\('podcast'\) \}\)$/)
  for (const code of [`let a = audio('a.wav')\nlet b = audio('b.wav')\nlet c = audio('c.wav')\na.clone().mix(b)`, `let a = audio('a.wav')\nlet b = audio('b.wav')\na.mix(b)`, `let a = audio('a.wav')\nlet b = audio('b.wav')\na.clone().mix(b, 0, -6)`])
    assert.equal(master(code), null, `not a master: ${code.split('\n').at(-1)}`)
  assert.equal(master(`let master = audio('a.wav')\nlet b = audio('b.wav')\nmaster.clone().mix(b)`).name, 'master2', 'named apart from the tracks')
  try {
    focus('master')
    assert.deepEqual(steps(mixed).map(s => s.text), [".normalize('podcast')"], 'its steps: those after the mix')
    assert.equal(apply(mixed, append(mixed, 'limiter()')), `${mixed}\n  .limiter()`)
    assert.equal(rollback(mixed, 0), `${duck}\n\nvoice.clone().mix(bed)`)
    assert.equal(voiceTrack(mixed), null, 'the master splits into no tracks')
    // a file opened as a track: before the master, mixed into it
    assert.equal(addTrack(mixed, `audio('fx.wav')`, 'fx.wav').code, `${duck}\n\nlet fx = audio('fx.wav')\n\nvoice.clone().mix(bed).mix(fx)\n  .normalize('podcast')`)
    // the master taken away: the tracks as they were
    assert.equal(apply(mixed, dropTrack(mixed, 'master')), duck)
    focus('voice')
    assert.deepEqual(steps(mixed).map(s => s.text), ['.deepfilter()'])
    // the voice split from a track: the master mixes it too
    assert.equal(voiceTrack(mixed).code, `let voiceTake = audio('v.wav')\n  .deepfilter()\n\nlet voice = voiceTake.clone()\n  .vocals('remove', { model: 'mel-roformer' })\n\nlet voice2 = voiceTake.clone()\n  .vocals({ model: 'mel-roformer' })\n\nlet bed = audio('m.wav')\n  .ducker({ key: voice, range: -15 })\n\nvoice.clone().mix(bed).mix(voice2)\n  .normalize('podcast')`)
    // a track taken away: out of the master, the steps keyed on it with it
    assert.equal(apply(mixed, dropTrack(mixed, 'voice')), `let bed = audio('m.wav')\n\nbed.clone()\n  .normalize('podcast')`)
    assert.equal(apply(mixed, dropTrack(mixed, 'bed')), `let voice = audio('v.wav')\n  .deepfilter()\n\nvoice.clone()\n  .normalize('podcast')`)
    const copied = `let voice = audio('v.wav')\n\nlet bed = audio('m.wav')\n  .ducker({ key: voice.clone() })\n  .gain(-3)`
    assert.equal(apply(copied, dropTrack(copied, 'voice')), `let bed = audio('m.wav')\n  .gain(-3)`, 'its step keyed on a copy of it too')
  } finally { focus(null) }
  // a master added: the one given a copy, the others mixed in
  assert.deepEqual(addMaster(duck, 'bed'), { code: `${duck}\n\nbed.clone().mix(voice)`, name: 'master' })
  assert.equal(addMaster(mixed, 'voice'), null, 'one already')
})

test('code: the last expression is returned, loops check their time, and imports become dynamic, on the same lines', () => {
  // the value comes back boxed, so a sound still arriving (thenable) streams instead of being waited out
  assert.equal(prepare(`audio('a.wav')\n  .gain(-3)`).code, `return __out(audio('a.wav')\n  .gain(-3))`)
  assert.equal(prepare(`let a = audio('a.wav')`).code, `let a = audio('a.wav');return __out(a)`)
  const loop = prepare(`import audio from 'audio'\nimport fx from 'https://x/fx.js'\nfor (;;) x()\nwhile (1) { y() }`).code.split('\n')
  assert.equal(loop.length, 4)
  assert.equal(loop[0].trim(), '')
  assert.equal(loop[1], `const { default: fx } = await import('https://x/fx.js')`)
  assert.equal(loop[2], 'for (;;) {__loop();x()}')
  assert.equal(loop[3], 'while (1) {__loop(); y() }')
  assert.deepEqual(prepare(`audio(['a.wav', "b.mp3"]).mix(audio('c.flac'))`).names, ['a.wav', 'b.mp3', 'c.flac'])
  assert.deepEqual(error(`audio('a').gain(`), { from: 16, to: 17 })
  assert.equal(error(`audio('a').gain(-3)`), null)
})

// An edit goes on a line of its own, as the edits are a card each, indented as the chain's lines are
test('code: edits from the waveform join the output chain, a line each, before a closing save', () => {
  const run = (code, call) => { const c = append(code, call); return code.slice(0, c.from) + c.insert + code.slice(c.to ?? c.from) }
  assert.equal(run(`audio('a.wav')`, 'reverse()'), `audio('a.wav')\n  .reverse()`)
  assert.equal(run(`audio('a.wav').gain(-3)`, 'reverse()'), `audio('a.wav').gain(-3)\n  .reverse()`)
  assert.equal(run(`audio('a.wav').gain(-3).save('b.wav')`, 'reverse()'), `audio('a.wav').gain(-3)\n  .reverse()\n  .save('b.wav')`)
  assert.equal(run(`audio('a.wav')\n  .trim()\n  .save('b.wav')`, 'reverse()'), `audio('a.wav')\n  .trim()\n  .reverse()\n  .save('b.wav')`)
  assert.equal(run(`let a = audio('a.wav')\na`, 'reverse()'), `let a = audio('a.wav')\na.reverse()\na`)
  assert.equal(append('', 'reverse()'), null)
  assert.deepEqual(source(`let a = audio('a.wav')\na.gain(-3)`).strings.map(s => s.name), ['a.wav'])
  assert.deepEqual(source(`audio(['a.wav', 'b.wav'])`).array, [6, 24])
})

test('code: sliders rewrite one argument, by position or by name, filling the ones before it', () => {
  const edit = (code, at, where, value, fill) => { const c = setArg(callAt(code, code.indexOf(at) + at.length), where, value, fill); return code.slice(0, c.from) + c.insert + code.slice(c.to ?? c.from) }
  assert.equal(edit(`a.gain(-3)`, 'gain(', 0, -6), `a.gain(-6)`)
  assert.equal(edit(`a.eq()`, 'eq(', 2, 2, [1000, 0, 1]), `a.eq(1000, 0, 2)`)
  assert.equal(edit(`a.gain({ at: 1, duration: 2 })`, 'gain(', 0, -6, [0]), `a.gain(-6, { at: 1, duration: 2 })`)
  assert.equal(edit(`a.compressor({ threshold: -20 })`, 'compressor(', 'ratio', 4), `a.compressor({ threshold: -20, ratio: 4 })`)
  assert.equal(edit(`a.compressor({ threshold: -20 })`, 'compressor(', 'threshold', -30), `a.compressor({ threshold: -30 })`)
  assert.equal(edit(`a.compressor()`, 'compressor(', 'ratio', 4), `a.compressor({ ratio: 4 })`)
  const call = callAt(`a.fade(0.5, -2, 'exp')`, 7)
  assert.deepEqual(call.args.map(a => a.value), [.5, -2, 'exp'])
  // a range given by name is a value: one, or several
  assert.deepEqual(callAt(`a.denoise({ noise: { at: 1, duration: 0.5 } })`, 3).args[0].props[0].value, { at: 1, duration: .5 })
  assert.deepEqual(callAt(`a.denoise({ noise: [{ at: 0, duration: 0.4 }, { at: 7 }] })`, 3).args[0].props[0].value, [{ at: 0, duration: .4 }, { at: 7 }])
  assert.equal(callAt(`a.denoise({ noise: { at: t, duration: 0.5 } })`, 3).args[0].props[0].kind, 'other')
})

// A recipe's calls show in the menu and open as units in the rack, with sliders: each is a method the editor describes.
// Measuring recipes and loops over files have no output chain; audio.from() is the source a generator starts from.
// Groups: a recipe's calls under its name, a comment on a line of its own, set in under it (as append writes them)
test('code: a group is a comment alone between the calls, the steps set in under it; nothing else is', () => {
  const apply = (code, ch) => code.slice(0, ch.from) + ch.insert + code.slice(ch.to ?? ch.from)
  const echo = { name: 'Remove room echo', calls: ['highpass(80)', 'dereverb()'] }
  // on a chain of several lines, a single line, one with no calls, one closed by a save()
  let code = apply("audio('a.wav')\n  .trim()", append("audio('a.wav')\n  .trim()", echo))
  assert.equal(code, "audio('a.wav')\n  .trim()\n  // Remove room echo\n    .highpass(80)\n    .dereverb()")
  assert.deepEqual(groups(code), [{ name: 'Remove room echo', from: code.indexOf('  // Remove'), to: code.length }])
  assert.deepEqual(chain(code).calls.map(k => k.name), ['trim', 'highpass', 'dereverb'])
  assert.equal(apply("audio('a.wav').trim()", append("audio('a.wav').trim()", echo)), "audio('a.wav').trim()\n  // Remove room echo\n    .highpass(80)\n    .dereverb()")
  assert.equal(apply("audio('a.wav')", append("audio('a.wav')", echo)), "audio('a.wav')\n  // Remove room echo\n    .highpass(80)\n    .dereverb()")
  const saved = apply("audio('a.wav')\n  .trim()\n  .save('b.wav')", append("audio('a.wav')\n  .trim()\n  .save('b.wav')", echo))
  assert.equal(saved, "audio('a.wav')\n  .trim()\n  // Remove room echo\n    .highpass(80)\n    .dereverb()\n  .save('b.wav')")
  assert.equal(groups(saved)[0].to, saved.indexOf('\n  .save'))
  // a call after it, set as the chain's are, is not its own; a step of it turned off stays in it
  const after = apply(code, append(code, 'fade(0.5)'))
  assert.equal(groups(after)[0].to, code.length)
  const off = code.replace('    .dereverb()', '    // .dereverb()')
  assert.deepEqual(groups(off), [{ name: 'Remove room echo', from: off.indexOf('  // Remove'), to: off.length }])
  // none: a comment with nothing set in under it, at the end, a step turned off, a note after a call on its line, one
  // inside a call's arguments, one before the chain
  for (const text of [
    "audio('a.wav')\n  // a note\n  .trim()",
    "audio('a.wav')\n  .trim()\n  // a note",
    "audio('a.wav')\n  // .trim()\n    .gain(-3)",
    "audio('a.wav')\n  .trim() // a note\n    .gain(-3)",
    "audio('a.wav')\n  .gain({\n    // the curve\n      t: [0, 1], v: [0, -3] })",
    "// a note\n  audio('a.wav')\n    .trim()"
  ]) assert.deepEqual(groups(text), [], text)
  assert.deepEqual(groups(''), [])
})

// The rack's tooltips (help.js): every setting of every op the rack can build a slider for, a plugin's read from its
// manifest as the engine reads it, says what it does in a sentence or two, and the layouts name those settings, each once
test('help: every setting of every op says what it does; the texts and layouts name only settings that exist', async () => {
  const settings = {}, thresholds = []
  for (const [name, op] of Object.entries(ops)) {
    let spec = op.params
    // (an optional package that is not installed has none to read)
    if (!spec && audio.plugins[name]) spec = await audio.use(name).then(() => Object.entries(audio.op(name).plugin.params).map(([n, s]) => ({ name: n, unit: s.unit })), () => null)
    // a source, a band and what is learned from a selection are set in the code or on the picture, not by a slider
    if (spec) settings[name] = spec.filter(s => s.name !== 'source' && s.name !== 'band' && !s.selection).map(s => s.name)
    if (spec?.some(s => s.name === 'threshold' && s.unit !== 'dB')) thresholds.push(name)
  }
  const bad = []
  for (const [name, names] of Object.entries(settings)) for (const setting of names) {
    const text = help(name, setting)
    if (typeof text !== 'string' || !text.endsWith('.') || text.length > 250 || text.includes(String.fromCharCode(8212))) bad.push(`${name}.${setting}: ${text}`)
  }
  assert.deepEqual(bad, [], 'a sentence or two ending in a full stop, 250 letters at most, no long dash')
  assert.deepEqual(Object.entries(texts).flatMap(([name, t]) => name === '*' ? [] : Object.keys(t).filter(setting => settings[name] && !settings[name].includes(setting)).map(setting => `${name}.${setting}`)), [], 'texts for settings that are gone')
  for (const [name, text] of Object.entries(layouts)) if (settings[name]) {
    assert.deepEqual(text.replace('|', ' ').split(/\s+/).filter(Boolean).sort(), [...settings[name]].sort(), `${name}: its layout names each setting once`)
    const [shown, folded] = layout(name, settings[name])
    assert.ok(shown.length && settings[name].length === shown.length + folded.length, `${name}: some shown, the rest folded`)
  }
  // a new setting, one the layout does not name, is shown; a folded one the manifest lacks leaves nothing to fold
  assert.deepEqual(layout('declick', ['threshold', 'longest', 'extra']), [['threshold', 'extra'], ['longest']])
  assert.deepEqual(layout('declick', ['threshold']), [['threshold'], []])
  assert.deepEqual(layout('trim', ['threshold']), [['threshold'], []])
  // a setting of an op without words of its own has its name's, or none
  assert.equal(help('crop', 'at'), texts['*'].at)
  assert.equal(help('declick', 'nope'), undefined)
  // a threshold draws a level on the picture only where it is in dB: declick's and decrackle's are multiples of the
  // sound's own error, and any plugin that comes with one like them is found here
  assert.ok(thresholds.includes('declick') && thresholds.includes('decrackle'))
  assert.deepEqual(thresholds.filter(name => guides(name, { threshold: 1 }, 8).some(g => g.level != null)), [])
})

// A tune's guide is the notes it lands on: the scale tables are @audio/note's, which @audio/tune-snap snaps by, and
// every scale its manifest offers has one; each note listed is one snapMidi keeps (on the scale), and none it would
// keep between A0 and C8 (MIDI 21–108, the piano's) is missing; A4 is the tuning set, its range the span
test('code: a tune guides by the notes of its scale, as @audio/note snaps', async () => {
  assert.deepEqual(SCALES, NOTE_SCALES)
  const { tune } = await import('@audio/tune-snap/audio')
  for (const scale of tune.params.scale.values) for (const root of [0, 2, 7, 11]) {
    const [g] = guides('tune', { scale, root }, 8), keeps = Array.from({ length: 88 }, (_, i) => 21 + i).filter(m => snapMidi(m, { scale, root }) === m)
    assert.deepEqual(g.notes, keeps, `${scale} from ${root}`)
  }
  assert.deepEqual(guides('tune', {}, 8)[0], { notes: Array.from({ length: 88 }, (_, i) => 21 + i), root: 0, a4: 440 })
  assert.deepEqual(guides('tune', { scale: 'major', a4: 432, at: 1, duration: 2 }, 8).map(g => g.span ?? g.range), [[1, 3], [1, 3]])
  assert.equal(guides('tune', { scale: 'nope' }, 8).length, 0)
})

test('code: every recipe calls only methods the menu and the rack know', () => {
  for (const r of recipes) for (const call of chain(r.code.replaceAll('$src', `audio('a.wav')`))?.calls || [])
    assert.ok(ops[call.name] || call.name === 'save' || call.name === 'from', `${r.name}: .${call.name}()`)
})

test('code: each guide follows its call: levels, fades, ranges and frequencies', () => {
  assert.deepEqual(guides('trim', { threshold: -40 }, 8), [{ level: -40 }])
  // a threshold that is not a level in dB draws none: declick's and decrackle's are multiples of the sound's own error
  assert.deepEqual(guides('declick', { threshold: 4 }, 8), [])
  // nor deesser's: the sibilance band over the voice body, in dB, not a level of the sound
  assert.deepEqual(guides('deesser', { threshold: 6 }, 8), [])
  assert.deepEqual(guides('decrackle', { threshold: 2.5 }, 8), [])
  assert.deepEqual(guides('remove', { at: 1, duration: .5 }, 8), [{ range: [1, 1.5] }])
  assert.deepEqual(guides('crop', { at: 1, duration: .5 }, 8), [{ range: [1, 1.5] }])
  // fade(in, out) ramps at the ends; fade(d, { at }) one from `at`, out when d < 0 (fn/fade.js)
  assert.deepEqual(guides('fade', { in: .02, out: .1 }, 8), [{ ramps: [[0, .02, 'in', 'linear'], [7.9, 8, 'out', 'linear']] }])
  assert.deepEqual(guides('fade', { in: -.5, at: 3.5, curve: 'cos' }, 8), [{ ramps: [[3.5, 4, 'out', 'cos']] }])
  assert.deepEqual(guides('fade', { in: .5 }, 8), [{ ramps: [[0, .5, 'in', 'linear']] }])
  assert.deepEqual(guides('highpass', { freq: 80 }, 8), [{ freq: 80 }])
  assert.deepEqual(guides('normalize', { target: -1 }, 8), [{ level: -1 }])
  assert.deepEqual(guides('normalize', { target: -16, mode: 'lufs' }, 8), [])
  // where denoise learns its noise, each range
  assert.deepEqual(guides('denoise', { reduction: 12, threshold: 0, noise: { at: 0, duration: .4 } }, 8), [{ range: [0, .4], label: 'noise' }])
  assert.deepEqual(guides('denoise', { noise: [{ at: 0, duration: .4 }, { at: 7, duration: .5 }], at: 1, duration: 5 }, 8).map(g => g.range), [[1, 6], [0, .4], [7, 7.5]])
})

// A slider's move shows at once on the picture where a level says it: the factor its new settings change the level by
test('code: a step\'s new settings preview as the level they change: gain, normalize, a fade\'s curve', () => {
  assert.ok(Math.abs(previews.gain({ value: -6 }, { value: 0 })(1) - 10 ** (6 / 20)) < 1e-9)
  assert.equal(previews.gain({ value: 0, at: 1, duration: 1 }, { value: -6, at: 1, duration: 1 })(3), 1, 'outside its range, as it was')
  assert.ok(Math.abs(previews.normalize({ target: -1 }, { target: -7 })(0) - 10 ** (-6 / 20)) < 1e-9)
  assert.equal(previews.normalize({ target: -1 }, { target: -16, mode: 'lufs' }), null, 'another mode: no level says it')
  // a line from 0 over 0.5 s, then over 1 s: at 0.25 s the level halves; past both, as it was
  const fade = previews.fade({ in: .5 }, { in: 1 }, 8)
  assert.ok(Math.abs(fade(.25) - .5) < 1e-9 && fade(2) === 1)
  assert.equal(previews.fade({ in: .5, at: 2 }, { in: 1, at: 2 }, 8), null, 'placed fades show when their output comes')
})

// The command a script translates to (for a CLI view, when it returns) makes the same audio: both run, the outputs
// compared sample by sample.
test('code: the CLI translation makes the same audio as the script (bin/cli.js on the same file)', async () => {
  const dir = await mkdtemp(resolve(tmpdir(), 'audio-repl-cli-'))
  try {
    const input = resolve(dir, 'in.wav')
    await writeFile(input, await wavBytes([sine(2, 440, .5), sine(2, 660, .25)]))
    const scripts = [
      `audio('in.wav').trim().normalize(-1).fade(0.02, 0.1)`,
      `audio('in.wav').highpass(80).remove({ at: 0.5, duration: 0.25 }).gain(-6, { at: 1, duration: 0.5 })`,
      `audio('in.wav').eq(1000, -3, 2).crop({ at: 0.25, duration: 1 }).reverse()`,
      `audio('in.wav').denoise({ noise: { at: 0, duration: 0.4 } })`,
      `audio('in.wav').denoise(20, { noise: { at: 0, duration: 0.4 }, at: 1, duration: 0.5 })`
    ]
    for (const [i, script] of scripts.entries()) {
      const command = cli(script, name => ops[name]?.params)
      assert.ok(command, script)
      const args = command.split(' ').slice(1).map(a => a === 'in.wav' ? input : a)
      const out = resolve(dir, `cli-${i}.wav`)
      await promisify(execFile)('node', [fileURLToPath(new URL('../bin/cli.js', import.meta.url)), ...args, 'save', out, '32bit', '-f'])
      const js = await new Function('audio', 'return ' + script.replace("'in.wav'", JSON.stringify(input)))(audio).read()
      const fromCli = await audio(out).read()
      assert.equal(fromCli[0].length, js[0].length, command)
      let diff = 0
      for (let c = 0; c < js.length; c++) for (let n = 0; n < js[c].length; n++) diff = Math.max(diff, Math.abs(js[c][n] - fromCli[c][n]))
      assert.ok(diff < 1e-6, `${command}: differs by ${diff}`)
    }
    assert.equal(cli(`audio.from(t => t, { duration: 1 })`), null)
    // a range by name is name:from..to; the call's own range comes last; several ranges no command says
    assert.equal(cli(scripts[3], name => ops[name]?.params), 'audio in.wav denoise noise:0s..0.4s')
    assert.equal(cli(scripts[4], name => ops[name]?.params), 'audio in.wav denoise 20db noise:0s..0.4s 1s..1.5s')
    assert.equal(cli(`audio('in.wav').denoise({ noise: [{ at: 0, duration: 0.4 }, { at: 1, duration: 0.2 }] })`), null)
  } finally { await rm(dir, { recursive: true, force: true }) }
})

// ── The scrub voice ────────────────────────────────────────────

// Its processor (playground/scrub.js), run in Node with the worklet's globals stubbed, a 128-frame quantum at a time: the
// channels `x` at `rate`, the caret at caret(q) samples in quantum q, for `seconds`
// The scrub voice as the worklet runs it: its module imported with a worklet's globals, one class for every run
let Scrubber
async function scrubbed(x, caret, seconds, rate = 48000, mode) {
  globalThis.sampleRate = rate
  if (!Scrubber) {
    Object.assign(globalThis, { AudioWorkletProcessor: class { constructor() { this.port = { onmessage: null, postMessage() {} } } }, registerProcessor: (_, cls) => { Scrubber = cls }, currentTime: 0 })
    await import('../playground/scrub.js')
  }
  const Proc = Scrubber
  const proc = new Proc(), send = data => proc.port.onmessage({ data }), Q = 128, n = Math.ceil(seconds * rate / Q)
  send({ x, rate, mode })
  send({ caret: caret(0), on: true })
  const out = x.map(() => new Float32Array(n * Q)), block = x.map(() => new Float32Array(Q))
  for (let q = 0; q < n; q++) { send({ caret: caret(q) }); proc.process([], [block]); out.forEach((o, c) => o.set(block[c], q * Q)) }
  return out
}
// noise 60 dB down, and a click at 0.5 s: 1 ms of noise, decaying; the same numbers every run (a 32-bit LCG)
function clicked(rate = 48000, loud = 1) {
  let seed = 1
  const noise = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 31 - 1, click = rate / 2
  return Float32Array.from({ length: rate }, (_, i) => noise() * (1e-3 + (i >= click && i < click + 48 ? loud * Math.exp(-(i - click) / 10) : 0)))
}
// attacks by their first difference, which a steady floor hardly has: where the loudest is, how sharp against the
// source's, and how far over the floor the 20 ms before it rise
function attack(y, x, rate = 48000) {
  const d = v => Float64Array.from(v, (s, i) => i ? s - v[i - 1] : 0), rms = (v, a, b) => Math.sqrt(v.slice(a, b).reduce((s, u) => s + u * u, 0) / (b - a))
  const dx = d(x), dy = d(y), click = rate / 2
  let p = 0
  for (let i = 1; i < dy.length; i++) if (Math.abs(dy[i]) > Math.abs(dy[p])) p = i
  return { at: p, dy, sharp: Math.abs(dy[p]) / Math.max(...dx.slice(click, click + 48).map(Math.abs)), before: 20 * Math.log10(rms(dy, p - .02 * rate, p - .002 * rate) / rms(dx, 0, click - 480)) }
}

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

// One way to write a time, on the clock, the time row, the pointer and the edits: minutes and seconds, seconds, samples;
// rounded once, so a time a hair under a minute reads a minute, not 0:60.000
// Each method its own icon, in the palette and on its card: one for every op, none twice, each a path on the 24 grid
test('icons: every method has its own', () => {
  assert.deepEqual(Object.keys(opIcons).sort(), Object.keys(ops).sort())
  assert.equal(new Set(Object.values(opIcons)).size, Object.keys(ops).length)
  for (const [name, d] of Object.entries(opIcons)) assert.match(d, /^[Mm][\d\s.,MLHVCSQTAZmlhvcsqtaz-]+$/, name)
})

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

test('time: minutes and seconds, seconds or samples, rounded once', () => {
  assert.equal(clock(65.4321), '1:05.432')
  assert.equal(clock(59.9996), '1:00.000')
  assert.equal(clock(5, 'clock', { digits: 0 }), '0:05')
  assert.equal(clock(5.05, 'clock', { digits: 1 }), '0:05.1')
  assert.equal(clock(2.5, 'seconds'), '2.500s')
  assert.equal(clock(59.99996, 'seconds', { digits: 4 }), '60.0000s')
  assert.equal(clock(2, 'samples', { rate: 44100 }), '88200')
  assert.equal(clock(0), '0:00.000')
})

// ── The engine, in a browser worker ─────────────────────────────

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

// the script, its lines as the editor has them, the code panel open or not
const code = () => page.evaluate(() => [...document.querySelectorAll('.cm-content .cm-line')].map(l => l.textContent).join('\n').replace(/ /g, ' '))
const readout = () => page.locator('.readout').textContent()
// A title, or, pointed at, what the tooltip took of it (popoff keeps it as data-tip till the pointer leaves)
const tipOf = el => el.title || el.dataset.tip || ''
// The levels of all of it, nothing selected: the peak on the bar, every level in its table (#levels), pointed at
const wholeLevels = () => page.locator('.readout[data-of="all"]')
// that table, its head and a row a line, its cells apart: "Peak −1.0dBFS at 0:00.120"
const levelsTable = () => page.locator('#levels').evaluate(el => [el.querySelector('.levels-head')?.textContent, ...[...el.querySelectorAll('tr')].map(r => [...r.cells].map(c => c.textContent).filter(Boolean).join(' '))].filter(Boolean).join('\n'))
// The output's length, from the name's tooltip ("chime.wav · 0:06.525"): the axes show it, so the page doesn't repeat it
const lengthText = () => page.evaluate(() => (e => e.title || e.dataset.tip || '')(document.querySelector('.source')).split(' · ').pop())
const seconds = async () => { const [m, s] = (await lengthText()).split(':'); return +m * 60 + +s }
async function open() {
  await page.goto(origin + '/playground/')
  // the whole sound's levels read, shown or not (a narrow bar gives them way)
  await wholeLevels().waitFor({ state: 'attached' })
}
// A row of the menu open, by its label, exactly
const menuRow = label => page.locator('.menubar-menu .menu-row', { has: page.locator('.menu-label', { hasText: new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`) }) }).last()
// The groups of how a picture draws, in the dropdown a band's look opens (playground/index.html .dropdown); the others are the
// settings', in their panel
const DRAWS = ['Levels in', 'Weighting', 'Colour', 'Colormap', 'Fill', 'Channels', 'Frequency scale', 'Method', 'Colours', 'Gamma', 'Range', 'FFT size', 'Meter']
// A choice among the options open (a picture's dropdown, the settings' panel), by its group's name and its own: its
// section unfolded first, where it is folded; a look's, in its select, the select opened first
function choice(group, name) {
  const open = page.locator('.dropdown:popover-open, .settings'), button = open.getByRole('group', { name: group, exact: true }).getByRole('button', { name, exact: true })
  const option = page.getByRole('listbox', { name: group, exact: true }).getByRole('option', { name, exact: true })
  const unfold = () => page.evaluate(g => { for (const d of document.querySelectorAll('.settings details:not([open])')) if (d.querySelector(`[aria-label="${g}"]`)) d.querySelector('summary').click() }, group)
  const listed = () => page.evaluate(g => !!document.querySelector(`.dropdown:popover-open [role="listbox"][aria-label="${g}"]`), group)
  const pick = async () => { if (await listed()) { await page.locator(`.dropdown:popover-open .select-button[popovertarget="select-${group}"]`).click(); return option } await unfold(); return button }
  return { click: async o => (await pick()).click(o), getAttribute: async a => (await pick()).getAttribute(a) }
}
// A choice made: how a picture draws in its dropdown, opened by the band's look in its layer (the last band's), and
// closed again by it; else in the settings' panel, the panel as it was again after
async function settings(group, name) {
  if (DRAWS.includes(group)) {
    const button = page.locator(':is(.lane-look, .layer-look):visible').last()
    await button.click()
    await choice(group, name).click()
    return button.click()
  }
  const was = await page.evaluate(() => document.querySelector('.side-head [aria-selected="true"]')?.getAttribute('aria-label') ?? null)
  await tab('Settings')
  await choice(group, name).click()
  if (was !== 'Settings') await page.getByRole('tab', { name: was ?? 'Settings', exact: true }).click()
}
// What is selected, as the clock's title says it ("0:01.000–0:03.000"; '' for none, or several ranges): the clock
// itself reads the caret
const selected = async () => (await page.locator('.clock').evaluate(tipOf)).match(/^Selected (\S+–\S+):/)?.[1] ?? ''
// The panel on one of its buttons (the edits, the code, the export, the settings, at the top right); a click on the one
// shown would close it
async function tab(name) {
  const t = page.getByRole('tab', { name, exact: true })
  if (await t.getAttribute('aria-selected') !== 'true') await t.click()
}
// whether the panel shows the edits
const edits = async () => await page.getByRole('tab', { name: 'Edits', exact: true }).getAttribute('aria-selected') === 'true'
// Runs an item of the app menu: the menu by its name, then each submenu and the item, by their words
async function menu(...path) {
  await page.locator('.menubar-item', { hasText: new RegExp(`^${path[0]}$`) }).click()
  for (const name of path.slice(1)) {
    const words = typeof name === 'string' ? new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`) : name
    await page.locator('.menubar-list .menu-row:visible').filter({ has: page.locator('.menu-label', { hasText: words }) }).last().click()
  }
}
const facts = async () => (await page.locator('.facts').innerText()).replace(/\s*\n\s*/g, ' ')
// Whether the palette (⌘K) offers an edit by that name, within a few seconds (what it offers follows the output), the
// keys back on the picture after
async function offered(name) {
  let items = []
  for (const until = Date.now() + 5000; !items.includes(name) && Date.now() < until; await page.waitForTimeout(100)) {
    await page.keyboard.press('ControlOrMeta+K')
    items = await page.locator('.palette-list .tool strong').allInnerTexts()
    await page.keyboard.press('Escape')
  }
  await page.locator('.plot').focus()
  return items.includes(name)
}
// Runs an edit from the palette (⌘K), the first whose name has `words`
async function palette(words) {
  await page.keyboard.press('ControlOrMeta+K')
  await page.locator('.palette-list .tool', { has: page.locator('strong', { hasText: words }) }).first().click()
}
// The cues hidden and snapping off: a dragged edge goes where it is let go, not onto a cue near it, shown or not (a test
// of snapping keeps them)
const noCues = async () => { await menu('View', 'Show', 'Cues'); await menu('View', 'Snap to cues and markers') }
// The script written in the code panel (over the picture, from the bar), the panel then as it was
async function write(text) {
  const shown = await page.getByRole('tab', { name: 'Code', exact: true }).getAttribute('aria-selected') === 'true'
  await tab('Code')
  await page.locator('.cm-content').click()
  await page.keyboard.press('ControlOrMeta+A')
  await page.keyboard.insertText(text)
  if (!shown) await page.getByRole('tab', { name: 'Code', exact: true }).click()
}
// Bright pixels in the plot, from a screenshot: the waveform is drawn.
async function drawn(of = '.plot') {
  const png = await page.locator(of).screenshot()
  return page.evaluate(async b64 => {
    const img = new Image()
    img.src = 'data:image/png;base64,' + b64
    await img.decode()
    const c = Object.assign(document.createElement('canvas'), { width: img.width, height: img.height }), g = c.getContext('2d')
    g.drawImage(img, 0, 0)
    const d = g.getImageData(0, 0, c.width, c.height).data
    let bright = 0
    for (let i = 0; i < d.length; i += 4) if (d[i] > 120) bright++
    return bright / (d.length / 4)
  }, png.toString('base64'))
}

test('editor: opens on the chime with its script, drawn and measured', async () => {
  await open()
  assert.equal(await code(), `audio('chime.wav')\n  .trim()\n  .normalize(-1)\n  .fade(0.02, 0.1)`)
  assert.equal(await page.locator('.source').innerText(), 'chime.wav')
  // the depth the export writes, the library's 16 for a sound of no depth (fn/save.js)
  assert.equal(await facts(), '44.1kHz stereo 16-bit')
  assert.equal(await readout(), '−1.0dBFS')
  assert.match(await levelsTable(), /^Peak −1\.0dBFS at 0:0\d\.\d{3}\nRMS −\d+\.\ddBFS\nCrest \d+\.\ddB\nLoudness −\d+\.\dLUFS integrated$/)
  // its lanes TRACK px of the plot, the room under them
  const box = await page.locator('.plot').boundingBox()
  assert.ok(await drawn() > .05 * tall(box) / (box.height - 22), 'the waveform covers its lanes')
})

// The readout pointed at marks what it reads on the sound, the peak: a plain line through where it is and at its level,
// each end crossed; a row of its table pointed at, that row's alone: the RMS, its level, no line through the peak
test('editor: the readout marks the level it reads on the sound, a row of its table that row\'s alone', async () => {
  await open()
  await noCues()
  await wholeLevels().waitFor()
  const box = await page.locator('.plot').boundingBox(), w = Math.round(await spans(box)), h = Math.round(tall(box))
  // in the cues' colour, the tallest column and the widest row of the lane, px
  const marks = () => pixels(`const on = (x, y) => { const i = (y * w + x) * 4; return d[i] - d[i + 2] > 60 }
    let col = 0, row = 0
    for (let x = 0; x < arg.w; x++) { let n = 0; for (let y = 0; y < arg.h; y++) n += on(x, y); col = Math.max(col, n) }
    for (let y = 0; y < arg.h; y++) { let n = 0; for (let x = 0; x < arg.w; x++) n += on(x, y); row = Math.max(row, n) }
    return { col, row }`, { w, h })
  await page.locator('.readout').hover()
  await page.locator('#levels').waitFor()
  await page.waitForTimeout(200)
  const peak = await marks()
  assert.ok(peak.col > h * .8 && peak.row > w * .8, `the peak, through its place and at its level: ${JSON.stringify(peak)}`)
  await page.locator('#levels tr', { hasText: 'RMS' }).hover()
  await page.waitForTimeout(200)
  const rms = await marks()
  assert.ok(rms.col < h * .2 && rms.row > w * .8, `the RMS alone, at its level: ${JSON.stringify(rms)}`)
  await page.mouse.move(box.x + 10, box.y + 10)
  await page.waitForTimeout(200)
  const none = await marks()
  assert.ok(none.col < h * .2 && none.row < w * .2, `let go, none: ${JSON.stringify(none)}`)
})

// The tracks mixed have no lane of their own: the level the readout reads is marked on every track's, the one not
// edited too
test('editor: with tracks, the readout marks the mix\'s level on every track\'s lane', async () => {
  await open()
  await noCues()
  await write(`let a = audio('chime.wav')\n\nlet b = audio('rhodes.wav')`)
  await lengthIs('0:09.000')
  await wholeLevels().waitFor()
  const box = await page.locator('.plot').boundingBox(), w = Math.round(await spans(box)), lanes = await tracksAt()
  // the widest row in the cues' colour within each lane, px
  const rows = () => pixels(`return arg.lanes.map(([y0, y1]) => { let row = 0; for (let y = y0; y < y1; y++) { let n = 0; for (let x = 0; x < arg.w; x++) { const i = (y * w + x) * 4; n += d[i] - d[i + 2] > 60 } row = Math.max(row, n) } return row })`, { w, lanes: lanes.map(r => [Math.round(r.y - box.y), Math.round(r.y - box.y + r.h)]) })
  await page.locator('.readout').hover()
  await page.locator('#levels').waitFor()
  let got = []
  for (const until = Date.now() + 3000; !(got.length && got.every(n => n > w * .8)) && Date.now() < until; await page.waitForTimeout(100)) got = await rows()
  assert.ok(got.length === 2 && got.every(n => n > w * .8), `a line at its level across each lane: ${got} of ${w}`)
})

// A control pointed at says what it is on a tag pointing at it, after a moment, the next at once; the browser's own
// tooltip never, the title back once the pointer leaves
test('editor: a control pointed at says what it is and does, on a tag pointing at it', async () => {
  await open()
  const play = page.locator('button.play'), tip = page.locator('.popoff-tip')
  await play.hover()
  await tip.waitFor()
  assert.equal(await tip.locator('.popoff-tip-name').innerText(), 'Play')
  assert.equal(await tip.locator('.popoff-tip-keys').innerText(), 'Space')
  assert.equal(await tip.locator('.popoff-tip-body').innerText(), 'Hold and drag to rewind or skip')
  assert.equal(await tip.getAttribute('data-side'), 'top', 'over the bar at the window\'s foot')
  const [p, t] = await Promise.all([play.boundingBox(), tip.boundingBox()])
  assert.ok(Math.abs(t.x + parseFloat(await tip.evaluate(el => el.style.getPropertyValue('--popoff-arrow'))) - (p.x + p.width / 2)) < 1, 'its tip at the button\'s middle')
  assert.equal(await play.getAttribute('title'), null, 'no browser tooltip meanwhile')
  // across to the next: after the same moment, none on the way
  await page.locator('button.loop').hover()
  await tip.waitFor({ state: 'hidden' })
  await page.waitForTimeout(250)
  assert.ok(!await tip.isVisible(), 'not at once')
  await page.waitForFunction(() => document.querySelector('.popoff-tip:popover-open .popoff-tip-name')?.textContent === 'Loop')
  assert.equal(await tip.locator('.popoff-tip-keys').innerText(), 'L')
  // a control whose popover is open has none
  const depth = page.locator('.facts .fact', { hasText: '-bit' })
  await depth.click()
  await page.locator('#depth-menu:popover-open').waitFor()
  // left and pointed at again, the press forgotten: still none while its menu is open
  await page.mouse.move(4, 4)
  await depth.hover({ position: { x: 3, y: 3 } })
  await page.waitForTimeout(700)
  assert.ok(!await tip.isVisible(), 'none over its open menu\'s control')
  await page.keyboard.press('Escape')
  await page.mouse.move(4, 4)
  await tip.waitFor({ state: 'hidden' })
  assert.match(await play.getAttribute('title'), /^Play \(Space\)/)
  // a menu's row: beside the menu
  await page.locator('.menubar-item', { hasText: /^Select$/ }).click()
  await page.locator('.menubar-list .menu-row', { hasText: 'The next one like it' }).hover()
  await tip.waitFor()
  assert.equal(await tip.getAttribute('data-side'), 'right')
  assert.equal(await tip.innerText(), 'The next pause, or stretch between cues\n\nAlt and drag adds any other range')
  await page.keyboard.press('Escape')
})

// The depth the export writes, after the rate and the channels: the source's kept, or another picked there, which
// Export's Bits says too
test('editor: the depth written is a click from another', async () => {
  await open()
  await page.locator('.facts .fact', { hasText: '16-bit' }).click()
  await page.locator('#depth-menu .menu-item', { hasText: '24-bit' }).click()
  await page.locator('.facts', { hasText: '24-bit' }).waitFor()
  await tab('Export')
  assert.equal(await page.locator('.choices button[aria-pressed="true"]', { hasText: /^24$/ }).count(), 1)
  // a format that writes no 24 bits keeps its own
  await page.locator('.choices button', { hasText: /^MP3$/ }).click()
  await page.locator('.facts .fact', { hasText: '-bit' }).waitFor({ state: 'detached' })
  await page.locator('.choices button', { hasText: /^WAV$/ }).click()
  await page.locator('.facts .fact', { hasText: '24-bit' }).waitFor()
  await page.locator('.facts .fact', { hasText: '24-bit' }).click()
  await page.locator('#depth-menu .menu-item', { hasText: 'As the file' }).click()
  await page.locator('.facts .fact', { hasText: '16-bit' }).waitFor()
})

test('editor: a slider rewrites its argument, the output and its guide follow', async () => {
  await open()
  // a press on its card opens its settings
  await tab('Edits')
  await page.locator('.step-name', { hasText: 'Normalize' }).click()
  const slider = page.locator('.params input[type=range]').first()
  await slider.waitFor()
  assert.equal(await page.locator('.step.open .step-name').innerText(), 'Normalize')
  await slider.fill('500')
  await page.waitForFunction(() => scriptText().includes('normalize(-18)'))
  await page.locator('.readout', { hasText: '−18.0dBFS' }).waitFor()
  // one move, one step back
  await menu('Edit', 'Undo')
  await page.waitForFunction(() => scriptText().includes('normalize(-1)'))
})

// Pointed at, a setting says what it does and which way to move it (help.js), with its range and where it starts; the
// ones few touch wait under Advanced, which opens with the card where the code sets one of them
test('editor: a card\'s settings say what they do; the engine\'s own wait under Advanced', async () => {
  await open()
  const rows = page.locator('.step.open .param'), shown = () => rows.locator('label:visible').allInnerTexts(), more = page.locator('.step.open .step-more')
  // a card opened afresh: a press on the one open closes it, and another opens it
  const reopen = async name => {
    await tab('Edits')
    const card = page.locator('.step-name', { hasText: name })
    if (await page.locator('.step.open .step-name', { hasText: name }).count()) await card.click()
    await card.click()
    await rows.first().waitFor()
  }
  await write(`audio('chime.wav').declick()`)
  await reopen('Declick')
  assert.deepEqual(await shown(), ['threshold'])
  assert.match(await rows.first().evaluate(tipOf), /^Detection threshold\. .*\n2× to 30×, default 8×$/s)
  assert.match(await more.innerText(), /^Advanced\s+2$/)
  assert.equal(await more.getAttribute('aria-expanded'), 'false')
  await more.click()
  assert.deepEqual(await shown(), ['threshold', 'longest', 'order'])
  // every one says more than its name
  assert.deepEqual(await rows.evaluateAll(all => all.filter(row => !row.title.includes('\n')).map(row => row.querySelector('label').textContent)), [])
  // and it folds again
  await more.click()
  assert.deepEqual(await shown(), ['threshold'])
  // moving one writes it into the code, where it is set
  await more.click()
  await page.locator('.step.open .param', { hasText: 'longest' }).locator('input').fill('250')
  await page.waitForFunction(() => /declick\(8, \d/.test(scriptText()))
  // set in the code, one opens the fold with its card (decrackle was never open here); none set, it is folded
  await write(`audio('chime.wav').decrackle({ order: 24 })`)
  await reopen('Decrackle')
  assert.deepEqual(await shown(), ['threshold', 'order'])
  await write(`audio('chime.wav').decrackle()`)
  await reopen('Decrackle')
  assert.deepEqual(await shown(), ['threshold'])
  // a folded choice says what it decides, and sets as a choice does: the expander's mode
  await write(`audio('chime.wav').expander()`)
  await reopen('Expander')
  assert.deepEqual(await shown(), ['threshold', 'ratio', 'range'])
  await more.click()
  const mode = page.locator('.step.open .param', { hasText: 'mode' })
  assert.match(await mode.evaluate(tipOf), /^downward turns quiet sound/)
  await mode.getByRole('button', { name: 'upward' }).click()
  await page.waitForFunction(() => /expander\(\{ mode: 'upward' \}\)/.test(scriptText()))
  // a choice of an edit with none folded says what it decides too, its values on the keys
  await write(`audio('chime.wav').compressor().highpass(80)`)
  await reopen('Highpass')
  assert.match(await page.locator('.step.open .param', { hasText: 'order' }).evaluate(tipOf), /^Steepness\. /)
  // an edit with no settings has nothing to fold
  await write(`audio('chime.wav').reverse()`)
  await tab('Edits')
  await page.locator('.step-name', { hasText: 'Reverse' }).click()
  await page.locator('.step.open .params.none').waitFor()
  assert.equal(await page.locator('.step.open .params').innerText(), 'No settings')
  assert.equal(await more.count(), 0)
})

// The edits, as a history: a press on a step shows the output as it is up to it, the steps after it dimmed, and opens
// its settings, one card at a time; a press again, or its badge on the picture, shows the whole chain. The sound the chain
// starts from comes first.
test('editor: a step chosen among the edits shows the output up to it and opens its settings; × removes one', async () => {
  await open()
  await tab('Edits')
  assert.deepEqual(await page.locator('.step-name').allInnerTexts(), ['chime.wav', 'Trim', 'Normalize', 'Fade'])
  // each says what it is set to
  assert.deepEqual(await page.locator('.step-args').allInnerTexts(), ['', '', '−1dB', '0.02s · 0.1s'])
  const card = name => page.locator('.step', { has: page.locator('.step-name', { hasText: name }) })
  const opened = async () => (await page.locator('.step.open .step-name').allInnerTexts()).join()
  const rolled = async () => (await page.locator('.step.rolled .step-name').allInnerTexts()).join()
  // the keys staying where they were: Space plays, types nothing
  await page.locator('.plot').focus()
  await page.locator('.step-name', { hasText: 'Normalize' }).click()
  assert.equal(await page.evaluate(() => document.activeElement.classList.contains('plot')), true)
  await page.locator('.viewing', { hasText: 'Up to Normalize: ' }).waitFor()
  assert.equal(await opened(), 'Normalize')
  assert.equal(await rolled(), 'Fade')
  const slider = await card('Normalize').locator('input[type=range]').first().boundingBox()
  await drag([slider.x + slider.width * .3, slider.y + slider.height / 2], [slider.width * .2, 0])
  assert.equal(await opened(), 'Normalize', 'open after its slider moved')
  assert.ok(await page.locator('.viewing').isVisible(), 'still up to it')
  // the sound it starts from: the file alone
  await page.locator('.step-name', { hasText: 'chime.wav' }).click()
  await page.locator('.viewing', { hasText: 'The source alone' }).waitFor()
  assert.equal(await opened(), '')
  assert.equal(await rolled(), 'Trim,Normalize,Fade')
  await lengthIs('0:08.000')
  // the last step is the whole chain; pressed again, it closes
  await page.locator('.step-name', { hasText: 'Fade' }).click()
  await page.locator('.viewing').waitFor({ state: 'detached' })
  assert.equal(await opened(), 'Fade')
  await page.locator('.step-name', { hasText: 'Fade' }).click()
  assert.equal(await opened(), '')
  // the badge on the picture shows the whole chain again
  await page.locator('.step-name', { hasText: 'Trim' }).click()
  await page.locator('.viewing', { hasText: 'Up to Trim: ' }).getByRole('button', { name: 'Show all' }).click()
  await page.locator('.viewing').waitFor({ state: 'detached' })
  assert.equal(await rolled(), '')
  // what a step sets shows on the picture only while its card is under the pointer: normalize's level, a dashed line
  // across each lane, twice
  const orange = () => pixels(`let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i] - d[i + 2] > 60) n++; return n`)
  await page.mouse.move(0, 0)
  await page.waitForTimeout(200)
  const away = await orange()
  await card('Normalize').hover()
  await page.waitForTimeout(200)
  const over = await orange(), width = (await page.locator('.plot').boundingBox()).width
  assert.ok(over - away > width, `the level lines: ${away} orange pixels, ${over} over its card`)
  await page.mouse.move(0, 0)
  await page.waitForTimeout(200)
  assert.ok(Math.abs(await orange() - away) < width / 4, 'gone with the pointer')
  // keys on the picture, or Tab to the next control, draw no focus ring
  await page.locator('.plot').focus()
  await page.keyboard.press('ArrowRight')
  assert.equal(await page.locator('.plot').evaluate(el => getComputedStyle(el).outlineStyle), 'none')
  // × takes the call out of the chain, with its line
  await card('Trim').hover()
  await page.getByRole('button', { name: 'Remove trim' }).click()
  await page.waitForFunction(() => { const t = document.querySelector('.cm-content').textContent; return /\.normalize\(-[\d.]+\)/.test(t) && !t.includes('trim') })
  assert.deepEqual(await page.locator('.step-name').allInnerTexts(), ['chime.wav', 'Normalize', 'Fade'])
  // Add an edit, right under the last card
  const [lastCard, add] = await Promise.all([page.locator('.step').last().boundingBox(), page.locator('.add-step').boundingBox()])
  assert.ok(add.y - (lastCard.y + lastCard.height) < 12, `right under it: ${add.y - (lastCard.y + lastCard.height)}px`)
  // two acts, its eye and ×, over its right end, taking no room: what it is set to runs to the card's edge
  await card('Fade').hover()
  assert.deepEqual(await card('Fade').locator('.step-acts button').evaluateAll(b => b.map(x => x.getAttribute('aria-label'))), ['Turn fade off', 'Remove fade'])
  const [whole, args] = await Promise.all([card('Fade').boundingBox(), card('Fade').locator('.step-args').boundingBox()])
  assert.ok(whole.x + whole.width - (args.x + args.width) <= 13, `to the card's edge: ${whole.x + whole.width - (args.x + args.width)}px short`)
})

// The palette (⌘K), a notch over the picture: the edits for what is selected, then every method by kind; the words
// typed find one, the arrows go through them, Enter adds it, on the selection, and the panel turns to the edits with
// its card open. One the library can't run without a value gets its default written. Escape closes it.
test('editor: an edit from the palette goes on the selection, its card open among the edits', async () => {
  await open()
  const { box, x } = await axis(6.525), y = box.y + tall(box) * .3
  await drag([x(1.01), y], [x(2.01) - x(1.01), 0])
  await page.keyboard.press('ControlOrMeta+K')
  const groups = await page.locator('.palette-group').allInnerTexts()
  assert.ok(groups[0] === 'For the selection' && groups.includes('Filter'), groups.join())
  assert.match(await page.locator('.tool-target').innerText(), /^For the selection, 0:01\.\d+–0:02\.\d+$/)
  await page.keyboard.press('Escape')
  await page.locator('#palette:popover-open').waitFor({ state: 'detached' })
  await page.keyboard.press('ControlOrMeta+K')
  await page.keyboard.type('cut lows')
  assert.deepEqual(await page.locator('.palette-list .tool strong').allInnerTexts(), ['Highpass'])
  await page.keyboard.press('Enter')
  await page.waitForFunction(() => /\.highpass\(80, \{ at: [\d.]+, d: [\d.]+ \}\)$/.test(scriptText()))
  assert.ok(await edits(), 'the edits open on it')
  assert.equal(await page.locator('.step.open .step-name').innerText(), 'Highpass')
  await page.locator('.plot').focus()
  await page.keyboard.press('Escape')
  await wholeLevels().waitFor()
  assert.equal(await page.locator('.message.problem').count(), 0)
})

// Over the picture: its tabs; at its foot, in the bar, undo and redo after the length, before the rate; what it shows
// chosen by its look, in the sound's foot under its axis; none moving as the picture turns. At the slab's top
// right, as an editor's activity bar, the panels' buttons: the recipes, the agent, the edits, the code, the export, the
// settings. A panel docks beside the picture, part of the slab, a rule between them as the slab's own, no title over
// it (its button says which); its button again closes it; its left edge drags its width; the choice and the width are
// remembered. Undo is undo, nothing else
test('editor: undo and redo after the length, a band\'s look in its foot, none moving; the panels\' buttons at the top right; a panel docks beside the picture', async () => {
  await open()
  const box = name => page.locator(name).boundingBox()
  const [panes, view] = await Promise.all(['.panes', '.view-slab'].map(box))
  assert.ok(Math.abs(view.width - panes.width) < 2, 'the picture the whole width')
  // the bar's last, Before, as far in from the slab's right edge as Play is from its left
  const before = await box('.before')
  assert.ok(panes.x + panes.width - before.x - before.width >= 12, `Before clear of the edge: ${panes.x + panes.width - before.x - before.width}`)
  const buttons = await Promise.all(['Recipes', 'Agent', 'Edits', 'Code', 'Export', 'Settings'].map(name => page.getByRole('tab', { name, exact: true }).boundingBox()))
  assert.ok(buttons.every((b, i) => b.y < view.y && (!i || b.x > buttons[i - 1].x)) && buttons.at(-1).x > panes.x + panes.width * .8, 'the panels\' buttons in order at the slab\'s top right')
  assert.equal(await page.locator('.bar .history, .status .panels').count(), 0, 'none in the page\'s bar, none at the foot')
  await tab('Edits')
  await page.locator('.stack').waitFor()
  await page.locator('.script').waitFor({ state: 'hidden' })
  assert.equal(await page.locator('.panel-head, .panel-title').count(), 0, 'no title over it: its button, lit, says which it is')
  assert.equal(await page.locator('.side-slab').getAttribute('aria-label'), 'Edits')
  const [narrow, side, plot] = await Promise.all(['.view-slab', '.side-slab', '.plot'].map(box))
  assert.ok(narrow.width < view.width - 200 && side.x >= narrow.x + narrow.width - 1 && side.y >= buttons[0].y + buttons[0].height, 'docked beside the picture, under the buttons')
  // in the bar at the picture's foot: undo, redo, after the length, before the rate; what the picture shows, chosen by
  // its look in the sound's foot under its axis, none of them moving as the picture turns
  const heads = () => Promise.all([page.getByRole('button', { name: 'Undo', exact: true }), page.getByRole('button', { name: 'Redo', exact: true }), page.locator(':is(.lane-look, .layer-look):visible')].map(b => b.boundingBox()))
  const [undo, redo, look] = await heads()
  const length = await box('.length'), rate = await box('.facts')
  assert.ok(undo.y > plot.y + plot.height && undo.x >= length.x + length.width && undo.x < redo.x && redo.x + redo.width < rate.x, 'undo, redo at the foot, after the length, before the rate')
  // one baseline: the time's, the length's, the status's words, the arrows' feet; a narrower bar's smaller time keeps it
  const baselines = () => page.evaluate(() => {
    const base = e => { const i = document.createElement('i'); i.style.cssText = 'display: inline-block; width: 0; height: 0'; e.append(i); const y = i.getBoundingClientRect().y; i.remove(); return y }
    return { time: base(document.querySelector('.time')), length: base(document.querySelector('.length')), facts: base(document.querySelector('.facts .fact')), feet: document.querySelector('.status .undo path').getBoundingClientRect().bottom }
  })
  const wide = await baselines()
  assert.ok(Object.values(wide).every(y => Math.abs(y - wide.length) <= 1.5), `on one baseline: ${JSON.stringify(wide)}`)
  const size = await page.viewportSize()
  await page.setViewportSize({ width: 860, height: size.height })
  await page.waitForFunction(() => getComputedStyle(document.querySelector('.clock')).getPropertyValue('--time-size').trim() === '28px')
  const smaller = await baselines()
  assert.ok(Math.abs(smaller.time - wide.time) <= 1 && Math.abs(smaller.feet - wide.feet) <= 1, `the smaller time on the same baseline: ${JSON.stringify(smaller)}`)
  await page.setViewportSize(size)
  const axis = plot.x + plot.width - await gutter(), foot = plot.y + tall(plot)
  assert.ok(Math.abs(look.x - axis - 1) <= 1 && Math.abs(look.y - foot - 1) <= 1, `the look in the sound's foot, under its axis: ${look.x}, ${look.y}; ${axis}, ${foot}`)
  await show('spec')
  assert.deepEqual((await heads()).map(b => b.x), [undo, redo, look].map(b => b.x), 'nothing moved as it turned')
  await show('wave')
  // part of the slab: no ground of its own; between it and the picture a rule in the slab's rule colour, as far from its
  // content as that is from the slab's edge
  assert.equal(await page.locator('.side-slab').evaluate(el => [getComputedStyle(el).backgroundColor, getComputedStyle(el).boxShadow].join(' ')), 'rgba(0, 0, 0, 0) none')
  const rule = await page.locator('.panel-edge').evaluate(el => { const r = getComputedStyle(el, '::before'), probe = Object.assign(document.createElement('i'), { style: 'color: var(--color-screen-rule)' }); el.append(probe); const want = getComputedStyle(probe).color; probe.remove(); return { color: r.backgroundColor, want, x: el.getBoundingClientRect().x + parseFloat(r.left), width: parseFloat(r.width) } })
  assert.equal(rule.color, rule.want, 'the slab\'s rule colour')
  assert.equal(rule.width, 1)
  const [card, panel] = await Promise.all([page.locator('.step').first().boundingBox(), box('.side-slab')])
  assert.ok(Math.abs((card.x - (rule.x + 1)) - (panel.x + panel.width - (card.x + card.width))) <= 1, `as far from the cards as they are from the edge: ${card.x - rule.x - 1}, ${panel.x + panel.width - card.x - card.width}`)
  await page.locator('.step-name', { hasText: 'Normalize' }).click()
  await page.locator('.step.open .params input[type=range]').first().fill('500')
  await page.locator('.readout', { hasText: '−18.0dBFS' }).waitFor()
  // a right-click on undo undoes nothing and opens nothing; a click undoes
  await page.getByRole('button', { name: 'Undo', exact: true }).click({ button: 'right' })
  await page.keyboard.press('Escape')
  assert.match(await code(), /normalize\(-18\)/, 'nothing undone')
  assert.equal(await page.locator('.side-slab').getAttribute('aria-label'), 'Edits', 'the panel as it was')
  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  await page.waitForFunction(() => scriptText().includes('.normalize(-1)'))
  // its button again closes it
  await page.getByRole('tab', { name: 'Edits', exact: true }).click()
  await page.locator('.side-slab').waitFor({ state: 'hidden' })
  // another panel's button turns it to that one; again, it closes
  await tab('Code')
  await page.locator('.script').waitFor()
  await page.getByRole('tab', { name: 'Code', exact: true }).click()
  await page.locator('.side-slab').waitFor({ state: 'hidden' })
  // its left edge drags its width, kept, and so is the panel shown
  await tab('Export')
  const was = await box('.side-slab'), edge = await box('.panel-edge'), y = edge.y + edge.height / 2
  await page.mouse.move(edge.x + edge.width / 2, y)
  await page.mouse.down()
  await page.mouse.move(edge.x + edge.width / 2 - 100, y, { steps: 5 })
  await page.mouse.up()
  const wider = await box('.side-slab')
  assert.ok(Math.abs(wider.width - was.width - 100) < 3, `${was.width} → ${wider.width}`)
  await page.reload()
  // rendered: the readout says so, out of sight where the wider panel leaves the bar too narrow for it (editor.css)
  await wholeLevels().waitFor({ state: 'attached' })
  await page.locator('.export').waitFor()
  assert.ok(Math.abs((await box('.side-slab')).width - wider.width) < 2, 'its width kept')
  await page.getByRole('tab', { name: 'Export', exact: true }).click()
  await page.locator('.side-slab').waitFor({ state: 'hidden' })
})

// A panel opening beside the picture leaves it where it starts and at its scale, less of the sound showing, never
// squeezed; so does a narrower window. A range on silence, its edges' columns: the caret's line at its start, the
// wash's last, the same before and after
test('editor: a panel opening, or the window narrowing, keeps where the picture starts and its scale', async () => {
  await open()
  await noCues()
  await write(`audio.from(2)`)
  await lengthIs('0:02.000')
  const view = await page.locator('.view-slab').boundingBox()
  await drag([view.x + 300, view.y + 60], [200, 0])
  await page.mouse.move(view.x + 5, view.y + view.height - 30)
  // read on a row 60 px down the lane: where the selection's wash begins, and the caret's line, at its end (where the
  // drag left it)
  const edges = () => pixels(`const at = px => d[(60 * w + px) * 4]; let start = -1, line = 0; for (let px = 1; px < w - 60; px++) { if (at(px) > at(line)) line = px; if (start < 0 && at(px) > at(px - 1) + 4) start = px } return [start, line]`)
  const before = await edges()
  assert.ok(before[1] - before[0] > 190, JSON.stringify(before))
  await tab('Export')
  await page.waitForTimeout(200)
  assert.deepEqual(await edges(), before, 'the panel open')
  await page.setViewportSize({ width: 1000, height: 720 })
  await page.waitForTimeout(200)
  assert.deepEqual(await edges(), before, 'the window narrower')
})

// A number in the code drags, as Bret Victor's Tangle has it: across, a step (its last decimal's) for every 4 px, the
// output following as it goes; let go, one step of the history. A minus before it is its own
test('editor: a number in the code drags, the output following, one step of the history', async () => {
  await open()
  await tab('Code')
  const one = page.locator('.cm-line', { hasText: '.normalize(' }).locator('span', { hasText: /^1$/ })
  const at = await one.boundingBox(), y = at.y + at.height / 2
  await page.mouse.move(at.x + at.width / 2, y)
  await page.mouse.down()
  assert.equal(await one.evaluate(el => getComputedStyle(el).cursor), 'ew-resize', 'its pointer says it drags')
  await page.mouse.move(at.x + at.width / 2 - 22, y, { steps: 5 })
  await page.waitForFunction(() => scriptText().includes('.normalize(-6)'))
  await page.locator('.readout', { hasText: '−6.0dBFS' }).waitFor()
  await page.mouse.up()
  await page.keyboard.press('ControlOrMeta+Z')
  await page.waitForFunction(() => scriptText().includes('.normalize(-1)'))
  // through zero, its minus its own: −1, 9 px right (two steps), is 1; a decimal steps by its last place: 0.02, 9 px
  // right, is 0.04
  const drag9 = async locator => { const b = await locator.boundingBox(), cy = b.y + b.height / 2; await page.mouse.move(b.x + b.width / 2, cy); await page.mouse.down(); await page.mouse.move(b.x + b.width / 2 + 9, cy, { steps: 3 }); await page.mouse.up() }
  await drag9(page.locator('.cm-line', { hasText: '.normalize(' }).locator('span', { hasText: /^1$/ }))
  await page.waitForFunction(() => scriptText().includes('.normalize(1)'))
  await drag9(page.locator('.cm-line', { hasText: '.fade(' }).locator('span', { hasText: /^0\.02$/ }))
  await page.waitForFunction(() => scriptText().includes('.fade(0.04, 0.1)'))
  // only pressed, the caret goes there and nothing changes
  const before = await code(), two = page.locator('.cm-line', { hasText: '.fade(' }).locator('span', { hasText: /^0\.1$/ }), b = await two.boundingBox()
  await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2)
  await page.waitForTimeout(200)
  assert.equal(await code(), before)
})

// Two edits on the picture, the second made while the first's script still runs (each run held 1.5 s by a loop): the
// first's output, when it comes, is not the one the picture waits for, and the view holds where it is and its scale
// until the second's comes. Taken for it (once, now and then, under load), it ended the wait, and the second's output,
// arriving unlooked-for, showed all of the sound again, moving it under the pointer
test('editor: an older output arriving while a newer edit is drawn ahead leaves the view where it is', async () => {
  await open()
  await noCues()
  await write(`for (const t = Date.now(); Date.now() - t < 1500;);\naudio('chime.wav')`)
  await lengthIs('0:08.000')
  const { box, x } = await axis(8), y = box.y + tall(box) * .3
  await drag([x(1), y], [x(2) - x(1), 0])
  await page.keyboard.press('Delete')
  await page.waitForTimeout(700)
  await drag([x(3), y], [x(4) - x(3), 0])
  await page.keyboard.press('Delete')
  await page.waitForFunction(() => (scriptText().match(/\.remove\(/g) || []).length === 2)
  await lengthIs('0:06.000')
  await page.waitForTimeout(300)
  await drag([x(5), y], [x(5.5) - x(5), 0])
  assert.equal(await selected(), '0:05.000–0:05.500', 'the scale as it was: 8 s across')
})

// Moved past the sound's end, a slice opens silence up to where it lands: the sound gets longer
test('editor: a slice moved past the end opens silence up to where it lands', async () => {
  const { x, y } = await chime()
  await drag([x(6), y], [x(7) - x(6), 0])
  await keyed(['ControlOrMeta'], () => drag([x(6.5), y], [x(7.9) - x(6.5), 0]))
  // where it lands, to the pixel the zoom's step rounds to (fonts and widths differ from one machine to another)
  await page.waitForFunction(() => /\.move\(\{ at: 6, d: 1, to: [\d.]+, xfade: 0\.01 \}\)$/.test(scriptText()))
  const to = +(await code()).match(/to: ([\d.]+), xfade/)[1]
  assert.ok(Math.abs(to - 7.4) <= .011, `lands at ${to}`)
  await lengthIs(`0:0${(to + 1).toFixed(3)}`)
})

// A slice dragged up over the head onto the tabs goes to a tab of its own, this one's script cropped to it: copied (Alt),
// this one as it was; moved (⌘), it leaves this one, the rest closing up as a cut's
test('editor: a slice dragged onto the tabs goes to a tab of its own; moved, it leaves this one', async () => {
  const { x, y } = await chime()
  const up = async (keys, select = true) => {
    if (select) await drag([x(1), y], [x(2) - x(1), 0])
    const files = await page.locator('.files').boundingBox()
    await keyed(keys, () => drag([x(1.5), y], [files.x + files.width / 2 - x(1.5), files.y + files.height / 2 - y]))
  }
  await up(['Alt'])
  await page.waitForFunction(() => document.querySelectorAll('.file').length === 2)
  await page.waitForFunction(() => scriptText() === "audio('chime.wav')\n  .crop({ at: 1, d: 1 })")
  await lengthIs('0:01.000')
  await page.locator('.file [role="tab"]').first().click()
  await page.waitForFunction(() => scriptText() === "audio('chime.wav')")
  await lengthIs('0:08.000')
  // the tab's selection as it was left
  await page.waitForFunction(() => (e => e.title || e.dataset.tip || '')(document.querySelector('.clock')).startsWith('Selected 0:01.000–0:02.000:'))
  await up(['ControlOrMeta'], false)
  await page.waitForFunction(() => document.querySelectorAll('.file').length === 3)
  await page.waitForFunction(() => scriptText() === "audio('chime.wav')\n  .crop({ at: 1, d: 1 })")
  await page.locator('.file [role="tab"]').first().click()
  await page.waitForFunction(() => scriptText() === "audio('chime.wav')\n  .remove({ at: 1, d: 1, xfade: 0.01 })")
  await lengthIs('0:07.000')
})

// Tabs drag along to reorder, as a browser's; the order is kept for the next visit
test('editor: a tab dragged along the others goes where it is let go, kept for the next visit', async () => {
  await open()
  await page.getByRole('button', { name: 'New tab' }).click()
  const names = () => page.locator('.file [role="tab"]').allInnerTexts()
  assert.deepEqual(await names(), ['chime.wav', 'untitled'])
  const [first, second] = await Promise.all([0, 1].map(i => page.locator('.file').nth(i).boundingBox()))
  await page.mouse.move(first.x + 20, first.y + first.height / 2)
  await page.mouse.down()
  // short of half the other: it holds its place; past it, it steps aside
  await page.mouse.move(first.x + 20 + second.x + second.width / 2 - (first.x + first.width) - 4, first.y + first.height / 2, { steps: 4 })
  assert.equal(await page.locator('.file').nth(1).evaluate(el => el.style.transform), '', 'held under half')
  await page.mouse.move(first.x + 20 + second.x + second.width / 2 - (first.x + first.width) + 4, first.y + first.height / 2, { steps: 2 })
  // held under the pointer, the other stepped aside to make room
  const shifts = await page.locator('.file').evaluateAll(els => els.map(el => el.style.transform))
  assert.ok(/^translateX\(\d/.test(shifts[0]) && /^translateX\(-/.test(shifts[1]), JSON.stringify(shifts))
  await page.mouse.up()
  assert.deepEqual(await names(), ['untitled', 'chime.wav'])
  assert.deepEqual(await page.locator('.file').evaluateAll(els => els.map(el => el.style.transform)), ['', ''], 'laid out as it was let go')
  await page.waitForTimeout(600)
  await page.reload()
  await page.locator('.file').first().waitFor()
  assert.deepEqual(await names(), ['untitled', 'chime.wav'])
})

// A tab left as its sound renders renders on: its mark turns in the close button's place as it does, a dot once it is
// made; shown again, its sound is there at once, the dot gone. The tab shown meanwhile works as ever
test('editor: a tab left as it renders renders on, marked, its sound there when it is shown again', async () => {
  await open()
  const SLOW = `audio.op('slow', { prepare: () => new Promise(done => setTimeout(done, 2500)), process: (input, output) => input.forEach((x, c) => output[c].set(x)) })\n`
  const mark = i => page.locator('.file').nth(i).getAttribute('data-mark')
  await write(SLOW + `audio('chime.wav').slow()`)
  await page.waitForFunction(() => document.querySelector('.file')?.dataset.mark === 'working')
  await page.getByRole('button', { name: 'New tab' }).click()
  await write(`audio('chime.wav').gain(-6)`)
  await lengthIs('0:08.000')
  assert.equal(await mark(0), 'working', 'the tab left still renders')
  assert.equal(await page.locator('.file').first().locator('[role="tab"]').getAttribute('aria-busy'), 'true')
  await page.waitForFunction(() => document.querySelector('.file')?.dataset.mark === 'ready', null, { timeout: 10000 })
  assert.equal(await mark(1), null, 'the tab shown, at rest, unmarked')
  await page.locator('.file [role="tab"]').first().click()
  await lengthIs('0:08.000')
  assert.equal(await mark(0), null, 'seen: the dot goes')
  assert.equal(await page.locator('.status .message').innerText(), '', 'nothing rendering')
})

// The page's state is one object literal, as are its menus' and its views': a key written twice there is silently the
// last one (the ring's share of the sound, named `progress` for a moment, took the status bar's word away), so none is
test('editor: no object literal in the page names a key twice', async () => {
  const { build } = await import('esbuild')
  const entryPoints = (await readdir(`${root}/playground`)).filter(f => f.endsWith('.js')).map(f => `${root}/playground/${f}`)
  const { warnings } = await build({ entryPoints, write: false, bundle: false, outdir: 'out', logLevel: 'silent' })
  assert.deepEqual(warnings.filter(w => w.id === 'duplicate-object-key').map(w => `${w.location.file}:${w.location.line} ${w.text}`), [])
})

// The sound's end, three quarters across the view zoomed out as far as it goes: where its centre line stops, its silence
// drawn up to it as the level it is, and the grid with it; no rule over it, nothing past it
test('editor: the sound\'s end is where its centre line stops: no rule over it, nothing past it, no grid either', async () => {
  await page.route('**/playground/editor.js', async route => { const r = await route.fetch(); route.fulfill({ response: r, body: (await r.text()).replace('v = view(', 'v = globalThis.__view = view(') }) })
  await open()
  await noCues()
  await write(`audio.from(t => t < 1 ? .5 * Math.sin(2 * Math.PI * 220 * t) : 0, { duration: 2 })`)
  await lengthIs('0:02.000')
  await page.evaluate(() => { __view.frame = { range: [0, 8 / 3] } })
  await page.mouse.move(2, 2)
  await page.waitForTimeout(300)
  assert.deepEqual(await page.evaluate(() => __view.range), [0, 8 / 3])
  // the plot's CSS px: the end three quarters across; a column bright anywhere down the lane, in the screenshot (the
  // centre line, 78% grey, over a near-black screen); past it, to 0.9 of the way, short of the meters
  const box = await page.locator('.plot').boundingBox(), w = box.width - (await gutter()), end = w * 3 / 4, far = w * .9
  const { k, lit } = await pixels(`const k = w / arg.width, lane = h - 22 * k, lit = []
    for (let x = 0; x < Math.round(arg.to * k); x++) for (let y = 0; y < lane; y++) { const i = (y * w + x) * 4; if (d[i] + d[i + 1] + d[i + 2] > 300) { lit.push(x / k); break } }
    return { k, lit }`, { width: box.width, to: w * .9 })
  const last = Math.max(...lit), silent = lit.filter(x => x > end * .6 && x < end - 2).length / Math.floor((end * .4 - 2) * k)
  assert.ok(Math.abs(last - end) <= 1.5, `the centre line ends at the end: ${last} px, the end ${end} px`)
  assert.ok(silent > .95, `the silence before it drawn, its centre line: ${(silent * 100).toFixed(0)}% of its columns`)
  // the overlay, the grid: nothing at the end column or past it in the overlay; the grid where the sound is, not past it
  await settings('Grid', 'Lines')
  await gridShown('Lines')
  const { rule, inside, beyond } = await page.evaluate(([end, far]) => {
    const sum = (canvas, from, to) => { const k = canvas.width / canvas.clientWidth, { data, width, height } = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height - Math.round(22 * k)); let s = 0; for (let x = Math.round(from * k); x < Math.round(to * k); x++) for (let y = 0; y < height; y++) s += data[(y * width + x) * 4 + 3]; return s }
    // what shows of it: a level apart or more (a canvas composited a fraction of a pixel over is a level off here and there)
    const shown = (from, to) => { const { k, w, h, d } = window.__shown; let s = 0; for (let x = Math.round(from * k); x < Math.round(to * k); x++) for (let y = 0; y < h - Math.round(22 * k); y++) s += d[y * w + x] > 1 ? d[y * w + x] : 0; return s }
    return { rule: sum(document.querySelector('canvas.overlay'), end - 1, far), inside: shown(0, end - 1), beyond: shown(end + 1, far) }
  }, [end, far])
  assert.equal(rule, 0, 'no rule over the end, nothing past it')
  assert.ok(inside > 0, 'the grid where the sound is')
  assert.equal(beyond, 0, 'none past its end')
})

// The view short of the sound's end, its lanes fade there into the ground they lie on, the slab's, shaded to its foot: at
// the lane's foot as at its top, the fade's last column the ground's colour, no band of another; the centre line fading
// into it; the foot under the lanes, past the caret's reach, untouched
test('editor: zoomed in, the lanes fade at their end into the slab\'s own ground, as tall as the caret', async () => {
  await open()
  await noCues()
  await write(`audio.from(t => .2 * Math.sin(2 * Math.PI * 220 * t), { duration: 4 })`)
  await lengthIs('0:04.000')
  await page.locator('.plot').focus()
  await page.keyboard.press('=')
  await page.mouse.move(2, 2)
  await page.waitForTimeout(600)
  const box = await page.locator('.plot').boundingBox(), end = Math.round(await spans(box)) + TAIL, lane = tall(box)
  const r = await pixels(`const at = (x, y) => d[(Math.round(y) * w + Math.round(x)) * 4], row = y => [at(arg.end - 2, y), at(arg.end - 100, y)]
    return { top: row(3), foot: row(arg.lane - 6), under: row(arg.lane + 8), centre: row(arg.lane / 2) }`, { end, lane })
  const same = ([a, b]) => Math.abs(a - b) <= 2
  assert.ok(same(r.top) && same(r.foot) && same(r.under), `the ground's colour at the fade's end: ${JSON.stringify(r)}`)
  assert.ok(r.centre[0] < r.centre[1] - 40, `the centre line faded: ${JSON.stringify(r.centre)}`)
})

// The slab is plain, its ground shaded to its foot: no lines over it, which read as the lanes' rules
test('editor: the slab has no scanlines', async () => {
  await open()
  assert.equal(await page.locator('.panes').evaluate(e => getComputedStyle(e).backgroundImage.match(/gradient/g).length), 1)
})

// A phone held upright: the picture over the panel, half of the slab each, the bar between them; the panels' buttons
// along the slab's foot, each staying where it is as its panel opens and closes; over the picture its head alone, undo
// in the bar after the time
test('editor: on a phone the panel opens under the picture, its buttons at the foot where they stay', async () => {
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true })
  const p = await phone.newPage()
  await chimeLeft(p)
  p.on('pageerror', e => errors.push(e.message))
  try {
    await p.goto(origin + '/playground/')
    await p.waitForFunction(() => document.querySelector('.readout')?.dataset.of === 'all')
    const box = selector => p.locator(selector).boundingBox(), edits = p.getByRole('tab', { name: 'Edits', exact: true })
    const [slab, status, button] = [await box('.panes'), await box('.status'), await edits.boundingBox()]
    assert.ok(button.y >= status.y + status.height - 1 && slab.y + slab.height - (button.y + button.height) < 12, `at the foot: ${JSON.stringify({ slab, status, button })}`)
    assert.ok(button.width >= 44 && button.height >= 44, 'a finger\'s size')
    const time = await box('.time'), undo = await box('.history .undo')
    assert.ok(undo.x >= time.x + time.width && undo.y >= status.y && undo.y + undo.height <= status.y + status.height, `undo in the bar after the time: ${JSON.stringify({ time, undo })}`)
    await edits.tap()
    await p.locator('.side-slab .add-step').waitFor()
    assert.deepEqual(await edits.boundingBox(), button, 'where it was')
    const [view, side, under] = [await box('.view-slab'), await box('.side-slab'), await box('.status')]
    assert.ok(view.y + view.height <= under.y + 1 && side.y >= under.y + under.height - 1, 'the picture, the bar, the panel')
    assert.ok(Math.abs(view.height - side.height) < 2, `half and half: ${view.height}, ${side.height}`)
    await edits.tap()
    await p.locator('.side-slab').waitFor({ state: 'hidden' })
    assert.ok((await box('.view-slab')).height > view.height * 1.8, 'closed, the picture whole again')
  } finally { await phone.close() }
})

// A selection dragged draws what is over the sound alone, never the sound's own pictures again: each drawn anew every
// move held a phone's drag back, a window-wide waveform and the grid cut by it at each
test('editor: dragging a selection draws no picture of the sound again, only what is over it', async () => {
  await page.addInitScript(() => {
    window.drawn = 0
    const draw = WebGL2RenderingContext.prototype.drawArrays
    WebGL2RenderingContext.prototype.drawArrays = function (...args) { if (this.canvas.closest?.('.plot')) window.drawn++; return draw.apply(this, args) }
  })
  await open()
  await page.waitForTimeout(500)
  const box = await page.locator('.plot').boundingBox(), y = box.y + tall(box) / 3, frame = () => page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))))
  await page.mouse.move(box.x + 100, y)
  await page.mouse.down()
  await frame()
  const from = await page.evaluate(() => drawn)
  for (let i = 1; i <= 16; i++) { await page.mouse.move(box.x + 100 + i * 12, y); await frame() }
  const moved = await page.evaluate(() => drawn) - from
  await page.mouse.up()
  assert.equal(moved, 0, 'no picture drawn as it moved')
  assert.match(await selected(), /–/)
})

// The axis at the pictures' right is as wide as its labels and the pointer's value read out on it, five characters at
// full scale: a sample value to a digit finer than the marks (−0.03), decibels to a tenth with no unit (−12.3), a
// frequency to three digits (1.23k), the spectrogram's level whole (−100); it goes on to the right of its tick, never
// back over the meters. Either picture, either unit, the same, so nothing moves as one turns to the other
test('editor: the axis is five characters wide at full scale, the same for either picture and either unit', async () => {
  await open()
  await tab('Edits')
  const axis = () => page.evaluate(() => parseFloat(getComputedStyle(document.querySelector('.panes')).getPropertyValue('--axis')))
  await page.waitForFunction(() => getComputedStyle(document.querySelector('.panes')).getPropertyValue('--axis'))
  const wave = await axis()
  const [five, six] = await page.evaluate(() => { const g = document.createElement('canvas').getContext('2d'); g.font = `${parseFloat(getComputedStyle(document.querySelector('.plot')).getPropertyValue('--font-size-label')) || 10}px ${getComputedStyle(document.querySelector('.plot')).getPropertyValue('--font-mono')}`; return ['−0.03', '−12.3d'].map(t => g.measureText(t).width) })
  assert.ok(wave >= five + 4 && wave < six + 4, `${wave} px: five characters, ${five} px, and not six`)
  // what the axis says with the pointer in a lane, 0.4 of full scale up: its labels and the pointer's value, none over
  // five characters
  const plot = await page.locator('.plot').boundingBox()
  await page.evaluate(() => {
    window.__said = []
    const text = CanvasRenderingContext2D.prototype.fillText
    CanvasRenderingContext2D.prototype.fillText = function (s, x, y) { if (this.canvas.matches('.overlay')) window.__said.push({ s, x }); return text.call(this, s, x, y) }
  })
  const lane = (tall(plot) - LANES) / 2, y = plot.y + lane / 2 - lane * .2
  const said = async () => {
    await page.evaluate(() => window.__said = [])
    await page.mouse.move(plot.x + plot.width / 3, y + (said.n = (said.n ?? 0) + 1) % 2 * 4)
    await page.waitForTimeout(200)
    const list = (await page.evaluate(() => window.__said)).filter(t => t.x >= plot.width - wave).map(t => t.s)
    assert.ok(list.length && list.every(t => t.length <= 5), `five characters at most: ${list}`)
    return list
  }
  assert.ok((await said()).some(t => /^0\.\d\d$/.test(t)), 'a sample value to two decimals, 0.40 or so')
  await show('spec')
  await page.waitForTimeout(300)
  assert.equal(await axis(), wave, 'the spectrogram the same')
  await said()
  await show('wave')
  await settings('Levels in', 'Decibels')
  await page.waitForTimeout(300)
  assert.equal(await axis(), wave, 'the levels in decibels the same')
  assert.ok((await said()).some(t => /^−\d{1,2}\.\d$/.test(t)), 'decibels to a tenth, no unit')
})

// The lanes bare (Grid: None, the default); with Lines (View, Grid), a faint line down from each of the time row's ticks
// and across from each of the level axis', where the sound is quiet (2.5 to 3 s): at 2.5 s and at 0.5, none between the
// ticks, none behind the waveform where a hit is (0.5 s, 0). In decibels, across from −6 dB's tick. With None, or with no
// sound, nothing at all
test('editor: the lanes bare, or lines from the ticks; hidden behind the waveform, and gone with None or no sound', async () => {
  await open()
  await page.mouse.move(2, 2)
  // the ticks drawn over the sound (the overlay's, the reel's marks: the time row's), each followed by its label
  await page.evaluate(() => {
    window.__ticks = []
    const proto = CanvasRenderingContext2D.prototype, rect = proto.fillRect, text = proto.fillText
    proto.fillRect = function (x, y, w, h) { if (this.canvas.matches('.overlay, .marks, .row')) window.__ticks.push({ x, y, w, h }); return rect.call(this, x, y, w, h) }
    proto.fillText = function (s, x, y) { if (this.canvas.matches('.overlay, .marks, .row')) window.__ticks.push({ s }); return text.call(this, s, x, y) }
  })
  // its rects, drawn as triangles in the waveform's canvas (view.js paintGrid; a waveform draws a strip), counted as the
  // picture is drawn
  await page.evaluate(() => {
    window.__ruled = 0
    const proto = WebGL2RenderingContext.prototype, draw = proto.drawArrays
    proto.drawArrays = function (...a) { if (a[0] === this.TRIANGLES && this.canvas.matches('.waveform')) window.__ruled += a[2]; return draw.apply(this, a) }
  })
  // none drawn as the picture is drawn again (the window a pixel narrower and back)
  const blank = async () => {
    await page.evaluate(() => window.__ruled = 0)
    const size = page.viewportSize()
    await page.setViewportSize({ ...size, width: size.width - 1 })
    await page.waitForTimeout(200)
    await page.setViewportSize(size)
    await page.waitForTimeout(200)
    return !await page.evaluate(() => window.__ruled)
  }
  assert.ok(await blank(), 'bare by default: nothing ruled')
  await settings('Grid', 'Lines')
  // the layers laid again, each only as its drawing changes (view.js, kept.js): the pointer over the picture, then off it
  await page.locator('.plot').hover({ position: { x: 10, y: 10 } })
  await page.waitForTimeout(100)
  await page.evaluate(() => window.__ticks = [])
  await page.mouse.move(2, 2)
  await page.waitForTimeout(200)
  const calls = await page.evaluate(() => window.__ticks), at = {}
  calls.forEach((c, i) => { if (c.w && calls[i + 1]?.s) at[calls[i + 1].s] ??= c.h === 1 ? c.y : c.x })
  const [hit, c0, c1, r5, r0] = [at['0:00.5'], at['0:02.5'], at['0:03.0'], at['0.5'], at['0']]
  assert.ok([hit, c0, c1, r5, r0].every(Number.isFinite), `ticks at 0.5 s, 2.5 s, 3 s, 0.5 and 0: ${JSON.stringify(at)}`)
  // the most a 3 × 3 px square round each point is lit by the grid as it shows (gridShown), CSS px
  const lit = points => page.evaluate(points => {
    const { k, w, d } = window.__shown
    return points.map(([x, y]) => { let m = 0; for (let j = Math.floor((y - 1) * k); j < Math.floor((y - 1) * k) + Math.ceil(3 * k); j++) for (let i = Math.floor((x - 1) * k); i < Math.floor((x - 1) * k) + Math.ceil(3 * k); i++) m = Math.max(m, d[j * w + i]); return m })
  }, points)
  const mid = [(c0 + c1) / 2, (r5 + r0) / 2]
  await gridShown('Lines')
  const [down, across, between, behind] = await lit([[c0, mid[1]], [mid[0], r5], mid, [hit, r0]])
  assert.ok(down && across, 'a line down from 2.5 s and across from 0.5')
  assert.equal(between, 0, 'none between the ticks')
  assert.equal(behind, 0, 'none behind the waveform')
  // the levels in decibels: a line across from −6 dB's tick
  await page.evaluate(() => window.__ticks = [])
  await settings('Levels in', 'Decibels')
  await page.mouse.move(2, 2)
  await page.waitForTimeout(200)
  const db = await page.evaluate(() => window.__ticks), r6 = db.find((c, i) => c.w && c.h === 1 && db[i + 1]?.s === '−6')?.y
  assert.ok(Number.isFinite(r6), 'a tick at −6 dB')
  await gridShown('Lines')
  assert.ok((await lit([[mid[0], r6]]))[0], 'a line across from −6 dB')
  await settings('Grid', 'Lines')
  assert.ok(!await blank(), 'its rects drawn')
  await settings('Grid', 'None')
  assert.ok(await blank(), 'nothing with None')
  // nor where there is no sound: a new tab, empty
  await settings('Grid', 'Lines')
  await page.getByRole('button', { name: 'New tab' }).click()
  await page.locator('.empty').waitFor()
  assert.ok(await blank(), 'nothing with no sound')
})

// Three faders lying down for the settings, a spark for the agent, an open book for the recipes, the switches joined
// (raised keys in one bezel), the export's icon an arrow down onto a tray; a band's look opens on a click alone
test('editor: the settled icons; the switches are keys in a bezel; a band\'s look right-clicked opens nothing', async () => {
  await open()
  const icon = name => page.getByRole('tab', { name, exact: true }).locator('path').getAttribute('d')
  const faders = await icon('Settings')
  assert.equal(faders.match(/a2\.25 2\.25 0 1 1 0-4\.5/g).length, 3, 'three faders, their round knobs, 4.5 units across')
  assert.deepEqual(faders.match(/M4 \d+h/g), ['M4 6h', 'M4 12h', 'M4 18h'], 'lying down, one over another, 16 units across')
  assert.equal(await icon('Agent'), 'M12 3c.6 4.7 4.3 8.4 9 9-4.7.6-8.4 4.3-9 9-.6-4.7-4.3-8.4-9-9 4.7-.6 8.4-4.3 9-9Z', 'a spark, four curved points')
  assert.equal(await icon('Export'), 'M12 4v11m-5-5 5 5 5-5M4 19h16', 'an arrow down onto a tray')
  assert.equal(await icon('Recipes'), 'M3 5h5a4 4 0 0 1 4 4v11a3 3 0 0 0-3-3H3Zm18 0h-5a4 4 0 0 0-4 4v11a3 3 0 0 1 3-3h6Z', 'an open book')
  await tab('Export')
  // the switches, settled: raised keys in one bezel, each touching the next
  const group = page.locator('.export .choices').first()
  const [first, second] = await group.locator('button').evaluateAll(list => list.slice(0, 2).map(b => b.getBoundingClientRect()).map(r => [r.left, r.right]))
  assert.equal(second[0], first[1], 'raised keys in one bezel')
  assert.match(await group.evaluate(el => getComputedStyle(el).boxShadow), /0px 0px 0px 1px inset/, 'the bezel a ring round them')
  // a band's look right-clicked opens nothing, nor turns it
  await page.getByRole('tab', { name: 'Export', exact: true }).click()
  await page.locator(':is(.lane-look, .layer-look):visible').click({ button: 'right' })
  assert.equal(await page.locator('.dropdown:popover-open').count(), 0, 'no dropdown')
  assert.equal(await shown(), 'Waveform', 'not turned')
})

// The edits as a stack of layers: a step chosen shows the output up to it; an edit made then goes in right after it, the
// steps after it kept, its own card chosen; undo takes it back, the step chosen as it was
test('editor: an edit made with the output rolled back to a step goes in right after it, the steps after it kept', async () => {
  await open()
  await tab('Edits')
  await page.locator('.step-name', { hasText: 'Trim' }).click()
  await page.locator('.viewing', { hasText: 'Up to Trim: ' }).waitFor()
  await wholeLevels().waitFor()
  await page.keyboard.press('m')
  await page.waitForFunction(() => /\.trim\(\)\s*\.mark\(0\)\s*\.normalize\(-1\)\s*\.fade\(0\.02, 0\.1\)$/.test(scriptText().trim()))
  assert.deepEqual(await page.locator('.step-name').allInnerTexts(), ['chime.wav', 'Trim', 'Mark', 'Normalize', 'Fade'])
  await page.locator('.viewing', { hasText: 'Up to Mark: 2 later steps bypassed' }).waitFor()
  await menu('Edit', 'Undo')
  await page.waitForFunction(() => /\.trim\(\)\s*\.normalize\(-1\)\s*\.fade\(0\.02, 0\.1\)$/.test(scriptText().trim()))
  await page.locator('.viewing', { hasText: 'Up to Trim: ' }).waitFor()
})

// Rolled back, a choice that sets the last step again in place (the grip's way, a fade's curve) leaves the steps after
// the one shown alone: only what shows is set again, never a step hidden
test('editor: rolled back to a step, the grip\'s way leaves a stretch after it as it is', async () => {
  const { box, x, y } = await chime(), lh = (tall(box) - LANES) / 2
  await write(`audio('chime.wav').stretch(1.5, { at: 1, duration: 1 })`)
  await lengthIs('0:08.500')
  await tab('Edits')
  await page.locator('.step-name', { hasText: 'chime.wav' }).click()
  await page.locator('.viewing', { hasText: 'The source alone' }).waitFor()
  await lengthIs('0:08.000')
  await drag([x(1), y], [x(2) - x(1), 0])
  await turn(await grab([[x(2) + 8, box.y + lh * 3 / 4]], /^url\(|ew-resize/), 'grip', 'speed')
  await page.waitForTimeout(300)
  assert.equal(await code(), `audio('chime.wav').stretch(1.5, { at: 1, duration: 1 })`)
})

// What is selected is kept beside each step of the history, as a text editor keeps its selections: undo brings back what
// was selected before the step, redo what was selected after it. A stretch makes its range longer: undone, the range is
// as long as it was; a delete leaves a caret: undone, its range is selected again
test('editor: undo brings back what was selected before the step, redo what was selected after it', async () => {
  const { box, x, y } = await chime(), lh = (tall(box) - LANES) / 2
  await drag([x(1), y], [x(2) - x(1), 0])
  await drag(await grab([[x(2) + 8, box.y + lh * 3 / 4]], /^url\(|ew-resize/), [x(1.5) - x(1), 0])
  await page.waitForFunction(() => /\.stretch\(1\.5, \{ at: 1, d: 1 \}\)$/.test(scriptText()))
  assert.equal(await selected(), '0:01.000–0:02.500')
  await page.keyboard.press('ControlOrMeta+Z')
  await page.waitForFunction(() => scriptText() === "audio('chime.wav')")
  assert.equal(await selected(), '0:01.000–0:02.000', 'as before the stretch')
  await page.keyboard.press('ControlOrMeta+Shift+Z')
  await page.waitForFunction(() => /\.stretch\(/.test(scriptText()))
  assert.equal(await selected(), '0:01.000–0:02.500', 'as after it')
  await lengthIs('0:08.500')
  await page.keyboard.press('Delete')
  await page.waitForFunction(() => /\.remove\(/.test(scriptText()))
  assert.equal(await selected(), '')
  await page.keyboard.press('ControlOrMeta+Z')
  await page.waitForFunction(() => !/\.remove\(/.test(scriptText()))
  assert.equal(await selected(), '0:01.000–0:02.500', 'the range deleted, selected again')
})

// The menus by what they act on: the file, the selection, what is selected, the view, the tracks, the methods, what
// plays and records. Each row does something: no row that only says what to do elsewhere (a disabled sentence), the
// methods once (Process, not Edit too), the takes under Transport, as Record is
test('editor: the menus, each by what it acts on, every row an action', async () => {
  await open()
  assert.deepEqual(await page.locator('.menubar-item').allInnerTexts(), ['File', 'Edit', 'Select', 'View', 'Track', 'Process', 'Transport', 'Help'])
  const rows = async name => {
    await page.locator('.menubar-item', { hasText: new RegExp(`^${name}$`) }).click()
    const list = await page.locator('.menubar-list:popover-open > .menu-row').evaluateAll(r => r.map(x => ({ label: x.querySelector('.menu-label').textContent, sub: x.classList.contains('has-sub') })))
    await page.keyboard.press('Escape')
    return list
  }
  const all = {}
  for (const name of ['File', 'Edit', 'Select', 'View', 'Track', 'Process', 'Transport']) all[name] = await rows(name)
  const labels = Object.values(all).flat().map(r => r.label)
  assert.ok(labels.every(l => !/^(A click|Another range|Shift with)/.test(l)), 'no sentence for a row')
  assert.deepEqual(labels.filter((l, i) => labels.indexOf(l) !== i), [], 'each row once')
  assert.ok(all.Edit.length <= 12 && all.Select.length <= 7, `Edit ${all.Edit.length}, Select ${all.Select.length}`)
  assert.ok(all.Transport.some(r => r.label === 'Takes') && all.Transport.some(r => /^Record/.test(r.label)))
})

test('editor: Undo steps back through the script, a slider drag one step however long it pauses', async () => {
  await open()
  // Edit > Undo, as the keys, what there is to undo named
  const row = name => page.locator('.menubar-list .menu-row', { has: page.locator('.menu-label', { hasText: new RegExp(`^${name}$`) }) })
  const undoable = async () => { await page.locator('.menubar-item', { hasText: /^Edit$/ }).click(); const off = await row('Undo').getAttribute('aria-disabled'); await page.keyboard.press('Escape'); return off !== 'true' }
  assert.equal(await undoable(), false, 'nothing to undo yet')
  await tab('Edits')
  await page.locator('.step-name', { hasText: 'Normalize' }).click()
  const slider = await page.locator('.params input[type=range]').first().boundingBox(), y = slider.y + slider.height / 2
  await page.mouse.move(slider.x + slider.width * .3, y)
  await page.mouse.down()
  await page.mouse.move(slider.x + slider.width * .45, y, { steps: 5 })
  // longer than the history joins typing across
  await page.waitForTimeout(700)
  await page.mouse.move(slider.x + slider.width * .6, y, { steps: 5 })
  await page.mouse.up()
  assert.doesNotMatch(await code(), /normalize\(-1\)/)
  await menu('Edit', 'Undo')
  await page.waitForFunction(() => scriptText().includes('normalize(-1)'))
  assert.equal(await undoable(), false, 'back where it started')
  // what was done: the step undone, still there to redo, named by what it changed (Edit > History, newest first)
  await page.locator('.menubar-item', { hasText: /^Edit$/ }).click()
  await row('History').click()
  const steps = await page.locator('.menubar-list[aria-label="History"]').locator('.menu-label').allInnerTexts()
  await page.keyboard.press('Escape')
  assert.match(steps[0], /^normalize: -1 → -?[\d.]+$/)
  assert.equal(steps[1], 'The script as it opened')
})

// The caret is where a drag leaves the selection's moving end, as a text's: dragged either way, the end let go; the
// clock reads it, and once the selection is gone it stays there; Play still plays the selection from its start.
// Double-clicked, at its start
test('editor: the caret is where a drag left the selection\'s moving end; double-clicked, at its start', async () => {
  await open()
  await noCues()
  const before = await seconds(), { box, x } = await axis(before), clock = () => page.locator('.time').innerText()
  // (the second begun off the caret the first left, whose line a press would drag)
  for (const [from, to] of [[.25, .5], [.6, .3]]) {
    await page.mouse.move(x(before * from), box.y + 100)
    await page.mouse.down()
    await page.mouse.move(x(before * to), box.y + 120, { steps: 5 })
    await page.mouse.up()
    const [start, end] = (await selected()).split('–'), head = to > from ? end : start
    assert.equal(await clock(), head, `dragged ${from} → ${to}: the caret at ${head}`)
    await page.keyboard.press('Escape')
    assert.equal(await selected(), '')
    assert.equal(await clock(), head, 'the selection gone, the caret stays')
  }
  await page.mouse.dblclick(x(before * .4), box.y + 100)
  const [start, end] = (await selected()).split('–')
  assert.ok(end, 'a double-click selects')
  assert.equal(await clock(), start, 'double-clicked: the caret at the start')
  // Shift and a click further on: out to it, the caret there
  await page.keyboard.down('Shift')
  await page.mouse.click(x(before * .8), box.y + 100)
  await page.keyboard.up('Shift')
  const [, to] = (await selected()).split('–')
  assert.equal(await clock(), to, 'Shift-clicked: the caret at the end it moved')
})

test('editor: deleting a selection writes remove() and shortens the output by its length', async () => {
  await open()
  const before = await seconds(), { box, x } = await axis(before)
  await page.mouse.move(x(before * .25), box.y + 100)
  await page.mouse.down()
  await page.mouse.move(x(before * .5), box.y + 120, { steps: 5 })
  await page.mouse.up()
  await page.keyboard.press('Delete')
  await page.waitForFunction(() => scriptText().includes('.remove('))
  // its sides crossfaded over 10 ms (the settings), the length still less by the selection's
  const [, at, duration] = (await code()).match(/\.remove\(\{ at: ([\d.]+), d: ([\d.]+), xfade: 0\.01 \}\)/)
  // each time goes to the zoom's 1-2-5 step, at most 2.5 pixels
  const px = before / await spans(box)
  assert.ok(Math.abs(+at - before * .25) < 3 * px && Math.abs(+duration - before * .25) < 3 * px, `${at} ${duration}`)
  await page.waitForFunction(expected => Math.abs(+(e => e.title || e.dataset.tip || '')(document.querySelector('.source')).split(' · ').pop().split(':')[1] - expected) < .002, before - +duration)
  // the waveform shares the script's history
  await page.locator('.plot').focus()
  await page.keyboard.press('ControlOrMeta+Z')
  await page.waitForFunction(() => !scriptText().includes('.remove('))
  await page.waitForFunction(expected => Math.abs(+(e => e.title || e.dataset.tip || '')(document.querySelector('.source')).split(' · ').pop().split(':')[1] - expected) < .002, before)
})

test('editor: completion lists methods by group and a chosen one opens its sliders', async () => {
  await open()
  await tab('Code')
  await page.locator('.cm-content').click()
  await page.keyboard.press('ControlOrMeta+End')
  await page.keyboard.type('\n  .gai')
  const options = page.locator('.cm-tooltip-autocomplete li')
  await options.first().waitFor()
  assert.ok((await options.allInnerTexts()).some(t => t.startsWith('gain')))
  // CodeMirror takes no accept key for 75 ms after the list opens (autocompletion's interactionDelay)
  await page.waitForTimeout(100)
  await page.keyboard.press('Enter')
  await page.waitForFunction(() => scriptText().endsWith('.gain()'))
  await tab('Edits')
  await page.locator('.step-name', { hasText: 'Gain' }).click()
  await page.locator('.step.open .step-name', { hasText: 'Gain' }).waitFor()
  await page.locator('.step.open .params input[type=range]').first().fill('750')
  await page.waitForFunction(() => /\.gain\(0\)$/.test(scriptText()))
})

// A recipe goes on the sound as it is, nothing rewritten: its calls after the chain's own, one step; over the selection
// when there is one; a script of statements takes the chain as its source; one that makes a sound opens a tab. Its
// de-reverb model is not fetched: the script is what is tested
test('editor: a recipe goes on the sound as it is, over the selection when there is one, one step', async () => {
  await page.route(/huggingface\.co/, route => route.abort())
  await open()
  const chime = `audio('chime.wav')\n  .trim()\n  .normalize(-1)\n  .fade(0.02, 0.1)`
  await menu('Process', 'Recipes', 'Reduce noise')
  assert.equal(await code(), `${chime}\n  .omlsa()`)
  await menu('Edit', 'Undo')
  await page.waitForFunction(c => scriptText() === c, chime)
  await noCues()
  const { box, x } = await axis(6.525), y = box.y + tall(box) / 3
  await drag([x(1), y], [x(2) - x(1), 0])
  await menu('Process', 'Recipes', 'Remove room echo')
  await page.waitForFunction(c => scriptText() === c, `${chime}\n  // Remove room echo\n    .highpass(80, { at: 1, d: 1 })\n    .dereverb({ at: 1, d: 1 })`)
  await menu('Edit', 'Undo')
  await page.waitForFunction(c => scriptText() === c, chime)
  await menu('Process', 'Recipes', 'Measure loudness')
  assert.match(await code(), /^let a = audio\('chime\.wav'\)\n  \.trim\(\)\n  \.normalize\(-1\)\n  \.fade\(0\.02, 0\.1\)\nlet \[lufs/)
  await menu('Process', 'Recipes', 'Measure loudness')
  assert.match(await code(), /\nlet a2 = a\nlet \[lufs2, peak2, range2\] = await a2\.stat\(\['loudness', 'db', 'lra'\]\)\nconsole\.log\(`\$\{lufs2\.toFixed\(1\)\} LUFS · peak \$\{peak2/)
  await page.waitForFunction(() => !document.querySelector('.message.problem'))
  const tabs = await page.locator('.files .file').count()
  await menu('Process', 'Recipes', 'Noise')
  await page.waitForFunction(n => document.querySelectorAll('.files .file').length === n + 1, tabs)
  assert.equal(await code(), `audio.from(3).noise({ color: 'pink' })`)
})

// The check (fn/check.js) of the result beside the file as it opened. Apple Podcasts: -16 LKFS ±1, true peak ≤ -1 dBFS
// (podcasters.apple.com/support/893). The default script peaks at -1 dBFS: its true peak sits above, and it is loud.
// The check, in the panel's Export tab: each rule, the result, the limit
test('editor: a delivery check shows each rule for the result, and follows the script', async () => {
  await open()
  await tab('Export')
  // the check, folded while no spec is chosen
  await page.locator('.export summary', { hasText: /^Check/ }).click()
  await page.locator('.export').getByRole('button', { name: 'Apple Podcasts' }).click()
  await page.locator('.check-table:not(.stale)').waitFor()
  const rows = async () => (await page.locator('.check-table tbody tr').allInnerTexts()).map(r => r.split('\t').map(c => c.trim()))
  assert.deepEqual(await page.locator('.check-table thead th').allInnerTexts(), ['Rule', 'After', 'Limit'])
  let [loud, peak] = await rows()
  assert.equal(loud[0], 'Loudness')
  assert.match(loud[1], /^✗ −1[0-4]\.\d\d$/, 'normalized to its peak, the result is too loud')
  assert.equal(loud[2], '−17 to −15LUFS')
  assert.match(peak[1], /^✗ −0\.9\d$/, 'true peak over a -1 dBFS sample peak')
  await tab('Code')
  await write(`audio('chime.wav').normalize('podcast')`)
  await tab('Export')
  await page.waitForFunction(() => document.querySelector('.check-table:not(.stale) tbody tr td')?.textContent.includes('✓'))
  ;[loud, peak] = await rows()
  assert.equal(loud[1], '✓ −16.00')
  assert.match(peak[1], /^✓ −/)
  // the format there is the one Export takes
  await page.locator('.export').getByRole('button', { name: 'FLAC' }).click()
  assert.equal(await page.locator('.export-button').innerText(), 'Export FLAC')
  await page.locator('.export').getByRole('button', { name: 'Off' }).click()
  await page.locator('.check-table').waitFor({ state: 'detached' })
})

test('editor: a recipe made for a delivery spec checks the output against it', async () => {
  await open()
  await menu('Process', 'Recipes', 'Podcast episode')
  await tab('Export')
  assert.equal(await page.locator('.export').getByRole('button', { name: 'Apple Podcasts' }).getAttribute('aria-pressed'), 'true')
  await page.waitForFunction(() => { const r = [...document.querySelectorAll('.check-table:not(.stale) tbody td:nth-of-type(1)')]; return r.length && r.every(td => !td.textContent.includes('✗')) }, null, { timeout: 30000 })
  assert.match(await code(), /\.normalize\('podcast'\)$/)
})

// The export's rows of choices each on one line, every label whole, at the panel's narrowest as at its default: a field's
// choices under its name when they want the row; nothing past the panel's edge
test('editor: the export\'s choices keep to one row each, labels whole, the panel wide or narrow', async () => {
  await open()
  await tab('Export')
  await page.locator('.export summary', { hasText: 'Edit list' }).click()
  await page.locator('.export summary', { hasText: 'Check' }).click()
  for (const format of ['MP3', 'OGG', 'WAV']) {
    await page.locator('.export').getByRole('button', { name: format, exact: true }).click()
    for (const px of [440, 280]) {
      await page.evaluate(px => document.querySelector('.panes').style.setProperty('--panel', px + 'px'), px)
      const r = await page.locator('.export').evaluate(e => ({
        over: e.scrollWidth - e.clientWidth,
        rows: [...e.querySelectorAll('.choices')].filter(c => c.offsetParent).map(c => ({ name: c.getAttribute('aria-label'), lines: new Set([...c.children].map(b => b.offsetTop)).size, cut: [...c.children].filter(b => b.scrollWidth > b.clientWidth + 1).map(b => b.textContent) }))
      }))
      assert.equal(r.over, 0, `${format} at ${px}px: nothing past the edge`)
      for (const row of r.rows) assert.ok(row.lines === 1 && !row.cut.length, `${format} at ${px}px, ${row.name}: ${row.lines} lines, cut ${row.cut}`)
    }
  }
})

// Before, a key at the bar's right end, after the rate and channels: pressed, the file as it opened, as B does, lit while it is heard; again, or B,
// the output. A generated sound has no file to hear it against: the key is off
test('editor: Before, at the bar\'s right, hears the file as it opened, lit while it does; off for a generated sound', async () => {
  await open()
  await write(`audio('chime.wav').gain(-6)`)
  await lengthIs('0:08.000')
  const before = page.getByRole('button', { name: 'Before', exact: true })
  await page.waitForFunction(() => !document.querySelector('button.before').disabled)
  assert.equal(await before.getAttribute('aria-pressed'), 'false')
  await before.click()
  await page.waitForFunction(() => document.querySelector('button.before').getAttribute('aria-pressed') === 'true')
  assert.match(await page.locator('.status').innerText(), /Hearing before the edits/)
  const lit = await before.evaluate(e => getComputedStyle(e).backgroundColor)
  await page.mouse.move(2, 2)
  assert.equal(await before.evaluate(e => getComputedStyle(e).backgroundColor), lit, 'lit, the pointer on it or not')
  await page.locator('.plot').focus()
  await page.keyboard.press('b')
  await page.waitForFunction(() => document.querySelector('button.before').getAttribute('aria-pressed') === 'false')
  await write(`audio.from(t => Math.sin(2 * Math.PI * 440 * t), { duration: 1 })`)
  await lengthIs('0:01.000')
  assert.equal(await before.isDisabled(), true, 'a generated sound: nothing to hear it against')
})

// B: the file as it opened, level-matched, at the same place; B again, the output. What is heard is said over the picture
// and checked in Play > Hear it before the edits
test('editor: B plays the file as it opened, level-matched to the result, and a new output returns to the result', async () => {
  await open()
  const heardBefore = async () => { await page.locator('.menubar-item', { hasText: /^Transport$/ }).click(); const on = await page.locator('.menubar-list .menu-row', { has: page.locator('.menu-label', { hasText: /^Hear it before the edits$/ }) }).getAttribute('aria-checked'); await page.keyboard.press('Escape'); return on === 'true' }
  await page.locator('body').press('b')
  await page.locator('.message', { hasText: /^Hearing before the edits: the file as it opened, level-matched \([+−]\d+\.\ddB\)/ }).waitFor()
  assert.ok(await heardBefore())
  await page.locator('body').press('b')
  await page.locator('.message', { hasText: 'Hearing the output, after the edits' }).waitFor()
  assert.ok(!await heardBefore())
  await page.locator('body').press('b')
  await page.locator('.message', { hasText: /^Hearing before the edits/ }).waitFor()
  await write(`audio('chime.wav').normalize(-6)`)
  await page.locator('.readout', { hasText: '−6.0dBFS' }).waitFor()
  assert.ok(!await heardBefore(), 'the new output is heard')
  await write(`audio.from(t => Math.sin(2 * Math.PI * 440 * t), { duration: 1 })`)
  await page.locator('.source', { hasText: 'generated' }).waitFor()
  await page.locator('.plot').focus()
  await page.keyboard.press('b')
  await page.locator('.message', { hasText: 'A generated sound has no file as it opened' }).waitFor()
})

// A file dropped where nothing plays opens it; held over the waveform it shows where it goes in, a caret of its own,
// and dropped there it goes in at that time, its seams crossfaded; over the tabs it opens in a tab of its own
test('editor: a file opens where nothing plays, goes in where its caret shows over the waveform, or into a tab of its own', async () => {
  await open()
  const bytes = await wavBytes([sine(.5, 440, .5)])
  const hold = (selector, name, x, kinds = ['dragover', 'drop']) => page.evaluate(({ selector, name, bytes, x, kinds }) => {
    const target = document.querySelector(selector), rect = target.getBoundingClientRect(), data = new DataTransfer()
    data.items.add(new File([new Uint8Array(bytes)], name, { type: 'audio/wav' }))
    const at = { bubbles: true, cancelable: true, dataTransfer: data, clientX: x ?? rect.left + 40, clientY: rect.top + 40 }
    for (const kind of kinds) target.dispatchEvent(new DragEvent(kind, at))
  }, { selector, name, bytes: [...bytes], x, kinds })
  await write('')
  await hold('.view', 'tone.wav')
  await page.waitForFunction(() => scriptText() === "audio('tone.wav')")
  await lengthIs('0:00.500')
  // held over the middle: the caret where it would go in, the accent's colour, a line down the lanes
  const { x } = await axis(.5)
  await hold('.plot', 'tone.wav', x(.25), ['dragover'])
  const lit = await pixels(`const out = []; for (let x = 0; x < w; x++) { const i = (80 * w + x) * 4; if (d[i] - d[i + 2] > 60) out.push(x) } return out`)
  const box = await page.locator('.plot').boundingBox()
  assert.ok(lit.length && lit.every(px => Math.abs(px - (x(.25) - box.x)) < 3), JSON.stringify(lit))
  await hold('.plot', 'tone.wav', x(.25), ['drop'])
  await page.waitForFunction(() => scriptText() === "audio('tone.wav')\n  .insert(audio('tone-2.wav'), { at: 0.25, xfade: 0.01 })")
  await lengthIs('0:01.000')
  // over the tabs: a tab of its own
  const tabs = await page.locator('.files .file').count()
  await hold('.files', 'tone.wav')
  await page.waitForFunction(n => document.querySelectorAll('.files .file').length === n + 1, tabs)
  await page.waitForFunction(() => scriptText() === "audio('tone-3.wav')")
})

// Several files dropped at once open together, a track each in one tab, the first edited; exported, a file each. Over
// the tabs, a tab each
test('editor: several files dropped open as tracks of one tab, exported a file each; over the tabs, a tab each', async () => {
  await open()
  const bytes = [await wavBytes([sine(.5, 440, .5)]), await wavBytes([sine(.75, 220, .5)])]
  const hold = (selector, names) => page.evaluate(({ selector, names, bytes }) => {
    const target = document.querySelector(selector), rect = target.getBoundingClientRect(), data = new DataTransfer()
    names.forEach((name, i) => data.items.add(new File([new Uint8Array(bytes[i])], name, { type: 'audio/wav' })))
    const at = { bubbles: true, cancelable: true, dataTransfer: data, clientX: rect.left + 40, clientY: rect.top + 10 }
    for (const kind of ['dragover', 'drop']) target.dispatchEvent(new DragEvent(kind, at))
  }, { selector, names, bytes: bytes.map(b => [...b]) })
  await write('')
  await hold('.view', ['low.wav', 'high.wav'])
  await page.waitForFunction(() => scriptText() === "let low = audio('low.wav')\n\nlet high = audio('high.wav')")
  await page.waitForFunction(() => document.querySelector('.plot').dataset.tracks === '2')
  await page.waitForFunction(() => document.querySelector('.steps-list .step-name')?.textContent === 'low · low.wav')
  await lengthIs('0:00.750')
  const files = []
  page.on('download', d => files.push(d))
  await menu('File', 'Export as', 'Each track')
  while (files.length < 2) await new Promise(r => setTimeout(r, 50))
  assert.deepEqual(files.map(d => d.suggestedFilename().replace(/^.*-/, '')), ['low.wav', 'high.wav'])
  const lengths = []
  for (const d of files) { const a = await audio(await readFile(await d.path())); await a.read(); lengths.push(+a.duration.toFixed(3)) }
  assert.deepEqual(lengths, [.5, .75], 'each track alone')
  // over the tabs: a tab each
  const tabs = await page.locator('.files .file').count()
  await hold('.files', ['low.wav', 'high.wav'])
  await page.waitForFunction(n => document.querySelectorAll('.files .file').length === n + 2, tabs)
  await page.waitForFunction(() => scriptText() === "audio('high-2.wav')")
  // picked together (Open file…): a track each, as dropped
  await page.setInputFiles('.file-input', [{ name: 'low.wav', mimeType: 'audio/wav', buffer: bytes[0] }, { name: 'high.wav', mimeType: 'audio/wav', buffer: bytes[1] }])
  await page.waitForFunction(() => scriptText() === "let low3 = audio('low-3.wav')\n\nlet high3 = audio('high-3.wav')")
  await page.waitForFunction(() => document.querySelector('.plot').dataset.tracks === '2')
})

// The engine sets off before the page's own scripts: its worker is asked for while editor.js is still held back, and
// the page, once up, runs on that worker, not a second one
test('editor: the engine\'s worker loads ahead of the page\'s scripts, and the page takes it', async () => {
  let release
  const held = new Promise(r => release = r)
  await page.route('**/playground/editor.js', async route => { await held; route.continue() })
  await page.addInitScript(() => { const W = Worker; window.workers = 0; window.Worker = class extends W { constructor(...a) { super(...a); workers++ } } })
  const asked = page.waitForRequest('**/playground/dist/worker.js')
  await page.goto(origin + '/playground/', { waitUntil: 'commit' })
  await asked
  release()
  await wholeLevels().waitFor()
  assert.equal(await page.evaluate(() => workers), 1, 'one worker')
})
// One set off ahead that fails to load is let go: the page starts its own, and runs
test('editor: an engine worker that fails to load ahead is replaced by the page\'s own', async () => {
  let first = true
  await page.route('**/playground/dist/worker.js', route => first ? (first = false, route.abort()) : route.continue())
  await page.goto(origin + '/playground/')
  await wholeLevels().waitFor()
  assert.equal(first, false, 'the first one failed')
})

// A first visit opens on an empty tab, its ways in offered as the page comes up: no sound nobody chose, and none of what
// an empty tab doesn't need waited for, the engine, CodeMirror or the library, which come after it shows
test('editor: a first visit opens on an empty tab, its ways in shown before the engine, CodeMirror or the library come', async () => {
  const p = await browser.newPage()
  p.on('pageerror', e => errors.push(e.message))
  let release
  const held = new Promise(r => release = r)
  await p.route(/\/(playground\/dist\/worker\.js|assets\/codemirror\.js|assets\/audio\.js)$/, async route => { await held; route.continue() })
  try {
    await p.goto(origin + '/playground/')
    await p.locator('.empty').waitFor()
    assert.equal(await p.locator('#app').getAttribute('data-boot'), null, 'shown')
    assert.deepEqual(await p.locator('.files [role="tab"]').allInnerTexts(), ['untitled'])
    assert.equal(await p.locator('.cm-content').count(), 0, 'CodeMirror not come yet')
  } finally { release(); await p.close() }
})

// Every module the editor imports, however deep, is preloaded by the page, and none it doesn't import: none is found
// an import at a time, a round trip each, and CodeMirror and the library, which come after the page shows, are not
// among them (playground/index.html)
test('editor: the page preloads every module the editor imports, and nothing else', async () => {
  const html = await readFile(resolve(root, 'playground/index.html'), 'utf8'), preloaded = [...html.matchAll(/<link rel="modulepreload" href="([^"]+)"/g)].map(m => relative(root, resolve(root, 'playground', m[1])))
  const graph = new Set()
  const walk = async file => {
    if (graph.has(file)) return
    graph.add(file)
    const src = await readFile(resolve(root, file), 'utf8')
    for (const [, spec] of src.matchAll(/(?:^|[;}\s])(?:import|export)\s*(?:[^'"()]*?\s*from\s*)?['"](\.[^'"]+)['"]/gm)) await walk(relative(root, resolve(root, dirname(file), spec)))
  }
  await walk('playground/editor.js')
  assert.deepEqual([...preloaded].sort(), [...graph].sort())
  assert.ok(!graph.has('assets/codemirror.js') && !graph.has('assets/audio.js'), 'CodeMirror and the library come once the page shows')
})

// CodeMirror comes after the page shows: an edit made before it, a sound opened, is a step of its history once it
// does, undone and redone as any
test('editor: an edit made before CodeMirror comes is undone and redone once it has', async () => {
  const p = await browser.newPage()
  p.on('pageerror', e => errors.push(e.message))
  let release
  const held = new Promise(r => release = r)
  await p.route('**/assets/codemirror.js', async route => { await held; route.continue() })
  const text = () => p.evaluate(() => [...document.querySelectorAll('.cm-content .cm-line')].map(l => l.textContent).join('\n'))
  try {
    await p.goto(origin + '/playground/')
    await p.locator('.empty').waitFor()
    await p.locator('.menubar-item', { hasText: /^File$/ }).click()
    for (const name of ['Sample or generate', 'chime.wav']) await p.locator('.menubar-list .menu-row:visible').filter({ has: p.locator('.menu-label', { hasText: new RegExp(`^${name.replace('.', '\\.')}$`) }) }).last().click()
    await p.waitForFunction(() => document.querySelector('.readout')?.dataset.of === 'all')
    assert.equal(await p.locator('.history .undo').getAttribute('aria-disabled'), null, 'undoable already')
    release()
    await p.locator('.cm-content').waitFor({ state: 'attached' })
    assert.equal(await text(), `audio('chime.wav')`)
    await p.getByRole('button', { name: 'Undo', exact: true }).click()
    await p.locator('.empty').waitFor()
    assert.equal(await text(), '')
    await p.getByRole('button', { name: 'Redo', exact: true }).click()
    await p.waitForFunction(() => document.querySelector('.readout')?.dataset.of === 'all')
    assert.equal(await text(), `audio('chime.wav')`)
  } finally { release(); await p.close() }
})

test('editor: before the script runs, the intro shows nothing dead; while the first run renders, it stays away', async () => {
  // no script at all: the conditional parts (intro, toolbar) stay hidden instead of showing inert buttons
  await page.route('**/playground/editor.js', route => route.abort())
  await page.goto(origin + '/playground/')
  await page.waitForTimeout(300)
  assert.equal(await page.locator('.empty').isVisible(), false, '.empty')
  // and what does show takes no clicks yet: the File menu stays shut
  assert.equal(await page.locator('#app').evaluate(el => getComputedStyle(el).pointerEvents), 'none')
  await page.locator('.menubar-item', { hasText: /^File$/ }).click({ force: true, timeout: 2000 }).catch(() => {})
  assert.equal(await page.locator('.menubar-list:popover-open').count(), 0)
  await page.unroute('**/playground/editor.js')
  errors.splice(0)  // the script this part withheld on purpose
  // a slow engine: the script is up, the first output isn't, and the view doesn't claim there's no sound
  let release
  const held = new Promise(r => release = r)
  await page.route('**/playground/dist/worker.js', async route => { await held; route.continue() })
  await page.goto(origin + '/playground/')
  await page.locator('.cm-content').waitFor({ state: 'attached' })
  await page.waitForTimeout(300)
  assert.equal(await page.locator('.empty').isVisible(), false, 'no intro while the first run renders')
  release()
  await wholeLevels().waitFor()
  assert.equal(await page.locator('.empty').count(), 0)
  assert.equal(await page.locator('#app').evaluate(el => getComputedStyle(el).pointerEvents), 'auto', 'taken over, it answers')
})

// A new sound goes into a tab of its own, and the script it came over stays in its tab; an empty script takes it whole
test('editor: a new sound opens in a tab of its own, the script shown before it kept; an empty one takes it', async () => {
  const bytes = await wavBytes([sine(.5, 440, .5)])
  const tabs = () => page.locator('.files [role="tab"]').allInnerTexts()
  await open()
  // a note alone: it stays, in its tab; the file in a tab after it
  await write('// my notes')
  await page.locator('.empty').waitFor()
  const chooser = page.waitForEvent('filechooser')
  await menu('File', 'Open file…')
  await (await chooser).setFiles({ name: 'tone.wav', mimeType: 'audio/wav', buffer: bytes })
  await page.waitForFunction(() => scriptText() === "audio('tone.wav')")
  await lengthIs('0:00.500')
  assert.deepEqual(await tabs(), ['untitled', 'tone.wav'])
  await page.getByRole('tab', { name: 'untitled' }).click()
  await page.waitForFunction(() => scriptText() === '// my notes')
  // an empty script takes a generator, and then a sample goes into a tab of its own
  await tab('Code')
  await page.locator('.cm-content').click()
  await page.keyboard.press('ControlOrMeta+A')
  await page.keyboard.press('Backspace')
  await page.locator('.empty').waitFor()
  await menu('File', 'Sample or generate', 'Noise')
  await page.waitForFunction(() => /^audio\.from/.test(scriptText()))
  await menu('File', 'Sample or generate', 'chime.wav')
  await page.waitForFunction(() => scriptText() === "audio('chime.wav')")
  await lengthIs('0:08.000')
  assert.deepEqual(await tabs(), ['generated', 'tone.wav', 'chime.wav'])
})

test('editor: an output of no samples shows the empty view; the next output replaces it', async () => {
  await open()
  await write(`audio('chime.wav').crop({ at: 0, duration: 0 })`)
  await page.locator('.empty', { hasText: 'Drop audio here' }).waitFor()
  assert.equal(await readout(), '')
  assert.ok(await page.getByRole('button', { name: 'Play' }).isDisabled())
  await write(`audio('chime.wav').reverse()`)
  await wholeLevels().waitFor()
  await page.locator('.empty').waitFor({ state: 'detached' })
  assert.equal(await lengthText(), '0:08.000')
})

test('editor: a file dropped on the waveform of a generated sound goes in where it is dropped', async () => {
  await open()
  await write(`audio.from(0.5)`)
  await page.waitForFunction(() => (e => e.title || e.dataset.tip || '')(document.querySelector('.source')).split(' · ').pop() === '0:00.500')
  const bytes = await wavBytes([sine(.5, 440, .5)]), { x } = await axis(.5)
  await page.evaluate(({ bytes, x }) => {
    const target = document.querySelector('.plot'), rect = target.getBoundingClientRect(), data = new DataTransfer()
    data.items.add(new File([new Uint8Array(bytes)], 'tone.wav', { type: 'audio/wav' }))
    const at = { bubbles: true, cancelable: true, dataTransfer: data, clientX: x, clientY: rect.top + 40 }
    target.dispatchEvent(new DragEvent('dragover', at))
    target.dispatchEvent(new DragEvent('drop', at))
  }, { bytes: [...bytes], x: x(.5) })
  await page.waitForFunction(() => scriptText() === "audio.from(0.5)\n  .insert(audio('tone.wav'), { at: 0.5, xfade: 0.01 })")
  await page.waitForFunction(() => (e => e.title || e.dataset.tip || '')(document.querySelector('.source')).split(' · ').pop() === '0:01.000')
})

// A file dropped under the lanes, in the room: a track of its own, named for it, from where it was let go
test('editor: a file dropped under the lanes goes into a new track of its own there', async () => {
  const { box, x } = await chime()
  const bytes = await wavBytes([sine(.5, 440, .5)])
  await page.evaluate(({ bytes, x, y }) => {
    const target = document.querySelector('.plot'), data = new DataTransfer()
    data.items.add(new File([new Uint8Array(bytes)], 'tone.wav', { type: 'audio/wav' }))
    const at = { bubbles: true, cancelable: true, dataTransfer: data, clientX: x, clientY: y }
    target.dispatchEvent(new DragEvent('dragover', at))
    target.dispatchEvent(new DragEvent('drop', at))
  }, { bytes: [...bytes], x: x(2), y: box.y + tall(box) + FOOT + ROOM / 2 })
  await page.waitForFunction(() => /^let chime = audio\('chime\.wav'\)\n\nlet tone = audio\.from\(0\)\n  \.write\(audio\('tone\.wav'\), \{ at: (1\.99|2|2\.01) \}\)$/.test(scriptText()))
})

// While the worker is held (a loop, until its 5 s guard), a script naming a sample not made yet, then a newer script:
// the page must end on the newer one, not on the older one arriving late.
test('editor: the newest script is the one shown, even when an older one waited for a sample', async () => {
  await open()
  await write(`while (true) {}`)
  await page.locator('.message', { hasText: 'Rendering' }).waitFor()
  // the ring that stops it in Record's place, Play still Play
  await page.waitForFunction(() => !document.querySelector('.busy').inert && document.querySelector('.record').inert && !document.querySelector('.play').inert, null, { timeout: 4000 })
  await write(`audio('handpan.wav')`)
  await page.waitForTimeout(400)
  await write(`audio('chime.wav').reverse()`)
  await page.locator('.message', { hasText: 'Rendering' }).waitFor()
  await page.waitForFunction(() => !document.querySelector('.message').textContent && document.querySelector('.readout')?.dataset.of === 'all', null, { timeout: 30000 })
  await page.waitForTimeout(1000)
  assert.equal(await page.locator('.source').innerText(), 'chime.wav')
  assert.equal(await lengthText(), '0:08.000')
})

test('editor: export downloads the output, encoded', async () => {
  await open()
  const length = await seconds()
  const waiting = page.waitForEvent('download')
  await tab('Export')
  await page.locator('.export-button').click()
  const download = await waiting
  assert.equal(download.suggestedFilename(), 'chime-edited.wav')
  const pcm = await audio(await readFile(await download.path())).read()
  assert.ok(Math.abs(pcm[0].length / 44100 - length) < .001)
  assert.ok(Math.abs(peakDb(pcm) + 1) < .05, `peak ${peakDb(pcm)}`)
})

// The page holds no library of its own: it plays through deck.js (its AudioContext, the library's playback on it), the
// library running in the workers alone, the deck's (voices.js) as playback needs it, not the engine's whole; a deck's
// worker that fails to load plays through the engine's
for (const failing of [false, true]) test(`editor: the page plays through deck.js alone, no library of its own, ${failing ? 'a deck that fails through the engine' : 'the deck a worker of its own'}`, async () => {
  const asked = []
  page.on('request', r => asked.push(new URL(r.url()).pathname))
  if (failing) await page.route('**/playground/dist/voices.js', route => route.abort())
  // what each worker answers, by its script
  await page.addInitScript(() => { const W = Worker; window.answers = []; window.Worker = class extends W { constructor(url, o) { super(url, o); this.addEventListener('message', e => answers.push([String(url).split('/').pop(), !!e.data?.inst])) } } })
  await page.route('**/playground/editor.js', async route => { const r = await route.fetch(); route.fulfill({ response: r, body: (await r.text()).replace('v = view(', 'v = globalThis.__view = view(') }) })
  await open()
  await write(`audio.from(t => Math.sin(2 * Math.PI * 220 * t) * .3, { duration: 20 })`)
  await lengthIs('0:20.000')
  await page.locator('.plot').focus()
  await page.keyboard.press('Space')
  await page.waitForFunction(() => __view.playhead > .5)
  assert.ok(asked.includes('/deck.js') && asked.includes('/playground/dist/voices.js'), 'deck.js and the deck\'s worker')
  const voiced = await page.evaluate(() => answers.filter(([, inst]) => inst).map(([from]) => from))
  assert.equal(voiced[0], failing ? 'worker.js' : 'voices.js', 'the voice made where it plays')
  assert.deepEqual(asked.filter(p => p === '/assets/audio.js' || p === '/audio.js' || p === '/core.js'), [], 'no library on the page')
})

// Play pressed while it plays pauses at its release (a press held still searches), the caret where the playhead line
// got to, not back where the press was, as Space's pause leaves it
test('editor: Play let go pauses with the caret where the playhead got to, as Space does', async () => {
  await page.route('**/playground/editor.js', async route => { const r = await route.fetch(); route.fulfill({ response: r, body: (await r.text()).replace('v = view(', 'v = globalThis.__view = view(') }) })
  await open()
  await write(`audio.from(t => Math.sin(2 * Math.PI * 220 * t) * .3, { duration: 20 })`)
  await lengthIs('0:20.000')
  await page.locator('.plot').focus()
  await page.keyboard.press('Space')
  await page.waitForFunction(() => __view.playhead > .5)
  const box = await page.locator('button.play').boundingBox()
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  const pressed = await page.evaluate(() => __view.playhead)
  await page.waitForTimeout(300)
  const before = await page.evaluate(() => __view.playhead)
  await page.mouse.up()
  await page.getByRole('button', { name: 'Play', exact: true }).waitFor()
  const caret = await page.evaluate(() => __view.cursor)
  assert.ok(before - pressed > .2, `played on while held: ${pressed} → ${before}`)
  assert.ok(caret >= before - .01 && caret - before < .2, `the caret ${caret.toFixed(3)} where the line got to, ${before.toFixed(3)}, not back at ${pressed.toFixed(3)}`)
})

test('editor: play moves the clock, and a new output keeps playing where it was', async () => {
  await open()
  await page.locator('body').press('Space')
  await page.getByRole('button', { name: 'Pause' }).waitFor()
  await page.waitForFunction(() => document.querySelector('.time').textContent > '0:00.300')
  await write(`audio('chime.wav').normalize(-6)`)
  await page.locator('.readout', { hasText: '−6.0dBFS' }).waitFor()
  assert.ok(await page.getByRole('button', { name: 'Pause' }).isVisible())
  await page.getByRole('button', { name: 'Pause' }).click()
  await page.getByRole('button', { name: 'Play' }).waitFor()
})

// What plays is rendered by the engine, as it plays (player.js, worker.js voice): the page's own thread held up three
// seconds, longer than the library renders ahead of the speakers (fn/play.js AHEAD), leaves no gap in it. The speakers' feed taken on the audio thread (taken), past the page's
// An output longer than the page holds (over 30 channel-minutes) is drawn from its picture: the waveform from its peaks,
// the spectrogram from its spectra, the whole of it at once, the page's own memory a fraction of its samples; zoomed in,
// its samples come and the line runs through them, those far behind let go as the view moves on; it plays from the
// engine; a selection's levels read from its leaves
test('editor: a sound longer than the page holds is drawn from its peaks and spectra, its samples where it is zoomed in, and plays', async () => {
  await open()
  // the page's memory as the engine counts it, its arrays' storage too
  const cdp = await page.context().newCDPSession(page)
  const heap = () => cdp.send('Runtime.getHeapUsage').then(u => u.usedSize + (u.backingStorageSize ?? 0))
  await write(`audio.from(t => Math.sin(2 * Math.PI * 220 * t) * (.25 + .2 * Math.sin(t / 40)), { duration: 1820, sampleRate: 48000 })`)
  await page.waitForFunction(() => (e => e.title || e.dataset.tip || '')(document.querySelector('.source')).endsWith('30:20.000'), null, { timeout: 120000 })
  await page.waitForFunction(() => !document.querySelector('.message').textContent, null, { timeout: 120000 })
  await cdp.send('HeapProfiler.collectGarbage')
  const used = await heap()
  assert.ok(used < 150e6, `the page holds ${(used / 1e6).toFixed(0)} MB, its samples would be ${(1820 * 48000 * 4 / 1e6).toFixed(0)}`)
  assert.ok(await drawn() > .02, 'all of it drawn from its peaks')
  // the overview of all of it, from its leaves: ink all along it
  await settings('Scroll', 'Overview')
  const w0 = (await page.locator('.plot').boundingBox()).width
  assert.ok(await pixels(`let n = 0; for (let x = 0; x < w * .9; x++) for (let y = h - 26; y < h - 4; y++) { const i = (y * w + x) * 4; if (d[i] > 60) n++ } return n`) > w0 * 2, 'the overview drawn from its leaves')
  await settings('Scroll', 'Bar')
  // the spectrogram of all of it, from its spectra: the tone a bright row, at 220 Hz
  await show('spec')
  await page.waitForTimeout(500)
  const rows = await page.locator('.plot canvas.spectrum').screenshot().then(png => page.evaluate(async b64 => {
    const img = new Image()
    img.src = 'data:image/png;base64,' + b64
    await img.decode()
    const c = Object.assign(document.createElement('canvas'), { width: img.width, height: img.height }), g = c.getContext('2d')
    g.drawImage(img, 0, 0)
    const d = g.getImageData(0, 0, c.width - 60, c.height - 30).data, w = c.width - 60, lit = []
    // each row's share of bright pixels, across the lane
    for (let y = 0; y < c.height - 30; y++) { let n = 0; for (let x = 0; x < w; x++) if (d[(y * w + x) * 4] > 100) n++; lit.push(n / w) }
    return lit
  }, png.toString('base64')))
  assert.ok(rows.filter(v => v > .9).length >= 1 && rows.filter(v => v > .9).length < rows.length / 10, `a row lit across: ${rows.filter(v => v > .9).length} of ${rows.length}`)
  // zoomed in to two minutes and scrolled across a quarter of it: its samples come where it is, those far behind let go,
  // the page's memory bounded (the samples of where it went would be 8 × 2 minutes, twice: waveform and spectrogram)
  const plotBox = await page.locator('.plot').boundingBox()
  await page.mouse.move(plotBox.x + plotBox.width / 2, plotBox.y + plotBox.height / 2)
  await page.locator('.plot').focus()
  for (let i = 0; i < 4; i++) await page.keyboard.press('=')
  for (let i = 0; i < 8; i++) { await page.mouse.wheel(plotBox.width, 0); await page.waitForTimeout(700) }
  await cdp.send('HeapProfiler.collectGarbage')
  const after = await heap()
  assert.ok(after < used + 200e6, `having gone across, the page holds ${(after / 1e6).toFixed(0)} MB, ${(used / 1e6).toFixed(0)} before`)
  await page.keyboard.press('0')
  await show('wave')
  // zoomed in on the caret, 20 ms or so across, under a sample a pixel: the samples come, the line through them (the
  // peaks alone draw nothing there)
  const { box } = await axis(1820)
  await page.mouse.click(box.x + box.width / 2, box.y + tall(box) * .3)
  await page.locator('.plot').focus()
  for (let i = 0; i < 17; i++) await page.keyboard.press('=')
  // columns with ink off the silence line: the sine's, a twentieth of full scale either side; without its samples, at
  // most a line across (the caret's). The samples come from the engine as the view zooms in: waited for, as long as a
  // shared runner takes (1.5 s held locally, not there)
  const ink = () => page.locator('.plot canvas.waveform').screenshot().then(png => page.evaluate(async b64 => {
    const img = new Image()
    img.src = 'data:image/png;base64,' + b64
    await img.decode()
    const c = Object.assign(document.createElement('canvas'), { width: img.width, height: img.height }), g = c.getContext('2d')
    g.drawImage(img, 0, 0)
    const d = g.getImageData(0, 0, c.width, c.height).data, mid = c.height / 2, columns = new Set()
    // within 40 px of the silence line, clear of the labels at the foot and the right
    for (let i = 0; i < d.length; i += 4) { const y = Math.floor(i / 4 / c.width), x = i / 4 % c.width; if (d[i] > 120 && Math.abs(y - mid) > 6 && Math.abs(y - mid) < 40 && x < c.width - 60) columns.add(x) }
    return columns.size
  }, png.toString('base64')))
  let off = 0
  for (let end = Date.now() + 15000; (off = await ink()) <= 200 && Date.now() < end;) await page.waitForTimeout(250)
  assert.ok(off > 200, `zoomed in: the line through its samples, ${off} columns off the axis`)
  // it plays, from the engine
  await page.keyboard.press('Space')
  await page.getByRole('button', { name: 'Pause' }).waitFor()
  // the clock runs once the engine's first render reaches the deck: within 600 ms here, longer on a shared runner
  const t0 = await page.locator('.time').innerText()
  await page.waitForFunction(t => document.querySelector('.time').innerText !== t, t0, { timeout: 10000 }).catch(() => {})
  assert.notEqual(await page.locator('.time').innerText(), t0, 'the clock runs')
  await page.getByRole('button', { name: 'Pause' }).click()
  // a selection's levels, from its leaves
  await page.keyboard.press('Shift+ArrowRight')
  await page.locator('.readout[data-of="selection"]').waitFor()
  assert.match(await levelsTable(), /^\S+–\S+\nPeak −\d+\.\ddBFS at \S+\nRMS −\d+\.\ddBFS\nCrest \d+\.\ddB$/)
})

test('editor: playback goes on without a gap while the page is busy', async () => {
  await page.addInitScript(taken)
  await open()
  await write(`audio.from(t => Math.sin(2 * Math.PI * 440 * t) / 2, { duration: 8 })`)
  await page.locator('.readout', { hasText: '−6.0dBFS' }).waitFor()
  await page.locator('.plot').focus()
  await page.keyboard.press('Space')
  await page.getByRole('button', { name: 'Pause' }).waitFor()
  await page.waitForFunction(() => document.querySelector('.time').textContent > '0:00.300')
  await page.evaluate(() => { window.__taken.length = 0; const t = performance.now(); while (performance.now() - t < 3000); })
  await page.waitForTimeout(300)
  const [x, sr] = await page.evaluate(() => [window.__taken.flatMap(b => [...b]), window.__rate])
  // the longest run of silence while it played: a sine has none longer than a sample or two
  let run = 0, longest = 0
  for (const v of x) { run = Math.abs(v) < 1e-4 ? run + 1 : 0; longest = Math.max(longest, run) }
  assert.ok(x.length > sr * 3, `${x.length} samples taken`)
  assert.ok(longest < sr * .005, `a gap of ${(longest / sr * 1000).toFixed(0)} ms`)
  await page.getByRole('button', { name: 'Pause' }).click()
})

// Playback is the deck's (engine.js), a worker of its own: a script holding the engine 3 s, then its output taking over
// as it plays, leaves no gap in what is heard
test('editor: playback goes on without a gap while the engine processes, and its output takes over', async () => {
  await page.addInitScript(taken)
  await open()
  const sine = `audio.from(t => Math.sin(2 * Math.PI * 440 * t) / 2, { duration: 12 })`
  await write(sine)
  await page.locator('.readout', { hasText: '−6.0dBFS' }).waitFor()
  await page.locator('.plot').focus()
  await page.keyboard.press('Space')
  await page.getByRole('button', { name: 'Pause' }).waitFor()
  await page.waitForFunction(() => document.querySelector('.time').textContent > '0:00.300')
  await page.evaluate(() => { window.__taken.length = 0 })
  await write(`const s0 = performance.now()\nwhile (performance.now() - s0 < 3000);\n${sine}.gain(-1)`)
  await page.locator('.readout', { hasText: '−7.0dBFS' }).waitFor({ timeout: 15000 })
  await page.waitForTimeout(500)
  const [x, sr] = await page.evaluate(() => [window.__taken.flatMap(b => [...b]), window.__rate])
  let run = 0, longest = 0
  for (const v of x) { run = Math.abs(v) < 1e-4 ? run + 1 : 0; longest = Math.max(longest, run) }
  assert.ok(x.length > sr * 3.5, `${x.length} samples taken`)
  assert.ok(longest < sr * .005, `a gap of ${(longest / sr * 1000).toFixed(0)} ms`)
  assert.equal(await page.getByRole('button', { name: 'Pause' }).count(), 1, 'still playing')
  await page.getByRole('button', { name: 'Pause' }).click()
})

test('editor: an error is said once, beside the time and at its line; the last output stays', async () => {
  await open()
  await write(`audio('chime.wav').gain(`)
  // said once, beside the time, in place of the output's figures; the output stays
  await page.locator('.message.problem', { hasText: 'Syntax error on line 1' }).waitFor()
  const box = await page.locator('.plot').boundingBox()
  assert.ok(await drawn() > .05 * tall(box) / (box.height - 22), 'the last output still drawn')
  await write(`let a = audio('chime.wav')\na.nope()`)
  await page.locator('.message.problem', { hasText: /nope.*line 2/ }).waitFor()
  await tab('Code')
  await page.locator('.cm-lintRange-error').first().waitFor()
  assert.equal(await page.locator('.console .line.error').count(), 0, 'not again in the console')
  // a file the page doesn't have (a script kept from before a reload) is named once, and the view invites a drop
  await write(`audio('missing.wav').trim()`)
  await page.locator('.message.problem', { hasText: /^missing\.wav is not open here: open it, or drop it on the page$/ }).waitFor()
  await page.getByRole('button', { name: 'Open it…' }).waitFor()
  // the script is kept 500 ms after its last change
  await page.waitForTimeout(600)
  await page.reload()
  await page.locator('.message.problem', { hasText: 'missing.wav is not open' }).waitFor()
  assert.equal(await page.locator('.source').innerText(), 'missing.wav')
  assert.match(await page.locator('.empty').innerText(), /^Drop audio here/)
  // the fix clears it and the figures return
  await write(`audio('chime.wav')`)
  await wholeLevels().waitFor()
  assert.equal(await page.locator('.message.problem').count(), 0)
})

// With nothing open, the take is the sound, drawn as it comes
test('editor: a recording becomes a file the script opens', async () => {
  await open()
  await write('')
  await page.locator('.empty').waitFor()
  // stopped before the microphone answers (Record clicked twice at once): nothing recorded, the microphone let go, the
  // next take free to start
  await page.evaluate(() => { const b = document.querySelector('button.record'); b.click(); b.click() })
  await page.waitForTimeout(500)
  assert.equal(await page.locator('.empty').isVisible(), true, 'nothing recorded')
  assert.equal(await page.getByRole('button', { name: 'Stop recording', exact: true }).count(), 0)
  await page.getByRole('button', { name: 'Record', exact: true }).first().click()
  const started = Date.now()
  await page.waitForFunction(() => /^0:0[1-9]/.test(document.querySelector('.time').textContent))
  assert.ok(await drawn() > .001, 'the take draws as it comes')
  // at a recording app's scale, 10 s across, the take growing from the left: its right half bare
  const right = () => pixels(`let n = 0; for (let y = 10; y < h - 30; y++) for (let x = Math.round(w * .5); x < w * .9; x++) if (d[(y * w + x) * 4] > 120) n++; return n`)
  assert.equal(await right(), 0, 'the right half bare')
  // Play is off while it records
  assert.equal(await page.locator('button.play').isDisabled(), true, 'no playing while recording')
  // Space stops it, as it stops playback
  await page.locator('.plot').focus()
  await page.keyboard.press('Space')
  const ran = (Date.now() - started) / 1000
  await page.getByRole('button', { name: 'Record', exact: true }).first().waitFor()
  await page.waitForFunction(() => scriptText().startsWith("audio('recording.wav')"))
  await wholeLevels().waitFor()
  assert.equal(await right(), 0, 'its output at the same scale')
  // the caret where the take ended, not at its start: Record again records on
  await page.waitForFunction(() => +document.querySelector('.time').textContent.split(':')[1] > .9)
  // the take itself, untrimmed: about as long as the recording ran (a slow machine's run, however long)
  await write(`audio('recording.wav')`)
  const long = () => page.waitForFunction(most => { const s = +(e => e.title || e.dataset.tip || '')(document.querySelector('.source')).split(' · ').pop().split(':')[1]; return s > .9 && s < most }, ran + .5)
  await long()
  const before = await lengthText()
  // kept for the next visit, as a file is (a 32-bit float WAV): the same length after a reload, nothing missing
  await page.waitForTimeout(500)
  await page.reload()
  await wholeLevels().waitFor()
  assert.equal(await lengthText(), before)
  assert.equal(await page.locator('.message.problem').count(), 0)
})

test('editor: a found sound opens in a tab of its own, with its credit', async () => {
  await page.route('https://api.openverse.org/**', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({
    result_count: 1, results: [{ title: 'Door Creak', creator: 'stib', source: 'freesound', duration: 1000, license: 'cc0', license_version: '1.0', foreign_landing_url: 'https://freesound.org/people/stib/sounds/346267', url: origin + '/test/fixture.wav' }]
  }) }))
  await open()
  await menu('File', 'Find a sound…')
  // it searches half a second after the typing stops
  await page.getByRole('searchbox', { name: 'Find a sound' }).fill('door')
  await page.getByRole('button', { name: 'Use' }).click()
  assert.equal(await code(), `// "Door Creak" by stib, CC0 1.0, freesound.org/people/stib/sounds/346267\naudio('${origin}/test/fixture.wav')`)
  await page.locator('.source', { hasText: 'fixture.wav' }).waitFor()
  // the chime's script, as it was, in its tab
  await page.getByRole('tab', { name: 'chime.wav' }).click()
  await page.waitForFunction(() => scriptText().includes('.normalize(-1)'))
})

// ── The tools ──────────────────────────────────────────────────

// A tooltip only where the control doesn't say it: every button of no words (an icon) has one, a button that names
// itself none needed; the levels say their next fact pointed at
test('editor: every button of no words says what it is when pointed at', async () => {
  await open()
  const untitled = await page.evaluate(() => [...document.querySelectorAll('button, output')]
    .filter(el => !el.textContent.trim() && !el.closest('[title], [data-tip], .cm-editor')).map(el => el.outerHTML.slice(0, 100)))
  assert.deepEqual(untitled, [])
  assert.equal(await page.locator('.readout').getAttribute('data-of'), 'all')
})

// The time axis spans the plot less the level axis at its right, as wide as its labels (view.js axisWidth, --axis on the
// slab); the lanes are 2 px apart (GAP), over the time row (RULER, 22 px)
const LANES = 2
// A sound's lanes fill the picture all told but their foot (FOOT px) and the room under it (ROOM px); a track's lane
// TRACK px, its head line HEAD px over it where the layers are not beside the picture (view.js). `tall(box)`: a sound's
// lanes, all told, in the plot `box`
const TRACK = 160, ROOM = 80, FOOT = 18, HEAD = 20
const tall = box => box.height - 22 - FOOT - ROOM
// Each track's lane, as its layer has it (data-lane: its top and height from the picture's top), CSS px in the page:
// { y, h } in order
const tracksAt = () => page.locator('.layer').evaluateAll(els => els.map(e => { const [y, h] = e.dataset.lane.split(' ').map(Number), p = document.querySelector('.plot').getBoundingClientRect(); return { y: p.y + y, h } }))
const gutter = () => page.evaluate(() => parseFloat(getComputedStyle(document.querySelector('.panes')).getPropertyValue('--axis')))
// All of a sound shown spans the lanes less TAIL px (view.js): to --end px short of the plot's right, the meters past it
const TAIL = 4
const spans = async box => box.width - TAIL - await page.locator('.plot').evaluate(el => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(() => done(parseFloat(getComputedStyle(el).getPropertyValue('--end')))))))
async function axis(duration) {
  const box = await page.locator('.plot').boundingBox(), w = await spans(box)
  return { box, x: t => box.x + t / duration * w }
}
// Moves the pointer along `points` until the plot shows `cursor` (a name, or a pattern): where the tool can grab. Marks
// load after the output.
async function grab(points, cursor) {
  const is = c => typeof cursor === 'string' ? c === cursor : cursor.test(c)
  for (const until = Date.now() + 8000; Date.now() < until; await page.waitForTimeout(200))
    for (const [x, y] of points) {
      await page.mouse.move(x, y)
      if (is(await page.locator('.plot').evaluate(el => el.style.cursor))) return [x, y]
    }
  assert.fail(`nothing to grab with ${cursor}`)
}
// the stretch grip's pointer: arrows out to bars, its own (view.js STRETCH)
const STRETCHING = /^url\(.*ew-resize$/
const warps = async () => JSON.parse((await code()).match(/\.warp\((\[.*\])\)/)[1])
// A box on the spectrogram, ⌘ (Ctrl) held as it is pressed: a band of time and frequency; with Alt as well, another
async function boxDrag(from, by, ...keys) {
  for (const k of ['ControlOrMeta', ...keys]) await page.keyboard.down(k)
  await page.mouse.move(...from)
  await page.mouse.down()
  for (const k of ['ControlOrMeta', ...keys]) await page.keyboard.up(k)
  await page.mouse.move(from[0] + by[0], from[1] + by[1], { steps: 6 })
  await page.mouse.up()
}
async function drag([x, y], [dx, dy]) {
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x + dx, y + dy, { steps: 6 })
  await page.mouse.up()
}
const lengthIs = text => page.waitForFunction(text => (e => e.title || e.dataset.tip || '')(document.querySelector('.source')).endsWith(' · ' + text), text)
// What reaches the speakers: every AudioContext's destination becomes a tap recording its left channel, run before the page
function tap() {
  const Real = window.AudioContext
  window.__heard = []
  window.AudioContext = class extends Real {
    constructor(...args) {
      super(...args)
      const gain = this.createGain(), rec = this.createScriptProcessor(4096, 2, 2), out = super.destination
      gain.connect(out); gain.connect(rec); rec.connect(out)
      rec.onaudioprocess = e => window.__heard.push(Float32Array.from(e.inputBuffer.getChannelData(0)))
      Object.defineProperty(this, 'destination', { get: () => gain })
    }
  }
}
// What reaches the speakers, taken on the audio thread, the page's thread busy or not: every AudioContext's destination
// becomes a worklet keeping its left channel, block by block, in window.__taken; run before the page
function taken() {
  const Real = window.AudioContext
  window.__taken = []
  window.AudioContext = class extends Real {
    constructor(...args) {
      super(...args)
      const gain = this.createGain(), out = super.destination
      gain.connect(out)
      window.__rate = this.sampleRate
      const code = `registerProcessor('taken', class extends AudioWorkletProcessor { process([[left]]) { if (left) this.port.postMessage(left.slice()); return true } })`
      this.audioWorklet.addModule(URL.createObjectURL(new Blob([code], { type: 'text/javascript' }))).then(() => {
        const node = new AudioWorkletNode(this, 'taken')
        node.port.onmessage = e => window.__taken.push(e.data)
        gain.connect(node)
        node.connect(out)
      })
      Object.defineProperty(this, 'destination', { get: () => gain })
    }
  }
}
// The peak heard since the last call, and whether every sample was a number
const heard = () => page.evaluate(() => {
  let peak = 0, finite = true
  for (const block of window.__heard.splice(0)) for (const v of block) { if (!Number.isFinite(v)) finite = false; else if (Math.abs(v) > peak) peak = Math.abs(v) }
  return { peak, finite }
})

// A 440 Hz hit every half second, decaying from full scale, within 0.02 of zero (its end, the ground's) a third of a
// second after.
const hits = `audio.from(t => Math.sin(2 * Math.PI * 440 * t) * Math.exp(-(t % 0.5) * 12), { duration: 2 })`
// The hits' lines, where the caret steps by cues as by words (⌥ → on a Mac, Ctrl → elsewhere) from the start to the end,
// each time it lands on as the clock says it, in px from the plot's left; the caret back at the start
async function handles() {
  await page.locator('.plot').focus()
  const now = async () => { const [m, s] = (await page.locator('.time').innerText()).split(':'); return +m * 60 + +s }
  await page.keyboard.press('End')
  const end = await now(), w = await spans(await page.locator('.plot').boundingBox()), out = []
  await page.keyboard.press('Home')
  for (let t = 0; ;) {
    await page.keyboard.press(process.platform === 'darwin' ? 'Alt+ArrowRight' : 'Control+ArrowRight')
    const next = await now()
    if (next <= t || next >= end - .001) break
    out.push((t = next) / end * w)
  }
  await page.keyboard.press('Home')
  return out
}
// A hit's line dragged, ⌘ (Ctrl) held: grabbed where the pointer finds it along `points`
async function dragCue(points, by) {
  await page.keyboard.down('ControlOrMeta')
  await drag(await grab(points, 'col-resize'), by)
  await page.keyboard.up('ControlOrMeta')
}

// Cues stay out of sight, a forest over the sound otherwise: held Alt, every one, faint, as Figma shows what there is to
// snap to; held ⌘ (Ctrl), only the one under the pointer, the one a press would take; away from them, none. Lit lines
// are orange runs along a row 4 px under the lanes' top.
test('editor: held Alt, every cue shows; held ⌘, only the one under the pointer', async () => {
  await open()
  await write(hits)
  await lengthIs('0:02.000')
  const { box, x } = await axis(2), y = box.y + 40
  const lit = async () => pixels(`let n = 0, run = false; for (let x = 0; x < w - ${await gutter()}; x++) { const i = (4 * w + x) * 4, on = d[i] - d[i + 2] > 60; if (on && !run) n++; run = on } return n`)
  let cue = []
  const w = await spans(box)
  for (const until = Date.now() + 8000; !cue.length && Date.now() < until; await page.waitForTimeout(200)) cue = (await handles()).map(px => px / w * 2).filter(t => Math.abs(t - 1) < .02)
  assert.equal(cue.length, 1)
  assert.equal(await lit(), 0, 'none shown')
  await page.mouse.move(x(.75), y)
  await page.keyboard.down('Alt')
  const all = await lit()
  await page.keyboard.up('Alt')
  assert.ok(all >= 3, `held Alt: every one, ${all}`)
  await page.keyboard.down('ControlOrMeta')
  assert.equal(await lit(), 0, 'held ⌘ away from them: none')
  await page.mouse.move(x(cue[0]) + 1, y)
  assert.equal(await lit(), 1, 'the one under the pointer')
  await page.keyboard.up('ControlOrMeta')
})

// Zoomed out, the cues crowd: those shown none within 24 px of a plainer one, the main ones, as a map names its larger
// towns first; zoomed in, the rest come. A strike every 0.1 s for 60 s: 600, a few px apart across the view.
test('editor: zoomed out, only the plainer cues show, none within 24 px of another; zoomed in, all', async () => {
  await open()
  await write(`audio.from(t => Math.sin(2 * Math.PI * 440 * t) * Math.exp(-(t % 0.1) * 60) * (1 + (Math.floor(t / 0.1) % 5 === 0)), { duration: 60 })`)
  await lengthIs('1:00.000')
  // the cues drawn, held Alt, across the lanes (the meter after them left out), the pointer's own line at 30 px too, and
  // what it measures there (the strikes past full scale: a triangle at the lane's top, 7 px across)
  const box = await page.locator('.plot').boundingBox(), y = box.y + 40
  const runs = async () => (await pixels(`const out = []; let run = false; for (let x = 0; x < ${await spans(box)}; x++) { const i = (4 * w + x) * 4, on = d[i] - d[i + 2] > 40; if (on && !run) out.push(x); run = on } return out`)).filter(x => Math.abs(x - 30) > 5)
  await page.mouse.move(box.x + 30, y)
  let shown = []
  await page.keyboard.down('Alt')
  // a minute's cues found on a slow runner in half a minute or so
  for (const until = Date.now() + 60000; shown.length < 20 && Date.now() < until; await page.waitForTimeout(300)) shown = await runs()
  const apart = Math.min(...shown.slice(1).map((x, i) => x - shown[i]))
  await page.keyboard.up('Alt')
  assert.ok(shown.length > 20 && shown.length < (box.width - await gutter()) / 24 + 2, `${shown.length} shown across ${Math.round(box.width)} px`)
  assert.ok(apart >= 23, `the closest ${apart} px apart`)
  // zoomed in five halvings, under 2 s across: each of its 18 or so strikes, tens of px apart
  await page.locator('.plot').focus()
  for (let i = 0; i < 5; i++) await page.keyboard.press('=')
  await page.mouse.move(box.x + 30, y)
  await page.keyboard.down('Alt')
  await page.waitForTimeout(400)
  const near = await runs()
  await page.keyboard.up('Alt')
  assert.ok(near.length >= 15, `zoomed in: ${near.length}`)
})

// Held Alt, a press held still is the caret's all the same, dragged and heard, no caret added, every cue showing as Alt
// shows them while it goes; without Alt, the caret dragged onto a cue keeps its colour, a small triangle in the cues'
// colour at its top and its foot marking the snap
test('editor: held Alt, a press held takes the caret along, the cues showing; onto a cue, a cross where it meets the waveform', async () => {
  await page.route('**/playground/editor.js', async route => { const r = await route.fetch(); route.fulfill({ response: r, body: (await r.text()).replace('v = view(', 'v = globalThis.__view = view(') }) })
  await open()
  await write(hits)
  await lengthIs('0:02.000')
  const { box, x } = await axis(2), y = box.y + 40, w = await spans(box)
  // the runs of the cues' colour across the lanes' top row, [x, …] px
  const lit = async () => pixels(`const out = []; let run = false; for (let x = 0; x < ${w}; x++) { const i = (4 * w + x) * 4, on = d[i] - d[i + 2] > 60; if (on && !run) out.push(x); run = on } return out`)
  let cue = []
  for (const until = Date.now() + 8000; !cue.length && Date.now() < until; await page.waitForTimeout(200)) cue = (await handles()).map(px => px / w * 2).filter(t => Math.abs(t - 1) < .02)
  const clock = async () => +(await page.locator('.time').innerText()).split(':')[1]
  await page.mouse.move(x(.75), y)
  await page.keyboard.down('Alt')
  await page.mouse.down()
  await page.waitForTimeout(650)
  await page.mouse.move(x(1.25), y, { steps: 6 })
  const shown = await lit()
  await page.mouse.up()
  await page.keyboard.up('Alt')
  assert.ok(shown.length >= 3, `held Alt, the caret dragged: every cue, ${shown}`)
  assert.equal(await selected(), '', 'nothing selected')
  assert.ok(Math.abs(await clock() - 1.25) < .03, `the caret where it was let go: ${await clock()}`)
  assert.equal(await page.evaluate(() => __view.carets.length), 1, 'no caret added')
  // without Alt, the caret dragged onto the cue at 1 s: a cross in the cues' colour where its line meets the waveform,
  // its line in its own colour (the rows with the cues' colour just before it, where no wash is: a cross's arms)
  await page.mouse.move(x(.75), y)
  await page.mouse.down()
  await page.waitForTimeout(650)
  await page.mouse.move(x(cue[0]) + 1, y, { steps: 6 })
  await page.waitForTimeout(100)
  const px = Math.round(x(cue[0]) - box.x), lane = tall(box)
  const onto = await pixels(`const orange = (x, y) => { const i = (y * w + x) * 4; return d[i] - d[i + 2] > 30 }, rows = []
    for (let y = 0; y < Math.round(arg.lane); y++) if ([-3, -2, -1].some(dx => orange(arg.px + dx, y))) rows.push(y)
    return { rows, line: [4, Math.round(arg.lane) - 4].some(y => !rows.includes(y) && orange(arg.px, y)) }`, { px, lane })
  await page.mouse.up()
  assert.ok(Math.abs(await clock() - cue[0]) < 2e-3, `the caret on the cue: ${await clock()}`)
  assert.ok(onto.rows.length >= 3 && onto.rows.length <= 14 && !onto.line, `a cross or two where it meets the waveform, its line its own colour: ${JSON.stringify(onto)}`)
})

// A range begun within a few px of a cue starts on it, as the pointer's time said it would; its end dragged onto one is
// the caret's line there (the caret at the end a drag moves), the crosses where it meets the waveform saying it snapped
test('editor: a range begun by a cue starts on it; its end dragged onto one, the caret\'s line there', async () => {
  await open()
  await write(hits)
  await lengthIs('0:02.000')
  const { box, x } = await axis(2), y = box.y + 40, w = await spans(box)
  let cues = []
  for (const until = Date.now() + 8000; !cues.some(t => Math.abs(t - 1) < .02) && Date.now() < until; await page.waitForTimeout(200)) cues = (await handles()).map(px => px / w * 2)
  const a = cues.find(t => Math.abs(t - .5) < .02), b = cues.find(t => Math.abs(t - 1) < .02)
  // white down the lane's top rows, over the sound's quiet edge, at a column (or a pixel either side): how many of rows
  // 6 to 16
  const white = px => pixels(`let most = 0; for (let x = arg - 1; x <= arg + 1; x++) { let n = 0; for (let y = 6; y < 16; y++) { const i = (y * w + x) * 4; if (d[i] > 150 && d[i + 2] > 150 && Math.abs(d[i] - d[i + 2]) < 30) n++ } most = Math.max(most, n) } return most`, Math.round(px - box.x))
  await page.mouse.move(x(a) + 2, y)
  await page.mouse.down()
  await page.mouse.move(x(b) - 2, y, { steps: 6 })
  let line = 0
  for (const until = Date.now() + 2000; line < 8 && Date.now() < until; await page.waitForTimeout(100)) line = await white(x(b))
  const off = await white(x(b) - 6)
  await page.mouse.up()
  assert.ok(line >= 8 && off < 3, `the end on the cue, a line there: ${line} of 10 rows, beside it ${off}`)
  const [from, to] = (await selected()).split('–').map(t => +t.split(':')[1])
  assert.ok(Math.abs(from - a) < .002 && Math.abs(to - b) < .002, `from the cue to the cue: ${from}–${to}, the cues ${a}, ${b}`)
})

// What a drag went onto: a marker by its name, a range's end by its name and end, as Figma names what an object snapped
// to, a cross over its triangle in the strip; a cue, nothing said, a faint wash fading from it to the side its sound is
// on (here a tone struck every half second, gone quiet between: each strike where a sound starts, after it; where it has
// faded under the pauses' level, before)
test('editor: a caret dragged onto a cue or a marker says what it went onto', async () => {
  await open()
  await write(hits + `\n  .mark(0.75, 'Intro')\n  .mark({ at: 1.6, d: 0.2 }, 'Coda')`)
  await lengthIs('0:02.000')
  const { box, x } = await axis(2), y = box.y + 40, w = await spans(box)
  let cues = []
  for (const until = Date.now() + 8000; !cues.some(t => Math.abs(t - 1) < .02) && Date.now() < until; await page.waitForTimeout(200)) cues = (await handles()).map(px => px / w * 2)
  const start = cues.find(t => Math.abs(t - 1) < .02), end = cues.find(t => t > 1.1 && t < 1.45)
  const said = () => page.locator('.hint').evaluate(e => e.hidden ? '' : e.textContent)
  // the cues' colour 5 px either side of the line (its wash WASH, 8 px), half way down the lane: [before, after]
  const washed = t => pixels(`const orange = x => { const i = (arg.y * w + x) * 4; return d[i] - d[i + 2] > 12 }; return [orange(arg.px - 5), orange(arg.px + 5)]`, { px: Math.round(x(t) - box.x), y: Math.round(tall(box) / 2) })
  // the cues' colour by the line, its own column left out, in the 7 px square about the line's foot, over the strip's
  // triangles
  const crossed = t => pixels(`let n = 0; for (let y = arg.y - 3; y <= arg.y + 3; y++) for (let x = arg.px - 3; x <= arg.px + 3; x++) { const i = (y * w + x) * 4; if (x !== arg.px && d[i] - d[i + 2] > 30) n++ } return n`, { px: Math.round(x(t) - box.x), y: Math.round(tall(box)) - 1 })
  for (const [t, words, wash] of [[start, '', [false, true]], [end, '', [true, false]], [.75, 'Intro'], [1.8, 'Coda end']]) {
    await page.mouse.move(x(.25), y)
    await page.mouse.down()
    // held, the press is the caret's: dragged, it goes along
    await page.waitForTimeout(650)
    await page.mouse.move(x(t) + 1, y, { steps: 6 })
    await page.waitForTimeout(100)
    assert.equal(await said(), words, `onto ${t}`)
    if (wash) assert.deepEqual(await washed(t), wash, `onto ${t}, the wash on the sound's side`)
    if (words) assert.ok(await crossed(t) >= 4, `onto ${t}, a cross on the line's foot, over its triangle: ${await crossed(t)}`)
    await page.mouse.up()
  }
  // let go and moved off it, nothing said
  await page.mouse.move(x(1.75), box.y + 40)
  await page.waitForTimeout(100)
  assert.equal(await said(), '')
})

// A marker by a cue is one snap with it, the marker's: the caret dragged there goes onto the marker's time, a cross over
// its triangle on the line's foot and where the line meets the waveform, as onto the cue
test('editor: a caret dragged onto a marker by a cue snaps once, a cross at each', async () => {
  await open()
  await write(hits + `\n  .mark({ at: 1, d: 0.2 }, 'Hit')`)
  await lengthIs('0:02.000')
  const { box, x } = await axis(2), y = box.y + 40, w = await spans(box), lane = Math.round(tall(box))
  let cues = []
  for (const until = Date.now() + 8000; !cues.some(t => Math.abs(t - 1) < .02) && Date.now() < until; await page.waitForTimeout(200)) cues = (await handles()).map(px => px / w * 2)
  const cue = cues.find(t => Math.abs(t - 1) < .02)
  await page.mouse.move(x(.25), y)
  await page.mouse.down()
  await page.waitForTimeout(650)
  await page.mouse.move(x(cue) + 1, y, { steps: 6 })
  await page.waitForTimeout(150)
  // the cues' colour just before the line (no wash there: the strike's sound is after it), about its foot and up the lane
  const marks = await pixels(`const orange = (x, y) => { const i = (y * w + x) * 4; return d[i] - d[i + 2] > 30 }; let foot = 0, up = 0
    for (let y = 0; y <= arg.lane + 2; y++) for (let x = arg.px - 3; x < arg.px; x++) if (orange(x, y)) y >= arg.lane - 4 ? foot++ : up++
    return { foot, up }`, { px: Math.round(x(1) - box.x), lane })
  await page.mouse.up()
  assert.equal(await page.locator('.time').innerText(), '0:01.000', 'the marker\'s time')
  assert.ok(marks.foot >= 2 && marks.up >= 2, `a cross on its foot and where it meets the waveform: ${JSON.stringify(marks)}`)
})

// A drag that snaps shows where it would: the caret held and dragged, or a range's edge, the cues either side of it
// faint; held Alt, every one, the edge's drag too; pressed with Alt on a range's edge, the edge, as the caret held with
// Alt is the caret, no range added
test('editor: dragged, the caret or an edge shows the cues either side of it; with Alt every one, an edge pressed with Alt its own', async () => {
  await open()
  await write(hits)
  await lengthIs('0:02.000')
  const { box, x } = await axis(2), y = box.y + 40, w = await spans(box)
  const lit = async () => pixels(`const out = []; let run = false; for (let x = 0; x < ${w}; x++) { const i = (4 * w + x) * 4, on = d[i] - d[i + 2] > 30; if (on && !run) out.push(x); run = on } return out`)
  let cues = []
  for (const until = Date.now() + 8000; cues.length < 5 && Date.now() < until; await page.waitForTimeout(200)) cues = (await handles()).map(px => px / w * 2)
  // the caret held at 0.7 s, between the cues at 0.5 s and where that hit falls quiet, a third of a second on
  const [before, after] = [cues.findLast(t => t < .7), cues.find(t => t > .7)]
  await page.mouse.move(x(.65), y)
  await page.mouse.down()
  await page.waitForTimeout(650)
  await page.mouse.move(x(.7), y, { steps: 3 })
  const beside = await lit()
  await page.mouse.up()
  const near = (px, t) => Math.abs(px - (x(t) - box.x)) < 2
  assert.ok(beside.length === 2 && near(beside[0], before) && near(beside[1], after), `the cues either side, at ${before} and ${after} s: ${beside}`)
  // a range's edge pressed with Alt, dragged: the edge's own drag, every cue showing
  await drag([x(.6), y], [x(1.2) - x(.6), 0])
  await page.keyboard.down('Alt')
  await page.mouse.move(x(1.2), y)
  await page.mouse.down()
  await page.mouse.move(x(1.4), y, { steps: 4 })
  const all = await lit()
  await page.mouse.up()
  await page.keyboard.up('Alt')
  assert.ok(all.length >= 5, `held Alt, every cue: ${all}`)
  assert.match(await selected(), /^0:00\.\d+–0:01\.[34]\d+$/, 'its end dragged, no range added')
})

// An edit's output takes the picture in one step, all that is drawn of it ready: weighted (K), never a picture drawn
// from its samples with the last output's levels as heard, the edit drawn ahead holding till they come (a delete once
// flashed the old waveform for a frame, its new samples in before their levels)
test('editor: weighted, an edit\'s output comes in one step, never a frame of the last one\'s levels', async () => {
  await page.route('**/playground/view.js', async route => { const r = await route.fetch(); route.fulfill({ response: r, body: (await r.text()).replace('  function draw() {\n', '  function draw() {\n    globalThis.__draws?.push({ ahead: !!pieces, stale: twinOf.size > 0 && twinsOf !== heardOf })\n') }) })
  // the levels as heard withheld at will (`__deaf`), as when the worker has none to give
  await page.route('**/playground/editor.js', async route => { const r = await route.fetch(); route.fulfill({ response: r, body: (await r.text()).replace('onheard: weighting => output', 'onheard: weighting => !globalThis.__deaf && output') }) })
  const { x, y } = await chime()
  await settings('Weighting', 'K-weighted')
  await page.waitForTimeout(1000)
  await drag([x(2), y], [x(3) - x(2), 0])
  await page.evaluate(() => globalThis.__draws = [])
  await page.keyboard.press('Delete')
  await page.waitForFunction(() => /\.remove\(/.test(scriptText()))
  await lengthIs('0:07.000')
  await page.waitForTimeout(800)
  const draws = await page.evaluate(() => globalThis.__draws)
  assert.ok(draws.some(d => d.ahead) && draws.some(d => !d.ahead), `drawn ahead, then its output: ${JSON.stringify(draws)}`)
  assert.deepEqual(draws.filter(d => d.stale), [], 'no picture of its samples with the last one\'s levels')
  // none to be had for the next, as long as it (a level over a stretch): its samples drawn as they are, the last one's
  // levels gone, never over them
  await page.evaluate(() => { globalThis.__deaf = true; globalThis.__draws = [] })
  await write(`${await code()}\n  .gain(-12, { at: 4, d: 1 })`)
  await page.waitForFunction(() => globalThis.__draws.length > 1)
  await page.waitForTimeout(800)
  assert.deepEqual((await page.evaluate(() => globalThis.__draws)).filter(d => d.stale), [], 'none withheld: no picture with the last one\'s levels')
})

// Shift and a double-click extend what is selected to the fragment clicked, as Shift and a double-click extend a text's
// selection by words: before it or after it, what was selected staying in it; from the caret, the caret to it. Shift and
// a drag, held before the press or after it, show the cues either side of the end it moves, as an edge's drag does
test('editor: Shift and a double-click extend the selection to the fragment; Shift and a drag shows the cues either side', async () => {
  await open()
  await write(bursts)
  await lengthIs('0:02.500')
  const { box, x } = await axis(2.5), y = box.y + tall(box) / 3, w = await spans(box)
  const range = async () => (await selected()).split('–').map(t => +t.split(':')[1])
  const near = ([a, b], [p, q]) => Math.abs(a - p) < .03 && Math.abs(b - q) < .03
  let at = []
  for (const until = Date.now() + 8000; at.length < 7 && Date.now() < until; await page.waitForTimeout(200)) at = (await handles()).map(h => h / w * 2.5)
  await page.mouse.dblclick(x(.7), y)
  assert.ok(near(await range(), [.5, .9]), String(await range()))
  await keyed(['Shift'], () => page.mouse.dblclick(x(1.7), y))
  assert.ok(near(await range(), [.5, 1.9]), `after it: ${await range()}`)
  await keyed(['Shift'], () => page.mouse.dblclick(x(.2), y))
  assert.ok(near(await range(), [0, 1.9]), `before it, what was selected staying: ${await range()}`)
  await page.mouse.click(x(1.2), y)
  await keyed(['Shift'], () => page.mouse.dblclick(x(2.2), y))
  assert.ok(near(await range(), [1.2, 2.4]), `from the caret: ${await range()}`)
  // Shift held, a drag from the caret: the cues either side of where its end is
  await page.mouse.click(x(.2), y)
  const lit = async () => pixels(`const out = []; let run = false; for (let x = 0; x < ${w}; x++) { const i = (4 * w + x) * 4, on = d[i] - d[i + 2] > 30; if (on && !run) out.push(x); run = on } return out`)
  await page.keyboard.down('Shift')
  await page.mouse.move(x(1.1), y)
  await page.mouse.down()
  await page.mouse.move(x(1.2), y, { steps: 3 })
  const beside = await lit()
  await page.mouse.up()
  await page.keyboard.up('Shift')
  const edge = t => beside.some(px => Math.abs(px - (x(t) - box.x)) < 3)
  assert.ok(beside.length === 2 && edge(.9) && edge(1.5), `the cues either side of 1.2 s, where the pause before is: ${beside}`)
})

// A muted track's waveform drawn dim, the ground under it as it is: no veil over its lane, which lit the ground as a
// selection does
test('editor: a muted track\'s waveform is dim, its lane\'s ground as it was', async () => {
  await open()
  await noCues()
  await write(`let a = audio.from(t => .6 * Math.sin(2 * Math.PI * 220 * t), { duration: 3 })\n\nlet b = audio.from(t => .6 * Math.sin(2 * Math.PI * 330 * t), { duration: 3 })`)
  await page.locator('.track-mute').nth(1).waitFor()
  await page.waitForTimeout(800)
  const box = await page.locator('.plot').boundingBox()
  const rows = await page.evaluate(() => [...document.querySelectorAll('.layer')].map(l => l.getBoundingClientRect().bottom))
  // the second lane's ground near its top, and its waveform's middle, the brightest across its middle row
  const look = () => pixels(`const at = (x, y) => d[(Math.round(y) * w + Math.round(x)) * 4]; let wave = 0; for (let x = 20; x < 400; x++) wave = Math.max(wave, at(x, arg.mid)); return { ground: at(200, arg.top), wave }`, { top: rows[1] - box.y + 6, mid: rows[1] - box.y + 80 })
  const was = await look()
  await page.locator('.track-mute').nth(1).click()
  await page.waitForTimeout(500)
  const now = await look()
  assert.ok(Math.abs(now.ground - was.ground) <= 2, `the ground as it was: ${was.ground} → ${now.ground}`)
  assert.ok(now.wave < was.wave - 40, `the waveform dim: ${was.wave} → ${now.wave}`)
})

// The third click of a triple-click, where the double one was, is a click: dragged a little on its way, never the audio
// the double-click selected, which a press inside a selection otherwise carries
test('editor: a triple-click\'s third press, nudged, moves no audio', async () => {
  await open()
  await noCues()
  await write(bursts)
  await lengthIs('0:02.500')
  const { box, x } = await axis(2.5), y = box.y + tall(box) / 3
  await page.mouse.dblclick(x(.7), y)
  assert.notEqual(await selected(), '', 'the burst selected')
  const before = await code()
  await page.mouse.down()
  await page.mouse.move(x(.7) + 20, y, { steps: 4 })
  await page.mouse.up()
  await page.waitForTimeout(400)
  assert.equal(await code(), before, 'no audio moved')
})

// A sound's cues, however quiet it is beside a loud one, at any zoom, but none of the ground's: strikes every second, the
// first 0.5 high, the next two 0.03 (a noise that is a sound), the last 0.01 (within 0.02 of zero, the ground)
test('editor: a quiet sound has its cues by a loud one; within 0.02 of zero, none', async () => {
  await open()
  await write(`audio.from(t => Math.sin(2 * Math.PI * 440 * t) * Math.exp(-(t % 1) * 20) * (t < 1 ? 0 : t < 2 ? .5 : t < 4 ? .03 : .01), { duration: 5 })`)
  await lengthIs('0:05.000')
  const w = await spans(await page.locator('.plot').boundingBox()), near = (at, t) => at.some(s => Math.abs(s - t) < .03)
  let at = []
  for (const until = Date.now() + 8000; !(near(at, 1) && near(at, 3)) && Date.now() < until; await page.waitForTimeout(200)) at = (await handles()).map(h => h / w * 5)
  assert.ok(near(at, 1) && near(at, 2) && near(at, 3), `the loud strike's and the quiet ones': ${at}`)
  assert.deepEqual(at.filter(t => t > 3.9), [], `none of the ground's: ${at}`)
})

// The ground is no sound: between two bursts, blips of a tone 0.006 high, 100 ms on and off, within 0.02 of zero, where
// the pauses are read (once over their level, an edge each); none of them a cue, the bursts' own edges staying
test('editor: blips of the ground between two sounds make no cues; the sounds\' edges stay', async () => {
  await open()
  await write(`audio.from(t => t > .2 && t < .6 || t > 2.4 && t < 2.8 ? .5 * Math.sin(2 * Math.PI * 440 * t) : t > .6 && t < 2.4 && Math.floor(t * 10) % 2 ? .006 * Math.sin(2 * Math.PI * 1000 * t) : 0, { duration: 3 })`)
  await lengthIs('0:03.000')
  const w = await spans(await page.locator('.plot').boundingBox()), near = (at, t) => at.some(s => Math.abs(s - t) < .03)
  let at = []
  for (const until = Date.now() + 8000; !(near(at, .6) && near(at, 2.4)) && Date.now() < until; await page.waitForTimeout(200)) at = (await handles()).map(h => h / w * 3)
  assert.ok(near(at, .6) && near(at, 2.4), `the bursts' edges: ${at}`)
  assert.deepEqual(at.filter(t => t > .65 && t < 2.35), [], 'none in the blips between')
})

// The cues are where sounds start and end and where they hit, one list: each hit here (0.5 s apart), and where each falls
// quiet before the next. A cue dragged warps the audio between the cues either side, which hold.
test('editor: dragging a cue moves it, the audio on either side stretching to fit, the cues either side holding', async () => {
  await page.route('**/playground/editor.js', async route => { const r = await route.fetch(); route.fulfill({ response: r, body: (await r.text()).replace('let output = null, incoming', 'globalThis.__output = () => output\nlet output = null, incoming') }) })
  await open()
  await write(hits)
  await lengthIs('0:02.000')
  // the cues are lines in the lanes, each grabbed there with ⌘ (Ctrl) held; without it, a press there is the caret's
  const { box, x } = await axis(2), y = box.y + 20, cursor = () => page.locator('.plot').evaluate(el => el.style.cursor)
  // the hit at 1 s, and the cues either side of it, before it moves
  let cues = []
  const w = await spans(box)
  for (const until = Date.now() + 8000; !cues.some(t => Math.abs(t - 1) < .02) && Date.now() < until; await page.waitForTimeout(200)) cues = (await handles()).map(px => px / w * 2)
  const prev = cues.findLast(t => t < .95), next = cues.find(t => t > 1.05)
  assert.ok(prev > .5 && next < 1.5, `a cue where the hit before falls quiet, and where this one does: ${JSON.stringify(cues)}`)
  await page.keyboard.down('ControlOrMeta')
  const at = await grab(Array.from({ length: Math.ceil(x(1.05) - x(.95)) }, (_, i) => [x(.95) + i, y]), 'col-resize')
  // the hit the sound starts with is the start, which warp() holds: no line there
  await page.mouse.move(x(.25), y)
  assert.notEqual(await cursor(), 'col-resize')
  await page.mouse.move(x(0) + 2, y)
  assert.notEqual(await cursor(), 'col-resize')
  await page.keyboard.up('ControlOrMeta')
  await page.mouse.move(...at)
  assert.notEqual(await cursor(), 'col-resize', 'no cue to take without ⌘')
  await page.keyboard.down('ControlOrMeta')
  await drag(await grab([at], 'col-resize'), [x(1.2) - x(1), 0])
  await page.keyboard.up('ControlOrMeta')
  await page.waitForFunction(() => /\.warp\(/.test(scriptText()))
  const markers = await warps(), [moved] = markers.filter(([a, b]) => a !== b), held = markers.filter(([a, b]) => a === b).map(([a]) => a)
  // the hit at 1 s lands 0.2 s later; the cues either side hold the rest in place
  assert.equal(markers.length, 3, JSON.stringify(markers))
  assert.ok(Math.abs(moved[0] - 1) < .03 && Math.abs(moved[1] - moved[0] - .2) < .01, JSON.stringify(markers))
  assert.ok(Math.abs(held[0] - prev) < .01 && Math.abs(held[1] - next) < .01, JSON.stringify([held, prev, next]))
  // the moved hit is its marker now: dragged again, that marker moves on, once the output of the first drag has come and
  // its cues with it (they replace the ones the view moved, a few pixels off, under a press on its way)
  await page.waitForFunction(() => globalThis.__output()?.editor?.includes('.warp('))
  await page.waitForTimeout(400)
  await dragCue(Array.from({ length: 13 }, (_, i) => [x(moved[1]) - 6 + i, y]), [x(.1) - x(0), 0])
  await page.waitForFunction(to => scriptText().includes(`, ${to}`) === false, moved[1])
  const later = await warps()
  assert.equal(later.length, 3, JSON.stringify(later))
  assert.ok(later.some(([a, b]) => a === moved[0] && Math.abs(b - moved[1] - .1) < .01), JSON.stringify(later))
  // another cue joins the same call: the one held before it moves 0.1 s later
  const [first] = later
  await dragCue(Array.from({ length: 13 }, (_, i) => [x(first[1]) - 6 + i, y]), [x(.1) - x(0), 0])
  const it = list => list.find(([a]) => a === first[0])
  let last = later
  for (const until = Date.now() + 5000; Math.abs(it(last)[1] - first[1] - .1) >= .01 && Date.now() < until; await page.waitForTimeout(100)) last = await warps()
  assert.equal((await code()).match(/\.warp\(/g).length, 1)
  // it moved, the cue before it now holding too (the hit at 0.5 s), the rest as they were
  assert.ok(Math.abs(it(last)[1] - first[1] - .1) < .01, JSON.stringify(last))
  assert.equal(last.length, 4, JSON.stringify(last))
  assert.ok(Math.abs(last[0][0] - .5) < .01 && last[0][0] === last[0][1], JSON.stringify(last))
  assert.deepEqual(last.slice(2), later.slice(1))
  await wholeLevels().waitFor()
  await lengthIs('0:02.000')
})

// The chime rings on, its partials beating: its cues are its eight strikes and where its rings fall quiet, not the swells
// of its rings, and one dragged moves alone.
test('editor: a dragged cue moves alone; the sound stretched around it makes no new cues', async () => {
  await open()
  // the chime's strikes after its first, which the caret starts on
  let before = []
  for (const until = Date.now() + 8000; before.length < 7 && Date.now() < until; await page.waitForTimeout(200)) before = await handles()
  assert.ok(before.length >= 7, JSON.stringify(before))
  // 0.2 s later, a cue with room for it either side
  const box = await page.locator('.plot').boundingBox(), dx = .2 / 6.525 * await spans(box)
  const k = before.findIndex((p, i) => i > 0 && i < before.length - 1 && before[i + 1] - p > dx * 1.5 && p - before[i - 1] > dx * .5)
  assert.ok(k > 0, JSON.stringify(before))
  await dragCue([[box.x + before[k], box.y + 20]], [dx, 0])
  await page.waitForFunction(() => /\.warp\(/.test(scriptText()))
  await page.waitForTimeout(1500)
  const after = await handles()
  await page.waitForTimeout(1000)
  assert.deepEqual(await handles(), after, 'settled')
  assert.equal(after.length, before.length, JSON.stringify(after))
  assert.ok(Math.abs(after[k] - before[k] - dx) <= 2, `${before[k]} → ${after[k]}`)
  assert.ok(after.every((x, i) => i === k || Math.abs(x - before[i]) <= 1), JSON.stringify([before, after]))
})

// A chord's ring, stretched, swells anew under the piano's tremolo: found again in the warped output, a drag would
// grow cues in the spans it stretched. Carried from before warp(), every other cue stays on its pixel.
test('editor: a cue dragged over a sustained sound leaves every other cue where it was', async () => {
  await open()
  await write(`audio('rhodes.wav')`)
  await lengthIs('0:09.000')
  const { box, x } = await axis(9), y = box.y + 20
  let before = []
  for (const until = Date.now() + 8000; !before.length && Date.now() < until; await page.waitForTimeout(200)) before = await handles()
  // the chord struck at 4.85 s, moved half a second earlier
  const from = before.reduce((a, h) => Math.abs(h - (x(4.853) - box.x)) < Math.abs(a - (x(4.853) - box.x)) ? h : a), to = from - (x(.5) - x(0))
  await dragCue([[box.x + from, y]], [to - from, 0])
  await page.waitForFunction(() => /\.warp\(/.test(scriptText()))
  await page.waitForTimeout(1500)
  const after = await handles()
  await page.waitForTimeout(1000)
  assert.deepEqual(await handles(), after, 'settled')
  const others = list => list.filter(h => Math.abs(h - from) > 8 && Math.abs(h - to) > 8)
  assert.ok(after.some(h => Math.abs(h - to) <= 2), `a cue where it was dropped (${to})`)
  assert.equal(others(after).length, others(before).length, JSON.stringify([before, after]))
  assert.ok(others(after).every((h, i) => Math.abs(h - others(before)[i]) <= 1), JSON.stringify([before, after]))
})

// The gain line shows once there is a curve: a level change on a selection makes one (a trapezoid, its ramps 5 ms)
// The line shows while its step is chosen in the edits, to be worked on; else it is out of sight
test('editor: a level change draws the gain line; its points drag, above or mirrored below, and a double-click takes one away', async () => {
  await open()
  await write(`audio.from(t => 0.5 * Math.sin(2 * Math.PI * 440 * t), { duration: 2 })`)
  await lengthIs('0:02.000')
  // the edits open, beside the picture, all of the sound shown again in what is left of it
  await tab('Edits')
  await page.waitForTimeout(400)
  await page.locator('.plot').focus()
  await page.keyboard.press('0')
  const { box, x } = await axis(2), mid = box.y + tall(box) * .4
  await page.mouse.move(x(.5), mid)
  await page.mouse.down()
  await page.mouse.move(x(1.5), mid, { steps: 5 })
  await page.mouse.up()
  await palette('3 dB louder')
  await page.waitForFunction(() => /\.gain\(\{ t: \[/.test(scriptText()))
  const curve = async () => (await code()).match(/\.gain\(\{ t: (\[.*?\]), v: (\[.*?\]) \}\)/).slice(1).map(s => JSON.parse(s.replace(/−/g, '-')))
  const [t, v] = await curve()
  assert.deepEqual(v, [0, 3, 3, 0])
  // the sine's −6.02 dBFS (20·log10 .5), 3 dB up where the curve is flat: −3.0, the selection's and the output's
  // the selection's: its peak on the bar, its levels in the tooltip
  await page.waitForFunction(() => (e => e.dataset.of === 'selection' && e.textContent === '−3.0dBFS')(document.querySelector('.readout')))
  assert.match(await levelsTable(), /\nPeak −3\.0dBFS at /)
  await page.keyboard.press('Escape')
  await wholeLevels().filter({ hasText: '−3.0dBFS' }).waitFor()
  // none till its step is chosen
  const card = page.locator('.step', { has: page.locator('.step-name', { hasText: 'Gain' }) })
  await card.locator('.step-toggle').click()
  // nothing selected, so a press on the line is the line's, not the selection's audio
  await page.mouse.click(x(1.9), mid)
  // the line on its own scale (view.js GAIN): −36 dB at the lane's centre line to +12 at its edges, mirrored below
  const lane = tall(box), centre = box.y + lane / 2, gy = (db, sign = 1) => centre - sign * (db + 36) / 48 * lane / 2
  // its height first, then out to 5 px either side: the points of a 5 ms ramp, 3 px across and 5 px up the lane, apart
  const near = (t, db, sign = 1) => Array.from({ length: 11 }, (_, i) => [x(t), gy(db, sign) + (i % 2 ? -1 : 1) * Math.ceil(i / 2)])
  // between its points, the line itself: a press there adds one
  const line = await grab(near(1, 3), 'ns-resize')
  // a point, dragged toward the centre line: quieter
  await drag(await grab(near(t[1], 3), 'move'), [0, 40])
  await page.waitForFunction(() => { const m = scriptText().match(/v: \[[^,]+, ([−\d.-]+),/); return m && +m[1].replace('−', '-') < 3 })
  assert.equal((await curve())[0][1], t[1], 'the point keeps its time')
  // its mirror image below the centre line drags it too
  await drag(await grab(near(t[2], 3, -1), 'move'), [0, -20])
  await page.waitForFunction(() => { const m = scriptText().match(/v: \[[^,]+, [^,]+, ([−\d.-]+),/); return m && +m[1].replace('−', '-') < 3 })
  // a double-click on a point takes it away
  await page.mouse.dblclick(...await grab(near(t[3], 0), 'move'))
  await page.waitForFunction(() => scriptText().match(/t: \[([^\]]+)\]/)?.[1].split(',').length === 3)
  assert.ok(line, 'the line is there to grab between its points')
})

// Pitch is edited in its own context (View > Pitch curve), on the spectrogram, which the picture turns to: the pitch curve
// drawn on the voice's harmonics, none over the waveform; dragged up or down, by cents as the pitch tool goes (12 (dy /
// lh)²), the whole pitch line moves with it, one voice's pitch() curve (with no points, one where it was pressed), all of
// the voice moved; dragged again, the same curve set again
test('editor: dragging the pitch curve moves the whole pitch line, a voice\'s pitch() curve', async () => {
  await open()
  await write(`audio.from(t => 0.5 * Math.sin(2 * Math.PI * 220 * t) * (t > 0.5 && t < 1.5), { duration: 2 })`)
  await lengthIs('0:02.000')
  await menu('View', 'Show', 'Pitch curve')
  assert.equal(await shown(), 'Spectrogram')
  // the curve, wherever the spectrogram's scale puts 220 Hz: up its lane at 1 s
  const { box, x } = await axis(2), up = Array.from({ length: Math.floor(tall(box) / 3) }, (_, i) => [x(1), box.y + tall(box) - 3 * i])
  // none over the waveform, which has no pitch axis: where the tone's 220 Hz would be on a voice's range (60 Hz to 1 kHz
  // on octaves, view.js VOICE), nothing to grab, the pitch line's 0 half a lane away from it
  await grab(up, 'ns-resize')
  await show('wave')
  const f0y = box.y + tall(box) * (1 - Math.log(220 / 60) / Math.log(1000 / 60))
  for (let i = 0; i < 9; i++) { await page.mouse.move(x(1), f0y - 4 + i); assert.notEqual(await page.locator('.plot').evaluate(el => el.style.cursor), 'ns-resize') }
  // Pitch curve off: back to the waveform the spectrogram was turned to from; on again, the spectrogram
  await show('spec')
  await menu('View', 'Show', 'Pitch curve')
  assert.equal(await shown(), 'Waveform')
  await menu('View', 'Show', 'Pitch curve')
  assert.equal(await shown(), 'Spectrogram')
  const at = await grab(up, 'ns-resize')
  await page.mouse.move(...at)
  await page.mouse.down()
  const lh = tall(box)
  await page.mouse.move(at[0], at[1] - lh * Math.sqrt(2.5 / 12), { steps: 6 })
  assert.match(await page.locator('.hint').innerText(), /^\+2st [3-6]\dct, A3([+−]\d+ct)? → .+, all of it$/)
  await page.mouse.up()
  await page.waitForFunction(() => /\.pitch\(\{ t: \[1\], v: \[[1-9][\d.]*\] \}, \{ voice: true \}\)$/.test(scriptText().trim()))
  const st = +(await code()).match(/v: \[([\d.]+)\]/)[1]
  // dragged down again: the same curve, its semitones back toward 0
  await drag(await grab(up, 'ns-resize'), [0, lh / 4])
  await page.waitForFunction(st => { const m = scriptText().match(/v: \[([\d.]+)\]/); return m && +m[1] < st }, st)
  assert.equal((await code()).match(/\.pitch\(/g).length, 1, await code())
})

// A click on the pitch curve makes a point of the pitch line there, nothing changed yet; points are the line's, as the
// gain line's: one between two bends the line between them, heard as it goes; a double-click on it takes it away
test('editor: a click on the pitch curve makes a point of the pitch line; dragged between two, it bends what is between', async () => {
  await page.addInitScript(tap)
  await open()
  await write(`audio.from(t => 0.5 * Math.sin(2 * Math.PI * 220 * t) * (t > 0.5 && t < 1.5), { duration: 2 })`)
  await lengthIs('0:02.000')
  await menu('View', 'Show', 'Pitch curve')
  const { box, x } = await axis(2), up = t => Array.from({ length: Math.floor(tall(box) / 3) }, (_, i) => [x(t), box.y + tall(box) - 3 * i])
  await page.mouse.click(...await grab(up(.7), 'ns-resize'))
  await page.waitForFunction(() => /\.pitch\(\{ t: \[0\.7\], v: \[0\] \}, \{ voice: true \}\)$/.test(scriptText().trim()))
  await page.mouse.click(...await grab(up(1.3), 'ns-resize'))
  await page.waitForFunction(() => /\.pitch\(\{ t: \[0\.7, 1\.3\], v: \[0, 0\] \}, \{ voice: true \}\)$/.test(scriptText().trim()))
  const at = await grab(up(1), 'ns-resize')
  await page.mouse.click(...at)
  await page.waitForFunction(() => /\.pitch\(\{ t: \[0\.7, 1, 1\.3\], v: \[0, 0, 0\] \}, \{ voice: true \}\)$/.test(scriptText().trim()))
  const point = await grab(Array.from({ length: 9 }, (_, i) => [at[0], at[1] - 4 + i]), 'move')
  await heard()
  await page.mouse.move(...point)
  await page.mouse.down()
  const lh = tall(box)
  await page.mouse.move(point[0], point[1] - lh * Math.sqrt(1.5 / 12), { steps: 6 })
  await page.waitForTimeout(500)
  assert.match(await page.locator('.hint').innerText(), /^\+1st [3-6]\dct, A3([+−]\d+ct)? → /)
  const { peak } = await heard()
  assert.ok(peak > .05, `heard as it goes: ${peak}`)
  await page.mouse.up()
  await page.waitForFunction(() => /\.pitch\(\{ t: \[0\.7, 1, 1\.3\], v: \[0, [1-9][\d.]*, 0\] \}, \{ voice: true \}\)$/.test(scriptText().trim()))
  // on the curve as it now is, a double-click takes it away; the two either side stay
  const raised = await grab(Array.from({ length: 40 }, (_, i) => [point[0], point[1] - 2 * i]), 'move')
  await page.mouse.dblclick(...raised)
  await page.waitForFunction(() => /\.pitch\(\{ t: \[0\.7, 1\.3\], v: \[0, 0\] \}, \{ voice: true \}\)$/.test(scriptText().trim()))
  // the curve dragged between them: every point by as much
  await drag(await grab(up(1), 'ns-resize'), [0, -lh / 3])
  await page.waitForFunction(() => { const m = scriptText().trim().match(/\.pitch\(\{ t: \[0\.7, 1\.3\], v: \[([1-9][\d.]*), ([1-9][\d.]*)\] \}, \{ voice: true \}\)$/); return m && m[1] === m[2] })
})

// The curve's bends as handles, as Praat's Manipulation shows its stylized pitch (PitchTier_stylize, 2 st): none in the
// script till one moves; dragged, a point of the line, the handles either side its anchors at 0, so only what is between
// them moves. A click on a selection's pitch tool shows the curve, the spectrogram framed on the voice
test('editor: the pitch curve\'s bends drag, bending the voice between the handles either side', async () => {
  await open()
  await noCues()
  // a voice swinging ±2.2 semitones about 200 Hz twice a second: highest at 0.5, 1 and 1.5 s (200 + 8π cos 4πt Hz)
  await write(`audio.from(t => 0.5 * Math.sin(2 * Math.PI * (200 * t + 2 * Math.sin(2 * Math.PI * 2 * t))), { duration: 2 })`)
  await lengthIs('0:02.000')
  // the pitch tool at the waveform lane's foot; the spectrogram it turns to fills the plot (lh)
  const { box, x } = await axis(2), lh = tall(box), pitch = tools(x, box, .5, 1.5).pitch
  await drag([x(.5), box.y + 80], [x(1.5) - x(.5), 0])
  await page.mouse.click(...await grab([pitch], 'ns-resize'))
  assert.equal(await shown(), 'Spectrogram')
  await page.keyboard.press('Escape')
  // a handle by the crest at 1 s (Praat's stylization keeps the points a straight line misses most, not the crests
  // themselves: here 0.95 s of a 10 ms track)
  const scan = Array.from({ length: 21 }, (_, k) => .9 + k / 100).flatMap(t => Array.from({ length: Math.floor(lh / 2) }, (_, i) => [x(t), box.y + lh - 2 * i]))
  const knot = await grab(scan, 'move')
  // a click alone changes nothing
  await page.mouse.click(...knot)
  await page.waitForTimeout(300)
  assert.doesNotMatch(await code(), /\.pitch\(/)
  await drag(knot, [0, -lh * Math.sqrt(2 / 12)])
  await page.waitForFunction(() => /\.pitch\(\{ t: \[[\d.]+, [\d.]+, [\d.]+\], v: \[0, [\d.]+, 0\] \}, \{ voice: true \}\)$/.test(scriptText().trim()))
  const [, t, v] = (await code()).match(/t: \[([^\]]+)\], v: \[([^\]]+)\]/), ts = t.split(', ').map(Number), vs = v.split(', ').map(Number)
  assert.ok(Math.abs(ts[1] - 1) < .1 && ts[0] > .6 && ts[0] < ts[1] && ts[2] > ts[1] && ts[2] < 1.4, t)
  assert.ok(Math.abs(vs[1] - 2) < .2, v)
})

test('editor: the caret goes where the pointer presses; Play starts on its press; the loop switch leaves Space to play', async () => {
  await open()
  const { box, x } = await axis(6.525)
  await page.mouse.move(x(2), box.y + tall(box) / 2)
  await page.mouse.down()
  // times go by the zoom's 1-2-5 step just above a pixel (view.js unit): 6.5 s over this plot, 0.02 s
  await page.locator('.time', { hasText: /^0:02\.000$/ }).waitFor()
  await page.mouse.move(x(3), box.y + tall(box) / 2, { steps: 4 })
  await page.mouse.up()
  // the clock shows the caret (where the drag left the selection's moving end), one time always, in the units the
  // settings choose, as the time row writes them; after it how long the selection is, in white, between bars as a length
  // is marked; pointed at, the selection and its samples. The display above the levels still says what the sound is.
  // The settings keep the selection
  const length = () => page.locator('.length').innerText()
  assert.equal(await page.locator('.time').innerText(), '0:03.000')
  assert.equal(await length(), '0:01.000')
  const white = await page.evaluate(() => { const i = document.body.appendChild(document.createElement('i')); i.style.color = 'var(--color-screen-bright)'; const c = getComputedStyle(i).color; i.remove(); return c })
  assert.equal(await page.locator('.length').evaluate(el => getComputedStyle(el).color), white)
  assert.match(await page.locator('.clock').evaluate(tipOf), /^Selected 0:02\.000–0:03\.000: 0:01\.000, 44100 samples/)
  assert.equal(await facts(), '44.1kHz stereo 16-bit')
  assert.match(await readout(), /^−/)
  await settings('Times in', 's')
  assert.equal(await page.locator('.time').innerText(), '3.000s')
  assert.equal(await length(), '1.000s')
  await settings('Times in', 'samples')
  assert.equal(await selected(), '88200–132300')
  assert.equal(await length(), '44100')
  await settings('Times in', 'm:s')
  assert.equal(await selected(), '0:02.000–0:03.000')
  // the press alone plays; the release changes nothing
  const play = await page.locator('button.play').boundingBox()
  await page.mouse.move(play.x + play.width / 2, play.y + play.height / 2)
  await page.mouse.down()
  await page.getByRole('button', { name: 'Pause' }).waitFor()
  await page.mouse.up()
  await page.waitForTimeout(100)
  assert.ok(await page.getByRole('button', { name: 'Pause' }).isVisible())
  await page.keyboard.press('Space')
  await page.getByRole('button', { name: 'Play', exact: true }).waitFor()
  // the loop switch toggles without taking focus, so Space still plays
  await page.getByRole('button', { name: 'Loop' }).click()
  assert.equal(await page.getByRole('button', { name: 'Loop' }).getAttribute('aria-pressed'), 'true')
  assert.notEqual(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')), 'Loop')
  await page.keyboard.press('Space')
  await page.getByRole('button', { name: 'Pause' }).waitFor()
  assert.equal(await page.getByRole('button', { name: 'Loop' }).getAttribute('aria-pressed'), 'true')
})

// The status bar holds still: the transport, the clock, the levels and the rate stay where they are as a selection is made,
// held at its start and dragged, played, and the levels are never cut short, in a wide window and a narrow one (the
// message between them is the one that gives way)
for (const width of [1280, 880]) test(`repl: the status bar holds still as a selection is made, scrubbed and played, a ${width}px window`, async () => {
  await page.setViewportSize({ width, height: 720 })
  await open()
  const still = () => page.evaluate(() => {
    const rect = s => { const r = document.querySelector(`#status ${s}`).getBoundingClientRect(); return [Math.round(r.left), Math.round(r.width)] }
    return { ...Object.fromEntries(['.play', '.record', '.loop', '.clock', '.readout', '.facts'].map(s => [s, rect(s)])), message: rect('.message')[0] }
  })
  const idle = await still(), { box, x } = await axis(6.525), y = box.y + tall(box) / 2
  await page.mouse.move(x(1), y)
  await page.mouse.down()
  await page.mouse.move(x(3), y, { steps: 6 })
  await page.mouse.up()
  await page.locator('.length', { hasText: /^0:02\.\d+$/ }).waitFor()
  assert.deepEqual(await still(), idle, 'a selection made')
  await page.mouse.move(x(1) + 1, y)
  await page.mouse.down()
  for (let i = 1; i <= 4; i++) {
    await page.mouse.move(x(1 + i / 4), y, { steps: 3 })
    await page.waitForTimeout(80)
    assert.deepEqual(await still(), idle, 'its start held and dragged')
  }
  await page.mouse.up()
  await page.keyboard.press('Space')
  await page.getByRole('button', { name: 'Pause' }).waitFor()
  await page.waitForTimeout(200)
  assert.deepEqual(await still(), idle, 'played')
  assert.ok(await page.locator('.readout').evaluate(e => e.scrollWidth <= e.clientWidth), 'the levels whole')
})

// The level and the facts after it one row of figures, as far apart each from the next, embedded as in the whole editor
// (where nothing comes before the level, it keeps by the facts); a tablet's bar, an iPad's 768 px held upright, has
// them all
test('repl: the level and the facts as far apart as each other, embedded or not, a tablet\'s bar showing them', async () => {
  const gaps = () => page.evaluate(() => {
    const text = el => { const r = document.createRange(); r.selectNodeContents(el); return r.getBoundingClientRect() }
    const all = [document.querySelector('.readout'), ...document.querySelectorAll('.facts .fact')].filter(e => getComputedStyle(e).display !== 'none' && e.getClientRects().length).map(text)
    return all.slice(1).map((b, i) => Math.round(b.left - all[i].right))
  })
  await page.setViewportSize({ width: 768, height: 720 })
  await open()
  await wholeLevels().waitFor()
  const whole = await gaps()
  assert.ok(whole.length === 3 && whole.every(g => g === whole[0]), `the level and three facts, evenly: ${whole}`)
  await page.goto(origin + '/blank.html')
  const src = await page.evaluate(async () => {
    await import('/playground/embed.js')
    document.body.innerHTML = `<audio-repl panel="none" controls="play clock history loudness rate channels"><pre><code>audio('chime.wav')</code></pre></audio-repl>`
    return new Promise(r => { const t = setInterval(() => { const f = document.querySelector('audio-repl iframe'); if (f) { clearInterval(t); r(f.getAttribute('src')) } }, 20) })
  })
  await page.setViewportSize({ width: 560, height: 400 })
  await page.goto(new URL(src, origin).href)
  await page.waitForFunction(() => /LUFS$/.test(document.querySelector('.readout')?.textContent))
  const embedded = await gaps()
  assert.ok(embedded.length === 2 && embedded.every(g => g === whole[0]), `embedded, as far apart: ${embedded}, the whole editor's ${whole[0]}`)
})

// Nothing in the bar runs past its end at any width, the panel shut or open: as it narrows, its parts give way (editor.css
// @container bar, picture), the time and the length keeping their size where they did before undo and redo came after them
test('repl: the status bar never runs past its end, from a wide window to a phone\'s', async () => {
  await page.setViewportSize({ width: 1280, height: 720 })
  await open()
  assert.equal(await page.locator('.clock').evaluate(e => getComputedStyle(e).getPropertyValue('--time-size').trim()), '40px', 'the time at its full size, wide')
  const over = []
  for (const side of [false, true]) {
    if (side) await tab('Edits')
    for (let width = 1400; width >= 340; width -= 6) {
      await page.setViewportSize({ width, height: 720 })
      const o = await page.evaluate(() => ['.status', '.status-main'].map(s => { const e = document.querySelector(s); return e.scrollWidth - e.clientWidth }))
      if (Math.max(...o) > 1) over.push(`${width}${side ? ' open' : ''}: ${o}`)
    }
  }
  assert.deepEqual(over, [])
})

test('editor: the playhead starts at the caret and only moves on, however late the device sounds', async () => {
  await open()
  const { box, x } = await axis(6.525)
  await page.mouse.click(x(2), box.y + tall(box) / 2)
  await page.locator('.time', { hasText: '0:02.000' }).waitFor()
  await page.keyboard.press('Space')
  // the clock each frame for half a second: never before 2 s (the device lags the render), never backwards
  const times = await page.evaluate(() => new Promise(done => {
    const out = [], end = performance.now() + 500
    const read = () => { const [m, s] = document.querySelector('.time').textContent.split(':'); out.push(+m * 60 + +s); performance.now() < end ? requestAnimationFrame(read) : done(out) }
    read()
  }))
  assert.ok(times.every(t => t >= 2), times.join())
  assert.ok(times.every((t, i) => !i || t >= times[i - 1]), times.join())
  assert.ok(times.at(-1) > 2.2, times.at(-1))
})

// The caret put elsewhere while it plays, ahead or back: from the press on, the clock reads where it went and runs on from
// there, never a frame where it was (what the speakers still play of it)
test('editor: the caret put elsewhere while it plays goes there at once, never back', async () => {
  await open()
  const { box, x } = await axis(6.525), y = box.y + tall(box) / 2
  await page.mouse.click(x(1), y)
  await page.keyboard.press('Space')
  await page.waitForFunction(() => document.querySelector('.play')?.getAttribute('aria-label') === 'Pause')
  // sounding, the speakers' place running ahead of the caret
  await page.waitForTimeout(800)
  // the clock each frame after a press at `to` s
  const after = async to => {
    await page.evaluate(() => {
      window.__clock = []
      addEventListener('pointerdown', () => { window.__pressed = performance.now() }, { once: true, capture: true })
      const end = performance.now() + 1500, read = () => { const [m, s] = document.querySelector('.time').textContent.split(':'); window.__clock.push([performance.now(), +m * 60 + +s]); performance.now() < end && requestAnimationFrame(read) }
      read()
    })
    await page.mouse.click(x(to), y)
    await page.waitForTimeout(600)
    return page.evaluate(() => window.__clock.filter(([t]) => t > window.__pressed).slice(0, 20).map(([, s]) => s))
  }
  for (const to of [4, .5]) {
    const times = await after(to)
    assert.ok(times.length > 3, times.join())
    assert.ok(times.every(t => t >= to - .01 && t < to + 1), `from ${to} s: ${times.join()}`)
    assert.ok(times.every((t, i) => !i || t >= times[i - 1]), times.join())
  }
  await page.keyboard.press('Space')
})

// Played from a caret past the middle of a zoomed view, the view glides till the playhead holds the middle, never
// jumping there: where it stands across the view, read once paused from the caret and the times two clicks put
test('editor: played from past the middle of a zoomed view, the view glides the playhead to the middle', async () => {
  await open()
  await noCues()
  await write(`audio.from(t => Math.sin(2 * Math.PI * 220 * t) * .3, { duration: 20 })`)
  await lengthIs('0:20.000')
  const box = await page.locator('.plot').boundingBox(), w = box.width - (await gutter()), y = box.y + tall(box) / 2, at = f => box.x + f * w
  await page.mouse.move(at(.5), y)
  for (let i = 0; i < 7; i++) { await page.keyboard.down('Control'); await page.mouse.wheel(0, -120); await page.keyboard.up('Control') }
  const time = async () => { const [m, s] = (await page.locator('.time').innerText()).split(':'); return +m * 60 + +s }
  const across = async () => {
    const t = await time()
    await page.mouse.click(at(.1), y)
    const a = await time()
    await page.mouse.click(at(.9), y)
    const b = await time()
    return .1 + (t - a) / (b - a) * .8
  }
  const play = async ms => {
    await page.mouse.click(at(.85), y)
    await page.keyboard.press('Space')
    await page.waitForFunction(() => document.querySelector('.play')?.getAttribute('aria-label') === 'Pause')
    await page.waitForTimeout(ms)
    await page.keyboard.press('Space')
    return across()
  }
  const soon = await play(50), later = await play(2500)
  assert.ok(soon > .65, `just after it starts, still where it started: ${soon.toFixed(2)}`)
  // (the clock, read paused, is a frame or so past the playhead last drawn)
  assert.ok(Math.abs(later - .5) < .1, `then in the middle: ${later.toFixed(2)}`)
})

// Scrolled while it plays, the view is the hand's: ahead of the playhead or behind it, it stays where it was put; once
// the playhead, seen in it, passes its edge, the view follows again, gliding the playhead to its middle
test('editor: scrolled while it plays, the view stays where it was put till the playhead passes its edge, then follows', async () => {
  await page.route('**/playground/editor.js', async route => { const r = await route.fetch(); route.fulfill({ response: r, body: (await r.text()).replace('v = view(', 'v = globalThis.__view = view(') }) })
  await open()
  await noCues()
  await write(`audio.from(t => Math.sin(2 * Math.PI * 220 * t) * .3, { duration: 20 })`)
  await lengthIs('0:20.000')
  const box = await page.locator('.plot').boundingBox(), w = box.width - (await gutter()), y = box.y + tall(box) / 3
  await page.mouse.move(box.x + 20, y)
  for (let i = 0; i < 10; i++) { await page.keyboard.down('Control'); await page.mouse.wheel(0, -120); await page.keyboard.up('Control') }
  await page.mouse.click(box.x + 20, y)
  await page.keyboard.press('Space')
  await page.waitForFunction(() => document.querySelector('.play')?.getAttribute('aria-label') === 'Pause')
  const range = () => page.evaluate(() => __view.range), time = async () => { const [m, s] = (await page.locator('.time').innerText()).split(':'); return +m * 60 + +s }
  await page.waitForTimeout(600)
  for (const [where, by] of [['ahead', 3], ['behind', -5]]) {
    await page.mouse.wheel(0, w * by)
    await page.waitForTimeout(100)
    const put = await range()
    await page.waitForTimeout(500)
    assert.deepEqual(await range(), put, `${where}, left where it was put`)
  }
  // the playhead in sight, near the left edge: it crosses the view and passes its right edge, and the view follows it to
  // the middle
  const [a, b] = await range(), t = await time()
  await page.mouse.wheel(0, (t - .1 * (b - a) - a) / (b - a) * w)
  const put = await range()
  await page.waitForTimeout(100)
  assert.deepEqual(await range(), put, 'in sight, left where it was put')
  await page.waitForTimeout(1500)
  // the clock and the view read in one go: a frame apart, the view's span is a few frames' play
  const [c, at] = await page.evaluate(() => { const [m, s] = document.querySelector('.time').textContent.split(':'), [p, q] = __view.range; return [p, (+m * 60 + +s - p) / (q - p)] })
  assert.ok(c > put[0] && Math.abs(at - .5) < .15, `past the edge, followed: ${at.toFixed(2)} across`)
  // over the scrollbar, at the time row's top, the arrow, as over any scrollbar
  await page.mouse.move(box.x + w / 2, box.y + box.height - 22 + 4)
  assert.equal(await page.locator('.plot').evaluate(e => e.style.cursor), 'default')
  await page.keyboard.press('Space')
})

// A trackpad's pinch (Chrome's: Ctrl and the wheel, no key held, −100·ln s of deltaY for a spread s) zooms twice as far
// as the fingers spread, about the pointer, its events one by one or merged: spread 2×, the span a quarter. With Ctrl
// held, the wheel a fifth as keen, by e^(0.004·deltaY), at most 1.5× a turn of it: a Windows mouse's notch (100 px)
// 1.49×, a Mac's (40) 1.17×, a trackpad's swipe gently
test('editor: a pinch zooms twice as far as the fingers spread, the wheel with Ctrl more gently', async () => {
  await page.route('**/playground/editor.js', async route => { const r = await route.fetch(); route.fulfill({ response: r, body: (await r.text()).replace('v = view(', 'v = globalThis.__view = view(') }) })
  await open()
  await noCues()
  await write(`audio.from(t => Math.sin(2 * Math.PI * 220 * t) * .3, { duration: 20 })`)
  await lengthIs('0:20.000')
  // at a whole pixel: Chrome's pinch lands where its x truncates to, and half a pixel off there is more than the time
  // kept is held to
  const box = await page.locator('.plot').boundingBox(), w = box.width - (await gutter()), y = box.y + box.height / 3, px = Math.round(box.x + w * .3), k = (px - box.x) / w
  const range = () => page.evaluate(() => __view.range), span = async () => { const [a, b] = await range(); return b - a }
  const [a, b] = await range(), at = a + k * (b - a)
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Input.synthesizePinchGesture', { x: px, y, scaleFactor: 2, relativeSpeed: 800, gestureSourceType: 'mouse' })
  // its last events may still be on their way: the view as it settles
  let now = await range(), was
  do { was = now; await page.waitForTimeout(150); now = await range() } while (now[0] !== was[0] || now[1] !== was[1])
  const [p, q] = await range()
  assert.ok(Math.abs((q - p) / (b - a) - .25) < .005, `spread 2×, the span ×${((q - p) / (b - a)).toFixed(3)}`)
  assert.ok(Math.abs(p + k * (q - p) - at) < 1e-3 * (q - p), 'the time under the pointer kept')
  // its events merged into one, as when the page lags behind: as far all the same, here pinched in to half
  await page.evaluate(([x, y]) => document.querySelector('.plot').dispatchEvent(new WheelEvent('wheel', { deltaY: 100 * Math.log(2), ctrlKey: true, clientX: x, clientY: y, bubbles: true, cancelable: true })), [px, y])
  assert.ok(Math.abs(await span() / (q - p) - 4) < 1e-6, `merged, the span ×${(await span() / (q - p)).toFixed(3)}`)
  await page.mouse.move(px, y)
  // in, then out again, within the half again past the whole it zooms out to
  for (const dy of [-100, -40, 100, 40]) {
    const was = await span()
    await page.keyboard.down('Control'); await page.mouse.wheel(0, dy); await page.keyboard.up('Control')
    assert.ok(Math.abs(await span() / was - Math.exp(.004 * dy)) < 1e-6, `a ${dy} px notch: ×${(await span() / was).toFixed(3)}`)
  }
})

// Zoomed while it plays, the view scales about the playhead, wherever the pointer is, and goes on following it: a zoom
// is no hand's scroll taking the view off it. Scrolled away by hand, the view is the hand's, a zoom there the pointer's
test('editor: zoomed while it plays, about the playhead, still followed', async () => {
  await page.route('**/playground/editor.js', async route => { const r = await route.fetch(); route.fulfill({ response: r, body: (await r.text()).replace('v = view(', 'v = globalThis.__view = view(') }) })
  await open()
  await noCues()
  await write(`audio.from(t => Math.sin(2 * Math.PI * 220 * t) * .3, { duration: 20 })`)
  await lengthIs('0:20.000')
  const box = await page.locator('.plot').boundingBox(), w = box.width - (await gutter()), y = box.y + tall(box) / 3
  await page.mouse.move(box.x + 20, y)
  for (let i = 0; i < 10; i++) { await page.keyboard.down('Control'); await page.mouse.wheel(0, -120); await page.keyboard.up('Control') }
  await page.mouse.click(box.x + 20, y)
  await page.keyboard.press('Space')
  await page.waitForFunction(() => document.querySelector('.play')?.getAttribute('aria-label') === 'Pause')
  await page.waitForTimeout(1000)
  const range = () => page.evaluate(() => __view.range)
  const across = () => page.evaluate(() => { const [a, b] = __view.range; return (__view.playhead - a) / (b - a) })
  const was = await across()
  // the pointer at the left edge, far from the playhead in the middle: in, then out past where it was, by the wheel and
  // by the keys
  for (const [dy, key] of [[-120, '='], [-120, null], [120, '-'], [120, null], [120, null]]) {
    await page.keyboard.down('Control'); await page.mouse.wheel(0, dy); await page.keyboard.up('Control')
    if (key) await page.keyboard.press(key)
    assert.ok(Math.abs(await across() - was) < .05, `the playhead where it was: ${was.toFixed(2)} → ${(await across()).toFixed(2)} across`)
  }
  await page.waitForTimeout(1000)
  const at = await across()
  assert.ok(Math.abs(at - .5) < .1, `followed on: ${at.toFixed(2)} across`)
  // scrolled away by hand, the view the hand's: a zoom there keeps the time under the pointer, the playhead not followed
  await page.mouse.move(box.x + w / 2, y)
  await page.mouse.wheel(0, w * 3)
  await page.waitForTimeout(100)
  const pointed = async () => { const [a, b] = await range(); return a + (b - a) / 2 }, t = await pointed()
  await page.keyboard.down('Control'); await page.mouse.wheel(0, -120); await page.keyboard.up('Control')
  const put = await range()
  assert.ok(Math.abs(await pointed() - t) < 1e-3 * (put[1] - put[0]), `the time under the pointer kept: ${t.toFixed(3)} → ${(await pointed()).toFixed(3)}`)
  await page.waitForTimeout(500)
  assert.deepEqual(await range(), put, 'left where it was put')
  await page.keyboard.press('Space')
})

// The caret, the selection or the playhead out of sight, past the lanes' end under the meters too: it stays at the edge
// of the lanes it is past, its line as opaque as in sight, and on the time row under it its tick with a chevron pointing
// out to it, a press there bringing the view to it; a click on the clock's time does the same. Nothing of its line shows
// past the lanes' end, between the meters and the labels. A click on the length shows the selection whole, again all of
// it. Each goes there over 300 ms, not at once
test('editor: out of sight, the caret stays at the lanes\' edge; its chevron at its line\'s foot, or the clock\'s time, brings the view to it; the length frames the selection, then all', async () => {
  await page.route('**/playground/editor.js', async route => { const r = await route.fetch(); route.fulfill({ response: r, body: (await r.text()).replace('v = view(', 'v = globalThis.__view = view(') }) })
  await open()
  await noCues()
  await write(`audio.from(t => Math.sin(2 * Math.PI * 220 * t) * .3, { duration: 20 })`)
  await lengthIs('0:20.000')
  const box = await page.locator('.plot').boundingBox(), w = box.width - (await gutter()), y = box.y + tall(box) / 3
  const range = () => page.evaluate(() => __view.range), seen = async t => { const [a, b] = await range(); return t >= a && t <= a + (b - a) * .9 }
  await page.mouse.move(box.x + w / 2, y)
  for (let i = 0; i < 10; i++) { await page.keyboard.down('Control'); await page.mouse.wheel(0, -120); await page.keyboard.up('Control') }
  await page.mouse.click(box.x + w / 2, y)
  const caret = await page.evaluate(() => __view.cursor)
  // scrolled past it: at the lanes' left edge, its chevron at the foot of its line there
  await page.mouse.wheel(0, w * 3)
  await page.waitForTimeout(100)
  assert.ok(!await seen(caret), 'scrolled out of sight')
  const foot = box.y + tall(box) - 7
  await page.mouse.move(box.x + 6, foot)
  assert.equal(await page.locator('.plot').evaluate(e => e.style.cursor), 'pointer')
  assert.equal(await page.locator('.hint').evaluate(e => e.hidden ? '' : e.textContent), 'To the caret')
  // the view on its way a frame after the press, there by 300 ms
  const was = await range()
  await page.mouse.click(box.x + 6, foot)
  const on = await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => r(__view.range[0])))))
  await page.waitForTimeout(400)
  const [a, b] = await range()
  assert.ok(on < was[0] && on > a, `on its way: ${was[0].toFixed(3)} → ${on.toFixed(3)} → ${a.toFixed(3)}`)
  assert.ok(Math.abs((caret - a) / (b - a) - .45) < .1, `brought to the middle: ${((caret - a) / (b - a)).toFixed(2)} across`)
  // the clock's time does the same, from either side
  await page.mouse.wheel(0, -w * 3)
  await page.waitForTimeout(100)
  assert.ok(!await seen(caret), 'scrolled the other way out of sight')
  await page.locator('.time').click()
  await page.waitForTimeout(400)
  assert.ok(await seen(caret), 'the clock\'s time brings it back')
  // past it the other way, its chevron at the lanes' right end, before the meters, brings it back too
  await page.mouse.wheel(0, -w * 3)
  await page.waitForTimeout(100)
  const end = await page.locator('.plot').evaluate(el => parseFloat(getComputedStyle(el).getPropertyValue('--end')))
  await page.mouse.click(box.x + box.width - end - 6, foot)
  await page.waitForTimeout(400)
  assert.ok(await seen(caret), 'the right edge\'s chevron brings it back')
  // under the meters, out of sight too: none of its line past the lanes' end (e), at it a pixel short, as opaque as its
  // line in sight, its chevron on the time row before its tick; on the lanes' last pixel, in sight, its line. The
  // overlay's columns lit on a row, px from the plot's top, past an opacity: { column: its opacity }
  const BOX = 16, e = Math.floor(box.width - end), h = box.height - 22, timeAt = px => page.evaluate(([px, w]) => { const [a, b] = __view.range; return a + px / w * (b - a) }, [px, w])
  const columns = (py, opaque = 0) => page.evaluate(([py, opaque]) => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(() => {
    const cv = __overlay(), k = cv.width / cv.getBoundingClientRect().width, row = cv.getContext('2d').getImageData(0, Math.round(py * k), cv.width, 1).data, lit = {}
    for (let i = 0; i < cv.width; i++) if (row[i * 4 + 3] > opaque) lit[Math.floor(i / k)] = Math.max(lit[Math.floor(i / k)] ?? 0, row[i * 4 + 3])
    done(lit)
  }))), [py, opaque])
  const cols = async (py, opaque) => Object.keys(await columns(py, opaque)).map(Number)
  await page.mouse.move(box.x + 40, box.y + 30)
  let opacity = null
  for (const px of [e - 1, e, e + 2, w]) {
    await page.evaluate(t => __view.setCursor(t), await timeAt(px))
    const lit = await columns(h * .1)
    assert.deepEqual(Object.keys(lit).map(Number), [e - 1], `a caret at ${px - e} px from the lanes' end`)
    opacity ??= lit[e - 1]
    assert.equal(lit[e - 1], opacity, `a caret at ${px - e} px from the lanes' end: as opaque as in sight`)
    if (px < e) continue
    const chevron = (await cols(tall(box) - 7)).filter(c => c >= e - 9 && c < e - 1)
    assert.ok(chevron.length >= 3, `a caret at ${px - e} px from the lanes' end: its chevron at its line's foot, ${chevron.length} columns`)
  }
  // a range ending there, the pointer in it: the squares of its end, its fade's in its top corner and its grip past it
  // 3/4 down the lane, with its end in sight; with it past the lanes' end, none under the meters
  for (const [px, shown] of [[e - 40, true], [e + 1, false]]) {
    await page.evaluate(([a, b]) => __view.select(a, b), [await timeAt(e - 200), await timeAt(px)])
    await page.mouse.move(box.x + e - 100, box.y + 30)
    for (const [py, from] of [[BOX / 2, px - BOX], [Math.round(tall(box) * 3 / 4) - 4, px]]) {
      const lit = (await cols(py, shown ? 128 : 0)).filter(c => c >= from && c < from + BOX)
      assert.ok(shown ? lit.length >= BOX - 4 : !lit.some(c => c >= e), `a range ending ${px - e} px from the lanes' end, at ${py} px: ${lit.length} lit`)
    }
  }
  // a selection: the length frames it, then shows all of it, then frames it again
  await page.evaluate(() => __view.select(5, 7))
  const framed = async () => { await page.locator('.length').click(); await page.waitForTimeout(400); return range() }
  let [p, q] = await framed()
  assert.ok(p <= 5 && p > 4.5 && (q - p) < 3, `the selection framed: ${p.toFixed(2)}–${q.toFixed(2)}`)
  ;[p, q] = await framed()
  assert.ok(p === 0 && q >= 20, `all of it: ${p}–${q}`)
  ;[p, q] = await framed()
  assert.ok(p <= 5 && (q - p) < 3, 'framed again')
  // playing, scrolled away from the playhead: the clock's time brings the view back to it, following it again
  await page.mouse.click(box.x + w / 2, y)
  await page.keyboard.press('Space')
  await page.waitForFunction(() => document.querySelector('.play')?.getAttribute('aria-label') === 'Pause')
  await page.waitForTimeout(600)
  await page.mouse.wheel(0, w * 3)
  await page.waitForTimeout(300)
  const clock = () => page.evaluate(() => { const [m, s] = document.querySelector('.time').textContent.split(':'), [a, b] = __view.range; return (+m * 60 + +s - a) / (b - a) })
  assert.ok(await clock() < 0, 'scrolled past the playhead')
  await page.mouse.move(box.x + 6, foot)
  await page.waitForFunction(() => !document.querySelector('.hint').hidden && document.querySelector('.hint').textContent === 'To the playhead')
  await page.locator('.time').click()
  await page.waitForTimeout(800)
  const at = await clock()
  assert.ok(Math.abs(at - .45) < .15, `followed again: ${at.toFixed(2)} across`)
  await page.keyboard.press('Space')
})

// The overview, chosen in the settings for the scroll: the whole sound in a strip under the time row, the part in view
// lit; a press beside it takes the view there, a drag moves it. The lanes end above it
test('editor: the overview shows the whole sound under the time row; pressed or dragged, the view goes there', async () => {
  await page.route('**/playground/editor.js', async route => { const r = await route.fetch(); route.fulfill({ response: r, body: (await r.text()).replace('v = view(', 'v = globalThis.__view = view(') }) })
  await open()
  await noCues()
  await write(`audio.from(t => t < 10 ? Math.sin(2 * Math.PI * 220 * t) * .5 : 0, { duration: 20 })`)
  await lengthIs('0:20.000')
  await settings('Scroll', 'Overview')
  const box = await page.locator('.plot').boundingBox(), w = box.width - (await gutter()), foot = box.y + box.height - 12
  const range = () => page.evaluate(() => __view.range)
  // drawn where there is sound, its first half; a line where it is silent
  const ink = f => pixels(`const x = Math.round(arg), xs = []; let n = 0; for (let y = h - 26; y < h - 4; y++) { const i = (y * w + x) * 4; if (d[i] > 60) n++ } return n`, w * f)
  assert.ok(await ink(.25) > 4, 'the sound drawn in the overview')
  assert.ok(await ink(.75) <= 2, 'silence a line')
  // zoomed out past the end, the sound's strip ends where the sound does
  await page.mouse.move(box.x + w / 2, box.y + 40)
  for (let i = 0; i < 2; i++) { await page.keyboard.down('Control'); await page.mouse.wheel(0, 120); await page.keyboard.up('Control') }
  const [, past] = await range()
  assert.ok(past > 25, `zoomed out past the end: ${past}`)
  assert.ok(await ink(.25 * 20 / past) > 4 && await ink(.75 * 20 / past) <= 2, 'the strip narrowed to the sound')
  await page.evaluate(() => __view.fit())
  for (let i = 0; i < 10; i++) { await page.keyboard.down('Control'); await page.mouse.wheel(0, -120); await page.keyboard.up('Control') }
  const [a0, b0] = await range()
  // pressed at 3/4 of the strip: the view centred at 15 s, then dragged left a tenth of it, 2 s earlier
  await page.mouse.move(box.x + w * .75, foot)
  await page.mouse.down()
  let [a, b] = await range()
  assert.ok(Math.abs((a + b) / 2 - 15) < .5 && Math.abs((b - a) - (b0 - a0)) < 1e-6, `centred at 15 s: ${a.toFixed(2)}–${b.toFixed(2)}`)
  await page.mouse.move(box.x + w * .65, foot, { steps: 4 })
  await page.mouse.up()
  const [c] = await range()
  assert.ok(Math.abs(c - a + 2) < .1, `dragged 2 s back: ${a.toFixed(2)} → ${c.toFixed(2)}`)
})

// With tracks, the overview is the edited track's, as the bar's view is of it: another's lane pressed, that one's
test('editor: with tracks, the overview shows the track edited', async () => {
  await open()
  await noCues()
  await write(`let a = audio.from(t => t < 5 ? Math.sin(2 * Math.PI * 220 * t) * .5 : 0, { duration: 10 })\n\nlet b = audio.from(t => t < 5 ? 0 : Math.sin(2 * Math.PI * 220 * t) * .5, { duration: 10 })`)
  await lengthIs('0:10.000')
  await page.locator('.layer').nth(1).waitFor({ state: 'attached' })
  await settings('Scroll', 'Overview')
  const box = await page.locator('.plot').boundingBox(), w = box.width - (await gutter())
  // (lit in any channel: a track's own colour, its waveform's)
  const ink = f => pixels(`const x = Math.round(arg); let n = 0; for (let y = h - 26; y < h - 4; y++) { const i = (y * w + x) * 4; if (Math.max(d[i], d[i + 1], d[i + 2]) > 60) n++ } return n`, w * f)
  const drawn = async (first, second) => { for (let i = 0; i < 20; i++) { if ((await ink(.25) > 4) === first && (await ink(.75) > 4) === second) return true; await page.waitForTimeout(50) } return false }
  const lane = async i => (await tracksAt())[i].y + 20
  await page.mouse.click(box.x + w / 2, await lane(0))
  assert.ok(await drawn(true, false), 'a\'s: its first half')
  await page.mouse.click(box.x + w / 2, await lane(1))
  assert.ok(await drawn(false, true), 'b\'s: its second half')
})

// The overview drawn as a lane draws its waveform: gl-waveform's envelope, its body (Density) brightest at the centre
// line and fading out to the peaks, where it was one shade, edge to edge (its min and max a column, at .55)
test('editor: the overview draws the sound as its lanes do, its body brightest at its centre', async () => {
  await open()
  await noCues()
  await write(`audio.from(t => Math.sin(2 * Math.PI * 220 * t) * .5, { duration: 4 })`)
  await lengthIs('0:04.000')
  await settings('Scroll', 'Overview')
  const box = await page.locator('.plot').boundingBox(), w = box.width - (await gutter())
  // a column at the middle: the brightest of each row of the strip, its lit rows' middle and a fifth of the way in
  const shades = () => pixels(`const x = Math.round(arg), rows = []; for (let y = h - 26; y < h - 4; y++) { const i = (y * w + x) * 4; rows.push(Math.max(d[i], d[i + 1], d[i + 2])) } return rows`, w / 2)
  let rows = []
  for (let i = 0; i < 20 && rows.filter(v => v > 40).length < 6; i++) { rows = await shades(); await page.waitForTimeout(100) }
  const lit = rows.map((v, i) => v > 40 ? i : -1).filter(i => i >= 0), top = lit[0], bottom = lit.at(-1), mid = Math.round((top + bottom) / 2), near = Math.round(top + (mid - top) / 5)
  assert.ok(rows[mid] > rows[near] * 1.3, `the body brighter at its centre than near its peak: ${rows[mid]}, ${rows[near]} (${rows.join(' ')})`)
})

// Followed, the pictures and what is drawn in time over them are on a reel drawn past the view's end: the compositor
// runs it on at the speed it plays at, an animation left to run, the pictures drawn again only as the view nears their end
// (the waveform's canvas wider than the view)
test('editor: followed, the reel runs on by the compositor, its pictures not drawn each frame', async () => {
  await open()
  await noCues()
  await write(`audio.from(t => Math.sin(2 * Math.PI * 220 * t) * .3, { duration: 20 })`)
  await lengthIs('0:20.000')
  const box = await page.locator('.plot').boundingBox(), w = box.width - (await gutter()), y = box.y + box.height / 3
  await page.mouse.move(box.x + w * .1, y)
  for (let i = 0; i < 9; i++) { await page.keyboard.down('Control'); await page.mouse.wheel(0, -120); await page.keyboard.up('Control') }
  await page.mouse.click(box.x + w * .6, y)
  await page.mouse.move(box.x + w * .1, box.y - 20)
  await page.evaluate(() => {
    const reel = document.querySelector('.plot .reel'), animate = reel.animate.bind(reel), gl = document.querySelector('.plot canvas.waveform').getContext('webgl2')
    window.__set = 0; window.__drawn = 0
    reel.animate = (...a) => { window.__set++; return animate(...a) }
    const clear = gl.clear.bind(gl)
    gl.clear = m => { window.__drawn++; clear(m) }
  })
  await page.keyboard.press('Space')
  await page.waitForFunction(() => document.querySelector('.play')?.getAttribute('aria-label') === 'Pause')
  await page.waitForTimeout(1500)
  const [set0, drawn0, frames] = await page.evaluate(() => new Promise(done => { const s = [window.__set, window.__drawn]; let n = 0; const f = () => ++n < 60 ? requestAnimationFrame(f) : done([...s, n]); requestAnimationFrame(f) }))
  const [set1, drawn1, running, wide] = await page.evaluate(() => [window.__set, window.__drawn, document.querySelector('.plot .reel').getAnimations().filter(a => a.playState === 'running').length, document.querySelector('.plot canvas.waveform').clientWidth / document.querySelector('.plot').clientWidth])
  await page.keyboard.press('Space')
  // drawn again only as the view nears the tape's end (here, zoomed in to half a second, a few times a second), the
  // animation set again only then
  assert.equal(running, 1, 'the reel runs on')
  assert.ok(drawn1 - drawn0 <= frames / 6, `the waveform drawn ${drawn1 - drawn0} times over ${frames} frames`)
  assert.ok(set1 - set0 <= drawn1 - drawn0 + 2, `its animation set ${set1 - set0} times, drawn ${drawn1 - drawn0}`)
  assert.ok(wide > 1.3, `the waveform's canvas ${wide.toFixed(2)} views wide`)
  // the reel past the view's end is no overflow of the page's: nothing around the picture has more to scroll to (a focus
  // once scrolled the picture half off its pane)
  const over = await page.evaluate(() => { const out = []; for (let e = document.querySelector('.plot'); e; e = e.parentElement) if (e.scrollWidth > e.clientWidth + 1) out.push(e.className); return out })
  assert.deepEqual(over, [], 'no overflow around the picture')
})

// Followed, the view's start sits on the device's pixels, so the waveform and the marks over it step a whole pixel at a
// time together, and the playhead stays on one pixel column, never a pixel back and forth
test('editor: followed, the view steps by whole device pixels and the playhead holds its column', async () => {
  await page.route('**/playground/editor.js', async route => { const r = await route.fetch(); route.fulfill({ response: r, body: (await r.text()).replace('v = view(', 'v = globalThis.__view = view(') }) })
  await open()
  await noCues()
  await write(`audio.from(t => Math.sin(2 * Math.PI * 220 * t) * .3, { duration: 20 })`)
  await lengthIs('0:20.000')
  const box = await page.locator('.plot').boundingBox(), w = box.width - (await gutter()), y = box.y + box.height / 3
  await page.mouse.move(box.x + w * .1, y)
  for (let i = 0; i < 9; i++) { await page.keyboard.down('Control'); await page.mouse.wheel(0, -120); await page.keyboard.up('Control') }
  await page.mouse.click(box.x + w * .1, y)
  await page.mouse.move(box.x + w * .1, box.y - 20)
  await page.keyboard.press('Space')
  await page.waitForFunction(() => document.querySelector('.play')?.getAttribute('aria-label') === 'Pause')
  await page.waitForTimeout(1500)
  // each frame: the view's start in device pixels, and where the playhead's layer stands, in device pixels
  const frames = await page.evaluate(() => new Promise(done => {
    const out = [], canvas = document.querySelector('.plot canvas.overlay'), head = document.querySelector('.plot .playhead .head')
    const each = () => {
      const [a, b] = __view.range, W = Math.round((canvas.clientWidth - parseFloat(getComputedStyle(document.querySelector('.panes')).getPropertyValue('--axis'))) * devicePixelRatio)
      out.push([a * W / (b - a), new DOMMatrix(getComputedStyle(head).transform).m41 * devicePixelRatio])
      out.length < 60 ? requestAnimationFrame(each) : done(out)
    }
    requestAnimationFrame(each)
  }))
  await page.keyboard.press('Space')
  const moved = frames.filter(([s], i) => i && s !== frames[i - 1][0]), at = frames.map(([, x]) => x)
  assert.ok(moved.length > 30, `${moved.length} frames scrolled`)
  assert.ok(frames.every(([s]) => Math.abs(s - Math.round(s)) < 1e-3), `starts off the pixels: ${frames.map(([s]) => (s % 1).toFixed(3)).join()}`)
  assert.ok(Math.max(...at) - Math.min(...at) < .5, `the playhead at ${at.map(x => x.toFixed(2)).join()}`)
})

// The playhead is a layer of its own, moved by an animation of its transform, which the compositor runs at the speed it
// plays at: it moves on smoothly however busy the page's thread, between device pixels, set again only as the clock's
// trim takes it a quarter of a device pixel off. Zoomed out it moves less than a pixel a frame: drawn on the pixels by
// the page, it stepped one every few frames, now 2 apart, now 3, which the eye takes for a speed that changes
test('editor: the playhead is a layer the compositor moves at the speed it plays at', async () => {
  await page.route('**/playground/editor.js', async route => { const r = await route.fetch(); route.fulfill({ response: r, body: (await r.text()).replace('v = view(', 'v = globalThis.__view = view(') }) })
  await page.addInitScript(() => {
    const animate = Element.prototype.animate
    globalThis.__slid = 0
    Element.prototype.animate = function (...a) { if (this.classList.contains('head')) __slid++; return animate.apply(this, a) }
  })
  await open()
  await noCues()
  await write(`audio.from(t => Math.sin(2 * Math.PI * 220 * t) * .3, { duration: 45 })`)
  await lengthIs('0:45.000')
  const box = await page.locator('.plot').boundingBox()
  await page.mouse.move(box.x + 20, box.y - 20)
  await page.locator('.plot').focus()
  await page.keyboard.press('Space')
  await page.waitForFunction(() => document.querySelector('.play')?.getAttribute('aria-label') === 'Pause')
  await page.waitForTimeout(500)
  // each frame for a second and a half: where the layer is, where the playhead is, the view's width a second
  const { frames, slid, overlay, dpr } = await page.evaluate(() => new Promise(done => {
    const out = [], head = document.querySelector('.plot .playhead .head'), w = document.querySelector('.plot .playhead').clientWidth, n = __slid
    const each = ts => {
      const [a, b] = __view.range
      out.push([ts, new DOMMatrix(getComputedStyle(head).transform).m41, (__view.playhead - a) / (b - a) * w])
      out.length < 90 ? requestAnimationFrame(each) : done({ frames: out, slid: __slid - n, overlay: head.getAnimations().map(a => a.playState), dpr: devicePixelRatio })
    }
    requestAnimationFrame(each)
  }))
  await page.keyboard.press('Space')
  await page.locator('.plot .playhead').waitFor({ state: 'hidden' })
  assert.deepEqual(overlay, ['running'])
  assert.ok(slid <= 3, `set ${slid} times in ${frames.length} frames`)
  const off = frames.map(([, x, p]) => Math.abs(x - p)).sort((p, q) => p - q)
  assert.ok(off[Math.floor(off.length * .9)] < 1, `off the playhead by ${off.map(v => v.toFixed(2)).join()} px`)
  const span = frames.at(-1)[1] - frames[0][1], fractions = new Set(frames.map(([, x]) => Math.round(x * dpr % 1 * 20)))
  assert.ok(span > 0 && span / frames.length < .9, `${span.toFixed(1)} px over ${frames.length} frames`)
  assert.ok(fractions.size >= 8, `on ${fractions.size} places within a pixel`)
})

// The bar's mark, playing, is a loop of the logo's own wave the compositor steps through, the canvas hidden and nothing
// drawn on the page's thread; paused, the canvas again, the loop gone
test('editor: playing, the bar\'s mark is a loop the compositor runs', async () => {
  await open()
  await noCues()
  await write(`audio.from(t => Math.sin(2 * Math.PI * 220 * t) * .3, { duration: 20 })`)
  await lengthIs('0:20.000')
  const mark = () => page.evaluate(() => {
    const logo = document.querySelector('.bar .wordmark .logo'), canvas = logo.querySelector(':scope > canvas'), loop = logo.querySelector(':scope > div canvas')
    return { canvas: getComputedStyle(canvas).visibility, loop: loop?.getAnimations().map(a => [a.playState, a.effect.getTiming().easing]) ?? null }
  })
  await page.locator('.plot').focus()
  await page.keyboard.press('Space')
  // the loop once the device sounds (Pause shows from the press)
  const shown = v => page.waitForFunction(v => getComputedStyle(document.querySelector('.bar .wordmark .logo > canvas')).visibility === v, v)
  await shown('hidden')
  assert.deepEqual(await mark(), { canvas: 'hidden', loop: [['running', 'steps(40)']] })
  await page.keyboard.press('Space')
  await shown('visible')
  assert.deepEqual(await mark(), { canvas: 'visible', loop: null })
})

// The device's clock comes in steps, each a fraction of a ms off where the last ran on to; zoomed in, that is pixels, back
// and forth. The playhead runs on by the frames' own time instead, its speed trimmed toward the clock: frame to frame it
// moves as far as the frame's time at the speed, within 50 µs, and stays within a few ms of the clock
test('editor: the playhead runs on by the frames\' own time, not by the device clock\'s steps', async () => {
  await page.route('**/playground/editor.js', async route => { const r = await route.fetch(); route.fulfill({ response: r, body: (await r.text()).replace('v = view(', 'v = globalThis.__view = view(').replace('let pl = null', 'let pl = null; Object.defineProperty(globalThis, "__pl", { get: () => pl })') }) })
  await open()
  await noCues()
  await write(`audio.from(t => Math.sin(2 * Math.PI * 220 * t) * .3, { duration: 20 })`)
  await lengthIs('0:20.000')
  await page.locator('.plot').focus()
  await page.keyboard.press('Space')
  await page.waitForFunction(() => document.querySelector('.play')?.getAttribute('aria-label') === 'Pause')
  await page.waitForTimeout(500)
  const frames = await page.evaluate(() => new Promise(done => {
    const out = []
    const each = ts => { out.push([ts, __view.playhead, __pl.time]); out.length < 120 ? requestAnimationFrame(each) : done(out) }
    requestAnimationFrame(each)
  }))
  await page.keyboard.press('Space')
  const off = frames.slice(1).map(([ts, t], i) => Math.abs((t - frames[i][1]) * 1000 - (ts - frames[i][0]))).sort((p, q) => p - q)
  assert.ok(off[Math.floor(off.length * .9)] < .05, `steps off the frames' by ${off.map(v => v.toFixed(3)).join()} ms`)
  const lag = frames.map(([, t, c]) => Math.abs(c - t) * 1000).sort((p, q) => p - q)
  assert.ok(lag[Math.floor(lag.length * .9)] < 25, `off the clock by ${lag.map(v => v.toFixed(1)).join()} ms`)
})

// Firefox's clock and Safari's move by the audio callbacks, standing between them: here by 512 frames (10.7 ms at 48 kHz).
// The playhead takes no step for a change of speed: frame to frame it moves as far as the frame's time, within 3% (it
// was a tenth and more), and stays within a few ms of the clock
test('editor: the playhead keeps its speed on a clock that moves by the audio callbacks', async () => {
  await page.route('**/playground/editor.js', async route => { const r = await route.fetch(); route.fulfill({ response: r, body: (await r.text()).replace('v = view(', 'v = globalThis.__view = view(').replace('let pl = null', 'let pl = null; Object.defineProperty(globalThis, "__pl", { get: () => pl })') }) })
  await open()
  await noCues()
  await write(`audio.from(t => Math.sin(2 * Math.PI * 220 * t) * .3, { duration: 20 })`)
  await lengthIs('0:20.000')
  await page.evaluate(() => { const { get } = Object.getOwnPropertyDescriptor(__pl, 'time'), q = 512 / 48000; Object.defineProperty(__pl, 'time', { get: () => Math.floor(get.call(__pl) / q) * q }) })
  await page.locator('.plot').focus()
  await page.keyboard.press('Space')
  await page.waitForFunction(() => document.querySelector('.play')?.getAttribute('aria-label') === 'Pause')
  await page.waitForTimeout(500)
  const frames = await page.evaluate(() => new Promise(done => {
    const out = []
    const each = ts => { out.push([ts, __view.playhead, __pl.time]); out.length < 120 ? requestAnimationFrame(each) : done(out) }
    requestAnimationFrame(each)
  }))
  await page.keyboard.press('Space')
  const off = frames.slice(1).map(([ts, t], i) => Math.abs((t - frames[i][1]) * 1000 / (ts - frames[i][0]) - 1)).sort((p, q) => p - q)
  assert.ok(off[Math.floor(off.length * .9)] < .05, `speeds off 1× by ${off.map(v => v.toFixed(3)).join()}`)
  const lag = frames.map(([, t, c]) => Math.abs(c - t) * 1000).sort((p, q) => p - q)
  assert.ok(lag[Math.floor(lag.length * .9)] < 25, `off the clock by ${lag.map(v => v.toFixed(1)).join()} ms`)
})

// Recording, the playhead is where the take has got to, and the microphone's blocks come in bursts, those of an audio
// callback at once, none between: it runs on by the frames' own time, frame to frame as far as the frame's time, within
// 5% (it was as many blocks as came, a frame half as far as the next)
test('editor: recording, the playhead keeps its speed as the blocks come in bursts', async () => {
  await page.route('**/playground/editor.js', async route => { const r = await route.fetch(); route.fulfill({ response: r, body: (await r.text()).replace('v = view(', 'v = globalThis.__view = view(') }) })
  await open()
  await write('')
  await page.locator('.empty').waitFor()
  await page.getByRole('button', { name: 'Record', exact: true }).first().click()
  await page.waitForFunction(() => __view.playhead > .3)
  const frames = await page.evaluate(() => new Promise(done => {
    const out = []
    const each = ts => { out.push([ts, __view.playhead]); out.length < 90 ? requestAnimationFrame(each) : done(out) }
    requestAnimationFrame(each)
  }))
  await page.locator('.plot').focus()
  await page.keyboard.press('Space')
  await page.waitForFunction(() => scriptText().startsWith("audio('recording.wav')"))
  const off = frames.slice(1).map(([ts, t], i) => Math.abs((t - frames[i][1]) * 1000 / (ts - frames[i][0]) - 1)).sort((p, q) => p - q)
  assert.ok(off[Math.floor(off.length * .9)] < .05, `speeds off 1× by ${off.map(v => v.toFixed(3)).join()}`)
})

// Zoomed in, a ms is many pixels: the playhead goes on by each frame's own time, however late a busy page runs the
// frame's work (here 0 to 10 ms, at random, before it), so the view never jolts back and forth. And the pictures'
// window-wide layers are clipped, not masked: a mask is a pass of its own over each, every frame the view scrolls
test('editor: zoomed in, the playhead goes on by the frames\' own time, however late the page gets to them', async () => {
  await open()
  await noCues()
  await write(`audio.from(t => Math.sin(2 * Math.PI * 220 * t) * .3, { duration: 20 })`)
  await lengthIs('0:20.000')
  for (const layer of ['waveform', 'spectrum']) assert.equal(await page.locator(`.plot canvas.${layer}`).evaluate(e => getComputedStyle(e).maskImage), 'none', layer)
  const box = await page.locator('.plot').boundingBox(), y = box.y + box.height / 2
  await page.mouse.move(box.x + 20, y)
  for (let i = 0; i < 10; i++) { await page.keyboard.down('Control'); await page.mouse.wheel(0, -120); await page.keyboard.up('Control') }
  await page.mouse.click(box.x + 20, y)
  // each frame: its time, and the clock as the frame before left it, read first, then the frame held up
  await page.evaluate(() => {
    window.__frames = []
    const each = ts => {
      const [m, s] = document.querySelector('.time').textContent.split(':')
      window.__frames.push([ts, +m * 60 + +s])
      const until = performance.now() + Math.random() * 10
      while (performance.now() < until);
      if (window.__frames.length < 120) requestAnimationFrame(each)
    }
    requestAnimationFrame(each)
  })
  await page.keyboard.press('Space')
  await page.waitForFunction(() => window.__frames.length >= 120, null, { timeout: 10000 })
  await page.keyboard.press('Space')
  const frames = await page.evaluate(() => window.__frames)
  // while it runs, the clock's step each frame is the frame's step, to the ms the clock shows; the readout, redrawn by the
  // page's own schedule, may show a frame or two late, and a frame held up may take two, so a step is off by what is
  // left over whole frames (the display's, the shortest steps)
  const steps = frames.slice(1).map(([t], i) => t - frames[i][0]).sort((p, q) => p - q), frame = steps[Math.floor(steps.length / 10)], off = []
  for (let i = 2; i < frames.length; i++) {
    const [t0, a] = frames[i - 1], [t1, b] = frames[i], d = (b - a) * 1000 - (t1 - t0)
    if (a > frames[0][1] && b > a) off.push(Math.abs(d - Math.round(d / frame) * frame))
  }
  off.sort((p, q) => p - q)
  assert.ok(off.length > 30, `${off.length} frames running`)
  assert.ok(off[Math.floor(off.length * .9)] < 2.5, `steps off the frames' by ${off.map(v => v.toFixed(1)).join()} ms`)
})

// What the sound holds, in the status bar: the note at the caret (440 Hz is A4, ISO 16), a melody's compass over a
// selection (A4 then E5, 659.26 Hz, 2^(7/12) × 440), and, over 6 s at least, the tempo and the key of all of it: clicks
// every 0.5 s are 120 BPM, a C major triad (C4 E4 G4, 261.63, 329.63, 392 Hz) over them is in C major (Krumhansl-Kessler)
test('editor: the status bar says the note at the caret, a selection\'s compass, or the tempo or the key, as chosen', async () => {
  await open()
  await noCues()
  const heard = text => page.waitForFunction(text => document.querySelector('.heard')?.textContent === text, text)
  await write(`audio.from(t => (t < 1 ? Math.sin(2 * Math.PI * 440 * t) : Math.sin(2 * Math.PI * 659.26 * t)) * .5, { duration: 2 })`)
  await lengthIs('0:02.000')
  const { box, x } = await axis(2), y = box.y + tall(box) / 2
  await page.mouse.click(x(.5), y)
  await heard('A4')
  await page.mouse.click(x(1.5), y)
  await heard('E5')
  assert.equal(await page.locator('.heard').evaluate(tipOf), 'Note at the caret')
  await drag([x(.2), y], [x(1.8) - x(.2), 0])
  await heard('A4–E5')
  // no pitch, no note; too short for a tempo or a key
  await write(`audio.from(t => 0, { duration: 2 })`)
  await page.mouse.click(x(.5), y)
  await page.waitForTimeout(600)
  assert.equal(await page.locator('.heard').count(), 0)
  await write(`audio.from(t => { const b = t % 0.5; return (b < 0.03 ? Math.sin(2 * Math.PI * 1000 * t) * Math.exp(-b * 150) : 0) * .6 + [261.63, 329.63, 392].reduce((s, f) => s + Math.sin(2 * Math.PI * f * t), 0) / 15 }, { duration: 8 })`)
  await lengthIs('0:08.000')
  // one thing said, chosen from its menu, pressed: the tempo, the key, each of all of it
  const choose = async label => { await page.locator('.heard').click(); await menuRow(label).click() }
  await page.locator('.heard').waitFor()
  await choose('Tempo')
  await heard('120 BPM')
  assert.equal(await page.locator('.heard').evaluate(tipOf), 'Tempo of all of it')
  await choose('Key')
  await heard('C major')
  assert.equal(await page.locator('.heard').evaluate(tipOf), 'Key of all of it')
  // none clear (2 s, short of the 6 a key is read over): said so, its menu still there to choose another
  await write(`audio.from(t => Math.sin(2 * Math.PI * 440 * t) * .5, { duration: 2 })`)
  await lengthIs('0:02.000')
  await heard('no key')
  assert.match(await page.locator('.heard').evaluate(tipOf), /^No key clear in all of it: 6 s at least/)
  await choose('Note or chord')
  await page.mouse.click(x(1), y)
  await heard('A4')
})

// Where chords sound, the status bar names the chord at the caret, a selection's chords in order, and, as it plays, the
// chord at the playhead (Chordino on NNLS chroma, stat('chords')), not the pitch a triad's tones share (C4 E4 G4, 4:5:6,
// a period of C2): C major, A minor, F major triads, 2 s each, in equal temperament from A4 = 440 Hz (C4 261.63, E4
// 329.63, G4 392, A3 220, F3 174.61 Hz)
test('editor: the status bar names the chord at the caret, a selection\'s chords, and the chord playing', async () => {
  await open()
  await noCues()
  const heard = re => page.waitForFunction(re => new RegExp(re).test(document.querySelector('.heard')?.textContent), re.source)
  await write(`audio.from(t => [[261.63, 329.63, 392], [220, 261.63, 329.63], [174.61, 220, 261.63]][Math.min(2, Math.floor(t / 2))].reduce((s, f) => s + Math.sin(2 * Math.PI * f * t), 0) * .2, { duration: 6 })`)
  await lengthIs('0:06.000')
  const { box, x } = await axis(6), y = box.y + tall(box) / 2
  await page.mouse.click(x(1), y)
  await heard(/^C$/)
  assert.equal(await page.locator('.heard').evaluate(tipOf), 'Chord at the caret')
  await page.mouse.click(x(3), y)
  await heard(/^Am$/)
  await page.mouse.click(x(5), y)
  await heard(/^F$/)
  // a selection just past a change: the chord it only touches is not counted
  await drag([x(.5), y], [x(4.1) - x(.5), 0])
  await heard(/^C – Am$/)
  // as it plays, the chord at the playhead, said as it changes
  await page.mouse.click(x(.1), y)
  await page.locator('button.play').click()
  const said = await page.evaluate(() => new Promise(done => {
    const out = []
    const look = () => {
      const t = document.querySelector('.heard')?.textContent
      if (t && t !== out.at(-1)) out.push(t)
      if (+document.querySelector('.time').textContent.split(':')[1] > 5.8) return done(out)
      requestAnimationFrame(look)
    }
    look()
  }))
  assert.deepEqual(said, ['C', 'Am', 'F'])
})

// With tracks, what is heard is the edited track's, not their mix's: a C major triad over a louder C2 bass (65.41 Hz)
// is the chord in its own track, the note in the bass's
test('editor: with tracks, the status bar names what the edited track holds', async () => {
  await open()
  await noCues()
  const heard = re => page.waitForFunction(re => new RegExp(re).test(document.querySelector('.heard')?.textContent), re.source)
  await write(`let keys = audio.from(t => [261.63, 329.63, 392].reduce((s, f) => s + Math.sin(2 * Math.PI * f * t), 0) * .15, { duration: 8 })\nlet bass = audio.from(t => Math.sin(2 * Math.PI * 65.41 * t) * .8, { duration: 8 })`)
  await lengthIs('0:08.000')
  await page.locator('.layer').nth(1).waitFor({ state: 'attached' })
  const { x } = await axis(8), lane = async i => (await tracksAt())[i].y + 20
  await page.mouse.click(x(3), await lane(0))
  await heard(/^C$/)
  await page.mouse.click(x(3), await lane(1))
  await heard(/^C2/)
})

// A search held at 0 a while, then let go: it stops there, the playhead gone with it (its layer hidden), the caret where
// it stood and drawn, not the playhead's line left standing in its place
test('editor: Play held at 0, let go, stops there, the caret drawn where the playhead stood', async () => {
  await open()
  const play = await page.locator('button.play').boundingBox(), cx = play.x + play.width / 2, cy = play.y + play.height / 2
  await page.mouse.move(cx, cy)
  await page.mouse.down()
  await page.getByRole('button', { name: 'Pause' }).waitFor()
  await page.waitForTimeout(400)
  await page.mouse.move(cx - 40, cy, { steps: 4 })
  assert.equal(await page.locator('.speed-mark').innerText(), '0.0×')
  await page.waitForTimeout(600)
  await page.mouse.up()
  await page.getByRole('button', { name: 'Play', exact: true }).waitFor()
  await page.waitForTimeout(200)
  assert.equal(await page.locator('.plot .playhead').evaluate(e => e.hidden), true, 'no playhead left')
  const t = await page.locator('.time').innerText().then(s => { const [m, x] = s.split(':'); return +m * 60 + +x })
  assert.ok(t > .05, `the caret where it stood, past the start: ${t}`)
})

// Play held and dragged across searches, as a shuttle ring: from the speed it plays at, a tenth of 1× each 4 px, −2× to
// 4×, on a line over it, its mark a tenth always, the pointer hidden; forward the deck plays at it, at 0 the moment
// holds, back the scrub voice hears the moments it passes; a step taken only three quarters of the way to the next, so a
// hand resting between two holds one; held still, the line shows. Let go forward, it plays on at that speed until it
// stops; at 0 or back, it stops there. Stopped, 1× again; the Play menu sets the next playback's. Record is off while it plays, in its place. Round
// Play a ring, how far through the sound it plays, there while it plays
test('editor: Play held and dragged searches, let go it plays on at that speed till stopped; record off while it plays; a ring how far it has played', async () => {
  await page.addInitScript(tap)
  await open()
  const play = await page.locator('button.play').boundingBox(), cx = play.x + play.width / 2, cy = play.y + play.height / 2
  const clock = () => page.locator('.time').innerText().then(t => { const [m, s] = t.split(':'); return +m * 60 + +s })
  const record = () => page.locator('button.record').evaluate(el => [el.disabled, el.inert, getComputedStyle(el).visibility])
  const ring = () => page.locator('button.play').evaluate(el => [el.classList.contains('rolling'), +el.style.getPropertyValue('--played')])
  const mark = () => page.locator('.speed-mark').innerText()
  // how far the clock runs over 400 ms
  const runs = async () => { const t0 = await clock(); await page.waitForTimeout(400); return await clock() - t0 }
  assert.deepEqual(await record(), [false, false, 'visible'], 'at rest, record')
  assert.equal(await page.locator('.speed-pill').count(), 0, 'no pill: the speed is the playback\'s')
  await page.mouse.move(cx, cy)
  await page.mouse.down()
  await page.getByRole('button', { name: 'Pause' }).waitFor()
  // 80 px right of 1×: 3×, the line over Play, the pointer hidden; record off, where it is
  await page.mouse.move(cx + 80, cy, { steps: 8 })
  await page.locator('.speed-axis').waitFor()
  assert.equal(await mark(), '3.0×')
  assert.deepEqual(await page.locator('.speed-tick').allInnerTexts(), ['−2×', '−1×', '0', '1×', '2×', '3×', '4×'])
  assert.equal(await page.locator('#app').evaluate(el => getComputedStyle(el).cursor), 'none')
  assert.deepEqual(await record(), [true, false, 'visible'], 'record off while it plays')
  await page.waitForTimeout(300)
  const [rolling, p0] = await ring(), fast = await runs(), [, p1] = await ring()
  assert.ok(fast > .8 && fast < 1.7, `at 3× 400 ms ran ${fast} s`)
  // the ring: how far through the whole sound, 6.525 s, it has played
  assert.ok(rolling && p1 > p0 && Math.abs(p1 - await clock() / 6.525) < .1, `the ring round Play: ${p0} then ${p1}`)
  // at 0 the moment holds; back, at −2×, the clock runs back and the moments it passes sound
  await page.mouse.move(cx - 40, cy, { steps: 4 })
  assert.equal(await mark(), '0.0×')
  await page.waitForTimeout(100)
  assert.equal(await runs(), 0, 'held at 0')
  assert.ok(await page.getByRole('button', { name: 'Pause' }).isVisible(), 'a search, Play its pause')
  await page.mouse.move(cx - 120, cy, { steps: 4 })
  assert.equal(await mark(), '−2.0×')
  await page.waitForTimeout(100)
  await heard()
  const back = await runs(), sounded = await heard()
  assert.ok(back < -.5 && back > -1.1, `at −2× 400 ms ran ${back} s`)
  assert.ok(sounded.finite && sounded.peak > .01, `heard backwards: ${sounded.peak}`)
  // past the ends it stops at them
  await page.mouse.move(cx - 600, cy, { steps: 4 })
  assert.equal(await mark(), '−2.0×')
  await page.mouse.move(cx + 600, cy, { steps: 4 })
  assert.equal(await mark(), '4.0×')
  // about 1×: a pixel or two either way holds the step it has, the next taken at three quarters of the way to it (3 px),
  // and left again only at three quarters of the way back
  for (const [dx, at] of [[0, '1.0×'], [2, '1.0×'], [3, '1.1×'], [1.5, '1.1×'], [1, '1.0×']]) {
    await page.mouse.move(cx + dx, cy)
    assert.equal(await mark(), at, `at ${dx} px`)
  }
  // let go at 2×, it plays on at 2×
  await page.mouse.move(cx + 40, cy)
  assert.equal(await mark(), '2.0×')
  await page.mouse.up()
  assert.equal(await page.locator('.speed-axis').count(), 0)
  assert.ok(await page.getByRole('button', { name: 'Pause' }).isVisible(), 'plays on')
  const kept = await runs()
  assert.ok(kept > .55 && kept < 1.1, `at 2× kept 400 ms ran ${kept} s`)
  // a press while it plays, let go at once, pauses, the caret where the playhead got to, as a key's pause leaves it (at
  // 2× held 150 ms, 0.3 s on from the press); record on again, no ring; played again, 1×
  await page.mouse.move(cx, cy)
  await page.mouse.down()
  const pressed = await clock()
  await page.waitForTimeout(150)
  await page.mouse.up()
  await page.getByRole('button', { name: 'Play', exact: true }).waitFor()
  const paused = await clock()
  assert.ok(paused - pressed > .15 && paused - pressed < .8, `paused at ${paused}, pressed at ${pressed}`)
  assert.deepEqual(await record(), [false, false, 'visible'], 'record again')
  assert.equal((await ring())[0], false, 'no ring at rest')
  await page.locator('button.play').click()
  await page.getByRole('button', { name: 'Pause' }).waitFor()
  await page.waitForTimeout(200)
  const again = await runs()
  assert.ok(again > .25 && again < .6, `played again, 1×: 400 ms ran ${again} s`)
  // held still past HOLD (400 ms, view.js), the line shows, the speed marked; let go, it plays on as it was
  await page.mouse.move(cx, cy)
  await page.mouse.down()
  await page.waitForTimeout(200)
  assert.equal(await page.locator('.speed-axis').count(), 0, 'not yet')
  await page.locator('.speed-axis').waitFor({ timeout: 600 })
  assert.equal(await mark(), '1.0×')
  await page.mouse.up()
  assert.equal(await page.locator('.speed-axis').count(), 0)
  assert.ok(await page.getByRole('button', { name: 'Pause' }).isVisible(), 'held, it plays on')
  // let go backwards, it stops where the search got to
  await page.mouse.move(cx, cy)
  await page.mouse.down()
  await page.mouse.move(cx - 80, cy, { steps: 4 })
  assert.equal(await mark(), '−1.0×')
  await page.waitForTimeout(200)
  await page.mouse.up()
  await page.getByRole('button', { name: 'Play', exact: true }).waitFor()
  assert.equal(await runs(), 0, 'stopped there')
  // the Play menu, fastest at the top, sets the next playback's speed
  await menu('Transport', 'Speed')
  assert.deepEqual((await page.locator('.menubar-list .menu-row:visible .menu-label').allInnerTexts()).filter(t => /×$/.test(t)), ['3×', '2×', '1.5×', '1.25×', '1×', '0.75×', '0.5×'], 'the fastest at the top')
  await page.keyboard.press('Escape')
  await page.keyboard.press('Escape')
  await menu('Transport', 'Speed', '1.5×')
  await page.locator('button.play').click()
  await page.getByRole('button', { name: 'Pause' }).waitFor()
  await page.waitForTimeout(200)
  const chosen = await runs()
  assert.ok(chosen > .4 && chosen < .85, `at 1.5× 400 ms ran ${chosen} s`)
  await page.locator('button.play').click()
})

// On the log axis, 20 Hz to 24 kHz, a box a fifth of the lane tall spans a fifth of log2(1200) ≈ 2 octaves (×4.1).
// The wheel zooms along the axis it is on: on the frequencies (at the right of the picture) only them, on the times
// (the row below) only time; Ctrl and the wheel over the picture, a trackpad's pinch, only time. 0 shows all again.
test('editor: a pinch zooms the axis under the pointer, the frequencies or the times; the wheel scrolls; 0 shows all again', async () => {
  await open()
  await noCues()
  await write(hits)
  await lengthIs('0:02.000')
  await show('spec')
  const { box, x } = await axis(2)
  // a box, as a ratio of its top frequency to its bottom, and its times
  const band = async () => {
    await boxDrag([x(.5), box.y + tall(box) * .4], [x(1) - x(.5), tall(box) * .2])
    const [lo, hi] = (await readout()).match(/[\d.]+k?Hz/g).map(v => parseFloat(v) * (v.includes('k') ? 1000 : 1))
    const times = await selected()
    // the caret away from where the next box starts, which would drag it instead
    await page.keyboard.press('Escape')
    await page.mouse.click(x(1.9), box.y + box.height * .2)
    return [hi / lo, times]
  }
  const [whole, span] = await band()
  assert.ok(whole > 3 && whole < 4.6, `whole axis: ×${whole}`)
  assert.match(span, /^0:00\.50\d–0:01\.00\d$/)
  // Ctrl and the wheel (a trackpad's pinch) on the frequencies: they zoom, time stays
  const pinch = async (px, py) => { await page.mouse.move(px, py); for (let i = 0; i < 12; i++) { await page.keyboard.down('Control'); await page.mouse.wheel(0, -60); await page.keyboard.up('Control') } }
  await pinch(box.x + box.width - 20, box.y + box.height * .5)
  const [zoomed, same] = await band()
  assert.ok(zoomed < 1.5, `zoomed in: ×${zoomed}`)
  assert.equal(same, span)
  // the wheel alone there scrolls through them, as it scrolls a page: a box the same height spans the same ratio
  await page.mouse.move(box.x + box.width - 20, box.y + box.height * .5)
  for (let i = 0; i < 3; i++) await page.mouse.wheel(0, 60)
  const [scrolled] = await band()
  assert.ok(Math.abs(scrolled - zoomed) < .05, `the same span: ×${scrolled}`)
  await page.mouse.move(box.x + box.width - 20, box.y + box.height * .5)
  for (let i = 0; i < 3; i++) await page.mouse.wheel(0, -60)
  // Ctrl and the wheel over the picture: time zooms, the frequencies stay
  await page.mouse.move(x(1), box.y + box.height * .5)
  for (let i = 0; i < 12; i++) { await page.keyboard.down('Control'); await page.mouse.wheel(0, -60); await page.keyboard.up('Control') }
  const [kept, closer] = await band()
  assert.ok(Math.abs(kept - zoomed) < .05, `frequencies kept: ×${kept}`)
  assert.notEqual(closer, span)
  // on the times, Ctrl and the wheel zoom time
  await page.locator('.plot').focus()
  await page.keyboard.press('0')
  await pinch(x(1), box.y + box.height - 8)
  const [, ruler] = await band()
  assert.notEqual(ruler, span)
  await page.locator('.plot').focus()
  await page.keyboard.press('0')
  const [again, all] = await band()
  assert.ok(Math.abs(again - whole) < .3 && all === span, 'all of both again')
  // on the spectrum just before the frequencies, a pinch zooms them as there
  await pinch(box.x + box.width - (await gutter()) - 20, box.y + box.height * .5)
  const [strip, still] = await band()
  assert.ok(strip < 1.5 && still === span, `zoomed in from the spectrum: ×${strip}`)
})

// A resized canvas is blank until drawn; drawn a frame later, every step of a resize flashes empty (20 of these 40
// frames were, before the view drew in its resize callback). The panel's width is the view's to give up.
test('editor: resizing the panes never shows a blank frame', async () => {
  await open()
  const blank = await page.evaluate(async () => {
    const panes = document.querySelector('.panes'), overlay = document.querySelector('.plot canvas.overlay'), g = overlay.getContext('2d')
    let empty = 0
    for (let i = 0; i < 20; i++) {
      panes.style.setProperty('--panel', `${300 + i * 7}px`)
      for (let f = 0; f < 2; f++) {
        await new Promise(r => requestAnimationFrame(r))
        const d = g.getImageData(0, 0, overlay.width, overlay.height).data
        let lit = 0
        for (let k = 3; k < d.length; k += 4 * 97) if (d[k]) lit++
        if (!lit) empty++
      }
    }
    return empty
  })
  assert.equal(blank, 0)
})

// The frequency scale is the spectrogram's own, in the dropdown its tab opens, pressed again; snapping is a setting, the
// panel's last tab; both kept
test('editor: the spectrogram\'s frequency scale from its dropdown, snapping from the settings, both remembered', async () => {
  await open()
  await show('spec')
  const plot = page.locator('.plot'), now = () => plot.getAttribute('data-scale')
  assert.equal(await now(), 'log')
  await show('spec')
  assert.equal(await now(), 'log', 'shown again, the same')
  // its look, its dropdown, the spectrogram's groups in it; Esc closes it, a choice pressed or not
  await page.locator(':is(.lane-look, .layer-look):visible').click()
  await choice('Frequency scale', 'Hertz').click()
  assert.equal(await now(), 'lin')
  await page.keyboard.press('Escape')
  assert.equal(await page.locator('.dropdown:popover-open').count(), 0, 'Esc closes it')
  // the window left (another app; embedded, a press on the page around it): it closes, as the menus do, its look let go
  await page.locator(':is(.lane-look, .layer-look):visible').click()
  await page.locator('.dropdown:popover-open').waitFor()
  await page.evaluate(() => dispatchEvent(new Event('blur')))
  assert.equal(await page.locator('.dropdown:popover-open').count(), 0, 'it closes as the window leaves')
  assert.equal(await page.locator(':is(.lane-look, .layer-look):visible').getAttribute('aria-expanded'), 'false')
  // a click on the frequencies switches nothing
  const box = await plot.boundingBox()
  await page.mouse.click(box.x + box.width - 20, box.y + box.height * .1)
  assert.equal(await now(), 'lin')
  await tab('Settings')
  assert.equal(await choice('Show over the sound', 'Snap').getAttribute('aria-pressed'), 'true')
  await choice('Show over the sound', 'Snap').click()
  assert.equal(await choice('Show over the sound', 'Snap').getAttribute('aria-pressed'), 'false')
  await page.waitForTimeout(600)
  await page.reload()
  await wholeLevels().waitFor()
  assert.equal(await now(), 'lin')
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('audio-repl')).snap), false)
})

// Colour in a screenshot of the plot: the largest spread between a pixel's channels, and brightness along a column.
// The grid as it shows (window.__shown): the plot's screenshot with it less one with Grid: None, the grid being drawn in
// the waveform's canvas, under the waveform (view.js paintGrid); { k (device px a CSS px), w, h, d (each pixel's largest
// difference over its channels) }. `name`, the grid set now, set again after
async function gridShown(name) {
  // each shot of the page at rest: the settings' panel closed and gone, the plot its width again, nothing fading still
  // (a hint going, a panel closing, faint over the picture)
  const width = await page.locator('.plot').evaluate(el => el.clientWidth)
  const rest = async () => {
    await page.mouse.move(2, 2)
    await page.waitForFunction(w => document.querySelector('.plot').clientWidth === w && !document.getAnimations().some(a => a instanceof CSSTransition && a.playState === 'running'), width)
    await page.waitForTimeout(200)
  }
  const shot = async () => { await rest(); return (await page.locator('.plot').screenshot()).toString('base64') }
  const on = await shot()
  await settings('Grid', 'None')
  const off = await shot()
  await settings('Grid', name)
  await rest()
  await page.evaluate(async ([a, b, width]) => {
    const read = async src => {
      const img = new Image()
      img.src = 'data:image/png;base64,' + src
      await img.decode()
      const c = Object.assign(document.createElement('canvas'), { width: img.width, height: img.height }), g = c.getContext('2d')
      g.drawImage(img, 0, 0)
      return g.getImageData(0, 0, c.width, c.height)
    }
    const [p, q] = [await read(a), await read(b)], d = new Uint8Array(p.width * p.height)
    for (let i = 0; i < d.length; i++) d[i] = Math.max(Math.abs(p.data[i * 4] - q.data[i * 4]), Math.abs(p.data[i * 4 + 1] - q.data[i * 4 + 1]), Math.abs(p.data[i * 4 + 2] - q.data[i * 4 + 2]))
    window.__shown = { k: p.width / width, w: p.width, h: p.height, d }
  }, [on, off, (await page.locator('.plot').boundingBox()).width])
}
async function pixels(fn, arg) {
  const png = await page.locator('.plot').screenshot()
  return page.evaluate(async ([b64, src, arg]) => {
    const img = new Image()
    img.src = 'data:image/png;base64,' + b64
    await img.decode()
    const c = Object.assign(document.createElement('canvas'), { width: img.width, height: img.height }), g = c.getContext('2d')
    g.drawImage(img, 0, 0)
    return new Function('d', 'w', 'h', 'arg', src)(g.getImageData(0, 0, c.width, c.height).data, c.width, c.height, arg)
  }, [png.toString('base64'), fn, arg])
}

test('editor: each channel has its own lane: a sound in the left lights only the left', async () => {
  await open()
  await write(`audio.from(t => 0.8 * Math.sin(2 * Math.PI * 220 * t), { duration: 1, channels: 2 }).pan(-1)`)
  await lengthIs('0:01.000')
  await page.waitForTimeout(800)
  // lit pixels in the upper lane (left) and the lower (right), the ruler below excluded
  const [upper, lower] = await pixels(`const lanes = [0, 0]; for (let y = 0; y < h - 44; y++) for (let x = 0; x < w; x++) { const i = (y * w + x) * 4; if (d[i] + d[i + 1] + d[i + 2] > 300) lanes[y < (h - 44) / 2 ? 0 : 1]++ } return lanes`)
  assert.ok(upper > 1000 && lower < upper / 50, `left lane ${upper} lit, right lane ${lower}`)
})

// The spectrogram (gl-spectrogram) draws each channel's tone on the row its scale's formula gives: log2 from 20 Hz, or
// mel, 2595 · log10(1 + f / 700) (O'Shaughnessy 1987, as in HTK), to Nyquist. The lanes share one scale of levels, the
// loudest channel's, so a tone 20 dB under the other draws dimmer, where a scale per lane would draw both white.
test('editor: the spectrogram draws each channel\'s tone on its row, every lane at one scale of levels', async () => {
  await open()
  await write(`const tone = (f, a) => Float32Array.from({ length: 48000 }, (_, i) => a * Math.sin(2 * Math.PI * f * i / 48000))
audio.from([tone(1000, .5), tone(4000, .05)], { sampleRate: 48000 })`)
  await lengthIs('0:01.000')
  await show('spec')
  await page.waitForTimeout(300)
  const box = await page.locator('.plot').boundingBox(), lh = (tall(box) - LANES) / 2, lanes = [[0, lh], [lh + LANES, 2 * lh + LANES]]
  const mel = f => 2595 * Math.log10(1 + f / 700), at = { log: f => Math.log2(f / 20) / Math.log2(24000 / 20), mel: f => mel(f) / mel(24000) }
  // the brightest pixel down the middle of each lane: its height in CSS px, its level
  const brightest = async () => pixels(`const k = w / arg.width, x = Math.round(arg.x * k)
    return arg.lanes.map(([a, b]) => { let top = 0, at = 0; for (let y = Math.ceil(a * k); y < Math.floor(b * k); y++) { const v = d[(y * w + x) * 4 + 1]; if (v > top) { top = v; at = y } } return [(at + .5) / k, top] })`, { width: box.width, x: (box.width - (await gutter())) / 2, lanes })
  for (const scale of ['log', 'mel']) {
    // its frequencies on the next scale, octaves to mel
    if (scale === 'mel') {
      await settings('Frequency scale', 'Mel')
      await page.waitForTimeout(300)
    }
    const [[y1, loud], [y4, quiet]] = await brightest()
    const row1 = lh * (1 - at[scale](1000)), row4 = lanes[1][0] + lh * (1 - at[scale](4000))
    assert.ok(Math.abs(y1 - row1) < 2 && Math.abs(y4 - row4) < 2, `${scale}: 1 kHz at ${y1.toFixed(1)} of ${row1.toFixed(1)}, 4 kHz at ${y4.toFixed(1)} of ${row4.toFixed(1)}`)
    assert.ok(loud > 200 && quiet > 90 && quiet < loud - 30, `${scale}: the loud tone ${loud}, the quiet ${quiet}`)
  }
})

// The pointer on the spectrogram, held Alt (measuring), reads the level its colour stands for (gl-spectrogram pick) and
// marks it with a dot in the measuring red on the spectrum meter, which spans the spectrogram's own levels, its floor to
// its top (view.js meterX): tones of amplitude 0.5 and 0.05, 20 dB apart (20 · log10(0.5 / 0.05)), marked 20/80 of
// the meter's 40 px apart at the default 80 dB range, the louder, the loudest there is, at the top
test('editor: the pointer on the spectrogram, measuring, marks its level on the spectrum meter, on the spectrogram\'s scale', async () => {
  await open()
  await write(`const tone = (f, a) => Float32Array.from({ length: 48000 }, (_, i) => a * Math.sin(2 * Math.PI * f * i / 48000))
audio.from([tone(1000, .5), tone(4000, .05)], { sampleRate: 48000 })`)
  await lengthIs('0:01.000')
  await show('spec')
  await page.waitForTimeout(300)
  const box = await page.locator('.plot').boundingBox(), lh = (tall(box) - LANES) / 2, left = box.width - (await gutter()) - 45
  const at = f => 1 - Math.log2(f / 20) / Math.log2(24000 / 20)
  // the meter's columns in the measuring red along a row a pixel under the pointer's (its guide runs on the pointer's)
  const red = y => page.evaluate(([y, left]) => {
    const cv = document.querySelector('canvas.overlay'), k = cv.width / cv.clientWidth, n = Math.round(40 * k)
    const d = cv.getContext('2d').getImageData(Math.round(left * k), Math.round((y + 1) * k), n, 1).data
    return { k, lit: Array.from({ length: n }, (_, i) => i).filter(i => d[4 * i] - d[4 * i + 2] > 60 && d[4 * i + 3] > 200) }
  }, [y, left])
  // where the pointer's mark is, px into the meter
  const mark = async y => {
    await page.mouse.move(box.x + box.width * .4, box.y + y)
    await page.keyboard.down('Alt')
    await page.waitForTimeout(300)
    const { k, lit } = await red(y)
    await page.keyboard.up('Alt')
    assert.ok(lit.length, `a mark on the meter at ${y}`)
    return (lit[0] + lit.at(-1) + 1) / 2 / k
  }
  const loud = await mark(Math.round(lh * at(1000))), quiet = await mark(Math.round(lh + LANES + lh * at(4000)))
  assert.ok(loud > 37, `the loudest at the top: ${loud.toFixed(1)} of 40 px`)
  assert.ok(Math.abs(loud - quiet - 10) <= 1.5, `20 dB apart, 10 px: ${(loud - quiet).toFixed(1)}`)
})

test('editor: the waveform fill is as bright as the signal is often at that level', async () => {
  await open()
  // noise spends most of its time near silence and rarely reaches its peaks
  await write(`audio.from(t => (Math.random() - 0.5) * (Math.random() - 0.5) * 3, { duration: 2 })`)
  await lengthIs('0:02.000')
  await page.waitForTimeout(800)
  // brightness down the middle column, from the top of the lane to its centre line
  const column = await pixels(`const x = w >> 1, out = []; for (let y = 0; y < h; y++) { const i = (y * w + x) * 4; out.push(d[i] + d[i + 1] + d[i + 2]) } return out`)
  const box = await page.locator('.plot').boundingBox()
  const lit = column.map((v, y) => [v, y]).filter(([v]) => v > 90), top = lit[0][1], mid = Math.round(column.length * tall(box) / box.height / 2)
  const near = column[mid - 2], far = column[Math.round(top + (mid - top) * .15)]
  assert.ok(near > far * 1.4, `near the centre line ${near}, near the peak ${far}`)
  // a body, not a line at silence: a tenth of the way out to the peak nearly as bright as by the centre line (gl-waveform
  // 5.2's Gaussian about the RMS: 0.93 here; 5.1's crest-fitted power fell to 0.74, a line drawn at zero)
  const tenth = column[Math.round(mid - (mid - top) * .1)]
  assert.ok(tenth > near * .85, `a tenth of the way out ${tenth}, by the centre line ${near}`)
})

// One block: a head over the picture and the panel, the bar along the foot of both, the transport at its start, a
// status bar as an editor's; the panel docked at the picture's right
test('editor: output and bar are one block, the panel docked at the output\'s right, from under the head to the bar', async () => {
  await open()
  await tab('Edits')
  const box = name => page.locator(name).boundingBox()
  const [panes, bar, record, play, view, side, head] = await Promise.all(['.panes', '.status', 'button.record', 'button.play', '.view-slab', '.side-slab', '.view-head'].map(box))
  assert.ok(Math.abs(bar.y + bar.height - (panes.y + panes.height)) <= 1, 'the bar ends the block')
  assert.ok(Math.abs(bar.x - panes.x) <= 1 && Math.abs(bar.x + bar.width - (panes.x + panes.width)) <= 1, 'the whole width')
  const loop = await box('button.loop')
  assert.ok(play.x - bar.x < 24 && play.x < record.x && record.x < loop.x && loop.x + loop.width < view.x + view.width, 'play, record, loop, at its start')
  assert.equal(await page.locator('.status').evaluate(el => getComputedStyle(el).borderTopWidth), '0px')
  const over = await box('.side-head')
  assert.ok(Math.abs(head.width + over.width - panes.width) <= 1 && head.y + head.height <= view.y + 1 && Math.abs(over.x - side.x) <= 1, 'the head over both: the picture\'s and the panel\'s')
  // the panel beside the output at its right, under the head, short of the bar, whatever an older page left stored
  assert.ok(side.x >= view.x + view.width - 1 && side.x + side.width <= panes.x + panes.width, 'beside the output, at its right')
  assert.ok(side.y >= head.y + head.height - 1 && side.y + side.height <= bar.y, 'under the head, short of the bar')
  await page.evaluate(() => localStorage.setItem('audio-repl', JSON.stringify({ ...JSON.parse(localStorage.getItem('audio-repl')), layout: 'column', side: 'stack' })))
  await page.reload()
  await wholeLevels().waitFor()
  const [picture, panel] = await Promise.all(['.view-slab', '.side-slab'].map(box))
  assert.ok(panel.x >= picture.x + picture.width - 1, 'still beside it')
  assert.ok(await edits(), 'a panel stored under an old name opens on the edits')
})

// Shows the waveform or the spectrogram, every band (View; shown, it stays); what the last band shows, by its look
const show = name => menu('View', name === 'spec' ? 'Spectrogram' : 'Waveform')
const shown = async () => {
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))))
  return (await page.locator(':is(.lane-look, .layer-look):visible').last().getAttribute('aria-label')).replace(/^.*: /, '')
}

test('editor: a box on the spectrogram selects a band, plays it alone, and Delete writes spectral() for it', async () => {
  await open()
  await noCues()
  await write(hits)
  await lengthIs('0:02.000')
  await show('spec')
  const { box, x } = await axis(2)
  // a drag there selects time, as on the waveform
  await drag([x(.5), box.y + tall(box) * .3], [x(1) - x(.5), box.height * .2])
  assert.match(await selected(), /^0:00\.50\d–0:01\.00\d$/)
  assert.doesNotMatch(await readout(), /Hz/)
  await page.keyboard.press('Escape')
  await boxDrag([x(.5), box.y + tall(box) * .3], [x(1) - x(.5), box.height * .2])
  // the palette offers what a band takes first
  await page.keyboard.press('ControlOrMeta+K')
  assert.equal(await page.locator('.palette-group').first().innerText(), 'For the band')
  assert.deepEqual((await page.locator('.palette-list .tool strong').allInnerTexts()).slice(0, 4), ['Remove this band', 'This band 6 dB quieter', 'This band 6 dB louder', 'Rebuild this band from its surroundings'])
  await page.keyboard.press('Escape')
  assert.match(await selected(), /^0:00\.50\d–0:01\.00\d$/)
  assert.match(await readout(), /^[\d.]+k?Hz–[\d.]+k?Hz$/)
  assert.match(await page.locator('button.play').evaluate(tipOf), /^Play the band/)
  // the waveform shows no band: the time range stays, the band goes
  await show('wave')
  assert.doesNotMatch(await readout(), /Hz/)
  assert.match(await page.locator('button.play').evaluate(tipOf), /^Play the selection/)
  // the spectrogram again, its frequencies on another scale from its dropdown (mel), then on octaves again
  await show('spec')
  await settings('Frequency scale', 'Mel')
  assert.equal(await shown(), 'Spectrogram')
  assert.equal(await page.locator('.plot').getAttribute('data-scale'), 'mel')
  await settings('Frequency scale', 'Octaves')
  assert.equal(await page.locator('.plot').getAttribute('data-scale'), 'log')
  await page.keyboard.press('Escape')
  await boxDrag([x(.5), box.y + tall(box) * .3], [x(1) - x(.5), box.height * .2])
  await page.keyboard.press('Delete')
  await page.waitForFunction(() => /\.spectral\(/.test(scriptText()))
  const [, lo, hi, at, duration] = (await code()).match(/\.spectral\(\[([\d.]+), ([\d.]+)\], \{ at: ([\d.]+), d: ([\d.]+) \}\)/).map(Number)
  assert.ok(30 < lo && lo < hi && hi < 22050, `${lo} ${hi}`)
  assert.ok(Math.abs(at - .5) < .01 && Math.abs(at + duration - 1) < .01, `${at} ${duration}`)
  // near a mark on the frequency axis, an edge takes its value: 2 kHz and 500 Hz on the log axis, 20 Hz to Nyquist
  const lane = tall(box), fy = f => box.y + lane - Math.log2(f / 20) / Math.log2(22050 / 20) * lane
  await page.mouse.click(x(1.9), box.y + 20)
  await boxDrag([x(1.2), fy(2000) + 3], [x(1.6) - x(1.2), fy(500) - fy(2000) - 5])
  await page.keyboard.press('Delete')
  await page.waitForFunction(() => /\.spectral\(\[500, 2000\]/.test(scriptText()))
})

// A selection is one highlight in both pictures, a wash over it, the rest as it was (no focus, nothing around it
// darkened): on a spectrogram full of noise, a wash that lifts as plainly as the waveform's does on its dark ground
test('editor: a selection is the same highlight on a spectrogram full of noise, plain, nothing around it darkened', async () => {
  await open()
  await noCues()
  await write(`audio.from(4).noise({ color: 'pink' }).gain(-20)`)
  await lengthIs('0:04.000')
  await show('spec')
  const { box, x } = await axis(4), y = box.y + box.height / 2
  const mean = (a, b) => pixels(`let s = 0, n = 0; for (let y = 20; y < h - 30; y++) for (let x = arg[0]; x < arg[1]; x++) { const i = (y * w + x) * 4; s += d[i] + d[i + 1] + d[i + 2]; n++ } return s / n`, [Math.round(a - box.x), Math.round(b - box.x)])
  await page.mouse.click(x(3.9), y)
  await page.mouse.move(x(3.9), box.y + box.height + 40)
  const around = await mean(x(.2), x(1.2))
  await drag([x(1.5), y], [x(2.5) - x(1.5), 0])
  await page.mouse.move(x(3.9), box.y + box.height + 40)
  const inside = await mean(x(1.7), x(2.3)), outside = await mean(x(.2), x(1.2))
  // lifted over 20 levels a channel: twice what the waveform's 5% wash lifts its dark ground by (about 11)
  assert.ok(inside - outside > 60, `inside ${inside.toFixed(1)}, outside ${outside.toFixed(1)}`)
  assert.ok(Math.abs(outside - around) < around * .03, `around it as it was: ${outside.toFixed(1)}, ${around.toFixed(1)} before`)
})

// A band taken out of a long sound: the picture holds as it renders, nothing outside the box drawn again, and only the
// box's span changes once the output comes (the view patches what differs, gl-spectrogram's set())
test('editor: a band taken out redraws only where it was, the rest of the picture holding as it renders', async () => {
  await open()
  await noCues()
  await write(`audio.from(240).noise({ color: 'pink' }).gain(-20)`)
  await lengthIs('4:00.000')
  await show('spec')
  const { box, x } = await axis(240), lane = tall(box)
  // the left quarter of the lanes, as a fingerprint of its pixels
  const left = () => pixels(`let s = 0; for (let y = 10; y < h - 30; y += 3) for (let x = 0; x < arg; x += 2) { const i = (y * w + x) * 4; s = (s * 31 + d[i] + d[i + 1] * 7 + d[i + 2] * 13) % 1000000007 } return s`, Math.round(x(54) - box.x))
  await page.mouse.click(x(180), box.y + lane * .5)
  await page.waitForTimeout(300)
  const before = await left()
  await boxDrag([x(120), box.y + lane * .2], [x(144) - x(120), lane * .2])
  await page.keyboard.press('Escape')
  await page.waitForTimeout(300)
  const held = await left()
  assert.equal(held, before, 'the box drawn, nothing else')
  await page.mouse.click(x(180), box.y + lane * .5)
  await boxDrag([x(120), box.y + lane * .2], [x(144) - x(120), lane * .2])
  await page.waitForTimeout(300)
  const boxed = await left()
  await page.keyboard.press('Delete')
  const seen = new Set()
  for (const until = Date.now() + 3000; Date.now() < until;) seen.add(await left())
  assert.ok(/\.spectral\(/.test(await code()))
  assert.deepEqual([...seen], [boxed], `the left quarter drawn ${seen.size} ways as the output came`)
})

// ⌘ pressed partway through a range dragged on the spectrogram makes it a box from where the drag began, at once, before
// the pointer moves again: its band from the press's height to the pointer's, heard alone as it goes
test('editor: ⌘ pressed while a range is dragged on the spectrogram makes it a box', async () => {
  await open()
  await noCues()
  await write(hits)
  await lengthIs('0:02.000')
  await show('spec')
  const { box, x } = await axis(2), lane = tall(box)
  await page.mouse.move(x(.25), box.y + lane * .3)
  await page.mouse.down()
  await page.mouse.move(x(.5), box.y + lane * .5, { steps: 4 })
  assert.doesNotMatch(await readout(), /Hz/)
  await page.keyboard.down('ControlOrMeta')
  await page.waitForFunction(() => /Hz–[\d.]+k?Hz$/.test(document.querySelector('.readout').textContent))
  await page.mouse.move(x(.75), box.y + lane * .6, { steps: 4 })
  await page.mouse.up()
  await page.keyboard.up('ControlOrMeta')
  assert.match(await selected(), /^0:00\.25\d–0:00\.75\d$/)
  const [lo, hi] = (await readout()).match(/[\d.]+k?Hz/g).map(v => parseFloat(v) * (v.includes('k') ? 1000 : 1))
  // 30% to 60% down the log axis, 20 Hz to 22.05 kHz: 20 · 1102.5^0.7 ≈ 2.7 kHz down to 20 · 1102.5^0.4 ≈ 330 Hz
  assert.ok(lo > 250 && lo < 450 && hi > 2000 && hi < 3500, `${lo}–${hi}`)
  assert.match(await page.locator('button.play').evaluate(tipOf), /^Play the band/)
})

// Several boxes, as Photoshop's several selections: Alt and a drag adds another; Play plays each band over its time,
// Delete takes each out, one step, and the caret runs through the band alone
test('editor: Alt and a drag on the spectrogram adds another box; Delete takes every box out at once', async () => {
  await open()
  await noCues()
  await write(`audio('chime.wav')`)
  await lengthIs('0:08.000')
  await show('spec')
  const { box, x } = await axis(8), lane = tall(box)
  await boxDrag([x(1), box.y + lane * .2], [x(2) - x(1), lane * .1])
  // Shift pressed and let go on the way loses none
  await page.keyboard.down('Alt')
  await page.mouse.move(x(4), box.y + lane * .6)
  await page.mouse.down()
  await page.mouse.move(x(4.5), box.y + lane * .65, { steps: 3 })
  await page.keyboard.down('Shift')
  await page.mouse.move(x(4.7), box.y + lane * .67, { steps: 2 })
  await page.keyboard.up('Shift')
  await page.mouse.move(x(5), box.y + lane * .7, { steps: 3 })
  await page.mouse.up()
  await page.keyboard.up('Alt')
  assert.equal(await readout(), '2 bands')
  assert.match(await page.locator('button.play').evaluate(tipOf), /^Play the bands/)
  await page.keyboard.press('ControlOrMeta+K')
  assert.equal(await page.locator('.palette-group').first().innerText(), 'For the 2 bands')
  await page.keyboard.press('Escape')
  // a method from the context menu, for each box's time: the clicks in each taken out
  await page.mouse.click(x(1.5), box.y + lane * .25, { button: 'right' })
  await menuRow('Process').click()
  await menuRow('Repair').click()
  await menuRow('Remove the clicks in each').click()
  await page.waitForFunction(() => (scriptText().match(/\.declick\(\{ at: [\d.]+, d: [\d.]+ \}\)/g) || []).length === 2)
  const clicks = [...(await code()).matchAll(/\.declick\(\{ at: ([\d.]+), d: ([\d.]+) \}\)/g)].map(m => +m[1]).sort((p, q) => p - q)
  assert.ok(Math.abs(clicks[0] - 1) < .02 && Math.abs(clicks[1] - 4) < .02, JSON.stringify(clicks))
  assert.equal(await readout(), '2 bands', 'the boxes stay')
  await page.locator('.plot').focus()
  await page.keyboard.press('Delete')
  await page.waitForFunction(() => (scriptText().match(/\.spectral\(\[\d+, \d+\], \{ at: [\d.]+, d: [\d.]+ \}\)/g) || []).length === 2)
  const calls = [...(await code()).matchAll(/\.spectral\(\[(\d+), (\d+)\], \{ at: ([\d.]+), d: ([\d.]+) \}\)/g)].map(m => m.slice(1).map(Number))
  assert.ok(Math.abs(calls[0][2] - 1) < .02 && Math.abs(calls[1][2] - 4) < .02 && calls.every(([lo, hi]) => lo < hi), JSON.stringify(calls))
  assert.equal(await page.locator('.message.problem').count(), 0)
})

// A band plays through two Butterworth biquads per edge. Its first highpass was once connected to itself: a feedback
// loop with no delay, whose output ran to 1e35.
test('editor: a band plays through stable filters: what reaches the speakers stays within full scale', async () => {
  await page.addInitScript(tap)
  await open()
  await show('spec')
  const { box, x } = await axis(6.525)
  await boxDrag([x(1), box.y + box.height * .2], [x(2) - x(1), box.height * .1])
  assert.match(await readout(), /Hz–/)
  await heard()
  await page.keyboard.press('Space')
  await page.getByRole('button', { name: 'Pause' }).waitFor()
  await page.waitForTimeout(800)
  const { peak, finite } = await heard()
  assert.ok(finite && peak > 1e-3 && peak <= 1, `peak ${peak}`)
})

// Scrubbing (playground/scrub.js): a vocoder whose tonal peaks keep their phase advance, the rest of the bins random phases.
// A sound longer than the page holds scrubs as any does: a press on the time row sounds the moment under it, from the
// samples about it the player fetches (player.js near); the mark shows them too. Where it is held still, it holds
test('editor: a sound longer than the page holds sounds under the caret as it is pressed', async () => {
  await page.addInitScript(tap)
  await open()
  await write(`audio.from(t => Math.sin(2 * Math.PI * 220 * t) * .5, { duration: 1820, sampleRate: 48000 })`)
  await page.waitForFunction(() => (e => e.title || e.dataset.tip || '')(document.querySelector('.source')).endsWith('30:20.000'), null, { timeout: 120000 })
  await page.waitForFunction(() => !document.querySelector('.message').textContent, null, { timeout: 120000 })
  const { box, x } = await axis(1820), row = box.y + box.height - 8
  await page.waitForTimeout(300)
  await heard()
  for (const t of [600, 1500]) {
    await page.mouse.move(x(t), row)
    await page.mouse.down()
    await page.waitForTimeout(600)
    const pressed = await heard()
    await page.mouse.up()
    assert.ok(pressed.finite && pressed.peak > .05, `pressed at ${t} s: peak ${pressed.peak}`)
    await page.waitForTimeout(300)
    await heard()
  }
})

test('editor: the caret drags like an edge from its line, a press on the time row puts it there, and the moment under it sounds while held', async () => {
  await page.addInitScript(tap)
  await open()
  const { box, x } = await axis(6.525), row = box.y + box.height - 8, lane = box.y + tall(box) / 2
  // the mark in the bar: the logo at rest, the wave under the caret while it sounds, turned by the caret's travel
  const markShot = () => page.locator('.bar .wordmark .logo > canvas').screenshot()
  // how far apart two shots are, gray levels a pixel: a turn that ends back at the pose leaves a hair's width of it
  const gap = async (a, b) => page.evaluate(async ([a, b]) => {
    const read = async png => {
      const image = new Image()
      image.src = 'data:image/png;base64,' + png
      await image.decode()
      const context = new OffscreenCanvas(image.width, image.height).getContext('2d')
      context.drawImage(image, 0, 0)
      return context.getImageData(0, 0, image.width, image.height).data
    }
    const [x, y] = [await read(a), await read(b)]
    let sum = 0
    for (let i = 0; i < x.length; i += 4) sum += Math.abs(x[i] - y[i])
    return sum / (x.length / 4)
  }, [a.toString('base64'), b.toString('base64')])
  await page.waitForTimeout(500)
  const rest = await markShot()
  // a press on the time row puts the caret there and sounds the moment under it at once: sooner than the 200 ms a press
  // was once held for before it sounded, on a machine however busy
  await page.mouse.move(x(3), row)
  await page.mouse.down()
  await page.waitForTimeout(150)
  const under = await markShot()
  assert.ok(!under.equals(rest), 'the mark shows the moment under the caret')
  const pressed = await heard()
  assert.ok(pressed.finite && pressed.peak > .01, `sounds within 150 ms of the press: peak ${pressed.peak}`)
  await page.mouse.up()
  await page.locator('.time', { hasText: /^0:03\.000$/ }).waitFor()
  await page.waitForTimeout(300)
  await heard()
  // the caret's line grabbed and held sounds; dragged, it moves, no range made
  await page.mouse.move(x(3), lane)
  await page.mouse.down()
  await page.waitForTimeout(500)
  const before = await markShot()
  for (let i = 1; i <= 10; i++) { await page.mouse.move(x(3 + i * .1), lane); await page.waitForTimeout(20) }
  assert.ok(!(await markShot()).equals(before), 'dragged, the mark turns with the caret')
  const held = await heard()
  assert.ok(held.finite && held.peak > .01 && held.peak <= 1, `peak ${held.peak}`)
  await page.mouse.up()
  await page.locator('.time', { hasText: /^0:04\.000$/ }).waitFor()
  // let go, it falls silent
  await page.waitForTimeout(300)
  await heard()
  await page.waitForTimeout(300)
  assert.equal((await heard()).peak, 0, 'silent after letting go')
  // and the mark is the logo again
  let apart = Infinity
  for (let i = 0; i < 30 && apart > .5; i++) { await page.waitForTimeout(100); apart = await gap(await markShot(), rest) }
  assert.ok(apart <= .5, `the mark comes back to the logo, ${apart} apart`)
})

// The time row is a ruler, as a DAW's: dragged, it selects from where it was pressed; clicked, the caret goes there
// alone, what is selected staying; held still 0.4 s (HOLD, view.js, as Play's), the caret, dragged, the
// selection staying; with Alt, another range beside it
test('editor: a drag on the time row selects, a click there moves the caret alone, held it drags the caret', async () => {
  await open()
  await noCues()
  const { box, x } = await axis(6.525), row = box.y + box.height - 8
  const caret = async () => { const [m, s] = (await page.locator('.time').innerText()).split(':'); return +m * 60 + +s }
  const along = async (a, b, wait = 0) => { await page.mouse.move(x(a), row); await page.mouse.down(); await page.waitForTimeout(wait); for (let i = 1; i <= 8; i++) await page.mouse.move(x(a + (b - a) * i / 8), row); await page.mouse.up() }
  await along(1, 3)
  const range = await selected(), [a, b] = range.split('–').map(t => +t.split(':')[1])
  assert.ok(Math.abs(a - 1) < .03 && Math.abs(b - 3) < .03, `dragged, a range: ${range}`)
  assert.equal(await page.locator('.plot').evaluate(el => el.style.cursor), '', 'the I-beam over it, as over the lanes: it selects')
  await page.mouse.click(x(5), row)
  assert.ok(Math.abs(await caret() - 5) < .03, `clicked, the caret there: ${await caret()}`)
  assert.equal(await selected(), range, 'the range staying')
  await along(4, 4.5, 700)
  assert.ok(Math.abs(await caret() - 4.5) < .03, `held, the caret dragged: ${await caret()}`)
  assert.equal(await selected(), range, 'no range made, the one there staying')
  await keyed(['Alt'], () => along(5, 6))
  assert.match(await page.locator('.clock').evaluate(tipOf), /^Selected 2 ranges:/, 'with Alt, another')
})

// Inside a selection the caret's line drags as it does without one, the selection kept; where a selection puts it, on
// its start, the edge takes the press; only clicked, it is a click: the caret there alone
test('editor: inside a selection the caret drags, the selection kept; on the selection\'s edge, the edge drags', async () => {
  await open()
  const { box, x } = await axis(6.525), row = box.y + box.height - 8, lane = box.y + tall(box) / 2
  const drag = async (a, b) => { await page.mouse.move(x(a), lane); await page.mouse.down(); for (let i = 1; i <= 8; i++) await page.mouse.move(x(a + (b - a) * i / 8), lane); await page.mouse.up() }
  const caret = async () => { const [m, s] = (await page.locator('.time').innerText()).split(':'); return +m * 60 + +s }
  await drag(1, 3)
  const range = await selected()
  assert.ok(range, 'a range selected')
  // the time row moves the caret alone, into the range
  await page.mouse.click(x(2), row)
  assert.ok(Math.abs(await caret() - 2) < .06, `caret at 2s: ${await caret()}`)
  assert.equal(await selected(), range)
  // its line there dragged: the caret goes, the range stays as it was
  await drag(2, 2.5)
  assert.ok(Math.abs(await caret() - 2.5) < .06, `caret dragged to 2.5s: ${await caret()}`)
  assert.equal(await selected(), range)
  // the range's end, the caret on it once a range is made again (where the drag left it): the edge's, the range longer,
  // no caret dragged off it
  await page.mouse.click(x(5), lane)
  await drag(1, 3)
  const made = await selected(), end = await caret()
  await drag(end, end + .4)
  const [a, b] = (await selected()).split('–'), at = t => t.split(':').reduce((m, s) => m * 60 + +s, 0)
  assert.ok(Math.abs(at(b) - end - .4) < .06 && at(a) === at(made.split('–')[0]), `the end dragged: ${made} → ${a}–${b}`)
  // a click on the caret's line inside the range, no drag: the caret there alone
  await page.mouse.click(x(2), row)
  await page.mouse.click(x(2), lane)
  assert.equal(await selected(), '')
})

test('editor: stopping settles the mark into the logo in about 300 ms', async () => {
  // every frame the mark draws, read back as it is drawn
  await page.addInitScript(() => {
    const draw = WebGL2RenderingContext.prototype.drawArrays
    window.__marks = []
    WebGL2RenderingContext.prototype.drawArrays = function (...args) {
      draw.apply(this, args)
      const c = this.canvas
      if (window.__watch && c.closest?.('.wordmark')) {
        const k = new OffscreenCanvas(c.width, c.height).getContext('2d')
        k.drawImage(c, 0, 0)
        window.__marks.push([performance.now(), k.getImageData(0, 0, c.width, c.height).data])
      }
    }
  })
  await open()
  await page.locator('.view-slab').click({ position: { x: 300, y: 150 } })
  await page.keyboard.press('Space')
  await page.waitForTimeout(1200)
  await page.evaluate(() => {
    window.__marks.length = 0
    window.__watch = true
    document.addEventListener('keydown', e => { if (e.code === 'Space') window.__t0 = performance.now() }, true)
  })
  await page.keyboard.press('Space')
  await page.waitForTimeout(1200)
  // the frame after which the mark is within half a gray level of where it ends
  const settled = await page.evaluate(() => {
    const marks = window.__marks, last = marks.at(-1)[1]
    let at = 0
    marks.forEach(([t, d], i) => {
      let sum = 0
      for (let k = 3; k < d.length; k += 4) sum += Math.abs(d[k] - last[k])
      if (sum / (d.length / 4) > .5) at = marks[i + 1]?.[0] ?? t
    })
    return at - window.__t0
  })
  assert.ok(settled > 50 && settled < 400, `the mark stopped ${Math.round(settled)} ms after Stop`)
})

// While the engine loads, the mark turns gently at its own size, solid ink from its first frame: it does not fade in, shrink
// or pale, and comes back from loading as the logo, not as a shape growing to size
test('editor: the bar\'s mark is plain while the engine loads: whole from its first frame, no smaller, no paler', async () => {
  await page.addInitScript(() => {
    const draw = WebGL2RenderingContext.prototype.drawArrays
    window.__frames = []
    WebGL2RenderingContext.prototype.drawArrays = function (...args) {
      draw.apply(this, args)
      const c = this.canvas
      if (!c.closest?.('.wordmark')) return
      const k = new OffscreenCanvas(c.width, c.height).getContext('2d')
      k.drawImage(c, 0, 0)
      const d = k.getImageData(0, 0, c.width, c.height).data
      let solid = 0, half = 0
      for (let i = 3; i < d.length; i += 4) { if (d[i] > 215) solid++; else if (d[i] > 40) half++ }
      window.__frames.push([c.width, solid, half, !!c.closest('.wordmark').querySelector('svg')])
    }
  })
  await open()
  await page.waitForTimeout(1200)
  const frames = await page.evaluate(() => window.__frames)
  const width = frames.at(-1)[0], sized = frames.filter(f => f[0] === width), ink = sized.map(f => f[1])
  assert.ok(sized.length > 5, `${sized.length} frames at its size`)
  assert.ok(Math.min(...ink) > .85 * Math.max(...ink), `the same size throughout, ${Math.min(...ink)}–${Math.max(...ink)} solid pixels`)
  assert.ok(Math.max(...sized.map(f => f[2] / f[1])) < .6, 'and flat, a rim of half-tone only, not a gradient')
  assert.equal(frames[frames.findIndex(f => !f[3])][0], width, 'the static mark stays until the live one has drawn at its size')
})

// Over the bar's wordmark the mark copies the pointer's sideways moves, half as far as a drag would turn it, and catches
// in the logo pose when the pointer leaves; while a sound plays it leaves the pointer alone
test('editor: the mark copies the pointer over the wordmark, and catches in the logo pose when the pointer leaves', async () => {
  await open()
  const bar = page.locator('.bar .wordmark'), box = await bar.boundingBox(), y = box.y + box.height / 2
  const width = await bar.locator('canvas').evaluate(c => c.clientWidth)
  const phase = () => page.evaluate(async () => (await import('/logo/mark.js')).mark(document.querySelector('.bar .wordmark')).phase)
  await page.waitForTimeout(1000)
  const rest = await phase()
  assert.ok(Math.abs(rest - Math.round(rest)) < .001, `at rest it is the logo, ${rest}`)
  await page.mouse.move(box.x + box.width - 10, y)
  await page.waitForTimeout(700)
  assert.ok(Math.abs(await phase() - rest) < .001, 'hovering alone does nothing to it')
  await page.mouse.move(box.x + box.width - 40, y, { steps: 10 })
  await page.waitForTimeout(400)
  const left = await phase()
  assert.ok(Math.abs(left - rest + 15 / width) < .01, `30 px left is ${15 / width} of a turn back, half a drag's, ${left - rest}`)
  await page.mouse.move(box.x + box.width - 25, y, { steps: 5 })
  await page.waitForTimeout(400)
  assert.ok(Math.abs(await phase() - (left + 7.5 / width)) < .01, 'and 15 px right, some of it forward again')
  // let go of it and it catches in the pose nearest, within 400 ms
  await page.mouse.move(box.x + box.width + 300, y + 300)
  await page.waitForTimeout(500)
  const caught = await phase()
  assert.ok(Math.abs(caught - Math.round(caught)) < .001, `the pointer has left: caught in a pose, ${caught}`)
  // a sound playing is the mark's business: the pointer moves it no more, so a sweep to the left never turns it back
  await page.locator('.plot').click({ position: { x: 120, y: 60 } })
  await page.keyboard.press('Space')
  await page.mouse.move(box.x + box.width - 10, y)
  await page.waitForTimeout(300)
  await page.evaluate(async () => {
    const it = (await import('/logo/mark.js')).mark(document.querySelector('.bar .wordmark'))
    window.__phases = []
    const sample = () => { window.__phases.push(it.phase); requestAnimationFrame(sample) }
    sample()
  })
  await page.mouse.move(box.x + box.width - 40, y, { steps: 10 })
  await page.mouse.move(box.x + box.width - 10, y, { steps: 10 })
  await page.waitForTimeout(200)
  const phases = await page.evaluate(() => window.__phases)
  assert.ok(phases.length > 10 && phases.every((p, i) => !i || p >= phases[i - 1] - 1e-9), 'while it plays it only turns on, at its own pace')
  await page.keyboard.press('Space')
})

// The mark's wave after an edit that pitches a fragment down: the sound there has little a pitch tracker can hold, and a wave
// once lost to it stayed lost. What shows a few rows above the axis is a wave.
test('editor: the mark still shows the wave of a fragment pitched down, playing, and again after it', async () => {
  await open()
  await write(`audio('chime.wav').pitch(-24, { at: 1, duration: 3 })`)
  await lengthIs('0:08.000')
  const { box, x } = await axis(8)
  const crest = async () => {
    const png = (await page.locator('.bar .wordmark .logo').screenshot()).toString('base64')
    return page.evaluate(async png => {
      const image = new Image()
      image.src = 'data:image/png;base64,' + png
      await image.decode()
      const c = new OffscreenCanvas(image.width, image.height).getContext('2d')
      c.drawImage(image, 0, 0)
      const d = c.getImageData(0, 0, image.width, image.height).data
      let ink = 0
      // dark pixels a few rows above the middle, where the axis lies
      for (let y = 0; y < image.height / 2 - 3 * image.height / 32; y++) for (let k = 0; k < image.width; k++) if (d[(y * image.width + k) * 4] < 100) ink++
      return ink
    }, png)
  }
  const shapes = async () => { let most = 0; for (let i = 0; i < 12; i++) { await page.waitForTimeout(90); most = Math.max(most, await crest()) } return most }
  await page.mouse.click(x(1.3), box.y + box.height / 2)
  await page.keyboard.press('Space')
  { const n = await shapes(); assert.ok(n > 5, `a wave while the fragment plays: ${n}`) }
  await page.keyboard.press('Space')
  await page.waitForTimeout(600)
  // again, from before the fragment, and after it
  await page.mouse.click(x(.2), box.y + box.height / 2)
  await page.keyboard.press('Space')
  assert.ok(await shapes() > 5, 'and while what is before it plays')
  await page.keyboard.press('Space')
})

test('editor: louder and quieter ease a range in and out on the one gain curve the pen draws', async () => {
  await open()
  await noCues()
  const { box, x } = await axis(6.525)
  await drag([x(2), box.y + 100], [x(3) - x(2), 0])
  const louder = () => palette('3 dB louder'), gain = () => code().then(c => c.match(/\.gain\((.*)\)$/)?.[1])
  await louder()
  await page.waitForFunction(() => /\.gain\(/.test(scriptText()))
  assert.equal(await gain(), '{ t: [2, 2.005, 2.995, 3], v: [0, 3, 3, 0] }')
  // again adds again, to the same curve
  await louder()
  await page.waitForFunction(() => /v: \[0, 6, 6, 0\]/.test(scriptText()))
  // a range from the start has no ramp there; the curve keeps the points of both
  await drag([x(1), box.y + 40], [x(0) - x(1) - 10, 0])
  await palette('3 dB quieter')
  await page.waitForFunction(() => /v: \[-3, -3, 0, 0, 6, 6, 0\]/.test(scriptText()))
  assert.equal(await gain(), '{ t: [0, 0.995, 1, 2, 2.005, 2.995, 3], v: [-3, -3, 0, 0, 6, 6, 0] }')
})

test('editor: a band quieter or louder is one spectral() call, changed in place while the band and range stay', async () => {
  await open()
  await noCues()
  await write(hits)
  await lengthIs('0:02.000')
  await show('spec')
  const { box, x } = await axis(2)
  await boxDrag([x(.5), box.y + tall(box) * .3], [x(1) - x(.5), box.height * .2])
  await palette('This band 6 dB quieter')
  await page.waitForFunction(() => /\.spectral\(\[\d+, \d+\], -6, \{ at: 0\.5, d: 0\.5 \}\)$/.test(scriptText()))
  await palette('This band 6 dB quieter')
  await page.waitForFunction(() => /\.spectral\(\[\d+, \d+\], -12, /.test(scriptText()))
  assert.equal((await code()).match(/\.spectral\(/g).length, 1)
})

// A script that opens with a gain() step draws its gain line from the start: the page must finish loading
test('editor: a script that opens with gain() loads, its gain line drawn', async () => {
  await page.addInitScript(() => localStorage.setItem('audio-repl', JSON.stringify({ side: 'code', code: `audio('chime.wav').gain(-6).gain({ t: [0, 1], v: [0, -6] })` })))
  await open()
  assert.match(await code(), /\.gain\(-6\)/)
})

// Wide and short, a laptop's window or a landscape phone's: the panel beside the picture, not a sheet over its tracks
test('editor: a wide, short window keeps the panel beside the picture', async () => {
  await page.setViewportSize({ width: 1280, height: 480 })
  await open()
  await tab('Edits')
  const [side, view] = await Promise.all(['.side-slab', '.view-slab'].map(s => page.locator(s).boundingBox()))
  assert.ok(side.x >= view.x + view.width - 1 && side.y < view.y + view.height / 2, `the panel at ${side.x},${side.y}, the picture ${view.x}–${view.x + view.width}`)
})

// On a narrow screen held upright a panel opens under the output, the whole width, the bar between them, as much of the
// slab as the picture keeps; its buttons stay in reach
test('editor: a shared link restores the script; on a narrow screen the panel opens under the output, the whole width', async () => {
  await open()
  await write(`audio('chime.wav').reverse()`)
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin })
  await page.getByRole('button', { name: 'Share' }).click()
  await page.waitForFunction(() => location.hash.startsWith('#code='))
  const url = page.url()
  await page.close()
  page = await browser.newPage({ viewport: { width: 390, height: 844 } })
  page.on('pageerror', error => errors.push(error.message))
  await page.goto(url)
  await wholeLevels().waitFor({ state: 'attached' })
  assert.equal(await code(), `audio('chime.wav').reverse()`)
  await tab('Edits')
  const view = await page.locator('.view-slab').boundingBox(), chain = await page.locator('.side-slab').boundingBox(), bar = await page.locator('.status').boundingBox()
  assert.ok(chain.width >= view.width - 14 && chain.y >= bar.y + bar.height - 1 && bar.y >= view.y + view.height - 1, `under the output and its bar: ${JSON.stringify(chain)} under ${JSON.stringify(view)}`)
  assert.ok(Math.abs(chain.height - view.height) < 2, 'as tall as the picture')
  for (const name of ['Code', 'Export', 'Settings']) assert.ok(await page.getByRole('tab', { name, exact: true }).isVisible(), name)
  assert.ok(await page.getByRole('button', { name: 'Undo', exact: true }).isVisible())
})

// ── Loading and the gestures ───────────────────────────────────

// A file comes over the network as it arrives: the script runs at once on what has come, the output streams, the
// waveform grows across the time the file's header says it lasts, the readout says how much has come
test('editor: a file over a slow connection shows as it arrives, with how much has come, then is whole', async () => {
  await open()
  await write(`audio('${origin}/slow/test/fixture.wav').gain(-1)`)
  // under 60% of it come: some drawn, not all
  await page.locator('.message', { hasText: /^Decoding [1-5]?\d%$/ }).waitFor()
  // its length not yet known: in its place an ellipsis between the bars, plain, how much has come in its title
  assert.deepEqual(await page.locator('.length').evaluate(e => [e.textContent, getComputedStyle(e).visibility, getComputedStyle(e).backgroundImage, getComputedStyle(e, '::before').content]), ['…', 'visible', 'none', '"|"'])
  assert.match(await page.locator('.length').evaluate(tipOf), /^Length\n[1-5]?\d% here$/)
  // in Record's place, a ring of how much has come, which stops it
  const ring = page.getByRole('button', { name: 'Stop', exact: true })
  assert.ok(await ring.isVisible(), 'the ring in Record\'s place')
  assert.ok(await page.locator('.record').evaluate(e => e.inert), 'Record gives way')
  const arrived = +await ring.evaluate(e => getComputedStyle(e).getPropertyValue('--arrived'))
  assert.ok(arrived > 0 && arrived < .6, `the ring as far as it has come: ${arrived}`)
  const early = await drawn()
  assert.ok(early > 0, 'some of it is drawn before it has all come')
  await page.waitForFunction(() => !document.querySelector('.message').textContent && document.querySelector('.readout')?.dataset.of === 'all', null, { timeout: 20000 })
  assert.ok(await drawn() > early, 'more once it has')
  await lengthIs('0:02.000')
})

// A file arriving with nothing to wait for draws as it decodes, all the way: the file itself, dim, then the output in
// its place from its first piece on, as the engine stops sending the file then (worker.js arriving); what is still to
// come, its length known from its header, the centre line across it to its end
test('editor: a file arriving draws as it decodes, what is still to come a centre line to its end', async () => {
  await open()
  await noCues()
  await write(`audio('${origin}/slow/test/fixture.wav')`)
  await page.locator('.message', { hasText: /^Decoding/ }).waitFor()
  const { box, x } = await axis(2), end = Math.min(x(2), box.x + box.width - (await gutter()) - 50) - box.x
  // CSS px: where the line of how far it has come is (past the caret's), and the share of the columns after it, to the
  // end, that the centre line lights; in its lane, at most TRACK px tall
  const read = () => page.evaluate(([end, most, room]) => {
    const cv = __overlay(), k = cv.width / cv.clientWidth, g = cv.getContext('2d'), h = Math.max(most, cv.clientHeight - 22 - 18 - room)
    const row = y => g.getImageData(0, Math.round(y) * k, cv.width, 1).data, top = row(h * .25), mid = row(h / 2)
    let come = -1
    for (let i = 3 * k; i < cv.width; i++) if (top[4 * i + 3] > 100) { come = i / k; break }
    let lit = 0, n = 0
    for (let i = Math.ceil((come + 3) * k); i < end * k; i++, n++) lit += mid[4 * i + 3] > 0
    return { come, line: n ? lit / n : 1, decoding: /^Decoding/.test(document.querySelector('.message').textContent) }
  }, [end, TRACK, ROOM])
  const early = await read()
  await page.waitForTimeout(700)
  const later = await read()
  assert.ok(early.decoding && later.decoding, 'still decoding')
  assert.ok(early.come > 0 && later.come > early.come + 20, `as it decodes: come to ${early.come} px, then ${later.come}`)
  assert.ok(early.line > .98 && later.line > .98, `the centre line to its end: ${early.line}, ${later.line}`)
  await page.waitForFunction(() => !document.querySelector('.message').textContent, null, { timeout: 20000 })
  const whole = (await read()).come
  assert.ok(whole < 0 || whole >= x(2) - box.x - 1, `whole: no line of how far it has come, the end's rule at most: ${whole}`)
})

// A step reading its input whole first (auto's analysis, its stages) holds the output back, the page reloaded on it: the
// file shows meanwhile as it is, dim, and plays; the status says the step and its stages in words, how long it has taken
// after them, apart, no dots between
test('editor: the file shows while a step reading it whole holds the output, its stages said in words', async () => {
  await open()
  await write(`audio('chime.wav').auto()`)
  await page.locator('.message', { hasText: /^Applying auto/ }).waitFor()
  await page.reload()
  await page.locator('.message-words', { hasText: /^Applying auto: \w/ }).waitFor({ timeout: 10000 })
  assert.ok(await drawn() > 0, 'the file drawn while the output is made')
  assert.equal(await page.locator('.play').isDisabled(), false, 'and plays')
  await page.locator('.message-figure', { hasText: /^ \d+\.\ds$/ }).waitFor()
  const words = await page.locator('.message-words').textContent()
  assert.doesNotMatch(words, /[·…+]/, `in words: ${words}`)
  await page.waitForFunction(() => !document.querySelector('.message').textContent && document.querySelector('.readout')?.dataset.of === 'all', null, { timeout: 60000 })
})

// An empty tab is an empty track, its caret at its start, its time row over 10 s, a word in it of what goes there, and
// nothing to press: File › Open recent lists what to open again, a tab closed, as it was left, its edits counted, which
// opens in the empty tab's place; no band's look while there is no sound to show
test('editor: an empty tab is an empty track; File › Open recent opens a closed tab in its place, no look while there is no sound', async () => {
  await open()
  await write(`audio('chime.wav').gain(-3)`)
  await menu('File', 'Close tab')
  await page.locator('.empty').waitFor()
  await page.waitForFunction(() => ![...document.querySelectorAll('.view button')].some(b => b.checkVisibility()))
  // the time row's labels drawn, 0 to 9 s, as a take into it is first watched over
  await page.waitForFunction(() => document.querySelector('.plot canvas.row').style.opacity === '1')
  await page.locator('.menubar-item', { hasText: /^File$/ }).click()
  await menuRow('Open recent').click()
  const row = page.locator('.menubar-sub:popover-open .menu-row').first()
  assert.equal(await row.locator('.menu-label').innerText(), 'chime.wav')
  assert.equal(await row.locator('.menu-keys').innerText(), '1 edit, closed just now')
  await row.click()
  await page.waitForFunction(() => scriptText().includes('gain(-3)'))
  assert.deepEqual(await page.locator('.files [role="tab"]').allInnerTexts(), ['chime.wav'], 'in the empty tab\'s place')
  await wholeLevels().waitFor()
  await page.locator(':is(.lane-look, .layer-look):visible').waitFor()
  // a sound made in the script, opening no file: named by its first line; the newest first (chime.wav, closed after it)
  await page.getByRole('button', { name: 'New tab' }).click()
  await write(`audio.from(t => Math.sin(t * 2000), { duration: 1 })`)
  await menu('File', 'Close tab')
  await menu('File', 'Close tab')
  await page.locator('.empty').waitFor()
  await page.locator('.menubar-item', { hasText: /^File$/ }).click()
  await menuRow('Open recent').click()
  await page.locator('.menubar-sub:popover-open .menu-row').first().waitFor()
  assert.deepEqual(await page.locator('.menubar-sub:popover-open .menu-row .menu-label').allInnerTexts(), ['chime.wav', 'audio.from(t => Math.sin(t * 2000), { du', 'Delete kept sounds…'])
  await page.keyboard.press('Escape')
})

// A file still arriving plays as far as it has come, its pieces pushed to the deck as they come: the file's own, where
// the output waits for all of it (normalize), or the output's, where it comes as the file does; then on into the output
// once it is whole, to its end. The fixture sounds from 0.2 s to 1.8 s without a pause: so does what is heard
test('editor: a file still decoding plays as far as it has come', async () => {
  await page.addInitScript(taken)
  await open()
  for (const [ms, chain] of [[60, ''], [70, '.normalize(-3)']]) {
    await write(`audio('${origin}/slow/test/fixture.wav?ms=${ms}')${chain}`)
    await page.locator('.message', { hasText: /^Decoding/ }).waitFor()
    await page.waitForFunction(() => !document.querySelector('.play').disabled)
    await page.evaluate(() => { window.__taken.length = 0 })
    await page.getByRole('button', { name: 'Play', exact: true }).click()
    await page.getByRole('button', { name: 'Pause' }).waitFor()
    assert.match(await page.locator('.message').innerText(), /^(Decoding|Applying)/, `${chain}: still arriving`)
    await page.waitForTimeout(700)
    const [x, clock] = await page.evaluate(() => [window.__taken.flatMap(b => [...b]), document.querySelector('.time').textContent])
    assert.ok(x.some(v => Math.abs(v) > .01), `${chain}: heard`)
    assert.ok(+clock.split(':')[1] > .2, `${chain}: the clock runs: ${clock}`)
    await lengthIs('0:02.000')
    await page.getByRole('button', { name: 'Play', exact: true }).waitFor({ timeout: 10000 })
    const [all, sr] = await page.evaluate(() => [window.__taken.flatMap(b => [...b]), window.__rate])
    const loud = all.map((v, i) => Math.abs(v) >= 1e-4 ? i : -1).filter(i => i >= 0), heard = all.slice(loud[0], loud.at(-1))
    let run = 0, longest = 0
    for (const v of heard) { run = Math.abs(v) < 1e-4 ? run + 1 : 0; longest = Math.max(longest, run) }
    assert.ok(heard.length > sr * 1.5, `${chain}: ${(heard.length / sr).toFixed(2)} s of it heard`)
    assert.ok(longest < sr * .005, `${chain}: a gap of ${(longest / sr * 1000).toFixed(0)} ms`)
    await page.keyboard.press('Home')
  }
})

// The ring stops what is on its way, as an editor's Cancel: the script that set it off is undone, the status says so,
// and Record comes back
test('editor: the ring in Record\'s place stops a file still arriving', async () => {
  await open()
  const was = await page.evaluate(() => scriptText())
  await write(`audio('${origin}/slow/test/fixture.wav')`)
  await page.locator('.message', { hasText: /^Decoding/ }).waitFor()
  await page.getByRole('button', { name: 'Stop', exact: true }).click()
  await page.locator('.message', { hasText: /^Stopped: .+ undone, Redo applies it again$/ }).waitFor()
  assert.equal(await page.evaluate(() => scriptText()), was)
  await page.waitForFunction(() => !document.querySelector('.record').inert && document.querySelector('.busy').inert)
})

// Stopped while an edit renders, the worker keeps what it made: the edit undone, the picture and the script agree, and
// the caret steps by the cues as before
test('editor: Stop while an edit renders undoes it, the caret still stepping by the cues', async () => {
  await open()
  await write(bursts)
  await lengthIs('0:02.500')
  await write(`${bursts}.repeat(40).stretch(0.5)`)
  await page.locator('.message', { hasText: /^Applying .*stretch \d+%$/ }).waitFor()
  await page.getByRole('button', { name: 'Stop', exact: true }).click()
  await page.locator('.message', { hasText: /^Stopped: .+ undone/ }).waitFor()
  assert.equal(await page.evaluate(() => scriptText()), bursts)
  await lengthIs('0:02.500')
  const { box, x } = await axis(2.5), step = async () => { await page.keyboard.press(process.platform === 'darwin' ? 'Alt+ArrowRight' : 'Control+ArrowRight'); return +(await page.locator('.time').innerText()).split(':')[1] }
  await page.mouse.click(x(.1), box.y + tall(box) / 3)
  let at = 0
  for (const until = Date.now() + 5000; !(Math.abs(at - .4) < .03) && Date.now() < until; await page.waitForTimeout(200)) { await page.mouse.click(x(.1), box.y + tall(box) / 3); at = await step() }
  assert.ok(Math.abs(at - .4) < .03, `to the next cue: ${at}`)
  assert.ok(Math.abs(await step() - .5) < .03, 'and the one after')
})

// An edit made while a step holds the worker in one pass over its input (decrackle's, 20 s of it here) is not kept
// waiting for it: the worker is replaced, and the new script's output comes in a second or so
test('editor: an edit made while a step holds the engine takes over at once', async () => {
  await open()
  await write(`audio('chime.wav').repeat(20).decrackle()`)
  await page.locator('.message', { hasText: /decrackle [1-9]/ }).waitFor({ timeout: 20000 })
  const t0 = Date.now()
  await write(`audio('chime.wav').gain(-3)`)
  await page.waitForFunction(() => !document.querySelector('.message').textContent && document.querySelector('.readout')?.dataset.of === 'all', null, { timeout: 10000 })
  assert.ok(Date.now() - t0 < 5000, `${Date.now() - t0} ms`)
  await lengthIs('0:08.000')
  // Stopped there, the worker is replaced too: the edit undone, the output shown made again in the new one, the caret
  // stepping by its cues (the chime's fourth strike, 1.81 s, after 1.5 s)
  await write(`audio('chime.wav').gain(-3).repeat(20).decrackle()`)
  await page.locator('.message', { hasText: /decrackle [1-9]/ }).waitFor({ timeout: 20000 })
  await page.getByRole('button', { name: 'Stop', exact: true }).click()
  await page.locator('.message', { hasText: /^Stopped: .+ undone/ }).waitFor()
  assert.equal(await page.evaluate(() => scriptText()), `audio('chime.wav').gain(-3)`)
  const { box, x } = await axis(8), step = async () => { await page.keyboard.press(process.platform === 'darwin' ? 'Alt+ArrowRight' : 'Control+ArrowRight'); return +(await page.locator('.time').innerText()).split(':')[1] }
  let at = 0
  for (const until = Date.now() + 8000; !(at > 1.5 && at < 2.5) && Date.now() < until; await page.waitForTimeout(200)) { await page.mouse.click(x(1.5), box.y + box.height / 3); at = await step() }
  assert.ok(at > 1.5 && at < 2.5, `to the next cue: ${at}`)
})

// A sound that fails to open says so beside the time; choosing another clears that at once, before it has loaded
test('editor: a file that will not open says so, until another sound is chosen', async () => {
  await open()
  await write(`audio('nowhere.wav')`)
  await page.locator('.message.problem', { hasText: 'nowhere.wav is not open' }).waitFor()
  await menu('File', 'Sample or generate', 'handpan.wav')
  assert.equal(await page.locator('.message.problem').count(), 0)
  await wholeLevels().waitFor()
})

// A sound between pauses, as a word between spaces: bursts of a tone at 0–0.4 s and 0.5–0.9 s, a long pause, more
// at 1.5–1.9 s and 2–2.4 s. Pauses are read in blocks of 1024 samples (23 ms at 44.1 kHz), so edges land within one.
const bursts = `audio.from(t => (t < .4 || (t > .5 && t < .9) || (t > 1.5 && t < 1.9) || (t > 2 && t < 2.4)) * .5 * Math.sin(2 * Math.PI * 440 * t), { duration: 2.5 })`
// Their cues are the pauses' edges, each burst's start and end, as a text's words are found.
// A bell's ring is its strike's till it falls within 0.02 of zero, where it ends, and a double-click on its tail takes it
// from its strike to there: no tail hanging on over the quiet to the next. The page's chime rings from its fourth strike
// (1.81 s once trimmed) down into the quiet before its fifth (3.31 s), 60 ms of it at least.
test('editor: a double-click on a ringing tail selects from its strike to where it falls quiet', async () => {
  await open()
  const { box, x } = await axis(6.525), seconds = t => t.split(':').reduce((m, s) => m * 60 + +s, 0)
  let range = []
  for (const until = Date.now() + 8000; Date.now() < until && !(range[1] < 6); await page.waitForTimeout(200)) {
    await page.mouse.dblclick(x(2.8), box.y + tall(box) * .3)
    range = (await selected()).split('–').map(seconds)
  }
  assert.ok(Math.abs(range[0] - 1.81) < .02 && range[1] > 3 && range[1] < 3.25, range.join('–'))
})

test('editor: a double-click selects the fragment between its cues, or the pause it is in; a triple-click the sound between its pauses; ⌥ and ⌘ arrows step by them', async () => {
  await open()
  await write(bursts)
  await lengthIs('0:02.500')
  const { box, x } = await axis(2.5), y = box.y + tall(box) / 3
  const range = async () => (await selected()).split('–').map(t => +t.split(':')[1])
  const near =([a, b], [p, q]) => Math.abs(a - p) < .03 && Math.abs(b - q) < .03
  // its cues, each burst's start (where its attack starts) and end (where the quiet begins, within a block)
  // (the chime's stay until the new output's come)
  const edges = [.4, .5, .9, 1.5, 1.9, 2, 2.4], found = at => at.length === edges.length && at.every((t, i) => t - edges[i] > -.005 && t - edges[i] < .03)
  let at = []
  const w = await spans(box)
  for (const until = Date.now() + 8000; !found(at) && Date.now() < until; await page.waitForTimeout(200)) at = (await handles()).map(h => h / w * 2.5)
  assert.ok(found(at), JSON.stringify(at))
  // the sound alone, from its start to its end, as a word between its spaces
  await page.mouse.dblclick(x(.2), y)
  assert.ok(near(await range(), [0, .4]), String(await range()))
  await page.mouse.dblclick(x(1.7), y)
  assert.ok(near(await range(), [1.5, 1.9]), String(await range()))
  // the sound between its pauses: here, where the cues are the pauses' edges, the same
  await page.mouse.click(x(.6), y, { clickCount: 3 })
  assert.ok(near(await range(), [.5, .9]), String(await range()))
  // in a pause, the pause
  await page.mouse.dblclick(x(1.2), y)
  assert.ok(near(await range(), [.9, 1.5]), String(await range()))
  await page.mouse.click(x(.1), y)
  const step = async key => { await page.keyboard.press(key); return +(await page.locator('.time').innerText()).split(':')[1] }
  const mac = process.platform === 'darwin'
  assert.ok(Math.abs(await step(mac ? 'Alt+ArrowRight' : 'Control+ArrowRight') - .4) < .03, 'to the next cue, the end of the sound')
  assert.ok(Math.abs(await step(mac ? 'Alt+ArrowRight' : 'Control+ArrowRight') - .5) < .03, 'over the pause, to the start of the next')
  assert.ok(Math.abs(await step(mac ? 'Meta+ArrowRight' : 'Control+ArrowDown') - .9) < .03, 'to the end of the sound')
  assert.ok(Math.abs(await step(mac ? 'Meta+ArrowRight' : 'Control+ArrowDown') - 1.5) < .03, 'over the pause, to the next sound')
  const back = await step(mac ? 'Meta+ArrowLeft' : 'Control+ArrowUp')
  assert.ok(Math.abs(back - .9) < .03, `back to the end of the sound before (${back})`)
  // to the end and the start, as a text's ⌘ ↓ ↑ (Home and End anywhere)
  assert.equal(await step(mac ? 'Meta+ArrowDown' : 'End'), 2.5)
  assert.equal(await step(mac ? 'Meta+ArrowUp' : 'Home'), 0)
  // the long pause deleted: the cues after it move back with the audio at once, never where they were a moment before,
  // whether its output has come or not (the times the caret steps to, the sound's end not one of them)
  await page.mouse.dblclick(x(1.2), y)
  const [p, q] = await range()
  await page.keyboard.press('Delete')
  const moved = [], now = async () => +(await page.locator('.time').innerText()).split(':')[1]
  await page.keyboard.press('Home')
  for (let t = 0; ;) { await page.keyboard.press(mac ? 'Alt+ArrowRight' : 'Control+ArrowRight'); const next = await now(); if (next <= t || next > 2.5 - (q - p) - .03) break; moved.push(t = next) }
  const after = at.filter(t => t > q + .01)
  assert.ok(!moved.some(t => after.some(e => Math.abs(t - e) < .01)), `none left behind: ${JSON.stringify(moved)}`)
  // (the caret steps over two cues within 3 px as one: the pause's end, moved 12 ms after the sound's end before it)
  assert.ok(after.every(e => moved.some(t => Math.abs(t - (e - (q - p))) < .015)), JSON.stringify([moved, after, p, q]))
})

// A tone struck every half second over a held one, never quiet: its cues are its strikes, its one sound all of it. A
// double-click takes one strike to the next; a triple-click, the sound between its pauses, all of it.
const struck = `audio.from(t => Math.sin(2 * Math.PI * 440 * t) * (.2 + .8 * Math.exp(-(t % 0.5) * 20)), { duration: 2 })`
test('editor: on strikes with no pause between them, a double-click takes one strike to the next, a triple-click the whole sound', async () => {
  await open()
  await write(struck)
  await lengthIs('0:02.000')
  const { box, x } = await axis(2), y = box.y + tall(box) / 3
  const range = async () => (await selected()).split('–').map(t => +t.split(':')[1])
  let r = []
  for (const until = Date.now() + 8000; Date.now() < until && !(Math.abs(r[0] - .5) < .02 && Math.abs(r[1] - 1) < .02); await page.waitForTimeout(200)) {
    await page.mouse.dblclick(x(.7), y)
    r = await range()
  }
  assert.ok(Math.abs(r[0] - .5) < .02 && Math.abs(r[1] - 1) < .02, `one strike to the next: ${r}`)
  await page.mouse.click(x(.7), y, { clickCount: 3 })
  assert.deepEqual(await range(), [0, 2], 'the whole sound')
})

// A selection's grip, past its end three quarters down each lane, sets its length: trimmed (cut back, the seam
// crossfaded as a delete's, or silence added), stretched with the pitch kept, or sped with the pitch following, a click
// on it turning it to the next; a stretch just made changes with it. Its pill sets its level; the first of the tools at
// the lanes' foot, its pitch. Each is one step.
test('editor: a selection\'s grip trims, stretches or speeds it, its pill sets its level and its pitch tool its pitch', async () => {
  const { box, x, y } = await chime(), lh = (tall(box) - LANES) / 2
  const select = async (a, b) => { await page.mouse.click(x(7.5), y); await drag([x(a), y], [x(b) - x(a), 0]) }
  const last = async pattern => { await page.waitForFunction(p => new RegExp(p).test(scriptText()), pattern.source); return code() }
  const undo = async () => {
    for (let i = 0; i < 3 && await code() !== "audio('chime.wav')"; i++) { await page.keyboard.press('ControlOrMeta+Z'); await page.waitForTimeout(150) }
    await page.waitForFunction(() => scriptText() === "audio('chime.wav')")
    await lengthIs('0:08.000')
  }
  const grip = b => grab([[x(b) + 8, box.y + lh * 3 / 4]], /^url\(|ew-resize/), pill = (a, b) => grab([[(x(a) + x(b)) / 2, box.y + 4]], 'ns-resize')
  await select(1, 2)
  await drag(await grip(2), [x(1.5) - x(1), 0])
  assert.match(await last(/\.stretch\(/), /\.stretch\(1\.5, \{ at: 1, d: 1 \}\)$/)
  await lengthIs('0:08.500')
  await turn(await grip(2.5), 'grip', 'speed')
  assert.match(await last(/\.speed\(/), /\.speed\(0\.66667, \{ at: 1, d: 1 \}\)$/)
  await undo()
  await select(1, 2)
  await turn(await grip(2), 'grip', 'trim')
  await drag(await grip(2), [x(1.5) - x(2), 0])
  assert.match(await last(/\.remove\(/), /\.remove\(\{ at: 1\.5, d: 0\.5, xfade: 0\.01 \}\)$/)
  await lengthIs('0:07.500')
  assert.equal(await selected(), '0:01.000–0:01.500')
  await undo()
  await select(1, 2)
  await drag(await grip(2), [x(2.5) - x(2), 0])
  assert.match(await last(/\.insert\(/), /\.insert\(0\.5, \{ at: 2, xfade: 0\.01 \}\)$/)
  await lengthIs('0:08.500')
  await undo()
  await select(1, 2)
  await drag(await pill(1, 2), [0, -box.height / 10])
  const text = await last(/\.gain\(/), [, v] = text.match(/\.gain\(\{ t: \[1, 1\.005, 1\.995, 2\], v: \[0, ([\d.]+), [\d.]+, 0\] \}\)$/) || [, text]
  assert.ok(+v > 0, v)
  await undo()
  await select(1, 2)
  // the tools inside its foot, side by side from its middle (view.js BOX, 16 px, 2 apart): pitch, intonation, formants
  await drag(await grab([[(x(1) + x(2)) / 2 - 18, box.y + tall(box) - 8]], 'ns-resize'), [0, -box.height / 10])
  await last(/\.pitch\(/)
})

// Several ranges, as a text editor's several selections: the next pause like the one selected joins it (⌘D), and an
// edit acts on each, in one step
test('editor: pauses selected together are shortened or deleted together, in one step', async () => {
  await open()
  await write(bursts)
  await lengthIs('0:02.500')
  const { box, x } = await axis(2.5), y = box.y + tall(box) / 3
  await page.mouse.dblclick(x(.45), y)
  await page.keyboard.press('ControlOrMeta+D')
  await page.keyboard.press('ControlOrMeta+D')
  assert.match(await page.locator('.clock').evaluate(tipOf), /^Selected 3 ranges: 0:00\.\d+, \d+ samples/)
  await palette('Delete all 3')
  // the pauses at 0.4–0.5, 0.9–1.5 and 1.9–2 s, from the last back, so each time holds
  await page.waitForFunction(() => (scriptText().match(/\.remove\(/g) || []).length === 3)
  const ats = [...(await code()).matchAll(/remove\(\{ at: ([\d.]+)/g)].map(m => +m[1])
  assert.ok(ats[0] > ats[1] && ats[1] > ats[2] && Math.abs(ats[2] - .4) < .03, JSON.stringify(ats))
  await page.waitForFunction(() => +(e => e.title || e.dataset.tip || '')(document.querySelector('.source')).split(':').pop() < 1.8)
  await page.keyboard.press('ControlOrMeta+Z')
  await page.waitForFunction(() => !scriptText().includes('.remove('))
})

// M puts a marker at the caret, a mark() at the chain's end; its triangle, in the strip under the lanes, drags to move
// it, a double-click names it (its mark()'s label), its right-click menu takes it away; File exports the parts between
// markers, a file each
test('editor: markers: M at the caret, its triangle in the strip dragged, named, taken away, the parts between them exported', async () => {
  await open()
  await write(`audio('chime.wav')`)
  await lengthIs('0:08.000')
  const { box, x } = await axis(8), y = box.y + tall(box) * .3, strip = box.y + tall(box) + FOOT / 2
  // the times the script gets: the caret's, to the zoom's step
  const marks = async n => { await page.waitForFunction(n => (scriptText().match(/\.mark\(/g) || []).length === n, n); return [...(await code()).matchAll(/\.mark\(([\d.]+)/g)].map(m => +m[1]) }
  await page.mouse.click(x(2), y)
  await page.keyboard.press('m')
  await page.mouse.click(x(5), y)
  await page.keyboard.press('m')
  const [a, b] = await marks(2)
  assert.ok(Math.abs(a - 2) < .05 && Math.abs(b - 5) < .05, `${a} ${b}`)
  // its triangle shows as soon as it is made, before the output that has it
  await drag(await grab([[x(a), strip]], 'ew-resize'), [x(3) - x(2), 0])
  await page.waitForFunction(a => +(scriptText().match(/\.mark\(([\d.]+)\)/)?.[1]) > a + .9, a)
  // the menu as the output it opens over: opened again till that output has come, with its markers
  for (const until = Date.now() + 8000; Date.now() < until; await page.keyboard.press('Escape')) {
    await page.locator('.menubar-item', { hasText: /^File$/ }).click()
    await menuRow('Export as').click()
    if (await menuRow('Each part between markers').getAttribute('aria-disabled') !== 'true') break
  }
  const downloads = []
  page.on('download', d => downloads.push(d.suggestedFilename()))
  await menuRow('Each part between markers').click()
  await page.waitForFunction(() => !document.querySelector('.export-button').textContent.includes('Exporting'))
  await page.waitForTimeout(300)
  assert.deepEqual(downloads.sort(), ['chime-edited-01.wav', 'chime-edited-02.wav', 'chime-edited-03.wav'])
  // named where its name goes
  await page.mouse.dblclick(...await grab([[x(b), strip]], 'ew-resize'))
  await page.keyboard.type('Outro')
  await page.keyboard.press('Enter')
  await page.waitForFunction(() => /\.mark\([\d.]+, 'Outro'\)/.test(scriptText()))
  // a name cleared is no name: the label goes from its mark()
  await page.mouse.dblclick(...await grab([[x(b), strip]], 'ew-resize'))
  await page.keyboard.press('Backspace')
  await page.keyboard.press('Enter')
  await page.waitForFunction(() => /\.mark\([\d.]+\)$/.test(scriptText().trim()) && !scriptText().includes('Outro'))
  await page.mouse.dblclick(...await grab([[x(b), strip]], 'ew-resize'))
  await page.keyboard.type('Outro')
  await page.keyboard.press('Enter')
  await page.waitForFunction(() => /\.mark\([\d.]+, 'Outro'\)/.test(scriptText()))
  // taken away from its own menu
  await page.mouse.click(...await grab([[x(b), strip]], 'ew-resize'), { button: 'right' })
  await page.locator('.menubar-menu .menu-row', { has: page.locator('.menu-label', { hasText: /^Delete the marker$/ }) }).click()
  assert.equal((await marks(1)).length, 1)
})

// M over a selection marks it, a range: mark({ at, d }), a region in the file. A marker made asks for its name at once,
// where its name goes (not while it plays, where M marks moment after moment); a click on the name asks again, as a field's
// text is written. A range pressed in its strip selects it.
test('editor: markers: M over the selection a range, named as it is made, renamed from its name, pressed in its strip', async () => {
  await open()
  await noCues()
  await write(`audio('chime.wav')`)
  await lengthIs('0:08.000')
  // in the strip under the lanes, a moment ▲ its name, a range ◢ its name ◣
  const { box, x } = await axis(8), y = box.y + tall(box) * .3, strip = box.y + tall(box) + FOOT / 2
  const named = () => page.evaluate(() => document.activeElement.className === 'marker-name')
  // a moment, named as it is made
  await page.mouse.click(x(1), y)
  await page.keyboard.press('m')
  assert.ok(await named(), 'its name asked for')
  await page.keyboard.type('Intro')
  await page.keyboard.press('Enter')
  await page.waitForFunction(() => /\.mark\(1, 'Intro'\)/.test(scriptText()))
  // a range, from the selection
  await drag([x(3), y], [x(5) - x(3), 0])
  assert.equal(await selected(), '0:03.000–0:05.000')
  await page.keyboard.press('m')
  assert.ok(await named(), 'its name asked for')
  await page.keyboard.type('Chorus')
  await page.keyboard.press('Enter')
  await page.waitForFunction(() => /\.mark\(\{ at: 3, d: 2 \}, 'Chorus'\)/.test(scriptText()))
  // its name clicked: named anew
  await page.mouse.click(x(7.5), y)
  await page.mouse.click(x(1) + 20, strip)
  assert.ok(await named(), 'a click on its name')
  await page.keyboard.press('ControlOrMeta+A')
  await page.keyboard.type('Start')
  await page.keyboard.press('Enter')
  await page.waitForFunction(() => /\.mark\(1, 'Start'\)/.test(scriptText()) && scriptText().includes("'Chorus'"))
  // pressed in its strip: its audio selected at once, as the takes' place selects theirs; dragged on, nothing moves
  await page.mouse.click(x(7.5), y)
  await page.mouse.move(x(4.5), strip)
  await page.mouse.down()
  await page.locator('.clock').evaluate(el => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))))
  assert.equal(await selected(), '0:03.000–0:05.000', 'selected before it is let go')
  await page.mouse.move(x(5.5), strip, { steps: 5 })
  await page.mouse.up()
  await page.waitForFunction(() => /\.mark\(\{ at: 3, d: 2 \}, 'Chorus'\)/.test(scriptText()))
  assert.equal(await selected(), '0:03.000–0:05.000')
  // its name in the strip clicked: named anew in place, the field within the strip, the selection's handles gone while it is
  // written (its fade's corner no grip to the pointer)
  await page.mouse.click(x(3) + 20, strip)
  assert.ok(await named(), 'a click on a range\'s name')
  const field = await page.locator('.marker-name').boundingBox(), lane = box.y + tall(box)
  assert.ok(field.y >= lane - 4 && field.y + field.height <= lane + FOOT, `its field by its strip: ${field.y - lane}, ${field.height}`)
  await page.mouse.move(x(3) + 9, box.y + 9)
  assert.notEqual(await page.locator('.plot').evaluate(el => el.style.cursor), 'ew-resize', 'no handle while it is named')
  await page.keyboard.press('Escape')
  assert.match(await code(), /\.mark\(\{ at: 3, d: 2 \}, 'Chorus'\)/)
  // to the page, the moments and the ranges in one list, in time order
  const [r] = await engine([`audio('x.wav').mark({ at: 0.5, d: 0.25 }, 'Chorus').mark(0.75).mark(0.25, 'In')`], { 'x.wav': [sine(1, 440)] })
  assert.deepEqual(r.output.markers, [{ time: 0.25, label: 'In' }, { time: 0.5, duration: 0.25, label: 'Chorus' }, { time: 0.75, label: '' }])
})

// A name written while the output that has its marker is still on its way shows at once, and stays: that output, of
// the script before the name, leaves the markers the view drew ahead of it as they are
test('editor: markers: a marker named before its output comes keeps its name through that output', async () => {
  await open()
  await write(`audio('chime.wav').stretch(2)`)
  await lengthIs('0:16.000')
  const { box, x } = await axis(16), y = box.y + tall(box) * .3, row = box.y + tall(box) + FOOT / 2
  await page.mouse.click(x(3), y)
  await page.keyboard.press('m')
  // its run under way, the name written
  await page.waitForTimeout(400)
  await page.keyboard.type('Hello')
  await page.keyboard.press('Enter')
  // the name is there from the next frame, where a press takes hold of it (a pointer), till the output with it comes
  // and after
  await page.waitForTimeout(50)
  const seen = []
  for (const until = Date.now() + 4000; Date.now() < until; await page.waitForTimeout(100)) {
    await page.mouse.move(x(3) + 22 + seen.length % 2, row)
    seen.push(await page.locator('.plot').evaluate(el => el.style.cursor))
  }
  assert.ok(seen.every(c => c === 'pointer'), JSON.stringify(seen))
  assert.match(await code(), /\.mark\([\d.]+, 'Hello'\)/)
})

// A marker's line, a moment's or a range's end, points as it is neared (a hand, lit) and takes a press onto it: the
// caret goes to the marker's time, not to the pixel pressed; with snapping off, the pixel's
test('editor: markers: a press by a marker line puts the caret on it', async () => {
  await open()
  await write(`audio('chime.wav').mark(2).mark({ at: 5, d: 1 })`)
  await lengthIs('0:08.000')
  const { box, x } = await axis(8), y = box.y + tall(box) * .3
  const caret = async () => +(await page.locator('.time').innerText()).split(':')[1]
  for (const t of [2, 5, 6]) {
    await grab([[x(t) + 4, y]], 'pointer')
    await page.mouse.click(x(t) + 4, y)
    assert.equal(await caret(), t)
  }
  await menu('View', 'Snap to cues and markers')
  await page.mouse.move(x(2) + 4, y)
  assert.notEqual(await page.locator('.plot').evaluate(el => el.style.cursor), 'pointer')
  await page.mouse.click(x(2) + 4, y)
  assert.ok(await caret() > 2, 'the pixel pressed')
})

// A marker in silence (here padding past the sound's end) stays where it is put, at its distance from the sound nearest
// it (fn/meta.js), not drawn back onto the sound's last sample; its triangle drags on into the silence, to the end at
// most
test('editor: markers: one in silence past the sound stays there, and drags on within it', async () => {
  await open()
  await write(`audio('chime.wav').pad(0, 2).mark(9)`)
  await lengthIs('0:10.000')
  const { box, x } = await axis(10), y = box.y + tall(box) * .3, strip = box.y + tall(box) + FOOT / 2
  const caret = async () => +(await page.locator('.time').innerText()).split(':')[1]
  await page.mouse.click(...await grab([[x(9) + 4, y]], 'pointer'))
  assert.equal(await caret(), 9, 'its line where it was put, from the output')
  await drag(await grab([[x(9), strip]], 'ew-resize'), [x(9.5) - x(9), 0])
  await page.waitForFunction(() => Math.abs(+(scriptText().match(/\.mark\(([\d.]+)\)/)?.[1]) - 9.5) < .05)
  // dragged past the end, to the end
  await drag(await grab([[x(9.5), strip]], 'ew-resize'), [x(11) - x(9.5), 0])
  await page.waitForFunction(() => +(scriptText().match(/\.mark\(([\d.]+)\)/)?.[1]) === 10)
  await write(`audio('chime.wav').pad(0, 2).mark(9.75)`)
  await page.mouse.click(...await grab([[x(9.75) + 4, y]], 'pointer'))
  assert.equal(await caret(), 9.75)
})

// A press on a marker's triangle chooses it, and Delete takes it away, not the audio. A press anywhere else, or Escape,
// and Delete is what it was. A range's press between its triangles selects its audio and nothing more: Delete takes the
// audio, its menu the marker
test('editor: markers: Delete takes away the marker whose triangle was pressed', async () => {
  await open()
  await noCues()
  await write(`audio('chime.wav').mark(2).mark({ at: 5, d: 1 })`)
  await lengthIs('0:08.000')
  // in the strip under the lanes, a moment ▲, a range ◢ ◣
  const { box, x } = await axis(8), y = box.y + tall(box) * .3, strip = box.y + tall(box) + FOOT / 2
  // chosen, then let go of: Delete with nothing selected does nothing
  await page.mouse.click(...await grab([[x(2), strip]], 'ew-resize'))
  await page.keyboard.press('Escape')
  await page.keyboard.press('Delete')
  await page.waitForTimeout(300)
  assert.equal(await code(), `audio('chime.wav').mark(2).mark({ at: 5, d: 1 })`)
  await page.mouse.click(x(2), strip)
  await page.mouse.click(x(4), y)
  await page.keyboard.press('Delete')
  await page.waitForTimeout(300)
  assert.equal(await code(), `audio('chime.wav').mark(2).mark({ at: 5, d: 1 })`)
  // a moment's
  await page.mouse.click(x(2), strip)
  await page.keyboard.press('Delete')
  await page.waitForFunction(() => scriptText() === `audio('chime.wav').mark({ at: 5, d: 1 })`)
  // a range's, pressed in its strip: its audio selected, not chosen; Delete takes the audio, the marker staying
  await page.mouse.click(x(5.5), strip)
  assert.equal(await selected(), '0:05.000–0:06.000')
  await page.keyboard.press('Backspace')
  await lengthIs('0:07.000')
  assert.match(await code(), /\.mark\(\{ at: 5, d: 1 \}\)/)
  // its menu takes the marker away, the audio as it is
  await write(`audio('chime.wav').mark({ at: 5, d: 1 })`)
  await lengthIs('0:08.000')
  await page.mouse.click(x(5.5), strip, { button: 'right' })
  await contextRow('Delete the marker').click()
  await page.waitForFunction(() => scriptText() === `audio('chime.wav')`)
  await lengthIs('0:08.000')
  // a range's triangle pressed, the caret at that end, the range chosen: Delete takes the marker, the audio as it is
  await write(`audio('chime.wav').mark({ at: 5, d: 1 })`)
  await page.mouse.click(...await grab([[x(6) + 3, strip]], 'ew-resize'))
  assert.equal(await page.locator('.time').innerText(), '0:06.000', 'the caret at its end')
  // chosen, its triangles lit, not in the accent (the hints' alone)
  await page.mouse.move(box.x + 5, box.y + box.height - 8)
  const orange = await pixels(`let n = 0; for (let y = arg.y; y < arg.y + 9; y++) for (let x = arg.px - 6; x < arg.px + 6; x++) { const i = (y * w + x) * 4; if (d[i] - d[i + 2] > 30) n++ } return n`, { px: Math.round(x(6) - box.x), y: Math.round(tall(box)) })
  assert.equal(orange, 0, 'chosen, nothing of it in the accent')
  await page.keyboard.press('Delete')
  await page.waitForFunction(() => scriptText() === `audio('chime.wav')`)
  await lengthIs('0:08.000')
})

// A range's triangles in its strip drag its ends, as a moment's drags it: its start, its end staying; its end, its
// length; as far as the other, let go there one moment. A moment is one triangle there, ▲ on its line, nothing of it at
// the lanes' top nor down them, but the caret's ghost where a press would put it as its triangle is pointed at; held
// Alt, its triangle dragged apart into a range from it, either way, as Photoshop's split slider's is
test('editor: markers: a range\'s triangles drag its ends; a moment is one triangle in the strip, Alt pulls it apart', async () => {
  await open()
  await noCues()
  await write(`audio('chime.wav').mark({ at: 2, d: 2 }).mark(6)`)
  await lengthIs('0:08.000')
  const { box, x } = await axis(8), lane = Math.round(tall(box)), strip = box.y + lane + FOOT / 2, px = t => Math.round(x(t) - box.x)
  // in columns [a, b) and rows [y0, y1), the pixels unlike the ground there (its column at 7.5 s, where nothing is)
  const marked = ([a, b], [y0, y1]) => pixels(`let n = 0; for (let y = arg.y0; y < arg.y1; y++) { const g = (y * w + arg.g) * 4; for (let x = arg.a; x < arg.b; x++) { const i = (y * w + x) * 4; if (Math.abs(d[i] - d[g]) + Math.abs(d[i + 1] - d[g + 1]) + Math.abs(d[i + 2] - d[g + 2]) > 45) n++ } } return n`, { a, b, y0, y1, g: px(7.5) })
  await page.mouse.move(box.x + 5, box.y + box.height - 8)
  assert.ok(await marked([px(6) - 4, px(6)], [lane + 4, lane + 9]) > 3 && await marked([px(6) + 1, px(6) + 5], [lane + 4, lane + 9]) > 3, 'a moment ▲, either side of its line')
  assert.equal(await marked([px(6) + 2, px(6) + 8], [0, 7]), 0, 'no flag at the lanes\' top')
  // the range's ◢ ends with the caret's pixel at its start, as ◣ starts with the caret's at its end: a triangle clicked,
  // the caret's column (the lanes' top rows) the last of ◢'s, the first of ◣'s
  const column = async t => { for (let d = -3; d <= 3; d++) if (await marked([px(t) + d, px(t) + d + 1], [2, 12]) >= 8) return px(t) + d; return null }
  for (const [t, edge, out] of [[2, -3, 1], [4, 3, -1]]) {
    await page.mouse.click(x(t) + edge, strip)
    await page.mouse.move(box.x + 5, box.y + box.height - 8)
    const c = await column(t)
    assert.ok(c != null && await marked([c, c + 1], [lane + 5, lane + 9]) > 0 && await marked([c + out, c + out + 1], [lane + 1, lane + 9]) === 0, `the caret's pixel ${c} its triangle's edge at ${t} s`)
  }
  await page.keyboard.press('Escape')
  // (the lanes' top rows, over the sound's quiet edge)
  assert.equal(await marked([px(6), px(6) + 1], [2, 22]), 0, 'no line down the lanes')
  await page.mouse.move(x(6), strip)
  let ghost = 0
  for (const until = Date.now() + 2000; ghost < 20 && Date.now() < until; await page.waitForTimeout(100)) ghost = await marked([px(6), px(6) + 1], [2, 22])
  assert.ok(ghost >= 20, `pointed at, the caret's ghost down the lanes: ${ghost} rows`)
  await page.mouse.move(box.x + 5, box.y + box.height - 8)
  // its end dragged on a second: 3 s long
  await drag(await grab([[x(4) + 3, strip]], 'ew-resize'), [x(5) - x(4), 0])
  await page.waitForFunction(() => /\.mark\(\{ at: 2, d: 3 \}\)/.test(scriptText()))
  // its start dragged on a second: from 3 s, its end where it was
  await drag(await grab([[x(2) - 3, strip]], 'ew-resize'), [x(3) - x(2), 0])
  await page.waitForFunction(() => /\.mark\(\{ at: 3, d: 2 \}\)/.test(scriptText()))
  // its start dragged past its end: held at it, and let go there, one moment at its end
  await drag(await grab([[x(3) - 3, strip]], 'ew-resize'), [x(7) - x(3), 0])
  await page.waitForFunction(() => /\.mark\(5\)\.mark\(6\)$/.test(scriptText()))
  // a moment, held Alt, dragged half a second back: a range from there to it, its name kept; another, on a second
  await write(`audio('chime.wav').mark(6.5, 'Bell')`)
  const split = async (t, to) => { const at = await grab([[x(t), strip]], 'ew-resize'); await page.keyboard.down('Alt'); await drag(at, [x(to) - x(t), 0]); await page.keyboard.up('Alt') }
  await split(6.5, 6)
  await page.waitForFunction(() => /\.mark\(\{ at: 6, d: 0\.5 \}, 'Bell'\)/.test(scriptText()))
  await write(`audio('chime.wav').mark(5, 'Bell')`)
  await split(5, 6)
  await page.waitForFunction(() => /\.mark\(\{ at: 5, d: 1 \}, 'Bell'\)/.test(scriptText()))
  // its end dragged back onto its start (within a few px), let go: one moment there again
  await drag(await grab([[x(6) + 3, strip]], 'ew-resize'), [x(5) + 2 - x(6), 0])
  await page.waitForFunction(() => /\.mark\(5, 'Bell'\)/.test(scriptText()))
})

// A range pointed at in its strip shows a fork (⌥) at its end inside it, where takes' numbers stand: pressed, takes
// start there, an empty take over it, turned off, the sound heard as it was, its place selected for R to record into.
// Its number pressed hears it; pressed again, turned off, the sound as it was again. None on a range with takes
test('editor: markers: a named range\'s fork starts takes there; the take heard, pressed again, off', async () => {
  await open()
  await noCues()
  await write(`audio('chime.wav').mark({ at: 3, d: 2 }, 'Chorus').mark({ at: 6, d: 1 })`)
  await lengthIs('0:08.000')
  const { box, x } = await axis(8), strip = box.y + tall(box) + FOOT / 2, fork = page.locator('.plot .fork')
  assert.ok(await fork.isHidden(), 'none till it is pointed at')
  // a range with no name has it too
  await page.mouse.move(x(6.5), strip)
  await fork.waitFor()
  assert.equal(await fork.getAttribute('title'), 'Another take')
  await page.mouse.move(x(4), strip)
  await fork.waitFor()
  const at = await fork.boundingBox()
  assert.ok(Math.abs(at.x + at.width - x(5) + 2) < 2, `at its end, inside: ${at.x + at.width - x(5)}`)
  await fork.click()
  await page.waitForFunction(() => scriptText().endsWith(`// .write(audio.from(2), { at: 3 })`))
  assert.equal(await selected(), '0:03.000–0:05.000')
  const chip = page.locator('.plot .takes:not([hidden])')
  await chip.waitFor()
  const numbers = () => chip.locator('button').evaluateAll(b => b.map(x => [x.value === 'add' ? 'fork' : x.textContent, x.getAttribute('aria-pressed') ?? x.getAttribute('aria-disabled')]))
  assert.deepEqual(await numbers(), [['1', 'false'], ['fork', 'true']])
  await page.mouse.move(x(4), strip)
  await page.waitForTimeout(200)
  assert.ok(await fork.isHidden(), 'no fork where takes are')
  await chip.locator('button[value="0"]').click()
  await page.waitForFunction(() => scriptText().endsWith(`\n  .write(audio.from(2), { at: 3 })`))
  await chip.locator('button[value="0"]').click()
  await page.waitForFunction(() => scriptText().endsWith(`// .write(audio.from(2), { at: 3 })`))
  // its place selected (pressed in the strip), Record records into the empty take, heard from then on, stopping at the
  // place's end by itself
  await page.mouse.click(x(4.5), strip)
  assert.equal(await selected(), '0:03.000–0:05.000')
  await page.getByRole('button', { name: 'Record', exact: true }).click()
  await page.getByRole('button', { name: 'Record', exact: true }).waitFor({ timeout: 15000 })
  await page.waitForFunction(() => /\n {2}\.write\(audio\('take(-\d)?\.wav'\), \{ at: 3[^)]*\)$/.test(scriptText()) && !scriptText().includes('audio.from(2)'))
})

// A marker's triangle dragged goes onto a cue it comes within a few px of, as a selection's edge does, not onto where
// the marker was: a range's end, its length to the hit; 5 px past it, where it was let go
test('editor: markers: a range\'s end dragged by its triangle snaps to a cue near it', async () => {
  await open()
  await write(`${hits}.mark({ at: 0.6, d: 0.2 })`)
  await lengthIs('0:02.000')
  const { box, x } = await axis(2), strip = box.y + tall(box) + FOOT / 2
  let cues = []
  for (const until = Date.now() + 8000; cues.length < 3 && Date.now() < until; await page.waitForTimeout(200)) cues = await handles()
  const cue = box.x + cues.find(h => Math.abs(h - (x(1) - box.x)) < 20)
  const end = async was => { await page.waitForFunction(was => !scriptText().includes(was), was); const [, a, d] = (await code()).match(/\.mark\(\{ at: ([\d.]+), d: ([\d.]+) \}\)/); return +a + +d }
  // 2 px past the cue at 1 s, where the hit starts: on it
  await drag(await grab([[x(.8) + 3, strip]], 'ew-resize'), [cue + 2 - x(.8), 0])
  const on = await end('d: 0.2 }')
  assert.ok(Math.abs(on - 1) < .012, `on the cue at 1 s: ${on}`)
  // 5 px past it, where it was let go
  await drag(await grab([[x(on) + 3, strip]], 'ew-resize'), [5, 0])
  const past = await end(`d: ${+(on - .6).toFixed(6)} }`)
  assert.ok(past - on > .005, `5 px past it, where it was put: ${past}, the cue ${on}`)
})

// A selection's top corners, each drawn as the fade it makes, fade it: inward, in from its start or out to its end;
// outward, past its edge, the audio out there goes, crossfading into the selection (fn/crossfade.js). A click on one
// turns the curve to the next: the fade just made takes it, and so do the next.
test('editor: a selection fades from its top corners: inward from its edge, outward a crossfade, on the curve turned to', async () => {
  await open()
  await noCues()
  await write(`audio('chime.wav')`)
  await lengthIs('0:08.000')
  const { box, x } = await axis(8), y = box.y + tall(box) * .3, dot = box.y + 9
  const select = async () => { await page.mouse.click(x(7.5), y); await page.mouse.move(x(2.2), y); await page.mouse.down(); await page.mouse.move(x(4.2), y, { steps: 4 }); await page.mouse.up() }
  await select()
  await drag(await grab([[x(2.2) + 9, dot]], 'ew-resize'), [x(2.7) - x(2.2), 0])
  await page.waitForFunction(() => /\.fade\(0\.5, \{ at: 2\.2 \}\)$/.test(scriptText()))
  // a click on the corner: the next curve, which the fade just made takes, each click one step
  await turn([x(2.2) + 3, box.y + 3], 'curve', 'cos')
  await page.waitForFunction(() => /\.fade\(0\.5, \{ at: 2\.2, curve: 'cos' \}\)$/.test(scriptText()))
  for (let i = 0; i < 4; i++) await page.keyboard.press('ControlOrMeta+Z')
  await page.waitForFunction(() => !scriptText().includes('fade'))
  await select()
  await drag(await grab([[x(4.2) - 9, dot]], 'ew-resize'), [x(3.7) - x(4.2), 0])
  await page.waitForFunction(() => /\.fade\(-0\.5, \{ at: 3\.7, curve: 'cos' \}\)$/.test(scriptText()))
  // out past the start: the 0.4 s before it go, crossfading into it; the selection moves back with its audio
  await select()
  await drag(await grab([[x(2.2) + 9, dot]], 'ew-resize'), [x(1.8) - x(2.2), 0])
  await page.waitForFunction(() => /\.crossfade\(\{ at: 1\.8, d: 0\.4 \}\)$/.test(scriptText()))
  assert.equal(await selected(), '0:01.800–0:03.800')
  await lengthIs('0:07.600')
  // out past the end: the 0.3 s after it go
  await select()
  await drag(await grab([[x(4.2) - 9, dot]], 'ew-resize'), [x(4.5) - x(4.2), 0])
  await page.waitForFunction(() => /\.crossfade\(\{ at: 4\.2, d: 0\.3 \}\)$/.test(scriptText()))
})

// Denoise: where the noise plays alone is selected, learned there and taken out everywhere, in one step; the rack sets how
// far down, the selection stays the noise. Nothing selected, it asks for that first.
test('editor: Denoise learns the noise where it is selected and takes it out everywhere', async () => {
  await open()
  await write(`audio('chime.wav')`)
  await lengthIs('0:08.000')
  await menu('Process', 'Repair', 'Denoise')
  await page.locator('.message', { hasText: 'Select where the noise plays alone first.' }).waitFor()
  const { box, x } = await axis(8), y = box.y + tall(box) * .3, readout = await page.locator('.readout').textContent()
  await page.mouse.move(x(6), y); await page.mouse.down(); await page.mouse.move(x(7.5), y, { steps: 4 }); await page.mouse.up()
  await palette('The noise here, taken 12 dB down everywhere')
  await page.waitForFunction(() => /\.denoise\(\{ noise: \{ at: 6, d: 1\.5 \} \}\)$/.test(scriptText()))
  await tab('Edits')
  await page.locator('.step.open .step-name', { hasText: 'Denoise' }).waitFor()
  assert.deepEqual(await page.locator('.step.open .param label').allInnerTexts(), ['reduction', 'threshold'])
  // the output comes with the noise taken out: its level changes, nothing goes wrong
  await page.waitForFunction(was => document.querySelector('.readout').textContent !== was, readout)
  assert.equal(await page.locator('.message.problem').count(), 0)
  // pauses selected together, a whine under them all: learned from every one
  await tab('Code')
  await write(bursts.replace('Math.sin(2 * Math.PI * 440 * t)', 'Math.sin(2 * Math.PI * 440 * t) + .002 * Math.sin(2 * Math.PI * 7919 * t)'))
  await lengthIs('0:02.500')
  // all of it in view (a shorter sound keeps the last one's scale), so the pause at 0.45 s is where it is pressed
  await page.locator('.plot').focus()
  await page.keyboard.press('0')
  const at = await axis(2.5)
  await page.mouse.dblclick(at.x(.45), at.box.y + tall(at.box) / 3)
  await page.waitForFunction(() => /^Selected 0:00\.4\d+–0:00\.4\d+/.test((e => e.title || e.dataset.tip || '')(document.querySelector('.clock'))))
  await page.keyboard.press('ControlOrMeta+D')
  await page.keyboard.press('ControlOrMeta+D')
  await palette('The noise alone in all 3')
  await page.waitForFunction(() => /\.denoise\(\{ noise: \[\{ at: [\d.]+, d: [\d.]+ \}(, \{ at: [\d.]+, d: [\d.]+ \}){2}\] \}\)$/.test(scriptText()))
  // a box on the spectrogram: its time where the noise plays alone, its band where it goes, the rest as it was
  await page.keyboard.press('ControlOrMeta+Z')
  await show('spec')
  const lane = tall(at.box)
  await page.mouse.click(at.x(.2), at.box.y + lane * .5)
  await page.keyboard.press('0')
  await boxDrag([at.x(1), at.box.y + lane * .1], [at.x(1.4) - at.x(1), lane * .15])
  assert.match(await selected(), /^0:01\.0\d\d–0:01\.4\d\d$/)
  await palette('The noise here, taken 12 dB down in this band everywhere')
  await page.waitForFunction(() => /\.denoise\(\{ noise: \{ at: 1(\.0\d*)?, d: 0\.[34]\d* \}, band: \[\d+, \d+\] \}\)$/.test(scriptText()))
  const [lo, hi] = (await code()).match(/band: \[(\d+), (\d+)\]/).slice(1).map(Number)
  assert.ok(lo > 3000 && hi > lo && hi < 22050, `${lo}–${hi}`)
  await page.waitForFunction(() => !document.querySelector('.message.problem'))
})

// While a selection loops, the caret put elsewhere takes playback there, over all of the output (nothing is selected)
test('editor: the caret put elsewhere while a selection loops plays from there, past the old loop', async () => {
  await open()
  const { box, x } = await axis(6.525), y = box.y + tall(box) * .3
  await drag([x(1), y], [x(1.5) - x(1), 0])
  await page.getByRole('button', { name: 'Loop' }).click()
  await page.keyboard.press('Space')
  await page.getByRole('button', { name: 'Pause' }).waitFor()
  await page.waitForTimeout(400)
  await page.mouse.click(x(4), y)
  await page.waitForTimeout(700)
  const t = +(await page.locator('.time').innerText()).split(':')[1]
  assert.ok(t > 4.1 && t < 5.5, `plays on from the click (${t})`)
  await page.keyboard.press('Space')
})

// A selection's handles each do one thing: the square past its end, a square's height off each lane's foot (lanes 2 px apart
// over the plot less its 22 px time row, view.js), stretches it, however the pointer wanders up or down; the pill on its
// top edge, dragged first up, sets its level, however it wanders across after.
// A stretch dragged to anywhere, not a round factor: the output it makes ends the stretched range where the drag let go,
// to the sample, so nothing after it moves when it comes (the library's length, round(n × factor), fn/stretch.js)
test('editor: a stretch dragged anywhere ends where it was let go, to the sample', async () => {
  const { box, x, y } = await chime(), lh = (tall(box) - LANES) / 2
  await settings('Times in', 'samples')
  await page.mouse.click(x(7.5), y)
  await drag([x(1), y], [x(1.7) - x(1), 0])
  assert.equal(await selected(), '44100–74970')
  const grip = await grab([[x(1.7) + 8, box.y + lh * 3 / 4]], /^url\(|ew-resize/)
  await drag(grip, [x(2.07) - x(1.7) + 3, 0])
  await page.waitForFunction(() => /\.stretch\(/.test(scriptText()))
  const [a, to] = (await selected()).split('–').map(Number)
  // its length, in the samples the times are in, no longer 8 s'
  await page.waitForFunction(() => !(e => e.title || e.dataset.tip || '')(document.querySelector('.source')).endsWith(' · 352800'))
  // all of it selected, in samples: 0 to its length
  await page.locator('.plot').focus()
  await page.keyboard.press('ControlOrMeta+A')
  const total = +(await selected()).split('–')[1]
  assert.equal(total - 8 * 44100, to - a - 30870, await code())
})

test('editor: a selection\'s grip only stretches it, its pill dragged up only sets its level', async () => {
  await page.addInitScript(tap)
  await open()
  await noCues()
  await write(`audio('chime.wav')`)
  await lengthIs('0:08.000')
  const { box, x } = await axis(8), y = box.y + tall(box) * .3, lh = (tall(box) - LANES) / 2
  const select = async () => { await page.mouse.click(x(7.5), y); await drag([x(2.2), y], [x(4.2) - x(2.2), 0]) }
  await select()
  await drag(await grab([[x(4.2) + 8, box.y + lh * 3 / 4], [x(4.2) + 8, box.y + lh + LANES + lh * 3 / 4]], STRETCHING), [x(5.2) - x(4.2), -80])
  await page.waitForFunction(() => /\.stretch\(1\.5, \{ at: 2\.2, d: 2 \}\)$/.test(scriptText()))
  assert.equal(await selected(), '0:02.200–0:05.200')
  assert.doesNotMatch(await code(), /gain/)
  await page.keyboard.press('ControlOrMeta+Z')
  await page.waitForFunction(() => !scriptText().includes('stretch'))
  // the 8 s output back in view before selecting on it: x() maps 8 s, and the 9 s stretched one may still show
  await lengthIs('0:08.000')
  await select()
  // the pill dragged: heard at the level it goes to as it goes, as a pitch dragged is
  const pill = await grab([[(x(2.2) + x(4.2)) / 2, box.y + 4]], 'ns-resize')
  await heard()
  await page.mouse.move(...pill)
  await page.mouse.down()
  for (let i = 1; i <= 6; i++) await page.mouse.move(pill[0] + 10 * i, pill[1] - 80 * i / 6)
  await page.waitForTimeout(500)
  // (the chime peaks at half of full scale: 12 dB up, past it)
  const { peak } = await heard()
  assert.ok(peak > .9, `heard as the level goes, 12 dB up: ${peak}`)
  await page.mouse.up()
  await page.waitForFunction(() => /\.gain\(\{ t: \[2\.2, 2\.205, 4\.195, 4\.2\], v: \[0, [\d.]+, [\d.]+, 0\] \}\)$/.test(scriptText()))
  assert.doesNotMatch(await code(), /stretch/)
})

// A dragged edge, or the caret, goes onto a cue it comes within 3 px of, as Figma's objects snap; one short of it, or 5 px
// past it, stays
test('editor: a selection\'s dragged edge, or the caret, snaps to a cue near it', async () => {
  await open()
  await write(hits)
  await lengthIs('0:02.000')
  const { box, x } = await axis(2), y = box.y + tall(box) * .3
  let cues = []
  for (const until = Date.now() + 8000; cues.length < 3 && Date.now() < until; await page.waitForTimeout(200)) cues = await handles()
  const at = cues.find(h => Math.abs(h - (x(1) - box.x)) < 20)
  await drag([x(.7), y], [box.x + at + 2 - x(.7), 0])
  const end = +(await selected()).split('–')[1].split(':')[1]
  assert.ok(Math.abs(end - 1) < .012, `on the cue at 1 s, where the hit starts: ${end}`)
  await page.mouse.click(x(1.8), y)
  await drag([x(.7), y], [box.x + at + 5 - x(.7), 0])
  const past = +(await selected()).split('–')[1].split(':')[1]
  assert.ok(past - end > .005, `5 px past it, where it was put: ${past}, the cue ${end}`)
  await page.mouse.click(x(1.8), y)
  await drag([x(.3), y], [x(.45) - x(.3), 0])
  assert.match(await selected(), /^0:00\.30\d–0:00\.45\d$/)
  // the caret, pressed on the time row two pixels after a cue, goes onto it (with nothing selected, the clock is
  // the caret's)
  await page.keyboard.press('Escape')
  await page.mouse.click(box.x + at + 2, box.y + box.height - 8)
  const caret = +(await page.locator('.time').innerText()).split(':')[1]
  assert.ok(Math.abs(caret - end) < 1e-3, `the caret on the hit: ${caret}, the edge was ${end}`)
  // the cues hidden, an edge still goes onto them
  await menu('View', 'Show', 'Cues')
  await page.mouse.click(x(1.8), y)
  await drag([x(.7), y], [box.x + at + 2 - x(.7), 0])
  assert.ok(Math.abs(+(await selected()).split('–')[1].split(':')[1] - end) < .012, 'snapped, hidden')
})

// A dragged edge goes onto a marked range's ends, and onto the ends of the place takes went in, as onto a marker
test('editor: a selection\'s dragged edge snaps to a range\'s ends and to the takes\' place', async () => {
  await open()
  // a steady tone, no cue in it; a range 2–5 s; takes from 1 s, the longer to 9 s (chime.wav 8 s)
  await write(`audio.from(t => Math.sin(2 * Math.PI * 220 * t) * .3, { duration: 10 })\n  .mark({ at: 2, d: 3 }, 'verse')\n  // .write(audio('chime.wav'), { at: 1 })\n  .write(audio('birdsong.wav'), { at: 1 })`)
  await lengthIs('0:10.000')
  await page.locator('.plot .takes:not([hidden])').waitFor()
  const { box, x } = await axis(10), y = box.y + tall(box) * .6
  const end = async (to, by = 2) => { await page.mouse.click(x(9.8), y); await drag([x(.4), y], [x(to) + by - x(.4), 0]); return (await selected()).split('–')[1] }
  assert.equal(await end(5), '0:05.000', 'the range\'s end')
  assert.equal(await end(2), '0:02.000', 'its start')
  // (from before it: the birdsong's first cue a few pixels after it is the nearer from after)
  assert.equal(await end(1, -2), '0:01.000', 'where the takes go in')
  assert.equal(await end(9), '0:09.000', 'where the longest ends')
})

// Crossfade on a selection, as an editor's: the audio either side meets across it, and it goes (fn/crossfade.js)
test('editor: the crossfade tool on a selection crossfades across it', async () => {
  await open()
  await noCues()
  await write(`audio('chime.wav')`)
  await lengthIs('0:08.000')
  const { box, x } = await axis(8), y = box.y + tall(box) * .3
  await drag([x(2.2), y], [x(2.3) - x(2.2), 0])
  await page.keyboard.press('ControlOrMeta+K')
  await page.keyboard.type('crossfade')
  await page.keyboard.press('Enter')
  await page.waitForFunction(() => /\.crossfade\(\{ at: 2\.2, d: 0\.1 \}\)$/.test(scriptText()))
  await lengthIs('0:07.900')
  assert.equal(await page.locator('.message.problem').count(), 0)
})

// What goes wrong when the script runs shows over the picture, once, as well as beside the time
test('editor: an error the script meets shows over the picture, once', async () => {
  await open()
  await write(`audio('chime.wav').crossfade()`)
  await page.locator('.message.problem', { hasText: 'crossfade: expected a source to blend into' }).waitFor()
  await page.locator('.message.problem', { hasText: 'crossfade: expected a source' }).waitFor()
})

// Alt-click puts another caret, as a text editor's; M marks each, and a click leaves one
// Tabs, as an audio editor's open files: a sound opened goes into a tab of its own, each tab keeps its script and its
// own history, the page keeps them all, and closing the last leaves an empty one
test('editor: each sound opens in a tab of its own, with its own script and history, kept across a reload', async () => {
  await open()
  const tabs = () => page.locator('.files [role="tab"]').allInnerTexts()
  const shown = () => code().then(c => c.replace(/\s+/g, ''))
  await write(`audio('chime.wav').gain(-3)`)
  await lengthIs('0:08.000')
  await menu('File', 'Sample or generate', 'handpan.wav')
  await page.waitForFunction(() => scriptText().trim() === "audio('handpan.wav')")
  assert.deepEqual(await tabs(), ['chime.wav', 'handpan.wav'])
  await tab('Code')
  await page.locator('.cm-content').click()
  await page.keyboard.press('End')
  await page.keyboard.insertText('.gain(-6)')
  await page.getByRole('tab', { name: 'chime.wav' }).click()
  assert.equal(await shown(), `audio('chime.wav').gain(-3)`)
  await lengthIs('0:08.000')
  // the undo is this tab's: the handpan's edit stays
  await page.locator('.cm-content').click()
  await page.keyboard.press('ControlOrMeta+Z')
  assert.notEqual(await shown(), `audio('chime.wav').gain(-3)`)
  await page.getByRole('tab', { name: 'handpan.wav' }).click()
  assert.equal(await shown(), `audio('handpan.wav').gain(-6)`)
  await page.waitForTimeout(700)
  await page.reload()
  await wholeLevels().waitFor()
  assert.deepEqual(await tabs(), ['chime.wav', 'handpan.wav'])
  assert.equal(await shown(), `audio('handpan.wav').gain(-6)`)
  // a link's script: in a tab of its own, or in the tab that holds it already
  const link = text => page.evaluate(async text => {
    const bytes = new Uint8Array(await new Response(new Blob([text]).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer())
    return location.origin + '/playground/#code=' + btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  }, text)
  const visit = async url => { await page.goto(url); await page.reload(); await wholeLevels().waitFor() }
  const reversed = await link(`audio('chime.wav').reverse()`)
  await visit(reversed)
  assert.equal((await tabs()).length, 3)
  assert.equal(await shown(), `audio('chime.wav').reverse()`)
  await page.getByRole('tab', { name: 'handpan.wav' }).click()
  await page.waitForTimeout(100)
  await visit(reversed)
  assert.equal((await tabs()).length, 3)
  assert.equal(await shown(), `audio('chime.wav').reverse()`)
  // closing a tab not shown leaves the one shown; closing the one shown shows its neighbour; the last leaves an empty one
  await page.getByRole('button', { name: 'Close chime.wav' }).first().click()
  assert.deepEqual(await tabs(), ['handpan.wav', 'chime.wav'])
  assert.equal(await shown(), `audio('chime.wav').reverse()`)
  await page.getByRole('button', { name: 'Close chime.wav' }).click()
  assert.deepEqual(await tabs(), ['handpan.wav'])
  assert.equal(await shown(), `audio('handpan.wav').gain(-6)`)
  await page.getByRole('button', { name: 'Close handpan.wav' }).click()
  assert.deepEqual(await tabs(), ['untitled'])
  assert.equal(await shown(), '')
  await page.getByText('Drop audio here').waitFor()
  assert.deepEqual(errors, [])
})

// From before the playground moved to playground/: a link shared then (playground.html, editor.html) opens it there, its
// query and its hash along (a script's #code=…); the embed loaded from where it was (embed.js, as audio.js.org/embed.js
// loads it) is the playground's own, its frame the playground's
test('editor: links and the embed from before the playground moved open it at playground/', async () => {
  for (const [old, now] of [['/playground.html?panel=none#x', '/playground/?panel=none#x'], ['/editor.html#x', '/playground/#x']]) {
    await page.goto(origin + old)
    await page.waitForURL(url => url.pathname === '/playground/')
    assert.equal(page.url().slice(origin.length), now)
  }
  await page.goto(origin + '/blank.html')
  const frame = await page.evaluate(async () => {
    await import('/embed.js')
    const el = Object.assign(document.createElement('audio-repl'), { textContent: "audio('chime.wav')" })
    document.body.append(el)
    const found = () => el.querySelector('iframe') ?? el.shadowRoot?.querySelector('iframe')
    for (let i = 0; i < 100 && !found(); i++) await new Promise(r => setTimeout(r, 50))
    return found() && new URL(found().src).pathname
  })
  assert.equal(frame, '/playground/')
})

// Embedded in another page (embed.js, <audio-repl>): the element's text becomes the frame's link; the frame runs that
// script alone, its panel as asked, the tabs and the panels' tabs gone, and reads nothing from the browser nor writes to
// it, so an editor open in another tab keeps its tabs and is not asked to step aside
test('editor: embedded, another page\'s script runs alone, its panel as asked, nothing of the editor\'s touched', async () => {
  await page.goto(origin + '/playground/')
  await wholeLevels().waitFor()
  // the element, in a page of its own: its text in the frame's link; the editor's tabs as it left them
  await page.goto(origin + '/blank.html')
  // the editor's last write lands as it goes, in its own process (its COOP page left for one without): what it kept is
  // what stays a while
  let kept = null
  for (let was; kept == null || kept !== was; await page.waitForTimeout(300)) { was = kept; kept = await page.evaluate(() => localStorage.getItem('audio-repl')) }
  assert.ok(kept)
  const src = await page.evaluate(async () => {
    await import('/playground/embed.js')
    // as a page writes it: the whole of it indented with the page's markup, which comes off
    document.body.innerHTML = `<audio-repl panel="edits" height="300"><pre><code>
      audio('handpan.wav')
        .gain(-6)
    </code></pre></audio-repl>`
    const frame = await new Promise(r => { const t = setInterval(() => { const f = document.querySelector('audio-repl iframe'); if (f) { clearInterval(t); r(f) } }, 20) })
    return frame.getAttribute('src')
  })
  const url = new URL(src, origin)
  assert.equal(url.pathname, '/playground/')
  assert.deepEqual([...url.searchParams], [['embed', ''], ['ui', JSON.stringify({ panel: 'edits' })]])
  const script = await page.evaluate(async hash => {
    const bytes = Uint8Array.from(atob(hash.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0))
    return new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).text()
  }, url.hash.slice('#code='.length))
  assert.equal(script, `audio('handpan.wav')\n  .gain(-6)`)
  // the frame's page: that script, its edits open, no tabs, the way to the whole editor carrying the script
  await page.goto(url.href)
  await page.locator('.step', { hasText: 'Gain' }).waitFor()
  // CodeMirror, which comes once the page shows
  await page.locator('.cm-content').waitFor({ state: 'attached' })
  assert.equal(await page.evaluate(() => scriptText()), script)
  assert.equal(await page.evaluate(() => document.documentElement.classList.contains('embed')), true)
  assert.equal(await page.locator('.panes').getAttribute('data-side'), 'open')
  assert.equal(await page.locator('.stack').isVisible(), true)
  assert.equal(await page.locator('.files').isVisible(), false)
  assert.equal(await page.locator('.side-head').isVisible(), false)
  // its lines wrap to the panel, none hidden past its edge
  assert.equal(await page.locator('.cm-content.cm-lineWrapping').count(), 1)
  await page.waitForFunction(() => document.querySelector('.embed-open')?.getAttribute('href')?.includes('#code='))
  await page.waitForTimeout(700)
  assert.equal(await page.evaluate(() => localStorage.getItem('audio-repl')), kept)
  assert.equal(await page.evaluate(() => document.querySelector('dialog.elsewhere').open), false)
  // a reload runs the link again: it is all the frame has
  await page.reload()
  await page.locator('.step', { hasText: 'Gain' }).waitFor()
  await page.locator('.cm-content').waitFor({ state: 'attached' })
  assert.equal(await page.evaluate(() => scriptText()), script)
  // two frames beside an editor open in another tab of the same browser: none asks another to step aside, and the
  // editor's tabs stay as they were
  const context = await browser.newContext(), open = async href => {
    const p = await context.newPage()
    await chimeLeft(p)
    p.on('pageerror', error => errors.push(error.message))
    p.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()) })
    await p.addInitScript(() => { globalThis.scriptText = () => [...document.querySelectorAll('.cm-content .cm-line')].map(l => l.textContent).join('\n') })
    await p.goto(href)
    return p
  }
  try {
    const editor = await open(origin + '/playground/')
    await editor.locator('.readout[data-of="all"]').waitFor()
    await editor.waitForTimeout(700)
    const tabs = await editor.evaluate(() => localStorage.getItem('audio-repl'))
    // the whole editor's lines run on, scrolled, as a code editor's do
    assert.equal(await editor.locator('.cm-content.cm-lineWrapping').count(), 0)
    const frames = [await open(url.href), await open(url.href)]
    for (const f of frames) await f.locator('.step', { hasText: 'Gain' }).waitFor()
    // past the 1.5 s an editor waits for the one open to let go before it asks (keep.js own)
    await editor.waitForTimeout(2500)
    for (const p of [editor, ...frames]) assert.equal(await p.evaluate(() => document.querySelector('dialog.elsewhere').open), false)
    assert.equal(await editor.evaluate(() => localStorage.getItem('audio-repl')), tabs)
    // no link, or one that does not read: an empty tab, its ways in, as a first visit's; no panel asked for, none
    await frames[0].goto(origin + '/playground/?embed&panel=none#code=@@')
    await frames[0].locator('.empty').waitFor()
    assert.equal(await frames[0].locator('.panes').getAttribute('data-side'), 'none')
  } finally { await context.close() }
  assert.deepEqual(errors, [])
})

// Embedded with the parts the page names and edits a press away (embed.js controls, ops, background): the parts named
// there and no others, record's slot gone with it; the readout reading the level named; after the history one button,
// a menu of the edits, each with its icon, none the library has left out; one picked, its call written with its own
// arguments, as the menus write theirs, the sound made by it; undone, as it was; over the picture the sound's name, a
// menu of its ways in, a sample taken in its place; a file opened in its place, the result saved; no slab where the
// page asks for its own ground
// How far time zooms and scrolls past the sound's end, as the page asks (ui zoom and overshoot, playground/README.md): a
// hero's picture, zoomed out no further than the sound, scrolled never past its end, zoomed in no closer than 0.1 s
test('editor: embedded, the page sets how far time zooms and how far past the end it scrolls', async () => {
  await page.route('**/playground/editor.js', async route => { const r = await route.fetch(); route.fulfill({ response: r, body: (await r.text()).replace('v = view(', 'v = globalThis.__view = view(') }) })
  await page.goto(origin + '/blank.html')
  const src = await page.evaluate(async () => {
    await import('/playground/embed.js')
    document.body.innerHTML = `<audio-repl panel="none" ui='{"zoom":{"in":4410,"out":1},"overshoot":0}'><pre><code>audio('chime.wav')</code></pre></audio-repl>`
    return new Promise(r => { const t = setInterval(() => { const f = document.querySelector('audio-repl iframe'); if (f) { clearInterval(t); r(f.getAttribute('src')) } }, 20) })
  })
  await page.goto(new URL(src, origin).href)
  await wholeLevels().waitFor()
  const range = () => page.evaluate(() => __view.range), box = await page.locator('.plot').boundingBox()
  const fit = await range()
  await page.locator('.plot').focus()
  await page.keyboard.press('-')
  await page.waitForTimeout(300)
  assert.deepEqual(await range(), fit, 'zoomed out: the sound across the view, no further')
  for (let i = 0; i < 10; i++) await page.keyboard.press('=')
  await page.waitForTimeout(300)
  const [a, b] = await range()
  assert.ok(Math.abs(b - a - .1) < 1e-6, `zoomed in: 0.1 s across at the closest, ${b - a}`)
  // scrolled on and on: the sound's end no further left than the lanes' end (their 0.9 of the view, at least)
  await page.mouse.move(box.x + box.width / 2, box.y + 40)
  for (let i = 0; i < 40; i++) await page.mouse.wheel(4000, 0)
  await page.waitForTimeout(300)
  const [p, q] = await range()
  assert.ok(p > 7.5 && p + (q - p) * .9 <= 8, `scrolled to the end, not past it: ${p}–${q}`)
})

test('editor: embedded, the parts the page names, its edits a press away, its files in and out', async () => {
  await page.goto(origin + '/blank.html')
  const src = await page.evaluate(async () => {
    await import('/playground/embed.js')
    document.body.innerHTML = `<audio-repl panel="none" controls="sound play  history open save loudness rate view link" ops="stretch(1.25) fade(1, 1) reverse nosuch" background="page"><pre><code>audio('chime.wav')</code></pre></audio-repl>`
    const frame = await new Promise(r => { const t = setInterval(() => { const f = document.querySelector('audio-repl iframe'); if (f) { clearInterval(t); r(f) } }, 20) })
    return frame.getAttribute('src')
  })
  const url = new URL(src, origin)
  // one JSON of it all, the page's ground read off the page (blank.html paints none: the page's own, white)
  assert.deepEqual([...url.searchParams.keys()], ['embed', 'ui'])
  assert.deepEqual(JSON.parse(url.searchParams.get('ui')), { panel: 'none', background: 'white', controls: ['sound', 'play', 'history', 'open', 'save', 'loudness', 'rate', 'view', 'link'], ops: ['stretch(1.25)', 'fade(1, 1)', 'reverse', 'nosuch'] })
  // the page told how its mark moves (a mark event on the element): at rest once the sound is in, playing as it plays
  await page.evaluate(() => { window.moods = []; document.querySelector('audio-repl').addEventListener('mark', e => e.detail.mode && moods.push(e.detail.mode)) })
  await page.waitForFunction(() => moods.at(-1) === 'rest', null, { timeout: 30000 })
  await page.frameLocator('audio-repl iframe').locator('.play').click()
  await page.waitForFunction(() => moods.at(-1) === 'play', null, { timeout: 10000 })
  await page.frameLocator('audio-repl iframe').locator('.play').click()
  // a press on the page around it closes what is open in it, its menus and its lists, as a press in it would
  const inside = page.frameLocator('audio-repl iframe')
  for (const [opener, open] of [['.embed-sound', '.menubar-menu'], ['.embed-ops', '.menubar-menu'], ['.fact[popovertarget="rate-menu"]', '#rate-menu:popover-open']]) {
    await inside.locator(opener).click()
    await inside.locator(open).waitFor()
    await page.mouse.click(2, 2)
    await inside.locator(open).waitFor({ state: 'detached' })
  }
  await page.goto(url.href)
  await wholeLevels().waitFor()
  const length = text => page.waitForFunction(text => document.querySelector('.clock .length')?.textContent.includes(text), text)
  await length('0:08.000')
  const shown = sel => page.locator(sel).first().isVisible()
  for (const part of ['.embed-sound', '.play', '.history', '.embed-open-file', '.embed-save', '.readout', '.fact[popovertarget="rate-menu"]', '.embed-view', '.embed-open', '.embed-ops']) assert.equal(await shown(`.panes ${part}`), true, part)
  for (const part of ['.record', '.deck-slot:has(.record)', '.loop', '.clock', '.message', '.before', '.fact[popovertarget="channels-menu"]', '.embed-name', '.lane-look']) assert.equal(await shown(`.panes ${part}`), false, part)
  // on the page's ground, no slab's edge to keep off: the play button under the sound's name
  const lefts = await page.evaluate(() => ['.play .play-icon', '.embed-sound svg'].map(s => document.querySelector(`.panes ${s}`).getBoundingClientRect().left))
  assert.ok(Math.abs(lefts[0] - lefts[1]) < 3, `play at ${lefts[0]}, the sound's icon at ${lefts[1]}`)
  // the level as the facts beside it are: its value and its unit apart, in their colour
  assert.match(await page.locator('.panes .readout').textContent(), /^−\d+\.\dLUFS$/)
  assert.equal(...await page.evaluate(() => ['.readout', '.facts'].map(s => getComputedStyle(document.querySelector(`.panes ${s}`)).color)))
  // the view, a switch among the facts, the look's icon: pressed, the other picture, its icon
  const look = () => page.locator('.lane-look').last().getAttribute('aria-label')
  assert.deepEqual([await page.locator('.embed-view').getAttribute('aria-label'), await look()], ['Waveform', 'Waveform'])
  await page.locator('.embed-view').click()
  await page.waitForFunction(() => document.querySelector('.embed-view').ariaLabel === 'Spectrogram')
  await page.waitForFunction(() => [...document.querySelectorAll('.lane-look')].at(-1)?.getAttribute('aria-label') === 'Spectrogram', null, { timeout: 5000 })
  assert.equal(await page.locator('.embed-view path').getAttribute('d'), await page.locator('.lane-look path').last().getAttribute('d'))
  await page.locator('.embed-view').click()
  await page.waitForFunction(() => document.querySelector('.embed-view').ariaLabel === 'Waveform')
  // on the page's ground, the slab's gradient gone (its edges, masked, fade into whatever is under them)
  assert.deepEqual(await page.evaluate(() => [getComputedStyle(document.querySelector('.panes')).backgroundColor, getComputedStyle(document.querySelector('.panes')).backgroundImage]), ['rgb(255, 255, 255)', 'none'])
  // the edits after the history, in the bar
  assert.equal(await page.evaluate(() => document.querySelector('.status .history').nextElementSibling?.classList.contains('embed-ops')), true)
  const menu = () => page.locator('.menubar-menu .menu-row')
  await page.locator('.embed-ops').click()
  assert.deepEqual(await menu().locator('.menu-label').allTextContents(), ['Stretch', 'Fade', 'Reverse'])
  // each its values at the right, in the units its settings read in
  assert.deepEqual(await menu().locator('.menu-keys').allTextContents(), ['1.25×', '1s · 1s', ''])
  assert.equal(await menu().locator('.menu-check svg').count(), 3)
  // a line under each on what it does
  assert.deepEqual(await menu().locator('.menu-about').allTextContents(), ['Longer or shorter, same pitch', 'Fade in and out', 'Play backwards'])
  await menu().filter({ hasText: 'Stretch' }).click()
  await length('0:10.000')
  assert.equal(scriptOf(await page.evaluate(() => scriptText())), scriptOf(`audio('chime.wav').stretch(1.25)`))
  // made: counted by the plus; in the menu first, checked, the others after it; pressed again, taken away
  assert.deepEqual([await page.locator('.embed-ops').getAttribute('aria-label'), await page.locator('.embed-ops span').textContent()], ['Edits, 1 made', '1'])
  await page.locator('.embed-ops').click()
  assert.deepEqual(await menu().evaluateAll(rows => rows.map(r => [r.querySelector('.menu-label').textContent, r.getAttribute('aria-checked')])), [['Stretch', 'true'], ['Fade', null], ['Reverse', null]])
  await menu().filter({ hasText: 'Stretch' }).click()
  await length('0:08.000')
  assert.equal(scriptOf(await page.evaluate(() => scriptText())), scriptOf(`audio('chime.wav')`))
  assert.deepEqual([await page.locator('.embed-ops').getAttribute('aria-label'), await page.locator('.embed-ops span').count()], ['Add an edit', 0])
  // taken away as any edit is, undone as one: back, then gone again
  await page.locator('.history .undo').click()
  await length('0:10.000')
  await page.locator('.history .undo').click()
  await length('0:08.000')
  assert.equal(scriptOf(await page.evaluate(() => scriptText())), scriptOf(`audio('chime.wav')`))
  // the sound's name over the picture; pressed, its ways in: a file, a take, the samples; one picked, in its place
  assert.equal(await page.locator('.embed-sound-name').textContent(), 'chime.wav')
  await page.locator('.embed-sound').click()
  const ways = await menu().locator('.menu-label').allTextContents()
  assert.deepEqual(ways.slice(0, 2), ['Open a file…', 'Record'])
  assert.ok(ways.includes('handpan.wav'), ways.join(', '))
  await menu().filter({ hasText: 'handpan.wav' }).click()
  await page.waitForFunction(() => document.querySelector('.embed-sound-name')?.textContent === 'handpan.wav')
  assert.equal(scriptOf(await page.evaluate(() => scriptText())), scriptOf(`audio('handpan.wav')`))
  // saved: the format picked from its menu, the result as the export saves it; opened: a file of the reader's in its place
  await page.locator('.embed-save').click()
  assert.deepEqual(await menu().locator('.menu-label').allTextContents(), ['WAV', 'FLAC', 'MP3', 'OGG', 'AIFF'])
  const [saved] = await Promise.all([page.waitForEvent('download'), menu().filter({ hasText: 'FLAC' }).click()])
  assert.match(saved.suggestedFilename(), /\.flac$/)
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.locator('.embed-open-file').click()])
  await chooser.setFiles(fileURLToPath(new URL('fixture.wav', import.meta.url)))
  await page.waitForFunction(() => document.querySelector('.cm-content')?.textContent.includes('fixture.wav'))
  // no controls asked for: the parts as ever, the files' buttons not among them; no ops, no row of them
  await page.goto(origin + '/playground/?embed&panel=none' + url.hash)
  await wholeLevels().waitFor()
  assert.equal(await page.locator('.embed-ops').count(), 0)
  for (const part of ['.record', '.loop', '.before', '.embed-name']) assert.equal(await shown(`.panes ${part}`), true, part)
  for (const part of ['.embed-sound', '.embed-open-file', '.embed-save', '.embed-view']) assert.equal(await shown(`.panes ${part}`), false, part)
  assert.equal(await shown('.panes .lane-look'), true, 'the look, where no list names the parts')
  assert.notEqual(await page.evaluate(() => getComputedStyle(document.querySelector('.panes')).backgroundImage), 'none')
  // the lanes fill the picture: no room kept under them for a new track, as the whole editor keeps
  const gap = () => page.evaluate(() => document.querySelector('.plot').getBoundingClientRect().bottom - document.querySelector('.lane-look').getBoundingClientRect().bottom)
  assert.ok(await gap() < 40, `embedded, the lanes reach the picture's foot (${await gap()} px short)`)
  const ruled = await gap()
  // no ruler asked for: no time row, the lanes reaching on into its place, and no time for the playhead on it
  await page.goto(origin + '/playground/?embed&ui=' + encodeURIComponent(JSON.stringify({ panel: 'none', controls: ['play', 'clock', 'look'] })) + url.hash)
  await length('0:08.000')
  assert.ok(await gap() < ruled - 15, `no time row: the lanes ${ruled - await gap()} px further down`)
  await page.locator('.play').click()
  await page.waitForTimeout(300)
  assert.equal(await page.locator('.playhead .when').isVisible(), false)
  await page.locator('.play').click()
  // the whole editor keeps its room under the lanes
  await page.goto(origin + '/playground/' + url.hash)
  await wholeLevels().waitFor()
  assert.ok(await gap() > 80, `whole, the room under the lanes kept (${await gap()} px)`)
  // a sound by its path from the site's root, as the page around it names its own files: opened, not asked for
  const rooted = await page.evaluate(async () => {
    await import('/playground/embed.js')
    document.body.innerHTML = `<audio-repl panel="none"><pre><code>audio('/test/fixture.wav')</code></pre></audio-repl>`
    const frame = await new Promise(r => { const t = setInterval(() => { const f = document.querySelector('audio-repl iframe'); if (f) { clearInterval(t); r(f) } }, 20) })
    return frame.getAttribute('src')
  })
  await page.goto(new URL(rooted, origin).href)
  await wholeLevels().waitFor()
  assert.equal(await page.locator('.message').textContent().then(t => /not open here/.test(t)), false)
  assert.equal(await page.locator('.panes .text-button', { hasText: 'Open it' }).count(), 0)
  // two slashes are another host's, not a path of this site: asked for as a file, never fetched
  const fetched = []
  page.on('request', r => r.url().includes('elsewhere.example') && fetched.push(r.url()))
  await page.goto(origin + '/blank.html')
  const other = await page.evaluate(async () => {
    await import('/playground/embed.js')
    document.body.innerHTML = `<audio-repl panel="none"><pre><code>audio('//elsewhere.example/x.wav')</code></pre></audio-repl>`
    const frame = await new Promise(r => { const t = setInterval(() => { const f = document.querySelector('audio-repl iframe'); if (f) { clearInterval(t); r(f) } }, 20) })
    return frame.getAttribute('src')
  })
  await page.goto(new URL(other, origin).href)
  await page.locator('.panes .text-button', { hasText: 'Open it' }).waitFor()
  assert.deepEqual(fetched, [])
  assert.deepEqual(errors, [])
})

// a script as it reads, its spaces aside
const scriptOf = text => text.replace(/\s+/g, '')
// A tab closed opens again where it was, as it was left (⇧⌘T, as a browser's): its script, its selection; one closed
// before a reload too. What each tab selected stays with it as the tabs are switched
test('editor: a closed tab opens again where it was, as it was left, after a reload too', async () => {
  const { x, y } = await chime()
  const tabs = () => page.locator('.files [role="tab"]').allInnerTexts()
  await write(`audio('chime.wav').gain(-3)`)
  await lengthIs('0:08.000')
  await drag([x(1), y], [x(3) - x(1), 0])
  const was = await selected()
  assert.match(was, /^0:0[01]\.\d+–0:0[23]\.\d+$/)
  await menu('File', 'Sample or generate', 'handpan.wav')
  await page.waitForFunction(() => scriptText().trim() === "audio('handpan.wav')")
  await page.getByRole('tab', { name: 'chime.wav' }).click()
  await page.waitForFunction(was => (e => e.title || e.dataset.tip || '')(document.querySelector('.clock')).startsWith(`Selected ${was}:`), was)
  await menu('File', 'Close tab')
  assert.deepEqual(await tabs(), ['handpan.wav'])
  await page.locator('.plot').focus()
  await page.keyboard.press('ControlOrMeta+Shift+T')
  assert.deepEqual(await tabs(), ['chime.wav', 'handpan.wav'])
  assert.equal(scriptOf(await code()), `audio('chime.wav').gain(-3)`)
  await page.waitForFunction(was => (e => e.title || e.dataset.tip || '')(document.querySelector('.clock')).startsWith(`Selected ${was}:`), was)
  // in this visit, the tab itself: its history with it
  await menu('Edit', 'Undo')
  await page.waitForFunction(() => !scriptText().includes('gain(-3)'))
  await menu('Edit', 'Redo')
  // closed, and the page reloaded: kept, in the menu
  await menu('File', 'Close tab')
  await page.waitForTimeout(100)
  await page.reload()
  await wholeLevels().waitFor()
  assert.deepEqual(await tabs(), ['handpan.wav'])
  await menu('File', 'Reopen closed tab')
  assert.deepEqual(await tabs(), ['chime.wav', 'handpan.wav'])
  await lengthIs('0:08.000')
  await page.waitForFunction(was => (e => e.title || e.dataset.tip || '')(document.querySelector('.clock')).startsWith(`Selected ${was}:`), was)
  // none left to open
  await page.locator('.menubar-item', { hasText: /^File$/ }).click()
  assert.equal(await menuRow('Reopen closed tab').getAttribute('aria-disabled'), 'true')
})

// A recording, the only copy there is, is kept until the person deletes it: its tab closed and the page reloaded, it
// waits under File › Open recent, opened again from there; deleted only once they say so
const keptFiles = () => page.evaluate(async () => {
  const names = []
  try { for await (const k of (await (await navigator.storage.getDirectory()).getDirectoryHandle('audio-repl-files')).keys()) if (!k.endsWith('.crswap')) names.push(decodeURIComponent(k)) } catch {}
  return names.sort()
})
const takesLeft = () => page.evaluate(async () => {
  let n = 0
  try { for await (const _ of (await (await navigator.storage.getDirectory()).getDirectoryHandle('audio-repl-takes')).keys()) n++ } catch {}
  return n
})
async function recordFor(seconds) {
  await page.getByRole('button', { name: 'Record', exact: true }).first().click()
  await page.waitForFunction(s => { const [m, sec] = document.querySelector('.time').textContent.split(':'); return +m * 60 + +sec >= s }, seconds)
}
test('editor: a recording is kept until it is deleted: its tab closed, it waits under Open recent', async () => {
  await open()
  await write('')
  await page.locator('.empty').waitFor()
  await recordFor(1)
  await page.locator('.plot').focus()
  await page.keyboard.press('Space')
  await page.waitForFunction(() => scriptText().startsWith("audio('recording.wav')"))
  await wholeLevels().waitFor()
  const before = await lengthText()
  // kept as a file, the parts it was written in as it came let go
  for (const until = Date.now() + 5000; (await keptFiles()).join() !== 'recording.wav' || await takesLeft(); await page.waitForTimeout(100))
    assert.ok(Date.now() < until, `kept: ${await keptFiles()}, ${await takesLeft()} takes left`)
  await menu('File', 'Close tab')
  await page.reload()
  await page.locator('.empty').waitFor()
  assert.deepEqual(await keptFiles(), ['recording.wav'])
  await menu('File', 'Open recent', 'recording.wav')
  await page.waitForFunction(() => scriptText().startsWith("audio('recording.wav')"))
  await wholeLevels().waitFor()
  assert.equal(await lengthText(), before)
  assert.equal(await page.locator('.message.problem').count(), 0)
  // a new one takes a name of its own, never the kept one's
  await menu('File', 'Close tab')
  await recordFor(.5)
  await page.locator('.plot').focus()
  await page.keyboard.press('Space')
  await page.waitForFunction(() => scriptText().startsWith("audio('recording-2.wav')"))
  for (const until = Date.now() + 5000; (await keptFiles()).length < 2; await page.waitForTimeout(100)) assert.ok(Date.now() < until)
  // deleted when asked, and only once said: dismissed, it stays
  page.once('dialog', d => d.dismiss())
  await menu('File', 'Open recent', 'Delete kept sounds…')
  await page.waitForTimeout(200)
  assert.deepEqual(await keptFiles(), ['recording-2.wav', 'recording.wav'])
  page.once('dialog', d => { assert.match(d.message(), /^Delete recording\.wav kept in this browser/); d.accept() })
  await menu('File', 'Open recent', 'Delete kept sounds…')
  for (const until = Date.now() + 3000; (await keptFiles()).length > 1; await page.waitForTimeout(100)) assert.ok(Date.now() < until)
  assert.deepEqual(await keptFiles(), ['recording-2.wav'], 'the one a tab opens stays')
})

// A take the page closes on as it records (a reload, a crash) is kept, all but its last second, under the name it was
// to have, in a tab of its own
test('editor: a take the page closes on as it records is kept on the next visit', async () => {
  await open()
  await write('')
  await page.locator('.empty').waitFor()
  await recordFor(2.6)
  // the browser asks before a take is left
  page.once('dialog', d => { assert.equal(d.type(), 'beforeunload'); d.accept() })
  await page.reload()
  await page.waitForFunction(() => scriptText().startsWith("audio('recording.wav')"))
  // said as it is kept, for a few seconds (note), likely gone by the time the levels of all of it are read
  await page.locator('.message', { hasText: 'recording.wav, recorded as the page closed, is kept.' }).waitFor()
  await wholeLevels().waitFor()
  const s = +(await lengthText()).split(':')[1]
  assert.ok(s >= 1.5 && s < 3.5, `${s} s kept`)
  for (const until = Date.now() + 3000; await takesLeft(); await page.waitForTimeout(100)) assert.ok(Date.now() < until, 'its parts let go')
})

// A take as keep.js writes it as it comes, a part each second (here a "second" of 4 frames, so parts split often): read
// back as a WAV, its samples are the ones written, interleaved, for blocks ending before, at and past a part's end; a
// slice from a pass on, as long as asked; one written to nothing has no file and no folder left; one the page closed
// on (no wav() asked) comes back whole on the next visit, under its name, and its parts go once kept
test('editor: a take written as it comes reads back sample for sample, sliced as asked, and whole after a close', async () => {
  await page.goto(origin + '/blank.html')
  const r = await page.evaluate(async () => {
    const { tape, tapes } = await import('/playground/keep.js')
    const read = async blob => { const b = await blob.arrayBuffer(), v = new DataView(b); return { format: v.getUint16(20, true), k: v.getUint16(22, true), rate: v.getUint32(24, true), bytes: v.getUint32(40, true), data: [...new Float32Array(b, 44)] } }
    // blocks of 3, 1, 4 and 5 frames: part ends at 4, 8, 12 fall inside, at and after them; 13 frames, 3 parts and one held
    const blocks = [3, 1, 4, 5], at = [0]
    for (const n of blocks) at.push(at.at(-1) + n)
    const stereo = tape({ name: 's.wav', sampleRate: 4 })
    blocks.forEach((n, b) => stereo.write([Float32Array.from({ length: n }, (_, i) => at[b] + i), Float32Array.from({ length: n }, (_, i) => -(at[b] + i))]))
    const whole = await read(await stereo.wav(0, null)), slice = await read(await stereo.wav(5, 6)), past = await read(await stereo.wav(11, 10))
    await stereo.drop()
    // mono, one block past a part's end
    const mono = tape({ name: 'm.wav', sampleRate: 4 })
    mono.write([Float32Array.from({ length: 6 }, (_, i) => i / 10)])
    const one = await read(await mono.wav())
    await mono.drop()
    // nothing written: no file
    const none = tape({ name: 'n.wav', sampleRate: 4 })
    const empty = await none.wav()
    await none.drop()
    // closed on: written, never asked for
    const cut = tape({ name: 'cut.wav', sampleRate: 4 })
    cut.write([Float32Array.from({ length: 9 }, (_, i) => i)])
    await cut.flush()
    const found = await tapes(), back = found.length === 1 ? { name: found[0].name, ...await read(found[0].wav) } : null
    for (const t of found) await t.drop()
    return { whole, slice, past, one, empty, back, left: (await tapes()).length }
  })
  const frames = (a, b) => Array.from({ length: b - a }, (_, i) => [a + i, -(a + i)]).flat().map(v => v || 0)
  assert.deepEqual([r.whole.format, r.whole.k, r.whole.rate, r.whole.bytes], [3, 2, 4, 13 * 8], 'IEEE float, 2 channels, its rate, 13 frames')
  assert.deepEqual(r.whole.data.map(v => v || 0), frames(0, 13), 'every sample, in order, interleaved')
  assert.deepEqual(r.slice.data.map(v => v || 0), frames(5, 11), 'from frame 5, 6 of them')
  assert.deepEqual(r.past.data.map(v => v || 0), frames(11, 13), 'asked past the end: what there is')
  assert.equal(r.past.bytes, 2 * 8)
  assert.deepEqual(r.one.data.map(v => +v.toFixed(6)), [0, .1, .2, .3, .4, .5], 'mono, across a part')
  assert.equal(r.empty, null, 'nothing written, no file')
  // a take the page closed on: all of it that reached the disk (the 9th frame was flushed too), under its name
  assert.deepEqual([r.back?.name, r.back?.data], ['cut.wav', [0, 1, 2, 3, 4, 5, 6, 7, 8]])
  assert.equal(r.left, 0, 'its parts let go once kept')
})

// One editor writes at a time: opened in a second tab, it asks; asked, the first stores what it has (a change made a
// moment before) and steps aside, saying where it is now
test('editor: a second tab asks to be the editor; the first stores and steps aside', async () => {
  // two tabs of one browser: one context, its storage theirs
  const context = await browser.newContext(), first = await context.newPage(), second = await context.newPage()
  await chimeLeft(context)
  const script = p => p.evaluate(() => [...document.querySelectorAll('.cm-content .cm-line')].map(l => l.textContent).join('\n'))
  try {
    for (const p of [first, second]) p.on('pageerror', e => errors.push(e.message))
    await first.goto(origin + '/playground/')
    await first.locator('.readout[data-of="all"]').waitFor()
    await first.getByRole('tab', { name: 'Code' }).click()
    await first.locator('.cm-content').click()
    await first.keyboard.press('ControlOrMeta+End')
    await first.keyboard.insertText('.gain(-2)')
    await second.goto(origin + '/playground/')
    // the page asking came up as it was stored, behind the question; once the first has stored, it reads it again
    await Promise.all([second.waitForEvent('load'), second.getByRole('button', { name: 'Use it here' }).click()])
    await second.locator('.readout[data-of="all"]').waitFor()
    assert.match(scriptOf(await script(second)), /\.gain\(-2\)$/, 'the change made a moment before')
    await first.locator('dialog.elsewhere[open]').waitFor()
    // and back, with one click there
    await Promise.all([first.waitForEvent('load'), first.getByRole('button', { name: 'Use it here' }).click()])
    await first.locator('.readout[data-of="all"]').waitFor()
    await second.locator('dialog.elsewhere[open]').waitFor()
    assert.match(scriptOf(await script(first)), /\.gain\(-2\)$/)
  } finally { await context.close() }
})

// Every setting kept comes back as it was kept; a value the page no longer has, its default; a store that does not read
// is set aside, not written over
test('editor: every setting comes back as it was kept; one the page no longer has, its default', async () => {
  const all = { display: 'spec', scale: 'mel', format: 'flac', encoding: { markers: false, bitDepth: 24 }, spec: 'podcast', cuts: { format: 'otio', fps: 25 }, side: 'code', show: { hits: false, gain: false, meters: false, spectrum: false, keys: false, guides: false }, units: 'samples', snap: false, curve: 'cos', levels: 'db', ruler: 'ticks', step: 3, look: { map: 'magma', gamma: .5, depth: 100, size: 2048, method: 'bands' }, wave: { colour: 'centroid', lanes: 'one', fill: 'flat', map: 'magma', weighting: 'k' }, agent: { url: 'http://127.0.0.1:7778', key: '' }, splice: 20, scrub: 'grains', grip: 'speed' }
  await page.addInitScript(all => { if (!sessionStorage.seeded) { sessionStorage.seeded = 1; localStorage.setItem('audio-repl', JSON.stringify({ ...all, docs: [{ code: "audio('chime.wav')" }] })) } }, all)
  await open()
  const kept = () => page.evaluate(() => JSON.parse(localStorage.getItem('audio-repl')))
  const now = await kept()
  for (const [key, value] of Object.entries(all)) assert.deepEqual(now[key], value, key)
  // written from another page of the site, so the editor's own store as it closes doesn't write over it
  const seed = async value => { await page.goto(origin + '/blank.html'); await page.evaluate(v => localStorage.setItem('audio-repl', v), value); await page.goto(origin + '/playground/') }
  await seed(JSON.stringify({ units: 'bogus', ruler: 7, step: 'x', format: 'wma', look: { map: 'nope', gamma: 2 }, spec: 'radio', docs: [{ code: 5 }, { code: "audio('chime.wav')" }] }))
  await wholeLevels().waitFor()
  const fixed = await kept()
  assert.deepEqual([fixed.units, fixed.ruler, fixed.step, fixed.format, fixed.look.map, fixed.look.gamma, fixed.spec, fixed.docs.length], ['clock', 'labels', 1, 'wav', 'grey', 1, '', 1])
  // unreadable, set aside: the page as a first visit finds it, an empty tab
  await seed('{"docs": [{"code": "audio(\'chime.wav\')"')
  await page.locator('.empty').waitFor()
  assert.equal(await page.evaluate(() => localStorage.getItem('audio-repl-unread')), '{"docs": [{"code": "audio(\'chime.wav\')"')
})

// The level axis: each level under its tick, in dB or as the sample values; Ctrl and the wheel on it zooms the levels,
// so a quiet sound fills the lane, and 0 shows full scale again
test('editor: the level axis reads in dB or sample values, and zooms', async () => {
  await open()
  await write(`audio.from(t => 0.05 * Math.sin(2 * Math.PI * 220 * t), { duration: 1 })`)
  await lengthIs('0:01.000')
  await page.waitForTimeout(300)
  // the pointer on the axis at the lane's middle, 0: the levels zoom about it
  const box = await page.locator('.plot').boundingBox(), ax = box.x + box.width - 26, ay = box.y + tall(box) / 2
  // the waveform's height: bright pixels down the middle column
  const height = () => pixels(`const x = w >> 1; let n = 0; for (let y = 0; y < h - 48; y++) { const i = (y * w + x) * 4; if (d[i] > 120) n++ } return n`)
  const before = await height()
  await page.mouse.move(ax, ay)
  // (a quarter as keen as time's zoom: four turns for one of time's)
  for (let i = 0; i < 24; i++) { await page.keyboard.down('Control'); await page.mouse.wheel(0, -100); await page.keyboard.up('Control') }
  await page.waitForTimeout(300)
  const zoomed = await height()
  assert.ok(zoomed > before * 4, `the quiet sine fills the lane: ${before} → ${zoomed} px`)
  await page.locator('.plot').focus()
  await page.keyboard.press('0')
  await page.waitForTimeout(300)
  assert.ok(Math.abs(await height() - before) <= 2, 'full scale again')
  // full scale a detent: a few small steps, as a trackpad's pinch gives as the fingers lift, leave it there (they once
  // left it at once, the levels unsnapping as the pinch ended); gathered past 5 px, they zoom in
  await page.mouse.move(ax, ay)
  for (let i = 0; i < 3; i++) { await page.keyboard.down('Control'); await page.mouse.wheel(0, -5); await page.keyboard.up('Control') }
  await page.waitForTimeout(300)
  assert.ok(Math.abs(await height() - before) <= 2, 'held at full scale')
  for (let i = 0; i < 80; i++) { await page.keyboard.down('Control'); await page.mouse.wheel(0, -10); await page.keyboard.up('Control') }
  await page.waitForTimeout(300)
  assert.ok(await height() > before * 1.5, 'small steps zoom in')
  // in sample values: the pointer on the lane's top edge reads 1
  await settings('Levels in', 'Sample values')
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('audio-repl')).levels), 'linear')
})

// What goes over full scale: the time row underlined red where the output clips (stat('clipping')), and zoomed out, the
// levels past ±1 tinted red
test('editor: where the output clips is underlined red on the time row; zoomed out, past full scale is red', async () => {
  await open()
  await write(`audio.from(t => (t > 0.5 ? 1.5 : 0.5) * Math.sin(2 * Math.PI * 220 * t), { duration: 1 })`)
  await lengthIs('0:01.000')
  await page.waitForTimeout(800)
  const box = await page.locator('.plot').boundingBox(), h = box.height - 22, w = box.width - (await gutter())
  // red pixels along the time row's top, under the room: their first and last x, as a share of the plot's width
  const red = () => pixels(`const y = Math.round(arg + 1), xs = []; for (let x = 0; x < w; x++) { const i = (y * w + x) * 4; if (d[i] - d[i + 2] > 80 && d[i] > 120) xs.push(x) } return xs.length ? [xs[0], xs.at(-1)] : []`, h)
  const [first, last] = await red()
  assert.ok(Math.abs(first / w - .5) < .03 && last / w > .95, `clipping from ${first / w} to ${last / w} of the width`)
  // zoomed out past full scale: a red tint over what lies beyond ±1
  const tint = () => pixels(`const x = Math.round(arg), y = 3, i = (y * w + x) * 4; return d[i] - d[i + 2]`, w * .25)
  const flat = await tint()
  await page.mouse.move(box.x + box.width - 26, box.y + tall(box) / 2)
  for (let i = 0; i < 4; i++) { await page.keyboard.down('Control'); await page.mouse.wheel(0, 60); await page.keyboard.up('Control') }
  await page.waitForTimeout(300)
  assert.ok(await tint() > flat + 3, 'past full scale, red')
})

// The pointer goes while an operation draws what it does: holding the caret to hear it, dragging a range
test('editor: the pointer hides while the caret sounds, and comes back', async () => {
  await open()
  const { box, x } = await axis(6.525), row = box.y + box.height - 8, cursor = () => page.locator('.plot').evaluate(el => el.style.cursor)
  await page.mouse.move(x(3), row)
  await page.mouse.down()
  assert.equal(await cursor(), 'none')
  await page.mouse.move(x(3.2), row, { steps: 3 })
  assert.equal(await cursor(), 'none')
  await page.mouse.up()
  assert.notEqual(await cursor(), 'none')
})

// Esc closes the fade menu, and nothing else: the selection it was opened from stays
// The meters stand clear: the waveform, the cues and the pitch curve end before the level bar, never behind it
test('editor: nothing is drawn behind the meters', async () => {
  await page.addInitScript(code => localStorage.setItem('audio-repl', JSON.stringify({ code, side: null, show: { hits: true, pitch: true, gain: true, meters: true } })), CHIME)
  await open()
  await write(`audio.from(t => 0.8 * Math.sin(2 * Math.PI * 220 * t), { duration: 1 })`)
  await lengthIs('0:01.000')
  await page.waitForTimeout(800)
  const box = await page.locator('.plot').boundingBox(), w = box.width - (await gutter())
  // bright pixels down a column of the lanes
  const lit = at => pixels(`const x = Math.round(arg); let n = 0; for (let y = 0; y < h - 30; y++) { const i = (y * w + x) * 4; if (d[i] + d[i + 1] + d[i + 2] > 300) n++ } return n`, at)
  assert.ok(await lit(w - 40) > 20, 'the waveform runs up to the meters')
  assert.equal(await lit(w - 9), 0, 'and stops before the level bar')
  // all of it shown, its end 4 px short of where the lanes end (view.js TAIL), SPACE (6 px) before the bar, as before
  // the spectrum on the spectrogram: its last moment in sight, never behind the meters
  assert.ok(await lit(w - 19) > 20, 'its last moment by the bar')
  assert.equal(await lit(w - 17), 0, 'its end 10 px before it')
  await show('spec')
  await page.waitForTimeout(800)
  assert.ok(await lit(w - 56) > 0, 'its last moment by the spectrum')
  assert.equal(await lit(w - 54), 0, 'its end 10 px before it')
})

// Crop is clicked, never dragged, so it is no handle: the context menu has it, and K
test('editor: the context menu, or K, keeps only the selection', async () => {
  await open()
  await noCues()
  await write(`audio('chime.wav')`)
  await lengthIs('0:08.000')
  const { box, x } = await axis(8), y = box.y + tall(box) * .3
  await drag([x(2), y], [x(4) - x(2), 0])
  await page.mouse.click(x(3), y, { button: 'right' })
  await page.locator('.menubar-menu .menu-row', { has: page.locator('.menu-label', { hasText: /^Crop$/ }) }).click()
  await page.waitForFunction(() => /\.crop\(\{ at: 2(\.0\d*)?, d: 2(\.0\d*)? \}\)$/.test(scriptText().trim()))
  await lengthIs('0:02.000')
  await page.keyboard.press('ControlOrMeta+Z')
  await lengthIs('0:08.000')
  await page.mouse.click(x(7.5), y)
  await drag([x(5), y], [x(6) - x(5), 0])
  await page.keyboard.press('k')
  await page.waitForFunction(() => /\.crop\(\{ at: 5(\.0\d*)?, d: 1(\.0\d*)? \}\)$/.test(scriptText().trim()))
  await lengthIs('0:01.000')
})

// A selection moved to a track of its own (the context menu): a lane each, the sound as long as before; the new track
// edited, its steps the edits'. A press in the other lane edits that track: Delete takes out of it alone. The
// track deleted (the Edit menu), one sound again; undone, the tracks again
test('editor: a selection moved to a track of its own, a lane each, each edited apart', async () => {
  await open()
  await noCues()
  await write(`audio('chime.wav')`)
  await lengthIs('0:08.000')
  // the edits' first card, the sound they start from, the panel open or not
  const card = () => page.locator('.steps-list .step-name').first().textContent()
  // in the sound's lanes before there are tracks; then each track's lane's middle, the edited one's tall, the other's a
  // strip, as their layers have them
  let { box, x } = await axis(8), mid = async i => (r => r.y + r.h / 2)((await tracksAt())[i])
  await drag([x(2), box.y + tall(box) / 4], [x(3) - x(2), 0])
  await menu('Track', 'Move to a new track')
  await page.waitForFunction(() => scriptText().includes('let chime2 = '))
  assert.equal(await code(), `let chime = audio('chime.wav')\n  .gain(-Infinity, { at: 2, d: 1 })\n\nlet chime2 = audio('chime.wav')\n  .crop({ at: 2, d: 1 })\n  .pad(2, 0)`)
  await page.waitForFunction(() => document.querySelector('.steps-list .step-name')?.textContent === 'chime2 · chime.wav')
  // its output: a lane each, the lower the piece alone, nothing after it where the upper has the sound
  await page.waitForFunction(() => document.querySelector('.plot').dataset.tracks === '2')
  await lengthIs('0:08.000')
  await page.waitForTimeout(600)
  // (the layers beside the picture now, the picture after them)
  ;({ box, x } = await axis(8))
  const [u, l] = await tracksAt()
  const [upper, lower] = await pixels(`const k = w / arg.width, lit = [0, 0]
    for (let y = 0; y < Math.round(arg.foot * k); y++) for (let x = Math.round(arg.a * k); x < Math.round(arg.b * k); x++) { const i = (y * w + x) * 4; if (d[i] + d[i + 1] + d[i + 2] > 300) lit[y < arg.mid * k ? 0 : 1]++ }
    return lit`, { width: box.width, mid: l.y - box.y, foot: l.y + l.h - box.y, a: x(4.5) - box.x, b: x(7) - box.x })
  assert.ok(upper > 200 && lower < upper / 20, `4.5 s to 7 s: the upper lane ${upper} lit, the lower ${lower}`)
  assert.equal(await selected(), '0:02.000–0:03.000', 'the piece stays selected, in its own lane')
  // the upper lane: the first track's, a range deleted there alone
  await page.mouse.click(x(6), await mid(0))
  await page.waitForFunction(() => document.querySelector('.steps-list .step-name')?.textContent === 'chime · chime.wav')
  await drag([x(5), await mid(0)], [x(6) - x(5), 0])
  await page.keyboard.press('Backspace')
  await page.waitForFunction(() => /\.gain\(-Infinity, \{ at: 2, d: 1 \}\)\n {2}\.remove\(\{ at: 5, d: 1(, xfade: [\d.]+)? \}\)\n\nlet chime2/.test(scriptText()))
  await lengthIs('0:07.000')
  // the lower lane's track taken away: one sound, its steps as they were
  await page.mouse.click(x(1), await mid(1))
  await page.waitForFunction(() => document.querySelector('.steps-list .step-name')?.textContent === 'chime2 · chime.wav')
  await menu('Track', 'Delete the track')
  await page.waitForFunction(() => !scriptText().includes('chime2'))
  assert.equal(await card(), 'chime.wav')
  await page.waitForFunction(() => !('tracks' in document.querySelector('.plot').dataset))
  await page.keyboard.press('ControlOrMeta+Z')
  await page.waitForFunction(() => scriptText().includes('let chime2 = ') && document.querySelector('.plot').dataset.tracks === '2')
})

// A range dragged on the time row runs through every track's lane, as a DAW's ruler selects: Delete takes it out of each,
// one step, so they stay in time. A range in a lane is that track's: ⌘-dragged up into the other lane, its audio goes
// into that track over what is there (write(), its sound written out), silence where it was, that track edited then
test('editor: a range on the time row is every track\'s; a selection ⌘-dragged into another lane goes into that track', async () => {
  await open()
  await noCues()
  await write(`let a = audio('chime.wav')\n\nlet b = audio('chime.wav')`)
  await page.waitForFunction(() => document.querySelector('.plot').dataset.tracks === '2')
  await lengthIs('0:08.000')
  // the lanes' middles, as their layers have them; the time row under them
  const { box, x } = await axis(8), mid = async i => (r => r.y + r.h / 2)((await tracksAt())[i]), row = box.y + box.height - 11
  await drag([x(2), row], [x(3) - x(2), 0])
  assert.equal(await selected(), '0:02.000–0:03.000')
  await page.keyboard.press('Backspace')
  await page.waitForFunction(() => (scriptText().match(/\.remove\(\{ at: 2, d: 1(, xfade: [\d.]+)? \}\)/g) || []).length === 2)
  await lengthIs('0:07.000')
  await page.keyboard.press('ControlOrMeta+Z')
  await page.waitForFunction(() => !scriptText().includes('remove'))
  await lengthIs('0:08.000')
  // the lower lane's own range, ⌘-dragged up into the upper lane, 4 s on
  await page.mouse.click(x(6), await mid(1))
  const top = await mid(0), bottom = await mid(1)
  await drag([x(1), bottom], [x(2) - x(1), 0])
  await page.keyboard.down('ControlOrMeta')
  await drag([x(1.5), bottom], [x(5.5) - x(1.5), top - bottom])
  await page.keyboard.up('ControlOrMeta')
  await page.waitForFunction(() => scriptText().includes('.write('))
  assert.equal(await code(), `let a = audio('chime.wav')\n  .write(audio('chime.wav').crop({ at: 1, d: 1 }), { at: 5 })\n\nlet b = audio('chime.wav')\n  .gain(-Infinity, { at: 1, d: 1 })`)
  await page.waitForFunction(() => document.querySelector('.steps-list .step-name')?.textContent === 'a · chime.wav')
  assert.equal(await selected(), '0:05.000–0:06.000', 'the piece selected where it landed, in the track it went to')
})

// Tabs play at once, as a browser's do: one left playing plays on, its speaker on its tab; a press on the speaker mutes
// it, crossed out, and again hears it
test('editor: tabs play at once, each playing its speaker on its tab, a press on it muting it', async () => {
  await open()
  const speakers = () => page.evaluate(() => [...document.querySelectorAll('.files .file')].map(f => f.querySelector('.file-sound')?.getAttribute('aria-pressed') ?? null))
  await page.getByRole('button', { name: 'Loop', exact: true }).click()
  await page.getByRole('button', { name: 'Play', exact: true }).click()
  await page.waitForFunction(() => document.querySelector('.file.current .file-sound'))
  await page.getByRole('button', { name: 'New tab', exact: true }).click()
  await write(`audio('chime.wav').gain(-6)`)
  await wholeLevels().waitFor()
  assert.deepEqual(await speakers(), ['false', null], 'the tab left plays on')
  await page.getByRole('button', { name: 'Play', exact: true }).click()
  await page.waitForFunction(() => document.querySelectorAll('.file .file-sound').length === 2)
  await page.locator('.files .file').first().locator('.file-sound').click()
  assert.deepEqual(await speakers(), ['true', 'false'], 'the first muted, playing on')
  await page.locator('.files .file').first().locator('.file-sound').click()
  assert.deepEqual(await speakers(), ['false', 'false'])
  // shown again, it plays as it was left: its Play a pause
  await page.locator('.files [role=tab]').first().click()
  await page.getByRole('button', { name: 'Pause', exact: true }).waitFor()
  await page.getByRole('button', { name: 'Pause', exact: true }).click()
  await page.waitForFunction(() => !document.querySelector('.file.current .file-sound') && document.querySelectorAll('.file .file-sound').length === 1)
  // the other, playing on, closed: what it played stops with it, nothing sounding
  await page.locator('.files .file').nth(1).locator('.file-close').click()
  await page.waitForFunction(() => document.querySelectorAll('.files .file').length === 1 && !document.querySelector('.file .file-sound'))
})

// A track with steps moved out of: the steps are both parts', written once in the sound both copy, and each part's edits
// list them first, the tracks sharing them said under them; the steps after are its own. The other part deleted, the
// shared steps go back into the one left
test('editor: the steps two tracks share are written once, listed in each, said to be shared', async () => {
  await open()
  await noCues()
  await write(`audio('chime.wav')\n  .gain(-3)`)
  await lengthIs('0:08.000')
  const { box, x } = await axis(8), top = box.y + (box.height - 22) * .25
  await drag([x(2), top], [x(3) - x(2), 0])
  await menu('Track', 'Move to a new track')
  await page.waitForFunction(() => scriptText().includes('let chime2 = '))
  assert.equal(await code(), `let chimeTake = audio('chime.wav')\n  .gain(-3)\n\nlet chime = chimeTake.clone()\n  .gain(-Infinity, { at: 2, d: 1 })\n\nlet chime2 = chimeTake.clone()\n  .crop({ at: 2, d: 1 })\n  .pad(2, 0)`)
  await page.waitForFunction(() => document.querySelector('.plot').dataset.tracks === '2')
  await lengthIs('0:08.000')
  // the new track's edits (the panel open or not): the sound, the shared gain, the caption under it, then its own crop and pad
  const cards = () => page.evaluate(() => [...document.querySelectorAll('.steps-list > li')].map(li => [li.querySelector('.step-name')?.textContent, li.classList.contains('shared'), li.dataset.shared ?? '']))
  await page.waitForFunction(() => document.querySelectorAll('.steps-list > li').length === 4)
  assert.deepEqual(await cards(), [['chime2 · chime.wav', true, ''], ['Gain', true, 'Shared with chime'], ['Crop', false, ''], ['Pad', false, '']])
  // the other track's (its lane a strip over the edited one's): the same shared steps, its own after
  await page.mouse.click(x(6), (r => r.y + r.h / 2)((await tracksAt())[0]))
  await page.waitForFunction(() => document.querySelector('.steps-list .step-name')?.textContent === 'chime · chime.wav')
  assert.deepEqual(await cards(), [['chime · chime.wav', true, ''], ['Gain', true, 'Shared with chime2'], ['Gain', false, '']])
  // that track deleted: one sound, the shared steps back in the chain of the one left
  await menu('Track', 'Delete the track')
  await page.waitForFunction(() => !scriptText().includes('chimeTake'))
  assert.equal(await code(), `let chime2 = audio('chime.wav')\n  .gain(-3)\n  .crop({ at: 2, d: 1 })\n  .pad(2, 0)`)
  await page.waitForFunction(() => !('tracks' in document.querySelector('.plot').dataset))
})

// A track ending before the mix runs on in its lane: no rule at its end, its centre line stopping there, which says so;
// a double-click on its sound keeps to it, one past it takes the time from its end on, as a pause; one on a lane not
// edited, before its cues are found, keeps to the sound between its pauses
test('editor: a track ends where its sound does, its lane running on past it', async () => {
  await open()
  await noCues()
  await write(`audio('chime.wav')`)
  await lengthIs('0:08.000')
  await write(`let chime = audio('chime.wav')\n  .gain(-Infinity, { at: 2, d: 1 })\n\nlet chime2 = audio('chime.wav')\n  .crop({ at: 2, d: 1 })\n  .pad(2, 0)`)
  await page.waitForFunction(() => document.querySelector('.plot').dataset.tracks === '2')
  await lengthIs('0:08.000')
  await page.waitForTimeout(600)
  // the lanes' middles, as their layers have them: the upper a strip, the lower, edited, tall
  const { box, x } = await axis(8), mid = async i => (r => r.y + r.h / 2)((await tracksAt())[i]), [, l] = await tracksAt()
  // past the lower track's end, nothing bright in its lane: neither its centre line nor a rule
  const lower = await pixels(`const k = w / arg.width; let n = 0
    for (let y = Math.round(arg.top * k); y < Math.round(arg.foot * k); y++) for (let x = Math.round(arg.a * k); x < Math.round(arg.b * k); x++) { const i = (y * w + x) * 4; if (d[i] + d[i + 1] + d[i + 2] > 300) n++ }
    return n`, { width: box.width, top: l.y - box.y, foot: l.y + l.h - box.y, a: x(3.2) - box.x, b: x(7.5) - box.x })
  assert.equal(lower, 0, 'past its end the lower lane is plain')
  await page.mouse.dblclick(x(2.6), await mid(1))
  await page.waitForFunction(() => /–0:03\.000:/.test((e => e.title || e.dataset.tip || '')(document.querySelector('.clock'))))
  await page.mouse.dblclick(x(5), await mid(1))
  await page.waitForFunction(() => (e => e.title || e.dataset.tip || '')(document.querySelector('.clock')).startsWith('Selected 0:03.000–0:08.000:'))
  await page.mouse.click(x(6), await mid(0))
  await page.waitForFunction(() => document.querySelector('.steps-list .step-name')?.textContent === 'chime · chime.wav')
  // the lower, a strip now, double-clicked: it is edited at the first press, tall from where it was, the second in it still
  await page.mouse.dblclick(x(2.9), await mid(1))
  const [a, b] = (await selected()).split('–').map(t => +t.split(':')[1])
  assert.ok(a > 1.9 && b === 3, `the piece, not from the start: ${a}–${b}`)
})

// Editing pitch is a mode, not a setting: one stored by an earlier page is not on when it opens
test('editor: pitch editing is off when the page opens', async () => {
  await page.addInitScript(code => localStorage.setItem('audio-repl', JSON.stringify({ code, pitch: true })), CHIME)
  await open()
  await page.locator('.menubar-item', { hasText: /^View$/ }).click()
  await menuRow('Show').click()
  assert.equal(await menuRow('Pitch curve').getAttribute('aria-checked'), 'false')
  await page.keyboard.press('Escape')
})

// The voice split to a track of its own (the context menu at the caret, or the Edit menu): the model's voice there, the
// rest here, the new one edited, the model the GPU's where there is one; undone, one sound. Its sound is the engine test's (the voice split… sounds as before)
test('editor: the voice split to a track of its own, edited apart, undone in one step', async () => {
  await page.route(/huggingface\.co/, route => route.abort())
  await open()
  await noCues()
  await write(`audio('chime.wav')`)
  await lengthIs('0:08.000')
  const { box, x } = await axis(8)
  await page.mouse.click(x(1), box.y + tall(box) * .3)
  await menu('Track', 'Split the voice to a new track')
  await page.waitForFunction(() => scriptText().includes('let voice = '))
  // headless Chromium's WebGPU is SwiftShader, on the CPU: the split takes SCNet-large there (Mel-RoFormer on a GPU)
  assert.equal(await code(), `let chime = audio('chime.wav')\n  .vocals('remove', { model: 'scnet-large' })\n\nlet voice = audio('chime.wav')\n  .vocals({ model: 'scnet-large' })`)
  await page.waitForFunction(() => document.querySelector('.steps-list .step-name')?.textContent === 'voice · chime.wav')
  await page.keyboard.press('ControlOrMeta+Z')
  await page.waitForFunction(() => !scriptText().includes('voice'))
  await menu('Track', 'Split the voice to a new track')
  await page.waitForFunction(() => scriptText().includes('let voice = '))
})

// A part taken elsewhere and brought back: a track exported alone, named after it; another lined up with it (the Edit
// menu), its sound written out as the reference, so both stay tracks
test('editor: a track exported alone; another lined up with it, both tracks still', async () => {
  await open()
  await write(`let chime = audio('chime.wav')\n\nlet late = audio('chime.wav')\n  .pad(0.25, 0)`)
  await page.waitForFunction(() => document.querySelector('.plot').dataset.tracks === '2')
  await page.waitForFunction(() => document.querySelector('.steps-list .step-name')?.textContent === 'late · chime.wav')
  const [d] = await Promise.all([page.waitForEvent('download'), menu('File', 'Export as', 'The track alone')])
  assert.match(d.suggestedFilename(), /-late\.\w+$/)
  const alone = await audio(await readFile(await d.path()))
  await alone.read()
  assert.ok(Math.abs(alone.duration - 8.25) < .01, `that track alone, 0.25 s late: ${alone.duration} s`)
  await menu('Track', 'Line up with', 'chime')
  await page.waitForFunction(() => scriptText().includes('.align('))
  assert.equal(await code(), `let chime = audio('chime.wav')\n\nlet late = audio('chime.wav')\n  .pad(0.25, 0)\n  .align(audio('chime.wav'))`)
  await page.waitForFunction(() => document.querySelector('.plot').dataset.tracks === '2')
  await lengthIs('0:08.000')
})

// Automix: a bed ducked under the voice (Edit › Duck under, the key read by name, both still tracks), a master added
// (Edit › Add a master: the tracks' sum, a lane of its own, edited as one), taken away again (Delete the track)
test('editor: a bed ducked under the voice, a master over both, a lane of its own', async () => {
  await open()
  await write(`let chime = audio('chime.wav')\n\nlet bed = audio('chime.wav')\n  .gain(-12)`)
  await page.waitForFunction(() => document.querySelector('.plot').dataset.tracks === '2')
  await page.waitForFunction(() => document.querySelector('.steps-list .step-name')?.textContent === 'bed · chime.wav')
  await menu('Track', 'Duck under', 'chime')
  await page.waitForFunction(() => scriptText().includes('.ducker('))
  assert.equal(await code(), `let chime = audio('chime.wav')\n\nlet bed = audio('chime.wav')\n  .gain(-12)\n  .ducker({ key: chime, range: -15 })`)
  await page.waitForFunction(() => document.querySelector('.plot').dataset.tracks === '2')
  await menu('Track', 'Add a master')
  await page.waitForFunction(() => scriptText().includes('.clone().mix('))
  assert.equal(await code(), `let chime = audio('chime.wav')\n\nlet bed = audio('chime.wav')\n  .gain(-12)\n  .ducker({ key: chime, range: -15 })\n\nchime.clone().mix(bed)`)
  await page.waitForFunction(() => document.querySelector('.plot').dataset.tracks === '3')
  await lengthIs('0:08.000')
  await menu('Track', 'Delete the track')
  await page.waitForFunction(() => !scriptText().includes('.clone()'))
  await page.waitForFunction(() => document.querySelector('.plot').dataset.tracks === '2')
})

// A link's script with tracks opens in a new page with none of them chosen: the page comes up on its last lane (the
// master, here), nothing thrown on the way (it threw before the page's state was made: Cannot access 'listening')
test('editor: a link to a script with tracks and a master opens, the master edited', async () => {
  const errors = []
  page.on('pageerror', e => errors.push(e.message))
  await page.goto(origin + '/blank.html')
  const url = await page.evaluate(async text => {
    const bytes = new Uint8Array(await new Response(new Blob([text]).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer())
    return location.origin + '/playground/#code=' + btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  }, `let chime = audio('chime.wav')\n\nlet bed = audio('chime.wav')\n  .ducker({ key: chime })\n\nchime.clone().mix(bed)\n  .gain(-6)`)
  await page.goto(url)
  await page.waitForFunction(() => document.querySelector('.plot')?.dataset.tracks === '3')
  await page.waitForFunction(() => [...document.querySelectorAll('.steps-list .step-name')].some(n => n.textContent.includes('Gain')))
  assert.deepEqual(errors, [])
})

// A marker is its track's, in its lane's strip: one a track not edited set is taken away from its triangle all the
// same, its mark() gone
test('editor: with tracks, a marker of a track not edited is taken away from its triangle', async () => {
  await open()
  await write(`let a = audio('chime.wav')\n  .mark(1, 'here')\n\nlet b = audio('chime.wav')\n  .gain(-6)`)
  await page.waitForFunction(() => document.querySelector('.plot').dataset.tracks === '2')
  await lengthIs('0:08.000')
  // its triangle in the strip under its lane
  const { x } = await axis(8), [a] = await tracksAt()
  await page.mouse.click(x(1), a.y + a.h + FOOT / 2, { button: 'right' })
  await contextRow('Delete the marker').click()
  await page.waitForFunction(() => !scriptText().includes('.mark('))
  assert.match(await code(), /^let a = audio\('chime.wav'\)\s*let b = audio\('chime.wav'\)\n {2}\.gain\(-6\)$/)
})

// A marker is its track's alone: a double-click in another track's lane goes past it, in its own stops at it; a press
// on its line edits its track
test('editor: with tracks, a track\'s markers are its own', async () => {
  await open()
  await write(`let a = audio('chime.wav')\n  .mark(1)\n\nlet b = audio('chime.wav')\n  .gain(-6)`)
  await page.waitForFunction(() => document.querySelector('.plot').dataset.tracks === '2')
  await lengthIs('0:08.000')
  await page.waitForFunction(() => document.querySelector('.steps-list .step-name')?.textContent === 'b · chime.wav')
  // the lanes' middles, as their layers have them; a's marker's line down its lane
  const { box, x } = await axis(8), mid = async i => (r => r.y + r.h / 2)((await tracksAt())[i])
  const from = async () => +(await selected()).split('–')[0].split(':')[1]
  await page.mouse.dblclick(x(1.05), await mid(1))
  assert.ok(await from() < .99, `b's fragment from ${await from()}, past a's marker`)
  await page.mouse.dblclick(x(1.05), await mid(0))
  await page.waitForFunction(() => document.querySelector('.steps-list .step-name')?.textContent === 'a · chime.wav')
  assert.equal(await from(), 1, 'a\'s fragment from its marker')
  await page.mouse.click(x(6), await mid(1))
  await page.waitForFunction(() => document.querySelector('.steps-list .step-name')?.textContent === 'b · chime.wav')
  await page.mouse.click(x(1), box.y + 4)
  await page.waitForFunction(() => document.querySelector('.steps-list .step-name')?.textContent === 'a · chime.wav')
  assert.equal(await page.locator('.time').innerText(), '0:01.000', 'the caret on it')
})

// With tracks, the caret is the edited track's: out of sight, it stays at the edge in that track's lane, none in
// another's; its chevron on the time row, which runs under them all
test('editor: with tracks, the caret out of sight stays at the edge in its track\'s lane', async () => {
  await open()
  await noCues()
  await write(`let a = audio('chime.wav')\n\nlet b = audio('chime.wav')\n  .gain(-6)`)
  await page.waitForFunction(() => document.querySelector('.plot').dataset.tracks === '2')
  await lengthIs('0:08.000')
  await page.waitForFunction(() => document.querySelector('.steps-list .step-name')?.textContent === 'b · chime.wav')
  // the lanes' middles, as their layers have them: a's a strip, b's, edited, tall
  const box = await page.locator('.plot').boundingBox(), w = box.width - (await gutter()), [a, b] = await tracksAt(), top = a.y + a.h / 2, bottom = b.y + b.h / 2
  await page.mouse.move(box.x + w / 2, bottom)
  for (let i = 0; i < 7; i++) { await page.keyboard.down('Control'); await page.mouse.wheel(0, -120); await page.keyboard.up('Control') }
  await page.mouse.click(box.x + w / 2, bottom)
  await page.mouse.wheel(0, w * 3)
  await page.waitForTimeout(100)
  await page.mouse.move(box.x + w / 2, box.y + 4)
  // the overlay's opacity at the lanes' left edge, a row px down the plot
  const edge = py => page.evaluate(py => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(() => {
    const cv = document.querySelector('.plot canvas.overlay'), k = cv.width / cv.getBoundingClientRect().width
    done(cv.getContext('2d').getImageData(0, Math.round(py * k), 1, 1).data[3])
  }))), py)
  assert.ok(await edge(bottom - box.y) > 0, 'at the edge of b\'s lane')
  assert.equal(await edge(top - box.y), 0, 'none in a\'s')
  // its chevron at the foot of its line in b's lane
  await page.mouse.move(box.x + 6, b.y + b.h - 7)
  assert.equal(await page.locator('.plot').evaluate(e => e.style.cursor), 'pointer', 'its chevron at its line\'s foot')
})

// Dragged into another track, a piece shows there as it goes, over what it covers, and where it left, silence; let go,
// both stay so at once, frozen (veiled, a light passing along, nothing pressed there) till the output comes, as Suno
// Studio's parts calculating; it was gone from both till then
test('editor: a piece dragged into another track shows there as it goes; dropped, both lanes as they will be, frozen till done', async () => {
  await open()
  await noCues()
  await write(`let a = audio('chime.wav')\n\nlet b = audio.from(t => 0, { duration: 8 })`)
  await page.locator('.layer').nth(1).waitFor()
  // a edited (a press in its strip), its lane tall, b's a strip under it, as their layers have them
  const { box, x } = await axis(8)
  await page.mouse.click(x(6), (r => r.y + r.h / 2)((await tracksAt())[0]))
  await page.waitForFunction(() => document.querySelector('.steps-list .step-name')?.textContent === 'a · chime.wav')
  const mid = (await tracksAt()).map(r => r.y + r.h / 2)
  // bright pixels in a lane's upper half, as the lanes are laid out then, off its centre line, over [t0, t1], the caret's
  // line at its start left out, whichever side of x(t0) it rounds to (bright: a track's colour, its waveform's, is lit at
  // 400 as the screen's white at 540)
  const lit = async (k, t0, t1) => { const r = (await tracksAt())[k]; return pixels(`let n = 0; for (let y = Math.round(arg.top); y < arg.mid - 4; y++) for (let x = arg.x0; x < arg.x1; x++) { const i = (y * w + x) * 4; if (d[i] + d[i + 1] + d[i + 2] > 400) n++ } return n`,
    { top: r.y - box.y, mid: r.y + r.h / 2 - box.y, x0: Math.floor(x(t0) - box.x) + 2, x1: Math.round(x(t1) - box.x) }) }
  await drag([x(1), mid[0]], [x(3) - x(1), 0])
  const before = [await lit(0, 1, 3), await lit(1, 4, 6)]
  assert.ok(before[0] > 100 && before[1] === 0, `the chime in a, silence in b: ${before}`)
  await page.mouse.move(x(2), mid[0])
  await page.mouse.down()
  for (let i = 1; i <= 8; i++) await page.mouse.move(x(2 + 3 * i / 8), mid[0] + (mid[1] - mid[0]) * i / 8)
  await page.waitForTimeout(200)
  const going = [await lit(0, 1, 3), await lit(1, 4, 6)]
  assert.ok(going[0] < before[0] / 10 && going[1] > 20, `a silent where it was, b (a strip) with it where it goes: ${going}`)
  // the most lights at once from the drop on, each frame (the edit may be made a frame or two after)
  await page.evaluate(() => { window.__veils = 0; const look = () => { window.__veils = Math.max(window.__veils, document.querySelectorAll('.plot .veil:not([hidden])').length); if (!window.__veiled) requestAnimationFrame(look) }; requestAnimationFrame(look) })
  await page.mouse.up()
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))))
  const [left, landed] = [await lit(0, 1, 3), await lit(1, 4, 6)]
  assert.ok(left < before[0] / 10 && landed > 20, `let go, at once as it will be: ${left}, ${landed}`)
  assert.equal(await page.evaluate(() => (window.__veiled = true, window.__veils)), 2, 'where it left and where it went, a light along them while they are made')
  await page.waitForFunction(() => /let b = audio\.from\(t => 0, \{ duration: 8 \}\)\n  \.write\(audio\('chime\.wav'\)\.crop\(\{ at: 1, d: 2 \}\), \{ at: 4 \}\)/.test(scriptText()))
  await page.waitForFunction(() => !document.querySelector('.plot .veil:not([hidden])'))
})

// A slice of a track dragged onto the tabs: a tab of that track's alone, its chain cropped to it
test('editor: with tracks, a slice dragged onto the tabs is the edited track\'s alone', async () => {
  await open()
  await noCues()
  await write(`let a = audio('chime.wav')\n\nlet b = audio('chime.wav')\n  .gain(-6)`)
  await page.waitForFunction(() => document.querySelector('.plot').dataset.tracks === '2')
  await lengthIs('0:08.000')
  // b's lane's middle, edited, tall under a's strip
  const { box, x } = await axis(8), y = (r => r.y + r.h / 2)((await tracksAt())[1]), files = await page.locator('.files').boundingBox()
  await drag([x(1), y], [x(2) - x(1), 0])
  await keyed(['Alt'], () => drag([x(1.5), y], [files.x + files.width / 2 - x(1.5), files.y + files.height / 2 - y]))
  await page.waitForFunction(() => document.querySelectorAll('.file').length === 2)
  await page.waitForFunction(() => scriptText() === "audio('chime.wav')\n  .gain(-6)\n  .crop({ at: 1, d: 1 })")
  await lengthIs('0:01.000')
})

// The edited track flattened (a row's menu): that track's chain made one sound, its own (not another its chain makes on
// the way, a mix's source): the mix sounds as it did; the other track as it was
test('editor: with tracks, the edited track flattened is that track alone', async () => {
  await open()
  await write(`let a = audio('chime.wav')\n  .gain(-6)\n\nlet b = audio('chime.wav')\n  .reverse()\n  .mix(audio.from(1))`)
  await page.waitForFunction(() => document.querySelector('.plot').dataset.tracks === '2')
  await lengthIs('0:08.000')
  await page.waitForFunction(() => document.querySelector('.steps-list .step-name')?.textContent === 'b · chime.wav')
  const level = await readout()
  await tab('Edits')
  await page.locator('.steps-list .step', { has: page.locator('.step-name', { hasText: /^Mix$/ }) }).locator('.step-toggle').click({ button: 'right' })
  await contextRow('Flatten all').click()
  await page.waitForFunction(() => scriptText() === "let a = audio('chime.wav')\n  .gain(-6)\n\nlet b = audio('chime-flat.wav')")
  await page.waitForFunction(() => document.querySelector('.plot').dataset.tracks === '2')
  await page.waitForFunction(level => document.querySelector('.readout').textContent === level, level)
})

// A file opened as a track of its own (File): under the one edited, named for it, the one edited after; the sound as
// long as the longer of the two
test('editor: a file opened as a new track goes under the one edited', async () => {
  await open()
  await write(`audio('chime.wav')`)
  await lengthIs('0:08.000')
  const chooser = page.waitForEvent('filechooser')
  await menu('Track', 'New track from a file…')
  await (await chooser).setFiles({ name: 'bed.wav', mimeType: 'audio/wav', buffer: await wavBytes([sine(10, 220, .1)]) })
  await page.waitForFunction(() => scriptText().includes('let bed = '))
  assert.equal(await code(), `let chime = audio('chime.wav')\n\nlet bed = audio('bed.wav')`)
  await page.waitForFunction(() => document.querySelector('.plot').dataset.tracks === '2')
  await lengthIs('0:10.000')
  assert.equal(await page.locator('.steps-list .step-name').first().textContent(), 'bed · bed.wav')
})

// A track and a tab are one sound each, heard with the others or alone: a tab dragged down onto the picture is a track
// of the sound shown, its tab gone; the track moved to its own tab again, gone from here
test('editor: a tab dragged onto the picture is a track; a track moved to its own tab', async () => {
  await open()
  await write(`audio('chime.wav')`)
  await lengthIs('0:08.000')
  await menu('File', 'Sample or generate', 'handpan.wav')
  await page.waitForFunction(() => scriptText().trim() === "audio('handpan.wav')")
  await page.getByRole('tab', { name: 'chime.wav' }).click()
  await page.waitForFunction(() => scriptText().trim() === "audio('chime.wav')")
  const t = await page.getByRole('tab', { name: 'handpan.wav' }).boundingBox(), plot = await page.locator('.plot').boundingBox()
  await page.mouse.move(t.x + t.width / 2, t.y + t.height / 2)
  await page.mouse.down()
  await page.mouse.move(t.x + t.width / 2, plot.y + plot.height / 3, { steps: 8 })
  assert.ok(await page.locator('#app.dropping').count(), 'the picture says it takes it')
  await page.mouse.up()
  await page.waitForFunction(() => scriptText().includes("let handpan = audio('handpan.wav')"))
  assert.equal(await code(), `let chime = audio('chime.wav')\n\nlet handpan = audio('handpan.wav')`)
  // named by its tracks, as their layers are
  assert.deepEqual(await page.locator('.files [role="tab"]').allInnerTexts(), ['chime + handpan'])
  await page.waitForFunction(() => document.title === 'chime + handpan · audio playground')
  await page.waitForFunction(() => document.querySelector('.plot').dataset.tracks === '2')
  await menu('Track', 'Move the track to its own tab')
  await page.waitForFunction(() => scriptText().trim() === "audio('handpan.wav')")
  assert.deepEqual(await page.locator('.files [role="tab"]').allInnerTexts(), ['chime.wav', 'handpan.wav'])
  await page.getByRole('tab', { name: 'chime.wav' }).click()
  await page.waitForFunction(() => scriptText().trim() === "let chime = audio('chime.wav')")
  await page.waitForFunction(() => !document.querySelector('.plot').dataset.tracks)
})

// A click seen on the picture: selected, the context menu's Repair takes the clicks out there alone (declick over the
// range), or rebuilds all of it from around it (repair); the length kept. Every method is there by its kind
test('editor: the context menu takes the clicks out of the selection, or rebuilds it', async () => {
  await open()
  await noCues()
  await write(`audio('chime.wav')`)
  await lengthIs('0:08.000')
  const { box, x } = await axis(8), y = box.y + tall(box) * .3
  await drag([x(2), y], [x(4) - x(2), 0])
  await page.mouse.click(x(3), y, { button: 'right' })
  await menuRow('Process').click()
  await menuRow('Repair').click()
  await menuRow('Remove the clicks here').click()
  await page.waitForFunction(() => /\.declick\(\{ at: 2(\.0\d*)?, d: 2(\.0\d*)? \}\)$/.test(scriptText().trim()))
  await page.mouse.click(x(3), y, { button: 'right' })
  await menuRow('Process').click()
  await menuRow('Repair').click()
  await menuRow('Rebuild from around it').click()
  await page.waitForFunction(() => /\.repair\(\{ at: 2(\.0\d*)?, d: 2(\.0\d*)? \}\)$/.test(scriptText().trim()))
  await lengthIs('0:08.000')
  // any method, by its kind: a filter over the selection
  await page.mouse.click(x(3), y, { button: 'right' })
  await menuRow('Process').click()
  await menuRow('Filter').click()
  // what each does, said in its row (the menus' words once took the tooltip's place, all at the window's corner)
  const row = await menuRow('Highpass').boundingBox(), said = await menuRow('Highpass').locator('.menu-keys').boundingBox()
  assert.ok(said.y >= row.y && said.y + said.height <= row.y + row.height + 1 && said.x > row.x, 'its words in its row')
  assert.equal(await menuRow('Highpass').locator('.menu-keys').innerText(), 'Cut lows')
  await menuRow('Highpass').click()
  await page.waitForFunction(() => /\.highpass\(80, \{ at: 2(\.0\d*)?, d: 2(\.0\d*)? \}\)$/.test(scriptText().trim()))
})

// With nothing selected, the square past the caret, where a selection's stretch square is, pulls silence open there:
// insert() of the length it is dragged, what follows moving on
test('editor: the square past the caret opens silence there', async () => {
  await open()
  await noCues()
  await write(`audio('chime.wav')`)
  await lengthIs('0:08.000')
  const { box, x } = await axis(8), lh = (tall(box) - LANES) / 2
  await page.mouse.click(x(2), box.y + tall(box) * .3)
  // its pointer trim's, as it does what trimming out does
  await drag(await grab([[x(2) + 9, box.y + lh * 3 / 4]], 'ew-resize'), [x(3) - x(2), 0])
  await page.waitForFunction(() => /\.insert\(1, \{ at: 2, xfade: 0\.01 \}\)$/.test(scriptText()))
  await lengthIs('0:09.000')
})

// At the end the caret's square is before it, there being no room past it; pulled out past where the pictures end, the
// view widens a frame at a time while the pointer stays out there, and the silence is as long as it is pulled
test('editor: at the end, the square before the caret opens silence past the picture\'s edge, as far as it is pulled', async () => {
  await open()
  await noCues()
  await write(`audio('chime.wav')`)
  await lengthIs('0:08.000')
  const { box, x } = await axis(8), lh = (tall(box) - LANES) / 2
  await page.locator('.plot').focus()
  await page.keyboard.press('End')
  const at = await grab([[x(8) - 8, box.y + lh * 3 / 4]], 'ew-resize')
  await page.mouse.move(...at)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width - 20, at[1], { steps: 5 })
  await page.waitForTimeout(600)
  // said by the pointer out there, as it grows
  assert.match(await page.locator('.hint').innerText(), /^silence \d+:\d\d\.\d+$/)
  await page.mouse.up()
  await page.waitForFunction(() => /\.insert\([\d.]+, \{ at: 8, xfade: 0\.01 \}\)$/.test(scriptText()))
  const d = +(await code()).match(/\.insert\(([\d.]+),/)[1]
  assert.ok(d > 1, `as far as it was pulled: ${d} s`)
  await page.waitForFunction(total => { const [m, s] = (e => e.title || e.dataset.tip || '')(document.querySelector('.source')).split(' · ').pop().split(':'); return Math.abs(+m * 60 + +s - total) < 1e-3 }, 8 + d)
})

// The fade squares on whole pixels, flush with what they sit by and never over the caret's line: the one in from the
// selection's first pixel (the caret, where the drag left it, past its last), the one out to its last pixel, 16 px each,
// their edges as dark as their middles (no half pixel blurred), the wash either side of them. On silence, so only the
// wash and the squares show
test('editor: a selection\'s fade squares sit on whole pixels, flush with its start and its end', async () => {
  await open()
  await noCues()
  await write(`audio.from(2)`)
  await lengthIs('0:02.000')
  const { box, x } = await axis(2)
  await drag([x(.5) + .3, box.y + 60], [x(1.5) - x(.5), 0])
  // the pointer by it, so its squares show, in its middle on the time row, clear of the rows measured
  await page.mouse.move(x(1), box.y + box.height - 11)
  await page.waitForTimeout(300)
  const r = await pixels(`
    const at = (px, y) => d[(y * w + px) * 4]
    // on a row under the squares, between the grid's dots (a tenth of full scale apart, 8 px in a lane TRACK px tall):
    // the wash's first column, and the caret's line, the brightest, after its last (where the drag left it)
    let start = -1, line = 0
    for (let px = 1; px < w - 60; px++) { if (at(px, 20) > at(line, 20)) line = px; if (start < 0 && at(px, 20) > at(px - 1, 20) + 4) start = px }
    return { start, line, row: [start, start + 8, start + 15, start + 16, line - 17, line - 16, line - 8, line - 1].map(px => at(px, 1)) }`)
  const [in0, inMid, in1, washIn, washOut, out0, outMid, out1] = r.row
  assert.ok(in0 < washIn - 4 && in1 < washIn - 4 && out0 < washOut - 4 && out1 < washOut - 4, `squares darker than the wash at their edges: ${JSON.stringify(r)}`)
  assert.ok(Math.abs(in0 - inMid) <= 2 && Math.abs(in1 - inMid) <= 2 && Math.abs(out0 - outMid) <= 2 && Math.abs(out1 - outMid) <= 2, `edges as dark as middles: ${JSON.stringify(r)}`)
})

// The handles show with the pointer on or by what they are for, none with it away: a selection's fade square in its
// top corner, the caret's square past it; to a touch or a pen, which may have no pointer to bring near, always. On
// silence, so only the wash, the lines and the squares show: a square's pixels, with the pointer away and by it, the
// pointer's own line clear of them
test('editor: the handles show only with the pointer on or by the selection or the caret', async () => {
  await open()
  await noCues()
  await write(`audio.from(2)`)
  await lengthIs('0:02.000')
  const { box, x } = await axis(2), y = box.y + 60, away = [box.x + 5, y]
  const region = ([x0, y0]) => pixels(`const out = []; for (let y = arg[1]; y < arg[1] + 12; y++) for (let x = arg[0]; x < arg[0] + 12; x++) out.push(d[(y * w + x) * 4]); return out`, [Math.round(x0 - box.x), Math.round(y0)])
  const differ = (a, b) => a.filter((v, i) => Math.abs(v - b[i]) > 8).length
  const seen = async (at, square) => { await page.mouse.move(...at); await page.waitForTimeout(200); return region(square) }
  // a selection's fade-in square, in from its start's line at its top
  await drag([x(.5) + .3, y], [x(1.5) - x(.5), 0])
  const fade = [x(.5) + 3, 2], none = await seen(away, fade)
  assert.ok(differ(none, await seen([x(1), y], fade)) > 20, 'the pointer in it: its square')
  assert.ok(differ(none, await seen([x(1.5) + 12, y], fade)) > 20, 'the pointer just past its end: its square')
  assert.ok(differ(none, await seen(away, fade)) <= 2, 'the pointer away again: none')
  // to a touch or a pen, the selection's handles with no pointer by it
  for (const pointerType of ['touch', 'pen']) {
    await page.mouse.move(...away)
    await page.locator('.plot').dispatchEvent('pointermove', { pointerType, clientX: away[0], clientY: y })
    await page.waitForTimeout(200)
    assert.ok(differ(none, await region(fade)) > 20, `${pointerType}: its square`)
  }
  // the caret's square, past it in the middle of the lane's lower half (one lane, a mono sound's)
  await page.mouse.click(x(1), y)
  const gap = [x(1) + 3, tall(box) * 3 / 4 - 6], bare = await seen(away, gap)
  assert.ok(differ(bare, await seen([x(1) - 12, y], gap)) > 20, 'the pointer by the caret: its square')
  assert.ok(differ(bare, await seen(away, gap)) <= 2, 'the pointer away again: none')
})

// Handles are for editing: while it plays there are none, the caret's square past it too
test('editor: no handles while it plays', async () => {
  const { box, x, y } = await chime(), lh = (tall(box) - LANES) / 2, at = [x(2) + 9, box.y + lh * 3 / 4]
  await page.mouse.click(x(2), y)
  await grab([at], 'ew-resize')
  await page.keyboard.press('Space')
  await page.waitForFunction(() => document.querySelector('.time').textContent !== '0:02.000')
  await page.mouse.move(at[0] + 1, at[1])
  assert.equal(await page.locator('.plot').evaluate(el => el.style.cursor), '')
  await page.keyboard.press('Space')
  await page.getByRole('button', { name: 'Play' }).waitFor()
})

// A selection, as a text's: the arrows move the caret and keep it; a click on the time row moves only the caret, as
// a ruler's; Play goes on from the caret inside it, and paused, from where it paused; a click inside it, as anywhere,
// leaves the caret there alone
test('editor: the caret moves within a selection from the time row or the arrows; Play goes on from it; a click drops it', async () => {
  await open()
  await noCues()
  await write(`audio('chime.wav')`)
  await lengthIs('0:08.000')
  const { box, x } = await axis(8), y = box.y + tall(box) * .3, row = box.y + box.height - 11
  const clock = () => page.locator('.time').innerText(), seconds = t => t.split(':').reduce((m, s) => m * 60 + +s, 0)
  await drag([x(1), y], [x(5) - x(1), 0])
  assert.equal(await selected(), '0:01.000–0:05.000')
  await page.keyboard.press('ArrowRight')
  assert.equal(await selected(), '0:01.000–0:05.000')
  await page.mouse.click(x(2), row)
  assert.equal(await selected(), '0:01.000–0:05.000')
  assert.equal(await clock(), '0:02.000')
  await page.keyboard.press('Space')
  await page.getByRole('button', { name: 'Pause' }).waitFor()
  const t = seconds(await clock())
  assert.ok(t >= 2 && t < 2.5, `plays on from the caret (${t})`)
  await page.waitForTimeout(300)
  await page.keyboard.press('Space')
  const paused = seconds(await clock())
  await page.keyboard.press('Space')
  await page.getByRole('button', { name: 'Pause' }).waitFor()
  const again = seconds(await clock())
  assert.ok(again >= paused && again < paused + .3, `on from where it paused (${paused} → ${again})`)
  await page.keyboard.press('Space')
  assert.equal(await selected(), '0:01.000–0:05.000')
  await page.mouse.click(x(3), y)
  assert.equal(await selected(), '')
  assert.equal(await clock(), '0:03.000')
})

// The keys, one gesture each (view.js selectDown): small tests, as these are the easiest to break
// A handle clicked until it is turned to `name`, its way as kept for the next visit (grip, pill, curve), each click the
// next, no menu
const way = key => page.evaluate(k => JSON.parse(localStorage.getItem('audio-repl'))[k], key)
async function turn(at, key, name) {
  for (let i = 0; i < 4 && await way(key) !== name; i++) await page.mouse.click(...at)
  assert.equal(await way(key), name)
}
const keyed = async (keys, act) => { for (const k of keys) await page.keyboard.down(k); await act(); for (const k of [...keys].reverse()) await page.keyboard.up(k) }
async function chime() {
  await open()
  await noCues()
  await write(`audio('chime.wav')`)
  await lengthIs('0:08.000')
  const { box, x } = await axis(8)
  return { box, x, y: box.y + tall(box) * .3, ranges: async () => (await page.locator('.clock').evaluate(tipOf)).match(/^Selected (\d+) ranges: ([\d:.]+),/)?.slice(1) ?? [] }
}
// every caret, as M marks them (and takes them back)
async function marked() {
  await page.keyboard.press('m')
  await page.waitForFunction(() => /\.mark\(/.test(scriptText()))
  const c = await code()
  await page.keyboard.press('ControlOrMeta+Z')
  await page.waitForFunction(() => !/\.mark\(/.test(scriptText()))
  return [...c.matchAll(/mark\(([\d.]+)\)/g)].map(m => +m[1])
}

// A press inside the selection keeps it, as a press on selected text does: dragged, its audio moves; let go where it
// went down, the caret there alone (it once dropped the selection at once, a drag from inside selecting anew)
test('editor: a press inside the selection keeps it until let go, then the caret there alone', async () => {
  const { x, y } = await chime()
  await drag([x(1), y], [x(3) - x(1), 0])
  await page.mouse.move(x(2), y)
  await page.mouse.down()
  assert.equal(await selected(), '0:01.000–0:03.000')
  await page.mouse.up()
  assert.equal(await selected(), '')
  assert.equal(await page.locator('.time').innerText(), '0:02.000')
})

test('editor: Shift and a click extends from where the selection was begun, or from the caret', async () => {
  const { x, y } = await chime()
  await drag([x(1), y], [x(3) - x(1), 0])
  await keyed(['Shift'], () => page.mouse.click(x(2), y))
  assert.equal(await selected(), '0:01.000–0:02.000', 'begun at 1: its end comes back')
  await drag([x(3), y], [x(1) - x(3), 0])
  await keyed(['Shift'], () => page.mouse.click(x(2), y))
  assert.equal(await selected(), '0:02.000–0:03.000', 'begun at 3: its start goes on')
  await page.mouse.click(x(5), y)
  await keyed(['Shift'], () => page.mouse.click(x(6), y))
  assert.equal(await selected(), '0:05.000–0:06.000', 'from the caret')
})

test('editor: Shift and a drag inside the selection moves its far end from where it was begun, whichever way', async () => {
  const { x, y } = await chime()
  await drag([x(1), y], [x(3) - x(1), 0])
  await keyed(['Shift'], () => drag([x(2.5), y], [x(1.5) - x(2.5), 0]))
  assert.equal(await selected(), '0:01.000–0:01.500')
})

// Shift sums, as Shift and a press in a text: the selection goes out to the press at once, from where it was begun, a
// drag going on with it, never another range; held, the pointer an I-beam with a plus on the side it goes out from
const pointed = () => page.locator('.plot').evaluate(el => decodeURIComponent(el.style.cursor))
test('editor: Shift and a press elsewhere extends the selection at once, a drag going on with it; the pointer says which way', async () => {
  const { x, y, ranges } = await chime()
  await drag([x(1), y], [x(2) - x(1), 0])
  await page.mouse.move(x(4), y)
  await page.keyboard.down('Shift')
  await page.waitForFunction(() => decodeURIComponent(document.querySelector('.plot').style.cursor).includes('M6 9v6M3 12h6'))
  await page.mouse.down()
  assert.equal(await selected(), '0:01.000–0:04.000', 'on the press')
  await page.mouse.move(x(5), y, { steps: 3 })
  await page.mouse.up()
  assert.equal(await selected(), '0:01.000–0:05.000', 'the drag goes on with it')
  assert.deepEqual(await ranges(), [], 'no other range')
  await page.mouse.move(x(.5), y)
  assert.match(await pointed(), /M18 9v6M15 12h6/, 'before it, the plus on the other side')
  await page.keyboard.up('Shift')
})

// Held Alt, what the time row has in the measuring red between `a` and `b` (page x): on its row most lit, how many pixels
const measuredOnRow = (box, a, b) => pixels(`let best = 0; for (let y = h - 20; y < h - 2; y++) { let n = 0; for (let x = ${Math.round(a - box.x)}; x < ${Math.round(b - box.x)}; x++) { const i = (y * w + x) * 4; if (d[i] - d[i + 2] > 60) n++ } best = Math.max(best, n) } return best`)
const crossed = () => page.waitForFunction(() => document.querySelector('.plot').style.cursor === 'crosshair')
// Alt measures as Figma's Alt does: held, the pointer a cross, the waveform's level at its time (the peak of the column,
// on the pointer's side of the centre line, not the pointer's own height) dashed in the measuring red across to the level
// axis and from there down to the time row, and on the time row a line from the selection's nearer edge to it, how far
// it is; let go, none. It shows as the key goes down, before the pointer moves. ⌘ aims: the pointer a cross, nothing
// measured
test('editor: held Alt, the pointer measures how far it is from the selection, dashed out to the axes', async () => {
  const { box, x, y } = await chime()
  await drag([x(1), y], [x(2) - x(1), 0])
  // high over the lane, far over the sound there
  const py = box.y + 12
  await page.mouse.move(x(4), py)
  const span = x(4) - x(2) - 4, red = (x0, x1, y0, y1) => pixels(`let n = 0; for (let py = ${Math.round(y0)}; py < ${Math.round(y1)}; py++) for (let px = ${Math.round(x0)}; px < ${Math.round(x1)}; px++) { const i = (py * w + px) * 4; if (d[i] - d[i + 2] > 60 && d[i] > 150) n++ } return n`)
  // the row of the most red right of the pointer's column, over the lane's upper half; the waveform's top a few px
  // before that column (its first pixel down from the lane's top lit as the waveform is)
  const across = () => pixels(`let best = 0, at = -1; for (let py = 0; py < arg.h; py++) { let n = 0; for (let px = arg.x0; px < arg.x1; px++) { const i = (py * w + px) * 4; if (d[i] - d[i + 2] > 60 && d[i] > 150) n++ } if (n > best) { best = n; at = py } } return { at, n: best }`, { x0: Math.round(x(4) - box.x + 4), x1: Math.round(x(5) - box.x), h: Math.round(tall(box) / 4) })
  const top = () => pixels(`for (let py = 0; py < arg.h; py++) { const i = (py * w + arg.x) * 4; if (d[i] > 120 && Math.abs(d[i] - d[i + 2]) < 30) return py } return -1`, { x: Math.round(x(4) - box.x - 3), h: Math.round(tall(box) / 4) })
  assert.equal(await measuredOnRow(box, x(2) + 2, x(4) - 2), 0)
  await page.keyboard.down('ControlOrMeta')
  await crossed()
  assert.equal(await measuredOnRow(box, x(2) + 2, x(4) - 2), 0, '⌘ measures nothing')
  await page.keyboard.up('ControlOrMeta')
  const wave = await top()
  await page.keyboard.down('Alt')
  await crossed()
  const [n, level] = [await measuredOnRow(box, x(2) + 2, x(4) - 2), await across()]
  const below = await red(x(4) - box.x - 2, x(4) - box.x + 3, level.at + 4, level.at + 60)
  await page.keyboard.up('Alt')
  assert.ok(n > span * .6, `a line across the time row: ${n} of ${Math.round(span)} px`)
  assert.ok(level.n > (x(5) - x(4) - 4) * .3, `dashed across to the axis: ${level.n} px lit`)
  // (its drawn top a few px under its peak, the tips of a density fill faint)
  assert.ok(wave > 0 && Math.abs(level.at - wave) <= 8 && level.at > py - box.y + 20, `at the waveform's level (${wave} px down), not the pointer's (${Math.round(py - box.y)}): ${level.at}`)
  assert.ok(below > 20 && below < 56 * .8, `dashed down from it to the time row: ${below} px lit`)
  assert.equal(await measuredOnRow(box, x(2) + 2, x(4) - 2), 0, 'gone with the key')
})

// Held Alt over a waveform whose levels are zoomed in past its peaks: the level measured is the waveform's as it is,
// past the lane's top, the line held at that edge, a small triangle there pointing out to it
test('editor: held Alt where the waveform runs past the levels shown, the line stops at the edge, a triangle pointing on', async () => {
  await page.route('**/playground/editor.js', async route => { const r = await route.fetch(); route.fulfill({ response: r, body: (await r.text()).replace('v = view(', 'v = globalThis.__view = view(') }) })
  await open()
  await noCues()
  await write(`audio.from(t => 0.9 * Math.sin(2 * Math.PI * 220 * t), { duration: 2 })`)
  await lengthIs('0:02.000')
  await page.evaluate(() => { __view.frame = { levels: [-.2, .2] } })
  const { box, x } = await axis(2), red = (x0, x1, y0, y1) => pixels(`let n = 0; for (let py = arg[2]; py < arg[3]; py++) for (let px = arg[0]; px < arg[1]; px++) { const i = (py * w + px) * 4; if (d[i] - d[i + 2] > 60 && d[i] > 150) n++ } return n`, [x0, x1, y0, y1].map(Math.round))
  const px = x(1) - box.x
  await page.mouse.move(x(1), box.y + tall(box) / 6)
  await page.keyboard.down('Alt')
  let tip = 0
  for (const until = Date.now() + 3000; tip < 6 && Date.now() < until; await page.waitForTimeout(100)) tip = await red(px - 4, px + 5, 0, 6)
  const across = await red(px + 8, px + 80, 0, 2)
  await page.keyboard.up('Alt')
  assert.ok(tip >= 6, `a triangle at the lane's top: ${tip} px`)
  assert.ok(across > 20, `the line along the top edge, out to the axis: ${across} px`)
})

// A key let go while the page heard nothing (a gesture under way, the window elsewhere) shows let go with the next wheel
// event, which has the keys as they are: ⌘'s aiming, held as the page last heard it, gone as the wheel turns
test('editor: the keys as a wheel event has them: ⌘ let go unheard, the aiming goes with the wheel', async () => {
  const { x, y } = await chime()
  await page.mouse.move(x(3), y)
  await page.evaluate(() => dispatchEvent(new KeyboardEvent('keydown', { key: 'Meta', metaKey: true, ctrlKey: !/Mac/.test(navigator.platform) })))
  if (await page.evaluate(() => /Mac/.test(navigator.platform))) await crossed()
  else return
  await page.mouse.wheel(0, 10)
  await page.waitForFunction(() => document.querySelector('.plot').style.cursor !== 'crosshair')
})

// Measuring on the spectrogram, the spectrum meter reads under the pointer: held Alt at two strikes of other notes, two
// spectra; let go, the caret's again
test('editor: held Alt over the spectrogram, the spectrum meter reads under the pointer', async () => {
  const { box, x, y } = await chime()
  await show('spec')
  await page.waitForTimeout(300)
  const g = await gutter(), meter = () => pixels(`let s = 0; for (let py = 0; py < h - 30; py++) for (let px = w - ${g} - 46; px < w - ${g} - 2; px++) { const i = (py * w + px) * 4; s += (d[i] + d[i + 1] + d[i + 2]) * (py % 7 + 1) } return s`)
  const rest = await meter()
  await page.mouse.move(x(1.5), y)
  await page.keyboard.down('Alt')
  await crossed()
  await page.waitForTimeout(200)
  const one = await meter()
  await page.mouse.move(x(5.5), y)
  await page.waitForTimeout(200)
  const two = await meter()
  await page.keyboard.up('Alt')
  await page.waitForTimeout(200)
  assert.notEqual(one, two, 'a spectrum under each place')
  assert.equal(await meter(), rest, 'let go, the caret\'s')
})

// While it plays, held Alt measures from the playhead, the caret moving, not from where it started: the line on the time
// row runs from the playhead to the pointer, none of it back to the caret it started from
test('editor: held Alt while it plays, it measures from the playhead', async () => {
  const { box, x, y } = await chime()
  await page.mouse.click(x(1), y)
  await page.mouse.move(x(5), y)
  await page.keyboard.press('Space')
  // the playhead, and the tick measured from on it, well past where it started
  await page.waitForFunction(() => document.querySelector('.time').textContent > '0:01.600')
  await page.keyboard.down('Alt')
  await crossed()
  const [behind, ahead] = [await measuredOnRow(box, x(1) + 2, x(1.3)), await measuredOnRow(box, x(3), x(5) - 2)]
  await page.keyboard.up('Alt')
  await page.keyboard.press('Space')
  assert.equal(behind, 0, 'nothing back to where it started')
  assert.ok(ahead > (x(5) - 2 - x(3)) * .6, `from the playhead to the pointer: ${ahead} px`)
})

// ⌘ (Ctrl) empowers: held at a range's end, the end sets its length, as the grip past it does (a stretch, by default),
// with the stretch's pointer; a plain press there only resizes the range
test('editor: held ⌘, a range\'s end stretches it, as its grip does', async () => {
  const { x, y } = await chime()
  await drag([x(1), y], [x(2) - x(1), 0])
  await page.mouse.move(x(2), y)
  await keyed(['ControlOrMeta'], async () => {
    await page.waitForFunction(() => /^url\(/.test(document.querySelector('.plot').style.cursor))
    await drag([x(2), y], [x(2.5) - x(2), 0])
  })
  await page.waitForFunction(() => /\.stretch\(1\.5, \{ at: 1, d: 1 \}\)$/.test(scriptText()))
  assert.equal(await selected(), '0:01.000–0:02.500')
  await lengthIs('0:08.500')
})

test('editor: Alt and a click makes a caret, the one Shift then extends: ranges made in order', async () => {
  const { x, y, ranges } = await chime()
  await page.mouse.click(x(1), y)
  await keyed(['Alt'], () => page.mouse.click(x(3), y))
  assert.deepEqual(await marked(), [1, 3])
  await keyed(['Shift'], () => page.mouse.click(x(4), y))
  assert.equal(await selected(), '0:03.000–0:04.000')
  assert.deepEqual(await marked(), [1], 'the first caret stays')
  await keyed(['Alt'], () => page.mouse.click(x(5), y))
  await keyed(['Shift'], () => page.mouse.click(x(6), y))
  assert.deepEqual(await ranges(), ['2', '0:02.000'])
  assert.deepEqual(await marked(), [1])
})

test('editor: Alt and Shift always make another, never extending', async () => {
  const { x, y, ranges } = await chime()
  await drag([x(1), y], [x(2) - x(1), 0])
  await keyed(['Alt', 'Shift'], () => drag([x(4), y], [x(5) - x(4), 0]))
  assert.deepEqual(await ranges(), ['2', '0:02.000'])
  await keyed(['Alt', 'Shift'], () => page.mouse.click(x(6), y))
  assert.deepEqual(await ranges(), ['2', '0:02.000'], 'the ranges stay')
  assert.deepEqual(await marked(), [6], 'a caret beside them')
})

// A copy goes in where it is let go, what was there moving on after it, as a text's dragged copy goes in. Moved, the
// audio slides over what is there, silence where it was, as a graphic editor's object or a DAW's clip (move(), the
// length kept), dragged as selected text is, no key held (once only with ⌘, a drag inside the selection selecting
// anew). Each seam crossfaded as a delete's (the settings, 10 ms). Clicked inside it, the caret there alone
test('editor: dragged inside the selection, its audio slides over what is there; with Alt a copy goes in where it lands', async () => {
  const { x, y } = await chime()
  const before = await seconds()
  await drag([x(1), y], [x(2) - x(1), 0])
  await keyed(['Alt'], () => drag([x(1.5), y], [x(4) - x(1), 0]))
  await page.waitForFunction(() => /\.copy\(\{ at: 1, d: 1 \}\)\.paste\(4, 0\.01\)$/.test(scriptText()))
  assert.equal(await selected(), '0:04.000–0:05.000', 'the copy selected where it went')
  await page.waitForFunction(expected => Math.abs(+(e => e.title || e.dataset.tip || '')(document.querySelector('.source')).split(' · ').pop().split(':')[1] - expected) < .002, before + 1)
  await page.keyboard.press('ControlOrMeta+Z')
  await page.waitForFunction(() => scriptText() === "audio('chime.wav')")
  await page.mouse.click(x(7.5), y)
  await drag([x(1), y], [x(2) - x(1), 0])
  await drag([x(1.5), y], [x(4) - x(1), 0])
  await page.waitForFunction(() => /\.move\(\{ at: 1, d: 1, to: 4, xfade: 0\.01 \}\)$/.test(scriptText()))
  assert.equal(await selected(), '0:04.000–0:05.000', 'the moved audio stays selected where it went')
  await lengthIs('0:08.000')
  assert.equal(await page.locator('.plot').evaluate(el => el.style.cursor), 'grab', 'over the selection, a hand')
  // (once made: till then what it moved is frozen, no press taking it)
  await page.waitForFunction(() => !document.querySelector('.plot .veil:not([hidden])'))
  await page.mouse.click(x(4.5), y)
  assert.equal(await selected(), '', 'clicked inside it, no selection')
  assert.equal((await code()).match(/\.move\(/g).length, 1)
})

test('editor: what there is stays as one of it is dragged, a caret by its line, a range by its edge; an edge onto the other leaves a caret', async () => {
  const { x, y, ranges } = await chime()
  await page.mouse.click(x(1), y)
  await keyed(['Alt'], () => page.mouse.click(x(3), y))
  await drag(await grab([[x(3), y]], 'ew-resize'), [x(3.5) - x(3), 0])
  assert.deepEqual(await marked(), [1, 3.5])
  // a caret's line only clicked: that caret alone, as a click anywhere
  await page.mouse.click(x(3.5), y)
  assert.deepEqual(await marked(), [3.5])
  await drag([x(1), y], [x(2) - x(1), 0])
  await keyed(['Alt'], () => drag([x(4), y], [x(5) - x(4), 0]))
  await drag(await grab([[x(2), y]], 'ew-resize'), [x(2.5) - x(2), 0])
  assert.deepEqual(await ranges(), ['2', '0:02.500'])
  // its start onto its end: a caret there, the other range staying
  await drag(await grab([[x(1), y]], 'ew-resize'), [x(2.5) - x(1), 0])
  assert.equal(await page.locator('.time').innerText(), '0:02.500')
  await page.keyboard.press('Delete')
  await page.waitForFunction(() => /\.remove\(\{ at: 4, d: 1, xfade: 0\.01 \}\)$/.test(scriptText()))
})

// An edge dragged on past the other turns the range over, as a drag from the other edge would make it: its end past its
// start, the range from its start back to where it is let go, its start past its end the same the other way
test('editor: a range\'s edge dragged past the other turns it over from there', async () => {
  const { x, y } = await chime()
  await drag([x(3), y], [x(4) - x(3), 0])
  await drag(await grab([[x(4), y]], 'ew-resize'), [x(2) - x(4), 0])
  assert.equal(await selected(), '0:02.000–0:03.000', 'its end past its start')
  await drag(await grab([[x(2), y]], 'ew-resize'), [x(5) - x(2), 0])
  assert.equal(await selected(), '0:03.000–0:05.000', 'its start past its end')
})

test('editor: ⌘ aims, a drag going a quarter as far; a right-click on what a press would take moves nothing', async () => {
  const { x, y } = await chime(), clock = () => page.locator('.time').innerText()
  await page.mouse.click(x(2), y)
  await keyed(['ControlOrMeta'], async () => drag(await grab([[x(2), y]], 'ew-resize'), [x(3) - x(2), 0]))
  const t = +(await clock()).split(':')[1]
  assert.ok(Math.abs(t - 2.25) < .02, `a quarter of a second, not a second: ${t}`)
  await page.mouse.move(x(t) + 4, y)
  await page.mouse.click(x(t) + 4, y, { button: 'right' })
  await page.keyboard.press('Escape')
  assert.equal(+(await clock()).split(':')[1], t)
  await drag([x(4), y], [x(5) - x(4), 0])
  await page.mouse.move(x(5) - 2, y)
  await page.mouse.click(x(5) - 2, y, { button: 'right' })
  await page.keyboard.press('Escape')
  assert.equal(await selected(), '0:04.000–0:05.000')
})

// A word added to the words selected, as a text editor's several selections: Alt and a double-click; Shift and a
// double-click, the selection out to the word
test('editor: Alt and a double-click adds a word; Shift and a double-click extends to one', async () => {
  await open()
  await write(bursts)
  await lengthIs('0:02.500')
  const { box, x } = await axis(2.5), y = box.y + tall(box) / 3
  for (const until = Date.now() + 8000; Date.now() < until; await page.waitForTimeout(200)) { await page.mouse.dblclick(x(.2), y); if (/^0:00\.4/.test((await selected()).split('–')[1] ?? '')) break }
  await page.keyboard.down('Alt'); await page.mouse.dblclick(x(1.7), y); await page.keyboard.up('Alt')
  assert.match(await page.locator('.clock').evaluate(tipOf), /^Selected 2 ranges: 0:00\.8/)
  await page.locator('.plot').focus()
  await page.keyboard.press('Delete')
  await page.waitForFunction(() => (scriptText().match(/\.remove\(/g) || []).length === 2)
  await page.keyboard.press('ControlOrMeta+Z')
  await lengthIs('0:02.500')
  // its cues come with its output again (its pauses' edges first): a word at .2, extended with Shift to the one at .7,
  // once they have
  for (const until = Date.now() + 8000; Date.now() < until; await page.waitForTimeout(200)) {
    await page.mouse.dblclick(x(.2), y)
    await page.keyboard.down('Shift'); await page.mouse.dblclick(x(.7), y); await page.keyboard.up('Shift')
    if (/^0:00\.000–0:00\.9\d*$/.test(await selected())) break
  }
  assert.match(await selected(), /^0:00\.000–0:00\.9\d*$/)
})

// A right-click, as in a text: inside the selection, the edits for it, then every method under one Process, by its kind,
// one written for it offered again first there among the recent ones; what the picture has a handle for (the fades, the
// level), how it draws, what the menus have for the sound as a whole (Select all, the voice split) are not its. Elsewhere
// the caret goes there first, the selection gone, and the menu has what a caret takes
test('editor: a right-click gives the edits for the selection, or puts the caret there and gives the caret\'s', async () => {
  await open()
  await noCues()
  await write(`audio('chime.wav')`)
  await lengthIs('0:08.000')
  const { box, x } = await axis(8), y = box.y + tall(box) * .3
  const item = name => page.locator('.menubar-menu .menu-row', { has: page.locator('.menu-label', { hasText: new RegExp(`^${name}$`) }) })
  await drag([x(1), y], [x(3) - x(1), 0])
  await page.mouse.click(x(2), y, { button: 'right' })
  // its own: the edits of what is there, then Process, the methods by kind and the search for one, no more
  const own = () => page.locator('.menubar-menu > .menu-row .menu-label').allInnerTexts(), kinds = ['Edit', 'Level', 'Filter', 'Dynamics', 'Repair', 'Time & pitch', 'Effect', 'Color', 'Reverb', 'Space', 'Generate', 'Find an edit…']
  const processed = () => page.locator('.menubar-sub:popover-open > .menu-row .menu-label').allInnerTexts()
  assert.deepEqual(await own(), ['Cut', 'Copy', 'Paste', 'Delete', 'Crop', 'Mark it', 'Process'])
  await item('Process').click()
  assert.deepEqual(await processed(), kinds)
  // under its kind, Edit, the first of it
  await item('Edit').click()
  await item('Reverse').click()
  await page.waitForFunction(() => /\.reverse\(\{ at: 1, d: 2 \}\)$/.test(scriptText()))
  assert.equal(await page.locator('.menubar-menu').count(), 0)
  // an edit in place: no panel opens over the picture
  assert.equal(await page.locator('.side-slab').isVisible(), false, 'the edits stay closed')
  // offered again, at once, as it was worded; kept with the page
  await page.mouse.click(x(2), y, { button: 'right' })
  await item('Process').click()
  assert.equal(await page.locator('.menubar-sub:popover-open > .menu-group').innerText(), 'Recent')
  assert.deepEqual((await processed()).slice(0, 2), ['Reverse', 'Edit'])
  await page.locator('.menubar-sub:popover-open > .menu-row', { hasText: /^Reverse/ }).click()
  await page.waitForFunction(() => (scriptText().match(/\.reverse\(\{ at: 1, d: 2 \}\)/g) || []).length === 2)
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('audio-repl') || '{}').recent?.[0] === 'reverse')
  await page.mouse.click(x(6), y, { button: 'right' })
  assert.equal(await page.locator('.time').innerText(), '0:06.000')
  assert.deepEqual(await own(), ['Paste', 'Add a marker', 'Process'], 'the caret\'s own, no Cut')
  // Esc closes it, the caret staying
  await page.keyboard.press('Escape')
  await page.locator('.menubar-menu').waitFor({ state: 'detached' })
  await page.mouse.click(x(6), y, { button: 'right' })
  await item('Add a marker').click()
  await page.waitForFunction(() => /\.mark\(6\)$/.test(scriptText()))
})

// A stretch is one method, its algorithm a choice on its card (fn/stretch.js, { method }), and so is a pitch shift
// (fn/pitch.js): the menus list Stretch once and Pitch once, as they name every method, in capitals; a method chosen is written into its call, the output as long as the factor says
test('editor: one Stretch, its algorithm a choice; the menus name each method in capitals', async () => {
  await open()
  await noCues()
  await write(`audio('chime.wav')`)
  await lengthIs('0:08.000')
  const { box, x } = await axis(8), y = box.y + tall(box) * .3
  await page.mouse.click(x(2), y, { button: 'right' })
  await menuRow('Process').click()
  await menuRow('Time & pitch').click()
  const names = await page.locator('.menubar-sub:popover-open .menu-label').allInnerTexts()
  assert.deepEqual(names.filter(n => /^stretch/i.test(n)), ['Stretch'], names.join(', '))
  assert.deepEqual(names.filter(n => /^(pitch|formant shift|vocoder|paulstretch)/i.test(n)), ['Pitch'], 'the pitch shifts one Pitch, its method a choice')
  assert.ok(names.every(n => n[0] === n[0].toUpperCase()), names.join(', '))
  await page.keyboard.press('Escape')
  await write(`audio('chime.wav').stretch(1.5)`)
  await lengthIs('0:12.000')
  await tab('Edits')
  await page.locator('.step-name', { hasText: /^Stretch$/ }).click()
  const more = page.locator('.step.open .step-more')
  if (await more.count() && await more.getAttribute('aria-expanded') === 'false') await more.click()
  const method = page.locator('.step.open .param', { hasText: 'method' })
  assert.match(await method.evaluate(tipOf), /^How it stretches\./)
  await method.getByRole('button', { name: 'wsola', exact: true }).click()
  await page.waitForFunction(() => /stretch\(1\.5, \{ method: 'wsola' \}\)/.test(scriptText()))
  await lengthIs('0:12.000')
})

// Delete closes up the audio either side of what goes, crossfaded over 10 ms so the seam makes no click (remove(),
// fn/remove.js); the settings set it, or turn it off
test('editor: Delete crossfades the seam it leaves, as long as the settings say', async () => {
  await open()
  await noCues()
  await write(`audio('chime.wav')`)
  await lengthIs('0:08.000')
  const { box, x } = await axis(8), y = box.y + tall(box) * .3
  await drag([x(1), y], [x(2) - x(1), 0])
  await page.keyboard.press('Delete')
  await page.waitForFunction(() => /\.remove\(\{ at: 1, d: 1, xfade: 0\.01 \}\)$/.test(scriptText()))
  await lengthIs('0:07.000')
  await page.keyboard.press('ControlOrMeta+Z')
  await lengthIs('0:08.000')
  await settings('Splices', 'Off')
  // the selection Undo brought back, gone first: a press on its edge would drag the edge
  await page.mouse.click(x(6), y)
  await drag([x(1), y], [x(2) - x(1), 0])
  await page.keyboard.press('Delete')
  await page.waitForFunction(() => /\.remove\(\{ at: 1, d: 1 \}\)$/.test(scriptText()))
})

// A click on a handle turns it to its next way, in turn, no menu: the selection stays, and so does what the next click
// turns it to
test('editor: a click on a fade corner turns it to the next curve, no menu, the selection kept', async () => {
  await open()
  await noCues()
  await write(`audio('chime.wav')`)
  await lengthIs('0:08.000')
  const { box, x } = await axis(8), y = box.y + tall(box) * .3
  await drag([x(2), y], [x(4) - x(2), 0])
  for (const curve of ['exp', 'log', 'cos', 'linear']) {
    await page.mouse.click(x(2) + 8, box.y + 8)
    assert.equal(await way('curve'), curve)
  }
  assert.equal(await page.locator('[popover]:popover-open').count(), 0)
  assert.match(await selected(), /^0:02\.0\d\d–0:04\.0\d\d$/)
})

test('editor: Alt-click adds carets; M puts a marker at each', async () => {
  await page.route('**/playground/editor.js', async route => { const r = await route.fetch(); route.fulfill({ response: r, body: (await r.text()).replace('v = view(', 'v = globalThis.__view = view(') }) })
  await open()
  await write(`audio('chime.wav')`)
  await lengthIs('0:08.000')
  const { box, x } = await axis(8), y = box.y + tall(box) * .3
  await page.mouse.click(x(2.2), y)
  await page.keyboard.down('Alt')
  // the caret there as the press goes down, not as it is let go
  await page.mouse.move(x(4.2), y)
  await page.mouse.down()
  const pressed = await page.evaluate(() => __view.carets)
  await page.mouse.up()
  assert.ok(pressed.length === 2 && Math.abs(pressed[1] - 4.2) < .05, `pressed, a caret there: ${pressed}`)
  await page.mouse.click(x(6.2), y)
  await page.keyboard.up('Alt')
  assert.ok(await offered('A marker at each of the 3 carets'))
  await page.keyboard.press('m')
  await page.waitForFunction(() => (scriptText().match(/\.mark\(/g) || []).length === 3)
  assert.deepEqual([...(await code()).matchAll(/\.mark\(([\d.]+)\)/g)].map(m => Math.round(+m[1] * 10) / 10), [2.2, 4.2, 6.2])
  // Alt-click on a caret takes it away; a paste goes to each left, from the last back so each time holds
  await write(`audio('chime.wav').copy({ at: 0, duration: 0.5 })`)
  await lengthIs('0:08.000')
  await page.mouse.click(x(2.2), y)
  await page.keyboard.down('Alt')
  await page.mouse.click(x(4.2), y)
  await page.mouse.click(x(6.2), y)
  await page.mouse.click(x(4.2), y)
  await page.keyboard.up('Alt')
  assert.ok(await offered('Paste at all 2'))
  await page.keyboard.press('ControlOrMeta+V')
  await page.waitForFunction(() => (scriptText().match(/\.paste\(/g) || []).length === 2)
  assert.deepEqual([...(await code()).matchAll(/\.paste\(([\d.]+), 0\.01\)/g)].map(m => Math.round(+m[1] * 10) / 10), [6.2, 2.2])
  // a plain click leaves one caret: a paste there alone
  await page.mouse.click(x(3), y)
  assert.ok(await offered('Paste at the caret'))
})

// The clipboard's keys: ⌘C copies the selection, ⌘X cuts it, ⌘V pastes at the caret, each a call on the chain. ⌘C once
// wrote the copy an Alt-drag makes, from a selection that has no destination: `copy: at is NaN`.
test('editor: ⌘C copies the selection, ⌘X cuts it, ⌘V pastes at the caret', async () => {
  await open()
  await noCues()
  await write(`audio('chime.wav')`)
  await lengthIs('0:08.000')
  const { box, x } = await axis(8), y = box.y + tall(box) * .3, last = () => code().then(c => c.trim().split('\n').at(-1))
  await drag([x(1), y], [x(2) - x(1), 0])
  await page.keyboard.press('ControlOrMeta+C')
  await page.waitForFunction(() => /\.copy\(\{ at: [\d.]+, d: [\d.]+ \}\)$/.test(scriptText().trim()))
  const [, at, duration] = (await last()).match(/\.copy\(\{ at: ([\d.]+), d: ([\d.]+) \}\)$/).map(Number)
  assert.ok(Math.abs(at - 1) < .02 && Math.abs(duration - 1) < .02, `${at} ${duration}`)
  // a copy keeps the selection, so the next edit takes it: reverse() of it, not of all (it once dropped the selection,
  // and the reverse turned the whole sound round)
  assert.match(await selected(), /^0:01\.\d+–0:02\.\d+$/)
  await palette('Reverse')
  await page.waitForFunction(() => /\.reverse\(\{ at: [\d.]+, d: [\d.]+ \}\)$/.test(scriptText().trim()))
  await page.mouse.click(x(5), y)
  await page.keyboard.press('ControlOrMeta+V')
  await page.waitForFunction(() => /\.paste\([\d.]+, 0\.01\)$/.test(scriptText().trim()))
  await drag([x(1), y], [x(2) - x(1), 0])
  await page.keyboard.press('ControlOrMeta+X')
  await page.waitForFunction(() => /\.cut\(\{ at: [\d.]+, d: [\d.]+, xfade: 0\.01 \}\)$/.test(scriptText().trim()))
  await page.waitForTimeout(500)
  assert.equal(await page.locator('.message.problem').count(), 0, await page.locator('.message').allInnerTexts().then(t => t.join()))
})

// The clipboard is the editor's, not a tab's: a range copied in one tab pastes in another as the sound it was copied
// from (its sinks left out) cropped to the range; the tab it was copied in pastes its own copy step
test('editor: a range copied in one tab pastes in another', async () => {
  await open()
  await noCues()
  await write(`audio('chime.wav').gain(-3).save('out.wav')`)
  await lengthIs('0:08.000')
  const { box, x } = await axis(8), y = box.y + tall(box) * .3
  await drag([x(1), y], [x(2) - x(1), 0])
  await page.keyboard.press('ControlOrMeta+C')
  await page.waitForFunction(() => /\.copy\(\{ at: [\d.]+, d: [\d.]+ \}\)/.test(scriptText()))
  const [, at, d] = (await code()).match(/\.copy\(\{ at: ([\d.]+), d: ([\d.]+) \}\)/)
  const piece = `audio('chime.wav').gain(-3).crop({ at: ${at}, d: ${d} })`
  await page.getByRole('button', { name: 'New tab' }).click()
  await write(`audio('rhodes.wav')`)
  await lengthIs('0:09.000')
  const r = await axis(9)
  await page.mouse.click(r.x(3), y)
  await page.keyboard.press('ControlOrMeta+V')
  await page.waitForFunction(p => scriptText().includes(`.insert(${p}, { at: `), piece)
  await lengthIs(clock(9 + +d))
  // the first tab pastes its own copy
  await page.getByRole('tab', { name: 'chime.wav' }).click()
  await page.waitForFunction(() => scriptText().includes('.copy('))
  await page.mouse.click(x(5), y)
  await page.keyboard.press('ControlOrMeta+V')
  await page.waitForFunction(() => /\.paste\([\d.]+, 0\.01\)/.test(scriptText()))
  // its copy step undone, it pastes the clip as any other tab does
  await page.keyboard.press('ControlOrMeta+Z')
  await page.keyboard.press('ControlOrMeta+Z')
  await page.waitForFunction(() => !scriptText().includes('.copy('))
  await page.mouse.click(x(5), y)
  await page.keyboard.press('ControlOrMeta+V')
  await page.waitForFunction(p => scriptText().includes(`.insert(${p}, { at: `), piece)
})
// ... and from one window of the editor to another of the same browser: one copies all of its chime, the other, used
// there, pastes it into the same tab, as another's sound
test('editor: a range copied in one window pastes in another', async () => {
  const context = await browser.newContext(), first = await context.newPage(), second = await context.newPage()
  await chimeLeft(context)
  const script = p => p.evaluate(() => [...document.querySelectorAll('.cm-content .cm-line')].map(l => l.textContent).join('\n'))
  const caret = async p => { const b = await p.locator('.plot').boundingBox(); await p.mouse.click(b.x + b.width * .3, b.y + b.height * .3) }
  try {
    for (const p of [first, second]) p.on('pageerror', e => errors.push(e.message))
    await first.goto(origin + '/playground/')
    await first.locator('.readout[data-of="all"]').waitFor()
    await caret(first)
    await first.keyboard.press('ControlOrMeta+A')
    await first.keyboard.press('ControlOrMeta+C')
    await first.waitForFunction(() => localStorage.getItem('audio-repl-clip'))
    await second.goto(origin + '/playground/')
    await Promise.all([second.waitForEvent('load'), second.getByRole('button', { name: 'Use it here' }).click()])
    // (all of it selected, as the first left it: the readout the selection's)
    await second.waitForFunction(() => document.querySelector('.readout')?.dataset.of === 'selection')
    await caret(second)
    await second.keyboard.press('ControlOrMeta+V')
    await second.waitForFunction(() => /\.insert\(audio\('chime\.wav'\)\.trim\(\)\.normalize\(-1\)\.fade\(0\.02, 0\.1\)\.crop\(\{ at: 0, d: [\d.]+ \}\), \{ at: [\d.]+, xfade: 0\.01 \}\)$/.test([...document.querySelectorAll('.cm-content .cm-line')].map(l => l.textContent).join('').trim()))
    assert.equal((await script(second)).match(/\.copy\(/g).length, 1, 'the first window\'s copy step, as it stored it')
  } finally { await context.close() }
})

// A copy reaches the system's clipboard: the sound cropped to the range, as code, and in Chrome the range as a WAV (its
// web format), at the depth Export writes (16 bits for a generated sound), its samples the output's there: the library's
// own render of the same chain, read in Node, the reference
test('editor: a copy puts the range on the system clipboard, as code and as a WAV', async () => {
  await open()
  await noCues()
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin })
  await write(`audio('chime.wav').gain(-3)`)
  await lengthIs('0:08.000')
  const { box, x } = await axis(8), y = box.y + tall(box) * .3
  await drag([x(1), y], [x(2) - x(1), 0])
  await page.keyboard.press('ControlOrMeta+C')
  await page.waitForFunction(() => /\.copy\(/.test(scriptText()))
  const [, at, d] = (await code()).match(/\.copy\(\{ at: ([\d.]+), d: ([\d.]+) \}\)/).map(Number)
  // the WAV encoded in the worker, the clipboard written once it comes
  await page.waitForFunction(async () => { try { return (await navigator.clipboard.read())[0]?.types.includes('web audio/wav') } catch { return false } })
  const got = await page.evaluate(async () => {
    const [item] = await navigator.clipboard.read()
    return { types: item.types, text: await (await item.getType('text/plain')).text(), wav: [...new Uint8Array(await (await item.getType('web audio/wav')).arrayBuffer())] }
  })
  assert.equal(got.text, `audio('chime.wav').gain(-3).crop({ at: ${at}, d: ${d} })`)
  const a = await audio(new Uint8Array(got.wav)), [y0] = await a.read()
  assert.equal(a.bitDepth, 16)
  assert.equal(a.sampleRate, SAMPLES)
  // the range to the view's precision (a millisecond): its samples, wherever in that it starts, the render's to 16 bits
  assert.ok(Math.abs(y0.length - d * SAMPLES) < SAMPLES / 500, `${y0.length} samples for ${d} s`)
  const [ref] = await audio.from(samples.chime.make(), { sampleRate: SAMPLES }).gain(-3).read()
  const off = Math.round(at * SAMPLES), err = k => y0.reduce((m, v, i) => Math.max(m, Math.abs(v - ref[off + k + i])), 0)
  const best = Math.min(...Array.from({ length: 2 * 45 + 1 }, (_, k) => err(k - 45)))
  assert.ok(best <= 1 / 32768, `off by ${best}`)
})
// ⌘V takes what the system's clipboard holds that is newer than the editor's own copy: a WAV another page copied (as a
// page of this editor elsewhere does, its storage not this one's), and an audio file copied in the Finder, each going in
// at the caret as a file dropped there does
test('editor: ⌘V pastes a WAV another page copied, and an audio file copied elsewhere', async () => {
  await open()
  await noCues()
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin })
  await write(`audio('rhodes.wav')`)
  await lengthIs('0:09.000')
  const tone = [...await audio.from([Float32Array.from({ length: SAMPLES }, (_, i) => .5 * Math.sin(2 * Math.PI * 440 * i / SAMPLES))], { sampleRate: SAMPLES }).encode('wav')]
  await page.evaluate(bytes => navigator.clipboard.write([new ClipboardItem({ 'text/plain': new Blob(['elsewhere'], { type: 'text/plain' }), 'web audio/wav': new Blob([new Uint8Array(bytes)], { type: 'audio/wav' }) })]), tone)
  const { box, x } = await axis(9), y = box.y + tall(box) * .3
  await page.mouse.click(x(3), y)
  await page.keyboard.press('ControlOrMeta+V')
  await page.waitForFunction(() => /\.insert\(audio\('pasted\.wav'\), \{ at: 3(\.\d+)?, xfade: 0\.01 \}\)$/.test(scriptText().trim()))
  await lengthIs('0:10.000')
  // a file, as the browser hands one copied in the Finder with the paste
  await page.mouse.click((await axis(10)).x(5), y)
  await page.locator('.plot').evaluate((plot, bytes) => {
    const data = new DataTransfer()
    data.items.add(new File([new Uint8Array(bytes)], 'tone.wav', { type: 'audio/wav' }))
    plot.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }))
  }, tone)
  await page.waitForFunction(() => /\.insert\(audio\('tone\.wav'\), \{ at: 5(\.\d+)?, xfade: 0\.01 \}\)$/.test(scriptText().trim()))
  await lengthIs('0:11.000')
  const paste = (name, type) => page.locator('.plot').evaluate((plot, [bytes, name, type]) => {
    const data = new DataTransfer()
    data.items.add(new File([new Uint8Array(bytes)], name, { type }))
    plot.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }))
  }, [tone, name, type])
  // at two carets, at each, the last first
  const r = await axis(11)
  await page.mouse.click(r.x(2), y)
  await page.keyboard.down('Alt')
  await page.mouse.click(r.x(8), y)
  await page.keyboard.up('Alt')
  await paste('tone-2.wav', 'audio/wav')
  await page.waitForFunction(() => /\.insert\(audio\('tone-2\.wav'\), \{ at: 8(\.\d+)?, xfade: 0\.01 \}\)\.insert\(audio\('tone-2\.wav'\), \{ at: 2(\.\d+)?, xfade: 0\.01 \}\)$/.test(scriptText().trim()))
  await lengthIs('0:13.000')
  // a range copied here: its WAV on the system's clipboard is this editor's own, its copy step pasted, a file that is
  // not audio (an image copied) passed over
  const q = await axis(13)
  await page.mouse.click(q.x(6), y)
  await drag([q.x(1), y], [q.x(2) - q.x(1), 0])
  await page.keyboard.press('ControlOrMeta+C')
  await page.waitForFunction(() => /\.copy\(/.test(scriptText()))
  // (read as it changes, the write's WAV landing, a read throws: read again)
  await page.waitForFunction(async () => { try { const [i] = await navigator.clipboard.read(); return i?.types.includes('web audio/wav') && (await (await i.getType('text/plain')).text()).startsWith(`audio('rhodes.wav')`) } catch { return false } })
  await page.mouse.click(q.x(4), y)
  await paste('picture.png', 'image/png')
  await page.waitForFunction(() => /\.copy\(\{ at: [\d.]+, d: [\d.]+ \}\)\s*\.paste\([\d.]+, 0\.01\)$/.test(scriptText().trim()))
  // a ⌘V no paste follows (a browser that pastes only where text is written): the editor's own, as its key is let go
  await page.locator('.plot').evaluate(plot => { for (const type of ['keydown', 'keyup']) plot.dispatchEvent(new KeyboardEvent(type, { key: 'v', metaKey: true, ctrlKey: true, bubbles: true, cancelable: true })) })
  await page.waitForFunction(() => (scriptText().match(/\.paste\(/g) || []).length === 2)
  assert.equal((await code()).match(/pasted\.wav/g).length, 1, 'its own WAV not pasted as another page\'s')
})

// A card's switches: a step turned off (its eye) is commented out where it stands; open, its Δ plays and draws what it
// takes out
test('editor: a step turns off and on, Δ shows what it takes out', async () => {
  await open()
  await tab('Edits')
  const card = name => page.locator('.step', { has: page.locator('.step-name', { hasText: name }) })
  await card('Normalize').hover()
  await page.getByRole('button', { name: 'Turn normalize off' }).click()
  await page.waitForFunction(() => document.querySelector('.cm-content').textContent.includes('// .normalize(-1)'))
  await page.waitForFunction(() => !document.querySelector('.readout').textContent.startsWith('−1.0'))
  assert.ok(await card('Normalize').evaluate(el => el.classList.contains('off')))
  await card('Normalize').hover()
  await page.getByRole('button', { name: 'Turn normalize on' }).click()
  await page.waitForFunction(() => !document.querySelector('.cm-content').textContent.includes('//'))
  await page.locator('.readout', { hasText: '−1.0dBFS' }).waitFor()
  // what the fade takes out, from its card open: the start and end it softens, far under the output
  await card('Fade').locator('.step-name').click()
  await card('Fade').getByRole('button', { name: 'Δ What it takes out' }).click()
  await page.locator('.viewing', { hasText: 'What Fade takes out' }).waitFor()
  await page.waitForFunction(() => { const m = document.querySelector('.readout').textContent.match(/^−([\d.]+)dBFS/); return m && +m[1] > 6 })
  await card('Fade').getByRole('button', { name: 'Δ What it takes out' }).click()
  await page.locator('.viewing').waitFor({ state: 'detached' })
  await page.locator('.readout', { hasText: '−1.0dBFS' }).waitFor()
})

// The caret dragged, Shift held on the way: a range from where the caret was pressed
test('editor: a caret dragged with Shift held becomes a range from where it was pressed', async () => {
  await open()
  await noCues()
  await write(`audio('chime.wav')`)
  await lengthIs('0:08.000')
  const { box, x } = await axis(8), row = box.y + box.height - 8
  await page.mouse.move(x(2), row)
  await page.mouse.down()
  await page.mouse.move(x(2.5), row, { steps: 3 })
  await page.keyboard.down('Shift')
  await page.mouse.move(x(3), row, { steps: 3 })
  await page.mouse.up()
  await page.keyboard.up('Shift')
  assert.equal(await selected(), '0:02.000–0:03.000')
})

// A generated sound's first call makes it: the source has nothing to turn off, take away or remove; chosen, it is the
// sound alone. A step that changes time, rate or channels has nothing to take away (Δ): it doesn't line up.
test('editor: a generated sound\'s source has no switches and shows the sound alone; a step that reshapes has no Δ', async () => {
  await open()
  await write(`audio.from(t => 0.5 * Math.sin(2 * Math.PI * 440 * t), { duration: 1, channels: 2 }).gain(-3).filter('highpass', 80).remix(1).speed(2)`)
  await lengthIs('0:00.500')
  await tab('Edits')
  const card = name => page.locator('.step', { has: page.locator('.step-name', { hasText: name }) })
  // the source: nothing to turn off or remove
  assert.equal(await card('From').locator('.step-acts').count(), 0)
  assert.deepEqual(await card('Gain').locator('.step-acts button').evaluateAll(b => b.map(x => x.getAttribute('aria-label'))), ['Turn gain off', 'Remove gain'])
  // open, a step that reshapes has no Δ
  const delta = async name => { await card(name).locator('.step-name').click(); const n = await card(name).locator('.step-delta').count(); await card(name).locator('.step-name').click(); return n }
  assert.deepEqual([await delta('Gain'), await delta('Filter'), await delta('Remix'), await delta('Speed')], [1, 1, 0, 0])
  await page.locator('.step-name', { hasText: 'From' }).click()
  await page.locator('.viewing', { hasText: 'Up to From: ' }).waitFor()
  await lengthIs('0:01.000')
  await page.locator('.viewing').getByRole('button', { name: 'Show all' }).click()
  await page.locator('.viewing').waitFor({ state: 'detached' })
  await lengthIs('0:00.500')
})

// What each card says of its step: numbers with their units, a band in hertz, a range by its times, a gain curve by its
// points, warp's markers as from → to, a sound by its name
test('editor: each card says what its step is set to, whatever its arguments are', async () => {
  await open()
  await write(`audio('chime.wav')\n  .gain({ t: [0, 1, 2], v: [0, -6, 0] })\n  .spectral([500, 2000], -6, { at: 1, duration: 0.5 })\n  .warp([[1, 1.2], [2, 2.1]])\n  .mix(audio('chime.wav'), { at: 2 })\n  .normalize(-16, 'lufs')`)
  await lengthIs('0:08.000')
  await tab('Edits')
  assert.deepEqual(await page.locator('.step-args').allInnerTexts(), ['', 'curve, 3 points', '500Hz–2kHz · −6dB · 1–1.5s', '1 → 1.2, 2 → 2.1', 'chime.wav · from 2s', '−16dB · lufs'])
})

// What the sound is, on the display: its rate resamples it, its channels mix it, each setting the chain's one call
test('editor: the display\'s rate resamples and its channels mix, each the chain\'s one call', async () => {
  await open()
  await page.getByRole('button', { name: '44.1kHz', exact: true }).click()
  await page.locator('#rate-menu .menu-item', { hasText: '48kHz' }).click()
  await page.waitForFunction(() => scriptText().includes('.resample(48000)'))
  await page.waitForFunction(() => document.querySelector('.facts').textContent.startsWith('48kHz'))
  await page.getByRole('button', { name: '48kHz', exact: true }).click()
  await page.locator('#rate-menu .menu-item', { hasText: '22.05kHz' }).click()
  await page.waitForFunction(() => { const t = scriptText(); return t.includes('.resample(22050)') && !t.includes('48000') })
  await page.getByRole('button', { name: 'stereo', exact: true }).click()
  await page.locator('#channels-menu .menu-item', { hasText: 'mono' }).click()
  await page.waitForFunction(() => scriptText().includes('.remix(1)'))
  await page.waitForFunction(() => document.querySelector('.facts').innerText.replace(/\s+/g, ' ').trim() === '22.05kHz mono 16-bit')
  // the standard rates (audiojs/sample-rate), each with what it is for; layouts up to 7.1
  await page.getByRole('button', { name: '22.05kHz', exact: true }).click()
  assert.deepEqual(await page.locator('#rate-menu .menu-item strong').allInnerTexts(), ['8kHz', '11.025kHz', '16kHz', '22.05kHz', '44.1kHz', '48kHz', '88.2kHz', '96kHz', '176.4kHz', '192kHz', '352.8kHz', '384kHz'])
  assert.ok((await page.locator('#rate-menu .menu-item span').allInnerTexts()).every(t => t.split(/\s+/).length >= 2 && t.split(/\s+/).length <= 4))
  await page.keyboard.press('Escape')
  const fact = () => page.evaluate(() => document.querySelector('.facts').innerText.replace(/\s+/g, ' ').trim())
  const layout = async (from, to, call) => {
    await page.getByRole('button', { name: from, exact: true }).click()
    await page.locator('#channels-menu .menu-item', { has: page.locator('strong', { hasText: new RegExp(`^${to.replace('.', '\\.')}$`) }) }).click()
    await page.waitForFunction(call => scriptText().trimEnd().endsWith(call), call)
    await page.waitForFunction(to => document.querySelector('.facts').innerText.replace(/\s+/g, ' ').trim() === `22.05kHz ${to} 16-bit`, to)
  }
  assert.deepEqual(await page.locator('#channels-menu .menu-item strong').allInnerTexts(), ['mono', 'stereo', '5.1', '7.1'])
  // up from mono, the sound in the centre; 5.1 to 7.1, its surrounds in the back pair too; down, the ITU downmix
  await layout('mono', '5.1', '.remix([null, null, 0, null, null, null])')
  await layout('5.1', '7.1', '.remix([0, 1, 2, 3, 4, 5, 4, 5])')
  await layout('7.1', 'stereo', '.remix(2)')
  // stereo to 5.1: the matrix upmix
  await layout('stereo', '5.1', '.surround()')
  assert.equal(await fact(), '22.05kHz 5.1 16-bit')
})

// Zoomed out past the whole: the sound starts at the left edge, the room on its right; the time row is marked
// An edit that takes a while arrives as it renders, in place of the output shown: the view keeps where it was zoomed to
// (it once showed the whole again, an output of no length said yet read as a new sound)
test('editor: an output rendering in place of the one shown keeps the zoom, the selection and the caret', async () => {
  await open()
  await noCues()
  await write(`audio('chime.wav')`)
  await lengthIs('0:08.000')
  const { box, x } = await axis(8), y = box.y + tall(box) * .3
  await page.mouse.click(x(4), y)
  await page.locator('.plot').focus()
  for (let i = 0; i < 2; i++) await page.keyboard.press('=')
  await page.waitForTimeout(200)
  // the time at the view's left edge, from a click there
  const left = async () => { await page.mouse.click(box.x + 1, y); return (await page.locator('.time').innerText()).split(':').reduce((m, s) => m * 60 + +s, 0) }
  const before = await left()
  assert.ok(before > 2 && before < 4, `zoomed in about the caret: the view from ${before}`)
  await write(`audio('chime.wav').pitch(3)`)
  await page.waitForFunction(() => !document.querySelector('.message').textContent && (e => e.title || e.dataset.tip || '')(document.querySelector('.source')).endsWith('0:08.000'), null, { timeout: 30000 })
  await page.waitForTimeout(500)
  assert.ok(Math.abs(await left() - before) < .01, 'the view where it was')
  // zoomed in while a sound still arrives, it stays zoomed in once the sound is whole (it went back to all of it)
  await write(`audio('${origin}/slow/test/fixture.wav')`)
  await page.locator('.message', { hasText: /^Decoding/ }).waitFor()
  await page.locator('.plot').focus()
  for (let i = 0; i < 2; i++) await page.keyboard.press('=')
  await page.waitForFunction(() => !document.querySelector('.message').textContent && (e => e.title || e.dataset.tip || '')(document.querySelector('.source')).endsWith('0:02.000'), null, { timeout: 30000 })
  await page.waitForTimeout(300)
  assert.ok(await left() > .2, 'still zoomed in')
})

// Where a tab's sound was zoomed to stays with the tab: another tab shows its own sound whole, and the first comes back
// as it was left, after a reload too
test('editor: each tab keeps where its sound was zoomed, switched away and back and after a reload', async () => {
  await open()
  await noCues()
  await write(`audio('chime.wav')`)
  await lengthIs('0:08.000')
  const { box, x } = await axis(8), y = box.y + tall(box) * .3
  // the time at the view's left edge, from a click there
  const left = async () => { await page.mouse.click(box.x + 1, y); return (await page.locator('.time').innerText()).split(':').reduce((m, s) => m * 60 + +s, 0) }
  await page.mouse.click(x(4), y)
  await page.locator('.plot').focus()
  for (let i = 0; i < 2; i++) await page.keyboard.press('=')
  await page.waitForTimeout(200)
  const before = await left()
  assert.ok(before > 2 && before < 4, `zoomed in about the caret: the view from ${before}`)
  await page.getByRole('button', { name: 'New tab' }).click()
  await write(`audio.from(2)`)
  await lengthIs('0:02.000')
  await page.waitForTimeout(200)
  assert.ok(await left() < .05, 'the other tab\'s sound whole')
  await page.locator('.file [role="tab"]').first().click()
  await lengthIs('0:08.000')
  await page.waitForTimeout(200)
  assert.ok(Math.abs(await left() - before) < .01, 'the first as it was left')
  await page.reload()
  await wholeLevels().waitFor()
  await lengthIs('0:08.000')
  await page.waitForTimeout(300)
  assert.ok(Math.abs(await left() - before) < .01, 'and after a reload')
})
// Zoomed in, the scrollbar at the time row's top, its labels under it, at the row's foot (view.js bar): its thumb
// dragged a quarter of the row across moves the view a quarter of the sound on, a press beside it takes the view there;
// the caret stays where it was. Showing all of it, there is none, and a press there moves the caret, as on the rest of
// the time row
test('editor: zoomed in, the scrollbar at the time row\'s top moves the view, the caret staying', async () => {
  await open()
  await noCues()
  await write(`audio('chime.wav')`)
  await lengthIs('0:08.000')
  const { box, x } = await axis(8), y = box.y + tall(box) * .3, foot = box.y + box.height - 22 + 4, w = box.width - (await gutter())
  const time = async () => (await page.locator('.time').innerText()).split(':').reduce((m, s) => m * 60 + +s, 0)
  const left = async () => { await page.mouse.click(box.x + 1, y); return time() }
  await page.mouse.click(x(6), foot)
  assert.ok(Math.abs(await time() - 6) < .05, `whole, the foot is the time row's: the caret at ${await time()}`)
  await page.mouse.click(x(2), y)
  await page.locator('.plot').focus()
  for (let i = 0; i < 2; i++) await page.keyboard.press('=')
  await page.waitForTimeout(200)
  const before = await left(), caret = await time(), span = 8 / 4
  assert.ok(before > .5 && before < 2, `zoomed in: the view from ${before}`)
  // the thumb's middle, where the view shows
  const thumb = t => box.x + (t + span / 2) / 8 * w
  // a pixel under the lanes, 4 px thick at rest, as a native overlay scrollbar's; under the pointer 6 px, as the page's
  // scrollbars draw theirs (editor.css). The rows lit down the thumb's middle on its strip (view.js onStrip, the view's
  // width, from the lanes' foot): [thick, off], CSS px
  const drawn = () => page.evaluate(px => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(() => {
    const cv = document.querySelector('.plot canvas.scrollbar'), k = cv.width / cv.getBoundingClientRect().width, { data } = cv.getContext('2d').getImageData(Math.round(px * k), 0, 1, cv.height), rows = []
    for (let y = 0; y < cv.height; y++) if (data[y * 4 + 3] > 0) rows.push(y)
    done([rows.length / k, rows[0] / k])
  }))), thumb(before) - box.x)
  assert.deepEqual(await drawn(), [4, 1], 'the thumb, 4 px thick, a pixel under the lanes')
  await page.mouse.move(thumb(before), foot)
  assert.deepEqual(await drawn(), [6, 1], 'under the pointer, 6 px')
  // the strip laid anew as the thumb moves, cleared as its canvas is resized (kept.js), never by reset(): WebKit's
  // clears the bitmap but leaves the thumbs laid before on screen, a trail of them along the row
  await page.evaluate(() => { const reset = CanvasRenderingContext2D.prototype.reset; window.__resets = 0; CanvasRenderingContext2D.prototype.reset = function () { window.__resets++; return reset.call(this) } })
  await page.mouse.down()
  await page.mouse.move(thumb(before) + w / 8, foot, { steps: 4 })
  await page.mouse.move(thumb(before) + w / 4, foot, { steps: 4 })
  await page.mouse.up()
  assert.equal(await page.evaluate(() => window.__resets), 0, 'no layer reset()')
  assert.equal(await time(), caret, 'the caret where it was')
  const dragged = await left()
  assert.ok(Math.abs(dragged - before - 2) < .1, `a quarter of the row, a quarter of the sound: from ${before} to ${dragged}`)
  await page.mouse.click(box.x + 4, foot)
  assert.ok(await left() < .05, 'pressed at its start, the view from the start')
})
// On hover (the settings' Scroll, or the ui config's `scroll`), the scrollbar as an overlay scrollbar is (view.js
// barLight): shown while the pointer is over the picture, and for a second after the view is zoomed or scrolled; its
// layer faded out otherwise. Bar, always shown
test('editor: on hover, the scrollbar shows only while the pointer is over the picture or a second after a zoom', async () => {
  await open()
  await noCues()
  await write(`audio('chime.wav')`)
  await lengthIs('0:08.000')
  await settings('Scroll', 'Bar on hover')
  const shows = on => page.waitForFunction(o => document.querySelector('.plot canvas.scrollbar').style.opacity === o, on ? '1' : '0')
  const box = await page.locator('.plot').boundingBox()
  await page.mouse.move(1, 1)
  await shows(false)
  // zoomed in by the keys, the pointer away: shown, then gone a second after
  await page.locator('.plot').focus()
  await page.keyboard.press('=')
  await shows(true)
  const zoomed = Date.now()
  await shows(false)
  assert.ok(Date.now() - zoomed > 700, `held after the zoom: ${Date.now() - zoomed} ms`)
  // the pointer over the picture: shown, and kept while it stays
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await shows(true)
  const at = await page.evaluate(() => performance.now())
  await page.waitForFunction(t => performance.now() > t + 1500, at)
  assert.equal(await page.evaluate(() => document.querySelector('.plot canvas.scrollbar').style.opacity), '1', 'kept while the pointer stays')
  // the mouse gone, the bar with it, no second held
  const left = Date.now()
  await page.mouse.move(1, 1)
  await shows(false)
  assert.ok(Date.now() - left < 500, `held after the pointer left: ${Date.now() - left} ms`)
  // Bar: shown with the pointer away
  await settings('Scroll', 'Bar')
  await shows(true)
  // embedded, the ui config's scroll its start
  const src = await page.evaluate(async () => {
    await import('/playground/embed.js')
    document.body.innerHTML = `<audio-repl panel="none" ui='{"scroll":"hover"}'><pre><code>audio('/test/fixture.wav')</code></pre></audio-repl>`
    return new Promise(r => { const t = setInterval(() => { const f = document.querySelector('audio-repl iframe'); if (f) { clearInterval(t); r(f.getAttribute('src')) } }, 20) })
  })
  await page.goto(new URL(src, origin).href)
  await page.mouse.move(1, 1)
  // (the sound drawn, the layers over it lit)
  await page.waitForFunction(() => document.querySelector('.plot canvas.overlay')?.style.opacity === '1')
  await shows(false)
  const framed = await page.locator('.plot').boundingBox()
  await page.mouse.move(framed.x + framed.width / 2, framed.y + framed.height / 2)
  await shows(true)
})
// The caret, as the selection, inactive while the picture is not focused: faint, still where play starts; whole again as
// the picture is pressed
test('editor: the caret faint while the picture is not focused', async () => {
  await open()
  await noCues()
  await write(`audio('chime.wav')`)
  await lengthIs('0:08.000')
  const box = await page.locator('.plot').boundingBox(), x = box.x + box.width * .3, y = box.y + box.height * .15
  // the caret's alpha: the most along a row in the lanes, a few px either side of where the picture was pressed
  const alpha = () => page.evaluate(([x, y]) => {
    const cv = __overlay(), r = cv.getBoundingClientRect(), k = cv.width / r.width
    const d = cv.getContext('2d').getImageData(Math.round((x - r.x) * k) - 4, Math.round((y - r.y) * k), 9, 1).data
    return Math.max(...Array.from({ length: 9 }, (_, i) => d[4 * i + 3]))
  }, [x, y])
  const reads = async ok => { let a; for (let i = 0; i < 60 && !ok(a = await alpha()); i++) await page.waitForTimeout(50); return a }
  const press = async () => { await page.mouse.click(x, box.y + box.height * .4); await page.mouse.move(1, 1) }
  await press()
  assert.equal(await reads(a => a === 255), 255, 'focused, the caret whole')
  await page.evaluate(() => document.activeElement?.blur())
  const faint = await reads(a => a < 255)
  assert.ok(faint > 40 && faint < 140, `unfocused, the caret faint (.35 of its alpha): ${faint}`)
  await press()
  assert.equal(await reads(a => a === 255), 255, 'pressed again, whole')
})
// On a touch screen, nothing hovers: the bar on hover shows a second after a zoom, then hides, and a tap where it was
// is the time row's, the caret going there, the view staying where it is
test('editor: on hover, a tap where the hidden scrollbar was moves the caret, not the view', async () => {
  const phone = await browser.newContext({ viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true })
  const p = await phone.newPage()
  p.on('pageerror', e => errors.push(e.message))
  try {
    await p.route('**/playground/editor.js', async route => { const r = await route.fetch(); route.fulfill({ response: r, body: (await r.text()).replace('v = view(', 'v = globalThis.__view = view(') }) })
    await p.goto(origin + '/blank.html')
    const src = await p.evaluate(async () => {
      await import('/playground/embed.js')
      document.body.innerHTML = `<audio-repl panel="none" ui='{"scroll":"hover"}'><pre><code>audio('/test/fixture.wav')</code></pre></audio-repl>`
      return new Promise(r => { const t = setInterval(() => { const f = document.querySelector('audio-repl iframe'); if (f) { clearInterval(t); r(f.getAttribute('src')) } }, 20) })
    })
    await p.goto(new URL(src, origin).href)
    await p.waitForFunction(() => document.querySelector('.plot canvas.overlay')?.style.opacity === '1')
    const bar = o => p.waitForFunction(o => document.querySelector('.plot canvas.scrollbar').style.opacity === o, o)
    await p.locator('.plot').focus()
    for (let i = 0; i < 2; i++) await p.keyboard.press('=')
    await bar('1')
    await bar('0')
    const range = () => p.evaluate(() => __view.range), time = () => p.locator('.time').innerText()
    const [before, caret] = [await range(), await time()]
    // the bar's row at the picture's foot, near its right end: beside the thumb, which shown would take the view there
    const box = await p.locator('.plot').boundingBox(), w = box.width - parseFloat(await p.evaluate(() => getComputedStyle(document.querySelector('.panes')).getPropertyValue('--axis')))
    await p.touchscreen.tap(box.x + w * .9, box.y + box.height - 22 + 4)
    await p.waitForFunction(was => document.querySelector('.time').innerText !== was, caret)
    assert.deepEqual(await range(), before, 'the view where it was')
  } finally { await phone.close() }
})
// A view kept from before shows at once on a reload, the sound coming into it as it arrives, not all of it first
test('editor: after a reload the view is where it was left while its sound still arrives', async () => {
  await open()
  await noCues()
  await write(`audio('${origin}/slow/test/fixture.wav')`)
  await page.waitForFunction(() => !document.querySelector('.message').textContent && (e => e.title || e.dataset.tip || '')(document.querySelector('.source')).endsWith('0:02.000'), null, { timeout: 30000 })
  const { box, x } = await axis(2), y = box.y + tall(box) * .3
  const left = async () => { await page.mouse.click(box.x + 1, y); return (await page.locator('.time').innerText()).split(':').reduce((m, s) => m * 60 + +s, 0) }
  await page.mouse.click(x(1.5), y)
  await page.locator('.plot').focus()
  for (let i = 0; i < 2; i++) await page.keyboard.press('=')
  await page.waitForTimeout(200)
  const before = await left()
  assert.ok(before > .8, `zoomed in about the caret: the view from ${before}`)
  // before the engine is up (its worker held back a second and a half), the view is there, where it was left
  const worker = '**/playground/dist/worker.js'
  await page.route(worker, async route => { await new Promise(r => setTimeout(r, 1500)); await route.continue() })
  const shown = Date.now()
  await page.reload()
  await page.locator('.plot canvas').first().waitFor()
  assert.ok(Math.abs(await left() - before) < .01, 'where it was, before the engine is up')
  assert.match(await page.locator('.message').textContent(), /^(Decoding)?$/, 'nothing come yet')
  assert.ok(Date.now() - shown < 1500, 'before the worker came')
  await page.unroute(worker)
  await page.locator('.message', { hasText: /^Decoding/ }).waitFor()
  await page.waitForTimeout(300)
  assert.ok(Math.abs(await left() - before) < .01, 'where it was, while it loads')
  await page.waitForFunction(() => !document.querySelector('.message').textContent && (e => e.title || e.dataset.tip || '')(document.querySelector('.source')).endsWith('0:02.000'), null, { timeout: 30000 })
  await page.waitForTimeout(300)
  assert.ok(Math.abs(await left() - before) < .01, 'and once it is whole')
  // an edit that waits for the whole file (normalize): the file shows dim as it arrives, in the view as it was left
  await write(`audio('${origin}/slow/test/fixture.wav').normalize()`)
  await page.waitForFunction(() => !document.querySelector('.message').textContent && (e => e.title || e.dataset.tip || '')(document.querySelector('.source')).endsWith('0:02.000'), null, { timeout: 30000 })
  await page.waitForTimeout(700)
  await page.reload()
  await page.locator('.message', { hasText: /^Decoding/ }).waitFor()
  await page.waitForTimeout(300)
  assert.ok(Math.abs(await left() - before) < .01, 'the file, dim, where it was')
  await page.waitForFunction(() => !document.querySelector('.message').textContent && (e => e.title || e.dataset.tip || '')(document.querySelector('.source')).endsWith('0:02.000'), null, { timeout: 30000 })
  await page.waitForTimeout(300)
  assert.ok(Math.abs(await left() - before) < .01, 'its output too')
})

// The sound held as it was left, its file gone: the view lets it go and invites a drop, as with nothing kept
test('editor: a view kept for a file no longer here gives way to the drop', async () => {
  await page.addInitScript(() => localStorage.setItem('audio-repl', JSON.stringify({ docs: [{ code: `audio('missing.wav')`, frame: { range: [1, 2], freqs: [0, 1], levels: [-1, 1], duration: 8, rate: 44100, channels: 2 } }] })))
  await page.goto(origin + '/playground/')
  await page.locator('.empty', { hasText: 'Drop audio here' }).waitFor()
  await page.locator('.message.problem', { hasText: 'missing.wav is not open' }).waitFor({ state: 'attached' })
})

// A file arriving shows as the picture shows: on the spectrogram, its spectrogram, dim, as it comes, never a waveform first
test('editor: a file arriving on the spectrogram draws its spectrogram as it comes', async () => {
  await open()
  await show('spec')
  // no grid, which is drawn in the waveform's canvas (view.js paintGrid): what that canvas shows is a waveform's
  await settings('Grid', 'None')
  // an edit that waits for the whole file (normalize): what shows meanwhile is the file itself. Slower than the other
  // slow files (8 KB every 300 ms, 6.6 s in all), so a slow machine's first draw still finds it arriving
  await write(`audio('${origin}/slow/test/fixture.wav?ms=300').normalize()`)
  await page.locator('.message', { hasText: /^Decoding/ }).waitFor()
  await page.waitForTimeout(900)
  assert.match(await page.locator('.message').textContent(), /^Decoding/, 'still arriving')
  const lit = async layer => {
    await page.evaluate(layer => { for (const c of document.querySelectorAll('.plot canvas')) c.style.visibility = c.classList.contains(layer) ? '' : 'hidden' }, layer)
    const n = await pixels(`let n = 0; for (let y = 10; y < h - 30; y++) for (let x = 0; x < w - 60; x++) { const i = (y * w + x) * 4; if (Math.max(d[i], d[i + 1], d[i + 2]) > 40) n++ } return n`)
    await page.evaluate(() => { for (const c of document.querySelectorAll('.plot canvas')) c.style.visibility = '' })
    return n
  }
  const [spectrum, waveform] = [await lit('spectrum'), await lit('waveform')]
  assert.ok(spectrum > 50, `its spectrogram as it comes: ${spectrum} lit`)
  assert.equal(waveform, 0, 'no waveform')
})

// The page comes up once, whole. The paper and the slabs are in the first paint; everything in them — the menus, the
// tabs, the script, the picture where the sound was left — waits out of sight until it is all laid out (data-boot),
// then comes up together, so nothing is laid out twice and nothing jumps. After that the lanes keep their end (the
// meters hold their room whether they read anything yet or not), and the sound only ever rises into the picture: never
// drawn, taken away and drawn again.
test('editor: the page comes up once, whole, and the sound only rises into it', async () => {
  await open()
  await show('spec')
  await wholeLevels().waitFor()
  await page.waitForTimeout(300)
  // every frame of the next load, from before its own scripts run
  await page.addInitScript(() => {
    window.__boot = []
    const tick = () => {
      const app = document.querySelector('#app'), plot = document.querySelector('.plot'), spec = plot?.querySelector('canvas.spectrum')
      if (app?.querySelector('.menubar')) window.__boot.push({
        boot: app.hasAttribute('data-boot'),
        menu: getComputedStyle(app.querySelector('.menubar')).opacity,
        light: spec ? +(spec.style.opacity || 0) : null,
        over: spec ? +(plot.querySelector('canvas.overlay').style.opacity || 0) : null,
        end: plot ? getComputedStyle(plot).getPropertyValue('--end').trim() : null,
        undo: Math.round(app.querySelector('.status .undo').getBoundingClientRect().x)
      })
      requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  })
  await page.reload()
  await wholeLevels().waitFor()
  await page.waitForTimeout(400)
  const seen = await page.evaluate(() => window.__boot)
  // every frame seen, said in full when one of these fails: how it came up
  const told = JSON.stringify(seen.map(f => [+f.boot, f.menu, f.light, f.over, f.end, f.undo].join(' ')))
  assert.ok(seen.some(f => f.boot), `the page waits to be wired: ${told}`)
  assert.ok(seen.every(f => !f.boot || f.menu === '0'), `nothing of it shows until it is: ${told}`)
  assert.ok(!seen.at(-1).boot && seen.at(-1).menu === '1', `and then all of it does: ${told}`)
  const light = seen.map(f => f.light).filter(v => v != null)
  assert.ok(light.every((v, i) => !i || v >= light[i - 1]), `the picture only brightens: ${[...new Set(light)]}`)
  assert.equal(light.at(-1), 1, 'full once the output is there')
  assert.ok(seen.every(f => f.light == null || f.light > 0 || !f.over), `no empty lanes, no axes, waiting for the sound: they come with it: ${told}`)
  const ends = new Set(seen.filter(f => !f.boot).map(f => f.end))
  assert.equal(ends.size, 1, `the lanes keep their end: ${[...ends]}`)
  const heads = new Set(seen.filter(f => !f.boot).map(f => f.undo))
  assert.equal(heads.size, 1, `undo stays where it is as the sound comes: ${[...heads]}`)
})

// The black-and-white spectrogram is screened over the page (editor.js paint): where the sound is quiet the page shows
// through it, its shading and all, and the louder is the whiter, up to white
test('editor: the black-and-white spectrogram is screened over the page, the page seen through it', async () => {
  await open()
  await write(`audio.from(t => 0.5 * Math.sin(2 * Math.PI * 440 * t), { duration: 1 })`)
  await lengthIs('0:01.000')
  await show('spec')
  await page.waitForTimeout(600)
  // where its quietest tenth sits, and its brightest, in the lane, clear of the gutter and the meters
  const [floor, top] = await pixels(`const lum = i => Math.max(d[i], d[i + 1], d[i + 2]), all = []
    for (let y = Math.round(h * .1); y < Math.round(h * .8); y++) for (let x = 10; x < w - 120; x++) all.push(lum((y * w + x) * 4))
    all.sort((a, b) => a - b)
    return [all[Math.floor(all.length * .1)], all.at(-1)]`)
  // the screen under it is oklch(21%) to oklch(15.5%) (assets/tokens.css); a picture of its own would cover it in black
  assert.ok(floor >= 10, `its floor is the page, seen through: ${floor}`)
  assert.ok(top > 230, `its loudest is white: ${top}`)
})

// A view kept from before that makes no sense (another version's, edited by hand) is let go: the sound shows whole
test('editor: a kept view that makes no sense shows the sound whole', async () => {
  await page.addInitScript(() => localStorage.setItem('audio-repl', JSON.stringify({ docs: [{ code: `audio('chime.wav')`, frame: { range: [5, 'x'], freqs: [1, 0], levels: null, duration: 8, rate: 0, channels: 1e6 } }] })))
  await open()
  await lengthIs('0:08.000')
  const { box } = await axis(8), y = box.y + tall(box) * .3
  await page.mouse.click(box.x + 1, y)
  assert.ok((await page.locator('.time').innerText()).split(':').reduce((m, s) => m * 60 + +s, 0) < .05, 'from its start')
})

// An edit made on the picture is drawn at once, and its output takes the picture's place without a move: zoomed in near
// the end, a delete that shortens the sound leaves the view where it was, not scrolled back; showing all of it, a
// delete keeps the scale, the room at the end where the sound went. Only a new file shows all of itself.
test('editor: an edit on the picture keeps the view where it is, at its scale, as its output comes', async () => {
  await open()
  await noCues()
  await write(`audio('chime.wav')`)
  await lengthIs('0:08.000')
  const { box, x } = await axis(8), y = box.y + tall(box) * .3
  // the time at a pixel, from a click there (the caret's)
  const at = async px => { await page.mouse.click(px, y); return (await page.locator('.time').innerText()).split(':').reduce((m, s) => m * 60 + +s, 0) }
  await drag([x(1), y], [x(2) - x(1), 0])
  await page.keyboard.press('Delete')
  await lengthIs('0:07.000')
  await page.waitForTimeout(300)
  assert.equal(await at(x(4)), 4, 'the scale kept: 4 s where it was')
  await page.keyboard.press('ControlOrMeta+Z')
  await lengthIs('0:08.000')
  await page.locator('.plot').focus()
  await page.keyboard.press('0')
  // zoomed in on the last seconds: a delete before them leaves the view where it was
  await page.mouse.click(x(7.2), y)
  for (let i = 0; i < 2; i++) await page.keyboard.press('=')
  await page.waitForTimeout(200)
  const left = await at(box.x + 1)
  assert.ok(left > 5, `zoomed in near the end: from ${left}`)
  // the sound shorter by what goes: the view stays past its end
  await drag([box.x + 20, y], [100, 0])
  await page.keyboard.press('Delete')
  await page.waitForFunction(() => /\.remove\(/.test(scriptText()))
  await page.waitForFunction(() => !document.querySelector('.message').textContent)
  await page.waitForTimeout(300)
  assert.ok(Math.abs(await at(box.x + 1) - left) < .01, 'the view where it was')
})

// A file opened here is kept in this browser (its own file system) by the name the script calls it: a reload opens it
// again, nothing asked. One
// the browser no longer has says so, with Open it…, and the file opened there takes its name, the script running again.
test('editor: a file opened is kept for the next visit; one gone asks to be opened again', async () => {
  await open()
  const file = await readFile(resolve(root, 'test/fixture.wav'))
  await page.locator('.file-input').setInputFiles({ name: 'take one.wav', mimeType: 'audio/wav', buffer: file })
  await page.waitForFunction(() => scriptText().includes("audio('take one.wav')"))
  await lengthIs('0:02.000')
  await page.waitForTimeout(300)
  await page.reload()
  await wholeLevels().waitFor()
  await lengthIs('0:02.000')
  assert.equal(await page.locator('.message.problem').count(), 0)
  // gone from the browser
  await page.evaluate(async () => (await navigator.storage.getDirectory()).removeEntry('audio-repl-files', { recursive: true }))
  await page.reload()
  await page.locator('.message.problem', { hasText: "take one.wav is not open here" }).waitFor()
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.getByRole('button', { name: 'Open it…' }).click()])
  await chooser.setFiles({ name: 'elsewhere.wav', mimeType: 'audio/wav', buffer: file })
  await wholeLevels().waitFor()
  assert.equal(await page.locator('.message.problem').count(), 0)
  assert.match(await code(), /audio\('take one\.wav'\)/)
})

// The markers are the script's: a reload runs it again on the file kept, which is still opening as it runs, and they
// come back where they were, a moment's and a range's
test('editor: markers on a file opened come back where they were after a reload', async () => {
  await open()
  const file = await readFile(resolve(root, 'test/fixture.wav'))
  await page.locator('.file-input').setInputFiles({ name: 'marked.wav', mimeType: 'audio/wav', buffer: file })
  await lengthIs('0:02.000')
  await write(`audio('marked.wav').mark(0.5, 'a').mark({ at: 1.2, d: 0.4 }, 'r')`)
  await page.waitForTimeout(600)
  await page.reload()
  await wholeLevels().waitFor()
  const { box, x } = await axis(2), strip = box.y + tall(box) + FOOT / 2
  const at = async (t, y = strip) => { await page.mouse.move(x(t), y); return page.locator('.plot').evaluate(el => el.style.cursor) }
  await grab([[x(0.5), strip]], 'ew-resize')
  assert.equal(await at(1.4), 'pointer', 'the range, in its strip')
  assert.notEqual(await at(0.9), 'pointer', 'none before it')
  assert.notEqual(await at(1.8), 'pointer', 'none past it')
})

// Zoomed out as far as it goes, the lanes show the sound and a third of it again (zoom.out 4/3, a quarter of the view
// room after it): two presses of −, the second held there
test('editor: zoomed out past the whole, the sound starts at the left and the room is on its right', async () => {
  await open()
  await page.locator('.plot').focus()
  for (let i = 0; i < 2; i++) await page.keyboard.press('-')
  await page.waitForTimeout(400)
  // lit columns of the picture, the labels at its right left out
  const [first, last] = await pixels(`let a = -1, b = -1; for (let x = 0; x < w - 60; x++) { let lit = 0; for (let y = 0; y < h * .8; y += 2) { const i = (y * w + x) * 4; if (d[i] + d[i + 1] + d[i + 2] > 300) lit++ } if (lit > 3) { if (a < 0) a = x; b = x } } return [a / w, b / w]`)
  const box = await page.locator('.plot').boundingBox(), lanes = await spans(box) / box.width
  // its end, its tail faint, short of three quarters of the lanes and past half of them (zoomed out to twice it, it would
  // end there)
  assert.ok(first < .03 && last < lanes * 3 / 4 && last > lanes / 2, `lit from ${first} to ${last}, the lanes to ${lanes}`)
})

// A fade drags from a selection's dot and shows on the waveform as it goes, before its output comes
test('editor: a fade shows on the waveform while its dot is dragged', async () => {
  await open()
  await noCues()
  await write(`audio('chime.wav')`)
  await lengthIs('0:08.000')
  const { box, x } = await axis(8), y = box.y + tall(box) * .3
  await drag([x(2), y], [x(4) - x(2), 0])
  // the waveform's bright pixels there: a fade draws it smaller
  const light = () => pixels(`let n = 0; for (let x = Math.round(arg[0] * w); x < arg[1] * w; x++) for (let y = 0; y < h * .9; y++) { const i = (y * w + x) * 4; if (d[i] + d[i + 1] + d[i + 2] > 450) n++ } return n`, [(x(2.05) - box.x) / box.width, (x(2.6) - box.x) / box.width])
  const before = await light()
  await page.mouse.move(x(2) + 9, box.y + 9)
  await page.mouse.down()
  await page.mouse.move(x(3) + 9, box.y + 9, { steps: 6 })
  await page.waitForTimeout(100)
  const during = await light()
  await page.mouse.up()
  assert.ok(during < before * .8, `dimmer as it fades: ${during} of ${before}`)
  await page.waitForFunction(() => /\.fade\(1, \{ at: 2 \}\)$/.test(scriptText()))
})

// Stopped, the caret is where the take ended from the first frame on: what stopping waits for after (the tape read
// back, the engine given the file) takes frames, in which it once showed where the take had begun
test('editor: a take stopped, the caret at its end from the first frame, never back at its start', async () => {
  await page.route('**/playground/editor.js', async route => { const r = await route.fetch(); route.fulfill({ response: r, body: (await r.text()).replace('v = view(', 'v = globalThis.__view = view(') }) })
  await open()
  await noCues()
  await write(`audio('chime.wav')`)
  await lengthIs('0:08.000')
  await page.evaluate(() => __view.setCursor(2))
  await page.getByRole('button', { name: 'Record', exact: true }).click()
  await page.waitForFunction(() => __view.playhead > 2.6, null, { timeout: 15000 })
  // the stop's own task, before anything it waits for: the next frame drawn already has the caret there
  const frames = await page.evaluate(async () => {
    document.querySelector('button.record').click()
    const out = [[__view.playhead, __view.cursor]]
    for (let i = 0; i < 12; i++) { await new Promise(r => requestAnimationFrame(r)); out.push([__view.playhead, __view.cursor]) }
    return out
  })
  for (const [playhead, cursor] of frames) assert.ok(playhead != null || cursor > 2.5, `a frame after stop: playhead ${playhead}, caret ${cursor}`)
})

// The microphone is opened once and kept between takes (sources.js): the second take asks the device for nothing and
// starts on the next block; a hidden page lets it go (its tracks ended), the next take opens it again; another channel
// count opens another
test('editor: the microphone kept between takes, let go once the page is hidden, opened again for stereo', async () => {
  await open()
  await write('')
  await page.locator('.empty').waitFor()
  // mono to start from, whatever an earlier test kept
  await settings('Record in', 'Mono')
  await page.evaluate(() => {
    const md = navigator.mediaDevices, ask = md.getUserMedia.bind(md)
    window.__asked = []
    md.getUserMedia = async c => { const s = await ask(c); window.__asked.push(s); return s }
  })
  // a take: recording (Record lit, no longer armed: the microphone answered), a third of a second of it, stopped
  const take = async () => {
    await page.getByRole('button', { name: 'Record', exact: true }).click()
    await page.waitForFunction(() => { const b = document.querySelector('button.record'); return b.classList.contains('on') && !b.classList.contains('armed') }, null, { timeout: 15000 })
    await page.waitForTimeout(300)
    await page.getByRole('button', { name: 'Stop recording', exact: true }).click()
    await page.getByRole('button', { name: 'Record', exact: true }).waitFor()
  }
  await take()
  await take()
  assert.equal(await page.evaluate(() => window.__asked.length), 1, 'the second take asked the device for nothing')
  assert.equal(await page.evaluate(() => window.__asked[0].getAudioTracks()[0].readyState), 'live', 'kept open')
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange')) })
  await page.waitForFunction(() => window.__asked[0].getAudioTracks()[0].readyState === 'ended')
  await page.evaluate(() => { delete document.hidden })
  await take()
  assert.equal(await page.evaluate(() => window.__asked.length), 2, 'hidden, let go; the next take opened it again')
  await settings('Record in', 'Stereo')
  await take()
  assert.equal(await page.evaluate(() => window.__asked.length), 3, 'stereo: opened again, for two channels')
  assert.equal(await page.evaluate(() => window.__asked[1].getAudioTracks()[0].readyState), 'ended', 'the mono one let go')
  await settings('Record in', 'Mono')
})

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

// The bar's record button starts a take and stops it
// Recording over a sound, as a dictaphone or a tape: from the caret, into the waveform as it comes, what it covers
// replaced and the end extended past; one write() step, which Undo takes back. Into a selection, it ends at its end.
test('editor: the record button records over the sound from the caret, into the waveform, one step Undo takes back', async () => {
  await open()
  // a selection's edges go where they are let go: the take's own hits, still shown a moment after Undo, take none
  await noCues()
  await write(`audio('chime.wav')`)
  await lengthIs('0:08.000')
  const { box, x } = await axis(8), y = box.y + tall(box) * .3
  await page.mouse.click(x(7.5), box.y + box.height - 8)
  await page.getByRole('button', { name: 'Record', exact: true }).click()
  await page.getByRole('button', { name: 'Stop recording', exact: true }).waitFor()
  // the one or the other: Play is off while it records
  assert.equal(await page.locator('button.play').isDisabled(), true)
  // the clock runs from the caret, past the old end
  await page.waitForFunction(() => /^0:0(8\.[3-9]|9)/.test(document.querySelector('.time').textContent), null, { timeout: 15000 })
  // the level meter by the lanes reads the microphone, not the sound where the caret was: its bar on the meters' strip
  // (view.js onStrip), read as drawn (8 px short of the level axis, --axis: SPACE before it, 3 wide), up as it beeps and falling back between,
  // by a fifth at least (its beeps half a second apart, a peak meter falls 6 dB between them: meters.js ballistics)
  await page.waitForFunction(gutter => {
    const o = document.querySelector('.plot canvas.overlay'), c = document.querySelector('.plot canvas.meters'), k = c.width / c.clientWidth, w = o.clientWidth - gutter
    const d = c.getContext('2d').getImageData(Math.round((w - 8 - c.offsetLeft) * k), 10 * k, Math.round(3 * k), c.height - 40 * k).data
    let n = 0
    for (let i = 3; i < d.length; i += 4) if (d[i] > 60) n++
    const seen = globalThis.metered ??= { top: 0, down: false }
    seen.top = Math.max(seen.top, n)
    if (seen.top > 20 && n < seen.top * .8) seen.down = true
    return seen.down
  }, await gutter(), { timeout: 10000 })
  await page.getByRole('button', { name: 'Stop recording', exact: true }).click()
  await page.waitForFunction(() => /\.write\(audio\('take\.wav'\), \{ at: 7\.5 \}\)$/.test(scriptText()))
  await page.waitForFunction(() => +(e => e.title || e.dataset.tip || '')(document.querySelector('.source')).split(' · ').pop().split(':')[1] > 8.2)
  // stopped, the caret waits where the take ended, as a tape's head: Record again records on from there, the takes
  // meeting to the sample
  const ended = +(await page.locator('.time').innerText()).split(':')[1]
  assert.ok(ended > 8.2, `the caret where the take ended: ${ended}`)
  await page.getByRole('button', { name: 'Record', exact: true }).click()
  await page.getByRole('button', { name: 'Stop recording', exact: true }).waitFor()
  await page.waitForFunction(ended => +document.querySelector('.time').textContent.split(':')[1] > ended + .3, ended, { timeout: 15000 })
  await page.getByRole('button', { name: 'Stop recording', exact: true }).click()
  await page.waitForFunction(() => /\.write\(audio\('take-2\.wav'\), \{ at: [\d.]+ \}\)$/.test(scriptText()))
  const on = +(await code()).match(/take-2\.wav'\), \{ at: ([\d.]+)/)[1]
  assert.ok(Math.abs(on - ended) < .001, `on from ${ended}: ${on}`)
  await page.keyboard.press('ControlOrMeta+Z')
  await page.keyboard.press('ControlOrMeta+Z')
  await lengthIs('0:08.000')
  // into a selection: it stops at its end by itself, the length kept
  await page.mouse.click(x(6), y)
  await drag([x(2), y], [x(2.5) - x(2), 0])
  await page.getByRole('button', { name: 'Record', exact: true }).click()
  await page.getByRole('button', { name: 'Record', exact: true }).waitFor({ timeout: 15000 })
  await page.waitForFunction(() => /\.write\(audio\('take(-\d)?\.wav'\), \{ at: 2 \}\)$/.test(scriptText()))
  await lengthIs('0:08.000')
  // with the loop on, pass after pass over the selection until stopped; the clock goes round within it
  await page.keyboard.press('ControlOrMeta+Z')
  await lengthIs('0:08.000')
  await page.mouse.click(x(6), y)
  await drag([x(2), y], [x(2.5) - x(2), 0])
  assert.equal(await selected(), '0:02.000–0:02.500')
  await page.getByRole('button', { name: 'Loop' }).click()
  await page.getByRole('button', { name: 'Record', exact: true }).click()
  await page.getByRole('button', { name: 'Stop recording', exact: true }).waitFor()
  await page.waitForTimeout(1300)
  const clock = +(await page.locator('.time').innerText()).split(':')[1]
  assert.ok(clock >= 2 && clock <= 2.5, `within the selection, pass after pass: ${clock}`)
  await page.getByRole('button', { name: 'Stop recording', exact: true }).click()
  await page.waitForFunction(() => /\.write\(audio\('take-\d\.wav'\), \{ at: 2 \}\)$/.test(scriptText()))
  await lengthIs('0:08.000')
  // each pass a take there, the last heard, the others turned off, the last cut short left out (1.3 s over 0.5 s: two or three, as the microphone starts)
  const heard = async () => (await code()).split('\n').filter(l => /\.write\(audio\('take/.test(l)).map(l => !l.trim().startsWith('//'))
  // the takes heard, as the script comes to say, in order
  const hearing = want => page.waitForFunction(w => JSON.stringify(scriptText().split('\n').filter(l => /\.write\(audio\('take/.test(l)).map(l => !l.trim().startsWith('//'))) === w, JSON.stringify(want))
  const passes = await heard()
  assert.ok(passes.length >= 2 && passes.at(-1) && passes.slice(0, -1).every(on => !on), `the passes, the last heard: ${passes}`)
  await page.locator('.message', { hasText: `Recorded ${passes.length} takes of 0:00.500` }).waitFor()
  // a number pressed in the strip hears that take, the first, then the last again; each one step Undo takes back (no
  // key switches them)
  const pressed = k => page.locator(`.plot .takes:not([hidden]) button[value="${k}"]`).click()
  await page.keyboard.press('t')
  await page.waitForTimeout(300)
  await hearing(passes)
  await pressed(0)
  await hearing(passes.map((_, i) => i === 0))
  await pressed(passes.length - 1)
  await hearing(passes)
  await page.keyboard.press('ControlOrMeta+Z')
  await hearing(passes.map((_, i) => i === 0))
  await lengthIs('0:08.000')
  // recorded there again, the loop off: one more take, heard, the one heard before turned off
  await page.getByRole('button', { name: 'Loop' }).click()
  await page.mouse.click(x(6), y)
  await drag([x(2), y], [x(2.5) - x(2), 0])
  await page.getByRole('button', { name: 'Record', exact: true }).click()
  await page.getByRole('button', { name: 'Record', exact: true }).waitFor({ timeout: 15000 })
  await page.waitForFunction(n => (scriptText().match(/\.write\(audio\('take/g) ?? []).length === n, passes.length + 1)
  await hearing([...passes.map(() => false), true])
  await lengthIs('0:08.000')
  // Edit › Takes hears the one picked; in the edits, a take turned on is heard alone
  const n = passes.length + 1
  await menu('Transport', 'Takes', 'Take 1')
  await hearing(Array.from({ length: n }, (_, i) => i === 0))
  await tab('Edits')
  await page.getByRole('button', { name: 'Turn write on' }).last().click()
  await hearing(Array.from({ length: n }, (_, i) => i === n - 1))
  // on the picture, the place's numbers in its corner, the one heard lit, then +; a press on one hears it
  const chip = page.locator('.plot .takes')
  const numbers = () => chip.locator('button').evaluateAll(b => b.map(x => [x.value === 'add' ? 'fork' : x.textContent, x.getAttribute('aria-pressed')]))
  await page.waitForFunction(k => document.querySelector('.plot .takes:not([hidden]) button[aria-pressed="true"]')?.value === k, String(n - 1))
  assert.deepEqual(await numbers(), [...Array.from({ length: n }, (_, k) => [String(k + 1), String(k === n - 1)]), ['fork', null]])
  await chip.locator('button[value="1"]').click()
  await hearing(Array.from({ length: n }, (_, i) => i === 1))
  await page.waitForFunction(() => document.querySelector('.plot .takes button[aria-pressed="true"]')?.value === '1')
  // ⌥R, Alt adding: another take of the place the caret is in, into it, to its end, heard (the picture narrower now,
  // the panel open)
  const narrow = await axis(8)
  await page.mouse.click(narrow.x(2.25), narrow.box.y + narrow.box.height - 8)
  await page.keyboard.press('Alt+KeyR')
  await page.getByRole('button', { name: 'Stop recording', exact: true }).waitFor()
  await page.getByRole('button', { name: 'Record', exact: true }).waitFor({ timeout: 15000 })
  await page.waitForFunction(n => (scriptText().match(/\.write\(audio\('take/g) ?? []).length === n, n + 1)
  await hearing(Array.from({ length: n + 1 }, (_, i) => i === n))
  assert.match(await code(), /\.write\(audio\('take-\d+\.wav'\), \{ at: 2 \}\)$/)
  await lengthIs('0:08.000')
})

// A selection's end dragged leaves the caret there (the end a drag moves), its line the end's, one pixel wide: the end
// lit on the caret's own line, not its last pixel beside it
test('editor: the end of a selection dragged, the caret its one line', async () => {
  await open()
  await noCues()
  await write(`audio('chime.wav')`)
  await lengthIs('0:08.000')
  const { box, x } = await axis(8), y = box.y + tall(box) * .5, px = t => Math.round(x(t) - box.x)
  await drag([x(2), y], [x(3) - x(2), 0])
  await drag([x(3), y], [x(4) - x(3), 0])
  assert.equal(await selected(), '0:02.000–0:04.000')
  // pointed at, the end lit: the bright columns by it in the lanes' top rows (over the sound's quiet edge)
  await page.mouse.move(x(4) - 2, y)
  await page.waitForTimeout(200)
  const lit = await pixels(`const out = []; for (let x = arg - 3; x <= arg + 3; x++) { const i = (4 * w + x) * 4; if (d[i] + d[i + 1] + d[i + 2] > 600) out.push(x - arg) } return out`, px(4))
  assert.equal(lit.length, 1, `one line at its end: ${lit}`)
})

// The sound's own start and end are cues as any: a press within a few px of them, there
test('editor: a press by the sound\'s start or end goes onto it', async () => {
  await open()
  await write(`audio('chime.wav')`)
  await lengthIs('0:08.000')
  const { box, x } = await axis(8), y = box.y + tall(box) * .3
  for (const [t, dx, want] of [[0, 2, '0:00.000'], [8, -2, '0:08.000']]) {
    for (const until = Date.now() + 8000; Date.now() < until; await page.waitForTimeout(200)) {
      await page.mouse.click(x(t) + dx, y)
      if (await page.locator('.time').innerText() === want) break
    }
    assert.equal(await page.locator('.time').innerText(), want, `by ${t} s, onto it`)
  }
})

// Zoomed out past the sound's end: its lanes' centre line on, faint, to the view's end, as the room's new track's is; the
// pointer's time on the time row there too, past the end, where nothing is yet
test('editor: past the sound\'s end, its centre line on to the view\'s end, the pointer\'s time on the row', async () => {
  await open()
  await noCues()
  await write(`audio('chime.wav')`)
  await lengthIs('0:08.000')
  await page.locator('.plot').focus()
  for (let i = 0; i < 2; i++) await page.keyboard.press('-')
  await page.waitForTimeout(500)
  const box = await page.locator('.plot').boundingBox(), w = await spans(box), lane = tall(box)
  // the first lane's middle row past the end (the last tenth of the lanes, where the sound is not), its ink
  const line = () => pixels(`let n = 0; for (let x = Math.round(arg.w * .92); x < arg.w - 2; x++) { let most = 0; for (let y = arg.y - 1; y <= arg.y + 1; y++) { const i = (y * w + x) * 4; most = Math.max(most, d[i] + d[i + 1] + d[i + 2]) } if (most > 120) n++ } return n`, { w, y: Math.round(lane / 4) })
  await page.mouse.move(box.x + 5, box.y + box.height - 4)
  assert.ok(await line() > w * .07 - 4, `its centre line on past its end: ${await line()}`)
  // the pointer past the end, over the lanes: its tick on the row, where it is, bright
  const at = Math.round(w * .95)
  await page.mouse.move(box.x + at, box.y + lane / 2)
  await page.waitForTimeout(200)
  const tick = await pixels(`for (let x = arg.at - 2; x <= arg.at + 2; x++) { const i = ((h - 6) * w + x) * 4; if (d[i] + d[i + 1] + d[i + 2] > 450) return x - arg.at } return null`, { at })
  assert.ok(tick != null, 'its time on the row, past the end')
})

// The strip under the lanes, as Photoshop's split slider marks a range under its bar: a named range ◢ its name ◣
// there, small triangles hanging from the lanes' foot, nothing between them but a fill while it is selected, nothing of
// it over the sound but its stretch pointed at; its name still in sight once it is selected, no line of the selection
// in the strip. Plain
// hovered over the lanes, as a scrub shows them: the cues either side of the pointer, a line each down the lanes in the
// cues' colour; on one, a short wash on its sound's side
test('editor: the strip under the lanes marks a range ◢ named ◣, nothing over the sound; hovered, the cues either side', async () => {
  await open()
  await write(`audio('chime.wav').mark({ at: 2, d: 2 }, 'Chorus')`)
  await lengthIs('0:08.000')
  const { box, x } = await axis(8), lane = Math.round(tall(box)), px = t => Math.round(x(t) - box.x)
  // in a strip of columns [a, b) and rows [y0, y1), the pixels unlike the ground there (its column at 7 s, where nothing
  // is) by more than `by`
  const marked = ([a, b], [y0, y1], by = 45) => pixels(`let n = 0; for (let y = arg.y0; y < arg.y1; y++) { const g = (y * w + arg.g) * 4; for (let x = arg.a; x < arg.b; x++) { const i = (y * w + x) * 4; if (Math.abs(d[i] - d[g]) + Math.abs(d[i + 1] - d[g + 1]) + Math.abs(d[i + 2] - d[g + 2]) > arg.by) n++ } } return n`, { a, b, y0, y1, by, g: px(7) })
  const row = [lane + 1, lane + FOOT - 1]
  await page.mouse.move(box.x + 5, box.y + box.height - 8)
  await page.waitForFunction(() => document.querySelector('.readout')?.dataset.of === 'all')
  assert.ok(await marked([px(2) - 6, px(2) + 1], [lane, lane + 9]) > 10 && await marked([px(4), px(4) + 7], [lane, lane + 9]) > 10, 'its triangles hanging from the lanes\' foot, at its start and its end')
  assert.equal(await marked([px(1.9), px(2) + 1], [lane + 10, lane + FOOT]), 0, 'as tall as its name\'s capitals')
  // from its name to its end nothing of it: no line, no fill
  assert.equal(await marked([px(3.2), px(3.8)], [lane, lane + 9], 30), 0, 'nothing between its name and its end')
  // pointed at, its stretch lit over the sound, as a press there would select it; between its triangles, nothing
  await page.mouse.move(x(3.5), box.y + lane + 4)
  let over = 0
  for (const until = Date.now() + 2000; over < (px(3.8) - px(3.2)) * 3 && Date.now() < until; await page.waitForTimeout(100)) over = await marked([px(3.2), px(3.8)], [2, 6], 15)
  assert.ok(over >= (px(3.8) - px(3.2)) * 3, `lit over the sound pointed at: ${over}`)
  assert.equal(await marked([px(3.2), px(3.8)], [lane + 1, lane + 7], 15), 0, 'nothing between its triangles pointed at')
  await page.mouse.move(box.x + 5, box.y + box.height - 8)
  // its name after its start
  assert.ok(await marked([px(2) + 3, px(2) + 50], row, 240) > 15, 'its name between them')
  // nothing of it over the sound: the lanes' top row, over it and past it, alike
  const top = [2, 6]
  assert.equal(await marked([px(2.5), px(3.5)], top), 0, 'no wash over the sound')
  // pressed there: selected, its name still in sight, its triangles lit, nothing between them; a selection elsewhere,
  // nothing of it in the strip (the end's triangle's ink, all its channels summed)
  const ink = () => pixels(`let n = 0; for (let y = arg.y0; y < arg.y1; y++) for (let x = arg.a; x < arg.b; x++) { const i = (y * w + x) * 4; n += d[i] + d[i + 1] + d[i + 2] } return n`, { a: px(4), b: px(4) + 6, y0: lane + 1, y1: lane + 10 })
  const resting = await ink()
  await page.mouse.click(x(3), box.y + lane + FOOT / 2)
  assert.equal(await selected(), '0:02.000–0:04.000')
  await page.mouse.move(box.x + 5, box.y + box.height - 8)
  assert.ok(await marked([px(2) + 3, px(2) + 50], row, 240) > 15, 'its name, selected')
  assert.equal(await marked([px(3.2), px(3.8)], [lane + 1, lane + 7], 15), 0, 'selected, nothing between its triangles')
  assert.ok(await ink() > resting * 1.1, `selected, its triangles lit: ${resting} → ${await ink()}`)
  await drag([x(5), box.y + lane / 2], [x(6) - x(5), 0])
  await page.mouse.move(box.x + 5, box.y + box.height - 8)
  assert.equal(await marked([px(5.2), px(5.8)], [lane + 1, lane + FOOT - 1]), 0, 'no line of the selection in the strip')
  await page.mouse.click(x(.5), box.y + lane / 2)
  // plain hovered over the lanes between two strikes: a line at the cue either side, in the cues' colour, down the lanes
  // (their top rows, over the sound's quiet edge)
  const lines = () => pixels(`const out = []; for (let x = 0; x < arg.w; x++) { const i = (arg.y * w + x) * 4; if (d[i] - d[i + 2] > 30 && (!out.length || x - out.at(-1) > 2)) out.push(x) } return out`, { y: 3, w: px(7.9) })
  let near = []
  for (const until = Date.now() + 8000; near.length < 2 && Date.now() < until; await page.waitForTimeout(200)) { await page.mouse.move(x(5.3), box.y + lane / 3); near = await lines() }
  assert.ok(near.length === 2 && near[0] < px(5.3) && near[1] > px(5.3), `a line either side of 5.3 s: ${near}`)
  // between them, no wash; on one (within 3 px, where a press would snap), a short wash on the side its sound is on
  // (after a strike), gone within WASH (8) px, none before it
  const tint = (xs, dx) => pixels(`return arg.xs.map(x => { const i = (arg.y * w + x + arg.dx) * 4; return d[i] - d[i + 2] })`, { xs, y: 3, dx })
  assert.ok((await tint(near, 3)).every(v => v < 4), 'between them, no wash')
  const [on] = near
  await page.mouse.move(box.x + on + 1, box.y + lane / 3)
  let after = [0]
  for (const until = Date.now() + 3000; after[0] < 8 && Date.now() < until; await page.waitForTimeout(100)) after = await tint([on], 3)
  const [before, past] = [await tint([on], -3), await tint([on], 12)]
  assert.ok(after[0] >= 8 && before[0] < 4 && past[0] < 4, `on it, washed after it: ${after}; before: ${before}; 12 px on: ${past}`)
  // held Alt, every cue's line
  await page.keyboard.down('Alt')
  let all = []
  for (const until = Date.now() + 3000; all.length <= 2 && Date.now() < until; await page.waitForTimeout(100)) all = await lines()
  await page.keyboard.up('Alt')
  assert.ok(all.length > 2, `held Alt, ${all.length} lines`)
  // snapping off: none, a press going where it is
  await menu('View', 'Snap to cues and markers')
  await page.mouse.move(x(5.3), box.y + lane / 3)
  near = [1]
  for (const until = Date.now() + 3000; near.length && Date.now() < until; await page.waitForTimeout(100)) near = await lines()
  assert.deepEqual(near, [], 'none with snapping off')
  // the pointer gone from the lanes: none
  await page.mouse.move(box.x + 5, box.y + box.height - 8)
  for (const until = Date.now() + 3000; near.length && Date.now() < until; await page.waitForTimeout(100)) near = await lines()
  assert.deepEqual(near, [], 'none with the pointer off the lanes')
})

// A trial (?row=band): the time row in the strip of the track pointed at, under its sound, not at the picture's foot;
// pointed elsewhere, under the edited track's
test('editor: ?row=band puts the time row in the strip of the track pointed at', async () => {
  await page.goto(origin + '/playground/?row=band')
  await wholeLevels().waitFor({ state: 'attached' })
  await noCues()
  await write(`let a = audio('chime.wav')\n\nlet b = audio('chime.wav')\n  .gain(-6)`)
  await page.waitForFunction(() => document.querySelector('.plot').dataset.tracks === '2')
  await lengthIs('0:08.000')
  const box = await page.locator('.plot').boundingBox(), lanes = await tracksAt()
  // the time row's text in rows [y0, y1) of the plot, across the lanes: light grey pixels
  const text = ([y0, y1]) => pixels(`let n = 0; for (let y = arg.y0; y < arg.y1; y++) for (let x = 0; x < arg.w; x++) { const i = (y * w + x) * 4; if (d[i] > 90 && Math.abs(d[i] - d[i + 2]) < 20) n++ } return n`, { y0, y1, w: Math.round(box.width - 80) })
  const strip = i => (y => [y + 2, y + FOOT - 2])(Math.round(lanes[i].y + lanes[i].h - box.y)), foot = [Math.round(box.height) - 10, Math.round(box.height)]
  // where the row is, once the pointer is at (px, py): the strips' and the foot's text
  const rowAt = async (px, py, want) => {
    await page.mouse.move(px, py)
    let got
    for (const until = Date.now() + 3000; Date.now() < until; await page.waitForTimeout(100)) {
      got = [await text(strip(0)), await text(strip(1)), await text(foot)]
      if (got.map(n => n > 30).join() === want.join()) break
    }
    return got
  }
  const [a0, a1, af] = await rowAt(box.x + box.width / 2, lanes[0].y + lanes[0].h / 2, [true, false, false])
  assert.ok(a0 > 30 && a1 < 5 && af < 5, `pointed at a: under a, ${a0}; under b, ${a1}; at the foot, ${af}`)
  const [b0, b1, bf] = await rowAt(box.x + box.width / 2, lanes[1].y + lanes[1].h / 2, [false, true, false])
  assert.ok(b0 < 5 && b1 > 30 && bf < 5, `pointed at b: under a, ${b0}; under b, ${b1}; at the foot, ${bf}`)
  const [r0, r1] = await rowAt(box.x + box.width / 2, box.y + box.height - 4, [false, true, false])
  assert.ok(r0 < 5 && r1 > 30, `pointed under them: under the edited one, b: ${r0}, ${r1}`)
})

// A range pointed at in its strip lights its stretch over the sound, as a press there would select it; selected
// already, nothing more: its stretch is not lit twice
test('editor: a range selected, pointed at in its strip, is not lit over the sound again', async () => {
  await open()
  await noCues()
  await write(`audio('chime.wav').mark({ at: 2, d: 2 })`)
  await lengthIs('0:08.000')
  const { box, x } = await axis(8), lane = tall(box), strip = box.y + lane + FOOT / 2
  // the lanes' top row in it, over the sound's quiet edge, after the pointer has been there a moment
  const shade = async (px, py) => { await page.mouse.move(px, py); await page.waitForTimeout(300); return pixels(`const i = (arg.y * w + arg.x) * 4; return d[i] + d[i + 1] + d[i + 2]`, { x: Math.round(x(3.5) - box.x), y: 3 }) }
  const away = [box.x + 5, box.y + box.height - 8]
  const ground = await shade(...away), lit = await shade(x(3.5), strip)
  assert.ok(lit > ground + 10, `pointed at, lit: ${ground} → ${lit}`)
  await page.mouse.click(x(3.5), strip)
  assert.equal(await selected(), '0:02.000–0:04.000')
  const chosen = await shade(...away), again = await shade(x(3.5), strip)
  assert.ok(Math.abs(again - chosen) <= 3, `selected, pointed at again: ${chosen} → ${again}`)
})

// Takes are marked in the strip under the lanes, from where they go in to where the longest of them ends (each measured,
// those turned off too, a sample's or a file kept as a recording's), pressed there selecting all of it, as a range
// marker's, their numbers at its end inside it (held in sight at the picture's right), on a name's line, + selecting
// their place, nothing said by them; on a visit's first run too
test('editor: takes are marked in the strip under all they span, pressed there selecting it, their numbers in it', async () => {
  await open()
  // the one heard 4.5 s long, the one turned off 8 s: to 9 s, the sound's end
  await write(`audio('rhodes.wav')\n  // .write(audio('chime.wav'), { at: 1 })\n  .write(audio('birdsong.wav'), { at: 1 })`)
  await lengthIs('0:09.000')
  const { box, x } = await axis(9), chip = page.locator('.plot .takes:not([hidden])')
  await chip.waitFor()
  // at its end inside it, here the sound's, on a name's line (NAMES, 6 px under the lanes' foot)
  const corner = await chip.boundingBox()
  assert.ok(corner.x > x(8) && corner.x + corner.width <= x(9) + TAIL + 1 && Math.abs(corner.y + corner.height / 2 - box.y - tall(box) - 6) < 2, `in its strip, by its end: ${JSON.stringify(corner)}`)
  // its place in the strip, pressed near its end: all of it selected, to 9 s
  const strip = box.y + tall(box) + FOOT / 2
  const line = async () => { await page.mouse.move(x(8.7), strip); return page.evaluate(() => document.querySelector('.plot').style.cursor) }
  assert.equal(await line(), 'pointer')
  await page.waitForTimeout(100)
  assert.equal(await page.locator('.hint').evaluate(e => e.hidden ? '' : e.textContent), '', 'nothing said: a press there is plain')
  await page.mouse.click(x(8.7), strip)
  assert.equal(await selected(), '0:01.000–0:09.000')
  // + adds an empty take there, as long as the place, heard, its place selected, recording nothing; + then off till it
  // is recorded into or deleted (Delete take, a right-click there: the one before heard again)
  await page.mouse.click(x(5), box.y + tall(box) * .5)
  await chip.locator('button[value="add"]').click()
  await page.waitForFunction(() => scriptText().endsWith(`// .write(audio('birdsong.wav'), { at: 1 })\n  .write(audio.from(8), { at: 1 })`))
  assert.equal(await selected(), '0:01.000–0:09.000')
  assert.equal(await page.getByRole('button', { name: 'Stop recording', exact: true }).count(), 0)
  await page.locator('.plot .takes button[value="add"][aria-disabled="true"]').waitFor()
  await chip.locator('button[value="add"]').click({ force: true })
  assert.equal((await code()).match(/audio\.from\(8\)/g).length, 1, 'one empty take at a time')
  await page.mouse.click(x(5), box.y + tall(box) * .5, { button: 'right' })
  await page.locator('.menu-row', { hasText: 'Delete take' }).click()
  await page.waitForFunction(() => scriptText().endsWith(`  .write(audio('birdsong.wav'), { at: 1 })`))
  await page.mouse.click(x(5), box.y + tall(box) * .5)
  await page.reload()
  await wholeLevels().waitFor()
  for (const until = Date.now() + 5000; await line() !== 'pointer'; await page.waitForTimeout(100)) assert.ok(Date.now() < until, 'measured on the first run too')
  // another tab shown and this one again, its sound as it was left, nothing run: its takes there still
  const tabs = page.locator('.file [role="tab"]')
  await page.getByRole('button', { name: 'New tab' }).click()
  await page.locator('.plot .takes').waitFor({ state: 'hidden' })
  await tabs.first().click()
  await chip.waitFor({ timeout: 2000 })
  assert.equal(await line(), 'pointer', 'shown again, its takes there')
})

// A range marked over the takes' place names it: its name at their start, their numbers at their end, inside it (as
// far from it as the name is from the start: the last number's padding, 2 px, then 2 px)
test('editor: a range over the takes\' place names it, its name at their start, their numbers at their end', async () => {
  await open()
  await write(`audio('rhodes.wav')\n  // .write(audio('chime.wav'), { at: 1 })\n  .write(audio('birdsong.wav'), { at: 1 })\n  .pad(0, 3)\n  .mark({ at: 1, d: 8 }, 'Verse')`)
  await lengthIs('0:12.000')
  const { box, x } = await axis(12), lane = Math.round(tall(box)), chip = page.locator('.plot .takes:not([hidden])')
  await chip.waitFor()
  const at = await chip.boundingBox()
  assert.ok(Math.abs(at.x + at.width - x(9) + 2) < 2, `at their end, inside: ${at.x + at.width - x(9)} px`)
  // the rows the bright ink of columns [a, b) takes in the strip, from the lanes' foot
  const rows = (a, b) => pixels(`const out = []; for (let y = arg.y0; y < arg.y1; y++) { for (let x = arg.a; x < arg.b; x++) { const i = (y * w + x) * 4; if (d[i] > 120) { out.push(y - arg.lane); break } } } return out`, { a, b, y0: lane, y1: lane + 18, lane })
  // its name from 4 px past their start, bright on the strip's line (once its marker has come with the output)
  const ink = () => pixels(`let n = 0; for (let y = arg.y0; y < arg.y1; y++) for (let x = arg.a; x < arg.b; x++) { const i = (y * w + x) * 4; if (d[i] > 120) n++ } return n`, { a: Math.round(x(1) - box.x) + 3, b: Math.round(x(1) - box.x) + 34, y0: lane + 1, y1: lane + 12 })
  let lit = 0
  for (const until = Date.now() + 5000; lit < 15 && Date.now() < until; await page.waitForTimeout(100)) lit = await ink()
  assert.ok(lit >= 15, `its name at their start: ${lit}`)
  // their numbers' text on its name's rows, from a pixel under the lanes' foot (its middle NAMES, 6 px, under it)
  const named = await rows(Math.round(x(1) - box.x) + 3, Math.round(x(1) - box.x) + 34), numbers = await rows(Math.round(at.x - box.x), Math.round(at.x - box.x + at.width))
  assert.ok(named[0] === 1 && JSON.stringify(numbers) === JSON.stringify(named), `the numbers on the name's rows: ${numbers}, ${named}`)
})

// More takes than four show three about the one heard, in sight, as a pager keeps its page, … either side for those
// past them, a menu of them all, the one heard checked; four, each its number (… would take a number's room and hide
// one); after them a fork, another take
test('editor: takes past the third fold into a menu, the one heard in sight', async () => {
  await open()
  const takes = (n, k) => `audio('rhodes.wav')` + Array.from({ length: n }, (_, i) => `\n  ${i === k ? '' : '// '}.write(audio('chime.wav'), { at: 1 })`).join('')
  const chip = page.locator('.plot .takes:not([hidden])')
  const shown = () => chip.locator('button').evaluateAll(b => b.map(x => x.value === 'add' ? (x.querySelector('svg') ? 'fork' : x.textContent) : x.textContent + (x.getAttribute('aria-pressed') === 'true' ? '*' : '')))
  const heard = k => page.waitForFunction(k => document.querySelector('.plot .takes:not([hidden]) button[aria-pressed="true"]')?.value === k, String(k))
  await write(takes(4, 3))
  await heard(3)
  assert.deepEqual(await shown(), ['1', '2', '3', '4*', 'fork'])
  // five, the fewest that fold, the fourth heard: the third to the fifth, the first two folded before them
  await write(takes(5, 3))
  await page.waitForFunction(() => document.querySelector('.plot .takes:not([hidden]) button[value="more"]'))
  assert.deepEqual(await shown(), ['…', '3', '4*', '5', 'fork'])
  await write(takes(6, 1))
  await heard(1)
  assert.deepEqual(await shown(), ['1', '2*', '3', '…', 'fork'])
  await write(takes(6, 4))
  await heard(4)
  assert.deepEqual(await shown(), ['…', '4', '5*', '6', 'fork'])
  // … pressed: all six as a menu under it, the one heard checked; one picked there, heard, in sight after …
  await chip.locator('button[value="more"]').click()
  assert.equal(await chip.locator('button[value="more"]').getAttribute('aria-expanded'), 'true')
  const rows = await page.locator('.menubar-menu .menu-row').evaluateAll(r => r.map(x => [x.querySelector('.menu-label').textContent, x.getAttribute('aria-checked')]))
  assert.deepEqual(rows, Array.from({ length: 6 }, (_, k) => [`Take ${k + 1}`, String(k === 4)]))
  await contextRow('Take 6').click()
  await heard(5)
  assert.match(await code(), /\/\/ \.write\(audio\('chime\.wav'\), \{ at: 1 \}\)\n {2}\.write\(audio\('chime\.wav'\), \{ at: 1 \}\)$/)
  assert.deepEqual(await shown(), ['…', '4', '5', '6*', 'fork'])
  // the third heard of six: the second to the fourth, … either side
  await write(takes(6, 2))
  await heard(2)
  assert.deepEqual(await shown(), ['…', '2', '3*', '4', '…', 'fork'])
})

// Takes stay drawn through an edit after them that leaves their place where it is (a delete of the tail), drawn where it
// goes after one that moves it (a delete before them), and as the script alone can't place them (a trim), not drawn
test('editor: takes drawn where the steps after them take their place', async () => {
  await open()
  const takes = `audio('rhodes.wav')\n  // .write(audio('chime.wav'), { at: 1 })\n  .write(audio('birdsong.wav'), { at: 1 })`, chip = page.locator('.plot .takes:not([hidden])')
  // their place, pressed in the strip just past where it starts: selected from there
  const corner = async (n, t, from) => { await lengthIs(n); const { box, x } = await axis(+n.slice(3)); await chip.waitFor(); await page.mouse.click(x(t) + 10, box.y + tall(box) + FOOT / 2); assert.equal((await selected()).split('–')[0], from) }
  await write(`${takes}\n  .remove({ at: 8, d: 1 })`)
  await corner('0:08.000', 1, '0:01.000')
  await write(`${takes}\n  .remove({ at: 0, d: 0.5 })`)
  await corner('0:08.500', .5, '0:00.500')
  await write(`${takes}\n  .trim()`)
  await page.locator('.plot .takes').waitFor({ state: 'hidden' })
})

// Takes under a sound written over their place after them: one more recorded there brings them over it, heard (it once
// stayed under it, the picture going back to what covered it as it stopped, the take unheard); so does a take switched
// there, by its number
test('editor: a take recorded where takes are under a later write brings them over it, heard; a take switched too', async () => {
  await open()
  const buried = `audio('rhodes.wav')\n  // .write(audio('chime.wav'), { at: 1 })\n  .write(audio('birdsong.wav'), { at: 1 })\n  .write(audio('chime.wav'), { at: 1.5 })`
  await write(buried)
  await lengthIs('0:09.500')
  const { box, x } = await axis(9.5), chip = page.locator('.plot .takes:not([hidden])')
  await chip.waitFor()
  // their place selected (pressed in the strip), Record records into it, from its start
  await page.mouse.click(x(8.7), box.y + tall(box) + FOOT / 2)
  assert.equal(await selected(), '0:01.000–0:09.000')
  await page.getByRole('button', { name: 'Record', exact: true }).click()
  await page.getByRole('button', { name: 'Stop recording', exact: true }).waitFor()
  await page.waitForFunction(() => /^0:0(1\.[5-9]|[2-9])/.test(document.querySelector('.time').textContent), null, { timeout: 15000 })
  await page.getByRole('button', { name: 'Stop recording', exact: true }).click()
  await page.waitForFunction(() => /take\.wav/.test(scriptText()))
  assert.equal(await code(), `audio('rhodes.wav')\n  .write(audio('chime.wav'), { at: 1.5 })\n  // .write(audio('chime.wav'), { at: 1 })\n  // .write(audio('birdsong.wav'), { at: 1 })\n  .write(audio('take.wav'), { at: 1 })`)
  // a take switched where they are under it: they come over it, that one heard
  await write(buried)
  await chip.waitFor()
  // (its two takes shown, the recorded one gone with the script that had it)
  await chip.locator('button[value="2"]').waitFor({ state: 'detached' })
  await chip.locator('button[value="0"]').click()
  await page.waitForFunction(() => scriptText().endsWith(`.write(audio('chime.wav'), { at: 1.5 })\n  .write(audio('chime.wav'), { at: 1 })\n  // .write(audio('birdsong.wav'), { at: 1 })`))
})

// Recorded with the spectrogram shown, the take is drawn as one: its columns on the spectrogram's layer where it goes, no
// waveform on the waveform's. The fake microphone (Chromium's --use-fake-device-for-media-stream) beeps each second.
test('editor: recording with the spectrogram shown draws the take as a spectrogram', async t => {
  // real time on software GL: headless Chromium draws the live spectrogram on the CPU as the take grows, which a CI
  // runner's few cores can't keep up with (a click on Stop waited past 30 s). CI runs it apart, as advice (test.yml)
  if (process.env.CI) return t.skip('real time on software GL: CI runs it apart')
  await open()
  await noCues()
  await write(`audio('chime.wav')`)
  await lengthIs('0:08.000')
  await show('spec')
  const { box, x } = await axis(8)
  await page.mouse.click(x(1), box.y + box.height - 8)
  await page.getByRole('button', { name: 'Record', exact: true }).click()
  await page.getByRole('button', { name: 'Stop recording', exact: true }).waitFor()
  // past 3.5 s (a slow machine's clock, drawn seconds apart, may pass it between two looks)
  await page.waitForFunction(() => { const [m, s] = document.querySelector('.time').textContent.split(':'); return +m * 60 + +s >= 3.5 }, null, { timeout: 15000 })
  // each layer alone: lit pixels between 1.2 s and 2.8 s, inside the take, over the lanes
  const lit = async layer => {
    await page.evaluate(layer => { for (const c of document.querySelectorAll('.plot canvas')) c.style.visibility = c.classList.contains(layer) ? '' : 'hidden' }, layer)
    const n = await pixels(`let n = 0; for (let y = 10; y < h - 30; y++) for (let x = arg[0]; x < arg[1]; x++) { const i = (y * w + x) * 4; if (Math.max(d[i], d[i + 1], d[i + 2]) > 90) n++ } return n`, [Math.round(x(1.2) - box.x), Math.round(x(2.8) - box.x)])
    await page.evaluate(() => { for (const c of document.querySelectorAll('.plot canvas')) c.style.visibility = '' })
    return n
  }
  const [spectrum, waveform] = [await lit('spectrum'), await lit('waveform')]
  await page.getByRole('button', { name: 'Stop recording', exact: true }).click()
  assert.ok(spectrum > 50, `the take's spectrogram: ${spectrum} lit`)
  assert.equal(waveform, 0)
})

// Under the lanes, the room, where a new track is made by putting sound there, as a layer in Figma is made by drawing,
// never added empty: pointed at, a new track's lane there, its centre line faint; pressed, its caret, the selection
// gone; a paste there makes the track, the clip in it where the caret was, the one edited then. A double-click there
// makes nothing; its right-click menu makes an empty one (Ableton's, Reaper's), under the last, whichever is edited
test('editor: under the lanes, a press puts a new track\'s caret; a paste there makes the track; its menu makes an empty one', async () => {
  const { box, x } = await chime()
  await drag([x(1), box.y + 40], [x(2) - x(1), 0])
  await page.keyboard.press('ControlOrMeta+C')
  await page.waitForFunction(() => scriptText().includes('.copy('))
  // the room ROOM px tall, under the sound's lanes' foot
  const under = box.y + tall(box) + FOOT + ROOM / 2
  await page.mouse.dblclick(x(4), under)
  assert.equal(await selected(), '', 'pressed, the selection gone, the caret there')
  assert.ok(!/let track/.test(await code()), 'a double-click makes no track')
  await page.keyboard.press('ControlOrMeta+V')
  await page.waitForFunction(() => /^let chime = audio\('chime\.wav'\)\n  \.copy\(\{ at: 1, d: 1 \}\)\n\nlet track = audio\.from\(0\)\n  \.write\(audio\('chime\.wav'\)\.crop\(\{ at: 1, d: 1 \}\), \{ at: [\d.]+ \}\)$/.test(scriptText()))
  // the new track the edited one, its layer the second
  await page.waitForFunction(() => document.querySelectorAll('.layer')[1]?.classList.contains('on'))
  // an empty one from its menu, under the last, the first edited
  await page.waitForFunction(() => (l => l.length === 2 && l.every(e => e.dataset.lane))([...document.querySelectorAll('.layer')]))
  await page.mouse.click(x(4), (r => r.y + r.h / 2)((await tracksAt())[0]))
  await page.waitForFunction(() => (l => l.length === 2 && l.every(e => e.dataset.lane))([...document.querySelectorAll('.layer')]))
  const [, last] = await tracksAt()
  await page.mouse.click(x(4), last.y + last.h + FOOT + ROOM / 2, { button: 'right' })
  await page.locator('.menu-row', { hasText: /^New track/ }).click()
  await page.waitForFunction(() => /\n\nlet track2 = audio\.from\(0\)$/.test(scriptText()))
})

// The room under tracks: a new track's band, its lane as tall as the last's (one dragged shorter here); pressed, the caret
// down that lane alone, and the track made there has that lane, where the caret was, as tall as the last
test('editor: the room under the tracks is a new track\'s lane as tall as the last; the track made there has it', async () => {
  await open()
  await noCues()
  await write(`let a = audio('chime.wav')\n\nlet b = audio('rhodes.wav')`)
  await lengthIs('0:09.000')
  await page.locator('.layer').nth(1).waitFor({ state: 'attached' })
  const box = await page.locator('.plot').boundingBox(), short = TRACK - 40
  let [, b] = await tracksAt()
  await drag([box.x + 300, b.y + b.h + FOOT / 2], [0, -40])
  await page.waitForFunction(h => document.querySelectorAll('.layer')[1].dataset.lane.split(' ')[1] === String(h), short)
  ;[, b] = await tracksAt()
  const top = b.y + b.h + FOOT + HEAD, x = 300
  await page.mouse.click(box.x + x, top + short / 2)
  // the pointer off it, over a's lane: none of the room's words over the caret
  await page.mouse.move(box.x + 40, b.y - 60)
  // the caret's rows, CSS px from the plot's top: the column at x lit past half opacity
  const [from, to] = await page.evaluate(x => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(() => {
    const cv = __overlay(), k = cv.width / cv.clientWidth, g = cv.getContext('2d'), d = g.getImageData(Math.round(x * k), 0, 1, cv.height - Math.round(22 * k)).data, lit = []
    for (let y = 0; y < d.length / 4; y++) if (d[y * 4 + 3] > 128) lit.push(y / k)
    done([Math.min(...lit), Math.max(...lit)])
  }))), x)
  assert.ok(Math.abs(box.y + from - top) <= 2 && Math.abs(box.y + to - (top + short)) <= 2, `the caret down the new lane: ${box.y + from}…${box.y + to}, the lane ${top}…${top + short}`)
  await page.mouse.click(box.x + x, top + short / 2, { button: 'right' })
  await page.locator('.menu-row', { hasText: /^New track/ }).click()
  await page.waitForFunction(() => document.querySelectorAll('.layer').length === 3)
  const [, , made] = await tracksAt()
  assert.ok(Math.abs(made.y - top) <= 1 && Math.round(made.h) === short, `the track made where the lane was, as tall: ${made.y}, ${made.h}`)
  assert.equal(JSON.parse(await page.evaluate(() => localStorage.getItem('audio-repl'))).docs[0].heights.track, short, 'kept with the tab')
})

// A track made by a paste into the room is as tall as the last too (editor.js intoNew: the last read before the paste
// writes the new one in)
test('editor: a paste into the room under the tracks makes a track as tall as the last', async () => {
  await open()
  await noCues()
  await write(`let a = audio('chime.wav')\n\nlet b = audio('rhodes.wav')`)
  await lengthIs('0:09.000')
  await page.locator('.layer').nth(1).waitFor({ state: 'attached' })
  const { box, x } = await axis(9), short = TRACK - 40
  let [a, b] = await tracksAt()
  await page.mouse.click(x(4), a.y + 40)
  await drag([x(1), a.y + 40], [x(2) - x(1), 0])
  await page.keyboard.press('ControlOrMeta+C')
  await page.waitForFunction(() => scriptText().includes('.copy('))
  await drag([box.x + 300, b.y + b.h + FOOT / 2], [0, -40])
  await page.waitForFunction(h => document.querySelectorAll('.layer')[1].dataset.lane.split(' ')[1] === String(h), short)
  ;[, b] = await tracksAt()
  await page.mouse.click(x(4), b.y + b.h + FOOT + HEAD + short / 2)
  await page.keyboard.press('ControlOrMeta+V')
  await page.waitForFunction(() => document.querySelectorAll('.layer').length === 3)
  assert.match(await code(), /\n\nlet track = audio\.from\(0\)\n  \.write\(/)
  assert.equal(Math.round((await tracksAt())[2].h), short)
  assert.equal(JSON.parse(await page.evaluate(() => localStorage.getItem('audio-repl'))).docs[0].heights.track, short)
})

// Under the tracks, where a new one's title would be, a placeholder, + New track: pressed, the track made, empty, its
// name in hand, written and Enter, the track so named. The caret in the room a plus by its top; the meters by the lanes
// read nothing there, nothing being there yet
test('editor: under the tracks, New track where its title would be: pressed, made and named', async () => {
  await open()
  await noCues()
  await write(`let a = audio('chime.wav')\n\nlet b = audio('rhodes.wav')`)
  await lengthIs('0:09.000')
  const placeholder = page.locator('.layer-new')
  await placeholder.waitFor()
  assert.equal(await placeholder.innerText(), 'New track')
  // a plus where a layer's look is, its words where a layer's name starts
  const starts = await page.evaluate(() => { const text = el => { const r = document.createRange(); r.selectNodeContents([...el.childNodes].find(n => n.nodeType === 3)); return r.getBoundingClientRect().left }; return [text(document.querySelector('.layer-name')), text(document.querySelector('.layer-new')), document.querySelector('.layer-new svg path')?.getAttribute('d')] })
  assert.ok(Math.abs(starts[0] - starts[1]) <= 1 && starts[2] === 'M12 5v14M5 12h14', `a plus, then its words where a name starts: ${starts}`)
  const [, b] = await tracksAt(), head = await placeholder.boundingBox()
  assert.ok(Math.abs(head.y - (b.y + b.h + FOOT)) <= 1, `where its title would be: ${head.y}, under ${b.y + b.h + FOOT}`)
  // lit as the room under the lanes is pointed at, as if it were
  const tint = () => placeholder.evaluate(e => getComputedStyle(e).color)
  const idle = await tint()
  await page.mouse.move(head.x + 300, head.y + 40)
  await page.waitForFunction(was => getComputedStyle(document.querySelector('.layer-new')).color !== was, idle)
  // the meters read the caret's place in a lane; in the room, nothing
  const box = await page.locator('.plot').boundingBox(), lit = () => page.evaluate(() => { const m = document.querySelector('.plot canvas.meters'), d = m.getContext('2d').getImageData(0, 0, m.width, m.height).data; let n = 0; for (let i = 3; i < d.length; i += 4) n += d[i] > 0; return n })
  await page.mouse.click(box.x + 300, b.y + b.h / 2)
  await page.waitForFunction(() => { const m = document.querySelector('.plot canvas.meters'), d = m.getContext('2d').getImageData(0, 0, m.width, m.height).data; for (let i = 3; i < d.length; i += 4) if (d[i]) return true })
  await page.mouse.click(box.x + 300, head.y + 40)
  await page.waitForTimeout(200)
  assert.equal(await lit(), 0, 'in the room, no meters')
  await placeholder.click()
  await page.waitForFunction(() => /\n\nlet track = audio\.from\(0\)$/.test(scriptText()))
  await page.waitForFunction(() => document.activeElement?.classList.contains('layer-field'))
  await page.keyboard.type('drums')
  await page.keyboard.press('Enter')
  await page.waitForFunction(() => /\n\nlet drums = audio\.from\(0\)$/.test(scriptText()))
})

// Held Alt over a lane, the pointer's guides out to the axes, dashed in the measuring red, at once, on the caret too,
// where there is nothing to measure; and as a drag sets a time, Alt pressed on the way
test('editor: held Alt, the guides to the axes at once, on the caret and as a drag goes', async () => {
  const { x, y } = await chime()
  const guides = () => page.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(() => { const o = document.querySelector('.plot canvas.overlay'), d = o.getContext('2d').getImageData(0, 0, o.width, o.height).data; let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i] > 180 && d[i + 1] < 120 && d[i + 3] > 100) n++; done(n) }))))
  await page.mouse.click(x(2), y)
  assert.equal(await guides(), 0, 'none without Alt')
  await page.keyboard.down('Alt')
  assert.ok(await guides() > 50, 'Alt pressed, the pointer on the caret: at once')
  await page.keyboard.up('Alt')
  assert.equal(await guides(), 0, 'let go, gone')
  await page.mouse.move(x(3), y)
  await page.mouse.down()
  await page.mouse.move(x(4), y, { steps: 4 })
  await page.keyboard.down('Alt')
  await page.mouse.move(x(4.5), y, { steps: 2 })
  assert.ok(await guides() > 50, 'a range dragged, Alt pressed on the way')
  await page.mouse.up()
  await page.keyboard.up('Alt')
})

// Where a sound crosses full scale, a small cross on the line it crosses, in the measuring red, where it first does in
// each stretch that clips: here a tone pushed past it for 10 ms at half a second
test('editor: where a sound clips, a cross on the full scale line it crosses', async () => {
  await open()
  await write(`audio.from(t => (t > 0.5 && t < 0.51 ? 1.3 : 0.3) * Math.sin(2 * Math.PI * 440 * t), { duration: 1 })`)
  await lengthIs('0:01.000')
  const { box, x } = await axis(1)
  // the measuring red's pixels over the lanes, by column, px from the plot's left
  const red = () => pixels(`const out = new Set(); for (let y = 0; y < arg.h; y++) for (let x = 0; x < w; x++) { const i = (y * w + x) * 4; if (d[i] > 170 && d[i + 1] < 110 && d[i + 2] < 110) out.add(x) } return [...out]`, { h: Math.round(tall(box)) })
  let cols = []
  for (const until = Date.now() + 8000; !cols.length && Date.now() < until; await page.waitForTimeout(200)) cols = await red()
  const at = x(.5) - box.x
  assert.ok(cols.length && cols.every(c => Math.abs(c - at) <= 5), `crosses at 0.5 s alone: ${cols.slice(0, 12)} about ${at}`)
})

// The page is controls, not text: none of it selected by a press that misses; the code, the fields, keep theirs
test('editor: the page selects no text but where there is text to copy', async () => {
  await open()
  const select = sel => page.locator(sel).first().evaluate(e => getComputedStyle(e).userSelect || getComputedStyle(e).webkitUserSelect)
  assert.equal(await select('.status'), 'none')
  assert.equal(await select('.view'), 'none')
  await page.evaluate(() => document.querySelector('.panes .side-head button[aria-label="Code"]')?.click())
  assert.equal(await select('.cm-content'), 'text')
})

// The room's caret let go (Esc): back in the sound's lanes, a paste there the sound's own, no track made
test('editor: Esc takes the caret under the lanes back; a paste then goes into the sound', async () => {
  const { box, x } = await chime()
  await drag([x(1), box.y + 40], [x(2) - x(1), 0])
  await page.keyboard.press('ControlOrMeta+C')
  await page.waitForFunction(() => scriptText().includes('.copy('))
  await page.mouse.click(x(4), box.y + tall(box) + FOOT + ROOM / 2)
  await page.keyboard.press('Escape')
  // (Edit › Paste: the editor's own clip, not the system's clipboard, which the copy fills a while after)
  await menu('Edit', 'Paste')
  await page.waitForFunction(() => /\.paste\([\d.]+/.test(scriptText()))
  assert.ok(!/let track/.test(await code()), 'no track made')
})

// Pressed under the lanes, the caret a new track's to be; R records into it from there, the others playing: the track
// made as the take starts, under the last, the take written into it where the caret was
test('editor: R at the caret under the lanes records a new track there', async () => {
  const { box, x } = await chime()
  await page.mouse.click(x(2), box.y + tall(box) + FOOT + ROOM / 2)
  await page.keyboard.press('r')
  await page.getByRole('button', { name: 'Stop recording', exact: true }).waitFor()
  await page.waitForFunction(() => { const [m, s] = document.querySelector('.time').textContent.split(':'); return +m * 60 + +s >= 3 }, null, { timeout: 15000 })
  await page.keyboard.press('r')
  await page.waitForFunction(() => /^let chime = audio\('chime\.wav'\)\n\nlet track = audio\.from\(0\)\n  \.write\(audio\('take\.wav'\), \{ at: 2 \}\)$/.test(scriptText()))
})

// The same with the Record button, as with R: the caret in the room makes the take a new track's, not the last one's
test('editor: the Record button with the caret under the lanes records a new track there', async () => {
  const { box, x } = await chime()
  await page.mouse.click(x(2), box.y + tall(box) + FOOT + ROOM / 2)
  await page.getByRole('button', { name: 'Record', exact: true }).click()
  await page.getByRole('button', { name: 'Stop recording', exact: true }).waitFor()
  await page.waitForFunction(() => { const [m, s] = document.querySelector('.time').textContent.split(':'); return +m * 60 + +s >= 3 }, null, { timeout: 15000 })
  await page.getByRole('button', { name: 'Stop recording', exact: true }).click()
  await page.waitForFunction(() => /^let chime = audio\('chime\.wav'\)\n\nlet track = audio\.from\(0\)\n  \.write\(audio\('take\.wav'\), \{ at: 2 \}\)$/.test(scriptText()))
})

// A piece dragged under the last track goes to a new track there, as a clip dropped under a DAW's tracks: shown there as
// it goes, a track made for it once let go, silence where it was; a track taken away and made again under its name is
// as a new one is, its mute not the one it had
test('editor: a piece dragged under the tracks goes to a new track; a track made again is as a new one', async () => {
  const { box, x } = await chime()
  await drag([x(1), box.y + 40], [x(2) - x(1), 0])
  await page.waitForTimeout(200)
  await page.mouse.move(x(1.5), box.y + 40)
  await page.mouse.down()
  const under = box.y + tall(box) + FOOT + ROOM / 2
  for (let i = 1; i <= 8; i++) await page.mouse.move(x(1.5 + 2 * i / 8), box.y + 40 + (under - box.y - 40) * i / 8)
  await page.mouse.up()
  await page.waitForFunction(() => /^let chime = audio\('chime\.wav'\)\n  \.gain\(-Infinity, \{ at: 1, d: 1 \}\)\n\nlet track = audio\.from\(0\)\n  \.write\(audio\('chime\.wav'\)\.crop\(\{ at: 1, d: 1 \}\), \{ at: 3 \}\)$/.test(scriptText()))
  // muted, then taken away (its layer's menu) and made again (the room's): its name again, heard
  await page.locator('.layer').nth(1).waitFor({ state: 'attached' })
  await page.getByRole('button', { name: 'Mute track' }).click()
  await page.locator('.layer').nth(1).click({ button: 'right' })
  await page.locator('.menu-row', { hasText: /^Delete the track/ }).click()
  await page.waitForFunction(() => !/let track\b/.test(scriptText()))
  await page.waitForFunction(() => !document.querySelector('.plot').dataset.tracks)
  const plot = await page.locator('.plot').boundingBox()
  await page.mouse.click(plot.x + 300, plot.y + tall(plot) + FOOT + ROOM / 2, { button: 'right' })
  await page.locator('.menu-row', { hasText: /^New track/ }).click()
  await page.waitForFunction(() => /let track = audio\.from\(0\)$/.test(scriptText()))
  await page.locator('.layer').nth(1).waitFor({ state: 'attached' })
  assert.equal(await page.getByRole('button', { name: 'Mute track' }).getAttribute('aria-pressed'), 'false')
})

// A track's speaker with Alt: solo, the others muted; so again, every one heard
test('editor: Alt and a track\'s speaker solos it', async () => {
  await open()
  await noCues()
  await write(`let a = audio('chime.wav')\n\nlet b = audio('rhodes.wav')\n\nlet c = audio('handpan.wav')`)
  await page.locator('.layer').nth(2).waitFor({ state: 'attached' })
  const pressed = () => Promise.all(['a', 'b', 'c'].map(n => page.getByRole('button', { name: `Mute ${n}` }).getAttribute('aria-pressed')))
  await page.getByRole('button', { name: 'Mute b' }).click({ modifiers: ['Alt'] })
  assert.deepEqual(await pressed(), ['true', 'false', 'true'])
  await page.getByRole('button', { name: 'Mute b' }).click({ modifiers: ['Alt'] })
  assert.deepEqual(await pressed(), ['false', 'false', 'false'])
})

// A track taken away is laid out at once, before the mix without it comes, the mix playing still with it: a lane pressed
// then edits the track it shows, and its speaker mutes no track it does not show
test('editor: a track taken away, a lane pressed before the mix without it comes is the track it shows', async () => {
  await open()
  await noCues()
  await write(`let a = audio('chime.wav')\n\nlet b = audio('rhodes.wav')\n\nlet c = audio('handpan.wav')\n\nlet d = audio('chime.wav')`)
  await page.locator('.layer').nth(3).waitFor({ state: 'attached' })
  // b's lane a strip, the second; pressed, edited, tall from where it was, as c's then is, shown at once in its place
  const box = await page.locator('.plot').boundingBox(), second = (r => r.y + r.h / 2)((await tracksAt())[1])
  const card = () => page.evaluate(() => document.querySelector('.steps-list .step-name')?.textContent)
  await page.mouse.click(box.x + 200, second)
  await page.waitForFunction(() => document.querySelector('.steps-list .step-name')?.textContent.startsWith('b '))
  await menu('Track', 'Delete the track')
  // laid out at once: a, c, d. c's lane pressed, c edited (not d, the lane's index in the mix that still has b); its
  // speaker, c's or none
  await page.waitForFunction(() => [...document.querySelectorAll('.layer-name')].map(e => e.textContent).join() === 'a,c,d')
  await page.mouse.click(box.x + 200, (r => r.y + r.h / 2)((await tracksAt())[1]))
  await page.getByRole('button', { name: 'Mute c' }).click()
  await page.waitForFunction(() => document.querySelector('.plot').dataset.tracks === '3' && !/let b\b/.test(scriptText()))
  await page.waitForFunction(() => document.querySelector('.steps-list .step-name')?.textContent.startsWith('c '))
  await page.waitForTimeout(300)
  assert.match(await card(), /^c · /)
  assert.ok(!(await page.evaluate(() => JSON.parse(localStorage.getItem('audio-repl')).docs[0].muted ?? [])).includes('b'), 'b, gone, not muted in c\'s place')
})

// A track's lane shows what its own look or its menu chose (Waveform, Spectrogram or Notes: its look in its layer,
// its name right-clicked), as Audacity's tracks each show a view of their own, kept with the tab; View sets every track's
test('editor: a track\'s lane shows a waveform, a spectrogram or notes, as its look or menu chose; View sets every track\'s', async () => {
  await open()
  await noCues()
  await write(`let a = audio('chime.wav')\n\nlet b = audio('chime.wav')`)
  await page.locator('.layer').nth(1).waitFor({ state: 'attached' })
  // b edited, its lane tall under a's strip, as their layers have them
  const { box, x } = await axis(8), [a, b] = await tracksAt(), top = b.y, middle = b.y + b.h / 2
  // a lane's centre line through the quiet before the first strike, a waveform's: none on a spectrogram or under notes
  const line = y => pixels(`let n = 0; for (let x = 2; x < arg.x1; x++) for (let y = arg.y - 4; y <= arg.y + 4; y++) { const i = (y * w + x) * 4; if (d[i] + d[i + 1] + d[i + 2] > 360) n++ } return n`, { x1: Math.round(x(.4) - box.x), y: Math.round(y - box.y) })
  const kinds = () => page.evaluate(() => JSON.parse(localStorage.getItem('audio-repl')).docs[0].kinds)
  const menuOf = () => page.locator('.layer').nth(1).click({ button: 'right', position: { x: 30, y: 10 } })
  const choose = async label => { await menuOf(); await page.locator('.menu-row:visible', { hasText: new RegExp(`^${label}$`) }).click() }
  const wave = await line(middle)
  assert.ok(wave > 20, `b's centre line: ${wave}`)
  await choose('Spectrogram')
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('audio-repl')).docs[0].kinds?.b === 'spec')
  await page.waitForTimeout(300)
  assert.ok(await line(middle) < wave / 10, 'a spectrogram in b\'s lane')
  assert.ok(await line(a.y + a.h / 2) > 10, 'a waveform in a\'s strip')
  // kept: reloaded, b's lane a spectrogram again, its menu saying so
  await page.reload()
  await page.locator('.layer').nth(1).waitFor({ state: 'attached' })
  await page.waitForTimeout(800)
  assert.ok(await line(middle) < wave / 10, 'b\'s spectrogram kept')
  await menuOf()
  assert.equal(await page.locator('.menu-row:visible[aria-checked="true"]').textContent(), 'Spectrogram')
  await page.keyboard.press('Escape')
  // Notes, from b's look in its layer: b's notes, one taking the pointer where its blob is, on the chime's first note
  await page.getByRole('button', { name: 'b: Spectrogram', exact: true }).click()
  await choice('Shows', 'Notes').click()
  await page.keyboard.press('Escape')
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('audio-repl')).docs[0].kinds?.b === 'notes')
  await page.getByRole('button', { name: 'b: Notes', exact: true }).waitFor()
  await grab(Array.from({ length: 120 }, (_, k) => [x(.8), top + 20 + k * 3]), 'ns-resize')
  // View's Waveform, the one the picture shows: every track's a waveform again
  await menu('View', 'Waveform')
  await page.waitForFunction(() => !Object.keys(JSON.parse(localStorage.getItem('audio-repl')).docs[0].kinds ?? {}).length)
  await page.waitForTimeout(300)
  assert.ok(await line(middle) > wave / 2, 'b\'s waveform again')
  assert.deepEqual(await kinds(), {})
})

// A track's view goes with its name: named anew, it keeps it; taken away, it goes, so one made again under the name shows
// the picture's. A silent track's notes are none: its lane a voice's keys, nothing taking the pointer, nothing failing
test('editor: a track\'s view goes with its name; a silent track shows no notes', async () => {
  await open()
  await noCues()
  await write(`let a = audio('chime.wav')\n\nlet b = audio.from(t => 0, { duration: 8 })`)
  await page.locator('.layer').nth(1).waitFor({ state: 'attached' })
  const { box, x } = await axis(8), top = (await tracksAt())[1].y
  const kinds = () => page.evaluate(() => JSON.parse(localStorage.getItem('audio-repl')).docs[0].kinds)
  const menuOf = () => page.locator('.layer').nth(1).click({ button: 'right', position: { x: 30, y: 10 } })
  await menuOf()
  await page.locator('.menu-row:visible', { hasText: /^Notes$/ }).click()
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('audio-repl')).docs[0].kinds?.b === 'notes')
  await page.waitForTimeout(1000)
  for (let y = top + 20; y < box.y + box.height - 40; y += 8) {
    await page.mouse.move(x(2), y)
    assert.notEqual(await page.locator('.plot').evaluate(el => el.style.cursor), 'ns-resize', `no note at ${y - top}px`)
  }
  // named anew from its layer, its name clicked
  await page.locator('.layer-name', { hasText: /^b$/ }).click()
  await page.keyboard.press('ControlOrMeta+A')
  await page.keyboard.type('bed')
  await page.keyboard.press('Enter')
  await page.waitForFunction(() => /\nlet bed = audio\.from/.test(scriptText()))
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('audio-repl')).docs[0].kinds?.bed === 'notes')
  assert.deepEqual(await kinds(), { bed: 'notes' })
  await menuOf()
  await page.locator('.menu-row:visible', { hasText: /^Delete the track/ }).click()
  await page.waitForFunction(() => !/let bed\b/.test(scriptText()))
  await page.waitForFunction(() => !JSON.parse(localStorage.getItem('audio-repl')).docs[0].kinds?.bed)
  assert.deepEqual(await kinds(), {})
})

// The notes, as Melodyne shows them: a voice's notes as blobs on a piano's rows, a row a semitone, the axis naming them;
// a note pressed is selected, and dragged up two rows goes two semitones up (pitch() over it, a voice's)
test('editor: Notes shows a sound\'s notes, a row a semitone; a note dragged up two rows goes two semitones up', async () => {
  const { box, x } = await chime()
  await menu('View', 'Notes')
  // the chime's C4 to C5, two rows past them either way, two octaves at least: MIDI 54 to 78, 25 rows filling the lane
  const h = tall(box), row = h / 25, c4 = box.y + h - (60 - 54 + .5) * row
  const [px, py] = await grab([[x(.8), c4]], 'ns-resize')
  await drag([px, py], [0, -2 * row])
  await page.waitForFunction(() => /\.pitch\(2, \{ at: 0\.5\d*, d: 0\.5\d*, voice: true \}\)/.test(scriptText()))
})

// Held, a range in its strip or a note plays from its start, all of it as it is, till let go (the page's auditions, as
// view.js asks for them: { at, duration, whole }, then none); a range's name pressed plays nothing, it is written
test('editor: a range pressed in its strip, or a note, plays while held, from its start', async () => {
  await page.route('**/playground/editor.js', async route => { const r = await route.fetch(); route.fulfill({ response: r, body: (await r.text()).replace('  onaudition(o) {', '  onaudition(o) {\n    (globalThis.__heard ??= []).push(o && { at: o.at, duration: o.duration, whole: o.whole })') }) })
  await open()
  await noCues()
  await write(`audio('chime.wav').mark({ at: 2, d: 2 }, 'Chorus')`)
  await lengthIs('0:08.000')
  const { box, x } = await axis(8), strip = box.y + tall(box) + FOOT / 2, heard = () => page.evaluate(() => globalThis.__heard ?? [])
  await page.mouse.move(x(3.5), strip)
  await page.mouse.down()
  await page.waitForFunction(() => globalThis.__heard?.length === 1)
  assert.deepEqual(await heard(), [{ at: 2, duration: 2, whole: true }], 'held: all of it, from its start')
  await page.mouse.up()
  assert.deepEqual((await heard()).at(-1), null, 'let go: none')
  assert.equal(await selected(), '0:02.000–0:04.000')
  // its name pressed: named, nothing heard
  await page.mouse.click(x(2) + 14, strip)
  await page.waitForFunction(() => document.activeElement?.className === 'marker-name')
  assert.equal((await heard()).length, 2, 'its name: nothing heard')
  await page.keyboard.press('Escape')
  // a note held: the chime's first strike, C4, from its start
  await menu('View', 'Notes')
  const h = tall(box), c4 = box.y + h - (60 - 54 + .5) * h / 25
  const [px, py] = await grab([[x(.8), c4]], 'ns-resize')
  await page.mouse.move(px, py)
  await page.mouse.down()
  await page.waitForFunction(() => globalThis.__heard?.length === 3)
  const [note] = (await heard()).slice(-1), sel = (await selected()).split('–').map(t => +t.split(':')[1])
  await page.mouse.up()
  assert.ok(note.whole && Math.abs(note.at - sel[0]) < 1e-3 && Math.abs(note.at + note.duration - sel[1]) < 1e-3, `the note, as selected: ${JSON.stringify(note)}, ${sel}`)
  assert.equal((await heard()).at(-1), null, 'let go: none')
})

// A name is a field: a track's clicked is written at once, focused, in the name's own font and weight, no box round
// it, as wide as its text; the tab shown, clicked, the same, its name kept with the tab and over a reload
test('editor: a track\'s name or the shown tab\'s, clicked, is written in place at once, as it looks', async () => {
  await open()
  await noCues()
  await write(`let a = audio('chime.wav')\n\nlet b = audio('rhodes.wav')`)
  await lengthIs('0:09.000')
  const look = sel => page.evaluate(sel => { const e = document.querySelector(sel), s = getComputedStyle(e); return { font: s.fontFamily + ' ' + s.fontSize + ' ' + s.fontWeight, outline: s.outlineStyle, focused: document.activeElement === e, width: e.getBoundingClientRect().width } }, sel)
  const name = await look('.layer:nth-child(2) .layer-name')
  await page.locator('.layer-name', { hasText: /^b$/ }).click()
  const field = await look('.layer-field')
  assert.ok(field.focused, 'focused at once')
  assert.equal(field.font, name.font, 'in the name\'s font and weight')
  assert.equal(field.outline, 'none', 'no box round it')
  assert.ok(field.width < 40, `as wide as its text: ${field.width}`)
  await page.keyboard.type('bed')
  await page.keyboard.press('Enter')
  await page.waitForFunction(() => /\nlet bed = audio\('rhodes\.wav'\)/.test(scriptText()))
  // another track's name: that one edited, its name in hand as soon as its layers are laid out so
  await page.locator('.layer-name', { hasText: /^a$/ }).click()
  await page.waitForFunction(() => document.activeElement?.classList.contains('layer-field') && document.activeElement.value === 'a')
  await page.keyboard.press('Escape')
  // the tab shown
  await page.locator('.file.current [role="tab"]').click()
  assert.ok((await look('.file-field')).focused, 'the tab\'s name focused at once')
  await page.keyboard.type('Session')
  await page.keyboard.press('Enter')
  await page.waitForFunction(() => document.querySelector('.file.current [role="tab"]')?.textContent === 'Session')
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('audio-repl')).docs[0].title === 'Session')
  await page.reload()
  await wholeLevels().waitFor()
  assert.equal(await page.locator('.file.current [role="tab"]').textContent(), 'Session', 'kept over a reload')
})

// A notes lane's rows shaded as its keys, as a DAW's piano roll: the white keys and their rows the lighter (on a dark
// screen, the white rows lifted), the black keys and theirs the darker. G3 (55) white, G♯3 (56) black, under the
// chime's notes (C4 up): the lane's rows and the keys at their start
test('editor: a notes lane\'s rows are shaded as its keys, the white keys\' the lighter', async () => {
  const { box, x } = await chime()
  await menu('View', 'Notes')
  const h = tall(box), row = h / 25, y = m => Math.round(h - (m - 54 + .5) * row), key = Math.round(box.width - await gutter() - 21 + 4), lane = Math.round(x(4) - box.x)
  const lum = () => pixels(`return arg.map(([x, y]) => { const i = (y * w + x) * 4; return d[i] + d[i + 1] + d[i + 2] })`, [[lane, y(55)], [lane, y(56)], [key, y(55)], [key, y(56)]])
  let got = []
  for (const until = Date.now() + 5000; !(got[0] > got[1] && got[2] > got[3]) && Date.now() < until; await page.waitForTimeout(200)) got = await lum()
  const [laneWhite, laneBlack, keyWhite, keyBlack] = got
  assert.ok(laneWhite > laneBlack && keyWhite > keyBlack, `white rows and keys the lighter: lane ${laneWhite} > ${laneBlack}, keys ${keyWhite} > ${keyBlack}`)
})

// A note sung apart (quiet either side) dragged moves whole, from its first cycle to its last: its pitch curve stepping in
// the quiet, half way into it (50 ms at most), not a range gliding in and out over the note's first and last 90 ms
test('editor: a note sung apart, dragged, steps in the quiet either side', async () => {
  await open()
  await noCues()
  await write(`audio.from(t => (t > .4 && t < .9 ? Math.sin(2 * Math.PI * 220 * t) : t > 1.3 && t < 1.8 ? Math.sin(2 * Math.PI * 330 * t) : 0) * .5, { duration: 2.2 })`)
  await lengthIs('0:02.200')
  await menu('View', 'Notes')
  // A3 (MIDI 57) and E4 (64), two rows past them either way, two octaves at least: MIDI 49 to 73, 25 rows
  const { box, x } = await axis(2.2), h = tall(box), row = h / 25, a3 = box.y + h - (57 - 49 + .5) * row
  const [px, py] = await grab([[x(.65), a3], [x(.65), a3 - row / 3], [x(.65), a3 + row / 3]], 'ns-resize')
  await drag([px, py], [0, -2 * row])
  await page.waitForFunction(() => /\.pitch\(\{ t: \[0\.3[5-9]\d*, 0\.3[5-9]\d*, 0\.9\d*, 0\.9\d*\], v: \[0, 2, 2, 0\] \}, \{ voice: true \}\)/.test(scriptText()))
  // dragged again a row, once its notes are found again (the keys about them: a row or two on): the same steps a
  // semitone higher, one call
  const steps = (await code()).match(/t: \[[^\]]+\]/)[0]
  const [qx, qy] = await grab(Array.from({ length: 13 }, (_, k) => [x(.65), a3 - 3 * row + k * row / 3]), 'ns-resize')
  await drag([qx, qy], [0, -row])
  await page.waitForFunction(() => /v: \[0, 3, 3, 0\]/.test(scriptText()))
  assert.equal((await code()).match(/\.pitch\(/g).length, 1, 'one call')
  assert.equal((await code()).match(/t: \[[^\]]+\]/)[0], steps, 'the same steps')
})

// A notes lane's keys zoom as the levels and the frequencies do: a pinch, or Ctrl and the wheel, on them, about the key
// under the pointer, which stays where it is; zoomed, the wheel scrolls them; 0 shows them all again
test('editor: a notes lane\'s keys zoom about the key under the pointer, a row then taller', async () => {
  const { box, x } = await chime()
  await menu('View', 'Notes')
  // 25 rows, MIDI 54 to 78 (as above); a notch of Ctrl and the wheel on the keys takes them to 25 × e^−0.4, C4 kept
  const h = tall(box), c4 = box.y + h - (60 - 54 + .5) * h / 25, row = h / (25 * Math.exp(-.4))
  await grab([[x(.8), c4]], 'ns-resize')
  await page.mouse.move(box.x + box.width - 20, c4)
  await page.keyboard.down('Control')
  await page.mouse.wheel(0, -100)
  await page.keyboard.up('Control')
  // the C4 where it was, two of its new rows up two semitones (three of the old)
  const [px, py] = await grab([[x(.8), c4]], 'ns-resize')
  await drag([px, py], [0, -2 * row])
  await page.waitForFunction(() => /\.pitch\(2, \{ at: 0\.5\d*, d: 0\.5\d*, voice: true \}\)/.test(scriptText()))
  // undone; zoomed, the wheel over the lane scrolls the keys, the C4 gone from where it was; 0 shows them as they were,
  // the C4 back
  await page.keyboard.press('ControlOrMeta+Z')
  await page.waitForFunction(() => !scriptText().includes('pitch('))
  await grab([[x(.8), c4]], 'ns-resize')
  await page.mouse.move(x(4), c4)
  for (let i = 0; i < 3; i++) await page.mouse.wheel(0, 100)
  await page.mouse.move(x(.8), c4)
  assert.notEqual(await page.locator('.plot').evaluate(el => el.style.cursor), 'ns-resize', 'scrolled, no note where the C4 was')
  await page.keyboard.press('0')
  await grab([[x(.8), c4]], 'ns-resize')
})

// The level at the bar's right, one measure, chosen from its menu (the readout pressed) and kept: the peak, the RMS, the
// loudness of all of it; with a selection, its peak or RMS
test('editor: the level reads the peak, the RMS or the loudness, as chosen', async () => {
  const { box, x } = await chime()
  const read = () => page.locator('.readout').textContent()
  assert.match(await read(), /^−\d+\.\ddBFS$/)
  await page.locator('.readout').click()
  await menuRow('Loudness').click()
  await page.waitForFunction(() => /^−\d+\.\dLUFS$/.test(document.querySelector('.readout').textContent))
  assert.equal(JSON.parse(await page.evaluate(() => localStorage.getItem('audio-repl'))).reads, 'loudness')
  // a selection's own: its peak, the loudness being all of it's; its RMS, under its peak (the value alone, no word: the
  // menu and the tip say which)
  await drag([x(1), box.y + 40], [x(2) - x(1), 0])
  const peak = await read()
  assert.match(peak, /^−\d+\.\ddBFS$/)
  await page.locator('.readout').click()
  await menuRow('RMS').click()
  await page.waitForFunction(peak => { const t = document.querySelector('.readout').textContent; return /^−\d+\.\ddBFS$/.test(t) && parseFloat(t.slice(1)) > parseFloat(peak.slice(1)) }, peak)
})

// The tracks' layers, each on a head line over its lane, the picture as wide as without them. A layer's name
// double-clicked, a field there, Enter names the track, as a script names a sound. Each lane as tall as its foot was
// dragged (with Alt, every one), none grown for being edited; a locked one's taken by no press, the edited one locked
// giving way to the next. More tracks than the picture holds scroll up and down through it, their layers with them, as
// a DAW's, the room under them always in reach
test('editor: the layers over each lane name and lock the tracks; a foot dragged, its height, with Alt every one\'s; more tracks than fit scroll', async () => {
  await open()
  await noCues()
  const wide = (await page.locator('.plot').boundingBox()).width
  await write(`let a = audio('chime.wav')\n\nlet b = audio('rhodes.wav')`)
  await lengthIs('0:09.000')
  await page.locator('.layer').nth(1).waitFor({ state: 'attached' })
  assert.equal((await page.locator('.plot').boundingBox()).width, wide, 'the picture as wide as with one sound')
  // on a head line over its lane, the head's top over the lane's
  const [a0] = await tracksAt(), head0 = await page.locator('.layer').first().boundingBox()
  assert.ok(Math.abs(head0.y + HEAD - a0.y) <= 1 && head0.height <= HEAD + 1, `its head line over its lane: ${head0.y}, ${head0.height}, ${a0.y}`)
  await page.locator('.layer-name', { hasText: /^b$/ }).click()
  await page.keyboard.press('ControlOrMeta+A')
  await page.keyboard.type('Lead vocal')
  await page.keyboard.press('Enter')
  await page.waitForFunction(() => scriptText() === "let a = audio('chime.wav')\n\nlet leadVocal = audio('rhodes.wav')")
  // each TRACK px, the edited one too; a's foot dragged 60 px down, a 60 px taller, kept with the tab; double-clicked,
  // as it was made
  const card = () => page.evaluate(() => document.querySelector('.steps-list .step-name')?.textContent)
  const box = await page.locator('.plot').boundingBox(), heights = async () => (await tracksAt()).map(r => Math.round(r.h))
  assert.deepEqual(await heights(), [TRACK, TRACK], 'none grown for being edited')
  const [a1] = await tracksAt(), foot = a1.y + a1.h + FOOT / 2
  await page.mouse.move(box.x + 300, foot)
  assert.equal(await page.locator('.plot').evaluate(el => el.style.cursor), 'row-resize', 'its foot, its height to drag')
  await drag([box.x + 300, foot], [0, 60])
  await page.waitForFunction(() => document.querySelector('.layer').dataset.lane.split(' ')[1] === String(160 + 60))
  assert.equal(JSON.parse(await page.evaluate(() => localStorage.getItem('audio-repl'))).docs[0].heights.a, TRACK + 60)
  await page.mouse.dblclick(box.x + 300, foot + 60)
  await page.waitForFunction(() => document.querySelector('.layer').dataset.lane.split(' ')[1] === '160')
  // with Alt, pressed on the way, every band to the one dragged; with Alt double-clicked, every band as it was made
  const tall = () => page.evaluate(() => [...document.querySelectorAll('.layer')].map(e => +e.dataset.lane.split(' ')[1]))
  await page.mouse.move(box.x + 300, foot)
  await page.mouse.down()
  await page.mouse.move(box.x + 300, foot + 20, { steps: 3 })
  await page.keyboard.down('Alt')
  await page.mouse.move(box.x + 300, foot + 40, { steps: 3 })
  await page.mouse.up()
  await page.keyboard.up('Alt')
  await page.waitForFunction(() => [...document.querySelectorAll('.layer')].every(e => e.dataset.lane.split(' ')[1] === '200'))
  assert.deepEqual(await tall(), [TRACK + 40, TRACK + 40], 'every band')
  assert.deepEqual(JSON.parse(await page.evaluate(() => localStorage.getItem('audio-repl'))).docs[0].heights, { a: TRACK + 40, leadVocal: TRACK + 40 })
  // Alt let go on the way: the others as they were where it was pressed, the one dragged alone
  await page.mouse.move(box.x + 300, foot + 40)
  await page.mouse.down()
  await page.keyboard.down('Alt')
  await page.mouse.move(box.x + 300, foot + 60, { steps: 3 })
  await page.keyboard.up('Alt')
  await page.mouse.move(box.x + 300, foot + 50, { steps: 3 })
  await page.mouse.up()
  await page.waitForFunction(() => [...document.querySelectorAll('.layer')].map(e => e.dataset.lane.split(' ')[1]).join() === '210,200')
  await page.keyboard.down('Alt')
  await page.mouse.dblclick(box.x + 300, foot + 50)
  await page.keyboard.up('Alt')
  await page.waitForFunction(() => [...document.querySelectorAll('.layer')].every(e => e.dataset.lane.split(' ')[1] === '160'))
  // a locked while edited: leadVocal edited; a press in a's lane takes it no more
  await page.getByRole('button', { name: 'Lock a' }).click()
  await page.waitForFunction(() => document.querySelector('.steps-list .step-name')?.textContent.startsWith('leadVocal '))
  await page.mouse.click(box.x + 300, (await tracksAt())[0].y + 20)
  await page.waitForTimeout(300)
  assert.match(await card(), /^leadVocal /, 'a locked, a press in its lane edits nothing there')
  assert.deepEqual(JSON.parse(await page.evaluate(() => localStorage.getItem('audio-repl'))).docs[0].locked, ['a'])
  // a range dragged on the time row, through every track, deleted: a, locked, untouched
  await drag([box.x + 300, box.y + box.height - 11], [100, 0])
  await page.keyboard.press('Backspace')
  await page.waitForFunction(() => /let leadVocal = audio\('rhodes\.wav'\)\n  \.remove\(/.test(scriptText()))
  assert.match(await code(), /^let a = audio\('chime\.wav'\)\n\n/, 'a as it was')
  await page.keyboard.press('ControlOrMeta+Z')
  await page.waitForFunction(() => !scriptText().includes('remove('))
  // four tracks: more than the picture holds; the wheel over the lanes brings the last into sight, its layer with it, and
  // the room under it, where a press puts a new track's caret
  await write(Array.from({ length: 4 }, (_, i) => `let t${i} = audio.from(t => Math.sin(2 * Math.PI * ${220 + 20 * i} * t) * .2, { duration: 2 })`).join('\n\n'))
  await page.locator('.layer').nth(3).waitFor({ state: 'attached' })
  const time = box.y + box.height - 22, last = async () => (await tracksAt())[3]
  assert.ok((r => r.y + r.h > time)(await last()), 'the last out of sight')
  await page.mouse.move(box.x + box.width / 2, box.y + 100)
  for (let i = 0; i < 8; i++) await page.mouse.wheel(0, 120)
  await page.waitForFunction(time => (([y, h]) => document.querySelector('.plot').getBoundingClientRect().y + y + h + 18 + 40 <= time + 1)(document.querySelectorAll('.layer')[3].dataset.lane.split(' ').map(Number)), time)
  const r = await last()
  await page.mouse.move(box.x + 300, r.y + r.h + FOOT + ROOM / 2)
  assert.equal(await page.locator('.plot').evaluate(el => el.style.cursor), '', 'the room in reach')
  // the scrollbar at the right edge, its thumb dragged to the top: the first in sight again
  await drag([box.x + box.width - 2, time - 30], [0, -(box.height - 22)])
  assert.ok(Math.abs((await tracksAt())[0].y - box.y - HEAD) < 1, 'the first at the top again, under its head line')
})

// Recorded into a track, the others play as it records, the track it goes into muted; the take goes where what played
// was as the microphone heard it: both clocks read at once, the speakers' and the microphone's, less the microphone's
// latency. Here the microphone hears the page's own output, digitally, as it is rendered, before the speakers: the take
// lands that much early, the output's latency (the browser's, baseLatency and outputLatency), give or take the stream
// between the two contexts, which holds it some tens of ms more (Chromium's: 20 to 30). Not lined up, it would land as
// late as the device took to start playing, 0.2 to 0.5 s here
test('editor: ⇧R records a new track as the others play, lined up with what played', async () => {
  await page.route('**/playground/editor.js', async route => { const r = await route.fetch(); route.fulfill({ response: r, body: (await r.text()).replace('const eng = engine()', 'const eng = globalThis.__eng = engine()').replace('let output = null, incoming', 'globalThis.__output = () => output\nlet output = null, incoming') }) })
  // the microphone: what the page plays, tapped where it goes out
  await page.addInitScript(() => {
    const connect = AudioNode.prototype.connect, taps = new Map()
    AudioNode.prototype.connect = function (dest, ...rest) {
      const r = connect.call(this, dest, ...rest)
      if (dest instanceof AudioDestinationNode) {
        let t = taps.get(dest.context)
        if (!t) taps.set(dest.context, t = dest.context.createMediaStreamDestination())
        connect.call(this, t)
        globalThis.__tapped = { stream: t.stream, context: dest.context }
      }
      return r
    }
    navigator.mediaDevices.getUserMedia = async () => globalThis.__tapped.stream
  })
  const { box, x, y } = await chime()
  // played once, so its output goes somewhere to be tapped
  await page.keyboard.press('Space')
  await page.waitForTimeout(300)
  await page.keyboard.press('Space')
  await page.mouse.click(x(.01), y)
  await page.keyboard.press('Home')
  await page.keyboard.press('Shift+R')
  await page.getByRole('button', { name: 'Stop recording', exact: true }).waitFor()
  await page.waitForFunction(() => { const [m, s] = document.querySelector('.time').textContent.split(':'); return +m * 60 + +s >= 3 }, null, { timeout: 15000 })
  await page.keyboard.press('r')
  await page.waitForFunction(() => /^let chime = audio\('chime\.wav'\)\n\nlet track = audio\.from\(0\)\n  \.write\(audio\('take\.wav'\), \{ at: [\d.]+ \}\)$/.test(scriptText()))
  await page.waitForFunction(() => __output()?.tracks?.length === 2)
  // the lag of the take's lane against the chime's, over its first 3 s, ms; read off the output shown once the engine has
  // it whole (none of one a newer output replaced as it came: the one shown then is that one)
  const { lag, late } = await page.evaluate(async () => {
    let out, lanes
    for (const until = Date.now() + 8000; !lanes && Date.now() < until;) lanes = await __eng.samples((out = __output()).id, 0, Math.round(3 * out.sampleRate)) ?? await new Promise(r => setTimeout(r, 100))
    const n = Math.round(3 * out.sampleRate), [a, b] = lanes, rate = out.sampleRate
    let best = { lag: 0, c: -Infinity }
    for (let k = -4000; k <= 4000; k += 2) { let c = 0; for (let i = 8000; i < n - 8000; i += 3) c += a[i] * (b[i + k] ?? 0); if (c > best.c) best = { lag: k, c } }
    return { lag: best.lag / rate * 1000, late: (__tapped.context.baseLatency + __tapped.context.outputLatency) * 1000 }
  })
  assert.ok(Math.abs(lag + late) < 60, `the take ${lag.toFixed(1)} ms from the chime, the output's latency ${late.toFixed(1)} ms`)
})

// A take recorded as the others play is drawn as it comes where its output will put it, lined up with what played: the
// same strike in the same column as it records and once it is done, no shift as it stops (it once jumped left by the
// output's latency, the samples heard before its start left out only once it was written)
test('editor: a take recorded as the others play is drawn where it will be, no shift once it is done', async () => {
  await page.route('**/playground/editor.js', async route => { const r = await route.fetch(); route.fulfill({ response: r, body: (await r.text()).replace('const state = sprae(root, {', 'const state = globalThis.__state = sprae(root, {').replace('let output = null, incoming', 'globalThis.__output = () => output\nlet output = null, incoming') }) })
  // the microphone: what the page plays, tapped where it goes out
  await page.addInitScript(() => {
    const connect = AudioNode.prototype.connect, taps = new Map()
    AudioNode.prototype.connect = function (dest, ...rest) {
      const r = connect.call(this, dest, ...rest)
      if (dest instanceof AudioDestinationNode) {
        let t = taps.get(dest.context)
        if (!t) taps.set(dest.context, t = dest.context.createMediaStreamDestination())
        connect.call(this, t)
        globalThis.__tapped = { stream: t.stream, context: dest.context }
      }
      return r
    }
    navigator.mediaDevices.getUserMedia = async () => globalThis.__tapped.stream
  })
  const { x, y } = await chime()
  await page.keyboard.press('Space')
  await page.waitForTimeout(300)
  await page.keyboard.press('Space')
  await page.mouse.click(x(.01), y)
  await page.keyboard.press('Home')
  await page.keyboard.press('Shift+R')
  await page.getByRole('button', { name: 'Stop recording', exact: true }).waitFor()
  // the first of three columns running of the take's lane lit, px: its first strike (the caret's and the playhead's
  // lines a column wide)
  const strike = () => page.evaluate(() => __state.layout?.rows?.[1]).then(row => row && pixels(`let run = 0; for (let x = 0; x < w - 60; x++) { let n = 0; for (let y = Math.round(arg.y); y < arg.y + arg.h; y++) { const i = (y * w + x) * 4; if (d[i] + d[i + 1] + d[i + 2] > 450) n++ } run = n > 8 ? run + 1 : 0; if (run === 3) return x - 2 } return -1`, row))
  await page.waitForFunction(() => { const [m, s] = document.querySelector('.time').textContent.split(':'); return +m * 60 + +s >= 3 }, null, { timeout: 15000 })
  // (a busy runner draws the take a few frames behind the clock)
  let during = -1
  for (const until = Date.now() + 5000; during < 0 && Date.now() < until; await page.waitForTimeout(100)) during = await strike()
  await page.keyboard.press('r')
  await page.waitForFunction(() => /\.write\(audio\('take\.wav'\)/.test(scriptText()))
  await page.waitForFunction(() => __output()?.tracks?.length === 2 && !document.querySelector('.message').textContent.includes('Rendering'))
  await page.waitForTimeout(600)
  const after = await strike()
  assert.ok(during > 0 && Math.abs(after - during) <= 1, `its first strike at ${during} px as it recorded, ${after} px done`)
})

// Record pressed with Shift, as ⇧R: a new track, recorded into as the others play
test('editor: Record with Shift records a new track', async () => {
  const { box, x } = await chime()
  await page.mouse.click(x(1), box.y + 40)
  await page.getByRole('button', { name: 'Record', exact: true }).click({ modifiers: ['Shift'] })
  await page.getByRole('button', { name: 'Stop recording', exact: true }).waitFor()
  await page.waitForFunction(() => /let track = audio\.from\(0\)$/.test(scriptText()))
  await page.waitForFunction(() => { const [m, s] = document.querySelector('.time').textContent.split(':'); return +m * 60 + +s >= 2 }, null, { timeout: 15000 })
  await page.getByRole('button', { name: 'Stop recording', exact: true }).click()
  await page.waitForFunction(() => /let track = audio\.from\(0\)\n  \.write\(audio\('take\.wav'\), \{ at: 1 \}\)$/.test(scriptText()))
})

// A take recorded again into a track, from earlier than the last ended: the others play from the caret, so it goes
// where the caret was (it once went where the last take had stopped them: the player took the voice paused there over,
// its place over the new start, the take written seconds late and the track ever longer)
test('editor: a second take into a track goes where its caret was, after a first that ran on past it', async () => {
  const { box, x } = await chime()
  await page.mouse.click(x(1), box.y + 40)
  await page.keyboard.press('Shift+R')
  await page.getByRole('button', { name: 'Stop recording', exact: true }).waitFor()
  await page.waitForFunction(() => { const [m, s] = document.querySelector('.time').textContent.split(':'); return +m * 60 + +s >= 3 }, null, { timeout: 15000 })
  await page.keyboard.press('r')
  await page.waitForFunction(() => /\.write\(audio\('take\.wav'\), \{ at: 1 \}\)$/.test(scriptText()))
  await page.locator('.layer').nth(1).waitFor({ state: 'attached' })
  // (the layers beside the picture now, the picture after them)
  await page.waitForTimeout(300)
  const { x: x8 } = await axis(8)
  await page.mouse.click(x8(.5), (r => r.y + r.h / 2)((await tracksAt())[1]))
  await page.keyboard.press('r')
  await page.getByRole('button', { name: 'Stop recording', exact: true }).waitFor()
  await page.waitForFunction(() => { const [m, s] = document.querySelector('.time').textContent.split(':'); return +m * 60 + +s >= 1.5 }, null, { timeout: 15000 })
  await page.keyboard.press('r')
  await page.waitForFunction(() => /\.write\(audio\('take-2\.wav'\), \{ at: [\d.]+ \}\)$/.test(scriptText()))
  const at = +(await code()).match(/take-2\.wav'\), \{ at: ([\d.]+) \}/)[1]
  assert.ok(Math.abs(at - .5) < .02, `the second take at ${at} s, the caret at 0.5`)
  await lengthIs('0:08.000')
})

// Into a track, the others playing, over a selection with the loop on: pass after pass, the others looping with it,
// each a take, shown as one as it is done, the one recording lit (it once stopped after the first, short of the
// selection's end by the microphone's latency)
test('editor: recorded into a track over a selection, the loop on, pass after pass, each a take as it goes', async () => {
  await open()
  await noCues()
  await write(`let a = audio('rhodes.wav')\n\nlet b = audio('chime.wav')`)
  await lengthIs('0:09.000')
  await page.locator('.layer').nth(1).waitFor({ state: 'attached' })
  const { x } = await axis(9), lane = (r => r.y + r.h / 2)((await tracksAt())[1])
  await page.mouse.click(x(1), lane)
  await drag([x(6), lane], [x(7) - x(6), 0])
  assert.equal(await selected(), '0:06.000–0:07.000')
  await page.getByRole('button', { name: 'Loop' }).click()
  await page.keyboard.press('r')
  await page.getByRole('button', { name: 'Stop recording', exact: true }).waitFor()
  // the second pass under way: the first a take there, the one recording lit, nothing to switch to yet
  const numbers = () => page.locator('.plot .takes:not([hidden]) button').evaluateAll(b => b.map(x => x.value === 'add' ? 'fork' : x.textContent + (x.getAttribute('aria-pressed') === 'true' ? '*' : '')))
  await page.waitForFunction(() => document.querySelectorAll('.plot .takes:not([hidden]) button').length === 3, null, { timeout: 15000 })
  assert.deepEqual(await numbers(), ['1', '2*', 'fork'])
  await page.waitForFunction(() => document.querySelectorAll('.plot .takes:not([hidden]) button').length === 4, null, { timeout: 15000 })
  await page.keyboard.press('r')
  await page.waitForFunction(() => (scriptText().match(/\.write\(audio\('take/g) ?? []).length >= 2)
  const lines = (await code()).split('\n').filter(l => /\.write\(audio\('take/.test(l))
  assert.ok(lines.length >= 2 && lines.every(l => /\{ at: 6 \}\)$/.test(l)), lines.join('\n'))
  assert.ok(lines.slice(0, -1).every(l => l.trim().startsWith('//')) && !lines.at(-1).trim().startsWith('//'), 'the last heard')
  assert.match(await code(), /^let b = audio\('chime\.wav'\)$/m, 'into the track recorded into')
})

// Recorded into nothing, however quiet, a take is watched at full scale (±1), held still as it comes and once it is the
// sound, as a recording app's: its levels as they are, not widened to fill its lane (they were, 6 dB at a time, the
// picture jumping as it got louder)
test('editor: a quiet take recorded into nothing is drawn at full scale', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'audio-take-')), file = join(dir, 'quiet.wav'), rate = 48000, n = rate * 4
  // 220 Hz at 0.08 of full scale, as 16-bit PCM, which Chromium's fake capture reads and loops
  const wav = Buffer.alloc(44 + n * 2)
  wav.write('RIFF', 0); wav.writeUInt32LE(36 + n * 2, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22)
  wav.writeUInt32LE(rate, 24); wav.writeUInt32LE(rate * 2, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(n * 2, 40)
  for (let i = 0; i < n; i++) wav.writeInt16LE(Math.round(32767 * .08 * Math.sin(2 * Math.PI * 220 * i / rate)), 44 + 2 * i)
  await writeFile(file, wav)
  const quiet = await chromium.launch({ args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', `--use-file-for-fake-audio-capture=${file}`] })
  try {
    const p = await quiet.newPage()
    p.on('pageerror', e => errors.push(e.message))
    // how far up its lane the waveform reaches over the first fifth of the view, from the centre line: 1 at its top. Its
    // one lane the picture's, TRACK px at least, but the room under it, kept as it records and once it is a sound (`room`,
    // px), so its lane is the same as it comes and done
    const reach = async (room = 0) => {
      const png = await p.locator('.plot').screenshot()
      return p.evaluate(async ([b64, most, room]) => {
        const img = new Image()
        img.src = 'data:image/png;base64,' + b64
        await img.decode()
        const c = Object.assign(document.createElement('canvas'), { width: img.width, height: img.height }), g = c.getContext('2d')
        g.drawImage(img, 0, 0)
        const d = g.getImageData(0, 0, c.width, c.height).data, mid = Math.max(most, c.height - 22 - 18 - room) / 2
        let top = mid
        for (let y = 0; y < mid; y++) for (let x = Math.round(c.width * .04); x < c.width * .2; x++) { const i = (y * c.width + x) * 4; if (Math.max(d[i], d[i + 1], d[i + 2]) > 120 && y < top) top = y }
        return (mid - top) / mid
      }, [png.toString('base64'), TRACK, room])
    }
    await p.goto(origin + '/playground/')
    await p.locator('.empty').waitFor()
    await p.locator('button.record').click()
    await p.waitForFunction(() => { const [m, s] = document.querySelector('.time').textContent.split(':'); return +m * 60 + +s >= 2.5 })
    const taking = await reach(ROOM)
    await p.getByRole('button', { name: 'Stop recording', exact: true }).click()
    await p.waitForFunction(() => document.querySelector('.readout')?.dataset.of === 'all')
    await p.waitForTimeout(500)
    const taken = await reach(ROOM)
    // 0.08 in ±1
    assert.ok(taking > .05 && taking < .15, `as it records: ${taking}`)
    assert.ok(taken > .05 && taken < .15, `recorded: ${taken}`)
  } finally { await quiet.close(); await rm(dir, { recursive: true, force: true }) }
})

// A take is drawn as the output holding it will be: the spectrogram at the levels the output's will have (the loudest
// cell, here the take's own), the waveform in its fill and colour; stopped, the same pixels light the same. Within 10%:
// the loudest cell is a beep's, and how loud depends on how that beep's frames align, so the take's levels can move a
// little once it is whole (two runs' outputs differ by up to 6%; a slow runner's take gets more beeps before the stop)
test('editor: a take draws while it records as its output does after', async () => {
  const looks = [['spec'], ['wave'], ['wave', { Colour: 'Centroid', Fill: 'RMS' }]]
  for (const [view, wave] of looks) {
    await open()
    if (wave) for (const [group, name] of Object.entries(wave)) await settings(group, name)
    await write('')
    await page.locator('.empty').waitFor()
    await page.getByRole('button', { name: 'Record', exact: true }).first().click()
    await show(view)
    await page.waitForFunction(() => /^0:0[3-9]/.test(document.querySelector('.time').textContent), null, { timeout: 15000 })
    const { box, x } = await axis(10), layer = view === 'spec' ? 'spectrum' : 'waveform'
    // the layer alone, its mean red, green and blue over 0.2 to 2 s, recorded whole by now
    const mean = async () => {
      await page.evaluate(layer => { for (const c of document.querySelectorAll('.plot canvas')) c.style.visibility = c.classList.contains(layer) ? '' : 'hidden' }, layer)
      const v = await pixels(`const s = [0, 0, 0]; let n = 0; for (let y = 10; y < h - 30; y++) for (let x = arg[0]; x < arg[1]; x++, n++) for (let k = 0; k < 3; k++) s[k] += d[(y * w + x) * 4 + k]; return s.map(v => v / n)`, [Math.round(x(.2) - box.x), Math.round(x(2) - box.x)])
      await page.evaluate(() => { for (const c of document.querySelectorAll('.plot canvas')) c.style.visibility = '' })
      return v
    }
    const during = await mean()
    await page.getByRole('button', { name: 'Stop recording', exact: true }).click()
    await page.waitForFunction(() => /^audio\('recording/.test(scriptText()))
    await wholeLevels().waitFor()
    await page.waitForTimeout(300)
    const after = await mean(), off = Math.hypot(...during.map((v, k) => v - after[k])) / Math.hypot(...after)
    assert.ok(Math.hypot(...after) > 5, `${view}: the output drawn (${after})`)
    assert.ok(off < .1, `${view} ${JSON.stringify(wave ?? {})}: ${during.map(v => v.toFixed(1))} while recording, ${after.map(v => v.toFixed(1))} after`)
  }
})

// Search runs as it is typed, half a second after the last key, once
test('editor: sound search runs half a second after the typing stops, once', async () => {
  let asked = []
  await page.route('https://api.openverse.org/**', route => { asked.push(new URL(route.request().url()).searchParams.get('q')); route.fulfill({ contentType: 'application/json', body: JSON.stringify({ result_count: 0, results: [] }) }) })
  await open()
  await menu('File', 'Find a sound…')
  await page.getByRole('searchbox', { name: 'Find a sound' }).pressSequentially('rain', { delay: 120 })
  await page.locator('.search-state', { hasText: 'Nothing found' }).waitFor()
  await page.waitForTimeout(700)
  assert.deepEqual(asked, ['rain'])
})

// The menu from the keys: F10 reaches it, the arrows go across and down and into a submenu, Enter runs, and the keys
// go back where they were
test('editor: the menu works from the keys, and gives them back', async () => {
  await open()
  await page.locator('.plot').focus()
  await page.keyboard.press('F10')
  assert.equal(await page.evaluate(() => document.activeElement.textContent), 'File')
  for (const key of ['ArrowRight', 'ArrowRight', 'ArrowRight', 'ArrowDown', 'ArrowDown', 'Enter']) await page.keyboard.press(key)
  // View, its second item: the spectrogram, in place of the waveform
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('audio-repl') || '{}').display === 'spec')
  assert.ok(await page.locator('.plot').evaluate(el => el === document.activeElement), 'the keys are back on the picture')
})

// A submenu and the pointer on its way to it (menu.js aims): crossing the rows under its own, heading into it, they let
// it pass, the submenu staying; resting on one, that one takes it; moved straight up or down, the next row takes it at once
test('editor: the pointer on its way to a submenu crosses the rows between, which take it only once it rests', async () => {
  await open()
  const lit = () => page.evaluate(() => document.activeElement.querySelector?.('.menu-label')?.textContent ?? '')
  const subs = () => page.locator('.menubar-sub:popover-open').count()
  const frame = () => page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))))
  await page.locator('.menubar-item', { hasText: /^View$/ }).click()
  const show = await menuRow('Show').boundingBox(), zoom = await menuRow('Zoom').boundingBox()
  await page.mouse.move(show.x + 30, show.y + show.height / 2)
  await page.locator('.menubar-sub:popover-open').waitFor()
  const sub = await page.locator('.menubar-sub:popover-open').boundingBox()
  assert.ok(sub.y + sub.height > zoom.y + zoom.height, 'the Show submenu reaches past Zoom, two rows down')
  // down and right over Snap and onto Zoom's far end, by the submenu's edge
  await page.mouse.move(zoom.x + zoom.width - 4, zoom.y + zoom.height / 2, { steps: 12 })
  await frame()
  assert.equal(await lit(), 'Show', 'the row crossed lets it pass')
  assert.equal(await subs(), 1, 'Show\'s submenu still open')
  // gone out of the menus from there and resting: nothing, the row it last crossed taking nothing
  await page.mouse.move(zoom.x + zoom.width - 4, zoom.y + zoom.height + 400)
  await page.waitForTimeout(500)
  assert.equal(await lit(), 'Show', 'out of the menus, nothing changes')
  assert.equal(await subs(), 1)
  await page.mouse.move(show.x + 30, show.y + show.height / 2)
  await page.mouse.move(zoom.x + zoom.width - 4, zoom.y + zoom.height / 2, { steps: 12 })
  // rested there: Zoom's, its own submenu opening a moment on
  await page.waitForFunction(() => document.activeElement.querySelector?.('.menu-label')?.textContent === 'Zoom')
  await page.locator('.menubar-sub:popover-open .menu-row', { hasText: /^In/ }).waitFor()
  // straight up a row: Snap's at once, Zoom's submenu gone
  await page.mouse.move(zoom.x + zoom.width - 4, zoom.y - zoom.height / 2, { steps: 4 })
  await frame()
  assert.equal(await lit(), 'Snap to cues and markers')
  assert.equal(await subs(), 0)
  await page.keyboard.press('Escape')
})


// The context menu's row by its words, a submenu's too
const contextRow = name => page.locator('.menubar-menu .menu-row', { has: page.locator('.menu-label', { hasText: new RegExp(`^${name}$`) }) }).last()

// A fade corner dragged outward is a crossfade: remove() with a crossfade as long splices it, centred on the seam
// (fn/remove.js), the audio before the cut fading out over the half before the seam and on past it, the audio after it
// fading in from the half before. Drawn as it will sound: the two equal-power curves crossing over the seam, from half
// its length before it to half after, not over the audio that goes
test('editor: a crossfade dragged out of a range\'s end draws both sides\' fades over each other, centred on the seam', async () => {
  await open()
  await noCues()
  await write(`audio.from(t => 0.5 * Math.sin(2 * Math.PI * 220 * t), { duration: 2 })`)
  await lengthIs('0:02.000')
  const { box, x } = await axis(2)
  await drag([x(.4), box.y + 80], [x(1) - x(.4), 0])
  // the corner at the range's end, at the lanes' top
  await page.mouse.move(x(1) - 8, box.y + 8)
  await page.mouse.down()
  await page.mouse.move(x(1.4) - 8, box.y + 8, { steps: 6 })
  await page.waitForTimeout(200)
  // the accent's columns, the curves
  const [a, b] = await pixels(`let lo = w, hi = -1; for (let y = 0; y < h - 30; y++) for (let x = 0; x < w - ${await gutter()}; x++) { const i = (y * w + x) * 4; if (d[i] > 120 && d[i] - d[i + 2] > 60) { lo = Math.min(lo, x); hi = Math.max(hi, x) } } return [lo, hi]`)
  assert.equal(await page.locator('.hint').innerText(), 'crossfade 0:00.400')
  await page.mouse.up()
  const at = t => x(t) - box.x
  assert.ok(Math.abs(a - at(.8)) <= 3 && Math.abs(b - at(1.2)) <= 3, `the curves from ${a} to ${b}, the seam ±0.2 s ${at(.8)} to ${at(1.2)}`)
  await page.waitForFunction(() => /\.crossfade\(\{ at: 1, d: 0\.4 \}\)$/.test(scriptText()))
})

// A selection's tools inside its foot, flush with it, side by side from its middle (view.js BOX, 16 px, 2 apart): pitch,
// intonation, formants; the pill on its top edge its level alone
const tools = (x, box, a, b) => Object.fromEntries(['pitch', 'intonation', 'formant'].map((name, i) => [name, [(x(a) + x(b)) / 2 + (i - 1) * 18, box.y + tall(box) - 8]]))

// The pitch tool: dragged up, by the square of how far, a few cents near where it was pressed, semitones further, 12 a
// picture's height away; the note it goes to said by it (a 220 Hz tone is A3, A4 being 440 Hz, ISO 16), the range heard
// as it will sound while it moves, from the first move on (the library's pitch(), a voice's), one pitch() step let go
test('editor: the pitch tool goes by cents near, semitones far, says the note it goes to and is heard as it goes', async () => {
  await page.addInitScript(tap)
  await open()
  await noCues()
  await write(`audio.from(t => 0.5 * Math.sin(2 * Math.PI * 220 * t), { duration: 2 })`)
  await lengthIs('0:02.000')
  await menu('View', 'Show', 'Pitch curve')
  await show('wave')
  // the waveform's tools inside its lane's foot; selected off its centre line, where the pitch line is
  const { box, x } = await axis(2), pitch = [tools(x, box, .5, 1.5).pitch[0], box.y + tall(box) - 8]
  await drag([x(.5), box.y + tall(box) * .3], [x(1.5) - x(.5), 0])
  const said = () => page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))).then(() => page.locator('.hint').innerText())
  for (const until = Date.now() + 8000; Date.now() < until; await page.waitForTimeout(200)) { await page.mouse.move(...pitch); if (/^Pitch A3/.test(await said())) break; await page.mouse.move(pitch[0] + 30, pitch[1] - 40) }
  assert.match(await said(), /^Pitch A3([+−][1-5]ct)?, by cents; a click hides the curve$/)
  // 12 semitones a lane's height away (view.js glide): st = 12 (dy / lh)²; the tool at the lane's foot, all of it over it
  const lh = tall(box), at = st => pitch[1] - lh * Math.sqrt(st / 12)
  await heard()
  await page.mouse.down()
  // pressed and moved a little: at 0, heard as it is
  await page.mouse.move(pitch[0], pitch[1] - 4)
  await page.waitForTimeout(500)
  assert.ok((await heard()).peak > .05, 'at 0 semitones, heard as it is')
  // a fifth of a semitone: cents alone
  await page.mouse.move(pitch[0], at(.2), { steps: 6 })
  await page.waitForTimeout(500)
  assert.match(await said(), /^\+(1\d|2\d)ct, A3([+−][1-5]ct)? → A3\+\d+ct$/)
  const { peak } = await heard()
  assert.ok(peak > .05, `heard as it goes: ${peak}`)
  // two and a half semitones, then most of the lane's height: ten and more
  // the words where it was pressed, the pointer hidden: only what they say changes
  const place = () => page.locator('.hint').evaluate(e => { const r = e.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.top)] })
  const was = await place()
  await page.mouse.move(pitch[0], at(2.5), { steps: 6 })
  assert.match(await said(), /^\+2st [3-6]\dct, A3/)
  await page.mouse.move(pitch[0], pitch[1] - lh * .95, { steps: 6 })
  assert.match(await said(), /^\+10st [6-9]\dct, /)
  assert.deepEqual(await place(), was, 'the words stay where it was pressed')
  await page.mouse.up()
  await page.waitForFunction(() => /\.pitch\(10\.\d\d?, \{ at: 0\.5, d: 1, voice: true \}\)$/.test(scriptText()))
})

// The tools beside it: a voice's intonation, its rises and falls wider up and flatter down (half a lane twice as wide,
// or a monotone), by 0.05; its formants, as the pitch tool its pitch. Each heard as it goes, from the first
// move, and one step over the selection; the same again over it sets the same step again
test('editor: the tools set a voice\'s intonation and its formants, heard as they go, a step each', async () => {
  await page.addInitScript(tap)
  await open()
  await noCues()
  // a voice whose pitch rises and falls, ±2 semitones about 200 Hz twice a second
  await write(`audio.from(t => 0.5 * Math.sin(2 * Math.PI * (200 * t + 2 * Math.sin(2 * Math.PI * 2 * t))), { duration: 2 })`)
  await lengthIs('0:02.000')
  await menu('View', 'Show', 'Pitch curve')
  const { box, x } = await axis(2), lh = tall(box), { intonation, formant } = tools(x, box, .5, 1.5), said = () => page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))).then(() => page.locator('.hint').innerText())
  await drag([x(.5), box.y + 80], [x(1.5) - x(.5), 0])
  await page.mouse.move(...intonation)
  assert.equal(await said(), 'Intonation, wider or flatter')
  await heard()
  await page.mouse.down()
  await page.mouse.move(intonation[0], intonation[1] - 4)
  await page.waitForTimeout(500)
  assert.ok((await heard()).peak > .05, 'at ×1, heard as it is')
  // down a quarter of the lane: half as wide
  await page.mouse.move(intonation[0], intonation[1] + lh / 4, { steps: 6 })
  await page.waitForTimeout(500)
  assert.match(await said(), /^×0\.50, [\d.]+st → [\d.]+st wide$/)
  assert.ok((await heard()).peak > .05, 'heard as it goes')
  await page.mouse.up()
  await page.waitForFunction(() => /\.intonation\(0\.5, \{ at: 0\.5, d: 1 \}\)$/.test(scriptText()))
  // and again: the same step, its factor times the one more
  await drag(await grab([intonation], 'ns-resize'), [0, lh / 4])
  await page.waitForFunction(() => /\.intonation\(0\.25, \{ at: 0\.5, d: 1 \}\)$/.test(scriptText()))
  assert.equal((await code()).match(/\.intonation\(/g).length, 1)
  // formants: up half the plot's height, 3 semitones, as the pitch tool goes (12 (dy / lh)²)
  await page.mouse.move(...await grab([formant], 'ns-resize'))
  assert.equal(await said(), 'Formants, by cents')
  await page.mouse.down()
  await page.mouse.move(formant[0], formant[1] - lh / 2, { steps: 6 })
  await page.waitForTimeout(500)
  assert.match(await said(), /^formants \+(2st 9\dct|3st( [1-9]ct)?)$/)
  assert.ok((await heard()).peak > .05, 'heard as it goes')
  await page.mouse.up()
  await page.waitForFunction(() => /\.formant\((2\.9\d?|3(\.0\d?)?), \{ at: 0\.5, d: 1 \}\)$/.test(scriptText()))
})

// How a band shows, its look in its layer pressed: a dropdown by it, as Figma's: what it shows (the waveform, the
// spectrogram, the notes), then how that draws, every group in sight, what the chosen one does said under it (the
// waveform's units, weighting, colour, colormap, fill, channels and its level meter; the spectrogram's scale, method, colours, gamma, range,
// FFT size and its spectrum; the notes' piano keys). The View menu has no meters. Turned there, the band and the groups turn at once, the dropdown open; the look again, a press outside or
// Esc closes it; what it shows and its looks are kept
test('editor: a band\'s look in its layer opens how it shows: what it shows, then how that draws', async () => {
  await open()
  const look = page.locator(':is(.lane-look, .layer-look):visible'), dropdown = page.locator('.dropdown'), groups = () => dropdown.locator('.option-label').allInnerTexts()
  const opened = () => page.locator('.dropdown:popover-open').count()
  assert.equal(await look.count(), 1, 'a sound\'s one, its channels\' lanes alike')
  assert.equal(await shown(), 'Waveform')
  assert.match(await look.evaluate(tipOf), /^Waveform\nClick for how it shows$/)
  await look.click()
  assert.equal(await look.getAttribute('aria-expanded'), 'true')
  const [b, d] = await Promise.all([look.boundingBox(), dropdown.boundingBox()])
  assert.ok(Math.abs(d.x + d.width - b.x - b.width) <= 1 && (d.y >= b.y + b.height || d.y + d.height <= b.y), 'by it, its right edge at its look\'s, under the axis')
  assert.deepEqual(await groups(), ['Shows', 'Levels in', 'Weighting', 'Colour', 'Colormap', 'Fill', 'Channels', 'Meter'], 'what it shows, then the waveform\'s: its units, its weighting, its colour, its colormap, its fill, its channels, its meter')
  // its meter its own: the level bar by the lanes' end, let go there, the waveform then running on to the labels
  const end = () => page.locator('.plot').evaluate(p => parseFloat(getComputedStyle(p).getPropertyValue('--end')))
  assert.equal(await choice('Meter', 'Level').getAttribute('aria-pressed'), 'true')
  const metered = await end()
  await choice('Meter', 'Level').click()
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('audio-repl') || '{}').show?.meters === false)
  const ends = (m, less) => page.waitForFunction(([m, less]) => (e => less ? e < m : e === m)(parseFloat(getComputedStyle(document.querySelector('.plot')).getPropertyValue('--end'))), [m, less], { timeout: 2000 })
  await ends(metered, true)
  await choice('Meter', 'Level').click()
  await ends(metered)
  assert.deepEqual(await dropdown.getByRole('group', { name: 'Shows', exact: true }).getByRole('button').allInnerTexts(), ['Waveform', 'Spectrogram', 'Notes'])
  assert.deepEqual(await dropdown.getByRole('group', { name: 'Fill', exact: true }).getByRole('button').allInnerTexts(), ['Density', 'Cloud', 'Body', 'RMS', 'Flat'], 'gl-waveform\'s three densities, its RMS band, its peaks')
  // what a choice does in its tooltip, no line under the group; a colour with its preview
  assert.match(await choice('Fill', 'Cloud').getAttribute('title'), /^A soft cloud/)
  assert.equal(await dropdown.locator('.option-note').count(), 0)
  // the colour a select, as Figma's: the one chosen named on it, its list each with its preview
  assert.equal(await dropdown.getByRole('button', { name: 'Colour: One colour' }).count(), 1)
  await dropdown.getByRole('button', { name: 'Colour: One colour' }).click()
  const colours = page.getByRole('listbox', { name: 'Colour', exact: true })
  assert.deepEqual(await colours.getByRole('option').allInnerTexts(), ['One colour', 'RGB', 'Three bands', 'Centroid', 'Dominant'], 'one, then as DJ software and DAWs colour it')
  assert.equal(await colours.locator('.swatch').count(), 5, 'each its preview')
  await colours.getByRole('option', { name: 'Centroid' }).click()
  assert.equal(await colours.isVisible(), false, 'picked, the list closes')
  assert.equal(await opened(), 1, 'the dropdown stays')
  assert.equal(await dropdown.getByRole('button', { name: 'Colour: Centroid' }).count(), 1)
  // its colormap the spectrogram's list, temperature its own first; its weighting none, K or A
  assert.equal(await dropdown.getByRole('button', { name: 'Colormap: Temperature' }).count(), 1)
  assert.deepEqual(await page.getByRole('listbox', { name: 'Colormap', exact: true, includeHidden: true }).getByRole('option', { includeHidden: true }).allTextContents(), ['Grey', 'Magma', 'Inferno', 'Viridis', 'Temperature'])
  assert.deepEqual(await dropdown.getByRole('group', { name: 'Weighting', exact: true }).getByRole('button').allInnerTexts(), ['None', 'K-weighted', 'A-weighted'])
  await choice('Fill', 'RMS').click()
  await choice('Shows', 'Spectrogram').click()
  assert.equal(await shown(), 'Spectrogram')
  assert.equal(await opened(), 1, 'turned, the dropdown stays')
  assert.deepEqual(await groups(), ['Shows', 'Frequency scale', 'Method', 'Colours', 'Gamma', 'Range', 'FFT size', 'Meter'], 'the spectrogram\'s')
  assert.deepEqual(await dropdown.getByRole('group', { name: 'Meter', exact: true }).getByRole('button').allInnerTexts(), ['Spectrum'])
  assert.deepEqual(await dropdown.getByRole('group', { name: 'Frequency scale', exact: true }).getByRole('button').allInnerTexts(), ['Hertz', 'Mel', 'ERB', 'Octaves'], 'plainest first')
  assert.deepEqual(await dropdown.getByRole('group', { name: 'Method', exact: true }).getByRole('button').allInnerTexts(), ['Frames', 'Reassigned', 'By band'])
  assert.deepEqual(await page.getByRole('listbox', { name: 'Colours', exact: true, includeHidden: true }).getByRole('option', { includeHidden: true }).allTextContents(), ['Grey', 'Magma', 'Inferno', 'Viridis', 'Temperature'], 'each colormap in a select, its preview, the waveform\'s list')
  // gamma, one quantity: a slider through its steps; moved, the look follows
  const gamma = dropdown.getByRole('slider', { name: 'Gamma' })
  assert.deepEqual(await dropdown.locator('.option-ticks span').allInnerTexts(), ['0.5', '0.75', '1', '1.5'])
  await gamma.fill('0')
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('audio-repl') || '{}').look?.gamma === .5)
  // the notes: what it shows, then their meter, a piano's keys by the lanes' end, let go there as the level is
  await choice('Shows', 'Notes').click()
  assert.deepEqual(await groups(), ['Shows', 'Meter'], 'the notes\'')
  assert.deepEqual(await dropdown.getByRole('group', { name: 'Meter', exact: true }).getByRole('button').allInnerTexts(), ['Keys'])
  // (measured once the notes' lanes are drawn, their keys' column with them)
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))))
  const keyed = await end()
  await choice('Meter', 'Keys').click()
  await ends(keyed, true)
  await choice('Meter', 'Keys').click()
  await ends(keyed)
  await choice('Shows', 'Spectrogram').click()
  await look.click()
  assert.equal(await opened(), 0, 'its look again closes it')
  assert.equal(await look.getAttribute('aria-expanded'), 'false')
  assert.equal(await page.locator('.plot').getAttribute('data-scale'), 'log', 'the scale as it was')
  await page.waitForFunction(() => (s => s.display === 'spec' && s.wave?.fill === 'rms')(JSON.parse(localStorage.getItem('audio-repl') || '{}')))
  await page.reload()
  await wholeLevels().waitFor()
  assert.equal(await shown(), 'Spectrogram', 'kept')
  await look.click()
  await page.mouse.click(10, 10)
  assert.equal(await opened(), 0, 'a press outside closes it')
  await look.click()
  await page.keyboard.press('Escape')
  assert.equal(await opened(), 0, 'Esc closes it')
})

// The settings, the panels' last: a section each, as the export's forms, open at first, a press folding one, kept so:
// its groups, their choices, what the chosen one does said under them. How a held caret sounds is one of the lab's
// eight ways (scrub-methods.js), kept. How the pictures draw is theirs, in their dropdown, none of it here
test('editor: the settings are a panel of sections, what holds everywhere, the pictures\' looks not among them', async () => {
  await open()
  const groups = () => page.locator('.settings .option-label:visible').allInnerTexts()
  const sections = () => page.locator('.settings .panel-name').allInnerTexts(), fold = name => page.locator('.settings summary', { hasText: name }).click()
  await tab('Settings')
  assert.equal(await page.locator('.side-slab').getAttribute('aria-label'), 'Settings')
  assert.deepEqual(await sections(), ['View', 'Editing', 'Scrub and record'])
  assert.deepEqual(await groups(), ['Show over the sound', 'Times in', 'Time row', 'Scroll', 'Grid', 'Level steps', 'Splices', 'Scrub', 'Record in'], 'all open at first')
  const ways = page.locator('.settings').getByRole('group', { name: 'Scrub', exact: true }).getByRole('button')
  assert.deepEqual(await ways.allInnerTexts(), ['Vocoder + noise', 'Vocoder', 'Random phase', 'Noisc bank', 'Noisc lines', 'Grains', 'Loop', 'Tape'])
  assert.match(await choice('Scrub', 'Vocoder + noise').getAttribute('title'), /^Tones keep their phase/, 'what each does, in its tooltip')
  await choice('Scrub', 'Tape').click()
  assert.equal(await choice('Scrub', 'Tape').getAttribute('aria-pressed'), 'true')
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('audio-repl') || '{}').scrub === 'tape')
  // folded, kept so
  for (const name of ['View', 'Scrub and record']) await fold(name)
  assert.deepEqual(await groups(), ['Level steps', 'Splices'])
  await page.waitForTimeout(600)
  await page.reload()
  await wholeLevels().waitFor()
  await tab('Settings')
  assert.deepEqual(await groups(), ['Level steps', 'Splices'], 'what was folded, kept')
  assert.equal(await page.locator('.settings').getByRole('group', { name: 'Frequency scale', exact: true }).count(), 0, 'no picture\'s look')
})

// How the spectrogram draws its frames (gl-spectrogram's methods): each a picture of its own, kept for the next visit;
// ERB among the scales, each of the four taken in turn
test('editor: the spectrogram\'s method draws a picture of its own, kept; each of its four scales', async () => {
  await open()
  await show('spec')
  const plot = page.locator('.plot'), print = () => pixels(`let s = 0; for (let i = 0; i < d.length; i += 4 * 97) s = (s * 31 + d[i]) % 1000000007; return s`)
  await page.waitForTimeout(500)
  const pictures = new Set([await print()])
  for (const method of ['Frames', 'By band']) {
    await settings('Method', method)
    await page.waitForTimeout(500)
    pictures.add(await print())
  }
  assert.equal(pictures.size, 3, 'three methods, three pictures')
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('audio-repl')).look.method), 'bands')
  await page.reload()
  await wholeLevels().waitFor()
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('audio-repl')).look.method), 'bands')
  const scales = []
  for (const name of ['Hertz', 'Mel', 'ERB', 'Octaves']) { await settings('Frequency scale', name); scales.push(await plot.getAttribute('data-scale')) }
  assert.deepEqual(scales, ['lin', 'mel', 'erb', 'log'])
})

// A number selected in the code: ↑ and ↓ step it by its last decimal's step, ten with Shift, still selected; what it
// sets said by it (normalize's target, in dB, its slider from −36 to 0 dB, ops.js)
test('editor: a number selected in the code steps with the arrows, saying what it sets', async () => {
  await open()
  await tab('Code')
  await page.locator('.cm-line', { hasText: '.normalize(' }).locator('span', { hasText: /^1$/ }).dblclick()
  await page.keyboard.press('ArrowUp')
  await page.waitForFunction(() => scriptText().includes('.normalize(0)'))
  await page.keyboard.press('Shift+ArrowUp')
  await page.waitForFunction(() => scriptText().includes('.normalize(10)'))
  await page.keyboard.press('ArrowDown')
  await page.waitForFunction(() => scriptText().includes('.normalize(9)'))
  await page.locator('.hint', { hasText: /^normalize target 9dB, −36dB to 0dB$/ }).waitFor()
  // a decimal, all of it selected by a double-click, by its last place; pointed at, a number says what it sets
  await page.locator('.cm-line', { hasText: '.fade(' }).locator('span', { hasText: /^0\.02$/ }).dblclick()
  await page.keyboard.press('ArrowUp')
  await page.waitForFunction(() => scriptText().includes('.fade(0.03, 0.1)'))
  await page.locator('.cm-content').click({ position: { x: 4, y: 4 } })
  await page.locator('.cm-line', { hasText: '.fade(' }).locator('span', { hasText: /^0\.1$/ }).hover()
  await page.locator('.hint', { hasText: /^fade out 0\.1s, 0s to 5s$/ }).waitFor()
})

// How the waveform draws, from its dropdown (and the View menu): coloured by where its spectrum centres as a colour
// temperature, 100 Hz at 1,800 K (a warm orange: more red than blue, on the black-body locus, Krystek 1985), its
// channels in one lane
test('editor: the waveform\'s look, from its dropdown: coloured by its spectrum\'s warmth, its channels in one lane', async () => {
  await open()
  await write(`audio.from(t => 0.8 * Math.sin(2 * Math.PI * 100 * t), { duration: 1, channels: 2 }).pan(-1)`)
  await lengthIs('0:01.000')
  await page.waitForTimeout(500)
  // lit pixels in the upper and lower half of the lanes, TRACK px all told, and how red they are
  const lanes = tall(await page.locator('.plot').boundingBox())
  const lit = () => pixels(`const out = [0, 0], tint = [0, 0]; for (let y = 0; y < arg; y++) for (let x = 0; x < w - 60; x++) { const i = (y * w + x) * 4; if (d[i] + d[i + 1] + d[i + 2] > 300) { const k = y < arg / 2 ? 0 : 1; out[k]++; tint[k] += d[i] - d[i + 2] } } return [...out, (tint[0] + tint[1]) / (out[0] + out[1] || 1)]`, lanes)
  const [upper, lower, grey] = await lit()
  assert.ok(lower < upper / 10 && Math.abs(grey) < 10, `split, grey: ${[upper, lower, grey]}`)
  // the waveform's dropdown
  await settings('Channels', 'One lane')
  await settings('Colour', 'Centroid')
  await page.waitForTimeout(500)
  const [top, bottom, red] = await lit()
  assert.ok(bottom > top / 2 && red > 40, `one lane, red: ${[top, bottom, red]}`)
  await page.waitForFunction(() => (w => w?.colour === 'centroid' && w.map === 'temperature')(JSON.parse(localStorage.getItem('audio-repl') || '{}').wave))
})

// Coloured in a colormap, flat, the spectrogram's list: where the spectrum centres, 100 Hz up to 10 kHz in octaves,
// along the colormap's upper half, so 100 Hz takes magma's middle, #b5367a, a pink, and 10 kHz its top, #fcfdbf, a pale
// yellow (matplotlib _cm_listed.py, entries 128 and 255)
test('editor: the waveform coloured in a colormap of the spectrogram\'s list, low at its middle, high at its top', async () => {
  await page.addInitScript(() => { if (!sessionStorage.seeded) { sessionStorage.seeded = 1; localStorage.setItem('audio-repl', JSON.stringify({ wave: { colour: 'centroid', map: 'magma', fill: 'flat' }, docs: [{ code: 'audio.from(t => 0.8 * Math.sin(2 * Math.PI * (t < 1 ? 100 : 10000) * t), { duration: 2 })' }] })) } })
  await open()
  await lengthIs('0:02.000')
  await page.waitForTimeout(500)
  // the lit pixels' mean colour about the zero line, mid its lane (TRACK px), a third of the way in and two thirds
  // (100 Hz's cycles stand apart)
  const lane = tall(await page.locator('.plot').boundingBox())
  const at = x => pixels(`const y = Math.round(arg.lane / 2), s = [0, 0, 0]; let n = 0; for (let dx = -20; dx < 20; dx++) for (let dy = -3; dy <= 3; dy++) { const i = ((y + dy) * w + Math.round(w * arg.x) + dx) * 4; if (d[i] + d[i + 1] + d[i + 2] < 250) continue; s[0] += d[i]; s[1] += d[i + 1]; s[2] += d[i + 2]; n++ } return s.map(v => Math.round(v / n))`, { x, lane })
  const [low, high] = [await at(1 / 3), await at(2 / 3)]
  assert.ok(low[0] - low[1] > 80 && low[2] > low[1], `100 Hz pink, red over green, blue over green: ${low}`)
  assert.ok(high[1] > 200 && Math.abs(high[0] - high[1]) < 30 && high[2] < high[1], `10 kHz pale yellow: ${high}`)
  // its own colormap changed, the spectrogram's as it was: viridis, its middle #21908d, a teal, its top #fde725, a
  // yellow (entries 128 and 255)
  await settings('Colormap', 'Viridis')
  await page.waitForTimeout(500)
  const [teal, yellow] = [await at(1 / 3), await at(2 / 3)]
  assert.ok(teal[1] - teal[0] > 60 && teal[2] - teal[0] > 60, `100 Hz teal: ${teal}`)
  assert.ok(yellow[0] > 200 && yellow[1] > 180 && yellow[2] < 100, `10 kHz yellow: ${yellow}`)
  assert.deepEqual(await page.evaluate(() => (s => [s.wave.map, s.look?.map ?? 'grey'])(JSON.parse(localStorage.getItem('audio-repl')))), ['viridis', 'grey'])
})

// The colour modes, as DJ software and DAWs colour a waveform, on a 100 Hz sine, then a 10 kHz one, each 0.8, flat
// (tint.js coloured): RGB, the lows red and the highs blue (Serato's, Mixxx's: 600 Hz and 4 kHz its bands); three
// bands, each band a waveform of its own, the 100 Hz one in the colormap's low (magma's middle, #b5367a), the 10 kHz
// one in its top (#fcfdbf); dominant, a tone in full colour, white noise greyed (REAPER's: its tonality its saturation)
test('editor: the waveform coloured by its bands, in layers, or by its strongest frequency greyed as it is noisy', async () => {
  await page.addInitScript(() => { if (!sessionStorage.seeded) { sessionStorage.seeded = 1; localStorage.setItem('audio-repl', JSON.stringify({ wave: { colour: 'bands', map: 'magma', fill: 'flat' }, docs: [{ code: 'audio.from(t => 0.8 * Math.sin(2 * Math.PI * (t < 1 ? 100 : 10000) * t), { duration: 2 })' }] })) } })
  await open()
  await lengthIs('0:02.000')
  await page.waitForTimeout(500)
  const lane = tall(await page.locator('.plot').boundingBox())
  const at = x => pixels(`const y = Math.round(arg.lane / 2), s = [0, 0, 0]; let n = 0; for (let dx = -20; dx < 20; dx++) for (let dy = -3; dy <= 3; dy++) { const i = ((y + dy) * w + Math.round(w * arg.x) + dx) * 4; if (d[i] + d[i + 1] + d[i + 2] < 250) continue; s[0] += d[i]; s[1] += d[i + 1]; s[2] += d[i + 2]; n++ } return s.map(v => Math.round(v / n))`, { x, lane })
  const [red, blue] = [await at(1 / 3), await at(2 / 3)]
  assert.ok(red[0] - red[2] > 60 && red[0] - red[1] > 60, `100 Hz red: ${red}`)
  assert.ok(blue[2] - blue[0] > 60 && blue[2] > blue[1], `10 kHz blue: ${blue}`)
  await settings('Colour', 'Three bands')
  await page.waitForTimeout(500)
  const [pink, pale] = [await at(1 / 3), await at(2 / 3)]
  assert.ok(pink[0] - pink[1] > 80 && pink[2] > pink[1], `100 Hz in the lows' layer, pink: ${pink}`)
  assert.ok(pale[1] > 200 && Math.abs(pale[0] - pale[1]) < 30 && pale[2] < pale[1], `10 kHz in the highs' layer, pale yellow: ${pale}`)
  // a tone, then noise: the strongest frequency in colour, the noise grey
  await write('audio.from(t => t < 1 ? 0.8 * Math.sin(2 * Math.PI * 300 * t) : 0.5 * (Math.random() * 2 - 1), { duration: 2 })')
  await settings('Colour', 'Dominant')
  await page.waitForTimeout(800)
  const chroma = ([r, g, b]) => Math.max(r, g, b) - Math.min(r, g, b)
  const [tone, noise] = [await at(1 / 3), await at(2 / 3)]
  assert.ok(chroma(tone) > 80 && chroma(noise) < chroma(tone) / 3, `the tone in colour, the noise grey: ${tone}, ${noise}`)
})

// A track's waveform coloured as a sound's is, by its colour mode, not a hue of its own: two tracks, a 100 Hz tone over
// a 10 kHz one, RGB, each lane's middle red and blue (it was each track's own colour, the mode left out for tracks)
test('editor: tracks\' waveforms coloured by the colour mode, as a sound\'s', async () => {
  await page.addInitScript(() => { if (!sessionStorage.seeded) { sessionStorage.seeded = 1; localStorage.setItem('audio-repl', JSON.stringify({ wave: { colour: 'bands', map: 'magma', fill: 'flat' }, docs: [{ code: 'let low = audio.from(t => 0.8 * Math.sin(2 * Math.PI * 100 * t), { duration: 2 })\n\nlet high = audio.from(t => 0.8 * Math.sin(2 * Math.PI * 10000 * t), { duration: 2 })' }] })) } })
  await open()
  await lengthIs('0:02.000')
  await page.locator('.layer').nth(1).waitFor({ state: 'attached' })
  await page.waitForTimeout(500)
  const box = await page.locator('.plot').boundingBox(), lanes = await tracksAt()
  const at = r => pixels(`const y = Math.round(arg.y), s = [0, 0, 0]; let n = 0; for (let dx = -20; dx < 20; dx++) for (let dy = -3; dy <= 3; dy++) { const i = ((y + dy) * w + Math.round(w / 2) + dx) * 4; if (d[i] + d[i + 1] + d[i + 2] < 250) continue; s[0] += d[i]; s[1] += d[i + 1]; s[2] += d[i + 2]; n++ } return s.map(v => Math.round(v / n))`, { y: r.y + r.h / 2 - box.y })
  const [red, blue] = [await at(lanes[0]), await at(lanes[1])]
  assert.ok(red[0] - red[2] > 60 && red[0] - red[1] > 60, `the 100 Hz track red: ${red}`)
  assert.ok(blue[2] - blue[0] > 60 && blue[2] > blue[1], `the 10 kHz track blue: ${blue}`)
})

// Where the view stops short of the sound, its lanes fade out at that edge: zoomed in at its start, at the lanes' end;
// scrolled on, at their start too; all of it shown, at neither
test('editor: the lanes fade out at an edge the sound runs on past', async () => {
  const { box, x } = await chime()
  const fades = () => page.evaluate(() => [...document.querySelectorAll('.plot .fade')].map(f => !f.hidden))
  assert.deepEqual(await fades(), [false, false], 'all of it shown')
  await page.mouse.move(x(.5), box.y + 40)
  for (let i = 0; i < 4; i++) { await page.keyboard.down('Control'); await page.mouse.wheel(0, -120); await page.keyboard.up('Control') }
  await page.waitForFunction(() => (([a, b]) => !a.hidden || !b.hidden)(document.querySelectorAll('.plot .fade')))
  const [, end] = await fades()
  assert.ok(end, 'the sound on past the lanes\' end')
  await page.mouse.wheel(box.width, 0)
  await page.waitForFunction(() => !document.querySelector('.plot .fade-start').hidden)
  await page.locator('.plot').focus()
  await page.keyboard.press('0')
  await page.waitForFunction(() => [...document.querySelectorAll('.plot .fade')].every(f => f.hidden))
})

// Weighted, the waveform zoomed out is its levels as heard, zoomed in its samples as they are (view.js weigh): a 100 Hz
// sine, then a 1 kHz one, 0.8 each, at 44.1 kHz, flat, 12 s across the view, so zoomed out past a leaf a px. A-weighted, the 100 Hz
// one as tall as 0.8 at −19.1 dB, the 1 kHz one at 0 dB (IEC 61672-1:2013, Table 3), its heights against the weighting
// package's own response (@audio/weighting-a, the filter the worker runs); K-weighted, 100 Hz at the package's −1.1 dB
// (@audio/weighting-k, ITU-R BS.1770-4's two stages). Zoomed in on the 100 Hz one, the sine itself, 0.8
test('editor: the waveform weighted zoomed out, as heard, and as it is zoomed in', async () => {
  const { default: a } = await import('@audio/weighting/a'), { default: k } = await import('@audio/weighting/k')
  const dB = v => 20 * Math.log10(v)
  // the package's response against IEC 61672-1's table, to its tenth of a dB
  assert.ok(Math.abs(dB(a.response(100, 44100)) + 19.1) < .1 && Math.abs(dB(a.response(1000, 44100))) < .05, 'A as IEC 61672-1 has it at 100 Hz and 1 kHz')
  await page.addInitScript(() => { if (!sessionStorage.seeded) { sessionStorage.seeded = 1; localStorage.setItem('audio-repl', JSON.stringify({ wave: { fill: 'flat' }, docs: [{ code: 'audio.from(t => 0.8 * Math.sin(2 * Math.PI * (t < 6 ? 100 : 1000) * t), { duration: 12 })' }] })) } })
  await open()
  await lengthIs('0:12.000')
  await page.waitForTimeout(500)
  const box = await page.locator('.plot').boundingBox(), lane = tall(box)
  // the rows lit across most of 40 px about a share `x` of the way in: the waveform's height there, px
  const high = x => pixels(`let n = 0; for (let y = 0; y < arg.lane; y++) { let m = 0; for (let dx = -20; dx < 20; dx++) { const i = (y * w + Math.round(w * arg.x) + dx) * 4; if (d[i] + d[i + 1] + d[i + 2] > 250) m++ } if (m > 30) n++ } return n`, { x, lane })
  const heights = async () => [await high(.25), await high(.7)]
  const [low, mid] = await heights()
  assert.ok(Math.abs(low / lane - .8) < .06 && Math.abs(mid / lane - .8) < .06, `as it is, 0.8 of the lane: ${low}, ${mid} of ${lane}`)
  // the worker weighs it: the heights as it comes
  const weighed = async (name, want) => {
    await settings('Weighting', name)
    let got
    for (let i = 0; i < 40; i++) { got = await heights(); if (Math.abs(got[0] / low - want[0]) < .2 * want[0]) break; await page.waitForTimeout(250) }
    return got
  }
  const A = [a.response(100, 44100), a.response(1000, 44100)], [aLow, aMid] = await weighed('A-weighted', A)
  // within 2 px of the weighted height, a px each side of the band rounding
  assert.ok(Math.abs(aLow - low * A[0]) <= 2.5 && Math.abs(aMid - mid * A[1]) <= 2.5, `A: 100 Hz ${aLow} px for ${(low * A[0]).toFixed(1)}, 1 kHz ${aMid} for ${(mid * A[1]).toFixed(1)}`)
  const K = [k.response(100, 44100), k.response(1000, 44100)], [kLow] = await weighed('K-weighted', K)
  assert.ok(Math.abs(kLow - low * K[0]) <= 2.5, `K: 100 Hz ${kLow} px for ${(low * K[0]).toFixed(1)}`)
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('audio-repl') || '{}').wave?.weighting === 'k')
  // zoomed in 16× on the 100 Hz sine, under 64 samples a px: the sine as it is
  const [px, py] = [box.x + box.width * .25, box.y + lane / 2]
  await page.evaluate(([x, y]) => document.querySelector('.plot').dispatchEvent(new WheelEvent('wheel', { deltaY: 50 * Math.log(1 / 16), ctrlKey: true, clientX: x, clientY: y, bubbles: true, cancelable: true })), [px, py])
  await page.waitForTimeout(800)
  // the rows the line lights across the middle of the view (its cycles' crests, a few px each, many), top to bottom
  const span = await pixels(`let top = -1, bottom = -1; for (let y = 0; y < arg.lane; y++) { let m = 0; for (let x = Math.round(w * .1); x < w * .8; x++) { const i = (y * w + x) * 4; if (d[i] + d[i + 1] + d[i + 2] > 250) m++ } if (m > 20) { if (top < 0) top = y; bottom = y } } return bottom - top + 1`, { lane })
  assert.ok(Math.abs(span / lane - .8) < .06, `zoomed in, the sine at 0.8: ${span} of ${lane}`)
})

// VS Code's colour themes (theme.js), read from its own files (playground/themes, as microsoft/vscode ships them): each
// part of the editor in the colour of the part of VS Code it stands for (theme.js MAP), as the theme writes it, or VS
// Code's default for its kind where it does not (registerColor, VS Code 1.143: src/vs/platform/theme/common/colors/*.ts,
// src/vs/workbench/common/theme.ts). Dark+ (dark_plus.json over dark_vs.json): the background #1E1E1E, the text
// #D4D4D4, numbers #b5cea8, headings #569cd6, the inactive selection #3A3D41, a menu #252526 and its row #0078d4, an
// inactive tab's words #A6A6A6; defaults for dark: line numbers #858585, a group's border #444444, an input #3C3C3C, the
// selection #264F78, the focus #007FD4, a menu row's words #FFFFFF (list.activeSelectionForeground), the active tab the
// editor's background, its words #FFFFFF, the tabs' row and the sidebar #252526, a range #ffffff0b, the title bar
// #3C3C3C. Light+ (light_plus.json over light_vs.json): #FFFFFF, #000000, #098658, #800000, the inactive selection
// #E5EBF1, a list's row pointed at #E8E8E8, an inactive tab's words #616161; defaults for light: #237893, #E7E7E7,
// #FFFFFF, #ADD6FF, #0090F1, a menu #FFFFFF (dropdown.background) and its row #0060C0 (list.activeSelectionBackground),
// the active tab's words #333333, the tabs' row and the sidebar #F3F3F3, a range #fdff0033, the title bar #DDDDDD.
// Monokai (monokai-color-theme.json): #272822, #f8f8f2, a group's border #34352f, an input #414339, the focus #99947c,
// headings #A6E22E, the selection #878b9180, no inactive one, so the selection at half (#878b9140), a menu #1e1f1c and
// its row the list's selection #75715E, the tabs' row, the sidebar and the title bar #1e1f1c
const themed = async name => {
  const { THEMES, load, skin } = await import('../playground/theme.js'), t = THEMES.find(t => t.name === name)
  return skin(await load(new URL(`../playground/themes/${t.file}`, import.meta.url).href, { kind: t.kind, get: u => readFile(new URL(u), 'utf8') }))
}
test('theme: a VS Code theme read into the skin, each part the colour of the part of VS Code it stands for', async () => {
  const rgb = hex => `rgb(${[1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)).join(' ')}${hex.length > 7 ? ` / ${Math.round(parseInt(hex.slice(7), 16) / 255 * 1e3) / 1e3}` : ''})`
  for (const [name, want] of [
    ['Dark+', { screen: '#1E1E1E', 'screen-ink': '#D4D4D4', 'screen-accent': '#007FD4', 'screen-mark': '#569cd6', 'screen-line-number': '#858585', 'screen-number': '#b5cea8', bezel: '#444444', 'screen-well': '#3C3C3C', 'screen-select': '#264F78', 'screen-select-inactive': '#3A3D41',
      menu: '#252526', 'menu-select': '#0078d4', 'menu-select-ink': '#FFFFFF', tab: '#1E1E1E', 'tab-ink': '#FFFFFF', 'tab-off-ink': '#A6A6A6', tabs: '#252526', side: '#252526', 'screen-range': '#ffffff0b', paper: '#3C3C3C' }],
    ['Light+', { screen: '#FFFFFF', 'screen-ink': '#000000', 'screen-accent': '#0090F1', 'screen-mark': '#800000', 'screen-line-number': '#237893', 'screen-number': '#098658', bezel: '#E7E7E7', 'screen-well': '#FFFFFF', 'screen-select': '#ADD6FF', 'screen-select-inactive': '#E5EBF1',
      menu: '#FFFFFF', 'menu-select': '#0060C0', 'tab-ink': '#333333', 'tab-off-ink': '#616161', tabs: '#F3F3F3', side: '#F3F3F3', 'screen-hover': '#E8E8E8', 'screen-range': '#fdff0033', paper: '#DDDDDD' }],
    ['Monokai', { screen: '#272822', 'screen-ink': '#f8f8f2', 'screen-accent': '#99947c', 'screen-mark': '#A6E22E', 'screen-number': '#AE81FF', bezel: '#34352f', 'screen-well': '#414339', 'screen-select': '#878b9180', 'screen-select-inactive': '#878b9140',
      menu: '#1e1f1c', 'menu-select': '#75715E', tabs: '#1e1f1c', side: '#1e1f1c', paper: '#1e1f1c' }]
  ]) {
    const s = await themed(name)
    for (const [k, hex] of Object.entries(want)) assert.equal(s[`--color-${k}`], rgb(hex), `${name}: ${k}`)
    assert.equal(s['--color-screen-wave'], s['--color-screen-ink'], `${name}: the waveform the text's colour`)
    assert.equal(s['--color-screen-channel-1'], s['--color-screen-ink'], `${name}: the first channel the text's colour`)
  }
  // every theme VS Code ships reads whole: a colour for every part, each one a canvas takes
  const { THEMES, MAP } = await import('../playground/theme.js')
  for (const t of THEMES) {
    const s = await themed(t.name)
    for (const k of Object.keys(MAP)) assert.ok(k in s, `${t.name}: ${k}`)
    for (const [k, v] of Object.entries(s)) assert.match(v, /^(rgb\(\d+ \d+ \d+( \/ [\d.]+)?\)|transparent)$/, `${t.name}: ${k}`)
  }
})

// The skin's own default is a theme (themes/screen.json): skin.css's colours are what the theme reads as, token for
// token, so the first paint and the theme worn are one. Every part mapped (theme.js MAP) a colour skin.css declares
test('theme: the screen a theme, skin.css its colours', async () => {
  const { MAP, load, skin } = await import('../playground/theme.js')
  const screen = skin(await load(new URL('../playground/themes/screen.json', import.meta.url).href, { get: u => readFile(new URL(u), 'utf8') }))
  const css = await readFile(new URL('../playground/skin.css', import.meta.url), 'utf8'), root = css.slice(css.indexOf(':root {'), css.indexOf('\n}', css.indexOf(':root {')))
  const declared = Object.fromEntries([...root.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map(m => [m[1], m[2].trim()]))
  for (const k of Object.keys(MAP)) assert.equal(declared[k], screen[k], k)
  // a theme of greys gives no channel hues: the screen's channels the even round
  assert.equal(screen['--color-screen-channel-2'], undefined)
})

// The registry the skin reads a theme by is VS Code's own: each colour's default as VS Code 1.143 registers it
// (themes/vscode-colors.json, read out of its workbench), and every colour a part or a default names is in it
test('theme: VS Code\'s colours and their defaults, as VS Code registers them', async () => {
  const { MAP, REGISTRY } = await import('../playground/theme.js')
  const all = JSON.parse(await readFile(new URL('../playground/themes/vscode-colors.json', import.meta.url), 'utf8'))
  for (const [id, v] of Object.entries(REGISTRY)) if (!id.startsWith('audio.')) assert.deepEqual(v, all[id], id)
  const ids = v => typeof v === 'string' ? (v[0] === '#' ? [] : [v]) : Array.isArray(v) ? v.slice(1).flatMap(ids) : v && typeof v === 'object' ? Object.values(v).flatMap(ids) : []
  for (const v of [...Object.values(MAP).filter(v => v[0] !== 'scope'), ...Object.values(REGISTRY)]) for (const id of ids(v)) assert.ok(id in REGISTRY, id)
})

// The colours made of others as VS Code makes them, against VS Code's own Color (src/vs/base/common/color.ts) and its
// registry's defaults, read out of the workbench VS Code ships, where it is installed: for random themes, every colour
// the skin reads, the same to the bit
test('theme: colours made of others as VS Code\'s own Color makes them', async t => {
  const app = '/Applications/Visual Studio Code.app/Contents/Resources/app/out/vs/workbench/workbench.desktop.main.js'
  let src
  try { src = await readFile(app, 'utf8') } catch { return t.skip('VS Code is not installed here') }
  const a = src.indexOf('function Ace('), b = src.indexOf('static{this.white=new s(new bi(255,255,255,1))}'), e = src.indexOf('}', src.indexOf('static{this.cyan', b))
  if (a < 0 || b < 0 || e < 0) return t.skip('this VS Code\'s Color is not where 1.143\'s was')
  const { Je: Color, bi: RGBA } = new Function(`${src.slice(a, e + 1)}}; return { Je, bi }`)()
  const { REGISTRY, resolver } = await import('../playground/theme.js')
  const parse = h => { h = h.slice(1); const n = i => parseInt(h.slice(i, i + 2), 16); return new Color(new RGBA(n(0), n(2), n(4), h.length > 6 ? n(6) / 255 : 1)) }
  const vscode = (kind, colors) => {
    const memo = {}, color = id => id in memo ? memo[id] : (memo[id] = colors[id] ? parse(colors[id]) : value(REGISTRY[id]))
    const value = v => {
      if (v == null) return undefined
      if (typeof v === 'string') return v[0] === '#' ? parse(v) : color(v)
      if (!Array.isArray(v)) return value(v[kind])
      const [op, x, y, f, k] = v
      if (op === 'transparent') return value(x)?.transparent(y)
      if (op === 'lighten') return value(x)?.lighten(y)
      if (op === 'darken') return value(x)?.darken(y)
      if (op === 'oneOf') { for (const w of v.slice(1)) { const c = value(w); if (c) return c } return }
      const c = value(x), bg = value(y)
      if (op === 'lessProminent') return c && (bg ? c.isDarkerThan(bg) ? Color.getLighterColor(c, bg, f).transparent(k) : Color.getDarkerColor(c, bg, f).transparent(k) : c.transparent(f * k))
      throw new Error(op)
    }
    return color
  }
  let seed = 7
  const random = () => (seed = seed * 16807 % 2147483647) / 2147483647, hex = () => '#' + Array.from({ length: 4 }, () => Math.floor(random() * 256).toString(16).padStart(2, '0')).join('')
  for (let n = 0; n < 100; n++) for (const kind of ['dark', 'light', 'hcDark', 'hcLight']) {
    const colors = Object.fromEntries(Object.keys(REGISTRY).filter(() => random() < .3).map(id => [id, hex()]))
    const mine = resolver({ kind, colors }), theirs = vscode(kind, colors)
    for (const id of Object.keys(REGISTRY)) {
      const p = mine(id), q = theirs(id)?.rgba
      assert.deepEqual(p && [p.r, p.g, p.b, p.a], q && [q.r, q.g, q.b, q.a], `${kind} ${id} ${JSON.stringify(colors)}`)
    }
  }
})

// A word's colour as VS Code's own TextMate engine resolves it (vscode-textmate, Theme.match), for every word the skin
// takes in every theme VS Code ships: the deepest selector matching it wins, the later of two alike, an ancestor
// selector only where its ancestors are the word's; a scope no rule takes, its parent's colour, as the engine lays each
// scope's style over its parent's
test('theme: each word in the colour VS Code\'s TextMate engine gives it, in every theme it ships', async t => {
  let tm
  try { tm = (await import('vscode-textmate')).default } catch { return t.skip('vscode-textmate not installed (npm i -D vscode-textmate)') }
  const { THEMES, SYNTAX, load, colourer } = await import('../playground/theme.js')
  const hex = c => c && '#' + c.slice(0, 3).map(v => Math.round(v * 255).toString(16).padStart(2, '0')).join('')
  for (const th of THEMES) {
    const theme = await load(new URL(`../playground/themes/${th.file}`, import.meta.url).href, { get: u => readFile(new URL(u), 'utf8') })
    const registry = new tm.Registry({ onigLib: Promise.resolve({}), loadGrammar: async () => null })
    registry.setTheme({ settings: theme.tokenColors })
    const engine = registry._syncRegistry._theme, map = registry.getColorMap(), mine = colourer(theme.tokenColors)
    for (const [word, stack] of Object.entries(SYNTAX)) {
      let path = null, id = 0
      for (const scopeName of stack) { path = { scopeName, parent: path }; id = engine.match(path)?.foregroundId || id }
      assert.equal(hex(mine(stack)), id ? map[id].slice(0, 7).toLowerCase() : null, `${th.name}: ${word}`)
    }
  }
})

// The spectrogram's grey (tint.js inked): in white ink, the grey screened over the page as it was drawn before themes,
// white at the opacity of the grey's encoded sRGB value at OKLab lightness u^γ (IEC 61966-2-1; Y = L³, Ottosson 2020);
// in black ink on a light screen, transparent at the floor and opaque at the top, lightness falling evenly
test('theme: the spectrogram\'s grey in white ink is the grey screened over the page; in black, its multiply', async () => {
  const { inked, lightness } = await import('../playground/tint.js')
  const screened = L => { const y = L ** 3; return y <= .0031308 ? 12.92 * y : 1.055 * y ** (1 / 2.4) - .055 }
  for (const gamma of [.5, .75, 1, 1.5]) assert.deepEqual(inked([1, 1, 1, 1], 17, gamma), Array.from({ length: 17 }, (_, k) => `rgb(255 255 255 / ${screened((k / 16) ** gamma).toFixed(4)})`))
  const black = inked([0, 0, 0, 1], 5).map(s => +s.split('/ ')[1].slice(0, -1))
  assert.deepEqual([black[0], black[4]], [0, 1])
  // to the four places the opacity is written to
  black.forEach((a, k) => assert.ok(Math.abs(lightness([1 - a, 1 - a, 1 - a]) - (1 - k / 4)) < 1e-3, `step ${k}`))
})

// What a stretch holds in frequency (tint.js measure), on signals whose answer is known, its places in octaves from 100
// Hz to 10 kHz: a sine centres and peaks at its own frequency, its strongest found between bins to a hundredth of an
// octave (a parabola through the peak's three bins in dB), a tone through and through, all of it in its band (Mixxx's,
// split at 600 Hz and 4 kHz); white noise, flat by definition, far from a tone, each band's power as wide as the band
// (600 Hz, 3.4 kHz and the rest of 24 kHz), its amplitude's share the root of that. Its colours: RGB of the lows the
// red, at the waveform's lightness, to the just noticeable difference CSS Color 4's gamut mapping allows (ΔEOK .02); a
// colour greyed all the way, no chroma; three bands each their share of the height, in the colormap's low, middle and
// top; the centroid's one, its place's
test('theme: a stretch\'s frequencies measured, and coloured as DJ software and DAWs colour them', async () => {
  const { default: measure, coloured, rgb, greyed, lightness } = await import('../playground/tint.js')
  const rate = 48000, n = 4096, place = f => Math.log2(f / 100) / Math.log2(100), octaves = Math.log2(100)
  const sine = f => Float32Array.from({ length: n }, (_, i) => .8 * Math.sin(2 * Math.PI * f * i / rate))
  for (const [f, band] of [[100, 0], [300, 0], [1000, 1], [3000, 1], [7000, 2]]) {
    const m = measure(sine(f), 0, n, rate)
    assert.ok(Math.abs(m.centroid - place(f)) * octaves < .01 && Math.abs(m.dominant - place(f)) * octaves < .01, `${f} Hz at ${place(f).toFixed(3)}: ${m.centroid.toFixed(3)}, ${m.dominant.toFixed(3)}`)
    assert.ok(m.tonal > .99 && m.bands[band] > .99, `${f} Hz a tone, in band ${band}: ${m.tonal}, ${m.bands}`)
  }
  let seed = 1
  const random = () => (seed = seed * 16807 % 2147483647) / 2147483647, noise = Float32Array.from({ length: n }, () => random() * 2 - 1)
  const m = measure(noise, 0, n, rate), wide = [600, 3400, 20000].map(w => Math.sqrt(w / 24000))
  assert.ok(m.tonal < .1, `noise no tone: ${m.tonal}`)
  m.bands.forEach((s, j) => assert.ok(Math.abs(s - wide[j]) < .06, `band ${j}: ${s.toFixed(3)} for ${wide[j].toFixed(3)}`))
  assert.equal(measure(new Float32Array(n), 0, n, rate), null, 'silence, none')
  const red = rgb([1, 0, 0], .7)
  assert.ok(Math.abs(lightness(red) - .7) <= .02 && red[0] > red[1] + .3 && red[0] > red[2] + .3, `the lows red at L .7: ${red}`)
  const grey = greyed([.9, .3, .2, 1], 0)
  assert.ok(Math.max(...grey.slice(0, 3)) - Math.min(...grey.slice(0, 3)) < .01 && Math.abs(lightness(grey) - lightness([.9, .3, .2])) < .01, `greyed, its lightness kept: ${grey}`)
  const tone = u => [u, u, u, 1], tones = coloured('layers', m, tone)
  assert.deepEqual(tones, m.bands.map((s, j) => [tone(j / 2), s]))
  assert.deepEqual(coloured('centroid', m, tone), [[tone(m.centroid), 1]])
})

// The least a theme can be, and the odd forms VS Code reads: `{}`, VS Code's defaults for a dark theme (the background
// #1E1E1E, the foreground #BBBBBB: src/vs/platform/theme/common/colors/editorColors.ts), every word the foreground as
// VS Code draws a word no rule colours; a light background alone, a light theme; tokenColors as a .tmTheme path, no
// rules; JSONC, its comments and trailing commas gone, a "//" in a string kept; selectors in one comma list, the
// deepest matching winning, the later of two alike, one whose ancestor is another language's never
test('theme: the least a theme can be, and the odd forms VS Code reads', async () => {
  const { parse, load, skin, scoper, hex } = await import('../playground/theme.js')
  const empty = skin({})
  assert.deepEqual([empty['--color-screen'], empty['--color-screen-ink'], empty['--color-screen-mark']], ['rgb(30 30 30)', 'rgb(187 187 187)', 'rgb(187 187 187)'])
  // the softer words a fifth of the way from the text to the ground in OKLab: #BBBBBB to #1E1E1E, L .797 to .235
  assert.equal(empty['--color-screen-soft'], 'rgb(154 154 154)')
  assert.equal(empty['--color-screen-channel-1'], 'rgb(187 187 187)')
  assert.equal(empty['--color-screen-channel-2'], undefined, 'one hue only: the rest the even round')
  // no inactive selection given: the selection at half, as VS Code's default is; at .7 in high contrast dark
  // (editor.inactiveSelectionBackground: transparent(editor.selectionBackground, .5), .7 for hcDark): #264F78, #f3f518
  assert.equal(empty['--color-screen-select-inactive'], 'rgb(38 79 120 / 0.5)')
  assert.equal(skin({ kind: 'hcDark' })['--color-screen-select-inactive'], 'rgb(243 245 24 / 0.7)')
  assert.equal(skin({ colors: { 'editor.background': '#fafafa' } })['--color-screen-line-number'], 'rgb(35 120 147)', 'light, by its background: the light line numbers, #237893')
  assert.deepEqual((await load(null, { theme: { tokenColors: './x.tmTheme' } })).tokenColors, [])
  assert.deepEqual(parse('{ /* a */ "url": "http://a//b", // c\n "list": [1, 2,], }'), { url: 'http://a//b', list: [1, 2] })
  assert.throws(() => parse('not a theme'))
  const rule = scoper([
    { scope: 'keyword, string', settings: { foreground: '#111111' } },
    { scope: 'keyword.control', settings: { foreground: '#222222' } },
    { scope: 'keyword.control', settings: { foreground: '#333333' } },
    { scope: 'source.python keyword.control.flow', settings: { foreground: '#444444' } }
  ])
  assert.deepEqual(['keyword.operator.js', 'string.quoted.js', 'keyword.control.flow.js', 'comment.js'].map(s => rule(s)), [hex('#111111'), hex('#111111'), hex('#333333'), null])
  assert.deepEqual([hex('#abc'), hex('#aabbcc80'), hex('red'), hex(42)], [[170 / 255, 187 / 255, 204 / 255, 1], [170 / 255, 187 / 255, 204 / 255, 128 / 255], null, null])
  // a colour or a selector of the wrong kind passed over, as VS Code does, the rest read
  assert.equal(skin({ colors: { 'editor.background': 42 }, tokenColors: [{ scope: [7, 'constant.numeric'], settings: { foreground: '#ff0000' } }] })['--color-screen-number'], 'rgb(255 0 0)')
})

// A theme from its own file (View, Theme, Open a VS Code theme…), one to another leaving nothing of the first (A, then
// B with fewer channel hues: the first's last hues gone), a file that is not a theme said so, the theme kept; a theme
// kept that no longer reads, the page up in the screen's own skin
test('editor: a VS Code theme opened from its file; one to another, nothing of the first left; one that does not read', async () => {
  await open()
  const pick = async (name, text) => {
    const chooser = page.waitForEvent('filechooser')
    await menu('View', 'Theme', 'Open a VS Code theme…')
    await (await chooser).setFiles({ name, mimeType: 'application/json', buffer: Buffer.from(text) })
  }
  const style = k => page.evaluate(k => document.documentElement.style.getPropertyValue(k), k)
  // a theme of its own words: two hues apart, then one
  await pick('mine.json', `{ "name": "Mine", // a comment, as VS Code allows
    "type": "dark", "colors": { "editor.background": "#102030" },
    "tokenColors": [{ "scope": "constant.numeric", "settings": { "foreground": "#ff8000" } }, { "scope": "string", "settings": { "foreground": "#00c0ff" } },] }`)
  await page.waitForFunction(() => document.documentElement.style.getPropertyValue('--color-screen') === 'rgb(16 32 48)')
  assert.deepEqual([await style('--color-screen-ink'), await style('--color-screen-channel-2'), await style('--color-screen-channel-3')], ['rgb(187 187 187)', 'rgb(255 128 0)', 'rgb(0 192 255)'])
  await pick('other.json', `{ "name": "Other", "colors": { "editor.background": "#f0f0f0" } }`)
  await page.waitForFunction(() => document.documentElement.style.getPropertyValue('--color-screen') === 'rgb(240 240 240)')
  assert.equal(await style('--color-screen-channel-3'), '', 'the first theme\'s third hue gone')
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('audio-theme')).name), 'Other')
  // not a theme: said so, the theme worn as it was
  await pick('broken.json', '{ nope')
  await page.locator('.message.problem', { hasText: 'broken.json is not a VS Code colour theme' }).waitFor()
  assert.equal(await style('--color-screen'), 'rgb(240 240 240)')
  // kept, but no longer read: the page comes up whole, in the screen's own skin
  await page.evaluate(() => localStorage.setItem('audio-theme', '{"name":"Gone","theme":null}'))
  await page.reload()
  await wholeLevels().waitFor()
  assert.equal(await style('--color-screen'), '')
})

// The mark in the bar drawn in the bar's ink as a theme changes it: on Dark Modern's title bar (#181818) its words'
// #CCCCCC, never the screen's dark ink left on a dark page
test('editor: the mark in the bar takes the theme\'s ink', async () => {
  await open()
  const light = async () => { const png = (await page.locator('.bar .wordmark .logo').screenshot()).toString('base64'); return page.evaluate(async png => {
    const image = new Image(); image.src = 'data:image/png;base64,' + png; await image.decode()
    const g = new OffscreenCanvas(image.width, image.height).getContext('2d'); g.drawImage(image, 0, 0)
    const d = g.getImageData(0, 0, image.width, image.height).data; let n = 0
    for (let i = 0; i < d.length; i += 4) if (d[i] > 150 && d[i + 1] > 150 && d[i + 2] > 150) n++
    return n / (d.length / 4)
  }, png) }
  await menu('View', 'Theme', 'Dark Modern')
  await page.waitForFunction(() => document.documentElement.style.getPropertyValue('--color-ink') === 'rgb(204 204 204)')
  for (const until = Date.now() + 3000; await light() < .05; await page.waitForTimeout(100)) assert.ok(Date.now() < until, 'the mark in the light ink')
})

// VS Code's fonts, not a theme's (a theme has none): unset, its defaults by platform, the editor's EDITOR_FONT_DEFAULTS
// (src/vs/editor/common/config/fontInfo.ts: Menlo 12 on a Mac, Consolas 14 on Windows, Droid Sans Mono 14 elsewhere)
// and the workbench's (style.css .mac, .windows, .linux); the editor's size the picture's numbers' too, as its line
// numbers'; set, as they are set
test('theme: VS Code\'s fonts by platform, the picture\'s numbers at the editor\'s size; set, as set', async () => {
  const { fonts } = await import('../playground/theme.js')
  assert.deepEqual(fonts({}, 'MacIntel'), { '--font-mono': "Menlo, Monaco, 'Courier New', monospace", '--font-body': '-apple-system, BlinkMacSystemFont, sans-serif', '--font-size-code': '12px', '--font-size-label': '12px' })
  assert.deepEqual(fonts({}, 'Win32'), { '--font-mono': "Consolas, 'Courier New', monospace", '--font-body': "'Segoe WPC', 'Segoe UI', sans-serif", '--font-size-code': '14px', '--font-size-label': '14px' })
  assert.equal(fonts({}, 'Linux x86_64')['--font-mono'], "'Droid Sans Mono', monospace")
  assert.deepEqual(fonts({ editor: 'Fira Code', size: '15px', ui: 'Inter' }, 'MacIntel'), { '--font-mono': 'Fira Code', '--font-body': 'Inter', '--font-size-code': '15px', '--font-size-label': '15px' })
})

// Flat: the waveform one solid shade, peak to peak, nothing graded (gl-waveform with neither its RMS band nor its
// density: its envelope in the line's colour); Density grades it, most of it lighter. On Light+, its text black
test('editor: the waveform\'s Flat fill one solid shade; Density graded', async () => {
  await page.addInitScript(async () => {
    if (sessionStorage.seeded) return
    sessionStorage.seeded = 1
    const m = await import('/playground/theme.js'), t = m.THEMES.find(t => t.name === 'Light+')
    localStorage.setItem('audio-theme', JSON.stringify({ name: t.name, theme: await m.load(new URL('/playground/themes/' + t.file, location.href).href, { kind: t.kind }) }))
  })
  await open()
  await page.reload()
  await wholeLevels().waitFor()
  await write(`audio.from(t => 0.6 * Math.sin(2 * Math.PI * 3 * t) * Math.sin(2 * Math.PI * 220 * t), { duration: 2 })`)
  await lengthIs('0:02.000')
  // of the lanes' inked pixels (darker than the screen's white: the grid's dots and the sound's anti-aliased edges among
  // them), the share that is the text's black
  const solid = () => pixels(`let ink = 0, black = 0; for (let y = 0; y < h - 44; y++) for (let x = 0; x < w - 60; x++) { const i = (y * w + x) * 4, v = d[i] + d[i + 1] + d[i + 2]; if (v < 600 && d[i + 2] < 240) { ink++; if (v < 60) black++ } } return black / (ink || 1)`)
  await page.waitForTimeout(500)
  const graded = await solid()
  await menu('View', 'Waveform options', 'Fill', 'Flat')
  await page.waitForTimeout(500)
  const flat = await solid()
  assert.ok(flat > .6 && graded < flat - .3, `flat ${flat.toFixed(2)}, density ${graded.toFixed(2)}`)
})

// A selection behind the sound, as an editor's is behind its text: Light+'s #ADD6FF where the lane is clear, the
// waveform over it in its own black; the picture not focused, Light+'s inactive selection, #E5EBF1 (light_vs.json)
test('editor: a selection behind the sound, as behind text; focused elsewhere, the inactive selection\'s colour', async () => {
  await page.addInitScript(async () => {
    if (sessionStorage.seeded) return
    sessionStorage.seeded = 1
    const m = await import('/playground/theme.js'), t = m.THEMES.find(t => t.name === 'Light+')
    localStorage.setItem('audio-theme', JSON.stringify({ name: t.name, theme: await m.load(new URL('/playground/themes/' + t.file, location.href).href, { kind: t.kind }) }))
  })
  await open()
  await page.reload()
  await wholeLevels().waitFor()
  await write(`audio.from(t => 0.3 * Math.sin(2 * Math.PI * 220 * t), { duration: 2 })`)
  await lengthIs('0:02.000')
  const box = await page.locator('.plot').boundingBox(), w = box.width - (await gutter()), lane = tall(box)
  await page.mouse.move(box.x + w * .3, box.y + lane * .5)
  await page.mouse.down()
  await page.mouse.move(box.x + w * .6, box.y + lane * .5, { steps: 4 })
  await page.mouse.up()
  await page.mouse.move(box.x + w * .9, box.y + 5)
  await page.waitForTimeout(400)
  // the colour in the selection's middle, above the sound (an eighth of the way down its one lane, TRACK px), and the
  // darkest of four on its centre line (a column holds a third of a cycle, not always where it crosses the line)
  const at = () => pixels(`const px = (y, x) => { const i = (Math.round(y) * w + Math.round(x)) * 4; return [d[i], d[i + 1], d[i + 2]] }, sum = c => c[0] + c[1] + c[2]
    return [px(arg / 8, w * .45), [0, 1, 2, 3].map(dx => px(arg / 2, w * .45 + dx)).reduce((a, b) => sum(a) <= sum(b) ? a : b)]`, lane)
  const near = (c, rgb) => c.every((v, i) => Math.abs(v - rgb[i]) < 6)
  let [clear, sound] = await at()
  assert.ok(near(clear, [173, 214, 255]), `behind the sound, the selection: ${clear}`)
  assert.ok(sound.every(v => v < 60), `the waveform over it, black: ${sound}`)
  await page.locator('.readout').click()
  await page.evaluate(() => document.activeElement?.blur())
  await page.waitForTimeout(300)
  ;[clear] = await at()
  assert.ok(near(clear, [229, 235, 241]), `not focused, the inactive selection: ${clear}`)
})

// A theme from the View menu: the screen its background, the waveform its text's colour; kept as the page comes back;
// the screen's own skin back, nothing of the theme left
test('editor: a VS Code theme from the View menu, the waveform in its text\'s colour, kept; the screen\'s own back', async () => {
  await open()
  await write(`audio.from(t => 0.8 * Math.sin(2 * Math.PI * 220 * t), { duration: 1 })`)
  await lengthIs('0:01.000')
  // the share of the lane's pixels near a colour, TRACK px down
  const lane = tall(await page.locator('.plot').boundingBox())
  const near = rgb => pixels(`const [r, g, b] = arg.rgb; let n = 0, all = 0; for (let y = 0; y < arg.lane; y++) for (let x = 0; x < w - 60; x++) { const i = (y * w + x) * 4; all++; if (Math.abs(d[i] - r) + Math.abs(d[i + 1] - g) + Math.abs(d[i + 2] - b) < 40) n++ } return n / all`, { rgb, lane })
  await menu('View', 'Theme', 'Light+')
  await page.waitForTimeout(500)
  // its density fill lightens most of it; at its densest, the text's black itself
  assert.ok(await near([0, 0, 0]) > .03, 'the waveform Light+\'s text, #000000')
  assert.ok(await near([255, 255, 255]) > .3, 'the screen its white')
  await page.reload()
  await wholeLevels().waitFor()
  await page.waitForTimeout(500)
  assert.ok(await near([0, 0, 0]) > .03 && await near([255, 255, 255]) > .3, 'kept as the page comes back')
  await menu('View', 'Theme', 'The screen')
  await page.waitForTimeout(500)
  // (the caret's line aside, white in the screen's own skin too: a column of the lanes, a thousandth of them)
  assert.ok(await near([255, 255, 255]) < .002, 'none of its white left')
  assert.deepEqual(await page.evaluate(() => [document.documentElement.style.getPropertyValue('--color-screen'), localStorage.getItem('audio-theme')]), ['', null])
})

// Inside a VS Code webview the page wears the theme VS Code does: its colours as VS Code sets them on the page
// (--vscode-*), its kind the body's class (code.visualstudio.com/api/extension-guides/webview, Theming webview content)
test('editor: in a VS Code webview, the theme VS Code wears', async () => {
  // set as the page is parsed, before its scripts run, as VS Code sets them before the webview's
  await page.addInitScript(() => document.addEventListener('readystatechange', () => {
    // a see-through colour as VS Code writes one there, rgba() (Color.Format.CSS.format)
    for (const [k, v] of Object.entries({ 'editor-background': '#fffffe', 'editor-foreground': '#202020', 'editorLineNumber-foreground': '#237893', 'editorWhitespace-foreground': 'rgba(10, 20, 30, 0.5)', 'editor-font-family': 'Fira Code', 'editor-font-size': '15px', 'font-family': 'Inter' })) document.documentElement.style.setProperty(`--vscode-${k}`, v)
    document.body.classList.add('vscode-light')
  }, { once: true }))
  await open()
  assert.deepEqual(await page.evaluate(() => ['--color-screen', '--color-screen-line-number', '--color-screen-ink', '--color-screen-grid', '--font-mono', '--font-body', '--font-size-label'].map(k => document.documentElement.style.getPropertyValue(k))), ['rgb(255 255 254)', 'rgb(35 120 147)', 'rgb(32 32 32)', 'rgb(10 20 30 / 0.502)', 'Fira Code', 'Inter', '15px'])
})

// The edits' cards are as wide as the panel: a long call's settings, folded, are cut short with an ellipsis, never
// widening the card past the panel
test('editor: a long step is cut short in its card, the card no wider than the panel', async () => {
  await open()
  await write(`audio('chime.wav')\n  .warp([${Array.from({ length: 12 }, (_, i) => `[${i / 2 + .5}, ${i / 2 + .6}]`).join(', ')}])`)
  await lengthIs('0:08.000')
  await tab('Edits')
  const side = await page.locator('.side-slab').boundingBox(), card = await page.locator('.step').last().boundingBox()
  assert.ok(card.x + card.width <= side.x + side.width + .5, `the card in the panel: ${card.x + card.width} ≤ ${side.x + side.width}`)
  assert.ok(await page.locator('.step').last().locator('.step-args').evaluate(el => el.scrollWidth > el.clientWidth && getComputedStyle(el).textOverflow === 'ellipsis'), 'its settings cut short')
})

// The export writes the format as its settings say (the library's encode options): a WAV at 24 bits (its fmt chunk's
// bits per sample, 22 bytes into the chunk's body, after its id and size, RIFF/WAVE), its markers as cue points, or none
test('editor: the export writes the depth chosen, and the markers as cue points or none', async () => {
  await open()
  await write(`audio('chime.wav').mark(1)`)
  await lengthIs('0:08.000')
  await tab('Export')
  const panel = page.locator('.export')
  await panel.getByRole('group', { name: 'Bits' }).getByRole('button', { name: '24', exact: true }).click()
  const exported = async () => { const [d] = await Promise.all([page.waitForEvent('download'), panel.locator('.export-button').click()]); return readFile(await d.path()) }
  let bytes = await exported()
  assert.equal(bytes.readUInt16LE(bytes.indexOf('fmt ') + 8 + 14), 24)
  assert.ok(bytes.includes('cue '), 'its marker a cue point')
  await panel.getByRole('switch', { name: 'Markers in the file' }).click()
  bytes = await exported()
  assert.ok(!bytes.includes('cue '), 'no cue points')
  // a format that keeps none: the switch off and still
  await panel.getByRole('button', { name: 'FLAC', exact: true }).click()
  assert.equal(await panel.getByRole('switch', { name: 'Markers in the file' }).isDisabled(), true)
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('audio-repl') || '{}').encoding?.bitDepth === 24)
})

// How a held caret sounds, chosen in the settings: the lab's tape (scrub-methods.js), its head chasing the caret, plays
// the chime while the caret is dragged across it, and is silent held still
test('editor: the tape scrub, chosen in the settings, plays the sound as the caret is dragged, silent held still', async () => {
  await page.addInitScript(tap)
  await open()
  await settings('Scrub', 'Tape')
  const { box, x } = await axis(6.525), y = box.y + box.height - 8
  await page.mouse.move(x(.2), y)
  await page.mouse.down()
  await heard()
  for (let t = .2; t < 1.4; t += .05) { await page.mouse.move(x(t), y); await page.waitForTimeout(40) }
  const moving = (await heard()).peak
  await page.waitForTimeout(400)
  await heard()
  await page.waitForTimeout(400)
  const still = (await heard()).peak
  await page.mouse.up()
  assert.ok(moving > .05 && still < moving / 10, `dragged ${moving}, held still ${still}`)
})

// With tracks, a scrub hears the track edited alone, as its lane shows it, not their mix: the quiet one quiet, the loud
// one loud. A track's mute, beside its name: its lane dim, the mix without it, kept with the tab; the heads part the
// bands with no rule between them, nor say how many channels each has
test('editor: with tracks, a scrub hears the track edited alone; a muted track leaves the mix', async () => {
  await page.addInitScript(tap)
  await open()
  await settings('Scrub', 'Tape')
  await write(`const tone = (f, a) => Float32Array.from({ length: 48000 }, (_, i) => a * Math.sin(2 * Math.PI * f * i / 48000))
let quiet = audio.from([tone(220, .1)], { sampleRate: 48000 })

let loud = audio.from([tone(330, .4), tone(330, .4)], { sampleRate: 48000 })`)
  await page.waitForFunction(() => document.querySelector('.plot').dataset.tracks === '2')
  await lengthIs('0:01.000')
  // the layers open (their mutes in sight), each lane's middle as they have it
  const { box, x } = await axis(1), row = box.y + box.height - 8, lane = async k => (r => r.y + r.h / 2)((await tracksAt())[k])
  // a track pressed, then the caret held and dragged along the time row: that track heard
  const scrub = async k => {
    await page.mouse.click(x(.1), await lane(k))
    await page.waitForTimeout(200)
    await page.mouse.move(x(.2), row)
    await page.mouse.down()
    await page.waitForTimeout(600)
    await heard()
    for (let t = .2; t < .8; t += .03) { await page.mouse.move(x(t), row); await page.waitForTimeout(40) }
    const { peak } = await heard()
    await page.mouse.up()
    return peak
  }
  const quiet = await scrub(0), loud = await scrub(1)
  assert.ok(quiet > .02 && quiet < .2, `the quiet track alone: ${quiet}, the mix would be ~.5`)
  assert.ok(loud > .25, `the loud track: ${loud}`)
  // the loud one muted: the mix the quiet one's alone (−20 dBFS, 20 · log10 0.1); heard again, both (over −8: 0.4 and
  // 0.1 summed)
  const mutes = page.locator('.track-mute'), both = /^−[0-7]\.\ddBFS/
  assert.deepEqual(await mutes.evaluateAll(b => b.map(b => [b.ariaLabel, b.getAttribute('aria-pressed')])), [['Mute quiet', 'false'], ['Mute loud', 'false']])
  await page.keyboard.press('Escape')
  await page.waitForFunction(re => new RegExp(re).test(document.querySelector('.readout').textContent), both.source)
  await mutes.nth(1).click()
  await page.waitForFunction(() => /^−20\.0dBFS/.test(document.querySelector('.readout').textContent))
  assert.equal(await mutes.nth(1).getAttribute('aria-pressed'), 'true')
  assert.equal(await page.locator('.plot').getAttribute('data-tracks'), '2', 'its lane still there')
  // kept with the tab, past a reload
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('audio-repl') || '{}').docs?.some(d => d.muted?.includes('loud')))
  await page.reload()
  await page.waitForFunction(() => document.querySelector('.track-mute[aria-pressed="true"]')?.ariaLabel === 'Mute loud', null, { timeout: 15000 })
  await page.waitForFunction(() => /^−20\.0dBFS/.test(document.querySelector('.readout').textContent))
  await page.locator('.track-mute').nth(1).click()
  await page.waitForFunction(re => new RegExp(re).test(document.querySelector('.readout').textContent), both.source)
})

// A press held still half a second, as a touch's long press puts a text's caret: no selection, the caret dragged, the
// moment under it heard as it goes
test('editor: a press held still, then dragged, takes the caret along without selecting', async () => {
  const { x, y } = await chime()
  await page.mouse.move(x(2), y)
  await page.mouse.down()
  await page.waitForTimeout(650)
  await page.mouse.move(x(4), y, { steps: 8 })
  await page.mouse.up()
  assert.equal(await selected(), '', 'nothing selected')
  assert.ok(Math.abs(+(await page.locator('.time').innerText()).split(':')[1] - 4) < .03, 'the caret where it was let go')
  // a press dragged at once still selects
  await drag([x(5), y], [x(6) - x(5), 0])
  assert.equal(await selected(), '0:05.000–0:06.000')
})

// Each tab shows its own sound at once when it is shown again, before its script has run again
test('editor: a tab shown again shows its sound at once', async () => {
  await open()
  await page.getByRole('button', { name: 'New tab' }).click()
  await write(`audio.from(t => 0.5 * Math.sin(2 * Math.PI * 220 * t), { d: 3 })`)
  await lengthIs('0:03.000')
  const length = () => page.evaluate(() => (e => e.title || e.dataset.tip || '')(document.querySelector('.source')).split(' · ').pop())
  await page.locator('.file [role="tab"]').first().click()
  assert.equal(await length(), '0:06.525', 'the chime at once')
  await page.locator('.file [role="tab"]').last().click()
  assert.equal(await length(), '0:03.000', 'the tone at once')
  await page.getByRole('button', { name: 'New tab' }).click()
  assert.equal(await page.locator('.source').count(), 1)
  await page.locator('.empty').waitFor()
})

// A fade's corner dragged out and back to where it was pressed, give or take a few pixels, makes no edit
test('editor: a fade corner dragged back to where it began makes nothing', async () => {
  const { box, x, y } = await chime()
  await drag([x(2), y], [x(4) - x(2), 0])
  const before = await code()
  await page.mouse.move(x(2) + 9, box.y + 9)
  await page.mouse.down()
  await page.mouse.move(x(1.5), box.y + 9, { steps: 4 })
  await page.mouse.move(x(2) + 10, box.y + 9, { steps: 4 })
  await page.mouse.up()
  await page.waitForTimeout(400)
  assert.equal(await code(), before)
})

// A recipe of several calls is one step of the edits: its name a comment, its calls indented under it (code.js groups),
// one card, folded; a press unfolds it to its steps, its eye turns them all off and on in one step, its × takes them
// all away. An edit made after it is a step of its own, not the group's. Its de-reverb model is not fetched
test('editor: a recipe is one card of the edits, its steps folded under it, turned off or removed together', async () => {
  await page.route(/huggingface\.co/, route => route.abort())
  await open()
  const chime = `audio('chime.wav')\n  .trim()\n  .normalize(-1)\n  .fade(0.02, 0.1)`
  await menu('Process', 'Recipes', 'Remove room echo')
  const grouped = `${chime}\n  // Remove room echo\n    .highpass(80)\n    .dereverb()`
  await page.waitForFunction(c => scriptText() === c, grouped)
  await tab('Edits')
  const names = () => page.locator('.steps-list > li:not([hidden]) .step-name').allInnerTexts()
  await page.waitForFunction(() => document.querySelector('.step-group'))
  assert.deepEqual(await names(), ['chime.wav', 'Trim', 'Normalize', 'Fade', 'Remove room echo'])
  assert.equal(await page.locator('.step-group .step-args').innerText(), '2 steps')
  const group = page.locator('.step-group .step-toggle')
  await group.click()
  assert.deepEqual(await names(), ['chime.wav', 'Trim', 'Normalize', 'Fade', 'Remove room echo', 'Highpass', 'Dereverb'])
  await group.click()
  assert.deepEqual(await names(), ['chime.wav', 'Trim', 'Normalize', 'Fade', 'Remove room echo'])
  // its eye: all its steps off, in one step of the history, and back on
  await page.locator('.step-group').hover()
  await page.getByRole('button', { name: 'Turn Remove room echo off' }).click()
  await page.waitForFunction(() => /\n    \/\/ \.highpass\(80\)\n    \/\/ \.dereverb\(\)$/.test(scriptText()))
  await menu('Edit', 'Undo')
  await page.waitForFunction(c => scriptText() === c, grouped)
  // an edit after it is its own step
  await page.locator('.plot').focus()
  await page.keyboard.press('m')
  await page.waitForFunction(c => scriptText() === c + '\n  .mark(0)', grouped)
  await page.waitForFunction(() => [...document.querySelectorAll('.steps-list > li:not([hidden]) .step-name')].map(e => e.textContent).at(-1) === 'Mark')
  // its ×: all of it away, the name too
  await page.locator('.step-group').hover()
  await page.getByRole('button', { name: 'Remove Remove room echo' }).click()
  await page.waitForFunction(c => scriptText() === c + '\n  .mark(0)', chime)
  assert.equal(await page.locator('.step-group').count(), 0)
})

// Recipes: a goal's whole chain, a group each, folded till opened; found by its words (its group opening), put on the
// sound open
test('editor: a recipe found by its words goes on the sound open; its groups fold', async () => {
  await open()
  await tab('Recipes')
  const master = page.locator('.recipe-group', { has: page.locator('summary', { hasText: /^Master/ }) })
  assert.equal(await master.locator('.scenario').first().isVisible(), false, 'folded')
  await master.locator('summary').click()
  assert.ok((await master.locator('.scenario strong').allInnerTexts()).includes('Mastering chain, dither last'), 'opened: the mastering recipes')
  await page.getByRole('searchbox', { name: 'Find a recipe' }).fill('restore vinyl')
  assert.deepEqual(await page.locator('.scenario strong').allInnerTexts(), ['Restore vinyl'])
  await page.locator('.scenario', { hasText: 'Restore vinyl' }).click()
  await page.waitForFunction(() => /^audio\('chime\.wav'\)\.trim\(\)\.normalize\(-1\)\.fade\(0\.02,0\.1\)\/\/Restorevinyl\.declick\(\)\.decrackle\(\)\.midside/.test(scriptText().replace(/\s+/g, '')))
})

// The agent, through the local bridge (bin/bridge.js): the page connects with the bridge's address and key, the agent
// the bridge started with named, no choice to make; it answers the agent's tool calls as the MCP server sends them (an
// edit written into the script, one step; the state of the sound; a measurement and a picture, changing nothing; the
// file as it opened, level-matched), and the chat streams the agent's words as Markdown, what it runs while it answers,
// the tools it used. The conversation is the page's, kept: a reload brings it back, a new one starts empty, the old one
// is a click away, another tab shows it still (the agent's `open` and `tabs` move between tabs mid-conversation). The agent here is a stand-in on PATH printing what
// `claude -p --output-format stream-json --verbose --include-partial-messages` prints, a tool's run held for a moment
test('editor: through the local bridge, an agent measures and edits the sound open; its words as Markdown, kept across tabs', async () => {
  const { spawn } = await import('node:child_process'), { mkdtempSync, writeFileSync, chmodSync, readFileSync } = await import('node:fs'), { join } = await import('node:path')
  const dir = mkdtempSync(join(tmpdir(), 'audio-agent-')), S = 'b1d0c0de-0000-4000-8000-000000000001', KEY = 'editor-test-key', log = join(dir, 'log')
  const ev = event => ({ type: 'stream_event', event, session_id: S, parent_tool_use_id: null })
  const say = text => ev({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } })
  writeFileSync(join(dir, 'claude'), `#!${process.execPath}
const fs = require('fs'), input = fs.readFileSync(0, 'utf8')
fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify({ argv: process.argv.slice(2), input }) + '\\n')
const out = l => process.stdout.write(JSON.stringify(l) + '\\n'), wait = ms => new Promise(r => setTimeout(r, ms))
;(async () => {
  // asked again: three calls at once, answered in another order, the check refused; the measurement made through the
  // bridge as the agent's MCP server makes it
  const mcp = JSON.parse(process.argv[process.argv.indexOf('--mcp-config') + 1]).mcpServers.audio.args, at = flag => mcp[mcp.indexOf(flag) + 1]
  if (input.includes('peak')) return ${JSON.stringify([
    { type: 'system', subtype: 'init', session_id: S },
    { type: 'assistant', message: { content: [{ type: 'tool_use', id: 'a', name: 'mcp__audio__measure', input: { code: "out.stat(['truepeak', 'loudness'])" } }, { type: 'tool_use', id: 'b', name: 'mcp__audio__check', input: { spec: 'podcast' } }, { type: 'tool_use', id: 'c', name: 'mcp__audio__look', input: { at: 1, d: 2 } }, { type: 'tool_use', id: 'd', name: 'mcp__audio__edit', input: { call: 'fade(0.02, 0.1)' } }] }, parent_tool_use_id: null, session_id: S },
    'call',
    { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'b', content: 'no', is_error: true }, { type: 'tool_result', tool_use_id: 'a', content: '-1' }, { type: 'tool_result', tool_use_id: 'c', content: '' }, { type: 'tool_result', tool_use_id: 'd', content: '' }] }, parent_tool_use_id: null, session_id: S },
    { type: 'result', subtype: 'success', is_error: false, result: '', session_id: S }
  ])}.reduce((p, l) => p.then(() => l === 'call' ? fetch(at('--playground') + '/call', { method: 'POST', headers: { authorization: 'Bearer ' + at('--key') }, body: JSON.stringify({ tool: 'measure', args: { code: "out.stat(['truepeak', 'loudness'])" } }) }) : out(l)), Promise.resolve())
  for (const l of ${JSON.stringify([
    { type: 'system', subtype: 'init', session_id: S },
    ev({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }),
    say('It is **6.5 s** '), say('long.\n\n| Rule | Value |\n|---|---|\n| Peak | `−1.0dB` |'),
    { type: 'assistant', message: { content: [{ type: 'tool_use', id: 'toolu_1', name: 'mcp__audio__state', input: {} }] }, parent_tool_use_id: null, session_id: S }
  ])}) out(l)
  await wait(800)
  out(${JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: '{}' }] }, parent_tool_use_id: null, session_id: S })})
  // thinking past the page's next tick of its seconds (each second, from whenever) on a runner that runs it late
  await wait(3000)
  out(${JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: '', session_id: S })})
})()
`)
  chmodSync(join(dir, 'claude'), 0o755)
  const runs = () => readFileSync(log, 'utf8').trim().split('\n').map(l => JSON.parse(l))
  const proc = spawn(process.execPath, [fileURLToPath(new URL('../bin/cli.js', import.meta.url)), '--bridge', '--port', '0', '--key', KEY], { env: { ...process.env, AUDIO_BRIDGE_KEY: '', PATH: dir }, stdio: ['ignore', 'pipe', 'inherit'] })
  try {
    const url = await new Promise(resolve => proc.stdout.on('data', d => { const m = String(d).match(/http:\/\/127\.0\.0\.1:\d+/); if (m) resolve(m[0]) }))
    // the bridge is the one other address the page may reach
    await page.route(url + '/**', route => route.continue())
    await open()
    await tab('Agent')
    await page.getByRole('textbox', { name: 'The bridge\'s address' }).fill(url)
    await page.getByLabel('The bridge\'s key').fill(KEY)
    await page.getByRole('button', { name: 'Connect' }).click()
    await page.locator('.chat-form textarea[placeholder="Ask Claude Code…"]').waitFor()
    assert.equal(await page.getByRole('textbox', { name: 'The bridge\'s address' }).count(), 0, 'its address and key gone once connected')
    assert.equal(await page.locator('.chat-empty').count(), 0, 'connected, nothing said: the box says who answers, no choice of agent')
    assert.equal(await page.locator('.chat-head').count(), 0, 'no conversations yet')
    // the agent's tools, as its MCP server calls them
    const call = (tool, args = {}) => fetch(`${url}/call?key=${KEY}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ tool, args }) }).then(r => r.json())
    const edited = await call('edit', { call: 'gain(-6)' })
    assert.equal(edited.result.ok, true, JSON.stringify(edited))
    await page.waitForFunction(() => /\.gain\(-6\)$/.test(scriptText().trim()))
    const { result: now } = await call('state')
    assert.ok(now.script.trim().endsWith('.gain(-6)') && now.duration > 6 && Number.isFinite(now.stats.loudness), JSON.stringify(now))
    // a measurement of the output as shown, every edit in, and of the file as it opened; nothing changes
    const script = await page.evaluate(() => scriptText())
    const { result: levels } = await call('measure', { code: "out.stat(['loudness', 'db'])" })
    assert.ok(Math.abs(levels[0] - now.stats.loudness) < 0.01 && Math.abs(levels[1] - now.stats.peak) < 0.01, JSON.stringify({ levels, now }))
    const { result: before } = await call('measure', { code: "const l = await src.stat('loudness')\nl - 6" })
    assert.ok(Math.abs(before - (await call('measure', { code: "src.stat('loudness')" })).result + 6) < 1e-6, 'a script\'s statements, its last expression the answer')
    assert.ok(Math.abs((await call('measure', { code: 'out.duration' })).result - now.duration) < 1e-5, 'to 7 digits')
    assert.deepEqual((await call('measure', { code: '[1 / 0, -1 / 0, new Float32Array([0.5, 0.25])]' })).result, ['Infinity', '-Infinity', [0.5, 0.25]], 'what JSON has no word for as text, typed arrays whole')
    assert.match((await call('measure', { code: 'out.nope()' })).error, /nope/, 'its error, said')
    // the picture, the waveform over the spectrogram, of the range asked; the view as it was
    const { result: picture } = await call('look', { at: 1, d: 2 })
    assert.match(picture.image, /^data:image\/png;base64,/)
    assert.ok(picture.image.length > 4000 && picture.text.startsWith('0:01.000 to 0:03.000'), picture.text)
    assert.equal(await page.evaluate(() => scriptText()), script, 'measured and looked at, the script as it was')
    // the agent's edit drawn over the picture as its card draws it; a pitch edit's, the pitch curve before it and after,
    // the spectrogram turned to, its look told so; gone once the script moves on
    assert.equal((await call('edit', { call: 'intonation(1.5)' })).result.ok, true)
    assert.equal(await shown(), 'Spectrogram')
    assert.match((await call('look')).result.text, /the pitch curve before your last edit, dashed, and after it$/)
    await call('undo')
    assert.doesNotMatch((await call('look')).result.text, /pitch curve/)
    await show('wave')
    // the caret or a range put where it does not show comes into sight, as the user's own would
    await page.locator('.plot').focus()
    for (let i = 0; i < 4; i++) await page.keyboard.press('=')
    const sight = async () => (await call('look')).result.text.match(/^([\d:.]+) to ([\d:.]+)/).slice(1).map(t => +t.split(':')[1])
    const [a0, b0] = await sight()
    assert.ok(b0 - a0 < 2 && b0 < 5.5, `zoomed in: ${a0}–${b0}`)
    await call('select', { cursor: 5.5 })
    const [a1, b1] = await sight()
    assert.ok(a1 <= 5.5 && 5.5 <= b1 && Math.abs(b1 - a1 - (b0 - a0)) < .01, `the caret in sight, the zoom kept: ${a1}–${b1}`)
    await call('select', { at: .5, d: 5 })
    const [a2, b2] = await sight()
    assert.ok(a2 <= .5 && b2 >= 5.5, `a range longer than what shows, all of it: ${a2}–${b2}`)
    // the file as it opened, level-matched, then the output again
    assert.equal((await call('play', { original: true })).result.original, true)
    assert.equal((await call('play', { original: false })).result.original, false)
    await call('stop')
    await call('undo')
    await page.waitForFunction(() => !scriptText().includes('gain('))
    // a box of a band, on the spectrogram, which then shows
    const { result: boxed } = await call('select', { at: 1, d: 1, low: 1000, high: 3000 })
    assert.deepEqual([boxed.selection, boxed.band], [[1, 2], [1000, 3000]])
    assert.equal(await shown(), 'Spectrogram')
    assert.deepEqual((await call('state')).result.band, [1000, 3000])
    // scrubbed: the caret swept to where it ends, the moment under it sounding on the way
    assert.equal((await call('scrub', { at: 1, to: 2, d: .3 })).result.cursor, 2)
    assert.equal(await page.locator('.time').innerText(), '0:02.000')
    // its edits as the Edits panel's cards: turned off and on, moved, taken away, one step each
    const calls = async () => (await call('state')).result.steps.map(s => (s.on ? '' : '~') + s.call)
    assert.deepEqual(await calls(), ['trim()', 'normalize(-1)', 'fade(0.02, 0.1)'])
    for (const [args, after] of [[{ index: 2, on: false }, ['trim()', 'normalize(-1)', '~fade(0.02, 0.1)']], [{ index: 2, on: true }, ['trim()', 'normalize(-1)', 'fade(0.02, 0.1)']],
      [{ index: 1, to: 0 }, ['normalize(-1)', 'trim()', 'fade(0.02, 0.1)']], [{ index: 0, remove: true }, ['trim()', 'fade(0.02, 0.1)']]]) {
      assert.equal((await call('step', args)).result.ok, true, JSON.stringify(args))
      assert.deepEqual(await calls(), after, JSON.stringify(args))
    }
    assert.match((await call('step', { index: 5, on: false })).error, /No edit 5/)
    assert.match((await call('step', { index: 0, to: 2 })).error, /No place 2 to move it to: there are 2/)
    assert.match((await call('step', { index: 0 })).error, /on, remove, to or call/, 'nothing asked of it')
    assert.deepEqual((await call('step', { index: 0, on: true })).result, { ok: true, unchanged: true }, 'on already')
    assert.deepEqual((await call('step', { index: 1, to: 1 })).result, { ok: true, unchanged: true }, 'where it is')
    await call('undo')
    assert.deepEqual(await calls(), ['normalize(-1)', 'trim()', 'fade(0.02, 0.1)'], 'one undo, one act')
    await call('script', { code: script })
    // through the edits: one as the sound enters and leaves it, what it takes out, where a range of the output was as it
    // entered it (none for trim, which changes the timing); turned off over a range alone, its mix 0 there ramped over the
    // splices (10 ms), and on again; written anew; seen and heard up to it, or what it takes out, the panel as it was after
    assert.deepEqual(await calls(), ['trim()', 'normalize(-1)', 'fade(0.02, 0.1)', 'gain(-6)'])
    const { result: through } = await call('measure', { code: "const s = step(3), w = s.where({ at: 1, d: 1 }); [s.call, s.before.stat('db') - s.after.stat('db'), s.takes.stat('db', w), step(0).takes, w.at, w.d]" })
    assert.equal(through[0], 'gain(-6)', JSON.stringify(through))
    assert.ok(Math.abs(through[1] - 6) < .01, `6 dB less after it: ${through[1]}`)
    assert.ok(through[2] < -6, `what it takes out, a half of it less: ${through[2]}`)
    assert.equal(through[3], null, 'trim changes the timing: nothing taken to say')
    assert.ok(Math.abs(through[4] - 1) < 1e-3 && Math.abs(through[5] - 1) < 1e-3, `nothing after it moves the time: ${through.slice(4)}`)
    assert.equal((await call('step', { index: 3, on: false, at: 1, d: 1 })).result.ok, true)
    assert.equal((await call('state')).result.steps[3].call, 'gain(-6, { mix: { t: [0.99, 1, 2, 2.01], v: [1, 0, 0, 1] } })')
    const { result: kept } = await call('measure', { code: "[out.stat('db', { at: 1.2, d: 0.6 }) - step(3).before.stat('db', { at: 1.2, d: 0.6 }), out.stat('db', { at: 3, d: 1 }) - step(3).before.stat('db', { at: 3, d: 1 })]" })
    assert.ok(Math.abs(kept[0]) < .01 && Math.abs(kept[1] + 6) < .01, `off there alone: ${kept}`)
    assert.equal((await call('step', { index: 3, on: true, at: 1, d: 1 })).result.ok, true)
    assert.equal((await call('state')).result.steps[3].call, 'gain(-6)', 'on again everywhere: no mix')
    assert.equal((await call('step', { index: 3, call: 'gain(-3)' })).result.ok, true)
    assert.equal((await call('state')).result.steps[3].call, 'gain(-3)', 'written anew')
    const { result: delta } = await call('look', { step: 3, takes: true, at: 1, d: 1 })
    assert.match(delta.image, /^data:image\/png;base64,/)
    assert.equal((await call('state')).result.shown, null, 'looked at, the panel as it was')
    assert.match((await call('look', { step: 0, takes: true })).error, /changes the timing/)
    await call('play', { step: 2 })
    assert.deepEqual((await call('state')).result.shown, { step: 2, takes: false }, 'heard up to it, its card chosen')
    await call('play')
    assert.equal((await call('state')).result.shown, null, 'the whole chain again')
    await call('stop')
    await call('script', { code: script })
    // the chat: while it answers, what it runs; then its words as Markdown, the tools it used
    await tab('Agent')
    const box = page.getByRole('textbox', { name: 'A message to the agent' })
    await box.fill('How long is it?')
    await page.keyboard.press('Enter')
    // its call as the user would say it while it runs; its answer read, thinking, the seconds the turn has taken beside
    // it (counted each second); the call done, in its place after the words before it
    await page.locator('.chat-busy', { hasText: 'Reading the sound' }).waitFor()
    await page.locator('.chat-busy', { hasText: /Thinking\s*[1-9]\d*s$/ }).waitFor()
    await page.locator('.chat-message.agent .md strong', { hasText: '6.5 s' }).waitFor()
    assert.deepEqual(await page.locator('.chat-message.agent .md td').allInnerTexts(), ['Peak', '−1.0dB'], 'a table, its code')
    await page.locator('.chat-busy').waitFor({ state: 'detached' })
    assert.deepEqual(await page.locator('.chat-message.agent > *').evaluateAll(els => els.map(e => e.className)), ['md', 'chat-step'])
    assert.deepEqual(await page.locator('.chat-message.agent .chat-step > *').allInnerTexts(), ['Read the sound'], 'the page answered no such call since it began: nothing beside it')
    assert.equal(await page.locator('.chat-message.user').innerText(), 'How long is it?')
    assert.equal(await page.locator('.chat-title').innerText(), 'How long is it?', 'the conversation named by its first words')
    // the next message goes on with the agent's session
    await box.fill('And the peak?')
    await page.keyboard.press('Enter')
    await page.locator('.chat-busy').waitFor()
    await page.locator('.chat-busy').waitFor({ state: 'detached' })
    const resumed = runs().at(-1).argv
    assert.equal(resumed[resumed.indexOf('--resume') + 1], S)
    // each call's answer matched to its call, whatever their order
    const second = page.locator('.chat-message.agent').nth(1)
    assert.deepEqual(await second.locator('.chat-step').evaluateAll(els => els.map(e => [e.querySelector('button, span > span:not(.chat-note)').textContent, e.classList.contains('failed')])), [['Checked against Apple Podcasts', true], ['Measured', false], ['Looked at 0:01.000–0:03.000', false], ['Applied fade(0.02, 0.1)', false]])
    // what the page measured, under it, stat by stat as the check's rules are in Export
    const measured = await second.locator('.chat-step:has-text("Measured") + .chat-table tr').evaluateAll(rows => rows.map(r => [...r.cells].map(c => c.textContent)))
    assert.equal(measured.length, 2)
    assert.equal(measured[0][0], 'True peak')
    assert.match(measured[0][1], /^−\d+(\.\d+)?dBTP$/)
    assert.equal(measured[1][0], 'Loudness')
    assert.match(measured[1][1], /^−\d+(\.\d+)?LUFS$/)
    assert.equal(await second.locator('.chat-table').count(), 1, 'the check refused: no table')
    // a step's place on the sound, a click away
    await second.getByRole('button', { name: 'Looked at 0:01.000–0:03.000' }).click()
    assert.deepEqual((await call('state')).result.selection, [1, 3])
    await second.getByRole('button', { name: 'Applied fade(0.02, 0.1)' }).click()
    assert.equal(await page.locator('.step.chosen .step-name').innerText(), 'Fade', 'its card chosen among the edits')
    await tab('Agent')
    // reloaded, the conversation is back; a new one starts empty, the old a click away
    await page.reload()
    await page.locator('.chat-message.user').nth(1).waitFor()
    assert.deepEqual(await page.locator('.chat-message.user').allInnerTexts(), ['How long is it?', 'And the peak?'])
    await page.getByRole('button', { name: 'New conversation' }).click()
    assert.equal(await page.locator('.chat-message').count(), 0)
    assert.equal(await page.locator('.chat-title').innerText(), 'New conversation')
    await page.locator('.chat-title').click()
    await page.locator('#chats-menu .chat-item', { hasText: 'How long is it?' }).locator('.menu-item').click()
    assert.equal(await page.locator('.chat-message.user').count(), 2)
    // another tab, the same conversation: the agent's, not the tab's
    await page.getByRole('button', { name: 'New tab' }).click()
    assert.equal(await page.locator('.chat-message.user').count(), 2, 'shown still')
    assert.equal(await page.locator('.chat-title').innerText(), 'How long is it?')
    // deleted, it goes; none left, nor the list of them
    await page.locator('.chat-title').click()
    await page.getByRole('button', { name: 'Delete How long is it?' }).click()
    assert.equal(await page.locator('.chat-message').count(), 0)
    assert.equal(await page.locator('.chat-head').count(), 0, 'none left')
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('audio-repl')).chats), undefined, 'nor kept')
    // a file of the user's machine, read through the bridge, in the tab shown, which is empty
    const opened = await call('open', { path: fileURLToPath(new URL('fixture.wav', import.meta.url)) })
    assert.deepEqual([opened.result.ok, opened.result.name], [true, 'fixture.wav'], JSON.stringify(opened))
    assert.equal(await page.locator('.file.current').innerText(), 'fixture.wav')
    assert.match((await call('open', { path: fileURLToPath(new URL('../package.json', import.meta.url)) })).error, /Not an audio or video file/)
    errors.splice(0, Infinity, ...errors.filter(e => !/ 415 /.test(e)))  // the browser's own word on the refusal, asked for
  } finally { proc.kill() }
})

// Conversations an earlier page kept with each tab come back as the page's: every tab's, a closed one's too, the oldest
// first, the one the tab shown had open, open; shown whichever tab shows, and kept so
test('editor: conversations kept with each tab come back as the page\'s, whichever tab shows', async () => {
  const chat = (id, title) => ({ id, at: id, title, agent: 'claude', session: null, messages: [{ role: 'user', text: title }, { role: 'agent', parts: [{ text: 'Done.' }] }] })
  await page.addInitScript(old => { if (!sessionStorage.seeded) { sessionStorage.seeded = 1; localStorage.setItem('audio-repl', JSON.stringify(old)) } }, {
    doc: 1,
    docs: [{ code: "audio('chime.wav')", chats: [chat(1, 'First')], chat: 1 }, { code: "audio('chime.wav').gain(-3)", chats: [chat(3, 'Third')], chat: 3 }],
    closed: [{ code: "audio('chime.wav').gain(-6)", chats: [chat(2, 'Second')], chat: 2, at: 0, shut: 1 }]
  })
  await open()
  await tab('Agent')
  assert.equal(await page.locator('.chat-title').innerText(), 'Third', 'the one the tab shown had open')
  await page.locator('.chat-title').click()
  assert.deepEqual(await page.locator('#chats-menu .chat-item .menu-item').allInnerTexts().then(t => t.map(s => s.split('\n')[0])), ['Third', 'Second', 'First'], 'every tab\'s, newest first')
  await page.keyboard.press('Escape')
  await page.locator('.file').first().click()
  await page.waitForFunction(() => document.querySelector('.file.current') === document.querySelector('.file'))
  assert.equal(await page.locator('.chat-title').innerText(), 'Third', 'another tab: the same conversation')
  assert.deepEqual(await page.locator('.chat-message.user').allInnerTexts(), ['Third'])
  const kept = await page.evaluate(() => JSON.parse(localStorage.getItem('audio-repl')))
  assert.deepEqual([kept.chats.map(c => c.title), kept.chat, kept.docs.some(d => 'chats' in d)], [['First', 'Second', 'Third'], 3, false], 'kept as the page\'s')
})

// The cuts as an edit list for a video editor (the library's cuts()): a deletion splits the chime into two events of
// its own clip, at the rate chosen, CMX 3600
test('editor: the export writes the cuts as an edit list, the clip named, at the rate chosen', async () => {
  const { x, y } = await chime()
  await drag([x(2), y], [x(3) - x(2), 0])
  await page.keyboard.press('Delete')
  await lengthIs('0:07.000')
  await tab('Export')
  const panel = page.locator('.export')
  await panel.locator('summary', { hasText: /^Edit list/ }).click()
  await panel.getByRole('group', { name: 'Frames a second' }).getByRole('button', { name: '25', exact: true }).click()
  const [download] = await Promise.all([page.waitForEvent('download'), panel.getByRole('button', { name: 'Export EDL' }).click()])
  assert.equal(download.suggestedFilename(), 'chime-edited.edl')
  const edl = await readFile(await download.path(), 'utf8'), events = edl.split('\n').filter(l => /^\d{3}\s/.test(l))
  assert.match(edl, /^TITLE: /m)
  assert.equal(events.length, 2, edl)
  assert.match(edl, /\* FROM CLIP NAME: chime\.wav/)
  // the second event starts in the source a second after the first ends: 00:00:03:00 in, at 00:00:02:00 on the record
  assert.match(events[1], /00:00:03:00 00:00:08:00 00:00:02:00 00:00:07:00/, events[1])
})

// In the pitch context (View > Pitch curve) the pitch line is edited as the gain line is, on its own scale (half a lane
// an octave): a press on its 0 makes a point, dragged up, to the cent; one pitch() curve, a voice's, set again in
// place; a double-click on a point takes it away, the last one the call
test('editor: the pitch line, in the pitch context, edits a pitch() curve as the gain line edits gain()', async () => {
  await open()
  await noCues()
  await write(`audio.from(t => 0.5 * Math.sin(2 * Math.PI * 220 * t), { d: 2 })`)
  await lengthIs('0:02.000')
  await menu('View', 'Show', 'Pitch curve')
  // the line on the waveform (the spectrogram, which the picture turns to, draws its points on the pitch curve)
  await show('wave')
  // its one lane, TRACK px tall
  const { box, x } = await axis(2), lh = tall(box), mid = box.y + lh / 2, st = lh / 2 / 12
  const near = v => page.waitForFunction(v => { const m = scriptText().trim().match(/\.pitch\(\{ t: \[1\], v: \[([\d.]+)\] \}, \{ voice: true \}\)$/); return m && Math.abs(m[1] - v) < .1 }, v)
  await drag(await grab([[x(1), mid]], 'ns-resize'), [0, -3 * st])
  await near(3)
  await drag(await grab([[x(1), mid - 3 * st]], 'move'), [0, -2 * st])
  await near(5)
  assert.equal((await code()).match(/\.pitch\(/g).length, 1)
  await page.mouse.dblclick(...await grab([[x(1), mid - 5 * st]], 'move'))
  await page.waitForFunction(() => !scriptText().includes('pitch('))
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

// With tracks, the first card of the edits is the track's: its ×, or its right-click, deletes the track, as a DAW's track
// header does; one step, undone in one
test('editor: with tracks, the track\'s card deletes it', async () => {
  await open()
  const A = `let a = audio('chime.wav')\n  .gain(-3)`, B = `let b = audio('chime.wav')\n  .gain(-6)`
  await write(`${A}\n\n${B}`)
  await tab('Edits')
  await page.waitForFunction(() => document.querySelector('.plot').dataset.tracks === '2')
  const card = page.locator('.steps-list .step').first(), name = () => page.locator('.steps-list .step-name').first().textContent()
  const left = text => page.waitForFunction(text => scriptText().replace(/\u00a0/g, ' ') === text, text)
  await page.waitForFunction(() => document.querySelector('.steps-list .step-name')?.textContent === 'b · chime.wav')
  await card.hover()
  await card.getByRole('button', { name: 'Delete track b', exact: true }).click()
  await left(A)
  await page.waitForFunction(() => !('tracks' in document.querySelector('.plot').dataset))
  assert.equal(await name(), 'chime.wav', 'one sound: no track')
  assert.equal(await card.getByRole('button', { name: /^Delete track/ }).count(), 0, 'nothing to delete')
  await page.keyboard.press('ControlOrMeta+Z')
  await page.waitForFunction(() => document.querySelector('.plot').dataset.tracks === '2' && / · chime\.wav$/.test(document.querySelector('.steps-list .step-name')?.textContent))
  const edited = (await name()).split(' · ')[0]
  await card.click({ button: 'right' })
  await contextRow('Delete the track').click()
  await left(edited === 'a' ? B : A)
  // a track made in the script, its first card the call making it
  await write(`${B}\n\nlet tone = audio.from(t => Math.sin(t * 2000), { d: 1 })`)
  await tab('Edits')
  await page.waitForFunction(() => document.querySelector('.plot').dataset.tracks === '2' && document.querySelector('.steps-list .step-name')?.textContent === 'From')
  await card.hover()
  await card.getByRole('button', { name: 'Delete track tone', exact: true }).click()
  await left(B)
})

// A tab shown again whose sound is what its script makes shows it as it was, nothing run again (the worker keeps each
// tab's last output, for its cues, checks and export): its sound, what its run printed, its export. With nothing
// selected, the clock says how long all of it is, softer than a selection's length
test('editor: a tab shown again runs nothing; its sound, its words and its export as they were', async () => {
  await page.addInitScript(() => {
    const post = Worker.prototype.postMessage
    globalThis.runs = 0
    Worker.prototype.postMessage = function (m, t) { if (m?.type === 'run') runs++; return post.call(this, m, t) }
  })
  await open()
  await write(`console.log('the chime')\naudio('chime.wav').gain(-3)`)
  await lengthIs('0:08.000')
  await page.waitForFunction(() => !document.querySelector('.message').textContent)
  assert.equal(await page.locator('.length').innerText(), '0:08.000', 'all of it, nothing selected')
  assert.ok(await page.locator('.length').evaluate(el => el.classList.contains('whole')))
  await page.getByRole('button', { name: 'New tab' }).click()
  // no sound: its length nothing, 0:00.000, as a player's with nothing in it
  assert.deepEqual(await page.locator('.length').evaluate(e => [e.textContent, getComputedStyle(e).visibility]), ['0:00.000', 'visible'], 'no sound')
  await write(`audio.from(2)`)
  await lengthIs('0:02.000')
  const ran = await page.evaluate(() => runs)
  await page.locator('.file [role="tab"]').first().click()
  await lengthIs('0:08.000')
  await page.waitForTimeout(500)
  assert.equal(await page.evaluate(() => runs), ran, 'nothing ran again')
  assert.deepEqual(await page.locator('.console .line').evaluateAll(l => l.map(e => e.textContent)), ['the chime'])
  await tab('Export')
  const [d] = await Promise.all([page.waitForEvent('download'), page.locator('.export .export-button').click()])
  const exported = await audio(await readFile(await d.path()))
  assert.ok(Math.abs(exported.duration - 8) < .001, `its own sound exported: ${exported.duration} s`)
  await page.locator('.file [role="tab"]').last().click()
  await lengthIs('0:02.000')
  assert.equal(await page.evaluate(() => runs), ran, 'nor the other')
  // left before its output came: shown again, it runs, and its own output comes
  await write(`audio.from(3)`)
  await page.locator('.file [role="tab"]').first().click()
  await lengthIs('0:08.000')
  await page.locator('.file [role="tab"]').last().click()
  await lengthIs('0:03.000')
  assert.ok(await page.evaluate(() => runs) > ran, 'ran again')
})

// A view zoomed out past the sound's end, the room on its right, is kept as it was left: a reload shows the sound at the
// same scale, not fitted to the view; an edit that shortens it, as far out as the shorter one goes, not fitted either;
// one that makes it longer than the view, fitted
test('editor: a view zoomed out past the end stays so after a reload', async () => {
  await open()
  await noCues()
  await write(`audio('chime.wav')`)
  await lengthIs('0:08.000')
  await page.locator('.plot').focus()
  for (let i = 0; i < 2; i++) await page.keyboard.press('-')
  await page.waitForTimeout(700)
  // the time at `t` s on a view `across` s wide: zoomed out as far as it goes, the sound and a third of it again, 10.67 s,
  // 3/8 of the way across is 4 s in, where fitted to the sound it would be 3 s
  const at = async (t = 4, across = 32 / 3) => {
    const { box, x } = await axis(across)
    await page.mouse.click(x(t), box.y + tall(box) * .3)
    return (await page.locator('.time').innerText()).split(':').reduce((m, s) => m * 60 + +s, 0)
  }
  assert.ok(Math.abs(await at() - 4) < .1, 'zoomed out')
  await page.waitForTimeout(700)
  await page.reload()
  await wholeLevels().waitFor()
  await page.waitForTimeout(300)
  assert.ok(Math.abs(await at() - 4) < .1, 'as it was left')
  await write(`audio('chime.wav').crop({ at: 0, duration: 4 })`)
  await lengthIs('0:04.000')
  await page.waitForTimeout(300)
  // 5.33 s wide: 3/8 of the way across is 2 s in, where fitted it would be 1.5 s
  assert.ok(Math.abs(await at(2, 16 / 3) - 2) < .1, 'shortened: as far out as it goes')
  await write(`audio('chime.wav').speed(0.2)`)
  await lengthIs('0:40.000')
  await page.waitForTimeout(300)
  assert.ok(Math.abs(await at(10, 40) - 10) < .1, 'longer than the view: all of it')
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
// any range, clamped to the output; null once a newer one replaced it
test('engine: past what the page holds, an output comes as its peaks and spectra, each its samples\' own', async () => {
  await page.goto(origin + '/blank.html')
  const r = await page.evaluate(async () => {
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
    const long = await check(await run(await tone('long.wav', 96096))), kept = await check(await run(`audio('long.wav').gain(-1)`))
    const edges = [[-10, 300], [96091, 96200], [10, 10]].map(([a, b]) => e.samples(kept.id, a, b).then(x => x?.map(c => c.length)))
    const even = await check(await run(await tone('even.wav', 25600))), short = await check(await run(`audio.from(t => Math.sin(t * 3000), { duration: .5, sampleRate: 48000 })`))
    return { long, kept, edges: await Promise.all(edges), even, short, gone: await e.samples(long.id, 0, 10) }
  })
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

// History as Photoshop's: a card chosen rolls the output back to it; an edit made then goes in right after it, its card
// chosen; undone, the card chosen before is chosen again; redone, the edit's card
test('editor: an edit made rolled back to a card, undone and redone, brings back the card chosen with it', async () => {
  await open()
  await noCues()
  await write(`audio('chime.wav')\n  .gain(-3)\n  .reverse()\n  .highpass(80)`)
  await lengthIs('0:08.000')
  await tab('Edits')
  const card = name => page.locator('.steps-list .step', { has: page.locator('.step-name', { hasText: new RegExp(`^${name}$`) }) })
  await card('Gain').locator('.step-toggle').click()
  await page.locator('.viewing', { hasText: 'Up to Gain: 2 later steps bypassed' }).waitFor()
  const { box, x } = await axis(8), y = box.y + tall(box) * .3
  await drag([x(2), y], [x(3) - x(2), 0])
  await page.keyboard.press('Delete')
  await page.waitForFunction(() => /\.gain\(-3\)\s*\.remove\([^)]*\)\s*\.reverse\(\)\s*\.highpass\(80\)$/.test(scriptText().trim()))
  await page.locator('.viewing', { hasText: 'Up to Remove: 2 later steps bypassed' }).waitFor()
  assert.ok(await card('Remove').evaluate(el => el.classList.contains('chosen')), 'the edit\'s card chosen')
  await page.keyboard.press('ControlOrMeta+Z')
  await page.waitForFunction(() => scriptText().includes('.reverse()') && !scriptText().includes('.remove('))
  await page.locator('.viewing', { hasText: 'Up to Gain: 2 later steps bypassed' }).waitFor()
  assert.ok(await card('Gain').evaluate(el => el.classList.contains('chosen')), 'its card chosen again')
  await page.keyboard.press('ControlOrMeta+Shift+Z')
  await page.waitForFunction(() => scriptText().includes('.remove('))
  await page.locator('.viewing', { hasText: 'Up to Remove: 2 later steps bypassed' }).waitFor()
})

// A card dragged up or down takes its step there in the chain; a step bypassed keeps its card where it is, as tall, open
// if it was, the output whole; its settings set in its comment, nothing run, till it is back on
test('editor: a card dragged takes its step along the chain; one bypassed stays where it is, as it was', async () => {
  await page.addInitScript(() => { const post = Worker.prototype.postMessage; window.runs = 0; Worker.prototype.postMessage = function (m, ...r) { if (m?.type === 'run') runs++; return post.call(this, m, ...r) } })
  await open()
  await write(`audio('chime.wav')\n  .gain(-3)\n  .reverse()\n  .highpass(80)`)
  await lengthIs('0:08.000')
  await tab('Edits')
  const card = name => page.locator('.steps-list .step', { has: page.locator('.step-name', { hasText: new RegExp(`^${name}$`) }) })
  const names = () => page.locator('.step-name').allInnerTexts()
  const from = await card('Highpass').locator('.step-toggle').boundingBox(), to = await card('Gain').locator('.step-toggle').boundingBox()
  await page.mouse.move(from.x + 40, from.y + from.height / 2)
  await page.mouse.down()
  await page.mouse.move(from.x + 40, to.y + 2, { steps: 8 })
  await page.mouse.up()
  await page.waitForFunction(() => /\.highpass\(80\)\s*\.gain\(-3\)\s*\.reverse\(\)$/.test(scriptText().trim()))
  assert.deepEqual(await names(), ['chime.wav', 'Highpass', 'Gain', 'Reverse'])
  assert.equal(await page.locator('.viewing').count(), 0, 'a drag is no click: nothing chosen')
  // chosen, then bypassed: in place, open, dimmed
  await card('Gain').locator('.step-toggle').click()
  await page.locator('.viewing', { hasText: 'Up to Gain: ' }).waitFor()
  const box = await card('Gain').boundingBox()
  await card('Gain').hover()
  await page.getByRole('button', { name: 'Turn gain off' }).click()
  await page.waitForFunction(() => scriptText().includes('// .gain(-3)'))
  assert.deepEqual(await names(), ['chime.wav', 'Highpass', 'Gain', 'Reverse'])
  assert.ok(await card('Gain').evaluate(el => el.classList.contains('open') && el.classList.contains('chosen') && el.classList.contains('off')), 'open, chosen, off')
  assert.deepEqual(await card('Gain').boundingBox(), box, 'where it was, as tall')
  await page.locator('.viewing').waitFor({ state: 'detached' })
  // set while bypassed: into its comment, nothing run
  const ran = await page.evaluate(() => runs), slider = card('Gain').locator('input[type=range]').first()
  await slider.evaluate(el => { el.value = 700; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })) })
  await page.waitForFunction(() => /^  \/\/ \.gain\(-?[\d.]+\)$/m.test(scriptText()) && !scriptText().includes('.gain(-3)'))
  await page.waitForTimeout(300)
  assert.equal(await page.evaluate(() => runs), ran, 'nothing run')
  assert.ok(await card('Gain').evaluate(el => el.classList.contains('open') && el.classList.contains('off')), 'open, off')
  assert.equal(await page.locator('.viewing').count(), 0, 'the output whole')
  await card('Gain').hover()
  await page.getByRole('button', { name: 'Turn gain on' }).click()
  await page.waitForFunction(() => /^  \.gain\(-?[\d.]+\)$/m.test(scriptText()) && !scriptText().includes('//'))
  await page.locator('.viewing', { hasText: 'Up to Gain: ' }).waitFor()
  assert.ok(await page.evaluate(n => runs > n, ran), 'back on, it runs')
})

// A marker's triangle dragged moves the marker alone: the caret stays where it was, and what plays plays on, not from
// the marker; clicked, the caret goes to it
test('editor: a marker dragged moves alone, the caret and what plays staying where they are', async () => {
  await open()
  await noCues()
  await write(`audio('chime.wav').mark(2)`)
  await lengthIs('0:08.000')
  const { box, x } = await axis(8), y = box.y + tall(box) * .3, row = box.y + tall(box) + FOOT / 2
  const now = async () => +(await page.locator('.time').innerText()).split(':')[1]
  await page.mouse.click(x(6), y)
  await drag(await grab([[x(2), row]], 'ew-resize'), [x(3) - x(2), 0])
  await page.waitForFunction(() => +(scriptText().match(/\.mark\(([\d.]+)\)/)?.[1]) > 2.9)
  assert.equal(await now(), 6, 'the caret where it was')
  // playing from the start: dragged back, the marker moves, the playhead goes on from where it was
  await page.mouse.click(x(.2), y)
  await page.keyboard.press('Space')
  await page.getByRole('button', { name: 'Pause' }).waitFor()
  await drag(await grab([[x(3), row]], 'ew-resize'), [x(5) - x(3), 0])
  await page.waitForFunction(() => +(scriptText().match(/\.mark\(([\d.]+)\)/)?.[1]) > 4.9)
  assert.ok(await now() < 2.5, `played on from the start, not from the marker: ${await now()}`)
  await page.keyboard.press('Space')
  // clicked: the caret to it
  await page.mouse.click(...await grab([[x(5), row]], 'ew-resize'))
  assert.ok(Math.abs(await now() - 5) < .05, String(await now()))
})

// More tabs than fit keep their width and scroll, as a code editor's: the one shown in sight, the wheel moving them along,
// no scrollbar, a side with more past it faded
test('editor: tabs keep their width and scroll, the one shown in sight', async () => {
  await page.setViewportSize({ width: 900, height: 700 })
  await open()
  for (let i = 0; i < 12; i++) await page.getByRole('button', { name: 'New tab' }).click()
  const strip = page.locator('.files-list')
  const { scroll, client } = await strip.evaluate(e => ({ scroll: e.scrollWidth, client: e.clientWidth }))
  assert.ok(scroll > client, 'more than fit: they scroll')
  const widths = await page.locator('.file').evaluateAll(l => l.map(e => e.getBoundingClientRect().width))
  assert.ok(Math.min(...widths) > 60, `none squeezed: ${Math.min(...widths)}`)
  const sight = () => page.locator('.file.current').evaluate(e => { const r = e.getBoundingClientRect(), s = e.parentElement.getBoundingClientRect(); return r.left >= s.left - 1 && r.right <= s.right + 1 })
  await page.waitForTimeout(100)
  assert.ok(await sight(), 'the one shown, the last made, in sight')
  assert.equal(await strip.evaluate(e => e.offsetHeight - e.clientHeight), 0, 'no scrollbar')
  await page.waitForFunction(() => document.querySelector('.files-list').dataset.more === 'start')
  await strip.hover()
  await page.mouse.wheel(0, -4000)
  await page.waitForFunction(() => document.querySelector('.files-list').scrollLeft === 0)
  await page.waitForFunction(() => document.querySelector('.files-list').dataset.more === 'end')
  await page.locator('.file [role="tab"]').first().click()
  await page.waitForTimeout(100)
  assert.ok(await sight())
})

// A take is mono, the input's first channel, as a recorder takes a voice; the settings record stereo
test('editor: a recording is mono, unless the settings say stereo', async () => {
  await open()
  await write('')
  await page.locator('.empty').waitFor()
  await recordFor(1)
  await page.locator('.plot').focus()
  await page.keyboard.press('Space')
  await page.waitForFunction(() => scriptText().startsWith("audio('recording.wav')"))
  await wholeLevels().waitFor()
  // as it was written down, 32-bit float
  assert.match(await facts(), / mono 32-bit$/)
  await settings('Record in', 'Stereo')
  await page.reload()
  await tab('Settings')
  assert.equal(await choice('Record in', 'Stereo').getAttribute('aria-pressed'), 'true', 'kept')
})

// The edits as a layers panel: rows picked with Shift made a group (⌘G), open, its steps set in under its name; the
// name double-clicked, named anew; a step dragged by a step of it goes into it, out by one outside; the group dragged
// whole; ⇧⌘G unmakes it. Each one step of the history
test('editor: the edits as layers: picked rows grouped, named, dragged in and out, the group moved whole, unmade', async () => {
  await open()
  await write(`audio('chime.wav')\n  .gain(-3)\n  .reverse()\n  .highpass(80)\n  .fade(1)`)
  await lengthIs('0:08.000')
  await tab('Edits')
  const row = name => page.locator('.steps-list .step', { has: page.locator('.step-name', { hasText: new RegExp(`^${name}$`) }) })
  const names = () => page.locator('.steps-list .step:not([hidden]) .step-name').allInnerTexts()
  await row('Reverse').locator('.step-toggle').click()
  await row('Highpass').locator('.step-toggle').click({ modifiers: ['Shift'] })
  assert.ok(await row('Highpass').evaluate(el => el.classList.contains('picked')))
  await page.keyboard.press('ControlOrMeta+G')
  await page.waitForFunction(() => scriptText().includes('  // Group\n    .reverse()\n    .highpass(80)\n  .fade(1)'))
  assert.deepEqual(await names(), ['chime.wav', 'Gain', 'Group', 'Reverse', 'Highpass', 'Fade'], 'open, its steps under it')
  // named anew
  await row('Group').locator('.step-toggle').dblclick()
  await page.locator('.step-rename').fill('Montage')
  await page.keyboard.press('Enter')
  await page.waitForFunction(() => scriptText().includes('// Montage'))
  // a step dragged onto one of its steps goes in, set in as they are
  const drag = async (name, onto, below = true) => {
    const a = await row(name).locator('.step-toggle').boundingBox(), b = await row(onto).locator('.step-toggle').boundingBox()
    await page.mouse.move(a.x + 30, a.y + a.height / 2)
    await page.mouse.down()
    await page.mouse.move(a.x + 30, below ? b.y + b.height - 2 : b.y + 2, { steps: 10 })
    await page.mouse.up()
  }
  await drag('Fade', 'Reverse', false)
  await page.waitForFunction(() => scriptText().includes('  // Montage\n    .fade(1)\n    .reverse()\n    .highpass(80)'))
  // the group dragged whole, above the gain
  await drag('Montage', 'Gain', false)
  await page.waitForFunction(() => /audio\('chime\.wav'\)\n  \/\/ Montage\n    \.fade\(1\)\n    \.reverse\(\)\n    \.highpass\(80\)\n  \.gain\(-3\)$/.test(scriptText()))
  // unmade, from the menu as from ⇧⌘G
  await row('Reverse').locator('.step-toggle').click()
  await menu('Edit', 'Ungroup')
  await page.waitForFunction(() => scriptText() === `audio('chime.wav')\n  .fade(1)\n  .reverse()\n  .highpass(80)\n  .gain(-3)`)
  await menu('Edit', 'Undo')
  await page.waitForFunction(() => scriptText().includes('// Montage'))
})

// A layer's chevron, before its icon, turns down while it is open (a step's settings shown, a group unfolded). Its menu,
// right-clicked: muted and back on, moved, grouped, the chain up to it made one sound (a file kept as a take is, the
// script opening it, its marks marked on it again, the steps after it going on from it), one step of the history each
test('editor: layers: a chevron while open; a row\'s menu mutes, moves, groups and flattens the chain up to it', async () => {
  await open()
  await write(`audio('chime.wav')\n  .gain(-3)\n  .mark(1, 'one')\n  .reverse()\n  .highpass(80)`)
  await lengthIs('0:08.000')
  await tab('Edits')
  const row = name => page.locator('.steps-list .step', { has: page.locator('.step-name', { hasText: new RegExp(`^${name}$`) }) })
  // turned as it settles (it turns over a moment)
  const turned = (name, to) => row(name).locator('.step-chevron').evaluate((el, to) => new Promise(done => { const look = () => getComputedStyle(el).rotate === to ? done(true) : requestAnimationFrame(look); look(); setTimeout(() => done(false), 1000) }), to)
  assert.ok(await turned('Reverse', 'none'))
  await row('Reverse').locator('.step-toggle').click()
  assert.ok(await turned('Reverse', '90deg'), 'open: turned down')
  assert.equal(await row('chime.wav').locator('.step-chevron').evaluate(el => getComputedStyle(el).visibility), 'hidden', 'the sound opens to nothing')
  const rowMenu = async (name, item) => { await row(name).locator('.step-toggle').click({ button: 'right' }); await contextRow(item).click() }
  await rowMenu('Highpass', 'Mute')
  await page.waitForFunction(() => scriptText().includes('// .highpass(80)'))
  await rowMenu('Highpass', 'Unmute')
  await page.waitForFunction(() => scriptText().includes('\n  .highpass(80)'))
  await rowMenu('Reverse', 'Move up')
  await page.waitForFunction(() => /\.gain\(-3\)\n  \.mark\(1, 'one'\)\n  \.reverse\(\)/.test(scriptText()) || /\.gain\(-3\)\n  \.reverse\(\)\n  \.mark/.test(scriptText()))
  await rowMenu('Highpass', 'Group')
  await page.waitForFunction(() => scriptText().includes('  // Group\n    .highpass(80)'))
  // the chain up to Reverse, one sound: a file of its own, its mark on it again, the steps after it from it
  await rowMenu('Reverse', 'Flatten up to here')
  await page.waitForFunction(() => /^audio\('chime-flat\.wav'\)/.test(scriptText()))
  assert.match(await code(), /^audio\('chime-flat\.wav'\)\n  \.mark\(1, 'one'\)\n  \/\/ Group\n    \.highpass\(80\)$/)
  await lengthIs('0:08.000')
  const kept = await page.evaluate(async () => { const d = await (await navigator.storage.getDirectory()).getDirectoryHandle('audio-repl-files'); const names = []; for await (const k of d.keys()) names.push(decodeURIComponent(k)); return names })
  assert.ok(kept.includes('chime-flat.wav'), 'kept as a take is')
  await rowMenu('Highpass', 'Flatten all')
  await page.waitForFunction(() => /^audio\('chime-flat-2\.wav'\)\n  \.mark\(1, 'one'\)$/.test(scriptText()))
  await menu('Edit', 'Undo')
  await page.waitForFunction(() => /^audio\('chime-flat\.wav'\)\n  \.mark\(1, 'one'\)\n  \/\/ Group/.test(scriptText()))
})

// The page in the Mac app (desktop/app.js, put in as the shell puts it): the app told the panels, each with its button's
// icon as the page draws it, and the menus, each item with its icon drawn as the page's menus draw it (icons.js glyph),
// none where it has none, so the toolbar and the menu bar wear the page's icons and no set of their own; an item
// picked in the app's menu runs here
// In the Mac app, as a DAW: the microphone opened as the page opens, nothing pressed, its permission asked then, and
// kept, the page hidden too (sources.js hold), so a take starts on the next block
test('desktop: the microphone opens as the app opens and stays open', async () => {
  await page.addInitScript(() => {
    const md = navigator.mediaDevices, ask = md.getUserMedia.bind(md)
    window.__asked = []
    md.getUserMedia = async c => { const s = await ask(c); window.__asked.push(s); return s }
  })
  await page.goto(origin + '/playground/?desktop')
  await page.waitForFunction(() => window.__asked.length === 1 && window.__asked[0].getAudioTracks()[0].readyState === 'live', null, { timeout: 15000 })
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange')) })
  await page.waitForTimeout(300)
  assert.equal(await page.evaluate(() => window.__asked[0].getAudioTracks()[0].readyState), 'live', 'hidden, still open')
  assert.equal(await page.evaluate(() => window.__asked.length), 1, 'asked once')
})

test('desktop: the app is told the panels and the menus with the page\'s own icons; an item picked there runs here', async () => {
  await page.addInitScript(() => {
    globalThis.__told = []
    globalThis.webkit = { messageHandlers: { app: { postMessage: m => __told.push(JSON.parse(JSON.stringify(m))) } } }
  })
  // the page as the app opens it (?desktop): laid out for it from the first paint, its bar and its panels' buttons the
  // app's own; the bridge to the app (desktop/app.js) the page's to load
  await page.goto(origin + '/playground/?desktop')
  await wholeLevels().waitFor({ state: 'attached' })
  assert.deepEqual(await page.evaluate(() => [document.documentElement.classList.contains('desktop'), ...['.app > .bar', '.panes > .side-head'].map(s => getComputedStyle(document.querySelector(s)).display)]), [true, 'none', 'none'])
  await page.waitForFunction(() => __told.some(m => m.menus && m.toolbar?.length))
  const { told, panels, drawn } = await page.evaluate(async () => {
    const { glyph } = await import('/playground/icons.js')
    const walk = items => items.filter(it => it !== '-' && !it.group).map(it => ({ label: it.label, icon: it.icon ? glyph(it.icon) : '', ...it.items && { items: walk(it.items) } }))
    const shape = items => items.filter(it => !it.separator && !it.group).map(it => ({ label: it.label, icon: it.icon, ...it.items && { items: shape(it.items) } }))
    const told = __told.findLast(m => m.menus)
    return {
      told: { toolbar: told.toolbar.map(({ label, icon }) => ({ label, icon })), menus: told.menus.map(m => shape(m.items)) },
      panels: [...document.querySelectorAll('.side-head .panels button[role="tab"]')].map(b => ({ label: b.getAttribute('aria-label'), icon: b.querySelector('svg').outerHTML })),
      drawn: document.querySelector('.menubar').menus().map(m => walk(m.items))
    }
  })
  assert.deepEqual(told.toolbar, panels, 'each panel, its button\'s icon')
  assert.ok(panels.length >= 6 && panels.every(p => /<path d="[^"]+"/.test(p.icon)))
  assert.deepEqual(told.menus, drawn, 'each item\'s icon as the page\'s menus draw it, none where it has none')
  const icons = told.menus.flat(Infinity).flatMap(function all(it) { return [it, ...(it.items ?? []).flatMap(all)] }).filter(it => it.icon)
  assert.ok(icons.length >= 11, 'the Process menu\'s kinds at least, an icon each')
  // View › Waveform options › Colormap › Magma, picked in the app's menu
  const id = await page.evaluate(() => {
    const menus = __told.findLast(m => m.menus).menus, find = (items, label) => items.find(it => it.label === label)
    return find(find(find(menus.find(m => m.name === 'View').items, 'Waveform options').items, 'Colormap').items, 'Magma').id
  })
  await page.evaluate(id => audioHost.run(id), id)
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('audio-repl') || '{}').wave?.map === 'magma')
})

// The embed before its frame shows: a skeleton of the playground's parts where they will be, laid out from the
// element's size and its panel, its text out of sight; gone once the frame's sound is in
test('editor: embedded, a skeleton of its parts holds their places till its sound is in', async () => {
  await page.goto(origin + '/blank.html')
  // the frames held back till the skeletons are read
  let release
  const held = new Promise(r => release = r)
  await page.route('**/playground/?embed*', async route => { await held; await route.continue() })
  await page.evaluate(async () => {
    await import('/playground/embed.js')
    document.body.innerHTML = `<audio-repl panel="none" height="320" style="width: 742px"><pre><code>audio('chime.wav')</code></pre></audio-repl><audio-repl panel="code" height="420" style="width: 736px"><pre><code>audio('chime.wav')</code></pre></audio-repl>`
  })
  await page.waitForFunction(() => [...document.querySelectorAll('audio-repl .wait')].every(w => w.childElementCount))
  // the picture alone, or with its panel beside it; every part inside the element; the text not shown
  const look = await page.evaluate(() => [...document.querySelectorAll('audio-repl')].map(el => {
    const box = el.getBoundingClientRect(), parts = [...el.querySelectorAll('.wait i')].map(i => i.getBoundingClientRect())
    return { text: getComputedStyle(el.querySelector('pre')).display, parts: parts.length, areas: el.querySelectorAll('.wait i.area').length, inside: parts.every(b => b.width > 0 && b.height > 0 && b.left >= box.left && b.right <= box.right && b.top >= box.top && b.bottom <= box.bottom) }
  }))
  assert.deepEqual(look, [{ text: 'none', parts: 7, areas: 1, inside: true }, { text: 'none', parts: 8, areas: 2, inside: true }])
  release()
  await page.waitForFunction(() => [...document.querySelectorAll('audio-repl')].every(el => 'ready' in el.dataset && !el.querySelector('.wait')), null, { timeout: 30000 })
  await page.unroute('**/playground/?embed*')
})
