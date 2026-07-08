/**
 * Vocals — vocal isolation / removal via stereo mid/side.
 *
 * a.vocals()          → isolate center (vocals) — keeps mid, discards side
 * a.vocals('remove')  → remove center (vocals) — keeps side, discards mid
 *
 * SoX `oops` equivalent. Works on stereo material where vocals are panned center.
 * Mono input is passed through unchanged.
 */

import { isolate, remove } from '@audio/vocals'

const vocals = (input, output, ctx) => {
  let mode = ctx.mode || 'isolate'
  for (let c = 0; c < input.length; c++) output[c].set(input[c])
  if (input.length < 2) return
  // isolate/remove mutate their two args in place; extra channels (already
  // copied above) are untouched since the kernel only sees output[0..1].
  ;(mode === 'remove' ? remove : isolate)([output[0], output[1]])
}

import audio from '../core.js'
audio.op('vocals', { params: ['mode'], process: vocals })
