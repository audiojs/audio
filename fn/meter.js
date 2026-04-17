/**
 * Meter — streaming stats during playback.
 * Listener-gated (zero cost when nothing subscribes).
 * Public API: a.meter(what, cb?). See README "Playback → meter".
 */

import audio from '../core.js'
import { melSpectrum } from './spectrum.js'

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
    let N = opts?.N ?? 1024
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

function smooth(cur, prev, alpha) {
  if (typeof cur === 'number') return prev + alpha * (cur - prev)
  let out = cur.constructor === Array ? cur.slice() : new cur.constructor(cur.length)
  for (let i = 0; i < cur.length; i++) out[i] = prev[i] + alpha * (cur[i] - prev[i])
  return out
}

function holdDecay(cur, prev, alpha) {
  if (typeof cur === 'number') return Math.max(cur, prev * (1 - alpha))
  let out = cur.constructor === Array ? cur.slice() : new cur.constructor(cur.length)
  for (let i = 0; i < cur.length; i++) out[i] = Math.max(cur[i], prev[i] * (1 - alpha))
  return out
}

/** Compute all block-level stat values once per frame. */
function computeRawBlock(blockChs, sr) {
  let raw = {}, ch = blockChs.length
  for (let [name, desc] of Object.entries(audio.stat())) {
    if (!desc.block) continue
    let v = desc.block(blockChs, { sampleRate: sr })
    raw[name] = typeof v === 'number' ? Array(ch).fill(v) : v
  }
  return raw
}

/** Dispatch meter to all probes for one playback block. Called from fn/play.js. */
export function emitMeter(a, blockChs, offset) {
  let probes = a._.meters
  if (!probes?.length) return

  let sr = a.sampleRate, blockLen = blockChs[0].length, blockDur = blockLen / sr
  let raw = null

  for (let p of probes) {
    let opts = p.opts
    if (opts.type == null) {
      if (!raw) raw = computeRawBlock(blockChs, sr)
      let delta = { fromBlock: 0 }
      for (let n in raw) delta[n] = raw[n].map(v => Float32Array.of(v))
      let ev = { delta, offset }
      p.value = ev
      if (p.cb) p.cb(ev)
      continue
    }

    let types = Array.isArray(opts.type) ? opts.type : [opts.type]
    if (types.some(t => t !== 'spectrum') && !raw) raw = computeRawBlock(blockChs, sr)

    let values = {}
    for (let t of types) values[t] = frameValue(t, raw, blockChs, sr, opts)

    if (opts.smoothing) {
      let alpha = 1 - Math.exp(-blockDur / opts.smoothing)
      p._smooth ??= {}
      for (let t of types) {
        let prev = p._smooth[t]
        if (prev == null) p._smooth[t] = values[t]
        else p._smooth[t] = values[t] = smooth(values[t], prev, alpha)
      }
    }
    if (opts.hold) {
      let alpha = 1 - Math.exp(-blockDur / opts.hold)
      p._hold ??= {}
      for (let t of types) {
        let prev = p._hold[t]
        if (prev == null) p._hold[t] = values[t]
        else p._hold[t] = values[t] = holdDecay(values[t], prev, alpha)
      }
    }

    let out = typeof opts.type === 'string' ? values[opts.type] : values
    p.value = out
    if (p.cb) p.cb(out)
  }
}

/**
 * a.meter(what, cb?)
 *   what: 'rms' | ['rms','peak'] | { type?, channel?, smoothing?, hold?, bins?, fMin?, fMax?, db?, N? }
 *   cb?:  (value) => void — if omitted, returns probe { value, stop() }
 *   return: probe { value, stop() }  (stop() also works as bare function via probe.stop.bind(probe))
 */
audio.fn.meter = function(what, cb) {
  let opts = (typeof what === 'string' || Array.isArray(what)) ? { type: what }
           : what == null ? {} : what
  let probe = { opts, cb, value: undefined, stop: null }
  probe.stop = () => {
    let arr = this._.meters
    if (!arr) return
    let i = arr.indexOf(probe)
    if (i >= 0) arr.splice(i, 1)
  }
  ;(this._.meters ??= []).push(probe)
  return probe
}
