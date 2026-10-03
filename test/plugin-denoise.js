// Contract atoms as audio ops — denoise family (@audio/denoise-*).
// Mirrors test/module-ops.js's header/import/wave style. Verifies restoration kernels
// wrapped per @audio/atom CONTRACT host correctly through audio.use()/read(): live
// per-block params for causal kernels, whole-render for streaming:false kernels.
//
// Not yet published to npm — import via the sibling @audio/denoise checkout;
// switch to '@audio/denoise-<atom>/audio' after next publish.

import test, { ok, almost, is } from 'tst'
import { noise } from './gen.js'
import audio from '../audio.js'
import raw from 'audio-lena/raw'

const SR = 44100
let lena = new Float32Array(raw)                          // 12.27s mono speech

// --- generators / metrics (mirrors module-ops.js + @audio/denoise's own test.js) ---
function rms(d, from = 0, to = d.length) { let s = 0; for (let i = from; i < to; i++) s += d[i] * d[i]; return Math.sqrt(s / (to - from)) }
function peak(d, from = 0, to = d.length) { let p = 0; for (let i = from; i < to; i++) { let a = Math.abs(d[i]); if (a > p) p = a } return p }
function mix(speech, noiseArr, snrDb) {
	let target = rms(speech) / 10 ** (snrDb / 20), scale = target / Math.max(rms(noiseArr), 1e-30)
	let d = new Float32Array(speech.length)
	for (let i = 0; i < d.length; i++) d[i] = speech[i] + noiseArr[i] * scale
	return d
}
// Segmental SNR — frame-averaged, clamped to [-10, 35] dB (matches @audio/denoise-core's segSnr)
function segSnr(clean, denoised, N = 512, hop = 256) {
	let n = Math.min(clean.length, denoised.length), sum = 0, frames = 0
	for (let pos = 0; pos + N <= n; pos += hop) {
		let s = 0, e = 0
		for (let i = 0; i < N; i++) { let c = clean[pos + i], d = c - denoised[pos + i]; s += c * c; e += d * d }
		if (s < 1e-5 * N) continue
		sum += Math.max(-10, Math.min(35, 10 * Math.log10(s / Math.max(e, 1e-30)))); frames++
	}
	return frames ? sum / frames : 0
}
// Goertzel narrowband magnitude at f Hz (mirrors module-ops.js's energyAt / denoise's narrowEnergy)
function narrowEnergy(d, f) {
	let w = 2 * Math.PI * f / SR, c = 2 * Math.cos(w), s1 = 0, s2 = 0
	for (let i = 0; i < d.length; i++) { let s = d[i] + c * s1 - s2; s2 = s1; s1 = s }
	return 2 * Math.sqrt(Math.max(0, s1 * s1 + s2 * s2 - c * s1 * s2)) / d.length
}
function convolve(x, h) {
	let y = new Float32Array(x.length)
	for (let i = 0; i < x.length; i++) { let s = 0; for (let j = 0; j < h.length && j <= i; j++) s += x[i - j] * h[j]; y[i] = s }
	return y
}

// ── Wave: STFT statistical denoisers (specsub, wiener, omlsa, dereverb) ──────
// All four are causal/streaming: noise PSD (or, for dereverb, the late-tail model) is
// tracked online, no manual profile argument needed — see each package's audio.js
// header for why. All declare a fixed latency (STFT analysis/synthesis buffering); .read()
// applies plugin-delay-compensation transparently, so output compares directly against
// the un-shifted reference at the same sample index (verified: cross-correlation of
// output against the dry reference peaks at zero shift, not at the raw kernel latency).

import { specsub } from '@audio/denoise-spectral/audio'
import { wiener } from '@audio/denoise-wiener/audio'
import { omlsa } from '@audio/denoise-omlsa/audio'
import { dereverb } from '@audio/denoise-dereverb/audio'
audio.use(specsub, wiener, omlsa, dereverb)

test('specsub: raises segSNR of noisy speech, latency-compensated by the engine', async () => {
	let speech = lena.subarray(0, SR * 4)
	let dirty = mix(speech, noise(speech.length), 5)
	let out = (await audio.from([dirty.slice()], { sampleRate: SR }).specsub().read())[0]
	is(out.length, dirty.length, 'length preserved (latency compensated)')
	ok(out.every(isFinite))
	let before = segSnr(speech, dirty), after = segSnr(speech, out)
	ok(after > before + 0.5, `defining property: segSNR raised (${before.toFixed(2)} -> ${after.toFixed(2)} dB)`)
})

test('wiener: raises segSNR of noisy speech (mmse-lsa default rule)', async () => {
	let speech = lena.subarray(0, SR * 4)
	let dirty = mix(speech, noise(speech.length), 5)
	let out = (await audio.from([dirty.slice()], { sampleRate: SR }).wiener().read())[0]
	is(out.length, dirty.length, 'length preserved (latency compensated)')
	ok(out.every(isFinite))
	let before = segSnr(speech, dirty), after = segSnr(speech, out)
	ok(after > before + 1, `defining property: segSNR raised (${before.toFixed(2)} -> ${after.toFixed(2)} dB)`)
})

