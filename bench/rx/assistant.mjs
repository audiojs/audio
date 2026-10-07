// iZotope RX 12 Repair Assistant against `audio`'s auto() (@audio/chain): takes with several defects at once, each
// made on a clean recording, so the repair is scored against what was there before the damage.
//
//   node bench/rx/assistant.mjs tune            RX's modules tuned on the tuning split (settings kept in rx-tuned.json)
//   node bench/rx/assistant.mjs test            the test split: input, RX defaults, RX tuned, RX oracle, ours
//   node bench/rx/assistant.mjs ours [SPLIT]    ours alone (the chain this file resolves, and CHAIN_BEFORE's)
//   node bench/rx/assistant.mjs router [SPLIT]  what ours' plan turns on per defect: recall, false alarms
//   node bench/rx/assistant.mjs report SPLIT LABELS  kept scores by label (comma-separated; VERSUS=a,b pairs two), nothing rendered
//   node bench/rx/assistant.mjs takes [SPLIT]   the takes: defects and their settings
//   node bench/rx/assistant.mjs wav SPLIT NAME  one take, its reference and ours' output as WAV (listening)
//   RX_WORKERS=2 plugin hosts, SCORERS=1 scoring processes, TAKES=regex (a subset, by name), SHARD=k/n (every nth
//   take from the kth, its scores in a file of their own: shards run in parallel processes), CHAIN=path/to/chain.js
//   (default: @audio/chain as audio resolves it), CHAIN_BEFORE=path/to/chain.js (the build compared against), NEURAL=0
//   (ours without its neural denoise stage: chain's own, as auto() runs without @audio/neural-denoise).
// Scores are kept per system (~/.cache/audiojs/data/rx/assistant/<split>/<system>.json), not renders (but declip's, by
// its code and input: minutes a take). A system's label carries a hash of its sources (ours: chain.js and the files of
// the packages it calls), so a changed build is measured again and the others are read back.
//
// Material (~/.cache/audiojs/data), tuning / test, mono:
//   speech     VoiceBank clean (Valentini-Botinhao et al. 2016/2017, CC BY 4.0): four consecutive utterances of one
//              speaker joined by 20 ms equal-power crossfades (~12 s), every 3rd group of the 28 training speakers /
//              every 4th of the test speakers p232, p257; Spoken Wikipedia readings (Köhn, Stegen, Baumann, LREC 2016,
//              CC BY-SA), 20 s from 5 s and from 30 s in, spoken-train/ / spoken/, those with mains hum of their own left
//              out (bench/rx/dehum.mjs's OWN). Active level (20 ms frames within 40 dB of the loudest) set to −26 dBFS.
//   music      MUSDB18 previews (Rafii et al. 2017; mixes, 7 s, mono): every 3rd training song / every 2nd test song,
//              and for test 20 s of the four pieces @audio/denoise's scripts/repair.js reads. RMS set to −20 dBFS.
// Each clip makes three takes: clean; one defect (the kinds in turn over the clips); two to four defects at random.
// Defects, seeded per take (lcg), in the order a recording meets them (the reference: the clean clip, or its early
// sound in the room):
//   reverb     (speech) a MIT IR Survey room (Traer & McDermott, PNAS 2016; even-numbered responses tune, odd test) whose
//              first 50 ms stand under 12 dB over the rest (a tail to hear), aligned to its direct peak (2 ms kept
//              before), as @audio/denoise's scripts/dereverb.py picks them; the reference is the clean clip through the
//              first 52 ms (the early sound, as the room colours the target), both scaled so it carries the clip's energy
//   sibilance  (speech, before the room: the speaker's) the sibilant runs' 4–10 kHz band 4–12 dB up (bench/rx/deess.mjs)
//   plosive    (speech, at the microphone) pops at six in ten stop bursts, 20–80 ms pressure pulses under 200 Hz
//              (bench/rx/deplosive.mjs)
//   noise      steady: white, pink (Kellet), brown (leaky-integrated white: most of its power under 63 Hz, as DEMAND's
//              bus and office noise in VoiceBank+DEMAND's test set) or rumble (white through a 4th-order 150 Hz
//              low-pass: an engine's, a building's); speech 5–25 dB under the active level, music 15–35 dB under its RMS
//   demand     DEMAND (Thiemann, Ito, Vincent, ICA 2013) washing machine, field, park, river, hallway (ch01; a stretch of
//              the first half for tune, the second for test; as recorded at 48 kHz, sample for sample at 44.1); speech
//              0–20 dB under, music 10–25 dB under
//   hum        mains (h = 1…12 at 1/h) or buzz (odd h at h^−½, even at 0.3·h^−½, rolled off over 3 kHz, to 8 kHz;
//              Whitlock, Jensen AN-004, 1995), 50 or 60 Hz + 0–0.03 Hz, wandering ±0.05 Hz over ~4 s; 20–35 dB under
//              speech, 25–40 dB under music
//   clicks     ticks (2–8 kHz, 0.05–0.3 ms decay) and pops (0.3–1.5 kHz, 0.3–1 ms) 1–4 a second, 3–10× the RMS
//              ±10 ms around (@audio/chain's scripts/plan.js's)
//   clip       the take driven into hard rails at the level leaving it 3–15 dB SDR from itself (the declipping
//              survey's clip_sdr, Záviška et al., IEEE JSTSP 15(1), 2021), the rails at full scale
//
// Systems. RX: Repair Assistant (RX 12 Advanced, VST3, hosted here: a new instance per render), Voice for speech and
// Music for music. Offline it renders what it is set to: its analysis is the Learn of its window (no parameter, no
// message), its state after a render (JUCE base64 → zlib → JSON) holds nothing learned but De-hum's harmonics, zero.
// So: defaults (the input back: Voice −136 dB, Music bit for bit once aligned); tuned: every module's setting chosen
// on the tuning takes that carry its defect (PESQ; music: ODG), then on for every take each module whose dropping
// lowers the mean over the takes of every 3rd tuning clip; oracle: the tuned modules switched on by the take's own defects, what a
// perfect analysis would set.
// De-hum runs only on learned harmonics, and there is no de-plosive module: hum and pops stay for RX. Its delay changes
// with its settings and is not all reported (Music: 1074 samples over it at 48 kHz), so each render is aligned to its
// input by cross-correlation (lag within ±2^15), the input mirrored 2^15 samples either side so that none is lost to a
// delay the host takes off and the plugin does not have. Ours: @audio/chain's analyze → plan → apply as auto({ type }) runs it,
// `type` speech or music, a speech bed's denoise stage DeepFilterNet3's where @audio/neural-denoise is installed (fn/auto.js);
// and its repair alone: the recipe without its mastering stages (eq, multiband, width, gain, limiter), RX's scope.
//
// Measures, against the reference. Speech (16 kHz, scipy resample_poly): PESQ (ITU-T P.862.2 wideband, python-pesq),
// STOI (Taal et al. 2011, pystoi), SI-SDR (Le Roux et al. 2019) against the reference through the system's own tone
// filters (ours: its highpass and EQ, bench/speech.py's --lin: a filter's phase shift is a timbre choice, not damage),
// DNSMOS P.835 SIG/BAK/OVRL (bench/speech.py's, the output at −26 LUFS). Music: SI-SDR as for speech, at the take's
// rate; PEAQ Basic (ITU-R BS.1387, bench/rx/peaq.py): ODG and its total noise-to-mask ratio (TotalNMRB, dB; Brandenburg
// 1987's NMR), the output gain-matched to the reference (least squares), the reference at −20 dBFS RMS. Clean takes:
// what each changes, SDR of the output against its input (∞: untouched).
import { readFileSync, readdirSync, existsSync, mkdirSync, writeFileSync, unlinkSync, realpathSync } from 'node:fs'
import { spawn, spawnSync } from 'node:child_process'
import { createInterface } from 'node:readline'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { cfft, cifft } from 'fourier-transform'
import { readWav, writeWav, lcg, mean, median, table, DATA, OUT as RXOUT } from './lib.mjs'
import { sos, lp4 } from './voice.mjs'
import lufsFn from '@audio/loudness-lufs'
import truepeakFn from '@audio/loudness-truepeak'
import { harsh } from './deess.mjs'
import { addPops } from './deplosive.mjs'
import { planned, denoise, NEURAL } from '../../fn/auto.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const OUT = path.join(RXOUT, 'assistant'), PY = process.env.RX_PYTHON || path.join(os.homedir(), '.cache', 'audiojs', 'venv', 'bin', 'python')
const E = (x, a = 0, b = x.length) => { let s = 0; for (let i = a; i < b; i++) s += x[i] * x[i]; return s }
const db = v => 10 * Math.log10(v)
const gauss = r => Math.sqrt(-2 * Math.log(r() || 1e-12)) * Math.cos(2 * Math.PI * r())
const uni = (r, a, b) => a + (b - a) * r()
const f32 = p => { let b = readFileSync(p); return new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)) }
const ls = (d, ext) => existsSync(d) ? readdirSync(d).filter(f => f.endsWith(ext)).sort() : []
const seedOf = s => { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return h >>> 0 }

