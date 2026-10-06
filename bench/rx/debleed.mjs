// De-bleed against iZotope RX 12: RX's De-bleed plugin beside `audio`'s debleed() on bleed made from real recordings
// (the wanted sound known), and on the wanted sound alone (what each does where nothing bleeds).
//
//   node bench/rx/debleed.mjs [test|tune]          SHARD=i/n: render every n-th job from the i-th into the cache only
//
// What RX gets. RX 12's De-bleed plugin has no reference input: one bus in, one out (VST3 with every bus enabled, 2
// channels in; the AU, `auval -v aufx rDB2 iZtp`: one input element). Its algorithm is a trained separator that keeps
// the instrument one picks (Vocals, Snare, Kick, Toms, Cymbals, Drums, Guitar, Piano) and turns the rest down, by the
// De-bleed amount (%). The reference-driven algorithm, Classic, is "a feature of the De-Bleed module in the RX Audio
// Editor" (the plugin's own warning): set through the plugin's state (DeBleedAlgorithm 1) in a host that offers a
// sidechain (DawDreamer 0.9, 4 inputs), the plugin passes its input through sample for sample, latency 0. The Editor
// has no scripting and its controls can't be driven here, so Classic is not measured. RX gets the mic alone; ours gets
// the mic and the bleeding source's own track, as `audio` takes it: a.debleed({ key }), whole file (two passes).
//
// Material, mono; speech at 48 kHz, music at 44.1 kHz. test: VoiceBank's test speakers p232 and p257 (Valentini-
// Botinhao 2017, CC BY 4.0, doi:10.7488/ds/2117), Spoken Wikipedia narrations (spoken/, CC BY-SA), MUSDB18's test
// previews (Rafii et al. 2017; the 7 s previews, two songs back to back), MIT IR Survey rooms (Traer & McDermott, PNAS
// 2016) odd-numbered. tune, the only set any setting is chosen on: VoiceBank's training speakers, spoken-train/,
// MUSDB18's train previews, the even-numbered rooms. Songs are taken in order where both stems sound in at least half
// of their 50 ms frames (within 30 dB of their loudest). Each case, wanted ← bleeding source (RX's instrument):
//   click   a voice (narration, VoiceBank) ← a click track (1.5 kHz, 2.2 kHz on the downbeat, 90–140 BPM)   Vocals
//   cohost  a voice ← a co-host's voice (VoiceBank), each mic hearing the other: the reference holds the host too  Vocals
//   drums   MUSDB18 vocals ← the song's drums                                                              Vocals
//   phones  MUSDB18 vocals ← the song's backing (drums, bass, other) leaking from the singer's headphones     Vocals
//   other   MUSDB18 vocals ← the song's "other" stem (guitars, keys)                                       Vocals
//   guitar  MUSDB18 "other" ← the song's drums (the kit in a guitar or keys mic)                            Guitar
//   kit     MUSDB18 drums ← the song's vocals (the singer in the overheads)                                Drums
// The mic hears y = w + g·(h ∗ r) + its own noise (−65 dB): w and r at one active level (RMS over 50 ms frames
// within 30 dB of the loudest), g = −30, −18 or −6 dB, h a room response (lead-in cut to 1 ms before its peak, unit
// energy) 1–30 ms away; phones: 0.5–1.5 ms away, the direct leak plus 0.3 of the room, high-passed at 150 Hz (a
// headphone's small drivers radiate little bass; an assumption, not a measurement). The reference: a click or a
// backing track exactly as played, at its own gain (±6 dB); a source's own mic at its own gain, a ±3 dB tilt about
// 1 kHz and its own noise (−50 dB), the co-host's mic hearing the host as the host's hears the co-host. static: that
// path held; moving: the source sways (the delay ±0.5 ms over 6–10 s), its gain drifts ±1.5 dB over 8–12 s, and a
// second room comes in, 30 % by the end (as @audio/denoise scripts/debleed.js). Two takes per case, level and path,
// 14 s each, every one with its own room, delay and gains (lcg seeds); harm: each case's wanted sound alone, its
// source's track present but never heard by the mic.
//
// Measures. Each system runs on (w + b, x) and on (w − b, x with the source's part inverted); by phase inversion
// (Hagerman & Olofsson, Acta Acustica 2004) b̂ = (y₊ − y₋)/2 is the bleed left: removed = 10·log10(Σb² / Σb̂²) (RX's
// separator is not linear, so for it the split is approximate). The wanted sound: SI-SDR of y₊ against w (Le Roux et
// al., ICASSP 2019; lib.mjs `sisdr`), everything the output still differs by, bleed and damage alike; the input's
// beside it. Harm: the error added to the wanted sound alone, 10·log10(Σ(y − w)² / Σw²). Cells are means over takes.
//
// RX at its defaults (De-bleed 20 %, the instrument kept: Vocals, its default, for the voice cases, Guitar and Drums
// for those two) and tuned: per case and bleed level the amount of 20, 40, 60, 80, 100 % (guitar: Guitar or Piano)
// of the best mean SI-SDR on tune, both paths (`node bench/rx/debleed.mjs tune`, scores in tune.*.jsonl). Ours at
// its defaults. Scores are kept in ~/.cache/audiojs/data/rx/debleed/<split>.*.jsonl, ours by the package's version and
// a hash of its kernel (so an earlier version's rows stay), the sources decoded in src/.