test('omlsa: raises segSNR of noisy speech (IMCRA, non-stationary noise tracking)', async () => {
	let speech = lena.subarray(0, SR * 4)
	let dirty = mix(speech, noise(speech.length), 5)
	let out = (await audio.from([dirty.slice()], { sampleRate: SR }).omlsa().read())[0]
	is(out.length, dirty.length, 'length preserved (latency compensated)')
	ok(out.every(isFinite))
	let before = segSnr(speech, dirty), after = segSnr(speech, out)
	ok(after > before + 0.5, `defining property: segSNR raised (${before.toFixed(2)} -> ${after.toFixed(2)} dB)`)
})

test('dereverb: reduces late-tail energy, never boosts it', async () => {
	let speech = lena.subarray(0, SR * 2)
	let t60 = 0.5
	let imp = new Float32Array(4096)
	for (let i = 0; i < imp.length; i++) imp[i] = (Math.random() * 2 - 1) * Math.exp(-6.9 * i / (t60 * SR))
	imp[0] = 1  // direct path
	let rev = convolve(speech, imp)
	let out = (await audio.from([rev.slice()], { sampleRate: SR }).dereverb({ t60 }).read())[0]
	is(out.length, rev.length, 'length preserved (latency compensated)')
	ok(out.every(isFinite))
	let rmsRev = rms(rev), rmsOut = rms(out)
	ok(rmsOut <= rmsRev * 1.1, `tail not boosted (${rmsRev.toFixed(4)} -> ${rmsOut.toFixed(4)})`)
	ok(rmsOut < rmsRev * 0.98, `defining property: tail energy reduced (${rmsRev.toFixed(4)} -> ${rmsOut.toFixed(4)})`)
})

// ── Wave: causal kernels (gate, deplosive, dewind) ──────────────────────────
// deplosive/dewind persist per-sample/per-block state on a plain object across
// process() calls (same state-per-channel pattern as @audio/denoise-dehum); gate is
// the dynamics stream kernel (denoise-gate merged into @audio/dynamics-gate 2026-07)
// hosted with its function-form `latency` (lookahead ms → samples) compensated.

import { gate } from '@audio/dynamics-gate/audio'
import { deplosive } from '@audio/denoise-deplosive/audio'
import { dewind } from '@audio/denoise-dewind/audio'
audio.use(gate, deplosive, dewind)

test('gate: passes signal, silences the floor (look-ahead hysteresis)', async () => {
	let n = SR, ch = new Float32Array(n)
	for (let i = 0; i < n / 2; i++) ch[i] = 0.5 * Math.sin(2 * Math.PI * 440 * i / SR)
	for (let i = n / 2; i < n; i++) ch[i] = 0.003 * Math.sin(2 * Math.PI * 440 * i / SR)
	let out = (await audio.from([ch], { sampleRate: SR }).gate({ threshold: -40, range: -90, lookahead: 5 }).read())[0]
	is(out.length, n, 'length preserved (function-form latency compensated)')
	ok(rms(out, SR * 0.1, SR * 0.4) > 0.3, 'signal above threshold passes')
	ok(rms(out, SR * 0.8) < 0.0005, `defining property: floor silenced (${rms(out, SR * 0.8).toExponential(1)})`)
})

test('deplosive: ducks an LF burst, leaves surrounding speech alone', async () => {
	let speech = lena.subarray(0, SR * 2)
	let dirty = new Float32Array(speech)
	// close-mic 'p'/'b' pop: broadband decay discontinuity, dwarfing the speech peaks
	let blen = Math.round(0.05 * SR), bstart = Math.round(SR * 0.3)
	for (let i = 0; i < blen; i++) dirty[bstart + i] += 2.5 * Math.exp(-i / (blen / 2))
	let out = (await audio.from([dirty.slice()], { sampleRate: SR }).deplosive().read())[0]
	is(out.length, dirty.length, 'length preserved')
	ok(out.every(isFinite))
	let burstBefore = rms(dirty, bstart, bstart + blen), burstAfter = rms(out, bstart, bstart + blen)
	let quietBefore = rms(dirty, 0, bstart), quietAfter = rms(out, 0, bstart)
	// 0.75: the exact-complement deplosive (>=0.1.3) ducks less deeply than the old crossover but adds no coloration
	ok(burstAfter < burstBefore * 0.75, `defining property: LF burst ducked (${burstBefore.toFixed(4)} -> ${burstAfter.toFixed(4)})`)
	ok(Math.abs(quietAfter - quietBefore) < quietBefore * 0.15, 'speech well outside the burst left mostly alone')
})

