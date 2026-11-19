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

// ── Wave: STFT statistical denoisers (specsub, wiener, omlsa, dereverb's wpe) ──────
// specsub, wiener and omlsa stream: the noise PSD is tracked online, no manual profile argument
// needed; dereverb({ method: 'wpe' }) renders whole (its prediction is fitted over the take, the late tail taken from
// it) — see each package's audio.js header for why. The streaming ones declare a fixed latency (STFT analysis/synthesis buffering); .read()
// applies plugin-delay-compensation transparently, so output compares directly against
// the un-shifted reference at the same sample index (verified: cross-correlation of
// output against the dry reference peaks at zero shift, not at the raw kernel latency). Loaded as the registry loads them,
// repairs that keep a take's length: the ring each declares past its frames is not rendered (audio.js keeping)

await audio.use('specsub', 'wiener', 'omlsa')

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

test('dereverb wpe: music in a room passes as it came, its beat the mark (0.5 changed it by −2.4 dB of itself); music: \'enhance\' takes it as a room', async () => {
	// the room gives the beat a diffuse tail, and its pauses are a voice's: the room's checks would process it
	let x = room(beat(8), 0.6)
	let [y] = await audio.from([x.slice()], { sampleRate: SR }).dereverb({ method: 'wpe' }).read()
	is(maxDiff(y, x), 0, 'untouched')
	let [z] = await audio.from([x.slice()], { sampleRate: SR }).dereverb({ method: 'wpe', music: 'enhance' }).read()
	ok(maxDiff(z, x) > 1e-3, `music: 'enhance': processed (max change ${maxDiff(z, x).toFixed(4)})`)
})

test('dereverb wpe: reduces late-tail energy, never boosts it', async () => {
	let speech = lena.subarray(0, SR * 2)
	let t60 = 0.5
	// the response as long as its decay: cut at 4096 samples (93 ms), its tail stopped dead, faster than a room's, and
	// dereverb from 0.5 reads such a take as dry (its lowest cells no diffuse tail)
	// a seeded noise: unseeded, one response in some drew a tail dereverb takes for none (CI: energy 2.7471 -> 2.7471)
	let imp = new Float32Array(Math.round(t60 * SR)), seed = 7
	let rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 0x100000000) * 2 - 1
	for (let i = 0; i < imp.length; i++) imp[i] = rand() * Math.exp(-6.9 * i / (t60 * SR))
	imp[0] = 1  // direct path
	let rev = convolve(speech, imp)
	let out = (await audio.from([rev.slice()], { sampleRate: SR }).dereverb({ method: 'wpe' }).read())[0]
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
audio.use(gate)
// the repairs as the registry loads them: what rings past their frames is not rendered (audio.js keeping)
await audio.use('deplosive', 'dewind')

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
}, { timeout: 60000 })  // its rebuild on worker threads, which a CI runner's Node 20 starts past the default 5 s

// declip's rebuild made on worker threads (fn/declip.js, parallel.js): the kernel's own samples, bit for bit, each channel
// of its own, a range's outside kept as it was
test('declip on threads: the kernel\'s samples, bit for bit; a range kept outside', async () => {
	let { default: kernel } = await import('@audio/denoise-declip')
	let s = lena.subarray(SR, SR + SR / 2), k = 0.9 / peak(s), x = Float32Array.from(s, v => v * k)
	let L = Float32Array.from(x, v => Math.max(-0.3, Math.min(0.3, v))), R = Float32Array.from(x, v => Math.max(-0.5, Math.min(0.4, v)))
	let same = (a, b) => a.length === b.length && a.every((v, i) => Object.is(v, b[i]))
	let out = await audio.from([L.slice(), R.slice()], { sampleRate: SR }).declip().read()
	ok(same(out[0], kernel(L, { fs: SR, clipLevel: 0, order: 256 })) && same(out[1], kernel(R, { fs: SR, clipLevel: 0, order: 256 })), 'each channel the kernel\'s')
	let part = await audio.from([L.slice()], { sampleRate: SR }).declip({ at: 0.1, duration: 0.2 }).read(), a = 0.1 * SR, b = 0.3 * SR, all = kernel(L, { fs: SR, clipLevel: 0, order: 256 })
	ok(same(part[0].subarray(0, a), L.subarray(0, a)) && same(part[0].subarray(b), L.subarray(b)), 'outside the range as it was')
	ok(same(part[0].subarray(a, b), all.subarray(a, b)), 'inside it the kernel\'s')
}, { timeout: 600000 })

