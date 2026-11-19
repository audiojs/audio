// The eval's measures: each reads a take (the input or what an edit made of it) against what its case knows (the clean
// voice, where the voice is, the parts it was made of) and gives one number. `better`: which way a reading improves.
// Every one is plain arithmetic on the samples here, but `silenced` and `under`, which are compare()'s voice figures
// (fn/compare.js), so the eval reads a voice as the library's compare() tells it to a user.
import audio from '../../audio.js'
import { power, active } from './sounds.js'

const db = p => 10 * Math.log10(p)
const dot = (a, b, i0 = 0, i1 = a.length) => { let s = 0; for (let i = i0; i < i1; i++) s += a[i] * b[i]; return s }
// the power of y's line at f Hz over [i, j): its projection on a sine and a cosine there
const line = (y, f, fs, i, j) => { let c = 0, s = 0, w = 2 * Math.PI * f / fs; for (let k = i; k < j; k++) { c += y[k] * Math.cos(w * k); s += y[k] * Math.sin(w * k) } return 2 * (c * c + s * s) / (j - i) ** 2 }

export const MEASURES = {
  // SI-SDR (Le Roux, Wisdom, Erdogan, Hershey, "SDR – half-baked or well done?", ICASSP 2019, eq. 2): the clean voice
  // scaled to its projection on the take, over what is left, dB
  sisdr: { better: 'up', unit: 'dB', of: (y, { s }) => { let g = dot(y, s) / dot(s, s), e = 0; for (let i = 0; i < s.length; i++) e += (y[i] - g * s[i]) ** 2; return db(g * g * dot(s, s) / e) } },
  // the bed in the pauses: the voice's active level over the take's mean power in the 20 ms frames 0.3 s or more from
  // any phrase (where a denoiser's choice near the voice no longer reaches), dB
  bed: { better: 'up', unit: 'dB', of: (y, { s, on, fs }) => {
    let F = Math.round(0.02 * fs), R = Math.round(0.3 * fs), near = new Uint8Array(on.length), p = 0, n = 0
    for (let i = 0; i < on.length; i++) if (on[i]) near.fill(1, Math.max(0, i - R), Math.min(on.length, i + R))
    for (let i = 0; i + F <= y.length; i += F) if (!near.subarray(i, i + F).includes(1)) { p += power(y, i, i + F); n++ }
    return db(active(s, fs)) - db(p / n)
  } },
  // the voice lost: the share of the clean voice's 20 ms frames (those within 30 dB of its loudest, as active() takes
  // them) whose projection on the take holds 10 dB less of the clean frame than the whole take's projection holds of
  // the whole (a frame heard half as loud: S. S. Stevens, JASA 27, 1955, as compare() takes its 10 dB), %
  lost: { better: 'down', unit: '%', of: (y, { s, fs }) => {
    let F = Math.round(0.02 * fs), G = dot(y, s) / dot(s, s), e = [], n = 0, out = 0
    for (let i = 0; i + F <= s.length; i += F) e.push(power(s, i, i + F))
    let top = Math.max(...e)
    for (let k = 0; k < e.length; k++) if (e[k] >= top * 1e-3) { let i = k * F, g = dot(y, s, i, i + F) / dot(s, s, i, i + F); n++; if (g * g < 0.1 * G * G) out++ }
    return 100 * out / n
  } },
  // noise alone: what is left of it, the take's power over the input's, dB
  left: { better: 'down', unit: 'dB', of: (y, { x }) => db(power(y)) - db(power(x)) },
  // compare()'s voice (fn/compare.js): of the input's voiced frames, the share whose level now stands 10 dB or more
  // under the median change (under), and the share that stood 10 dB over the input's noise floor and now stands under
  // it, the floor moved by the loudness change (silenced), %
  under: { better: 'down', unit: '%', of: async (y, c) => 100 * ((await voice(y, c))?.under ?? NaN) },
  silenced: { better: 'down', unit: '%', of: async (y, c) => 100 * ((await voice(y, c))?.silenced ?? NaN) },
  // a part's level against the same part of the input, its size: dB, |after − before| over [a, b) s (the case's `span`)
  level: { better: 'down', unit: 'dB', of: (y, { x, fs, span: [a, b] }) => { let i = Math.round(a * fs), j = Math.round(b * fs); return Math.abs(db(power(y, i, j)) - db(power(x, i, j))) } },
  // a shifted tone: the take's power at the frequency asked (the tone's own times the shift's ratio) over the tone's
  // middle half, against the input's power at the tone's own frequency there, its size, dB. A tone gone, a tone left
  // where it was, and noise at the tone's level in its place all read far from 0, where the span's level reads the
  // last as kept
  tone: { better: 'down', unit: 'dB', of: (y, { x, fs, span: [a, b], f, ratio }) => { let i = Math.round(a * fs), j = Math.round(b * fs); return Math.abs(db(line(y, f * ratio, fs, i, j)) - db(line(x, f, fs, i, j))) } },
  // a tone's onset: the take's loudest sample within 4096 frames of where the tone starts (the shift family's
  // scripts/ends.js) over the input tone's peak, dB
  onset: { better: 'down', unit: 'dB', of: (y, { x, fs, onset }) => {
    let i = Math.round(onset * fs), j = i + 4096, m = 0, p = 0
    for (let k = i; k < j; k++) m = Math.max(m, Math.abs(y[k]))
    for (let v of x) p = Math.max(p, Math.abs(v))
    return 20 * Math.log10(m / p)
  } },
  // two channels' balance: |the right's level change − the left's|, each over its own input, whole, dB
  balance: { better: 'down', unit: 'dB', channels: true, of: ([l, r], { x: [xl, xr] }) => Math.abs((db(power(r)) - db(power(xr))) - (db(power(l)) - db(power(xl)))) },
  // denoisers a plan puts on a take that holds no noise: the stages of the chain's plan (the `chain` stat) whose name
  // is denoise
  denoisers: { better: 'down', unit: '', plan: true, of: recipe => recipe.stages.filter(s => s.name === 'denoise').length },
}

// compare()'s voice of the take against the input, by the library's own compare (this checkout's), read once a take
const seen = new WeakMap()
async function voice(y, { x, fs }) {
  if (!seen.has(y)) seen.set(y, audio.from([y], { sampleRate: fs }).compare(audio.from([x], { sampleRate: fs })).then(c => c.voice))
  return seen.get(y)
}

/** A measure's reading of `y`; of the input, where the rule compares with it (`x` read through the same measure) */
export async function read(name, y, ctx) {
  let m = MEASURES[name]
  if (!m) throw new Error(`eval: no measure ${name}`)
  let v = await m.of(m.channels || m.plan ? y : y[0], ctx)
  return Number.isNaN(v) ? null : v
}
