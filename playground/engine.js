// The page's handle on the engine worker. Scripts run one at a time, the newest waiting its turn: a slider sends many
// versions, only the latest queued one runs next. A run answers once its script has run; its output then streams to
// the listener it came with, as events: `loading` (a file it opens, as it decodes, while the output has nothing yet),
// `arrived` (all of that file come, the output still nothing), `doing` (the steps it applies, or the one reading its
// input whole first, by name), `tracks` (a script's tracks, each its own picture, before their mix), `chunk` (the
// output), then `done` or `error`; or `skip`, when a newer script runs and its output takes over. An output made before (worker.js, renders kept) comes whole at once. A page that draws peaks
// (`peaks`) gets those of a sound longer than it holds, in place of its samples (`long`, worker.js feed), and asks for
// the samples where it zooms in (samples).
// Stop ends a run where the worker is free to hear it, its outputs kept; a worker held by a step that reads its input
// whole (a model's pass, a plugin over all of it) for longer than HELD ms is replaced instead, as it is when a newer
// run waits on it: the outputs it kept then go with it (onrestart).
const HELD = 500
// calls a worker replaced would lose work of its own in: what an export or a check is still making
const LASTING = new Set(['export', 'bake', 'check', 'eval'])
const WORKER = new URL('./dist/worker.js', import.meta.url)
// The deck: what plays of a sound the page holds is made and rendered in a worker of its own, the engine's code running
// no script there, so neither the page's thread nor a script's processing (a model's pass, a plugin over all of it), nor
// a Stop, holds it up. Each sound goes to it once, a copy, by key; the last KEPT stay, the one playing and the one taking
// over from it
const KEPT = 2
// The worker set off as the page starts (start, playground.html), its library and chunks loading while the page's own
// scripts still arrive; the first engine() takes it, unless it already failed to load
let early = null
export function start() {
  if (early) return
  early = new Worker(WORKER, { type: 'module' })
  early.onerror = event => { event.preventDefault?.(); early.failed = true }
}

// The deck's worker, started when something first plays: voice(held, what), [its reply, the worker]; one that fails
// answers null, and the player plays the page's samples itself
function decks(url) {
  let worker = null, ids = 0, kept = []
  const pending = new Map()
  const call = (message, transfer) => new Promise(resolve => {
    if (!worker) {
      worker = new Worker(url, { type: 'module' })
      worker.onmessage = ({ data }) => { pending.get(data.id)?.(data); pending.delete(data.id) }
      worker.onerror = event => { event.preventDefault?.(); for (const r of pending.values()) r(null); pending.clear(); worker = null; kept = [] }
    }
    const id = ++ids
    pending.set(id, resolve)
    worker.postMessage({ ...message, id }, transfer)
  })
  const hold = (key, sound) => { kept = [...kept.filter(k => k !== key), key].slice(-KEPT); call({ type: 'hold', key, ...sound, keep: kept }) }
  // sounds still arriving, by key: { sampleRate, count, parts }, their pieces kept here till one first plays (nothing goes
  // to the deck, nor starts it, for a sound no one plays), then pushed as they come
  const coming = new Map()
  return {
    async voice({ key, channels, sampleRate }, what) {
      const c = coming.get(key)
      if (c?.parts) { hold(key, { count: c.count, sampleRate: c.sampleRate }); for (const p of c.parts) call({ type: 'push', key, channels: p }); c.parts = null }
      else if (!c && !kept.includes(key)) hold(key, { channels, sampleRate })
      const r = call({ type: 'voice', held: key, ...what }), from = worker
      return [await r, from]
    },
    // a sound still arriving, of `count` channels, its pieces given as they come; the last KEPT kept
    arrive(key, sampleRate, count) {
      coming.set(key, { sampleRate, count, parts: [] })
      for (const k of [...coming.keys()].slice(0, -KEPT)) coming.delete(k)
    },
    push(key, channels) {
      const c = coming.get(key)
      if (c?.parts) c.parts.push(channels)
      else if (c) call({ type: 'push', key, channels })
    }
  }
}

