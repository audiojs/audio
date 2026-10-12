// Shift-family atoms exercised through the real engine (audio.use + .read()).
// vocoder/formant-shift stream through a FIFO with measured latency (engine
// compensates); paulstretch and the auto-selecting pitch-shift are whole-render
// (streaming: false). See each manifest's header for the measurement method.

import test, { ok, is } from 'tst'
import { tone as genTone } from './gen.js'
import audio from '../audio.js'
import { METHODS } from '../fn/pitch.js'

import { vocoder } from '@audio/shift-pvoc/audio'
import { formantShift } from '@audio/shift-formant/audio'
import { paulstretch } from '@audio/shift-paulstretch/audio'
import { pitchShift } from '@audio/shift/audio'

audio.use(vocoder, formantShift, paulstretch, pitchShift)

const SR = 44100

const tone = (freq, dur, amp = 0.7, sr = SR) => genTone(freq, dur, amp, sr)
function rms(d, from = 0, to = d.length) { let s = 0; for (let i = from; i < to; i++) s += d[i] * d[i]; return Math.sqrt(s / (to - from)) }
/** Goertzel magnitude at f Hz. */
function goertzel(buf, f, sr = SR, from = 0, to = buf.length) {
	let w = 2 * Math.PI * f / sr, coeff = 2 * Math.cos(w), s1 = 0, s2 = 0
	for (let i = from; i < to; i++) { let s = buf[i] + coeff * s1 - s2; s2 = s1; s1 = s }
	return Math.sqrt(Math.max(0, s1 * s1 + s2 * s2 - coeff * s1 * s2))
}
const MID = [Math.round(0.25 * SR), Math.round(0.75 * SR)]

// pitch({ method }): each of @audio/shift's methods in the vocoder's place, the edit its op's; its module the only one
// loaded. First in the file, before the tests below load every one
test('pitch({ method }) — the method\'s op does it, loaded alone', async () => {
	let a = audio.from([tone(440, 1)], { sampleRate: SR }).pitch(5, { method: 'psola' })
	is(a.edits[0][0], 'pitch-psola', 'the edit is the method\'s')
	let pcm = await a.read()
	is(pcm[0].length, SR, 'the length kept')
	ok(audio.op('pitch-psola') && !audio.op('pitch-sms') && !audio.op('pitch-hpss'), 'its module loaded, no other method\'s')
	is(audio.from([tone(440, 1)], { sampleRate: SR }).pitch(5, { method: 'phase-lock' }).edits[0][0], 'pitch', 'phase-lock: the vocoder\'s own')
})

// a 440 Hz tone 5 semitones up: 587 Hz, its spectrum's peak (Goertzel, 1 Hz steps, over the middle half), each method.
// Not the ones whose texture is the point: paulstretch smears it into a drone, granular's grains land unaligned (one
// grain size, 398, tuned for 440 Hz at 1.5: at +5 its peak is 662 Hz); nor ola, plain overlap-add joining its grains
// unaligned, where a steady tone's grains cancel (at 587 Hz 0.002 of the 0.35 wsola keeps there, the peak at 555 Hz)
test('pitch({ method }) — every method shifts a tone by its semitones, the length kept', async () => {
	let crossings = d => {
		let x = d.subarray(d.length >> 2, d.length - (d.length >> 2)), best = 0, at = 0
		for (let f = 400; f <= 800; f++) { let w = 2 * Math.PI * f / SR, k = 2 * Math.cos(w), s1 = 0, s2 = 0; for (let i = 0; i < x.length; i++) { let s0 = x[i] + k * s1 - s2; s2 = s1; s1 = s0 } let m = s1 * s1 + s2 * s2 - k * s1 * s2; if (m > best) { best = m; at = f } }
		return at
	}
	let want = 440 * 2 ** (5 / 12)
	for (let method of ['phase-lock', ...Object.keys(METHODS)]) {
		let pcm = await audio.from([tone(440, 1)], { sampleRate: SR }).pitch(5, { method }).read()
		is(pcm[0].length, SR, `${method}: length kept`)
		ok(pcm[0].every(Number.isFinite), `${method}: finite`)
		if (!['paulstretch', 'granular', 'ola'].includes(method)) ok(Math.abs(crossings(pcm[0]) - want) < 4, `${method}: ${crossings(pcm[0]).toFixed(0)} Hz, want ${want.toFixed(0)}`)
	}
})

// a range: shifted there alone, sample for sample as it was outside it, each edge crossfaded into the shift over 10 ms
// (core ranged): no step at the seams, its curvature within 3× the tone's own
test('pitch({ method }) — a range alone, its seams without a step', async () => {
	let x = tone(220, 2), own = 0.7 * (2 * Math.PI * 220 / SR) ** 2, s0 = SR / 2, s1 = SR * 1.5
	let curv = (y, at) => { let m = 0; for (let i = at - 88; i < at + 88; i++) m = Math.max(m, Math.abs(y[i + 1] - 2 * y[i] + y[i - 1])); return m }
	for (let method of ['psola', 'sms', 'transient', 'granular', 'vocoder', 'formant']) {
		let y = (await audio.from([x.slice()], { sampleRate: SR }).pitch(3, { method, at: 0.5, duration: 1 }).read())[0]
		ok(y.subarray(0, s0 - 2048).every((v, i) => Math.abs(v - x[i]) < 1e-6) && y.subarray(s1 + 4096).every((v, i) => Math.abs(v - x[s1 + 4096 + i]) < 1e-6), `${method}: either side as it was`)
		ok(curv(y, s0) < 3 * own && curv(y, s1) < 3 * own, `${method}: no step at the seams (${(curv(y, s0) / own).toFixed(1)}×, ${(curv(y, s1) / own).toFixed(1)}×)`)
	}
})

