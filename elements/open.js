// <audio-open>: the file its sound's script opens, by name, and a press to open one of the reader's own in its place
// (part.js; sound.open: the file goes to the engine in this page, nowhere else, and the script names it). `accept`:
// what the picker offers, audio and video by default.
import { Part, SIGNS } from './part.js'

class AudioOpen extends Part {
  #button; #name; #input
  make() {
    this.#button = this.querySelector(':scope > button') ?? this.appendChild(Object.assign(document.createElement('button'), { type: 'button' }))
    this.#button.innerHTML = `${SIGNS.open}<span></span>`
    this.#name = this.#button.lastChild
    this.#input = this.appendChild(Object.assign(document.createElement('input'), { type: 'file', hidden: true, accept: this.getAttribute('accept') ?? 'audio/*,video/*' }))
    this.#button.addEventListener('click', () => this.#input.click())
    // (the input's own events are not the sound's script's)
    for (const type of ['input', 'change']) this.#input.addEventListener(type, e => e.stopPropagation())
    this.#input.addEventListener('change', () => { const [file] = this.#input.files; this.#input.value = ''; if (file) this.sound?.open(file) })
  }
  show(sound) {
    const name = sound?.opens[0] ?? ''
    this.#button.disabled = !sound
    this.#name.textContent = name || 'Open a file'
    this.#button.setAttribute('aria-label', name ? `${name}: open another file` : 'Open a file')
    if (!this.hasAttribute('title')) this.#button.title = 'Open a file of your own'
  }
}
if (!customElements.get('audio-open')) customElements.define('audio-open', AudioOpen)
