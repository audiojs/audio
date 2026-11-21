// Contract viability verification — real baseline atoms wrapped as atoms and
// driven through toBatch/toStream, differential-tested against their native APIs.
// One representative per convention: dynamics (stream-kernel), effect (params-state),
// filter (live coefficient re-derivation), reverb (long tail, per-channel state),
// vocals (channel-coupled), synth (generator), pitch (analyzer + events),
// saturate (streaming: false whole-signal).

import { test } from 'node:test'
import { strict as assert } from 'node:assert'
import { toBatch, toStream, inUnit } from '../batch.js'

import { compressor as amCompressor } from '@audio/dynamics-compressor/audio'
import nativeCompressor from '@audio/dynamics-compressor'
import { delay as amDelay } from '@audio/effect-delay/audio'
import { limiter as amLimiter } from '@audio/dynamics-limiter/audio'
import nativeDelay from '@audio/effect-delay'
import { highpass as amHighpass } from '@audio/filter-biquad/audio'
import nativeHighpass from '@audio/filter-biquad/highpass'
import { freeverb as amFreeverb } from '@audio/reverb-freeverb/audio'
import nativeFreeverb from '@audio/reverb-freeverb'
import { isolate as amIsolate } from '@audio/vocals/audio'
import { osc as amOsc } from '@audio/synth-osc/audio'
import { pitch as amPitch } from '@audio/pitch-yin/audio'
import { tube as amTube } from '@audio/saturate-tube/audio'
import nativeTube from '@audio/saturate-tube'

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
	let am = toBatch(amHighpass)(x, { params: { fc: 1000, Q: 0.707 } })
	let native = nativeHighpass(Float32Array.from(x), { fc: 1000, Q: 0.707, fs: SR })
	assert.ok(maxDiff(am, native) < 1e-6, 'static differential')

	// the manifest's params follow the kernel's names since filter-biquad 2: fc and Q
	// automation: cutoff jumps 300 → 8000 at t = 0.5s — probe 1 kHz, three octaves below
	// the late cutoff (2nd-order HP ≈ −36 dB there; early cutoff 300 passes it clean)
	let y = sine(1000, SR, 0.5)
	let auto = toBatch(amHighpass)(y, { params: { fc: t => t < 0.5 ? 300 : 8000, Q: 0.707 } })
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

// saturate-tube streams since 1.1.0 (streaming: false before), through @audio/resample-sinc's 4x oversampler, its
// latency frames late: toBatch's output, which it does not compensate, read that much later is the kernel's whole call
// bit for bit away from the signal's ends, where the oversampler's kernel reaches past them; toStream takes it
test('tube am: streams; its output, its latency later, is the native whole call away from the ends; toStream takes it', () => {
	let x = sine(440, SR, 0.7), L = amTube.latency, edge = 64
	let am = toBatch(amTube)(x, { params: { drive: 3, bias: 0.25, mix: 1 } })
	let native = nativeTube(Float32Array.from(x), { drive: 3, bias: 0.25, mix: 1, fs: SR, oversample: 4 })
	assert.ok(Number.isInteger(L) && L > 0, `a latency in frames (${L})`)
	assert.equal(maxDiff(am.subarray(L), native, edge, x.length - L - edge), 0)
	assert.doesNotThrow(() => toStream(amTube).write(x))
})

// CONTRACT.md § Parameters: `smoothing` reaches a jump of the value (a new setting, a step in a curve) by a linear ramp of
// that many seconds from the value in force; a value that moves by itself (a sloped curve, an automation function) is
// not smoothed again. While a value moves, no call is longer than 32 frames; an automation function moves throughout
test('smoothing ramps a jump linearly over its seconds; a function and a curve\'s slope are their own value, not lagging', () => {
	let seen = []
	let probe = () => (inputs, outputs, params) => { seen.push([outputs[0][0].length, params.mix[0]]) }
	probe.params = { mix: { type: 'number', min: 0, max: 1, default: 0, smoothing: 0.1 } }
	toBatch(probe, { maxBlockSize: 128 })(sine(440, SR / 2), { params: { mix: t => t === 0 ? 0 : 1 } })
	assert.equal(seen[0][1], 0, 'the first call snaps')
	assert.ok(seen.every(([n]) => n <= 32), 'calls of 32 frames at most')
	// the function gives 1 from the second call's frame, 32, on: each call holds it, not a ramp toward it
	for (let i = 1, f = seen[0][0]; i < seen.length; f += seen[i][0], i++) assert.equal(seen[i][1], 1, `frame ${f} holds the function's 1`)
	// at 48 kHz with smoothing 0.01 s (480 frames), each call over frames 1000 to 3000 of a curve 0 to 1000, and of a
	// function of the same line, holds the value there at its first frame (the model before held 284 at frame 2000 and
	// 763 at 3000 for the curve, 281 and 751 for the function); a step from 0 to 1000 at frame 1000 still ramps over the
	// 480 frames; a step to 500 there into a slope up to 1000 at frame 3000 ramps its 500 away while the slope goes on,
	// and is on it from frame 1480
	let at = (level, sampleRate = 48000) => {
		let list = [], f = 0
		let p = () => (inputs, outputs, params) => { let n = outputs[0][0].length; list.push({ at: f, n, v: params.level[0] }); f += n }
		p.params = { level: { type: 'number', min: 0, max: 1000, default: 0, smoothing: 0.01 } }
		toBatch(p, { sampleRate })(new Float32Array(4000), { params: { level } })
		return list
	}
	let line = f => Math.min(1000, Math.max(0, (f - 1000) / 2)), into = f => f < 1000 ? 0 : 500 + Math.min(500, (f - 1000) / 4)
	let near = (got, want, what) => assert.ok(Math.abs(got - want) < 1e-3, `${what}: ${got}, not ${want}`)
	let curve = at({ t: [1000 / 48000, 3000 / 48000], v: [0, 1000] }), fn = at(t => line(t * 48000))
	for (let [list, what] of [[curve, 'the curve'], [fn, 'the function']]) {
		for (let c of list) near(c.v, line(c.at), `${what} at frame ${c.at}`)
		let c2000 = list.findLast(c => c.at <= 2000), c3000 = list.findLast(c => c.at <= 3000)
		assert.ok(c2000.n <= 32 && c3000.at > 2968, `${what}: the calls holding frames 2000 and 3000 start within 32 frames of them`)
		near(c2000.v, line(c2000.at), `${what}, the call holding frame 2000`)
		near(c3000.v, line(c3000.at), `${what}, the call holding frame 3000`)
	}
	assert.equal(curve.findLast(c => c.at <= 3000).v, 1000, 'the curve at its last point, frame 3000: 1000')
	for (let c of at({ t: [1000 / 48000, 1000 / 48000], v: [0, 1000] })) near(c.v, 1000 * Math.min(1, Math.max(0, (c.at - 1000) / 480)), `the step's linear ramp at frame ${c.at}`)
	for (let c of at({ t: [1000 / 48000, 1000 / 48000, 3000 / 48000], v: [0, 500, 1000] })) near(c.v, into(c.at) - 500 * Math.min(1, Math.max(0, 1 - (c.at - 1000) / 480)) * (c.at >= 1000), `the step into a slope at frame ${c.at}`)
	// a value written between chunks: a jump at the chunk's first frame, ramped from there; a value at rest, one call a block
	seen = []
	let s = toStream(probe, { maxBlockSize: 1024 })
	s.write(sine(440, 4096))
	assert.deepEqual(seen.map(([n]) => n), [1024, 1024, 1024, 1024], 'nothing moves: blocks of maxBlockSize')
	seen = []
	s.write(sine(440, 8192), { mix: 1 })
	for (let i = 0, f = 0; i < seen.length; f += seen[i][0], i++) {
		if (f < 4410) assert.ok(seen[i][0] <= 32, `a call of ${seen[i][0]} frames inside the ramp`)
		assert.ok(Math.abs(seen[i][1] - Math.min(1, f / 4410)) < 1e-6, `linear from the chunk's first frame: frame ${f} holds ${seen[i][1]}`)
	}
	assert.ok(seen.at(-1)[0] > 32, 'at rest again: calls as long as the block')
})

