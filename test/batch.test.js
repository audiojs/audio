// Contract viability verification — real baseline atoms wrapped as atoms and
// driven through toBatch/toStream, differential-tested against their native APIs.
// One representative per convention: dynamics (stream-kernel), effect (params-state),
// filter (live coefficient re-derivation), reverb (long tail, per-channel state),
// vocals (channel-coupled), synth (generator), pitch (analyzer + events),
// saturate (streaming: false whole-signal).

import { test } from 'node:test'
import { strict as assert } from 'node:assert'
import { toBatch, toStream } from '../batch.js'

import { compressor as amCompressor } from '@audio/dynamics-compressor/audio'
import nativeCompressor from '@audio/dynamics-compressor'
import { delay as amDelay } from '@audio/effect-delay/audio'
import nativeDelay from '@audio/effect-delay'
import { highpass as amHighpass } from '@audio/filter-biquad/audio'
import nativeHighpass from '@audio/filter-biquad/highpass'
import { freeverb as amFreeverb } from '@audio/reverb-freeverb/audio'
import nativeFreeverb from '@audio/reverb-freeverb'
import { isolate as amIsolate } from '@audio/vocals/audio'
import { osc as amOsc } from '@audio/synth-osc/audio'
import { pitch as amPitch } from '@audio/pitch-yin/audio'
import { tube as amTube } from '../../@audio/saturate/packages/saturate-tube/audio.js'
import nativeTube from '../../@audio/saturate/packages/saturate-tube/tube.js'

const SR = 44100

function sine (freq, n = SR, amp = 0.5) {
	let d = new Float32Array(n)
	for (let i = 0; i < n; i++) d[i] = amp * Math.sin(2 * Math.PI * freq * i / SR)
	return d
}
function maxDiff (a, b, from = 0, to = a.length) {
	let m = 0
	for (let i = from; i < to; i++) m = Math.max(m, Math.abs(a[i] - b[i]))
	return m
}
function goertzel (d, f, from = 2048, to = d.length - 2048) {
	let w = 2 * Math.PI * f / SR, cw = Math.cos(w), s1 = 0, s2 = 0
	for (let i = from; i < to; i++) { let s0 = d[i] + 2 * cw * s1 - s2; s2 = s1; s1 = s0 }
	return Math.sqrt(Math.max(0, s1 * s1 + s2 * s2 - 2 * cw * s1 * s2)) / (to - from)
}

test('compressor am ≡ native kernel (differential, mono)', () => {
	let x = sine(440, SR, 0.8)
	let am = toBatch(amCompressor)(x, { params: { threshold: -24, ratio: 6, knee: 6, attack: 5, release: 100, makeup: 0 } })
	let native = nativeCompressor(Float32Array.from(x), { sampleRate: SR, threshold: -24, ratio: 6, knee: 6, attack: 5, release: 100 })
	assert.ok(maxDiff(am, native) < 1e-6, `max diff ${maxDiff(am, native).toExponential(1)}`)
})

test('stream ≡ batch across arbitrary chunking (compressor, freeverb)', () => {
	for (let [factory, params] of [[amCompressor, { threshold: -20 }], [amFreeverb, { room: 0.7, mix: 0.4 }]]) {
		let x = sine(330, SR, 0.7)
		let batch = toBatch(factory)(x, { params, sampleRate: SR })
		let stream = toStream(factory, { params, sampleRate: SR })
		let out = new Float32Array(x.length)
		let pos = 0
		for (let sizes = [64, 1000, 3, 2048, 777]; pos < x.length;) {
			let n = Math.min(sizes[pos % sizes.length] || 512, x.length - pos)
			out.set(stream.write(x.subarray(pos, pos + n)), pos)
			pos += n
		}
		assert.ok(maxDiff(batch, out) < 1e-6, `${factory.name}: stream matches batch (${maxDiff(batch, out).toExponential(1)})`)
	}
})

test('delay am ≡ native (params-object state convention)', () => {
	let x = sine(220, SR)
	let am = toBatch(amDelay)(x, { params: { time: 0.2, feedback: 0.4, mix: 0.5 } })
	let native = nativeDelay(Float32Array.from(x), { time: 0.2, feedback: 0.4, mix: 0.5, fs: SR })
	assert.ok(maxDiff(am, native) < 1e-6)
})