test('dewind: cuts LF rumble >=3x, adaptive high-pass', async () => {
	let speech = lena.subarray(0, SR * 2)
	let dirty = new Float32Array(speech.length)
	for (let i = 0; i < dirty.length; i++) dirty[i] = speech[i] + 0.4 * Math.sin(2 * Math.PI * 40 * i / SR)
	let out = (await audio.from([dirty.slice()], { sampleRate: SR }).dewind().read())[0]
	is(out.length, dirty.length, 'length preserved')
	ok(out.every(isFinite))
	let before = narrowEnergy(dirty, 40), after = narrowEnergy(out, 40)
	ok(after < before * 0.3, `defining property: rumble cut >=3x (${before.toExponential(2)} -> ${after.toExponential(2)})`)
})


// ════════════════════════════════════════════════════════════════════════════
// Whole-render (streaming: false) modules — declick, declip, decrackle, debreath.
// Each needs the entire signal in one process() call (AR reconstruction using both
// left AND right context, or a global VAD floor over the full buffer) — see each
// package's audio.js header for the specific reason. The host's whole-render
// hosting (core.js useAtom's `m.streaming === false` branch + plan.js's `op.whole`
// materialize-then-process-once path) is the engine capability this integration
// exercises; it was built concurrently with this task and might not have existed yet.
//
// Verified directly: audio.use(<these 4>) + op().read() does NOT error and does NOT
// fall back to per-block dispatch — output length matches input, and the same defining
// properties measured against the raw kernel/factory (see this file's sibling scratch
// verification) reproduce bit-for-bit through the real engine. So these run as full
// property assertions, not tolerant placeholders — nothing here is pending.
// ════════════════════════════════════════════════════════════════════════════

import { declick } from '@audio/denoise-declick/audio'
import { declip } from '@audio/denoise-declip/audio'
import { decrackle } from '@audio/denoise-decrackle/audio'
import { debreath } from '@audio/denoise-debreath/audio'
audio.use(declick, declip, decrackle, debreath)

test('declick (streaming:false): removes an inserted click, leaves clean speech alone', async () => {
	let speech = lena.subarray(0, SR * 2)
	let dirty = new Float32Array(speech)
	for (let k = 0; k < 8; k++) dirty[Math.floor((k + 1) * dirty.length / 9)] += (k & 1 ? -1 : 1) * 0.9
	let out = (await audio.from([dirty.slice()], { sampleRate: SR }).declick().read())[0]
	is(out.length, dirty.length, 'equal frames in/out (whole buffer)')
	ok(out.every(isFinite))
	let peakDirty = peak(dirty), peakClean = peak(out)
	ok(peakClean < peakDirty * 0.9, `defining property: click peak reduced (${peakDirty.toFixed(3)} -> ${peakClean.toFixed(3)})`)

	let clean = (await audio.from([speech.slice()], { sampleRate: SR }).declick({ threshold: 6 }).read())[0]
	let err = 0
	for (let i = 0; i < speech.length; i++) err += (clean[i] - speech[i]) ** 2
	ok(Math.sqrt(err / speech.length) < 0.01, 'clean speech left largely untouched at conservative threshold')
})

test('declip (streaming:false): reconstructs a clipped sine closer to the unclipped reference', async () => {
	let n = SR / 10                                 // 44 cycles: 88 runs to restore
	let clean = new Float32Array(n)
	for (let i = 0; i < n; i++) clean[i] = Math.sin(2 * Math.PI * 440 * i / SR)
	let clipLevel = 0.85                          // ~10-sample clipped run per half-cycle
	let clipped = new Float32Array(n)
	for (let i = 0; i < n; i++) clipped[i] = Math.max(-clipLevel, Math.min(clipLevel, clean[i]))
	let out = (await audio.from([clipped.slice()], { sampleRate: SR }).declip({ clipLevel }).read())[0]
	is(out.length, n, 'equal frames in/out (whole buffer)')
	ok(out.every(isFinite))
	ok(peak(out) > clipLevel + 0.02, `peak restored above the clip rail (${peak(out).toFixed(3)})`)
	let mse = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += (a[i] - b[i]) ** 2; return s / a.length }
	let errBefore = mse(clean, clipped), errAfter = mse(clean, out)
	ok(errAfter < errBefore, `defining property: closer to the clean reference (MSE ${errBefore.toExponential(2)} -> ${errAfter.toExponential(2)})`)
})

test('decrackle (streaming:false): reduces a high-rate impulse shower', async () => {
	let speech = lena.subarray(0, SR * 2)
	let dirty = new Float32Array(speech)
	for (let i = 0; i < dirty.length; i += 256) dirty[i] += (i & 1 ? -1 : 1) * 0.4
	let out = (await audio.from([dirty.slice()], { sampleRate: SR }).decrackle().read())[0]
	is(out.length, dirty.length, 'equal frames in/out (whole buffer)')
	ok(out.every(isFinite))
	let peakDirty = peak(dirty), peakClean = peak(out)
	ok(peakClean < peakDirty, `defining property: impulse shower peaks reduced (${peakDirty.toFixed(3)} -> ${peakClean.toFixed(3)})`)
})

