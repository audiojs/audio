// FATE-style stored-reference tests — physical metrics of effect output pinned to
// measured values (impulse → RT60, echo decay ratios, modulation depth/rate), plus a
// reference checksum for bit-exact reproducibility of a deterministic built-in chain
// (biquad + gain + fade only — no FFT, no randomness: stable across platforms).
import test, { ok, is, almost } from 'tst'
import audio from '../audio.js'
import { tone as genTone, impulse } from './gen.js'

const SR = 44100

test('fate: freeverb impulse → RT60 (Schroeder backward integration)', async () => {
	await audio.use('freeverb')
	let a = audio.from([impulse(SR * 3)], { sampleRate: SR })
	a.freeverb({ room: 0.8, wet: 1, dry: 0 })
	let ir = (await a.read())[0]
	let tail = 0
	for (let i = ir.length - 1; i >= 0; i--) if (Math.abs(ir[i]) > 1e-5) { tail = i; break }
	let edc = new Float64Array(tail), acc = 0
	for (let i = tail - 1; i >= 0; i--) { acc += ir[i] ** 2; edc[i] = acc }
	let db = i => 10 * Math.log10(edc[i] / edc[0])
	let t5 = 0, t35 = 0
	for (let i = 0; i < tail; i++) { if (!t5 && db(i) <= -5) t5 = i; if (!t35 && db(i) <= -35) { t35 = i; break } }
	let rt60 = (t35 - t5) / SR * 2
	almost(rt60, 1.42, 0.2, `RT60 at room 0.8 (reference 1.42s, got ${rt60.toFixed(3)})`)
})

test('fate: delay impulse → echo spacing exact, decay ratio = feedback', async () => {
	await audio.use('delay')
	let a = audio.from([impulse(SR * 2)], { sampleRate: SR })
	a.delay({ time: 0.25, feedback: 0.5, wet: 1, dry: 1 })
	let d = (await a.read())[0]
	let peak = at => { let m = 0, c0 = Math.round(at * SR); for (let i = -50; i <= 50; i++) m = Math.max(m, Math.abs(d[c0 + i] || 0)); return m }
	// reference: 0.5, 0.5, 0.25, 0.125 — each echo scaled by feedback
	almost(peak(0.25), 0.5, 0.02, 'first echo level')
	almost(peak(0.5) / peak(0.25), 0.5, 0.02, 'echo 2/1 ratio = feedback')
	almost(peak(0.75) / peak(0.5), 0.5, 0.02, 'echo 3/2 ratio = feedback')
	// silence between echoes — spacing is exact, no smearing
	let between = 0
	for (let i = Math.round(0.30 * SR); i < Math.round(0.45 * SR); i++) between = Math.max(between, Math.abs(d[i]))
	ok(between < 0.01, `no energy between echoes (${between.toFixed(4)})`)
})

test('fate: tremolo → modulation depth and rate via rms envelope', async () => {
	await audio.use('tremolo')
	let a = audio.from([genTone(440, 2)], { sampleRate: SR })
	a.tremolo({ rate: 4, depth: 0.8 })
	let d = (await a.read())[0]
	let env = [], W = 512
	for (let off = SR >> 1; off + W < d.length - (SR >> 2); off += W) {
		let s = 0
		for (let i = 0; i < W; i++) s += d[off + i] ** 2
		env.push(Math.sqrt(s / W))
	}
	let mx = Math.max(...env), mn = Math.min(...env)
	almost((mx - mn) / mx, 0.8, 0.05, 'modulation depth matches the declared 0.8')
	let peaks = 0
	for (let i = 1; i + 1 < env.length; i++) if (env[i] > env[i - 1] && env[i] >= env[i + 1] && env[i] > mx * 0.8) peaks++
	almost(peaks / (env.length * W / SR), 4, 0.2, 'modulation rate ≈ 4 Hz')
})

test('fate: reference checksum — deterministic chain is bit-exact reproducible', async () => {
	let fnv = pcm => {
		let u = new Uint32Array(pcm.buffer, pcm.byteOffset, pcm.length), h = 2166136261
		for (let i = 0; i < u.length; i++) { h ^= u[i]; h = Math.imul(h, 16777619) >>> 0 }
		return h >>> 0
	}
	let render = async () => {
		let a = audio.from([genTone(440, 2)], { sampleRate: SR })
		a.highpass(200).gain(-3).fade(0.1, -0.1)
		return fnv((await a.read())[0])
	}
	let h1 = await render(), h2 = await render()
	is(h1, h2, 'two renders identical')
	is(h1, 0x868cd0ee, `pinned reference checksum (got 0x${h1.toString(16)})`)
})
