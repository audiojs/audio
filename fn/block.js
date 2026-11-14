/**
 * The block pass: every field the stats index keeps of a block, measured in one pass over it: its levels, which
 * fn/stat.js names (min, max, dc, clipping, ms, correlation), and its K-weighted energy, which fn/loudness.js names
 * (energy, kcut1, kcut2): one block function for all of them (stats.js blockGroups), so one pass. A session measures
 * the whole blocks it is given a run at a time (`many`), the meter and a short last block one at a time. A WebAssembly
 * SIMD kernel (block.wat) where it runs, two channels at a time, the bookkeeping of a run in one call; elsewhere, and
 * for blocks it does not take, levels() and kweighted() in JS: the same float ops in the same order, the same bits.
 * Over twice as fast as those in V8 on stereo: the kernel runs at the K-weighting filter's latency, the rest in its
 * shadow.
 */
import audio, { FULL } from '../core.js'
import kWeighting from '@audio/weighting/k'

const FULL2 = FULL * FULL

/** Samples in a 100 ms step, where BS.1770-5's gating blocks start (Annex 1, eq. 3): libebur128 rounds the same way, so
 *  windows are 4 (400 ms) and 30 (3 s) steps. */
export const stepOf = sr => Math.round(sr * 0.1)

/** Every field of a block, `ctx` its filter's state and its place from block to block */
export function block(chs, ctx) {
  let r = measure(chs, ctx, chs[0].length, 1)
  if (!r) return { ...levels(chs), ...kweighted(chs, ctx) }
  let one = v => Array.from(chs, (_, c) => v[c][0])
  return { min: one(r.min), max: one(r.max), dc: one(r.dc), clipping: one(r.clipping), ms: one(r.ms), correlation: r.correlation[0][0],
    energy: one(r.energy), kcut1: one(r.kcut1), kcut2: one(r.kcut2) }
}

/** A run of whole blocks of bs samples at once (stats.js): each field, a channel's values, a block each, read before the
 *  next call; null where the kernel does not take them (the session measures them one by one then) */
block.many = (chs, ctx, bs) => measure(chs, ctx, bs, chs[0].length / bs)
// false: the JS loops, as where WebAssembly SIMD does not run; the same bits either way
block.simd = true

// What the kernel takes at a time: blocks of samples a channel, up to RUN, after its arguments (at 0) and state
const RUN = 1 << 16, X = 256

// The fields' values, a block each a channel: kept from call to call, as many blocks and channels as asked so far
const FIELDS = ['min', 'max', 'dc', 'clipping', 'ms', 'correlation', 'energy', 'kcut1', 'kcut2']
let held = null
function room(nch, m) {
  if (held?.nch >= nch && held.m >= m) return held.out
  nch = Math.max(nch, held?.nch ?? 0); m = Math.max(m, held?.m ?? 0, 64)
  held = { nch, m, out: Object.fromEntries(FIELDS.map(f => [f, Array.from({ length: nch }, () => new Float64Array(m))])) }
  return held.out
}

/** The kernel's measure of m blocks of bs samples of float32 channels, two at a time (an odd one paired with itself):
 *  each field a channel's values, a block each; null where it does not run, or for other arrays */
