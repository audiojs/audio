/**
 * Stats engine — block-level stat computation.
 * Stat dict passed as parameter — no globals.
 */

import { BLOCK_SIZE } from './plan.js'

/** Create a stat computation session from a stat dict. */
export function statSession(stats, ch, sr) {
  let fns = Object.entries(stats).map(([name, init]) => ({ name, fn: init() }))
  let acc = Object.create(null)
  for (let { name } of fns) acc[name] = Array.from({ length: ch }, () => [])
  let ctx = { sampleRate: sr }, last = 0

  return {
    block(block) {
      for (let { name, fn } of fns) {
        let v = fn(block, ctx)
        if (typeof v === 'number') for (let c = 0; c < ch; c++) acc[name][c].push(v)
        else for (let c = 0; c < ch; c++) acc[name][c].push(v[c])
      }
    },
    page(page) {
      for (let off = 0; off < page[0].length; off += BLOCK_SIZE) {
        let end = Math.min(off + BLOCK_SIZE, page[0].length)
        this.block(Array.from({ length: ch }, (_, c) => page[c].subarray(off, end)))
      }
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
      let out = { blockSize: BLOCK_SIZE }
      for (let name in acc) out[name] = acc[name].map(a => new Float32Array(a))
      return out
    }
  }
}

/** Build stats from flat planar PCM. */
export function buildStats(stats, pcm, ch, sr = 44100) {
  let s = statSession(stats, ch, sr)
  for (let off = 0; off < pcm[0].length; off += BLOCK_SIZE) {
    let end = Math.min(off + BLOCK_SIZE, pcm[0].length)
    s.block(Array.from({ length: ch }, (_, c) => pcm[c].subarray(off, end)))
  }
  return s.done()
}
