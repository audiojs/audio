// Time-stretch plugins through the real engine — whole-render hosting with the
// structural `frames` hook: output length = input × factor, timeline follows.
import test, { ok, is, almost } from 'tst'
import audio from '../audio.js'
import { tone as genTone } from './gen.js'
import { METHODS } from '../fn/stretch.js'

const SR = 44100
const tone = (freq, dur, amp = 0.5, sr = SR) => genTone(freq, dur, amp, sr)

const zcHz = (d, sr = SR) => {
	let from = d.length >> 2, to = d.length - (d.length >> 2), zc = 0
	for (let i = from + 1; i < to; i++) if ((d[i - 1] < 0) !== (d[i] < 0)) zc++
	return zc / 2 / ((to - from) / sr)
}

// stretch({ method }): each algorithm in the vocoder's place, the edit its op's; its module the only one loaded. First
// in the file, before the tests below load every one
test('stretch({ method }) — the method\'s op does it, loaded alone', async () => {
	let a = audio.from([tone(440, 1)], { sampleRate: SR }).stretch(2, { method: 'wsola' })
	is(a.edits[0][0], 'stretch-wsola', 'the edit is the method\'s')
	let pcm = await a.read()
	is(pcm[0].length, SR * 2, 'twice as long')
	ok(audio.op('stretch-wsola') && !audio.op('stretch-pghi') && !audio.op('stretch-sms'), 'its module loaded, no other')
	is(audio.from([tone(440, 1)], { sampleRate: SR }).stretch(2, { method: 'phase-lock' }).edits[0][0], 'stretch', 'phase-lock: the vocoder\'s own')
})

test('stretch({ method }) — every method: 2× duration, pitch preserved', async () => {
	for (let method of ['phase-lock', ...Object.keys(METHODS)]) {
		let a = audio.from([tone(440, 1)], { sampleRate: SR }).stretch(2, { method })
		let pcm = await a.read()
		is(pcm[0].length, SR * 2, `${method}: output frames`)
		almost(a.duration, 2, 1e-9, `${method}: duration`)
		// paulstretch smears a tone into a drone around it, the others keep it
		if (method !== 'paulstretch') ok(Math.abs(zcHz(pcm[0]) - 440) < 10, `${method}: pitch preserved (${zcHz(pcm[0]).toFixed(0)}Hz)`)
	}
})

// A range: stretched alone, round(round(duration · sr) · factor) samples long, the audio either side sample for sample;
// each seam crossfaded into the audio as it was: no step (its curvature within 2× the sine's own), no swell
test('stretch({ method }) — a range alone, its seams neither click nor swell', async () => {
	let x = tone(220, 2), s0 = SR / 2, n = Math.round(SR * 1.5), own = 0.5 * (2 * Math.PI * 220 / SR) ** 2
	let curv = (y, at) => { let m = 0; for (let i = at - 88; i < at + 88; i++) m = Math.max(m, Math.abs(y[i + 1] - 2 * y[i] + y[i - 1])); return m }
	let peak = (y, a, b) => { let m = 0; for (let i = a; i < b; i++) m = Math.max(m, Math.abs(y[i])); return m }
	for (let method of Object.keys(METHODS)) {
		let y = (await audio.from([x.slice()], { sampleRate: SR }).stretch(1.5, { method, at: 0.5, duration: 1 }).read())[0]
		is(y.length, 2 * SR - SR + n, `${method}: the range 1.5× as long, the rest as it was`)
		ok(y.subarray(0, s0).every((v, i) => v === x[i]) && y.subarray(s0 + n).every((v, i) => v === x[SR * 1.5 + i]), `${method}: either side untouched`)
		ok(curv(y, s0) < 2 * own && curv(y, s0 + n) < 2 * own, `${method}: no step at the seams (${(curv(y, s0) / own).toFixed(1)}×, ${(curv(y, s0 + n) / own).toFixed(1)}×)`)
		ok(peak(y, s0, s0 + 441) < 0.52 && peak(y, s0 + n - 441, s0 + n) < 0.52, `${method}: no swell at the seams`)
	}
})

test('stretch({ method }) — fails loud: an unknown method, a sliding factor, voice', () => {
	let a = () => audio.from([tone(440, 1)], { sampleRate: SR })
	let msg = f => { try { f(); return '' } catch (e) { return e.message } }
	ok(/unknown method 'nope'/.test(msg(() => a().stretch(2, { method: 'nope' }))), 'unknown method')
	ok(/constant factor/.test(msg(() => a().stretch(t => 1 + t, { method: 'wsola' }))), 'a sliding factor is phase-lock\'s')
	ok(/voice is phase-lock's/.test(msg(() => a().stretch(2, { method: 'psola', voice: true }))), 'voice is phase-lock\'s')
})

test('stretch plugins — every method: 2× duration, pitch preserved', async () => {
	await audio.use('stretch-pvoc-lock', 'stretch-pvoc', 'stretch-pghi', 'stretch-wsola',
		'stretch-psola', 'stretch-sms', 'stretch-transient', 'stretch-hybrid', 'stretch-paul')
	for (let name of ['stretch-pvoc-lock', 'stretch-pvoc', 'stretch-pghi', 'stretch-wsola',
		'stretch-psola', 'stretch-sms', 'stretch-transient', 'stretch-hybrid']) {
		let a = audio.from([tone(440, 1)], { sampleRate: SR })
		a[name](2)
		almost(a.duration, 2, 0.01, `${name}: duration doubles`)
		let pcm = await a.read()
		is(pcm[0].length, SR * 2, `${name}: output frames`)
		ok(Math.abs(zcHz(pcm[0]) - 440) < 10, `${name}: pitch preserved (${zcHz(pcm[0]).toFixed(0)}Hz)`)
		ok(pcm[0].every(Number.isFinite), `${name}: finite`)
	}
})

test('stretch plugins — compress + chain + serialize', async () => {
	let a = audio.from([tone(440, 1), tone(440, 1)], { sampleRate: SR })
	a['stretch-wsola'](0.5).gain(-6)
	almost(a.duration, 0.5, 0.01, 'factor 0.5 halves stereo timeline')
	let pcm = await a.read()
	is(pcm.length, 2, 'stereo preserved')
	ok(JSON.stringify(a.edits).includes('stretch-wsola'), 'edit serializes as one entry')
})

test('stretch plugins — paulstretch smear at high factor', async () => {
	let a = audio.from([tone(440, 1)], { sampleRate: SR })
	a['stretch-paul']({ factor: 4 })
	almost(a.duration, 4, 0.05, 'paulstretch 4×')
	let pcm = await a.read()
	ok(pcm[0].every(Number.isFinite), 'finite')
})
