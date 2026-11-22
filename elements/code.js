// <audio-code>: the repl's script, alone: its code pane with no picture beside it.
//
//   <script type="module" src="https://audio.js.org/audio/elements/code.js"></script>
//   <audio-code>
//   <pre><code>audio('take.mp3')
//     .trim()
//     .normalize('podcast')</code></pre>
//   </audio-code>
//
// The <pre> is the text where scripts don't run, and for a search engine; a page may hide it till the element is
// defined (`audio-code:not(:defined) > pre { visibility: hidden }`). Where scripts run, the element draws the text as
// the editor does: its lines numbered, its words coloured by the editor's own reading of them (repl/syntax.js over the
// parser's tree, by the rules of repl/script.js LOOKS, in the skin's colours, repl/skin.css), the same box the editor
// will fill. The script editor itself (repl/script.js: CodeMirror, the largest module the editor has) takes its place
// once a reader reaches for it, the pointer over it, a press on it or the keys in it, a caret where the press was; so
// a page of code blocks loads no CodeMirror for a reader who only reads them. `readonly`: never; the text stays
// coloured and selectable.
//
// el.value, the text; set, the whole of it replaced, one step undo takes back, no event. An `input` event each time the
// reader changes it. el.focus() puts the keys in it. Running the script and playing its sound are not its job: they
// are its sound's, the <audio-sound> it is in or its `for` names (sound.js), whose script it then is. With one, a file's
// name typed in audio('…') is completed from the sound's files, a plugin's parameters are shown from its engine, and
// ⌘↵ plays it, ⌘S saves it.
//
// Its look is the editor's, set by custom properties a page may set on the element: --color-screen (its ground),
// --color-screen-ink, --color-screen-line-number, --color-syntax-<word> (repl/skin.css), --font-mono,
// --font-size-code. The skin's own values come in a cascade layer of their own (`audio`), on the root: any value the
// page sets wins over them, whatever its order, and CodeMirror's completions, drawn in the page's body, read them too.
// A page with colours of its own for the words marks its root data-worn, as a theme worn in the editor does (theme.js
// wear): the skin's own for them leave, and a word the page gives no colour takes the text's.
import editor, { LOOKS, marked } from '../repl/script.js'
import words from '../repl/syntax.js'
import { parser } from '../assets/lezer.js'
import { soundOf } from './part.js'

// A CodeMirror theme's rules as CSS under `scope`, as its StyleModule writes them: a selector's top-level commas part
// it, `&` is the editor itself, a selector without one is under it; camel case to the property's name. A pointer's
// look left out: the text before CodeMirror is not dragged
const parts = s => { let depth = 0, at = 0; const out = []; for (let i = 0; i < s.length; i++) { const c = s[i]; if (c === '(' || c === '[') depth++; else if (c === ')' || c === ']') depth--; else if (c === ',' && !depth) { out.push(s.slice(at, i).trim()); at = i + 1 } } return [...out, s.slice(at).trim()] }
const prop = p => p.startsWith('--') ? p : p.replace(/[A-Z]/g, c => '-' + c.toLowerCase())
const rules = (spec, scope) => Object.entries(spec).map(([sel, style]) => {
  const body = Object.entries(style).filter(([p]) => p !== 'cursor').map(([p, v]) => `${prop(p)}: ${v};`).join(' ')
  return body && `${parts(sel).map(s => s.includes('&') ? s.replace('&', scope) : `${scope} ${s}`).join(', ')} { ${body} }`
}).filter(Boolean).join('\n')

