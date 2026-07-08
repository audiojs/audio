/**
 * Crossfeed — headphone crossfeed for improved stereo imaging.
 *
 * a.crossfeed()           → default (700 Hz, 0.3 level)
 * a.crossfeed(500, 0.4)   → custom cutoff and level
 *
 * Mixes L→R and R→L through a lowpass filter to simulate speaker crosstalk,
 * reducing the exaggerated separation of headphone listening.
 * Mono input is passed through unchanged.
 *
 * out_L = L·(1-g) + lowpass(R)·g, out_R = R·(1-g) + lowpass(L)·g, g = level.
 * Direct+cross gain sums to exactly 1 (unity-sum) — the defining property of
 * the Chu Moy and bs2b (Bauer) crossfeed circuits, unlike a (1-level/2)+level
 * mix which boosts center content by up to +1.1 dB. `g = level` (not level/2)
 * keeps the cross amount equal to the pre-fix cross coefficient; direct gain
 * absorbs the difference. Unity-sum holds in practice below the cutoff, where
 * lowpass(x)≈x, so a centered signal keeps its level (bass stays transparent);
 * above the cutoff the cross content rolls off and centered signals fall back
 * toward the direct-only gain (1-g) — the intended effect, not a defect.
 */

import { lowpass } from '@audio/filter'

const process = (input, output, ctx) => {
  if (input.length < 2) {
    for (let c = 0; c < input.length; c++) output[c].set(input[c])
    return
  }
  let len = input[0].length
  if (ctx._g == null) ctx._g = ctx.level ?? 0.3
  let g = ctx._g, fc = ctx.freq || 700, fs = ctx.sampleRate
  // Butterworth Q (0.707, lowpass.js default) — flat passband well below fc, so
  // lowpass(x)≈x for content far under the cutoff and unity-sum holds in practice
  if (!ctx._lpR) ctx._lpR = { fc, fs }  // lowpass(R) → feeds L
  if (!ctx._lpL) ctx._lpL = { fc, fs }  // lowpass(L) → feeds R
  if (!ctx._cR || ctx._cR.length < len) { ctx._cR = new Float64Array(len); ctx._cL = new Float64Array(len) }
  let crossToL = ctx._cR, crossToR = ctx._cL
  for (let i = 0; i < len; i++) { crossToL[i] = input[1][i]; crossToR[i] = input[0][i] }
  lowpass(crossToL, ctx._lpR)
  lowpass(crossToR, ctx._lpL)
  for (let i = 0; i < len; i++) {
    output[0][i] = input[0][i] * (1 - g) + crossToL[i] * g
    output[1][i] = input[1][i] * (1 - g) + crossToR[i] * g
  }
  for (let c = 2; c < input.length; c++) output[c].set(input[c])
}

import audio from '../core.js'
audio.op('crossfeed', { params: ['freq', 'level'], process })
