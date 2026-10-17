// popoff: tooltips, dropdowns, hover cards and modals done one way, on the platform's own popover and <dialog>.
// The markup says what is what; popoff adds what the platform leaves to each page:
//   title="Name (⌘K)\nWhat it does"    a tooltip: its name, its keys softer, a line of what it does, a tip pointing at it
//   [popover][data-place="bottom start"] the popover by what opened it: CSS anchor positioning (position-area, flipped
//                                       by position-try-fallbacks) where the browser has it, measured where it hasn't
//   interestfor="id"                    the popover shown while its invoker is pointed at or focused: a hover card
//   <dialog closedby="any">             a press on the backdrop closes it, where the browser doesn't yet
// One set of listeners on the root, nothing per element; a place measured only as something shows.

const TIP = 'popoff-tip'

// A title as pages write them: its name, its keys in brackets at its end, then what it does, after a colon or on the
// lines after the first. { name, keys, body }
const KEY = /^(?:[⌘⇧⌥⌃]+\S{1,5}|(?:(?:Ctrl|Shift|Alt|Cmd|Meta)\+)+\S{1,5}|[A-Z0-9]|F\d{1,2}|Space|Esc|Enter|Tab|Delete|Home|End|⌫|[←→↑↓])$/
export function parse(text) {
  let [name, ...rest] = text.trim().split('\n'), body = rest.join('\n').trim(), keys = ''
  const colon = name.indexOf(': ')
  if (!body && colon > 0 && colon <= 40) body = name.slice(colon + 2), name = name.slice(0, colon)
  const cut = s => { const m = s.match(/\s*\(([^()]+)\)$/); return m && KEY.test(m[1]) ? (keys = m[1], s.slice(0, m.index)) : s }
  name = cut(name)
  if (!keys && body) body = cut(body)
  return { name, keys, body: body && body[0].toUpperCase() + body.slice(1) }
}

// Puts `el` (fixed) by `anchor` (an element or a rect) on `side` (top, bottom, left, right), aligned to its start,
// center or end; on the other side where this one has no room; slid along to stay `edge` px inside the window. The
// middle of the anchor along that side goes to --popoff-arrow, the side to data-side, for a tip to point. Returns the side
export function place(el, anchor, { side = 'bottom', align = 'center', gap = 8, edge = 8 } = {}) {
  const a = anchor.getBoundingClientRect?.() ?? anchor, w = el.offsetWidth, h = el.offsetHeight, W = innerWidth, H = innerHeight
  const flip = { top: 'bottom', bottom: 'top', left: 'right', right: 'left' }
  const room = s => s === 'top' ? a.top - gap - h >= edge : s === 'bottom' ? a.bottom + gap + h <= H - edge : s === 'left' ? a.left - gap - w >= edge : a.right + gap + w <= W - edge
  if (!room(side) && room(flip[side])) side = flip[side]
  const across = side === 'top' || side === 'bottom', clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))
  let x, y
  if (across) {
    x = clamp(align === 'start' ? a.left : align === 'end' ? a.right - w : a.left + a.width / 2 - w / 2, edge, W - edge - w)
    y = side === 'top' ? a.top - gap - h : a.bottom + gap
  } else {
    y = clamp(align === 'start' ? a.top : align === 'end' ? a.bottom - h : a.top + a.height / 2 - h / 2, edge, H - edge - h)
    x = side === 'left' ? a.left - gap - w : a.right + gap
  }
  const arrow = across ? clamp(a.left + a.width / 2 - x, 10, w - 10) : clamp(a.top + a.height / 2 - y, 10, h - 10)
  Object.assign(el.style, { position: 'fixed', inset: 'auto', margin: '0', left: `${Math.round(x)}px`, top: `${Math.round(y)}px` })
  el.style.setProperty('--popoff-arrow', `${Math.round(arrow)}px`)
  el.dataset.side = side
  return side
}

// data-place as CSS anchor positioning says it: the side, the anchor's edge it lines up with (start, the side's
// start: a dropdown's left edge under its button's)
const AREA = {
  bottom: { start: 'bottom span-right', center: 'bottom', end: 'bottom span-left' },
  top: { start: 'top span-right', center: 'top', end: 'top span-left' },
  right: { start: 'right span-bottom', center: 'right', end: 'right span-top' },
  left: { start: 'left span-bottom', center: 'left', end: 'left span-top' }
}

