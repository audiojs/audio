// Music source separation and rebalancing: iZotope RX 12 Music Rebalance (bench/rx/host.py) against our ops and
// @audio/neural-separate on the same mixtures.
//
//   node bench/rx/separate.mjs SPLIT SYSTEM [SYSTEM...]          render what is missing, score it, print the tables
//   SHARD=k/N node bench/rx/separate.mjs SPLIT SYSTEM [...]      render every N-th track from the k-th, no tables
//   node bench/rx/separate.mjs check rx-best                     RX's remix renders against the input plus (g − 1)
//                                                                times its solos, on 3 test tracks
//
// SPLIT: `test` (reported) or `train` (settings chosen on it: every model here trained on it, so its scores run high).
// SYSTEM: a name of SYSTEMS below, or `rx:{json}` (Music Rebalance from its defaults with these parameters,
// `host.py params "Music Rebalance"`), `sep:{json}` (@audio/neural-separate's separate() with these options; `model`
// a list: their stems averaged; `tta`: averaged with the channels swapped and with the polarity inverted),
// `vocals:<stages>` (an op giving the vocals alone), `op:<stages>` (audio's chain as the editor runs it, a stem
// soloed by muting the others: op:rebalance()).
//
// Music: MUSDB18 (Rafii, Liutkus, Stöter, Mimilakis, Bittner 2017, doi:10.5281/zenodo.1117372; educational and
// non-commercial use, measurement only), its 7 s previews (musdb's download=True: 6.8 s, 44.1 kHz stereo, AAC .stem.mp4
// in DATA/musdb, decoded by ffmpeg): `test`, the 50 test tracks; `train`, every 4th of the 94 training tracks by name
// (24). The mixture stream is the input, the four stems the references.
// Per track, each system gives:
//   stems   vocals, drums, bass, other: RX by soloing each (vocal_solo ...), ours as each offers them; scored by
//           bench/rx/separate.py, BSSEval v4 (museval 0.4.1, SiSEC 2018: Stöter, Liutkus, Ito, LVA/ICA 2018): SDR, the
//           median over the track's 1 s frames, then over tracks (SIR, SAR, ISR kept in the results)
//   remixes RX's own use: vocals +6 dB, vocals −6 dB, drums −6 dB (RX's: the input plus (g − 1) times its solo, which
//           its own remix renders equal to 126 dB and more: `check`), against the true remix: the mixture with that
//           stem's own part scaled, x + (g − 1)·s (MUSDB18's mixture is coded apart from its stems, 22 to 31 dB SNR
//           from their sum, so the coding difference stays at unit gain and a perfect rebalance scores +inf). SDR as
//           BSSEval v4 scores one source: per 1 s frame the remix's energy over the error's, median over frames
//           (museval's own SDR is exactly this, metrics.py _bss_decomp_mtifilt; checked to 8 digits), then over tracks.
//           `input`, the mixture left as it is, is what doing nothing scores
//   harm    every gain at 0 dB: the output against the input, the same SDR (+inf: bit for bit)
//   RTF     a rebalance's time over the excerpt's duration (RX: one render through the host, file I/O included;
//           ours: the first render on a track, its separation included), median over tracks; on a 14-core M4 Max
//           shared with other jobs (load averages 30 to 100), so upper bounds
// Results: DATA/rx/separate/SPLIT/SYSTEM/<track>.json, stems as WAV beside them until scored (KEEP=1 keeps them).
import { readFileSync, writeFileSync, renameSync, existsSync, readdirSync, mkdirSync, rmSync } from 'node:fs'
import { execFileSync, spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import audio from '../../audio.js'
import { DATA, OUT, rx, op, writeWav, median, table } from './lib.mjs'

const ROOT = path.join(OUT, 'separate'), HERE = path.dirname(fileURLToPath(import.meta.url))
const PY = process.env.RX_PYTHON || path.join(DATA, '..', 'venv', 'bin', 'python'), JOBS = +(process.env.JOBS || 4)
const SR = 44100, STEMS = ['vocals', 'drums', 'bass', 'other'], STREAM = { drums: 1, bass: 2, other: 3, vocals: 4 }
export const REMIXES = { 'vocals +6': { vocals: 6 }, 'vocals −6': { vocals: -6 }, 'drums −6': { drums: -6 } }

// RX: each quality from its defaults (sensitivity 50 % for every stem). Ours: the vocals op (mid/side; a model's
// vocals), neural-separate's four stems at its defaults (their remix computed as the rebalance op computes it,
// x + Σ (g − 1)·ŝ), two variants of SCNet-large tried and left out (scnet averaged in; test-time augmentation), and
// the rebalance op as the editor runs it (SCNet-large)
export const SYSTEMS = {
  input: 'input:',
  'rx-good': 'rx:{"quality":"Good / Real-time"}',
  'rx-better': 'rx:{"quality":"Better / Offline"}',
  'rx-best': 'rx:{"quality":"Best / Offline"}',
  center: 'vocals:vocals()',
  'vocals-umxhq': "vocals:vocals({ model: 'umxhq' })",
  'vocals-htdemucs': "vocals:vocals({ model: 'htdemucs' })",
  umxhq: 'sep:{"model":"umxhq"}',
  htdemucs: 'sep:{"model":"htdemucs"}',
  htdemucs_ft: 'sep:{"model":"htdemucs_ft"}',
  'scnet-large': 'sep:{"model":"scnet-large"}',
  scnet: 'sep:{"model":"scnet"}',
  'scnet-both': 'sep:{"model":["scnet-large","scnet"]}',
  'scnet-large-tta': 'sep:{"model":"scnet-large","tta":true}',
  rebalance: 'op:rebalance()',
}

// ------------------------------------------------ data

const tracks = split => {
  let dir = path.join(DATA, 'musdb', split), all = readdirSync(dir).filter(f => f.endsWith('.stem.mp4')).sort()
  return (split === 'train' ? all.filter((_, i) => i % 4 === 0) : all).map(f => path.join(dir, f))
}
// stream k of a .stem.mp4 (0 the mixture), as bench/rx/separate.py decodes the references
function decode(mp4, k) {
  let b = execFileSync('ffmpeg', ['-v', 'error', '-i', mp4, '-map', `0:a:${k}`, '-f', 'f32le', '-ac', '2', '-ar', String(SR), '-'], { maxBuffer: 1 << 28 })
  let x = new Float32Array(b.buffer, b.byteOffset, b.length >> 2), n = x.length >> 1
  return [0, 1].map(c => Float32Array.from({ length: n }, (_, i) => x[2 * i + c]))
}

// ------------------------------------------------ measures

// BSSEval v4's SDR of one source: per 1 s frame (win = hop = 44100, the partial frame at the end left out, as
// museval leaves it) the reference's energy over the error's, both channels; frames where either is all zeros left
// out; median over frames
export function sdr(ref, est, win = SR) {
  let v = []
  for (let a = 0; a + win <= ref[0].length; a += win) {
    let s = 0, e = 0, y = 0
    for (let c = 0; c < ref.length; c++) for (let i = a; i < a + win; i++) s += ref[c][i] ** 2, e += (est[c][i] - ref[c][i]) ** 2, y += est[c][i] ** 2
    if (s && y) v.push(e ? 10 * Math.log10(s / e) : Infinity)
  }
  return v.length ? median(v) : null
}
// x + Σ (g − 1)·s over the stems named in `gains` (dB)
export const remix = (x, stems, gains) => x.map((ch, c) => Float32Array.from(ch, (v, i) => {
  for (let s in gains) v += (10 ** (gains[s] / 20) - 1) * stems[s][c][i]
  return v
}))

// ------------------------------------------------ systems

const RXSOLO = { vocals: 'vocal_solo', drums: 'drums_solo', bass: 'bass_solo', other: 'other_solo' }
const RXGAIN = { vocals: 'vocal_gain_db', drums: 'drums_gain_db', bass: 'bass_gain_db', other: 'other_gain_db' }
const mute = s => Object.fromEntries(STEMS.filter(t => t !== s).map(t => [t, -Infinity]))
const time = async f => { let t = performance.now(), y = await f(); return [y, (performance.now() - t) / 1000] }
let separate

// separate() with options `o`; `model` a list: their stems averaged; `tta`: averaged with the channels swapped and
// with the polarity inverted (test-time augmentation, as Music-Source-Separation-Training's --use_tta)
async function average(x, o) {
  let runs = [].concat(o.model).flatMap(model => [[model, 1, false], ...(o.tta ? [[model, 1, true], [model, -1, false]] : [])]), sum
  for (let [model, sign, swap] of runs) {
    let ch = x.ch.map(c => sign < 0 ? c.map(v => -v) : c), { stems } = await separate(swap ? [ch[1], ch[0]] : ch, { sampleRate: x.sr, ...o, model, tta: undefined })
    sum ??= Object.fromEntries(Object.keys(stems).map(t => [t, x.ch.map(c => new Float32Array(c.length))]))
    for (let t in stems) (swap ? [stems[t][1], stems[t][0]] : stems[t]).forEach((c, k) => { for (let i = 0; i < c.length; i++) sum[t][k][i] += sign * c[i] / runs.length })
  }
  return sum
}

// a system: { stems, remix(gains), harm } over ({ ch, sr }), each giving channels; `first` timed with nothing memoized
function system(spec) {
  let [kind, ...rest] = spec.split(':'), arg = rest.join(':')
  if (kind === 'rx') {
    // a remix is the input plus (g − 1) times the stem's solo (RX's own remix renders match it to 128 dB and more:
    // bench/rx/separate.mjs check), so a track's four solos give every remix
    let P = JSON.parse(arg), run = p => async x => (await rx('Music Rebalance', { ...P, ...p })(x)).ch, kept = new Map()
    let solo = s => async x => { let k = `${s}:${x.ch[0].length}`; if (kept.get('x') !== x.ch[0]) kept.clear(), kept.set('x', x.ch[0]); if (!kept.has(k)) kept.set(k, await run({ [RXSOLO[s]]: true })(x)); return kept.get(k) }
    return {
      stems: STEMS, stem: solo, harm: run({}), play: g => run(Object.fromEntries(Object.entries(g).map(([s, v]) => [RXGAIN[s], v]))),
      remix: g => async x => remix(x.ch, Object.fromEntries(await Promise.all(Object.keys(g).map(async s => [s, await solo(s)(x)]))), g),
    }
  }
  if (kind === 'sep') {
    let o = JSON.parse(arg), kept = new Map()
    let all = async x => {
      let k = x.ch[0]
      if (!kept.has(k)) {
        separate ??= (await import('@audio/neural-separate')).default
        kept.clear(); kept.set(k, await average(x, o))
      }
      return kept.get(k)
    }
    // every gain 0 dB: the input, unseparated, as the rebalance op leaves it
    return { stems: o.targets ?? STEMS, stem: s => async x => (await all(x))[s], remix: g => async x => remix(x.ch, await all(x), g), harm: async x => x.ch }
  }
  if (kind === 'vocals') {
    let kept = new Map(), voc = async x => { if (!kept.has(x.ch[0])) kept.clear(), kept.set(x.ch[0], (await op(arg)(x)).ch); return kept.get(x.ch[0]) }
    return { stems: ['vocals'], stem: () => voc, remix: g => g.vocals == null ? null : async x => remix(x.ch, { vocals: await voc(x) }, g), harm: null }
  }
  if (kind === 'op') {
    // the op's stages with its gains: `rebalance()` → `rebalance({ vocals: 6 })`
    let at = g => async x => (await op(arg.replace(/\(\s*\)$/, `(${JSON.stringify(g).replace(/null/g, '-Infinity')})`))(x)).ch
    return { stems: STEMS, stem: s => at(mute(s)), remix: g => at(g), harm: at({}) }
  }
  // the mixture as it is: what doing nothing scores
  if (kind === 'input') return { stems: [], remix: () => async x => x.ch, harm: null }
  throw new Error(`unknown system ${spec}`)
}

// ------------------------------------------------ rendering

const dirOf = (split, id) => path.join(ROOT, split, id.replace(/[^\w.+-]+/g, '_').slice(0, 120))
// JSON with ±Infinity kept (a bit-exact output's SDR)
const revive = (k, v) => v === 'inf' ? Infinity : v === '-inf' ? -Infinity : v
const load = f => existsSync(f) ? JSON.parse(readFileSync(f, 'utf8'), revive) : null
const save = (f, r) => { mkdirSync(path.dirname(f), { recursive: true }); writeFileSync(f + '.part', JSON.stringify(r, (k, v) => v === Infinity ? 'inf' : v === -Infinity ? '-inf' : v)); renameSync(f + '.part', f) }

async function render(split, id, shard) {
  let [k, N] = shard.split('/').map(Number), sys = system(SYSTEMS[id] ?? id), dir = dirOf(split, id)
  // a host-side store for separations (the editor's is the browser's): one per track, cleared before the timed render
  let store = new Map(); audio.memo = { get: k => store.get(k), set: (k, v) => store.set(k, v) }
  for (let [j, mp4] of tracks(split).entries()) {
    if (j % N !== k) continue
    let f = path.join(dir, `${j}.json`), r = load(f) ?? { track: path.basename(mp4, '.stem.mp4'), stems: {}, remix: {} }
    let want = [...sys.stems.filter(s => !r.stems[s] && !existsSync(path.join(dir, String(j), `${s}.wav`))),
      ...Object.keys(REMIXES).filter(m => r.remix[m] === undefined && sys.remix(REMIXES[m])), ...(sys.harm && r.harm == null ? ['harm'] : [])]
    if (!want.length) continue
    let ch = decode(mp4, 0), x = { ch, sr: SR }, refs = Object.fromEntries(STEMS.map(s => [s, decode(mp4, STREAM[s])]))
    r.dur = ch[0].length / SR
    store.clear()
    for (let w of [...want.filter(w => REMIXES[w]), ...want.filter(w => !REMIXES[w])]) {
      let [y, t] = await time(() => REMIXES[w] ? sys.remix(REMIXES[w])(x) : w === 'harm' ? sys.harm(x) : sys.stem(w)(x))
      if (REMIXES[w]) (r.remix[w] = sdr(remix(ch, refs, REMIXES[w]), y), (r.times ??= {})[w] = t)
      else if (w === 'harm') r.harm = sdr(ch, y)
      else writeWav(path.join(dir, String(j), `${w}.wav`), y, SR), (r.times ??= {})[w] = t
      r.first ??= t
      save(f, r)
    }
    process.stderr.write('.')
  }
}

// stems rendered and not yet scored: museval in bench/rx/separate.py, the WAVs deleted after (KEEP=1 keeps them)
function score(split, id) {
  let dir = dirOf(split, id), list = tracks(split), jobs = []
  for (let [j, mp4] of list.entries()) {
    let f = path.join(dir, `${j}.json`), r = load(f), d = path.join(dir, String(j))
    let est = Object.fromEntries(STEMS.map(s => [s, path.join(d, `${s}.wav`)]).filter(([s, p]) => !r?.stems[s] && existsSync(p)))
    if (Object.keys(est).length) jobs.push({ f, d, job: { mp4, est } })
  }
  if (!jobs.length) return
  let p = spawnSync(PY, [path.join(HERE, 'separate.py'), 'score'], { input: JSON.stringify(jobs.map(j => j.job)), maxBuffer: 1 << 28, encoding: 'utf8', env: { ...process.env, JOBS: String(JOBS) } })
  if (p.status) throw new Error(`separate.py: ${p.stderr}`)
  JSON.parse(p.stdout, revive).forEach((s, i) => {
    let { f, d } = jobs[i], r = load(f)
    Object.assign(r.stems, s); save(f, r)
    if (!process.env.KEEP) rmSync(d, { recursive: true, force: true })
  })
}

// ------------------------------------------------ tables

const fmt = (v, d = 2) => v == null ? '–' : v === Infinity ? '+inf' : v.toFixed(d)
function report(split, ids) {
  let n = tracks(split).length, R = Object.fromEntries(ids.map(id => [id, Array.from({ length: n }, (_, j) => load(path.join(dirOf(split, id), `${j}.json`))).filter(Boolean)]))
  let med = (rs, f) => { let v = rs.map(f).filter(v => v != null && !Number.isNaN(v)); return v.length ? median(v) : null }
  console.log(`\n### ${split}: stems, BSSEval v4 SDR (dB), median over ${n} tracks of the median over 1 s frames\n`)
  console.log(table(['system', ...STEMS, 'mean of 4', 'tracks'], ids.map(id => {
    let m = STEMS.map(s => med(R[id], r => r.stems[s]?.SDR))
    return [id, ...m.map(v => fmt(v)), m.every(v => v != null) ? fmt(m.reduce((a, b) => a + b) / 4) : '–', R[id].length]
  })))
  console.log(`\n### ${split}: remixes, SDR (dB) against the true remix, median over tracks; harm: every gain 0 dB, the output against the input; RTF\n`)
  console.log(table(['system', ...Object.keys(REMIXES), 'harm', 'RTF'], ids.map(id => [id,
    ...Object.keys(REMIXES).map(m => fmt(med(R[id], r => r.remix[m]))), fmt(med(R[id], r => r.harm)),
    fmt(med(R[id], r => r.first / r.dur))])))
}

// RX's own remix renders against the input plus (g − 1) times its solos, and its sum of solos against the input, on
// the first 3 test tracks: SNR, dB
async function check(ids) {
  let rows = []
  for (let id of ids) {
    let sys = system(SYSTEMS[id] ?? id), v = []
    for (let mp4 of tracks('test').slice(0, 3)) {
      let x = { ch: decode(mp4, 0), sr: SR }, st = Object.fromEntries(await Promise.all(STEMS.map(async s => [s, await sys.stem(s)(x)])))
      v.push(snrAll(x.ch, x.ch.map((c, k) => Float32Array.from(c, (_, i) => STEMS.reduce((a, s) => a + st[s][k][i], 0)))))
      for (let m in REMIXES) v.push(snrAll(await sys.play(REMIXES[m])(x), await sys.remix(REMIXES[m])(x)))
    }
    rows.push([id, Math.min(...v.filter((_, i) => i % 4 === 0)).toFixed(1), Math.min(...v.filter((_, i) => i % 4)).toFixed(1)])
  }
  console.log(table(['system', 'solos summed vs input, lowest', 'remix vs input + (g − 1)·solo, lowest'], rows))
}
const snrAll = (r, y) => { let s = 0, e = 0; r.forEach((c, k) => c.forEach((v, i) => (s += v * v, e += (y[k][i] - v) ** 2))); return 10 * Math.log10(s / e) }

let [split, ...ids] = process.argv.slice(2)
if (!process.argv[1] || import.meta.url !== pathToFileURL(path.resolve(process.argv[1])).href) {}
else if (split === 'check') await check(ids)
else if (!['test', 'train'].includes(split) || !ids.length) console.log('usage: node bench/rx/separate.mjs test|train SYSTEM [SYSTEM...]')
else {
  for (let id of ids) await render(split, id, process.env.SHARD ?? '0/1')
  if (!process.env.SHARD) { for (let id of ids) score(split, id); report(split, ids) }
}