// ---- clips
// parts joined by 20 ms equal-power crossfades (bench/rx/voice.mjs's reels)
function join(parts, sr) {
  let F = Math.round(0.02 * sr), x = new Float32Array(parts.reduce((s, p) => s + p.length, 0) - F * (parts.length - 1)), o = 0
  for (let c of parts) {
    if (o) for (let i = 0; i < F; i++) x[o + i] = x[o + i] * Math.cos(Math.PI / 2 * (i + 0.5) / F) + c[i] * Math.sin(Math.PI / 2 * (i + 0.5) / F)
    x.set(o ? c.subarray(F) : c, o ? o + F : 0); o += c.length - F
  }
  return x
}
function voicebank(split) {
  let dir = path.join(DATA, split === 'tune' ? 'vbdemand-train/clean' : 'vbdemand/clean_testset_wav'), groups = [], cur = []
  for (let f of ls(dir, '.wav')) { if (cur.length && (cur.length === 4 || f.split('_')[0] !== cur[0].split('_')[0])) groups.push(cur), cur = []; cur.push(f) }
  if (cur.length) groups.push(cur)
  return groups.filter((_, i) => i % (split === 'tune' ? 3 : 4) === 0)
    .map(g => ({ name: `vb-${g[0].slice(0, -4)}`, src: 'speech', get: () => ({ x: join(g.map(f => readWav(path.join(dir, f)).ch[0]), 48000), sr: 48000 }) }))
}
const OWN = ['2011-1943_The_Battle_of_Midway', '2016-Adelaide_article', 'En_Tenet__Film__article', 'Insider_trading', 'Red_vs_Blue_Part_2']
function narrations(split) {
  let dir = path.join(DATA, split === 'tune' ? 'spoken-train' : 'spoken')
  return ls(dir, '.f32').filter(f => !OWN.includes(f.slice(0, -4))).flatMap(f => [5, 30].map(t => ({
    name: `nr-${f.slice(0, 20)}-${t}`, src: 'narration', get: () => ({ x: f32(path.join(dir, f)).slice(t * 48000, (t + 20) * 48000), sr: 48000 })
  })))
}
function music(split) {
  let dir = path.join(DATA, 'musdb', `${split === 'tune' ? 'train' : 'test'}-mono`), out = ls(dir, '.f32').filter((_, i) => i % (split === 'tune' ? 3 : 2) === 0)
    .map(f => ({ name: `musdb-${f.slice(0, -4)}`, src: 'music', get: () => ({ x: f32(path.join(dir, f)), sr: 44100 }) }))
  if (split === 'test') for (let k of ['vibeace', 'brahms', 'nutcracker', 'trumpet']) {
    let p = path.join(DATA, 'repair', `${k}.f32`)
    if (existsSync(p)) out.push({ name: k, src: 'music', get: () => { let x = f32(p), s = x.length > 40 * 44100 ? 5 * 44100 : 0; return { x: x.slice(s, s + 20 * 44100), sr: 44100 } } })
  }
  return out
}
// active level: mean power of the 20 ms frames within 40 dB of the loudest (@audio/chain's scripts/plan.js)
function asl(x, sr) {
  let L = Math.round(0.02 * sr), p = []
  for (let i = 0; i + L <= x.length; i += L) p.push(E(x, i, i + L) / L)
  let mx = Math.max(...p), a = p.filter(v => v > mx * 1e-4)
  return a.reduce((s, v) => s + v, 0) / a.length
}

// ---- defects
export const KINDS = { speech: ['noise', 'demand', 'hum', 'clicks', 'clip', 'reverb', 'sibilance', 'plosive'], music: ['noise', 'demand', 'hum', 'clicks', 'clip'] }
const ORDER = ['sibilance', 'reverb', 'plosive', 'noise', 'demand', 'hum', 'clicks', 'clip']

