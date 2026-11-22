// A step's settings as they write its call (repl/settings.js argChange): each where its op reads it, by its place or in
// its options, so what a slider sets is what renders; and a step whose call throws, or that fails as the chain renders,
// skipped, the chain after it made and the step said (repl/editor/run.js without). The engine in a page against the
// library in Node; the server, the page and the helpers in page.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import audio from '../../audio.js'
import { ops, format, toSlider, fromSlider } from '../../repl/ops.js'
import { chain } from '../../repl/code.js'
import { argChange } from '../../repl/settings.js'
import { vowel } from '../gen.js'
import { page, RATE, sine, engine, open, write, settled, code, readout, lengthText, drawn } from './page.js'

// code with a change made (setArg's: one, or several)
const applied = (s, change) => [change].flat().sort((p, q) => q.from - p.from).reduce((c, x) => c.slice(0, x.from) + (x.insert ?? '') + c.slice(x.to ?? x.from), s)
// the script with step `name`'s setting set to `value` as its slider sets it
const set = (s, name, setting, value) => {
  const spec = ops[name].params
  return applied(s, argChange(chain(s).calls.find(k => k.name === name), spec, spec.findIndex(p => p.name === setting), value))
}
const snr = (ref, x) => { let e = 0, d = 0; for (let i = 0; i < ref.length; i++) { e += ref[i] ** 2; d += (x[i] - ref[i]) ** 2 } return 10 * Math.log10(e / d) }

// The settings write a setting at its place unless it is marked `option` (settings.js argChange); the library reads at
// a place only its op's params (plan.js opMethod, core.js positional) and refuses a call with more. Deepfilter's music
// and floor, dereverb's music and method, scene's model, deconstruct's separation, vocos' crossover and derustle's
// ambience were written at places their ops have none: `deepfilter(18, 'pass', 40)`, refused as it was called
test('settings: every setting written at a place is at a place its op reads', () => {
  const wrong = []
  for (const [name, op] of Object.entries(ops)) {
    const d = audio.op(name)
    if (!Array.isArray(op.params) || op.range || !d) continue
    const places = d.params || [], rest = places.at(-1)?.startsWith('...')
    op.params.forEach((s, i) => { if (!s.option && !s.selection && !(i === 0 && s.name === 'source') && i >= places.length && !rest) wrong.push(`${name}.${s.name} at ${i} (${name}(${places.join(', ')}))`) })
  }
  assert.deepEqual(wrong, [])
})

// Infinity is a value: read from the code (a range silenced, `gain(-Infinity, …)`, was read as no value, and its
// setting showed gain's default, 0 dB), shown as ∞, standing at its end of a slider; Deepfilter's limit has it as its
// slider's last place, past 40 dB, written as the library takes it (no limit)
test('settings: Infinity is read from the code, shown as ∞, at its end of a slider; Deepfilter\'s limit ends on it', () => {
  const value = (s, name, i = 0) => chain(s).calls.find(k => k.name === name).args[i].value
  assert.equal(value(`audio('in.wav').gain(-Infinity, { at: 0, d: 1 })`, 'gain'), -Infinity)
  assert.equal(value(`audio('in.wav').deepfilter(Infinity)`, 'deepfilter'), Infinity)
  assert.equal(value(`audio('in.wav').gain(+Infinity)`, 'gain'), Infinity)
  for (const not of ['Infinity2', 'infinity', '-Infinity * 2', 'x.Infinity']) assert.equal(value(`audio('in.wav').gain(${not})`, 'gain'), undefined, `${not} is no value`)
  const gain = ops.gain.params[0], limit = ops.deepfilter.params[0]
  assert.equal(format(-Infinity, gain), '−∞dB')
  assert.equal(format(Infinity, limit), '∞dB')
  assert.deepEqual([toSlider(gain, -Infinity), toSlider(limit, Infinity), toSlider({ ...gain, log: true, min: 20, max: 20000 }, -Infinity)], [0, 1000, 0])
  assert.deepEqual([fromSlider(limit, 0), fromSlider(limit, 999), fromSlider(limit, 1000), fromSlider(gain, 1000)], [0, 40, Infinity, gain.max], 'the last place alone, and only where a setting has one')
  const none = set(`audio('in.wav').deepfilter()`, 'deepfilter', 'limit', fromSlider(limit, 1000))
  assert.equal(none, `audio('in.wav').deepfilter(Infinity)`)
  assert.doesNotThrow(() => audio.from([new Float32Array(8)], { sampleRate: RATE }).deepfilter(Infinity), 'the library takes it at the call')
})

