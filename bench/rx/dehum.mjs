// iZotope RX 12 De-hum against `audio`'s dehum (@audio/denoise-dehum) on the same buffers: mains hum and buzz added to
// real speech and music, the program known, so what is left of the hum and what went of the program are measured apart.
//
//   node bench/rx/dehum.mjs tune [GRID]   RX's settings on the tuning split (a grid over its main knobs), ours at defaults
//   node bench/rx/dehum.mjs test          the test split: RX at its defaults, RX tuned, ours 0.4.0, ours now; clean
//                                         material through each (harm); hum as recorded (no ground truth)
//   node bench/rx/dehum.mjs clean         ours over 468 clean takes, no hum: the takes it changes (false alarms)
//   RX_WORKERS=3 (plugin hosts in parallel), DEHUM_BEFORE='ours <version>-<hash>' (the build compared against).
// Scores are kept per system (~/.cache/audiojs/data/rx/dehum/<split>/<system>.json), not renders; a system's label
// carries the dehum source's hash, so a changed build is measured again and the others are read back.
//
// Material (~/.cache/audiojs/data), tuning / test, mono:
//   speech     VoiceBank+DEMAND clean speech (Valentini-Botinhao et al. 2017, CC BY 4.0): eight utterances back to back
//              per clip, the training speakers (vbdemand-train/clean) / the test speakers p232, p257 (clean_testset_wav)
//   narration  Spoken Wikipedia readings (Köhn, Stegen, Baumann, LREC 2016, CC BY-SA), 30 s from 15 s in: spoken-train/ /
//              spoken/ (bench/speech.mjs's rooms)
//   music      MUSDB18 previews (Rafii et al. 2017; mixes, 7 s): the training songs / the test songs (musdb/test-mono,
//              as @audio/neural-denoise's scripts write them), and for test also 30 s of the four pieces scripts/repair.js
//              of @audio/denoise reads (repair/: Vibe Ace, Brahms' Hungarian Dance 5, the Sugar Plum Fairy, a trumpet)
// Hum, seeded per clip and condition (lcg): the mains frequency f0 + ε (|ε| ≤ 0.03 Hz) wandering as a grid's does
// (ENF: a smooth random walk, ~4 s time constant, peaks about ±dev; Hajj-Ahmad, Garg & Wu, IEEE SPL 20(9), 2013 for the
// scale), each harmonic's level drifting ±10 % over ~10 s, random phases, scaled to `lvl` dB under the program's RMS:
//   mains  h = 1…12 at 1/h (−6 dB per octave): a transformer's field, a preamp's supply
//   buzz   odd-heavy to 8 kHz: odd h at h^−½, even at 0.3·h^−½, a first-order rolloff at 3 kHz: the ground-loop and
//          rectifier-pulse buzz of unbalanced interconnects (Whitlock, "Hum and buzz in unbalanced interconnect
//          systems", Jensen AN-004, 1995: its harmonics reach several kHz)
// Conditions: mains50 (±0.05 Hz), buzz60 (±0.05), drift (buzz at 50 Hz, ±0.2 Hz: a generator's wander), steps (mains50
// switched: its level stepping between off, −10, −5, 0 and +5 dB four times), edits (mains50 under an edited take: six
// splices, at the quietest 50 ms near each spot in speech, anywhere in music, the hum's phase jumping at each), quiet
// (buzz60, 30 dB under). Every input starts with 3 s of the hum alone (room tone before the take), where RX learns.
//
// Measures, over the take (the 3 s before left out):
//   hum down   how far the hum goes: y₊ = sys(x + h), y₋ = sys(x − h); (y₊ − y₋)/2 is what became of the hum and
//              (y₊ + y₋)/2 of the program (phase inversion: Hagerman & Olofsson, Acta Acustica 90(2), 2004); 10·log10 of
//              the hum's energy over the residual's, dB
//   prog SDR   the program as it comes out, (y₊ + y₋)/2 against x, dB; near lines: within ±5 Hz of every line to 4 kHz
//   SDR        y₊ against the clean program x, dB: hum left and program lost together, what the listener gets (primary)
//   PESQ       ITU-T P.862.2 wideband (python-pesq, the ITU reference C), y₊ against x at 16 kHz (speech, narration)
//   harm       clean material, no hum, through each (3 s of silence before): SDR against itself (∞: untouched), and
//              notes held at exactly 50, 60, 100 and 120 Hz in the music (1.5 s each, four partials, 10 dB under the
//              music): the SDR within ±2 Hz of each partial, dB
//   real hum   recordings with mains hum as recorded (no clean reference): VocalSet (Wilkins et al., ISMIR 2018; 60 Hz),
//              MIR-1K (Hsu & Jang 2010), DEMAND's DWASHING and OHALLWAY (Thiemann et al. 2013; 50 Hz), the readings
//              left out above and a VoiceBank take with a 49.86 Hz tone; f0 by measure(): the lines' power within
//              ±0.5 Hz of h·f0 to 1 kHz, dB down, and the rest of the spectrum (20 Hz–8 kHz beyond ±2 Hz of every h·f0),
//              SDR of output against input there. RX learns on the recording itself (no room tone: a select-all Learn)
// RX De-hum runs in a host of its own here (bench/rx/host.py keeps one instance per plugin, and what De-hum learns
// outlives reset() and a defaults reload): a new instance per render, half a second of silence through it first (a
// fresh instance's Static Learn takes nothing before a first block, as a host would have played one), Learn on the 3 s
// of room tone (enable_learning on for that pass, off for the take), then the take, as the manual has it ("select
// isolated hum and click Learn").
// Its output is aligned with its input (host.py lag: 0). Float parameters are set by value: Pedalboard quantizes them to
// a thousand steps (filter_q 2.97, dynamic_q 9.9), enough for the knobs swept here.
import { readFileSync, readdirSync, existsSync, mkdirSync, writeFileSync, unlinkSync, statSync, realpathSync } from 'node:fs'
import { spawn, spawnSync } from 'node:child_process'
import { createInterface } from 'node:readline'
import { createHash } from 'node:crypto'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { fft } from 'fourier-transform'
import { readWav, writeWav, op, lcg, mean, median, table, DATA, OUT as RXOUT } from './lib.mjs'
import { measure } from '@audio/denoise-dehum'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const OUT = path.join(RXOUT, 'dehum'), PY = process.env.RX_PYTHON || path.join(os.homedir(), '.cache', 'audiojs', 'venv', 'bin', 'python')
const PRE = 3                                                     // s of room tone (the hum alone) before every take
const f32 = p => new Float32Array(readFileSync(p).buffer.slice(0))
const E = (x, a = 0, b = x.length) => { let s = 0; for (let i = a; i < b; i++) s += x[i] * x[i]; return s }
const gauss = r => { let u = r() || 1e-12; return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * r()) }
const db = v => 10 * Math.log10(v)
const f1 = v => v === Infinity ? '∞' : Number.isFinite(v) ? v.toFixed(1) : '–'

