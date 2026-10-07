// De-click family against iZotope RX 12: De-click and Mouth De-click beside `audio`'s declick(), on clicks added to
// speech and music with the clean take as the truth, on the clean takes alone (what each does to sound with no click),
// on real narrations (what each finds there), and declick's ranged mode (each click's surroundings selected).
//
//   node bench/rx/declick.mjs [click] [dropout] [mouth] [clean] [real] [range]     test: these sections (all if none)
//   node bench/rx/declick.mjs tune [tick] [pop] [glitch] [spike] [dropout] [mouth]  RX's grid on tune (all if none)
//
// Its material and RX renders kept by setting are bench/rx/decrackle.mjs's too (`material`, `RX`, `kept`).
//
// Material, mono, music at 44.1 kHz and speech at 48 kHz. test: VoiceBank+DEMAND's clean test utterances (Valentini-
// Botinhao 2017, CC BY 4.0, doi:10.7488/ds/2117; every 103rd of 824, joined, 12 s), two Spoken Wikipedia narrations
// (spoken/, CC BY-SA; 20–30 s), "Vibe Ace" (Kevin MacLeod, CC BY 3.0) 5–15 s, Brahms' Hungarian Dance No. 5 (string
// orchestra) 5–15 s, the solo trumpet 0–5 s (repair/; @audio/denoise scripts/repair.js). tune, the only set any
// setting is chosen on: VoiceBank+DEMAND training utterances (other speakers; every 37th of 504), two other narrations
// (spoken-train/), "Vibe Ace" 35–45 s, Brahms 25–35 s, the Nutcracker 30–40 s. real: four test narrations, 0–30 s.
//
// Clicks, one every 0.25–0.45 s where the clean sound's RMS over ±10 ms is over −60 dB, either sign, each peaking at
// k × that RMS (as @audio/denoise scripts/declick.js):
//   tick     an impulse ringing at 2–8 kHz, decaying in 0.05–0.3 ms (vinyl: a dust particle)       k = 2, 5, 15
//   pop      a damped sine at 300–1500 Hz, decaying in 0.3–1 ms (a scratch)                        k = 2, 5, 15
//   glitch   1–8 samples off (a digital error, a bad splice)                                       k = 2, 5, 15
//   spike    a jump decaying over 1–3 samples, cut off after 4–8 (interference, a digital click)   k = 2, 5, 15
//   mouth    1–3 ms of differenced noise under a Hann window (lips, tongue; on speech alone)       k = 1, 2, 5
//   dropout  0.02–1 ms of the sound gone to zero (a buffer underrun; where the RMS is over −40 dB)
//
// Measures (lib.mjs `gone`, `median`): per click, how much of its error is gone from 1 ms before it to 20 ms after it
// (a repair's own ringing counted, not only the click's span), 10·log10 of the error before over the error after
// (dB); per condition the median over its clicks and the share gone by 10 dB or more. Do no harm: on the clicked
// sound, the error left outside those spans, dB under the sound there ("elsewhere"); on the clean takes, the share of
// samples moved by over one 16-bit step (2⁻¹⁵) and the error, dB under the sound. Real narrations: the places each
// changes (samples moved by over 2⁻¹⁵, joined within 1 ms) a minute, and the share of them the others change too
// (overlapping within 1 ms).
//
// RX at its defaults (De-click: Single-band, sensitivity 3; Mouth De-click: sensitivity 4), and at the setting of the
// best mean of the per-condition medians on tune for each kind, from a grid: De-click algorithm (Single-band, Multi-
// band (random clicks), Multi-band (periodic clicks); Low-latency, a lesser Single-band, was in no kind's best five
// on a first grid) × sensitivity (1.5, 3, 5, 7, 9.5) × click widening (0, 2); Mouth De-click sensitivity (1, 2.5, 4,
// 6, 8, 10), then frequency skew −5 and 5 at the best of those. RX renders are kept in ~/.cache/audiojs/data/rx/declick/<split>/ (tune: the
// grid's scores alone, in tune.jsonl); ours run each time.
// Ranged: ours given each click's surroundings, 3–20 ms either side as one would select it, one range a stage
// (declick({ at, duration }) chained), against RX on the whole file.

