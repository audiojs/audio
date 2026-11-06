// The script's words as VS Code colours JavaScript, read off the syntax tree CodeMirror's parser makes of it
// (@lezer/javascript): each word the scopes VS Code's TextMate grammar gives it (extensions/javascript/syntaxes/
// JavaScript.tmLanguage.json, microsoft/TypeScript-TmLanguage's), and a name TypeScript's language service marks
// (src/services/classifier2020.ts, which VS Code's semantic highlighting draws over the grammar's) its semantic token.
// A part round other words (a string, a comment, an object, a block, a template's expression) is a word too, its words
// inside it: where a word's own scopes say nothing of a colour or a style, it shows its part's, as the grammar's scopes
// nest and a theme's rules fall through them (vscode-textmate AttributedScopeStack). The grammar reads a line at a time:
// what it sees ahead (`a.` a member's object, `(` a call) is the line's, so here too.

// Each word's own scopes, outermost first, as the grammar names them, '' none of its own (it takes its part's); after
// ' / ', those it always sits in, for a theme's rules that name them (`string.regexp constant.character.escape`)
const EMBEDDED = 'string.template.js meta.template.expression.js meta.embedded.line.js'
const NAMES = {
  number: 'constant.numeric.decimal.js', true: 'constant.language.boolean.true.js', false: 'constant.language.boolean.false.js',
  null: 'constant.language.null.js', undefined: 'constant.language.undefined.js', this: 'variable.language.this.js',
  variable: 'variable.other.readwrite.js', constant: 'variable.other.constant.js', object: 'variable.other.object.js',
  'constant-object': 'variable.other.constant.object.js', property: 'variable.other.property.js', 'object-property': 'variable.other.object.property.js',
  'constant-property': 'variable.other.constant.property.js', call: 'meta.function-call.js entity.name.function.js',
  'call-object': 'meta.function-call.js variable.other.object.js', 'call-object-property': 'meta.function-call.js variable.other.object.property.js'
}
export const WORDS = {
  // the script, round all of it
  source: 'source.js',
  // the parts round other words, and their marks
  comment: 'comment.line.double-slash.js', 'comment-mark': 'comment.line.double-slash.js / punctuation.definition.comment.js',
  'block-comment': 'comment.block.js', 'block-comment-mark': 'comment.block.js / punctuation.definition.comment.js',
  doc: 'comment.block.documentation.js', 'doc-mark': 'comment.block.documentation.js / punctuation.definition.comment.js',
  // a doc comment's tags (`@param`), types (`{number}`) and parameters' names
  'doc-tag': 'comment.block.documentation.js / storage.type.class.jsdoc', 'doc-at': 'comment.block.documentation.js storage.type.class.jsdoc / punctuation.definition.block.tag.jsdoc',
  'doc-type': 'comment.block.documentation.js / entity.name.type.instance.jsdoc',
  'doc-type-begin': 'comment.block.documentation.js entity.name.type.instance.jsdoc / punctuation.definition.bracket.curly.begin.jsdoc',
  'doc-type-end': 'comment.block.documentation.js entity.name.type.instance.jsdoc / punctuation.definition.bracket.curly.end.jsdoc',
  'doc-name': 'comment.block.documentation.js / variable.other.jsdoc',
  'doc-optional-begin': 'comment.block.documentation.js variable.other.jsdoc / punctuation.definition.optional-value.begin.bracket.square.jsdoc',
  'doc-optional-end': 'comment.block.documentation.js variable.other.jsdoc / punctuation.definition.optional-value.end.bracket.square.jsdoc',
  string: 'string.quoted.single.js', 'double-string': 'string.quoted.double.js',
  'quote-begin': 'string.quoted.single.js / punctuation.definition.string.begin.js', 'quote-end': 'string.quoted.single.js / punctuation.definition.string.end.js',
  escape: 'string.quoted.single.js / constant.character.escape.js',
  template: 'string.template.js', 'template-begin': 'string.template.js / punctuation.definition.string.template.begin.js',
  'template-end': 'string.template.js / punctuation.definition.string.template.end.js',
  interpolation: 'string.template.js / meta.template.expression.js', embedded: 'string.template.js meta.template.expression.js / meta.embedded.line.js',
  'interpolation-begin': 'string.template.js meta.template.expression.js / punctuation.definition.template-expression.begin.js',
  'interpolation-end': 'string.template.js meta.template.expression.js / punctuation.definition.template-expression.end.js',
  'object-literal': 'meta.objectliteral.js', member: 'meta.objectliteral.js / meta.object.member.js',
  key: 'meta.objectliteral.js meta.object.member.js / meta.object-literal.key.js', 'key-colon': 'meta.objectliteral.js meta.object.member.js meta.object-literal.key.js / punctuation.separator.key-value.js',
  block: 'meta.block.js',
  // a regular expression's
  regexp: 'string.regexp.js', 'regexp-begin': 'string.regexp.js / punctuation.definition.string.begin.js', 'regexp-end': 'string.regexp.js / punctuation.definition.string.end.js',
  'regexp-flags': 'string.regexp.js / keyword.other.js', 'regexp-escape': 'string.regexp.js / constant.character.escape.backslash.regexp',
  'regexp-class': 'string.regexp.js / constant.other.character-class.regexp', 'regexp-quantifier': 'string.regexp.js / keyword.operator.quantifier.regexp',
  'regexp-anchor': 'string.regexp.js / keyword.control.anchor.regexp', 'regexp-or': 'string.regexp.js / keyword.operator.or.regexp',
  'regexp-group': 'string.regexp.js / meta.group.regexp', 'regexp-paren': 'string.regexp.js meta.group.regexp / punctuation.definition.group.regexp',
  'regexp-no-capture': 'string.regexp.js meta.group.regexp / punctuation.definition.group.regexp punctuation.definition.group.no-capture.regexp',
  'regexp-set': 'string.regexp.js / constant.other.character-class.set.regexp', 'regexp-bracket': 'string.regexp.js constant.other.character-class.set.regexp / punctuation.definition.character-class.regexp',
  'regexp-range': 'string.regexp.js constant.other.character-class.set.regexp / constant.other.character-class.range.regexp',
  'regexp-negation': 'string.regexp.js constant.other.character-class.set.regexp / keyword.operator.negation.regexp', 'regexp-reference': 'string.regexp.js / keyword.other.back-reference.regexp',
  'regexp-numeric': 'string.regexp.js / constant.character.numeric.regexp', 'regexp-control': 'string.regexp.js / constant.character.control.regexp',
  // numbers and the language's constants
  ...NAMES, hex: 'constant.numeric.hex.js', binary: 'constant.numeric.binary.js', octal: 'constant.numeric.octal.js', bigint: 'constant.numeric.decimal.js / storage.type.numeric.bigint.js',
  nan: 'constant.language.nan.js', infinity: 'constant.language.infinity.js', super: 'variable.language.super.js', arguments: 'variable.language.arguments.js',
  // keywords
  storage: 'meta.var.expr.js storage.type.js', 'storage-type': 'storage.type.js', function: 'storage.type.function.js', arrow: 'meta.arrow.js storage.type.function.arrow.js',
  class: 'storage.type.class.js', modifier: 'storage.modifier.js', async: 'storage.modifier.async.js', accessor: 'storage.type.property.js', star: 'keyword.generator.asterisk.js',
  flow: 'keyword.control.flow.js', conditional: 'keyword.control.conditional.js', loop: 'keyword.control.loop.js',
  switch: 'keyword.control.switch.js', trycatch: 'keyword.control.trycatch.js', with: 'keyword.control.with.js', debugger: 'keyword.other.debugger.js',
  import: 'keyword.control.import.js', export: 'keyword.control.export.js', from: 'keyword.control.from.js', as: 'keyword.control.as.js', default: 'keyword.control.default.js',
  all: 'constant.language.import-export-all.js',
  new: 'new.expr.js keyword.operator.new.js', 'dynamic-import': 'meta.function-call.js keyword.operator.expression.import.js', typeof: 'keyword.operator.expression.typeof.js', instanceof: 'keyword.operator.expression.instanceof.js',
  in: 'keyword.operator.expression.in.js', of: 'keyword.operator.expression.of.js', delete: 'keyword.operator.expression.delete.js', void: 'keyword.operator.expression.void.js',
  // operators
  arithmetic: 'keyword.operator.arithmetic.js', increment: 'keyword.operator.increment.js', decrement: 'keyword.operator.decrement.js',
  assignment: 'keyword.operator.assignment.js', compound: 'keyword.operator.assignment.compound.js', 'compound-bitwise': 'keyword.operator.assignment.compound.bitwise.js',
  comparison: 'keyword.operator.comparison.js', relational: 'keyword.operator.relational.js', logical: 'keyword.operator.logical.js',
  bitwise: 'keyword.operator.bitwise.js', shift: 'keyword.operator.bitwise.shift.js', ternary: 'keyword.operator.ternary.js',
  spread: 'keyword.operator.spread.js', rest: 'keyword.operator.rest.js',
  // punctuation: a member's dot, alone or in a call's name
  dot: 'punctuation.accessor.js', 'optional-dot': 'punctuation.accessor.optional.js',
  'call-dot': 'meta.function-call.js punctuation.accessor.js', 'call-optional-dot': 'meta.function-call.js punctuation.accessor.optional.js',
  comma: 'punctuation.separator.comma.js', 'parameter-comma': 'punctuation.separator.parameter.js', semicolon: 'punctuation.terminator.statement.js',
  'case-colon': 'punctuation.definition.section.case-statement.js', 'label-colon': 'punctuation.separator.label.js', 'pattern-colon': 'punctuation.destructuring.js',
  paren: 'meta.brace.round.js', 'parameters-begin': 'meta.parameters.js punctuation.definition.parameters.begin.js', 'parameters-end': 'meta.parameters.js punctuation.definition.parameters.end.js',
  bracket: 'meta.array.literal.js meta.brace.square.js', brace: 'punctuation.definition.block.js',
  'pattern-bracket': 'punctuation.definition.binding-pattern.array.js', 'pattern-brace': 'punctuation.definition.binding-pattern.object.js',
  // names: as they are read (above, NAMES), those the grammar knows; a call's name and the names before it
  name: '', 'constant-object-property': 'variable.other.constant.object.property.js',
  'support-property': 'support.variable.property.js', 'support-constant': 'support.constant.js', 'support-class': 'support.class.js', promise: 'support.class.promise.js',
  'call-constant-object': 'meta.function-call.js variable.other.constant.object.js', 'call-constant-object-property': 'meta.function-call.js variable.other.constant.object.property.js',
  'call-promise': 'meta.function-call.js support.class.promise.js',
  // names declared: a variable, a constant, either a function (`let f = () =>`), a parameter, a function's, a class's,
  // a method's, an import's
  definition: 'meta.var.expr.js meta.definition.variable.js variable.other.readwrite.js',
  'constant-definition': 'meta.var.expr.js meta.definition.variable.js variable.other.constant.js',
  'function-definition': 'meta.var.expr.js meta.definition.variable.js entity.name.function.js',
  'constant-function-definition': 'meta.var.expr.js meta.definition.variable.js variable.other.constant.js entity.name.function.js',
  'function-name': 'entity.name.function.js', tagged: 'entity.name.function.tagged-template.js', parameter: 'variable.parameter.js',
  'declared-function': 'meta.function.js meta.definition.function.js entity.name.function.js',
  'class-name': 'meta.class.js entity.name.type.class.js', 'inherited-class': 'meta.class.js entity.other.inherited-class.js',
  'method-name': 'meta.method.declaration.js meta.definition.method.js entity.name.function.js', 'field-name': 'meta.definition.property.js variable.object.property.js',
  'pattern-key': 'variable.object.property.js', type: 'entity.name.type.js', label: 'entity.name.label.js', alias: 'meta.import.js variable.other.readwrite.alias.js',
  // a name or a constant in a template's expression, in the string round it
  ...Object.fromEntries(Object.entries(NAMES).map(([w, s]) => [`embedded-${w}`, `${EMBEDDED} / ${s}`]))
}

