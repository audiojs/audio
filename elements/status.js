// <audio-status>: what its sound does, said as it does it (part.js): Decoding 40%, Applying auto 3.2s; and what went
// wrong, where its script or a file fails (data-error). A live region: a screen reader hears it. Empty at rest.
import { Part } from './part.js'

class AudioStatus extends Part {
  #said = null
  make() { this.setAttribute('role', 'status') }
  show(sound) {
    const error = sound?.error ?? '', text = error || (sound?.status ?? '')
    this.toggleAttribute('data-error', !!error)
    this.toggleAttribute('data-working', !!sound?.working)
    if (text !== this.#said) this.textContent = this.#said = text
    if (text) this.title = text; else this.removeAttribute('title')
  }
}
if (!customElements.get('audio-status')) customElements.define('audio-status', AudioStatus)