// The text before CodeMirror: the editor's box made of CodeMirror's own classes, so a page's rule for one is a rule
// for both. Scoped at no weight, under the editor's (CodeMirror's theme, .ͼN .cm-content) and the block's own below
const STATIC = ':where(audio-code > .cm-editor[data-static])'
// as much room under the last line as over the first, the editor's own over it (it keeps room under its last line for
// the pane it fills)
const [TOP] = LOOKS.slab['.cm-content'].padding.split(' ')
const CSS = `
@import url("${new URL('../repl/skin.css', import.meta.url)}") layer(audio);
/* the skin's colour scheme is the editor's page's, not this one's */
@layer audio { :root { color-scheme: revert-layer; } }
:where(audio-code) { display: block; position: relative; overflow: hidden; border-radius: var(--radius-sm); background: var(--color-screen); color: var(--color-screen-ink); }
audio-code[data-drawn] > pre { display: none; }
audio-code .cm-editor .cm-content { padding-bottom: ${TOP}; }
audio-code:has(:focus-visible) { outline: 2px solid var(--color-screen-accent); outline-offset: -2px; }
/* the pane the script editor comes into (hidden till reached): given its room, unseen over the text till it is in */
audio-code[data-reached] > .pane { position: absolute; inset: 0; visibility: hidden; }
audio-code[data-live] > .pane { position: relative; inset: auto; visibility: visible; }
audio-code[data-live] > [data-static] { display: none; }
/* CodeMirror's own layout (@codemirror/view baseTheme), for the text before it: the editor a column, its scroller a
   row of the gutter and the content, a line a block, the numbers right-aligned; the first number as far down as the
   content's first line (CodeMirror sets its margin so) */
${STATIC} { position: relative; box-sizing: border-box; display: flex; flex-direction: column; }
${STATIC} .cm-scroller { display: flex; align-items: flex-start; overflow-x: auto; position: relative; z-index: 0; }
${STATIC} .cm-content { margin: 0; flex-grow: 2; flex-shrink: 0; display: block; white-space: pre; word-wrap: normal; box-sizing: border-box; outline: none; user-select: text; }
${STATIC} .cm-line { display: block; }
${STATIC} .cm-gutters { flex-shrink: 0; display: flex; box-sizing: border-box; user-select: none; }
${STATIC} .cm-gutter { display: flex; flex-direction: column; flex-shrink: 0; box-sizing: border-box; overflow: hidden; padding-top: ${TOP}; }
${STATIC} .cm-gutterElement { box-sizing: border-box; }
${STATIC} .cm-lineNumbers .cm-gutterElement { text-align: right; white-space: nowrap; }
${STATIC} .cm-gutterElement.spacer { height: 0; visibility: hidden; }
${STATIC} ::selection { background: var(--color-screen-select); }
${rules(LOOKS.slab, STATIC)}
${rules(LOOKS.words, STATIC)}`

// the stylesheet, once a page, and whether its skin is in (a style's load waits for its @import)
let styled = null
const style = () => styled ??= new Promise(resolve => {
  const el = Object.assign(document.createElement('style'), { id: 'audio-code-style', textContent: CSS, onload: resolve, onerror: resolve })
  document.head.append(el)
})

const escape = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
// The text's lines as the script editor marks them: each run of characters in the same words a span in each of them,
// outermost first (words() lists a part before the words in it), so a word with no look of its own takes its part's
function lines(text) {
  const marks = Array.from(text, () => [])
  for (const [from, to, word, meaning] of words(parser.parse(text), text)) for (let k = from; k < to; k++) marks[k].push(marked(word, meaning))
  const out = []
  let line = '', run = '', key = null
  const flush = () => { if (run) line += key.split('\n').filter(Boolean).reduceRight((inner, c) => `<span class="${c}">${inner}</span>`, escape(run)); run = '' }
  for (let at = 0; at <= text.length; at++) {
    if (at === text.length || text[at] === '\n') { flush(); out.push(line || '<br>'); line = ''; key = null; continue }
    const k = marks[at].join('\n')
    if (k !== key) { flush(); key = k }
    run += text[at]
  }
  return out
}
// The script's text as written in the page: its <pre>'s, else the element's own, put in a <pre> for where scripts
// don't run; the newline after its opening tag and the white space at its end not its own
function written(el) {
  let pre = el.querySelector(':scope > pre')
  if (!pre) { pre = document.createElement('pre'); pre.textContent = el.textContent; el.replaceChildren(pre) }
  return pre.textContent.replace(/^\n/, '').replace(/\s+$/, '')
}

class AudioCode extends HTMLElement {
  #ed = null; #static = null; #pane = null; #press = null; #waiting = false; #reached = false

