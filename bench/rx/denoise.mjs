// Classical noise reduction against iZotope RX 12's Voice De-noise and Spectral De-noise, on the same buffers.
//
//   node bench/rx/denoise.mjs speech SET SYSTEM[;SYSTEM...] [K/N]   VoiceBank+DEMAND; SET train, test, train-clean, test-clean
//   node bench/rx/denoise.mjs music SPLIT SYSTEM[;SYSTEM...] [K/N]  steady noise under music; SPLIT train, test
//   node bench/rx/denoise.mjs clean SPLIT SYSTEM[;SYSTEM...]        the same music clean, nothing to remove (systems
//                                                                    that need no LEAD)
//
// SYSTEM: an op chain as audio runs it (`omlsa()`, `omlsa({ gMin: -12 })`, `denoise(12, { noise: LEAD })`, LEAD the
// item's lead-in where the noise plays alone, as a user selects it), or RX 12 (bench/rx/host.py; P: its Pedalboard
// parameters, `host.py params "<Plugin>"`): `vdn(P)` Voice De-noise (adaptive at its defaults), `sdn(P)` Spectral
// De-noise with adaptive learning on, `vdnL(P)` and `sdnL(P)` on a print learned from LEAD (bench/rx/denoise.py says
// how: Learn is not a plugin parameter). Systems are separated by `;`. K/N: every N-th item from the K-th.
// Items are seeded: the same SET gives the same mixtures, and renders and scores are kept in ~/.cache/audiojs/data/rx/
// denoise/ (speech renders, a hundred at a time, are deleted once scored: KEEP=1 keeps them). `SYSTEM@TAG` keeps a
// system's results apart under TAG: the same op after its package changed.
// RX's settings were chosen on `train` (2026-10), small grids over its main knobs, by PESQ on speech (the 0/3 subset)
// and SDR on music (0/4): Voice De-noise reduction 12/16/20 dB, filter Surgical/Gentle, master threshold −12 to +10 dB,
// Dialogue/Music → `vdn({ reduction: 20, master_threshold: 10 })`; Spectral De-noise quality Simple/Advanced/Extreme ×
// 12/20/30 dB → `sdn({ quality: 'Extreme', linked_reduction_db: 20 })`; on a learned print the same grids →
// `vdnL({ reduction: 20, master_threshold: 10 })`, `sdnL({ quality: 'Extreme', linked_reduction_db: 20 })`.
//
// Speech. VoiceBank+DEMAND (Valentini-Botinhao 2017, CC BY 4.0, doi:10.7488/ds/2117; bench/speech.mjs says where
// from): `train`, 504 utterances of 28 training speakers and noises disjoint from the test set's, the only set settings
// are chosen on (its every third, 0/3, for grids); `test`, the 824 test utterances; `*-clean`, their clean references
// in (what each does to speech with nothing to remove). LEAD: 0 s to 50 ms before the clean reference's speech
// starts (bench/denoise.mjs `lead`: median 0.55 s on the test set). Scored by bench/rx/denoise.py with bench/speech.py's
// measures: PESQ (ITU-T P.862.2), STOI (Taal et al. 2011), SI-SDR (Le Roux et al. 2019), DNSMOS P.835 SIG/BAK/OVRL
// (Reddy et al. 2022) at the input's loudness, and musical noise (the log kurtosis ratio, Uemura et al. 2008). Mean
// over items, and against the first system the paired mean difference ± 1.96 standard errors.
//
// Music. Each item: 1.5 s of noise alone (LEAD), a music excerpt, 1 s of noise alone. Music, mono 44.1 kHz: `train`,
// MUSDB18's training mixtures (Rafii et al. 2017, 7 s previews; the first 12 by name, decoded as @audio/neural-
// denoise's accuracy.py decodes the test ones), `test`, its first 20 test mixtures (musdb/test-mono) and the four
// recordings @audio/denoise's scripts/repair.js uses (repair/*.f32: strings, celesta, jazz, solo trumpet; 10 s from
// 5 s in, the trumpet whole). Noises: `hiss`, white Gaussian; `pink`, Gaussian through Kellet's 1/f filter (as
// @audio/denoise's scripts/speech.mjs); `room`, DEMAND OHALLWAY, a hallway's room tone, and `machine`, DEMAND DWASHING,
// a washing machine (Thiemann, Ito & Vincent 2013, CC BY-SA 3.0; channel 1 resampled to 44.1 kHz; train items from the
// recording's first half, test from its second). Each at 10 and 25 dB under the music's active level (20 ms frames
// within 40 dB of the loudest, as ITU-T P.56 reads speech). Reported: `train` 0/2 (six mixtures), `test` 0/2 (ten
// MUSDB18 mixtures, the strings and the jazz), eight conditions each.
// Measures, by the phase-inversion method (Hagerman & Olofsson, Acta Acustica 90, 2004): the system hears music + noise
// and music − noise; half their sum is what it made of the music (ŝ), half their difference what it left of the noise
// (n̂). Over the music: `SDR`, the output for music + noise against the clean music, dB (the primary measure); `NMR`,
// the noise-to-mask ratio of that output's error (`nmr` below: under 0 dB the error is masked by the music); `ΔSNR`,
// ŝ over n̂ less the music over the noise; `music`, the music against what became of it, s over ŝ − s, dB (harm: what
// the gain does to the music); `cut %`, the share of the music's time-frequency energy ŝ took more than 3 dB from;
// `HF`, ŝ's energy over s's above 8 kHz, dB; `MN`, musical noise, the log kurtosis ratio of n̂'s power spectral values
// over the noise's (Uemura et al., IWAENC 2008: 0 when the noise is only scaled, above where isolated peaks survive),
// 1024-point Hann frames, 100 Hz to 16 kHz, under the music (`MN mus.`) and in the second after it stops (`MN tail`);
// `NR tail`, the noise taken there, dB. `clean`: the music alone in, SDR and NMR of the output against it, cut % and HF.
import { readFileSync, readdirSync, existsSync, mkdirSync, writeFileSync, renameSync, rmSync } from 'node:fs'
import { spawn, spawnSync } from 'node:child_process'
import { createInterface } from 'node:readline'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { stftAnalyse } from '@audio/stft'
import audio from '../../audio.js'
import { lead } from '../denoise.mjs'
import { rx, op, readWav, writeWav, lcg, mean, table, DATA, OUT } from './lib.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url)), DIR = path.join(OUT, 'denoise')
const PY = process.env.RX_PYTHON || path.join(os.homedir(), '.cache', 'audiojs', 'venv', 'bin', 'python')
const PLUGIN = { vdn: 'Voice De-noise', sdn: 'Spectral De-noise' }
const args = s => new Function(`return [${s}]`)()

