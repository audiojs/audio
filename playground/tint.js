import { spectra } from './meters.js'

// Where a stretch of a channel centres in frequency, for its waveform's colour: the 1,024 samples at its middle, their
// spectrum (meters.js), its spectral centroid's place in octaves from 100 Hz to 10 kHz, 0..1; null where it is silent
const SIZE = 1024, LIGHT = .78, WARM = 1e6 / 1800, WHITE = 1e6 / 6500, COOL = 1e6 / 16000
export default function centre(x, from, to, rate) {
  const mid = Math.round((from + to) / 2), db = spectra([x], mid - SIZE / 2, mid + SIZE / 2, { size: SIZE, frames: 1 })[0], bin = rate / SIZE
  let sum = 0, weighted = 0
  for (let k = 1; k < db.length; k++) { const p = 10 ** (db[k] / 10); sum += p; weighted += p * k * bin }
  // under −90 dB a bin, nothing to colour
  if (sum < 1e-9 * db.length) return null
  return Math.max(0, Math.min(1, (Math.log2(Math.max(weighted / sum, 1)) - Math.log2(100)) / (Math.log2(10000) - Math.log2(100))))
}

// The centroid's place as a colour temperature, the low warm and the high cool, as light is: 100 Hz at 1,800 K, a
// candle's orange, 1 kHz at 6,500 K, daylight's white, 10 kHz at 16,000 K, a clear sky's blue, its octaves even in
// mireds (10⁶ / K, the scale on which equal steps of warmth look about equal) either side of white; [r, g, b, a] in
// encoded sRGB as gl-waveform takes a colour
export const temperature = u => kelvin(1e6 / (u < .5 ? WARM + (WHITE - WARM) * 2 * u : WHITE + (COOL - WHITE) * (2 * u - 1)))

// The centroid's place in a colormap's upper half, [r, g, b, a] stops in 0..1, linear between them: low at its middle,
// high at its top, as the spectrum meter fills, so the waveform reads against the screen and never sinks into it
export const colormap = stops => u => {
  const t = (.5 + u / 2) * (stops.length - 1), i = Math.min(stops.length - 2, Math.floor(t)), f = t - i
  return stops[i].map((v, j) => v + (stops[i + 1][j] - v) * f)
}

// A temperature's colour: the Planckian locus in CIE 1960 uv (Krystek 1985, as color-space's kelvin space has it), to
// xy, to XYZ, to linear sRGB (IEC 61966-2-1), its hue and chroma in OKLab kept, at one lightness so warmth alone differs
export function kelvin(T) {
  const u = (.860117757 + 1.54118254e-4 * T + 1.28641212e-7 * T * T) / (1 + 8.42420235e-4 * T + 7.08145163e-7 * T * T)
  const v = (.317398726 + 4.22806245e-5 * T + 4.20481691e-8 * T * T) / (1 - 2.89741816e-5 * T + 1.61456053e-7 * T * T)
  const d = 2 * u - 8 * v + 4, x = 3 * u / d, y = 2 * v / d, X = x / y, Z = (1 - x - y) / y
  const rgb = [3.2404542 * X - 1.5371385 - .4985314 * Z, -.969266 * X + 1.8760108 + .041556 * Z, .0556434 * X - .2040259 + 1.0572252 * Z].map(c => Math.max(0, c))
  const [, a, b] = oklab(rgb)
  return [...srgb([LIGHT, a, b]), 1]
}

// Channels in one lane: each its own hue at that lightness, opposite for a pair, evenly round for more, a little clear
// so where they cross both show
export const hue = (i, n) => { const h = (50 + 360 * i / n) * Math.PI / 180; return [...srgb([LIGHT, .1 * Math.cos(h), .1 * Math.sin(h)]), .75] }

// OKLab (Ottosson 2020, "A perceptual color space for image processing") from linear sRGB, and back to encoded sRGB
// (IEC 61966-2-1), clipped
function oklab([r, g, b]) {
  const l = Math.cbrt(.4122214708 * r + .5363325363 * g + .0514459929 * b), m = Math.cbrt(.2119034982 * r + .6806995451 * g + .1073969566 * b), s = Math.cbrt(.0883024619 * r + .2817188376 * g + .6299787005 * b)
  return [.2104542553 * l + .793617785 * m - .0040720468 * s, 1.9779984951 * l - 2.428592205 * m + .4505937099 * s, .0259040371 * l + .7827717662 * m - .808675766 * s]
}
function srgb([L, a, b]) {
  const l = (L + .3963377774 * a + .2158037573 * b) ** 3, m = (L - .1055613458 * a - .0638541728 * b) ** 3, s = (L - .0894841775 * a - 1.291485548 * b) ** 3
  const encode = v => { v = Math.max(0, Math.min(1, v)); return v <= .0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - .055 }
  return [4.0767416621 * l - 3.3077115913 * m + .2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - .3413193965 * s, -.0041960863 * l - .7034186147 * m + 1.707614701 * s].map(encode)
}
