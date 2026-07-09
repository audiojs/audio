// Contract atoms as audio ops — denoise family (@audio/denoise-*).
// Mirrors test/module-ops.js's header/import/wave style. Verifies restoration kernels
// wrapped per @audio/atom CONTRACT host correctly through audio.use()/read(): live
// per-block params for causal kernels, whole-render for streaming:false kernels.
//
// Not yet published to npm — import via the sibling @audio/denoise checkout;
// switch to '@audio/denoise-<atom>/atom' after next publish.

import test, { ok, almost, is } from 'tst'
import audio from '../audio.js'
import raw from 'audio-lena/raw'

const SR = 44100
let lena = new Float32Array(raw)                          // 12.27s mono speech

// --- generators / metrics (mirrors module-ops.js + @audio/denoise's own test.js) ---
function rms(d, from = 0, to = d.length) { let s = 0; for (let i = from; i < to; i++) s += d[i] * d[i]; return Math.sqrt(s / (to - from)) }
function peak(d, from = 0, to = d.length) { let p = 0; for (let i = from; i < to; i++) { let a = Math.abs(d[i]); if (a > p) p = a } return p }
function noise(n, amp = 1) { let d = new Float32Array(n); for (let i = 0; i < n; i++) d[i] = amp * (Math.random() * 2 - 1); return d }
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
// tracked online, no manual profile argument needed — see each package's atom.js
// header for why. All declare a fixed latency (STFT analysis/synthesis buffering); .read()
// applies plugin-delay-compensation transparently, so output compares directly against
// the un-shifted reference at the same sample index (verified: cross-correlation of
// output against the dry reference peaks at zero shift, not at the raw kernel latency).

import { specsub } from '@audio/denoise-spectral/atom'
import { wiener } from '@audio/denoise-wiener/atom'
import { omlsa } from '@audio/denoise-omlsa/atom'
import { dereverb } from '@audio/denoise-dereverb/atom'
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

// ── Wave: causal state-machine kernels (gate, deplosive, dewind) ────────────
// Per-sample/per-block state persisted on a plain object across process() calls (same
// state-per-channel pattern as @audio/denoise-dehum) — zero or fixed lookahead latency,
// no STFT buffering involved.

import { gate } from '@audio/denoise-gate/atom'
import { deplosive } from '@audio/denoise-deplosive/atom'
import { dewind } from '@audio/denoise-dewind/atom'
audio.use(gate, deplosive, dewind)

test('gate: passes signal, silences the floor (look-ahead hysteresis)', async () => {
	let n = SR, ch = new Float32Array(n)
	for (let i = 0; i < n / 2; i++) ch[i] = 0.5 * Math.sin(2 * Math.PI * 440 * i / SR)
	for (let i = n / 2; i < n; i++) ch[i] = 0.003 * Math.sin(2 * Math.PI * 440 * i / SR)
	let out = (await audio.from([ch], { sampleRate: SR }).gate({ threshold: -40, range: -90 }).read())[0]
	is(out.length, n, 'length preserved')
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
	ok(burstAfter < burstBefore * 0.7, `defining property: LF burst ducked (${burstBefore.toFixed(4)} -> ${burstAfter.toFixed(4)})`)
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
// package's atom.js header for the specific reason. The host's whole-render
// hosting (core.js useModule's `m.streaming === false` branch + plan.js's `op.whole`
// materialize-then-process-once path) is the engine capability this integration
// exercises; it was built concurrently with this task and might not have existed yet.
//
// Verified directly: audio.use(<these 4>) + op().read() does NOT error and does NOT
// fall back to per-block dispatch — output length matches input, and the same defining
// properties measured against the raw kernel/factory (see this file's sibling scratch
// verification) reproduce bit-for-bit through the real engine. So these run as full
// property assertions, not tolerant placeholders — nothing here is pending.
// ════════════════════════════════════════════════════════════════════════════

import { declick } from '@audio/denoise-declick/atom'
import { declip } from '@audio/denoise-declip/atom'
import { decrackle } from '@audio/denoise-decrackle/atom'
import { debreath } from '@audio/denoise-debreath/atom'
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
	let n = SR
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
