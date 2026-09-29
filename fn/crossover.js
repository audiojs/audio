import audio from '../core.js'
import { highpass, lowpass, allpass } from '@audio/filter-biquad'

/** Split points (positional or the freqs option), deduped, ascending. */
const splitFreqs = ctx => {
  let f = ctx.freqs ?? []
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
 *  (band0 ch0..chK, band1 ch0..chK, …) like FFmpeg `acrossover`. A tree of LR4 splits:
 *  at each split point, from the lowest, the lowpass is a band and the highpass carries
 *  on to the next split, so band b has passed every split below it. Each band is also
 *  allpassed at the split points above it: every band then carries the same phase, and
 *  the bands sum to one allpass, flat (LP² + HP² = AP per split; a band sliced by its
 *  two edges alone sums 0.04 dB off with 3 bands, 0.14 dB with 4). */
const crossover = (input, output, ctx) => {
  let freqs = splitFreqs(ctx)
  let n = input.length, bands = freqs.length + 1, fs = ctx.sampleRate, nyq = fs / 2
  for (let f of freqs) if (f >= nyq) throw new RangeError(`crossover: frequency ${f} ≥ Nyquist (${nyq})`)
  if (!ctx._xo) ctx._xo = Array.from({ length: bands * n }, () => ({}))
  for (let c = 0; c < n; c++) {
    // the top band's buffer carries what lies above every split so far; its slot holds the highpass states
    let rest = output[(bands - 1) * n + c], hs = ctx._xo[(bands - 1) * n + c]
    rest.set(input[c])
    for (let b = 0; b < bands - 1; b++) {
      let out = output[b * n + c], st = ctx._xo[b * n + c]
      out.set(rest)
      sec(out, st, 'l0', lowpass, freqs[b], fs); sec(out, st, 'l1', lowpass, freqs[b], fs)
      for (let j = b + 1; j < freqs.length; j++) sec(out, st, 'a' + j, allpass.second, freqs[j], fs)
      sec(rest, hs, 'h' + b + 'a', highpass, freqs[b], fs); sec(rest, hs, 'h' + b + 'b', highpass, freqs[b], fs)
    }
  }
}

const crossoverCh = (curCh, ctx) => {
  let bands = splitFreqs(ctx).length + 1
  return bands === 1 ? 0 : curCh * bands
}

audio.op('crossover', { params: ['...freqs'], process: crossover, ch: crossoverCh })
