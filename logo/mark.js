// A wordmark's mark drawn live in the static one's place: small, it prints flat, through the gentler cosine window so a
// side lobe stays in sight mid-turn; the whole wordmark is its handle; hovered, it copies the pointer's sideways
// moves, as a drag would; the tab's icon follows it. One per wordmark, however many ask for it: null without WebGL,
// where the static mark stays.
import { logo } from './logo.js'
import { motion } from './motion.js'

const made = new WeakMap()
export function mark(wordmark, settings = {}) {
  if (made.has(wordmark)) return made.get(wordmark)
  const canvas = wordmark.querySelector('.logo canvas')
  let it = null
  const view = logo(canvas, { clear: true, fit: 'width', onresize: () => it?.set({}) })
  it = view && motion(view, canvas, { area: wordmark, hover: 'mimic', tap: false, favicon: true, ...settings })
  if (view) {
    view.set({ figure: getComputedStyle(wordmark).color, window: 'cosine', gradient: 'rectangular', morph: 150 })
    canvas.hidden = false
    wordmark.querySelector('.logo svg').remove()
  }
  made.set(wordmark, it)
  return it
}