test('debreath (streaming:false): attenuates the VAD-inactive region, preserves speech', async () => {
	let speechPart = lena.subarray(0, Math.round(1.5 * SR))
	let breathPart = new Float32Array(Math.round(1.5 * SR))
	for (let i = 0; i < breathPart.length; i++) breathPart[i] = 0.02 * (Math.random() * 2 - 1)
	let dirty = new Float32Array(speechPart.length + breathPart.length)
	dirty.set(speechPart, 0); dirty.set(breathPart, speechPart.length)
	let out = (await audio.from([dirty.slice()], { sampleRate: SR }).debreath().read())[0]
	is(out.length, dirty.length, 'equal frames in/out (whole buffer)')
	ok(out.every(isFinite))
	let speechBefore = rms(dirty, 0, speechPart.length), speechAfter = rms(out, 0, speechPart.length)
	let breathBefore = rms(dirty, speechPart.length + 4096), breathAfter = rms(out, speechPart.length + 4096)
	ok(speechAfter > speechBefore * 0.85, 'active speech region largely preserved')
	ok(breathAfter < breathBefore * 0.6, `defining property: inactive/breath region attenuated (${breathBefore.toFixed(4)} -> ${breathAfter.toFixed(4)})`)
})

test('whole-render op on a file source waits decode out (was: 0 samples / save crash)', async () => {
	let out = (await audio('test/fixture.wav').declick().read())
	ok(out[0].length > 40000, `read renders the full timeline (${out[0].length})`)
	let a = audio('test/fixture.wav')
	a.wiener().declick()
	let bytes = await a.read({ format: 'wav' })
	ok(bytes.length > 40000, `streaming→whole chain renders through save/encode path (${bytes.length}B)`)
})


// ════════════════════════════════════════════════════════════════════════════
// Neural: rnnoise (registry op: the package's contract atom, streaming) and deepfilter (built-in op:
// the whole input before rendering, through the prepare hook), both from the optional
// @audio/neural-denoise. RNNoise's weights ship in the package, so its tests run wherever the package
// is installed; DeepFilterNet3's run once its model is in the neural cache, so the suite never
// downloads. Floor and speech level as the package's README measures real rooms: RMS of the quietest
// 500 ms (here the pause), power of the loudest half of 50 ms frames.
// ════════════════════════════════════════════════════════════════════════════

import { existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import os from 'node:os'
import path from 'node:path'

const neural = await import('@audio/neural-denoise').catch(() => null)
// the package's resampler, whose arithmetic the rnnoise atom streams
const sinc = neural && await import('@audio/resample-sinc').then(m => m.default, () => null)
const HAS_DFN = !!neural && existsSync(path.join(process.env.AUDIO_NEURAL_CACHE || path.join(os.homedir(), '.cache', 'audiojs', 'neural'), createHash('sha256').update(neural.MODEL).digest('hex')))
const NEURAL_RUN = { timeout: 180000 }  // model runs, on a busy machine
const withImport = async (stub, fn) => { let orig = audio.import; audio.import = spec => stub(spec, orig); try { return await fn() } finally { audio.import = orig } }
const maxDiff = (a, b) => { let m = 0; for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i] - b[i])); return m }

// speech, a second's pause, speech; white noise throughout, `snr` dB under the speech
function take(snr = 15) {
	let clean = new Float32Array(5 * SR)
	clean.set(lena.subarray(0, 2 * SR)); clean.set(lena.subarray(2 * SR, 4 * SR), 3 * SR)
	let n = noise(clean.length, 1, 7), k = rms(clean) / 10 ** (snr / 20) / rms(n)
	return { clean, dirty: clean.map((v, i) => v + n[i] * k) }
}
const floorDb = d => 20 * Math.log10(rms(d, Math.round(2.25 * SR), Math.round(2.75 * SR)))
function speechDb(d) {
	let F = Math.round(0.05 * SR), p = []
	for (let i = 0; i + F <= d.length; i += F) p.push(rms(d, i, i + F) ** 2)
	p.sort((a, b) => b - a); p.length >>= 1
	return 10 * Math.log10(p.reduce((a, b) => a + b) / p.length)
}

