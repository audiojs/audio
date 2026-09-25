// The audio logo, drawn: a signal through a window, filled with a gradient rectangle bent to the waveform, printed.
// One sine cycle through a Hann window is the logo itself: sin x (1 + cos x), i.e. sin x + ½ sin 2x.
import * as windows from './assets/window-function.js'
import * as periodic from './assets/periodic-function.js'

// Every window of the collection but its helpers, rectangular first
const SKIP = ['generate', 'apply', 'enbw', 'scallopLoss', 'cola', 'rectangular']
export const WINDOWS = ['rectangular', ...Object.keys(windows).filter(name => !SKIP.includes(name))]

// Signals in turns, each shifted to cross zero falling at mid-period, as sine does
export const SIGNALS = {
  sine: t => periodic.sine(t),
  triangle: t => periodic.triangle(t - .25),
  square: t => periodic.square(t),
  sawtooth: t => periodic.sawtooth(t),
  clausen: t => periodic.clausen(t),
  // At full scale noise overpowers the drawing, whatever the window
  noise: t => .35 * periodic.noise(t),
}

// Ways to print the tone in two inks: dithers, per dot, and engravings, per line or mark
export const DITHERS = ['smooth', 'bayer2', 'bayer4', 'bayer8', 'blue', 'white', 'floyd', 'atkinson']
export const SCREENS = ['halftone', 'lines', 'spikes', 'contours', 'traces', 'mesh', 'guilloche', 'stipple']
const MODES = [...DITHERS, ...SCREENS]
const TONE = MODES.length // internal pass: raw tone, one texel per cell, read back for error diffusion

const LABELS = {
  bartlettHann: 'Bartlett–Hann', blackmanHarris: 'Blackman–Harris', blackmanNuttall: 'Blackman–Nuttall',
  confinedGaussian: 'Confined Gaussian', dpss: 'DPSS', exactBlackman: 'Exact Blackman', hannPoisson: 'Hann–Poisson',
  kaiserBesselDerived: 'Kaiser–Bessel', rifeVincent: 'Rife–Vincent',
  bayer2: 'Bayer 2×2', bayer4: 'Bayer 4×4', bayer8: 'Bayer 8×8', blue: 'Blue noise', white: 'White noise',
  floyd: 'Floyd–Steinberg', guilloche: 'Guilloché',
}
export const label = name => LABELS[name] ?? name.replace(/[A-Z]/g, c => ' ' + c.toLowerCase()).replace(/^./, c => c.toUpperCase())

// The logo's lobes stand .94 of the window's half-width, so the window's peak stands HEIGHT
const HEIGHT = .94 / (3 * Math.sqrt(3) / 8)
const SPAN = 1.2, SAMPLES = 2048 // the waveform texture covers x in ±SPAN, the window -1…1
const M = 256, PROFILE = 256     // samples per window, per gradient
const MORPH = 600                // ms from one choice to the next

// Error diffusion kernels as dx, dy, weight; dy runs down the page
const KERNELS = {
  floyd: [[1, 0, 7 / 16], [-1, 1, 3 / 16], [0, 1, 5 / 16], [1, 1, 1 / 16]],
  // Atkinson passes on 6/8 of the error and drops the rest: highlights and shadows stay clean
  atkinson: [[1, 0, 1 / 8], [2, 0, 1 / 8], [-1, 1, 1 / 8], [0, 1, 1 / 8], [1, 1, 1 / 8], [0, 2, 1 / 8]],
}

const VERT = `#version 300 es
void main() { gl_Position = vec4(vec2(gl_VertexID & 1, gl_VertexID >> 1) * 4. - 1., 0, 1); }`

const FRAG = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
${MODES.map((m, i) => `#define ${m.toUpperCase()} ${i}`).join('\n')}
#define TONE ${TONE}

