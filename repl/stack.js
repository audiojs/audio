import { ops, format, fromManifest } from './ops.js'
import { chain, callAt, setArg, number, offCalls, turnOff, turnOn, parseCall } from './code.js'

// The stack, beside the output: the chain's steps as cards, in order; the same chain as the code, as controls. A card
// names its step and what it is set to, and opens to its settings, a slider (or a choice) each; moving one rewrites that
// argument in place, and a whole drag is one undo step. Cards open and close on their own, any number at once. The ones
// the code's selection touches open by themselves; one closed while touched stays closed until the selection leaves it.
// A card's switch turns its step off and on (the call commented out where it stands, so the code says it too); its Δ
// plays and draws what the step takes out (the output before it less the output after it); its × removes it. The bar
// at the foot rolls the chain back: dragged up between two steps, those below it are left out until it goes back down,
// as a CAD model's rollback bar. The card last touched, or at the selection, draws what it sets over the output
// (`oncall`); what the output shows, when it is not the whole chain, goes to `onview({ delta, back })`: `delta` the
// index of the live step whose difference plays, `back` how many live steps are kept. A call at the caret outside the
// chain (in another statement) shows first, on its own.
export default function stack(root, { ed, describe = async () => null, duration = () => 1, oncall = () => {}, onview = () => {}, onpreview = () => {} }) {
  const list = root.appendChild(document.createElement('ol'))
  list.className = 'steps-list'
  // Cards are known by where their call's "(" is, carried through every edit: those opened by hand, those closed by hand
  // while touched, those touched now, the one whose settings show
  let pinned = new Set(), dismissed = new Set(), touched = new Set(), focus = null, cards = [], shape = ''
  // what the output shows: the difference a live step makes, or the chain kept down to the bar (cards above it)
  let delta = null, bar = null
  const rollback = document.createElement('li')
  rollback.className = 'rollback'
  rollback.tabIndex = 0
  rollback.setAttribute('role', 'separator')
  rollback.setAttribute('aria-orientation', 'horizontal')
  rollback.setAttribute('aria-label', 'Rollback bar: the steps below it are left out')
  rollback.title = 'Drag up to roll the chain back to a step; double-click or End to bring it all back'

  function refresh(update) {
    if (update?.docChanged) {
      const map = p => update.changes.mapPos(p)
      pinned = new Set([...pinned].map(map))
      dismissed = new Set([...dismissed].map(map))
      if (focus != null) focus = map(focus)
    }
    const code = ed.code, calls = chain(code)?.calls || [], [from, to] = ed.range, at = callAt(code, ed.head)
    const own = at && calls.some(k => k.to === at.to && k.name === at.name)
    // the live steps and those turned off, in the order they stand
    const steps = [...calls, ...offCalls(code).map(o => ({ ...parseCall(o.text), ...o, dot: o.from, list: null, off: true }))].sort((p, q) => p.dot - q.dot)
    const rows = at && !own ? [{ ...at, outside: true }, ...steps] : steps
    // the call at the caret, or every call a range reaches into
    const touches = k => !k.off && (from === to ? !!at && k.to === at.to && k.name === at.name : (k.dot ?? k.from) < to && k.to > from)
    touched = new Set(rows.filter(touches).map(k => k.list.from))
    dismissed = new Set([...dismissed].filter(p => touched.has(p)))
    if ((!update || update.selectionSet) && touched.size) focus = rows.find(k => touched.has(k.list.from)).list.from
    // cards are built again only when the steps change, never by a slider's own edits; then what showed goes
    const next = rows.map(k => (k.off ? '~' : '') + k.name + (k.outside ? '*' : '')).join()
    if (next !== shape) { build(rows); if (shape && (delta != null || bar != null)) view(null, null) }
    shape = next
    rows.forEach((call, i) => { cards[i].call = call })
    render()
  }

  function build(rows) {
    cards = rows.map(call => {
      const li = document.createElement('li'), head = li.appendChild(document.createElement('div'))
      li.className = 'step' + (call.outside ? ' outside' : '')
      head.className = 'step-head'
      head.innerHTML = '<button class="step-toggle" type="button"><span class="step-name"></span><span class="step-args"></span></button>'
      const toggle = head.firstChild, card = { li, toggle, args: toggle.lastChild, call, params: null }
      toggle.firstChild.textContent = call.name[0].toUpperCase() + call.name.slice(1)
      toggle.title = `${ops[call.name]?.text || '.' + call.name + '()'}: open or close its settings`
      // a press leaves the keys where they were: Space still plays, the code keeps its caret
      toggle.addEventListener('mousedown', event => event.preventDefault())
      toggle.addEventListener('click', () => flip(card))
      if (!call.outside) {
        card.delta = button(head, 'step-delta', 'Δ', null, () => hear(card))
        card.on = button(head, 'step-on', null, 'M12 3v8M6.3 6.3a8 8 0 1 0 11.4 0', () => onOff(card))
        button(head, 'step-remove', null, 'm7 7 10 10M17 7 7 17', () => drop(card), `Remove .${call.name}() from the chain`, `Remove ${call.name}`)
      }
      return card
    })
    list.replaceChildren(...cards.map(c => c.li), rollback)
  }
  function button(head, name, text, path, act, title = '', label = title) {
    const b = head.appendChild(document.createElement('button'))
    b.className = `${name} icon-button`
    b.type = 'button'
    if (text) b.textContent = text
    else b.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true"><path d="${path}"/></svg>`
    if (title) b.title = title
    if (label) b.setAttribute('aria-label', label)
    b.addEventListener('mousedown', event => event.preventDefault())
    b.addEventListener('click', act)
    return b
  }

  // Live steps, in order: those the output runs
  const live = () => cards.filter(c => !c.call.off && !c.call.outside)
  // A step that moves time (cuts, stretches, a new rate) has no difference to hear: before and after don't line up
  const moves = name => ['Edit', 'Time & pitch'].includes(ops[name]?.group) || name === 'mark'

  function render() {
    const code = ed.code, steps = live(), kept = bar == null ? Infinity : bar
    for (const c of cards) {
      const call = c.call, at = call.list?.from, open = !call.off && (pinned.has(at) || touched.has(at) && !dismissed.has(at)), i = steps.indexOf(c)
      c.li.classList.toggle('open', open)
      c.li.classList.toggle('current', touched.has(at))
      c.li.classList.toggle('off', !!call.off)
      c.li.classList.toggle('rolled', i >= kept || !!call.off && cards.indexOf(c) > position())
      c.li.classList.toggle('delta', i >= 0 && i === delta)
      c.toggle.setAttribute('aria-expanded', String(open))
      c.args.textContent = summary(call.source ?? code, call)
      if (c.on) {
        c.on.setAttribute('aria-pressed', String(!call.off))
        c.on.title = call.off ? `Turn .${call.name}() back on` : `Turn .${call.name}() off: the output without it`
        c.on.setAttribute('aria-label', call.off ? `Turn ${call.name} on` : `Turn ${call.name} off`)
        c.delta.disabled = !!call.off || moves(call.name)
        c.delta.setAttribute('aria-pressed', String(i >= 0 && i === delta))
        c.delta.title = moves(call.name) ? `.${call.name}() moves time: nothing lines up to take away` : i === delta ? 'Back to the output' : `Hear and see what .${call.name}() takes out`
        c.delta.setAttribute('aria-label', `What ${call.name} takes out`)
      }
      if (open && !c.params && ops[call.name]) { c.params = params(c); c.li.append(c.params.dom); c.params.load() }
      if (!open && c.params) { c.params.dom.remove(); c.params = null }
      c.params?.refresh()
    }
    // the bar under the last step kept
    const place = position()
    if (list.children[place] !== rollback) list.insertBefore(rollback, cards[place]?.li ?? null)
    rollback.classList.toggle('back', bar != null)
    const lit = cards.find(c => c.params?.ready && c.call.list?.from === focus)
    lit ? lit.params.guide() : oncall(null)
  }
  // where the bar stands among the cards: after the last live step kept
  function position() {
    if (bar == null) return cards.length
    const steps = live()
    return bar ? cards.indexOf(steps[bar - 1]) + 1 : cards.findIndex(c => !c.call.outside)
  }

  function flip(c) {
    if (c.call.off) return
    const at = c.call.list.from
    if (c.li.classList.contains('open')) { pinned.delete(at); if (touched.has(at)) dismissed.add(at) }
    else { pinned.add(at); dismissed.delete(at); focus = at }
    render()
  }
  // A call out of the chain: from the end of the one before it (or of the source) to its own end, with the line break;
  // one turned off, its comment
  function drop(c) {
    if (c.call.off) return ed.change({ from: c.call.from, to: c.call.to, insert: '' })
    const k = chain(ed.code), i = k?.calls.findIndex(x => x.list.from === c.call.list.from) ?? -1
    if (i >= 0) ed.change({ from: k.calls[i - 1]?.to ?? k.root.to, to: k.calls[i].to, insert: '' })
  }
  function onOff(c) {
    const change = c.call.off ? turnOn(ed.code, c.call) : turnOff(ed.code, c.call)
    if (change) ed.change(change)
  }
  function hear(c) {
    const i = live().indexOf(c)
    if (i < 0) return
    view(delta === i ? null : i, null)
  }
  function view(d, b) {
    delta = d; bar = b
    render()
    onview({ delta, back: bar })
  }

  // The bar: dragged, it stands in the gap nearest the pointer; let go, the chain rolls back there. Keys move it a step.
  rollback.addEventListener('pointerdown', event => {
    rollback.setPointerCapture(event.pointerId)
    const move = e => {
      const steps = live(), gaps = steps.map(c => c.li.getBoundingClientRect()).map(r => r.top + r.height / 2)
      const kept = gaps.filter(y => y < e.clientY).length
      const next = kept >= steps.length ? null : kept
      if (next !== bar) { bar = next; delta = null; render() }
    }
    rollback.addEventListener('pointermove', move)
    rollback.addEventListener('pointerup', () => { rollback.removeEventListener('pointermove', move); view(null, bar) }, { once: true })
  })
  rollback.addEventListener('dblclick', () => view(null, null))
  rollback.addEventListener('keydown', event => {
    const n = live().length, now = bar ?? n
    const to = { ArrowUp: now - 1, ArrowDown: now + 1, Home: 0, End: n }[event.key]
    if (to == null) return
    event.preventDefault()
    view(null, Math.max(0, to) >= n ? null : Math.max(0, to))
  })

  // A card's sliders, one per parameter; a plugin's come from its manifest, read by the engine.
  function params(card) {
    const dom = document.createElement('div')
    dom.className = 'params'
    let spec = null, rows = [], dragging = null
    const self = {
      dom, ready: false,
      async load() {
        const name = card.call.name
        spec = ops[name].params || fromManifest(await describe(name))
        if (card.params !== self) return
        // a source, a band or what is learned from a selection is set in the code or on the picture, not by a slider
        rows = spec.map((s, i) => s.name === 'source' || s.name === 'band' || s.selection ? null : build(s, i)).filter(Boolean)
        if (!rows.length) { dom.textContent = 'No parameters'; dom.classList.add('none'); return }
        self.ready = true
        values()
        if (card.call.list.from === focus) self.guide()
      },
      refresh() { if (self.ready) values() },
      guide() { oncall(card.call, spec, current(card.call)) }
    }
    // A number's position on its slider, 0..1000: linear, or logarithmic for frequencies and ratios.
    const toSlider = (s, v) => s.log && s.min > 0 ? Math.log(v / s.min) / Math.log(s.max / s.min) * 1000 : (v - s.min) / (s.max - s.min) * 1000
    const fromSlider = (s, x) => s.log && s.min > 0 ? s.min * (s.max / s.min) ** (x / 1000) : s.min + x / 1000 * (s.max - s.min)
    // Times in the audio reach its end.
    const limits = s => (s.name === 'at' || s.name === 'duration') && s.unit === 's' ? { ...s, max: Math.max(duration(), .01) } : s
    function build(s, index) {
      const row = dom.appendChild(document.createElement('div'))
      row.className = 'param'
      const label = row.appendChild(document.createElement('label')), out = row.appendChild(document.createElement('output'))
      label.textContent = s.name
      row.title = s.values ? `${s.name}: ${s.values.join(', ')}` : `${s.name}: ${format(limits(s).min, s)} to ${format(limits(s).max, s)}; drag, or arrow keys on the slider`
      if (s.values) {
        const group = row.appendChild(document.createElement('div'))
        group.className = 'choices'
        group.role = 'group'
        group.setAttribute('aria-label', s.name)
        for (const value of s.values) {
          const button = group.appendChild(document.createElement('button'))
          button.type = 'button'
          button.textContent = String(value)
          button.onmousedown = event => event.preventDefault()
          button.onclick = () => write(s, index, value)
        }
        row.classList.add('choice')
        return { s, index, out, group }
      }
      const input = row.appendChild(document.createElement('input'))
      Object.assign(input, { type: 'range', min: 0, max: 1000, step: 'any' })
      input.setAttribute('aria-label', s.unit ? `${s.name} (${s.unit})` : s.name)
      input.addEventListener('pointerdown', () => { dragging = input })
      input.addEventListener('pointerup', () => { dragging = null })
      input.addEventListener('input', () => {
        const lim = limits(s), raw = fromSlider(lim, +input.value), step = s.step ?? (lim.log ? Math.max(.01, 10 ** Math.floor(Math.log10(Math.max(raw, 1e-9)) - 2)) : (lim.max - lim.min) / 1000)
        write(s, index, +number(Math.round(raw / step) * step, step), true)
      })
      input.addEventListener('change', () => ed.settle())
      return { s, index, out, input }
    }
    // The value each parameter has in the call now, by position or by name in an options object; undefined if unset.
    function current(call) {
      const positional = call.args.filter(a => a.kind !== 'object'), options = call.args.find(a => a.kind === 'object')
      return spec.map((s, i) => options?.props.find(p => p.name === s.name)?.value ?? positional[i]?.value)
    }
    function values() {
      const now = current(card.call)
      for (const row of rows) {
        const v = now[row.index], shown = v ?? row.s.default
        row.out.textContent = v === undefined ? (row.s.default === undefined ? 'auto' : format(row.s.default, row.s)) : format(v, row.s)
        row.out.classList.toggle('unset', v === undefined)
        if (row.input && dragging !== row.input && typeof shown === 'number') row.input.value = toSlider(limits(row.s), shown)
        if (row.group) for (const b of row.group.children) b.setAttribute('aria-pressed', String(b.textContent === String(shown)))
        row.out.hidden = !!row.group
      }
    }
    // Built-in methods take their parameters in order; ranges and plugins also take an options object, used when the
    // call already has one or has no arguments yet. A slider's moves are live and out of the history until it comes to
    // rest; a choice is one step. The card touched is the one whose settings show.
    function write(s, index, value, live = false) {
      const call = card.call, op = ops[call.name], positional = call.args.filter(a => a.kind !== 'object'), options = call.args.find(a => a.kind === 'object')
      const named = (!op.params || op.range) && (options || !positional.length)
      const change = named ? setArg(call, s.name, value) : setArg(call, index, value, spec.map(p => p.default))
      // what the picture shows at once: the settings it had and the ones it gets, by name, its range with them
      const was = { ...Object.fromEntries(options?.props.map(p => [p.name, p.value]) || []), ...Object.fromEntries(spec.map((p, i) => [p.name, current(call)[i]])) }
      onpreview(call.name, was, { ...was, [s.name]: value })
      focus = call.list.from
      live ? ed.slide(change) : ed.change(change, 'input.slider')
    }
    return self
  }

  return { refresh }
}

