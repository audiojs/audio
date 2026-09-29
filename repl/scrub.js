// The scrub voice, an AudioWorklet: while a caret is held or dragged it plays the sound under it at the sound's own
// pitch. A phase vocoder whose tonal peaks carry their phase on and whose other bins take a new random phase each hop:
// "vocoder + noise", of eight ways compared in the lab's "Hearing a moment" (audiojs.github.io/lab/scrub) the closest to
// the sound around the caret (2.8 dB, exact on sines), for about 1% of a core. A still caret sustains the moment; a
// moving one plays the sound at the caret's speed. A band [low, high] in Hz keeps only its bins. It fades in and out
// over 10 ms. Nothing allocates while it plays.
// Every channel sounds, as one image: tones and noise are told apart on all channels together, and each bin of every
// channel turns by the same rotation, so the phase between channels, the stereo picture, stays as it was. The sound
// comes at its own rate; the voice runs at that rate and is read at the context's, between its samples.
// Messages in: { x, rate } the sound's channels and rate; { caret } in samples of it; { band }; { on }.
const TAU = 2 * Math.PI, N = 2048, HOP = N / 4, H = N / 2 + 1
const clamp = (v, lo, hi) => v < lo ? lo : v > hi ? hi : v
// a random 32-bit integer after s (xorshift32, Marsaglia 2003); s is any nonzero integer
const xorshift = s => { s ^= s << 13; s ^= s >>> 17; return s ^ s << 5 }
// Unit phasors at 4,096 even steps round the circle, for random phases without trigonometry
const TURNS = Float64Array.from({ length: 8192 }, (_, i) => i & 1 ? Math.sin(TAU * (i >> 1) / 4096) : Math.cos(TAU * (i >> 1) / 4096))
// Peaks standing 12 dB over their higher valley are tones; the rest of the spectrum is noise
const TONAL = 10 ** (12 / 20)
// The periodic Hann window, which overlap-adds to a constant
const HANN = Float64Array.from({ length: N }, (_, i) => .5 - .5 * Math.cos(TAU * i / N))

// In-place radix-2 FFT of n = N points
const REV = new Uint32Array(N), COS = new Float64Array(N / 2), SIN = new Float64Array(N / 2)
for (let i = 0, bits = Math.log2(N); i < N; i++) { let r = 0; for (let b = 0; b < bits; b++) r |= (i >> b & 1) << bits - 1 - b; REV[i] = r }
for (let i = 0; i < N / 2; i++) { COS[i] = Math.cos(TAU * i / N); SIN[i] = -Math.sin(TAU * i / N) }
function fft(re, im) {
  for (let i = 0; i < N; i++) { const j = REV[i]; if (j > i) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t } }
  for (let size = 2; size <= N; size *= 2) {
    const half = size / 2, step = N / size
    for (let i = 0; i < N; i += size) for (let j = 0; j < half; j++) {
      const k = j * step, a = i + j, b = a + half, tr = re[b] * COS[k] - im[b] * SIN[k], ti = re[b] * SIN[k] + im[b] * COS[k]
      re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti
    }
  }
}