// parallel.js on its own: results in the jobs' order however the threads hand them back; none, or one, made here; a job
// that throws rejects the call, and the threads go on serving the next
test('parallel: jobs on threads, their results in order; none or one here; a throw rejects, the next call served', async () => {
	let { default: parallel } = await import('../parallel.js')
	let mod = 'data:text/javascript,' + encodeURIComponent('export const solve = (s, j) => { if (j < 0) throw new Error(\'job \' + j); return new Float64Array([j * s.k]) }')
	let here = (s, j) => new Float64Array([j * s.k]), jobs = Array.from({ length: 200 }, (_, i) => i)
	let out = await parallel(mod, { k: 3 }, jobs, here)
	ok(out.length === 200 && out.every((v, i) => v[0] === 3 * i), 'every result where its job is')
	is((await parallel(mod, { k: 3 }, [], here)).length, 0, 'no jobs, no results')
	is((await parallel(mod, { k: 3 }, [5], here))[0][0], 15, 'one job, made here')
	let failed = await parallel(mod, { k: 3 }, [1, 2, -7, 4], here).then(() => '', e => e.message)
	is(failed, 'job -7', 'a job that throws rejects the call')
	ok((await parallel(mod, { k: 2 }, jobs, here)).every((v, i) => v[0] === 2 * i), 'the threads serve the next call')
})

// a thread serving jobs has parallel.js as its entry (or a page's jobs entry importing its serve): it loads no core
test('parallel: a thread serving jobs loads no core', async () => {
	let { execFileSync } = await import('child_process')
	let hook = `data:text/javascript,${encodeURIComponent(`export async function resolve(s, c, next) { let r = await next(s, c); if (/\\/core\\.js$/.test(r.url)) throw new Error('core loaded'); return r }`)}`
	let script = `import { register } from 'node:module'; register(${JSON.stringify(hook)}); await import('./parallel.js'); console.log('none')`
	is(execFileSync(process.execPath, ['--input-type=module', '-e', script], { cwd: new URL('..', import.meta.url), encoding: 'utf8' }).trim(), 'none')
})

// declip on threads at its edges: nothing to rebuild (no samples, nothing clipped) comes back as it went in; one
// channel of two, the other untouched
test('declip on threads: empty and unclipped as they are; one channel of two', async () => {
	let { default: kernel } = await import('@audio/denoise-declip')
	let same = (a, b) => a.length === b.length && a.every((v, i) => Object.is(v, b[i]))
	is((await audio.from([new Float32Array(0)], { sampleRate: SR }).declip().read())[0].length, 0, 'no samples')
	let quiet = Float32Array.from(lena.subarray(0, SR / 4), v => v * 0.5)
	ok(same((await audio.from([quiet.slice()], { sampleRate: SR }).declip().read())[0], quiet), 'nothing clipped: as it was')
	let s = lena.subarray(SR, SR + SR / 4), k = 0.9 / peak(s), L = Float32Array.from(s, v => v * k), R = Float32Array.from(s, v => Math.max(-0.3, Math.min(0.3, v * k)))
	let out = await audio.from([L.slice(), R.slice()], { sampleRate: SR }).declip({ channel: 1 }).read()
	ok(same(out[0], L), 'the channel not asked for as it was')
	ok(same(out[1], kernel(R, { fs: SR, clipLevel: 0, order: 256 })), 'the one asked for the kernel\'s')
	// both clipped: the one not asked for is kept too (the whole render once declipped every channel, the choice ignored)
	let both = await audio.from([R.slice(), R.slice()], { sampleRate: SR }).declip({ channel: 1 }).read()
	ok(same(both[0], R) && same(both[1], out[1]), 'both clipped: the channel not asked for as it was, the one asked for as above')
}, { timeout: 600000 })

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
// a declaration, hoisted: tests above it run while the module still evaluates its top-level awaits
function maxDiff(a, b) { let m = 0; for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i] - b[i])); return m }

// speech, a pause of `gap` s, speech; white noise throughout, `snr` dB under the speech
function take(snr = 15, gap = 1) {
	let clean = new Float32Array((4 + gap) * SR)
	clean.set(lena.subarray(0, 2 * SR)); clean.set(lena.subarray(2 * SR, 4 * SR), (2 + gap) * SR)
	let n = noise(clean.length, 1, 7), k = rms(clean) / 10 ** (snr / 20) / rms(n)
	return { clean, dirty: clean.map((v, i) => v + n[i] * k) }
}
// the level of the middle 500 ms of the pause, and of [a, b) s after the voice ends
const floorDb = (d, gap = 1) => 20 * Math.log10(rms(d, Math.round((1.75 + gap / 2) * SR), Math.round((2.25 + gap / 2) * SR)))
const afterDb = (d, a, b) => 20 * Math.log10(rms(d, Math.round((2 + a) * SR), Math.round((2 + b) * SR)))
// the take without its pause
const spoken = (d, gap) => { let o = new Float32Array(d.length - gap * SR); o.set(d.subarray(0, 2 * SR)); o.set(d.subarray((2 + gap) * SR), 2 * SR); return o }
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

