// A wordmark's mark drawn live in the static one's place: small, it prints flat, through the gentler cosine window so a
// side lobe stays in sight mid-turn; the whole wordmark is its handle; hovered, it copies the pointer's sideways
// moves, half as far as a drag would; the tab's icon follows it. Plain: nothing in it fades or blends, whatever it
// shows next it shows at once, and the static mark stays until the live one has drawn its first frame at its size, so
// the page never shows less than the logo. One per wordmark, however many ask for it: null without WebGL, where the
// static mark stays.
import { logo } from './logo.js'
import { motion } from './motion.js'

const made = new WeakMap()
export function mark(wordmark, settings = {}) {
  if (made.has(wordmark)) return made.get(wordmark)
  const canvas = wordmark.querySelector('.logo canvas'), still = wordmark.querySelector('.logo svg')
  let it = null, sized = false
  const view = logo(canvas, { clear: true, fit: 'width', onresize: () => { sized = canvas.clientWidth > 0; it?.set({}) } })
  // the first frame at the canvas's own size takes the static mark's place
  it = view && motion(view, canvas, { area: wordmark, hover: 'mimic', tap: false, favicon: true, ondraw: () => { if (sized) still.remove() }, ...settings })
  if (view) {
    view.set({ figure: getComputedStyle(wordmark).color, window: 'cosine', gradient: 'rectangular', morph: 0 })
    canvas.hidden = false
  }
  made.set(wordmark, it)
  return it
}
