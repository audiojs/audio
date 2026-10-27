// The page's handle on the engine worker. Scripts run one at a time, each tab's newest waiting its turn: a slider sends
// many versions, only the latest queued one of its tab runs next. A run answers once its script has run; its output
// then streams to the listener it came with, as events: `loading` (a file it opens, as it decodes, while the output has
// nothing yet), `arrived` (all of that file come, the output still nothing), `doing` (the steps it applies, or the one
// reading its input whole first, by name), `tracks` (a script's tracks, each its own picture, before their mix),
// `chunk` (the output), then `done` or `error`; or `skip`, when a newer script of its tab runs and its output takes
// over: another tab's run leaves it streaming, a tab left while it renders still rendering. An output made before
// (worker.js, renders kept) comes whole at once. A page that draws peaks (`peaks`) gets those of a sound longer than it
// holds, in place of its samples (`long`, worker.js feed), and asks for the samples where it zooms in (samples).
// Stop ends the tab's run where the worker is free to hear it, its outputs kept; a worker held by a step of that tab
// that reads its input whole (a model's pass, a plugin over all of it) for longer than HELD ms is replaced instead, as
// it is when a newer run of the tab waits on it, or when such a step still runs for what the tab no longer takes (a step
// turned off or taken away while its model runs: the worker says it is `held`), as nothing else stops it: the outputs it
// kept then go with it (onrestart), every tab's. Held by another tab's step, it is waited for; held by a model's pass
// the newer run still calls (`calls`, code.js prepare: another track edited, a step added after it), too, till the worker
// takes the run and judges it: replaced, that pass would start over, an edit of a second taking the model's minutes.
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
  // `held`: run id → { again: the run sent to a new worker in place of this one, timer: again unless the worker says it
  // took the run (taken) by then }; till the run's reply
  // `queued`: tab → its newest run waiting its turn; `tabOf`: a run's listener → its tab; `passing`: run id → { tab, op },
  // while a step of its reads its input whole (its `doing` step, `op` its method)
  const files = new Map(), pending = new Map(), described = new Map(), listeners = new Map(), held = new Map(), queued = new Map(), passing = new Map()
  const tabOf = new WeakMap()
  let worker, ids = 0, running = null

  function spawn(resend = true) {
    const ahead = url === WORKER && early && !early.failed
    worker = ahead ? early : new Worker(url, { type: 'module' })
    if (url === WORKER) early = null
    // nothing heard from it yet: a worker says nothing till it has loaded and been asked
    let heard = false
    worker.onmessage = ({ data }) => {
      heard = true
      if (data.event === 'taken') return clearTimeout(held.get(data.id)?.timer)
      if (data.event === 'held') return held.get(data.id)?.again()
      if (data.event) {
        const on = listeners.get(data.id)
        if (data.event === 'doing' && 'step' in data) data.step ? passing.set(data.id, { tab: data.tab, op: String(data.step).split(':')[0] }) : passing.delete(data.id)
        if (data.event === 'done' || data.event === 'error') { listeners.delete(data.id); passing.delete(data.id) }
        return on?.[data.event]?.(data)
      }
      const call = pending.get(data.id)
      pending.delete(data.id)
      call?.resolve(data)
    }
    worker.onerror = event => {
      event.preventDefault?.()
      // the one set off ahead, taken before its load failed (the page now comes up that soon): one of the page's own
      // in its place, sent all it was sent, in order, as though it were the first
      if (ahead && !heard) return anew()
      end(event.message || 'The engine stopped.')
    }
    if (resend) for (const [name, data] of files) worker.postMessage({ type: 'file', name, data, id: 0 })
  }
  function anew() {
    spawn(false)
    for (const [id, c] of pending) worker.postMessage({ ...c.message, id })
  }
  // Every call waiting on the worker ends with `message`, and every stream as `ended` says: an error, by default
  function end(message, ended = on => on.error?.({ error: { message } })) {
    for (const call of pending.values()) call.resolve({ error: { message } })
    pending.clear()
    for (const on of listeners.values()) ended(on)
    listeners.clear()
    passing.clear()
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
    for (const h of held.values()) clearTimeout(h.timer)
    held.clear()
    const again = [...pending].filter(([, c]) => c.type === 'describe')
    for (const [id] of again) pending.delete(id)
    end(message, ended)
    spawn()
    for (const [id, c] of again) { pending.set(id, c); worker.postMessage({ ...c.message, id }) }
    self.onrestart?.()
  }
  // Whether the worker may be replaced for run `id` of tab `tab`, calling `calls`: an older output of the tab streams,
  // which it no longer needs, no other tab's step holds it, nor one of the tab's it calls again, and nothing of lasting
  // work waits on it
  const lasting = () => [...pending.values()].some(c => LASTING.has(c.type))
  const others = tab => [...passing.values()].some(p => p.tab !== undefined && p.tab !== tab)
  const needed = (tab, calls) => [...passing.values()].some(p => p.tab === tab && calls?.includes(p.op))
  const replaceable = (id, tab, calls) => [...listeners].some(([k, on]) => k < id && tabOf.get(on) === tab) && !others(tab) && !needed(tab, calls) && !lasting()

  async function drain() {
    while (queued.size) {
      const [tab, { script, on, resolve }] = queued.entries().next().value
      queued.delete(tab)
      running = script
      const reply = await submit(script, on)
      // the tab's older outputs still streaming stop; each hears it was skipped
      if (!reply.error) for (const [id, older] of listeners) if (id < reply.id && tabOf.get(older) === tab) { listeners.delete(id); older.skip?.() }
      if (reply.error || !reply.output) listeners.delete(reply.id)
      resolve(reply)
    }
    running = null
  }
  // A run sent; while an older output streams, a worker that has not taken it within HELD ms is held by that output's
  // step, and one that says it is held runs a step no longer taken: replaced, the older output skipped, and the run sent
  // to the new one
  function submit(script, on) {
    tabOf.set(on, script.tab)
    const reply = call({ type: 'run', ...script }, [], on), id = ids
    return new Promise(resolve => {
      reply.then(r => { clearTimeout(held.get(id)?.timer); held.delete(id); resolve(r) })
      const again = () => {
        clearTimeout(held.get(id)?.timer)
        held.delete(id)
        if (!pending.has(id) || lasting()) return
        pending.delete(id)
        listeners.delete(id)
        replace('Stopped.', on => on.skip?.())
        call({ type: 'run', ...script }, [], on).then(resolve)
      }
      held.set(id, { again, timer: replaceable(id, script.tab, script.calls) && setTimeout(() => replaceable(id, script.tab, script.calls) && again(), HELD) })
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
    // Runs a prepared script, its output streaming to `on`; a newer run() of its tab before it starts supersedes it,
    // resolving the older one with { skipped }.
    run(script, on = {}) {
      const tab = self.tab
      queued.get(tab)?.resolve({ skipped: true })
      queued.delete(tab)
      const result = new Promise(resolve => { queued.set(tab, { script: { ...script, tab, peaks: self.peaks }, on, resolve }) })
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
    // The tab's run's output, or its script, stopped: the worker told to, its outputs kept, or, held past HELD ms or by a
    // step of the tab reading its input whole (a model's pass, which nothing else stops), replaced; true when it was
    // (what it kept went with it). Held by another tab's step alone, it hears the stop once that step is done
    async stop() {
      const tab = self.tab
      queued.get(tab)?.resolve({ skipped: true })
      queued.delete(tab)
      const told = call({ type: 'stop', tab }), late = new Promise(resolve => setTimeout(resolve, HELD, 'late'))
      const r = await Promise.race([told, late])
      if (r === 'late' && !others(tab) || r.held) { replace('Stopped.'); return true }
      for (const [id, on] of listeners) if (tabOf.get(on) === tab) { listeners.delete(id); on.error?.({ error: { message: 'Stopped.' } }) }
      return false
    },
    // The worker replaced, all it kept gone: set by the page
    onrestart: null,
    // an output's cues (`kind`: the edges of its pauses, or its hits) and pitch, named by the run that made it, or one of
    // its tracks' (`track`, its index); cues [{ t, rank }] (a hit's rank how far it jumps, dB; an edge's none), null once
    // a newer output replaced it
    cues: (output, kind, track) => call({ type: 'cues', output, kind, track }).then(r => r.times?.map((t, i) => ({ t, rank: r.ranks?.[i] ?? Infinity })) ?? null),
    contour: (output, track) => call({ type: 'contour', output, track }).then(r => r.f0 ? r : { times: [], f0: [] }),
    // what it holds, as a musician says it: the note over `note` [from, to] s, the tempo and key over `span`
    listen: (output, note, span) => call({ type: 'listen', output, note, span }),
    chords: (output, at) => call({ type: 'chords', output, at }),
    // [at, at + duration] s of an output as WAV bytes, at `bitDepth`; null once a newer output replaced it
    wav: (output, at, duration, bitDepth) => call({ type: 'wav', output, at, duration, bitDepth }).then(r => r.bytes ?? null),
    export: request => call({ type: 'export', ...request, tab: self.tab }),
    // The spec's rules for the last output ({ output }, fn/check.js).
    check: spec => call({ type: 'check', spec, tab: self.tab }),
    // A prepared script's value (code.js prepare) on copies of the output shown and its source, and with `steps` the edits
    // its step(i) reads (code.js stages, each script prepared; a track's with `track`, its index), as JSON: { value,
    // measured } or { error }
    evaluate: script => call({ type: 'eval', ...script, tab: self.tab }),
    // A tab closed: its run waiting goes, its output streaming stops, heard as skipped, and its output goes
    close(tab) {
      queued.get(tab)?.resolve({ skipped: true })
      queued.delete(tab)
      for (const [id, on] of listeners) if (tabOf.get(on) === tab) { listeners.delete(id); on.skip?.() }
      return call({ type: 'close', tab })
    },
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
    // Samples [from, to) of an output, each channel's (with tracks, each track's lane, or `mix` their mix); null once a
    // newer output replaced it
    samples: (output, from, to, mix = false) => call({ type: 'samples', output, from, to, mix }).then(r => r.channels ?? null),
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
