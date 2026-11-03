// Hits (fn/hits.js): where the level jumps, each at the sample a cut there keeps all of. The built-in samples strike at
// known times (site/samples.js: the chime's bars at 0.5 + 0.6 n s, 0.9 s more after the fourth; the handpan's phrase),
// the ground truth these are measured against.
import test, { ok, is } from 'tst'
import audio from '../audio.js'
import { attacks, hits, rises, plainness } from '../fn/hits.js'
import { samples, RATE } from '../site/samples.js'

const strikes = { chime: [.5, 1.1, 1.7, 2.3, 3.8, 4.4, 5, 5.6], handpan: [.3, .85, 1.3, 1.75, 2.3, 2.75, 3.25, 3.9] }

// Cues are slice points: where each hit's attack starts, so a cut there keeps all of it. The rings beat and overlap, and
// make none. Reversed, each strike is a stop, and the cues are the same, mirrored: to within the 1 ms steps of the
// envelope the attack is read on and the 1 ms the zero crossing is looked for in.
test('hits: each lands at its strike, before it or within the first half millisecond of a soft one', () => {
  for (const [name, times] of Object.entries(strikes)) {
    const channels = samples[name].make(), cues = hits(channels, RATE), end = channels[0].length / RATE
    is(cues.length, times.length, name)
    cues.forEach((t, i) => ok(t - times[i] > -.004 && t - times[i] < .0006, `${name} strike ${i} at ${times[i]} s: cue ${t.toFixed(4)}`))
    const back = hits(channels.map(x => x.slice().reverse()), RATE)
    is(back.length, cues.length, `${name} reversed`)
    back.forEach((t, i) => ok(Math.abs(t - (end - cues.at(-1 - i))) < .002, `${name} reversed: stop ${i} at ${t.toFixed(4)}, the strike mirrored ${(end - cues.at(-1 - i)).toFixed(4)}`))
  }
  // a swell or a decay, 60 or 120 dB a second, is a slope in dB and makes none; a gate's stop makes one, as a strike
  // mirrored: after the sound, within 4 ms (a sine of 440 Hz, which crosses zero where the gate shuts at 1.2 s)
  const rate = 44100, tone = gain => [Float32Array.from({ length: rate * 2 }, (_, i) => gain(i / rate) * Math.sin(2 * Math.PI * 440 * i / rate))]
  for (const db of [60, 120]) is(hits(tone(t => 10 ** (-db / 20 * Math.abs(t - 1))), rate), [], `${db} dB a second`)
  const [stop, ...more] = hits(tone(t => t < 1.2 ? 1 : 0), rate)
  ok(!more.length && stop > 1.2 - .0006 && stop < 1.2 + .004, String(stop))
  // nothing to find: no samples, fewer than a step's, silence (and the gate's tone, sounding from the start, has no cue there)
  for (const x of [new Float32Array(0), new Float32Array(100), new Float32Array(rate)]) is(hits([x, x], rate), [], `${x.length} samples`)
  // noise alone flickers and makes none: a rumble (white noise through a one-pole lowpass at about 70 Hz, whose 10 ms
  // levels jump 6 dB and more, 111 cues before) and a hiss; strikes 40 dB over the rumble make theirs, each where it is
  let seed = 1
  const noise = k => { let y = 0; return Float32Array.from({ length: rate * 10 }, () => (y += ((seed = seed * 16807 % 2147483647) / 2147483647 * 2 - 1 - y) * k) * .01) }
  for (const k of [.01, .05]) is(hits([noise(k)], rate), [], `noise through a one-pole of ${k}`)
  const struck = noise(.01)
  for (const t of [1, 4, 7]) for (let i = 0; i < rate * .5; i++) struck[t * rate + i] += .8 * Math.sin(2 * Math.PI * 440 * i / rate) * Math.exp(-i / rate * 8)
  const found = hits([struck], rate).filter(t => [1, 4, 7].some(s => t > s - .005 && t < s + .005))
  is(found.length, 3, String(hits([struck], rate)))
})