// The parts, the words round other words (script.js marks them to go round those of their own range)
export const PARTS = new Set(['comment', 'block-comment', 'doc', 'doc-tag', 'doc-type', 'doc-name', 'string', 'double-string', 'template', 'interpolation', 'embedded', 'regexp', 'regexp-group', 'regexp-set', 'object-literal', 'member', 'key', 'block'])

// The semantic tokens a name can take, TypeScript's type of it and those of its modifiers VS Code can tell apart: a
// type of VS Code's legend for it (extensions/typescript-language-features semanticTokens.ts: TypeScript's `member` its
// `method`), `declaration` where it is declared, `readonly` a const's, `defaultLibrary` one TypeScript's own library
// declares. `local`, `async` and `static` are left out: no rule of VS Code's or of a theme it ships names them
export const MEANINGS = [
  'variable', 'variable.declaration', 'variable.readonly', 'variable.declaration.readonly', 'variable.defaultLibrary', 'variable.readonly.defaultLibrary',
  'function', 'function.declaration', 'function.readonly', 'function.declaration.readonly', 'function.defaultLibrary',
  'parameter', 'parameter.declaration', 'class', 'class.declaration', 'class.defaultLibrary', 'namespace.defaultLibrary',
  'property', 'property.declaration', 'property.defaultLibrary', 'property.readonly.defaultLibrary', 'method', 'method.declaration', 'method.defaultLibrary'
]

