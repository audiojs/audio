/**
 * Deck — the output: plays what a voice renders, at the speakers' rate. One AudioWorklet per playback on the
 * page's one AudioContext (Node: a pump into @audio/speaker). Engine-free: the worker facade uses it as is.
 *
 *   voice (engine: main thread or worker) ──port──▶ deck (audio thread) ──▶ speakers
 *                                          ◀─reports─         ──reports──▶ transport (main thread)
 *
 * A voice sends runs: its timeline as planar blocks at its own rate, placed on an axis in seconds (a loop's passes
 * follow one another on it). A run can replace what plays, crossfaded, where the playing run reaches a point (an
 * edit, a hand-off) or at once (a seek). The deck reads with a varispeed head (playbackRate, and the source rate to
 * the device rate through a windowed sinc; unit rate copies), ramps start, pause, stop and underrun, and reports
 * where its head is. A voice renders seconds ahead, so a busy thread does not starve the output; an edit replaces
 * that buffered future at once. The transport maps the reports to what the speakers play now (their latency
 * compensated): currentTime, and meters released when heard.
 */

// The deck core: plain JS, no imports, no outer names and no named inner functions (a bundler would rename or wrap
// those), since its source text is also the AudioWorklet processor's. The interpolation kernel: a windowed sinc of
// 16 zero crossings each side, tabulated at 256 points per crossing.
export class Deck {
  constructor(sampleRate, channels, report, init = {}) {
    this.sr = sampleRate
    this.ch = channels
    this.report = report
    this.runs = new Map()
    this.cur = null                 // the run playing, and its head: frames on its axis
    this.x = 0
    this.grain = null               // the grains it sounds through while its pitch is kept at another rate
    this.next = null                // a run waiting to splice in: { run, at, pos, fade, power }
    this.xf = null                  // a crossfade under way: { run, x, grain } going out, x0 where the new run came in, n frames
    this.playing = init.playing ?? true
    this.stopping = false
    this.done = false
    this.vol = this.volT = init.volume ?? 1
    this.rate = this.rateT = init.rate ?? 1
    this.keep = init.preservesPitch ?? true                      // the pitch kept at another rate, as a media element's
    this.env = 0                    // start, pause, stop and underrun envelope
    this.moving = false
    this.starved = false
    this.R = Math.max(1, Math.round(sampleRate / 200))          // ramps of 5 ms
    this.kRate = 1 - Math.exp(-1 / (0.05 * sampleRate))          // playbackRate glides over ~50 ms, tape-style
    this.kVol = 1 - Math.exp(-1 / (0.005 * sampleRate))          // volume over ~5 ms
    this.got = 0                    // seconds received, for the voice's pacing
    this.due = 0                    // frames to the next report
    this.K = null                   // interpolation kernel, tabulated on first need
    this.w = new Float64Array(128)
    this.a = new Float64Array(channels)
    this.b = new Float64Array(channels)
    this.c = new Float64Array(channels)   // a grain fading out
    this.sp = { H: 0, X: 0, W: 0 }
    this.A = 2
  }

  // From the voice: { run, sr, pos, loop?, splice? } opens a run at `pos` seconds on its axis (`loop` [s, e]: the
  // axis runs on past e as passes of [s, e)); `splice` { at, fade, power } replaces what plays: where the playing
  // run reaches `at` (null: at once) crossfade over `fade` seconds (equal power, else linear) into this run at
  // pos + (head − at). { run, data } appends planar frames, { run, end } closes it, { run, loop } remaps it.
  feed(m) {
    if (m.sr) this.open(m)
    let r = this.runs.get(m.run)
    if (!r) return
    if (m.data) this.push(r, m.data)
    if (m.loop !== undefined) r.loop = m.loop
    if (m.end) r.ended = true
  }

  // From the transport: { playing }, { volume }, { rate }, { preservesPitch }, { stop }
  set(m) {
    if (m.playing !== undefined) this.playing = !!m.playing
    if (m.volume !== undefined) this.volT = m.volume
    if (m.rate !== undefined) this.rateT = m.rate
    if (m.preservesPitch !== undefined) this.keep = !!m.preservesPitch
    if (m.stop) this.stopping = true
  }

