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
// specsub, wiener and omlsa stream: the noise PSD is tracked online, no manual profile argument
// needed; dereverb renders whole (its prediction is fitted over the take, the late tail taken from
// it) — see each package's audio.js header for why. The streaming ones declare a fixed latency (STFT analysis/synthesis buffering); .read()
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

// x in a room: the direct sound and a late tail of velvet noise (Järveläinen & Karjalainen 2007: a ±1 tap at a random
// place in each 0.5 ms) from 50 ms on, falling 60 dB in t60 s, its energy `ratio` dB under the direct sound's
function room(x, t60, ratio = 3) {
	let s = 5, r = () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296, taps = [], e = 0, y = Float32Array.from(x)
	for (let k = 0, at = 0.05 * SR, step = SR / 2000; at + k * step < 1.5 * t60 * SR; k++) {
		let i = Math.round(at + (k + r()) * step), g = (r() < 0.5 ? -1 : 1) * 10 ** (-3 * i / SR / t60)
		taps.push([i, g]); e += g * g
	}
	for (let [i, g] of taps) { g *= 10 ** (-ratio / 20) / Math.sqrt(e); for (let n = i; n < x.length; n++) y[n] += g * x[n - i] }
	return y
}

// a beat: a kick (a 60 Hz thump falling over 80 ms) on every half second, 120 bpm, and a hat (noise over 30 ms) between
function beat(sec) {
	let x = new Float32Array(Math.round(sec * SR)), s = 3, r = () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296 - 0.5
	for (let i = 0; i < x.length; i++) {
		let t = i / SR, u = t % 0.5, v = (t + 0.25) % 0.5
		x[i] = 0.3 * Math.exp(-u / 0.08) * Math.sin(2 * Math.PI * 60 * u) + 0.1 * Math.exp(-v / 0.03) * r()
	}
	return x
}

test('dereverb: music in a room passes as it came, its beat the mark (0.5 changed it by −2.4 dB of itself); music: \'enhance\' takes it as a room', async () => {
	// the room gives the beat a diffuse tail, and its pauses are a voice's: the room's checks would process it
	let x = room(beat(8), 0.6)
	let [y] = await audio.from([x.slice()], { sampleRate: SR }).dereverb().read()
	is(maxDiff(y, x), 0, 'untouched')
	let [z] = await audio.from([x.slice()], { sampleRate: SR }).dereverb({ music: 'enhance' }).read()
	ok(maxDiff(z, x) > 1e-3, `music: 'enhance': processed (max change ${maxDiff(z, x).toFixed(4)})`)
})

test('dereverb: reduces late-tail energy, never boosts it', async () => {
	let speech = lena.subarray(0, SR * 2)
	let t60 = 0.5
	// the response as long as its decay: cut at 4096 samples (93 ms), its tail stopped dead, faster than a room's, and
	// dereverb from 0.5 reads such a take as dry (its lowest cells no diffuse tail)
	let imp = new Float32Array(Math.round(t60 * SR))
	for (let i = 0; i < imp.length; i++) imp[i] = (Math.random() * 2 - 1) * Math.exp(-6.9 * i / (t60 * SR))
	imp[0] = 1  // direct path
	let rev = convolve(speech, imp)
	let out = (await audio.from([rev.slice()], { sampleRate: SR }).dereverb().read())[0]
	is(out.length, rev.length, 'length preserved (latency compensated)')
	ok(out.every(isFinite))
	let rmsRev = rms(rev), rmsOut = rms(out)
	ok(rmsOut <= rmsRev * 1.1, `tail not boosted (${rmsRev.toFixed(4)} -> ${rmsOut.toFixed(4)})`)
	ok(rmsOut < rmsRev * 0.98, `defining property: tail energy reduced (${rmsRev.toFixed(4)} -> ${rmsOut.toFixed(4)})`)
})

// ── Wave: streaming kernels (gate, deplosive, dewind) ────────────────────────
// deplosive persists per-sample state across process() calls, dewind an STFT stream with
// its frame of latency; gate is
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
	// deplosive reads ~14 ms ahead and begins its duck a few ms before a pop: "well outside" ends 10 ms before it
	let quietBefore = rms(dirty, 0, bstart - SR / 100), quietAfter = rms(out, 0, bstart - SR / 100)
	// 0.75: the exact-complement deplosive (>=0.1.3) ducks less deeply than the old crossover but adds no coloration
	ok(burstAfter < burstBefore * 0.75, `defining property: LF burst ducked (${burstBefore.toFixed(4)} -> ${burstAfter.toFixed(4)})`)
	ok(Math.abs(quietAfter - quietBefore) < quietBefore * 0.15, 'speech well outside the burst left mostly alone')
})