// ---- material
const ls = (d, ext) => existsSync(d) ? readdirSync(d).filter(f => f.endsWith(ext)).sort().map(f => path.join(d, f)) : []
function speech(dir, clips) {
  let files = ls(dir, '.wav'), N = files.length
  return Array.from({ length: clips }, (_, k) => {
    let parts = Array.from({ length: 8 }, (_, j) => readWav(files[(k * 137 + j * 101) % N]).ch[0]), x = new Float32Array(parts.reduce((s, p) => s + p.length, 0)), o = 0
    for (let p of parts) x.set(p, o), o += p.length
    return { name: `speech${k}`, kind: 'speech', x, fs: 48000 }
  })
}
// readings whose recordings carry mains hum of their own (a line at 50.07, 50.01, 59.98, 50.00, 59.99 Hz standing
// 20 dB over its ±8 Hz): no clean reference for added hum; they are among the real hum
const OWN = ['2011-1943_The_Battle_of_Midway', '2016-Adelaide_article', 'En_Tenet__Film__article', 'Insider_trading', 'Red_vs_Blue_Part_2']
const own = f => OWN.includes(path.basename(f, '.f32'))
const narration = (dir, every) => ls(dir, '.f32').filter(f => !own(f)).filter((_, i) => i % every === 0).map(f => ({ name: `narration-${path.basename(f, '.f32').slice(0, 24)}`, kind: 'narration', x: f32(f).subarray(15 * 48000, 45 * 48000), fs: 48000 }))
function musdb(split, every) {
  let dir = path.join(DATA, 'musdb', `${split}-mono`)
  if (split === 'train' && !existsSync(dir)) {                    // decoded as accuracy.py decodes the test songs
    mkdirSync(dir, { recursive: true })
    ls(path.join(DATA, 'musdb', 'train'), '.stem.mp4').forEach((p, i) => spawnSync('ffmpeg', ['-v', 'error', '-i', p, '-map', '0:0', '-ac', '1', '-ar', '44100', '-f', 'f32le', path.join(dir, `${String(i).padStart(2, '0')}.f32`)]))
  }
  return ls(dir, '.f32').filter((_, i) => i % every === 0).map(f => ({ name: `musdb-${split}-${path.basename(f, '.f32')}`, kind: 'music', x: f32(f), fs: 44100 }))
}
const repair = () => ['vibeace', 'brahms', 'nutcracker', 'trumpet'].map(k => path.join(DATA, 'repair', `${k}.f32`)).filter(existsSync)
  .map(f => { let x = f32(f), s = x.length > 40 * 44100 ? 5 * 44100 : 0; return { name: path.basename(f, '.f32'), kind: 'music', x: x.subarray(s, s + 30 * 44100), fs: 44100 } })
const SPLITS = {
  tune: () => [...speech(path.join(DATA, 'vbdemand-train', 'clean'), 3), ...narration(path.join(DATA, 'spoken-train'), 4), ...musdb('train', 24)],
  test: () => [...speech(path.join(DATA, 'vbdemand', 'clean_testset_wav'), 6), ...narration(path.join(DATA, 'spoken'), 2), ...repair(), ...musdb('test', 8)],
}

