// The script as a syntax tree: what to run, where the output chain is, which call the caret is in,
// and the edits that the view and the sliders make to the text.
import { parser } from '../assets/codemirror.js'
import { methods } from './ops.js'

let cached = { code: null, tree: null }
const parse = code => cached.code === code ? cached.tree : (cached = { code, tree: parser.parse(code) }).tree

const children = node => { const out = []; for (let c = node.firstChild; c; c = c.nextSibling) out.push(c); return out }
const text = (code, node) => code.slice(node.from, node.to)
const quiet = node => node.name === 'LineComment' || node.name === 'BlockComment'
const statements = tree => children(tree.topNode).filter(n => !quiet(n) && n.name !== ';')
const unquote = s => { try { return s[0] === '`' ? s.slice(1, -1) : JSON.parse(s[0] === "'" ? '"' + s.slice(1, -1).replace(/\\'/g, "'").replace(/"/g, '\\"') + '"' : s) } catch { return s.slice(1, -1) } }

// The first syntax error: { from, to } or null.
export function error(code) {
  let found = null
  parse(code).iterate({ enter: node => { if (!found && node.type.isError) found = { from: node.from, to: Math.max(node.to, node.from + 1) } } })
  return found
}

// The script as a function body: imports become dynamic (`audio` is given), each loop checks its time,
// and the last expression, or the last declared name, is returned. Lines keep their numbers.
export function prepare(code) {
  const tree = parse(code), edits = [], names = new Set()
  const at = (pos, insert, to = pos) => edits.push({ from: pos, to, insert })
  tree.iterate({
    enter: ref => {
      const node = ref.node
      if (node.name === 'ImportDeclaration') {
        const spec = node.getChild('String'), from = spec && unquote(text(code, spec))
        const clause = code.slice(node.from + 6, spec ? spec.from : node.to).replace(/\bfrom\s*$/, '').trim()
        if (!spec || /^(audio|https:\/\/esm\.sh\/audio(@[\w.-]+)?)$/.test(from)) at(node.from, blank(text(code, node)), node.to)
        else at(node.from, clause ? importing(clause, text(code, spec)) : `await import(${text(code, spec)})`, node.to)
        return false
      }
      if (node.name === 'ForStatement' || node.name === 'WhileStatement' || node.name === 'DoStatement') {
        const body = node.name === 'DoStatement' ? children(node).find(c => c.name !== 'do' && !quiet(c)) : node.lastChild
        if (body?.name === 'Block') at(body.from + 1, '__loop();')
        else if (body) { at(body.from, '{__loop();'); at(body.to, '}') }
      }
      if (node.name === 'CallExpression' && isAudio(code, node)) for (const s of sourcesOf(node)) names.add(unquote(text(code, s)))
    }
  })
  const last = statements(tree).at(-1)
  if (last?.name === 'ExpressionStatement') {
    const expr = last.firstChild
    at(expr.from, 'return __out(')
    at(expr.to, ')')
  } else if (last?.name === 'VariableDeclaration') {
    const name = last.getChildren('VariableDefinition').at(-1)
    if (name) at(last.to, `;return __out(${text(code, name)})`)
  }
  return { code: apply(code, edits), names: [...names] }
}
const blank = s => s.replace(/[^\n]/g, ' ')
function importing(clause, spec) {
  const parts = clause.match(/^(?:([\w$]+)\s*,?\s*)?(?:\*\s*as\s+([\w$]+)|\{([^}]*)\})?$/)
  if (!parts) return `await import(${spec})`
  const [, def, ns, named] = parts, out = []
  if (ns) out.push(`const ${ns} = await import(${spec})`)
  if (def || named) out.push(`const { ${[def && `default: ${def}`, ...(named?.split(',').map(s => s.trim()).filter(Boolean).map(s => s.replace(/\s+as\s+/, ': ')) || [])].filter(Boolean).join(', ')} } = await import(${spec})`)
  return out.join('; ')
}
const apply = (code, edits) => edits.sort((a, b) => b.from - a.from || b.to - a.to).reduce((s, e) => s.slice(0, e.from) + e.insert + s.slice(e.to), code)

// `audio(...)` itself: its callee is the name audio.
const isAudio = (code, call) => { const callee = call.firstChild; return callee?.name === 'VariableName' && text(code, callee) === 'audio' }
// String sources passed to audio(): 'a.wav' or ['a.wav', 'b.wav'].
function sourcesOf(call) {
  const args = children(call.getChild('ArgList')).filter(n => n.name !== '(' && n.name !== ')' && n.name !== ',')
  const first = args[0]
  if (first?.name === 'String') return [first]
  if (first?.name === 'ArrayExpression') return first.getChildren('String')
  return []
}

