import audio from '../assets/audio.js'
import { cycle } from './meters.js'
import { heard } from './heard.js'

// Plays the output with the library's own playback, into a deck on the page's one AudioContext (audio.context). What
// plays is made by the engine and rendered there as it plays (set's `open`, engine.js voice: an audio/worker facade the
// page plays as an instance), past the page's own thread; with none to open (the engine stopped, a test), here, of the
// samples the view draws, shared, not copied. A new output while playing takes over where it is, crossfaded
// (play({ from })), so a slider is heard as it moves; a band [low, high] plays through 24 dB an octave filters
// (highpass, lowpass), open at the ends of hearing, and several boxes [a, b, low, high], each its band over its time,
// over silence (heard.js); loop seams, starts and stops are the library's, crossfaded. The position is what the speakers
// play now: the library reads the device's own clock.
// Scrubbing plays the moment under a caret instead (scrub.js), for as long as it is held, as it moves, on the same
// context. Playback pauses while it sounds.
export default function player({ onend = () => {} } = {}) {
  let channels = null, length = 0, rate = 0, open = null, local = null, voice = null, only = null, at = 0, outs = 0
  let scrubbing = null, loaded = null, heldBy = null, mode = 'hybrid', speed = 1
  // a moment heard as an edit being dragged will leave it (audition), and how many were asked for
  let hearing = null, auditions = 0
  // the latest of play and pause wins: a play still opening the device when a pause comes stays paused
  let intent = 0

  // What plays of the output (heard.js): the engine's, or, with none, made here of the samples; null for a sound the page
  // holds none of (a long one) the engine no longer has
  async function made(o) {
    const v = await open?.(o).catch(() => null)
    if (v) return v
    if (!channels) return null
    local ??= audio.from(channels, { sampleRate: rate })
    return heard(local, o)
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

  // The scrub voice hears the output as it is, every channel at its own rate (scrub.js reads it at the device's), sent
  // the first time a scrub needs it after each new output; a node with as many outputs as the output has channels.
  async function scrubber() {
    const ctx = audio.context
    await ctx.resume()
    loaded ||= ctx.audioWorklet.addModule(new URL('./scrub.js', import.meta.url))
    await loaded
    const n = channels?.length || 1
    if (!scrubbing || scrubbing.channels !== n) {
      scrubbing?.node.disconnect()
      const node = new AudioWorkletNode(ctx, 'scrub', { outputChannelCount: [n] })
      node.connect(ctx.destination)
      node.port.postMessage({ mode })
      scrubbing = { node, channels: n, of: null }
    }
    if (channels && scrubbing.of !== channels) {
      scrubbing.of = channels
      const x = channels.map(c => c.slice())
      scrubbing.node.port.postMessage({ x, rate }, x.map(c => c.buffer))
    }
    return scrubbing
  }

  return {
    get playing() { return !!voice?.playing && !voice.paused },
    get time() { return voice ? voice.currentTime : at },
    // What the speakers play now, as RMS over the 50 ms around the playhead, all channels; 0 when stopped
    get level() {
      if (!this.playing || !channels) return 0
      const i = Math.round(voice.currentTime * rate), half = Math.round(rate * .025)
      let sum = 0, n = 0
      for (const x of channels) for (let k = Math.max(0, i - half); k < Math.min(x.length, i + half); k++, n++) sum += x[k] * x[k]
      return n ? Math.sqrt(sum / n) : 0
    },
    // What the speakers play now, one cycle of it eased into the trace t (meters.js); left as it was when stopped
    trace(t) {
      if (this.playing && channels) cycle(channels, voice.currentTime * rate, rate, t)
      return t
    },
    // A new output, `pcm` at `sampleRate`, `n` samples long, and what opens it to play (made); a long one with no samples
    // here (pcm null), played by the engine alone. While one plays, the new one takes over where it is, the one before
    // playing on until it can
    async set(pcm, sampleRate, opens = null, n = pcm?.[0]?.length ?? 0) {
      // the scrub voice loads with the first output, so the first press sounds at once
      if (pcm?.[0]?.length) loaded ||= audio.context.audioWorklet.addModule(new URL('./scrub.js', import.meta.url))
      const mine = ++outs, prev = voice, was = local
      channels = pcm?.[0]?.length ? pcm : null
      length = n
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
      const next = await made(only ?? {})
      if (mine !== outs || voice !== prev) return release(next)
      if (!next) { release(prev); voice = only = null; return }
      voice = watch(next)
      if (prev.playing) voice.play({ from: prev })
      release(prev)
      if (prev !== was) was?.dispose()
    },
    // Plays the span from `from` to `to` (or the end), looped or not, starting at `start` in it (its start by default),
    // only `band` [low, high] Hz of it, or only `boxes`, if given; while it plays, or is paused, the same go there
    async play({ from = 0, to = null, loop = false, band = null, boxes = null, start = from } = {}) {
      if (!length) return
      const mine = ++intent, o = { band, boxes }
      await audio.context.resume()
      if (mine !== intent) return
      const span = { at: from, duration: to == null ? undefined : to - from, loop }
      if (!(voice?.playing && same(o))) {
        // a new output while it opens: it opens that one instead
        let prev, of, next
        do { release(next); prev = voice; of = outs; next = await made(o) } while (mine === intent && (voice !== prev || of !== outs))
        if (mine !== intent || !next) return release(next)
        release(prev)
        only = o
        voice = watch(next)
      }
      voice.playbackRate = speed
      voice.play(span)
      if (start !== from) calm(voice.seek(start))
      await voice.played
    },
    pause() { intent++; if (voice?.playing && !voice.paused) { voice.pause(); at = voice.currentTime } },
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
      if (time == null) { heldBy = null; scrubbing?.node.port.postMessage({ on: false }); return }
      if (!channels) return
      this.pause()
      const call = heldBy = {}, s = await scrubber()
      if (heldBy === call) s.node.port.postMessage({ caret: time * rate, band, on: true })
    },
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
      const of = outs, a = await made({ from, to, edit })
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
