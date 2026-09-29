// The scrub voice, an AudioWorklet: while a caret is held or dragged it plays the sound under it at the sound's own
// pitch. A phase vocoder whose tonal peaks carry their phase on and whose other bins take a new random phase each hop:
// "vocoder + noise", of eight ways compared in the lab's "Hearing a moment" (audiojs.github.io/lab/scrub) the closest to
// the sound around the caret (2.8 dB, exact on sines), for about 1% of a core. A still caret sustains the moment; a
// moving one plays the sound at the caret's speed. A band [low, high] in Hz keeps only its bins. It fades in and out
// over 10 ms. Nothing allocates while it plays.
// Every channel sounds, as one image: tones and noise are told apart on all channels together, and each bin of every
// channel turns by the same rotation, so the phase between channels, the stereo picture, stays as it was. The sound
// comes at its own rate; the voice runs at that rate and is read at the context's, between its samples.
// An onset is an event, not a moment: its attack plays once, as recorded, when the caret passes it or lands on it,
// and the frames hear the sound without it (as Nagel & Walther 2009 take transients out before a stretch and put them
// back after). Random phases spread an attack over every frame it falls in, and a slow caret keeps it in many: a click
// dragged over at half speed sounded 40 dB over the silence in the 20 ms before it, and 11 dB less sharp. A caret held
// on an attack plays it once, then holds the sound around it; steady tones through an attack keep their phase, and
// their level within half a dB.
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
// Onsets: every channel's first difference (a rise of 6 dB an octave, so steady low tones weigh little: the
// high-frequency content of Masri 1996, in time), its energy in blocks of N/32 on the sound's own grid. A block 12 dB
// louder than the loudest of the hop before it, and over −70 dB, holds an onset (a rise in energy, the plainest of the
// detection functions Bello et al. 2005 review), at the first sample, of it or the block before, a sixteenth as loud as
// its loudest. SPAN bounds what one hop looks through.
const BLOCK = N / 32, BACK = HOP / BLOCK, RISE = 10 ** (12 / 10), FLOOR = 1e-7, SPAN = 4 * N
// An attack: the half frame from a block before its onset, rising over that block and falling over its last N/8, and
// ended where the next attack begins, their fades complementary. It is a frame long, N/8 in: room for the ringing of the
// bins it leaves out, which fades out to the frame's ends (TAPER). It adds into the voice's output as a frame does.
const LEAD = BLOCK, ATTACK = N / 2, FALL = N / 8, ROOM = N / 8
// a raised cosine's jth of n steps up from 0 to 1
const up = (j, n) => .5 - .5 * Math.cos(Math.PI * (j + .5) / n)
const SHAPE = Float64Array.from({ length: ATTACK }, (_, j) => j < LEAD ? up(j, LEAD) : j < ATTACK - FALL ? 1 : 1 - up(j - ATTACK + FALL, FALL))
const TAPER = Float64Array.from({ length: N }, (_, j) => j < ROOM ? up(j, ROOM) : j < ROOM + ATTACK ? 1 : 1 - up(j - ROOM - ATTACK, N - ROOM - ATTACK))
// The share of sample t that belongs to the attack at onset o, the next onset at `next`
function share(o, next, t) {
  const j = t - o + LEAD, k = t - next + LEAD
  if (j < 0 || j >= ATTACK) return 0
  return k < 0 ? SHAPE[j] : k < LEAD ? SHAPE[j] * (1 - SHAPE[k]) : 0
}
// every channel's first difference at sample i, squared
function rise(x, i) { let p = 0; for (let c = 0; c < x.length; c++) { const d = x[c][i] - x[c][i - 1]; p += d * d } return p }

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
// The attacks within a frame, taken as the frame hears them, S, come out of its noise: a noise bin turns (A − S) · fill,
// the fill holding what they covered (gaps). A peak is a steady tone, and keeps all of A, only if the attacks do not
// make it (as Röbel 2003 tells a transient's peaks from a steady sinusoid's, per peak): the frame without them keeps
// at least half of what a tone going on through them would, 1 − φ of it, φ the share of the window they take; an
// attack's own peaks keep next to nothing.
class Voice {
  constructor(x, caret) {
    this.x = x
    // each channel's output ahead, two frames of it: the frames overlap-add into the first, an attack reaches further
    this.ch = x.map(() => {
      const c = {}
      for (const k of ['re', 'im']) c[k] = new Float64Array(N)
      c.sum = new Float64Array(2 * N)
      for (const k of ['ar', 'ai', 'br', 'bi', 'yr', 'yi', 'sr', 'si']) c[k] = new Float64Array(H)
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
    this.wr = new Float64Array(N)
    this.wi = new Float64Array(N)
    this.energy = new Float64Array(SPAN / BLOCK + BACK)
    this.found = new Int32Array(SPAN / BLOCK)
    this.bare = new Float64Array(N)
    this.φ = 0
    this.fill = 1
  }
  // The onsets in [lo, hi) into this.found, in order; returns their count
  onsets(lo, hi) {
    const { x, energy, found } = this, n = x[0].length
    const b0 = Math.max(1, Math.floor(Math.max(0, lo) / BLOCK)), b1 = Math.min(Math.ceil(Math.min(n, hi) / BLOCK), b0 + SPAN / BLOCK)
    const first = Math.max(0, b0 - BACK)
    energy.fill(0, 0, b1 - first)
    for (let c = 0; c < x.length; c++) {
      const y = x[c]
      for (let b = first; b < b1; b++) {
        let e = 0
        for (let i = Math.max(1, b * BLOCK), end = Math.min(n, (b + 1) * BLOCK); i < end; i++) { const d = y[i] - y[i - 1]; e += d * d }
        energy[b - first] += e
      }
    }
    let count = 0
    for (let b = b0; b < b1; b++) {
      const e = energy[b - first]
      if (e < FLOOR * BLOCK * x.length) continue
      let before = 0
      for (let j = Math.max(first, b - BACK); j < b; j++) if (energy[j - first] > before) before = energy[j - first]
      if (e < RISE * before) continue
      let top = 0, at = b * BLOCK
      for (let i = b * BLOCK, end = Math.min(n, i + BLOCK); i < end; i++) top = Math.max(top, rise(x, i))
      for (let i = Math.max(1, (b - 1) * BLOCK), end = Math.min(n, (b + 1) * BLOCK); i < end; i++) if (rise(x, i) >= top / 16) { at = i; break }
      found[count++] = at
    }
    return count
  }
  // The next sample of every channel into out[c][i], the caret at `caret`
  step(out, i, caret) {
    if (this.k === HOP) {
      for (const c of this.ch) { c.sum.copyWithin(0, HOP); c.sum.fill(0, 2 * N - HOP) }
      const last = this.p, p = this.p = clamp(Math.round(caret), 0, this.x[0].length - 1), fresh = this.fresh
      const was = clamp(last, p - N, p + N), count = this.onsets(Math.min(was, p) - N / 2 - ATTACK, Math.max(was, p) + N / 2 + ATTACK)
      this.shape(p, count)
      for (const c of this.ch) this.inverse(c)
      // the attacks the caret passed since the last hop, each when the caret's frame would have sounded it, the caret
      // taken to move evenly over the hop; a new voice's, those within a quarter frame of where it lands
      for (let j = 0; j < count; j++) {
        const o = this.found[j], next = j + 1 < count ? this.found[j + 1] : Infinity
        if (fresh) { if (Math.abs(o - p) <= N / 4) this.attack(o, next, N / 2 + o - p) }
        else if ((last < o) !== (p < o) && Math.abs(o - p) <= N) this.attack(o, next, Math.round(N / 2 - (p - o) / (p - last) * HOP))
      }
      this.k = 0
    }
    for (let c = 0; c < this.ch.length; c++) out[c][i] = this.ch[c].sum[this.k]
    this.k++
  }
  // The attack at onset o into the output, its onset to sound `at` samples from now: the sound in its window, less the
  // bins of steady tones and those outside the band, two channels to a transform and back
  attack(o, next, at) {
    const { x, ch, tonal, lo, hi, wr, wi } = this, n = x[0].length, from = at - ROOM - LEAD
    for (let c = 0; c < ch.length; c += 2) {
      const l = x[c], r = x[c + 1]
      wr.fill(0)
      wi.fill(0)
      for (let t = Math.max(0, o - LEAD), end = Math.min(n, o - LEAD + ATTACK); t < end; t++) {
        const w = share(o, next, t), j = ROOM + t - o + LEAD
        wr[j] = l[t] * w
        if (r) wi[j] = r[t] * w
      }
      fft(wr, wi)
      for (let k = 0; k <= N / 2; k++) if (tonal[k] || k < lo || k > hi) { wr[k] = wi[k] = 0; if (k % (N / 2)) wr[N - k] = wi[N - k] = 0 }
      // back: the transform of the conjugate, conjugated, over N; the two channels are its real and imaginary parts
      for (let j = 0; j < N; j++) wi[j] = -wi[j]
      fft(wr, wi)
      const u = ch[c].sum, v = ch[c + 1]?.sum
      for (let j = 0; j < N; j++) { u[from + j] += wr[j] * TAPER[j] / N; if (v) v[from + j] -= wi[j] * TAPER[j] / N }
    }
  }
  // The attacks within the frame at p, as the frame hears them: each channel's spectrum into sr/si, two channels to a
  // transform. φ is the share of the window they take. The steady sound under them goes with them, so the frame's
  // noise comes `fill` times louder: enough to hold it too, taken at the lower of the levels just before and just after
  // each attack (the gap filled from its edges, as Nagel & Walther 2009 fill theirs), and never more than a steady
  // sound would need, 1/√κ, κ the share of its energy the frame keeps.
  gaps(p, count) {
    const { x, ch, wr, wi, found, bare } = this, first = p - N / 2, n = x[0].length
    if (!count) { for (const c of ch) { c.sr.fill(0); c.si.fill(0) } this.φ = 0; this.fill = 1; return }
    let covered = 0
    bare.fill(1)
    for (let q = 0; q < count; q++) {
      const o = found[q], next = q + 1 < count ? found[q + 1] : Infinity
      let before = 0, after = 0
      for (let t = Math.max(0, o - LEAD - FALL); t < o - LEAD; t++) for (let c = 0; c < x.length; c++) before += x[c][t] ** 2
      for (let t = o - LEAD + ATTACK, end = Math.min(n, t + FALL); t < end; t++) for (let c = 0; c < x.length; c++) after += x[c][t] ** 2
      const level = Math.min(before, after) / FALL
      for (let t = Math.max(0, first, o - LEAD), end = Math.min(n, first + N, o - LEAD + ATTACK); t < end; t++) {
        const f = t - first, w = share(o, next, t)
        bare[f] -= w
        covered += (w * HANN[f]) ** 2 * level
      }
    }
    let taken = 0, steady = 0, kept = 0
    for (let f = 0; f < N; f++) { taken += (1 - bare[f]) * HANN[f]; steady += (bare[f] * HANN[f]) ** 2 }
    for (let c = 0; c < ch.length; c += 2) {
      const a = ch[c], b = ch[c + 1], l = x[c], r = x[c + 1]
      for (let f = 0; f < N; f++) {
        const t = first + f, u = t >= 0 && t < n ? l[t] * HANN[f] : 0, v = r && t >= 0 && t < n ? r[t] * HANN[f] : 0
        wr[f] = u * (1 - bare[f]); wi[f] = v * (1 - bare[f])
        kept += (u * bare[f]) ** 2 + (v * bare[f]) ** 2
      }
      fft(wr, wi)
      if (b) unpack(wr, wi, a.sr, a.si, b.sr, b.si)
      else for (let k = 0; k < H; k++) { a.sr[k] = wr[k]; a.si[k] = wi[k] }
    }
    const κ = steady / (.375 * N)
    this.φ = Math.min(1, taken / (N / 2))
    this.fill = kept > 0 && κ > 0 ? Math.min(Math.sqrt(1 + covered / kept), 1 / Math.sqrt(κ)) : 1
  }
  // Whether the peak at bin k is a steady tone, not one the attacks make
  steady(k) {
    if (!this.φ) return true
    let all = 0, kept = 0
    for (let c = 0; c < this.ch.length; c++) {
      const { ar, ai, sr, si } = this.ch[c]
      all += ar[k] * ar[k] + ai[k] * ai[k]
      kept += (ar[k] - sr[k]) ** 2 + (ai[k] - si[k]) ** 2
    }
    return 4 * kept >= (1 - this.φ) ** 2 * all
  }
  // The frame at p, the `onsets` found in reach, into each channel's re/im
  shape(p, onsets) {
    const { x, ch, rr, ri, mag, peaks, owner, lows, tonal, v, lo, hi, tr, ti } = this
    mag.fill(0)
    for (let c = 0; c < ch.length; c++) {
      const { re, im, ar, ai, br, bi } = ch[c]
      analyse(x[c], p, re, im)
      unpack(re, im, ar, ai, br, bi)
      for (let k = 0; k < H; k++) mag[k] += ar[k] * ar[k] + ai[k] * ai[k]
    }
    this.gaps(p, onsets)
    const fill = this.fill
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
    for (let i = 0; i < count; i++) {
      if (mag[peaks[i]] < TONAL * lows[i] || !this.steady(peaks[i])) continue
      vertex(mag, peaks[i], v)
      explained(mag, owner, i, peaks[i], v[0], v[1], tonal)
    }
    // each bin's turn: its region's rotation where tonal, else a random one, twice as loud (in amplitude, √4 in power)
    for (let k = 0; k < H; k++) {
      const o = owner[k]
      if (o >= 0 && tonal[k]) { tr[k] = rr[o]; ti[k] = ri[o] }
      else { const t = ((this.s = xorshift(this.s)) >>> 20) << 1; tr[k] = 2 * TURNS[t]; ti[k] = 2 * TURNS[t + 1] }
    }
    this.fresh = false
    for (const { re, im, ar, ai, sr, si, yr, yi } of ch) {
      // a tone's bin turns all of A, a noise bin A − S, filled
      for (let k = 0; k < H; k++) {
        const a = tonal[k] ? ar[k] : (ar[k] - sr[k]) * fill, b = tonal[k] ? ai[k] : (ai[k] - si[k]) * fill
        yr[k] = tr[k] * a - ti[k] * b; yi[k] = tr[k] * b + ti[k] * a
      }
      // the band: its bins sound, the rest are silent; DC and Nyquist are real and stay as analysed, less the attacks
      for (let k = 0; k < H; k++) { const on = k >= lo && k <= hi; re[k] = on ? yr[k] : 0; im[k] = on ? yi[k] : 0 }
      re[0] = lo <= 0 ? (ar[0] - sr[0]) * fill : 0
      re[N / 2] = hi >= N / 2 ? (ar[N / 2] - sr[N / 2]) * fill : 0
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
