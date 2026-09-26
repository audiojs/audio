// Delivery-grade behavior: loudness to spec, encoder settings, surround, editing grammar,
// autowired plugins, reference-matching tools. Reference values cite their source.
import test from 'tst'
import audio from '../audio.js'
import truepeak from '@audio/loudness-truepeak'
import { readFileSync, mkdtempSync, rmSync } from 'fs'
import { fileURLToPath } from 'url'
import { tmpdir } from 'os'
import { join } from 'path'

const lena = fileURLToPath(new URL('../node_modules/audio-lena/lena.wav', import.meta.url))
const lena24 = fileURLToPath(new URL('../node_modules/audio-lena/lena-24.aiff', import.meta.url))
const video = fileURLToPath(new URL('./video.mp4', import.meta.url))
const dir = mkdtempSync(join(tmpdir(), 'audio-pro-')), tmp = name => join(dir, name)
process.on('exit', () => rmSync(dir, { recursive: true, force: true }))
const dbtp = pcm => truepeak(pcm, { fs: 48000 })

let seed = 1
const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647

/** Stereo program-like material: tones, kick, hats; loud transients, crest ~15 dB. */
function program(dur = 6, sr = 48000) {
  seed = 3
  let n = dur * sr, L = new Float32Array(n), R = new Float32Array(n)
  let parts = Array.from({ length: 16 }, () => ({ f: 40 * 2 ** (rnd() * 8), p: rnd() * 6.28, a: 0.06 / (1 + rnd() * 3), pan: rnd() }))
  for (let i = 0; i < n; i++) {
    let t = i / sr, s = 0, r = 0, kick = 0.6 * Math.exp(-(t % 0.5) * 30) * Math.sin(2 * Math.PI * 55 * t)
    let hat = (rnd() * 2 - 1) * Math.exp(-((t + 0.25) % 0.5) * 80) * 0.25
    for (let q of parts) { let v = q.a * Math.sin(2 * Math.PI * q.f * t + q.p); s += v * (1 - q.pan); r += v * q.pan }
    L[i] = s + kick + hat; R[i] = r + kick + hat
  }
  return audio.from([L, R], { sampleRate: sr })
}

// ── Loudness to spec ─────────────────────────────────────────────────────

// Targets: Apple Podcasts -16 LKFS ±1, true peak ≤ -1 dBFS (podcasters.apple.com/support/893);
// Spotify -14 LUFS, ≤ -1 dBTP (support.spotify.com …/loudness-normalization); EBU R 128-2023
// -23.0 LUFS, ≤ -1 dBTP. AES TD1008 §5A: "When upward normalization would cause clipping,
// peak limiting is required": the ceiling limits, it never clips.
test('normalize: loudness presets land on target and hold the -1 dBTP ceiling (rendered, not derived)', async t => {
  for (let [preset, target] of [['streaming', -14], ['podcast', -16], ['broadcast', -23]]) {
    let a = program().normalize(preset)
    let pcm = await a.read(), b = audio.from(pcm, { sampleRate: 48000 })
    t.almost(await b.stat('loudness'), target, 0.01, `${preset}: ${target} LUFS`)
    t.ok(dbtp(pcm) <= -1 + 0.02, `${preset}: true peak ${dbtp(pcm).toFixed(3)} ≤ -1 dBTP`)
  }
})

// A block model of the limiter errs by the material once it takes several LU (peaks inside a
// block are unseen); a render that starts with the whole signal known measures its way there.
test('normalize: heavy limiting still lands on target (speech at -10 LUFS, ~7 LU limited)', async t => {
  let pcm = await (await audio(lena)).normalize(-10, 'lufs').read()
  t.almost(await audio.from(pcm, { sampleRate: 44100 }).stat('loudness'), -10, 0.01, '-10 LUFS')
  t.ok(truepeak(pcm, { fs: 44100 }) <= -1 + 0.02, 'true peak ≤ -1 dBTP')
})

