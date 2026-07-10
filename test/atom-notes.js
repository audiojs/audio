// Note-event hosting + instruments (voice/poly) and the codec-atom flavor.
// Events: the offline host compiles a `notes` option into contract §events slots
// (on/off pairs by id) and hands them to whole-render instruments. Codec: a
// { codec, test, decode, encode } atom extends audio()'s openable formats and
// save()/encode()'s writable ones.

import test, { ok, is, almost } from 'tst'
import audio from '../audio.js'

import { voice } from '@audio/synth-voice/audio'
import { poly } from '@audio/synth-poly/audio'

audio.use(voice, poly)

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

// ── codec atoms ─────────────────────────────────────────────────────────────

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

test('codec atom: encode → sniff → decode round-trip', async () => {
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

test('codec atom: notes without duration ring to the end', async () => {
	let out = (await silent(0.6).voice({ notes: [{ time: 0.1, midi: 69 }] }).read())[0]
	// no off event — the instrument sustains the note to the take's end
	ok(rms(out, Math.round(0.45 * SR), Math.round(0.58 * SR)) > 0.02, 'still sounding near the end')
	ok(out.every(isFinite))
})

test('codec atom: file-path open sniffs the header (node fs branch)', async () => {
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
		ok(Math.abs(b.duration - 0.25) < 0.01, 'file decoded via codec atom')
	} finally { rmSync(path, { force: true }) }
})

test('codec atom: save/encode format guard accepts registered codecs', async () => {
	let a = audio.from([new Float32Array(1000).fill(0.1)], { sampleRate: SR })
	let bytes = await a.encode('raw16')
	ok(bytes.length === 10 + 1000 * 2, 'exact byte count (header + s16 frames)')
	let err = null
	try { await a.encode('nosuchfmt') } catch (e) { err = e }
	ok(/unknown format/.test(err?.message), 'unknown formats still rejected')
})
