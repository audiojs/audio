// Lavalier rustle on dialogue: our derustle against deepfilter, iZotope RX 12 Dialogue Isolate (bench/rx/host.py) and
// what each does where there is no rustle. RX 12 De-rustle is an AAX plugin only (Pro Tools), which Pedalboard cannot
// host: Dialogue Isolate, RX's own neural dialogue separator, stands for RX here.
//
//   node bench/rx/derustle.mjs SPLIT CONDITIONS SYSTEM [SYSTEM...]   render what is missing, score, print the tables
//   SHARD=k/N node bench/rx/derustle.mjs ...                           render every N-th take from the k-th, no scores
//
// bench/rx/isolate.mjs's harness (its systems, scores and tables) with these conditions, its renders in
// DATA/rx/isolate/SPLIT/CONDITION/. SYSTEM as there: `input`, a name of isolate's SYSTEMS or of SYSTEMS below,
// `rx:k=v;…` (Dialogue Isolate), `op:<stages>` (audio's chain, as the editor runs it).
//
// Speech: a speaker talking for a while, as a lavalier hears a presenter: five consecutive VoiceBank clean takes of one
// speaker (Valentini-Botinhao 2017, CC BY 4.0), 0.3 to 0.8 s apart (seeded), at -26 dBFS active level as isolate.mjs
// sets its takes: `tune` every other group of the 504 training takes (28 speakers; 39 talkers, 14 to 26 s), `test`
// every third group of the 824 test takes (p232, p257; 55 talkers, 10 to 37 s). VoiceBank's takes alone, 2 to 4 s, are
// shorter than a stretch of rustle: what holds still over seconds can't be told from it.
// Rustle: no recording of a lavalier rubbing on clothes is openly licensed (Wichern and Lukin, DAFx-18, recorded an hour
// of their own and kept it). Freesound's clothing foley and mic handling stand in: 94 recordings, CC0 (81) and CC BY
// (13), 66 minutes, their 48 kHz previews (VBR MP3, the originals need a login), DATA/rustle/manifest.json naming each
// one's author, licence and page. Split by author, half the minutes each: `tune` 53 recordings, `test` 41. The rustle
// for a take is a seeded stretch of a seeded recording of the split (lib.mjs lcg), set by active levels, so over the
// stretches where it rustles, as Wichern and Lukin set theirs.
//   lav-5, lav0, lav5: rustle 5 dB over, level with, 5 dB under the voice
//   lav-room: rustle level with the voice over a room's steady noise 25 dB under it (DEMAND, isolate.mjs's noises);
//     the reference is the take with that room: what RX calls ambience is kept, only the rustle is taken
//   room: the take in that room, no rustle: nothing to take, the reference the input
//   talk: the take alone, nothing to take (harm)
// Scores: isolate.mjs's (PESQ, STOI, SI-SDR, DNSMOS SIG, BAK, OVRL), at 16 kHz.
import path from 'node:path'
import { readdirSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import audio from '../../audio.js'
import { DATA, readWav, lcg } from './lib.mjs'
import { CONDITIONS, SYSTEMS as ISOLATE, f32, at, add, under, cut, demand, render, report } from './isolate.mjs'

// iZotope RX 12 Dialogue Isolate as isolate.mjs runs it (its noise off, and tuned there: its reverb off too); ours as
// the editor runs them: deepfilter at its defaults (18 dB limit, 40 dB floor) and unlimited, derustle at its (chosen on
// `tune`: deepfilter's limit and floor over 6 to 30 and 40 to 60 dB; Wichern and Lukin's 2 s minimum kept under the voice;
// DeepFilterNet3 forward and on the reversed input, averaged: fn/derustle.js)
export const SYSTEMS = Object.assign(ISOLATE, {
  deepfilter: 'op:deepfilter()',
  'deepfilter-0': 'op:deepfilter(0)',
  derustle: 'op:derustle()',
})

const memo = (f, m = new Map()) => k => m.has(k) ? m.get(k) : (m.set(k, f(k)), m.get(k))
const recordings = memo(split => { let d = path.join(DATA, 'rustle', split); return readdirSync(d).filter(f => f.endsWith('.f32')).sort().map(f => f32(path.join(d, f))) })
// n samples of rustle for a take: a seeded recording from a seeded offset, tiled when shorter
function rustle(split, n, r) {
  let all = recordings(split), x = all[Math.floor(r() * all.length)]
  return cut(x, Math.floor(r() * Math.max(1, x.length - n)), n)
}
const room = (c, s, i, r) => under(c, demand(s, i, c.length, r), 25)

const SR = 48000, LEVEL = -26, VB = { tune: ['vbdemand-train/clean', 2], test: ['vbdemand/clean_testset_wav', 3] }
// groups of five consecutive takes of one speaker (the names sort by speaker), every k-th group
const groups = memo(split => {
  let [d, k] = VB[split], files = readdirSync(path.join(DATA, d)).filter(f => f.endsWith('.wav')).sort(), all = []
  for (let i = 0; i + 5 <= files.length; i += 5) if (files[i].slice(0, 4) === files[i + 4].slice(0, 4)) all.push(files.slice(i, i + 5).map(f => path.join(DATA, d, f)))
  return all.filter((_, i) => i % k === 0)
})
// each: (split) → [{ name, make: async () → { x, sr, ref } }], as isolate.mjs's speech(), on a take of five
const talk = mix => split => groups(split).map((paths, i) => ({
  name: path.basename(paths[0], '.wav') + '+4', make: async () => {
    let r = lcg(1 + i), parts = paths.map(p => readWav(p).ch[0]), gaps = parts.map(() => Math.round((0.3 + 0.5 * r()) * SR))
    let c = new Float32Array(parts.reduce((n, p, j) => n + p.length + gaps[j], 0)), o = 0
    parts.forEach((p, j) => { c.set(p, o); o += p.length + gaps[j] })
    c = at(c, LEVEL)
    let { x, ref = c } = await mix(c, split, i, r)
    return { x, sr: SR, ref }
  },
}))

for (let snr of [-5, 0, 5]) CONDITIONS[`lav${snr}`] = talk((c, s, i, r) => ({ x: add(c, under(c, rustle(s, c.length, r), snr)) }))
CONDITIONS['lav-room'] = talk((c, s, i, r) => {
  let amb = add(c, room(c, s, i, r))
  return { x: add(amb, under(c, rustle(s, c.length, r), 0)), ref: amb }
})
CONDITIONS.room = talk((c, s, i, r) => { let x = add(c, room(c, s, i, r)); return { x, ref: x } })
CONDITIONS.talk = talk(c => ({ x: c }))
export const RUSTLE = ['lav-5', 'lav0', 'lav5', 'lav-room', 'room', 'talk']

let [split, conds, ...ids] = process.argv.slice(2)
if (!process.argv[1] || import.meta.url !== pathToFileURL(path.resolve(process.argv[1])).href) {}
else if (!['tune', 'test'].includes(split) || !conds || !ids.length) console.log('usage: node bench/rx/derustle.mjs tune|test CONDITION[,…]|all SYSTEM [SYSTEM…]')
else {
  conds = conds === 'all' ? RUSTLE : conds.split(',')
  for (let c of conds) if (!CONDITIONS[c]) throw new Error(`unknown condition ${c}`)
  // the model's output shared by the systems reading it (deepfilter and derustle: fn/deepfilter.js memo), in this process
  let store = new Map(); audio.memo = { get: k => store.get(k), set: (k, v) => store.set(k, v) }
  for (let c of conds) await render(split, c, ids, process.env.SHARD ?? '0/1')
  if (!process.env.SHARD) report(split, conds, ids)
}
