// De-clip: iZotope RX 12's De-clip against `audio`'s declip() (@audio/denoise-declip) on the same clipped buffers.
//
//   node bench/rx/declip.mjs tune [i/n] [sets]   RX's grid on the tuning set (part i of n of the items, of these sets)
//   node bench/rx/declip.mjs ours [i/n] [sets] [conds]   ours on the test set (these sets, these conditions)
//   node bench/rx/declip.mjs rx [i/n]       RX default and RX tuned on the test set (after `tune`)
//   node bench/rx/declip.mjs level [i/n]    ours on soft saturation given the level RX tuned cuts at (after `tune`)
//   node bench/rx/declip.mjs curves [i/n] [sets|report]   ours on more saturations, alone: the input's SDR and ours's
//   node bench/rx/declip.mjs inputs         each condition's input: SDR, rails, share of samples touched
//   node bench/rx/declip.mjs                the tables (whatever is missing rendered first)
//   node bench/rx/declip.mjs tables         the tables of what is rendered (ours's missing cells '–')
//
// Material. Tuning (every RX setting is chosen on it; ours runs at its defaults, nothing tuned): four MUSDB18
// training mixtures (Rafii et al. 2017, doi:10.5281/zenodo.1117372; its 7 s previews: the first 6 s, mono) and ten
// VoiceBank clean training utterances (Valentini-Botinhao et al. 2016/2017, doi:10.7488/ds/2117; every 50th of 504,
// 48 kHz). Test:
// the ten SQAM excerpts of the declipping survey (EBU Tech 3253; Sounds/*.wav of github.com/rajmic/declipping2020_codes,
// Záviška, Rajmic, Ozerov & Rencker, "A survey and an extensive evaluation of popular audio declipping methods", IEEE
// JSTSP 15(1), 2021), four MUSDB18 test mixtures and four Creative Commons recordings (~/.cache/audiojs/data/repair:
// "Vibe Ace", Brahms' Hungarian Dance No. 5, a solo trumpet, the Sugar Plum Fairy; 6 s each), and sixteen VoiceBank
// clean test utterances (every 51st of 824). Clean recordings are the ground truth; the defects are made on them.
//
// Conditions. hard-T: clipped symmetrically at the level that leaves it T dB SDR from the original (the survey's
// clip_sdr.m; T = 1, 3, 5, 7, 10, 15, 20), scaled so the rails sit at full scale (0 dBFS), as an overdriven converter
// or a bounce too hot leaves them. asym: the positive side at 0 dBFS at the 15 dB level, the negative at the 7 dB
// level. down: hard-7, then turned down 6 dB (rails at −6 dBFS). soft: tanh(g·x), g giving 10 dB SDR (analog
// saturation: no flat top); atan: (2/π)·arctan(π/2·g·x) likewise (a softer knee, an algebraic approach to its ceiling,
// outside the curves declip fits). mp3: hard-7 through LAME at 128 kbit/s (FFmpeg libmp3lame), decoded, aligned.
// Harm, no defect: clean, the recording peak-normalized to 0 dBFS; limited, it driven 12 dB into a lookahead limiter with a
// −0.2 dBFS ceiling (a loud master: peaks touch the ceiling, nothing is flat).
//
// Systems. RX default: De-clip as loaded (threshold −1.02 dBFS, quality Low, post-limiter on). RX tuned: asymmetric
// thresholds, each side's at its peak (what the GUI's histogram shows) plus an offset, offset × quality chosen per
// condition and per kind (music, speech) on the tuning set: soft and mp3 from {−0.07, −0.25, −0.5, −1, −2, −4, −6} dB
// at High and −0.07 at Low and Medium, the flat rails from −0.07 and −0.25 at High and −0.07 at Low and Medium (on
// the first tuning items every offset under −0.25 lost at every level; the full 7 × 3 grid on two mixtures at 1 and
// 3 dB: High ahead at every offset); post-limiter off and makeup gain 0 (the limiter holds restored peaks to 0 dBFS:
// −4 to −10 dB of SDR here). The harm rows run RX tuned at its hard-20 setting. The host can't set Input/Output Gain to 0 (their grid
// has 0.01 and −0.02): it leaves +0.01 dB each, which is divided out of every RX render. Ours: op('declip()') at its
// defaults, through `audio`, as the version installed in node_modules (each version's renders kept apart); on soft
// saturation, which has no rail (0.4.0 found none; 0.5.0 fits its curve), also declip({ clipLevel }) at the level RX
// tuned cuts at (its offset under the peak), what a user who sets RX's threshold would set. `curves`: ours alone on
// the test set under arctan and x/√(1 + x²) at 10 dB, tanh at 20 and 30 dB, tanh with each side's ceiling apart
// (the negative at 0.7), tanh then white noise 60 dB under full scale, a biased tanh (tanh(x + 0.3) − tanh(0.3), over
// its slope at 0: even harmonics, a valve's); no RX renders. Last, the survey's SQAM test beside the means it publishes
// (dSDR_clipped, and PEAQ with the reliable samples replaced, as ours keeps them).
//
// Measures. ΔSDR: SDR after minus before, dB, over the whole signal (what is heard) and over the clipped samples
// (ΔSDRc, the survey's dSDR_clipped); SDR = 10·log10(Σx² / Σ(x − y)²) (the survey's sdr.m). Harm: SDR of the
// output to the untouched input (∞: bit-exact). Perceptual: PESQ, ITU-T P.862.2 wideband (python `pesq`, 16 kHz:
// VoiceBank resampled 3:1) on speech; on music PEAQ Basic ODG (ITU-R BS.1387, P. Kabal's implementation as the survey
// ran it, the survey's published grades of its 70 clipped inputs to within 0.0015, 58 of them to 1e-5; bench/rx/peaq.py),
// both signals at the recording's own level (the survey's SQAM files as they are: its PEAQ table is comparable).
// ViSQOL Audio (v3, pure Python port) was tried and dropped as blind to clipping: "Vibe Ace" cut at 0.6 of its peak
// scores 4.73, as the original does, at 0.3 4.64.
// Renders: ~/.cache/audiojs/data/rx/declip/.
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { rx, op, keep, readWav, writeWav, mean, table, lcg, DATA, OUT } from './lib.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url)), BASE = path.join(OUT, 'declip')
const PY = process.env.RX_PYTHON || path.join(os.homedir(), '.cache', 'audiojs', 'venv', 'bin', 'python')
const [phase = 'report', share = '0/1', only, conds] = process.argv.slice(2), [pi, pn] = share.split('/').map(Number)
const OURS = 'ours@' + JSON.parse(readFileSync(path.join(HERE, '../../node_modules/@audio/denoise-declip/package.json'))).version

