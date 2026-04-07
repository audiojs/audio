/**
 * Stats engine — block-level stat computation + unified stat query.
 * Self-registers on import — exposes statSession on audio, adds fn.stat.
 */

import audio, { LOAD } from './core.js'
import { buildPlan, streamPlan } from './history.js'

/** Create a stat computation session. ch inferred from first .page() call. */
function statSession(sr) {
  let fns, acc, ch, last = 0, ctx = { sampleRate: sr }

  function init(c) {
    ch = c
    fns = Object.entries(audio.stat).map(([name, init]) => ({ name, fn: init() }))
    acc = Object.create(null)
    for (let { name } of fns) acc[name] = Array.from({ length: ch }, () => [])
  }

  return {
    page(page) {
      if (!acc) init(page.length)
      for (let off = 0; off < page[0].length; off += audio.BLOCK_SIZE) {
        let end = Math.min(off + audio.BLOCK_SIZE, page[0].length)
        let block = Array.from({ length: ch }, (_, c) => page[c].subarray(off, end))
        for (let { name, fn } of fns) {
          let v = fn(block, ctx)
          if (typeof v === 'number') for (let c = 0; c < ch; c++) acc[name][c].push(v)
          else for (let c = 0; c < ch; c++) acc[name][c].push(v[c])
        }
      }
      return this
    },
    delta() {
      let firstKey = Object.keys(acc)[0]
      if (!firstKey) return
      let cur = acc[firstKey][0].length
      if (cur <= last) return
      let d = { fromBlock: last }
      for (let name in acc) d[name] = acc[name].map(a => new Float32Array(a.slice(last)))
      last = cur
      return d
    },
    done() {
      let out = { blockSize: audio.BLOCK_SIZE }
      for (let name in acc) out[name] = acc[name].map(a => new Float32Array(a))
      return out
    }
  }
}

// ── Bin reduction ────────────────────────────────────────────────

/** Reduce src[from..to] into `bins` bins using `reduce` function. */
function binReduce(src, from, to, bins, reduce, init) {
  let out = new Float32Array(bins), bpp = (to - from) / bins
  for (let i = 0; i < bins; i++) {
    let a = from + Math.floor(i * bpp), b = Math.min(from + Math.floor((i + 1) * bpp), to)
    if (b <= a) b = a + 1
    let v = init
    for (let j = a; j < b; j++) v = reduce(v, src[j])
    out[i] = v === init ? 0 : v
  }
  return out
}

let rMin = (a, b) => b < a ? b : a
let rMax = (a, b) => b > a ? b : a
let rSum = (a, b) => a + b

// ── Aggregate functions ─────────────────────────────────────────

const GATE_WINDOW = 0.4, ABS_GATE = -70, REL_GATE = -10, LUFS_OFFSET = -0.691

/** Compute LUFS from block-level energy. Returns null if audio is silent. */
export function lufsFromEnergy(energy, ch, sampleRate, blockSize, from = 0, to) {
  if (to == null) to = energy[0].length
  let winBlocks = Math.ceil(GATE_WINDOW * sampleRate / blockSize), gates = []
  for (let i = from; i < to; i += winBlocks) {
    let we = Math.min(i + winBlocks, to), sum = 0, n = 0
    for (let c = 0; c < ch; c++) for (let j = i; j < we; j++) { sum += energy[c][j]; n++ }
    if (n > 0) gates.push(sum / n)
  }
  let absT = 10 ** (ABS_GATE / 10), gated = gates.filter(g => g > absT)
  if (!gated.length) return null
  let mean = gated.reduce((a, b) => a + b, 0) / gated.length
  let final = gated.filter(g => g > mean * 10 ** (REL_GATE / 10))
  if (!final.length) return null
  return LUFS_OFFSET + 10 * Math.log10(final.reduce((a, b) => a + b, 0) / final.length)
}

const aggregates = {
  db(stats, ch, from, to) {
    let peak = 0
    for (let c = 0; c < ch; c++)
      for (let i = from; i < Math.min(to, stats.min[c].length); i++)
        peak = Math.max(peak, Math.abs(stats.min[c][i]), Math.abs(stats.max[c][i]))
    return peak > 0 ? 20 * Math.log10(peak) : -Infinity
  },
  rms(stats, ch, from, to) {
    let sum = 0, n = 0
    for (let c = 0; c < ch; c++)
      for (let i = from; i < Math.min(to, stats.rms[c].length); i++) { sum += stats.rms[c][i]; n++ }
    return n ? Math.sqrt(sum / n) : 0
  },
  loudness(stats, ch, from, to, sr) {
    let v = lufsFromEnergy(stats.energy, ch, sr, stats.blockSize, from, to)
    return v ?? -Infinity
  }
}

// ── Measurement from stats (DC-aware, channel-scoped) ───────────

/** Per-channel DC offset from block stats. */
export function dcOffsets(stats, chs) {
  let off = new Float64Array(stats.dc.length)
  for (let c of chs) {
    let sum = 0
    for (let i = 0; i < stats.dc[c].length; i++) sum += stats.dc[c][i]
    off[c] = sum / stats.dc[c].length
  }
  return off
}

/** Peak amplitude in dB after DC removal. Returns null if silent. */
export function peakDb(stats, chs, dcOff) {
  let peak = 0
  for (let c of chs) {
    let d = dcOff?.[c] || 0
    for (let i = 0; i < stats.min[c].length; i++)
      peak = Math.max(peak, Math.abs(stats.min[c][i] - d), Math.abs(stats.max[c][i] - d))
  }
  return peak ? 20 * Math.log10(peak) : null
}

