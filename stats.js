/**
 * Stats engine — block-level stat computation.
 * Self-registers on import — exposes statSession on audio, adds fn.query.
 */

import audio, { LOAD } from './core.js'

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


// ── Self-register ────────────────────────────────────────────────

audio.statSession = statSession

audio.fn.query = async function(offset, duration) {
  await this[LOAD]()
  let sr = this.sampleRate, bs = this.stats?.blockSize
  if (!bs) return { stats: this.stats, channels: this.channels, sampleRate: sr, from: 0, to: 0 }
  let first = Object.values(this.stats).find(v => v?.[0]?.length)
  let blocks = first?.[0]?.length || 0
  let from = offset != null ? Math.floor(offset * sr / bs) : 0
  let to = duration != null ? Math.ceil((offset + duration) * sr / bs) : blocks
  return { stats: this.stats, channels: this.channels, sampleRate: sr, from, to }
}