// ---- material
const f32 = file => new Float32Array(readFileSync(file).buffer.slice(0))
const peak = x => x.reduce((m, v) => Math.max(m, Math.abs(v)), 0), top = (x, s = 1) => x.reduce((m, v) => Math.max(m, s * v), -Infinity)
function musdb(dir, k, sr = 44100) {
  let name = readdirSync(dir).filter(f => f.endsWith('.stem.mp4')).sort()[k], file = path.join(BASE, 'src', `${path.basename(dir)}-${k}.f32`)
  if (!existsSync(file)) {
    let r = spawnSync('ffmpeg', ['-v', 'error', '-i', path.join(dir, name), '-t', '6', '-map', '0:a:0', '-ac', '1', '-ar', String(sr), '-f', 'f32le', '-'], { maxBuffer: 1 << 26 })
    mkdirSync(path.dirname(file), { recursive: true }); writeFileSync(file, r.stdout)
  }
  return { name: name.replace('.stem.mp4', ''), x: f32(file), sr }
}
function material() {
  let items = [], add = (split, kind, set, list) => list.forEach(it => items.push({ split, kind, set, ...it }))
  let vb = (dir, step, n) => readdirSync(dir).filter(f => f.endsWith('.wav')).sort().filter((_, i) => i % step === 0).slice(0, n)
    .map(f => ({ name: f.replace('.wav', ''), x: readWav(path.join(dir, f)).ch[0], sr: 48000 }))
  add('tune', 'music', 'musdb-train', [0, 23, 47, 71].map(k => musdb(path.join(DATA, 'musdb/train'), k)))
  add('tune', 'speech', 'vb-train', vb(path.join(DATA, 'vbdemand-train/clean'), 50, 10))
  let sq = path.join(DATA, 'declip-sqam')
  add('test', 'music', 'sqam', readdirSync(sq).filter(f => f.endsWith('.wav')).sort().map(f => ({ name: f.replace('.wav', ''), ...(w => ({ x: w.ch[0], sr: w.sr }))(readWav(path.join(sq, f))) })))
  add('test', 'music', 'repair', [['vibeace', 5], ['brahms', 5], ['trumpet', 0], ['nutcracker', 5]].map(([k, s]) => ({ name: k, x: f32(path.join(DATA, 'repair', k + '.f32')).slice(s * 44100, (s + 6) * 44100), sr: 44100 })))
  add('test', 'music', 'musdb-test', [0, 12, 25, 37].map(k => musdb(path.join(DATA, 'musdb/test'), k)))
  add('test', 'speech', 'vb-test', vb(path.join(DATA, 'vbdemand/clean_testset_wav'), 51, 16))
  return items
}

