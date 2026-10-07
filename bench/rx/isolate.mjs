// Dialogue isolation on mixtures harder than VoiceBank+DEMAND's: iZotope RX 12 Dialogue Isolate (bench/rx/host.py)
// against our deepfilter on the same buffers, and what each does where there is no dialogue to isolate.
//
//   node bench/rx/isolate.mjs SPLIT CONDITIONS SYSTEM [SYSTEM...]    render what is missing, score, print the tables
//   SHARD=k/N node bench/rx/isolate.mjs ...                            render every N-th take from the k-th, no scores
//
// SPLIT: `tune` (every setting, RX's and ours, is chosen on it) or `test` (reported once chosen).
// CONDITIONS: comma-separated, or `all`. SYSTEM: `input` (the mixture as it is), a name of SYSTEMS below,
// `rx:k=v;k=v` (Dialogue Isolate from its defaults, its noise off unless given; -inf turns a gain off),
// `op:<stages>` (audio's chain, as the editor runs it: op:deepfilter(12)), or `nd:{json}` (@audio/neural-denoise's
// denoise() with DeepFilterNet3 and these options, one thread, as audio's deepfilter op runs it: heard again with the
// room's prediction off where its voice carries a room, fn/deepfilter.js roomless()). Ours render under the two
// packages' versions, neural-denoise's and denoise-dereverb's (and TAG), as 0.5.0-drv0.6.0; SYSTEM@VERSION reads what
// an earlier version rendered (dfn@0.5.0: before the room's prediction). VS=SYSTEM sets what the Δ columns pair against.
//
// Speech: VoiceBank's clean takes (Valentini-Botinhao 2017, CC BY 4.0, doi:10.7488/ds/2117), 48 kHz, at -26 dBFS
// active level (ITU-T P.56's nominal; active: the 10 ms frames within 35 dB of the 99th-percentile one). tune: every
// 5th of the 504 training takes in vbdemand-train/clean (28 speakers); test: every 8th of the 824 test takes (p232,
// p257). The interferer is set by active levels; its stretch starts at a seeded offset (lib.mjs lcg).
//   noise-5, noise0, noise5: DEMAND (Thiemann, Ito, Vincent 2013, CC BY-SA 3.0), DWASHING, NFIELD, NPARK, NRIVER and
//     OHALLWAY in turn (none of them in VoiceBank+DEMAND), from their first 150 s (tune) or last 150 s (test)
//   babble0, babble5: six narrators at once, each at the same level: Spoken Wikipedia narrations (CC BY-SA), the ten
//     in spoken-train (tune) or the ten in spoken (test), as bench/speech.mjs reads them
//   music0, music5: a song's accompaniment, MUSDB18's drums, bass and other stems (Rafii et al. 2017; its 7 s
//     previews, train / test split, guard/*-instr as @audio/neural-denoise's scripts/accuracy.py writes them)
//   reverb5: the take in a room of the MIT IR Survey (Traer & McDermott, PNAS 2016; 32 kHz, resampled to 48 kHz;
//     even-numbered responses for tune, odd for test, those whose direct sound and first 50 ms stand under 12 dB over
//     the rest), with 0.4 s for the tail, plus DEMAND noise at 5 dB; the reference is the early part, the direct sound
//     and 50 ms, at the dry take's energy (@audio/denoise's scripts/dereverb.py splits rooms so)
//   clean: the take alone, nothing to remove (do no harm)
//   music: no dialogue, music alone: MUSDB18 test (or train) previews, songs and accompaniments in turn, 44.1 kHz
// Scores (bench/speech.py's functions, Python): speech at 16 kHz (output and reference through the same 1:3 polyphase
// low-pass as scipy.signal.resample_poly), PESQ (ITU-T P.862.2 wideband, python-pesq 0.0.4), STOI (Taal et al.,
// IEEE TASLP 2011, pystoi), SI-SDR (Le Roux et al., ICASSP 2019), DNSMOS P.835 SIG, BAK, OVRL (Reddy, Gopal, Cutler,
// ICASSP 2022) at the reference's loudness (ITU-R BS.1770, pyloudnorm), and the active level against the reference
// (clean); music at its own rate, against the input: SI-SDR (inf: bit for bit), the level change per band.
// Renders: DATA/rx/isolate/SPLIT/CONDITION/SYSTEM/<take>.wav (16 kHz float; music at its own rate), per-take scores
// in scores.json beside them, the references in ref/.
import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { cfft, cifft } from 'fourier-transform'
import { DATA, OUT, rx, op, readWav, writeWav, lcg, table, mean } from './lib.mjs'