// The Hann-tapered spectra of the frames centred on p and on p − HOP, packed into one complex FFT, re + i·im
function analyse(x, p, re, im) {
  const first = p - N / 2
  for (let j = 0; j < N; j++) {
    const a = first + j, b = a - HOP
    re[j] = a >= 0 && a < x.length ? x[a] * HANN[j] : 0
    im[j] = b >= 0 && b < x.length ? x[b] * HANN[j] : 0
  }
  fft(re, im)
}
// Z = A + iB for real frames a, b: A[k] = (Z[k] + conj Z[n − k]) / 2, B[k] = (Z[k] − conj Z[n − k]) / 2i
function unpack(re, im, ar, ai, br, bi) {
  for (let k = 0; k < H; k++) {
    const m = k ? N - k : 0, zr = re[k], zi = im[k], wr = re[m], wi = im[m]
    ar[k] = (zr + wr) / 2; ai[k] = (zi - wi) / 2
    br[k] = (zi + wi) / 2; bi[k] = (wr - zr) / 2
  }
}
// Spectral peaks: bins louder than the two bins either side. Each owns the bins down to the quietest point toward its
// neighbours, its region of influence (Laroche & Dolson 1999): owner[k] indexes bin k's peak in `peaks`. lows[i] is
// the higher of peak i's two valleys, so mag[peak] / lows[i] is how far it stands out. Returns the count of peaks.
function regions(mag, peaks, owner, lows) {
  let count = 0
  for (let k = 2; k < H - 2; k++) {
    const m = mag[k]
    if (m > 0 && m > mag[k - 1] && m > mag[k - 2] && m >= mag[k + 1] && m >= mag[k + 2]) peaks[count++] = k
  }
  if (!count) { owner.fill(-1); return 0 }
  let from = 0, left = Infinity
  for (let k = 0; k < peaks[0]; k++) if (mag[k] < left) left = mag[k]
  for (let i = 0; i < count; i++) {
    const k = peaks[i], last = i + 1 === count, end = last ? H : peaks[i + 1]
    let valley = k, low = Infinity
    for (let j = k + 1; j < end; j++) if (mag[j] < low) { low = mag[j]; valley = j }
    if (last) valley = H - 1
    owner.fill(i, from, valley + 1)
    lows[i] = Math.max(left === Infinity ? 0 : left, low === Infinity ? 0 : low)
    left = low
    from = valley + 1
  }
  return count
}
// A peak's frequency (in bins) and magnitude from the parabola through the log magnitudes of it and its neighbours
// (Smith & Serra 1987), into out[0], out[1]
function vertex(mag, k, out) {
  const a = Math.log(mag[k - 1] || 1e-30), b = Math.log(mag[k]), c = Math.log(mag[k + 1] || 1e-30), d = Math.min(a - 2 * b + c, -1e-9)
  const δ = clamp(.5 * (a - c) / d, -.5, .5)
  out[0] = k + δ
  out[1] = Math.exp(b - .25 * (a - c) * δ)
}
// A steady sine's Hann spectrum d bins from its centre, relative to the centre: sinc(d) / (1 − d²)
function leak(d) {
  d = Math.abs(d)
  if (d < 1e-6) return 1
  if (Math.abs(d - 1) < 1e-6) return .5
  return Math.abs(Math.sin(Math.PI * d) / (Math.PI * d * (1 - d * d)))
}
// Marks the bins of peak i's region that its own leakage explains: its main lobe, 1.5 bins either side of its centre
// f, and any bin no louder than twice what a steady sine of magnitude m there leaks. The rest of the region is noise.
function explained(mag, owner, i, k, f, m, mark) {
  for (let j = k; j >= 0 && owner[j] === i; j--) if (Math.abs(j - f) <= 1.5 || mag[j] <= 2 * m * leak(j - f)) mark[j] = 1
  for (let j = k + 1; j < H && owner[j] === i; j++) if (Math.abs(j - f) <= 1.5 || mag[j] <= 2 * m * leak(j - f)) mark[j] = 1
}

// Every HOP samples the two frames a hop apart at the caret give a spectrum: each tonal peak's phase advances as much as
// it did from the earlier frame to the later, the bins its leakage explains keeping their offsets to it (identity phase
// locking, Laroche & Dolson 1999); a region turns by its peak's last synthesis phasor times the conjugate of its
// earlier analysis phasor, Y = A · Ŷ · conj B̂, with no trigonometry. Every other bin turns by a random phase, √4 as
// loud: random frames add in power, locked ones in amplitude. Then inverse FFT, Hann again, overlap-add: Hann² at a hop
// of N/4 sums to 3/2, hence the 1 / (3/8 · 4 · N).
// With several channels, the peaks, their regions and what is tonal come from their power together; a peak's rotation
// from the channel loudest at it; every channel's bin turns by the one rotation of its region, or the one random turn.
class Voice {
  constructor(x, caret) {
    this.x = x
    this.ch = x.map(() => {
      const c = {}
      for (const k of ['re', 'im', 'sum']) c[k] = new Float64Array(N)
      for (const k of ['ar', 'ai', 'br', 'bi', 'yr', 'yi']) c[k] = new Float64Array(H)
      return c
    })
    for (const k of ['rr', 'ri', 'mag', 'lows', 'tr', 'ti']) this[k] = new Float64Array(H)
    this.peaks = new Int32Array(H)
    this.owner = new Int32Array(H)
    this.tonal = new Uint8Array(H)
    this.v = new Float64Array(2)
    this.k = HOP
    this.s = 0x2f6b1d
    this.fresh = true
    this.lo = 0
    this.hi = H
    this.p = Math.round(caret)
  }
  // The next sample of every channel into out[c][i], the caret at `caret`
  step(out, i, caret) {
    if (this.k === HOP) {
      for (const c of this.ch) { c.sum.copyWithin(0, HOP); c.sum.fill(0, N - HOP) }
      this.p = clamp(Math.round(caret), 0, this.x[0].length - 1)
      this.shape(this.p)
      for (const c of this.ch) this.inverse(c)
      this.k = 0
    }
    for (let c = 0; c < this.ch.length; c++) out[c][i] = this.ch[c].sum[this.k]
    this.k++
  }
  shape(p) {
    const { x, ch, rr, ri, mag, peaks, owner, lows, tonal, v, lo, hi, tr, ti } = this
    mag.fill(0)
    for (let c = 0; c < ch.length; c++) {
      const { re, im, ar, ai, br, bi } = ch[c]
      analyse(x[c], p, re, im)
      unpack(re, im, ar, ai, br, bi)
      for (let k = 0; k < H; k++) mag[k] += ar[k] * ar[k] + ai[k] * ai[k]
    }
    for (let k = 0; k < H; k++) mag[k] = Math.sqrt(mag[k] / ch.length)
    const count = regions(mag, peaks, owner, lows)
    for (let i = 0; i < count; i++) {
      const k = peaks[i]
      let r = ch[0], most = -1
      for (const c of ch) { const m = c.ar[k] * c.ar[k] + c.ai[k] * c.ai[k]; if (m > most) { most = m; r = c } }
      const { yr, yi, br, bi } = r, d = Math.sqrt((yr[k] * yr[k] + yi[k] * yi[k]) * (br[k] * br[k] + bi[k] * bi[k]))
      if (this.fresh || !d) { rr[i] = 1; ri[i] = 0; continue }
      // the rotation from the earlier analysis to the later synthesis, as a unit phasor; applied to the later analysis
      rr[i] = (yr[k] * br[k] + yi[k] * bi[k]) / d
      ri[i] = (yi[k] * br[k] - yr[k] * bi[k]) / d
    }
    tonal.fill(0)
    for (let i = 0; i < count; i++) if (mag[peaks[i]] >= TONAL * lows[i]) { vertex(mag, peaks[i], v); explained(mag, owner, i, peaks[i], v[0], v[1], tonal) }
    // each bin's turn: its region's rotation where tonal, else a random one, twice as loud (in amplitude, √4 in power)
    for (let k = 0; k < H; k++) {
      const o = owner[k]
      if (o >= 0 && tonal[k]) { tr[k] = rr[o]; ti[k] = ri[o] }
      else { const t = ((this.s = xorshift(this.s)) >>> 20) << 1; tr[k] = 2 * TURNS[t]; ti[k] = 2 * TURNS[t + 1] }
    }
    this.fresh = false
    for (const { re, im, ar, ai, yr, yi } of ch) {
      for (let k = 0; k < H; k++) { yr[k] = tr[k] * ar[k] - ti[k] * ai[k]; yi[k] = tr[k] * ai[k] + ti[k] * ar[k] }
      // the band: its bins sound, the rest are silent; DC and Nyquist are real and stay as analysed
      for (let k = 0; k < H; k++) { const on = k >= lo && k <= hi; re[k] = on ? yr[k] : 0; im[k] = on ? yi[k] : 0 }
      re[0] = lo <= 0 ? ar[0] : 0
      re[N / 2] = hi >= N / 2 ? ar[N / 2] : 0
    }
  }
  // a channel's bins 0…N/2 of re/im to a real frame: mirror, conjugate, forward FFT, real part / N
  inverse({ re, im, sum }) {
    const g = 1 / (.375 * 4 * N)
    for (let k = 1; k < N / 2; k++) { re[N - k] = re[k]; im[N - k] = im[k]; im[k] = -im[k] }
    im[0] = im[N / 2] = 0
    fft(re, im)
    for (let j = 0; j < N; j++) sum[j] += HANN[j] * re[j] * g
  }
}