// ---- degradations
const clip = (x, hi, lo = -hi) => Float32Array.from(x, v => Math.min(hi, Math.max(lo, v)))
const scale = (x, k) => Float32Array.from(x, v => v * k)
const sdr = (x, y, m) => { let s = 0, e = 0; for (let i = 0; i < x.length; i++) if (!m || m[i]) s += x[i] ** 2, e += (x[i] - y[i]) ** 2; return 10 * Math.log10(s / e) }
// clip_sdr.m: the threshold in (0, 0.99·max|x|) leaving SDR `db` (fzero there, bisection here)
const level = (x, db) => { let a = 0, b = 0.99 * peak(x); for (let i = 0; i < 60; i++) { let m = (a + b) / 2; if (sdr(x, clip(x, m)) < db) a = m; else b = m } return (a + b) / 2 }
const drive = (x, db, f = Math.tanh) => { let a = 0.01, b = 100; for (let i = 0; i < 60; i++) { let g = Math.sqrt(a * b), r = scale(x, g); if (sdr(r, r.map(f)) < db) b = g; else a = g } return Math.sqrt(a * b) }
// saturations of unit slope at 0 (`atan` a condition; the rest `curves`'s)
const SAT = {
  atan: v => 2 / Math.PI * Math.atan(Math.PI / 2 * v), alg: v => v / Math.sqrt(1 + v * v),
  sides: v => v > 0 ? Math.tanh(v) : 0.7 * Math.tanh(v / 0.7), bias: v => (Math.tanh(v + 0.3) - Math.tanh(0.3)) / (1 - Math.tanh(0.3) ** 2),
}
// a lookahead limiter: the gain the 5 ms moving average of the minimum over the next 5 ms of ceiling/|x|, released over
// 100 ms, so a peak touches the ceiling and its neighbours follow the wave (no sample held flat)
function limit(x, sr, c) {
  let L = Math.round(0.005 * sr), rel = Math.exp(-1 / (0.1 * sr)), n = x.length, M = new Float64Array(n), y = new Float32Array(n), q = []
  for (let i = n - 1; i >= 0; i--) {
    let need = Math.min(1, c / Math.max(Math.abs(x[i]), 1e-12))
    while (q.length && q[q.length - 1][1] >= need) q.pop()
    q.push([i, need]); while (q[0][0] > i + L - 1) q.shift()
    M[i] = q[0][1]
  }
  for (let i = 1; i < n; i++) M[i] = Math.min(M[i], 1 - (1 - M[i - 1]) * rel)
  for (let i = 0, s = 0; i < n; i++) { s += M[i]; if (i >= L) s -= M[i - L]; y[i] = x[i] * s / Math.min(i + 1, L) }
  return y
}
function mp3(y, sr, file) {
  if (!existsSync(file)) {
    let tmp = file + '.in.wav', enc = file + '.mp3'
    writeWav(tmp, [y], sr)
    spawnSync('ffmpeg', ['-v', 'error', '-y', '-i', tmp, '-c:a', 'libmp3lame', '-b:a', '128k', enc])
    let r = spawnSync('ffmpeg', ['-v', 'error', '-i', enc, '-ac', '1', '-f', 'f32le', '-'], { maxBuffer: 1 << 27 })
    let d = new Float32Array(r.stdout.buffer.slice(r.stdout.byteOffset, r.stdout.byteOffset + r.stdout.byteLength))
    // align: the lag within ±2048 of most correlation (FFmpeg trims LAME's delay itself; this checks it)
    let best = 0, lag = 0
    for (let l = -2048; l <= 2048; l++) { let s = 0; for (let i = 4096; i < Math.min(y.length, d.length) - 4096; i += 4) s += y[i] * d[i + l]; if (s > best) best = s, lag = l }
    let z = Float32Array.from(y, (_, i) => d[i + lag] ?? 0)
    writeWav(file, [z], sr); rmSync(tmp); rmSync(enc)
  }
  return readWav(file).ch[0]
}
const LEVELS = [1, 3, 5, 7, 10, 15, 20]
const CONDS = [...LEVELS.map(t => 'hard-' + t), 'asym', 'down', 'soft', 'atan', 'mp3', 'clean', 'limited']
const HARM = new Set(['clean', 'limited'])
// → { ref: the ground truth at the input's scale, y: the input, mask: the samples the defect touched }
function degrade(it, cond) {
  let { x, sr } = it, ref, y
  if (cond.startsWith('hard-')) { ref = scale(x, 1 / level(x, +cond.slice(5))); y = clip(ref, 1) }
  else if (cond === 'asym') { let h = level(x, 15); ref = scale(x, 1 / h); y = clip(ref, 1, -level(x, 7) / h) }
  else if (cond === 'down') { ref = scale(x, 0.5 / level(x, 7)); y = scale(clip(scale(ref, 2), 1), 0.5) }
  else if (cond === 'soft') { ref = scale(x, drive(x, 10)); y = ref.map(Math.tanh) }
  else if (cond in SAT) { ref = scale(x, drive(x, 10, SAT[cond])); y = ref.map(SAT[cond]) }
  else if (cond === 'tanh20' || cond === 'tanh30') { ref = scale(x, drive(x, +cond.slice(4))); y = ref.map(Math.tanh) }
  else if (cond === 'hiss') { let r = lcg(1); ref = scale(x, drive(x, 10)); y = ref.map(v => Math.tanh(v) + 2e-3 * Math.sqrt(3) * (r() - 0.5)) }
  else if (cond === 'mp3') { ref = scale(x, 1 / level(x, 7)); y = mp3(clip(ref, 1), sr, path.join(BASE, it.set, it.name, 'mp3-in.wav')) }
  else if (cond === 'clean') ref = y = scale(x, 1 / peak(x))
  else if (cond === 'limited') ref = y = limit(scale(x, 4 / peak(x)), sr, 10 ** (-0.2 / 20))
  let src = cond === 'mp3' ? ref : y
  let mask = Uint8Array.from(ref, (v, i) => cond === 'mp3' ? Math.abs(v) > 1 : v !== src[i])
  return { ref: Float32Array.from(ref), y: Float32Array.from(y), mask }
}

