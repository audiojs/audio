import audio from '../assets/audio.js'
import { cycle } from './meters.js'

// Plays the output with the library's own playback: play() into a deck on the page's one AudioContext (audio.context).
// The output is audio.from() of the samples the view draws, shared, not copied. A new output while playing takes over
// where it is, crossfaded (play({ from })), so a slider is heard as it moves; a band [low, high] plays through 24 dB
// an octave filters (highpass, lowpass), open at the ends of hearing; loop seams, starts and stops are the library's,
// crossfaded. The position is what the speakers play now: the library reads the device's own clock.
// Scrubbing plays the moment under a caret instead (scrub.js), for as long as it is held, as it moves, on the same
// context. Playback pauses while it sounds.
export default function player({ onend = () => {} } = {}) {
  let out = null, channels = null, voice = null, only = null, at = 0
  let scrubbing = null, loaded = null, heldBy = null
  // the latest of play and pause wins: a play still opening the device when a pause comes stays paused
  let intent = 0

  // what plays: the output, or a band of it
  function banded(a, [low, high]) {
    let b = a.clone()
    if (low > 20) b = b.highpass(low, 4)
    if (high < a.sampleRate * .47) b = b.lowpass(high, 4)
    return b
  }
  // a voice tells the page when it reaches its end by itself; one taken over or stopped goes quietly
  function watch(v) {
    v.on('ended', () => { if (voice === v && v.ended) { at = v.currentTime; voice = null; onend() } })
    return v
  }
  // a band's own copy goes with it; the output stays, for the next play
  const release = v => { if (v && v !== out) v.dispose() }

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
      scrubbing = { node, channels: n, of: null }
    }
    if (channels && scrubbing.of !== channels) {
      scrubbing.of = channels
      const x = channels.map(c => c.slice())
      scrubbing.node.port.postMessage({ x, rate: out.sampleRate }, x.map(c => c.buffer))
    }
    return scrubbing
  }

  return {
    get playing() { return !!voice?.playing && !voice.paused },
    get time() { return voice ? voice.currentTime : at },
    // What the speakers play now, as RMS over the 50 ms around the playhead, all channels; 0 when stopped
    get level() {
      if (!this.playing || !channels) return 0
      const rate = out.sampleRate, i = Math.round(voice.currentTime * rate), half = Math.round(rate * .025)
      let sum = 0, n = 0
      for (const x of channels) for (let k = Math.max(0, i - half); k < Math.min(x.length, i + half); k++, n++) sum += x[k] * x[k]
      return n ? Math.sqrt(sum / n) : 0
    },
    // What the speakers play now, one cycle of it eased into the trace t (meters.js); left as it was when stopped
    trace(t) {
      if (this.playing && channels) cycle(channels, voice.currentTime * out.sampleRate, out.sampleRate, t)
      return t
    },
    // A new output: while one plays, the new one takes over where it is
    set(pcm, sampleRate) {
      // the scrub voice loads with the first output, so the first press sounds at once
      if (pcm?.[0]?.length) loaded ||= audio.context.audioWorklet.addModule(new URL('./scrub.js', import.meta.url))
      const next = pcm?.[0]?.length ? audio.from(pcm, { sampleRate }) : null, prev = voice, was = out
      out = next
      channels = next ? pcm : null
      if (prev?.playing && next) {
        voice = watch(only ? banded(next, only) : next)
        voice.play({ from: prev })
      } else {
        prev?.stop()
        voice = null
        at = Math.min(at, next?.duration ?? 0)
      }
      if (prev !== was) release(prev)
      was?.dispose()
      if (heldBy) scrubber()
    },
    // Plays the span from `from` to `to` (or the end), looped or not, starting at `start` in it (its start by default),
    // only `band` [low, high] Hz of it if given; while it plays, or is paused, the same band goes there
    async play({ from = 0, to = null, loop = false, band = null, start = from } = {}) {
      if (!out) return
      const mine = ++intent
      await audio.context.resume()
      if (mine !== intent) return
      const span = { at: from, duration: to == null ? undefined : to - from, loop }
      if (!(voice?.playing && String(band) === String(only))) {
        voice?.stop()
        release(voice)
        only = band
        voice = watch(band ? banded(out, band) : out)
      }
      voice.play(span)
      if (start !== from) voice.seek(start)
      await voice.played
    },
    pause() { intent++; if (voice?.playing && !voice.paused) { voice.pause(); at = voice.currentTime } },
    // looping switched while it plays: at once, within the span it plays
    set loop(on) { if (voice?.playing) voice.loop = on },
    seek(time) {
      at = Math.max(0, Math.min(time, out?.duration || 0))
      if (voice?.playing && !voice.paused) voice.seek(at)
    },
    // The moment at `time`, only `band` [low, high] Hz of it if given, until scrub(null); a moving time plays the
    // sound at its speed. Playback pauses while it sounds.
    async scrub(time, band = null) {
      if (time == null) { heldBy = null; scrubbing?.node.port.postMessage({ on: false }); return }
      if (!out) return
      this.pause()
      const call = heldBy = {}, s = await scrubber()
      if (heldBy === call) s.node.port.postMessage({ caret: time * out.sampleRate, band, on: true })
    },
    // Opens the device ahead of the first play, and loads the scrub voice, so the first press sounds at once: a context
    // made before any click waits suspended until one
    warm() {
      const ctx = audio.context
      ctx.resume().catch(() => {})
      loaded ||= ctx.audioWorklet.addModule(new URL('./scrub.js', import.meta.url))
    },
    close() { voice?.stop(); audio.context.close?.() }
  }
}