;(neural ? test : test.skip)('deepfilter, derustle, auto: a @audio/neural-denoise older than 0.8.1 refused, naming its version and the one needed', async () => {
	let { denoiser } = await import('../fn/deepfilter.js'), { dirty } = take(5), sine = Float32Array.from({ length: SR }, (_, i) => 0.3 * Math.sin(2 * Math.PI * 440 * i / SR))
	let says = (op, v) => `${op}: @audio/neural-denoise ${v} is installed, and audio ${audio.version} needs 0.8.1 or later (npm i @audio/neural-denoise@^0.8.1)`
	// the package as installed, its package.json saying `version` (null: a file a bundle cannot reach), its exports as `as` makes them
	let stub = (version, as = m => m) => (spec, orig) => spec === '@audio/neural-denoise/package.json' ? (version == null ? Promise.reject(new Error('not in this bundle')) : Promise.resolve({ default: { version } }))
		: spec === '@audio/neural-denoise' ? orig(spec).then(as) : orig(spec)
	for (let v of ['0.5.0', '0.7.0', '0.8.0']) await withImport(stub(v), async () => {
		for (let [op, f] of [['deepfilter', a => a.deepfilter()], ['derustle', a => a.derustle()], ['auto', a => a.auto()]])
			is(await f(audio.from([dirty], { sampleRate: SR })).read().then(() => null, e => e.message), says(op, v), `${v}: ${op}, at its first read`)
		ok((await audio.from([sine], { sampleRate: SR }).auto().read())[0].length === SR, `${v}: auto() of a take whose plan holds no denoiser renders`)
	})
	for (let v of ['0.8.1', '0.8.2', '0.9.0', '1.0.0']) await withImport(stub(v), async () => ok(await denoiser('deepfilter'), `${v}: taken`))
	// no package.json to read: its mixback() asked. 0.7.0's reads a limit of 0 as none; 0.8.0's has no `everywhere`
	let as07 = m => ({ ...m, mixback: (x, y, { limit = 18 } = {}) => { let a = limit ? 10 ** (-Math.abs(limit) / 20) : 0; return y.map((v, i) => v + a * (x[i] - v)) } })
	let as08 = m => ({ ...m, mixback: (x, y, o) => m.mixback(x, y, { ...o, everywhere: false }) })
	for (let [as, was] of [[as07, '0.7.0'], [as08, '0.8.0']]) await withImport(stub(null, as), async () =>
		is(await denoiser('deepfilter').then(() => null, e => e.message), says('deepfilter', 'of a version before 0.8.1'), `its version unread, a mixback() as ${was}'s`))
	await withImport(stub(null), async () => ok(await denoiser('deepfilter'), "its version unread, its own mixback(): taken"))
	// a bundle's literal loaders (audio.import = spec => loaders[spec]()) throw as they are asked for a file they lack
	await withImport((spec, orig) => { if (spec === '@audio/neural-denoise/package.json') throw new TypeError('loaders[spec] is not a function'); return orig(spec) }, async () =>
		ok(await denoiser('deepfilter'), 'a loader that throws for its package.json: its mixback() asked, taken'))
})