// A voice in bursts with silence between, under white noise 10 dB down: where the floor reaches (the library's own
// mixback test: noise loud against the voice ends `floor` dB under it, quiet noise drops by the limit). The bursts
// 1.6 s apart, 1.2 s of pause between two: since @audio/neural-denoise 0.8 the floor acts in the voice's pauses alone,
// 0.3 s or more from it (with 0.4 s between bursts no moment was one, and the floor moved nothing)
function voiced() {
  let seed = 3
  const noise = () => (seed = (seed * 16807) % 2147483647) / 2147483647 - .5, burst = vowel(t => 140 + 20 * Math.sin(2 * Math.PI * 3 * t), .4, 1, RATE)
  const x = new Float32Array(Math.round(4 * RATE))
  for (let b = 0; b < 3; b++) x.set(burst.map(v => .3 * v), Math.round((.2 + b * 1.6) * RATE))
  const level = Math.sqrt(burst.reduce((s, v) => s + (.3 * v) ** 2, 0) / burst.length)
  return x.map(v => v + level * 10 ** (-10 / 20) * Math.sqrt(12) * noise())
}
// the power of the gaps between the bursts, dB
const gaps = x => { let s = 0, n = 0; for (const [a, b] of [[1.05, 1.35], [2.65, 2.95]]) for (let i = Math.round(a * RATE); i < Math.round(b * RATE); i++) { s += x[i] ** 2; n++ } return 10 * Math.log10(s / n) }

// Deepfilter's floor set from 0 to 60 as its slider sets it: rendered in the page as by the library in Node with that
// floor (the model served from the cache Node keeps it in, as engine.test.js serves it), and the gaps' noise lower at 60
test('settings: Deepfilter\'s floor, set by its slider, renders as the library renders it, and lowers the noise', async t => {
  const { MODEL } = await import('@audio/neural-denoise')
  const model = await readFile(join(process.env.AUDIO_NEURAL_CACHE || join(homedir(), '.cache', 'audiojs', 'neural'), createHash('sha256').update(MODEL).digest('hex'))).catch(() => null)
  if (!model) return t.skip('no DeepFilterNet3 model cached: run audio deepfilter once on Node')
  await page.route(MODEL, route => route.fulfill({ body: model, headers: { 'access-control-allow-origin': '*' } }))
  const x = voiced(), floors = [0, 60], scripts = floors.map(f => set(`audio('in.wav').deepfilter()`, 'deepfilter', 'floor', f))
  assert.deepEqual(scripts, [`audio('in.wav').deepfilter({ floor: 0 })`, `audio('in.wav').deepfilter({ floor: 60 })`])
  const got = await engine(scripts, { 'in.wav': [x] })
  const outs = []
  for (const [i, floor] of floors.entries()) {
    assert.equal(got[i].error, undefined, `floor ${floor}: ${got[i].error?.message}`)
    const expected = (await audio.from([x], { sampleRate: RATE }).deepfilter({ floor }).read())[0], y = got[i].output.channels[0]
    assert.ok(snr(expected, y) > 40, `floor ${floor}: ${snr(expected, y).toFixed(1)} dB from Node's`)
    outs.push(y)
  }
  assert.ok(gaps(outs[1]) < gaps(outs[0]) - 10, `the gaps' noise at floor 60 ${gaps(outs[1]).toFixed(1)} dB, at 0 ${gaps(outs[0]).toFixed(1)} dB`)
})

// Deconstruct's separation (DSP, no model), set by its slider: rendered as the library renders it, and read: 4 is not 2
test('settings: deconstruct\'s separation, set by its slider, renders as the library renders it', async () => {
  const x = voiced(), from = `audio('in.wav').deconstruct(0, -24, 0)`, scripts = [from, set(from, 'deconstruct', 'separation', 4)]
  assert.equal(scripts[1], `audio('in.wav').deconstruct(0, -24, 0, { separation: 4 })`)
  const got = await engine(scripts, { 'in.wav': [x] })
  for (const [i, separation] of [2, 4].entries()) {
    assert.equal(got[i].error, undefined, `separation ${separation}: ${got[i].error?.message}`)
    const expected = (await audio.from([x], { sampleRate: RATE }).deconstruct(0, -24, 0, { separation }).read())[0], y = got[i].output.channels[0]
    assert.ok(snr(expected, y) > 40, `separation ${separation}: ${snr(expected, y).toFixed(1)} dB from Node's`)
  }
  assert.ok(snr(got[0].output.channels[0], got[1].output.channels[0]) < 40, 'separation 4 renders otherwise than 2')
})

