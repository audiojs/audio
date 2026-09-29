// The production page is the source of every live preview. Nothing is written back to it.
const variants = [
  ['original', 'Original', null],
  ['light', 'Light chain', 'light'],
  ['black', 'Black chain', 'black'],
  ['outline', 'Outline chain', 'outline']
]
const grid = document.querySelector('#variants'), status = document.querySelector('#workshop-status'), controls = document.querySelector('.workshop-controls')
const frames = new Map()
const namespace = 'http://www.w3.org/2000/svg'

// A pill is a stadium; row neighbors join by a neck, following a circle of the given radius set between the two pills
// and touching both. Each pill draws its half of each neck up to the waist in the resting fill, its own body over it in
// the fill of its state, so hover and press light the pill alone, then the edge over both.
const round = n => +n.toFixed(2)
// Half the waist's outer height, or 0 when the circle is too small to reach both pills and they stay apart.
function waist(gap, radius) {
  const half = 15 + gap / 2, reach = 15 + radius, w = Math.sqrt(Math.max(0, reach * reach - half * half)) - radius
  return w >= 1 ? w : 0
}
function bead(width, gap, radius, left, right) {
  const w = waist(gap, radius), half = 15 + gap / 2, reach = 15 + radius
  // The outline e in from the pill's outer edge: 0 for the fill, .5 for the middle of its 1px edge.
  const trace = (e, fill) => {
    const r = 15 - e, n = w - e, k = r / reach, tx = k * half, ty = k * (w + radius)
    const cap = `A${r} ${r} 0 0 1 `, arc = `A${radius + e} ${radius + e} 0 0 0 `
    // One side, clockwise: s = 1 runs down the right cap, s = -1 up the left one.
    const side = (cx, s, joined) => {
      const end = `${cx} ${15 + s * r}`
      if (!joined || !w) return cap + end
      const x = round(cx + s * tx), mid = round(cx + s * half)
      // Both halves reach half a pixel past the waist, fill and edge alike, so they never leave a hairline seam.
      const across = fill ? `h${s * .5}v${round(s * 2 * n)}h${-s * .5}` : `h${s * .5}M${mid + s * .5} ${round(15 + s * n)}h${-s * .5}`
      return `${cap}${x} ${round(15 - s * ty)}${arc}${mid} ${round(15 - s * n)}${across}${arc}${x} ${round(15 + s * ty)}${cap}${end}`
    }
    const cx = round(width - 15)
    return `M15 ${e}H${cx}${side(cx, 1, right)}H15${side(15, -1, left)}${fill ? 'Z' : ''}`
  }
  const cx = round(width - 15), body = `M15 0H${cx}A15 15 0 0 1 ${cx} 30H15A15 15 0 0 1 15 0Z`
  return [trace(0, true), body, trace(.5, false)]
}

function draw(pill, gap, radius, left, right) {
  let svg = pill.querySelector(':scope > .bead')
  if (!svg) {
    svg = pill.ownerDocument.createElementNS(namespace, 'svg')
    svg.classList.add('bead')
    svg.setAttribute('aria-hidden', 'true')
    for (const part of ['bead-neck', 'bead-body', 'bead-edge']) {
      const path = pill.ownerDocument.createElementNS(namespace, 'path')
      path.classList.add(part)
      svg.append(path)
    }
    pill.prepend(svg)
  }
  const width = pill.getBoundingClientRect().width
  svg.setAttribute('viewBox', `0 0 ${width} 30`)
  bead(width, gap, radius, left, right).forEach((d, i) => svg.children[i].setAttribute('d', d))
}