// RX on a print learned from [from, to) s: one bench/rx/denoise.py process per Node process, jobs in order
let py, pending = [], seq = 0
function learnJob(j) {
  if (!py) {
    py = spawn(PY, [path.join(HERE, 'denoise.py'), 'learn'], { stdio: ['pipe', 'pipe', 'ignore'] })
    createInterface({ input: py.stdout }).on('line', l => { let r = JSON.parse(l), p = pending.shift(); r.error ? p.reject(new Error(r.error)) : p.resolve(r.out) })
    py.on('exit', c => { for (let p of pending.splice(0)) p.reject(new Error(`denoise.py exited ${c}`)); py = null })
  }
  return new Promise((resolve, reject) => { pending.push({ resolve, reject }); py.stdin.write(JSON.stringify(j) + '\n') })
}
const rxLearned = (plugin, params, from, to) => async ({ ch, sr }) => {
  let tmp = path.join(DIR, 'tmp', `${process.pid}-${seq++}`), i = tmp + '-in.wav', o = tmp + '-out.wav'
  writeWav(i, ch, sr)
  try { await learnJob({ plugin, params, lead: [from, to], in: i, out: o }); return readWav(o) }
  finally { for (let f of [i, o]) existsSync(f) && rmSync(f) }
}

// a host killed under a job (another process stopping its own) is started again, the job retried once
const retry = f => async x => { try { return await f(x) } catch (e) { if (/exited/.test(e.message)) return f(x); throw e } }

