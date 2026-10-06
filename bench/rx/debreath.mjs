// RX 12 Breath Control against debreath() on the breaths of real narrations, and on clean speech with them put in.
//
//   node bench/rx/debreath.mjs ["debreath({ ... })"]      our op's stages (default: debreath(), as the user gets it)
//
// Narrations. Twenty Spoken Wikipedia recordings (Wikimedia Commons, CC BY-SA), each its first 3 minutes, mono, 48 kHz
// (windowed-sinc): `tune`, the ten of spoken-train/ (fetched from its manifest's URLs once); `test`, the ten of spoken/
// (bench/speech.mjs's rooms). Kept in ~/.cache/audiojs/data/rx/debreath/<set>/.
// Breaths, found on each narration per 10 ms frame, by the acoustics of an inhalation (Ruinskiy & Lavner, IEEE TASLP
// 15(3), 2007: unvoiced, 0.15–0.6 s and more, well under the speech, between phrases): no period (Talkin's normalized
// cross-correlation of the 50–1000 Hz band under 0.5, bench/rx/voice.mjs), its 0.3–8 kHz level 10 dB or more over that
// band's 10th-percentile frame (the room) and 12 dB or more under its 95th (the speech), under half of it over 4 kHz
// (no sibilant); runs bridged over two frames, 0.15–1 s long, their median 15 dB or more over the room, a room-level
// frame within 0.1 s on either side (a pause), no voiced frame in the 50 ms before (a phrase's own decay starts where
// its voicing stops), under 60 % of their energy below 1 kHz (phrase-final creak and murmur lie there). On spectrograms
// of 46 of them most are clear inhalations, noise over the open tract's formants, often after a click; the rest quiet
// noise in pauses.
// VoiceBank with real breaths: the clean reels (bench/rx/voice.mjs) and, before each phrase that follows 0.25 s of quiet
// (frames 30 dB under the reel's 95th percentile), one of the labelled breaths of the same set's narrations that fits
// (seeded), cut with 10 ms either side and 10 ms fades, ending 30–150 ms before the phrase, at its level under its
// narration's speech: labels exact, the speech another.
// Measures, per breath: the level change over it in its band, 0.3–8 kHz (dB; a room's rumble under it is the room's);
// caught, the share brought down 6 dB or more. Harm: the share of speech frames brought down by over 3 dB, voiced
// frames (cross-correlation ≥ 0.6, within 30 dB of the speech) and word edges (the other active frames within 0.1 s of
// voicing: the consonants a pause meets); and the median change of the narrations' other frames (pauses, the room).
// RX at its defaults sets Gain 0 dB, which changes nothing; RX is measured at Gain −12 dB, debreath's range. RX tuned:
// algorithm × reduction mode at the default sensitivity, then sensitivity, by Youden's J (1950), caught − harmed, both
// sets' breaths and speech frames pooled. The narrations as read, and RX's scores, in ~/.cache/audiojs/data/rx/debreath/.
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import audio from '../../audio.js'
import { op, readWav, writeWav, lcg, OUT, DATA, median, table } from './lib.mjs'
import { voicebank, frames, bandFrames, sos, hp4, lp4, pct, db, rxRetry, scored } from './voice.mjs'

const DIR = path.join(OUT, 'debreath'), LEN = 180

// the narrations, 3 minutes each, decoded once from the original recordings
async function narrations(set) {
  let src = path.join(DATA, set === 'tune' ? 'spoken-train' : 'spoken'), out = []
  for (let { name, url } of JSON.parse(readFileSync(path.join(src, 'manifest.json')))) {
    let file = path.join(DIR, set, `${name}.wav`)
    if (!existsSync(file)) {
      let org = path.join(src, `${name}.org`)
      if (set === 'test') org = path.join(src, `${name}.org&utm_campaign=imageinfo&utm_content=original`)
      if (!existsSync(org)) { let r = await fetch(url, { headers: { 'User-Agent': 'audiojs-bench/1.0 (https://github.com/audiojs/audio)' } }); if (!r.ok) throw new Error(`${url}: ${r.status}`); mkdirSync(src, { recursive: true }); writeFileSync(org, Buffer.from(await r.arrayBuffer())) }
      let a = await audio(org), ch = await a.read(), n = Math.min(ch[0].length, LEN * a.sampleRate)
      let m = Float32Array.from({ length: n }, (_, i) => ch.reduce((s, c) => s + c[i], 0) / ch.length)
      let y = await audio.from([m], { sampleRate: a.sampleRate }).resample(48000, { type: 'sinc' }).read()
      writeWav(file, [y[0]], 48000)
    }
    out.push({ name, ...readWav(file) })
  }
  return out
}