const ROOT = path.join(OUT, 'isolate'), HERE = path.dirname(fileURLToPath(import.meta.url))
const PY = process.env.RX_PYTHON || path.join(DATA, '..', 'venv', 'bin', 'python'), JOBS = +(process.env.JOBS || 4)
const SR = 48000, LEVEL = -26, HALF = 150 * SR

// RX at its defaults with its noise off; RX as tuned on `tune` (sensitivity 0, 2.5, 5, 7.5, 10 and the reverb off
// tried: the reverb off too, its mean PESQ and OVRL over the speech conditions the highest); ours as the editor runs
// it (fn/deepfilter.js: denoise() unlimited, run again on the take with the room's prediction off where its output
// still carries a room, mixback() after), on one ORT thread; dfn-floor0 is neural-denoise 0.4's op, bit for bit but
// for rooms. On `tune`, reverb5: the room's prediction off before the model, PESQ 1.88 → 1.96, SI-SDR 7.3 → 7.9 dB
// (forced on every take); dereverb() whole after the model 1.89, before it 1.87 (OVRL −0.09); asked of the take
// rather than of the model's voice, it also ran on a fifth of the noise and babble takes (PESQ −0.01)
export const SYSTEMS = {
  'rx-di': 'rx:',
  'rx-di-tuned': 'rx:reverb_gain_db=-inf',
  dfn: 'nd:{}',
  'dfn-floor0': 'nd:{"floor":0}',
}

// ------------------------------------------------ signal helpers

export const f32 = p => { let b = readFileSync(p); return new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)) }
const pow = (x, a = 0, b = x.length) => { let s = 0; for (let i = a; i < b; i++) s += x[i] * x[i]; return s / Math.max(1, b - a) }
// P.56-like active level: the mean power of the 10 ms frames within 35 dB of the 99th-percentile frame
function active(x, sr = SR) {
  let F = sr / 100 | 0, p = []
  for (let i = 0; i + F <= x.length; i += F) p.push(pow(x, i, i + F))
  let s = [...p].sort((a, b) => a - b), q = s[Math.floor(0.99 * (s.length - 1))] * 10 ** -3.5, on = p.filter(v => v > q)
  return on.length ? mean(on) : 0
}
const scale = (x, g) => x.map(v => v * g)
export const at = (x, db) => scale(x, Math.sqrt(10 ** (db / 10) / (active(x) || 1)))
export const add = (a, b) => a.map((v, i) => v + (b[i] ?? 0))
// b set to `snr` dB under a, by active levels
export const under = (a, b, snr) => scale(b, Math.sqrt(active(a) / (active(b) || 1) * 10 ** (-snr / 10)))
// n samples of x from `o`, x tiled where it runs out
export const cut = (x, o, n) => Float32Array.from({ length: n }, (_, i) => x[(o + i) % x.length])

// scipy.signal.resample_poly(x, 1, 3): a 61-tap low-pass at 1/3 of Nyquist, Kaiser β = 5, centered
const I0 = x => { let s = 1, t = 1; for (let k = 1; k < 30; k++) t *= (x / 2 / k) ** 2, s += t; return s }
const H3 = (() => {
  let n = 61, h = Float64Array.from({ length: n }, (_, k) => {
    let m = k - 30, w = I0(5 * Math.sqrt(1 - (m / 30) ** 2)) / I0(5)
    return (m ? Math.sin(Math.PI * m / 3) / (Math.PI * m) : 1 / 3) * w
  }), s = h.reduce((a, b) => a + b, 0)
  return h.map(v => v / s)
})()
function down3(x) {
  let y = new Float32Array(Math.ceil(x.length / 3))
  for (let n = 0; n < y.length; n++) {
    let s = 0
    for (let k = 0; k < 61; k++) { let i = 3 * n + 30 - k; if (i >= 0 && i < x.length) s += H3[k] * x[i] }
    y[n] = s
  }
  return y
}

// linear convolution by FFT, the first n samples
function conv(x, h, n) {
  let N = 2; while (N < x.length + h.length) N *= 2
  let ar = new Float64Array(N), ai = new Float64Array(N), br = new Float64Array(N), bi = new Float64Array(N)
  ar.set(x); br.set(h); cfft(ar, ai); cfft(br, bi)
  for (let k = 0; k < N; k++) { let r = ar[k] * br[k] - ai[k] * bi[k]; ai[k] = ar[k] * bi[k] + ai[k] * br[k]; ar[k] = r }
  cifft(ar, ai)
  return Float32Array.from(ar.subarray(0, n))
}