test('highpass am ≡ native + live parameter re-derivation mid-stream', () => {
	let x = sine(100, SR, 0.5)
	for (let i = 0; i < x.length; i++) x[i] += 0.5 * Math.sin(2 * Math.PI * 5000 * i / SR)
	let am = toBatch(amHighpass)(x, { params: { freq: 1000, q: 0.707 } })
	let native = nativeHighpass(Float32Array.from(x), { fc: 1000, Q: 0.707, fs: SR })
	assert.ok(maxDiff(am, native) < 1e-6, 'static differential')

	// automation: cutoff jumps 300 → 8000 at t = 0.5s — probe 1 kHz, three octaves below
	// the late cutoff (2nd-order HP ≈ −36 dB there; early cutoff 300 passes it clean)
	let y = sine(1000, SR, 0.5)
	let auto = toBatch(amHighpass)(y, { params: { freq: t => t < 0.5 ? 300 : 8000, q: 0.707 } })
	let early = goertzel(auto, 1000, 4096, SR / 2 - 4096)
	let late = goertzel(auto, 1000, SR / 2 + 4096, SR - 4096)
	assert.ok(late < early * 0.05, `automation engaged (1 kHz ${(20 * Math.log10(late / early)).toFixed(1)} dB late)`)
	assert.ok(auto.every(isFinite))
})

test('freeverb am ≡ native (mono), stereo decorrelates', () => {
	let x = sine(440, SR)
	let am = toBatch(amFreeverb)(x, { params: { room: 0.5, damp: 0.5, mix: 0.33 } })
	let native = nativeFreeverb(Float32Array.from(x), { room: 0.5, damp: 0.5, mix: 0.33, fs: SR })
	assert.ok(maxDiff(am, native) < 1e-6)
	let st = toBatch(amFreeverb)([sine(440, 8192), sine(440, 8192)], { params: { mix: 1 } })
	assert.ok(maxDiff(st[0], st[1]) > 1e-4, 'per-channel state offsets decorrelate')
})

test('isolate am — channel-coupled processing (stereo → mid)', () => {
	let vocal = sine(440, 8192, 0.5), side = sine(3000, 8192, 0.3)
	let L = new Float32Array(8192), R = new Float32Array(8192)
	for (let i = 0; i < 8192; i++) { L[i] = vocal[i] + side[i]; R[i] = vocal[i] - side[i] }
	let out = toBatch(amIsolate)([L, R])
	assert.ok(maxDiff(out[0], vocal) < 1e-6, 'mid extracted')
	assert.ok(maxDiff(out[0], out[1]) < 1e-9, 'both channels carry mid')
})

test('osc am — generator: no input bus, pitch and enum verified', () => {
	let out = toBatch(amOsc)(null, { frames: SR, params: { freq: 440, type: 'sine' } })
	let c = 0
	for (let i = 1; i < out.length; i++) if ((out[i - 1] < 0) !== (out[i] < 0)) c++
	assert.ok(Math.abs(c / 2 - 440) < 3, `440 Hz generated (${c / 2})`)
	let sq = toBatch(amOsc)(null, { frames: SR, params: { freq: 440, type: 'square' } })
	assert.ok(goertzel(sq, 1320) > goertzel(sq, 880) * 3, 'square enum: odd harmonics')
})

test('pitch am — analyzer: no audio out, emits pitch per frame', () => {
	let { events } = toBatch(amPitch)(sine(440, SR))
	let pitches = events.filter(e => e.name === 'pitch').map(e => e.args[0])
	assert.ok(pitches.length >= 15, `${pitches.length} frames analyzed`)
	for (let p of pitches) assert.ok(Math.abs(p - 440) < 3, `pitch ${p.toFixed(1)}`)
	assert.ok(events.some(e => e.name === 'clarity'))
})

test('tube am — streaming:false runs whole-signal, matches native; toStream refuses', () => {
	let x = sine(440, SR, 0.7)
	let am = toBatch(amTube)(x, { params: { drive: 3, bias: 0.25, mix: 1 } })
	let native = nativeTube(Float32Array.from(x), { drive: 3, bias: 0.25, mix: 1, fs: SR, oversample: 4 })
	assert.ok(maxDiff(am, native) < 1e-6)
	assert.throws(() => toStream(amTube), /streaming/)
})

test('smoothing ramps block-rate params without zipper steps', () => {
	let seen = []
	let probe = () => (inputs, outputs, params) => { seen.push(params.mix[0]) }
	probe.params = { mix: { type: 'number', min: 0, max: 1, default: 0, smoothing: 0.1 } }
	toBatch(probe, { maxBlockSize: 128 })(sine(440, SR / 2), { params: { mix: t => t === 0 ? 0 : 1 } })
	assert.equal(seen[0], 0, 'first block snaps')
	for (let i = 1; i < seen.length; i++) assert.ok(seen[i] >= seen[i - 1], 'monotonic ramp')
	assert.ok(Math.abs(seen[1] - 128 / (0.1 * SR)) < 1e-5, 'linear step size')
	assert.equal(seen[seen.length - 1], 1, 'reaches target')
})
