import { spectra } from './meters.js'

// What a stretch of a channel holds in frequency, for its waveform's colour: the spectrum (meters.js) of the 1,024
// samples at its middle, read as DAWs and DJ software colour a waveform (audiojs.github.io, lab/waveform), places in
// octaves from 100 Hz to 10 kHz, 0..1: `centroid`, where its power centres (FL Studio's colour map, WaveLab's average,
// Freesound's); `dominant`, its strongest frequency, the vertex of a parabola through the loudest bin and its two
// neighbours in dB (J. O. Smith, Spectral Audio Signal Processing, 2011, "Quadratic Interpolation of Spectral Peaks"),
// and `tonal`, how far from noise it is, its spectral flatness over the same octaves in dB over −60 dB, at most 1
// (Johnston's tonality, IEEE J. Sel. Areas Commun. 6, 1988) (REAPER's spectral peaks: hue the dominant, saturation the
// tonality); `bands`, its lows, mids and highs, each band's share of its amplitude (√ of its share of the power), split
// at Mixxx's 600 Hz and 4 kHz (src/analyzer/analyzerwaveform.cpp). Null where it is silent
const SIZE = 1024, LOW = 100, HIGH = 10000, SPLIT = [600, 4000], LIGHT = .78, WARM = 1e6 / 1800, WHITE = 1e6 / 6500, COOL = 1e6 / 16000
const place = f => Math.max(0, Math.min(1, Math.log2(Math.max(f, 1) / LOW) / Math.log2(HIGH / LOW)))
export default function measure(x, from, to, rate) {
  const mid = Math.round((from + to) / 2), db = spectra([x], mid - SIZE / 2, mid + SIZE / 2, { size: SIZE, frames: 1 })[0], bin = rate / SIZE, bands = [0, 0, 0]
  let sum = 0, weighted = 0, top = 1, inner = 0, logs = 0, n = 0
  for (let k = 1; k < db.length; k++) {
    const p = 10 ** (db[k] / 10), f = k * bin
    sum += p; weighted += p * f; bands[f < SPLIT[0] ? 0 : f < SPLIT[1] ? 1 : 2] += p
    if (db[k] > db[top]) top = k
    if (f >= LOW && f <= HIGH) { inner += p; logs += db[k]; n++ }
  }
  // under −90 dB a bin, nothing to colour
  if (sum < 1e-9 * db.length) return null
  const a = db[top - 1], b = db[top], c = db[top + 1] ?? b, d = top > 1 ? .5 * (a - c) / (a - 2 * b + c) || 0 : 0
  return { centroid: place(weighted / sum), dominant: place((top + d) * bin), tonal: n ? Math.min(1, (logs / n - 10 * Math.log10(inner / n)) / -60) : 1, bands: bands.map(p => Math.sqrt(p / sum)) }
}

// A stretch's colours in a mode, from its measures and the colormap (`tone`, a place to a colour), each [colour, its
// share of the waveform's height], drawn in turn: 'bands', its lows, mids and highs as red, green and blue (rgb), at
// lightness `L`; 'layers', each band a waveform of its own as tall as its share, lows under mids under highs, in the
// colormap's low, middle and top (rekordbox's 3Band, Mixxx's Filtered); 'centroid', where it centres; 'dominant', its
// strongest frequency, greyed as it is noisy
export const coloured = (mode, m, tone, L = LIGHT) => mode === 'layers' ? m.bands.map((s, j) => [tone(j / 2), s])
  : [[mode === 'bands' ? rgb(m.bands, L) : mode === 'dominant' ? greyed(tone(m.dominant), m.tonal) : tone(m.centroid), 1]]

// Lows, mids and highs as red, green and blue, as Mixxx mixes its bands (src/waveform/renderers/waveformrendererrgb.cpp):
// each band's amplitude its primary's, the largest made full (Serato's, rekordbox's RGB, Engine DJ's); at OKLab
// lightness `L`, the hue alone telling them apart, so it reads on a light screen as on a dark one
export function rgb(bands, L = LIGHT) {
  const top = Math.max(...bands) || 1, [, a, b] = oklab(bands.map(v => decode(v / top)))
  return [...fit(L, Math.hypot(a, b), Math.atan2(b, a)), 1]
}
// A colour greyed as a sound is far from a tone (`tonal`, 1 a tone, 0 noise): its OKLab chroma that share, its
// lightness and hue kept, as REAPER fades noise to grey
export function greyed([r, g, b, alpha = 1], tonal) {
  const [L, A, B] = oklab([r, g, b].map(decode))
  return [...srgb([L, A * tonal, B * tonal]), alpha]
}

