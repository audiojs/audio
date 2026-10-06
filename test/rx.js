// iZotope RX 12's modules `audio` lacked, each against its ground truth: Wow & Flutter (dewow), Azimuth, Phase,
// Streaming Preview (codec), Deconstruct, Find Similar. The signals are made here, their truth known: delays shifted
// exactly by FFT, a disc's wow written into the phase, events planted at known times in a voice (audio-lena).
import test, { ok, is } from 'tst'
import { readdirSync, existsSync } from 'fs'
import { homedir } from 'os'
import { fileURLToPath } from 'url'
import { cfft, cifft, fft } from 'fourier-transform'
import audio from '../audio.js'
import { measure } from '../fn/azimuth.js'
import { pulses } from './gen.js'

const lena = fileURLToPath(new URL('../node_modules/audio-lena/lena.wav', import.meta.url))
const voice = async (dur = 8) => { let a = await audio(lena); return { x: (await a.read({ duration: dur }))[0], sr: a.sampleRate } }
const db = v => 20 * Math.log10(v)
const energy = (v, a = 0, b = v.length) => { let s = 0; for (let i = a; i < b; i++) s += v[i] * v[i]; return s }
/** How far y is from x, dB under x, over [a, b). */
const residual = (x, y, a = 0, b = x.length) => { let e = 0; for (let i = a; i < b; i++) e += (y[i] - x[i]) ** 2; return 10 * Math.log10(e / energy(x, a, b)) }
/** x delayed by d samples (fractional), exactly: a phase ramp on its spectrum, the signal zero-padded so nothing wraps. */
function shift(x, d) {
  let N = 2 ** Math.ceil(Math.log2(x.length + 4096)), re = new Float64Array(N), im = new Float64Array(N)
  re.set(x)
  cfft(re, im)
  for (let k = 1; k < N; k++) { let f = k <= N / 2 ? k : k - N, a = k === N / 2 ? 0 : -2 * Math.PI * f * d / N, c = Math.cos(a), s = Math.sin(a), r = re[k] * c - im[k] * s; im[k] = re[k] * s + im[k] * c; re[k] = r }
  cifft(re, im)
  return Float32Array.from(re.subarray(0, x.length))
}
/** The lag of y behind x (samples, between samples by a parabola through the correlation's peak). */
function lag(x, y, a = 5000, b = x.length - 5000) {
  let c = [], best = 0
  for (let l = -8; l <= 8; l++) { let s = 0; for (let i = a; i < b; i++) s += x[i] * y[i + l]; c.push(s); if (s > c[best]) best = c.length - 1 }
  let [p, q, r] = [c[best - 1], c[best], c[best + 1]]
  return best - 8 + 0.5 * (p - r) / (p - 2 * q + r)
}
async function* blocks(chs) { for (let i = 0; i < chs[0].length; i += 1024) yield chs.map(c => c.subarray(i, i + 1024)) }

// ── Wow & Flutter ────────────────────────────────────────────────

// A disc turning off-centre at 33⅓ rpm moves every frequency by the same 1 % at 0.56 Hz (@audio/denoise-dewow's README);
// a 1 kHz calibration tone under a 440 Hz note, read in `reference` mode, gives the speed back: the note's pitch, read
// every 50 ms (4096-sample frames, the spectral peak by a parabola), moves 12.5 cents RMS before, under 0.5 after. A
// recording with no wow passes through sample for sample.
test('dewow: a disc\'s wow read from a calibration tone and taken out; a steady recording untouched', { timeout: 60000 }, async () => {
  const sr = 44100, n = sr * 8, rpm = 100 / 3 / 60
  let p1 = 0, p2 = 0, x = new Float32Array(n), clean = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    let s = 1 + 0.01 * Math.sin(2 * Math.PI * rpm * i / sr)
    p1 += 2 * Math.PI * 1000 * s / sr; p2 += 2 * Math.PI * 440 * s / sr
    x[i] = 0.1 * Math.sin(p1) + 0.4 * Math.sin(p2)
    clean[i] = 0.1 * Math.sin(2 * Math.PI * 1000 * i / sr) + 0.4 * Math.sin(2 * Math.PI * 440 * i / sr)
  }
  const cents = y => {
    let N = 4096, w = Float64Array.from({ length: N }, (_, i) => 0.5 - 0.5 * Math.cos(2 * Math.PI * i / N)), c = []
    for (let o = sr; o + N < y.length - sr; o += 2205) {
      let [re, im] = fft(Float64Array.from({ length: N }, (_, i) => y[o + i] * w[i])), m = k => Math.log(Math.hypot(re[k], im[k]))
      let k = Math.round(440 * N / sr)
      for (let j = k - 5; j <= k + 5; j++) if (m(j) > m(k)) k = j
      c.push(1200 * Math.log2((k + 0.5 * (m(k - 1) - m(k + 1)) / (m(k - 1) - 2 * m(k) + m(k + 1))) * sr / N / 440))
    }
    let mean = c.reduce((a, b) => a + b) / c.length
    return Math.sqrt(c.reduce((a, b) => a + (b - mean) ** 2, 0) / c.length)
  }
  let [y] = await audio.from([x], { sampleRate: sr }).dewow({ mode: 'reference', refFreq: 1000 }).read()
  is(y.length, n, 'the length kept')
  ok(cents(x) > 12 && cents(y) < 0.5, `the note's pitch: ${cents(x).toFixed(2)} cents RMS before, ${cents(y).toFixed(2)} after`)
  let [z] = await audio.from([clean], { sampleRate: sr }).dewow().read()
  ok(z.every((v, i) => v === clean[i]), 'no wow: sample for sample')
})

