/**
 * Live varispeed — fractional read cursor over pushed planar chunks, one-pole
 * rate smoothing (~50ms) toward getRate(): tape-style speed/pitch changes with
 * no clicks. Unit rate with zero phase is a bit-exact copy. Shared by the
 * main-thread player (fn/play.js) and the worker facade pump (worker.js) —
 * no engine imports, stays facade-safe.
 */
export default function varispeed(ch, sr, getRate, block = 1024) {
  const K = 1 - Math.exp(-1 / (0.05 * sr))
  let cap = 1 << 16
  let tape = Array.from({ length: ch }, () => new Float32Array(cap))
  let tHead = 0, tPos = 0, frac = 0, absRead = 0
  let rate = getRate() || 1  // smoothed; starts at target (no ramp-in)

  return {
    /** Input samples consumed so far (fractional) — source-position bookkeeping. */
    get pos() { return absRead + frac },
    get rate() { return rate },

    push(chunk) {
      let n = chunk[0].length
      if (tHead + n > cap) {
        let keep = tHead - tPos
        if (keep + n > cap) {
          cap = 1 << (32 - Math.clz32(keep + n))
          tape = tape.map(t => { let nt = new Float32Array(cap); nt.set(t.subarray(tPos, tHead)); return nt })
        } else for (let t of tape) t.copyWithin(0, tPos, tHead)
        tHead = keep; tPos = 0
      }
      for (let c = 0; c < ch; c++) tape[c].set(chunk[c] || chunk[0], tHead)
      tHead += n
    },

    /** Pull ≤ block planar frames (fresh arrays — safe to transfer). Null when input
     *  is short of a full block (or, with final=true, exhausted). */
    pull(final) {
      let target = getRate() || 1
      let unit = rate === target && rate === 1 && frac === 0
      if (!final && tHead - tPos < (unit ? block : Math.ceil(block * Math.max(rate, target)) + 2)) return null
      if (unit) {
        let len = Math.min(block, tHead - tPos)
        if (!len) return null
        let out = tape.map(t => t.slice(tPos, tPos + len))
        tPos += len; absRead += len
        return out
      }
      let last = tHead - 1
      let out = Array.from({ length: ch }, () => new Float32Array(block)), len = 0
      while (len < block && (tPos < last || (final && tPos === last && frac === 0))) {
        rate += (target - rate) * K
        if (Math.abs(rate - target) < 1e-4) rate = target
        for (let c = 0; c < ch; c++) {
          let t = tape[c], s0 = t[tPos]
          out[c][len] = tPos < last ? s0 + (t[tPos + 1] - s0) * frac : s0
        }
        frac += rate
        let adv = frac | 0
        tPos += adv; frac -= adv; absRead += adv
        len++
      }
      return len ? (len === block ? out : out.map(o => o.subarray(0, len))) : null
    },
  }
}
