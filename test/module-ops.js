// Contract audio-modules as audio ops — audio.use(module) hosts the contract natively.
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

test('tail op is undo-atomic and serializes as one edit', async () => {
  let a = audio.from([tone(440, 0.5)], { sampleRate: SR })
  let dur0 = a.duration
  a.freeverb({ room: 0.8 })
  is(a.edits.length, 1, 'one edit recorded (pad composed at compile)')
  is(a.toJSON().edits.length, 1)
  a.undo()
  is(a.duration, dur0, 'undo removes reverb AND its tail pad')
})

test('audio.use(name) resolves through the registry (dynamic import)', async () => {
  audio.modules ??= {}
  audio.modules.tube = new URL('../../@audio/saturate/packages/saturate-tube/audio-module.js', import.meta.url).href
  await audio.use('tube')
  ok(typeof audio.fn.tube === 'function', 'registry-resolved module registered')
  let out = (await audio.from([tone(440, 0.2)], { sampleRate: SR }).tube({ drive: 8 }).read())[0]
  ok(out.every(isFinite))
  let err = null
  try { audio.use('nosuchmodule') } catch (e) { err = e }
  ok(/unknown module/.test(err?.message), 'unknown name throws')
})

// ── Wave B: dynamics-gate + denoise-dehum ─────────────────────────────

import { gate } from '../../@audio/dynamics/packages/dynamics-gate/audio-module.js'
import { dehum } from '../../@audio/denoise/packages/denoise-dehum/audio-module.js'
audio.use(gate, dehum)

/** Goertzel magnitude at f Hz. */
function energyAt(buf, f, sr = SR) {
  let n = buf.length, w = 2 * Math.PI * f / sr
  let coeff = 2 * Math.cos(w), s1 = 0, s2 = 0
  for (let i = 0; i < n; i++) { let s = buf[i] + coeff * s1 - s2; s2 = s1; s1 = s }
  return Math.sqrt(s1 * s1 + s2 * s2 - coeff * s1 * s2) / n
}

test('gate: passes signal, silences the floor', async () => {
  // 0.5s tone at -6dB, then 0.5s floor at -50dB
  let n = SR, ch = new Float32Array(n)
  for (let i = 0; i < n / 2; i++) ch[i] = 0.5 * Math.sin(2 * Math.PI * 440 * i / SR)
  for (let i = n / 2; i < n; i++) ch[i] = 0.003 * Math.sin(2 * Math.PI * 440 * i / SR)
  let out = (await audio.from([ch], { sampleRate: SR }).gate({ threshold: -40, range: -90 }).read())[0]
  ok(rms(out, SR * 0.1, SR * 0.4) > 0.3, 'signal above threshold passes')
  ok(rms(out, SR * 0.8) < 0.0005, `floor gated (${rms(out, SR * 0.8).toExponential(1)})`)
})

test('dehum: notches mains fundamental + harmonics, preserves program', async () => {
  let n = SR, ch = new Float32Array(n)
  for (let i = 0; i < n; i++) ch[i] = 0.5 * Math.sin(2 * Math.PI * 440 * i / SR)
    + 0.2 * Math.sin(2 * Math.PI * 50 * i / SR) + 0.1 * Math.sin(2 * Math.PI * 150 * i / SR)
  let a = audio.from([ch], { sampleRate: SR })
  let out = (await a.dehum({ freq: 50, harmonics: 4 }).read())[0]
  let mid = out.subarray(SR / 4, (3 * SR) / 4)  // skip filter settle
  let dry = ch.subarray(SR / 4, (3 * SR) / 4)
  ok(energyAt(mid, 50) < energyAt(dry, 50) * 0.1, `50Hz hum removed (${(energyAt(mid, 50) / energyAt(dry, 50)).toFixed(3)}×)`)
  ok(energyAt(mid, 150) < energyAt(dry, 150) * 0.1, '3rd harmonic removed')
  ok(energyAt(mid, 440) > energyAt(dry, 440) * 0.9, 'program at 440Hz preserved')
})
