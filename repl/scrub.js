// The scrub voice, an AudioWorklet: while a caret is held or dragged it plays the sound under it, every channel its
// own, by one of the ways of hearing a moment (@audio/scrub, vendored as scrub-methods.js by .scrub-vendor.js). By
// default 'hybrid', vocoder + noise: a phase vocoder whose tonal peaks carry their phase on and whose other bins take a
// new random phase each hop, the channels turning together as far as they are alike, an attack played once as
// recorded; of eight ways compared in the lab's "Hearing a moment" (audiojs.github.io/lab/scrub) the closest to the
// sound around the caret. The settings choose another (`mode`: tape, loop, grains, bank, lines, random, vocoder). A
// still caret sustains the moment; a moving one plays the sound at the caret's speed. A band [low, high] in Hz keeps
// only its bins (the spectral ways). It fades in and out over 10 ms. Nothing allocates while it plays.
// The sound comes at its own rate; the voice runs at that rate, a block at a time, and is read at the context's,
// between its samples.
// Messages in: { x, rate } the sound's channels and rate; { caret } in samples of it; { band }; { on }; { mode }.
import { methods } from './scrub-methods.js'
const BLOCK = 128

class Scrub extends AudioWorkletProcessor {
  constructor() {
    super()
    this.x = null
    this.rate = sampleRate
    this.caret = 0
    this.band = null
    this.on = false
    this.mode = 'hybrid'
    this.voice = null
    this.gain = 0
    // the voice's block, the next of its samples to read, its last two samples of each channel, and where the
    // context's reading is between them
    this.block = null
    this.k = BLOCK
    this.prev = null
    this.next = null
    this.at = 1
    this.port.onmessage = ({ data }) => this.receive(data)
  }
  receive({ x, rate, caret, band, on, mode }) {
    if (x) { this.x = x; this.rate = rate || sampleRate; this.voice = null; this.gain = 0 }
    if (mode && mode !== this.mode) { this.mode = mode; this.voice = null; this.gain = 0 }
    if (caret != null) this.caret = caret
    if (band !== undefined) this.band = band
    if (on != null) this.on = on
  }
  process(inputs, outputs) {
    const out = outputs[0]
    if (this.on && !this.voice && this.x) {
      this.voice = (methods[this.mode] || methods.hybrid).make(this.x, this.rate, this.caret)
      this.gain = 0
      this.block = this.x.map(() => new Float32Array(BLOCK))
      this.k = BLOCK
      this.prev = new Float64Array(this.x.length)
      this.next = new Float64Array(this.x.length)
      this.at = 1
    }
    const voice = this.voice
    if (!voice) return true
    voice.band = this.band
    // the voice runs at the sound's rate; the context reads it at its own, between two samples, linearly
    const { block, prev, next } = this, ratio = this.rate / sampleRate, fade = 1 / (.01 * sampleRate), target = this.on ? 1 : 0, C = block.length
    let g = this.gain
    for (let i = 0; i < out[0].length; i++) {
      while (this.at >= 1) {
        if (this.k === BLOCK) { voice.render(block, this.caret); this.k = 0 }
        for (let c = 0; c < C; c++) { prev[c] = next[c]; next[c] = block[c][this.k] }
        this.k++
        this.at -= 1
      }
      g = target ? Math.min(1, g + fade) : Math.max(0, g - fade)
      for (let o = 0; o < out.length; o++) {
        const c = Math.min(o, C - 1)
        out[o][i] = (prev[c] + (next[c] - prev[c]) * this.at) * g
      }
      this.at += ratio
    }
    this.gain = g
    if (!g && !this.on) this.voice = null
    return true
  }
}
registerProcessor('scrub', Scrub)
