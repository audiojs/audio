// Verify: check (a sound against a delivery spec, or limits of your own) and compare (what changed from a sound before).
// Each spec's limits are written here from their sources (read 2026-11-18), apart from fn/check.js; each file is built
// to sit on a limit or one printed step (0.01) past it, the side it must fall on following from the source's number,
// its level known by construction: a 997 Hz sine's loudness through BS.1770's own K-weighting coefficients, a burst's
// true peak from its formula read between samples. Each compare pair carries one known change; the numbers expected
// are computed here from the signals and their definitions, not read from fn/compare.js.
import test from 'tst'
import audio from '../audio.js'
import { vad } from '@audio/vad'
import { spawnSync } from 'child_process'
import { fileURLToPath } from 'url'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { gauss } from './gen.js'
import { parseArgs } from '../bin/cli.js'
import { dialogOf } from '../fn/loudness.js'

const lena = fileURLToPath(new URL('../node_modules/audio-lena/lena.wav', import.meta.url))
const cli = fileURLToPath(new URL('../bin/cli.js', import.meta.url))
const dir = mkdtempSync(join(tmpdir(), 'audio-check-')), tmp = name => join(dir, name)
process.on('exit', () => rmSync(dir, { recursive: true, force: true }))
const run = (...args) => spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8' })
const SLOW = { timeout: 180000 }

const SR = 48000, STEP = 0.01  // a limit's resolution: a rule judges its value to 0.01 as printed
const db = v => 20 * Math.log10(v), db10 = p => p > 0 ? 10 * Math.log10(p) : -Infinity, gainOf = d => 10 ** (d / 20)
const scale = (x, g) => x.map(v => v * g)
const sine = (f, dur, amp, sr = SR) => Float32Array.from({ length: Math.round(dur * sr) }, (_, i) => amp * Math.sin(2 * Math.PI * f * i / sr))
const from = (x, sr = SR) => audio.from(Array.isArray(x) ? x : [x], { sampleRate: sr })
const rule = (r, name) => r.rules.find(x => x.name === name)
const ms = x => x.reduce((s, v) => s + v * v, 0) / x.length

// ── The limits, as their sources state them ─────────────────────────────

// Apple Podcasts, Best practices for audio, Audio levels (podcasters.apple.com/support/893-audio-requirements): "we
//   recommend ... around -16 dB LKFS, with a +/- 1 dB tolerance, and that the true-peak value doesn't exceed -1 dB FS"
// EBU R 128-2023: (h) -23.0 LUFS "shall", (i) ±0.2 LU in quality control, (m) "shall not exceed −1 dBTP"
// Netflix Sound Mix Specifications and Best Practices: "Set average loudness at -27 LKFS with a tolerance of ±2 LU,
//   dialog-gated. Peaks must not exceed -2dB True Peak"
// ATSC A/85:2026-07 §6: "should be –24 LKFS", "approximately ±2 dB around this value"; "True Peak level should be kept
//   below –2 dBTP"
// ACX audio submission requirements (acx.com/help/article/what-are-the-acx-audio-submission-requirements): "Each file
//   needs to fall between ... -23dB and -18dB RMS", "must have peak values no higher than -3dB", "must have a noise floor
//   no higher than -60dB RMS", "We recommend between 1 and 5 seconds of room tone at the beginning and end", "Room tone
//   spacing must not exceed 5 seconds", "44.1kHz"
const LOUD = { podcast: [-17, -15], broadcast: [-23.2, -22.8], atsc: [-26, -22] }
const DIALOG = { netflix: [-29, -25] }
const PEAK = { podcast: -1, broadcast: -1, netflix: -2, atsc: -2 }
const REQUIRED = { podcast: false, broadcast: true, netflix: true, atsc: false, spotify: false }
// Spotify (support.spotify.com/us/artists/article/loudness-normalization), Mastering tips: "Keep it below -1dB TP (True
//   Peak) max", "If your master is louder than -14dB integrated LUFS, keep True Peak below -2dB"
const SPOTIFY = { quiet: -1, loud: -2, at: -14 }

/** Each limit, and one printed step past it: [value, pass] (either end null: open) */
const edges = ([lo, hi]) => [...lo == null ? [] : [[lo, true], [lo - STEP, false]], ...hi == null ? [] : [[hi, true], [hi + STEP, false]]]

// ITU-R BS.1770-4 Annex 1, Tables 1 and 2: the K-weighting's two stages at 48 kHz; a 997 Hz sine of amplitude A reads
// -0.691 + 10·log10(|H(997)|²·A²/2) LKFS (eq. 2), every gating block alike
const KW = [[[1.53512485958697, -2.69169618940638, 1.19839281085285], [1, -1.69065929318241, 0.73248077421585]], [[1, -2, 1], [1, -1.99004745483398, 0.99007225036621]]]
const response = ([b, a], f, sr) => { let w = 2 * Math.PI * f / sr, re = c => c[0] + c[1] * Math.cos(w) + c[2] * Math.cos(2 * w), im = c => -c[1] * Math.sin(w) - c[2] * Math.sin(2 * w); return (re(b) ** 2 + im(b) ** 2) / (re(a) ** 2 + im(a) ** 2) }
const K997 = response(KW[0], 997, SR) * response(KW[1], 997, SR)
const amp = L => Math.sqrt(2 * 10 ** ((L + 0.691) / 10) / K997)
const loud = (L, dur = 4) => from(sine(997, dur, amp(L)))

// A quiet 997 Hz bed, then silence holding a 20 ms Hann-windowed 1 kHz burst: the true peak is the burst's, its formula
// read 256 times a sample
const BED = 3, BURST = Math.round(0.02 * SR), burst = t => (0.5 - 0.5 * Math.cos(2 * Math.PI * t / BURST)) * Math.sin(2 * Math.PI * 1000 * t / SR)
let pk = 0
for (let t = 0; t <= BURST; t += 1 / 256) pk = Math.max(pk, Math.abs(burst(t)))
function peaked(tp, bed = 0.05) {
  let x = new Float32Array((BED + 1) * SR), s = sine(997, BED, bed), g = gainOf(tp) / pk
  for (let i = 0; i < s.length; i++) x[i] = s[i] * Math.min(1, i / 480, (s.length - i) / 480)
  for (let i = 0; i < BURST; i++) x[Math.round((BED + 0.5) * SR) + i] = g * burst(i)
  return from(x)
}
// a voice, read once: every test is declared before the first one runs
const voice = (await audio(lena).read())[0]

test('check: the measures the limits hold: a 997 Hz sine\'s loudness and a burst\'s true peak, as BS.1770 defines them', async t => {
  for (let L of [-27, -16]) t.almost(await loud(L).stat('loudness'), L, 0.002, `loudness at ${L} LUFS`)
  for (let tp of [-2, -1]) t.almost(await peaked(tp).stat('truepeak'), tp, 0.002, `true peak at ${tp} dBTP`)
})

test('check: each loudness limit, at it and a printed step past it (Apple, EBU R 128, ATSC); a recommended rule missed fails as a required one', SLOW, async t => {
  for (let [spec, lim] of Object.entries(LOUD)) for (let [L, pass] of edges(lim)) {
    let r = await loud(L).check(spec), x = rule(r, 'Loudness')
    t.almost(x.value, L, 0.003, `${spec} at ${L.toFixed(2)} LUFS`)
    t.is([x.pass, x.required], [pass, REQUIRED[spec]], `${spec}: ${L.toFixed(2)} LUFS ${pass ? 'inside' : 'outside'} ${lim.join(' to ')}, ${REQUIRED[spec] ? 'required' : 'recommended'}`)
    t.is(r.pass, pass, 'the check fails with the rule, whichever word its source uses')
    t.is(x.hint, pass ? undefined : spec === 'atsc' ? `normalize(-24, 'lufs', { ceiling: -2 })` : `normalize('${spec}')`, 'a fail names its fix')
  }
})

test('check: each true-peak limit, at it and a printed step past it (Apple, EBU R 128, Netflix, ATSC)', SLOW, async t => {
  for (let [spec, max] of Object.entries(PEAK)) for (let [tp, pass] of edges([null, max])) {
    let r = await peaked(tp).check(spec), x = rule(r, 'True peak')
    t.almost(x.value, tp, 0.003, `${spec}: true peak ${tp.toFixed(2)} dBTP`)
    t.is([x.pass, x.required], [pass, REQUIRED[spec]], `${spec}: ${tp.toFixed(2)} dBTP ${pass ? 'within' : 'over'} ${max}`)
    t.is(!!x.hint, !pass, 'a fail, and only a fail, names its fix')
  }
  // A/85 §6: "Minor measurement tolerance ... of up to approximately ±0.5 dBTP ... is acceptable": noted over -2 dBTP
  // and as far as -1.5, as printed
  for (let [tp, noted] of [[-2, false], [-1.99, true], [-1.6, true], [-1.5, true], [-1.49, false]]) {
    let x = rule(await peaked(tp).check('atsc'), 'True peak')
    t.is(/within the ±0\.5 dB A\/85 §6 calls acceptable/.test(x.note ?? ''), noted, `atsc at ${tp.toFixed(2)} dBTP: ${noted ? 'noted' : 'no note'} (${x.note})`)
  }
})

test('check: Spotify recommends -1 dBTP, and -2 for a master louder than -14 LUFS; its loudness only describes playback', SLOW, async t => {
  for (let [bed, max, loudness] of [[0.05, SPOTIFY.quiet, 'quiet'], [0.35, SPOTIFY.loud, 'loud']]) for (let [tp, pass] of edges([null, max])) {
    let r = await peaked(tp, bed).check('spotify'), x = rule(r, 'True peak'), l = rule(r, 'Loudness')
    t.is(l.value > SPOTIFY.at, loudness === 'loud', `${loudness}: ${l.value.toFixed(1)} LUFS`)
    t.is([x.max, x.pass, x.required, l.pass, r.pass], [max, pass, false, null, pass], `${loudness}, ${tp.toFixed(2)} dBTP: ${pass ? 'within' : 'over'} ${max}, recommended; loudness informs`)
  }
  // Positive gain on playback "leave[s] 1 dB headroom": a master at -20 LUFS with its true peak at -5 dBTP plays 4 dB
  // louder (to -1 dBTP), not the 6 dB to -14 LUFS
  let quiet = await peaked(-5, amp(-20)).check('spotify'), l = rule(quiet, 'Loudness'), tp = rule(quiet, 'True peak').value
  let gain = Math.max(0, Math.min(SPOTIFY.at - l.value, -1 - tp))
  t.ok(gain > 0 && gain < SPOTIFY.at - l.value - 0.5, `${l.value.toFixed(2)} LUFS, ${tp.toFixed(2)} dBTP: headroom, not loudness, sets it`)
  t.is(l.note, `plays ${gain.toFixed(1)} dB louder`, l.note)
})

test('check: Netflix\'s dialog limits, at them and a printed step past; its fix lands a voice\'s dialog on -27', SLOW, async t => {
  // @audio/vad hears a steady tone as voiced: the tone's every window is dialog, its level known
  for (let [spec, lim] of Object.entries(DIALOG)) for (let [L, pass] of edges(lim)) {
    let r = await loud(L, 12).check(spec), x = rule(r, 'Dialog loudness')
    t.almost(x.value, L, 0.003, `${spec}: dialog at ${L.toFixed(2)} LUFS`)
    t.is([x.pass, r.pass], [pass, pass], `${spec}: ${L.toFixed(2)} ${pass ? 'inside' : 'outside'} ${lim.join(' to ')}, required`)
  }
  let d = await from(voice, 44100).stat('dialog', { relative: false }), a = from(scale(voice, gainOf(-31 - d)), 44100), x = rule(await a.check('netflix'), 'Dialog loudness')
  t.is(x.hint, `normalize(${Math.round(10 * (await a.stat('loudness') - 27 - x.value)) / 10}, 'lufs', { ceiling: -2 })`, 'the program moved by the dialog\'s distance, its ceiling Netflix\'s')
  let fixed = await new Function('a', `return a.${x.hint}`)(a.clone()).check('netflix')
  t.ok(rule(fixed, 'Dialog loudness').pass && rule(fixed, 'True peak').pass, `${x.hint}: ${rule(fixed, 'Dialog loudness').value.toFixed(2)} LUFS`)
})

