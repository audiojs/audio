import { ops, methods, stats, presets, GROUPS, format, fromManifest } from './ops.js'

// The script editor: JavaScript with the audio methods completed after a dot, sources and stat names completed
// inside strings. `oncaret(update)` hears every move of the selection and every change, for the stack beside it. A
// number says what it sets in the page's hints (`hint`, hint.js), pointed at, selected, dragged or stepped.
// `wrap`: long lines wrap to the panel's width, as an embedded editor's do, never hidden past its edge.
// CodeMirror, the largest module the page has, which a phone waited on before anything showed, comes once the page
// shows (`onready` then): till then each document is held here as it opened and the edits made to it since, in order,
// which CodeMirror replays into its history as though they were made there, so nothing waits for it and nothing made
// before it is lost to undo
export default function editor(parent, options) {
  const { doc = '', onchange, oncaret, onready } = options
  // a document: its text as it opened, the edits since ({ changes, userEvent, history, scroll }), its text now, its
  // selection, its errors; the one shown by its key, null till open() names it
  const plain = new Map([[null, { doc, text: doc, edits: [], selection: null, errors: [] }]])
  let key = null, cm = null
  const shown = () => plain.get(key)
  // An edit or a caret moved, here as CodeMirror's update listener tells the page of it: the text, then the caret
  function dispatch(spec) {
    if (cm) return cm.dispatch(spec)
    const d = shown(), ev = spec.userEvent ?? ''
    if (spec.changes) { d.text = apply(d.text, spec.changes); d.edits.push(spec) }
    if (spec.selection) d.selection = spec.selection
    const update = { docChanged: !!spec.changes, changes: { mapPos: pos => mapPos(spec.changes, pos) }, transactions: [{ isUserEvent: e => ev === e || ev.startsWith(e + '.') }] }
    if (spec.changes) onchange?.(d.text, update)
    oncaret?.(update)
  }
  // A slider's moves rewrite the text live and out of the history; where it comes to rest, the whole move is recorded
  // as one change: back to the text before it, out of the history too, then on to the last.
  let before = null
  function slide(change) {
    before ??= self.code
    dispatch({ changes: change, userEvent: 'input.slider', history: false })
  }
  function settle() {
    const start = before, end = self.code
    before = null
    if (start == null || start === end) return
    let a = 0, b = 0
    while (a < start.length && a < end.length && start[a] === end[a]) a++
    while (b < start.length - a && b < end.length - a && start[start.length - 1 - b] === end[end.length - 1 - b]) b++
    dispatch({ changes: { from: a, to: end.length - b, insert: start.slice(a, start.length - b) }, userEvent: 'input.slider', history: false })
    dispatch({ changes: { from: a, to: start.length - b, insert: end.slice(a, end.length - b) }, userEvent: 'input.slider' })
  }
  // after the page's first frames, so the page shows first
  const ready = new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))
    .then(() => import('../assets/codemirror.js'))
    .then(lib => { cm = codemirror(lib, parent, options, plain, key, { slide, settle }); plain.clear(); onready?.() })
  const self = {
    get view() { return cm?.view ?? null },
    // Documents, each its own text, history and caret: open(key) shows one, new with `text` the first time; the one it
    // replaces is kept for coming back to, and forgotten when closed. The document the editor is made with is the first
    // key opened.
    open(k, text = '') {
      if (cm) return cm.open(k, text)
      if (k === key) return
      const first = key == null
      if (first) { plain.set(k, shown()); plain.delete(null) }
      key = k
      if (first) return
      if (!plain.has(k)) plain.set(k, { doc: text, text, edits: [], selection: null, errors: [] })
      onchange?.(shown().text, null)
    },
    close(k) { cm ? cm.close(k) : k !== key && plain.delete(k) },
    get code() { return cm ? cm.code : shown().text },
    get head() { return cm ? cm.head : shown().selection?.head ?? shown().selection?.anchor ?? 0 },
    get range() { if (cm) return cm.range; const { anchor = 0, head = anchor } = shown().selection ?? {}; return [Math.min(anchor, head), Math.max(anchor, head)] },
    // An edit the page makes, undoable like typing.
    change(change, userEvent = 'input.view') { dispatch({ changes: change, userEvent, scroll: true }) },
    slide, settle,
    select(from, to = from) { cm ? cm.select(from, to) : dispatch({ selection: { anchor: from, head: to } }) },
    // The caret moved without the keys: the page keeps them
    caret(pos) { cm ? cm.caret(pos) : dispatch({ selection: { anchor: pos } }) },
    // One history for typing, sliders and edits made on the waveform: before CodeMirror comes, undone as it does
    undo() { cm ? cm.undo() : ready.then(() => cm.undo()) },
    redo() { cm ? cm.redo() : ready.then(() => cm.redo()) },
    get canUndo() { return cm ? cm.canUndo : self.depth[0] > 0 },
    get canRedo() { return cm ? cm.canRedo : false },
    // Steps back and forth: [undoable, redoable]
    get depth() { return cm ? cm.depth : [shown().edits.filter(e => e.history !== false).length, 0] },
    // Errors under the text they are about: [{ from, to, message }].
    errors(list) { if (cm) cm.errors(list); else shown().errors = list }
  }
  return self
}

