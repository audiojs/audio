/**
 * Meter — playback-time streaming stat emission.
 * Listener-gated (zero cost when nothing subscribes).
 * Subscribers via a.on('meter', cb, opts). See README "Meter" section.
 */

import audio from '../core.js'
import { melSpectrum } from './spectrum.js'

let rAbsMax = (a, b) => Math.max(Math.abs(a), Math.abs(b))

/** Resolve channel selector (opts.channel) → indices. Mirrors stat.js semantics. */
function resolveChs(channel, ch) {
  if (channel == null) return { chs: Array.from({ length: ch }, (_, i) => i), perCh: false }
  if (Array.isArray(channel)) return { chs: channel, perCh: true }
  return { chs: [channel], perCh: false }
}

/** Compute per-block value of a named stat from raw block stats, honoring channel semantics. */
function frameValue(name, raw, blockChs, sr, opts) {
  let ch = blockChs.length
  let { chs, perCh } = resolveChs(opts?.channel, ch)

  if (name === 'spectrum') {
    let N = opts?.N ?? 1024  // FFT size (must be pow2)
    let src = blockChs[0], input
    if (src.length >= N) input = src.subarray(0, N)
    else { input = new Float32Array(N); input.set(src) }
    let spec = melSpectrum(input, sr, {
      bins: opts?.bins ?? 128, fMin: opts?.fMin, fMax: opts?.fMax, weight: opts?.weight
    })
    if (opts?.db) { for (let i = 0; i < spec.length; i++) spec[i] = 20 * Math.log10(spec[i] + 1e-10) }
    return spec
  }

  let desc = audio.stat(name)
  if (!desc) throw new Error(`Unknown meter stat: '${name}'`)

  // Pseudo-stats: wrap each raw block value as single-element Float32Array so existing query fns work
  let pseudo = { blockSize: blockChs[0].length }
  for (let n in raw) pseudo[n] = raw[n].map(v => Float32Array.of(v))

  if (desc.query) {
    return perCh ? chs.map(c => desc.query(pseudo, [c], 0, 1, sr, opts))
                 : desc.query(pseudo, chs, 0, 1, sr, opts)
  }
  if (raw[name]) {
    if (perCh) return chs.map(c => raw[name][c])
    if (chs.length === 1) return raw[name][chs[0]]
    let s = 0; for (let c of chs) s += raw[name][c]
    return s / chs.length
  }
  throw new Error(`No frame computation for stat: '${name}'`)
}

/** In-place one-pole EMA: prev += α · (cur − prev). Supports number, array, TypedArray. */
function smooth(cur, prev, alpha) {
  if (typeof cur === 'number') return prev + alpha * (cur - prev)
  let out = cur.constructor === Array ? cur.slice() : new cur.constructor(cur.length)
  for (let i = 0; i < cur.length; i++) out[i] = prev[i] + alpha * (cur[i] - prev[i])
  return out
}

/** Peak-hold decay: max(cur, prev · (1−α)). */
function holdDecay(cur, prev, alpha) {
  if (typeof cur === 'number') return Math.max(cur, prev * (1 - alpha))
  let out = cur.constructor === Array ? cur.slice() : new cur.constructor(cur.length)
  for (let i = 0; i < cur.length; i++) out[i] = Math.max(cur[i], prev[i] * (1 - alpha))
  return out
}

/** Compute all block-level stat values once per frame. Returns { [name]: perChannelArray }. */
function computeRawBlock(blockChs, sr) {
  let raw = {}, ch = blockChs.length
  for (let [name, desc] of Object.entries(audio.stat())) {
    if (!desc.block) continue
    let v = desc.block(blockChs, { sampleRate: sr })
    raw[name] = typeof v === 'number' ? Array(ch).fill(v) : v
  }
  return raw
}

/** Dispatch meter event for one playback block. Called from playback loop. */
export function emitMeter(a, blockChs, offset) {
  let subs = a._.ev.meter
  if (!subs?.length) return

  let sr = a.sampleRate, blockLen = blockChs[0].length, blockDur = blockLen / sr
  let raw = null

  for (let sub of subs) {
    let opts = sub._opts
    if (!opts) {
      // Generic listener — emit {delta, offset} shaped like decode's 'data' event
      if (!raw) raw = computeRawBlock(blockChs, sr)
      let delta = { fromBlock: 0 }
      for (let n in raw) delta[n] = raw[n].map(v => Float32Array.of(v))
      sub({ delta, offset })
      continue
    }

    let { type, smoothing, hold } = opts
    let types = Array.isArray(type) ? type : [type]

    // Lazy: only compute raw block stats if any non-spectrum type is requested
    if (types.some(t => t !== 'spectrum') && !raw) raw = computeRawBlock(blockChs, sr)

    let values = {}
    for (let t of types) values[t] = frameValue(t, raw, blockChs, sr, opts)

    // Per-listener smoothing state (one-pole EMA, τ in seconds)
    if (smoothing) {
      let alpha = 1 - Math.exp(-blockDur / smoothing)
      sub._smooth ??= {}
      for (let t of types) {
        let prev = sub._smooth[t]
        if (prev == null) sub._smooth[t] = values[t]
        else sub._smooth[t] = values[t] = smooth(values[t], prev, alpha)
      }
    }
    // Peak-hold decay (τ = time for held peak to decay by 1/e)
    if (hold) {
      let alpha = 1 - Math.exp(-blockDur / hold)
      sub._hold ??= {}
      for (let t of types) {
        let prev = sub._hold[t]
        if (prev == null) sub._hold[t] = values[t]
        else sub._hold[t] = values[t] = holdDecay(values[t], prev, alpha)
      }
    }

    // Emit: string type → value directly, array type → object keyed by name
    sub(typeof type === 'string' ? values[type] : values)
  }
}