function measure(chs, ctx, bs, m) {
  let nch = chs.length, r = Math.max(1, Math.min(m, Math.floor(RUN / bs))), S = r * bs, Y = X + S * 4, C = X + S * 8, O = (C + r * 8 + 15) & ~15
  for (let c = 0; c < nch; c++) if (!(chs[c] instanceof Float32Array) || chs[c].length !== bs * m) return null
  let w = block.simd && kernel(O + r * 144)
  if (!w) return null
  let { f32, f64, i32 } = w, k = ctx.k ??= { fs: ctx.sampleRate }, st = k.states ??= [], H = stepOf(ctx.sampleRate), p0 = ctx.pos ?? 0
  let [c, d] = ctx.sos ??= kWeighting.coefs(k.fs || 48000)
  f64[0] = c.b0; f64[1] = c.b1; f64[2] = c.b2; f64[3] = c.a1; f64[4] = c.a2
  f64[5] = d.b0; f64[6] = d.b1; f64[7] = d.b2; f64[8] = d.a1; f64[9] = d.a2; f64[10] = FULL2
  let out = room(nch, m)
  for (let a = 0; a < nch; a += 2) {
    let b = a + 1 < nch ? a + 1 : a, sa = st[a] ??= new Float64Array(4), sb = st[b] ??= new Float64Array(4)
    for (let j = 0; j < 4; j++) { f64[12 + 2 * j] = sa[j]; f64[13 + 2 * j] = sb[j] }
    for (let i0 = 0; i0 < m; i0 += r) {
      let n = Math.min(r, m - i0)
      // where the 100 ms grid cuts each block (bs, bs: nowhere)
      for (let i = 0; i < n; i++) {
        let first = firstCut(p0 + (i0 + i) * bs, H), cut = first < bs
        i32[C / 4 + 2 * i] = cut ? first : bs; i32[C / 4 + 2 * i + 1] = cut ? lastCut(first, bs, H) : bs
      }
      f32.set(chs[a].subarray(i0 * bs, (i0 + n) * bs), X / 4)
      if (b !== a) f32.set(chs[b].subarray(i0 * bs, (i0 + n) * bs), Y / 4)
      w.blocks(X, b !== a ? Y : X, n, bs, C, 0, O)
      for (let i = 0; i < n; i++) {
        let o = O / 8 + i * 18, first = i32[C / 4 + 2 * i], last = i32[C / 4 + 2 * i + 1], at = i0 + i
        for (let j = 0, ch = a; ch <= b; j++, ch++) {
          out.min[ch][at] = f64[o + j]; out.max[ch][at] = f64[o + 2 + j]; out.dc[ch][at] = f64[o + 4 + j] / bs
          out.ms[ch][at] = f64[o + 6 + j] / bs; out.clipping[ch][at] = f64[o + 8 + j]
          // as kweighted() adds them: each part's mean square times its length
          if (first === bs) { out.energy[ch][at] = f64[o + 10 + j] / bs; out.kcut1[ch][at] = out.kcut2[ch][at] = 0; continue }
          let e = f64[o + 10 + j] / first * first
          out.kcut1[ch][at] = e
          if (last > first) e += f64[o + 12 + j] / (last - first) * (last - first)
          out.kcut2[ch][at] = e
          e += f64[o + 14 + j] / (bs - last) * (bs - last)
          let u = e * audio.BLOCK_SIZE / bs
          out.kcut1[ch][at] = u > 0 ? out.kcut1[ch][at] / u : 0; out.kcut2[ch][at] = u > 0 ? out.kcut2[ch][at] / u : 0
          out.energy[ch][at] = e / bs
        }
        // the first two channels', every channel's (as levels() gives it, one number), none for one channel
        if (a === 0) for (let ch = 0, xy = b !== a ? f64[o + 16] / bs : 0; ch < nch; ch++) out.correlation[ch][at] = xy
      }
    }
    for (let j = 0; j < 4; j++) { sa[j] = f64[12 + 2 * j]; sb[j] = f64[13 + 2 * j] }
  }
  ctx.pos = p0 + m * bs
  return out
}

// block.wat, compiled by wat2wasm (810 bytes)
const WASM = new Uint8Array([
  0,97,115,109,1,0,0,0,1,11,1,96,7,127,127,127,127,127,127,127,0,3,2,1,0,5,3,1,0,1,7,19,2,6,109,101,109,111,114,121,2,
  0,6,98,108,111,99,107,115,0,0,10,244,5,1,241,5,4,4,127,12,123,1,124,14,123,32,5,253,10,3,0,33,28,32,5,253,10,3,8,33,
  29,32,5,253,10,3,16,33,30,32,5,253,10,3,24,33,31,32,5,253,10,3,32,33,32,32,5,253,10,3,40,33,33,32,5,253,10,3,48,33,
  34,32,5,253,10,3,56,33,35,32,5,253,10,3,64,33,36,32,5,253,10,3,72,33,37,32,5,253,10,3,80,33,21,32,5,253,0,4,96,33,
  24,32,5,253,0,4,112,33,25,32,5,253,0,4,128,1,33,26,32,5,253,0,4,144,1,33,27,253,12,0,0,0,0,0,0,240,63,0,0,0,0,0,0,
  240,63,33,22,32,1,32,0,107,33,1,2,64,32,2,69,13,0,3,64,32,0,33,7,253,12,0,0,0,0,0,0,240,127,0,0,0,0,0,0,240,127,33,
  16,253,12,0,0,0,0,0,0,240,255,0,0,0,0,0,0,240,255,33,17,253,12,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,33,18,253,12,0,0,0,0,
  0,0,0,0,0,0,0,0,0,0,0,0,33,19,253,12,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,33,20,68,0,0,0,0,0,0,0,0,33,23,65,0,33,9,3,64,
  32,7,32,4,40,2,0,32,4,40,2,4,32,3,32,9,65,1,70,27,32,9,69,27,65,2,116,106,33,8,253,12,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,
  0,33,15,2,64,32,0,32,8,79,13,0,3,64,32,0,32,1,106,32,0,253,92,2,0,253,86,2,0,1,253,95,33,11,32,11,32,11,253,242,1,
  33,12,32,16,32,11,253,246,1,33,16,32,17,32,11,253,247,1,33,17,32,18,32,11,253,240,1,33,18,32,19,32,12,253,240,1,33,
  19,32,20,32,12,32,21,253,76,32,22,253,78,253,240,1,33,20,32,23,32,11,32,11,32,11,253,13,8,9,10,11,12,13,14,15,0,1,2,
  3,4,5,6,7,253,242,1,253,33,0,160,33,23,32,28,32,11,253,242,1,32,24,253,240,1,33,13,32,29,32,11,253,242,1,32,31,32,
  13,253,242,1,253,241,1,32,25,253,240,1,33,24,32,30,32,11,253,242,1,32,32,32,13,253,242,1,253,241,1,33,25,32,33,32,
  13,253,242,1,32,26,253,240,1,33,14,32,34,32,13,253,242,1,32,36,32,14,253,242,1,253,241,1,32,27,253,240,1,33,26,32,
  35,32,13,253,242,1,32,37,32,14,253,242,1,253,241,1,33,27,32,15,32,14,32,14,253,242,1,253,240,1,33,15,32,0,65,4,106,
  33,0,32,0,32,8,73,13,0,11,11,32,6,32,9,65,4,116,106,32,15,253,11,4,80,32,9,65,1,106,33,9,32,9,65,3,73,13,0,11,32,6,
  32,16,253,11,4,0,32,6,32,17,253,11,4,16,32,6,32,18,253,11,4,32,32,6,32,19,253,11,4,48,32,6,32,20,253,11,4,64,32,6,
  32,23,57,3,128,1,32,6,65,144,1,106,33,6,32,4,65,8,106,33,4,32,10,65,1,106,33,10,32,10,32,2,73,13,0,11,11,32,5,32,24,
  253,11,4,96,32,5,32,25,253,11,4,112,32,5,32,26,253,11,4,128,1,32,5,32,27,253,11,4,144,1,11,
])