import { readFileSync, readdirSync, existsSync, appendFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { DATA, OUT, rx, op, keep, readWav, lcg, gone, median, mean, table } from './lib.mjs'

const HOME = path.join(OUT, 'declick'), LSB = 2 ** -15

// RX at the best of the grid on tune (`node bench/rx/declick.mjs tune`, 2026-10-06), per kind
const TUNED = {
  tick: { algorithm: 'Multi-band (random clicks)', sensitivity: 3, click_widening: 0 },
  pop: { algorithm: 'Multi-band (random clicks)', sensitivity: 7, click_widening: 0 },
  glitch: { algorithm: 'Single-band', sensitivity: 1.5, click_widening: 0 },
  spike: { algorithm: 'Single-band', sensitivity: 1.5, click_widening: 0 },
  dropout: { algorithm: 'Multi-band (random clicks)', sensitivity: 7, click_widening: 0 },
  mouth: { sensitivity: 4, frequency_skew: 5 },
}
const NAME = { tick: 'ticks', pop: 'pops', glitch: 'glitches', spike: 'spikes', dropout: 'dropouts', mouth: 'mouth clicks' }

// ---- material
export const f32 = (file, sr, from, to) => { let b = readFileSync(file); return new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)).slice(from * sr, to * sr) }
const rep = (name, from, to) => () => ({ x: f32(path.join(DATA, 'repair', name + '.f32'), 44100, from, to), sr: 44100 })
export const files = (dir, ext) => readdirSync(path.join(DATA, dir)).filter(f => f.endsWith(ext)).sort().map(f => path.join(DATA, dir, f))
const narr = (dir, i, from = 20, to = 30) => () => ({ x: f32(files(dir, '.f32')[i], 48000, from, to), sr: 48000 })
const vb = (dir, every) => () => {
  let parts = files(dir, '.wav').filter((_, i) => i % every === 0).map(f => readWav(f).ch[0]), x = new Float32Array(parts.reduce((s, p) => s + p.length, 0)), o = 0
  for (let p of parts) x.set(p, o), o += p.length
  return { x: x.slice(0, 12 * 48000), sr: 48000 }
}
const MATERIAL = {
  test: { voicebank: vb('vbdemand/clean_testset_wav', 103), narration1: narr('spoken', 0), narration2: narr('spoken', 5), vibeace: rep('vibeace', 5, 15), brahms: rep('brahms', 5, 15), trumpet: rep('trumpet', 0, 5) },
  tune: { voicebank: vb('vbdemand-train/clean', 37), narration1: narr('spoken-train', 0), narration2: narr('spoken-train', 5), vibeace: rep('vibeace', 35, 45), brahms: rep('brahms', 25, 35), nutcracker: rep('nutcracker', 30, 40) },
}
/** the split's takes: [{ name, x, sr, speech }] */
export const material = split => Object.entries(MATERIAL[split]).map(([name, f]) => ({ name, ...f(), speech: /voicebank|narration/.test(name) }))

