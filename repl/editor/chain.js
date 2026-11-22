import { moveStep, dropStep, turnOff, turnOn, useTake, takes } from '../code.js'
import { labelOf } from '../ops.js'
import { SLOP } from '../view.js'
import { root } from './config.js'
import { state, ed } from './context.js'
import { switchTake } from './edits.js'
import { madeSteps, closeStep, findShut, fitChain, focusQuietly } from './menus.js'

// The chain's edits (?ui= edits chain) moved and taken away, as the old widget's pills were. Dragged along the chain, an
// edit is held under the pointer, the others making room for it as it passes them; let go, it stands there, one undo
// step. While one is carried, the field after them, Edit…, is a trash can, Remove, lit while the edit would land on
// it: let go there, it is taken away. Escape, the window left, or a drop far off the chain puts it back; a press that
// does not move still opens its settings. A finger's drag moves it as the pointer's does, once it goes more across than
// down: a swipe up or down is the page's, scrolling it. By the keys on an edit: Alt and an arrow move it a place, Delete
// or Backspace takes it away; its Remove, at its settings' foot, too, and Bypass beside it turns it off and on again.
// What each did is said in the live line. Every edit
// the chain lists moves so, one made by other means (a crop on the picture) too, as the edits' cards move any live step
// (stack.js); the move is code.js moveStep's, the cards' own, so a step never leaves the part of the chain it is in (a
// copied track's shared steps): such a move is none, and the edit goes back.

const edits = () => [...root.querySelectorAll('.chain-step > .chain-edit')]
const say = words => { state.chainSaid = words }

// Edit `k` taken away, its settings closed, one undo step. By the keys, the keys go on to the edit before it, else the one
// now in its place, else the field (which opens nothing so put); by the pointer, nothing takes them, no ring jumping
// onto the next edit under the hand
export function dropEdit(k, keyed = false) {
  const s = madeSteps(ed.code)[k]
  if (!state.hasOutput || !s) return
  closeStep(false)
  ed.change(dropStep(ed.code, s.i))
  say(`${labelOf(s.name)} removed.`)
  if (keyed) requestAnimationFrame(() => { fitChain(); const to = edits()[Math.max(0, k - 1)]; to ? to.focus() : focusQuietly(root.querySelector('.chain-add')) })
}
// Edit `k` bypassed, or back on: its call commented out where it stands (code.js turnOff, as the edits' cards' switch
// and the Process menu's Mute do), so the code says it, the sound and the picture as without it, one undo step; it
// stays where it is in the chain, dimmed, its settings open still (set, they go into its comment). A take's (a take
// turned on is the one heard at its place: useTake) as the takes' switch does
export function bypassEdit(k) {
  const s = madeSteps(ed.code)[k], take = s && takes(ed.code).some(r => r.list.some(x => x.from === s.call.from))
  const change = state.hasOutput && s && (s.on ? turnOff(ed.code, s.call) : useTake(ed.code, s.call.from) ?? turnOn(ed.code, s.call))
  if (!change) return
  take ? switchTake(change) : ed.change(change)
  say(`${labelOf(s.name)} ${s.on ? 'bypassed' : 'on again'}.`)
}
// Edit `k` moved to stand at `to` among those made, one undo step; by the keys, the keys go with it. False where it
// does not move (one bypassed stays where it is, as the cards' do)
export function moveEdit(k, to, keyed = false) {
  const list = madeSteps(ed.code), s = list[k], t = list[to], change = state.hasOutput && s && t && k !== to && moveStep(ed.code, s.i, t.i)
  if (!change) return false
  closeStep(false)
  ed.change(change)
  say(`${labelOf(s.name)} moved to position ${to + 1} of ${list.length}.`)
  if (keyed) requestAnimationFrame(() => edits()[to]?.focus())
  return true
}
// The keys on edit `k`: Delete or Backspace, alone, takes it away; Alt and Left or Right moves it a place
export function editKey(k, event) {
  const bare = !event.altKey && !event.metaKey && !event.ctrlKey && !event.shiftKey
  if (bare && (event.key === 'Delete' || event.key === 'Backspace')) { event.preventDefault(); return dropEdit(k, true) }
  // B: bypassed, or on again, as Alt with a press does (index.html .chain-edit)
  if (bare && (event.key === 'b' || event.key === 'B')) { event.preventDefault(); event.stopPropagation(); return bypassEdit(k) }
  const by = event.altKey && !event.metaKey && !event.ctrlKey && { ArrowLeft: -1, ArrowRight: 1 }[event.key]
  if (!by) return
  event.preventDefault()
  moveEdit(k, k + by, true)
}

