// A wordmark's mark drawn live in the static one's place: small, it prints flat, through the gentler cosine window so a
// side lobe stays in sight mid-turn; the whole wordmark is its handle; hovered, it copies the pointer's sideways
// moves, half as far as a drag would; the tab's icon follows it. Plain: nothing in it fades or blends, whatever it
// shows next it shows at once, and the static mark stays until the live one has drawn its first frame at its size, so
// the page never shows less than the logo. One per wordmark, however many ask for it: null without WebGL, where the
// static mark stays. `look`, a look of its own in place of the flat one (the logo page's: a gradient, a window).
import { logo } from './logo.js'
import { motion } from './motion.js'

// How a mark moves with what an editor does (playground/editor.js, and a page's own mark moved by the playground it
// embeds, embed.js's mark event), by name: at rest, a mimic of the pointer; while the engine works, turning gently; while
// a sound plays or records, at the pace it goes, the tab's icon turning while the page is hidden; under a scrub, held,
// turned by the caret's travel. PACE: turns a second, a second of sound; FAINT: the axis, when it moves with the sound
export const PACE = 2.5, FAINT = .5
export const sways = {
  scrub: { signal: 'sine', cycles: 1, speed: 0, loop: 0, hold: true, hover: 'none', amplitude: 1, axis: FAINT, hidden: false },
  record: { signal: 'sine', cycles: 1, speed: PACE, loop: PACE, hold: false, hover: 'none', amplitude: 1, axis: FAINT, hidden: true },
  play: { signal: 'sine', cycles: 1, speed: PACE, loop: PACE, hold: false, hover: 'none', amplitude: 1, axis: FAINT, hidden: true },
  work: { signal: 'sine', cycles: 1, speed: .25, loop: 0, hold: false, hover: 'none', amplitude: 1, axis: 0, hidden: true },
  rest: { signal: 'sine', cycles: 1, speed: 0, loop: 0, hold: false, hover: 'mimic', amplitude: 1, axis: 0, hidden: false },
}

const made = new WeakMap()
export function mark(wordmark, settings = {}, look = {}) {
  if (made.has(wordmark)) return made.get(wordmark)
  const canvas = wordmark.querySelector('.logo canvas'), still = wordmark.querySelector('.logo svg')
  let it = null, sized = false
  const view = logo(canvas, { clear: true, fit: 'width', onresize: () => { sized = canvas.clientWidth > 0; it?.set({}) } })
  // the first frame at the canvas's own size takes the static mark's place
  it = view && motion(view, canvas, { area: wordmark, hover: 'mimic', tap: false, favicon: true, ondraw: () => { if (sized) still.remove() }, ...settings })
  if (view) {
    view.set({ figure: getComputedStyle(wordmark).color, window: 'cosine', gradient: 'rectangular', morph: 0, ...look })
    canvas.hidden = false
    // in the wordmark's colour as that changes: a theme worn sets the page's colours on its root (playground/theme.js)
    new MutationObserver(() => { const figure = getComputedStyle(wordmark).color; if (figure !== view.state.figure) { view.set({ figure }); it?.set({}) } })
      .observe(document.documentElement, { attributes: true, attributeFilter: ['style', 'class'] })
  }
  made.set(wordmark, it)
  return it
}
