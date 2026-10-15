/**
 * audio/parallel — jobs made at once, each on a thread of its own, one file, two faces.
 *
 * On the calling side, parallel(mod, shared, jobs, solve): each job made by `solve(shared, job)`, module `mod`'s export
 * of that name, the results in the jobs' order. In Node on worker threads (this file again, as their entry), one fewer than the cores, eight at
 * most; in a page or a worker, on the workers the host makes (audio.worker, a () → Worker whose entry calls serve());
 * with neither, here in turn, by the `solve` given. The jobs go out a few at a time as threads come free, `shared` once to each thread a
 * call; a view of part of a buffer goes as a copy of its part. A kernel whose jobs depend on `shared` alone comes out
 * the same, bit for bit, however they are spread (@audio/denoise-declip's declipAsync).
 *
 * Inside a thread, serve(load): `load(mod)` gives the module (an import() in Node; a page's entry, which has no import
 * maps, gives its own static imports):
 *   import { serve } from 'audio/parallel'
 *   import * as declip from '@audio/denoise/declip'
 *   serve(mod => ({ '@audio/denoise/declip': declip })[mod])
 */

import audio from './core.js'

const node = typeof process !== 'undefined' && !!process.versions?.node
const nodeWT = node ? await import('node:worker_threads').catch(() => null) : null
// the cores there are
const cores = node ? (await import('node:os')).availableParallelism?.() ?? 4 : globalThis.navigator?.hardwareConcurrency ?? 4

// a port's event heard, Node's or the web's, till the returned function is called
function on(port, type, fn) {
  if (port.on) { port.on(type, fn); return () => port.off(type, fn) }
  const f = type === 'message' ? e => fn(e.data) : fn
  port.addEventListener(type, f)
  return () => port.removeEventListener(type, f)
}

// the threads, one fewer than the cores, eight at most, made on first use and kept; none where there is no way to make one
let pool = null
function threads() {
  if (pool) return pool
  let make = audio.worker
  if (nodeWT?.isMainThread) {
    // the process's flags but those that make it a script of its own (node --input-type=module -e …), a thread's entry
    // being this file
    const execArgv = process.execArgv.filter((a, i, all) => !/^--(input-type|eval|print)\b|^-[ep]$/.test(a) && !/^-[ep]$|^--(eval|print)$/.test(all[i - 1] ?? ''))
    make = () => { const w = new nodeWT.Worker(new URL(import.meta.url), { workerData: { parallel: true }, execArgv }); w.unref(); return w }
  }
  return make ? pool = Array.from({ length: Math.max(1, Math.min(8, cores - 1)) }, make) : null
}

let ids = 0
export default async function parallel(mod, shared, jobs, solve) {
  const all = jobs.length > 1 && threads()
  if (!all) return jobs.map(j => solve(shared, j))
  shared = Object.fromEntries(Object.entries(shared).map(([k, v]) => [k, ArrayBuffer.isView(v) && v.byteLength !== v.buffer.byteLength ? v.slice() : v]))
  const id = ++ids, out = new Array(jobs.length), size = Math.max(1, Math.floor(jobs.length / (all.length * 8)))
  let next = 0
  await Promise.all(all.slice(0, Math.ceil(jobs.length / size)).map(w => new Promise((resolve, reject) => {
    const feed = () => {
      if (next >= jobs.length) { stop(); w.postMessage({ id, done: true }); return resolve() }
      const at = next
      next += size
      w.postMessage({ id, at, jobs: jobs.slice(at, next) })
    }
    const got = m => {
      if (m?.id !== id) return
      // a job that throws: the call rejects, every thread let go of it as its batch comes back
      if (m.error) { stop(); w.postMessage({ id, done: true }); next = jobs.length; return reject(new Error(m.error)) }
      m.out.forEach((v, i) => { out[m.at + i] = v })
      feed()
    }
    const offs = [on(w, 'message', got), on(w, 'error', e => { stop(); reject(e) })], stop = () => offs.forEach(off => off())
    w.postMessage({ id, mod, shared })
    feed()
  })))
  return out
}

// Inside a thread: each call's `shared` kept till it is done, each batch of its jobs made and sent back, their buffers
// moved, not copied
export function serve(load, port = nodeWT?.parentPort ?? globalThis) {
  const held = new Map()
  on(port, 'message', async m => {
    if (m.done) return held.delete(m.id)
    if (m.shared) return held.set(m.id, Promise.resolve(load(m.mod)).then(k => ({ solve: k.solve, shared: m.shared })))
    try {
      const { solve, shared } = await held.get(m.id), out = m.jobs.map(j => solve(shared, j))
      port.postMessage({ id: m.id, at: m.at, out }, out.map(v => v?.buffer).filter(b => b instanceof ArrayBuffer))
    } catch (e) { port.postMessage({ id: m.id, error: e?.message ?? String(e) }) }
  })
}

if (nodeWT && !nodeWT.isMainThread && nodeWT.workerData?.parallel) serve(mod => import(mod))
