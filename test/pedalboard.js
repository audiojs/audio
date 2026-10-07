// Pedalboard's built-in effects we lacked: Convolution (an impulse response in the chain, no latency), MP3Compressor
// (VBR quality), GSMFullRateCompressor. Its LadderFilter modes and a true-peak Limiter are their atoms' (plugin-filter,
// plugin-ops); its plugin hosting is plugin-host's.

import test, { ok, is, almost } from 'tst'
import audio from '../audio.js'
import convolve from '@audio/reverb-convolution'

const SR = 48000
let seed = 1
const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647 * 2 - 1
const decay = (n, tau, f = 1 / 3) => Float32Array.from({ length: n }, (_, i) => Math.exp(-i / tau) * Math.sin(i * f))

test('convolve: an impulse comes back as the IR, from its sample, its decay rendered past the end', async () => {
  let x = new Float32Array(SR); x[1000] = 1; x[30000] = 0.5
  let ir = decay(4800, 500)
  let a = audio.from([x, x], { sampleRate: SR }).convolve(ir)
  let y = await a.read()
  is(y[0].length, SR + ir.length - 1, 'the input and the IR less one: the whole convolution')
  let err = 0
  for (let i = 0; i < ir.length; i++) err = Math.max(err, Math.abs(y[0][1000 + i] - ir[i]), Math.abs(y[1][30000 + i] - 0.5 * ir[i]))
  ok(err < 1e-7, `no latency, each channel (${err.toExponential(1)})`)
  is((await audio.from([x], { sampleRate: SR }).convolve(ir, { tail: false }).read())[0].length, SR, 'tail: false, none')
})

test('convolve: as the direct form convolves, through the engine\'s blocks', async () => {
  // a 1.5 s IR reaches every partition of the convolver (head, 128, 1024, 8192); the reference is the direct form
  let x = Float32Array.from({ length: SR * 2 }, rnd), ir = Float32Array.from(decay(SR * 1.5, SR / 4), v => v * rnd())
  let ref = Float32Array.from(x)
  convolve(ref, { ir: ir.subarray(0, 20000), method: 'direct' })
  let y = (await audio.from([x], { sampleRate: SR }).convolve(ir.subarray(0, 20000), { tail: false }).read())[0]
  let err = 0, top = 0
  for (let i = 0; i < x.length; i++) { err = Math.max(err, Math.abs(y[i] - ref[i])); top = Math.max(top, Math.abs(ref[i])) }
  ok(err / top < 1e-6, `${(err / top).toExponential(1)} of the peak`)
  // a read from mid-timeline hears what the IR reaches back over (its warm-up)
  let whole = await audio.from([x], { sampleRate: SR }).convolve(ir).read()
  let part = await audio.from([x], { sampleRate: SR }).convolve(ir).read({ at: 1.2, duration: 0.1 })
  let e = 0
  for (let i = 0; i < part[0].length; i++) e = Math.max(e, Math.abs(part[0][i] - whole[0][Math.round(1.2 * SR) + i]))
  ok(e < 1e-6, `from 1.2 s, as the whole read (${e.toExponential(1)})`)
})

