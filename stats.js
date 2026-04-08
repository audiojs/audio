/**
 * Stats engine — block-level stat computation + unified stat query.
 * Self-registers on import — exposes statSession on audio, adds fn.stat.
 */

import audio, { parseTime, LOAD } from './core.js'
import { buildPlan, streamPlan } from './history.js'

/** Create a stat computation session. ch inferred from first .page() call. */
function statSession(sr) {
  let fns, acc, ch, last = 0

  function init(c) {
    ch = c
    fns = Object.entries(audio.stat).map(([name, fn]) => ({ name, fn, ctx: { sampleRate: sr } }))
    acc = Object.create(null)
    for (let { name } of fns) acc[name] = Array.from({ length: ch }, () => [])
  }

  return {
    page(page) {
      if (!acc) init(page.length)
      for (let off = 0; off < page[0].length; off += audio.BLOCK_SIZE) {
        let end = Math.min(off + audio.BLOCK_SIZE, page[0].length)
        let block = Array.from({ length: ch }, (_, c) => page[c].subarray(off, end))
        for (let { name, fn, ctx } of fns) {
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
let rMin = (a, b) => b < a ? b : a
let rMax = (a, b) => b > a ? b : a
let rSum = (a, b) => a + b

/** Per-stat reduction config: [reduce, init, post]. */
const reducers = {
  min:    [rMin, Infinity,  v => v === Infinity ? 0 : v],
  max:    [rMax, -Infinity, v => v === -Infinity ? 0 : v],
  rms:    [rSum, 0, (v, n) => n ? Math.sqrt(v / n) : 0],
  energy: [rSum, 0, (v, n) => n ? v / n : 0],
  clip:   [rSum, 0, v => v],
  dc:     [rSum, 0, (v, n) => n ? v / n : 0]
}

function binReduce(src, from, to, bins, cfg) {
  if (bins <= 0 || to <= from) return new Float32Array(bins || 0)
  from = Math.max(0, from); to = Math.min(to, src.length)
  if (to <= from) return new Float32Array(bins)
  let [reduce, init, post] = cfg
  let out = new Float32Array(bins), bpp = (to - from) / bins
  for (let i = 0; i < bins; i++) {
    let a = from + Math.floor(i * bpp), b = Math.min(from + Math.floor((i + 1) * bpp), to)
    if (b <= a) b = a + 1
    let v = init, cnt = 0
    for (let j = a; j < b; j++) { v = reduce(v, src[j]); cnt++ }
    out[i] = post(v, cnt)
  }
  return out
}

function reduceRange(cfg, src, from, to) {
  let [reduce, init, post] = cfg, v = init, n = 0
  for (let i = from; i < to; i++) { v = reduce(v, src[i]); n++ }
  return post(v, n)
}

const GATE_WINDOW = 0.4, ABS_GATE = -70, REL_GATE = -10, LUFS_OFFSET = -0.691

/** Compute LUFS from block-level energy. Returns null if audio is silent. */
export function lufsFromEnergy(energy, chs, sampleRate, blockSize, from = 0, to) {
  if (to == null) to = energy[0].length
  if (typeof chs === 'number') chs = Array.from({ length: chs }, (_, i) => i)
  let winBlocks = Math.ceil(GATE_WINDOW * sampleRate / blockSize), gates = []
  for (let i = from; i < to; i += winBlocks) {
    let we = Math.min(i + winBlocks, to), sum = 0, n = 0
    for (let c of chs) for (let j = i; j < we; j++) { sum += energy[c][j]; n++ }
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
  db(stats, chs, from, to) {
    let peak = 0
    for (let c of chs)
      for (let i = from; i < Math.min(to, stats.min[c].length); i++)
        peak = Math.max(peak, Math.abs(stats.min[c][i]), Math.abs(stats.max[c][i]))
    return peak > 0 ? 20 * Math.log10(peak) : -Infinity
  },
  rms(stats, chs, from, to) {
    let sum = 0, n = 0
    for (let c of chs)
      for (let i = from; i < Math.min(to, stats.rms[c].length); i++) { sum += stats.rms[c][i]; n++ }
    return n ? Math.sqrt(sum / n) : 0
  },
  loudness(stats, chs, from, to, sr) {
    let v = lufsFromEnergy(stats.energy, chs, sr, stats.blockSize, from, to)
    return v ?? -Infinity
  },
  clip(stats, chs, from, to, sr) {
    let bs = stats.blockSize, times = []
    for (let i = from; i < to; i++) {
      let n = 0
      for (let c of chs) n += stats.clip[c][i] || 0
      if (n > 0) times.push(i * bs / sr)
    }
    return new Float32Array(times)
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
  return lufsFromEnergy(stats.energy, chs, sampleRate, stats.blockSize) ?? null
}



/** Remap source stats by segment layout (plan-only edits, no sample pipeline).
 *  Falls back to null if segments are too complex to remap cheaply. */
function remapStats(srcStats, plan, sr) {
  let bs = srcStats.blockSize, segs = plan.segs, totalLen = plan.totalLen
  // Check feasibility: only self-ref (undefined) and silence (null), rate ±1
  for (let s of segs) {
    let rate = s[3] || 1, ref = s[4]
    if (ref !== undefined && ref !== null) return null  // external ref
    if (Math.abs(rate) !== 1) return null               // resampled
  }
  let outBlocks = Math.ceil(totalLen / bs)
  let fields = Object.keys(srcStats).filter(k => k !== 'blockSize' && Array.isArray(srcStats[k]))
  let ch = srcStats[fields[0]]?.length || 1
  let out = { blockSize: bs }
  for (let f of fields) out[f] = Array.from({ length: ch }, () => new Float32Array(outBlocks))

  for (let s of segs) {
    let srcOff = s[0], count = s[1], dstOff = s[2], rate = s[3] || 1, ref = s[4]
    let dstBlockStart = Math.floor(dstOff / bs)
    let dstBlockEnd = Math.ceil((dstOff + count) / bs)
    if (ref === null) continue // silence — Float32Array already zeroed

    let srcBlockStart = Math.floor(srcOff / bs)
    let srcBlocks = srcStats[fields[0]][0].length
    let rev = rate < 0
    for (let i = dstBlockStart; i < dstBlockEnd && i < outBlocks; i++) {
      let si = rev ? srcBlockStart + (dstBlockEnd - 1 - i) : srcBlockStart + (i - dstBlockStart)
      if (si < 0 || si >= srcBlocks) continue
      for (let f of fields) for (let c = 0; c < ch; c++) out[f][c][i] = srcStats[f][c][si]
    }
  }
  return out
}


// ── Self-register ────────────────────────────────────────────────

audio.statSession = statSession

/** Resolve block range from opts. Recomputes stats if edits are dirty. */
export async function queryRange(inst, opts) {
  await inst[LOAD]()
  let at = parseTime(opts?.at), dur = parseTime(opts?.duration)
  let hasRange = at != null || dur != null

  if (inst.edits?.length && inst._.statsV !== inst.version) {
    if (!inst._.srcStats) inst._.srcStats = inst.stats

    // Range query on dirty edits — compute stats for just the requested range
    if (hasRange) {
      let plan = buildPlan(inst)
      let s = statSession(inst.sampleRate)
      for (let chunk of streamPlan(inst, plan, at || 0, dur)) s.page(chunk)
      let stats = s.done()
      let first = Object.values(stats).find(v => v?.[0]?.length)
      let blocks = first?.[0]?.length || 0
      return { stats, ch: inst.channels, sr: inst.sampleRate, from: 0, to: blocks }
    }

    // Plan-only edits (no sample pipeline) — remap source stats by segments
    let plan = buildPlan(inst)
    if (!plan.pipeline.length && inst._.srcStats?.blockSize) {
      let remapped = remapStats(inst._.srcStats, plan, inst.sampleRate)
      if (remapped) { inst.stats = remapped; inst._.statsV = inst.version }
      else {
        let s = statSession(inst.sampleRate); for (let chunk of streamPlan(inst, plan)) s.page(chunk); inst.stats = s.done()
        inst._.statsV = inst.version
      }
    } else {
      // Full recompute — has sample-level ops
      let s = statSession(inst.sampleRate); for (let chunk of streamPlan(inst, plan)) s.page(chunk); inst.stats = s.done()
      inst._.statsV = inst.version
    }
  }
  let sr = inst.sampleRate, bs = inst.stats?.blockSize
  if (!bs) return { stats: inst.stats, ch: inst.channels, sr, from: 0, to: 0 }
  let first = Object.values(inst.stats).find(v => v?.[0]?.length)
  let blocks = first?.[0]?.length || 0
  let atN = at != null && at < 0 ? inst.duration + at : at
  let from = atN != null ? Math.floor(atN * sr / bs) : 0
  let to = dur != null ? Math.ceil(((atN || 0) + dur) * sr / bs) : blocks
  from = Math.max(0, Math.min(from, blocks))
  to = Math.max(from, Math.min(to, blocks))
  return { stats: inst.stats, ch: inst.channels, sr, from, to }
}

audio.fn.stat = async function(name, opts) {
  // Array of stat names — parallel query, positional result
  if (Array.isArray(name)) return Promise.all(name.map(n => this.stat(n, opts)))

  // Instance methods (spectrum, cepstrum, etc.)
  if (typeof this[name] === 'function' && !audio.stat[name]) return this[name](opts)

  let { stats, ch, sr, from, to } = await queryRange(this, opts)
  let bins = opts?.bins

  // Raw block stats — binned mode
  let src = stats[name], cfg = reducers[name]
  if (bins != null && src && cfg) {
    let chSel = opts?.channel
    let perCh = Array.isArray(chSel)
    let cS = perCh ? 0 : (chSel ?? 0), cE = perCh ? ch : (chSel != null ? cS + 1 : ch)
    let chList = perCh ? chSel : null
    let n = bins || (to - from)
    let reduce1 = (c) => binReduce(src[c], from, to, n, cfg)
    if (perCh) return chList.map(reduce1)
    if (cE - cS === 1) return reduce1(cS)
    let [reduce, init, post] = cfg
    let out = new Float32Array(n), bpp = (to - from) / n
    for (let i = 0; i < n; i++) {
      let a = from + Math.floor(i * bpp), b = Math.min(from + Math.floor((i + 1) * bpp), to)
      if (b <= a) b = a + 1
      let v = init, cnt = 0
      for (let c = cS; c < cE; c++) for (let j = a; j < b; j++) { v = reduce(v, src[c][j]); cnt++ }
      out[i] = post(v, cnt)
    }
    return out
  }

  // Derived stats — custom aggregation
  if (aggregates[name]) {
    let chSel = opts?.channel
    let chs = chSel != null
      ? (Array.isArray(chSel) ? chSel : [chSel])
      : Array.from({ length: ch }, (_, i) => i)
    return aggregates[name](stats, chs, from, to, sr)
  }

  // Raw block stats — scalar
  if (!src || !cfg) throw new Error(`Unknown stat: '${name}'`)

  let chSel = opts?.channel
  let perCh = Array.isArray(chSel)
  let cS = perCh ? 0 : (chSel ?? 0), cE = perCh ? ch : (chSel != null ? cS + 1 : ch)
  let chList = perCh ? chSel : null

  if (perCh) return chList.map(c => reduceRange(cfg, src[c], from, to))
  if (cE - cS === 1) return reduceRange(cfg, src[cS], from, to)
  let [reduce] = cfg
  let vals = Array.from({ length: cE - cS }, (_, i) => reduceRange(cfg, src[cS + i], from, to))
  return reduce === rMin ? Math.min(...vals)
    : reduce === rMax ? Math.max(...vals)
    : vals.reduce((a, b) => a + b, 0) / vals.length
}