/** SYSTEM → (x, lead s) → { ch, sr } */
function system(id) {
  id = id.split('@')[0]
  let m = id.match(/^(vdn|sdn)(L?)\((.*)\)$/s)
  if (m) {
    let p = args(m[3])[0] ?? {}
    if (m[2]) return (x, l) => retry(rxLearned(PLUGIN[m[1]], p, 0, l))(x)
    return retry(rx(PLUGIN[m[1]], m[1] === 'sdn' ? { adaptive_learning: true, ...p } : p))
  }
  return (x, l) => op(id.replace(/\bLEAD\b/g, `{ at: 0, duration: ${l} }`))(x)
}
// a cache merged with what another process wrote meanwhile, replaced whole (shards of one system share it)
function save(file, rows) {
  if (existsSync(file)) rows = Object.assign(JSON.parse(readFileSync(file)), rows)
  mkdirSync(path.dirname(file), { recursive: true }); writeFileSync(file + '.' + process.pid, JSON.stringify(rows)); renameSync(file + '.' + process.pid, file)
}
// `SYSTEM@TAG`: SYSTEM kept apart under TAG, for a package changed since (before and after side by side)
const dirOf = id => id.replace(/@/, '.').replace(/\s+/g, '').replace(/["'\/]/g, '')

// ---- speech ----
const SPEECH = {
  train: ['vbdemand-train', 'noisy', 'clean'], test: ['vbdemand', 'noisy_testset_wav', 'clean_testset_wav'],
  'train-clean': ['vbdemand-train', 'clean', 'clean'], 'test-clean': ['vbdemand', 'clean_testset_wav', 'clean_testset_wav'],
}
async function speech(set, ids, k, n) {
  let [d, inp, ref] = SPEECH[set], names = readdirSync(path.join(DATA, d, ref)).filter(f => f.endsWith('.wav')).sort()
    .map(f => f.slice(0, -4)).filter((_, i) => i % n === k)
  let res = []
  for (let id of ids) {
    let out = path.join(DIR, 'speech', set, dirOf(id)), cache = path.join(out, 'scores.json'), sys = system(id)
    let have = existsSync(cache) ? JSON.parse(readFileSync(cache)) : {}, todo = names.filter(nm => !have[nm])
    // a hundred at a time: rendered, scored, and (but with KEEP) deleted, so a run holds little on disk
    for (let i = 0; i < todo.length; i += 100) {
      let part = todo.slice(i, i + 100)
      for (let nm of part) {
        let f = path.join(out, nm + '.wav')
        if (existsSync(f)) continue
        let x = readWav(path.join(DATA, d, inp, nm + '.wav')), c = readWav(path.join(DATA, d, ref, nm + '.wav'))
        let l = Math.round(lead(c.ch[0], c.sr) * c.sr) / c.sr
        writeWav(f, (await sys(x, l)).ch, x.sr)
      }
      let r = spawnSync(PY, [path.join(HERE, 'denoise.py'), 'score'], { input: JSON.stringify(part.map(nm => [set, out, nm])), maxBuffer: 1 << 28 })
      if (r.status) throw new Error(`denoise.py score: ${r.stderr}`)
      for (let row of JSON.parse(r.stdout)) have[row.name] = row
      save(cache, have)
      if (!process.env.KEEP) for (let nm of part) rmSync(path.join(out, nm + '.wav'), { force: true })
    }
    res.push([id, names.map(nm => have[nm])])
  }
  let keys = set.endsWith('-clean') ? ['pesq', 'stoi', 'sisdr'] : ['pesq', 'stoi', 'sisdr', 'sig', 'bak', 'ovrl', 'kurt']
  report(`${set}${n > 1 ? ` ${k}/${n}` : ''}, ${names.length} utterances`, res, keys)
  if (set.endsWith('-clean')) return
  // by the input's SNR, the set's nominal one nearest the measured (train 0, 5, 10, 15 dB; test 2.5, 7.5, 12.5, 17.5)
  let o = set === 'test' ? 2.5 : 0, at = names.map(nm => {
    let c = readWav(path.join(DATA, d, ref, nm + '.wav')).ch[0], y = readWav(path.join(DATA, d, inp, nm + '.wav')).ch[0], p = 0, q = 0
    for (let i = 0; i < c.length; i++) p += c[i] ** 2, q += (y[i] - c[i]) ** 2
    return Math.min(15, Math.max(0, Math.round((10 * Math.log10(p / q) - o) / 5) * 5)) + o
  })
  for (let snr of [...new Set(at)].sort((a, b) => a - b))
    report(`${set}, input SNR ${snr} dB, ${at.filter(v => v === snr).length} utterances`, res.map(([id, rows]) => [id, rows.filter((_, i) => at[i] === snr)]), keys)
}

// mean of each measure; against the first system, the paired difference ± 1.96 standard errors
function report(title, res, keys) {
  let fmt = (v, kk) => Number.isFinite(v) ? v.toFixed(kk === 'sisdr' || kk === 'SDR' ? 2 : 3) : '–'
  let ci = (a, b, kk) => {
    let d = a.map((r, i) => r[kk] - b[i][kk]).filter(Number.isFinite), m = mean(d), s = Math.sqrt(d.reduce((t, v) => t + (v - m) ** 2, 0) / (d.length - 1))
    return `${m >= 0 ? '+' : '−'}${Math.abs(m).toFixed(3)}±${(1.96 * s / Math.sqrt(d.length)).toFixed(3)}`
  }
  console.log(`\n${title}\n`)
  console.log(table(['system', ...keys], res.map(([id, rows], j) => [id, ...keys.map(kk => {
    let v = mean(rows.map(r => r[kk]).filter(Number.isFinite))
    return fmt(v, kk) + (j ? ` (${ci(rows, res[0][1], kk)})` : '')
  })])))
}

// ---- music ----
const LEAD = 1.5, TAIL = 1, SR = 44100, SNRS = [10, 25], NOISES = ['hiss', 'pink', 'room', 'machine']
const f32 = p => { let b = readFileSync(p); return new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)) }

