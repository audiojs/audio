// A custom worker (test/fix-worker.js in Node, test/play.js in the browser): the app's own messages on the Worker
// beside the engine, and instances the app makes, exposed for the page to adopt. Its ids collide with the engine's
// on purpose. And pages on disk in a worker, where the browser's file system opens a file to one handle at a time.
import audio from '../audio.js'
import { expose } from '../worker.js'

const port = typeof WorkerGlobalScope !== 'undefined' ? self : (await import('node:worker_threads')).parentPort
const on = fn => port.on ? port.on('message', fn) : port.addEventListener('message', e => fn(e.data))

on(async m => {
  // A page's file read and written at once, as an eviction, a read restoring the page and a seek's prefetch may (a
  // browser worker's OPFS, where a file opens to one access handle at a time): each read the page as written, or why not
  if (m?.type === 'pages') {
    let store = await audio.opfsCache('worker-app-pages'), page = [Float32Array.from({ length: 4096 }, (_, i) => i / 4096)]
    try {
      let got = await Promise.all([store.write(0, page), store.read(0), store.write(0, page), store.read(0), store.read(0)])
      port.postMessage({ id: m.id, read: got.filter(Boolean).map(([x]) => x.length === 4096 && x.every((v, i) => v === page[0][i])) })
    } catch (e) { port.postMessage({ id: m.id, error: `${e.name}: ${e.message}` }) }
    return
  }
  if (m?.type !== 'make') return   // the engine's handshake (Node; a browser worker never sees it), or not the app's
  let a = audio.from(t => 0.5 * Math.sin(2 * Math.PI * (m.freq ?? 440) * t), { duration: m.duration, sampleRate: 44100 }).gain(m.gain ?? -6)
  port.postMessage({ id: m.id, made: expose(a), again: expose(a) })
})
