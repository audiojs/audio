/**
 * audio/worker — Worker entry point for decode offloading.
 * Loaded by audio.js when opts.decode === 'worker'.
 * Calls decodeBuf in the worker thread, posts progress + result back.
 */
import { decodeBuf } from './core.js'

self.onmessage = async (e) => {
  try {
    let result = await decodeBuf(e.data.buf, (progress) => {
      self.postMessage({ type: 'progress', data: progress })
    })
    self.postMessage({ type: 'done', data: result })
  } catch (err) {
    self.postMessage({ type: 'error', data: err.message || String(err) })
  }
}
