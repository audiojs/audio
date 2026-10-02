/**
 * Spectral edit and repair: time × frequency regions, the cough / phone-ring / squeak class.
 *
 * a.spectral([1000, 4000], -30, { at: 2.1, duration: 0.3 })  → -30 dB in 1–4 kHz for 300 ms
 * a.spectral([6000, 9000], { at: 5, duration: 0.2 })          → remove the band there (default gain: off)
 * a.repair({ at: 1.2, duration: 0.05 })                         → rebuild a dropout from its surroundings
 * a.repair([0, 3000], { at: 1.2, duration: 0.05 })              → rebuild only that band
 * a.repair({ at: 12, duration: 1, method: 'similarity' })       → transplant the best-matching passage
 *
 * `band` is [low, high] in Hz (default: full band); the time range is the op's own at/duration
 * (spectral default: all of it; repair requires one). Both stream with bounded latency, so a
 * cough edited into a days-long stream costs its own seconds, not the stream's:
 * - spectral: an STFT (@audio/stft stream, 2048/512, the frames of @audio/spectral-edit) engaged
 *   only while frames can touch the region, delayed passthrough elsewhere; latency one frame.
 * - repair: the damaged range plus context, repaired once by @audio/denoise-repair and spliced into
 *   a delay line. `method` 'auto' routes by length and content: a transplant of the passage that joins
 *   seamlessly, searched in the `window` s (10) before the range; failing that, AR interpolation up to
 *   70 ms and a sinusoidal bridge over a matched noise floor beyond. 'ar' | 'sinusoidal' |
 *   'similarity' | 'spectral' force one. The search reads only the past, so latency stays the range
 *   + two frames of trailing context + a frame (at 44.1 kHz: the range + 139 ms); searching the future
 *   too would add the window, for ≤ 0.2 dB LSD (README of @audio/denoise-repair). Memory: the window
 *   + range + two frames per channel (10 s, 1 s, 48 kHz stereo: 4.3 MB). Channels share one decision,
 *   routed on their mix: a transplant copies the same passage into each.
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
  let { s0, s1 } = region(ctx)
  let e0 = Math.max(Number.isFinite(s0) ? s0 - 2 * N : 0, 0, n)
  return { s0, s1, e0: Math.ceil(e0 / HOP) * HOP, e1: s1 + 3 * N, u0: s0 - N, u1: s1 + N }
}

/** An op's STFT over its region (@audio/stft, `stft`; formant.js runs one too): `edit(mag, phase, mid, st, state)`
 *  changes the frame centred on timeline sample `mid` (the region [st.s0, st.s1), `state` the channel's own) and
 *  returns what to resynthesize. Elsewhere the input passes, delayed by N; a frame no edit changes gives its input
 *  back, so the two meet without a seam. */
