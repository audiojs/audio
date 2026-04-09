import audio, { emit } from '../core.js'
import Speaker from 'audio-speaker'

/** Playback via audio-speaker (cross-platform: Node + browser). */
audio.fn.play = function(opts) {
  let offset = opts?.at ?? 0, duration = opts?.duration
  let a = this, BLOCK = audio.BLOCK_SIZE
  if (a.playing) { a.playing = false; a.paused = false; if (a._._wake) a._._wake() }
  a.playing = false; a.paused = false; a.currentTime = offset
  a.volume = opts?.volume ?? 0; a.loop = opts?.loop ?? false
  a.block = null; a._._wake = null; a._._seekTo = null

  ;(async () => {
    try {
      let ch = a.channels, sr = a.sampleRate
      a.playing = true

      let from = offset, RAMP = 256 // ~6ms anti-click ramp
      while (a.playing) {
        // If paused before playback starts (e.g. open without autoplay), wait silently
        if (a.paused) {
          while (a.paused && a.playing && a._._seekTo == null)
            await new Promise(r => { a._._wake = r })
          a._._wake = null
          if (!a.playing) break
          if (a._._seekTo != null) { from = a._._seekTo; a._._seekTo = null; a.currentTime = from }
        }
        let write = Speaker({ sampleRate: sr, channels: ch, bitDepth: 32 })
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
              a.currentTime = from; seeked = true; break
            }
            let end = Math.min(bOff + BLOCK, cLen), len = end - bOff
            a.block = chunk[0].subarray(bOff, end)

            let g = 10 ** (a.volume / 20)
            let buf = new Float32Array(len * ch)
            for (let i = 0; i < len; i++) for (let c = 0; c < ch; c++)
              buf[i * ch + c] = (chunk[c] || chunk[0])[bOff + i] * g
            if (fadeIn) {
              let n = Math.min(RAMP, len)
              for (let i = 0; i < n; i++) { let t = i / n; for (let c = 0; c < ch; c++) buf[i * ch + c] *= t }
              fadeIn = false
            }

            if (a.paused) {
              let n = Math.min(RAMP, len), s = len - n
              for (let i = 0; i < n; i++) { let t = 1 - i / n; for (let c = 0; c < ch; c++) buf[(s + i) * ch + c] *= t }
              await new Promise(r => write(new Uint8Array(buf.buffer), r))
              await flush()
              played += len
              a.currentTime = from + played / sr
              while (a.paused && a.playing && a._._seekTo == null)
                await new Promise(r => { a._._wake = r })
              a._._wake = null
              if (a._._seekTo != null) continue
              if (!a.playing) break
              fadeIn = true
              continue
            }

            if (!a.playing) {
              let n = Math.min(RAMP, len), s = len - n
              for (let i = 0; i < n; i++) { let t = 1 - i / n; for (let c = 0; c < ch; c++) buf[(s + i) * ch + c] *= t }
              await new Promise(r => write(new Uint8Array(buf.buffer), r))
              break
            }

            await new Promise(r => write(new Uint8Array(buf.buffer), r))
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
        if (a.loop) { from = 0; a.currentTime = 0; emit(a, 'timeupdate', 0); continue }
        a.paused = true
        emit(a, 'timeupdate', a.currentTime)
        while (a.paused && a.playing && a._._seekTo == null)
          await new Promise(r => { a._._wake = r })
        a._._wake = null
        if (!a.playing) break
        if (a._._seekTo != null) { from = a._._seekTo; a._._seekTo = null; a.currentTime = from; continue }
        from = 0; a.currentTime = 0; continue
      }
      a.playing = false; emit(a, 'ended')
    } catch (err) {
      console.error('Playback error:', err)
      a.playing = false
    }
  })()
  return this
}

let proto = audio.fn
proto.pause = function() { this.paused = true }
proto.resume = function() { this.paused = false; if (this._._wake) this._._wake() }
