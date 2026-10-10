// Speech recipes, stage by stage: renders each recipe of playground/recipes.js that processes a voice, and every
// prefix of it, on VoiceBank+DEMAND and on ten Spoken Wikipedia narrations. bench/speech.py scores them.
//
//   node bench/speech.mjs SET SYSTEM[,SYSTEM...] [SHARD/N]
//   node bench/speech.mjs list
//   node bench/speech.mjs dirs SYSTEM[,SYSTEM...]     each system's output directory, for bench/speech.py
//
// SET: `test` (VoiceBank+DEMAND test, 824 utterances), `train` (504 utterances of its 28-speaker training set,
// disjoint from the test speakers and noises: the only set settings are chosen on), `test-clean` and
// `train-clean` (their clean references as input: what a stage does to clean speech), `rooms` (the narrations),
// `rooms-train` (ten other narrations, for choosing settings), `reverb-train` and `reverb-test` (a quarter of those
// clean utterances through MIT IR Survey rooms, Traer & McDermott 2016: even-numbered responses for training, odd
// for testing; the direct sound aligned to the dry take).
// SYSTEM: a recipe's slug (`enhance-speech`), its first k stages (`enhance-speech:3`), all its prefixes
// (`enhance-speech:*`), the recipe without stage k (`enhance-speech-3`), a recipe as it was (`was-enhance-speech`),
// an entry of EXTRA, or `lin:SYSTEM`: the system's tone filters alone (SI-SDR's reference, on a clean set).
//
// Each stage's output is kept, so a prefix renders once for every recipe that shares it, and each system is
// the previous prefix's output through one more stage. Outputs stay whole (read() length, declared tails
// included), so stage by stage equals the chain at once. VoiceBank+DEMAND is scored against its clean
// reference sample by sample, so there the structural stages (trim, pad, shrink, roomtone, resample) are left
// out; the narrations run whole recipes and get the check a recipe names (and ACX's, for its noise floor).
//
// Data. VoiceBank+DEMAND (Valentini-Botinhao 2017, CC BY 4.0, doi:10.7488/ds/2117): clean_testset_wav,
// noisy_testset_wav in ~/.cache/audiojs/data/vbdemand/; training files (clean_trainset_28spk_wav,
// noisy_trainset_28spk_wav, first 18 of each speaker) in vbdemand-train/{clean,noisy}/. Narrations: the first
// 60 s of each, 48 kHz mono float32, in spoken/<name>.f32 (@audio/neural-denoise scripts/accuracy.mjs ROOMS);
// rooms-train, ten more from Wikimedia Commons' Spoken English Wikipedia category (every 223rd title from the
// 131st, the ten above skipped, over 70 s; CC BY-SA), in spoken-train/ with its manifest.json.
// Outputs: ~/.cache/audiojs/data/recipes[-SPEECH_TAG]/SET/<stage>/<stage>/…/<name>.wav (float).

import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import audio from '../audio.js'
import RECIPES from '../playground/recipes.js'
import { roomless } from '../fn/deepfilter.js'
import { readWav, writeWav, rx } from './rx/lib.mjs'

// SPEECH_TAG names a separate output tree: the same stages after their packages change
const DATA = path.join(os.homedir(), '.cache', 'audiojs', 'data'), OUT = path.join(DATA, 'recipes' + (process.env.SPEECH_TAG ? '-' + process.env.SPEECH_TAG : ''))
const VOICE = ['Podcast voice', 'Enhance speech', 'Reduce noise', 'Remove hum', 'Remove room echo', 'Breaths, clicks, pops',
  'Shorten pauses', 'Room tone for silence', 'Audiobook chapter', 'Podcast episode', 'Narration, tightened', 'Vocal chain']
