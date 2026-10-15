// vocos(): a voice made again by Vocos through the optional @audio/neural-vocode, the input kept above the crossover.
// The package's own tests hold it to PyTorch's Vocos; here, what the op adds: the crossover, the options, its errors.
// The model is read from the neural cache (the package's scripts/export.py) until it is hosted; without it, skipped.
import test, { ok, is } from 'tst'
import { existsSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import { fileURLToPath } from 'url'
import { fft } from 'fourier-transform'
import audio from '../audio.js'

const lena = fileURLToPath(new URL('../node_modules/audio-lena/lena.wav', import.meta.url))
const WEIGHTS = join(process.env.AUDIO_NEURAL_CACHE || join(homedir(), '.cache', 'audiojs', 'neural'), 'vocos', 'vocos.fp16.onnx')
const vocode = await import('@audio/neural-vocode').catch(() => null)
const model = vocode && existsSync(WEIGHTS) ? test : test.skip
const db = v => 10 * Math.log10(v)

// energy of x above f Hz: its Hann-windowed frames' bins there, summed
function above(x, sr, f) {
  let n = 4096, w = Float64Array.from({ length: n }, (_, i) => 0.5 - 0.5 * Math.cos(2 * Math.PI * i / n)), frame = new Float64Array(n), s = 0
  for (let at = 0; at + n <= x.length; at += n / 2) {
    for (let i = 0; i < n; i++) frame[i] = x[at + i] * w[i]
    let [re, im] = fft(frame)
    for (let k = Math.ceil(f * n / sr); k <= n / 2; k++) s += re[k] ** 2 + im[k] ** 2
  }
  return s
}

model('vocos: Vocos\'s take below the crossover, the input above; 0 takes Vocos\'s alone', { timeout: 120000 }, async () => {
  // a voice, band-limited to 11 kHz, with partials planted above: 14, 15.5 and 17 kHz, 40 dB under its peak
  let a = await audio(lena), sr = a.sampleRate, x = (await a.read({ duration: 4 }))[0]
  x = x.map((v, i) => v + [14000, 15500, 17000].reduce((s, f) => s + 0.003 * Math.sin(2 * Math.PI * f * i / sr), 0))
  let alone = (await audio.from([x], { sampleRate: sr }).vocos({ crossover: 0, weights: WEIGHTS }).read())[0]
  let kept = (await audio.from([x], { sampleRate: sr }).vocos({ weights: WEIGHTS }).read())[0]
  is(kept.length, x.length, 'as long as the input')
  let want = await vocode.default(x, { sampleRate: sr, weights: WEIGHTS }), same = true
  for (let i = 0; i < x.length; i++) if (alone[i] !== want[i]) { same = false; break }
  ok(same, 'crossover 0: the package\'s output as it is')
  let [hx, ha, hk] = [x, alone, kept].map(v => above(v, sr, 13000))
  ok(db(ha / hx) < -30, `Vocos alone: ${db(ha / hx).toFixed(1)} dB of the input's energy above 13 kHz`)
  ok(Math.abs(db(hk / hx)) < 1, `the input kept above: ${db(hk / hx).toFixed(2)} dB of it there`)
})

test('vocos: a crossover past 12 kHz, where Vocos makes nothing, is refused', async () => {
  let threw = null
  try { await audio.from([new Float32Array(4410)], { sampleRate: 44100 }).vocos({ crossover: 20000 }).read() } catch (e) { threw = e }
  ok(/crossover is Hz, 0 to 12000/.test(threw?.message), threw?.message)
})
