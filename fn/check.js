/**
 * Check against a delivery spec: each rule the spec states, its measured value, pass or fail.
 *
 * await a.check('acx') → { spec, name, url, pass, rules: [{ name, value, unit, min, max, pass, note }] }
 *
 * A rule passes when its value, rounded to 0.01 as printed, lies within [min, max]. A rule with
 * no limits reports what the spec describes without bounding it (pass: null) and never fails.
 */
import audio from '../core.js'
import { queryRange } from '../stats.js'
import { printed } from './loudness.js'

const toDb = v => v > 0 ? 20 * Math.log10(v) : -Infinity
const rule = (name, value, unit, min, max, note) => {
  let v = printed(value)
  return { name, value, unit, min, max, pass: v >= (min ?? -Infinity) && v <= (max ?? Infinity), ...(note && { note }) }
}
const info = (name, value, unit, note) => ({ name, value, unit, pass: null, ...(note && { note }) })

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

// Limits quote their source (as read 2026-09-27); measurement follows it where it says how.
const SPECS = {
  // ACX: help.acx.com "ACX Audio Submission Requirements": "between -23dB and -18dB RMS", "Peak levels are less than
  // -3dB", "Noise floor is less than -60dB RMS", "We recommend between 1 and 5 seconds of room tone at the beginning and
  // end ... Room tone spacing must not exceed 5 seconds" (we hold the recommended 1 to 5 s), "192 kbps or higher CBR" at
  // "44.1kHz MP3", "no longer than 120 minutes". ACX says what, not how: measured as ACX Check 2.4.2-1 (Steve Daulton,
  // GPL-2), the Audacity checker narrators use. `peak-level`: the sample peak over all channels (fails above -3.00).
  // `track-rms`: the root of the channels' whole-file mean squares averaged, unweighted (passes -23.00 to -18.00).
  // `getfloor`: the quietest RMS of 0.4 s windows stepped at 10 Hz, full windows only (fails above -59.99). ACX Check
  // compares unrounded values; a rule here judges its value to 0.01 as printed. Its warnings are kept as notes.
  acx: {
    name: 'ACX audiobook', url: 'https://help.acx.com/s/article/acx-audio-submission-requirements',
    note: 'deliver MP3, 192 kbps CBR or higher, 44.1 kHz, 120 minutes or less per file; all files mono or all stereo',
    rules: async a => {
      let [peak, rms, floor] = await a.stat(['db', 'rms', 'noisefloor'])
      let [head, tail] = await roomTone(a, floor)
      return [
        rule('RMS', toDb(rms), 'dB', -23, -18),
        rule('Peak', peak, 'dB', null, -3, peak < -6 && 'below -6 dB: may be over-compressed or too quiet'),
        rule('Noise floor', floor, 'dB', null, -60, floor < -90 && 'below -90 dB: dead silence sounds unnatural'),
        rule('Room tone, start', head, 's', 1, 5),
        rule('Room tone, end', tail, 's', 1, 5),
        rule('Sample rate', a.sampleRate, 'Hz', 44100, 44100),
        rule('Length', a.duration / 60, 'min', null, 120),
      ]
    }
  },
  // Apple Podcasts: "around -16 dB LKFS, with a +/- 1 dB tolerance, and that the true-peak
  // value doesn't exceed -1 dB FS", ITU-R BS.1770-5 (the same as -4 for mono and stereo)
  podcast: {
    name: 'Apple Podcasts', url: 'https://podcasters.apple.com/support/893-audio-requirements',
    rules: async a => {
      let [lufs, tp] = await a.stat(['loudness', 'truepeak'])
      return [rule('Loudness', lufs, 'LUFS', -17, -15), rule('True peak', tp, 'dBTP', null, -1)]
    }
  },
  // Spotify normalizes on playback to -14 LUFS, raising quiet tracks only as far as 1 dB of true-peak
  // headroom allows; masters: "below -1dB TP", "True Peak below -2dB" when louder than -14 LUFS
  streaming: {
    name: 'Spotify', url: 'https://support.spotify.com/us/artists/article/loudness-normalization/',
    rules: async a => {
      let [lufs, tp] = await a.stat(['loudness', 'truepeak'])
      // "louder than -14 LUFS", judged as printed: a master normalized to -14.00 is not louder
      let loud = printed(lufs) > -14, gain = loud ? -14 - lufs : Math.max(0, Math.min(-14 - lufs, -1 - tp))
      return [
        info('Loudness', lufs, 'LUFS', Math.abs(printed(gain)) < 0.01 ? 'plays as is' : `plays ${Math.abs(gain).toFixed(1)} dB ${gain < 0 ? 'quieter' : 'louder'}`),
        rule('True peak', tp, 'dBTP', null, loud ? -2 : -1, loud && 'louder than -14 LUFS: -2 dBTP'),
      ]
    }
  },
  // EBU R 128-2023: -23.0 LUFS, ±0.2 LU for measurement in quality control (i), ±1.0 LU only for
  // live programmes (h); true peak ≤ -1 dBTP (m); loudness range (n) and maxima (o) as descriptors,
  // LRA not advised under 1 minute (note 2); meters per BS.1770 and EBU Tech 3341 (k)
  broadcast: {
    name: 'EBU R 128', url: 'https://tech.ebu.ch/docs/r/r128.pdf',
    rules: async a => {
      let [lufs, tp, lra, m, s] = await a.stat(['loudness', 'truepeak', 'lra', 'momentary', 'shortterm'])
      return [
        rule('Loudness', lufs, 'LUFS', -23.2, -22.8), rule('True peak', tp, 'dBTP', null, -1),
        info('Loudness range', lra, 'LU', a.duration < 60 && 'under 1 minute: too few short-term values for LRA'),
        info('Max momentary', m, 'LUFS'), info('Max short-term', s, 'LUFS'),
      ]
    }
  },
  // Netflix Sound Mix Specifications & Best Practices v1.6: -27 LKFS ±2 LU dialog-gated, peaks
  // ≤ -2 dBTP. Netflix gates with Dolby Dialogue Intelligence (BS.1770-1); `dialog` finds speech by VAD
  netflix: {
    name: 'Netflix', url: 'https://partnerhelp.netflixstudios.com/hc/en-us/articles/360001794307',
    rules: async a => {
      let [dialog, tp] = await a.stat(['dialog', 'truepeak'])
      return [rule('Dialog loudness', dialog, 'LUFS', -29, -25, 'speech found by voice activity, not Dolby Dialogue Intelligence'), rule('True peak', tp, 'dBTP', null, -2)]
    }
  },
}
const ALIAS = { apple: 'podcast', spotify: 'streaming', ebu: 'broadcast' }
export const specs = Object.keys(SPECS)

audio.fn.check = async function(spec) {
  let key = ALIAS[spec] ?? spec, s = SPECS[key]
  if (!s) throw new RangeError(`check: unknown spec '${spec}' (${specs.join(', ')})`)
  let rules = await s.rules(this)
  return { spec: key, name: s.name, url: s.url, ...(s.note && { note: s.note }), pass: rules.every(r => r.pass !== false), rules }
}