export default function engine(url = WORKER) {
  // `held`: run id → the timer replacing the worker, unless it says it took the run (taken) by then
  const files = new Map(), pending = new Map(), described = new Map(), listeners = new Map(), held = new Map()
  let worker, ids = 0, running = null, queued = null

  function spawn() {
    worker = url === WORKER && early && !early.failed ? early : new Worker(url, { type: 'module' })
    if (url === WORKER) early = null
    worker.onmessage = ({ data }) => {
      if (data.event === 'taken') return clearTimeout(held.get(data.id)), held.delete(data.id)
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
  // Every call waiting on the worker ends with `message`, and every stream as `ended` says: an error, by default
  function end(message, ended = on => on.error?.({ error: { message } })) {
    for (const call of pending.values()) call.resolve({ error: { message } })
    pending.clear()
    for (const on of listeners.values()) ended(on)
    listeners.clear()
  }
  const call = (message, transfer = [], on) => new Promise(resolve => {
    const id = ++ids
    pending.set(id, { resolve, type: message.type, message })
    if (on) listeners.set(id, on)
    worker.postMessage({ ...message, id }, transfer)
  })
  spawn()
  // A new worker in place of one held, what waited on it ended (end), but a plugin's parameters, asked of the new one
  function replace(message, ended) {
    worker.terminate()
    for (const t of held.values()) clearTimeout(t)
    held.clear()
    const again = [...pending].filter(([, c]) => c.type === 'describe')
    for (const [id] of again) pending.delete(id)
    end(message, ended)
    spawn()
    for (const [id, c] of again) { pending.set(id, c); worker.postMessage({ ...c.message, id }) }
    self.onrestart?.()
  }
  // Whether the worker may be replaced for run `id`: an older output streams, which it no longer needs, and nothing of
  // lasting work waits on it
  const replaceable = id => [...listeners.keys()].some(k => k < id) && ![...pending.values()].some(c => LASTING.has(c.type))

  async function drain() {
    while (queued) {
      const { script, on, resolve } = queued
      queued = null
      running = script
      const reply = await submit(script, on)
      // older outputs still streaming stop; each hears it was skipped
      if (!reply.error) for (const [id, older] of listeners) if (id < reply.id) { listeners.delete(id); older.skip?.() }
      if (reply.error || !reply.output) listeners.delete(reply.id)
      resolve(reply)
    }
    running = null
  }
  // A run sent; while an older output streams, a worker that has not taken it within HELD ms is held by that output's
  // step: replaced, the older output skipped, and the run sent to the new one
  function submit(script, on) {
    const reply = call({ type: 'run', ...script }, [], on), id = ids
    if (!replaceable(id)) return reply
    return new Promise(resolve => {
      reply.then(resolve)
      held.set(id, setTimeout(() => {
        held.delete(id)
        if (!pending.has(id) || !replaceable(id)) return
        pending.delete(id)
        listeners.delete(id)
        replace('Stopped.', on => on.skip?.())
        call({ type: 'run', ...script }, [], on).then(resolve)
      }, HELD))
    })
  }

  const deck = decks(url)
  const self = {
    // The page's tab whose script runs, and whose output an export, a check or a measure reads: each tab's last output
    // stays in the worker, the page showing it again as it was (close lets it go)
    tab: null,
    // The channel samples the page holds of an output: past them it draws its peaks (gl-waveform's), with samples where it
    // zooms in; 0, it holds them all
    peaks: 0,
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
      const result = new Promise(resolve => { queued = { script: { ...script, tab: self.tab, peaks: self.peaks }, on, resolve } })
      if (!running) drain()
      return result
    },
    // A run with its whole output: { logs, value, saves, output: { channels, sampleRate, duration, stats, bitDepth,
    // tracks } }, or { error }, as the page shows them once everything has come; `tracks`, a script's tracks, each
    // { name, length, mono, silences }
    render(script) {
      return new Promise(resolve => {
        const parts = []
        let reply = null, last = null, lanes = null
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
          resolve({ ...reply, output: { channels, sampleRate: last.sampleRate, duration: last.duration, stats: last.stats, markers: last.markers, bitDepth: last.bitDepth, ...lanes && { tracks: lanes.tracks } } })
        }
        self.run(script, {
          tracks: m => { lanes = m },
          chunk: m => parts.push(m),
          done: m => { last = m; settle() },
          error: m => { last = m; settle() },
          skip: () => { last = { event: 'skip' }; settle() }
        }).then(r => { reply = r; settle() })
      })
    },
    // A run's output, or a script, stopped: the worker told to, its outputs kept, or, held past HELD ms, replaced;
    // true when it was (what it kept went with it)
    async stop() {
      queued?.resolve({ skipped: true })
      queued = null
      const told = call({ type: 'stop' }), late = new Promise(resolve => setTimeout(resolve, HELD, 'late'))
      if (await Promise.race([told, late]) === 'late') { replace('Stopped.'); return true }
      for (const on of listeners.values()) on.error?.({ error: { message: 'Stopped.' } })
      listeners.clear()
      return false
    },
    // The worker replaced, all it kept gone: set by the page
    onrestart: null,
    // an output's cues (`kind`: the edges of its pauses, or its hits) and pitch, named by the run that made it, or one of
    // its tracks' (`track`, its index); cues null once a newer output replaced it
    cues: (output, kind, track) => call({ type: 'cues', output, kind, track }).then(r => r.times ?? null),
    contour: (output, track) => call({ type: 'contour', output, track }).then(r => r.f0 ? r : { times: [], f0: [] }),
    // what it holds, as a musician says it: the note over `note` [from, to] s, the tempo and key over `span`
    listen: (output, note, span) => call({ type: 'listen', output, note, span }),
    export: request => call({ type: 'export', ...request, tab: self.tab }),
    // The spec's rules for the last output ({ output }, fn/check.js).
    check: spec => call({ type: 'check', spec, tab: self.tab }),
    // A prepared script's value (code.js prepare) on copies of the output shown and its source, and with `steps` the edits
    // its step(i) reads (code.js stages, each script prepared; a track's with `track`, its index), as JSON: { value,
    // measured } or { error }
    evaluate: script => call({ type: 'eval', ...script, tab: self.tab }),
    // A tab closed: its output goes
    close: tab => call({ type: 'close', tab }),
    // A prepared script's sound whole, as the edits make it (the chain flattened up to a step): { channels, sampleRate,
    // markers, regions } or { error }
    bake: script => call({ type: 'bake', ...script }),
    // The source it opened, level-matched to `loudness` (LUFS), for A/B listening.
    original: (source, loudness) => call({ type: 'original', source, loudness, hold: self.peaks || undefined }),
    // What plays, made and rendered as it plays (worker.js voice): { voice }, a facade of the library's (audio/worker) the
    // page plays as an instance, or null when there is none (the output gone, the engine stopped). Boxed: a voice of a
    // sound still arriving is thenable, waiting for it to be whole, and a promise resolved with it would wait as long. Of
    // a sound the page holds (`held`: { key, channels, sampleRate }), in the deck; else here
    async voice({ held, ...what }) {
      const [r, from] = held ? await deck.voice(held, what) : [await call({ type: 'voice', ...what }), worker]
      if (!r?.inst) return null
      const { default: audioWorker } = await import('../worker.js')
      return { voice: audioWorker.adopt(r.inst, { worker: from }) }
    },
    // Samples [from, to) of an output, each channel's; null once a newer output replaced it
    samples: (output, from, to) => call({ type: 'samples', output, from, to }).then(r => r.channels ?? null),
    // A sound arriving that the page draws as it comes (its key, its rate, its channels' count), to play as far as it has
    // come: its pieces pushed to the deck in order, a voice of it then { held: { key } }
    arrive: (key, sampleRate, count) => deck.arrive(key, sampleRate, count),
    push: (key, channels) => deck.push(key, channels),
    // A plugin's parameters from its manifest, fetched once: asked again where the worker went before it answered
    describe(name) {
      if (!described.has(name)) described.set(name, call({ type: 'describe', name }).then(r => { if (r.error) described.delete(name); return r.params ?? null }))
      return described.get(name)
    }
  }
  return self
}
