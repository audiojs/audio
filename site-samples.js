// Built-in samples, generated here: no downloads, no recordings. Stereo at 44.1 kHz, about -16 LUFS, with quiet edges
// so trim has something to do. Each is a few seconds of sparse, distinct strikes that read in the waveform.
export const RATE = 44100
const mtof = note => 440 * 2 ** ((note - 69) / 12)
const random = seed => () => (seed = (seed * 16807) % 2147483647) / 2147483647 * 2 - 1
const stereo = seconds => [0, 1].map(() => new Float32Array(Math.round(seconds * RATE)))

// Sine of a phase in cycles, from a table.
const TABLE = Float32Array.from({ length: 4097 }, (_, i) => Math.sin(2 * Math.PI * i / 4096))
const sine = phase => { const x = (phase - Math.floor(phase)) * 4096, i = x | 0; return TABLE[i] + (x - i) * (TABLE[i + 1] - TABLE[i]) }
// The factor that, applied once a sample, falls by e over `seconds`.
const decay = seconds => Math.exp(-1 / (seconds * RATE))

// Adds render(t) over `seconds` from `at` (t the time into the note), panned from -1 (left) to 1 (right).
function play([left, right], at, seconds, render, pan = 0) {
  const from = Math.round(at * RATE), n = Math.min(Math.round(seconds * RATE), left.length - from)
  const l = Math.cos((pan + 1) * Math.PI / 4), r = Math.sin((pan + 1) * Math.PI / 4)
  for (let i = 0; i < n; i++) { const x = render(i / RATE); left[from + i] += l * x; right[from + i] += r * x }
}
// A struck mode: a sine falling 60 dB in t60 seconds, rising over the strike's contact so it starts without a click.
function ring([left, right], at, f, level, t60, pan = 0, contact = .001) {
  if (f >= RATE / 2) return
  const w = 2 * Math.PI * f / RATE, d = 10 ** (-3 / (t60 * RATE)), c = d * Math.cos(w), s = d * Math.sin(w), rise = Math.exp(-1 / (contact * RATE))
  const l = Math.cos((pan + 1) * Math.PI / 4), r = Math.sin((pan + 1) * Math.PI / 4)
  let x = level, y = 0, gap = 1
  for (let i = Math.round(at * RATE); i < left.length && x * x + y * y > 1e-12; i++) {
    const v = y * (1 - gap); left[i] += l * v; right[i] += r * v
    const next = x * c - y * s; y = x * s + y * c; x = next; gap *= rise
  }
}

// Freeverb (Jezar at Dreampoint): eight damped combs into four allpasses per side, fed the sum of both sides, the
// right side's delays 23 samples longer so they decorrelate; lengths for 44.1 kHz. Adds `wet` of the hall in place.
function hall(channels, { room = .84, damp = .2, wet = .3 } = {}) {
  const [left, right] = channels, input = left.map((v, i) => (v + right[i]) * .015)
  channels.forEach((out, side) => {
    const spread = side * 23, combs = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617].map(n => new Float32Array(n + spread))
    const passes = [556, 441, 341, 225].map(n => new Float32Array(n + spread)), store = new Float32Array(8), ci = new Int32Array(8), pi = new Int32Array(4)
    for (let n = 0; n < input.length; n++) {
      let y = 0
      for (let k = 0; k < 8; k++) {
        const buf = combs[k], v = buf[ci[k]]
        store[k] = v * (1 - damp) + store[k] * damp
        buf[ci[k]] = input[n] + store[k] * room
        if (++ci[k] === buf.length) ci[k] = 0
        y += v
      }
      for (let k = 0; k < 4; k++) {
        const buf = passes[k], v = buf[pi[k]]
        buf[pi[k]] = y + v * .5
        y = v - y
        if (++pi[k] === buf.length) pi[k] = 0
      }
      out[n] += wet * y
    }
  })
  return channels
}
// Scales the channels by `gain` and fades the last `seconds` before `end` to silence.
function finish(channels, gain, end, seconds) {
  const to = Math.round(end * RATE), from = to - Math.round(seconds * RATE)
  for (const pcm of channels) for (let i = 0; i < pcm.length; i++) pcm[i] *= gain * (i < from ? 1 : i >= to ? 0 : .5 + .5 * Math.cos(Math.PI * (i - from) / (to - from)))
  return channels
}