// ---- hum
// a smooth random process at 100 Hz (white noise through two one-pole lowpasses, time constant tc s), unit variance
function slow(n, fs, r, tc) {
  let m = Math.ceil(n / fs * 100) + 2, a = Math.exp(-1 / (tc * 100)), u = 0, v = 0, s = new Float64Array(m), e = 0
  for (let i = -2000; i < m; i++) { u = a * u + (1 - a) * gauss(r); v = a * v + (1 - a) * u; if (i >= 0) s[i] = v, e += v * v }
  let g = Math.sqrt(m / e)
  return t => { let p = t * 100, j = Math.min(Math.floor(p), m - 2); return g * (s[j] + (p - j) * (s[j + 1] - s[j])) }
}
const CONDS = {
  mains50: { f0: 50, type: 'mains', dev: 0.05, lvl: -20 },
  buzz60: { f0: 60, type: 'buzz', dev: 0.05, lvl: -20 },
  drift: { f0: 50, type: 'buzz', dev: 0.2, lvl: -20 },
  steps: { f0: 50, type: 'mains', dev: 0.05, lvl: -20, steps: true },
  edits: { f0: 50, type: 'mains', dev: 0.05, lvl: -20, edits: true },
  quiet: { f0: 60, type: 'buzz', dev: 0.05, lvl: -30 },
}
const amps = (type, f0, fs) => {
  let a = []
  for (let h = 1; type === 'mains' ? h <= 12 : h * f0 <= Math.min(8000, fs / 2 - 1000); h++)
    a.push(type === 'mains' ? 1 / h : (h % 2 ? 1 : 0.3) / Math.sqrt(h) / Math.hypot(1, h * f0 / 3000))
  return a
}
// the hum over n samples: phase from the wandering frequency, harmonics by Chebyshev recursion (e^(jhφ) = e^(jφ)^h)
function humWave(n, fs, c, r) {
  let a = amps(c.type, c.f0, fs), H = a.length, f = slow(n, fs, r, 4), off = 0.03 * (2 * r() - 1)
  let lv = a.map(() => slow(n, fs, r, 10)), th = a.map(() => 2 * Math.PI * r()), y = new Float64Array(n), ph = 0
  let cr = Float64Array.from(th, Math.cos), ci = Float64Array.from(th, Math.sin), g = new Float64Array(H)
  for (let i = 0; i < n; i++) {
    ph += 2 * Math.PI * (c.f0 + off + c.dev / 2 * f(i / fs)) / fs
    if (i % 480 === 0) for (let k = 0; k < H; k++) g[k] = a[k] * (1 + 0.1 * lv[k](i / fs))
    let zr = Math.cos(ph), zi = Math.sin(ph), wr = zr, wi = zi, s = 0
    for (let k = 0; k < H; k++) { s += g[k] * (wr * cr[k] - wi * ci[k]); let t = wr * zr - wi * zi; wi = wr * zi + wi * zr; wr = t }
    y[i] = s
  }
  return y
}
// x's quietest 50 ms within ±0.5 s of sample i (its centre)
function quiet(x, fs, i) {
  let best = i, bv = Infinity
  for (let j = Math.max(0, i - fs / 2); j + fs / 20 < Math.min(x.length, i + fs / 2); j += fs / 100) { let e = E(x, j, j + fs / 20); if (e < bv) bv = e, best = j + fs / 40 }
  return Math.round(best)
}
// the mixture for clip and condition: { P, x (program, P zeros first), h (hum), at (splices) }
function mixture(clip, cname, seed) {
  let c = CONDS[cname], { fs } = clip, r = lcg(seed), P = PRE * fs, n = clip.x.length, N = P + n
  let x = new Float32Array(N); x.set(clip.x, P)
  let cuts = [], extra = 0
  if (c.edits) for (let k = 0; k < 6; k++) {                     // six splices, the stretch taken out 0.1–2 s long
    let t = P + Math.round((k + 0.5 + 0.6 * (r() - 0.5)) * n / 6), d = Math.round((0.1 + 1.9 * r()) * fs)
    cuts.push([clip.kind === 'music' ? t : quiet(x, fs, t), d]); extra += d
  }
  let h0 = humWave(N + extra, fs, c, r), h = new Float64Array(N)
  for (let i = 0, j = 0, k = 0; i < N; i++, j++) { if (k < cuts.length && i === cuts[k][0]) j += cuts[k++][1]; h[i] = h0[j] }
  if (c.steps) {                                                  // four level steps in the take, 10 ms raised-cosine ramps
    let lv = [0], t = [P]
    for (let k = 0; k < 4; k++) t.push(P + Math.round((k + 0.6 + 0.6 * r()) * n / 4.6)), lv.push([-Infinity, -10, -5, 0, 5][Math.floor(r() * 5)])
    let ramp = Math.round(0.01 * fs), gain = l => 10 ** (l / 20)
    for (let i = P; i < N; i++) {
      let k = 0; while (k + 1 < t.length && i >= t[k + 1]) k++
      let g = gain(lv[k]), u = i - t[k]
      if (k > 0 && u < ramp) { let w = 0.5 - 0.5 * Math.cos(Math.PI * u / ramp); g = (1 - w) * gain(lv[k - 1]) + w * g }
      h[i] *= g
    }
  }
  let s = Math.sqrt(E(clip.x) / E(h0, 0, N)) * 10 ** (c.lvl / 20)
  for (let i = 0; i < N; i++) h[i] *= s
  return { P, x, h, fs, at: cuts.map(([i]) => i) }
}

