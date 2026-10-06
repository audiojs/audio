// RX 12 De-plosive against deplosive() on plosive pops added to clean close-miked speech, and on that speech alone.
//
//   node bench/rx/deplosive.mjs ["deplosive({ ... })"]      our op's stages (default: deplosive(), as the user gets it)
//
// Speech: VoiceBank clean reels (bench/rx/voice.mjs), `tune` for every setting chosen, `test` reported.
// Pops. Stop bursts are found on the clean speech as Liu's +b landmark (JASA 100(5), 1996, 3417–3430): the 5 ms energy
// over 1 kHz rising 12 dB within 3 ms after a closure (the 20 ms before it 25 dB under the reel's 99th-percentile 5 ms
// frame), the burst reaching within 40 dB of that frame in its first 25 ms; one per 100 ms (on spectrograms of five
// test utterances each mark sits on a burst's vertical line). Six in ten bursts get a pop (seeded): a one-sided
// pressure pulse of 20–80 ms, rising in 1–4 ms and falling over the rest (raised-cosine halves; the pops of the
// narrations, bench/rx/debreath.mjs's, rise 10–90 % in 2–3 ms under 100 Hz), through a 4th-order 150 Hz Butterworth
// low-pass, so under 200 Hz, starting 2–10 ms after the burst (the plosive's air jet travels slower than its sound),
// peaking at 0.3–2× the reel's 99.9th-percentile speech amplitude (log-uniform), either polarity.
// Measures. Per pop, the error to the clean speech taken away over [onset − 5 ms, end + 100 ms], 10·log10 of the error
// before over the error after (dB). Over the reels with pops, SNR to the clean speech (pops taken and speech harmed both
// count). On the clean reels, on their voiced 10 ms frames (bench/rx/voice.mjs, within 35 dB of the reel's
// 99th-percentile frame), where a de-plosive has nothing to take: SNR of the output to its input, and the share whose
// level under 250 Hz fell by over 3 dB. Not on all frames: VoiceBank's clean speech holds pops of its own (p227's
// training utterances: a 100 ms pulse under 40 Hz, 20 dB over the rest of the sound, at 1.55 s of the reel).
// RX tuned: sensitivity × strength at the default frequency limit, then the frequency limit at the best pair, by SNR
// to the clean speech on the tuning reels with pops. RX's scores: ~/.cache/audiojs/data/rx/deplosive/scores-<set>.json.
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { op, lcg, OUT, median, table } from './lib.mjs'
import { voicebank, frames, sos, lp4, hp4, pct, db, rxRetry, scored } from './voice.mjs'

const DIR = path.join(OUT, 'deplosive')

// Liu's +b landmark: an abrupt rise over 1 kHz after a closure; sample index of each burst
export function bursts(x, sr) {
  let h = sos(x, hp4(1000, sr)), w = Math.round(0.005 * sr), hop = Math.round(0.001 * sr), F = Math.floor((x.length - w) / hop)
  let Ea = new Float64Array(F), Eh = new Float64Array(F), out = []
  for (let f = 0; f < F; f++) { let a = 0, b = 0; for (let i = f * hop; i < f * hop + w; i++) a += x[i] * x[i], b += h[i] * h[i]; Ea[f] = db(a / w); Eh[f] = db(b / w) }
  let ref = pct(Ea, 0.99), max = (E, a, b) => { let m = -Infinity; for (let i = a; i < b; i++) m = Math.max(m, E[i]); return m }
  for (let f = 25; f < F - 25; f++) {
    if (Eh[f + 3] - max(Eh, f - 3, f) < 12 || max(Ea, f - 25, f - 4) > ref - 25 || max(Eh, f, f + 25) < ref - 40) continue
    if (out.length && f - out[out.length - 1] < 100) continue
    out.push(f)
  }
  return out.map(f => (f + 2) * hop + (w >> 1))
}

// pops added at six in ten bursts: { x: speech with pops, pops: [[a, b)] the span each is judged over }
export function addPops({ x, sr }, seed) {
  let rnd = lcg(seed), y = Float32Array.from(x), pops = [], pk = pct(x.map(Math.abs), 0.999)
  for (let b of bursts(x, sr)) {
    if (rnd() >= 0.6) continue
    let t0 = b + Math.round((0.002 + 0.008 * rnd()) * sr), D = Math.round((0.02 + 0.06 * rnd()) * sr), up = Math.round((0.001 + 0.003 * rnd()) * sr)
    let A = pk * 10 ** ((-10.5 + 16.5 * rnd()) / 20) * (rnd() < 0.5 ? -1 : 1), L = D + Math.round(0.05 * sr), p = new Float64Array(L), m = 0
    for (let i = 0; i < D; i++) p[i] = i < up ? Math.sin(Math.PI / 2 * i / up) ** 2 : Math.cos(Math.PI / 2 * (i - up) / (D - up)) ** 2
    p = sos(p, lp4(150, sr))
    for (let v of p) m = Math.max(m, Math.abs(v))
    for (let i = 0; i < L && t0 + i < y.length; i++) y[t0 + i] += A * p[i] / m
    pops.push([t0 - Math.round(0.005 * sr), Math.min(y.length, t0 + D + Math.round(0.1 * sr))])
  }
  return { x: y, pops }
}

