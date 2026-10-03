// Periodicity against Praat, frame by frame (Node: it reads fn/periodicity.js itself, which a browser test page can't
// load alone); the stats it makes, voicing, hnr and harmonic, are tested through the library in test/index.js
import test from 'tst'
import { fileURLToPath } from 'url'
import lena from 'audio-lena'
import audio from '../audio.js'
import { harmonicity } from '../fn/periodicity.js'
import { tone as genTone, vowel, gauss, pulses as pulseTrain } from './gen.js'
import praat from './praat-harmonicity.js'

const lenaPath = fileURLToPath(lena.url('wav'))

/** x with white Gaussian noise added at `snr` dB under its power. */
const noisy = (x, snr, seed) => {
  let ms = y => y.reduce((s, v) => s + v * v, 0) / y.length, z = gauss(x.length, seed), k = Math.sqrt(ms(x) / ms(z) * 10 ** (-snr / 10))
  return x.map((v, i) => v + k * z[i])
}

// Boersma (1993): r, the normalized autocorrelation's peak with the window's own divided out, is the periodic share of
// the power (eq. 3), HNR 10·log10(r / (1 − r)) (eq. 4). Against Praat itself (test/praat-harmonicity.js says how): each
// frame voiced or not as Praat has it, its HNR to the fixture's 1e-6 dB plus r to 1e-13 (past 100 dB, where 1 − r is
// under 1e-10, 10·log10(r / (1 − r)) magnifies r's last digits by 4.3 / (1 − r)); the mean as Praat's Get mean; a range
// as Praat reads the range with 0.06 s either side. A vowel with white noise at SNR s: r is the vowel's share of the
// power, so HNR = s (eq. 3, 4), measured within 1 dB (Boersma's fig. 5: "within a few dB" from 0 to 40 dB)
test('hnr: Praat\'s To Harmonicity (ac), frame by frame; a vowel in noise at its SNR', async t => {
  let sr = 44100, src = await audio(lenaPath), lena = (await src.read())[0], near = (v, h) => Math.abs(v - h) <= 1e-6 + 4.3e-13 * 10 ** (h / 10)
  let signals = {
    sine: [genTone(220, 1, .5)], pulses: [pulseTrain(103, 1)], stereo: [vowel(140, 1), noisy(vowel(140, 1), 10, 5)], lena: [lena],
    snr0: [noisy(vowel(140, 1), 0, 1)], snr10: [noisy(vowel(140, 1), 10, 2)], snr20: [noisy(vowel(140, 1), 20, 3)], snr30: [noisy(vowel(140, 1), 30, 4)]
  }
  for (let [name, chs] of Object.entries(signals)) {
    let h = harmonicity(chs[0].length, sr, chs.length), { frames, mean } = praat[name]
    h.push(chs)
    let { hnr } = h.done(), off = frames.filter((p, k) => p === -200 ? hnr[k] !== -200 : !near(hnr[k], p)).length
    let got = await audio.from(chs, { sampleRate: sr }).stat('hnr')
    t.ok(hnr.length === frames.length && !off, `${name}: ${frames.length} frames, ${frames.filter(p => p !== -200).length} voiced, ${off} off Praat's`)
    t.ok(near(got, mean), `${name}: ${got.toFixed(6)} dB, Praat's ${mean.toFixed(6)}`)
    if (name.startsWith('snr')) t.almost(got, +name.slice(3), 1, `SNR ${name.slice(3)} dB: HNR ${got.toFixed(2)} dB`)
  }
  let part = await src.stat('hnr', { at: 3, duration: 2 })
  t.ok(near(part, praat.part.mean), `lena 3–5 s: ${part.toFixed(6)} dB, Praat's on what it reads ${praat.part.mean.toFixed(6)}`)
  t.is(await audio.from([new Float32Array(sr)], { sampleRate: sr }).stat('hnr'), null, 'silence: no voiced frame, null')
})
