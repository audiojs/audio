// Time-stretch plugins through the real engine — whole-render hosting with the
// structural `frames` hook: output length = input × factor, timeline follows.
import test, { ok, is, almost } from 'tst'
import audio from '../audio.js'
import { tone as genTone } from './gen.js'

const SR = 44100
const tone = (freq, dur, amp = 0.5, sr = SR) => genTone(freq, dur, amp, sr)

const zcHz = (d, sr = SR) => {
	let from = d.length >> 2, to = d.length - (d.length >> 2), zc = 0
	for (let i = from + 1; i < to; i++) if ((d[i - 1] < 0) !== (d[i] < 0)) zc++
	return zc / 2 / ((to - from) / sr)
}

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
