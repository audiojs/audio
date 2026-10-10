/**
 * gl-waveform – WebGL2 waveform renderer.
 *
 * Zoomed out, every device-pixel column shows the exact min/max of its samples, joined to its neighbours, with an
 * inner RMS band. Zoomed in, an anti-aliased line runs through the samples, with dots once they are 6 CSS px apart.
 * Column statistics come from a min/max/sum² pyramid queried on the CPU in doubles; the GPU draws one quad per
 * viewport from a small texture of per-column (or per-sample) extents.
 */

const B = 256        // samples per pyramid leaf
const C = 1 << 16    // samples per storage chunk, a multiple of B
const TW = 2048      // data texture width, texels
const DOT = 6        // CSS px between samples where dots appear; they reach full size at twice that
const PEAKS = .3     // Gaussian density's fill past the body, of the line's alpha, by default
// Densities of unit variance, e^(−(v/α)^β): the generalized normal, α = √(Γ(1/β)/Γ(3/β)) (Nadarajah 2005, "A generalized
// normal distribution", J. Appl. Stat. 32(7)). Laplace β 1, Gaussian β 2, and β 4, flat to about its RMS, then soft
const DENSITY = { laplace: [1, Math.SQRT1_2], gaussian: [2, Math.SQRT2], flat: [4, 1.720079974649039] }
const EDGE = 1 / 3   // what of it is left at the column's extreme: a peak reached once still shows

const ATTRS = { premultipliedAlpha: true, preserveDrawingBuffer: true, antialias: false, depth: false, stencil: false }
const COLOR = [0.25, 0.45, 0.85, 1]

const VERT = `#version 300 es
void main() { gl_Position = vec4(vec2(gl_VertexID & 1, gl_VertexID >> 1) * 2. - 1., 0, 1); }`

const FRAG = `#version 300 es
precision highp float;
precision highp int;
uniform highp sampler2D data; // envelope: per column [lo, hi, rms lo, rms hi]; line: per sample [y, y]; lo > hi is a gap
uniform vec2 origin;          // viewport corner, device px
uniform int count, line;
uniform vec2 dense;           // density's [β, α], β 0 for the RMS band
uniform float pps, off, hw, rad; // px per sample, first sample position in samples, half line width, dot radius
uniform float zero, fade;        // silence's y, device px; how much a column holds several samples, 0..1
uniform vec4 color, rms, peaks;  // premultiplied
out vec4 frag;

vec4 at(int i) { return texelFetch(data, ivec2(i & ${TW - 1}, i >> ${Math.log2(TW)}), 0); }

float seg(vec2 p, vec2 a, vec2 b) {
  vec2 ab = b - a, ap = p - a;
  return length(ap - ab * clamp(dot(ap, ab) / max(dot(ab, ab), 1e-12), 0., 1.));
}

void main() {
  vec2 p = gl_FragCoord.xy - origin;
  float d = 1e9, e = 1e9, r = 0.; // distance to the shape, to the nearest sample; RMS coverage
  vec4 f = color;                  // dense: the fill at this level
  if (line == 0) {
    // envelope: column i spans [lo, hi] at its center, neighbouring centers are joined; x is relative to this column
    int x = int(p.x), R = int(ceil(hw + .5));
    vec2 q = vec2(0, p.y);
    vec4 a = vec4(1, 0, 0, 0);
    for (int i = max(x - R, 0); i <= min(x + R, count - 1); i++) {
      vec4 b = at(i);
      float cx = float(i - x);
      if (b.x <= b.y) {
        d = min(d, length(vec2(cx, max(max(b.x - p.y, p.y - b.y), 0.))));
        if (a.x <= a.y) d = min(d, min(seg(q, vec2(cx - 1., a.x), vec2(cx, b.x)), seg(q, vec2(cx - 1., a.y), vec2(cx, b.y))));
      }
      a = b;
    }
    vec4 t = at(x);
    if (dense.x > 0. && t.x <= t.y) {
      // how often noise of the column's RMS R is at this level, against at zero, g = e^(−(v/α)^β), v = y/R. The body in
      // color as often as that, the rest in peaks, which fades from the axis to EDGE of it at the column's extreme on
      // that side, so the fill grades all the way out
      float R = max(max(t.w - zero, zero - t.z), 1e-6), y = abs(p.y - zero), v = y / R;
      float g = exp(-pow(v / dense.y, dense.x)), s = clamp(y / max(p.y > zero ? t.y - zero : zero - t.x, 1e-6), 0., 1.);
      f = mix(color, color * g + peaks * (1. - g) * (1. - ${1 - EDGE} * s), fade);
    }
    else r = clamp(min(t.w, p.y + .5) - max(t.z, p.y - .5), 0., 1.);
  } else {
    // line through the samples, dots at the samples
    float j = p.x / pps - off, reach = (max(hw, rad) + .5) / pps;
    vec2 a = vec2(0);
    bool va = false;
    for (int i = max(int(floor(j - reach)), 0); i <= min(int(ceil(j + reach)), count - 1); i++) {
      vec4 t = at(i);
      vec2 b = vec2((float(i) + off) * pps, t.x);
      bool vb = t.x <= t.y;
      if (vb) {
        e = min(e, distance(p, b));
        if (va) d = min(d, seg(p, a, b));
      }
      a = b; va = vb;
    }
    d = min(d, e);
  }
  float c = clamp(max(hw + .5 - d, rad + .5 - e), 0., 1.);
  frag = dense.x > 0. && line == 0 ? f * c : rms * r + color * c * (1. - rms.a * r);
}`

