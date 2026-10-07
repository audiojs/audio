// De-reverb against iZotope RX 12: how much of a room's late tail each takes off a voice, what it costs the voice, and
// what it does where there is no room to take or more than a room: dry speech, noise with the room, music as it is,
// music with pauses, music in a room.
//
//   node bench/rx/dereverb.mjs [test|train]      every condition: the input, RX at its defaults, learned and tuned, ours
//   node bench/rx/dereverb.mjs tune              RX's settings searched on vbreverb's training set, by PESQ
//
// Systems. RX De-reverb (bench/rx/host.py): at its defaults (reduction 10 dB, tail length 1 s, artifact smoothing 9,
// band strengths 6); learned (its Learn on the take, then the take rendered: RX's own workflow; the learned profile is
// a tail length and four band strengths, bench/rx/dereverb.py `learn`); tuned (the setting `tune` chose: coordinate
// descent over reduction, tail length, artifact smoothing, the band strengths, enhance dry signal and Learn, on
// `reverb-train`, by mean PESQ). For reference, RX Dialogue Isolate (a trained separator) with its reverb gain at −∞
// and its noise kept. Ours: dereverb() at its defaults as audio's op runs it, what the user gets, its cache
// keyed by the installed @audio/denoise-dereverb's version.
//
// Material (bench/rx/dereverb.py `build`; train and test share no speaker, room, noise segment or piece):
//   room   VoiceBank clean speech (Valentini-Botinhao 2017, CC BY 4.0, doi:10.7488/ds/2117) in MIT IR Survey rooms
//          (Traer & McDermott, PNAS 2016) with a tail to hear: the takes @audio/denoise's scripts/dereverb.py builds,
//          42 short utterances (1.6–5.9 s) and 4 (test; 8 train) 25–60 s takes of one speaker in one room, 48 kHz; the
//          19 rooms of a split are odd-numbered responses for test, even for train (T60 0.38–1.85 s on test). Each
//          response is split at direct + 50 ms: early, the voice as the room colours it; late, the tail to take.
//   noisy  the room takes with DEMAND noise (Thiemann, Ito & Vincent, ICA 2013: DWASHING, NFIELD, NPARK, NRIVER,
//          OHALLWAY; from each recording's first half for train, second for test) 10 dB under the reverberant speech.
//   dry    the room takes' dry speech.
//   music  44.1 kHz: MUSDB18 previews (Rafii et al. 2017; odd-numbered for test, even for train), GuitarSet mic takes
//          (Xi et al., ISMIR 2018; every 18th from the 10th for test, from the 1st for train; 30 s), four pieces
//          (Brahms, the Nutcracker, a solo trumpet, Vibe Ace: @audio/denoise scripts/repair.js; the first half, up to
//          30 s, for test, the second for train), VocalSet straight-tone singing (Wilkins et al., ISMIR 2018; odd
//          singers for test, even for train).
//   pauses the same music cut into 2–4 s phrases, 50 ms fades, 0.5–1.5 s between, over a noise floor 50 dB under its
//          mean power (as a recording has one; seeded).
//   music in a room: the same music through the split's rooms, early and late as for speech.
//
// Measures (bench/rx/dereverb.py `score`):
//   voice lost, tail taken: STFT cells (2048, hop 512) where the early part is 10 dB over the late one, the output's
//     power there over the early part's; where the late part is 10 dB over the early one, the output's over the late
//     part's (dB; @audio/denoise scripts/dereverb.py's split). For music in a room: music lost, tail taken.
//   PESQ (ITU-T P.862.2 wideband, python-pesq) and STOI (Taal et al., IEEE TASLP 19(7), 2011) against the dry take at
//     16 kHz; DNSMOS P.835 SIG, BAK, OVRL (Reddy, Gopal & Cutler, ICASSP 2022; bench/speech.py's) at the input's
//     loudness (ITU-R BS.1770).
//   untouched: the share returned bit for bit; SI-SDR against the input (Le Roux et al., ICASSP 2019), median; level
//     change: the output's power over the input's per octave, 63 Hz–8 kHz, summed over a group, the largest in size.
//   ours − RX: per-take differences, mean ± 1.96 standard errors.
// Scores are kept in ~/.cache/audiojs/data/rx/dereverb/, renders only until scored.

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, unlinkSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { DATA, OUT, rx, op, keep, readWav, table, mean, median } from './lib.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url)), HOME = path.join(OUT, 'dereverb')
const PY = process.env.RX_PYTHON || path.join(os.homedir(), '.cache', 'audiojs', 'venv', 'bin', 'python')
const VER = JSON.parse(readFileSync(path.join(HERE, '../../node_modules/@audio/denoise-dereverb/package.json'))).version

