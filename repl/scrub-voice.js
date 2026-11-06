// @audio/scrub@1.0.0 (~/projects/@audio/scrub), bundled by .scrub-vendor.js: edit it there, not here.
// ../@audio/scrub/kit.js
var TAU = 2 * Math.PI;
var clamp = (v, lo, hi) => v < lo ? lo : v > hi ? hi : v;
var xorshift = (s) => {
  s ^= s << 13;
  s ^= s >>> 17;
  return s ^ s << 5;
};
var TURNS = Float64Array.from({ length: 8192 }, (_, i) => i & 1 ? Math.sin(TAU * (i >> 1) / 4096) : Math.cos(TAU * (i >> 1) / 4096));
var turn = (s) => s >>> 20 << 1;
var plans = /* @__PURE__ */ new Map();
function plan(n) {
  let p = plans.get(n);
  if (p) return p;
  const rev = new Uint32Array(n), cos = new Float64Array(n / 2), sin = new Float64Array(n / 2), bits = Math.log2(n);
  for (let i = 0; i < n; i++) {
    let r = 0;
    for (let b = 0; b < bits; b++) r |= (i >> b & 1) << bits - 1 - b;
    rev[i] = r;
  }
  for (let i = 0; i < n / 2; i++) {
    cos[i] = Math.cos(TAU * i / n);
    sin[i] = -Math.sin(TAU * i / n);
  }
  plans.set(n, p = { rev, cos, sin });
  return p;
}
function fft(re, im) {
  const n = re.length, { rev, cos, sin } = plan(n);
  for (let i = 0; i < n; i++) {
    const j = rev[i];
    if (j > i) {
      let t = re[i];
      re[i] = re[j];
      re[j] = t;
      t = im[i];
      im[i] = im[j];
      im[j] = t;
    }
  }
  for (let size = 2; size <= n; size *= 2) {
    const half = size / 2, step = n / size;
    for (let i = 0; i < n; i += size) for (let j = 0; j < half; j++) {
      const k = j * step, a = i + j, b = a + half, tr = re[b] * cos[k] - im[b] * sin[k], ti = re[b] * sin[k] + im[b] * cos[k];
      re[b] = re[a] - tr;
      im[b] = im[a] - ti;
      re[a] += tr;
      im[a] += ti;
    }
  }
}
var hanns = /* @__PURE__ */ new Map();
function hann(n) {
  let w = hanns.get(n);
  if (!w) hanns.set(n, w = Float64Array.from({ length: n }, (_, i) => 0.5 - 0.5 * Math.cos(TAU * i / n)));
  return w;
}
function analyse(x, p, w, re, im, lag = 0) {
  const n = w.length, first = p - n / 2;
  for (let j = 0; j < n; j++) {
    const a = first + j, b = a - lag;
    re[j] = a >= 0 && a < x.length ? x[a] * w[j] : 0;
    im[j] = lag && b >= 0 && b < x.length ? x[b] * w[j] : 0;
  }
  fft(re, im);
}
function unpack(re, im, ar, ai, br, bi) {
  const n = re.length;
  for (let k = 0; k <= n / 2; k++) {
    const m = k ? n - k : 0, zr = re[k], zi = im[k], wr = re[m], wi = im[m];
    ar[k] = (zr + wr) / 2;
    ai[k] = (zi - wi) / 2;
    br[k] = (zi + wi) / 2;
    bi[k] = (wr - zr) / 2;
  }
}
function pack(ar, ai, br, bi, re, im) {
  const n = re.length;
  for (let k = 0; k <= n / 2; k++) {
    re[k] = ar[k] - bi[k];
    im[k] = ai[k] + br[k];
    if (k && k < n / 2) {
      re[n - k] = ar[k] + bi[k];
      im[n - k] = br[k] - ai[k];
    }
  }
}
function regions(mag, peaks, owner, lows) {
  const h = mag.length;
  let count = 0;
  for (let k = 2; k < h - 2; k++) {
    const m = mag[k];
    if (m > 0 && m > mag[k - 1] && m > mag[k - 2] && m >= mag[k + 1] && m >= mag[k + 2]) peaks[count++] = k;
  }
  if (!count) {
    owner.fill(-1);
    return 0;
  }
  let from = 0, left = Infinity;
  for (let k = 0; k < peaks[0]; k++) if (mag[k] < left) left = mag[k];
  for (let i = 0; i < count; i++) {
    const k = peaks[i], last = i + 1 === count, end = last ? h : peaks[i + 1];
    let valley = k, low = Infinity;
    for (let j = k + 1; j < end; j++) if (mag[j] < low) {
      low = mag[j];
      valley = j;
    }
    if (last) valley = h - 1;
    owner.fill(i, from, valley + 1);
    lows[i] = Math.max(left === Infinity ? 0 : left, low === Infinity ? 0 : low);
    left = low;
    from = valley + 1;
  }
  return count;
}
function vertex(mag, k, out) {
  const a = Math.log(mag[k - 1] || 1e-30), b = Math.log(mag[k]), c = Math.log(mag[k + 1] || 1e-30), d = Math.min(a - 2 * b + c, -1e-9);
  const \u03B4 = clamp(0.5 * (a - c) / d, -0.5, 0.5);
  out[0] = k + \u03B4;
  out[1] = Math.exp(b - 0.25 * (a - c) * \u03B4);
  out[2] = 2 * Math.sqrt(Math.LN2 / -d);
}
var TONAL = 10 ** (12 / 20);
function leak(d) {
  d = Math.abs(d);
  if (d < 1e-6) return 1;
  if (Math.abs(d - 1) < 1e-6) return 0.5;
  return Math.abs(Math.sin(Math.PI * d) / (Math.PI * d * (1 - d * d)));
}
function explained(mag, owner, i, k, f, m, mark) {
  for (let j = k; j >= 0 && owner[j] === i; j--) if (Math.abs(j - f) <= 1.5 || mag[j] <= 2 * m * leak(j - f)) mark[j] = 1;
  for (let j = k + 1; j < mag.length && owner[j] === i; j++) if (Math.abs(j - f) <= 1.5 || mag[j] <= 2 * m * leak(j - f)) mark[j] = 1;
}