// Stats a resolve op sees after a lookahead op are rendered: they must be in timeline position,
// not delayed by the lookahead (a 2048-sample STFT frame here would shift trim's crop by as much)
test('trim after a lookahead op crops where trim alone does', async t => {
  let X = Float32Array.from({ length: 24000 }, (_, i) => i > 4000 && i < 16000 ? 0.4 * Math.sin(2 * Math.PI * 300 * i / 8000) : 0)
  let [a] = await audio.from([X], { sampleRate: 8000 }).trim().read()
  let [b] = await audio.from([X], { sampleRate: 8000 }).spectral([3000, 3500], -20).trim().read()
  t.is(b.length, a.length, 'same length')
  t.ok(a.every((v, i) => Math.abs(v - b[i]) < 0.01), 'same samples (the band edit touches only the onset)')
})

test('normalize: the preview measures what the render holds (no stale pre-limit loudness)', async t => {
  let a = program().normalize('streaming')
  let preview = await a.stat('loudness')
  let rendered = await audio.from(await a.read(), { sampleRate: 48000 }).stat('loudness')
  t.almost(preview, rendered, 0.001, `preview ${preview.toFixed(3)} = render ${rendered.toFixed(3)}`)
})

test('normalize: numeric loudness target with mode, custom ceiling, and clear errors', async t => {
  let a = (await audio(lena)).normalize(-18, 'lufs')
  t.almost(await a.stat('loudness'), -18, 0.05, 'normalize(-18, "lufs"): AES TD1008 speech target')
  let b = program().normalize(-12, 'lufs', { ceiling: -2 })
  t.ok(dbtp(await b.read()) <= -2 + 0.02, 'ceiling -2 dBTP (Netflix)')
  t.throws(() => audio.from([new Float32Array(48000)]).normalize(-18, 'lufz').length, /unknown mode 'lufz'/)
  t.throws(() => audio.from([new Float32Array(48000)]).normalize('podcats').length, /unknown preset 'podcats'/)
})

test('normalize: true-peak ceiling on full-band noise, inter-sample peaks included', async t => {
  seed = 7
  let x = Float32Array.from({ length: 48000 }, () => (rnd() * 2 - 1) * 1.5)
  let a = audio.from([x], { sampleRate: 48000 }).normalize(0, { ceiling: -1 })
  let pcm = await a.read()
  t.ok(dbtp(pcm) <= -1 + 0.02, `true peak ${dbtp(pcm).toFixed(3)} dBTP`)
})

test('normalize: channel-scoped lookahead keeps other channels aligned', async t => {
  let L = Float32Array.from({ length: 48000 }, (_, i) => 0.9 * Math.sin(2 * Math.PI * 440 * i / 48000))
  let R = Float32Array.from({ length: 48000 }, (_, i) => 0.5 * Math.sin(2 * Math.PI * 330 * i / 48000))
  let [, r] = await audio.from([L, R], { sampleRate: 48000 }).normalize(-10, 'lufs', { channel: 0 }).read()
  t.is(r.length, R.length)
  let d = 0; for (let i = 0; i < R.length; i++) d = Math.max(d, Math.abs(r[i] - R[i]))
  t.ok(d < 1e-6, `untouched channel is sample-identical (max diff ${d})`)
})

test('stats: a nonlinear pointwise op drops the fields it cannot derive', async t => {
  audio.op('_test_clip', { hidden: true, pointwise: true, params: ['limit'], process: (i, o, c) => { for (let k = 0; k < i.length; k++) for (let j = 0; j < i[k].length; j++) o[k][j] = Math.max(-c.limit, Math.min(c.limit, i[k][j])) } })
  let a = (await audio(lena)).gain(12).run(['_test_clip', { limit: 0.5 }])
  let rendered = audio.from(await a.read(), { sampleRate: a.sampleRate })
  t.almost(await a.stat('db'), 20 * Math.log10(0.5), 1e-4, 'peak derives through the probe')
  t.almost(await a.stat('loudness'), await rendered.stat('loudness'), 1e-3, 'loudness renders, not pre-clip')
})

