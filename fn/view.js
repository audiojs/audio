import audio, { parseTime } from '../core.js'
import './crop.js'

/** Create a shared-page view, optionally scoped to a range. Preserves edits. */
audio.fn.view = function(opts) {
  let inst = this.clone ? this.clone() : audio.from(this)
  let at = parseTime(opts?.at), duration = parseTime(opts?.duration)
  return at != null || duration != null
    ? inst.crop({at: at ?? 0, duration: duration ?? Math.max(0, this.duration - (at ?? 0))})
    : inst
}