class Scrub extends AudioWorkletProcessor {
  constructor() {
    super()
    this.x = null
    this.rate = sampleRate
    this.caret = 0
    this.band = null
    this.on = false
    this.voice = null
    this.gain = 0
    // the voice's last two samples of each channel, and where the context's reading is between them
    this.prev = null
    this.next = null
    this.at = 1
    this.port.onmessage = ({ data }) => this.receive(data)
  }
  receive({ x, rate, caret, band, on }) {
    if (x) { this.x = x; this.rate = rate || sampleRate; this.voice = null; this.gain = 0 }
    if (caret != null) this.caret = caret
    if (band !== undefined) this.band = band
    if (on != null) this.on = on
  }
  process(inputs, outputs) {
    const out = outputs[0]
    if (this.on && !this.voice && this.x) {
      this.voice = new Voice(this.x, this.caret)
      this.gain = 0
      this.prev = this.x.map(() => new Float64Array(1))
      this.next = this.x.map(() => new Float64Array(1))
      this.at = 1
    }
    const voice = this.voice
    if (!voice) return true
    const bin = this.rate / N, [low, high] = this.band || [0, Infinity]
    voice.lo = Math.max(0, Math.ceil(low / bin - .5))
    voice.hi = Math.min(N / 2, Math.floor(high / bin + .5))
    // the voice runs at the sound's rate; the context reads it at its own, between two samples, linearly
    const ratio = this.rate / sampleRate, fade = 1 / (.01 * sampleRate), target = this.on ? 1 : 0, C = voice.ch.length
    let g = this.gain
    for (let i = 0; i < out[0].length; i++) {
      while (this.at >= 1) {
        for (let c = 0; c < C; c++) this.prev[c][0] = this.next[c][0]
        voice.step(this.next, 0, this.caret)
        this.at -= 1
      }
      g = target ? Math.min(1, g + fade) : Math.max(0, g - fade)
      for (let o = 0; o < out.length; o++) {
        const c = Math.min(o, C - 1), a = this.prev[c][0], b = this.next[c][0]
        out[o][i] = (a + (b - a) * this.at) * g
      }
      this.at += ratio
    }
    this.gain = g
    if (!g && !this.on) this.voice = null
    return true
  }
}
registerProcessor('scrub', Scrub)
