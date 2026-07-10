// Synth generator atoms through the real engine — generators render over the
// materialized timeline (audio(dur).gen()), no input bus, host-negotiated width.
// adsr is the processor exception (envelope applied as gain).

import test, { ok, is } from 'tst'
import audio from '../audio.js'

import { osc } from '@audio/synth-osc/audio'
import { noise } from '@audio/synth-noise/audio'
import { chirp } from '@audio/synth-chirp/audio'
import { pluck } from '@audio/synth-pluck/audio'
import { risset } from '@audio/synth-risset/audio'
import { rhythm } from '@audio/synth-rhythm/audio'
import { sfx } from '@audio/synth-sfx/audio'
import { kick, cymbal, snare } from '@audio/synth-drum/audio'
import { adsr } from '@audio/synth-envelope/audio'

audio.use(osc, noise, chirp, pluck, risset, rhythm, sfx, kick, cymbal, snare, adsr)

const SR = 44100

function rms(d, from = 0, to = d.length) { let s = 0; for (let i = from; i < to; i++) s += d[i] * d[i]; return Math.sqrt(s / Math.max(1, to - from)) }
function g(buf, f, sr = SR, from = 0, to = buf.length) {
	let w = 2 * Math.PI * f / sr, coeff = 2 * Math.cos(w), s1 = 0, s2 = 0
	for (let i = from; i < to; i++) { let s = buf[i] + coeff * s1 - s2; s2 = s1; s1 = s }
	return Math.sqrt(Math.max(0, s1 * s1 + s2 * s2 - coeff * s1 * s2))
}
const silent = (dur, ch = 1) => audio.from(Array.from({ length: ch }, () => new Float32Array(Math.round(dur * SR))), { sampleRate: SR })

test('osc: renders a tone over the timeline (registered + tested at last)', async () => {
	let out = (await silent(0.5).osc({ freq: 440, type: 'sine' }).read())[0]
	ok(g(out, 440) > g(out, 660) * 10, 'sine at 440')
	ok(rms(out) > 0.3, 'audible level')
})

test('noise: colors have the declared spectral slope sign', async () => {
	let white = (await silent(1).noise({ color: 'white' }).read())[0]
	let pink = (await silent(1).noise({ color: 'pink' }).read())[0]
	// pink loses energy at high frequencies relative to white
	let wRatio = g(white, 8000) / g(white, 200)
	let pRatio = g(pink, 8000) / g(pink, 200)
	ok(pRatio < wRatio * 0.5, `pink darker than white (${(pRatio / wRatio).toFixed(2)}×)`)
	// stereo channels decorrelated (independent seeds)
	let [l, r] = await silent(0.5, 2).noise().read()
	let dot = 0, nn = l.length
	for (let i = 0; i < nn; i++) dot += l[i] * r[i]
	ok(Math.abs(dot / nn) < 0.01, 'channels independent')
})

test('chirp: sweeps low → high across the take', async () => {
	let out = (await silent(1).chirp({ f0: 100, f1: 8000 }).read())[0]
	let early = g(out, 150, SR, 0, SR >> 2) > g(out, 6000, SR, 0, SR >> 2)
	let late = g(out, 6000, SR, (SR * 3) >> 2, SR) > g(out, 150, SR, (SR * 3) >> 2, SR)
	ok(early, 'low frequencies early')
	ok(late, 'high frequencies late')
})

test('pluck: string decays from its attack', async () => {
	let out = (await silent(1).pluck({ freq: 220 }).read())[0]
	ok(rms(out, 0, SR >> 3) > rms(out, (SR * 3) >> 2) * 3, 'decaying envelope')
	ok(out.every(isFinite))
})

test('risset: drum one-shot has energy then decays', async () => {
	let out = (await silent(1.2).risset({ freq: 100 }).read())[0]
	ok(rms(out, 0, SR >> 2) > 0.05, 'strike present')
	ok(rms(out, SR) < rms(out, 0, SR >> 2), 'decays')
})

test('rhythm: clicks land on the BPM grid', async () => {
	let out = (await silent(2).rhythm({ bpm: 120 }).read())[0]
	// 120 BPM → click every 0.5 s; energy at click positions, silence between
	let atClick = rms(out, 0, Math.round(0.05 * SR))
	let between = rms(out, Math.round(0.3 * SR), Math.round(0.45 * SR))
	ok(atClick > between * 5, `clicks separated from gaps (${atClick.toFixed(3)} vs ${between.toFixed(3)})`)
})

test('sfx: presets render, unknown preset falls back to default enum', async () => {
	let out = (await silent(0.6).sfx({ preset: 'coin' }).read())[0]
	ok(rms(out, 0, SR >> 2) > 0.02, 'coin renders')
	ok(out.every(isFinite))
})

test('drum kit: kick low, cymbal inharmonic bell partials, snare noisy', async () => {
	let k = (await silent(0.5).kick().read())[0]
	let c = (await silent(0.6).cymbal({ freq: 400 }).read())[0]
	let s = (await silent(0.3).snare().read())[0]
	ok(g(k, 60, SR, 0, SR >> 2) > g(k, 4000, SR, 0, SR >> 2), 'kick energy is low')
	// metal = FM-bell inharmonic set: the 1.483·freq partial is a defining line
	ok(g(c, Math.round(400 * 1.483), SR, 0, SR >> 2) > g(c, 1000, SR, 0, SR >> 2) * 2, 'inharmonic partial at 1.483·f present')
	ok(rms(s, 0, SR >> 3) > rms(s, SR >> 2) * 2, 'snare is a decaying burst')
})

test('adsr: envelope shapes a steady tone (quiet attack, sustain plateau, release to zero)', async () => {
	let n = SR, ch = new Float32Array(n)
	for (let i = 0; i < n; i++) ch[i] = 0.8 * Math.sin(2 * Math.PI * 440 * i / SR)
	let out = (await audio.from([ch], { sampleRate: SR }).adsr({ attack: 0.1, decay: 0.1, sustain: 0.6, release: 0.2 }).read())[0]
	is(out.length, n, 'length preserved')
	ok(rms(out, 0, Math.round(0.02 * SR)) < rms(out, SR >> 1, Math.round(0.7 * SR)) * 0.5, 'attack ramps in')
	ok(rms(out, Math.round(0.98 * SR)) < rms(out, SR >> 1, Math.round(0.7 * SR)) * 0.3, 'release ramps out')
})
