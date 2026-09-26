/**
 * Spectral edit and repair: time × frequency regions, the cough / phone-ring / squeak class.
 *
 * a.spectral([1000, 4000], -30, { at: 2.1, duration: 0.3 })  → -30 dB in 1–4 kHz for 300 ms
 * a.spectral([6000, 9000], { at: 5, duration: 0.2 })          → remove the band there (default gain: off)
 * a.repair({ at: 1.2, duration: 0.05 })                         → rebuild a dropout from its surroundings
 * a.repair([0, 3000], { at: 1.2, duration: 0.05 })              → rebuild only that band
 *
 * `band` is [low, high] in Hz (default: full band); the time range is the op's own at/duration
 * (spectral default: all of it; repair requires one). Both stream with bounded latency, so a
 * cough edited into a days-long stream costs its own seconds, not the stream's:
 * - spectral: an STFT (@audio/stft stream, 2048/512, the frames of @audio/spectral-edit) engaged
 *   only while frames can touch the region, delayed passthrough elsewhere; latency one frame.
 * - repair: the damaged range plus two frames of context each side, repaired once by
 *   @audio/denoise-repair (log-magnitude interpolation, phase advanced from the leading context)
 *   and spliced into a delay line; latency = the range + context.
 */
import audio from '../core.js'

const N = 2048, HOP = N / 4

/** Absolute region [s0, s1) in samples and band [f0, f1] in Hz; ranged op, so ctx.at is block-relative. */
function region(ctx) {
  let sr = ctx.sampleRate, s0 = -Infinity, s1 = Infinity
  if (ctx.at != null) s0 = Math.round((ctx.at + (ctx.blockOffset || 0)) * sr)
  if (ctx.duration != null) s1 = Math.max(s0, 0) + Math.round(ctx.duration * sr)
  let [f0 = 0, f1 = sr / 2] = ctx.band ?? []
  return { s0, s1, f0, f1 }
}

/** Per-channel delay line of D samples: returns the sample D earlier, stores x. */
const delay = D => { let b = new Float32Array(D), i = 0; return x => { let y = b[i]; b[i] = x; if (++i === D) i = 0; return y } }

/** Where the STFT engages and what it replaces, for a render that began at n: on the batch
 *  kernel's frame grid, early enough that every frame touching the region is whole (or at the
 *  first grid point reached, when rendering starts mid-region). */
function place(ctx, n) {
  let sr = ctx.sampleRate, { s0, s1, f0, f1 } = region(ctx)
  let e0 = Math.max(Number.isFinite(s0) ? s0 - 2 * N : 0, 0, n)
  return {
    s0, s1, k0: Math.max(0, Math.floor(f0 * N / sr)), k1: Math.min(N / 2, Math.ceil(f1 * N / sr)),
    g: ctx.gain == null ? 0 : 10 ** (ctx.gain / 20),
    e0: Math.ceil(e0 / HOP) * HOP, e1: s1 + 3 * N, u0: s0 - N, u1: s1 + N,
  }
}

