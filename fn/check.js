/**
 * Check against a delivery spec: each rule the spec states, its measured value, pass or fail.
 *
 * await a.check('acx') → { spec, name, url, pass, rules: [{ name, value, unit, min, max, pass, required, note, hint }] }
 * await a.check({ loudness: '-17..-15', truepeak: '..-1' }) → { pass, rules }: limits of your own, by the stats' names
 *
 * A rule passes when its value, rounded to 0.01 as printed, lies within [min, max]. A rule with
 * no limits reports what the spec describes without bounding it (pass: null) and never fails.
 * A rule missed fails the check, whether its source requires it ("must", "shall": `required`) or recommends it ("we
 * recommend", "should": `required: false`, which its printed line says). Limits of your own are required. A rule that
 * fails says what would fix it in the library's own words (`hint`: "normalize('podcast')"): a hint, never an edit made.
 *
 * A limit of your own is a number (exactly it), [min, max] (null an open end), or a string as the CLI writes a range,
 * either end open ('-17..-15', '..-1', '44100..'), or a value and its tolerance ('-16±1'); a value may carry its unit
 * (-1db, 44.1khz, 120m). It holds a stat whose value is a number (loudness, truepeak, lra, dialog, noisefloor, db, …),
 * rms and peak in dB as the CLI prints them, or the sound's duration, sampleRate or channels.
 */
import audio, { LOAD, parseTime } from '../core.js'
import { queryRange } from '../stats.js'
import { printed, dialogOf } from './loudness.js'
import { LOUDNESS, specOf } from './specs.js'

const toDb = v => v > 0 ? 20 * Math.log10(v) : -Infinity
const r1 = v => Math.round(v * 10) / 10
const rule = (name, value, unit, min, max, note, hint) => {
  let v = printed(value), pass = v >= (min ?? -Infinity) && v <= (max ?? Infinity)
  return { name, value, unit, min, max, pass, required: true, ...(note && { note }), ...(!pass && hint && { hint }) }
}
/** A rule its source recommends, not requires: missed, it fails as any rule does; the flag says which word it has */
const recommended = r => ({ ...r, required: false })
const info = (name, value, unit, note) => ({ name, value, unit, pass: null, ...(note && { note }) })
// ATSC A/85 §3.4: short-form content's "Duration is typically less than approximately three minutes"
const SHORT = 180
/** The loudness normalize() aims at to move the measured `v` to `target` (a dialog's, say) with the program, its
 *  true-peak ceiling held: normalize measures the program, so the program moves by what `v` must */
const shift = (lufs, v, target, ceiling) => `normalize(${r1(lufs + target - v)}, 'lufs'${ceiling ? `, { ceiling: ${ceiling} }` : ''})`

/** Seconds of room tone at the start and the end: sound is a 0.1 s window 10 dB over the noise
 *  floor, its edge the first (last) block over it, to the block (1024 samples). ACX states the
 *  duration, not how to find it; this is our reading. */
async function roomTone(a, floorDb) {
  let { stats, ch, sr, from, to } = await queryRange(a, null, ['ms'])
  let bs = stats.blockSize, W = Math.max(1, Math.round(0.1 * sr / bs)), T = ch * 10 ** ((floorDb + 10) / 10)
  let e = i => { let s = 0; for (let c = 0; c < ch; c++) s += stats.ms[c][i]; return s }
  let first = -1, last = -1
  for (let i = from; i + W <= to; i++) {
    let s = 0
    for (let j = i; j < i + W; j++) s += e(j)
    if (s > W * T) { if (first < 0) first = i; last = i + W }
  }
  if (first < 0) return [a.duration, a.duration]
  while (e(first) <= T) first++
  while (e(last - 1) <= T) last--
  return [(first - from) * bs / sr, Math.max(0, a.duration - last * bs / sr)]
}