function musdbTrain() {
  let src = path.join(DATA, 'musdb', 'train'), out = path.join(DATA, 'musdb', 'train-mono')
  mkdirSync(out, { recursive: true })
  return readdirSync(src).filter(f => f.endsWith('.stem.mp4')).sort().slice(0, 12).map((f, i) => {
    let o = path.join(out, `${String(i).padStart(2, '0')}.f32`)
    if (!existsSync(o)) spawnSync('ffmpeg', ['-v', 'error', '-i', path.join(src, f), '-map', '0:0', '-ac', '1', '-ar', '44100', '-f', 'f32le', o])
    return [`musdb-train-${i}`, () => f32(o)]
  })
}
function music(split) {
  if (split === 'train') return musdbTrain()
  let mus = path.join(DATA, 'musdb', 'test-mono'), rep = path.join(DATA, 'repair')
  return [
    ...readdirSync(mus).filter(f => f.endsWith('.f32')).sort().slice(0, 20).map(f => [`musdb-${f.slice(0, -4)}`, () => f32(path.join(mus, f))]),
    ...['brahms', 'nutcracker', 'vibeace', 'trumpet'].map(r => [r, () => { let x = f32(path.join(rep, r + '.f32')); return r === 'trumpet' ? x : x.slice(5 * SR, 15 * SR) }]),
  ]
}