import { readFileSync, readdirSync, existsSync, mkdirSync, appendFileSync, renameSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fft, ifft } from 'fourier-transform'
import audio from '../../audio.js'
import { DATA, OUT, rx, readWav, lcg, sisdr, mean, table } from './lib.mjs'

const args = process.argv.slice(2), split = args.includes('tune') ? 'tune' : 'test', test = split === 'test'
const HOME = path.join(OUT, 'debleed'), SRC = path.join(HOME, 'src')
const [shard, shards] = (process.env.SHARD || '0/1').split('/').map(Number), rendering = !!process.env.SHARD
const LEVELS = [-30, -18, -6], CONDS = ['static', 'moving'], TAKES = 2, DUR = 14, AMOUNTS = [20, 40, 60, 80, 100]
const CASES = {
  click: { inst: 'Vocals', ref: 'track' }, cohost: { inst: 'Vocals', ref: 'mic' }, drums: { inst: 'Vocals', ref: 'mic' },
  phones: { inst: 'Vocals', ref: 'track' }, other: { inst: 'Vocals', ref: 'mic' }, guitar: { inst: 'Guitar', ref: 'mic', alt: ['Piano'] },
  kit: { inst: 'Drums', ref: 'mic' },
}
const BEFORE = 'ours-0.2.0-58bad672'   // ours as published before this bench (npm 0.2.0): its rows read from the cache

// RX at the best of the grid on tune, per case and bleed level −30 / −18 / −6 dB (`node bench/rx/debleed.mjs tune`,
// 2026-10-06)
const V = a => ({ instrument: 'Vocals', de_bleed: a }), TUNED = {
  click: [V(20), V(40), V(80)], cohost: [V(20), V(20), V(20)], drums: [V(100), V(100), V(100)], phones: [V(40), V(60), V(80)],
  other: [V(80), V(100), V(100)], guitar: Array(3).fill({ instrument: 'Guitar', de_bleed: 20 }),
  kit: [{ instrument: 'Drums', de_bleed: 20 }, { instrument: 'Drums', de_bleed: 100 }, { instrument: 'Drums', de_bleed: 100 }],
}

// ---- material
const f32 = file => { let b = readFileSync(file); return new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)) }
function decode(args, file) {
  if (!existsSync(file)) {
    mkdirSync(path.dirname(file), { recursive: true })
    let part = `${file}.${process.pid}.part`, r = spawnSync('ffmpeg', ['-v', 'error', '-y', ...args, '-f', 'f32le', part])
    if (r.status) throw new Error(`ffmpeg: ${r.stderr}`)
    renameSync(part, file)
  }
  return f32(file)
}
const sorted = (dir, ext) => readdirSync(dir).filter(f => f.endsWith(ext)).sort()
const frames = (x, fs) => { let L = Math.round(0.05 * fs), p = []; for (let i = 0; i + L <= x.length; i += L) { let s = 0; for (let j = i; j < i + L; j++) s += x[j] * x[j]; p.push(s / L) } return p }
const active = (x, fs) => { let p = frames(x, fs), mx = Math.max(...p), a = p.filter(v => v > mx * 1e-3); return Math.sqrt(mean(a)) }
const busy = (x, fs) => { let p = frames(x, fs), mx = Math.max(...p); return mx > 0 ? p.filter(v => v > mx * 1e-3).length / p.length : 0 }
const scale = (x, k) => x.map(v => v * k)
const add = (...xs) => Float32Array.from(xs[0], (_, i) => xs.reduce((s, x) => s + x[i], 0))

