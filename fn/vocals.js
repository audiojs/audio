/**
 * Vocals — vocal isolation / removal via stereo mid/side.
 *
 * a.vocals()          → isolate center (vocals) — keeps mid, discards side
 * a.vocals('remove')  → remove center (vocals) — keeps side, discards mid
 *
 * SoX `oops` equivalent. Works on stereo material where vocals are panned center.
 * Mono input is passed through unchanged.
 */

const vocals = (input, output, ctx) => {
  let mode = ctx.mode || 'isolate'
  if (input.length < 2) {
    for (let c = 0; c < input.length; c++) output[c].set(input[c])
    return
  }
  let L = input[0], R = input[1], oL = output[0], oR = output[1], len = L.length
  if (mode === 'remove') {
    // Side = (L - R) / 2 — removes center-panned content
    for (let i = 0; i < len; i++) {
      let side = (L[i] - R[i]) * 0.5
      oL[i] = side
      oR[i] = -side
    }
  } else {
    // Mid = (L + R) / 2 — isolates center-panned content
    for (let i = 0; i < len; i++) {
      let mid = (L[i] + R[i]) * 0.5
      oL[i] = mid
      oR[i] = mid
    }
  }
  // Pass through extra channels unchanged
  for (let c = 2; c < input.length; c++) output[c].set(input[c])
}

import audio from '../core.js'
audio.op('vocals', { params: ['mode'], process: vocals })