export const samples = {
  // An airport chime pair, C4 E4 G4 C5 rising, a pause, then falling, on vibraphone bars: modes tuned to 1, 4 and 10
  // times the note and a few untuned ones above, a mallet's click, in a hall.
  chime: { description: 'Airport chime, rising and falling', make: () => {
    const out = stereo(8), noise = random(1)
    ;[60, 64, 67, 72, 72, 67, 64, 60].forEach((note, n) => {
      const at = .5 + n * .6 + (n > 3 ? .9 : 0), f = mtof(note)
      ring(out, at, f, .5, 2.6); ring(out, at, f * 1.0015, .12, 2.6)
      ring(out, at, f * 3.98, .2, .9); ring(out, at, f * 9.9, .11, .3); ring(out, at, f * 5.52, .03, .12); ring(out, at, f * 19.5, .045, .1)
      let last = 0
      play(out, at, .006, t => { const x = noise(), y = x - last; last = x; return .09 * y * Math.exp(-t / .0015) })
    })
    return finish(hall(out, { room: .86, damp: .15, wet: .35 }), .72, 7.7, 1.2)
  } },

  // A handpan in D Kurd, a slow phrase under the fingers. Each note field is tuned in three, the note, its octave and
  // the fifth above that, each ringing as a slightly split pair that shimmers, with the steel's untuned modes above
  // them; a finger's quick strike and its tick, the shell's low hum, and the center ding ringing along with the notes
  // that share its pitch.
  handpan: { description: 'Handpan, a slow phrase in D minor', make: () => {
    const out = stereo(6.4), noise = random(4)
    const strike = (at, note, level, pan) => {
      const f = mtof(note)
      for (const [k, a, t60, split] of [[1, 1, 2.8, .4], [2, .45, 1.8, .7], [3, .24, 1, 1.1], [4.03, .1, .6, 1.5], [5.07, .065, .45, 1.9], [6.12, .05, .35, 2.3], [8.2, .03, .22, 3]]) {
        ring(out, at, f * k, level * a, t60, pan, .0025); ring(out, at, f * k + split, level * a * .6, t60, pan, .0025)
      }
      for (const [shimmer, a] of [[2870, .025], [4130, .02], [5710, .014]]) ring(out, at, shimmer * (1 + .03 * (note % 5)), level * a, .18, -pan, .001)
      ring(out, at, 145, level * .12, .35, 0, .003)
      if (note % 12 === 2) ring(out, at, mtof(50) * 2, level * .06, 3, -pan, .02)
      let last = 0
      play(out, at, .012, t => { const x = noise(), y = x - last; last = x; return level * .12 * y * Math.exp(-t / .002) }, pan)
    }
    const phrase = [[.3, 50, .5, 0], [.85, 57, .32, -.35], [1.3, 62, .3, .35], [1.75, 65, .3, -.3], [2.3, 64, .3, .3], [2.75, 60, .28, -.25], [3.25, 62, .3, .3], [3.9, 50, .4, 0], [3.9, 69, .28, -.35]]
    for (const [at, note, level, pan] of phrase) strike(at, note, level, pan)
    return finish(hall(out, { room: .8, damp: .3, wet: .2 }), .7, 6.1, 1.4)
  } },

  // A songbird at dawn: two phrases of fluty whistles, gliding and warbling between 1.9 and 2.9 kHz, each ending in a
  // quick twitter of chirps falling from 7 kHz. A whistle is a sine with a little of its octave and of breath, gliding
  // from one pitch to the next; a warble trembles 30 times a second. [start, seconds, from Hz, to Hz, warble Hz, level]
  birdsong: { description: 'Birdsong at dawn', make: () => {
    const out = stereo(4.5), noise = random(11)
    const whistle = (at, seconds, from, to, warble, level, pan = .2) => {
      let phase = 0, breath = 0
      play(out, at, seconds, t => {
        const u = t / seconds, f = from * (to / from) ** u + warble * 6 * Math.sin(2 * Math.PI * warble * t)
        phase += f / RATE; breath += .3 * (noise() - breath)
        return level * Math.sin(Math.PI * Math.min(1, u * 6, (1 - u) * 5) / 2) * (sine(phase) + .12 * sine(2 * phase) + .05 * breath)
      }, pan)
    }
    const song = [
      [.35, .16, 2100, 2500, 0, .8], [.53, .12, 2500, 2050, 0, .7], [.7, .22, 2300, 2300, 30, .75], [.97, .26, 2750, 1900, 0, .8],
      ...[0, 1, 2, 3, 4, 5].map(k => [1.33 + k * .055, .035, 6800, 4300, 0, .35]),
      [2.4, .14, 1900, 2400, 0, .75], [2.56, .2, 2400, 2400, 30, .7], [2.8, .18, 2600, 2100, 0, .75], [3.02, .3, 2200, 2900, 0, .8],
      ...[0, 1, 2, 3, 4].map(k => [3.42 + k * .06, .035, 7000, 5000, 0, .32]),
    ]
    for (const [at, seconds, from, to, warble, level] of song) whistle(at, seconds, from, to, warble, level)
    return finish(hall(out, { room: .6, damp: .5, wet: .15 }), .32, 4.2, .3)
  } },

  // A jazz pianist's ballad turn on an electric piano, in A minor: Fmaj9♯11, Bm7♭5, E7♭9♭13, Am(maj9), and the G♯
  // sinking to G. Rootless voicings over the bass, each voice moving by a step, the top one sighing from C to B. FM keys
  // (a sine modulated at its own frequency, the index falling as the note sounds, and a tine's ping), the suitcase's
  // stereo tremolo and a tape's slow wobble. [bass, upper voices] per chord, rolled from the bass up.
  rhodes: { description: 'Electric piano, a jazz ballad’s turn', make: () => {
    const out = stereo(7.2), wobble = t => 1 + .0012 * sine(.45 * t)
    const key = (at, seconds, note, level) => {
      const f = mtof(note), fades = [decay(.6), decay(.2), decay(.015), decay(2.4 * Math.sqrt(262 / f)), decay(.12)]
      let p = 0, index = 1, ping = 1, strike = 1, sound = 1, release = 1
      const [left, right] = out, from = Math.round(at * RATE), n = Math.min(Math.round((seconds + .5) * RATE), left.length - from)
      for (let i = 0; i < n; i++) {
        const s = i / RATE, t = at + s
        p += f * wobble(t) / RATE; index *= fades[0]; ping *= fades[1]; strike *= fades[2]; sound *= fades[3]
        if (s > seconds) release *= fades[4]
        const body = sine(p + (.8 * index + .1) * sine(p) / (2 * Math.PI)), tine = .2 * ping * sine(p + 1.5 * strike * sine(14 * p) / (2 * Math.PI))
        const x = level * (s < .002 ? s / .002 : 1) * sound * release * (body + tine), pan = .25 * sine(4.5 * t)
        left[from + i] += x * (1 - pan); right[from + i] += x * (1 + pan)
      }
    }
    const chords = [[41, [57, 64, 67, 71]], [35, [57, 62, 65, 71]], [40, [56, 62, 65, 72]], [33, [56, 60, 64, 71]]]
    chords.forEach(([bass, voices], c) => {
      const at = .35 + c * 1.3, held = c < 3 ? 1 : 2.4, accent = c === 2 ? 1.15 : c === 3 ? .9 : 1
      key(at, held, bass, .1 * accent)
      voices.forEach((note, n) => key(at + .03 + n * .025, c === 3 && n === 0 ? 1.3 : held, note, (n === 3 ? .085 : .065) * accent))
    })
    key(.35 + 3 * 1.3 + 1.33, 1.1, 55, .055)
    return finish(hall(out, { room: .78, damp: .4, wet: .18 }), 1.5, 6.9, 1.2)
  } },

  // A patient monitor keeping time with a heart at 72 beats a minute: each beat a short tone near 1 kHz, as the pulse
  // is heard in an operating room.
  monitor: { description: 'Heart monitor beeping', make: () => {
    const out = stereo(5)
    for (let beat = 0; beat < 6; beat++) play(out, .35 + beat * 60 / 72, .11, t => {
      const edge = Math.min(1, t / .004, (.11 - t) / .01)
      return .52 * edge * (sine(950 * t) + .12 * sine(3 * 950 * t))
    })
    return finish(hall(out, { room: .5, damp: .6, wet: .08 }), 1, 4.7, .3)
  } },
}
