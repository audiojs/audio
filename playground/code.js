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

// Tracks: sounds side by side in time, each its own chain, played together, as a multitrack editor's. A script has
// them where two or more of its statements declare a sound (a chain from audio(…) or audio.from(…)) that nothing else
// reads, the last of them its last statement: [{ name, statement }] in order; else none, and its output is its last
// value. A sound another reads (a mix's source, a noise print, a reference) feeds that one: no track of its own.
let tracked = { code: null, list: [] }
export function tracks(code) {
  if (tracked.code === code) return tracked.list
  const tree = parse(code), list = statements(tree), read = new Set(), found = []
  tree.iterate({ enter: ref => {
    if (ref.name === 'VariableName') read.add(text(code, ref))
    // `{ noise }` reads noise
    else if (ref.name === 'Property' && ref.node.firstChild?.name === 'PropertyDefinition' && !ref.node.firstChild.nextSibling) read.add(text(code, ref))
  } })
  for (const s of list) {
    const defs = s.name === 'VariableDeclaration' ? s.getChildren('VariableDefinition') : [], name = defs.length === 1 && text(code, defs[0])
    if (name && !read.has(name) && sounds(code, defs[0].nextSibling?.nextSibling)) found.push({ name, statement: s })
  }
  return (tracked = { code, list: found.length > 1 && found.at(-1).statement.from === list.at(-1).from ? found : [] }).list
}
// Whether an expression makes a sound of its own: a chain from audio(…) or audio.from(…), awaited or not
function sounds(code, node) {
  if (node?.name === 'AwaitExpression') node = node.lastChild
  const root = chainRoot(node)
  return root?.name === 'CallExpression' ? isAudio(code, root) : root !== node && root?.name === 'VariableName' && text(code, root) === 'audio'
}
// The track the page edits, by its name: chain() reads its chain, and every edit goes there. None, or a name the script
// has no track of, the last statement's
let focused = null
export const focus = name => { focused = name ?? null }

// The script as a function body: imports become dynamic (`audio` is given), each loop checks its time,
// and the last expression, or the last declared name, is returned; with tracks, all of them, by name. Lines keep their
// numbers.
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
  const last = statements(tree).at(-1), list = tracks(code)
  if (list.length) at(last.to, `;return __out({ ${list.map(t => t.name).join(', ')} }, true)`)
  else if (last?.name === 'ExpressionStatement') {
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
// and arrays of them, curves ({ t, v }); undefined for expressions.
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
    return isRange(value) || isCurve(value) ? value : undefined
  }
}
const isRange = v => v?.constructor === Object && Object.keys(v).length > 0 && Object.entries(v).every(([k, x]) => (k === 'at' || k === 'duration') && typeof x === 'number')
// a curve over time, { t, v }: as many values as times, numbers all
const isCurve = v => v?.constructor === Object && Object.keys(v).length === 2 && Array.isArray(v.t) && Array.isArray(v.v) && v.t.length === v.v.length && [...v.t, ...v.v].every(x => typeof x === 'number')

// The chain the page shows: the last expression statement, or the value of the last declaration; with tracks, the one
// the page edits (focus). { statement, expr, root, calls: [{ name, dot, from, to, list, args }], end } with calls in
// source order, `end` where the next statement starts (its steps turned off are before it), or null.
export function chain(code) {
  const tree = parse(code), list = statements(tree), own = focused && tracks(code).find(t => t.name === focused)
  const last = own ? own.statement : list.at(-1)
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
  return { statement: last, expr, root: node, calls, declared: last.name === 'VariableDeclaration' ? text(code, last.getChildren('VariableDefinition').at(-1)) : null, end: list.find(s => s.from > last.from)?.from ?? code.length }
}