  open(m) {
    let r = { id: m.run, sr: m.sr, t0: Math.round(m.pos * m.sr), n: 0, cap: 0, tape: null, map: null, loop: m.loop ?? null, ended: false, played: false }
    this.runs.set(r.id, r)
    let s = m.splice
    if (!s && !this.cur && !this.next) { this.cur = r; this.x = r.t0; return }
    if (this.next) this.runs.delete(this.next.run.id)   // a newer splice supersedes one still waiting
    this.next = { run: r, at: s?.at ?? null, pos: m.pos, fade: s?.fade ?? 0.01, power: !!s?.power }
  }

  push(r, d) {
    let len = d[0].length
    if (!r.tape) {
      r.cap = 1 << Math.max(14, 32 - Math.clz32(len))
      r.tape = d.map(() => new Float32Array(r.cap))
      // a mono run fills the first two outputs, as speakers up-mix it; others map one to one
      r.map = Int8Array.from({ length: this.ch }, (_, c) => c < d.length ? c : d.length === 1 && c < 2 ? 0 : -1)
    }
    if (r.n + len > r.cap) {
      let k = Math.max(0, Math.min(r.n, Math.floor(this.low(r)) - 64 - r.t0))
      if (k) { for (let t of r.tape) t.copyWithin(0, k, r.n); r.t0 += k; r.n -= k }
      if (r.n + len > r.cap) {
        r.cap = 1 << (32 - Math.clz32(r.n + len - 1))
        r.tape = r.tape.map(t => { let u = new Float32Array(r.cap); u.set(t.subarray(0, r.n)); return u })
      }
    }
    for (let c = 0; c < r.tape.length; c++) r.tape[c].set(d[c] || d[0], r.n)
    r.n += len
    this.got += len / r.sr
  }

  render(out, n, frame) {
    let N = out.length, A = this.a, B = this.b
    for (let i = 0; i < n; i++) {
      if (this.rate !== this.rateT) { this.rate += (this.rateT - this.rate) * this.kRate; if (Math.abs(this.rateT - this.rate) < 1e-4) this.rate = this.rateT }
      if (this.vol !== this.volT) { this.vol += (this.volT - this.vol) * this.kVol; if (Math.abs(this.volT - this.vol) < 1e-5) this.vol = this.volT }
      if (this.next && !this.xf) this.splice(frame + i)
      let r = this.cur
      if (r) this.starve(r)
      let want = this.playing && !this.stopping && !this.starved && !!r
      this.env = want ? Math.min(1, this.env + 1 / this.R) : Math.max(0, this.env - 1 / this.R)
      // the head holds while silent (paused, stopped, underrun, idle); a hold starting or ending is reported
      if ((this.env > 0) !== this.moving) { this.moving = this.env > 0; this.post(frame + i) }
      if (!this.moving) {
        for (let c = 0; c < N; c++) out[c][i] = 0
        if (this.stopping && !this.done) { this.done = true; this.report({ stopped: frame + i }) }
        continue
      }
      let step = this.rate * r.sr / this.sr, g = this.env * this.vol
      // a run's end fades over the last 5 ms, so a span cut mid-sound ends without a click
      if (r.ended && !this.next) { let left = (r.t0 + r.n - this.x) / step; if (left < this.R) g *= Math.max(0, left) / this.R }
      let G = this.pitch(r, frame + i)
      if (G) this.grains(r, this.x, G, A)
      else this.read(r, this.x, step, A)
      r.played = true
      let f = this.xf
      if (f) {
        // through grains, a crossfade lasts its time as heard; the head's, its frames on the axis
        let fs = this.rate * f.run.sr / this.sr, t = Math.min(1, f.m ? f.k / f.m : (this.x - f.x0) / f.n)
        let u = f.power ? Math.cos(t * Math.PI / 2) : 1 - t, v = f.power ? Math.sin(t * Math.PI / 2) : t
        if (f.grain) this.grains(f.run, f.x, f.grain, B)
        else this.read(f.run, f.x, fs, B)
        for (let c = 0; c < N; c++) out[c][i] = (B[c] * u + A[c] * v) * g
        f.x += fs; f.k++
      } else for (let c = 0; c < N; c++) out[c][i] = A[c] * g
      this.x += step
      if (f && (f.m ? f.k >= f.m : this.x - f.x0 >= f.n)) { this.runs.delete(f.run.id); this.xf = null; this.post(frame + i + 1) }
      if (r.ended && !this.next && this.x >= r.t0 + r.n) {
        this.env = 0; this.moving = false
        this.post(frame + i + 1)          // where it ended, held
        this.runs.delete(r.id); this.cur = this.grain = null
        this.report({ end: frame + i + 1 })
      }
    }
    if ((this.due -= n) <= 0) { this.due += 1024; this.post(frame + n) }
  }