const IRS = sorted(path.join(DATA, 'mit-ir', 'Audio'), '.wav')
function ir(i, fs) {
  let h = decode(['-i', path.join(DATA, 'mit-ir', 'Audio', IRS[i]), '-ac', '1', '-ar', String(fs)], path.join(SRC, `ir-${i}-${fs}.f32`)), pk = 0
  for (let k = 0; k < h.length; k++) if (Math.abs(h[k]) > Math.abs(h[pk])) pk = k
  return unit(h.slice(Math.max(0, pk - Math.round(fs / 1000))))
}
const unit = h => scale(h, 1 / Math.sqrt(h.reduce((s, v) => s + v * v, 0)))

const vbDir = test ? path.join(DATA, 'vbdemand', 'clean_testset_wav') : path.join(DATA, 'vbdemand-train', 'clean')
const SPK = (() => { let s = {}; for (let f of sorted(vbDir, '.wav')) (s[f.split('_')[0]] ??= []).push(f); return s })(), SPKS = Object.keys(SPK)
function talk(spk, R, gap, skip) {   // a speaker's utterances in turn, each followed by a gap, 48 kHz
  let files = SPK[spk], n = DUR * 48000, y = new Float32Array(n), at = Math.round(R() * gap[1] * 48000)
  for (let i = skip; at < n; i++) {
    let { ch: [x], sr } = readWav(path.join(vbDir, files[i % files.length]))
    if (sr !== 48000) throw new Error(`VoiceBank at ${sr} Hz`)
    y.set(x.subarray(0, Math.min(x.length, n - at)), at); at += x.length + Math.round((gap[0] + R() * (gap[1] - gap[0])) * 48000)
  }
  return y
}
function narration(i, from) {
  let dir = path.join(DATA, test ? 'spoken' : 'spoken-train'), f = sorted(dir, '.f32')
  return f32(path.join(dir, f[i % f.length])).slice(from * 48000, (from + DUR) * 48000)
}
const MUS = { drums: 1, bass: 2, other: 3, vocals: 4 }, musDir = path.join(DATA, 'musdb', split === 'tune' ? 'train' : 'test'), SONGS = sorted(musDir, '.stem.mp4')
const stem = (i, kind) => kind === 'backing' ? add(stem(i, 'drums'), stem(i, 'bass'), stem(i, 'other'))
  : decode(['-i', path.join(musDir, SONGS[i]), '-map', `0:${MUS[kind]}`, '-ac', '1', '-ar', '44100'], path.join(SRC, `${split}-${i}-${kind}.f32`))
