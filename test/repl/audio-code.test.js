// <audio-code> (elements/code.js): the repl's script alone, drawn as the editor draws it before CodeMirror comes and once
// it is in, CodeMirror loaded only once a reader reaches for it, its text a property and its changes an event. The
// reference for how each character is drawn is the editor's own: the words syntax.js finds in the parser's tree, in
// the screen's skin (theme.js skin over themes/screen.json, which skin.css writes out for the first paint), as
// look.test.js holds the editor to it
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { gzipSync } from 'node:zlib'
import { parser } from '@lezer/javascript'
import words from '../../repl/syntax.js'
import { skin, load } from '../../repl/theme.js'
import { page, browser, origin, poll } from './page.js'

// the demo's five scripts, as elements/index.html writes them (the four the site's home shows, audiojs.github.io
// index.html #uses, and the chime the editor opened on)
const SCRIPTS = [
  `audio('chime.wav')\n  .trim()\n  .normalize(-1)\n  .fade(0.02, 0.1)`,
  `// Wellcome Library, CC BY-SA 3.0, an excerpt\naudio('/samples/historic/florence-nightingale.mp3')\n  .auto()`,
  `// skrjablin, CC0; the reference: Wolfgang_, CC0\naudio('/samples/music/8-bit/c64-adventure-theme.mp3')\n  .master(audio('/samples/music/8-bit/battle-loop.mp3'))`,
  `// read by Jothi Tharavant, LibriVox, public domain\naudio('/samples/sacred/song-celestial-12.mp3')\n  .trim()\n  .normalize('podcast')`,
  `// Kimiko Ishizaka, public domain, an excerpt\naudio('/samples/music/classical/prelude-in-c.mp3')\n  .stretch(1.25)\n  .pitch(-3)`
]
// words of every kind the colours tell apart, for a page of its own: a doc comment, a template, a regular expression,
// a declaration, an arrow, an object, numbers in bases, the language's constants
const RICH = `/** The take, cleaned
 * @param {number} db the floor */
const floor = -40, name = \`take-\${floor}\`
let take = audio('take.wav').trim(floor).normalize({ target: -16, ceiling: -1 })
take = /\\.wav$/i.test(name) ? take.fade(0.5) : take.gain(0x10 / 16)
export default async (x = null) => take ?? undefined // done`

// The screen's skin, as the editor wears it with no theme
const screen = async () => skin(await load(new URL('../../repl/themes/screen.json', import.meta.url).href, { kind: 'dark', get: u => readFile(new URL(u), 'utf8') }))
// How the editor draws each character (look.test.js ours): its words laid over one another, outermost first, each its
// own colour and font style where the skin sets them, the innermost's semantic token over them, the script's own under
function ours(vars, text) {
  const list = words(parser.parse(text), text)
  const out = Array.from(text, () => ({ fg: vars['--color-syntax-source'] ?? vars['--color-screen-ink'], italic: false, bold: false, underline: false, strike: false }))
  const lay = (x, v) => {
    if (v('color')) x.fg = v('color')
    if (v('italic')) x.italic = v('italic') === 'italic'
    if (v('bold')) x.bold = v('bold') === 'bold'
    if (v('line')) { x.underline = v('line').includes('underline'); x.strike = v('line').includes('line-through') }
  }
  for (const [from, to, w] of list) for (let k = from; k < to; k++) lay(out[k], p => vars[`--${p}-syntax-${w}`])
  for (const [from, to, , m] of list) if (m) for (let k = from; k < to; k++) lay(out[k], p => vars[`--${p}-semantic-${m.replaceAll('.', '-')}`])
  return out.filter((_, k) => !/\s/.test(text[k]))
}
// What an element draws, the text before CodeMirror or CodeMirror's (`live`): each character but spaces as drawn, its
// colour, its font style, the lines of the words it is in; each line's top and the box's height, from the element's top
const drawn = (el, live) => el.evaluate((el, live) => {
  const root = live ? el.querySelector('.pane .cm-editor') : el.querySelector(':scope > .cm-editor[data-static]')
  const out = [], lines = e => { const on = new Set(); for (; !e.classList.contains('cm-content'); e = e.parentElement) if (/\bsyntax-/.test(e.className)) for (const l of getComputedStyle(e).textDecorationLine.split(' ')) if (l !== 'none') on.add(l); return on }
  const walk = n => {
    if (n.nodeType !== 3) return n.childNodes.forEach(walk)
    const s = getComputedStyle(n.parentElement), d = lines(n.parentElement)
    for (const c of n.textContent) if (!/\s/.test(c)) out.push({ fg: s.color.replace(/,/g, ''), italic: s.fontStyle === 'italic', bold: +s.fontWeight >= 600, underline: d.has('underline'), strike: d.has('line-through') })
  }
  const top = el.getBoundingClientRect().top, rows = [...root.querySelectorAll('.cm-content .cm-line')]
  rows.forEach(walk)
  const at = e => Math.round((e.getBoundingClientRect().top - top) * 100) / 100
  // the numbers CodeMirror draws (its spacer aside): their tops, and where their right edge stands
  const numbers = [...root.querySelectorAll('.cm-lineNumbers .cm-gutterElement')].filter(n => n.textContent && getComputedStyle(n).visibility !== 'hidden' && n.offsetHeight)
  return { chars: out, text: rows.map(r => r.textContent).join('\n'), tops: rows.map(at), numbers: numbers.map(at), right: Math.round(root.querySelector('.cm-content').getBoundingClientRect().left - el.getBoundingClientRect().left), height: el.getBoundingClientRect().height }
}, live)
const codes = () => page.locator('audio-code')
// what the page asks for, by path
function asked(p = page) { const got = []; p.on('request', r => got.push(new URL(r.url()).pathname)); return got }
const CM = '/assets/codemirror.js'