  // Start a waiting run when the playing one reaches its point and it has audio there; late, it comes in aligned.
  // Through grains, the point is where they are heard, between their crossfades, and the new run goes on through the
  // same grains (an edit's two renders crossfade in phase); a seek starts its own
  splice(f) {
    let s = this.next, r = s.run, c = this.cur, G = this.grain, x, y = null
    if (s.at == null || !c) x = r.t0
    else {
      let sec = (G ? G.y : this.x) / c.sr
      if ((sec < s.at || G && G.t < G.X) && !(c.ended && this.x >= c.t0 + c.n) && this.moving) return
      let same = r.sr === c.sr && s.pos === s.at
      if (G) { x = same ? this.x : (s.pos + this.x / c.sr - s.at) * r.sr; y = Math.max(r.t0, same ? G.y : (s.pos + sec - s.at) * r.sr) }
      else x = same ? Math.max(r.t0, this.x) : Math.max(r.t0, (s.pos + Math.max(0, sec - s.at)) * r.sr)
    }
    if (!r.ended && r.t0 + r.n - Math.max(x, y ?? x) < this.need(r, this.rate)) return
    this.next = null
    let ng = y != null ? { ...G, y, z: y, zh: false, yh: false } : this.keep && this.rate !== 1 ? this.fresh(r, x) : null
    if (c && this.moving) this.xf = { run: c, x: this.x, x0: x, n: Math.max(1, s.fade * r.sr), power: s.power, grain: G, k: 0, m: G || ng ? Math.max(1, Math.round(s.fade * this.sr)) : 0 }
    else if (c) this.runs.delete(c.id)   // nothing sounding: cut
    this.cur = r; this.x = x; this.grain = ng; this.starved = false
    this.post(f)
  }

  // Underrun: fade out while the audio lasts, hold, and come back once there is 50 ms (at the start, enough to fade)
  starve(r) {
    if (r.ended) { this.starved = false; return }
    let have = r.t0 + r.n - this.x, need = this.need(r, Math.max(this.rate, this.rateT))
    if (!this.starved) { if (have < need) this.starved = true }
    else if (have >= (r.played ? Math.max(need, 0.05 * r.sr) : need)) this.starved = false
  }

  // Frames run r must have ahead of the head to sound on at rate p: the ramp's at its step and the kernel's reach;
  // through grains, as far as the next one's search and the grain itself reach
  need(r, p) {
    let u = r.sr / this.sr, step = p * u, n = this.R * step + 16 * Math.min(4, Math.max(1, step)) + 1
    if (this.grain || this.keep && p !== 1) { let o = this.span(p, this.sp); n += u * (p * o.H + (p + 1) * (o.H + o.X) / 2) + o.W * r.sr + 16 }
    return n
  }

  // Where run r is still to be read from: its head; through grains, theirs, and as far back as a grain's search reaches
  low(r) {
    let f = this.xf, mine = r === this.cur, h = mine ? this.x : f && r === f.run ? f.x : r.t0, G = mine ? this.grain : f && r === f.run ? f.grain : null
    return G ? Math.min(h - 0.1 * r.sr, G.y, G.z) : h
  }


  // ── The pitch kept: WSOLA ──────────────────────────────────────────────
  // At a rate other than 1 with the pitch kept, the head moves at the rate as ever (where the run is, its splices,
  // its end, what is reported), and what sounds is grains of the run at its own pitch, each placed about the head
  // (Waveform Similarity Overlap-Add: W. Verhelst & M. Roelands, "An overlap-add technique based on waveform
  // similarity (WSOLA) for high quality time-scale modification of speech", ICASSP 1993). A grain plays on until the
  // next one starts and crossfades into it; the next starts near where the head will be in its middle, at the place
  // whose next frames are most like what the grain playing would play on (its natural progression), so the two meet
  // in phase. The players of the web do the same: Chromium's media element (AudioRendererAlgorithm, WSOLA) and
  // Firefox's (SoundTouch's TDStretch).

