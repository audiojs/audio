// <audio-seek>: where its sound is along its length, a slider to go elsewhere (part.js): a native range, so the keys
// move it as they move any. Nothing to move till the sound has run.
import { Part, clock } from './part.js'

class AudioSeek extends Part {
  static hears = ['change', 'timeupdate', 'run']
  #input; #held = false
  make() {
    this.#input = this.querySelector(':scope > input') ?? this.appendChild(Object.assign(document.createElement('input'), { type: 'range', min: 0, max: 0, step: 'any', value: 0 }))
    this.#input.setAttribute('aria-label', 'Position')
    // while it is dragged it says where the pointer has it, not where the sound plays
    this.#input.addEventListener('pointerdown', () => { this.#held = true })
    for (const type of ['pointerup', 'pointercancel', 'change']) this.#input.addEventListener(type, () => { this.#held = false })
    this.#input.addEventListener('input', e => { e.stopPropagation(); if (this.sound) this.sound.time = +this.#input.value })
  }
  show(sound) {
    const d = sound?.duration ?? 0, t = sound?.time ?? 0
    this.#input.disabled = !d
    if (+this.#input.max !== d) this.#input.max = d
    if (!this.#held) this.#input.value = t
    this.#input.setAttribute('aria-valuetext', d ? `${clock(t)} of ${clock(d)}` : clock(t))
  }
}
if (!customElements.get('audio-seek')) customElements.define('audio-seek', AudioSeek)