function spectral(input, output, ctx) {
  let nch = input.length, len = input[0].length, sr = ctx.sampleRate
  let st = ctx._sp ??= { n: Math.round((ctx.blockOffset || 0) * sr), dl: Array.from({ length: nch }, () => delay(N)), sp: null, q: null, qAt: 0, done: false }
  st.n0 ??= st.n
  // a range counted from a live stream's end moves with it until the STFT engages (the engine
  // holds output back so it engages only once the end is known)
  if (!st.sp && !st.done) Object.assign(st, place(ctx, st.n0))
  let n0 = st.n, end = n0 + len
  if (!st.sp && st.e0 >= n0 && st.e0 < end && st.e0 < st.e1) {
    let { stftStream } = audio.op('spectral').mod, at = st.e0, { s0, s1, k0, k1, g } = st
    st.sp = Array.from({ length: nch }, () => {
      let frame = 0
      return stftStream((mag, phase) => {
        let mid = at + frame++ * HOP + N / 2
        if (mid >= s0 && mid <= s1) for (let k = k0; k <= k1; k++) mag[k] *= g
        return { mag, phase }
      }, { fs: sr, frameSize: N, hopSize: HOP })
    })
    st.q = st.sp.map(() => []); st.qAt = at
  }
  if (st.sp) {
    let a = Math.max(n0, st.qAt), b = Math.min(end, st.e1)
    if (b > a) for (let c = 0; c < nch; c++) { let e = st.sp[c].write(input[c].subarray(a - n0, b - n0)); for (let k = 0; k < e.length; k++) st.q[c].push(e[k]) }
  }
  for (let i = 0; i < len; i++) {
    let j = n0 + i - N, s = st.sp && j >= st.u0 && j < st.u1 && j >= st.qAt
    for (let c = 0; c < nch; c++) {
      let x = st.dl[c](input[c][i])
      output[c][i] = s ? st.q[c][j - st.qAt] : x
    }
  }
  st.n = end
  if (st.sp) {
    let done = end - N - st.qAt  // output samples the queue no longer needs
    if (end - N >= st.e1) { st.sp = st.q = null; st.done = true }  // past the region: back to plain delay
    else if (done > 1 << 16) { st.q = st.q.map(q => q.slice(done)); st.qAt += done }
  }
}

audio.op('spectral', {
  params: ['band', 'gain'],
  ranged: true,
  latency: N,
  warmup: 3 * N,  // a render starting inside the region begins where the STFT engages
  load: () => import('@audio/stft'),
  process: spectral,
})

// Context either side of a repaired range: the frames the kernel interpolates from
const C = 2 * N

function repair(input, output, ctx) {
  let nch = input.length, len = input[0].length, sr = ctx.sampleRate
  let st = ctx._rp
  if (!st) {
    if (ctx.at == null || ctx.duration == null) throw new RangeError('repair: needs the damaged time range, e.g. {at: 1.2, duration: 0.05}')
    let D = Math.round(ctx.duration * sr) + 3 * N
    st = ctx._rp = { n: Math.round((ctx.blockOffset || 0) * sr), D, dl: Array.from({ length: nch }, () => delay(D)), w: null, out: null, done: false }
  }
  // window [c0, c1) holds the range with 2N of context; [u0, u1) is spliced back. A range counted
  // from a live stream's end moves with it until collection starts (output is held back till then)
  if (!st.done && !st.w) {
    let { s0, s1, f0, f1 } = region(ctx), c0 = Math.max(0, s0 - C), c1 = s1 + C
    Object.assign(st, { s0, s1, f0, f1, c0, c1, u0: Math.max(0, s0 - N), u1: s1 + N })
  }
  let repairFn = audio.op('repair').mod.default
  for (let i = 0; i < len; i++, st.n++) {
    let n = st.n, j = n - st.D
    if (!st.done && n >= st.c0 && n < st.c1) {
      st.w ??= Array.from({ length: nch }, () => new Float32Array(st.c1 - st.c0))
      for (let c = 0; c < nch; c++) st.w[c][n - st.c0] = input[c][i]
    }
    if (!st.done && n === st.c1 - 1) {
      let reg = { at: (st.s0 - st.c0) / sr, duration: (st.s1 - st.s0) / sr, from: st.f0, to: st.f1 }
      st.out = st.w.map(w => repairFn(w, { fs: sr, regions: [reg] }))
      st.w = null; st.done = true
    }
    for (let c = 0; c < nch; c++) {
      let x = st.dl[c](input[c][i])
      output[c][i] = st.out && j >= st.u0 && j < st.u1 ? st.out[c][j - st.c0] : x
    }
    if (j >= st.u1) st.out = null
  }
}

audio.op('repair', {
  params: ['band'],
  ranged: true,
  latency: (o, sr) => o.duration != null ? Math.round(o.duration * sr) + 3 * N : 0,
  warmup: (o, sr) => o.duration != null ? Math.round(o.duration * sr) + 3 * N : 0,  // the window's leading context
  load: () => import('@audio/denoise-repair'),
  process: repair,
})