  // The grains the run sounds through: from where the rate leaves 1 with the pitch kept, a grain from the head on,
  // crossfading from its varispeed (at a rate still all but 1, the same sound); back to the head where a grain would
  // start once the rate is 1 again, the head put where the grain is (the same sound, no seam); the pitch let go, a
  // crossfade into the head's varispeed between the grains' own
  pitch(r, f) {
    let G = this.grain
    if (!G) {
      if (!this.keep || this.rate === 1) return null
      // on the sample grid: at the run's own rate, a grain's frames are then the samples themselves
      let y = Math.round(this.x)
      return this.grain = this.span(this.rate, { y, z: y, yh: false, zh: true, t: 0, H: 0, X: 0, W: 0, rc: Math.abs(this.rate - 1) < 0.01 ? 1 : 0 })
    }
    if (G.yh) return G.t < G.X ? G : this.grain = null
    if (this.rate === 1 && G.t >= G.H && !this.xf) { this.x = G.y; this.grain = null; this.post(f); return null }
    if (!this.keep && this.rate !== 1 && G.t >= G.X) { if (this.x < r.t0) this.x = G.y; G.z = G.y; G.zh = false; G.yh = true; G.t = 0; G.H = Infinity; G.rc = 0 }
    return G
  }

  // Grains for run r from head x on, none fading out: a seek's, or a run's first
  fresh(r, x) {
    let G = this.span(this.rate, { y: 0, z: 0, yh: false, zh: false, t: 0, H: 0, X: 0, W: 0, rc: 1 }), u = r.sr / this.sr
    let c = x + (this.rate - 1) * u * (G.H + G.X) / 2
    G.y = G.z = Math.max(r.t0, Math.min(Math.round(c), r.t0 + r.n - (G.H + G.X) * u))
    G.t = G.X
    return G
  }

  // A grain's hop H and crossfade X (output frames), and how far W (seconds) either side of the head's place the next
  // may move, at rate p
  span(p, o) {
    o.H = Math.round(0.03 * this.sr); o.X = Math.round(0.01 * this.sr); o.W = 0.012
    return o
  }

  // A frame of run r through grains G: the grain playing, over its first X frames crossfading from the one before;
  // both at the run's own pitch (or one of them the head's varispeed, switching), and at the hop the next grain
  grains(r, x, G, acc) {
    if (G.t >= G.H) this.hop(r, x, G)
    let u = r.sr / this.sr, s = this.rate * u
    this.read(r, G.yh ? x : G.y, G.yh ? s : u, acc)
    if (G.t < G.X) {
      // a fade (Hann) kept at a constant power for the correlation of what it joins: linear for the same sound, equal
      // power for unrelated ones (M. Fink, M. Holters & U. Zölzer, "Signal-matched power-complementary cross-fading
      // and dry-wet mixing", DAFx 2016)
      let C = this.c, v = 0.5 - 0.5 * Math.cos(Math.PI * (G.t + 0.5) / G.X), w = 1 - v, k = 1 / Math.sqrt(v * v + w * w + 2 * G.rc * v * w)
      this.read(r, G.zh ? x : G.z, G.zh ? s : u, C)
      for (let c = 0; c < acc.length; c++) acc[c] = (acc[c] * v + C[c] * w) * k
    }
    G.y += u; G.z += u; G.t++
  }

  // The next grain: about the head's place in its middle (c), the start most like the grain playing's natural
  // progression (n); a whole grain inside the audio there is (by a run's end, the search slides back from it)
  hop(r, x, G) {
    let p = this.rate, u = r.sr / this.sr, n = G.y
    this.span(p, G)
    let W = G.W * r.sr, L = Math.max(8, Math.round(G.X * u)), c = x + (p - 1) * u * (G.H + G.X) / 2
    let top = r.t0 + r.n - (G.H + G.X) * u, hi = Math.min(c + W, top), lo = Math.max(r.t0, Math.min(c, top) - W)
    // An attack sounds once, as recorded: where the grains would meet, the grain plays on through it; slower, the next
    // starts past one the grain playing has sounded, not before it again (a stutter); faster, before the last one it
    // would leap, not past it unheard (a drop)
    let F = this.frame(r), q, y
    if (this.onset(r, n - F, n + L, false) >= 0) { G.z = n; G.zh = false; G.t = 0; G.rc = 1; return }
    q = lo < n ? this.onset(r, lo - F, n, true) : -1
    if (q >= 0) { lo = Math.max(lo, q + this.A * F); hi = Math.max(hi, Math.min(top, lo + W)) }
    q = hi > n + L ? this.onset(r, n + L, hi + L + F, true) : -1
    if (q >= 0) { hi = Math.max(r.t0, q - L - F); lo = Math.min(lo, Math.max(r.t0, hi - W)) }
    y = hi >= lo ? this.match(r, n, lo, hi, c, W, L) : n
    G.z = n; G.zh = false; G.y = y; G.t = 0; G.rc = hi >= lo ? Math.max(0, this.mc) : 1
  }

