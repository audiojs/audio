// Shift-family atoms exercised through the real engine (audio.use + .read()).
// vocoder/formant-shift stream through a FIFO with measured latency (engine
// compensates); paulstretch and the auto-selecting pitch-shift are whole-render
// (streaming: false). See each manifest's header for the measurement method.

import test, { ok, is } from 'tst'
import { tone as genTone } from './gen.js'
import audio from '../audio.js'

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