test('check: dialog as Netflix and A/85 measure it: BS.1770-1, without the relative gate', SLOW, async t => {
  // a tone (all of it dialog to @audio/vad 2.0 at 48 kHz) 6 s at L, 6 s 20 dB under. BS.1770 eq. 3-7 on its 100 ms
  // steps: 400 ms windows every step, each the mean of its four; the relative gate 10 LU under their mean leaves the
  // quiet half out, BS.1770-1 holds every window
  let L = -20, x = new Float32Array(12 * SR), a1 = amp(L), a2 = amp(L - 20)
  for (let i = 0; i < x.length; i++) x[i] = (i < 6 * SR ? a1 : a2) * Math.sin(2 * Math.PI * 997 * i / SR)
  let step = Array.from({ length: 120 }, (_, j) => j < 60 ? 1 : 0.01), win = step.slice(3).map((_, j) => (step[j] + step[j + 1] + step[j + 2] + step[j + 3]) / 4)
  let mean = w => w.reduce((p, v) => p + v, 0) / w.length, kept = win.filter(v => v > mean(win) / 10)
  let s = from(x), [gated, one] = [await s.stat('dialog'), await s.stat('dialog', { relative: false })]
  t.almost(gated, L + db10(mean(kept)), 0.005, `with the relative gate: ${gated.toFixed(3)}, the windows over it ${(L + db10(mean(kept))).toFixed(3)}`)
  t.almost(one, L + db10(mean(win)), 0.005, `without it: ${one.toFixed(3)}, every window ${(L + db10(mean(win))).toFixed(3)}`)
  t.almost(rule(await s.check('netflix'), 'Dialog loudness').value, one, 1e-9, 'netflix holds the second')
})