  // Attacks: frames of ~2.9 ms on the run's axis whose first difference has 12 dB more energy, over the channels, than
  // the four before had on average (P. Masri, PhD thesis, Bristol 1996; J. P. Bello et al., "A tutorial on onset
  // detection in music signals", IEEE Trans. Speech and Audio Processing 13, 2005). Where the first in [a, b) starts
  // (the last, `last`), or -1
  frame(r) { return Math.max(32, Math.round(r.sr / 344)) }
  onset(r, a, b, last) {
    let T = r.tape, F = this.frame(r), j1 = Math.ceil(b / F), at = -1, e1 = 0, e2 = 0, e3 = 0, e4 = 0
    for (let j = Math.ceil(a / F) - 4, j0 = j + 4; j < j1; j++) {
      let s = j * F - r.t0, e = 0
      if (s >= 1 && s + F <= r.n) for (let c = 0; c < T.length; c++) { let t = T[c]; for (let k = s; k < s + F; k++) { let d = t[k] - t[k - 1]; e += d * d } }
      if (j >= j0 && e > 1e-8 * F && e > 4 * (e1 + e2 + e3 + e4)) { at = j * F; if (!last) return at }
      e4 = e3; e3 = e2; e2 = e1; e1 = e
    }
    return at
  }

  // The start in [lo, hi], n + d for a whole d (a grain keeps n's place between samples), whose next L frames are most
  // like the L from n: their normalized cross-correlation over the channels, a little less away from c (SoundTouch's
  // TDStretch weighs it so, toward the middle of its search). Searched at every D-th frame (about 11 kHz), refined
  // about the best; this.mc the correlation found
  match(r, n, lo, hi, c, W, L) {
    let T = r.tape, b = Math.floor(n) - r.t0, d0 = Math.max(Math.ceil(lo - n), -b), d1 = Math.min(Math.floor(hi - n), r.n - L - b)
    this.mc = 0
    if (b < 0 || b + L > r.n || d1 < d0) return Math.max(lo, Math.min(hi, Math.round(c)))
    let D = Math.max(1, Math.round(r.sr / 11025)), best = -Infinity, at = d0
    for (let d = d0; d <= d1; d += D) {
      let q = (n + d - c) / W, v = (this.ncc(T, b, b + d, L, D) + 0.1) * (1 - 0.25 * Math.min(1, q * q))
      if (v > best) { best = v; at = d }
    }
    let e0 = Math.max(d0, at - D + 1), e1 = Math.min(d1, at + D - 1)
    best = -Infinity
    for (let d = e0; d <= e1; d++) {
      let m = this.ncc(T, b, b + d, L, 1), q = (n + d - c) / W, v = (m + 0.1) * (1 - 0.25 * Math.min(1, q * q))
      if (v > best) { best = v; at = d; this.mc = m }
    }
    return n + at
  }

  // Normalized cross-correlation of the L frames from tape index i with those from j, over the channels, every s-th
  ncc(T, i, j, L, s) {
    let xy = 0, xx = 0, yy = 0
    for (let c = 0; c < T.length; c++) {
      let t = T[c]
      for (let k = 0; k < L; k += s) { let p = t[i + k], q = t[j + k]; xy += p * q; xx += p * p; yy += q * q }
    }
    return xx > 0 && yy > 0 ? xy / Math.sqrt(xx * yy) : 0
  }

