import { ops, methods, format, fromManifest, reshapes } from './ops.js'
import { chain, setArg, number, offCalls, turnOff, turnOn, parseCall } from './code.js'

// The edits: the chain's steps as cards, in order, as Luminar's edits or a history panel; the same chain as the code,
// as controls, a rack of cards as mel's modules. The sound it starts from is the first card (the file opened, or
// audio.from() making one). A card names its step and what it is set to. A press on one chooses it: it opens to its settings, a
// slider (or a choice) each, and the output shows as it is up to that step, the steps after it dimmed; a press again,
// or Escape, shows the whole chain again. A slider rewrites its argument in place, a whole drag one undo step. The card
// under the pointer draws what it sets over the output (`oncall`). A card's Δ plays and draws what its step takes out
// (the output before it less the output after it); its eye turns the step off and on (the call commented out where it
// stands, so the code says it too); its × removes it. What the output shows, when it is not the whole chain, goes to
// `onview({ delta, back })`: `delta` the index of the live step whose difference plays, `back` how many live steps
// are kept.
export default function stack(root, { ed, describe = async () => null, duration = () => 1, source = () => null, oncall = () => {}, onview = () => {}, onsteps = () => {}, onpreview = () => {} }) {
  const list = root.appendChild(document.createElement('ol'))
  list.className = 'steps-list'
  // the card chosen, known by where its call's "(" is, carried through every edit ('source' for the sound it starts
  // from); what the output shows: the difference a live step makes, or the chain kept to its first `back` live steps;
  // the card under the pointer
  let chosen = null, cards = [], shape = '', delta = null, back = null, hovered = null

  // Every change to the code, and once at the start; a move of its caret alone changes nothing here
  function refresh(update) {
    if (update && !update.docChanged) return
    if (update && typeof chosen === 'number') chosen = update.changes.mapPos(chosen)
    const code = ed.code, c = chain(code), calls = c?.calls || []
    // audio.from(…) makes the sound: its call is where the chain starts, not a step on it
    const made = c?.root.name === 'VariableName' && code.slice(c.root.from, c.root.to) === 'audio' && !!calls[0]
    const steps = [...calls.map((k, i) => i || !made ? k : { ...k, origin: true }), ...offCalls(code).map(o => ({ ...parseCall(o.text), ...o, dot: o.from, list: null, off: true }))].sort((p, q) => p.dot - q.dot)
    const name = !made && source(), rows = name ? [{ name, sound: true }, ...steps] : steps
    // cards are built again only when the steps change, never by a slider's own edits; then the whole chain shows
    const next = rows.map(k => (k.off ? '~' : '') + k.name).join()
    if (next !== shape) { build(rows); if (shape) { chosen = null; view(null, null) } }
    shape = next
    rows.forEach((call, i) => { cards[i].call = call })
    onsteps(steps.filter(k => !k.origin).length)
    render()
  }

  const EYE = 'M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Zm10 3a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z'
  const SHUT = 'M3 3l18 18M10.6 5.1Q11.3 5 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3.2 4M6.6 6.6A17 17 0 0 0 2 12s3.6 7 10 7a10 10 0 0 0 5.4-1.6M9.9 9.9a3 3 0 0 0 4.2 4.2'
  function build(rows) {
    hovered = null
    cards = rows.map(call => {
      const li = document.createElement('li'), head = li.appendChild(document.createElement('div'))
      li.className = 'step'
      head.className = 'step-head'
      head.innerHTML = '<button class="step-toggle" type="button"><span class="step-name"></span><span class="step-args"></span></button>'
      const toggle = head.firstChild, card = { li, toggle, args: toggle.lastChild, call, params: null }
      toggle.querySelector('.step-name').textContent = call.sound ? call.name : call.name[0].toUpperCase() + call.name.slice(1)
      // a press leaves the keys where they were: Space still plays, the code keeps its caret
      toggle.addEventListener('mousedown', event => event.preventDefault())
      toggle.addEventListener('click', () => pick(card))
      li.addEventListener('pointerenter', () => { hovered = card; guide() })
      li.addEventListener('pointerleave', () => { if (hovered === card) { hovered = null; guide() } })
      // the sound the chain starts from has nothing to take away, turn off or remove
      if (!call.sound && !call.origin) {
        card.delta = button(head, 'step-delta', 'Δ', null, () => hear(card))
        card.on = button(head, 'step-on', null, EYE, () => onOff(card))
        button(head, 'step-remove', null, 'm7 7 10 10M17 7 7 17', () => drop(card), `Remove .${call.name}() from the chain`, `Remove ${call.name}`)
      }
      return card
    })
    list.replaceChildren(...cards.map(c => c.li))
  }
  function button(head, name, text, path, act, title = '', label = title) {
    const b = head.appendChild(document.createElement('button'))
    b.className = `${name} icon-button`
    b.type = 'button'
    if (text) b.textContent = text
    else b.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${path}"/></svg>`
    if (title) b.title = title
    if (label) b.setAttribute('aria-label', label)
    b.addEventListener('mousedown', event => event.preventDefault())
    b.addEventListener('click', act)
    return b
  }

  // Live steps, in order: those the output runs
  const live = () => cards.filter(c => !c.call.off && !c.call.sound)
  // the card chosen, as an index among the cards, or -1
  const position = () => chosen === 'source' ? cards.findIndex(c => c.call.sound) : chosen == null ? -1 : cards.findIndex(c => c.call.list?.from === chosen)
  // the live steps the chosen card keeps: none past the sound it starts from; all of them (null) at the last, or none chosen
  function kept() {
    const c = cards[position()], steps = live()
    const n = !c ? null : c.call.sound ? 0 : steps.indexOf(c) + 1
    return n == null || n >= steps.length ? null : n
  }

  function render() {
    const code = ed.code, steps = live(), at = position()
    for (const [n, c] of cards.entries()) {
      const call = c.call, open = n === at && !call.off && !call.sound, i = steps.indexOf(c)
      c.li.classList.toggle('open', open)
      c.li.classList.toggle('chosen', n === at)
      c.li.classList.toggle('off', !!call.off)
      c.li.classList.toggle('rolled', at >= 0 && n > at && delta == null)
      c.li.classList.toggle('delta', i >= 0 && i === delta)
      c.toggle.setAttribute('aria-pressed', String(n === at))
      c.toggle.title = call.off ? `.${call.name}() is off: its eye turns it back on`
        : n === at ? 'Back to the whole chain (Esc)'
        : call.sound ? `${call.name}: the sound alone, before any step`
        : `${ops[call.name]?.text || '.' + call.name + '()'}: the output up to here, and its settings`
      c.args.textContent = call.sound ? '' : summary(call.source ?? code, call)
      if (c.on) {
        c.on.setAttribute('aria-pressed', String(!call.off))
        c.on.querySelector('path').setAttribute('d', call.off ? SHUT : EYE)
        c.on.title = call.off ? `Turn .${call.name}() back on` : `Turn .${call.name}() off: the output without it`
        c.on.setAttribute('aria-label', call.off ? `Turn ${call.name} on` : `Turn ${call.name} off`)
        c.delta.disabled = !!call.off || reshapes(call.name)
        c.delta.setAttribute('aria-pressed', String(i >= 0 && i === delta))
        c.delta.title = reshapes(call.name) ? `.${call.name}() changes the sound's time, rate or channels: nothing lines up to take away` : i === delta ? 'Back to the output' : `Hear and see what .${call.name}() takes out`
        c.delta.setAttribute('aria-label', `What ${call.name} takes out`)
      }
      if (open && !c.params && ops[call.name]) { c.params = params(c); c.li.append(c.params.dom); c.params.load() }
      if (!open && c.params) { c.params.dom.remove(); c.params = null }
      c.params?.refresh()
    }
    guide()
  }

  // What the card under the pointer sets, drawn over the output; none when no card is
  async function guide() {
    const c = hovered, name = c?.call.name
    if (!c || c.call.off || c.call.sound || !ops[name]) return oncall(null)
    const spec = c.params?.spec ?? ops[name].params ?? fromManifest(await describe(name))
    if (hovered === c) oncall(c.call, spec, valuesOf(spec, c.call))
  }

  // A press on a card chooses it; on the one chosen, the whole chain comes back
  function pick(c) {
    if (c.call.off) return
    const id = c.call.sound ? 'source' : c.call.list.from
    choose(chosen === id ? null : id)
  }
  // Chooses a step, by where its "(" is ('source' for the sound it starts from, null for none): the output shows the
  // chain up to it
  function choose(id) {
    chosen = id
    view(null, kept())
  }
  // A call out of the chain: from the end of the one before it (or of the source) to its own end, with the line break;
  // one turned off, its comment
  function drop(c) {
    if (c.call.off) return ed.change({ from: c.call.from, to: c.call.to, insert: '' })
    const k = chain(ed.code), i = k?.calls.findIndex(x => x.list.from === c.call.list.from) ?? -1
    if (i >= 0) ed.change({ from: k.calls[i - 1]?.to ?? k.root.to, to: k.calls[i].to, insert: '' })
  }
  // Every step gone, those turned off too, the sound it starts from and a closing save() or play() kept: one undo step
  function discard() {
    const code = ed.code, c = chain(code)
    if (!c) return
    const made = cards[0]?.call.origin, from = made ? c.calls[0].to : c.root.to
    const to = Math.max(c.expr.to, ...offCalls(code).map(o => o.to)), sinks = c.calls.filter(k => methods[k.name]?.sink).map(k => code.slice(k.dot, k.to)).join('')
    if (code.slice(from, to) !== sinks) ed.change({ from, to, insert: sinks })
  }
  function onOff(c) {
    const change = c.call.off ? turnOn(ed.code, c.call) : turnOff(ed.code, c.call)
    if (change) ed.change(change)
  }
  function hear(c) {
    const i = live().indexOf(c)
    if (i >= 0) delta === i ? view(null, kept()) : view(i, null)
  }
  function view(d, b) {
    const changed = d !== delta || b !== back
    delta = d; back = b
    render()
    if (changed) onview({ delta, back })
  }

  // Keys on the cards: up and down go between them, Escape shows the whole chain again
  list.addEventListener('keydown', event => {
    const i = cards.findIndex(c => c.toggle === document.activeElement)
    if (event.key === 'Escape' && (chosen != null || delta != null)) { event.preventDefault(); chosen = null; view(null, null) }
    else if (i >= 0 && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) { event.preventDefault(); cards[Math.max(0, Math.min(cards.length - 1, i + (event.key === 'ArrowDown' ? 1 : -1)))].toggle.focus() }
  })

  // A card's sliders, one per parameter; a plugin's come from its manifest, read by the engine.
  function params(card) {
    const dom = document.createElement('div')
    dom.className = 'params'
    let rows = [], dragging = null
    const self = {
      dom, ready: false, spec: null,
      async load() {
        const name = card.call.name, spec = ops[name].params || fromManifest(await describe(name))
        if (card.params !== self) return
        self.spec = spec
        // a source, a band or what is learned from a selection is set in the code or on the picture, not by a slider
        rows = spec.map((s, i) => s.name === 'source' || s.name === 'band' || s.selection ? null : build(s, i)).filter(Boolean)
        if (!rows.length) { dom.textContent = 'No settings'; dom.classList.add('none'); return }
        self.ready = true
        values()
      },
      refresh() { if (self.ready) values() }
    }
    // A number's position on its slider, 0..1000: linear, or logarithmic for frequencies and ratios.
    const toSlider = (s, v) => s.log && s.min > 0 ? Math.log(v / s.min) / Math.log(s.max / s.min) * 1000 : (v - s.min) / (s.max - s.min) * 1000
    const fromSlider = (s, x) => s.log && s.min > 0 ? s.min * (s.max / s.min) ** (x / 1000) : s.min + x / 1000 * (s.max - s.min)
    // Times in the audio reach its end.
    const limits = s => (s.name === 'at' || s.name === 'duration') && s.unit === 's' ? { ...s, max: Math.max(duration(), .01) } : s
    // a row: its name and value above, its slider (or choices) across below
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
    function values() {
      const now = valuesOf(self.spec, card.call)
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
    // rest; a choice is one step.
    function write(s, index, value, live = false) {
      const call = card.call, op = ops[call.name], spec = self.spec, positional = call.args.filter(a => a.kind !== 'object'), options = call.args.find(a => a.kind === 'object')
      const named = (!op.params || op.range) && (options || !positional.length)
      const change = named ? setArg(call, s.name, value) : setArg(call, index, value, spec.map(p => p.default))
      // what the picture shows at once: the settings it had and the ones it gets, by name, its range with them
      const was = { ...Object.fromEntries(options?.props.map(p => [p.name, p.value]) || []), ...Object.fromEntries(spec.map((p, i) => [p.name, valuesOf(spec, call)[i]])) }
      onpreview(call.name, was, { ...was, [s.name]: value })
      live ? ed.slide(change) : ed.change(change, 'input.slider')
    }
    return self
  }

  return { refresh, choose, discard }
}

// The value each parameter has in a call now, by position or by name in an options object; undefined if unset.
function valuesOf(spec, call) {
  const positional = call.args.filter(a => a.kind !== 'object'), options = call.args.find(a => a.kind === 'object')
  return spec.map((s, i) => options?.props.find(p => p.name === s.name)?.value ?? positional[i]?.value)
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
const times = r => r.duration == null ? `from ${seconds(r.at)}s` : `${seconds(r.at)}–${seconds(r.at + r.duration)}s`
function said(code, a, s) {
  const v = a.value
  if (typeof v === 'number') return s ? format(v, s) : `${+v.toFixed(3)}`
  // numbers: a band in hertz, else the numbers; pairs (warp's markers): from → to; ranges: their times
  if (Array.isArray(v)) return v.every(x => typeof x === 'number') ? (s?.unit === 'Hz' || v.length === 2 && v[1] > 20 ? `${format(v[0], { unit: 'Hz' })}–${format(v[1], { unit: 'Hz' })}` : v.map(x => +x.toFixed(3)).join(', '))
    : v.map(x => Array.isArray(x) ? x.map(seconds).join(' → ') : times(x)).join(', ')
  if (v && typeof v === 'object') return times(v)
  if (typeof v === 'string' || typeof v === 'boolean') return String(v)
  // an expression: a sound opened by name says the name
  const t = code.slice(a.valueFrom ?? a.from, a.valueTo ?? a.to).replace(/\s+/g, ' ').trim(), name = t.match(/^audio\(\s*(['"`])(.+?)\1\s*\)$/)?.[2]
  return name ? name.split('/').pop() : t.length > 24 ? t.slice(0, 23) + '…' : t
}
