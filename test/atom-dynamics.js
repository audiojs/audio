// Dynamics color-compressor atoms (fet/opto/varimu/vca) + multiband, through the
// real engine. Defining property per atom: hot material comes out reduced; for
// multiband, only the band over threshold is touched.

import test, { ok, is } from 'tst'
import audio from '../audio.js'

import { fet } from '@audio/dynamics-fet/atom'
import { opto } from '@audio/dynamics-opto/atom'
import { varimu } from '@audio/dynamics-varimu/atom'
import { vca } from '@audio/dynamics-vca/atom'
import { multiband } from '@audio/dynamics-multiband/atom'

audio.use(fet, opto, varimu, vca, multiband)

const SR = 44100

function tone(freq, dur, amp = 0.8, sr = SR) {
	let n = Math.round(dur * sr), d = new Float32Array(n)
	for (let i = 0; i < n; i++) d[i] = amp * Math.sin(2 * Math.PI * freq * i / sr)
	return d
}
function rms(d, from = 0, to = d.length) { let s = 0; for (let i = from; i < to; i++) s += d[i] * d[i]; return Math.sqrt(s / (to - from)) }
/** Goertzel magnitude at f Hz. */
function goertzel(buf, f, sr = SR, from = 0, to = buf.length) {
	let w = 2 * Math.PI * f / sr, coeff = 2 * Math.cos(w), s1 = 0, s2 = 0
	for (let i = from; i < to; i++) { let s = buf[i] + coeff * s1 - s2; s2 = s1; s1 = s }
	return Math.sqrt(Math.max(0, s1 * s1 + s2 * s2 - coeff * s1 * s2))
}

async function reduces(name, opts) {
	let dry = tone(440, 1)
	let out = (await audio.from([dry.slice()], { sampleRate: SR })[name](opts).read())[0]
	let settle = Math.round(0.5 * SR)
	let drop = 20 * Math.log10(rms(out, settle, dry.length) / rms(dry, settle))
	ok(drop < -2, `${name}: hot tone reduced (${drop.toFixed(1)} dB)`)
	ok(out.every(isFinite), `${name}: finite`)
}

test('fet (1176): fast peak compression engages', () => reduces('fet', { threshold: -20, ratio: 8 }))
test('opto (LA-2A): RMS compression engages', () => reduces('opto', { threshold: -24 }))
test('varimu (Fairchild): feedback compression engages', () => reduces('varimu', { threshold: -26 }))
test('vca (dbx/SSL): clean compression engages', () => reduces('vca', { threshold: -20, ratio: 6 }))

test('multiband: hot low band compressed, quiet high band untouched', async () => {
	let n = 2 * SR, ch = new Float32Array(n)
	for (let i = 0; i < n; i++) ch[i] = 0.8 * Math.sin(2 * Math.PI * 80 * i / SR) + 0.02 * Math.sin(2 * Math.PI * 6000 * i / SR)
	let out = (await audio.from([ch.slice()], { sampleRate: SR }).multiband({ threshold: -18, ratio: 6 }).read())[0]
	let from = SR, to = Math.round(1.8 * SR)
	let lowDrop = goertzel(out, 80, SR, from, to) / goertzel(ch, 80, SR, from, to)
	let highKeep = goertzel(out, 6000, SR, from, to) / goertzel(ch, 6000, SR, from, to)
	ok(lowDrop < 0.8, `hot 80Hz band reduced (${(20 * Math.log10(lowDrop)).toFixed(1)} dB)`)
	ok(highKeep > 0.7 && highKeep < 1.4, `quiet 6kHz band ~untouched (${(20 * Math.log10(highKeep)).toFixed(1)} dB)`)
	ok(out.every(isFinite))
})
