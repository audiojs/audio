// A time as the page writes it, the same on the clock, the time row, the pointer and the edits, in the units the view
// settings choose: minutes and seconds (0:05.000), seconds (5.000s) or samples at `rate`; `digits` decimals of a second,
// as much as a zoom's precision needs. Rounded once, so 59.9996 s reads 1:00.000, never 0:60.000.
export const UNITS = [['clock', 'Minutes and seconds', '0:05.000', 'm:s'], ['seconds', 'Seconds', '5.000s', 's'], ['samples', 'Samples', '240000', 'samples']]
export default function time(t, units = 'clock', { digits = 3, rate = 48000 } = {}) {
  if (units === 'samples') return String(Math.round(t * rate))
  const q = 10 ** digits, n = Math.round(t * q)
  if (units === 'seconds') return `${(n / q).toFixed(digits)}s`
  const m = Math.floor(n / (60 * q)), s = (n - m * 60 * q) / q
  return `${m}:${s.toFixed(digits).padStart(digits ? digits + 3 : 2, '0')}`
}