// two songs from the `from`-th on whose stems both sound, back to back
function songs(from, wk, rk) {
  let w = [], r = []
  for (let i = from; w.length < 2; i++) {
    let j = i % SONGS.length, a = stem(j, wk), b = stem(j, rk)
    if (busy(a, 44100) >= 0.5 && busy(b, 44100) >= 0.5) w.push(a), r.push(b)
  }
  let cat = ([a, b]) => { let z = new Float32Array(a.length + b.length); z.set(a); z.set(b, a.length); return z.subarray(0, DUR * 44100) }
  return { w: cat(w), r: cat(r), fs: 44100 }
}
function clicks(fs, R) {
  let T = 60 / (90 + R() * 50) * fs, n = DUR * fs, y = new Float32Array(n)
  for (let b = 0, t = Math.round(R() * T); t < n; b++, t = Math.round(b * T)) {
    let f = b % 4 ? 1500 : 2200
    for (let j = 0; j < 0.03 * fs && t + j < n; j++) y[t + j] += 0.5 * Math.exp(-j / (0.005 * fs)) * Math.sin(2 * Math.PI * f * j / fs)
  }
  return y
}
// the wanted sound and the source of a case's k-th take
const takes = {}
function material(c, k) {
  let key = `${c}-${k}`
  if (takes[key]) return takes[key]
  let R = rng(1000 * Object.keys(CASES).indexOf(c) + k + (test ? 0 : 500)), at = (k * 3 + Object.keys(CASES).indexOf(c) * 7) * 2
  let spk = j => SPKS[(2 * k + j + Object.keys(CASES).indexOf(c)) % SPKS.length], voice = () => k % 2 ? talk(spk(0), R, [0.2, 1.2], k * 5) : narration(k + Object.keys(CASES).indexOf(c), 20)
  let m = c === 'click' ? { w: voice(), r: clicks(48000, R), fs: 48000 }
    : c === 'cohost' ? { w: voice(), r: talk(spk(1), R, [0.3, 2.5], k * 7), fs: 48000 }
    : c === 'drums' ? songs(at, 'vocals', 'drums') : c === 'phones' ? songs(at, 'vocals', 'backing')
    : c === 'other' ? songs(at, 'vocals', 'other') : c === 'guitar' ? songs(at, 'other', 'drums') : songs(at, 'drums', 'vocals')
  return takes[key] = m
}

// ---- signal helpers
function conv(x, h) {   // overlap-add through the real FFT, x's length
  let n = 1; while (n < 2 * h.length) n <<= 1
  let B = n - h.length + 1, y = new Float64Array(x.length + n), t = new Float64Array(n)
  t.set(h); let [hr, hi] = fft(t).map(v => Float64Array.from(v))
  for (let a = 0; a < x.length; a += B) {
    t.fill(0); t.set(x.subarray(a, Math.min(x.length, a + B)))
    let [re, im] = fft(t)
    for (let k = 0; k <= n / 2; k++) { let r = re[k] * hr[k] - im[k] * hi[k]; im[k] = re[k] * hi[k] + im[k] * hr[k]; re[k] = r }
    let o = ifft(re, im); for (let i = 0; i < n; i++) y[a + i] += o[i]
  }
  return Float32Array.from(y.subarray(0, x.length))
}
function vdelay(x, d) {   // x(t − d(t)), Catmull-Rom
  let at = i => i >= 0 && i < x.length ? x[i] : 0
  return Float32Array.from(x, (_, i) => { let t = i - d(i), k = Math.floor(t), f = t - k, p0 = at(k - 1), p1 = at(k), p2 = at(k + 1), p3 = at(k + 2)
    return p1 + 0.5 * f * (p2 - p0 + f * (2 * p0 - 5 * p1 + 4 * p2 - p3 + f * (3 * (p1 - p2) + p3 - p0))) })
}
function tilt(x, t, fs) {   // ±t/2 dB either side of 1 kHz, one-pole split
  let a = Math.exp(-2 * Math.PI * 1000 / fs), lo = 0, gl = 10 ** (-t / 40), gh = 10 ** (t / 40)
  return x.map(v => { lo = (1 - a) * v + a * lo; return gl * lo + gh * (v - lo) })
}
function highpass(x, fc, fs) {   // 2nd-order Butterworth (RBJ cookbook biquad), forward
  let w = 2 * Math.PI * fc / fs, al = Math.sin(w) / Math.SQRT2, c = Math.cos(w), a0 = 1 + al
  let b0 = (1 + c) / 2 / a0, b1 = -(1 + c) / a0, a1 = -2 * c / a0, a2 = (1 - al) / a0, x1 = 0, x2 = 0, y1 = 0, y2 = 0
  return x.map(v => { let y = b0 * v + b1 * x1 + b0 * x2 - a1 * y1 - a2 * y2; x2 = x1; x1 = v; y2 = y1; y1 = y; return y })
}
// a seeded generator per seed, the seed first hashed (Wellons' lowbias32): an LCG's first draws from nearby seeds agree
const rng = s => { s ^= s >>> 16; s = Math.imul(s, 0x7feb352d); s ^= s >>> 15; s = Math.imul(s, 0x846ca68b); return lcg((s ^ s >>> 16) >>> 0) }
const noise = (n, R, k) => Float32Array.from({ length: n }, () => k * 2 * (R() + R() + R() - 1.5))

