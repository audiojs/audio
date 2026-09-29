// A custom worker (test/fix-worker.js in Node, test/play.js in the browser): the app's own messages on the Worker
// beside the engine, and instances the app makes, exposed for the page to adopt. Its ids collide with the engine's
// on purpose.
import audio from '../audio.js'
import { expose } from '../worker.js'

const port = typeof WorkerGlobalScope !== 'undefined' ? self : (await import('node:worker_threads')).parentPort
const on = fn => port.on ? port.on('message', fn) : port.addEventListener('message', e => fn(e.data))

on(m => {
  if (m?.type !== 'make') return   // the engine's handshake (Node; a browser worker never sees it), or not the app's
  let a = audio.from(t => 0.5 * Math.sin(2 * Math.PI * (m.freq ?? 440) * t), { duration: m.duration, sampleRate: 44100 }).gain(m.gain ?? -6)
  port.postMessage({ id: m.id, made: expose(a), again: expose(a) })
})