// A sound swelling out of a ground that flickers as much as it grows in 10 ms, as a blackbird's phrase does (xeno-canto
// 1059970: 23 dB in 120 ms out of a ground flickering 4 to 8 dB each 10 ms): no jump at 10 ms, a step at 50 ms, its rise
// where the ground ends, within the 5 ms windows the level is read in; before, none. How plain each cue is: the swell's
// start and the tone's end step as far as the tone is over the ground, about 25 dB, a moment of the ground hardly at
// all; the sound each bounds peaks as high as the tone (10^(-27/20), 0.045), or the ground (0.003)
test('hits: a swell out of a flickering ground rises where the ground ends; how plain each cue is', () => {
  const rate = 44100, x = new Float32Array(rate * 2)
  let seed = 1, g = 1
  const rnd = () => (seed = seed * 16807 % 2147483647) / 2147483647
  // the ground about 55 dB under full scale, its gain each 10 ms 0 to 8 dB down; from 1 s a 2 kHz tone swelling from
  // 50 dB under 23 dB in 120 ms, held to 1.42 s
  for (let i = 0; i < x.length; i++) {
    if (i % (rate / 100) === 0) g = 10 ** (-8 * rnd() / 20)
    const t = i / rate, db = t < 1 || t > 1.42 ? -Infinity : -50 + 23 * Math.min(1, (t - 1) / .12)
    x[i] = .003 * (2 * rnd() - 1) * g + 10 ** (db / 20) * Math.sin(2 * Math.PI * 2000 * t)
  }
  const up = rises([x], rate).map(r => r.t)
  ok(up.length === 1 && up[0] > .995 && up[0] < 1.005, `the swell's rise: ${up}`)
  const [ground, start, end] = plainness([.5, 1, 1.42], [x], rate)
  ok(start.rank > 20 && end.rank > 20, `the tone's start and end step ${start.rank.toFixed(1)}, ${end.rank.toFixed(1)} dB`)
  ok(ground.rank < 3 && ground.peak < .004, `the ground's flicker steps ${ground.rank.toFixed(1)} dB, peaks ${ground.peak.toFixed(4)}`)
  ok(Math.abs(end.peak - .045) < .004, `the tone's end, the tone's peak: ${end.peak.toFixed(4)}`)
  is(plainness([], [x], rate), [], 'none asked')
})

test('hits: an attack starts at a zero crossing, in order, within the sound', () => {
  // a cut there starts at a zero crossing: the channels' sum changes sign within a sample of it
  const channels = samples.chime.make(), [cue] = attacks([.51], channels, RATE), i = Math.round(cue * RATE), sum = k => channels[0][k] + channels[1][k]
  ok(sum(i - 1) * sum(i) <= 0, `${sum(i - 1)} ${sum(i)}`)
  // nothing to find, or nothing to read: the times come back in order, no later than given, none before the start
  is(attacks([], [new Float32Array(0)], RATE), [])
  const two = attacks([0, .001], [new Float32Array(441)], RATE)
  ok(two[0] === 0 && two[1] > 0 && two[1] <= .001, JSON.stringify(two))
  const silence = attacks([.5, .5, .2], [new Float32Array(RATE)], RATE)
  ok(silence.every((t, k) => t >= 0 && (!k || t > silence[k - 1])), JSON.stringify(silence))
  // a time past the end stays within the sound
  const [past] = attacks([2], [new Float32Array(441)], RATE)
  ok(Number.isFinite(past) && past <= 441 / RATE, String(past))
})

// The stat: the same times as hits() on the samples, a range's in the sound's own time, from a negative `at` too
test('hits: stat(\'hits\') over all of it and over a range', async () => {
  const channels = samples.chime.make(), a = audio.from(channels, { sampleRate: RATE }), all = hits(channels, RATE)
  const got = await a.stat('hits')
  ok(got instanceof Float64Array, 'Float64Array')
  is([...got], all, 'the samples\' hits')
  is([...await a.hits()], all, 'a.hits()')
  // a range starting between strikes keeps the hits in it, where they are in the sound
  const inside = all.filter(t => t >= 1.4 && t < 3)
  const near = (p, q) => p.length === q.length && p.every((t, i) => Math.abs(t - q[i]) < 1e-3)
  ok(near([...await a.stat('hits', { at: 1.4, duration: 1.6 })], inside), `${[...await a.stat('hits', { at: 1.4, duration: 1.6 })]} ${inside}`)
  ok(near([...await a.stat('hits', { at: 1.4, d: 1.6 })], inside), 'd for duration')
  const tail = all.filter(t => t >= a.duration - 3)
  ok(near([...await a.stat('hits', { at: -3 })], tail), 'the last 3 s')
  is([...await audio.from(1, { sampleRate: RATE }).stat('hits')], [], 'silence: none')
})
