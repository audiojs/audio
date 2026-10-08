/**
 * gl-spectrogram – WebGL2 spectrogram renderer.
 *
 * Each render computes what its viewport shows, on the GPU: one frame per device-pixel column, read straight from the
 * samples in float textures, Stockham FFTs (radix 8) in fragment passes, then each frame drawn as points into a float
 * texture of columns × rows. Reassigned, the default (Kodera, Gendrin & de Villedary 1976; Auger & Flandrin 1995): each
 * bin's energy is a point at the time and frequency its phase places it, so a steady sine draws one row thin, a click
 * one column thin. The other methods keep a frame in its column: its spectrum as it is, squeezed onto its
 * instantaneous frequencies, of a length by band, through several tapers, or as the Wigner–Ville distribution.
 * Columns sit on a grid anchored to multiples of samples per column and are kept, so a pan computes only what it
 * uncovers. Zoomed out, where a column outspans a window, later renders add frames till every sample is in one, the
 * column their mean power (so it reads as the samples do zoomed in, from its first frame on) or their loudest.
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
const LEVEL = 1.6, FLOOR = 150      // spectra(): a byte per bin, (dB + FLOOR) · LEVEL; 0, silence
// bands: under each frequency (Hz), frames of the view's FFT size times this; at 2048 the lab's 8192 under 200 Hz to
// 512 over 3 kHz, about 30 to 60 periods of each band's top
const BANDS = [[200, 4], [500, 2], [1250, 1], [3000, .5], [Infinity, .25]]
const TAPERS = 3                    // tapers: a tone's top flat over ±1 bin, noise's spread in dB halved (χ² of 6 degrees)

const ATTRS = { premultipliedAlpha: true, preserveDrawingBuffer: true, antialias: false, depth: false, stencil: false }
const WHITE = [1, 1, 1, 1], BLACK = [0, 0, 0, 1]

// ── frequency axes ───────────────────────────────────────────────────────

// Where f sits between lo and hi as 0..1, and back. Rows are spaced evenly on the scale.
//   log  equal space per octave; its axis starts at 20 Hz, the floor of hearing
//   mel  equal space per mel, 2595 · log10(1 + f / 700) (O'Shaughnessy 1987, as in HTK); near linear under 1 kHz
//   erb  equal space per auditory filter, ERB-number 21.4 · log10(1 + 0.00437 f) (Glasberg & Moore 1990, "Derivation
//        of auditory filter shapes from notched-noise data", Hearing Research 47, eq. 4, f in Hz); from 0
//   lin  equal space per hertz, from 0
const mel = f => 2595 * Math.log10(1 + f / 700), hertz = m => 700 * (10 ** (m / 2595) - 1)
const erb = f => 21.4 * Math.log10(1 + .00437 * f), unerb = e => (10 ** (e / 21.4) - 1) / .00437
const WARP = { log: [Math.log2, u => 2 ** u], mel: [mel, hertz], erb: [erb, unerb], lin: [f => f, f => f] }
const axis = (name, low) => {
  let [to, from] = WARP[name]
  return { low, at: (f, lo, hi) => (to(f) - to(lo)) / (to(hi) - to(lo)), of: (u, lo, hi) => from(to(lo) + u * (to(hi) - to(lo))) }
}
export const scales = { log: axis('log', 20), mel: axis('mel', 0), erb: axis('erb', 0), lin: axis('lin', 0) }
const SCALE = { log: 0, mel: 1, lin: 2, erb: 3 }

// ── methods ──────────────────────────────────────────────────────────────

// What a column draws of its frames; each reads a full-scale sine at 0 dB (README, Levels)
//   frames           the frame's Hann spectrum as it is (Allen 1977): a cell reads the highest the spectrum reaches
//                    across its band, drawn as a line through the bins
//   reassigned       the power each bin's phase moves into the cell, in time and frequency (Auger & Flandrin 1995)
//   synchrosqueezed  each bin's complex value moved to its instantaneous frequency and summed, time staying the
//                    frame's (Thakur & Wu 2011, the STFT form of Daubechies, Lu & Wu 2011)
//   bands            frames as above, of a length by band (BANDS), as editors blend several lengths
//   tapers           TAPERS sine tapers' spectra averaged (Riedel & Sidorenko 1995): steadier noise
//   wigner           pseudo Wigner–Ville of the analytic signal under a Hann lag window (Ville 1948): lines thin
//                    without reassignment, and between any two components a cross-term
const METHODS = ['frames', 'reassigned', 'synchrosqueezed', 'bands', 'tapers', 'wigner']
// How a zoomed-out column joins its frames, and the spectra given it spans
//   mean  their mean power: noise and tones read as they do zoomed in, and as more frames come only the speckle settles
//   max   the loudest: a click between frames reads at its own level, noise the higher the more frames a column has
const COMBINES = ['mean', 'max']

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
// The first stage gathers its R inputs from feed(y, n): point n of the two transforms of texel row y
const FIRST = (R, IN) => HEAD + FFT + IN + `
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  int r = p.x % ${R}, j = p.x / ${R}, q = N / ${R};
  begin(p.y);
  for (int k = 0; k < ${R}; k++) {
    vec4 z = feed(p.y, j + k * q);
    vec2 w = W(k * r * q);
    o = k == 0 ? z : o + vec4(mul(w, z.xy), mul(w, z.zw));
  }
}`
// Frames of L samples centered on theirs, windowed, then zeros to N
const SAMPLES = `
uniform sampler2DArray samples; // ${LW} × ${LH} a layer
uniform isampler2D layers;      // layer of each 2^${LB}-sample block, -1 where nothing was written
uniform sampler2D frames;       // per frame: [center sample ÷ 65536, its remainder, column from the run's first, center], 1024 a row
uniform int len, blocks, L, shape;

// A frame: its first sample, and the layers of the two blocks it can span
struct F { int s, b, l0, l1; };
int layer(int b) { return b >= 0 && b < blocks ? texelFetch(layers, ivec2(b, 0), 0).r : -1; }
F frame(int f) {
  vec4 p = texelFetch(frames, ivec2(f & 1023, f >> 10), 0);
  int s = int(p.x) * 65536 + int(p.y) - (L >> 1), b = s >> ${LB};
  return F(s, b, layer(b), layer(b + 1));
}
float at(F f, int n) {
  int s = f.s + n, l = s >> ${LB} == f.b ? f.l0 : f.l1;
  if (s < 0 || s >= len || l < 0) return 0.;
  float v = texelFetch(samples, ivec3(s & ${LW - 1}, (s >> ${Math.log2(LW)}) & ${LH - 1}, l), 0).r;
  return (floatBitsToUint(v) & 0x7f800000u) == 0x7f800000u ? 0. : v; // NaN, ±Infinity: silence
}
// shape 0: z[n] = x[n] · (1, (n - N/2) · hann[n] · 2/N), the samples in re, Hann-and-time weighted in im, one FFT
// giving both; 1: x[n] · hann[n]; 2: x[n]
vec2 window(int n) {
  if (shape == 2) return vec2(1, 0);
  int h = N >> 1;
  float c = n < h ? texelFetch(tw, ivec2(n, 0), 0).x : -texelFetch(tw, ivec2(n - h, 0), 0).x;
  return shape == 1 ? vec2(.5 - .5 * c, 0) : vec2(1, float(n - h) * (1. - c) / float(N));
}
F a, b;
void begin(int y) { a = frame(2 * y); b = frame(2 * y + 1); }
vec4 feed(int y, int n) {
  if (n >= L) return vec4(0);
  vec2 z = window(n);
  return vec4(at(a, n) * z, at(b, n) * z);
}`
// Wigner–Ville, after the FFT of the 2N samples around a frame's center: its analytic signal's spectrum, 2X/2N over
// 0 < k < N and 0 elsewhere, conjugated, so this FFT of it gives the analytic signal conjugated (Ville 1948)
const ANALYTIC = `
uniform sampler2D src;
void begin(int y) {}
vec4 feed(int y, int n) {
  if (n == 0 || n >= N >> 1) return vec4(0);
  vec4 t = texelFetch(src, ivec2(n, y), 0) * (2. / float(N));
  return vec4(t.x, -t.y, t.z, -t.w);
}`
// Then the lag product z(t + m) z*(t − m) under a Hann lag window .5 + .5 cos(2πm/N), m from −N/2 (its zero) to N/2,
// at n = m mod N; src holds z* of the 2N samples, t at N. Its FFT is real, at k · rate / 2N.
const LAG = `
uniform sampler2D src;
void begin(int y) {}
vec2 cj(vec2 z) { return vec2(z.x, -z.y); }
vec4 feed(int y, int n) {
  int h = N >> 1, m = n < h ? n : n - N;
  if (m == -h) return vec4(0);
  float w = .5 + .5 * texelFetch(tw, ivec2(abs(m), 0), 0).x;
  vec4 a = texelFetch(src, ivec2(N + m, y), 0), b = texelFetch(src, ivec2(N - m, y), 0);
  return w * vec4(mul(cj(a.xy), b.xy), mul(cj(a.zw), b.zw));
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
// Synchrosqueezed, the point stays in the frame's column and carries the bin's complex value as though the frame were
// centered on n = 0, (−1)^k X_h, to sum there with the others it shares a row with
const SCATTER = HEAD + `
uniform sampler2D spec, frames;
uniform int N, k0, nb, cap, slot, span, rows, scale, squeeze;
uniform float cw, norm, hz, b0, bk; // samples per column; power → level; Hz per bin; row = (warp(Hz) - b0) · bk
flat out vec2 v;

vec2 Z(int f, int k, bool e) { vec4 t = texelFetch(spec, ivec2(k & (N - 1), f), 0); return e ? t.zw : t.xy; }
vec2 X(int f, int k, bool e) { vec2 a = Z(f, k, e), b = Z(f, N - k, e); return .5 * vec2(a.x + b.x, a.y - b.y); }
float warp(float f) { return scale == 0 ? log2(f) : scale == 1 ? ${2595 / Math.LN10} * log(1. + f / 700.) : scale == 3 ? ${21.4 / Math.LN10} * log(1. + ${.00437} * f) : f; }

void main() {
  int i = gl_VertexID / nb, k = k0 + gl_VertexID - i * nb, f = i >> 1;
  bool e = (i & 1) == 1;
  gl_PointSize = 1.;
  gl_Position = vec4(2, 2, 2, 1); // outside the clip volume: dropped
  v = vec2(0);
  vec2 a = Z(f, k, e), b = Z(f, N - k, e), xm = X(f, k - 1, e), xp = X(f, k + 1, e), d = xm - xp;
  vec2 h = .25 * vec2(a.x + b.x, a.y - b.y) - .25 * (xm + xp);  // Hann
  vec2 dh = ${Math.PI / 2} / float(N) * vec2(d.y, -d.x);        // its derivative
  vec2 th = float(N >> 2) * vec2(a.y + b.y, b.x - a.x);          // Hann × (n - N/2)
  float P = dot(h, h), p = P * norm;
  if (!(p > 1e-20)) return;
  float fq = (float(k) - float(N) * ${1 / (2 * Math.PI)} * (dh.y * h.x - dh.x * h.y) / P) * hz;
  float dt = squeeze == 1 ? 0. : (th.x * h.x + th.y * h.y) / P;
  // energy placed outside the window, or outside 0..Nyquist, is not the frame's to give
  if (abs(dt) > float(N >> 1) || (scale == 0 ? fq <= 0. : fq < 0.)) return;
  // the column from the frame's own, so a point lands in the same column whichever run computes it
  vec4 fr = texelFetch(frames, ivec2(i & 1023, i >> 10), 0);
  float r = floor((warp(fq) - b0) * bk), c = fr.z + (squeeze == 1 ? 0. : floor(fr.w + dt / cw));
  if (r < 0. || r >= float(rows) || c < 0. || c >= float(span)) return;
  gl_Position = vec4((float((slot + int(c)) & (cap - 1)) + .5) / float(cap) * 2. - 1., (r + .5) / float(rows) * 2. - 1., 0, 1);
  v = squeeze == 1 ? ((k & 1) == 1 ? -h : h) * sqrt(norm) : vec2(p, 0);
}`

// A point per frame and row, in the frame's column: the highest its spectrum reaches between the row's edges, the
// spectrum drawn as a line through its bins, so a row narrower than a bin reads between two and a wide one its loudest
//   kind 0  |Z|², the frame Hann-windowed (frames, bands)
//   kind 1  the sum of TAPERS sine tapers' powers on the bins of the frame padded to 2L: taper j, √(2/L) sin(πjn/L) over
//           n < L (Riedel & Sidorenko 1995, of L − 1 samples, centered on the frame's), has the spectrum
//           √(2/L) (X[k − j] − X[k + j]) / 2i, two bins of the padded frame's
//   kind 2  |Re Z|, Wigner–Ville's real spectrum
//   kind 3  a column of the spectra given (spectra()): its power, from its level byte, the frame's own column (src) of
//           `per` a texture row, times its weight (fr.y: 1, or for a mean 1 over the columns it is one of)
const GATHER = HEAD + `
uniform sampler2D spec, frames, edges, levels;
uniform int kind, N, last, cap, slot, span, rows, r0, nr, per;
uniform float norm, hz; // value → level; Hz per bin
flat out vec2 v;
int src;

vec2 Z(int f, int k) { vec4 t = texelFetch(spec, ivec2((k + N) & (N - 1), f >> 1), 0); return (f & 1) == 1 ? t.zw : t.xy; }
float P(int f, int k) {
  if (kind == 3) {
    float q = texelFetch(levels, ivec2((src % per) * (last + 1) + k, src / per), 0).r * 255.;
    return q > .5 ? exp2((q / ${LEVEL} - ${FLOOR}.) * ${Math.log2(10) / 10}) : 0.;
  }
  if (kind == 0) { vec2 z = Z(f, k); return dot(z, z); }
  if (kind == 2) return abs(Z(f, k).x);
  float s = 0.;
  for (int j = 1; j <= ${TAPERS}; j++) { vec2 d = Z(f, k - j) - Z(f, k + j); s += dot(d, d); }
  return s;
}
float at(int f, float x) { int i = min(int(x), last - 1); return mix(P(f, i), P(f, i + 1), x - float(i)); }
float edge(int r) { return clamp(texelFetch(edges, ivec2(r & 1023, r >> 10), 0).r / hz, 0., float(last)); }

void main() {
  int i = gl_VertexID / nr, r = r0 + gl_VertexID - i * nr;
  gl_PointSize = 1.;
  gl_Position = vec4(2, 2, 2, 1);
  v = vec2(0);
  vec4 fr = texelFetch(frames, ivec2(i & 1023, i >> 10), 0);
  float c = fr.z;
  src = int(fr.x);
  if (c < 0. || c >= float(span)) return;
  float a = edge(r), b = edge(r + 1), m = max(at(i, a), at(i, b));
  for (int k = int(ceil(a)); float(k) < b; k++) m = max(m, P(i, k));
  gl_Position = vec4((float((slot + int(c)) & (cap - 1)) + .5) / float(cap) * 2. - 1., (float(r) + .5) / float(rows) * 2. - 1., 0, 1);
  v = vec2(m * norm * (kind == 3 ? fr.y : 1.), 0);
}`

const POINT = HEAD + `
flat in vec2 v;
out vec4 o;
void main() { o = vec4(v, 0, 0); }`

// A run's cells onto the cache's same texels, as they are or, summed complex, as their power (blended there into the
// mean, or by MAX, for a column's further frame)
const FOLD = HEAD + `
uniform sampler2D src;
uniform int power;
out vec4 o;
void main() { vec4 t = texelFetch(src, ivec2(gl_FragCoord.xy), 0); o = vec4(power == 1 ? dot(t.xy, t.xy) : t.r, 0, 0, 0); }`

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
  ...Object.fromEntries([2, 4, 8].flatMap(R => [
    ['first' + R, [QUAD, FIRST(R, SAMPLES), { samples: 2, layers: 3, frames: 4, tw: 1 }, ['N', 'len', 'blocks', 'L', 'shape']]],
    ['analytic' + R, [QUAD, FIRST(R, ANALYTIC), { src: 0, tw: 1 }, ['N']]],
    ['lag' + R, [QUAD, FIRST(R, LAG), { src: 0, tw: 1 }, ['N']]]
  ])),
  stage: [QUAD, STAGE, { src: 0, tw: 1 }, ['N', 'L']],
  scatter: [SCATTER, POINT, { spec: 0, frames: 4 }, ['N', 'k0', 'nb', 'cap', 'slot', 'span', 'rows', 'scale', 'squeeze', 'cw', 'norm', 'hz', 'b0', 'bk']],
  gather: [GATHER, POINT, { spec: 0, frames: 4, edges: 6, levels: 7 }, ['kind', 'N', 'last', 'cap', 'slot', 'span', 'rows', 'r0', 'nr', 'norm', 'hz', 'per']],
  fold: [QUAD, FOLD, { src: 0 }, ['power']],
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
  #method = 'reassigned'
  #combine = 'mean'
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
  #spectra = null        // the spectra given: { size, hop, bins, cols, data (a byte per bin, column after column), tex, per, rows, sent }
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
      if (o.scale != null && !SCALE.hasOwnProperty(o.scale)) throw TypeError(`gl-spectrogram: scale must be log, mel, erb or lin, not ${o.scale}`)
      this.#scale = o.scale ?? 'log'
    }
    if (o.method !== undefined) {
      if (o.method != null && !METHODS.includes(o.method)) throw TypeError(`gl-spectrogram: method must be ${METHODS.join(', ')}, not ${o.method}`)
      this.#method = o.method ?? 'reassigned'
    }
    if (o.combine !== undefined) {
      if (o.combine != null && !COMBINES.includes(o.combine)) throw TypeError(`gl-spectrogram: combine must be ${COMBINES.join(' or ')}, not ${o.combine}`)
      this.#combine = o.combine ?? 'mean'
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

  /**
   * Spectra of samples not held (a long sound's, its samples elsewhere): `levels`, a column after another from column `at`,
   * each of `hop` samples (a power of two), each bin's power over the column's frames of `size` points (Hann, every
   * size / 2 samples) joined as `combine` joins a column's frames (their mean, or the loudest), as a byte per bin up to
   * Nyquist: (dB + 150) · 1.6, 0 dB a full-scale sine on its bin, 0
   * silence. Columns whose frames read samples not held are drawn from them; set() writes samples over them, drop() lets
   * samples go again. `length`: the samples they cover, where they end short of a column.
   */
  spectra(levels, { size, hop, at = 0, length } = {}) {
    if (!(Number.isInteger(Math.log2(size)) && size >= 16 && Number.isInteger(Math.log2(hop)) && hop >= 1)) throw TypeError('gl-spectrogram: spectra need a power of two size and hop')
    let bins = size / 2 + 1, cols = Math.floor(levels.length / bins), S = this.#spectra
    if (!S || S.size !== size || S.hop !== hop) S = this.#spectra = { size, hop, bins, cols: 0, data: new Uint8Array(0), tex: null, sent: 0 }
    let need = (at + cols) * bins
    if (S.data.length < need) { let d = new Uint8Array(Math.max(need, 2 * S.data.length)); d.set(S.data); S.data = d }
    S.data.set(levels.subarray(0, cols * bins), at * bins)
    S.cols = Math.max(S.cols, at + cols)
    S.sent = Math.min(S.sent, at)
    let end = length ?? (at + cols) * hop
    if (end > MAX) throw RangeError(`gl-spectrogram: data ends past sample ${MAX}`)
    this.#n = Math.max(this.#n, end)
    this.#invalidate(at * hop, (at + cols) * hop)
    return this
  }

  /** Let go of the samples of the whole chunks (65536) within [from, to): the spectra given draw them again. */
  drop(from = 0, to = this.#n) {
    let j0 = Math.ceil(from / C), j1 = Math.floor(Math.min(to, this.#n) / C)
    for (let j = j0; j < j1 && j < this.#chunks.length; j++) {
      this.#chunks[j] = null
      this.#fresh.fill(0, j * C / LW, (j + 1) * C / LW)
    }
    if (j1 > j0) this.#invalidate(j0 * C, j1 * C)
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
      for (let t of [this.#tex, this.#index, this.#lut, this.#spectra?.tex]) gl.deleteTexture(t)
      for (let K of [...this.#views, this.#whole?.K, ...this.#whole?.chain ?? []]) if (K) { gl.deleteTexture(K.tex); gl.deleteFramebuffer(K.fbo) }
    }
    this.#tex = this.#index = this.#lut = this.#whole = this.#spectra = null
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
    if (this.#spectra?.tex && !this.gl.isContextLost()) this.gl.deleteTexture(this.#spectra.tex)
    this.#spectra = null
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
      let lo = Math.floor((a - K.reach + .5) / K.cw) - 1, hi = Math.floor((b + K.reach + .5) / K.cw) + 1, t = K.tags
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

  // The rows frames [0, nf) of c.params read, `half` samples either side of their centers, uploaded where the GPU does
  // not hold them as they are. Frames come in order, so their rows merge into runs; a run goes up a chunk (32 rows) at a
  // time, gaps in a written block as zeros.
  #fetch(p, nf, half) {
    let gl = this.gl, fresh = this.#fresh, n = this.#n, a = 0, b = 0, bound = false
    let up = (r, e) => {
      for (let i = r; i < e; i++) fresh[i] = 1
      let z = this.#blocks[r >> (LB - Math.log2(LW))], d = this.#chunks[r >> 5], y = r & (LH - 1), o = (r & 31) * LW
      if (z === undefined) return
      if (!bound) {
        bound = true
        bind(gl, 2, gl.TEXTURE_2D_ARRAY, this.#tex)
        unpack(gl)
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
      let t = p[4 * i] * 65536 + p[4 * i + 1], r0 = Math.max(t - half, 0) / LW | 0, r1 = Math.ceil(Math.min(t + half, n) / LW)
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
    let max = (contexts.get(this.gl)?.max ?? 16384) / (this.#method === 'tapers' || this.#method === 'wigner' ? 2 : 1) // their FFTs are 2N
    if (this.#size) return Math.min(this.#size, max)
    let [to, of] = WARP[this.#scale], a = to(lo), b = to(hi), m = (a + b) / 2, e = (b - a) / rows / 2, rate = this.#rate
    let n = Math.max(rate * WINDOW, rate / (4 * (of(m + e) - of(m - e))))
    return Math.min(Math.max(2 ** Math.ceil(Math.log2(n)), NMIN), NMAX, max)
  }

  // The cache for view v, and v's columns in it: q0 under the left edge, f0 the edge's offset, ratio columns per px.
  // A cache is reused for columns of the same width, up to rounding in the range's arithmetic.
  #cache(v) {
    let { W, H, cw, N, b0, bk } = v, s = this.#scale, rate = this.#rate, method = this.#method, combine = this.#combine
    let i = this.#views.findIndex(K => K.N === N && K.rows === H && K.b0 === b0 && K.bk === bk && K.scale === s && K.rate === rate && K.method === method && K.combine === combine && Math.abs(K.cw / cw - 1) < 1e-9)
    let K = i < 0 ? this.#views.length < 2 ? {} : this.#views.pop() : this.#views.splice(i, 1)[0]
    this.#views.unshift(K)
    this.#wide = Math.max(this.#wide, W)
    let cap = Math.min(2 ** Math.ceil(Math.log2(2 * this.#wide + 4)), contexts.get(this.gl).max)
    if (i < 0) layout(Object.assign(K, { cw, N, b0, bk, scale: s, rate, method, combine, sub: perColumn(cw, N) }), H, contexts.get(this.gl).max)
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

  // Columns [a, b) of cache K computed from one frame each, or, where their frames read samples not held, from the
  // spectra given, whole at once; true if any had to be
  #need(K, a, b) {
    let t = K.tags, d = K.done, mask = K.cap - 1, ran = false, given = q => !this.#held(K, q) && this.#given(K, q)
    for (let q = a; q < b;) {
      if (t[q & mask] === q) { q++; continue }
      let g = given(q), e = q + 1
      while (e < b && t[e & mask] !== e && given(e) === g) e++
      if (g) this.#fromSpectra(K, q, e)
      else this.#run(K, q, e, 0)
      for (let i = q; i < e; i++) { t[i & mask] = i; d[i & mask] = g ? K.sub : 1 }
      ran = true
      q = e
    }
    return ran
  }

  // Whether the samples column q's frames read are all held (or past the data, silence)
  #held(K, q) {
    let a = Math.max(0, Math.floor((q * K.cw - K.reach) / C)), b = Math.min(Math.ceil(this.#n / C), Math.ceil(((q + 1) * K.cw + K.reach) / C))
    for (let j = a; j < b; j++) if (!this.#chunks[j]) return false
    return true
  }

  // Whether the spectra given reach column q
  #given(K, q) { let S = this.#spectra; return !!S && q * K.cw < S.cols * S.hop }

  // Columns [lo, hi) of K from the spectra given: each the mean, or the loudest, of those its samples span (K.combine; the
  // one under its middle, a column narrower than theirs), read across rows as frames are (GATHER, kind 3)
  #fromSpectra(K, lo, hi) {
    let gl = this.gl, c = contexts.get(gl), S = this.#spectra, { cap, rows, cw } = K, p = c.params, s0 = lo & (cap - 1)
    let spans = s0 + hi - lo <= cap ? [[s0, hi - lo]] : [[s0, cap - s0], [0, s0 + hi - lo - cap]]
    gl.bindFramebuffer(gl.FRAMEBUFFER, K.fbo)
    gl.colorMask(true, true, true, true)
    gl.disable(gl.BLEND)
    gl.enable(gl.SCISSOR_TEST)
    gl.clearColor(0, 0, 0, 0)
    for (let [x, w] of spans) { gl.scissor(x, 0, w, rows); gl.clear(gl.COLOR_BUFFER_BIT) }
    gl.disable(gl.SCISSOR_TEST)
    gl.bindVertexArray(c.vao)
    this.#uploadSpectra()
    edges(gl, c, K)
    let nf = 0, flush = () => {
      if (!nf) return
      bind(gl, 4, gl.TEXTURE_2D, c.frames)
      unpack(gl)
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 1024, Math.ceil(nf / 1024), gl.RGBA, gl.FLOAT, p)
      bind(gl, 0, gl.TEXTURE_2D, S.tex)
      bind(gl, 7, gl.TEXTURE_2D, S.tex)
      gather(gl, c, K, K, S.tex, nf, s0, hi - lo, { kind: 3, N: S.size, last: S.size / 2, hz: K.rate / S.size, norm: c.half ? HALF : 1, r0: 0, nr: rows, per: S.per, max: K.combine === 'max' })
      nf = 0
    }
    for (let q = lo; q < hi; q++) {
      let a = Math.floor((q * cw - .5) / S.hop), b = Math.ceil(((q + 1) * cw - .5) / S.hop)
      if (b - a < 1) a = b = Math.floor(((q + .5) * cw - .5) / S.hop), b++
      let o0 = Math.max(a, 0), o1 = Math.min(b, S.cols), w = K.combine === 'max' ? 1 : 1 / (o1 - o0)
      for (let o = o0; o < o1; o++) {
        p[4 * nf] = o; p[4 * nf + 1] = w; p[4 * nf + 2] = q - lo; p[4 * nf + 3] = 0
        if (++nf === 1024 * 32) flush()
      }
    }
    flush()
  }

  // The spectra given on the GPU: a byte a texel, `per` columns a row; what came since the last upload goes up
  #uploadSpectra() {
    let gl = this.gl, c = contexts.get(gl), S = this.#spectra
    S.per = Math.max(1, Math.floor(c.max / S.bins))
    let rows = Math.ceil(S.cols / S.per)
    if (!S.tex || S.rows < rows) {
      gl.deleteTexture(S.tex)
      gl.activeTexture(gl.TEXTURE7)
      gl.bindTexture(gl.TEXTURE_2D, S.tex = gl.createTexture())
      filter(gl, gl.TEXTURE_2D)
      gl.texStorage2D(gl.TEXTURE_2D, 1, gl.R8, S.per * S.bins, S.rows = Math.min(c.max, Math.max(rows, 2 * (S.rows ?? 0), 1)))
      S.sent = 0
    }
    if (S.sent >= S.cols) return
    let r0 = Math.floor(S.sent / S.per), w = S.per * S.bins, d = new Uint8Array((rows - r0) * w)
    d.set(S.data.subarray(r0 * w, Math.min(S.data.length, rows * w)))
    gl.activeTexture(gl.TEXTURE7)
    gl.bindTexture(gl.TEXTURE_2D, S.tex)
    unpack(gl)
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1)
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, r0, w, rows - r0, gl.RED, gl.UNSIGNED_BYTE, d)
    S.sent = S.cols
  }

  // More frames for columns [a, b), fewest-framed first, while `budget` frames of N points last (K.cost each), one
  // column at least so a render always gets further; true if some still lack frames
  #refine(K, a, b, budget) {
    let d = K.done, mask = K.cap - 1, m = margin(K), first = true
    budget /= K.cost
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

  // Columns [lo, hi) of K, their frame j of K.sub: every frame j that can reach them transformed and drawn into them
  // only, so columns computed in turns hold what they would computed at once. Frame 0 sums into the emptied columns;
  // each further frame sums apart and joins them as K.combine says: into their mean, so a column reads the same from its
  // first frame to its last, or the larger, so a click between frames reads at its level. Frames sit evenly across a column, the middle one first, each centered on a
  // sample t, which the column holds; a reassigned time t̂ (samples) goes to column floor((t̂ + .5) / cw), so sample k's
  // energy sits at k, as a waveform draws it.
  #run(K, lo, hi, j) {
    let gl = this.gl, c = contexts.get(gl), { N, cw, cap, rows, sub, method, rate } = K, m = margin(K), H = c.half ? HALF : 1
    let squeeze = method === 'synchrosqueezed', into = j || squeeze ? temp(gl, c, cap, rows, squeeze) : K
    gl.bindFramebuffer(gl.FRAMEBUFFER, into.fbo)
    gl.colorMask(true, true, true, true)
    gl.disable(gl.BLEND)
    gl.enable(gl.SCISSOR_TEST)
    gl.clearColor(0, 0, 0, 0)
    let s0 = lo & (cap - 1), len = hi - lo, spans = s0 + len <= cap ? [[s0, len]] : [[s0, cap - s0], [0, s0 + len - cap]]
    for (let [x, w] of spans) { gl.scissor(x, 0, w, rows); gl.clear(gl.COLOR_BUFFER_BIT) }
    gl.disable(gl.SCISSOR_TEST)
    gl.bindVertexArray(c.vao)

    let S = scratch(gl, c, K.size), B = 2 * S.P, p = c.params, scattered = method === 'reassigned' || squeeze
    let at = ((sub - 1) / 2 + (j & 1 ? -(j + 1) / 2 : j / 2) + .5) / sub // frame j's place in its column, 0..1
    if (!scattered) edges(gl, c, K)
    this.#spent += (len + 2 * m) * K.cost
    for (let a = lo - m; a < hi + m; a += B) {
      let nf = Math.min(B, hi + m - a), pairs = Math.ceil(nf / 2)
      for (let i = 0; i < 2 * pairs; i++) {
        let t = i < nf ? Math.round((a + i + at) * cw - .5) : -2 * K.size, x = Math.floor(t / 65536)
        p[4 * i] = x; p[4 * i + 1] = t - x * 65536; p[4 * i + 2] = a + i - lo; p[4 * i + 3] = (t + .5) / cw - a - i
      }
      this.#fetch(p, nf, K.half)
      bind(gl, 4, gl.TEXTURE_2D, c.frames)
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 1024, Math.ceil(2 * pairs / 1024), gl.RGBA, gl.FLOAT, p)
      // the frames' FFTs of n points: L samples around each center windowed by `shape`, zeros after; the scratch
      // texture's index holding them
      let spectra = (n, L, shape) => stages(gl, c, S, n, pairs, 0, R => {
        let { prog, u } = c['first' + R]
        gl.useProgram(prog)
        bind(gl, 2, gl.TEXTURE_2D_ARRAY, this.#tex)
        bind(gl, 3, gl.TEXTURE_2D, this.#index)
        gl.uniform1i(u.N, n)
        gl.uniform1i(u.len, this.#n)
        gl.uniform1i(u.blocks, this.#blocks.length)
        gl.uniform1i(u.L, L)
        gl.uniform1i(u.shape, shape)
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
      })
      let read = (spec, o) => gather(gl, c, K, into, spec, nf, s0, len, o)
      if (scattered) scatter(gl, c, K, into, S.tex[spectra(N, N, 0)], nf, s0, len)
      else if (method === 'wigner') {
        // the analytic signal of the 2N samples around each center, conjugated, then the FFT of its lag products
        let k = spectra(2 * N, 2 * N, 2)
        k = stages(gl, c, S, 2 * N, pairs, k ^ 1, R => pass(gl, c['analytic' + R], S.tex[k], 2 * N))
        k = stages(gl, c, S, N, pairs, k ^ 1, R => pass(gl, c['lag' + R], S.tex[k], N))
        // a full-scale sine's analytic signal is e^(iωn): its lag products' spectrum peaks at the lag window's sum, N/2
        read(S.tex[k], { kind: 2, N, last: N - 1, hz: rate / (2 * N), norm: 2 * H / N, r0: 0, nr: rows })
      }
      else if (method === 'tapers') read(S.tex[spectra(2 * N, N, 2)], { kind: 1, N: 2 * N, last: N, hz: rate / (2 * N), norm: H / tapers(N), r0: 0, nr: rows })
      // frames and bands: a full-scale sine on a bin gives (n/4)², Hann's coherent gain 1/2 (Harris 1978, table 1)
      else for (let { n, r0, nr } of K.passes) read(S.tex[spectra(n, n, 1)], { kind: 0, N: n, last: n / 2, hz: rate / n, norm: H / (n / 4) ** 2, r0, nr })
    }
    if (into === K) return
    // the run's cells onto the columns: as they are, squeezed ones as the power of their sums; a further frame's, frame j,
    // into their mean (1 / (j + 1) of it, the rest what the j before it made) or where they are larger
    gl.bindFramebuffer(gl.FRAMEBUFFER, K.fbo)
    gl.viewport(0, 0, cap, rows)
    let { prog, u } = c.fold
    gl.useProgram(prog)
    gl.uniform1i(u.power, squeeze ? 1 : 0)
    bind(gl, 0, gl.TEXTURE_2D, into.tex)
    if (j) {
      gl.enable(gl.BLEND)
      if (K.combine === 'max') gl.blendEquation(gl.MAX)
      else { gl.blendEquation(gl.FUNC_ADD); gl.blendColor(0, 0, 0, 1 / (j + 1)); gl.blendFunc(gl.CONSTANT_ALPHA, gl.ONE_MINUS_CONSTANT_ALPHA) }
    }
    gl.enable(gl.SCISSOR_TEST)
    for (let [x, w] of spans) { gl.scissor(x, 0, w, rows); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4) }
    gl.disable(gl.SCISSOR_TEST)
    gl.blendEquation(gl.FUNC_ADD)
    gl.disable(gl.BLEND)
  }

  // The whole data's picture, columns of a power of two samples so pushes redo only the end, and its loudest cell,
  // reduced on the GPU: [cells, …, 1 × 1]
  #peak() {
    let gl = this.gl, c = contexts.get(gl), s = this.#scale, method = this.#method, rate = this.#rate, [to] = WARP[s], lo = scales[s].low, hi = rate / 2
    let cw = 2 ** Math.ceil(Math.log2(Math.max(this.#n / WHOLE, 1))), b0 = to(lo), bk = WROWS / (to(hi) - to(lo)), N = this.#fft(lo, hi, WROWS)
    let P = this.#whole ??= { K: {}, chain: [], dirty: true }, K = P.K
    if (!(K.tex && K.cw === cw && K.N === N && K.b0 === b0 && K.bk === bk && K.scale === s && K.rate === rate && K.method === method && K.combine === this.#combine)) {
      layout(Object.assign(K, { cw, N, b0, bk, scale: s, rate, method, combine: this.#combine, sub: 1 }), WROWS, c.max)
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
    unpack(gl)
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 256, 1, gl.RGBA, gl.UNSIGNED_BYTE, px)
    this.#painted = true
  }

  #lost = e => {
    e.preventDefault()
    contexts.delete(this.gl)
    this.#tex = this.#index = this.#lut = this.#whole = null
    if (this.#spectra) this.#spectra.tex = null
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
    // per frame: [center sample ÷ 65536, its remainder, column from the run's first, center in columns from the frame's]
    c.params = new Float32Array(1024 * 32 * 4)
    gl.activeTexture(gl.TEXTURE4)
    gl.bindTexture(gl.TEXTURE_2D, c.frames = gl.createTexture())
    filter(gl, gl.TEXTURE_2D)
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA32F, 1024, 32)
    // row edges, Hz, 1024 a row: room for every row of the tallest viewport
    gl.activeTexture(gl.TEXTURE6)
    gl.bindTexture(gl.TEXTURE_2D, c.edges = gl.createTexture())
    filter(gl, gl.TEXTURE_2D)
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.R32F, 1024, Math.ceil((c.max + 1) / 1024))
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

// Columns either side of a run whose frames can reach into it: reassignment moves energy up to N/2 in time; the other
// methods keep a frame in its column
const margin = K => K.method === 'reassigned' ? Math.ceil((K.N / 2 + 1) / K.cw) + 1 : 0

// What view K's frames take, from its method: passes of FFTs { n points of l samples, giving rows [r0, r0 + nr) }, the
// widest FFT (the scratch's width), half the longest frame, how far a frame's energy reaches from its center, and a
// frame's cost in FFTs of N points
function layout(K, rows, max) {
  let { N, method } = K, of = WARP[K.scale][1], passes = []
  if (method === 'bands') for (let r = 0; r < rows; r++) {
    let f = of(K.b0 + (r + .5) / K.bk), n = Math.min(Math.max(N * BANDS.find(([edge]) => f < edge)[1], 16), max), last = passes.at(-1)
    if (last?.n === n) last.nr++
    else passes.push({ n, l: n, r0: r, nr: 1 })
  }
  else passes.push({ ...method === 'tapers' ? { n: 2 * N, l: N } : method === 'wigner' ? { n: 2 * N, l: 2 * N } : { n: N, l: N }, r0: 0, nr: rows })
  K.passes = passes
  K.size = Math.max(...passes.map(p => p.n))
  K.half = Math.max(...passes.map(p => p.l)) / 2
  K.reach = K.half + (method === 'reassigned' ? N / 2 : 0)
  K.cost = method === 'wigner' ? 5 : passes.reduce((s, p) => s + p.n, 0) / N
  return K
}

// The tapers' sum in GATHER for a full-scale sine on a bin of the padded frame: Σ cot²(πj/2L) over odd j, as taper j sums
// to √(2/L) cot(πj/2L) for odd j and to 0 for even; their average's top, flat over ±1 bin, is there
const tapers = L => { let s = 0; for (let j = 1; j <= TAPERS; j += 2) s += Math.tan(Math.PI * j / (2 * L)) ** -2; return s }

// An FFT of n points over `pairs` rows of two frames each: the first stage drawn by first(R) into S.tex[k], the
// radix-8 stages ping-ponging after it; the index of the texture holding the result
function stages(gl, c, S, n, pairs, k, first) {
  let [R, ...radices] = plan(n)
  gl.bindFramebuffer(gl.FRAMEBUFFER, S.fbo[k])
  gl.viewport(0, 0, n, pairs)
  bind(gl, 1, gl.TEXTURE_2D, twiddles(gl, c, n))
  first(R)
  let { prog, u } = c.stage
  gl.useProgram(prog)
  gl.uniform1i(u.N, n)
  radices.forEach((_, i) => {
    bind(gl, 0, gl.TEXTURE_2D, S.tex[k])
    gl.bindFramebuffer(gl.FRAMEBUFFER, S.fbo[k ^= 1])
    gl.uniform1i(u.L, R * 8 ** i)
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
  })
  return k
}

// A first stage reading the previous transform, src
function pass(gl, P, src, n) {
  gl.useProgram(P.prog)
  bind(gl, 0, gl.TEXTURE_2D, src)
  gl.uniform1i(P.u.N, n)
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
}

// Reassignment: a point per frame and bin of the band's (8 more either side), at its reassigned column and row with its
// power; synchrosqueezed, in its frame's column with its value
function scatter(gl, c, K, into, spec, nf, slot, span) {
  let { N, cap, rows, rate } = K, h = N / 2, hz = rate / N, of = WARP[K.scale][1], squeeze = K.method === 'synchrosqueezed'
  let k0 = Math.max(0, Math.floor(of(K.b0) / hz) - 8), nb = Math.min(h, Math.ceil(of(K.b0 + rows / K.bk) / hz) + 8) - k0
  let u = points(gl, c.scatter, into, cap, rows, spec)
  gl.uniform1i(u.N, N)
  gl.uniform1i(u.k0, k0)
  gl.uniform1i(u.nb, nb)
  gl.uniform1i(u.cap, cap)
  gl.uniform1i(u.slot, slot)
  gl.uniform1i(u.span, span)
  gl.uniform1i(u.rows, rows)
  gl.uniform1i(u.scale, SCALE[K.scale])
  gl.uniform1i(u.squeeze, squeeze ? 1 : 0)
  gl.uniform1f(u.cw, K.cw)
  // a full-scale sine sums to 1. Reassigned: Hann's coherent gain 1/2 puts (N/4)² in its bin, its main lobe holds 1.5×
  // that (Harris 1978, table 1). Synchrosqueezed: its bins' zero-phase values sum to N/2, as a DFT's bins sum to N times
  // the sample at n = 0, here the sine's positive half, ½, under Hann's center, 1.
  gl.uniform1f(u.norm, (c.half ? HALF : 1) / (squeeze ? h * h : 1.5 * (N / 4) ** 2))
  gl.uniform1f(u.hz, hz)
  gl.uniform1f(u.b0, K.b0)
  gl.uniform1f(u.bk, K.bk)
  gl.drawArrays(gl.POINTS, 0, nf * nb)
  gl.disable(gl.BLEND)
}

// Spectra read across rows: a point per frame and row of [r0, r0 + nr), in the frame's column (GATHER)
function gather(gl, c, K, into, spec, nf, slot, span, { kind, N, last, hz, norm, r0, nr, per = 1, max = false }) {
  let { cap, rows } = K, u = points(gl, c.gather, into, cap, rows, spec)
  // columns from the spectra given: each the loudest of those it spans, or their sum, each weighted to their mean
  if (max) gl.blendEquation(gl.MAX)
  gl.uniform1i(u.per, per)
  gl.uniform1i(u.kind, kind)
  gl.uniform1i(u.N, N)
  gl.uniform1i(u.last, last)
  gl.uniform1i(u.cap, cap)
  gl.uniform1i(u.slot, slot)
  gl.uniform1i(u.span, span)
  gl.uniform1i(u.rows, rows)
  gl.uniform1i(u.r0, r0)
  gl.uniform1i(u.nr, nr)
  gl.uniform1f(u.norm, norm)
  gl.uniform1f(u.hz, hz)
  gl.drawArrays(gl.POINTS, 0, nf * nr)
  gl.blendEquation(gl.FUNC_ADD)
  gl.disable(gl.BLEND)
}

// Points summed into the cap × rows cells of `into` by program P, its spectrum at unit 0: P's uniforms
function points(gl, P, into, cap, rows, spec) {
  gl.bindFramebuffer(gl.FRAMEBUFFER, into.fbo)
  gl.viewport(0, 0, cap, rows)
  gl.enable(gl.BLEND)
  gl.blendEquation(gl.FUNC_ADD)
  gl.blendFunc(gl.ONE, gl.ONE)
  gl.useProgram(P.prog)
  bind(gl, 0, gl.TEXTURE_2D, spec)
  return P.u
}

// Row edges of view K in Hz, rows + 1 from doubles, 1024 a texture row: where GATHER reads each row's band
function edges(gl, c, K) {
  let of = WARP[K.scale][1], n = K.rows + 1, d = new Float32Array(Math.ceil(n / 1024) * 1024)
  for (let r = 0; r < n; r++) d[r] = of(K.b0 + r / K.bk)
  bind(gl, 6, gl.TEXTURE_2D, c.edges)
  unpack(gl)
  gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 1024, d.length / 1024, gl.RED, gl.FLOAT, d)
}

let zeros = null // a chunk of silence, for rows of a written block that no chunk holds

// Cells of a run before they join the columns: a frame beyond a column's first, or synchrosqueezed sums, complex (rg);
// at least w × h
function temp(gl, c, w, h, rg = false) {
  let key = rg ? 'sums' : 'temp', t = c[key]
  if (t && t.w >= w && t.h >= h) return t
  if (t) { gl.deleteTexture(t.tex); gl.deleteFramebuffer(t.fbo) }
  w = Math.max(w, t?.w ?? 0); h = Math.max(h, t?.h ?? 0)
  return c[key] = { ...surface(gl, rg ? c.half ? gl.RG16F : gl.RG32F : c.half ? gl.R16F : gl.R32F, w, h), w, h }
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
  unpack(gl)
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

// Pixel unpacking as uploads here expect it, whatever another user of the context left
function unpack(gl) {
  gl.bindBuffer(gl.PIXEL_UNPACK_BUFFER, null)
  for (let i = 0; i < UNPACK.length; i += 2) gl.pixelStorei(gl[UNPACK[i]], UNPACK[i + 1])
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