const to48 = async (x, sr) => sr === SR ? x : (await op(`resample(${SR})`)({ ch: [x], sr })).ch[0]

// ------------------------------------------------ sources

const memo = (f, m = new Map()) => k => m.has(k) ? m.get(k) : (m.set(k, f(k)), m.get(k))
const VB = { tune: ['vbdemand-train/clean', 5], test: ['vbdemand/clean_testset_wav', 8] }
const takes = split => {
  let [d, k] = VB[split]
  return readdirSync(path.join(DATA, d)).filter(f => f.endsWith('.wav')).sort().filter((_, i) => i % k === 0).map(f => [f.slice(0, -4), path.join(DATA, d, f)])
}
const NOISES = ['DWASHING', 'NFIELD', 'NPARK', 'NRIVER', 'OHALLWAY']
const noise = memo(n => readWav(path.join(DATA, 'demand', n, 'ch01.wav')).ch[0])
// the noise for take i: its stretch of the split's half
export const demand = (split, i, n, r) => cut(noise(NOISES[i % NOISES.length]), (split === 'test' ? HALF : 0) + Math.floor(r() * (HALF - n)), n)
const narrations = memo(split => { let d = path.join(DATA, split === 'test' ? 'spoken' : 'spoken-train'); return readdirSync(d).filter(f => f.endsWith('.f32')).sort().map(f => f32(path.join(d, f))) })
const guard = (kind, split) => { let d = path.join(DATA, 'guard', `${split === 'test' ? 'test' : 'train'}-${kind}`); return readdirSync(d).filter(f => f.endsWith('.f32')).sort().map(f => [f.slice(0, -4), path.join(d, f)]) }
// MIT IR Survey responses at 48 kHz, aligned to the direct peak (2 ms kept before it), peak 1; those with a tail to hear
const PRE = 96, EARLY = 2400, TAIL = 19200
const rooms = memo(async split => {
  let d = path.join(DATA, 'mit-ir', 'Audio'), out = []
  for (let f of readdirSync(d).filter(f => f.endsWith('.wav')).sort()) {
    if (+f.slice(1, 4) % 2 !== (split === 'test' ? 1 : 0)) continue
    let { ch, sr } = readWav(path.join(d, f)), h = await to48(ch[0], sr), k = 0
    for (let i = 1; i < h.length; i++) if (Math.abs(h[i]) > Math.abs(h[k])) k = i
    h = h.slice(Math.max(0, k - PRE)); let m = Math.abs(h[Math.min(k, PRE)]); h = scale(h, 1 / m)
    let e = pow(h, 0, PRE + EARLY) * (PRE + EARLY), l = pow(h, PRE + EARLY) * (h.length - PRE - EARLY)
    if (10 * Math.log10(e / l) < 12) out.push(h)
  }
  return out
})

// ------------------------------------------------ conditions