// Limits quote their source (as read 2026-11-18); measurement follows it where it says how.
const SPECS = {
  // ACX: acx.com "ACX audio submission requirements": "between -23dB and -18dB RMS", "Peak levels are less than
  // -3dB", "Noise floor is less than -60dB RMS", "We recommend between 1 and 5 seconds of room tone at the beginning and
  // end ... Room tone spacing must not exceed 5 seconds" (we hold the recommended 1 to 5 s), "192 kbps or higher CBR" at
  // "44.1kHz MP3", "no longer than 120 minutes". ACX says what, not how: measured as ACX Check 2.4.2-1 (Steve Daulton,
  // GPL-2), the Audacity checker narrators use. `peak-level`: the sample peak over all channels (fails above -3.00).
  // `track-rms`: the root of the channels' whole-file mean squares averaged, unweighted (passes -23.00 to -18.00).
  // `getfloor`: the quietest RMS of 0.4 s windows stepped at 10 Hz, full windows only (fails above -59.99). ACX Check
  // compares unrounded values; a rule here judges its value to 0.01 as printed. Its warnings are kept as notes.
  // Required: RMS ("needs to fall between"), peak, noise floor, rate and length ("must"), and of the room tone "must not
  // exceed 5 seconds", read here at the two ends, the longer (pauses inside are not read); recommended: the 1 to 5 s at
  // each end.
  acx: {
    name: 'ACX audiobook', url: 'https://www.acx.com/help/article/what-are-the-acx-audio-submission-requirements',
    note: 'deliver MP3, 192 kbps CBR or higher, 44.1 kHz, 120 minutes or less per file; all files mono or all stereo',
    rules: async a => {
      let [peak, rms, floor] = await a.stat(['db', 'rms', 'noisefloor'])
      let [head, tail] = await roomTone(a, floor), level = "normalize(-20, 'rms', { ceiling: -3.5 })", room = 'trim().pad(1.5, 2).roomtone()'
      return [
        rule('RMS', toDb(rms), 'dB', -23, -18, null, level),
        rule('Peak', peak, 'dB', null, -3, peak < -6 && 'below -6 dB: may be over-compressed or too quiet', level),
        rule('Noise floor', floor, 'dB', null, -60, floor < -90 && 'below -90 dB: dead silence sounds unnatural', 'omlsa()'),
        recommended(rule('Room tone, start', head, 's', 1, 5, null, room)),
        recommended(rule('Room tone, end', tail, 's', 1, 5, null, room)),
        rule('Room tone spacing', Math.max(head, tail), 's', null, 5, 'the longer end; pauses inside not read', room),
        rule('Sample rate', a.sampleRate, 'Hz', 44100, 44100, null, 'resample(44100)'),
        rule('Length', a.duration / 60, 'min', null, 120, null, `split(${Array.from({ length: Math.ceil(a.duration / 7200) - 1 }, (_, i) => 7200 * (i + 1)).join(', ')})`),
      ]
    }
  },
  // Apple Podcasts: "around -16 dB LKFS, with a +/- 1 dB tolerance, and that the true-peak
  // value doesn't exceed -1 dB FS", ITU-R BS.1770-5 (the same as -4 for mono and stereo)
  // Recommended, both: "we recommend that the audio signals are preconditioned so the overall loudness remains around
  // ..." (Best practices for audio). Spotify states no loudness for podcasts: its Podcast Delivery Specification v1.10
  // (May 2025) §4.1 recommends a format alone ("We recommend either high bitrate (128kbps+) MP3 ... or MP4 with AAC-LC").
  podcast: {
    name: 'Apple Podcasts', url: 'https://podcasters.apple.com/support/893-audio-requirements',
    rules: async a => {
      let [lufs, tp] = await a.stat(['loudness', 'truepeak'])
      return [recommended(rule('Loudness', lufs, 'LUFS', LOUDNESS.podcast - 1, LOUDNESS.podcast + 1, null, "normalize('podcast')")), recommended(rule('True peak', tp, 'dBTP', null, -1, null, "normalize('podcast')"))]
    }
  },
  // Spotify normalizes on playback to -14 LUFS, raising quiet tracks only as far as 1 dB of true-peak
  // headroom allows; masters: "below -1dB TP", "True Peak below -2dB" when louder than -14 LUFS
  // Recommended: "Mastering tips ... To optimize playback across Spotify: ... Keep it below -1dB TP".
  spotify: {
    name: 'Spotify', url: 'https://support.spotify.com/us/artists/article/loudness-normalization/',
    rules: async a => {
      let [lufs, tp] = await a.stat(['loudness', 'truepeak'])
      // "louder than -14 LUFS", judged as printed: a master normalized to -14.00 is not louder
      let T = LOUDNESS.spotify, loud = printed(lufs) > T, gain = loud ? T - lufs : Math.max(0, Math.min(T - lufs, -1 - tp))
      return [
        info('Loudness', lufs, 'LUFS', Math.abs(printed(gain)) < 0.01 ? 'plays as is' : `plays ${Math.abs(gain).toFixed(1)} dB ${gain < 0 ? 'quieter' : 'louder'}`),
        recommended(rule('True peak', tp, 'dBTP', null, loud ? -2 : -1, loud && `louder than ${T} LUFS: -2 dBTP`, shift(lufs, 0, 0, loud ? -2 : -1))),
      ]
    }
  },
  // EBU R 128-2023: -23.0 LUFS, ±0.2 LU for measurement in quality control (i), ±1.0 LU only for
  // live programmes (h); true peak ≤ -1 dBTP (m); loudness range (n) and maxima (o) as descriptors,
  // LRA not advised under 1 minute (note 2); meters per BS.1770 and EBU Tech 3341 (k)
  // Required: the EBU "recommends: ... h) that the Programme Loudness Level shall be normalised to a Target Level of
  // −23.0 LUFS", "m) ... that the True Peak Level of a programme shall not exceed −1 dBTP". EBU Tech 3343-2023 §3.3: LRA
  // "should not be a brick wall parameter for delivery specifications"
  broadcast: {
    name: 'EBU R 128', url: 'https://tech.ebu.ch/docs/r/r128.pdf',
    rules: async a => {
      let [lufs, tp, lra, m, s] = await a.stat(['loudness', 'truepeak', 'lra', 'momentary', 'shortterm'])
      return [
        rule('Loudness', lufs, 'LUFS', LOUDNESS.broadcast - .2, LOUDNESS.broadcast + .2, null, "normalize('broadcast')"), rule('True peak', tp, 'dBTP', null, -1, null, "normalize('broadcast')"),
        info('Loudness range', lra, 'LU', a.duration < 60 && 'under 1 minute: too few short-term values for LRA'),
        info('Max momentary', m, 'LUFS'), info('Max short-term', s, 'LUFS'),
      ]
    }
  },
  // Netflix Sound Mix Specifications & Best Practices v1.6: -27 LKFS ±2 LU dialog-gated, peaks
  // ≤ -2 dBTP. Netflix gates with Dolby Dialogue Intelligence (BS.1770-1); `dialog` finds speech by VAD
  // Required, its Technical Specification (studiopartner.netflix.net, where the partnerhelp article now leads): "Set
  // average loudness at -27 LKFS with a tolerance of ±2 LU, dialog-gated. Peaks must not exceed -2dB True Peak. Audio
  // should be measured over the full program according to ITU-R BS.1770-1": the dialog's gating windows without the
  // relative gate (ATSC A/85:2026-07 §5.2.2: "Versions of BS.1770 without relative-level gating can be referred to as
  // BS.1770-1"). Its Best Practices, "What follows are not Technical Specifications. While adherence is not mandatory, it
  // is recommended for optimal results": "When near field Atmos or 5.1 mixes measure at less than 15% dialogue, program
  // target measurement will be used instead (-24 LKFS +/- 2 LU - ITU BS 1770-3 or -4)": a mix of 6 channels or more
  // under 15 % dialogue passes the dialog rule on its programme where its dialog misses, its line saying which it read.
  // Netflix doesn't say how its share is counted: here, of the gating windows over the absolute gate, those that hold
  // speech.
  netflix: {
    name: 'Netflix', url: 'https://studiopartner.netflix.net/studio/branded-sound-mix-spec-and-best-practices',
    rules: async a => {
      let [{ lufs: dialog, share }, tp, lufs] = await Promise.all([dialogOf(a, { relative: false }), a.stat('truepeak'), a.stat('loudness')])
      let few = share < 0.15, surround = a.channels >= 6, said = `${(share * 100).toFixed(1)} % dialogue`, vad = 'speech found by voice activity, not Dolby Dialogue Intelligence'
      let d = rule('Dialog loudness', dialog, 'LUFS', -29, -25, vad, Number.isFinite(dialog) && shift(lufs, dialog, -27, -2))
      // a 5.1 or Atmos mix under 15 % dialogue: its programme at -24 ±2 passes the rule where its dialog misses
      let p = few && surround && !d.pass && rule('Dialog loudness', lufs, 'LUFS', -26, -22, `${said}, under 15 %: the programme read, as Netflix's Best Practices (not mandatory) read a 5.1 or Atmos mix; ${Number.isFinite(dialog) ? `its dialog ${printed(dialog).toFixed(2)} LUFS` : 'no dialog found'}`)
      if (p?.pass) d = p
      else if (few) d.note = `${vad}; ${said}${!surround ? `: Netflix measures the programme of a 5.1 or Atmos mix under 15 %, of ${a.channels === 1 ? 'a mono' : a.channels === 2 ? 'a stereo' : `a ${a.channels}-channel`} one it doesn't say` : p ? `, under 15 %: the programme, ${printed(lufs).toFixed(2)} LUFS, misses -26 to -22 too (Netflix's Best Practices, not mandatory, for a 5.1 or Atmos mix)` : ', under 15 %'}`
      return [d, rule('True peak', tp, 'dBTP', null, -2, null, shift(lufs, 0, 0, -2))]
    }
  },
  // ATSC A/85:2026-07 (8 July 2026), a Recommended Practice, §6, content delivered without metadata: "the Target
  // Loudness value should be –24 LKFS. Measurement tolerance of up to approximately ±2 dB around this value is
  // anticipated ... Content Loudness should not be targeted to the high or low side of this tolerance"; "The True Peak
  // level should be kept below –2 dBTP", "Minor measurement tolerance ... of up to approximately ±0.5 dBTP ... is
  // acceptable": recommended, both. Annex M, Table M.1: long-form content on its dialogue, "BS.1770-1 (i.e.,
  // without the relative-level gate added in subsequent versions), along with a Dialogue-Gating algorithm" (note 31), on
  // its full mix only where it holds no dialogue "whatsoever" (note 32); short-form content on its full mix, BS.1770-3 or
  // later (note 33). Short-form: under 3 minutes, as §3.4 bounds it ("Duration is typically less than approximately
  // three minutes"): what a sound is, a spot or a programme, its samples don't say; its length does.
  atsc: {
    name: 'ATSC A/85', url: 'https://www.atsc.org/wp-content/uploads/2026/07/A85-2026-07.pdf',
    rules: async a => {
      let [lufs, tp] = await a.stat(['loudness', 'truepeak']), short = a.duration < SHORT
      let dialog = short ? -Infinity : (await dialogOf(a, { relative: false })).lufs, speech = dialog > -Infinity, v = speech ? dialog : lufs
      let note = short ? 'under 3 minutes, short-form: the full mix' : speech ? 'long-form: speech found by voice activity' : 'long-form, no speech found: the full mix'
      return [
        recommended(rule(speech ? 'Dialog loudness' : 'Loudness', v, 'LUFS', -26, -22, note, Number.isFinite(v) && shift(lufs, v, -24, -2))),
        recommended(rule('True peak', tp, 'dBTP', null, -2, printed(tp) > -2 && printed(tp) <= -1.5 && 'within the ±0.5 dB A/85 §6 calls acceptable', shift(lufs, 0, 0, -2))),
      ]
    }
  },
}
export const specs = Object.keys(SPECS)