// ---- clicks
const KINDS = {
  tick: (r, sr) => { let f = 2000 + r() * 6000, t = (0.05 + r() * 0.25) * sr / 1000; return Array.from({ length: Math.ceil(5 * t) }, (_, n) => Math.exp(-n / t) * Math.cos(2 * Math.PI * f * n / sr)) },
  pop: (r, sr) => { let f = 300 + r() * 1200, t = (0.3 + r() * 0.7) * sr / 1000; return Array.from({ length: Math.ceil(5 * t) }, (_, n) => Math.exp(-n / t) * Math.sin(2 * Math.PI * f * n / sr + 0.3)) },
  glitch: r => { let v = r() * 2 - 1; return Array.from({ length: 1 + Math.floor(r() * 8) }, () => v + (r() - 0.5) * 0.3) },
  spike: r => { let t = 1 + r() * 2; return Array.from({ length: 4 + Math.floor(r() * 5) }, (_, n) => Math.exp(-n / t)) },
  mouth: (r, sr) => { let L = Math.round((1 + r() * 2) * sr / 1000), q = 0; return Array.from({ length: L }, (_, n) => { let w = r() * 2 - 1, y = w - q; q = w; return y * Math.sin(Math.PI * n / L) ** 2 }) },
}
const rms = (x, a, b) => { let s = 0; for (let i = a; i < b; i++) s += x[i] * x[i]; return Math.sqrt(s / (b - a)) }
// the clicked sound and each click's span [a, b)
function clicked({ x: clean, sr }, kind, k, seed) {
  let r = lcg(seed), x = clean.slice(), spans = [], ten = Math.round(sr / 100)
  for (let at = Math.round(0.3 * sr); at < clean.length - 0.3 * sr; at += Math.round(sr * (0.25 + r() * 0.2))) {
    let level = rms(clean, at - ten, at + ten)
    if (kind === 'dropout') {
      let L = Math.max(1, Math.round((0.02 + r() * 0.98) * sr / 1000))
      if (level < 0.01) continue
      x.fill(0, at, at + L), spans.push([at, at + L])
      continue
    }
    let h = KINDS[kind](r, sr), pk = Math.max(...h.map(Math.abs)), sign = r() < 0.5 ? -1 : 1
    if (level < 1e-3) continue
    for (let j = 0; j < h.length; j++) x[at + j] += sign * k * level * h[j] / pk
    spans.push([at, at + h.length])
  }
  return { x, spans }
}
const SEED = { tick: 1, pop: 2, glitch: 3, mouth: 4, dropout: 5, spike: 6 }
const cases = (material, kind, ks, only = () => true) => material.flatMap((m, i) => only(m) ? ks.map(k => ({ m, kind, k, ...clicked(m, kind, k, 1000 * SEED[kind] + 100 * i + k), id: `${m.name}-${kind}-${k}` })) : [])

// ---- systems: ({ ch, sr }) → { ch, sr }; RX's renders kept on disk by the case and the setting
export const key = p => Object.entries(p).map(([k, v]) => `${k.replace(/_/g, '')}=${String(v).replace(/[^\w.-]+/g, '')}`).join(',') || 'default'
export const RX = (plugin, p = {}) => ({ name: `rx-${plugin.replace(/\W/g, '').toLowerCase()}-${key(p)}`, render: rx(plugin, p), kept: true })
/** sys on x (sr): RX's render kept as dir/id/<setting>.wav, ours run */
export async function kept(sys, x, sr, dir, id) {
  let input = { ch: [x], sr }
  if (!sys.kept) return (await sys.render(input)).ch[0]
  return (await keep(path.join(dir, id, sys.name + '.wav'), () => sys.render(input))).ch[0]
}
const OURS = { name: 'ours', render: op('declick()') }

// ---- measures
const dB = v => 10 * Math.log10(v)
function score(c, y) {
  let { m: { x: clean, sr }, x, spans } = c, ms = Math.round(sr / 1000), near = new Uint8Array(x.length)
  let g = spans.map(([a, b]) => gone(clean, x, y, Math.max(0, a - ms), Math.min(x.length, b + 20 * ms)))
  for (let [a, b] of spans) near.fill(1, Math.max(0, a - ms), b + 20 * ms)
  let e = 0, s = 0
  for (let i = 0; i < x.length; i++) if (!near[i]) e += (y[i] - x[i]) ** 2, s += x[i] ** 2
  return { g, e, s }
}
const cell = ss => { let g = ss.flatMap(s => s.g); return `${median(g).toFixed(1)} · ${Math.round(100 * g.filter(v => v >= 10).length / g.length)}%` }
const elsewhere = ss => { let e = ss.reduce((t, s) => t + s.e, 0), s = ss.reduce((t, s) => t + s.s, 0); return e ? dB(e / s).toFixed(0) : '−∞' }
const fmt = (v, d = 1) => Number.isFinite(v) ? (v < 0 ? '−' : '') + Math.abs(v).toFixed(d) : v < 0 ? '−∞' : '∞'