// A frequency's place as a colour temperature, the low warm and the high cool, as light is: 100 Hz at 1,800 K, a
// candle's orange, 1 kHz at 6,500 K, daylight's white, 10 kHz at 16,000 K, a clear sky's blue, its octaves even in
// mireds (10⁶ / K, the scale on which equal steps of warmth look about equal) either side of white, at OKLab lightness
// `L` (the waveform's own, so it reads on a light screen as on a dark one); [r, g, b, a] in encoded sRGB as gl-waveform
// takes a colour
export const temperature = (u, L = LIGHT) => kelvin(1e6 / (u < .5 ? WARM + (WHITE - WARM) * 2 * u : WHITE + (COOL - WHITE) * (2 * u - 1)), L)

// A frequency's place in the half of a colormap that reads against the screen (`screen`, encoded sRGB), [r, g, b, a]
// stops in 0..1, linear between them: low at its middle, high at the end farther in lightness from the screen, each
// end over it (magma's pale top on a dark screen, its black foot on a light one; grey's ink on either), as the spectrum
// meter fills, so the waveform never sinks into the screen
export function colormap(stops, screen = [0, 0, 0]) {
  const s = lightness(screen), off = ([r, g, b, a = 1]) => Math.abs(lightness([r, g, b].map((v, j) => v * a + screen[j] * (1 - a))) - s)
  const way = off(stops.at(-1)) >= off(stops[0]) ? 1 : -1
  return u => {
    const t = (.5 + way * u / 2) * (stops.length - 1), i = Math.min(stops.length - 2, Math.floor(t)), f = t - i
    return stops[i].map((v, j) => v + (stops[i + 1][j] - v) * f)
  }
}

// A temperature's colour: the Planckian locus in CIE 1960 uv (Krystek 1985, as color-space's kelvin space has it), to
// xy, to XYZ, to linear sRGB (IEC 61966-2-1), its hue and chroma in OKLab kept (fit), at one lightness so warmth alone
// differs
export function kelvin(T, L = LIGHT) {
  const u = (.860117757 + 1.54118254e-4 * T + 1.28641212e-7 * T * T) / (1 + 8.42420235e-4 * T + 7.08145163e-7 * T * T)
  const v = (.317398726 + 4.22806245e-5 * T + 4.20481691e-8 * T * T) / (1 - 2.89741816e-5 * T + 1.61456053e-7 * T * T)
  const d = 2 * u - 8 * v + 4, x = 3 * u / d, y = 2 * v / d, X = x / y, Z = (1 - x - y) / y
  const rgb = [3.2404542 * X - 1.5371385 - .4985314 * Z, -.969266 * X + 1.8760108 + .041556 * Z, .0556434 * X - .2040259 + 1.0572252 * Z].map(c => Math.max(0, c))
  const [, a, b] = oklab(rgb)
  return [...fit(L, Math.hypot(a, b), Math.atan2(b, a)), 1]
}

// Channels in one lane: each its own hue at that lightness, opposite for a pair, evenly round for more, a little clear
// so where they cross both show
export const hue = (i, n, L = LIGHT) => { const h = (50 + 360 * i / n) * Math.PI / 180; return [...srgb([L, .1 * Math.cos(h), .1 * Math.sin(h)]), .75] }


// OKLab lightness `L`, chroma `C` and hue `h` (radians) as encoded sRGB, where sRGB holds less chroma at that hue as much
// as it holds: CSS Color 4's gamut mapping (§13.2.2), chroma given up, lightness and hue kept, till the clipped colour
// is within a just noticeable difference (ΔEOK .02) of it
function fit(L, C, h) {
  const at = c => [L, c * Math.cos(h), c * Math.sin(h)]
  const off = c => { const x = at(c), y = oklab(srgb(x).map(decode)); return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]) }
  if (off(C) <= .02) return srgb(at(C))
  let lo = 0, hi = C
  while (hi - lo > 1e-4) { const m = (lo + hi) / 2; if (off(m) > .02) hi = m; else lo = m }
  return srgb(at(lo))
}

