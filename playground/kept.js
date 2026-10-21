// A 2D context that lays a frame on its canvas only when it differs from the frame there: what draw(fn) draws is listed,
// and laid, from the context's defaults, only when the list is not the one laid or the canvas was resized (blank). A
// layer drawn as it was (the marks on the reel as the view follows, the overlay as it plays) is neither rasterized nor
// sent to the compositor again: a window-wide canvas laid each frame is what kept the GPU from the compositor's frames.
// What sets the state (a property, save, restore) is applied as it is listed, so a measure reads as it would; a read, or
// what makes a gradient, passes through; drawn outside draw(), the canvas is laid again at the next.
// kept(context) → { g, draw(fn) }: g, the context to draw on
const READS = /^(measure|get|is|create)/, STATE = new Set(['save', 'restore'])
const same = (a, b) => Object.is(a, b) || Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => same(v, b[i]))

export default function kept(target) {
  let list = null, laid = null, size = ''
  const g = new Proxy(target, {
    get(t, k) {
      const v = t[k]
      if (typeof v !== 'function') return v
      if (typeof k !== 'string' || READS.test(k)) return v.bind(t)
      if (!list) { laid = null; return v.bind(t) }
      return (...a) => { list.push(k, a); if (STATE.has(k)) v.apply(t, a) }
    },
    set(t, k, v) { t[k] = v; if (list) list.push(k, v); else laid = null; return true }
  })
  function lay(ops) {
    if (target.reset) target.reset()
    else target.canvas.width = target.canvas.width
    for (let i = 0; i < ops.length; i += 2) typeof target[ops[i]] === 'function' ? target[ops[i]](...ops[i + 1]) : target[ops[i]] = ops[i + 1]
  }
  function draw(fn) {
    list = []
    try { return fn() } finally {
      const ops = list, at = `${target.canvas.width} ${target.canvas.height}`
      list = null
      if (at !== size || !same(ops, laid)) lay(ops)
      laid = ops; size = at
    }
  }
  return { g, draw }
}
