// RX 12 De-ess against deesser() on speech made harsh by sibilants boosted, and on that speech as it was.
//
//   node bench/rx/deess.mjs ["deesser({ ... })"]      our op's stages (default: deesser(), as the user gets it)
//
// Speech (bench/rx/voice.mjs): VoiceBank clean reels and the narrations, `tune` sets for every setting chosen, `test`
// reported. Harshness. Sibilant 10 ms frames are found on the clean speech: within 35 dB of the reel's 99th-percentile
// frame, half or more of their energy over 3.5 kHz (4th-order Butterworth), runs bridged over one frame. Each run gets
// its own boost, 4–12 dB (uniform, seeded), of the 4–10 kHz band only: harsh = clean + (g − 1)·B(clean), B the band
// through 4th-order Butterworth high-pass 4 kHz and low-pass 10 kHz forward and backward (zero phase), g rising and
// falling over 5 ms raised-cosine ramps outside the run. The clean speech is the target.
// Measures. Over the sibilant runs (10 ms either side), the error to the clean speech taken away, 10·log10 of the error
// before over the error after, all runs pooled (dB). On sibilant frames, the 4–10 kHz level left over the clean's
// (median, dB; the harsh input's is the boost). Over the harsh reels, SNR to the clean speech. On the clean reels, where
// there is nothing to repair: SNR of the output to its input; the share of the other active frames (vowels, voiced
// consonants: damage) whose 0.3–4 kHz or 4–10 kHz level moved by over 1 dB; and the median cut of the clean speech's
// own sibilant frames, 4–10 kHz (dB).
// RX tuned: algorithm × threshold × speed, then the cutoff, then (Spectral) spectral shaping and tilt, by SNR to the
// clean speech over the harsh tuning reels. RX's scores: ~/.cache/audiojs/data/rx/deess/scores-<set>.json.
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { op, lcg, OUT, median, table } from './lib.mjs'
import { voicebank, narrations, db, pct, zp, hp4, lp4, bandFrames, rxRetry, scored } from './voice.mjs'

const DIR = path.join(OUT, 'deess')

// sibilant runs [a, b) in 10 ms frames, and the harsh reel
export function harsh(r, seed) {
  let { x, sr } = r, n = sr / 100, E = bandFrames(x, sr, []), H = bandFrames(x, sr, hp4(3500, sr)), ref = pct(E, 0.99)
  let s = Array.from(E, (e, k) => e > ref * 10 ** -3.5 && H[k] >= 0.5 * e), runs = []
  for (let k = 1; k + 1 < s.length; k++) if (!s[k] && s[k - 1] && s[k + 1]) s[k] = true
  for (let k = 0; k < s.length;) { if (!s[k]) { k++; continue } let j = k; while (j < s.length && s[j]) j++; runs.push([k, j]); k = j }
  let rnd = lcg(seed), w = new Float64Array(x.length), R = Math.round(0.005 * sr)
  for (let [a, b] of runs) {
    let G = 10 ** ((4 + 8 * rnd()) / 20) - 1
    for (let i = Math.max(0, a * n - R); i < Math.min(x.length, b * n + R); i++) {
      let d = i < a * n ? (a * n - i) / R : i >= b * n ? (i - b * n + 1) / R : 0
      w[i] = Math.max(w[i], G * (d >= 1 ? 0 : 0.5 + 0.5 * Math.cos(Math.PI * d)))
    }
  }
  let B = zp(x, [...hp4(4000, sr), ...lp4(10000, sr)]), y = Float32Array.from(x, (v, i) => v + w[i] * B[i])
  return { y, runs, s }
}

const RX = p => ({ name: Object.keys(p).length ? `RX tuned (${Object.entries(p).map(([k, v]) => `${k} ${v}`).join(', ')})` : 'RX defaults', key: 'rx' + Object.entries(p).map(([k, v]) => `-${k}${v}`).join('').replace(/ /g, ''), fn: rxRetry('De-ess', p) })
const render = (s, r, x) => s.fn({ ch: [x], sr: r.sr })

const data = {}
export const load = set => data[set] ||= [...voicebank(set), ...narrations(set)].map((r, i) => {
  let h = harsh(r, 2000 + i), sr = r.sr
  return { ...r, ...h, hi: bandFrames(r.x, sr, [...hp4(4000, sr), ...lp4(10000, sr)]), md: bandFrames(r.x, sr, [...hp4(300, sr), ...lp4(4000, sr)]), E: bandFrames(r.x, sr, []) }
})