// The drag: the edit pressed, where and by which pointer; once it moves, a copy of it held under the pointer (`lifted`),
// its own place kept empty, and the order the edits would stand in were it let go here (`order`, an edit's place in the
// chain at each place along it), laid by their `order`, those after the place it would take stepping aside
let carried = null
export function carryEdit(k, event) {
  if (event.button || !event.isPrimary || carried || !state.hasOutput) return
  const own = event.currentTarget, chain = own.closest('.embed-chain')
  carried = { k, to: k, own, chain, id: event.pointerId, touch: event.pointerType === 'touch', x: event.clientX, y: event.clientY, lifted: null }
  addEventListener('pointermove', drag)
  addEventListener('pointerup', drop)
  addEventListener('pointercancel', putBack)
}
const ends = ['pointermove', drag, 'pointerup', drop, 'pointercancel', putBack, 'keydown', escape, 'blur', putBack, 'resize', putBack]
function unlisten() { for (let i = 0; i < ends.length; i += 2) removeEventListener(ends[i], ends[i + 1], ends[i] === 'keydown') }

function drag(event) {
  const c = carried
  if (!c || event.pointerId !== c.id) return
  if (!c.own.isConnected) return putBack()
  if (!c.lifted) {
    const dx = event.clientX - c.x, dy = event.clientY - c.y
    // (a finger going more down than across is the page's scroll: touch-action pan-y lets the page have it)
    if (Math.hypot(dx, dy) < SLOP + 2 || c.touch && Math.abs(dx) < Math.abs(dy)) return
    lift(c)
  }
  event.preventDefault()
  const { el, px, py, ox, oy, w, h } = c.lifted, over = onField(event), left = event.clientX - px, top = event.clientY - py
  el.style.transform = `translate(${left - ox}px, ${top - oy}px)`
  el.style.visibility = over ? 'hidden' : ''
  root.querySelector('.chain-find').toggleAttribute('data-lit', over)
  if (over) return
  // the place nearest the copy's middle, of the places the edits are laid at, across rather than down (a line's
  // height counted four times, so it stays on its line till well over the next); read where they settle, not where
  // they are sliding to, so passing one never sways back and forth
  const x = left + w / 2, y = top + h / 2, box = c.chain.getBoundingClientRect(), at = laid(c.chain)
  let to = c.to, near = Infinity
  c.order.forEach((i, p) => {
    const s = c.steps[i], [l, t] = at(s), d = (x - box.left - l - s.offsetWidth / 2) ** 2 + 4 * (y - box.top - t - s.offsetHeight / 2) ** 2
    if (d < near) { near = d; to = p }
  })
  if (to === c.to) return
  c.order = moved(c.order, c.to, to)
  c.to = to
  arrange(c)
}
// Where an edit's step is laid in the chain, from its corner (`offsetLeft`, as it settles, its slide aside not counted:
// the step's own, as its edit's would be from the step while it slides, a box with a transform being its children's
// offsetParent)
const laid = chain => e => e.offsetParent === chain ? [e.offsetLeft, e.offsetTop] : [e.offsetLeft - chain.offsetLeft, e.offsetTop - chain.offsetTop]
const moved = (order, from, to) => { const next = [...order]; next.splice(to, 0, ...next.splice(from, 1)); return next }
// (the field, or while an edit is carried the trash can laid over it, as wide as it shows)
const onField = event => { const r = (root.querySelector('.embed-chain[data-carry] .chain-trash') ?? root.querySelector('.chain-find')).getBoundingClientRect(); return event?.clientX >= r.left && event.clientX <= r.right && event.clientY >= r.top && event.clientY <= r.bottom }