// ITU-R BS.1770-4 Table 3: L/R/C weight 1.0, Ls/Rs 1.41; LFE not measured (§1).
test('loudness: 5.1 channel weights per BS.1770-4', async t => {
  let tone = Float32Array.from({ length: 48000 * 3 }, (_, i) => 0.1 * Math.sin(2 * Math.PI * 997 * i / 48000))
  let only = c => audio.from(Array.from({ length: 6 }, (_, k) => k === c ? tone : new Float32Array(tone.length)), { sampleRate: 48000 })
  let l = await only(0).stat('loudness'), ls = await only(4).stat('loudness')
  t.almost(ls - l, 10 * Math.log10(1.41), 0.01, `surround +${(ls - l).toFixed(3)} dB`)
  t.is(await only(3).stat('loudness'), -Infinity, 'LFE excluded')
})

// EBU Tech 3341 §2.9 test 1: stereo 1 kHz sine at -23.0 dBFS → M, S, I = -23.0 ±0.1 LUFS.
test('loudness: momentary and short-term maxima (EBU Tech 3341 case 1)', async t => {
  let a = 10 ** (-23 / 20), s = audio.from(x => a * Math.sin(2 * Math.PI * 1000 * x), { duration: 20, sampleRate: 48000, channels: 2 })
  for (let name of ['loudness', 'momentary', 'shortterm']) t.almost(await s.stat(name), -23, 0.1, name)
})

// AES TD1008 Annex A: Speech (Dialog Integrated) Loudness, the BS.1770 loudness of the speech only.
test('loudness: dialog-gated measures speech and ignores a bed', async t => {
  let v = await audio(lena), sr = v.sampleRate
  t.almost(await v.stat('dialog'), await v.stat('loudness'), 0.5, 'speech alone ≈ integrated')
  let bed = audio.from(x => 0.05 * Math.sin(2 * Math.PI * 110 * x), { duration: 6, sampleRate: sr })
  t.is(await bed.stat('dialog'), -Infinity, 'no speech in a music bed')
})

// ── Surround ─────────────────────────────────────────────────────────────

// ITU-R BS.775-4 Annex 4 Table 2 (3/2 source): Lo = L + 0.7071 C + 0.7071 Ls, Ro = R + 0.7071 C +
// 0.7071 Rs; mono = 0.7071 (L + R) + C + 0.5 (Ls + Rs); LFE not mixed.
test('remix: 5.1 downmix per ITU-R BS.775', async t => {
  let n = 480, one = c => Array.from({ length: 6 }, (_, k) => new Float32Array(n).fill(k === c ? 1 : 0))
  let st = async c => (await audio.from(one(c), { sampleRate: 48000 }).remix(2).read()).map(x => +x[0].toFixed(4))
  let mono = async c => +(await audio.from(one(c), { sampleRate: 48000 }).remix(1).read())[0][0].toFixed(4)
  t.is(await st(0), [1, 0], 'L'); t.is(await st(1), [0, 1], 'R')
  t.is(await st(2), [0.7071, 0.7071], 'C'); t.is(await st(3), [0, 0], 'LFE')
  t.is(await st(4), [0.7071, 0], 'Ls'); t.is(await st(5), [0, 0.7071], 'Rs')
  t.is([await mono(0), await mono(2), await mono(4)], [0.7071, 1, 0.5], 'mono L, C, Ls')
  let [m] = await audio.from([Float32Array.of(0.2), Float32Array.of(0.4)], { sampleRate: 48000 }).remix(1).read()
  t.almost(m[0], 0.3, 1e-6, 'stereo → mono stays the average')
})

// ── Encoding ─────────────────────────────────────────────────────────────