// RX at the best of `tune` on reverb-train (2026-10-06): PESQ 2.423 at its defaults, 2.488 so, on all 126 (learned
// 2.408 at best on the half searched, the defaults 2.367 there)
const TUNED = { params: { tail_length: 0.5, band_strength_low: 8, band_strength_low_mid: 4, band_strength_high_mid: 6, band_strength_high: 4 }, learn: false }

// ---- the Python half: build, score, learn
let seq = 0
function py(cmd, ...a) {
  let tmp = path.join(HOME, 'tmp', `${process.pid}-${seq++}`)
  mkdirSync(path.dirname(tmp), { recursive: true })
  let args = a.map((v, i) => typeof v === 'string' ? v : (writeFileSync(tmp + i, JSON.stringify(v)), tmp + i))
  try { execFileSync(PY, [path.join(HERE, 'dereverb.py'), cmd, ...args, tmp + '.out'], { stdio: ['ignore', 'inherit', 'pipe'] }) }
  catch (e) { process.stderr.write(e.stderr); throw e }
  let r = existsSync(tmp + '.out') ? parse(readFileSync(tmp + '.out', 'utf8')) : null
  for (let f of [...args.filter(f => f.startsWith(tmp)), tmp + '.out']) existsSync(f) && unlinkSync(f)
  return r
}
// ±Infinity (an untouched take's SI-SDR) as Python's JSON writes it, bare, and as the kept scores do, in quotes
const parse = t => JSON.parse(t.replace(/(?<!")(-?)Infinity(?!")/g, '"$1Infinity"').replace(/\bNaN\b/g, 'null'), (k, x) => x === 'Infinity' ? Infinity : x === '-Infinity' ? -Infinity : x)
const json = v => JSON.stringify(v, (k, x) => x === Infinity || x === -Infinity ? String(x) : x)
const f32 = f => { let b = readFileSync(f); return new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)) }
const load = it => it.in.endsWith('.f32') ? { ch: [f32(it.in)], sr: it.sr } : readWav(it.in)

// ---- systems: name → { key (its renders' folder), run(x, item, split) }
const pkey = p => Object.entries(p).map(([k, v]) => `${k.replace(/_/g, '')}=${v}`).join(',') || 'default'
const learnt = {}
function learned(split, items) {
  // RX's Learn on each take (kept in learn.json), then the take rendered with what it learned
  let f = path.join(HOME, split, 'learn.json'), have = learnt[split] ??= existsSync(f) ? JSON.parse(readFileSync(f)) : {}
  let want = items.filter(it => !have[it.in])
  if (want.length) {
    py('learn', want.map(it => ({ in: it.in, sr: it.sr }))).forEach((p, i) => have[want[i].in] = p)
    mkdirSync(path.dirname(f), { recursive: true }); writeFileSync(f, JSON.stringify(have))
  }
  return have
}
const RX = (p, learn) => ({
  key: (learn ? 'rx-learn' : 'rx') + (Object.keys(p).length || !learn ? '-' + pkey(p) : ''),
  run: (x, it, split) => rx('De-reverb', learn ? { ...learned(split, [it])[it.in], ...p } : p)(x),
})
const SYSTEMS = {
  rx: RX({}), 'rx-learn': RX({}, true), ...TUNED && { 'rx-tuned': RX(TUNED.params, TUNED.learn) },
  // RX's learned separator with its reverb off and the noise kept, on speech: what a trained model takes, for reference
  'rx-di': { key: 'rx-di-reverb=-inf', run: rx('Dialogue Isolate', { reverb_gain_db: -Infinity }), speech: true },
  ours: { key: `dereverb-${VER}`, run: op('dereverb()') },
}
const LABEL = { in: 'input', rx: 'RX, defaults', 'rx-learn': 'RX, learned', 'rx-tuned': 'RX, tuned', 'rx-di': 'RX Dialogue Isolate, reverb off', ours: `ours, dereverb ${VER}` }