const UNIFORMS = ['data', 'origin', 'count', 'line', 'dense', 'pps', 'off', 'hw', 'rad', 'zero', 'fade', 'color', 'rms', 'peaks']
const UNPACK = ['UNPACK_ALIGNMENT', 4, 'UNPACK_ROW_LENGTH', 0, 'UNPACK_SKIP_ROWS', 0, 'UNPACK_SKIP_PIXELS', 0, 'UNPACK_FLIP_Y_WEBGL', 0, 'UNPACK_PREMULTIPLY_ALPHA_WEBGL', 0]

// Programs are shared by all instances on a context and dropped when it is lost
const programs = new WeakMap()

export default class Waveform {
  #chunks = []      // samples: Float32Array chunks of C, null where nothing was written (reads as NaN)
  #owned = new WeakSet() // chunks this instance allocated; the rest are views of the caller's array, never written
  #n = 0            // length
  #tree = []        // pyramid: tree[L] holds [min, max, sum², count] per node of B·2^L samples
  #version = 0      // bumps on every data change
  #range = null     // [from, to] or null for all data
  #amplitude = [-1, 1]
  #viewport = null  // CSS px [x, y, w, h] or null for the whole canvas
  #color = COLOR
  #rms = null       // color, false to hide, null for #color
  #peaks = null     // the envelope's color zoomed out, null for a tint of #color with the RMS band, #color without; with density, the fill past the body
  #density = false  // 'gaussian', 'laplace' or 'flat': the fill shaded by how often the signal is at each level, in place of the RMS band
  #thickness = 1
  #pixelRatio = null
  #o = new Float64Array(4)    // query scratch
  #cols = new Float64Array(0) // per column [from, to, min, max, rms]
  #key = ''                   // state #cols was computed for
  #buf = new Float32Array(0)  // texels
  #draw = null                // what #buf holds
  #tex = null
  #rows = 0
  #drawn = false

