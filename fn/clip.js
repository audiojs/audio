import audio, { parseTime } from '../core.js'
import './crop.js'
import './insert.js'

/** Create a shared-page clip, optionally scoped to a range. Preserves edits. */
audio.fn.clip = function(opts) {
  let inst = this.clone ? this.clone() : audio.from(this)
  let at = parseTime(opts?.at), duration = parseTime(opts?.duration)
  return at != null || duration != null
    ? audio.from(0, { sampleRate: inst.sampleRate, channels: inst.channels, bitDepth: inst.bitDepth }).insert(inst).crop({ at: at ?? 0, ...(duration != null && { duration }) })
    : inst
}
