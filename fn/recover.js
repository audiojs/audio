/**
 * Recover: a voice's bandwidth lost (a phone line, a narrowband codec, a 16 kHz file) rebuilt from its own harmonics.
 *
 * a.recover()                    → the band above where the take's spectrum falls off a cliff, rebuilt
 * a.recover(4000)                → above 4 kHz
 *
 * Its pitch, f0, by pYIN (@audio/pitch-pyin, Mauch & Dixon 2014), frame by frame (2048 samples at 48 kHz, a quarter
 * apart). Each voiced frame's harmonics in the octave under the cutoff, read off its spectrum, set the level at the
 * cutoff of the harmonics above it, each k·f0 synthesized in phase with the fundamental, falling HARMONICS dB an
 * octave; the noise between them (all of an unvoiced frame's band) the level of the noise above it, random in phase,
 * falling NOISE dB an octave: past a voice's first few kilohertz its harmonics fade into the breath's noise. The input
 * keeps every sample it had; the band is added where the input lacks it: its long-term spectrum against the one under
 * the edge continued, the power missing (so it meets the input's own roll-off), fading out under 20 kHz. The cutoff, unless given: the lowest frequency from 1
 * kHz up the long-term spectrum falls CLIFF dB from over a third of an octave and stays under, steeper than any voice
 * rolls off; none, nothing is added. The whole input is analysed before rendering and kept while it stays the same.
 *
 * bench/recover.mjs, VoiceBank's test set (824 utterances, 48 kHz) cut to 8 and 16 kHz and back, the cutoff found in
 * all: log-spectral distance over the band rebuilt, input 41.3 and 40.6 dB, sbr() 20.0 and 16.7, recover() 13.9 and
 * 12.3; over 50 Hz–20 kHz 37.0 and 31.5, 18.0 and 14.2, 12.5 and 9.7. DNSMOS P.835 (it hears to 8 kHz) moves by
 * 0.001 or less either way. PESQ WB falls with any band added (bench/recover.py): cut to 8 kHz, 4.18 → 2.68 (sbr 2.49);
 * to 16 kHz, where PESQ hears only what lies under the edge, 4.63 → 4.54 (sbr 3.26: its waveshaper reaches under). A
 * listening test is what can rank it; none run yet. The slopes are a voice's: on pitched solo instruments it is no
 * better than sbr().
 */
import audio, { arrived } from '../core.js'
import { fft, ifft } from 'fourier-transform'
import { track } from '@audio/pitch/pyin'
import { fingerprint } from './vocals.js'

const RECOVERED = Symbol('recover.made')
const pow2 = n => 2 ** Math.ceil(Math.log2(Math.max(2, n)))
const db = p => 10 * Math.log10(p + 1e-30)
// a band limit's edge: CLIFF dB over a third of an octave, staying down: voices fall at most 20 (VoiceBank, 269 of its
// clean and noisy takes: 19.6); a sinc resampler's edge, 39 to 67; an 8th-order Butterworth's, 26 to 41
const CLIFF = 25, SIXTH = 2 ** (1 / 6)
// the slopes past the cutoff, dB an octave, chosen on 26 utterances of VoiceBank's training set cut to 8 and 16 kHz
// (log-spectral distance over the band rebuilt): the harmonics' (−9 to −18 within 0.2 dB of it), the noise's (−1 to −3)
const HARMONICS = -12, NOISE = -2
const ramp = (f, a, b) => f <= a ? 0 : f >= b ? 1 : 0.5 - 0.5 * Math.cos(Math.PI * (f - a) / (b - a))

/** The frames: Hann, N long (a sinusoid of amplitude A peaks at A·N/4), H apart */
function frames(sr) {
  let N = pow2(2048 * sr / 48000)
  return { N, H: N / 4, w: Float64Array.from({ length: N }, (_, i) => 0.5 - 0.5 * Math.cos(2 * Math.PI * i / N)) }
}

/** Power spectrum of x's frame centred at c (zero past its ends) */
function spectrum(x, c, { N, w }, buf = new Float64Array(N)) {
  for (let i = 0, j = c - N / 2; i < N; i++, j++) buf[i] = j >= 0 && j < x.length ? x[j] * w[i] : 0
  let [re, im] = fft(buf), p = new Float64Array(N / 2 + 1)
  for (let k = 0; k <= N / 2; k++) p[k] = re[k] * re[k] + im[k] * im[k]
  return p
}

/** The long-term spectrum, dB a bin, of x's frames half a frame apart, each bin the mean over a sixth of an octave
 *  around it; empty for x shorter than a frame */