// ── Azimuth ──────────────────────────────────────────────────────

// GCC (Knapp & Carter 1976) with their maximum-likelihood weighting, refined between samples: a voice and its copy shifted
// by an exact fraction comes back to the ten-thousandth of a sample; the sign of the peak says a channel was inverted.
test('azimuth: the delay between the channels measured to 0.001 samples, and the polarity', async () => {
  let { x, sr } = await voice(6)
  for (let d of [0.37, -1.6, 4.25, 31.5]) {
    let [m] = await measure(blocks([x, shift(x, d)]), sr), v = m.curve.v.map(ms => ms * sr / 1000)
    ok(m.sign === 1 && v.every(t => Math.abs(t - d) < 0.001), `${d} samples: ${v.map(t => t.toFixed(4)).join(' ')}`)
  }
  let [m] = await measure(blocks([x, shift(x, 2.3).map(v => -v)]), sr)
  ok(m.sign === -1 && m.curve.v.every(ms => Math.abs(ms * sr / 1000 - 2.3) < 0.001), 'inverted and 2.3 late')
})

// The second channel is read where the first is (the Lanczos interpolator, 16 zero crossings): it lines up with the
// first to within -45 dB of it, the first untouched; inverted, it comes back the right way up. A delay that wanders
// (a tape's azimuth drifting as it plays: 1 ± 0.6 samples over 8 s) is followed: what is left measures within 0.05.
test('azimuth: a pair moved back into line, a drifting one followed, the first channel untouched', async () => {
  let { x, sr } = await voice(8), lo = 4000, hi = x.length - 4000
  for (let [d, sign] of [[0.37, 1], [-1.6, 1], [2.3, -1]]) {
    let r = shift(x, d).map(v => sign * v), [l, y] = await audio.from([x, r], { sampleRate: sr }).azimuth().read()
    ok(l.every((v, i) => v === x[i]), `${d}: the first channel sample for sample`)
    ok(residual(x, y, lo, hi) < -45, `${d}${sign < 0 ? ', inverted' : ''}: the second within ${residual(x, y, lo, hi).toFixed(1)} dB of the first`)
  }
  // a delay drifting slowly, written by windowed sinc: x read at i − d(i)
  let d = i => 1 + 0.6 * Math.sin(2 * Math.PI * i / sr / 8), H = 32, r = new Float32Array(x.length)
  for (let i = 0; i < x.length; i++) {
    let p = i - d(i), b = Math.floor(p), s = 0
    for (let k = b - H + 1; k <= b + H; k++) if (k >= 0 && k < x.length) { let u = p - k, w = Math.cos(Math.PI * u / (2 * H)) ** 2; s += x[k] * (u ? Math.sin(Math.PI * u) / (Math.PI * u) : 1) * w }
    r[i] = s
  }
  let [, y] = await audio.from([x, r], { sampleRate: sr }).azimuth().read()
  let [left] = await measure(blocks([x.subarray(sr, -sr), y.subarray(sr, -sr)]), sr)
  ok(!left || left.curve.v.every(ms => Math.abs(ms * sr / 1000) < 0.05), `left after: ${left ? left.curve.v.map(ms => (ms * sr / 1000).toFixed(3)).join(' ') : 'none'}`)
  // set by hand: 0.05 ms earlier, a stereo pair's second channel
  let [, z] = await audio.from([x, x], { sampleRate: sr }).azimuth(0.05).read(), want = shift(x, -0.05 * sr / 1000)
  ok(residual(want, z, lo, hi) < -45, `azimuth(0.05) as an exact shift: ${residual(want, z, lo, hi).toFixed(1)} dB`)
})

