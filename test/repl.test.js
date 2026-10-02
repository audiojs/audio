// REPL: npm run test:repl. The engine runs in a real browser worker; its output is compared with the library in Node,
// the command-line translation with the CLI itself. All requests stay local.
import { test, before, after, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { tmpdir } from 'node:os'
import { extname, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import wav from '@audio/encode-wav'
import audio from '../audio.js'
import { prepare, error, chain, append, source, callAt, setArg, cli } from '../repl/code.js'
import { ops, guides, previews } from '../repl/ops.js'
import attacks, { hits as hitsOf } from '../repl/attack.js'
import { boxed } from '../repl/player.js'
import opIcons from '../repl/icons.js'
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
  // the page opens with its panel closed, the picture whole: the code is written through its panel (write), and a test of
  // a panel opens it
  await page.addInitScript(() => {
    // the script, its lines as the editor has them, the code panel open or not
    globalThis.scriptText = () => [...document.querySelectorAll('.cm-content .cm-line')].map(l => l.textContent).join('\n')
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
// The scrub voice as the worklet runs it: its module imported with a worklet's globals, one class for every run
let Scrubber
async function scrubbed(x, caret, seconds, rate = 48000, mode) {
  globalThis.sampleRate = rate
  if (!Scrubber) {
    Object.assign(globalThis, { AudioWorkletProcessor: class { constructor() { this.port = { onmessage: null, postMessage() {} } } }, registerProcessor: (_, cls) => { Scrubber = cls }, currentTime: 0 })
    await import('../repl/scrub.js')
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

// Several boxes on the spectrogram play as the library makes them (player.js boxed): each box's band over its time,
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

// Cues are slice points: where each hit's attack starts, so a cut there keeps all of it. The built-in samples strike at
// known times (site/samples.js: the chime's bars at 0.5 + 0.6 n s, 0.9 s more after the fourth; the handpan's phrase);
// their rings beat and overlap, and make none. Reversed, each strike is a stop, and the cues are the same, mirrored: to
// within the 1 ms steps of the envelope the attack is read on and the 1 ms the zero crossing is looked for in.
test('attack: the cue of each hit lands at its strike, before it or within the first half millisecond of a soft one', async () => {
  const strikes = { chime: [.5, 1.1, 1.7, 2.3, 3.8, 4.4, 5, 5.6], handpan: [.3, .85, 1.3, 1.75, 2.3, 2.75, 3.25, 3.9] }
  for (const [name, times] of Object.entries(strikes)) {
    const channels = samples[name].make(), cues = hitsOf(channels, SAMPLES), end = channels[0].length / SAMPLES
    assert.equal(cues.length, times.length, name)
    cues.forEach((t, i) => assert.ok(t - times[i] > -.004 && t - times[i] < .0006, `${name} strike ${i} at ${times[i]} s: cue ${t.toFixed(4)}`))
    const back = hitsOf(channels.map(x => x.slice().reverse()), SAMPLES)
    assert.equal(back.length, cues.length, `${name} reversed`)
    back.forEach((t, i) => assert.ok(Math.abs(t - (end - cues.at(-1 - i))) < .002, `${name} reversed: stop ${i} at ${t.toFixed(4)}, the strike mirrored ${(end - cues.at(-1 - i)).toFixed(4)}`))
  }
  // a swell or a decay, 60 or 120 dB a second, is a slope in dB and makes none; a gate's stop makes one, as a strike
  // mirrored: after the sound, within 4 ms (a sine of 440 Hz, which crosses zero where the gate shuts at 1.2 s)
  const rate = 44100, tone = gain => [Float32Array.from({ length: rate * 2 }, (_, i) => gain(i / rate) * Math.sin(2 * Math.PI * 440 * i / rate))]
  for (const db of [60, 120]) assert.deepEqual(hitsOf(tone(t => 10 ** (-db / 20 * Math.abs(t - 1))), rate), [], `${db} dB a second`)
  const [stop, ...more] = hitsOf(tone(t => t < 1.2 ? 1 : 0), rate)
  assert.ok(!more.length && stop > 1.2 - .0006 && stop < 1.2 + .004, String(stop))
  // nothing to find: no samples, fewer than a step's, silence (and the gate's tone, sounding from the start, has no cue there)
  for (const x of [new Float32Array(0), new Float32Array(100), new Float32Array(rate)]) assert.deepEqual(hitsOf([x, x], rate), [], `${x.length} samples`)
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

// the script, its lines as the editor has them, the code panel open or not
const code = () => page.evaluate(() => [...document.querySelectorAll('.cm-content .cm-line')].map(l => l.textContent).join('\n').replace(/ /g, ' '))
const readout = () => page.locator('.readout').innerText()
// The output's length, from the name's tooltip ("chime.wav · 0:06.525"): the axes show it, so the page doesn't repeat it
const lengthText = () => page.evaluate(() => document.querySelector('.source').title.split(' · ').pop())
const seconds = async () => { const [m, s] = (await lengthText()).split(':'); return +m * 60 + +s }
async function open() {
  await page.goto(origin + '/repl.html')
  await page.locator('.readout', { hasText: 'LUFS' }).waitFor()
}
// A choice in the settings (a panel over the picture, from the bar), by its group's name; the panel then closed
async function settings(group, name) {
  await tab('Settings')
  await page.locator('.settings').getByRole('group', { name: group }).getByRole('button', { name, exact: true }).click()
  await page.getByRole('tab', { name: 'Settings', exact: true }).click()
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
  assert.match(await readout(), /^peak −1\.0dBFS −\d+\.\dLUFS$/)
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
  await page.waitForFunction(() => scriptText().includes('normalize(-18)'))
  await page.locator('.readout', { hasText: 'peak −18.0dBFS' }).waitFor()
  // one move, one step back
  await menu('Edit', 'Undo')
  await page.waitForFunction(() => scriptText().includes('normalize(-1)'))
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
test('repl: an edit from the palette goes on the selection, its card open among the edits', async () => {
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

// Over the picture: its tabs, undo and redo, how it shows (the waveform, the spectrogram), then over its meter its
// settings, none moving as the picture turns. At the slab's top right, as an
// editor's activity bar, the panels' buttons: the recipes, the agent, the edits, the code, the export. A panel docks
// beside the picture, part of the slab, no line between them, no title over it (its button says which); its button
// again closes it; its left edge drags its width; the choice and the width are remembered. Undo is undo, nothing else
test('repl: undo, redo, the picture\'s switch, its settings over its meter, none moving; the panels\' buttons at the top right; a panel docks beside the picture', async () => {
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
  // in order: undo, redo, the switch, then the settings over the meter (the waveform's bar, 6 px before the 40 px of labels,
  // view.js); none moves as the picture turns
  const heads = () => Promise.all([['button', 'Undo'], ['button', 'Redo'], ['tab', 'Waveform'], ['tab', 'Spectrogram'], ['tab', 'Settings']].map(([role, name]) => page.getByRole(role, { name, exact: true }).boundingBox()))
  const [undo, redo, wave, spec, settings] = await heads()
  assert.ok(undo.x < redo.x && redo.x < wave.x && wave.x < spec.x && spec.x < settings.x && settings.y < plot.y, 'undo, redo, the switch, the settings')
  assert.ok(Math.abs(settings.x + settings.width / 2 - (plot.x + plot.width - 46)) <= 2, `the settings over the meter: ${settings.x + settings.width / 2}, ${plot.x + plot.width - 46}`)
  assert.ok(spec.x - (wave.x + wave.width) <= 2, 'the waveform and the spectrogram a pair, as undo and redo')
  await show('spec')
  assert.deepEqual((await heads()).map(b => b.x), [undo, redo, wave, spec, settings].map(b => b.x), 'nothing moved as it turned')
  await show('wave')
  // part of the slab: no ground of its own, no line between it and the picture
  assert.equal(await page.locator('.side-slab').evaluate(el => [getComputedStyle(el).backgroundColor, getComputedStyle(el).boxShadow].join(' ')), 'rgba(0, 0, 0, 0) none')
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
  await tab('Settings')
  const was = await box('.side-slab'), edge = await box('.panel-edge'), y = edge.y + edge.height / 2
  await page.mouse.move(edge.x + edge.width / 2, y)
  await page.mouse.down()
  await page.mouse.move(edge.x + edge.width / 2 - 100, y, { steps: 5 })
  await page.mouse.up()
  const wider = await box('.side-slab')
  assert.ok(Math.abs(wider.width - was.width - 100) < 3, `${was.width} → ${wider.width}`)
  await page.reload()
  await page.locator('.readout', { hasText: 'LUFS' }).waitFor()
  await page.locator('.settings').waitFor()
  assert.ok(Math.abs((await box('.side-slab')).width - wider.width) < 2, 'its width kept')
  await page.getByRole('tab', { name: 'Settings', exact: true }).click()
  await page.locator('.side-slab').waitFor({ state: 'hidden' })
})

// A panel opening beside the picture leaves it where it starts and at its scale, less of the sound showing, never
// squeezed; so does a narrower window. A range on silence, its edges' columns: the caret's line at its start, the
// wash's last, the same before and after
test('repl: a panel opening, or the window narrowing, keeps where the picture starts and its scale', async () => {
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
  await tab('Settings')
  await page.waitForTimeout(200)
  assert.deepEqual(await edges(), before, 'the panel open')
  await tab('Settings')
  await page.setViewportSize({ width: 1000, height: 720 })
  await page.waitForTimeout(200)
  assert.deepEqual(await edges(), before, 'the window narrower')
})

// A number in the code drags, as Bret Victor's Tangle has it: across, a step (its last decimal's) for every 4 px, the
// output following as it goes; let go, one step of the history. A minus before it is its own
test('repl: a number in the code drags, the output following, one step of the history', async () => {
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
test('repl: an older output arriving while a newer edit is drawn ahead leaves the view where it is', async () => {
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
test('repl: a slice moved past the end opens silence up to where it lands', async () => {
  const { x, y } = await chime()
  await drag([x(6), y], [x(7) - x(6), 0])
  await keyed(['ControlOrMeta'], () => drag([x(6.5), y], [x(7.9) - x(6.5), 0]))
  await page.waitForFunction(() => /\.move\(\{ at: 6, d: 1, to: 7\.4, xfade: 0\.01 \}\)$/.test(scriptText()))
  await lengthIs('0:08.400')
})

// A slice dragged up over the head onto the tabs goes to a tab of its own, this one's script cropped to it: copied (Alt),
// this one as it was; moved (⌘), it leaves this one, the rest closing up as a cut's
test('repl: a slice dragged onto the tabs goes to a tab of its own; moved, it leaves this one', async () => {
  const { x, y } = await chime()
  const up = async keys => {
    await drag([x(1), y], [x(2) - x(1), 0])
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
  await up(['ControlOrMeta'])
  await page.waitForFunction(() => document.querySelectorAll('.file').length === 3)
  await page.waitForFunction(() => scriptText() === "audio('chime.wav')\n  .crop({ at: 1, d: 1 })")
  await page.locator('.file [role="tab"]').first().click()
  await page.waitForFunction(() => scriptText() === "audio('chime.wav')\n  .remove({ at: 1, d: 1, xfade: 0.01 })")
  await lengthIs('0:07.000')
})

// Tabs drag along to reorder, as a browser's; the order is kept for the next visit
test('repl: a tab dragged along the others goes where it is let go, kept for the next visit', async () => {
  await open()
  await page.getByRole('button', { name: 'New tab' }).click()
  const names = () => page.locator('.file [role="tab"]').allInnerTexts()
  assert.deepEqual(await names(), ['chime.wav', 'untitled'])
  const [first, second] = await Promise.all([0, 1].map(i => page.locator('.file').nth(i).boundingBox()))
  await page.mouse.move(first.x + 20, first.y + first.height / 2)
  await page.mouse.down()
  await page.mouse.move(second.x + second.width - 10, first.y + first.height / 2, { steps: 8 })
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

// WORKSHOP: the settings' icon (three sliders with round thumbs, or two), the panel's edge (a bar, three dots, nothing
// until pointed at), the switches joined (raised keys in one bezel, or pills on a track), how the view's options open (a
// chevron, the shown tab clicked again, or right-clicked); the export's icon settled, an arrow down onto a tray
test('repl: the workshop turns the settings\' icon and the panel\'s edge; the switches are keys in a bezel; the view\'s options open from a right-click', async () => {
  await open()
  const icon = name => page.getByRole('tab', { name, exact: true }).locator('path').getAttribute('d')
  assert.equal((await icon('Settings')).match(/a2 2 0 1 1-4 0/g).length, 3, 'three sliders, their round thumbs')
  await page.locator('.workshop button', { hasText: '2 sliders' }).click()
  assert.equal((await icon('Settings')).match(/a2 2 0 1 1-4 0/g).length, 2, 'two')
  assert.equal(await icon('Export'), 'M12 4v11m-5-5 5 5 5-5M4 19h16', 'an arrow down onto a tray')
  await tab('Settings')
  const grip = () => page.locator('.panel-grip').evaluate(el => { const s = getComputedStyle(el); return `${s.width} ${s.height} ${s.boxShadow === 'none' ? 'one' : 'three'}` })
  assert.equal(await grip(), '3px 28px one', 'a bar on its edge')
  await page.locator('.workshop button', { hasText: 'Dots' }).click()
  assert.equal(await grip(), '3px 3px three', 'three dots')
  await page.locator('.workshop button', { hasText: 'None' }).click()
  assert.equal(await grip(), '0px 0px one', 'nothing, until pointed at')
  // the switches, settled: raised keys in one bezel, each touching the next
  const group = page.locator('.settings .choices').first()
  const [first, second] = await group.locator('button').evaluateAll(list => list.slice(0, 2).map(b => b.getBoundingClientRect()).map(r => [r.left, r.right]))
  assert.equal(second[0], first[1], 'raised keys in one bezel')
  assert.notEqual(await group.evaluate(el => getComputedStyle(el).backgroundColor), 'rgba(0, 0, 0, 0)')
  // the view's options: its tab right-clicked, shown at once
  await page.getByRole('tab', { name: 'Settings', exact: true }).click()
  await page.getByRole('tab', { name: 'Spectrogram', exact: true }).click({ button: 'right' })
  await page.locator('.menubar-menu .menu-row', { has: page.locator('.menu-label', { hasText: /^FFT size$/ }) }).waitFor()
  assert.equal(await page.getByRole('tab', { name: 'Spectrogram', exact: true }).getAttribute('aria-selected'), 'true', 'shown at once')
})

// The edits as a browser's history: a step chosen shows the output up to it; an edit made then goes after it, the steps
// after it dropped, in one step, which undo takes back
test('repl: an edit made with the output rolled back to a step goes after it, the steps after it gone', async () => {
  await open()
  await tab('Edits')
  await page.locator('.step-name', { hasText: 'Trim' }).click()
  await page.locator('.viewing', { hasText: 'Up to .trim()' }).waitFor()
  await page.locator('.readout', { hasText: 'LUFS' }).waitFor()
  await page.keyboard.press('m')
  await page.waitForFunction(() => /\.trim\(\)\s*\.mark\(0\)$/.test(scriptText().trim()))
  assert.doesNotMatch(await code(), /normalize|fade/)
  await page.locator('.viewing').waitFor({ state: 'detached' })
  assert.deepEqual(await page.locator('.step-name').allInnerTexts(), ['chime.wav', 'Trim', 'Mark'])
  await menu('Edit', 'Undo')
  await page.waitForFunction(() => /\.trim\(\)\s*\.normalize\(-1\)\s*\.fade\(0\.02, 0\.1\)$/.test(scriptText().trim()))
})

// Rolled back, a choice that sets the last step again in place (the grip's way, a fade's curve) leaves the steps after
// the one shown alone: only what shows is set again, never a step hidden
test('repl: rolled back to a step, the grip\'s way leaves a stretch after it as it is', async () => {
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
test('repl: undo brings back what was selected before the step, redo what was selected after it', async () => {
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
test('repl: the caret is at the start of a selection, however it was made', async () => {
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

test('repl: deleting a selection writes remove() and shortens the output by its length', async () => {
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
  const px = before / (box.width - GUTTER)
  assert.ok(Math.abs(+at - before * .25) < 3 * px && Math.abs(+duration - before * .25) < 3 * px, `${at} ${duration}`)
  await page.waitForFunction(expected => Math.abs(+document.querySelector('.source').title.split(' · ').pop().split(':')[1] - expected) < .002, before - +duration)
  // the waveform shares the script's history
  await page.locator('.plot').focus()
  await page.keyboard.press('ControlOrMeta+Z')
  await page.waitForFunction(() => !scriptText().includes('.remove('))
  await page.waitForFunction(expected => Math.abs(+document.querySelector('.source').title.split(' · ').pop().split(':')[1] - expected) < .002, before)
})

test('repl: completion lists methods by group and a chosen one opens its sliders', async () => {
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
  await page.waitForFunction(() => scriptText() === "audio('tone.wav')")
  await page.waitForFunction(() => document.querySelector('.source').title.split(' · ').pop() === '0:00.500')
  await drop('.view', 'tone.wav')
  await page.waitForFunction(() => scriptText() === "audio(['tone.wav', 'tone-2.wav'])")
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
  await page.locator('.cm-content').waitFor({ state: 'attached' })
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
  await page.waitForFunction(() => scriptText() === "audio.from(0.5)\n  .insert(audio('tone.wav'))")
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
  await tab('Export')
  await page.locator('.export-button').click()
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
test('repl: a recording becomes a file the script opens', async () => {
  await open()
  await write('')
  await page.locator('.empty').waitFor()
  await page.getByRole('button', { name: 'Record', exact: true }).first().click()
  await page.waitForFunction(() => /^0:0[1-9]/.test(document.querySelector('.time').textContent))
  assert.ok(await drawn() > .01, 'the take draws as it comes')
  await page.getByRole('button', { name: 'Stop recording', exact: true }).click()
  await page.waitForFunction(() => scriptText().startsWith("audio('recording.wav')"))
  // the take itself, untrimmed: about as long as the recording ran
  await write(`audio('recording.wav')`)
  const long = () => page.waitForFunction(() => { const s = +document.querySelector('.source').title.split(' · ').pop().split(':')[1]; return s > .9 && s < 3 })
  await long()
  const before = await lengthText()
  // kept for the next visit, as a file is (a 32-bit float WAV): the same length after a reload, nothing missing
  await page.waitForTimeout(500)
  await page.reload()
  await page.locator('.readout', { hasText: 'LUFS' }).waitFor()
  assert.equal(await lengthText(), before)
  assert.equal(await page.locator('.message.problem').count(), 0)
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
  await page.waitForFunction(() => scriptText().includes('.normalize(-1)'))
})

// ── The tools ──────────────────────────────────────────────────

test('repl: every button and readout says what it is when pointed at', async () => {
  await open()
  const untitled = await page.evaluate(() => [...document.querySelectorAll('button, output, .readout')]
    .filter(el => !el.title.trim() && !el.closest('.cm-editor')).map(el => el.outerHTML.slice(0, 100)))
  assert.deepEqual(untitled, [])
})

// The time axis spans the plot less its label gutter (view.js GUTTER, 40 px); the lanes are 2 px apart (GAP), over the
// time row (RULER, 22 px)
const GUTTER = 40, LANES = 2
async function axis(duration) {
  const box = await page.locator('.plot').boundingBox(), w = box.width - GUTTER
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
// The peak heard since the last call, and whether every sample was a number
const heard = () => page.evaluate(() => {
  let peak = 0, finite = true
  for (const block of window.__heard.splice(0)) for (const v of block) { if (!Number.isFinite(v)) finite = false; else if (Math.abs(v) > peak) peak = Math.abs(v) }
  return { peak, finite }
})

// A 440 Hz hit every half second, decaying from full scale.
const hits = `audio.from(t => Math.sin(2 * Math.PI * 440 * t) * Math.exp(-(t % 0.5) * 20), { duration: 2 })`
// The hits' lines, lit while ⌘ (Ctrl) is held over the picture: each an orange run along a row 4 px under the lanes'
// top, their centres, in px
async function handles() {
  await page.locator('.plot').focus()
  await page.keyboard.down('ControlOrMeta')
  const out = await pixels(`const out = []; let run = -1; for (let x = 0; x <= w - ${GUTTER}; x++) { const i = (4 * w + x) * 4, on = x < w - ${GUTTER} && d[i] - d[i + 2] > 60; if (on && run < 0) run = x; if (!on && run >= 0) { out.push((run + x - 1) / 2); run = -1 } } return out`)
  await page.keyboard.up('ControlOrMeta')
  return out
}
// A hit's line dragged, ⌘ (Ctrl) held: grabbed where the pointer finds it along `points`
async function dragCue(points, by) {
  await page.keyboard.down('ControlOrMeta')
  await drag(await grab(points, 'col-resize'), by)
  await page.keyboard.up('ControlOrMeta')
}

// The cues are where sounds start and end and where they hit, one list: each hit here (0.5 s apart), and where each falls
// quiet before the next. A cue dragged warps the audio between the cues either side, which hold.
test('repl: dragging a cue moves it, the audio on either side stretching to fit, the cues either side holding', async () => {
  await open()
  await write(hits)
  await lengthIs('0:02.000')
  // the cues are lines in the lanes, each grabbed there with ⌘ (Ctrl) held; without it, a press there is the caret's
  const { box, x } = await axis(2), y = box.y + 20, cursor = () => page.locator('.plot').evaluate(el => el.style.cursor)
  // the hit at 1 s, and the cues either side of it, before it moves
  let cues = []
  for (const until = Date.now() + 8000; !cues.some(t => Math.abs(t - 1) < .02) && Date.now() < until; await page.waitForTimeout(200)) cues = (await handles()).map(px => px / (box.width - GUTTER) * 2)
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
test('repl: a dragged cue moves alone; the sound stretched around it makes no new cues', async () => {
  await open()
  let before = []
  for (const until = Date.now() + 8000; before.length < 8 && Date.now() < until; await page.waitForTimeout(200)) before = await handles()
  assert.ok(before.length >= 8, JSON.stringify(before))
  // 0.2 s later, a cue with room for it either side
  const box = await page.locator('.plot').boundingBox(), dx = .2 / 6.525 * (box.width - GUTTER)
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
test('repl: a cue dragged over a sustained sound leaves every other cue where it was', async () => {
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
test('repl: a level change draws the gain line; its points drag, above or mirrored below, and a double-click takes one away', async () => {
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

// The pitch is edited in its own context (View > Edit pitch, or the pill turned to pitch): its curve shows, the gain line
// goes, and a voiced stretch of it drags up or down
test('repl: dragging a voiced stretch of the pitch curve up shifts that stretch up', async () => {
  await open()
  await write(`audio.from(t => 0.5 * Math.sin(2 * Math.PI * 220 * t) * (t > 0.5 && t < 1.5), { duration: 2 })`)
  await lengthIs('0:02.000')
  await menu('View', 'Edit pitch')
  // the tone's 220 Hz on the waveform's pitch axis, 60 Hz to 1 kHz on octaves (view.js VOICE), its voiced stretch there
  const { box, x } = await axis(2), lh = box.height - 22, f0y = box.y + lh * (1 - Math.log(220 / 60) / Math.log(1000 / 60))
  const at = await grab(Array.from({ length: 9 }, (_, i) => [x(1), f0y - 4 + i]), 'ns-resize')
  await drag(at, [0, -30])
  await page.waitForFunction(() => /\.pitch\(/.test(scriptText()))
  const [, semitones, from, duration] = (await code()).match(/\.pitch\(([\d.]+), \{ at: ([\d.]+), d: ([\d.]+) \}\)/).map(Number)
  assert.ok(semitones > 0, semitones)
  // the tone sounds from 0.5 to 1.5 s; the pitch tracker's 46 ms frames blur each edge by up to half of one
  assert.ok(Math.abs(from - .5) < .03 && Math.abs(from + duration - 1.5) < .03, `${from} ${duration}`)
  // the same stretch dragged down again: the same call, its semitones back toward 0
  const up = box.y + lh * (1 - Math.log(220 * 2 ** (semitones / 12) / 60) / Math.log(1000 / 60))
  const shifted = await grab(Array.from({ length: 9 }, (_, i) => [x(1), up - 4 + i]), 'ns-resize')
  await drag(shifted, [0, 15])
  await page.waitForFunction(st => { const m = scriptText().match(/\.pitch\(([\d.]+)/); return m && +m[1] < st }, semitones)
  const text = await code()
  assert.equal(text.match(/\.pitch\(/g).length, 1, text)
  assert.ok(text.includes(`{ at: ${from}, d: ${duration} }`), text)
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

// What the sound holds, in the status bar: the note at the caret (440 Hz is A4, ISO 16), a melody's compass over a
// selection (A4 then E5, 659.26 Hz, 2^(7/12) × 440), and, over 6 s at least, the tempo and the key of all of it: clicks
// every 0.5 s are 120 BPM, a C major triad (C4 E4 G4, 261.63, 329.63, 392 Hz) over them is in C major (Krumhansl-Kessler)
test('repl: the status bar says the note at the caret, a selection\'s compass, the tempo and the key', async () => {
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

// The play button held is a shuttle: 2× each 40 px right or up, 0.1× to 10×, while held, then back to 1×. The clock
// runs at that speed: over 400 ms at 4× it moves on about 1.6 s.
test('repl: the play button held and dragged plays faster or slower, springing back to 1× let go', async () => {
  await open()
  const play = await page.locator('button.play').boundingBox(), cx = play.x + play.width / 2, cy = play.y + play.height / 2
  const said = () => page.locator('.hint').innerText()
  const clock = () => page.locator('.time').innerText().then(t => { const [m, s] = t.split(':'); return +m * 60 + +s })
  await page.mouse.move(cx, cy)
  await page.mouse.down()
  await page.getByRole('button', { name: 'Pause' }).waitFor()
  await page.mouse.move(cx + 80, cy, { steps: 4 })
  assert.equal(await said(), '4×')
  await page.waitForTimeout(200)
  const t0 = await clock()
  await page.waitForTimeout(400)
  const ran = await clock() - t0
  assert.ok(ran > 1.1 && ran < 2.2, `at 4× 400 ms ran ${ran} s`)
  // past the ends it stops at them; up is faster as right is
  await page.mouse.move(cx - 400, cy, { steps: 4 })
  assert.equal(await said(), '0.1×')
  await page.mouse.move(cx, cy - 400, { steps: 4 })
  assert.equal(await said(), '10×')
  await page.mouse.move(cx, cy, { steps: 2 })
  assert.equal(await said(), '1×')
  await page.mouse.move(cx - 40, cy, { steps: 2 })
  assert.equal(await said(), '0.5×')
  // let go: it plays on at 1×, the readout gone; heard once the device has played what it holds (its latency)
  await page.mouse.up()
  assert.ok(await page.locator('.hint').isHidden())
  assert.ok(await page.getByRole('button', { name: 'Pause' }).isVisible())
  await page.waitForTimeout(400)
  const t1 = await clock()
  await page.waitForTimeout(400)
  const after = await clock() - t1
  assert.ok(after > .25 && after < .6, `at 1× 400 ms ran ${after} s`)
  // a press while it plays, let go at once, pauses, the caret where it was pressed
  await page.mouse.move(cx, cy)
  await page.mouse.down()
  const pressed = await clock()
  await page.waitForTimeout(150)
  await page.mouse.up()
  await page.getByRole('button', { name: 'Play', exact: true }).waitFor()
  assert.ok(Math.abs(await clock() - pressed) < .05, `${await clock()} vs ${pressed}`)
  // held still while playing, then let go: it plays on
  await page.keyboard.press('Space')
  await page.getByRole('button', { name: 'Pause' }).waitFor()
  await page.mouse.down()
  await page.waitForTimeout(600)
  assert.equal(await said(), '1×')
  await page.mouse.up()
  await page.waitForTimeout(100)
  assert.ok(await page.getByRole('button', { name: 'Pause' }).isVisible())
  await page.keyboard.press('Space')
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

// The settings, the panel's last tab: the frequency scale, what shows, snapping; each remembered
// The frequency scale is the spectrogram's own: its tab again, or a right-click on it; snapping is a setting; both kept
test('repl: the spectrogram\'s frequency scale from its tab or a right-click, snapping from the settings, both remembered', async () => {
  await open()
  await show('spec')
  const plot = page.locator('.plot'), now = () => plot.getAttribute('data-scale'), panel = page.locator('.settings')
  assert.equal(await now(), 'log')
  await show('spec')
  assert.equal(await now(), 'mel')
  const { box: at } = await axis(1)
  await page.mouse.click(at.x + 200, at.y + 100, { button: 'right' })
  for (const name of ['Spectrogram', 'Frequency scale', 'Hertz']) await page.locator('.menubar-menu .menu-row', { has: page.locator('.menu-label', { hasText: new RegExp(`^${name}$`) }) }).last().click()
  assert.equal(await now(), 'lin')
  await tab('Settings')
  // a click on the frequencies switches nothing now
  const box = await plot.boundingBox()
  await page.mouse.click(box.x + box.width - 20, box.y + box.height * .1)
  assert.equal(await now(), 'lin')
  await panel.getByRole('button', { name: 'Snap to cues and markers' }).click()
  assert.equal(await panel.getByRole('button', { name: 'Snap to cues and markers' }).getAttribute('aria-pressed'), 'false')
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

// One block: a head over the picture and the panel, the bar along the foot of both, the transport at its start, a
// status bar as an editor's; the panel docked at the picture's right
test('repl: output and bar are one block, the panel docked at the output\'s right, from under the head to the bar', async () => {
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

test('repl: a box on the spectrogram selects a band, plays it alone, and Delete writes spectral() for it', async () => {
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
  // its tab again leaves it shown, its frequencies on the next scale; round again, on octaves
  await show('spec')
  await show('spec')
  assert.equal(await page.getByRole('tab', { name: 'Spectrogram', exact: true }).getAttribute('aria-selected'), 'true')
  assert.equal(await page.locator('.plot').getAttribute('data-scale'), 'mel')
  await show('spec')
  await show('spec')
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

// ⌘ pressed partway through a range dragged on the spectrogram makes it a box from where the drag began, at once, before
// the pointer moves again: its band from the press's height to the pointer's, heard alone as it goes
test('repl: ⌘ pressed while a range is dragged on the spectrogram makes it a box', async () => {
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
test('repl: Alt and a drag on the spectrogram adds another box; Delete takes every box out at once', async () => {
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
  await page.locator('.plot').focus()
  await page.keyboard.press('Delete')
  await page.waitForFunction(() => (scriptText().match(/\.spectral\(\[\d+, \d+\], \{ at: [\d.]+, d: [\d.]+ \}\)/g) || []).length === 2)
  const calls = [...(await code()).matchAll(/\.spectral\(\[(\d+), (\d+)\], \{ at: ([\d.]+), d: ([\d.]+) \}\)/g)].map(m => m.slice(1).map(Number))
  assert.ok(Math.abs(calls[0][2] - 1) < .02 && Math.abs(calls[1][2] - 4) < .02 && calls.every(([lo, hi]) => lo < hi), JSON.stringify(calls))
  assert.equal(await page.locator('.message.problem').count(), 0)
})

// A band plays through two Butterworth biquads per edge. Its first highpass was once connected to itself: a feedback
// loop with no delay, whose output ran to 1e35.
test('repl: a band plays through stable filters: what reaches the speakers stays within full scale', async () => {
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

// While the engine loads, the mark turns gently at its own size, solid ink from its first frame: it does not fade in, shrink
// or pale, and comes back from loading as the logo, not as a shape growing to size
test('repl: the bar\'s mark is plain while the engine loads: whole from its first frame, no smaller, no paler', async () => {
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

test('repl: a band quieter or louder is one spectral() call, changed in place while the band and range stay', async () => {
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
test('repl: a script that opens with gain() loads, its gain line drawn', async () => {
  await page.addInitScript(() => localStorage.setItem('audio-repl', JSON.stringify({ side: 'code', code: `audio('chime.wav').gain(-6).gain({ t: [0, 1], v: [0, -6] })` })))
  await open()
  assert.match(await code(), /\.gain\(-6\)/)
})

// On a narrow screen a panel is a sheet over the output, the whole width, as tall as it can be with a strip of the
// picture kept over it; its buttons stay in reach
test('repl: a shared link restores the script; on a narrow screen the panel is a sheet over the output, the whole width', async () => {
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
  for (const name of ['Settings', 'Code', 'Export']) assert.ok(await page.getByRole('tab', { name, exact: true }).isVisible(), name)
  assert.ok(await page.getByRole('button', { name: 'Undo', exact: true }).isVisible())
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
// Their cues are the pauses' edges, each burst's start and end, as a text's words are found.
// A bell rings on with no pause, so nothing parts a strike from its ring: a double-click on its tail takes it from its
// strike to the next. The page's chime rings from its fourth strike (1.81 s once trimmed) into its fifth (3.31 s).
test('repl: a double-click on a ringing tail selects from its strike to the next', async () => {
  await open()
  const { box, x } = await axis(6.525), seconds = t => t.split(':').reduce((m, s) => m * 60 + +s, 0)
  let range = []
  for (const until = Date.now() + 8000; Date.now() < until && !(range[1] < 6); await page.waitForTimeout(200)) {
    await page.mouse.dblclick(x(2.8), box.y + box.height * .3)
    range = (await selected()).split('–').map(seconds)
  }
  assert.ok(Math.abs(range[0] - 1.81) < .02 && Math.abs(range[1] - 3.31) < .02, range.join('–'))
})

test('repl: a double-click selects the fragment between its cues, or the pause it is in; a triple-click the sound between its pauses; ⌥ and ⌘ arrows step by them', async () => {
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
  for (const until = Date.now() + 8000; !found(at) && Date.now() < until; await page.waitForTimeout(200)) at = (await handles()).map(h => h / (box.width - GUTTER) * 2.5)
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
  // the long pause deleted: the cues after it move back with the audio at once, never where they were a moment before
  await page.mouse.dblclick(x(1.2), y)
  const [p, q] = await range()
  await page.keyboard.press('Delete')
  const moved = (await handles()).map(h => h / (box.width - GUTTER) * 2.5), after = at.filter(t => t > q + .01)
  assert.ok(!moved.some(t => after.some(e => Math.abs(t - e) < .01)), `none left behind: ${JSON.stringify(moved)}`)
  assert.ok(after.every(e => moved.some(t => Math.abs(t - (e - (q - p))) < .01)), JSON.stringify([moved, after, p, q]))
})

// A tone struck every half second over a held one, never quiet: its cues are its strikes, its one sound all of it. A
// double-click takes one strike to the next; a triple-click, the sound between its pauses, all of it.
const struck = `audio.from(t => Math.sin(2 * Math.PI * 440 * t) * (.2 + .8 * Math.exp(-(t % 0.5) * 20)), { duration: 2 })`
test('repl: on strikes with no pause between them, a double-click takes one strike to the next, a triple-click the whole sound', async () => {
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
// on it turning it to the next; a stretch just made changes with it. Its pill sets its level, or its pitch, a click
// turning it to the other. Each is one step.
test('repl: a selection\'s grip trims, stretches or speeds it, and its pill sets its level or pitch, a click on each turning it', async () => {
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
  await turn(await pill(1, 2), 'pill', 'pitch')
  await drag(await pill(1, 2), [0, -box.height / 10])
  await last(/\.pitch\(/)
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
test('repl: markers: M at the caret, its flag over the picture dragged, named, taken away, the parts between them exported', async () => {
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
  // the flags come with the output that has them
  await drag(await grab([[x(a), row]], 'pointer'), [x(3) - x(2), 0])
  await page.waitForFunction(a => +(scriptText().match(/\.mark\(([\d.]+)\)/)?.[1]) > a + .9, a)
  await page.locator('.readout', { hasText: 'LUFS' }).waitFor()
  const downloads = []
  page.on('download', d => downloads.push(d.suggestedFilename()))
  await menu('File', 'Export the parts between markers')
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

// A selection's top corners, each drawn as the fade it makes, fade it: inward, in from its start or out to its end;
// outward, past its edge, the audio out there goes, crossfading into the selection (fn/crossfade.js). A click on one
// turns the curve to the next: the fade just made takes it, and so do the next.
test('repl: a selection fades from its top corners: inward from its edge, outward a crossfade, on the curve turned to', async () => {
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
test('repl: Denoise learns the noise where it is selected and takes it out everywhere', async () => {
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

// A selection's handles each do one thing: the square past its end, a square's height off each lane's foot (lanes 2 px apart
// over the plot less its 22 px time row, view.js), stretches it, however the pointer wanders up or down; the pill on its
// top edge, dragged first up, sets its level, however it wanders across after.
// A stretch dragged to anywhere, not a round factor: the output it makes ends the stretched range where the drag let go,
// to the sample, so nothing after it moves when it comes (the library's length, round(n × factor), fn/stretch.js)
test('repl: a stretch dragged anywhere ends where it was let go, to the sample', async () => {
  const { box, x, y } = await chime(), lh = (box.height - 22 - LANES) / 2
  await settings('Times in', 'samples')
  await page.mouse.click(x(7.5), y)
  await drag([x(1), y], [x(1.7) - x(1), 0])
  assert.equal(await selected(), '44100–74970')
  const grip = await grab([[x(1.7) + 8, box.y + lh - 24]], /^url\(|ew-resize/)
  await drag(grip, [x(2.07) - x(1.7) + 3, 0])
  await page.waitForFunction(() => /\.stretch\(/.test(scriptText()))
  const [a, to] = (await selected()).split('–').map(Number)
  await page.waitForFunction(() => !document.querySelector('.source').title.endsWith(' · 0:08.000'))
  // all of it selected, in samples: 0 to its length
  await page.locator('.plot').focus()
  await page.keyboard.press('ControlOrMeta+A')
  const total = +(await selected()).split('–')[1]
  assert.equal(total - 8 * 44100, to - a - 30870, await code())
})

test('repl: a selection\'s grip only stretches it, its pill dragged up only sets its level', async () => {
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
  await select()
  await drag(await grab([[(x(2.2) + x(4.2)) / 2, box.y + 4]], 'ns-resize'), [60, -80])
  await page.waitForFunction(() => /\.gain\(\{ t: \[2\.2, 2\.205, 4\.195, 4\.2\], v: \[0, [\d.]+, [\d.]+, 0\] \}\)$/.test(scriptText()))
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
test('repl: the crossfade tool on a selection crossfades across it', async () => {
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
  await settings('Levels in', '±1')
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('audio-repl')).levels), 'linear')
})

// What goes over full scale: the time row underlined red where the output clips (stat('clipping')), and zoomed out, the
// levels past ±1 tinted red
test('repl: where the output clips is underlined red on the time row; zoomed out, past full scale is red', async () => {
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
test('repl: the pointer hides while the caret sounds, and comes back', async () => {
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
test('repl: nothing is drawn behind the meters', async () => {
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
})

// Crop is clicked, never dragged, so it is no handle: the context menu has it, and K
test('repl: the context menu, or K, keeps only the selection', async () => {
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

// With nothing selected, the square past the caret, where a selection's stretch square is, pulls silence open there:
// insert() of the length it is dragged, what follows moving on
test('repl: the square past the caret opens silence there', async () => {
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
test('repl: at the end, the square before the caret opens silence past the picture\'s edge, as far as it is pulled', async () => {
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
test('repl: a selection\'s fade squares sit on whole pixels, flush with its start\'s line and its end', async () => {
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
test('repl: no handles while it plays', async () => {
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
test('repl: the caret moves within a selection from the time row or the arrows; Play goes on from it; a click drops it', async () => {
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

test('repl: a press inside the selection drops it at once, not when let go', async () => {
  const { x, y } = await chime()
  await drag([x(1), y], [x(3) - x(1), 0])
  await page.mouse.move(x(2), y)
  await page.mouse.down()
  assert.equal(await selected(), '')
  assert.equal(await page.locator('.time').innerText(), '0:02.000')
  await page.mouse.up()
})

test('repl: Shift and a click extends from where the selection was begun, or from the caret', async () => {
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

test('repl: Shift and a drag inside the selection moves its far end from where it was begun, whichever way', async () => {
  const { x, y } = await chime()
  await drag([x(1), y], [x(3) - x(1), 0])
  await keyed(['Shift'], () => drag([x(2.5), y], [x(1.5) - x(2.5), 0]))
  assert.equal(await selected(), '0:01.000–0:01.500')
})

// Shift sums, as Shift and a press in a text: the selection goes out to the press at once, from where it was begun, a
// drag going on with it, never another range; held, the pointer an I-beam with a chevron the way it goes
const pointed = () => page.locator('.plot').evaluate(el => decodeURIComponent(el.style.cursor))
test('repl: Shift and a press elsewhere extends the selection at once, a drag going on with it; the pointer says which way', async () => {
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
test('repl: held Alt, the pointer adds, and measures how far it is from the selection', async () => {
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
test('repl: held ⌘, a range\'s end stretches it, as its grip does', async () => {
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

test('repl: Alt and a click makes a caret, the one Shift then extends: ranges made in order', async () => {
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

test('repl: Alt and Shift always make another, never extending', async () => {
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
test('repl: dragged inside the selection, Alt puts a copy of its audio in where it lands, ⌘ slides it over what is there', async () => {
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

test('repl: what there is stays as one of it is dragged, a caret by its line, a range by its edge; an edge onto the other leaves a caret', async () => {
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

test('repl: ⌘ aims, a drag going a quarter as far; a right-click on what a press would take moves nothing', async () => {
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
test('repl: Alt and a double-click adds a word; Shift and a double-click extends to one', async () => {
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
  await page.mouse.dblclick(x(.2), y)
  await page.keyboard.down('Shift'); await page.mouse.dblclick(x(.7), y); await page.keyboard.up('Shift')
  assert.match(await selected(), /^0:00\.000–0:00\.9\d*$/)
})

// A right-click, as in a text: inside the selection, the edits for it, a method among them written for it; elsewhere the
// caret goes there first, the selection gone, and the menu has what a caret takes
test('repl: a right-click gives the edits for the selection, or puts the caret there and gives the caret\'s', async () => {
  await open()
  await noCues()
  await write(`audio('chime.wav')`)
  await lengthIs('0:08.000')
  const { box, x } = await axis(8), y = box.y + box.height * .3
  const item = name => page.locator('.menubar-menu .menu-row', { has: page.locator('.menu-label', { hasText: new RegExp(`^${name}$`) }) })
  await drag([x(1), y], [x(3) - x(1), 0])
  await page.mouse.click(x(2), y, { button: 'right' })
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
test('repl: Delete crossfades the seam it leaves, as long as the settings say', async () => {
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
test('repl: a click on a fade corner turns it to the next curve, no menu, the selection kept', async () => {
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
test('repl: ⌘C copies the selection, ⌘X cuts it, ⌘V pastes at the caret', async () => {
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
  // what the fade takes out, from its card open: the start and end it softens, far under the output
  await card('Fade').locator('.step-name').click()
  await card('Fade').getByRole('button', { name: 'Δ What it takes out' }).click()
  await page.locator('.viewing', { hasText: 'What .fade() takes out' }).waitFor()
  await page.waitForFunction(() => { const m = document.querySelector('.readout').textContent.match(/^peak −([\d.]+)dBFS/); return m && +m[1] > 6 })
  await card('Fade').getByRole('button', { name: 'Δ What it takes out' }).click()
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
  assert.equal(await selected(), '0:02.000–0:03.000')
})

// A generated sound's first call makes it: the source has nothing to turn off, take away or remove; chosen, it is the
// sound alone. A step that changes time, rate or channels has nothing to take away (Δ): it doesn't line up.
test('repl: a generated sound\'s source has no switches and shows the sound alone; a step that reshapes has no Δ', async () => {
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
  await page.locator('.viewing', { hasText: 'Up to .from()' }).waitFor()
  await lengthIs('0:01.000')
  await page.locator('.viewing').click()
  await page.locator('.viewing').waitFor({ state: 'detached' })
  await lengthIs('0:00.500')
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
test('repl: an output rendering in place of the one shown keeps the zoom, the selection and the caret', async () => {
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
  await page.locator('.message', { hasText: /^Loading/ }).waitFor()
  await page.locator('.plot').focus()
  for (let i = 0; i < 2; i++) await page.keyboard.press('=')
  await page.waitForFunction(() => !document.querySelector('.message').textContent && document.querySelector('.source').title.endsWith('0:02.000'), null, { timeout: 30000 })
  await page.waitForTimeout(300)
  assert.ok(await left() > .2, 'still zoomed in')
})

// An edit made on the picture is drawn at once, and its output takes the picture's place without a move: zoomed in near
// the end, a delete that shortens the sound leaves the view where it was, not scrolled back; showing all of it, a
// delete keeps the scale, the room at the end where the sound went. Only a new file shows all of itself.
test('repl: an edit on the picture keeps the view where it is, at its scale, as its output comes', async () => {
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
test('repl: a file opened is kept for the next visit; one gone asks to be opened again', async () => {
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
  await page.waitForFunction(() => /\.fade\(1, \{ at: 2 \}\)$/.test(scriptText()))
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
  await page.waitForFunction(() => /\.write\(audio\('take\.wav'\), \{ at: 7\.5 \}\)$/.test(scriptText()))
  await page.waitForFunction(() => +document.querySelector('.source').title.split(' · ').pop().split(':')[1] > 8.2)
  await page.keyboard.press('ControlOrMeta+Z')
  await lengthIs('0:08.000')
  // into a selection: it stops at its end by itself, the length kept
  await page.mouse.click(x(6), y)
  await drag([x(2), y], [x(2.5) - x(2), 0])
  await page.getByRole('button', { name: 'Record', exact: true }).click()
  await page.getByRole('button', { name: 'Record', exact: true }).waitFor({ timeout: 15000 })
  await page.waitForFunction(() => /\.write\(audio\('take(-2)?\.wav'\), \{ at: 2 \}\)$/.test(scriptText()))
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
test('repl: recording with the spectrogram shown draws the take as a spectrogram', async () => {
  await open()
  await noCues()
  await write(`audio('chime.wav')`)
  await lengthIs('0:08.000')
  await show('spec')
  const { box, x } = await axis(8)
  await page.mouse.click(x(1), box.y + box.height - 8)
  await page.getByRole('button', { name: 'Record', exact: true }).click()
  await page.getByRole('button', { name: 'Stop recording', exact: true }).waitFor()
  await page.waitForFunction(() => /^0:0(3\.[5-9]|4)/.test(document.querySelector('.time').textContent), null, { timeout: 15000 })
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


// The context menu's row by its words, a submenu's too
const contextRow = name => page.locator('.menubar-menu .menu-row', { has: page.locator('.menu-label', { hasText: new RegExp(`^${name}$`) }) }).last()

// A fade corner dragged outward is a crossfade: remove() with a crossfade as long splices it, centred on the seam
// (fn/remove.js), the audio before the cut fading out over the half before the seam and on past it, the audio after it
// fading in from the half before. Drawn as it will sound: the two equal-power curves crossing over the seam, from half
// its length before it to half after, not over the audio that goes
test('repl: a crossfade dragged out of a range\'s end draws both sides\' fades over each other, centred on the seam', async () => {
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

// The pill set to pitch: dragged up, whole semitones, the note it goes to said by it (a 220 Hz tone is A3, A4 being
// 440 Hz, ISO 16), the range heard as it will sound while it moves (the library's pitch()), one pitch() step let go
test('repl: the pitch pill goes by semitones, says the note it goes to and is heard as it goes', async () => {
  await page.addInitScript(tap)
  await open()
  await noCues()
  await write(`audio.from(t => 0.5 * Math.sin(2 * Math.PI * 220 * t), { duration: 2 })`)
  await lengthIs('0:02.000')
  const { box, x } = await axis(2)
  await drag([x(.5), box.y + 80], [x(1.5) - x(.5), 0])
  // a click on the pill turns it to pitch; its contour then comes, its note said when it is pointed at
  const pill = [x(1), box.y + 4]
  await page.mouse.click(...pill)
  await page.mouse.move(pill[0] + 30, pill[1] + 40)
  // (A3 within a few cents: YIN's lag at about 11 kHz, interpolated, worker.js)
  const said = () => page.locator('.hint').innerText()
  for (const until = Date.now() + 8000; Date.now() < until; await page.waitForTimeout(200)) { await page.mouse.move(...pill); if (/^Pitch A3/.test(await said())) break; await page.mouse.move(pill[0] + 30, pill[1] + 40) }
  assert.match(await said(), /^Pitch A3([+−][1-5]ct)?, by semitones$/)
  // a lane's height is the voice's range, 60 Hz to 1 kHz on octaves (view.js VOICE): two semitones up is that share of it
  const lh = box.height - 22, up = 2 / (12 * Math.log2(1000 / 60)) * lh + 2
  await heard()
  await page.mouse.down()
  await page.mouse.move(pill[0], pill[1] - up, { steps: 6 })
  await page.waitForTimeout(500)
  assert.match(await said(), /^\+2st, A3([+−][1-5]ct)? → B3([+−][1-5]ct)?$/)
  const { peak } = await heard()
  assert.ok(peak > .05, `heard as it goes: ${peak}`)
  // with ⌘ (Ctrl), cents: 4 px more, a quarter as far, some hundredths of a semitone
  await page.keyboard.down('ControlOrMeta')
  await page.mouse.move(pill[0], pill[1] - up - 4, { steps: 2 })
  assert.match(await said(), /^\+2st [1-9]\d?ct, /)
  await page.mouse.up()
  await page.keyboard.up('ControlOrMeta')
  await page.waitForFunction(() => /\.pitch\(2\.\d\d?, \{ at: 0\.5, d: 1 \}\)$/.test(scriptText()))
})

// The spectrogram's tab again: its frequencies on the next scale, octaves, mel, hertz, said by it a moment
test('repl: the spectrogram\'s tab again turns its frequency scale, said by it', async () => {
  await open()
  await show('spec')
  const spec = page.getByRole('tab', { name: 'Spectrogram', exact: true })
  assert.match(await spec.getAttribute('title'), /in octaves\. Again: in mel\. Right-click: how it draws$/)
  await spec.click()
  assert.equal(await page.locator('.hint').innerText(), 'Mel')
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('audio-repl') || '{}').scale === 'mel')
  await spec.click()
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('audio-repl') || '{}').scale === 'lin')
})

// The settings hold what holds everywhere, each with what it is for; how a held caret sounds is one of the lab's eight
// ways (scrub-methods.js), kept
test('repl: the settings say what each is for; the scrub is one of the lab\'s eight, kept', async () => {
  await open()
  await tab('Settings')
  const notes = await page.locator('.settings .panel-group span').allInnerTexts()
  assert.ok(notes.length >= 7 && notes.every(Boolean), JSON.stringify(notes))
  const ways = page.locator('.settings').getByRole('group', { name: 'Scrub' }).getByRole('button')
  assert.deepEqual(await ways.allInnerTexts(), ['Vocoder + noise', 'Vocoder', 'Random phase', 'Noisc bank', 'Noisc lines', 'Grains', 'Loop', 'Tape'])
  await ways.filter({ hasText: /^Tape$/ }).click()
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('audio-repl') || '{}').scrub === 'tape')
  for (const group of ['Frequency scale', 'Cues at', 'Spectrogram colours']) assert.equal(await page.locator('.settings').getByRole('group', { name: group }).count(), 0, `${group}: not a setting`)
})

// A number selected in the code: ↑ and ↓ step it by its last decimal's step, ten with Shift, still selected; what it
// sets said by it (normalize's target, in dB, its slider from −36 to 0 dB, ops.js)
test('repl: a number selected in the code steps with the arrows, saying what it sets', async () => {
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
test('repl: the waveform\'s look, from a right-click on it: coloured by its spectrum\'s warmth, its channels in one lane', async () => {
  await open()
  await write(`audio.from(t => 0.8 * Math.sin(2 * Math.PI * 100 * t), { duration: 1, channels: 2 }).pan(-1)`)
  await lengthIs('0:01.000')
  await page.waitForTimeout(500)
  // lit pixels in the upper and lower half of the lanes, and how red they are
  const lit = () => pixels(`const out = [0, 0], tint = [0, 0]; for (let y = 0; y < h - 44; y++) for (let x = 0; x < w - 60; x++) { const i = (y * w + x) * 4; if (d[i] + d[i + 1] + d[i + 2] > 300) { const k = y < (h - 44) / 2 ? 0 : 1; out[k]++; tint[k] += d[i] - d[i + 2] } } return [...out, (tint[0] + tint[1]) / (out[0] + out[1] || 1)]`)
  const [upper, lower, grey] = await lit()
  assert.ok(lower < upper / 10 && Math.abs(grey) < 10, `split, grey: ${[upper, lower, grey]}`)
  const { box } = await axis(1)
  const look = async (...path) => {
    await page.mouse.click(box.x + 200, box.y + 60, { button: 'right' })
    for (const name of path) await contextRow(name).click()
  }
  await look('Waveform', 'Channels', 'One lane')
  await look('Waveform', 'Colour', 'Temperature')
  await page.waitForTimeout(500)
  const [top, bottom, red] = await lit()
  assert.ok(bottom > top / 2 && red > 40, `one lane, red: ${[top, bottom, red]}`)
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('audio-repl') || '{}').wave?.colour === 'temperature')
})

// The edits' cards are as wide as the panel: a long call's settings, folded, are cut short with an ellipsis, never
// widening the card past the panel
test('repl: a long step is cut short in its card, the card no wider than the panel', async () => {
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
test('repl: the export writes the depth chosen, and the markers as cue points or none', async () => {
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
test('repl: the tape scrub, chosen in the settings, plays the sound as the caret is dragged, silent held still', async () => {
  await page.addInitScript(tap)
  await open()
  await tab('Settings')
  await page.locator('.settings').getByRole('group', { name: 'Scrub' }).getByRole('button', { name: 'Tape', exact: true }).click()
  await tab('Settings')
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
test('repl: a press held still, then dragged, takes the caret along without selecting', async () => {
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
test('repl: a tab shown again shows its sound at once', async () => {
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
test('repl: a fade corner dragged back to where it began makes nothing', async () => {
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

// Recipes: a goal's whole chain, a group each, folded till opened; found by its words (its group opening), put on the
// sound open
test('repl: a recipe found by its words goes on the sound open; its groups fold', async () => {
  await open()
  await tab('Recipes')
  const master = page.locator('.recipe-group', { has: page.locator('summary', { hasText: /^Master/ }) })
  assert.equal(await master.locator('.scenario').first().isVisible(), false, 'folded')
  await master.locator('summary').click()
  assert.ok((await master.locator('.scenario strong').allInnerTexts()).includes('Mastering chain, dither last'), 'opened: the mastering recipes')
  await page.getByRole('searchbox', { name: 'Find a recipe' }).fill('restore vinyl')
  assert.deepEqual(await page.locator('.scenario strong').allInnerTexts(), ['Restore vinyl'])
  await page.locator('.scenario', { hasText: 'Restore vinyl' }).click()
  await page.waitForFunction(() => /^audio\('chime\.wav'\)\.declick\(\)\.decrackle\(\)\.midside/.test(scriptText().replace(/\s+/g, '')))
})

// The agent, through the local bridge (bin/bridge.js): the page connects with the bridge's address and key (the
// settings), answers an agent's tool calls as the MCP server sends them (an edit written into the script, one step; the
// state of the sound), and the chat streams the agent's words and the tools it used. The agent here is a stand-in on
// PATH printing what `claude -p --output-format stream-json --verbose --include-partial-messages` prints
test('repl: through the local bridge, an agent edits the sound open, and the chat shows its words', async () => {
  const { spawn } = await import('node:child_process'), { mkdtempSync, writeFileSync, chmodSync } = await import('node:fs'), { join } = await import('node:path')
  const dir = mkdtempSync(join(tmpdir(), 'audio-agent-')), S = 'b1d0c0de-0000-4000-8000-000000000001', KEY = 'repl-test-key'
  const ev = event => ({ type: 'stream_event', event, session_id: S, parent_tool_use_id: null })
  writeFileSync(join(dir, 'claude'), `#!${process.execPath}
require('fs').readFileSync(0, 'utf8')
for (const l of ${JSON.stringify([
    { type: 'system', subtype: 'init', session_id: S },
    ev({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }),
    ev({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'It is ' } }),
    ev({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: '6.5 s long.' } }),
    ev({ type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: 'toolu_1', name: 'mcp__audio__repl_state', input: {} } }),
    { type: 'assistant', message: { content: [{ type: 'tool_use', id: 'toolu_1', name: 'mcp__audio__repl_state', input: {} }] }, parent_tool_use_id: null, session_id: S },
    { type: 'result', subtype: 'success', is_error: false, result: 'It is 6.5 s long.', session_id: S }
  ])}) process.stdout.write(JSON.stringify(l) + '\\n')
`)
  chmodSync(join(dir, 'claude'), 0o755)
  const proc = spawn(process.execPath, [fileURLToPath(new URL('../bin/cli.js', import.meta.url)), '--bridge', '--port', '0', '--key', KEY], { env: { ...process.env, AUDIO_BRIDGE_KEY: '', PATH: dir }, stdio: ['ignore', 'pipe', 'inherit'] })
  try {
    const url = await new Promise(resolve => proc.stdout.on('data', d => { const m = String(d).match(/http:\/\/127\.0\.0\.1:\d+/); if (m) resolve(m[0]) }))
    // the bridge is the one other address the page may reach
    await page.route(url + '/**', route => route.continue())
    await open()
    await tab('Settings')
    await page.getByRole('textbox', { name: 'The bridge\'s address' }).fill(url)
    await page.getByLabel('The bridge\'s key').fill(KEY)
    await page.getByRole('button', { name: 'Connect' }).click()
    await page.locator('.quiet-button', { hasText: 'Connected' }).waitFor()
    // the agent's tools, as its MCP server calls them
    const call = (tool, args = {}) => fetch(`${url}/call?key=${KEY}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ tool, args }) }).then(r => r.json())
    const edited = await call('repl_edit', { call: 'gain(-6)' })
    assert.equal(edited.result.ok, true, JSON.stringify(edited))
    await page.waitForFunction(() => /\.gain\(-6\)$/.test(scriptText().trim()))
    const { result: now } = await call('repl_state')
    assert.ok(now.script.trim().endsWith('.gain(-6)') && now.duration > 6 && Number.isFinite(now.stats.loudness), JSON.stringify(now))
    await call('repl_undo')
    await page.waitForFunction(() => !scriptText().includes('gain('))
    // the chat: its words as they come, the tools it used
    await tab('Agent')
    await page.getByRole('textbox', { name: 'A message to the agent' }).fill('How long is it?')
    await page.keyboard.press('Enter')
    await page.locator('.chat-message.agent', { hasText: 'It is 6.5 s long.' }).waitFor()
    assert.equal(await page.locator('.chat-message.agent .chat-tools').innerText(), 'repl_state')
    assert.equal(await page.locator('.chat-message.user').innerText(), 'How long is it?')
  } finally { proc.kill() }
})

// The cuts as an edit list for a video editor (the library's cuts()): a deletion splits the chime into two events of
// its own clip, at the rate chosen, CMX 3600
test('repl: the export writes the cuts as an edit list, the clip named, at the rate chosen', async () => {
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
// an octave): a press on its 0 makes a point, dragged up whole semitones; one pitch() curve, set again in place; a
// double-click on a point takes it away, the last one the call
test('repl: the pitch line, in the pitch context, edits a pitch() curve as the gain line edits gain()', async () => {
  await open()
  await noCues()
  await write(`audio.from(t => 0.5 * Math.sin(2 * Math.PI * 220 * t), { d: 2 })`)
  await lengthIs('0:02.000')
  await menu('View', 'Edit pitch')
  const { box, x } = await axis(2), lh = box.height - 22, mid = box.y + lh / 2, st = lh / 2 / 12
  await drag(await grab([[x(1), mid]], 'ns-resize'), [0, -3 * st])
  await page.waitForFunction(() => /\.pitch\(\{ t: \[1\], v: \[3\] \}\)$/.test(scriptText().trim()))
  await drag(await grab([[x(1), mid - 3 * st]], 'move'), [0, -2 * st])
  await page.waitForFunction(() => /\.pitch\(\{ t: \[1\], v: \[5\] \}\)$/.test(scriptText().trim()))
  assert.equal((await code()).match(/\.pitch\(/g).length, 1)
  await page.mouse.dblclick(...await grab([[x(1), mid - 5 * st]], 'move'))
  await page.waitForFunction(() => !scriptText().includes('pitch('))
})