export function ltas(x, sr) {
  let f = frames(sr), { N, H } = f, K = N / 2 + 1, L = new Float64Array(K), n = 0
  for (let c = N / 2; c + N / 2 <= x.length; c += 2 * H, n++) { let p = spectrum(x, c, f); for (let k = 0; k < K; k++) L[k] += p[k] }
  if (!n) return new Float64Array(0)
  return Float64Array.from(L, (_, k) => {
    let a = Math.max(1, Math.round(k / SIXTH ** 0.5)), b = Math.min(K - 1, Math.round(k * SIXTH ** 0.5)), s = 0
    for (let j = a; j <= b; j++) s += L[j]
    return db(s / n / (b - a + 1))
  })
}

/** Where the band stops: the lowest frequency from 1 kHz up the long-term spectrum (`l`, ltas()) falls CLIFF dB from
 *  over the third of an octave around it and stays under all the way up (a formant's valley rises again; past the edge,
 *  a filter's stopband may ripple into more cliffs); null where none does */
export function cutoffOf(l, sr) {
  let K = l.length, bin = sr / 2 / (K - 1), k = hz => Math.min(K - 1, Math.round(hz / bin)), above = Float64Array.from(l)
  for (let j = K - 2; j >= 0; j--) above[j] = Math.max(l[j], above[j + 1])
  for (let j = k(1000); j < K; j++) {
    let hz = j * bin
    if (hz * SIXTH ** 2 > sr / 2) break
    if (l[k(hz / SIXTH ** 0.5)] - above[k(hz * SIXTH ** 1.5)] >= CLIFF) return hz
  }
  return null
}

/** The level at `ref` of a line through (frequency, dB) points at `slope` dB an octave; null through none */
function level(pts, ref, slope) {
  return pts.length ? pts.reduce((p, [f, d]) => p + d - slope * Math.log2(f / ref), 0) / pts.length : null
}

/**
 * What to add to `chs` (sample rate `sr`) to rebuild the band above `cutoff`: per channel, the
 * harmonics of the voice's f0 and the noise between them, the long-term spectrum `l` (ltas(), of their mean) telling
 * where the input lacks them.
 */