// labels per 10 ms frame: 2 breath, 1 speech (voiced or word edge), 0 other; and the breaths [a, b)
export function label(x, sr) {
  let F = frames(x, sr), M = F.m, B = bandFrames(x, sr, [...hp4(300, sr), ...lp4(8000, sr)]), H = bandFrames(x, sr, [...hp4(4000, sr), ...lp4(8000, sr)])
  let L = bandFrames(x, sr, [...hp4(300, sr), ...lp4(1000, sr)]), S = pct(B, 0.95), N = Math.max(pct(B, 0.1), S * 1e-7)
  let voiced = k => F.r[k] >= 0.6 && B[k] > S / 1000, quiet = k => B[k] < 4 * N, c = new Uint8Array(M), cls = new Uint8Array(M), out = []
  for (let k = 0; k < M; k++) c[k] = F.r[k] < 0.5 && B[k] > 10 * N && B[k] < S / 16 && H[k] < 0.5 * B[k]
  for (let k = 1; k + 2 < M; k++) if (!c[k] && c[k - 1] && (c[k + 1] || c[k + 2])) c[k] = 1
  for (let k = 0; k < M;) {
    if (!c[k]) { k++; continue }
    let j = k, pause = false, after = false, sb = 0, sl = 0
    while (j < M && c[j]) j++
    for (let q = Math.max(0, k - 10); q < Math.min(M, j + 10); q++) if (q < k || q >= j) pause ||= quiet(q)
    for (let q = Math.max(0, k - 5); q < k; q++) after ||= voiced(q)
    for (let q = k; q < j; q++) sb += B[q], sl += L[q]
    if (j - k >= 15 && j - k <= 100 && pause && !after && pct(B.subarray(k, j), 0.5) > 10 ** 1.5 * N && sl < 0.6 * sb) out.push([k, j])
    k = j
  }
  for (let k = 0; k < M; k++) if (voiced(k)) for (let q = Math.max(0, k - 10); q < Math.min(M, k + 11); q++) if (B[q] > 10 * N) cls[q] = 1
  for (let [a, b] of out) cls.fill(2, a, b)
  return { cls, breaths: out, S }
}

const RX = (p, name) => ({ name: name || `RX tuned (${Object.entries(p).map(([k, v]) => `${k} ${v}`).join(', ')})`, key: 'rx' + Object.entries(p).map(([k, v]) => `-${k}${v}`).join('').replace(/ /g, ''), fn: rxRetry('Breath Control', p) })
const render = (s, r) => s.fn({ ch: [r.x], sr: r.sr })

// a labelled breath of the narrations before each phrase of a VoiceBank reel that follows 0.4 s of quiet
function withBreaths(r, N, seed) {
  let { x, sr } = r, n = sr / 100, rnd = lcg(seed), E = bandFrames(x, sr, []), S = pct(E, 0.95), y = Float32Array.from(x), breaths = []
  let clips = N.flatMap(q => q.breaths.map(([a, b]) => {
    let B = bandFrames(q.x.subarray(a * n, b * n), sr, [...hp4(300, sr), ...lp4(8000, sr)]), c = q.x.slice(Math.max(0, a * n - n), b * n + n), F = n
    for (let i = 0; i < F; i++) c[i] *= i / F, c[c.length - 1 - i] *= i / F
    return { c, rel: pct(B, 0.5) / q.S }
  }))
  let RB = pct(bandFrames(x, sr, [...hp4(300, sr), ...lp4(8000, sr)]), 0.95)
  for (let k = 0, quiet = 0; k < E.length; k++) {
    if (E[k] < S * 1e-3) { quiet++; continue }
    let run = quiet, G = Math.round((0.03 + 0.12 * rnd()) * sr), room = (run - 5) * n - G, fit = clips.filter(q => q.c.length <= room)
    quiet = 0
    if (run < 25 || !fit.length) continue
    let { c, rel } = fit[Math.floor(rnd() * fit.length)], end = k * n - G, at = end - c.length
    let B = bandFrames(c.subarray(n, c.length - n), sr, [...hp4(300, sr), ...lp4(8000, sr)]), g = Math.sqrt(rel * RB / pct(B, 0.5))
    for (let i = 0; i < c.length; i++) y[at + i] += g * c[i]
    breaths.push([Math.round(at / n) + 1, Math.round(end / n) - 1])
  }
  return { ...r, x: y, clean: x, breaths }
}