// The globals TypeScript's own library declares (lib.es2024.full.d.ts and those it references, lib.dom.d.ts among
// them), by the token it makes of a name of them (classifySymbol, reclassifyByType): a value with constructors a
// class, one only called a function, a namespace's a namespace, `name` a const; and what their members are: a
// global of statics (`Math.sin`, `Array.from`) methods, of an object (`document.body`) properties, of symbols
// (`Symbol.iterator`) read-only properties
export const LIBRARY = {}
for (const [kind, list] of Object.entries({
  'variable statics': 'console Math JSON Atomics BigInt', 'variable symbols': 'Symbol', 'variable.readonly objects': 'name',
  'variable objects': 'document window navigator location performance crypto self localStorage sessionStorage status length event origin top parent frames opener history screen closed devicePixelRatio innerWidth innerHeight caches indexedDB customElements visualViewport',
  'class statics': 'AbortController AbortSignal Array ArrayBuffer Audio AudioBuffer AudioContext AudioWorkletNode BigInt64Array BigUint64Array Blob Boolean BroadcastChannel CustomEvent DataView Date Error EvalError Event EventTarget File FileReader Float32Array Float64Array FormData Function Headers Image ImageData Int8Array Int16Array Int32Array IntersectionObserver KeyboardEvent Map MediaRecorder MediaStream MessageChannel MouseEvent MutationObserver Notification Number Object OfflineAudioContext OffscreenCanvas Option Path2D PointerEvent Promise Proxy RangeError ReferenceError RegExp Request ResizeObserver Response Set SharedArrayBuffer String SyntaxError TextDecoder TextEncoder TypeError URIError URL URLSearchParams Uint8Array Uint8ClampedArray Uint16Array Uint32Array WeakMap WeakRef WeakSet WebSocket Worker XMLHttpRequest',
  function: 'setTimeout clearTimeout setInterval clearInterval requestAnimationFrame cancelAnimationFrame queueMicrotask structuredClone fetch parseInt parseFloat isNaN isFinite encodeURIComponent decodeURIComponent encodeURI decodeURI atob btoa alert confirm prompt open close stop focus blur print scroll scrollTo postMessage getComputedStyle matchMedia reportError addEventListener createImageBitmap',
  namespace: 'Reflect Intl WebAssembly CSS'
})) for (const n of list.split(' ')) LIBRARY[n] = kind.split(' ')

// Each keyword the grammar names on its own
const KEYWORDS = {
  let: 'storage', const: 'storage', var: 'storage', using: 'storage', function: 'function', class: 'class', extends: 'modifier', static: 'modifier', async: 'async',
  return: 'flow', await: 'flow', yield: 'flow', if: 'conditional', else: 'conditional', for: 'loop', while: 'loop', do: 'loop', break: 'loop', continue: 'loop',
  switch: 'switch', case: 'switch', default: 'default', try: 'trycatch', catch: 'trycatch', finally: 'trycatch', throw: 'trycatch', with: 'with', debugger: 'debugger',
  import: 'import', export: 'export', from: 'from', as: 'as', new: 'new', typeof: 'typeof', instanceof: 'instanceof', in: 'in', of: 'of', delete: 'delete', void: 'void', get: 'accessor', set: 'accessor'
}
const FUNCTION = /^(ArrowFunction|FunctionExpression)$/, NAME = /^\s*\??\.\s*#?[_$\p{L}]/u, CAPS = /^[A-Z][_$0-9A-Z]*$/
const same = (a, b) => a && b && a.from === b.from && a.to === b.to && a.name === b.name

