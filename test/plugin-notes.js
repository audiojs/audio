// Note-event hosting + instruments (voice/poly) and the codec-atom flavor.
// Events: the offline host compiles a `notes` option into contract §events slots
// (on/off pairs by id) and hands them to whole-render instruments. Codec: a
// { codec, test, decode, encode } atom extends audio()'s openable formats and
// save()/encode()'s writable ones. Transcription: stat('notes') on synth renders,
// whose notes are known exactly.

import test, { ok, is, almost } from 'tst'
import { existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import os from 'node:os'
import path from 'node:path'
import audio from '../audio.js'

import { voice } from '@audio/synth-voice/audio'
import { poly } from '@audio/synth-poly/audio'
import { osc } from '@audio/synth-osc/audio'

audio.use(voice, poly, osc)

const SR = 44100

function g(buf, f, sr = SR, from = 0, to = buf.length) {
	let w = 2 * Math.PI * f / sr, coeff = 2 * Math.cos(w), s1 = 0, s2 = 0
	for (let i = from; i < to; i++) { let s = buf[i] + coeff * s1 - s2; s2 = s1; s1 = s }
	return Math.sqrt(Math.max(0, s1 * s1 + s2 * s2 - coeff * s1 * s2))
}
function rms(d, from = 0, to = d.length) { let s = 0; for (let i = from; i < to; i++) s += d[i] * d[i]; return Math.sqrt(s / Math.max(1, to - from)) }
const silent = (dur, ch = 1) => audio.from(Array.from({ length: ch }, () => new Float32Array(Math.round(dur * SR))), { sampleRate: SR })

test('voice: notes render at their times and pitches (C4 then E4)', async () => {
	let out = (await silent(1.2).voice({
		notes: [{ time: 0, midi: 60, duration: 0.4 }, { time: 0.6, midi: 64, duration: 0.4 }],
	}).read())[0]
	let w1 = [Math.round(0.05 * SR), Math.round(0.4 * SR)]
	let w2 = [Math.round(0.65 * SR), Math.round(1.0 * SR)]
	ok(g(out, 261.6, SR, ...w1) > g(out, 329.6, SR, ...w1) * 2, 'C4 in the first window')
	ok(g(out, 329.6, SR, ...w2) > g(out, 261.6, SR, ...w2) * 2, 'E4 in the second window')
	ok(rms(out, Math.round(0.45 * SR), Math.round(0.55 * SR)) < rms(out, ...w1) * 0.6, 'gap between notes')
	ok(out.every(isFinite))
})

test('voice: freq form + velocity scales level', async () => {
	let soft = (await silent(0.5).voice({ notes: [{ time: 0, freq: 440, duration: 0.4, velocity: 0.2 }] }).read())[0]
	let hard = (await silent(0.5).voice({ notes: [{ time: 0, freq: 440, duration: 0.4, velocity: 1 }] }).read())[0]
	ok(rms(hard) > rms(soft) * 2, `velocity scales (${rms(soft).toFixed(3)} vs ${rms(hard).toFixed(3)})`)
})

test('poly: chord renders all pitches simultaneously', async () => {
	let out = (await silent(0.8).poly({
		notes: [{ time: 0, midi: 60, duration: 0.6 }, { time: 0, midi: 64, duration: 0.6 }, { time: 0, midi: 67, duration: 0.6 }],
	}).read())[0]
	let w = [Math.round(0.1 * SR), Math.round(0.5 * SR)]
	let floor = g(out, 500, SR, ...w) // off-chord reference bin
	for (let [f, name] of [[261.6, 'C4'], [329.6, 'E4'], [392, 'G4']])
		ok(g(out, f, SR, ...w) > floor * 2, `${name} present in the chord`)
	ok(out.every(isFinite))
})

test('note-event ops serialize (notes survive toJSON)', async () => {
	let a = silent(0.5).voice({ notes: [{ time: 0, midi: 69, duration: 0.3 }] })
	let doc = a.toJSON()
	is(doc.edits.length, 1)
	ok(JSON.stringify(doc).includes('"midi":69'), 'notes serialized in the edit')
})

// ── codec plugins ─────────────────────────────────────────────────────────────

// raw16 — a minimal real codec: 'RA16' magic, u32 sampleRate, u16 channels,
// interleaved s16le frames. Enough to exercise sniff → decode and encode → save.
const MAGIC = 0x52413136 // 'RA16'
const raw16 = {
	codec: 'raw16',
	test: (bytes) => bytes.length >= 4 && new DataView(bytes.buffer, bytes.byteOffset).getUint32(0) === MAGIC,
	decode: (bytes) => {
		let dv = new DataView(bytes.buffer, bytes.byteOffset)
		let sampleRate = dv.getUint32(4, true), ch = dv.getUint16(8, true)
		let frames = (bytes.length - 10) / 2 / ch | 0
		let channelData = Array.from({ length: ch }, () => new Float32Array(frames))
		for (let i = 0, o = 10; i < frames; i++) for (let c = 0; c < ch; c++, o += 2)
			channelData[c][i] = dv.getInt16(o, true) / 0x7fff
		return { channelData, sampleRate }
	},
	encode: ({ sampleRate, channels }) => {
		let parts = [], ch = channels
		let head = new Uint8Array(10), dv = new DataView(head.buffer)
		dv.setUint32(0, MAGIC); dv.setUint32(4, sampleRate, true); dv.setUint16(8, ch, true)
		parts.push(head)
		return (chunk) => {
			if (!chunk) { // flush: concat
				let total = 0; for (let p of parts) total += p.length
				let out = new Uint8Array(total), pos = 0
				for (let p of parts) { out.set(p, pos); pos += p.length }
				parts = []
				return out
			}
			let n = chunk[0].length, buf = new Uint8Array(n * ch * 2), bdv = new DataView(buf.buffer)
			for (let i = 0, o = 0; i < n; i++) for (let c = 0; c < ch; c++, o += 2) {
				let s = Math.max(-1, Math.min(1, chunk[c][i]))
				bdv.setInt16(o, Math.round(s * 0x7fff), true)
			}
			parts.push(buf)
			return new Uint8Array(0)
		}
	},
}

// register as two halves (decode-X / encode-X package pattern) — host merges by name
audio.use({ codec: 'raw16', test: raw16.test, decode: raw16.decode })
audio.use({ codec: 'raw16', encode: raw16.encode })

test('codec plugin: encode → sniff → decode round-trip', async () => {
	let n = SR >> 1, ch = new Float32Array(n)
	for (let i = 0; i < n; i++) ch[i] = 0.5 * Math.sin(2 * Math.PI * 440 * i / SR)
	let bytes = await audio.from([ch, ch], { sampleRate: SR }).encode('raw16')
	ok(raw16.test(bytes), 'header carries the magic')

	// audio(bytes) has no extension to go by — the registered test() sniffs it
	let b = await audio(bytes)
	is(b.channels, 2)
	almost(b.duration, 0.5, 0.01, 'duration round-trips')
	let pcm = await b.read()
	let d = 0
	for (let i = 0; i < n; i++) d = Math.max(d, Math.abs(pcm[0][i] - ch[i]))
	ok(d < 2 / 0x7fff + 1e-6, `s16 round-trip within quantization (${d.toExponential(1)})`)
})

test('codec plugin: notes without duration ring to the end', async () => {
	let out = (await silent(0.6).voice({ notes: [{ time: 0.1, midi: 69 }] }).read())[0]
	// no off event — the instrument sustains the note to the take's end
	ok(rms(out, Math.round(0.45 * SR), Math.round(0.58 * SR)) > 0.02, 'still sounding near the end')
	ok(out.every(isFinite))
})

test('codec plugin: file-path open sniffs the header (node fs branch)', async () => {
	let { tmpdir } = await import('os')
	let { join } = await import('path')
	let { writeFileSync, rmSync } = await import('fs')
	let n = SR >> 2, ch = new Float32Array(n)
	for (let i = 0; i < n; i++) ch[i] = 0.4 * Math.sin(2 * Math.PI * 440 * i / SR)
	let bytes = await audio.from([ch], { sampleRate: SR }).encode('raw16')
	let path = join(tmpdir(), `audio-raw16-${Date.now()}.r16`)
	writeFileSync(path, bytes)
	try {
		let b = await audio(path)   // 12-byte header sniff → registered test() claims it
		is(b.channels, 1)
		ok(Math.abs(b.duration - 0.25) < 0.01, 'file decoded via codec plugin')
	} finally { rmSync(path, { force: true }) }
})

test('codec plugin: save/encode format guard accepts registered codecs', async () => {
	let a = audio.from([new Float32Array(1000).fill(0.1)], { sampleRate: SR })
	let bytes = await a.encode('raw16')
	ok(bytes.length === 10 + 1000 * 2, 'exact byte count (header + s16 frames)')
	let err = null
	try { await a.encode('nosuchfmt') } catch (e) { err = e }
	ok(/unknown format/.test(err?.message), 'unknown formats still rejected')
})

// ── transcription: stat('notes') ─────────────────────────────────────────────
// pYIN f0 + Tony's note HMM (@audio/pitch-pyin). Signals come from the synths, so the
// played notes are the labels.

const midis = ns => ns.map(n => n.midi)

test('notes: ±50 cent vibrato at 5.5 Hz stays one note', async () => {
	// centred 25 cents above C4: rounding frames to MIDI would flip between C4 and C#4
	let a = silent(2).osc({ freq: 261.63, type: 'sawtooth', detune: t => 25 + 50 * Math.sin(2 * Math.PI * 5.5 * t) })
	let ns = await a.stat('notes')
	is(midis(ns), [60])
	is(ns[0].note, 'C4')
	ok(ns[0].duration > 1.9, `spans the tone (${ns[0].duration.toFixed(2)} s)`)
})

test('notes: a fast glide joins its two notes', async () => {
	// A3 held, an octave up over 0.2 s, A4 held: the glide makes no notes of its own
	let a = silent(1.2).osc({ freq: 220, type: 'sawtooth', detune: t => 1200 * Math.min(1, Math.max(0, (t - 0.5) / 0.2)) })
	let ns = await a.stat('notes')
	is(ns.map(n => n.note), ['A3', 'A4'])
	ok(ns[1].time > 0.5 && ns[1].time < 0.75, `A4 from ${ns[1].time.toFixed(3)} s`)
})

test('notes: a note played twice on one pitch is two notes', async () => {
	let a = silent(1.1).voice({ notes: [{ time: 0, midi: 60, duration: 0.5 }, { time: 0.5, midi: 60, duration: 0.5 }] })
	let ns = await a.stat('notes')
	is(midis(ns), [60, 60])
	ok(Math.abs(ns[1].time - 0.5) < 0.03, `second attack at ${ns[1].time.toFixed(3)} s`)
})

test('notes: melody with an octave leap, no octave errors', async () => {
	let played = [57, 60, 64, 62, 60, 55, 57, 45]
	let a = silent(3.2).voice({ notes: played.map((midi, i) => ({ time: i * 0.4, midi, duration: 0.35 })) })
	let ns = await a.stat('notes')
	is(midis(ns), played)
	ok(ns.every((n, i) => Math.abs(n.time - i * 0.4) < 0.03), 'each note at its onset')
})

test('notes: period-doubling bursts make no octave notes', async () => {
	// every other period of an A3 sawtooth at 0.4 for 30 ms every 250 ms: frame by frame YIN
	// hears the octave below there
	let n = 2 * SR, ch = new Float32Array(n)
	for (let i = 0; i < n; i++) { let t = i / SR; ch[i] = 0.4 * (2 * (220 * t % 1) - 1) * (t % 0.25 < 0.03 && Math.floor(220 * t) % 2 ? 0.4 : 1) }
	is(midis(await audio.from([ch], { sampleRate: SR }).stat('notes')), [57])
})

test('notes: silence has none', async () => {
	is(await silent(1).stat('notes'), [])
	is(await silent(0).stat('notes'), [], 'zero-length audio')
})

test('notes: stereo reads as its mono mix (a melody on the right channel only)', async () => {
	let right = silent(1.5).voice({ notes: [60, 67].map((midi, i) => ({ time: i * 0.7, midi, duration: 0.6 })) })
	let [r] = await right.read()
	is(midis(await audio.from([new Float32Array(r.length), r], { sampleRate: SR }).stat('notes')), [60, 67])
})

test('notes: a ranged call sees its span, timed from its start', async () => {
	let a = silent(2).voice({ notes: [60, 64, 67, 72].map((midi, i) => ({ time: i * 0.5, midi, duration: 0.4 })) })
	let ns = await a.stat('notes', { at: 0.45, duration: 1 })
	is(ns.map(n => n.note), ['E4', 'G4'])
	ok(Math.abs(ns[0].time - 0.05) < 0.03 && Math.abs(ns[1].time - 0.55) < 0.03, `at ${ns.map(n => n.time.toFixed(3))}`)
	ok(ns.every(n => n.time + n.duration <= 1.001), 'within the range')
})

// ── polyphonic notes: stat('notes', { poly: true }) ─────────────────────────
// Basic Pitch through the optional @audio/neural-transcribe. Runs only when the package and its
// model are already in the neural cache, so the suite never downloads.

const HAS_POLY = await import('@audio/neural-transcribe').then(({ MODEL }) => existsSync(path.join(
	process.env.AUDIO_NEURAL_CACHE || path.join(os.homedir(), '.cache', 'audiojs', 'neural'),
	createHash('sha256').update(MODEL).digest('hex'))), () => false)
const POLY_RUN = { timeout: 120000 } // a model run on a busy machine

test('notes poly: without @audio/neural-transcribe, notes still works and poly names the package', () => {
	// a child process whose resolve hook hides the package, as an install without it would
	let hide = `data:text/javascript,export async function resolve(s, c, next) { if (s === '@audio/neural-transcribe') throw Object.assign(new Error('not installed'), { code: 'ERR_MODULE_NOT_FOUND' }); return next(s, c) }`
	let out = execFileSync(process.execPath, ['--import', `data:text/javascript,import { register } from 'node:module'; register(${JSON.stringify(hide)})`,
		'--input-type=module', '-e', `import audio from './audio.js'
		let a = audio.from([new Float32Array(44100)], { sampleRate: 44100 })
		let mono = await a.stat('notes'), err = await a.stat('notes', { poly: true }).then(() => 'resolved', e => e.message)
		console.log(JSON.stringify({ mono, err }))`], { cwd: fileURLToPath(new URL('..', import.meta.url)), encoding: 'utf8' })
	let { mono, err } = JSON.parse(out.trim().split('\n').pop())
	is(mono, [], 'monophonic notes need no neural package')
	ok(err.startsWith('notes({ poly: true }): install @audio/neural-transcribe'), err)
})

;(HAS_POLY ? test : test.skip)('notes poly: a C major triad, timed; extra notes weaker than the chord', POLY_RUN, async () => {
	let a = silent(1.5).poly({ notes: [60, 64, 67].map(midi => ({ time: 0.2, midi, duration: 1 })) })
	let ns = await a.stat('notes', { poly: true })
	let chord = [60, 64, 67].map(m => ns.find(n => n.midi === m))
	ok(chord.every(Boolean), `C4 E4 G4 in ${ns.map(n => n.note)}`)
	ok(chord.every(n => Math.abs(n.time - 0.2) < 0.03), `onsets at ${chord.map(n => n.time.toFixed(3))}`)
	let weakest = Math.min(...chord.map(n => n.velocity))
	ok(ns.filter(n => !chord.includes(n)).every(n => n.velocity < weakest), 'extra notes are weaker than the chord')
	ok(chord.every(n => n.bends.length > 0 && n.bends.every(isFinite)), 'bends per frame')
	// equal-tempered synth notes: bends are cents from the note's pitch, so the held part reads 0
	let held = n => n.bends.slice(Math.floor(n.bends.length / 4), Math.ceil(n.bends.length * 3 / 4))
	ok(chord.every(n => held(n).every(c => c === 0)), `in tune: ${chord.map(n => [...new Set(held(n))])}`)
})

;(HAS_POLY ? test : test.skip)('notes poly: stereo reads as its mono mix, the same notes', POLY_RUN, async () => {
	let chord = ch => silent(1.5, ch).poly({ notes: [60, 64, 67].map(midi => ({ time: 0.2, midi, duration: 1 })) }).stat('notes', { poly: true })
	let [mono, stereo] = [await chord(1), await chord(2)]
	is(stereo.map(n => [n.midi, n.time.toFixed(3)]), mono.map(n => [n.midi, n.time.toFixed(3)]))
})

;(HAS_POLY ? test : test.skip)('notes poly: ranged call timed from its start; silence, empty and out-of-range spans have none', POLY_RUN, async () => {
	let a = silent(1.5).poly({ notes: [{ time: 0.2, midi: 60, duration: 1 }] })
	let [n] = (await a.stat('notes', { poly: true, at: 0.1, duration: 1 })).filter(n => n.midi === 60)
	// at 0.1, not 0.2: Basic Pitch starts this band-limited voice up to 3 frames (35 ms) early, whole or ranged
	ok(n && Math.abs(n.time - 0.1) < 0.04, `C4 at ${n?.time.toFixed(3)}`)
	is(await silent(0.5).stat('notes', { poly: true }), [])
	is(await silent(0).stat('notes', { poly: true }), [], 'zero-length audio')
	is(await a.stat('notes', { poly: true, at: 0.5, duration: 0 }), [], 'zero-length span')
	is(await a.stat('notes', { poly: true, at: 2, duration: 1 }), [], 'span past the end')
})

// ── robust notes: stat('notes', { robust: true }) ────────────────────────────
// pYIN with @audio/neural-pitch as its stage 1 (the `candidates` hook): a small network's pitch
// posterior in place of YIN's candidates, for noise and rooms. Optional package, weights inside.

const HAS_ROBUST = await import('@audio/neural-pitch').then(() => true, () => false)
const ROBUST_RUN = { timeout: 120000 } // 0.35 CPU-s per second of audio, on a busy machine

// pink noise: Paul Kellet's economy filter (musicdsp.org, "Pink noise filter") over seeded white noise
function pink(n, seed = 3) {
	let y = new Float32Array(n), b0 = 0, b1 = 0, b2 = 0, r = seed
	for (let i = 0; i < n; i++) {
		r = (r * 1664525 + 1013904223) >>> 0
		let x = r / 2147483648 - 1
		b0 = 0.99765 * b0 + x * 0.0990460; b1 = 0.96300 * b1 + x * 0.2965164; b2 = 0.57000 * b2 + x * 1.0526913
		y[i] = b0 + b1 + b2 + x * 0.1848
	}
	return y
}

test('notes robust: without @audio/neural-pitch, notes still works and robust names the package', () => {
	// a child process whose resolve hook hides the package, as an install without it would
	let hide = `data:text/javascript,export async function resolve(s, c, next) { if (s === '@audio/neural-pitch') throw Object.assign(new Error('not installed'), { code: 'ERR_MODULE_NOT_FOUND' }); return next(s, c) }`
	let out = execFileSync(process.execPath, ['--import', `data:text/javascript,import { register } from 'node:module'; register(${JSON.stringify(hide)})`,
		'--input-type=module', '-e', `import audio from './audio.js'
		let a = audio.from([new Float32Array(44100)], { sampleRate: 44100 })
		let mono = await a.stat('notes'), err = await a.stat('notes', { robust: true }).then(() => 'resolved', e => e.message)
		console.log(JSON.stringify({ mono, err }))`], { cwd: fileURLToPath(new URL('..', import.meta.url)), encoding: 'utf8' })
	let { mono, err } = JSON.parse(out.trim().split('\n').pop())
	is(mono, [], 'plain notes need no neural package')
	ok(err.startsWith('notes({ robust: true }): install @audio/neural-pitch'), err)
})

;(HAS_ROBUST ? test : test.skip)('notes robust: a melody in pink noise at 0 dB SNR keeps its notes, where YIN hears none', ROBUST_RUN, async () => {
	let played = [57, 60, 64, 62, 60, 55, 57, 45]
	let [x] = await silent(3.2).voice({ notes: played.map((midi, i) => ({ time: i * 0.4, midi, duration: 0.35 })) }).read()
	let n = pink(x.length), k = rms(x) / rms(n)
	let a = audio.from([x.map((v, i) => v + n[i] * k)], { sampleRate: SR })
	is(await a.stat('notes'), [], 'YIN: none')
	let ns = await a.stat('notes', { robust: true })
	is(midis(ns), played)
	ok(ns.every((n, i) => Math.abs(n.time - i * 0.4) < 0.05), `onsets within 50 ms: ${ns.map(n => n.time.toFixed(3))}`)
})

;(HAS_ROBUST ? test : test.skip)('notes robust: clean, a ranged call timed from its start; silence has none', ROBUST_RUN, async () => {
	let a = silent(2).voice({ notes: [60, 64, 67, 72].map((midi, i) => ({ time: i * 0.5, midi, duration: 0.4 })) })
	let ns = await a.stat('notes', { robust: true, at: 0.45, duration: 1 })
	is(ns.map(n => n.note), ['E4', 'G4'])
	ok(Math.abs(ns[0].time - 0.05) < 0.03 && Math.abs(ns[1].time - 0.55) < 0.03, `at ${ns.map(n => n.time.toFixed(3))}`)
	is(await silent(0.5).stat('notes', { robust: true }), [])
})
