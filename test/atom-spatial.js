// Spatial-family atoms exercised through the real engine (audio.use + .read()).
// One defining-property test per atom — mirrors each manifest's own header
// (see @audio/spatial/packages/spatial-<atom>/atom.js).

import test, { ok, is, almost } from 'tst'
import audio from '../audio.js'

import { widener } from '@audio/spatial-widener/atom'
import { haas } from '@audio/spatial-haas/atom'
import { panner } from '@audio/spatial-panner/atom'
import { autopan } from '@audio/spatial-autopan/atom'
import { midside } from '@audio/spatial-midside/atom'
import { microshift } from '@audio/spatial-microshift/atom'
import { surround } from '@audio/spatial-surround/atom'

audio.use(widener, haas, panner, autopan, midside, microshift, surround)

const SR = 44100

function tone(freq, dur, amp = 0.7, sr = SR) {
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
/** [min,max] RMS across short windows — detects level movement over time. */
function envelopeSpread(d, sr = SR, winSec = 0.05) {
	let winN = Math.round(winSec * sr), min = Infinity, max = 0
	for (let i = 0; i + winN <= d.length; i += winN) {
		let r = rms(d, i, i + winN)
		if (r < min) min = r
		if (r > max) max = r
	}
	return [min, max]
}

test('widener: width=0 collapses to mono, width>1 boosts the side', async () => {
	let L = tone(440, 0.5), R = tone(880, 0.5)
	let [l0, r0] = await audio.from([L.slice(), R.slice()], { sampleRate: SR }).widener({ width: 0 }).read()
	let dMax = 0
	for (let i = 0; i < l0.length; i++) dMax = Math.max(dMax, Math.abs(l0[i] - r0[i]))
	ok(dMax < 1e-6, `width=0 mono (maxDiff ${dMax.toExponential(1)})`)

	let side = (l, r) => { let s = new Float32Array(l.length); for (let i = 0; i < l.length; i++) s[i] = (l[i] - r[i]) / 2; return s }
	let [l2, r2] = await audio.from([L.slice(), R.slice()], { sampleRate: SR }).widener({ width: 2 }).read()
	ok(rms(side(l2, r2)) > rms(side(L, R)) * 1.8, 'width=2 doubles side level')
	ok(l2.every(isFinite) && r2.every(isFinite))
})

test('haas: delays the selected channel by `time`, leaves the other untouched', async () => {
	let n = Math.round(0.3 * SR)
	let L = new Float32Array(n), R = new Float32Array(n)
	L[1000] = 1; R[1000] = 1
	let a = audio.from([L, R], { sampleRate: SR }).haas({ time: 20 })
	almost(a.duration, 0.3 + 0.02, 0.005, `tail pad extends duration (${a.duration.toFixed(3)}s)`)
	let [l, r] = await a.read()
	let argmax = d => { let m = 0, mi = 0; for (let i = 0; i < d.length; i++) if (Math.abs(d[i]) > m) { m = Math.abs(d[i]); mi = i } return mi }
	is(argmax(l), 1000, 'left impulse stays put')
	is(argmax(r), 1000 + Math.round(0.02 * SR), 'right impulse lands 20ms later')
})

test('panner: constant-power placement of the mono mid', async () => {
	let L = tone(440, 0.3), R = tone(440, 0.3)
	let [lL, rL] = await audio.from([L.slice(), R.slice()], { sampleRate: SR }).panner({ pan: -1 }).read()
	ok(rms(rL) < 1e-6, 'pan=-1 silences right')
	ok(rms(lL) > 0.4, 'pan=-1 carries the mid on left (rms of 0.7-amp sine ≈ 0.495)')

	let [lC, rC] = await audio.from([L.slice(), R.slice()], { sampleRate: SR }).panner({ pan: 0 }).read()
	almost(rms(lC), rms(rC), 1e-4, 'pan=0 equal levels')
	almost(Math.hypot(rms(lL), rms(rL)), Math.hypot(rms(lC), rms(rC)), 1e-3, 'constant power across positions')
})

test('autopan: LFO sweeps level between channels, power stays constant', async () => {
	let L = tone(440, 1), R = tone(440, 1)
	let [l, r] = await audio.from([L, R], { sampleRate: SR }).autopan({ rate: 4, depth: 1 }).read()
	let [minL, maxL] = envelopeSpread(l)
	ok(minL < maxL * 0.2, `left level sweeps (${minL.toFixed(3)}..${maxL.toFixed(3)})`)
	// constant power: summed short-window energies stay level
	let pw = [], winN = Math.round(0.05 * SR)
	for (let i = 0; i + winN <= l.length; i += winN) pw.push(rms(l, i, i + winN) ** 2 + rms(r, i, i + winN) ** 2)
	let pMin = Math.min(...pw), pMax = Math.max(...pw)
	ok(pMax / pMin < 1.2, `power constant across sweep (${(pMax / pMin).toFixed(3)}×)`)
})

test('midside: encode yields M/S, decode round-trips to identity', async () => {
	let L = tone(440, 0.3), R = tone(880, 0.3)
	let [m, s] = await audio.from([L.slice(), R.slice()], { sampleRate: SR }).midside({ mode: 'encode' }).read()
	let dMax = 0
	for (let i = 0; i < m.length; i++) dMax = Math.max(dMax, Math.abs(m[i] - (L[i] + R[i]) / 2))
	ok(dMax < 1e-6, `mid = (L+R)/2 (${dMax.toExponential(1)})`)

	let [l2, r2] = await audio.from([L.slice(), R.slice()], { sampleRate: SR })
		.midside({ mode: 'encode' }).midside({ mode: 'decode' }).read()
	let dRt = 0
	for (let i = 0; i < l2.length; i++) dRt = Math.max(dRt, Math.abs(l2[i] - L[i]), Math.abs(r2[i] - R[i]))
	ok(dRt < 1e-6, `encode→decode identity (${dRt.toExponential(1)})`)
})

test('microshift: mix=0 is dry identity, default detunes wet without blowup', async () => {
	let L = tone(440, 0.5), R = tone(440, 0.5)
	let [l0, r0] = await audio.from([L.slice(), R.slice()], { sampleRate: SR }).microshift({ mix: 0 }).read()
	let d0 = 0
	for (let i = 0; i < L.length; i++) d0 = Math.max(d0, Math.abs(l0[i] - L[i]), Math.abs(r0[i] - R[i]))
	ok(d0 < 1e-6, `mix=0 dry identity (${d0.toExponential(1)})`)

	let [l, r] = await audio.from([L.slice(), R.slice()], { sampleRate: SR }).microshift({ cents: 15, mix: 1 }).read()
	ok(l.every(isFinite) && r.every(isFinite))
	let settle = Math.round(0.1 * SR)
	ok(Math.abs(rms(l, settle) / rms(L, settle) - 1) < 0.5, 'wet level in the dry ballpark')
	// detuned heads decorrelate the channels — dry input was identical L/R
	let diff = 0
	for (let i = settle; i < l.length; i++) diff = Math.max(diff, Math.abs(l[i] - r[i]))
	ok(diff > 0.05, `up/down detune decorrelates channels (${diff.toFixed(3)})`)
})

test('surround: stereo → 5.1, center carries the mid, LFE is lowpassed', async () => {
	// mid content: 60Hz + 3kHz; side content separates Ls/Rs
	let n = SR
	let L = new Float32Array(n), R = new Float32Array(n)
	for (let i = 0; i < n; i++) {
		let lo = 0.4 * Math.sin(2 * Math.PI * 60 * i / SR), hi = 0.4 * Math.sin(2 * Math.PI * 3000 * i / SR)
		L[i] = lo + hi; R[i] = lo + hi
	}
	let a = audio.from([L, R], { sampleRate: SR }).surround()
	is(a.channels, 6, 'declared 2→6 channel change')
	let chs = await a.read()
	is(chs.length, 6, 'six channels rendered')
	let [l, r, c, lfe, ls, rs] = chs
	is(l.length, n, 'length preserved')
	ok(rms(c) > 0.25, 'center carries the mid (0.7071 × mid rms 0.4 ≈ 0.283)')
	let from = Math.round(0.1 * SR), to = Math.round(0.9 * SR)
	ok(goertzel(lfe, 60, SR, from, to) > goertzel(lfe, 3000, SR, from, to) * 5, 'LFE keeps lows, sheds highs')
	ok(rms(ls, from, to) < 1e-4 && rms(rs, from, to) < 1e-4, 'no side content → silent surrounds')
	ok(chs.every(ch => ch.every(isFinite)))
})

test('surround: composes with a following op at the new width (2→6 then gain)', async () => {
	// the post-whole-op width (6) must propagate into the fresh pipeline stage the
	// gain compiles into — regression for the plan.ch / initProcs width plumbing
	let L = tone(440, 0.2), R = tone(440, 0.2)
	let plain = await audio.from([L.slice(), R.slice()], { sampleRate: SR }).surround().read()
	let gained = await audio.from([L.slice(), R.slice()], { sampleRate: SR }).surround().gain(-6).read()
	is(gained.length, 6, 'still 6 channels after the following op')
	let ratio = rms(gained[2]) / rms(plain[2])
	ok(Math.abs(ratio - 10 ** (-6 / 20)) < 0.01, `gain applies to the 6ch result (${ratio.toFixed(3)} ≈ 0.501)`)
})

test('surround: stream ≡ read across the channel-count change', async () => {
	// pins the live-stream generator's width resync (plan.ch → bufA realloc) —
	// read() goes through streamPlan, stream() through the pump generator
	let L = tone(440, 0.5), R = tone(880, 0.5)
	let a = audio.from([L.slice(), R.slice()], { sampleRate: SR }).surround()
	let flat = await a.read()
	let chunks = [], total = 0
	for await (let c of a.stream()) { chunks.push(c); total += c[0].length }
	is(chunks[0].length, 6, 'stream yields 6-channel chunks')
	is(total, flat[0].length, 'stream length matches read')
	let d = 0, pos = 0
	for (let c of chunks) {
		for (let ch = 0; ch < 6; ch++)
			for (let i = 0; i < c[ch].length; i++) d = Math.max(d, Math.abs(c[ch][i] - flat[ch][pos + i]))
		pos += c[0].length
	}
	ok(d < 1e-6, `stream ≡ read (${d.toExponential(1)})`)
})