const STRUCTURAL = /^(trim|pad|shrink|roomtone|resample|crop)\(/

// The recipes as they were before this bench (playground/recipes.js, 2026-09-27): `was-<slug>`, prefixes as for recipes
export const WAS = {
  'podcast-voice': ['highpass(80)', 'trim()', 'compressor({ threshold: -24, ratio: 3 })', "normalize('podcast')", 'fade(0.3, 0.5)'],
  'enhance-speech': ['highpass(80)', 'dehum()', 'omlsa()', 'deesser()', 'compressor({ threshold: -24, ratio: 3 })', 'eq(3000, 2, 1)', "normalize('podcast')"],
  'reduce-noise': ['omlsa()'],
  'remove-hum': ['dehum({ freq: 50 })'],
  'remove-room-echo': ['highpass(80)', 'dereverb({ t60: 0.6 })'],
  'breaths-clicks-pops': ['declick()', 'deplosive()', 'debreath({ range: -12 })'],
  'shorten-pauses': ['shrink(0.3)'],
  'room-tone-for-silence': ['roomtone()'],
  'audiobook-chapter': ['highpass(80)', 'omlsa({ gMin: -12 })', 'compressor({ threshold: -24, ratio: 2.5 })', "normalize(-20, 'rms', { ceiling: -3.5 })", 'trim()', 'pad(1.5, 2)', 'roomtone()', 'resample(44100)'],
  'podcast-episode': ['highpass(80)', 'omlsa({ gMin: -12 })', 'deesser()', 'compressor({ threshold: -24, ratio: 2.5 })', "normalize('podcast')"],
  'narration-tightened': ['highpass(80)', 'omlsa({ gMin: -12 })', 'shrink(0.6)', 'leveler({ target: -20 })', "normalize('podcast')"],
  'vocal-chain': ['highpass(90)', 'deesser()', 'compressor({ threshold: -20, ratio: 3 })', 'eq(3000, 2, 1)', 'highshelf(10000, 2)', 'plate({ decay: 0.4, mix: 0.12 })', "normalize('spotify')"],
}

// Candidates the recipes are chosen from (on `train`); same form as a recipe's stages
const AB = d => ['highpass(80)', d, 'compressor({ threshold: -24, ratio: 2.5 })', "normalize(-20, 'rms', { ceiling: -3.5 })", 'trim()', 'pad(1.5, 2)', 'roomtone()', 'resample(44100)']
const PE = d => ['highpass(80)', d, 'deesser()', 'compressor({ threshold: -24, ratio: 2.5 })', "normalize('podcast')"]
export const EXTRA = {
  // neural denoisers at their attenuation limits (deepfilter's default 18)
  'dfn-0': ['deepfilter(0)'], 'dfn-12': ['deepfilter(12)'], 'dfn-18': ['deepfilter()'], 'dfn-24': ['deepfilter(24)'],
  // the residual floor, dB under the voice (neural-denoise 0.5; 0: none, 0.4's fixed limit)
  'dfn-f0': ['deepfilter({ floor: 0 })'], 'dfn-f35': ['deepfilter({ floor: 35 })'], 'dfn-f45': ['deepfilter({ floor: 45 })'],
  'rnn-0': ['rnnoise(0)'], 'rnn-20': ['rnnoise(20)'],
  'ab-dfn12': AB('deepfilter(12)'), 'ab-dfn18': AB('deepfilter()'), 'ab-rnn20': AB('rnnoise(20)'),
  'pe-dfn12': PE('deepfilter(12)'), 'pe-dfn18': PE('deepfilter()'),
}
// the level set before what reads absolute level (de-esser, compressor): podcast loudness, ACX's RMS
const POD = ["normalize(-16, 'lufs', { ceiling: false })"], ACX = ["normalize(-20, 'rms', { ceiling: false })"]
const comp = (t, r) => `compressor({ threshold: ${t}, ratio: ${r} })`
const cand = (id, st) => EXTRA[id] = st
for (let [d, den] of [['dfn12', 'deepfilter(12)'], ['dfn18', 'deepfilter()'], ['dfn24', 'deepfilter(24)'], ['rnn20', 'rnnoise(20)'], ['rnn12', 'rnnoise(12)'], ['rnn15', 'rnnoise(15)']]) {
  cand(`n-${d}`, ['highpass(80)', den])
  cand(`np-${d}`, ['highpass(80)', den, "normalize('podcast')"])
  for (let [t, r] of [[-26, 2], [-20, 2], [-20, 3], [-14, 3]]) cand(`np-${d}-c${-t}r${r}`, ['highpass(80)', den, ...POD, comp(t, r), "normalize('podcast')"])
  for (let [t, r] of [[-26, 2], [-20, 2.5], [-14, 3], [-10, 3]]) cand(`na-${d}-c${-t}r${r}`, ['highpass(80)', den, ...ACX, comp(t, r), "normalize(-20, 'rms', { ceiling: -3.5 })", 'trim()', 'pad(1.5, 2)', 'roomtone()', 'resample(44100)'])
}
// Enhance speech, neural, at a 24 dB limit
cand('esn-24', ['highpass(80)', 'dehum()', 'deepfilter(24)', "normalize(-16, 'lufs', { ceiling: false })", "deesser({ mode: 'band', threshold: -30 })", "normalize('podcast')"])
// Remove room echo: dereverb alone at its late estimate's strengths (1: its default)
for (let s of [0, 0.5, 1, 2]) cand(`echo-s${s * 10}`, [`dereverb({ strength: ${s} })`])
// classical denoisers (the fixed @audio/denoise), alone and in the ACX chain; dehum first: it leaves hum-free input alone
const ACXEND = ["normalize(-20, 'rms', { ceiling: -3.5 })", 'trim()', 'pad(1.5, 2)', 'roomtone()', 'resample(44100)']
for (let [d, den] of [['omlsa', 'omlsa()'], ['omlsa12', 'omlsa({ gMin: -12 })'], ['wiener', 'wiener()'], ['specsub', 'specsub()'], ['dfn24', 'deepfilter(24)'], ['dfn18', 'deepfilter()'], ['rnn20', 'rnnoise(20)']]) {
  cand(`c-${d}`, ['highpass(80)', 'dehum()', den])
  cand(`ca-${d}`, ['highpass(80)', 'dehum()', den, ...ACX, comp(-14, 3), ...ACXEND])
}
// iZotope RX 12 (bench/rx/host.py): Voice De-noise adaptive at its defaults (12 dB), Spectral De-noise adaptive,
// Dialogue Isolate with its noise off and the room kept, De-reverb at its defaults
cand('rx-vdn', ["rx('Voice De-noise')"])
cand('rx-sdn', ["rx('Spectral De-noise', { adaptive_learning: true })"])
// Voice De-noise and Spectral De-noise at their best PESQ on `train` (bench/rx/denoise.mjs: reduction, thresholds, quality)
cand('rx-vdn-tuned', ["rx('Voice De-noise', { reduction: 20, master_threshold: 10 })"])
cand('rx-sdn-tuned', ["rx('Spectral De-noise', { adaptive_learning: true, quality: 'Extreme', linked_reduction_db: 20 })"])
cand('rx-di', ["rx('Dialogue Isolate', { noise_gain_db: -Infinity })"])
// Dialogue Isolate tuned on bench/rx/isolate.mjs's tune split: the reverb off too (sensitivity 0 to 10 tried; 5, its default, best)
cand('rx-di-tuned', ["rx('Dialogue Isolate', { noise_gain_db: -Infinity, reverb_gain_db: -Infinity })"])
cand('rx-drv', ["rx('De-reverb')"])
// De-reverb at the best of bench/rx/dereverb.mjs `tune` on reverb-train
cand('rx-drv-tuned', ["rx('De-reverb', { tail_length: 0.5, band_strength_low: 8, band_strength_low_mid: 4, band_strength_high_mid: 6, band_strength_high: 4 })"])
const slug = s => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
// `$src\n  .a()\n  .b(…)` → ['a()', 'b(…)']
const stages = code => code.replace(/^\$src\s*\./, '').split(/\)\s*\.(?=[a-z])/).map((s, i, all) => (i < all.length - 1 ? s + ')' : s).trim())