// FFT convolution of x with each of hs, the first n samples from `from`
function convolve(x, hs, from, n) {
  let m = Math.max(...hs.map(h => h.length)), N = 2 ** Math.ceil(Math.log2(x.length + m)), xr = new Float64Array(N), xi = new Float64Array(N)
  xr.set(x); cfft(xr, xi)
  return hs.map(h => {
    let hr = new Float64Array(N), hi = new Float64Array(N); hr.set(h); cfft(hr, hi)
    for (let k = 0; k < N; k++) { let a = xr[k] * hr[k] - xi[k] * hi[k]; hi[k] = xr[k] * hi[k] + xi[k] * hr[k]; hr[k] = a }
    cifft(hr, hi)
    return hr.slice(from, from + n)
  })
}
// MIT IR Survey responses at sr (ffmpeg's resampler, kept), aligned to the direct peak with 2 ms before it, those with
// an audible tail: [{ name, h }]
const irs = {}
function rooms(split, sr) {
  return irs[split + sr] ??= ls(path.join(DATA, 'mit-ir', 'Audio'), '.wav').filter(f => +f.slice(1, 4) % 2 === (split === 'tune' ? 0 : 1)).map(f => {
    let p = path.join(OUT, 'ir', `${f.slice(0, -4)}-${sr}.f32`)
    if (!existsSync(p)) { mkdirSync(path.dirname(p), { recursive: true }); spawnSync('ffmpeg', ['-v', 'error', '-y', '-i', path.join(DATA, 'mit-ir', 'Audio', f), '-ac', '1', '-ar', String(sr), '-f', 'f32le', p]) }
    let h = f32(p), k = 0
    for (let i = 0; i < h.length; i++) if (Math.abs(h[i]) > Math.abs(h[k])) k = i
    h = Float64Array.from(h.subarray(Math.max(0, k - Math.round(0.002 * sr))))
    let cut = Math.round(0.052 * sr), r = db(E(h, 0, cut) / E(h, cut))
    return r < 12 ? { name: f.slice(0, 4), h } : null
  }).filter(Boolean)
}
const demand = {}
const NOISES = ['DWASHING', 'NFIELD', 'NPARK', 'NRIVER', 'OHALLWAY']
const noiseFile = env => demand[env] ??= readWav(path.join(DATA, 'demand', env, 'ch01.wav')).ch[0]
function steady(color, n, sr, r) {
  let w = Float64Array.from({ length: n }, () => gauss(r))
  if (color === 'white') return w
  if (color === 'rumble') return sos(w, lp4(150, sr))
  if (color === 'brown') { let y = 0; return w.map(v => y = 0.998 * y + v) }
  let b = [0, 0, 0, 0, 0, 0, 0]                                         // pink: Kellet's filter
  return w.map(v => {
    b[0] = 0.99886 * b[0] + v * 0.0555179; b[1] = 0.99332 * b[1] + v * 0.0750759; b[2] = 0.969 * b[2] + v * 0.153852
    b[3] = 0.8665 * b[3] + v * 0.3104856; b[4] = 0.55 * b[4] + v * 0.5329522; b[5] = -0.7616 * b[5] - v * 0.016898
    let y = 0.11 * (b[0] + b[1] + b[2] + b[3] + b[4] + b[5] + b[6] + v * 0.5362); b[6] = v * 0.115926; return y
  })
}
function hum(n, sr, type, f0, r) {
  let a = []
  for (let h = 1; type === 'mains' ? h <= 12 : h * f0 <= Math.min(8000, sr / 2 - 1000); h++)
    a.push(type === 'mains' ? 1 / h : (h % 2 ? 1 : 0.3) / Math.sqrt(h) / Math.hypot(1, h * f0 / 3000))
  // harmonics by the recursion e^(jkφ) = e^(jφ)^k (bench/rx/dehum.mjs)
  let off = 0.03 * r(), wp = 2 * Math.PI * r(), th = a.map(() => 2 * Math.PI * r()), cr = th.map(Math.cos), ci = th.map(Math.sin), y = new Float64Array(n), ph = 0
  for (let i = 0; i < n; i++) {
    ph += 2 * Math.PI * (f0 + off + 0.05 * Math.sin(2 * Math.PI * i / sr / 4 + wp)) / sr
    let zr = Math.cos(ph), zi = Math.sin(ph), wr = zr, wi = zi, s = 0
    for (let k = 0; k < a.length; k++) { s += a[k] * (wi * cr[k] + wr * ci[k]); let t = wr * zr - wi * zi; wi = wr * zi + wi * zr; wr = t }
    y[i] = s
  }
  return y
}
const CLICK = {
  tick: (r, sr) => { let f = 2000 + r() * 6000, t = (0.05 + r() * 0.25) * sr / 1000; return Array.from({ length: Math.ceil(5 * t) }, (_, n) => Math.exp(-n / t) * Math.cos(2 * Math.PI * f * n / sr)) },
  pop: (r, sr) => { let f = 300 + r() * 1200, t = (0.3 + r() * 0.7) * sr / 1000; return Array.from({ length: Math.ceil(5 * t) }, (_, n) => Math.exp(-n / t) * Math.sin(2 * Math.PI * f * n / sr + 0.3)) },
}
// the rail at which hard clipping leaves y `sdr` dB from itself (bisection; clip_sdr.m)
function rail(y, sdr) {
  let ex = E(y), lo = 0, hi = 0
  for (let v of y) hi = Math.max(hi, Math.abs(v))
  for (let it = 0; it < 50; it++) {
    let t = (lo + hi) / 2, e = 0
    for (let v of y) { let a = Math.abs(v); if (a > t) e += (a - t) ** 2 }
    if (db(ex / e) > sdr) hi = t; else lo = t
  }
  return (lo + hi) / 2
}