// A stereo image with no offset: a voice and a noise panned to opposite sides, with each side's own room (independent
// noise 30 dB down). It measures within a tenth of a sample and is left as it came, sample for sample.
test('azimuth: a true stereo image with no offset is left alone', async () => {
  let { x, sr } = await voice(6), seed = 3, rnd = () => (seed = seed * 16807 % 2147483647) / 2147483647 * 2 - 1
  let n = x.length, s2 = Float32Array.from({ length: n }, (_, i) => 0.1 * rnd() * (0.6 + 0.4 * Math.sin(2 * Math.PI * 2 * i / sr)))
  let L = Float32Array.from(x, (v, i) => 0.8 * v + 0.3 * s2[i] + 0.003 * rnd()), R = Float32Array.from(x, (v, i) => 0.3 * v + 0.8 * s2[i] + 0.003 * rnd())
  let [l, r] = await audio.from([L, R], { sampleRate: sr }).azimuth().read()
  ok(l.every((v, i) => v === L[i]) && r.every((v, i) => v === R[i]), 'sample for sample')
})

// ── Phase ────────────────────────────────────────────────────────

// A turn by θ moves each sinusoid's phase by θ: cos turned 90° is −sin, to float precision (the Hilbert FIR's ripple is
// under 1e-5 from 20 Hz). Its magnitude spectrum, its RMS, are the input's, and −θ after θ gives the input back.
test('phase: a turn keeps every magnitude, and turns back; 180° negates, sample for sample', async () => {
  const sr = 44100, n = sr * 3
  let cos = Float32Array.from({ length: n }, (_, i) => Math.cos(2 * Math.PI * 1000 * i / sr))
  let [y] = await audio.from([cos], { sampleRate: sr }).phase(90).read(), err = 0
  for (let i = sr; i < n - sr; i++) err = Math.max(err, Math.abs(y[i] + Math.sin(2 * Math.PI * 1000 * i / sr)))
  ok(err < 1e-5, `cos turned 90° is −sin: ${err.toExponential(1)}`)
  let { x } = await voice(8), [z] = await audio.from([x], { sampleRate: 44100 }).phase(60).read()
  // Welch power spectra (8192-sample Hann frames, half overlapped), 30 Hz to 20 kHz, the bins within 60 dB of the top
  const spectrum = v => {
    let N = 8192, w = Float64Array.from({ length: N }, (_, i) => 0.5 - 0.5 * Math.cos(2 * Math.PI * i / N)), p = new Float64Array(N / 2)
    for (let o = 8192; o + N < v.length - 8192; o += N / 2) { let [re, im] = fft(Float64Array.from({ length: N }, (_, i) => v[o + i] * w[i])); for (let k = 0; k < N / 2; k++) p[k] += re[k] * re[k] + im[k] * im[k] }
    return p
  }
  let a = spectrum(x), b = spectrum(z), worst = 0
  let top = a.reduce((m, v) => Math.max(m, v), 0)
  for (let k = Math.ceil(30 * 8192 / sr); k < 20000 * 8192 / sr; k++) if (a[k] > 1e-6 * top) worst = Math.max(worst, Math.abs(10 * Math.log10(b[k] / a[k])))
  ok(worst < 0.5, `magnitude spectrum kept, Welch bins within ${worst.toFixed(3)} dB`)
  ok(Math.abs(10 * Math.log10(energy(z) / energy(x))) < 0.01, 'RMS kept')
  let [back] = await audio.from([x], { sampleRate: 44100 }).phase(37).phase(-37).read()
  ok(residual(x, back) < -75, `37° then −37°: ${residual(x, back).toFixed(1)} dB from the input`)
  let [neg] = await audio.from([x], { sampleRate: 44100 }).phase(180).read()
  ok(neg.every((v, i) => v === -x[i]), '180°: negated')
  let [l, r] = await audio.from([x, x], { sampleRate: 44100 }).phase(180, { channel: 1 }).read()
  ok(l.every((v, i) => v === x[i]) && r.every((v, i) => v === -x[i]), 'one channel\'s polarity')
  let [same] = await audio.from([x], { sampleRate: 44100 }).phase(0).read()
  ok(same.every((v, i) => v === x[i]), '0°: as it came')
})