test('save: lossless keeps the source depth; bitrate and depth are settable', async t => {
  let a = await audio(lena24)
  t.is(a.bitDepth, 24, 'AIFF COMM sampleSize')
  await a.save(tmp('24.wav')); await a.save(tmp('24.flac'))
  t.is((await audio(tmp('24.wav'))).bitDepth, 24, 'wav keeps 24-bit')
  t.is((await audio(tmp('24.flac'))).bitDepth, 24, 'flac keeps 24-bit')
  t.is((await audio(tmp('24.wav'))).clip({ at: 1, duration: 1 }).bitDepth, 24, 'clips carry it')
  let b = await audio(lena)
  t.is(b.bitDepth, 16)
  await b.save(tmp('32.wav'), { bitDepth: 32 })
  t.is(readFileSync(tmp('32.wav')).readUInt16LE(34), 32, 'float WAV on request')
  // MPEG-1 Layer III frame header, bitrate index 11 = 192 kbps (ISO/IEC 11172-3 Table)
  await b.save(tmp('192.mp3'), { bitrate: 192 })
  let m = readFileSync(tmp('192.mp3')), i = 0
  while (!(m[i] === 0xff && (m[i + 1] & 0xe0) === 0xe0)) i++
  t.is(m[i + 2] >> 4, 11, '192 kbps CBR (ACX minimum)')
})

test('save: m4a writes markers as chapters', async t => {
  let a = await audio(lena)
  a.markers = [{ time: 1, label: 'Intro' }, { time: 5, label: 'Main' }]
  await a.save(tmp('ch.m4a'))
  let s = readFileSync(tmp('ch.m4a')).toString('latin1')
  t.ok(s.includes('chpl') && s.includes('Intro') && s.includes('Main'), 'Nero chpl box with titles')
})

test('save: a video source keeps its picture; only the audio track is replaced', async t => {
  let a = (await audio(video)).normalize('podcast')
  await a.save(tmp('v.mp4'))
  let out = readFileSync(tmp('v.mp4')), src = readFileSync(video)
  let avcC = b => { let i = b.indexOf('avcC'); return b.subarray(i, i + 40).toString('hex') }
  t.ok(out.includes('vide') && avcC(out) === avcC(src), 'video track and codec config carried over')
  t.almost(await (await audio(tmp('v.mp4'))).stat('loudness'), -16, 0.05, 'new audio at -16 LUFS')
  await (await audio(video)).save(tmp('a.mp4'), { video: false })
  t.ok(!readFileSync(tmp('a.mp4')).includes('vide'), 'video: false → audio only')
})

// ── Editing grammar ──────────────────────────────────────────────────────

test('ops: documented positional args are applied, extras rejected', async t => {
  let ramp = () => audio.from([Float32Array.from({ length: 10 }, (_, i) => i)], { sampleRate: 10 })
  let zeros = () => audio.from([new Float32Array(10)], { sampleRate: 10 })
  let ones = audio.from([new Float32Array(2).fill(1)], { sampleRate: 10 })
  t.is([...(await ramp().remove(0.2, 0.3).read())[0]], [0, 1, 5, 6, 7, 8, 9], 'remove(at, duration)')
  t.is([...(await zeros().mix(ones, 0.5).read())[0]], [0, 0, 0, 0, 0, 1, 1, 0, 0, 0], 'mix(src, at)')
  t.is([...(await zeros().mix(ones, 0.2, -6).read())[0]].map(v => +v.toFixed(3)), [0, 0, 0.501, 0.501, 0, 0, 0, 0, 0, 0], 'mix gain dB')
  t.is([...(await zeros().insert(ones, 0.5).read())[0]], [0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0], 'insert(src, at)')
  t.throws(() => zeros().gain(1, 2), /gain: expected at most 1 argument/)
  // an op without params takes options only: positional values were silently dropped
  t.throws(() => zeros().crop(0.2, 0.3), /crop: takes options/)
  t.is((await zeros().crop({ at: 0.2, duration: 0.3 }).read())[0].length, 3, 'crop({at, duration})')
  // a rest param takes the remaining values: crossover(...freqs) ≡ crossover({freqs})
  t.is((await zeros().crossover(1, 3).read()).length, (await zeros().crossover({ freqs: [1, 3] }).read()).length, 'crossover(...freqs)')
})