// ---- an item: the mic's take (t = w + its noise, b the bleed), the reference (xs: the source's part, xo: the rest)
function item(c, level, k, cond) {
  let ci = Object.keys(CASES).indexOf(c), R = rng(((ci * 7 + LEVELS.indexOf(level)) * 5 + k) * 3 + CONDS.indexOf(cond) + (test ? 1 : 7919))
  let { w, r, fs } = material(c, k), n = Math.min(w.length, r.length), moving = cond === 'moving', phones = c === 'phones'
  w = scale(w.subarray(0, n), 0.05 / active(w.subarray(0, n), fs)); r = scale(r.subarray(0, n), 0.05 / active(r.subarray(0, n), fs))
  let room = () => Math.floor(R() * IRS.length / 2) * 2 + (test ? 1 : 0), irA = room(), irB = room(), irC = room()
  let delay = phones ? 0.5 + R() : 1 + R() * 29
  let path_ = i => { let h = ir(i, fs); if (!phones) return h; let d = new Float32Array(h.length); d[Math.round(fs / 1000)] = 1; return unit(highpass(add(d, scale(h, 0.3)), 150, fs)) }
  let per = (6 + 4 * R()) * fs, ph = R() * 2 * Math.PI, d0 = delay * fs / 1000, sway = moving ? 0.0005 * fs : 0
  let rd = vdelay(r, i => d0 + sway * Math.sin(2 * Math.PI * i / per + ph)), bA = conv(rd, path_(irA)), bB = moving ? conv(rd, path_(irB)) : null
  let g0 = 10 ** (level / 20), gper = (8 + 4 * R()) * fs, b = new Float32Array(n)
  for (let i = 0; i < n; i++) b[i] = moving ? g0 * 10 ** (1.5 * Math.sin(2 * Math.PI * i / gper) / 20) * (bA[i] + 0.3 * i / n * (bB[i] - bA[i])) : g0 * bA[i]
  let t = add(w, noise(n, R, 0.05 * 10 ** (-65 / 20))), gr = 10 ** ((R() * 2 - 1) * 6 / 20), tl = (R() * 2 - 1) * 3
  let mic = CASES[c].ref === 'mic', xs = mic ? scale(tilt(r, tl, fs), gr) : scale(r, gr), xo = mic ? noise(n, R, gr * 0.05 * 10 ** (-50 / 20)) : new Float32Array(n)
  if (c === 'cohost') xo = add(xo, scale(tilt(conv(vdelay(w, () => (1 + R() * 29) * fs / 1000), ir(irC, fs)), tl, fs), gr * g0))
  return { id: `${c}${level}-${k}-${cond}`, c, level, k, cond, fs, t, b, xs, xo }
}
// the wanted sound alone; the source's track never heard by the mic
function alone(c, k) {
  let R = rng(Object.keys(CASES).indexOf(c) * 31 + k + (test ? 3 : 7))
  let { w, r, fs } = material(c, k), n = Math.min(w.length, r.length)
  w = scale(w.subarray(0, n), 0.05 / active(w.subarray(0, n), fs)); r = scale(r.subarray(0, n), 0.05 / active(r.subarray(0, n), fs))
  let gr = 10 ** ((R() * 2 - 1) * 6 / 20), t = add(w, noise(n, R, 0.05 * 10 ** (-65 / 20)))
  let x = CASES[c].ref === 'mic' ? add(scale(tilt(r, (R() * 2 - 1) * 3, fs), gr), noise(n, R, gr * 0.05 * 10 ** (-50 / 20))) : scale(r, gr)
  return { id: `${c}-${k}-alone`, c, k, fs, t, x }
}

// ---- systems: (mic, reference, rate) → the output, aligned
const rxs = (inst, amount) => { let f = rx('De-bleed', { instrument: inst, de_bleed: amount }); return async (m, x, fs) => (await f({ ch: [m], sr: fs })).ch[0] }
const ours = async (m, x, fs) => (await audio.from([m], { sampleRate: fs }).debleed({ key: audio.from([x], { sampleRate: fs }) }).read())[0]
const pkg = path.dirname(createRequire(import.meta.url).resolve('@audio/denoise-debleed/package.json'))
const OURS = `ours-${JSON.parse(readFileSync(path.join(pkg, 'package.json'))).version}-${createHash('sha1').update(readFileSync(path.join(pkg, 'debleed.js'))).update(readFileSync(path.join(pkg, 'audio.js'))).digest('hex').slice(0, 8)}`
const rxName = (inst, a) => `rx-${inst}-${a}`