// Gaussian by Box–Muller on the seeded generator; pink by Kellet's filter (as @audio/denoise's scripts/speech.mjs)
function gauss(n, seed) { let r = lcg(seed), x = new Float32Array(n); for (let i = 0; i < n; i++) x[i] = Math.sqrt(-2 * Math.log(1 - r())) * Math.cos(2 * Math.PI * r()); return x }
function pink(n, seed) {
  let w = gauss(n, seed), x = new Float32Array(n), b = [0, 0, 0, 0, 0, 0, 0]
  for (let i = 0; i < n; i++) {
    let v = w[i]
    b[0] = 0.99886 * b[0] + v * 0.0555179; b[1] = 0.99332 * b[1] + v * 0.0750759; b[2] = 0.969 * b[2] + v * 0.153852
    b[3] = 0.8665 * b[3] + v * 0.3104856; b[4] = 0.55 * b[4] + v * 0.5329522; b[5] = -0.7616 * b[5] - v * 0.016898
    x[i] = b[0] + b[1] + b[2] + b[3] + b[4] + b[5] + b[6] + v * 0.5362; b[6] = v * 0.115926
  }
  return x
}
const DEMAND = { room: 'OHALLWAY', machine: 'DWASHING' }, demandAt = {}
async function demand(kind) {
  if (demandAt[kind]) return demandAt[kind]
  let file = path.join(DIR, 'noise', `${DEMAND[kind]}-${SR}.f32`)
  if (!existsSync(file)) {
    let { ch, sr } = readWav(path.join(DATA, 'demand', DEMAND[kind], 'ch01.wav'))
    let [y] = await audio.from([ch[0]], { sampleRate: sr }).resample(SR).read()
    mkdirSync(path.dirname(file), { recursive: true }); writeFileSync(file, Float32Array.from(y))
  }
  return demandAt[kind] = f32(file)
}
async function noise(kind, n, seed, split) {
  if (kind === 'hiss') return gauss(n, seed)
  if (kind === 'pink') return pink(n, seed)
  let rec = await demand(kind), half = rec.length >> 1, o = Math.floor(lcg(seed)() * (half - n)) + (split === 'test' ? half : 0)
  return rec.slice(o, o + n)
}
const power = x => x.reduce((s, v) => s + v * v, 0) / x.length
function active(x) {
  let L = Math.round(0.02 * SR), p = []
  for (let i = 0; i + L <= x.length; i += L) p.push(power(x.subarray(i, i + L)))
  let mx = Math.max(...p), a = p.filter(v => v > mx * 1e-4)
  return mean(a)
}