// A butt splice mid-cycle steps the waveform; an equal-power crossfade keeps every sample
// step within the tone's own slope (max |Δx| = A·2πf/fs).
test('splice: remove / insert crossfades are click-free, length-exact, stream ≡ read', async t => {
  let sr = 48000, tone = (f = 440, ph = 0, d = 1) => audio.from(x => 0.5 * Math.sin(2 * Math.PI * f * x + ph), { duration: d, sampleRate: sr })
  let step = x => { let m = 0; for (let i = 1; i < x.length; i++) m = Math.max(m, Math.abs(x[i] - x[i - 1])); return m }
  let slope = 0.5 * 2 * Math.PI * 440 / sr
  let [plain] = await tone().remove(0.5, 0.0011).read()
  let xf = tone().remove(0.5, 0.0011, '10ms'), [x] = await xf.read()
  t.ok(step(plain) > 2 * slope, `butt splice steps ${(step(plain) / slope).toFixed(2)}× the slope`)
  t.ok(step(x) <= slope * 1.001, `crossfaded: ${(step(x) / slope).toFixed(3)}× the slope`)
  t.is(x.length, plain.length, 'length is total − duration either way')
  let s = []; for await (let b of xf.stream()) s.push(...b[0])
  t.ok(s.length === x.length && s.every((v, i) => Math.abs(v - x[i]) < 1e-7), 'stream ≡ read')
  let [sp] = await tone().remove(0.5, 0.0011, '10ms').speed(2).read(), [rv] = await tone().remove(0.5, 0.0011, '10ms').reverse().read()
  t.ok(step(sp) <= 2 * slope * 1.001 && step(rv) <= slope * 1.001, 'pairs stay aligned through speed and reverse')
  let other = tone(660, 1, 0.3), [ins] = await tone().insert(other, 0.5, '10ms').read(), [bare] = await tone().insert(other, 0.5).read()
  t.is(ins.length, bare.length, 'insert length unchanged by crossfade')
  t.ok(step(ins) < step(bare) / 5, `insert seams ${(step(bare) / slope).toFixed(1)}× → ${(step(ins) / slope).toFixed(2)}×`)
  let [app] = await tone().insert(other, 1, '10ms').read()
  t.ok(step(app) <= 1.5 * slope * 1.01, 'append (no handle): in-place fades, no step')
  let m = tone(); m.markers = [{ time: 0.2, label: 'a' }, { time: 0.6, label: 'cut' }, { time: 0.9, label: 'b' }]
  m.remove(0.5, 0.2, '10ms')
  t.is(m.markers.map(x => [x.label, +x.time.toFixed(3)]), [['a', 0.2], ['b', 0.7]], 'a marker inside the cut goes, later ones shift')
})