// ../@audio/scrub/alike.js
var SEEDS = 8;
var TIME = 2;
var WIDTH = 3;
var Alike = class {
  constructor(x, n) {
    const C = x.length, h = n / 2 + 1;
    this.x = x;
    this.n = n;
    this.h = h;
    this.w = hann(n);
    this.power = new Float64Array(C * h);
    this.cross = new Float64Array(C * (C - 1) * h);
    this.re = new Float64Array(n);
    this.im = new Float64Array(n);
    this.later = x.map(() => [new Float64Array(h), new Float64Array(h)]);
    this.earlier = x.map(() => [new Float64Array(h), new Float64Array(h)]);
    this.known = false;
    this.moving = false;
  }
  // The caret's frame at `at`, `moved` samples from the last hop's; spectra[c] its channel c's [re, im] there
  follow(at, moved, spectra) {
    if (!this.known || moved > SEEDS * this.n / 2 || !moved && this.moving) this.seed(at);
    else if (moved) {
      const keep = Math.exp(-moved / (TIME * this.n));
      this.learn(1 - keep, keep, spectra);
    }
    this.moving = moved > 0;
  }
  // Folds every channel's spectrum spectra[c] = [re, im] in: what was there, times `keep`, and this, times `a`
  learn(a, keep, spectra) {
    const { power, cross, h } = this, C = spectra.length;
    for (let c = 0, pair = 0; c < C; c++) {
      const ur = spectra[c][0], ui = spectra[c][1], P = c * h;
      for (let k = 0; k < h; k++) power[P + k] = keep * power[P + k] + a * (ur[k] * ur[k] + ui[k] * ui[k]);
      for (let d = c + 1; d < C; d++, pair++) {
        const vr = spectra[d][0], vi = spectra[d][1], Q = 2 * pair * h;
        for (let k = 0; k < h; k++) {
          cross[Q + 2 * k] = keep * cross[Q + 2 * k] + a * (ur[k] * vr[k] + ui[k] * vi[k]);
          cross[Q + 2 * k + 1] = keep * cross[Q + 2 * k + 1] + a * (ui[k] * vr[k] - ur[k] * vi[k]);
        }
      }
    }
  }
  // Afresh: SEEDS frames n/2 apart centred on the frame at `at`, two to a transform
  seed(at) {
    const { x, n, w, re, im, later, earlier } = this;
    this.power.fill(0);
    this.cross.fill(0);
    for (let j = 1; j < SEEDS; j += 2) {
      const centre = at + Math.round((j - (SEEDS - 1) / 2) * n / 2);
      for (let c = 0; c < x.length; c++) {
        analyse(x[c], centre, w, re, im, n / 2);
        unpack(re, im, later[c][0], later[c][1], earlier[c][0], earlier[c][1]);
      }
      this.learn(1 / SEEDS, 1, later);
      this.learn(1 / SEEDS, 1, earlier);
    }
    this.known = true;
  }
  // Channel c's power over bins from…to
  sum(c, from, to) {
    let s = 0;
    for (let j = from, P = c * this.h; j <= to; j++) s += this.power[P + j];
    return s;
  }
  // The loudest channel over bins from…to
  loudest(from, to) {
    let ref = 0, top = -1;
    for (let c = 0; c < this.x.length; c++) {
      const s = this.sum(c, from, to);
      if (s > top) {
        top = s;
        ref = c;
      }
    }
    return ref;
  }
  // Channel c against channel r over bins from…to: their cross-spectrum Σ X_c conj X_r into out[0], out[1], their powers
  // into out[2], out[3], and how much of c the frames say r holds, its coherence with r beyond chance, γ² (returned).
  // Two unrelated sounds still look a little alike over K frames and B independent bins: their coherence γ̂² averages
  // b = 1/(K·B) (Carter, Knapp & Nuttall 1973); γ² = (γ̂² − b) / (1 − b). The bins are as many as carry the power, its
  // participation ratio (Σw)² / Σw², w the two channels' geometric mean power: all of them for a flat noise, about one
  // for a sine's lobe, whose bins are one component. Under Hann, neighbouring bins of white noise correlate −2/3 and 1/6
  // two apart (the transform of the window squared), so B is that ratio over 1 + 2 (4/9 + 1/36) = 1.94, and at least 1.
  likeness(c, r, from, to, out) {
    const { power, cross, h } = this, C = this.x.length, lo = Math.min(c, r), hi = Math.max(c, r), Q = 2 * (lo * (2 * C - lo - 1) / 2 + hi - lo - 1) * h;
    let gr = 0, gi = 0, pc = 0, pr = 0, w = 0, w2 = 0;
    for (let j = from; j <= to; j++) {
      const a = power[c * h + j], b2 = power[r * h + j], m = Math.sqrt(a * b2);
      gr += cross[Q + 2 * j];
      gi += cross[Q + 2 * j + 1];
      pc += a;
      pr += b2;
      w += m;
      w2 += m * m;
    }
    if (c > r) gi = -gi;
    out[0] = gr;
    out[1] = gi;
    out[2] = pc;
    out[3] = pr;
    if (!(pc > 0 && pr > 0)) return 0;
    const bins = Math.max(1, w * w / w2 / (1 + 2 * (4 / 9 + 1 / 36))), b = 1 / (bins * SEEDS), \u03B32 = (gr * gr + gi * gi) / (pc * pr);
    return \u03B32 > b ? Math.min(1, (\u03B32 - b) / (1 - b)) : 0;
  }
};