// the take: { name, src, mode, sr, x (input), ref, defects: { kind: settings } }
export function take(split, clip, variant, kinds) {
  let { x: clean, sr } = clip.get(), mode = clip.src === 'music' ? 'music' : 'speech', r = lcg(seedOf(`${split}|${clip.name}|${variant}`))
  let lvl = mode === 'music' ? E(clean) / clean.length : asl(clean, sr), g = Math.sqrt((mode === 'music' ? 0.01 : 10 ** -2.6) / lvl)
  let x = Float64Array.from(clean, v => v * g), n = x.length, ref = Float64Array.from(x), y = Float64Array.from(x), P = mode === 'music' ? E(x) / n : asl(x, sr), defects = {}
  for (let k of ORDER.filter(k => kinds.includes(k))) {
    let d = defects[k] = {}
    if (k === 'sibilance') {
      let h = harsh({ x: Float32Array.from(y), sr }, r() * 1e9 >>> 0); y = Float64Array.from(h.y); d.runs = h.runs.length
    } else if (k === 'reverb') {
      let R = rooms(split, sr), room = R[Math.floor(r() * R.length)], cut = Math.round(0.052 * sr), pre = Math.round(0.002 * sr)
      let [wet, early] = convolve(y, [room.h, room.h.subarray(0, cut)], pre, n), [ref0] = convolve(x, [room.h.subarray(0, cut)], pre, n)
      let s = Math.sqrt(E(x) / E(ref0))
      d.room = room.name; d.drr = +db(E(early) / E(wet.map((v, i) => v - early[i]))).toFixed(1)
      for (let i = 0; i < n; i++) y[i] = wet[i] * s, ref[i] = ref0[i] * s
    } else if (k === 'plosive') {
      let p = addPops({ x: Float32Array.from(x), sr }, r() * 1e9 >>> 0)
      for (let i = 0; i < n; i++) y[i] += p.x[i] - x[i]
      d.pops = p.pops.length
    } else if (k === 'noise') {
      let color = ['white', 'pink', 'brown', 'rumble'][Math.floor(r() * 4)], w = steady(color, n, sr, r), snr = mode === 'music' ? uni(r, 15, 35) : uni(r, 5, 25), s = Math.sqrt(P / (E(w) / n) / 10 ** (snr / 10))
      for (let i = 0; i < n; i++) y[i] += s * w[i]
      d.color = color; d.snr = +snr.toFixed(1)
    } else if (k === 'demand') {
      let env = NOISES[Math.floor(r() * NOISES.length)], w = noiseFile(env), half = w.length >> 1, at = (split === 'tune' ? 0 : half) + Math.floor(r() * (half - n))
      let seg = w.subarray(at, at + n), snr = mode === 'music' ? uni(r, 10, 25) : uni(r, 0, 20), s = Math.sqrt(P / (E(seg) / n) / 10 ** (snr / 10))
      for (let i = 0; i < n; i++) y[i] += s * seg[i]
      d.env = env; d.snr = +snr.toFixed(1)
    } else if (k === 'hum') {
      let type = r() < 0.5 ? 'mains' : 'buzz', f0 = r() < 0.5 ? 50 : 60, h = hum(n, sr, type, f0, r), lv = mode === 'music' ? uni(r, -40, -25) : uni(r, -35, -20), s = Math.sqrt(P / (E(h) / n) * 10 ** (lv / 10))
      for (let i = 0; i < n; i++) y[i] += s * h[i]
      d.type = type; d.f0 = f0; d.level = +lv.toFixed(1)
    } else if (k === 'clicks') {
      let rate = uni(r, 1, 4), amp = uni(r, 3, 10), c = 0, F = Math.round(0.01 * sr)
      for (let at = Math.round(0.2 * sr); at < n - 0.2 * sr; at += Math.round(sr / rate * uni(r, 0.5, 1.5))) {
        let lv = Math.max(1e-3, Math.sqrt(E(y, at - F, at + F) / (2 * F))), h = CLICK[r() < 0.5 ? 'tick' : 'pop'](r, sr), pk = Math.max(...h.map(Math.abs)), sg = r() < 0.5 ? -1 : 1
        for (let j = 0; j < h.length && at + j < n; j++) y[at + j] += sg * amp * lv * h[j] / pk
        c++
      }
      d.rate = +rate.toFixed(2); d.amp = +amp.toFixed(1); d.n = c
    } else if (k === 'clip') {
      let sdr = uni(r, 3, 15), t = rail(y, sdr), c = 0
      for (let i = 0; i < n; i++) { let v = y[i] / t; if (Math.abs(v) >= 1) c++; y[i] = Math.max(-1, Math.min(1, v)); ref[i] /= t }
      d.sdr = +sdr.toFixed(1); d.share = +(c / n).toFixed(4)
    }
  }
  return { name: `${clip.name}|${variant}`, src: clip.src, mode, sr, x: Float32Array.from(y), ref: Float32Array.from(ref), defects }
}

// every take of a split, unmade: [{ name, src, mode, kinds, make() }]
export function takes(split) {
  let speech = [...voicebank(split), ...narrations(split)], tunes = music(split), out = []
  for (let [mode, clips] of [['speech', speech], ['music', tunes]]) clips.forEach((clip, k) => {
    let K = KINDS[mode], r = lcg(seedOf(`${split}|${clip.name}|kinds`)), all = [...K]
    for (let i = all.length - 1; i > 0; i--) { let j = Math.floor(r() * (i + 1)); [all[i], all[j]] = [all[j], all[i]] }
    let multi = all.slice(0, 2 + Math.floor(r() * 3))
    for (let [variant, kinds] of [['clean', []], ['one', [K[k % K.length]]], ['multi', multi]])
      out.push({ name: `${clip.name}|${variant}`, src: clip.src, mode, variant, kinds, make: () => take(split, clip, variant, kinds) })
  })
  let sel = process.env.TAKES ? out.filter(t => new RegExp(process.env.TAKES).test(t.name)) : out
  return SHARD ? sel.filter((_, i) => i % SHARD[1] === SHARD[0]) : sel
}

// ---- systems: async ({ x, sr, mode, defects }) → { y, lin?, info? }
// RX Repair Assistant, a new instance per render, aligned to its input
const DRIVER = `
import sys, json, numpy as np, pedalboard
RA = '/Library/Audio/Plug-Ins/VST3/RX 12 Repair Assistant.vst3'
def lag(x, y, m=32768):
    N = 1 << int(np.ceil(np.log2(len(x) + len(y) + m)))
    c = np.fft.irfft(np.fft.rfft(y, N) * np.conj(np.fft.rfft(x, N)), N)
    return int(np.argmax(np.abs(np.concatenate([c[N - m:], c[:m + 1]])))) - m
for line in sys.stdin:
    try:
        j = json.loads(line); x = np.fromfile(j['in'], np.float32); p = pedalboard.load_plugin(RA); n, M = len(x), 32768
        for k, v in j['params'].items(): setattr(p, k, v)
        # mirrored M samples either side: the host drops the delay the plugin reports, which is not always the one it has
        xp = np.concatenate([x[M:0:-1], x, x[-2:-M - 2:-1]]).astype(np.float32)
        y = p.process(xp[None].copy(), j['sr'])[0]; k = lag(xp, y) + M; z = np.zeros_like(x)
        if k >= 0: m = min(n, len(y) - k); z[:m] = y[k:k + m]
        else: m = min(n + k, len(y)); z[-k:-k + m] = y[:m]
        z.tofile(j['out']); print(json.dumps({'lag': k - M}), flush=True)
    except Exception as e: print(json.dumps({'error': repr(e)}), flush=True)
`
// a pool of Python processes each running `code`, one JSON job per line answered by one line
function pool(code, size) {
  let ps = []
  const hold = (h, on) => [h.p, h.p.stdin, h.p.stdout].forEach(s => on ? s.ref() : s.unref())
  return job => {
    let h = ps.reduce((a, b) => !a || b.q.length < a.q.length ? b : a, null)
    if (ps.length < size && (!h || h.q.length)) {
      let p = spawn(PY, ['-c', code], { stdio: ['pipe', 'pipe', 'ignore'] }), me = { p, q: [] }
      ps.push(h = me)
      createInterface({ input: p.stdout }).on('line', l => { let r = JSON.parse(l), j = me.q.shift(); r.error ? j.reject(new Error(r.error)) : j.resolve(r); if (!me.q.length) hold(me, false) })
      p.on('exit', c => { for (let j of me.q.splice(0)) j.reject(new Error(`python exited ${c}`)); ps.splice(ps.indexOf(me), 1) })
    }
    return new Promise((resolve, reject) => { h.q.push({ resolve, reject }); hold(h, true); h.p.stdin.write(JSON.stringify(job) + '\n') })
  }
}
const rxJob = pool(DRIVER, +process.env.RX_WORKERS || 2)
let seq = 0
const tmp = () => path.join(OUT, 'tmp', `${process.pid}-${seq++}`)
const writeF32 = (p, x) => { mkdirSync(path.dirname(p), { recursive: true }); writeFileSync(p, Buffer.from(Float32Array.from(x).buffer)) }
export const ra = params => async t => {
  let i = tmp() + '-in.f32', o = tmp() + '-out.f32', p = { source_mode: t.mode === 'music' ? 'Music' : 'Voice', ...params(t) }
  writeF32(i, t.x)
  try {
    let r
    try { r = await rxJob({ in: i, out: o, sr: t.sr, params: p }) } catch { r = await rxJob({ in: i, out: o, sr: t.sr, params: p }) }   // a host that died: once more
    return { y: f32(o), info: { lag: r.lag, params: p } }
  } finally { for (let f of [i, o]) existsSync(f) && unlinkSync(f) }
}