test('phase: a range turns there alone, its edges ramped; a render from anywhere is the whole one\'s', async () => {
  let { x, sr } = await voice(6), [y] = await audio.from([x], { sampleRate: sr }).phase(90, { at: 2, duration: 1 }).read()
  ok(y.every((v, i) => i >= 2 * sr && i < 3 * sr || v === x[i]), 'outside the range: sample for sample')
  ok(residual(x, y, 2.1 * sr, 2.9 * sr) > -3, 'inside: turned')
  let a = audio.from([x], { sampleRate: sr }).phase(70), [whole] = await a.read(), [part] = await a.read({ at: 3.3, duration: 0.5 })
  ok(part.every((v, i) => v === whole[Math.round(3.3 * sr) + i]), 'from 3.3 s: the same samples')
})

// Unset, the angle that lowers the peaks most, over time. A pulse train in cosine phase leans all to one side (its
// positive peak 53 dB over its negative one at 100 Hz): turned, its peaks come down 5 dB, its RMS the same. The peak
// never rises: of noise and of a tone, whose peaks no turn lowers, as they were or lower. VoiceBank's clean speech
// (~/.cache/audiojs/data/vbdemand, where it is): the first 30 sentences of each speaker, each sentence's peak.
test('phase(): its peaks lowered at the same RMS, never raised', { timeout: 120000 }, async () => {
  const sr = 44100, peak = v => v.reduce((m, u) => Math.max(m, Math.abs(u)), 0)
  for (let [f0, down] of [[100, 4.5], [150, 4.5], [220, 2.5]]) {
    let x = pulses(f0, 2), [y] = await audio.from([x], { sampleRate: sr }).phase().read()
    ok(db(peak(x) / peak(y)) > down, `pulses at ${f0} Hz: the peak ${db(peak(x) / peak(y)).toFixed(2)} dB lower`)
    ok(Math.abs(10 * Math.log10(energy(y) / energy(x))) < 0.1, `RMS kept, ${(10 * Math.log10(energy(y) / energy(x))).toFixed(3)} dB`)
  }
  let seed = 9, noise = Float32Array.from({ length: sr }, () => (seed = seed * 16807 % 2147483647) / 2147483647 - 0.5)
  for (let x of [noise, Float32Array.from({ length: sr }, (_, i) => 0.5 * Math.sin(2 * Math.PI * 440 * i / sr))]) {
    let [y] = await audio.from([x], { sampleRate: sr }).phase().read()
    ok(peak(y) <= peak(x) * (1 + 1e-6), `${peak(y)} ≤ ${peak(x)}`)
  }
  let dir = `${homedir()}/.cache/audiojs/data/vbdemand/clean_testset_wav`
  if (!existsSync(dir)) return
  for (let speaker of ['p232', 'p257']) {
    let gains = []
    for (let f of readdirSync(dir).filter(f => f.startsWith(speaker)).slice(0, 30)) {
      let a = await audio(`${dir}/${f}`), [x] = await a.read(), [y] = await a.clone().phase().read()
      gains.push(db(peak(x) / peak(y)))
    }
    let mean = gains.reduce((s, g) => s + g) / gains.length
    ok(Math.min(...gains) >= 0 && mean > 0.5, `${speaker}: peaks ${mean.toFixed(2)} dB lower on average, ${Math.max(...gains).toFixed(2)} at most, ${Math.min(...gains).toFixed(2)} at least`)
  }
})

// ── Streaming preview ────────────────────────────────────────────