// ── Limits of your own ──────────────────────────────────────────────────

const OWN = ['duration', 'sampleRate', 'channels']
const UNIT = { loudness: 'LUFS', dialog: 'LUFS', momentary: 'LUFS', shortterm: 'LUFS', truepeak: 'dBTP', lra: 'LU', db: 'dB', rms: 'dB', peak: 'dB', noisefloor: 'dB', crest: 'dB', duration: 's', sampleRate: 'Hz', centroid: 'Hz' }
// What would bring a measure to `t` (a range's middle, else its one end), from `v`
const FIX = {
  loudness: t => `normalize(${r1(t)}, 'lufs')`,
  rms: t => `normalize(${r1(t)}, 'rms')`,
  db: t => `normalize(${r1(t)})`, peak: t => `normalize(${r1(t)})`,
  truepeak: async (t, v, a) => shift(await a.stat('loudness'), 0, 0, t),
  dialog: async (t, v, a) => shift(await a.stat('loudness'), v, t),
  noisefloor: () => 'omlsa()',
  sampleRate: t => `resample(${t})`,
  channels: t => `remix(${t})`,
}

/** A number a limit is written with, its unit if any: dB (LUFS, LU, dBTP), Hz, kHz, or a time (s, ms, m, h, 1:30) */
function amount(s) {
  if (typeof s === 'number') return s
  let t = String(s).trim(), m = t.match(/^([+-]?(?:\d+\.?\d*|\.\d+))\s*(db\w*|lufs|lkfs|lu|hz|khz)?$/i)
  if (m) return +m[1] * (/^khz$/i.test(m[2]) ? 1000 : 1)
  try { return t ? parseTime(t) ?? NaN : NaN } catch { return NaN }
}