// RX's modules by defect, and each one's grid for `tune`: the rails at 0 dBFS, De-clip's threshold just under them
// (bench/rx/declip.mjs: every offset under −0.25 dB lost at every level), with and without its limiter; De-ess at its
// default cutoff and at 4 kHz, where RX De-ess tuned (bench/rx/deess.mjs). Hum and pops have none RX can run offline
export const MODULES = {
  noise: { defects: ['noise', 'demand'], grid: [20, 40, 60, 80, 100].map(v => ({ de_noise_amount: v })) },
  reverb: { defects: ['reverb'], grid: [25, 50, 75, 100].map(v => ({ de_reverb_amount: v })) },
  clicks: { defects: ['clicks'], grid: [{ de_click_bypass: false }] },
  clip: { defects: ['clip'], grid: [-0.1, -0.3].flatMap(t => [true, false].map(l => ({ de_clip_bypass: false, de_clip_threshold_db: t, de_clip_limiter: l }))) },
  ess: { defects: ['sibilance'], speech: true, grid: [{ de_ess_bypass: false }, ...[-18, -12, -6].map(t => ({ de_ess_bypass: false, de_ess_threshold_db: t, de_ess_cutoff_hz: 4000 }))] },
}
const TUNED = path.join(OUT, 'rx-tuned.json')
const tuned = () => existsSync(TUNED) ? JSON.parse(readFileSync(TUNED, 'utf8')) : null
const oracle = (T, t) => Object.assign({}, ...Object.entries(MODULES).filter(([, m]) => m.defects.some(d => d in t.defects)).map(([k]) => T[t.mode].best[k] || {}))