// The words of a script (`text`, its syntax tree `tree`), in order, each [from, to, word, meaning?]: a part before the
// words inside it, `word` a key of WORDS, `meaning` one of MEANINGS
export default function words(tree, text) {
  const out = [], names = declarations(tree, text)
  let embedded = 0
  const put = (from, to, word, meaning) => {
    if (embedded && NAMES[word]) word = `embedded-${word}`
    if (to > from) out.push(meaning ? [from, to, word, meaning] : [from, to, word])
  }
  const slice = n => text.slice(n.from, n.to)
  const each = (node, f) => { for (let c = node.firstChild; c; c = c.nextSibling) f(c) }
  // what follows a place on its line; whether two places are on one line
  const ahead = at => { const end = text.indexOf('\n', at); return text.slice(at, end < 0 ? text.length : end) }
  const oneLine = (a, b) => !text.slice(a, b).includes('\n')

  // The call `node` names, as the grammar's function-call reads one: a call's callee, or a `new`'s with arguments,
  // its `(` on the line after only spaces or `?.`
  const callOf = node => {
    const p = node.parent, args = p?.getChild('ArgList')
    const callee = p?.name === 'CallExpression' ? same(p.firstChild, node) : p?.name === 'NewExpression' && node.prevSibling?.name === 'new'
    return callee && args && oneLine(node.to, args.from) && /^\s*(\?\.\s*)?$/.test(text.slice(node.to, args.from)) ? p : null
  }
  // a member's object and the member, the dot between: `a` and `a.b`
  const objectOf = node => node.parent?.name === 'MemberExpression' && same(node.parent.firstChild, node) && !node.parent.getChild('[') ? node.parent : null
  // The names joined by dots a call is made of, from the first, all on one line (`a.b.c(`): the callee, or null
  function chain(node) {
    let m = node
    while (objectOf(m)) m = objectOf(m)
    if (!callOf(m)) return null
    let head = m
    while (head.name === 'MemberExpression' && !head.getChild('[')) head = head.firstChild
    return /^(VariableName|this|super)$/.test(head.name) && oneLine(head.from, m.to) ? m : null
  }

  function walk(node) {
    const { name } = node, p = node.parent?.name
    switch (name) {
      case 'LineComment': put(node.from, node.to, 'comment'); return put(node.from, node.from + 2, 'comment-mark')
      case 'BlockComment': {
        const s = slice(node), kind = /^\/\*\*(?!\/)/.test(s) ? 'doc' : 'block-comment'
        put(node.from, node.to, kind); put(node.from, node.from + (kind === 'doc' ? 3 : 2), `${kind}-mark`)
        if (kind === 'doc') doc(node.from, s)
        return s.length > 3 && s.endsWith('*/') && put(node.to - 2, node.to, `${kind}-mark`)
      }
      case 'String': {
        const q = text[node.from]
        put(node.from, node.to, q === '"' ? 'double-string' : 'string'); put(node.from, node.from + 1, 'quote-begin')
        each(node, c => c.name === 'Escape' && put(c.from, c.to, 'escape'))
        return node.to - node.from > 1 && text[node.to - 1] === q && put(node.to - 1, node.to, 'quote-end')
      }
      case 'TemplateString': {
        put(node.from, node.to, 'template'); put(node.from, node.from + 1, 'template-begin')
        each(node, c => {
          if (c.name === 'Escape') return put(c.from, c.to, 'escape')
          if (c.name !== 'Interpolation') return
          const start = c.getChild('InterpolationStart'), end = c.getChild('InterpolationEnd')
          put(c.from, c.to, 'interpolation')
          start && put(start.from, start.to, 'interpolation-begin')
          put(start?.to ?? c.from, end?.from ?? c.to, 'embedded')
          embedded++
          each(c, e => e.name !== 'InterpolationStart' && e.name !== 'InterpolationEnd' && walk(e))
          embedded--
          end && put(end.from, end.to, 'interpolation-end')
        })
        return node.to - node.from > 1 && text[node.to - 1] === '`' && put(node.to - 1, node.to, 'template-end')
      }
      case 'RegExp': return regexp(node.from, slice(node))
      case 'Number': {
        const s = slice(node)
        put(node.from, node.to, /^0[xX]/.test(s) ? 'hex' : /^0[bB]/.test(s) ? 'binary' : /^0[oO]/.test(s) ? 'octal' : 'number')
        return s.endsWith('n') && put(node.to - 1, node.to, 'bigint')
      }
      case 'BooleanLiteral': return put(node.from, node.to, slice(node))
      case 'null': case 'this': case 'super': return put(node.from, node.to, name)
      case 'VariableName': return reference(node)
      case 'VariableDefinition': return definition(node)
      case 'PropertyName': case 'PrivatePropertyName': return member(node)
      case 'PropertyDefinition': case 'PrivatePropertyDefinition': return key(node)
      case 'Label': return put(node.from, node.to, 'label')
      case 'ObjectExpression': put(node.from, node.to, 'object-literal'); break
      case 'Property': {
        if (node.getChild('ParamList')) break
        const colon = node.getChild(':')
        put(node.from, node.to, 'member')
        if (colon) { put(node.from, colon.to, 'key'); put(colon.from, colon.to, 'key-colon') }
        break
      }
      // a block, and an import's or an export's names in braces, as the grammar takes them for one
      case 'Block': case 'ImportGroup': case 'ExportGroup': put(node.from, node.to, 'block'); break
      case 'ArithOp': return put(node.from, node.to, { '++': 'increment', '--': 'decrement' }[slice(node)] ?? 'arithmetic')
      case 'LogicOp': return put(node.from, node.to, /^[?:]$/.test(slice(node)) ? 'ternary' : 'logical')
      case 'BitOp': return put(node.from, node.to, /^[<>]/.test(slice(node)) ? 'shift' : 'bitwise')
      case 'CompareOp': return put(node.from, node.to, /^[<>]/.test(slice(node)) ? 'relational' : 'comparison')
      case 'Equals': return put(node.from, node.to, 'assignment')
      // `a ??= b` as the grammar reads it: `??`, then `=`
      case 'UpdateOp': {
        const s = slice(node)
        return /^(&&|\|\||\?\?)=$/.test(s) ? (put(node.from, node.to - 1, 'logical'), put(node.to - 1, node.to, 'assignment')) : put(node.from, node.to, /^[&|^<>]/.test(s) ? 'compound-bitwise' : 'compound')
      }
      case 'Spread': return put(node.from, node.to, p === 'ParamList' || /Pattern/.test(p) ? 'rest' : 'spread')
      case 'Arrow': return put(node.from, node.to, 'arrow')
      case 'Star': return put(node.from, node.to, p === 'ImportDeclaration' || p === 'ExportDeclaration' ? 'all' : 'star')
      // a member's dot is its member's (member); a call's own, `f?.()`, the call's
      case '.': case '?.': return p !== 'MemberExpression' && put(node.from, node.to, p === 'CallExpression' ? `call-${name === '.' ? 'dot' : 'optional-dot'}` : name === '.' ? 'dot' : 'optional-dot')
      case ',': return put(node.from, node.to, p === 'ParamList' ? 'parameter-comma' : 'comma')
      case ';': return put(node.from, node.to, 'semicolon')
      case ':': return p !== 'Property' && put(node.from, node.to, p === 'CaseLabel' || p === 'DefaultLabel' ? 'case-colon' : p === 'LabeledStatement' ? 'label-colon' : p === 'PatternProperty' ? 'pattern-colon' : 'ternary')
      case '(': case ')': return put(node.from, node.to, p === 'ParamList' ? name === '(' ? 'parameters-begin' : 'parameters-end' : 'paren')
      case '[': case ']': return put(node.from, node.to, p === 'ArrayPattern' ? 'pattern-bracket' : 'bracket')
      case '{': case '}': return put(node.from, node.to, p === 'ObjectPattern' ? 'pattern-brace' : 'brace')
      default:
        if (KEYWORDS[name] && !node.firstChild) return put(node.from, node.to, name === 'default' && (p === 'SwitchBody' || p === 'DefaultLabel') ? 'switch' : name === 'import' && p === 'DynamicImport' ? 'dynamic-import' : KEYWORDS[name])
    }
    each(node, walk)
  }

  // A name read: one the grammar knows by its name, else as it stands (a call's, a member's object, a capital's), and
  // the token TypeScript makes of what it names
  function reference(node) {
    const s = slice(node), p = node.parent, meaning = known(node, s), rest = ahead(node.to)
    if (s === 'undefined' || s === 'NaN' || s === 'Infinity' || s === 'arguments') return put(node.from, node.to, s === 'NaN' ? 'nan' : s.toLowerCase())
    const word = p?.name === 'TaggedTemplateExpression' ? 'tagged' : /^Class(Declaration|Expression)$/.test(p?.name) ? 'inherited-class'
      : p?.name === 'ExportGroup' ? 'alias'
      : p?.name === 'BinaryExpression' && node.prevSibling?.name === 'instanceof' ? 'type'
      : /^\s*\??\.\s*prototype\b(?!\$)/.test(rest) ? 'support-class'
      : chain(node) ? callOf(node) ? 'call' : s === 'Promise' ? 'call-promise' : CAPS.test(s) ? 'call-constant-object' : 'call-object'
      : s === 'Promise' ? 'promise'
      : assigned(node) ? 'function-name'
      : NAME.test(rest) ? CAPS.test(s) ? 'constant-object' : 'object' : CAPS.test(s) ? 'constant' : 'variable'
    put(node.from, node.to, word, meaning)
  }
  // `a = () =>`, `a.b = function`, on one line: the grammar's function name
  const assigned = node => { const eq = node.nextSibling, v = eq?.name === 'Equals' && eq.nextSibling; return node.parent?.name === 'AssignmentExpression' && !!v && FUNCTION.test(v.name) && oneLine(node.from, v.from) }

  // A member, `.name`: a call's name or one of the names before it, else as the grammar knows it or as it stands
  function member(node) {
    const m = node.parent, s = slice(node), dot = node.prevSibling, rest = ahead(node.to)
    if (m?.name !== 'MemberExpression') return put(node.from, node.to, m?.name === 'PatternProperty' ? 'pattern-key' : 'property')
    const meaning = library(m, s), head = chain(m), call = !!head || !!callOf(m)
    if (dot?.name === '.' || dot?.name === '?.') put(dot.from, dot.to, `${call ? 'call-' : ''}${dot.name === '.' ? 'dot' : 'optional-dot'}`)
    const word = call ? head && !same(head, m) ? CAPS.test(s) ? 'call-constant-object-property' : 'call-object-property' : 'call'
      : /^(constructor|length|prototype|__proto__)$/.test(s) && !/^\s*\(/.test(rest) ? 'support-property'
      : /^(EPSILON|MAX_SAFE_INTEGER|MAX_VALUE|MIN_SAFE_INTEGER|MIN_VALUE|NEGATIVE_INFINITY|POSITIVE_INFINITY)$/.test(s) ? 'support-constant'
      : assigned(m) ? 'function-name'
      : NAME.test(rest) ? CAPS.test(s) ? 'constant-object-property' : 'object-property' : CAPS.test(s) ? 'constant-property' : 'property'
    put(node.from, node.to, word, meaning)
  }

  // A name declared, by what declares it
  function definition(node) {
    const p = node.parent, d = names.at(node.from), meaning = d && token(d, node, true)
    if (p?.name === 'ParamList' || params(node)) return put(node.from, node.to, 'parameter', meaning)
    if (/^Function(Declaration|Expression)$/.test(p?.name)) return put(node.from, node.to, 'declared-function', meaning)
    if (/^Class(Declaration|Expression)$/.test(p?.name)) return put(node.from, node.to, 'class-name', meaning)
    if (d?.kind === 'import') return put(node.from, node.to, 'alias')
    if (p?.name === 'CatchClause') return put(node.from, node.to, 'variable', meaning)
    // one alone in its declaration a function where it is given one, a capital's a constant
    const alone = p?.name === 'VariableDeclaration', fn = alone && d?.named
    put(node.from, node.to, d?.kind === 'const' ? fn ? 'constant-function-definition' : 'constant-definition' : fn ? 'function-definition' : alone && CAPS.test(slice(node)) ? 'constant-definition' : 'definition', meaning)
  }
  const params = node => { for (let p = node.parent; p; p = p.parent) { if (p.name === 'ParamList') return true; if (!/Pattern/.test(p.name)) return false } return false }

  // An object's key, its part's (Property): a method's name or a function's (`k: () =>`), else nothing of its own; a
  // shorthand's a variable; a class's method or field
  function key(node) {
    const p = node.parent, colon = p?.getChild(':')
    // a constructor's `constructor` the grammar's keyword, and no name of TypeScript's
    if (p?.name === 'MethodDeclaration') return slice(node) === 'constructor' ? put(node.from, node.to, 'storage-type') : put(node.from, node.to, 'method-name', 'method.declaration')
    if (p?.name === 'PropertyDeclaration') return put(node.from, node.to, 'field-name', 'property.declaration')
    if (p?.getChild('ParamList')) return put(node.from, node.to, 'method-name', 'method.declaration')
    if (!colon) return put(node.from, node.to, 'variable', isFunction(node) ? 'method.declaration' : 'property.declaration')
    const v = unwrap(colon.nextSibling), fn = FUNCTION.test(colon.nextSibling?.name ?? '')
    put(node.from, node.to, fn ? 'function-name' : 'name', FUNCTION.test(v?.name ?? '') || isFunction(v) ? 'method.declaration' : 'property.declaration')
  }
  // a name that names a function declared (TypeScript's type of it a function's)
  const isFunction = v => { const d = v?.name === 'VariableName' || v?.name === 'PropertyDefinition' ? names.find(slice(v), v.from) : null; return d?.kind === 'function' || d?.init === 'function' }

  // TypeScript's token for a name read (classifier2020.ts collectTokens): what it names, a variable or a parameter
  // called (`f()`) or holding a function a function, one holding a class a class; a global its library's
  function known(node, s) {
    const d = names.find(s, node.from)
    if (d) return token(d, node, false)
    const [type] = LIBRARY[s] ?? []
    return type ? `${type.startsWith('variable') && called(node) ? 'function' : type}.defaultLibrary` : null
  }
  // A library global's member, or a member of what a name holds where TypeScript infers it from what the name is given
  // (literal): one called a method, a namespace's a class (a capital's) or a function; else a constant's (capitals,
  // `prototype`) read-only, the rest by its global; NaN and Infinity none, as TypeScript gives none
  function library(m, s) {
    const object = m.firstChild, o = object?.name === 'VariableName' && slice(object), d = o && names.find(o, object.from)
    if (d) return literal(d, m, s)
    const [type, members] = LIBRARY[o] ?? []
    if (!type || s === 'NaN' || s === 'Infinity') return null
    if (type === 'namespace') return /^[A-Z]/.test(s) ? 'class.defaultLibrary' : 'function.defaultLibrary'
    // one called, or an object's handler (`onmessage`, a function's property), a method (reclassifyByType)
    if (called(m.lastChild) || members === 'objects' && /^on[a-z]/.test(s)) return 'method.defaultLibrary'
    return members === 'symbols' || CAPS.test(s) || s === 'prototype' ? 'property.readonly.defaultLibrary' : members === 'statics' ? 'method.defaultLibrary' : 'property.defaultLibrary'
  }

  // A member of what a declared name holds, as TypeScript infers its type from what it is given: a library class's
  // instance's (`new Audio()`: its handlers and calls methods, the rest properties), a string's, a number's, a
  // boolean's, an array's (their length a property, a string's read-only; the rest methods), an object literal's (its
  // keys properties, or methods where they hold functions; Object's methods the library's); none for the rest
  function literal(d, m, s) {
    const fn = called(m.lastChild)
    if (d.init === 'new') return !names.find(d.made, d.at) && LIBRARY[d.made]?.[0] === 'class' ? fn || /^on[a-z]/.test(s) ? 'method.defaultLibrary' : 'property.defaultLibrary' : null
    if (/^(string|number|boolean|array)$/.test(d.init)) return s === 'length' && /^(string|array)$/.test(d.init) ? d.init === 'string' ? 'property.readonly.defaultLibrary' : 'property.defaultLibrary' : 'method.defaultLibrary'
    if (d.init !== 'object') return null
    for (const [k, v] of d.keys) if (slice(k) === s) return v === 'function' || fn ? 'method' : 'property'
    return /^(toString|toLocaleString|valueOf|hasOwnProperty|isPrototypeOf|propertyIsEnumerable)$/.test(s) ? 'method.defaultLibrary' : s === 'constructor' ? 'property.defaultLibrary' : null
  }

  // A doc comment's tags as the grammar's docblock reads them: `@tag`, the `{type}` after it, and a parameter's name
  // after that (`@param {number} db`, `[opts]` one optional); the rest the comment's own
  function doc(at, s) {
    for (const m of s.matchAll(/@([a-zA-Z]+)(?:(\s*)(\{[^{}\n]*\}))?(?:(\s*)(\[?)([_$\p{L}][_$\p{L}\p{N}.]*)(\]?))?/gu)) {
      const [, tag, gap = '', type, gap2 = '', open, name, close] = m, from = at + m.index
      put(from, from + 1 + tag.length, 'doc-tag'); put(from, from + 1, 'doc-at')
      let i = from + 1 + tag.length + gap.length
      if (type) { put(i, i + type.length, 'doc-type'); put(i, i + 1, 'doc-type-begin'); put(i + type.length - 1, i + type.length, 'doc-type-end'); i += type.length + gap2.length }
      if (name && /^(param|arg|argument|prop|property)$/.test(tag) && gap2) {
        const end = i + open.length + name.length + close.length
        put(i, end, 'doc-name')
        if (open && close) { put(i, i + 1, 'doc-optional-begin'); put(end - 1, end, 'doc-optional-end') }
      }
    }
  }

  // A regular expression's parts as the grammar's regexp patterns read them: its slashes and flags, escapes, classes,
  // quantifiers, anchors, alternatives, groups and sets
  function regexp(at, s) {
    const end = s.lastIndexOf('/')
    put(at, at + s.length, 'regexp'); put(at, at + 1, 'regexp-begin')
    for (let i = 1; i < end;) {
      const c = s[i], from = at + i, tail = s.slice(i, end)
      let m = c
      if (c === '\\') {
        m = ESCAPE.exec(tail)[0]
        put(from, from + m.length, /^\\[bB]$/.test(m) ? 'regexp-anchor' : /^\\[1-9]/.test(m) ? 'regexp-reference' : escaped(m))
      } else if (c === '[') {
        const close = setEnd(s, i, end)
        put(from, at + close + 1, 'regexp-set'); put(from, from + 1, 'regexp-bracket')
        let j = i + 1
        if (s[j] === '^') put(at + j, at + ++j, 'regexp-negation')
        while (j < close) {
          const r = /^(?:\\.|[^\\\]])-(?:\\.|[^\\\]])/.exec(s.slice(j, close))?.[0], e = s[j] === '\\' && ESCAPE.exec(s.slice(j, close))[0]
          if (r) put(at + j, at + j + r.length, 'regexp-range')
          else if (e) put(at + j, at + j + e.length, escaped(e))
          j += (r || e || ' ').length
        }
        if (close < end) put(at + close, at + close + 1, 'regexp-bracket')
        m = s.slice(i, close + 1)
      } else if (c === '(') {
        put(from, at + groupEnd(s, i, end) + 1, 'regexp-group'); put(from, from + 1, 'regexp-paren')
        m = /^\(\?(?::|=|!|<=|<!)/.exec(tail)?.[0] ?? '('
        if (m.length > 1) put(from + 1, from + m.length, 'regexp-no-capture')
      } else if (c === ')') put(from, from + 1, 'regexp-paren')
      else if (c === '|') put(from, from + 1, 'regexp-or')
      else if (c === '^' || c === '$') put(from, from + 1, 'regexp-anchor')
      else if (c === '.') put(from, from + 1, 'regexp-class')
      else if (/^(?:[*+?]|\{\d+(?:,\d*)?\})/.test(tail)) { m = /^(?:[*+?]|\{\d+(?:,\d*)?\})\??/.exec(tail)[0]; put(from, from + m.length, 'regexp-quantifier') }
      i += m.length
    }
    if (end > 0) { put(at + end, at + end + 1, 'regexp-end'); put(at + end + 1, at + s.length, 'regexp-flags') }
  }

  walk(tree.topNode)
  return out.sort((a, b) => a[0] - b[0] || b[1] - a[1] || PARTS.has(b[2]) - PARTS.has(a[2]))
}
// a regular expression's escape, and what the grammar's regex-character-class makes of it: a class (`\w`, `\n`), a
// character by its number or a control's, else the character escaped
const ESCAPE = /^\\(?:[1-9]\d*|[0-7]{3}|x[\da-fA-F]{2}|u[\da-fA-F]{4}|c[A-Z]|.)/s
const escaped = m => /^\\[wWsSdDtrnvf]$/.test(m) ? 'regexp-class' : /^\\([0-7]{3}|x|u)/.test(m) ? 'regexp-numeric' : /^\\c[A-Z]$/.test(m) ? 'regexp-control' : 'regexp-escape'
// a regular expression's set's `]`, and its group's `)`, from their opening
const setEnd = (s, i, end) => { for (let j = i + 1; j < end; j++) { if (s[j] === '\\') j++; else if (s[j] === ']') return j } return end - 1 }
const groupEnd = (s, i, end) => { let depth = 0; for (let j = i; j < end; j++) { if (s[j] === '\\') j++; else if (s[j] === '[') j = setEnd(s, j, end); else if (s[j] === '(') depth++; else if (s[j] === ')' && !--depth) return j } return end - 1 }
// the expression past the parentheses round it
const unwrap = v => { while (v?.name === 'ParenthesizedExpression') v = v.firstChild?.nextSibling; return v }
// a name called, as TypeScript's isExpressionInCallExpression has it: a call's callee, past the names before it
const called = node => { let n = node; while (n.parent?.name === 'MemberExpression' && same(n.parent.lastChild, n)) n = n.parent; return n.parent?.name === 'CallExpression' && same(n.parent.firstChild, n) }