// ---- scores: one line per item and system, kept
mkdirSync(HOME, { recursive: true })
const scores = {}
for (let f of readdirSync(HOME).filter(f => f.startsWith(split + '.') && f.endsWith('.jsonl')))
  for (let l of readFileSync(path.join(HOME, f), 'utf8').split('\n').filter(Boolean)) { let s = JSON.parse(l); scores[`${s.id}|${s.sys}`] = s }
const sink = path.join(HOME, `${split}.${process.pid}.jsonl`)
const db = x => 10 * Math.log10(x)
async function score(it, sys, run, both) {
  let key = `${it.id}|${sys}`
  if (scores[key] && (!both || scores[key].removed != null)) return scores[key]
  let s = { id: it.id, sys }
  if (it.x) {   // alone: the error added
    let y = await run(it.t, it.x, it.fs), e = 0, p = 0
    for (let i = 0; i < y.length; i++) e += (y[i] - it.t[i]) ** 2, p += it.t[i] ** 2
    s.added = e > 0 ? db(e / p) : -Infinity
  } else {
    let yp = await run(add(it.t, it.b), add(it.xs, it.xo), it.fs)
    s.out = sisdr(it.t, yp)
    if (both) {
      let ym = await run(Float32Array.from(it.t, (v, i) => v - it.b[i]), Float32Array.from(it.xs, (v, i) => it.xo[i] - v), it.fs), eb = 0, er = 0
      for (let i = 0; i < it.b.length; i++) eb += it.b[i] ** 2, er += ((yp[i] - ym[i]) / 2) ** 2
      s.removed = db(eb / er)
    }
  }
  appendFileSync(sink, JSON.stringify(s) + '\n')
  return scores[key] = s
}
const input = it => score(it, 'input', async m => m, false)

// ---- the jobs
const items = () => Object.keys(CASES).flatMap(c => LEVELS.flatMap(level => CONDS.flatMap(cond => Array.from({ length: TAKES }, (_, k) => ({ c, level, k, cond })))))
const mine = (_, j) => j % shards === shard
const fmt = v => v == null || Number.isNaN(v) ? '–' : (v >= 0 ? '' : '−') + Math.abs(v).toFixed(1)
const at = (rows, f) => fmt(mean(rows.map(f)))

