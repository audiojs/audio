// Delivery-grade behavior: loudness to spec, encoder settings, surround, editing grammar,
// autowired plugins, reference-matching tools. Reference values cite their source.
import test from 'tst'
import audio from '../audio.js'
import truepeak from '@audio/loudness-truepeak'
import replaygain from '@audio/loudness-replaygain'
import { readFileSync, mkdtempSync, rmSync } from 'fs'
import { fileURLToPath } from 'url'
import { tmpdir } from 'os'
import { join } from 'path'
import { vowel } from './gen.js'

const lena = fileURLToPath(new URL('../node_modules/audio-lena/lena.wav', import.meta.url))
const lena24 = fileURLToPath(new URL('../node_modules/audio-lena/lena-24.aiff', import.meta.url))
const video = fileURLToPath(new URL('./video.mp4', import.meta.url))
const dir = mkdtempSync(join(tmpdir(), 'audio-pro-')), tmp = name => join(dir, name)
process.on('exit', () => rmSync(dir, { recursive: true, force: true }))
const dbtp = pcm => truepeak(pcm, { fs: 48000 })

let seed = 1
const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647

/** Stereo program-like material: tones, kick, hats; loud transients, crest ~15 dB. Made once per length, each call a
 *  fresh copy, the seed left where making it leaves it. */
