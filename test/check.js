// Verify: check (a sound against a delivery spec, or limits of your own).
// Each spec's limits are written here from their sources (read 2026-11-18), apart from fn/check.js; each file is built
// to sit on a limit or one printed step (0.01) past it, the side it must fall on following from the source's number,
// its level known by construction: a 997 Hz sine's loudness through BS.1770's own K-weighting coefficients, a burst's
// true peak from its formula read between samples.
import test from 'tst'
import audio from '../audio.js'
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
