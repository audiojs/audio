// Bandwidth rebuilt (fn/recover.js) against sbr() (a waveshaper exciter, @audio/effect-sbr) and the input as it came,
// on VoiceBank's clean test set (Valentini-Botinhao 2017, CC BY 4.0, doi:10.7488/ds/2117; 824 utterances, 48 kHz) cut:
//   8k     resampled to 8 kHz and back (sinc): the band above 4 kHz gone, a narrowband call's
//   16k    resampled to 16 kHz and back: above 8 kHz gone, a wideband call's, a 16 kHz file's
//
//   node bench/recover.mjs [CASE...] [--every N]       render what is missing, print the log-spectral distances
//   python bench/recover.py [CASE...] [--every N]      PESQ and DNSMOS of the same files (bench/speech.py's)
//
// LSD: per 2048-sample Hann frame a quarter apart, the RMS over bins of the dB difference to the clean take's power
// (each floored at 1e-8, −80 dB), the mean over frames within 40 dB of the loudest; over the band rebuilt (the cut's
// edge to 20 kHz) and over all of it (50 Hz to 20 kHz). Outputs, 32-bit float WAV:
// ~/.cache/audiojs/data/vbdemand/out-recover/<case>/<system>/<name>.wav
import { readdirSync } from 'node:fs'
import path from 'node:path'
import { fft } from 'fourier-transform'
import audio from '../audio.js'
import { ltas, cutoffOf } from '../fn/recover.js'
import { DATA, readWav, keep, mean } from './rx/lib.mjs'

const CLEAN = path.join(DATA, 'vbdemand', 'clean_testset_wav'), OUT = path.join(DATA, 'vbdemand', 'out-recover')
const CASES = {
  '8k': a => a.resample(8000, { type: 'sinc' }).resample(48000, { type: 'sinc' }),
  '16k': a => a.resample(16000, { type: 'sinc' }).resample(48000, { type: 'sinc' })
}
// the edge each case cut (the band rebuilt starts there), Hz
const EDGE = { '8k': 4000, '16k': 8000 }
const SYSTEMS = {
  input: (a, cut) => a,
  sbr: (a, cut) => a.sbr({ fc: cut }),
  recover: a => a.recover()
}

export function lsd(x, y, sr, lo, hi) {
  let N = 2048, H = 512, w = Float64Array.from({ length: N }, (_, i) => 0.5 - 0.5 * Math.cos(2 * Math.PI * i / N)), b = new Float64Array(N)
  let k0 = Math.round(lo / (sr / N)), k1 = Math.round(hi / (sr / N)), fr = []
  for (let t = 0; t + N <= Math.min(x.length, y.length); t += H) {
    for (let i = 0; i < N; i++) b[i] = x[t + i] * w[i]
    let [xr, xi] = fft(b).map(v => v.slice())
    for (let i = 0; i < N; i++) b[i] = y[t + i] * w[i]
    let [yr, yi] = fft(b), e = 0, en = 0
    for (let k = 0; k <= N / 2; k++) en += xr[k] ** 2 + xi[k] ** 2
    for (let k = k0; k < k1; k++) e += (10 * Math.log10(xr[k] ** 2 + xi[k] ** 2 + 1e-8) - 10 * Math.log10(yr[k] ** 2 + yi[k] ** 2 + 1e-8)) ** 2
    fr.push([en, Math.sqrt(e / (k1 - k0))])
  }
  let top = Math.max(...fr.map(f => f[0]))
  return mean(fr.filter(f => f[0] > top * 1e-4).map(f => f[1]))
}

const args = process.argv.slice(2), every = +(args[args.indexOf('--every') + 1] || 1) || 1
const cases = args.filter(a => CASES[a]).length ? args.filter(a => CASES[a]) : Object.keys(CASES)
const names = readdirSync(CLEAN).filter(f => f.endsWith('.wav')).sort().filter((_, i) => i % every === 0)
for (let c of cases) {
  let rows = Object.fromEntries(Object.keys(SYSTEMS).map(s => [s, { band: [], all: [], edges: [], ms: 0 }]))
  for (let name of names) {
    let { ch: [x], sr } = readWav(path.join(CLEAN, name))
    let { ch: [cut] } = await keep(path.join(OUT, c, 'cut', name), async () => ({ ch: (await CASES[c](audio.from([x], { sampleRate: sr })).read()).map(v => v.slice(0, x.length)), sr }))
    let edge = cutoffOf(ltas(cut, sr), sr)
    for (let [s, run] of Object.entries(SYSTEMS)) {
      let t = performance.now()
      let { ch: [y] } = await keep(path.join(OUT, c, s, name), async () => ({ ch: await run(audio.from([cut], { sampleRate: sr }), edge ?? EDGE[c]).read(), sr }))
      rows[s].ms += performance.now() - t
      rows[s].band.push(lsd(x, y, sr, EDGE[c], 20000)); rows[s].all.push(lsd(x, y, sr, 50, 20000))
      if (s === 'recover') rows[s].edges.push(edge)
    }
  }
  let found = rows.recover.edges.filter(e => e != null)
  console.log(`${c}: ${names.length} utterances, edge found in ${found.length} (median ${found.sort((p, q) => p - q)[found.length >> 1]?.toFixed(0)} Hz)`)
  for (let [s, r] of Object.entries(rows)) console.log(`  ${s.padEnd(8)} LSD band ${mean(r.band).toFixed(2)} dB, all ${mean(r.all).toFixed(2)} dB · ${(r.ms / names.length / 1000).toFixed(2)} s an utterance`)
}
