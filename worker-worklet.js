/**
 * Playback sink for audio/worker — an AudioWorkletProcessor fed rendered blocks
 * over its port (no SharedArrayBuffer, so it works without COOP/COEP headers).
 * The facade pumps chunks with credit-based backpressure from the consumption
 * reports this processor posts back.
 *
 * Load via: audioContext.audioWorklet.addModule(new URL('audio/worker-worklet', ...))
 * — standalone module, no imports (AudioWorkletGlobalScope).
 */

class AudioWorkerSink extends AudioWorkletProcessor {
  constructor() {
    super()
    this.chunks = []          // FIFO of Float32Array[] blocks
    this.offset = 0           // read position inside chunks[0]
    this.playing = false
    this.volume = 1
    this.consumed = 0         // total frames played
    this.reported = 0
    this.port.onmessage = e => {
      let m = e.data
      if (m.chunk) this.chunks.push(m.chunk)
      else if (m.type === 'play') this.playing = true
      else if (m.type === 'pause') this.playing = false
      else if (m.type === 'flush') { this.chunks = []; this.offset = 0 }
      if (m.volume != null) this.volume = m.volume
    }
  }

  process(inputs, outputs) {
    let out = outputs[0]
    if (!this.playing || !out[0]) return true
    let need = out[0].length, filled = 0
    while (filled < need && this.chunks.length) {
      let c = this.chunks[0]
      let n = Math.min(need - filled, c[0].length - this.offset)
      for (let ch = 0; ch < out.length; ch++) {
        let src = c[Math.min(ch, c.length - 1)]
        for (let i = 0; i < n; i++) out[ch][filled + i] = src[this.offset + i] * this.volume
      }
      this.offset += n
      filled += n
      if (this.offset >= c[0].length) { this.chunks.shift(); this.offset = 0 }
    }
    this.consumed += filled
    // Throttled consumption report — the facade's pump uses it for backpressure
    if (this.consumed - this.reported >= 2048 || (filled < need && this.consumed > this.reported)) {
      this.reported = this.consumed
      this.port.postMessage({ consumed: this.consumed })
    }
    return true
  }
}

registerProcessor('audio-worker-sink', AudioWorkerSink)