test('convolve: mix, a normalized IR, an IR at another rate, its channels wrapping, from JSON', async () => {
  let x = new Float32Array(SR / 2); x[100] = 1
  let ir = decay(2000, 300)
  let m = (await audio.from([x], { sampleRate: SR }).convolve(ir, 0.25).read())[0]
  almost(m[100], 0.75 + 0.25 * ir[0], 1e-6, 'a quarter wet, three quarters dry')
  almost(m[150], 0.25 * ir[50], 1e-6, 'wet alone after the impulse')
  let e = ir.reduce((s, v) => s + v * v, 0)
  let n = (await audio.from([x], { sampleRate: SR }).convolve(ir, { normalize: true }).read())[0]
  almost(n.reduce((s, v) => s + v * v, 0), 1, 1e-5, `unit energy (the IR's own ${e.toFixed(1)})`)
  // a delta at 44.1 kHz lands at 48 kHz as a delta: the sinc's kernel, peak 1 where it was
  let delta = audio.from([Float32Array.from({ length: 441 }, (_, i) => +(i === 0))], { sampleRate: 44100 })
  let r = (await audio.from([x], { sampleRate: SR }).convolve(delta).read())[0]
  is(r.length, x.length + 479, 'its length at 48 kHz')
  almost(r[100], 1, 1e-3, 'the impulse, at its place')
  // a stereo IR: left through the left, right through the right; a mono sound through its left alone
  let lr = [ir, Float32Array.from(ir, v => -v)]
  let s = await audio.from([x, x], { sampleRate: SR }).convolve(lr).read()
  almost(s[0][150] + s[1][150], 0, 1e-7, 'each channel its own')
  almost((await audio.from([x], { sampleRate: SR }).convolve(lr).read())[0][150], ir[50], 1e-7, 'mono: the left')
  let a = audio.from([x], { sampleRate: SR }).convolve(ir, { mix: 0.3 })
  is(a.duration, x.length / SR, 'planned before the IR is read: no tail yet')
  let [[type, o]] = JSON.parse(JSON.stringify(a)).edits
  let b = audio.from([x], { sampleRate: SR })[type](o.ir, o)
  almost((await b.read())[0][150], (await a.read())[0][150], 1e-7, 'the same from its JSON')
  is(a.duration, (x.length + ir.length - 1) / SR, 'once it is read, the plan compiles again: the tail is there')
  let empty = await audio.from([x], { sampleRate: SR }).convolve(new Float32Array(0)).read().catch(e => e)
  ok(/impulse response is needed/.test(empty.message), 'an empty IR: an error')
  let one = (await audio.from([x], { sampleRate: SR }).convolve([0.5]).read())[0]
  is(one.length, x.length, 'a one-sample IR: no tail')
  almost(one[100], 0.5, 1e-7, 'numbers as one channel: a gain')
})

// ── codecs ────────────────────────────────────────────────────────────────

import encodeGsm from '@audio/encode-gsm'
import decodeGsm from '@audio/decode-gsm'
import { fileURLToPath } from 'node:url'

const lena = fileURLToPath(new URL('../node_modules/audio-lena/lena.wav', import.meta.url))
/** SNR of y against x, dB, over [from, to) */
const snr = (x, y, from = 0, to = x.length) => { let s = 0, e = 0; for (let i = from; i < to; i++) { s += x[i] * x[i]; e += (x[i] - y[i]) ** 2 } return 10 * Math.log10(s / e) }
/** the lag of y behind x where they correlate best, within ±m */
const lagOf = (x, y, m = 64) => { let best = -Infinity, at = 0; for (let l = -m; l <= m; l++) { let c = 0; for (let i = m; i < x.length - m; i++) c += x[i] * y[i + l]; if (c > best) { best = c; at = l } } return at }

