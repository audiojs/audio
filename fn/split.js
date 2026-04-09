import audio, { parseTime } from '../core.js'

/** Split at offsets, returning views. No copies. */
audio.fn.split = function(...args) {
  let offsets = (Array.isArray(args[0]) ? args[0] : args).map(parseTime)
  let dur = this.duration
  let cuts = [0, ...offsets.sort((a, b) => a - b).filter(t => t > 0 && t < dur), dur]
  return cuts.slice(0, -1).map((start, i) => this.view({at: start, duration: cuts[i + 1] - start}))
}