const data = {}
export async function load(set) {
  if (data[set]) return data[set]
  let N = (await narrations(set)).map(r => ({ ...r, x: r.ch[0], ...label(r.ch[0], r.sr) }))
  let V = voicebank(set).map((r, i) => { let l = label(r.x, r.sr); return { ...withBreaths(r, N, 3000 + i), cls: l.cls } })
  return data[set] = { N, V }
}

// level change per frame, dB (x → y), frames of 10 ms
const change = (x, y, n, a, b) => { let p = 0, q = 0; for (let i = a * n; i < b * n; i++) p += x[i] * x[i], q += y[i] * y[i]; return db(q / p) }
// a system's scores, kept under its `key` (RX), or made fresh (ours)
export const score = (s, set) => s.key ? scored(path.join(DIR, `scores-${set}.json`), s.key, () => measure(s, set)) : measure(s, set)
async function measure(s, set) {
  let { N, V } = await load(set), m = {}
  for (let [tag, R] of [['nr', N], ['vb', V]]) {
    let br = [], sp = 0, spN = 0, pause = []
    for (let r of R) {
      let y = (await render(s, r)).ch[0], n = r.sr / 100, band = [...hp4(300, r.sr), ...lp4(8000, r.sr)], bx = r.band ||= sos(r.x, band), by = sos(y, band)
      for (let [a, b] of r.breaths) br.push(change(bx, by, n, a, b))
      for (let k = 0; k < r.cls.length; k++) {
        if (r.cls[k] === 1) { spN++; sp += change(r.x, y, n, k, k + 1) < -3 }
        else if (!r.cls[k] && tag === 'nr') { let d = change(r.x, y, n, k, k + 1); if (Number.isFinite(d)) pause.push(d) }
      }
    }
    m[tag] = { breaths: br.length, att: median(br), caught: br.filter(d => d <= -6).length, harm: sp, frames: spN, pause: median(pause) }
  }
  m.J = (m.nr.caught + m.vb.caught) / (m.nr.breaths + m.vb.breaths) - (m.nr.harm + m.vb.harm) / (m.nr.frames + m.vb.frames)
  return m
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  let stages = process.argv[2] || 'debreath()', best = { J: -Infinity }
  const tryRx = async p => { let m = await score(RX({ gain_db: -12, ...p }), 'tune'); console.error(JSON.stringify(p), JSON.stringify(m)); if (m.J > best.J) best = { J: m.J, p } }
  for (let algorithm of ['Real-time', 'Offline', 'Classic']) for (let reduction_mode of ['Natural', 'Gated']) await tryRx({ algorithm, reduction_mode })
  let p0 = best.p
  for (let sensitivity of [0, 1, 3, 7, 9]) await tryRx({ ...p0, sensitivity })

  let input = { name: 'input', fn: async y => y }, rows = [], f = v => v.toFixed(1), pc = (a, b) => `${(100 * a / b).toFixed(1)} %`
  for (let s of [input, RX({}, 'RX defaults (Gain 0 dB)'), RX({ gain_db: -12 }, 'RX defaults, Gain −12 dB'), RX({ gain_db: -12, ...best.p }), { name: `ours, ${stages}`, fn: op(stages) }]) {
    let { nr, vb } = await score(s, 'test')
    rows.push([s.name, `${f(nr.att)} dB · ${pc(nr.caught, nr.breaths)}`, pc(nr.harm, nr.frames), `${f(nr.pause)} dB`, `${f(vb.att)} dB · ${pc(vb.caught, vb.breaths)}`, pc(vb.harm, vb.frames)])
  }
  let { N, V } = await load('test'), T = await load('tune')
  console.log(`\nBreath Control: ${N.length} test narrations (${(N.reduce((s, r) => s + r.x.length / r.sr, 0) / 60).toFixed(0)} min, ${N.reduce((s, r) => s + r.breaths.length, 0)} breaths), VoiceBank test with ${V.reduce((s, r) => s + r.breaths.length, 0)} of them put in; RX tuned on ${T.N.reduce((s, r) => s + r.breaths.length, 0)} + ${T.V.reduce((s, r) => s + r.breaths.length, 0)} tuning breaths\n`)
  console.log(table(['', 'narrations: breaths, median change · down ≥ 6 dB', 'speech frames down > 3 dB', 'other frames, median change', 'VoiceBank + breaths: median change · down ≥ 6 dB', 'speech frames down > 3 dB'], rows))
}
