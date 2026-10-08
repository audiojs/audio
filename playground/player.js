import audio from '../assets/audio.js'
import { cycle } from './meters.js'
import { heard } from './heard.js'

// Plays the output with the library's own playback, into a deck on the page's one AudioContext (audio.context). What
// plays is made and rendered as it plays in a worker (set's `open`, engine.js voice: an audio/worker facade the page
// plays as an instance): the deck's, of its own, for a sound the page holds, so neither the page's thread nor the
// engine's processing holds it up; the engine's for a long one, whose samples it has; with none to open (a test), here,
// of the samples the view draws, shared, not copied. A new output while playing takes over where it is, crossfaded
// (play({ from })), so a slider is heard as it moves; a band [low, high] plays through 24 dB an octave filters
// (highpass, lowpass), open at the ends of hearing, and several boxes [a, b, low, high], each its band over its time,
// over silence (heard.js); loop seams, starts and stops are the library's, crossfaded. The position is what the speakers
// play now: the library reads the device's own clock.
// Scrubbing plays the moment under a caret instead (scrub.js), for as long as it is held, as it moves, on the same
// context. Playback pauses while it sounds.
export default function player({ onend = () => {} } = {}) {
  let channels = null, length = 0, rate = 0, open = null, local = null, voice = null, only = null, at = 0, outs = 0
  // a long sound's samples near where it is heard (near): fetched as they are needed (set's `fetch`), the last asked for
  // ({ from, to, got }) the one kept
  let fetch = null, held = null, asking = null
  let scrubbing = null, scrubbed = null, loaded = null, heldBy = null, mode = 'hybrid', speed = 1
  // a moment heard as an edit being dragged will leave it (audition), and how many were asked for
  let hearing = null, auditions = 0
  // the latest of play and pause wins: a play still opening the device when a pause comes stays paused
  let intent = 0
  // where a play asked to start, the clock's until the voice goes there: what plays meanwhile is the place it left
  let aim = null

  // What plays of the output (heard.js), boxed, { voice } (engine.js voice: one still arriving is thenable): the deck's or
  // the engine's, or, with none, made here of the samples; null for a sound the page holds none of (a long one) the
  // engine no longer has
  async function made(o) {
    const v = await open?.(o).catch(() => null)
    if (v) return v
    if (!channels) return null
    local ??= audio.from(channels, { sampleRate: rate })
    return { voice: heard(local, o) }
  }
  // a voice tells the page when it reaches its end by itself; one taken over or stopped goes quietly
  function watch(v) {
    v.on('ended', () => { if (voice === v && v.ended) { at = v.currentTime; voice = null; onend() } })
    return v
  }
  // a voice done with stops and goes; the samples here stay, for the next play
  const release = v => v === local ? v?.stop() : v?.dispose()
  // a facade's call answers later: one that finds its voice gone says nothing
  const calm = r => { if (r instanceof Promise) r.catch(() => {}) }
  const same = o => JSON.stringify(o) === JSON.stringify(only)
  const duration = () => length / rate
  // The samples about time `t`: the output's own, or for a long one a window of WINDOW s about it, { x, from } (its first
  // sample), fetched again once `t` comes within a quarter of its edge, or anywhere else; null till it has come
  const WINDOW = 30
  function near(t) {
    if (channels) return { x: channels, from: 0 }
    if (!fetch || !length) return null
    const i = Math.round(t * rate), w = WINDOW * rate, n = held?.x[0].length ?? 0
    const inside = held && i >= held.from && i < held.from + n, edge = held && (i - held.from < w / 4 && held.from > 0 || held.from + n - i < w / 4 && held.from + n < length)
    const coming = asking && i >= asking.from && i < asking.to
    if ((!inside || edge) && !coming) {
      const from = Math.max(0, Math.min(length - w, i - w / 2)) | 0, to = Math.min(length, from + w), of = outs
      const ask = asking = { from, to }
      ask.got = Promise.resolve(fetch(from, to)).then(x => { if (of === outs && asking === ask && x?.length) held = { x, from } }).catch(() => {}).finally(() => { if (asking === ask) asking = null })
    }
    return inside ? held : null
  }

  // The scrub voice hears the output as it is, every channel at its own rate (scrub.js reads it at the device's), sent
  // the first time a scrub needs it after each new output; a node with as many outputs as the output has channels.
  async function scrubber() {
    const ctx = audio.context
    await ctx.resume()
    loaded ||= ctx.audioWorklet.addModule(new URL('./scrub.js', import.meta.url))
    await loaded
    const w = near(scrubbed ?? 0), n = w?.x.length || 1
    if (!scrubbing || scrubbing.channels !== n) {
      scrubbing?.node.disconnect()
      const node = new AudioWorkletNode(ctx, 'scrub', { outputChannelCount: [n] })
      node.connect(ctx.destination)
      node.port.postMessage({ mode })
      scrubbing = { node, channels: n, of: null }
    }
    if (w && scrubbing.of !== w.x) {
      scrubbing.of = w.x
      scrubbing.from = w.from
      const x = w.x.map(c => c.slice())
      scrubbing.node.port.postMessage({ x, rate }, x.map(c => c.buffer))
    }
    return scrubbing
  }

  return {
    get playing() { return !!voice?.playing && !voice.paused },
    get time() { return aim ?? (voice ? voice.currentTime : at) },
    // What the speakers play now, as RMS over the 50 ms around the playhead, all channels; 0 when stopped
    get level() {
      const w = this.playing && near(voice.currentTime)
      if (!w) return 0
      const i = Math.round(voice.currentTime * rate) - w.from, half = Math.round(rate * .025)
      let sum = 0, n = 0
      for (const x of w.x) for (let k = Math.max(0, i - half); k < Math.min(x.length, i + half); k++, n++) sum += x[k] * x[k]
      return n ? Math.sqrt(sum / n) : 0
    },
    // What the speakers play now, one cycle of it eased into the trace t (meters.js); left as it was when stopped
    trace(t) {
      const w = this.playing && near(voice.currentTime)
      if (w) cycle(w.x, voice.currentTime * rate - w.from, rate, t)
      return t
    },
    // A new output, `pcm` at `sampleRate`, `n` samples long, and what opens it to play (made); a long one with no samples
    // here (pcm null), played by the engine alone, its samples near where it is heard fetched by `fetch(from, to)`. While
    // one plays, the new one takes over where it is, the one before playing on until it can
    async set(pcm, sampleRate, opens = null, n = pcm?.[0]?.length ?? 0, fetching = null) {
      // the scrub voice loads with the first output, so the first press sounds at once
      if (pcm?.[0]?.length) loaded ||= audio.context.audioWorklet.addModule(new URL('./scrub.js', import.meta.url))
      const mine = ++outs, prev = voice, was = local
      channels = pcm?.[0]?.length ? pcm : null
      length = n
      fetch = fetching; held = null
      rate = sampleRate
      open = opens
      local = null
      if (heldBy) scrubber()
      if (!(prev?.playing && length)) {
        release(prev)
        if (prev !== was) was?.dispose()
        voice = only = null
        at = Math.min(at, duration())
        return
      }
      const next = (await made(only ?? {}))?.voice
      if (mine !== outs || voice !== prev) return release(next)
      if (!next) { release(prev); voice = only = null; return }
      voice = watch(next)
      if (prev.playing) voice.play({ from: prev })
      release(prev)
      if (prev !== was) was?.dispose()
    },
    // A sound still arriving, at `sampleRate`, opened by `opens` as set's is, `n` samples of it come: what plays of it
    // plays what has come, its length growing by grow(n) as pieces come, till set() gives the whole of it; playing, each
    // takes over where it is
    arrive(sampleRate, opens, n = 0) { return this.set(null, sampleRate, opens, n) },
    grow(n) { length += n },
    // Plays the span from `from` to `to` (or the end), looped or not, starting at `start` in it (its start by default),
    // only `band` [low, high] Hz of it, or only `boxes`, if given; while it plays, or is paused, the same go there
    async play({ from = 0, to = null, loop = false, band = null, boxes = null, start = from } = {}) {
      if (!length) return
      const mine = ++intent, o = { band, boxes }
      aim = start
      await audio.context.resume()
      if (mine !== intent) return
      const span = { at: from, duration: to == null ? undefined : to - from, loop }
      if (!(voice?.playing && same(o))) {
        // a new output while it opens: it opens that one instead
        let prev, of, next
        do { release(next); prev = voice; of = outs; next = (await made(o))?.voice } while (mine === intent && (voice !== prev || of !== outs))
        if (mine !== intent) return release(next)
        if (!next) { aim = null; return }
        release(prev)
        only = o
        voice = watch(next)
      }
      voice.playbackRate = speed
      voice.play(span)
      if (start !== from) calm(voice.seek(start))
      aim = null
      await voice.played
    },
    pause() { intent++; aim = null; if (voice?.playing && !voice.paused) { voice.pause(); at = voice.currentTime } },
    // the speed it plays at, as a tape's: the pitch with it, at once while it plays (the library glides it)
    get rate() { return speed },
    set rate(r) { speed = r; if (voice) voice.playbackRate = r },
    // looping switched while it plays: at once, within the span it plays
    set loop(on) { if (voice?.playing) voice.loop = on },
    // how a held caret sounds (scrub.js): 'hybrid', the vocoder with noise, or one of the lab's (scrub-methods.js)
    set scrubMode(m) { mode = m; scrubbing?.node.port.postMessage({ mode }) },
    seek(time) {
      at = Math.max(0, Math.min(time, duration()))
      if (voice?.playing && !voice.paused) calm(voice.seek(at))
    },
    // The moment at `time`, only `band` [low, high] Hz of it if given, until scrub(null); a moving time plays the
    // sound at its speed. Playback pauses while it sounds.
    async scrub(time, band = null) {
      if (time == null) { heldBy = null; scrubbed = null; scrubbing?.node.port.postMessage({ on: false }); return }
      if (!length) return
      this.pause()
      scrubbed = time
      // a long sound's window about the caret, once it has come
      while (!near(time) && asking) await asking.got
      const call = heldBy = {}, s = await scrubber()
      if (heldBy === call && near(time)) s.node.port.postMessage({ caret: time * rate - s.from, band, on: true })
    },
    // The samples about `t` the page has (near): { x, from }, or null till they come
    near,
    // A moment heard as an edit will leave it, while the edit is dragged (a pitch): [from, to] of the output through
    // `edit`, a call of the library's on it [type, ...args], once, in place of the one before; null stops it. Playback
    // pauses for it.
    async audition(from, to, edit) {
      const mine = ++auditions, was = hearing
      hearing = null
      release(was)
      if (from == null || !length) return
      this.pause()
      await audio.context.resume()
      if (mine !== auditions) return
      const of = outs, a = (await made({ from, to, edit }))?.voice
      if (mine !== auditions || of !== outs || !a) return release(a)
      hearing = a
      a.on('ended', () => { if (hearing === a) { hearing = null; release(a) } })
      a.play()
    },
    // Opens the device ahead of the first play, and loads the scrub voice, so the first press sounds at once: a context
    // made before any click waits suspended until one
    warm() {
      const ctx = audio.context
      ctx.resume().catch(() => {})
      loaded ||= ctx.audioWorklet.addModule(new URL('./scrub.js', import.meta.url))
    },
    close() { release(voice); audio.context.close?.() }
  }
}