/** RMS level in dB after DC removal. Returns null if silent/missing. */
export function rmsDb(stats, chs, dcOff) {
  if (!stats.rms) return null
  let totalE = 0, n = 0
  for (let c of chs) {
    let d = dcOff?.[c] || 0
    // E[x²] = E[(x-dc)²] + dc²  →  E[(x-dc)²] = E[x²] - dc²
    for (let i = 0; i < stats.rms[c].length; i++) { totalE += stats.rms[c][i] - d * d; n++ }
  }
  return n && totalE > 0 ? 10 * Math.log10(totalE / n) : null
}

/** LUFS loudness level. Returns null if silent. */
export function lufsDb(stats, chs, sampleRate) {
  return lufsFromEnergy(stats.energy, chs.length, sampleRate, stats.blockSize) ?? null
}

/** Bin reduction configs for raw block stats. */
const binConfigs = {
  min: { reduce: rMin, init: Infinity },
  max: { reduce: rMax, init: -Infinity },
  rms: { reduce: rSum, init: 0 },
  energy: { reduce: rSum, init: 0 },
  clip: { reduce: rSum, init: 0 },
  dc: { reduce: rSum, init: 0 }
}

/** Scalar aggregation for raw block stats. */
const scalarAgg = {
  min(src, from, to) { let v = Infinity; for (let i = from; i < to; i++) if (src[i] < v) v = src[i]; return v === Infinity ? 0 : v },
  max(src, from, to) { let v = -Infinity; for (let i = from; i < to; i++) if (src[i] > v) v = src[i]; return v === -Infinity ? 0 : v },
  energy(src, from, to) { let s = 0, n = 0; for (let i = from; i < to; i++) { s += src[i]; n++ } return n ? Math.sqrt(s / n) : 0 },
  clip(src, from, to) { let s = 0; for (let i = from; i < to; i++) s += src[i]; return s },
  dc(src, from, to) { let s = 0, n = 0; for (let i = from; i < to; i++) { s += src[i]; n++ } return n ? s / n : 0 }
}

// ── Self-register ────────────────────────────────────────────────

audio.statSession = statSession

/** Resolve block range from opts. Recomputes stats if edits are dirty. */
async function queryRange(inst, opts) {
  await inst[LOAD]()
  if (inst.edits?.length && inst._.statsV !== inst.version) {
    if (!inst._.srcStats) inst._.srcStats = inst.stats
    let plan = buildPlan(inst)
    let s = statSession(inst.sampleRate); for (let chunk of streamPlan(inst, plan)) s.page(chunk); inst.stats = s.done()
    inst._.statsV = inst.version
  }
  let sr = inst.sampleRate, bs = inst.stats?.blockSize
  if (!bs) return { stats: inst.stats, ch: inst.channels, sr, from: 0, to: 0 }
  let first = Object.values(inst.stats).find(v => v?.[0]?.length)
  let blocks = first?.[0]?.length || 0
  let at = opts?.at, dur = opts?.duration
  let from = at != null ? Math.floor(at * sr / bs) : 0
  let to = dur != null ? Math.ceil(((at || 0) + dur) * sr / bs) : blocks
  return { stats: inst.stats, ch: inst.channels, sr, from, to }
}

audio.fn.stat = async function(name, opts) {
  // Instance methods (spectrum, cepstrum, etc.)
  if (typeof this[name] === 'function' && !audio.stat[name]) return this[name](opts)

  let { stats, ch, sr, from, to } = await queryRange(this, opts)
  let bins = opts?.bins

  // Derived stats — custom aggregation, scalar only
  if (aggregates[name]) return aggregates[name](stats, ch, from, to, sr)

  // Raw block stats
  let src = stats[name]
  if (!src) throw new Error(`Unknown stat: '${name}'`)

  let chSel = opts?.channel
  let perCh = Array.isArray(chSel)
  let cS = perCh ? 0 : (chSel ?? 0), cE = perCh ? ch : (chSel != null ? cS + 1 : ch)
  let chList = perCh ? chSel : null

  if (bins != null) {
    let n = bins || (to - from), cfg = binConfigs[name] || { reduce: rMax, init: -Infinity }
    let reduce1 = (c) => binReduce(src[c], from, to, n, cfg.reduce, cfg.init)
    if (perCh) return chList.map(reduce1)
    if (cE - cS === 1) return reduce1(cS)
    // Merge channels
    let out = new Float32Array(n), bpp = (to - from) / n
    for (let i = 0; i < n; i++) {
      let a = from + Math.floor(i * bpp), b = Math.min(from + Math.floor((i + 1) * bpp), to)
      if (b <= a) b = a + 1
      let v = cfg.init
      for (let c = cS; c < cE; c++) for (let j = a; j < b; j++) v = cfg.reduce(v, src[c][j])
      out[i] = v === cfg.init ? 0 : v
    }
    return out
  }

  // Scalar aggregate
  let agg = scalarAgg[name]
  if (!agg) throw new Error(`No scalar aggregate for stat: '${name}'`)
  if (perCh) return chList.map(c => agg(src[c], from, to))
  if (cE - cS === 1) return agg(src[cS], from, to)
  // Merge channels
  let vals = Array.from({ length: cE - cS }, (_, i) => agg(src[cS + i], from, to))
  return scalarAgg[name] === scalarAgg.min ? Math.min(...vals)
    : scalarAgg[name] === scalarAgg.max ? Math.max(...vals)
    : vals.reduce((a, b) => a + b, 0) / vals.length
}