// Each codec's own gapless information undoes its delay (LAME's tag, the MP4 edit list, Opus's pre-skip, Vorbis' granule
// positions): what comes back lines up with what went in to a hundredth of a sample, its length the same, at 44.1 and
// 48 kHz, mono and stereo. Opus away from 48 kHz goes there and back through our sinc (the encoder's own resampler
// starts every chunk it is given afresh: half a sample early through save(), a 30 dB SNR down to 18).
test('codec: encoded and decoded in place, lined up sample for sample with the input', { timeout: 120000 }, async () => {
  let { x } = await voice(4)
  for (let sr of [44100, 48000]) {
    let src = sr === 44100 ? x : (await audio.from([x], { sampleRate: 44100 }).resample(48000, { type: 'sinc' }).read())[0]
    let pair = [src, Float32Array.from(src, (v, i) => 0.7 * (src[i - 5] ?? 0))]
    for (let [fmt, kbps, snr] of [['mp3', 128, 20], ['aac', 128, 20], ['opus', 96, 18], ['vorbis', 160, 20]]) for (let chs of [pair.slice(0, 1), pair]) {
      let y = await audio.from(chs, { sampleRate: sr }).codec(fmt, kbps).read()
      is(y[0].length, src.length, `${fmt} ${sr}: the length`)
      chs.forEach((c, k) => {
        let l = lag(c, y[k]), q = -residual(c, y[k], 5000, c.length - 5000)
        ok(Math.abs(l) < 0.05 && q > snr, `${fmt} ${kbps} kbps, ${sr} Hz, channel ${k} of ${chs.length}: ${l.toFixed(3)} samples off, ${q.toFixed(1)} dB SNR`)
      })
    }
  }
  let [r] = await audio.from([x], { sampleRate: 44100 }).codec('mp3', 64, { at: 1, duration: 1 }).read()
  ok(r.every((v, i) => i >= 44100 && i < 88200 || v === x[i]) && residual(x, r, 44100, 88200) > -40, 'a range: changed there alone')
})

// ── Deconstruct ──────────────────────────────────────────────────

// The masks sum to 1, so the three parts add back to the input (to float precision), and gains of 0 dB leave it as it
// came. Each lands where it should: a held chord in the tonal part, clicks in the transient part, white noise mostly in
// the noise part (its soft mask leaves a little to the others): energy shares of the input, the middle 2 s.
test('deconstruct: the parts add back to the input; a chord, clicks and a hiss each land in their own', async () => {
  const sr = 44100, n = sr * 3
  let seed = 7, rnd = () => (seed = seed * 16807 % 2147483647) / 2147483647
  let tone = Float32Array.from({ length: n }, (_, i) => 0.5 * Math.sin(2 * Math.PI * 440 * i / sr) + 0.25 * Math.sin(2 * Math.PI * 1320 * i / sr))
  let noise = Float32Array.from({ length: n }, () => 0.3 * (rnd() * 2 - 1)), clicks = new Float32Array(n)
  for (let t = 1000; t < n; t += 4410) clicks[t] = 0.9
  const share = (y, x) => energy(y, sr / 2, n - sr / 2) / energy(x, sr / 2, n - sr / 2)
  for (let [name, x, part, gains] of [['chord', tone, 0, [0, -Infinity, -Infinity]], ['clicks', clicks, 2, [-Infinity, -Infinity, 0]], ['hiss', noise, 1, [-Infinity, 0, -Infinity]]]) {
    let a = audio.from([x], { sampleRate: sr }), ys = []
    for (let g of [[0, -Infinity, -Infinity], [-Infinity, 0, -Infinity], [-Infinity, -Infinity, 0]]) ys.push((await a.clone().deconstruct(...g).read())[0])
    let err = 0
    for (let i = 0; i < n; i++) err = Math.max(err, Math.abs(ys[0][i] + ys[1][i] + ys[2][i] - x[i]))
    ok(err < 1e-6, `${name}: tonal + noise + transient is the input, to ${err.toExponential(1)}`)
    let s = ys.map(y => share(y, x)), own = s[part]
    ok(name === 'hiss' ? own > 0.6 && s.every((v, k) => k === part || v < own / 30) : own > 0.99, `${name}: shares ${s.map(v => v.toFixed(3)).join(' / ')}`)
  }
  let mix = Float32Array.from(tone, (v, i) => v + clicks[i] + 0.3 * noise[i]), [same] = await audio.from([mix], { sampleRate: sr }).deconstruct().read()
  ok(same.every((v, i) => v === mix[i]), '0 dB each: sample for sample')
})

