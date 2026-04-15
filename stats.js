/**
 * Stats engine — block-level stat computation + unified stat query.
 * Self-registers on import — exposes statSession on audio, adds fn.stat.
 */

import audio, { parseTime, LOAD } from './core.js'
import { buildPlan, streamPlan, ensurePlan } from './plan.js'

// ── Stat descriptor registry ────────────────────────────────────

let statDefs = {}

/** Register/query stat: audio.stat(), audio.stat(name), audio.stat(name, descriptor|blockFn) */
audio.stat = function(name, desc) {
  if (!arguments.length) return statDefs
  if (arguments.length === 1) return statDefs[name]
  if (typeof desc === 'function') desc = { block: desc }
  statDefs[name] = desc
}

/** Create a stat computation session. ch inferred from first .page() call. */
function statSession(sr) {
  let fns, acc, ch, last = 0, rem = null, remLen = 0

  function init(c) {
    ch = c
    fns = Object.entries(audio.stat())
      .filter(([_, d]) => d.block)
      .map(([name, d]) => ({ name, fn: d.block, ctx: { sampleRate: sr } }))
    acc = Object.create(null)
    for (let { name } of fns) acc[name] = Array.from({ length: ch }, () => [])
  }

  function processBlock(block) {
    for (let { name, fn, ctx } of fns) {
      let v = fn(block, ctx)
      if (typeof v === 'number') for (let c = 0; c < ch; c++) acc[name][c].push(v)
      else for (let c = 0; c < ch; c++) acc[name][c].push(v[c])
    }
  }

  return {
    page(page) {
      if (!acc) init(page.length)
      let BS = audio.BLOCK_SIZE, off = 0, len = page[0].length

      // Complete partial remainder from previous push
      if (remLen > 0) {
        let need = BS - remLen
        if (len >= need) {
          for (let c = 0; c < ch; c++) rem[c].set(page[c].subarray(0, need), remLen)
          processBlock(rem)
          off = need
          remLen = 0
        } else {
          for (let c = 0; c < ch; c++) rem[c].set(page[c].subarray(0, len), remLen)
          remLen += len
          return this
        }
      }

      // Process full blocks
      while (off + BS <= len) {
        processBlock(Array.from({ length: ch }, (_, c) => page[c].subarray(off, off + BS)))
        off += BS
      }

      // Buffer remainder
      if (off < len) {
        if (!rem) rem = Array.from({ length: ch }, () => new Float32Array(BS))
        for (let c = 0; c < ch; c++) rem[c].set(page[c].subarray(off))
        remLen = len - off
      }

      return this
    },
    /** Flush any buffered partial block as a short final block. */
    flush() {
      if (remLen > 0) {
        processBlock(Array.from({ length: ch }, (_, c) => rem[c].subarray(0, remLen)))
        remLen = 0
      }
    },
    delta() {
      if (!acc) return
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
      this.flush()
      let out = { blockSize: audio.BLOCK_SIZE }
      if (acc) for (let name in acc) out[name] = acc[name].map(a => new Float32Array(a))
      return out
    },
    /** Return current accumulated stats without flushing remainder. */
    snapshot() {
      if (!acc) return null
      let out = { blockSize: audio.BLOCK_SIZE, partial: true }
      // Expose raw arrays to avoid O(N) allocation per chunk during progressive streaming
      for (let name in acc) out[name] = acc[name]
      return out
    }
  }
}

// ── Bin reduction ────────────────────────────────────────────────

