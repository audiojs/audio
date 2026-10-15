// Align's drift (fn/align.js): a part played at another tempo, or a copy on a clock running apart, against the original,
// the rate and lag found against the ones that made it.
//
//   node bench/align.mjs
//
// Parts: a Divide and Remaster v3 test clip (Watcharasupat, Wu, Orife 2024; CC BY-SA 4.0; 60 s, 48 kHz, DATA/dnr-v3/
// test/000004), each stem stretched (fn/stretch.js, pitch kept), lowpassed at 5 kHz and delayed, against the mixture;
// three MDB-stem-synth songs (Salamon, Bittner, Bonada, Bosch, Gómez, Bello 2017; CC BY-NC-SA 4.0; 171 to 218 s,
// 44.1 kHz, DATA/mdb-stem-synth), each stretched or sped (sinc), highpassed at 200 Hz and delayed, against itself.
// Copies: the mixture read 20 and 50 ppm off (speed, sinc) and delayed. Each case prints the error at a's start and end:
// where its samples land against where they belong, ms (copies: samples).
import { readdirSync } from 'fs'
import { homedir } from 'os'
import audio from '../audio.js'
import { drift } from '../fn/align.js'

const DATA = process.env.DATA || `${homedir()}/.cache/audiojs/data`
const mono = async a => { let c = await a.read(); return Float64Array.from(c[0], (v, i) => c.length > 1 ? (v + c[1][i]) / 2 : v) }

// a[τ] ≈ r[ρτ − b]: a made by stretching (or slowing) r by k and putting `pad` s before it: ρ = 1/k, b = pad·sr/k
function report(name, x, r, sr, k, pad, unit = 'ms') {
  let t = performance.now(), d = drift(x, r, sr), ms = performance.now() - t, rho = 1 / k, b = pad * sr / k
  let to = v => unit === 'ms' ? `${(v / sr * 1000).toFixed(1)} ms` : `${v.toFixed(1)} samples`
  // where a's first and last samples land, against where they belong: t = ρτ − b
  let err = d ? [0, x.length].map(t => (d.rho * t - d.b) - (rho * t - b)) : null
  console.log(`${name.padEnd(40)} ×${+k.toFixed(6)}`.padEnd(52), d ? `ρ ${d.rho.toFixed(7)} (${rho.toFixed(7)}) start ${to(err[0])}, end ${to(err[1])}${d.shared ? ', a copy' : ''}` : 'no drift found', `· ${(ms / 1000).toFixed(1)} s`)
}

const dnr = `${DATA}/dnr-v3/test/000004/`, mix = await audio(dnr + 'mixture.flac'), sr = mix.sampleRate, r = await mono(mix)
for (let [stem, k, pad] of [['music', 1.03, 1.3], ['music', 1.0002, 0.5], ['speech', 0.98, 0], ['sfx', 1.06, 0.2], ['mixture', 1.005, 2], ['music', 1, 0.7], ['mixture', 1, 0.3]])
  report(`dnr ${stem}`, await mono((await audio(dnr + stem + '.flac')).stretch(k).lowpass(5000).pad(pad, 0)), r, sr, k, pad)
for (let [k, pad] of [[1 / 1.00005, 0.25], [1 / 0.99998, 1.1]])
  report('dnr mixture, a copy', await mono((await audio(dnr + 'mixture.flac')).speed(1 / k, { type: 'sinc' }).pad(pad, 0)), r, sr, k, pad, 'samples')

const mdb = `${DATA}/mdb-stem-synth/MDB-stem-synth/audio_stems/`
for (let f of readdirSync(mdb).slice(0, 3)) {
  let ref = await audio(mdb + f), r = await mono(ref), sr = ref.sampleRate
  for (let [k, pad, how] of [[1.02, 0.8, 'stretch'], [0.9995, 0.1, 'stretch'], [1.0001, 0.4, 'speed'], [1, 0.4, 'speed']]) {
    let a = await audio(mdb + f)
    report(`mdb ${f.replace('.RESYN.wav', '')} ${how}`, await mono((how === 'speed' ? a.speed(1 / k, { type: 'sinc' }) : a.stretch(k)).highpass(200).pad(pad, 0)), r, sr, k, pad)
  }
}
