import audio, { emit } from '../core.js'
import Speaker from 'audio-speaker'

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

/** Playback via audio-speaker (cross-platform: Node + browser). */
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

  ;(async () => {
    try {
      let ch = a.channels, sr = a.sampleRate
      a.playing = true
      if (!a.paused) emit(a, 'play')
      let resolved = false
      let wait = async () => { while (a.paused && a.playing && a._._seekTo == null) await new Promise(r => { a._._wake = r }); a._._wake = null }

      let from = offset, RAMP = 256 // ~6ms anti-click ramp
      while (a.playing) {
        // If paused before playback starts (e.g. open without autoplay), wait silently
        if (a.paused) {
          await wait()
          if (!a.playing) break
          if (a._._seekTo != null) { from = a._._seekTo; a._._seekTo = null; a.currentTime = from; a.seeking = false }
        }
        let write = Speaker({ sampleRate: sr * (a.playbackRate || 1), channels: ch, bitDepth: 32 })
        let seeked = false, played = 0, fadeIn = true
        const flush = async () => {
          let pad = new Uint8Array(BLOCK * ch * 4)
          await new Promise(r => write(pad, r))
          await new Promise(r => write(pad, r))
        }
        for await (let chunk of a.stream({at: from, duration})) {
          if (!a.playing) break
          let cLen = chunk[0].length
          for (let bOff = 0; bOff < cLen; bOff += BLOCK) {
            if (a._._seekTo != null) {
              from = a._._seekTo; a._._seekTo = null
              a.currentTime = from; a.seeking = false; seeked = true; break
            }
            let end = Math.min(bOff + BLOCK, cLen), len = end - bOff
            a.block = chunk[0].subarray(bOff, end)

            let g = a.muted ? 0 : a.volume
            let buf = new Float32Array(len * ch)
            for (let i = 0; i < len; i++) for (let c = 0; c < ch; c++)
              buf[i * ch + c] = (chunk[c] || chunk[0])[bOff + i] * g
            let send = () => new Promise(r => write(new Uint8Array(buf.buffer), r))
            if (fadeIn) { ramp(buf, ch, len, true, RAMP); fadeIn = false }

            if (a.paused) {
              ramp(buf, ch, len, false, RAMP)
              await send()
              await flush()
              played += len
              a.currentTime = from + played / sr
              await wait()
              if (a._._seekTo != null) continue
              if (!a.playing) break
              fadeIn = true
              continue
            }

            if (!a.playing) {
              ramp(buf, ch, len, false, RAMP)
              await send()
              break
            }

            await send()
            if (!resolved) { resolved = true; startResolve() }
            played += len
            if (a._._seekTo == null) {
              a.currentTime = from + played / sr
              emit(a, 'timeupdate', a.currentTime)
            }
          }
          if (seeked || !a.playing) break
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
