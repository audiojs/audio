// Hints: a few words by what they are about, one at a time, over everything, as a tooltip that follows the hand: what a
// number in the code sets and its range, what a drag on the picture does as it goes, what a handle or a button does now.
// Whoever shows one hides only its own (`by`), so the picture redrawing never takes away the code's. Its look is the
// page's, for a theme to restyle (repl.css .hint).
export default function hint(parent = document.body) {
  const el = parent.appendChild(Object.assign(document.createElement('div'), { className: 'hint', hidden: true }))
  el.setAttribute('aria-hidden', 'true')
  let owner = null, timer = 0
  // By a point in the window, { x, y }: its middle at y, from x on, up to it, or centred on it (`align`: 'left',
  // 'right', 'center'); or under an element, centred. Kept in the window.
  function show(text, at, by = null, align = 'left') {
    clearTimeout(timer)
    owner = by
    if (el.textContent !== text) el.textContent = text
    el.hidden = false
    const w = el.offsetWidth, h = el.offsetHeight
    let x, y
    if (at instanceof Element) { const r = at.getBoundingClientRect(); x = r.left + r.width / 2 - w / 2; y = r.bottom + 6 }
    else { x = align === 'center' ? at.x - w / 2 : align === 'right' ? at.x - w : at.x; y = at.y - h / 2 }
    el.style.left = `${Math.round(Math.max(4, Math.min(innerWidth - w - 4, x)))}px`
    el.style.top = `${Math.round(Math.max(4, Math.min(innerHeight - h - 4, y)))}px`
  }
  function hide(by = null) {
    if (by !== owner || el.hidden) return
    clearTimeout(timer)
    el.hidden = true
    owner = null
  }
  // for a moment: a change said where it was made
  function flash(text, at, by = null, ms = 1200) {
    show(text, at, by)
    timer = setTimeout(() => hide(by), ms)
  }
  return { show, hide, flash }
}
