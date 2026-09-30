/**
 * gl-spectrogram – WebGL2 spectrogram renderer.
 *
 * Each render computes what its viewport shows, on the GPU: one FFT frame per device-pixel column, read straight from
 * the samples in float textures, a Stockham FFT (radix 8) in fragment passes, then reassignment (Kodera, Gendrin & de
 * Villedary 1976; Auger & Flandrin 1995): each bin's energy is drawn as a point at the time and frequency its phase
 * places it, summed into a float texture of columns × rows. A steady sine draws one row thin, a click one column thin.
 * Columns sit on a grid anchored to multiples of samples per column and are kept, so a pan computes only what it
 * uncovers. Zoomed out, where a column outspans a window, later renders add frames till every sample is in one.
 */

const LW = 2048, LH = 512, LB = 20  // sample texture layer: LW × LH = 2^LB samples
const C = 1 << 16                   // samples per storage chunk, 32 texture rows
const MAX = 2 ** 31 - (1 << 16)     // samples addressable: GPU positions are int32
const SCRATCH = 1 << 21             // FFT scratch texels per texture: 32 MB of RGBA32F
const WHOLE = 1024, WROWS = 512     // the whole data's picture: its loudest cell is the top of auto levels
const NMIN = 256, NMAX = 4096       // auto FFT sizes: 4096 costs 3× 2048 a frame, 8192 3× more
const WINDOW = .04                  // shortest auto FFT, seconds
const TOP = -60                     // auto levels never put the top below this, dB
const HALF = 32768                  // half-float cells hold power × HALF: a full-scale sine at 2^15, 80 dB below it normal
const DEPTH = 80

const ATTRS = { premultipliedAlpha: true, preserveDrawingBuffer: true, antialias: false, depth: false, stencil: false }
const WHITE = [1, 1, 1, 1], BLACK = [0, 0, 0, 1]

// ── frequency axes ───────────────────────────────────────────────────────

// Where f sits between lo and hi as 0..1, and back. Rows are spaced evenly on the scale.
//   log  equal space per octave; its axis starts at 20 Hz, the floor of hearing
//   mel  equal space per mel, 2595 · log10(1 + f / 700) (O'Shaughnessy 1987, as in HTK); near linear under 1 kHz
//   lin  equal space per hertz, from 0
const mel = f => 2595 * Math.log10(1 + f / 700), hertz = m => 700 * (10 ** (m / 2595) - 1)
const WARP = { log: [Math.log2, u => 2 ** u], mel: [mel, hertz], lin: [f => f, f => f] }
const axis = (name, low) => {
  let [to, from] = WARP[name]
  return { low, at: (f, lo, hi) => (to(f) - to(lo)) / (to(hi) - to(lo)), of: (u, lo, hi) => from(to(lo) + u * (to(hi) - to(lo))) }
}
export const scales = { log: axis('log', 20), mel: axis('mel', 0), lin: axis('lin', 0) }
const SCALE = { log: 0, mel: 1, lin: 2 }

// ── shaders ──────────────────────────────────────────────────────────────

const HEAD = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
precision highp isampler2D;
precision highp sampler2DArray;
`
const QUAD = HEAD + `void main() { gl_Position = vec4(vec2(gl_VertexID & 1, gl_VertexID >> 1) * 2. - 1., 0, 1); }`

// FFT: Stockham autosort (natural order in, natural order out), radix 8 after a first stage of radix 2, 4 or 8 that
// reads the samples. A texel holds two frames: [re, im] of frame 2y, then of 2y + 1. A stage joins R transforms of L
// points: output x = q·RL + r·L + m sums inputs j + k·N/R (j = q·L + m) times W^k, W = e^(-2πi(m/RL + r/R)).
const FFT = `
uniform sampler2D tw;           // e^(-2πik/N), k < N/2
uniform int N;
out vec4 o;
vec2 mul(vec2 a, vec2 b) { return vec2(a.x * b.x - a.y * b.y, a.x * b.y + a.y * b.x); }
vec2 W(int e) { e &= N - 1; vec2 w = texelFetch(tw, ivec2(e & ((N >> 1) - 1), 0), 0).xy; return e >= N >> 1 ? -w : w; }
`
const FIRST = R => HEAD + FFT + `
uniform sampler2DArray samples; // ${LW} × ${LH} a layer
uniform isampler2D layers;      // layer of each 2^${LB}-sample block, -1 where nothing was written
uniform sampler2D frames;       // per frame: [first sample ÷ 65536, its remainder, column from the run's first, center], 1024 a row
uniform int len, blocks;

// A frame: its first sample, and the layers of the two blocks it can span
struct F { int s, b, l0, l1; };
int layer(int b) { return b >= 0 && b < blocks ? texelFetch(layers, ivec2(b, 0), 0).r : -1; }
F frame(int f) {
  vec4 p = texelFetch(frames, ivec2(f & 1023, f >> 10), 0);
  int s = int(p.x) * 65536 + int(p.y), b = s >> ${LB};
  return F(s, b, layer(b), layer(b + 1));
}
float at(F f, int n) {
  int s = f.s + n, l = s >> ${LB} == f.b ? f.l0 : f.l1;
  if (s < 0 || s >= len || l < 0) return 0.;
  float v = texelFetch(samples, ivec3(s & ${LW - 1}, (s >> ${Math.log2(LW)}) & ${LH - 1}, l), 0).r;
  return (floatBitsToUint(v) & 0x7f800000u) == 0x7f800000u ? 0. : v; // NaN, ±Infinity: silence
}
// z[n] = x[n] · (1, (n - N/2) · hann[n] · 2/N): the samples in re, Hann-and-time weighted in im; one FFT gives both
vec2 window(int n) {
  int h = N >> 1;
  float c = n < h ? texelFetch(tw, ivec2(n, 0), 0).x : -texelFetch(tw, ivec2(n - h, 0), 0).x;
  return vec2(1, float(n - h) * (1. - c) / float(N));
}

void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  int r = p.x % ${R}, j = p.x / ${R}, q = N / ${R};
  F a = frame(2 * p.y), b = frame(2 * p.y + 1);
  for (int k = 0; k < ${R}; k++) {
    int n = j + k * q;
    vec2 z = window(n), w = W(k * r * q), za = at(a, n) * z, zb = at(b, n) * z;
    o = k == 0 ? vec4(za, zb) : o + vec4(mul(w, za), mul(w, zb));
  }
}`
// the twiddles W^k by recurrence from one fetch: 7 products lose under 1e-6 of the value
const STAGE = HEAD + FFT + `
uniform sampler2D src;
uniform int L;
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  int m = p.x % L, r = (p.x / L) & 7, q = N >> 3, j = p.x / (L * 8) * L + m;
  vec2 w1 = W(m * (N / (L * 8)) + r * q), w = vec2(1, 0);
  o = texelFetch(src, ivec2(j, p.y), 0);
  for (int k = 1; k < 8; k++) { w = mul(w, w1); vec4 t = texelFetch(src, ivec2(j + k * q, p.y), 0); o += vec4(mul(w, t.xy), mul(w, t.zw)); }
}`
// Radices for N: 8s after a first 2, 4 or 8
const plan = N => { let n = Math.log2(N), r = n % 3 || 3; return [1 << r, ...Array((n - r) / 3).fill(8)] }

// A point per frame and bin, at its reassigned column and row, carrying its power. From z = X + iY: X is the
// rectangular spectrum, from which Hann and its derivative follow in three bins; Y is the time-weighted Hann's.
//   frequency  k̂ = k − N / 2π · Im(X_dh · X̄_h) / |X_h|²     time  t̂ = t + Re(X_th · X̄_h) / |X_h|²  (samples)
const SCATTER = HEAD + `
uniform sampler2D spec, frames;
uniform int N, k0, nb, cap, slot, span, rows, scale;
uniform float cw, norm, hz, b0, bk; // samples per column; power → level; Hz per bin; row = (warp(Hz) - b0) · bk
flat out float v;

