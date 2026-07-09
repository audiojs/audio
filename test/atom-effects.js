// Effect-family atoms exercised through the real engine (audio.use + .read()).
// One defining-property test per atom — mirrors each atom's own standalone verification
// (see @audio/effect/packages/effect-<atom>/atom.js). Imports are relative-path
// into the sibling checkout (the effect family isn't published/linked into node_modules
// yet); switch to '@audio/effect-<atom>/atom' once it is.

import test, { ok } from 'tst'
import audio from '../audio.js'

import { chorus } from '@audio/effect-chorus/atom'
import { flanger } from '@audio/effect-flanger/atom'
import { phaser } from '@audio/effect-phaser/atom'
import { tremolo } from '@audio/effect-tremolo/atom'
import { vibrato } from '@audio/effect-vibrato/atom'
import { autowah } from '@audio/effect-autowah/atom'
import { wah } from '@audio/effect-wah/atom'
import { bitcrusher } from '@audio/effect-bitcrusher/atom'
import { distortion } from '@audio/effect-distortion/atom'
import { exciter } from '@audio/effect-exciter/atom'
import { ringmod } from '@audio/effect-ringmod/atom'
import { freqshift } from '@audio/effect-freqshift/atom'
import { multitap } from '@audio/effect-multitap/atom'
import { pingpong } from '@audio/effect-pingpong/atom'
import { slew } from '@audio/effect-slew/atom'
import { noiseshaper } from '@audio/effect-noiseshaper/atom'
import { lofi } from '@audio/effect-lofi/atom'
import { graindelay } from '@audio/effect-graindelay/atom'
import { stutter } from '@audio/effect-stutter/atom'
import { subbass } from '@audio/effect-subbass/atom'
import { sbr } from '@audio/effect-sbr/atom'

audio.use(chorus, flanger, phaser, tremolo, vibrato, autowah, wah, bitcrusher, distortion,
	exciter, ringmod, freqshift, multitap, pingpong, slew, noiseshaper, lofi, graindelay,
	stutter, subbass, sbr)

const SR = 44100

function tone(freq, dur, amp = 0.7, sr = SR) {
	let n = Math.round(dur * sr), d = new Float32Array(n)
	for (let i = 0; i < n; i++) d[i] = amp * Math.sin(2 * Math.PI * freq * i / sr)
	return d
}
function impulse(n, amp = 1) { let d = new Float32Array(n); d[0] = amp; return d }
function rms(d, from = 0, to = d.length) { let s = 0; for (let i = from; i < to; i++) s += d[i] * d[i]; return Math.sqrt(s / (to - from)) }
/** Goertzel magnitude at f Hz. */
function goertzel(buf, f, sr = SR, from = 0, to = buf.length) {
	let w = 2 * Math.PI * f / sr, coeff = 2 * Math.cos(w), s1 = 0, s2 = 0
	for (let i = from; i < to; i++) { let s = buf[i] + coeff * s1 - s2; s2 = s1; s1 = s }
	return Math.sqrt(Math.max(0, s1 * s1 + s2 * s2 - coeff * s1 * s2))
}
/** [min,max] RMS across short windows — detects "a fixed tone's level swings over time". */
function envelopeSpread(d, sr = SR, winSec = 0.08) {
	let winN = Math.round(winSec * sr), min = Infinity, max = 0
	for (let i = 0; i + winN <= d.length; i += winN) {
		let r = rms(d, i, i + winN)
		if (r < min) min = r
		if (r > max) max = r
	}
	return [min, max]
}

test('chorus: smears the fundamental relative to depth=0 (detuned voices beat)', async () => {
	let flat = (await audio.from([tone(1000, 1.5)], { sampleRate: SR }).chorus({ depth: 0 }).read())[0]
	let wet = (await audio.from([tone(1000, 1.5)], { sampleRate: SR }).chorus({ depth: 0.6 }).read())[0]
	let eFlat = goertzel(flat, 1000, SR, 4000, 66150), eWet = goertzel(wet, 1000, SR, 4000, 66150)
	ok(eWet < eFlat * 0.9, `1kHz energy depth=0 ${eFlat.toFixed(1)} -> depth=0.6 ${eWet.toFixed(1)}`)
})