  constructor(target, options) {
    let gl = target?.getContext ? target.getContext('webgl2', ATTRS) : target
    if (!(gl instanceof WebGL2RenderingContext)) throw TypeError('gl-waveform: expected a canvas that supports WebGL2, or a WebGL2RenderingContext')
    this.gl = gl
    this.canvas = gl.canvas
    this.canvas.addEventListener?.('webglcontextlost', this.#lost)
    this.canvas.addEventListener?.('webglcontextrestored', this.#restored)
    if (!gl.isContextLost()) program(gl, false)
    if (options) this.update(options)
  }

  get length() { return this.#n }
  get range() { return this.#range ? [...this.#range] : [0, this.#n] }
  get amplitude() { return [...this.#amplitude] }

  /** Set any of data, range, amplitude, viewport, color, rms, peaks, density, thickness, pixelRatio; null restores the default. */
  update(o = {}) {
    if (o.data !== undefined) this.#load(o.data)
    if (o.range !== undefined) this.#range = o.range && nums(o.range, 2, 'range')
    if (o.amplitude !== undefined) this.#amplitude = o.amplitude ? nums(o.amplitude, 2, 'amplitude') : [-1, 1]
    if (o.viewport !== undefined) this.#viewport = o.viewport && nums(o.viewport, 4, 'viewport')
    if (o.thickness !== undefined) this.#thickness = o.thickness == null ? 1 : nums([o.thickness], 1, 'thickness')[0]
    if (o.pixelRatio !== undefined) this.#pixelRatio = o.pixelRatio == null ? null : nums([o.pixelRatio], 1, 'pixelRatio')[0]
    if (o.color !== undefined) this.#color = o.color == null ? COLOR : rgba(o.color, this.gl)
    if (o.rms !== undefined) this.#rms = o.rms === false ? false : o.rms == null || o.rms === true ? null : rgba(o.rms, this.gl)
    if (o.peaks !== undefined) this.#peaks = o.peaks == null ? null : rgba(o.peaks, this.gl)
    if (o.density !== undefined) {
      if (o.density != null && o.density !== true && o.density !== false && !Object.hasOwn(DENSITY, o.density)) throw TypeError(`gl-waveform: density must be gaussian, laplace, flat, true or false, not ${o.density}`)
      this.#density = o.density === true ? 'gaussian' : o.density || false
    }
    this.#draw = null
    return this
  }

  /** Append samples. */
  push(samples) { return this.set(samples, this.#n) }

  /** Summaries of samples not held, for a waveform zoomed out past them: a leaf of B (256) samples each, from sample
   *  `offset` (a multiple of 256), as [min, max, Σx², count] in a row; the data's length grows to cover them. Zoomed
   *  out to 1024 samples a pixel or more, columns are exact from them alone; zoomed in, columns read the samples, which
   *  set() writes over them, leaf by leaf. */
  peaks(leaves, offset = 0) {
    offset = Math.trunc(offset)
    if (!(offset >= 0) || offset % B) throw RangeError(`gl-waveform: peaks start at a multiple of ${B}`)
    let count = Math.floor(leaves.length / 4)
    if (!count) return this
    let j0 = offset / B, last = leaves[4 * count - 1], end = offset + (count - 1) * B + (last > 0 ? last : B)
    this.#n = Math.max(this.#n, end)
    let size = Math.ceil(this.#n / B), v = this.#tree[0] = grow(this.#tree[0], size * 4)
    for (let k = 0; k < count * 4; k++) v[j0 * 4 + k] = leaves[k]
    this.#index(offset, offset + count * B, false)
    this.#version++
    this.#draw = null
    return this
  }

  /** Let go of the samples of the whole chunks (65536) within [from, to), keeping what the pyramid knows of them: zoomed
   *  in there, the line has a gap till set() writes them again. */
  drop(from = 0, to = this.#n) {
    for (let j = Math.ceil(from / C); (j + 1) * C <= Math.min(to, Math.ceil(this.#n / C) * C) && j < this.#chunks.length; j++) this.#chunks[j] = null
    this.#version++
    this.#draw = null
    return this
  }

  /** Write samples at offset, extending the data if needed; a gap before offset reads as NaN. */
  set(samples, offset = 0) {
    offset = Math.trunc(offset)
    if (!(offset >= 0)) throw RangeError('gl-waveform: offset must be ≥ 0')
    if (!ArrayBuffer.isView(samples)) samples = Float32Array.from(samples)
    let end = offset + samples.length, from = Math.min(offset, this.#n)
    if (end === offset) return this
    for (let i = offset; i < end;) {
      let j = Math.floor(i / C), o = i - j * C, m = Math.min(C - o, end - i)
      this.#own(j).set(samples.subarray(i - offset, i - offset + m), o)
      i += m
    }
    this.#n = Math.max(this.#n, end)
    this.#index(from, end)
    this.#version++
    this.#draw = null
    return this
  }

  /** Draw into the viewport, over what is there. */
  render() {
    let gl = this.gl
    this.#drawn = true
    if (gl.isContextLost()) return this
    let [X, Y, W, H] = this.#rect(), d = this.#fill(W, H)
    if (!d.count) return this
    let { prog, vao, u } = program(gl)
    gl.activeTexture(gl.TEXTURE0)
    if (!this.#tex || d.rows > this.#rows) {
      gl.deleteTexture(this.#tex)
      gl.bindTexture(gl.TEXTURE_2D, this.#tex = gl.createTexture())
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
      gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA32F, TW, this.#rows = d.rows)
      d.uploaded = false
    }
    else gl.bindTexture(gl.TEXTURE_2D, this.#tex)
    if (!d.uploaded) {
      gl.bindBuffer(gl.PIXEL_UNPACK_BUFFER, null)
      for (let i = 0; i < UNPACK.length; i += 2) gl.pixelStorei(gl[UNPACK[i]], UNPACK[i + 1])
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, TW, d.rows, gl.RGBA, gl.FLOAT, this.#buf)
      d.uploaded = true
    }
    gl.useProgram(prog)
    gl.bindVertexArray(vao)
    this.#target(X, Y, W, H)
    gl.disable(gl.DEPTH_TEST)
    gl.disable(gl.STENCIL_TEST)
    gl.disable(gl.CULL_FACE)
    gl.enable(gl.BLEND)
    gl.blendEquation(gl.FUNC_ADD)
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA)
    gl.viewport(X, Y, W, H)
    gl.uniform1i(u.data, 0)
    gl.uniform2f(u.origin, X, Y)
    gl.uniform1i(u.count, d.count)
    gl.uniform1i(u.line, d.line)
    gl.uniform1f(u.pps, d.pps)
    gl.uniform1f(u.off, d.off)
    gl.uniform1f(u.hw, d.hw)
    gl.uniform1f(u.rad, d.rad)
    gl.uniform2f(u.dense, ...DENSITY[this.#density] ?? [0, 0])
    gl.uniform1f(u.zero, d.zero)
    gl.uniform1f(u.fade, d.fade)
    // the RMS band in the line's color, the envelope around it lighter: zoomed out the envelope takes peaks', zoomed in
    // the line keeps color, and they cross as columns go from 1 to 4 samples, where the band fades in
    // with density, the body in the line's color, the fill past it in peaks': by default the line's color, faint, for
    // the Gaussian; none for the Laplace cloud and the flat body
    let c = this.#color, band = this.#rms !== false && !this.#density, r = this.#rms || c, a = band ? r[3] * d.fade : 0
    let p = this.#peaks ?? (band ? tint(c) : this.#density === 'gaussian' ? [c[0], c[1], c[2], c[3] * PEAKS] : this.#density ? [0, 0, 0, 0] : c)
    let e = this.#density ? c : c.map((v, i) => v + (p[i] - v) * d.fade)
    gl.uniform4f(u.color, e[0] * e[3], e[1] * e[3], e[2] * e[3], e[3])
    gl.uniform4f(u.rms, a && r[0] * a, a && r[1] * a, a && r[2] * a, a)
    gl.uniform4f(u.peaks, p[0] * p[3], p[1] * p[3], p[2] * p[3], p[3])
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

  /** Samples under the column at x (CSS px from the viewport's left): { from, to, min, max, rms } or null. */
  pick(x) {
    let [X, , W] = this.#rect(), [r0, r1] = this.range, spp = (r1 - r0) / W
    let c = Math.floor(((this.#viewport?.[0] ?? 0) + x) * this.#pr()) - X
    if (!(c >= 0 && c < W && spp > 0 && spp < Infinity)) return null
    if (spp > 1) {
      let s = this.#columns(W), k = c * 5
      return s[k + 2] <= s[k + 3] ? { from: s[k], to: s[k + 1], min: s[k + 2], max: s[k + 3], rms: s[k + 4] } : null
    }
    let k = Math.round(r0 + (c + .5) * spp) + 0, v = this.#at(k)
    return v === v ? { from: k, to: k + 1, min: v, max: v, rms: Math.abs(v) } : null
  }

  destroy() {
    this.canvas.removeEventListener?.('webglcontextlost', this.#lost)
    this.canvas.removeEventListener?.('webglcontextrestored', this.#restored)
    if (!this.gl.isContextLost()) this.gl.deleteTexture(this.#tex)
    this.#tex = null
    this.#draw = null
    this.#chunks = []
    this.#tree = []
    this.#n = 0
  }

  // ── data ────────────────────────────────────────────────────────────────

  // The pyramid's arrays are kept for data up to 2× shorter, so new PCM for the same file allocates nothing
  #load(data) {
    let d = data instanceof Float32Array ? data : Float32Array.from(data ?? [])
    this.#chunks = []
    for (let i = 0; i < d.length; i += C) this.#chunks.push(d.subarray(i, i + C))
    if (d.length > this.#n || d.length * 2 < this.#n) this.#tree = []
    this.#n = d.length
    this.#index(0, this.#n)
    this.#version++
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

  #at(i) {
    let d = i >= 0 && i < this.#n && this.#chunks[Math.floor(i / C)]
    return d ? d[i % C] : NaN
  }

  // Rebuild the pyramid nodes covering samples [a, b), its leaves from the samples unless they were given (peaks)
  #index(a, b, scan = true) {
    let n = this.#n, t = this.#tree
    if (!n) return void (t.length = 0)
    let lo = Math.floor(a / B), hi = Math.ceil(b / B), size = Math.ceil(n / B), prev = 0
    for (let L = 0; ; L++) {
      let v = t[L] = grow(t[L], size * 4), w = t[L - 1]
      for (let j = lo; j < hi; j++) {
        let p = j * 4
        if (!L && !scan) continue
        v[p] = Infinity; v[p + 1] = -Infinity; v[p + 2] = v[p + 3] = 0
        if (!L) this.#scan(j * B, Math.min(j * B + B, n), v, p)
        else { merge(v, p, w, 2 * p); if (2 * j + 1 < prev) merge(v, p, w, 2 * p + 4) }
      }
      if (size === 1) return void (t.length = L + 1)
      lo >>= 1; hi = (hi + 1) >> 1; prev = size; size = (size + 1) >> 1
    }
  }

  // Samples [a, b) within one leaf into o, or the leaf where they are not held
  #part(a, b, o) {
    if (a >= b) return
    if (this.#chunks[Math.floor(a / C)]) return this.#scan(a, b, o, 0)
    let v = this.#tree[0], q = Math.floor(a / B) * 4
    if (v?.[q + 3] > 0) merge(o, 0, v, q)
  }

  // Accumulate samples [a, b), within one chunk, into v[p..p+3] = [min, max, sum², count]
  #scan(a, b, v, p) {
    let j = Math.floor(a / C), d = this.#chunks[j]
    if (a >= b || !d) return
    let s = a - j * C, e = b - j * C, lo = v[p], hi = v[p + 1], q = 0, k = e - s
    for (let i = s; i < e; i++) { let x = d[i]; if (x < lo) lo = x; if (x > hi) hi = x; q += x * x }
    if (q !== q) { q = 0; k = 0; for (let i = s; i < e; i++) { let x = d[i]; if (x === x) q += x * x, k++ } }
    v[p] = lo; v[p + 1] = hi; v[p + 2] += q; v[p + 3] += k
  }

  // Exact [min, max, sum², count] of samples [a, b) into o; where its edges fall in leaves whose samples are not held
  // (peaks), those leaves whole
  #stat(a, b, o) {
    o[0] = Infinity; o[1] = -Infinity; o[2] = o[3] = 0
    let ja = Math.ceil(a / B), jb = Math.floor(b / B)
    if (ja > jb) return this.#part(a, b, o)
    this.#part(a, ja * B, o)
    this.#part(jb * B, b, o)
    for (let L = 0; ja < jb; L++) {
      let v = this.#tree[L]
      if (ja & 1) merge(o, 0, v, 4 * ja++)
      if (jb & 1) merge(o, 0, v, 4 * --jb)
      ja >>= 1; jb >>= 1
    }
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

  // Per-column stats for width W. Column c starts at sample ceil((q+c)·spp), q = floor(from / spp): anchored to
  // multiples of samples per pixel, so a pan moves whole columns. From 4 leaves per pixel, edges round to a leaf edge
  // (1/8 px off at most), so a column is whole pyramid nodes and costs O(log n) instead of two partial-leaf scans.
  #columns(W) {
    let [r0, r1] = this.range, key = `${this.#version} ${r0} ${r1} ${W}`
    if (key === this.#key) return this.#cols
    let spp = (r1 - r0) / W, q = Math.floor(r0 / spp), n = this.#n, o = this.#o, snap = spp >= 4 * B
    let edge = c => snap ? Math.round(Math.ceil((q + c) * spp) / B) * B : Math.ceil((q + c) * spp)
    if (this.#cols.length < W * 5) this.#cols = new Float64Array(W * 5)
    let s = this.#cols, b = edge(0)
    for (let c = 0, k = 0; c < W; c++, k += 5) {
      let a = Math.max(b, 0)
      b = edge(c + 1)
      let e = Math.min(b, n)
      if (a < e) this.#stat(a, e, o)
      else o[0] = Infinity, o[1] = -Infinity, o[3] = 0
      s[k] = a; s[k + 1] = Math.max(a, e); s[k + 2] = o[0]; s[k + 3] = o[1]; s[k + 4] = o[3] && Math.sqrt(o[2] / o[3])
    }
    this.#key = key
    return s
  }

  // Texels for a W×H viewport
  #fill(W, H) {
    let pr = this.#pr(), [r0, r1] = this.range, [a0, a1] = this.#amplitude, key = `${W} ${H} ${pr}`
    if (this.#draw?.key === key) return this.#draw
    let spp = (r1 - r0) / W, ky = H / (a1 - a0), hw = Math.max(this.#thickness * pr / 2, .5), m = hw + 2
    let d = this.#draw = { key, count: 0, rows: 0, line: 0, pps: 1 / spp, off: 0, hw, rad: 0, fade: 0, zero: 0, uploaded: false }
    if (!(spp > 0 && spp < Infinity && Math.abs(ky) < Infinity && H > 0)) return d
    // the middle of the amplitude range sits on a pixel center for odd line widths, on an edge for even, so silence is crisp
    let y0 = Math.round(2 * hw) % 2 ? Math.floor(H / 2) + .5 : Math.round(H / 2), mid = (a0 + a1) / 2
    let y = v => { v = y0 + (v - mid) * ky; return v < -m ? -m : v > H + m ? H + m : v }
    d.zero = y(0)

    if (spp > 1) {
      let s = this.#columns(W), t = this.#texels(W), f = Math.min((spp - 1) / 3, 1)
      for (let c = 0, k = 0, p = 0; c < W; c++, k += 5, p += 4) {
        let lo = s[k + 2], hi = s[k + 3], r = s[k + 4]
        if (lo > hi) { t[p] = t[p + 2] = 1; t[p + 1] = t[p + 3] = 0; continue }
        let yl = y(lo), yh = y(hi), rl = y(Math.max(-r, lo)), rh = y(Math.min(r, hi))
        t[p] = Math.min(yl, yh); t[p + 1] = Math.max(yl, yh); t[p + 2] = Math.min(rl, rh); t[p + 3] = Math.max(rl, rh)
      }
      d.count = W
      d.fade = f * f * (3 - 2 * f) // the RMS band fades in over 1–4 samples per px, where columns start to hold several
    }
    else {
      let pps = 1 / spp, R = (this.#thickness + 3) / 2 * pr, f = Math.min(Math.max((pps / pr - DOT) / DOT, 0), 1)
      d.rad = f && hw + (R - hw) * f * f * (3 - 2 * f)
      let g = Math.ceil((Math.max(hw, d.rad) + .5) / pps) + 1
      let k0 = Math.max(Math.floor(r0) - g, 0), k1 = Math.min(Math.ceil(r1) + g, this.#n - 1)
      if (k1 < k0) return d
      let t = this.#texels(k1 - k0 + 1)
      for (let k = k0, p = 0; k <= k1; k++, p += 4) {
        let v = this.#at(k)
        if (v === v) t[p] = t[p + 1] = y(v)
        else t[p] = 1, t[p + 1] = 0
      }
      d.count = k1 - k0 + 1; d.line = 1; d.off = k0 - r0
    }
    d.rows = Math.ceil(d.count / TW)
    return d
  }

  #texels(count) {
    let len = Math.ceil(count / TW) * TW * 4
    if (this.#buf.length < len) this.#buf = new Float32Array(len)
    return this.#buf
  }

  #lost = e => {
    e.preventDefault()
    programs.delete(this.gl)
    this.#tex = null
    this.#rows = 0
    this.#draw = null
  }

  #restored = () => { if (this.#drawn) this.render() }
}

// ── helpers ───────────────────────────────────────────────────────────────

function merge(v, p, w, q) {
  if (w[q] < v[p]) v[p] = w[q]
  if (w[q + 1] > v[p + 1]) v[p + 1] = w[q + 1]
  v[p + 2] += w[q + 2]
  v[p + 3] += w[q + 3]
}

function grow(a, len) {
  if (a?.length >= len) return a
  let b = new Float64Array(Math.max(len, (a?.length ?? 0) * 2))
  if (a) b.set(a)
  return b
}

function nums(v, len, name) {
  let a = Array.from({ length: len }, (_, i) => +v?.[i])
  if (!a.every(Number.isFinite)) throw TypeError(`gl-waveform: ${name} must be ${len > 1 ? len + ' finite numbers' : 'a finite number'}`)
  return a
}

// The envelope's default around the RMS band: the line color, lightened
function tint(c) { return [c[0] + (1 - c[0]) * .45, c[1] + (1 - c[1]) * .45, c[2] + (1 - c[2]) * .45, c[3]] }

// Compiling starts with the first waveform on a context, so the driver works on it while data loads; the first draw waits
function program(gl, ready = true) {
  let p = programs.get(gl)
  if (!p) {
    let prog = gl.createProgram(), shaders = [[gl.VERTEX_SHADER, VERT], [gl.FRAGMENT_SHADER, FRAG]].map(([type, src]) => {
      let s = gl.createShader(type)
      gl.shaderSource(s, src)
      gl.compileShader(s)
      gl.attachShader(prog, s)
      return s
    })
    gl.linkProgram(prog)
    programs.set(gl, p = { prog, shaders, vao: gl.createVertexArray(), u: null })
  }
  if (ready && !p.u) {
    if (!gl.getProgramParameter(p.prog, gl.LINK_STATUS)) throw Error('gl-waveform: ' + p.shaders.map(s => gl.getShaderInfoLog(s)).join('') + gl.getProgramInfoLog(p.prog))
    p.u = {}
    for (let name of UNIFORMS) p.u[name] = gl.getUniformLocation(p.prog, name)
  }
  return p
}

// CSS color → [r, g, b, a] 0..1 in the context's color space; arrays pass through
const ctx2d = {}
function rgba(c, gl) {
  if (typeof c !== 'string') return nums([c[0], c[1], c[2], c[3] ?? 1], 4, 'color').map(v => Math.min(Math.max(v, 0), 1))
  let space = gl.drawingBufferColorSpace || 'srgb'
  let ctx = ctx2d[space] ??= (globalThis.OffscreenCanvas ? new OffscreenCanvas(1, 1) : document.createElement('canvas')).getContext('2d', { colorSpace: space, willReadFrequently: true })
  ctx.fillStyle = '#000'; ctx.fillStyle = c
  if (ctx.fillStyle === '#000000') { ctx.fillStyle = '#fff'; ctx.fillStyle = c; if (ctx.fillStyle === '#ffffff') throw TypeError(`gl-waveform: invalid color ${c}`) }
  ctx.clearRect(0, 0, 1, 1)
  ctx.fillRect(0, 0, 1, 1)
  let d = ctx.getImageData(0, 0, 1, 1).data
  return [d[0] / 255, d[1] / 255, d[2] / 255, d[3] / 255]
}
