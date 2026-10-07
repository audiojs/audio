// Native plugins as edits: a.plugin() over @audio/host (optional), on the test plugins its backends build
// (VST3, CLAP, LV2: node packages/host-*/test-plugin/build.js in audiojs/host) and macOS's own Audio Units.
// What the engine adds to the host: its delay compensation, its tails, notes and automation on the timeline,
// sidechains from other sounds, serialization.

import test, { ok, almost, is } from 'tst'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as host from '@audio/host'
import audio from '../audio.js'

const SR = 48000
// the test plugins sit in the host's repository (built there, not published): beside a linked @audio/host, or in the
// sibling @audio checkout
const fixture = (pkg, file) => [
  () => join(dirname(fileURLToPath(import.meta.resolve('@audio/host'))), '..', pkg, 'test-plugin', file),
  () => fileURLToPath(new URL(`../../@audio/host/packages/${pkg}/test-plugin/${file}`, import.meta.url)),
].map(f => { try { return f() } catch { return '' } }).find(p => p && existsSync(p)) ?? ''
const vst = fixture('host-vst', 'test.vst3'), clap = fixture('host-clap', 'test.clap')
const has = p => p && existsSync(p)
const sine = (n, f = 440) => Float32Array.from({ length: n }, (_, i) => 0.5 * Math.sin(2 * Math.PI * f * i / SR))
const db = x => 20 * Math.log10(Math.abs(x))
const peak = (x, from = 0) => { let m = 0; for (let i = from; i < x.length; i++) m = Math.max(m, Math.abs(x[i])); return m }

for (let [format, path] of [['vst3', vst], ['clap', clap]]) {
  let skip = !host.backends[format] || !has(path) ? { skip: `${format}: build its test plugin` } : {}

  test(`plugin ${format}: its latency taken off by the engine, its parameters in its units`, skip, async () => {
    let x = sine(SR)
    let y = await audio.from([x, x], { sampleRate: SR }).plugin(path, { plugin: 'Test Gain', gain: -6, polarity: 'Inverted' }).read()
    is(y[0].length, SR)
    let worst = 0
    for (let i = 0; i < SR; i++) worst = Math.max(worst, Math.abs(y[0][i] + x[i] * 10 ** (-6 / 20)))
    ok(worst < 1e-6, `aligned, to the sample (${worst})`)
  })

  test(`plugin ${format}: automation on the timeline, a range, serialization`, skip, async () => {
    let a = audio.from([sine(SR), sine(SR)], { sampleRate: SR }).plugin(path, { plugin: 'Test Gain', gain: { t: [0, 1], v: [-60, 0] } })
    let y = await a.read(), x = sine(SR)
    almost(db(y[0][SR / 2 + 7] / x[SR / 2 + 7]), -30, 0.5, 'halfway: -30 dB')
    let [[type, o]] = JSON.parse(JSON.stringify(a)).edits
    is(type, 'plugin')
    let z = await audio.from([sine(SR), sine(SR)], { sampleRate: SR })[type](o.ref, o).read()
    almost(z[0][SR / 2 + 7], y[0][SR / 2 + 7], 1e-6, 'the same, from its JSON')
    let r = await audio.from([sine(SR), sine(SR)], { sampleRate: SR }).plugin(path, { plugin: 'Test Gain', gain: -20, at: 0.5 }).read()
    almost(r[0][SR / 4], sine(SR)[SR / 4], 1e-6, 'before its range: as it was')
    almost(db(r[0][3 * SR / 4] / sine(SR)[3 * SR / 4]), -20, 0.01, 'in it: -20 dB')
  })

  test(`plugin ${format}: an instrument plays the timeline's notes, at its tempo`, skip, async () => {
    let s = audio.from(2, { sampleRate: SR, channels: 2 }).plugin(path, { plugin: 'Test Synth', notes: [{ time: 1, duration: 0.5, note: 'A4', velocity: 1 }] })
    let y = await s.read(), z = 0
    for (let i = SR + 1; i < 1.5 * SR; i++) if (y[0][i - 1] < 0 && y[0][i] >= 0) z++
    ok(Math.abs(z - 220) <= 1, `A4 from 1 s (${z * 2} Hz)`)
    is(peak(y[0].subarray(0, SR)), 0, 'silent before it')
    let c = await audio.from(2, { sampleRate: SR, channels: 2 }).plugin(path, { plugin: 'Test Synth', click: true, bpm: 90 }).read(), at = []
    for (let i = 0; i < c[0].length; i++) if (c[0][i] > 0.5) at.push(i)
    is(at, [0, 32000, 64000], 'beats at 90 BPM')
  })

  test(`plugin ${format}: mix, its input delayed by its latency to meet its output`, skip, async () => {
    let x = sine(SR)
    let y = await audio.from([x, x], { sampleRate: SR }).plugin(path, { plugin: 'Test Gain', gain: -6, mix: 0.25 }).read()
    let worst = 0
    for (let i = 0; i < SR; i++) worst = Math.max(worst, Math.abs(y[0][i] - x[i] * (0.75 + 0.25 * 10 ** (-6 / 20))))
    ok(worst < 1e-6, `three quarters dry, a quarter at -6 dB, in line (${worst})`)
  })

  test(`plugin ${format}: a sidechain from another sound`, skip, async () => {
    let voice = audio.from([new Float32Array(SR).fill(0.4)], { sampleRate: SR })
    let y = await audio.from([new Float32Array(SR), new Float32Array(SR)], { sampleRate: SR }).plugin(path, { plugin: 'Test Gain', sidechain: 50, key: voice }).read()
    almost(y[0][SR / 2], 0.2, 1e-6)
  })
}