test('codec gsm: at 8 kHz, what libgsm makes of it, sample for sample; at 44.1 kHz, a telephone band, in line', { timeout: 60000 }, async () => {
  let v = (await audio(lena)).crop({ at: 1, duration: 3 })
  let x8 = (await v.clone().resample(8000, { type: 'sinc' }).read())[0]
  let y8 = (await audio.from([x8], { sampleRate: 8000 }).codec('gsm').read())[0]
  let e = await encodeGsm({ sampleRate: 8000 }), a = e.encode([x8]), b = e.flush()
  e.free()
  let bytes = new Uint8Array(a.length + b.length); bytes.set(a); bytes.set(b, a.length)
  let ref = (await decodeGsm(bytes)).channelData[0].subarray(0, x8.length)
  is(y8, ref, 'libgsm\'s round trip (its bytes are SoX\'s: @audio/encode-gsm, @audio/decode-gsm)')
  let x = (await v.read())[0], y = (await audio.from([x], { sampleRate: 44100 }).codec('gsm').read())[0]
  is(y.length, x.length, 'as long')
  is(lagOf(x, y), 0, 'in line')
  let s = snr(x, y)
  ok(s > 3 && s < 20, `a lossy speech codec: ${s.toFixed(1)} dB SNR`)
  // above 4 kHz only the resampler's images of what GSM passed (and an unwindowed Goertzel's leakage, about -55 dB here)
  let at = (z, f) => { let w = 2 * Math.PI * f / 44100, c = 2 * Math.cos(w), s1 = 0, s2 = 0; for (let i = 0; i < z.length; i++) { let s0 = z[i] + c * s1 - s2; s2 = s1; s1 = s0 } return Math.hypot(s1 - s2 * Math.cos(w), s2 * Math.sin(w)) }
  let tilt = z => 20 * Math.log10(at(z, 6000) / at(z, 2000))
  ok(tilt(y) < tilt(x) - 20, `a telephone band: 6 kHz ${tilt(y).toFixed(0)} dB under 2 kHz (the input's ${tilt(x).toFixed(0)})`)
})

test('codec mp3: VBR by quality, as LAME\'s -V', { timeout: 60000 }, async () => {
  let x = (await (await audio(lena)).crop({ at: 1, duration: 3 }).read())[0]
  let run = o => audio.from([x], { sampleRate: 44100 }).codec('mp3', o).read().then(r => r[0])
  let best = await run({ quality: 0 }), worst = await run({ quality: 9.5 })
  is(best.length, x.length, 'as long')
  is(lagOf(x, best), 0, 'in line')
  ok(snr(x, best) > snr(x, worst) + 6, `-V 0 ${snr(x, best).toFixed(1)} dB SNR over -V 9.5 ${snr(x, worst).toFixed(1)} dB`)
  let threw = o => { try { audio.from([x], { sampleRate: 44100 }).codec(...o); return false } catch { return true } }
  let bad = async (...o) => { try { await audio.from([x], { sampleRate: 44100 }).codec(...o).read(); return false } catch { return true } }
  ok(await bad('aac', { quality: 2 }), 'quality is MP3\'s')
  ok(await bad('gsm', 64), 'GSM is 13 kbps')
  ok(!threw(['mp3', { quality: 2 }]), 'an edit')
})

// ── live: devices, input monitoring ───────────────────────────────────────

test('devices: the inputs and outputs, each with its id and name', async () => {
  let { input, output } = await audio.devices()
  ok(Array.isArray(input) && Array.isArray(output), `${input.length} in, ${output.length} out`)
  for (let d of [...input, ...output]) ok(typeof d.id === 'string' && typeof d.name === 'string' && typeof d.default === 'boolean', d.name)
})

test('record: monitored through its edits as it comes in, the take kept', { timeout: 10000 }, async () => {
  // the silent backend stands in for an input: real time, nothing captured; the monitor plays its edge, gained
  let take = audio(null, { sampleRate: 48000, channels: 1 }), errors = []
  take.on('error', e => errors.push(e))
  take.gain(-6).record({ backend: 'null', monitor: true })
  await new Promise(r => setTimeout(r, 400))
  take.stop()
  await take
  is(errors.map(e => e.message), [], 'no error')
  ok(take.duration > 0.2 && take.duration < 0.6, `recorded ${take.duration.toFixed(2)} s`)
  let bad = audio(null, { sampleRate: 48000, channels: 1 }), err = new Promise(r => bad.on('error', r))
  bad.record({ device: 'no such input ' + Math.random() })
  let e = await Promise.race([err, new Promise(r => setTimeout(() => r(null), 3000))])
  ok(e?.code === 'ENODEVICE' || (await audio.devices()).input.length === 0, `an unknown input: ${e?.message}`)
})
