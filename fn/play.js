export default (audio) => {
  /** Playback via audio-speaker (cross-platform: Node + browser). */
  audio.fn.play = function(offset = 0, duration, opts) {
    if (typeof offset === 'object') { opts = offset; offset = 0; duration = undefined }
    else if (typeof duration === 'object') { opts = duration; duration = undefined }
    let a = this, BLOCK = audio.BLOCK_SIZE
    let ctrl = { playing: false, paused: false, currentTime: offset, volume: opts?.volume ?? 0,
      loop: false, block: null, sampleRate: null, ontimeupdate: null, onended: null,
      pause() { ctrl.paused = true },
      resume() { ctrl.paused = false; if (ctrl._wake) ctrl._wake() },
      stop() { ctrl.playing = false; ctrl.paused = false; if (ctrl._wake) ctrl._wake() },
      seek(t) { ctrl._seekTo = Math.max(0, t); if (ctrl._wake) ctrl._wake() },
      _wake: null, _seekTo: null }

    ;(async () => {
      try {
        let Speaker = (await import('audio-speaker')).default
        let ch = a.channels, sr = a.sampleRate
        ctrl.sampleRate = sr
        ctrl.playing = true

        let from = offset
        while (ctrl.playing) {
          let write = Speaker({ sampleRate: sr, channels: ch, bitDepth: 32 })
          let seeked = false, played = 0
          for await (let chunk of a.stream(from, duration)) {
            if (!ctrl.playing) break
            let cLen = chunk[0].length
            for (let bOff = 0; bOff < cLen; bOff += BLOCK) {
              if (ctrl._seekTo != null) {
                from = ctrl._seekTo; ctrl._seekTo = null
                ctrl.currentTime = from; seeked = true; break
              }
              while (ctrl.paused && ctrl.playing && ctrl._seekTo == null)
                await new Promise(r => { ctrl._wake = r })
              ctrl._wake = null
              if (ctrl._seekTo != null) continue // re-check seek after wake
              if (!ctrl.playing) break

              let g = 10 ** (ctrl.volume / 20)
              let end = Math.min(bOff + BLOCK, cLen), len = end - bOff
              ctrl.block = chunk[0].subarray(bOff, end)
              let buf = new Float32Array(len * ch)
              for (let i = 0; i < len; i++) for (let c = 0; c < ch; c++)
                buf[i * ch + c] = (chunk[c] || chunk[0])[bOff + i] * g
              await new Promise(r => write(new Uint8Array(buf.buffer), r))
              played += len
              ctrl.currentTime = from + played / sr
              ctrl.ontimeupdate?.(ctrl.currentTime)
            }
            if (seeked || !ctrl.playing) break
          }
          write(null)
          if (seeked) continue
          if (!ctrl.playing) break
          // Natural end
          if (ctrl.loop) { from = 0; ctrl.currentTime = 0; ctrl.ontimeupdate?.(0); continue }
          // Pause at end, wait for user action
          ctrl.paused = true
          ctrl.ontimeupdate?.(ctrl.currentTime)
          while (ctrl.paused && ctrl.playing && ctrl._seekTo == null)
            await new Promise(r => { ctrl._wake = r })
          ctrl._wake = null
          if (!ctrl.playing) break
          if (ctrl._seekTo != null) { from = ctrl._seekTo; ctrl._seekTo = null; ctrl.currentTime = from; continue }
          from = 0; ctrl.currentTime = 0; continue // resume → restart
        }
        ctrl.playing = false; ctrl.onended?.()
      } catch (err) {
        console.error('Playback error:', err)
        ctrl.playing = false
      }
    })()
    return ctrl
  }
}
