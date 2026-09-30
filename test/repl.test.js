// REPL: npm run test:repl. The engine runs in a real browser worker; its output is compared with the library in Node,
// the command-line translation with the CLI itself. All requests stay local.
import { test, before, after, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import vm from 'node:vm'
import { promisify } from 'node:util'
import { tmpdir } from 'node:os'
import { extname, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import wav from '@audio/encode-wav'
import audio from '../audio.js'
import { prepare, error, chain, append, source, callAt, setArg, cli } from '../repl/code.js'
import { ops, guides, previews } from '../repl/ops.js'
import attacks from '../repl/attack.js'
import clock from '../repl/time.js'
import { samples, RATE as SAMPLES } from '../site/samples.js'
import recipes from '../repl/recipes.js'
import { cycle, trace } from '../repl/meters.js'
import '../.site-build.js'

const root = fileURLToPath(new URL('..', import.meta.url)).replace(/\/$/, '')
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' }
let server, browser, page, origin, errors

before(async () => {
  server = createServer(async (req, res) => {
    const url = req.url.split('?')[0]
    if (url === '/blank.html') { res.writeHead(200, { 'content-type': 'text/html' }).end('<!doctype html><title>blank</title>'); return }
    // a file over a slow connection: 8 KB every 120 ms, its length said up front
    if (url.startsWith('/slow/')) {
      const data = await readFile(resolve(root, '.' + url.slice(5)))
      res.writeHead(200, { 'content-type': 'audio/wav', 'content-length': data.length })
      for (let i = 0; i < data.length; i += 8192) { res.write(data.subarray(i, i + 8192)); await new Promise(r => setTimeout(r, 120)) }
      res.end()
      return
    }
    const path = resolve(root, '.' + (url === '/' ? '/repl.html' : url))
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
  // the page opens its panel on the edits; most tests here read and write the code, so it opens on the code tab unless
  // the page has said otherwise (a test of the edits or the tools switches to them)
  await page.addInitScript(() => {
    try { const s = JSON.parse(localStorage.getItem('audio-repl') || '{}'); if (!('side' in s)) localStorage.setItem('audio-repl', JSON.stringify({ ...s, side: 'code' })) } catch {}
  })
  errors = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()) })
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

// Runs scripts through the REPL's own engine in the browser. `files` are { name: channels } or { name: bytes }.
async function engine(scripts, files = {}) {
  await page.goto(origin + '/blank.html')
  return page.evaluate(async ({ scripts, files }) => {
    const { default: engine } = await import('/repl/engine.js'), { prepare } = await import('/repl/code.js')
    const e = engine(new URL('/repl/dist/worker.js', location.href))
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

// ── The script as code ─────────────────────────────────────────

// One cycle of a sine, whatever its pitch, stands as the logo's signals do: up, then down through zero at mid-period
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

test('code: edits from the waveform join the output chain, before a closing save, on its own line when the chain has lines', () => {
  const run = (code, call) => { const c = append(code, call); return code.slice(0, c.from) + c.insert + code.slice(c.to ?? c.from) }
  assert.equal(run(`audio('a.wav').gain(-3)`, 'reverse()'), `audio('a.wav').gain(-3).reverse()`)
  assert.equal(run(`audio('a.wav').gain(-3).save('b.wav')`, 'reverse()'), `audio('a.wav').gain(-3).reverse().save('b.wav')`)
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

// A recipe's calls show in the menu and open as units in the rack, with sliders: each is a method the REPL describes.
// Measuring recipes and loops over files have no output chain; audio.from() is the source a generator starts from.
test('code: every recipe calls only methods the menu and the rack know', () => {
  for (const r of recipes) for (const call of chain(r.code.replaceAll('$src', `audio('a.wav')`))?.calls || [])
    assert.ok(ops[call.name] || call.name === 'save' || call.name === 'from', `${r.name}: .${call.name}()`)
})

test('code: each guide follows its call: levels, fades, ranges and frequencies', () => {
  assert.deepEqual(guides('trim', { threshold: -40 }, 8), [{ level: -40 }])
  assert.deepEqual(guides('remove', { at: 1, duration: .5 }, 8), [{ range: [1, 1.5], dim: 'inside' }])
  assert.deepEqual(guides('crop', { at: 1, duration: .5 }, 8), [{ range: [1, 1.5], dim: 'outside' }])
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

// Its processor (repl/scrub.js), run in Node with the worklet's globals stubbed, a 128-frame quantum at a time: the
// channels `x` at `rate`, the caret at caret(q) samples in quantum q, for `seconds`
async function scrubbed(x, caret, seconds, rate = 48000) {
  let Proc
  vm.runInContext(await readFile(new URL('../repl/scrub.js', import.meta.url), 'utf8'), vm.createContext({
    AudioWorkletProcessor: class { constructor() { this.port = { onmessage: null, postMessage() {} } } },
    registerProcessor: (_, cls) => { Proc = cls }, sampleRate: rate, currentTime: 0
  }))
  const proc = new Proc(), send = data => proc.port.onmessage({ data }), Q = 128, n = Math.ceil(seconds * rate / Q)
  send({ x, rate })
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
test('scrub: short sounds, silence, a caret past either end or leaping stay finite', async () => {
  const cases = [[[Float32Array.from({ length: 100 }, (_, i) => Math.sin(i))], q => q * 10], [[new Float32Array(48000)], q => q * 128], [[clicked()], () => -5000], [[clicked()], () => 90000], [[clicked(), clicked()], q => (q * 20000) % 48000]]
  for (const [x, caret] of cases) for (const c of await scrubbed(x, caret, .2)) assert.ok(c.every(Number.isFinite))
})

// ── Times and cues ─────────────────────────────────────────────

// One way to write a time, on the clock, the time row, the pointer and the edits: minutes and seconds, seconds, samples;
// rounded once, so a time a hair under a minute reads a minute, not 0:60.000
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

// Cues are slice points: where each hit's attack starts, so a cut there keeps all of it. The built-in samples strike at
// known times (site/samples.js: the chime's bars at 0.5 + 0.6 n s, 0.9 s more after the fourth; the handpan's phrase);
// the onset stat's blocks (1024 samples) put its hits 14 ms either side of them.
test('attack: the cue of each hit lands at its strike, before it or within the first half millisecond of a soft one', async () => {
  const strikes = { chime: [.5, 1.1, 1.7, 2.3, 3.8, 4.4, 5, 5.6], handpan: [.3, .85, 1.3, 1.75, 2.3, 2.75, 3.25, 3.9] }
  for (const [name, times] of Object.entries(strikes)) {
    const channels = samples[name].make(), found = [...await audio.from(channels, { sampleRate: SAMPLES }).stat('onsets')], cues = attacks(found, channels, SAMPLES)
    assert.equal(cues.length, times.length, name)
    cues.forEach((t, i) => assert.ok(t - times[i] > -.004 && t - times[i] < .0006, `${name} strike ${i} at ${times[i]} s: cue ${t.toFixed(4)}, found ${found[i].toFixed(4)}`))
  }
  // a cut there starts at a zero crossing: the channels' sum changes sign within a sample of it
  const channels = samples.chime.make(), [cue] = attacks([.51], channels, SAMPLES), i = Math.round(cue * SAMPLES), sum = k => channels[0][k] + channels[1][k]
  assert.ok(sum(i - 1) * sum(i) <= 0, `${sum(i - 1)} ${sum(i)}`)
  // nothing to find, or nothing to read: the times come back in order, no later than given, none before the start
  assert.deepEqual(attacks([], [new Float32Array(0)], SAMPLES), [])
  const two = attacks([0, .001], [new Float32Array(441)], SAMPLES)
  assert.ok(two[0] === 0 && two[1] > 0 && two[1] <= .001, JSON.stringify(two))
  const silence = attacks([.5, .5, .2], [new Float32Array(SAMPLES)], SAMPLES)
  assert.ok(silence.every((t, k) => t >= 0 && (!k || t > silence[k - 1])), JSON.stringify(silence))
  // a time past the end stays within the sound
  const [past] = attacks([2], [new Float32Array(441)], SAMPLES)
  assert.ok(Number.isFinite(past) && past <= 441 / SAMPLES, String(past))
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

test('engine: save() marks exports and export encodes them', async () => {
  await page.goto(origin + '/blank.html')
  const result = await page.evaluate(async () => {
    const { default: engine } = await import('/repl/engine.js'), { prepare } = await import('/repl/code.js')
    const e = engine(new URL('/repl/dist/worker.js', location.href))
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
    const { default: engine } = await import('/repl/engine.js'), { prepare } = await import('/repl/code.js')
    const e = engine(new URL('/repl/dist/worker.js', location.href))
    const runs = [1, 2, 3].map(seconds => e.render(prepare(`audio.from(${seconds})`)))
    return (await Promise.all(runs)).map(r => r.skipped ? 'skipped' : r.output.duration)
  })
  assert.ok(results[0] === 1 || results[0] === 'skipped', String(results[0]))
  assert.deepEqual(results.slice(1), ['skipped', 3])
})

test('engine: plugin parameters come from their manifests', async () => {
  await page.goto(origin + '/blank.html')
  const params = await page.evaluate(async () => {
    const { default: engine } = await import('/repl/engine.js')
    return engine(new URL('/repl/dist/worker.js', location.href)).describe('compressor')
  })
  const { compressor } = await import('@audio/dynamics-compressor/audio')
  assert.deepEqual(params, JSON.parse(JSON.stringify(compressor.params)))
})

// ── The page ───────────────────────────────────────────────────

const code = () => page.evaluate(() => document.querySelector('.cm-content').innerText.replace(/ /g, ' '))
const readout = () => page.locator('.readout').innerText()
// The output's length, from the name's tooltip ("chime.wav · 0:06.525"): the axes show it, so the page doesn't repeat it
const lengthText = () => page.evaluate(() => document.querySelector('.source').title.split(' · ').pop())
const seconds = async () => { const [m, s] = (await lengthText()).split(':'); return +m * 60 + +s }
async function open() {
  await page.goto(origin + '/repl.html')
  await page.locator('.readout', { hasText: 'LUFS' }).waitFor()
}
// The panel's tabs: the tools, the edits, or the code
const tab = name => page.getByRole('tab', { name, exact: true }).click()
// Runs an item of the app menu: the menu by its name, then each submenu and the item, by their words
async function menu(...path) {
  await page.locator('.menubar-item', { hasText: new RegExp(`^${path[0]}$`) }).click()
  for (const name of path.slice(1)) {
    const words = typeof name === 'string' ? new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`) : name
    await page.locator('.menubar-list .menu-row:visible').filter({ has: page.locator('.menu-label', { hasText: words }) }).last().click()
  }
}
const facts = async () => (await page.locator('.facts').innerText()).replace(/\s*\n\s*/g, ' ')
// The hits hidden: a dragged edge goes where it is let go, not onto a hit near it (a test of snapping keeps them)
const noCues = () => menu('View', 'Hits')
async function write(text) {
  await page.locator('.cm-content').click()
  await page.keyboard.press('ControlOrMeta+A')
  await page.keyboard.insertText(text)
}
// Bright pixels in the plot, from a screenshot: the waveform is drawn.
async function drawn() {
  const png = await page.locator('.plot').screenshot()
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

test('repl: opens on the chime with its script, drawn and measured', async () => {
  await open()
  assert.equal(await code(), `audio('chime.wav')\n  .trim()\n  .normalize(-1)\n  .fade(0.02, 0.1)`)
  assert.equal(await page.locator('.source').innerText(), 'chime.wav')
  assert.equal(await facts(), '44.1kHz stereo')
  assert.match(await readout(), /^peak −1\.0dBFS · −\d+\.\dLUFS$/)
  assert.ok(await drawn() > .05, 'the waveform covers the plot')
})

test('repl: a slider rewrites its argument, the output and its guide follow', async () => {
  await open()
  // a press on its card opens its settings
  await tab('Edits')
  await page.locator('.step-name', { hasText: 'Normalize' }).click()
  const slider = page.locator('.params input[type=range]').first()
  await slider.waitFor()
  assert.equal(await page.locator('.step.open .step-name').innerText(), 'Normalize')
  await slider.fill('500')
  await page.waitForFunction(() => document.querySelector('.cm-content').innerText.includes('normalize(-18)'))
  await page.locator('.readout', { hasText: 'peak −18.0dBFS' }).waitFor()
  // one move, one step back
  await menu('Edit', 'Undo')
  await page.waitForFunction(() => document.querySelector('.cm-content').innerText.includes('normalize(-1)'))
})

// The edits, as a history: a press on a step shows the output as it is up to it, the steps after it dimmed, and opens
// its settings, one card at a time; a press again, or its badge on the picture, shows the whole chain. The sound the chain
// starts from comes first.
test('repl: a step chosen among the edits shows the output up to it and opens its settings; × removes one', async () => {
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
  await page.locator('.viewing', { hasText: 'Up to .normalize()' }).waitFor()
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
  await page.locator('.viewing', { hasText: 'Up to .trim()' }).click()
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
  // every step taken out at once, the sound kept; one undo brings them back
  await page.getByRole('button', { name: 'Discard edits' }).click()
  await page.waitForFunction(() => document.querySelector('.cm-content').innerText === "audio('chime.wav')")
  await page.locator('.no-steps').waitFor()
  await menu('Edit', 'Undo')
  await page.waitForFunction(() => document.querySelector('.cm-content').innerText.includes('.fade('))
})

// The tools: every method by kind; the words typed find one, Enter adds it, on the selection, and the panel turns to
// the edits with its card open. One the library can't run without a value gets its default written.
test('repl: a tool from the panel goes on the selection, its card open among the edits', async () => {
  await open()
  await tab('Tools')
  assert.ok((await page.locator('.tool-group').allInnerTexts()).includes('Filter'))
  const { box, x } = await axis(6.525), y = box.y + box.height * .3
  await drag([x(1.01), y], [x(2.01) - x(1.01), 0])
  assert.match(await page.locator('.tool-target').innerText(), /^The selection, 0:01\.\d+–0:02\.\d+$/)
  await page.locator('.tool-search').fill('cut lows')
  assert.deepEqual(await page.locator('.tool strong').allInnerTexts(), ['Highpass'])
  await page.keyboard.press('Enter')
  await page.waitForFunction(() => /\.highpass\(80, \{ at: [\d.]+, duration: [\d.]+ \}\)$/.test(document.querySelector('.cm-content').innerText))
  assert.equal(await page.getByRole('tab', { name: 'Edits' }).getAttribute('aria-selected'), 'true')
  assert.equal(await page.locator('.step.open .step-name').innerText(), 'Highpass')
  await page.locator('.plot').focus()
  await page.keyboard.press('Escape')
  await page.locator('.readout', { hasText: 'LUFS' }).waitFor()
  assert.equal(await page.locator('.message.problem').count(), 0)
})

test('repl: the panel shows the tools, the edits or the code, a tab each; closed, the output takes the block; the choice is remembered', async () => {
  await open()
  // the edits edit as the code does
  await tab('Edits')
  await page.locator('.script').waitFor({ state: 'hidden' })
  await page.locator('.step-name', { hasText: 'Normalize' }).click()
  await page.locator('.step.open .params input[type=range]').first().fill('500')
  await page.locator('.readout', { hasText: 'peak −18.0dBFS' }).waitFor()
  // closed from the bar: the output spans the block
  await page.getByRole('button', { name: 'The panel', exact: true }).click()
  await page.locator('.side-slab').waitFor({ state: 'hidden' })
  const [panes, view] = await Promise.all(['.panes', '.view-slab'].map(name => page.locator(name).boundingBox()))
  assert.ok(view.x - panes.x < 2 && panes.x + panes.width - (view.x + view.width) < 2, 'the output spans the block')
  // the choice is remembered
  await page.reload()
  await page.locator('.readout', { hasText: 'LUFS' }).waitFor()
  assert.ok(await page.locator('.side-slab').isHidden())
  await page.getByRole('button', { name: 'The panel', exact: true }).click()
  await page.locator('.stack').waitFor()
})

test('repl: Undo steps back through the script, a slider drag one step however long it pauses', async () => {
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
  await page.waitForFunction(() => document.querySelector('.cm-content').innerText.includes('normalize(-1)'))
  assert.equal(await undoable(), false, 'back where it started')
  // what was done: the step undone, still there to redo, named by what it changed (Edit > History, newest first)
  await page.locator('.menubar-item', { hasText: /^Edit$/ }).click()
  await row('History').click()
  const steps = await page.locator('.menubar-list').last().locator('.menu-label').allInnerTexts()
  await page.keyboard.press('Escape')
  assert.match(steps[0], /^normalize: -1 → -?[\d.]+$/)
  assert.equal(steps[1], 'The script as it opened')
})

// The caret goes to a selection's start however it was made, as a text's: dragged either way, double-clicked; once the
// selection is gone the clock reads it there
test('repl: the caret is at the start of a selection, however it was made', async () => {
  await open()
  const before = await seconds(), { box, x } = await axis(before)
  const clock = async () => (await page.locator('.time').innerText()).split('–')
  for (const [from, to] of [[.25, .5], [.5, .25]]) {
    await page.mouse.move(x(before * from), box.y + 100)
    await page.mouse.down()
    await page.mouse.move(x(before * to), box.y + 120, { steps: 5 })
    await page.mouse.up()
    const [start] = await clock()
    await page.keyboard.press('Escape')
    assert.deepEqual(await clock(), [start], `dragged ${from} → ${to}: the caret at ${start}`)
  }
  await page.mouse.dblclick(x(before * .4), box.y + 100)
  const [start, end] = await clock()
  assert.ok(end, 'a double-click selects')
  await page.keyboard.press('Escape')
  assert.deepEqual(await clock(), [start], 'double-clicked: the caret at the start')
})

test('repl: deleting a selection writes remove() and shortens the output by its length', async () => {
  await open()
  const before = await seconds(), { box, x } = await axis(before)
  await page.mouse.move(x(before * .25), box.y + 100)
  await page.mouse.down()
  await page.mouse.move(x(before * .5), box.y + 120, { steps: 5 })
  await page.mouse.up()
  assert.equal((await page.locator('.edits button').evaluateAll(b => b.map(x => x.getAttribute('aria-label')))).slice(0, 4).join(), 'Cut,Copy,Delete,Keep only this')
  // the bar sits under the selection, inside the picture, from the next frame
  await page.locator('.edits').waitFor()
  const bar = await page.locator('.edits').boundingBox(), mid = x(before * .375)
  assert.ok(Math.abs(bar.x + bar.width / 2 - mid) < 4 && bar.y + bar.height <= box.y + box.height, `bar at ${bar.x}, ${bar.y}`)
  await page.keyboard.press('Delete')
  await page.waitForFunction(() => document.querySelector('.cm-content').innerText.includes('.remove('))
  const [, at, duration] = (await code()).match(/\.remove\(\{ at: ([\d.]+), duration: ([\d.]+) \}\)/)
  // each time goes to the zoom's 1-2-5 step, at most 2.5 pixels
  const px = before / (box.width - 52)
  assert.ok(Math.abs(+at - before * .25) < 3 * px && Math.abs(+duration - before * .25) < 3 * px, `${at} ${duration}`)
  await page.waitForFunction(expected => Math.abs(+document.querySelector('.source').title.split(' · ').pop().split(':')[1] - expected) < .002, before - +duration)
  // the waveform shares the script's history
  await page.locator('.plot').focus()
  await page.keyboard.press('ControlOrMeta+Z')
  await page.waitForFunction(() => !document.querySelector('.cm-content').innerText.includes('.remove('))
  await page.waitForFunction(expected => Math.abs(+document.querySelector('.source').title.split(' · ').pop().split(':')[1] - expected) < .002, before)
})

test('repl: completion lists methods by group and a chosen one opens its sliders', async () => {
  await open()
  await page.locator('.cm-content').click()
  await page.keyboard.press('ControlOrMeta+End')
  await page.keyboard.type('\n  .gai')
  const options = page.locator('.cm-tooltip-autocomplete li')
  await options.first().waitFor()
  assert.ok((await options.allInnerTexts()).some(t => t.startsWith('gain')))
  // CodeMirror takes no accept key for 75 ms after the list opens (autocompletion's interactionDelay)
  await page.waitForTimeout(100)
  await page.keyboard.press('Enter')
  await page.waitForFunction(() => document.querySelector('.cm-content').innerText.endsWith('.gain()'))
  await tab('Edits')
  await page.locator('.step-name', { hasText: 'Gain' }).click()
  await page.locator('.step.open .step-name', { hasText: 'Gain' }).waitFor()
  await page.locator('.step.open .params input[type=range]').first().fill('750')
  await page.waitForFunction(() => /\.gain\(0\)$/.test(document.querySelector('.cm-content').innerText))
})

test('repl: a recipe keeps the source', async () => {
  await open()
  await menu('File', 'Recipes', 'Reduce noise')
  assert.equal(await code(), `audio('chime.wav').omlsa()`)
})

// The check (fn/check.js) of the result beside the file as it opened. Apple Podcasts: -16 LKFS ±1, true peak ≤ -1 dBFS
// (podcasters.apple.com/support/893). The default script peaks at -1 dBFS: its true peak sits above, and it is loud.
// The check, in the panel's Export tab: each rule, the result, the limit
test('repl: a delivery check shows each rule for the result, and follows the script', async () => {
  await open()
  await tab('Export')
  await page.locator('.export').getByRole('button', { name: 'Apple Podcasts' }).click()
  await page.locator('.check-table:not(.stale)').waitFor()
  const rows = async () => (await page.locator('.check-table tbody tr').allInnerTexts()).map(r => r.split('\t').map(c => c.trim()))
  assert.deepEqual(await page.locator('.check-table thead th').allInnerTexts(), ['RULE', 'AFTER', 'LIMIT'])
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
  assert.equal(await page.getByRole('button', { name: 'Format: flac' }).innerText(), 'FLAC')
  await page.locator('.export').getByRole('button', { name: 'Off' }).click()
  await page.locator('.check-table').waitFor({ state: 'detached' })
})

test('repl: a recipe made for a delivery spec checks the output against it', async () => {
  await open()
  await menu('File', 'Recipes', 'Podcast episode')
  await tab('Export')
  assert.equal(await page.locator('.export').getByRole('button', { name: 'Apple Podcasts' }).getAttribute('aria-pressed'), 'true')
  await page.waitForFunction(() => { const r = [...document.querySelectorAll('.check-table:not(.stale) tbody td:nth-of-type(1)')]; return r.length && r.every(td => !td.textContent.includes('✗')) }, null, { timeout: 30000 })
  assert.match(await code(), /\.normalize\('podcast'\)$/)
})

// B: the file as it opened, level-matched, at the same place; B again, the output. What is heard is said over the picture
// and checked in Play > Hear it before the edits
test('repl: B plays the file as it opened, level-matched to the result, and a new output returns to the result', async () => {
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

test('repl: a file dropped on the script opens it; one dropped on the waveform joins it', async () => {
  await open()
  const bytes = await wavBytes([sine(.5, 440, .5)])
  const drop = (selector, name) => page.evaluate(({ selector, name, bytes }) => {
    const target = document.querySelector(selector), rect = target.getBoundingClientRect(), data = new DataTransfer()
    data.items.add(new File([new Uint8Array(bytes)], name, { type: 'audio/wav' }))
    const at = { bubbles: true, cancelable: true, dataTransfer: data, clientX: rect.left + 40, clientY: rect.top + 40 }
    target.dispatchEvent(new DragEvent('dragover', at))
    target.dispatchEvent(new DragEvent('drop', at))
  }, { selector, name, bytes: [...bytes] })
  await write('')
  await drop('.view', 'tone.wav')
  await page.waitForFunction(() => document.querySelector('.cm-content').innerText === "audio('tone.wav')")
  await page.waitForFunction(() => document.querySelector('.source').title.split(' · ').pop() === '0:00.500')
  await drop('.view', 'tone.wav')
  await page.waitForFunction(() => document.querySelector('.cm-content').innerText === "audio(['tone.wav', 'tone-2.wav'])")
  await page.waitForFunction(() => document.querySelector('.source').title.split(' · ').pop() === '0:01.000')
})

test('repl: before the script runs, the intro shows nothing dead; while the first run renders, it stays away', async () => {
  // no script at all: the conditional parts (intro, recording, toolbar) stay hidden instead of showing inert buttons
  await page.route('**/repl/repl.js', route => route.abort())
  await page.goto(origin + '/repl.html')
  await page.waitForTimeout(300)
  for (const part of ['.empty', '.recording']) assert.equal(await page.locator(part).isVisible(), false, part)
  // and what does show takes no clicks yet: the Open menu stays shut
  assert.equal(await page.locator('#repl').evaluate(el => getComputedStyle(el).pointerEvents), 'none')
  await page.locator('.bar button', { hasText: 'Open' }).first().click({ force: true, timeout: 2000 }).catch(() => {})
  assert.equal(await page.locator('#open-menu').evaluate(el => el.matches(':popover-open')), false)
  await page.unroute('**/repl/repl.js')
  errors.splice(0)  // the script this part withheld on purpose
  // a slow engine: the script is up, the first output isn't, and the view doesn't claim there's no sound
  let release
  const held = new Promise(r => release = r)
  await page.route('**/repl/dist/worker.js', async route => { await held; route.continue() })
  await page.goto(origin + '/repl.html')
  await page.locator('.cm-content').waitFor()
  await page.waitForTimeout(300)
  assert.equal(await page.locator('.empty').isVisible(), false, 'no intro while the first run renders')
  release()
  await page.locator('.readout', { hasText: 'LUFS' }).waitFor()
  assert.equal(await page.locator('.empty').count(), 0)
  assert.equal(await page.locator('#repl').evaluate(el => getComputedStyle(el).pointerEvents), 'auto', 'taken over, it answers')
})

// A new sound goes into a tab of its own, and the script it came over stays in its tab; an empty script takes it whole
test('repl: a new sound opens in a tab of its own, the script shown before it kept; an empty one takes it', async () => {
  const bytes = await wavBytes([sine(.5, 440, .5)])
  const tabs = () => page.locator('.files [role="tab"]').allInnerTexts()
  await open()
  // a note alone: it stays, in its tab; the file in a tab after it
  await write('// my notes')
  await page.locator('.empty-title').waitFor()
  const chooser = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: 'Open file', exact: true }).click()
  await (await chooser).setFiles({ name: 'tone.wav', mimeType: 'audio/wav', buffer: bytes })
  await page.waitForFunction(() => document.querySelector('.cm-content').innerText === "audio('tone.wav')")
  await lengthIs('0:00.500')
  assert.deepEqual(await tabs(), ['untitled', 'tone.wav'])
  await page.getByRole('tab', { name: 'untitled' }).click()
  await page.waitForFunction(() => document.querySelector('.cm-content').innerText === '// my notes')
  // an empty script takes a generator, and then a sample goes into a tab of its own
  await page.locator('.cm-content').click()
  await page.keyboard.press('ControlOrMeta+A')
  await page.keyboard.press('Backspace')
  await page.locator('.empty-title').waitFor()
  await page.getByRole('button', { name: 'Sample or generate', exact: true }).click()
  const generator = await page.locator('#open-menu .menu-item').last().getAttribute('title')
  await page.locator('#open-menu .menu-item').last().click()
  await page.waitForFunction(g => document.querySelector('.cm-content').innerText === g, generator)
  await menu('File', 'Samples', 'chime.wav')
  await page.waitForFunction(() => document.querySelector('.cm-content').innerText === "audio('chime.wav')")
  await lengthIs('0:08.000')
  assert.deepEqual(await tabs(), ['generated', 'tone.wav', 'chime.wav'])
})

test('repl: an output of no samples shows the empty view; the next output replaces it', async () => {
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

test('repl: a file dropped on the waveform of a generated sound is inserted after it', async () => {
  await open()
  await write(`audio.from(0.5)`)
  await page.waitForFunction(() => document.querySelector('.source').title.split(' · ').pop() === '0:00.500')
  const bytes = await wavBytes([sine(.5, 440, .5)])
  await page.evaluate(bytes => {
    const target = document.querySelector('.view'), rect = target.getBoundingClientRect(), data = new DataTransfer()
    data.items.add(new File([new Uint8Array(bytes)], 'tone.wav', { type: 'audio/wav' }))
    const at = { bubbles: true, cancelable: true, dataTransfer: data, clientX: rect.left + 40, clientY: rect.top + 40 }
    target.dispatchEvent(new DragEvent('dragover', at))
    target.dispatchEvent(new DragEvent('drop', at))
  }, [...bytes])
  await page.waitForFunction(() => document.querySelector('.cm-content').innerText === "audio.from(0.5).insert(audio('tone.wav'))")
  await page.waitForFunction(() => document.querySelector('.source').title.split(' · ').pop() === '0:01.000')
})

// While the worker is held (a loop, until its 5 s guard), a script naming a sample not made yet, then a newer script:
// the page must end on the newer one, not on the older one arriving late.
test('repl: the newest script is the one shown, even when an older one waited for a sample', async () => {
  await open()
  await write(`while (true) {}`)
  await page.locator('.message', { hasText: 'Running' }).waitFor()
  await write(`audio('handpan.wav')`)
  await page.waitForTimeout(400)
  await write(`audio('chime.wav').reverse()`)
  await page.locator('.message', { hasText: 'Running' }).waitFor()
  await page.waitForFunction(() => !document.querySelector('.message').textContent && /LUFS/.test(document.querySelector('.readout').textContent), null, { timeout: 30000 })
  await page.waitForTimeout(1000)
  assert.equal(await page.locator('.source').innerText(), 'chime.wav')
  assert.equal(await lengthText(), '0:08.000')
})

test('repl: export downloads the output, encoded', async () => {
  await open()
  const length = await seconds()
  const waiting = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export', exact: true }).click()
  const download = await waiting
  assert.equal(download.suggestedFilename(), 'chime-edited.wav')
  const pcm = await audio(await readFile(await download.path())).read()
  assert.ok(Math.abs(pcm[0].length / 44100 - length) < .001)
  assert.ok(Math.abs(peakDb(pcm) + 1) < .05, `peak ${peakDb(pcm)}`)
})

test('repl: play moves the clock, and a new output keeps playing where it was', async () => {
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

test('repl: an error is said once, beside the time and at its line; the last output stays', async () => {
  await open()
  await write(`audio('chime.wav').gain(`)
  // said once, beside the time, in place of the output's figures; the output stays
  await page.locator('.message.problem', { hasText: 'Syntax error on line 1' }).waitFor()
  assert.ok(await drawn() > .05, 'the last output still drawn')
  await write(`let a = audio('chime.wav')\na.nope()`)
  await page.locator('.message.problem', { hasText: /nope.*line 2/ }).waitFor()
  await page.locator('.cm-lintRange-error').first().waitFor()
  assert.equal(await page.locator('.console .line.error').count(), 0, 'not again in the console')
  // a file the page doesn't have (a script kept from before a reload) is named once, and the view invites a drop
  await write(`audio('missing.wav').trim()`)
  await page.locator('.message.problem', { hasText: /^missing\.wav is not open\. Drop the file on the page or open it\.$/ }).waitFor()
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
test('repl: a recording becomes a file the script opens', async () => {
  await open()
  await write('')
  await page.locator('.empty').waitFor()
  await page.getByRole('button', { name: 'Record', exact: true }).first().click()
  await page.waitForFunction(() => /^0:0[1-9]/.test(document.querySelector('.time').textContent))
  assert.ok(await drawn() > .01, 'the take draws as it comes')
  await page.getByRole('button', { name: 'Stop recording', exact: true }).click()
  await page.waitForFunction(() => document.querySelector('.cm-content').innerText.startsWith("audio('recording.wav')"))
  // the take itself, untrimmed: about as long as the recording ran
  await write(`audio('recording.wav')`)
  await page.waitForFunction(() => { const s = +document.querySelector('.source').title.split(' · ').pop().split(':')[1]; return s > .9 && s < 3 })
})

test('repl: a found sound opens in a tab of its own, with its credit', async () => {
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
  await page.waitForFunction(() => document.querySelector('.cm-content').innerText.includes('.normalize(-1)'))
})

// ── The tools ──────────────────────────────────────────────────

test('repl: every button and readout says what it is when pointed at', async () => {
  await open()
  const untitled = await page.evaluate(() => [...document.querySelectorAll('button, output, .readout')]
    .filter(el => !el.title.trim() && !el.closest('.cm-editor')).map(el => el.outerHTML.slice(0, 100)))
  assert.deepEqual(untitled, [])
})

// The time axis spans the plot less its label gutter (view.js GUTTER, 52 px).
async function axis(duration) {
  const box = await page.locator('.plot').boundingBox(), w = box.width - 52
  return { box, x: t => box.x + t / duration * w }
}
// Moves the pointer along `points` until the plot shows `cursor`: where the tool can grab. Marks load after the output.
async function grab(points, cursor) {
  for (const until = Date.now() + 8000; Date.now() < until; await page.waitForTimeout(200))
    for (const [x, y] of points) {
      await page.mouse.move(x, y)
      if (await page.locator('.plot').evaluate(el => el.style.cursor) === cursor) return [x, y]
    }
  assert.fail(`nothing to grab with ${cursor}`)
}
const warps = async () => JSON.parse((await code()).match(/\.warp\((\[.*\])\)/)[1])
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
// The peak heard since the last call, and whether every sample was a number
const heard = () => page.evaluate(() => {
  let peak = 0, finite = true
  for (const block of window.__heard.splice(0)) for (const v of block) { if (!Number.isFinite(v)) finite = false; else if (Math.abs(v) > peak) peak = Math.abs(v) }
  return { peak, finite }
})

// A 440 Hz hit every half second, decaying from full scale.
const hits = `audio.from(t => Math.sin(2 * Math.PI * 440 * t) * Math.exp(-(t % 0.5) * 20), { duration: 2 })`
// The hits' notches at the top of the time row under the lanes, each an orange run 22 px above the plot's foot: their
// centres, in px
const handles = () => pixels(`const out = []; let run = -1; for (let x = 0; x <= w - 52; x++) { const i = ((h - 22) * w + x) * 4, on = x < w - 52 && d[i] - d[i + 2] > 60; if (on && run < 0) run = x; if (!on && run >= 0) { out.push((run + x - 1) / 2); run = -1 } } return out`)

test('repl: dragging a cue moves its hit, the audio on either side stretching to fit', async () => {
  await open()
  await write(hits)
  await lengthIs('0:02.000')
  // the hits are ticks on the time row, each grabbed there
  const { box, x } = await axis(2), y = box.y + box.height - 16
  const at = await grab(Array.from({ length: Math.ceil(x(1.05) - x(.95)) }, (_, i) => [x(.95) + i, y]), 'col-resize')
  // the hit the sound starts with is the start, which warp() holds: no tick there
  const cursor = () => page.locator('.plot').evaluate(el => el.style.cursor)
  await page.mouse.move(x(.25), y)
  assert.notEqual(await cursor(), 'col-resize')
  await page.mouse.move(x(0) + 2, y)
  assert.notEqual(await cursor(), 'col-resize')
  await drag(at, [x(1.2) - x(1), 0])
  await page.waitForFunction(() => /\.warp\(/.test(document.querySelector('.cm-content').innerText))
  const markers = await warps(), [moved] = markers.filter(([a, b]) => a !== b)
  // the hit at 1 s lands 0.2 s later; its neighbours, the hits at 0.5 s and 1.5 s, hold the rest in place
  assert.equal(markers.length, 3, JSON.stringify(markers))
  assert.ok(Math.abs(moved[0] - 1) < .03 && Math.abs(moved[1] - moved[0] - .2) < .01, JSON.stringify(markers))
  assert.deepEqual(markers.filter(([a, b]) => a === b).map(([a]) => Math.round(a * 2) / 2), [.5, 1.5])
  // the moved hit is its marker now: dragged again, that marker moves on
  const again = await grab(Array.from({ length: 13 }, (_, i) => [x(moved[1]) - 6 + i, y]), 'col-resize')
  await drag(again, [x(.1) - x(0), 0])
  await page.waitForFunction(to => document.querySelector('.cm-content').innerText.includes(`, ${to}`) === false, moved[1])
  const later = await warps()
  assert.equal(later.length, 3, JSON.stringify(later))
  assert.ok(later.some(([a, b]) => a === moved[0] && Math.abs(b - moved[1] - .1) < .01), JSON.stringify(later))
  // another cue joins the same call: the hit held at 0.5 s moves to 0.6 s
  const [first] = later
  await drag(await grab(Array.from({ length: 13 }, (_, i) => [x(first[1]) - 6 + i, y]), 'col-resize'), [x(.1) - x(0), 0])
  await page.waitForFunction(() => /\.warp\(\[\[[\d.]+, 0\.[5-6]\d*[1-9]/.test(document.querySelector('.cm-content').innerText))
  const last = await warps()
  assert.equal((await code()).match(/\.warp\(/g).length, 1)
  assert.equal(last.length, 3, JSON.stringify(last))
  assert.ok(Math.abs(last[0][1] - first[1] - .1) < .01 && last[0][0] === first[0], JSON.stringify(last))
  assert.deepEqual(last.slice(1), later.slice(1))
  await page.locator('.readout', { hasText: 'LUFS' }).waitFor()
  await lengthIs('0:02.000')
})

// The chime rings on, its partials beating: the cues are its eight strikes, not the swells of its rings, and one
// dragged moves alone.
test('repl: a dragged cue moves only its hit; the sound stretched around it makes no new cues', async () => {
  await open()
  let before = []
  for (const until = Date.now() + 8000; before.length < 8 && Date.now() < until; await page.waitForTimeout(200)) before = await handles()
  assert.equal(before.length, 8, JSON.stringify(before))
  // 0.2 s later: its neighbours are 0.58 s away on either side, however wide the plot
  const box = await page.locator('.plot').boundingBox(), dx = .2 / 6.525 * (box.width - 52)
  await drag(await grab([[box.x + before[5], box.y + box.height - 16]], 'col-resize'), [dx, 0])
  await page.waitForFunction(() => /\.warp\(/.test(document.querySelector('.cm-content').innerText))
  await page.waitForTimeout(1500)
  const after = await handles()
  await page.waitForTimeout(1000)
  assert.deepEqual(await handles(), after, 'settled')
  assert.equal(after.length, 8, JSON.stringify(after))
  assert.ok(Math.abs(after[5] - before[5] - dx) <= 2, `${before[5]} → ${after[5]}`)
  assert.ok(after.every((x, i) => i === 5 || Math.abs(x - before[i]) <= 1), JSON.stringify([before, after]))
})

// A chord's ring, stretched, swells anew under the piano's tremolo: found again in the warped output, a drag would
// grow cues in the spans it stretched. Carried from before warp(), every other cue stays on its pixel.
test('repl: a cue dragged over a sustained sound leaves every other cue where it was', async () => {
  await open()
  await write(`audio('rhodes.wav')`)
  await lengthIs('0:09.000')
  const { box, x } = await axis(9), y = box.y + box.height - 16
  let before = []
  for (const until = Date.now() + 8000; !before.length && Date.now() < until; await page.waitForTimeout(200)) before = await handles()
  // the chord struck at 4.85 s, moved half a second earlier
  const from = before.reduce((a, h) => Math.abs(h - (x(4.853) - box.x)) < Math.abs(a - (x(4.853) - box.x)) ? h : a), to = from - (x(.5) - x(0))
  await drag(await grab([[box.x + from, y]], 'col-resize'), [to - from, 0])
  await page.waitForFunction(() => /\.warp\(/.test(document.querySelector('.cm-content').innerText))
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
test('repl: a level change draws the gain line; its points drag, above or mirrored below, and a double-click takes one away', async () => {
  await open()
  await write(`audio.from(t => 0.5 * Math.sin(2 * Math.PI * 440 * t), { duration: 2 })`)
  await lengthIs('0:02.000')
  const { box, x } = await axis(2), mid = box.y + box.height * .4
  await page.mouse.move(x(.5), mid)
  await page.mouse.down()
  await page.mouse.move(x(1.5), mid, { steps: 5 })
  await page.mouse.up()
  await page.getByRole('button', { name: /3 dB louder/ }).click()
  await page.waitForFunction(() => /\.gain\(\{ t: \[/.test(document.querySelector('.cm-content').innerText))
  const curve = async () => (await code()).match(/\.gain\(\{ t: (\[.*?\]), v: (\[.*?\]) \}\)/).slice(1).map(s => JSON.parse(s.replace(/−/g, '-')))
  const [t, v] = await curve()
  assert.deepEqual(v, [0, 3, 3, 0])
  // the sine's −6.02 dBFS (20·log10 .5), 3 dB up where the curve is flat: −3.0, the selection's and the output's
  await page.locator('.readout', { hasText: 'peak −3.0dB · RMS' }).waitFor()
  await page.keyboard.press('Escape')
  await page.locator('.readout', { hasText: 'peak −3.0dBFS' }).waitFor()
  // the line on its own scale (view.js GAIN): −36 dB at the lane's centre line to +12 at its edges, mirrored below
  const lane = box.height - 22, centre = box.y + lane / 2, gy = (db, sign = 1) => centre - sign * (db + 36) / 48 * lane / 2
  const near = (t, db, sign = 1) => Array.from({ length: 11 }, (_, i) => [x(t), gy(db, sign) - 5 + i])
  // between its points, the line itself: a press there adds one
  const line = await grab(near(1, 3), 'ns-resize')
  // a point, dragged toward the centre line: quieter
  await drag(await grab(near(t[1], 3), 'move'), [0, 40])
  await page.waitForFunction(() => { const m = document.querySelector('.cm-content').innerText.match(/v: \[[^,]+, ([−\d.-]+),/); return m && +m[1].replace('−', '-') < 3 })
  assert.equal((await curve())[0][1], t[1], 'the point keeps its time')
  // its mirror image below the centre line drags it too
  await drag(await grab(near(t[2], 3, -1), 'move'), [0, -20])
  await page.waitForFunction(() => { const m = document.querySelector('.cm-content').innerText.match(/v: \[[^,]+, [^,]+, ([−\d.-]+),/); return m && +m[1].replace('−', '-') < 3 })
  // a double-click on a point takes it away
  await page.mouse.dblclick(...await grab(near(t[3], 0), 'move'))
  await page.waitForFunction(() => document.querySelector('.cm-content').innerText.match(/t: \[([^\]]+)\]/)?.[1].split(',').length === 3)
  assert.ok(line, 'the line is there to grab between its points')
})

test('repl: dragging a voiced stretch of the pitch curve up shifts that stretch up', async () => {
  await open()
  await write(`audio.from(t => 0.5 * Math.sin(2 * Math.PI * 220 * t) * (t > 0.5 && t < 1.5), { duration: 2 })`)
  await lengthIs('0:02.000')
  await menu('View', 'Pitch curve')
  const { box, x } = await axis(2)
  const at = await grab(Array.from({ length: Math.floor((box.height - 24) / 2) }, (_, i) => [x(1), box.y + i * 2]), 'ns-resize')
  await drag(at, [0, -30])
  await page.waitForFunction(() => /\.pitch\(/.test(document.querySelector('.cm-content').innerText))
  const [, semitones, from, duration] = (await code()).match(/\.pitch\(([\d.]+), \{ at: ([\d.]+), duration: ([\d.]+) \}\)/).map(Number)
  assert.ok(semitones > 0, semitones)
  // the tone sounds from 0.5 to 1.5 s; the pitch tracker's 46 ms frames blur each edge by up to half of one
  assert.ok(Math.abs(from - .5) < .03 && Math.abs(from + duration - 1.5) < .03, `${from} ${duration}`)
  // the same stretch dragged down again: the same call, its semitones back toward 0
  const shifted = await grab(Array.from({ length: Math.floor((box.height - 24) / 2) }, (_, i) => [x(1), box.y + i * 2]), 'ns-resize')
  await drag(shifted, [0, 15])
  await page.waitForFunction(st => { const m = document.querySelector('.cm-content').innerText.match(/\.pitch\(([\d.]+)/); return m && +m[1] < st }, semitones)
  const text = await code()
  assert.equal(text.match(/\.pitch\(/g).length, 1, text)
  assert.ok(text.includes(`{ at: ${from}, duration: ${duration} }`), text)
})

test('repl: the caret goes where the pointer presses; Play starts on its press; the loop switch leaves Space to play', async () => {
  await open()
  const { box, x } = await axis(6.525)
  await page.mouse.move(x(2), box.y + box.height / 2)
  await page.mouse.down()
  // times go by the zoom's 1-2-5 step just above a pixel (view.js unit): 6.5 s over this plot, 0.02 s
  await page.locator('.time', { hasText: /^0:02\.000$/ }).waitFor()
  await page.mouse.move(x(3), box.y + box.height / 2, { steps: 4 })
  await page.mouse.up()
  // the clock shows the range and under it its length, in the units the view settings choose, as the time row writes
  // them; the display above the levels still says what the sound is
  // the settings open and close from their button, keeping the selection (Escape on the picture would clear it)
  const units = async name => { const button = page.getByRole('button', { name: 'View settings' }); await button.click(); await page.locator('#view-menu').getByRole('button', { name, exact: true }).click(); await button.click() }
  assert.equal(await page.locator('.time').innerText(), '0:02.000–0:03.000')
  assert.equal(await page.locator('.span').innerText(), '0:01.000')
  assert.equal(await facts(), '44.1kHz stereo')
  assert.match(await readout(), /^peak −/)
  await units('s')
  assert.equal(await page.locator('.time').innerText(), '2.000s–3.000s')
  assert.equal(await page.locator('.span').innerText(), '1.000s')
  await units('samples')
  assert.equal(await page.locator('.time').innerText(), '88200–132300')
  assert.equal(await page.locator('.span').innerText(), '44100')
  await units('m:s')
  assert.equal(await page.locator('.time').innerText(), '0:02.000–0:03.000')
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

test('repl: the playhead starts at the caret and only moves on, however late the device sounds', async () => {
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

// On the log axis, 20 Hz to 24 kHz, a box a fifth of the lane tall spans a fifth of log2(1200) ≈ 2 octaves (×4.1).
// The wheel zooms along the axis it is on: on the frequencies (at the right of the picture) only them, on the times
// (the row below) only time; Ctrl and the wheel over the picture, a trackpad's pinch, only time. 0 shows all again.
test('repl: a pinch zooms the axis under the pointer, the frequencies or the times; the wheel scrolls; 0 shows all again', async () => {
  await open()
  await noCues()
  await write(hits)
  await lengthIs('0:02.000')
  await show('spec')
  const { box, x } = await axis(2)
  // a box, as a ratio of its top frequency to its bottom, and its times
  const band = async () => {
    await drag([x(.5), box.y + box.height * .4], [x(1) - x(.5), box.height * .2 * (box.height - 24) / box.height])
    const [lo, hi] = (await readout()).match(/[\d.]+k?Hz/g).map(v => parseFloat(v) * (v.includes('k') ? 1000 : 1))
    const times = await page.locator('.time').innerText()
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
  await pinch(box.x + box.width - 52 - 20, box.y + box.height * .5)
  const [strip, still] = await band()
  assert.ok(strip < 1.5 && still === span, `zoomed in from the spectrum: ×${strip}`)
})

// A resized canvas is blank until drawn; drawn a frame later, every step of a resize flashes empty (20 of these 40
// frames were, before the view drew in its resize callback). The panel's width is the view's to give up.
test('repl: resizing the panes never shows a blank frame', async () => {
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

// The view settings, above the axes: the frequency scale, what shows, snapping; each remembered
test('repl: the view settings switch the frequency scale, what shows and snapping, and are remembered', async () => {
  await open()
  await show('spec')
  const plot = page.locator('.plot'), now = () => plot.getAttribute('data-scale'), menu = page.locator('#view-menu')
  assert.equal(await now(), 'log')
  await page.getByRole('button', { name: 'View settings' }).click()
  await menu.getByRole('button', { name: 'Mel' }).click()
  assert.equal(await now(), 'mel')
  await menu.getByRole('button', { name: 'Hertz' }).click()
  assert.equal(await now(), 'lin')
  // a click on the frequencies switches nothing now
  await page.keyboard.press('Escape')
  const box = await plot.boundingBox()
  await page.mouse.click(box.x + box.width - 20, box.y + box.height * .1)
  assert.equal(await now(), 'lin')
  await page.getByRole('button', { name: 'View settings' }).click()
  await menu.getByRole('button', { name: 'Snap to cues and markers' }).click()
  assert.equal(await menu.getByRole('button', { name: 'Snap to cues and markers' }).getAttribute('aria-pressed'), 'false')
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

test('repl: each channel has its own lane: a sound in the left lights only the left', async () => {
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
test('repl: the spectrogram draws each channel\'s tone on its row, every lane at one scale of levels', async () => {
  await open()
  await write(`const tone = (f, a) => Float32Array.from({ length: 48000 }, (_, i) => a * Math.sin(2 * Math.PI * f * i / 48000))
audio.from([tone(1000, .5), tone(4000, .05)], { sampleRate: 48000 })`)
  await lengthIs('0:01.000')
  await show('spec')
  await page.waitForTimeout(300)
  const box = await page.locator('.plot').boundingBox(), lh = (box.height - 24 - 12) / 2, lanes = [[0, lh], [lh + 12, 2 * lh + 12]]
  const mel = f => 2595 * Math.log10(1 + f / 700), at = { log: f => Math.log2(f / 20) / Math.log2(24000 / 20), mel: f => mel(f) / mel(24000) }
  // the brightest pixel down the middle of each lane: its height in CSS px, its level
  const brightest = () => pixels(`const k = w / arg.width, x = Math.round(arg.x * k)
    return arg.lanes.map(([a, b]) => { let top = 0, at = 0; for (let y = Math.ceil(a * k); y < Math.floor(b * k); y++) { const v = d[(y * w + x) * 4 + 1]; if (v > top) { top = v; at = y } } return [(at + .5) / k, top] })`, { width: box.width, x: (box.width - 52) / 2, lanes })
  for (const scale of ['log', 'mel']) {
    if (scale === 'mel') {
      await page.getByRole('button', { name: 'View settings' }).click()
      await page.locator('#view-menu').getByRole('button', { name: 'Mel' }).click()
      await page.getByRole('button', { name: 'View settings' }).click()
      await page.waitForTimeout(300)
    }
    const [[y1, loud], [y4, quiet]] = await brightest()
    const row1 = lh * (1 - at[scale](1000)), row4 = lanes[1][0] + lh * (1 - at[scale](4000))
    assert.ok(Math.abs(y1 - row1) < 2 && Math.abs(y4 - row4) < 2, `${scale}: 1 kHz at ${y1.toFixed(1)} of ${row1.toFixed(1)}, 4 kHz at ${y4.toFixed(1)} of ${row4.toFixed(1)}`)
    assert.ok(loud > 200 && quiet > 90 && quiet < loud - 30, `${scale}: the loud tone ${loud}, the quiet ${quiet}`)
  }
})

test('repl: the waveform fill is as bright as the signal is often at that level', async () => {
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
})

// One block: the output with its bar along its foot, the transport at its start, and the panel at its right from top
// to foot, as Luminar's
test('repl: output and panel are one block, the bar along the output\'s foot, the panel to the foot beside it', async () => {
  await open()
  const box = name => page.locator(name).boundingBox()
  const [panes, bar, record, play, view, side] = await Promise.all(['.panes', '.status', 'button.record', 'button.play', '.view-slab', '.side-slab'].map(box))
  assert.ok(Math.abs(bar.y + bar.height - (panes.y + panes.height)) <= 1, 'the bar ends the block')
  assert.ok(Math.abs(bar.x - panes.x) <= 1 && Math.abs(bar.x + bar.width - side.x) <= 1, 'along the output alone')
  const loop = await box('button.loop')
  assert.ok(play.x - bar.x < 24 && play.x < record.x && record.x < loop.x && loop.x + loop.width < view.x + view.width, 'play, record, loop, at its start')
  assert.equal(await page.locator('.status').evaluate(el => getComputedStyle(el).borderTopWidth), '0px')
  // the panel at the right of the output, from the same top to the block's foot, whatever an older page left stored
  assert.ok(side.x >= view.x + view.width - 1 && Math.abs(side.y - view.y) <= 1, 'the panel beside the output')
  assert.ok(Math.abs(side.y + side.height - (panes.y + panes.height)) <= 1, 'to the foot')
  assert.equal(await page.locator('.splitter').count(), 0, 'one width, nothing to drag')
  await page.evaluate(() => localStorage.setItem('audio-repl', JSON.stringify({ ...JSON.parse(localStorage.getItem('audio-repl')), layout: 'column', side: 'stack' })))
  await page.reload()
  await page.locator('.readout', { hasText: 'LUFS' }).waitFor()
  const [picture, panel] = await Promise.all(['.view-slab', '.side-slab'].map(box))
  assert.ok(panel.x >= picture.x + picture.width - 1 && Math.abs(panel.y - picture.y) <= 1, 'still beside it')
  assert.equal(await page.getByRole('tab', { name: 'Edits' }).getAttribute('aria-selected'), 'true')
})

// Shows the waveform or the spectrogram, by its tab
const show = name => page.getByRole('tab', { name: name === 'spec' ? 'Spectrogram' : 'Waveform', exact: true }).click()

test('repl: a box on the spectrogram selects a band, plays it alone, and Delete writes spectral() for it', async () => {
  await open()
  await noCues()
  await write(hits)
  await lengthIs('0:02.000')
  await show('spec')
  const { box, x } = await axis(2)
  await drag([x(.5), box.y + box.height * .3], [x(1) - x(.5), box.height * .2])
  assert.equal((await page.locator('.edits button').evaluateAll(b => b.map(x => x.getAttribute('aria-label')))).join(), 'Remove this band,This band 6 dB quieter,This band 6 dB louder,Rebuild this band from its surroundings')
  assert.match(await page.locator('.time').innerText(), /^0:00\.50\d–0:01\.00\d$/)
  assert.match(await readout(), /^[\d.]+k?Hz–[\d.]+k?Hz$/)
  assert.match(await page.locator('button.play').getAttribute('title'), /^Play the selected band/)
  // the waveform shows no band: the time range stays, the band goes
  await show('wave')
  assert.doesNotMatch(await readout(), /Hz/)
  assert.match(await page.locator('button.play').getAttribute('title'), /^Play the selection/)
  // its tab again leaves it shown
  await show('spec')
  await show('spec')
  assert.equal(await page.getByRole('tab', { name: 'Spectrogram', exact: true }).getAttribute('aria-selected'), 'true')
  await drag([x(.5), box.y + box.height * .3], [x(1) - x(.5), box.height * .2])
  await page.keyboard.press('Delete')
  await page.waitForFunction(() => /\.spectral\(/.test(document.querySelector('.cm-content').innerText))
  const [, lo, hi, at, duration] = (await code()).match(/\.spectral\(\[([\d.]+), ([\d.]+)\], \{ at: ([\d.]+), duration: ([\d.]+) \}\)/).map(Number)
  assert.ok(30 < lo && lo < hi && hi < 22050, `${lo} ${hi}`)
  assert.ok(Math.abs(at - .5) < .01 && Math.abs(at + duration - 1) < .01, `${at} ${duration}`)
  // Shift keeps one axis of the box, the other whole: across, a time range of every frequency; up or down, a band over
  // all the time
  const shifted = async (dx, dy) => { await page.mouse.move(x(1.2), box.y + box.height * .2); await page.mouse.down(); await page.mouse.move(x(1.2) + 4, box.y + box.height * .2 + 4); await page.keyboard.down('Shift'); await page.mouse.move(x(1.2) + dx, box.y + box.height * .2 + dy, { steps: 4 }); await page.mouse.up(); await page.keyboard.up('Shift') }
  await shifted(x(1.6) - x(1.2), 20)
  assert.match(await page.locator('.time').innerText(), /^0:01\.20\d–0:01\.60\d$/)
  assert.doesNotMatch(await readout(), /Hz/)
  await shifted(10, box.height * .15)
  assert.equal(await page.locator('.time').innerText(), '0:00.000–0:02.000')
  assert.match(await readout(), /^[\d.]+k?Hz–[\d.]+k?Hz$/)
  // near a mark on the frequency axis, an edge takes its value: 2 kHz and 500 Hz on the log axis, 20 Hz to Nyquist
  const lane = box.height - 24, fy = f => box.y + lane - Math.log2(f / 20) / Math.log2(22050 / 20) * lane
  await drag([x(1.2), fy(2000) + 3], [x(1.6) - x(1.2), fy(500) - fy(2000) - 5])
  await page.keyboard.press('Delete')
  await page.waitForFunction(() => /\.spectral\(\[500, 2000\]/.test(document.querySelector('.cm-content').innerText))
})

// A band plays through two Butterworth biquads per edge. Its first highpass was once connected to itself: a feedback
// loop with no delay, whose output ran to 1e35.
test('repl: a band plays through stable filters: what reaches the speakers stays within full scale', async () => {
  await page.addInitScript(tap)
  await open()
  await show('spec')
  const { box, x } = await axis(6.525)
  await drag([x(1), box.y + box.height * .2], [x(2) - x(1), box.height * .1])
  assert.match(await readout(), /Hz–/)
  await heard()
  await page.keyboard.press('Space')
  await page.getByRole('button', { name: 'Pause' }).waitFor()
  await page.waitForTimeout(800)
  const { peak, finite } = await heard()
  assert.ok(finite && peak > 1e-3 && peak <= 1, `peak ${peak}`)
})

// Scrubbing (repl/scrub.js): a vocoder whose tonal peaks keep their phase advance, the rest of the bins random phases.
test('repl: the caret drags like an edge, from its line or anywhere on the time row, and the moment under it sounds while held', async () => {
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
  assert.ok(await page.locator('.edits').isHidden(), 'no range to edit')
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

test('repl: stopping settles the mark into the logo in about 300 ms', async () => {
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

// Over the bar's wordmark the mark copies the pointer's sideways moves, as a drag would, and catches in the logo pose
// when the pointer leaves; while a sound plays it leaves the pointer alone
test('repl: the mark copies the pointer over the wordmark, and catches in the logo pose when the pointer leaves', async () => {
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
  assert.ok(Math.abs(left - rest + 30 / width) < .01, `30 px left is ${30 / width} of a turn back, ${left - rest}`)
  await page.mouse.move(box.x + box.width - 25, y, { steps: 5 })
  await page.waitForTimeout(400)
  assert.ok(Math.abs(await phase() - (left + 15 / width)) < .01, 'and 15 px right, some of it forward again')
  // let go of it and it catches in the pose nearest, within 400 ms
  await page.mouse.move(box.x + box.width + 300, y + 300)
  await page.waitForTimeout(500)
  const caught = await phase()
  assert.ok(Math.abs(caught - Math.round(caught)) < .001, `the pointer has left: caught in a pose, ${caught}`)
  // a sound playing is the mark's business: the pointer moves it no more
  await page.locator('.plot').click({ position: { x: 120, y: 60 } })
  await page.keyboard.press('Space')
  await page.mouse.move(box.x + box.width - 10, y)
  await page.waitForTimeout(300)
  const playing = await phase()
  await page.mouse.move(box.x + box.width - 40, y, { steps: 10 })
  await page.waitForTimeout(300)
  const moved = await phase() - playing
  assert.ok(Math.abs(moved - 2.5 * .3) < .5 && Math.abs(moved + 30 / width) > .5, `while it plays it turns on its own, ${moved} in 0.3 s`)
  await page.keyboard.press('Space')
})

// The mark's wave after an edit that pitches a fragment down: the sound there has little a pitch tracker can hold, and a wave
// once lost to it stayed lost. What shows a few rows above the axis is a wave.
test('repl: the mark still shows the wave of a fragment pitched down, playing, and again after it', async () => {
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

test('repl: louder and quieter ease a range in and out on the one gain curve the pen draws', async () => {
  await open()
  await noCues()
  const { box, x } = await axis(6.525)
  await drag([x(2), box.y + 100], [x(3) - x(2), 0])
  const louder = page.getByRole('button', { name: /3 dB louder/ }), gain = () => code().then(c => c.match(/\.gain\((.*)\)$/)?.[1])
  await louder.click()
  await page.waitForFunction(() => /\.gain\(/.test(document.querySelector('.cm-content').innerText))
  assert.equal(await gain(), '{ t: [2, 2.005, 2.995, 3], v: [0, 3, 3, 0] }')
  // again adds again, to the same curve
  await louder.click()
  await page.waitForFunction(() => /v: \[0, 6, 6, 0\]/.test(document.querySelector('.cm-content').innerText))
  // a range from the start has no ramp there; the curve keeps the points of both
  await drag([x(1), box.y + 40], [x(0) - x(1) - 10, 0])
  await page.getByRole('button', { name: /3 dB quieter/ }).click()
  await page.waitForFunction(() => /v: \[-3, -3, 0, 0, 6, 6, 0\]/.test(document.querySelector('.cm-content').innerText))
  assert.equal(await gain(), '{ t: [0, 0.995, 1, 2, 2.005, 2.995, 3], v: [-3, -3, 0, 0, 6, 6, 0] }')
})

test('repl: a band quieter or louder is one spectral() call, changed in place while the band and range stay', async () => {
  await open()
  await noCues()
  await write(hits)
  await lengthIs('0:02.000')
  await show('spec')
  const { box, x } = await axis(2)
  await drag([x(.5), box.y + box.height * .3], [x(1) - x(.5), box.height * .2])
  await page.getByRole('button', { name: 'This band 6 dB quieter' }).click()
  await page.waitForFunction(() => /\.spectral\(\[\d+, \d+\], -6, \{ at: 0\.5, duration: 0\.5 \}\)$/.test(document.querySelector('.cm-content').innerText))
  await page.getByRole('button', { name: 'This band 6 dB quieter' }).click()
  await page.waitForFunction(() => /\.spectral\(\[\d+, \d+\], -12, /.test(document.querySelector('.cm-content').innerText))
  assert.equal((await code()).match(/\.spectral\(/g).length, 1)
})

// A script that opens with a gain() step draws its gain line from the start: the page must finish loading
test('repl: a script that opens with gain() loads, its gain line drawn', async () => {
  await page.addInitScript(() => localStorage.setItem('audio-repl', JSON.stringify({ side: 'code', code: `audio('chime.wav').gain(-6).gain({ t: [0, 1], v: [0, -6] })` })))
  await open()
  assert.match(await code(), /\.gain\(-6\)/)
})

test('repl: a shared link restores the script; narrow screens stack the output above it', async () => {
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
  const view = await page.locator('.view-slab').boundingBox(), chain = await page.locator('.side-slab').boundingBox()
  assert.ok(view.y + view.height <= chain.y, 'the output is above the chain')
  assert.ok(await page.getByRole('button', { name: 'Export', exact: true }).isVisible())
})

// ── Loading and the gestures ───────────────────────────────────

// A file comes over the network as it arrives: the script runs at once on what has come, the output streams, the
// waveform grows across the time the file's header says it lasts, the readout says how much has come
test('repl: a file over a slow connection shows as it arrives, with how much has come, then is whole', async () => {
  await open()
  await write(`audio('${origin}/slow/test/fixture.wav').gain(-1)`)
  // under 60% of it come: some drawn, not all
  await page.locator('.message', { hasText: /^Loading [1-5]?\d%$/ }).waitFor()
  const early = await drawn()
  assert.ok(early > 0, 'some of it is drawn before it has all come')
  await page.waitForFunction(() => !document.querySelector('.message').textContent && /LUFS/.test(document.querySelector('.readout').textContent), null, { timeout: 20000 })
  assert.ok(await drawn() > early, 'more once it has')
  await lengthIs('0:02.000')
})

// A sound that fails to open says so beside the time; choosing another clears that at once, before it has loaded
test('repl: a file that will not open says so, until another sound is chosen', async () => {
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
// The bursts' hits start at 0.5, 1.5 and 2 s (stat('onsets') finds them within 11 ms); pauses stand between them.
test('repl: a double-click selects between the cues around it, or the pause it is in; a triple-click a phrase; ⌥ and ⌘ arrows step by them', async () => {
  await open()
  await write(bursts)
  await lengthIs('0:02.500')
  const { box, x } = await axis(2.5), y = box.y + box.height / 3
  const range = async () => (await page.locator('.time').innerText()).split('–').map(t => +t.split(':')[1])
  const near = ([a, b], [p, q]) => Math.abs(a - p) < .03 && Math.abs(b - q) < .03
  // from the start to the next hit, as a sampler slices: the sound and the pause after it
  await page.mouse.dblclick(x(.2), y)
  assert.ok(near(await range(), [0, .5]), String(await range()))
  await page.mouse.dblclick(x(1.7), y)
  assert.ok(near(await range(), [1.5, 2]), String(await range()))
  await page.mouse.click(x(.2), y, { clickCount: 3 })
  assert.ok(near(await range(), [0, .9]), String(await range()))
  // in a pause, the pause
  await page.mouse.dblclick(x(1.2), y)
  assert.ok(near(await range(), [.9, 1.5]), String(await range()))
  await page.mouse.click(x(.1), y)
  const step = async key => { await page.keyboard.press(key); return +(await page.locator('.time').innerText()).split(':')[1] }
  const mac = process.platform === 'darwin'
  assert.ok(Math.abs(await step(mac ? 'Alt+ArrowRight' : 'Control+ArrowRight') - .5) < .03, 'to the next hit')
  assert.ok(Math.abs(await step(mac ? 'Alt+ArrowRight' : 'Control+ArrowRight') - 1.5) < .03, 'past the pause, to the one after')
  const back = await step(mac ? 'Meta+ArrowLeft' : 'Control+ArrowUp')
  assert.ok(Math.abs(back - .9) < .03, `back to the end of the phrase (${back})`)
})

// The selection's audio is what a drag of it moves: to where it is dropped, the rest closing up behind it; with Alt a
// copy over what is there; with ⌘ (Ctrl) its end stretches it and a drag up raises its level. Each is one step.
test('repl: a selection drags its audio: moved, copied over, stretched from its end, raised', async () => {
  await open()
  await noCues()
  await write(`audio('chime.wav')`)
  await lengthIs('0:08.000')
  const { box, x } = await axis(8), y = box.y + box.height * .3, mod = process.platform === 'darwin' ? 'Meta' : 'Control'
  const select = async (a, b) => { await page.mouse.click(x(7.5), y); await page.mouse.move(x(a), y); await page.mouse.down(); await page.mouse.move(x(b), y, { steps: 4 }); await page.mouse.up() }
  const gesture = async (from, to, key) => {
    if (key) await page.keyboard.down(key)
    await drag(from, to)
    if (key) await page.keyboard.up(key)
  }
  const last = async pattern => { await page.waitForFunction(p => new RegExp(p).test(document.querySelector('.cm-content').innerText), pattern.source); return code() }
  await select(1, 2)
  await gesture([x(1.5), y], [x(4) - x(1), 0])
  assert.match(await last(/\.cut\(/), /\.cut\(\{ at: 1, duration: 1 \}\)\.paste\(4\)$/)
  // the moved audio stays selected where it went
  assert.equal(await page.locator('.time').innerText(), '0:04.000–0:05.000')
  await page.keyboard.press('ControlOrMeta+Z')
  await page.waitForFunction(() => document.querySelector('.cm-content').innerText === "audio('chime.wav')")
  await lengthIs('0:08.000')
  await select(1, 2)
  await gesture([x(1.5), y], [x(5) - x(1), 0], 'Alt')
  assert.match(await last(/\.copy\(/), /\.copy\(\{ at: 1, duration: 1 \}\)\.remove\(\{ at: 5, duration: 1 \}\)\.paste\(5\)$/)
  await page.keyboard.press('ControlOrMeta+Z')
  await page.waitForFunction(() => document.querySelector('.cm-content').innerText === "audio('chime.wav')")
  await lengthIs('0:08.000')
  await select(1, 2)
  await gesture([x(2), y], [x(1.5) - x(1), 0], mod)
  assert.match(await last(/\.stretch\(/), /\.stretch\(1\.5, \{ at: 1, duration: 1 \}\)$/)
  await lengthIs('0:08.500')
  await page.keyboard.press('ControlOrMeta+Z')
  await page.waitForFunction(() => document.querySelector('.cm-content').innerText === "audio('chime.wav')")
  await lengthIs('0:08.000')
  await select(1, 2)
  await gesture([x(1.5), y], [0, -box.height / 10], mod)
  const text = await last(/\.gain\(/), [, v] = text.match(/\.gain\(\{ t: \[1, 1\.005, 1\.995, 2\], v: \[0, ([\d.]+), [\d.]+, 0\] \}\)$/) || [, text]
  assert.ok(+v > 0, v)
})

// Several ranges, as a text editor's several selections: the next pause like the one selected joins it (⌘D), and an
// edit acts on each, in one step
test('repl: pauses selected together are shortened or deleted together, in one step', async () => {
  await open()
  await write(bursts)
  await lengthIs('0:02.500')
  const { box, x } = await axis(2.5), y = box.y + box.height / 3
  await page.mouse.dblclick(x(.45), y)
  await page.keyboard.press('ControlOrMeta+D')
  await page.keyboard.press('ControlOrMeta+D')
  assert.match(await page.locator('.span').innerText(), /^3 ranges, 0:00\.\d+ in all$/)
  await page.getByRole('button', { name: 'Delete all 3' }).click()
  // the pauses at 0.4–0.5, 0.9–1.5 and 1.9–2 s, from the last back, so each time holds
  await page.waitForFunction(() => (document.querySelector('.cm-content').innerText.match(/\.remove\(/g) || []).length === 3)
  const ats = [...(await code()).matchAll(/remove\(\{ at: ([\d.]+)/g)].map(m => +m[1])
  assert.ok(ats[0] > ats[1] && ats[1] > ats[2] && Math.abs(ats[2] - .4) < .03, JSON.stringify(ats))
  await page.waitForFunction(() => +document.querySelector('.source').title.split(':').pop() < 1.8)
  await page.keyboard.press('ControlOrMeta+Z')
  await page.waitForFunction(() => !document.querySelector('.cm-content').innerText.includes('.remove('))
})

// M puts a marker at the caret, a mark() at the chain's end; its flag on the time row drags to move it, a
// double-click takes it away; File exports the parts between markers, a file each
test('repl: markers: M at the caret, dragged on the time row, taken away, the parts between them exported', async () => {
  await open()
  await write(`audio('chime.wav')`)
  await lengthIs('0:08.000')
  const { box, x } = await axis(8), y = box.y + box.height * .3, row = box.y + box.height - 18
  // the times the script gets: the caret's, to the zoom's step
  const marks = async n => { await page.waitForFunction(n => (document.querySelector('.cm-content').innerText.match(/\.mark\(/g) || []).length === n, n); return [...(await code()).matchAll(/\.mark\(([\d.]+)\)/g)].map(m => +m[1]) }
  await page.mouse.click(x(2), y)
  await page.keyboard.press('m')
  await page.mouse.click(x(5), y)
  await page.keyboard.press('m')
  const [a, b] = await marks(2)
  assert.ok(Math.abs(a - 2) < .05 && Math.abs(b - 5) < .05, `${a} ${b}`)
  // the flags come with the output that has them
  await drag(await grab([[x(a), row]], 'pointer'), [x(3) - x(2), 0])
  await page.waitForFunction(a => +(document.querySelector('.cm-content').innerText.match(/\.mark\(([\d.]+)\)/)?.[1]) > a + .9, a)
  await page.locator('.readout', { hasText: 'LUFS' }).waitFor()
  const downloads = []
  page.on('download', d => downloads.push(d.suggestedFilename()))
  await menu('File', 'Export the parts between markers')
  await page.waitForFunction(() => !document.querySelector('.bar-button.primary').textContent.includes('Exporting'))
  await page.waitForTimeout(300)
  assert.deepEqual(downloads.sort(), ['chime-edited-01.wav', 'chime-edited-02.wav', 'chime-edited-03.wav'])
  await page.mouse.dblclick(...await grab([[x(b), row]], 'pointer'))
  assert.equal((await marks(1)).length, 1)
})

// A selection's top corners, each drawn as the fade it makes, fade it: inward, in from its start or out to its end;
// outward, past its edge, a fade centred on that edge. A click on one chooses the curve: the fade just made takes it,
// and so do the next.
test('repl: a selection fades from its top corners: inward from its edge, outward centred on it, on the curve chosen', async () => {
  await open()
  await noCues()
  await write(`audio('chime.wav')`)
  await lengthIs('0:08.000')
  const { box, x } = await axis(8), y = box.y + box.height * .3, dot = box.y + 9
  const select = async () => { await page.mouse.click(x(7.5), y); await page.mouse.move(x(2.2), y); await page.mouse.down(); await page.mouse.move(x(4.2), y, { steps: 4 }); await page.mouse.up() }
  await select()
  await drag(await grab([[x(2.2) + 9, dot]], 'ew-resize'), [x(2.7) - x(2.2), 0])
  await page.waitForFunction(() => /\.fade\(0\.5, \{ at: 2\.2 \}\)$/.test(document.querySelector('.cm-content').innerText))
  // a click on the corner: its curves, and the fade just made takes the one chosen
  await page.mouse.click(x(2.2) + 3, box.y + 3)
  await page.locator('#fade-menu').getByRole('button', { name: 'S-curve' }).click()
  await page.waitForFunction(() => /\.fade\(0\.5, \{ at: 2\.2, curve: 'cos' \}\)$/.test(document.querySelector('.cm-content').innerText))
  await page.keyboard.press('ControlOrMeta+Z')
  await page.keyboard.press('ControlOrMeta+Z')
  await page.waitForFunction(() => !document.querySelector('.cm-content').innerText.includes('fade'))
  await select()
  await drag(await grab([[x(4.2) - 9, dot]], 'ew-resize'), [x(3.7) - x(4.2), 0])
  await page.waitForFunction(() => /\.fade\(-0\.5, \{ at: 3\.7, curve: 'cos' \}\)$/.test(document.querySelector('.cm-content').innerText))
  // out past the start: in over 0.4 s either side of it
  await select()
  await drag(await grab([[x(2.2) + 9, dot]], 'ew-resize'), [x(1.8) - x(2.2), 0])
  await page.waitForFunction(() => /\.fade\(0\.8, \{ at: 1\.8, curve: 'cos' \}\)$/.test(document.querySelector('.cm-content').innerText))
  // out past the end: out over 0.3 s either side of it
  await select()
  await drag(await grab([[x(4.2) - 9, dot]], 'ew-resize'), [x(4.5) - x(4.2), 0])
  await page.waitForFunction(() => /\.fade\(-0\.6, \{ at: 3\.9, curve: 'cos' \}\)$/.test(document.querySelector('.cm-content').innerText))
})

// Denoise: where the noise plays alone is selected, learned there and taken out everywhere, in one step; the rack sets how
// far down, the selection stays the noise. Nothing selected, it asks for that first.
test('repl: Denoise learns the noise where it is selected and takes it out everywhere', async () => {
  await open()
  await write(`audio('chime.wav')`)
  await lengthIs('0:08.000')
  await menu('Process', 'Repair', 'denoise')
  await page.locator('.message', { hasText: 'Select where the noise plays alone first.' }).waitFor()
  const { box, x } = await axis(8), y = box.y + box.height * .3, readout = await page.locator('.readout').innerText()
  await page.mouse.move(x(6), y); await page.mouse.down(); await page.mouse.move(x(7.5), y, { steps: 4 }); await page.mouse.up()
  await page.getByRole('button', { name: 'The noise alone: learned here, taken 12 dB down everywhere' }).click()
  await page.waitForFunction(() => /\.denoise\(\{ noise: \{ at: 6, duration: 1\.5 \} \}\)$/.test(document.querySelector('.cm-content').innerText))
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
  await page.getByRole('button', { name: 'The noise alone in all 3: learned there, taken 12 dB down everywhere' }).click()
  await page.waitForFunction(() => /\.denoise\(\{ noise: \[\{ at: [\d.]+, duration: [\d.]+ \}(, \{ at: [\d.]+, duration: [\d.]+ \}){2}\] \}\)$/.test(document.querySelector('.cm-content').innerText))
})

// While a selection loops, the caret put elsewhere takes playback there, over all of the output (nothing is selected)
test('repl: the caret put elsewhere while a selection loops plays from there, past the old loop', async () => {
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

// A selection's handles each do one thing: the grip at its bottom right stretches it, however the pointer wanders up or
// down; the pill on its top edge sets its level, however it wanders across.
test('repl: a selection\'s grip only stretches it, its pill only sets its level', async () => {
  await open()
  await noCues()
  await write(`audio('chime.wav')`)
  await lengthIs('0:08.000')
  const { box, x } = await axis(8), y = box.y + box.height * .3, foot = box.y + box.height - 24 - 12
  const select = async () => { await page.mouse.click(x(7.5), y); await drag([x(2.2), y], [x(4.2) - x(2.2), 0]) }
  await select()
  await drag(await grab([[x(4.2) - 5, foot]], 'ew-resize'), [x(5.2) - x(4.2), -80])
  await page.waitForFunction(() => /\.stretch\(1\.5, \{ at: 2\.2, duration: 2 \}\)$/.test(document.querySelector('.cm-content').innerText))
  assert.equal((await page.locator('.time').innerText()), '0:02.200–0:05.200')
  assert.doesNotMatch(await code(), /gain/)
  await page.keyboard.press('ControlOrMeta+Z')
  await page.waitForFunction(() => !document.querySelector('.cm-content').innerText.includes('stretch'))
  await select()
  await drag(await grab([[(x(2.2) + x(4.2)) / 2, box.y + 4]], 'ns-resize'), [60, -80])
  await page.waitForFunction(() => /\.gain\(\{ t: \[2\.2, 2\.205, 4\.195, 4\.2\], v: \[0, [\d.]+, [\d.]+, 0\] \}\)$/.test(document.querySelector('.cm-content').innerText))
  assert.doesNotMatch(await code(), /stretch/)
})

// A dragged edge, or the caret, goes onto a cue it comes within a few pixels of, as Figma's objects snap; one short of
// it stays
test('repl: a selection\'s dragged edge, or the caret, snaps to a cue near it', async () => {
  await open()
  await write(hits)
  await lengthIs('0:02.000')
  const { box, x } = await axis(2), y = box.y + box.height * .3
  let cues = []
  for (const until = Date.now() + 8000; cues.length < 3 && Date.now() < until; await page.waitForTimeout(200)) cues = await handles()
  const at = cues.find(h => Math.abs(h - (x(1) - box.x)) < 20)
  await drag([x(.7), y], [box.x + at + 4 - x(.7), 0])
  const end = +(await page.locator('.time').innerText()).split('–')[1].split(':')[1]
  assert.ok(Math.abs(end - 1) < .012, `on the hit at 1 s (stat('onsets') within 11 ms): ${end}`)
  await page.mouse.click(x(1.8), y)
  await drag([x(.3), y], [x(.45) - x(.3), 0])
  assert.match(await page.locator('.time').innerText(), /^0:00\.30\d–0:00\.45\d$/)
  // the caret, pressed on the time row a few pixels after a hit, goes onto it
  await page.mouse.click(box.x + at + 4, box.y + box.height - 8)
  const caret = +(await page.locator('.time').innerText()).split(':')[1]
  assert.ok(Math.abs(caret - end) < 1e-3, `the caret on the hit: ${caret}, the edge was ${end}`)
})

// Crossfade on a selection, as an editor's: the audio either side meets across it, and it goes (fn/crossfade.js)
test('repl: the crossfade tool on a selection crossfades across it', async () => {
  await open()
  await noCues()
  await write(`audio('chime.wav')`)
  await lengthIs('0:08.000')
  const { box, x } = await axis(8), y = box.y + box.height * .3
  await drag([x(2.2), y], [x(2.3) - x(2.2), 0])
  await tab('Tools')
  await page.locator('.tool-search').fill('crossfade')
  await page.keyboard.press('Enter')
  await page.waitForFunction(() => /\.crossfade\(\{ at: 2\.2, duration: 0\.1 \}\)$/.test(document.querySelector('.cm-content').innerText))
  await lengthIs('0:07.900')
  assert.equal(await page.locator('.message.problem').count(), 0)
})

// What goes wrong when the script runs shows over the picture, once, as well as beside the time
test('repl: an error the script meets shows over the picture, once', async () => {
  await open()
  await write(`audio('chime.wav').crossfade()`)
  await page.locator('.message.problem', { hasText: 'crossfade: expected a source to blend into' }).waitFor()
  await page.locator('.message.problem', { hasText: 'crossfade: expected a source' }).waitFor()
})

// Alt-click puts another caret, as a text editor's; M marks each, and a click leaves one
// Tabs, as an audio editor's open files: a sound opened goes into a tab of its own, each tab keeps its script and its
// own history, the page keeps them all, and closing the last leaves an empty one
test('repl: each sound opens in a tab of its own, with its own script and history, kept across a reload', async () => {
  await open()
  const tabs = () => page.locator('.files [role="tab"]').allInnerTexts()
  const shown = () => code().then(c => c.replace(/\s+/g, ''))
  await write(`audio('chime.wav').gain(-3)`)
  await lengthIs('0:08.000')
  await menu('File', 'Samples', 'handpan.wav')
  await page.waitForFunction(() => document.querySelector('.cm-content').innerText.trim() === "audio('handpan.wav')")
  assert.deepEqual(await tabs(), ['chime.wav', 'handpan.wav'])
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
    return location.origin + '/repl.html#code=' + btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
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

// The level axis: each level under its tick, in dB or as the sample values; Ctrl and the wheel on it zooms the levels,
// so a quiet sound fills the lane, and 0 shows full scale again
test('repl: the level axis reads in dB or sample values, and zooms', async () => {
  await open()
  await write(`audio.from(t => 0.05 * Math.sin(2 * Math.PI * 220 * t), { duration: 1 })`)
  await lengthIs('0:01.000')
  await page.waitForTimeout(300)
  const box = await page.locator('.plot').boundingBox(), ax = box.x + box.width - 26, ay = box.y + (box.height - 24) * .3
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
  // in sample values: the pointer on the lane's top edge reads 1
  await page.getByRole('button', { name: 'View settings' }).click()
  await page.locator('#view-menu').getByRole('button', { name: '±1' }).click()
  await page.getByRole('button', { name: 'View settings' }).click()
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('audio-repl')).levels), 'linear')
})

// Esc closes the fade menu, and nothing else: the selection it was opened from stays
test('repl: Esc closes the fade curve menu and keeps the selection', async () => {
  await open()
  await noCues()
  await write(`audio('chime.wav')`)
  await lengthIs('0:08.000')
  const { box, x } = await axis(8), y = box.y + box.height * .3
  await drag([x(2), y], [x(4) - x(2), 0])
  // a click on the fade-in corner, a little inside the selection's top left
  await page.mouse.click(x(2) + 8, box.y + 8)
  await page.locator('#fade-menu:popover-open').waitFor()
  assert.deepEqual(await page.locator('#fade-menu .menu-item').allInnerTexts(), ['Linear', 'Exponential', 'Logarithmic', 'S-curve'])
  await page.keyboard.press('Escape')
  await page.locator('#fade-menu:popover-open').waitFor({ state: 'detached' })
  assert.match(await page.locator('.time').innerText(), /^0:02\.0\d\d–0:04\.0\d\d$/)
})

test('repl: Alt-click adds carets; M puts a marker at each', async () => {
  await open()
  await write(`audio('chime.wav')`)
  await lengthIs('0:08.000')
  const { box, x } = await axis(8), y = box.y + box.height * .3
  await page.mouse.click(x(2.2), y)
  await page.keyboard.down('Alt')
  await page.mouse.click(x(4.2), y)
  await page.mouse.click(x(6.2), y)
  await page.keyboard.up('Alt')
  await page.getByRole('button', { name: 'A marker at each of the 3 carets' }).waitFor()
  await page.keyboard.press('m')
  await page.waitForFunction(() => (document.querySelector('.cm-content').innerText.match(/\.mark\(/g) || []).length === 3)
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
  await page.getByRole('button', { name: 'Paste at all 2' }).waitFor()
  await page.keyboard.press('ControlOrMeta+V')
  await page.waitForFunction(() => (document.querySelector('.cm-content').innerText.match(/\.paste\(/g) || []).length === 2)
  assert.deepEqual([...(await code()).matchAll(/\.paste\(([\d.]+)\)/g)].map(m => Math.round(+m[1] * 10) / 10), [6.2, 2.2])
  // a plain click leaves one caret: a paste there alone
  await page.mouse.click(x(3), y)
  await page.getByRole('button', { name: 'Paste at the cursor' }).waitFor()
})

// The clipboard's keys: ⌘C copies the selection, ⌘X cuts it, ⌘V pastes at the caret, each a call on the chain. ⌘C once
// wrote the copy an Alt-drag makes, from a selection that has no destination: `copy: at is NaN`.
test('repl: ⌘C copies the selection, ⌘X cuts it, ⌘V pastes at the caret', async () => {
  await open()
  await noCues()
  await write(`audio('chime.wav')`)
  await lengthIs('0:08.000')
  const { box, x } = await axis(8), y = box.y + box.height * .3, last = () => code().then(c => c.trim().split('\n').at(-1))
  await drag([x(1), y], [x(2) - x(1), 0])
  await page.keyboard.press('ControlOrMeta+C')
  await page.waitForFunction(() => /\.copy\(\{ at: [\d.]+, duration: [\d.]+ \}\)$/.test(document.querySelector('.cm-content').innerText.trim()))
  const [, at, duration] = (await last()).match(/\.copy\(\{ at: ([\d.]+), duration: ([\d.]+) \}\)$/).map(Number)
  assert.ok(Math.abs(at - 1) < .02 && Math.abs(duration - 1) < .02, `${at} ${duration}`)
  await page.mouse.click(x(5), y)
  await page.keyboard.press('ControlOrMeta+V')
  await page.waitForFunction(() => /\.paste\([\d.]+\)$/.test(document.querySelector('.cm-content').innerText.trim()))
  await drag([x(1), y], [x(2) - x(1), 0])
  await page.keyboard.press('ControlOrMeta+X')
  await page.waitForFunction(() => /\.cut\(\{ at: [\d.]+, duration: [\d.]+ \}\)$/.test(document.querySelector('.cm-content').innerText.trim()))
  await page.waitForTimeout(500)
  assert.equal(await page.locator('.message.problem').count(), 0, await page.locator('.message').allInnerTexts().then(t => t.join()))
})

// A card's switches: a step turned off (its eye) is commented out where it stands; Δ plays and draws what a step takes out
test('repl: a step turns off and on, Δ shows what it takes out', async () => {
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
  // what the fade takes out: the start and end it softens, far under the output
  await card('Fade').hover()
  await page.getByRole('button', { name: 'What fade takes out' }).click()
  await page.locator('.viewing', { hasText: 'What .fade() takes out' }).waitFor()
  await page.waitForFunction(() => { const m = document.querySelector('.readout').textContent.match(/^peak −([\d.]+)dBFS/); return m && +m[1] > 6 })
  await card('Fade').hover()
  await page.getByRole('button', { name: 'What fade takes out' }).click()
  await page.locator('.viewing').waitFor({ state: 'detached' })
  await page.locator('.readout', { hasText: 'peak −1.0dBFS' }).waitFor()
})

// The caret dragged, Shift held on the way: a range from where the caret was pressed
test('repl: a caret dragged with Shift held becomes a range from where it was pressed', async () => {
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
  assert.equal(await page.locator('.time').innerText(), '0:02.000–0:03.000')
})

// A generated sound's first call makes it: the source has nothing to turn off, take away or remove; chosen, it is the
// sound alone. A step that changes time, rate or channels has nothing to take away (Δ): it doesn't line up.
test('repl: a generated sound\'s source has no switches and shows the sound alone; a step that reshapes has no Δ', async () => {
  await open()
  await write(`audio.from(t => 0.5 * Math.sin(2 * Math.PI * 440 * t), { duration: 1, channels: 2 }).gain(-3).filter('highpass', 80).remix(1).speed(2)`)
  await lengthIs('0:00.500')
  await tab('Edits')
  const card = name => page.locator('.step', { has: page.locator('.step-name', { hasText: name }) })
  assert.equal(await card('From').locator('button.icon-button').count(), 0)
  assert.equal(await card('Gain').locator('button.icon-button').count(), 3)
  const delta = name => card(name).getByRole('button', { name: `What ${name.toLowerCase()} takes out` })
  assert.deepEqual([await delta('Gain').isDisabled(), await delta('Filter').isDisabled(), await delta('Remix').isDisabled(), await delta('Speed').isDisabled()], [false, false, true, true])
  await page.locator('.step-name', { hasText: 'From' }).click()
  await page.locator('.viewing', { hasText: 'Up to .from()' }).waitFor()
  await lengthIs('0:01.000')
  await page.locator('.viewing').click()
  await page.locator('.viewing').waitFor({ state: 'detached' })
  await lengthIs('0:00.500')
  // every step discarded: what makes the sound stays
  await page.getByRole('button', { name: 'Discard edits' }).click()
  await page.waitForFunction(() => document.querySelector('.cm-content').innerText === 'audio.from(t => 0.5 * Math.sin(2 * Math.PI * 440 * t), { duration: 1, channels: 2 })')
  await lengthIs('0:01.000')
})

// What each card says of its step: numbers with their units, a band in hertz, a range by its times, a gain curve by its
// points, warp's markers as from → to, a sound by its name
test('repl: each card says what its step is set to, whatever its arguments are', async () => {
  await open()
  await write(`audio('chime.wav')\n  .gain({ t: [0, 1, 2], v: [0, -6, 0] })\n  .spectral([500, 2000], -6, { at: 1, duration: 0.5 })\n  .warp([[1, 1.2], [2, 2.1]])\n  .mix(audio('chime.wav'), { at: 2 })\n  .normalize(-16, 'lufs')`)
  await lengthIs('0:08.000')
  await tab('Edits')
  assert.deepEqual(await page.locator('.step-args').allInnerTexts(), ['', 'curve, 3 points', '500Hz–2kHz · −6dB · 1–1.5s', '1 → 1.2, 2 → 2.1', 'chime.wav · from 2s', '−16dB · lufs'])
})

// What the sound is, on the display: its rate resamples it, its channels mix it, each setting the chain's one call
test('repl: the display\'s rate resamples and its channels mix, each the chain\'s one call', async () => {
  await open()
  await page.getByRole('button', { name: '44.1kHz', exact: true }).click()
  await page.locator('#rate-menu .menu-item', { hasText: '48kHz' }).click()
  await page.waitForFunction(() => document.querySelector('.cm-content').innerText.includes('.resample(48000)'))
  await page.waitForFunction(() => document.querySelector('.facts').textContent.startsWith('48kHz'))
  await page.getByRole('button', { name: '48kHz', exact: true }).click()
  await page.locator('#rate-menu .menu-item', { hasText: '22.05kHz' }).click()
  await page.waitForFunction(() => { const t = document.querySelector('.cm-content').innerText; return t.includes('.resample(22050)') && !t.includes('48000') })
  await page.getByRole('button', { name: 'stereo', exact: true }).click()
  await page.locator('#channels-menu .menu-item', { hasText: 'mono' }).click()
  await page.waitForFunction(() => document.querySelector('.cm-content').innerText.includes('.remix(1)'))
  await page.waitForFunction(() => document.querySelector('.facts').innerText.replace(/\s+/g, ' ').trim() === '22.05kHz mono')
})

// Zoomed out past the whole: the sound starts at the left edge, the room on its right; the time row is marked
test('repl: zoomed out past the whole, the sound starts at the left and the room is on its right', async () => {
  await open()
  await page.locator('.plot').focus()
  for (let i = 0; i < 2; i++) await page.keyboard.press('-')
  await page.waitForTimeout(400)
  // lit columns of the picture, the labels at its right left out
  const [first, last] = await pixels(`let a = -1, b = -1; for (let x = 0; x < w - 60; x++) { let lit = 0; for (let y = 0; y < h * .8; y += 2) { const i = (y * w + x) * 4; if (d[i] + d[i + 1] + d[i + 2] > 300) lit++ } if (lit > 3) { if (a < 0) a = x; b = x } } return [a / w, b / w]`)
  assert.ok(first < .03 && last < .45, `lit from ${first} to ${last}`)
})

// A fade drags from a selection's dot and shows on the waveform as it goes, before its output comes
test('repl: a fade shows on the waveform while its dot is dragged', async () => {
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
  await page.waitForFunction(() => /\.fade\(1, \{ at: 2 \}\)$/.test(document.querySelector('.cm-content').innerText))
})

// The bar's record button starts a take and stops it
// Recording over a sound, as a dictaphone or a tape: from the caret, into the waveform as it comes, what it covers
// replaced and the end extended past; one write() step, which Undo takes back. Into a selection, it ends at its end.
test('repl: the record button records over the sound from the caret, into the waveform, one step Undo takes back', async () => {
  await open()
  // a selection's edges go where they are let go: the take's own hits, still shown a moment after Undo, take none
  await noCues()
  await write(`audio('chime.wav')`)
  await lengthIs('0:08.000')
  const { box, x } = await axis(8), y = box.y + box.height * .3
  await page.mouse.click(x(7.5), box.y + box.height - 8)
  await page.getByRole('button', { name: 'Record', exact: true }).click()
  await page.getByRole('button', { name: 'Stop recording', exact: true }).waitFor()
  // the clock runs from the caret, past the old end
  await page.waitForFunction(() => /^0:0(8\.[3-9]|9)/.test(document.querySelector('.time').textContent), null, { timeout: 15000 })
  await page.getByRole('button', { name: 'Stop recording', exact: true }).click()
  await page.waitForFunction(() => /\.write\(audio\('take\.wav'\), \{ at: 7\.5 \}\)$/.test(document.querySelector('.cm-content').innerText))
  await page.waitForFunction(() => +document.querySelector('.source').title.split(' · ').pop().split(':')[1] > 8.2)
  await page.keyboard.press('ControlOrMeta+Z')
  await lengthIs('0:08.000')
  // into a selection: it stops at its end by itself, the length kept
  await page.mouse.click(x(6), y)
  await drag([x(2), y], [x(2.5) - x(2), 0])
  await page.getByRole('button', { name: 'Record', exact: true }).click()
  await page.getByRole('button', { name: 'Record', exact: true }).waitFor({ timeout: 15000 })
  await page.waitForFunction(() => /\.write\(audio\('take(-2)?\.wav'\), \{ at: 2 \}\)$/.test(document.querySelector('.cm-content').innerText))
  await lengthIs('0:08.000')
  // with the loop on, pass after pass over the selection until stopped; the clock goes round within it
  await page.keyboard.press('ControlOrMeta+Z')
  await lengthIs('0:08.000')
  await page.mouse.click(x(6), y)
  await drag([x(2), y], [x(2.5) - x(2), 0])
  assert.equal(await page.locator('.time').innerText(), '0:02.000–0:02.500')
  await page.getByRole('button', { name: 'Loop' }).click()
  await page.getByRole('button', { name: 'Record', exact: true }).click()
  await page.getByRole('button', { name: 'Stop recording', exact: true }).waitFor()
  await page.waitForTimeout(1300)
  const clock = +(await page.locator('.time').innerText()).split(':')[1]
  assert.ok(clock >= 2 && clock <= 2.5, `within the selection, pass after pass: ${clock}`)
  await page.getByRole('button', { name: 'Stop recording', exact: true }).click()
  await page.waitForFunction(() => /\.write\(audio\('take-\d\.wav'\), \{ at: 2 \}\)$/.test(document.querySelector('.cm-content').innerText))
  await lengthIs('0:08.000')
})

// Search runs as it is typed, half a second after the last key, once
test('repl: sound search runs half a second after the typing stops, once', async () => {
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
test('repl: the menu works from the keys, and gives them back', async () => {
  await open()
  await page.locator('.plot').focus()
  await page.keyboard.press('F10')
  assert.equal(await page.evaluate(() => document.activeElement.textContent), 'File')
  for (const key of ['ArrowRight', 'ArrowRight', 'ArrowRight', 'ArrowDown', 'ArrowDown', 'Enter']) await page.keyboard.press(key)
  // View, its second item: the spectrogram, in place of the waveform
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('audio-repl') || '{}').display === 'spec')
  assert.ok(await page.locator('.plot').evaluate(el => el === document.activeElement), 'the keys are back on the picture')
})

