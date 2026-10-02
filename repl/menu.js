// The app menu: every act the page offers, grouped as desktop apps group them, each with its keys, so the menu is also
// the map of the page. `model()` gives the menus afresh each time one opens (what is checked, what can't be done now):
//   [{ name, items: [{ label, keys?, hint?, run?, checked?, disabled?, items? } | '-' | { group: 'Heading' }] }]
// Keys as in desktop menus (WAI-ARIA menubar): ←/→ across the bar, ↓, Enter or Space opens, ↑/↓ through a menu, → into
// a submenu, ← back out, Enter runs, Esc closes; F10 reaches the bar. Hovering across the bar while a menu is open
// opens the one under the pointer. After an item runs, the keys go back to where they were, so Space still plays.
// A narrow window has one Menu, the menus inside it, each opening in place. The same menus open at a point, as a
// context menu (`at`), with the same keys but ← and →.
export default function menubar(root, model) {
  let open = null, back = null, hovering = 0
  const narrow = matchMedia('(max-width: 720px)')
  const menus = () => narrow.matches ? [{ name: 'Menu', title: 'Everything the page does', items: model().map(m => ({ label: m.name, items: m.items })) }] : model()

  function draw() {
    close(false)
    root.replaceChildren(...menus().map((menu, i) => {
      const button = document.createElement('button')
      Object.assign(button, { type: 'button', className: 'menubar-item', textContent: menu.name, title: menu.title || menu.name, tabIndex: i ? -1 : 0 })
      button.setAttribute('role', 'menuitem')
      button.setAttribute('aria-haspopup', 'menu')
      button.setAttribute('aria-expanded', 'false')
      // on click, once the press has ended: a popover opened on the press would take its release for a click outside
      button.addEventListener('pointerdown', event => event.preventDefault())
      button.addEventListener('click', event => { open?.button === button ? close() : show(i, !event.detail) })
      button.addEventListener('pointerenter', () => { if (open && open.button !== button) show(i, false) })
      button.addEventListener('keydown', event => barKey(event, i))
      return button
    }))
  }
  const buttons = () => [...root.children]

  // A menu under its button, its items as the model says now
  function show(i, focus = true) {
    const button = buttons()[i], menu = menus()[i]
    // the keys go back where they were before the menu: not to the bar, when it was reached by F10
    if (!open && !root.contains(document.activeElement)) back = document.activeElement
    close(false)
    const panel = list(menu.items, menu.name)
    panel.className += ' menubar-menu'
    document.body.append(panel)
    panel.showPopover({ source: button })
    place(panel, button.getBoundingClientRect(), 'below')
    button.setAttribute('aria-expanded', 'true')
    buttons().forEach(b => b.tabIndex = b === button ? 0 : -1)
    opened({ i, button, panel }, focus)
  }
  // The menu at a point, a context menu's `items`, the keys going back where they were when it closes. It opens while
  // the button is still down (a Mac's right press), so it closes itself on a press outside it rather than on the release
  function at(items, x, y) {
    back = open ? back : document.activeElement
    close(false)
    const panel = list(items, 'Context menu'), outside = event => { if (!panel.contains(event.target)) close(false) }
    panel.className += ' menubar-menu'
    panel.popover = 'manual'
    document.body.append(panel)
    panel.showPopover()
    place(panel, { left: x, right: x, top: y - 4, bottom: y - 4 }, 'below')
    addEventListener('pointerdown', outside, true)
    panel.addEventListener('toggle', event => { if (event.newState === 'closed') removeEventListener('pointerdown', outside, true) })
    opened({ i: -1, button: null, panel }, false)
  }
  function opened(o, focus) {
    const { panel, button } = open = o
    panel.addEventListener('toggle', event => { if (event.newState === 'closed' && open?.panel === panel) finish() })
    // opened by the pointer, the menu itself has the keys until an item does
    panel.addEventListener('keydown', event => {
      if (event.target !== panel) return
      const list = rows(panel), k = event.key
      if (k === 'ArrowDown' || k === 'Home') first(panel)?.focus()
      else if (k === 'ArrowUp' || k === 'End') list.at(-1)?.focus()
      else if ((k === 'ArrowRight' || k === 'ArrowLeft') && button) show((o.i + (k === 'ArrowRight' ? 1 : -1) + buttons().length) % buttons().length)
      else if (k === 'Escape') { close(!button); button?.focus() }
      else return
      event.preventDefault()
    })
    if (focus) first(panel)?.focus()
    else panel.focus({ preventScroll: true })
  }
  // A list of items; a submenu is its own list inside it, so it stays open while it is
  function list(items, label) {
    const panel = document.createElement('div')
    panel.className = 'menu menubar-list'
    panel.setAttribute('role', 'menu')
    panel.setAttribute('aria-label', label)
    panel.popover = 'auto'
    panel.tabIndex = -1
    for (const it of items) {
      if (it === '-') { const hr = panel.appendChild(document.createElement('hr')); hr.setAttribute('role', 'separator'); continue }
      if (it.group) { const p = panel.appendChild(document.createElement('p')); p.className = 'menu-group'; p.textContent = it.group; continue }
      const row = panel.appendChild(document.createElement('button'))
      row.type = 'button'
      row.className = 'menu-row'
      row.setAttribute('role', it.checked != null ? 'menuitemcheckbox' : 'menuitem')
      if (it.checked != null) row.setAttribute('aria-checked', String(!!it.checked))
      if (it.disabled) row.setAttribute('aria-disabled', 'true')
      row.tabIndex = -1
      row.title = it.hint || ''
      row.innerHTML = '<span class="menu-check" aria-hidden="true"></span><span class="menu-label"></span><span class="menu-keys"></span>'
      row.children[1].textContent = it.label
      // its icon, in the check's place, where it has one (a path of the page's own)
      if (it.icon) row.children[0].innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="${it.icon}"/></svg>`
      // its keys, or a word on what it is
      row.children[2].textContent = it.items ? '' : it.keys || it.hint || ''
      if (!it.keys && it.hint) row.children[2].classList.add('hint')
      if (it.items) {
        row.setAttribute('aria-haspopup', 'menu')
        row.setAttribute('aria-expanded', 'false')
        row.classList.add('has-sub')
        const sub = list(it.items, it.label)
        sub.className += ' menubar-sub'
        // narrow: in place, under its row
        if (narrow.matches) { sub.popover = null; sub.hidden = true; sub.classList.add('inline') }
        row.after(sub)
        row.sub = sub
        if (!narrow.matches) row.addEventListener('pointerenter', () => { clearTimeout(hovering); hovering = setTimeout(() => expand(row), 120) })
        row.addEventListener('click', () => expand(row, true))
      } else {
        row.addEventListener('pointerenter', () => { clearTimeout(hovering); hovering = setTimeout(() => collapse(panel), 120); row.focus({ preventScroll: true }) })
        row.addEventListener('click', () => { if (!it.disabled) run(it) })
      }
      row.addEventListener('pointerdown', event => event.preventDefault())
      row.addEventListener('keydown', event => menuKey(event, row, panel))
    }
    return panel
  }
  // A submenu opens beside its row, or, where there is no room beside, under it; in a narrow window, in place
  function expand(row, focus = false) {
    const panel = row.parentElement
    if (row.sub.classList.contains('inline')) {
      row.sub.hidden = !row.sub.hidden
      row.setAttribute('aria-expanded', String(!row.sub.hidden))
      if (focus && !row.sub.hidden) first(row.sub)?.focus()
      return
    }
    collapse(panel, row.sub)
    if (!row.sub.matches(':popover-open')) {
      row.sub.showPopover({ source: row })
      place(row.sub, row.getBoundingClientRect(), 'beside')
      row.setAttribute('aria-expanded', 'true')
    }
    if (focus) first(row.sub)?.focus()
  }
  // Closes the submenus of `panel`, but `keep`
  function collapse(panel, keep = null) {
    for (const sub of panel.querySelectorAll(':scope > .menubar-sub:not(.inline)')) if (sub !== keep && sub.matches(':popover-open')) {
      sub.hidePopover()
      sub.previousElementSibling?.setAttribute('aria-expanded', 'false')
    }
  }
  // Within the window: below its button, or beside its row, else the other side
  function place(panel, at, where) {
    const w = panel.offsetWidth, h = panel.offsetHeight, W = innerWidth, H = innerHeight
    let x = where === 'below' ? at.left : at.right - 2, y = where === 'below' ? at.bottom + 4 : at.top - 6
    if (x + w > W - 8) x = where === 'below' ? W - 8 - w : at.left - w + 2
    if (x < 8) x = 8
    if (y + h > H - 8) y = Math.max(8, where === 'below' ? H - 8 - h : H - 8 - h)
    Object.assign(panel.style, { left: `${x}px`, top: `${y}px` })
  }
  // a panel's rows, and those of the submenus open in place inside it
  const rows = panel => [...panel.children].flatMap(el => el.classList.contains('menu-row') ? [el] : el.classList.contains('inline') && !el.hidden ? rows(el) : [])
  const first = panel => rows(panel).find(r => r.getAttribute('aria-disabled') !== 'true') ?? rows(panel)[0]

  function run(it) {
    close()
    it.run?.()
  }
  // Ends the open menu; the keys go back where they were, unless `restore` is off (another menu takes over)
  function close(restore = true) {
    if (!open) return
    const { panel, button } = open
    open = null
    button?.setAttribute('aria-expanded', 'false')
    if (panel.matches(':popover-open')) panel.hidePopover()
    panel.remove()
    if (restore) { const to = back; back = null; to?.isConnected && to !== document.body ? to.focus({ preventScroll: true }) : null }
  }
  function finish() { close(false); back = null }

  function barKey(event, i) {
    const n = buttons().length, k = event.key
    const go = j => { const b = buttons()[(j + n) % n]; buttons().forEach(x => x.tabIndex = x === b ? 0 : -1); open ? show((j + n) % n) : b.focus() }
    if (k === 'ArrowRight') go(i + 1)
    else if (k === 'ArrowLeft') go(i - 1)
    else if (k === 'ArrowDown' || k === 'Enter' || k === ' ') show(i)
    else if (k === 'Escape' && open) close()
    else return
    event.preventDefault()
  }
  function menuKey(event, row, panel) {
    const k = event.key, list = rows(panel), at = list.indexOf(row), sub = panel.classList.contains('menubar-sub')
    const move = d => { let j = at; do j = (j + d + list.length) % list.length; while (list[j].getAttribute('aria-disabled') === 'true' && j !== at); list[j].focus() }
    if (k === 'ArrowDown') move(1)
    else if (k === 'ArrowUp') move(-1)
    else if (k === 'Home') list[0]?.focus()
    else if (k === 'End') list.at(-1)?.focus()
    else if (k === 'ArrowRight' && row.sub) expand(row, true)
    else if (k === 'ArrowLeft' && sub && !panel.classList.contains('inline')) { const owner = panel.previousElementSibling; collapse(owner.parentElement); owner.focus() }
    else if ((k === 'ArrowRight' || k === 'ArrowLeft') && open.button) show((open.i + (k === 'ArrowRight' ? 1 : -1) + buttons().length) % buttons().length)
    else if (k === 'Enter' || k === ' ') row.click()
    else if (k === 'Escape') { if (sub) { const owner = panel.previousElementSibling; collapse(owner.parentElement); owner.focus() } else { const b = open.button; close(!b); b?.focus() } }
    else if (k === 'Tab') close()
    else if (k.length === 1 && /\S/.test(k)) {
      // the next item starting with that letter
      const from = [...list.slice(at + 1), ...list.slice(0, at + 1)]
      from.find(r => r.children[1].textContent.trim().toLowerCase().startsWith(k.toLowerCase()))?.focus()
    }
    else return
    event.preventDefault()
    event.stopPropagation()
  }

  root.setAttribute('role', 'menubar')
  addEventListener('keydown', event => {
    if (event.key !== 'F10' || event.metaKey || event.ctrlKey || event.altKey) return
    event.preventDefault()
    back = document.activeElement
    buttons()[0]?.focus()
  })
  addEventListener('resize', () => close(false))
  narrow.addEventListener('change', draw)
  draw()
  return { draw, close, at }
}