// The names a script declares, each in the scope it is declared in, as TypeScript binds them: `let`, `const` and a
// class in their block, `var` and a function's name in their function, a parameter in its function, a catch's in its
// clause, an import in the script. find(name, at): the declaration a name read at `at` names, the innermost round it;
// at(pos): the one declared there. A declaration { kind, type, init, named, made, keys }: `kind` let, const, var,
// param, function, class, catch or import; `type` the token TypeScript makes of it; `init` what it is given, as
// TypeScript infers its type (init), `made` the class a `new` makes, `keys` an object literal's; `named` the grammar's
// function name (`let f = () =>`)
function declarations(tree, text) {
  const named = new Map(), by = new Map()
  const scope = (node, block) => {
    for (let p = node.parent; p; p = p.parent) {
      if (/^(FunctionDeclaration|FunctionExpression|ArrowFunction|MethodDeclaration|Script)$/.test(p.name)) return p.name === 'Script' || !block ? p : p.getChild('Block') ?? p
      if (block && /^(Block|ForStatement|SwitchBody|ClassBody|CatchClause)$/.test(p.name)) return p
    }
    return null
  }
  tree.iterate({ enter: ref => {
    if (ref.name !== 'VariableDefinition') return
    const node = ref.node
    let p = node.parent, d = null
    while (p && /Pattern/.test(p.name)) p = p.parent
    if (!p) return
    if (/^(VariableDeclaration|ForOfSpec|ForInSpec)$/.test(p.name)) {
      const kind = p.getChild('const') || p.getChild('using') ? 'const' : p.getChild('var') ? 'var' : 'let'
      const v = node.parent === p || same(node.parent, p) ? node.nextSibling?.name === 'Equals' && unwrap(node.nextSibling.nextSibling) : null
      const made = v?.name === 'NewExpression' && v.getChild('VariableName')
      // a for-of's over an array of one kind of literal, that kind
      const items = p.name === 'ForOfSpec' && unwrap(p.getChild('of')?.nextSibling), item = items?.name === 'ArrayExpression' ? literals(items) : null
      d = { kind, type: 'variable', init: v ? init(v) : item, scope: scope(p, kind !== 'var'), made: made && text.slice(made.from, made.to), at: made?.from, keys: v?.name === 'ObjectExpression' ? keysOf(v) : null }
      // the grammar's function name: a function or an arrow given at once, on the name's line
      d.named = !!v && FUNCTION.test(node.nextSibling.nextSibling.name) && !text.slice(node.from, v.from).includes('\n')
    }
    else if (p.name === 'ParamList') d = { kind: 'param', type: 'parameter', scope: p.parent }
    else if (p.name === 'FunctionDeclaration') d = { kind: 'function', type: 'function', scope: scope(p, true) }
    else if (p.name === 'FunctionExpression') d = { kind: 'function', type: 'function', scope: p }
    else if (p.name === 'ClassDeclaration') d = { kind: 'class', type: 'class', scope: scope(p, true) }
    else if (p.name === 'ClassExpression') d = { kind: 'class', type: 'class', scope: p }
    else if (p.name === 'CatchClause') d = { kind: 'catch', type: 'variable', scope: p }
    else if (/^Import(Declaration|Group)$/.test(p.name)) d = { kind: 'import', type: null, scope: tree.topNode }
    if (!d?.scope) return
    d = { ...d, name: text.slice(node.from, node.to), from: d.scope.from, to: d.scope.to }
    named.set(d.name, [...named.get(d.name) ?? [], d])
    by.set(node.from, d)
  } })
  return {
    at: pos => by.get(pos) ?? null,
    find(name, at) {
      let best = null
      for (const d of named.get(name) ?? []) if (d.from <= at && at <= d.to && (!best || d.to - d.from < best.to - best.from)) best = d
      return best
    }
  }
}