/** A limit as [min, max], null an open end */
function limit(v, name) {
  let pm = typeof v === 'string' && v.split('±'), r = typeof v === 'string' && v.split('..')
  let lim = typeof v === 'number' ? [v, v]
    : Array.isArray(v) && v.length === 2 ? v.map(x => x == null ? null : amount(x))
    : typeof v !== 'string' ? null
    : pm.length === 2 ? (([c, t]) => [c - t, c + t])(pm.map(amount))
    : r.length === 2 ? r.map(x => x.trim() ? amount(x) : null)
    : r.length === 1 && pm.length === 1 ? [amount(v), amount(v)] : null
  if (!lim || lim.some(x => Number.isNaN(x)) || lim.every(x => x == null) || lim[0] != null && lim[1] != null && lim[0] > lim[1])
    throw new TypeError(`check: ${name}: a limit is a number, [min, max], 'min..max', '..max', 'min..' or 'value±tolerance', not ${JSON.stringify(v)}`)
  return lim
}

/** The value a limit of your own holds: the sound's own, else its stat, rms and peak in dB */
async function measured(a, name) {
  if (OWN.includes(name)) return a[name]
  let v = await a.stat(name)
  if (name === 'rms' || name === 'peak') v = toDb(v)
  if (typeof v !== 'number') throw new TypeError(`check: ${name} is not a number to hold to a limit`)
  return v
}

async function own(a, spec) {
  if (!Object.keys(spec).length) throw new TypeError("check: no limits: { loudness: '-17..-15', truepeak: '..-1' }")
  await a[LOAD]()
  if (!a.decoded && a.ready) await a.ready
  let rules = []
  for (let [name, v] of Object.entries(spec)) {
    let [min, max] = limit(v, name), x = await measured(a, name), r = rule(name, x, UNIT[name] ?? '', min, max)
    if (!r.pass && Number.isFinite(x) && FIX[name]) r.hint = await FIX[name](min != null && max != null ? (min + max) / 2 : min ?? max, x, a)
    rules.push(r)
  }
  return { pass: rules.every(r => r.pass), rules }
}

audio.fn.check = async function(spec) {
  if (spec?.constructor === Object) return own(this, spec)
  let key = specOf(spec), s = SPECS[key]
  if (!s) throw new RangeError(`check: unknown spec '${spec}' (${specs.join(', ')})`)
  let rules = await s.rules(this)
  return { spec: key, name: s.name, url: s.url, ...(s.note && { note: s.note }), pass: rules.every(r => r.pass !== false), rules }
}