export const recipes = Object.fromEntries([
  ...RECIPES.filter(r => r.code.startsWith('$src') && (VOICE.includes(r.name) || /speech|voice|narration|podcast|audiobook|noise/i.test(r.name)))
    .map(r => [slug(r.name), { name: r.name, spec: r.spec, stages: stages(r.code) }]),
  ...Object.entries(WAS).map(([k, st]) => [`was-${k}`, { name: k, spec: { 'podcast-voice': 'podcast', 'enhance-speech': 'podcast', 'audiobook-chapter': 'acx', 'podcast-episode': 'podcast', 'narration-tightened': 'podcast', 'vocal-chain': 'spotify' }[k], stages: st }]),
])

/** System name → { stages, spec } */
// the tone filters: linear and time-invariant, a timbre choice rather than damage. `lin:SYSTEM` is SYSTEM's tone
// filters alone; on the clean set it is the reference its output is scored against (bench/speech.py --lin), so a
// highpass's phase shift (SI-SDR of clean speech through highpass(80): 6.2 dB) and an EQ's boost are not counted
// as degradation; DNSMOS, reference-free, judges them
const LINEAR = /^(highpass|lowpass|eq|highshelf|lowshelf)\(/
export function system(id) {
  if (id.startsWith('lin:')) return { stages: system(id.slice(4)).stages.filter(s => LINEAR.test(s)), spec: null }
  if (EXTRA[id]) return { stages: EXTRA[id], spec: null }
  let m = id.match(/^(.*?)(?::(\d+)|-(\d+))?$/), r = recipes[m[1]] ?? (EXTRA[m[1]] && { stages: EXTRA[m[1]], spec: null })
  if (!r) throw new Error(`unknown system ${id}`)
  if (m[2]) return { stages: r.stages.slice(0, +m[2]), spec: r.spec }
  if (m[3]) return { stages: r.stages.filter((_, i) => i !== +m[3] - 1), spec: r.spec }
  return r
}
export const expand = id => id.startsWith('lin:') ? expand(id.slice(4)).map(k => 'lin:' + k)
  : id.endsWith(':*') ? system(id.slice(0, -2)).stages.map((_, k) => `${id.slice(0, -2)}:${k + 1}`) : [id]

const dir = s => s.replace(/\s+/g, '').replace(/["'\/]/g, '')

export const SETS = {
  test: { dir: 'vbdemand', input: 'noisy_testset_wav' },
  'test-clean': { dir: 'vbdemand', input: 'clean_testset_wav' },
  train: { dir: 'vbdemand-train', input: 'noisy' },
  'train-clean': { dir: 'vbdemand-train', input: 'clean' },
  'reverb-train': { dir: 'vbreverb', input: 'train-reverb' },
  'reverb-train-clean': { dir: 'vbreverb', input: 'train-clean' },
  'reverb-test': { dir: 'vbreverb', input: 'test-reverb' },
  'reverb-test-clean': { dir: 'vbreverb', input: 'test-clean' },
  rooms: { dir: 'spoken', rooms: true },
  'rooms-train': { dir: 'spoken-train', rooms: true },
}

function inputs(set) {
  let s = SETS[set], d = path.join(DATA, s.dir)
  if (!s.rooms) return readdirSync(path.join(d, s.input)).filter(f => f.endsWith('.wav')).sort()
    .map(f => [f.slice(0, -4), () => readWav(path.join(d, s.input, f))])
  return readdirSync(d).filter(f => f.endsWith('.f32')).sort().map(f => [f.slice(0, -4), () => {
    let b = readFileSync(path.join(d, f))
    return { ch: [new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength))], sr: 48000 }
  }])
}

// Neural stages run @audio/neural-denoise with one model handle (one thread) for all files, and deepfilter as audio's
// op does (fn/deepfilter.js): the unlimited output y (the model run again on the take with the room's linear prediction
// off where y still carries a room: roomless()), the input x mixed back by the package's mixback() (`limit` 18 unless
// given, and its `floor`). The op loads the model per edit.
let models = {}, denoise, mixback
async function neural(x, model, o) {
  if (!models[model]) {
    let nd = await import('@audio/neural-denoise')
    denoise = nd.default, mixback = nd.mixback
    models[model] = await nd.load(model === 'deepfilter' ? 'deepfilternet3' : 'rnnoise', { sessionOptions: { intraOpNumThreads: 1, interOpNumThreads: 1 } })
  }
  if (model === 'rnnoise') return { ch: await denoise(x.ch, { sampleRate: x.sr, model: models[model], limit: o.limit ?? 20 }), sr: x.sr }
  let run = ch => denoise(ch, { sampleRate: x.sr, model: models[model], limit: 0 }), y = await run(x.ch), heard = roomless(x.ch, y, x.sr), limit = o.limit ?? 18
  if (heard) y = await run(heard)
  return { ch: limit ? y.map((v, c) => mixback(x.ch[c], v, { limit, floor: o.floor, sampleRate: x.sr })) : y, sr: x.sr }
}

async function stage(x, s) {
  // rx('Voice De-noise', { reduction: 20 }): iZotope RX 12's plugin (bench/rx/host.py)
  if (s.startsWith('rx(')) return rx(...new Function(`return [${s.slice(3, -1)}]`)())(x)
  let m = s.match(/^(deepfilter|rnnoise)\((.*)\)$/)
  if (!m) return { ch: (await new Function('a', `return a.${s}`)(audio.from(x.ch, { sampleRate: x.sr })).read()).map(c => Float32Array.from(c)), sr: 0 }
  // positional limit or one options object, as the ops take them
  let args = new Function(`return [${m[2]}]`)(), o = typeof args[0] === 'object' ? args[0] : { limit: args[0] }
  return neural(x, m[1], o)
}

/** The system's output for one input, rendering (and keeping) whatever prefix is missing. */
async function render(set, list, name, get) {
  let at = path.join(OUT, set), k = 0, x
  let files = list.map((_, i) => path.join(at, ...list.slice(0, i + 1).map(dir), name + '.wav'))
  for (k = list.length; k > 0 && !existsSync(files[k - 1]); k--);
  if (k === list.length) return files[k - 1]
  x = k ? readWav(files[k - 1]) : get()
  for (; k < list.length; k++) {
    let y = await stage(x, list[k])
    // the rate a resample leaves: its output length over the input's
    y.sr ||= list[k].startsWith('resample(') ? Number(list[k].match(/\d+/)[0]) : x.sr
    mkdirSync(path.dirname(files[k]), { recursive: true })
    writeWav(files[k], y.ch, y.sr)
    x = y
  }
  return files[list.length - 1]
}

async function run(set, ids, shard) {
  let [k, n] = shard.split('/').map(Number), all = inputs(set).filter((_, i) => i % n === k)
  for (let id of ids.flatMap(expand)) {
    let { stages: st, spec } = system(id), rooms = SETS[set].rooms, list = rooms ? st : st.filter(s => !STRUCTURAL.test(s))
    if (!list.length) continue
    let c0 = process.cpuUsage(), checks = {}, out
    for (let [name, get] of all) {
      out = await render(set, list, name, get)
      if (!rooms) continue
      let { ch, sr } = readWav(out), a = audio.from(ch, { sampleRate: sr })
      checks[name] = Object.fromEntries(await Promise.all([...new Set([spec, 'acx'].filter(Boolean))].map(async s => [s, await a.check(s)])))
    }
    if (rooms) {
      let f = path.join(path.dirname(out), `checks.${k}.json`)
      writeFileSync(f, JSON.stringify(checks))
    }
    let c = process.cpuUsage(c0)
    console.log(`${set} ${id} [${list.join(' ')}] ${((c.user + c.system) / 1e6).toFixed(1)} s CPU`)
  }
  for (let m of Object.values(models)) m.free?.()
}

let [set, ids, shard = '0/1'] = process.argv.slice(2)
if (set === 'list') {
  for (let [k, r] of Object.entries(recipes)) console.log(`${k} (${r.spec ?? '-'}): ${r.stages.join(' → ')}`)
  for (let [k, st] of Object.entries(EXTRA)) console.log(`${k}: ${st.join(' → ')}`)
  // system → output directory, for bench/speech.py
} else if (set === 'dirs') {
  let out = {}
  for (let id of ids.split(',').flatMap(expand)) for (let s of Object.keys(SETS)) for (let k of [id, 'lin:' + id]) {
    let st = system(k).stages, list = SETS[s].rooms ? st : st.filter(x => !STRUCTURAL.test(x))
    out[`${s}/${k}`] = list.length ? path.join(OUT, s, ...list.map(dir)) : null
  }
  console.log(JSON.stringify(out))
} else if (SETS[set]) await run(set, ids.split(','), shard)
else console.log('usage: node bench/speech.mjs SET SYSTEM[,SYSTEM...] [SHARD/N] | list | dirs SYSTEM[,SYSTEM...]')
