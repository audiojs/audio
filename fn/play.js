import audio, { emit } from '../core.js'
import { emitMeter } from './meter.js'
import varispeed from './varispeed.js'

/** Apply fade ramp to interleaved buffer. fadeIn=true ramps 0→1, fadeIn=false ramps 1→0 at end. */
function ramp(buf, ch, len, fadeIn, RAMP) {
  let n = Math.min(RAMP, len)
  if (fadeIn) {
    for (let i = 0; i < n; i++) { let t = i / n; for (let c = 0; c < ch; c++) buf[i * ch + c] *= t }
  } else {
    let s = len - n
    for (let i = 0; i < n; i++) { let t = 1 - i / n; for (let c = 0; c < ch; c++) buf[(s + i) * ch + c] *= t }
  }
}

/** Playback via @audio/speaker (cross-platform: Node + browser). */
audio.fn.play = function(opts) {
  let offset = opts?.at ?? 0, duration = opts?.duration
  let a = this, BLOCK = audio.BLOCK_SIZE
  if (a.playing) { a.playing = false; a.paused = false; if (a._._wake) a._._wake() }
  a.playing = false; a.paused = opts?.paused ?? false; a.currentTime = offset
  if (opts?.volume != null) a.volume = opts.volume
  if (opts?.rate != null) a.playbackRate = opts.rate
  a.loop = opts?.loop ?? false
  a.block = null; a._._wake = null; a._._seekTo = null
  a.ended = false

  let startResolve, startReject
  a.played = new Promise((r, j) => { startResolve = r; startReject = j })
  a.played.catch(() => {})

  let resolved = false
  ;(async () => {
    try {
      let ch = a.channels, sr = a.sampleRate
      a.playing = true
      if (!a.paused) emit(a, 'play')
      let { default: Speaker } = await import('@audio/speaker')
      let wait = async () => { while (a.paused && a.playing && a._._seekTo == null) await new Promise(r => { a._._wake = r }); a._._wake = null }

      let from = offset, RAMP = 256 // ~6ms anti-click ramp
      // Varispeed: the device runs at native sr; a fractional read cursor over the
      // decoded stream advances by `rate` per output frame, one-pole smoothed toward
      // a.playbackRate (~50ms) — live tape-style speed changes, no clicks, no device reopen.
      while (a.playing) {
        // If paused before playback starts (e.g. open without autoplay), wait silently
        if (a.paused) {
          await wait()
          if (!a.playing) break
          if (a._._seekTo != null) { from = a._._seekTo; a._._seekTo = null; a.currentTime = from; a.seeking = false }
        }
        let write = Speaker({ sampleRate: sr, channels: ch, bitDepth: 32 })
        let seeked = false, fadeIn = true
        let vs = varispeed(ch, sr, () => a.playbackRate, BLOCK)
        let push = chunk => vs.push(chunk)

        const flush = async () => {
          let pad = new Uint8Array(BLOCK * ch * 4)
          await new Promise(r => write(pad, r))
          await new Promise(r => write(pad, r))
        }
        const send = buf => new Promise(r => write(new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength), r))

        // Produce ≤ BLOCK interleaved frames from the tape; null when input is short
        // (or, with final=true, exhausted). Unit rate with zero phase is a bit-exact copy.
        const produce = final => {
          let at = from + vs.pos / sr
          let out = vs.pull(final)
          if (!out) return null
          let len = out[0].length, g = a.muted ? 0 : a.volume
          let meters = a._.meters?.length ? out : null
          let buf = new Float32Array(len * ch)
          for (let i = 0; i < len; i++) for (let c = 0; c < ch; c++) buf[i * ch + c] = out[c][i] * g
          return { buf, len, meters, at, blk: out[0] }
        }

        // Send one produced block through the pause/seek/stop dance. True = leave the stream loop.
        const sendBlock = async ({ buf, len, meters, at, blk }) => {
          if (a._._seekTo != null) {
            from = a._._seekTo; a._._seekTo = null
            a.currentTime = from; a.seeking = false; seeked = true; return true
          }
          a.block = blk
          if (meters) emitMeter(a, meters, at)
          if (fadeIn) { ramp(buf, ch, len, true, RAMP); fadeIn = false }

          if (a.paused) {
            ramp(buf, ch, len, false, RAMP)
            await send(buf)
            await flush()
            a.currentTime = from + vs.pos / sr
            await wait()
            if (a._._seekTo != null) return false
            if (!a.playing) return true
            fadeIn = true
            return false
          }

          if (!a.playing) {
            ramp(buf, ch, len, false, RAMP)
            await send(buf)
            return true
          }

          await send(buf)
          if (!resolved) { resolved = true; startResolve() }
          if (a._._seekTo == null) {
            a.currentTime = from + vs.pos / sr
            emit(a, 'timeupdate', a.currentTime)
          }
          return false
        }

        streaming:
        for await (let chunk of a.stream({ at: from, duration })) {
          if (!a.playing) break
          push(chunk)
          let out
          while (out = produce(false)) if (await sendBlock(out)) break streaming
          if (a._._seekTo != null) {
            from = a._._seekTo; a._._seekTo = null
            a.currentTime = from; a.seeking = false; seeked = true; break
          }
        }
        if (!seeked && a.playing) {  // drain the tape remainder
          let out
          while (out = produce(true)) if (await sendBlock(out)) break
        }
        if (!seeked && !a.playing) await flush()
        if (seeked) { await flush(); fadeIn = true }
        write(null)
        if (seeked) continue
        if (!a.playing) break
        if (a.loop) { from = offset; a.currentTime = offset; emit(a, 'timeupdate', offset); continue }
        a.playing = false; a.ended = true
        emit(a, 'timeupdate', a.currentTime)
        break
      }
      a.playing = false; emit(a, 'ended')
      if (!resolved) startResolve()
    } catch (err) {
      console.error('Playback error:', err)
      a.playing = false
      if (!resolved) startReject(err); else emit(a, 'error', err)
    }
  })()
  return this
}

let proto = audio.fn
proto.pause = function() { if (!this.paused && this.playing) { this.paused = true; emit(this, 'pause') } }
proto.resume = function() { if (this.paused) { this._.ctStamp = performance.now(); this.paused = false; emit(this, 'play'); if (this._._wake) this._._wake() } }
