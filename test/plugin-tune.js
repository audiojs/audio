// Tune atom exercised through the real engine (audio.use + .read()).
// Whole-render (streaming: false): YIN F0 track → note segments → scale snap →
// PSOLA retune. See @audio/tune-snap/audio.js.

import test, { ok, is } from 'tst'
import { tone as genTone } from './gen.js'
import audio from '../audio.js'

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

test('op introspection carries tune param metadata', () => {
	let d = audio.op('tune')
	is(d.plugin.streaming, false)
	ok(d.plugin.params.scale.values.includes('major'))
	is(d.plugin.params.tolerance.unit, 'cents')
	is(d.plugin.params.root.max, 11)
})