// A change as CodeMirror takes it, one or a list, positions in the text before it, made to a string
const changesOf = spec => (Array.isArray(spec) ? spec.flat(Infinity) : [spec]).filter(Boolean).map(c => ({ from: c.from, to: c.to ?? c.from, insert: String(c.insert ?? '') }))
const apply = (text, spec) => changesOf(spec).sort((a, b) => b.from - a.from).reduce((t, c) => t.slice(0, c.from) + c.insert + t.slice(c.to), text)
// where a place in the text is after the change (ChangeSet.mapPos): on past what it replaced, at its start if inside it,
// before what is put in where it stands
function mapPos(spec, pos) {
  let d = 0
  for (const c of changesOf(spec).sort((a, b) => a.from - b.from)) {
    if (c.to < pos || c.to === pos && c.from < pos) d += c.insert.length - (c.to - c.from)
    else if (c.from < pos) return c.from + d
    else break
  }
  return pos + d
}

// The editor as CodeMirror makes it, on the documents held till it came (`plain`), the one shown `key`'s; `shared`, the
// slider's slide() and settle(), the page's and a number's dragged here alike
function codemirror(lib, parent, { onchange, oncaret, files = () => [], describe = async () => null, keys = {}, hint = null, wrap = false }, plain, shownKey, { slide, settle }) {
  const {
    EditorView, EditorState, Transaction, keymap, lineNumbers, highlightActiveLine, drawSelection, dropCursor, tooltips,
    history, historyKeymap, defaultKeymap, indentWithTab, isolateHistory, undo, redo, undoDepth, redoDepth, javascript, localCompletionSource, scopeCompletionSource,
    autocompletion, completionKeymap, closeBrackets, closeBracketsKeymap, syntaxHighlighting, HighlightStyle, bracketMatching, indentOnInput,
    syntaxTree, tags, setDiagnostics, highlightSelectionMatches
  } = lib
  const highlight = HighlightStyle.define([
    { tag: [tags.definitionKeyword, tags.modifier], color: 'var(--color-screen-storage)' },
    { tag: [tags.keyword, tags.controlKeyword, tags.moduleKeyword, tags.operatorKeyword], color: 'var(--color-screen-keyword)' },
    { tag: [tags.function(tags.propertyName), tags.function(tags.variableName)], color: 'var(--color-screen-function)' },
    { tag: tags.variableName, color: 'var(--color-screen-variable)' },
    { tag: tags.propertyName, color: 'var(--color-screen-property)' },
    { tag: [tags.className, tags.typeName], color: 'var(--color-screen-type)' },
    { tag: tags.string, color: 'var(--color-screen-string)' },
    { tag: tags.regexp, color: 'var(--color-screen-regexp)' },
    { tag: [tags.bool, tags.null], color: 'var(--color-screen-constant)' },
    // a number drags (scrub): the pointer says so
    { tag: tags.number, color: 'var(--color-screen-number)', cursor: 'ew-resize' },
    { tag: [tags.comment, tags.lineComment, tags.blockComment], color: 'var(--color-screen-comment)', fontStyle: 'italic' },
    { tag: tags.invalid, color: 'var(--color-screen-error)' }
  ])

  // The code slab's look, the same as the site's code examples: grey syntax on the dark screen, or a theme's (skin.css).
  const theme = EditorView.theme({
    '&': { height: '100%', color: 'var(--color-screen-text)', backgroundColor: 'transparent', fontSize: 'var(--font-size-code)' },
    '.cm-scroller': { fontFamily: 'var(--font-mono)', lineHeight: '1.75' },
    // the code scrolled across goes under the line numbers, cut off at their edge (under)
    '.cm-content': { padding: '14px 0 40px', caretColor: 'var(--color-screen-bright)', clipPath: 'inset(0 0 0 var(--under, 0px))' },
    '.cm-line': { padding: '0 16px 0 6px' },
    '.cm-gutters': { backgroundColor: 'transparent', border: 'none', color: 'var(--color-screen-line-number)' },
    '.cm-layer': { clipPath: 'inset(-1e5px -1e5px -1e5px var(--under-layer, 0px))' },
    '.cm-lineNumbers .cm-gutterElement': { padding: '0 6px 0 16px', minWidth: '22px' },
    '.cm-activeLine': { backgroundColor: 'var(--color-screen-line)', boxShadow: 'inset 0 0 0 2px var(--color-screen-line-border)' },
    '.cm-activeLineGutter': { backgroundColor: 'transparent', color: 'var(--color-screen-line-number-active)' },
    '&.cm-focused': { outline: 'none' },
    '&.cm-focused .cm-cursor': { borderLeftColor: 'var(--color-screen-bright)', borderLeftWidth: '1.5px' },
    // the selection, and while the focus is elsewhere the inactive one, as an editor's goes
    '.cm-selectionBackground': { backgroundColor: 'var(--color-screen-selection-inactive)' },
    '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground': { backgroundColor: 'var(--color-screen-selection)' },
    '.cm-matchingBracket, &.cm-focused .cm-matchingBracket': { backgroundColor: 'var(--color-screen-bracket)', color: 'inherit', outline: 'none' },
    '.cm-selectionMatch': { backgroundColor: 'var(--color-screen-match)' },
    '.cm-tooltip': { backgroundColor: 'var(--color-screen-raised)', color: 'var(--color-screen-soft)', border: 'none', borderRadius: '8px', boxShadow: 'var(--shadow-menu)', fontFamily: 'var(--font-body)', fontSize: '12px' },
    '.cm-tooltip.cm-tooltip-autocomplete > ul': { fontFamily: 'var(--font-mono)', maxHeight: '19em', minWidth: '300px', padding: '4px' },
    '.cm-tooltip.cm-tooltip-autocomplete > ul > li': { padding: '2px 8px', lineHeight: '1.7', borderRadius: '4px' },
    '.cm-tooltip.cm-tooltip-autocomplete > ul > li[aria-selected]': { backgroundColor: 'var(--color-screen-pill-active)', color: 'var(--color-screen-bright)' },
    '.cm-tooltip.cm-tooltip-autocomplete > ul > completion-section': { display: 'block', padding: '8px 8px 2px', fontFamily: 'var(--font-body)', fontSize: '10px', letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--color-screen-dim)', border: 'none' },
    '.cm-completionLabel': { color: 'var(--color-screen-ink)' },
    '.cm-completionMatchedText': { textDecoration: 'none', color: 'var(--color-screen-bright)' },
    '.cm-completionDetail': { fontFamily: 'var(--font-body)', fontStyle: 'normal', color: 'var(--color-screen-muted)', marginLeft: '14px' },
    '.cm-completionInfo': { padding: '8px 10px', maxWidth: '280px', lineHeight: '1.5', color: 'var(--color-screen-soft)' },
    '.cm-diagnostic': { padding: '4px 8px' },
    '.cm-diagnostic-error': { borderLeft: '2px solid var(--color-screen-error)' },
    '.cm-lintRange-error': { backgroundImage: 'none', textDecoration: 'underline wavy var(--color-screen-error)', textDecorationSkipInk: 'none', textUnderlineOffset: '4px' },
    '.cm-panels': { backgroundColor: 'var(--color-screen-raised)', color: 'var(--color-screen-soft)' }
  }, { dark: true })

  // Completions: methods after a dot (grouped as the menu groups them), sources and names inside strings.
  const sections = Object.fromEntries([...GROUPS, 'Output'].map((name, rank) => [name, { name, rank }]))
  const summary = spec => spec?.map(s => s.values ? `${s.name}: ${s.values.join(' | ')}` : s.min != null ? `${s.name} ${format(s.min, s)} to ${format(s.max, s)}` : s.name).join(' · ')
  const methodOptions = [
    ...Object.values(ops).map(op => ({ label: op.name, detail: op.text, section: sections[op.group], type: 'method', params: !op.params || op.params.length > 0, info: () => info(op) })),
    ...Object.entries(methods).map(([name, m]) => ({ label: name, detail: m.text, section: sections.Output, type: 'function', params: !['clone', 'undo', 'play'].includes(name) }))
  ].map(option => ({ ...option, apply: insertCall(option.label, option.params) }))
  // A method's parameters with their ranges; a plugin's come from its manifest, read by the engine.
  async function info(op) {
    const dom = document.createElement('div')
    dom.className = 'completion-info'
    dom.textContent = summary(op.params || fromManifest(await describe(op.name))) || 'No parameters'
    return dom
  }
  // Hyphenated names are not identifiers: a.transient-shaper() is written a['transient-shaper']().
  function insertCall(name, params) {
    return (view, completion, from, to) => {
      const valid = /^[\w$]+$/.test(name), dot = view.state.sliceDoc(from - 1, from) === '.'
      const text = valid ? `${name}()` : `['${name}']()`
      const start = valid || !dot ? from : from - 1
      view.dispatch({ changes: { from: start, to, insert: text }, selection: { anchor: start + text.length - (params ? 1 : 0) }, userEvent: 'input.complete' })
    }
  }
  const namespaces = new Set(['Math', 'console', 'JSON', 'Object', 'Array', 'Number', 'String', 'Promise', 'Date', 'Symbol', 'Reflect', 'Intl', 'globalThis', 'self', 'crypto', 'performance'])
  function methodsAfterDot(context) {
    const word = context.matchBefore(/\.[\w$-]*$/)
    if (!word) return null
    const node = syntaxTree(context.state).resolveInner(word.from, -1)
    if (['String', 'TemplateString', 'LineComment', 'BlockComment', 'Number'].includes(node.name)) return null
    const before = context.state.sliceDoc(Math.max(0, word.from - 24), word.from).match(/([\w$]+)\s*$/)?.[1]
    if (before && namespaces.has(before)) return null
    if (before === 'audio') return { from: word.from + 1, options: ['from', 'use', 'op', 'stat', 'plugins', 'version'].map(label => ({ label, type: 'function' })) }
    return { from: word.from + 1, options: methodOptions, validFor: /^[\w$-]*$/ }
  }
  function insideStrings(context) {
    const node = syntaxTree(context.state).resolveInner(context.pos, -1)
    if (node.name !== 'String') return null
    const call = callee(context.state, node)
    const options = call === 'audio' ? files().map(label => ({ label, type: 'constant', detail: 'file' }))
      : call === 'stat' ? Object.entries(stats).map(([label, detail]) => ({ label, detail, type: 'constant' }))
      : presets[call]?.map(label => ({ label, type: 'constant' }))
    if (!options?.length) return null
    return { from: node.from + 1, to: Math.max(node.from + 1, node.to - 1), options, validFor: /^[^'"`]*$/ }
  }
  const callee = (state, node) => {
    for (let n = node.parent; n; n = n.parent) {
      if (n.name === 'ArrayExpression') continue
      if (n.name !== 'ArgList') return null
      const target = n.parent?.firstChild
      if (target?.name === 'VariableName') return state.sliceDoc(target.from, target.to)
      const prop = target?.name === 'MemberExpression' && target.getChild('PropertyName')
      return prop ? state.sliceDoc(prop.from, prop.to) : null
    }
    return null
  }

  // A number in the script: the Number node, a minus before it its own, so it goes through zero; its text, its place
  const literal = (state, node) => {
    if (node?.name !== 'Number') return null
    const minus = node.parent?.name === 'UnaryExpression' && state.sliceDoc(node.parent.from, node.from).trim() === '-'
    const from = minus ? node.parent.from : node.from, text = state.sliceDoc(from, node.to).replace(/\s+/g, '')
    return /^-?(\d+\.?\d*|\.\d+)$/.test(text) ? { node, from, to: node.to, text } : null
  }
  // the one under the pointer, by the text it shows (what the highlighter drew from the syntax tree), not by coordinates
  // the editor may not have measured yet, just shown
  const pointed = (view, event) => {
    const text0 = event.target.closest?.('.cm-line') && event.target.firstChild?.nodeType === 3 ? event.target.firstChild : null
    const pos = text0 ? view.posAtDOM(text0, 0) : null
    return pos == null ? null : literal(view.state, syntaxTree(view.state).resolveInner(pos, 1))
  }
  // the one selected, whole, with its minus or without
  const selected = state => {
    const { from, to } = state.selection.main, n = from < to && literal(state, syntaxTree(state).resolveInner(to, -1))
    return n && n.to === to && (from === n.from || from === n.node.from) ? n : null
  }
  // k steps of its last decimal from it, as it is written: 0.25 by 0.01, 3 by 1
  const stepped = (text, k) => (+text + k * 10 ** -(text.split('.')[1] || '').length).toFixed((text.split('.')[1] || '').length).replace(/^-(0\.?0*)$/, '$1')

  // What a number sets, said by it: the method it is given to, the parameter (by its name in an options object, else by
  // its place among the arguments), its value as written in its unit, and the range the edits' sliders give it (ops.js). The
  // options every edit takes are the range's and the seam's, in seconds; a gain curve's, its times and levels
  const OPTIONS = { at: ['at', 's'], duration: ['duration', 's'], to: ['to', 's'], crossfade: ['crossfade', 's'], t: ['time', 's'], v: ['level', 'dB'] }
  function says(state, n) {
    let node = n.node, key = null
    for (let p = node.parent; p; node = p, p = p.parent) {
      if (p.name === 'Property') { if (key == null) { const d = p.getChild('PropertyDefinition'); key = d ? state.sliceDoc(d.from, d.to) : '' } continue }
      if (['UnaryExpression', 'ObjectExpression', 'ArrayExpression'].includes(p.name)) continue
      if (p.name !== 'ArgList') return null
      const target = p.parent?.firstChild, name = target?.name === 'MemberExpression' ? target.getChild('PropertyName') : target?.name === 'VariableName' ? target : null
      const call = name && state.sliceDoc(name.from, name.to)
      let index = 0
      for (let c = p.firstChild; c && c.from < node.from; c = c.nextSibling) if (!['(', ')', ','].includes(c.name)) index++
      const params = ops[call]?.params, spec = key ? params?.find(s => s.name === key) ?? (OPTIONS[key] && { name: OPTIONS[key][0], unit: OPTIONS[key][1] }) : params?.[index]
      const range = spec?.min != null ? `, ${format(spec.min, spec)} to ${format(spec.max, spec)}` : ''
      return `${call ?? ''} ${spec?.name ?? key ?? ''} ${n.text.replace(/^-/, '−')}${spec?.unit ?? ''}${range}`.replace(/\s+/g, ' ').trim()
    }
    return null
  }
  // said under it, or put away
  const self = {}
  function tell(view, n) {
    const text = n && says(view.state, n), at = text && view.coordsAtPos(n.from)
    at ? hint?.show(text, { x: at.left, y: at.bottom + 12 }, self) : hint?.hide(self)
  }

  // A number dragged across, as Bret Victor's Tangle has it: a step up or down for every 4 px (its last decimal's step,
  // ten of them with Shift), the output following as it goes (a slider's live edit, out of the history), one step of
  // the history where it is let go. Pressed and let go where it was, the caret goes there, as anywhere; a double-click
  // selects all of it, its minus and its decimals, for the arrows to step. Pointed at, it says what it sets.
  let dragging = false
  const scrub = EditorView.domEventHandlers({
    mousedown(event, view) {
      if (event.button || event.detail > 2 || event.shiftKey || event.altKey || event.metaKey || event.ctrlKey) return false
      const n = pointed(view, event)
      if (!n) return false
      event.preventDefault()
      if (event.detail === 2) { view.dispatch({ selection: { anchor: n.from, head: n.to } }); view.focus(); return true }
      const x0 = event.clientX, { from } = n
      let moved = false, { text } = n, length = n.to - from
      dragging = true
      const move = e => {
        if (!moved && Math.abs(e.clientX - x0) < 3) return
        moved = true
        const next = stepped(n.text, Math.trunc((e.clientX - x0) / 4) * (e.shiftKey ? 10 : 1))
        if (next === text) return
        slide({ from, to: from + length, insert: next })
        text = next
        length = next.length
        tell(view, literal(view.state, syntaxTree(view.state).resolveInner(from + length, -1)))
      }
      const up = () => {
        removeEventListener('pointermove', move)
        removeEventListener('pointerup', up)
        dragging = false
        if (moved) settle()
        else view.dispatch({ selection: { anchor: view.posAtCoords({ x: x0, y: event.clientY }) ?? from } })
        view.focus()
      }
      addEventListener('pointermove', move)
      addEventListener('pointerup', up)
      return true
    },
    mousemove(event, view) { if (!dragging && !selected(view.state)) tell(view, pointed(view, event)) },
    mouseleave(event, view) { if (!dragging && !selected(view.state)) hint?.hide(self) },
    blur() { if (!dragging) hint?.hide(self) }
  })
  // A number selected, the arrows step it, as a spin box's: ↑ up and ↓ down by its last decimal's step, ten with Shift;
  // still selected, saying what it is now. Else the arrows are the caret's.
  function nudge(view, k) {
    const n = selected(view.state)
    if (!n) return false
    const next = stepped(n.text, k)
    view.dispatch({ changes: { from: n.from, to: n.to, insert: next }, selection: { anchor: n.from, head: n.from + next.length }, userEvent: 'input.step', scrollIntoView: true })
    return true
  }
  // The line numbers stand over the code scrolled across under them: what passes beneath is cut off a line's own margin
  // (6px) past their edge, as far from them as unscrolled, the slab's ground showing through them as everywhere (a gutter
  // painted over the code would break its scanlines and shading). The code is cut where the scroll has taken it; the
  // selection and caret, drawn from the scroll's start, past the line numbers too
  function under(v) {
    const s = v.scrollDOM.scrollLeft, g = v.dom.querySelector('.cm-gutters')?.offsetWidth ?? 0, cut = s + Math.min(s, 6)
    v.dom.style.setProperty('--under', `${cut}px`)
    v.dom.style.setProperty('--under-layer', `${cut + g}px`)
  }
  const steps = [{ key: 'ArrowUp', run: v => nudge(v, 1), shift: v => nudge(v, 10) }, { key: 'ArrowDown', run: v => nudge(v, -1), shift: v => nudge(v, -10) }]

  const extensions = [
    lineNumbers(), history(), drawSelection(), dropCursor(), indentOnInput(), bracketMatching(), closeBrackets(), highlightActiveLine(), highlightSelectionMatches(),
    javascript(), syntaxHighlighting(highlight), theme, scrub,
    autocompletion({ override: [insideStrings, methodsAfterDot, localCompletionSource, scopeCompletionSource(globalThis)], icons: false, maxRenderedOptions: 400 }),
    tooltips({ parent: document.body }),
    keymap.of([...Object.entries(keys).map(([key, run]) => ({ key, run: () => (run(), true), preventDefault: true })), ...steps, ...closeBracketsKeymap, ...completionKeymap, ...historyKeymap, indentWithTab, ...defaultKeymap]),
    EditorView.updateListener.of(update => {
      if (update.geometryChanged) under(update.view)
      if (update.docChanged) onchange?.(update.state.doc.toString(), update)
      if (update.docChanged || update.selectionSet) oncaret?.(update)
      // a number selected says what it sets; once it is not, it is quiet
      if (update.selectionSet && !dragging) requestAnimationFrame(() => { if (!dragging) tell(update.view, selected(update.view.state)) })
    }),
    EditorView.contentAttributes.of({ 'aria-label': 'Script' }),
    wrap ? EditorView.lineWrapping : []
  ]
  // what the page asks of the text, as a transaction: an edit out of the history (`history: false`), one scrolled to
  const spec = ({ changes, selection, userEvent, history: kept = true, scroll = false }) => ({ changes, selection, userEvent, scrollIntoView: scroll, annotations: kept ? [] : [Transaction.addToHistory.of(false)] })
  // A document held till now, as it opened, its edits made again, each a step of its history of its own as it was; its
  // selection and errors
  function stateOf(d) {
    let state = EditorState.create({ doc: d.doc, extensions })
    for (const e of d.edits) state = state.update({ ...spec(e), scrollIntoView: false, annotations: [...spec(e).annotations, isolateHistory.of('full')] }).state
    const end = state.doc.length, { anchor, head = anchor } = d.selection ?? {}
    if (d.selection) state = state.update({ selection: { anchor: Math.min(anchor, end), head: Math.min(head, end) } }).state
    if (d.errors.length) state = state.update(setDiagnostics(state, d.errors.map(e => ({ ...e, severity: 'error' })))).state
    return state
  }
  const view = new EditorView({ parent, state: stateOf(plain.get(shownKey)) })
  view.scrollDOM.addEventListener('scroll', () => under(view), { passive: true })

  // Documents, each its own text, history and caret: open(key) shows one, new with `text` the first time; the one it
  // replaces is kept for coming back to, and forgotten when closed
  const kept = new Map([...plain].filter(([k]) => k !== shownKey).map(([k, d]) => [k, stateOf(d)]))
  let key = shownKey
  function open(k, text = '') {
    if (k === key) return
    kept.set(key, view.state)
    key = k
    view.setState(kept.get(k) ?? EditorState.create({ doc: text, extensions }))
    kept.delete(k)
    onchange?.(view.state.doc.toString(), null)
  }

  return {
    view,
    dispatch: s => view.dispatch(spec(s)),
    open, close: k => kept.delete(k),
    get code() { return view.state.doc.toString() },
    get head() { return view.state.selection.main.head },
    get range() { const { from, to } = view.state.selection.main; return [from, to] },
    select(from, to = from) { view.dispatch({ selection: { anchor: from, head: to }, scrollIntoView: true }); view.focus() },
    caret(pos) { view.dispatch({ selection: { anchor: pos }, scrollIntoView: true }) },
    undo: () => undo(view), redo: () => redo(view),
    get canUndo() { return undoDepth(view.state) > 0 },
    get canRedo() { return redoDepth(view.state) > 0 },
    get depth() { return [undoDepth(view.state), redoDepth(view.state)] },
    errors(list) { view.dispatch(setDiagnostics(view.state, list.map(e => ({ ...e, severity: 'error' })))) }
  }
}
