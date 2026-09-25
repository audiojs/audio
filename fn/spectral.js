/**
 * Spectral edit and repair: time × frequency regions, the cough / phone-ring / squeak class.
 *
 * a.spectral([1000, 4000], -30, { at: 2.1, duration: 0.3 })  → -30 dB in 1–4 kHz for 300 ms
 * a.spectral([6000, 9000], { at: 5, duration: 0.2 })          → remove the band there (default gain: off)
 * a.repair({ at: 1.2, duration: 0.05 })                         → rebuild a dropout from its surroundings
 * a.repair([0, 3000], { at: 1.2, duration: 0.05 })              → rebuild only that band
 *
 * `band` is [low, high] in Hz (default: full band); the time range is the op's own at/duration
 * (default: whole signal for spectral; required for repair). Kernels: @audio/spectral-edit
 * (COLA-normalized STFT gain) and @audio/denoise-repair (log-magnitude interpolation across the
 * hole, phase advanced from the leading context). Whole-signal; per channel.
 */
import audio from '../core.js'

/** Region in seconds/Hz from the op ctx; negative at counts from the end. */
function region(ctx) {
  let T = ctx.totalDuration, at = ctx.at ?? 0
  if (at < 0) at = T + at
  let [f0 = 0, f1 = ctx.sampleRate / 2] = ctx.band ?? []
  return { t0: at, t1: ctx.duration != null ? at + ctx.duration : T, f0, f1 }
}

audio.op('spectral', {
  params: ['band', 'gain'],
  load: () => import('@audio/spectral-edit'),
  whole: (input, output, ctx) => {
    let edit = audio.op('spectral').mod.default, r = region(ctx)
    let gain = ctx.gain == null ? 0 : 10 ** (ctx.gain / 20)
    for (let c = 0; c < input.length; c++) output[c].set(edit(input[c], { fs: ctx.sampleRate, regions: [{ ...r, gain }] }))
  },
})

audio.op('repair', {
  params: ['band'],
  load: () => import('@audio/denoise-repair'),
  whole: (input, output, ctx) => {
    if (ctx.at == null || ctx.duration == null) throw new RangeError('repair: needs the damaged time range, e.g. {at: 1.2, duration: 0.05}')
    let repair = audio.op('repair').mod.default, r = region(ctx)
    let reg = { at: r.t0, duration: r.t1 - r.t0, from: r.f0, to: r.f1 }
    for (let c = 0; c < input.length; c++) output[c].set(repair(input[c], { fs: ctx.sampleRate, regions: [reg] }))
  },
})