test('audio-code: where no script runs, the text is the page\'s own <pre>, whole', async () => {
  const ctx = await browser.newContext({ javaScriptEnabled: false }), p = await ctx.newPage()
  await p.goto(`${origin}/elements/`)
  const pres = p.locator('audio-code > pre')
  assert.equal(await pres.count(), 5)
  for (let i = 0; i < 5; i++) { assert.ok(await pres.nth(i).isVisible()); assert.equal(await pres.nth(i).textContent(), SCRIPTS[i]) }
  await ctx.close()
})

test('audio-code: each character drawn as the editor draws it, before CodeMirror and once it is in, in the same places', async () => {
  const vars = await screen(), got = asked()
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.goto(`${origin}/elements/`)
  await poll(() => codes().evaluateAll(els => els.filter(e => e.hasAttribute('data-drawn')).length), n => assert.equal(n, 5))
  for (let i = 0; i < 5; i++) {
    const el = codes().nth(i), before = await drawn(el, false)
    assert.equal(before.text, SCRIPTS[i], 'its text, line by line')
    assert.deepEqual(before.chars, ours(vars, SCRIPTS[i]), `${i}: before CodeMirror`)
    if (!i) assert.ok(!got.includes(CM), 'no CodeMirror till one is reached for')
    assert.equal(await el.evaluate(e => e.querySelector('.pane .cm-editor')), null, `${i}: no editor of its own till it is reached for`)
    await el.hover()
    await poll(() => el.evaluate(e => e.hasAttribute('data-live')), live => assert.ok(live))
    const after = await drawn(el, true)
    assert.deepEqual(after.chars, ours(vars, SCRIPTS[i]), `${i}: in CodeMirror`)
    // nothing moves as it comes: each line, each number, where the text begins, the box's height
    assert.deepEqual(after.tops, before.tops, `${i}: the lines' tops`)
    assert.deepEqual(after.numbers, before.numbers, `${i}: the numbers' tops`)
    assert.equal(after.right, before.right, `${i}: the text's left edge`)
    assert.equal(after.height, before.height, `${i}: the box's height`)
  }
  assert.equal(got.filter(p => p === CM).length, 1, 'CodeMirror asked for once, for all five')
})

test('audio-code: a script of every kind of word drawn as the editor draws it, before CodeMirror and in it', async () => {
  const vars = await screen()
  await page.goto(`${origin}/blank.html`)
  await page.evaluate(text => { const el = document.body.appendChild(document.createElement('audio-code')); el.append(Object.assign(document.createElement('pre'), { textContent: text })) }, RICH)
  await page.addScriptTag({ type: 'module', url: '/elements/code.js' })
  const el = codes().first()
  await poll(() => el.evaluate(e => e.hasAttribute('data-drawn')), d => assert.ok(d))
  const before = await drawn(el, false), want = ours(vars, RICH)
  assert.equal(before.text, RICH)
  assert.deepEqual(before.chars, want, 'before CodeMirror')
  await el.hover()
  await poll(() => el.evaluate(e => e.hasAttribute('data-live')), live => assert.ok(live))
  const after = await drawn(el, true)
  assert.deepEqual(after.chars, want, 'in CodeMirror')
  assert.deepEqual(after.tops, before.tops)
  assert.equal(after.height, before.height)
})