export function regionStft(input, output, ctx, stft, edit) {
  let nch = input.length, len = input[0].length, sr = ctx.sampleRate
  let st = ctx._sp ??= { n: Math.round((ctx.blockOffset || 0) * sr), dl: Array.from({ length: nch }, () => delay(N)), sp: null, q: null, qAt: 0, done: false }
  st.n0 ??= st.n
  // a range counted from a live stream's end moves with it until the STFT engages (the engine
  // holds output back so it engages only once the end is known)
  if (!st.sp && !st.done) Object.assign(st, place(ctx, st.n0))
  let n0 = st.n, end = n0 + len
  if (!st.sp && st.e0 >= n0 && st.e0 < end && st.e0 < st.e1) {
    let at = st.e0
    st.sp = Array.from({ length: nch }, () => stft.stftStream((mag, phase, state, c) => edit(mag, phase, at + c.pos + N / 2, st, state), { fs: sr, frameSize: N, hopSize: HOP }))
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

// the band's bins [k0, k1] and its gain, scaled in each frame centred in the region
function spectral(input, output, ctx) {
  let sr = ctx.sampleRate, { f0, f1 } = region(ctx), g = ctx.gain == null ? 0 : 10 ** (ctx.gain / 20)
  let k0 = Math.max(0, Math.floor(f0 * N / sr)), k1 = Math.min(N / 2, Math.ceil(f1 * N / sr))
  regionStft(input, output, ctx, audio.op('spectral').mod, (mag, phase, mid, { s0, s1 }) => {
    if (mid >= s0 && mid <= s1) for (let k = k0; k <= k1; k++) mag[k] *= g
    return { mag, phase }
  })
}

audio.op('spectral', {
  params: ['band', 'gain'],
  ranged: true,
  latency: N,
  warmup: 3 * N,  // a render starting inside the region begins where the STFT engages
  load: () => import('@audio/stft'),
  process: spectral,
})

// Context of a repaired range: two frames after it, what the local tiers (AR, sinusoidal, spectral)
// read; before it the same, or the similarity search window when a transplant may be chosen
const C = 2 * N, WINDOW = 10
const past = (o, sr) => (o.method ?? 'auto') === 'auto' || o.method === 'similarity' ? Math.max(C, Math.round((o.window ?? WINDOW) * sr)) : C
// latency: the range, its trailing context, and the frame the splice reaches back; warm-up: the
// range and everything before it the repair reads
const latency = (o, sr) => o.duration != null ? Math.round(o.duration * sr) + C + N : 0
const warmup = (o, sr) => o.duration != null ? Math.round(o.duration * sr) + past(o, sr) + N : 0

function repair(input, output, ctx) {
  let nch = input.length, len = input[0].length, sr = ctx.sampleRate
  let st = ctx._rp
  if (!st) {
    if (ctx.at == null || ctx.duration == null) throw new RangeError('repair: needs the damaged time range, e.g. {at: 1.2, duration: 0.05}')
    let D = latency(ctx, sr)
    st = ctx._rp = { n: Math.round((ctx.blockOffset || 0) * sr), D, P: past(ctx, sr), dl: Array.from({ length: nch }, () => delay(D)), w: null, out: null, done: false }
  }
  // window [c0, c1) holds the range with its context; [u0, u1) is spliced back. A range counted
  // from a live stream's end moves with it until collection starts (output is held back till then)
  if (!st.done && !st.w) {
    let { s0, s1, f0, f1 } = region(ctx), c0 = Math.max(0, s0 - st.P), c1 = s1 + C
    Object.assign(st, { s0, s1, f0, f1, c0, c1, u0: Math.max(0, s0 - N), u1: s1 + N })
  }
  let mod = audio.op('repair').mod
  for (let i = 0; i < len; i++, st.n++) {
    let n = st.n, j = n - st.D
    if (!st.done && n >= st.c0 && n < st.c1) {
      st.w ??= Array.from({ length: nch }, () => new Float32Array(st.c1 - st.c0))
      for (let c = 0; c < nch; c++) st.w[c][n - st.c0] = input[c][i]
    }
    if (!st.done && n === st.c1 - 1) {
      let opts = { fs: sr, method: ctx.method, window: st.P / sr, regions: [{ at: (st.s0 - st.c0) / sr, duration: (st.s1 - st.s0) / sr, from: st.f0, to: st.f1 }] }
      // one decision for all channels, routed on their mix: a transplant copies the same passage in each
      let mix = st.w[0], regions = opts.regions
      if (nch > 1) { mix = new Float32Array(mix.length); for (let w of st.w) for (let k = 0; k < w.length; k++) mix[k] += w[k] / nch }
      if (mod.plan) regions = mod.plan(mix, opts)   // @audio/denoise-repair < 0.2 has one method and no plan
      st.out = st.w.map(w => mod.default(w, { ...opts, regions }).slice(st.u0 - st.c0, st.u1 - st.c0))
      st.w = null; st.done = true
    }
    for (let c = 0; c < nch; c++) {
      let x = st.dl[c](input[c][i])
      output[c][i] = st.out && j >= st.u0 && j < st.u1 ? st.out[c][j - st.u0] : x
    }
    if (j >= st.u1) st.out = null
  }
}

audio.op('repair', {
  params: ['band'],
  ranged: true,
  latency,
  warmup,
  load: () => import('@audio/denoise-repair'),
  process: repair,
})