  // Frames of run r at head x into acc, one per output: a copy at unit step on a sample, else a windowed sinc,
  // widened below the source's Nyquist when the head runs faster than the output (to 4×)
  read(r, x, step, acc) {
    let N = this.ch, m = r.map, tape = r.tape, t0 = r.t0, n = r.n
    if (!tape) { for (let c = 0; c < N; c++) acc[c] = 0; return }
    let i0 = Math.floor(x), fr = x - i0
    if (fr === 0 && step === 1) {
      let k = i0 - t0, ok = k >= 0 && k < n
      for (let c = 0; c < N; c++) acc[c] = ok && m[c] >= 0 ? tape[m[c]][k] : 0
      return
    }
    let K = this.K || this.table(), sc = step > 1 ? Math.max(0.25, 1 / step) : 1
    let M = Math.ceil(16 / sc), w = this.w, W = 0, j0 = i0 - M + 1 - t0
    for (let j = 0; j < 2 * M; j++) {
      let u = Math.abs(j - M + 1 - fr) * sc * 256, k = u | 0
      let v = k < 4096 ? K[k] + (K[k + 1] - K[k]) * (u - k) : 0
      w[j] = v; W += v
    }
    let lo = Math.max(0, -j0), hi = Math.min(2 * M, n - j0)
    for (let c = 0; c < N; c++) {
      let s = m[c]
      if (s < 0 || hi <= lo) { acc[c] = 0; continue }
      let d = tape[s], sum = 0
      for (let j = lo; j < hi; j++) sum += w[j] * d[j0 + j]
      acc[c] = sum / W
    }
  }

  // sinc(u) · Kaiser(β 8.6) over |u| < 16, 256 points per zero crossing, read between them linearly
  table() {
    let K = new Float32Array(4098), d = this.bessel(8.6)
    for (let k = 0; k <= 4096; k++) {
      let u = k / 256, r = u / 16
      K[k] = (k ? Math.sin(Math.PI * u) / (Math.PI * u) : 1) * this.bessel(8.6 * Math.sqrt(Math.max(0, 1 - r * r))) / d
    }
    return this.K = K
  }
  bessel(x) {
    let s = 1, t = 1, q = x * x / 4
    for (let k = 1; k < 64 && t > s * 1e-12; k++) { t *= q / (k * k); s += t }
    return s
  }

  // Where the head is at output frame f: on the axis of the run heard (the outgoing one through a crossfade),
  // how fast it moves (0 while held), how much audio waits ahead, how much has come
  post(f) {
    let o = this.xf ? this.xf.run : this.cur, x = this.xf ? this.xf.x : this.x, c = this.cur, nx = this.next
    this.report({
      frame: f, pos: o ? x / o.sr : null, speed: this.moving ? this.rate : 0, run: o ? o.id : null, loop: o ? o.loop : null,
      buf: (c ? Math.max(0, c.t0 + c.n - this.x) / c.sr : 0) + (nx ? nx.run.n / nx.run.sr : 0), got: this.got
    })
  }
}

// The worklet: the deck in the audio thread. The transport talks on the node's port; a voice feeds it on its own
// port, handed over in { voice }, straight from wherever it renders (a worker's never touch the main thread).
const WORKLET = () => `const Deck = (${Deck});
registerProcessor('audio-deck', class extends AudioWorkletProcessor {
  constructor(o) {
    super()
    let feed = null
    this.deck = new Deck(sampleRate, o.outputChannelCount[0], m => { this.port.postMessage(m); if (feed) feed.postMessage(m) }, o.processorOptions)
    this.port.onmessage = e => {
      let m = e.data
      if (!m.voice) return this.deck.set(m)
      if (feed) { feed.onmessage = null; feed.close() }
      feed = m.voice
      feed.onmessage = e => this.deck.feed(e.data)
      this.deck.got = 0
    }
  }
  process(i, o) { this.deck.render(o[0], o[0][0].length, currentFrame); return !this.deck.done }
})`


// ── The page's AudioContext ──────────────────────────────────────────────
// One per page, made on first use (a play, or reading it), resumed by the first gesture; or the one an app sets
// before playing. Kept on a global symbol, so every copy of the library on the page (the engine, the worker facade,
// bundles of either) plays through the same one.

const KEY = Symbol.for('audio.context'), GESTURES = ['pointerdown', 'keydown', 'touchend']
// the deck's module, loaded once per context by whichever copy comes first (a processor name registers once)
const modules = globalThis[Symbol.for('audio.deck')] ??= new WeakMap()
let moduleURL = null