// Steps turned off: calls of the chain commented out where they stood, `// .fade(0.5)` alone on a line or
// `/* .fade(0.5) */` within one; after the source, to the next statement or the end. [{ name, text: '.fade(0.5)',
// from, to }] of the comments, in the order they stand.
export function offCalls(code) {
  const c = chain(code), out = []
  if (!c) return out
  parse(code).iterate({ from: c.root.to, to: c.end, enter: ref => {
    if (!quiet(ref) || ref.from >= c.end) return
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
// /* */; none when its text would end the comment early. Only the marks go in, the call's text untouched, so what is
// known by where it stands (the card chosen) is still known by it
export function turnOff(code, call) {
  const line = lineOf(code, call.dot), t = code.slice(call.dot, call.to)
  if (!code.slice(line.from, call.dot).trim() && !code.slice(call.to, line.to).trim()) return { from: call.dot, insert: '// ' }
  return t.includes('*/') ? null : [{ from: call.dot, insert: '/* ' }, { from: call.to, insert: ' */' }]
}
// ... and back on, as it was written: the marks out
export function turnOn(code, off) {
  const at = code.indexOf(off.text, off.from), end = at + off.text.length
  return [{ from: off.from, to: at }, ...end < off.to ? [{ from: end, to: off.to }] : []]
}

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

// Layers: a step or a group moved, set in, made, unmade or named, each as one change, each on lines of their own (the
// chain written a call a line, as the edits write it); null where they are not.
// The lines `what` ({ from, to }: a step where it stands, a group from its comment) stands on, with the newline before
// them; null where something else shares them
function lines(code, { from, to }) {
  const a = lineOf(code, from), b = lineOf(code, to)
  return a.from && !code.slice(a.from, from).trim() && !code.slice(to, b.to).trim() ? { from: a.from - 1, to: b.to, indent: a.indent } : null
}
// those lines, each set in by `indent` in place of the first's own, the deeper ones kept deeper
const setIn = (text, was, indent) => text.replace(new RegExp(`\n${was}`, 'g'), `\n${indent}`)
// The change that moves `what` before or after `target` (a step or a group, as `what` is), set in as the target is; or,
// `into` a group (`target` its comment's span), first under its comment, set in as its steps are
export function moveLines(code, what, target, { after = false, into = false } = {}) {
  const block = lines(code, what), t = lines(code, target)
  if (!block || !t || (t.from >= block.from && t.to <= block.to)) return null
  const indent = into ? lineOf(code, lineOf(code, target.from).to + 1).indent : t.indent
  const at = into ? lineOf(code, target.from).to : after ? t.to : t.from
  if (at >= block.from && at <= block.to) return null
  return [{ from: block.from, to: block.to }, { from: at, insert: setIn(code.slice(block.from, block.to), block.indent, indent) }]
}
// The change that makes steps `i` to `j` of steps() a group named `name`: its comment on a line of its own over them,
// at their place, they set in under it
export function group(code, i, j, name = 'Group') {
  const list = steps(code), first = list[Math.min(i, j)], last = list[Math.max(i, j)]
  const block = first && last && lines(code, { from: first.call.from, to: last.call.to })
  if (!block || groups(code).some(g => g.from < block.to && g.to > block.from)) return null
  const text = code.slice(block.from, block.to)
  return { from: block.from, to: block.to, insert: `\n${block.indent}// ${name}${setIn(text, block.indent, block.indent + '  ')}` }
}
// The change that unmakes a group (groups()): its comment's line out, its steps set back to where it stood
export function ungroup(code, g) {
  const head = lineOf(code, g.from), body = lineOf(code, head.to + 1)
  if (!head.from) return null
  return { from: head.from - 1, to: g.to, insert: setIn(code.slice(head.to, g.to), body.indent, head.indent) }
}
// The change that names a group anew
export function renameGroup(code, g, name) {
  const head = lineOf(code, g.from), at = code.indexOf('//', g.from)
  return name.trim() ? { from: at, to: head.to, insert: `// ${name.trim()}` } : null
}

// The script with the chain kept to its first `n` steps, as a rollback bar leaves it, the tracks after it as they are; as
// it is when that is all of them
export function rollback(code, n) {
  const c = chain(code)
  return !c || n >= c.calls.length ? code : code.slice(0, n ? c.calls[n - 1].to : c.root.to) + (c.end < code.length ? code.slice(c.statement.to) : '')
}
// The chain as a measure's step(i) reads it (worker.js): each step as steps() lists them, its call as written, whether it is
// on, the script its output enters it by and, on, the one it leaves it by, rolled back as rollback() rolls back; of the
// track the page edits, that track alone
export function stages(code) {
  const c = chain(code), list = steps(code), alone = tracks(code).some(t => t.statement.from === c?.statement.from) ? s => `${s}\n${c.declared}` : s => s
  if (!c) return []
  let k = c.calls.length - list.filter(s => s.on).length
  return list.map(s => ({ name: s.name, call: s.text.slice(1), on: s.on, before: alone(rollback(code, k)), after: s.on ? alone(rollback(code, ++k)) : null }))
}

// A mix (how much of an edit's output is heard: a share, or a curve { t, v } over time) with [a, b] seconds set to `to`,
// 0 (the edit off there) or 1 (on), a ramp of `f` seconds outside each end, from and back to what it was; the rest as
// it was. A number is a curve flat at it; null where it comes to all of it everywhere, a number where it is flat
export function mixed(mix = 1, a, b, to, f) {
  const { t, v } = typeof mix === 'number' ? { t: [0], v: [mix] } : mix, n = t.length
  const at = s => { let j = 0; while (j < n && t[j] <= s) j++; return j === 0 ? v[0] : j === n ? v[n - 1] : v[j - 1] + (v[j] - v[j - 1]) * (s - t[j - 1]) / (t[j] - t[j - 1]) }
  const all = [...t.map((x, i) => [x, v[i]]).filter(([x]) => x < a - f || x > b + f), ...a - f > 0 ? [[a - f, at(a - f)]] : [], [Math.max(0, a), to], [b, to], [b + f, at(b + f)]]
    .sort((p, q) => p[0] - q[0])
  if (all.every(p => p[1] === all[0][1])) return all[0][1] === 1 ? null : all[0][1]
  // a point whose neighbours are of its value says nothing: the curve is straight between them, flat past its ends
  const pts = all.filter((p, i) => ![all[i - 1], all[i + 1]].every(q => !q || q[1] === p[1]))
  return { t: pts.map(p => p[0]), v: pts.map(p => p[1]) }
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
// With `after`, where a step of the chain ends: right after that step instead. Null when there is no chain.
export function append(code, call, after = null) {
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
  // right after a step of it (`after`, where that step ends), the steps after it staying after it
  if (after != null && after < at) return { from: after, insert: multiline || typeof call !== 'string' ? `\n${indent}${body}` : body }
  if (before && multiline) return { from: at, insert: `${body}\n${indent}` }
  return { from: at, insert: `\n${indent}${body}${before ? `\n${indent}` : ''}` }
}
// Groups of steps, as an outline holds them: a line comment alone on its line in the chain, its name, and the steps on
// the lines after it indented deeper than it, to the first line that is not. [{ name, from, to }], from the comment to
// the end of its last line; a step turned off (`// .fade(0.5)`) is no group's name, and stays in its group.
export function groups(code) {
  const c = chain(code), out = []
  if (!c) return out
  parse(code).iterate({ from: c.root.to, to: c.end, enter: ref => {
    if (ref.name !== 'LineComment' || ref.from >= c.end) return
    const t = text(code, ref), line = lineOf(code, ref.from)
    // alone on its line, between the chain's calls (not inside one's arguments), and not a step turned off
    if (code.slice(line.from, ref.from).trim() || /^\/\/\s*\./.test(t) || c.calls.some(k => k.list && ref.from > k.list.from && ref.from < k.list.to)) return
    let to = ref.to
    for (let next = lineOf(code, to + 1); to < c.end && next.text.trim() && next.indent.length > line.indent.length; next = lineOf(code, next.to + 1)) to = next.to
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
  const insert = typeof value === 'string' ? `'${value.replace(/'/g, "\\'")}'` : value?.raw ?? String(value)
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

// The change that takes an option away from a call's options object, the object too where it was its only one; null
// where it has none of that name
export function unsetArg(call, where) {
  const options = call.args.find(a => a.kind === 'object'), props = options?.props ?? [], i = props.findIndex(p => p.name === where)
  if (i < 0) return null
  if (props.length === 1) { const prev = call.args[call.args.indexOf(options) - 1]; return { from: prev ? prev.to : options.from, to: options.to, insert: '' } }
  return i ? { from: props[i - 1].to, to: props[i].to, insert: '' } : { from: props[0].from, to: props[1].from, insert: '' }
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

// A track made, moved out or taken away, the script as it is after, whole: { code, name } (the track made), or null where
// the sound the page edits is none of its own (a chain on a name it reads).
// [at, at + d] of the track the page edits moved to a track of its own under it, where it was in time: its chain as it
// stands, cropped to the range and put back at its time by silence before it (pad); silence where it was (gain −∞ dB),
// so the two sound as the one did, and each is edited on its own. `at` and `d` as the script writes them
export function toTrack(code, { at, d }) {
  const own = declaredTrack(code)
  if (!own) return null
  const c = chain(own.code), name = unused(own.code, own.name.replace(/\d+$/, '') || own.name)
  let piece = `let ${name} = ${own.code.slice(c.expr.from, c.expr.to)}`
  piece = put(piece, append(piece, `crop({ at: ${at}, d: ${d} })`))
  if (+at > 0) piece = put(piece, append(piece, `pad(${at}, 0)`))
  const silenced = put(own.code, append(own.code, `gain(-Infinity, { at: ${at}, d: ${d} })`))
  return { code: placed(silenced, chain(silenced).end, piece), name }
}
// A sound, `sound` as written (audio('b.wav')), a track of its own under the one the page edits, named for its `file`
export function addTrack(code, sound, file) {
  const own = declaredTrack(code)
  if (!own) return null
  const name = unused(own.code, identifier(file))
  return { code: placed(own.code, chain(own.code).end, `let ${name} = ${sound}`), name }
}
// The change that takes track `name` away: its statement, its steps turned off with it, the blank lines before it
export function dropTrack(code, name) {
  const list = statements(parse(code)), t = tracks(code).find(t => t.name === name)
  if (!t) return null
  const next = list.find(s => s.from > t.statement.from)
  let from = t.statement.from
  while (from > 0 && /\s/.test(code[from - 1])) from--
  return { from, to: next ? next.from : code.length, insert: next && from ? '\n\n' : '' }
}
// The track the page edits as a declaration: one already, or its sound (`audio('take.wav')…` alone) declared, named for
// its file; { code, name }, or null where it is no sound of its own
function declaredTrack(code) {
  const c = chain(code)
  if (!c || !sounds(code, c.expr)) return null
  if (c.statement.name === 'VariableDeclaration') return c.statement.getChildren('VariableDefinition').length === 1 ? { code, name: c.declared } : null
  if (c.statement.name !== 'ExpressionStatement') return null
  const name = unused(code, identifier(source(code)?.strings[0]?.name))
  return { code: code.slice(0, c.statement.from) + `let ${name} = ` + code.slice(c.statement.from), name }
}
// `text` a statement of its own at `end`, a blank line either side
const placed = (code, end, text) => `${code.slice(0, end).replace(/\s*$/, '')}\n\n${text}${end < code.length ? `\n\n${code.slice(end)}` : ''}`
const put = (code, { from, to = from, insert }) => code.slice(0, from) + insert + code.slice(to)
// A name the script uses for none: `base`, else base2, base3…
function unused(code, base) {
  const taken = declared(code)
  let name = base, n = 2
  while (taken.has(name)) name = base + n++
  return name
}
// A file's name as a script's name for its sound: take.wav → take, My take-2.wav → myTake2; `fallback` where that makes
// none, or one the script can't take (audio, a word of the language)
const WORDS = new Set('audio console files arguments await async break case catch class const continue debugger default delete do else enum eval export extends false finally for function if implements import in instanceof interface let new null of package private protected public return static super switch this throw true try typeof undefined var void while with yield NaN Infinity'.split(' '))
function identifier(file, fallback = 'sound') {
  let base = String(file ?? '').replace(/[?#].*$/, '').replace(/^.*[\\/]/, '').replace(/\.[^.]*$/, '')
  try { base = decodeURIComponent(base) } catch {}
  const id = base.split(/[^A-Za-z0-9_$]+/).filter(Boolean).map((w, i) => i ? w[0].toUpperCase() + w.slice(1) : w[0].toLowerCase() + w.slice(1)).join('')
  return /^[A-Za-z_$][\w$]*$/.test(id) && !WORDS.has(id) ? id : fallback
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