// ---- systems: ({ ch, sr }, learn) → { ch, sr }; learn: the room tone RX learns on
// RX De-hum, a new instance per render; an optional Learn pass first (learn.params on, then off), as described above
const DRIVER = `
import sys, json, numpy as np, soundfile as sf, pedalboard
put = lambda p, q: [setattr(p, k, v) for k, v in q.items()]
for line in sys.stdin:
    try:
        j = json.loads(line); p = pedalboard.load_plugin('/Library/Audio/Plug-Ins/VST3/RX 12 %s.vst3' % j['plugin']); put(p, j['params'])
        p.process(np.zeros((1, 24000), np.float32), 48000)    # a first block: before one, Static's Learn takes nothing
        if j.get('learn'):
            was = {k: getattr(p, k) for k in j['learn']['params']}
            a, fa = sf.read(j['learn']['in'], dtype='float32', always_2d=True)
            put(p, j['learn']['params']); p.process(np.ascontiguousarray(a.T), fa); put(p, was)
        x, fs = sf.read(j['in'], dtype='float32', always_2d=True)
        sf.write(j['out'], p.process(np.ascontiguousarray(x.T), fs).T, fs, subtype='FLOAT')
        print(json.dumps({'out': j['out']}), flush=True)
    except Exception as e: print(json.dumps({'error': repr(e)}), flush=True)
`
const hosts = [], WORKERS = +process.env.RX_WORKERS || 3
let seq = 0
const hold = (h, on) => [h.p, h.p.stdin, h.p.stdout].forEach(s => on ? s.ref() : s.unref())   // idle hosts keep Node alive no longer
function host() {
  let h = hosts.reduce((a, b) => !a || b.q.length < a.q.length ? b : a, null)
  if (hosts.length < WORKERS && (!h || h.q.length)) {
    let p = spawn(PY, ['-c', DRIVER], { stdio: ['pipe', 'pipe', 'ignore'] })
    hosts.push(h = { p, q: [] })
    createInterface({ input: p.stdout }).on('line', l => { let r = JSON.parse(l), j = h.q.shift(); r.error ? j.reject(new Error(r.error)) : j.resolve(); if (!h.q.length) hold(h, false) })
  }
  return h
}
const rx = (params, learn = { enable_learning: true }) => async ({ ch, sr }, room) => {
  let tmp = path.join(OUT, 'tmp', `${process.pid}-${seq++}`), i = tmp + '-in.wav', o = tmp + '-out.wav', l = tmp + '-learn.wav'
  writeWav(i, ch, sr); if (learn) writeWav(l, room, sr)
  let h = host()
  try {
    await new Promise((resolve, reject) => { h.q.push({ resolve, reject }); hold(h, true); h.p.stdin.write(JSON.stringify({ plugin: 'De-hum', params, in: i, out: o, learn: learn && { in: l, params: learn } }) + '\n') })
    return readWav(o)
  } finally { for (let f of [i, o, l]) existsSync(f) && unlinkSync(f) }
}
// ---- measures
// energy per band of a real signal's spectrum: bands [[lo, hi], ...] Hz, over one transform
function bandE(v, fs, bands) {
  let N = 2 ** Math.ceil(Math.log2(v.length)), a = new Float64Array(N); a.set(v)
  let [re, im] = fft(a), out = bands.map(() => 0)
  bands.forEach(([lo, hi], b) => { for (let k = Math.max(0, Math.ceil(lo * N / fs)); k <= Math.min(N / 2, Math.floor(hi * N / fs)); k++) out[b] += re[k] ** 2 + im[k] ** 2 })
  return out
}
const lines = (f0, fs, w) => { let b = []; for (let h = 1; h * f0 <= Math.min(4000, fs / 2 - w); h++) b.push([h * f0 - w, h * f0 + w]); return b }
function score(mix, yp, ym, f0) {
  let { P, x, h, fs } = mix, N = x.length, he = 0, hr = 0, xe = 0, pe = 0, de = 0, pr = new Float64Array(N - P), xr = new Float64Array(N - P)
  for (let i = P; i < N; i++) {
    let p = (yp[i] + ym[i]) / 2, r = (yp[i] - ym[i]) / 2
    he += h[i] ** 2; hr += r * r; xe += x[i] ** 2; pe += (p - x[i]) ** 2; de += (yp[i] - x[i]) ** 2; pr[i - P] = p - x[i]; xr[i - P] = x[i]
  }
  let b = lines(f0, fs, 5), sx = bandE(xr, fs, b).reduce((s, v) => s + v, 0), se = bandE(pr, fs, b).reduce((s, v) => s + v, 0)
  return { hd: db(he / hr), ps: db(xe / pe), near: db(sx / se), sdr: db(xe / de), in: db(xe / he) }
}