// What a name is given, as TypeScript infers its type from it: a function (a conditional's of two functions too), a
// class, a library class's instance (`new Audio()`), a string, a number, a boolean, an array, an object; else none
function init(v) {
  if (v.name === 'ConditionalExpression') { const [, a, b] = [...children(v)].filter(c => c.name !== 'LogicOp').map(unwrap); return a && b && FUNCTION.test(a.name) && FUNCTION.test(b.name) ? 'function' : null }
  if (v.name === 'UnaryExpression' && v.lastChild?.name === 'Number') return 'number'
  return FUNCTION.test(v.name) ? 'function' : { ClassExpression: 'class', NewExpression: 'new', String: 'string', TemplateString: 'string', Number: 'number', BooleanLiteral: 'boolean', ArrayExpression: 'array', ObjectExpression: 'object' }[v.name] ?? null
}
const children = function* (n) { for (let c = n.firstChild; c; c = c.nextSibling) yield c }
// the kind of literal an array holds, where all of it is one kind; an object literal's keys, a function's 'function'
const literals = a => { const kinds = new Set([...children(a)].filter(c => !/^[[\],]$/.test(c.name)).map(init)); return kinds.size === 1 && !kinds.has(null) ? [...kinds][0] : null }
const keysOf = o => new Map([...children(o)].filter(c => c.name === 'Property').map(c => [c.firstChild, c.getChild(':')?.nextSibling ?? c.getChild('ParamList')]).filter(([k]) => k?.name === 'PropertyDefinition').map(([k, v]) => [k, v && (v.name === 'ParamList' || FUNCTION.test(unwrap(v)?.name)) ? 'function' : null]))

// TypeScript's token of a declared name, where it is declared or read (classifier2020.ts): its type, a variable or a
// parameter holding a function, or called, a function, one holding a class a class (reclassifyByType); `declaration`
// where it is declared, `readonly` a const's but a class's; an import's none, as TypeScript gives none for a module it
// cannot find
function token(d, node, declared) {
  if (!d.type) return null
  let type = d.type
  if ((type === 'variable' || type === 'parameter') && (d.init === 'function' || !declared && called(node))) type = 'function'
  else if (type === 'variable' && d.init === 'class') type = 'class'
  return [type, declared && 'declaration', d.kind === 'const' && type !== 'class' && 'readonly'].filter(Boolean).join('.')
}
