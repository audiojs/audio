import { ops, format, fromManifest, reshapes, toSlider, fromSlider } from './ops.js'
import { valuesOf, setArg } from './code.js'

// A step's settings: a slider (or a choice) each, one per parameter, as an edit's card opens to them (stack.js) and an
// embedded chain's edit pressed (repl/editor/menus.js openStep). A plugin's come from its manifest, read by the engine.
// The ones that matter come first and the engine's own are folded under Advanced (help.js layouts), open where the code
// sets one of them. A slider rewrites its argument in place, its moves live and out of the history until it comes to
// rest, a whole drag one undo step; a choice is one step.

// What each setting does and which come first (help.js), the largest text the page has: loaded with the first
// settings, not with the page
let help, layout, line
const words = () => import('./help.js').then(m => ({ help, layout, line } = m))

// `card`: { call, params }, its call kept as the code changes (`call` the chain's own, code.js chain), these settings its
// `params` while they are its. `hear`, where the step's difference can be heard: a Δ button for it (`takes`); `onsettle`,
// a slider come to rest; `onpoint`, a setting pointed at or focused (its name, the call's values by name), or none
export default function settings(card, { ed, describe = async () => null, duration = () => 1, onpreview = () => {}, onsettle = () => {}, onpoint = () => {}, hear = null }) {
  const dom = document.createElement('div')
  dom.className = 'params'
  // what the step takes out, heard and drawn; a step that moves time, rate or channels has nothing that lines up to
  // take away
  const takes = !hear || reshapes(card.call.name) ? null : dom.appendChild(Object.assign(document.createElement('button'), { type: 'button', className: 'step-delta', textContent: 'Δ What it takes out', title: 'Before minus after' }))
  takes?.addEventListener('mousedown', event => event.preventDefault())
  takes?.addEventListener('click', () => hear(card))
  let rows = [], dragging = null
  const self = {
    dom, ready: false, spec: null,
    async load() {
      const name = card.call.name, [spec] = await Promise.all([ops[name]?.params || describe(name).then(fromManifest), help || words()])
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
      if (takes) takes.disabled = !!card.call.off
      if (self.ready) values()
    }
  }
  // (a number's place on its slider, and the value at a place, rounded to its step: ops.js toSlider, fromSlider)
  // Times in the audio reach its end.
  const limits = s => ['at', 'duration', 'to'].includes(s.name) && s.unit === 's' ? { ...s, max: Math.max(duration(), .01) } : s
  // What pointing at a setting says: what it does and which way to move it (help.js), and for a number its range and
  // where it starts; the choices are on show.
  function tip(s, text) {
    const lim = limits(s), facts = s.values ? s.values.join(', ') : `${format(lim.min, s)} to ${format(lim.max, s)}${s.default == null ? '' : `, default ${format(s.default, s)}`}`
    return !text ? `${s.name}: ${facts}` : s.values ? text : `${text}\n${facts}`
  }
  // a row: its name and value above, its slider (or choices) across below; pointed at or focused, said (onpoint)
  function build(s, index) {
    const row = dom.appendChild(document.createElement('div')), text = help(card.call.name, s.name)
    row.className = 'param'
    let over = false, keyed = false
    const tell = () => over || keyed ? onpoint(s.name, now()) : onpoint(null)
    row.addEventListener('pointerenter', () => { over = true; tell() })
    row.addEventListener('pointerleave', () => { over = false; tell() })
    row.addEventListener('focusin', () => { keyed = true; tell() })
    row.addEventListener('focusout', e => { if (!row.contains(e.relatedTarget)) { keyed = false; tell() } })
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
      said(row, s)
      return { s, index, row, out, group }
    }
    const input = row.appendChild(document.createElement('input'))
    Object.assign(input, { type: 'range', min: 0, max: 1000, step: 'any' })
    input.setAttribute('aria-label', s.unit ? `${s.name} (${s.unit})` : s.name)
    if (text) input.setAttribute('aria-description', text)
    input.addEventListener('pointerdown', () => { dragging = input })
    input.addEventListener('pointerup', () => { dragging = null })
    input.addEventListener('input', () => write(s, index, fromSlider(limits(s), +input.value), true))
    input.addEventListener('change', () => { ed.settle(); onsettle() })
    said(row, s)
    return { s, index, row, out, input }
  }
  // its line under it, what it is in a few words, where its op's docs give one (help.js line)
  function said(row, s) {
    const text = line?.(card.call.name, s.name)
    if (text) row.appendChild(Object.assign(document.createElement('p'), { className: 'param-line', textContent: text }))
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
  // call already has one or has no arguments yet, and always for a setting the library reads by its name alone
  // (`option`). A slider's moves are live and out of the history until it comes to rest; a choice is one step.
  // the call's values by name: its options', then its settings' as they are set
  function now() {
    const call = card.call, spec = self.spec ?? [], options = call.args.find(a => a.kind === 'object'), set = valuesOf(spec, call)
    return { ...Object.fromEntries(options?.props.map(p => [p.name, p.value]) || []), ...Object.fromEntries(spec.map((p, i) => [p.name, set[i]])) }
  }
  function write(s, index, value, live = false) {
    const call = card.call, op = ops[call.name], spec = self.spec, positional = call.args.filter(a => a.kind !== 'object'), options = call.args.find(a => a.kind === 'object')
    const named = s.option || (!op.params || op.range) && (options || !positional.length)
    const change = named ? setArg(call, s.name, value) : setArg(call, index, value, spec.map(p => p.default))
    // what the picture shows at once: the settings it had and the ones it gets, by name, its range with them
    const was = now()
    // bypassed, the output stays as it is
    if (!call.off) onpreview(call.name, was, { ...was, [s.name]: value })
    live ? ed.slide(change) : ed.change(change, 'input.slider')
  }
  return self
}