/** The page's AudioContext: get (made on first use), or set (null forgets it). Null where there is no Web Audio. */
export function context(ctx) {
  if (ctx !== undefined) { globalThis[KEY] = ctx || undefined; if (ctx) prime(ctx); return ctx || null }
  if (globalThis[KEY]) return globalThis[KEY]
  if (typeof AudioContext === 'undefined') return null
  let made = new AudioContext({ latencyHint: 'interactive' })
  globalThis[KEY] = made
  prime(made)
  return made
}

// The deck's module loads as the context is made, so the first play finds it ready; a suspended context resumes
// on the first gesture (autoplay policy)
function prime(ctx) {
  load(ctx).catch(() => {})
  if (ctx.state !== 'suspended' || typeof addEventListener !== 'function') return
  const go = () => ctx.resume().then(() => { if (ctx.state === 'running') for (let t of GESTURES) removeEventListener(t, go, true) }, () => {})
  for (let t of GESTURES) addEventListener(t, go, true)
}

function load(ctx) {
  let p = modules.get(ctx)
  if (!p) modules.set(ctx, p = !ctx.audioWorklet
    ? Promise.reject(new Error('audio: playback needs AudioWorklet, which a page has in a secure context (https, localhost)'))
    : ctx.audioWorklet.addModule(moduleURL ??= URL.createObjectURL(new Blob([WORKLET()], { type: 'text/javascript' }))))
  return p
}


// ── Devices: where a deck plays ──────────────────────────────────────────

async function webDevice(ctx, ch, init) {
  await load(ctx)
  if (ctx.state === 'suspended') ctx.resume().catch(() => {})
  let node = new AudioWorkletNode(ctx, 'audio-deck', { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [ch], processorOptions: init })
  node.connect(ctx.destination)
  let dev = {
    sr: ctx.sampleRate, ch, report: null,
    attach(port) { node.port.postMessage({ voice: port }, [port]) },
    set(m) { node.port.postMessage(m) },
    // the context frame the speakers play now: the output timestamp run on to now, else the render time less the
    // reported latencies; never back, as the speakers never go back: the two disagree while the device starts (its
    // latency is not known yet), and each new timestamp may land short of the last one run on
    heard() {
      let s = ctx.getOutputTimestamp?.(), t = s?.contextTime > 0 && s.performanceTime > 0
        ? s.contextTime + (performance.now() - s.performanceTime) / 1000
        : ctx.currentTime - (ctx.outputLatency || 0) - (ctx.baseLatency || 0)
      return far = Math.max(far, Math.min(t, ctx.currentTime) * ctx.sampleRate)
    },
    close() { if (closed) return; closed = true; node.port.onmessage = null; node.port.close(); node.disconnect() },
  }
  let closed = false, far = 0
  node.port.onmessage = e => dev.report?.(e.data)
  return dev
}

// Node: the deck renders 1024 frames at a time into @audio/speaker, which paces the writes. Closing lets the last
// buffer (a fade's end) play out.
async function nodeDevice(sr, ch, init) {
  let { default: Speaker } = await import('@audio/speaker')
  let write = Speaker({ sampleRate: sr, channels: ch, bitDepth: 32 }), B = 1024, frame = 0, live = true, closing = false, feed = null
  let out = Array.from({ length: ch }, () => new Float32Array(B)), buf = new Float32Array(B * ch), bytes = new Uint8Array(buf.buffer)
  const take = m => deck.feed(m)
  const shut = () => { feed?.close(); feed = null; write.close() }
  let dev = {
    sr, ch, report: null,
    attach(port) { if (feed) { feed.off?.('message', take); feed.close() } feed = port; feed.on('message', take); deck.got = 0 },
    set(m) { deck.set(m) },
    heard: () => Math.max(0, frame - B - 0.05 * sr),   // what is written, less the device ring (~50 ms)
    close() { closing = true },
  }
  let deck = new Deck(sr, ch, m => { dev.report?.(m); feed?.postMessage(m) }, init)
  const tick = err => {
    if (!live) return
    if (err) { live = false; shut(); dev.report?.({ error: err }); return }
    deck.render(out, B, frame)
    frame += B
    for (let i = 0; i < B; i++) for (let c = 0; c < ch; c++) buf[i * ch + c] = out[c][i]
    if (!closing && !deck.done) return write(bytes, tick)
    live = false
    write(bytes, () => write.flush(shut))
  }
  tick()
  return dev
}


