export default (audio) => {
  /** Create a shared-page view, optionally scoped to a range. */
  audio.fn.view = function(opts) {
    let inst = audio.from(this)
    let at = opts?.at, duration = opts?.duration
    return at != null || duration != null
      ? inst.crop({at: at ?? 0, duration: duration ?? Math.max(0, this.duration - (at ?? 0))})
      : inst
  }
}