// dewind takes wind: turbulence, low end with no period (Nelke & Vary 2014). A steady low tone, a voice's or a bass
// line's low end, repeats at its pitch and passes (0.1 took a 40 Hz sine for wind and cut it)
test('dewind: takes steady LF wind under speech, passes a steady low tone', async () => {
	let speech = lena.subarray(0, SR * 4), seed = 12345, y = 0, a = Math.exp(-2 * Math.PI * 80 / SR)
	let rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 0x100000000) * 2 - 1
	let wind = Float32Array.from({ length: speech.length }, () => 6 * (y = a * y + (1 - a) * rand()))
	let dirty = Float32Array.from(speech, (v, i) => v + wind[i])
	let out = (await audio.from([dirty.slice()], { sampleRate: SR }).dewind().read())[0]
	is(out.length, dirty.length, 'length preserved')
	ok(out.every(isFinite))
	let err = x => { let s = 0; for (let i = 0; i < x.length; i++) s += (x[i] - speech[i]) ** 2; return s }
	let gain = 10 * Math.log10(err(dirty) / err(out))
	ok(gain > 3, `defining property: wind error ${gain.toFixed(1)} dB down`)
	let tone = Float32Array.from({ length: SR * 2 }, (_, i) => 0.4 * Math.sin(2 * Math.PI * 40 * i / SR))
	let kept = (await audio.from([tone.slice()], { sampleRate: SR }).dewind().read())[0]
	ok(kept.every((v, i) => v === tone[i]), 'a steady 40 Hz tone: no wind, untouched')
})


// ════════════════════════════════════════════════════════════════════════════
// Whole-render (streaming: false) modules — declip, decrackle, debreath.
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

import { declip } from '@audio/denoise-declip/audio'
import { decrackle } from '@audio/denoise-decrackle/audio'
import { debreath } from '@audio/denoise-debreath/audio'
audio.use(declip, decrackle, debreath)

// declick is the library's own op (fn/declick.js): the kernel over spans of the stream, or the clicks in a range
// a tick as a stylus reads one: an impulse ringing at 5 kHz, decaying in 0.2 ms, at 5× the speech around it
function ticked(x) {
	let d = new Float32Array(x), at = []
	for (let t = Math.round(0.3 * SR); t < x.length - 0.3 * SR; t += Math.round(0.3 * SR)) {
		let level = rms(x, t - 441, t + 441), tau = 0.2 * SR / 1000
		for (let n = 0; n < 5 * tau; n++) d[t + n] += 5 * level * Math.exp(-n / tau) * Math.cos(2 * Math.PI * 5000 * n / SR)
		at.push(t)
	}
	return { d, at }
}
const err = (x, y, ats) => { let s = 0; for (let t of ats) for (let i = t - 44; i < t + 88; i++) s += (x[i] - y[i]) ** 2; return s }

test('declick: the ticks gone, the same rendered from anywhere as whole, clean speech untouched', async () => {
	let speech = lena.subarray(0, SR * 4), { d, at } = ticked(speech)
	let { default: kernel } = await import('@audio/denoise-declick')
	let out = (await audio.from([d.slice()], { sampleRate: SR }).declick().read())[0]
	is(out.length, d.length, 'equal frames in/out')
	let down = 10 * Math.log10(err(d, speech, at) / err(out, speech, at))
	ok(down > 12, `the ticks' error ${down.toFixed(1)} dB down`)
	let whole = kernel(d.slice(), { fs: SR })
	ok(out.every((v, i) => v === whole[i]), 'streamed in spans ≡ the kernel over the whole')
	let part = (await audio.from([d.slice()], { sampleRate: SR }).declick().read({ at: 1.7, duration: 1 }))[0], o = Math.round(1.7 * SR)
	ok(part.every((v, i) => v === out[o + i]), 'a render from 1.7 s ≡ the whole one there')
	let clean = (await audio.from([speech.slice()], { sampleRate: SR }).declick().read())[0]
	ok(clean.every((v, i) => v === speech[i]), 'clean speech: not a sample changed')
})

test('declick({ at, duration }): the clicks in the range, nothing else', async () => {
	let speech = lena.subarray(0, SR * 4), { d, at } = ticked(speech), t = at[4]
	let out = (await audio.from([d.slice()], { sampleRate: SR }).declick({ at: (t - 300) / SR, duration: 800 / SR }).read())[0]
	ok(err(out, speech, [t]) < err(d, speech, [t]) / 10, 'the tick there gone')
	let moved = []; for (let i = 0; i < d.length; i++) if (out[i] !== d[i]) moved.push(i)
	ok(moved.length && moved[0] >= t - 300 - 300 && moved.at(-1) < t + 500 + 300, `only around it: ${moved[0] - t}..${moved.at(-1) - t} samples from the tick`)
	// stereo, each channel its own; a sound shorter than the kernel's spans
	let [l, r] = await audio.from([d.slice(0, 3000), d.slice(0, 3000)], { sampleRate: SR }).declick().read()
	ok(l.length === 3000 && l.every((v, i) => v === r[i]), 'short stereo')
})