;(neural ? test : test.skip)('rnnoise: the noise floor drops by the limit and no further, speech keeps its level', NEURAL_RUN, async () => {
	let { clean, dirty } = take(), D = (await import('@audio/neural-denoise/audio')).rnnoise.params.limit.default
	// the package's default (16 dB from 0.3, 20 before): unlimited, the model gates clean speech and removes the voice on
	// some noisy VoiceBank files (package README)
	// Infinity: its top, 100 dB, all the model takes; 0: nothing taken, the take as the two resamplers carry it to 48 kHz
	// and back (the noise's top band at their edge)
	for (let [limit, lo, hi] of [[null, D - 2, D + .5], [10, 8, 10.5], [Infinity, 40, Infinity], [0, -.5, .5]]) {
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
	is(maxDiff((await audio.from([x], { sampleRate: 48000 }).rnnoise(0).read())[0], x), 0, 'limit 0: nothing taken, the input sample for sample')
	// null: a value left out by its place, the default limit from the first sample (RNNoise sounds at the limit it is built with)
	is(maxDiff((await audio.from([x], { sampleRate: 48000 }).rnnoise(null).read())[0], y), 0, "null: the default's samples")
})

// a repair keeps the take's length (audio.js keeping: its package says restoration): the ring it declares past the take
// (RNNoise's DC-blocking high-pass, 77.3 ms at the default limit) renders where an edit asks, tail: true, the take's
// own samples the same either way
;(neural ? test : test.skip)("rnnoise: the take's length kept; tail: true renders the ring it declares, the take as without", NEURAL_RUN, async () => {
	let x = take().dirty.subarray(0, SR), { rnnoise } = await import('@audio/neural-denoise/audio'), t = rnnoise.tail({ params: { limit: Float32Array.of(rnnoise.params.limit.default) } })
	let [y] = await audio.from([x], { sampleRate: SR }).rnnoise().read(), [z] = await audio.from([x], { sampleRate: SR }).rnnoise({ tail: true }).read()
	is([y.length, z.length], [x.length, x.length + Math.round(t * SR)], `the take's length; tail: true, its ring of ${(t * 1000).toFixed(1)} ms too`)
	is(maxDiff(z.subarray(0, x.length), y), 0, "the take's samples as without it")
	ok(maxDiff(z.subarray(x.length), new Float32Array(z.length - x.length)) > 1e-4, 'a ring in it')
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

// a limit is dB as a registry op reads one (text in its unit), refused at the call where it is none; the floor, null among
// what it refuses (the mix would read it as no floor), and `everywhere`, at the read, before any model loads
;(neural ? test : test.skip)('deepfilter: a model it cannot load names where it looked; limit is dB, refused at the call where it is none', async () => {
	let a = () => audio.from([lena.slice(0, SR)], { sampleRate: SR }), at = f => { try { f(); return null } catch (e) { return e.message } }
	let err = await a().deepfilter({ weights: 'file:///nonexistent/DeepFilterNet3_onnx.tar.gz' }).read().catch(e => e)
	ok(/^deepfilter: can't load DeepFilterNet3 from file:\/\/\/nonexistent\//.test(err?.message), err?.message)
	is(at(() => a().deepfilter(-3)), 'deepfilter: limit is dB, 0 (nothing taken under the voice) or more (Infinity: no limit), not -3', 'under 0: at the call')
	is(at(() => a().deepfilter('abc')), "deepfilter: limit takes dB, not 'abc'", 'a word: at the call')
	for (let [v, want] of [['16', 16], ['16db', 16], [' 12 dB ', 12], ['1e1', 10], [null, null]]) is(a().deepfilter(v).edits[0][1].limit, want, `${JSON.stringify(v)}: read as ${want}`)
	// text as rnnoise's host reads it: a number with its unit, not a word (Infinity is the number, not its name)
	for (let v of ['Infinity', '0x10']) is(at(() => a().deepfilter(v)), `deepfilter: limit takes dB, not '${v}'`, `'${v}': at the call`)
	for (let [o, says] of [[{ floor: -40 }, /^deepfilter: floor is dB under the voice, 0 or more \(0: none\), not -40$/], [{ floor: null }, /^deepfilter: floor is dB under the voice, 0 or more \(0: none\), not null$/], [{ everywhere: 'yes' }, /^deepfilter: everywhere is true or false, not yes$/]]) {
		err = await a().deepfilter(o).read().catch(e => e)
		ok(says.test(err?.message), err?.message)
	}
})

;(HAS_DFN ? test : test.skip)('deepfilter: the package on the op input, unlimited, the input mixed back by its mixback(); its channel only, once', NEURAL_RUN, async () => {
	let { clean, dirty } = take(), calls = 0
	await withImport((spec, orig) => spec === '@audio/neural-denoise' ? orig(spec).then(m => ({ ...m, default: (...a) => (calls++, m.default(...a)) })) : orig(spec), async () => {
		let [input] = await audio.from([dirty], { sampleRate: SR }).gain(-6).read(), [ref] = await audio.from([clean], { sampleRate: SR }).gain(-6).read()
		// the model run again on the take with the room's prediction off where its voice carries a room (roomless())
		let run = x => neural.default(x, { sampleRate: SR, model: 'deepfilternet3', limit: Infinity, music: 'enhance' })
		let y0 = await run([input]), heard = await roomless([input], y0, SR), [y] = heard ? await run(heard) : y0
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
		let one = o => audio.from([input], { sampleRate: SR }).deepfilter({ ...o, music: 'enhance' }).read().then(([v]) => v)
		is(maxDiff(await one({ limit: Infinity }), y), 0, 'limit Infinity: the package unlimited')
		is(maxDiff(await one({ limit: 0, floor: 0 }), input), 0, 'limit 0, floor 0: nothing taken, the take as it went in')
		is(maxDiff(await one({ limit: 0 }), neural.mixback(input, y, { limit: 0, sampleRate: SR })), 0, 'limit 0: nothing taken under the voice, the floor in its pauses')
		is(maxDiff(await one({ everywhere: true }), neural.mixback(input, y, { everywhere: true, sampleRate: SR })), 0, 'everywhere: the floor under the voice too')
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

// limit: how far what the model took comes back down, room tone kept; floor: how far under the voice loud noise ends in
// the voice's pauses (neural-denoise's mixback(), which reads a pause off the model's output: frames 30 dB under its
// voice, 0.3 s or more from it). White noise the model takes whole: in the middle of a 2 s pause, 0.75 s from the voice,
// the floor; within 0.25 s of the voice, the limit, where `everywhere`, the floor under the voice too, takes the floor.
// Held notes, which the model takes for noise, keep their level: VocalSet (Wilkins et al., ISMIR 2018, CC BY 4.0) singer
// F2's straight long tones on /a/, once in the data cache (@audio/neural-denoise README, Accuracy: Singing); before the
// voice guard they lost 17.5 dB, the limit's whole 18.
const HELD = path.join(os.homedir(), '.cache', 'audiojs', 'data', 'vocalset', 'FULL', 'female2', 'long_tones', 'straight', 'f2_long_straight_a.wav')
;(HAS_DFN ? test : test.skip)('deepfilter: in the voice\'s pauses loud noise ends 40 dB under it, near the voice what the model took comes back by the limit, quiet noise drops by the limit; held notes keep their level', NEURAL_RUN, async () => {
	let { clean, dirty } = take(15, 2), quiet = take(45, 2).dirty
	for (let [o, x, want, near] of [[{}, dirty, 'floor', 18], [{ everywhere: true }, dirty, 'floor', 'floor'], [{ floor: 45 }, dirty, 'floor'], [{ limit: 0 }, dirty, 'floor'],
		[{ floor: 0 }, dirty, 18, 18], [{ limit: 6, floor: 0 }, dirty, 6, 6], [{}, quiet, 18]]) {
		let [y] = await audio.from([x], { sampleRate: SR }).deepfilter({ ...o, music: 'enhance' }).read()
		let under = speechDb(y) - floorDb(y, 2), drop = floorDb(x, 2) - floorDb(y, 2), at = o.floor ?? 40, name = `${JSON.stringify(o)}${x === quiet ? ', noise 45 dB under' : ''}`
		if (want === 'floor') ok(Math.abs(under - at) < 1.5, `${name}: the pause ${under.toFixed(1)} dB under the voice (${drop.toFixed(1)} down)`)
		else ok(drop > want - 3 && drop < want + .2, `${name}: the pause ${drop.toFixed(1)} dB down`)
		let by = afterDb(x, .05, .25) - afterDb(y, .05, .25), nearer = speechDb(y) - afterDb(y, .05, .25)
		if (near === 'floor') ok(Math.abs(nearer - at) < 1.5, `${name}: 0.05 to 0.25 s after the voice ${nearer.toFixed(1)} dB under it (${by.toFixed(1)} down)`)
		else if (near) ok(by > near - 3 && by < near + .2, `${name}: 0.05 to 0.25 s after the voice ${by.toFixed(1)} dB down`)
		// the speech's level over its own frames: the pause left out, whose length would change which frames count
		let speech = speechDb(spoken(y, 2)) - speechDb(spoken(clean, 2))
		ok(Math.abs(speech) < 1.5, `speech ${speech.toFixed(2)} dB from the clean take`)
	}
	let [same] = await audio.from([dirty], { sampleRate: SR }).deepfilter({ limit: 0, floor: 0, music: 'enhance' }).read()
	is(maxDiff(same, dirty), 0, 'limit 0, floor 0: the take as it went in, sample for sample')
	if (!existsSync(HELD)) return console.log('  (no VocalSet in the data cache: held notes not checked)')
	let [x] = await audio(HELD).read(), [y] = await audio(HELD).deepfilter().read()
	ok(speechDb(y) - speechDb(x) > -3, `held notes: ${(speechDb(y) - speechDb(x)).toFixed(1)} dB`)
})

// On noise the model leaves some of (the eval's four VoiceBank voices under pink and moving noise as loud as them,
// test/eval/sounds.js, read by its measures), what the two mixes give each other up: the default's gain is at least
// `everywhere`'s in every frame, so it keeps more of the voice the model took (fewer voiced frames lost, the eval's
// `lost`), and `everywhere`'s pauses are cleaner (the noise 0.3 s or more from the voice further under it, its `bed`).
// Of a model that took nothing (its unlimited run given a limit of 0) both would read the same
;(HAS_DFN ? test : test.skip)('deepfilter: on noise the model leaves, the default keeps more of the voice, `everywhere` the cleaner pauses', NEURAL_RUN, async () => {
	let { SOUNDS } = await import('./eval/sounds.js'), { read } = await import('./eval/measures.js')
	for (let noise of ['pink', 'moving']) {
		let snd = await SOUNDS.voices({ noise, snr: 0 }), ctx = { ...snd, x: snd.x[0] }, m = {}
		for (let [k, o] of [['default', {}], ['everywhere', { everywhere: true }]]) {
			let y = await audio.from(snd.x, { sampleRate: snd.fs }).deepfilter(o).read()
			m[k] = { lost: await read('lost', y, ctx), bed: await read('bed', y, ctx) }
		}
		ok(m.default.lost < m.everywhere.lost, `${noise} noise: voiced frames lost ${m.default.lost.toFixed(1)} %, everywhere ${m.everywhere.lost.toFixed(1)} %`)
		ok(m.everywhere.bed > m.default.bed, `${noise} noise: the pauses ${m.default.bed.toFixed(1)} dB under the voice, everywhere ${m.everywhere.bed.toFixed(1)}`)
	}
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
	let [h] = await roomless([wet], [wet], SR), err = v => { let e = 0; for (let i = 0; i < v.length; i++) e += (v[i] - speech[i]) ** 2; return 10 * Math.log10(e) }
	ok(err(h) < err(wet) - 0.5, `nearer the dry voice: ${(err(h) - err(wet)).toFixed(2)} dB of the room off`)
	ok((await roomless([wet], [wet], SR))[0] === h, 'the last one kept: moving the limit fits no room again')
	let music = room(beat(8), 0.6)
	is(await roomless([music], [music], SR), null, 'music in a room: heard once, as it came')
	is(await roomless([wet], [beat(4)], SR), null, 'a voice the model left no room in (here a beat): heard once')
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

;(HAS_DFN && existsSync(VB) ? test : test.skip)('auto: a bed under a voice goes to DeepFilterNet3: near the voice what the model took comes back by the stage\'s limit, SI-SDR 1 dB over chain\'s own; the recipe and its code() say so', NEURAL_RUN, async () => {
	let { render } = await import('../fn/auto.js'), { code } = await import('@audio/chain')
	let [ref] = await audio(VB).read(), x = noisy(ref, 5), fs = 48000
	let [y] = await audio.from([x], { sampleRate: fs }).auto().read(), { channels, recipe } = await render([x], { sampleRate: fs, type: 'speech' })
	is(maxDiff(y, channels[0]), 0, 'the op renders what render() makes')
	let d = recipe.stages.find(s => s.name === 'denoise')
	is(d.atom, '@audio/neural-denoise', `the denoiser that ran: ${JSON.stringify(d.params)}`)
	ok(code(recipe).includes(`import denoise from '@audio/neural-denoise'`) && !code(recipe).includes('omlsa'), 'code() imports it, and no other')
	is((await audio.from([x], { sampleRate: fs }).chain()).stages.find(s => s.name === 'denoise').atom, '@audio/neural-denoise', 'the chain stat\'s recipe')
	// the bed between its words (its quietest tenth of 50 ms frames, within 0.3 s of the voice), dB under the voice: the
	// stage mixes what the model took back by its limit there (@audio/chain's 18 dB), the floor reaching pauses 0.3 s
	// from the voice alone: in 8.4, OM-LSA 26.7, DeepFilterNet3 30.2; SI-SDR in 5.0 dB, OM-LSA 14.2, DeepFilterNet3 15.6
	let F = 2400, frames = []
	for (let i = 0; i + F <= ref.length; i += F) frames.push([rms(ref, i, i + F), i])
	let quiet = frames.sort((a, b) => a[0] - b[0]).slice(0, Math.ceil(frames.length / 10)).map(f => f[1])
	let under = v => speechDb(v) - 10 * Math.log10(quiet.reduce((s, i) => s + rms(v, i, i + F) ** 2, 0) / quiet.length)
	let c = await classical(() => render([x], { sampleRate: fs, type: 'speech' }))
	let { limit } = recipe.stages.find(s => s.name === 'denoise').params
	ok(under(y) - under(x) > limit - 3 && under(y) > under(c.channels[0]), `the bed between the words: ${under(x).toFixed(1)} dB under the voice in, chain's own ${under(c.channels[0]).toFixed(1)}, DeepFilterNet3 ${under(y).toFixed(1)} (its limit ${limit} dB)`)
	let got = sisdr(await toned(ref, recipe, fs), y), was = sisdr(await toned(ref, c.recipe, fs), c.channels[0])
	ok(got > 15.5 && got > was + 1, `SI-SDR ${sisdr(ref, x).toFixed(1)} dB in, chain's own ${was.toFixed(1)}, DeepFilterNet3 ${got.toFixed(1)}`)
})

// In the voice's pauses, 0.3 s and more from it, the stage takes the noise to its floor where the model leaves it none
// and to its limit where it does: on the eval's voices under pink and under moving noise 5 dB down (test/eval/sounds.js,
// its measures), the noise there 10 dB further under the voice than chain's own leaves it, and SI-SDR 1 dB higher
;(HAS_DFN ? test : test.skip)('auto: on the eval\'s voices under noise, DeepFilterNet3\'s pauses 10 dB further down than chain\'s own, SI-SDR 1 dB higher', NEURAL_RUN, async () => {
	let { SOUNDS } = await import('./eval/sounds.js'), { read } = await import('./eval/measures.js')
	for (let noise of ['pink', 'moving']) {
		let snd = await SOUNDS.voices({ noise, snr: 5 }), ctx = { ...snd, x: snd.x[0] }
		let y = await audio.from(snd.x, { sampleRate: snd.fs }).auto().read(), c = await classical(() => audio.from(snd.x, { sampleRate: snd.fs }).auto().read())
		let [bed, was, got, had] = [await read('bed', y, ctx), await read('bed', c, ctx), await read('sisdr', y, ctx), await read('sisdr', c, ctx)]
		ok(bed > was + 10, `${noise} noise: the pauses ${bed.toFixed(1)} dB under the voice, chain's own ${was.toFixed(1)}`)
		ok(got > had + 1, `${noise} noise: SI-SDR ${got.toFixed(2)} dB, chain's own ${had.toFixed(2)}`)
	}
})

// Asking for the plan (the chain stat) loads no model and runs none: the package's load, its model run and its music
// guard are not called, nothing is fetched, the neural stage named with a note that the render decides. Offline (the
// neural cache an empty folder, fetch one that records each request and refuses it) the render asks for the model and,
// refused, takes chain's own denoiser in the stage's place, its recipe's notes saying why: the take as without the
// package, never an error, nothing written into the cache
;(neural ? test : test.skip)('auto: the plan loads no model; offline the render takes chain\'s own denoiser, its notes saying so', NEURAL_RUN, async () => {
	await audio.use('auto')   // the chain stat, which its module registers
	let { render } = await import('../fn/auto.js'), { dirty } = take(5), { mkdtempSync, readdirSync, rmSync } = await import('node:fs')
	let dir = mkdtempSync(path.join(os.tmpdir(), 'audio-neural-')), env = process.env.AUDIO_NEURAL_CACHE, fetched = globalThis.fetch, asked = [], called = []
	process.env.AUDIO_NEURAL_CACHE = dir
	globalThis.fetch = async url => { asked.push(String(url)); throw new TypeError('fetch failed: offline') }
	try {
		// chain's plan with a note of its own, which the stage's note follows
		let own = "chain's note", noting = m => ({ ...m, plan: (...a) => { let r = m.plan(...a); return { ...r, notes: [...r.notes ?? [], own] } } })
		await withImport((spec, orig) => spec === '@audio/neural-denoise' ? orig(spec).then(m => ({ ...m, ...Object.fromEntries(['load', 'default', 'guard', 'mixback'].map(k => [k, (...a) => (called.push(k), m[k](...a))])) }))
			: spec === audio.plugins.auto ? orig(spec).then(noting) : orig(spec), async () => {
			let plan = await audio.from([dirty], { sampleRate: SR }).stat('chain')
			is(plan.stages.find(s => s.name === 'denoise')?.atom, '@audio/neural-denoise', 'the plan names the neural stage')
			is([asked, called], [[], []], 'asking for the plan: nothing fetched, the package\'s load, run, guard and mix not called')
			ok(plan.notes?.[0] === own && /^DeepFilterNet3 and its music guard hear the take as auto\(\) renders it/.test(plan.notes[1]) && plan.notes.length === 2, `the plan's own note, then the stage's: ${plan.notes}`)
			let [y] = await audio.from([dirty], { sampleRate: SR }).auto().read(), r = await render([dirty], { sampleRate: SR, type: 'speech' })
			ok(asked.length > 0 && called.includes('load'), `the render asks for the model: ${asked.length} request(s), each refused`)
			is(r.recipe.stages.find(s => s.name === 'denoise').atom, '@audio/denoise-omlsa', "offline: chain's own denoiser in the stage's place")
			ok(r.recipe.notes?.[0] === own && /^DeepFilterNet3 did not load \(.*\): chain's own denoiser takes the bed/.test(r.recipe.notes[1]) && r.recipe.notes.length === 2, `the plan's own note, then why: ${r.recipe.notes}`)
			let c = await classical(() => render([dirty], { sampleRate: SR, type: 'speech' }))
			is([maxDiff(y, c.channels[0]), maxDiff(r.channels[0], c.channels[0])], [0, 0], 'the take as without the package, sample for sample')
		})
		is(readdirSync(dir), [], 'nothing written into the cache')
	} finally {
		globalThis.fetch = fetched
		if (env === undefined) delete process.env.AUDIO_NEURAL_CACHE; else process.env.AUDIO_NEURAL_CACHE = env
		rmSync(dir, { recursive: true, force: true })
	}
})

// The plan asked for first, in a process of its own (a module once loaded stays loaded): a.stat('chain') loads the
// manifest that hosts it, as a registry stat loads inside a.stat(name)
test('auto: a.stat(\'chain\') asked first in a process: the plan, its module loaded by the stat\'s name', async () => {
	let { execFileSync } = await import('node:child_process')
	let script = `import audio from './audio.js'; globalThis.fetch = async () => { throw new TypeError('offline') }
		let p = await audio.from([Float32Array.from({ length: 48000 }, (_, i) => 0.1 * Math.sin(i / 7))], { sampleRate: 48000 }).stat('chain')
		console.log(JSON.stringify(p.stages.map(s => s.name))); process.exit(0)`
	let out = execFileSync(process.execPath, ['--input-type=module', '-e', script], { cwd: new URL('..', import.meta.url), encoding: 'utf8' }).trim()
	ok(JSON.parse(out).includes('hpf'), `the plan: ${out}`)
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
	let [all] = await audio.from([dirty], { sampleRate: SR }).denoise(Infinity, { noise: PAUSE }).read()
	ok(rest(all) === -Infinity && all.every(Number.isFinite), 'reduction Infinity: the noise taken whole, the pause digital silence')
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

// ════════════════════════════════════════════════════════════════════════════
// dereverb (fn/dereverb.js): a trained model by default, anvuew's room de-reverb through the optional
// @audio/neural-separate, music passed by @audio/neural-denoise's guard; @audio/denoise-dereverb's kernel by
// { method: 'wpe' } (above). The model's tests run once it is in the neural cache, so the suite never downloads. The
// voice: VoiceBank's p232 (as auto's tests above), in the velvet-noise room the wpe tests use.
// ════════════════════════════════════════════════════════════════════════════

const separate = await import('@audio/neural-separate').catch(() => null)
const NEURAL_DIR = process.env.AUDIO_NEURAL_CACHE || path.join(os.homedir(), '.cache', 'audiojs', 'neural')
const HAS_ROOM = !!separate?.models['dereverb-room'] && ['dereverb-room.fp16.onnx', 'dereverb-room.onnx'].some(f => existsSync(path.join(NEURAL_DIR, 'dereverb-room', f)))

test('dereverb: without @audio/neural-separate it names the package and wpe, which runs; bad options name themselves', async () => {
	let a = () => audio.from([lena.slice(0, SR)], { sampleRate: SR })
	await withImport((spec, orig) => spec.startsWith('@audio/neural-separate') ? Promise.reject(new Error(`Cannot find package '${spec}'`)) : orig(spec), async () => {
		let err = await a().dereverb({ music: 'enhance' }).read().catch(e => e)
		ok(/^dereverb: install @audio\/neural-separate .*method: 'wpe'/.test(err?.message), err?.message)
		is((await a().dereverb({ method: 'wpe' }).read())[0].length, SR, 'wpe needs no model')
	})
	// no model needed where nothing is to be taken: an empty input, reduction 0; the input comes back bit for bit
	await withImport((spec, orig) => spec.startsWith('@audio/neural-') ? Promise.reject(new Error(`Cannot find package '${spec}'`)) : orig(spec), async () => {
		is((await audio.from([new Float32Array(0)], { sampleRate: SR }).dereverb().read())[0].length, 0, 'an empty input: empty, no package asked for')
		let x = lena.slice(0, SR), [y] = await audio.from([x], { sampleRate: SR }).dereverb(0).read()
		is(maxDiff(y, x), 0, 'reduction 0: the input bit for bit, no package asked for')
		let [l, r] = await audio.from([x, x], { sampleRate: SR }).dereverb({ method: 'wpe', channel: 1 }).read()
		is(maxDiff(l, x), 0, 'channel 1: the other channel as it came')
		is(maxDiff(r, (await audio.from([x], { sampleRate: SR }).dereverb({ method: 'wpe' }).read())[0]), 0, '…and channel 1 as the kernel makes it alone')
	})
	for (let [o, re] of [[-3, /^dereverb: reduction is dB/], [{ method: 'model' }, /^dereverb: method is roformer or wpe/], [{ music: 'keep' }, /^dereverb: music is pass or enhance/]]) {
		let err = await a().dereverb(o).read().catch(e => e)
		ok(re.test(err?.message), err?.message)
	}
})

;(HAS_ROOM && existsSync(VB) ? test : test.skip)('dereverb: a voice in a room comes out nearer the dry voice; reduction mixes the room back, y + 10^(−dB/20)·(x − y), the model\'s whole output at Infinity', NEURAL_RUN, async () => {
	let a = await audio(VB), fs = a.sampleRate, [dry] = await a.read(), wet = room(dry, 0.6, 0)
	let [y] = await audio.from([wet], { sampleRate: fs }).dereverb(Infinity).read()
	is(y.length, wet.length)
	ok(sisdr(dry, y) > sisdr(dry, wet) + 6, `SI-SDR against the dry voice ${sisdr(dry, wet).toFixed(1)} → ${sisdr(dry, y).toFixed(1)} dB`)
	let [r] = await audio.from([wet], { sampleRate: fs }).dereverb(12).read(), k = 10 ** (-12 / 20)
	ok(maxDiff(r, Float32Array.from(wet, (v, i) => y[i] + k * (v - y[i]))) < 1e-6, 'reduction 12: the room 12 dB down, mixed back into the model\'s voice')
	let [g] = await audio.from([wet], { sampleRate: fs }).dereverb({ at: 1, duration: 1 }).read(), moved = [0, 0]
	for (let i = 0; i < wet.length; i++) moved[+(i >= fs && i < 2 * fs)] += g[i] !== wet[i]
	ok(moved[0] === 0 && moved[1] > .9 * fs, `{ at: 1, duration: 1 }: ${moved[1]} samples changed inside, ${moved[0]} outside`)
	let [w] = await audio.from([wet], { sampleRate: fs }).dereverb({ method: 'wpe' }).read()
	ok(sisdr(dry, y) > sisdr(dry, w) + 3, `the model over wpe: ${sisdr(dry, w).toFixed(1)} → ${sisdr(dry, y).toFixed(1)} dB`)
})

;(HAS_ROOM && neural?.guard ? test : test.skip)('dereverb: music in a room passes untouched; music: \'enhance\' takes it as a room', NEURAL_RUN, async () => {
	let x = room(band(6), 0.6), [y] = await audio.from([x], { sampleRate: SR }).dereverb().read()
	is(maxDiff(y, x), 0, 'the band in a room as it went in')
	let [z] = await audio.from([x], { sampleRate: SR }).dereverb({ music: 'enhance' }).read()
	ok(maxDiff(z, x) > .01, `music: 'enhance': changed, by up to ${maxDiff(z, x).toFixed(2)}`)
})
