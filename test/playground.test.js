// Editor: npm run test:playground. The engine runs in a real browser worker; its output is compared with the library in Node,
// the command-line translation with the CLI itself. All requests stay local.
import { test, before, after, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { readFile, readdir, writeFile, mkdtemp, rm } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { homedir, tmpdir } from 'node:os'
import { extname, join, resolve, sep } from 'node:path'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import wav from '@audio/encode-wav'
import audio from '../audio.js'
import { prepare, error, chain, append, source, callAt, setArg, cli, groups, steps, dropStep, moveStep, moveLines, group, ungroup, renameGroup, turnOff, turnOn, tracks, focus, toTrack, voiceTrack, soundOf, addTrack, dropTrack, rollback, stages } from '../playground/code.js'
import { ops, guides, previews, SCALES } from '../playground/ops.js'
import { SCALES as NOTE_SCALES, snapMidi } from '@audio/note'
import { help, layout, layouts, texts } from '../playground/help.js'
import { boxed } from '../playground/heard.js'
import opIcons from '../playground/icons.js'
import clock from '../playground/time.js'
import { samples, RATE as SAMPLES } from '../site/samples.js'
import { vowel } from './gen.js'
import recipes from '../playground/recipes.js'
import { cycle, trace, ballistics } from '../playground/meters.js'
import md from '../playground/markdown.js'
import doing, { measures, noted } from '../playground/doing.js'
import '../.site-build.js'

const root = fileURLToPath(new URL('..', import.meta.url)).replace(/\/$/, '')
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.wasm': 'application/wasm' }
let server, browser, page, origin, errors

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
    const path = resolve(root, '.' + (url === '/' ? '/playground.html' : url))
    if (!path.startsWith(root + sep)) { res.writeHead(403).end(); return }
    try { res.writeHead(200, { 'content-type': types[extname(path)] || 'application/octet-stream' }).end(await readFile(path)) }
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
  // the page opens with its panel closed, the picture whole: the code is written through its panel (write), and a test of
  // a panel opens it
  await page.addInitScript(() => {
    // the script, its lines as the editor has them, the code panel open or not
    globalThis.scriptText = () => [...document.querySelectorAll('.cm-content .cm-line')].map(l => l.textContent).join('\n')
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
  assert.deepEqual(doing('select', { at: 1, d: 2, low: 3000, high: 4000 }, { time }), { now: 'Selecting 1s–3s, 3 kHz–4 kHz', then: 'Selected 1s–3s, 3 kHz–4 kHz', show: { range: [1, 3], band: [3000, 4000] } })
  assert.deepEqual(doing('edit', { call: "normalize('podcast')" }).show, { edit: "normalize('podcast')" })
  assert.deepEqual(doing('scrub', { at: 1, to: 3 }, { time }), { now: 'Scrubbing 1s–3s', then: 'Scrubbed 1s–3s', show: { caret: 3 } })
  assert.equal(doing('step', { index: 2, to: 0 }).then, 'Moved edit 3 to 1')
  assert.equal(doing('step', { index: 0, on: false }).then, 'Turned off edit 1')
  assert.equal(doing('open', { path: '/Users/me/voice.wav' }).then, 'Opened voice.wav')
})

// What a call came to, said beside its step: values in their units, a series by its span, an edit by the output after it
test('doing: what a call came to, from what the page answered', () => {
  assert.equal(noted('measure', { code: "out.stat(['loudness', 'truepeak'])" }, [-21.123, -0.913]), '−21.12 LUFS, −0.91 dBTP')
  assert.equal(noted('measure', { code: "out.stat('loudness', { bins: 4 })" }, [-20, -21, '-Infinity', -19]), '4 values, −21\u00a0to\u00a0−19\u00a0LUFS', 'silence left out of the span, the span held together')
  assert.equal(noted('measure', { code: "out.stat('db')" }, '-Infinity'), '−∞ dBFS')
  assert.equal(noted('measure', { code: 'out.duration' }, 6.524), '6.52')
  assert.equal(noted('measure', { code: 'out.silence()' }, [{ at: 1, duration: .5 }]), '[{"at":1,"duration":0.5}]')
  assert.equal(noted('measure', { code: 'x' }, 'a'.repeat(80)).length, 60, 'long, cut')
  assert.equal(noted('measure', { code: 'x' }, undefined), '')
  assert.equal(noted('edit', { call: 'gain(-3)' }, { ok: true, duration: 6, loudness: -16.04, peak: -1 }), 'now −16.04 LUFS, peak −1 dBFS')
  assert.equal(noted('edit', { call: 'nope()' }, { ok: false, problem: 'nope is not a function' }), 'nope is not a function')
  assert.equal(noted('check', { spec: 'podcast' }, { pass: false, rules: [{ name: 'Loudness', pass: false }, { name: 'True peak', pass: true }] }), 'fails loudness')
  assert.equal(noted('check', { spec: 'podcast' }, { pass: true, rules: [] }), 'passes')
  assert.equal(noted('play', {}, { playing: true }), '')
  assert.equal(noted('state', {}, { duration: 6.4, sampleRate: 44100, channels: 2 }), '6.4 s, 2 ch, 44.1 kHz')
  assert.equal(noted('state', {}, { duration: 0, sampleRate: null, channels: null, problem: null }), 'no sound open', 'a new tab: no sound, not "null ch"')
  assert.equal(noted('state', {}, { duration: 0, sampleRate: null, channels: null, problem: 'nope is not defined' }), 'nope is not defined', 'a script that fails: why')
  assert.equal(noted('measure', { code: 'x' }, { nf: -49.3 }, [{ of: 'out', name: 'noisefloor', opts: {}, value: -49.30758 }]), '−49.31 dBFS', 'one stat noted: its value, whatever the answer')
  assert.equal(noted('measure', { code: 'x' }, { a: 1, b: 2 }, [{ name: 'db', value: -1 }, { name: 'lra', value: 4 }]), '', 'several: the table says them')
})

// What a measure measured, stat by stat as the page noted it (worker.js evaluate), as rows: its name, where it was taken,
// its value as the page writes it. Peak and RMS are sample values (stats.js), their dBFS is db
test('doing: what a measure measured, stat by stat, its rows', () => {
  const time = t => `${t}s`, row = (name, value, opts = {}, of = 'out') => measures([{ of, name, opts, value }], { time })[0]
  assert.deepEqual(row('loudness', -27.20224), { name: 'Loudness', after: '−27.2 LUFS' })
  assert.deepEqual(row('truepeak', -14.659), { name: 'True peak', after: '−14.66 dBTP' })
  assert.deepEqual(row('noisefloor', -51.57, {}, 'src'), { name: 'Noise floor, original', after: '−51.57 dBFS' })
  assert.deepEqual(row('peak', .30049), { name: 'Peak', after: '0.3' })
  assert.deepEqual(row('correlation', 1), { name: 'Stereo correlation', after: '1' })
  assert.deepEqual(row('centroid', 2079.7), { name: 'Brightness', after: '2.08 kHz' })
  assert.deepEqual(row('loudness', [-20, -21, '-Infinity', -19, 'NaN'], { bins: 5 }), { name: 'Loudness over time', after: '5 values, −21\u00a0to\u00a0−19\u00a0LUFS' })
  assert.deepEqual(row('db', -3, { at: 1, d: 2, channel: 0 }), { name: 'Peak, 1s–3s, channel 1', after: '−3 dBFS' })
  assert.deepEqual(row('spectrum', Array(64).fill(-40), { bins: 64 }), { name: 'Spectrum', after: '64 bands' })
  assert.deepEqual(row('silence', [{ at: 1, duration: .5 }, { at: 3, duration: 1.25 }]), { name: 'Pauses', after: '2, the longest 1.25 s' })
  assert.deepEqual(row('silence', []), { name: 'Pauses', after: 'none' })
  assert.deepEqual(row('clipping', []), { name: 'Clipping', after: 'none' })
  assert.deepEqual(row('onsets', [0, 1.5]), { name: 'Onsets', after: '2' })
  assert.deepEqual(row('key', { tonic: 9, mode: 'minor', label: 'Am' }), { name: 'Key', after: 'Am' })
  assert.deepEqual(row('detect', { bpm: 120, beats: [0, .5] }), { name: 'Tempo', after: '120 BPM' })
  assert.deepEqual(row('replaygain', { gain: -6.0876, lufs: -11.9 }), { name: 'ReplayGain', after: '−6.09 dB' })
  assert.deepEqual(row('notes', [{ midi: 64, note: 'E4' }, { midi: 57, note: 'A3' }]), { name: 'Notes', after: '2, A3 to E4' })
  assert.deepEqual(row('melody', { times: [0, 1, 2], f0: [220, 0, 440], voiced: [true, false, true] }), { name: 'Melody', after: '220 Hz to 440 Hz' })
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
// A range moved to a track of its own: its chain as it stands, cropped and put back at its time; silence where it was.
// The voice split to one: the model's voice there, the rest here
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
  assert.equal(made.code, `let chime = audio('chime.wav')\n  .trim()\n  .normalize(-1)\n  .gain(-Infinity, { at: 0.5, d: 0.25 })\n\nlet chime2 = audio('chime.wav')\n  .trim()\n  .normalize(-1)\n  .crop({ at: 0.5, d: 0.25 })\n  .pad(0.5, 0)`)
  assert.equal(toTrack(`audio('chime.wav')`, { at: '0', d: '1' }).code, `let chime = audio('chime.wav')\n  .gain(-Infinity, { at: 0, d: 1 })\n\nlet chime2 = audio('chime.wav')\n  .crop({ at: 0, d: 1 })`, 'from the start: no pad')
  assert.equal(toTrack(`let a = audio('a.wav')\na.gain(-3)`, { at: '0', d: '1' }), null, 'a chain on a name: no sound of its own')
  // the voice split to a track of its own: the model's voice there, the rest here, the chain as it stood under both
  const sung = voiceTrack(one)
  assert.equal(sung.name, 'voice')
  assert.equal(sung.code, `let chime = audio('chime.wav')\n  .trim()\n  .normalize(-1)\n  .vocals('remove', { model: 'mel-roformer' })\n\nlet voice = audio('chime.wav')\n  .trim()\n  .normalize(-1)\n  .vocals({ model: 'mel-roformer' })`)
  assert.deepEqual(names(voiceTrack(sung.code).code), ['chime', 'voice', 'voice2'], 'again: the voice, the last, split, named on')
  assert.equal(voiceTrack(`let a = audio('a.wav')\na.gain(-3)`), null, 'a chain on a name: no sound of its own')
  // a track's sound on one line, for another to line up with: its steps turned off left out, no name read
  assert.equal(soundOf(sung.code, 'voice'), `audio('chime.wav').trim().normalize(-1).vocals({ model: 'mel-roformer' })`)
  assert.equal(soundOf(`let a = await audio('a .wav')\n  // .fade(1)\n  .gain(-3) /* .trim() */  .reverse()\n\nlet b = audio('b.wav')`, 'a'), `audio('a .wav').gain(-3).reverse()`)
  assert.equal(soundOf(sung.code, 'nothing'), null)
  try {
    // the first edited: its steps, an edit joining it, rolled back with the other kept, a measure's stages of it alone
    focus('chime')
    const two = made.code
    assert.deepEqual(steps(two).map(s => s.text), ['.trim()', '.normalize(-1)', '.gain(-Infinity, { at: 0.5, d: 0.25 })'])
    assert.equal(apply(two, append(two, 'reverse()')), two.replace('0.25 })\n\n', '0.25 })\n  .reverse()\n\n'))
    assert.equal(rollback(two, 1), two.replace(`  .normalize(-1)\n  .gain(-Infinity, { at: 0.5, d: 0.25 })\n\n`, '\n'))
    assert.ok(stages(two).every(s => s.before.endsWith('\nchime') && s.after.endsWith('\nchime')))
    // again: the next piece right under it, named on
    assert.deepEqual(names(toTrack(two, { at: '1', d: '0.5' }).code), ['chime', 'chime3', 'chime2'])
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
    assert.equal(apply(two, dropTrack(two, 'chime2')), `let chime = audio('chime.wav')\n  .trim()\n  .normalize(-1)\n  .gain(-Infinity, { at: 0.5, d: 0.25 })`)
    assert.equal(apply(off, dropTrack(off, 'a')), `let b = audio('b.wav')\n  // .gain(-3)\n  .reverse()`)
    assert.equal(dropTrack(one, 'chime'), null)
    const three = `let a = audio('a.wav')\n\nlet b = audio('b.wav')\n  .gain(-3)\n\nlet c = audio('c.wav')`
    assert.equal(apply(three, dropTrack(three, 'b')), `let a = audio('a.wav')\n\nlet c = audio('c.wav')`, 'one between others')
  } finally { focus(null) }
  // none edited: the last
  assert.equal(chain(made.code).declared, 'chime2')
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
const readout = () => page.locator('.readout').innerText()
// The output's length, from the name's tooltip ("chime.wav · 0:06.525"): the axes show it, so the page doesn't repeat it
const lengthText = () => page.evaluate(() => document.querySelector('.source').title.split(' · ').pop())
const seconds = async () => { const [m, s] = (await lengthText()).split(':'); return +m * 60 + +s }
async function open() {
  await page.goto(origin + '/playground.html')
  await page.locator('.readout', { hasText: 'LUFS' }).waitFor()
}
// A row of the menu open, by its label, exactly
const menuRow = label => page.locator('.menubar-menu .menu-row', { has: page.locator('.menu-label', { hasText: new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`) }) }).last()
// A choice in a dropdown open (the settings, a picture's options), by its group's name and its own
const choice = (group, name) => page.locator('.dropdown').getByRole('group', { name: group, exact: true }).getByRole('button', { name, exact: true })
// A choice in the settings, a dropdown under their button over the meter, closed again after
async function settings(group, name) {
  const button = page.getByRole('button', { name: 'Settings', exact: true })
  await button.click()
  await choice(group, name).click()
  await button.click()
}
// What is selected, as the clock's title says it ("0:01.000–0:03.000"; '' for none, or several ranges): the clock
// itself reads the caret
const selected = async () => (await page.locator('.clock').getAttribute('title')).match(/^Selected (\S+–\S+):/)?.[1] ?? ''
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
const noCues = async () => { await menu('View', 'Cues'); await menu('View', 'Snap to cues and markers') }
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
  assert.equal(await facts(), '44.1kHz stereo')
  assert.match(await readout(), /^peak −1\.0dBFS −\d+\.\dLUFS$/)
  assert.ok(await drawn() > .05, 'the waveform covers the plot')
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
  await page.locator('.readout', { hasText: 'peak −18.0dBFS' }).waitFor()
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
  assert.match(await rows.first().getAttribute('title'), /^Detection threshold\. .*\n2× to 30×, default 8×$/s)
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
  assert.match(await mode.getAttribute('title'), /^downward turns quiet sound/)
  await mode.getByRole('button', { name: 'upward' }).click()
  await page.waitForFunction(() => /expander\(\{ mode: 'upward' \}\)/.test(scriptText()))
  // a choice of an edit with none folded says what it decides too, its values on the keys
  await write(`audio('chime.wav').compressor().highpass(80)`)
  await reopen('Highpass')
  assert.match(await page.locator('.step.open .param', { hasText: 'order' }).getAttribute('title'), /^Steepness\. /)
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
  const { box, x } = await axis(6.525), y = box.y + box.height * .3
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
  await page.locator('.readout', { hasText: 'LUFS' }).waitFor()
  assert.equal(await page.locator('.message.problem').count(), 0)
})

// Over the picture: its tabs, undo and redo, how it shows (the waveform, the spectrogram), then at the head of its axis
// its settings, none moving as the picture turns. At the slab's top right, as an
// editor's activity bar, the panels' buttons: the recipes, the agent, the edits, the code, the export. A panel docks
// beside the picture, part of the slab, a rule between them as the slab's own, no title over it (its button says which); its button
// again closes it; its left edge drags its width; the choice and the width are remembered. Undo is undo, nothing else
test('editor: undo, redo, the picture\'s switch, its settings over its axis, none moving; the panels\' buttons at the top right; a panel docks beside the picture', async () => {
  await open()
  const box = name => page.locator(name).boundingBox()
  const [panes, view] = await Promise.all(['.panes', '.view-slab'].map(box))
  assert.ok(Math.abs(view.width - panes.width) < 2, 'the picture the whole width')
  const buttons = await Promise.all(['Recipes', 'Agent', 'Edits', 'Code', 'Export'].map(name => page.getByRole('tab', { name, exact: true }).boundingBox()))
  assert.ok(buttons.every((b, i) => b.y < view.y && (!i || b.x > buttons[i - 1].x)) && buttons.at(-1).x > panes.x + panes.width * .8, 'the panels\' buttons in order at the slab\'s top right')
  assert.equal(await page.locator('.bar .history, .status [role="tab"]').count(), 0, 'none in the page\'s bar, none at the foot')
  await tab('Edits')
  await page.locator('.stack').waitFor()
  await page.locator('.script').waitFor({ state: 'hidden' })
  assert.equal(await page.locator('.panel-head, .panel-title').count(), 0, 'no title over it: its button, lit, says which it is')
  assert.equal(await page.locator('.side-slab').getAttribute('aria-label'), 'Edits')
  const [narrow, side, plot] = await Promise.all(['.view-slab', '.side-slab', '.plot'].map(box))
  assert.ok(narrow.width < view.width - 200 && side.x >= narrow.x + narrow.width - 1 && side.y >= buttons[0].y + buttons[0].height, 'docked beside the picture, under the buttons')
  // in order: undo, redo, the switch, then the settings at the head of the axis, over its ticks (12 px from a pixel inside
  // the 40 px of labels, view.js GUTTER, TICK); none moves as the picture turns
  const heads = () => Promise.all([['button', 'Undo'], ['button', 'Redo'], ['tab', 'Waveform'], ['tab', 'Spectrogram'], ['button', 'Settings']].map(([role, name]) => page.getByRole(role, { name, exact: true }).boundingBox()))
  const [undo, redo, wave, spec, settings] = await heads()
  assert.ok(undo.x < redo.x && redo.x < wave.x && wave.x < spec.x && spec.x < settings.x && settings.y < plot.y, 'undo, redo, the switch, the settings')
  assert.ok(Math.abs(settings.x + settings.width / 2 - (plot.x + plot.width - 33)) <= 1, `the settings over the axis: ${settings.x + settings.width / 2}, ${plot.x + plot.width - 33}`)
  assert.ok(spec.x - (wave.x + wave.width) <= 2, 'the waveform and the spectrogram a pair, as undo and redo')
  await show('spec')
  assert.deepEqual((await heads()).map(b => b.x), [undo, redo, wave, spec, settings].map(b => b.x), 'nothing moved as it turned')
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
  await page.locator('.readout', { hasText: 'peak −18.0dBFS' }).waitFor()
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
  await page.locator('.readout', { hasText: 'LUFS' }).waitFor()
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
  const edges = () => pixels(`const at = px => d[(40 * w + px) * 4]; let line = 0, end = -1; for (let px = 1; px < w - 60; px++) { if (at(px) > at(line)) line = px; if (at(px) > at(px + 1) + 4) end = px } return [line, end]`)
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
  await page.locator('.readout', { hasText: 'peak −6.0dBFS' }).waitFor()
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
  const { box, x } = await axis(8), y = box.y + box.height * .3
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
  await page.waitForFunction(() => document.querySelector('.clock').title.startsWith('Selected 0:01.000–0:02.000:'))
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

// The page's state is one object literal, as are its menus' and its views': a key written twice there is silently the
// last one (the ring's share of the sound, named `progress` for a moment, took the status bar's word away), so none is
test('editor: no object literal in the page names a key twice', async () => {
  const { build } = await import('esbuild')
  const entryPoints = (await readdir(`${root}/playground`)).filter(f => f.endsWith('.js')).map(f => `${root}/playground/${f}`)
  const { warnings } = await build({ entryPoints, write: false, bundle: false, outdir: 'out', logLevel: 'silent' })
  assert.deepEqual(warnings.filter(w => w.id === 'duplicate-object-key').map(w => `${w.location.file}:${w.location.line} ${w.text}`), [])
})

// The sound's end, scrolled to the view's middle: a rule down the lanes, as the last of the grid's, the room past it
// bare
test('editor: the sound\'s end is a line down the lanes, nothing past it, no grid either', async () => {
  await open()
  const box = await page.locator('.plot').boundingBox()
  await page.mouse.move(box.x + box.width * .8, box.y + box.height * .4)
  await page.keyboard.down('Control')
  for (let i = 0; i < 3; i++) { await page.mouse.wheel(0, -120); await page.waitForTimeout(60) }
  await page.keyboard.up('Control')
  for (let i = 0; i < 12; i++) { await page.mouse.wheel(240, 0); await page.waitForTimeout(40) }
  await page.mouse.move(2, 2)
  await page.waitForTimeout(200)
  // the overlay's alpha, CSS px: the end, the one column lit all down a lane, left of the meters; then the alpha
  // summed down that lane past it
  const { end, past, inside, beyond } = await page.evaluate(() => {
    const canvas = document.querySelector('canvas.overlay'), k = canvas.width / canvas.clientWidth
    const { data, width } = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height)
    const a = (x, y) => data[(Math.round(y * k) * width + Math.round(x * k)) * 4 + 3]
    const h = canvas.clientHeight, w = canvas.clientWidth * .7, run = x => { let n = 0, most = 0; for (let y = 0; y < h; y++) most = Math.max(most, n = a(x, y) === 255 ? n + 1 : 0); return most }
    let end = -1
    for (let x = 0; x < w; x++) if (run(x) > h / 4) { end = x; break }
    let y0 = 0; while (a(end, y0) !== 255) y0++
    let y1 = y0; while (a(end, y1 + 1) === 255) y1++
    const sum = (from, to) => { let s = 0; for (let x = from; x < to; x++) for (let y = y0; y <= y1; y++) s += a(x, y); return s }
    // the grid's layer, all down the lanes, before the end and past it
    const grid = document.querySelector('canvas.grid'), g = grid.getContext('2d').getImageData(0, 0, grid.width, grid.height)
    const ruled = (from, to) => { let s = 0; for (let x = Math.round(from * k); x < Math.round(to * k); x++) for (let y = 0; y < grid.height; y++) s += g.data[(y * grid.width + x) * 4 + 3]; return s }
    return { end, past: sum(end + 1, end + 120), inside: ruled(0, end), beyond: ruled(end + 1, w) }
  })
  assert.ok(end > 0, 'a line down the lanes at the end')
  assert.equal(past, 0, 'nothing past it')
  assert.ok(inside > 0, 'the grid where the sound is')
  assert.equal(beyond, 0, 'none past its end')
})

// A touch screen's CSS pixel is rarely whole device pixels, which 1 px scanlines alias on: the slabs there are flat
test('editor: on a touch screen the slabs have no scanlines', async () => {
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true })
  const p = await phone.newPage()
  await p.goto(origin + '/playground.html')
  const [coarse, scanline] = await p.evaluate(() => [matchMedia('(pointer: coarse)').matches, getComputedStyle(document.documentElement).getPropertyValue('--color-scanline').trim()])
  await phone.close()
  assert.ok(coarse, 'the page sees a coarse pointer')
  assert.equal(scanline, 'transparent')
  assert.notEqual(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--color-scanline').trim()), 'transparent', 'with a mouse, the scanlines')
})

// The lanes ruled (Grid: Crosses + dots, the default), where the sound is quiet (2.5 to 3 s): a cross, its arms 3 px, where a
// time row's tick meets a level's; a dot where their fifths meet (2.6 s, 0.3 of full scale, between the ticks at 2.5 s
// and 3 s, 0.5 and 0); nothing halfway between those. Behind the waveform: none where a hit is (0.5 s, 0). In decibels,
// a dot every 3 dB between the ticks (−3 dB). Lines (View, Grid): a line from each tick across the lane, fainter than a
// cross, none at the finer steps. With None, or with no sound, nothing at all
test('editor: the grid crosses where the ticks meet, dots where their finer steps do, or lines from the ticks; hides behind the waveform, and is gone with None or no sound', async () => {
  await open()
  await page.mouse.move(2, 2)
  // the overlay's ticks, each followed by its label
  await page.evaluate(() => {
    window.__ticks = []
    const proto = CanvasRenderingContext2D.prototype, rect = proto.fillRect, text = proto.fillText
    proto.fillRect = function (x, y, w, h) { if (this.canvas.classList.contains('overlay')) window.__ticks.push({ x, y, w, h }); return rect.call(this, x, y, w, h) }
    proto.fillText = function (s, x, y) { if (this.canvas.classList.contains('overlay')) window.__ticks.push({ s }); return text.call(this, s, x, y) }
  })
  await settings('Grid', 'Crosses + dots')
  await page.mouse.move(2, 2)
  await page.waitForTimeout(200)
  const calls = await page.evaluate(() => window.__ticks), at = {}
  calls.forEach((c, i) => { if (c.w && calls[i + 1]?.s) at[calls[i + 1].s] ??= c.h === 1 ? c.y : c.x })
  const [hit, c0, c1, r5, r0] = [at['0:00.5'], at['0:02.5'], at['0:03.0'], at['0.5'], at['0']]
  assert.ok([hit, c0, c1, r5, r0].every(Number.isFinite), `ticks at 0.5 s, 2.5 s, 3 s, 0.5 and 0: ${JSON.stringify(at)}`)
  // the most a 3 × 3 px square round each point is lit, CSS px on the grid's layer
  const lit = points => page.evaluate(points => {
    const canvas = document.querySelector('canvas.grid'), g = canvas.getContext('2d'), k = canvas.width / canvas.clientWidth
    return points.map(([x, y]) => Math.max(...g.getImageData(Math.floor((x - 1) * k), Math.floor((y - 1) * k), Math.ceil(3 * k), Math.ceil(3 * k)).data.filter((_, i) => i % 4 === 3)))
  }, points)
  const dx = (c1 - c0) / 5, dy = (r0 - r5) / 5
  const [cross, ...arms] = await lit([[c0, r5], [c0 - 3, r5], [c0 + 3, r5], [c0, r5 - 3], [c0, r5 + 3]])
  assert.ok(cross && arms.every(Boolean), 'a cross at 2.5 s, 0.5')
  assert.deepEqual((await lit([[c0 + 5, r5], [c0, r5 + 5]])).map(Boolean), [false, false], 'its arms 3 px')
  assert.ok((await lit([[c0 + dx, r5 + dy * 2]]))[0], 'a dot at 2.6 s, 0.3')
  assert.equal((await lit([[c0 + dx / 2, r5 + dy / 2]]))[0], 0, 'none between the dots')
  assert.equal((await lit([[hit, r0]]))[0], 0, 'none behind the waveform')
  // the levels in decibels: a cross at −6 dB's tick, a dot at −3 dB, 0.708 of full scale
  await page.evaluate(() => window.__ticks = [])
  await page.getByRole('tab', { name: 'Waveform', exact: true }).click({ button: 'right' })
  await choice('Levels in', 'Decibels').click()
  await page.keyboard.press('Escape')
  await page.mouse.move(2, 2)
  await page.waitForTimeout(200)
  const db = await page.evaluate(() => window.__ticks), r6 = db.find((c, i) => c.w && c.h === 1 && db[i + 1]?.s === '−6')?.y
  assert.ok(Number.isFinite(r6), 'a tick at −6 dB')
  assert.ok((await lit([[c0, r6], [c0 + 3, r6], [c0, r6 + 3]])).every(Boolean), 'a cross at 2.5 s, −6 dB')
  assert.ok((await lit([[c0 + dx, r0 - 10 ** (-3 / 20) * (r0 - r5) * 2]]))[0], 'a dot at 2.6 s, −3 dB')
  // lines, from the View menu: down from 2.5 s and across from −6 dB, fainter than the cross was; none at 2.6 s, −3 dB
  const [crossed] = await lit([[c0, r6]])
  await menu('View', 'Grid', 'Lines')
  await page.waitForTimeout(200)
  const [down, across, meet, finer] = await lit([[c0, r6 - 10], [c0 + 10, r6], [c0, r6], [c0 + dx, r0 - 10 ** (-3 / 20) * (r0 - r5) * 2]])
  assert.ok(down && across, 'a line down from 2.5 s and across from −6 dB')
  assert.ok(meet < crossed, `fainter than a cross: ${meet} < ${crossed}`)
  assert.equal(finer, 0, 'none at the finer steps')
  const blank = () => page.evaluate(() => { const canvas = document.querySelector('canvas.grid'); return !canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data.some(v => v) })
  await settings('Grid', 'None')
  await page.waitForTimeout(200)
  assert.ok(await blank(), 'nothing with None')
  // nor where there is no sound: a new tab, empty
  await settings('Grid', 'Crosses + dots')
  await page.getByRole('button', { name: 'New tab' }).click()
  await page.locator('.empty').waitFor()
  await page.waitForTimeout(200)
  assert.ok(await blank(), 'nothing with no sound')
})

// Two sliders for the settings, a spark for the agent, an open book for the recipes, the switches joined (raised keys in
// one bezel), the view's options from a right-click, the export's icon an arrow down onto a tray
test('editor: the settled icons; the switches are keys in a bezel; the view\'s options open from a right-click', async () => {
  await open()
  const icon = name => page.getByRole(name === 'Settings' ? 'button' : 'tab', { name, exact: true }).locator('path').getAttribute('d')
  assert.equal((await icon('Settings')).match(/a2 2 0 1 1-4 0/g).length, 2, 'two sliders, their round thumbs')
  assert.equal(await icon('Agent'), 'M12 3c.6 4.7 4.3 8.4 9 9-4.7.6-8.4 4.3-9 9-.6-4.7-4.3-8.4-9-9 4.7-.6 8.4-4.3 9-9Z', 'a spark, four curved points')
  assert.equal(await icon('Export'), 'M12 4v11m-5-5 5 5 5-5M4 19h16', 'an arrow down onto a tray')
  assert.equal(await icon('Recipes'), 'M3 5h5a4 4 0 0 1 4 4v11a3 3 0 0 0-3-3H3Zm18 0h-5a4 4 0 0 0-4 4v11a3 3 0 0 1 3-3h6Z', 'an open book')
  await tab('Export')
  // the switches, settled: raised keys in one bezel, each touching the next
  const group = page.locator('.export .choices').first()
  const [first, second] = await group.locator('button').evaluateAll(list => list.slice(0, 2).map(b => b.getBoundingClientRect()).map(r => [r.left, r.right]))
  assert.equal(second[0], first[1], 'raised keys in one bezel')
  assert.notEqual(await group.evaluate(el => getComputedStyle(el).backgroundColor), 'rgba(0, 0, 0, 0)')
  // the view's options: its tab right-clicked, shown at once
  await page.getByRole('tab', { name: 'Export', exact: true }).click()
  await page.getByRole('tab', { name: 'Spectrogram', exact: true }).click({ button: 'right' })
  await page.locator('.dropdown').getByRole('group', { name: 'FFT size', exact: true }).waitFor()
  assert.equal(await page.getByRole('tab', { name: 'Spectrogram', exact: true }).getAttribute('aria-selected'), 'true', 'shown at once')
})

// The edits as a stack of layers: a step chosen shows the output up to it; an edit made then goes in right after it, the
// steps after it kept, its own card chosen; undo takes it back, the step chosen as it was
test('editor: an edit made with the output rolled back to a step goes in right after it, the steps after it kept', async () => {
  await open()
  await tab('Edits')
  await page.locator('.step-name', { hasText: 'Trim' }).click()
  await page.locator('.viewing', { hasText: 'Up to Trim: ' }).waitFor()
  await page.locator('.readout', { hasText: 'LUFS' }).waitFor()
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
  const { box, x, y } = await chime(), lh = (box.height - 22 - LANES) / 2
  await write(`audio('chime.wav').stretch(1.5, { at: 1, duration: 1 })`)
  await lengthIs('0:08.500')
  await tab('Edits')
  await page.locator('.step-name', { hasText: 'chime.wav' }).click()
  await page.locator('.viewing', { hasText: 'The source alone' }).waitFor()
  await lengthIs('0:08.000')
  await drag([x(1), y], [x(2) - x(1), 0])
  await turn(await grab([[x(2) + 8, box.y + lh - 24]], /^url\(|ew-resize/), 'grip', 'speed')
  await page.waitForTimeout(300)
  assert.equal(await code(), `audio('chime.wav').stretch(1.5, { at: 1, duration: 1 })`)
})

// What is selected is kept beside each step of the history, as a text editor keeps its selections: undo brings back what
// was selected before the step, redo what was selected after it. A stretch makes its range longer: undone, the range is
// as long as it was; a delete leaves a caret: undone, its range is selected again
test('editor: undo brings back what was selected before the step, redo what was selected after it', async () => {
  const { box, x, y } = await chime(), lh = (box.height - 22 - LANES) / 2
  await drag([x(1), y], [x(2) - x(1), 0])
  await drag(await grab([[x(2) + 8, box.y + lh - 24]], /^url\(|ew-resize/), [x(1.5) - x(1), 0])
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
  const steps = await page.locator('.menubar-list').last().locator('.menu-label').allInnerTexts()
  await page.keyboard.press('Escape')
  assert.match(steps[0], /^normalize: -1 → -?[\d.]+$/)
  assert.equal(steps[1], 'The script as it opened')
})

// The caret goes to a selection's start however it was made, as a text's: dragged either way, double-clicked; the clock
// reads it, and once the selection is gone it stays there
test('editor: the caret is at the start of a selection, however it was made', async () => {
  await open()
  const before = await seconds(), { box, x } = await axis(before), clock = () => page.locator('.time').innerText()
  for (const [from, to] of [[.25, .5], [.5, .25]]) {
    await page.mouse.move(x(before * from), box.y + 100)
    await page.mouse.down()
    await page.mouse.move(x(before * to), box.y + 120, { steps: 5 })
    await page.mouse.up()
    const [start] = (await selected()).split('–')
    assert.equal(await clock(), start, `dragged ${from} → ${to}: the caret at ${start}`)
    await page.keyboard.press('Escape')
    assert.equal(await selected(), '')
    assert.equal(await clock(), start, 'the selection gone, the caret stays')
  }
  await page.mouse.dblclick(x(before * .4), box.y + 100)
  const [start, end] = (await selected()).split('–')
  assert.ok(end, 'a double-click selects')
  assert.equal(await clock(), start, 'double-clicked: the caret at the start')
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
  await page.waitForFunction(expected => Math.abs(+document.querySelector('.source').title.split(' · ').pop().split(':')[1] - expected) < .002, before - +duration)
  // the waveform shares the script's history
  await page.locator('.plot').focus()
  await page.keyboard.press('ControlOrMeta+Z')
  await page.waitForFunction(() => !scriptText().includes('.remove('))
  await page.waitForFunction(expected => Math.abs(+document.querySelector('.source').title.split(' · ').pop().split(':')[1] - expected) < .002, before)
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
// when there is one; a script of statements takes the chain as its source; one that makes a sound opens a tab
test('editor: a recipe goes on the sound as it is, over the selection when there is one, one step', async () => {
  await open()
  const chime = `audio('chime.wav')\n  .trim()\n  .normalize(-1)\n  .fade(0.02, 0.1)`
  await menu('File', 'Recipes', 'Reduce noise')
  assert.equal(await code(), `${chime}\n  .omlsa()`)
  await menu('Edit', 'Undo')
  await page.waitForFunction(c => scriptText() === c, chime)
  await noCues()
  const { box, x } = await axis(6.525), y = box.y + box.height / 3
  await drag([x(1), y], [x(2) - x(1), 0])
  await menu('File', 'Recipes', 'Remove room echo')
  await page.waitForFunction(c => scriptText() === c, `${chime}\n  // Remove room echo\n    .highpass(80, { at: 1, d: 1 })\n    .dereverb({ at: 1, d: 1 })`)
  await menu('Edit', 'Undo')
  await page.waitForFunction(c => scriptText() === c, chime)
  await menu('File', 'Recipes', 'Measure loudness')
  assert.match(await code(), /^let a = audio\('chime\.wav'\)\n  \.trim\(\)\n  \.normalize\(-1\)\n  \.fade\(0\.02, 0\.1\)\nlet \[lufs/)
  await menu('File', 'Recipes', 'Measure loudness')
  assert.match(await code(), /\nlet a2 = a\nlet \[lufs2, peak2, range2\] = await a2\.stat\(\['loudness', 'db', 'lra'\]\)\nconsole\.log\(`\$\{lufs2\.toFixed\(1\)\} LUFS · peak \$\{peak2/)
  await page.waitForFunction(() => !document.querySelector('.message.problem'))
  const tabs = await page.locator('.files .file').count()
  await menu('File', 'Recipes', 'Noise')
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
  await menu('File', 'Recipes', 'Podcast episode')
  await tab('Export')
  assert.equal(await page.locator('.export').getByRole('button', { name: 'Apple Podcasts' }).getAttribute('aria-pressed'), 'true')
  await page.waitForFunction(() => { const r = [...document.querySelectorAll('.check-table:not(.stale) tbody td:nth-of-type(1)')]; return r.length && r.every(td => !td.textContent.includes('✗')) }, null, { timeout: 30000 })
  assert.match(await code(), /\.normalize\('podcast'\)$/)
})

// B: the file as it opened, level-matched, at the same place; B again, the output. What is heard is said over the picture
// and checked in Play > Hear it before the edits
test('editor: B plays the file as it opened, level-matched to the result, and a new output returns to the result', async () => {
  await open()
  const heardBefore = async () => { await page.locator('.menubar-item', { hasText: /^Play$/ }).click(); const on = await page.locator('.menubar-list .menu-row', { has: page.locator('.menu-label', { hasText: /^Hear it before the edits$/ }) }).getAttribute('aria-checked'); await page.keyboard.press('Escape'); return on === 'true' }
  await page.locator('body').press('b')
  await page.locator('.message', { hasText: /^Hearing before the edits: the file as it opened, level-matched \([+−]\d+\.\ddB\)/ }).waitFor()
  assert.ok(await heardBefore())
  await page.locator('body').press('b')
  await page.locator('.message', { hasText: 'Hearing the output, after the edits' }).waitFor()
  assert.ok(!await heardBefore())
  await page.locator('body').press('b')
  await page.locator('.message', { hasText: /^Hearing before the edits/ }).waitFor()
  await write(`audio('chime.wav').normalize(-6)`)
  await page.locator('.readout', { hasText: 'peak −6.0dBFS' }).waitFor()
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

// The engine sets off before the page's own scripts: its worker is asked for while editor.js is still held back, and
// the page, once up, runs on that worker, not a second one
test('editor: the engine\'s worker loads ahead of the page\'s scripts, and the page takes it', async () => {
  let release
  const held = new Promise(r => release = r)
  await page.route('**/playground/editor.js', async route => { await held; route.continue() })
  await page.addInitScript(() => { const W = Worker; window.workers = 0; window.Worker = class extends W { constructor(...a) { super(...a); workers++ } } })
  const asked = page.waitForRequest('**/playground/dist/worker.js')
  await page.goto(origin + '/playground.html', { waitUntil: 'commit' })
  await asked
  release()
  await page.locator('.readout', { hasText: 'LUFS' }).waitFor()
  assert.equal(await page.evaluate(() => workers), 1, 'one worker')
})
// One set off ahead that fails to load is let go: the page starts its own, and runs
test('editor: an engine worker that fails to load ahead is replaced by the page\'s own', async () => {
  let first = true
  await page.route('**/playground/dist/worker.js', route => first ? (first = false, route.abort()) : route.continue())
  await page.goto(origin + '/playground.html')
  await page.locator('.readout', { hasText: 'LUFS' }).waitFor()
  assert.equal(first, false, 'the first one failed')
})

test('editor: before the script runs, the intro shows nothing dead; while the first run renders, it stays away', async () => {
  // no script at all: the conditional parts (intro, toolbar) stay hidden instead of showing inert buttons
  await page.route('**/playground/editor.js', route => route.abort())
  await page.goto(origin + '/playground.html')
  await page.waitForTimeout(300)
  assert.equal(await page.locator('.empty').isVisible(), false, '.empty')
  // and what does show takes no clicks yet: the Open menu stays shut
  assert.equal(await page.locator('#app').evaluate(el => getComputedStyle(el).pointerEvents), 'none')
  await page.locator('.bar button', { hasText: 'Open' }).first().click({ force: true, timeout: 2000 }).catch(() => {})
  assert.equal(await page.locator('#open-menu').evaluate(el => el.matches(':popover-open')), false)
  await page.unroute('**/playground/editor.js')
  errors.splice(0)  // the script this part withheld on purpose
  // a slow engine: the script is up, the first output isn't, and the view doesn't claim there's no sound
  let release
  const held = new Promise(r => release = r)
  await page.route('**/playground/dist/worker.js', async route => { await held; route.continue() })
  await page.goto(origin + '/playground.html')
  await page.locator('.cm-content').waitFor({ state: 'attached' })
  await page.waitForTimeout(300)
  assert.equal(await page.locator('.empty').isVisible(), false, 'no intro while the first run renders')
  release()
  await page.locator('.readout', { hasText: 'LUFS' }).waitFor()
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
  await page.locator('.empty-title').waitFor()
  const chooser = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: 'Open file', exact: true }).click()
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
  await page.locator('.empty-title').waitFor()
  await page.getByRole('button', { name: 'Sample or generate', exact: true }).click()
  const generator = await page.locator('#open-menu .menu-item').last().getAttribute('title')
  await page.locator('#open-menu .menu-item').last().click()
  await page.waitForFunction(g => scriptText() === g, generator)
  await menu('File', 'Samples', 'chime.wav')
  await page.waitForFunction(() => scriptText() === "audio('chime.wav')")
  await lengthIs('0:08.000')
  assert.deepEqual(await tabs(), ['generated', 'tone.wav', 'chime.wav'])
})

test('editor: an output of no samples shows the empty view; the next output replaces it', async () => {
  await open()
  await write(`audio('chime.wav').crop({ at: 0, duration: 0 })`)
  await page.locator('.empty-title', { hasText: 'Drop audio here' }).waitFor()
  assert.equal(await readout(), '')
  assert.ok(await page.getByRole('button', { name: 'Play' }).isDisabled())
  await write(`audio('chime.wav').reverse()`)
  await page.locator('.readout', { hasText: 'LUFS' }).waitFor()
  await page.locator('.empty').waitFor({ state: 'detached' })
  assert.equal(await lengthText(), '0:08.000')
})

test('editor: a file dropped on the waveform of a generated sound goes in where it is dropped', async () => {
  await open()
  await write(`audio.from(0.5)`)
  await page.waitForFunction(() => document.querySelector('.source').title.split(' · ').pop() === '0:00.500')
  const bytes = await wavBytes([sine(.5, 440, .5)]), { x } = await axis(.5)
  await page.evaluate(({ bytes, x }) => {
    const target = document.querySelector('.plot'), rect = target.getBoundingClientRect(), data = new DataTransfer()
    data.items.add(new File([new Uint8Array(bytes)], 'tone.wav', { type: 'audio/wav' }))
    const at = { bubbles: true, cancelable: true, dataTransfer: data, clientX: x, clientY: rect.top + 40 }
    target.dispatchEvent(new DragEvent('dragover', at))
    target.dispatchEvent(new DragEvent('drop', at))
  }, { bytes: [...bytes], x: x(.5) })
  await page.waitForFunction(() => scriptText() === "audio.from(0.5)\n  .insert(audio('tone.wav'), { at: 0.5, xfade: 0.01 })")
  await page.waitForFunction(() => document.querySelector('.source').title.split(' · ').pop() === '0:01.000')
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
  await page.waitForFunction(() => !document.querySelector('.message').textContent && /LUFS/.test(document.querySelector('.readout').textContent), null, { timeout: 30000 })
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

test('editor: play moves the clock, and a new output keeps playing where it was', async () => {
  await open()
  await page.locator('body').press('Space')
  await page.getByRole('button', { name: 'Pause' }).waitFor()
  await page.waitForFunction(() => document.querySelector('.time').textContent > '0:00.300')
  await write(`audio('chime.wav').normalize(-6)`)
  await page.locator('.readout', { hasText: 'peak −6.0dBFS' }).waitFor()
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
  await page.waitForFunction(() => document.querySelector('.source').title.endsWith('30:20.000'), null, { timeout: 120000 })
  await page.waitForFunction(() => !document.querySelector('.message').textContent, null, { timeout: 120000 })
  await cdp.send('HeapProfiler.collectGarbage')
  const used = await heap()
  assert.ok(used < 150e6, `the page holds ${(used / 1e6).toFixed(0)} MB, its samples would be ${(1820 * 48000 * 4 / 1e6).toFixed(0)}`)
  assert.ok(await drawn() > .02, 'all of it drawn from its peaks')
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
  await page.mouse.click(box.x + box.width / 2, box.y + box.height * .3)
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
  await page.locator('.readout', { hasText: /^peak −\d+\.\ddB RMS −\d+\.\ddB$/ }).waitFor()
})

test('editor: playback goes on without a gap while the page is busy', async () => {
  await page.addInitScript(taken)
  await open()
  await write(`audio.from(t => Math.sin(2 * Math.PI * 440 * t) / 2, { duration: 8 })`)
  await page.locator('.readout', { hasText: 'peak −6.0dBFS' }).waitFor()
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
  await page.locator('.readout', { hasText: 'peak −6.0dBFS' }).waitFor()
  await page.locator('.plot').focus()
  await page.keyboard.press('Space')
  await page.getByRole('button', { name: 'Pause' }).waitFor()
  await page.waitForFunction(() => document.querySelector('.time').textContent > '0:00.300')
  await page.evaluate(() => { window.__taken.length = 0 })
  await write(`const s0 = performance.now()\nwhile (performance.now() - s0 < 3000);\n${sine}.gain(-1)`)
  await page.locator('.readout', { hasText: 'peak −7.0dBFS' }).waitFor({ timeout: 15000 })
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
  assert.ok(await drawn() > .05, 'the last output still drawn')
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
  assert.equal(await page.locator('.empty-title').innerText(), 'Drop audio here')
  // the fix clears it and the figures return
  await write(`audio('chime.wav')`)
  await page.locator('.readout', { hasText: 'LUFS' }).waitFor()
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
  await page.locator('.readout', { hasText: 'LUFS' }).waitFor()
  assert.equal(await right(), 0, 'its output at the same scale')
  // the caret where the take ended, not at its start: Record again records on
  await page.waitForFunction(() => +document.querySelector('.time').textContent.split(':')[1] > .9)
  // the take itself, untrimmed: about as long as the recording ran (a slow machine's run, however long)
  await write(`audio('recording.wav')`)
  const long = () => page.waitForFunction(most => { const s = +document.querySelector('.source').title.split(' · ').pop().split(':')[1]; return s > .9 && s < most }, ran + .5)
  await long()
  const before = await lengthText()
  // kept for the next visit, as a file is (a 32-bit float WAV): the same length after a reload, nothing missing
  await page.waitForTimeout(500)
  await page.reload()
  await page.locator('.readout', { hasText: 'LUFS' }).waitFor()
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

test('editor: every button and readout says what it is when pointed at', async () => {
  await open()
  const untitled = await page.evaluate(() => [...document.querySelectorAll('button, output, .readout')]
    .filter(el => !el.title.trim() && !el.closest('.cm-editor')).map(el => el.outerHTML.slice(0, 100)))
  assert.deepEqual(untitled, [])
})

// The time axis spans the plot less its label gutter (view.js GUTTER, 40 px); the lanes are 2 px apart (GAP), over the
// time row (RULER, 22 px)
const GUTTER = 40, LANES = 2
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
// the stretch grip's pointer: arrows out from a wave, its own (view.js STRETCH)
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
const lengthIs = text => page.waitForFunction(text => document.querySelector('.source').title.endsWith(' · ' + text), text)
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

// A 440 Hz hit every half second, decaying from full scale.
const hits = `audio.from(t => Math.sin(2 * Math.PI * 440 * t) * Math.exp(-(t % 0.5) * 20), { duration: 2 })`
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

// Cues stay out of sight, a forest over the sound otherwise: held ⌘ (Ctrl), only the one under the pointer lights, the
// one a press would take; away from them, none. Lit lines are orange runs along a row 4 px under the lanes' top.
test('editor: held ⌘, only the cue under the pointer lights, none elsewhere', async () => {
  await open()
  await write(hits)
  await lengthIs('0:02.000')
  const { box, x } = await axis(2), y = box.y + 40
  const lit = () => pixels(`let n = 0, run = false; for (let x = 0; x < w - ${GUTTER}; x++) { const i = (4 * w + x) * 4, on = d[i] - d[i + 2] > 60; if (on && !run) n++; run = on } return n`)
  let cue = []
  const w = await spans(box)
  for (const until = Date.now() + 8000; !cue.length && Date.now() < until; await page.waitForTimeout(200)) cue = (await handles()).map(px => px / w * 2).filter(t => Math.abs(t - 1) < .02)
  assert.equal(cue.length, 1)
  assert.equal(await lit(), 0, 'none shown')
  await page.mouse.move(x(.75), y)
  await page.keyboard.down('ControlOrMeta')
  assert.equal(await lit(), 0, 'held ⌘ away from them: none')
  await page.mouse.move(x(cue[0]) + 1, y)
  assert.equal(await lit(), 1, 'the one under the pointer')
  await page.keyboard.up('ControlOrMeta')
})

// The cues are where sounds start and end and where they hit, one list: each hit here (0.5 s apart), and where each falls
// quiet before the next. A cue dragged warps the audio between the cues either side, which hold.
test('editor: dragging a cue moves it, the audio on either side stretching to fit, the cues either side holding', async () => {
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
  // the moved hit is its marker now: dragged again, that marker moves on
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
  await page.locator('.readout', { hasText: 'LUFS' }).waitFor()
  await lengthIs('0:02.000')
})

// The chime rings on, its partials beating: its cues are its eight strikes and where its rings fall quiet, not the swells
// of its rings, and one dragged moves alone.
test('editor: a dragged cue moves alone; the sound stretched around it makes no new cues', async () => {
  await open()
  let before = []
  for (const until = Date.now() + 8000; before.length < 8 && Date.now() < until; await page.waitForTimeout(200)) before = await handles()
  assert.ok(before.length >= 8, JSON.stringify(before))
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
test('editor: a level change draws the gain line; its points drag, above or mirrored below, and a double-click takes one away', async () => {
  await open()
  await write(`audio.from(t => 0.5 * Math.sin(2 * Math.PI * 440 * t), { duration: 2 })`)
  await lengthIs('0:02.000')
  const { box, x } = await axis(2), mid = box.y + box.height * .4
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
  await page.locator('.readout', { hasText: 'peak −3.0dB RMS' }).waitFor()
  await page.keyboard.press('Escape')
  await page.locator('.readout', { hasText: 'peak −3.0dBFS' }).waitFor()
  // the line on its own scale (view.js GAIN): −36 dB at the lane's centre line to +12 at its edges, mirrored below
  const lane = box.height - 22, centre = box.y + lane / 2, gy = (db, sign = 1) => centre - sign * (db + 36) / 48 * lane / 2
  const near = (t, db, sign = 1) => Array.from({ length: 11 }, (_, i) => [x(t), gy(db, sign) - 5 + i])
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

// Pitch is edited in its own context (View > Edit pitch), on the spectrogram, which the picture turns to: the pitch curve
// drawn on the voice's harmonics, none over the waveform; dragged up or down, the whole pitch line moves with it, one
// voice's pitch() curve (with no points, one where it was pressed), all of the voice moved; dragged again, the same
// curve set again
test('editor: dragging the pitch curve moves the whole pitch line, a voice\'s pitch() curve', async () => {
  await open()
  await write(`audio.from(t => 0.5 * Math.sin(2 * Math.PI * 220 * t) * (t > 0.5 && t < 1.5), { duration: 2 })`)
  await lengthIs('0:02.000')
  await menu('View', 'Edit pitch')
  assert.equal(await page.getByRole('tab', { name: 'Spectrogram', exact: true }).getAttribute('aria-selected'), 'true')
  // the curve, wherever the spectrogram's scale puts 220 Hz: up its lane at 1 s
  const { box, x } = await axis(2), up = Array.from({ length: Math.floor((box.height - 22) / 3) }, (_, i) => [x(1), box.y + box.height - 22 - 3 * i])
  // none over the waveform, which has no pitch axis: where the tone's 220 Hz would be on a voice's range (60 Hz to 1 kHz
  // on octaves, view.js VOICE), nothing to grab, the pitch line's 0 half a lane away from it
  await grab(up, 'ns-resize')
  await show('wave')
  const f0y = box.y + (box.height - 22) * (1 - Math.log(220 / 60) / Math.log(1000 / 60))
  for (let i = 0; i < 9; i++) { await page.mouse.move(x(1), f0y - 4 + i); assert.notEqual(await page.locator('.plot').evaluate(el => el.style.cursor), 'ns-resize') }
  // Edit pitch off: back to the waveform the spectrogram was turned to from; on again, the spectrogram
  await show('spec')
  await menu('View', 'Edit pitch')
  assert.equal(await page.getByRole('tab', { name: 'Waveform', exact: true }).getAttribute('aria-selected'), 'true')
  await menu('View', 'Edit pitch')
  assert.equal(await page.getByRole('tab', { name: 'Spectrogram', exact: true }).getAttribute('aria-selected'), 'true')
  const at = await grab(up, 'ns-resize')
  await page.mouse.move(...at)
  await page.mouse.down()
  await page.mouse.move(at[0], at[1] - 30, { steps: 6 })
  assert.match(await page.locator('.hint').innerText(), /^\+\d+st, A3([+−]\d+ct)? → .+, all of it$/)
  await page.mouse.up()
  await page.waitForFunction(() => /\.pitch\(\{ t: \[1\], v: \[[1-9]\d*\] \}, \{ voice: true \}\)$/.test(scriptText().trim()))
  const st = +(await code()).match(/v: \[(\d+)\]/)[1]
  // dragged down again: the same curve, its semitones back toward 0
  await drag(await grab(up, 'ns-resize'), [0, 15])
  await page.waitForFunction(st => { const m = scriptText().match(/v: \[(\d+)\]/); return m && +m[1] < st }, st)
  assert.equal((await code()).match(/\.pitch\(/g).length, 1, await code())
})

// A click on the pitch curve makes a point of the pitch line there, nothing changed yet; points are the line's, as the
// gain line's: one between two bends the line between them, heard as it goes; a double-click on it takes it away
test('editor: a click on the pitch curve makes a point of the pitch line; dragged between two, it bends what is between', async () => {
  await page.addInitScript(tap)
  await open()
  await write(`audio.from(t => 0.5 * Math.sin(2 * Math.PI * 220 * t) * (t > 0.5 && t < 1.5), { duration: 2 })`)
  await lengthIs('0:02.000')
  await menu('View', 'Edit pitch')
  const { box, x } = await axis(2), up = t => Array.from({ length: Math.floor((box.height - 22) / 3) }, (_, i) => [x(t), box.y + box.height - 22 - 3 * i])
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
  await page.mouse.move(point[0], point[1] - 20, { steps: 6 })
  await page.waitForTimeout(500)
  assert.match(await page.locator('.hint').innerText(), /^\+\d+st, A3([+−]\d+ct)? → /)
  const { peak } = await heard()
  assert.ok(peak > .05, `heard as it goes: ${peak}`)
  await page.mouse.up()
  await page.waitForFunction(() => /\.pitch\(\{ t: \[0\.7, 1, 1\.3\], v: \[0, [1-9]\d*, 0\] \}, \{ voice: true \}\)$/.test(scriptText().trim()))
  // on the curve as it now is, a double-click takes it away; the two either side stay
  const raised = await grab(Array.from({ length: 40 }, (_, i) => [point[0], point[1] - 2 * i]), 'move')
  await page.mouse.dblclick(...raised)
  await page.waitForFunction(() => /\.pitch\(\{ t: \[0\.7, 1\.3\], v: \[0, 0\] \}, \{ voice: true \}\)$/.test(scriptText().trim()))
  // the curve dragged between them: every point by as much
  await drag(await grab(up(1), 'ns-resize'), [0, -20])
  await page.waitForFunction(() => { const m = scriptText().trim().match(/\.pitch\(\{ t: \[0\.7, 1\.3\], v: \[([1-9]\d*), ([1-9]\d*)\] \}, \{ voice: true \}\)$/); return m && m[1] === m[2] })
})

test('editor: the caret goes where the pointer presses; Play starts on its press; the loop switch leaves Space to play', async () => {
  await open()
  const { box, x } = await axis(6.525)
  await page.mouse.move(x(2), box.y + box.height / 2)
  await page.mouse.down()
  // times go by the zoom's 1-2-5 step just above a pixel (view.js unit): 6.5 s over this plot, 0.02 s
  await page.locator('.time', { hasText: /^0:02\.000$/ }).waitFor()
  await page.mouse.move(x(3), box.y + box.height / 2, { steps: 4 })
  await page.mouse.up()
  // the clock shows the caret, one time always, in the units the settings choose, as the time row writes them; after
  // it how long the selection is, in white, between bars as a length is marked; pointed at, the selection and its samples. The
  // display above the levels still says what the sound is. The settings keep the selection
  const length = () => page.locator('.length').innerText()
  assert.equal(await page.locator('.time').innerText(), '0:02.000')
  assert.equal(await length(), '0:01.000')
  const white = await page.evaluate(() => { const i = document.body.appendChild(document.createElement('i')); i.style.color = 'var(--color-screen-bright)'; const c = getComputedStyle(i).color; i.remove(); return c })
  assert.equal(await page.locator('.length').evaluate(el => getComputedStyle(el).color), white)
  assert.match(await page.locator('.clock').getAttribute('title'), /^Selected 0:02\.000–0:03\.000: 0:01\.000, 44100 samples/)
  assert.equal(await facts(), '44.1kHz stereo')
  assert.match(await readout(), /^peak −/)
  await settings('Times in', 's')
  assert.equal(await page.locator('.time').innerText(), '2.000s')
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
for (const width of [1280, 800]) test(`repl: the status bar holds still as a selection is made, scrubbed and played, a ${width}px window`, async () => {
  await page.setViewportSize({ width, height: 720 })
  await open()
  const still = () => page.evaluate(() => {
    const rect = s => { const r = document.querySelector(`#status ${s}`).getBoundingClientRect(); return [Math.round(r.left), Math.round(r.width)] }
    return { ...Object.fromEntries(['.play', '.record', '.loop', '.clock', '.readout', '.facts'].map(s => [s, rect(s)])), message: rect('.message')[0] }
  })
  const idle = await still(), { box, x } = await axis(6.525), y = box.y + box.height / 2
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

test('editor: the playhead starts at the caret and only moves on, however late the device sounds', async () => {
  await open()
  const { box, x } = await axis(6.525)
  await page.mouse.click(x(2), box.y + box.height / 2)
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
  const { box, x } = await axis(6.525), y = box.y + box.height / 2
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
  const box = await page.locator('.plot').boundingBox(), w = box.width - GUTTER, y = box.y + box.height / 2, at = f => box.x + f * w
  await page.mouse.move(at(.5), y)
  for (let i = 0; i < 6; i++) { await page.keyboard.down('Control'); await page.mouse.wheel(0, -120); await page.keyboard.up('Control') }
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
  const box = await page.locator('.plot').boundingBox(), w = box.width - GUTTER, y = box.y + box.height / 3
  await page.mouse.move(box.x + 20, y)
  for (let i = 0; i < 8; i++) { await page.keyboard.down('Control'); await page.mouse.wheel(0, -120); await page.keyboard.up('Control') }
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
  // over the scrollbar, at the time row's foot, the arrow, as over any scrollbar
  await page.mouse.move(box.x + w / 2, box.y + box.height - 3)
  assert.equal(await page.locator('.plot').evaluate(e => e.style.cursor), 'default')
  await page.keyboard.press('Space')
})

// Zoomed in, a ms is many pixels: the playhead goes on by each frame's own time, however late a busy page runs the
// frame's work (here 0 to 10 ms, at random, before it), so the view never jolts back and forth. And the pictures'
// window-wide layers are clipped, not masked: a mask is a pass of its own over each, every frame the view scrolls
test('editor: zoomed in, the playhead goes on by the frames\' own time, however late the page gets to them', async () => {
  await open()
  await noCues()
  await write(`audio.from(t => Math.sin(2 * Math.PI * 220 * t) * .3, { duration: 20 })`)
  await lengthIs('0:20.000')
  for (const layer of ['waveform', 'spectrum', 'grid']) assert.equal(await page.locator(`.plot canvas.${layer}`).evaluate(e => getComputedStyle(e).maskImage), 'none', layer)
  const box = await page.locator('.plot').boundingBox(), y = box.y + box.height / 2
  await page.mouse.move(box.x + 20, y)
  for (let i = 0; i < 6; i++) { await page.keyboard.down('Control'); await page.mouse.wheel(0, -120); await page.keyboard.up('Control') }
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
test('editor: the status bar says the note at the caret, a selection\'s compass, the tempo and the key', async () => {
  await open()
  await noCues()
  const heard = text => page.waitForFunction(text => document.querySelector('.heard')?.textContent === text, text)
  await write(`audio.from(t => (t < 1 ? Math.sin(2 * Math.PI * 440 * t) : Math.sin(2 * Math.PI * 659.26 * t)) * .5, { duration: 2 })`)
  await lengthIs('0:02.000')
  const { box, x } = await axis(2), y = box.y + box.height / 2
  await page.mouse.click(x(.5), y)
  await heard('A4')
  await page.mouse.click(x(1.5), y)
  await heard('E5')
  assert.match(await page.locator('.heard').getAttribute('title'), /^The note E5: the pitch at the caret/)
  await drag([x(.2), y], [x(1.8) - x(.2), 0])
  await heard('A4–E5')
  // no pitch, no note; too short for a tempo or a key
  await write(`audio.from(t => 0, { duration: 2 })`)
  await page.mouse.click(x(.5), y)
  await page.waitForTimeout(600)
  assert.equal(await page.locator('.heard').count(), 0)
  await write(`audio.from(t => { const b = t % 0.5; return (b < 0.03 ? Math.sin(2 * Math.PI * 1000 * t) * Math.exp(-b * 150) : 0) * .6 + [261.63, 329.63, 392].reduce((s, f) => s + Math.sin(2 * Math.PI * f * t), 0) / 15 }, { duration: 8 })`)
  await lengthIs('0:08.000')
  await page.waitForFunction(() => / · 120 BPM · C major$/.test(document.querySelector('.heard')?.textContent))
  assert.match(await page.locator('.heard').getAttribute('title'), /120 BPM, the tempo of all of it: its halves agree within 4%\. C major, the key of all of it/)
})

// The speed it plays at, the pitch kept: Play held and dragged across sets it, twice or half each 32 px, 0.1× to 10×, a
// scale over it as it goes, the pointer hidden; let go, it stays. While it plays the speed stands in the record
// button's place (nothing records then), a pill turning 1×, 1.5×, 2×, so nothing beside it moves; right-clicked, Play or
// the pill, a list. Round Play a ring, how far through the sound it plays, there while it plays. The clock runs at that
// speed: over 400 ms at 4×, about 1.6 s
test('editor: Play held and dragged sets the speed, shown in record\'s place while it plays; a pill, a list; a ring how far it has played', async () => {
  await open()
  const play = await page.locator('button.play').boundingBox(), cx = play.x + play.width / 2, cy = play.y + play.height / 2
  const clock = () => page.locator('.time').innerText().then(t => { const [m, s] = t.split(':'); return +m * 60 + +s })
  const speed = () => page.evaluate(() => JSON.parse(localStorage.getItem('audio-repl') || '{}').speed)
  const slot = () => page.evaluate(() => ['.record', '.speed-pill'].map(s => { const el = document.querySelector(s), r = el.getBoundingClientRect(); return [el.inert, Math.round(r.x + r.width / 2)] }))
  const ring = () => page.locator('button.play').evaluate(el => [el.classList.contains('rolling'), +el.style.getPropertyValue('--played')])
  const [[recordOff, recordAt]] = await slot()
  assert.equal(recordOff, false, 'at rest, record')
  await page.mouse.move(cx, cy)
  await page.mouse.down()
  await page.getByRole('button', { name: 'Pause' }).waitFor()
  await page.mouse.move(cx + 64, cy, { steps: 4 })
  // its scale over Play, the speed marked on it, the pointer hidden
  await page.locator('.speed-axis').waitFor()
  assert.equal(await page.locator('.speed-mark').innerText(), '4×')
  assert.deepEqual(await page.locator('.speed-tick').allInnerTexts(), ['0.1×', '0.5×', '1×', '2×', '5×', '10×'])
  assert.equal(await page.locator('#app').evaluate(el => getComputedStyle(el).cursor), 'none')
  await page.mouse.up()
  // let go, it stays and plays on at it: the pill in record's place, centred where record is
  assert.equal(await page.locator('.speed-axis').count(), 0)
  assert.ok(await page.getByRole('button', { name: 'Pause' }).isVisible(), 'plays on')
  assert.equal(await page.locator('.speed-pill').innerText(), '4×')
  const [[recordGone], [pillOff, pillAt]] = await slot()
  assert.ok(recordGone && !pillOff && Math.abs(pillAt - recordAt) <= 1, 'the speed in record\'s place')
  await page.waitForTimeout(300)
  const t0 = await clock(), [rolling, p0] = await ring()
  await page.waitForTimeout(400)
  const ran = await clock() - t0, [, p1] = await ring()
  assert.ok(ran > 1.1 && ran < 2.2, `at 4× 400 ms ran ${ran} s`)
  assert.equal(await speed(), 4)
  // the ring: how far through the whole sound, 6.525 s, it has played
  assert.ok(rolling && p1 > p0 && Math.abs(p1 - await clock() / 6.525) < .1, `the ring round Play: ${p0} then ${p1}`)
  // past the ends it stops at them
  await page.mouse.move(cx, cy)
  await page.mouse.down()
  await page.mouse.move(cx + 600, cy, { steps: 4 })
  assert.equal(await page.locator('.speed-mark').innerText(), '10×')
  await page.mouse.move(cx - 600, cy, { steps: 4 })
  assert.equal(await page.locator('.speed-mark').innerText(), '0.1×')
  await page.mouse.up()
  // the pill turns it: 1×, 1.5×, 2×, 1× again
  for (const next of ['1×', '1.5×', '2×', '1×']) {
    await page.locator('.speed-pill').click()
    assert.equal(await page.locator('.speed-pill').innerText(), next)
  }
  assert.equal(await speed(), 1)
  // a press while it plays, let go at once, pauses, the caret where it was pressed; record back in its place, no ring
  await page.mouse.move(cx, cy)
  await page.mouse.down()
  const pressed = await clock()
  await page.waitForTimeout(150)
  await page.mouse.up()
  await page.getByRole('button', { name: 'Play', exact: true }).waitFor()
  assert.ok(Math.abs(await clock() - pressed) < .05, `${await clock()} vs ${pressed}`)
  assert.deepEqual((await slot()).map(([off]) => off), [false, true], 'record again')
  assert.equal((await ring())[0], false, 'no ring at rest')
  // right-clicked: the list; kept for the next visit
  await page.locator('button.play').click({ button: 'right' })
  await menuRow('1.5×').click()
  assert.equal(await speed(), 1.5)
  await page.reload()
  await page.locator('.readout', { hasText: 'LUFS' }).waitFor()
  await page.locator('button.play').click()
  assert.equal(await page.locator('.speed-pill').innerText(), '1.5×')
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
    await boxDrag([x(.5), box.y + box.height * .4], [x(1) - x(.5), box.height * .2 * (box.height - 24) / box.height])
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
  const pinch = async (px, py) => { await page.mouse.move(px, py); for (let i = 0; i < 4; i++) { await page.keyboard.down('Control'); await page.mouse.wheel(0, -60); await page.keyboard.up('Control') } }
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
  for (let i = 0; i < 4; i++) { await page.keyboard.down('Control'); await page.mouse.wheel(0, -60); await page.keyboard.up('Control') }
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
  await pinch(box.x + box.width - GUTTER - 20, box.y + box.height * .5)
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

// The settings, the panel's last tab: the frequency scale, what shows, snapping; each remembered
// The frequency scale is the spectrogram's own: its tab again, or a right-click on it; snapping is a setting; both kept
test('editor: the spectrogram\'s frequency scale from its tab or a right-click, snapping from the settings, both remembered', async () => {
  await open()
  await show('spec')
  const plot = page.locator('.plot'), now = () => plot.getAttribute('data-scale')
  assert.equal(await now(), 'log')
  await show('spec')
  assert.equal(await now(), 'mel')
  const { box: at } = await axis(1)
  // the picture's context menu, then its options, a dropdown under its switch
  await page.mouse.click(at.x + 200, at.y + 100, { button: 'right' })
  await menuRow('How the spectrogram draws…').click()
  await choice('Frequency scale', 'Hertz').click()
  assert.equal(await now(), 'lin')
  await page.keyboard.press('Escape')
  // a click on the frequencies switches nothing now
  const box = await plot.boundingBox()
  await page.mouse.click(box.x + box.width - 20, box.y + box.height * .1)
  assert.equal(await now(), 'lin')
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  assert.equal(await choice('Show over the sound', 'Snap').getAttribute('aria-pressed'), 'true')
  await choice('Show over the sound', 'Snap').click()
  assert.equal(await choice('Show over the sound', 'Snap').getAttribute('aria-pressed'), 'false')
  await page.keyboard.press('Escape')
  await page.waitForTimeout(600)
  await page.reload()
  await page.locator('.readout', { hasText: 'LUFS' }).waitFor()
  assert.equal(await now(), 'lin')
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('audio-repl')).snap), false)
})

// Colour in a screenshot of the plot: the largest spread between a pixel's channels, and brightness along a column.
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
  const box = await page.locator('.plot').boundingBox(), lh = (box.height - 22 - LANES) / 2, lanes = [[0, lh], [lh + LANES, 2 * lh + LANES]]
  const mel = f => 2595 * Math.log10(1 + f / 700), at = { log: f => Math.log2(f / 20) / Math.log2(24000 / 20), mel: f => mel(f) / mel(24000) }
  // the brightest pixel down the middle of each lane: its height in CSS px, its level
  const brightest = () => pixels(`const k = w / arg.width, x = Math.round(arg.x * k)
    return arg.lanes.map(([a, b]) => { let top = 0, at = 0; for (let y = Math.ceil(a * k); y < Math.floor(b * k); y++) { const v = d[(y * w + x) * 4 + 1]; if (v > top) { top = v; at = y } } return [(at + .5) / k, top] })`, { width: box.width, x: (box.width - GUTTER) / 2, lanes })
  for (const scale of ['log', 'mel']) {
    // the spectrogram's tab again: its frequencies on the next scale, octaves to mel
    if (scale === 'mel') {
      await page.getByRole('tab', { name: 'Spectrogram', exact: true }).click()
      await page.waitForTimeout(300)
    }
    const [[y1, loud], [y4, quiet]] = await brightest()
    const row1 = lh * (1 - at[scale](1000)), row4 = lanes[1][0] + lh * (1 - at[scale](4000))
    assert.ok(Math.abs(y1 - row1) < 2 && Math.abs(y4 - row4) < 2, `${scale}: 1 kHz at ${y1.toFixed(1)} of ${row1.toFixed(1)}, 4 kHz at ${y4.toFixed(1)} of ${row4.toFixed(1)}`)
    assert.ok(loud > 200 && quiet > 90 && quiet < loud - 30, `${scale}: the loud tone ${loud}, the quiet ${quiet}`)
  }
})

// The pointer on the spectrogram reads the level its colour stands for (gl-spectrogram pick) and marks it on the spectrum
// meter, which spans the spectrogram's own levels, its floor to its top (view.js meterX): tones of amplitude 0.5 and
// 0.05, 20 dB apart (20 · log10(0.5 / 0.05)), marked 20/80 of the meter's 40 px apart at the default 80 dB range, the
// louder, the loudest there is, at the top
test('editor: the pointer on the spectrogram marks its level on the spectrum meter, on the spectrogram\'s scale', async () => {
  await open()
  await write(`const tone = (f, a) => Float32Array.from({ length: 48000 }, (_, i) => a * Math.sin(2 * Math.PI * f * i / 48000))
audio.from([tone(1000, .5), tone(4000, .05)], { sampleRate: 48000 })`)
  await lengthIs('0:01.000')
  await show('spec')
  await page.waitForTimeout(300)
  const box = await page.locator('.plot').boundingBox(), lh = (box.height - 22 - LANES) / 2, left = box.width - GUTTER - 42
  const at = f => 1 - Math.log2(f / 20) / Math.log2(24000 / 20)
  // the overlay's meter columns along a row, summed over its channels
  const columns = y => page.evaluate(([y, left]) => {
    const cv = document.querySelector('canvas.overlay'), k = cv.width / cv.clientWidth, n = Math.round(40 * k)
    const d = cv.getContext('2d').getImageData(Math.round(left * k), Math.round(y * k) + 1, n, 1).data
    return { k, sums: Array.from({ length: n }, (_, i) => d[4 * i] + d[4 * i + 1] + d[4 * i + 2] + d[4 * i + 3]) }
  }, [y, left])
  // where the pointer's mark is, px into the meter: the columns that change with the pointer on the tone's row
  const mark = async y => {
    await page.mouse.move(box.x + box.width * .4, box.y + y)
    await page.waitForTimeout(150)
    const on = await columns(y)
    await page.mouse.move(2, 2)
    await page.waitForTimeout(150)
    const off = await columns(y), lit = on.sums.flatMap((v, i) => v !== off.sums[i] ? [i] : [])
    assert.ok(lit.length, `a mark on the meter at ${y}`)
    return (lit[0] + lit.at(-1) + 1) / 2 / on.k
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
  const lit = column.map((v, y) => [v, y]).filter(([v]) => v > 90), top = lit[0][1], mid = Math.round(column.length * (1 - 22 / (await page.locator('.plot').boundingBox()).height) / 2)
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
  await page.locator('.readout', { hasText: 'LUFS' }).waitFor()
  const [picture, panel] = await Promise.all(['.view-slab', '.side-slab'].map(box))
  assert.ok(panel.x >= picture.x + picture.width - 1, 'still beside it')
  assert.ok(await edits(), 'a panel stored under an old name opens on the edits')
})

// Shows the waveform or the spectrogram, by its tab
const show = name => page.getByRole('tab', { name: name === 'spec' ? 'Spectrogram' : 'Waveform', exact: true }).click()

test('editor: a box on the spectrogram selects a band, plays it alone, and Delete writes spectral() for it', async () => {
  await open()
  await noCues()
  await write(hits)
  await lengthIs('0:02.000')
  await show('spec')
  const { box, x } = await axis(2)
  // a drag there selects time, as on the waveform
  await drag([x(.5), box.y + box.height * .3], [x(1) - x(.5), box.height * .2])
  assert.match(await selected(), /^0:00\.50\d–0:01\.00\d$/)
  assert.doesNotMatch(await readout(), /Hz/)
  await page.keyboard.press('Escape')
  await boxDrag([x(.5), box.y + box.height * .3], [x(1) - x(.5), box.height * .2])
  // the palette offers what a band takes first
  await page.keyboard.press('ControlOrMeta+K')
  assert.equal(await page.locator('.palette-group').first().innerText(), 'For the band')
  assert.deepEqual((await page.locator('.palette-list .tool strong').allInnerTexts()).slice(0, 4), ['Remove this band', 'This band 6 dB quieter', 'This band 6 dB louder', 'Rebuild this band from its surroundings'])
  await page.keyboard.press('Escape')
  assert.match(await selected(), /^0:00\.50\d–0:01\.00\d$/)
  assert.match(await readout(), /^[\d.]+k?Hz–[\d.]+k?Hz$/)
  assert.match(await page.locator('button.play').getAttribute('title'), /^Play the selected band/)
  // the waveform shows no band: the time range stays, the band goes
  await show('wave')
  assert.doesNotMatch(await readout(), /Hz/)
  assert.match(await page.locator('button.play').getAttribute('title'), /^Play the selection/)
  // its tab again leaves it shown, its frequencies on the next scale; round again (mel, ERB, hertz), on octaves
  await show('spec')
  await show('spec')
  assert.equal(await page.getByRole('tab', { name: 'Spectrogram', exact: true }).getAttribute('aria-selected'), 'true')
  assert.equal(await page.locator('.plot').getAttribute('data-scale'), 'mel')
  for (let i = 0; i < 3; i++) await show('spec')
  assert.equal(await page.locator('.plot').getAttribute('data-scale'), 'log')
  await page.keyboard.press('Escape')
  await boxDrag([x(.5), box.y + box.height * .3], [x(1) - x(.5), box.height * .2])
  await page.keyboard.press('Delete')
  await page.waitForFunction(() => /\.spectral\(/.test(scriptText()))
  const [, lo, hi, at, duration] = (await code()).match(/\.spectral\(\[([\d.]+), ([\d.]+)\], \{ at: ([\d.]+), d: ([\d.]+) \}\)/).map(Number)
  assert.ok(30 < lo && lo < hi && hi < 22050, `${lo} ${hi}`)
  assert.ok(Math.abs(at - .5) < .01 && Math.abs(at + duration - 1) < .01, `${at} ${duration}`)
  // near a mark on the frequency axis, an edge takes its value: 2 kHz and 500 Hz on the log axis, 20 Hz to Nyquist
  const lane = box.height - 22, fy = f => box.y + lane - Math.log2(f / 20) / Math.log2(22050 / 20) * lane
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
  const { box, x } = await axis(240), lane = box.height - 22
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
  const { box, x } = await axis(2), lane = box.height - 22
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
  assert.match(await page.locator('button.play').getAttribute('title'), /^Play the selected band/)
})

// Several boxes, as Photoshop's several selections: Alt and a drag adds another; Play plays each band over its time,
// Delete takes each out, one step, and the caret runs through the band alone
test('editor: Alt and a drag on the spectrogram adds another box; Delete takes every box out at once', async () => {
  await open()
  await noCues()
  await write(`audio('chime.wav')`)
  await lengthIs('0:08.000')
  await show('spec')
  const { box, x } = await axis(8), lane = box.height - 22
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
  assert.match(await page.locator('button.play').getAttribute('title'), /^Play the 2 bands selected/)
  await page.keyboard.press('ControlOrMeta+K')
  assert.equal(await page.locator('.palette-group').first().innerText(), 'For the 2 bands')
  await page.keyboard.press('Escape')
  // a method from the context menu, for each box's time: the clicks in each taken out
  await page.mouse.click(x(1.5), box.y + lane * .25, { button: 'right' })
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
  await page.waitForFunction(() => document.querySelector('.source').title.endsWith('30:20.000'), null, { timeout: 120000 })
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

test('editor: the caret drags like an edge, from its line or anywhere on the time row, and the moment under it sounds while held', async () => {
  await page.addInitScript(tap)
  await open()
  const { box, x } = await axis(6.525), row = box.y + box.height - 8, lane = box.y + box.height / 2
  // the mark in the bar: the logo at rest, the wave under the caret while it sounds, turned by the caret's travel
  const markShot = () => page.locator('.bar .wordmark canvas').screenshot()
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

// Inside a selection the caret's line drags as it does without one, the selection kept; where a selection puts it, on
// its start, the edge takes the press; only clicked, it is a click: the caret there alone
test('editor: inside a selection the caret drags, the selection kept; on the selection\'s edge, the edge drags', async () => {
  await open()
  const { box, x } = await axis(6.525), row = box.y + box.height - 8, lane = box.y + box.height / 2
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
  // the range's start, the caret on it once a range is made again: the edge's, the range shorter, no caret dragged
  await page.mouse.click(x(5), lane)
  await drag(1, 3)
  const made = await selected(), start = await caret()
  await drag(start, start + .4)
  const [a, b] = (await selected()).split('–'), at = t => t.split(':').reduce((m, s) => m * 60 + +s, 0)
  assert.ok(Math.abs(at(a) - start - .4) < .06 && at(b) === at(made.split('–')[1]), `the start dragged: ${made} → ${a}–${b}`)
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
    const png = (await page.locator('.bar .wordmark canvas').screenshot()).toString('base64')
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
  await boxDrag([x(.5), box.y + box.height * .3], [x(1) - x(.5), box.height * .2])
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

// On a narrow screen a panel is a sheet over the output, the whole width, as tall as it can be with a strip of the
// picture kept over it; its buttons stay in reach
test('editor: a shared link restores the script; on a narrow screen the panel is a sheet over the output, the whole width', async () => {
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
  await page.locator('.readout', { hasText: 'LUFS' }).waitFor({ state: 'attached' })
  assert.equal(await code(), `audio('chime.wav').reverse()`)
  await tab('Edits')
  const view = await page.locator('.view-slab').boundingBox(), chain = await page.locator('.side-slab').boundingBox()
  assert.ok(chain.width >= view.width - 14 && chain.y >= view.y + 60 && chain.y + chain.height <= view.y + view.height + 1, `a sheet over the output: ${JSON.stringify(chain)} in ${JSON.stringify(view)}`)
  assert.ok(chain.height > view.height / 2, 'more than half its height')
  for (const name of ['Code', 'Export']) assert.ok(await page.getByRole('tab', { name, exact: true }).isVisible(), name)
  assert.ok(await page.getByRole('button', { name: 'Settings', exact: true }).isVisible())
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
  // in Record's place, a ring of how much has come, which stops it
  const ring = page.getByRole('button', { name: 'Stop', exact: true })
  assert.ok(await ring.isVisible(), 'the ring in Record\'s place')
  assert.ok(await page.locator('.record').evaluate(e => e.inert), 'Record gives way')
  const arrived = +await ring.evaluate(e => getComputedStyle(e).getPropertyValue('--arrived'))
  assert.ok(arrived > 0 && arrived < .6, `the ring as far as it has come: ${arrived}`)
  const early = await drawn()
  assert.ok(early > 0, 'some of it is drawn before it has all come')
  await page.waitForFunction(() => !document.querySelector('.message').textContent && /LUFS/.test(document.querySelector('.readout').textContent), null, { timeout: 20000 })
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
  const { box, x } = await axis(2), end = Math.min(x(2), box.x + box.width - GUTTER - 50) - box.x
  // CSS px: where the line of how far it has come is (past the caret's), and the share of the columns after it, to the
  // end, that the centre line lights
  const read = () => page.evaluate(end => {
    const cv = document.querySelector('canvas.overlay'), k = cv.width / cv.clientWidth, g = cv.getContext('2d'), h = cv.clientHeight - 22
    const row = y => g.getImageData(0, Math.round(y) * k, cv.width, 1).data, top = row(h * .25), mid = row(h / 2)
    let come = -1
    for (let i = 3 * k; i < cv.width; i++) if (top[4 * i + 3] > 100) { come = i / k; break }
    let lit = 0, n = 0
    for (let i = Math.ceil((come + 3) * k); i < end * k; i++, n++) lit += mid[4 * i + 3] > 0
    return { come, line: n ? lit / n : 1, decoding: /^Decoding/.test(document.querySelector('.message').textContent) }
  }, end)
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
  await page.mouse.click(x(.1), box.y + box.height / 3)
  let at = 0
  for (const until = Date.now() + 5000; !(Math.abs(at - .4) < .03) && Date.now() < until; await page.waitForTimeout(200)) { await page.mouse.click(x(.1), box.y + box.height / 3); at = await step() }
  assert.ok(Math.abs(at - .4) < .03, `to the next cue: ${at}`)
  assert.ok(Math.abs(await step() - .5) < .03, 'and the one after')
})

// An edit made while a step holds the worker in one pass over its input (decrackle's, 20 s of it here) is not kept
// waiting for it: the worker is replaced, and the new script's output comes in a second or so
test('editor: an edit made while a step holds the engine takes over at once', async () => {
  await open()
  await write(`audio('chime.wav').repeat(20).decrackle()`)
  await page.locator('.message', { hasText: /decrackle… [1-9]/ }).waitFor({ timeout: 20000 })
  const t0 = Date.now()
  await write(`audio('chime.wav').gain(-3)`)
  await page.waitForFunction(() => !document.querySelector('.message').textContent && /LUFS/.test(document.querySelector('.readout').textContent), null, { timeout: 10000 })
  assert.ok(Date.now() - t0 < 5000, `${Date.now() - t0} ms`)
  await lengthIs('0:08.000')
  // Stopped there, the worker is replaced too: the edit undone, the output shown made again in the new one, the caret
  // stepping by its cues (the chime's fourth strike, 1.81 s, after 1.5 s)
  await write(`audio('chime.wav').gain(-3).repeat(20).decrackle()`)
  await page.locator('.message', { hasText: /decrackle… [1-9]/ }).waitFor({ timeout: 20000 })
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
  await menu('File', 'Samples', 'handpan.wav')
  assert.equal(await page.locator('.message.problem').count(), 0)
  await page.locator('.readout', { hasText: 'LUFS' }).waitFor()
})

// A sound between pauses, as a word between spaces: bursts of a tone at 0–0.4 s and 0.5–0.9 s, a long pause, more
// at 1.5–1.9 s and 2–2.4 s. Pauses are read in blocks of 1024 samples (23 ms at 44.1 kHz), so edges land within one.
const bursts = `audio.from(t => (t < .4 || (t > .5 && t < .9) || (t > 1.5 && t < 1.9) || (t > 2 && t < 2.4)) * .5 * Math.sin(2 * Math.PI * 440 * t), { duration: 2.5 })`
// Their cues are the pauses' edges, each burst's start and end, as a text's words are found.
// A bell rings on with no pause, so nothing parts a strike from its ring: a double-click on its tail takes it from its
// strike to the next. The page's chime rings from its fourth strike (1.81 s once trimmed) into its fifth (3.31 s).
test('editor: a double-click on a ringing tail selects from its strike to the next', async () => {
  await open()
  const { box, x } = await axis(6.525), seconds = t => t.split(':').reduce((m, s) => m * 60 + +s, 0)
  let range = []
  for (const until = Date.now() + 8000; Date.now() < until && !(range[1] < 6); await page.waitForTimeout(200)) {
    await page.mouse.dblclick(x(2.8), box.y + box.height * .3)
    range = (await selected()).split('–').map(seconds)
  }
  assert.ok(Math.abs(range[0] - 1.81) < .02 && Math.abs(range[1] - 3.31) < .02, range.join('–'))
})

test('editor: a double-click selects the fragment between its cues, or the pause it is in; a triple-click the sound between its pauses; ⌥ and ⌘ arrows step by them', async () => {
  await open()
  await write(bursts)
  await lengthIs('0:02.500')
  const { box, x } = await axis(2.5), y = box.y + box.height / 3
  const range = async () => (await selected()).split('–').map(t => +t.split(':')[1])
  const near = ([a, b], [p, q]) => Math.abs(a - p) < .03 && Math.abs(b - q) < .03
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
  const { box, x } = await axis(2), y = box.y + box.height / 3
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

// A selection's grip, past its end a square's height off each lane's foot, sets its length: trimmed (cut back, the seam
// crossfaded as a delete's, or silence added), stretched with the pitch kept, or sped with the pitch following, a click
// on it turning it to the next; a stretch just made changes with it. Its pill sets its level; the first of the tools at
// its foot, its pitch. Each is one step.
test('editor: a selection\'s grip trims, stretches or speeds it, its pill sets its level and its pitch tool its pitch', async () => {
  const { box, x, y } = await chime(), lh = (box.height - 22 - LANES) / 2
  const select = async (a, b) => { await page.mouse.click(x(7.5), y); await drag([x(a), y], [x(b) - x(a), 0]) }
  const last = async pattern => { await page.waitForFunction(p => new RegExp(p).test(scriptText()), pattern.source); return code() }
  const undo = async () => {
    for (let i = 0; i < 3 && await code() !== "audio('chime.wav')"; i++) { await page.keyboard.press('ControlOrMeta+Z'); await page.waitForTimeout(150) }
    await page.waitForFunction(() => scriptText() === "audio('chime.wav')")
    await lengthIs('0:08.000')
  }
  const grip = b => grab([[x(b) + 8, box.y + lh - 24]], /^url\(|ew-resize/), pill = (a, b) => grab([[(x(a) + x(b)) / 2, box.y + 4]], 'ns-resize')
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
  // the tools at its foot, side by side from its middle (view.js BOX, 16 px, 2 apart): pitch, intonation, formants
  await drag(await grab([[(x(1) + x(2)) / 2 - 18, box.y + box.height - 22 - 8]], 'ns-resize'), [0, -box.height / 10])
  await last(/\.pitch\(/)
})

// Several ranges, as a text editor's several selections: the next pause like the one selected joins it (⌘D), and an
// edit acts on each, in one step
test('editor: pauses selected together are shortened or deleted together, in one step', async () => {
  await open()
  await write(bursts)
  await lengthIs('0:02.500')
  const { box, x } = await axis(2.5), y = box.y + box.height / 3
  await page.mouse.dblclick(x(.45), y)
  await page.keyboard.press('ControlOrMeta+D')
  await page.keyboard.press('ControlOrMeta+D')
  assert.match(await page.locator('.clock').getAttribute('title'), /^Selected 3 ranges: 0:00\.\d+, \d+ samples/)
  await palette('Delete all 3')
  // the pauses at 0.4–0.5, 0.9–1.5 and 1.9–2 s, from the last back, so each time holds
  await page.waitForFunction(() => (scriptText().match(/\.remove\(/g) || []).length === 3)
  const ats = [...(await code()).matchAll(/remove\(\{ at: ([\d.]+)/g)].map(m => +m[1])
  assert.ok(ats[0] > ats[1] && ats[1] > ats[2] && Math.abs(ats[2] - .4) < .03, JSON.stringify(ats))
  await page.waitForFunction(() => +document.querySelector('.source').title.split(':').pop() < 1.8)
  await page.keyboard.press('ControlOrMeta+Z')
  await page.waitForFunction(() => !scriptText().includes('.remove('))
})

// M puts a marker at the caret, a mark() at the chain's end; its flag, over the picture as a timeline's markers stand over
// its tracks, drags to move it, a double-click names it (its mark()'s label), its right-click menu takes it away; File
// exports the parts between markers, a file each
test('editor: markers: M at the caret, its flag over the picture dragged, named, taken away, the parts between them exported', async () => {
  await open()
  await write(`audio('chime.wav')`)
  await lengthIs('0:08.000')
  const { box, x } = await axis(8), y = box.y + box.height * .3, row = box.y + 4
  // the times the script gets: the caret's, to the zoom's step
  const marks = async n => { await page.waitForFunction(n => (scriptText().match(/\.mark\(/g) || []).length === n, n); return [...(await code()).matchAll(/\.mark\(([\d.]+)/g)].map(m => +m[1]) }
  await page.mouse.click(x(2), y)
  await page.keyboard.press('m')
  await page.mouse.click(x(5), y)
  await page.keyboard.press('m')
  const [a, b] = await marks(2)
  assert.ok(Math.abs(a - 2) < .05 && Math.abs(b - 5) < .05, `${a} ${b}`)
  // a flag shows as soon as it is made, before the output that has it
  await drag(await grab([[x(a), row]], 'pointer'), [x(3) - x(2), 0])
  await page.waitForFunction(a => +(scriptText().match(/\.mark\(([\d.]+)\)/)?.[1]) > a + .9, a)
  // the menu as the output it opens over: opened again till that output has come, with its markers
  for (const until = Date.now() + 8000; Date.now() < until; await page.keyboard.press('Escape')) {
    await page.locator('.menubar-item', { hasText: /^File$/ }).click()
    if (await menuRow('Export the parts between markers').getAttribute('aria-disabled') !== 'true') break
  }
  const downloads = []
  page.on('download', d => downloads.push(d.suggestedFilename()))
  await menuRow('Export the parts between markers').click()
  await page.waitForFunction(() => !document.querySelector('.export-button').textContent.includes('Exporting'))
  await page.waitForTimeout(300)
  assert.deepEqual(downloads.sort(), ['chime-edited-01.wav', 'chime-edited-02.wav', 'chime-edited-03.wav'])
  // named where its flag is
  await page.mouse.dblclick(...await grab([[x(b), row]], 'pointer'))
  await page.keyboard.type('Outro')
  await page.keyboard.press('Enter')
  await page.waitForFunction(() => /\.mark\([\d.]+, 'Outro'\)/.test(scriptText()))
  // a name cleared is no name: the label goes from its mark()
  await page.mouse.dblclick(...await grab([[x(b), row]], 'pointer'))
  await page.keyboard.press('Backspace')
  await page.keyboard.press('Enter')
  await page.waitForFunction(() => /\.mark\([\d.]+\)$/.test(scriptText().trim()) && !scriptText().includes('Outro'))
  await page.mouse.dblclick(...await grab([[x(b), row]], 'pointer'))
  await page.keyboard.type('Outro')
  await page.keyboard.press('Enter')
  await page.waitForFunction(() => /\.mark\([\d.]+, 'Outro'\)/.test(scriptText()))
  // taken away from its own menu
  await page.mouse.click(...await grab([[x(b), row]], 'pointer'), { button: 'right' })
  await page.locator('.menubar-menu .menu-row', { has: page.locator('.menu-label', { hasText: /^Delete the marker$/ }) }).click()
  assert.equal((await marks(1)).length, 1)
})

// M over a selection marks it, a range: mark({ at, d }), a region in the file. A marker made asks for its name at once,
// over its flag (not while it plays, where M marks moment after moment); a click on the name asks again. A range's bar
// drags the range and, let go, selects it.
test('editor: markers: M over the selection a range, named as it is made, renamed from its name, its bar dragged', async () => {
  await open()
  await noCues()
  await write(`audio('chime.wav')`)
  await lengthIs('0:08.000')
  const { box, x } = await axis(8), y = box.y + box.height * .3, row = box.y + 4
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
  await page.mouse.click(x(1) + 20, row)
  assert.ok(await named(), 'a click on its name')
  await page.keyboard.press('ControlOrMeta+A')
  await page.keyboard.type('Start')
  await page.keyboard.press('Enter')
  await page.waitForFunction(() => /\.mark\(1, 'Start'\)/.test(scriptText()) && scriptText().includes("'Chorus'"))
  // its bar dragged: the range moves, what is selected and the caret staying as they were; clicked, it is selected
  await page.mouse.click(x(7.5), y)
  await drag([x(4.5), row], [x(5.5) - x(4.5), 0])
  await page.waitForFunction(() => /\.mark\(\{ at: 4, d: 2 \}, 'Chorus'\)/.test(scriptText()))
  assert.equal(await selected(), '')
  assert.equal(await page.locator('.time').innerText(), '0:07.500')
  await page.mouse.click(x(5), row)
  assert.equal(await selected(), '0:04.000–0:06.000')
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
  const { box, x } = await axis(16), y = box.y + box.height * .3, row = box.y + 6
  await page.mouse.click(x(3), y)
  await page.keyboard.press('m')
  // its run under way, the name written
  await page.waitForTimeout(400)
  await page.keyboard.type('Hello')
  await page.keyboard.press('Enter')
  // the name is there from the next frame, where a click names it again (a text pointer), till the output with it
  // comes and after
  await page.waitForTimeout(50)
  const seen = []
  for (const until = Date.now() + 4000; Date.now() < until; await page.waitForTimeout(100)) {
    await page.mouse.move(x(3) + 22 + seen.length % 2, row)
    seen.push(await page.locator('.plot').evaluate(el => el.style.cursor))
  }
  assert.ok(seen.every(c => c === 'text'), JSON.stringify(seen))
  assert.match(await code(), /\.mark\([\d.]+, 'Hello'\)/)
})

// A marker's line, a moment's or a range's end, points as it is neared (a hand, lit) and takes a press onto it: the
// caret goes to the marker's time, not to the pixel pressed; with snapping off, the pixel's
test('editor: markers: a press by a marker line puts the caret on it', async () => {
  await open()
  await write(`audio('chime.wav').mark(2).mark({ at: 5, d: 1 })`)
  await lengthIs('0:08.000')
  const { box, x } = await axis(8), y = box.y + box.height * .3
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
// it (fn/meta.js), not drawn back onto the sound's last sample; its flag drags on into the silence, to the end at most
test('editor: markers: one in silence past the sound stays there, and drags on within it', async () => {
  await open()
  await write(`audio('chime.wav').pad(0, 2).mark(9)`)
  await lengthIs('0:10.000')
  const { box, x } = await axis(10), y = box.y + box.height * .3, row = box.y + 4
  const caret = async () => +(await page.locator('.time').innerText()).split(':')[1]
  await page.mouse.click(...await grab([[x(9) + 4, y]], 'pointer'))
  assert.equal(await caret(), 9, 'its line where it was put, from the output')
  await drag(await grab([[x(9), row]], 'pointer'), [x(9.5) - x(9), 0])
  await page.waitForFunction(() => Math.abs(+(scriptText().match(/\.mark\(([\d.]+)\)/)?.[1]) - 9.5) < .05)
  // dragged past the end, to the end
  await drag(await grab([[x(9.5), row]], 'pointer'), [x(11) - x(9.5), 0])
  await page.waitForFunction(() => +(scriptText().match(/\.mark\(([\d.]+)\)/)?.[1]) === 10)
  await write(`audio('chime.wav').pad(0, 2).mark(9.75)`)
  await page.mouse.click(...await grab([[x(9.75) + 4, y]], 'pointer'))
  assert.equal(await caret(), 9.75)
})

// A press on a marker's flag chooses it, and Delete takes it away, not the audio: a range's selects its audio as well,
// which stays. A press anywhere else, or Escape, and Delete is what it was
test('editor: markers: Delete takes away the marker whose flag was pressed', async () => {
  await open()
  await noCues()
  await write(`audio('chime.wav').mark(2).mark({ at: 5, d: 1 })`)
  await lengthIs('0:08.000')
  const { box, x } = await axis(8), y = box.y + box.height * .3, row = box.y + 4
  // chosen, then let go of: Delete with nothing selected does nothing
  await page.mouse.click(...await grab([[x(2), row]], 'pointer'))
  await page.keyboard.press('Escape')
  await page.keyboard.press('Delete')
  await page.waitForTimeout(300)
  assert.equal(await code(), `audio('chime.wav').mark(2).mark({ at: 5, d: 1 })`)
  await page.mouse.click(x(2), row)
  await page.mouse.click(x(4), y)
  await page.keyboard.press('Delete')
  await page.waitForTimeout(300)
  assert.equal(await code(), `audio('chime.wav').mark(2).mark({ at: 5, d: 1 })`)
  // a moment's
  await page.mouse.click(x(2), row)
  await page.keyboard.press('Delete')
  await page.waitForFunction(() => scriptText() === `audio('chime.wav').mark({ at: 5, d: 1 })`)
  // a range's: its audio selected, kept
  await page.mouse.click(x(5.5), row)
  assert.equal(await selected(), '0:05.000–0:06.000')
  await page.keyboard.press('Backspace')
  await page.waitForFunction(() => scriptText() === `audio('chime.wav')`)
  assert.equal(await selected(), '0:05.000–0:06.000')
  await lengthIs('0:08.000')
})

// A selection's top corners, each drawn as the fade it makes, fade it: inward, in from its start or out to its end;
// outward, past its edge, the audio out there goes, crossfading into the selection (fn/crossfade.js). A click on one
// turns the curve to the next: the fade just made takes it, and so do the next.
test('editor: a selection fades from its top corners: inward from its edge, outward a crossfade, on the curve turned to', async () => {
  await open()
  await noCues()
  await write(`audio('chime.wav')`)
  await lengthIs('0:08.000')
  const { box, x } = await axis(8), y = box.y + box.height * .3, dot = box.y + 9
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
  await menu('Process', 'Repair', 'denoise')
  await page.locator('.message', { hasText: 'Select where the noise plays alone first.' }).waitFor()
  const { box, x } = await axis(8), y = box.y + box.height * .3, readout = await page.locator('.readout').innerText()
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
  const at = await axis(2.5)
  await page.mouse.dblclick(at.x(.45), at.box.y + at.box.height / 3)
  await page.keyboard.press('ControlOrMeta+D')
  await page.keyboard.press('ControlOrMeta+D')
  await palette('The noise alone in all 3')
  await page.waitForFunction(() => /\.denoise\(\{ noise: \[\{ at: [\d.]+, d: [\d.]+ \}(, \{ at: [\d.]+, d: [\d.]+ \}){2}\] \}\)$/.test(scriptText()))
  // a box on the spectrogram: its time where the noise plays alone, its band where it goes, the rest as it was
  await page.keyboard.press('ControlOrMeta+Z')
  await show('spec')
  const lane = at.box.height - 22
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
  const { box, x } = await axis(6.525), y = box.y + box.height * .3
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
  const { box, x, y } = await chime(), lh = (box.height - 22 - LANES) / 2
  await settings('Times in', 'samples')
  await page.mouse.click(x(7.5), y)
  await drag([x(1), y], [x(1.7) - x(1), 0])
  assert.equal(await selected(), '44100–74970')
  const grip = await grab([[x(1.7) + 8, box.y + lh - 24]], /^url\(|ew-resize/)
  await drag(grip, [x(2.07) - x(1.7) + 3, 0])
  await page.waitForFunction(() => /\.stretch\(/.test(scriptText()))
  const [a, to] = (await selected()).split('–').map(Number)
  // its length, in the samples the times are in, no longer 8 s'
  await page.waitForFunction(() => !document.querySelector('.source').title.endsWith(' · 352800'))
  // all of it selected, in samples: 0 to its length
  await page.locator('.plot').focus()
  await page.keyboard.press('ControlOrMeta+A')
  const total = +(await selected()).split('–')[1]
  assert.equal(total - 8 * 44100, to - a - 30870, await code())
})

test('editor: a selection\'s grip only stretches it, its pill dragged up only sets its level', async () => {
  await open()
  await noCues()
  await write(`audio('chime.wav')`)
  await lengthIs('0:08.000')
  const { box, x } = await axis(8), y = box.y + box.height * .3, lh = (box.height - 22 - LANES) / 2
  const select = async () => { await page.mouse.click(x(7.5), y); await drag([x(2.2), y], [x(4.2) - x(2.2), 0]) }
  await select()
  await drag(await grab([[x(4.2) + 8, box.y + lh - 24], [x(4.2) + 8, box.y + lh + LANES + lh - 24]], STRETCHING), [x(5.2) - x(4.2), -80])
  await page.waitForFunction(() => /\.stretch\(1\.5, \{ at: 2\.2, d: 2 \}\)$/.test(scriptText()))
  assert.equal(await selected(), '0:02.200–0:05.200')
  assert.doesNotMatch(await code(), /gain/)
  await page.keyboard.press('ControlOrMeta+Z')
  await page.waitForFunction(() => !scriptText().includes('stretch'))
  // the 8 s output back in view before selecting on it: x() maps 8 s, and the 9 s stretched one may still show
  await lengthIs('0:08.000')
  await select()
  await drag(await grab([[(x(2.2) + x(4.2)) / 2, box.y + 4]], 'ns-resize'), [60, -80])
  await page.waitForFunction(() => /\.gain\(\{ t: \[2\.2, 2\.205, 4\.195, 4\.2\], v: \[0, [\d.]+, [\d.]+, 0\] \}\)$/.test(scriptText()))
  assert.doesNotMatch(await code(), /stretch/)
})

// A dragged edge, or the caret, goes onto a cue it comes within a few pixels of, as Figma's objects snap; one short of
// it stays
test('editor: a selection\'s dragged edge, or the caret, snaps to a cue near it', async () => {
  await open()
  await write(hits)
  await lengthIs('0:02.000')
  const { box, x } = await axis(2), y = box.y + box.height * .3
  let cues = []
  for (const until = Date.now() + 8000; cues.length < 3 && Date.now() < until; await page.waitForTimeout(200)) cues = await handles()
  const at = cues.find(h => Math.abs(h - (x(1) - box.x)) < 20)
  await drag([x(.7), y], [box.x + at + 2 - x(.7), 0])
  const end = +(await selected()).split('–')[1].split(':')[1]
  assert.ok(Math.abs(end - 1) < .012, `on the cue at 1 s, where the hit starts: ${end}`)
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
  await menu('View', 'Cues')
  await page.mouse.click(x(1.8), y)
  await drag([x(.7), y], [box.x + at + 2 - x(.7), 0])
  assert.ok(Math.abs(+(await selected()).split('–')[1].split(':')[1] - end) < .012, 'snapped, hidden')
})

// Crossfade on a selection, as an editor's: the audio either side meets across it, and it goes (fn/crossfade.js)
test('editor: the crossfade tool on a selection crossfades across it', async () => {
  await open()
  await noCues()
  await write(`audio('chime.wav')`)
  await lengthIs('0:08.000')
  const { box, x } = await axis(8), y = box.y + box.height * .3
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
  await menu('File', 'Samples', 'handpan.wav')
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
  await page.locator('.readout', { hasText: 'LUFS' }).waitFor()
  assert.deepEqual(await tabs(), ['chime.wav', 'handpan.wav'])
  assert.equal(await shown(), `audio('handpan.wav').gain(-6)`)
  // a link's script: in a tab of its own, or in the tab that holds it already
  const link = text => page.evaluate(async text => {
    const bytes = new Uint8Array(await new Response(new Blob([text]).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer())
    return location.origin + '/playground.html#code=' + btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  }, text)
  const visit = async url => { await page.goto(url); await page.reload(); await page.locator('.readout', { hasText: 'LUFS' }).waitFor() }
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
  await menu('File', 'Samples', 'handpan.wav')
  await page.waitForFunction(() => scriptText().trim() === "audio('handpan.wav')")
  await page.getByRole('tab', { name: 'chime.wav' }).click()
  await page.waitForFunction(was => document.querySelector('.clock').title.startsWith(`Selected ${was}:`), was)
  await menu('File', 'Close tab')
  assert.deepEqual(await tabs(), ['handpan.wav'])
  await page.locator('.plot').focus()
  await page.keyboard.press('ControlOrMeta+Shift+T')
  assert.deepEqual(await tabs(), ['chime.wav', 'handpan.wav'])
  assert.equal(scriptOf(await code()), `audio('chime.wav').gain(-3)`)
  await page.waitForFunction(was => document.querySelector('.clock').title.startsWith(`Selected ${was}:`), was)
  // in this visit, the tab itself: its history with it
  await menu('Edit', 'Undo')
  await page.waitForFunction(() => !scriptText().includes('gain(-3)'))
  await menu('Edit', 'Redo')
  // closed, and the page reloaded: kept, in the menu
  await menu('File', 'Close tab')
  await page.waitForTimeout(100)
  await page.reload()
  await page.locator('.readout', { hasText: 'LUFS' }).waitFor()
  assert.deepEqual(await tabs(), ['handpan.wav'])
  await menu('File', 'Reopen closed tab')
  assert.deepEqual(await tabs(), ['chime.wav', 'handpan.wav'])
  await lengthIs('0:08.000')
  await page.waitForFunction(was => document.querySelector('.clock').title.startsWith(`Selected ${was}:`), was)
  // none left to open
  await page.locator('.menubar-item', { hasText: /^File$/ }).click()
  assert.equal(await menuRow('Reopen closed tab').getAttribute('aria-disabled'), 'true')
})

// A recording, the only copy there is, is kept until the person deletes it: its tab closed and the page reloaded, it
// waits under Kept sounds, opened again from there; deleted only once they say so
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
test('editor: a recording is kept until it is deleted: its tab closed, it waits under Kept sounds', async () => {
  await open()
  await write('')
  await page.locator('.empty').waitFor()
  await recordFor(1)
  await page.locator('.plot').focus()
  await page.keyboard.press('Space')
  await page.waitForFunction(() => scriptText().startsWith("audio('recording.wav')"))
  await page.locator('.readout', { hasText: 'LUFS' }).waitFor()
  const before = await lengthText()
  // kept as a file, the parts it was written in as it came let go
  for (const until = Date.now() + 5000; (await keptFiles()).join() !== 'recording.wav' || await takesLeft(); await page.waitForTimeout(100))
    assert.ok(Date.now() < until, `kept: ${await keptFiles()}, ${await takesLeft()} takes left`)
  await menu('File', 'Close tab')
  await page.reload()
  await page.locator('.empty').waitFor()
  assert.deepEqual(await keptFiles(), ['recording.wav'])
  await menu('File', 'Kept sounds', 'recording.wav')
  await page.waitForFunction(() => scriptText().startsWith("audio('recording.wav')"))
  await page.locator('.readout', { hasText: 'LUFS' }).waitFor()
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
  await menu('File', 'Kept sounds', 'Delete them…')
  await page.waitForTimeout(200)
  assert.deepEqual(await keptFiles(), ['recording-2.wav', 'recording.wav'])
  page.once('dialog', d => { assert.match(d.message(), /^Delete recording\.wav kept in this browser/); d.accept() })
  await menu('File', 'Kept sounds', 'Delete them…')
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
  await page.locator('.readout', { hasText: 'LUFS' }).waitFor()
  await page.locator('.message', { hasText: 'recording.wav, recorded as the page closed, is kept.' }).waitFor()
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
  const script = p => p.evaluate(() => [...document.querySelectorAll('.cm-content .cm-line')].map(l => l.textContent).join('\n'))
  try {
    for (const p of [first, second]) p.on('pageerror', e => errors.push(e.message))
    await first.goto(origin + '/playground.html')
    await first.locator('.readout', { hasText: 'LUFS' }).waitFor()
    await first.getByRole('tab', { name: 'Code' }).click()
    await first.locator('.cm-content').click()
    await first.keyboard.press('ControlOrMeta+End')
    await first.keyboard.insertText('.gain(-2)')
    await second.goto(origin + '/playground.html')
    // the page asking came up as it was stored, behind the question; once the first has stored, it reads it again
    await Promise.all([second.waitForEvent('load'), second.getByRole('button', { name: 'Use it here' }).click()])
    await second.locator('.readout', { hasText: 'LUFS' }).waitFor()
    assert.match(scriptOf(await script(second)), /\.gain\(-2\)$/, 'the change made a moment before')
    await first.locator('dialog.elsewhere[open]').waitFor()
    // and back, with one click there
    await Promise.all([first.waitForEvent('load'), first.getByRole('button', { name: 'Use it here' }).click()])
    await first.locator('.readout', { hasText: 'LUFS' }).waitFor()
    await second.locator('dialog.elsewhere[open]').waitFor()
    assert.match(scriptOf(await script(first)), /\.gain\(-2\)$/)
  } finally { await context.close() }
})

// Every setting kept comes back as it was kept; a value the page no longer has, its default; a store that does not read
// is set aside, not written over
test('editor: every setting comes back as it was kept; one the page no longer has, its default', async () => {
  const all = { display: 'spec', scale: 'mel', format: 'flac', encoding: { markers: false, bitDepth: 24 }, spec: 'podcast', cuts: { format: 'otio', fps: 25 }, side: 'code', show: { hits: false, gain: false, meters: false, guides: false }, units: 'samples', snap: false, curve: 'cos', levels: 'db', ruler: 'ticks', step: 3, look: { map: 'magma', gamma: .5, depth: 100, size: 2048, method: 'tapers' }, wave: { colour: 'temperature', lanes: 'one', fill: 'flat' }, agent: { url: 'http://127.0.0.1:7778', key: '' }, splice: 20, scrub: 'grains', grip: 'speed', pitch: false, speed: 1.5 }
  await page.addInitScript(all => { if (!sessionStorage.seeded) { sessionStorage.seeded = 1; localStorage.setItem('audio-repl', JSON.stringify({ ...all, docs: [{ code: "audio('chime.wav')" }] })) } }, all)
  await open()
  const kept = () => page.evaluate(() => JSON.parse(localStorage.getItem('audio-repl')))
  const now = await kept()
  for (const [key, value] of Object.entries(all)) assert.deepEqual(now[key], value, key)
  // written from another page of the site, so the editor's own store as it closes doesn't write over it
  const seed = async value => { await page.goto(origin + '/blank.html'); await page.evaluate(v => localStorage.setItem('audio-repl', v), value); await page.goto(origin + '/playground.html') }
  await seed(JSON.stringify({ units: 'bogus', ruler: 7, step: 'x', format: 'wma', look: { map: 'nope', gamma: 2 }, spec: 'radio', docs: [{ code: 5 }, { code: "audio('chime.wav')" }] }))
  await page.locator('.readout', { hasText: 'LUFS' }).waitFor()
  const fixed = await kept()
  assert.deepEqual([fixed.units, fixed.ruler, fixed.step, fixed.format, fixed.look.map, fixed.look.gamma, fixed.spec, fixed.docs.length], ['clock', 'labels', 1, 'wav', 'grey', 1, '', 1])
  await seed('{"docs": [{"code": "audio(\'chime.wav\')"')
  await page.locator('.readout', { hasText: 'LUFS' }).waitFor()
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
  const box = await page.locator('.plot').boundingBox(), ax = box.x + box.width - 26, ay = box.y + (box.height - 22) / 2
  // the waveform's height: bright pixels down the middle column
  const height = () => pixels(`const x = w >> 1; let n = 0; for (let y = 0; y < h - 48; y++) { const i = (y * w + x) * 4; if (d[i] > 120) n++ } return n`)
  const before = await height()
  await page.mouse.move(ax, ay)
  for (let i = 0; i < 6; i++) { await page.keyboard.down('Control'); await page.mouse.wheel(0, -100); await page.keyboard.up('Control') }
  await page.waitForTimeout(300)
  const zoomed = await height()
  assert.ok(zoomed > before * 4, `the quiet sine fills the lane: ${before} → ${zoomed} px`)
  await page.locator('.plot').focus()
  await page.keyboard.press('0')
  await page.waitForTimeout(300)
  assert.ok(Math.abs(await height() - before) <= 2, 'full scale again')
  // small steps, as a trackpad's pinch gives, leave full scale too (full scale once held them there, every step within
  // 6% of it snapping back, the way out as the way in)
  await page.mouse.move(ax, ay)
  for (let i = 0; i < 35; i++) { await page.keyboard.down('Control'); await page.mouse.wheel(0, -2); await page.keyboard.up('Control') }
  await page.waitForTimeout(300)
  assert.ok(await height() > before * 1.5, 'small steps zoom in')
  // in sample values: the pointer on the lane's top edge reads 1
  await page.getByRole('tab', { name: 'Waveform', exact: true }).click({ button: 'right' })
  await choice('Levels in', 'Sample values').click()
  await page.keyboard.press('Escape')
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('audio-repl')).levels), 'linear')
})

// What goes over full scale: the time row underlined red where the output clips (stat('clipping')), and zoomed out, the
// levels past ±1 tinted red
test('editor: where the output clips is underlined red on the time row; zoomed out, past full scale is red', async () => {
  await open()
  await write(`audio.from(t => (t > 0.5 ? 1.5 : 0.5) * Math.sin(2 * Math.PI * 220 * t), { duration: 1 })`)
  await lengthIs('0:01.000')
  await page.waitForTimeout(800)
  const box = await page.locator('.plot').boundingBox(), h = box.height - 22, w = box.width - GUTTER
  // red pixels in the row under the lanes: their first and last x, as a share of the plot's width
  const red = () => pixels(`const y = Math.round(arg + 1), xs = []; for (let x = 0; x < w; x++) { const i = (y * w + x) * 4; if (d[i] - d[i + 2] > 80 && d[i] > 120) xs.push(x) } return xs.length ? [xs[0], xs.at(-1)] : []`, h)
  const [first, last] = await red()
  assert.ok(Math.abs(first / w - .5) < .03 && last / w > .95, `clipping from ${first / w} to ${last / w} of the width`)
  // zoomed out past full scale: a red tint over what lies beyond ±1
  const tint = () => pixels(`const x = Math.round(arg), y = 3, i = (y * w + x) * 4; return d[i] - d[i + 2]`, w * .25)
  const flat = await tint()
  await page.mouse.move(box.x + box.width - 26, box.y + h / 2)
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
  await page.addInitScript(() => localStorage.setItem('audio-repl', JSON.stringify({ side: null, show: { hits: true, pitch: true, gain: true, meters: true } })))
  await open()
  await write(`audio.from(t => 0.8 * Math.sin(2 * Math.PI * 220 * t), { duration: 1 })`)
  await lengthIs('0:01.000')
  await page.waitForTimeout(800)
  const box = await page.locator('.plot').boundingBox(), w = box.width - GUTTER
  // bright pixels down a column of the lanes
  const lit = at => pixels(`const x = Math.round(arg); let n = 0; for (let y = 0; y < h - 30; y++) { const i = (y * w + x) * 4; if (d[i] + d[i + 1] + d[i + 2] > 300) n++ } return n`, at)
  assert.ok(await lit(w - 40) > 20, 'the waveform runs up to the meters')
  assert.equal(await lit(w - 9), 0, 'and stops before the level bar')
  // all of it shown, its end 4 px short of where the lanes end (view.js TAIL), 2 px before the bar, 2 px before the
  // spectrum on the spectrogram: its last moment in sight, never behind the meters
  assert.ok(await lit(w - 14) > 20, 'its last moment by the bar')
  assert.equal(await lit(w - 12), 0, 'its end 6 px before it')
  await show('spec')
  await page.waitForTimeout(800)
  assert.ok(await lit(w - 49) > 0, 'its last moment by the spectrum')
  assert.equal(await lit(w - 47), 0, 'its end 6 px before it')
})

// Crop is clicked, never dragged, so it is no handle: the context menu has it, and K
test('editor: the context menu, or K, keeps only the selection', async () => {
  await open()
  await noCues()
  await write(`audio('chime.wav')`)
  await lengthIs('0:08.000')
  const { box, x } = await axis(8), y = box.y + box.height * .3
  await drag([x(2), y], [x(4) - x(2), 0])
  await page.mouse.click(x(3), y, { button: 'right' })
  await page.locator('.menubar-menu .menu-row', { has: page.locator('.menu-label', { hasText: /^Keep only this$/ }) }).click()
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
  const { box, x } = await axis(8), top = box.y + (box.height - 22) * .25, bottom = box.y + (box.height - 22) * .75
  await drag([x(2), top], [x(3) - x(2), 0])
  await page.mouse.click(x(2.5), top, { button: 'right' })
  await contextRow('Move to a new track').click()
  await page.waitForFunction(() => scriptText().includes('let chime2 = '))
  assert.equal(await code(), `let chime = audio('chime.wav')\n  .gain(-Infinity, { at: 2, d: 1 })\n\nlet chime2 = audio('chime.wav')\n  .crop({ at: 2, d: 1 })\n  .pad(2, 0)`)
  await page.waitForFunction(() => document.querySelector('.steps-list .step-name')?.textContent === 'chime2 · chime.wav')
  // its output: a lane each, the lower the piece alone, nothing after it where the upper has the sound
  await page.waitForFunction(() => document.querySelector('.plot').dataset.tracks === '2')
  await lengthIs('0:08.000')
  await page.waitForTimeout(600)
  const [upper, lower] = await pixels(`const k = w / arg.width, mid = (h - 22 * k) / 2, lit = [0, 0]
    for (let y = 0; y < h - 22 * k; y++) for (let x = Math.round(arg.a * k); x < Math.round(arg.b * k); x++) { const i = (y * w + x) * 4; if (d[i] + d[i + 1] + d[i + 2] > 300) lit[y < mid ? 0 : 1]++ }
    return lit`, { width: box.width, a: x(4.5) - box.x, b: x(7) - box.x })
  assert.ok(upper > 1000 && lower < upper / 20, `4.5 s to 7 s: the upper lane ${upper} lit, the lower ${lower}`)
  assert.equal(await selected(), '0:02.000–0:03.000', 'the piece stays selected, in its own lane')
  // the upper lane: the first track's, a range deleted there alone
  await page.mouse.click(x(6), top)
  await page.waitForFunction(() => document.querySelector('.steps-list .step-name')?.textContent === 'chime · chime.wav')
  await drag([x(5), top], [x(6) - x(5), 0])
  await page.keyboard.press('Backspace')
  await page.waitForFunction(() => /\.gain\(-Infinity, \{ at: 2, d: 1 \}\)\n {2}\.remove\(\{ at: 5, d: 1(, xfade: [\d.]+)? \}\)\n\nlet chime2/.test(scriptText()))
  await lengthIs('0:07.000')
  // the lower lane's track taken away: one sound, its steps as they were
  await page.mouse.click(x(1), bottom)
  await page.waitForFunction(() => document.querySelector('.steps-list .step-name')?.textContent === 'chime2 · chime.wav')
  await menu('Edit', 'Delete the track')
  await page.waitForFunction(() => !scriptText().includes('chime2'))
  assert.equal(await card(), 'chime.wav')
  await page.waitForFunction(() => !('tracks' in document.querySelector('.plot').dataset))
  await page.keyboard.press('ControlOrMeta+Z')
  await page.waitForFunction(() => scriptText().includes('let chime2 = ') && document.querySelector('.plot').dataset.tracks === '2')
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
  await page.mouse.click(x(1), box.y + box.height * .3)
  await page.mouse.click(x(1), box.y + box.height * .3, { button: 'right' })
  await contextRow('Split the voice to a new track').click()
  await page.waitForFunction(() => scriptText().includes('let voice = '))
  // headless Chromium's WebGPU is SwiftShader, on the CPU: the split takes SCNet-large there (Mel-RoFormer on a GPU)
  assert.equal(await code(), `let chime = audio('chime.wav')\n  .vocals('remove', { model: 'scnet-large' })\n\nlet voice = audio('chime.wav')\n  .vocals({ model: 'scnet-large' })`)
  await page.waitForFunction(() => document.querySelector('.steps-list .step-name')?.textContent === 'voice · chime.wav')
  await page.keyboard.press('ControlOrMeta+Z')
  await page.waitForFunction(() => !scriptText().includes('voice'))
  await menu('Edit', 'Split the voice to a new track')
  await page.waitForFunction(() => scriptText().includes('let voice = '))
})

// A part taken elsewhere and brought back: a track exported alone, named after it; another lined up with it (the Edit
// menu), its sound written out as the reference, so both stay tracks
test('editor: a track exported alone; another lined up with it, both tracks still', async () => {
  await open()
  await write(`let chime = audio('chime.wav')\n\nlet late = audio('chime.wav')\n  .pad(0.25, 0)`)
  await page.waitForFunction(() => document.querySelector('.plot').dataset.tracks === '2')
  await page.waitForFunction(() => document.querySelector('.steps-list .step-name')?.textContent === 'late · chime.wav')
  const [d] = await Promise.all([page.waitForEvent('download'), menu('File', 'Export the track alone')])
  assert.match(d.suggestedFilename(), /-late\.\w+$/)
  const alone = await audio(await readFile(await d.path()))
  await alone.read()
  assert.ok(Math.abs(alone.duration - 8.25) < .01, `that track alone, 0.25 s late: ${alone.duration} s`)
  await menu('Edit', 'Line up with', 'chime')
  await page.waitForFunction(() => scriptText().includes('.align('))
  assert.equal(await code(), `let chime = audio('chime.wav')\n\nlet late = audio('chime.wav')\n  .pad(0.25, 0)\n  .align(audio('chime.wav'))`)
  await page.waitForFunction(() => document.querySelector('.plot').dataset.tracks === '2')
  await lengthIs('0:08.000')
})

// The markers are every track's: one a track not edited set is taken away from its flag all the same, its mark() gone
test('editor: with tracks, a marker of a track not edited is taken away from its flag', async () => {
  await open()
  await write(`let a = audio('chime.wav')\n  .mark(1, 'here')\n\nlet b = audio('chime.wav')\n  .gain(-6)`)
  await page.waitForFunction(() => document.querySelector('.plot').dataset.tracks === '2')
  await lengthIs('0:08.000')
  const { box, x } = await axis(8)
  await page.mouse.click(x(1), box.y + 4, { button: 'right' })
  await contextRow('Delete the marker').click()
  await page.waitForFunction(() => !scriptText().includes('.mark('))
  assert.match(await code(), /^let a = audio\('chime.wav'\)\s*let b = audio\('chime.wav'\)\n {2}\.gain\(-6\)$/)
})

// A slice of a track dragged onto the tabs: a tab of that track's alone, its chain cropped to it
test('editor: with tracks, a slice dragged onto the tabs is the edited track\'s alone', async () => {
  await open()
  await noCues()
  await write(`let a = audio('chime.wav')\n\nlet b = audio('chime.wav')\n  .gain(-6)`)
  await page.waitForFunction(() => document.querySelector('.plot').dataset.tracks === '2')
  await lengthIs('0:08.000')
  const { box, x } = await axis(8), y = box.y + (box.height - 22) * .75, files = await page.locator('.files').boundingBox()
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
  await page.waitForFunction(level => document.querySelector('.readout').innerText === level, level)
})

// A file opened as a track of its own (File): under the one edited, named for it, the one edited after; the sound as
// long as the longer of the two
test('editor: a file opened as a new track goes under the one edited', async () => {
  await open()
  await write(`audio('chime.wav')`)
  await lengthIs('0:08.000')
  const chooser = page.waitForEvent('filechooser')
  await menu('File', 'Open as a new track…')
  await (await chooser).setFiles({ name: 'bed.wav', mimeType: 'audio/wav', buffer: await wavBytes([sine(10, 220, .1)]) })
  await page.waitForFunction(() => scriptText().includes('let bed = '))
  assert.equal(await code(), `let chime = audio('chime.wav')\n\nlet bed = audio('bed.wav')`)
  await page.waitForFunction(() => document.querySelector('.plot').dataset.tracks === '2')
  await lengthIs('0:10.000')
  assert.equal(await page.locator('.steps-list .step-name').first().textContent(), 'bed · bed.wav')
})

// A click seen on the picture: selected, the context menu's Repair takes the clicks out there alone (declick over the
// range), or rebuilds all of it from around it (repair); the length kept. Every method is there by its kind
test('editor: the context menu takes the clicks out of the selection, or rebuilds it', async () => {
  await open()
  await noCues()
  await write(`audio('chime.wav')`)
  await lengthIs('0:08.000')
  const { box, x } = await axis(8), y = box.y + box.height * .3
  await drag([x(2), y], [x(4) - x(2), 0])
  await page.mouse.click(x(3), y, { button: 'right' })
  await menuRow('Repair').click()
  await menuRow('Remove the clicks here').click()
  await page.waitForFunction(() => /\.declick\(\{ at: 2(\.0\d*)?, d: 2(\.0\d*)? \}\)$/.test(scriptText().trim()))
  await page.mouse.click(x(3), y, { button: 'right' })
  await menuRow('Repair').click()
  await menuRow('Rebuild from around it').click()
  await page.waitForFunction(() => /\.repair\(\{ at: 2(\.0\d*)?, d: 2(\.0\d*)? \}\)$/.test(scriptText().trim()))
  await lengthIs('0:08.000')
  // any method, by its kind: a filter over the selection
  await page.mouse.click(x(3), y, { button: 'right' })
  await menuRow('Filter').click()
  // what each does, said in its row (the menus' words once took the tooltip's place, all at the window's corner)
  const row = await menuRow('highpass').boundingBox(), said = await menuRow('highpass').locator('.menu-keys').boundingBox()
  assert.ok(said.y >= row.y && said.y + said.height <= row.y + row.height + 1 && said.x > row.x, 'its words in its row')
  assert.equal(await menuRow('highpass').locator('.menu-keys').innerText(), 'Cut lows')
  await menuRow('highpass').click()
  await page.waitForFunction(() => /\.highpass\(80, \{ at: 2(\.0\d*)?, d: 2(\.0\d*)? \}\)$/.test(scriptText().trim()))
})

// With nothing selected, the square past the caret, where a selection's stretch square is, pulls silence open there:
// insert() of the length it is dragged, what follows moving on
test('editor: the square past the caret opens silence there', async () => {
  await open()
  await noCues()
  await write(`audio('chime.wav')`)
  await lengthIs('0:08.000')
  const { box, x } = await axis(8), lh = (box.height - 22 - LANES) / 2
  await page.mouse.click(x(2), box.y + box.height * .3)
  // its pointer trim's, as it does what trimming out does
  await drag(await grab([[x(2) + 9, box.y + lh - 24]], 'ew-resize'), [x(3) - x(2), 0])
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
  const { box, x } = await axis(8), lh = (box.height - 22 - LANES) / 2
  await page.locator('.plot').focus()
  await page.keyboard.press('End')
  const at = await grab([[x(8) - 8, box.y + lh - 24]], 'ew-resize')
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
  await page.waitForFunction(total => { const [m, s] = document.querySelector('.source').title.split(' · ').pop().split(':'); return Math.abs(+m * 60 + +s - total) < 1e-3 }, 8 + d)
})

// The fade squares on whole pixels, flush with what they sit by and never over it: the one in from the pixel after the
// caret's line at the selection's start, the one out to the selection's last pixel, 16 px each, their edges as dark as
// their middles (no half pixel blurred), the wash either side of them. On silence, so only the wash and the squares show
test('editor: a selection\'s fade squares sit on whole pixels, flush with its start\'s line and its end', async () => {
  await open()
  await noCues()
  await write(`audio.from(2)`)
  await lengthIs('0:02.000')
  const { box, x } = await axis(2)
  await drag([x(.5) + .3, box.y + 60], [x(1.5) - x(.5), 0])
  await page.mouse.move(box.x + 5, box.y + box.height - 30)
  await page.waitForTimeout(300)
  const r = await pixels(`
    const at = (px, y) => d[(y * w + px) * 4]
    // on a row under the squares: the caret's line, the brightest, and the wash's last column
    let line = 0, end = -1
    for (let px = 1; px < w - 60; px++) { if (at(px, 40) > at(line, 40)) line = px; if (at(px, 40) > at(px + 1, 40) + 4) end = px }
    return { line, end, row: [line + 1, line + 8, line + 16, line + 17, end - 16, end - 15, end - 8, end].map(px => at(px, 1)) }`)
  const [in0, inMid, in1, washIn, washOut, out0, outMid, out1] = r.row
  assert.ok(in0 < washIn - 4 && in1 < washIn - 4 && out0 < washOut - 4 && out1 < washOut - 4, `squares darker than the wash at their edges: ${JSON.stringify(r)}`)
  assert.ok(Math.abs(in0 - inMid) <= 2 && Math.abs(in1 - inMid) <= 2 && Math.abs(out0 - outMid) <= 2 && Math.abs(out1 - outMid) <= 2, `edges as dark as middles: ${JSON.stringify(r)}`)
})

// Handles are for editing: while it plays there are none, the caret's square past it too
test('editor: no handles while it plays', async () => {
  const { box, x, y } = await chime(), lh = (box.height - 22 - LANES) / 2, at = [x(2) + 9, box.y + lh - 24]
  await page.mouse.click(x(2), y)
  await grab([at], 'ew-resize')
  await page.keyboard.press('Space')
  await page.waitForFunction(() => document.querySelector('.time').textContent !== '0:02.000')
  await page.mouse.move(at[0] + 1, at[1])
  assert.equal(await page.locator('.plot').evaluate(el => el.style.cursor), '')
  await page.keyboard.press('Space')
  await page.getByRole('button', { name: 'Play' }).waitFor()
})

// A selection, as a text's: the arrows move the caret and keep it; a press on the time row moves only the caret, as
// Audacity's; Play goes on from the caret inside it, and paused, from where it paused; a click inside it, as anywhere,
// leaves the caret there alone
test('editor: the caret moves within a selection from the time row or the arrows; Play goes on from it; a click drops it', async () => {
  await open()
  await noCues()
  await write(`audio('chime.wav')`)
  await lengthIs('0:08.000')
  const { box, x } = await axis(8), y = box.y + box.height * .3, row = box.y + box.height - 11
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
  return { box, x, y: box.y + box.height * .3, ranges: async () => (await page.locator('.clock').getAttribute('title')).match(/^Selected (\d+) ranges: ([\d:.]+),/)?.slice(1) ?? [] }
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

test('editor: a press inside the selection drops it at once, not when let go', async () => {
  const { x, y } = await chime()
  await drag([x(1), y], [x(3) - x(1), 0])
  await page.mouse.move(x(2), y)
  await page.mouse.down()
  assert.equal(await selected(), '')
  assert.equal(await page.locator('.time').innerText(), '0:02.000')
  await page.mouse.up()
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
// drag going on with it, never another range; held, the pointer an I-beam with a chevron the way it goes
const pointed = () => page.locator('.plot').evaluate(el => decodeURIComponent(el.style.cursor))
test('editor: Shift and a press elsewhere extends the selection at once, a drag going on with it; the pointer says which way', async () => {
  const { x, y, ranges } = await chime()
  await drag([x(1), y], [x(2) - x(1), 0])
  await page.mouse.move(x(4), y)
  await page.keyboard.down('Shift')
  await page.waitForFunction(() => decodeURIComponent(document.querySelector('.plot').style.cursor).includes('M5 9l3 3-3 3'))
  await page.mouse.down()
  assert.equal(await selected(), '0:01.000–0:04.000', 'on the press')
  await page.mouse.move(x(5), y, { steps: 3 })
  await page.mouse.up()
  assert.equal(await selected(), '0:01.000–0:05.000', 'the drag goes on with it')
  assert.deepEqual(await ranges(), [], 'no other range')
  await page.mouse.move(x(.5), y)
  assert.match(await pointed(), /M19 9l-3 3 3 3/, 'before it, the chevron the other way')
  await page.keyboard.up('Shift')
})

// Alt adds, and measures as Figma's: held, the pointer an I-beam with a plus, and a helper line at its height from the
// selection's nearer edge to it, how far it is; let go, none. It shows as the key goes down, before the pointer moves
test('editor: held Alt, the pointer adds, and measures how far it is from the selection', async () => {
  const { box, x, y } = await chime()
  await drag([x(1), y], [x(2) - x(1), 0])
  await page.mouse.move(x(4), y)
  const lit = () => pixels(`let n = 0; const row = ${Math.round(y - box.y)}; for (let px = ${Math.round(x(2) - box.x) + 2}; px < ${Math.round(x(4) - box.x) - 2}; px++) { const i = (row * w + px) * 4; if (d[i] - d[i + 2] > 60) n++ } return n`)
  assert.equal(await lit(), 0)
  await page.keyboard.down('Alt')
  await page.waitForFunction(() => decodeURIComponent(document.querySelector('.plot').style.cursor).includes('M17 13v6'))
  const n = await lit(), span = x(4) - x(2) - 4
  await page.keyboard.up('Alt')
  assert.ok(n > span * .9, `a helper line across ${n} of ${Math.round(span)} px`)
  assert.equal(await lit(), 0, 'gone with the key')
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
// length kept). Each seam crossfaded as a delete's (the settings, 10 ms)
test('editor: dragged inside the selection, Alt puts a copy of its audio in where it lands, ⌘ slides it over what is there', async () => {
  const { x, y } = await chime()
  const before = await seconds()
  await drag([x(1), y], [x(2) - x(1), 0])
  await keyed(['Alt'], () => drag([x(1.5), y], [x(4) - x(1), 0]))
  await page.waitForFunction(() => /\.copy\(\{ at: 1, d: 1 \}\)\.paste\(4, 0\.01\)$/.test(scriptText()))
  assert.equal(await selected(), '0:04.000–0:05.000', 'the copy selected where it went')
  await page.waitForFunction(expected => Math.abs(+document.querySelector('.source').title.split(' · ').pop().split(':')[1] - expected) < .002, before + 1)
  await page.keyboard.press('ControlOrMeta+Z')
  await page.waitForFunction(() => scriptText() === "audio('chime.wav')")
  await page.mouse.click(x(7.5), y)
  await drag([x(1), y], [x(2) - x(1), 0])
  await keyed(['ControlOrMeta'], () => drag([x(1.5), y], [x(4) - x(1), 0]))
  await page.waitForFunction(() => /\.move\(\{ at: 1, d: 1, to: 4, xfade: 0\.01 \}\)$/.test(scriptText()))
  assert.equal(await selected(), '0:04.000–0:05.000', 'the moved audio stays selected where it went')
  await lengthIs('0:08.000')
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
  await drag(await grab([[x(1), y]], 'ew-resize'), [x(2.6) - x(1), 0])
  assert.equal(await page.locator('.time').innerText(), '0:02.500')
  await page.keyboard.press('Delete')
  await page.waitForFunction(() => /\.remove\(\{ at: 4, d: 1, xfade: 0\.01 \}\)$/.test(scriptText()))
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
  const { box, x } = await axis(2.5), y = box.y + box.height / 3
  for (const until = Date.now() + 8000; Date.now() < until; await page.waitForTimeout(200)) { await page.mouse.dblclick(x(.2), y); if (/^0:00\.4/.test((await selected()).split('–')[1] ?? '')) break }
  await page.keyboard.down('Alt'); await page.mouse.dblclick(x(1.7), y); await page.keyboard.up('Alt')
  assert.match(await page.locator('.clock').getAttribute('title'), /^Selected 2 ranges: 0:00\.8/)
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

// A right-click, as in a text: inside the selection, the edits for it, a method among them written for it; elsewhere the
// caret goes there first, the selection gone, and the menu has what a caret takes
test('editor: a right-click gives the edits for the selection, or puts the caret there and gives the caret\'s', async () => {
  await open()
  await noCues()
  await write(`audio('chime.wav')`)
  await lengthIs('0:08.000')
  const { box, x } = await axis(8), y = box.y + box.height * .3
  const item = name => page.locator('.menubar-menu .menu-row', { has: page.locator('.menu-label', { hasText: new RegExp(`^${name}$`) }) })
  await drag([x(1), y], [x(3) - x(1), 0])
  await page.mouse.click(x(2), y, { button: 'right' })
  // under its kind, Edit, the first of it
  await item('Edit').click()
  await item('Reverse').click()
  await page.waitForFunction(() => /\.reverse\(\{ at: 1, d: 2 \}\)$/.test(scriptText()))
  assert.equal(await page.locator('.menubar-menu').count(), 0)
  // an edit in place: no panel opens over the picture
  assert.equal(await page.locator('.side-slab').isVisible(), false, 'the edits stay closed')
  await page.mouse.click(x(6), y, { button: 'right' })
  assert.equal(await page.locator('.time').innerText(), '0:06.000')
  assert.equal(await item('Cut').count(), 0)
  // Esc closes it, the caret staying
  await page.keyboard.press('Escape')
  await page.locator('.menubar-menu').waitFor({ state: 'detached' })
  await page.mouse.click(x(6), y, { button: 'right' })
  await item('Add a marker').click()
  await page.waitForFunction(() => /\.mark\(6\)$/.test(scriptText()))
})

// Delete closes up the audio either side of what goes, crossfaded over 10 ms so the seam makes no click (remove(),
// fn/remove.js); the settings set it, or turn it off
test('editor: Delete crossfades the seam it leaves, as long as the settings say', async () => {
  await open()
  await noCues()
  await write(`audio('chime.wav')`)
  await lengthIs('0:08.000')
  const { box, x } = await axis(8), y = box.y + box.height * .3
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
  const { box, x } = await axis(8), y = box.y + box.height * .3
  await drag([x(2), y], [x(4) - x(2), 0])
  for (const curve of ['exp', 'log', 'cos', 'linear']) {
    await page.mouse.click(x(2) + 8, box.y + 8)
    assert.equal(await way('curve'), curve)
  }
  assert.equal(await page.locator('[popover]:popover-open').count(), 0)
  assert.match(await selected(), /^0:02\.0\d\d–0:04\.0\d\d$/)
})

test('editor: Alt-click adds carets; M puts a marker at each', async () => {
  await open()
  await write(`audio('chime.wav')`)
  await lengthIs('0:08.000')
  const { box, x } = await axis(8), y = box.y + box.height * .3
  await page.mouse.click(x(2.2), y)
  await page.keyboard.down('Alt')
  await page.mouse.click(x(4.2), y)
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
  const { box, x } = await axis(8), y = box.y + box.height * .3, last = () => code().then(c => c.trim().split('\n').at(-1))
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

// A card's switches: a step turned off (its eye) is commented out where it stands; open, its Δ plays and draws what it
// takes out
test('editor: a step turns off and on, Δ shows what it takes out', async () => {
  await open()
  await tab('Edits')
  const card = name => page.locator('.step', { has: page.locator('.step-name', { hasText: name }) })
  await card('Normalize').hover()
  await page.getByRole('button', { name: 'Turn normalize off' }).click()
  await page.waitForFunction(() => document.querySelector('.cm-content').textContent.includes('// .normalize(-1)'))
  await page.waitForFunction(() => !document.querySelector('.readout').textContent.startsWith('peak −1.0'))
  assert.ok(await card('Normalize').evaluate(el => el.classList.contains('off')))
  await card('Normalize').hover()
  await page.getByRole('button', { name: 'Turn normalize on' }).click()
  await page.waitForFunction(() => !document.querySelector('.cm-content').textContent.includes('//'))
  await page.locator('.readout', { hasText: 'peak −1.0dBFS' }).waitFor()
  // what the fade takes out, from its card open: the start and end it softens, far under the output
  await card('Fade').locator('.step-name').click()
  await card('Fade').getByRole('button', { name: 'Δ What it takes out' }).click()
  await page.locator('.viewing', { hasText: 'What Fade takes out' }).waitFor()
  await page.waitForFunction(() => { const m = document.querySelector('.readout').textContent.match(/^peak −([\d.]+)dBFS/); return m && +m[1] > 6 })
  await card('Fade').getByRole('button', { name: 'Δ What it takes out' }).click()
  await page.locator('.viewing').waitFor({ state: 'detached' })
  await page.locator('.readout', { hasText: 'peak −1.0dBFS' }).waitFor()
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
  await page.waitForFunction(() => document.querySelector('.facts').innerText.replace(/\s+/g, ' ').trim() === '22.05kHz mono')
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
    await page.waitForFunction(to => document.querySelector('.facts').innerText.replace(/\s+/g, ' ').trim() === `22.05kHz ${to}`, to)
  }
  assert.deepEqual(await page.locator('#channels-menu .menu-item strong').allInnerTexts(), ['mono', 'stereo', '5.1', '7.1'])
  // up from mono, the sound in the centre; 5.1 to 7.1, its surrounds in the back pair too; down, the ITU downmix
  await layout('mono', '5.1', '.remix([null, null, 0, null, null, null])')
  await layout('5.1', '7.1', '.remix([0, 1, 2, 3, 4, 5, 4, 5])')
  await layout('7.1', 'stereo', '.remix(2)')
  // stereo to 5.1: the matrix upmix
  await layout('stereo', '5.1', '.surround()')
  assert.equal(await fact(), '22.05kHz 5.1')
})

// Zoomed out past the whole: the sound starts at the left edge, the room on its right; the time row is marked
// An edit that takes a while arrives as it renders, in place of the output shown: the view keeps where it was zoomed to
// (it once showed the whole again, an output of no length said yet read as a new sound)
test('editor: an output rendering in place of the one shown keeps the zoom, the selection and the caret', async () => {
  await open()
  await noCues()
  await write(`audio('chime.wav')`)
  await lengthIs('0:08.000')
  const { box, x } = await axis(8), y = box.y + box.height * .3
  await page.mouse.click(x(4), y)
  await page.locator('.plot').focus()
  for (let i = 0; i < 2; i++) await page.keyboard.press('=')
  await page.waitForTimeout(200)
  // the time at the view's left edge, from a click there
  const left = async () => { await page.mouse.click(box.x + 1, y); return (await page.locator('.time').innerText()).split(':').reduce((m, s) => m * 60 + +s, 0) }
  const before = await left()
  assert.ok(before > 2 && before < 4, `zoomed in about the caret: the view from ${before}`)
  await write(`audio('chime.wav').pitch(3)`)
  await page.waitForFunction(() => !document.querySelector('.message').textContent && document.querySelector('.source').title.endsWith('0:08.000'), null, { timeout: 30000 })
  await page.waitForTimeout(500)
  assert.ok(Math.abs(await left() - before) < .01, 'the view where it was')
  // zoomed in while a sound still arrives, it stays zoomed in once the sound is whole (it went back to all of it)
  await write(`audio('${origin}/slow/test/fixture.wav')`)
  await page.locator('.message', { hasText: /^Decoding/ }).waitFor()
  await page.locator('.plot').focus()
  for (let i = 0; i < 2; i++) await page.keyboard.press('=')
  await page.waitForFunction(() => !document.querySelector('.message').textContent && document.querySelector('.source').title.endsWith('0:02.000'), null, { timeout: 30000 })
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
  const { box, x } = await axis(8), y = box.y + box.height * .3
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
  await page.locator('.readout', { hasText: 'LUFS' }).waitFor()
  await lengthIs('0:08.000')
  await page.waitForTimeout(300)
  assert.ok(Math.abs(await left() - before) < .01, 'and after a reload')
})
// Zoomed in, the scrollbar at the time row's foot (view.js bar): its thumb dragged a quarter of the row across moves the
// view a quarter of the sound on, a press beside it takes the view there; the caret stays where it was. Showing all of
// it, there is none, and a press there moves the caret, as on the rest of the time row
test('editor: zoomed in, the scrollbar at the time row\'s foot moves the view, the caret staying', async () => {
  await open()
  await noCues()
  await write(`audio('chime.wav')`)
  await lengthIs('0:08.000')
  const { box, x } = await axis(8), y = box.y + box.height * .3, foot = box.y + box.height - 3, w = box.width - GUTTER
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
  await page.mouse.move(thumb(before), foot)
  await page.mouse.down()
  await page.mouse.move(thumb(before) + w / 8, foot, { steps: 4 })
  await page.mouse.move(thumb(before) + w / 4, foot, { steps: 4 })
  await page.mouse.up()
  assert.equal(await time(), caret, 'the caret where it was')
  const dragged = await left()
  assert.ok(Math.abs(dragged - before - 2) < .1, `a quarter of the row, a quarter of the sound: from ${before} to ${dragged}`)
  await page.mouse.click(box.x + 4, foot)
  assert.ok(await left() < .05, 'pressed at its start, the view from the start')
})
// A view kept from before shows at once on a reload, the sound coming into it as it arrives, not all of it first
test('editor: after a reload the view is where it was left while its sound still arrives', async () => {
  await open()
  await noCues()
  await write(`audio('${origin}/slow/test/fixture.wav')`)
  await page.waitForFunction(() => !document.querySelector('.message').textContent && document.querySelector('.source').title.endsWith('0:02.000'), null, { timeout: 30000 })
  const { box, x } = await axis(2), y = box.y + box.height * .3
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
  assert.match(await page.locator('.message').textContent(), /^(Decoding…)?$/, 'nothing come yet')
  assert.ok(Date.now() - shown < 1500, 'before the worker came')
  await page.unroute(worker)
  await page.locator('.message', { hasText: /^Decoding/ }).waitFor()
  await page.waitForTimeout(300)
  assert.ok(Math.abs(await left() - before) < .01, 'where it was, while it loads')
  await page.waitForFunction(() => !document.querySelector('.message').textContent && document.querySelector('.source').title.endsWith('0:02.000'), null, { timeout: 30000 })
  await page.waitForTimeout(300)
  assert.ok(Math.abs(await left() - before) < .01, 'and once it is whole')
  // an edit that waits for the whole file (normalize): the file shows dim as it arrives, in the view as it was left
  await write(`audio('${origin}/slow/test/fixture.wav').normalize()`)
  await page.waitForFunction(() => !document.querySelector('.message').textContent && document.querySelector('.source').title.endsWith('0:02.000'), null, { timeout: 30000 })
  await page.waitForTimeout(700)
  await page.reload()
  await page.locator('.message', { hasText: /^Decoding/ }).waitFor()
  await page.waitForTimeout(300)
  assert.ok(Math.abs(await left() - before) < .01, 'the file, dim, where it was')
  await page.waitForFunction(() => !document.querySelector('.message').textContent && document.querySelector('.source').title.endsWith('0:02.000'), null, { timeout: 30000 })
  await page.waitForTimeout(300)
  assert.ok(Math.abs(await left() - before) < .01, 'its output too')
})

// The sound held as it was left, its file gone: the view lets it go and invites a drop, as with nothing kept
test('editor: a view kept for a file no longer here gives way to the drop', async () => {
  await page.addInitScript(() => localStorage.setItem('audio-repl', JSON.stringify({ docs: [{ code: `audio('missing.wav')`, frame: { range: [1, 2], freqs: [0, 1], levels: [-1, 1], duration: 8, rate: 44100, channels: 2 } }] })))
  await page.goto(origin + '/playground.html')
  await page.locator('.empty-title', { hasText: 'Drop audio here' }).waitFor()
  await page.locator('.message.problem', { hasText: 'missing.wav is not open' }).waitFor({ state: 'attached' })
})

// A file arriving shows as the picture shows: on the spectrogram, its spectrogram, dim, as it comes, never a waveform first
test('editor: a file arriving on the spectrogram draws its spectrogram as it comes', async () => {
  await open()
  await show('spec')
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
  await page.locator('.readout', { hasText: 'LUFS' }).waitFor()
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
        undo: Math.round(app.querySelector('.view-head .undo').getBoundingClientRect().x)
      })
      requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  })
  await page.reload()
  await page.locator('.readout', { hasText: 'LUFS' }).waitFor()
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
  assert.equal(heads.size, 1, `nothing over the picture moves as the sound comes: ${[...heads]}`)
})

// The black-and-white spectrogram is screened over the page (editor.js paint): where the sound is quiet the page shows
// through it, scanlines and all, and the louder is the whiter, up to white
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
  const { box } = await axis(8), y = box.y + box.height * .3
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
  const { box, x } = await axis(8), y = box.y + box.height * .3
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
  await page.locator('.readout', { hasText: 'LUFS' }).waitFor()
  await lengthIs('0:02.000')
  assert.equal(await page.locator('.message.problem').count(), 0)
  // gone from the browser
  await page.evaluate(async () => (await navigator.storage.getDirectory()).removeEntry('audio-repl-files', { recursive: true }))
  await page.reload()
  await page.locator('.message.problem', { hasText: "take one.wav is not open here" }).waitFor()
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.getByRole('button', { name: 'Open it…' }).click()])
  await chooser.setFiles({ name: 'elsewhere.wav', mimeType: 'audio/wav', buffer: file })
  await page.locator('.readout', { hasText: 'LUFS' }).waitFor()
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
  await page.locator('.readout', { hasText: 'LUFS' }).waitFor()
  const { box, x } = await axis(2), row = box.y + 4
  const at = async t => { await page.mouse.move(x(t), row); return page.locator('.plot').evaluate(el => el.style.cursor) }
  await grab([[x(0.5), row]], 'pointer')
  assert.equal(await at(1.4), 'pointer', "the range's bar")
  assert.notEqual(await at(0.02), 'pointer', 'none at the start')
  assert.notEqual(await at(1.8), 'pointer', 'none past the range')
})

test('editor: zoomed out past the whole, the sound starts at the left and the room is on its right', async () => {
  await open()
  await page.locator('.plot').focus()
  for (let i = 0; i < 2; i++) await page.keyboard.press('-')
  await page.waitForTimeout(400)
  // lit columns of the picture, the labels at its right left out
  const [first, last] = await pixels(`let a = -1, b = -1; for (let x = 0; x < w - 60; x++) { let lit = 0; for (let y = 0; y < h * .8; y += 2) { const i = (y * w + x) * 4; if (d[i] + d[i + 1] + d[i + 2] > 300) lit++ } if (lit > 3) { if (a < 0) a = x; b = x } } return [a / w, b / w]`)
  assert.ok(first < .03 && last < .45, `lit from ${first} to ${last}`)
})

// A fade drags from a selection's dot and shows on the waveform as it goes, before its output comes
test('editor: a fade shows on the waveform while its dot is dragged', async () => {
  await open()
  await noCues()
  await write(`audio('chime.wav')`)
  await lengthIs('0:08.000')
  const { box, x } = await axis(8), y = box.y + box.height * .3
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

// The bar's record button starts a take and stops it
// Recording over a sound, as a dictaphone or a tape: from the caret, into the waveform as it comes, what it covers
// replaced and the end extended past; one write() step, which Undo takes back. Into a selection, it ends at its end.
test('editor: the record button records over the sound from the caret, into the waveform, one step Undo takes back', async () => {
  await open()
  // a selection's edges go where they are let go: the take's own hits, still shown a moment after Undo, take none
  await noCues()
  await write(`audio('chime.wav')`)
  await lengthIs('0:08.000')
  const { box, x } = await axis(8), y = box.y + box.height * .3
  await page.mouse.click(x(7.5), box.y + box.height - 8)
  await page.getByRole('button', { name: 'Record', exact: true }).click()
  await page.getByRole('button', { name: 'Stop recording', exact: true }).waitFor()
  // the one or the other: Play is off while it records
  assert.equal(await page.locator('button.play').isDisabled(), true)
  // the clock runs from the caret, past the old end
  await page.waitForFunction(() => /^0:0(8\.[3-9]|9)/.test(document.querySelector('.time').textContent), null, { timeout: 15000 })
  // the level meter by the lanes reads the microphone, not the sound where the caret was: its bar on the overlay, read as
  // drawn (view.js, 7 px short of the labels' gutter, GUTTER), up as it beeps and falling back between, by a fifth at
  // least (its beeps half a second apart, a peak meter falls 6 dB between them: meters.js ballistics)
  await page.waitForFunction(gutter => {
    const c = document.querySelector('.plot canvas.overlay'), k = c.width / c.clientWidth, w = c.clientWidth - gutter
    const d = c.getContext('2d').getImageData(Math.round((w - 7) * k), 10 * k, Math.round(3 * k), c.height - 40 * k).data
    let n = 0
    for (let i = 3; i < d.length; i += 4) if (d[i] > 60) n++
    const seen = globalThis.metered ??= { top: 0, down: false }
    seen.top = Math.max(seen.top, n)
    if (seen.top > 20 && n < seen.top * .8) seen.down = true
    return seen.down
  }, GUTTER, { timeout: 10000 })
  await page.getByRole('button', { name: 'Stop recording', exact: true }).click()
  await page.waitForFunction(() => /\.write\(audio\('take\.wav'\), \{ at: 7\.5 \}\)$/.test(scriptText()))
  await page.waitForFunction(() => +document.querySelector('.source').title.split(' · ').pop().split(':')[1] > 8.2)
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

// A take is drawn as the output holding it will be: the spectrogram at the levels the output's will have (the loudest
// cell, here the take's own), the waveform in its fill and colour; stopped, the same pixels light the same. Within 10%:
// the loudest cell is a beep's, and how loud depends on how that beep's frames align, so the take's levels can move a
// little once it is whole (two runs' outputs differ by up to 6%; a slow runner's take gets more beeps before the stop)
test('editor: a take draws while it records as its output does after', async () => {
  const looks = [['spec'], ['wave'], ['wave', { Colour: 'Temperature', Fill: 'RMS' }]]
  for (const [view, wave] of looks) {
    await open()
    if (wave) {
      const box = await page.locator('.plot').boundingBox()
      await page.mouse.click(box.x + 200, box.y + 60, { button: 'right' })
      await contextRow('How the waveform draws…').click()
      for (const [group, name] of Object.entries(wave)) await choice(group, name).click()
      await page.keyboard.press('Escape')
    }
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
    await page.locator('.readout', { hasText: 'LUFS' }).waitFor()
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
  const [a, b] = await pixels(`let lo = w, hi = -1; for (let y = 0; y < h - 30; y++) for (let x = 0; x < w - ${GUTTER}; x++) { const i = (y * w + x) * 4; if (d[i] > 120 && d[i] - d[i + 2] > 60) { lo = Math.min(lo, x); hi = Math.max(hi, x) } } return [lo, hi]`)
  assert.equal(await page.locator('.hint').innerText(), 'crossfade 0:00.400')
  await page.mouse.up()
  const at = t => x(t) - box.x
  assert.ok(Math.abs(a - at(.8)) <= 3 && Math.abs(b - at(1.2)) <= 3, `the curves from ${a} to ${b}, the seam ±0.2 s ${at(.8)} to ${at(1.2)}`)
  await page.waitForFunction(() => /\.crossfade\(\{ at: 1, d: 0\.4 \}\)$/.test(scriptText()))
})

// A selection's tools at its foot, side by side from its middle (view.js BOX, 16 px, 2 apart): pitch, intonation,
// formants; the pill on its top edge its level alone
const tools = (x, box, a, b) => Object.fromEntries(['pitch', 'intonation', 'formant'].map((name, i) => [name, [(x(a) + x(b)) / 2 + (i - 1) * 18, box.y + box.height - 22 - 8]]))

// The pitch tool: dragged up, whole semitones, the note it goes to said by it (a 220 Hz tone is A3, A4 being 440 Hz,
// ISO 16), the range heard as it will sound while it moves, from the first move on (the library's pitch(), a voice's),
// one pitch() step let go
test('editor: the pitch tool goes by semitones, says the note it goes to and is heard as it goes', async () => {
  await page.addInitScript(tap)
  await open()
  await noCues()
  await write(`audio.from(t => 0.5 * Math.sin(2 * Math.PI * 220 * t), { duration: 2 })`)
  await lengthIs('0:02.000')
  // editing pitch, its curve comes, the note said; on the waveform a lane's height is the voice's range, 60 Hz to 1 kHz
  // on octaves (view.js VOICE): two semitones up is that share of it
  await menu('View', 'Edit pitch')
  await show('wave')
  const { box, x } = await axis(2), { pitch } = tools(x, box, .5, 1.5)
  await drag([x(.5), box.y + 80], [x(1.5) - x(.5), 0])
  const said = () => page.locator('.hint').innerText()
  for (const until = Date.now() + 8000; Date.now() < until; await page.waitForTimeout(200)) { await page.mouse.move(...pitch); if (/^Pitch A3/.test(await said())) break; await page.mouse.move(pitch[0] + 30, pitch[1] - 40) }
  assert.match(await said(), /^Pitch A3([+−][1-5]ct)?, by semitones$/)
  const lh = box.height - 22, up = 2 / (12 * Math.log2(1000 / 60)) * lh + 2
  await heard()
  await page.mouse.down()
  // pressed and moved a little: at 0, heard as it is
  await page.mouse.move(pitch[0], pitch[1] - 4)
  await page.waitForTimeout(500)
  assert.ok((await heard()).peak > .05, 'at 0 semitones, heard as it is')
  await page.mouse.move(pitch[0], pitch[1] - up, { steps: 6 })
  await page.waitForTimeout(500)
  assert.match(await said(), /^\+2st, A3([+−][1-5]ct)? → B3([+−][1-5]ct)?$/)
  const { peak } = await heard()
  assert.ok(peak > .05, `heard as it goes: ${peak}`)
  // with ⌘ (Ctrl), cents: 4 px more, a quarter as far, some hundredths of a semitone
  await page.keyboard.down('ControlOrMeta')
  await page.mouse.move(pitch[0], pitch[1] - up - 4, { steps: 2 })
  assert.match(await said(), /^\+2st [1-9]\d?ct, /)
  await page.mouse.up()
  await page.keyboard.up('ControlOrMeta')
  await page.waitForFunction(() => /\.pitch\(2\.\d\d?, \{ at: 0\.5, d: 1, voice: true \}\)$/.test(scriptText()))
})

// The tools beside it: a voice's intonation, its rises and falls wider up and flatter down (half a lane twice as wide,
// or a monotone), by 0.05; its formants, by semitones (half a lane an octave). Each heard as it goes, from the first
// move, and one step over the selection; the same again over it sets the same step again
test('editor: the tools set a voice\'s intonation and its formants, heard as they go, a step each', async () => {
  await page.addInitScript(tap)
  await open()
  await noCues()
  // a voice whose pitch rises and falls, ±2 semitones about 200 Hz twice a second
  await write(`audio.from(t => 0.5 * Math.sin(2 * Math.PI * (200 * t + 2 * Math.sin(2 * Math.PI * 2 * t))), { duration: 2 })`)
  await lengthIs('0:02.000')
  await menu('View', 'Edit pitch')
  const { box, x } = await axis(2), lh = box.height - 22, { intonation, formant } = tools(x, box, .5, 1.5), said = () => page.locator('.hint').innerText()
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
  // formants: up an eighth of a lane, 3 semitones
  await page.mouse.move(...await grab([formant], 'ns-resize'))
  assert.equal(await said(), 'Formants, by semitones')
  await page.mouse.down()
  await page.mouse.move(formant[0], formant[1] - lh / 8, { steps: 6 })
  await page.waitForTimeout(500)
  assert.equal(await said(), 'formants +3st')
  assert.ok((await heard()).peak > .05, 'heard as it goes')
  await page.mouse.up()
  await page.waitForFunction(() => /\.formant\(3, \{ at: 0\.5, d: 1 \}\)$/.test(scriptText()))
})

// The spectrogram's tab again: its frequencies on the next scale, octaves, mel, hertz, said by it a moment
test('editor: the spectrogram\'s tab again turns its frequency scale, said by it', async () => {
  await open()
  await show('spec')
  const spec = page.getByRole('tab', { name: 'Spectrogram', exact: true })
  assert.match(await spec.getAttribute('title'), /in octaves\. Again: in mel\. Right-click: how it draws$/)
  await spec.click()
  assert.equal(await page.locator('.hint').innerText(), 'Mel')
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('audio-repl') || '{}').scale === 'mel')
  await spec.click()
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('audio-repl') || '{}').scale === 'erb')
  await spec.click()
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('audio-repl') || '{}').scale === 'lin')
})

// The settings, a dropdown under their button over the meter, not a panel and no levels: every group in sight, its
// choices, what the chosen one does said under them; how a held caret sounds is one of the lab's eight ways
// (scrub-methods.js), kept. The button again closes it; how the pictures draw is theirs (a right-click on their switch),
// a dropdown as plain: the waveform's colour, lanes, fill and levels, the spectrogram's method, scale, colours, gamma,
// range and FFT size
test('editor: the settings and each picture\'s options are dropdowns, every group in sight, what each choice does said', async () => {
  await open()
  const button = page.getByRole('button', { name: 'Settings', exact: true }), groups = () => page.locator('.dropdown .dropdown-label').allInnerTexts()
  await button.click()
  assert.equal(await button.getAttribute('aria-expanded'), 'true')
  assert.equal(await page.locator('.side-slab').isVisible(), false, 'no panel')
  assert.equal(await page.locator('.menubar-sub').count(), 0, 'no submenus')
  assert.deepEqual(await groups(), ['Show over the sound', 'Scrub', 'Record in', 'Times in', 'Level steps', 'Splices', 'Time row', 'Grid'])
  const ways = page.locator('.dropdown').getByRole('group', { name: 'Scrub', exact: true }).getByRole('button')
  assert.deepEqual(await ways.allInnerTexts(), ['Vocoder + noise', 'Vocoder', 'Random phase', 'Noisc bank', 'Noisc lines', 'Grains', 'Loop', 'Tape'])
  const note = group => page.locator('.dropdown-group', { has: page.getByRole('group', { name: group, exact: true }) }).locator('.dropdown-note').innerText()
  assert.match(await note('Scrub'), /^Tones keep their phase/)
  await choice('Scrub', 'Tape').click()
  assert.match(await note('Scrub'), /^A reel's head chasing the caret/, 'what the choice does, said at once')
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('audio-repl') || '{}').scrub === 'tape')
  await button.click()
  assert.equal(await page.locator('.dropdown:popover-open').count(), 0, 'its button again closes it')
  assert.equal(await button.getAttribute('aria-expanded'), 'false')
  // a picture's: a right-click on its switch
  await page.getByRole('tab', { name: 'Waveform', exact: true }).click({ button: 'right' })
  assert.deepEqual(await groups(), ['Colour', 'Channels', 'Fill', 'Levels in'])
  await page.mouse.click(10, 10)
  assert.equal(await page.locator('.dropdown:popover-open').count(), 0, 'a press outside closes it')
  await page.getByRole('tab', { name: 'Spectrogram', exact: true }).click({ button: 'right' })
  assert.deepEqual(await groups(), ['Method', 'Frequency scale', 'Colours', 'Gamma', 'Range', 'FFT size'])
  assert.deepEqual(await page.locator('.dropdown').getByRole('group', { name: 'Frequency scale', exact: true }).getByRole('button').allInnerTexts(), ['Octaves', 'Mel', 'ERB', 'Hertz'])
  await page.keyboard.press('Escape')
  assert.equal(await page.locator('.dropdown:popover-open').count(), 0, 'Esc closes it')
})

// How the spectrogram draws its frames (gl-spectrogram's methods): each a picture of its own, kept for the next visit;
// ERB among the scales, the switch clicked again going through all four
test('editor: the spectrogram\'s method draws a picture of its own, kept; its scales go round all four', async () => {
  await open()
  await show('spec')
  const plot = page.locator('.plot'), print = () => pixels(`let s = 0; for (let i = 0; i < d.length; i += 4 * 97) s = (s * 31 + d[i]) % 1000000007; return s`)
  await page.waitForTimeout(500)
  const pictures = new Set([await print()])
  for (const method of ['Frames', 'Squeezed', 'By band', 'Tapers', 'Wigner–Ville']) {
    await page.getByRole('tab', { name: 'Spectrogram', exact: true }).click({ button: 'right' })
    await choice('Method', method).click()
    await page.keyboard.press('Escape')
    await page.waitForTimeout(500)
    pictures.add(await print())
  }
  assert.equal(pictures.size, 6, 'six methods, six pictures')
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('audio-repl')).look.method), 'wigner')
  await page.reload()
  await page.locator('.readout', { hasText: 'LUFS' }).waitFor()
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('audio-repl')).look.method), 'wigner')
  const scales = []
  for (let i = 0; i < 4; i++) { await show('spec'); scales.push(await plot.getAttribute('data-scale')) }
  assert.deepEqual(scales, ['mel', 'erb', 'lin', 'log'])
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

// How the waveform draws, from a right-click on it (and the View menu): coloured by where its spectrum centres as a
// colour temperature, 100 Hz at 1,800 K (a warm orange: more red than blue, on the black-body locus, Krystek 1985), its
// channels in one lane
test('editor: the waveform\'s look, from a right-click on it: coloured by its spectrum\'s warmth, its channels in one lane', async () => {
  await open()
  await write(`audio.from(t => 0.8 * Math.sin(2 * Math.PI * 100 * t), { duration: 1, channels: 2 }).pan(-1)`)
  await lengthIs('0:01.000')
  await page.waitForTimeout(500)
  // lit pixels in the upper and lower half of the lanes, and how red they are
  const lit = () => pixels(`const out = [0, 0], tint = [0, 0]; for (let y = 0; y < h - 44; y++) for (let x = 0; x < w - 60; x++) { const i = (y * w + x) * 4; if (d[i] + d[i + 1] + d[i + 2] > 300) { const k = y < (h - 44) / 2 ? 0 : 1; out[k]++; tint[k] += d[i] - d[i + 2] } } return [...out, (tint[0] + tint[1]) / (out[0] + out[1] || 1)]`)
  const [upper, lower, grey] = await lit()
  assert.ok(lower < upper / 10 && Math.abs(grey) < 10, `split, grey: ${[upper, lower, grey]}`)
  // from the picture's context menu, its options: a dropdown under its switch
  const { box } = await axis(1)
  await page.mouse.click(box.x + 200, box.y + 60, { button: 'right' })
  await contextRow('How the waveform draws…').click()
  await choice('Channels', 'One lane').click()
  await choice('Colour', 'Temperature').click()
  await page.keyboard.press('Escape')
  await page.waitForTimeout(500)
  const [top, bottom, red] = await lit()
  assert.ok(bottom > top / 2 && red > 40, `one lane, red: ${[top, bottom, red]}`)
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('audio-repl') || '{}').wave?.colour === 'temperature')
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
  const length = () => page.evaluate(() => document.querySelector('.source').title.split(' · ').pop())
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
// all away. An edit made after it is a step of its own, not the group's
test('editor: a recipe is one card of the edits, its steps folded under it, turned off or removed together', async () => {
  await open()
  const chime = `audio('chime.wav')\n  .trim()\n  .normalize(-1)\n  .fade(0.02, 0.1)`
  await menu('File', 'Recipes', 'Remove room echo')
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
// the tools it used. The conversation is the tab's, kept: a reload brings it back, a new one starts empty, the old one
// is a click away, another tab has its own. The agent here is a stand-in on PATH printing what
// `claude -p --output-format stream-json --verbose --include-partial-messages` prints, a tool's run held for a moment
test('editor: through the local bridge, an agent measures and edits the sound open; its words as Markdown, kept with the tab', async () => {
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
    assert.equal(await page.getByRole('tab', { name: 'Spectrogram' }).getAttribute('aria-selected'), 'true')
    assert.match((await call('look')).result.text, /the pitch curve before your last edit, dashed, and after it$/)
    await call('undo')
    assert.doesNotMatch((await call('look')).result.text, /pitch curve/)
    await page.getByRole('tab', { name: 'Waveform' }).click()
    // the caret or a range put where it does not show comes into sight, as the user's own would
    await page.locator('.plot').focus()
    for (let i = 0; i < 4; i++) await page.keyboard.press('=')
    const shown = async () => (await call('look')).result.text.match(/^([\d:.]+) to ([\d:.]+)/).slice(1).map(t => +t.split(':')[1])
    const [a0, b0] = await shown()
    assert.ok(b0 - a0 < 2 && b0 < 5.5, `zoomed in: ${a0}–${b0}`)
    await call('select', { cursor: 5.5 })
    const [a1, b1] = await shown()
    assert.ok(a1 <= 5.5 && 5.5 <= b1 && Math.abs(b1 - a1 - (b0 - a0)) < .01, `the caret in sight, the zoom kept: ${a1}–${b1}`)
    await call('select', { at: .5, d: 5 })
    const [a2, b2] = await shown()
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
    assert.equal(await page.getByRole('tab', { name: 'Spectrogram' }).getAttribute('aria-selected'), 'true')
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
    assert.match(measured[0][1], /^−\d+(\.\d+)? dBTP$/)
    assert.equal(measured[1][0], 'Loudness')
    assert.match(measured[1][1], /^−\d+(\.\d+)? LUFS$/)
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
    // deleted, it goes; none left, nor the list of them
    await page.locator('.chat-title').click()
    await page.getByRole('button', { name: 'Delete How long is it?' }).click()
    assert.equal(await page.locator('.chat-message').count(), 0)
    assert.equal(await page.locator('.chat-head').count(), 0, 'none left')
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('audio-repl')).docs.some(d => d.chats?.length)), false, 'nor kept')
    // another tab, its own: none yet
    await page.getByRole('button', { name: 'New tab' }).click()
    assert.equal(await page.locator('.chat-message').count(), 0)
    assert.equal(await page.locator('.chat-head').count(), 0)
    // a file of the user's machine, read through the bridge, in the tab shown, which is empty
    const opened = await call('open', { path: fileURLToPath(new URL('fixture.wav', import.meta.url)) })
    assert.deepEqual([opened.result.ok, opened.result.name], [true, 'fixture.wav'], JSON.stringify(opened))
    assert.equal(await page.locator('.file.current').innerText(), 'fixture.wav')
    assert.match((await call('open', { path: fileURLToPath(new URL('../package.json', import.meta.url)) })).error, /Not an audio or video file/)
    errors.splice(0, Infinity, ...errors.filter(e => !/ 415 /.test(e)))  // the browser's own word on the refusal, asked for
  } finally { proc.kill() }
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

// In the pitch context (View > Edit pitch) the pitch line is edited as the gain line is, on its own scale (half a lane
// an octave): a press on its 0 makes a point, dragged up whole semitones; one pitch() curve, a voice's, set again in
// place; a double-click on a point takes it away, the last one the call
test('editor: the pitch line, in the pitch context, edits a pitch() curve as the gain line edits gain()', async () => {
  await open()
  await noCues()
  await write(`audio.from(t => 0.5 * Math.sin(2 * Math.PI * 220 * t), { d: 2 })`)
  await lengthIs('0:02.000')
  await menu('View', 'Edit pitch')
  // the line on the waveform (the spectrogram, which the picture turns to, draws its points on the pitch curve)
  await show('wave')
  const { box, x } = await axis(2), lh = box.height - 22, mid = box.y + lh / 2, st = lh / 2 / 12
  await drag(await grab([[x(1), mid]], 'ns-resize'), [0, -3 * st])
  await page.waitForFunction(() => /\.pitch\(\{ t: \[1\], v: \[3\] \}, \{ voice: true \}\)$/.test(scriptText().trim()))
  await drag(await grab([[x(1), mid - 3 * st]], 'move'), [0, -2 * st])
  await page.waitForFunction(() => /\.pitch\(\{ t: \[1\], v: \[5\] \}, \{ voice: true \}\)$/.test(scriptText().trim()))
  assert.equal((await code()).match(/\.pitch\(/g).length, 1)
  await page.mouse.dblclick(...await grab([[x(1), mid - 5 * st]], 'move'))
  await page.waitForFunction(() => !scriptText().includes('pitch('))
})

// An edit turned off over the selection alone, from the picture's context menu (RX's Restore Selection, for one edit): its
// mix 0 there, ramped over the splices (10 ms), the rest of it as it was; an edit that changes the timing not offered
test('editor: an edit turned off over the selection alone, from the context menu', async () => {
  await open()
  await noCues()
  await write(`audio('chime.wav')\n  .reverse()\n  .gain(-6)`)
  await lengthIs('0:08.000')
  const { box, x } = await axis(8), y = box.y + box.height * .3
  await drag([x(2), y], [x(3) - x(2), 0])
  await page.mouse.click(x(2.5), y, { button: 'right' })
  await contextRow('Turn an edit off here').click()
  assert.deepEqual(await page.locator('.menubar-sub:popover-open .menu-label').allInnerTexts(), ['gain(-6)'], 'reverse() changes the timing: not offered')
  await contextRow('gain\\(-6\\)').click()
  await page.waitForFunction(() => scriptText().includes('mix:'))
  assert.match(await page.evaluate(() => scriptText()), /\.gain\(-6, \{ mix: \{ t: \[1\.99, 2, 3, 3\.01\], v: \[1, 0, 0, 1\] \} \}\)$/)
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
  assert.equal(await page.locator('.length').evaluate(el => getComputedStyle(el).display), 'none', 'no sound, no length')
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
// same scale, not fitted to the view, and so does an edit that shortens it; one that makes it longer than the view, fitted
test('editor: a view zoomed out past the end stays so after a reload', async () => {
  await open()
  await noCues()
  await write(`audio('chime.wav')`)
  await lengthIs('0:08.000')
  await page.locator('.plot').focus()
  for (let i = 0; i < 2; i++) await page.keyboard.press('-')
  await page.waitForTimeout(700)
  // the view 32 s wide: an eighth of the way across is 4 s in, where fitted to the sound it would be 1 s
  const at = async (t = 4) => {
    const { box, x } = await axis(32)
    await page.mouse.click(x(t), box.y + box.height * .3)
    return (await page.locator('.time').innerText()).split(':').reduce((m, s) => m * 60 + +s, 0)
  }
  assert.ok(Math.abs(await at() - 4) < .1, 'zoomed out')
  await page.waitForTimeout(700)
  await page.reload()
  await page.locator('.readout', { hasText: 'LUFS' }).waitFor()
  await page.waitForTimeout(300)
  assert.ok(Math.abs(await at() - 4) < .1, 'as it was left')
  await write(`audio('chime.wav').crop({ at: 0, duration: 4 })`)
  await lengthIs('0:04.000')
  await page.waitForTimeout(300)
  assert.ok(Math.abs(await at(2) - 2) < .1, 'shortened: the same scale')
  await write(`audio('chime.wav').speed(0.2)`)
  await lengthIs('0:40.000')
  await page.waitForTimeout(300)
  assert.ok(Math.abs(await at() - 5) < .1, 'longer than the view: all of it')
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
  const { box, x } = await axis(8), y = box.y + box.height * .3
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
// if it was, its settings out of reach till it is back on
test('editor: a card dragged takes its step along the chain; one bypassed stays where it is, as it was', async () => {
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
  assert.ok(await card('Gain').locator('.params').evaluate(el => el.inert), 'its settings out of reach')
  await page.locator('.viewing', { hasText: 'Up to Highpass: ' }).waitFor()
  await page.getByRole('button', { name: 'Turn gain on' }).click()
  await page.waitForFunction(() => scriptText().includes('  .gain(-3)') && !scriptText().includes('//'))
  await page.locator('.viewing', { hasText: 'Up to Gain: ' }).waitFor()
})

// A marker's flag dragged moves the marker alone: the caret stays where it was, and what plays plays on, not from the
// marker; clicked, the caret goes to it
test('editor: a marker dragged moves alone, the caret and what plays staying where they are', async () => {
  await open()
  await noCues()
  await write(`audio('chime.wav').mark(2)`)
  await lengthIs('0:08.000')
  const { box, x } = await axis(8), y = box.y + box.height * .3, row = box.y + 4
  const now = async () => +(await page.locator('.time').innerText()).split(':')[1]
  await page.mouse.click(x(6), y)
  await drag(await grab([[x(2), row]], 'pointer'), [x(3) - x(2), 0])
  await page.waitForFunction(() => +(scriptText().match(/\.mark\(([\d.]+)\)/)?.[1]) > 2.9)
  assert.equal(await now(), 6, 'the caret where it was')
  // playing from the start: dragged back, the marker moves, the playhead goes on from where it was
  await page.mouse.click(x(.2), y)
  await page.keyboard.press('Space')
  await page.getByRole('button', { name: 'Pause' }).waitFor()
  await drag(await grab([[x(3), row]], 'pointer'), [x(5) - x(3), 0])
  await page.waitForFunction(() => +(scriptText().match(/\.mark\(([\d.]+)\)/)?.[1]) > 4.9)
  assert.ok(await now() < 2.5, `played on from the start, not from the marker: ${await now()}`)
  await page.keyboard.press('Space')
  // clicked: the caret to it
  await page.mouse.click(...await grab([[x(5), row]], 'pointer'))
  assert.ok(Math.abs(await now() - 5) < .05, String(await now()))
})

// More tabs than fit keep their width and scroll, as a code editor's: the one shown in sight, the wheel moving them along
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
  await strip.hover()
  await page.mouse.wheel(0, -4000)
  await page.waitForFunction(() => document.querySelector('.files-list').scrollLeft === 0)
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
  await page.locator('.readout', { hasText: 'LUFS' }).waitFor()
  // as it was written down, 32-bit float
  assert.match(await facts(), / mono 32-bit$/)
  await settings('Record in', 'Stereo')
  await page.reload()
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
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
