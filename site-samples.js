// Built-in samples, generated here: no downloads, no recordings. Stereo at 44.1 kHz, about -16 LUFS, with quiet edges
// so trim has something to do: a chime and four classical pieces, each on an instrument synthesis does well.
export const RATE = 44100
const mtof = note => 440 * 2 ** ((note - 69) / 12)
const random = seed => () => (seed = (seed * 16807) % 2147483647) / 2147483647 * 2 - 1
const stereo = seconds => [0, 1].map(() => new Float32Array(Math.round(seconds * RATE)))

// Sine of a phase in cycles, from a table.
const TABLE = Float32Array.from({ length: 4097 }, (_, i) => Math.sin(2 * Math.PI * i / 4096))
const sine = phase => { const x = (phase - Math.floor(phase)) * 4096, i = x | 0; return TABLE[i] + (x - i) * (TABLE[i + 1] - TABLE[i]) }
// Band-limited saw and pulse: the naive waves with each jump smoothed by a polynomial step (PolyBLEP), the pulse
// centered on zero. t is the phase in cycles, dt the phase step per sample.
const blep = (t, dt) => t < dt ? (t /= dt, 2 * t - t * t - 1) : t > 1 - dt ? (t = (t - 1) / dt, t * t + 2 * t + 1) : 0
const saw = (t, dt) => 2 * t - 1 - blep(t, dt)
const pulse = (t, dt, width) => (t < width ? 1 : -1) + 1 - 2 * width + blep(t, dt) - blep((t + 1 - width) % 1, dt)
// Two-pole lowpass for one voice; a is the coefficient for a cutoff.
const lowpass = () => { let y = 0, z = 0; return (x, a) => (y += a * (x - y), z += a * (y - z)) }
const cutoff = f => 1 - Math.exp(-2 * Math.PI * f / RATE)
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

  // Pachelbel, Canon in D (c. 1680): the ground bass on a cello, the first violin's two opening lines, and the second
  // violin entering two bars later with the first line: a canon. Bowed strings: three saws a few cents apart through a
  // lowpass, bowed in, with vibrato once the note is held. [MIDI notes] one per beat.
  canon: { description: 'Pachelbel’s Canon on strings', make: () => {
    const out = stereo(14.4), beat = .66, start = .4
    const bow = (at, seconds, note, level, bright, pan) => {
      const dt = mtof(note) / RATE, lp = lowpass(), a = cutoff(bright), fall = decay(.09)
      let p = 0, q = .33, r = .67, release = 1
      play(out, at, seconds + .35, s => {
        const vibrato = 1 + .0035 * sine(5.5 * s) * (s < .15 ? 0 : s < .45 ? (s - .15) / .3 : 1), d = dt * vibrato
        if ((p += d) >= 1) p--
        if ((q += d * 1.0023) >= 1) q--
        if ((r += d * .9977) >= 1) r--
        if (s > seconds) release *= fall
        return level * (s < .09 ? s / .09 : 1) * release * lp(saw(p, d) + saw(q, d) + saw(r, d), a)
      }, pan)
    }
    const bass = [50, 45, 47, 42, 43, 38, 43, 45], first = [78, 76, 74, 73, 71, 69, 71, 73], second = [74, 73, 71, 69, 67, 66, 67, 64]
    ;[...bass, ...bass].forEach((note, n) => bow(start + n * beat, beat, note, .2, 900, -.3))
    ;[...first, ...second].forEach((note, n) => bow(start + n * beat, beat, note, .09, 3800, .4))
    first.forEach((note, n) => bow(start + (n + 8) * beat, beat, note, .09, 3800, -.1))
    // The cadence: D major, the violins resolving to F♯4 and D5 over D2 and D3.
    const end = start + 16 * beat
    for (const [note, level, bright, pan] of [[38, .16, 700, -.3], [50, .12, 900, -.3], [66, .09, 3800, .4], [74, .09, 3800, -.1]]) bow(end, 2.2, note, level, bright, pan)
    return finish(hall(out, { room: .88, damp: .25, wet: .45 }), .98, 14.1, 1.2)
  } },

  // Bach, Prelude in C major, BWV 846 (1722), bars 1–4 and a closing chord, on an FM electric piano: a sine modulated
  // at its own frequency, the index falling as the note sounds, and a tine's ping, a modulator 14 times the note, in its
  // first milliseconds. Each bar's five notes, as Bach broke them: 1 2 3 4 5 3 4 5, twice.
  prelude: { description: 'Bach’s Prelude in C, electric piano', make: () => {
    const out = stereo(11.4), step = .14, start = .4
    const key = (at, seconds, note, level) => {
      const dt = mtof(note) / RATE, fades = [decay(.45), decay(.25), decay(.02), decay(1.4 * Math.sqrt(262 / mtof(note))), decay(.07)]
      let p = 0, index = 1, ping = 1, strike = 1, sound = 1, release = 1
      play(out, at, seconds + .3, s => {
        p += dt; index *= fades[0]; ping *= fades[1]; strike *= fades[2]; sound *= fades[3]
        if (s > seconds) release *= fades[4]
        const body = sine(p + (1.1 * index + .12) * sine(p) / (2 * Math.PI)), tine = .3 * ping * sine(p + 2 * strike * sine(14 * p) / (2 * Math.PI))
        return level * (s < .0015 ? s / .0015 : 1) * sound * release * (body + tine)
      }, (note - 66) / 18)
    }
    const bars = [[60, 64, 67, 72, 76], [60, 62, 69, 74, 77], [59, 62, 67, 74, 77], [60, 64, 67, 72, 76]]
    bars.forEach((chord, b) => [0, 1].forEach(half => [0, 1, 2, 3, 4, 2, 3, 4].forEach((v, k) => {
      const at = start + (b * 16 + half * 8 + k) * step
      // The lowest two are held through the half bar; the rest sound as sixteenths, a little legato.
      key(at, v < 2 ? (8 - k) * step : step * 1.3, chord[v], v < 2 ? .16 : .13)
    })))
    const end = start + 64 * step
    for (const note of [36, 48, 64, 67, 72]) key(end, 1.8, note, .15)
    return finish(hall(out, { room: .82, damp: .3, wet: .28 }), 1.19, 11.1, 1)
  } },

  // Bach, Toccata in D minor, BWV 565: the opening call and its answer an octave down, then the pedal's low D under a
  // diminished seventh built up note by note, resolving to D minor. A pipe organ in a church: each pipe a stack of
  // harmonics, the ranks tuned a little apart so they beat, each note speaking with a breathy chiff.
  toccata: { description: 'Bach’s Toccata in D minor, organ', make: () => {
    const out = stereo(13), noise = random(3)
    // The full chorus as [harmonic of the 8' pitch, level, detune]: 16', 8', 4', 2 2/3', 2' and a mixture.
    const ranks = [[.5, .35, 1], [1, 1, 1], [2, .7, 1.0007], [3, .38, .9995], [4, .45, 1.0004], [5, .12, 1], [6, .2, .9996], [8, .22, 1.0006], [10, .06, 1], [12, .1, .9997], [16, .06, 1.0005]]
    const pipe = (at, seconds, note, level, pan = 0) => {
      const f = mtof(note), sounding = ranks.filter(([h, , d]) => f * h * d < RATE / 2)
      const steps = sounding.map(([h, , d]) => f * h * d / RATE), levels = sounding.map(([, a]) => a), phases = sounding.map(() => .5 + .5 * noise())
      const quiet = decay(.02), fall = decay(.05)
      let last = 0, chiff = .3, release = 1
      play(out, at, seconds + .12, s => {
        let x = 0
        for (let k = 0; k < steps.length; k++) x += levels[k] * sine(phases[k] += steps[k])
        const n = noise(), breath = (n - last) * (chiff *= quiet); last = n
        if (s > seconds) release *= fall
        return level * ((s < .035 ? s / .035 : 1) * release * x + breath)
      }, pan)
    }
    // The call: A with a mordent, a run down to C♯ and home to D, in octaves; then the same an octave down.
    const call = (at, octave) => {
      const notes = [[0, 69, .07], [.07, 67, .07], [.14, 69, 1]], run = [67, 65, 64, 62, 61]
      run.forEach((note, n) => notes.push([1.3 + n * .11, note, .11]))
      notes.push([1.3 + 5 * .11, 62, 1.25])
      for (const [t, note, seconds] of notes) { pipe(at + t, seconds, note + octave, .05, .2); pipe(at + t, seconds, note + octave - 12, .05, -.2) }
    }
    call(.3, 0); call(3.4, -12)
    // The pedal's D, then C♯ E G B♭ C♯ E stacked over it, resolving to D minor.
    pipe(6.5, 4.4, 38, .07)
    ;[49, 52, 55, 58, 61, 64].forEach((note, n) => pipe(6.6 + n * .09, 1.9 - n * .09, note, .035, n % 2 ? .3 : -.3))
    ;[50, 53, 57, 62, 65, 69].forEach((note, n) => pipe(8.6, 2.3, note, .035, n % 2 ? .3 : -.3))
    return finish(hall(out, { room: .9, damp: .3, wet: .5 }), 1.95, 12.7, 1.4)
  } },

  // Grieg, In the Hall of the Mountain King (1875), bars 1–4 on an 8-bit console's voices: a 25% pulse for the tune,
  // a triangle for the bass, noise for the drums. Played twice, the second time an octave up with drums, speeding up
  // all the way; a crash on the last chord. [MIDI note, eighths] per bar.
  mountainking: { description: 'Grieg’s Mountain King, 8-bit', make: () => {
    const out = stereo(12.4), noise = random(7)
    const theme = [[59, 1], [61, 1], [62, 1], [64, 1], [66, 1], [62, 1], [66, 2], [65, 1], [61, 1], [65, 2], [64, 1], [60, 1], [64, 2],
      [59, 1], [61, 1], [62, 1], [64, 1], [66, 1], [62, 1], [66, 1], [71, 1], [69, 1], [66, 1], [62, 1], [66, 1], [69, 4]]
    // Eighth k starts at when(k): each eighth a little shorter than the last, .2 s down to .12 s.
    const when = k => .35 + .2 * k - .08 * k * k / 128
    const lead = (at, seconds, note, level, pan = .15) => {
      const f = mtof(note), dt = f / RATE
      let t = 0
      // A held note gains a 6 Hz vibrato, as chiptunes do.
      play(out, at, seconds + .02, s => { t = (t + dt * (1 + .006 * Math.sin(2 * Math.PI * 6 * s) * Math.min(1, s / .15))) % 1; return level * pulse(t, dt, .25) * Math.min(1, s / .003, (seconds + .02 - s) / .02) }, pan)
    }
    const bass = (at, seconds, note) => {
      const f = mtof(note)
      play(out, at, seconds, s => .3 * (2 * Math.abs(2 * ((f * s) % 1) - 1) - 1) * Math.min(1, s / .002, (seconds - s) / .01))
    }
    const kick = at => { let phase = 0; play(out, at, .18, s => (phase += (45 + 110 * Math.exp(-s / .03)) / RATE, .45 * Math.sin(2 * Math.PI * phase) * Math.exp(-s / .07))) }
    const snare = at => { let low = 0; play(out, at, .15, s => { const x = noise(); low += .15 * (x - low); return (.16 * (x - low) + .1 * Math.sin(2 * Math.PI * 190 * s) * Math.exp(-s / .03)) * Math.exp(-s / .05) }) }
    const hat = (at, level = .05) => { let last = 0; play(out, at, .05, s => { const x = noise(), y = x - last; last = x; return level * y * Math.exp(-s / .012) }, -.3) }
    for (const pass of [0, 1]) {
      let k = pass * 32
      for (const [note, eighths] of theme) {
        const at = when(k), seconds = (when(k + eighths) - at) * (eighths > 1 ? .75 : .55)
        lead(at, seconds, note + 12 * pass, pass ? .13 : .16)
        k += eighths
      }
      for (let beat = 0; beat < 16; beat++) {
        const k = pass * 32 + beat * 2, at = when(k), low = beat >= 12 ? 54 : 59
        bass(at, (when(k + 1) - at) * .7, low - 12); bass(when(k + 1), (when(k + 2) - when(k + 1)) * .7, low)
        if (pass) { if (beat % 2) snare(at); else kick(at); hat(at); hat(when(k + 1), .03) }
      }
    }
    // The last chord: B minor over the bass, with a crash.
    const end = when(64)
    bass(end, .6, 47); lead(end, .5, 71, .1); lead(end, .5, 74, .07, -.2); lead(end, .5, 78, .07, .4); kick(end)
    let last = 0
    play(out, end, 1.4, s => { const x = noise(), y = x - last; last = x; return .09 * y * Math.exp(-s / .35) }, .2)
    return finish(hall(out, { room: .7, damp: .3, wet: .12 }), .94, 12.1, .4)
  } },
}
