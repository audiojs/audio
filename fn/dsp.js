// Small DSP the plugins share, as each wrote it before: no imports, no registration (importing it loads no op)

/** The modified Bessel function of the first kind, order 0, by its series, summed till a term no longer changes it
 *  (a Kaiser window's: i0(β·√(1 − x²)) / i0(β)) */
export function i0(x) { let s = 1, t = 1; for (let k = 1; t > s * 1e-17; k++) s += t *= (x / 2 / k) ** 2; return s }

/** sin(πx)/(πx), 1 at 0 */
export const sinc = x => x === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x)

/** A periodic Hann window, N long: an STFT's, frames of it overlap-adding flat at a hop of N/2 or N/4 */
export const hann = N => Float64Array.from({ length: N }, (_, i) => 0.5 - 0.5 * Math.cos(2 * Math.PI * i / N))

/** The power of two at or above n, 2 the least */
export const pow2 = n => 2 ** Math.ceil(Math.log2(Math.max(2, n)))

/** The channels' mean over their first n samples (the first channel's length at most), as a T */
export function downmix(chs, n = Infinity, T = Float64Array) {
  let m = new T(Math.min(n, chs[0]?.length ?? 0))
  for (let ch of chs) for (let i = 0; i < m.length; i++) m[i] += ch[i] / chs.length
  return m
}