// What a step is set to, in a few words: its values with their units, a range by its times, a curve by its points, a
// sound by its name; what the words can't say, as written
function summary(code, call) {
  const spec = ops[call.name]?.params
  const words = call.args.filter(a => a.kind !== 'object').map((a, i) => said(code, a, spec?.[i]))
  for (const o of call.args.filter(a => a.kind === 'object')) {
    const props = o.props ?? [], get = name => props.find(p => p.name === name)?.value
    if (Array.isArray(get('t')) && Array.isArray(get('v'))) { words.push(`curve, ${get('t').length} points`); continue }
    for (const p of props) if (p.name !== 'at' && p.name !== 'duration') words.push(p.kind === 'object' || typeof p.value === 'number' || Array.isArray(p.value) ? `${p.name} ${said(code, p, spec?.find(s => s.name === p.name))}` : said(code, p))
    if (get('at') != null || get('duration') != null) words.push(times({ at: get('at') ?? 0, duration: get('duration') }))
  }
  return words.filter(Boolean).join(' · ')
}
const seconds = t => `${+t.toFixed(3)}`
const times = r => r.duration == null ? `from ${seconds(r.at)} s` : `${seconds(r.at)}–${seconds(r.at + r.duration)} s`
function said(code, a, s) {
  const v = a.value
  if (typeof v === 'number') return s ? format(v, s) : `${+v.toFixed(3)}`
  // numbers: a band in hertz, else the numbers; pairs (warp's markers): from → to; ranges: their times
  if (Array.isArray(v)) return v.every(x => typeof x === 'number') ? (s?.unit === 'Hz' || v.length === 2 && v[1] > 20 ? `${format(v[0], { unit: 'Hz' })} – ${format(v[1], { unit: 'Hz' })}` : v.map(x => +x.toFixed(3)).join(', '))
    : v.map(x => Array.isArray(x) ? x.map(seconds).join(' → ') : times(x)).join(', ')
  if (v && typeof v === 'object') return times(v)
  if (typeof v === 'string' || typeof v === 'boolean') return String(v)
  // an expression: a sound opened by name says the name
  const t = code.slice(a.valueFrom ?? a.from, a.valueTo ?? a.to).replace(/\s+/g, ' ').trim(), name = t.match(/^audio\(\s*(['"`])(.+?)\1\s*\)$/)?.[2]
  return name ? name.split('/').pop() : t.length > 24 ? t.slice(0, 23) + '…' : t
}