test('plugin au: a tail rendered past the end', { skip: !host.backends.au && 'macOS only' }, async () => {
  let x = new Float32Array(SR / 2)
  x[0] = 1
  let a = audio.from([x, x], { sampleRate: SR }).plugin('AUMatrixReverb', {})
  let y = await a.read()
  ok(a.duration > 0.5, `longer than its input once @audio/host has loaded: ${a.duration.toFixed(1)} s`)
  ok(peak(y[0], SR / 2) > 1e-4, 'the reverb rings on after the input ends')
  let b = await audio.from([x, x], { sampleRate: SR }).plugin('AUMatrixReverb', { tail: false }).read()
  is(b[0].length, SR / 2, 'tail: false, none')
  // a mix blends the processor; the decay's pad is timeline, not sound
  let half = await audio.from([x, x], { sampleRate: SR }).plugin('AUMatrixReverb', { mix: 0.5 }).read()
  is(half[0].length, y[0].length, 'mixed: as long, the tail kept')
  almost(half[0][SR / 2 + 1000], y[0][SR / 2 + 1000] / 2, 1e-6, 'half the tail')
  almost(half[0][0], 0.5 + y[0][0] / 2, 1e-6, 'half the dry impulse with it')
})

// A Web Audio Module (WAM 2.0) by its module, hosted by the WAM SDK in an OfflineAudioContext (web-audio-api in Node,
// the page's in a browser): test/fixtures/wam, made with the SDK as plugins are (a gain through 64 samples of delay it
// reports, a sine per held note, the tempo it hears as a DC step)
const wam = fileURLToPath(new URL('./fixtures/wam/index.js', import.meta.url))
let waa = await import('web-audio-api').then(() => true, () => false)
const wamSkip = waa ? {} : { skip: 'WAMs in Node need web-audio-api' }

test('plugin wam: its compensation delay taken off, its parameters by label or key, unknown ones named', wamSkip, async () => {
  let x = sine(SR)
  let y = await audio.from([x], { sampleRate: SR }).plugin(wam, { Gain: -6 }).read()
  is(y[0].length, SR, 'as long as its input: no tail rings')
  let worst = 0
  for (let i = 0; i < SR; i++) worst = Math.max(worst, Math.abs(y[0][i] - x[i] * 10 ** (-6 / 20)))
  ok(worst < 1e-6, `aligned to the sample, -6 dB (${worst})`)
  // a delay over the second it renders with room for: rendered again with room for it
  let late = await audio.from([x], { sampleRate: SR }).plugin(wam, { state: { delay: 1.5 * SR }, gain: -6 }).read()
  almost(late[0][SR / 2 + 7], x[SR / 2 + 7] * 10 ** (-6 / 20), 1e-6, '1.5 s of delay, taken off')
  let e = await audio.from([x], { sampleRate: SR }).plugin(wam, { nope: 1 }).read().catch(e => e)
  ok(/no parameter 'nope' \(gain\)/.test(e.message), e.message)
})

test('plugin wam: automation, notes, the tempo', wamSkip, async () => {
  let x = sine(SR)
  let y = await audio.from([x], { sampleRate: SR }).plugin(wam, { gain: { t: [0, 1], v: [-60, 0] } }).read()
  almost(db(y[0][SR / 2 + 7] / x[SR / 2 + 7]), -30, 0.5, 'halfway: -30 dB')
  let s = await audio.from(1, { sampleRate: SR, channels: 1 }).plugin(wam, { notes: [{ time: 0.25, duration: 0.5, note: 'A4' }] }).read(), z = 0
  for (let i = 0.3 * SR; i < 0.7 * SR; i++) if (s[0][i - 1] < 0 && s[0][i] >= 0) z++
  ok(Math.abs(z - 176) <= 1, `A4 from 0.25 s (${z / 0.4} Hz)`)
  is(peak(s[0].subarray(0, SR / 4 - 1)), 0, 'silent before it')
  let t = await audio.from(1, { sampleRate: SR, channels: 1 }).plugin(wam, { bpm: 90 }).read()
  almost(t[0][SR / 2], 0.009, 1e-6, 'it hears 90 BPM')
})