test('deconstruct: a range changes there alone; a render from anywhere is the whole one\'s', async () => {
  let { x, sr } = await voice(5), a = audio.from([x], { sampleRate: sr }).deconstruct(0, -20, -6)
  let [y] = await audio.from([x], { sampleRate: sr }).deconstruct(0, -20, -6, { at: 2, duration: 1 }).read()
  ok(y.every((v, i) => i > 2 * sr - 2048 && i < 3 * sr + 2048 || v === x[i]), 'a frame away from the range: sample for sample')
  let [whole] = await a.read(), [part] = await a.read({ at: 2.7, duration: 0.6 })
  ok(part.every((v, i) => v === whole[Math.round(2.7 * sr) + i]), 'from 2.7 s: the same samples')
  ok(residual(x, whole) > -30 && lag(x, whole) ** 2 < 1e-4, `in line with its input (lag ${lag(x, whole).toFixed(4)})`)
})

// ── Find Similar ─────────────────────────────────────────────────

// Events planted in a voice at known times, their levels up to 10 dB apart: coughs (each a fresh draw of filtered
// noise), clicks (a struck 3.5 kHz ring), barks (harmonics gliding down), beeps (1 kHz). The first of each finds the
// others, each within a hop of where it was planted, and nothing else; a beep, under which the voice goes on, in its
// band.
test('similar: the rest of a cough, a click, a bark, a beep found where they were planted, nothing else', { timeout: 60000 }, async () => {
  let { x: v, sr } = await voice(13), x = v.map(s => s * 0.5), seed = 11, rnd = () => (seed = seed * 16807 % 2147483647) / 2147483647
  const plant = (t, ev) => { let o = Math.round(t * sr); ev.forEach((s, i) => x[o + i] += s) }
  const cough = g => { let lp = 0, prev = 0; return Float32Array.from({ length: 0.3 * sr }, (_, i) => { let t = i / sr, e = Math.exp(-(((t - 0.04) / 0.025) ** 2)) + 0.6 * Math.exp(-(((t - 0.17) / 0.05) ** 2)); lp += 0.35 * (rnd() * 2 - 1 - lp); let hp = lp - prev; prev = lp; return g * e * (0.7 * lp + 0.5 * hp) }) }
  const click = g => Float32Array.from({ length: 200 }, (_, i) => g * Math.exp(-i / 15) * Math.cos(2 * Math.PI * 3500 * i / sr))
  const bark = g => { let ph = 0; return Float32Array.from({ length: 0.25 * sr }, (_, i) => { let t = i / sr, s = 0; ph += 2 * Math.PI * (600 - 900 * t) / sr; for (let h = 1; h <= 8; h++) s += Math.sin(h * ph) / h; return 0.5 * g * s * Math.sin(Math.PI * t / 0.25) ** 2 }) }
  const beep = g => Float32Array.from({ length: 0.2 * sr }, (_, i) => g * Math.sin(2 * Math.PI * 1000 * i / sr) * Math.min(1, i / 200, (0.2 * sr - i) / 200))
  const events = {
    cough: [[0.8, 3.1, 5.6, 8.2, 10.9], [0.5, 0.25, 0.4, 0.15, 0.3], cough, 0.3],
    click: [[0.55, 1.73, 3.75, 4.91, 6.29, 9.71, 12.13], [0.6, 0.3, 0.45, 0.3, 0.5, 0.35, 0.4], click, 0.012],
    bark: [[2.6, 7.5], [0.4, 0.2], bark, 0.25],
    beep: [[1.9, 6.7, 11.5], [0.3, 0.1, 0.2], beep, 0.2]
  }
  for (let [times, gains, make] of Object.values(events)) times.forEach((t, i) => plant(t, make(gains[i])))
  let a = audio.from([x], { sampleRate: sr })
  for (let [name, [times, , , d]] of Object.entries(events)) {
    let opts = name === 'beep' ? { band: [800, 1300] } : {}, at = name === 'click' ? times[0] - 0.002 : times[0]
    let found = await a.similar({ at, duration: d, ...opts }), want = times.slice(1).map(t => t - (at - times[0]))
    is(found.length, want.length, `${name}: ${found.map(f => `${f.at.toFixed(3)} (${f.score.toFixed(2)})`).join(', ')}`)
    want.forEach((t, i) => ok(Math.abs(found[i]?.at - t) < 0.007, `${name} at ${t.toFixed(3)}: found at ${found[i]?.at.toFixed(3)}`))
  }
  is(await a.stat('similar', { at: 0.8, duration: 0.3 }), await a.similar({ at: 0.8, duration: 0.3 }), 'the stat is the method')
})