// ---- systems
const G = 10 ** (-0.02 / 20), dB = v => 20 * Math.log10(Math.max(v, 1e-9))
const OFFS = [-0.07, -0.25, -0.5, -1, -2, -4, -6]
const GRID = [...OFFS.map(d => `rx:High:${d}`), 'rx:Medium:-0.07', 'rx:Low:-0.07']
// hard clipping, flat rails: the offsets under −0.25 lost on every tuning item and level they were run on (−0.07 best)
const gridFor = cond => cond === 'soft' || cond === 'atan' || cond === 'mp3' ? GRID : GRID.filter(s => !/-(0\.5|1|2|4|6)$/.test(s) || !s.includes('High'))
const params = (sys, y) => {
  if (sys === 'rx') return {}
  let [, q, d] = sys.split(':'), hi = top(y), lo = top(y, -1), th = v => Math.max(-64, Math.min(0, dB(v) + +d))
  return { enable_asymmetric: true, positive_threshold: th(hi), negative_threshold: th(lo), quality: q, post_limiter: false }
}
async function render(it, cond, sys) {
  let file = path.join(BASE, it.set, it.name, cond, sys.replace(/:/g, '_') + '.wav')
  return (await keep(file, async () => {
    let { y } = degrade(it, cond)
    if (sys.startsWith('ours')) { let off = sys.split('~')[1]; return op(off ? `declip({ clipLevel: ${peak(y) * 10 ** (off / 20)} })` : 'declip()')({ ch: [y], sr: it.sr }) }
    let z = await rx('De-clip', params(sys, y))({ ch: [y], sr: it.sr })
    return { ch: [z.ch[0].map(v => v * G)], sr: z.sr }
  })).ch[0]
}