// The noise-to-mask ratio of y against s over [a, b), after ITU-R BS.1387-1's FFT ear model (PEAQ, basic version, as
// Kabal 2002 reads it): 2048-point Hann frames half overlapping, a full-scale sine at 92 dB SPL, the outer and middle
// ear's weighting, the power in 0.25-Bark bands from 80 Hz to 18 kHz (z = 7 asinh(f/650)); the mask is the reference's
// band energies with the ear's internal noise, spread over Bark (27 dB/Bark down, 24 + 230/f − 0.2 L dB/Bark up) and
// lowered by the masking offset (3 dB to 12 Bark, 0.25 z dB above); the noise is the weighted (|Y| − |S|)² per bin.
// NMR = 10 log10 of the mean over frames of the mean over bands of noise over mask: under 0 dB the error is masked.
// The spreading adds powers (the standard adds them at exponent 0.4) and nothing is spread over time.
const nmr = (() => {
  const N = 2048, K = N / 2 + 1, fk = k => k * SR / N, bark = f => 7 * Math.asinh(f / 650), z0 = bark(80), dz = 0.25
  const B = Math.ceil((bark(18000) - z0) / dz), band = Int32Array.from({ length: K }, (_, k) => { let b = Math.floor((bark(fk(k)) - z0) / dz); return b >= 0 && b < B ? b : -1 })
  const zc = Float64Array.from({ length: B }, (_, b) => z0 + (b + 0.5) * dz), fc = zc.map(z => 650 * Math.sinh(z / 7))
  const spl = 10 ** 9.2 / (N / 4) ** 2  // a full-scale sine's peak bin through the Hann window: 92 dB SPL
  const W = Float64Array.from({ length: K }, (_, k) => { let x = Math.max(fk(k), 20) / 1000; return spl * 10 ** ((-2.184 * x ** -0.8 + 6.5 * Math.exp(-0.6 * (x - 3.3) ** 2) - 1e-3 * x ** 3.6) / 10) })
  const ein = fc.map(f => 10 ** (1.456 * (f / 1000) ** -0.8 / 10)), off = zc.map(z => 10 ** (-(z <= 12 ? 3 : 0.25 * z) / 10))
  const mags = (x, a, b) => { let out = []; stftAnalyse(x.subarray(a, b), m => out.push(Float64Array.from(m)), { frameSize: N, hopSize: N / 2 }); return out }
  return (s, y, a, b) => {
    let S = mags(s, a, b), Y = mags(y, a, b), E = new Float64Array(B), Q = new Float64Array(B), sum = 0
    for (let f = 0; f < S.length; f++) {
      E.set(ein); Q.fill(0)
      for (let k = 0; k < K; k++) if (band[k] >= 0) E[band[k]] += W[k] * S[f][k] ** 2, Q[band[k]] += W[k] * (Y[f][k] - S[f][k]) ** 2
      let r = 0
      for (let i = 0; i < B; i++) {
        let m = 0
        for (let j = 0; j < B; j++) {
          let d = zc[i] - zc[j]
          m += E[j] * 10 ** (-(d >= 0 ? d * Math.max(24 + 230 / fc[j] - 0.2 * 10 * Math.log10(E[j]), 0) : -d * 27) / 10)
        }
        r += Q[i] / (m * off[i])
      }
      sum += r / B
    }
    return 10 * Math.log10(sum / S.length)
  }
})()

// power spectra of 1024-point Hann frames (hop 256) over [a, b) samples
function spectra(x, a, b) { let out = []; stftAnalyse(x.subarray(a, b), mag => out.push(Float64Array.from(mag, v => v * v)), { frameSize: 1024, hopSize: 256 }); return out }
const kurt = P => { let s1 = 0, s2 = 0, n = 0; for (let f of P) for (let k = 3; k <= 372; k++) s1 += f[k], s2 += f[k] * f[k], n++; return (s2 / n) / (s1 / n) ** 2 }  // 100 Hz–16 kHz
function measures(s, nz, yp, ym, a, b) {
  let n = s.length, sh = new Float32Array(n), nh = new Float32Array(n)
  for (let i = 0; i < n; i++) sh[i] = (yp[i] + ym[i]) / 2, nh[i] = (yp[i] - ym[i]) / 2
  let e = (x, y, i0, i1) => { let p = 0, q = 0; for (let i = i0; i < i1; i++) p += x[i] ** 2, q += (y[i] - x[i]) ** 2; return 10 * Math.log10(p / q) }
  let pw = (x, i0, i1) => power(x.subarray(i0, i1))
  let S = spectra(s, a, b), Sh = spectra(sh, a, b), cut = 0, tot = 0, hfS = 0, hfH = 0, k8 = Math.round(8000 / SR * 1024)
  for (let f = 0; f < S.length; f++) for (let k = 0; k <= 512; k++) {
    tot += S[f][k]; if (Sh[f][k] < S[f][k] * 10 ** -0.3) cut += S[f][k]
    if (k >= k8) hfS += S[f][k], hfH += Sh[f][k]
  }
  let t0 = b, t1 = n
  return {
    SDR: e(s, yp, a, b), NMR: nmr(s, yp, a, b), 'ΔSNR': 10 * Math.log10(pw(sh, a, b) / pw(nh, a, b)) - 10 * Math.log10(pw(s, a, b) / pw(nz, a, b)),
    music: e(s, sh, a, b), 'cut %': 100 * cut / tot, HF: 10 * Math.log10(hfH / hfS),
    'MN mus.': Math.log(kurt(spectra(nh, a, b)) / kurt(spectra(nz, a, b))),
    'MN tail': Math.log(kurt(spectra(nh, t0, t1)) / kurt(spectra(nz, t0, t1))), 'NR tail': 10 * Math.log10(pw(nz, t0, t1) / pw(nh, t0, t1)),
  }
}

