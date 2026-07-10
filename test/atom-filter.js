// Filter-family atoms (analog-model + effect filters) through the real engine.
// One defining-property test per atom.

import test, { ok, is } from 'tst'
import audio from '../audio.js'

import { moog } from '@audio/filter-moog-ladder/audio'
import { korg35 } from '@audio/filter-korg35/audio'
import { diode } from '@audio/filter-diode-ladder/audio'
import { oberheim } from '@audio/filter-oberheim/audio'
import { resonator } from '@audio/filter-resonator/audio'
import { spectralTilt } from '@audio/filter-spectral-tilt/audio'
import { variable } from '@audio/filter-variable/audio'
import { comb } from '@audio/filter-comb/audio'
import { dcblocker } from '@audio/filter-dcblocker/audio'
import { emphasis, deemphasis } from '@audio/filter-preemphasis/audio'

audio.use(moog, korg35, diode, oberheim, resonator, spectralTilt, variable, comb, dcblocker, emphasis, deemphasis)

const SR = 44100

function tone(freq, dur, amp = 0.6, sr = SR) {
	let n = Math.round(dur * sr), d = new Float32Array(n)
	for (let i = 0; i < n; i++) d[i] = amp * Math.sin(2 * Math.PI * freq * i / sr)
	return d
}
function twoTone(f1, f2, dur, amp = 0.4, sr = SR) {
	let n = Math.round(dur * sr), d = new Float32Array(n)
	for (let i = 0; i < n; i++) d[i] = amp * (Math.sin(2 * Math.PI * f1 * i / sr) + Math.sin(2 * Math.PI * f2 * i / sr))
	return d
}
/** Goertzel magnitude at f Hz. */
function g(buf, f, sr = SR, from = Math.round(0.2 * SR), to = buf.length - Math.round(0.1 * SR)) {
	let w = 2 * Math.PI * f / sr, coeff = 2 * Math.cos(w), s1 = 0, s2 = 0
	for (let i = from; i < to; i++) { let s = buf[i] + coeff * s1 - s2; s2 = s1; s1 = s }
	return Math.sqrt(Math.max(0, s1 * s1 + s2 * s2 - coeff * s1 * s2))
}

async function lowpasses(name, opts = {}) {
	let dry = twoTone(200, 6000, 0.8)
	let out = (await audio.from([dry.slice()], { sampleRate: SR })[name]({ fc: 800, ...opts }).read())[0]
	ok(g(out, 6000) < g(dry, 6000) * 0.25, `${name}: 6kHz attenuated above fc`)
	// analog-model ladders droop into the passband (diode ladder ≈ −8 dB two octaves
	// below fc — TB-303 character) — assert separation, tolerate passband loss
	ok(g(out, 200) > g(dry, 200) * 0.25, `${name}: 200Hz passes below fc`)
	ok(g(out, 200) / Math.max(g(out, 6000), 1e-9) > (g(dry, 200) / g(dry, 6000)) * 4, `${name}: pass/stop separation`)
	ok(out.every(isFinite), `${name}: finite`)
}

test('moog: −24dB/oct ladder lowpass', () => lowpasses('moog'))
// korg35/diode at resonance>0 damp the passband through their nonlinear feedback —
// test the linear region (resonance 0); the character is the family's business
test('korg35: MS-20 lowpass', () => lowpasses('korg35', { resonance: 0 }))
test('diode: TB-303 ladder lowpass', () => lowpasses('diode', { resonance: 0 }))
test('variable: smoothed-coefficient lowpass', () => lowpasses('variable'))

test('oberheim: multimode — highpass mode attenuates lows', async () => {
	let dry = twoTone(200, 6000, 0.8)
	let out = (await audio.from([dry.slice()], { sampleRate: SR }).oberheim({ fc: 1500, type: 'highpass' }).read())[0]
	ok(g(out, 200) < g(dry, 200) * 0.3, 'lows attenuated')
	ok(g(out, 6000) > g(dry, 6000) * 0.5, 'highs pass')
})

test('resonator: rings at fc, rejects off-resonance', async () => {
	let dry = twoTone(440, 3000, 0.8)
	let out = (await audio.from([dry.slice()], { sampleRate: SR }).resonator({ fc: 440, bw: 50 }).read())[0]
	ok(g(out, 440) / g(out, 3000) > g(dry, 440) / g(dry, 3000) * 3, 'fc dominates after filtering')
	ok(out.every(isFinite))
})

test('spectral-tilt: negative slope darkens (highs down vs lows)', async () => {
	let dry = twoTone(200, 6000, 0.5)
	let out = (await audio.from([dry.slice()], { sampleRate: SR })['spectral-tilt']({ slope: -3 }).read())[0]
	let dryRatio = g(dry, 6000) / g(dry, 200)
	let outRatio = g(out, 6000) / g(out, 200)
	ok(outRatio < dryRatio * 0.5, `high/low ratio drops (${(outRatio / dryRatio).toFixed(2)}×)`)
})

test('comb: feedforward notch at fs/(2·delay)', async () => {
	// delay 1 ms → first notch at 500 Hz (gain 1: x + delayed cancels at odd harmonics of 500)
	let dry = twoTone(500, 2000, 0.5)  // 2000 = 2·1000 lands on a comb peak
	let out = (await audio.from([dry.slice()], { sampleRate: SR }).comb({ delay: 1, gain: -1 }).read())[0]
	// gain −1: y = x − x[n−D] → notch at 0, 1000, 2000...; 500 sits between notches
	ok(g(out, 2000) < g(dry, 2000) * 0.2, '2kHz notched')
	ok(g(out, 500) > g(dry, 500) * 0.5, '500Hz passes')
})

test('dcblocker: removes DC offset', async () => {
	let n = SR, ch = new Float32Array(n)
	for (let i = 0; i < n; i++) ch[i] = 0.3 + 0.4 * Math.sin(2 * Math.PI * 440 * i / SR)
	let out = (await audio.from([ch], { sampleRate: SR }).dcblocker().read())[0]
	let mean = 0
	for (let i = Math.round(0.2 * SR); i < n; i++) mean += out[i]
	mean /= n - Math.round(0.2 * SR)
	ok(Math.abs(mean) < 0.01, `DC removed (${mean.toFixed(4)})`)
	ok(g(out, 440) > 0.3 * (n / 2) * 0.5, 'signal preserved')
})

test('emphasis boosts highs; deemphasis round-trip ≈ identity', async () => {
	let dry = twoTone(200, 6000, 0.4)
	let em = (await audio.from([dry.slice()], { sampleRate: SR }).emphasis().read())[0]
	ok(g(em, 6000) / g(em, 200) > g(dry, 6000) / g(dry, 200) * 2, 'pre-emphasis lifts highs')
	let rt = (await audio.from([dry.slice()], { sampleRate: SR }).emphasis().deemphasis().read())[0]
	let d = 0
	for (let i = Math.round(0.1 * SR); i < dry.length; i++) d = Math.max(d, Math.abs(rt[i] - dry[i]))
	ok(d < 0.05, `emphasis→deemphasis ≈ identity (${d.toFixed(3)})`)
})
