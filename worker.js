/**
 * audio/worker — Worker entry point for decode offloading.
 * Loaded by audio.js when opts.decode === 'worker'.
 */
import { decodeSource } from './decode.js'

self.onmessage = async (e) => {
  try {
    let result = await decodeSource(e.data.buf)
    let final = await result.decoding
    self.postMessage({ type: 'done', data: { pages: result.pages, sampleRate: result.sampleRate, channels: result.channels, length: final.length, stats: final.stats } })
  } catch (err) {
    self.postMessage({ type: 'error', data: err.message || String(err) })
  }
}
