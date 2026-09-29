// Frequency axes: where f sits between lo and hi as 0..1, and back. The spectrogram's rows and the view's labels,
// selections and pitch curve share them.
//   log  equal space per octave, from 20 Hz, the floor of hearing
//   mel  equal space per mel, 2595 · log10(1 + f / 700) (O'Shaughnessy 1987, as in HTK): near linear under 1 kHz
//   lin  equal space per hertz, from 0
const mel = f => 2595 * Math.log10(1 + f / 700), hertz = m => 700 * (10 ** (m / 2595) - 1)
const warp = (to, from) => ({
  at: (f, lo, hi) => (to(f) - to(lo)) / (to(hi) - to(lo)),
  of: (u, lo, hi) => from(to(lo) + u * (to(hi) - to(lo)))
})
// Labels roundest first, a decade apart, then between as room allows: a small lane keeps 20k, 2k, 200, 20
export default {
  log: { text: 'octaves, equal space per doubling', low: 20, ...warp(Math.log2, Math.pow.bind(null, 2)), labels: [20000, 2000, 200, 20, 10000, 1000, 100, 5000, 500, 50] },
  mel: { text: 'mel, spaced as pitch is heard', low: 0, ...warp(mel, hertz), labels: [20000, 2000, 200, 10000, 5000, 1000, 500, 3000] },
  lin: { text: 'hertz, equal space per Hz', low: 0, ...warp(f => f, f => f), labels: [20000, 10000, 5000, 15000] }
}