test('rnnoise, deepfilter: without @audio/neural-denoise each names the package, and wiener still runs', async () => {
	let loaded = audio.op('rnnoise')
	delete audio.op().rnnoise   // as if never loaded
	try {
		await withImport((spec, orig) => spec.startsWith('@audio/neural-denoise') ? Promise.reject(new Error(`Cannot find package '${spec}'`)) : orig(spec), async () => {
			let a = () => audio.from([lena.slice(0, SR)], { sampleRate: SR })
			let err = await a().rnnoise().read().catch(e => e)
			ok(/install @audio\/neural-denoise/.test(err?.message), err?.message)
			err = await a().deepfilter().read().catch(e => e)
			ok(/^deepfilter: install @audio\/neural-denoise/.test(err?.message), err?.message)
			is((await a().wiener().read())[0].length, SR, 'the classical denoisers need no neural package')
		})
	} finally { if (loaded) audio.op('rnnoise', loaded) }
})

;(neural ? test : test.skip)('rnnoise: the noise floor drops by the limit and no further, speech keeps its level', NEURAL_RUN, async () => {
	let { clean, dirty } = take()
	// 20 dB by default: unlimited, the model removes the voice on 12 of 824 VoiceBank files (package README)
	for (let [limit, lo, hi] of [[null, 18, 20.5], [10, 8, 10.5], [0, 40, Infinity]]) {
		let a = audio.from([dirty], { sampleRate: SR }), [y] = await (limit == null ? a.rnnoise() : a.rnnoise(limit)).read()
		is(y.length, dirty.length, 'length kept')
		let drop = floorDb(dirty) - floorDb(y), speech = speechDb(y) - speechDb(clean)
		ok(drop > lo && drop < hi, `limit ${limit ?? '20 (default)'}: floor down ${drop.toFixed(1)} dB`)
		ok(Math.abs(speech) < 1.5, `speech ${speech.toFixed(2)} dB from the clean take`)
	}
})

;(neural ? test : test.skip)('rnnoise: at 48 kHz denoise() sample for sample, its 1439 samples of latency declared and compensated', NEURAL_RUN, async () => {
	let x = take().dirty.subarray(0, 3 * SR)   // read as 48 kHz
	let [y] = await audio.from([x], { sampleRate: 48000 }).rnnoise().read()
	is(audio.op('rnnoise').latency({}, 48000), 1439, '960 (RNNoise) + 479 (the frame queue)')
	is(maxDiff(y, await neural.default(x, { sampleRate: 48000, limit: 20 })), 0, 'equal to the package offline')
})

;(neural && sinc ? test : test.skip)('rnnoise: at 44.1 kHz, resample-sinc in and out as denoise() does, streamed; channels apart', NEURAL_RUN, async () => {
	let { clean, dirty } = take(), a = audio.from([dirty], { sampleRate: SR }).rnnoise()
	let [y] = await a.read()
	is(audio.op('rnnoise').latency({}, SR), 1354, '30.7 ms')
	// a stream can't see its end as the offline resampler does: the last 50 ms may differ
	let want = sinc(await neural.default(sinc(dirty, { from: SR, to: 48000 }), { sampleRate: 48000, limit: 20 }), { from: 48000, to: SR })
	let n = dirty.length - Math.round(0.05 * SR)
	is(maxDiff(y.subarray(0, n), want.subarray(0, n)), 0, 'resample-sinc → denoise() → resample-sinc, sample for sample')
	let parts = [], m = 0
	for await (let b of a.stream()) { parts.push(b[0].slice()); m += b[0].length }
	let s = new Float32Array(m); parts.reduce((o, p) => (s.set(p, o), o + p.length), 0)
	is(maxDiff(s, y), 0, 'stream() = read()')
	let [l, r] = await audio.from([dirty, clean], { sampleRate: SR }).rnnoise().read()
	is(maxDiff(l, y), 0, 'a channel is denoised on its own')
	ok(maxDiff(r, y) > 0.01, 'the other one too')
})