// ours: @audio/chain as a module path; its label carries a hash of chain.js and of the files of the packages it calls,
// and where its plan names the neural denoise stage audio's auto() runs (fn/auto.js: @audio/neural-denoise installed,
// NEURAL=0 not set), of that stage's code: audio's fn/auto.js and fn/deepfilter.js, the package's files and its weights
const nn = process.env.NEURAL === '0' ? null : await import(NEURAL).catch(() => null)
const NEURAL_FILES = nn && [...graph(realpathSync(createRequire(import.meta.url).resolve(NEURAL))), path.join(path.dirname(realpathSync(createRequire(import.meta.url).resolve(NEURAL))), 'guard.bin'), ...['auto.js', 'deepfilter.js'].map(f => path.join(HERE, '..', '..', 'fn', f))]
export const MASTER = new Set(['eq', 'multiband', 'width', 'gain', 'limiter']), TONE = new Set(['hpf', 'eq'])
const chains = {}
// the files a module runs: it and its relative imports, recursively (a package's tests, benches and scratch files left out)
function graph(file, seen = new Set()) {
  if (seen.has(file)) return seen
  seen.add(file)
  for (let [, spec] of readFileSync(file, 'utf8').matchAll(/(?:import|export)\s[^'"]*?from\s*['"](\.{1,2}\/[^'"]+)['"]|import\s*['"](\.{1,2}\/[^'"]+)['"]/g))
    if (spec) graph(path.resolve(path.dirname(file), spec), seen)
  return seen
}
export function label(file) {
  let req = createRequire(file), pkg = JSON.parse(readFileSync(path.join(path.dirname(file), 'package.json'), 'utf8')), h = createHash('sha1')
  for (let f of graph(file)) h.update(readFileSync(f))
  for (let dep of Object.keys(pkg.dependencies || {}).sort()) for (let f of graph(realpathSync(req.resolve(dep)))) h.update(readFileSync(f))
  for (let f of NEURAL_FILES || []) h.update(readFileSync(f))
  return `ours ${pkg.version}-${h.digest('hex').slice(0, 8)}`
}
async function chainAt(file) {
  if (chains[file]) return chains[file]
  let m = await import(pathToFileURL(file).href)
  return chains[file] = { m, label: label(file) }
}
export const DEFAULT_CHAIN = realpathSync(createRequire(path.join(HERE, '..', '..', 'package.json')).resolve('@audio/chain'))
// both outputs of one analysis: the recipe's repair stages alone, and auto(): its tone and level stages after them, as
// apply() runs the whole recipe (repairs first in every version measured; the refinement pass with the limiter)
// The repair stages run one at a time (apply() runs a recipe's stages in order: the same render), a slow one's output
// kept on disk by its package's code, its params and its input (declip: minutes a take; OUT/stage/). The plan and its
// neural stage as audio's auto() makes them (fn/auto.js planned())
const SLOW = { declip: '@audio/denoise-declip' }
export async function stage(m, file, st, y, sr) {
  if (!SLOW[st.name]) return m.apply([y], { stages: [st] }, { fs: sr })[0]
  let h = createHash('sha1').update(JSON.stringify(st.params)).update(String(sr)).update(Buffer.from(y.buffer, y.byteOffset, y.byteLength))
  for (let f of graph(realpathSync(createRequire(file).resolve(SLOW[st.name])))) h.update(readFileSync(f))
  let p = path.join(OUT, 'stage', `${st.name}-${h.digest('hex').slice(0, 16)}.f32`)
  if (existsSync(p)) return f32(p)
  let out = m.apply([y], { stages: [st] }, { fs: sr })[0]
  writeF32(p, out)
  return out
}
async function ours(file, t) {
  let { m } = await chainAt(file), type = t.mode, run = async (stages, y) => { for (let st of stages) y = await stage(m, file, st, y, t.sr); return y }
  let { analysis: a, recipe, at, x, y: removal } = await planned(m, nn, [t.x], t.sr, { type }, async (stages, [c]) => [await run(stages, c)])
  let only = s => ({ ...recipe, stages: recipe.stages.filter(s) }), yr = t.x, from = 0
  if (at >= 0) { let s = recipe.stages[at], on = s.atom === NEURAL; yr = on ? denoise(nn, x, removal, s.params, t.sr)[0] : x[0]; from = on ? at + 1 : at }
  yr = await run(recipe.stages.slice(from).filter(s => !MASTER.has(s.name)), yr)
  let y = m.apply([yr], only(s => MASTER.has(s.name)), { fs: t.sr })[0]
  let lin = m.apply([t.ref], only(s => TONE.has(s.name)), { fs: t.sr })[0], linr = m.apply([t.ref], only(s => s.name === 'hpf'), { fs: t.sr })[0]
  let an = { snr: a.snr, hum: a.hum?.level ?? null, clicks: a.clicks, sib: a.sibilanceDb, clip: a.clipping?.count, voiced: a.voicedRatio }
  for (let k of ['reverb', 'pops', 'clipped']) if (a[k] !== undefined) an[k] = a[k]
  let info = { stages: recipe.stages.map(s => s.name), neural: recipe.stages.some(s => s.atom === NEURAL), an }
  return [{ y, lin, info: { ...info, lufs: lufsFn([y], { fs: t.sr }), tp: truepeakFn([y], { fs: t.sr }), target: recipe.targetLufs } }, { y: yr, lin: linr, info }]
}

// ---- scores
const SCORER = `
import sys, json, numpy as np
sys.path[:0] = [${JSON.stringify(path.join(HERE, '..'))}, ${JSON.stringify(HERE)}]
from speech import dnsmos, lufs, sisdr
from peaq import odg
from pesq import pesq
from pystoi import stoi
from scipy.signal import resample_poly
to16 = lambda v, fs: resample_poly(v, 1, 3) if fs == 48000 else resample_poly(v, 160, 441) if fs == 44100 else v
rd = lambda p: np.fromfile(p, np.float32).astype(np.float64)
for line in sys.stdin:
    try:
        j = json.loads(line); fs = j['sr']; r, d = rd(j['ref']), rd(j['deg']); l = rd(j['lin']) if j.get('lin') else r; n = len(r)
        d = d[:n] if len(d) >= n else np.pad(d, (0, n - len(d))); o = {}
        if not np.all(np.isfinite(d)): raise ValueError('non-finite output')
        if j['kind'] == 'speech':
            r16, d16, l16 = to16(r, fs), to16(d, fs), to16(l, fs)
            try: o['pesq'] = pesq(16000, r16, d16, 'wb')
            except Exception: o['pesq'] = None
            o['stoi'] = stoi(r16, d16, 16000, extended=False); o['sisdr'] = sisdr(l16, d16)
            ld = lufs(d, fs); g = 10 ** ((-26 - ld) / 20) if np.isfinite(ld) else 1
            o['sig'], o['bak'], o['ovrl'] = dnsmos(d * g, fs)
        else:
            o['sisdr'] = sisdr(l, d); s = 0.1 / np.sqrt(np.mean(r ** 2)); g = np.dot(d, r) / max(np.dot(d, d), 1e-30)
            grade, movs = odg(r * s, d * g * s, fs); o['odg'] = float(grade); o['nmr'] = float(movs['TotalNMRB'])
        if j.get('x'):
            x = rd(j['x']); e = np.sum((d - x) ** 2); o['harm'] = float(10 * np.log10(np.sum(x ** 2) / e)) if e > 0 else np.inf
        o = {k: None if v is None or np.isnan(v) else ('Infinity' if v > 0 else '-Infinity') if np.isinf(v) else float(v) for k, v in o.items()}
        print(json.dumps(o), flush=True)
    except Exception as e: print(json.dumps({'error': repr(e)}), flush=True)
`
const scoreJob = pool(SCORER, +process.env.SCORERS || 1)
async function score(t, out) {
  let f = tmp(), files = { ref: f + '-ref.f32', deg: f + '-deg.f32', lin: out.lin && f + '-lin.f32', x: t.variant === 'clean' && f + '-x.f32' }
  writeF32(files.ref, t.ref); writeF32(files.deg, out.y); if (out.lin) writeF32(files.lin, out.lin); if (files.x) writeF32(files.x, t.x)
  try {
    let s = await scoreJob({ kind: t.mode, sr: t.sr, ...files })
    if (files.x && !t.x.some((v, i) => v !== out.y[i])) s.same = true
    return { ...s, ...out.info }
  } finally { for (let p of Object.values(files)) p && existsSync(p) && unlinkSync(p) }
}

// Scores are kept, not renders: OUT/<split>/<label>.json, by take; a shard's (SHARD=k/n: every nth take from the kth,
// in a process of its own) in <label>.s<k>.json, read back with the rest
const books = {}, SHARD = process.env.SHARD?.split('/').map(Number)
function book(split, lbl) {
  if (books[split + lbl]) return books[split + lbl]
  let base = path.join(OUT, split, lbl.replace(/[\/ ]+/g, '_')), dir = path.dirname(base), s = {}, f = base + (SHARD ? `.s${SHARD[0]}` : '') + '.json'
  for (let g of existsSync(dir) ? readdirSync(dir).filter(g => g === path.basename(base) + '.json' || g.startsWith(path.basename(base) + '.s') && g.endsWith('.json')) : [])
    Object.assign(s, JSON.parse(readFileSync(path.join(dir, g), 'utf8')))
  return books[split + lbl] = { f, s, own: existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : {} }
}
const save = b => { mkdirSync(path.dirname(b.f), { recursive: true }); let o = SHARD ? b.own : b.s; writeFileSync(b.f + '.part', JSON.stringify(o)); writeFileSync(b.f, readFileSync(b.f + '.part')); unlinkSync(b.f + '.part') }

// items in flight `k` at a time
async function each(items, one, tag, k = 3) {
  let done = 0
  for (let i = 0, live = []; i < items.length || live.length;) {
    while (live.length < k && i < items.length) { let p = one(items[i++]).catch(e => console.error(`\n${tag}: ${e.stack || e}`)).then(() => { live.splice(live.indexOf(p), 1); process.stderr.write(`\r${tag} ${++done}/${items.length}   `) }); live.push(p) }
    await Promise.race(live)
  }
  process.stderr.write('\n')
}

// systems: { label: fn(t) → out | [out, ...] for labels[] }; each take's missing scores made and kept
export async function evaluate(split, systems, list = takes(split)) {
  let groups = Object.entries(systems)
  await each(list, async it => {
    let t = null
    for (let [lbl, fn] of groups) {
      let lbls = lbl.split('\n'), bs = lbls.map(l => book(split, l))
      if (bs.every(b => it.name in b.s)) continue
      t ??= { ...it.make(), variant: it.variant }
      let outs = await fn(t)
      outs = Array.isArray(outs) ? outs : [outs]
      for (let [i, b] of bs.entries()) { b.s[it.name] = b.own[it.name] = await score(t, outs[i]); save(b) }
    }
  }, `${split}`)
  return Object.fromEntries(groups.flatMap(([lbl]) => lbl.split('\n')).map(l => [l, book(split, l).s]))
}

const oursSystems = async (file = process.env.CHAIN || DEFAULT_CHAIN) => {
  let { label: l } = await chainAt(file)
  return { [`${l}\n${l} repair`]: t => ours(file, t) }
}
const rxSystems = () => {
  let T = tuned(), s = { 'rx default': ra(() => ({})) }
  if (T) {
    s[`rx tuned ${T.hash}`] = ra(t => T[t.mode].global)
    s[`rx oracle ${T.hash}`] = ra(t => oracle(T, t))
  }
  return s
}

// ---- tune: each module's grid on the tuning takes with its defect, by mean PESQ (speech) or ODG (music); then
// the modules on for every take, each dropped whose dropping raises the mean over all tuning takes of its mode
const metric = mode => mode === 'music' ? 'odg' : 'pesq'
const avg = (rows, k) => mean(rows.map(r => r?.[k]).filter(Number.isFinite))
const key = p => Object.entries(p).map(([k, v]) => `${k}=${v}`).join(',') || 'none'
async function tune() {
  let all = takes('tune'), T = { hash: '' }
  for (let mode of ['speech', 'music']) {
    let mine = all.filter(t => t.mode === mode), best = {}
    for (let [name, m] of Object.entries(MODULES)) {
      if (m.speech && mode === 'music') continue
      let on = mine.filter(t => m.defects.some(d => t.kinds.includes(d))), rows = []
      if (!on.length) continue                                     // a defect the material never carries (music's room)
      let res = await evaluate('tune', Object.fromEntries(m.grid.map(p => [`rx ${key(p)}`, ra(() => p)])), on)
      let base = await evaluate('tune', { input: async t => ({ y: t.x }) }, on)
      for (let p of m.grid) rows.push([p, avg(on.map(t => res[`rx ${key(p)}`][t.name]), metric(mode))])
      rows.sort((a, b) => b[1] - a[1]); best[name] = rows[0][0]
      console.log(`${mode} ${name} (${on.length} takes; input ${avg(on.map(t => base.input[t.name]), metric(mode)).toFixed(3)}): ${rows.map(([p, v]) => `${key(p)} ${v.toFixed(3)}`).join(' · ')}`)
    }
    // greedy: all on, then drop while dropping helps; over every 3rd clip's takes (a render with every module on takes
    // RX about a minute)
    let on = Object.keys(best), cur = null, some = mine.filter((_, i) => Math.floor(i / 3) % 3 === 0)   // every 3rd clip's three takes
    const run = async keys => { let p = Object.assign({}, ...keys.map(k => best[k])), l = `rx ${key(p)}`, res = await evaluate('tune', { [l]: ra(() => p) }, some); return avg(some.map(t => res[l][t.name]), metric(mode)) }
    cur = await run(on)
    for (let changed = true; changed;) {
      changed = false
      for (let k of [...on]) { let v = await run(on.filter(q => q !== k)); if (v > cur) { cur = v; on = on.filter(q => q !== k); changed = true; console.log(`${mode}: without ${k} ${v.toFixed(3)}`) } }
    }
    T[mode] = { best, global: Object.assign({}, ...on.map(k => best[k])), mean: cur }
    console.log(`${mode} tuned: ${key(T[mode].global)} (${metric(mode)} ${cur.toFixed(3)} over ${some.length} tuning takes)`)
  }
  T.hash = createHash('sha1').update(JSON.stringify([T.speech, T.music])).digest('hex').slice(0, 6)
  mkdirSync(OUT, { recursive: true }); writeFileSync(TUNED, JSON.stringify(T, null, 1))
}

// ---- report
const f2 = v => Number.isFinite(v) ? v.toFixed(2) : '–', f1 = v => v === Infinity || v === 'Infinity' ? '∞' : Number.isFinite(v) ? v.toFixed(1) : '–'
const GROUPS = mode => [['clean', t => t.variant === 'clean'], ...KINDS[mode].map(k => [k, t => t.variant === 'one' && t.kinds[0] === k]), ['2–4 defects', t => t.variant === 'multi'], ['all with defects', t => t.variant !== 'clean']]
function report(list, res, labels) {
  for (let mode of ['speech', 'music']) {
    let mine = list.filter(t => t.mode === mode), keys = mode === 'speech' ? ['pesq', 'stoi', 'sisdr', 'ovrl'] : ['sisdr', 'odg', 'nmr']
    console.log(`\n${mode === 'speech' ? 'Speech' : 'Music'} (${mine.length} takes): ${keys.join(' / ')}, mean\n`)
    let rows = GROUPS(mode).map(([g, f]) => { let ts = mine.filter(f); return [`${g} (${ts.length})`, ...labels.map(l => keys.map(k => (k === 'stoi' || k === 'odg' || k === 'pesq' || k === 'ovrl' ? f2 : f1)(avg(ts.map(t => res[l]?.[t.name]), k))).join(' / '))] })
    console.log(table(['takes', ...labels], rows))
  }
  let loud = labels.filter(l => list.some(t => res[l]?.[t.name]?.lufs != null))
  if (loud.length) {
    console.log(`\nLoudness out (auto()): median LUFS, share within 1 LU of the target; true peak, highest dBTP\n`)
    console.log(table(['takes', ...loud], ['speech', 'music'].map(mode => {
      let ts = list.filter(t => t.mode === mode)
      return [`${mode} (${ts.length})`, ...loud.map(l => { let r = ts.map(t => res[l]?.[t.name]).filter(r => r?.lufs != null); return r.length ? `${median(r.map(r => r.lufs)).toFixed(1)}, ${Math.round(100 * r.filter(r => Math.abs(r.lufs - r.target) <= 1).length / r.length)}%; ${Math.max(...r.map(r => r.tp)).toFixed(2)}` : '' })]
    })))
  }
  console.log(`\nClean takes, what each changes: SDR of output to input, dB (median, worst); untouched share\n`)
  console.log(table(['material', ...labels], ['speech', 'music'].map(mode => {
    let ts = list.filter(t => t.mode === mode && t.variant === 'clean')
    return [`${mode} (${ts.length})`, ...labels.map(l => { let v = ts.map(t => res[l]?.[t.name]?.harm).filter(v => v !== undefined).map(v => v === 'Infinity' ? Infinity : v); return v.length ? `${f1(median(v))}, ${f1(Math.min(...v))}; ${ts.filter(t => res[l]?.[t.name]?.same).length}/${ts.length}` : '' })]
  })))
}

// a against b, take by take: the mean difference of each measure with its 95 % interval (1.96 s/√n), and the share of
// takes a scores higher on
function versus(list, res, a, b) {
  console.log(`\n${a} against ${b}, paired: mean difference ± 95 % interval; share of takes ahead\n`)
  let rows = []
  for (let mode of ['speech', 'music']) {
    let keys = mode === 'speech' ? ['pesq', 'stoi', 'sisdr', 'ovrl'] : ['sisdr', 'odg', 'nmr']
    for (let [g, f] of GROUPS(mode)) {
      let ts = list.filter(t => t.mode === mode && f(t))
      rows.push([`${mode} ${g} (${ts.length})`, ...keys.map(k => {
        let d = ts.map(t => [res[a]?.[t.name]?.[k], res[b]?.[t.name]?.[k]]).filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y)).map(([x, y]) => k === 'nmr' ? y - x : x - y)
        if (d.length < 2) return '–'
        let m = mean(d), sd = Math.sqrt(d.reduce((s, v) => s + (v - m) ** 2, 0) / (d.length - 1)), w = d.filter(v => v > 0).length / d.length
        return `${k} ${m >= 0 ? '+' : ''}${(k === 'sisdr' || k === 'nmr' ? m.toFixed(1) : m.toFixed(2))} ± ${(1.96 * sd / Math.sqrt(d.length)).toFixed(k === 'sisdr' || k === 'nmr' ? 1 : 2)}, ${Math.round(100 * w)}%`
      })])
    }
  }
  console.log(table(['takes', 'measure: a − b (NMR: b − a, lower is better)', '', '', ''], rows))
}