test('splice: crossfade edges — file bounds, oversize, zero length, empty host, one sample, undo', async t => {
  let ramp = n => audio.from([Float32Array.from({ length: n }, (_, i) => i + 1)], { sampleRate: 1000 })
  let vals = async a => [...(await a.read())[0]]
  // cut touching the start / end: no handle on that side, the overlap shrinks to zero → a plain cut
  t.is(await vals(ramp(10).remove(0, 0.003, 0.004)), [4, 5, 6, 7, 8, 9, 10], 'at the start')
  t.is(await vals(ramp(10).remove(0.007, 0.003, 0.004)), [1, 2, 3, 4, 5, 6, 7], 'to the end')
  t.is((await vals(ramp(10).remove(0.004, 0.002, 1))).length, 8, 'crossfade longer than the file: length still exact')
  t.is(await vals(ramp(10).remove(0.004, 0, 0.004)), await vals(ramp(10)), 'zero duration: untouched')
  let one = audio.from([Float32Array.of(1)], { sampleRate: 1000 })
  t.is(await vals(audio.from(0, { sampleRate: 1000 }).insert(ramp(4), 0, 0.002)), [1, 2, 3, 4], 'into empty: nothing to fade against')
  t.is(await vals(ramp(4).insert(one, 0.002, 0.002)), [1, 2, 1, 3, 4], 'one-sample insert: no room for a fade')
  let a = ramp(10).remove(0.004, 0.002, 0.004)
  a.undo()
  t.is(await vals(a), await vals(ramp(10)), 'undo restores the original')
  // A → A: inserting a clone of itself crossfades like any source
  let b = ramp(8), c = b.clone()
  t.is((await vals(b.insert(c, 0.004, 0.002))).length, 16, 'A → A insert keeps length')
})

test('normalize: limiter path — stream ≡ read, silence and sub-gate input are left alone', async t => {
  let a = program(2).normalize('streaming'), r = await a.read(), s = [[], []]
  for await (let b of a.stream()) b.forEach((ch, c) => s[c].push(...ch))
  t.ok(s[0].length === r[0].length && s[0].every((v, i) => Math.abs(v - r[0][i]) < 1e-6), 'stream ≡ read through the ceiling')
  let silent = audio.from([new Float32Array(48000)], { sampleRate: 48000 }).normalize('podcast')
  t.ok((await silent.read())[0].every(v => v === 0), 'silence stays silent')
  let short = audio.from([Float32Array.from({ length: 4800 }, (_, i) => 0.1 * Math.sin(i / 10))], { sampleRate: 48000 })
  let [x] = await short.clone().normalize('podcast').read(), [y] = await short.read()
  t.ok(x.every((v, i) => v === y[i]), '100 ms (< one 400 ms gate): no loudness, no change')
})

test('remix: quad and 7.1 downmix, same coefficients', async t => {
  let n = 48, one = (N, c) => Array.from({ length: N }, (_, k) => new Float32Array(n).fill(k === c ? 1 : 0))
  let st = async (N, c) => (await audio.from(one(N, c), { sampleRate: 48000 }).remix(2).read()).map(x => +x[0].toFixed(4))
  t.is(await st(4, 2), [0.7071, 0], 'quad Ls → L')
  t.is(await st(8, 3), [0, 0], '7.1 LFE dropped')
  t.is(await st(8, 4), [0.7071, 0], '7.1 back left → L')
  t.is(await st(8, 7), [0, 0.7071], '7.1 side right → R')
})

test('save: audio-only mp4 stays audio-only; bitDepth is null without a PCM header', async t => {
  let a = await audio(fileURLToPath(new URL('../node_modules/audio-lena/lena.m4a', import.meta.url)))
  await a.save(tmp('m.mp4'))
  t.ok(!readFileSync(tmp('m.mp4')).includes('vide'), 'no video track appears')
  t.is(a.bitDepth, null, 'lossy source')
  t.is(audio.from([new Float32Array(10)]).bitDepth, null, 'generated audio')
})

test('fade: fade(in, curve) applies the curve', async t => {
  let one = () => audio.from([new Float32Array(100).fill(1)], { sampleRate: 100 })
  let [c] = await one().fade(1, 'cos').read(), [l] = await one().fade(1).read()
  t.almost(c[25], (1 - Math.cos(0.25 * Math.PI)) / 2, 1e-6, 'cos curve at 25%')
  t.almost(l[25], 0.25, 1e-6, 'linear default')
})

