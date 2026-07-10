import audio from '../core.js'
import { highpass, lowpass, allpass } from '@audio/filter'

/** Split points: positional args or freqs option — deduped, ascending. */
const splitFreqs = ctx => {
  let f = ctx.freqs ?? ctx.args ?? []
  return [...new Set((Array.isArray(f) ? f.flat() : [f]).map(Number).filter(x => x > 0 && Number.isFinite(x)))].sort((a, b) => a - b)
}

const LR_Q = Math.SQRT1_2  // Butterworth section Q — two cascaded = Linkwitz-Riley 4th order

/** One stateful biquad section per band-channel slot (state persists across chunks). */
const sec = (buf, st, key, fn, fc, fs) => {
  let p = st[key] ??= { Q: LR_Q }
  p.fc = fc; p.fs = fs
  fn(buf, p)
}

/** Band-splitting crossover — N split points → N+1 bands, band-major output
 *  (band0 ch0..chK, band1 ch0..chK, …) like FFmpeg `acrossover`. Each band is an
 *  LR4 slice; every band is also allpassed at each split point above its own edge,
 *  so summing adjacent bands reconstructs the input allpass-flat. */
const crossover = (input, output, ctx) => {
  let freqs = splitFreqs(ctx)
  let n = input.length, bands = freqs.length + 1, fs = ctx.sampleRate, nyq = fs / 2
  for (let f of freqs) if (f >= nyq) throw new RangeError(`crossover: frequency ${f} ≥ Nyquist (${nyq})`)
  if (!ctx._xo) ctx._xo = Array.from({ length: bands * n }, () => ({}))
  for (let b = 0; b < bands; b++) for (let c = 0; c < n; c++) {
    let out = output[b * n + c], st = ctx._xo[b * n + c]
    out.set(input[c])
    if (b > 0) { sec(out, st, 'h0', highpass, freqs[b - 1], fs); sec(out, st, 'h1', highpass, freqs[b - 1], fs) }
    if (b < bands - 1) { sec(out, st, 'l0', lowpass, freqs[b], fs); sec(out, st, 'l1', lowpass, freqs[b], fs) }
    for (let j = b + 1; j < freqs.length; j++) sec(out, st, 'a' + j, allpass.second, freqs[j], fs)
  }
}

const crossoverCh = (curCh, ctx) => {
  let bands = splitFreqs(ctx).length + 1
  return bands === 1 ? 0 : curCh * bands
}

audio.op('crossover', { process: crossover, ch: crossoverCh })