function binReduce(values, from, to, bins, reduce) {
  if (bins <= 0 || to <= from) return new Float32Array(Math.max(0, bins))
  from = Math.max(0, from); to = Math.min(to, values.length)
  if (to <= from) return new Float32Array(bins)
  let out = new Float32Array(bins), bpp = (to - from) / bins
  for (let i = 0; i < bins; i++) {
    let a = from + Math.floor(i * bpp), b = Math.min(from + Math.floor((i + 1) * bpp), to)
    if (b <= a) b = a + 1
    out[i] = reduce(values, a, b)
  }
  return out
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
    if (s[0] % bs !== 0 || s[2] % bs !== 0) return null // unaligned — force recompute
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

/** Stream plan blocks into stat session, yielding event loop periodically to avoid blocking. */
async function streamStats(s, inst, plan, offset, duration) {
  let t = performance.now()
  for (let chunk of streamPlan(inst, plan, offset, duration)) {
    s.page(chunk)
    let now = performance.now()
    if (now - t > 8) { await new Promise(r => setTimeout(r, 0)); t = performance.now() }
  }
}

/** Clone block-level stats (deep copy of all Float32Arrays). */
function cloneStats(src) {
  let out = { blockSize: src.blockSize }
  for (let k in src) {
    if (k === 'blockSize' || !Array.isArray(src[k])) continue
    out[k] = src[k].map(a => new Float32Array(a))
  }
  return out
}

/** Check if plan's pipeline stats can be derived algebraically from source stats. */
function canDeriveStats(plan) {
  let { segs, pipeline } = plan
  if (!pipeline.length) return false
  // Segments must be identity (no layout changes from plan ops)
  if (segs.length !== 1 || segs[0][0] !== 0 || segs[0][2] !== 0
    || (segs[0][3] && segs[0][3] !== 1) || segs[0][4] != null) return false
  for (let [type, opts] of pipeline) {
    if (opts?.at != null || opts?.duration != null || opts?.channel != null) return false
    let desc = audio.op(type)
    if (!desc?.deriveStats && !desc?.pointwise) return false
  }
  return true
}

/** Derive post-pipeline stats from source stats via algebraic transforms. */
function tryDeriveStats(srcStats, pipeline) {
  let stats = cloneStats(srcStats)
  for (let [type, opts] of pipeline) {
    let desc = audio.op(type)
    if (desc.deriveStats) {
      if (desc.deriveStats(stats, opts || {}) === false) return null
    } else if (desc.pointwise) {
      derivePointwise(desc, stats, opts)
    } else return null
  }
  return stats
}

/** Auto-derive min/max/clipping for pointwise ops by probing process with edge values. */
function derivePointwise(desc, stats, opts) {
  let ch = stats.min.length, n = stats.min[0]?.length || 0
  if (!n) return
  let { at, duration, channel, ...extra } = opts || {}
  let ctx = { ...extra }
  let outA = Array.from({ length: ch }, () => new Float32Array(n))
  let outB = Array.from({ length: ch }, () => new Float32Array(n))
  desc.process(stats.min.map(c => c.slice()), outA, ctx)
  desc.process(stats.max.map(c => c.slice()), outB, ctx)
  for (let c = 0; c < ch; c++) {
    for (let i = 0; i < n; i++) {
      stats.min[c][i] = Math.min(outA[c][i], outB[c][i])
      stats.max[c][i] = Math.max(outA[c][i], outB[c][i])
    }
    if (stats.clipping) for (let i = 0; i < n; i++)
      stats.clipping[c][i] = (stats.min[c][i] <= -1 || stats.max[c][i] >= 1) ? Math.max(1, stats.clipping[c][i]) : 0
  }
}

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
      await ensurePlan(inst, plan, at || 0, dur)
      let s = statSession(inst.sampleRate)
      await streamStats(s, inst, plan, at || 0, dur)
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
        let s = statSession(inst.sampleRate); await ensurePlan(inst, plan); await streamStats(s, inst, plan); inst.stats = s.done()
        inst._.statsV = inst.version
      }
    } else if (inst._.srcStats?.blockSize && canDeriveStats(plan)) {
      // Algebraic derivation — derive post-pipeline stats from source stats (dc, gain, etc.)
      let derived = tryDeriveStats(inst._.srcStats, plan.pipeline)
      if (derived) { inst.stats = derived; inst._.statsV = inst.version }
      else {
        let s = statSession(inst.sampleRate); await ensurePlan(inst, plan); await streamStats(s, inst, plan); inst.stats = s.done()
        inst._.statsV = inst.version
      }
    } else {
      // Full recompute — has sample-level ops
      let s = statSession(inst.sampleRate); await ensurePlan(inst, plan); await streamStats(s, inst, plan); inst.stats = s.done()
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
  if (typeof this[name] === 'function' && !audio.stat(name)) return this[name](opts)

  let { stats, ch, sr, from, to } = await queryRange(this, opts)
  let bins = opts?.bins

  // Resolve channel selection once
  let chSel = opts?.channel
  let perCh = Array.isArray(chSel)
  let chs = chSel != null ? (perCh ? chSel : [chSel]) : Array.from({ length: ch }, (_, i) => i)

  let desc = audio.stat(name)

  // Derived stats — custom query (skip if bins requested on block stat)
  if (desc?.query && bins == null) return desc.query(stats, chs, from, to, sr, opts)

  // Raw block stats
  let blockStats = stats[name], reduce = desc?.reduce
  if (!blockStats) throw new Error(`Unknown stat: '${name}'`)
  if (!reduce) throw new Error(`No reducer for stat: '${name}'`)

  // Binned mode
  if (bins != null) {
    let n = bins ?? (to - from)
    let reduce1 = (c) => binReduce(blockStats[c], from, to, n, reduce)
    if (perCh) return chs.map(reduce1)
    if (chs.length === 1) return reduce1(chs[0])
    let out = new Float32Array(n), bpp = (to - from) / n
    for (let i = 0; i < n; i++) {
      let a = from + Math.floor(i * bpp), b = Math.min(from + Math.floor((i + 1) * bpp), to)
      if (b <= a) b = a + 1
      let sum = 0
      for (let c of chs) sum += reduce(blockStats[c], a, b)
      out[i] = sum / chs.length
    }
    return out
  }

  // Scalar mode
  if (perCh) return chs.map(c => reduce(blockStats[c], from, to))
  if (chs.length === 1) return reduce(blockStats[chs[0]], from, to)
  let vals = chs.map(c => reduce(blockStats[c], from, to))
  return vals.reduce((a, b) => a + b, 0) / vals.length
}
