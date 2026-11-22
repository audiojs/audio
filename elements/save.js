// <audio-save>: saves what its sound's script saves, by the name it gives (part.js; sound.save: each save() a file the
// page downloads); a script that saves nothing, its output as `name` says (take.mp3: its type by its end), a WAV by
// default. The first press runs the script, a ring turning in the button till the file is made (data-working).
import { Part, SIGNS } from './part.js'

class AudioSave extends Part {
  #button; #name; #saving = false
  make() {
    this.#button = this.querySelector(':scope > button') ?? this.appendChild(Object.assign(document.createElement('button'), { type: 'button' }))
    this.#button.innerHTML = `${SIGNS.save}${SIGNS.ring}<span></span>`
    this.#name = this.#button.lastChild
    this.#button.addEventListener('click', async () => {
      if (this.#saving || !this.sound) return
      this.#saving = true
      this.show(this.sound)
      try { await this.sound.save(this.getAttribute('name') ?? undefined) }
      finally { this.#saving = false; this.show(this.sound) }
    })
  }
  show(sound) {
    const saves = sound?.saves ?? [], name = saves.length > 1 ? `${saves.length} files` : saves[0] ?? this.getAttribute('name') ?? 'Save'
    this.toggleAttribute('data-working', this.#saving)
    this.#button.disabled = !sound || this.#saving
    this.#name.textContent = name
    this.#button.setAttribute('aria-label', name === 'Save' ? 'Save' : `Save ${name}`)
    this.#button.title = saves.length > 1 ? `Save ${saves.join(', ')}` : 'Save the file'
  }
}
if (!customElements.get('audio-save')) customElements.define('audio-save', AudioSave)