// the output file of system s on item it, rendered once
async function render(split, it, s) {
  if (s === 'in') return it.in
  let f = path.join(HOME, split, it.cond, SYSTEMS[s].key, it.name + '.wav')
  if (!existsSync(f)) await keep(f, () => SYSTEMS[s].run(load(it), it, split))
  return f
}
// scores of system s on items, kept per condition and system
async function scores(split, items, s) {
  let key = s === 'in' ? 'in' : SYSTEMS[s].key, files = {}, out = {}, jobs = []
  if (s === 'rx-learn' || SYSTEMS[s]?.key.startsWith('rx-learn')) learned(split, items)
  for (let it of items) {
    let f = path.join(HOME, split, it.cond, key, 'scores.json')
    files[f] ??= existsSync(f) ? parse(readFileSync(f, 'utf8')) : {}
    if (files[f][it.name]) continue
    jobs.push([f, it.name, { kind: it.kind, sr: it.sr, in: it.in, out: await render(split, it, s), ref: it.ref, ...it.early && { early: it.early, late: it.late } }])
  }
  if (jobs.length) {
    py('score', jobs.map(j => j[2])).forEach((r, i) => files[jobs[i][0]][jobs[i][1]] = r)
    for (let [f, v] of Object.entries(files)) mkdirSync(path.dirname(f), { recursive: true }), writeFileSync(f, json(v))
    // the scores are kept, the renders not (a set's renders run to gigabytes; rendered again if ever needed)
    for (let [, , j] of jobs) if (j.out !== j.in) unlinkSync(j.out)
  }
  for (let it of items) out[it.name] = files[path.join(HOME, split, it.cond, key, 'scores.json')][it.name]
  return out
}

// ---- tables
const dB = v => 10 * Math.log10(v)
const fmt = (v, d = 2, sign = false) => !Number.isFinite(v) ? (v > 0 ? '∞' : v < 0 ? '−∞' : '–') : (v < 0 ? '−' : sign && v > 0 ? '+' : '') + Math.abs(v).toFixed(d)
const sum = (rs, k) => rs.reduce((a, r) => a.map((v, i) => v + r[k][i]), rs[0][k].map(() => 0))
const lost = rs => { let s = sum(rs, 'split'); return [dB(s[0] / s[1]), dB(s[2] / s[3])] }
const level = rs => { let a = sum(rs, 'bin'), b = sum(rs, 'bout'); return a.map((v, i) => dB(b[i] / v)).reduce((m, v) => Math.abs(v) > Math.abs(m) ? v : m, 0) }
const untouched = rs => `${Math.round(100 * mean(rs.map(r => +r.same)))} %`
const ci = (a, b, f) => { let d = a.map((r, i) => f(r) - f(b[i])), m = mean(d), s = Math.sqrt(d.reduce((t, v) => t + (v - m) ** 2, 0) / (d.length - 1)); return `${fmt(m, 2, true)} ± ${(1.96 * s / Math.sqrt(d.length)).toFixed(2)}` }
const ovrl = r => r.dns[2]

