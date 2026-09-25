// Downmix per ITU-R BS.775-4 Annex 4 Table 2 (3/2 source; columns L R C Ls Rs). The LFE
// channel is not mixed. Rows are the target layout by channel count: 1/0, 2/0, 3/0 (L R C),
// 2/2 (L R Ls Rs), and 3/2 itself (5.1 → 5.0 drops the LFE).
const K = Math.SQRT1_2
const DOWN = {
  1: [[K, K, 1, 0.5, 0.5]],
  2: [[1, 0, K, K, 0], [0, 1, K, 0, K]],
  3: [[1, 0, 0, K, 0], [0, 1, 0, 0, K], [0, 0, 1, 0, 0]],
  4: [[1, 0, K, 0, 0], [0, 1, K, 0, 0], [0, 0, 0, 1, 0], [0, 0, 0, 0, 1]],
  5: [[1, 0, 0, 0, 0], [0, 1, 0, 0, 0], [0, 0, 1, 0, 0], [0, 0, 0, 1, 0], [0, 0, 0, 0, 1]],
}
// Source channels feeding each 3/2 slot, by channel count (WAV/SMPTE order). 7.1's back
// and side surrounds share their side's slot, each at the surround coefficient.
const SRC = {
  3: [[0], [1], [2], [], []],          // L R C
  4: [[0], [1], [], [2], [3]],          // L R Ls Rs
  5: [[0], [1], [2], [3], [4]],         // L R C Ls Rs
  6: [[0], [1], [2], [4], [5]],         // L R C LFE Ls Rs
  8: [[0], [1], [2], [4, 6], [5, 7]],   // L R C LFE Lb Rb Ls Rs
}

/** n → m coefficient matrix [out][in] for a known layout, else null. */
function downmix(n, m) {
  let rows = DOWN[m], src = SRC[n]
  if (!rows || !src) return null
  return rows.map(row => {
    let r = new Float64Array(n)
    for (let s = 0; s < 5; s++) for (let c of src[s]) r[c] += row[s]
    return r
  })
}

const remix = (input, output, ctx) => {
  let arg = ctx.layout, len = input[0].length
  if (Array.isArray(arg)) {
    for (let c = 0; c < output.length; c++) {
      let src = arg[c]
      if (src == null) output[c].fill(0)
      else output[c].set(input[((src % input.length) + input.length) % input.length])
    }
    return
  }
  let n = input.length, m = arg
  if (n === m) { for (let c = 0; c < n; c++) output[c].set(input[c]); return }
  let mx = m < n && (ctx._mx?.n === n ? ctx._mx.rows : (ctx._mx = { n, rows: downmix(n, m) }).rows)
  if (mx) {
    for (let o = 0; o < m; o++) {
      let out = output[o], row = mx[o]
      out.fill(0)
      for (let c = 0; c < n; c++) { let k = row[c]; if (k) { let x = input[c]; for (let i = 0; i < len; i++) out[i] += k * x[i] } }
    }
    return
  }
  // Stereo → mono, or a layout without a standard matrix: equal-weight average
  if (m < n) {
    output[0].fill(0)
    for (let c = 0; c < n; c++)
      for (let i = 0; i < len; i++) output[0][i] += input[c][i]
    let inv = 1 / n
    for (let i = 0; i < len; i++) output[0][i] *= inv
    for (let c = 1; c < m; c++) output[c].set(output[0])
    return
  }
  for (let c = 0; c < m; c++) output[c].set(input[c % n])
}

const remixCh = (curCh, ctx) => {
  let m = Array.isArray(ctx.layout) ? ctx.layout.length : ctx.layout
  return m === curCh ? 0 : m
}

import audio from '../core.js'
audio.op('remix', { params: ['layout'], process: remix, ch: remixCh })