// The look, every value a variable to set: a dark tag, as tooltips go, its tip the same. Specific enough that a page's
// own [popover] rules don't reach it: a page restyles it through the variables, or styles it all itself (style: false)
const T = `[popover].${TIP}`
const STYLE = `
${T} { position: fixed; inset: auto; width: auto; height: auto; margin: 0; max-width: min(280px, calc(100vw - 16px)); padding: 5px 8px 6px; overflow: visible; border: 0; border-radius: var(--popoff-radius, 6px); background: var(--popoff-bg, #1e1e1e); box-shadow: none; color: var(--popoff-soft, #ffffffb3); filter: var(--popoff-shadow, drop-shadow(0 0 .5px #0006) drop-shadow(0 3px 8px #0004)); font: var(--popoff-font, 11.5px/16px system-ui, sans-serif); text-align: left; pointer-events: none; animation: popoff-in var(--popoff-fade, 90ms) ease-out; }
${T}::before { content: ''; position: absolute; width: 8px; height: 8px; background: inherit; rotate: 45deg; }
${T}[data-side=bottom]::before { top: -3px; left: calc(var(--popoff-arrow) - 4px); }
${T}[data-side=top]::before { bottom: -3px; left: calc(var(--popoff-arrow) - 4px); }
${T}[data-side=right]::before { left: -3px; top: calc(var(--popoff-arrow) - 4px); }
${T}[data-side=left]::before { right: -3px; top: calc(var(--popoff-arrow) - 4px); }
${T} p { position: relative; margin: 0; padding: 0; color: inherit; font: inherit; }
${T} .${TIP}-head { display: flex; align-items: baseline; gap: 10px; color: var(--popoff-ink, #fff); font-weight: 500; }
${T} .${TIP}-keys { margin-left: auto; padding: 0; border: 0; background: none; color: var(--popoff-muted, #ffffff80); font: var(--popoff-keys-font, inherit); font-weight: 400; white-space: nowrap; }
${T} .${TIP}-body { margin-top: 2px; text-wrap: pretty; }
${T} [hidden] { display: none; }
@keyframes popoff-in { from { opacity: 0; } }
@media (prefers-reduced-motion: reduce) { ${T} { animation: none; } }
`
const styled = new WeakSet()
function style(doc) {
  if (styled.has(doc)) return
  styled.add(doc)
  const sheet = new doc.defaultView.CSSStyleSheet()
  sheet.replaceSync(STYLE)
  doc.adoptedStyleSheets = [sheet, ...doc.adoptedStyleSheets]
}

let anchors = 0

/**
 * Starts popoff on `root`; returns what stops it.
 * @param {Document | Element} [root=document]
 * @param {{ delay?: number, hide?: number, gap?: number, edge?: number, tips?: boolean, style?: boolean }} [o]
 *   delay: ms a pointer rests before a tooltip or a hover card shows; hide: ms a hover card stays once left; gap: px
 *   between a thing and what it shows; edge: px kept clear of the window's edge; tips: titles as tooltips; style: the
 *   default look (false: the page styles .popoff-tip and its -head, -name, -keys, -body itself)
 * @returns {() => void}
 */