// each: (split) → [{ name, make: async () → { x, sr, ref } }]: x the input, ref the reference (null: the input)
const speech = mix => split => takes(split).map(([name, p], i) => ({
  name, make: async () => {
    let r = lcg(1 + i), c = at(readWav(p).ch[0], LEVEL), { x, ref = c } = await mix(c, split, i, r)
    return { x, sr: SR, ref }
  },
}))
const babble = (split, n, r) => {
  let all = narrations(split), pick = [...all.keys()].sort(() => r() - .5).slice(0, 6), b = new Float32Array(n)
  for (let k of pick) b = add(b, at(cut(all[k], Math.floor(r() * (all[k].length - n)), n), LEVEL))
  return b
}
export const CONDITIONS = {
  'noise-5': speech((c, s, i, r) => ({ x: add(c, under(c, demand(s, i, c.length, r), -5)) })),
  noise0: speech((c, s, i, r) => ({ x: add(c, under(c, demand(s, i, c.length, r), 0)) })),
  noise5: speech((c, s, i, r) => ({ x: add(c, under(c, demand(s, i, c.length, r), 5)) })),
  babble0: speech((c, s, i, r) => ({ x: add(c, under(c, babble(s, c.length, r), 0)) })),
  babble5: speech((c, s, i, r) => ({ x: add(c, under(c, babble(s, c.length, r), 5)) })),
  music0: speech(async (c, s, i, r) => ({ x: add(c, under(c, await bed(s, i, c.length, r), 0)) })),
  music5: speech(async (c, s, i, r) => ({ x: add(c, under(c, await bed(s, i, c.length, r), 5)) })),
  reverb5: speech(async (c, s, i, r) => {
    let R = await rooms(s), h = R[i % R.length], n = c.length + TAIL, he = h.slice(0, PRE + EARLY)
    let early = conv(c, he, n + PRE).subarray(PRE), late = conv(c, h.map((v, k) => k < PRE + EARLY ? 0 : v), n + PRE).subarray(PRE)
    let g = Math.sqrt(pow(c) * c.length / (pow(early) * n)), rev = scale(add(early, late), g)
    return { x: add(rev, under(rev, demand(s, i, n, r), 5)), ref: scale(early, g) }
  }),
  clean: speech(c => ({ x: c })),
  music: split => {
    let songs = guard('songs', split), instr = guard('instr', split)
    return songs.filter((_, i) => i % 2 === 0).slice(0, 24).map(([name, p], i) => ({
      name: (i % 2 ? 'instr-' : 'song-') + name, make: async () => ({ x: f32(i % 2 ? instr.find(v => v[0] === name)[1] : p), sr: 44100, ref: null }),
    }))
  },
}
const accomp = memo(split => guard('instr', split))
async function bed(split, i, n, r) {
  let all = accomp(split), [, p] = all[(i * 7) % all.length], a = await to48(f32(p), 44100)
  return cut(a, Math.floor(r() * Math.max(1, a.length - n)), n)
}

// ------------------------------------------------ systems

