// What a sound's parts share (play.js, seek.js, time.js, status.js, open.js, save.js): how each finds its sound, hears
// it and is styled.
//
// A part is of the <audio-sound> it is inside, or of the one it names, as a <label for> names its control:
//
//   <audio-sound id="take"> … <audio-play></audio-play> </audio-sound>
//   <audio-time for="take"></audio-time>
//
// It shows the sound's state and calls its methods (sound.js), and holds none of its own: several of a kind show one
// sound alike. What a reader presses in it is a real <button> or <input>, so the keys and a screen reader have it as
// they have any. Its state is the sound's, said in data-* attributes on the part for a page's CSS (data-playing,
// data-working, data-error). Its look is next to nothing: the page's font and ink, no ground, in a cascade layer
// (`audio`) under every rule of the page's.

// the sound a part is of: the one its `for` names, else the nearest it is in; null where there is none. A sound is
// what answers as <audio-sound> does (sound.js): that element, or another named that keeps its interface (toggle(),
// playing and the rest: an embedded editor's element, for the sound in its frame)
export const soundOf = el => el.hasAttribute('for') ? el.ownerDocument.getElementById(el.getAttribute('for')) : el.closest('audio-sound')
const sounds = el => typeof el?.toggle === 'function' && 'playing' in el

// Rules into the page, each set once (by its id), in the skin's own layer
export function styles(id, css) {
  if (document.getElementById(id)) return
  document.head.append(Object.assign(document.createElement('style'), { id, textContent: `@layer audio {\n${css}\n}` }))
}
styles('audio-part-style', `
:where(audio-play, audio-seek, audio-time, audio-status, audio-open, audio-save) { display: inline-flex; align-items: center; min-width: 0; }
:where(audio-play, audio-open, audio-save) > button { display: inline-flex; align-items: center; gap: .4em; min-width: 0; margin: 0; padding: 0; border: 0; border-radius: 2px; background: none; color: inherit; font: inherit; letter-spacing: inherit; cursor: pointer; }
:where(audio-play, audio-open, audio-save) > button:disabled { opacity: .5; cursor: default; }
:where(audio-play, audio-open, audio-save) > button:focus-visible { outline: 1.5px solid currentColor; outline-offset: 3px; }
:where(audio-play, audio-open, audio-save) svg { flex: none; width: 1.25em; height: 1.25em; }
:where(audio-open, audio-save) span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
:where(audio-time) { font-variant-numeric: tabular-nums; white-space: nowrap; }
:where(audio-status) { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-variant-numeric: tabular-nums; }
:where(audio-seek) { flex: 1 1 6em; }
:where(audio-seek) > input { width: 100%; margin: 0; accent-color: currentColor; cursor: pointer; }
/* the play button's three signs, one in sight: play, pause, and a ring that turns while the sound is made */
:where(audio-play) svg:not(.play), :where(audio-play)[data-playing] svg.play, :where(audio-play)[data-working] svg.play { display: none; }
:where(audio-play)[data-playing]:not([data-working]) svg.pause, :where(audio-play)[data-working] svg.ring { display: block; }
:where(audio-play, audio-save)[data-working] svg.ring { animation: audio-part-turn 1s linear infinite; }
:where(audio-save) svg.ring, :where(audio-save)[data-working] svg.sign { display: none; }
:where(audio-save)[data-working] svg.ring { display: block; }
@keyframes audio-part-turn { to { rotate: 1turn; } }
@media (prefers-reduced-motion: reduce) { :where(audio-play, audio-save)[data-working] svg.ring { animation: none; } }`)

// the signs: the editor's own stroke (repl/icons.js glyph), and the play and pause its bar draws filled
const svg = (cls, body, filled = false) => `<svg class="${cls}" viewBox="0 0 24 24" fill="${filled ? 'currentColor' : 'none'}" ${filled ? '' : 'stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" '}aria-hidden="true">${body}</svg>`
export const SIGNS = {
  play: svg('play', '<path d="M8 5v14l11-7z"/>', true),
  pause: svg('pause', '<path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z"/>', true),
  ring: svg('ring', '<path d="M12 4a8 8 0 1 0 8 8"/>'),
  // the editor's embed's own two (repl/index.html: Open a file, Save as)
  open: svg('sign', '<path d="M12 20V9m-5 5 5-5 5 5M4 5h16"/>'),
  save: svg('sign', '<path d="M12 4v11m-5-5 5 5 5-5M4 19h16"/>')
}

// A time as a player's clock says it: 0:05, 12:40
export const clock = t => { const s = Math.max(0, Math.round(t || 0)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` }

// A part: made once (make), then shown again (show) as it joins its sound and each time the sound says one of the
// events it `hears`. A part with no sound shows as with one that has nothing
export class Part extends HTMLElement {
  static hears = ['change']
  #made = false; #sound = null; #heard = null
  get sound() { return this.#sound }
  connectedCallback() {
    if (!this.#made) { this.#made = true; this.make() }
    this.show(null)
    // (the sound's element may be defined after its parts: found once it is)
    const named = soundOf(this)
    customElements.whenDefined(named?.localName.includes('-') ? named.localName : 'audio-sound').then(() => {
      if (!this.isConnected || this.#sound) return
      const sound = soundOf(this)
      if (!sounds(sound)) return
      this.#sound = sound
      this.#heard = () => this.show(sound)
      for (const type of this.constructor.hears) sound.addEventListener(type, this.#heard)
      this.show(sound)
    })
  }
  disconnectedCallback() {
    if (this.#sound) for (const type of this.constructor.hears) this.#sound.removeEventListener(type, this.#heard)
    this.#sound = this.#heard = null
  }
  make() {}
  show() {}
}