test('toStream: write() takes values, not a function or a curve: a stream has no render time to ask one at', () => {
	let x = sine(440, 4096, 0.8), s = toStream(amCompressor, { params: { threshold: -20 } })
	assert.throws(() => s.write(x, { threshold: t => -30 }), /compressor: threshold takes a value between chunks, not a function/)
	assert.throws(() => s.write(x, { threshold: { t: [0, 1], v: [-30, -10] } }), /compressor: threshold takes a value between chunks, not a curve/)
	assert.ok(s.write(x, { threshold: -30 }).every(Number.isFinite), 'a value renders')
})

// CONTRACT.md § Parameters: a param's `alias`, the name it first shipped under: "Hosts still accept it"
test('toStream: write() takes a param by its alias, as its start options do', () => {
	let seen = []
	let p = () => (inputs, outputs, params) => { seen.push(params.fc[0]) }
	p.params = { fc: { type: 'number', min: 20, max: 20000, default: 1000, alias: 'freq' } }
	let s = toStream(p, { params: { freq: 500 } })
	s.write(sine(440, 64))
	s.write(sine(440, 64), { freq: 2000 })
	s.write(sine(440, 64), { fc: 3000, freq: 100 })
	assert.deepEqual(seen, [500, 2000, 3000], 'by its alias, and by its name where both are given')
})

// CONTRACT.md § Lifecycle: an instance is one configuration; a change of its channel counts is a new instance
test('toStream: a chunk of other channels than the first is refused, naming both counts', () => {
	let s = toStream(amCompressor), x = sine(440, 1024)
	s.write(x)
	assert.throws(() => s.write([x, x]), /^RangeError: toStream: compressor was built for 1 channel on input bus 0, this chunk has 2/)
	assert.ok(s.write(x).every(Number.isFinite), 'chunks of its channels go on')
	let generator = toStream(amOsc)
	generator.write(64)
	assert.ok(generator.write(64).length === 64, 'chunks of frames alone, nothing fed: no channels to change')
	assert.throws(() => generator.write(sine(440, 64)), /^RangeError: toStream: osc was built for 0 channels on input bus 0, this chunk has 1/, 'a chunk fed after frames alone, which fed none')
})

