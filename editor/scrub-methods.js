// @audio/scrub@1.0.0 (~/projects/@audio/scrub), bundled by .scrub-vendor.js: edit it there, not here.
// kit.js
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
function read(x, p) {
  const i = Math.floor(p), t = p - i;
  if (i < 1 || i > x.length - 3) return 0;
  const a = x[i - 1], b = x[i], c = x[i + 1], d = x[i + 2];
  return b + t * (0.5 * (c - a) + t * (a - 2.5 * b + 2 * c - 0.5 * d + t * (1.5 * (b - c) + 0.5 * (d - a))));
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

// replay.js
var Tape = class {
  constructor(x, sr, caret) {
    this.x = x;
    this.k = 1 - Math.exp(-1 / (0.02 * sr));
    this.p = this.q = caret;
    this.x1 = Float64Array.from(x, (c) => read(c, caret));
    this.y1 = new Float64Array(x.length);
  }
  get at() {
    return this.p;
  }
  render(out, caret) {
    const { x, k, x1, y1 } = this, n = out[0].length;
    let p = this.p, q = this.q;
    for (let c = 0; c < x.length; c++) {
      const y = out[c], s = x[c];
      let a = x1[c], b = y1[c];
      p = this.p;
      q = this.q;
      for (let i = 0; i < n; i++) {
        q += (caret - q) * k;
        p += (q - p) * k;
        const v = read(s, p);
        b = v - a + 0.995 * b;
        a = v;
        y[i] = b;
      }
      x1[c] = a;
      y1[c] = b;
    }
    this.p = p;
    this.q = q;
  }
};
var Loop = class {
  constructor(x, sr, caret) {
    this.x = x;
    this.len = Math.min(x[0].length, Math.round(0.08 * sr));
    this.cross = Math.max(1, Math.min(this.len >> 1, Math.round(8e-3 * sr)));
    this.rise = Float64Array.from({ length: this.cross }, (_, i) => Math.sin(Math.PI / 2 * (i + 0.5) / this.cross));
    this.a = this.b = this.start(caret);
    this.j = 0;
  }
  start(caret) {
    return clamp(Math.round(caret - this.len / 2), 0, this.x[0].length - this.len);
  }
  get at() {
    return this.a + this.j;
  }
  render(out, caret) {
    const { x, len, cross, rise: rise2 } = this, tail = len - cross, n = out[0].length;
    let { a, b, j } = this;
    for (let i = 0; i < n; i++) {
      if (j === tail) b = this.start(caret);
      if (j >= tail) {
        const u = j - tail, f = rise2[cross - 1 - u], r = rise2[u];
        for (let c = 0; c < x.length; c++) out[c][i] = x[c][a + j] * f + x[c][b + u] * r;
      } else for (let c = 0; c < x.length; c++) out[c][i] = x[c][a + j];
      if (++j === len) {
        a = b;
        j = cross;
      }
    }
    this.a = a;
    this.b = b;
    this.j = j;
  }
};
var Grains = class {
  constructor(x, sr, caret) {
    this.x = x;
    this.len = Math.min(x[0].length, 4 * Math.round(0.02 * sr));
    this.every = this.len >> 2;
    this.spread = Math.round(0.015 * sr);
    this.w = hann(this.len);
    this.from = new Int32Array(5);
    this.age = new Int32Array(5).fill(-1);
    this.next = 0;
    this.s = 5369127;
    this.last = caret;
  }
  get at() {
    return this.last;
  }
  render(out, caret) {
    const { x, len, w, from, age } = this, gain = 1 / Math.sqrt(1.5), n = out[0].length, C = x.length;
    for (let i = 0; i < n; i++) {
      if (this.next-- === 0) {
        this.next = this.every - 1;
        const g = age.indexOf(-1);
        this.s = xorshift(this.s);
        this.last = caret;
        if (g >= 0) {
          from[g] = clamp(Math.round(caret - len / 2 + this.s / 2 ** 31 * this.spread), 0, x[0].length - len);
          age[g] = 0;
        }
      }
      for (let c = 0; c < C; c++) out[c][i] = 0;
      for (let g = 0; g < 5; g++) if (age[g] >= 0) {
        const v = w[age[g]] * gain, at = from[g] + age[g];
        for (let c = 0; c < C; c++) out[c][i] += x[c][at] * v;
        if (++age[g] === len) age[g] = -1;
      }
    }
  }
};

// alike.js
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

// frames.js
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
var Random = class extends Frames {
  shape(at) {
    const { x, w, ch, n } = this, h = n / 2 + 1;
    for (let c = 0; c < ch.length; c++) {
      const C = ch[c];
      analyse(x[c], at, w, C.re, C.im);
      for (let k = 0; k < h; k++) {
        C.xr[k] = C.re[k];
        C.xi[k] = C.im[k];
        this.scatter(C, k);
      }
    }
    this.couple();
    for (const C of ch) this.place(C, 0, 0);
  }
};

// voice.js
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

// noisc.js
var UNIFORM = Math.sqrt(3) / 2 ** 31;
var SHAPE = 4;
var KUBO = 2.1468;
var normal = (c) => {
  const z = (1 - c) * (1 - c);
  return 1 / Math.sqrt(c * (1 + 9 * z + 9 * z * z + z * z * z) / (2 - c) ** 7);
};
var Noiscs = class {
  constructor(count, sr, kind = "rice", outs = 1, seed = 1831565813) {
    this.count = count;
    this.sr = sr;
    this.kind = kind;
    this.walks = kind === "fm" || kind === "ou";
    for (const k of ["f", "to", "c", "cNow", "tone", "sine", "band", "sineNow", "bandNow", "jitter", "pole", "walk", "g", "level", "pr", "pi", "span"]) this[k] = new Float64Array(count);
    this.state = new Float64Array(count * 8);
    this.k = 1 - Math.exp(-1 / (0.01 * sr));
    this.s = seed;
    this.outs = outs;
    for (const k of ["toR", "toI", "panR", "panI"]) this[k] = new Float64Array(count * outs);
    if (outs === 1) {
      this.toR.fill(1);
      this.panR.fill(1);
    }
    this.zr = new Float64Array(outs > 1 ? 128 : 0);
    this.zi = new Float64Array(outs > 1 ? 128 : 0);
  }
  // voice j: a line at f Hz, W Hz wide (FWHM), `level` RMS, `tone` of it a sine; `jump` starts it there, from silence
  set(j, f, W, level, tone, jump) {
    const c = 1 - Math.exp(-TAU * Math.max(W / 2 / 0.435, 0.5) / this.sr);
    this.to[j] = f;
    this.c[j] = c;
    if (this.kind === "ou") {
      const \u03C3 = Math.max(W, 0) / KUBO, pole = Math.exp(-TAU * \u03C3 / (SHAPE * this.sr));
      this.pole[j] = pole;
      this.jitter[j] = TAU * \u03C3 * Math.sqrt(1 - pole * pole) / this.sr;
    } else this.jitter[j] = TAU * Math.sqrt(Math.max(W, 0) * this.sr / TAU) / this.sr;
    this.level[j] = level;
    const share = this.tone[j] = this.kind === "rice" ? tone : this.walks ? 1 : 0;
    this.sine[j] = Math.SQRT2 * Math.sqrt(share);
    this.band[j] = Math.sqrt(1 - share);
    if (!jump) return;
    this.s = xorshift(this.s);
    const t = turn(this.s);
    this.f[j] = f;
    this.cNow[j] = c;
    this.g[j] = 0;
    this.sineNow[j] = this.sine[j];
    this.bandNow[j] = this.band[j];
    this.walk[j] = 0;
    this.pr[j] = TURNS[t];
    this.pi[j] = TURNS[t + 1];
    this.state.fill(0, j * 8, j * 8 + 8);
  }
  // Whether voice j sounds in no output, now or to come
  quiet(j) {
    const { outs, toR, toI, panR, panI } = this;
    for (let q = j * outs; q < (j + 1) * outs; q++) if (toR[q] || toI[q] || Math.abs(panR[q]) > 1e-6 || Math.abs(panI[q]) > 1e-6) return false;
    return true;
  }
  // adds every voice into out: one array, or with several outputs, one for each
  render(out) {
    const { f, to, c, cNow, sine, band, sineNow, bandNow, jitter, pole, walk, g, level, pr, pi, state, k, walks, outs, toR, toI, panR, panI } = this, step = TAU / this.sr;
    const many = outs > 1, n = many ? out[0].length : out.length;
    if (many && this.zr.length < n) {
      this.zr = new Float64Array(n);
      this.zi = new Float64Array(n);
    }
    const { zr, zi } = this;
    let s = this.s;
    for (let j = 0; j < this.count; j++) {
      const target = level[j], st = sine[j], bt = band[j];
      if (!target && g[j] < 1e-6) {
        g[j] = 0;
        sineNow[j] = st;
        bandNow[j] = bt;
        cNow[j] = c[j];
        continue;
      }
      if (this.quiet(j)) {
        panR.fill(0, j * outs, (j + 1) * outs);
        panI.fill(0, j * outs, (j + 1) * outs);
        continue;
      }
      const ga = many ? 0 : toR[j];
      let gn = many ? 0 : panR[j];
      f[j] += (to[j] - f[j]) * 0.25;
      const rr = Math.cos(f[j] * step), ri = Math.sin(f[j] * step), ct = c[j], u = UNIFORM * normal(cNow[j]), o = j * 8;
      let r = pr[j], i = pi[j], gg = g[j], e = walk[j], sn = sineNow[j], bn = bandNow[j], cj = cNow[j];
      let i0 = state[o], i1 = state[o + 1], i2 = state[o + 2], i3 = state[o + 3];
      let q0 = state[o + 4], q1 = state[o + 5], q2 = state[o + 6], q3 = state[o + 7];
      if (walks) for (let t = 0, p = pole[j], e0 = jitter[j] * UNIFORM; t < n; t++) {
        s = xorshift(s);
        e = e * p + s * e0;
        const h = e * (0.5 + e * e / 24), q = 1 / (1 + h * h), ec = (1 - h * h) * q, es = 2 * h * q, a = r * rr - i * ri, b = r * ri + i * rr;
        r = a * ec - b * es;
        i = a * es + b * ec;
        gg += (target - gg) * k;
        sn += (st - sn) * k;
        if (many) {
          zr[t] = gg * sn * i;
          zi[t] = -gg * sn * r;
        } else {
          gn += (ga - gn) * k;
          out[t] += gn * (gg * sn * i);
        }
      }
      else if (!bt && bn < 1e-9) for (let t = 0; t < n; t++) {
        const a = r * rr - i * ri;
        i = r * ri + i * rr;
        r = a;
        gg += (target - gg) * k;
        sn += (st - sn) * k;
        if (many) {
          zr[t] = gg * sn * i;
          zi[t] = -gg * sn * r;
        } else {
          gn += (ga - gn) * k;
          out[t] += gn * (gg * sn * i);
        }
      }
      else for (let t = 0; t < n; t++) {
        s = xorshift(s);
        const a = s * u;
        s = xorshift(s);
        const b = s * u;
        cj += (ct - cj) * k;
        i0 += cj * (a - i0);
        i1 += cj * (i0 - i1);
        i2 += cj * (i1 - i2);
        i3 += cj * (i2 - i3);
        q0 += cj * (b - q0);
        q1 += cj * (q0 - q1);
        q2 += cj * (q1 - q2);
        q3 += cj * (q2 - q3);
        const v = r * rr - i * ri;
        i = r * ri + i * rr;
        r = v;
        gg += (target - gg) * k;
        sn += (st - sn) * k;
        bn += (bt - bn) * k;
        if (many) {
          zr[t] = gg * (sn * i + bn * (i3 * r - q3 * i));
          zi[t] = gg * (bn * (i3 * i + q3 * r) - sn * r);
        } else {
          gn += (ga - gn) * k;
          out[t] += gn * (gg * (sn * i + bn * (i3 * r - q3 * i)));
        }
      }
      if (!many) panR[j] = gn;
      else for (let o2 = 0, q = j * outs; o2 < outs; o2++, q++) {
        const y = out[o2], tr = toR[q], ti = toI[q];
        let ar = panR[q], ai = panI[q];
        for (let t = 0; t < n; t++) {
          ar += (tr - ar) * k;
          ai += (ti - ai) * k;
          y[t] += ar * zr[t] - ai * zi[t];
        }
        panR[q] = ar;
        panI[q] = ai;
      }
      const m = 1 / Math.sqrt(r * r + i * i);
      pr[j] = r * m;
      pi[j] = i * m;
      g[j] = gg;
      walk[j] = e;
      sineNow[j] = sn;
      bandNow[j] = bn;
      cNow[j] = cj;
      state[o] = i0;
      state[o + 1] = i1;
      state[o + 2] = i2;
      state[o + 3] = i3;
      state[o + 4] = q0;
      state[o + 5] = q1;
      state[o + 6] = q2;
      state[o + 7] = q3;
    }
    this.s = s;
  }
};
var Voiced = class {
  constructor(sr, { frame = 2048 } = {}) {
    const n = this.n = frame, h = n / 2 + 1;
    this.sr = sr;
    this.hop = n / 4;
    this.lag = 0;
    this.w = hann(n);
    this.re = new Float64Array(n);
    this.im = new Float64Array(n);
    for (const k of ["ar", "ai", "br", "bi", "pw", "ur", "ui"]) this[k] = new Float64Array(h);
    this.into = new Int32Array(h).fill(-1);
    let sum = 0, squares = 0;
    for (const v of this.w) {
      sum += v;
      squares += v * v;
    }
    this.sum = sum;
    this.scale = 2 / (n * squares);
  }
  // Channel x's frame at p: its spectrum A (ar, ai), each bin's power, and its turn over a sample
  hear(x, p) {
    const { re, im, ar, ai, br, bi, pw, ur, ui, n, lag } = this;
    analyse(x, p, this.w, re, im, lag);
    if (lag) unpack(re, im, ar, ai, br, bi);
    for (let k = 0; k <= n / 2; k++) {
      if (!lag) {
        ar[k] = re[k];
        ai[k] = im[k];
      }
      pw[k] = ar[k] * ar[k] + ai[k] * ai[k];
      if (lag) {
        ur[k] = ar[k] * br[k] + ai[k] * bi[k];
        ui[k] = ai[k] * br[k] - ar[k] * bi[k];
      }
    }
  }
  // Every channel's, summed: their powers, and their turns, each weighed by its power
  gather(ms) {
    const { pw, ur, ui, n } = this;
    pw.fill(0);
    ur.fill(0);
    ui.fill(0);
    for (const m of ms) for (let k = 0; k <= n / 2; k++) {
      pw[k] += m.pw[k];
      ur[k] += m.ur[k];
      ui[k] += m.ui[k];
    }
  }
};
function below(cum, f, bin) {
  const last = cum.length - 1, u = clamp(f / bin + 0.5, 0, last), i = Math.min(last - 1, Math.floor(u));
  return cum[i] + (u - i) * (cum[i + 1] - cum[i]);
}
var Bank = class extends Voiced {
  constructor(sr, o = {}, outs = 1, seed) {
    super(sr, o);
    const count = o.bands || 256, lo = 40, hi = Math.min(16e3, 0.45 * sr), r = (hi / lo) ** (1 / (count - 1)), h = this.n / 2 + 1;
    this.low = lo;
    this.step = Math.log(r);
    this.reassign = o.analysis !== "bins";
    this.lag = this.reassign ? 1 : 0;
    this.edges = Float64Array.from({ length: count + 1 }, (_, j) => lo * r ** (j - 0.5));
    this.cum = new Float64Array(h + 1);
    for (const k of ["power", "first", "second"]) this[k] = new Float64Array(count);
    this.voices = [new Noiscs(count, sr, o.line, outs, seed)];
    for (let j = 0; j < count; j++) {
      this.voices[0].set(j, lo * r ** j, this.edges[j + 1] - this.edges[j], 0, 0, true);
      this.voices[0].span[j] = this.edges[j + 1] - this.edges[j];
    }
  }
  // The band a frequency falls in, −1 for none
  band(f) {
    const j = f > 0 ? Math.round(Math.log(f / this.low) / this.step) : -1;
    return j < this.voices[0].count ? j : -1;
  }
  set() {
    const { pw, n, cum, edges, scale, sr, into } = this, bank = this.voices[0], bin = sr / n;
    if (!this.reassign) {
      for (let k = 0; k <= n / 2; k++) {
        cum[k + 1] = cum[k] + pw[k] * scale;
        into[k] = this.band(k * bin);
      }
      for (let j = 0; j < bank.count; j++) bank.level[j] = Math.sqrt(Math.max(0, below(cum, edges[j + 1], bin) - below(cum, edges[j], bin)));
      return;
    }
    const { ur, ui, power, first, second } = this;
    power.fill(0);
    first.fill(0);
    second.fill(0);
    into.fill(-1);
    for (let k = 1; k < n / 2; k++) {
      const P = pw[k] * scale;
      if (!P) continue;
      const f = Math.atan2(ui[k], ur[k]) / TAU * sr, j = this.band(f);
      if (j < 0) continue;
      power[j] += P;
      first[j] += P * f;
      second[j] += P * f * f;
      into[k] = j;
    }
    for (let j = 0; j < bank.count; j++) {
      const P = power[j];
      if (!P) {
        bank.level[j] = 0;
        continue;
      }
      const mean = first[j] / P, spread = Math.sqrt(Math.max(0, second[j] / P - mean * mean)), even = (edges[j + 1] - edges[j]) / Math.sqrt(12);
      bank.set(j, mean, Math.max(1, 2.355 * spread), Math.sqrt(P), clamp(1 - spread / even, 0, 1), false);
    }
  }
};
var LINES = 64;
var Lines = class extends Voiced {
  constructor(sr, o = {}, outs = 1, seed) {
    super(sr, o);
    const h = this.n / 2 + 1;
    this.mag = new Float64Array(h);
    this.lows = new Float64Array(h);
    this.peaks = new Int32Array(h);
    this.owner = new Int32Array(h);
    this.taken = new Uint8Array(h);
    this.order = new Int32Array(h);
    this.claimed = new Uint8Array(2 * LINES);
    this.v = new Float64Array(3);
    const centres = [];
    for (let f = 1e3 * 2 ** (-15 / 3); f < 0.45 * sr; f *= 2 ** (1 / 3)) centres.push(f);
    this.centres = Float64Array.from(centres);
    this.voices = [new Noiscs(2 * LINES, sr, o.line, outs, seed), new Noiscs(centres.length, sr, "band", outs, seed)];
    centres.forEach((f, j) => {
      this.voices[1].set(j, f, f * (2 ** (1 / 6) - 2 ** (-1 / 6)), 0, 0, true);
      this.voices[1].span[j] = f * (2 ** (1 / 6) - 2 ** (-1 / 6));
    });
  }
  set() {
    const { pw, n, mag, lows, peaks, owner, taken, order, claimed, v, centres, scale, sum, into } = this, h = n / 2 + 1;
    const lines = this.voices[0], floor = this.voices[1], bin = this.sr / n;
    for (let k = 0; k < h; k++) mag[k] = Math.sqrt(pw[k]);
    const count = regions(mag, peaks, owner, lows);
    let m = 0;
    for (let i = 0; i < count; i++) {
      if (mag[peaks[i]] < TONAL * lows[i]) continue;
      let j = m++;
      while (j > 0 && mag[peaks[order[j - 1]]] < mag[peaks[i]]) {
        order[j] = order[j - 1];
        j--;
      }
      order[j] = i;
    }
    m = Math.min(m, LINES);
    taken.fill(0);
    claimed.fill(0);
    into.fill(-1);
    for (let i = 0; i < m; i++) {
      const k = peaks[order[i]];
      vertex(mag, k, v);
      const f = v[0] * bin, rms = Math.SQRT2 * v[1] / sum, excess = Math.sqrt(Math.max(0, v[2] * v[2] - 1.44 * 1.44));
      const tone = clamp(1 - excess / 1.44, 0, 1);
      explained(mag, owner, order[i], k, v[0], v[1], taken);
      let best = -1, near = 0.03;
      for (let j = 0; j < lines.count; j++) {
        if (claimed[j] || !(lines.level[j] || lines.g[j] > 1e-6)) continue;
        const d = Math.abs(Math.log(lines.to[j] / f));
        if (d < near) {
          near = d;
          best = j;
        }
      }
      const jump = best < 0;
      if (jump) {
        for (let j = 0; j < lines.count && best < 0; j++) if (!claimed[j] && !lines.level[j] && lines.g[j] <= 1e-6) best = j;
      }
      if (best < 0) continue;
      claimed[best] = 1;
      lines.set(best, f, Math.max(1, excess * bin), rms, tone, jump);
      for (let j = k; j >= 0 && owner[j] === order[i]; j--) if (taken[j] && into[j] < 0) into[j] = best;
      for (let j = k + 1; j < h && owner[j] === order[i]; j++) if (taken[j] && into[j] < 0) into[j] = best;
    }
    for (let j = 0; j < lines.count; j++) if (!claimed[j]) lines.level[j] = 0;
    for (let j = 0; j < centres.length; j++) {
      const lo = centres[j] * 2 ** (-1 / 6) / bin, hi = centres[j] * 2 ** (1 / 6) / bin;
      let power = 0, bins = 0;
      for (let k = Math.ceil(lo); k <= Math.min(h - 1, Math.floor(hi)); k++) if (!taken[k]) {
        power += mag[k] * mag[k];
        bins++;
        into[k] = lines.count + j;
      }
      if (!bins && hi - lo < 1) {
        const k = Math.min(h - 1, Math.round(centres[j] / bin));
        if (!taken[k]) {
          power = mag[k] * mag[k];
          bins = 1;
          into[k] = lines.count + j;
        }
      }
      floor.level[j] = bins ? Math.sqrt(power / bins * (hi - lo) * scale) : 0;
    }
  }
};
var Layers = class {
  constructor(Method, x, sr, caret, o = {}) {
    const C = x.length, seed = (i) => i ? 1831565813 ^ Math.imul(i, 2654435769) | 1 : 1831565813;
    this.x = x;
    this.own = x.map((_, c) => new Method(sr, o, 1, seed(c)));
    this.joint = C > 1 ? new Method(sr, o, C, seed(C)) : null;
    this.alike = C > 1 ? new Alike(x, this.own[0].n) : null;
    this.spectra = this.own.map((m) => [m.ar, m.ai]);
    this.likeness = new Float64Array(4);
    let count = 0;
    this.first = this.own[0].voices.map((v) => (count += v.count) - v.count);
    this.whole = new Float64Array(count * C);
    this.part = new Float64Array(count * C);
    this.kappa = new Float64Array(C * (this.own[0].n / 2 + 1));
    this.lo = new Int32Array(count);
    this.hi = new Int32Array(count);
    this.hop = this.own[0].hop;
    this.k = this.hop;
    this.p = Math.round(caret);
  }
  get at() {
    return this.p;
  }
  render(out, caret) {
    const { own, joint, x } = this, C = x.length;
    if (this.k >= this.hop) {
      this.k = 0;
      const p = clamp(Math.round(caret), 0, x[0].length - 1), moved = Math.abs(p - this.p);
      this.p = p;
      for (let c = 0; c < C; c++) own[c].hear(x[c], p);
      if (joint) {
        joint.gather(own);
        this.alike.follow(p, moved, this.spectra);
        joint.set();
      }
      for (let c = 0; c < C; c++) own[c].set();
      if (joint) this.weigh();
    }
    this.k += out[0].length;
    for (let c = 0; c < C; c++) {
      const y = out[c], voices = own[c].voices;
      y.fill(0);
      for (let i = 0; i < voices.length; i++) voices[i].render(y);
    }
    if (joint) for (let i = 0; i < joint.voices.length; i++) joint.voices[i].render(out);
  }
  // Each channel's share of each bin's power that it holds in common with the others, κ: its coherence γ with the
  // loudest channel there (over the WIDTH bins either side, as the vocoder reads it), and the loudest's as much as its
  // likest. Two channels share γ of their power each, whichever is louder, so what one oscillator plays into both is
  // γ coherent, as they are; the loudest taking all of its own, bins where the loudest changes (two unrelated noises
  // as loud as each other) would put both channels' power into one oscillator, and make them alike. A tone is shared
  // whole or not at all, as it is more alike than not: a sine is in both channels or in one, and two oscillators each
  // playing part of it at one frequency would sum as their phases fall (a lone sine with a 20 % share lost 5 dB);
  // what makes a tone partly alike, a reverb's tail of it, is noise, and noise shares as it is.
  shares() {
    const { own, joint, alike, kappa, likeness, first } = this, C = own.length, h = own[0].n / 2 + 1, voices = joint.voices;
    for (let k = 0; k < h; k++) {
      const from = Math.max(0, k - WIDTH), to = Math.min(h - 1, k + WIDTH), ref = alike.loudest(from, to), id = joint.into[k];
      let most = 0;
      for (let c = 0; c < C; c++) if (c !== ref) most = Math.max(most, kappa[c * h + k] = Math.sqrt(alike.likeness(c, ref, from, to, likeness)));
      kappa[ref * h + k] = most;
      if (id < 0) continue;
      let b = voices.length - 1;
      while (first[b] > id) b--;
      if (voices[b].tone[id - first[b]] > 0.5) for (let c = 0; c < C; c++) kappa[c * h + k] = kappa[c * h + k] > 0.5 ? 1 : 0;
    }
  }
  // Over the bins each of m's voices took: their first and last, and each channel's power there, all of it (`whole`)
  // and the part it shares (`part`), or with `alone`, only channel c's and only what it does not share
  gauge(m, alone = -1) {
    const { own, kappa, whole, part, lo, hi } = this, C = own.length, into = m.into, h = into.length;
    lo.fill(h);
    hi.fill(-1);
    whole.fill(0);
    part.fill(0);
    for (let k = 0; k < h; k++) {
      const id = into[k];
      if (id < 0) continue;
      if (k < lo[id]) lo[id] = k;
      if (k > hi[id]) hi[id] = k;
      for (let c = 0; c < C; c++) {
        if (alone >= 0 && c !== alone) continue;
        const p = own[c].pw[k], \u03BA = kappa[c * h + k];
        whole[id * C + c] += p;
        part[id * C + c] += alone >= 0 ? p * (1 - \u03BA) : p * \u03BA;
      }
    }
  }
  // Each voice's gains. A shared voice goes to every channel as the share of its power that channel holds with the
  // others, over the bins it took, at the channel's phase against the loudest there; a channel's own voice carries the
  // rest. A voice that took no bins this hop keeps its gains as it fades.
  weigh() {
    const { own, joint, alike, likeness, whole, part, lo, hi, first } = this, C = own.length, last = own[0].n / 2;
    this.shares();
    this.gauge(joint);
    for (let b = 0; b < joint.voices.length; b++) {
      const v = joint.voices[b];
      for (let j = 0; j < v.count; j++) {
        const id = first[b] + j;
        if (!v.level[j] || hi[id] < lo[id]) continue;
        const from = Math.max(0, lo[id] - 1), to = Math.min(last, hi[id] + 1), ref = alike.loudest(from, to);
        let all = 0;
        for (let c = 0; c < C; c++) all += whole[id * C + c];
        for (let c = 0, q = j * C; c < C; c++, q++) {
          const r = all > 0 ? Math.sqrt(part[id * C + c] / all) : 0;
          if (c === ref || !r) {
            v.toR[q] = r;
            v.toI[q] = 0;
            continue;
          }
          alike.likeness(c, ref, from, to, likeness);
          const size = Math.hypot(likeness[0], likeness[1]);
          v.toR[q] = size ? r * likeness[0] / size : r;
          v.toI[q] = size ? r * likeness[1] / size : 0;
        }
      }
    }
    for (let c = 0; c < C; c++) {
      this.gauge(own[c], c);
      for (let b = 0; b < own[c].voices.length; b++) {
        const v = own[c].voices[b];
        for (let j = 0; j < v.count; j++) {
          const id = first[b] + j;
          if (!v.level[j] || hi[id] < lo[id]) continue;
          const alone = whole[id * C + c] > 0 ? part[id * C + c] / whole[id * C + c] : 0, tone = v.kind === "rice" ? v.tone[j] * alone : v.tone[j];
          v.toR[j] = Math.sqrt(alone);
          v.sine[j] = Math.SQRT2 * Math.sqrt(tone);
          v.band[j] = Math.sqrt(1 - tone);
        }
      }
    }
  }
};

// index.js
var methods = {
  tape: { name: "Tape", make: (x, sr, caret) => new Tape(x, sr, caret) },
  loop: { name: "Loop", make: (x, sr, caret) => new Loop(x, sr, caret) },
  grains: { name: "Grains", make: (x, sr, caret) => new Grains(x, sr, caret) },
  bank: { name: "Noisc bank", make: (x, sr, caret, o) => new Layers(Bank, x, sr, caret, o) },
  lines: { name: "Noisc lines", make: (x, sr, caret, o) => new Layers(Lines, x, sr, caret, o) },
  random: { name: "Random phase", make: (x, sr, caret, o) => new Random(x, sr, caret, o) },
  vocoder: { name: "Vocoder", make: (x, sr, caret, o) => new Voice(x, sr, caret, o, false) },
  hybrid: { name: "Vocoder + noise", make: (x, sr, caret, o) => new Voice(x, sr, caret, o, true) }
};
function scrub(channels, sampleRate, caret = 0, { method = "hybrid", ...o } = {}) {
  const m = methods[method];
  if (!m) throw Error(`Unknown method ${method}: one of ${Object.keys(methods).join(", ")}`);
  return m.make(channels, sampleRate, caret, o);
}
export {
  scrub as default,
  methods
};
