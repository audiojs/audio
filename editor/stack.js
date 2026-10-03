import { ops, methods, format, fromManifest, reshapes, icons } from './ops.js'
import opIcons from './icons.js'
import { chain, setArg, number, offCalls, turnOff, turnOn, parseCall, groups } from './code.js'
import { help, layout } from './help.js'

// The edits: the chain's steps as cards, in order, as Luminar's edits or a history panel; the same chain as the code,
// as controls, a rack of cards as mel's modules. The sound it starts from is the first card (the file opened, or
// audio.from() making one). A card names its step and what it is set to. A press on one chooses it: it opens to its settings, a
// slider (or a choice) each, and the output shows as it is up to that step, the steps after it dimmed; a press again,
// or Escape, shows the whole chain again. A slider rewrites its argument in place, a whole drag one undo step. Pointed
// at, each says what it does and which way to move it (help.js); the engine's own, which few touch, wait under Advanced.
// The card under the pointer draws what it sets over the output (`oncall`). Two acts on it, over its right end where the pointer
// is, its settings running under them to the card's edge: its eye turns the step off and on (the call commented out
// where it stands, so the code says it too); its × removes it. Going back to a card is choosing it: an edit made then
// goes after it, the steps after it gone. Open, a card's Δ plays and draws what its step takes out (the output before
// it less the output after it). Steps grouped in the code (code.js groups: a recipe's, under its name) are one card,
// folded: a press unfolds it to its steps, its eye turns them all off and on, its × removes them all. What the output
// shows, when it is not the whole chain, goes to `onview({ delta, back })`: `delta` the index of the live step whose
// difference plays, `back` how many live steps are kept.
export default function stack(root, { ed, describe = async () => null, duration = () => 1, source = () => null, oncall = () => {}, onview = () => {}, onpreview = () => {} }) {
  // the cards first, what adds to them after
  const list = root.insertBefore(document.createElement('ol'), root.firstChild)
  list.className = 'steps-list'
  // the card chosen, known by where its call's "(" is, carried through every edit ('source' for the sound it starts
  // from); what the output shows: the difference a live step makes, or the chain kept to its first `back` live steps;
  // the card under the pointer
  let chosen = null, cards = [], shape = '', delta = null, back = null, hovered = null
  // the groups, a card each over its steps' cards; those unfolded, by name and place among those of that name
  let folds = [], unfolded = new Set()

  // Every change to the code, and once at the start; a move of its caret alone changes nothing here
  function refresh(update) {
    if (update && !update.docChanged) return
    if (update && typeof chosen === 'number') chosen = update.changes.mapPos(chosen)
    const code = ed.code, c = chain(code), calls = c?.calls || []
    // audio.from(…) makes the sound: its call is where the chain starts, not a step on it
    const made = c?.root.name === 'VariableName' && code.slice(c.root.from, c.root.to) === 'audio' && !!calls[0]
    const steps = [...calls.map((k, i) => i || !made ? k : { ...k, origin: true }), ...offCalls(code).map(o => ({ ...parseCall(o.text), ...o, dot: o.from, list: null, off: true }))].sort((p, q) => p.dot - q.dot)
    const name = !made && source(), rows = name ? [{ name, sound: true }, ...steps] : steps
    const gs = groups(code), groupOf = k => k.sound ? -1 : gs.findIndex(g => k.dot > g.from && k.dot < g.to)
    // cards are built again only when the steps change, never by a slider's own edits; then the whole chain shows
    const next = rows.map(k => (k.off ? '~' : '') + k.name + '/' + groupOf(k)).join() + gs.map(g => g.name).join()
    if (next !== shape) { build(rows, gs, groupOf); if (shape) { chosen = null; view(null, null) } }
    shape = next
    rows.forEach((call, i) => { cards[i].call = call })
    gs.forEach((g, i) => { if (folds[i]) folds[i].group = g })
    render()
  }

  const EYE = 'M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Zm10 3a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z'
  // a group's icon: steps stacked in a folder
  const FOLD = 'M3 6.5A1.5 1.5 0 0 1 4.5 5H9l2 2h8.5A1.5 1.5 0 0 1 21 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5v-11ZM8 11h8M8 14.5h5'
  // a card's icon: the sound's, a file's bars or a generator's wave; a step's own (icons.js), else its kind's
  const iconOf = call => call.sound ? 'M4 10v4m4-8v12m4-15v18m4-14v10m4-6v2' : call.origin ? icons.Generate : opIcons[call.name] ?? icons[ops[call.name]?.group] ?? icons.Effect
  const SHUT = 'M3 3l18 18M10.6 5.1Q11.3 5 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3.2 4M6.6 6.6A17 17 0 0 0 2 12s3.6 7 10 7a10 10 0 0 0 5.4-1.6M9.9 9.9a3 3 0 0 0 4.2 4.2'
  function build(rows, gs = [], groupOf = () => -1) {
    hovered = null
    cards = rows.map(call => {
      const li = document.createElement('li'), head = li.appendChild(document.createElement('div'))
      li.className = 'step'
      head.className = 'step-head'
      head.innerHTML = '<button class="step-toggle" type="button"><svg class="step-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path/></svg><span class="step-name"></span><span class="step-args"></span></button>'
      const toggle = head.firstChild, card = { li, toggle, args: toggle.lastChild, call, params: null }
      toggle.querySelector('path').setAttribute('d', iconOf(call))
      toggle.querySelector('.step-name').textContent = call.sound ? call.name : call.name[0].toUpperCase() + call.name.slice(1)
      // a press leaves the keys where they were: Space still plays, the code keeps its caret
      toggle.addEventListener('mousedown', event => event.preventDefault())
      toggle.addEventListener('click', () => pick(card))
      li.addEventListener('pointerenter', () => { hovered = card; guide() })
      li.addEventListener('pointerleave', () => { if (hovered === card) { hovered = null; guide() } })
      // the sound the chain starts from has nothing to take away, turn off or remove
      if (!call.sound && !call.origin) {
        const acts = head.appendChild(document.createElement('div'))
        acts.className = 'step-acts'
        card.on = button(acts, 'step-on', null, EYE, () => onOff(card))
        button(acts, 'step-remove', null, 'm7 7 10 10M17 7 7 17', () => drop(card), `Remove .${call.name}() from the chain`, `Remove ${call.name}`)
      }
      card.fold = groupOf(call)
      return card
    })
    // a group's card, before its steps' cards, named by its comment, folded
    const seen = {}
    folds = gs.map(group => {
      const key = `${group.name}#${seen[group.name] = (seen[group.name] ?? -1) + 1}`
      const li = document.createElement('li'), head = li.appendChild(document.createElement('div'))
      li.className = 'step step-group'
      head.className = 'step-head'
      head.innerHTML = `<button class="step-toggle" type="button" aria-expanded="false"><svg class="step-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${FOLD}"/></svg><span class="step-name"></span><span class="step-args"></span></button>`
      const toggle = head.firstChild, fold = { li, toggle, key, group }
      toggle.querySelector('.step-name').textContent = group.name
      toggle.addEventListener('mousedown', event => event.preventDefault())
      toggle.addEventListener('click', () => { unfolded.has(key) ? unfolded.delete(key) : unfolded.add(key); render() })
      const acts = head.appendChild(document.createElement('div'))
      acts.className = 'step-acts'
      fold.on = button(acts, 'step-on', null, EYE, () => switchAll(fold))
      button(acts, 'step-remove', null, 'm7 7 10 10M17 7 7 17', () => dropAll(fold), `Remove ${group.name}: all its steps`, `Remove ${group.name}`)
      return fold
    })
    const items = []
    cards.forEach((c, i) => { if (c.fold >= 0 && cards[i - 1]?.fold !== c.fold) items.push(folds[c.fold].li); items.push(c.li) })
    list.replaceChildren(...items)
  }
  // a group's steps' cards
  const members = fold => cards.filter(c => c.fold === folds.indexOf(fold))
  // a group's steps all turned off, or all back on when they all are, in one step
  function switchAll(fold) {
    const steps = members(fold), on = steps.every(c => c.call.off), code = ed.code
    const changes = steps.filter(c => !!c.call.off === on).map(c => on ? turnOn(code, c.call) : turnOff(code, c.call))
    if (changes.length && changes.every(Boolean)) ed.change(changes)
  }
  // a group taken out, its name and its steps, with the line it was on
  function dropAll(fold) {
    const { from, to } = fold.group
    ed.change({ from: Math.max(0, from - 1), to, insert: '' })
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
      }
      if (open && !c.params) { c.params = params(c); c.li.append(c.params.dom); c.params.load() }
      if (!open && c.params) { c.params.dom.remove(); c.params = null }
      c.params?.refresh(i >= 0 && i === delta)
    }
    // a group folded hides its steps, unless the step chosen is one of them; its eye is off when all of them are
    for (const fold of folds) {
      const steps = members(fold), open = unfolded.has(fold.key) || steps.some(c => cards.indexOf(c) === at), off = steps.every(c => c.call.off)
      fold.toggle.setAttribute('aria-expanded', String(open))
      fold.toggle.title = open ? `Fold ${fold.group.name}` : `${fold.group.name}: its ${steps.length} steps, one step of the edits`
      fold.toggle.querySelector('.step-args').textContent = `${steps.length} steps`
      fold.li.classList.toggle('off', off)
      fold.li.classList.toggle('rolled', steps.every(c => c.li.classList.contains('rolled')))
      fold.on.setAttribute('aria-pressed', String(!off))
      fold.on.querySelector('path').setAttribute('d', off ? SHUT : EYE)
      fold.on.title = off ? `Turn ${fold.group.name} back on` : `Turn ${fold.group.name} off: the output without its steps`
      fold.on.setAttribute('aria-label', off ? `Turn ${fold.group.name} on` : `Turn ${fold.group.name} off`)
      for (const c of steps) { c.li.hidden = !open; c.li.classList.add('grouped') }
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
  // The change that takes the steps after a card away, those turned off too, a closing save() or play() kept (from the
  // sound the chain starts from, every step), or null when there are none
  function past(card) {
    const code = ed.code, c = chain(code)
    if (!c) return null
    const from = card.call.sound ? c.root.to : card.call.origin ? c.calls[0].to : card.call.to
    const to = Math.max(c.expr.to, ...offCalls(code).map(o => o.to)), sinks = c.calls.filter(k => k.to > from && methods[k.name]?.sink).map(k => code.slice(k.dot, k.to)).join('')
    return to > from && code.slice(from, to) !== sinks ? { from, to, insert: sinks } : null
  }
  // While the output shows the chain rolled back to the card chosen, the steps after it, as a change that takes them
  // away (else null): a new edit then goes after that card, the steps after it dropped, as a browser drops the pages
  // ahead of one gone back to once another opens
  const ahead = () => back != null && cards[position()] ? past(cards[position()]) : null
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
    // the cards shown: a group's own, and its steps' when it is unfolded
    const shown = [...list.children].filter(li => !li.hidden).map(li => li.querySelector('.step-toggle')), i = shown.indexOf(document.activeElement)
    if (event.key === 'Escape' && (chosen != null || delta != null)) { event.preventDefault(); chosen = null; view(null, null) }
    else if (i >= 0 && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) { event.preventDefault(); shown[Math.max(0, Math.min(shown.length - 1, i + (event.key === 'ArrowDown' ? 1 : -1)))].focus() }
  })

  // A card's sliders, one per parameter; a plugin's come from its manifest, read by the engine. The ones that matter come
  // first and the engine's own are folded under Advanced (help.js layouts), open where the code sets one of them.
  function params(card) {
    const dom = document.createElement('div')
    dom.className = 'params'
    // what the step takes out, heard and drawn; a step that moves time, rate or channels has nothing that lines up to
    // take away
    const takes = reshapes(card.call.name) ? null : dom.appendChild(Object.assign(document.createElement('button'), { type: 'button', className: 'step-delta', textContent: 'Δ What it takes out', title: `Hear and see what .${card.call.name}() takes out: the output before it less the output after it` }))
    takes?.addEventListener('mousedown', event => event.preventDefault())
    takes?.addEventListener('click', () => hear(card))
    let rows = [], dragging = null
    const self = {
      dom, ready: false, spec: null,
      async load() {
        const name = card.call.name, spec = ops[name]?.params || fromManifest(await describe(name))
        if (card.params !== self) return
        self.spec = spec
        // a source, a band or what is learned from a selection is set in the code or on the picture, not by a slider
        rows = spec.map((s, i) => s.name === 'source' || s.name === 'band' || s.selection ? null : build(s, i)).filter(Boolean)
        if (!rows.length) { dom.append('No settings'); dom.classList.add('none'); return }
        arrange(name)
        self.ready = true
        values()
      },
      refresh(heard) {
        takes?.setAttribute('aria-pressed', String(heard))
        if (self.ready) values()
      }
    }
    // A number's position on its slider, 0..1000: linear, or logarithmic for frequencies and ratios.
    const toSlider = (s, v) => s.log && s.min > 0 ? Math.log(v / s.min) / Math.log(s.max / s.min) * 1000 : (v - s.min) / (s.max - s.min) * 1000
    const fromSlider = (s, x) => s.log && s.min > 0 ? s.min * (s.max / s.min) ** (x / 1000) : s.min + x / 1000 * (s.max - s.min)
    // Times in the audio reach its end.
    const limits = s => ['at', 'duration', 'to'].includes(s.name) && s.unit === 's' ? { ...s, max: Math.max(duration(), .01) } : s
    // What pointing at a setting says: what it does and which way to move it (help.js), and for a number its range and
    // where it starts; the choices are on show.
    function tip(s, text) {
      const lim = limits(s), facts = s.values ? s.values.join(', ') : `${format(lim.min, s)} to ${format(lim.max, s)}${s.default == null ? '' : `, default ${format(s.default, s)}`}`
      return !text ? `${s.name}: ${facts}` : s.values ? text : `${text}\n${facts}`
    }
    // a row: its name and value above, its slider (or choices) across below
    function build(s, index) {
      const row = dom.appendChild(document.createElement('div')), text = help(card.call.name, s.name)
      row.className = 'param'
      const label = row.appendChild(document.createElement('label')), out = row.appendChild(document.createElement('output'))
      label.textContent = s.name
      row.title = tip(s, text)
      if (s.values) {
        const group = row.appendChild(document.createElement('div'))
        group.className = 'choices'
        group.role = 'group'
        group.setAttribute('aria-label', s.name)
        if (text) group.setAttribute('aria-description', text)
        for (const value of s.values) {
          const button = group.appendChild(document.createElement('button'))
          button.type = 'button'
          button.textContent = String(value)
          button.onmousedown = event => event.preventDefault()
          button.onclick = () => write(s, index, value)
        }
        row.classList.add('choice')
        return { s, index, row, out, group }
      }
      const input = row.appendChild(document.createElement('input'))
      Object.assign(input, { type: 'range', min: 0, max: 1000, step: 'any' })
      input.setAttribute('aria-label', s.unit ? `${s.name} (${s.unit})` : s.name)
      if (text) input.setAttribute('aria-description', text)
      input.addEventListener('pointerdown', () => { dragging = input })
      input.addEventListener('pointerup', () => { dragging = null })
      input.addEventListener('input', () => {
        const lim = limits(s), raw = fromSlider(lim, +input.value), step = s.step ?? (lim.log ? Math.max(.01, 10 ** Math.floor(Math.log10(Math.max(raw, 1e-9)) - 2)) : (lim.max - lim.min) / 1000)
        write(s, index, +number(Math.round(raw / step) * step, step), true)
      })
      input.addEventListener('change', () => ed.settle())
      return { s, index, row, out, input }
    }
    // The rows in the order the layout gives them, those few touch after a button that folds them away
    function arrange(name) {
      const [front, folded] = layout(name, rows.map(r => r.s.name)), by = n => rows.find(r => r.s.name === n)
      dom.append(...front.map(by).map(r => r.row))
      if (!folded.length) return
      const back = folded.map(by), set = valuesOf(self.spec, card.call), more = dom.appendChild(document.createElement('button'))
      more.type = 'button'
      more.className = 'step-more'
      more.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg>Advanced <span></span>'
      more.lastChild.textContent = back.length
      more.title = `Settings few need to touch: ${folded.join(', ')}`
      const fold = open => { more.setAttribute('aria-expanded', String(open)); for (const r of back) r.row.hidden = !open }
      more.addEventListener('mousedown', event => event.preventDefault())
      more.addEventListener('click', () => fold(more.getAttribute('aria-expanded') !== 'true'))
      dom.append(...back.map(r => r.row))
      fold(back.some(r => set[r.index] !== undefined))
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

  return { refresh, choose, ahead }
}

// The value each parameter has in a call now, by position or by name in an options object; undefined if unset.
export function valuesOf(spec, call) {
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