// A step whose call throws (gain takes one value, given three): skipped, the step after it (the fade) made on the sound,
// the output that of the chain without it; said in the status bar and at its line; the script left as it was written
test('editor: a step that throws is skipped and said, the chain after it made', async () => {
  await open()
  await write(`audio('chime.wav')\n  .fade(0.5, 0.5)`)
  await settled()
  const without = await readout()
  const failing = `audio('chime.wav')\n  .gain(1, 2, 3)\n  .fade(0.5, 0.5)`
  await write(failing)
  await settled()
  assert.equal(await code(), failing)
  assert.equal(await readout(), without, 'the output is the chain without the step')
  assert.match(await page.locator('.message').textContent(), /^gain: expected at most 1 argument \(value\), got 3 \(line 2\): Gain skipped, the rest of the chain made without it$/)
  assert.deepEqual(await page.locator('.cm-lintRange-error').allTextContents(), ['  .gain(1, 2, 3)'])
})

// Steps that fail as the chain renders, long after their calls ran, as a library op's can (deepfilter's model not
// loading, a plugin's module not loading, a block that throws): ops the script registers, each passing its sound through
// but where it fails, at the three places the engine says which edit raised it (core.js blame: its module loading, its
// preparation, a block rendered)
const PASS = '(input, output) => input.forEach((x, c) => output[c].set(x))'
const FLAKY = `audio.op('flaky', { prepare: () => Promise.reject(new Error('the model did not load')), process: ${PASS} })\n`
const UNLOADED = `audio.op('unloaded', { load: () => Promise.reject(new Error('the module did not load')), process: ${PASS} })\n`
const BRITTLE = `audio.op('brittle', { process: () => { throw new Error('a block did not render') } })\n`
// the steps the last run skipped, by their line (run.js show)
const skipped = () => page.evaluate(async () => (await import('/repl/editor/context.js')).state.failed.map(f => f.line))

// One that fails as it prepares, in the middle of the chain: skipped, the step before it and the step after it made, the
// output that of the chain without it, heard (its levels) and drawn; said in the status bar and at its line, the step
// marked; the script as written. Two, as their module loads and as a block renders: both, said together
test('editor: a step that fails as the chain renders is skipped and said, the chain after it made', async () => {
  await open()
  await write(`audio('chime.wav')\n  .gain(-6)\n  .fade(0.5, 0.5)`)
  await settled()
  const without = await readout(), length = await lengthText()
  const failing = `${FLAKY}audio('chime.wav')\n  .gain(-6)\n  .flaky()\n  .fade(0.5, 0.5)`
  await write(failing)
  await settled()
  assert.equal(await code(), failing)
  assert.equal(await readout(), without, 'the output is the chain without the step')
  assert.equal(await lengthText(), length)
  assert.ok(await drawn() > 0, 'drawn')
  assert.match(await page.locator('.message').textContent(), /^the model did not load \(line 4\): Flaky skipped, the rest of the chain made without it$/)
  assert.deepEqual(await page.locator('.cm-lintRange-error').allTextContents(), ['  .flaky()'])
  assert.deepEqual(await skipped(), [4])
  const two = `${UNLOADED}${BRITTLE}audio('chime.wav')\n  .unloaded()\n  .gain(-6)\n  .brittle()\n  .fade(0.5, 0.5)`
  await write(two)
  await settled()
  assert.equal(await code(), two)
  assert.equal(await readout(), without, 'the output is the chain without either')
  assert.match(await page.locator('.message').textContent(), /^the module did not load \(line 4\); a block did not render \(line 6\): those steps skipped, the rest of the chain made without them$/)
  assert.deepEqual(await page.locator('.cm-lintRange-error').allTextContents(), ['  .unloaded()', '  .brittle()'])
  assert.deepEqual(await skipped(), [4, 6])
})

