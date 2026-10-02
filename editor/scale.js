import { scales } from '../assets/gl-spectrogram.js'

// Frequency axes as gl-spectrogram spaces its rows: where f sits between lo and hi as 0..1 (at), and back (of), from the
// axis' floor (low). The view's labels, selections and pitch curve share them.
//   log  equal space per octave, from 20 Hz, the floor of hearing
//   mel  equal space per mel, 2595 · log10(1 + f / 700) (O'Shaughnessy 1987, as in HTK): near linear under 1 kHz
//   erb  equal space per auditory filter, ERB-number 21.4 · log10(1 + 0.00437 f) (Glasberg & Moore 1990)
//   lin  equal space per hertz, from 0
// Labels roundest first, a decade apart, then between as room allows: a small lane keeps 20k, 2k, 200, 20
export default {
  log: { ...scales.log, text: 'octaves, equal space per doubling', labels: [20000, 2000, 200, 20, 10000, 1000, 100, 5000, 500, 50] },
  mel: { ...scales.mel, text: 'mel, spaced as pitch is heard', labels: [20000, 2000, 200, 10000, 5000, 1000, 500, 3000] },
  erb: { ...scales.erb, text: 'ERB, spaced as the ear\'s filters', labels: [20000, 2000, 200, 10000, 5000, 1000, 500, 100] },
  lin: { ...scales.lin, text: 'hertz, equal space per Hz', labels: [20000, 10000, 5000, 15000] }
}