// ---- scores: ΔSDR, ΔSDRc (harm: SDR to the input); PESQ / PEAQ by Python, kept in scores.json
const score = (it, cond, d, z) => HARM.has(cond)
  ? { harm: z.every((v, i) => v === d.y[i]) ? Infinity : sdr(d.y, z) }
  : { dsdr: sdr(d.ref, z) - sdr(d.ref, d.y), dsdrc: sdr(d.ref, z, d.mask) - sdr(d.ref, d.y, d.mask) }
const SCORES = path.join(BASE, 'scores.json')
const PERCEPT = `
import sys, json, numpy as np, soundfile as sf
from scipy.signal import resample_poly
from pesq import pesq
sys.path.insert(0, ${JSON.stringify(HERE)})
out = {}
for line in sys.stdin:
    j = json.loads(line)
    r, fs = sf.read(j['ref'], dtype='float64'); d, _ = sf.read(j['deg'], dtype='float64')
    r, d = r * j['gain'], d * j['gain']
    if j['metric'] == 'pesq': v = pesq(16000, resample_poly(r, 1, 3), resample_poly(d, 1, 3), 'wb')
    else:
        import peaq; v = peaq.odg(r, d, fs)[0]
    print(json.dumps({'key': j['key'], 'v': float(v)}), flush=True)
`
function perceptual(jobs) {
  let kept = existsSync(SCORES) ? JSON.parse(readFileSync(SCORES)) : {}, todo = jobs.filter(j => !(j.key in kept))
  if (todo.some(j => j.metric === 'peaq') && !existsSync(path.join(HERE, 'peaq.py'))) todo = todo.filter(j => j.metric !== 'peaq')
  if (todo.length) {
    let r = spawnSync(PY, ['-c', PERCEPT], { env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' }, input: todo.map(j => JSON.stringify(j)).join('\n'), maxBuffer: 1 << 26 })
    for (let l of r.stdout.toString().split('\n').filter(Boolean)) { let { key, v } = JSON.parse(l); kept[key] = v }
    if (r.status) console.error(r.stderr.toString().slice(-2000))
    writeFileSync(SCORES, JSON.stringify(kept))
  }
  return kept
}

// ---- run
const items = material(), tune = items.filter(it => it.split === 'tune'), test = items.filter(it => it.split === 'test')
const mine = list => list.filter(it => !only || only.split(',').includes(it.set)).filter((_, i) => i % pn === pi), DEFECTS = CONDS.filter(c => !HARM.has(c))
const file = (it, cond, sys) => path.join(BASE, it.set, it.name, cond, sys.replace(/:/g, '_') + '.wav')
let res = new Map(), get = (it, cond, sys) => res.get(`${it.set}/${it.name}/${cond}/${sys}`)
async function measure(list, conds, sysOf, missing = true) {
  for (let it of list) for (let cond of conds) {
    let d = null
    for (let sys of sysOf(it, cond)) if (missing || existsSync(file(it, cond, sys)))
      res.set(`${it.set}/${it.name}/${cond}/${sys}`, score(it, cond, d ??= degrade(it, cond), await render(it, cond, sys)))
  }
}
if (phase === 'inputs') {   // each condition's input: SDR to the truth, rails, share of samples the defect touched
  for (let it of items) {
    let row = CONDS.map(c => { let d = degrade(it, c); return `${c} ${sdr(d.ref, d.y).toFixed(1)} dB [${top(d.y).toFixed(3)}, ${(-top(d.y, -1)).toFixed(3)}] ${(100 * d.mask.reduce((s, v) => s + v, 0) / d.y.length).toFixed(1)}%` })
    console.log(`${it.split} ${it.set}/${it.name} (${(it.x.length / it.sr).toFixed(1)} s): ${row.join('; ')}`)
  }
  process.exit(0)
}
if (phase === 'ours') { await measure(mine(test), CONDS.filter(c => !conds || conds.split(',').includes(c)), () => [OURS]); process.exit(0) }
if (phase === 'curves') {
  const MORE = { alg: 'x/√(1 + x²), 10 dB', sides: 'tanh, the negative ceiling 0.7, 10 dB', bias: 'tanh biased (even harmonics), 10 dB', tanh20: 'tanh, 20 dB', tanh30: 'tanh, 30 dB', hiss: 'tanh 10 dB, then hiss at −60 dBFS' }
  if (only !== 'report') await measure(mine(test), Object.keys(MORE), () => [OURS])
  if (pn > 1) process.exit(0)
  let rows = []
  await measure(test, Object.keys(MORE), () => [OURS], false)
  for (let [c, what] of Object.entries(MORE)) rows.push([what, ...[it => it.set === 'sqam', it => it.set === 'repair' || it.set === 'musdb-test', it => it.set === 'vb-test'].map(f => {
    let set = test.filter(f).filter(it => get(it, c, OURS)), d = set.map(it => degrade(it, c))
    if (!set.length) return '–'
    return `${mean(d.map(d => sdr(d.ref, d.y))).toFixed(1)} → ${mean(set.map((it, i) => sdr(d[i].ref, d[i].y) + get(it, c, OURS).dsdr)).toFixed(1)}${set.length < test.filter(f).length ? ` (${set.length})` : ''}`
  })])
  console.log(`## ${OURS} on more saturations: SDR in → out, dB (mean)\n\n` + table(['saturation', 'SQAM', 'other music', 'speech'], rows))
  process.exit(0)
}
// RX tuned: per condition and kind, the grid setting of the best mean ΔSDR on the tuning set (the harm rows: hard-20's)
await measure(phase === 'tune' ? mine(tune) : tune, DEFECTS, (it, cond) => gridFor(cond))
if (phase === 'tune') process.exit(0)
const tuned = {}
for (let kind of ['music', 'speech']) {
  for (let cond of DEFECTS) tuned[kind + cond] = gridFor(cond).map(s => [s, mean(tune.filter(it => it.kind === kind).map(it => get(it, cond, s).dsdr))]).sort((a, b) => b[1] - a[1])[0][0]
  for (let c of HARM) tuned[kind + c] = tuned[kind + 'hard-20']
}
// soft saturation has no rail to find: ours given the level RX tuned cuts at (its offset under the peak), as a user would
const level_ = (it, cond = 'soft') => `${OURS}~${tuned[it.kind + (cond === 'atan' ? 'atan' : 'soft')].split(':')[2]}`
if (phase === 'level') { await measure(mine(test), ['soft', 'atan'], (it, cond) => [level_(it, cond)]); process.exit(0) }
await measure(phase === 'rx' ? mine(test) : test, CONDS, (it, cond) => ['rx', tuned[it.kind + cond]])
if (phase === 'rx') process.exit(0)
for (let it of test) for (let cond of CONDS) {
  let d = null, dir = path.dirname(file(it, cond, 'x'))
  if (existsSync(dir)) for (let sys of readdirSync(dir).filter(f => f.startsWith('ours@')).map(f => f.slice(0, -4)))
    res.set(`${it.set}/${it.name}/${cond}/${sys}`, score(it, cond, d ??= degrade(it, cond), readWav(file(it, cond, sys)).ch[0]))
}
await measure(test, CONDS, () => [OURS], phase !== 'tables')
await measure(test, ['soft', 'atan'], (it, cond) => [level_(it, cond)], phase !== 'tables')
const oursTags = [...new Set([...res.keys()].map(k => k.split('/').pop()).filter(s => s.startsWith('ours@')))].sort()
const systems = (kind, cond) => [['RX default', 'rx'], [`RX tuned`, tuned[kind + cond]], ...oursTags.filter(t => !t.includes('~')).map(t => [t.replace('ours@', 'ours '), t]), [`${OURS.replace('ours@', 'ours ')}, level given`, level_({ kind }, cond)]]
const med = v => [...v].sort((a, b) => a === b ? 0 : a < b ? -1 : 1)[(v.length - 1) >> 1]
const fmt = v => v === Infinity ? '∞' : Number.isFinite(v) ? v.toFixed(2) : '–'

// perceptual jobs: test items, every system of the table
// the reference and the input written for the scorer only while a score is missing, and removed after (they remake)
let pj = [], scored = existsSync(SCORES) ? JSON.parse(readFileSync(SCORES)) : {}, made = []
for (let it of test) for (let cond of DEFECTS) {
  let metric = it.kind === 'speech' ? 'pesq' : 'peaq', key = sys => `${metric}|${it.set}/${it.name}/${cond}/${sys}`
  let want = ['input', ...systems(it.kind, cond).map(s => s[1])].filter(sys => !(key(sys) in scored) && (sys === 'input' || existsSync(file(it, cond, sys))))
  if (!want.length) continue
  let d = degrade(it, cond)
  for (let [k, v] of [['ref', 'ref'], ['input', 'y']]) writeWav(file(it, cond, k), [d[v]], it.sr), made.push(file(it, cond, k))
  let gain = peak(it.x) / peak(d.ref)   // the recording's own level (PEAQ is level-dependent)
  for (let sys of want) pj.push({ key: key(sys), metric, gain, ref: file(it, cond, 'ref'), deg: file(it, cond, sys) })
}
const P = perceptual(pj); made.forEach(f => rmSync(f))
const pv = (it, cond, sys) => P[`${it.kind === 'speech' ? 'pesq' : 'peaq'}|${it.set}/${it.name}/${cond}/${sys}`]

const groups = [['SQAM (survey)', it => it.set === 'sqam'], ['other music', it => it.set === 'repair' || it.set === 'musdb-test'], ['speech', it => it.set === 'vb-test']]
console.log(`# De-clip: RX 12 against ${oursTags.filter(t => !t.includes('~')).join(', ')}\n\nRX tuned, per condition (music · speech): ${DEFECTS.map(c => `${c} ${tuned['music' + c].slice(3)} · ${tuned['speech' + c].slice(3)}`).join('; ')}\n`)
for (let [g, f] of groups) {
  let set = test.filter(f), kind = set[0].kind, head = ['condition', ...systems(kind, 'hard-1').map(s => s[0])]
  for (let [what, key] of [['ΔSDR, dB (whole signal)', 'dsdr'], ['ΔSDRc, dB (clipped samples)', 'dsdrc']]) {
    console.log(`\n## ${g}, ${set.length} items: ${what}\n`)
    console.log(table(head, DEFECTS.map(c => [c, ...systems(kind, c).map(([, s]) => fmt(mean(set.map(it => get(it, c, s)?.[key] ?? NaN))))])))
  }
  let m = kind === 'speech' ? 'PESQ (WB)' : 'PEAQ ODG'
  console.log(`\n## ${g}: ${m}, input → output\n`)
  console.log(table(['condition', 'input', ...head.slice(1)], DEFECTS.map(c => [c, fmt(mean(set.map(it => pv(it, c, 'input') ?? NaN))), ...systems(kind, c).map(([, s]) => fmt(mean(set.map(it => pv(it, c, s) ?? NaN))))])))
  console.log(`\n## ${g}: harm, SDR of the output to the unclipped input, dB (median; ∞ bit-exact)\n`)
  console.log(table(head, [...HARM].map(c => [c, ...systems(kind, c).map(([, s]) => fmt(med(set.map(it => get(it, c, s)?.harm ?? NaN))))])))
}

// the survey's own test: its SQAM excerpts at its seven levels, beside the means it publishes (Numerical_results:
// dSDR_clipped_declippingResults.mat, PEAQ_declippingResults_RR.mat: reliable samples replaced, as ours keeps them)
const SURVEY = {
  'social sparsity, PEW (Siedenburg, Kowalski & Dörfler 2014)': [[12.17, 15.03, 16.61, 17.66, 19.01, 21.17, 22.21], [-3.67, -3.02, -2.06, -1.30, -0.68, -0.30, -0.16]],
  'A-SPADE (Kitić, Bertin & Gribonval 2015)': [[11.88, 13.88, 15.06, 15.98, 17.28, 19.43, 20.27], [-3.87, -3.74, -3.39, -2.84, -1.84, -0.73, -0.37]],
  'S-SPADE (Záviška et al. 2019)': [[11.38, 13.71, 15.04, 15.62, 17.11, 19.28, 19.91], [-3.88, -3.80, -3.57, -3.13, -2.25, -0.99, -0.48]],
  'ℓ1, parabola-weighted (CP)': [[9.95, 13.03, 14.77, 15.96, 17.44, 19.63, 21.00], [-3.51, -2.81, -2.06, -1.52, -0.99, -0.49, -0.24]],
  'NMF (Bilen, Ozerov & Pérez 2018)': [[5.10, 12.21, 14.27, 16.22, 18.00, 20.57, 21.96], [-3.69, -2.72, -1.74, -1.04, -0.62, -0.28, -0.13]],
  'Janssen (AR)': [[-0.95, -1.28, 0.62, 3.52, 7.87, 17.01, 19.57], [-3.91, -3.87, -3.54, -2.48, -1.42, -0.50, -0.25]],
}
{
  let sq = test.filter(it => it.set === 'sqam'), lv = LEVELS.map(t => 'hard-' + t), m = v => mean(v), row = (k, v) => [k, ...v.map(fmt), fmt(m(v))]
  for (let [what, f, j] of [['ΔSDRc, dB (clipped samples)', (sys, c) => m(sq.map(it => get(it, c, sys)?.dsdrc ?? NaN)), 0], ['PEAQ ODG', (sys, c) => m(sq.map(it => pv(it, c, sys) ?? NaN)), 1]]) {
    console.log(`\n## The survey's SQAM excerpts: ${what}, beside its published means\n`)
    console.log(table(['method', ...LEVELS.map(t => `${t} dB`), 'mean'], [
      ...(j ? [row('clipped (input)', lv.map(c => f('input', c)))] : []),
      ...oursTags.filter(t => !t.includes('~')).map(t => row(t.replace('ours@', 'declip '), lv.map(c => f(t, c)))),
      row('RX 12 tuned', lv.map(c => f(tuned['music' + c], c))),
      ...Object.entries(SURVEY).map(([k, v]) => row(k, v[j]))]))
  }
}