export function extension(chs, sr, { cutoff = null, l = null } = {}) {
  let len = chs[0]?.length ?? 0, out = chs.map(() => new Float32Array(len)), top = Math.min(20000, 0.48 * sr)
  let hi = cutoff > 0 && cutoff < top ? cutoff : null
  if (!len || !hi) return out
  let mono = new Float32Array(len)
  for (let x of chs) for (let i = 0; i < len; i++) mono[i] += x[i] / chs.length
  l ??= ltas(mono, sr)
  let f = frames(sr), { N, H } = f, K = N / 2 + 1, bin = sr / N, M = Math.ceil(len / H) + 1
  if (l.length !== K) return out

  // how much of each bin the input lacks: its long-term spectrum against the line under the edge continued past it (as
  // the harmonics go there), the power missing, never less further up; none under 20 kHz
  let fill = new Float64Array(K), pts = []
  for (let k = Math.round(hi / 2 / bin); k * bin < hi / SIXTH; k++) pts.push([k * bin, l[k]])
  let edge = level(pts, hi, HARMONICS)
  for (let k = Math.round(hi / SIXTH / bin); edge != null && k < K; k++)
    fill[k] = Math.max(fill[k - 1], Math.sqrt(Math.max(0, 1 - 10 ** ((l[k] - edge - HARMONICS * Math.log2(k * bin / hi)) / 10))) * (1 - ramp(k * bin, top / SIXTH, top)))
  let weight = fq => { let k = fq / bin, i = Math.min(K - 2, Math.floor(k)); return fill[i] + (fill[i + 1] - fill[i]) * (k - i) }

  // f0 by pYIN, at each frame's centre; 0 unvoiced
  let p = track(mono, { fs: sr, minFreq: 60, maxFreq: 800 }), step = p.times.length > 1 ? (p.times[1] - p.times[0]) * sr : H
  let f0At = t => { let i = Math.min(p.f0.length - 1, Math.max(0, Math.round(t / step))); return p.voiced[i] ? p.f0[i] : 0 }

  for (let c = 0; c < chs.length; c++) {
    let x = chs[c], y = out[c], buf = new Float64Array(N)
    // per frame: f0; the harmonics' amplitude at the cutoff (dB), the noise's bin power there (dB)
    let fr = Array.from({ length: M }, (_, m) => {
      let t = m * H, f0 = f0At(t), P = spectrum(x, t, f, buf), peaks = [], gaps = []
      // a harmonic's peak within a bin of where it stands, its amplitude A = 4·sqrt(P)/N; the noise halfway between two
      if (f0) for (let h = Math.ceil(hi / 2 / f0); h * f0 < hi / SIXTH; h++) {
        let k0 = Math.round(h * f0 / bin), k = k0, g = Math.round((h + 0.5) * f0 / bin)
        for (let j = k0 - 1; j <= k0 + 1; j++) if (j > 0 && j < K && P[j] > P[k]) k = j
        peaks.push([h * f0, db(P[k] * 16 / (N * N))])
        if (g < K) gaps.push([(h + 0.5) * f0, db(P[g])])
      }
      else for (let k = Math.round(hi / 2 / bin); k * bin < hi / SIXTH; k++) gaps.push([k * bin, db(P[k])])
      return { f0, harm: level(peaks, hi, HARMONICS), noise: level(gaps, hi, NOISE) }
    })
    // the harmonics: an oscillator each, in phase with the fundamental, frequency and amplitude moving straight between
    // the frames' centres; a voiced stretch fading in and out over a hop at its ends
    let phase = 0
    let amp = (o, fq) => { let w = o.f0 && o.harm != null ? weight(fq) : 0; return w && 10 ** ((o.harm + HARMONICS * Math.log2(fq / hi)) / 20) * w }
    for (let m = 0; m < M - 1 && m * H < len; m++) {
      let a = fr[m], b = fr[m + 1], n0 = m * H, n1 = Math.min(len, n0 + H)
      if (!a.f0 && !b.f0) continue
      let fa = a.f0 || b.f0, fb = b.f0 || a.f0, hn = Math.floor(top / Math.min(fa, fb)), A0 = new Float64Array(hn + 1), A1 = new Float64Array(hn + 1), hs = []
      for (let h = 1; h <= hn; h++) if ((A0[h] = amp(a, h * fa)) + (A1[h] = amp(b, h * fb)) > 0) hs.push(h)
      for (let n = n0; n < n1; n++) {
        let u = (n - n0) / H, s = 0
        phase += 2 * Math.PI * (fa + (fb - fa) * u) / sr
        if (phase > 2 * Math.PI) phase -= 2 * Math.PI
        for (let h of hs) s += (A0[h] + (A1[h] - A0[h]) * u) * Math.sin(h * phase)
        y[n] += s
      }
    }
    // the noise: random phase under its line, frame by frame, overlap-added through the window (Hann a quarter apart
    // sums its square to 3/2)
    let seed = 0x9e3779b9 ^ c, rnd = () => (seed = Math.imul(seed ^ seed >>> 15, 0x2c1b3c6d) ^ seed + 0x6d2b79f5, ((seed ^ seed >>> 14) >>> 0) / 4294967296)
    let re = new Float64Array(K), im = new Float64Array(K), tmp = new Float64Array(N), k0 = Math.round(hi / SIXTH / bin)
    for (let m = 0; m < M; m++) {
      let nz = fr[m].noise
      if (nz == null) continue
      re.fill(0); im.fill(0)
      for (let k = k0; k < K; k++) {
        let mag = Math.sqrt(10 ** ((nz + NOISE * Math.log2(k * bin / hi)) / 10)) * weight(k * bin), ph = 2 * Math.PI * rnd()
        re[k] = mag * Math.cos(ph); im[k] = mag * Math.sin(ph)
      }
      let z = ifft(re, im, tmp)
      for (let i = 0, j = m * H - N / 2; i < N; i++, j++) if (j >= 0 && j < len) y[j] += z[i] * f.w[i] / 1.5
    }
  }
  return out
}

/** Analyse the edit's input and make the band it rebuilds, ahead of rendering. */
async function prepare(a, index) {
  let o = a.edits[index][1]
  if (o.cutoff != null && !(o.cutoff > 0)) throw new TypeError(`recover: cutoff is Hz, not ${o.cutoff}`)
  await arrived(a)
  let opts = `${o.cutoff ?? ''}`, stamp = `${a.version}:${a._.len}:${opts}`, done = o[RECOVERED]
  if (done?.stamp === stamp) return
  let input = audio.from(a, { sampleRate: a._.sr })
  input.edits = a.edits.slice(0, index)
  input.version = index
  let pcm = await input.read(), sr = input.sampleRate, key = `${opts}:${sr}:${fingerprint(pcm)}`
  if (done?.key === key) { done.stamp = stamp; return }
  let len = pcm[0]?.length ?? 0, mono = new Float32Array(len)
  for (let x of pcm) for (let i = 0; i < len; i++) mono[i] += x[i] / pcm.length
  let l = ltas(mono, sr), cutoff = o.cutoff ?? cutoffOf(l, sr)
  o[RECOVERED] = { key, stamp, cutoff, add: extension(pcm, sr, { cutoff, l }) }
}

const process = (input, output, ctx) => {
  let done = ctx[RECOVERED]
  if (!done) throw new Error('recover: the band is made before rendering, through read(), stream() or save()')
  let len = input[0].length, off = Math.round((ctx.blockOffset || 0) * ctx.sampleRate)
  for (let c = 0; c < input.length; c++) {
    let v = done.add[c], x = input[c], y = output[c]
    for (let i = 0, j = off; i < len; i++, j++) y[i] = x[i] + (v && j >= 0 && j < v.length ? v[j] : 0)
  }
}

audio.op('recover', { params: ['cutoff'], process, prepare })