test('audio-code: readonly loads no CodeMirror, pointed at, pressed or the keys in it; its text selectable', async () => {
  const got = asked()
  await page.goto(`${origin}/blank.html`)
  await page.setContent(`<audio-code readonly><pre><code>${SCRIPTS[0]}</code></pre></audio-code><button>after</button>`)
  await page.addScriptTag({ type: 'module', url: '/elements/code.js' })
  const el = codes().first()
  await poll(() => el.evaluate(e => e.hasAttribute('data-drawn')), d => assert.ok(d))
  await el.hover()
  await el.click()
  await page.keyboard.press('Tab')
  await page.keyboard.press('Shift+Tab')
  await page.locator('.cm-line', { hasText: 'normalize' }).dblclick({ position: { x: 60, y: 6 } })
  assert.equal(await page.evaluate(() => getSelection().toString()), 'normalize', 'a word selected by a double-click')
  await page.waitForTimeout(300)
  assert.equal(await el.evaluate(e => e.hasAttribute('data-reached') || e.hasAttribute('data-live')), false)
  assert.ok(!got.includes(CM), 'no CodeMirror')
  assert.equal(await el.evaluate(e => e.value), SCRIPTS[0])
})

test('audio-code: the reader\'s changes its value, an input event each; a value set, one undo step, no event', async () => {
  await page.goto(`${origin}/elements/`)
  const el = page.locator('#one')
  await poll(() => el.evaluate(e => e.hasAttribute('data-drawn')), d => assert.ok(d))
  await el.evaluate(e => { e.heard = []; e.addEventListener('input', ev => e.heard.push([ev.constructor.name, e.value])) })
  // pressed at the e of normalize: the caret there once the editor is in
  const at = SCRIPTS[0].indexOf('normalize') + 1
  const point = await el.evaluate((e, at) => {
    const lines = [...e.querySelectorAll(':scope > [data-static] .cm-line')], text = e.value
    const row = text.slice(0, at).split('\n').length - 1, col = at - text.slice(0, at).lastIndexOf('\n') - 1
    const walker = document.createTreeWalker(lines[row], NodeFilter.SHOW_TEXT), r = document.createRange()
    for (let n = walker.nextNode(), k = 0; n; k += n.length, n = walker.nextNode()) if (col < k + n.length) { r.setStart(n, col - k); r.setEnd(n, col - k + 1); break }
    const b = r.getBoundingClientRect()
    return { x: b.left + 1, y: b.top + b.height / 2 }
  }, at)
  await page.mouse.click(point.x, point.y)
  await poll(() => el.evaluate(e => e.hasAttribute('data-live') && e.contains(document.activeElement)), ok => assert.ok(ok))
  await page.keyboard.type('XY')
  const typed = SCRIPTS[0].slice(0, at) + 'XY' + SCRIPTS[0].slice(at)
  assert.equal(await el.evaluate(e => e.value), typed)
  assert.deepEqual(await el.evaluate(e => e.heard), [['Event', SCRIPTS[0].slice(0, at) + 'X' + SCRIPTS[0].slice(at)], ['Event', typed]], 'one event a change, the element\'s alone')
  assert.equal(await page.textContent('#said'), `4 lines, ${typed.length} characters`)
  // a value set: no event, the whole text replaced, undone in one step
  await el.evaluate(e => { e.value = "audio('drums.wav').gain(-3)" })
  assert.equal(await el.evaluate(e => e.value), "audio('drums.wav').gain(-3)")
  assert.equal(await el.evaluate(e => e.heard.length), 2)
  await page.keyboard.press('ControlOrMeta+z')
  assert.equal(await el.evaluate(e => e.value), typed)
})

test('audio-code: the editor\'s completions, in the skin\'s menu colours', async () => {
  await page.goto(`${origin}/elements/`)
  const el = page.locator('#one')
  await el.locator('.cm-line').last().click()
  await poll(() => el.evaluate(e => e.hasAttribute('data-live') && e.contains(document.activeElement)), ok => assert.ok(ok))
  await page.keyboard.press('End')
  await page.keyboard.type('\n  .norm')
  const list = page.locator('.cm-tooltip-autocomplete')
  await poll(() => list.locator('.cm-completionLabel').allTextContents(), labels => assert.ok(labels.includes('normalize'), labels.join(' ')))
  // the menu's ground: skin.css --color-menu, rgb(36 36 36)
  assert.equal(await list.evaluate(e => getComputedStyle(e).backgroundColor), 'rgb(36, 36, 36)')
  await list.locator('li', { has: page.locator('.cm-completionLabel', { hasText: /^normalize$/ }) }).click()
  assert.match(await el.evaluate(e => e.value), /\n\s*\.normalize\(\)$/)
})