// what ours' plan turns on, per defect: recall over takes with it, false alarms over takes without (clean and other)
const STAGE = { noise: 'denoise', demand: 'denoise', hum: 'dehum', clicks: 'declick', clip: 'declip', reverb: 'dereverb', sibilance: 'deesser', plosive: 'deplosive' }
function router(list, res, labels) {
  console.log(`\nOurs' plan: share of takes with the defect whose recipe holds its stage (recall), and of takes without it (false alarm)\n`)
  let rows = []
  for (let mode of ['speech', 'music']) for (let d of KINDS[mode]) {
    let mine = list.filter(t => t.mode === mode), w = mine.filter(t => t.kinds.includes(d)), wo = mine.filter(t => !t.kinds.includes(d) && !(STAGE[d] === 'denoise' && t.kinds.some(k => STAGE[k] === 'denoise')))
    let share = (ts, l) => { let v = ts.map(t => res[l]?.[t.name]).filter(Boolean); return v.length ? `${Math.round(100 * v.filter(s => s.stages?.includes(STAGE[d])).length / v.length)}%` : '–' }
    rows.push([`${mode} ${d} → ${STAGE[d]} (${w.length} · ${wo.length})`, ...labels.map(l => `${share(w, l)} · ${share(wo, l)}`)])
  }
  console.log(table(['defect (with · without)', ...labels], rows))
}

