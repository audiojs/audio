const namespace = 'http://www.w3.org/2000/svg'
const endGap = 1 + Math.SQRT1_2 // Leave 1px beyond the sharp, 1px arrowhead stroke.
const arrow = ({ x, y }) => `M${x - 5} ${y - 5}L${x} ${y}L${x - 5} ${y + 5}`

// The same route follows real pill positions on the page and in the workshop.
export default function connectChain(chain, {
  viewBox = '0 0 22 16', joint = `M2 8H${22 - endGap}${arrow({ x: 22 - endGap, y: 8 })}`,
  startGap = 2, endGap: gap = endGap, head = arrow
} = {}) {
  const doc = chain.ownerDocument, win = doc.defaultView, demo = chain.closest('.demo')
  const routes = doc.createElementNS(namespace, 'svg')
  routes.classList.add('chain-routes')
  routes.setAttribute('aria-hidden', 'true')
  demo.append(routes)
  chain.setAttribute('data-connected', '')
  let pending
  function refresh() {
    pending = null
    const pills = [...chain.querySelectorAll('.pill')].sort((a, b) => +a.parentElement.style.order - +b.parentElement.style.order)
    for (const [i, pill] of pills.entries()) {
      pill.parentElement.classList.toggle('first', i === 0)
      pill.nextElementSibling.setAttribute('viewBox', viewBox)
      pill.nextElementSibling.firstElementChild.setAttribute('d', joint)
    }
    const origin = demo.getBoundingClientRect()
    routes.setAttribute('viewBox', `0 0 ${demo.clientWidth} ${demo.clientHeight}`)
    let count = 0
    for (const [i, pill] of pills.entries()) {
      const next = pills[i + 1], wraps = next && next.parentElement.offsetTop > pill.parentElement.offsetTop
      pill.nextElementSibling.classList.toggle('wrap-end', !!wraps)
      if (!wraps) continue
      const a = pill.getBoundingClientRect(), b = next.getBoundingClientRect()
      const x = a.right - origin.left - demo.clientLeft, y = (a.top + a.bottom) / 2 - origin.top - demo.clientTop
      const endX = b.left - origin.left - demo.clientLeft, endY = (b.top + b.bottom) / 2 - origin.top - demo.clientTop
      const lane = (a.bottom + b.top) / 2 - origin.top - demo.clientTop, right = x + 12, left = endX - 12, r = 8
      let group = routes.children[count++]
      if (!group) {
        group = doc.createElementNS(namespace, 'g')
        group.append(doc.createElementNS(namespace, 'path'), doc.createElementNS(namespace, 'path'))
        routes.append(group)
      }
      group.dataset.from = pill.dataset.key
      group.dataset.to = next.dataset.key
      group.firstElementChild.setAttribute('d', `M${x + startGap} ${y}H${right - r}Q${right} ${y} ${right} ${y + r}V${lane - r}Q${right} ${lane} ${right - r} ${lane}H${left + r}Q${left} ${lane} ${left} ${lane + r}V${endY - r}Q${left} ${endY} ${left + r} ${endY}H${endX - gap}`)
      group.lastElementChild.setAttribute('d', head({ x: endX - gap, y: endY, lane, right, left }))
    }
    while (routes.children.length > count) routes.lastElementChild.remove()
    // Keep up with swaps, without a permanent animation loop.
    if (chain.getAnimations({ subtree: true }).length) schedule()
  }
  const schedule = () => { if (!pending) pending = win.requestAnimationFrame(refresh) }
  new win.ResizeObserver(schedule).observe(demo)
  new win.MutationObserver(schedule).observe(chain, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['style'] })
  doc.fonts.ready.then(schedule)
  win.addEventListener('resize', schedule)
  refresh()
}