// ../@audio/scrub/frames.js
var Frames = class {
  constructor(x, sr, caret, { frame = 2048, overlap = 4, spread = 0, band = null } = {}) {
    const n = this.n = frame, h = n / 2 + 1, C = x.length;
    this.x = x;
    this.sr = sr;
    this.hop = n / overlap;
    this.overlap = overlap;
    this.lift = Math.sqrt(overlap);
    this.spread = Math.round(spread / 1e3 * sr);
    this.band = band;
    this.lo = 0;
    this.hi = n / 2;
    this.w = hann(n);
    this.ch = x.map(() => {
      const c = { re: new Float64Array(n), im: new Float64Array(n), sum: new Float64Array(2 * n), tonal: new Uint8Array(h) };
      for (const k of ["xr", "xi", "tr", "ti", "yr", "yi"]) c[k] = new Float64Array(h);
      return c;
    });
    this.alike = C > 1 ? new Alike(x, n) : null;
    this.spectra = this.ch.map((c) => [c.xr, c.xi]);
    this.near = new Float64Array(C);
    this.likeness = new Float64Array(4);
    this.moved = 0;
    this.k = this.hop;
    this.p = clamp(Math.round(caret), 0, x[0].length - 1);
    this.q = this.p;
    this.s = 3107613;
  }
  get at() {
    return this.p;
  }
  render(out, caret) {
    const { ch, hop, n } = this, m = out[0].length;
    for (let i = 0; i < m; i++) {
      if (this.k === hop) {
        for (const c of ch) {
          c.sum.copyWithin(0, hop);
          c.sum.fill(0, 2 * n - hop);
        }
        const band = this.band, bin = this.sr / n;
        this.lo = band ? Math.max(0, Math.ceil(band[0] / bin - 0.5)) : 0;
        this.hi = band ? Math.min(n / 2, Math.floor(band[1] / bin + 0.5)) : n / 2;
        this.next(caret);
        this.k = 0;
      }
      for (let c = 0; c < ch.length; c++) out[c][i] = ch[c].sum[this.k];
      this.k++;
    }
  }
  // Where the caret is now, and how far it moved since the last hop
  move(caret) {
    const p = clamp(Math.round(caret), 0, this.x[0].length - 1);
    this.moved = Math.abs(p - this.p);
    this.p = p;
  }
  // A hop: the caret's frame shaped into each channel's spectrum, and played
  next(caret) {
    this.move(caret);
    this.shape(this.frame());
    for (const c of this.ch) this.inverse(c);
  }
  // Where the frame is: at the caret, or with a spread anywhere within it of the caret
  frame() {
    const { p, spread } = this;
    return this.q = spread ? clamp(p + Math.round((this.s = xorshift(this.s)) / 2 ** 31 * spread), 0, this.x[0].length - 1) : p;
  }
  // A random turn for bin k of channel c, √overlap long
  scatter(c, k) {
    const t = turn(this.s = xorshift(this.s));
    c.tr[k] = this.lift * TURNS[t];
    c.ti[k] = this.lift * TURNS[t + 1];
  }
  // Each channel's spectrum X turned by its own turn t (a tone's phase advance, or a random phase), Y = t·X, but for
  // the part of it that the channel loudest around that bin predicts: that part turns as the loudest does,
  // Y = t·X + (t′ − t)·G. G = H·X′, H the least-squares transfer from the loudest channel, its cross-spectrum with this
  // one over its power, both read over the sound around the caret (Alike: the frames there, and the 2W + 1 bins
  // around), and shrunk to their coherence beyond chance, |H|² = γ² P / P′, so the turned parts' cross-spectrum is γ's:
  // what the channels share turns as one, the rest apart. A sound panned or the same in several channels is predicted
  // whole and turns alike in all of them, so the phase between them stays; channels holding different sounds turn
  // apart, as they did. Where the turns agree (a caret dragged at the sound's speed), Y = t·X exactly.
  couple() {
    const { ch, n, alike, near, likeness } = this, C = ch.length, h = n / 2 + 1, W = WIDTH;
    if (alike) {
      alike.follow(this.q, this.moved, this.spectra);
      for (let c = 0; c < C; c++) near[c] = alike.sum(c, 0, Math.min(W, h) - 1);
    }
    for (let k = 0; k < h; k++) {
      let ref = 0;
      if (alike) for (let c = 0; c < C; c++) {
        if (k + W < h) near[c] += alike.power[c * h + k + W];
        if (k > W) near[c] -= alike.power[c * h + k - W - 1];
        if (near[c] > near[ref]) ref = c;
      }
      const R = ch[ref], from = Math.max(0, k - W), to = Math.min(h - 1, k + W);
      for (let c = 0; c < C; c++) {
        const { xr, xi, tr, ti, yr, yi } = ch[c];
        let a = tr[k] * xr[k] - ti[k] * xi[k], d = tr[k] * xi[k] + ti[k] * xr[k];
        const \u03B32 = alike && c !== ref ? alike.likeness(c, ref, from, to, likeness) : 0;
        if (\u03B32) {
          const gr = likeness[0], gi = likeness[1], s = Math.sqrt(\u03B32 * likeness[2] / likeness[3] / (gr * gr + gi * gi));
          const er = s * (gr * R.xr[k] - gi * R.xi[k]), ei = s * (gr * R.xi[k] + gi * R.xr[k]), dr = R.tr[k] - tr[k], di = R.ti[k] - ti[k];
          a += dr * er - di * ei;
          d += dr * ei + di * er;
        }
        yr[k] = a;
        yi[k] = d;
      }
    }
  }
  // Channel c's turned spectrum into its frame, the band's bins only; DC and Nyquist are real, given
  place(c, dc, nyquist) {
    const { re, im, yr, yi } = c, { lo, hi, n } = this;
    for (let k = 0; k <= n / 2; k++) {
      const on = k >= lo && k <= hi;
      re[k] = on ? yr[k] : 0;
      im[k] = on ? yi[k] : 0;
    }
    re[0] = lo <= 0 ? dc : 0;
    re[n / 2] = hi >= n / 2 ? nyquist : 0;
  }
  // A channel's bins 0…n/2 of re/im to a real frame: mirror, conjugate, forward FFT, real part / n
  inverse({ re, im, sum }) {
    const { n, w } = this, g = 1 / (0.375 * this.overlap * n);
    for (let k = 1; k < n / 2; k++) {
      re[n - k] = re[k];
      im[n - k] = im[k];
      im[k] = -im[k];
    }
    im[0] = im[n / 2] = 0;
    fft(re, im);
    for (let j = 0; j < n; j++) sum[j] += w[j] * re[j] * g;
  }
};