async function test() {
  let list = takes('test'), sys = { input: async t => ({ y: t.x }), ...rxSystems(), ...await oursSystems() }
  if (process.env.CHAIN_BEFORE) Object.assign(sys, await oursSystems(process.env.CHAIN_BEFORE))
  let res = await evaluate('test', sys, list), labels = Object.keys(res)
  report(list, res, labels)
  router(list, res, labels.filter(l => l.startsWith('ours') && !l.endsWith('repair')))
  let mine = Object.keys(await oursSystems()).flatMap(l => l.split('\n'))
  for (let l of labels.filter(l => l.startsWith('rx tuned') || l.startsWith('rx oracle'))) for (let m of mine) versus(list, res, m, l)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  let [cmd, split = 'test', name] = process.argv.slice(2)
  if (cmd === 'tune') await tune()
  else if (cmd === 'test') await test()
  else if (cmd === 'ours') {
    let list = takes(split), sys = { input: async t => ({ y: t.x }), ...await oursSystems() }
    if (process.env.CHAIN_BEFORE) Object.assign(sys, await oursSystems(process.env.CHAIN_BEFORE))
    let res = await evaluate(split, sys, list), labels = Object.keys(res)
    report(list, res, labels); router(list, res, labels.filter(l => l.startsWith('ours') && !l.endsWith('repair')))
  } else if (cmd === 'report') {
    // the kept scores of the systems named (labels, comma-separated, as kept), nothing rendered
    let list = takes(split), labels = name.split(',')
    let res = Object.fromEntries(labels.map(l => [l, book(split, l).s]))
    report(list, res, labels); router(list, res, labels.filter(l => l.startsWith('ours') && !l.endsWith('repair')))
    if (process.env.VERSUS) { let [a, b] = process.env.VERSUS.split(','); versus(list, res, a, b) }
  } else if (cmd === 'router') {
    let list = takes(split), labels = Object.keys(await oursSystems()).flatMap(l => l.split('\n')).filter(l => !l.endsWith('repair'))
    if (process.env.CHAIN_BEFORE) labels.push(...Object.keys(await oursSystems(process.env.CHAIN_BEFORE)).flatMap(l => l.split('\n')).filter(l => !l.endsWith('repair')))
    router(list, Object.fromEntries(labels.map(l => [l, book(split, l).s])), labels)
  } else if (cmd === 'takes') {
    for (let it of takes(split)) { let t = it.make(); console.log(it.name, JSON.stringify(t.defects), (t.x.length / t.sr).toFixed(1) + ' s') }
  } else if (cmd === 'wav') {
    let it = takes(split).find(t => t.name === name), t = { ...it.make(), variant: it.variant }, d = path.join(OUT, 'wav'), [o] = await ours(process.env.CHAIN || DEFAULT_CHAIN, t)
    for (let [k, v] of [['in', t.x], ['ref', t.ref], ['ours', o.y]]) writeWav(path.join(d, `${name.replace(/\|/g, '-')}-${k}.wav`), [v], t.sr)
    console.log(d, JSON.stringify(t.defects), o.info.stages.join(' '))
  } else console.log('usage: node bench/rx/assistant.mjs tune | test | ours [SPLIT] | router [SPLIT] | takes [SPLIT] | wav SPLIT NAME')
}