// Lifted: its settings and the field's list shut; a copy of it under the pointer, where the pointer took it; its place
// kept, empty; the field a trash can
function lift(c) {
  closeStep(false)
  findShut()
  const was = boxes(c.chain), r = c.own.getBoundingClientRect(), el = c.own.cloneNode(true)
  el.className = 'chain-edit chain-carried'
  for (const name of ['aria-expanded', 'aria-haspopup', 'aria-description', 'title']) el.removeAttribute(name)
  el.setAttribute('aria-hidden', 'true')
  el.tabIndex = -1
  el.style.width = `${r.width}px`
  c.chain.append(el)
  // where the pointer took it (`px`, `py`); fixed from the frame's corner, or from a box that holds it so: where it lands
  // at 0, 0 (`ox`, `oy`), taken off
  const o = el.getBoundingClientRect()
  c.lifted = { el, px: c.x - r.left, py: c.y - r.top, ox: o.left, oy: o.top, w: r.width, h: r.height }
  c.steps = [...c.chain.querySelectorAll('.chain-step')]
  c.order = c.steps.map((_, i) => i)
  c.steps[c.k].classList.add('carried')
  c.chain.dataset.carry = ''
  arrange(c, was)
  c.chain.setPointerCapture(c.id)
  c.chain.addEventListener('lostpointercapture', lost)
  addEventListener('keydown', escape, true)
  addEventListener('blur', putBack)
  addEventListener('resize', putBack)
}
// The edits laid in the order they would stand in, after the bar the name has and before the field and the history, the
// first with no bar before it; each sliding from where it was (`was`: lifted, where it was before the field turned)
function arrange(c, was = boxes(c.chain)) {
  const n = c.order.length
  for (const e of parts(c.chain)) if (!c.steps.includes(e)) e.style.order = n + 1
  c.order.forEach((i, p) => { c.steps[i].style.order = p + 1; c.steps[i].toggleAttribute('data-lead', !p) })
  fitChain()
  slide(c.chain, was)
}
// Where each part of the chain is now, and each slid there from where it was, as long as the tokens' short motion; at
// once where motion is reduced
const parts = chain => [...chain.children].filter(e => !e.classList.contains('chain-carried'))
const boxes = chain => new Map(parts(chain).map(e => [e, e.getBoundingClientRect()]))
function slide(chain, was) {
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches, cs = getComputedStyle(chain), duration = reduce ? 0 : parseFloat(cs.getPropertyValue('--dur-short')) || 0
  for (const e of parts(chain)) {
    e.getAnimations().forEach(a => a.cancel())
    const from = was.get(e), to = e.getBoundingClientRect()
    if (!duration || !from || Math.abs(from.left - to.left) < .5 && Math.abs(from.top - to.top) < .5) continue
    e.animate([{ transform: `translate(${from.left - to.left}px, ${from.top - to.top}px)` }, { transform: 'none' }], { duration, easing: cs.getPropertyValue('--ease-out').trim() || 'ease-out' })
  }
}

function drop(event) { finish(event, false) }
function putBack(event) { finish(event, true) }
function lost(event) { if (event.target === carried?.chain) putBack(event) }
function escape(event) {
  if (event.key !== 'Escape') return
  event.preventDefault()
  event.stopImmediatePropagation()
  putBack()
}
// Let go: on the field, the edit taken away; elsewhere on the chain (or within 32 px of it), standing where it was let go;
// put back otherwise. The click the drop ends with is the drag's, opening nothing
function finish(event, back) {
  const c = carried
  if (!c || event?.pointerId != null && event.pointerId !== c.id) return
  carried = null
  unlisten()
  if (!c.lifted) return
  c.chain.removeEventListener('lostpointercapture', lost)
  if (c.chain.hasPointerCapture(c.id)) c.chain.releasePointerCapture(c.id)
  const stop = e => { e.preventDefault(); e.stopImmediatePropagation() }
  addEventListener('click', stop, { capture: true, once: true })
  setTimeout(() => removeEventListener('click', stop, true))
  const box = c.chain.getBoundingClientRect(), trash = !back && onField(event)
  const far = event?.clientX != null && (event.clientX < box.left - 32 || event.clientX > box.right + 32 || event.clientY < box.top - 32 || event.clientY > box.bottom + 32)
  const was = boxes(c.chain), held = c.lifted.el.getBoundingClientRect(), keys = document.activeElement === c.own
  // (the change first, the order it was laid in let go after it: the edits, told anew in place, each in the place
  // the drag showed it, so nothing moves but the edit let go)
  const done = trash ? (dropEdit(c.k), true) : !back && !far && c.own.isConnected && c.to !== c.k && moveEdit(c.k, c.to)
  for (const e of parts(c.chain)) e.style.order = ''
  for (const e of c.steps) { e.removeAttribute('data-lead'); e.classList.remove('carried') }
  delete c.chain.dataset.carry
  root.querySelector('.chain-find').removeAttribute('data-lit')
  c.lifted.el.remove()
  fitChain()
  if (trash) return
  // let go there, it slides from where it was held to where it stands, the keys with it where it had them; put back,
  // every edit slides back to its place, it from where it was held
  const to = done ? c.steps[c.to] : c.steps[c.k]
  slide(c.chain, done ? new Map([[to, held]]) : was.set(to, held))
  if (done && keys) to.querySelector('.chain-edit').focus({ preventScroll: true })
}
