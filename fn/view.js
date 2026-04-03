export default (audio) => {
  /** Create a shared-page view, optionally scoped to a range. */
  audio.fn.view = function(offset, duration) {
    let inst = audio.from(this)
    return offset != null || duration != null
      ? inst.crop(offset ?? 0, duration ?? Math.max(0, this.duration - (offset ?? 0)))
      : inst
  }
}