uniform vec2 uCentre;   // where the axis crosses the middle of the window, device px
uniform float uScale;   // device px per unit
uniform float uCell;    // dot, device px
uniform float uGrid;    // fragments per cell: uCell on screen, 1 when writing one texel per cell
uniform float uPitch;   // line and screen period, a mark and its gap, device px
uniform float uWidth;   // a mark: dot, nib or line width, device px
uniform float uDuty;    // the share of a period a mark fills at full tone
uniform float uLines;   // lines across a lobe, for the engravings that follow it
uniform float uSpan;    // uWave covers x in -uSpan…uSpan
uniform int uMode;
uniform vec3 uGround, uFigure;
uniform sampler2D uWave, uProfile, uNoise, uDots;
out vec4 o;

const float PI = 3.14159265;

// The waveform, any: signed height, sampled by the page
float wave(float x) { return abs(x) < uSpan ? textureLod(uWave, vec2(.5 + .5 * x / uSpan, .5), 0.).r : 0.; }
float slope(float x) {
  float d = 2. * uSpan / float(textureSize(uWave, 0).x);
  return (wave(x + d) - wave(x - d)) / (2. * d);
}
// The gradient, paper 1 at the axis (t = 0) to ink 0 at the edge (t = 1)
float profile(float t) {
  float n = float(textureSize(uProfile, 0).x);
  return textureLod(uProfile, vec2((t * (n - 1.) + .5) / n, .5), 0.).r;
}

// The morph read backwards: a point under the waveform maps to the gradient rectangle's height t, 0 at the axis and
// 1 at the waveform's edge. Alongside: how much of an aa-wide cell the waveform covers, and how far inside its
// outline the point lies, device px
vec3 morph(vec2 p, float aa) {
  float h = wave(p.x), y = p.y * sign(h), top = abs(h), s = slope(p.x), lean = sqrt(1. + s * s);
  float cover = clamp(y / aa + .5, 0., 1.) + clamp((top - y) / (aa * lean) + .5, 0., 1.) - 1.;
  float edge = top > 1e-6 ? min(y, (top - y) / lean) * uScale : -1e3;
  return vec3(clamp(y / max(top, 1e-6), 0., 1.), max(cover, 0.), edge);
}
float tone(vec3 m) { return m.y * profile(m.x); }

// Ordered dither matrix of side 2^n by bit interleaving (Bayer 1973)
float bayer(uvec2 c, uint n) {
  uint v = 0u;
  for (uint i = 0u; i < n; i++) {
    uint x = c.x >> i & 1u, y = c.y >> i & 1u;
    v = v << 2 | (x ^ y) << 1 | x;
  }
  return (float(v) + .5) / float(1u << 2u * n);
}

// pcg2d (Jarzynski & Olano 2020)
float white(uvec2 v) {
  v = v * 1664525u + 1013904223u;
  v.x += v.y * 1664525u; v.y += v.x * 1664525u;
  v ^= v >> 16u;
  v.x += v.y * 1664525u; v.y += v.x * 1664525u;
  v ^= v >> 16u;
  return float(v.x >> 8) / 16777216.;
}

// Cosine spot on a 45° screen
float halftone(vec2 f) {
  vec2 k = f * (PI * 1.41421356 / uPitch);
  return .5 - .5 * cos(k.x) * cos(k.y);
}

// A line screen: 0 on each whole u, where a line is centred, 1 midway between
float tri(float u) { return abs(2. * fract(u + .5) - 1.); }

// Paper where the tone clears the threshold, antialiased across the threshold's edge
float screen(float v, float threshold) {
  float d = v - threshold, a = clamp(d / max(fwidth(d), 1e-4) + .5, 0., 1.);
  return v <= 0. ? 0. : v >= 1. ? 1. : a;
}

// A line of width w device px through each whole u, whatever the spacing
float rule(float u, float w) {
  float d = abs(u - round(u)) / max(length(vec2(dFdx(u), dFdy(u))), 1e-6);
  return clamp(w / 2. - d + .5, 0., 1.);
}

