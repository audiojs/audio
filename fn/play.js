export default (audio) => {
  /** Playback via audio-speaker (cross-platform: Node + browser). */
  audio.fn.play = function(offset = 0, duration, opts) {
    if (typeof offset === 'object') { opts = offset; offset = 0; duration = undefined }
    else if (typeof duration === 'object') { opts = duration; duration = undefined }
    let a = this, vol = opts?.volume != null ? 10 ** (opts.volume / 20) : 1
    let ctrl = { playing: false, currentTime: offset, volume: opts?.volume ?? 0, ontimeupdate: null, onended: null,
      pause() { ctrl.playing = false },
      stop() { ctrl.playing = false } }

    ;(async () => {
      try {
        let Speaker = (await import('audio-speaker')).default
        let ch = a.channels
        let write = Speaker({ sampleRate: a.sampleRate, channels: ch, bitDepth: 32 })
        ctrl.playing = true

        let played = 0
        for await (let chunk of a.stream(offset, duration)) {
          if (!ctrl.playing) break
          let g = ctrl.volume !== 0 ? 10 ** (ctrl.volume / 20) : vol
          let len = chunk[0].length
          let buf = new Float32Array(len * ch)
          for (let i = 0; i < len; i++) for (let c = 0; c < ch; c++) buf[i * ch + c] = (chunk[c] || chunk[0])[i] * g
          await new Promise(r => write(new Uint8Array(buf.buffer), r))
          played += len
          ctrl.currentTime = offset + played / a.sampleRate
          ctrl.ontimeupdate?.(ctrl.currentTime)
        }
        write(null); ctrl.playing = false; ctrl.onended?.()
      } catch (err) {
        console.error('Playback error:', err)
        ctrl.playing = false
      }
    })()
    return ctrl
  }
}