test('audio-code: the keys reach it: Tab into the text, and the script editor takes them there', async () => {
  await page.goto(`${origin}/elements/`)
  const el = page.locator('#one')
  await poll(() => el.evaluate(e => e.hasAttribute('data-drawn')), d => assert.ok(d))
  await page.keyboard.press('Tab')
  assert.equal(await page.evaluate(() => document.activeElement.matches('#one > [data-static]')), true)
  assert.equal(await page.evaluate(() => document.activeElement.getAttribute('role')), 'textbox')
  await poll(() => el.evaluate(e => e.hasAttribute('data-live') && document.activeElement?.matches('#one .pane .cm-content')), ok => assert.ok(ok))
  await page.keyboard.type('// ')
  assert.equal(await el.evaluate(e => e.value), '// ' + SCRIPTS[0])
})

test('audio-code: a press or a selection made while CodeMirror is on its way is the editor\'s once it is in', async () => {
  let release
  const held = new Promise(r => release = r)
  await page.route(`**${CM}`, async route => { await held; await route.continue() })
  await page.goto(`${origin}/elements/`)
  const el = page.locator('#one'), line = el.locator('.cm-line', { hasText: 'normalize' })
  await poll(() => el.evaluate(e => e.hasAttribute('data-drawn')), d => assert.ok(d))
  // normalize selected by a double-click on the text, CodeMirror still held
  await line.dblclick({ position: { x: 60, y: 6 } })
  assert.equal(await page.evaluate(() => getSelection().toString()), 'normalize')
  assert.equal(await el.evaluate(e => e.hasAttribute('data-live')), false)
  release()
  await poll(() => el.evaluate(e => e.hasAttribute('data-live') && e.contains(document.activeElement)), ok => assert.ok(ok))
  await page.keyboard.type('gain')
  assert.equal(await el.evaluate(e => e.value), SCRIPTS[0].replace('normalize', 'gain'))
})

// Firefox applies none of a stylesheet's rules till its @import is in: a pane hidden by a rule there had its width, and
// every block loaded CodeMirror at once, then showed nothing. The pane is hidden by its attribute; a block reached for
// before it is drawn is reached for once it is
test('audio-code: while the skin is on its way, no CodeMirror and no pane with a width; a block pointed at meanwhile is reached for once drawn', async () => {
  let release
  const held = new Promise(r => release = r), got = asked()
  await page.route('**/repl/skin.css', async route => { await held; await route.continue() })
  // (the window's load waits for the skin)
  await page.goto(`${origin}/elements/`, { waitUntil: 'domcontentloaded' })
  const el = page.locator('#one')
  await poll(() => page.evaluate(() => customElements.get('audio-code') && document.querySelectorAll('audio-code > .pane').length), n => assert.equal(n, 5))
  await el.hover()
  await page.waitForTimeout(300)
  assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll('audio-code > .pane')].map(p => [p.hidden, p.offsetWidth])), Array(5).fill([true, 0]))
  assert.ok(!got.includes(CM), 'no CodeMirror')
  assert.equal(await el.evaluate(e => e.hasAttribute('data-drawn')), false, 'not drawn without its skin')
  release()
  await poll(() => el.evaluate(e => e.hasAttribute('data-live')), live => assert.ok(live))
  assert.equal(await page.evaluate(() => document.querySelectorAll('audio-code[data-reached]').length), 1, 'the one pointed at alone')
})

test('audio-code: as wide as its place at a desktop\'s and a phone\'s width, the page no wider than the window; what it weighs', async t => {
  for (const width of [1280, 390]) {
    const got = asked(), sizes = new Map()
    page.on('response', async r => { try { sizes.set(new URL(r.url()).pathname, gzipSync(await r.body(), { level: 9 }).length) } catch {} })
    await page.setViewportSize({ width, height: 844 })
    await page.goto(`${origin}/elements/`)
    await poll(() => codes().evaluateAll(els => els.filter(e => e.hasAttribute('data-drawn')).length), n => assert.equal(n, 5))
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), width, 'nothing past the window')
    for (const box of await codes().evaluateAll(els => els.map(e => e.getBoundingClientRect().right))) assert.ok(box <= width, `${box} within ${width}`)
    const shown = [...new Set(got)].filter(p => p !== '/elements/')
    await codes().first().hover()
    await poll(() => codes().first().evaluate(e => e.hasAttribute('data-live')), live => assert.ok(live))
    await page.waitForLoadState('networkidle')
    const more = [...new Set(got)].filter(p => !shown.includes(p) && p !== '/elements/')
    assert.ok(more.includes(CM), 'CodeMirror once reached for')
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), width, 'nothing past the window, the editor in')
    const kb = list => (list.reduce((n, p) => n + (sizes.get(p) ?? 0), 0) / 1024).toFixed(1)
    if (width === 1280) t.diagnostic(`gzipped: drawn ${kb(shown)} KB (${shown.join(' ')}); reached for, ${kb(more)} KB more (${more.join(' ')})`)
  }
})