// PESQ (wideband, 16 kHz) of each [ref, deg] pair of Float32Arrays at fs
function pesq(pairs, fs) {
  let dir = path.join(OUT, 'tmp'), todo = pairs.map(([r, d], i) => { let a = path.join(dir, `${process.pid}-pesq${i}-r.wav`), b = path.join(dir, `${process.pid}-pesq${i}-d.wav`); writeWav(a, [r], fs); writeWav(b, [d], fs); return [i, a, b] })
  let py = `import sys, json, soundfile as sf
from pesq import pesq
from scipy.signal import resample_poly
def one(t):
    k, a, b = t; r, fs = sf.read(a); d, _ = sf.read(b)
    q = lambda v: resample_poly(v, 1, 3) if fs == 48000 else resample_poly(v, 160, 441)
    try: return pesq(16000, q(r), q(d), 'wb')
    except Exception as e: return None
print(json.dumps([one(t) for t in json.load(sys.stdin)]))`
  let r = spawnSync(PY, ['-c', py], { input: JSON.stringify(todo), maxBuffer: 1 << 26 })
  for (let [, a, b] of todo) unlinkSync(a), unlinkSync(b)
  return JSON.parse(r.stdout.toString())
}
const KINDS = ['speech', 'narration', 'music']

// ours as `audio` runs it; its scores kept per version and source hash
const DEHUM = realpathSync(path.join(HERE, '..', '..', 'node_modules', '@audio', 'denoise-dehum'))
const OURS = `ours ${JSON.parse(readFileSync(path.join(DEHUM, 'package.json'))).version}-${createHash('sha1').update(readFileSync(path.join(DEHUM, 'dehum.js'))).digest('hex').slice(0, 8)}`
const BEFORE = process.env.DEHUM_BEFORE || 'ours 0.4.0-4d41fbde'              // the published 0.4.0: its scores kept
const ours = op('dehum()')

// RX at its defaults: Dynamic, sensitivity 5, 128 bands, Q 1000, its profile learned on the room tone. Tuned: the best
// mean SDR over the tuning split's conditions (`tune` prints the grid): Dynamic, sensitivity 1, Q 10000
const RX_DEFAULT = {}
const RX_TUNED = { dynamic_sensitivity: 1, dynamic_q: 10000 }
const SYSTEMS = { 'rx default': rx(RX_DEFAULT), 'rx tuned': rx(RX_TUNED) }

// Scores are kept, not renders (a render is scored and let go): OUT/<split>/<system>.json, by item
const books = {}
const book = (split, label) => books[split + label] ??= (f => ({ f, s: existsSync(f) ? JSON.parse(readFileSync(f), (k, v) => v === 'Infinity' || v === null && (k === 'sdr' || k === 'notes' || k === 'rest') ? Infinity : v) : {} }))(path.join(OUT, split, `${label}.json`))
const save = b => { mkdirSync(path.dirname(b.f), { recursive: true }); writeFileSync(b.f, JSON.stringify(b.s, (k, v) => v === Infinity ? 'Infinity' : v)) }
// one input through a system: the take (the room tone before it left out); the room tone is what RX learns on
const run = async (sys, input, P, fs) => (await sys({ ch: [input], sr: fs }, [Float32Array.from(input.subarray(0, P))])).ch[0]

// items in flight four at a time; each `one(item)` resolves when its systems are scored
async function each(items, one, tag) {
  let done = 0
  for (let i = 0, live = []; i < items.length || live.length;) {
    while (live.length < 4 && i < items.length) { let p = one(items[i++]).then(() => { live.splice(live.indexOf(p), 1); process.stderr.write(`\r${tag} ${++done}/${items.length}   `) }); live.push(p) }
    await Promise.race(live)
  }
  process.stderr.write('\n')
}

// hum added: per condition, every clip through every system (y₊, and y₋ unless signs is [1]); res[label][cond][kind]
async function evaluate(split, systems, { signs = [1, -1], conds = Object.keys(CONDS), clips = SPLITS[split](), withPesq = true } = {}) {
  let res = {}
  for (let [ci, cname] of conds.entries()) {
    let fresh = []
    await each(clips.map((clip, k) => [clip, k]), async ([clip, k]) => {
      let key = `${clip.name}|${cname}`, mix = null
      for (let [label, sys] of Object.entries(systems)) {
        let b = book(split, label), s = b.s[key]
        if (!s || signs.length > 1 && !('hd' in s) || withPesq && clip.kind !== 'music' && !('pesq' in s)) {
          if (!sys) throw new Error(`${label}: no score for ${key}`)
          mix ??= mixture(clip, cname, 1000 * (ci + 1) + k)
          let [yp, ym] = await Promise.all(signs.map(sg => run(sys, Float32Array.from(mix.x, (v, i) => v + sg * mix.h[i]), mix.P, mix.fs)))
          let x = mix.x.subarray(mix.P)
          s = ym ? score(mix, yp, ym, CONDS[cname].f0) : { sdr: db(E(x) / E(x.map((v, i) => yp[mix.P + i] - v))) }
          if (withPesq && clip.kind !== 'music') fresh.push([s, Float32Array.from(x), yp.slice(mix.P), clip.fs, b])
          b.s[key] = s; save(b)
        }
        ;(((res[label] ??= {})[cname] ??= {})[clip.kind] ??= []).push(s)
      }
    }, `${split} ${cname}`)
    for (let fs of new Set(fresh.map(b => b[3]))) {
      let bs = fresh.filter(b => b[3] === fs)
      pesq(bs.map(b => [b[1], b[2]]), fs).forEach((v, i) => bs[i][0].pesq = v)
    }
    for (let b of new Set(fresh.map(b => b[4]))) save(b)
  }
  return res
}
const avg = (ss, k) => ss?.length ? mean(ss.map(s => s[k]).filter(Number.isFinite)) : NaN