// a system's scores, kept under its `key` (RX), or made fresh (ours)
export const score = (s, set, withClean = true) => s.key ? scored(path.join(DIR, `scores-${set}.json`), s.key + (withClean ? '' : '-harsh'), () => measure(s, set, withClean)) : measure(s, set, withClean)
async function measure(s, set, withClean) {
  let g0 = 0, g1 = 0, left = [], es = 0, ee = 0, cs = 0, ce = 0, moved = 0, voice = 0, cut = []
  for (let r of load(set)) {
    let y = (await render(s, r, r.y)).ch[0], n = r.sr / 100, sr = r.sr
    for (let [a, b] of r.runs) for (let i = Math.max(0, (a - 1) * n); i < Math.min(r.x.length, (b + 1) * n); i++) g0 += (r.y[i] - r.x[i]) ** 2, g1 += (y[i] - r.x[i]) ** 2
    let hy = bandFrames(y, sr, [...hp4(4000, sr), ...lp4(10000, sr)])
    for (let k = 0; k < r.s.length; k++) if (r.s[k]) left.push(db(hy[k] / r.hi[k]))
    for (let i = 0; i < r.x.length; i++) es += r.x[i] ** 2, ee += (y[i] - r.x[i]) ** 2
    if (!withClean) continue
    let z = (await render(s, r, r.x)).ch[0], hz = bandFrames(z, sr, [...hp4(4000, sr), ...lp4(10000, sr)]), mz = bandFrames(z, sr, [...hp4(300, sr), ...lp4(4000, sr)])
    for (let i = 0; i < r.x.length; i++) cs += r.x[i] ** 2, ce += (z[i] - r.x[i]) ** 2
    let ref = pct(r.E, 0.99)
    for (let k = 0; k < r.s.length; k++) {
      if (r.s[k]) { cut.push(db(r.hi[k] / hz[k])); continue }
      if (r.E[k] < ref * 10 ** -3.5) continue
      voice++; moved += Math.abs(db(hz[k] / r.hi[k])) > 1 || Math.abs(db(mz[k] / r.md[k])) > 1
    }
  }
  return { gone: db(g0 / g1), left: median(left), snr: db(es / ee), clean: db(cs / ce), moved: moved / voice, cut: median(cut) }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  let stages = process.argv[2] || 'deesser()', best = { snr: -Infinity }
  const tryRx = async p => { let m = await score(RX(p), 'tune', false); console.error(JSON.stringify(p), m.snr.toFixed(2), m.gone.toFixed(1), m.left.toFixed(1)); if (m.snr > best.snr) best = { snr: m.snr, p } }
  for (let algorithm of ['Classic De-ess', 'Spectral De-ess']) for (let threshold of [-30, -24, -18, -15, -12, -9, -6, 0]) for (let speed of ['Fast', 'Slow'])
    await tryRx({ algorithm, threshold, speed })
  let p0 = best.p
  for (let cutoff_freq of [1500, 4000, 5500]) await tryRx({ ...p0, cutoff_freq })
  if (best.p.algorithm === 'Spectral De-ess') {
    let p1 = best.p
    for (let spectral_shaping of [0, 25, 75, 100]) await tryRx({ ...p1, spectral_shaping })
    let p2 = best.p
    for (let spectral_tilt of [-50, 50]) await tryRx({ ...p2, spectral_tilt })
  }

  let input = { name: 'input', fn: async y => y }, rows = []
  for (let s of [input, RX({}), RX(best.p), { name: `ours, ${stages}`, fn: op(stages) }]) {
    let m = await score(s, 'test'), f = v => Number.isFinite(v) ? v.toFixed(1) : '∞'
    rows.push([s.name, f(m.gone), f(m.left), f(m.snr), f(m.clean), `${(100 * m.moved).toFixed(1)} %`, f(m.cut)])
  }
  let T = load('test')
  console.log(`\nDe-ess: ${T.length} test reels (VoiceBank test, narrations; ${(T.reduce((s, r) => s + r.x.length / r.sr, 0) / 60).toFixed(1)} min), ${T.reduce((s, r) => s + r.runs.length, 0)} sibilants boosted 4–12 dB; RX tuned on ${load('tune').length} tuning reels\n`)
  console.log(table(['', 'harsh: error taken away over sibilants (dB)', 'harsh: 4–10 kHz left on sibilants (dB)', 'harsh: SNR to clean (dB)', 'clean: SNR to input (dB)', 'clean: other frames moved > 1 dB', 'clean: own sibilants cut (dB)'], rows))
}
