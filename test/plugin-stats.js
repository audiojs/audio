// Stat atoms ({ stat, compute }) through the real engine — audio.use registers them
// as a.stat(name); the host reads (ranged) PCM and calls compute once. Covers the
// three stat families: loudness (channel-direct), spectral (frame-averaged), mir
// (mono-fold; similarity/coversong take a `ref` instance, pre-rendered by the host).

import test, { ok, is, almost } from 'tst'
import { tone as genTone } from './gen.js'
import audio from '../audio.js'

import { truepeak } from '@audio/loudness-truepeak/audio'
import { lra } from '@audio/loudness-lra/audio'
import { replaygain } from '@audio/loudness-replaygain/audio'
import { dr } from '@audio/loudness-dr/audio'
import { rolloff } from '@audio/spectral-rolloff/audio'
import { spread } from '@audio/spectral-spread/audio'
import { slope } from '@audio/spectral-slope/audio'
import { flux } from '@audio/spectral-flux/audio'
import { contrast } from '@audio/spectral-contrast/audio'
import { ltas } from '@audio/spectral-ltas/audio'
import { structure } from '@audio/mir-structure/audio'
import { melody } from '@audio/mir-melody/audio'
import { fingerprint } from '@audio/mir-fingerprint/audio'
import { similarity } from '@audio/mir-similarity/audio'

audio.use(truepeak, lra, replaygain, dr, rolloff, spread, slope, flux, contrast, ltas,
	structure, melody, fingerprint, similarity)

const SR = 44100

const tone = (freq, dur, amp = 0.5, sr = SR) => genTone(freq, dur, amp, sr)

test('truepeak: sine at −6 dBFS reads ≈ −6 dBTP', async () => {
	let a = audio.from([tone(997, 1, 0.5)], { sampleRate: SR })
	let tp = await a.stat('truepeak')
	almost(tp, -6, 0.3, `−6 dBFS sine → ${tp.toFixed(2)} dBTP`)
})

test('lra: steady tone has near-zero loudness range, level step widens it', async () => {
	let steady = await audio.from([tone(440, 6, 0.4)], { sampleRate: SR }).stat('lra')
	let loud = tone(440, 4, 0.6), quiet = tone(440, 4, 0.05)
	let stepped = await audio.from([new Float32Array([...loud, ...quiet])], { sampleRate: SR }).stat('lra')
	ok(stepped > steady + 3, `level step widens LRA (${steady.toFixed(1)} → ${stepped.toFixed(1)} LU)`)
})

test('replaygain + dr: sane values on program material', async () => {
	let a = audio.from([tone(440, 4, 0.3)], { sampleRate: SR })
	let rg = await a.stat('replaygain')  // { gain, lufs } per RG2
	let drv = await a.stat('dr')
	ok(Number.isFinite(rg.gain) && rg.gain > -20 && rg.gain < 20, `replaygain ${rg.gain.toFixed(1)} dB`)
	ok(Number.isFinite(rg.lufs), `program loudness ${rg.lufs.toFixed(1)} LUFS`)
	ok(Number.isFinite(drv?.dr ?? drv) , `DR ${JSON.stringify(drv).slice(0, 40)}`)
})

test('rolloff/spread/slope: dark vs bright material orders correctly', async () => {
	let dark = audio.from([tone(200, 1)], { sampleRate: SR })
	let bright = audio.from([tone(6000, 1)], { sampleRate: SR })
	ok(await bright.stat('rolloff') > await dark.stat('rolloff') * 3, 'rolloff tracks brightness')
	let sDark = await dark.stat('slope'), sBright = await bright.stat('slope')
	ok(Number.isFinite(sDark) && Number.isFinite(sBright), 'slope finite')
	let sp = await dark.stat('spread')
	ok(Number.isFinite(sp) && sp >= 0, `spread ${sp.toFixed(0)} Hz`)
})

test('flux: steady tone ≈ 0, alternating tones > 0', async () => {
	let steady = await audio.from([tone(440, 1)], { sampleRate: SR }).stat('flux')
	let alt = new Float32Array(SR)
	for (let i = 0; i < SR; i++) {
		let f = (i / SR * 8 | 0) % 2 ? 440 : 3000
		alt[i] = 0.5 * Math.sin(2 * Math.PI * f * i / SR)
	}
	let moving = await audio.from([alt], { sampleRate: SR }).stat('flux')
	ok(moving > steady * 3 + 1e-6, `flux tracks spectral motion (${steady.toExponential(1)} → ${moving.toExponential(1)})`)
})

test('contrast + ltas: arrays with content', async () => {
	let a = audio.from([tone(440, 1, 0.5)], { sampleRate: SR })
	let c = await a.stat('contrast')
	ok(c.length > 3 && c.every(isFinite), `contrast bands: ${c.length}`)
	let l = await a.stat('ltas')
	ok(l.length > 100, `ltas bins: ${l.length}`)
})