// clean material through each system, no hum (3 s of silence before it, where RX learns): the program's SDR against
// itself (∞ untouched), and on the music with notes held at exactly 50, 60, 100 and 120 Hz (1.5 s each, four partials
// at 1/k, 1 s decay, 10 dB under the music) their SDR within ±2 Hz of each partial
const NOTES = [50, 60, 100, 120]
function noted(clip) {
  let { fs } = clip, x = Float32Array.from(clip.x), n = x.length, g = Math.sqrt(E(x) / n) * 10 ** (-10 / 20), bands = []
  NOTES.forEach((f, j) => {
    let t0 = Math.round((0.1 + 0.2 * j) * n), L = Math.min(Math.round(1.5 * fs), n - t0), a = new Float64Array(L), e = 0
    for (let i = 0; i < L; i++) { for (let k = 1; k <= 4; k++) a[i] += Math.sin(2 * Math.PI * k * f * i / fs + k) / k; a[i] *= Math.exp(-i / fs) }
    for (let i = 0; i < L; i++) e += a[i] * a[i]
    for (let i = 0; i < L; i++) x[t0 + i] += a[i] * g * Math.sqrt(L / e)
    for (let k = 1; k <= 4; k++) bands.push([k * f - 2, k * f + 2])
  })
  return { ...clip, name: clip.name + '+notes', x, bands }
}
async function harm(systems) {
  let clips = SPLITS.test(), items = [...clips, ...clips.filter(c => c.kind === 'music').map(noted)], res = {}
  await each(items, async clip => {
    let key = clip.name, P = PRE * clip.fs, input = new Float32Array(P + clip.x.length)
    input.set(clip.x, P)
    for (let [label, sys] of Object.entries(systems)) {
      let b = book('harm', label), s = b.s[key]
      if (!s) {
        if (!sys) throw new Error(`${label}: no score for ${key}`)
        let y = (await run(sys, input, P, clip.fs)).subarray(P), x = clip.x, e = Float64Array.from(x, (v, i) => y[i] - v), ex = E(x), ee = E(e)
        s = { sdr: ee ? db(ex / ee) : Infinity, same: y.every((v, i) => v === x[i]) }
        if (clip.bands) { let px = bandE(x, clip.fs, clip.bands), pe = bandE(e, clip.fs, clip.bands); s.notes = db(px.reduce((a, v) => a + v, 0) / (pe.reduce((a, v) => a + v, 0) || 1e-300)) }
        b.s[key] = s; save(b)
      }
      ;((res[label] ??= {})[clip.bands ? 'notes' : clip.kind] ??= []).push(s)
    }
  }, 'harm')
  return res
}

// clean material at scale, no hum: a take ours changes at all is a false alarm, its cost the SDR of what comes out
// against what went in. MUSDB18's 94 training and 50 test previews (7 s), the four pieces of repair/ whole, every third
// VocalSet take, every third GuitarSet take (mono-mic, its first 30 s)
const walk = d => existsSync(d) ? readdirSync(d, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]) : []
const wav = (f, s = Infinity) => () => { let w = readWav(f); return { x: w.ch[0].subarray(0, s * w.sr), fs: w.sr } }
const third = (d, set, s) => walk(path.join(DATA, d)).filter(f => f.endsWith('.wav')).sort().filter((_, i) => i % 3 === 0).map(f => ({ set, f, load: wav(f, s) }))
const CLEAN = () => [
  ...['train', 'test'].flatMap(k => ls(path.join(DATA, 'musdb', `${k}-mono`), '.f32').map(f => ({ set: `MUSDB18 ${k}`, f, load: () => ({ x: f32(f), fs: 44100 }) }))),
  ...ls(path.join(DATA, 'repair'), '.f32').map(f => ({ set: 'pieces', f, load: () => ({ x: f32(f), fs: 44100 }) })),
  ...third('vocalset', 'VocalSet'), ...third(path.join('guitarset', 'audio_mono-mic'), 'GuitarSet', 30),
]
async function clean() {
  let items = CLEAN(), b = book('clean', OURS), res = []
  await each(items, async it => {
    let key = path.relative(DATA, it.f), s = b.s[key]
    if (!s) {
      let { x, fs } = it.load(), y = (await ours({ ch: [x], sr: fs })).ch[0], ee = 0
      for (let i = 0; i < x.length; i++) ee += (y[i] - x[i]) ** 2
      s = b.s[key] = { sdr: ee ? db(E(x) / ee) : Infinity }; save(b)
    }
    res.push({ set: it.set, key, ...s })
  }, 'clean')
  console.log(`Clean takes, no hum, through ${OURS}: those changed at all (false alarms) and the worst SDR of a take against itself, dB\n`)
  console.log(table(['material', 'takes', 'changed', 'worst SDR'], [...new Set(items.map(i => i.set))].map(k => {
    let ss = res.filter(r => r.set === k), ch = ss.filter(r => r.sdr !== Infinity)
    return [k, ss.length, ch.length, ch.length ? f1(Math.min(...ch.map(r => r.sdr))) : '∞']
  })))
  for (let r of res.filter(r => r.sdr !== Infinity)) console.log(`${r.key}: ${f1(r.sdr)} dB`)
}