// An encoded sRGB colour's OKLab lightness
export const lightness = ([r, g, b]) => oklab([r, g, b].map(decode))[0]

// The spectrogram's levels in one ink, `n` stops as CSS colours: the ink at the coverage that, over the far end of the
// screen from it (black under a light ink, white under a dark one), steps OKLab lightness evenly from that end's to the
// ink's, each level's share of the way raised to `gamma`. White ink is the grey screened over the page: white at the
// opacity of the grey's encoded value, as Compositing and Blending 1's screen has it; black ink, its multiply. Mixed in
// encoded sRGB, as the page composites
export function inked(ink, n, gamma = 1) {
  const end = lightness(ink) > .5 ? 0 : 1, L = a => lightness(ink.slice(0, 3).map(v => end + a * (v - end))), L0 = L(0), L1 = L(1)
  return Array.from({ length: n }, (_, k) => {
    const want = L0 + (k / (n - 1)) ** gamma * (L1 - L0)
    let lo = 0, hi = 1
    for (let j = 0; j < 40; j++) { const m = (lo + hi) / 2; if ((L(m) - want) * Math.sign(L1 - L0) < 0) lo = m; else hi = m }
    return `rgb(${ink.slice(0, 3).map(v => Math.round(v * 255)).join(' ')} / ${((lo + hi) / 2 * (ink[3] ?? 1)).toFixed(4)})`
  })
}

// OKLab (Ottosson 2020, "A perceptual color space for image processing") from linear sRGB, and back to encoded sRGB
// (IEC 61966-2-1), clipped
const decode = v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4
export function oklab([r, g, b]) {
  const l = Math.cbrt(.4122214708 * r + .5363325363 * g + .0514459929 * b), m = Math.cbrt(.2119034982 * r + .6806995451 * g + .1073969566 * b), s = Math.cbrt(.0883024619 * r + .2817188376 * g + .6299787005 * b)
  return [.2104542553 * l + .793617785 * m - .0040720468 * s, 1.9779984951 * l - 2.428592205 * m + .4505937099 * s, .0259040371 * l + .7827717662 * m - .808675766 * s]
}
export function srgb([L, a, b]) {
  const l = (L + .3963377774 * a + .2158037573 * b) ** 3, m = (L - .1055613458 * a - .0638541728 * b) ** 3, s = (L - .0894841775 * a - 1.291485548 * b) ** 3
  const encode = v => { v = Math.max(0, Math.min(1, v)); return v <= .0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - .055 }
  return [4.0767416621 * l - 3.3077115913 * m + .2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - .3413193965 * s, -.0041960863 * l - .7034186147 * m + 1.707614701 * s].map(encode)
}

// The colormaps, one list the spectrogram's levels and the waveform's frequencies both take (grey, the skin's own ink, is
// made where it draws: view.js shades): matplotlib's magma, inferno and viridis, 9 of their 256 entries
// (matplotlib/_cm_listed.py); and the colour of light, as a body glows brighter and bluer as it heats: from a coal's
// 1,000 K to a clear sky's 16,000 K evenly in mireds, its OKLab lightness rising evenly from .1 to .98 (kelvin). The
// waveform takes the half of a map that reads against the screen (colormap), temperature's at one lightness
// (temperature)
const hex = c => `#${c.slice(0, 3).map(v => Math.round(v * 255).toString(16).padStart(2, '0')).join('')}`
export const MAPS = {
  magma: ['#000004', '#1c1044', '#4f127b', '#812581', '#b5367a', '#e55064', '#fb8761', '#fec287', '#fcfdbf'],
  inferno: ['#000004', '#1f0c48', '#550f6d', '#88226a', '#ba3655', '#e35933', '#f98c0a', '#f9c932', '#fcffa4'],
  viridis: ['#440154', '#472c7a', '#3b518b', '#2c718e', '#21908d', '#27ad81', '#5cc863', '#aadc32', '#fde725'],
  temperature: Array.from({ length: 9 }, (_, k) => hex(kelvin(1e6 / (1000 + (62.5 - 1000) * k / 8), .1 + .88 * k / 8)))
}