test('structure: section change produces a boundary', async () => {
	// 3s of 220 tone then 3s of bright noise-ish content — one clear boundary
	let n = 6 * SR, ch = new Float32Array(n)
	for (let i = 0; i < 3 * SR; i++) ch[i] = 0.5 * Math.sin(2 * Math.PI * 220 * i / SR)
	let x = 1
	for (let i = 3 * SR; i < n; i++) { x = (x * 16807) % 2147483647; ch[i] = 0.4 * (x / 2147483647 * 2 - 1) }
	let res = await audio.from([ch], { sampleRate: SR }).stat('structure')
	ok(Array.isArray(res.boundaries), 'returns { boundaries }')
	ok(res.boundaries.some(t => Math.abs(t - 3) < 1.2), `boundary near the 3s section change (${res.boundaries.map(t => t.toFixed(1)).join(',')})`)
})

test('melody: contour follows the tone', async () => {
	let m = await audio.from([tone(330, 1, 0.5)], { sampleRate: SR }).stat('melody')  // { times, freqs }
	let f0 = [...(m.freqs || m.f0 || [])].filter(v => v > 0)
	ok(f0.length > 4, `voiced frames: ${f0.length}`)
	let med = f0.sort((a, b) => a - b)[f0.length >> 1]
	almost(med, 330, 8, `median F0 ${med?.toFixed(1)} Hz`)
})

test('fingerprint + similarity: self-match beats cross-match', async () => {
	let a = audio.from([tone(440, 2, 0.5)], { sampleRate: SR })
	let fp = await a.stat('fingerprint')
	ok(fp && (fp.length > 0 || Object.keys(fp).length > 0), 'fingerprint produced')

	let b = audio.from([tone(440, 2, 0.5)], { sampleRate: SR })
	let c = audio.from([tone(1234, 2, 0.5)], { sampleRate: SR })
	let self = await a.stat('similarity', { ref: b })   // { score, timbre, harmony }
	let cross = await a.stat('similarity', { ref: c })
	ok(self.score > cross.score, `self-match ${self.score.toFixed(3)} > cross ${cross.score.toFixed(3)}`)
})

test('ranged stat: {at, duration} scopes the analysis', async () => {
	// first second quiet 200Hz, second second bright 6kHz
	let n = 2 * SR, ch = new Float32Array(n)
	for (let i = 0; i < SR; i++) ch[i] = 0.5 * Math.sin(2 * Math.PI * 200 * i / SR)
	for (let i = SR; i < n; i++) ch[i] = 0.5 * Math.sin(2 * Math.PI * 6000 * i / SR)
	let a = audio.from([ch], { sampleRate: SR })
	let r1 = await a.stat('rolloff', { at: 0, duration: 1 })
	let r2 = await a.stat('rolloff', { at: 1, duration: 1 })
	ok(r2 > r1 * 3, `range scoping works (${r1.toFixed(0)} vs ${r2.toFixed(0)} Hz)`)
})

test('chroma: chord tones dominate the mean chromagram', async () => {
	await audio.use('chroma')
	let n = SR * 2, d = new Float32Array(n)
	for (let m of [60, 64, 67]) { let f = 440 * 2 ** ((m - 69) / 12); for (let i = 0; i < n; i++) d[i] += 0.2 * Math.sin(2 * Math.PI * f * i / SR) }
	let a = audio.from([d], { sampleRate: SR })
	let res = await a.stat('chroma')
	is(res.mean.length, 12)
	ok(res.frames.length > 5, `${res.frames.length} frames`)
	let top3 = [...res.mean].map((v, i) => [i, v]).sort((x, y) => y[1] - x[1]).slice(0, 3).map(x => x[0]).sort((x, y) => x - y)
	is(top3.join(','), '0,4,7', 'C major tones dominate')
})

test('tonnetz: 6-D trajectory, distinct keys separate', async () => {
	await audio.use('tonnetz')
	let mk = notes => {
		let n = SR, d = new Float32Array(n)
		for (let m of notes) { let f = 440 * 2 ** ((m - 69) / 12); for (let i = 0; i < n; i++) d[i] += 0.2 * Math.sin(2 * Math.PI * f * i / SR) }
		return audio.from([d], { sampleRate: SR })
	}
	let c = await mk([60, 64, 67]).stat('tonnetz')
	let fs = await mk([66, 70, 73]).stat('tonnetz')
	is(c.mean.length, 6)
	let dist = 0
	for (let k = 0; k < 6; k++) dist += (c.mean[k] - fs.mean[k]) ** 2
	ok(Math.sqrt(dist) > 0.3, `tritone-apart keys separate (${Math.sqrt(dist).toFixed(2)})`)
})
