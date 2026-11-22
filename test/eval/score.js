// A sound made from a score, and the same score rendered slower, faster, higher or lower: the true stretched or shifted
// sound, which no recording has. Every sample is a function of the score and a seed, so a stretcher's or a shifter's
// take can be read against what it should have made (twof, or any measure that takes a reference).
//
// What "stretched by r" means here, as a recording's stretch means it: every partial's level and pitch at source time t
// are heard at r·t (a vibrato slows with the sound); each note's attack and the noise of its onset keep their own
// length, as a transient kept sharp does. "Shifted by s semitones": every partial at 2^(s/12) of its frequency, at the
// level it had (the spectrum's shape moves with the pitch), or, with `formants: 'keep'`, at the level the voice's
// envelope gives its new frequency (the shape stays, as a formant-keeping shift leaves it).
const PI2 = 2 * Math.PI

// mulberry32: 32 bits of state, the same sequence in every engine
export function rng(seed) {
  let a = seed >>> 0
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
}

/**
 * Render a score: { notes: [{ at, dur, f, amp }] (s, Hz), partials, rolloff (each partial's level over the one under
 * it), attack (s), decay (s to 1/e; Infinity: held), release (s), vibrato: { cents, hz }, burst (the onset's noise,
 * of the note's level), envelope: f => level (a voice's formants; replaces rolloff), pulse (every partial starts at
 * its crest, as a glottal pulse's do: the waveform a voice has, which a pitch-synchronous method looks for) }.
 * `stretch` r, `shift` s semitones, `formants`: 'move' or 'keep'; `phases`: the seed of the partials' starting phases
 * (another seed: the same sound to a listener, another waveform).
 */
export function render(score, fs, { stretch: r = 1, shift = 0, formants = 'move', phases = 1 } = {}) {
  let { notes, partials = 10, rolloff = 0.7, attack = 0.008, decay = Infinity, release = 0.02, vibrato, burst = 0, envelope, pulse } = score
  let ratio = 2 ** (shift / 12), end = Math.max(...notes.map(n => n.at + n.dur)), x = new Float32Array(Math.round((end + 0.25) * fs * r))
  let ph = rng(phases), noise = rng(77)
  for (let { at, dur, f, amp } of notes) {
    let i0 = Math.round(at * r * fs), n = Math.round(dur * r * fs), R = Math.round(release * fs), phase = Array.from({ length: partials }, () => pulse && phases === 1 ? ph() * 0 + Math.PI / 2 : PI2 * ph())
    // the onset's noise: the same samples whatever the stretch
    let B = Math.round(0.03 * fs), b = Float32Array.from({ length: B }, (_, i) => burst * amp * (noise() * 2 - 1) * Math.exp(-i / (0.004 * fs)))
    for (let i = 0; i < n && i0 + i < x.length; i++) {
      let t = i / fs, tau = t / r                                       // real time since the onset, and the score's
      let cents = vibrato ? vibrato.cents * Math.min(1, tau / 0.1) * Math.sin(PI2 * vibrato.hz * tau) : 0, fi = f * 2 ** (cents / 1200)
      let env = Math.min(1, t / attack) * Math.exp(-tau / decay) * Math.min(1, (n - i) / R), v = 0
      for (let k = 1; k <= partials; k++) {
        let fk = k * fi * ratio
        if (fk > 0.45 * fs) break
        let g = envelope ? envelope(formants === 'keep' ? fk : k * fi) : rolloff ** (k - 1)
        v += g * Math.sin(phase[k - 1])
        phase[k - 1] += PI2 * fk / fs
      }
      x[i0 + i] += amp * env * v + (i < B ? b[i] : 0)
    }
  }
  return x
}

// a voice's envelope: three formants (an open vowel's, about 700, 1200 and 2600 Hz) over a 12 dB an octave fall
const vowel = f => (1 / (1 + (f / 500) ** 2)) + 1.2 * Math.exp(-(((f - 700) / 130) ** 2)) + 0.8 * Math.exp(-(((f - 1200) / 160) ** 2)) + 0.35 * Math.exp(-(((f - 2600) / 250) ** 2))
const hz = semis => 220 * 2 ** (semis / 12)

/** The scores a stretcher and a shifter are read on */
export const SCORES = {
  // a tune: eight held notes with vibrato, each running into the next
  melody: { notes: [0, 4, 7, 5, 9, 7, 2, 0].map((s, k) => ({ at: 0.1 + 0.3 * k, dur: 0.33, f: hz(s), amp: 0.12 })), vibrato: { cents: 30, hz: 5.5 }, partials: 10, rolloff: 0.7 },
  // two chords of three notes, held: many partials sounding at once
  chord: { notes: [[0, 4, 7], [-3, 0, 5]].flatMap((c, k) => c.map(s => ({ at: 0.1 + 1.2 * k, dur: 1.2, f: hz(s), amp: 0.07 }))), partials: 8, rolloff: 0.6 },
  // plucked notes: a sharp onset with its noise, then the note dying away
  plucks: { notes: [0, 7, 4, 12, 5, 9, 2, 7].map((s, k) => ({ at: 0.1 + 0.3 * k, dur: 0.6, f: hz(s), amp: 0.2 })), decay: 0.12, attack: 0.002, burst: 0.5, partials: 12, rolloff: 0.75 },
  // a voice singing the tune: the melody's notes an octave down under a vowel's formants
  voice: { notes: [0, 4, 7, 5, 9, 7, 2, 0].map((s, k) => ({ at: 0.1 + 0.3 * k, dur: 0.33, f: hz(s - 12), amp: 0.1 })), vibrato: { cents: 40, hz: 5.5 }, partials: 30, envelope: vowel, pulse: true },
}

const rms = (x, a = 0, b = x.length) => { let s = 0; for (let i = a; i < b; i++) s += x[i] * x[i]; return Math.sqrt(s / Math.max(1, b - a)) }
// a sound's level every millisecond over 5 ms
function levels(x, fs) { let h = Math.round(fs / 1000), w = 5 * h, e = new Float32Array(Math.floor((x.length - w) / h)); for (let k = 0; k < e.length; k++) e[k] = rms(x, k * h, k * h + w); return e }

/**
 * A take against its reference, ready for a measure of two aligned signals: the take moved by the lag (within ±60 ms)
 * at which the two sounds' levels over time agree best (their waveforms need not: a stretcher owes no partial its
 * phase), cut to the reference's length and brought to its level. → { ref, out, lag (ms: the take late), level (dB:
 * the take over the reference, before it was matched) }
 */
export function aligned(ref, take, fs) {
  let a = levels(ref, fs), b = levels(take, fs), best = -Infinity, lag = 0
  for (let d = -60; d <= 60; d++) {
    let s = 0, na = 0, nb = 0
    for (let k = 0; k < a.length; k++) { let j = k + d; if (j < 0 || j >= b.length) continue; s += a[k] * b[j]; na += a[k] * a[k]; nb += b[j] * b[j] }
    let c = s / Math.sqrt(na * nb || 1)
    if (c > best) { best = c; lag = d }
  }
  let d = Math.round(lag * fs / 1000), out = new Float32Array(ref.length)
  for (let i = 0; i < out.length; i++) out[i] = take[i + d] ?? 0
  let g = rms(ref) / (rms(out) || 1)
  return { ref, out: out.map(v => v * g), lag, level: -20 * Math.log10(g) }
}