test('flanger: comb notch sweeps — a fixed tone rises and falls in level over time', async () => {
	let out = (await audio.from([tone(1200, 3, 0.7)], { sampleRate: SR }).flanger({ rate: 1, depth: 0.9, delay: 3, feedback: 0.6 }).read())[0]
	let [min, max] = envelopeSpread(out.subarray(0, 3 * SR))
	ok(max > min * 1.5, `1.2kHz level swings as the comb sweeps: min ${min.toFixed(3)} .. max ${max.toFixed(3)} (${(max / min).toFixed(2)}x)`)
})

test('phaser: swept notches — a fixed tone rises and falls in level over time', async () => {
	let out = (await audio.from([tone(1500, 3, 0.7)], { sampleRate: SR }).phaser({ rate: 0.7, depth: 0.9, feedback: 0.7, fc: 1000, stages: 4 }).read())[0]
	let [min, max] = envelopeSpread(out)
	ok(max > min * 1.5, `1.5kHz level swings as notches sweep: min ${min.toFixed(3)} .. max ${max.toFixed(3)} (${(max / min).toFixed(2)}x)`)
})

test('tremolo: amplitude envelope periodicity matches the set rate', async () => {
	let dcIn = new Float32Array(2 * SR).fill(0.8)
	let out = (await audio.from([dcIn], { sampleRate: SR }).tremolo({ rate: 5, depth: 1 }).read())[0]
	let eRate = goertzel(out, 5, SR), e2xRate = goertzel(out, 10, SR)
	ok(eRate > e2xRate * 5, `envelope energy at 5Hz ${eRate.toFixed(0)} >> at 10Hz ${e2xRate.toFixed(0)}`)
})

test('vibrato: smears the fundamental relative to a near-zero-depth baseline', async () => {
	let flat = (await audio.from([tone(440, 1.5)], { sampleRate: SR }).vibrato({ depth: 0.0005 }).read())[0]
	let wet = (await audio.from([tone(440, 1.5)], { sampleRate: SR }).vibrato({ depth: 0.015 }).read())[0]
	let eFlat = goertzel(flat, 440, SR, 4000, 66150), eWet = goertzel(wet, 440, SR, 4000, 66150)
	ok(eWet < eFlat * 0.85, `440Hz energy depth=0.5ms ${eFlat.toFixed(1)} -> depth=15ms ${eWet.toFixed(1)}`)
})

test('autowah: louder input opens the filter, passing more of a fixed high test tone', async () => {
	let f = 2500, loud = tone(f, 1, 0.8), quiet = tone(f, 1, 0.05)
	let outLoud = (await audio.from([loud], { sampleRate: SR }).autowah({ base: 300, range: 3000, Q: 3 }).read())[0]
	let outQuiet = (await audio.from([quiet], { sampleRate: SR }).autowah({ base: 300, range: 3000, Q: 3 }).read())[0]
	let passLoud = rms(outLoud, SR / 4) / rms(loud, SR / 4)
	let passQuiet = rms(outQuiet, SR / 4) / rms(quiet, SR / 4)
	ok(passLoud > passQuiet * 1.4, `pass-ratio @2.5kHz: loud ${passLoud.toFixed(3)} vs quiet ${passQuiet.toFixed(3)}`)
})

test('wah (manual): static resonant bandpass keeps fc, suppresses a far tone', async () => {
	let near = tone(1000, 1, 0.7), far = tone(4000, 1, 0.7)
	let outNear = (await audio.from([near], { sampleRate: SR }).wah({ fc: 1000, Q: 6, mode: 'manual' }).read())[0]
	let outFar = (await audio.from([far], { sampleRate: SR }).wah({ fc: 1000, Q: 6, mode: 'manual' }).read())[0]
	let passNear = rms(outNear, SR / 4) / rms(near, SR / 4)
	let passFar = rms(outFar, SR / 4) / rms(far, SR / 4)
	ok(passNear > passFar * 3, `pass-ratio: at fc ${passNear.toFixed(3)} vs far ${passFar.toFixed(3)}`)
})

test('bitcrusher: quantizes to a small distinct-value grid', async () => {
	let dry = tone(300, 1024 / SR, 0.9)
	let out = (await audio.from([dry], { sampleRate: SR }).bitcrusher({ bits: 4, rate: 1 }).read())[0]
	let dIn = new Set(dry).size, dOut = new Set(out).size
	ok(dOut <= 20 && dOut < dIn / 10, `distinct values: dry ${dIn} -> crushed ${dOut}`)
})