test('pitch({ method }) — fails loud: an unknown method, a curve, voice', () => {
	let a = () => audio.from([tone(440, 1)], { sampleRate: SR })
	let msg = f => { try { f(); return '' } catch (e) { return e.message } }
	ok(/unknown method 'nope'/.test(msg(() => a().pitch(2, { method: 'nope' }))), 'unknown method')
	ok(/constant number of semitones/.test(msg(() => a().pitch({ t: [0, 1], v: [0, 2] }, { method: 'psola' }))), 'a curve is phase-lock\'s')
	ok(/voice is phase-lock's/.test(msg(() => a().pitch(2, { method: 'sms', voice: true }))), 'voice is phase-lock\'s')
})

test('vocoder: +12 semitones moves a 440 tone to 880, latency compensated', async () => {
	let dry = tone(440, 1)
	let out = (await audio.from([dry.slice()], { sampleRate: SR }).vocoder({ semitones: 12 }).read())[0]
	is(out.length, dry.length, 'length preserved (latency compensated)')
	ok(goertzel(out, 880, SR, ...MID) > goertzel(out, 440, SR, ...MID) * 5,
		`shifted energy dominates (880: ${goertzel(out, 880, SR, ...MID).toFixed(0)} vs 440: ${goertzel(out, 440, SR, ...MID).toFixed(0)})`)
	ok(rms(out, 0, Math.round(0.05 * SR)) > 0.05, 'onset not delayed (latency compensated)')
	ok(out.every(isFinite))
})

test('vocoder: semitones=0 passes the tone through the STFT path intact', async () => {
	let dry = tone(440, 1)
	let out = (await audio.from([dry.slice()], { sampleRate: SR }).vocoder().read())[0]
	is(out.length, dry.length, 'length preserved')
	let g = rms(out, ...MID) / rms(dry, ...MID)
	ok(Math.abs(g - 1) < 0.15, `level preserved (${g.toFixed(3)}×)`)
	ok(goertzel(out, 440, SR, ...MID) > goertzel(out, 880, SR, ...MID) * 10, 'tone stays at 440')
})

test('vocoder: live semitones — engine automation engages mid-stream', async () => {
	let dry = tone(440, 2)
	let out = (await audio.from([dry], { sampleRate: SR }).vocoder({ semitones: t => t < 1 ? 0 : 12 }).read())[0]
	let h1 = [Math.round(0.2 * SR), Math.round(0.8 * SR)]
	let h2 = [Math.round(1.3 * SR), Math.round(1.9 * SR)]
	ok(goertzel(out, 440, SR, ...h1) > goertzel(out, 880, SR, ...h1) * 3, 'first half at 440')
	ok(goertzel(out, 880, SR, ...h2) > goertzel(out, 440, SR, ...h2) * 3, 'second half shifted to 880')
})

test('formant-shift: +12 semitones moves pitch, output stays sane', async () => {
	let dry = tone(220, 1)
	let out = (await audio.from([dry.slice()], { sampleRate: SR })['formant-shift']({ semitones: 12 }).read())[0]
	is(out.length, dry.length, 'length preserved (latency compensated)')
	ok(goertzel(out, 440, SR, ...MID) > goertzel(out, 220, SR, ...MID) * 3,
		'shifted fundamental dominates')
	ok(out.every(isFinite))
})

test('paulstretch: semitones=0 still smears (texture is the point), tone survives', async () => {
	let dry = tone(440, 1)
	let out = (await audio.from([dry.slice()], { sampleRate: SR }).paulstretch().read())[0]
	is(out.length, dry.length, 'length preserved')
	let d = 0
	for (let i = 0; i < out.length; i++) d = Math.max(d, Math.abs(out[i] - dry[i]))
	ok(d > 0.1, `not identity — randomized phase applied (${d.toFixed(2)})`)
	ok(goertzel(out, 440, SR, ...MID) > goertzel(out, 660, SR, ...MID) * 3, 'tonal magnitude stays at 440')
	ok(out.every(isFinite))
})

test('pitch-shift: auto method shifts, explicit method selectable', async () => {
	let dry = tone(440, 1)
	let out = (await audio.from([dry.slice()], { sampleRate: SR })['pitch-shift']({ semitones: 12 }).read())[0]
	is(out.length, dry.length, 'length preserved')
	ok(goertzel(out, 880, SR, ...MID) > goertzel(out, 440, SR, ...MID) * 3, 'auto method shifts 440 → 880')

	let out2 = (await audio.from([dry.slice()], { sampleRate: SR })['pitch-shift']({ semitones: -12, method: 'vocoder' }).read())[0]
	ok(goertzel(out2, 220, SR, ...MID) > goertzel(out2, 440, SR, ...MID) * 3, 'explicit vocoder shifts 440 → 220')
})

test('pitch-shift: formant flag conflicts with explicit method — fails loudly', async () => {
	let a = audio.from([tone(440, 0.3)], { sampleRate: SR })['pitch-shift']({ semitones: 5, method: 'psola', formant: true })
	let err = null
	try { await a.read() } catch (e) { err = e }
	ok(/formant/.test(err?.message), `render surfaces the kernel conflict (${err?.message})`)
})

test('op introspection carries shift param metadata', () => {
	is(audio.op('vocoder').plugin.latency, 2048)
	is(audio.op('vocoder').plugin.params.semitones.min, -24)
	ok(audio.op('pitch-shift').plugin.params.method.values.includes('psola'))
	is(audio.op('paulstretch').plugin.streaming, false)
})
