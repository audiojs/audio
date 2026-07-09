// EQ-family atoms (graphic, tilt, baxandall, dynamic) through the real engine.

import test, { ok } from 'tst'
import audio from '../audio.js'

import { geq } from '@audio/eq-graphic/atom'
import { tilt } from '@audio/eq-tilt/atom'
import { baxandall } from '@audio/eq-baxandall/atom'
import { dyneq } from '@audio/eq-dynamic/atom'

audio.use(geq, tilt, baxandall, dyneq)

const SR = 44100

function twoTone(f1, f2, dur, amp = 0.4, sr = SR) {
	let n = Math.round(dur * sr), d = new Float32Array(n)
	for (let i = 0; i < n; i++) d[i] = amp * (Math.sin(2 * Math.PI * f1 * i / sr) + Math.sin(2 * Math.PI * f2 * i / sr))
	return d
}
function g(buf, f, sr = SR, from = Math.round(0.2 * SR), to = buf.length - Math.round(0.1 * SR)) {
	let w = 2 * Math.PI * f / sr, coeff = 2 * Math.cos(w), s1 = 0, s2 = 0
	for (let i = from; i < to; i++) { let s = buf[i] + coeff * s1 - s2; s2 = s1; s1 = s }
	return Math.sqrt(Math.max(0, s1 * s1 + s2 * s2 - coeff * s1 * s2))
}

test('geq: +12dB on the 1k band boosts 1kHz, leaves 100Hz flat', async () => {
	let dry = twoTone(100, 1000, 0.6)
	let out = (await audio.from([dry.slice()], { sampleRate: SR }).geq({ g1k: 12 }).read())[0]
	let boost = 20 * Math.log10(g(out, 1000) / g(dry, 1000))
	let flat = 20 * Math.log10(g(out, 100) / g(dry, 100))
	ok(boost > 9, `1kHz boosted (${boost.toFixed(1)} dB)`)
	ok(Math.abs(flat) < 2, `100Hz flat (${flat.toFixed(1)} dB)`)
})

test('tilt: positive gain lifts bass, cuts treble around the pivot', async () => {
	let dry = twoTone(150, 5000, 0.5)
	let out = (await audio.from([dry.slice()], { sampleRate: SR }).tilt({ gain: 6 }).read())[0]
	ok(g(out, 150) > g(dry, 150) * 1.3, 'bass up')
	ok(g(out, 5000) < g(dry, 5000) * 0.8, 'treble down')
})

test('baxandall: bass and treble shelves act independently', async () => {
	let dry = twoTone(100, 8000, 0.5)
	let out = (await audio.from([dry.slice()], { sampleRate: SR }).baxandall({ bass: 9, treble: -9 }).read())[0]
	ok(g(out, 100) > g(dry, 100) * 1.6, 'bass boosted')
	ok(g(out, 8000) < g(dry, 8000) * 0.5, 'treble cut')
})

test('dyneq: hot band cut when over threshold, quiet program preserved', async () => {
	let n = 2 * SR, ch = new Float32Array(n)
	for (let i = 0; i < n; i++) ch[i] = 0.7 * Math.sin(2 * Math.PI * 6000 * i / SR) + 0.05 * Math.sin(2 * Math.PI * 300 * i / SR)
	let out = (await audio.from([ch.slice()], { sampleRate: SR }).dyneq({ fc: 6000, threshold: -30, ratio: 8 }).read())[0]
	let from = SR >> 1, to = Math.round(1.8 * SR)
	ok(g(out, 6000, SR, from, to) < g(ch, 6000, SR, from, to) * 0.7, 'hot 6kHz band reduced')
	let keep = g(out, 300, SR, from, to) / g(ch, 300, SR, from, to)
	ok(keep > 0.8 && keep < 1.2, `program at 300Hz preserved (${keep.toFixed(2)}×)`)
	ok(out.every(isFinite))
})