async function report(split) {
  let mf = path.join(HOME, 'sets', split, 'manifest.json')
  if (!existsSync(mf)) py('build', split)
  let items = JSON.parse(readFileSync(mf)), at = (c, g) => items.filter(it => it.cond === c && (!g || it.group === g))
  // the systems a condition runs: all on speech, those not for speech alone on music
  let S = ['in', ...Object.keys(SYSTEMS)], sys = c => S.filter(s => !SYSTEMS[s]?.speech || at(c)[0]?.kind === 'speech')
  let get = async (c, g) => { let o = {}; for (let s of sys(c)) { let sc = await scores(split, at(c, g), s); o[s] = at(c, g).map(it => sc[it.name]) } return o }
  let log = s => console.log(s + '\n')
  log(`## De-reverb, ${split}: RX 12 and dereverb ${VER}`)
  for (let s of S) if (s !== 'in') for (let c of ['room', 'noisy', 'dry', 'music', 'pauses', 'music-room']) if (sys(c).includes(s)) await scores(split, at(c), s)

  for (let g of ['short', 'long']) {
    let R = await get('room', g)
    log(`Speech in a room, ${g} takes (${R.in.length}):\n\n` + table(['', 'voice lost dB', 'tail taken dB', 'PESQ', 'STOI', 'SIG', 'BAK', 'OVRL'],
      S.map(s => { let [v, t] = lost(R[s]); return [LABEL[s], s === 'in' ? '' : fmt(v), s === 'in' ? '' : fmt(t, 1), fmt(mean(R[s].map(r => r.pesq))), fmt(mean(R[s].map(r => r.stoi)), 3), ...[0, 1, 2].map(k => fmt(mean(R[s].map(r => r.dns[k]))))] })))
  }
  let N = await get('noisy')
  log(`Speech in a room, DEMAND noise 10 dB under it (${N.in.length}):\n\n` + table(['', 'PESQ', 'STOI', 'SIG', 'BAK', 'OVRL'],
    S.map(s => [LABEL[s], fmt(mean(N[s].map(r => r.pesq))), fmt(mean(N[s].map(r => r.stoi)), 3), ...[0, 1, 2].map(k => fmt(mean(N[s].map(r => r.dns[k]))))])))
  let Y = await get('dry')
  log(`Dry speech (${Y.in.length}):\n\n` + table(['', 'untouched', 'PESQ', 'OVRL', 'SI-SDR dB, median', 'level change dB'],
    S.slice(1).map(s => [LABEL[s], untouched(Y[s]), fmt(mean(Y[s].map(r => r.pesq))), fmt(mean(Y[s].map(ovrl))), fmt(median(Y[s].map(r => r.sisdr_in)), 1), fmt(level(Y[s]))])))
  let groups = [...new Set(at('music').map(it => it.group))]
  for (let c of ['music', 'pauses']) {
    let rows = []
    for (let g of groups) { let M = await get(c, g); for (let s of sys(c).slice(1)) rows.push([`${g} (${M.in.length}), ${LABEL[s]}`, untouched(M[s]), fmt(median(M[s].map(r => r.sisdr_in)), 1), fmt(level(M[s]))]) }
    log(`${c === 'music' ? 'Music as it is' : 'Music with pauses'}:\n\n` + table(['', 'untouched', 'SI-SDR dB, median', 'level change dB'], rows))
  }
  let rows = []
  for (let g of groups) { let M = await get('music-room', g); for (let s of sys('music-room').slice(1)) { let [v, t] = lost(M[s]); rows.push([`${g} (${M.in.length}), ${LABEL[s]}`, fmt(v), fmt(t, 1), fmt(level(M[s]))]) } }
  log('Music in a room:\n\n' + table(['', 'music lost dB', 'tail taken dB', 'level change dB'], rows))
  // ours against each RX, take by take
  let rx = S.filter(s => s.startsWith('rx')), D = [['room, short', await get('room', 'short')], ['room, long', await get('room', 'long')], ['noisy', N], ['dry', Y]]
  log('Ours − RX, per take (mean ± 1.96 s.e.):\n\n' + table(['', ...rx.flatMap(s => [`PESQ vs ${LABEL[s]}`, `OVRL vs ${LABEL[s]}`])],
    D.map(([c, R]) => [c, ...rx.flatMap(s => [ci(R.ours, R[s], r => r.pesq), ci(R.ours, R[s], ovrl)])])))
}