  connectedCallback() {
    if (this.#ed) return
    this.#static = Object.assign(document.createElement('div'), { className: 'cm-editor', tabIndex: 0, translate: false })
    this.#static.dataset.static = ''
    for (const [k, v] of Object.entries({ role: 'textbox', 'aria-multiline': 'true', 'aria-readonly': 'true', 'aria-label': 'Script' })) this.#static.setAttribute(k, v)
    // (hidden by its attribute, not by a rule: Firefox applies none of a stylesheet till its @import is in, and a pane
    // with a width is one the script editor loads CodeMirror for)
    this.#pane = Object.assign(document.createElement('div'), { className: 'pane', hidden: true })
    // the editor's own input events stay its own: the element's says its text changed
    this.#pane.addEventListener('input', e => e.stopPropagation())
    this.#ed = editor(this.#pane, {
      doc: written(this),
      // CodeMirror once the pane shows (reach)
      lazy: true,
      // its sound's, where it has one, asked each time
      files: () => soundOf(this)?.files ?? [],
      describe: async name => soundOf(this)?.describe?.(name) ?? null,
      keys: { 'Mod-Enter': () => soundOf(this)?.toggle?.(), 'Mod-s': () => soundOf(this)?.save?.() },
      onchange: (code, update) => {
        if (!this.hasAttribute('data-live')) this.#draw()
        if (update && !update.transactions.some(tr => tr.isUserEvent('set'))) this.dispatchEvent(new Event('input', { bubbles: true }))
      },
      // in its place once it has measured itself, its line numbers laid by its lines: after its first measure, in the
      // same frame (a measure's write may not dispatch, which a caret put back does)
      onready: () => this.#ed.view.requestMeasure({ read: () => null, write: () => queueMicrotask(() => this.#live()) })
    })
    this.append(this.#static, this.#pane)
    // reached for: the pointer over it, a press, the keys in it. A press on the text is where the caret goes once the
    // editor is in, let go; one that turns into a scroll (cancelled) is none
    const reach = e => {
      if (this.hasAttribute('readonly')) return
      if (e.type === 'pointerdown' && this.#static.contains(e.target)) {
        const press = this.#press = { x: e.clientX, y: e.clientY, down: true }
        const up = e => { removeEventListener('pointerup', up); removeEventListener('pointercancel', up); if (e.type === 'pointercancel') this.#press = null; press.down = false; if (this.#waiting) this.#live() }
        addEventListener('pointerup', up)
        addEventListener('pointercancel', up)
      }
      this.#reached = true
      this.#reach()
    }
    for (const type of ['pointerenter', 'pointerdown', 'focusin']) this.addEventListener(type, reach)
    style().then(() => { this.#draw(); this.#reach() })
  }
  // the pane given its room, once the text is drawn where it will lie over it
  #reach() {
    if (!this.#reached || !this.hasAttribute('data-drawn') || !this.#pane.hidden) return
    this.#pane.hidden = false
    this.toggleAttribute('data-reached', true)
  }

  get value() { return this.#ed ? this.#ed.code : written(this) }
  set value(text) {
    text = String(text)
    if (!this.#ed) { (this.querySelector(':scope > pre') ?? this.appendChild(document.createElement('pre'))).textContent = text; return }
    if (text !== this.#ed.code) this.#ed.change({ from: 0, to: this.#ed.code.length, insert: text }, 'set')
  }
  focus(options) { this.hasAttribute('data-live') ? this.#ed.view.focus() : this.#static?.focus(options) }

  // the text drawn as the editor draws it, its lines numbered: the widest number CodeMirror's gutter makes room for
  // first (lineNumbers' spacer: as many nines as the count has digits), unseen
  #draw() {
    const html = lines(this.#ed.code), n = html.length
    const numbers = [`<div class="cm-gutterElement spacer">${'9'.repeat(String(n).length)}</div>`, ...html.map((_, i) => `<div class="cm-gutterElement">${i + 1}</div>`)]
    this.#static.innerHTML = `<div class="cm-scroller"><div class="cm-gutters" aria-hidden="true"><div class="cm-gutter cm-lineNumbers">${numbers.join('')}</div></div><div class="cm-content">${html.map(l => `<div class="cm-line">${l}</div>`).join('')}</div></div>`
    this.toggleAttribute('data-drawn', true)
  }

  // CodeMirror in: shown in the text's place, once no press is held on the text (a selection being made there is the
  // reader's); the keys in it, at the press, or the selection made, where the text had them
  #live() {
    this.#waiting = !!this.#press?.down
    if (this.#waiting || this.hasAttribute('data-live')) return
    const had = this.#static.contains(document.activeElement), sel = this.#selected(), at = this.#press && this.#offset(this.#press.x, this.#press.y)
    this.toggleAttribute('data-live', true)
    if (sel) this.#ed.select(...sel)
    else if (at != null) this.#ed.select(at)
    else if (had) this.#ed.view.focus()
  }
  // where in the text a place in the window is, and what of it is selected, as offsets into it
  #offset(x, y) {
    const p = document.caretPositionFromPoint?.(x, y), r = p ? null : document.caretRangeFromPoint?.(x, y)
    const node = p?.offsetNode ?? r?.startContainer, off = p?.offset ?? r?.startOffset
    return node && this.#static.contains(node) ? this.#at(node, off) : null
  }
  #selected() {
    const s = getSelection()
    if (!s?.rangeCount || s.isCollapsed || !this.#static.contains(s.anchorNode) || !this.#static.contains(s.focusNode)) return null
    const a = this.#at(s.anchorNode, s.anchorOffset), b = this.#at(s.focusNode, s.focusOffset)
    return a == null || b == null ? null : [a, b]
  }
  #at(node, off) {
    const line = (node.nodeType === 1 ? node : node.parentElement)?.closest('.cm-line')
    if (!line) return null
    const all = [...this.#static.querySelectorAll('.cm-line')], i = all.indexOf(line), r = document.createRange()
    r.setStart(line, 0)
    r.setEnd(node, off)
    return all.slice(0, i).reduce((n, l) => n + l.textContent.length + 1, 0) + r.toString().length
  }
}

if (!customElements.get('audio-code')) customElements.define('audio-code', AudioCode)
