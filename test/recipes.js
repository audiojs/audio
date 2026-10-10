// The editor's voice recipes (playground/recipes.js), run as the editor runs them, `$src` the open sound: each one that names
// a delivery spec passes its check on a narration recorded at home: phrases and pauses, the room 35 dB under the
// voice (nine Spoken Wikipedia narrations: 13 to 59 dB, median 39), the level 20 dB under a podcast's. A technique does
// what its source says it does, measured (sources and numbers: .work/recipes.md §3, §4).
import test, { ok, is, almost } from 'tst'
import audio from '../audio.js'
import recipes from '../playground/recipes.js'
import { existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import os from 'node:os'
import path from 'node:path'

const neural = await import('@audio/neural-denoise').catch(() => null)
const HAS_DFN = !!neural && existsSync(path.join(process.env.AUDIO_NEURAL_CACHE || path.join(os.homedir(), '.cache', 'audiojs', 'neural'), createHash('sha256').update(neural.MODEL).digest('hex')))

// a voice: glottal pulses at 110-140 Hz, tilted −6 dB/octave as a glottal source radiates, through three formants;
// four syllables a second, an 's' (noise around 6.5 kHz) closing each phrase; 2 s phrases, 1 s pauses, white room
// noise; seeded
function narration(sr = 48000, dur = 6) {
  let s = 5
  const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647
  const res = (f, bw) => { let r = Math.exp(-Math.PI * bw / sr), c = 2 * r * Math.cos(2 * Math.PI * f / sr); return { a1: c, a2: -r * r, y1: 0, y2: 0 } }
  let n = dur * sr, x = new Float32Array(n), phase = 0, F = [res(700, 90), res(1200, 110), res(2600, 160)], S = res(6500, 3000), g = 0
  for (let i = 0; i < n; i++) {
    let t = i / sr, p = t % 3, speaking = t > 0.5 && p < 2
    let env = speaking ? Math.sin(Math.PI * ((p * 4) % 1)) ** 2 : 0, v = 0
    phase += (110 + 30 * Math.sin(2 * Math.PI * 0.7 * t)) / sr
    g = 0.97 * g + (phase >= 1 ? (phase -= 1, 1) : 0)
    for (let r of F) { let y = g + r.a1 * r.y1 + r.a2 * r.y2; r.y2 = r.y1; r.y1 = y; v += y }
    let sib = speaking && p > 1.85 ? (rnd() - 0.5) * Math.sin(Math.PI * (p - 1.85) / 0.15) : 0
    let h = sib + S.a1 * S.y1 + S.a2 * S.y2; S.y2 = S.y1; S.y1 = h
    x[i] = 0.0006 * v * env + 0.01 * h + 10 ** (-71 / 20) * Math.sqrt(12) * (rnd() - 0.5)
  }
  return x
}

// an interview on two mics, one per channel: A speaks the first 6 s, B the next 6 s 6 dB quieter; each mic hears the
// other 14 dB down, 1.5 ms late
function interview(sr = 48000) {
  let v = narration(sr), n = v.length, A = new Float32Array(2 * n), B = new Float32Array(2 * n), d = Math.round(0.0015 * sr)
  for (let i = 0; i < n; i++) {
    A[i] += v[i]; B[i + d] += v[i] * 10 ** (-14 / 20)
    B[n + i] += v[i] * 10 ** (-6 / 20); if (n + i + d < 2 * n) A[n + i + d] += v[i] * 10 ** (-20 / 20)
  }
  return [A, B]
}

// a recipe is an expression on `$src`, or statements whose last (an unindented line and the lines indented under it) is
// what it makes; a file it opens by name (music.wav) is one of `files`
const AsyncFunction = (async () => {}).constructor
const src = x => audio.from((Array.isArray(x) ? x : [x]).map(c => c.slice()), { sampleRate: 48000 })
const run = (code, x, files = {}) => new AsyncFunction('$src', 'audio', code.startsWith('$src') ? `return ${code}` : code.replace(/\n(?=\S[^\n]*(?:\n\s[^\n]*)*$)/, '\nreturn '))(src(x), Object.assign(name => files[name] ? src(files[name]) : audio(name), audio))
const needs = code => /deepfilter\(/.test(code) ? HAS_DFN : /rnnoise\(/.test(code) ? !!neural : true
const x = narration()
const recipe = name => recipes.find(r => r.name === name).code
const inputs = { 'Interview, two mics': interview() }

const voice = r => ['Clean up', 'Deliver'].includes(r.group)
for (let r of recipes.filter(r => voice(r) && r.spec))
  (needs(r.code) ? test : test.skip)(`recipes: ${r.name} passes ${r.spec}`, { timeout: 180000 }, async () => {
    let c = await (await run(r.code, inputs[r.name] ?? x)).check(r.spec)
    ok(c.pass, c.rules.map(q => `${q.name} ${typeof q.value === 'number' ? q.value.toFixed(1) : q.value}${q.pass === false ? ' ✗' : ''}`).join(', '))
  })

// level in dB, of a band (8th-order edges) and a span when given
const level = async (a, lo, hi, at, duration) => {
  let b = a.clone()
  if (lo) b.highpass(lo, 8)
  if (hi) b.lowpass(hi, 8)
  return 20 * Math.log10(await b.stat('rms', { at, duration }))
}
// a band's change from input to output, against 800 to 1250 Hz's: what the tone did, the level aside
const tilt = async (a, b, lo, hi) => (await level(b, lo, hi) - await level(a, lo, hi)) - (await level(b, 800, 1250) - await level(a, 800, 1250))

test('recipes: Warm a vocal lifts 50 to 150 Hz, rolls the top off, ends at -18 LUFS under -1 dBTP', { timeout: 60000 }, async () => {
  let a = src(x), b = await run(recipe('Warm a vocal'), x)
  ok(await tilt(a, b, 50, 150) > 1, 'lows up')
  ok(await tilt(a, b, 2000, 5000) < 0, 'presence down')
  ok(await tilt(a, b, 8000) < -1.5, 'top rolled off')
  let [L, tp] = await b.stat(['loudness', 'truepeak'])
  almost(L, -18, 0.1, 'loudness'); ok(tp <= -0.95, `true peak ${tp.toFixed(2)}`)
})

// Robjohns: "leaves the loud bits unaffected and raises the quiet bits by 6dB": a phrase, then one 24 dB quieter
test('recipes: Parallel compression raises a quiet phrase, keeps a loud one', { timeout: 60000 }, async () => {
  let y = x.map((v, i) => i < 2.5 * 48000 ? v : v * 10 ** (-24 / 20)), a = src(y), b = await run(recipe('Parallel compression'), y)
  let up = async (at, d) => await level(b, 0, 0, at, d) - await level(a, 0, 0, at, d)
  let loud = await up(0.5, 1.5), quiet = await up(3, 2)
  ok(quiet - loud > 4, `quiet ${quiet.toFixed(1)}, loud ${loud.toFixed(1)} dB`)
})

// Owsinski: roll off "below 600Hz and above 10kHz" before the reverb: the tail after a phrase has little of the voice's lows
test('recipes: Plate on a send: the tail after a phrase is mids, the lows kept out', { timeout: 60000 }, async () => {
  let a = src(x), b = await run(recipe('Plate on a send'), x)
  let tilt = async (s, at, d) => await level(s, 0, 300, at, d) - await level(s, 600, 10000, at, d)
  let voice = await tilt(a, 0.5, 1.5), tail = await tilt(b, 2.05, 0.5)
  ok(await level(b, 600, 10000, 2.05, 0.5) - await level(a, 600, 10000, 2.05, 0.5) > 10, 'a tail')
  ok(tail < voice - 10, `lows under mids: voice ${voice.toFixed(1)}, tail ${tail.toFixed(1)} dB`)
})

// a click at 0.1 s: what follows it is the effect's echo
const click = () => { let c = new Float32Array(48000); c[4800] = 0.5; return c }
const peak = (y, from, to) => Math.max(...y.subarray(from, to).map(Math.abs))

test('recipes: Slapback repeats once, 135 ms late, 9.5 dB under', { timeout: 60000 }, async () => {
  let [y] = await (await run(recipe('Slapback'), click())).read(), dry = peak(y, 4790, 4810)
  almost(20 * Math.log10(peak(y, 4800 + 6470, 4800 + 6490) / dry), -9.54, 0.5, 'the repeat')
  ok(peak(y, 4800 + 48, 4800 + 6400) < dry * 1e-3 && peak(y, 4800 + 6600, 48000) < dry * 1e-3, 'once')
})

test('recipes: Double a vocal (ADT): a copy 4 to 8 ms late', { timeout: 60000 }, async () => {
  let [y] = await (await run(recipe('Double a vocal (ADT)'), click())).read(), dry = peak(y, 4790, 4810)
  ok(peak(y, 4800 + 192, 4800 + 384) > dry * 0.2, 'the copy'); ok(peak(y, 4800 + 24, 4800 + 144) < dry * 0.05, 'not sooner')
})

// the bed a 15 kHz tone, over the voice's band: what of it is there, in a pause and under a phrase
test('recipes: Music bed under a voice: the bed in the pauses, 15 dB lower under the voice; podcast', { timeout: 60000 }, async () => {
  let tone = Float32Array.from({ length: 8 * 48000 }, (_, i) => 0.3 * Math.sin(2 * Math.PI * 15000 * i / 48000))
  let b = await run(recipe('Music bed under a voice'), x, { 'music.wav': [tone, tone] })
  let pause = await level(b, 14000, 16000, 2.3, 0.6), under = await level(b, 14000, 16000, 3.5, 1)
  ok(pause - under > 10, `ducked ${(pause - under).toFixed(1)} dB`)
  ok((await b.check('podcast')).pass, 'podcast')
})

test('recipes: AM radio: mono, nothing over 4.5 kHz to speak of, -18 LUFS', { timeout: 60000 }, async () => {
  let a = src(x), b = await run(recipe('AM radio'), x)
  ok(await tilt(a, b, 6000) < -20, 'band-limited'); ok(await tilt(a, b, 0, 80) < -6, 'no rumble')
  is(b.channels, 1); almost(await b.stat('loudness'), -18, 0.1)
})

test('recipes: Interview, two mics: the two speakers 6 dB apart come out within 3', { timeout: 60000 }, async () => {
  let b = await run(recipe('Interview, two mics'), interview())
  let [A, B] = [await b.stat('loudness', { at: 0.5, duration: 5 }), await b.stat('loudness', { at: 6.5, duration: 5 })]
  ok(Math.abs(A - B) < 3, `${A.toFixed(1)}, ${B.toFixed(1)} LUFS`)
})