// ---- tune: coordinate descent over RX's settings on reverb-train, by mean PESQ (STOI alongside)
async function tune() {
  // every other training utterance (63 of 126): the search's cost halved; the choice is scored on all of them after
  let dir = path.join(DATA, 'vbreverb'), all = readdirSync(path.join(dir, 'train-reverb')).filter(f => f.endsWith('.wav')).sort()
    .map(f => ({ cond: 'vbreverb', name: f.slice(0, -4), sr: 48000, kind: 'pesq', in: path.join(dir, 'train-reverb', f), ref: path.join(dir, 'train-clean', f) }))
  let items = all.filter((_, i) => i % 2 === 0)
  let seen = {}
  async function score(p, learn) {
    let k = (learn ? 'learn,' : '') + pkey(p)
    if (seen[k]) return seen[k]
    SYSTEMS.t = RX(p, learn)
    let sc = Object.values(await scores('tune', items, 't'))
    seen[k] = { p, learn, pesq: mean(sc.map(r => r.pesq)), stoi: mean(sc.map(r => r.stoi)) }
    console.log(`${k}: PESQ ${seen[k].pesq.toFixed(3)}, STOI ${seen[k].stoi.toFixed(3)}`)
    return seen[k]
  }
  let B = ['band_strength_low', 'band_strength_low_mid', 'band_strength_high_mid', 'band_strength_high']
  let grid = [['reduction', [0, 5, 10, 15, 20]], ['tail_length', [0.5, 0.75, 1, 1.5, 2, 3, 4]], ['artifact_smoothing', [0, 3, 6, 9, 10]],
    ['bands', [2, 4, 6, 8, 10]], ...B.map(b => [b, [2, 4, 6, 8, 10]]), ['enhance_dry_signal', [false, true]]]
  let best = await score({}, false)
  // a pass over every setting, a second over the ones that moved
  for (let pass = 0; pass < 2; pass++) for (let [k, vs] of grid.filter(([k]) => !pass || k === 'bands' || Object.keys(best.p).some(q => q.startsWith(k)))) for (let v of vs) {
    let p = { ...best.p, ...(k === 'bands' ? Object.fromEntries(B.map(b => [b, v])) : { [k]: v }) }
    let r = await score(p, false)
    if (r.pesq > best.pesq) best = r
  }
  // Learn's profile (tail length, bands) with the best of the rest
  let rest = Object.fromEntries(Object.entries(best.p).filter(([k]) => k !== 'tail_length' && !B.includes(k)))
  let l = await score(rest, true)
  for (let [k, vs] of grid.filter(([k]) => ['reduction', 'artifact_smoothing', 'enhance_dry_signal'].includes(k))) for (let v of vs) {
    let r = await score({ ...l.p, [k]: v }, true)
    if (r.pesq > l.pesq) l = r
  }
  if (l.pesq > best.pesq) best = l
  console.log('\n' + table(['setting', 'PESQ', 'STOI'], Object.entries(seen).sort((a, b) => b[1].pesq - a[1].pesq).slice(0, 15).map(([k, r]) => [k, r.pesq.toFixed(3), r.stoi.toFixed(3)])))
  for (let [name, r] of [['defaults', seen.default], ['best', best]]) {
    SYSTEMS.t = RX(r.p, r.learn)
    let sc = Object.values(await scores('tune', all, 't'))
    console.log(`${name} on all ${all.length}: PESQ ${mean(sc.map(r => r.pesq)).toFixed(3)}, STOI ${mean(sc.map(r => r.stoi)).toFixed(3)}`)
  }
  console.log(`\nbest: ${JSON.stringify({ params: best.p, learn: best.learn })}`)
}

let arg = process.argv[2] ?? 'test'
if (arg === 'tune') await tune()
else if (arg === 'test' || arg === 'train') await report(arg)
else console.log('usage: node bench/rx/dereverb.mjs [test|train|tune]')
