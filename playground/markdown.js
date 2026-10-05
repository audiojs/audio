// Markdown as an agent writes it (CommonMark with GitHub's tables and strikethrough) to HTML for the chat: paragraphs,
// headings, lists nested by their indent, quotes, rules, fenced code, tables; code spans, strong, emphasis, struck text,
// links. Every character of the source is escaped, and only http(s) and mailto links link: what an agent read in a file
// or on the web cannot become markup. Read as far as it has come, as it streams in: an open fence holds the rest as code.
const esc = s => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
const indent = l => l.match(/^ */)[0].length
const FENCE = /^ {0,3}(`{3,}|~{3,})\s*([\w+#.-]*)/, HEADING = /^ {0,3}(#{1,6})(?:\s+(.*?))?\s*#*\s*$/
const RULE = /^ {0,3}([-*_])(?:\s*\1){2,}\s*$/, QUOTE = /^ {0,3}>/, ITEM = /^( *)([-*+]|\d{1,9}[.)])(?:\s+|$)/
const DELIMITER = /^ {0,3}\|?\s*:?-+:?\s*(?:\|\s*:?-+:?\s*)*\|?\s*$/
// a line that starts a block of its own, ending a paragraph before it
const table = (line, next) => line.includes('|') && DELIMITER.test(next ?? '') && next.includes('-')
const starts = (line, next) => FENCE.test(line) || HEADING.test(line) || RULE.test(line) || QUOTE.test(line) || ITEM.test(line) || table(line, next)

export default function md(src) {
  return blocks(String(src ?? '').replace(/\0/g, '').replace(/\r\n?/g, '\n').replace(/^\t+/gm, t => '    '.repeat(t.length)).split('\n'))
}

function blocks(lines) {
  let html = '', i = 0, m
  while (i < lines.length) {
    const line = lines[i]
    if (!line.trim()) i++
    else if ((m = line.match(FENCE))) {
      const close = new RegExp(`^ {0,3}${m[1][0] === '`' ? '`' : '~'}{${m[1].length},}\\s*$`), body = []
      for (i++; i < lines.length && !close.test(lines[i]); i++) body.push(lines[i])
      i++
      html += `<pre><code>${esc(body.join('\n'))}</code></pre>`
    }
    else if ((m = line.match(HEADING))) { html += `<h${m[1].length}>${inline(m[2] ?? '')}</h${m[1].length}>`; i++ }
    else if (RULE.test(line)) { html += '<hr>'; i++ }
    else if (QUOTE.test(line)) {
      const body = []
      while (i < lines.length && QUOTE.test(lines[i])) body.push(lines[i++].replace(/^ {0,3}> ?/, ''))
      html += `<blockquote>${blocks(body)}</blockquote>`
    }
    else if (table(line, lines[i + 1])) {
      const align = cells(lines[i + 1]).map(c => c.startsWith(':') && c.endsWith(':') ? 'center' : c.endsWith(':') ? 'right' : '')
      const row = (l, tag) => `<tr>${cells(l).map((c, k) => `<${tag}${align[k] ? ` class="${align[k]}"` : ''}>${inline(c)}</${tag}>`).join('')}</tr>`
      let body = ''
      for (i += 2; i < lines.length && lines[i].includes('|') && lines[i].trim(); i++) body += row(lines[i], 'td')
      html += `<div class="md-table"><table><thead>${row(line, 'th')}</thead>${body && `<tbody>${body}</tbody>`}</table></div>`
    }
    else if (ITEM.test(line)) { let out; [out, i] = list(lines, i); html += out }
    else {
      const para = [line.trimStart()]
      for (i++; i < lines.length && lines[i].trim() && !starts(lines[i], lines[i + 1]); i++) para.push(lines[i].trimStart())
      html += `<p>${inline(para.join('\n').trimEnd())}</p>`
    }
  }
  return html
}

// A list from line i, its items at one indent and of one kind: the item's own lines, those set in deeper (its
// continuation, a list inside it) and lazy ones that carry its text on; a blank line keeps it going where what follows is
// set in or is its next item, and makes it loose, its items paragraphs
function list(lines, i) {
  const [, lead, mark] = lines[i].match(ITEM), at = lead.length, ordered = /\d/.test(mark), items = []
  let loose = false
  for (;;) {
    const m = lines[i]?.match(ITEM)
    if (!m || m[1].length !== at || /\d/.test(m[2]) !== ordered) break
    const pad = m[0].length, body = [lines[i].slice(pad)]
    for (i++; i < lines.length; i++) {
      const l = lines[i]
      if (!l.trim()) {
        const n = lines.findIndex((x, k) => k > i && x.trim()), next = lines[n]
        if (n < 0) { i = lines.length; break }
        if (indent(next) > at) { body.push(''); continue }
        const same = next.match(ITEM)
        if (same && same[1].length === at && /\d/.test(same[2]) === ordered) { loose = true; i = n }
        break
      }
      if (indent(l) > at) body.push(l.slice(Math.min(indent(l), pad)))
      else if (starts(l, lines[i + 1])) break
      else body.push(l.trim())
    }
    if (body.includes('')) loose = true
    items.push(body)
  }
  const tag = ordered ? 'ol' : 'ul', start = ordered ? parseInt(mark) : 1
  const li = body => { const html = blocks(body); return loose ? html : html.replace(/<\/?p>/g, '') }
  return [`<${tag}${start !== 1 ? ` start="${start}"` : ''}>${items.map(b => `<li>${li(b)}</li>`).join('')}</${tag}>`, i]
}

// A table row's cells, a pipe escaped as \| kept in its cell
const cells = l => l.trim().replace(/^\|/, '').replace(/(?<!\\)\|$/, '').split(/(?<!\\)\|/).map(c => c.trim().replace(/\\\|/g, '|'))

// Code spans, escaped characters and links are set aside first, so emphasis never reaches into them
function inline(s) {
  const kept = [], keep = html => `\0${kept.push(html) - 1}\0`
  s = s.replace(/(`+)(?!`)([\s\S]*?[^`])\1(?!`)/g, (_, q, code) => keep(`<code>${esc(code.replace(/^ (.*) $/s, '$1'))}</code>`))
    .replace(/\\([!-/:-@[-`{-~])/g, (_, c) => keep(esc(c)))
  s = esc(s)
    .replace(/\[([^\]\n]+)\]\(\s*([^)\s]+?)(?:\s+&quot;[^\n]*?&quot;)?\s*\)/g, (all, text, url) => /^(https?:\/\/|mailto:)/i.test(url) ? keep(`<a href="${url}" target="_blank" rel="noopener noreferrer">${emphasis(text)}</a>`) : text)
    .replace(/&lt;((?:https?:\/\/|mailto:)[^\s&]+(?:&amp;[^\s&]+)*)&gt;/gi, (_, url) => keep(`<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>`))
    .replace(/(^|[\s(])(https?:\/\/(?:[^\s&]|&amp;)*[^\s&.,;:!?)\]*_~])/g, (_, before, url) => before + keep(`<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>`))
  const back = s => s.replace(/\0(\d+)\0/g, (_, k) => back(kept[k]))
  return back(emphasis(s).replace(/(?: {2,}|\\)\n/g, '<br>'))
}
const emphasis = s => s
  .replace(/\*\*(?=\S)([\s\S]*?\S)\*\*/g, '<strong>$1</strong>')
  .replace(/(^|\W)__(?=\S)([\s\S]*?\S)__(?!\w)/g, '$1<strong>$2</strong>')
  .replace(/\*(?=[^\s*])([\s\S]*?[^\s*])\*/g, '<em>$1</em>')
  .replace(/(^|\W)_(?=[^\s_])([\s\S]*?[^\s_])_(?!\w)/g, '$1<em>$2</em>')
  .replace(/~~(?=\S)([\s\S]*?\S)~~/g, '<del>$1</del>')
