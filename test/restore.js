// restore(): a voice back to a studio take through the optional @audio/neural-restore. The package's own tests hold it to
// PyTorch; here, what the op adds: the strength mixing the input back, the length and rate kept, its errors. The model
// is read from the neural cache (the package's scripts/export.py) until it is hosted; without it, skipped.
import test, { ok, is } from 'tst'
import { existsSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import { fileURLToPath } from 'url'
import audio from '../audio.js'

const lena = fileURLToPath(new URL('../node_modules/audio-lena/lena.wav', import.meta.url))
const WEIGHTS = join(process.env.AUDIO_NEURAL_CACHE || join(homedir(), '.cache', 'audiojs', 'neural'), 'restore', 'restore.fp16.onnx')
const pkg = await import('@audio/neural-restore').catch(() => null)
const model = pkg && existsSync(WEIGHTS) ? test : test.skip

model('restore: the package\'s take, as long as the input; strength mixes the input back', { timeout: 120000 }, async () => {
  let a = await audio(lena), sr = a.sampleRate, x = (await a.read({ duration: 3 }))[0]
  let full = (await audio.from([x], { sampleRate: sr }).restore().read())[0]
  let half = (await audio.from([x], { sampleRate: sr }).restore(0.5).read())[0]
  is(full.length, x.length, 'as long as the input, at its rate')
  let want = await pkg.default(x, { sampleRate: sr, weights: WEIGHTS }), same = true, mix = true
  for (let i = 0; i < x.length; i++) {
    if (full[i] !== want[i]) same = false
    if (Math.abs(half[i] - (0.5 * want[i] + 0.5 * x[i])) > 1e-6) mix = false
  }
  ok(same, 'strength 1: the package\'s output as it is')
  ok(mix, 'strength 0.5: half the model\'s, half the input')
})

test('restore: a strength outside 0 to 1 is refused', async () => {
  let threw = null
  try { await audio.from([new Float32Array(4800)], { sampleRate: 48000 }).restore(2).read() } catch (e) { threw = e }
  ok(/strength is 0 to 1/.test(threw?.message), threw?.message)
})