vec2 Z(int f, int k, bool e) { vec4 t = texelFetch(spec, ivec2(k & (N - 1), f), 0); return e ? t.zw : t.xy; }
vec2 X(int f, int k, bool e) { vec2 a = Z(f, k, e), b = Z(f, N - k, e); return .5 * vec2(a.x + b.x, a.y - b.y); }
float warp(float f) { return scale == 0 ? log2(f) : scale == 1 ? ${2595 / Math.LN10} * log(1. + f / 700.) : f; }

void main() {
  int i = gl_VertexID / nb, k = k0 + gl_VertexID - i * nb, f = i >> 1;
  bool e = (i & 1) == 1;
  gl_PointSize = 1.;
  gl_Position = vec4(2, 2, 2, 1); // outside the clip volume: dropped
  v = 0.;
  vec2 a = Z(f, k, e), b = Z(f, N - k, e), xm = X(f, k - 1, e), xp = X(f, k + 1, e), d = xm - xp;
  vec2 h = .25 * vec2(a.x + b.x, a.y - b.y) - .25 * (xm + xp);  // Hann
  vec2 dh = ${Math.PI / 2} / float(N) * vec2(d.y, -d.x);        // its derivative
  vec2 th = float(N >> 2) * vec2(a.y + b.y, b.x - a.x);          // Hann × (n - N/2)
  float P = dot(h, h), p = P * norm;
  if (!(p > 1e-20)) return;
  float fq = (float(k) - float(N) * ${1 / (2 * Math.PI)} * (dh.y * h.x - dh.x * h.y) / P) * hz;
  float dt = (th.x * h.x + th.y * h.y) / P;
  // energy placed outside the window, or outside 0..Nyquist, is not the frame's to give
  if (abs(dt) > float(N >> 1) || (scale == 0 ? fq <= 0. : fq < 0.)) return;
  // the column from the frame's own, so a point lands in the same column whichever run computes it
  vec4 fr = texelFetch(frames, ivec2(i & 1023, i >> 10), 0);
  float r = floor((warp(fq) - b0) * bk), c = fr.z + floor(fr.w + dt / cw);
  if (r < 0. || r >= float(rows) || c < 0. || c >= float(span)) return;
  gl_Position = vec4((float((slot + int(c)) & (cap - 1)) + .5) / float(cap) * 2. - 1., (r + .5) / float(rows) * 2. - 1., 0, 1);
  v = p;
}`

const POINT = HEAD + `
flat in float v;
out vec4 o;
void main() { o = vec4(v, 0, 0, 0); }`

// A texture as it is, onto the target's same texels (blended there by MAX)
const COPY = HEAD + `
uniform sampler2D src;
out vec4 o;
void main() { o = texelFetch(src, ivec2(gl_FragCoord.xy), 0); }`

// Largest of each 8 × 8 block
const REDUCE = HEAD + `
uniform sampler2D src;
uniform ivec2 size;
uniform float most;
out vec4 o;
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy) * 8;
  float m = 0.;
  for (int y = 0; y < 8; y++) for (int x = 0; x < 8; x++) {
    ivec2 q = p + ivec2(x, y);
    if (q.x < size.x && q.y < size.y) m = max(m, texelFetch(src, q, 0).r);
  }
  o = vec4(min(m, most), 0, 0, 0);
}`

// The picture: a device pixel's cell, its level in dB, its color from the table
const DRAW = HEAD + `
uniform sampler2D cells, peak, lut;
uniform vec2 origin;         // viewport corner, device px
uniform int slot, cap;       // slot of column q0
uniform float f0, ratio;     // column position of the viewport's left edge from q0; columns per px
uniform vec2 data;           // columns holding samples, from q0
uniform float unit, gain, depth;  // power of a cell unit; gain², applied to cells; auto levels' depth, dB
uniform vec2 levels;         // dB at the floor and the top, when pinned
uniform int pinned;         // 1: levels as given; 0: the top from the whole data's loudest cell
out vec4 o;
float db(float p) { return ${10 / Math.LN10} * log(max(p, 1e-30)); }
void main() {
  vec2 p = gl_FragCoord.xy - origin;
  float c = f0 + p.x * ratio;
  if (c < data.x || c >= data.y) { o = vec4(0); return; }
  float v = texelFetch(cells, ivec2((slot + int(floor(c))) & (cap - 1), int(p.y)), 0).r;
  vec2 lv = levels;
  if (pinned == 0) { lv.y = max(db(texelFetch(peak, ivec2(0), 0).r * unit), ${TOP}.); lv.x = lv.y - depth; }
  float t = clamp((db(v * unit * gain) - lv.x) / (lv.y - lv.x), 0., 1.);
  o = texture(lut, vec2((t * 255. + .5) / 256., .5));
}`

const PROGRAMS = {
  first2: [QUAD, FIRST(2), { samples: 2, layers: 3, frames: 4, tw: 1 }, ['N', 'len', 'blocks']],
  first4: [QUAD, FIRST(4), { samples: 2, layers: 3, frames: 4, tw: 1 }, ['N', 'len', 'blocks']],
  first8: [QUAD, FIRST(8), { samples: 2, layers: 3, frames: 4, tw: 1 }, ['N', 'len', 'blocks']],
  stage: [QUAD, STAGE, { src: 0, tw: 1 }, ['N', 'L']],
  scatter: [SCATTER, POINT, { spec: 0, frames: 4 }, ['N', 'k0', 'nb', 'cap', 'slot', 'span', 'rows', 'scale', 'cw', 'norm', 'hz', 'b0', 'bk']],
  copy: [QUAD, COPY, { src: 0 }, []],
  reduce: [QUAD, REDUCE, { src: 0 }, ['size', 'most']],
  draw: [QUAD, DRAW, { cells: 0, peak: 1, lut: 5 }, ['origin', 'slot', 'cap', 'f0', 'ratio', 'data', 'unit', 'gain', 'depth', 'levels', 'pinned']]
}
const UNPACK = ['UNPACK_ALIGNMENT', 4, 'UNPACK_ROW_LENGTH', 0, 'UNPACK_IMAGE_HEIGHT', 0, 'UNPACK_SKIP_ROWS', 0, 'UNPACK_SKIP_PIXELS', 0, 'UNPACK_SKIP_IMAGES', 0, 'UNPACK_FLIP_Y_WEBGL', 0, 'UNPACK_PREMULTIPLY_ALPHA_WEBGL', 0]

// Programs, FFT scratch and twiddles are shared by all instances on a context and dropped when it is lost
const contexts = new WeakMap()

export default class Spectrogram {
  #chunks = []           // samples: Float32Array chunks of C, null where nothing was written (reads as silence)
  #owned = new WeakSet() // chunks this instance allocated; the rest are views of the caller's array, never written
  #n = 0                 // length
  #blocks = []           // sample texture layer of each 2^LB-sample block, undefined where nothing was written
  #layers = 0            // layers in use
  #fresh = new Uint8Array(0) // per texture row of LW samples: 1 where the GPU holds it as it is
  #tex = null            // samples, a layer per block
  #depth = 0             // its layers
  #index = null          // #blocks as a texture
  #indexed = false
  #range = null          // [from, to] or null for all data
  #band = null           // [low, high] Hz or null for the scale's floor to Nyquist
  #scale = 'log'
  #rate = 44100
  #viewport = null       // CSS px [x, y, w, h] or null for the whole canvas
  #pixelRatio = null
  #levels = null         // [floor, top] dB, or null: the top is the loudest, `#below` dB of depth
  #below = DEPTH
  #gain = 1
  #size = null           // FFT size, or null to fit the zoom
  #color = WHITE         // top of the ramp
  #background = BLACK    // under the canvas, where the ramp starts
  #stops = null          // colormap, in place of the ramp
  #lut = null            // level → color, 256 texels
  #painted = false
  #views = []            // caches of computed columns, most recent first
  #whole = null          // { K, chain: [{ tex, fbo, w, h }], dirty }: the whole data's picture and its loudest cell
  #wide = 0              // widest viewport drawn, device px: sizes the caches
  #drawn = false
  #pending = false       // the last render drew columns from fewer frames than they will have
  #spent = 0             // frames transformed by this render

  constructor(target, options) {
    let gl = target?.getContext ? target.getContext('webgl2', ATTRS) : target
    if (!(gl instanceof WebGL2RenderingContext)) throw TypeError('gl-spectrogram: expected a canvas that supports WebGL2, or a WebGL2RenderingContext')
    if (!gl.isContextLost() && !gl.getExtension('EXT_color_buffer_float')) throw TypeError('gl-spectrogram: WebGL2 without EXT_color_buffer_float cannot render to float textures')
    this.gl = gl
    this.canvas = gl.canvas
    this.canvas.addEventListener?.('webglcontextlost', this.#lost)
    this.canvas.addEventListener?.('webglcontextrestored', this.#restored)
    if (!gl.isContextLost()) context(gl, false)
    if (options) this.update(options)
  }

  get length() { return this.#n }
  get range() { return this.#range ? [...this.#range] : [0, this.#n] }
  get band() { return this.#band ? [...this.#band] : [scales[this.#scale].low, this.#rate / 2] }
  /** FFT size of the current view */
  get size() { return this.#view()?.N ?? this.#size }
  /** The last render drew some columns from fewer frames than they will have: render again to draw them whole */
  get pending() { return this.#pending }
  /** [floor, top] in dB; with auto levels, the top is the whole data's loudest cell, at least -60 dB */
  get levels() {
    if (this.#levels) return [...this.#levels]
    let gl = this.gl, top = TOP
    if (this.#n && !gl.isContextLost()) {
      let c = context(gl), px = new Float32Array(4)
      this.#upload()
      let last = this.#peak().at(-1)
      gl.bindFramebuffer(gl.FRAMEBUFFER, last.fbo)
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.FLOAT, px)
      gl.bindFramebuffer(gl.FRAMEBUFFER, null)
      top = Math.max(10 * Math.log10(px[0] * (c.half ? 1 / HALF : 1)), TOP)
    }
    return [top - this.#below, top]
  }

  /** Set any option (see index.d.ts); undefined keeps, null restores the default. */
  update(o = {}) {
    let gl = this.gl
    if (o.data !== undefined) this.#load(o.data)
    if (o.sampleRate !== undefined) this.#rate = o.sampleRate == null ? 44100 : positive(o.sampleRate, 'sampleRate')
    if (o.range !== undefined) this.#range = o.range && nums(o.range, 2, 'range')
    if (o.scale !== undefined) {
      if (o.scale != null && !SCALE.hasOwnProperty(o.scale)) throw TypeError(`gl-spectrogram: scale must be log, mel or lin, not ${o.scale}`)
      this.#scale = o.scale ?? 'log'
    }
    if (o.band !== undefined) this.#band = o.band && nums(o.band, 2, 'band')
    if (this.#band && !(this.#band[0] < this.#band[1] && this.#band[0] >= 0 && (this.#scale !== 'log' || this.#band[0] > 0)))
      throw RangeError(`gl-spectrogram: band must be [low, high] Hz, 0 ≤ low < high${this.#scale === 'log' ? ', low > 0 on a log scale' : ''}`)
    if (o.viewport !== undefined) this.#viewport = o.viewport && nums(o.viewport, 4, 'viewport')
    if (o.pixelRatio !== undefined) this.#pixelRatio = o.pixelRatio == null ? null : positive(o.pixelRatio, 'pixelRatio')
    if (o.levels !== undefined) {
      this.#levels = o.levels && nums(o.levels, 2, 'levels')
      if (this.#levels && !(this.#levels[0] < this.#levels[1])) throw RangeError('gl-spectrogram: levels must be [floor, top] dB, floor < top')
    }
    if (o.depth !== undefined) this.#below = o.depth == null ? DEPTH : positive(o.depth, 'depth')
    if (o.gain !== undefined) this.#gain = o.gain == null ? 1 : nums([o.gain], 1, 'gain')[0]
    if (o.size !== undefined) {
      if (o.size != null && !(Number.isInteger(Math.log2(o.size)) && o.size >= 16 && o.size <= 16384)) throw TypeError('gl-spectrogram: size must be a power of two from 16 to 16384')
      this.#size = o.size ?? null
    }
    if (o.color !== undefined) {
      let c = o.color
      if (c == null || typeof c === 'string' || typeof c[0] === 'number') { this.#color = c == null ? WHITE : rgba(c, gl); this.#stops = null }
      else {
        this.#stops = Array.from(c, s => rgba(s, gl))
        if (this.#stops.length < 2) throw TypeError('gl-spectrogram: a colormap needs two colors or more')
      }
      this.#painted = false
    }
    if (o.background !== undefined) { this.#background = o.background == null ? BLACK : rgba(o.background, gl); this.#painted = false }
    return this
  }

  /** Append samples. */
  push(samples) { return this.set(samples, this.#n) }

  /** Write samples at offset, extending the data if needed; a gap before offset reads as silence. */
  set(samples, offset = 0) {
    offset = Math.trunc(offset)
    if (!(offset >= 0)) throw RangeError('gl-spectrogram: offset must be ≥ 0')
    if (!ArrayBuffer.isView(samples)) samples = Float32Array.from(samples)
    let end = offset + samples.length
    if (end === offset) return this
    if (end > MAX) throw RangeError(`gl-spectrogram: data ends past sample ${MAX}`)
    for (let i = offset; i < end;) {
      let j = Math.floor(i / C), o = i - j * C, m = Math.min(C - o, end - i)
      this.#own(j).set(samples.subarray(i - offset, i - offset + m), o)
      this.#mark(j, o, o + m)
      i += m
    }
    this.#n = Math.max(this.#n, end)
    this.#invalidate(offset, end)
    return this
  }

  /** Draw into the viewport, over what is there. */
  render() {
    let gl = this.gl
    this.#drawn = true
    if (gl.isContextLost()) return this
    let v = this.#view()
    if (!v) return this
    let c = context(gl)
    this.#upload()
    let K = this.#cache(v), a = Math.max(v.q0, 0), b = Math.min(v.q1, Math.ceil(this.#n / K.cw))
    this.#spent = 0
    this.#need(K, a, b)
    // columns wider than half a window get more frames, as many as the render has left of a frame per 2 pixel columns
    // (256 at least, a third of a millisecond on an M4 Max)
    this.#pending = K.sub > 1 && this.#refine(K, a, b, Math.max(v.W / 2, 256) - this.#spent)
    let peak = this.#levels ? K : this.#peak().at(-1)
    this.#paint()

    let { X, Y, W, H } = v, { prog, u } = c.draw
    this.#target(X, Y, W, H)
    gl.disable(gl.DEPTH_TEST)
    gl.disable(gl.STENCIL_TEST)
    gl.disable(gl.CULL_FACE)
    gl.enable(gl.BLEND)
    gl.blendEquation(gl.FUNC_ADD)
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA)
    gl.viewport(X, Y, W, H)
    gl.useProgram(prog)
    gl.bindVertexArray(c.vao)
    bind(gl, 0, gl.TEXTURE_2D, K.tex)
    bind(gl, 1, gl.TEXTURE_2D, peak.tex)
    bind(gl, 5, gl.TEXTURE_2D, this.#lut)
    let lv = this.#levels ?? [0, 0], last = this.#n / K.cw - v.q0
    gl.uniform2f(u.origin, X, Y)
    gl.uniform1i(u.slot, v.q0 & (K.cap - 1))
    gl.uniform1i(u.cap, K.cap)
    gl.uniform1f(u.f0, v.f0)
    gl.uniform1f(u.ratio, v.ratio)
    gl.uniform2f(u.data, Math.max(-v.q0, -1), Math.min(last, W + 2))
    gl.uniform1f(u.unit, c.half ? 1 / HALF : 1)
    gl.uniform1f(u.gain, this.#gain * this.#gain)
    gl.uniform1f(u.depth, this.#below)
    gl.uniform2f(u.levels, lv[0], lv[1])
    gl.uniform1i(u.pinned, this.#levels ? 1 : 0)
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
    return this
  }

  /** Clear the viewport to transparent. */
  clear() {
    let gl = this.gl
    if (gl.isContextLost()) return this
    this.#target(...this.#rect())
    gl.clearColor(0, 0, 0, 0)
    gl.clear(gl.COLOR_BUFFER_BIT)
    return this
  }

  /**
   * The cell at x, y CSS px from the viewport's top-left: { from, to, low, high, level }, or with y left out the column:
   * { from, to, levels } with a level per row from the bottom. Samples [from, to), Hz [low, high), dB. null off the data.
   */
  pick(x, y) {
    let gl = this.gl
    if (gl.isContextLost()) return null
    let v = this.#view()
    if (!v) return null
    let pr = this.#pr(), px = Math.floor(((this.#viewport?.[0] ?? 0) + x) * pr) - v.X, row = null
    if (!(px >= 0 && px < v.W)) return null
    if (y !== undefined) {
      let py = Math.floor(((this.#viewport?.[1] ?? 0) + y) * pr) - (gl.drawingBufferHeight - v.Y - v.H)
      if (!(py >= 0 && py < v.H)) return null
      row = v.H - 1 - py
    }
    let c = context(gl)
    this.#upload()
    let K = this.#cache(v), cw = K.cw, q = v.q0 + Math.floor(v.f0 + (px + .5) * v.ratio)
    if (q < 0 || q >= Math.ceil(this.#n / cw)) return null
    this.#need(K, q, q + 1)
    let h = row == null ? v.H : 1, out = new Float32Array(4 * h), k = (c.half ? 1 / HALF : 1) * this.#gain * this.#gain
    gl.bindFramebuffer(gl.FRAMEBUFFER, K.fbo)
    gl.readPixels(q & (K.cap - 1), row ?? 0, 1, h, gl.RGBA, gl.FLOAT, out)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    let from = Math.max(0, Math.ceil(q * cw - .5)), to = Math.min(this.#n, Math.ceil((q + 1) * cw - .5))
    let db = i => 10 * Math.log10(out[4 * i] * k)
    if (row == null) return { from, to, levels: Float32Array.from({ length: h }, (_, i) => db(i)) }
    let of = WARP[this.#scale][1]
    return { from, to, low: of(v.b0 + row / v.bk), high: of(v.b0 + (row + 1) / v.bk), level: db(0) }
  }

  destroy() {
    let gl = this.gl
    this.canvas.removeEventListener?.('webglcontextlost', this.#lost)
    this.canvas.removeEventListener?.('webglcontextrestored', this.#restored)
    if (!gl.isContextLost()) {
      for (let t of [this.#tex, this.#index, this.#lut]) gl.deleteTexture(t)
      for (let K of [...this.#views, this.#whole?.K, ...this.#whole?.chain ?? []]) if (K) { gl.deleteTexture(K.tex); gl.deleteFramebuffer(K.fbo) }
    }
    this.#tex = this.#index = this.#lut = this.#whole = null
    this.#views = []
    this.#chunks = []
    this.#blocks = []
    this.#fresh = new Uint8Array(0)
    this.#n = this.#layers = this.#depth = 0
  }

  // ── data ────────────────────────────────────────────────────────────────

  #load(data) {
    let d = data instanceof Float32Array ? data : Float32Array.from(data ?? [])
    if (d.length > MAX) throw RangeError(`gl-spectrogram: data longer than ${MAX} samples`)
    this.#chunks = []
    this.#blocks = []
    this.#layers = 0
    this.#fresh = new Uint8Array(Math.ceil(d.length / LW))
    for (let i = 0; i < d.length; i += C) {
      this.#chunks.push(d.subarray(i, i + C))
      this.#mark(this.#chunks.length - 1, 0, Math.min(C, d.length - i))
    }
    this.#n = d.length
    this.#indexed = false
    this.#invalidate(-Infinity, Infinity)
  }

  // Writable chunk j: allocated over a gap, copied from a view of the caller's array
  #own(j) {
    let d = this.#chunks[j]
    if (this.#owned.has(d)) return d
    while (this.#chunks.length < j) this.#chunks.push(null)
    let e = new Float32Array(C).fill(NaN)
    if (d) e.set(d)
    this.#owned.add(e)
    return this.#chunks[j] = e
  }

  // Samples [a, b) of chunk j changed: their rows go up again when a frame reads them; their block gets a layer
  #mark(j, a, b) {
    let r0 = (j * C + a) / LW | 0, r1 = Math.ceil((j * C + b) / LW)
    if (this.#fresh.length < r1) { let f = new Uint8Array(Math.max(r1, 2 * this.#fresh.length)); f.set(this.#fresh); this.#fresh = f }
    this.#fresh.fill(0, r0, r1)
    let k = j >> (LB - 16), rows = 1 << (LB - Math.log2(LW))
    if (this.#blocks[k] !== undefined) return
    this.#blocks[k] = this.#layers++
    this.#indexed = false
    this.#fresh.fill(0, k * rows, (k + 1) * rows) // read as silence while it had no layer; its layer holds what it held
  }

  // Samples [a, b) changed: forget every cached column their frames reach
  #invalidate(a, b) {
    for (let K of [...this.#views, this.#whole?.K]) {
      if (!K?.tags) continue
      let lo = Math.floor((a - K.N + .5) / K.cw) - 1, hi = Math.floor((b + K.N + .5) / K.cw) + 1, t = K.tags
      for (let i = 0; i < t.length; i++) if (t[i] >= lo && t[i] <= hi) t[i] = NaN
    }
  }

  // Sample texture, allocated for the layers in use (doubling as they grow), and the layer of each block. Samples go up
  // as frames first read them (#fetch): a view of an hour needs its frames' rows, not the hour.
  #upload() {
    let gl = this.gl
    gl.activeTexture(gl.TEXTURE2)
    if (!this.#tex || this.#depth < this.#layers) {
      let depth = Math.max(this.#layers, this.#tex ? this.#depth * 2 : 1), most = gl.getParameter(gl.MAX_ARRAY_TEXTURE_LAYERS)
      if (depth > most) depth = this.#layers
      if (depth > most) throw RangeError(`gl-spectrogram: ${this.#layers} blocks of ${2 ** LB} samples, the GPU holds ${most}`)
      gl.deleteTexture(this.#tex)
      gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.#tex = gl.createTexture())
      filter(gl, gl.TEXTURE_2D_ARRAY)
      gl.texStorage3D(gl.TEXTURE_2D_ARRAY, 1, gl.R32F, LW, LH, this.#depth = depth)
      this.#fresh.fill(0)
    }
    if (!this.#indexed) {
      let index = Int32Array.from({ length: Math.max(this.#blocks.length, 1) }, (_, k) => this.#blocks[k] ?? -1)
      gl.activeTexture(gl.TEXTURE3)
      gl.deleteTexture(this.#index)
      gl.bindTexture(gl.TEXTURE_2D, this.#index = gl.createTexture())
      filter(gl, gl.TEXTURE_2D)
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32I, index.length, 1, 0, gl.RED_INTEGER, gl.INT, index)
      this.#indexed = true
    }
  }

  // The rows frames [0, nf) of c.params read, uploaded where the GPU does not hold them as they are. Frames come in
  // order, so their rows merge into runs; a run goes up a chunk (32 rows) at a time, gaps in a written block as zeros.
  #fetch(p, nf, N) {
    let gl = this.gl, fresh = this.#fresh, n = this.#n, a = 0, b = 0, bound = false
    let up = (r, e) => {
      for (let i = r; i < e; i++) fresh[i] = 1
      let z = this.#blocks[r >> (LB - Math.log2(LW))], d = this.#chunks[r >> 5], y = r & (LH - 1), o = (r & 31) * LW
      if (z === undefined) return
      if (!bound) {
        bound = true
        bind(gl, 2, gl.TEXTURE_2D_ARRAY, this.#tex)
        gl.bindBuffer(gl.PIXEL_UNPACK_BUFFER, null)
        for (let i = 0; i < UNPACK.length; i += 2) gl.pixelStorei(gl[UNPACK[i]], UNPACK[i + 1])
      }
      if (!d) return gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, y, z, LW, e - r, 1, gl.RED, gl.FLOAT, zeros ??= new Float32Array(C))
      let full = Math.min(e - r, Math.floor((d.length - o) / LW)), rest = Math.min(d.length - o - full * LW, LW)
      if (full > 0) gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, y, z, LW, full, 1, gl.RED, gl.FLOAT, d, o)
      if (full < e - r && rest > 0) gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, y + full, z, rest, 1, 1, gl.RED, gl.FLOAT, d, o + full * LW)
    }
    let flush = () => {
      for (let r = a; r < b;) {
        if (fresh[r]) { r++; continue }
        let e = r + 1
        while (e < b && !fresh[e] && e & 31) e++
        up(r, e)
        r = e
      }
    }
    for (let i = 0; i < nf; i++) {
      let s = p[4 * i] * 65536 + p[4 * i + 1], r0 = Math.max(s, 0) / LW | 0, r1 = Math.ceil(Math.min(s + N, n) / LW)
      if (r1 <= r0) continue
      if (r0 <= b) b = Math.max(b, r1)
      else { flush(); a = r0; b = r1 }
    }
    flush()
  }

  // ── view ────────────────────────────────────────────────────────────────

  #pr() { return this.#pixelRatio || globalThis.devicePixelRatio || 1 }

  // Viewport in device px, GL origin: [x, y, w, h]
  #rect() {
    let gl = this.gl, H = gl.drawingBufferHeight
    if (!this.#viewport) return [0, 0, gl.drawingBufferWidth, H]
    let pr = this.#pr(), [x, y, w, h] = this.#viewport, X = Math.round(x * pr), Y = Math.round((y + h) * pr)
    return [X, H - Y, Math.round((x + w) * pr) - X, Y - Math.round(y * pr)]
  }

  #target(X, Y, W, H) {
    let gl = this.gl
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    gl.enable(gl.SCISSOR_TEST)
    gl.scissor(X, Y, W, H)
    gl.colorMask(true, true, true, true)
  }

  // What the viewport shows: columns of max(samples per px, 1) samples, rows of the band, the FFT that suits them
  #view() {
    let [X, Y, W, H] = this.#rect(), [r0, r1] = this.range, spp = (r1 - r0) / W
    if (!(W > 0 && H > 0 && spp > 0 && spp < Infinity && this.#n)) return null
    let [lo, hi] = this.band, [w] = WARP[this.#scale], cw = Math.max(spp, 1)
    return { X, Y, W, H, r0, spp, cw, lo, hi, b0: w(lo), bk: H / (w(hi) - w(lo)), N: this.#fft(lo, hi, H) }
  }

  // FFT size: 40 ms, so a voice's harmonics (80 Hz apart and more) each get their Hann lobe (reassignment sharpens a
  // click whatever the window, but not partials sharing a lobe); longer while a bin spans over 4 rows at the band's
  // middle, so a zoomed band gets finer bins. Zoomed out past half a window per column, renders add frames (#refine).
  #fft(lo, hi, rows) {
    let max = contexts.get(this.gl)?.max ?? 16384
    if (this.#size) return Math.min(this.#size, max)
    let [to, of] = WARP[this.#scale], a = to(lo), b = to(hi), m = (a + b) / 2, e = (b - a) / rows / 2, rate = this.#rate
    let n = Math.max(rate * WINDOW, rate / (4 * (of(m + e) - of(m - e))))
    return Math.min(Math.max(2 ** Math.ceil(Math.log2(n)), NMIN), NMAX, max)
  }

  // The cache for view v, and v's columns in it: q0 under the left edge, f0 the edge's offset, ratio columns per px.
  // A cache is reused for columns of the same width, up to rounding in the range's arithmetic.
  #cache(v) {
    let { W, H, cw, N, b0, bk } = v, s = this.#scale, rate = this.#rate
    let i = this.#views.findIndex(K => K.N === N && K.rows === H && K.b0 === b0 && K.bk === bk && K.scale === s && K.rate === rate && Math.abs(K.cw / cw - 1) < 1e-9)
    let K = i < 0 ? this.#views.length < 2 ? {} : this.#views.pop() : this.#views.splice(i, 1)[0]
    this.#views.unshift(K)
    this.#wide = Math.max(this.#wide, W)
    let cap = Math.min(2 ** Math.ceil(Math.log2(2 * this.#wide + 4)), contexts.get(this.gl).max)
    if (i < 0) Object.assign(K, { cw, N, b0, bk, scale: s, rate, sub: perColumn(cw, N) })
    if (i < 0 || K.cap < Math.min(cap, 2 * W + 4)) this.#alloc(K, cap, H)
    let at = (v.r0 + .5) / K.cw
    v.q0 = Math.floor(at)
    v.f0 = at - v.q0
    v.ratio = v.spp / K.cw
    v.q1 = v.q0 + Math.ceil(v.f0 + W * v.ratio)
    return K
  }

  // Cache storage: cap columns × rows, emptied
  #alloc(K, cap, rows) {
    let gl = this.gl, c = contexts.get(gl)
    if (!K.tex || K.cap !== cap || K.rows !== rows) {
      gl.deleteTexture(K.tex)
      gl.deleteFramebuffer(K.fbo)
      Object.assign(K, surface(gl, c.half ? gl.R16F : gl.R32F, cap, rows), { cap, rows })
    }
    else {
      gl.bindFramebuffer(gl.FRAMEBUFFER, K.fbo)
      gl.disable(gl.SCISSOR_TEST)
      gl.clearColor(0, 0, 0, 0)
      gl.clear(gl.COLOR_BUFFER_BIT)
    }
    K.tags = new Float64Array(cap).fill(NaN)
    K.done = new Uint16Array(cap)
  }

  // Columns [a, b) of cache K computed from one frame each; true if any had to be
  #need(K, a, b) {
    let t = K.tags, d = K.done, mask = K.cap - 1, ran = false
    for (let q = a; q < b;) {
      if (t[q & mask] === q) { q++; continue }
      let e = q + 1
      while (e < b && t[e & mask] !== e) e++
      this.#run(K, q, e, 0)
      for (let i = q; i < e; i++) { t[i & mask] = i; d[i & mask] = 1 }
      ran = true
      q = e
    }
    return ran
  }

  // More frames for columns [a, b), fewest-framed first, while `budget` frames last, one column at least so a render
  // always gets further; true if some still lack frames
  #refine(K, a, b, budget) {
    let d = K.done, mask = K.cap - 1, m = Math.ceil((K.N / 2 + 1) / K.cw) + 1, first = true
    for (;;) {
      let j = K.sub
      for (let q = a; q < b; q++) j = Math.min(j, d[q & mask])
      if (j >= K.sub) return false
      if (!first && budget <= 2 * m) return true
      for (let q = a; q < b && (first || budget > 2 * m);) {
        if (d[q & mask] !== j) { q++; continue }
        let e = q + 1
        while (e < b && d[e & mask] === j && e - q < budget - 2 * m) e++
        this.#run(K, q, e, j)
        for (let i = q; i < e; i++) d[i & mask] = j + 1
        budget -= e - q + 2 * m
        first = false
        q = e
      }
    }
  }

  // Columns [lo, hi) of K, their frame j of K.sub: every frame j that can reach them transformed and scattered into
  // them only, so columns computed in turns hold what they would computed at once. Frame 0 sums into the emptied
  // columns; each further frame sums apart and the columns keep the larger, so a column shows its loudest frame and a
  // click between frames is not lost zoomed out. Frames sit evenly across a column, the middle one first, each centered
  // on a sample; a reassigned time t̂ (samples) goes to column floor((t̂ + .5) / cw), so sample k's energy sits at k, as
  // a waveform draws it.
  #run(K, lo, hi, j) {
    let gl = this.gl, c = contexts.get(gl), { N, cw, cap, rows, sub } = K, h = N / 2, [R, ...radices] = plan(N)
    let into = j ? temp(gl, c, cap, rows) : K
    gl.bindFramebuffer(gl.FRAMEBUFFER, into.fbo)
    gl.colorMask(true, true, true, true)
    gl.disable(gl.BLEND)
    gl.enable(gl.SCISSOR_TEST)
    gl.clearColor(0, 0, 0, 0)
    let s0 = lo & (cap - 1), len = hi - lo, spans = s0 + len <= cap ? [[s0, len]] : [[s0, cap - s0], [0, s0 + len - cap]]
    for (let [x, w] of spans) { gl.scissor(x, 0, w, rows); gl.clear(gl.COLOR_BUFFER_BIT) }
    gl.disable(gl.SCISSOR_TEST)
    gl.bindVertexArray(c.vao)

    let S = scratch(gl, c, N), tw = twiddles(gl, c, N), B = 2 * S.P, m = Math.ceil((h + 1) / cw) + 1, p = c.params
    let hz = K.rate / N, of = WARP[K.scale][1], f0 = of(K.b0), f1 = of(K.b0 + rows / K.bk)
    let k0 = Math.max(0, Math.floor(f0 / hz) - 8), nb = Math.min(h, Math.ceil(f1 / hz) + 8) - k0
    let at = ((sub - 1) / 2 + (j & 1 ? -(j + 1) / 2 : j / 2) + .5) / sub // frame j's place in its column, 0..1
    this.#spent += len + 2 * m
    for (let a = lo - m; a < hi + m; a += B) {
      let nf = Math.min(B, hi + m - a), pairs = Math.ceil(nf / 2)
      for (let i = 0; i < 2 * pairs; i++) {
        let t = Math.round((a + i + at) * cw - .5), s = i < nf ? t - h : -2 * N, x = Math.floor(s / 65536)
        p[4 * i] = x; p[4 * i + 1] = s - x * 65536; p[4 * i + 2] = a + i - lo; p[4 * i + 3] = (t + .5) / cw - a - i
      }
      this.#fetch(p, nf, N)
      bind(gl, 4, gl.TEXTURE_2D, c.frames)
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 1024, Math.ceil(2 * pairs / 1024), gl.RGBA, gl.FLOAT, p)

      // FFT: samples → S.tex[0] → S.tex[1] → …
      gl.bindFramebuffer(gl.FRAMEBUFFER, S.fbo[0])
      gl.viewport(0, 0, N, pairs)
      let { prog, u } = c['first' + R]
      gl.useProgram(prog)
      bind(gl, 1, gl.TEXTURE_2D, tw)
      bind(gl, 2, gl.TEXTURE_2D_ARRAY, this.#tex)
      bind(gl, 3, gl.TEXTURE_2D, this.#index)
      gl.uniform1i(u.N, N)
      gl.uniform1i(u.len, this.#n)
      gl.uniform1i(u.blocks, this.#blocks.length)
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
      ;({ prog, u } = c.stage)
      gl.useProgram(prog)
      gl.uniform1i(u.N, N)
      radices.forEach((_, i) => {
        gl.bindFramebuffer(gl.FRAMEBUFFER, S.fbo[(i + 1) & 1])
        bind(gl, 0, gl.TEXTURE_2D, S.tex[i & 1])
        gl.uniform1i(u.L, R * 8 ** i)
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
      })

      // reassignment: a point per frame and bin, summed into the run's columns
      gl.bindFramebuffer(gl.FRAMEBUFFER, into.fbo)
      gl.viewport(0, 0, cap, rows)
      gl.enable(gl.BLEND)
      gl.blendEquation(gl.FUNC_ADD)
      gl.blendFunc(gl.ONE, gl.ONE)
      ;({ prog, u } = c.scatter)
      gl.useProgram(prog)
      bind(gl, 0, gl.TEXTURE_2D, S.tex[radices.length & 1])
      gl.uniform1i(u.N, N)
      gl.uniform1i(u.k0, k0)
      gl.uniform1i(u.nb, nb)
      gl.uniform1i(u.cap, cap)
      gl.uniform1i(u.slot, s0)
      gl.uniform1i(u.span, len)
      gl.uniform1i(u.rows, rows)
      gl.uniform1i(u.scale, SCALE[K.scale])
      gl.uniform1f(u.cw, cw)
      // a full-scale sine sums to 1: Hann's coherent gain 1/2 puts (N/4)² in its bin, its main lobe holds 1.5× that
      gl.uniform1f(u.norm, (c.half ? HALF : 1) / (1.5 * (N / 4) ** 2))
      gl.uniform1f(u.hz, hz)
      gl.uniform1f(u.b0, K.b0)
      gl.uniform1f(u.bk, K.bk)
      gl.drawArrays(gl.POINTS, 0, nf * nb)
      gl.disable(gl.BLEND)
    }
    if (!j) return
    // the larger of what the columns hold and what this frame gave them
    gl.bindFramebuffer(gl.FRAMEBUFFER, K.fbo)
    gl.useProgram(c.copy.prog)
    bind(gl, 0, gl.TEXTURE_2D, into.tex)
    gl.enable(gl.BLEND)
    gl.blendEquation(gl.MAX)
    gl.enable(gl.SCISSOR_TEST)
    for (let [x, w] of spans) { gl.scissor(x, 0, w, rows); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4) }
    gl.disable(gl.SCISSOR_TEST)
    gl.blendEquation(gl.FUNC_ADD)
    gl.disable(gl.BLEND)
  }

  // The whole data's picture, columns of a power of two samples so pushes redo only the end, and its loudest cell,
  // reduced on the GPU: [cells, …, 1 × 1]
  #peak() {
    let gl = this.gl, c = contexts.get(gl), s = this.#scale, rate = this.#rate, [to] = WARP[s], lo = scales[s].low, hi = rate / 2
    let cw = 2 ** Math.ceil(Math.log2(Math.max(this.#n / WHOLE, 1))), b0 = to(lo), bk = WROWS / (to(hi) - to(lo)), N = this.#fft(lo, hi, WROWS)
    let P = this.#whole ??= { K: {}, chain: [], dirty: true }, K = P.K
    if (!(K.tex && K.cw === cw && K.N === N && K.b0 === b0 && K.bk === bk && K.scale === s && K.rate === rate)) {
      Object.assign(K, { cw, N, b0, bk, scale: s, rate, sub: 1 })
      this.#alloc(K, WHOLE, WROWS)
      P.dirty = true
    }
    if (this.#need(K, 0, Math.ceil(this.#n / cw))) P.dirty = true
    if (!P.chain.length) for (let w = WHOLE, h = WROWS; w > 1 || h > 1;) {
      w = Math.ceil(w / 8); h = Math.ceil(h / 8)
      P.chain.push({ ...surface(gl, gl.R32F, w, h), w, h })
    }
    if (P.dirty) {
      let { prog, u } = c.reduce, src = K
      gl.useProgram(prog)
      gl.bindVertexArray(c.vao)
      gl.disable(gl.BLEND)
      gl.disable(gl.SCISSOR_TEST)
      gl.uniform1f(u.most, c.half ? 65504 : 3e38)
      for (let d of P.chain) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, d.fbo)
        gl.viewport(0, 0, d.w, d.h)
        bind(gl, 0, gl.TEXTURE_2D, src.tex)
        gl.uniform2i(u.size, src.w ?? src.cap, src.h ?? src.rows)
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
        src = d
      }
      P.dirty = false
    }
    return P.chain
  }

  // Level → color table: the ramp from the background to the color, or the colormap
  #paint() {
    let gl = this.gl
    if (this.#painted && this.#lut) return
    let px = this.#stops ? colormap(this.#stops) : ramp(this.#color, this.#background)
    if (!this.#lut) {
      bind(gl, 5, gl.TEXTURE_2D, this.#lut = gl.createTexture())
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
      gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, 256, 1)
    }
    else bind(gl, 5, gl.TEXTURE_2D, this.#lut)
    gl.bindBuffer(gl.PIXEL_UNPACK_BUFFER, null)
    for (let i = 0; i < UNPACK.length; i += 2) gl.pixelStorei(gl[UNPACK[i]], UNPACK[i + 1])
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 256, 1, gl.RGBA, gl.UNSIGNED_BYTE, px)
    this.#painted = true
  }

  #lost = e => {
    e.preventDefault()
    contexts.delete(this.gl)
    this.#tex = this.#index = this.#lut = this.#whole = null
    this.#depth = 0
    this.#indexed = false
    this.#views = []
  }

  #restored = () => { if (this.#drawn) this.render() }
}

// ── GPU helpers ───────────────────────────────────────────────────────────

// Compiling starts with the first spectrogram on a context, so the driver works on it while data loads; the first
// draw waits for it
function context(gl, ready = true) {
  let c = contexts.get(gl)
  if (!c) {
    gl.getExtension('EXT_color_buffer_float')
    let half = !gl.getExtension('EXT_float_blend') // float32 blending; without it cells are half floats, which blend
    c = { half, max: gl.getParameter(gl.MAX_TEXTURE_SIZE), vao: gl.createVertexArray(), tw: new Map(), scratch: new Map(), ready: false }
    for (let name in PROGRAMS) {
      let [vs, fs] = PROGRAMS[name], prog = gl.createProgram()
      let shaders = [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]].map(([type, src]) => {
        let s = gl.createShader(type)
        gl.shaderSource(s, src)
        gl.compileShader(s)
        gl.attachShader(prog, s)
        return s
      })
      gl.linkProgram(prog)
      c[name] = { prog, shaders, u: null }
    }
    // per frame: [first sample ÷ 65536, its remainder, column from the run's first, center in columns from the frame's]
    c.params = new Float32Array(1024 * 32 * 4)
    gl.activeTexture(gl.TEXTURE4)
    gl.bindTexture(gl.TEXTURE_2D, c.frames = gl.createTexture())
    filter(gl, gl.TEXTURE_2D)
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA32F, 1024, 32)
    contexts.set(gl, c)
  }
  if (ready && !c.ready) {
    for (let name in PROGRAMS) {
      let p = c[name], [, , samplers, uniforms] = PROGRAMS[name]
      if (!gl.getProgramParameter(p.prog, gl.LINK_STATUS)) throw Error('gl-spectrogram: ' + p.shaders.map(s => gl.getShaderInfoLog(s)).join('') + gl.getProgramInfoLog(p.prog))
      gl.useProgram(p.prog)
      for (let s in samplers) gl.uniform1i(gl.getUniformLocation(p.prog, s), samplers[s])
      p.u = {}
      for (let name of uniforms) p.u[name] = gl.getUniformLocation(p.prog, name)
    }
    c.ready = true
  }
  return c
}

// Frames a column gets for every sample to be in one, hops of at most half a window: odd, so one sits in the middle
const perColumn = (cw, N) => { let k = Math.ceil(2 * cw / N); return k > 1 ? k | 1 : 1 }

let zeros = null // a chunk of silence, for rows of a written block that no chunk holds

// Cells of a frame beyond a column's first, before they join the column: at least w × h
function temp(gl, c, w, h) {
  let t = c.temp
  if (t && t.w >= w && t.h >= h) return t
  if (t) { gl.deleteTexture(t.tex); gl.deleteFramebuffer(t.fbo) }
  w = Math.max(w, t?.w ?? 0); h = Math.max(h, t?.h ?? 0)
  return c.temp = { ...surface(gl, c.half ? gl.R16F : gl.R32F, w, h), w, h }
}

// Ping-pong textures for FFTs of size N: N × P texels, two frames each; kept for the last two sizes
function scratch(gl, c, N) {
  let S = c.scratch.get(N)
  if (S) { c.scratch.delete(N); c.scratch.set(N, S); return S }
  if (c.scratch.size >= 2) {
    let [n, old] = c.scratch.entries().next().value
    for (let i = 0; i < 2; i++) { gl.deleteTexture(old.tex[i]); gl.deleteFramebuffer(old.fbo[i]) }
    c.scratch.delete(n)
  }
  let P = Math.min(c.max, SCRATCH / N, 1024 * 32 / 2), a = surface(gl, gl.RGBA32F, N, P), b = surface(gl, gl.RGBA32F, N, P)
  c.scratch.set(N, S = { P, tex: [a.tex, b.tex], fbo: [a.fbo, b.fbo] })
  return S
}

// e^(-2πik/N) for k < N/2, from doubles
function twiddles(gl, c, N) {
  let t = c.tw.get(N)
  if (t) return t
  let d = new Float32Array(N)
  for (let k = 0; k < N / 2; k++) { d[2 * k] = Math.cos(2 * Math.PI * k / N); d[2 * k + 1] = -Math.sin(2 * Math.PI * k / N) }
  gl.activeTexture(gl.TEXTURE1)
  gl.bindTexture(gl.TEXTURE_2D, t = gl.createTexture())
  filter(gl, gl.TEXTURE_2D)
  gl.bindBuffer(gl.PIXEL_UNPACK_BUFFER, null)
  for (let i = 0; i < UNPACK.length; i += 2) gl.pixelStorei(gl[UNPACK[i]], UNPACK[i + 1])
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RG32F, N / 2, 1, 0, gl.RG, gl.FLOAT, d)
  c.tw.set(N, t)
  return t
}

// A float texture with a framebuffer on it
function surface(gl, format, w, h) {
  let tex = gl.createTexture(), fbo = gl.createFramebuffer()
  gl.activeTexture(gl.TEXTURE0)
  gl.bindTexture(gl.TEXTURE_2D, tex)
  filter(gl, gl.TEXTURE_2D)
  gl.texStorage2D(gl.TEXTURE_2D, 1, format, w, h)
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo)
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0)
  return { tex, fbo }
}

function filter(gl, target) {
  gl.texParameteri(target, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
  gl.texParameteri(target, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
}

function bind(gl, unit, target, tex) {
  gl.activeTexture(gl.TEXTURE0 + unit)
  gl.bindTexture(target, tex)
}

// ── colors ────────────────────────────────────────────────────────────────

const lin = c => c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4
const enc = y => y <= .0031308 ? 12.92 * y : 1.055 * y ** (1 / 2.4) - .055

// sRGB 0..1 ↔ OKLab (Ottosson 2020)
function oklab([r, g, b]) {
  r = lin(r); g = lin(g); b = lin(b)
  let l = Math.cbrt(.4122214708 * r + .5363325363 * g + .0514459929 * b)
  let m = Math.cbrt(.2119034982 * r + .6806995451 * g + .1073969566 * b)
  let s = Math.cbrt(.0883024619 * r + .2817188376 * g + .6299787005 * b)
  return [.2104542553 * l + .793617785 * m - .0040720468 * s, 1.9779984951 * l - 2.428592205 * m + .4505937099 * s, .0259040371 * l + .7827717662 * m - .808675766 * s]
}
function srgb([L, a, b]) {
  let l = (L + .3963377774 * a + .2158037573 * b) ** 3, m = (L - .1055613458 * a - .0638541728 * b) ** 3, s = (L - .0894841775 * a - 1.291485548 * b) ** 3
  return [4.0767416621 * l - 3.3077115913 * m + .2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - .3413193965 * s, -.0041960863 * l - .7034186147 * m + 1.707614701 * s].map(v => enc(Math.min(Math.max(v, 0), 1)))
}

// The color at the coverage that, over the background, steps OKLab lightness evenly from the background's to the color's
function ramp(c, bg) {
  let px = new Uint8Array(1024), mix = a => bg.map((v, i) => v + a * (c[i] - v)), L = a => oklab(mix(a))[0]
  let L0 = L(0), L1 = L(c[3]), dir = Math.sign(L1 - L0)
  for (let i = 0; i < 256; i++) {
    let want = L0 + i / 255 * (L1 - L0), lo = 0, hi = c[3]
    if (dir) for (let k = 0; k < 40; k++) { let m = (lo + hi) / 2; if ((L(m) - want) * dir < 0) lo = m; else hi = m }
    let a = dir ? (lo + hi) / 2 : i / 255 * c[3]
    px.set([c[0] * a, c[1] * a, c[2] * a, a].map(v => Math.round(v * 255)), i * 4)
  }
  return px
}

// Colors evenly spaced from the floor to the top, interpolated in premultiplied OKLab (CSS Color 4 §12.3)
function colormap(stops) {
  let px = new Uint8Array(1024), k = stops.length - 1, lab = stops.map(s => [...oklab(s).map(v => v * s[3]), s[3]])
  for (let i = 0; i < 256; i++) {
    let t = i / 255 * k, j = Math.min(Math.floor(t), k - 1), f = t - j
    let [L, a, b, al] = lab[j].map((v, n) => v + f * (lab[j + 1][n] - v)), rgb = al ? srgb([L / al, a / al, b / al]) : [0, 0, 0]
    px.set([...rgb.map(v => v * al), al].map(v => Math.round(v * 255)), i * 4)
  }
  return px
}

// CSS color → [r, g, b, a] 0..1 in the context's color space; arrays pass through
const ctx2d = {}
function rgba(c, gl) {
  if (typeof c !== 'string') return nums([c?.[0], c?.[1], c?.[2], c?.[3] ?? 1], 4, 'color').map(v => Math.min(Math.max(v, 0), 1))
  let space = gl.drawingBufferColorSpace || 'srgb'
  let ctx = ctx2d[space] ??= (globalThis.OffscreenCanvas ? new OffscreenCanvas(1, 1) : document.createElement('canvas')).getContext('2d', { colorSpace: space, willReadFrequently: true })
  ctx.fillStyle = '#000'; ctx.fillStyle = c
  if (ctx.fillStyle === '#000000') { ctx.fillStyle = '#fff'; ctx.fillStyle = c; if (ctx.fillStyle === '#ffffff') throw TypeError(`gl-spectrogram: invalid color ${c}`) }
  ctx.clearRect(0, 0, 1, 1)
  ctx.fillRect(0, 0, 1, 1)
  let d = ctx.getImageData(0, 0, 1, 1).data
  return [d[0] / 255, d[1] / 255, d[2] / 255, d[3] / 255]
}

function nums(v, len, name) {
  let a = Array.from({ length: len }, (_, i) => +v?.[i])
  if (!a.every(Number.isFinite)) throw TypeError(`gl-spectrogram: ${name} must be ${len > 1 ? len + ' finite numbers' : 'a finite number'}`)
  return a
}

function positive(v, name) {
  if (!(+v > 0 && +v < Infinity)) throw TypeError(`gl-spectrogram: ${name} must be a positive number`)
  return +v
}