// An option by its name, FFmpeg's short ones (`d`, `xfade`) as the library reads them: what the page reads from a call
// says `duration` and `crossfade` however it is written; what it writes is short
const LONG = { d: 'duration', xfade: 'crossfade' }, SHORT = { duration: 'd', crossfade: 'xfade' }
const canon = key => LONG[key] ?? key
// A call's arguments with their places in the text and, for literals, their values.
function args(code, list) {
  return children(list).filter(n => !['(', ')', ','].includes(n.name) && !quiet(n)).map(node => {
    const arg = { from: node.from, to: node.to, kind: 'other' }
    const value = literal(code, node)
    if (value !== undefined) Object.assign(arg, { kind: Array.isArray(value) ? 'array' : typeof value, value })
    if (node.name === 'ObjectExpression') Object.assign(arg, { kind: 'object', props: node.getChildren('Property').map(prop => {
      const key = prop.getChild('PropertyDefinition') || prop.firstChild, val = prop.lastChild
      const v = val && val !== key ? literal(code, val) : undefined
      return { name: key && canon(text(code, key).replace(/^['"]|['"]$/g, '')), from: prop.from, to: prop.to, valueFrom: val?.from, valueTo: val?.to, kind: v === undefined ? 'other' : Array.isArray(v) ? 'array' : typeof v, value: v }
    }) })
    return arg
  })
}
// A literal's value: numbers (with a sign), strings, booleans, arrays of numbers or of such arrays, ranges ({ at, duration })
// and arrays of them; undefined for expressions.
function literal(code, node) {
  const t = text(code, node)
  if (node.name === 'Number') return +t.replace(/_/g, '')
  if (node.name === 'UnaryExpression' && /^[-+]\s*[\d.]/.test(t) && node.lastChild?.name === 'Number') return +t.replace(/\s|_/g, '')
  if (node.name === 'String') return unquote(t)
  if (node.name === 'BooleanLiteral') return t === 'true'
  if (node.name === 'ArrayExpression') {
    const items = children(node).filter(n => !['[', ']', ','].includes(n.name)).map(n => literal(code, n))
    return items.every(v => typeof v === 'number' || Array.isArray(v) || isRange(v)) ? items : undefined
  }
  if (node.name === 'ObjectExpression') {
    const value = Object.fromEntries(node.getChildren('Property').map(p => [canon(text(code, p.firstChild)), p.lastChild !== p.firstChild ? literal(code, p.lastChild) : undefined]))
    return isRange(value) ? value : undefined
  }
}
const isRange = v => v?.constructor === Object && Object.keys(v).length > 0 && Object.entries(v).every(([k, x]) => (k === 'at' || k === 'duration') && typeof x === 'number')

// The chain the page shows: the last expression statement, or the value of the last declaration.
// { statement, expr, root, calls: [{ name, dot, from, to, list, args }] } with calls in source order, or null.
export function chain(code) {
  const tree = parse(code), last = statements(tree).at(-1)
  if (!last) return null
  let expr = last.name === 'ExpressionStatement' ? last.firstChild
    : last.name === 'VariableDeclaration' ? last.getChildren('VariableDefinition').length && last.lastChild : null
  if (!expr || expr.type.isError) return null
  if (expr.name === 'AwaitExpression') expr = expr.lastChild
  const calls = []
  let node = expr
  while (node?.name === 'CallExpression' && node.firstChild?.name === 'MemberExpression') {
    const member = node.firstChild, prop = member.getChild('PropertyName'), dot = children(member).find(c => c.name === '.')
    if (!prop || !dot) break
    const list = node.getChild('ArgList')
    calls.unshift({ name: text(code, prop), dot: dot.from, from: node.from, to: node.to, list, args: args(code, list) })
    node = member.firstChild
  }
  return { statement: last, expr, root: node, calls, declared: last.name === 'VariableDeclaration' ? text(code, last.getChildren('VariableDefinition').at(-1)) : null }
}

// Steps turned off: calls of the chain commented out where they stood, `// .fade(0.5)` alone on a line or
// `/* .fade(0.5) */` within one; after the source, to the end. [{ name, text: '.fade(0.5)', from, to }] of the
// comments, in the order they stand.
export function offCalls(code) {
  const c = chain(code), out = []
  if (!c) return out
  parse(code).iterate({ from: c.root.to, enter: ref => {
    if (!quiet(ref)) return
    const m = text(code, ref).match(/^(?:\/\/|\/\*)\s*(\.([\w$]+)\s*\([\s\S]*\))\s*(?:\*\/)?$/)
    if (m) out.push({ name: m[2], text: m[1], from: ref.from, to: ref.to })
  } })
  return out
}
// A call as written, `.fade(0.5)`, read as a step of a chain: { name, args, source } (its args placed in `source`)
export function parseCall(call) {
  const source = '_' + call, k = chain(source)?.calls[0]
  return k ? { name: k.name, args: k.args, source } : { name: call.match(/^\.([\w$]+)/)?.[1] ?? '', args: [], source }
}
// The change that turns a call off, commented out where it stands: a line of its own gets `// `, else it goes in
// /* */; none when its text would end the comment early
export function turnOff(code, call) {
  const line = lineOf(code, call.dot), t = code.slice(call.dot, call.to)
  if (!code.slice(line.from, call.dot).trim() && !code.slice(call.to, line.to).trim()) return { from: call.dot, insert: '// ' }
  return t.includes('*/') ? null : { from: call.dot, to: call.to, insert: `/* ${t} */` }
}
// ... and back on, as it was written
export const turnOn = (code, off) => ({ from: off.from, to: off.to, insert: off.text })

// The chain's steps as the edits show them, in order, those turned off among them: { name, text, on, call } each, `text`
// as written ('.fade(0.5)'); audio.from(…), which makes the sound, is no step
export function steps(code) {
  const c = chain(code)
  if (!c) return []
  const made = c.root.name === 'VariableName' && code.slice(c.root.from, c.root.to) === 'audio' && !!c.calls[0]
  return [...c.calls.slice(made ? 1 : 0).map(k => ({ name: k.name, text: code.slice(k.dot, k.to), on: true, call: { ...k, from: k.dot } })),
    ...offCalls(code).map(o => ({ name: o.name, text: o.text, on: false, call: o }))].sort((p, q) => p.call.from - q.call.from)
}
// A step where it stands: its line, newline before it included, where it has the line to itself; else itself alone
function piece(code, { from, to }) {
  const line = lineOf(code, from), alone = !code.slice(line.from, from).trim() && !code.slice(to, lineOf(code, to).to).trim()
  return alone && line.from ? { from: line.from - 1, to } : { from, to }
}
// The change that takes step `i` of steps() away, on or off
export function dropStep(code, i) {
  const s = steps(code)[i]
  return s ? { ...piece(code, s.call), insert: '' } : null
}
// The change that moves live step `i` of steps() to stand at `j` among them: taken out where it stands and put in after
// the step at `j` (moving later) or before it (earlier); null for a step turned off, or no move
export function moveStep(code, i, j) {
  const list = steps(code), s = list[i], t = list[j]
  if (!s?.on || !t || i === j) return null
  const p = piece(code, s.call), at = j > i ? t.call.to : piece(code, t.call).from
  return [{ from: p.from, to: p.to, insert: '' }, { from: at, insert: code.slice(p.from, p.to) }]
}

// The script with the chain kept to its first `n` steps, as a rollback bar leaves it; as it is when that is all of them
export function rollback(code, n) {
  const c = chain(code)
  return !c || n >= c.calls.length ? code : code.slice(0, n ? c.calls[n - 1].to : c.root.to)
}
// The script whose output is what step `i` of the chain takes out: the output before it less the output after it,
// the step applied to a copy, turned upside down and mixed in. Null when there is no such step.
export function residual(code, i) {
  const c = chain(code), call = c?.calls[i]
  if (!call) return null
  const head = code.slice(0, c.statement.from), before = code.slice(c.expr.from, i ? c.calls[i - 1].to : c.root.to)
  return `${head}const __before = ${before}\n__before.clone().mix(__before.clone()${code.slice(call.dot, call.to)}.gain(-1, { unit: 'linear' }))`
}

// The change that adds `.name(args)` to the output chain, before a closing save() or play(): a line of its own, as the
// edits are a card each, indented as the chain's lines are; a bare name gets a new statement. Or a group of calls,
// `{ name, calls }`: its name a comment on a line of its own, its calls indented under it, one step of the edits (groups).
// Null when there is no chain.
export function append(code, call) {
  const c = chain(code)
  if (!c) return null
  const { statement, expr, root, calls } = c
  if (!calls.length && root?.name === 'VariableName' && statement.name === 'ExpressionStatement') {
    const line = lineOf(code, statement.from)
    return { from: line.from, insert: `${line.indent}${text(code, root)}${typeof call === 'string' ? `.${call}` : call.calls.map(k => `.${k}`).join('')}
` }
  }
  const sink = calls.findIndex(k => methods[k.name]?.sink)
  const before = sink >= 0 ? calls[sink] : null
  const multiline = calls.some(k => /\n\s*$/.test(code.slice(0, k.dot)))
  const at = before ? before.dot : expr.to
  const ref = multiline && calls.find(k => /\n\s*$/.test(code.slice(0, k.dot)))
  const indent = ref ? code.slice(0, ref.dot).match(/\n([ \t]*)$/)[1] : lineOf(code, at).indent + '  '
  const body = typeof call === 'string' ? `.${call}` : [`// ${call.name}`, ...call.calls.map(k => `  .${k}`)].join(`\n${indent}`)
  if (before && multiline) return { from: at, insert: `${body}\n${indent}` }
  return { from: at, insert: `\n${indent}${body}${before ? `\n${indent}` : ''}` }
}
// Groups of steps, as an outline holds them: a line comment alone on its line in the chain, its name, and the steps on
// the lines after it indented deeper than it, to the first line that is not. [{ name, from, to }], from the comment to
// the end of its last line; a step turned off (`// .fade(0.5)`) is no group's name, and stays in its group.
export function groups(code) {
  const c = chain(code), out = []
  if (!c) return out
  parse(code).iterate({ from: c.root.to, enter: ref => {
    if (ref.name !== 'LineComment') return
    const t = text(code, ref), line = lineOf(code, ref.from)
    // alone on its line, between the chain's calls (not inside one's arguments), and not a step turned off
    if (code.slice(line.from, ref.from).trim() || /^\/\/\s*\./.test(t) || c.calls.some(k => k.list && ref.from > k.list.from && ref.from < k.list.to)) return
    let to = ref.to
    for (let next = lineOf(code, to + 1); to < code.length && next.text.trim() && next.indent.length > line.indent.length; next = lineOf(code, next.to + 1)) to = next.to
    if (to > ref.to) out.push({ name: t.replace(/^\/\/\s*/, '').trim(), from: line.from, to })
  } })
  return out
}
const lineOf = (code, pos) => {
  const from = code.lastIndexOf('\n', pos - 1) + 1, end = code.indexOf('\n', pos), to = end < 0 ? code.length : end
  const t = code.slice(from, to)
  return { from, to, text: t, indent: t.match(/^[ \t]*/)[0] }
}

// The source of the output chain when it is an audio(...) call, following a name to its declaration:
// { from, to, text } of the call, its string sources [{ from, to, name }], and its array [from, to] if it has one.
export function source(code) {
  const c = chain(code)
  let root = c?.root
  if (root?.name === 'VariableName') {
    const name = text(code, root)
    for (const s of statements(parse(code))) if (s.name === 'VariableDeclaration') {
      const defs = s.getChildren('VariableDefinition'), i = defs.findIndex(d => text(code, d) === name)
      if (i >= 0) root = chainRoot(defs[i].nextSibling?.nextSibling)
    }
  }
  if (root?.name !== 'CallExpression' || !isAudio(code, root)) return null
  const first = children(root.getChild('ArgList')).find(n => !['(', ')', ','].includes(n.name) && !quiet(n))
  return {
    from: root.from, to: root.to, text: text(code, root),
    strings: sourcesOf(root).map(s => ({ from: s.from, to: s.to, name: unquote(text(code, s)) })),
    array: first?.name === 'ArrayExpression' ? [first.from, first.to] : null
  }
}
const chainRoot = node => { while (node?.name === 'CallExpression' && node.firstChild?.name === 'MemberExpression') node = node.firstChild.firstChild; return node }

// The method call the caret is in: its name, where it is, and its arguments. Null outside a method call.
export function callAt(code, pos) {
  let node = parse(code).resolveInner(pos, -1)
  for (; node; node = node.parent) {
    if (node.name !== 'CallExpression') continue
    const member = node.firstChild, list = node.getChild('ArgList')
    if (member?.name !== 'MemberExpression' || !list) continue
    const prop = member.getChild('PropertyName')
    if (!prop || pos < prop.from || pos > list.to) continue
    return { name: text(code, prop), from: prop.from, to: node.to, list: { from: list.from, to: list.to }, args: args(code, list) }
  }
  return null
}

// The change that sets a call's argument: positional by index, or a property of its options object by name (a new one
// written short). Missing earlier positions are filled from `fill`.
export function setArg(call, where, value, fill = []) {
  const insert = typeof value === 'string' ? `'${value.replace(/'/g, "\\'")}'` : String(value)
  if (typeof where === 'number') {
    const positional = call.args.filter(a => a.kind !== 'object')
    if (where < positional.length) return { from: positional[where].from, to: positional[where].to, insert }
    const before = positional.length ? positional.at(-1).to : call.list.from + 1
    const values = [...fill.slice(positional.length, where).map(v => typeof v === 'string' ? `'${v}'` : String(v)), insert]
    return { from: before, insert: (positional.length ? ', ' : '') + values.join(', ') + (call.args.some(a => a.kind === 'object') && !positional.length ? ', ' : '') }
  }
  const options = call.args.find(a => a.kind === 'object'), key = SHORT[where] ?? where
  if (!options) return call.args.length
    ? { from: call.args.at(-1).to, insert: `, { ${key}: ${insert} }` }
    : { from: call.list.from + 1, insert: `{ ${key}: ${insert} }` }
  const prop = options.props.find(p => p.name === where)
  if (prop) return { from: prop.valueFrom, to: prop.valueTo, insert }
  const lastProp = options.props.at(-1)
  return lastProp ? { from: lastProp.to, insert: `, ${key}: ${insert}` } : { from: options.from + 1, insert: ` ${key}: ${insert} ` }
}

// A number as the code writes it: short, no float noise.
export const number = (value, step = .001) => {
  const digits = Math.max(0, Math.min(6, Math.ceil(-Math.log10(step))))
  return String(+(+value).toFixed(digits))
}

// The names a script declares (let, const, var, destructured too), and the script with some of them named anew, `names`
// { old: new }, wherever they stand as names, never in a string, a template's text or after a dot
export function declared(code) {
  const out = new Set()
  parse(code).iterate({ enter: ref => { if (ref.name === 'VariableDefinition') out.add(code.slice(ref.from, ref.to)) } })
  return out
}
export function rename(code, names) {
  const at = []
  parse(code).iterate({ enter: ref => { if ((ref.name === 'VariableName' || ref.name === 'VariableDefinition') && names[code.slice(ref.from, ref.to)]) at.push(ref.from, ref.to) } })
  let out = ''
  for (let i = 0, last = 0; i <= at.length; i += 2) out += i < at.length ? code.slice(last, at[i]) + names[code.slice(at[i], at[i + 1])] : code.slice(last), last = at[i + 1]
  return out
}

// The output chain as a CLI command, when it is one: audio('in.wav').gain(-3).save('out.wav') →
// audio in.wav gain -3db save out.wav. Null for scripts a command cannot say.
const UNITS = { dB: 'db', Hz: 'hz', s: 's' }
export function cli(code, spec = () => null) {
  const c = chain(code), src = source(code)
  if (!c || !src || c.root.name !== 'CallExpression' && c.root.name !== 'VariableName') return null
  if (src.strings.length === 0 || src.array && code.slice(src.array[0] + 1, src.array[1] - 1).split(',').length !== src.strings.length) return null
  const quote = s => /^[\w./:@%+-]+$/.test(s) ? s : `'${s.replace(/'/g, "'\\''")}'`
  const out = ['audio', src.strings.map(s => quote(s.name)).join(' + ')]
  const decl = c.declared && statements(parse(code)).length > 1
  if (decl) return null
  for (const call of c.calls) {
    const list = args(code, call.list), params = spec(call.name) || []
    if (list.some(a => a.kind === 'other' || a.value?.some?.(v => typeof v !== 'number') || a.kind === 'object' && a.props.some(p => p.kind === 'other' || Array.isArray(p.value)))) return null
    const words = [call.name]
    if (call.name === 'save') { words.push(quote(String(list[0]?.value ?? 'out.wav'))); out.push(...words); continue }
    // the call's own range, last; a range given by name (denoise's noise) as name:from..to
    const span = ({ at = 0, duration }) => `${at}s..${duration == null ? '' : +(at + duration).toFixed(6) + 's'}`
    const own = p => p.name === 'at' || p.name === 'duration', range = list.find(a => a.kind === 'object' && a.props.some(own))
    list.forEach((a, i) => {
      if (a.kind === 'object') { for (const p of a.props) if (a !== range || !own(p)) words.push(`${p.name}:${isRange(p.value) ? span(p.value) : p.value}`); return }
      if (Array.isArray(a.value)) { words.push(a.value.join('..') + 'hz'); return }
      const unit = UNITS[params[i]?.unit] ?? ''
      const value = call.name === 'fade' && i === 1 ? -Math.abs(a.value) : a.value
      words.push(typeof value === 'number' ? `${value}${unit}` : quote(String(value)))
    })
    if (range) words.push(span(Object.fromEntries(range.props.filter(own).map(p => [p.name, p.value]))))
    out.push(...words)
  }
  return out.join(' ')
}