test('distortion: adds a 3rd-harmonic absent from the dry sine', async () => {
	let dry = tone(440, 4096 / SR, 0.7)
	let out = (await audio.from([dry], { sampleRate: SR }).distortion({ drive: 0.8, type: 'soft', mix: 1 }).read())[0]
	let eDry = goertzel(dry, 1320, SR), eWet = goertzel(out, 1320, SR)
	ok(eWet > eDry * 20, `3rd-harmonic (1320Hz) energy: dry ${eDry.toFixed(3)} -> wet ${eWet.toFixed(2)}`)
})

test('exciter: synthesizes a 3rd-harmonic above a high-band test tone (tanh saturation is odd -> odd harmonics)', async () => {
	let dry = tone(4000, 4096 / SR, 0.7)
	let out = (await audio.from([dry], { sampleRate: SR }).exciter({ freq: 2000, drive: 0.8, amount: 0.8 }).read())[0]
	let eDry = goertzel(dry, 12000, SR), eWet = goertzel(out, 12000, SR)
	ok(eWet > eDry * 5 + 1e-6, `3rd-harmonic (12kHz) energy: dry ${eDry.toFixed(4)} -> wet ${eWet.toFixed(3)}`)
})

test('ringmod: produces sum/difference sidebands, not the original tone', async () => {
	let out = (await audio.from([tone(440, 4096 / SR, 0.7)], { sampleRate: SR }).ringmod({ fc: 100, mix: 1 }).read())[0]
	let eOrig = goertzel(out, 440, SR), eLo = goertzel(out, 340, SR), eHi = goertzel(out, 540, SR)
	ok(eLo > eOrig * 5 && eHi > eOrig * 5, `sidebands 340Hz ${eLo.toFixed(1)}, 540Hz ${eHi.toFixed(1)} >> carrier-leak @440Hz ${eOrig.toFixed(2)}`)
})

test('freqshift: shifts the tone peak by the declared Hz offset (latency-compensated)', async () => {
	let out = (await audio.from([tone(440, 8192 / SR, 0.7)], { sampleRate: SR }).freqshift({ shift: 200, mix: 1, taps: 65 }).read())[0]
	let e440 = goertzel(out, 440, SR, 200), e640 = goertzel(out, 640, SR, 200)
	ok(e640 > e440, `shifted energy @640Hz ${e640.toFixed(0)} > original @440Hz ${e440.toFixed(0)}`)
})

test('multitap: echoes at the two fixed tap times', async () => {
	let out = (await audio.from([impulse(SR)], { sampleRate: SR }).multitap({ feedback: 0 }).read())[0]
	let at1 = Math.abs(out[Math.round(0.25 * SR)]), at2 = Math.abs(out[Math.round(0.5 * SR)])
	ok(at1 > 0.3 && at2 > 0.2, `tap1@0.25s=${at1.toFixed(3)}, tap2@0.5s=${at2.toFixed(3)}`)
})

test('pingpong: echo crosses to the other channel at ~2x the set time', async () => {
	let [, outR] = await audio.from([impulse(SR), new Float32Array(SR)], { sampleRate: SR }).pingpong({ time: 0.1, feedback: 0.5, mix: 0.5 }).read()
	let peak = 0
	for (let i = 8000; i < 10000; i++) if (Math.abs(outR[i]) > peak) peak = Math.abs(outR[i])
	ok(peak > 0.01, `right-channel cross-feed peak near 2×time: ${peak.toFixed(3)}`)
})

test('slew: clamps rate of change on a step', async () => {
	let step = new Float32Array([0, 0, 0, 1, 1, 1, 1, 1, 1, 1])
	let out = (await audio.from([step], { sampleRate: SR }).slew({ rise: 22050, fall: 22050 }).read())[0]
	ok(out[3] <= 0.51 && out[3] > 0, `step-limited sample[3] = ${out[3].toFixed(3)} (rise-limited, still rising)`)
})

test('noiseshaper: quantizes to the bit-depth grid exactly', async () => {
	let out = (await audio.from([tone(100, 256 / SR, 0.5)], { sampleRate: SR }).noiseshaper({ bits: 8 }).read())[0]
	let scale = Math.pow(2, 7)
	let onGrid = true
	for (let i = 0; i < out.length; i++) if (Math.abs(Math.round(out[i] * scale) / scale - out[i]) > 1e-6) { onGrid = false; break }
	ok(onGrid, `all ${out.length} samples land on the 8-bit grid`)
})