// ── Transport: the main thread's side of a deck ──────────────────────────

/** Open a deck: channels as the source has (two at least: mono plays on both), the rate the device runs at
 *  (the page's context; Node: sampleRate). */
export async function open({ channels, sampleRate, playing = true, volume = 1, rate = 1, preservesPitch = true } = {}) {
  let ctx = context(), ch = Math.max(2, channels | 0), init = { playing, volume, rate, preservesPitch }
  return transport(ctx ? await webDevice(ctx, ch, init) : await nodeDevice(sampleRate, ch, init))
}

// The axis to the timeline: a loop's passes run on past its end
export const timeline = (v, loop) => !loop || v < loop[1] || !(loop[1] > loop[0]) ? v : loop[0] + (v - loop[1]) % (loop[1] - loop[0])

/** Where the speakers are at device frame `f`, from the deck's reports: the last at or before it, run on at its speed
 *  for the frames since, never past the audio the deck had waiting then (buf), nor past where its next report in the
 *  same run has the head (frames a glitching device skipped are numbered, never played), so the playhead of a starved
 *  deck, or one whose reports come late, holds and never steps back. { run, pos on the axis, time on the timeline } */
export function whereHeard(marks, f, sr) {
  let i = marks.length - 1
  while (i > 0 && marks[i].frame > f) i--
  let r = marks[i], n = marks[i + 1]
  if (!r) return null
  let pos = r.pos + Math.min(Math.max(0, f - r.frame) / sr * r.speed, r.buf ?? Infinity)
  if (n?.run === r.run && n.pos < pos) pos = n.pos
  return { run: r.run, pos, time: timeline(pos, r.loop) }
}

function transport(dev) {
  let marks = [], last = null, q = [], end = null, runs = 0, stopped = false
  let tp = {
    sr: dev.sr, ch: dev.ch,
    emit: null,                    // (type, value): 'report' (each report), 'end' (heard the end), 'error'
    // a port for a voice: its run ids start above every earlier voice's
    port() { let { port1, port2 } = new MessageChannel(); dev.attach(port1); return port2 },
    runs() { return runs += 1e6 },
    set(m) { if (!stopped) dev.set(m) },
    // the deck's head now, on the axis: its last report, run on, as far as the audio it had
    head() { return last && last.pos + Math.min((performance.now() - last.at) / 1000 * last.speed, last.buf ?? Infinity) },
    // what the speakers play now: { run, pos on the axis, time on the timeline }
    heard() { return whereHeard(marks, dev.heard(), dev.sr) },
    // call fn once position `pos` of run `run` is heard (meters); dropped if its run is replaced first
    defer(run, pos, fn) { q.push({ run, pos, fn }) },
    stop() {
      if (stopped) return
      stopped = true
      dev.set({ stop: 1 })
      setTimeout(() => dev.close(), 250)   // a suspended context reports nothing
    },
  }
  const release = all => {
    let h = all ? null : tp.heard()
    if (!all && !h) return
    while (q.length) {
      let e = q[0]
      if (h && (e.run > h.run || e.run === h.run && e.pos > h.pos)) break
      q.shift()
      if (all || e.run === h.run) e.fn()
    }
  }
  dev.report = m => {
    if (m.stopped != null) return dev.close()
    if (m.error) return tp.emit?.('error', m.error)
    if (m.end != null) end = m.end
    if (m.pos != null) {
      m.at = performance.now()
      last = m
      marks.push(m)
      // keep what the speakers are still to play, and the mark before it
      if (marks.length > 64) { let f = dev.heard(); while (marks.length > 2 && marks[1].frame <= f) marks.shift() }
    }
    if (stopped) return
    release(false)
    tp.emit?.('report', m)
    if (end != null && dev.heard() >= end) { end = null; release(true); tp.emit?.('end') }
  }
  return tp
}

/** Taking over another's playback (b.play({ from: a })): an instance or facade answers [TAKE]() with its
 *  transport and settings, and lets go of it. */
export const TAKE = Symbol.for('audio.take')
