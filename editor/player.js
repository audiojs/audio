import audio from '../assets/audio.js'
import { cycle } from './meters.js'

// Plays the output with the library's own playback: play() into a deck on the page's one AudioContext (audio.context).
// The output is audio.from() of the samples the view draws, shared, not copied. A new output while playing takes over
// where it is, crossfaded (play({ from })), so a slider is heard as it moves; a band [low, high] plays through 24 dB
// an octave filters (highpass, lowpass), open at the ends of hearing, and several boxes [a, b, low, high], each its
// band over its time, over silence (boxed); loop seams, starts and stops are the library's, crossfaded. The position is
// what the speakers play now: the library reads the device's own clock.
// Scrubbing plays the moment under a caret instead (scrub.js), for as long as it is held, as it moves, on the same
// context. Playback pauses while it sounds.
export default function player({ onend = () => {} } = {}) {
  let out = null, channels = null, voice = null, only = null, at = 0
  let scrubbing = null, loaded = null, heldBy = null, mode = 'hybrid', speed = 1
  // a moment heard as an edit being dragged will leave it (audition), and how many were asked for
  let hearing = null, auditions = 0
  // the latest of play and pause wins: a play still opening the device when a pause comes stays paused
  let intent = 0

  // what plays: the output, a band of it, or its boxes
  const heard = (a, { band, boxes }) => boxes ? boxed(a, boxes) : band ? banded(a, band) : a
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
      node.port.postMessage({ mode })
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
        voice = watch(heard(next, only ?? {}))
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
    // only `band` [low, high] Hz of it, or only `boxes`, if given; while it plays, or is paused, the same go there
    async play({ from = 0, to = null, loop = false, band = null, boxes = null, start = from } = {}) {
      if (!out) return
      const mine = ++intent
      await audio.context.resume()
      if (mine !== intent) return
      const span = { at: from, duration: to == null ? undefined : to - from, loop }
      if (!(voice?.playing && JSON.stringify({ band, boxes }) === JSON.stringify(only))) {
        voice?.stop()
        release(voice)
        only = { band, boxes }
        voice = watch(heard(out, only))
      }
      voice.playbackRate = speed
      voice.play(span)
      if (start !== from) voice.seek(start)
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
    // A moment heard as an edit will leave it, while the edit is dragged (a pitch): [from, to] of the output through
    // `edit`, a call of the library's on it, once, in place of the one before; null stops it. Playback pauses for it.
    async audition(from, to, edit) {
      const mine = ++auditions, was = hearing
      hearing = null
      if (was) { was.stop(); was.dispose() }
      if (from == null || !out) return
      this.pause()
      await audio.context.resume()
      if (mine !== auditions) return
      const a = hearing = edit(out.clone().crop({ at: from, duration: to - from }))
      a.on('ended', () => { if (hearing === a) { hearing = null; a.dispose() } })
      a.play()
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

// A band of a sound, [low, high] Hz: through 24 dB an octave highpass and lowpass, each open where it would cut nothing
export function banded(a, [low, high]) {
  let b = a.clone()
  if (low > 20) b = b.highpass(low, 4)
  if (high < a.sampleRate * .47) b = b.lowpass(high, 4)
  return b
}
// Boxes of a sound, [a, b, low, high] each: each box's band over its time, where it was, silence around them as long as
// the sound; boxes that meet in time sound together
export function boxed(a, boxes) {
  const band = ([from, to, low, high]) => banded(a.clone().crop({ at: from, duration: to - from }), [low, high])
  const [first, ...rest] = boxes
  let b = band(first).pad(first[0], Math.max(0, a.duration - first[1]))
  for (const box of rest) b = b.mix(band(box), { at: box[0] })
  return b
}
