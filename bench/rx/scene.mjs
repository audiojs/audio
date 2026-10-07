// A soundtrack's dialogue, music and effects (the cocktail fork problem): our scene op, @audio/neural-separate's
// models and a composition of the speech and music models we have, on Divide and Remaster. iZotope RX 12 Scene
// Rebalance is an AAX plugin only (Pro Tools), which Pedalboard cannot host: no RX row; the published results on the
// same test set stand beside ours instead.
//
//   node bench/rx/scene.mjs SPLIT SYSTEM [SYSTEM...]        render and score what is missing, print the tables
//   SHARD=k/N node bench/rx/scene.mjs SPLIT SYSTEM [...]    every N-th clip from the k-th, no tables
//
// SPLIT: `test` (reported), `test30` (every 5th test clip: the slow systems) or `tune` (settings chosen on it).
// SYSTEM: a name of SYSTEMS below, `sep:{json}`
// (@audio/neural-separate's separate() with these options), `op:<stages>` (audio's chain as the editor runs it, a stem
// soloed by muting the others: op:scene()), `composed:{json}` (the dialogue by DeepFilterNet3, the rest split by a
// music model: which of its stems are music, the others and what it leaves are effects), `input` (the mixture).
//
// Data: Divide and Remaster v3, English (Watcharasupat, Wu, Orife, "Remastering Divide and Remaster: A Cinematic Audio
// Source Separation Dataset with Multilingual Support", 2024; CC BY-SA 4.0, built from sources allowing commercial use
// and derivatives: the v3 paper), its test split, 1200 clips of 60 s, mono, 48 kHz, 24-bit FLAC, fetched clip by clip
// from huggingface.co/datasets/kwatcharasupat/dnr-v3-eng (flac/test/<id>/{mixture,speech,music,sfx}.flac) into
// DATA/dnr-v3/test/<id>/: `test` every 8th clip from 000000 (150), `test30` every 40th (30 of them), `tune` every 50th
// from 000004 that is not a test clip (18). DnR v2 (MRX's and BandIt's test set) comes only as an 11-part 116 GB gzip of all its splits; v3 is the set
// its authors moved to, its music without singing (v2's music stems hold vocals: dnr-utils#3).
// Measures, per clip and stem, the stem estimate against the reference stem over the whole clip:
//   SNR     10·log10 of the reference's energy over the error's: Bandit v2's measure on DnR v3 (torchmetrics'
//           signal_noise_ratio, zero_mean false), reported as the median over clips, as its paper reports it
//   SI-SDR  Le Roux et al., ICASSP 2019 (zero-mean, lib.mjs sisdr): MRX's measure on DnR v2, the mean over clips
//   remixes dialogue +6 dB, music −6 dB, effects −6 dB: the SNR of the remix against the true one, x + (g − 1)·s
//   harm    every gain 0 dB, the output against the input (+inf: bit for bit); RTF: the separation's time over the
//           clip's (one render, its model's load included; a 14-core M4 Max shared with other jobs: upper bounds)
// Results: DATA/rx/scene/SPLIT/SYSTEM/<clip>.json.
import { existsSync, readdirSync, readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import audio from '../../audio.js'
import { DATA, OUT, op, sisdr, median, mean, table } from './lib.mjs'
import { remix } from './separate.mjs'

const ROOT = path.join(OUT, 'scene'), DNR = path.join(DATA, 'dnr-v3', 'test')
// the stems as the op names them, and as DnR does
const STEMS = ['dialogue', 'music', 'effects'], FILE = { dialogue: 'speech', music: 'music', effects: 'sfx' }
export const REMIXES = { 'dialogue +6': { dialogue: 6 }, 'music −6': { music: -6 }, 'effects −6': { effects: -6 } }

// MRX through neural-separate at its 20 s chunks and over the whole clip (as upstream runs it); TIGER; the op as the
// editor runs it; the composition: DeepFilterNet3's speech, SCNet's stems of what is left
export const SYSTEMS = {
  input: 'input',
  mrx: 'sep:{"model":"mrx"}',
  'mrx-whole': 'sep:{"model":"mrx","chunk":3600}',
  tiger: 'sep:{"model":"tiger"}',
  scene: 'op:scene()',
  // SCNet's tonal stems the music, its drums and what it leaves the effects (none of its stems is effects)
  composed: 'composed:{"model":"scnet","music":["bass","other","vocals"]}',
}

const clips = split => {
  let ids = readdirSync(DNR).filter(d => /^\d{6}$/.test(d)).map(Number).sort((a, b) => a - b)
  return (split === 'test' ? ids.filter(i => i % 8 === 0) : split === 'test30' ? ids.filter(i => i % 40 === 0) : ids.filter(i => i % 50 === 4 && i % 8)).map(i => String(i).padStart(6, '0'))
}
const flac = async (id, f) => { let a = await audio(path.join(DNR, id, f + '.flac')); return { ch: await a.read(), sr: a.sampleRate } }

const snr = (r, e) => { let s = 0, d = 0; for (let i = 0; i < r.length; i++) s += r[i] * r[i], d += (r[i] - e[i]) ** 2; return d ? 10 * Math.log10(s / d) : Infinity }
const time = async f => { let t = performance.now(), y = await f(); return [y, (performance.now() - t) / 1000] }
const mute = s => Object.fromEntries(STEMS.filter(t => t !== s).map(t => [t, -Infinity]))
let separate
// a clip's stems made once, for its every remix
const once = f => { let x0, y; return x => x.ch[0] === x0 ? y : (x0 = x.ch[0], y = f(x)) }

// a system: its stems at once, or a remix by its gains, over ({ ch, sr }) → channels
function system(spec) {
  let [kind, ...rest] = spec.split(':'), arg = rest.join(':')
  if (kind === 'input') return { remix: () => async x => x.ch }
  if (kind === 'sep') {
    let o = JSON.parse(arg)
    let stems = once(async x => {
      separate ??= (await import('@audio/neural-separate')).default
      return (await separate(x.ch, { sampleRate: x.sr, ...o })).stems
    })
    return { stems, remix: g => async x => remix(x.ch, await stems(x), g), harm: async x => x.ch }
  }
  if (kind === 'composed') {
    let o = JSON.parse(arg)
    let stems = once(async x => {
      separate ??= (await import('@audio/neural-separate')).default
      let dialogue = (await op("deepfilter({ limit: 0, music: 'enhance' })")(x)).ch, rest = x.ch.map((c, k) => c.map((v, i) => v - dialogue[k][i]))
      let s = (await separate(rest, { sampleRate: x.sr, model: o.model })).stems, K = rest.length
      // the model's stereo stems back to the clip's channels (mono: their mean)
      let back = st => K === 1 ? [st[0].map((v, i) => (v + st[1][i]) / 2)] : st
      let music = rest.map((_, k) => Float32Array.from(rest[k], (_, i) => o.music.reduce((a, t) => a + back(s[t])[k][i], 0)))
      return { dialogue, music, effects: rest.map((c, k) => c.map((v, i) => v - music[k][i])) }
    })
    return { stems, remix: g => async x => remix(x.ch, await stems(x), g), harm: async x => x.ch }
  }
  if (kind === 'op') {
    // the op's stages with its gains: `scene()` → `scene({ dialogue: 6 })`; a stem soloed by muting the others
    let at = g => async x => (await op(arg.replace(/\(\s*\)$/, `(${JSON.stringify(g).replace(/null/g, '-Infinity')})`))(x)).ch
    return { solo: s => at(mute(s)), remix: g => at(g), harm: at({}) }
  }
  throw new Error(`unknown system ${spec}`)
}

// test30's clips are test clips: their results are the test's
const dirOf = (split, id) => path.join(ROOT, split === 'test30' ? 'test' : split, id.replace(/[^\w.+-]+/g, '_').slice(0, 120))
const revive = (k, v) => v === 'inf' ? Infinity : v === '-inf' ? -Infinity : v
const load = f => existsSync(f) ? JSON.parse(readFileSync(f, 'utf8'), revive) : null
const save = (f, r) => { mkdirSync(path.dirname(f), { recursive: true }); writeFileSync(f + '.part', JSON.stringify(r, (k, v) => v === Infinity ? 'inf' : v === -Infinity ? '-inf' : v)); renameSync(f + '.part', f) }

async function render(split, id, shard) {
  let [k, N] = shard.split('/').map(Number), sys = system(SYSTEMS[id] ?? id), dir = dirOf(split, id)
  // a host-side store for the op's separations (the editor's is the browser's), cleared per clip: its first render
  // is timed with the separation in it
  let store = new Map(); audio.memo = { get: k => store.get(k), set: (k, v) => store.set(k, v) }
  for (let [j, clip] of clips(split).entries()) {
    if (j % N !== k) continue
    let f = path.join(dir, `${clip}.json`), r = load(f) ?? { clip, stems: {}, remix: {} }
    let want = [...(sys.stems || sys.solo ? STEMS.filter(s => !r.stems[s]) : []), ...Object.keys(REMIXES).filter(m => r.remix[m] === undefined), ...(sys.harm && r.harm == null ? ['harm'] : [])]
    if (!want.length) continue
    let x = await flac(clip, 'mixture'), refs = {}
    for (let s of STEMS) refs[s] = (await flac(clip, FILE[s])).ch
    r.dur = x.ch[0].length / x.sr
    store.clear()
    // stems at once (a separation, timed) or each soloed by the op
    let all = sys.stems && want.some(w => STEMS.includes(w)) ? await time(() => sys.stems(x)) : null
    if (all) r.first ??= all[1]
    for (let w of want) {
      let [y, t] = REMIXES[w] ? await time(() => sys.remix(REMIXES[w])(x)) : w === 'harm' ? [await sys.harm(x)] : all ? [all[0][w]] : await time(() => sys.solo(w)(x))
      if (REMIXES[w]) r.remix[w] = snr(remix(x.ch, refs, REMIXES[w])[0], y[0])
      else if (w === 'harm') r.harm = snr(x.ch[0], y[0])
      else r.stems[w] = { snr: snr(refs[w][0], y[0]), sisdr: sisdr(refs[w][0], y[0]) }
      if (t != null) r.first ??= t
      save(f, r)
    }
    process.stderr.write('.')
  }
}

const fmt = (v, d = 2) => v == null || Number.isNaN(v) ? '–' : v === Infinity ? '+inf' : v.toFixed(d)
function report(split, ids) {
  let list = clips(split), R = Object.fromEntries(ids.map(id => [id, list.map(c => load(path.join(dirOf(split, id), `${c}.json`))).filter(Boolean)]))
  let agg = (rs, f, by) => { let v = rs.map(f).filter(v => v != null && !Number.isNaN(v)); return v.length ? by(v) : null }
  let rows = (f, by) => ids.filter(id => R[id].some(r => r.stems?.dialogue)).map(id => {
    let m = STEMS.map(s => agg(R[id], r => r.stems[s]?.[f], by))
    return [id, ...m.map(v => fmt(v)), m.every(v => v != null) ? fmt(mean(m)) : '–', R[id].length]
  })
  console.log(`\n### ${split}: stems, SNR (dB), median over ${list.length} clips\n`)
  console.log(table(['system', ...STEMS, 'mean of 3', 'clips'], rows('snr', median)))
  console.log(`\n### ${split}: stems, SI-SDR (dB), mean over clips\n`)
  console.log(table(['system', ...STEMS, 'mean of 3', 'clips'], rows('sisdr', mean)))
  console.log(`\n### ${split}: remixes, SNR (dB) against the true remix, median over clips; harm; RTF\n`)
  console.log(table(['system', ...Object.keys(REMIXES), 'harm', 'RTF'], ids.map(id => [id,
    ...Object.keys(REMIXES).map(m => fmt(agg(R[id], r => r.remix[m], median))), fmt(agg(R[id], r => r.harm, median)),
    fmt(agg(R[id], r => r.first / r.dur, median))])))
}

let [split, ...ids] = process.argv.slice(2)
if (!process.argv[1] || import.meta.url !== pathToFileURL(path.resolve(process.argv[1])).href) {}
else if (!['test', 'test30', 'tune'].includes(split) || !ids.length) console.log('usage: node bench/rx/scene.mjs test|test30|tune SYSTEM [SYSTEM...]')
else {
  for (let id of ids) await render(split, id, process.env.SHARD ?? '0/1')
  if (!process.env.SHARD) report(split, ids)
}