/** The kernel where WebAssembly SIMD runs, null elsewhere, its memory at least `need` bytes */
let simd
function kernel(need) {
  if (simd === undefined) try { simd = { ...new WebAssembly.Instance(new WebAssembly.Module(WASM)).exports } } catch { simd = null }
  if (!simd) return null
  let { memory } = simd
  if (need > memory.buffer.byteLength) memory.grow(Math.ceil((need - memory.buffer.byteLength) / 65536))
  if (simd.f32?.buffer !== memory.buffer) Object.assign(simd, { f32: new Float32Array(memory.buffer), f64: new Float64Array(memory.buffer), i32: new Int32Array(memory.buffer) })
  return simd
}

/** Where the grid of H-sample steps, counted from the start of the stats, cuts a block of n samples at p: first before
 *  `first` (≥ n: nowhere), last before `last` */
const firstCut = (p, H) => (H - p % H) % H || H
const lastCut = (first, n, H) => first + Math.floor((n - 1 - first) / H) * H

/** One pass per channel serves min, max, dc, clipping, ms and correlation (block record). */
function levels(chs) {
  let n = chs[0].length, min = [], max = [], dc = [], clipping = [], ms = [], xy = 0
  for (let c = 0; c < chs.length; c++) {
    let x = chs[c], mn = Infinity, mx = -Infinity, s = 0, q = 0, k = 0
    for (let i = 0; i < n; i++) {
      let v = x[i], v2 = v * v
      if (v < mn) mn = v
      if (v > mx) mx = v
      s += v
      q += v2
      if (v2 >= FULL2) k++  // |v| ≥ full scale, NaN excluded
    }
    min.push(mn); max.push(mx); dc.push(s / n); clipping.push(k); ms.push(q / n)
  }
  if (chs.length > 1) {
    let l = chs[0], r = chs[1]
    for (let i = 0; i < n; i++) xy += l[i] * r[i]
    xy /= n
  }
  return { min, max, dc, clipping, ms, correlation: xy }
}

/** K-weighted mean square of each channel's block (BS.1770-5 eq. 1), and where the 100 ms grid of the gating blocks
 *  cuts it, the grid counted from the start of the stats: `kcut1`, `kcut2`, the block's energy before its first and
 *  before its last cut, over its mean square times the block size (for a whole block, its share). With them the
 *  gating blocks sum exactly from block stats at 5120 Hz and up (two cuts a block at most); a gain scales the mean
 *  square and leaves them. They hold only where blocks move by whole steps (`period`). The filter's state is
 *  @audio/weighting-k's, on `ctx.k.states`, whichever pass measured the block before. */
function kweighted(chs, ctx) {
  let k = ctx.k ??= { fs: ctx.sampleRate }, n = chs[0].length, nch = chs.length, p = ctx.pos ?? 0, H = stepOf(ctx.sampleRate)
  let first = firstCut(p, H), last = lastCut(first, n, H)
  ctx.pos = p + n
  let energy = new Float64Array(nch), kcut1 = new Float64Array(nch), kcut2 = new Float64Array(nch)
  if (first >= n) return { energy: kWeighting.ms(chs, k, energy), kcut1, kcut2 }
  let at = 0, part = new Float64Array(nch)
  const run = to => {
    if (to > at) { kWeighting.ms(chs.map(x => x.subarray(at, to)), k, part); for (let c = 0; c < nch; c++) energy[c] += part[c] * (to - at) }
    at = to
  }
  run(first); kcut1.set(energy)
  run(last); kcut2.set(energy)
  run(n)
  for (let c = 0; c < nch; c++) {
    let u = energy[c] * audio.BLOCK_SIZE / n
    kcut1[c] = u > 0 ? kcut1[c] / u : 0; kcut2[c] = u > 0 ? kcut2[c] / u : 0
    energy[c] /= n
  }
  return { energy, kcut1, kcut2 }
}