// Where no step of the chain can be named for a render's failure, nothing is skipped, as before: the problem said with
// the op that raised it, and the track it was on, the last output kept. A script with no chain (its edits made by
// statements of their own); a step of a track not edited, whose chain is not the one shown. A file not there is said as
// that, and one that does not open, never as a step skipped, though the engine says the step that reads it met it (a
// mix of it: core.js blame, the mix's index and name)
test('editor: a render failure no step is named for says its op, nothing skipped; a file not there is said as that', async () => {
  await open()
  await write(`audio('chime.wav')\n  .gain(-12)`)
  await settled()
  const shown = await readout()
  const say = async script => { await write(script); await settled(); assert.equal(await code(), script); return page.locator('.message').textContent() }
  assert.equal(await say(`${FLAKY}let a = audio('chime.wav')\na.gain(-6)\na.flaky()\na`), 'the model did not load (Flaky)')
  assert.equal(await readout(), shown, 'the last output kept')
  assert.deepEqual(await skipped(), [])
  assert.equal(await say(`${FLAKY}const voice = audio('chime.wav')\n  .flaky()\nconst bed = audio('chime.wav')\n  .gain(-6)`), 'the model did not load (Flaky, track voice)')
  assert.deepEqual(await skipped(), [])
  assert.equal(await say(`audio('gone.wav').gain(-6)`), 'gone.wav is not open here: open it, or drop it on the page')
  assert.deepEqual(await skipped(), [])
  await page.evaluate(async () => (await import('/repl/editor/context.js')).eng.file('bad.wav', new Blob([new Uint8Array(4000).fill(7)])))
  assert.match(await say(`audio('chime.wav')\n  .mix(audio('bad.wav'))\n  .gain(-6)`), /^Could not open bad\.wav: [^(]+$/)
  assert.deepEqual(await skipped(), [])
})

// A step over a range added after one, the output before it kept, so only its range would render again (worker.js
// fragment): one that fails there renders whole, which names it, and is skipped as any
test('editor: a step over a range that fails as the chain renders is skipped, the output kept before it made', async () => {
  await open()
  await write(`audio('chime.wav')\n  .gain(-6, { at: 1, d: 1 })`)
  await settled()
  const without = await readout()
  const failing = `${BRITTLE}audio('chime.wav')\n  .gain(-6, { at: 1, d: 1 })\n  .brittle({ at: 2, d: 1 })`
  await write(failing)
  await settled()
  assert.equal(await code(), failing)
  assert.equal(await readout(), without, 'the output is the chain without the step')
  assert.match(await page.locator('.message').textContent(), /^a block did not render \(line 4\): Brittle skipped, the rest of the chain made without it$/)
  assert.deepEqual(await skipped(), [4])
})

// A track's step that fails as the chain renders, the track edited: skipped as any, the mix made with the track without
// it (worker.js mixTracks: the step of the track's own sound the engine names)
test('editor: a track\'s step that fails as the chain renders is skipped, the tracks mixed without it', async () => {
  await open()
  const tracks = `const voice = audio('chime.wav')\n  .gain(-6)\nconst bed = audio('chime.wav')\n  .gain(-12)`
  await write(tracks)
  await settled()
  const without = await readout()
  const failing = `${FLAKY}const voice = audio('chime.wav')\n  .gain(-6)\nconst bed = audio('chime.wav')\n  .flaky()\n  .gain(-12)`
  await write(failing)
  await settled()
  assert.equal(await code(), failing)
  assert.equal(await readout(), without, 'the mix without the step')
  assert.match(await page.locator('.message').textContent(), /^the model did not load \(line 5\): Flaky skipped, the rest of the chain made without it$/)
  assert.deepEqual(await skipped(), [5])
})

// The line of the step that failed is its call's, by the engine's index, not by its name: of two steps of one op, the
// second (an op that fails for k 2 alone), whether the sound rendered holds the output's edits from its first (nothing
// kept before them) or from its second (the output after gain kept, worker.js based: the index then counted on by one)
test('engine: a step that fails as it renders is said at its own call, rendered from a step kept or not', async () => {
  const PICKY = `audio.op('picky', { params: ['k'], prepare: (a, i) => a.edits[i][1].k === 2 ? Promise.reject(new Error('k 2 did not prepare')) : undefined, process: ${PASS} })\n`
  const script = gain => `${PICKY}audio('in.wav')\n  .gain(${gain})\n  .picky(1)\n  .picky(2)\n  .fade(0.1, 0.1)`
  const [, kept, fresh] = await engine([`audio('in.wav')\n  .gain(-6)`, script(-6), script(-3)], { 'in.wav': [sine(1, 440, .5)] })
  for (const r of [kept, fresh]) assert.deepEqual([r.error?.message, r.error?.op, r.error?.line], ['k 2 did not prepare', 'picky', 5])
})