// Pen stippling: one nib-sized dot per cell, jittered, each inked if its blue-noise rank is under the tone at its
// centre. Denser where lighter, and even at every density.
float stipple(vec2 f) {
  float s = uPitch, r = uWidth / 2.;
  ivec2 base = ivec2(floor(f / s));
  float paper = 0.;
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    uvec2 k = uvec2(base + ivec2(i, j) + 4096);
    vec2 centre = (vec2(base + ivec2(i, j)) + .5 + .7 * (vec2(white(k), white(k + 7919u)) - .5)) * s;
    float d = length(f - centre);
    if (d > r + 1.) continue;
    if (texelFetch(uNoise, ivec2(k % 64u), 0).r < tone(morph((centre - uCentre) / uScale, 1. / uScale)))
      paper = max(paper, clamp(r - d + .5, 0., 1.));
  }
  return paper;
}

void main() {
  vec2 cell = floor(gl_FragCoord.xy / uGrid), c = gl_FragCoord.xy - uCentre;
  vec3 m = morph(((cell + .5) * uCell - uCentre) / uScale, uCell / uScale);
  float v = tone(m), mark = uDuty * v;
  // The gradient rectangle's rows bend with the waveform; its columns stand upright. Swelling with the tone up to a
  // mark wide, or one mark wide throughout; inside the outline, and the outline itself.
  float rows = screen(mark, tri(m.x * uLines)), columns = screen(mark, tri(c.x / uPitch));
  float row = rule(m.x * uLines, uWidth), column = rule(c.x / uPitch, uWidth);
  float inside = clamp(m.z + .5, 0., 1.), outline = clamp(uWidth / 2. - abs(m.z) + .5, 0., 1.);
  float wobble = .5 * sin(2. * PI * c.x / (6. * uPitch));
  float braid = max(screen(mark, tri(m.x * uLines + wobble)), screen(mark, tri(m.x * uLines - wobble)));
  uvec2 u = uvec2(cell);
  float paper = v;
  switch (uMode) {
    case BAYER2: paper = step(bayer(u, 1u), v); break;
    case BAYER4: paper = step(bayer(u, 2u), v); break;
    case BAYER8: paper = step(bayer(u, 3u), v); break;
    case BLUE: paper = step(texelFetch(uNoise, ivec2(u % 64u), 0).r, v); break;
    case WHITE: paper = step(white(u), v); break;
    case FLOYD: case ATKINSON: paper = texelFetch(uDots, ivec2(u), 0).r; break;
    case HALFTONE: paper = screen(mark, halftone(gl_FragCoord.xy)); break;
    // Paper lines as wide as the tone: rows of equal amplitude, upright columns, the rectangle's rows bent
    case LINES: paper = screen(mark, tri(c.y / uPitch)); break;
    case SPIKES: paper = columns; break;
    case CONTOURS: paper = rows; break;
    // The bent rows at one width: the waveform traced at every level down to the axis
    case TRACES: paper = max(inside * row, outline); break;
    // The bent grid itself: its rows, columns and outline, all one width
    case MESH: paper = max(inside * max(row, column), outline); break;
    // Two families of the bent rows, waving against each other as on a banknote
    case GUILLOCHE: paper = braid; break;
    case STIPPLE: paper = stipple(gl_FragCoord.xy); break;
  }
  o = uMode == TONE ? vec4(v, 0, 0, 1) : vec4(mix(uGround, uFigure, paper), 1);
}`

// A window as M samples across -1…1 with peak 1: flat top's cosine sum peaks at 4.64 as the collection documents it
const shapes = new Map()
function shape(name) {
  if (!shapes.has(name)) {
    const w = windows.generate(windows[name], M), peak = w.reduce((m, v) => Math.max(m, Math.abs(v)), 0) || 1
    shapes.set(name, w.map(v => v / peak))
  }
  return shapes.get(name)
}
function sample(w, x) {
  if (!(x >= -1 && x <= 1)) return 0
  const p = (x + 1) / 2 * (M - 1), i = Math.min(M - 2, p | 0)
  return w[i] + (w[i + 1] - w[i]) * (p - i)
}

// A gradient is half a window, centre to edge, stretched to run paper to ink: Bartlett's is linear, Hann's is
// sine ease-in-out, Gaussian's a softer one. Rectangular has no fall, so it fills flat.
const profiles = new Map()
function profileOf(name) {
  if (!profiles.has(name)) {
    const w = shape(name), top = sample(w, 0), end = sample(w, 1), fall = top - end
    profiles.set(name, Float32Array.from({ length: PROFILE }, (_, i) =>
      Math.abs(fall) < 1e-6 ? 1 : Math.min(1, Math.max(0, (sample(w, i / (PROFILE - 1)) - end) / fall))))
  }
  return profiles.get(name)
}

// Pickers' drawings: a window as its outline filled, a signal as one period traced, a gradient as its ramp
const path = (f, from, to) => Array.from({ length: 25 }, (_, i) => `${i ? 'L' : 'M'}${i} ${(6 - 5 * f(from + (to - from) * i / 24)).toFixed(2)}`).join('')
export const drawing = {
  window: name => `<svg class="icon" viewBox="0 0 24 12" aria-hidden="true"><path d="${path(x => 2 * sample(shape(name), x) - 1, -1, 1)}V11H0Z" fill="currentColor"/></svg>`,
  signal: name => `<svg class="icon" viewBox="0 0 24 12" aria-hidden="true"><path d="${path(SIGNALS[name], 0, 1)}" fill="none" stroke="currentColor" stroke-width="1.25"/></svg>`,
  gradient: name => {
    const p = profileOf(name), stops = Array.from({ length: 9 }, (_, i) => `color-mix(in srgb, currentColor ${(100 * p[Math.round(i / 8 * (PROFILE - 1))]).toFixed(0)}%, transparent)`)
    return `<span class="icon swatch" style="background: linear-gradient(to right, ${stops})"></span>`
  },
}

// What's drawn morphs to a new choice over MORPH ms, from wherever the last change had got to
function morpher(key) {
  let from = [[key, 1]], to = key, since = -Infinity
  const mix = now => {
    const k = Math.min(1, Math.max(0, now - since) / MORPH), e = k < .5 ? 4 * k ** 3 : 1 - (2 - 2 * k) ** 3 / 2
    const out = new Map([[to, e]])
    for (const [key, w] of from) out.set(key, (out.get(key) ?? 0) + w * (1 - e))
    return [...out].filter(([, w]) => w > 1e-4)
  }
  return {
    mix,
    to(key, now) { if (key !== to) from = mix(now), to = key, since = now },
    settled: now => now - since >= MORPH,
  }
}

// Any CSS color, the site's oklch tokens included, as sRGB channels 0…1
const ink = document.createElement('canvas').getContext('2d', { willReadFrequently: true })
function rgb(color) {
  ink.fillStyle = '#000'
  ink.fillStyle = color
  ink.fillRect(0, 0, 1, 1)
  return [...ink.getImageData(0, 0, 1, 1).data.slice(0, 3)].map(v => v / 255)
}
// Pixels read back from GL, rows bottom-up, as a PNG in one color with the red channel as opacity
const sheet = document.createElement('canvas')
function png(rgba, w, h, [r, g, b]) {
  Object.assign(sheet, { width: w, height: h })
  const context = sheet.getContext('2d'), image = context.createImageData(w, h)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const from = ((h - 1 - y) * w + x) * 4, to = (y * w + x) * 4
    image.data.set([r * 255, g * 255, b * 255, rgba[from]], to)
  }
  context.putImageData(image, 0, 0)
  return sheet.toDataURL('image/png')
}

// Blue-noise threshold map by void-and-cluster (Ulichney 1993), seeded so every load matches; made once per page
let blue
function blueNoise(n = 64, sigma = 1.5) {
  if (blue) return blue
  const N = n * n, R = 6, kern = []
  for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++)
    kern.push(dx, dy, Math.exp(-(dx * dx + dy * dy) / (2 * sigma * sigma)))
  let on = new Uint8Array(N), energy = new Float64Array(N)
  const set = (i, bit) => {
    on[i] = bit
    const x = i % n, y = (i - x) / n, sign = bit ? 1 : -1
    for (let k = 0; k < kern.length; k += 3)
      energy[(y + kern[k + 1] + n) % n * n + (x + kern[k] + n) % n] += sign * kern[k + 2]
  }
  const extreme = (bit, sign) => {
    let best = -1, e = -Infinity
    for (let i = 0; i < N; i++) if (on[i] === bit && sign * energy[i] > e) e = sign * energy[i], best = i
    return best
  }
  const cluster = () => extreme(1, 1), vacancy = () => extreme(0, -1)

  const rand = mulberry32(1), ones = Math.round(N / 10), rank = new Float32Array(N)
  for (let k = 0; k < ones;) { const i = rand() * N | 0; if (!on[i]) set(i, 1), k++ }
  // Move the tightest cluster into the largest void until nothing moves
  for (;;) { const c = cluster(); set(c, 0); const v = vacancy(); set(v, 1); if (v === c) break }
  const seed = [on.slice(), energy.slice()]
  for (let k = ones; k > 0;) { const c = cluster(); set(c, 0); rank[c] = --k }
  ;[on, energy] = seed
  for (let k = ones; k < N; k++) { const v = vacancy(); set(v, 1); rank[v] = k }
  return blue = rank.map(r => (r + .5) / N)
}

function mulberry32(a) {
  return () => {
    let t = a += 0x6D2B79F5
    t = Math.imul(t ^ t >>> 15, t | 1)
    t ^= t + Math.imul(t ^ t >>> 7, t | 61)
    return ((t ^ t >>> 14) >>> 0) / 4294967296
  }
}

// Serpentine error diffusion over the cell grid. rgba rows run bottom-up, as readPixels returns them;
// cells with no tone lie outside the shape and neither take nor pass on error.
function diffuse(rgba, w, h, kernel) {
  const e = new Float32Array(w * h), out = new Uint8Array(w * h)
  for (let i = 0; i < e.length; i++) e[i] = rgba[i * 4] / 255
  for (let row = 0; row < h; row++) {
    const y = h - 1 - row, dir = row & 1 ? -1 : 1
    for (let k = 0; k < w; k++) {
      const x = dir > 0 ? k : w - 1 - k, i = y * w + x
      if (!rgba[i * 4]) continue
      const q = e[i] > .5 ? 1 : 0, err = e[i] - q
      out[i] = q * 255
      for (const [dx, dy, wt] of kernel) {
        const nx = x + dx * dir, ny = y - dy
        if (nx >= 0 && nx < w && ny >= 0) e[ny * w + nx] += err * wt
      }
    }
  }
  return out
}

/**
 * Draws the logo into a canvas, sized to it. Returns null without WebGL 2.
 * set({ signal, window, gradient, print, cycles, phase, amplitude, size, gap, ground, figure }) changes what's drawn:
 * signal, window and gradient morph over MORPH ms; phase is in turns; size, a mark's, and gap, between marks, in
 * CSS px; colors any CSS color.
 * render(now) draws a frame and tells whether a morph is still under way.
 */
export function logo(canvas, { onresize } = {}) {
  const gl = canvas.getContext('webgl2', { antialias: false, alpha: false })
  if (!gl) return null
  const state = { signal: 'sine', window: 'hann', gradient: 'bartlett', print: 'bayer4', cycles: 1, phase: 0, amplitude: 1, size: 2, gap: 6, ground: '#000', figure: '#fff' }
  const wave = morpher(`${state.signal} ${state.window}`), fill = morpher(state.gradient)

  const prog = program(gl), U = {}
  gl.useProgram(prog)
  for (let i = 0; i < gl.getProgramParameter(prog, gl.ACTIVE_UNIFORMS); i++) {
    const { name } = gl.getActiveUniform(prog, i)
    U[name] = gl.getUniformLocation(prog, name)
  }
  gl.uniform1i(U.uNoise, 0)
  gl.uniform1i(U.uDots, 1)
  gl.uniform1i(U.uWave, 3)
  gl.uniform1i(U.uProfile, 4)
  gl.uniform1f(U.uSpan, SPAN)
  texture(gl, 0)
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, 64, 64, 0, gl.RED, gl.FLOAT, blueNoise())
  texture(gl, 1)
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1)
  const [toneFbo] = target(gl, 2), [outFbo] = target(gl, 5)
  texture(gl, 3, gl.LINEAR)
  texture(gl, 4, gl.LINEAR)

  const xs = Float32Array.from({ length: SAMPLES }, (_, i) => SPAN * (2 * (i + .5) / SAMPLES - 1))
  const heights = new Float32Array(SAMPLES), profile = new Float32Array(PROFILE)
  const upload = (unit, data) => {
    gl.activeTexture(gl.TEXTURE0 + unit)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R16F, data.length, 1, 0, gl.RED, gl.FLOAT, data)
  }
  const pass = (w, h, grid, mode) => {
    gl.viewport(0, 0, w, h)
    gl.uniform1f(U.uGrid, grid)
    gl.uniform1i(U.uMode, mode)
    gl.drawArrays(gl.TRIANGLES, 0, 3)
  }

  // Prints the uploaded waveform and gradient in a mode, onto the canvas or, for pixels, into memory.
  // dot is a mark's size and gap the space between marks, device px; lines, how many cross a lobe.
  function print(mode, { width: W, height: H, dot, gap, scale, centre, lines, ground, figure, pixels = false }) {
    const kernel = KERNELS[mode], cell = mode === 'smooth' || SCREENS.includes(mode) ? 1 : dot
    gl.uniform3fv(U.uGround, ground)
    gl.uniform3fv(U.uFigure, figure)
    gl.uniform2f(U.uCentre, ...centre)
    gl.uniform1f(U.uScale, scale)
    gl.uniform1f(U.uCell, cell)
    gl.uniform1f(U.uPitch, dot + gap)
    gl.uniform1f(U.uWidth, dot)
    gl.uniform1f(U.uDuty, dot / (dot + gap))
    gl.uniform1f(U.uLines, lines)
    if (kernel) {
      const w = Math.ceil(W / cell), h = Math.ceil(H / cell), rgba = new Uint8Array(w * h * 4)
      size(gl, 2, w, h)
      gl.bindFramebuffer(gl.FRAMEBUFFER, toneFbo)
      pass(w, h, 1, TONE)
      gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, rgba)
      gl.activeTexture(gl.TEXTURE1)
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, w, h, 0, gl.RED, gl.UNSIGNED_BYTE, diffuse(rgba, w, h, kernel))
    }
    if (pixels) size(gl, 5, W, H)
    gl.bindFramebuffer(gl.FRAMEBUFFER, pixels ? outFbo : null)
    pass(W, H, cell, MODES.indexOf(mode))
    if (!pixels) return
    const rgba = new Uint8Array(W * H * 4)
    gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, rgba)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    return rgba
  }

  // Device px per unit, framed so the window's full height fits
  const scale = () => Math.min(canvas.width / 2.5, canvas.height / (2.1 * HEIGHT))

  function set(changes) {
    const now = performance.now()
    Object.assign(state, changes)
    wave.to(`${state.signal} ${state.window}`, now)
    fill.to(state.gradient, now)
  }

  function render(now = performance.now()) {
    const turn = state.phase, n = state.cycles
    heights.fill(0)
    for (const [key, weight] of wave.mix(now)) {
      const [signalName, windowName] = key.split(' '), f = SIGNALS[signalName], w = shape(windowName), a = HEIGHT * weight * state.amplitude
      for (let i = 0; i < SAMPLES; i++) {
        const x = xs[i]
        if (x >= -1 && x <= 1) heights[i] += a * sample(w, x) * f(n * x / 2 + .5 - turn)
      }
    }
    profile.fill(0)
    for (const [name, weight] of fill.mix(now)) {
      const p = profileOf(name)
      for (let i = 0; i < PROFILE; i++) profile[i] += weight * p[i]
    }
    upload(3, heights)
    upload(4, profile)
    const { width: W, height: H, clientWidth } = canvas
    if (W && H && clientWidth) {
      const s = scale(), px = W / clientWidth, dot = Math.max(1, Math.round(state.size * px)), gap = state.gap * px // CSS px to canvas px
      print(state.print, { width: W, height: H, dot, gap, scale: s, centre: [W / 2, H / 2], lines: Math.max(2, Math.round(HEIGHT * s / (dot + gap))), ground: rgb(state.ground), figure: rgb(state.figure) })
    }
    return !wave.settled(now) || !fill.settled(now)
  }

  // A print mode as a mask: the gradient rectangle itself, unbent, printed that way. Uploads its own waveform;
  // the next render puts the logo's back.
  function icon(mode, width = 48, height = 24) {
    upload(3, xs.map(x => Math.abs(x) < 1 ? 1 : 0))
    upload(4, profileOf('bartlett'))
    return png(print(mode, { width, height, dot: 2, gap: 4, scale: width / 2, centre: [width / 2, 0], lines: height / 6, ground: [0, 0, 0], figure: [1, 1, 1], pixels: true }), width, height, [1, 1, 1])
  }

  // The waveform as last rendered, smooth, in one color with the tone as opacity: a favicon
  function favicon(color, size = 64) {
    return png(print('smooth', { width: size, height: size, dot: 1, gap: 0, scale: size / 2, centre: [size / 2, size / 2], lines: 2, ground: [0, 0, 0], figure: [1, 1, 1], pixels: true }), size, size, rgb(color))
  }

  const resize = new ResizeObserver(([e]) => {
    const box = e.devicePixelContentBoxSize?.[0]
    canvas.width = box ? box.inlineSize : Math.round(e.contentRect.width * devicePixelRatio)
    canvas.height = box ? box.blockSize : Math.round(e.contentRect.height * devicePixelRatio)
    onresize?.()
  })
  try { resize.observe(canvas, { box: 'device-pixel-content-box' }) } catch { resize.observe(canvas) }

  return { set, render, icon, favicon, scale, state }
}

function program(gl) {
  const p = gl.createProgram()
  for (const [type, src] of [[gl.VERTEX_SHADER, VERT], [gl.FRAGMENT_SHADER, FRAG]]) {
    const s = gl.createShader(type)
    gl.shaderSource(s, src)
    gl.compileShader(s)
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s))
    gl.attachShader(p, s)
  }
  gl.linkProgram(p)
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p))
  return p
}

function texture(gl, unit, filter = gl.NEAREST) {
  const t = gl.createTexture()
  gl.activeTexture(gl.TEXTURE0 + unit)
  gl.bindTexture(gl.TEXTURE_2D, t)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  return t
}

// A framebuffer drawing into an RGBA texture held on its own unit, never sampled while drawn into
function target(gl, unit) {
  const fbo = gl.createFramebuffer(), t = texture(gl, unit)
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo)
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0)
  gl.bindFramebuffer(gl.FRAMEBUFFER, null)
  return [fbo, t]
}
function size(gl, unit, w, h) {
  gl.activeTexture(gl.TEXTURE0 + unit)
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)
}
