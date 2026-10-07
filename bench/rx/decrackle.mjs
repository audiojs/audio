// De-crackle against iZotope RX 12: RX De-crackle beside `audio`'s decrackle(), on crackle added to speech and music
// with the clean take as the truth, and on the clean takes alone (what each does to sound with no crackle).
//
//   node bench/rx/decrackle.mjs [crackle] [clean]     test: these sections (both if none)
//   node bench/rx/decrackle.mjs tune [reverse]         RX's grid on tune
//
// Material: bench/rx/declick.mjs's (VoiceBank+DEMAND, Spoken Wikipedia narrations, "Vibe Ace", Brahms, the trumpet;
// tune: other utterances, narrations and passages, the Nutcracker), mono, music at 44.1 kHz, speech at 48 kHz.
// Crackle, a worn record's surface (as @audio/denoise scripts/decrackle.js; Godsill & Rayner 1998, "Digital Audio
// Restoration" ch. 5: impulses at random times, of random size and shape): impulses at Poisson times, 50, 200 or 1000
// a second; half of them 1–3 samples off, half ticks ringing at 2–8 kHz and decaying in 0.03–0.15 ms; each peaking at
// A/5–A × the clean take's RMS (log-uniform, either sign), A = 0.5 (small), 2 (medium), 8 (loud).
// Measures: SDR to the clean take, 10·log10 Σ clean² / Σ (out − clean)² (dB), the input's and each output's, the mean
// over the class's takes. Do no harm: on the clean takes, the share of samples moved by over one 16-bit step (2⁻¹⁵) and
// the error, dB under the sound.
// RX at its defaults (quality Low, strength 5, amplitude skew 0) and at the setting of the best mean SDR on tune for
// each size, from a grid: quality (Low, Medium, High) × strength (1.5, 3, 5, 7, 9.5), then amplitude skew −5 and 5
// at each size's best of those.
// RX renders kept in ~/.cache/audiojs/data/rx/decrackle/<split>/ (tune: the grid's scores alone, in tune.jsonl).

