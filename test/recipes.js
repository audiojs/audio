// The editor's voice recipes (playground/recipes.js), run as the editor runs them, `$src` the open sound: each one that names
// a delivery spec passes its check on a narration recorded at home: phrases and pauses, the room 35 dB under the
// voice (nine Spoken Wikipedia narrations: 13 to 59 dB, median 39), the level 20 dB under a podcast's.
import test, { ok } from 'tst'
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

// a recipe is an expression on `$src`, or statements whose last line is what it makes (one that measures first)
const AsyncFunction = (async () => {}).constructor
const run = (code, x) => new AsyncFunction('$src', code.startsWith('$src') ? `return ${code}` : code.replace(/\n([^\n]+)$/, '\nreturn $1'))(audio.from([x.slice()], { sampleRate: 48000 }))
const needs = code => /deepfilter\(/.test(code) ? HAS_DFN : /rnnoise\(/.test(code) ? !!neural : true
const x = narration()

const voice = r => ['Clean up', 'Deliver'].includes(r.group)
for (let r of recipes.filter(r => voice(r) && r.spec))
  (needs(r.code) ? test : test.skip)(`recipes: ${r.name} passes ${r.spec}`, { timeout: 180000 }, async () => {
    let c = await (await run(r.code, x)).check(r.spec)
    ok(c.pass, c.rules.map(q => `${q.name} ${typeof q.value === 'number' ? q.value.toFixed(1) : q.value}${q.pass === false ? ' ✗' : ''}`).join(', '))
  })
