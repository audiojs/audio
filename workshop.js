// The production page is the source of every live preview. Nothing is written back to it.
const variants = [
  ['round-bottom', 'Original', 'Below players', 'round', false],
  ['round-middle', 'Rounded pills', 'Between waveforms', 'round', true],
  ['soft-bottom', 'Soft pointers', 'Below players', 'soft', false],
  ['soft-middle', 'Soft pointers', 'Between waveforms', 'soft', true],
  ['chevron-bottom', 'Chevrons', 'Below players', 'chevron', false],
  ['chevron-middle', 'Chevrons', 'Between waveforms', 'chevron', true]
]
const grid = document.querySelector('#variants'), status = document.querySelector('#workshop-status')
const namespace = 'http://www.w3.org/2000/svg'

function outline(width, shape) {
  const end = width - .5, shoulder = width - 12
  return shape === 'soft'
    ? `M15 .5H${shoulder - 2}Q${shoulder} .5 ${shoulder + 2} 3L${end - 1} 13Q${end + .3} 15 ${end - 1} 17L${shoulder + 2} 27Q${shoulder} 29.5 ${shoulder - 2} 29.5H15A14.5 14.5 0 0 1 15 .5Z`
    : `M.75 .5H${shoulder}L${end} 15L${shoulder} 29.5H.75L12 15Z`
}

function connect(frame, shape) {
  const doc = frame.contentDocument, win = frame.contentWindow, demo = doc.querySelector('.demo')
  let pending, reveal
  function refresh() {
    pending = null
    if (shape !== 'round') for (const pill of doc.querySelectorAll('.chain .pill')) {
      let svg = pill.querySelector('.crumb-outline')
      if (!svg) {
        svg = doc.createElementNS(namespace, 'svg')
        svg.classList.add('crumb-outline')
        svg.setAttribute('aria-hidden', 'true')
        svg.append(doc.createElementNS(namespace, 'path'))
        pill.prepend(svg)
      }
      const width = pill.offsetWidth
      svg.setAttribute('viewBox', `0 0 ${width} 30`)
      svg.firstElementChild.setAttribute('d', outline(width, shape))
    }
    // Include open popovers so the iframe never clips a connected menu.
    let height = demo.offsetHeight + 80, menuTop = Infinity, menuBottom = 0
    for (const menu of doc.querySelectorAll('[popover]:popover-open')) {
      const panel = menu.querySelector('.pill-body, .add-body')
      const top = menu.getBoundingClientRect().top + win.scrollY
      menuTop = Math.min(menuTop, top)
      menuBottom = Math.max(menuBottom, top + panel.offsetTop + panel.scrollHeight + 2)
      height = Math.max(height, menuBottom + 24)
    }
    frame.parentElement.style.setProperty('--player-height', demo.offsetHeight + 'px')
    frame.style.height = Math.ceil(height) + 'px'
    if (reveal && menuBottom) {
      const top = frame.getBoundingClientRect().top
      const shift = Math.min(Math.max(0, top + menuBottom - innerHeight + 24), Math.max(0, top + menuTop - 24))
      if (shift) scrollBy({ top: Math.ceil(shift), behavior: 'instant' })
    }
    reveal = false
  }
  const schedule = () => { if (!pending) pending = requestAnimationFrame(refresh) }
  new ResizeObserver(schedule).observe(demo)
  new MutationObserver(schedule).observe(doc.querySelector('.chain'), { childList: true, subtree: true, characterData: true })
  const menus = new MutationObserver(() => { reveal = true; schedule() })
  for (const menu of doc.querySelectorAll('[popover]')) {
    menus.observe(menu, { childList: true, subtree: true, characterData: true })
    menu.addEventListener('toggle', event => { reveal = event.newState === 'open'; schedule() })
  }
  win.addEventListener('resize', schedule)
  doc.fonts.ready.then(schedule)
  refresh()
  frame.dataset.ready = 'true'
}

try {
  const response = await fetch('index.html')
  if (!response.ok) throw Error('Page unavailable')
  const source = await response.text()
  for (const [id, name, position, shape, middle] of variants) {
    const card = document.createElement('section')
    card.className = 'variant'
    card.id = id
    const heading = document.createElement('div')
    heading.className = 'variant-heading'
    const title = document.createElement('h2'), placement = document.createElement('span')
    title.textContent = name
    placement.textContent = position
    heading.append(title, placement)
    const frame = document.createElement('iframe')
    frame.title = `${name} — ${position.toLowerCase()}`
    frame.loading = 'lazy'
    const doc = new DOMParser().parseFromString(source, 'text/html')
    doc.documentElement.classList.add('workshop-preview')
    doc.documentElement.dataset.shape = shape
    const base = doc.createElement('base'), css = doc.createElement('link')
    base.href = new URL('index.html', location.href).href
    css.rel = 'stylesheet'
    css.href = 'workshop.css'
    doc.head.prepend(base)
    doc.head.append(css)
    if (middle) {
      const pipeline = doc.createElement('div')
      pipeline.className = 'pipeline'
      const edited = doc.querySelector('.edited-row')
      edited.before(pipeline)
      pipeline.append(doc.querySelector('.chain'), doc.querySelector('.tool.add'))
    }
    frame.addEventListener('load', () => connect(frame, shape), { once: true })
    frame.srcdoc = '<!doctype html>\n' + doc.documentElement.outerHTML
    const surface = document.createElement('div')
    surface.className = 'variant-player'
    surface.append(frame)
    card.append(heading, surface)
    grid.append(card)
  }
  status.textContent = ''
} catch {
  status.textContent = 'Could not load the players. Reload to try again.'
} finally {
  grid.setAttribute('aria-busy', 'false')
}

document.querySelector('.preview-width').addEventListener('change', event => {
  document.body.dataset.width = event.target.value
})
