// The deck's worker (engine.js decks): the sounds the page holds, handed here, and what plays of them (heard.js), made
// and rendered here as it plays into the page's deck, the engine's scripts running elsewhere, so none of them holds it
// up. The library as playback needs it and no more: its build hands audio/worker this set, not the whole library
// (.site-build.js), an edit heard as it is dragged (a pitch) loading its op on first use
import audio from '../core.js'
import '../plan.js'
import '../stats.js'
import '../fn/play.js'
import '../fn/crop.js'
import '../fn/filter.js'
import '../fn/pad.js'
import '../fn/mix.js'
import { expose } from '../worker.js'
import { heard } from './heard.js'

const later = { pitch: () => import('../fn/pitch.js') }

// The sounds the page handed, by key: whole, or still arriving (`count` channels, its pieces pushed as they come: what
// plays of it plays what has come); those `keep` names stay, the rest go
const holding = new Map()
const handlers = {
  hold: ({ key, channels, count, sampleRate, keep }) => {
    holding.set(key, channels ? audio.from(channels, { sampleRate }) : audio(null, { sampleRate, channels: count }))
    for (const k of holding.keys()) if (!keep.includes(k)) holding.delete(k)
    return {}
  },
  push: ({ key, channels }) => { holding.get(key)?.push(channels); return {} },
  // What plays of one (heard.js): all of it, a band, its boxes, or a moment through an edit; the page adopts it
  // (audio/worker) and plays it, rendered here as it plays. A copy of the one kept, sharing its samples
  async voice({ held, ...as }) {
    const h = holding.get(held)
    if (!h) return { inst: null }
    if (as.edit && !audio.op(as.edit[0])) await (later[as.edit[0]] ?? (() => audio.use(as.edit[0])))()
    return { inst: expose(heard(h.clone(), as)) }
  }
}

self.onmessage = async ({ data }) => {
  let reply
  try { reply = await handlers[data.type](data) }
  catch (error) { reply = { error: error?.message ?? String(error) } }
  self.postMessage({ id: data.id, ...reply })
}