function connect(frame, shape) {
  const doc = frame.contentDocument, win = frame.contentWindow, demo = doc.querySelector('.demo'), chain = doc.querySelector('.chain')
  let pending, reveal
  // A lazy preview may load after the controls changed.
  tune(doc.documentElement)
  // The slot a pill is dragged out of breaks the chain.
  function beads() {
    const gap = parseFloat(win.getComputedStyle(chain).columnGap), radius = controls.elements.radius.valueAsNumber
    const links = [...chain.querySelectorAll('.link')].sort((a, b) => +a.style.order - +b.style.order)
    const joins = (a, b) => !!b && !a.classList.contains('drag-source') && !b.classList.contains('drag-source')
    links.forEach((link, i) => draw(link.querySelector('.pill'), gap, radius, joins(link, links[i - 1]), joins(link, links[i + 1])))
    const lifted = doc.querySelector('.pill.dragged')
    if (lifted) draw(lifted, gap, radius, false, false)
  }
  function refresh() {
    pending = null
    if (shape) beads()
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
    // Keep each bead on its pill while pills grow or slide.
    if (shape && chain.getAnimations({ subtree: true }).length) schedule()
  }
  const schedule = () => { if (!pending) pending = requestAnimationFrame(refresh) }
  new ResizeObserver(schedule).observe(demo)
  new MutationObserver(schedule).observe(chain, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['class', 'style'] })
  const menus = new MutationObserver(() => { reveal = true; schedule() })
  for (const menu of doc.querySelectorAll('[popover]')) {
    menus.observe(menu, { childList: true, subtree: true, characterData: true })
    menu.addEventListener('toggle', event => { reveal = event.newState === 'open'; schedule() })
  }
  // The row scrolls sideways, so it brings a focused step fully into view: focus leaves a partly visible one as it is.
  if (shape) chain.addEventListener('focusin', event => event.target.scrollIntoView({ block: 'nearest', inline: 'nearest' }))
  win.addEventListener('resize', schedule)
  doc.fonts.ready.then(schedule)
  refresh()
  frames.set(frame, schedule)
  frame.dataset.ready = 'true'
}

try {
  const response = await fetch('../index.html')
  if (!response.ok) throw Error('Page unavailable')
  const source = await response.text()
  for (const [id, name, shape] of variants) {
    const card = document.createElement('section')
    card.className = 'variant'
    card.id = id
    const heading = document.createElement('div')
    heading.className = 'variant-heading'
    const title = document.createElement('h2')
    title.textContent = name
    heading.append(title)
    const frame = document.createElement('iframe')
    frame.title = name
    frame.loading = 'lazy'
    const doc = new DOMParser().parseFromString(source, 'text/html')
    doc.documentElement.classList.add('workshop-preview')
    tune(doc.documentElement)
    if (shape) {
      doc.documentElement.dataset.chain = shape
      // A chain step carries its method's icon, and its name and values in a label that can fold away behind it.
      const pill = doc.querySelector('.chain .pill'), label = doc.createElement('span'), text = doc.createElement('span')
      label.className = 'step-label'
      text.append(...pill.children)
      label.append(text)
      pill.append(label)
      pill.insertAdjacentHTML('afterbegin', '<svg class="step-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path :d="methods[step.type].icon"/></svg>')
    }
    const base = doc.createElement('base'), css = doc.createElement('link')
    base.href = new URL('../index.html', location.href).href
    css.rel = 'stylesheet'
    css.href = 'workshop/workshop.css'
    doc.head.prepend(base)
    doc.head.append(css)
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

// Controls apply to every live preview at once.
function tune(root) {
  root.dataset.steps = controls.elements.steps.value
  root.style.setProperty('--bead-gap', controls.elements.gap.value + 'px')
}
// The page reflects the controls' values, including ones the browser restores on reload.
function reflect() {
  const { gap, radius, waist: out } = controls.elements, w = waist(gap.valueAsNumber, radius.valueAsNumber)
  document.body.dataset.width = controls.elements.width.value
  gap.nextElementSibling.value = gap.value + ' px'
  radius.nextElementSibling.value = radius.value + ' px'
  out.value = w ? +(2 * w).toFixed(1) + ' px' : 'apart'
}
controls.addEventListener('input', () => {
  for (const [frame, schedule] of frames) { tune(frame.contentDocument.documentElement); schedule() }
  reflect()
})
reflect()