test('lofi: bandwidth ceiling crushes HF, keeps LF', async () => {
	let n = SR, d = new Float32Array(n)
	for (let i = 0; i < n; i++) d[i] = 0.4 * (Math.sin(2 * Math.PI * 500 * i / SR) + Math.sin(2 * Math.PI * 12000 * i / SR))
	let out = (await audio.from([d], { sampleRate: SR }).lofi({ lowpass: 3000, wow: 0, flutter: 0, noise: 0, crackle: 0, drive: 0 }).read())[0]
	let e500 = goertzel(out, 500, SR, 0, n), e12k = goertzel(out, 12000, SR, 0, n)
	ok(e12k < e500 * 0.15, `12kHz ${e12k.toFixed(2)} << 500Hz ${e500.toFixed(1)} (ratio ${(e12k / e500).toFixed(3)})`)
})

test('graindelay: silent until the delay time, then grains appear', async () => {
	let n = SR, d = new Float32Array(n)
	for (let i = 0; i < 4410; i++) d[i] = Math.sin(2 * Math.PI * 440 * i / SR)
	let out = (await audio.from([d], { sampleRate: SR }).graindelay({ time: 0.25, spray: 0.02, mix: 0.5, feedback: 0 }).read())[0]
	let pre = 0, post = 0
	for (let i = 5000; i < 10000; i++) pre = Math.max(pre, Math.abs(out[i]))
	for (let i = 11500; i < 16000; i++) post = Math.max(post, Math.abs(out[i]))
	ok(pre < 0.01 && post > 0.05, `silent pre-delay ${pre.toFixed(4)}, grains post-delay ${post.toFixed(3)}`)
})

test('stutter: captured slice repeats fill the interval', async () => {
	let n = SR, d = new Float32Array(n)
	for (let i = 0; i < 5512; i += 500) d[i] = 1
	let out = (await audio.from([d], { sampleRate: SR }).stutter({ interval: 0.5, slice: 0.125, decay: 0, mix: 1 }).read())[0]
	let hits = 0
	for (let i = 5513; i < 22050; i++) if (Math.abs(out[i]) > 0.5) hits++
	ok(hits >= 20, `${hits} repeat-hits after capture (>=20 expected)`)
})

test('subbass: generates low-mid harmonics from a sub tone', async () => {
	let n = SR, d = new Float32Array(n)
	for (let i = 0; i < n; i++) d[i] = 0.7 * Math.sin(2 * Math.PI * 60 * i / SR)
	let h2dry = goertzel(d, 120, SR), h3dry = goertzel(d, 180, SR)
	let out = (await audio.from([d], { sampleRate: SR }).subbass({ freq: 80, amount: 0.8, drive: 0.7 }).read())[0]
	let h2wet = goertzel(out, 120, SR), h3wet = goertzel(out, 180, SR)
	ok(h2wet > h2dry * 3 || h3wet > h3dry * 3, `2nd harm ${h2dry.toFixed(2)}->${h2wet.toFixed(1)}, 3rd ${h3dry.toFixed(2)}->${h3wet.toFixed(1)}`)
})

test('sbr: regenerates content above the cutoff, keeps the program band', async () => {
	let n = SR, d = new Float32Array(n)
	for (let i = 0; i < n; i++) d[i] = 0.6 * Math.sin(2 * Math.PI * 3000 * i / SR)
	let above = goertzel(d, 6000, SR)
	let out = (await audio.from([d], { sampleRate: SR }).sbr({ cutoff: 4000, amount: 0.8, drive: 0.7 }).read())[0]
	let aboveWet = goertzel(out, 6000, SR), progWet = goertzel(out, 3000, SR), progDry = goertzel(d, 3000, SR)
	ok(aboveWet > above * 5 + 1e-6 && progWet > progDry * 0.85, `6kHz ${above.toFixed(2)}->${aboveWet.toFixed(1)}, program 3kHz preserved ${(progWet / progDry).toFixed(2)}x`)
})

test('param-dependent tail: pad scales with live feedback, not declared max', async () => {
  let short = audio.from([tone(440, 0.5)], { sampleRate: SR }).pingpong({ time: 0.25, feedback: 0.3 })
  let long = audio.from([tone(440, 0.5)], { sampleRate: SR }).pingpong({ time: 0.25, feedback: 0.8 })
  ok(long.duration > short.duration, `higher feedback → longer tail (${short.duration.toFixed(1)}s < ${long.duration.toFixed(1)}s)`)
  ok(long.duration < 30, `far below the 140s worst-case pad (${long.duration.toFixed(1)}s)`)
})