// the share of voiced frames whose level under 250 Hz fell by over 3 dB: [thinned, voiced]
function thinned(x, y, sr, v) {
  let lx = sos(x, lp4(250, sr)), ly = sos(y, lp4(250, sr)), n = sr / 100, N = 0, t = 0
  for (let k = 0; k < v.length; k++) if (v[k]) {
    let a = 0, b = 0
    for (let i = k * n; i < (k + 1) * n; i++) a += lx[i] ** 2, b += ly[i] ** 2
    N++; t += b < a / 2
  }
  return [t, N]
}

const data = {}
export const load = set => data[set] ||= voicebank(set).map((r, i) => {
  let F = frames(r.x, r.sr), ref = pct(F.e, 0.99)
  return { ...r, dirty: addPops(r, 1000 + i), v: Uint8Array.from(F.r, (q, k) => q >= 0.6 && F.e[k] > ref * 10 ** -3.5) }
})

// a system: { name, fn: ({ ch, sr }) → { ch, sr } }, its scores kept under its `key` (RX), or made fresh (ours)
export const score = (s, set, withClean = true) => s.key ? scored(path.join(DIR, `scores-${set}.json`), s.key + (withClean ? '' : '-pops'), () => measure(s, set, withClean)) : measure(s, set, withClean)
async function measure(s, set, withClean) {
  let render = (r, x) => s.fn({ ch: [x], sr: r.sr })
  let g = [], es = 0, ee = 0, cs = 0, ce = 0, th = 0, tN = 0
  for (let r of load(set)) {
    let y = (await render(r, r.dirty.x)).ch[0]
    for (let [a, b] of r.dirty.pops) {
      let e0 = 0, e1 = 0
      for (let i = a; i < b; i++) e0 += (r.dirty.x[i] - r.x[i]) ** 2, e1 += (y[i] - r.x[i]) ** 2
      g.push(db(e0 / e1))
    }
    for (let i = 0; i < r.x.length; i++) es += r.x[i] ** 2, ee += (y[i] - r.x[i]) ** 2
    if (!withClean) continue
    let z = (await render(r, r.x)).ch[0], [t, N] = thinned(r.x, z, r.sr, r.v), n = r.sr / 100
    for (let k = 0; k < r.v.length; k++) if (r.v[k]) for (let i = k * n; i < (k + 1) * n; i++) cs += r.x[i] ** 2, ce += (z[i] - r.x[i]) ** 2
    th += t; tN += N
  }
  return { gone: median(g), gone10: pct(g, 0.1), snr: db(es / ee), clean: db(cs / ce), thin: th / tN }
}

const RX = p => ({ name: Object.keys(p).length ? `RX tuned (${Object.entries(p).map(([k, v]) => `${k} ${v}`).join(', ')})` : 'RX defaults', key: 'rx' + Object.entries(p).map(([k, v]) => `-${k}${v}`).join(''), fn: rxRetry('De-plosive', p) })

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  let stages = process.argv[2] || 'deplosive()', best = { snr: -Infinity }
  const tryRx = async p => { let m = await score(RX(p), 'tune', false); console.error(JSON.stringify(p), m.snr.toFixed(2), m.gone.toFixed(1)); if (m.snr > best.snr) best = { snr: m.snr, p } }
  for (let sensitivity of [0, 1, 2, 4, 6, 8, 10]) for (let strength of [2.5, 5, 7.5, 10]) await tryRx({ sensitivity, strength })
  let p0 = best.p
  for (let frequency_limit_hz of [50, 75, 100, 125, 150, 300]) await tryRx({ ...p0, frequency_limit_hz })

  let rows = []
  for (let s of [{ name: 'input', fn: async y => y }, RX({}), RX(best.p), { name: `ours, ${stages}`, fn: op(stages) }]) {
    let m = await score(s, 'test')
    rows.push([s.name, `${m.gone.toFixed(1)} · ${m.gone10.toFixed(1)}`, m.snr.toFixed(1), Number.isFinite(m.clean) ? m.clean.toFixed(1) : '∞', `${(100 * m.thin).toFixed(1)} %`])
  }
  let T = load('test')
  console.log(`\nDe-plosive: VoiceBank test, ${T.length} reels (${(T.reduce((s, r) => s + r.x.length / r.sr, 0) / 60).toFixed(1)} min), ${T.reduce((s, r) => s + r.dirty.pops.length, 0)} pops; RX tuned on ${load('tune').length} training reels\n`)
  console.log(table(['', 'pops: error taken away, median · 10th pct (dB)', 'with pops: SNR to clean (dB)', 'clean, voiced frames: SNR to input (dB)', 'clean: voiced frames thinned'], rows))
}
