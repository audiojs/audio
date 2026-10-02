// Hits (fn/hits.js): where the level jumps, each at the sample a cut there keeps all of. The built-in samples strike at
// known times (site/samples.js: the chime's bars at 0.5 + 0.6 n s, 0.9 s more after the fourth; the handpan's phrase),
// the ground truth these are measured against.
import test, { ok, is } from 'tst'
import audio from '../audio.js'
import { attacks, hits } from '../fn/hits.js'
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