async function musicRun(split, ids, k, n, clean) {
  let items = music(split).filter((_, i) => i % n === k), rows = Object.fromEntries(ids.map(id => [id, {}]))
  let conds = clean ? ['clean'] : NOISES.flatMap(nk => SNRS.map(snr => `${nk} ${snr}`))
  for (let id of ids) {
    let cache = path.join(DIR, clean ? 'clean' : 'music', split, dirOf(id) + '.json'), sys = system(id)
    let have = existsSync(cache) ? JSON.parse(readFileSync(cache)) : {}
    for (let [j, [name, get]] of items.entries()) for (let cond of conds) {
      let key = `${name} ${cond}`
      if (have[key]) continue
      let m = get(), a = Math.round(LEAD * SR), b = a + m.length, len = b + TAIL * SR, s = new Float32Array(len)
      s.set(m, a)
      if (clean) {
        let y = (await sys({ ch: [m], sr: SR }, LEAD)).ch[0], z = new Float32Array(len)
        z.set(y, a)
        let r = measures(s, new Float32Array(len).fill(1e-9), z, z, a, b)
        have[key] = { SDR: r.SDR, NMR: r.NMR, 'cut %': r['cut %'], HF: r.HF }
      } else {
        let [nk, snr] = cond.split(' '), seed = 1 + j * 97 + NOISES.indexOf(nk) * 13 + +snr
        let nz = await noise(nk, len, seed, split), g = Math.sqrt(active(m) / power(nz) / 10 ** (+snr / 10))
        for (let i = 0; i < len; i++) nz[i] *= g
        let yp = (await sys({ ch: [s.map((v, i) => v + nz[i])], sr: SR }, LEAD)).ch[0]
        let ym = (await sys({ ch: [s.map((v, i) => v - nz[i])], sr: SR }, LEAD)).ch[0]
        have[key] = measures(s, nz, yp, ym, a, b)
      }
      save(cache, have)
    }
    for (let [name] of items) for (let cond of conds) rows[id][`${name} ${cond}`] = have[`${name} ${cond}`]
  }
  let keys = clean ? ['SDR', 'NMR', 'cut %', 'HF'] : ['SDR', 'NMR', 'ΔSNR', 'music', 'cut %', 'HF', 'MN mus.', 'MN tail', 'NR tail']
  for (let cond of [...conds, ...(clean ? [] : ['all'])]) {
    let res = ids.map(id => [id, Object.entries(rows[id]).filter(([key]) => cond === 'all' || key.endsWith(' ' + cond)).map(([, r]) => r)])
    report(`${split}, ${cond}, ${res[0][1].length} items`, res, keys)
  }
}

let [mode, set, list, shard = '0/1'] = process.argv.slice(2), [k, n] = shard.split('/').map(Number)
let ids = (list || '').split(';').map(s => s.trim()).filter(Boolean)
if (mode === 'speech' && SPEECH[set] && ids.length) await speech(set, ids, k, n)
else if ((mode === 'music' || mode === 'clean') && (set === 'train' || set === 'test') && ids.length) await musicRun(set, ids, k, n, mode === 'clean')
else console.log('usage: node bench/rx/denoise.mjs speech train|test|train-clean|test-clean "SYSTEM;..." [K/N] | music|clean train|test "SYSTEM;..." [K/N]')
py?.stdin.end()
