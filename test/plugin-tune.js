// Tune atom exercised through the real engine (audio.use + .read()).
// Whole-render (streaming: false): pYIN pitch → the notes meant on the scale → each centred on its note, its motion
// slower than `speed` flattened → one curve through @audio/tune-curve. See @audio/tune-snap/audio.js.

import test, { ok, is } from 'tst'
import { tone as genTone } from './gen.js'
import audio from '../audio.js'
import { contour } from '../fn/pitch-detect.js'

import { tune } from '@audio/tune-snap/audio'

audio.use(tune)

const SR = 44100

const tone = (freq, dur, amp = 0.6, sr = SR) => genTone(freq, dur, amp, sr)
/** Goertzel magnitude at f Hz. */
function goertzel(buf, f, sr = SR, from = 0, to = buf.length) {
	let w = 2 * Math.PI * f / sr, coeff = 2 * Math.cos(w), s1 = 0, s2 = 0
	for (let i = from; i < to; i++) { let s = buf[i] + coeff * s1 - s2; s2 = s1; s1 = s }
	return Math.sqrt(Math.max(0, s1 * s1 + s2 * s2 - coeff * s1 * s2))
}
const MID = [Math.round(0.25 * SR), Math.round(0.75 * SR)]

test('tune: 30¢-sharp tone snaps to the chromatic degree (A4 440)', async () => {
	let sharp = 440 * 2 ** (30 / 1200)  // ≈447.7 Hz
	let dry = tone(sharp, 1)
	let out = (await audio.from([dry.slice()], { sampleRate: SR }).tune().read())[0]
	is(out.length, dry.length, 'length preserved (whole-render)')
	ok(goertzel(out, 440, SR, ...MID) > goertzel(out, sharp, SR, ...MID) * 2,
		`snapped toward 440 (440: ${goertzel(out, 440, SR, ...MID).toFixed(0)} vs ${sharp.toFixed(1)}: ${goertzel(out, sharp, SR, ...MID).toFixed(0)})`)
	ok(out.every(isFinite))
})

test('tune: in-tune material inside tolerance passes through untouched', async () => {
	let dry = tone(440, 0.8)
	let out = (await audio.from([dry.slice()], { sampleRate: SR }).tune({ tolerance: 15 }).read())[0]
	let d = 0
	for (let i = 0; i < dry.length; i++) d = Math.max(d, Math.abs(out[i] - dry[i]))
	ok(d === 0, `dry copy untouched below tolerance (${d})`)
})

test('tune: scale snap targets the scale degree, stereo corrects both channels', async () => {
	// 452 Hz → A4 440 in A major (root 9) — the @audio/note reference case
	let dry = tone(452, 1)
	let [l, r] = await audio.from([dry.slice(), dry.slice()], { sampleRate: SR })
		.tune({ scale: 'major', root: 9, tolerance: 5 }).read()
	for (let ch of [l, r])
		ok(goertzel(ch, 440, SR, ...MID) > goertzel(ch, 452, SR, ...MID) * 2, 'snapped to A4 in A major')
})

// A4 30 cents sharp wobbling ±40 cents four times a second: speed 0 sets every moment on A4, 400 moves the centre alone
test('tune: speed 0 flattens a wobble, 400 keeps it', async () => {
	let n = SR, d = new Float32Array(n), ph = 0
	for (let i = 0; i < n; i++) { ph += 440 * 2 ** ((30 + 40 * Math.sin(2 * Math.PI * 4 * i / SR)) / 1200) / SR; d[i] = .6 * Math.sin(2 * Math.PI * ph) }
	let spread = x => {
		let { f0 } = contour(x.subarray(MID[0], MID[1]), SR, { hop: .005 }), c = [...f0].filter(f => f > 0).map(f => 1200 * Math.log2(f / 440))
		let m = c.reduce((s, v) => s + v, 0) / c.length
		return [m, Math.sqrt(c.reduce((s, v) => s + (v - m) ** 2, 0) / c.length)]
	}
	let [m0, s0] = spread(d)
	let [m1, s1] = spread((await audio.from([d.slice()], { sampleRate: SR }).tune({ speed: 0 }).read())[0])
	let [m2, s2] = spread((await audio.from([d.slice()], { sampleRate: SR }).tune({ speed: 400 }).read())[0])
	ok(s1 < 5 && Math.abs(m1) < 3, `speed 0: ${s0.toFixed(1)} → ${s1.toFixed(1)} cents rms about ${m1.toFixed(1)}`)
	ok(s2 > .9 * s0 && Math.abs(m2) < 5, `speed 400: ${s2.toFixed(1)} cents rms kept about ${m2.toFixed(1)} (sung ${m0.toFixed(1)})`)
})

test('op introspection carries tune param metadata', () => {
	let d = audio.op('tune')
	is(d.plugin.streaming, false)
	ok(d.plugin.params.scale.values.includes('major'))
	is(d.plugin.params.tolerance.unit, 'cents')
	is(d.plugin.params.root.max, 11)
	is(d.plugin.params.speed.unit, 'ms')
})
