// Draws spectrogram frames (bytes, -100..0 dB, rows evenly spaced on the view's frequency scale) as a picture: time
// across, frequency up. Grey, its lightness even in dB: from the background's at the floor of the frames' range to white
// at their loudest (OKLab L, so equal steps look equal). One lane per channel.
// Each channel has two frame sets: the whole output (its loudest sets what is white, for good), and a sharper one for a
// sample range and part of the frequency axis. Where the view reaches past the sharp one, the whole shows, so panning
// and zooming draw at once while sharper frames are computed.
const vertex = `#version 300 es
in vec2 corner;
out vec2 uv;
void main() { uv = corner; gl_Position = vec4(corner * 2. - 1., 0, 1); }`

const fragment = `#version 300 es
precision highp float;
in vec2 uv;
uniform sampler2D frames, whole;
uniform vec2 span, wspan;  // the view's left and right edges in the sharp frames' texture coordinate, in the whole's
uniform vec2 band, wband;  // the view's bottom and top frequencies in their rows, 0..1
uniform vec2 range;     // the levels drawn from the background to white, 0..1 of -100..0 dB
uniform float ground;   // the background's lightness, OKLab L
out vec4 color;
float srgb(float y) { return y <= .0031308 ? 12.92 * y : 1.055 * pow(y, 1. / 2.4) - .055; }
void main() {
  // rows run evenly up the frequency axis (scale.js)
  float u = mix(span.x, span.y, uv.x), v = mix(band.x, band.y, uv.y), level;
  if (u >= 0. && u <= 1. && v >= 0. && v <= 1.) level = texture(frames, vec2(v, u)).r;
  else {
    u = mix(wspan.x, wspan.y, uv.x); v = mix(wband.x, wband.y, uv.y);
    if (u < 0. || u > 1. || v < 0. || v > 1.) { color = vec4(0); return; }
    level = texture(whole, vec2(v, u)).r;
  }
  // OKLab L of a grey is the cube root of its linear light; the coverage that brings the background there
  float t = clamp((level - range.x) / (range.y - range.x), 0., 1.), L = mix(ground, 1., t), b = srgb(ground * ground * ground);
  float a = (srgb(L * L * L) - b) / (1. - b);
  color = vec4(a);
}`

export default function spectrogram(canvas, { ground = .21, depth = .8 } = {}) {
  const gl = canvas.getContext('webgl2', { premultipliedAlpha: true, antialias: false })
  if (!gl) return null
  const compile = (type, source) => {
    const shader = gl.createShader(type)
    gl.shaderSource(shader, source)
    gl.compileShader(shader)
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader))
    return shader
  }
  const program = gl.createProgram()
  gl.attachShader(program, compile(gl.VERTEX_SHADER, vertex))
  gl.attachShader(program, compile(gl.FRAGMENT_SHADER, fragment))
  gl.linkProgram(program)
  const u = name => gl.getUniformLocation(program, name)
  const uniforms = Object.fromEntries(['span', 'wspan', 'band', 'wband', 'range', 'ground', 'frames', 'whole'].map(name => [name, u(name)]))
  const quad = gl.createBuffer()
  gl.bindBuffer(gl.ARRAY_BUFFER, quad)
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW)
  const corner = gl.getAttribLocation(program, 'corner')
  gl.enableVertexAttribArray(corner)
  gl.vertexAttribPointer(corner, 2, gl.FLOAT, false, 0, 0)
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1)

  let lanes = []   // per channel: { sharp, whole }, each { texture, from, to, rows: [bottom, top] of the frequency axis }
  let top = 1      // the whole output's loudest level, 0..1: white; `depth` below it (80 dB) meets the background

  return {
    canvas, gl,
    // Frames of every channel for the sample range [from, to), their rows spanning `band` of the frequency axis: the
    // whole output's (`whole`, whose loudest byte, never below -60 dB, is white), or sharper ones for part of it.
    set({ channels, columns, rows, peak = 255 }, from, to, band = [0, 1], whole = false) {
      if (whole) top = Math.max(.4, peak / 255)
      const kind = whole ? 'whole' : 'sharp'
      channels.forEach((bytes, i) => {
        const lane = (lanes[i] ||= {})[kind] ||= { texture: gl.createTexture() }
        gl.bindTexture(gl.TEXTURE_2D, lane.texture)
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, rows, columns, 0, gl.RED, gl.UNSIGNED_BYTE, bytes)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
        Object.assign(lane, { from, to, rows: band })
      })
      for (const lane of lanes.splice(channels.length)) for (const k of ['whole', 'sharp']) if (lane[k]) gl.deleteTexture(lane[k].texture)
    },
    clear() { for (const lane of lanes) for (const k of ['whole', 'sharp']) if (lane[k]) gl.deleteTexture(lane[k].texture); lanes = [] },
    // Draws the view's sample range [from, to) and frequencies `band` into each channel's rectangle [x, y, width,
    // height] in device pixels; or, given `spans` ([{ x0, x1, from, to }], device pixels across the rectangle and the
    // samples each shows), each span of samples where it goes: the picture an edit will leave, before it is made.
    render(rects, from, to, band = [0, 1], spans = null) {
      gl.viewport(0, 0, canvas.width, canvas.height)
      gl.clearColor(0, 0, 0, 0)
      gl.clear(gl.COLOR_BUFFER_BIT)
      gl.useProgram(program)
      gl.enable(gl.BLEND)
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA)
      gl.uniform2f(uniforms.range, top - depth, top)
      gl.uniform1f(uniforms.ground, ground)
      gl.uniform1i(uniforms.frames, 0)
      gl.uniform1i(uniforms.whole, 1)
      // a span in a frame set's coordinates: its time, its frequency band
      const place = (f, name, a, b) => {
        const size = f.to - f.from || 1, [r0, r1] = f.rows, rows = r1 - r0 || 1
        gl.uniform2f(uniforms[name === 'sharp' ? 'span' : 'wspan'], (a - f.from) / size, (b - f.from) / size)
        gl.uniform2f(uniforms[name === 'sharp' ? 'band' : 'wband'], (band[0] - r0) / rows, (band[1] - r0) / rows)
      }
      lanes.forEach((lane, i) => {
        const rect = rects[i]
        if (!rect || !lane.whole && !lane.sharp) return
        const [x, y, w, h] = rect
        for (const s of spans || [{ x0: 0, x1: w, from, to }]) {
          const x0 = Math.round(s.x0), x1 = Math.round(s.x1)
          if (x1 <= x0) continue
          gl.viewport(x + x0, canvas.height - y - h, x1 - x0, h)
          gl.activeTexture(gl.TEXTURE1)
          gl.bindTexture(gl.TEXTURE_2D, (lane.whole || lane.sharp).texture)
          place(lane.whole || lane.sharp, 'whole', s.from, s.to)
          gl.activeTexture(gl.TEXTURE0)
          gl.bindTexture(gl.TEXTURE_2D, (lane.sharp || lane.whole).texture)
          place(lane.sharp || lane.whole, 'sharp', s.from, s.to)
          gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
        }
      })
    },
    destroy() { this.clear(); gl.deleteProgram(program); gl.deleteBuffer(quad) }
  }
}