test('declick: a click across a span\'s edge, a sound that ends on one, a range counted from the end', async () => {
	// spans of 16 windows of 2048 at 44.1 kHz: a tick 10 samples before the first edge, the sound two spans long
	let H = 16 * 2048, speech = lena.subarray(0, 2 * H), d = new Float32Array(speech), t = H - 10, level = rms(speech, t - 441, t + 441)
	for (let n = 0; n < 44; n++) d[t + n] += 5 * level * Math.exp(-n / 8.8) * Math.cos(2 * Math.PI * 5000 * n / SR)
	let { default: kernel } = await import('@audio/denoise-declick')
	let out = (await audio.from([d.slice()], { sampleRate: SR }).declick().read())[0], whole = kernel(d.slice(), { fs: SR })
	ok(out.length === d.length && out.every((v, i) => v === whole[i]), 'streamed ≡ the kernel over the whole')
	ok(err(out, speech, [t]) < err(d, speech, [t]) / 10, 'the tick across the edge gone')
	let end = (await audio.from([d.slice()], { sampleRate: SR }).declick({ at: -(2 * H - t + 300) / SR, duration: 800 / SR }).read())[0]
	ok(end.every((v, i) => v === out[i]), 'its range counted from the end: the same')
})

// a whole-render module given a range reads all of it and changes only there
test('decrackle({ at, duration }): only the range changes', async () => {
	let d = new Float32Array(lena.subarray(0, SR * 2))
	for (let i = 0; i < d.length; i += 256) d[i] += 0.4
	let [y] = await audio.from([d.slice()], { sampleRate: SR }).decrackle({ at: 0.5, duration: 0.5 }).read(), moved = []
	for (let i = 0; i < d.length; i++) if (y[i] !== d[i]) moved.push(i)
	ok(moved.length > 0 && moved[0] >= SR * 0.5 && moved.at(-1) < SR, `changed ${moved[0] / SR}–${moved.at(-1) / SR} s`)
	let [z] = await audio.from([d.slice()], { sampleRate: SR }).decrackle({ at: -0.5 }).read(), first = z.findIndex((v, i) => v !== d[i])
	ok(first >= SR * 1.5, `counted from the end: from ${first / SR} s`)
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

test('debreath (streaming:false), room: attenuates the VAD-inactive region, preserves speech', async () => {
	// 1.5 s of white noise is no breath (debreath ≥ 0.3.0 takes breaths alone); `room` turns the rest down, as 0.2 did
	let speechPart = lena.subarray(0, Math.round(1.5 * SR))
	let breathPart = new Float32Array(Math.round(1.5 * SR))
	for (let i = 0; i < breathPart.length; i++) breathPart[i] = 0.02 * (Math.random() * 2 - 1)
	let dirty = new Float32Array(speechPart.length + breathPart.length)
	dirty.set(speechPart, 0); dirty.set(breathPart, speechPart.length)
	let out = (await audio.from([dirty.slice()], { sampleRate: SR }).debreath({ room: -12 }).read())[0]
	is(out.length, dirty.length, 'equal frames in/out (whole buffer)')
	ok(out.every(isFinite))
	let speechBefore = rms(dirty, 0, speechPart.length), speechAfter = rms(out, 0, speechPart.length)
	let breathBefore = rms(dirty, speechPart.length + 4096), breathAfter = rms(out, speechPart.length + 4096)
	ok(speechAfter > speechBefore * 0.85, 'active speech region largely preserved')
	ok(breathAfter < breathBefore * 0.6, `defining property: inactive/breath region attenuated (${breathBefore.toFixed(4)} -> ${breathAfter.toFixed(4)})`)
})

test('whole-render op on a file source waits decode out (was: 0 samples / save crash)', async () => {
	let out = (await audio('test/fixture.wav').decrackle().read())
	ok(out[0].length > 40000, `read renders the full timeline (${out[0].length})`)
	let a = audio('test/fixture.wav')
	a.wiener().decrackle()
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
import { roomless } from '../fn/deepfilter.js'
import os from 'node:os'
import path from 'node:path'

const neural = await import('@audio/neural-denoise').catch(() => null)
// the package's resampler, whose arithmetic the rnnoise atom streams
const sinc = neural && await import('@audio/resample-sinc').then(m => m.default, () => null)
// neural-denoise 0.4 on: music passes through untouched unless music: 'enhance' (a speech/music/noise classifier);
// lena is a film scene with music under the voice, so the tests of the model's own work take music: 'enhance'
const GUARDED = !!neural && 'music' in (await import('@audio/neural-denoise/audio')).rnnoise.params
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
	let { clean, dirty } = take(), D = (await import('@audio/neural-denoise/audio')).rnnoise.params.limit.default
	// the package's default (16 dB from 0.3, 20 before): unlimited, the model gates clean speech and removes the voice on
	// some noisy VoiceBank files (package README)
	for (let [limit, lo, hi] of [[null, D - 2, D + .5], [10, 8, 10.5], [0, 40, Infinity]]) {
		let a = audio.from([dirty], { sampleRate: SR }), [y] = await (limit == null ? a.rnnoise() : a.rnnoise(limit)).read()
		is(y.length, dirty.length, 'length kept')
		let drop = floorDb(dirty) - floorDb(y), speech = speechDb(y) - speechDb(clean)
		ok(drop > lo && drop < hi, `limit ${limit ?? D + ' (default)'}: floor down ${drop.toFixed(1)} dB`)
		ok(Math.abs(speech) < 1.5, `speech ${speech.toFixed(2)} dB from the clean take`)
	}
})

;(neural ? test : test.skip)('rnnoise: at 48 kHz denoise() sample for sample, its 1439 samples of latency declared and compensated', NEURAL_RUN, async () => {
	let x = take().dirty.subarray(0, 3 * SR)   // read as 48 kHz
	let [y] = await audio.from([x], { sampleRate: 48000 }).rnnoise().read()
	is(audio.op('rnnoise').latency({}, 48000), 1439, '960 (RNNoise) + 479 (the frame queue)')
	is(maxDiff(y, await neural.default(x, { sampleRate: 48000 })), 0, 'equal to the package offline, at its default limit')
})

;(neural && sinc ? test : test.skip)('rnnoise: at 44.1 kHz, resample-sinc in and out as denoise() does, streamed; channels apart', NEURAL_RUN, async () => {
	let { clean, dirty } = take(), a = audio.from([dirty], { sampleRate: SR }).rnnoise()
	let [y] = await a.read()
	is(audio.op('rnnoise').latency({}, SR), 1354, '30.7 ms')
	// a stream can't see its end as the offline resampler does: the last 50 ms may differ
	let want = sinc(await neural.default(sinc(dirty, { from: SR, to: 48000 }), { sampleRate: 48000 }), { from: 48000, to: SR })
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
	err = await a().deepfilter({ floor: -40 }).read().catch(e => e)
	ok(/^deepfilter: floor is dB/.test(err?.message), err?.message)
})

;(HAS_DFN ? test : test.skip)('deepfilter: the package on the op input, unlimited, the input mixed back by its mixback(); its channel only, once', NEURAL_RUN, async () => {
	let { clean, dirty } = take(), calls = 0
	await withImport((spec, orig) => spec === '@audio/neural-denoise' ? orig(spec).then(m => ({ ...m, default: (...a) => (calls++, m.default(...a)) })) : orig(spec), async () => {
		let [input] = await audio.from([dirty], { sampleRate: SR }).gain(-6).read(), [ref] = await audio.from([clean], { sampleRate: SR }).gain(-6).read()
		// the model run again on the take with the room's prediction off where its voice carries a room (roomless())
		let run = x => neural.default(x, { sampleRate: SR, model: 'deepfilternet3', limit: 0, music: 'enhance' })
		let y0 = await run([input]), heard = roomless([input], y0, SR), [y] = heard ? await run(heard) : y0
		calls = 0
		let a = audio.from([dirty, dirty], { sampleRate: SR }).gain(-6).deepfilter({ channel: 1, music: 'enhance' })
		let [l, r] = await a.read(), runs = calls
		is(maxDiff(r, neural.mixback(input, y, { sampleRate: SR })), 0, 'the package on the edits before it, the input mixed back by its mixback(): 18 dB, the floor')
		is(maxDiff(l, input), 0, 'channel 0 untouched')
		a.gain(1); await a.read()
		is(runs, heard ? 2 : 1, 'the model run once, twice where its voice carried a room')
		is(calls, runs, 'enhanced once: re-reads and later edits reuse it')
		let speech = speechDb(r) - speechDb(ref)
		ok(Math.abs(speech) < 1.5, `speech ${speech.toFixed(2)} dB from the clean take`)
		let [none] = await audio.from([input], { sampleRate: SR }).deepfilter({ limit: 0, music: 'enhance' }).read()
		is(maxDiff(none, y), 0, 'limit 0: the package unlimited')
		// kept by the model and its input in a host's store (core.js memo), never by the limit: another instance at another
		// limit reads the run back, the limit applied after it
		let kept = new Map()
		audio.memo = { get: k => kept.get(k) ?? null, set: (k, v) => kept.set(k, v) }
		try {
			await audio.from([input], { sampleRate: SR }).deepfilter({ limit: 12, music: 'enhance' }).read()
			calls = 0
			let [again] = await audio.from([input], { sampleRate: SR }).deepfilter({ limit: 6, music: 'enhance' }).read()
			is(calls, 0, 'the model run read back, at another limit')
			is(maxDiff(again, neural.mixback(input, y, { limit: 6, sampleRate: SR })), 0, '…6 dB applied to it')
		} finally { delete audio.memo }
	})
})

// limit: how far quiet noise drops, room tone kept; floor: how far under the voice loud noise ends (neural-denoise 0.5's
// mixback(); 0.4 took every noise down by the limit, 18 dB, and left noise 15 dB under the voice 33 under it). Held notes,
// which the model takes for noise, keep their level: VocalSet (Wilkins et al., ISMIR 2018, CC BY 4.0) singer F2's straight
// long tones on /a/, once in the data cache (@audio/neural-denoise README, Accuracy: Singing); before the voice guard they
// lost 17.5 dB, the limit's whole 18.
const HELD = path.join(os.homedir(), '.cache', 'audiojs', 'data', 'vocalset', 'FULL', 'female2', 'long_tones', 'straight', 'f2_long_straight_a.wav')
;(HAS_DFN ? test : test.skip)('deepfilter: noise loud against the voice ends 40 dB under it, quiet noise drops by the limit; held notes keep their level', NEURAL_RUN, async () => {
	let { clean, dirty } = take(15), quiet = take(45).dirty
	for (let [o, x, want] of [[{}, dirty, 'floor'], [{ floor: 45 }, dirty, 'floor'], [{ floor: 0 }, dirty, 18], [{ limit: 6, floor: 0 }, dirty, 6], [{}, quiet, 18]]) {
		let [y] = await audio.from([x], { sampleRate: SR }).deepfilter({ ...o, music: 'enhance' }).read()
		let under = speechDb(y) - floorDb(y), drop = floorDb(x) - floorDb(y), at = o.floor ?? 40
		if (want === 'floor') ok(Math.abs(under - at) < 1.5, `${JSON.stringify(o)}: the pause ${under.toFixed(1)} dB under the voice (${drop.toFixed(1)} down)`)
		else ok(drop > want - 3 && drop < want + .2, `${JSON.stringify(o)}${x === quiet ? ', noise 45 dB under' : ''}: the pause ${drop.toFixed(1)} dB down`)
		ok(Math.abs(speechDb(y) - speechDb(clean)) < 1.5, `speech ${(speechDb(y) - speechDb(clean)).toFixed(2)} dB from the clean take`)
	}
	if (!existsSync(HELD)) return console.log('  (no VocalSet in the data cache: held notes not checked)')
	let [x] = await audio(HELD).read(), [y] = await audio(HELD).deepfilter().read()
	ok(speechDb(y) - speechDb(x) > -3, `held notes: ${(speechDb(y) - speechDb(x)).toFixed(1)} dB`)
})

// music passes through both ops untouched (neural-denoise 0.4): a synthetic band, chords of plucked harmonic tones every
// half second with a bass note and a tick of noise, which the classifier hears as music throughout
function band(sec, sr = SR) {
	let x = new Float32Array(Math.round(sec * sr)), s = 9, rnd = () => (s = (s * 1664525 + 1013904223) % 4294967296, s / 4294967296 - .5)
	let chords = [[60, 64, 67], [57, 60, 64], [53, 57, 60], [55, 59, 62]], hz = m => 440 * 2 ** ((m - 69) / 12)
	for (let b = 0; b * .5 < sec; b++) {
		let t0 = Math.round(b * .5 * sr), c = chords[(b >> 2) % 4]
		for (let n of [...c, c[0] - 24]) for (let h = 1; h <= 8 && hz(n) * h < 8000; h++)
			for (let i = 0; i < sr && t0 + i < x.length; i++) x[t0 + i] += .05 / h * Math.exp(-i / sr * (2 + h)) * Math.sin(2 * Math.PI * hz(n) * h * i / sr)
		for (let i = 0; i < 2000 && t0 + i < x.length; i++) x[t0 + i] += .1 * rnd() * Math.exp(-i / 300)
	}
	return x
}
;(GUARDED && HAS_DFN ? test : test.skip)('deepfilter, rnnoise: music passes through untouched; music: \'enhance\' processes it', NEURAL_RUN, async () => {
	let x = band(6), [y] = await audio.from([x], { sampleRate: SR }).deepfilter().read()
	is(maxDiff(y, x), 0, 'deepfilter: the band as it went in')
	let [z] = await audio.from([x], { sampleRate: SR }).deepfilter({ music: 'enhance' }).read()
	ok(maxDiff(z, x) > .01, `music: 'enhance': changed, by up to ${maxDiff(z, x).toFixed(2)}`)
	// RNNoise decides as it streams: the band's first second is denoised
	let [r] = await audio.from([x], { sampleRate: SR }).rnnoise().read(), from = Math.round(1.5 * SR)
	is(maxDiff(r.subarray(from), x.subarray(from)), 0, 'rnnoise: from 1.5 s on, the band as it went in')
	let err = await audio.from([x], { sampleRate: SR }).deepfilter({ music: 'keep' }).read().catch(e => e)
	ok(/^deepfilter: music is 'pass' or 'enhance'/.test(err?.message), err?.message)
})

// the model hears a voice in a room with the room's linear prediction off (dereverb's WPE alone): the take comes nearer
// the dry voice; music, and a take dereverb hears no room in, go in as they came. No model needed
test('deepfilter: the model hears a voice in a room without the room\'s prediction, music as it came', async () => {
	// the model's voice stands in as the take itself: where it carries a room, the take is heard without its prediction
	let speech = lena.subarray(0, 4 * SR), wet = room(speech, 0.5, 6)
	let [h] = roomless([wet], [wet], SR), err = v => { let e = 0; for (let i = 0; i < v.length; i++) e += (v[i] - speech[i]) ** 2; return 10 * Math.log10(e) }
	ok(err(h) < err(wet) - 0.5, `nearer the dry voice: ${(err(h) - err(wet)).toFixed(2)} dB of the room off`)
	ok(roomless([wet], [wet], SR)[0] === h, 'the last one kept: moving the limit fits no room again')
	let music = room(beat(8), 0.6)
	is(roomless([music], [music], SR), null, 'music in a room: heard once, as it came')
	is(roomless([wet], [beat(4)], SR), null, 'a voice the model left no room in (here a beat): heard once')
})

// ════════════════════════════════════════════════════════════════════════════
// auto (@audio/chain's, the registry's, hosted by fn/auto.js): a bed under speech goes to DeepFilterNet3 where
// @audio/neural-denoise is installed, to chain's own OM-LSA without it, and to it where the model passes the take as
// music. The voice: VoiceBank's test speaker p232 (Valentini-Botinhao et al. 2016, CC BY 4.0; the data cache, as
// bench/rx/assistant.mjs reads it), under white noise; measured against it through the recipe's own tone filters
// (its highpass and EQ: a timbre chosen, not damage), as the bench measures.
// ════════════════════════════════════════════════════════════════════════════

const VB = path.join(os.homedir(), '.cache', 'audiojs', 'data', 'vbdemand', 'clean_testset_wav', 'p232_005.wav')
const classical = fn => withImport((spec, orig) => spec.startsWith('@audio/neural-denoise') ? Promise.reject(new Error(`Cannot find package '${spec}'`)) : orig(spec), fn)
const noisy = (x, snr) => { let n = noise(x.length, 1, 7), k = rms(x) / 10 ** (snr / 20) / rms(n); return x.map((v, i) => v + n[i] * k) }
// SI-SDR (Le Roux et al., ICASSP 2019) of y against r, dB
function sisdr(r, y) {
	let ry = 0, rr = 0, e = 0
	for (let i = 0; i < r.length; i++) { ry += r[i] * y[i]; rr += r[i] * r[i] }
	for (let i = 0, k = ry / rr; i < r.length; i++) e += (y[i] - k * r[i]) ** 2
	return 10 * Math.log10(ry * ry / rr / e)
}
// the reference through a recipe's tone stages
const toned = async (ref, recipe, fs) => (await import('@audio/chain')).apply([ref], { ...recipe, stages: recipe.stages.filter(s => s.name === 'hpf' || s.name === 'eq') }, { fs })[0]

test('auto: without @audio/neural-denoise, chain\'s own denoiser: the take as chain renders it, the recipe saying so', async () => {
	let { dirty } = take(15), { default: chain } = await import('@audio/chain')
	await classical(async () => {
		let said = [], a = audio.from([dirty], { sampleRate: SR }).auto().on('doing', e => said.push(e))
		let [y] = await a.read(), want = chain([dirty], { fs: SR, type: 'speech' })
		ok(want.recipe.stages.some(s => s.name === 'denoise' && s.atom === '@audio/denoise-omlsa'), `OM-LSA takes the bed: ${want.recipe.stages.map(s => s.name)}`)
		is(said, [{ op: 'auto', stages: ['analysis'] }, { op: 'auto', stages: [...new Set(want.recipe.stages.map(s => s.name))] }], 'the parts it runs, said as each starts')
		is(maxDiff(y, want.channels[0]), 0, 'chain() itself, sample for sample')
		is((await audio.from([dirty], { sampleRate: SR }).chain()).stages.find(s => s.name === 'denoise').atom, '@audio/denoise-omlsa', 'the chain stat\'s recipe')
	})
})

;(HAS_DFN && existsSync(VB) ? test : test.skip)('auto: a bed under a voice goes to DeepFilterNet3: the bed in its pauses 10 dB further down than chain\'s own leaves it, SI-SDR 1 dB higher; the recipe and its code() say so', NEURAL_RUN, async () => {
	let { render } = await import('../fn/auto.js'), { code } = await import('@audio/chain')
	let [ref] = await audio(VB).read(), x = noisy(ref, 5), fs = 48000
	let [y] = await audio.from([x], { sampleRate: fs }).auto().read(), { channels, recipe } = await render([x], { sampleRate: fs, type: 'speech' })
	is(maxDiff(y, channels[0]), 0, 'the op renders what render() makes')
	let d = recipe.stages.find(s => s.name === 'denoise')
	is(d.atom, '@audio/neural-denoise', `the denoiser that ran: ${JSON.stringify(d.params)}`)
	ok(code(recipe).includes(`import denoise from '@audio/neural-denoise'`) && !code(recipe).includes('omlsa'), 'code() imports it, and no other')
	is((await audio.from([x], { sampleRate: fs }).chain()).stages.find(s => s.name === 'denoise').atom, '@audio/neural-denoise', 'the chain stat\'s recipe')
	// the bed in the voice's pauses (its quietest tenth of 50 ms frames), dB under the voice: in 8.5, OM-LSA 26.7,
	// DeepFilterNet3 45.4; SI-SDR in 5.0 dB, OM-LSA 14.2, DeepFilterNet3 16.1. PESQ, on the test takes of
	// bench/rx/assistant.mjs whose plan puts the stage: 1.94 → 2.50 (RX 12 Repair Assistant tuned 2.28)
	let F = 2400, frames = []
	for (let i = 0; i + F <= ref.length; i += F) frames.push([rms(ref, i, i + F), i])
	let quiet = frames.sort((a, b) => a[0] - b[0]).slice(0, Math.ceil(frames.length / 10)).map(f => f[1])
	let under = v => speechDb(v) - 10 * Math.log10(quiet.reduce((s, i) => s + rms(v, i, i + F) ** 2, 0) / quiet.length)
	let c = await classical(() => render([x], { sampleRate: fs, type: 'speech' }))
	ok(under(y) > 40 && under(y) > under(c.channels[0]) + 10, `the bed in the pauses: ${under(x).toFixed(1)} dB under the voice in, chain's own ${under(c.channels[0]).toFixed(1)}, DeepFilterNet3 ${under(y).toFixed(1)}`)
	let got = sisdr(await toned(ref, recipe, fs), y), was = sisdr(await toned(ref, c.recipe, fs), c.channels[0])
	ok(got > 15.5 && got > was + 1, `SI-SDR ${sisdr(ref, x).toFixed(1)} dB in, chain's own ${was.toFixed(1)}, DeepFilterNet3 ${got.toFixed(1)}`)
})

// the guard hears lena (a film's voice over its score) under white noise 10 dB down as music, all of it: the model would
// leave the take as it came (SI-SDR 10.0 dB, as in; chain's own 17.5)
;(HAS_DFN ? test : test.skip)('auto: a take the model passes as music keeps chain\'s own denoiser, the recipe saying so', NEURAL_RUN, async () => {
	let { render } = await import('../fn/auto.js'), x = noisy(lena, 10)
	let r = await render([x], { sampleRate: SR, type: 'speech' }), c = await classical(() => render([x], { sampleRate: SR, type: 'speech' }))
	let d = r.recipe.stages.find(s => s.name === 'denoise')
	is(d.atom, '@audio/denoise-omlsa', 'OM-LSA in the recipe')
	ok(/; DeepFilterNet3 hears music in \d+ % of it$/.test(d.why), d.why)
	is(maxDiff(r.channels[0], c.channels[0]), 0, 'the take as without the package')
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

// frames of at least 32 ms, 2048 at 44.1 kHz as at 48: partials a 1024 frame cannot part from the noise are kept.
// Eighteen harmonics of 110 Hz, each 57 dB under full scale, from 2 s, in white noise 40 dB under; what the gain does to
// the partials read apart from the noise by the phase-inversion method (Hagerman & Olofsson 2004)
test('denoise: at 44.1 kHz a 2048 frame (its latency 2047): held partials under steady noise kept, the noise 12 dB down', async () => {
	is(audio.op('denoise').latency({}, SR), 2047, 'a 2048 frame')
	let n = 6 * SR, nz = noise(n, 0.01 * Math.sqrt(3), 3), s = new Float32Array(n)
	for (let h = 1; h <= 18; h++) for (let i = 2 * SR; i < n; i++) s[i] += 0.002 * Math.sin(2 * Math.PI * 110 * h * i / SR + h)
	let run = async x => (await audio.from([x], { sampleRate: SR }).denoise({ noise: { at: 0.2, duration: 1.5 } }).read())[0]
	let yp = await run(s.map((v, i) => v + nz[i])), ym = await run(s.map((v, i) => v - nz[i]))
	let e = (f, a, b) => { let p = 0; for (let i = a; i < b; i++) p += f(i) ** 2; return p }
	let kept = 10 * Math.log10(e(i => (yp[i] + ym[i]) / 2, 3 * SR, n) / e(i => s[i], 3 * SR, n))
	let down = 10 * Math.log10(e(i => nz[i], SR, 2 * SR) / e(i => (yp[i] - ym[i]) / 2, SR, 2 * SR))
	ok(kept > -3, `partials kept: ${kept.toFixed(2)} dB (a 1024 frame: −4.3)`)
	ok(Math.abs(down - 12) < 0.3, `the noise alone ${down.toFixed(2)} dB down`)
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
	let F = 1024   // half a frame at 44.1 kHz (2048): the gains reach that far past the range's edges
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

// debleed reads the bleeding source's own track: the call takes it first, as a keyed op's key
test('debleed(source): the source\'s bleed taken out of the mic; the same as { key }; a silent source changes nothing', async () => {
	let n = SR * 4, voice = lena.subarray(0, n), other = lena.subarray(5 * SR, 5 * SR + n)
	// a co-host 6 ms off through a short room, 10 dB under the voice
	let path = new Float32Array(600); path[265] = 0.3; path[400] = 0.12; path[590] = 0.05
	let bleed = convolve(other, path), mic = Float32Array.from(voice, (v, i) => v + bleed[i]), src = () => audio.from([other], { sampleRate: SR })
	let out = (await audio.from([mic.slice()], { sampleRate: SR }).debleed(src()).read())[0]
	is(out.length, n)
	let err = x => { let s = 0; for (let i = SR; i < n; i++) s += (x[i] - voice[i]) ** 2; return s }, down = 10 * Math.log10(err(mic) / err(out))
	// how far is the package's own measure (its README); hosted, the defining property: less of the bleed
	ok(down > 1, `defining property: bleed ${down.toFixed(1)} dB down`)
	let keyed = (await audio.from([mic.slice()], { sampleRate: SR }).debleed({ key: src() }).read())[0]
	ok(keyed.every((v, i) => v === out[i]), 'debleed(source) ≡ debleed({ key: source })')
	let still = (await audio.from([mic.slice()], { sampleRate: SR }).debleed(audio.from([new Float32Array(n)], { sampleRate: SR })).read())[0]
	ok(still.every((v, i) => v === mic[i]), 'a silent source: bit-exact')
})

// desqueak reads the whole take (streaming: false): plucked notes (partials at 1/h², a click), and between two of them a
// squeak, a fingertip sliding along a wound string (a pulse per 0.33 mm winding crossed, the hand's speed rising and
// falling as a minimum-jerk move: Pakarinen, Penttinen & Bank, JASA 122(6), 2007)
test('desqueak: a guitar\'s squeak taken down, the notes untouched; notes alone come back sample for sample', async () => {
	let r = (s => () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296 - 0.5)(7), x = new Float32Array(3 * SR)
	for (let [at, f0] of [[0.2, 110], [0.9, 147], [1.6, 196], [2.3, 131]]) {
		let i0 = Math.round(at * SR)
		for (let h = 1; h * f0 < 12000; h++) { let ph = 2 * Math.PI * r(); for (let i = i0; i < x.length; i++) x[i] += 0.2 / h / h * Math.sin(2 * Math.PI * h * f0 * (i - i0) / SR + ph) * Math.exp(-(i - i0) / SR * (1 + 0.3 * h) / 1.2) }
		for (let i = 0; i < SR / 1000; i++) x[i0 + i] += 0.06 * r()
	}
	let T = 0.15, n = Math.round(T * SR), D = 0.6 * T / 1.875, s = new Float64Array(n + 400), burst = Float64Array.from({ length: 40 }, (_, i) => r() * Math.exp(-i / 6))
	let pos = t => D * (10 * t ** 3 - 15 * t ** 4 + 6 * t ** 5), vel = t => 30 * D / T * t * t * (1 - t) ** 2
	for (let j = 1, i = 0; ; j++) { while (i < n && pos(i / n) < j * 0.33e-3) i++; if (i >= n) break; for (let k = 0; k < 40; k++) s[i + k] += Math.sqrt(vel(i / n) / 0.6) * burst[k] }
	let m = Math.max(...s.map(Math.abs)), a = Math.round(0.62 * SR), b = a + s.length, dirty = x.slice()
	for (let i = 0; i < s.length; i++) dirty[a + i] += 0.05 * s[i] / m
	let out = (await audio.from([dirty.slice()], { sampleRate: SR }).desqueak().read())[0]
	is(out.length, x.length)
	let e0 = 0, e1 = 0; for (let i = a; i < b; i++) e0 += (dirty[i] - x[i]) ** 2, e1 += (out[i] - x[i]) ** 2
	ok(10 * Math.log10(e0 / e1) > 6, `defining property: the squeak ${(10 * Math.log10(e0 / e1)).toFixed(1)} dB down`)
	let w = SR / 100, moved = 0; for (let i = 0; i < x.length; i++) if (i < a - w || i >= b + w) moved += out[i] !== dirty[i]
	is(moved, 0, 'the notes outside the squeak: sample for sample')
	let clean = (await audio.from([x.slice()], { sampleRate: SR }).desqueak().read())[0]
	ok(clean.every((v, i) => v === x[i]), 'no squeak: bit-exact')
	let off = (await audio.from([dirty.slice()], { sampleRate: SR }).desqueak({ squeak: 0 }).read())[0]
	ok(off.every((v, i) => v === dirty[i]), 'squeak 0: bit-exact')
})