if (import.meta.main) {
const args = process.argv.slice(2), split = args.includes('tune') ? 'tune' : 'test'
const SECTIONS = ['click', 'dropout', 'mouth', 'clean', 'real', 'range'], want = SECTIONS.filter(s => args.includes(s))
const run = s => !want.length || want.includes(s)
const takes = material(split)

// ---- tune: the grid's scores, one line a render, in tune.jsonl
const GRID = {
  'De-click': ['Single-band', 'Multi-band (random clicks)', 'Multi-band (periodic clicks)'].flatMap(algorithm =>
    [1.5, 3, 5, 7, 9.5].flatMap(sensitivity => [0, 2].map(click_widening => ({ algorithm, sensitivity, click_widening })))),
  'Mouth De-click': [1, 2.5, 4, 6, 8, 10].map(sensitivity => ({ sensitivity, frequency_skew: 0 })),
}
// the skew, a second stage: −5 and 5 at the best of the first
const SKEW = { 'Mouth De-click': 'frequency_skew' }
async function tune(plugin, cs) {
  let file = path.join(HOME, 'tune.jsonl'), seen = new Map()
  mkdirSync(HOME, { recursive: true })
  if (existsSync(file)) for (let l of readFileSync(file, 'utf8').split('\n')) if (l) { let r = JSON.parse(l); seen.set(r.sys + '|' + r.id, r.med) }
  let rows = [], grid = [...GRID[plugin]]
  for (let n = 0; n < grid.length; n++) {
    let p = grid[n], sys = RX(plugin, p), meds = []
    for (let c of cs) {
      let k = sys.name + '|' + c.id
      if (!seen.has(k)) {
        let input = { ch: [c.x], sr: c.m.sr }, y = await sys.render(input).catch(() => sys.render(input))  // a host lost: once more
        let med = median(score(c, y.ch[0]).g)
        seen.set(k, med), appendFileSync(file, JSON.stringify({ sys: sys.name, id: c.id, med }) + '\n')
      }
      meds.push(seen.get(k))
    }
    rows.push([p, mean(meds)])
    if (n === GRID[plugin].length - 1 && SKEW[plugin]) { let b = rows.reduce((x, y) => y[1] > x[1] ? y : x)[0]; grid.push({ ...b, [SKEW[plugin]]: -5 }, { ...b, [SKEW[plugin]]: 5 }) }
  }
  rows.sort((a, b) => b[1] - a[1])
  return rows
}

// ---- sections
const out = s => console.log(s)
const render = (sys, c) => kept(sys, c.x, c.m.sr, path.join(HOME, split), c.id)
const classes = [['speech', c => c.m.speech], ['music', c => !c.m.speech]]

if (split === 'tune') {
  let kinds = ['tick', 'pop', 'glitch', 'spike', 'dropout', 'mouth'], some = kinds.filter(k => args.includes(k))
  for (let kind of some.length ? some : kinds) {
    let rows = kind === 'mouth' ? await tune('Mouth De-click', cases(takes, 'mouth', [1, 2, 5], m => m.speech))
      : await tune('De-click', kind === 'dropout' ? cases(takes, kind, [1]) : cases(takes, kind, [2, 5, 15]))
    out(`\n### ${kind === 'mouth' ? 'Mouth De-click' : 'De-click'} on ${NAME[kind]}, tune: the mean of the medians, best first\n\n` + table(['setting', 'gone, dB'], rows.slice(0, 6).map(([p, v]) => [key(p), v.toFixed(1)])))
  }
  process.exit(0)
}

// conditions × systems: rows the systems, cells "median dB · share ≥ 10 dB" per class and size
async function compare(title, kind, ks, systems, only) {
  let cs = cases(takes, kind, ks, only), S = {}
  for (let sys of systems) for (let c of cs) (S[sys.name] ??= []).push([c, score(c, await render(sys, c))])
  let cols = classes.filter(([, f]) => cs.some(f)).flatMap(([cl, f]) => ks.map(k => [ks.length > 1 ? `${cl} ${k}×` : cl, c => f(c) && c.k === k]))
  out(`\n### ${title}\n\n` + table(['system', ...cols.map(c => c[0]), 'elsewhere, dB'], systems.map(sys =>
    [sys.label ?? sys.name, ...cols.map(([, f]) => cell(S[sys.name].filter(([c]) => f(c)).map(r => r[1]))), elsewhere(S[sys.name].map(r => r[1]))])))
  return S
}

if (run('click')) for (let kind of ['tick', 'pop', 'glitch', 'spike'])
  await compare(`${NAME[kind]}: gone, median dB · share ≥ 10 dB`, kind, [2, 5, 15],
    [{ ...RX('De-click'), label: 'RX De-click, defaults' }, { ...RX('De-click', TUNED[kind]), label: `RX De-click, ${key(TUNED[kind])}` }, { ...OURS, label: 'declick()' }])

if (run('dropout'))
  await compare('dropouts (0.02–1 ms of zeros): gone, median dB · share ≥ 10 dB', 'dropout', [1],
    [{ ...RX('De-click'), label: 'RX De-click, defaults' }, { ...RX('De-click', TUNED.dropout), label: `RX De-click, ${key(TUNED.dropout)}` }, { ...OURS, label: 'declick()' }])

if (run('mouth'))
  await compare('mouth clicks on speech: gone, median dB · share ≥ 10 dB', 'mouth', [1, 2, 5],
    [{ ...RX('Mouth De-click'), label: 'RX Mouth De-click, defaults' }, { ...RX('Mouth De-click', TUNED.mouth), label: `RX Mouth De-click, ${key(TUNED.mouth)}` },
      { ...RX('De-click'), label: 'RX De-click, defaults' }, { ...OURS, label: 'declick()' }], m => m.speech)

// what each does to the clean takes: samples moved by over 2⁻¹⁵, the error under the sound
if (run('clean')) {
  let systems = [['RX De-click, defaults', RX('De-click')], ...[...new Set(['tick', 'pop', 'glitch', 'spike', 'dropout'].map(k => JSON.stringify(TUNED[k])))].map(p => [`RX De-click, ${key(JSON.parse(p))}`, RX('De-click', JSON.parse(p))]),
    ['RX Mouth De-click, defaults', RX('Mouth De-click')], ['RX Mouth De-click, ' + key(TUNED.mouth), RX('Mouth De-click', TUNED.mouth)], ['declick()', OURS]]
  let rows = []
  for (let [label, sys] of systems) {
    let cells = []
    for (let m of takes) {
      let y = await render(sys, { m, x: m.x, id: `${m.name}-clean` }), c = 0, e = 0, s = 0
      for (let i = 0; i < y.length; i++) { let d = y[i] - m.x[i]; if (Math.abs(d) > LSB) c++; e += d * d, s += m.x[i] ** 2 }
      cells.push(`${(100 * c / y.length).toFixed(c && c < y.length / 1000 ? 3 : 1)}% · ${fmt(dB(e / s), 0)}`)
    }
    rows.push([label, ...cells])
  }
  out(`\n### The clean takes through each: samples moved over 2⁻¹⁵ · error, dB under the sound\n\n` + table(['system', ...takes.map(m => m.name)], rows))
}

// real narrations: the places each changes, a minute, and how many of them the other changes too
if (run('real')) {
  let real = files('spoken', '.f32').slice(0, 4).map((f, i) => ({ name: `narration${i}`, x: f32(f, 48000, 0, 30), sr: 48000 }))
  let systems = [['RX Mouth De-click, defaults', RX('Mouth De-click')], ['RX De-click, defaults', RX('De-click')], ['declick()', OURS]]
  let places = (x, y, sr) => {
    let p = [], gap = Math.round(sr / 1000)
    for (let i = 0; i < x.length; i++) if (Math.abs(y[i] - x[i]) > LSB) { let l = p.at(-1); l && i - l[1] <= gap ? l[1] = i + 1 : p.push([i, i + 1]) }
    return p
  }
  let P = {}, minutes = real.reduce((s, t) => s + t.x.length / t.sr / 60, 0)
  for (let [label, sys] of systems) { P[label] = []; for (let t of real) P[label].push(places(t.x, await render(sys, { m: t, x: t.x, id: `real-${t.name}` }), t.sr)) }
  let hit = (a, b, sr) => a.filter(([s, e]) => b.some(([u, v]) => u < e + sr / 1000 && v > s - sr / 1000)).length
  let rows = systems.map(([label]) => [label, (P[label].reduce((s, p) => s + p.length, 0) / minutes).toFixed(1),
    ...systems.filter(([o]) => o !== label).map(([o]) => { let n = P[label].reduce((s, p) => s + p.length, 0); return n ? `${Math.round(100 * real.reduce((s, t, i) => s + hit(P[label][i], P[o][i], t.sr), 0) / n)}% (${o})` : 'none' })])
  out(`\n### Four real narrations, 30 s each: places changed a minute, and the share of them the others change too\n\n` + table(['system', 'a minute', 'also by', 'also by'], rows))
}

// ranged: each click's surroundings selected, one range a stage, against RX and ours on the whole file
if (run('range')) for (let kind of ['tick', 'pop', 'glitch', 'spike', 'mouth']) {
  let ks = kind === 'mouth' ? [1, 2, 5] : [2, 5, 15], cs = cases(takes, kind, ks, kind === 'mouth' ? m => m.speech : undefined)
  let whole = kind === 'mouth' ? [['RX Mouth De-click, defaults', RX('Mouth De-click')], [`RX Mouth De-click, ${key(TUNED.mouth)}`, RX('Mouth De-click', TUNED.mouth)]]
    : [['RX De-click, defaults', RX('De-click')], [`RX De-click, ${key(TUNED[kind])}`, RX('De-click', TUNED[kind])]]
  whole.push(['declick()', OURS])
  let S = Object.fromEntries([...whole.map(([l]) => l), 'ranged'].map(l => [l, []]))
  for (let c of cs) {
    let r = lcg(c.k + 7), sr = c.m.sr, stages = c.spans.map(([a, b]) => {
      let l = Math.round((3 + r() * 17) * sr / 1000), h = Math.round((3 + r() * 17) * sr / 1000)
      return `declick({ at: ${(a - l) / sr}, duration: ${(b - a + l + h) / sr} })`
    }).join('.')
    S.ranged.push([c, score(c, (await op(stages)({ ch: [c.x], sr })).ch[0])])
    for (let [l, sys] of whole) S[l].push([c, score(c, await render(sys, c))])
  }
  let cols = classes.filter(([, f]) => cs.some(f)).flatMap(([cl, f]) => ks.map(k => [`${cl} ${k}×`, c => f(c) && c.k === k]))
  out(`\n### ${NAME[kind]}, each selected: gone, median dB · share ≥ 10 dB\n\n` + table(['system', ...cols.map(c => c[0])],
    [...whole.map(([l]) => [`${l}, the whole take`, ...cols.map(([, f]) => cell(S[l].filter(([c]) => f(c)).map(r => r[1])))]),
      ['declick({ at, duration }), a range a click', ...cols.map(([, f]) => cell(S.ranged.filter(([c]) => f(c)).map(r => r[1])))]]))
}
}
