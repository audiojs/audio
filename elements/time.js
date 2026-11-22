// <audio-time>: where its sound is and how long it is, as a player's clock says it: 0:05 / 0:21 (part.js). The length
// once the sound has run; `remaining`: what is left, −0:16.
import { Part, clock } from './part.js'

class AudioTime extends Part {
  static hears = ['change', 'timeupdate', 'run']
  #said = null
  show(sound) {
    const t = sound?.time ?? 0, d = sound?.duration ?? 0
    const text = this.hasAttribute('remaining') ? `−${clock(Math.max(0, d - t))}` : d ? `${clock(t)} / ${clock(d)}` : clock(t)
    if (text !== this.#said) this.textContent = this.#said = text
  }
}
if (!customElements.get('audio-time')) customElements.define('audio-time', AudioTime)