test('cli: positional ranges, crossfade, sidechain file and save depth, end to end', { timeout: 60000 }, async t => {
  let { execFileSync } = await import('child_process')
  let cli = fileURLToPath(new URL('../bin/cli.js', import.meta.url))
  let run = (...args) => execFileSync(process.execPath, [cli, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  let dur = out => +/Duration:\s+0:(\d+)/.exec(out)[1]
  t.is(dur(run(lena, 'remove', '2s', '1s')), 11, 'remove OFF DUR removes that span (12 s → 11 s)')
  t.is(dur(run(lena, 'remove', '2s..4s', '10ms')), 10, 'range + crossfade')
  await audio.from(x => 0.3 * Math.sin(2 * Math.PI * 220 * x), { duration: 2, sampleRate: 44100 }).save(tmp('bed.wav'))
  await audio.from(x => x > 0.5 && x < 1.5 ? 0.5 * Math.sin(2 * Math.PI * 800 * x) : 0, { duration: 2, sampleRate: 44100 }).save(tmp('voice.wav'))
  let rms = r => +/rms\s+([\d.]+)/.exec(run(tmp('bed.wav'), 'ducker', 'key:' + tmp('voice.wav'), 'stat', 'rms', r))[1]
  t.ok(rms('0.8s..1.2s') < rms('0.1s..0.4s') / 3, 'bed ducks under the voice file')
  run(lena24, 'save', tmp('d.wav'), '24bit', '-f')
  t.is(readFileSync(tmp('d.wav')).readUInt16LE(34), 24, 'save 24bit')
})

// Butterworth: -3.01 dB at the corner for every order, 6N dB/octave beyond it.
test('filter: highpass order is Butterworth steepness', async t => {
  let rms = async (f, order) => 20 * Math.log10(await audio.from(x => Math.sin(2 * Math.PI * f * x), { duration: 1, sampleRate: 48000 }).highpass(1000, order).stat('rms', { at: 0.2 }) / Math.SQRT1_2)
  for (let order of [2, 4]) {
    t.almost(await rms(1000, order), -3.01, 0.05, `order ${order}: -3 dB at fc`)
    t.almost(await rms(250, order), -12 * order, 0.6, `order ${order}: ${-12 * order} dB two octaves down`)
  }
})

test('cli: ranges anywhere, paths with .., bands, name:value options, save shorthands', async t => {
  let { parseArgs } = await import('../bin/cli.js')
  let op = (args, i = 0) => parseArgs(args).transforms[i]
  let r = op(['in.wav', 'remove', '2s..4s'])
  t.is([r.offset, r.duration], [2, 2], 'remove RANGE')
  let p = parseArgs(['../in.wav', 'mix', '../bg.wav', '0s', '-6db', 'save', 'o.wav'])
  t.is(p.source, '../in.wav', 'a ../ path is a source, not a range')
  t.is(p.transforms[0].args, ['../bg.wav', 0, -6], 'and a mix source')
  let n = op(['in.wav', 'normalize', '-27', 'lufs', 'ceiling:-2'])
  t.is([n.args, n.opts], [[-27, 'lufs'], { ceiling: -2 }], 'normalize -27 lufs ceiling:-2')
  let s = op(['in.wav', 'spectral', '1khz..4khz', '-30db', '2.1s..2.4s'])
  t.is(s.args, [[1000, 4000], -30], 'band 1khz..4khz is a value, not a range')
  t.is(s.offset, 2.1, 'the time range scopes the op')
  t.is(parseArgs(['in.wav', 'save', 'o.mp3', '192k', '24bit', 'quality:2']).sink.opts, { bitrate: 192, bitDepth: 24, quality: 2 })
  t.is(op(['in.wav', 'dither', '16', 'shape:false']).opts, { shape: false }, 'booleans, not truthy strings')
  t.is(op(['in.wav', 'ducker', 'key:voice.wav']).opts, { key: 'voice.wav' }, 'sidechain file')
})

// The skill teaches the CLI: every op and stat it names must exist (built in or registry).
test('skill: every op and stat it names exists', async t => {
  let skill = readFileSync(new URL('../skills/audio/SKILL.md', import.meta.url), 'utf8')
  let line = h => skill.split('\n').find(l => l.startsWith(h)).slice(h.length)
  let ops = line('Ops:').split(/[·.]\s/).map(s => s.trim().split(/[\s[]/)[0]).flatMap(n => n.split('/')).filter(n => /^[a-z]/.test(n) && n !== 'Plugins' && n !== '`--help`')
  let plugins = line('Ops:').split('Plugins by name:')[1].split('`--help`')[0].split(',').map(s => s.trim().split(/[\s…]/)[0]).filter(Boolean)
  for (let n of [...ops, ...plugins]) t.ok(audio.op(n) || audio.plugins[n] || n === 'split', `op ${n}`)
  for (let n of line('Stats:').split(';')[0].trim().split(/\s+/)) t.ok(audio.stat(n) || audio.plugins[n] || typeof audio.fn[n] === 'function', `stat ${n}`)
})

// ── Autowired plugins and reference tools ────────────────────────────────

test('plugins: registry ops are methods before load; stats load on first query', async t => {
  let a = await audio(lena)
  delete audio.op().compressor; delete audio.op().limiter  // as if never loaded (other suites load them)
  a.compressor(-30, 8).limiter(-3)
  t.is(a.edits[0], ['compressor', { args: [-30, 8] }], 'args wait until the op loads')
  t.ok(Number.isFinite(await a.stat('truepeak')), 'truepeak loads on demand')
  t.is(a.edits[0], ['compressor', { threshold: -30, ratio: 8 }], 'mapped onto params at LOAD')
  t.is(a.edits[1], ['limiter', { ceiling: -3 }])
})

test('match: equalizes toward a reference tonal balance', async t => {
  seed = 5
  let x = Float32Array.from({ length: 44100 * 6 }, () => (rnd() * 2 - 1) * 0.2)
  let src = audio.from([x], { sampleRate: 44100 }), ref = audio.from([x.slice()], { sampleRate: 44100 }).highshelf(4000, 6)
  let band = async (a, f) => 20 * Math.log10(await a.clone().bandpass(f, 4).stat('rms'))
  let m = src.clone().match(ref)
  let want = (await band(ref, 8000)) - (await band(ref, 500)), got = (await band(m, 8000)) - (await band(m, 500))
  t.almost(got, want, 1, `8 kHz vs 500 Hz tilt ${got.toFixed(2)} ≈ reference ${want.toFixed(2)} dB`)
  t.almost(await m.stat('loudness'), await src.stat('loudness'), 0.01, 'tone only: integrated loudness held')
})

test('spectral: removes a band in a time range; repair rebuilds a dropout', async t => {
  let sr = 44100
  let beep = audio.from(x => 0.3 * Math.sin(2 * Math.PI * 440 * x) + (x > 1 && x < 1.3 ? 0.3 * Math.sin(2 * Math.PI * 3000 * x) : 0), { duration: 2, sampleRate: sr })
  let at3k = async a => 20 * Math.log10(await a.clone().bandpass(3000, 8).stat('rms', { at: 1.05, duration: 0.2 }))
  let clean = beep.clone().spectral([2500, 3500], { at: 1, duration: 0.3 })
  t.ok((await at3k(beep)) - (await at3k(clean)) > 30, 'beep down > 30 dB')
  let tone = audio.from(x => x >= 1.2 && x < 1.25 ? 0 : 0.5 * Math.sin(2 * Math.PI * 440 * x), { duration: 2, sampleRate: sr })
  let fixed = tone.clone().repair({ at: 1.2, duration: 0.05 })
  t.almost(20 * Math.log10(await fixed.stat('rms', { at: 1.205, duration: 0.04 })), 20 * Math.log10(0.5 / Math.SQRT2), 1, 'hole back at tone level')
})