// a system's directory: its spec; ours also carry neural-denoise's and denoise-dereverb's versions (and TAG, for a change
// in progress)
const version = p => JSON.parse(readFileSync(new URL(import.meta.resolve(p + '/package.json')), 'utf8')).version
const ND = version('@audio/neural-denoise') + '-drv' + version('@audio/denoise-dereverb') + (process.env.TAG ? '-' + process.env.TAG : '')
const pinned = id => id.match(/^(.*)@(\d+\.\d+\.\d+(?:-[\w.]+)?)$/)
const dirname = id => {
  let [, base, at] = pinned(id) ?? [, id, ND], s = SYSTEMS[base] ?? base, ours = /^nd:|deepfilter|rnnoise|derustle/.test(s)
  return s.replace(/\s+/g, '').replace(/["'\/:{};=]/g, c => ({ ':': '-', '=': '', ';': ',' }[c] ?? '')) + (ours ? `@${at}` : '')
}
let handle
async function dfn() {
  if (handle) return handle
  let { load } = await import('@audio/neural-denoise')
  return handle = await load('deepfilternet3', { sessionOptions: { intraOpNumThreads: 1, interOpNumThreads: 1 } })
}
function runner(id) {
  if (pinned(id) && pinned(id)[2] !== ND) throw new Error(`${id}: an earlier version's renders are read, not made (this is ${ND}); one is missing`)
  if (pinned(id)) id = pinned(id)[1]
  let s = SYSTEMS[id] ?? id
  if (s === 'input') return async x => x
  if (s.startsWith('rx:')) {
    let p = { noise_gain_db: -Infinity }
    for (let kv of s.slice(3).split(';').filter(Boolean)) { let [k, v] = kv.split('='); p[k] = v === '-inf' ? -Infinity : isNaN(+v) ? v : +v }
    return rx('Dialogue Isolate', p)
  }
  if (s.startsWith('op:')) return op(s.slice(3))
  if (s.startsWith('nd:')) {
    let o = JSON.parse(s.slice(3))
    return async ({ ch, sr }) => {
      let { default: denoise, mixback } = await import('@audio/neural-denoise'), { roomless } = await import('../../fn/deepfilter.js')
      let model = await dfn(), run = x => denoise(x, { sampleRate: sr, model, ...o, limit: 0 }), y = await run(ch), heard = roomless(ch, y, sr), limit = o.limit ?? 18
      if (heard) y = await run(heard)
      return { ch: limit ? y.map((v, c) => mixback(ch[c], v, { limit, floor: o.floor, sampleRate: sr })) : y, sr }
    }
  }
  throw new Error(`unknown system ${id}`)
}

// ------------------------------------------------ render, score, report

const fit = (y, n) => { let o = new Float32Array(n); o.set(y.subarray(0, n)); return o }
export async function render(split, cond, ids, shard) {
  let [k, N] = shard.split('/').map(Number), items = CONDITIONS[cond](split), dir = path.join(ROOT, split, cond), run = {}
  // system by system: RX keeps its settings from job to job (a change costs it a reload)
  for (let s of ['ref', ...ids]) for (let [i, it] of items.entries()) {
    let file = path.join(dir, s === 'ref' ? 'ref' : dirname(s), it.name + '.wav')
    if (i % N !== k || existsSync(file)) continue
    let { x, sr, ref } = await it.make()
    if (s === 'ref') { ref ? writeWav(file, [down3(ref)], 16000) : writeWav(file, [x], sr); continue }
    let y = fit((await (run[s] ??= runner(s))({ ch: [Float32Array.from(x)], sr })).ch[0], x.length)
    writeWav(file, [ref ? down3(y) : y], ref ? 16000 : sr)
  }
}

const SCORE = String.raw`
import sys, json, numpy as np, soundfile as sf
from multiprocessing import Pool
sys.path.insert(0, sys.argv[1])
from speech import dnsmos, sisdr, lufs
BANDS = [(0, 250), (250, 1000), (1000, 4000), (4000, 8000), (8000, 16000), (16000, 24000)]
def active(x, fs):
    F = fs // 100; p = (x[:len(x) // F * F].reshape(-1, F) ** 2).mean(1); return p[p > np.percentile(p, 99) * 10 ** -3.5].mean()
def one(j):
    from pesq import pesq
    from pystoi import stoi
    r, fs = sf.read(j['ref'], dtype='float64'); e = sf.read(j['est'], dtype='float64')[0]
    e = e[:len(r)] if len(e) >= len(r) else np.pad(e, (0, len(r) - len(e)))
    if j['music']:
        X, Y = np.abs(np.fft.rfft(r)) ** 2, np.abs(np.fft.rfft(e)) ** 2; f = np.fft.rfftfreq(len(r), 1 / fs)
        db = lambda a, b: float(10 * np.log10(max(a, 1e-30) / max(b, 1e-30)))
        return dict(sisdr=float('inf') if np.array_equal(r, e) else sisdr(r, e), level=db(Y.sum(), X.sum()),
                    **{f'b{i}': db(Y[(f >= a) & (f < b)].sum(), X[(f >= a) & (f < b)].sum()) for i, (a, b) in enumerate(BANDS)})
    lr, le = lufs(r, fs), lufs(e, fs); g = 10 ** ((lr - le) / 20) if np.isfinite(le) else 1
    sig, bak, ovr = dnsmos(e * g, fs)
    try: p = pesq(fs, r, e, 'wb')
    except Exception: p = float('nan')
    return dict(pesq=p, stoi=stoi(r, e, fs, extended=False), sisdr=sisdr(r, e), sig=sig, bak=bak, ovrl=ovr,
                level=float(10 * np.log10(max(active(e, fs), 1e-30) / active(r, fs))))
if __name__ == '__main__':
    jobs = json.load(sys.stdin)
    # JSON has no infinity or NaN: 'inf' and null
    out = lambda v: 'inf' if v == float('inf') else None if v != v else v
    with Pool(int(sys.argv[2])) as pool: print(json.dumps([{k: out(v) for k, v in r.items()} for r in pool.map(one, jobs, chunksize=2)]))
`
const revive = (k, v) => v === 'inf' ? Infinity : v === null ? NaN : v
// per-take scores of one system on one condition, kept in its scores.json
function scores(split, cond, id) {
  let dir = path.join(ROOT, split, cond), sd = path.join(dir, dirname(id)), file = path.join(sd, 'scores.json')
  let names = CONDITIONS[cond](split).map(t => t.name), have = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8'), revive) : {}
  let miss = names.filter(n => !have[n])
  if (miss.length) {
    let jobs = miss.map(n => ({ ref: path.join(dir, 'ref', n + '.wav'), est: path.join(sd, n + '.wav'), music: cond === 'music' }))
    // a file, not -c: the pool's spawned workers import the script
    let py = path.join(ROOT, 'score.py')
    if (!existsSync(py) || readFileSync(py, 'utf8') !== SCORE) mkdirSync(ROOT, { recursive: true }), writeFileSync(py, SCORE)
    let r = spawnSync(PY, [py, path.join(HERE, '..'), String(JOBS)], { input: JSON.stringify(jobs), maxBuffer: 1 << 28, encoding: 'utf8' })
    if (r.status) throw new Error(`scoring ${cond} ${id}: ${r.stderr}`)
    JSON.parse(r.stdout, revive).forEach((row, i) => have[miss[i]] = row)
    writeFileSync(file, JSON.stringify(have, (k, v) => v === Infinity ? 'inf' : Number.isNaN(v) ? null : v))
  }
  return names.map(n => have[n])
}

const f = (v, d = 2) => Number.isFinite(v) ? v.toFixed(d) : v === Infinity ? 'inf' : '–'
const nanmean = v => mean(v.filter(x => !Number.isNaN(x)))
// paired difference a − b: mean and 95% interval
function delta(a, b, k) {
  let d = a.map((r, i) => r[k] - b[i][k]).filter(Number.isFinite), m = mean(d), sd = Math.sqrt(d.reduce((s, v) => s + (v - m) ** 2, 0) / (d.length - 1))
  return `${m >= 0 ? '+' : '−'}${Math.abs(m).toFixed(2)} ± ${(1.96 * sd / Math.sqrt(d.length)).toFixed(2)}`
}
const median = v => { let s = v.filter(x => !Number.isNaN(x)).sort((a, b) => a - b), n = s.length; return n % 2 ? s[n >> 1] : (s[n / 2 - 1] + s[n / 2]) / 2 }

export function report(split, conds, ids) {
  let vs = process.env.VS ?? ids.find(s => s !== 'input'), all = {}
  for (let c of conds) {
    let S = Object.fromEntries(ids.map(s => [s, scores(split, c, s)])), n = S[ids[0]].length
    console.log(`\n### ${c} (${split}, ${n})\n`)
    if (c === 'music') {
      console.log(table(['system', 'SI-SDR to input (median)', 'untouched', 'level', '0–250 Hz', '0.25–1 kHz', '1–4 kHz', '4–8 kHz', '8–16 kHz', '16–24 kHz'],
        ids.map(s => [s, f(median(S[s].map(r => r.sisdr)), 1), `${S[s].filter(r => r.sisdr === Infinity).length} of ${n}`, ...['level', 'b0', 'b1', 'b2', 'b3', 'b4', 'b5'].map(k => f(median(S[s].map(r => r[k])), 1))])))
      continue
    }
    let keys = ['pesq', 'stoi', 'sisdr', 'sig', 'bak', 'ovrl', ...(c === 'clean' ? ['level'] : [])]
    console.log(table(['system', 'PESQ', 'STOI', 'SI-SDR', 'SIG', 'BAK', 'OVRL', ...(c === 'clean' ? ['level dB'] : []), ...(S[vs] ? [`Δ PESQ vs ${vs}`, 'Δ OVRL'] : [])],
      ids.map(s => [s, ...keys.map(k => f(nanmean(S[s].map(r => r[k])), k === 'stoi' ? 3 : 2)), ...(!S[vs] ? [] : s !== vs ? [delta(S[s], S[vs], 'pesq'), delta(S[s], S[vs], 'ovrl')] : ['', ''])])))
    for (let s of ids) (all[s] ??= {})[c] = { pesq: nanmean(S[s].map(r => r.pesq)), ovrl: nanmean(S[s].map(r => r.ovrl)), sisdr: nanmean(S[s].map(r => r.sisdr)) }
  }
  let cs = conds.filter(c => c !== 'music' && c !== 'clean')
  if (cs.length < 2) return
  for (let k of ['pesq', 'ovrl', 'sisdr']) {
    console.log(`\n### ${k.toUpperCase()} by condition (${split})\n`)
    console.log(table(['system', ...cs, 'mean'], ids.map(s => [s, ...cs.map(c => f(all[s][c][k])), f(mean(cs.map(c => all[s][c][k])))])))
  }
}

let [split, conds, ...ids] = process.argv.slice(2)
// imported (scripts reading CONDITIONS): nothing runs
if (!process.argv[1] || import.meta.url !== pathToFileURL(path.resolve(process.argv[1])).href) {}
else if (!VB[split] || !conds || !ids.length) console.log('usage: node bench/rx/isolate.mjs tune|test CONDITION[,…]|all SYSTEM [SYSTEM…]')
else {
  conds = conds === 'all' ? Object.keys(CONDITIONS) : conds.split(',')
  for (let c of conds) if (!CONDITIONS[c]) throw new Error(`unknown condition ${c}`)
  for (let c of conds) await render(split, c, ids, process.env.SHARD ?? '0/1')
  if (!process.env.SHARD) report(split, conds, ids)
  handle?.free()
}
