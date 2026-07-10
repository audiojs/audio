// Color/character atoms — saturate family, amp, cabinet, defeedback — through the
// real engine. Saturators: harmonic generation with bounded peaks. defeedback: a
// sustained howl-like tone gets progressively notched.

import test, { ok } from 'tst'
import { tone as genTone } from './gen.js'
import audio from '../audio.js'

import { tape } from '@audio/saturate-tape/audio'
import { transistor } from '@audio/saturate-transistor/audio'
import { waveshaper } from '@audio/saturate-waveshaper/audio'
import { multisat } from '@audio/saturate-multiband/audio'
import { amp } from '@audio/amp-tube/audio'
import { cabinet } from '@audio/amp-cabinet/audio'
import { defeedback } from '@audio/defeedback/audio'

audio.use(tape, transistor, waveshaper, multisat, amp, cabinet, defeedback)

const SR = 44100

const tone = (freq, dur, amp = 0.7, sr = SR) => genTone(freq, dur, amp, sr)
function g(buf, f, sr = SR, from = Math.round(0.1 * SR), to = buf.length - Math.round(0.05 * SR)) {
	let w = 2 * Math.PI * f / sr, coeff = 2 * Math.cos(w), s1 = 0, s2 = 0
	for (let i = from; i < to; i++) { let s = buf[i] + coeff * s1 - s2; s2 = s1; s1 = s }
	return Math.sqrt(Math.max(0, s1 * s1 + s2 * s2 - coeff * s1 * s2))
}

async function saturates(name, opts = {}) {
	let dry = tone(440, 0.6)
	let out = (await audio.from([dry.slice()], { sampleRate: SR })[name]({ drive: 5, ...opts }).read())[0]
	ok(g(out, 1320) > g(dry, 1320) * 5 + 1, `${name}: 3rd harmonic generated`)
	let peak = 0
	for (let v of out) peak = Math.max(peak, Math.abs(v))
	// band-split saturators sum per-band ceilings — bounded means no blowup, not ≤1
	ok(peak < 2, `${name}: peaks bounded (${peak.toFixed(2)})`)
	ok(out.every(isFinite), `${name}: finite`)
}

test('tape: saturation adds harmonics, bounded', () => saturates('tape'))
test('transistor: soft-clip adds harmonics, bounded', () => saturates('transistor'))
test('waveshaper: tanh curve adds harmonics, bounded', () => saturates('waveshaper'))
// band-split + per-band drive sums can exceed a single band's ceiling — moderate drive
test('multisat: per-band drive adds harmonics, bounded', () => saturates('multisat', { drive: 3 }))

test('amp: tone stack shapes the saturated output (treble cut acts)', async () => {
	let n = SR, ch = new Float32Array(n)
	for (let i = 0; i < n; i++) ch[i] = 0.4 * (Math.sin(2 * Math.PI * 200 * i / SR) + Math.sin(2 * Math.PI * 5000 * i / SR))
	let flat = (await audio.from([ch.slice()], { sampleRate: SR }).amp({ gain: 0.4 }).read())[0]
	let dark = (await audio.from([ch.slice()], { sampleRate: SR }).amp({ gain: 0.4, treble: -12 }).read())[0]
	ok(g(dark, 5000) < g(flat, 5000) * 0.6, 'treble knob cuts highs')
	ok(flat.every(isFinite) && dark.every(isFinite))
})

test('cabinet: speaker sim rolls off highs, keeps mids', async () => {
	let n = SR, ch = new Float32Array(n)
	for (let i = 0; i < n; i++) ch[i] = 0.4 * (Math.sin(2 * Math.PI * 800 * i / SR) + Math.sin(2 * Math.PI * 8000 * i / SR))
	let out = (await audio.from([ch.slice()], { sampleRate: SR }).cabinet().read())[0]
	let hiDrop = g(out, 8000) / g(ch, 8000)
	let midKeep = g(out, 800) / g(ch, 800)
	ok(hiDrop < 0.25, `8kHz rolled off (${(20 * Math.log10(hiDrop)).toFixed(1)} dB)`)
	ok(midKeep > 0.5, `800Hz survives (${(20 * Math.log10(midKeep)).toFixed(1)} dB)`)
})

test('defeedback: sustained howl gets notched over time', async () => {
	let dry = tone(2000, 3, 0.5)
	let out = (await audio.from([dry.slice()], { sampleRate: SR }).defeedback({ strength: 1 }).read())[0]
	let early = g(out, 2000, SR, Math.round(0.05 * SR), Math.round(0.4 * SR))
	let late = g(out, 2000, SR, Math.round(2.2 * SR), Math.round(2.9 * SR))
	// same-length windows; repeated deploys deepen the cut progressively (−9 dB steps)
	ok(late < early * 0.65, `notch deepens on the sustained tone (late/early ${(late / early).toFixed(2)})`)
	ok(out.every(isFinite))
})
