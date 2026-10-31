// The playground in the Mac app: its layout, menus and window toolbar.
const app = window.webkit?.messageHandlers?.app
const post = message => app?.postMessage(message)

// ---- the window: the page all of it, no bar of its own (its menus are the Mac's), the panes edge to edge ----
document.documentElement.classList.add('desktop')
document.head.append(Object.assign(document.createElement('style'), { textContent: `
  html.desktop .app { grid-template-rows: minmax(0, 1fr); }
  html.desktop .app > .bar { display: none; }
  html.desktop .panes { margin: 0; border-radius: 0; box-shadow: none; background: var(--color-screen); }
  html.desktop body { background: var(--color-screen); }
  html.desktop .panes > .side-head { display: none; }
` }))

globalThis.audioHost = { run, push, panel }

// ---- the panels (the page's own buttons at its top right) as the window's toolbar ----
const panels = () => [...document.querySelectorAll('.side-head .panels button[role="tab"]')]
function panel(label) { panels().find(b => b.getAttribute('aria-label') === label)?.click(); push() }

// ---- the menus: the page's own, as its menu bar has them now, to the Mac's; an item picked there runs here ----
let runs = new Map(), queued = 0
function serialize(menus) {
  runs = new Map()
  const walk = (items, path) => items.map((it, i) => {
    if (it === '-') return { separator: true }
    if (it.group) return { group: it.group }
    const id = `${path}.${i}`
    if (it.run) runs.set(id, it.run)
    return { id, label: it.label, keys: it.keys || '', hint: it.hint || '', tip: it.tip || '', checked: !!it.checked, disabled: !!it.disabled || (!it.run && !it.items?.length), ...it.items && { items: walk(it.items, id) } }
  })
  return menus.map((m, i) => ({ name: m.name, items: walk(m.items, `${i}`) }))
}

function run(id) { runs.get(id)?.(); push() }

// The page's colour where the window's title bar meets it, as rgb, for the window to wear it
function colour() {
  const probe = document.querySelector('.panes') ?? document.body
  const css = getComputedStyle(probe).getPropertyValue('--color-screen').trim() || getComputedStyle(document.body).backgroundColor
  const g = Object.assign(document.createElement('canvas'), { width: 1, height: 1 }).getContext('2d')
  g.fillStyle = css
  g.fillRect(0, 0, 1, 1)
  return [...g.getImageData(0, 0, 1, 1).data.slice(0, 3)]
}

// what the menus are now, the field being written in (the Mac's Copy and Paste go to it then), the colour: sent as the
// page settles from what was done, and whenever the app asks (a menu opening)
function push() {
  clearTimeout(queued)
  queued = setTimeout(() => {
    const menus = document.querySelector('.menubar')?.menus?.()
    if (!menus) return
    const editing = !!document.activeElement?.closest?.('input, textarea, select, [contenteditable="true"], .cm-editor')
    const toolbar = panels().map(b => ({ label: b.getAttribute('aria-label'), selected: b.getAttribute('aria-selected') === 'true' }))
    const title = document.title.replace(/ · audio playground$/, '')
    post({ menus: serialize(menus), recording: !!document.querySelector('button.record.on'), editing, background: colour(), toolbar, title })
  }, 30)
}
for (const type of ['pointerup', 'keyup', 'focusin', 'focusout']) addEventListener(type, push, true)
new MutationObserver(push).observe(document.documentElement, { attributes: true, attributeFilter: ['style', 'class', 'data-theme'] })
new MutationObserver(push).observe(document.head, { childList: true, subtree: true, characterData: true })   // the title
// the page's menus are there once its editor has wired them
const ready = setInterval(() => {
  if (!document.querySelector('.menubar')?.menus) return
  clearInterval(ready)
  const record = document.querySelector('button.record')
  if (record) new MutationObserver(push).observe(record, { attributes: true, attributeFilter: ['class'] })
  push()
}, 50)
