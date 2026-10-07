/**
 * Derustle: a clip-on mic's clothing rustle taken off the voice, the room's steady tone kept (iZotope RX De-rustle).
 *
 * a.derustle()                      → rustle down to 45 dB under the voice, the room's tone 12 dB down
 * a.derustle(30)                    → gentler: rustle 30 dB under the voice
 * a.derustle({ ambience: false })   → the room's tone gone with the rustle
 * a.derustle({ weights, device, music })
 *
 * The model is deepfilter()'s, DeepFilterNet3 (fn/deepfilter.js; the two ops share its output on the same input), its
 * whole removal giving the voice y; what it took, r = x − y, is the rustle and the room. It is mixed back as deepfilter
 * mixes it (@audio/neural-denoise's mixback()), with RX De-rustle's two controls: where r stands closer to the voice
 * than `reduction` dB, frame by frame, it goes down until it lies there (rustle comes loud, against the voice), and
 * the rest, the room's steady tone, goes 12 dB down (`ambience`; off: all of it). Both settings chosen on lavalier
 * rustle (bench/rx/derustle.mjs `tune`: Freesound's clothing foley and mic handling, CC0 and CC BY, under VoiceBank
 * talkers of 14 to 26 s; no lavalier rustle is openly licensed). Test, 55 talkers, rustle as loud as the voice: PESQ
 * 1.21 → 2.13, SI-SDR −0.3 → 13.5 dB; the room alone 4.37, a clean take 4.61 (deepfilter() 2.12, 4.31, 4.59;
 * unlimited 2.21, 3.79, 4.55; iZotope RX 12 Dialogue Isolate, RX's hostable neural dialogue separator, 2.06, 2.96,
 * 3.96: it takes rooms and touches clean speech; RX De-rustle itself is AAX only). Tried on `tune` and left out:
 * Wichern and Lukin's ambience preservation (iZotope, DAFx-18: the input's 2 s minimum per bin kept under the voice),
 * the minimum took held rustle for room (PESQ 1.65 against 1.87); DeepFilterNet3 run on the reversed input as well and
 * averaged (PESQ +0.02, SI-SDR −0.3 dB).
 */

import audio from '../core.js'
import { enhancer } from './deepfilter.js'

const REDUCTION = 45, ROOM = 12

function check(o) {
  let reduction = o.reduction ?? REDUCTION, ambience = o.ambience ?? true
  if (typeof reduction !== 'number' || !(reduction >= 0)) throw new TypeError(`derustle: reduction is dB under the voice, 0 or more, not ${reduction}`)
  if (typeof ambience !== 'boolean') throw new TypeError(`derustle: ambience is true or false, not ${ambience}`)
  return `${reduction}:${ambience}`
}

audio.op('derustle', {
  params: ['reduction'],
  ...enhancer('derustle', check, (x, y, o, sampleRate, { mixback }) => {
    if (!(o.ambience ?? true)) return y
    if (!mixback) throw new Error('derustle: needs @audio/neural-denoise 0.5 or later (its mixback())')
    return mixback(x, y, { limit: ROOM, floor: o.reduction ?? REDUCTION, sampleRate })
  }),
})