;(neural ? test : test.skip)('deepfilter: a model it cannot load names where it looked; limit is dB', async () => {
	let a = () => audio.from([lena.slice(0, SR)], { sampleRate: SR })
	let err = await a().deepfilter({ weights: 'file:///nonexistent/DeepFilterNet3_onnx.tar.gz' }).read().catch(e => e)
	ok(/^deepfilter: can't load DeepFilterNet3 from file:\/\/\/nonexistent\//.test(err?.message), err?.message)
	err = await a().deepfilter(-3).read().catch(e => e)
	ok(/^deepfilter: limit is dB/.test(err?.message), err?.message)
	err = await a().deepfilter({ floor: 6 }).read().catch(e => e)
	ok(/^deepfilter: floor is dB under the voice/.test(err?.message), err?.message)
})

;(HAS_DFN ? test : test.skip)('deepfilter: the package on the op input, unlimited, the input mixed back at the limit; its channel only, once', NEURAL_RUN, async () => {
	let { clean, dirty } = take(), calls = 0
	await withImport((spec, orig) => spec === '@audio/neural-denoise' ? orig(spec).then(m => ({ ...m, default: (...a) => (calls++, m.default(...a)) })) : orig(spec), async () => {
		let [input] = await audio.from([dirty], { sampleRate: SR }).gain(-6).read(), [ref] = await audio.from([clean], { sampleRate: SR }).gain(-6).read()
		let [y] = await neural.default([input], { sampleRate: SR, model: 'deepfilternet3', limit: 0 }), g = 10 ** (-12 / 20)
		calls = 0
		let a = audio.from([dirty, dirty], { sampleRate: SR }).gain(-6).deepfilter({ channel: 1, floor: false })
		let [l, r] = await a.read()
		is(maxDiff(r, y.map((v, i) => (1 - g) * v + g * input[i])), 0, 'the package on the edits before it, 12 dB limit')
		is(maxDiff(l, input), 0, 'channel 0 untouched')
		a.gain(1); await a.read()
		is(calls, 1, 'enhanced once: re-reads and later edits reuse it')
		let drop = floorDb(input) - floorDb(r), speech = speechDb(r) - speechDb(ref)
		ok(drop > 10 && drop < 12.5, `floor: false: noise down ${drop.toFixed(1)} dB, room tone kept`)
		ok(Math.abs(speech) < 1.5, `speech ${speech.toFixed(2)} dB from the clean take`)
		let [none] = await audio.from([input], { sampleRate: SR }).deepfilter(0).read()
		is(maxDiff(none, y), 0, 'limit 0: the package unlimited')
	})
})

// floor: the noise 45 dB under the voice's loudness by default, never less than the limit's 12 dB down
;(HAS_DFN ? test : test.skip)('deepfilter: noisy speech loses its noise to 45 dB under the voice, quiet speech the limit\'s 12 dB', NEURAL_RUN, async () => {
	let { clean, dirty } = take(15), L = await audio.from([dirty], { sampleRate: SR }).stat('loudness')
	let [y] = await audio.from([dirty], { sampleRate: SR }).deepfilter().read()
	let under = floorDb(y) - L, speech = speechDb(y) - speechDb(clean)
	ok(under < -40 && under > -48, `noise 15 dB under: the pause ${-under.toFixed(1)} dB under the voice (${(floorDb(dirty) - floorDb(y)).toFixed(1)} dB down)`)
	ok(Math.abs(speech) < 1.5, `speech ${speech.toFixed(2)} dB from the clean take`)
	let [z] = await audio.from([dirty], { sampleRate: SR }).deepfilter(12, -35).read()
	ok(Math.abs(floorDb(z) - L + 35) < 3, `floor -35: the pause ${(L - floorDb(z)).toFixed(1)} dB under the voice`)
	let quiet = take(55).dirty
	let [q] = await audio.from([quiet], { sampleRate: SR }).deepfilter().read()
	let [f] = await audio.from([quiet], { sampleRate: SR }).deepfilter({ floor: false }).read()
	is(maxDiff(q, f), 0, 'noise 55 dB under: the 12 dB limit, room tone kept')
})


// ════════════════════════════════════════════════════════════════════════════
// denoise (built-in op, fn/denoise.js): the noise learned where it plays alone, a range of the op's input, then
// taken `reduction` dB down everywhere by @audio/denoise-omlsa on that held noise. take()'s pause, 2 to 3 s, is the
// noise alone: learned from its first 0.4 s, measured on the rest.
// ════════════════════════════════════════════════════════════════════════════

const PAUSE = { at: 2.05, duration: 0.4 }, rest = d => 20 * Math.log10(rms(d, Math.round(2.5 * SR), Math.round(2.95 * SR)))
const learned = o => o[Object.getOwnPropertySymbols(o).find(s => s.description === 'denoise.learned')]

test('denoise: the noise learned from its range goes down by the reduction, the speech keeps its level', async () => {
	let { clean, dirty } = take(15)
	for (let [red, args] of [[12, []], [20, [20]]]) {
		let [y] = await audio.from([dirty], { sampleRate: SR }).denoise(...args, { noise: PAUSE }).read()
		is(y.length, dirty.length, 'length kept: the frame − 1 samples of latency compensated')
		let down = rest(dirty) - rest(y), speech = speechDb(y) - speechDb(clean)
		ok(Math.abs(down - red) < 0.3, `reduction ${red}: the rest of the pause ${down.toFixed(2)} dB down`)
		ok(Math.abs(speech) < 1, `reduction ${red}: speech ${speech.toFixed(2)} dB from the clean take`)
		ok(segSnr(clean, y) > segSnr(clean, dirty) + 3, `reduction ${red}: segSNR ${segSnr(clean, dirty).toFixed(1)} → ${segSnr(clean, y).toFixed(1)} dB`)
	}
	let [z] = await audio.from([dirty], { sampleRate: SR }).denoise(0, { noise: PAUSE }).read()
	ok(maxDiff(z, dirty) < 1e-6, 'reduction 0: the input as it is')
	// learned where the voice speaks, the "noise" is the voice: what is quieter than its average goes with it
	let [w] = await audio.from([dirty], { sampleRate: SR }).denoise({ noise: { at: 0.5, duration: 1 } }).read()
	ok(speechDb(w) < speechDb(clean) - 1.5, `learned from speech: the speech ${(speechDb(clean) - speechDb(w)).toFixed(1)} dB down`)
})

test('denoise: the range is in the op\'s input: it follows the edits before it', async () => {
	let { dirty } = take(15)
	// a second removed from the start: 1.05 s in what is left is the pause's 2.05 s
	let [a] = await audio.from([dirty], { sampleRate: SR }).remove({ at: 0, duration: 1 }).denoise({ noise: { at: 1.05, duration: 0.4 } }).read()
	let [b] = await audio.from([dirty.slice(SR)], { sampleRate: SR }).denoise({ noise: { at: 1.05, duration: 0.4 } }).read()
	is(maxDiff(a, b), 0, 'remove, then denoise: as denoise of what is left')
	let [c] = await audio.from([dirty], { sampleRate: SR }).denoise({ noise: { at: 1.05, duration: 0.4 } }).read()
	ok(maxDiff(a, c.subarray(SR)) > 0.01, 'not the source\'s 1.05 s, which is speech')
})

test('denoise: the print stays on the edit: re-reads and later edits reuse it, a changed range or input learns again', async () => {
	let { dirty } = take(15), a = audio.from([dirty], { sampleRate: SR }).gain(0).denoise({ noise: PAUSE })
	let [y] = await a.read(), o = a.edits[1][1], first = learned(o)
	ok(first?.prints?.[0]?.length === 1025, 'learned: one print for the one channel')
	await a.read()
	is(learned(o), first, 're-read: the same print')
	a.gain(-1); await a.read()
	is(learned(o), first, 'a later edit: the same print')
	a.undo()
	o.noise = { at: 2.5, duration: 0.4 }; a.version++
	let [y2] = await a.read()
	ok(learned(o) !== first && maxDiff(y, y2) > 0, 'a changed range: learned again')
	let second = learned(o)
	a.edits[0][1].value = -6; a.version++
	let [y3] = await a.read()
	ok(learned(o) !== second, 'a changed input (the gain before it): learned again')
	ok(Math.abs(learned(o).prints[0][100] - second.prints[0][100] + 6) < 0.02, `the print 6 dB lower with it (${(learned(o).prints[0][100] - second.prints[0][100]).toFixed(2)} dB)`)
	let g = 10 ** (6 / 20), top = y2.reduce((m, v) => Math.max(m, Math.abs(v)), 0)
	ok(maxDiff(y3.map(v => v * g), y2) < 1e-3 * top, 'and the output its 6 dB quieter self')
})

test('denoise: read() equals stream(); a live source renders once the range has arrived, as the whole file does', async () => {
	let { dirty } = take(15), chain = a => a.highpass(60).denoise({ noise: PAUSE })
	let [ref] = await chain(audio.from([dirty], { sampleRate: SR })).read()
	let parts = []
	for await (let b of chain(audio.from([dirty], { sampleRate: SR })).stream()) parts.push(b[0].slice())
	let s = new Float32Array(parts.reduce((n, p) => n + p.length, 0)); parts.reduce((o, p) => (s.set(p, o), o + p.length), 0)
	is(maxDiff(s, ref), 0, 'stream() = read()')
	let src = audio(null, { sampleRate: SR, channels: 1 }), out = [], first = null, pushed = 0, C = 4410
	chain(src)
	let reader = (async () => { for await (let b of src.stream()) { if (first == null && b[0].length) first = pushed; out.push(b[0].slice()) } })()
	for (let o = 0; o < dirty.length; o += C) { src.push(dirty.slice(o, o + C)); pushed += Math.min(C, dirty.length - o); await new Promise(r => setTimeout(r, 1)) }
	src.stop(); await reader
	let live = new Float32Array(out.reduce((n, p) => n + p.length, 0)); out.reduce((o, p) => (live.set(p, o), o + p.length), 0)
	is(maxDiff(live, ref), 0, 'live ≡ the whole file')
	let end = PAUSE.at + PAUSE.duration
	ok(first / SR <= end + 0.2, `first output after ${(first / SR).toFixed(2)} s of input: the range ends at ${end.toFixed(2)} s`)
})

test('denoise: a print, from stat(\'print\') or pasted as numbers, renders as its range does', async () => {
	let { dirty } = take(15), a = () => audio.from([dirty], { sampleRate: SR })
	let print = await a().stat('print', PAUSE)
	is(print.length, 1025, '1025 bands, 0 to 24 kHz')
	let [x] = await a().denoise({ noise: PAUSE }).read(), [y] = await a().denoise({ noise: print }).read()
	is(maxDiff(x, y), 0, 'the print renders as the range')
	let [z] = await a().denoise({ noise: JSON.parse(JSON.stringify(print)) }).read()
	is(maxDiff(x, z), 0, 'through JSON: the same')
	// white noise of RMS 0.01 prints −40 in every band (at 48 kHz; 10 log10(48000/fs) higher at fs)
	let w = await audio.from([noise(2 * 48000, 0.01 * Math.sqrt(3), 5)], { sampleRate: 48000 }).stat('print')
	let m = w.slice(40, 1000).reduce((s, v) => s + v, 0) / 960
	ok(Math.abs(m + 40) < 0.3, `white noise of RMS 0.01: ${m.toFixed(2)} dB per band`)
})

test('denoise: each channel learns its own noise; the op\'s range leaves the rest as it is', async () => {
	let { dirty } = take(15), n = noise(dirty.length, 0.05, 11), loud = dirty.map((v, i) => v + n[i])
	let [l, r] = await audio.from([dirty, loud], { sampleRate: SR }).denoise({ noise: PAUSE }).read()
	let [l1] = await audio.from([dirty], { sampleRate: SR }).denoise({ noise: PAUSE }).read()
	let [r1] = await audio.from([loud], { sampleRate: SR }).denoise({ noise: PAUSE }).read()
	is(maxDiff(l, l1), 0, 'left: as alone')
	is(maxDiff(r, r1), 0, 'right, its louder noise: as alone')
	let [y] = await audio.from([dirty], { sampleRate: SR }).denoise({ noise: PAUSE, at: 3, duration: 1 }).read()
	let F = 1024   // a frame at 44.1 kHz: the gains reach half a frame past the range's edges
	ok(maxDiff(y.subarray(0, 3 * SR - F), dirty.subarray(0, 3 * SR - F)) < 1e-6, 'before the range: the input')
	ok(maxDiff(y.subarray(4 * SR + F), dirty.subarray(4 * SR + F)) < 1e-6, 'after it: the input')
	ok(rms(y, 3 * SR + F, 4 * SR - F) < rms(dirty, 3 * SR + F, 4 * SR - F), 'inside: the noise down')
})

// A band: the bins inside it gained as the whole spectrum's would be, those outside passed as they were. Measured through
// 4th-order Butterworth filters an octave clear of the band's edges (2 to 8 kHz): under 1 kHz the input, 3 to 6 kHz the
// whole denoise, to a fraction of a dB
test('denoise: a band gains only its own frequencies', async () => {
	let { dirty } = take(15)
	let [inBand] = await audio.from([dirty], { sampleRate: SR }).denoise({ noise: PAUSE, band: [2000, 8000] }).read()
	let [whole] = await audio.from([dirty], { sampleRate: SR }).denoise({ noise: PAUSE }).read()
	let level = async (x, f) => 20 * Math.log10(rms((await f(audio.from([x], { sampleRate: SR })).read())[0]))
	let low = a => a.lowpass(1000, 4), mid = a => a.highpass(3000, 4).lowpass(6000, 4)
	let below = await level(inBand, low) - await level(dirty, low), within = await level(inBand, mid) - await level(whole, mid)
	ok(Math.abs(below) < 0.1, `under 1 kHz: ${below.toFixed(3)} dB from the input`)
	ok(Math.abs(within) < 0.5, `3 to 6 kHz: ${within.toFixed(3)} dB from the whole denoise`)
	let pause = async x => rest((await mid(audio.from([x], { sampleRate: SR })).read())[0]), down = await pause(dirty) - await pause(inBand)
	ok(down > 10, `the noise there, in the pause, ${down.toFixed(1)} dB down`)
	let err = await audio.from([dirty], { sampleRate: SR }).denoise({ noise: PAUSE, band: [8000, 2000] }).read().catch(e => e)
	ok(/^denoise: band is \[low, high\] Hz/.test(err?.message), err?.message)
})

test('denoise: says what it needs', async () => {
	let a = () => audio.from([take(15).dirty], { sampleRate: SR })
	let err = await a().denoise().read().catch(e => e)
	ok(/^denoise: needs the noise/.test(err?.message), err?.message)
	err = await a().denoise(-3, { noise: PAUSE }).read().catch(e => e)
	ok(/^denoise: reduction is dB/.test(err?.message), err?.message)
	err = await a().denoise({ noise: { at: 2.1, duration: 0.01 } }).read().catch(e => e)
	ok(/^denoise: the noise range holds less than a frame/.test(err?.message), err?.message)
	err = await a().denoise({ noise: { at: 60, duration: 1 } }).read().catch(e => e)
	ok(/past the end/.test(err?.message), 'a range past the end: ' + err?.message)
	err = await audio.from([new Float32Array(SR)], { sampleRate: SR }).denoise({ noise: { at: 0, duration: 0.5 } }).read().catch(e => e)
	ok(/^denoise: the noise range is digital silence/.test(err?.message), err?.message)
})