// Netflix's Best Practices, "What follows are not Technical Specifications. While adherence is not mandatory, it is
// recommended for optimal results": "When near field Atmos or 5.1 mixes measure at less than 15% dialogue, program
// target measurement will be used instead (-24 LKFS +/- 2 LU - ITU BS 1770-3 or -4)". The dialog rule stays the one
// required; for a 6-channel mix under 15 % its programme at -24 ±2 passes it where the dialog misses
test('check: Netflix under 15 % dialogue: a 5.1 mix passes on its programme at -24 ±2 where its dialog misses; else the dialog rule', SLOW, async t => {
  // a tone in the centre (dialog to the voice detector) for `dur` s of 12, a noise bed in L, R, Ls, Rs; `pad` s of
  // digital silence after it, under the absolute gate
  let mix = (bedA, toneA, dur, chs = 6, pad = 0) => {
    let n = 12 * SR, bed = Float32Array.from(gauss(n + pad * SR, 4), (v, i) => i < n ? v * bedA : 0), z = new Float32Array(bed.length)
    let c = Float32Array.from(bed, (v, i) => v + (i < dur * SR ? toneA * Math.sin(2 * Math.PI * 997 * i / SR) : 0))
    return from(chs === 6 ? [bed, bed, c, z, bed, bed] : chs === 5 ? [bed, bed, c, bed, bed] : [c, c])
  }
  let read = async a => ({ ...await dialogOf(a, { relative: false }), lufs: await a.stat('loudness'), dialog: (await dialogOf(a, { relative: false })).lufs, r: await a.check('netflix') })
  let inside = (v, lo, hi) => Math.round(v * 100) / 100 >= lo && Math.round(v * 100) / 100 <= hi
  // under 15 %, the dialog loud, the programme within -24 ±2: passes on the programme, the line saying so
  let a = await read(mix(0.015, 0.1, 1.92)), x = a.r.rules[0]
  t.ok(a.share < 0.15 && !inside(a.dialog, -29, -25) && inside(a.lufs, -26, -22), `${(a.share * 100).toFixed(1)} %, dialog ${a.dialog.toFixed(2)}, programme ${a.lufs.toFixed(2)}`)
  t.is([x.name, x.value, x.min, x.max, x.pass, x.required, a.r.pass], ['Dialog loudness', a.lufs, -26, -22, true, true, true], 'the dialog rule, passed on the programme')
  t.ok(/under 15 %: the programme read, as Netflix's Best Practices \(not mandatory\) read a 5\.1 or Atmos mix/.test(x.note), x.note)
  // under 15 %, the dialog within -27 ±2: the dialog read, as ever
  let b = await read(mix(0.003, 0.06, 1.68)), y = b.r.rules[0]
  t.ok(b.share < 0.15 && inside(b.dialog, -29, -25), `dialog ${b.dialog.toFixed(2)}`)
  t.is([y.value, y.min, y.max, y.pass], [b.dialog, -29, -25, true], 'the dialog read')
  // a dialog that passes is the rule as read: the programme, read only where the dialog misses, goes unsaid
  t.ok(!inside(b.lufs, -26, -22) && y.note === `speech found by voice activity, not Dolby Dialogue Intelligence; ${(b.share * 100).toFixed(1)} % dialogue, under 15 %`, `programme ${b.lufs.toFixed(2)}: ${y.note}`)
  // both missed: the dialog rule fails, its fix the dialog's, and the programme said
  let c = await read(mix(0.002, 0.3, 1.68)), w = c.r.rules[0]
  t.ok(c.share < 0.15 && !inside(c.dialog, -29, -25) && !inside(c.lufs, -26, -22), `dialog ${c.dialog.toFixed(2)}, programme ${c.lufs.toFixed(2)}`)
  t.is([w.value, w.pass, c.r.pass], [c.dialog, false, false], 'failed on the dialog')
  t.ok(w.note.includes(`the programme, ${c.lufs.toFixed(2)} LUFS, misses -26 to -22 too`), w.note)
  let fixed = await new Function('a', `return a.${w.hint}`)(mix(0.002, 0.3, 1.68)).check('netflix')
  t.ok(fixed.pass && fixed.rules[0].min === -29, `${w.hint}: the dialog at ${fixed.rules[0].value.toFixed(2)}`)
  // 15 % or more: no programme read, the dialog fails; digital silence, under the absolute gate, counts in no share
  for (let [name, m] of [['over 15 %', mix(0.015, 0.1, 2.1)], ['over 15 % of what the absolute gate keeps, 12 s of silence after', mix(0.015, 0.1, 2.1, 6, 12)], ['5 channels under 15 %', mix(0.015, 0.1, 1.92, 5)]]) {
    let d = await read(m), v = d.r.rules[0]
    t.ok((name.startsWith('5') ? d.share < 0.15 : d.share >= 0.15) && inside(d.lufs, -26, -22), `${name}: ${(d.share * 100).toFixed(1)} %, programme ${d.lufs.toFixed(2)}`)
    t.is([v.value, v.min, v.max, v.pass, d.r.pass], [d.dialog, -29, -25, false, false], `${name}: the dialog rule, failed`)
    if (name.startsWith('5')) t.ok(v.note.endsWith("Netflix measures the programme of a 5.1 or Atmos mix under 15 %, of a 5-channel one it doesn't say"), v.note)
  }
  let two = rule(await mix(0.015, 0.1, 1.68, 2).check('netflix'), 'Dialog loudness')
  t.ok(/% dialogue: Netflix measures the programme of a 5\.1 or Atmos mix under 15 %, of a stereo one it doesn't say/.test(two.note) && !two.pass, two.note)
})

test('check: ATSC long-form on its dialog (BS.1770-1), short-form under 3 minutes on its full mix', SLOW, async t => {
  // a 220 Hz tone (dialog to @audio/vad 2.0 at 16 kHz) 20 s, then noise 10 dB over it: the dialog and the full mix
  // apart; at 16 kHz to keep three minutes small
  let sr = 16000, mix = dur => { let x = Float32Array.from(gauss(Math.round(dur * sr), 6), v => 0.1 * v); for (let i = 0; i < 20 * sr; i++) x[i] = 0.03 * Math.sin(2 * Math.PI * 220 * i / sr); return from(x, sr) }
  let long = mix(180), short = mix(179.9), [rl, rs] = [await long.check('atsc'), await short.check('atsc')]
  t.ok(rule(rl, 'Dialog loudness') && /long-form/.test(rule(rl, 'Dialog loudness').note), JSON.stringify(rl.rules[0]))
  t.is(rule(rl, 'Dialog loudness').value, await long.stat('dialog', { relative: false }), 'long-form: dialog without the relative gate')
  t.ok(rule(rs, 'Loudness') && /short-form: the full mix/.test(rule(rs, 'Loudness').note), JSON.stringify(rs.rules[0]))
  t.is(rule(rs, 'Loudness').value, await short.stat('loudness'), 'short-form: the full mix')
})

// An ACX chapter at 44.1 kHz, block-aligned (1024 samples): a 3 kHz tone for the room (its RMS the floor, exactly: whole
// cycles in every 0.4 s window), a 300 Hz tone for the voice after `head` blocks and before `tail`, whole-file RMS set
// to `rms` dB by the voice's level (solved on the samples), a single sample of `peak` dB in the voice
const BS = 1024, blocks = s => Math.round(s * 44100 / BS)
function chapter({ head = blocks(2), tail = blocks(2), rms = -20, peak = null, floor = -70, sr = 44100 } = {}) {
  let n = (head + 172 + tail) * BS, a = head * BS, b = n - tail * BS
  let room = sine(3000, n / sr, Math.SQRT2 * gainOf(floor), sr), voice = sine(300, (b - a) / sr, 1, sr)
  let m = A => { let s = 0; for (let i = 0; i < n; i++) { let v = room[i] + (i >= a && i < b ? A * voice[i - a] : 0); s += v * v } return s / n }
  let lo = 0, hi = 1
  for (let k = 0; k < 60; k++) { let A = (lo + hi) / 2; if (10 * Math.log10(m(A)) < rms) lo = A; else hi = A }
  let x = Float32Array.from(room, (v, i) => v + (i >= a && i < b ? lo * voice[i - a] : 0))
  if (peak != null) x[a + sr] = gainOf(peak)
  return audio.from([x], { sampleRate: sr })
}

test('check: each ACX limit, at it and a printed step past; ACX\'s 1 s of room tone recommended, its 5 s required, either failing the check', SLOW, async t => {
  let s = k => k * BS / 44100, cases = [
    ...edges([-23, -18]).map(([v, pass]) => ['RMS', { rms: v }, v, pass, true]),
    ...edges([null, -3]).map(([v, pass]) => ['Peak', { peak: v }, v, pass, true]),
    ...edges([null, -60]).map(([v, pass]) => ['Noise floor', { floor: v }, v, pass, true]),
    // room tone to the block: 42 blocks print 0.98 s, 44 print 1.02; 215 print 4.99, 216 print 5.02
    ...[[42, false], [44, true]].flatMap(([k, pass]) => [['Room tone, start', { head: k }, s(k), pass, false], ['Room tone, end', { tail: k }, s(k), pass, false]]),
    ...[[215, true], [216, false]].flatMap(([k, pass]) => [['Room tone spacing', { head: k }, s(k), pass, true], ['Room tone spacing', { tail: k }, s(k), pass, true]]),
    ...[[44099, false], [44100, true], [44101, false]].map(([sr, pass]) => ['Sample rate', { sr }, sr, pass, true]),
  ]
  // at 44.1 kHz no whole block prints 0.99 or 5.01 s; at 32 kHz 31 blocks do (0.992 s), at 48 kHz 235 (5.013 s): one
  // printed step past each end, where a sample rate can hold it (the rate's own rule fails beside it)
  for (let [sr, k, name, pass, required] of [[32000, 31, 'Room tone, start', false, false], [48000, 235, 'Room tone spacing', false, true]]) {
    let x = rule(await chapter({ sr, head: k }).check('acx'), name), v = k * BS / sr
    t.is([x.value.toFixed(2), x.pass, x.required], [v.toFixed(2), pass, required], `${name} ${v.toFixed(4)} s at ${sr} Hz, printed ${v.toFixed(2)}: fails`)
  }
  for (let [name, opts, v, pass, required] of cases) {
    let r = await chapter(opts).check('acx'), x = rule(r, name)
    t.almost(x.value, v, 1e-3, `${name} ${v}: measured ${x.value.toFixed(3)}`)
    t.is([x.pass, x.required], [pass, required], `${name} ${v}: ${pass ? 'passes' : 'fails'}, ${required ? 'required' : 'recommended'}`)
    t.is(r.pass, pass, `${name} ${v}: the check ${pass ? 'passes' : 'fails'} with it, every other rule met`)
  }
  // ACX Check 2.4.2-1's warnings, kept as notes (fn/check.js): a peak under -6 dB ("may be over-compressed or too
  // quiet"), a floor under -90 dB ("dead silence sounds unnatural")
  for (let [opts, name, re, noted] of [[{ peak: -6.5 }, 'Peak', /below -6 dB/, true], [{ peak: -5.5 }, 'Peak', /below -6 dB/, false], [{ floor: -95 }, 'Noise floor', /below -90 dB/, true], [{ floor: -85 }, 'Noise floor', /below -90 dB/, false]]) {
    let x = rule(await chapter(opts).check('acx'), name)
    t.is(re.test(x.note ?? ''), noted, `${name} at ${x.value.toFixed(2)} dB: ${noted ? 'noted' : 'no note'}`)
  }
  t.is(rule(await chapter({ floor: -55 }).check('acx'), 'Noise floor').hint, 'omlsa()', 'a floor over -60 dB: a denoiser that needs no noise profile')
  t.is(rule(await chapter({ rms: -17.99 }).check('acx'), 'RMS').hint, "normalize(-20, 'rms', { ceiling: -3.5 })", 'level: RMS -20, ACX\'s peak under it')
  t.is(rule(await chapter({ peak: -2.99 }).check('acx'), 'Peak').hint, "normalize(-20, 'rms', { ceiling: -3.5 })", 'the same for the peak')
  t.is(rule(await chapter({ head: 42 }).check('acx'), 'Room tone, start').hint, 'trim().pad(1.5, 2).roomtone()', 'room tone')
  let fixed = await chapter({ sr: 48000 }).resample(44100).check('acx')
  t.is(rule(await chapter({ sr: 48000 }).check('acx'), 'Sample rate').hint, 'resample(44100)', 'the fix named')
  t.ok(rule(fixed, 'Sample rate').pass, 'and it fixes it')
})

// ACX: "Each file must be no longer than 120 minutes": past it the file fails, its fix a split at each 120 minutes.
// Silence at 1 kHz keeps four hours small; its other rules are not this test's
test('check: ACX length, 120 minutes at most; past it, a split at each 120', SLOW, async t => {
  for (let [min, pass, hint] of [[120, true, undefined], [120.5, false, 'split(7200)'], [241, false, 'split(7200, 14400)']]) {
    let x = rule(await audio.from([new Float32Array(min * 60 * 1000)], { sampleRate: 1000 }).check('acx'), 'Length')
    t.is([x.value, x.pass, x.hint], [min, pass, hint], `${min} min`)
  }
})

test('check: limits of your own: a number, a range, open ends, a tolerance, units, [min, max]; required; what fails names a fix', SLOW, async t => {
  let a = loud(-20), r = await a.check({ loudness: '-21..-19', truepeak: '..-1db', sampleRate: '48khz', channels: 1, duration: '3s..', lra: [null, 5] })
  t.ok(r.pass && !('spec' in r) && !('url' in r) && !('advice' in r), r.rules.map(x => `${x.name} ${x.value}`).join(', '))
  t.is(r.rules.map(x => [x.name, x.unit, x.min, x.max, x.required]), [['loudness', 'LUFS', -21, -19, true], ['truepeak', 'dBTP', null, -1, true], ['sampleRate', 'Hz', 48000, 48000, true], ['channels', '', 1, 1, true], ['duration', 's', 3, null, true], ['lra', 'LU', null, 5, true]], 'the limits as read')
  let off = await a.check({ loudness: '-16±1', rms: '-30..-25', duration: '..2m' })
  t.is(off.rules.map(x => [x.min, x.max, x.pass]), [[-17, -15, false], [-30, -25, false], [null, 120, true]], '±, a range, minutes')
  t.is(off.rules.map(x => x.hint), ["normalize(-16, 'lufs')", "normalize(-27.5, 'rms')", undefined], 'each fail its fix, at the range\'s middle')
  let fixed = await new Function('a', `return a.${off.rules[0].hint}`)(a.clone()).check({ loudness: '-16±1' })
  t.ok(fixed.pass, `the fix fixes it: ${fixed.rules[0].value.toFixed(2)} LUFS`)
  // peak in dB, as the CLI prints it: the sample peak, 20·log10 of the largest |sample|
  let x = (await a.read())[0], pk = db(x.reduce((m, v) => Math.max(m, Math.abs(v)), 0)), p = rule(await a.check({ peak: '..-3' }), 'peak')
  t.is([+p.value.toFixed(6), p.unit, p.pass], [+pk.toFixed(6), 'dB', true], `peak ${pk.toFixed(2)} dB, within ..-3 dB`)
  // a true peak over its limit: normalize() to the loudness it has, its ceiling the limit
  let L = await a.stat('loudness'), tp = rule(await a.check({ truepeak: '..-30' }), 'truepeak')
  t.is([tp.pass, tp.hint], [false, `normalize(${Math.round(10 * L) / 10}, 'lufs', { ceiling: -30 })`], tp.hint)
  t.ok((await new Function('a', `return a.${tp.hint}`)(a.clone()).check({ truepeak: '..-30' })).pass, 'the fix fixes it')
  for (let [bad, why] of [[{ loudness: '..' }, /a limit is/], [{ loudness: '-15..-17' }, /a limit is/], [{ loudness: 'loud' }, /a limit is/], [{}, /no limits/], [{ silence: 1 }, /not a number/], [{ nope: 1 }, /Unknown stat/]])
    t.ok(await a.check(bad).then(() => false, e => why.test(e.message)), `${JSON.stringify(bad)} throws`)
})

test('cli: check takes limits by name:value; a fix after each fail; a recommended rule says so and fails, exit 1; a batch the same; a spec and limits both is an error', SLOW, async t => {
  let r = run(lena, 'check', 'loudness:-17..-15', 'truepeak:..-1', 'sampleRate:44100')
  t.is(r.status, 1, 'a fail exits 1')
  t.ok(/✗ loudness\s+-17\.22 LUFS\s+-17 to -15\s+→ normalize\(-16, 'lufs'\)/.test(r.stdout) && /✓ sampleRate\s+44100 Hz\s+= 44100/.test(r.stdout) && !/Apple/.test(r.stdout), r.stdout)
  t.is(run(lena, 'normalize', '-16', 'lufs', 'check', 'loudness:-16±1').status, 0, 'a pass exits 0')
  // Apple recommends its loudness: lena, -17.22 LUFS, misses it and fails, exit 1; the word on each line of the spec
  let p = run(lena, 'check', 'podcast')
  t.is(p.status, 1, 'a recommended rule missed exits 1')
  t.ok(/✗ Loudness\s+-17\.22 LUFS\s+-17 to -15 recommended\s+→ normalize\('podcast'\)/.test(p.stdout) && /✓ True peak\s+-4\.06 dBTP\s+≤ -1 recommended\n/.test(p.stdout) && /\n {2}1 of 2 failed$/m.test(p.stdout), p.stdout)
  let j = JSON.parse(run(lena, 'check', 'podcast', '--json').stdout)
  t.is([j.pass, 'advice' in j, rule(j, 'Loudness').pass, rule(j, 'Loudness').required, rule(j, 'Loudness').hint], [false, false, false, false, "normalize('podcast')"], 'JSON: the rule missed, required false, the check failed')
  t.is(run(lena, 'normalize', 'podcast', 'check', 'podcast').status, 0, 'met, exit 0')
  // a batch: each file's line names the rule it missed, the word with it; the files failed counted; exit 1
  run(lena, 'save', tmp('ep-1.wav'), '-f'); run(lena, 'gain', '-1db', 'save', tmp('ep-2.wav'), '-f')
  let book = run(join(dir, 'ep-*.wav'), 'check', 'podcast'), files = book.stdout.split('\n').filter(l => /ep-\d\.wav/.test(l))
  t.ok(book.status === 1 && files.length === 2 && files.every(l => /^ {2}✗ .*ep-\d\.wav {2}Loudness -1\d\.\d\d LUFS \(-17 to -15 recommended\)$/.test(l)) && /Apple Podcasts: 2 of 2 files failed/.test(book.stdout), book.stdout)
  let met = run(join(dir, 'ep-*.wav'), 'normalize', 'podcast', 'check', 'podcast')
  t.ok(met.status === 0 && /Apple Podcasts: all 2 files pass/.test(met.stdout), met.stdout)
  let both = run(lena, 'check', 'podcast', 'loudness:-17..-15')
  t.ok(both.status === 1 && /not both/.test(both.stderr), both.stderr)
  t.is(parseArgs(['in.wav', 'check', 'loudness:-17..-15', 'truepeak:..-1']).sink.opts, { loudness: '-17..-15', truepeak: '..-1' }, 'a limit is kept as written, not read as a time range')
})

// ── compare ─────────────────────────────────────────────────────────────

/** The lines, in order: each the string, or matching the pattern */
function lines(t, r, want) {
  t.is(r.changes.length, want.length, r.changes.join('; '))
  want.forEach((w, i) => t.ok(typeof w === 'string' ? r.changes[i] === w : w.test(r.changes[i] ?? ''), `${r.changes[i]} ~ ${w}`))
}
const row = (r, name) => r.measures.find(m => m.name === name)
const V8 = voice.subarray(0, 8 * 44100), mono = x => from(x, 44100)
const late = (x, n) => { let y = new Float32Array(x.length); y.set(x.subarray(0, x.length - n), n); return y }
const f2 = v => Number.isFinite(v) ? v.toFixed(2) : v < 0 ? '-∞' : '+∞'
// a measure's line: its name, its two values, its unit
const moved = (r, name, label = name, unit = row(r, name).unit) => `${label} ${f2(row(r, name).before)} → ${f2(row(r, name).after)} ${unit}`
/** What is left of y once x at its least-squares gain g is taken away, over g·x, dB: the definition, sample by sample */
function left(x, y) {
  let xx = 0, xy = 0
  for (let i = 0; i < x.length; i++) { xx += x[i] * x[i]; xy += x[i] * y[i] }
  let g = xy / xx, e = 0
  for (let i = 0; i < x.length; i++) e += (y[i] - g * x[i]) ** 2
  return { gain: db(Math.abs(g)), difference: db10(e / (g * g * xx)) }
}
/** x delayed by d samples (any real d) through a windowed sinc (Blackman, 1025 taps), zeros before the start */
function delayed(x, d, H = 512) {
  let n = Math.floor(d), f = d - n, y = new Float32Array(x.length), h = new Float64Array(2 * H + 1)
  for (let k = -H; k <= H; k++) { let u = k - f, w = 0.42 + 0.5 * Math.cos(Math.PI * u / (H + 1)) + 0.08 * Math.cos(2 * Math.PI * u / (H + 1)); h[k + H] = (u === 0 ? 1 : Math.sin(Math.PI * u) / (Math.PI * u)) * w }
  for (let i = 0; i < x.length; i++) { let s = 0; for (let k = -H; k <= H; k++) { let j = i - n - k; if (j >= 0 && j < x.length) s += x[j] * h[k + H] } y[i] = s }
  return y
}
// RBJ Audio EQ Cookbook (R. Bristow-Johnson) high- and low-pass at Q 1/√2, a 2nd-order Butterworth, filtered here
function rbj(x, type, f0, sr = 44100) {
  let w = 2 * Math.PI * f0 / sr, c = Math.cos(w), al = Math.sin(w) / (2 * Math.SQRT1_2), a0 = 1 + al
  let b = type === 'low' ? [(1 - c) / 2, 1 - c, (1 - c) / 2] : [(1 + c) / 2, -(1 + c), (1 + c) / 2], a1 = -2 * c / a0, a2 = (1 - al) / a0
  let y = new Float64Array(x.length), x1 = 0, x2 = 0, y1 = 0, y2 = 0
  for (let i = 0; i < x.length; i++) { let v = (b[0] * x[i] + b[1] * x1 + b[2] * x2) / a0 - a1 * y1 - a2 * y2; x2 = x1; x1 = x[i]; y2 = y1; y1 = v; y[i] = v }
  return y
}
/** The voice figures from their definition: @audio/vad's voiced frames of x (10 s at a time), each frame's level in
 *  300 to 3400 Hz (both filtered here, rbj) in y against x, dB; the 10th, 50th, 90th percentiles by nearest rank; the
 *  shares 10 dB or more under and over the median; silenced: a frame 10 dB or more over x's noise floor (the library's
 *  stat) in x, under it moved by the loudness change in y, or zero */
async function voiced(x, y, sr = 44100) {
  let band = z => rbj(rbj(z, 'high', 300, sr), 'low', 3400, sr), xb = band(x), yb = band(y), W = 10 * sr, c = [], silent = 0
  let floor = await from(x, sr).stat('noisefloor'), shift = await from(y, sr).stat('loudness') - await from(x, sr).stat('loudness')
  if (!Number.isFinite(shift)) shift = 0
  for (let o = 0; o < x.length; o += W) {
    let v = vad(Float32Array.from(x.subarray(o, o + W)), { fs: sr }), n = Math.min(W, x.length - o)
    let e = (z, f) => { let s = 0; for (let i = f; i < Math.min(n, f + v.frameSize); i++) s += z[o + i] ** 2; return s }
    for (let k = 0; k < v.voiced.length; k++) if (v.voiced[k]) {
      let f = k * v.hop, len = Math.min(n, f + v.frameSize) - f, ey = e(yb, f), ex = e(xb, f)
      c.push(db10(ey) - db10(ex))
      if (!(ey > 0) || db10(ey / len) < floor + shift && db10(ex / len) >= floor + 10) silent++
    }
  }
  let s = Float64Array.from(c).sort(), at = p => s[Math.ceil(p * s.length) - 1], p50 = at(0.5), share = f => c.filter(f).length / c.length
  return { frames: c.length, change: { p10: at(0.1), p50, p90: at(0.9) }, under: share(v => v < p50 && v <= p50 - 10), over: share(v => v > p50 && v >= p50 + 10), silenced: silent / c.length }
}
/** compare's voice figures against the definition's, to 1e-6 dB and one frame in the shares */
function figures(t, got, want, name) {
  t.is(got.frames, want.frames, `${name}: ${want.frames} voiced frames`)
  for (let p of ['p10', 'p50', 'p90']) t.ok(got.change[p] === want.change[p] || Math.abs(got.change[p] - want.change[p]) < 1e-6, `${name}: ${p} ${got.change[p]}, ${want.change[p]} here`)
  for (let k of ['under', 'over', 'silenced']) t.ok(Math.abs(got[k] - want[k]) <= 1 / want.frames, `${name}: ${k} ${got[k]}, ${want[k]} here`)
}
const pc = v => (v * 100).toFixed(1)
// the voice line, from the figures
const said = (v, floor) => `voice band of ${v.frames} voiced frames: median change ${f2(v.change.p50)} dB, 10th ${f2(v.change.p10)}, 90th ${f2(v.change.p90)}${[['10 dB or more under the median', v.under], ['10 dB or more over it', v.over], [`from 10 dB over before's noise floor (${f2(floor)} dB) to under it, moved by the loudness change, or to zero`, v.silenced]].filter(([, s]) => s > 0).map(([k, s]) => `; ${pc(s)} % ${k}`).join('')}`
const none = '; no gain, polarity, difference or voice read'
// the lag line where the lag is 0, read over the whole of a sound of d s
const at0 = d => `lag 0, read from 0.00 s to ${d.toFixed(2)} s`

test('compare: the same sound, a lossless save of it, an edit rendered twice: nothing changed', SLOW, async t => {
  let a = mono(V8), r = await a.clone().compare(a)
  t.is([r.lag, r.why, r.gain, r.difference, r.polarity, r.swapped, r.changes], [0, null, 0, -Infinity, [1], false, [at0(8)]])
  t.is([r.voice.change, r.voice.under, r.voice.over, r.voice.silenced], [{ p10: 0, p50: 0, p90: 0 }, 0, 0, 0], 'no voiced frame moved')
  t.is(r.readings.map(x => [x.at, x.lag, x.channel]), [0, 2, 4, 6].map(s => [s, 0, 0]), 'four spans of 2 s, each at lag 0')
  t.is((await a.compare(a)).changes, [at0(8)], 'itself, unedited')
  await audio(lena).save(tmp('copy.wav'))
  t.is((await (await audio(tmp('copy.wav'))).compare(await audio(lena))).changes, [at0(voice.length / 44100)], 'a save and load')
  t.is((await mono(V8).eq(1000, -6, 1).compare(mono(V8).eq(1000, -6, 1))).changes, [at0(8)], 'one edit, twice')
})

test('compare: a gain: each measure and the voice band move by it; a line for each past its resolution', SLOW, async t => {
  let a = mono(V8), d = db(0.5), r = await mono(scale(V8, 0.5)).compare(a)
  for (let m of ['loudness', 'truepeak', 'noisefloor']) t.almost(row(r, m).delta, d, 0.01, `${m} ${row(r, m).delta.toFixed(3)}`)
  t.almost(r.gain, d, 1e-4, 'the gain')
  for (let p of ['p10', 'p50', 'p90']) t.almost(r.voice.change[p], d, 1e-4, `the voice band's ${p}`)
  t.is([r.voice.under, r.voice.over, r.voice.silenced], [0, 0, 0], 'a gain on everything moves no share')
  lines(t, r, [at0(8), moved(r, 'loudness'), moved(r, 'truepeak', 'true peak'), moved(r, 'noisefloor', 'noise floor'), said(r.voice)])
  // loudness 1 LU, true peak 1 dB, noise floor 3 dB, the voice band 1 dB: just under each, just over
  lines(t, await mono(scale(V8, gainOf(-0.99))).compare(a), [at0(8)])
  let q = await mono(scale(V8, gainOf(-1.01))).compare(a)
  lines(t, q, [at0(8), moved(q, 'loudness'), moved(q, 'truepeak', 'true peak'), said(q.voice)])
  q = await mono(scale(V8, gainOf(-2.99))).compare(a)
  lines(t, q, [at0(8), moved(q, 'loudness'), moved(q, 'truepeak', 'true peak'), said(q.voice)])
  q = await mono(scale(V8, gainOf(-3.01))).compare(a)
  lines(t, q, [at0(8), moved(q, 'loudness'), moved(q, 'truepeak', 'true peak'), moved(q, 'noisefloor', 'noise floor'), said(q.voice)])
})

test('compare: a latency of 1, 7, 480 and 4800 samples is that lag, read over the whole, and nothing else', SLOW, async t => {
  let a = mono(V8)
  for (let n of [1, 7, 480, 4800]) {
    let r = await mono(late(V8, n)).compare(a)
    t.is([r.lag, r.difference], [n / 44100, -Infinity], `${n}: the lag, to the sample; aligned, nothing left`)
    t.is(row(r, 'noisefloor').delta, 0, 'the noise floor read on one grid')
    lines(t, r, [`lag ${(n / 44.1).toFixed(1)} ms (${n} sample${n > 1 ? 's' : ''}), read from 0.00 s to 8.00 s`])
  }
})

test('compare: a fractional delay (a windowed-sinc shift of 0.25 and 0.5 samples) is a lag to 0.01 of a sample', SLOW, async t => {
  for (let d of [0.25, 0.5]) {
    let r = await mono(delayed(V8, d)).compare(mono(V8))
    t.almost(r.lag * 44100, d, 0.01, `${(r.lag * 44100).toFixed(4)} samples`)
    t.ok(r.difference < -60, `shifted between samples, what is left: ${r.difference.toFixed(1)} dB`)
    lines(t, r, [`lag 0.0 ms (${d.toFixed(2)} samples), read from 0.00 s to 8.00 s`])
  }
  let r = await mono(delayed(V8, 0.02)).compare(mono(V8))
  t.almost(r.lag * 44100, 0.02, 0.01, `0.02 samples: ${(r.lag * 44100).toFixed(4)}`)
})

test('compare: polarity, mono and stereo, one channel and both: each channel\'s sign, and what it does to the stereo measures', SLOW, async t => {
  let x = V8, R = new Float32Array(x.length), neg = v => -v
  R.set(scale(x.subarray(0, x.length - 2205), 0.8), 2205)
  lines(t, await mono(x.map(neg)).compare(mono(x)), [at0(8), 'polarity -1'])
  lines(t, await from([x.map(neg), x.map(neg)], 44100).compare(from([x, x], 44100)), [at0(8), 'polarity -1, -1 (left, right)'])
  // one of two equal channels turned: side and mid trade places (width -∞ → +∞ dB), the correlation 1 → -1
  let one = await from([x, x.map(neg)], 44100).compare(from([x, x], 44100))
  t.is([one.polarity, one.difference, one.voice.change.p50], [[1, -1], -Infinity, 0], 'each channel its sign; nothing left; the voice band as before')
  lines(t, one, [at0(8), 'polarity 1, -1 (left, right)', 'width (side over mid) -∞ → +∞ dB', 'L/R correlation 1.00 → -1.00'])
  // two unlike channels, the right turned: the correlation and width as counted here, said past 0.2 and 3 dB
  let corr = (l, r) => { let p = 0, q = 0, s = 0; for (let i = 0; i < l.length; i++) { p += l[i] * r[i]; q += l[i] * l[i]; s += r[i] * r[i] } return p / Math.sqrt(q * s) }
  let wid = (l, r) => { let s = 0, m = 0; for (let i = 0; i < l.length; i++) { s += (l[i] - r[i]) ** 2; m += (l[i] + r[i]) ** 2 } return 10 * Math.log10(s / m) }
  let p = await from([x, R.map(neg)], 44100).compare(from([x, R], 44100)), Rn = R.map(neg)
  t.almost(row(p, 'correlation').after, corr(x, Rn), 1e-6, 'the correlation, counted')
  lines(t, p, [at0(8), 'polarity 1, -1 (left, right)', ...Math.abs(wid(x, Rn) - wid(x, R)) > 3 ? [moved(p, 'width', 'width (side over mid)')] : [], ...Math.abs(corr(x, Rn) - corr(x, R)) > 0.2 ? [`L/R correlation ${corr(x, R).toFixed(2)} → ${corr(x, Rn).toFixed(2)}`] : []])
  // a channel turned whose reference is under half its energy (ρ² < 1/2, ρ counted here): its sign is no polarity
  let N2 = gauss(x.length, 24), k2 = Math.sqrt(ms(x) / ms(N2))
  for (let [c, turned] of [[0.6, false], [0.8, true]]) {
    let R2 = x.map((v, i) => -(c * v + Math.sqrt(1 - c * c) * k2 * N2[i])), xy = 0, yy = 0
    for (let i = 0; i < x.length; i++) { xy += x[i] * R2[i]; yy += R2[i] * R2[i] }
    let rho = xy / Math.sqrt(ms(x) * x.length * yy), q = await from([x, R2], 44100).compare(from([x, x], 44100))
    t.is([rho ** 2 > 0.5, q.polarity], [turned, [1, turned ? -1 : 1]], `the right channel at ρ ${rho.toFixed(3)}: ${turned ? 'turned' : 'not turned'}`)
  }
  let q = await mono(scale(x, -gainOf(-3.5))).compare(mono(x))
  t.almost(q.gain, -3.5, 1e-4, 'its gain, the sign taken off')
  lines(t, q, [at0(8), 'polarity -1', moved(q, 'loudness'), moved(q, 'truepeak', 'true peak'), moved(q, 'noisefloor', 'noise floor'), said(q.voice)])
})

test('compare: left and right swapped, read crossed; a correlation near 0 is no change; one that moves is', SLOW, async t => {
  let L = V8, R = new Float32Array(L.length), N = scale(gauss(L.length, 5), 0.05)
  R.set(scale(L.subarray(0, L.length - 2205), 0.8), 2205)
  let s = await from([R, L], 44100).compare(from([L, R], 44100))
  t.is([s.swapped, s.lag, s.difference], [true, 0, -Infinity])
  lines(t, s, [at0(8), 'left and right read crossed: the crossed pairs\' correlation peaks hold more than the straight pairs\''])
  // two channels that share nothing: their correlation's sign is noise
  lines(t, await from([L, N.map(v => -v)], 44100).compare(from([L, N], 44100)), [at0(8), 'polarity 1, -1 (left, right)'])
  let c = await from([L, N], 44100).compare(from([L, L], 44100)), k = row(c, 'correlation')
  t.ok(Math.abs(k.before - 1) < 1e-9 && Math.abs(k.after) < 0.05, `correlation ${k.before} → ${k.after.toFixed(3)}`)
  t.ok(c.changes.includes(`L/R correlation 1.00 → ${k.after.toFixed(2)}`), c.changes.join('; '))
})

// A filter on white noise: an octave falls by |H|² averaged over it (noise's power is flat); for Butterworth sections
// through the bilinear transform (fn/filter.js), |H(f)|² = 1 / (1 + (tan(πf/fs) / tan(πfc/fs))^(±2n))
test('compare: a filter is the band change it is: each octave by |H|², its group delay a lag under 1 ms', SLOW, async t => {
  let sr = 44100, x = scale(gauss(10 * sr, 5), 0.1), G = 10 ** 0.3
  let butter = (f, fc, n, hp) => { let r = Math.tan(Math.PI * f / sr) / Math.tan(Math.PI * fc / sr); return 1 / (1 + r ** (hp ? -2 * n : 2 * n)) }
  for (let [name, op, fc, n, hp] of [['lowpass 3 kHz, 4th order', a => a.lowpass(3000, 4), 3000, 4, false], ['highpass 100 Hz, 2nd order', a => a.highpass(100), 100, 2, true]]) {
    let r = await op(from(x, sr)).compare(from(x, sr)), top = Math.max(...r.measures.filter(m => m.name.endsWith('octave')).map(m => m.before))
    // octaves from 63 Hz: under it a 10 s Welch spectrum holds four bins an octave, too few for a slope's mean
    for (let m of r.measures.filter(m => m.name.endsWith('octave') && m.name !== '31.5 Hz octave' && m.after > top - 60)) {
      let f = 1000 * G ** (['31.5 Hz', '63 Hz', '125 Hz', '250 Hz', '500 Hz', '1 kHz', '2 kHz', '4 kHz', '8 kHz', '16 kHz'].indexOf(m.name.replace(' octave', '')) - 5), s = 0, k = 0
      for (let v = f / Math.sqrt(G); v < Math.min(f * Math.sqrt(G), sr / 2); v += 0.5) { s += butter(v, fc, n, hp); k++ }
      t.almost(m.delta, db10(s / k), 0.3, `${name}: the ${m.name} ${m.delta.toFixed(2)} dB, |H|² ${db10(s / k).toFixed(2)}`)
    }
    t.ok(r.lag != null && Math.abs(r.lag) < 0.001, `${name}: lag ${(r.lag * sr).toFixed(2)} samples`)
  }
})

// RBJ Audio EQ Cookbook (R. Bristow-Johnson; W3C Audio EQ Cookbook) peakingEQ: a 12 dB cut at 1 kHz, Q 4, on white
// noise: that octave falls by |H|² averaged over it; the least-squares gain is the impulse response's first tap, b0,
// and what is left is the rest of it, Σk≥1 h[k]² over b0²
test('compare: a band cut by a known filter: that octave, by |H|² over it; what is left, by the impulse response', SLOW, async t => {
  let sr = 44100, A = 10 ** (-12 / 40), w0 = 2 * Math.PI * 1000 / sr, al = Math.sin(w0) / 8, c = Math.cos(w0), a0 = 1 + al / A
  let [b0, b1, b2, a1, a2] = [(1 + al * A) / a0, -2 * c / a0, (1 - al * A) / a0, -2 * c / a0, (1 - al / A) / a0]
  let biquad = x => { let y = new Float32Array(x.length), x1 = 0, x2 = 0, y1 = 0, y2 = 0; for (let i = 0; i < x.length; i++) { let v = b0 * x[i] + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2; x2 = x1; x1 = x[i]; y2 = y1; y1 = v; y[i] = v } return y }
  let H2 = f => response([[b0, b1, b2], [1, a1, a2]], f, sr), octave = f => { let G = 10 ** 0.3, s = 0, n = 0; for (let v = f / Math.sqrt(G); v < f * Math.sqrt(G); v += 0.25) { s += H2(v); n++ } return 10 * Math.log10(s / n) }
  let h = biquad(Float32Array.from({ length: sr }, (_, i) => +(i === 0))), tail = h.slice(1).reduce((s, v) => s + v * v, 0)
  let x = scale(gauss(10 * sr, 5), 0.1), r = await from(biquad(x), sr).compare(from(x, sr)), o = row(r, '1 kHz octave')
  t.almost(o.delta, octave(1000), 0.3, `1 kHz octave ${o.delta.toFixed(2)} dB, |H|² over it ${octave(1000).toFixed(2)}`)
  t.almost(r.gain, db(b0), 0.05, `gain ${r.gain.toFixed(3)} dB, b0 ${db(b0).toFixed(3)}`)
  t.almost(r.difference, 10 * Math.log10(tail / b0 ** 2), 0.3, `difference ${r.difference.toFixed(2)} dB`)
  t.ok(r.changes.includes(`difference ${f2(r.difference)} dB at the lag and gain`) && r.changes.some(l => l.startsWith(`${moved(r, '1 kHz octave')}, `)), r.changes.join('; '))
  t.is(r.voice, null, 'noise holds no voice')
})

test('compare: noise added: what is left at its level, said within 60 dB of the program, unsaid past it', SLOW, async t => {
  let x = V8, n = gauss(x.length, 7), k = Math.sqrt(ms(x) / ms(n))
  for (let [L, said] of [[-40, true], [-59.9, true], [-60.1, false]]) {
    let y = x.map((v, i) => v + k * gainOf(L) * n[i]), want = left(x, y), r = await mono(y).compare(mono(x))
    t.almost(r.difference, want.difference, 0.01, `${L} dB: ${r.difference.toFixed(3)} dB, ${want.difference.toFixed(3)} on the samples`)
    t.is(r.changes.some(c => c.startsWith('difference ')), said, r.changes.join('; '))
  }
})

test('compare: octaves: each band\'s edges as IEC 61260-1 puts them; one within 60 dB of the loudest weighed, past it not', SLOW, async t => {
  // a tone just inside each edge of the 1 kHz octave (707.9 to 1412.5 Hz) and just outside: its whole power in its band
  let sr = 44100, A = 0.1, want = db10(A * A / 2)
  for (let [f, band] of [[690, '500 Hz'], [720, '1 kHz'], [1400, '1 kHz'], [1430, '2 kHz']]) {
    let r = await from(sine(f, 4, A, sr), sr).compare(from(sine(f, 4, A, sr), sr))
    t.almost(row(r, `${band} octave`).after, want, 0.05, `${f} Hz in the ${band} octave: ${row(r, `${band} octave`).after.toFixed(3)} dB`)
  }
  // a 12 kHz tone 50 dB under the voice's loudest octave, then 6 dB up: its octave rises past 3 dB, said
  let top = Math.max(...(await mono(V8).compare(mono(V8))).measures.filter(m => m.name.endsWith('octave')).map(m => m.after))
  let tone = g => V8.map((v, i) => v + g * Math.sin(2 * Math.PI * 12000 * i / sr)), g0 = Math.sqrt(2 * 10 ** ((top - 50) / 10))
  let r = await mono(tone(2 * g0)).compare(mono(tone(g0)))
  t.ok(row(r, '16 kHz octave').before > top - 60 && r.changes.some(c => c.startsWith(`${moved(r, '16 kHz octave')}, `)), `${row(r, '16 kHz octave').before.toFixed(1)} dB, ${top.toFixed(1)} the loudest: ${r.changes.join('; ')}`)
  // an octave whose louder side stands 63 dB under the loudest is not weighed: a 15 kHz tone 68 then 63 dB under it,
  // over a voice with nothing past 8 kHz (zero-phase, rbj, four times)
  let calm = V8; for (let i = 0; i < 2; i++) calm = Float32Array.from(rbj(Float32Array.from(rbj(calm, 'low', 8000)).reverse(), 'low', 8000).reverse())
  let peakOct = Math.max(...(await mono(calm).compare(mono(calm))).measures.filter(m => m.name.endsWith('octave')).map(m => m.after))
  let hi = g => calm.map((v, i) => v + g * Math.sin(2 * Math.PI * 15000 * i / sr)), h0 = Math.sqrt(2 * 10 ** ((peakOct - 68) / 10))
  let far = await mono(hi(h0 * gainOf(5))).compare(mono(hi(h0))), o16 = row(far, '16 kHz octave')
  t.ok(o16.delta > 4 && o16.after < peakOct - 60 && o16.after > peakOct - 70 && !far.changes.some(c => c.includes('octave')), `the 16 kHz octave ${o16.before.toFixed(1)} → ${o16.after.toFixed(1)} dB, the loudest ${peakOct.toFixed(1)}: ${far.changes.join('; ')}`)
  // white noise through a one-pole low-pass at 100 Hz, each octave falling more than the one under it: an even count
  // held (ten), their median the mean of the two middle changes, each octave said against it
  let w = gauss(4 * sr, 43), lp = Float32Array.from(w), k = 1 - Math.exp(-2 * Math.PI * 100 / sr)
  for (let i = 1; i < lp.length; i++) lp[i] = lp[i - 1] + k * (w[i] - lp[i - 1])
  let q = await from(lp, sr).compare(from(w, sr)), oct = q.measures.filter(m => m.name.endsWith(' octave')), loudest = Math.max(...oct.flatMap(m => [m.before, m.after]))
  let o = oct.filter(m => Math.max(m.before, m.after) >= loudest - 60).map(m => m.delta).sort((p, s) => p - s), med = (o[(o.length - 1) >> 1] + o[o.length >> 1]) / 2
  t.ok(o.length % 2 === 0 && o[(o.length - 1) >> 1] - o[o.length >> 1] < -1, `${o.length} octaves held, the middle two ${o[(o.length - 1) >> 1].toFixed(2)} and ${o[o.length >> 1].toFixed(2)} dB`)
  t.is(q.changes.filter(c => c.includes(' octave ')), oct.filter(m => Math.max(m.before, m.after) >= loudest - 60 && Math.abs(m.delta - med) > 3).map(m => `${moved(q, m.name)}, ${f2(m.delta - med)} dB against the octaves' median change (${f2(med)} dB)`), `median ${med.toFixed(2)} dB`)
})

test('compare: clipped samples counted at 16-bit full scale in every channel; past full scale, apart', SLOW, async t => {
  let sr = 44100, x = gauss(6 * sr, 9), peak = x.reduce((m, v) => Math.max(m, Math.abs(v)), 0)
  x = scale(x, 0.97 / peak)
  let y = x.map(v => Math.max(-1, Math.min(1, v * 1.05))), full = (32767 / 32768) ** 2
  y[1000] = 32767 / 32768
  let clipped = y.filter(v => v * v >= full).length
  let r = await from([x, y], sr).compare(from([x, x], sr))
  t.ok(clipped > 0, `${clipped} samples at full scale`)
  t.is(row(r, 'clipping').after, clipped, 'the second channel\'s, counted')
  t.ok(r.changes.includes(`clipped samples 0 → ${clipped}`), r.changes.join('; '))
  // a float sound past full scale, held at it: the samples past it gone
  let over = scale(x, 1.5), held = over.map(v => Math.max(-1, Math.min(1, v))), n = over.filter(v => Math.abs(v) > 1).length
  let h = await from(held, sr).compare(from(over, sr))
  t.is([row(h, 'over').before, row(h, 'over').after], [n, 0], `${n} past full scale before, none after`)
  t.ok(h.changes.includes(`samples past full scale ${n} → 0`), h.changes.join('; '))
})

test('compare: the voice band\'s figures as defined: percentiles and shares of the frames\' change, a gain moving no share', SLOW, async t => {
  let sr = 44100, x = voice, v = vad(Float32Array.from(x.subarray(0, 10 * sr)), { fs: sr })
  // a word's length silenced (0.3 s, 10 ms ramps): over 1 % of the frames, said; 40 ms: under it, unsaid
  for (let [len, shown] of [[0.3, true], [0.04, false]]) {
    let s0 = 3 * sr, s1 = s0 + Math.round(len * sr), ramp = Math.round(0.01 * sr)
    let m = i => i < s0 - ramp || i >= s1 + ramp ? 1 : i < s0 ? 0.5 + 0.5 * Math.cos(Math.PI * (i - s0 + ramp) / ramp) : i < s1 ? 0 : 0.5 - 0.5 * Math.cos(Math.PI * (i - s1) / ramp)
    let y = x.map((v, i) => v * m(i)), want = await voiced(x, y), r = await mono(y).compare(mono(x))
    figures(t, r.voice, want, `${len} s silenced`)
    t.is(r.changes.includes(said(r.voice, row(r, 'noisefloor').before)), shown, r.changes.join('; '))
  }
  // runs of 8 voiced frames, spread: 60 % of them cut 12 dB, then the same lifted 6 dB; a quarter lifted 12 dB, then
  // 3.6 dB down; 5 % silenced, then 12 dB down; -12 dB on everything; muted
  let k = [...v.voiced.keys()].filter(i => v.voiced[i]), runs = []
  for (let i = 0; i < k.length; i += 8) runs.push(k.slice(i, i + 8))
  let mask = (pick, d) => { let g = new Float32Array(x.length).fill(1); for (let f of pick) for (let i = f * v.hop; i < (f + 1) * v.hop; i++) g[i] = d; return g }
  let cut = mask(runs.filter((_, i) => i % 5 < 3).flat(), gainOf(-12)), lift = mask(runs.filter((_, i) => i % 4 === 0).flat(), gainOf(12)), gone = mask(runs.filter((_, i) => i % 20 === 0).flat(), 0)
  for (let [name, m, post] of [['60 % cut 12 dB', cut, 1], ['60 % cut 12 dB, +6 dB', cut, gainOf(6)], ['a quarter lifted 12 dB', lift, 1], ['a quarter lifted 12 dB, -3.6 dB', lift, gainOf(-3.6)], ['5 % silenced, -12 dB', gone, gainOf(-12)], ['-12 dB', null, gainOf(-12)]]) {
    let y = x.map((s, i) => s * (m ? m[i] : 1) * post), want = await voiced(x, y), r = await mono(y).compare(mono(x))
    figures(t, r.voice, want, name)
    t.ok(r.changes.includes(said(r.voice, row(r, 'noisefloor').before)), r.changes.join('; '))
  }
  // `under` from 10 dB under the median (0 here, four fifths of the frames untouched): a fifth of the runs cut 10.5 dB,
  // the frames they hold whole counted; 9.5 dB, none
  for (let [d, counted] of [[10.5, true], [9.5, false]]) {
    let m = mask(runs.filter((_, i) => i % 5 === 0).flat(), gainOf(-d)), y = x.map((s, i) => s * m[i]), want = await voiced(x, y), r = await mono(y).compare(mono(x))
    figures(t, r.voice, want, `a fifth of the runs cut ${d} dB`)
    t.is([r.voice.change.p50, r.voice.under > 0.1], [0, counted], `a fifth cut ${d} dB: under ${pc(r.voice.under)} %`)
  }
  // -12 dB on everything: every frame -12, no share; a quarter lifted: over, none under; 5 % silenced under a gain: the
  // silenced share as many as the frames zeroed, give or take the frames the runs' edges cut into
  let g12 = await mono(scale(x, gainOf(-12))).compare(mono(x))
  t.ok([g12.voice.change.p10, g12.voice.change.p90].every(p => Math.abs(p + 12) < 1e-6) && g12.voice.under + g12.voice.over + g12.voice.silenced === 0, JSON.stringify(g12.voice))
  let up = await mono(x.map((s, i) => s * lift[i])).compare(mono(x))
  t.ok(up.voice.over > 0.15 && up.voice.under === 0 && up.voice.silenced === 0, JSON.stringify(up.voice))
  let q = await mono(new Float32Array(V8.length)).compare(mono(V8))
  t.is([q.lag, q.gain, q.difference, q.voice.change.p50, q.voice.under, q.voice.over, q.voice.silenced], [0, null, Infinity, -Infinity, 0, 0, 1], 'muted: read at 0, no gain to silence, none of it left, every frame silenced, none under or over a median of -∞')
  t.is(q.changes[0], 'lag 0, not read: this sound holds no sound', 'muted: its lag taken, not read')
  // the figures need 1 s of voicing: a 3 s sound holding 1.6 s of it, and one holding 0.8 s (frames × hop, counted here)
  for (let [dur, measured] of [[2, true], [1.2, false]]) {
    let y = new Float32Array(3 * sr); y.set(x.subarray(0, dur * sr))
    let w = vad(Float32Array.from(y), { fs: sr }), sec = w.voiced.filter(Boolean).length * w.hop / sr, r = await mono(scale(y, 0.5)).compare(mono(y))
    t.ok(sec > 1 === measured && (r.voice !== null) === measured && r.lag === 0, `${sec.toFixed(2)} s voiced: ${measured ? 'measured' : 'null'} (${JSON.stringify(r.voice)})`)
  }
  // the band: a high-pass at 100 Hz moves the band's frames by under 1 dB, unsaid; a low-pass at 1 kHz takes most of
  // it. Each zero-phase (forward, then back, rbj): no group delay, so the frames are read at lag 0 as here
  let back = (z, type, f) => Float32Array.from(rbj(Float32Array.from(rbj(z, type, f)).reverse(), type, f).reverse())
  for (let [name, type, f, shown] of [['highpass 100 Hz', 'high', 100, false], ['lowpass 1 kHz', 'low', 1000, true]]) {
    let y = back(x, type, f), r = await mono(y).compare(mono(x)), want = await voiced(x, y)
    t.is(r.lag, 0, `${name}: zero-phase, lag 0`)
    figures(t, r.voice, want, name)
    t.is(r.changes.some(c => c.startsWith('voice band')), shown, `${name}: ${JSON.stringify(r.voice.change)}`)
  }
})

// silenced reads a frame against before's noise floor, its quietest 0.4 s: on a take with no pause that is quiet speech,
// so a frame zeroed that stood under 10 dB over it is not counted and the share undercounts what was zeroed (`under`
// holds it); with pauses of room tone the floor is the room's
test('compare: silenced, against before\'s floor: on a take with no pause, under the frames zeroed; with pauses of room tone, within a few points', SLOW, async t => {
  let sr = 44100, step = Math.round(1.5 * sr), gap = Math.round(0.4 * sr), room = scale(gauss(gap, 13), gainOf(-60)), W = 10 * sr
  let paused = new Float32Array(voice.length + Math.ceil(voice.length / step) * gap)
  for (let o = 0, at = 0; o < voice.length; o += step) { let s = voice.subarray(o, o + step); paused.set(s, at); paused.set(room, at + s.length); at += s.length + gap }
  // the share of x's voiced frames (10 s at a time, as compare reads them) whose every sample is zero in y
  let zeroed = (x, y) => {
    let n = 0, z = 0
    for (let o = 0; o < x.length; o += W) {
      let v = vad(Float32Array.from(x.subarray(o, o + W)), { fs: sr }), end = Math.min(x.length, o + W)
      for (let k = 0; k < v.voiced.length; k++) if (v.voiced[k]) { n++; if (y.subarray(o + k * v.hop, Math.min(end, o + k * v.hop + v.frameSize)).every(s => s === 0)) z++ }
    }
    return z / n
  }
  for (let [name, x, pauses] of [['no pause', voice, false], ['pauses of room tone at -60 dB', paused, true]]) {
    // a fifth of the runs of 8 voiced frames (@audio/vad over the whole) zeroed
    let v = vad(Float32Array.from(x), { fs: sr }), k = [...v.voiced.keys()].filter(i => v.voiced[i]), m = new Float32Array(x.length).fill(1)
    for (let i = 0; i < k.length; i += 40) for (let f of k.slice(i, i + 8)) m.fill(0, f * v.hop, Math.min(x.length, (f + 1) * v.hop))
    let y = x.map((s, i) => s * m[i]), r = await mono(y).compare(mono(x)), z = zeroed(x, y), { silenced, under } = r.voice
    t.ok(pauses ? Math.abs(silenced - z) < 0.03 : silenced < z - 0.04, `${name}: ${pc(z)} % of the voiced frames zeroed, ${pc(silenced)} % silenced, ${pc(under)} % under`)
    t.ok(Math.abs(under - z) < 0.03, `${name}: under ${pc(under)} %, zeroed ${pc(z)} %`)
  }
})

test('compare: one lag or none: a cut, an insert, a stretch read apart in their spans; a head cut, its lag read over where it holds', SLOW, async t => {
  let a = mono(voice), r = await a.clone().remove(5, 1).compare(a)
  t.is([r.lag, r.why, r.gain, r.difference, r.voice], [null, 'varies', null, null, null], 'nothing read sample by sample')
  t.is(r.readings.map(x => Math.round(x.lag * 44100)), [0, 0, -44100, -44100], 'two spans at 0, two a second earlier')
  lines(t, r, [`no lag: the readings differ by more than 0.25 ms: 0.0 ms (0 samples) from 0.00 s to 5.64 s; -1.000 s from 5.64 s to 11.27 s${none}`, 'length 12.272 → 11.272 s, 1.000 s shorter'])
  t.is((await a.clone().remove(2, 0.3).compare(a)).why, 'varies', 'a cut near the start')
  t.is((await a.clone().stretch(1.02).compare(a)).lag, null, 'a stretch')
  // 46 samples (1.04 ms) put in at 30 s of 61: the two halves apart by more than the 0.25 ms the readings may differ
  let x = new Float32Array(voice.length * 5); for (let i = 0; i < 5; i++) x.set(voice, i * voice.length)
  t.is((await mono(x).insert(46 / 44100, 30).compare(mono(x))).why, 'varies', '46 samples inside')
  // a cut of 0.1 s at 0.05 s: every span reads 100 ms earlier, the line says over what; the length and what is left say
  // the rest
  let c = await a.clone().remove(0.05, 0.1).compare(a)
  t.is(c.lag, -4410 / 44100, 'the lag every span reads')
  lines(t, c, ['lag -100.0 ms (-4410 samples), read from 0.00 s to 12.17 s', 'length 12.272 → 12.172 s, 100.0 ms (4410 samples) shorter', `difference ${f2(c.difference)} dB at the lag and gain`])
  let h = await a.clone().crop({ at: 7.27, duration: 5 }).compare(a)
  t.is([h.lag, h.difference], [-Math.round(7.27 * 44100) / 44100, -Infinity], 'the lag found at its end')
  lines(t, h, ['lag -7.270 s, read from 2.50 s to 5.00 s; no waveform shared with before from 0.00 s to 2.50 s', 'length 12.272 → 5.000 s, 7.272 s shorter', moved(h, 'truepeak', 'true peak')])
  // a span's reading is the lag its correlation peaks at, which a part of it need not share: 0.5 s cut at 0.5 s, the
  // first span (0 to 3.07 s) reads -500 ms with the rest, the line naming the stretch read. A lag of 0 names its
  // stretches too: 0.5 s cut at 25 s and 0.5 s put in at 35 s of 61 s, read at the ends (four spans of 10 s), the middle
  // not, what is left said over the whole; the first 3 s replaced by other voice, the first span shares no waveform
  let k = await a.clone().remove(0.5, 0.5).compare(a), n4 = Math.floor(voice.length / 4) / 44100, end = voice.length / 44100
  t.is([k.lag, k.changes[0], k.changes[1]], [-22050 / 44100, 'lag -500.0 ms (-22050 samples), read from 0.00 s to 11.77 s', 'length 12.272 → 11.772 s, 500.0 ms (22050 samples) shorter'])
  let mid = await mono(x).remove(25, 0.5).insert(0.5, 35).compare(mono(x)), len = x.length / 44100
  t.is([mid.lag, mid.changes[0]], [0, `lag 0, read from 0.00 s to 20.00 s, from ${(len - 20).toFixed(2)} s to ${len.toFixed(2)} s`])
  t.ok(mid.changes.includes(`difference ${f2(mid.difference)} dB at the lag and gain`), mid.changes.join('; '))
  let head = voice.slice(); head.set(voice.slice().reverse().subarray(0, 3 * 44100))
  let hd = await mono(head).compare(a)
  t.is([hd.lag, hd.readings.map(x => x.lag), hd.changes[0]], [0, [null, 0, 0, 0], `lag 0, read from ${n4.toFixed(2)} s to ${end.toFixed(2)} s; no waveform shared with before from 0.00 s to ${n4.toFixed(2)} s`])
  t.ok(hd.changes.includes(`difference ${f2(hd.difference)} dB at the lag and gain`), hd.changes.join('; '))
  let o = await mono(voice.slice().reverse()).compare(a)
  t.is([o.why, o.changes[0]], ['unrelated', `no lag: 0 of 4 spans share a waveform with before (a correlation of 0.2 or more within ±5 s)${none}`], 'another sound')
  // sped 2 %, its pitch with it: a span may share a waveform by chance, one alone is no lag
  let fast = await a.clone().speed(1.02).compare(a)
  t.ok(fast.lag === null && fast.why === 'unrelated', fast.changes.join('; '))
  // one span of four shares a waveform, its channels at lags apart: fewer than two spans, unrelated, before they differ
  let L = V8, R = late(V8, 2205), n2 = 2 * 44100, noise = [0, 1].map(c => gauss(V8.length, 50 + c)), lr = [L, late(R, 20)]
  let part = lr.map((x, c) => Float32Array.from(x, (v, i) => i < n2 ? v : 0.05 * noise[c][i]))
  let one = await from(part, 44100).compare(from([L, R], 44100))
  t.is([one.why, one.readings.filter(x => x.lag != null).map(x => [x.at, Math.round(x.lag * 44100)])], ['unrelated', [[0, 0], [0, 20]]], one.changes[0])
  // a voice in the first of four spans, digital silence after: the one span that holds sound in both is enough
  let quiet = new Float32Array(V8.length); quiet.set(V8.subarray(0, n2))
  t.is((await mono(late(quiet, 7)).compare(mono(quiet))).lag, 7 / 44100, 'one span of sound, read')
})

test('compare: a reference at another rate is read at this sound\'s; the rate itself a change; one sample more, said', SLOW, async t => {
  // the after through the library's sinc, the reference read at its rate through the same: nothing but the rate
  let x = voice.subarray(0, 5 * 44100), r = await mono(x).resample(48000, { type: 'sinc' }).compare(mono(x))
  t.is(r.lag, 0, 'read at the after\'s rate')
  lines(t, r, [at0(5), 'sample rate 44100 → 48000 Hz'])
  lines(t, await mono(x).compare(mono(x).resample(22050)), [at0(5), 'sample rate 22050 → 44100 Hz'])
  let y = new Float32Array(x.length + 1); y.set(x)
  lines(t, await mono(y).compare(mono(x)), [at0(5), 'length 5.000 → 5.000 s, 0.0 ms (1 sample) longer'])
  // of unlike channel counts, the downmixes read: one reading a span, of no channel
  let st = await from([x, x], 44100).compare(mono(x))
  t.is([st.lag, st.readings.map(r => r.channel)], [0, [null, null, null, null]], 'stereo against mono')
  lines(t, await mono(x).compare(mono(new Float32Array(x.length))), [`no lag: before holds no sound${none}`, moved(await mono(x).compare(mono(new Float32Array(x.length))), 'loudness'), moved(await mono(x).compare(mono(new Float32Array(x.length))), 'truepeak', 'true peak'), moved(await mono(x).compare(mono(new Float32Array(x.length))), 'noisefloor', 'noise floor')])
})

test('compare: refusals: what is not a sound, the sound itself edited, a sample not a number', async t => {
  let a = mono(V8.subarray(0, 44100)), nan = Float32Array.from(V8.subarray(0, 44100)); nan[22050] = NaN
  for (let [ref, why] of [[undefined, /is a sound/], [lena, /is a sound/], [V8, /is a sound/]]) t.ok(await a.compare(ref).then(() => false, e => why.test(e.message)), `${typeof ref} refused`)
  let c = a.clone(); c.gain(-6)
  t.ok(await c.compare(c).then(() => false, e => /clone it before editing/.test(e.message)), 'its own edits')
  t.ok(await mono(nan).compare(a).then(() => false, e => /this sound holds 1 sample not a finite number \(NaN or ±Infinity\), the first at 0\.500 s$/.test(e.message)), 'NaN, where')
  t.ok(await a.compare(mono(nan)).then(() => false, e => /the reference holds 1 sample/.test(e.message)), 'in the reference')
})

test('compare: channels read each against its own: within 0.25 ms of each other one lag, past it none, the readings said', SLOW, async t => {
  let L = V8, R = late(V8, 2205)
  for (let [l, r] of [[0, 20], [30, 60]]) {
    let c = await from([late(L, l), late(R, r)], 44100).compare(from([L, R], 44100)), say = n => `${(n / 44.1).toFixed(1)} ms (${n} samples)`
    t.is([c.lag, c.why, c.difference, c.voice], [null, 'varies', null, null], `L ${l}, R ${r}: no lag`)
    lines(t, c, [`no lag: the readings differ by more than 0.25 ms: left ${say(l)} from 0.00 s to 8.00 s; right ${say(r)} from 0.00 s to 8.00 s${none}`])
  }
  // 0.25 ms is 11.025 samples at 44.1 kHz: 10 apart, one lag; 12 apart, none
  for (let [n, one] of [[10, true], [12, false]]) {
    let c = await from([L, late(R, n)], 44100).compare(from([L, R], 44100))
    t.is([c.lag != null, c.readings.filter(x => x.channel === 1).every(x => Math.round(x.lag * 44100) === n)], [one, true], `R ${n} later: ${c.changes[0]}`)
    if (!one) continue
    // the one lag: the first span's two correlations, |c| summed, at their peak within 0.25 ms of the readings (counted
    // here over the span's 2 s), refined between samples
    let x = [L, late(R, n)], y = [L, R], N = 2 * 44100, sum = k => [0, 1].reduce((s, ch) => { let q = 0; for (let i = Math.max(0, k); i < Math.min(N, N + k); i++) q += x[ch][i] * y[ch][i - k]; return s + Math.abs(q) }, 0)
    let best = 0; for (let k = -11; k <= n + 11; k++) if (sum(k) > sum(best)) best = k
    // between samples, within half of one of the whole lag that peaks (a peak nearer another whole lag peaks there)
    t.ok(Math.abs(c.lag * 44100 - best) <= 0.5, `R ${n} later: lag ${(c.lag * 44100).toFixed(2)}, the summed peak at ${best}`)
  }
  // the right channel's second span (2 to 4 s) replaced by noise: the lag read where the others share one, that
  // channel's span said apart
  let R2 = R.slice(); R2.set(scale(gauss(2 * 44100, 52), 0.05), 2 * 44100)
  let apart = await from([L, R2], 44100).compare(from([L, R], 44100))
  t.is([apart.lag, apart.changes[0]], [0, 'lag 0, read from 0.00 s to 8.00 s; no waveform shared with before in the right channel from 2.00 s to 4.00 s'])
})

test('compare: a correlation that peaks again within 1 % of its top: no lag, the distance said', SLOW, async t => {
  // a 1 kHz tone repeats inverted every half period (22.05 samples at 44.1 kHz: the whole sample nearest); a sawtooth of
  // 441 samples every 441
  let sr = 44100, tone = sine(1000, 5, 0.3, sr), saw = Float32Array.from({ length: 5 * sr }, (_, i) => 0.3 * ((i % 441) / 441 - 0.5))
  let r = await mono(late(tone, 10)).compare(mono(tone))
  t.is([r.lag, r.why, r.period], [null, 'repeats', 22 / sr], 'a tone')
  lines(t, r, [`no lag: its correlation with before peaks again within 1.0 % of its top 0.5 ms (22 samples) from it, from 0.00 s to 1.25 s${none}`, moved(r, 'truepeak', 'true peak')])
  let w = await mono(late(saw, 451)).compare(mono(saw))
  t.is([w.lag, w.why, w.period], [null, 'repeats', 441 / sr], 'a sawtooth, 451 samples later')
  // a pulse of 20 samples every 1000, 2500 later: its peaks a period apart share fewer samples, read over what they share
  let pulse = Float32Array.from({ length: 5 * sr }, (_, i) => i % 1000 < 20 ? 0.5 : 0), u = await mono(late(pulse, 2500)).compare(mono(pulse))
  t.is([u.lag, u.why, u.period], [null, 'repeats', 1000 / sr], 'a pulse train')
  // 2 s of it, its pulses 2010 later throughout: in a span of 22050 samples, 22 pulses meet at its top (10), 21 a period
  // either side (over the whole span, 21/22 of the top; over what the two share there, 1)
  let p2 = pulse.subarray(0, 2 * sr), q2 = Float32Array.from(p2, (_, i) => (i + 1e6 - 2010) % 1000 < 20 ? 0.5 : 0), u2 = await mono(q2).compare(mono(p2))
  t.is([u2.lag, u2.why, u2.period], [null, 'repeats', 1000 / sr], 'a pulse train of 2 s, 2010 later')
  // a 441 Hz tone (100 samples a period) over noise, the copy 10 samples later: at its own lag the copy reads 1, a
  // period on (and inverted, half of one) the tone's share of the power, s = 1 / (1 + 10^(−snr/10)): over 0.99, no lag;
  // under it, the lag
  for (let [snr, repeats] of [[23, true], [17, false]]) {
    let n = gauss(5 * sr, 41), k = Math.sqrt(0.045 / ms(n)) * gainOf(-snr), x = Float32Array.from(n, (v, i) => 0.3 * Math.sin(2 * Math.PI * 441 * i / sr) + k * v), s = 1 / (1 + 10 ** (-snr / 10))
    let q = await mono(late(x, 10)).compare(mono(x))
    t.is([s > 0.99, q.why === 'repeats', q.lag], [repeats, repeats, repeats ? null : 10 / sr], `the tone ${s.toFixed(4)} of the power: ${q.changes[0]}`)
  }
  // a peak again counts past a dip under half of the top: a tone of 20 samples a period over a DC offset a, whose
  // correlation over what two copies share dips half a period on to (a² − ½) / (a² + ½) and peaks again a period on (both
  // counted here). At a² = 1.1, 0.375: a second peak, no lag; at a² = 2, 0.6: one broad peak, the lag (3 samples)
  for (let [a2, again] of [[1.1, true], [2, false]]) {
    let x = Float32Array.from({ length: 5 * sr }, (_, i) => 0.3 * (Math.sqrt(a2) + Math.sin(2 * Math.PI * i / 20)))
    let at = k => { let p = 0, e = 0, f = 0; for (let i = 0; i + k < x.length; i++) { p += x[i] * x[i + k]; e += x[i] * x[i]; f += x[i + k] * x[i + k] } return p / Math.sqrt(e * f) }
    t.ok(Math.abs(at(10) - (a2 - 0.5) / (a2 + 0.5)) < 1e-3 && at(20) > 0.99, `a² ${a2}: the dip ${at(10).toFixed(3)}, a period on ${at(20).toFixed(5)}`)
    let q = await mono(late(x, 3)).compare(mono(x))
    t.is([q.why, q.period, q.lag], again ? ['repeats', 20 / sr, null] : [null, null, 3 / sr], `a² ${a2}: ${q.changes[0]}`)
  }
})

test('compare: under 2 s no lag is read; a waveform shared at a correlation of 0.25, not at 0.17; within ±5 s, past it none', SLOW, async t => {
  for (let [dur, read] of [[1.99, false], [2, true]]) {
    let x = voice.slice(44100, 44100 + Math.round(dur * 44100)), r = await mono(late(x, 3)).compare(mono(x))
    t.is([r.lag, r.why], read ? [3 / 44100, null] : [null, 'short'], `${dur} s`)
    if (!read) t.is(r.changes[0], `no lag: ${dur.toFixed(3)} s, under the 2 s a lag is read over${none}`)
  }
  t.is((await mono(scale(gauss(100, 12), 0.1)).compare(mono(scale(gauss(100, 11), 0.1)))).why, 'short', '100 samples')
  // short by the shorter sound: 1.5 s against 12.27 s, either way round
  for (let [after, before] of [[voice.subarray(0, 1.5 * 44100), voice], [voice, voice.subarray(0, 1.5 * 44100)]]) {
    let r = await mono(after).compare(mono(before))
    t.is([r.lag, r.why, r.changes[0]], [null, 'short', `no lag: 1.500 s, under the 2 s a lag is read over${none}`], `${(after.length / 44100).toFixed(2)} s against ${(before.length / 44100).toFixed(2)} s`)
  }
  // ±5 s: 61 s of voice 4.9 s later, the same length (its ends don't meet): found; 5.1 s: not
  let x = new Float32Array(voice.length * 5); for (let i = 0; i < 5; i++) x.set(voice, i * voice.length)
  let far = await mono(late(x, Math.round(4.9 * 44100))).compare(mono(x)), n = Math.min(10 * 44100, Math.floor(x.length / 4))
  t.is(far.lag, Math.round(4.9 * 44100) / 44100, '4.9 s later')
  t.is(far.readings.map(r => [r.at, r.duration]), [0, n, x.length - 2 * n, x.length - n].map(i => [i / 44100, n / 44100]), 'four spans of 10 s at most, two at each end')
  t.is((await mono(late(x, Math.round(5.1 * 44100))).compare(mono(x))).why, 'unrelated', '5.1 s later')
  // a noise under another, k times its power: they correlate at √(1/(1+k)) (counted here on the samples)
  let n0 = scale(gauss(8 * 44100, 21), 0.05), n1 = gauss(8 * 44100, 22)
  for (let [rho, shared] of [[0.25, true], [0.17, false]]) {
    let k = 1 / rho ** 2 - 1, g = Math.sqrt(k * ms(n0) / ms(n1)), y = n0.map((v, i) => v + g * n1[i]), c = 0
    for (let i = 0; i < y.length; i++) c += y[i] * n0[i]
    let at = c / Math.sqrt(ms(y) * ms(n0)) / y.length, q = await mono(y).compare(mono(n0))
    t.almost(at, rho, 0.01, `correlation ${at.toFixed(3)}`)
    t.is(q.lag != null && Math.abs(q.lag * 44100) < 0.5, shared, `at ${rho}: lag ${q.lag}, ${q.changes[0]}`)
  }
})

test('compare: a true peak passing -1 dBTP is said under 1 dB; DC past 0.001; correlation past 0.2; width and LRA past 3 dB and 1 LU', SLOW, async t => {
  let a = mono(V8), tp0 = await a.stat('truepeak'), x = scale(V8, gainOf(-1.3 - tp0))
  // -1.3 dBTP lifted 0.5 dB: under 1 dB, said for the ceiling it passes (R 128 (m), normalize()'s)
  let c = await mono(scale(x, gainOf(0.5))).compare(mono(x))
  lines(t, c, [at0(8), `${moved(c, 'truepeak', 'true peak')}, over the -1 dBTP ceiling`])
  // DC: the channel's mean, past 0.001; of two channels the one furthest from 0
  let mean = y => y.reduce((p, v) => p + v, 0) / y.length
  for (let [dc, shown] of [[0.0015, true], [0.0009, false]]) {
    let y = V8.map(v => v + dc), want = `DC ${mean(V8).toFixed(4)} → ${mean(y).toFixed(4)}`
    t.is((await mono(y).compare(mono(V8))).changes.includes(want), shown, `mono, ${dc}: ${shown ? want : 'unsaid'}`)
    t.is((await from([V8, y], 44100).compare(from([V8, V8], 44100))).changes.includes(want), shown, `the right channel, ${dc}`)
  }
  // correlation: L and R = cos θ·L + sin θ·noise, read on the samples (Σlr / √(Σl²·Σr²)): a move of 0.22 said, 0.18 not
  let N = gauss(V8.length, 23), nn = Math.sqrt(ms(V8) / ms(N)), corr = (l, r) => { let p = 0, q = 0, s = 0; for (let i = 0; i < l.length; i++) { p += l[i] * r[i]; q += l[i] * l[i]; s += r[i] * r[i] } return p / Math.sqrt(q * s) }
  for (let [k, shown] of [[0.78, true], [0.82, false]]) {
    let R = V8.map((v, i) => k * v + Math.sqrt(1 - k * k) * nn * N[i]), q = await from([V8, R], 44100).compare(from([V8, V8], 44100))
    t.almost(row(q, 'correlation').after, corr(V8, R), 1e-6, `correlation ${corr(V8, R).toFixed(3)}`)
    t.is(q.changes.some(l => l.startsWith('L/R correlation 1.00 →')), shown, `a move of ${(1 - corr(V8, R)).toFixed(3)}: ${shown ? 'said' : 'unsaid'}`)
  }
  // width, side over mid, 10·log10(Σ(l − r)² / Σ(l + r)²): its side raised 3.3 dB said, 2.7 not
  let wid = (l, r) => { let s = 0, m = 0; for (let i = 0; i < l.length; i++) { s += (l[i] - r[i]) ** 2; m += (l[i] + r[i]) ** 2 } return 10 * Math.log10(s / m) }
  let side = scale(N, 0.3 * nn), st = d => [V8.map((v, i) => v + gainOf(d) * side[i]), V8.map((v, i) => v - gainOf(d) * side[i])]
  for (let [d, shown] of [[3.3, true], [2.7, false]]) {
    let [l, r] = st(d), [l0, r0] = st(0), w = await from([l, r], 44100).compare(from([l0, r0], 44100))
    t.almost(row(w, 'width').before, wid(l0, r0), 1e-6, `width before ${wid(l0, r0).toFixed(2)} dB`)
    t.almost(row(w, 'width').delta, wid(l, r) - wid(l0, r0), 1e-6, `width rose ${(wid(l, r) - wid(l0, r0)).toFixed(2)} dB`)
    t.is(w.changes.includes(moved(w, 'width', 'width (side over mid)')), shown, w.changes.join('; '))
  }
  // LRA (the library's stat, each sound alone): the take's second half 1 dB down moves it under 1 LU, 1.5 dB over
  let lra0 = await mono(voice).stat('lra'), moves = []
  for (let d of [-1, -1.5]) {
    let y = voice.map((v, i) => i >= voice.length / 2 ? v * gainOf(d) : v), dl = await mono(y).stat('lra') - lra0
    moves.push(Math.abs(dl))
    t.is((await mono(y).compare(mono(voice))).changes.some(l => l.startsWith('loudness range')), Math.abs(dl) > 1, `LRA moved ${dl.toFixed(2)} LU`)
  }
  t.ok(moves[0] < 1 && moves[1] > 1, `the two straddle 1 LU: ${moves.map(m => m.toFixed(2)).join(', ')}`)
})

// A lag between samples, read where the two spans share n − |t| samples: a 441 Hz tone over a DC offset (a mean square
// of 2 + ½ in units of the sine's) 10 samples late is 10 samples, not the 9.98 a count falling with the lag leans it to.
// A channel pair that shares nothing in the span read adds nothing to that peak: the right channel's first 2 s replaced
// by noise, the lag is 0 exactly. A third channel's repeating reading is named as "channel 3's"
test('compare: a lag between samples, over the samples shared; a pair that shares nothing left out; a third channel named', SLOW, async t => {
  let sr = 44100, n = 5 * sr, tone = Float32Array.from({ length: n }, (_, i) => 0.3 * (Math.SQRT2 + Math.sin(2 * Math.PI * 441 * i / sr)))
  let r = await mono(late(tone, 10)).compare(mono(tone))
  t.almost(r.lag * sr, 10, 0.01, `tone over DC, 10 late: ${(r.lag * sr).toFixed(4)} samples`)
  let R = V8.slice(), N = gauss(2 * sr, 11).map(v => 0.05 * v); R.set(N, 0)
  let z = await from([V8, R], sr).compare(from([V8, V8], sr))
  t.is(z.lag, 0, 'right 0 to 2 s replaced by noise: lag 0 exactly')
  t.ok(z.changes[0].startsWith('lag 0, read from'), z.changes[0])
  let pure = Float32Array.from(V8, (_, i) => 0.3 * Math.sin(2 * Math.PI * 441 * i / sr)), three = [V8, late(V8, 2205), pure]
  let q = await from(three, sr).compare(from(three.map(x => x.slice()), sr))
  t.ok(q.why === 'repeats' && q.changes[0].startsWith("no lag: channel 3's correlation with before peaks again"), q.changes[0])
})

test('cli: compare BEFORE prints the changes, --json every measure (±Infinity kept), exit 0; the rest of the chain is the after', SLOW, async t => {
  let r = run(lena, 'gain', '-6db', 'compare', lena)
  t.is(r.status, 0, 'a change is a report, not a failure')
  t.ok(r.stdout.includes(`against ${lena}: gain -6.00 dB`) && /· loudness -17\.22 → -23\.2\d LUFS/.test(r.stdout) && /· true peak -4\.06 → -10\.0\d dBTP/.test(r.stdout), r.stdout)
  let j = JSON.parse(run(lena, 'eq', '4khz', '-12db', '4', 'compare', lena, '--json').stdout)
  t.ok(j.measures.some(m => m.name === '4 kHz octave' && m.delta < -3) && j.changes.some(c => c.startsWith('4 kHz octave ')), JSON.stringify(j.changes))
  let same = JSON.parse(run(lena, 'compare', lena, '--json').stdout)
  t.is([same.difference, same.lag, same.why, same.changes], ['-Infinity', 0, null, [at0(voice.length / 44100)]], 'nothing left: "-Infinity", not null')
  t.ok(/no change past/.test(run(lena, 'compare', lena).stdout), 'the same file: no change')
  let none = run(lena, 'compare')
  t.ok(none.status === 1 && /against what/.test(none.stderr), none.stderr)
  t.is(parseArgs(['out.wav', 'compare', 'in.wav']).sink, { name: 'compare', args: ['in.wav'], opts: {} })
})
