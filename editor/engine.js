// The page's handle on the engine worker. Scripts run one at a time, the newest waiting its turn: a slider sends many
// versions, only the latest queued one runs next. A run answers once its script has run; its output then streams to
// the listener it came with, as events: `loading` (a file it opens, as it decodes, while the output has nothing yet),
// `arrived` (all of that file come, the output still nothing), `doing` (the steps it applies, or the one reading its
// input whole first, by name), `chunk` (the output), then `done` or `error`; or `skip`, when a newer script runs and its
// output takes over. An output made before (worker.js, renders kept) comes whole at once.
// Stop ends a run by replacing the worker.
const WORKER = new URL('./dist/worker.js', import.meta.url)
// The worker set off as the page starts (start, editor.html), its library and chunks loading while the page's own
// scripts still arrive; the first engine() takes it, unless it already failed to load
let early = null
export function start() {
  if (early) return
  early = new Worker(WORKER, { type: 'module' })
  early.onerror = event => { event.preventDefault?.(); early.failed = true }
}

export default function engine(url = WORKER) {
  const files = new Map(), pending = new Map(), described = new Map(), listeners = new Map()
  let worker, ids = 0, running = null, queued = null

  function spawn() {
    worker = url === WORKER && early && !early.failed ? early : new Worker(url, { type: 'module' })
    if (url === WORKER) early = null
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
    // The page's tab whose script runs, and whose output an export, a check or a measure reads: each tab's last output
    // stays in the worker, the page showing it again as it was (close lets it go)
    tab: null,
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
      const result = new Promise(resolve => { queued = { script: { ...script, tab: self.tab }, on, resolve } })
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
          resolve({ ...reply, output: { channels, sampleRate: last.sampleRate, duration: last.duration, stats: last.stats, markers: last.markers, bitDepth: last.bitDepth } })
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
    // an output's cues (`kind`: the edges of its pauses, or its hits) and pitch, named by the run that made it; cues null
    // once a newer output replaced it
    cues: (output, kind) => call({ type: 'cues', output, kind }).then(r => r.times ?? null),
    contour: output => call({ type: 'contour', output }).then(r => r.f0 ? r : { times: [], f0: [] }),
    // what it holds, as a musician says it: the note over `note` [from, to] s, the tempo and key over `span`
    listen: (output, note, span) => call({ type: 'listen', output, note, span }),
    export: request => call({ type: 'export', ...request, tab: self.tab }),
    // The spec's rules for the last output ({ output }, fn/check.js).
    check: spec => call({ type: 'check', spec, tab: self.tab }),
    // A prepared script's value (code.js prepare) on copies of the output shown and its source, and with `steps` the edits
    // its step(i) reads (code.js stages, each script prepared), as JSON: { value, measured } or { error }
    evaluate: script => call({ type: 'eval', ...script, tab: self.tab }),
    // A tab closed: its output goes
    close: tab => call({ type: 'close', tab }),
    // A prepared script's sound whole, as the edits make it (the chain flattened up to a step): { channels, sampleRate,
    // markers, regions } or { error }
    bake: script => call({ type: 'bake', ...script }),
    // The source it opened, level-matched to `loudness` (LUFS), for A/B listening.
    original: (source, loudness) => call({ type: 'original', source, loudness }),
    // What plays, made and rendered here as it plays (worker.js voice): a facade of the library's (audio/worker) the page
    // plays as an instance, or null when there is none (the output gone, the engine stopped)
    async voice(what) {
      const r = await call({ type: 'voice', ...what })
      if (!r.inst) return null
      const { default: audioWorker } = await import('../worker.js')
      return audioWorker.adopt(r.inst, { worker })
    },
    // A plugin's parameters from its manifest, fetched once.
    describe(name) {
      if (!described.has(name)) described.set(name, call({ type: 'describe', name }).then(r => r.params ?? null))
      return described.get(name)
    }
  }
  return self
}