const programs = new Map()
function program(dur = 6, sr = 48000) {
  let key = `${dur}/${sr}`
  if (!programs.has(key)) {
    seed = 3
    let n = dur * sr, L = new Float32Array(n), R = new Float32Array(n)
    let parts = Array.from({ length: 16 }, () => ({ f: 40 * 2 ** (rnd() * 8), p: rnd() * 6.28, a: 0.06 / (1 + rnd() * 3), pan: rnd() }))
    for (let i = 0; i < n; i++) {
      let t = i / sr, s = 0, r = 0, kick = 0.6 * Math.exp(-(t % 0.5) * 30) * Math.sin(2 * Math.PI * 55 * t)
      let hat = (rnd() * 2 - 1) * Math.exp(-((t + 0.25) % 0.5) * 80) * 0.25
      for (let q of parts) { let v = q.a * Math.sin(2 * Math.PI * q.f * t + q.p); s += v * (1 - q.pan); r += v * q.pan }
      L[i] = s + kick + hat; R[i] = r + kick + hat
    }
    programs.set(key, { chs: [L, R], seed })
  }
  let { chs, seed: after } = programs.get(key)
  seed = after
  return audio.from(chs.map(c => c.slice()), { sampleRate: sr })
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

// A crop from 0 keeps the first segment's start but not its length: resolve ops after it measure the crop, not the
// source (normalize after crop({ at: 0 }) read the whole file's loudness, 0.2 LU off on a Spoken Wikipedia take).
test('normalize after a crop from the start measures the crop', async t => {
  let crop = (await audio(lena)).crop({ at: 0, duration: 6 }), want = await crop.stat('loudness')
  t.ok(Math.abs(want - await (await audio(lena)).stat('loudness')) > 0.1, 'the first 6 s differ from the whole in loudness')
  let a = (await audio(lena)).crop({ at: 0, duration: 6 }).normalize('broadcast')
  t.almost(await audio.from(await a.read(), { sampleRate: 44100 }).stat('loudness'), -23, 0.01, 'lands on -23 LUFS')
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

// Read against the band-limited reference (bandPeak): the published meter's 32-tap Lanczos ripple reads full-band noise
// 0.07 dB high, and its attenuation near Nyquist reads it low elsewhere
test('normalize: true-peak ceiling on full-band noise, inter-sample peaks included', async t => {
  seed = 7
  let x = Float32Array.from({ length: 48000 }, () => (rnd() * 2 - 1) * 1.5)
  let a = audio.from([x], { sampleRate: 48000 }).normalize(0, { ceiling: -1 })
  let pcm = await a.read()
  t.ok(bandPeak(pcm) <= -1 + 0.01, `true peak ${bandPeak(pcm).toFixed(4)} dBTP, band-limited`)
})

// normalize measures its selection: it measured the whole timeline and gave the selection that gain (3 s at -29.7 LUFS
// inside a -14.3 LUFS file, taken "to -20 LUFS", came out at -35.4)
/** Band-limited true peak, dBTP: the waveform read 32 points a sample through a Kaiser-windowed sinc (β 14, 64 samples
 *  each side, silence outside), near every sample within 3 dB of its channel's largest. The reference the true-peak
 *  meter is tested against (it matches scipy's firwin at 32× to 1e-6 dB); slow, for tests. */
function bandPeak(chs) {
  let i0 = z => { let s = 1, t = 1; for (let k = 1; k < 60; k++) s += t *= (z / 2 / k) ** 2; return s }, I = i0(14)
  let sinc = x => x === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x)
  let K = Array.from({ length: 32 }, (_, p) => Float64Array.from({ length: 128 }, (_, j) => { let d = 63 - j + p / 32; return Math.abs(d) >= 64 ? 0 : sinc(d) * i0(14 * Math.sqrt(1 - (d / 64) ** 2)) / I }))
  let peak = 0
  for (let x of chs) {
    let top = 0
    for (let v of x) top = Math.max(top, Math.abs(v))
    for (let i = 0; i < x.length; i++) {
      peak = Math.max(peak, Math.abs(x[i]))
      if (Math.max(Math.abs(x[i]), Math.abs(x[i + 1] ?? 0)) < top * 0.708) continue
      for (let p = 1; p < 32; p++) { let h = K[p], y = 0; for (let j = 0; j < 128; j++) { let k = i - 63 + j; if (k >= 0 && k < x.length) y += h[j] * x[k] } peak = Math.max(peak, Math.abs(y)) }
    }
  }
  return 20 * Math.log10(peak)
}

// The limiter held its 32-tap points at the ceiling while the waveform between them, content near Nyquist the kernel
// attenuates, and the gain's own ramp across the kernel rose above it: lena +20 dB peaked 0.22, 0.06, 0.015 and 0.006 dB
// over at 8, 16, 44.1 and 48 kHz. It now reads as @audio/loudness-truepeak does (a 96-tap Kaiser sinc, a parabola at
// each local maximum) and holds the taps under an interpolant at one gain: 0.013, 0.003, 0 and 0 dB over.
test('ceiling: holds the band-limited peak, between the points and near Nyquist, at 8, 16, 44.1 and 48 kHz', { timeout: 60000 }, async t => {
  let v = await audio(lena)
  for (let [sr, tol] of [[8000, 0.02], [16000, 0.005], [44100, 0.005], [48000, 0.005]]) {
    let a = v.clone().crop({ at: 2, duration: 4 })
    if (sr !== 44100) a = a.resample(sr)
    let peak = bandPeak(await a.gain(20).run(['ceiling', { limit: -1 }]).read())
    t.ok(peak <= -1 + tol, `${sr} Hz, limited 20 dB: ${peak.toFixed(4)} dBTP`)
  }
})

// normalize lands when its loudness prints as the target, to 0.01 as check judges it. Spotify's rule switches at the
// target (-2 dBTP past -14 LUFS): a search that ran out of steps kept a gain it had not measured, -13.98, and its own
// check then asked for -2 dBTP. Here a stage's loudness jumps from -14.02 to -13.98 at 10 dB of gain, never within
// 0.005 of -14: the search must keep a measured gain under the target.
test('normalize: out of steps, it keeps a measured gain under the target, never one past it', { timeout: 60000 }, async t => {
  let sr = 48000, n = 10 * sr, nb = Math.ceil(n / 1024)
  let stage = lufs => { let e = 10 ** ((lufs + 0.691) / 10); return { blockSize: 1024, length: n, energy: [new Float32Array(nb).fill(e)], min: [new Float32Array(nb).fill(-0.9)], max: [new Float32Array(nb).fill(0.9)], dc: [new Float32Array(nb)], ms: [new Float32Array(nb).fill(e)] } }
  let measured = [], measure = edits => { let g = edits.find(e => e[0] === 'gain')[1].value; measured.push(g); return stage(g < 10 ? -14.02 : -13.98) }
  let edits = audio.op('normalize').resolve({ stats: stage(-20), sampleRate: sr, final: true, target: 'streaming', measure, totalDuration: n / sr })
  let g = edits.find(e => e[0] === 'gain')[1].value
  t.ok(g < 10, `kept ${g.toFixed(2)} dB (loudness -14.02), after measuring ${measured.map(v => v.toFixed(1)).join(', ')} dB`)
  for (let [name, a] of [['lena', await audio(lena)], ['program', program()], ['lena, compressed', (await audio(lena)).compressor({ threshold: -30, ratio: 4 })]]) {
    let r = await a.normalize('streaming').check('streaming')
    t.is([r.rules[0].value.toFixed(2), r.rules[1].max, r.pass], ['-14.00', -1, true], `${name}: ${r.rules[0].value.toFixed(4)} LUFS, true peak ${r.rules[1].value.toFixed(3)}`)
  }
})

test('normalize: a selection is measured alone', async t => {
  let sr = 48000, x = Float32Array.from({ length: 10 * sr }, (_, i) => (i < 5 * sr ? 0.05 : 0.3) * Math.sin(2 * Math.PI * 440 * i / sr))
  let src = audio.from([x], { sampleRate: sr }), out = audio.from(await src.clone().normalize(-20, 'lufs', { at: 1, duration: 3 }).read(), { sampleRate: sr })
  t.almost(await out.stat('loudness', { at: 1, duration: 3 }), -20, 0.01, 'the selection lands on -20 LUFS')
  t.almost(await out.stat('loudness', { at: 5, duration: 5 }), await src.stat('loudness', { at: 5, duration: 5 }), 1e-6, 'the rest is untouched')
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

// EBU Tech 3341 (V4, 2023) Table 1, the signals as defined: a 1000 Hz sine at a per-channel peak level (dBFS; null:
// silence), in phase on both channels, 48 kHz, tones following each other on one running phase; each measured afresh.
function ebu(segs, nch = 2) {
  let sr = 48000, n = segs.reduce((n, [s]) => n + Math.round(s * sr), 0), x = new Float32Array(n), i = 0
  for (let [s, db] of segs) for (let e = i + Math.round(s * sr); i < e; i++) x[i] = db == null ? 0 : 10 ** (db / 20) * Math.sin(2 * Math.PI * 1000 * i / sr)
  return audio.from(Array.from({ length: nch }, () => x.slice()), { sampleRate: sr })
}

test('EBU Tech 3341 cases 1-6: integrated loudness, cases 1-2 momentary and short-term, ±0.1 LU', { timeout: 60000 }, async t => {
  for (let [k, L] of [[1, -23], [2, -33]]) for (let name of ['loudness', 'momentary', 'shortterm']) t.almost(await ebu([[20, L]]).stat(name), L, 0.1, `case ${k}: ${name}`)
  t.almost(await ebu([[10, -36], [60, -23], [10, -36]]).stat('loudness'), -23, 0.1, 'case 3')
  t.almost(await ebu([[10, -72], [10, -36], [60, -23], [10, -36], [10, -72]]).stat('loudness'), -23, 0.1, 'case 4')
  t.almost(await ebu([[20, -26], [20.1, -20], [20, -26]]).stat('loudness'), -23, 0.1, 'case 5')
  let ch = db => ebu([[20, db]], 1).read().then(([x]) => x), [l, c, s] = await Promise.all([ch(-28), ch(-24), ch(-30)])
  t.almost(await audio.from([l, l, c, s, s], { sampleRate: 48000 }).stat('loudness'), -23, 0.1, 'case 6: 5.0, L R -28, C -24, Ls Rs -30')
})

// Cases 9 and 12: every window after the first reads the same, 1.34 of 3 s (0.18 of 0.4 s) at -20 dBFS, the rest at -30
test('EBU Tech 3341 cases 9 and 12: short-term and momentary constant at -23.0 ±0.1 LUFS', { timeout: 60000 }, async t => {
  let s = ebu(Array(5).fill([[1.34, -20], [1.66, -30]]).flat()), m = ebu(Array(25).fill([[0.18, -20], [0.22, -30]]).flat())
  for (let at = 0; at <= 12; at += 0.7) t.almost(await s.stat('shortterm', { at, duration: 3 }), -23, 0.1, `case 9: S at ${(at + 3).toFixed(1)} s`)
  for (let at = 0.6; at <= 9.6; at += 0.45) t.almost(await m.stat('momentary', { at, duration: 0.4 }), -23, 0.1, `case 12: M at ${(at + 0.4).toFixed(2)} s`)
})

// Cases 10 and 13 (file-based meters): a tone after i·0.15 s (i·20 ms) of silence, max S (M) -23.0 in each of 20 files;
// 11 and 14 (live meters): the 20 tones in one file at -38+i dBFS, each segment's max. A meter sliding by 100 ms misses
// a 400 ms tone by up to 50 ms: -0.6 LU on case 13 (a window of blocks, 405 ms every 107 ms, read -23.6).
test('EBU Tech 3341 cases 10, 11, 13, 14: the maxima find a tone wherever it lies', { timeout: 120000 }, async t => {
  for (let i = 0; i < 20; i++) {
    t.almost(await ebu([[i * 0.15, null], [3, -23], [1, null]]).stat('shortterm'), -23, 0.1, `case 10.${i}`)
    t.almost(await ebu([[i * 0.02, null], [0.4, -23], [1, null]]).stat('momentary'), -23, 0.1, `case 13.${i}`)
  }
  let s = ebu(Array.from({ length: 20 }, (_, i) => [[i * 0.15, null], [3, -38 + i], [3 - i * 0.15, null]]).flat())
  let m = ebu(Array.from({ length: 20 }, (_, i) => [[i * 0.02, null], [0.4, -38 + i], [0.4 - i * 0.02, null]]).flat())
  for (let i = 0; i < 20; i++) {
    t.almost(await s.stat('shortterm', { at: 6 * i, duration: 6 }), -38 + i, 0.1, `case 11.${i}`)
    t.almost(await m.stat('momentary', { at: 0.8 * i, duration: 0.8 }), -38 + i, 0.1, `case 14.${i}`)
  }
  // the same files as one series each, `bins` a segment: each bin its tone's maximum (bins on the block grid hold each tone)
  let S = await s.stat('shortterm', { bins: 20 }), M = await m.stat('momentary', { bins: 20 })
  for (let i = 0; i < 20; i++) {
    t.almost(S[i], -38 + i, 0.1, `case 11.${i}: bin ${i}`)
    t.almost(M[i], -38 + i, 0.1, `case 14.${i}: bin ${i}`)
  }
})

// ITU-R BS.1770-4 eq. 3: gating blocks of 400 ms "to the nearest sample", one every 100 ms. Blocks of block stats (1024
// samples) stood in for them, 405 ms every 107 ms at 48 kHz: 0.08 LU off on 90 s of speech, 0.8 LU on a 1.8 s clip.
// @audio/loudness-lufs (under replaygain) runs the blocks sample-exact and agrees with libebur128 1.2.6 to 1e-4 LU.
test('loudness: BS.1770 gating blocks exactly, through edits and ranges', { timeout: 60000 }, async t => {
  let v = await audio(lena), sr = v.sampleRate, want = pcm => replaygain(pcm, { fs: sr }).lufs
  let [x] = await v.read()
  let cases = [['speech', v], ['a 1.8 s clip', v.clone().crop({ at: 3.1, duration: 1.8 })], ['gain', v.clone().gain(-7.3)],
    ['crop on the grid', v.clone().crop({ at: 1.6, duration: 8 })], ['pad', v.clone().pad(1, 0.7)], ['reverse', v.clone().reverse()],
    ['8 kHz', v.clone().resample(8000)], ['stereo 48 kHz', audio.from([x, x.map(s => 0.5 * s)], { sampleRate: sr }).resample(48000)]]
  for (let [name, a] of cases) {
    let pcm = await a.read(), fs = a.sampleRate
    t.almost(await a.stat('loudness'), replaygain(pcm, { fs }).lufs, 1e-3, name)
  }
  for (let [at, duration] of [[0.05, 5], [2.33, 7.1]])
    t.almost(await v.stat('loudness', { at, duration }), want(x.subarray(Math.round(at * sr), Math.round((at + duration) * sr))), 1e-4, `range ${at} s + ${duration} s`)
})

// BS.1770-4 eq. 6: blocks count above -70 LKFS. The gate compared the block's mean square without the -0.691 offset,
// i.e. at -70.691 LKFS.
test('loudness: the absolute gate is -70 LKFS', async t => {
  t.is(await ebu([[5, -70.3]]).stat('loudness'), -Infinity, '-70.3 LUFS gated out')
  t.almost(await ebu([[5, -69.7]]).stat('loudness'), -69.7, 0.1, '-69.7 LUFS measured')
})

// 4 channels are L R Ls Rs where remix reads them; BS.1770-4 Table 3 weighs the surrounds 1.41
test('loudness: quad surrounds weigh 1.41', async t => {
  let tone = Float32Array.from({ length: 48000 * 3 }, (_, i) => 0.1 * Math.sin(2 * Math.PI * 1000 * i / 48000)), z = new Float32Array(tone.length)
  let l = await audio.from([tone, z, z, z], { sampleRate: 48000 }).stat('loudness'), ls = await audio.from([z, z, tone, z], { sampleRate: 48000 }).stat('loudness')
  t.almost(ls - l, 10 * Math.log10(1.41), 0.01, `Ls +${(ls - l).toFixed(3)} dB`)
})

// The playback meter computed each block's stats from rest: K-weighting restarted every block misread its energy
test('meter: block stats carry filter state from block to block', async t => {
  let sr = 48000, x = Float32Array.from({ length: 8 * 1024 }, (_, i) => 0.5 * Math.sin(2 * Math.PI * 40 * i / sr))
  let a = audio.from([x], { sampleRate: sr }), got = []
  let { emitMeter } = await import('../fn/meter.js')
  a.meter({}, ({ delta }) => got.push(delta.energy[0][0]))
  for (let b = 0; b < 8; b++) emitMeter(a, [x.subarray(b * 1024, (b + 1) * 1024)], b * 1024 / sr)
  let want = a.stats.energy[0]
  for (let b = 1; b < 8; b++) t.almost(got[b], want[b], want[b] * 1e-5, `block ${b}`)
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

// write() puts samples or another sound over the audio from `at`, as a tape records over what is there (punch-in);
// what runs past the end extends it
test('write: samples or a sound over the audio from at, what runs past the end extending it', async t => {
  let sr = 1000, ramp = n => audio.from([Float32Array.from({ length: n }, (_, i) => i + 1)], { sampleRate: sr })
  let take = () => audio.from([Float32Array.of(-1, -2, -3)], { sampleRate: sr }), vals = async a => [...(await a.read())[0]]
  t.is(await vals(ramp(6).write(take(), { at: 0.002 })), [1, 2, -1, -2, -3, 6], 'a sound, within the audio')
  t.is(await vals(ramp(4).write(take(), { at: 0.003 })), [1, 2, 3, -1, -2, -3], 'past the end: the audio grows to hold it')
  t.is(await vals(ramp(4).write([Float32Array.of(9, 9)], { at: 0.003 })), [1, 2, 3, 9, 9], 'samples, the same way')
  t.is(await vals(ramp(4).write(Float32Array.of(7), { at: 0 })), [7, 2, 3, 4], 'one Float32Array for every channel')
  let stereo = audio.from([new Float32Array(4), new Float32Array(4)], { sampleRate: sr }), [l, r] = await stereo.write(take(), { at: 0.001 }).read()
  t.is([[...l], [...r]], [[0, -1, -2, -3], [0, -1, -2, -3]], 'a mono sound into both channels')
  let a = ramp(4).write(take(), { at: 0.003 }), s = []
  for await (let b of a.stream()) s.push(...b[0])
  t.is(s, await vals(a), 'stream ≡ read')
  a.undo()
  t.is(await vals(a), [1, 2, 3, 4], 'undo restores the length and the samples')
  await t.rejects(() => ramp(4).write(3).read(), /write: expected samples/)
})

// A range crossfaded with no source to blend into: the audio either side of it meets across its length, as a selection
// crossfaded in an editor, which is remove() with a splice as long as the range
test('crossfade: a range with no source crossfades across it, as remove with a splice its length', async t => {
  let sr = 48000, tone = () => audio.from(x => 0.5 * Math.sin(2 * Math.PI * 440 * x), { duration: 1, sampleRate: sr })
  let [a] = await tone().crossfade({ at: 0.5, duration: 0.01 }).read(), [b] = await tone().remove(0.5, 0.01, 0.01).read()
  t.is(a.length, sr - 480, 'the range goes: 1 s less 10 ms')
  t.ok(a.length === b.length && a.every((v, i) => v === b[i]), 'sample for sample remove(at, duration, duration)')
  // the two sides meet out of phase; an equal-power sum of two such tones reaches at most √2 of either's amplitude, so of
  // its slope, where a butt splice steps many times it
  let steep = x => { let m = 0; for (let i = 1; i < x.length; i++) m = Math.max(m, Math.abs(x[i] - x[i - 1])); return m }
  let slope = 0.5 * 2 * Math.PI * 440 / sr, [x] = await tone().crossfade({ at: 0.5, duration: 0.005 }).read(), [butt] = await tone().remove(0.5, 0.005).read()
  t.ok(steep(x) <= slope * Math.SQRT2, `no step at the seam: ${(steep(x) / slope).toFixed(3)}× the tone's slope, a butt splice ${(steep(butt) / slope).toFixed(1)}×`)
  // neither: said when it renders, as every op's arguments are
  await t.rejects(() => tone().crossfade().read(), /crossfade: expected a source to blend into, or a range/)
})

// After a stretch, a pitch or a warp (a phase vocoder, its state carried from block to block), a crossfade's two sides
// read the one processed sound at two places in turn, and so does each stage inside it. Each side reads as that sound
// does on its own from there: one cursor for both, re-seeked at every block, steps at each block's edge, a click. Short
// (50 ms, under the 8 blocks a cursor skips ahead by) or long, the sides keep their own
test('crossfade: after a stretch, a pitch or a warp, each side reads on as the processed sound does alone', async t => {
  let sr = 44100, tone = () => audio.from(x => 0.5 * Math.sin(2 * Math.PI * 440 * x), { duration: 2, sampleRate: sr })
  let made = { stretch: () => tone().stretch(1.25), pitch: () => tone().pitch(3), warp: () => tone().warp([[0.6, 0.7], [1.2, 1.2]]) }
  for (let [name, make] of Object.entries(made)) for (let dur of [0.3, 0.05]) {
    let at = 0.5, off = Math.round(at * sr), d = Math.round(dur * sr), h = Math.floor(d / 2)
    let [x] = await make().crossfade({ at, duration: dur }).read(), [before] = await make().read()
    // the side after the range, read on its own from where it starts fading in
    let [after] = await make().remove({ at: 0, duration: (off + d - h) / sr }).read(), worst = 0
    // equal-power (plan.js renderEnvSeg): the gains sin and cos of a phase linear across the overlap, at sample centres
    for (let i = 0; i < 2 * h; i++) { let u = (i + .5) / (2 * h); worst = Math.max(worst, Math.abs(x[off - h + i] - before[off - h + i] * Math.cos(u * Math.PI / 2) - after[i] * Math.sin(u * Math.PI / 2))) }
    t.ok(worst < 1e-6, `${name}, ${dur * 1000} ms: the overlap is its sides' equal-power sum, within ${worst.toExponential(1)}`)
  }
  // streamed, block by block, the same samples as read
  let [r] = await made.warp().crossfade({ at: 0.5, duration: 0.3 }).read(), s = []
  for await (let b of made.warp().crossfade({ at: 0.5, duration: 0.3 }).stream()) s.push(...b[0])
  t.ok(s.length === r.length && s.every((v, i) => v === r[i]), 'stream ≡ read')
})

// A range moved as a DAW slides a clip (slip mode): over what is where it lands, silence where it was, the length kept,
// past the end extending it; positional or by name; its edges crossfaded without a step; stream ≡ read; undo
test('move: a range slides over what is there, silence where it was', async t => {
  let ramp = n => audio.from([Float32Array.from({ length: n }, (_, i) => i + 1)], { sampleRate: 1000 }), vals = async a => [...(await a.read())[0]]
  t.is(await vals(ramp(10).move({ at: 0.002, duration: 0.003, to: 0.006 })), [1, 2, 0, 0, 0, 6, 3, 4, 5, 10], 'later')
  t.is(await vals(ramp(10).move({ at: 0.005, duration: 0.003, to: 0 })), [6, 7, 8, 4, 5, 0, 0, 0, 9, 10], 'earlier, to the start')
  t.is(await vals(ramp(10).move({ at: 0.002, duration: 0.003, to: 0.003 })), [1, 2, 0, 3, 4, 5, 7, 8, 9, 10], 'over itself')
  t.is(await vals(ramp(10).move({ at: 0.002, duration: 0.003, to: 0.008 })), [1, 2, 0, 0, 0, 6, 7, 8, 3, 4, 5], 'past the end: longer')
  t.is(await vals(ramp(10).move(0.002, 0.003, 0.006)), await vals(ramp(10).move({ at: 0.002, duration: 0.003, to: 0.006 })), 'positional')
  t.is(await vals(ramp(10).move({ at: 0.002, duration: 0.003, to: 0.002 })), await vals(ramp(10)), 'to where it is: unchanged')
  t.is(await vals(ramp(10).move({ at: 0.002, duration: 0, to: 0.006 })), await vals(ramp(10)), 'nothing to move')
  let a = ramp(10).move({ at: 0.002, duration: 0.003, to: 0.006 })
  a.undo()
  t.is(await vals(a), await vals(ramp(10)), 'undo restores it')
  // a tone's sample steps stay within its slope (√2 of it where two sides meet out of phase), where a butt edge steps
  let sr = 48000, tone = () => audio.from(x => 0.5 * Math.sin(2 * Math.PI * 440 * x), { duration: 1, sampleRate: sr })
  let step = x => { let m = 0; for (let i = 1; i < x.length; i++) m = Math.max(m, Math.abs(x[i] - x[i - 1])); return m }
  let slope = 0.5 * 2 * Math.PI * 440 / sr, moved = () => tone().move({ at: 0.2001, duration: 0.1003, to: 0.5007, crossfade: 0.01 })
  let [butt] = await tone().move({ at: 0.2001, duration: 0.1003, to: 0.5007 }).read(), [x] = await moved().read()
  t.ok(step(butt) > 2 * slope && step(x) <= slope * Math.SQRT2, `edges ${(step(x) / slope).toFixed(2)}× the slope, butt ${(step(butt) / slope).toFixed(1)}×`)
  t.is(x.length, sr, 'the length kept')
  let s = []
  for await (let b of moved().stream()) s.push(...b[0])
  t.ok(s.length === x.length && s.every((v, i) => Math.abs(v - x[i]) < 1e-7), 'stream ≡ read')
  // at the file's edges a crossfade shrinks to fit: moved from the start to the very end, its edges there meet butt (no
  // audio before the range, none past the end); where it was, its end fades the audio after it in over the 2 samples
  // its handle and the range allow, equal-power at sample centres (plan.js renderEnvSeg: sin of (i + .5) / 2 · π/2)
  let g = i => Math.sin((i + 0.5) / 2 * Math.PI / 2), edged = await vals(ramp(10).move({ at: 0, duration: 0.003, to: 0.007, crossfade: 0.004 }))
  t.ok([0, 0, 3 * g(0), 4 * g(1), 5, 6, 7, 1, 2, 3].every((v, i) => Math.abs(edged[i] - v) < 1e-6), `edges: ${edged.map(v => +v.toFixed(3))}`)
  // each channel its own; a time as a string
  let st = audio.from([Float32Array.of(1, 2, 3, 4), Float32Array.of(-1, -2, -3, -4)], { sampleRate: 1000 })
  t.is((await st.move({ at: 0, duration: 0.002, to: '0.002' }).read()).map(c => [...c]), [[0, 0, 1, 2], [0, 0, -1, -2]], 'stereo, to as a string')
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

// FFmpeg's short names (afade/acrossfade/atrim `d`; its crossfade filter `xfade`) say the same as the long ones, wherever
// an option is a duration or a crossfade: edits, ranges read and measured, nested ranges, clips; the long one wins.
test('aliases: d is duration and xfade crossfade, everywhere; the long name wins', async t => {
  let a = () => audio.from(i => Math.sin(2 * Math.PI * 440 * i), { d: 2, sampleRate: 8000 }), same = (p, q) => p[0].length === q[0].length && p[0].every((v, i) => v === q[0][i])
  t.is(a().duration, 2, 'audio.from(fn, { d })')
  t.ok(same(await a().remove({ at: .5, d: .5, xfade: .01 }).read(), await a().remove({ at: .5, duration: .5, crossfade: .01 }).read()), 'remove({ d, xfade })')
  t.ok(same(await a().fade(.1, { at: 1, d: .2 }).read(), await a().fade(.1, { at: 1, duration: .2 }).read()), 'fade({ d })')
  t.ok(same(await a().move({ at: .2, d: .3, to: 1, xfade: .01 }).read(), await a().move({ at: .2, duration: .3, to: 1, crossfade: .01 }).read()), 'move({ d, xfade })')
  t.is((await a().read({ at: .5, d: .25 }))[0].length, 2000, 'read({ d })')
  t.is(await a().stat('rms', { at: .25, d: 1 }), await a().stat('rms', { at: .25, duration: 1 }), 'stat({ d })')
  t.is(a().clip({ at: .5, d: .5 }).duration, .5, 'clip({ d })')
  t.is((await a().read({ d: .25, duration: .5 }))[0].length, 4000, 'both given: duration')
})

// What a file is (its rate, its channels) is known once its header is read: a stat asked of a file just opened reads
// it first, so it measures as it would once loaded; an op on a channel the audio hasn't says so
// five files decoded and two plugins loaded: past tst's 5 s on a CI runner running the suites side by side
test('a file just opened: its dialog and noise floor, a registry op encoded; an op on a channel it hasn\'t', { timeout: 30000 }, async t => {
  let loaded = await audio(lena)
  t.is(await audio(lena).stat('dialog'), await loaded.stat('dialog'), 'dialog')
  t.ok(Number.isFinite(await audio(lena).stat('dialog')), 'speech found')
  t.is(await audio(lena).stat('noisefloor'), await loaded.stat('noisefloor'), 'noise floor')
  // a registry op on a file encoded as it decodes: wired before the encoder plans (the README's first example)
  let bytes = await audio(lena).highpass(80).compressor({ threshold: -20, ratio: 3 }).encode('wav')
  t.is((await audio(bytes)).length, (await audio(lena)).length, 'encoded whole')
  let err = await audio.from([new Float32Array(100)], { sampleRate: 8000 }).highpass(100, 4, { channel: 1 }).read().catch(e => e)
  t.ok(err instanceof RangeError && /channel 1: the audio has 1 channel/.test(err.message), err.message)
})

// A crossfade across a range of no length takes nothing out: 0 is a length, not the default half second
test('crossfade: across a range of no length, the sound as it was', async t => {
  let a = () => audio.from(i => Math.sin(2 * Math.PI * 440 * i), { duration: 1, sampleRate: 8000 })
  let x = await a().crossfade({ at: .5, duration: 0 }).read(), y = await a().read()
  t.ok(x[0].length === y[0].length && x[0].every((v, i) => v === y[0][i]))
})

test('remix: quad and 7.1 downmix, same coefficients', async t => {
  let n = 48, one = (N, c) => Array.from({ length: N }, (_, k) => new Float32Array(n).fill(k === c ? 1 : 0))
  let st = async (N, c) => (await audio.from(one(N, c), { sampleRate: 48000 }).remix(2).read()).map(x => +x[0].toFixed(4))
  t.is(await st(4, 2), [0.7071, 0], 'quad Ls → L')
  t.is(await st(8, 3), [0, 0], '7.1 LFE dropped')
  t.is(await st(8, 4), [0.7071, 0], '7.1 back left → L')
  t.is(await st(8, 7), [0, 0.7071], '7.1 side right → R')
  // 7.1 (L R C LFE Lb Rb Ls Rs, WAV/SMPTE order) to 5.1: the fronts and the LFE as they were, each side's back and side
  // surrounds into its surround, at 1 as the 3/2 identity takes them (the slots above)
  let five = async c => (await audio.from(one(8, c), { sampleRate: 48000 }).remix(6).read()).map(x => +x[0].toFixed(4))
  t.is(await five(2), [0, 0, 1, 0, 0, 0], '7.1 C → C')
  t.is(await five(3), [0, 0, 0, 1, 0, 0], '7.1 LFE → LFE')
  t.is(await five(4), [0, 0, 0, 0, 1, 0], '7.1 back left → Ls')
  t.is(await five(7), [0, 0, 0, 0, 0, 1], '7.1 side right → Rs')
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
  let rms = r => +/rms\s+(-?[\d.]+) dBFS/.exec(run(tmp('bed.wav'), 'ducker', 'key:' + tmp('voice.wav'), 'stat', 'rms', r))[1]
  t.ok(rms('0.8s..1.2s') < rms('0.1s..0.4s') - 20 * Math.log10(3), 'bed ducks under the voice file (by more than a third)')
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
  for (let n of [...ops, ...plugins]) t.ok(audio.op(n) || audio.plugins[n] || typeof audio.fn[n] === 'function', `op ${n}`)
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

// The pitch curve a voice is edited on (the editor's, intonation()'s): a voice gliding as speech does, ±4 semitones about
// 140 Hz twice a second, which YIN's own threshold (.15) found half of, the curve finds whole and close to its pitch;
// silence before it has none, nor a room's mains hum after it, 40 dB down (pYIN alone hears its 60 Hz; Praat's silence
// threshold, 0.03 of the peak, does not); nothing in, nothing out
test('contour: a gliding voice whole, to within cents; silence and a quiet hum have no pitch', async t => {
  let { contour } = await import('../fn/pitch-detect.js'), sr = 44100, f = s => 140 * 2 ** (4 * Math.sin(2 * Math.PI * 2 * s) / 12)
  let v = vowel(f, 2), x = new Float32Array(4 * sr), seed = 5
  x.set(v, sr)
  for (let i = 3 * sr; i < x.length; i++) x[i] = .003 * Math.sin(2 * Math.PI * 60 * i / sr) + .001 * ((seed = seed * 16807 % 2147483647) / 2147483647 - .5)
  let { times, f0 } = contour(x, sr), inside = [], cents = [], off = []
  times.forEach((s, i) => {
    if (s > 1.05 && s < 2.95) { inside.push(f0[i]); if (f0[i]) cents.push(Math.abs(1200 * Math.log2(f0[i] / f(s - 1)))) }
    else if (s < .95 || s > 3.05) off.push(f0[i])
  })
  let found = inside.filter(Boolean).length / inside.length
  cents.sort((p, q) => p - q)
  t.ok(found > .97, `${(100 * found).toFixed(0)}% of the voice's frames found`)
  t.ok(cents[cents.length >> 1] < 10, `${cents[cents.length >> 1].toFixed(1)} cents from its pitch, in the median`)
  t.ok(off.every(h => h === 0), `no pitch in the silence or the hum (${off.filter(Boolean).length} of ${off.length} frames)`)
  let none = contour(new Float32Array(0), sr), short = contour(new Float32Array(100), sr)
  t.ok(none.times.length === 0 && none.f0.length === 0 && short.f0.every(h => h === 0), 'nothing in, nothing out; a moment of silence, no pitch')
})

// A voice's melody, wider or flatter: its pitch read back (the contour the editor draws) lies `factor` times as far from
// its median as it did, in semitones; at 1 the input; a range leaves the rest as it was
test('intonation: rises and falls scale about the median; 1 is the input; a range keeps the rest', async t => {
  if (!await import('@audio/tune-curve').catch(() => null)) return t.ok(true, 'skipped: @audio/tune-curve is not installed')
  let { contour } = await import('../fn/pitch-detect.js')
  // ±3 semitones about 140 Hz, a rise and fall every 1.25 s, as speech's melody moves
  let sr = 44100, x = vowel(s => 140 * 2 ** (3 * Math.sin(2 * Math.PI * .8 * s) / 12), 3)
  let read = async f => (await f(audio.from([x.slice(), x.map(v => .5 * v)], { sampleRate: sr })).read())
  // semitones from the median, over 0.5–2.5 s
  let moves = (y, from = .5, to = 2.5) => {
    let { times, f0 } = contour(y, sr), st = [...f0].map((f, i) => times[i] > from && times[i] < to && f ? 12 * Math.log2(f) : NaN).filter(v => v === v)
    let mid = [...st].sort((p, q) => p - q)[st.length >> 1]
    return st.map(v => v - mid)
  }
  let spread = m => { let s = [...m].sort((p, q) => p - q); return s[Math.floor(.9 * (s.length - 1))] - s[Math.floor(.1 * (s.length - 1))] }
  let base = spread(moves(x))
  for (let k of [0, .5, 2]) {
    let [l, r] = await read(a => a.intonation(k)), got = spread(moves(l))
    t.ok(Math.abs(got - k * base) < .4 + .1 * k * base, `×${k}: ${base.toFixed(2)} → ${got.toFixed(2)} semitones from the 10th to the 90th percentile (${(k * base).toFixed(2)} asked)`)
    if (k === 2) t.ok(l.every((v, i) => Math.abs(.5 * v - r[i]) < 1e-6), 'both channels on one set of cycles, each at its level')
  }
  let [same] = await read(a => a.intonation(1))
  t.ok(same.every((v, i) => v === x[i]), '×1: the input, sample for sample')
  let [y] = await read(a => a.intonation(0, { at: 1, duration: 1 })), err = 0
  for (let i = 0; i < x.length; i++) if (i < sr || i >= 2 * sr) err = Math.max(err, Math.abs(y[i] - x[i]))
  t.ok(err < 1e-6, `ranged: before and after it the input (${err.toExponential(1)} off)`)
  let flat = spread(moves(y, 1.1, 1.9)), was = spread(moves(x, 1.1, 1.9))
  t.ok(flat < .5 && was > 3, `ranged: inside it a monotone (${was.toFixed(2)} → ${flat.toFixed(2)} semitones)`)
  // counted from the end, the range's last second: before it the input
  let [z] = await read(a => a.intonation(2, { at: -1 })), early = 0
  for (let i = 0; i < 2 * sr; i++) early = Math.max(early, Math.abs(z[i] - x[i]))
  t.ok(early < 1e-6 && spread(moves(z, 2.1, 2.9)) > 1.5 * spread(moves(x, 2.1, 2.9)), `from the end: before it the input (${early.toExponential(1)} off), in it wider`)
  // no voice (noise), no factor, a moment of voice: the input, its length
  let seed = 7, noise = Float32Array.from({ length: sr }, () => .2 * ((seed = seed * 16807 % 2147483647) / 2147483647 - .5))
  let unchanged = async (src, f) => { let [o] = await f(audio.from([src.slice()], { sampleRate: sr })).read(); return o.length === src.length && o.every((v, i) => v === src[i]) }
  t.ok(await unchanged(noise, a => a.intonation(2)), 'noise, no voice in it: the input')
  t.ok(await unchanged(x, a => a.intonation()), 'no factor: the input')
  let [blip] = await audio.from([x.slice(0, 880)], { sampleRate: sr }).intonation(2).read()
  t.ok(blip.length === 880 && blip.every(Number.isFinite), 'a moment of voice, 20 ms: its length, numbers')
})

// Formants moved, the pitch kept: a vowel whose resonators are made 3 semitones higher is what formant(3) should give;
// its harmonics' levels land close to that vowel's, and its pitch stays
test('formant: the harmonics take the moved formants\' levels, the pitch stays; 0 is the input; a range keeps the rest', async t => {
  let { default: yin } = await import('@audio/pitch-yin')
  let sr = 44100, h = (d, f, a, b) => { let w = 2 * Math.PI * f / sr, re = 0, im = 0; for (let i = a; i < b; i++) { let g = .5 - .5 * Math.cos(2 * Math.PI * (i - a) / (b - a)); re += d[i] * g * Math.cos(w * i); im -= d[i] * g * Math.sin(w * i) } return Math.hypot(re, im) }
  // the levels of the harmonics under 5 kHz re the truth's, the mean taken out: their median distance from it
  let off = (y, truth, f0) => {
    let d = []
    for (let k = 1; k * f0 < 5000; k++) d.push(20 * Math.log10(h(y, k * f0, sr / 2, 3 * sr / 2) / h(truth, k * f0, sr / 2, 3 * sr / 2)))
    let mean = d.reduce((s, v) => s + v) / d.length, e = d.map(v => Math.abs(v - mean)).sort((p, q) => p - q)
    return e[e.length >> 1]
  }
  for (let [f0, st] of [[110, 3], [110, -4], [220, 3], [220, -4]]) {
    let x = vowel(f0, 2), truth = vowel(f0, 2, 2 ** (st / 12)), [y] = await audio.from([x], { sampleRate: sr }).formant(st).read()
    let got = off(y, truth, f0), was = off(x, truth, f0), f = yin(y.subarray(sr, sr + 4096), { fs: sr, minFreq: 60, maxFreq: 1000 }).freq
    t.ok(got < 2 && got < was / 3, `${f0} Hz, ${st > 0 ? '+' : ''}${st}: harmonics ${got.toFixed(1)} dB from the vowel made so (left as it was, ${was.toFixed(1)})`)
    t.ok(Math.abs(1200 * Math.log2(f / f0)) < 2, `${f0} Hz, ${st > 0 ? '+' : ''}${st}: the pitch stays, ${f.toFixed(2)} Hz`)
  }
  let x = vowel(130, 3), read = f => f(audio.from([x.slice()], { sampleRate: sr })).read().then(r => r[0])
  let z = await read(a => a.formant(0)), e0 = 0
  for (let i = 0; i < x.length; i++) e0 = Math.max(e0, Math.abs(z[i] - x[i]))
  t.ok(e0 < 1e-6, `0: the input (${e0.toExponential(1)} off)`)
  let y = await read(a => a.formant(4, { at: 1, duration: 1 })), N = 2048
  t.ok(y.subarray(0, sr - N).every((v, i) => v === x[i]) && y.subarray(2 * sr + N).every((v, i) => v === x[2 * sr + N + i]), 'ranged: the input a frame before and after it, sample for sample')
  let unset = await read(a => a.formant()), e1 = 0
  for (let i = 0; i < x.length; i++) e1 = Math.max(e1, Math.abs(unset[i] - x[i]))
  t.ok(e1 < 1e-6, `no semitones: the input (${e1.toExponential(1)} off)`)
  let [blip] = await audio.from([x.slice(0, 100)], { sampleRate: sr }).formant(3).read()
  t.ok(blip.length === 100 && blip.every(Number.isFinite), 'shorter than a frame: its length, numbers')
  let a = audio.from([x.slice()], { sampleRate: sr }).formant({ t: [.5, 1, 2], v: [0, 3, -3] }), s = []
  for await (let b of a.stream()) s.push(...b[0])
  let w = (await a.read())[0]
  t.ok(s.length === w.length && s.every((v, i) => v === w[i]), 'a curve: stream ≡ read')
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

// Gaps of 5 ms to 1 s cut into the middle of test/fixture.wav (a steady tone, 0.2–1.8 s), every method
// through the op; SNR over the lost samples. The methods' LSD and 'auto' near the best across speech and
// music are @audio/denoise's tests; here 'auto' must stay transparent (≥ 30 dB) on the fixture.
test('repair: each method on gaps of 5 ms to 1 s in the fixture; a transplant copies one passage into all channels', async t => {
  let src = await audio(fileURLToPath(new URL('fixture.wav', import.meta.url))), sr = src.sampleRate, [x] = await src.read()
  let gapSnr = (x, y, a, b) => { let s = 0, e = 0; for (let i = a; i < b; i++) { s += x[i] ** 2; e += (x[i] - y[i]) ** 2 } return 10 * Math.log10(s / e) }
  for (let ms of [5, 20, 100, 300, 1000]) {
    let a = Math.round((1 - ms / 2000) * sr), b = a + Math.round(ms / 1000 * sr), d = x.slice().fill(0, a, b), got = {}
    for (let method of ['ar', 'sinusoidal', 'similarity', 'spectral', 'auto']) {
      if (method === 'ar' && ms > 300) continue   // O(m²) per pass: AR on 1 s gaps is measured in @audio/denoise's scripts/repair.js
      let [y] = await audio.from([d], { sampleRate: sr }).repair({ at: a / sr, duration: (b - a) / sr, method }).read()
      got[method] = gapSnr(x, y, a, b)
    }
    t.ok(got.auto >= 30, `${ms} ms: ` + Object.entries(got).map(([m, v]) => `${m} ${v.toFixed(1)}`).join(', ') + ' dB')
  }
  // right = half the left: one decision from the mix, so the repaired right is still half the left
  let phrase = Float32Array.from({ length: 6 * sr }, (_, i) => { let u = i / sr % 1.5; return 0.3 * Math.sin(2 * Math.PI * [262, 330, 392, 523][Math.floor(u / 0.375)] * u) })
  let a = Math.round(3.2 * sr), b = Math.round(4.2 * sr), L = phrase.slice().fill(0, a, b), R = L.map(v => v / 2)
  let [yl, yr] = await audio.from([L, R], { sampleRate: sr }).repair({ at: 3.2, duration: 1 }).read(), dev = 0
  for (let i = a; i < b; i++) dev = Math.max(dev, Math.abs(yr[i] - yl[i] / 2))
  t.ok(gapSnr(phrase, yl, a, b) > 30, `lost second of a repeating phrase: ${gapSnr(phrase, yl, a, b).toFixed(1)} dB`)
  t.ok(dev < 1e-6, 'the right channel repaired from the same passage')
})

// ── Delivery checks ──────────────────────────────────────────────────────

// ACX Check 2.4.2-1 (Steve Daulton, GPL-2; plugins.audacityteam.org › Loudness compliance checks),
// `getfloor` sample for sample: RMS over 0.4 s windows stepped at 10 Hz (Nyquist `snd-avg`), stereo
// as the root of the channels' mean squares averaged, full windows only.
function acxFloor(chs, sr) {
  let W = Math.round(0.4 * sr), H = Math.round(sr / 10), n = chs[0].length, min = Infinity
  for (let i = 0; i + W <= n; i += H) {
    let s = 0
    for (let ch of chs) for (let j = i; j < i + W; j++) s += ch[j] * ch[j]
    if (s < min) min = s
  }
  return 10 * Math.log10(min / (W * chs.length))
}

/** White noise at `db` RMS (uniform, RMS = amplitude/√3). */
const noise = (n, db) => { let g = 10 ** (db / 20) * Math.sqrt(3); return Float32Array.from({ length: n }, () => g * (rnd() * 2 - 1)) }

test('noisefloor: ACX Check `getfloor`, sample-exact, on speech, bursts and a rising floor', async t => {
  seed = 11
  let cases = [['lena (speech, short pauses)', await (await audio(lena)).read(), 44100]]
  for (let sr of [44100, 48000]) {
    let n = sr * 8, x = noise(n, -65), y = noise(n, -65)
    for (let i = 0; i < n; i++) { let u = (i / sr) % 2; if (u > 0.7) { let v = 0.3 * Math.sin(2 * Math.PI * 180 * i / sr) * Math.sin(Math.PI * (u - 0.7) / 1.3); x[i] += v; y[i] += 0.8 * v } }
    cases.push([`stereo bursts over -65 dB, ${sr} Hz`, [x, y], sr])
    let z = noise(n, 0)
    for (let i = 0; i < n; i++) z[i] *= 10 ** ((-70 + 15 * i / n) / 20)
    cases.push([`floor rising -70 → -55 dB, ${sr} Hz`, [z], sr])
  }
  for (let [name, chs, sr] of cases) {
    let want = acxFloor(chs, sr)
    t.almost(await audio.from(chs, { sampleRate: sr }).stat('noisefloor'), want, 1e-6, `${name}: ${want.toFixed(2)} dB`)
  }
})

// ACX Check `track-rms` is the whole selection's mean square, every sample alike. A file's last block of stats is short;
// it counted as a whole block (7 samples at 0.9 after 3 s of -23 dB read 0.14 dB high).
test('rms: every sample weighs alike, the short last block too', async t => {
  let sr = 44100, x = Float32Array.from({ length: 3 * sr + 7 }, (_, i) => i < 3 * sr ? 0.1 * Math.sin(i / 7) : 0.9)
  let want = Math.sqrt(x.reduce((s, v) => s + v * v, 0) / x.length)
  t.almost(await audio.from([x], { sampleRate: sr }).stat('rms'), want, want * 1e-6)
})

// ACX (help.acx.com › ACX Audio Submission Requirements): RMS -23 to -18 dB, peaks < -3 dB, noise
// floor < -60 dB RMS, 1 to 5 s of room tone at the start and end, 44.1 kHz, ≤ 120 min per file.
test('check: acx passes a compliant chapter, reads room tone to the block, and names what fails', async t => {
  seed = 12
  let sr = 44100, n = Math.round(7.5 * sr), x = noise(n, -70), amp = Math.sqrt(2 * 0.01 * 7.5 / 4)  // whole-file RMS -20 dB
  for (let i = 2 * sr; i < 6 * sr; i++) x[i] += amp * Math.sin(2 * Math.PI * 300 * i / sr)
  let r = await audio.from([x], { sampleRate: sr }).check('acx'), rule = name => r.rules.find(x => x.name === name)
  t.ok(r.pass, r.rules.filter(x => !x.pass).map(x => x.name).join(', ') || 'passes')
  t.almost(rule('RMS').value, -20, 0.05, 'RMS -20 dB')
  t.almost(rule('Noise floor').value, -70, 0.3, 'floor: the room tone')
  t.almost(rule('Room tone, start').value, 2, 1024 / sr, 'head 2 s, to the block')
  t.almost(rule('Room tone, end').value, 1.5, 1024 / sr, 'tail 1.5 s, to the block')
  let y = audio.from([x.subarray(2 * sr)], { sampleRate: sr }).resample(48000), f = await y.check('acx')
  t.is(f.rules.filter(x => x.pass === false).map(x => x.name), ['Room tone, start', 'Sample rate'], 'no head room tone, 48 kHz')
  let d = new Float32Array(7 * sr); d.set(x.subarray(2 * sr, 6 * sr), sr)
  let dead = await audio.from([d], { sampleRate: sr }).check('acx')
  t.ok(/dead silence/.test(dead.rules.find(x => x.name === 'Noise floor').note), 'digital silence is noted, as ACX Check warns')
})

// Apple Podcasts: -16 LKFS ±1, true peak ≤ -1 dBFS (podcasters.apple.com/support/893); EBU R 128-2023:
// -23.0 LUFS ±0.2 LU in QC (i), ≤ -1 dBTP (m); Spotify plays at -14 LUFS, masters ≤ -1 dBTP, ≤ -2 when
// louder than -14 (support.spotify.com …/loudness-normalization); limits judged at 0.01 as printed.
test('check: loudness specs pass what normalize delivers; limits, info rows, aliases, errors', { timeout: 60000 }, async t => {
  for (let [preset, spec] of [['podcast', 'apple'], ['broadcast', 'ebu'], ['streaming', 'spotify']]) {
    let r = await program().normalize(preset).check(spec)
    t.ok(r.pass, `${preset} → check ${spec}: ${r.rules.map(x => `${x.name} ${x.value.toFixed(2)}`).join(', ')}`)
    t.is(r.spec, preset, `${spec} is ${preset}`)
  }
  let loud = await program().normalize(-9, 'lufs').check('streaming'), tp = loud.rules[1]
  t.is([loud.rules[0].pass, tp.max, tp.pass], [null, -2, false], 'louder than -14: info row, -2 dBTP, a -1 dBTP master fails')
  t.ok(/plays 5\.0 dB quieter/.test(loud.rules[0].note), loud.rules[0].note)
  let off = await program().normalize(-23.3, 'lufs').check('broadcast')
  t.is(off.rules[0].pass, false, '-23.3 LUFS is outside ±0.2 LU')
  t.is(off.rules.slice(2).map(x => x.pass), [null, null, null], 'LRA and maxima describe, never fail')
  t.ok(await program().check('youtube').then(() => false, e => /unknown spec 'youtube'/.test(e.message)), 'unknown spec throws')
})

test('cli: check prints each rule and exits 1 on a fail; --json; a folder is checked as a book', { timeout: 60000 }, async t => {
  let { spawnSync } = await import('child_process')
  let cli = fileURLToPath(new URL('../bin/cli.js', import.meta.url))
  let run = (...args) => spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8' })
  let ok = run(lena, 'normalize', 'podcast', 'check', 'podcast')
  t.is(ok.status, 0, 'pass exits 0')
  t.ok(/✓ Loudness\s+-16\.00 LUFS\s+-17 to -15/.test(ok.stdout), ok.stdout)
  let bad = run(lena, 'check', 'broadcast')
  t.is(bad.status, 1, 'fail exits 1')
  t.ok(/✗ Loudness\s+-17\.22 LUFS\s+-23\.2 to -22\.8/.test(bad.stdout) && /· Loudness range/.test(bad.stdout), bad.stdout)
  let j = JSON.parse(run(lena, 'check', 'acx', '--json').stdout)
  t.is([j.spec, j.pass, j.rules.length], ['acx', false, 7], 'JSON report')
  t.is(JSON.parse(run(lena, 'stat', 'rms', 'noisefloor', '--json').stdout).noisefloor.toFixed(2), acxFloor(await (await audio(lena)).read(), 44100).toFixed(2), 'stat --json')
  run(lena, 'save', tmp('book-1.wav'), '-f'); run(lena, 'remix', '2', 'save', tmp('book-2.wav'), '-f')
  let book = run(join(dir, 'book-*.wav'), 'check', 'acx')
  t.is(book.status, 1)
  t.ok(book.stdout.includes('mixed mono and stereo') && /2 of 2 files failed/.test(book.stdout), book.stdout)
  let unknown = run(lena, 'check', 'youtube')
  t.is(unknown.status, 1)
  t.ok(unknown.stderr.includes("unknown spec 'youtube'"), unknown.stderr)
  // a book through a chain, every chapter checked after it
  let fixed = run(join(dir, 'book-*.wav'), 'remix', '1', 'normalize', 'podcast', 'check', 'podcast')
  t.is(fixed.status, 0, 'the chain passes every chapter')
  t.ok(/all 2 files pass/.test(fixed.stdout), fixed.stdout)
})

// Cut lists (fn/cuts.js): test/cuts.js

// ── Reference mastering ──────────────────────────────────────────────────

// Matchering 2.0 (sergree/matchering, stages.py): mid and side matched separately to the reference's spectra,
// level to the reference, then a limiter. Here: tone per part, the side level to the reference's side-to-mid
// ratio (K-weighted), integrated loudness (BS.1770) to the reference's, true peak ≤ -1 dBTP.
test('master: a reference\'s tone, width and loudness; normalize(ref) takes its loudness', { timeout: 120000 }, async t => {
  seed = 21
  let sr = 44100, n = sr * 8, L = new Float32Array(n), R = new Float32Array(n)
  for (let i = 0; i < n; i++) { let w = (rnd() * 2 - 1) * 0.05, v = (rnd() * 2 - 1) * 0.01; L[i] = w + v; R[i] = w - v }
  let src = audio.from([L, R], { sampleRate: sr }).lowpass(3000)
  // the reference: the same material, twice as wide in its side, brighter, 10 dB louder
  let RL = new Float32Array(n), RR = new Float32Array(n)
  for (let i = 0; i < n; i++) { let m = (L[i] + R[i]) / 2, s = (L[i] - R[i]); RL[i] = m + s; RR[i] = m - s }
  let ref = audio.from([RL, RR], { sampleRate: sr }).highshelf(5000, 4).gain(10)
  let tilt = async a => 20 * Math.log10(await a.clone().bandpass(8000, 4).stat('rms') / await a.clone().bandpass(500, 4).stat('rms'))
  let width = async a => { let [l, r] = await a.read(), m = 0, s = 0; for (let i = 0; i < l.length; i++) { m += (l[i] + r[i]) ** 2; s += (l[i] - r[i]) ** 2 } return 10 * Math.log10(s / m) }
  let out = src.clone().master(ref), [want, got] = [await ref.stat('loudness'), await out.stat('loudness')]
  t.almost(got, want, 0.05, `loudness ${got.toFixed(2)} ≈ reference ${want.toFixed(2)} LUFS`)
  t.ok(await out.stat('truepeak') <= -1 + 0.02, 'true peak ≤ -1 dBTP')
  let [tr, to, ts] = [await tilt(ref), await tilt(out), await tilt(src)]
  t.almost(to, tr, 1.5, `8 kHz/500 Hz ${to.toFixed(1)} ≈ reference ${tr.toFixed(1)} dB (source ${ts.toFixed(1)})`)
  let [wr, wo, ws] = [await width(ref), await width(out), await width(src)]
  t.almost(wo, wr, 0.5, `side/mid ${wo.toFixed(1)} ≈ reference ${wr.toFixed(1)} dB (source ${ws.toFixed(1)})`)
  t.almost(await src.clone().normalize(ref).stat('loudness'), want, 0.01, 'normalize(ref): an edited reference renders for its loudness')
  let mono = src.clone().match(ref)
  t.almost(await width(mono), ws, 0.1, 'match without midside keeps the width')
  let monoRef = audio.from([(await ref.read())[0]], { sampleRate: sr }), m = src.clone().match(monoRef, { midside: true }).remix(1)
  t.almost(await tilt(m), await tilt(monoRef), 1.5, 'a mono reference is all mid: the mid still matches it')
})

test('cli: master REF with a check', { timeout: 60000 }, async t => {
  let { spawnSync } = await import('child_process')
  let cli = fileURLToPath(new URL('../bin/cli.js', import.meta.url))
  await (await audio(lena)).gain(-9).save(tmp('quiet.wav'))
  let r = spawnSync(process.execPath, [cli, tmp('quiet.wav'), 'master', lena, 'stat', 'loudness', '--json'], { encoding: 'utf8' })
  t.almost(JSON.parse(r.stdout).loudness, await (await audio(lena)).stat('loudness'), 0.05, 'lena at -9 dB mastered back to lena\'s loudness')
})

// ── Room tone ────────────────────────────────────────────────────────────

// ACX rejects "digital silence instead of room tone" (ACX rejection emails; help.acx.com room tone 1–5 s at each end).
test('roomtone: digital silence becomes the room, at its level, without clicks; pad + roomtone makes ACX head and tail', { timeout: 60000 }, async t => {
  seed = 31
  let sr = 44100, n = sr * 6, x = noise(n, -65)
  for (let i = sr; i < 5 * sr; i++) x[i] += 0.2 * Math.sin(2 * Math.PI * 220 * i / sr) * ((i / sr) % 1 < 0.6 ? 1 : 0)  // words, 0.4 s pauses
  // an editor cut two pauses to digital silence
  x.fill(0, Math.round(1.65 * sr), Math.round(1.95 * sr)); x.fill(0, Math.round(3.65 * sr), Math.round(3.95 * sr))
  let a = audio.from([x], { sampleRate: sr }), y = (await a.clone().roomtone().read())[0]
  let rms = (s, e) => { let q = 0; for (let i = Math.round(s * sr); i < Math.round(e * sr); i++) q += y[i] * y[i]; return 10 * Math.log10(q / Math.round((e - s) * sr)) }
  t.almost(rms(1.7, 1.9), -65, 2, `filled pause at the room's level: ${rms(1.7, 1.9).toFixed(1)} dB`)
  t.almost(rms(3.7, 3.9), -65, 2, 'the second one too')
  let zeros = 0, run = 0
  for (let v of y) { if (Math.abs(v) < 2 ** -15) { if (++run === 441) zeros++ } else run = 0 }
  t.is(zeros, 0, 'no digital silence left')
  let jump = 0
  for (let s of [1.65, 1.95, 3.65, 3.95]) { let i = Math.round(s * sr); jump = Math.max(jump, Math.abs(y[i] - y[i - 1])) }
  t.ok(jump < 0.005, `edges meet the recording: largest step ${jump.toExponential(1)}`)
  t.is([...y.subarray(0, sr)], [...x.subarray(0, sr)], 'what was not silent is untouched')
  t.is([...(await a.clone().roomtone().read())[0]], [...y], 'the same input fills the same way')
  let book = await a.clone().trim().pad(1.5, 2).roomtone().check('acx'), rule = name => book.rules.find(r => r.name === name)
  t.almost(rule('Room tone, start').value, 1.5, 0.05, 'head 1.5 s of room tone')
  t.almost(rule('Room tone, end').value, 2, 0.05, 'tail 2 s of room tone')
  t.ok(!rule('Noise floor').note, 'no dead silence')
  let loud = audio.from([Float32Array.from({ length: sr }, (_, i) => 0.3 * Math.sin(i / 7))], { sampleRate: sr })
  t.is([...(await loud.clone().roomtone().read())[0]], [...(await loud.read())[0]], 'no silence: unchanged')
  // every pause gated to zero: no room anywhere, the quietest left the words' own fading syllables (4 a second); those
  // never hold still, so the gaps stay as they are (they once filled with shuffled syllables, 30 dB over the room)
  let gated = Float32Array.from({ length: 4 * sr }, (_, i) => (i / sr) % 1 < 0.6 ? 0.3 * Math.sin(Math.PI * 4 * i / sr) ** 2 * Math.sin(2 * Math.PI * 180 * i / sr) : 0)
  t.is([...(await audio.from([gated], { sampleRate: sr }).roomtone().read())[0]], [...gated], 'no room to take: unchanged')
  // shorter than a stretch that could hold still, a gap in it: nothing to take the room from; nothing at all: nothing
  let blip = Float32Array.from({ length: Math.round(0.05 * sr) }, (_, i) => i > 800 && i < 1600 ? 0 : 1e-3 * Math.sin(i))
  t.is([...(await audio.from([blip], { sampleRate: sr }).roomtone().read())[0]], [...blip], '50 ms: unchanged')
  t.is((await audio.from([new Float32Array(0)], { sampleRate: sr }).roomtone().read())[0].length, 0, 'empty')
})

// ── Edges: the smallest inputs, silence, sub-ranges, stereo ──

test('noisefloor: under 0.4 s is the whole signal; silence is -∞; a range is its own slice', async t => {
  seed = 41
  let sr = 44100, short = noise(Math.round(0.3 * sr), -40), rms = x => 10 * Math.log10(x.reduce((s, v) => s + v * v, 0) / x.length)
  t.almost(await audio.from([short], { sampleRate: sr }).stat('noisefloor'), rms(short), 1e-6, '0.3 s: one window, all of it')
  t.is(await audio.from([new Float32Array(sr)], { sampleRate: sr }).stat('noisefloor'), -Infinity, 'digital silence')
  let x = noise(sr * 4, -30)
  x.set(noise(sr, -70), sr * 2)  // a quiet second in the middle
  let a = audio.from([x], { sampleRate: sr })
  t.almost(await a.stat('noisefloor', { at: 0, duration: 2 }), acxFloor([x.subarray(0, 2 * sr)], sr), 1e-6, 'range before the quiet part')
  t.almost(await a.stat('noisefloor'), acxFloor([x], sr), 1e-6, 'whole: finds the quiet second')
})

test('check: silence fails what it must and doesn\'t throw; roomtone leaves silence alone and fills stereo', async t => {
  let sr = 44100, silent = audio.from([new Float32Array(2 * sr)], { sampleRate: sr }), r = await silent.check('acx')
  let rule = name => r.rules.find(x => x.name === name)
  t.is([rule('RMS').value, rule('RMS').pass], [-Infinity, false], 'RMS -∞ fails')
  t.ok(/dead silence/.test(rule('Noise floor').note), 'dead silence noted')
  t.is(rule('Room tone, start').value, 2, 'no sound: all of it is head')
  t.is((await silent.check('podcast')).pass, false, 'silence fails Apple')
  t.is([...(await silent.clone().roomtone().read())[0]], [...new Float32Array(2 * sr)], 'nothing to take the room from: unchanged')
  seed = 42
  let L = noise(3 * sr, -60), R = noise(3 * sr, -66)
  L.fill(0, sr, 2 * sr); R.fill(0, sr, 2 * sr)
  let [l, rr] = await audio.from([L, R], { sampleRate: sr }).roomtone().read()
  let db = (x, s, e) => 10 * Math.log10(x.subarray(s, e).reduce((a, v) => a + v * v, 0) / (e - s))
  t.almost(db(l, sr + 441, 2 * sr - 441), -60, 2, 'left filled at its room')
  t.almost(db(rr, sr + 441, 2 * sr - 441), -66, 2, 'right at its own, the stereo image kept')
})


// ── Format detection ─────────────────────────────────────────────────────

// Ogg names its codec after the first page header, at byte 28 (RFC 7845 §5.1 OpusHead; Ogg FLAC mapping 1.0): a
// 12-byte sniff sent every Opus file opened by path, Blob or stream to the Vorbis decoder. The sniff reads 64 bytes,
// or all there is: a WAV under 64 bytes still detects at the end of its input, and tiny chunks accumulate.
test('detect: Opus by path, Blob and stream; a WAV under 64 bytes; 1-byte chunks', { timeout: 60000 }, async t => {
  let opusPath = fileURLToPath(new URL('../node_modules/audio-lena/lena.opus', import.meta.url)), bytes = readFileSync(opusPath)
  let byPath = await audio(opusPath)
  t.is([byPath.sampleRate, Math.round(byPath.duration)], [48000, 12], 'Opus by path')
  let chunks = async function* (b, n) { for (let o = 0; o < b.length; o += n) yield b.subarray(o, o + n) }
  t.is((await audio(chunks(bytes, 5))).length, byPath.length, 'Opus as a stream of 5-byte chunks')
  t.is((await audio(new Blob([bytes]))).length, byPath.length, 'Opus as a Blob')
  let tiny = await audio.from([Float32Array.of(0.5, -0.5, 0.25, -0.25)], { sampleRate: 8000 }).encode('wav', { bitDepth: 16 })
  let { writeFileSync } = await import('fs')
  t.ok(tiny.length < 64, `a ${tiny.length}-byte WAV`)
  writeFileSync(tmp('tiny.wav'), tiny)
  t.is([...(await (await audio(tmp('tiny.wav'))).read())[0]].map(v => +v.toFixed(3)), [0.5, -0.5, 0.25, -0.25], 'by path')
  t.is((await audio(chunks(tiny, 1))).length, 4, 'as a stream of 1-byte chunks')
})
