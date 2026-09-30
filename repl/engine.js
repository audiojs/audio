// The page's handle on the engine worker. Scripts run one at a time, the newest waiting its turn: a slider sends many
// versions, only the latest queued one runs next. A run answers once its script has run; its output then streams to
// the listener it came with, as events: `loading` (a file it opens, as it decodes, while the output has nothing yet),
// `chunk` (the output), then `done` or `error`; or `skip`, when a newer script runs and its output takes over.
// Stop ends a run by replacing the worker.
export default function engine(url = new URL('./dist/worker.js', import.meta.url)) {
  const files = new Map(), pending = new Map(), described = new Map(), listeners = new Map()
  let worker, ids = 0, running = null, queued = null

  function spawn() {
    worker = new Worker(url, { type: 'module' })
    worker.onmessage = ({ data }) => {
      if (data.event) {
        const on = listeners.get(data.id)
        if (data.event === 'done' || data.event === 'error') listeners.delete(data.id)
        return on?.[data.event]?.(data)
      }
      const call = pending.get(data.id)
      pending.delete(data.id)
      call?.resolve(data)
    }
    worker.onerror = event => {
      event.preventDefault?.()
      end(event.message || 'The engine stopped.')
    }
    for (const [name, data] of files) worker.postMessage({ type: 'file', name, data, id: 0 })
  }
  // Every call and stream waiting on the worker ends with `message`
  function end(message) {
    for (const call of pending.values()) call.resolve({ error: { message } })
    pending.clear()
    for (const on of listeners.values()) on.error?.({ error: { message } })
    listeners.clear()
  }
  const call = (message, transfer = [], on) => new Promise(resolve => {
    const id = ++ids
    pending.set(id, { resolve })
    if (on) listeners.set(id, on)
    worker.postMessage({ ...message, id }, transfer)
  })
  spawn()

  async function drain() {
    while (queued) {
      const { script, on, resolve } = queued
      queued = null
      running = script
      const reply = await call({ type: 'run', ...script }, [], on)
      // older outputs still streaming stop; each hears it was skipped
      if (!reply.error) for (const [id, older] of listeners) if (id < reply.id) { listeners.delete(id); older.skip?.() }
      if (reply.error || !reply.output) listeners.delete(reply.id)
      resolve(reply)
    }
    running = null
  }

  const self = {
    // A file the scripts can open by name; null forgets it.
    file(name, data) {
      data == null ? files.delete(name) : files.set(name, data)
      return call({ type: 'file', name, data })
    },
    has: name => files.has(name),
    get names() { return [...files.keys()] },
    // Runs a prepared script, its output streaming to `on`; a newer run() before it starts supersedes it, resolving
    // the older one with { skipped }.
    run(script, on = {}) {
      queued?.resolve({ skipped: true })
      const result = new Promise(resolve => { queued = { script, on, resolve } })
      if (!running) drain()
      return result
    },
    // A run with its whole output: { logs, value, saves, output: { channels, sampleRate, duration, stats, bitDepth } },
    // or { error }, as the page shows them once everything has come.
    render(script) {
      return new Promise(resolve => {
        const parts = []
        let reply = null, last = null
        const settle = () => {
          if (!reply || !last && reply.output && !reply.error && !reply.skipped) return
          if (last?.event === 'skip') return resolve({ ...reply, skipped: true, output: null })
          if (last?.event === 'error') return resolve({ ...reply, error: last.error, output: null })
          if (!last || last.event !== 'done') return resolve({ ...reply, output: null })
          const length = Math.round(last.duration * last.sampleRate)
          const channels = Array.from({ length: last.channels }, (_, c) => {
            const x = new Float32Array(length)
            for (const p of parts) x.set(p.channels[c].subarray(0, Math.max(0, length - p.at)), p.at)
            return x
          })
          resolve({ ...reply, output: { channels, sampleRate: last.sampleRate, duration: last.duration, stats: last.stats, bitDepth: last.bitDepth } })
        }
        self.run(script, {
          chunk: m => parts.push(m),
          done: m => { last = m; settle() },
          error: m => { last = m; settle() },
          skip: () => { last = { event: 'skip' }; settle() }
        }).then(r => { reply = r; settle() })
      })
    },
    stop() {
      worker.terminate()
      end('Stopped.')
      queued?.resolve({ skipped: true })
      queued = null
      spawn()
    },
    // an output's hits and pitch, named by the run that made it; hits null once a newer output replaced it
    onsets: output => call({ type: 'onsets', output }).then(r => r.times ?? null),
    contour: output => call({ type: 'contour', output }).then(r => r.f0 ? r : { times: [], f0: [] }),
    export: request => call({ type: 'export', ...request }),
    // The spec's rules for the last output ({ output }, fn/check.js).
    check: spec => call({ type: 'check', spec }),
    // The source it opened, level-matched to `loudness` (LUFS), for A/B listening.
    original: (source, loudness) => call({ type: 'original', source, loudness }),
    // A plugin's parameters from its manifest, fetched once.
    describe(name) {
      if (!described.has(name)) described.set(name, call({ type: 'describe', name }).then(r => r.params ?? null))
      return described.get(name)
    }
  }
  return self
}