// CONTRACT.md § Buffers: a source with a rate (a sound) is resampled by the host, which these hosts cannot do
test('toBatch and toStream refuse a sound as a buffer, naming the buffer and what they take', async () => {
	const { default: audio } = await import('../audio.js')
	let p = Object.assign(ctx => (inputs, outputs) => { for (let c = 0; c < outputs[0].length; c++) outputs[0][c].set(inputs[0][c]) }, { id: 'buffered', params: {}, channels: 'any', buffers: { ir: { channels: [1, 2] } } })
	let ir = audio.from([new Float32Array(8)], { sampleRate: SR }), x = sine(440, 256)
	assert.throws(() => toBatch(p)(x, { buffers: { ir } }), /^TypeError: buffered: buffer ir is a sound, which toBatch cannot render; it takes planar arrays at the render's rate \(Float32Array\[\]\)/)
	assert.throws(() => toStream(p, { buffers: { ir } }), /^TypeError: buffered: buffer ir is a sound, which toStream cannot render/)
	assert.deepEqual(toBatch(p)(x, { buffers: { ir: [new Float32Array(8)] } }), x, 'planar arrays are taken')
	// an AudioBuffer has a rate too (a stand-in of its shape: Node has none); its length is its frames, which were
	// counted as its channels (8, refused as not 1 or 2)
	let ab = { numberOfChannels: 2, length: 8, sampleRate: SR, duration: 8 / SR, getChannelData: () => new Float32Array(8) }
	assert.throws(() => toBatch(p)(x, { buffers: { ir: ab } }), /^TypeError: buffered: buffer ir is a sound, which toBatch cannot render/, 'an AudioBuffer: a sound')
	assert.throws(() => toStream(p, { buffers: { ir: ab } }), /^TypeError: buffered: buffer ir is a sound, which toStream cannot render/, 'toStream, the same')
})

// CONTRACT.md § Latency, tail, whole signals: `frames: (inFrames, setting) => outFrames` is the output length of a
// whole-signal processor that changes it, of the setting { sampleRate, params, buffers, transport }
test('toBatch: a whole-signal processor\'s output is as long as its frames says, as audio renders it', async () => {
	const { default: audio } = await import('../audio.js')
	let seen = []
	let longer = ctx => { seen.push(ctx.maxBlockSize); return (inputs, outputs, params) => { let x = inputs[0][0], y = outputs[0][0], k = params.factor[0]; seen.push([x.length, y.length]); for (let i = 0; i < y.length; i++) y[i] = x[Math.floor(i / k)] } }
	Object.assign(longer, { id: 'longer', params: { factor: { type: 'number', min: 1, max: 4, default: 2 } }, channels: 'any', streaming: false, frames: (n, { params }) => n * params.factor[0] })
	let x = Float32Array.from({ length: 100 }, (_, i) => i)
	let y = toBatch(longer)(x)
	assert.equal(y.length, 200, 'twice the input')
	assert.deepEqual(seen, [200, [100, 200]], 'one call: the input\'s 100 frames in, 200 out, maxBlockSize the longer')
	assert.equal(toBatch(longer)(x, { params: { factor: 3 } }).length, 300, 'of the values given')
	audio.use(longer)
	assert.deepEqual((await audio.from([x], { sampleRate: SR }).longer().read())[0], y, 'as audio renders it')
})

// CONTRACT.md § process: "Input bus 0 always carries its channels": a bus 0 of a fixed count fed one channel carries it
// on each, as plugin hosts feed a mono track to a stereo plugin; another count is refused, naming both
test('a bus 0 that declares its count: one channel fed is copied to each, another count refused, in toBatch and toStream', () => {
	let seen = []
	let swap = () => (inputs, outputs) => { seen.push(inputs[0].length); outputs[0][0].set(inputs[0][1]); outputs[0][1].set(inputs[0][0]) }
	Object.assign(swap, { id: 'swap', params: {}, channels: 2 })
	let x = sine(440, 256)
	assert.deepEqual(toBatch(swap)(x), [x, x], 'toBatch: a mono channel on each of the two, both out')
	assert.deepEqual(toStream(swap).write(x), [x, x], 'toStream: the same')
	assert.deepEqual(seen, [2, 2], 'bus 0 carried 2')
	assert.throws(() => toBatch(swap)([x, x, x]), /^RangeError: swap: input bus 0 takes 2 channels, not the 3 that feed it/)
	assert.throws(() => toStream(swap).write([x, x, x]), /^RangeError: swap: input bus 0 takes 2 channels, not the 3 that feed it/)
	let mono = Object.assign(() => (inputs, outputs) => outputs[0][0].set(inputs[0][0]), { id: 'mono-in', params: {}, channels: { inputs: 1, outputs: 1 } })
	assert.throws(() => toBatch(mono)([x, x]), /^RangeError: mono-in: input bus 0 takes 1 channel, not the 2 that feed it/)
})

// One rule in toStream: a bus carries from the first chunk on what it carried then, and a chunk of one channel is copied
// to a bus of more whenever it comes (a stream begun with frames alone refused one before)
test('toStream: bus 0 of a declared count carries it from the first chunk on, a mono chunk copied to it whenever it comes', () => {
	let seen = []
	let swap = () => (inputs, outputs) => { seen.push(inputs[0].length); outputs[0][0].set(inputs[0][1]); outputs[0][1].set(inputs[0][0]) }
	Object.assign(swap, { id: 'swap', params: {}, channels: 2 })
	let x = sine(440, 64), y = sine(330, 64), s = toStream(swap)
	assert.deepEqual(s.write(64), [new Float32Array(64), new Float32Array(64)], 'frames alone: bus 0 silent, of its 2')
	assert.deepEqual(s.write(x), [x, x], 'then a mono chunk: on both')
	assert.deepEqual(s.write([x, y]), [y, x], 'a stereo chunk: as it is')
	assert.deepEqual(s.write(x), [x, x], 'a mono chunk again')
	assert.throws(() => s.write([x, x, x]), /^RangeError: toStream: swap was built for 2 channels on input bus 0 \(or one, copied to each\), this chunk has 3/)
	assert.deepEqual(seen, [2, 2, 2, 2], 'bus 0 carried 2 at every call')
	let any = toStream(Object.assign(() => (inputs, outputs) => { for (let c = 0; c < outputs[0].length; c++) outputs[0][c].set(inputs[0][c]) }, { id: 'thru', params: {}, channels: 'any' }))
	assert.deepEqual(any.write([x, y]), [x, y], 'a bus of any count: the first chunk\'s')
	assert.deepEqual(any.write(x), [x, x], 'a mono chunk after it, copied to each of those')
})

// A further input bus that declares a count carries it as bus 0 does: one channel copied to each, another count refused
// naming both; one of any count carries what feeds it
test('a further input bus of a declared count: one channel copied to each, another count refused, in toBatch and toStream', () => {
	let seen = []
	let less = () => (inputs, outputs) => { seen.push(inputs[1].length); for (let c = 0; c < 2; c++) for (let i = 0; i < outputs[0][c].length; i++) outputs[0][c][i] = inputs[0][c][i] - inputs[1][c][i] }
	Object.assign(less, { id: 'key-less', params: {}, channels: { inputs: [2, 2], outputs: [2] } })
	let x = sine(440, 256), k = sine(220, 256, 0.25), d = Float32Array.from(x, (v, i) => v - k[i])
	assert.deepEqual(toBatch(less)([[x, x], [k]]), [[d, d]], 'toBatch: a key of one on each channel')
	assert.deepEqual(toStream(less).write([[x, x], [k]]), [[d, d]], 'toStream: the same')
	assert.deepEqual(seen, [2, 2], 'bus 1 carried 2')
	assert.throws(() => toBatch(less)([[x, x], [k, k, k]]), /^RangeError: key-less: input bus 1 takes 2 channels, not the 3 that feed it/)
	assert.throws(() => toStream(less).write([[x, x], [k, k, k]]), /^RangeError: key-less: input bus 1 takes 2 channels, not the 3 that feed it/)
	let s = toStream(less)
	s.write([[x, x], [k, k]])
	assert.deepEqual(s.write([[x, x], [k]]), [[d, d]], 'toStream: a key of one after a key of two, copied to each')
	let any = Object.assign(() => (inputs, outputs) => { seen.push(inputs[1].length); outputs[0][0].set(inputs[0][0]) }, { id: 'any-key', params: {}, channels: { inputs: ['any', 'any'], outputs: 1 } })
	seen = []
	toBatch(any)([[x, x], [k]])
	assert.deepEqual(seen, [1], 'a further bus of any count: as fed')
})

// CONTRACT.md § What a host owes, 5: "Calls `process` with 1 to `maxBlockSize` frames of finite samples (a NaN or
// Infinity coming in is made 0)": in a copy of the channel that holds one, the caller's arrays never written; a clean
// input is handed over as it is (views of the caller's arrays, as these hosts cut calls)
test('toBatch and toStream: a NaN or Infinity coming in reaches the processor as 0, the caller\'s arrays untouched; a clean input as given', () => {
	let got = []
	let look = () => (inputs, outputs) => { got.push(inputs); for (let c = 0; c < outputs[0].length; c++) outputs[0][c].set(inputs[0][c]) }
	Object.assign(look, { id: 'look', params: {}, channels: { inputs: ['any', 'any'], outputs: 'any' } })
	let n = 256, x = sine(440, n), y = sine(330, n), k = sine(220, n), x0 = x.slice()
	x[10] = NaN; x[11] = Infinity; k[30] = -Infinity
	let clean = Float32Array.from(x, v => Number.isFinite(v) ? v : 0)
	for (let [host, run] of [['toBatch', () => toBatch(look)([[x, y], [k]])], ['toStream', () => toStream(look).write([[x, y], [k]])]]) {
		got = []
		let out = run()
		assert.deepEqual(out[0], [clean, y], `${host}: NaN and Infinity reach it as 0, the rest as fed`)
		assert.ok(got[0][1][0][30] === 0 && got[0][1][0].every(Number.isFinite), `${host}: the key's -Infinity as 0`)
		assert.ok(Number.isNaN(x[10]) && x[11] === Infinity && k[30] === -Infinity, `${host}: the caller's arrays hold them still`)
		assert.ok(got[0][0][0].buffer !== x.buffer && got[0][0][1].buffer === y.buffer, `${host}: a copy of the channel that held one, the clean one as given`)
	}
	for (let [host, run] of [['toBatch', () => toBatch(look)([[x0, y], [y]])], ['toStream', () => toStream(look).write([[x0, y], [y]])]]) {
		got = []
		run()
		assert.ok(got.length && got.every(b => b[0][0].buffer === x0.buffer && b[0][1].buffer === y.buffer && b[1][0].buffer === y.buffer), `${host}: clean, the caller's own arrays`)
	}
})

// CONTRACT.md § Parameters: `step`, "The value moves in steps of this size from `min`"; § What a host owes, 2: "Clamps
// numbers, puts a stepped one on its step". A probe declaring @audio/filter-moog-ladder's `poles` (min 2, max 4, step 2),
// which threw given 2.03: a value, a value between chunks and automation reach it on the step, in the three hosts
test('a stepped number reaches the processor on its step in toBatch, toStream and audio: poles 2.03 is 2, 3.2 is 4', async () => {
	const { default: audio } = await import('../audio.js')
	let seen = []
	let poles = () => (inputs, outputs, params) => { seen.push(params.poles[0]); outputs[0][0].set(inputs[0][0]) }
	Object.assign(poles, { id: 'poles-probe', params: { poles: { type: 'number', min: 2, max: 4, default: 4, step: 2 } }, channels: 'any' })
	audio.use(poles)
	let x = sine(440, 256)
	for (let [v, want] of [[2.03, 2], [3.2, 4], [3, 4], [2.99, 2], [5, 4]]) {
		seen = []
		toBatch(poles)(x, { params: { poles: v } })
		toStream(poles, { params: { poles: v } }).write(x)
		let s = toStream(poles, { params: { poles: 2 } })
		s.write(x)
		seen = seen.slice(0, -1)
		s.write(x, { poles: v })
		await audio.from([x], { sampleRate: SR })['poles-probe']({ poles: v }).read()
		assert.ok(seen.length >= 4 && seen.every(p => p === want), `poles ${v}: ${want} at every call of the three hosts, not ${seen}`)
	}
	seen = []
	toBatch(poles)(x, { params: { poles: { t: [0, 256 / SR], v: [2, 4] } } })
	assert.ok(seen.length > 1 && seen.every(p => p === 2 || p === 4) && seen.includes(2) && seen.includes(4), `automation from 2 to 4: 2 or 4 at each call, not ${seen}`)
})

// An endless tail (CONTRACT.md § Latency, tail: `Infinity` is allowed) cannot be flushed: the reference hosts render
// none of it; audio's render takes audio.TAIL seconds of the ring, as the processor makes it
test('an endless tail: toStream end() and toBatch render none, audio renders audio.TAIL seconds of it', async () => {
	const { default: audio } = await import('../audio.js')
	// holds the last sample it was given that was not 0, for ever
	let hold = () => { let last = 0; return (ins, outs) => { for (let i = 0; i < outs[0][0].length; i++) { if (ins[0][0][i]) last = ins[0][0][i]; for (let c of outs[0]) c[i] = last } } }
	let x = new Float32Array(100)
	x[0] = 1
	for (let [id, props] of [['endless', { tail: Infinity }], ['endless-fn', { tail: () => Infinity }], ['endless-whole', { tail: Infinity, streaming: false }]]) {
		let p = Object.assign((...a) => hold(...a), { id, params: {}, channels: 'any' }, props)
		if (props.streaming !== false) {
			let s = toStream(p)
			s.write(x)
			assert.equal(s.end(), undefined, `${id}: toStream end() renders none`)
		}
		assert.equal(toBatch(p)(x).length, 100, `${id}: toBatch, the input's frames`)
		audio.use(p)
		let n = Math.round(audio.TAIL * SR), a = audio.from([x], { sampleRate: SR })[id]()
		assert.equal(a.length, 100 + n, `${id}: audio, the input's frames and audio.TAIL seconds`)
		let y = (await a.read())[0]
		assert.equal(y.length, 100 + n, `${id}: and rendered`)
		assert.ok(y.subarray(100).every(v => v === 1), `${id}: the ring itself, the sample it holds`)
		// the length is audio.TAIL's, read at the render
		let kept = audio.TAIL
		audio.TAIL = 0.01
		try { assert.equal((await audio.from([x], { sampleRate: SR })[id]().read())[0].length, 100 + Math.round(0.01 * SR), `${id}: audio.TAIL = 0.01`) }
		finally { audio.TAIL = kept }
	}
	// a decay that ends is rendered whole, however long
	let long = Object.assign(() => (ins, outs) => { ins[0].forEach((c, i) => outs[0][i].set(c)) }, { id: 'long-tail', params: {}, channels: 'any', tail: audio.TAIL + 2 })
	audio.use(long)
	assert.equal(audio.from([x], { sampleRate: SR })['long-tail']().length, 100 + Math.round((audio.TAIL + 2) * SR), 'a tail of audio.TAIL + 2 s: all of it')
})

// CONTRACT.md § Latency, tail: a host takes `tail` when it needs it, with the values then in force
test('toStream end() reads a tail function with the values in force at the end', () => {
	let x = new Float32Array(SR / 10)
	x[0] = 1
	let s = toStream(amDelay, { params: { time: 0.1, feedback: 0.2, mix: 1 } })
	s.write(x)
	s.write(x.map(() => 0), { feedback: 0.6 })
	let seconds = amDelay.tail({ sampleRate: SR, params: { time: [0.1], feedback: [0.6], mix: [1] } })
	assert.ok(seconds > amDelay.tail({ sampleRate: SR, params: { time: [0.1], feedback: [0.2], mix: [1] } }), 'more feedback, a longer tail')
	assert.equal(s.end()?.length, Math.round(seconds * SR), 'the tail of feedback 0.6, as it is when the stream ends')
	let empty = toStream(amDelay, { params: { time: 0.1, feedback: 0.6, mix: 1 } })
	empty.write(new Float32Array(0))
	assert.equal(empty.end()?.length, Math.round(seconds * SR), 'after a chunk of no frames, the values asked')
})

test('units: a leading + and exponent notation; a value moved to another unit is the number its digits say there', () => {
	let dB = { type: 'number', min: -60, max: 60, unit: 'dB' }, s = { type: 'number', min: 0, max: 10, unit: 's' }, ms = { type: 'number', min: 0, max: 1e4, unit: 'ms' }
	assert.equal(inUnit(dB, '+3db'), 3)
	assert.equal(inUnit(dB, '+3'), 3)
	assert.equal(inUnit(s, '1e-3'), 0.001)
	assert.equal(inUnit(ms, '1e-3s'), 1)
	assert.equal(inUnit(s, '2.5e2ms'), 0.25)
	assert.equal(inUnit(s, '10ms'), 0.01)
	assert.equal(inUnit(ms, '1.005s'), 1005, '1.005 s is 1005 ms (1.005 × 1000 in binary is 1004.9999999999999)')
	assert.throws(() => inUnit(dB, '3e'), /takes dB, not '3e'/)
})

// One name for a processor in every host's errors: its id, else its function's name lowercase-dashed (CONTRACT.md
// § Identity: `pingPong` gives `ping-pong`)
test('a processor is named by its id in every host\'s errors', async () => {
	const { default: audio } = await import('../audio.js')
	function pingPong () { return (ins, outs) => { for (let c = 0; c < outs[0].length; c++) outs[0][c].set(ins[0][c]) } }
	pingPong.params = { time: { type: 'number', min: 0.01, max: 1, default: 0.25, unit: 's', restart: true } }
	let moving = t => 0.1 + t, x = new Float32Array(256)
	assert.throws(() => toBatch(pingPong)(x, { params: { time: moving } }), /^TypeError: ping-pong: time is fixed/, 'toBatch')
	assert.throws(() => toStream(pingPong, { params: { time: moving } }), /^TypeError: ping-pong: time is fixed/, 'toStream')
	audio.use(pingPong)
	assert.throws(() => audio.from([x], { sampleRate: SR })['ping-pong']({ time: moving }), /^TypeError: ping-pong: time is fixed/, 'audio')
})

// Layout tags (CONTRACT.md § Channels), declared as @audio/spatial-ambisonic declares them from 1.0: a choice of
// layouts is one bus, `[{ layouts: [...] }]`. Each atom copies its input channels round-robin into its outputs and
// records the ctx.layouts it was built with
function layoutAtom (inputs, outputs, seen) {
	let f = ctx => { seen.push(ctx.layouts); return (ins, outs) => { for (let c = 0; c < outs[0].length; c++) outs[0][c].set(ins[0][c % ins[0].length]) } }
	f.channels = { inputs, outputs }
	return f
}
const AMBI = [{ layouts: ['ambisonic-1', 'ambisonic-2', 'ambisonic-3'] }], SPEAKERS = [{ layouts: ['stereo', 'quad', '5.1', '7.1'] }]

test('layouts — tags resolve to widths and ctx.layouts: by the input, the host default, or `layouts`', () => {
	let seen = [], x = sine(440, 1024), chs = n => Array.from({ length: n }, () => x)
	let encoder = layoutAtom(1, AMBI, seen), rotate = layoutAtom(AMBI, AMBI, seen), decoder = layoutAtom(AMBI, SPEAKERS, seen)
	let y = toBatch(encoder)(x)
	assert.equal(y.length, 4, 'mono → first-order ambisonics: 4 channels, all of them returned')
	assert.deepEqual(seen.pop(), { inputs: [undefined], outputs: ['ambisonic-1'] })
	assert.equal(toBatch(encoder)(x, { layouts: { outputs: ['ambisonic-3'] } }).length, 16, 'third order chosen')
	assert.equal(toBatch(rotate)(chs(9)).length, 9, '9 channels in are second order, and out')
	assert.deepEqual(seen.at(-1), { inputs: ['ambisonic-2'], outputs: ['ambisonic-2'] })
	assert.equal(toBatch(decoder)(chs(4)).length, 2, 'decoder defaults to stereo')
	assert.equal(toBatch(decoder)(chs(4), { layouts: { outputs: ['5.1'] } }).length, 6)
	assert.throws(() => toBatch(decoder)(chs(5)), /5 channels fit none/)
	assert.throws(() => toBatch(decoder)(chs(4), { layouts: { outputs: ['mono'] } }), /not declared/)
	let s = toStream(encoder, { layouts: { outputs: ['ambisonic-2'] } })
	assert.equal(s.write(x).length, 9, 'stream: chosen layout')
	assert.throws(() => toStream(rotate).write(chs(9)), /layouts/, 'stream: a width the default layout misses asks for `layouts`')
	assert.equal(toStream(rotate, { layouts: { inputs: ['ambisonic-2'] } }).write(chs(9)).length, 9)
})

// A width none of a bus's layouts has is refused naming the processor, as the other count errors do ("1 channels" it said,
// and no name): in toBatch and in audio, which resolve the bus by the input's width
test('layouts – a width none of them has: refused naming the processor, "1 channel", "5 channels"', async () => {
	const { default: audio } = await import('../audio.js')
	let x = sine(440, 1024), decoder = Object.assign(layoutAtom(AMBI, SPEAKERS, []), { id: 'ambi-decoder', params: {} })
	let msg = n => `ambi-decoder: inputs bus 0: ${n} channel${n === 1 ? ' fits' : 's fit'} none of its layouts (ambisonic-1, ambisonic-2, ambisonic-3)`
	assert.throws(() => toBatch(decoder)(x), { message: msg(1) }, 'toBatch, 1')
	assert.throws(() => toBatch(decoder)([x, x, x, x, x]), { message: msg(5) }, 'toBatch, 5')
	audio.use(decoder)
	await assert.rejects(audio.from([x], { sampleRate: SR })['ambi-decoder']().read(), { message: msg(1) }, 'audio, 1')
	await assert.rejects(audio.from([x, x], { sampleRate: SR })['ambi-decoder']().read(), { message: msg(2) }, 'audio, 2')
})

// A choice of layouts as a list of tags, the form manifests published before 1.0 carry (@audio/spatial-ambisonic 0.1.0,
// as audio installs it): one bus, as `[{ layouts }]` is
test('layouts – a list of tags, as manifests before 1.0 declare a choice, resolves as one bus { layouts }', () => {
	let x = sine(440, 1024), chs = n => Array.from({ length: n }, () => x), AMBI0 = AMBI[0].layouts, SPEAKERS0 = SPEAKERS[0].layouts
	for (let [inputs, outputs, inputs0, outputs0, n] of [[1, AMBI, 1, AMBI0, 1], [AMBI, AMBI, AMBI0, AMBI0, 9], [AMBI, SPEAKERS, AMBI0, SPEAKERS0, 4]])
		for (let layouts of [undefined, { outputs: [outputs[0].layouts.at(-1)] }]) {
			let seen = [], now = toBatch(layoutAtom(inputs, outputs, seen))(chs(n), { layouts }), then = toBatch(layoutAtom(inputs0, outputs0, seen))(chs(n), { layouts })
			assert.equal(now.length, then.length, `${JSON.stringify(outputs0)} from ${n}, ${JSON.stringify(layouts)}: as many channels`)
			assert.deepEqual(seen[0], seen[1], 'the same ctx.layouts')
		}
})

test('layouts — count declarations keep ctx.layouts undefined and their widths', () => {
	let seen = [], upmix = layoutAtom(2, 6, seen), x = sine(440, 1024)
	assert.equal(toBatch(upmix)([x, x]).length, 6)
	assert.equal(seen.pop(), undefined)
	let any = layoutAtom('any', 'any', seen)
	assert.equal(toBatch(any)([x, x, x]).length, 3)
	assert.equal(toBatch(any)(x).length, 1024, 'a bare channel in, a bare channel out')
	assert.equal(seen.pop(), undefined)
})

// One value rule wherever an atom runs, as a worklet's AudioParam holds a value: a number within [min, max] in every
// host; an enum value it does not declare refused at the call, in every host and in the same words (CONTRACT.md § What
// a host owes, 2: "refuses enum values that are not declared")
function scale (ctx) {
	return (ins, outs, p) => {
		let g = p.gain[0] * (p.sign === 'minus' ? -1 : 1) * (p.on ? 1 : 0.5)
		for (let c = 0; c < outs[0].length; c++) for (let i = 0; i < outs[0][c].length; i++) outs[0][c][i] = ins[0][c][i] * g
	}
}
scale.params = { gain: { type: 'number', min: 0, max: 2, default: 1 }, sign: { type: 'enum', values: ['plus', 'minus'], default: 'plus' }, on: { type: 'bool', default: true } }
test('params: out of range, held as the worklet holds them; an undeclared enum value refused at the call, in every host', async () => {
	const { default: audio } = await import('../audio.js')
	let x = new Float32Array(256).fill(.25), refused = /^TypeError: scale: sign takes 'plus' or 'minus', not 'sideways'$/
	assert.deepEqual([...toBatch(scale)(x, { params: { gain: 5 } })], [...x].map(v => v * 2), 'toBatch: a number held')
	assert.deepEqual([...toStream(scale, { params: { gain: 5 } }).write(x)], [...x].map(v => v * 2), 'toStream: a number held')
	assert.throws(() => toBatch(scale)(x, { params: { gain: 5, sign: 'sideways' } }), refused, 'toBatch: an enum value it does not declare')
	assert.throws(() => toStream(scale, { params: { sign: 'sideways' } }), refused, 'toStream, as it is made')
	assert.throws(() => toStream(scale).write(x, { sign: 'sideways' }), refused, 'toStream, between chunks')
	audio.use(scale)
	let [y] = await audio.from([x], { sampleRate: SR }).scale({ gain: 5 }).read()
	assert.deepEqual([...y], [...x].map(v => v * 2), 'audio.use: a number held')
	assert.throws(() => audio.from([x], { sampleRate: SR }).scale({ gain: 5, sign: 'sideways' }), refused, 'audio.use: an enum value it does not declare')
})

// A value of another kind than its param's, refused by toBatch and toStream as audio refuses it (core.js hostOp settle,
// batch.js accept), at the call; automation where it gives one, at that frame. An enum's or a bool's curve holds each
// point's value to the next (it has nothing between two words to go through)
test('params: a value of another kind refused by toBatch and toStream, as by audio; automation where it gives one', async () => {
	const { default: audio } = await import('../audio.js')
	let x = new Float32Array(256).fill(.25)
	for (let [v, says] of [[[1], 'gain takes a number, not an array'], [true, 'gain takes a number, not true'], [NaN, 'gain takes a number, not NaN'], [new Float32Array(1), 'gain takes a number, not a Float32Array']]) {
		assert.throws(() => toBatch(scale)(x, { params: { gain: v } }), new RegExp(`^TypeError: scale: ${says}$`), `toBatch: gain ${says}`)
		assert.throws(() => toStream(scale).write(x, { gain: v }), new RegExp(`^TypeError: scale: ${says}$`), `toStream: gain ${says}`)
	}
	for (let v of [1, 'false']) {
		let says = new RegExp(`^TypeError: scale: on takes true or false, not ${typeof v === 'string' ? `'${v}'` : v}$`)
		assert.throws(() => toBatch(scale)(x, { params: { on: v } }), says, `toBatch: on ${v}`)
		assert.throws(() => toStream(scale, { params: { on: v } }), says, `toStream: on ${v}`)
	}
	// a function of the time that gives an undeclared value, from 1 ms: refused there, by every host
	let late = t => t >= 0.001 ? 'sideways' : 'plus', refused = /scale: sign takes 'plus' or 'minus', not 'sideways'/
	assert.throws(() => toBatch(scale, { sampleRate: 8000 })(x, { params: { sign: late } }), refused, 'toBatch: a function of the time')
	assert.throws(() => toStream(scale, { sampleRate: 8000, params: { sign: late } }).write(x), refused, 'toStream: a function of the time')
	audio.use(scale)
	await assert.rejects(audio.from([x], { sampleRate: 8000 }).scale({ sign: late }).read(), refused, 'audio: a function of the time')
	assert.throws(() => toBatch(scale, { sampleRate: 8000 })(x, { params: { gain: () => 'loud' } }), /^TypeError: scale: gain takes a number, not 'loud'$/, 'toBatch: a function that gives a word for a number')
	// a curve of words or of booleans holds each to its next point: minus from frame 64 (8 ms at 8 kHz), off from 128
	let y = toBatch(scale, { sampleRate: 8000 })(x, { params: { sign: { t: [0, 0.008], v: ['plus', 'minus'] }, on: { t: [0, 0.016], v: [true, false] } } })
	assert.deepEqual([y[0], y[63], y[64], y[127], y[128]], [0.25, 0.25, -0.25, -0.25, -0.125], 'a curve of words and of booleans, held to the next point')
	assert.throws(() => toBatch(scale, { sampleRate: 8000 })(x, { params: { sign: { t: [0, 0.008], v: ['plus', 'zz'] } } }), /^TypeError: scale: sign takes 'plus' or 'minus', not 'zz'$/, 'a curve to an undeclared value: refused where it gets there')
	// what a host is given in the forms it takes renders as before
	assert.deepEqual([...toBatch(scale)(x, { params: { gain: '1.5', sign: 'minus', on: false } })], [...x].map(v => v * -0.75), 'a numeric word, a declared value, a boolean')
})

test('units: a value written with a unit reaches its param in the unit the param declares, in every host', async () => {
	const { default: audio } = await import('../audio.js')
	// the compressor's attack and release are in ms (unit: 'ms'), the delay's time in s (unit: 's')
	let x = Float32Array.from(sine(440, SR / 4, 0.8), (v, i) => i < SR / 8 ? v / 50 : v)
	let ms = toBatch(amCompressor)(x, { params: { attack: 10, release: 200 } })
	for (let [attack, release] of [['10ms', '200ms'], ['0.01s', '0.2s'], ['10', '200']])
		assert.deepEqual(toBatch(amCompressor)(x, { params: { attack, release } }), ms, `toBatch: attack ${attack}, release ${release}`)
	assert.ok(maxDiff(ms, toBatch(amCompressor)(x, { params: { attack: 0.1, release: 1 } })) > 0.1, 'not the 0.1 ms and 1 ms seconds read as ms were held to')
	let s = toStream(amCompressor, { params: { attack: '10ms', release: '0.2s' } })
	assert.ok(maxDiff(s.write(x), ms) < 1e-6, 'toStream')
	assert.deepEqual(toBatch(amDelay)(x, { params: { time: '250ms' } }), toBatch(amDelay)(x, { params: { time: 0.25 } }), 'delay time 250ms: 0.25 s')
	assert.throws(() => toBatch(amCompressor)(x, { params: { attack: '3db' } }), /compressor: attack takes ms, not '3db'/)
	// a param of no unit, or of one declared empty, takes "a number": the refusal said "takes , not '3x'" for the second
	let plain = Object.assign(() => () => {}, { params: { ratio: { type: 'number', min: 0, max: 4, default: 1 }, beta: { type: 'number', min: 0, max: 4, default: 1, unit: '' } } })
	for (let name of ['ratio', 'beta']) assert.throws(() => toBatch(plain)(x, { params: { [name]: '3x' } }), new RegExp(`^RangeError: processor: ${name} takes a number, not '3x'$`), `${name}: an unknown unit`)
	assert.throws(() => toStream(amCompressor).write(x, { release: '1khz' }), /compressor: release takes ms, not '1khz'/)
	await audio.use('compressor')
	let [y] = await audio.from([x], { sampleRate: SR }).compressor({ attack: '10ms', release: '0.2s' }).read()
	let [z] = await audio.from([x], { sampleRate: SR }).compressor({ attack: 10, release: 200 }).read()
	assert.deepEqual(y, z, 'audio.use: as the numbers in ms')
	assert.throws(() => audio.from([x], { sampleRate: SR }).compressor({ attack: '3db' }), /compressor: attack takes ms, not '3db'/, 'audio: at the call')
})

test('restart: a param read once, as the processor is built, takes one value for a render, in every host', async () => {
	const { default: audio } = await import('../audio.js')
	// the limiter's lookahead is `restart: true`: it sets the latency, which a host takes once (CONTRACT.md, Latency). The
	// delay's time stood here until effect-delay 1.1.0 made it live (flags: ['restart'] before)
	let x = new Float32Array(SR / 2), moving = t => t < 0.25 ? 2 : 8
	assert.throws(() => toBatch(amLimiter)(x, { params: { lookahead: moving } }), /limiter: lookahead is fixed for a render .* not automation/, 'toBatch')
	assert.throws(() => toStream(amLimiter, { params: { lookahead: moving } }), /limiter: lookahead is fixed for a render/, 'toStream')
	let s = toStream(amLimiter, { params: { lookahead: 2 } })
	s.write(x, { lookahead: 2, release: 100 })
	assert.throws(() => s.write(x, { lookahead: 8 }), /limiter: lookahead is fixed for a render .* not a change between chunks/, 'toStream, a change between chunks')
	let over = toStream(amLimiter, { params: { lookahead: 25 } })   // past its max, 20 ms: held there
	assert.doesNotThrow(() => { over.write(x, { lookahead: 25 }); over.write(x, { lookahead: 25 }) }, 'toStream, the same value again, held: no change')
	assert.ok(toBatch(amLimiter)(x, { params: { lookahead: 2, ceiling: t => -t } }), 'a live param still automates')
	// audio: an op that loads at the first render says so there; one loaded, at the call. The tape stop's time, of a
	// family this file has not loaded (the limiter's came whole with the compressor above: a family's entry holds every member)
	let a = audio.from([x], { sampleRate: SR }).tapestop({ time: moving })
	await assert.rejects(a.read(), /tapestop: time is fixed for a render/, 'audio, loaded at the first render')
	await audio.use('tapestop')
	assert.throws(() => audio.from([x], { sampleRate: SR }).tapestop({ time: moving }), /tapestop: time is fixed for a render/, 'audio, at the call')
	assert.throws(() => audio.from([x], { sampleRate: SR }).tapestop({ time: { t: [0, 0.5], v: [2, 8] } }), /tapestop: time is fixed for a render/, 'a curve too')
	assert.throws(() => audio.from([x], { sampleRate: SR }).limiter({ lookahead: moving }), /limiter: lookahead is fixed for a render/, 'a member that came with its family, at the call')
})

test('toStream end() renders a tail declared as a function of ctx, as latency\'s function form is read', () => {
	let params = { time: 0.1, feedback: 0.5, mix: 1 }
	let s = toStream(amDelay, { params, sampleRate: SR }), x = new Float32Array(SR / 10)
	x[0] = 1
	s.write(x)
	let tail = s.end(), seconds = amDelay.tail({ sampleRate: SR, params: { time: [0.1], feedback: [0.5], mix: [1] } })
	assert.ok(seconds > 0.1, `the delay declares ${seconds} s at these settings`)
	assert.equal(tail?.length, Math.round(seconds * SR), 'its frames')
	assert.ok(Math.abs(tail[0]) > 0.4, 'the first echo, 0.1 s after the impulse: the tail\'s first sample')
})

// CONTRACT.md § Latency, tail, whole signals, as amended: a latency, tail or frames function is handed `transport`, as
// ctx.transport is where the host asks, of the `transport` option (none: 120 bpm, 4/4, standing still): a tail's where
// the input ends, a latency's and frames' where the instance is built. A tail of one beat is 0.5 s at 120 bpm and 0.667
// s at 90; a tail of the values alone (the published delay's) as before
test('toStream and toBatch hand a latency, a tail and frames the transport: one beat of tail at 120 and at 90 bpm', () => {
	let seen = [], x = sine(440, SR)
	let pass = () => (ins, outs) => { for (let c = 0; c < outs[0].length; c++) outs[0][c].set(ins[0][c]) }
	let beat = Object.assign((...a) => pass(...a), { id: 'beat', params: {}, channels: 'any', tail: at => (seen.push(['tail', at.transport]), 60 / at.transport.bpm), latency: at => (seen.push(['latency', at.transport]), 0) })
	let longer = Object.assign(() => (ins, outs) => outs[0][0].set(ins[0][0]), { id: 'beat-frames', params: {}, channels: 'any', streaming: false, frames: (n, at) => (seen.push(['frames', at.transport]), n + Math.round(60 / at.transport.bpm * SR)) })
	for (let [bpm, timeSig] of [[120, [3, 4]], [90, [6, 8]], []]) {
		// the transport at frame f: where two chunks of 1 s end, 4 beats at 120 bpm (3/4's first bar, 3 quarters, past), 3
		// at 90 (6/8's, 3 quarters, ended): barStart 3 in both
		let bar = bpm && timeSig[0] * 4 / timeSig[1], beats = f => f * bpm / (60 * SR)
		let at = f => bpm ? { playing: true, bpm, beat: beats(f), barStart: Math.floor(beats(f) / bar) * bar, timeSig } : { playing: false, bpm: 120, beat: 0, barStart: 0, timeSig: [4, 4] }
		let want = Math.round(60 / (bpm ?? 120) * SR), label = bpm ? `${bpm} bpm, ${timeSig.join('/')}` : 'no tempo', transport = bpm && { bpm, timeSig }
		if (bpm) assert.equal(at(2 * SR).barStart, 3, `${label}: the input ends past a bar line`)
		seen = []
		let s = toStream(beat, { transport })
		s.write(x); s.write(x)
		assert.equal(s.end()?.length, want, `toStream, ${label}: a tail of one beat, ${want} frames`)
		assert.deepEqual(seen, [['latency', at(0)], ['tail', at(2 * SR)]], `toStream, ${label}: its latency handed the transport as it is built, its tail where the input ends`)
		seen = []
		assert.equal(toBatch(longer, { transport })(x).length, SR + want, `toBatch, ${label}: frames of one beat more`)
		assert.deepEqual(seen, [['frames', at(0)]], `toBatch, ${label}: frames handed the transport as it is built`)
		let d = toStream(amDelay, { params: { time: 0.1, feedback: 0.5, mix: 1 }, transport })
		d.write(x)
		assert.equal(d.end()?.length, Math.round(amDelay.tail({ sampleRate: SR, params: { time: [0.1], feedback: [0.5], mix: [1] } }) * SR), `toStream, ${label}: the published delay's tail, of its values alone, as before`)
	}
})
