import {
  EditorView, EditorState, Transaction, keymap, lineNumbers, highlightActiveLine, drawSelection, dropCursor, tooltips,
  defaultKeymap, history, historyKeymap, indentWithTab, undo, redo, undoDepth, redoDepth, javascript, localCompletionSource, scopeCompletionSource,
  autocompletion, completionKeymap, closeBrackets, closeBracketsKeymap, syntaxHighlighting, HighlightStyle, bracketMatching, indentOnInput,
  syntaxTree, tags, setDiagnostics, highlightSelectionMatches
} from '../assets/codemirror.js'
import { ops, methods, stats, presets, GROUPS, format, fromManifest } from './ops.js'

// The script editor: JavaScript with the audio methods completed after a dot, sources and stat names completed
// inside strings. `oncaret(update)` hears every move of the selection and every change, for the stack beside it.
export default function editor(parent, { doc = '', onchange, oncaret, files = () => [], describe = async () => null, keys = {} }) {
  const highlight = HighlightStyle.define([
    { tag: [tags.keyword, tags.modifier, tags.controlKeyword, tags.definitionKeyword, tags.moduleKeyword, tags.operatorKeyword], color: 'var(--color-screen-bright)' },
    { tag: [tags.function(tags.propertyName), tags.function(tags.variableName)], color: 'var(--color-screen-ink)' },
    { tag: [tags.string, tags.number, tags.bool, tags.null, tags.regexp], color: 'var(--color-screen-muted)' },
    { tag: [tags.comment, tags.lineComment, tags.blockComment], color: 'var(--color-screen-dim)', fontStyle: 'italic' },
    { tag: tags.invalid, color: 'var(--color-screen-error)' }
  ])

  // The code slab's look, the same as the site's code examples: grey syntax on the dark screen.
  const theme = EditorView.theme({
    '&': { height: '100%', color: 'var(--color-screen-soft)', backgroundColor: 'transparent', fontSize: '13px' },
    '.cm-scroller': { fontFamily: 'var(--font-mono)', lineHeight: '1.75' },
    '.cm-content': { padding: '14px 0 40px', caretColor: 'var(--color-screen-bright)' },
    '.cm-line': { padding: '0 20px 0 6px' },
    '.cm-gutters': { backgroundColor: 'transparent', border: 'none', color: 'var(--color-screen-rule)' },
    '.cm-lineNumbers .cm-gutterElement': { padding: '0 6px 0 16px', minWidth: '22px' },
    '.cm-activeLine': { backgroundColor: 'oklch(100% 0 0 / .03)' },
    '.cm-activeLineGutter': { backgroundColor: 'transparent', color: 'var(--color-screen-dim)' },
    '&.cm-focused': { outline: 'none' },
    '&.cm-focused .cm-cursor': { borderLeftColor: 'var(--color-screen-bright)', borderLeftWidth: '1.5px' },
    '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground': { backgroundColor: 'oklch(100% 0 0 / .15)' },
    '.cm-matchingBracket, &.cm-focused .cm-matchingBracket': { backgroundColor: 'oklch(100% 0 0 / .1)', color: 'inherit', outline: 'none' },
    '.cm-selectionMatch': { backgroundColor: 'oklch(100% 0 0 / .07)' },
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

  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc,
      extensions: [
        lineNumbers(), history(), drawSelection(), dropCursor(), indentOnInput(), bracketMatching(), closeBrackets(), highlightActiveLine(), highlightSelectionMatches(),
        javascript(), syntaxHighlighting(highlight), theme,
        autocompletion({ override: [insideStrings, methodsAfterDot, localCompletionSource, scopeCompletionSource(globalThis)], icons: false, maxRenderedOptions: 400 }),
        tooltips({ parent: document.body }),
        keymap.of([...Object.entries(keys).map(([key, run]) => ({ key, run: () => (run(), true), preventDefault: true })), ...closeBracketsKeymap, ...completionKeymap, ...historyKeymap, indentWithTab, ...defaultKeymap]),
        EditorView.updateListener.of(update => {
          if (update.docChanged) onchange?.(update.state.doc.toString(), update)
          if (update.docChanged || update.selectionSet) oncaret?.(update)
        }),
        EditorView.contentAttributes.of({ 'aria-label': 'Script' })
      ]
    })
  })

  // A slider's moves rewrite the text live and out of the history; where it comes to rest, the whole move is recorded
  // as one change: back to the text before it, out of the history too, then on to the last.
  let before = null
  function slide(change) {
    before ??= view.state.doc.toString()
    view.dispatch({ changes: change, userEvent: 'input.slider', annotations: Transaction.addToHistory.of(false) })
  }
  function settle() {
    const start = before, end = view.state.doc.toString()
    before = null
    if (start == null || start === end) return
    let a = 0, b = 0
    while (a < start.length && a < end.length && start[a] === end[a]) a++
    while (b < start.length - a && b < end.length - a && start[start.length - 1 - b] === end[end.length - 1 - b]) b++
    view.dispatch({ changes: { from: a, to: end.length - b, insert: start.slice(a, start.length - b) }, userEvent: 'input.slider', annotations: Transaction.addToHistory.of(false) })
    view.dispatch({ changes: { from: a, to: start.length - b, insert: end.slice(a, end.length - b) }, userEvent: 'input.slider' })
  }

  return {
    view,
    get code() { return view.state.doc.toString() },
    get head() { return view.state.selection.main.head },
    get range() { const { from, to } = view.state.selection.main; return [from, to] },
    // An edit the page makes, undoable like typing.
    change(change, userEvent = 'input.view') { view.dispatch({ changes: change, userEvent, scrollIntoView: true }) },
    slide, settle,
    select(from, to = from) { view.dispatch({ selection: { anchor: from, head: to }, scrollIntoView: true }); view.focus() },
    // The caret moved without the keys: the page keeps them
    caret(pos) { view.dispatch({ selection: { anchor: pos }, scrollIntoView: true }) },
    // One history for typing, sliders and edits made on the waveform
    undo: () => undo(view), redo: () => redo(view),
    get canUndo() { return undoDepth(view.state) > 0 },
    get canRedo() { return redoDepth(view.state) > 0 },
    // Steps back and forth: [undoable, redoable]
    get depth() { return [undoDepth(view.state), redoDepth(view.state)] },
    // Errors under the text they are about: [{ from, to, message }].
    errors(list) { view.dispatch(setDiagnostics(view.state, list.map(e => ({ ...e, severity: 'error' })))) }
  }
}