// ../@audio/scrub/voice.js
var RISE = 10 ** (12 / 10);
var FLOOR = 1e-7;
var up = (j, n) => 0.5 - 0.5 * Math.cos(Math.PI * (j + 0.5) / n);
var attacks = /* @__PURE__ */ new Map();
function attacking(n) {
  let a = attacks.get(n);
  if (a) return a;
  const block = n / 32, lead = block, length = n / 2, fall = n / 8, room = n / 8;
  a = {
    block,
    lead,
    length,
    fall,
    room,
    rise: Float64Array.from({ length }, (_, j) => j < lead ? up(j, lead) : j < length - fall ? 1 : 1 - up(j - length + fall, fall)),
    taper: Float64Array.from({ length: n }, (_, j) => j < room ? up(j, room) : j < room + length ? 1 : 1 - up(j - room - length, n - room - length))
  };
  attacks.set(n, a);
  return a;
}
function rise(x, i) {
  let p = 0;
  for (let c = 0; c < x.length; c++) {
    const d = x[c][i] - x[c][i - 1];
    p += d * d;
  }
  return p;
}
var Voice = class extends Frames {
  constructor(x, sr, caret, o = {}, noise = true) {
    super(x, sr, caret, o);
    const n = this.n, h = n / 2 + 1, C = x.length;
    this.noise = noise;
    this.cut = attacking(n);
    for (const c of this.ch) {
      for (const k of ["ar", "ai", "br", "bi", "sr", "si", "mag", "lows", "rr", "ri"]) c[k] = new Float64Array(h);
      c.peaks = new Int32Array(h);
      c.owner = new Int32Array(h);
      c.fill = 1;
    }
    const { block } = this.cut;
    this.back = this.hop / block;
    this.reach = Math.ceil((4 * n + 2 * this.spread) / block);
    this.energy = new Float64Array(this.reach + this.back);
    this.found = new Int32Array(this.reach);
    this.bare = new Float64Array(n);
    for (const k of ["covered", "kept", "before", "after"]) this[k] = new Float64Array(C);
    for (const k of ["ur", "ui", "vr", "vi"]) this[k] = new Float64Array(h);
    this.wr = new Float64Array(n);
    this.wi = new Float64Array(n);
    this.v = new Float64Array(3);
    this.\u03C6 = 0;
    this.fresh = true;
  }
  // The onsets in [lo, hi) into this.found, in order; returns their count
  onsets(lo, hi) {
    const { x, energy, found, back, reach } = this, { block } = this.cut, n = x[0].length;
    const b0 = Math.max(1, Math.floor(Math.max(0, lo) / block)), b1 = Math.min(Math.ceil(Math.min(n, hi) / block), b0 + reach);
    const first = Math.max(0, b0 - back);
    energy.fill(0, 0, Math.max(0, b1 - first));
    for (let c = 0; c < x.length; c++) {
      const y = x[c];
      for (let b = first; b < b1; b++) {
        let e = 0;
        for (let i = Math.max(1, b * block), end = Math.min(n, (b + 1) * block); i < end; i++) {
          const d = y[i] - y[i - 1];
          e += d * d;
        }
        energy[b - first] += e;
      }
    }
    let count = 0;
    for (let b = b0; b < b1; b++) {
      const e = energy[b - first];
      if (e < FLOOR * block * x.length) continue;
      let before = 0;
      for (let j = Math.max(first, b - back); j < b; j++) if (energy[j - first] > before) before = energy[j - first];
      if (e < RISE * before) continue;
      let top = 0, at = b * block;
      for (let i = b * block, end = Math.min(n, i + block); i < end; i++) top = Math.max(top, rise(x, i));
      for (let i = Math.max(1, (b - 1) * block), end = Math.min(n, (b + 1) * block); i < end; i++) if (rise(x, i) >= top / 16) {
        at = i;
        break;
      }
      found[count++] = at;
    }
    return count;
  }
  // The share of sample t that belongs to the attack at onset o, the next onset at `next`
  share(o, next, t) {
    const { lead, length, rise: rise2 } = this.cut, j = t - o + lead, k = t - next + lead;
    if (j < 0 || j >= length) return 0;
    return k < 0 ? rise2[j] : k < lead ? rise2[j] * (1 - rise2[k]) : 0;
  }
  // A hop: the caret's frame without its attacks, and the attacks the caret passed since the last hop, each when the
  // caret's frame would have sounded it, the caret taken to move evenly over the hop; a new voice's, those within a
  // quarter frame of where it lands
  next(caret) {
    const { n, hop, found } = this, { length } = this.cut, last = this.p, fresh = this.fresh;
    this.move(caret);
    const p = this.p, at = this.frame();
    const was = clamp(last, p - n, p + n), count = this.onsets(Math.min(was, p, at) - n / 2 - length, Math.max(was, p, at) + n / 2 + length);
    this.shape(at, count);
    for (const c of this.ch) this.inverse(c);
    for (let j = 0; j < count; j++) {
      const o = found[j], next = j + 1 < count ? found[j + 1] : Infinity;
      if (fresh) {
        if (Math.abs(o - p) <= n / 4) this.attack(o, next, n / 2 + o - p);
      } else if (last < o !== p < o && Math.abs(o - p) <= n) this.attack(o, next, Math.round(n / 2 - (p - o) / (p - last) * hop));
    }
  }
  // The attack at onset o into the output, its onset to sound `at` samples from now: the sound in its window, less
  // each channel's bins of steady tones and those outside the band, two channels to a transform and back
  attack(o, next, at) {
    const { x, ch, lo, hi, wr, wi, ur, ui, vr, vi, n } = this, { lead, length, room, taper } = this.cut, len = x[0].length, from = at - room - lead;
    for (let c = 0; c < ch.length; c += 2) {
      const l = x[c], r = x[c + 1], a = ch[c], b = ch[c + 1];
      wr.fill(0);
      wi.fill(0);
      for (let t = Math.max(0, o - lead), end = Math.min(len, o - lead + length); t < end; t++) {
        const w = this.share(o, next, t), j = room + t - o + lead;
        wr[j] = l[t] * w;
        if (r) wi[j] = r[t] * w;
      }
      fft(wr, wi);
      unpack(wr, wi, ur, ui, vr, vi);
      for (let k = 0; k <= n / 2; k++) {
        const out = k < lo || k > hi;
        if (out || a.tonal[k]) ur[k] = ui[k] = 0;
        if (out || !b || b.tonal[k]) vr[k] = vi[k] = 0;
      }
      pack(ur, ui, vr, vi, wr, wi);
      for (let j = 0; j < n; j++) wi[j] = -wi[j];
      fft(wr, wi);
      const u = a.sum, v = b?.sum;
      for (let j = 0; j < n; j++) {
        u[from + j] += wr[j] * taper[j] / n;
        if (v) v[from + j] -= wi[j] * taper[j] / n;
      }
    }
  }
  // The attacks within the frame at p, as the frame hears them: each channel's spectrum into sr/si, two channels to a
  // transform. φ is the share of the window they take. The steady sound under them goes with them, so each channel's
  // noise comes `fill` times louder: enough to hold it too, taken at the lower of its levels just before and just
  // after each attack (the gap filled from its edges, as Nagel & Walther 2009 fill theirs), and never more than a
  // steady sound would need, 1/√κ, κ the share of its energy the frame keeps.
  gaps(p, count) {
    const { x, ch, wr, wi, found, bare, w, n, covered, kept, before, after } = this, { lead, length, fall } = this.cut, first = p - n / 2, len = x[0].length, C = ch.length;
    if (!count) {
      for (const c of ch) {
        c.sr.fill(0);
        c.si.fill(0);
        c.fill = 1;
      }
      this.\u03C6 = 0;
      return;
    }
    bare.fill(1);
    covered.fill(0);
    for (let q = 0; q < count; q++) {
      const o = found[q], next = q + 1 < count ? found[q + 1] : Infinity;
      before.fill(0);
      after.fill(0);
      for (let c = 0; c < C; c++) {
        const y = x[c];
        for (let t = Math.max(0, o - lead - fall); t < o - lead; t++) before[c] += y[t] * y[t];
        for (let t = o - lead + length, end = Math.min(len, t + fall); t < end; t++) after[c] += y[t] * y[t];
      }
      for (let t = Math.max(0, first, o - lead), end = Math.min(len, first + n, o - lead + length); t < end; t++) {
        const f = t - first, s = this.share(o, next, t), e = (s * w[f]) ** 2;
        bare[f] -= s;
        for (let c = 0; c < C; c++) covered[c] += e * Math.min(before[c], after[c]) / fall;
      }
    }
    let taken = 0, steady = 0;
    for (let f = 0; f < n; f++) {
      taken += (1 - bare[f]) * w[f];
      steady += (bare[f] * w[f]) ** 2;
    }
    kept.fill(0);
    for (let c = 0; c < C; c += 2) {
      const a = ch[c], b = ch[c + 1], l = x[c], r = x[c + 1];
      for (let f = 0; f < n; f++) {
        const t = first + f, u = t >= 0 && t < len ? l[t] * w[f] : 0, v = r && t >= 0 && t < len ? r[t] * w[f] : 0;
        wr[f] = u * (1 - bare[f]);
        wi[f] = v * (1 - bare[f]);
        kept[c] += (u * bare[f]) ** 2;
        if (r) kept[c + 1] += (v * bare[f]) ** 2;
      }
      fft(wr, wi);
      if (b) unpack(wr, wi, a.sr, a.si, b.sr, b.si);
      else for (let k = 0; k <= n / 2; k++) {
        a.sr[k] = wr[k];
        a.si[k] = wi[k];
      }
    }
    const \u03BA = steady / (0.375 * n);
    this.\u03C6 = Math.min(1, taken / (n / 2));
    for (let c = 0; c < C; c++) ch[c].fill = kept[c] > 0 && \u03BA > 0 ? Math.min(Math.sqrt(1 + covered[c] / kept[c]), 1 / Math.sqrt(\u03BA)) : 1;
  }
  // Whether channel c's peak at bin k is a steady tone, not one the attacks make: the frame without them keeps at
  // least half of what a tone going on through them would, 1 − φ of it (as Röbel 2003 tells a transient's peaks from a
  // steady sinusoid's, per peak); an attack's own peaks keep next to nothing
  steady({ ar, ai, sr, si }, k) {
    if (!this.\u03C6) return true;
    const all = ar[k] * ar[k] + ai[k] * ai[k], kept = (ar[k] - sr[k]) ** 2 + (ai[k] - si[k]) ** 2;
    return 4 * kept >= (1 - this.\u03C6) ** 2 * all;
  }
  // The frame at p, the `onsets` found in reach, into each channel's re/im. A tone's bins turn all of A by their
  // region's rotation; the rest turn A less the attacks, filled: at random with noise, by their region's rotation
  // without.
  shape(p, onsets) {
    const { x, w, ch, n, hop, noise, v } = this, h = n / 2 + 1;
    for (let c = 0; c < ch.length; c++) {
      const C = ch[c];
      analyse(x[c], p, w, C.re, C.im, hop);
      unpack(C.re, C.im, C.ar, C.ai, C.br, C.bi);
    }
    this.gaps(p, onsets);
    for (const C of ch) {
      const { ar, ai, br, bi, sr, si, yr, yi, rr, ri, mag, peaks, owner, lows, tonal, xr, xi, tr, ti, fill } = C;
      for (let k = 0; k < h; k++) mag[k] = Math.sqrt(ar[k] * ar[k] + ai[k] * ai[k]);
      const count = regions(mag, peaks, owner, lows);
      for (let i = 0; i < count; i++) {
        const k = peaks[i], d = Math.sqrt((yr[k] * yr[k] + yi[k] * yi[k]) * (br[k] * br[k] + bi[k] * bi[k]));
        if (this.fresh || !d) {
          rr[i] = 1;
          ri[i] = 0;
          continue;
        }
        rr[i] = (yr[k] * br[k] + yi[k] * bi[k]) / d;
        ri[i] = (yi[k] * br[k] - yr[k] * bi[k]) / d;
      }
      tonal.fill(0);
      for (let i = 0; i < count; i++) {
        if (mag[peaks[i]] < TONAL * lows[i] || !this.steady(C, peaks[i])) continue;
        vertex(mag, peaks[i], v);
        explained(mag, owner, i, peaks[i], v[0], v[1], tonal);
      }
      for (let k = 0; k < h; k++) {
        const o = owner[k];
        if (noise ? tonal[k] : o >= 0) {
          tr[k] = rr[o];
          ti[k] = ri[o];
        } else if (noise) this.scatter(C, k);
        else {
          tr[k] = 1;
          ti[k] = 0;
        }
        xr[k] = tonal[k] ? ar[k] : (ar[k] - sr[k]) * fill;
        xi[k] = tonal[k] ? ai[k] : (ai[k] - si[k]) * fill;
      }
    }
    this.fresh = false;
    this.couple();
    for (const C of ch) this.place(C, (C.ar[0] - C.sr[0]) * C.fill, (C.ar[n / 2] - C.sr[n / 2]) * C.fill);
  }
};
export {
  Voice
};