import { readFileSync, existsSync, appendFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { OUT, op, lcg, mean, table } from './lib.mjs'
import { material, RX, key, kept } from './declick.mjs'

const HOME = path.join(OUT, 'decrackle'), LSB = 2 ** -15
const args = process.argv.slice(2), split = args.includes('tune') ? 'tune' : 'test'
const want = ['crackle', 'clean'].filter(s => args.includes(s)), run = s => !want.length || want.includes(s)
const takes = material(split)

// RX at the best of the grid on tune (`node bench/rx/decrackle.mjs tune`, 2026-10-06), per size
const TUNED = {
  small: { quality: 'Medium', strength: 3, amplitude_skew: 0 },
  medium: { quality: 'High', strength: 9.5, amplitude_skew: 0 },
  loud: { quality: 'Medium', strength: 9.5, amplitude_skew: 5 },
}
const RATES = [50, 200, 1000], SIZES = [['small', 0.5], ['medium', 2], ['loud', 8]]

const rms = x => { let s = 0; for (let v of x) s += v * v; return Math.sqrt(s / x.length) }
function crackle({ x: clean, sr }, rate, A, seed) {
  let r = lcg(seed), x = clean.slice(), g = rms(clean)
  for (let at = 0; ; ) {
    at += Math.max(1, Math.round(-Math.log(r() || 1e-9) / rate * sr))
    if (at > clean.length - 64) break
    let amp = g * A * Math.exp(Math.log(1 / 5) * r()) * (r() < 0.5 ? -1 : 1), h
    if (r() < 0.5) h = Array.from({ length: 1 + Math.floor(r() * 3) }, () => 1 - r() * 0.3)
    else { let f = 2000 + r() * 6000, t = (0.03 + r() * 0.12) * sr / 1000; h = Array.from({ length: Math.ceil(5 * t) }, (_, n) => Math.exp(-n / t) * Math.cos(2 * Math.PI * f * n / sr)) }
    for (let j = 0; j < h.length; j++) x[at + j] += amp * h[j]
  }
  return x
}
const cases = () => takes.flatMap((m, i) => SIZES.flatMap(([size, A]) => RATES.map(rate => ({ m, size, rate, x: crackle(m, rate, A, 31 * rate + 7 * i + A), id: `${m.name}-${size}-${rate}` }))))
const sdr = (c, y) => { let s = 0, e = 0; for (let i = 0; i < c.length; i++) s += c[i] ** 2, e += (y[i] - c[i]) ** 2; return 10 * Math.log10(s / e) }
const OURS = { name: 'ours', render: op('decrackle()') }
const render = (sys, c) => kept(sys, c.x, c.m.sr, path.join(HOME, split), c.id)
const out = s => console.log(s)
const classes = [['speech', c => c.m.speech], ['music', c => !c.m.speech]]

if (split === 'tune') {
  let GRID = ['Low', 'Medium', 'High'].flatMap(quality => [1.5, 3, 5, 7, 9.5].map(strength => ({ quality, strength, amplitude_skew: 0 })))
  let file = path.join(HOME, 'tune.jsonl'), seen = new Map(), cs = cases()
  mkdirSync(HOME, { recursive: true })
  let read = () => { if (existsSync(file)) for (let l of readFileSync(file, 'utf8').split('\n')) if (l) { let r = JSON.parse(l); seen.set(r.sys + '|' + r.id, r.sdr) } }
  let rows = []
  // `reverse`: the grid from its end, beside a run from its start, each reading the other's scores as it goes
  let grid = args.includes('reverse') ? [...GRID].reverse() : [...GRID]
  for (let n = 0; n < grid.length; n++) {
    read()
    let p = grid[n], sys = RX('De-crackle', p), by = {}
    for (let c of cs) {
      let k = sys.name + '|' + c.id
      if (!seen.has(k)) {
        let input = { ch: [c.x], sr: c.m.sr }, y = await sys.render(input).catch(() => sys.render(input))  // a host lost: once more
        seen.set(k, sdr(c.m.x, y.ch[0])), appendFileSync(file, JSON.stringify({ sys: sys.name, id: c.id, sdr: seen.get(k) }) + '\n')
      }
      ;(by[c.size] ??= []).push(seen.get(k))
    }
    rows.push([p, by])
    // the skew, a second stage: −5 and 5 at each size's best of the first
    if (n === GRID.length - 1) for (let [size] of SIZES) {
      let b = rows.reduce((x, y) => mean(y[1][size]) > mean(x[1][size]) ? y : x)[0]
      for (let amplitude_skew of [-5, 5]) if (!grid.some(q => key(q) === key({ ...b, amplitude_skew }))) grid.push({ ...b, amplitude_skew })
    }
  }
  for (let [size] of SIZES) {
    let best = rows.map(([p, by]) => [p, mean(by[size])]).sort((a, b) => b[1] - a[1])
    out(`\n### De-crackle on ${size} crackle, tune: the mean SDR, best first\n\n` + table(['setting', 'SDR, dB'], best.slice(0, 6).map(([p, v]) => [key(p), v.toFixed(1)])))
  }
  process.exit(0)
}

// per size, rows the systems, cells the mean output SDR per class and rate (the input's in the head)
if (run('crackle')) {
  let cs = cases(), systems = [['RX De-crackle, defaults', RX('De-crackle')], ...[...new Set(SIZES.map(([s]) => JSON.stringify(TUNED[s])))].map(p => [`RX De-crackle, ${key(JSON.parse(p))}`, RX('De-crackle', JSON.parse(p))]), ['decrackle()', OURS]]
  let S = {}
  for (let [l, sys] of systems) for (let c of cs) (S[l] ??= new Map()).set(c, sdr(c.m.x, await render(sys, c)))
  for (let [size, A] of SIZES) {
    let cols = classes.flatMap(([cl, f]) => RATES.map(rate => [cl, rate, c => f(c) && c.size === size && c.rate === rate]))
    let head = cols.map(([cl, rate, f]) => `${cl} ${rate}/s (${mean(cs.filter(f).map(c => sdr(c.m.x, c.x))).toFixed(1)})`)
    out(`\n### ${size} crackle (peaks ${A / 5}–${A}× the RMS): SDR out, dB (in)\n\n` + table(['system', ...head],
      systems.map(([l]) => [l, ...cols.map(([, , f]) => mean(cs.filter(f).map(c => S[l].get(c))).toFixed(1))])))
  }
}

// what each does to the clean takes: samples moved by over 2⁻¹⁵, the error under the sound
if (run('clean')) {
  let systems = [['RX De-crackle, defaults', RX('De-crackle')], ...[...new Set(SIZES.map(([s]) => JSON.stringify(TUNED[s])))].map(p => [`RX De-crackle, ${key(JSON.parse(p))}`, RX('De-crackle', JSON.parse(p))]), ['decrackle()', OURS]]
  let rows = []
  for (let [l, sys] of systems) {
    let cells = []
    for (let m of takes) {
      let y = await kept(sys, m.x, m.sr, path.join(HOME, split), `${m.name}-clean`), c = 0, e = 0, s = 0
      for (let i = 0; i < y.length; i++) { let d = y[i] - m.x[i]; if (Math.abs(d) > LSB) c++; e += d * d, s += m.x[i] ** 2 }
      let db = 10 * Math.log10(e / s)
      cells.push(`${(100 * c / y.length).toFixed(c && c < y.length / 1000 ? 3 : 1)}% · ${Number.isFinite(db) ? db.toFixed(0).replace('-', '−') : '−∞'}`)
    }
    rows.push([l, ...cells])
  }
  out(`\n### The clean takes through each: samples moved over 2⁻¹⁵ · error, dB under the sound\n\n` + table(['system', ...takes.map(m => m.name)], rows))
}