if (!test) {
  // tune: RX's grid scored by SI-SDR alone; ours at its defaults, both measures
  for (let { c, level, k, cond } of items().filter(mine)) {
    let it = item(c, level, k, cond)
    await input(it)
    for (let inst of [CASES[c].inst, ...(CASES[c].alt || [])]) for (let a of AMOUNTS) await score(it, rxName(inst, a), rxs(inst, a), false)
    await score(it, OURS, ours, true)
    if (rendering) process.stderr.write('.')
  }
  if (!rendering) {
    console.log('\ntune: the wanted sound\'s SI-SDR (dB) per case and bleed level, both paths and takes pooled: the input, RX De-bleed by amount, ours at its defaults\n')
    let best = {}, rows = []
    for (let c in CASES) for (let level of LEVELS) {
      let ids = items().filter(j => j.c === c && j.level === level).map(j => `${c}${level}-${j.k}-${j.cond}`), m = sys => mean(ids.map(id => scores[`${id}|${sys}`].out))
      let cfg = [CASES[c].inst, ...(CASES[c].alt || [])].map(inst => [inst, AMOUNTS.map(a => m(rxName(inst, a)))])
      let top = cfg.flatMap(([inst, v]) => v.map((x, j) => [inst, AMOUNTS[j], x])).reduce((p, q) => q[2] > p[2] ? q : p)
      ;(best[c] ??= []).push({ instrument: top[0], de_bleed: top[1] })
      for (let [inst, v] of cfg) rows.push([`${c} ${level}${inst === CASES[c].inst ? '' : ` (${inst})`}`, fmt(m('input')),
        ...v.map((x, j) => inst === top[0] && AMOUNTS[j] === top[1] ? `**${fmt(x)}**` : fmt(x)), fmt(m(OURS))])
    }
    console.log(table(['case, level', 'input', ...AMOUNTS.map(a => `RX ${a} %`), OURS], rows))
    console.log('\nTUNED =', JSON.stringify(best))
  }
} else {
  // test: RX at its defaults and tuned, ours; both measures; then the wanted sound alone
  let tuned = (c, level) => TUNED?.[c]?.[LEVELS.indexOf(level)]
  let jobs = items().filter(mine)
  for (let { c, level, k, cond } of jobs) {
    let it = item(c, level, k, cond)
    await input(it)
    await score(it, rxName(CASES[c].inst, 20), rxs(CASES[c].inst, 20), true)
    let t = tuned(c, level); if (t) await score(it, rxName(t.instrument, t.de_bleed), rxs(t.instrument, t.de_bleed), true)
    await score(it, OURS, ours, true)
    if (rendering) process.stderr.write('.')
  }
  let lone = Object.keys(CASES).flatMap(c => Array.from({ length: TAKES }, (_, k) => ({ c, k }))).filter(mine)
  for (let { c, k } of lone) {
    let it = alone(c, k), t = tuned(c, -18)
    await score(it, rxName(CASES[c].inst, 20), rxs(CASES[c].inst, 20))
    if (t) await score(it, rxName(t.instrument, t.de_bleed), rxs(t.instrument, t.de_bleed))
    await score(it, OURS, ours)
  }
  if (!rendering) {
    let before = Object.keys(scores).some(k => k.endsWith('|' + BEFORE)) ? BEFORE : null
    let systems = c => [['RX default', l => rxName(CASES[c].inst, 20)], ['RX tuned', l => { let t = tuned(c, l); return t && rxName(t.instrument, t.de_bleed) }],
      ...(before && before !== OURS ? [[`ours ${BEFORE.split('-')[1]}`, () => before]] : []), [`ours ${OURS.split('-')[1]}`, () => OURS]]
    let get = (c, level, cond, sys) => Array.from({ length: TAKES }, (_, k) => scores[`${c}${level}-${k}-${cond}|${sys}`]).filter(Boolean)
    for (let cond of CONDS) {
      console.log(`\ntest, ${cond} path: bleed removed (dB) at a bleed of −30 / −18 / −6 dB\n`)
      let heads = systems('click').map(s => s[0])
      console.log(table(['case', ...heads], Object.keys(CASES).map(c => [c, ...systems(c).map(([, sys]) => LEVELS.map(l => { let s = sys(l); return s ? at(get(c, l, cond, s), x => x.removed) : '–' }).join(' / '))])))
      console.log(`\ntest, ${cond} path: the wanted sound's SI-SDR (dB) at a bleed of −30 / −18 / −6 dB\n`)
      console.log(table(['case', 'input', ...heads], Object.keys(CASES).map(c => [c,
        LEVELS.map(l => at(get(c, l, cond, 'input'), x => x.out)).join(' / '),
        ...systems(c).map(([, sys]) => LEVELS.map(l => { let s = sys(l); return s ? at(get(c, l, cond, s), x => x.out) : '–' }).join(' / '))])))
    }
    console.log('\ntest: the wanted sound alone, its source never heard: the error added (dB under it; RX tuned at its −18 dB setting)\n')
    console.log(table(['case', ...systems('click').map(s => s[0])], Object.keys(CASES).map(c => [c, ...systems(c).map(([, sys]) => {
      let s = sys(-18); return s ? at(Array.from({ length: TAKES }, (_, k) => scores[`${c}-${k}-alone|${s}`]).filter(Boolean), x => x.added) : '–'
    })])))
    if (TUNED) console.log('\nRX tuned (on tune): ' + Object.entries(TUNED).map(([c, t]) => `${c} ${t.map(s => (s.instrument !== CASES[c].inst ? s.instrument + ' ' : '') + s.de_bleed + ' %').join(' / ')}`).join('; '))
  }
}