// hum as recorded: no clean reference. The series measure() finds in the input (its f0); the lines' power within
// ±0.5 Hz of h·f0 to 1 kHz before over after, dB; the rest of the spectrum (20 Hz–8 kHz beyond ±2 Hz of every h·f0)
// as it comes out against as it went in, SDR. RX learns on the recording itself (a select-all Learn: no room tone)
const REAL = () => {
  let scan = ['vocalset/FULL/female2/long_tones/straight/f2_long_straight_a', 'vocalset/FULL/female2/scales/straight/f2_scales_straight_a',
    'vocalset/FULL/female3/arpeggios/slow_forte/f3_arpeggios_c_slow_forte_a', 'vocalset/FULL/female3/excerpts/vibrato/f3_caro_vibrato',
    'vocalset/FULL/female3/long_tones/straight/f3_long_straight_a', 'vocalset/FULL/female7/excerpts/vibrato/f7_caro_vibrato',
    'vocalset/FULL/male9/excerpts/straight/m9_caro_straight', 'vocalset/FULL/male9/long_tones/messa/m9_long_messa_a',
    'vocalset/FULL/male9/scales/vibrato/m9_scales_vibrato_a', 'mir-1k/MIR-1K/Wavfile/heycat_1_01', 'mir-1k/MIR-1K/Wavfile/jmzen_3_03',
    'mir-1k/MIR-1K/Wavfile/titon_4_06', 'demand/DWASHING/ch01', 'demand/OHALLWAY/ch01', 'vbdemand-train/noisy/p236_002']
  let out = scan.map(p => path.join(DATA, p + '.wav')).filter(existsSync).map(f => { let w = readWav(f); return { name: f.slice(DATA.length + 1, -4), x: w.ch[0].subarray(0, 30 * w.sr), fs: w.sr } })
  for (let d of ['spoken', 'spoken-train']) for (let f of ls(path.join(DATA, d), '.f32').filter(own)) out.push({ name: `${d}/${path.basename(f, '.f32')}`, x: f32(f).subarray(15 * 48000, 45 * 48000), fs: 48000 })
  return out
}
async function real(systems) {
  let res = {}
  await each(REAL(), async item => {
    let { x, fs } = item, m = measure(x, fs)
    for (let [label, sys] of Object.entries(systems)) {
      let b = book('real', label), s = b.s[item.name]
      if (!s && m) {
        if (!sys) throw new Error(`${label}: no score for ${item.name}`)
        let y = (await sys({ ch: [x], sr: fs }, [x])).ch[0]
        let on = [], off = [[20, Math.min(8000, fs / 2)]]
        for (let h = 1; h * m.f0 <= 1000; h++) on.push([h * m.f0 - 0.5, h * m.f0 + 0.5])
        let e = Float64Array.from(x, (v, i) => y[i] - v), lin = bandE(x, fs, on), lout = bandE(y, fs, on), ex = 0, ee = 0
        let N = 2 ** Math.ceil(Math.log2(x.length)), [ar, ai] = fft(Float64Array.from({ length: N }, (_, i) => i < x.length ? x[i] : 0)).map(v => Float64Array.from(v)), [br, bi] = fft(Float64Array.from({ length: N }, (_, i) => i < x.length ? e[i] : 0))
        for (let k = Math.ceil(20 * N / fs); k <= Math.min(N / 2, 8000 * N / fs); k++) {
          let f = k * fs / N, h = Math.round(f / m.f0)
          if (h >= 1 && Math.abs(f - h * m.f0) <= 2) continue
          ex += ar[k] ** 2 + ai[k] ** 2; ee += br[k] ** 2 + bi[k] ** 2
        }
        s = { f0: m.f0, down: db(lin.reduce((a, v) => a + v, 0) / lout.reduce((a, v) => a + v, 0)), rest: ee ? db(ex / ee) : Infinity }
        b.s[item.name] = s; save(b)
      }
      if (s) (res[label] ??= []).push({ name: item.name, ...s })
    }
  }, 'real')
  return res
}

