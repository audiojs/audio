/**
 * Crossfeed — headphone crossfeed for improved stereo imaging.
 *
 * a.crossfeed()           → default (700 Hz, 0.3 level)
 * a.crossfeed(500, 0.4)   → custom cutoff and level
 *
 * Mixes L→R and R→L through a lowpass filter to simulate speaker crosstalk,
 * reducing the exaggerated separation of headphone listening.
 * Mono input is passed through unchanged.
 */

import crossfeed from 'audio-filter/eq/crossfeed.js'

const process = (input, output, ctx) => {
  if (input.length < 2) {
    for (let c = 0; c < input.length; c++) output[c].set(input[c])
    return
  }
  let len = input[0].length
  if (!ctx._p) ctx._p = { fc: ctx.freq || 700, level: ctx.level ?? 0.3, fs: ctx.sampleRate }
  if (!ctx._L || ctx._L.length < len) { ctx._L = new Float64Array(len); ctx._R = new Float64Array(len) }
  let L = ctx._L, R = ctx._R
  for (let i = 0; i < len; i++) { L[i] = input[0][i]; R[i] = input[1][i] }
  crossfeed(L, R, ctx._p)
  for (let i = 0; i < len; i++) { output[0][i] = L[i]; output[1][i] = R[i] }
  for (let c = 2; c < input.length; c++) output[c].set(input[c])
}

import audio from '../core.js'
audio.op('crossfeed', { params: ['freq', 'level'], process })