export default function popoff(root = document, { delay = 500, hide = 300, gap = 8, edge = 8, tips = true, style: styling = true } = {}) {
  const doc = root.ownerDocument ?? root, win = doc.defaultView, offs = []
  const listen = (target, type, fn, opts = true) => { target.addEventListener(type, fn, opts); offs.push(() => target.removeEventListener(type, fn, opts)) }
  const open = el => !!el?.matches?.(':popover-open')
  if (styling) style(doc)

  // ── Tooltips: a title is taken off while pointed at, so the browser's own never shows, and put back after (meanwhile
  // data-tip, which a title set anew replaces: Play turning Pause says so at once). Each waits `delay`, the next as the
  // first: a pointer crossing a toolbar opens none. A press hides it till the pointer leaves; a control whose menu or
  // popover is open has none, nor does a menubar while one of its menus is. Beside a menu's rows, else under it, or over
  // it at the window's foot. A mouse's only: a touch has no hover
  const tip = doc.createElement('div')
  tip.className = TIP
  tip.popover = 'manual'
  tip.setAttribute('role', 'tooltip')
  tip.innerHTML = `<p class="${TIP}-head"><span class="${TIP}-name"></span><kbd class="${TIP}-keys"></kbd></p><p class="${TIP}-body"></p>`
  const [nameEl, keysEl] = tip.firstChild.children, bodyEl = tip.lastChild
  let target = null, timer = 0, pressed = null, tracking = 0
  const watch = new win.MutationObserver(() => { if (target && take(target) && open(tip)) show() })
  const take = t => { const text = t.getAttribute('title'); if (text == null) return false; t.dataset.tip = text; t.removeAttribute('title'); return true }
  const give = t => { if (t.dataset.tip == null) return; t.setAttribute('title', t.dataset.tip); delete t.dataset.tip }
  // what it opens is open: its menu (aria-expanded), its popover, its hover card, or another of its menubar's
  const muted = t => t.getAttribute('aria-expanded') === 'true' || open(t.popoverTargetElement) || open(cardOf(t)) || !!t.closest('[role=menubar]')?.querySelector('[aria-expanded=true]')
  const cardOf = i => i.hasAttribute('interestfor') ? i.interestForElement ?? doc.getElementById(i.getAttribute('interestfor')) : null
  function enter(t) {
    if (t === target) return
    leave()
    target = t
    take(t)
    watch.observe(t, { attributes: true, attributeFilter: ['title'] })
    if (pressed !== t) timer = setTimeout(show, delay)
  }
  function leave() {
    clearTimeout(timer)
    if (!target) return
    watch.disconnect()
    give(target)
    if (pressed === target) pressed = null
    target = null
    conceal()
  }
  function conceal() {
    clearInterval(tracking)
    if (open(tip)) tip.hidePopover()
  }
  function show() {
    const t = target, text = t?.dataset.tip?.trim()
    if (!t?.isConnected || !text || muted(t)) return conceal()
    const { name, keys, body } = parse(text)
    nameEl.textContent = name
    keysEl.textContent = keys
    keysEl.hidden = !keys
    bodyEl.textContent = body
    bodyEl.hidden = !body
    if (!tip.isConnected) doc.body.append(tip)
    // shown last, over what is open: a menu, a dialog
    if (!open(tip)) tip.showPopover()
    position(t)
    clearInterval(tracking)
    // gone from under the pointer (a list redrawn), or moved: so is its tag
    tracking = setInterval(() => target?.isConnected ? position(target) : leave(), 250)
  }
  // a menu's row: beside the menu (a row opening a submenu, on the side away from it, or none); else under, or over
  function position(t) {
    const menu = t.closest('[role=menu], [role=listbox]')
    if (!menu || menu === t) return place(tip, t, { gap, edge })
    const box = menu.getBoundingClientRect(), r = t.getBoundingClientRect(), w = tip.offsetWidth, sub = t.hasAttribute('aria-haspopup')
    const side = !sub && box.right + gap + w <= innerWidth - edge ? 'right' : box.left - gap - w >= edge ? 'left' : null
    if (!side) return sub ? conceal() : place(tip, t, { gap, edge })
    place(tip, { left: box.left, right: box.right, width: box.width, top: r.top, bottom: r.bottom, height: r.height }, { side, gap, edge })
  }
  if (tips) {
    listen(root, 'pointerover', e => {
      if (e.pointerType !== 'mouse') return
      const t = e.target.closest?.('[title], [data-tip]')
      t && t !== tip && !t.hasAttribute('interestfor') ? enter(t) : leave()
    })
    listen(root, 'pointerout', e => { if (target && !target.contains(e.relatedTarget)) leave() })
    // a press: what it does is under way, the tag in its way
    listen(root, 'pointerdown', () => { pressed = target; clearTimeout(timer); conceal() })
    for (const type of ['wheel', 'keydown']) listen(root, type, () => { clearTimeout(timer); conceal() }, { capture: true, passive: true })
    // the window left (another app, another tab); not an element's blur, which focus moving in a menu makes
    listen(win, 'blur', e => { if (e.target === win) leave() }, false)
  }

  // ── Placed popovers: data-place ("bottom start", "top", "right end"…) by what opened it. Where the browser has anchor
  // positioning, said as CSS (position-anchor, position-area, flipped by position-try-fallbacks) and left to it; else
  // measured as it opens and as the page scrolls or resizes
  const anchored = win.CSS?.supports?.('position-area: bottom') ?? false
  const invokers = new WeakMap(), placed = new Set()
  let frame = 0
  const anchorOf = p => invokers.get(p) ?? (p.id ? doc.querySelector(`[popovertarget="${CSS.escape(p.id)}"], [interestfor="${CSS.escape(p.id)}"]`) : null)
  function settle(p) {
    const a = anchorOf(p), [side = 'bottom', align = 'start'] = (p.dataset.place || '').split(/[\s-]+/).filter(Boolean)
    if (!a?.isConnected) return
    if (!anchored) return place(p, a, { side, align, gap, edge })
    // the anchor named on its invoker, once, a name of its own
    const name = a.style.getPropertyValue('anchor-name') || `--popoff-${++anchors}`
    a.style.setProperty('anchor-name', name)
    Object.assign(p.style, { positionAnchor: name, positionArea: AREA[side]?.[align] ?? AREA.bottom.start, positionTryFallbacks: 'flip-block, flip-inline', inset: 'auto', margin: side === 'top' || side === 'bottom' ? `${gap}px 0` : `0 ${gap}px` })
    p.dataset.side = side
  }
  const follow = () => { if (!anchored && placed.size) frame ||= requestAnimationFrame(() => { frame = 0; placed.forEach(settle) }) }
  listen(root, 'click', e => { const i = e.target.closest?.('[popovertarget]'); if (i?.popoverTargetElement) invokers.set(i.popoverTargetElement, i) })
  listen(root, 'toggle', e => {
    const p = e.target
    if (p === tip) return
    // a popover opened, by a click, a key or a script: its control's tooltip goes
    if (e.newState === 'open' && target && muted(target)) conceal()
    if (!p.hasAttribute?.('data-place')) return
    if (e.newState === 'open') { placed.add(p); settle(p) } else placed.delete(p)
  })
  listen(win, 'scroll', follow, { capture: true, passive: true })
  listen(win, 'resize', follow, { passive: true })

  // ── Hover cards (interestfor), where the browser has no interest invokers: the popover shows once its invoker has
  // been pointed at or focused `delay` ms, and goes `hide` ms after the pointer or the focus has left both
  if (!('interestForElement' in win.HTMLElement.prototype)) {
    let card = null, by = null, wait = 0
    const near = t => !!t && (card?.contains(t) || by?.contains(t))
    const go = () => { clearTimeout(wait); wait = setTimeout(() => { if (open(card)) card.hidePopover(); card = by = null }, hide) }
    function come(i) {
      const c = cardOf(i)
      if (!c) return
      clearTimeout(wait)
      if (c === card) return
      if (open(card)) card.hidePopover()
      card = c, by = i
      wait = setTimeout(() => { if (card !== c || open(c)) return; invokers.set(c, i); c.showPopover() }, delay)
    }
    const into = e => { const i = e.target.closest?.('[interestfor]'); if (i) come(i); else if (near(e.target)) clearTimeout(wait); else if (card) go() }
    const out = e => { if (card && !near(e.relatedTarget)) go() }
    listen(root, 'pointerover', into)
    listen(root, 'focusin', into)
    listen(root, 'pointerout', out)
    listen(root, 'focusout', out)
  }

  // ── Modals: <dialog closedby="any"> closes on a press on its backdrop, where the browser doesn't do it itself
  if (!('closedBy' in win.HTMLDialogElement.prototype)) listen(root, 'click', e => {
    const d = e.target
    if (d.localName !== 'dialog' || d.getAttribute('closedby') !== 'any' || !d.open) return
    const r = d.getBoundingClientRect()
    if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) d.close()
  })

  return () => { leave(); offs.forEach(off => off()); watch.disconnect(); tip.remove(); cancelAnimationFrame(frame) }
}
