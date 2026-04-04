/**
 * audio/worker — Worker entry point for decode offloading.
 * Loaded by audio.js when opts.decode === 'worker'.
 */
import { decodeSource } from './decode.js'

self.onmessage = async (e) => {
  try {
    let result = await decodeSource(e.data.buf, (progress) => {
      self.postMessage({ type: 'progress', data: progress })
    })
    self.postMessage({ type: 'done', data: result })
  } catch (err) {
    self.postMessage({ type: 'error', data: err.message || String(err) })
  }
}