async function tune() {
  // RX's main knobs from its defaults: mode, sensitivity, filter Q, learning; scored by mean SDR (y₊ against x)
  let grid = {
    'default (Dynamic, learned)': {},
    'Dynamic, sensitivity 0.3': { dynamic_sensitivity: 0.3 },
    'Dynamic, sensitivity 1': { dynamic_sensitivity: 1 },
    'Dynamic, sensitivity 3': { dynamic_sensitivity: 3 },
    'Dynamic, sensitivity 1, Q 3000': { dynamic_sensitivity: 1, dynamic_q: 3000 },
    'Dynamic, sensitivity 1, Q 10000': { dynamic_sensitivity: 1, dynamic_q: 10000 },
    'Static, learned, 16 harmonics': { hum_mode: 'Static', number_of_harmonics: 16 },
    'Static, learned, 16 harmonics, linear-phase': { hum_mode: 'Static', number_of_harmonics: 16, linear_phase_filters: true },
    'Static, learned, 16 harmonics, Q 300, linear-phase': { hum_mode: 'Static', number_of_harmonics: 16, filter_q: 300, linear_phase_filters: true },
    'Static, learned, 16 harmonics, Q 3000, linear-phase': { hum_mode: 'Static', number_of_harmonics: 16, filter_q: 3000, linear_phase_filters: true },
    'Static, adaptive, 16 harmonics, linear-phase': { hum_mode: 'Static', number_of_harmonics: 16, linear_phase_filters: true, enable_adaptive_learning: true },
  }
  if (process.argv[3]) grid = Object.fromEntries(Object.entries(grid).filter(([k]) => new RegExp(process.argv[3]).test(k)))
  let systems = Object.fromEntries(Object.entries(grid).map(([k, p]) => [`rx ${k}`, rx(p)]))
  systems[OURS] = ours
  let clips = SPLITS.tune(), res = await evaluate('tune', systems, { signs: [1], clips, withPesq: false })
  console.log(`Tuning split (${clips.length} clips: ${KINDS.map(k => `${clips.filter(c => c.kind === k).length} ${k}`).join(', ')}): SDR against the clean program, dB, mean per condition\n`)
  let rows = Object.entries(res).map(([label, by]) => [label, ...Object.keys(CONDS).map(c => f1(avg(Object.values(by[c] || {}).flat(), 'sdr'))), f1(mean(Object.keys(CONDS).map(c => avg(Object.values(by[c] || {}).flat(), 'sdr'))))])
  console.log(table(['system', ...Object.keys(CONDS), 'mean'], rows.sort((a, b) => b.at(-1) - a.at(-1))))
}

async function test() {
  let systems = { ...SYSTEMS, [BEFORE]: OURS === BEFORE ? ours : null }
  if (OURS !== BEFORE) systems[OURS] = ours
  let labels = Object.keys(systems), res = await evaluate('test', systems), hm = await harm(systems), rl = await real(systems)
  let input = c => KINDS.map(k => mean((res[labels[0]][c]?.[k] || []).map(s => s.in)))
  console.log(`Test split (${SPLITS.test().length} clips), per condition and material: hum down / SDR against the clean program (PESQ), dB, mean over clips; input: SDR as it came\n`)
  let rows = []
  for (let c of Object.keys(CONDS)) KINDS.forEach((k, j) => rows.push([`${c} ${k}`, f1(input(c)[j]), ...labels.map(l => { let ss = res[l][c]?.[k]; return ss ? `${f1(avg(ss, 'hd'))} / ${f1(avg(ss, 'sdr'))}${k !== 'music' ? ` (${avg(ss, 'pesq').toFixed(2)})` : ''}` : '' })]))
  console.log(table(['condition', 'input', ...labels], rows))
  console.log(`\nProgram SDR overall / within ±5 Hz of the lines (by phase inversion), dB\n`)
  rows = []
  for (let c of Object.keys(CONDS)) for (let k of KINDS) rows.push([`${c} ${k}`, ...labels.map(l => { let ss = res[l][c]?.[k]; return ss ? `${f1(avg(ss, 'ps'))} / ${f1(avg(ss, 'near'))}` : '' })])
  console.log(table(['condition', ...labels], rows))
  console.log(`\nMean over conditions and materials\n`)
  console.log(table(['system', 'hum down, dB', 'SDR, dB', 'PESQ'], labels.map(l => [l, ...['hd', 'sdr', 'pesq'].map(m => { let v = mean(Object.values(res[l]).flatMap(by => Object.values(by)).map(ss => avg(ss, m)).filter(Number.isFinite)); return m === 'pesq' ? v.toFixed(2) : f1(v) })])))
  console.log(`\nClean material, no hum: SDR of what comes out against what went in (∞: untouched; median, worst), untouched share; the notes at 50/60/100/120 Hz within ±2 Hz\n`)
  rows = [...KINDS, 'notes'].map(k => [k, ...labels.map(l => { let ss = hm[l]?.[k] || [], v = ss.map(s => s.sdr); return `${f1(median(v))}, ${f1(Math.min(...v))}; ${ss.filter(s => s.same).length}/${ss.length}${k === 'notes' ? `; notes ${f1(median(ss.map(s => s.notes)))}` : ''}` })])
  console.log(table(['material', ...labels], rows))
  console.log(`\nHum as recorded (no reference): its lines to 1 kHz down / the rest of the spectrum's SDR, dB\n`)
  let names = [...new Set(Object.values(rl).flatMap(v => v.map(s => s.name)))]
  console.log(table(['recording', 'f0', ...labels], names.map(n => [n.replace(/^.*\//, ''), (rl[labels[0]]?.find(s => s.name === n)?.f0 ?? NaN).toFixed(2), ...labels.map(l => { let s = rl[l]?.find(s => s.name === n); return s ? `${f1(s.down)} / ${f1(s.rest)}` : '' })])))
}

export { SPLITS, CONDS, mixture, score, E }
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  let cmd = process.argv[2]
  if (cmd === 'tune') await tune()
  else if (cmd === 'test') await test()
  else if (cmd === 'clean') await clean()
  else console.log('usage: node bench/rx/dehum.mjs tune [GRID] | test | clean')
}
