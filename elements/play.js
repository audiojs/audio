// <audio-play>: plays its sound and pauses it (part.js: of the <audio-sound> it is in, or the one its `for` names).
// The first press runs the script, a ring turning in the button till the sound is in. data-playing while it plays,
// data-working while the sound is made; --played, how far through it is, 0 to 1, for a page to draw (the editor's own
// play button draws it as a ring round itself).
import { Part, SIGNS } from './part.js'

class AudioPlay extends Part {
  static hears = ['change', 'timeupdate', 'run']
  #button
  make() {
    this.#button = this.querySelector(':scope > button') ?? this.appendChild(Object.assign(document.createElement('button'), { type: 'button' }))
    this.#button.innerHTML = SIGNS.play + SIGNS.pause + SIGNS.ring
    this.#button.addEventListener('click', () => this.sound?.toggle())
  }
  show(sound) {
    const playing = !!sound?.playing
    this.toggleAttribute('data-playing', playing)
    this.toggleAttribute('data-working', !!sound?.working && playing)
    this.style.setProperty('--played', sound?.duration ? (sound.time / sound.duration).toFixed(4) : '0')
    this.#button.disabled = !sound
    this.#button.setAttribute('aria-label', playing ? 'Pause' : 'Play')
    this.#button.title = playing ? 'Pause' : 'Play'
  }
}
if (!customElements.get('audio-play')) customElements.define('audio-play', AudioPlay)
