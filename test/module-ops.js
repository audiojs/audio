// Contract audio-modules as audio ops — audio.use(module) → toOp integration.
// Pilots: @audio/dynamics-compressor (dynamics kernel, live/automated params) and
// @audio/reverb-freeverb (declared tail → composed trailing pad, decay preserved).
// Manifests imported by path (unpublished scope); their deps resolve via their own repos.

import test, { ok, almost, is } from 'tst'
import audio from '../audio.js'
import { compressor } from '../../@audio/dynamics/packages/dynamics-compressor/audio-module.js'
import { freeverb } from '../../@audio/reverb/packages/reverb-freeverb/audio-module.js'

audio.use(compressor, freeverb)

const SR = 44100

function tone(freq, dur, amp = 0.8, sr = SR) {
  let n = Math.round(dur * sr), ch = new Float32Array(n)
  for (let i = 0; i < n; i++) ch[i] = amp * Math.sin(2 * Math.PI * freq * i / sr)
  return ch
}
function rms(d, from = 0, to = d.length) {
  let s = 0
  for (let i = from; i < to; i++) s += d[i] * d[i]
  return Math.sqrt(s / (to - from))
}

test('use(module) registers an op; compressor reduces hot material', async () => {
  ok(typeof audio.fn.compressor === 'function', 'method registered')
  let a = audio.from([tone(440, 1)], { sampleRate: SR })
  let dry = (await audio.from([tone(440, 1)], { sampleRate: SR }).read())[0]
  let wet = (await a.compressor({ threshold: -24, ratio: 6 }).read())[0]
  ok(rms(wet, SR / 2) < rms(dry, SR / 2) * 0.8, `compressed (${(20 * Math.log10(rms(wet, SR / 2) / rms(dry, SR / 2))).toFixed(1)} dB)`)
  ok(wet.every(isFinite))
})

test('module op params flow through engine automation (fn param ≡ static param)', async () => {
  let stat = (await audio.from([tone(440, 1)], { sampleRate: SR }).compressor({ threshold: -24, ratio: 6 }).read())[0]
  let auto = (await audio.from([tone(440, 1)], { sampleRate: SR }).compressor({ threshold: () => -24, ratio: 6 }).read())[0]
  let diff = 0
  for (let i = 0; i < stat.length; i++) diff = Math.max(diff, Math.abs(stat[i] - auto[i]))
  ok(diff < 1e-6, `automated ≡ static (${diff.toExponential(1)})`)

  // ramp: threshold drops mid-signal → later material more compressed
  let ramp = (await audio.from([tone(440, 2)], { sampleRate: SR }).compressor({ threshold: t => t < 1 ? 0 : -30, ratio: 8 }).read())[0]
  ok(rms(ramp, Math.round(1.5 * SR)) < rms(ramp, Math.round(0.25 * SR), Math.round(0.75 * SR)) * 0.7, 'automation engages mid-stream')
})

test('declared tail composes a trailing pad — freeverb decay is not truncated', async () => {
  let a = audio.from([tone(440, 0.5)], { sampleRate: SR })
  let dur0 = a.duration
  a.freeverb({ room: 0.8, mix: 1 })
  almost(a.duration, dur0 + 6, 0.05, `duration extended by tail (${a.duration.toFixed(2)}s)`)
  let out = (await a.read())[0]
  let tailRms = rms(out, Math.round(0.7 * SR), Math.round(1.5 * SR))
  ok(tailRms > 1e-4, `reverb rings past the source (${tailRms.toExponential(1)})`)
  ok(out.every(isFinite))
})

test('op introspection carries module param metadata (CLI help substrate)', () => {
  let d = audio.op('compressor')
  is(d.module.params.threshold.min, -60)
  is(d.module.params.threshold.unit, 'dB')
  ok(d.params.includes('ratio'))
  is(audio.op('freeverb').tail, 6)
})
