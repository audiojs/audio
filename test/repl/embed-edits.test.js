// The page's quick edits in an embed (ui edits: menu, chain), as the home's hero lays them; the server, the page and the
// helpers in page.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { deflateRawSync } from 'node:zlib'
import { page, origin, errors, poll } from './page.js'

const OPS = 'trim(-40) normalize(-1) fade(1, 1) stretch(1.25) pitch(-2) reverse', CONTROLS = 'sound play clock history save loudness rate channels view'
// The list's first section, Suggested, as read (shown, each its name and its hint): the edits the sound is suggested,
// four at most: for the page's own sound its ops, for another its kind's (kind.js NEXT; the chime's word has no row, so
// the general one's), those made gone
const SUGGESTED = ['Trim silence −40dB', 'Normalize −1dB', 'Fade 1s, 1s', 'Stretch 1.25×']
const SPEECH = ['Highpass 80Hz', 'Deepfilter', 'Shrink pauses 0.3s', 'Normalize podcast'], MUSIC = ['Stretch 1.25×', 'Pitch −3st', 'Vocals remove', 'Normalize spotify'],
  GENERAL = ['Trim silence', 'Normalize', 'Fade 0.5s, 0.5s'], BOTH = ['Deepfilter', 'Normalize podcast']
// then Recipes, a section of its own: the automatic edit, three recipes, More recipes (the rest, a submenu); then a row
// a kind, the Process menu's, a submenu each
const KINDS = ['Silence', 'Level', 'Filter', 'Dynamics', 'Repair', 'Time & pitch', 'Effect', 'Color', 'Reverb', 'Space']
// in Recipes, the automatic edit for the sound's kind first, then every recipe (recipes.js offered, in its order), those
// its kind is offered first (kind.js OFFERS); the interview's only for a sound of two channels
const RECIPES = ['Clean up a voice recording', 'Enhance speech', 'Podcast episode', 'Audiobook chapter', 'Voice for broadcast or video', 'Interview, two mics', 'Clean up a location recording', 'Restore a vinyl record', 'Master a song for streaming', 'Master a song to a reference', 'Master a song, warm', 'Repair a damaged recording']
const first = (...own) => [...own, ...RECIPES.filter(n => !own.includes(n))]
// An <audio-repl> as the home's hero is, on the page's ground, 5vw in from the frame's sides; its frame once its sound
// is in. `hold`: the frame held back, for its skeleton (release() lets it come); `ops`: the page's edits ('', none); `ui`:
// more of the page's own; `controls`, the parts it shows. `full`: the editor as a page of its own, the same config in its
// link (?ui=, the edits laid by it), the script its link's (#code=), in a tab of its own: the page itself the frame
async function mount(edits, { kind = 'chime', script = "audio('chime.wav')", hold = false, ops = OPS, ui = {}, controls = CONTROLS, full = false } = {}) {
  if (full) {
    const config = { ...edits && { edits }, ...kind && { kind }, ...ops && { ops: ops.match(/[\w-]+(?:\([^)]*\))?/g) }, ...ui }
    await page.goto(`${origin}/repl/?ui=${encodeURIComponent(JSON.stringify(config))}#code=${deflateRawSync(script).toString('base64url')}`)
    return { f: page, release: () => {} }
  }
  await page.goto(origin + '/blank.html')
  let release = () => {}
  if (hold) { const held = new Promise(r => release = r); await page.route('**/repl/?embed*', async route => { await held; await route.continue() }) }
  await page.evaluate(async ({ edits, kind, script, ops, ui, controls }) => {
    await import('/repl/embed.js')
    Object.assign(document.body.style, { margin: '0', background: 'rgb(40, 40, 40)' })
    document.body.innerHTML = `<audio-repl panel="none" height="420" background="page" controls="${controls}"${ops ? ` ops="${ops}"` : ''} ui='${JSON.stringify({ grid: 'paper', axis: 'inside', inset: '5vw', font: 'sans', ...edits && { edits }, ...kind && { kind }, ...ui })}'><pre><code>${script}</code></pre></audio-repl>`
  }, { edits, kind, script, ops, ui, controls })
  return { f: page.frameLocator('audio-repl iframe'), release }
}
// The chain is a layout of the editor's, not of an embed's: a check of it that is not about living in another page (its
// inset, its ground, the frame's width) runs twice, embedded and in the editor as a page of its own laid as the chain
// (?ui= edits chain, as View › Edit chain lays it), `full` telling mount() which
const both = (name, fn) => { test(`editor: embedded, ${name}`, () => fn(false)); test(`editor: a page of its own laid as the chain, ${name}`, () => fn(true)) }
const length = (f, text) => f.locator('.clock .length', { hasText: text }).waitFor({ state: 'attached' })
// the keys a row of edits has, as read: its name and its values
const keys = (f, sel) => f.locator(sel).evaluateAll(es => es.map(e => [...e.children].map(c => c.textContent).join(' ').trim()))
const made = f => keys(f, '.chain-step > .chain-edit')
// what the chain's live line last said (chain.js)
const said = f => f.locator('p.visually-hidden[role="status"]').textContent()
// what Suggested holds, shut or open (its rows, each its name and its hint); and what the list holds, a group a line,
// each row's name; the rows with a submenu
const shown = f => f.locator('#edits-found').evaluate(l => { const g = l.querySelector('.found-group'); return g?.getAttribute('aria-label') === 'Suggested' ? [...g.querySelectorAll('.found-row')].map(r => `${r.querySelector('.found-name').textContent} ${r.querySelector('.found-hint').textContent}`.trim()) : [] })
const listed = f => f.locator('#edits-found').evaluate(l => [...l.querySelectorAll('.found-group')].map(g => [...g.querySelectorAll('.found-name strong')].map(n => n.textContent)))
// an edit made by the field: its words typed, Enter making the first it finds
const make = async (f, words) => { await f.locator('.chain-add').click(); await f.locator('.found-search').fill(words); await page.keyboard.press('Enter') }
// an edit's settings open: the last made pressed where they are shut (made by the field, they stay shut), waited for
// as it loads them, before a key
const opened = async f => {
  if (!await f.locator('#step-settings').evaluate(p => p.matches(':popover-open'))) await f.locator('.chain-step > .chain-edit').last().click()
  await poll(() => f.locator('#step-settings').evaluate(p => p.matches(':popover-open')), o => assert.equal(o, true, 'its settings open'))
}
const width = px => page.evaluate(px => { document.querySelector('audio-repl').style.width = px ? `${px}px` : '' }, px)
// what has the keys in the frame, by its class and its words
const focused = f => f.locator('body').evaluate(() => { const e = document.activeElement; return e === document.body ? '' : `${e.className.split(' ')[0]} ${e.textContent.trim() || e.ariaLabel || ''}`.trim() })
// In the frame: where each part is, against the inset's lines; what is shown past the frame's edges
const lay = f => f.locator('body').evaluate(() => {
  const q = s => document.querySelector(s), box = s => { const e = typeof s === 'string' ? q(s) : s; if (!e?.getClientRects().length) return null; const r = e.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height } }
  const inset = parseFloat(getComputedStyle(q('.view-head')).paddingLeft)
  const past = [...document.querySelectorAll('.view-head *, .status *')].filter(e => e.getClientRects().length && !e.closest('[popover], [aria-hidden="true"]') && !e.closest('[data-out]')).filter(e => { const r = e.getBoundingClientRect(); return r.width && (r.left < -.5 || r.right > innerWidth + .5 || r.bottom > innerHeight + .5) }).map(e => e.className || e.tagName)
  return { W: innerWidth, H: innerHeight, inset, past, box: Object.fromEntries(['.embed-sound', '.embed-sound-name', '.embed-chain', '.chain-add', '.head-end .history', '.head-end', '.head-end .embed-save span', '.status-end', '.facts .embed-view', '.readout', '.bar-kind', '.clock', '.view'].map(s => [s, box(s)])) }
})
// what the frame shows of each layout's parts: how many of each there are
const parts = f => f.locator('body').evaluate(() => Object.fromEntries(['.embed-ops', '.embed-chain', '.chain-add', '.head-end', '.bar-kind', '.facts .embed-view', '.status .history', '.view-head .history', '.status .embed-save', '.view-head .embed-save'].map(s => [s, [...document.querySelectorAll(s)].filter(e => e.getClientRects().length).length])))

// The sound's name, over the picture, has no icon before it, whatever the layout; the view's switch draws the waveform
// as five bars on a rhombus: short, taller, tallest, taller, short, alike either side of the middle and about the
// centre line, in the box the bars had (4 to 20 across, 3 to 21 down, of 24)
test('editor: embedded, the sound\'s name with no icon, the waveform\'s switch a regular rhombus of bars', async () => {
  const { f } = await mount('')
  await length(f, '0:08.000')
  assert.deepEqual(await f.locator('.embed-sound').evaluate(b => [...b.children].map(c => c.getAttribute('class'))), ['embed-sound-name'], 'the name alone: no icon before it, no chevron after it')
  const d = await f.locator('.embed-view path').getAttribute('d')
  // the bars, [x, top, bottom], from the path's moves and lines (M x y, then v and m relative)
  const bars = [], at = [0, 0]
  for (const [, c, args] of d.matchAll(/([MmVv])([^MmVv]*)/g)) {
    const n = args.trim().split(/[\s,]+|(?=-)/).filter(Boolean).map(Number)
    if (c === 'M') at.splice(0, 2, n[0], n[1]); else if (c === 'm') at.splice(0, 2, at[0] + n[0], at[1] + n[1])
    else { const to = c === 'V' ? n[0] : at[1] + n[0]; bars.push([at[0], Math.min(at[1], to), Math.max(at[1], to)]); at[1] = to }
  }
  assert.deepEqual(bars.map(b => b[0]), [4, 8, 12, 16, 20], `five bars, evenly apart: ${d}`)
  const tall = bars.map(([, a, b]) => b - a)
  assert.deepEqual(tall, [...tall].reverse(), `alike either side of the middle: ${tall}`)
  assert.ok(tall[0] < tall[1] && tall[1] < tall[2], `short, taller, tallest: ${tall}`)
  assert.ok(bars.every(([, a, b]) => a + b === 24), `each about the centre line: ${JSON.stringify(bars)}`)
  assert.equal(tall[1] - tall[0], tall[2] - tall[1], 'their ends on straight lines: a rhombus')
  assert.deepEqual([Math.min(...bars.map(b => b[1])), Math.max(...bars.map(b => b[2]))], [3, 21], 'in the box the bars had')
  assert.deepEqual(errors, [])
})

// As it was (edits menu, the default, as the lab's articles have it): the plus after the loop, a menu of them; the
// view's switch, the history and the save in the bar; no chain, no list or line of an older layout
test('editor: embedded, the edits as a menu stay as they were', async () => {
  for (const edits of ['', 'list', 'line']) {
    const { f } = await mount(edits)
    await length(f, '0:08.000')
    // (the history none till there is one: index.html .history)
    assert.deepEqual(await parts(f), { '.embed-ops': 1, '.embed-chain': 0, '.chain-add': 0, '.head-end': 0, '.bar-kind': 0, '.facts .embed-view': 1, '.status .history': 0, '.view-head .history': 0, '.status .embed-save': 1, '.view-head .embed-save': 0 }, `edits ${edits || 'unset'}`)
    assert.equal(await f.locator('.status .loop').evaluate(l => l.nextElementSibling?.classList.contains('embed-ops')), true, 'the plus after the loop')
    await f.locator('.embed-ops').click()
    assert.deepEqual(await f.locator('.menubar-menu .menu-label').allTextContents(), ['Trim', 'Normalize', 'Fade', 'Stretch', 'Pitch', 'Reverse'])
    await page.mouse.click(2, 2)
  }
  assert.deepEqual(errors, [])
})

// The chain (edits chain): nothing under the bar; the row over the picture the sound's name, a thin bar, the edits made
// in their order, a thin bar between one and the next, then past another bar the field, Edit…, in the name's plain
// words; at the row's right end the history and the save, its word on the inset's line. No arrow, no plus, no keys of
// suggestions, no pill, no ×: nothing on the row but words, their bars and the history's and the save's icons. One made,
// Delete on it takes it away, the keys on the one before it, the last taken away so the keys in the field, its list
// shut, each said in the live line; undone, back. Every key of it reached by the keys in its order
test('editor: embedded, the edits the chain: the name, those made parted by bars, the field Add edit, the history', async () => {
  const { f } = await mount('chain')
  await length(f, '0:08.000')
  assert.deepEqual(await parts(f), { '.embed-ops': 0, '.embed-chain': 1, '.chain-add': 1, '.head-end': 1, '.bar-kind': 1, '.facts .embed-view': 1, '.status .history': 0, '.view-head .history': 0, '.status .embed-save': 0, '.view-head .embed-save': 1 }, 'the history none till there is one')
  assert.deepEqual(await f.locator('.view-head').evaluate(h => [...h.children].filter(e => e.getClientRects().length).map(e => e.className.split(' ')[0])), ['embed-sound', 'embed-chain', 'head-end'], 'the name, the chain, its end')
  const order = () => f.locator('.embed-chain').evaluate(c => [...c.children].filter(e => e.getClientRects().length).map(e => e.className.split(' ')[0]))
  assert.deepEqual(await order(), ['chain-find'], 'none made: the field alone (the history at the row\'s end)')
  const field = f.locator('.chain-add')
  assert.deepEqual(await field.evaluate(e => [e.tagName, e.textContent, ...['aria-haspopup', 'aria-controls', 'aria-expanded'].map(a => e.getAttribute(a))]), ['BUTTON', 'Edit…', 'tree', 'edits-found', 'false'], 'a button that opens a list, as a select\'s')
  // in the name's plain words: its face and size, no border, no ground at rest, no sign
  const look = await f.locator('body').evaluate(() => { const cs = s => getComputedStyle(document.querySelector(s)), a = cs('.chain-add'); return { face: a.fontFamily === cs('.embed-sound-name').fontFamily, size: a.fontSize === cs('.embed-sound-name').fontSize, border: a.borderTopWidth, ground: a.backgroundColor, chevron: !!document.querySelector('.chain-add svg') } })
  assert.deepEqual(look, { face: true, size: true, border: '0px', ground: 'rgba(0, 0, 0, 0)', chevron: false }, 'no sign: no plus, no chevron')
  assert.equal(await f.locator('.view-head').evaluate(h => !!h.querySelector('.chain-hint, .chain-more, .chain-hints, [class*="arrow"]')), false, 'no keys of suggestions, no dropdown, no arrow')
  const l = await lay(f), right = l.W - l.inset, near = (a, b, d = 1.5) => Math.abs(a - b) <= d
  assert.ok(l.box['.status-end'].bottom >= l.H - 1 && l.box['.clock'].bottom > l.H - 60, 'nothing under the bar')
  assert.ok(near(l.box['.head-end .embed-save span'].right, right, 2) && l.box['.head-end'].top < l.box['.view'].top, `the save at the row's right end, its word on the inset's line: ${l.box['.head-end .embed-save span'].right} for ${right}`)
  assert.ok(near(l.box['.embed-sound-name'].left, l.inset) && l.box['.embed-chain'].left > l.box['.embed-sound'].right, 'the name on the inset\'s line, the chain after it')
  // the kind before the level, on its baseline
  assert.equal(await f.locator('.bar-kind').textContent(), 'chime')
  assert.ok(l.box['.bar-kind'].right < l.box['.readout'].left && near(l.box['.bar-kind'].bottom, l.box['.readout'].bottom, 1), 'the kind before the level')
  // edits made by the field: in the order made, before it, the history after it
  await make(f, 'stretch')
  await length(f, '0:10.000')
  await poll(() => made(f), ks => assert.deepEqual(ks, ['Stretch 1.25×']))
  await make(f, 'reverse')
  await poll(() => made(f), ks => assert.deepEqual(ks, ['Stretch 1.25×', 'Reverse']))
  assert.deepEqual(await order(), ['chain-step', 'chain-step', 'chain-find'], 'those made, the field where the next will stand')
  // a thin bar after the name, one between the two made, one before the field; none before the first made
  const bars = await f.locator('.embed-chain').evaluate(c => [getComputedStyle(c, '::before'), ...[...c.querySelectorAll('.chain-step, .chain-find')].map(s => getComputedStyle(s, '::before'))].map(b => b.content === '""' && parseFloat(b.width) === 1 && b.display !== 'none'))
  assert.deepEqual(bars, [true, false, true, true], 'a bar after the name, between the two made, before the field')
  // no ×: an edit made is its button alone
  assert.deepEqual(await f.locator('.chain-step').evaluateAll(ss => ss.map(s => [...s.children].map(c => c.className))), [['chain-edit'], ['chain-edit']], 'each made, its button alone')
  assert.equal(await f.locator('.chain-drop, .embed-chain [aria-label*="away"]').count(), 0, 'no ×')
  // the keys through every key of the row, in order: the name, each made, the field, the history (Undo alone: nothing
  // to redo), the save
  await page.mouse.move(2, 2)
  await f.locator('.embed-sound').focus()
  const walk = []
  for (let i = 0; i < 6; i++) { await page.keyboard.press('Tab'); walk.push(await focused(f)) }
  assert.deepEqual(walk, ['chain-edit Stretch1.25×', 'chain-edit Reverse', 'chain-add Edit…', 'icon-button Undo', 'icon-button Redo', 'embed-save Save'], `the keys' way, Redo dimmed among them: ${walk}`)
  // Delete on an edit: taken away, the keys on the edit before it; the last so, the keys in the field, its list shut;
  // each said; undone, back
  await f.locator('.chain-edit', { hasText: 'Reverse' }).focus()
  await page.keyboard.press('Delete')
  await poll(() => made(f), ks => assert.deepEqual(ks, ['Stretch 1.25×']))
  await poll(() => focused(f), on => assert.equal(on, 'chain-edit Stretch1.25×', 'the keys on the edit before it'))
  assert.equal(await said(f), 'Reverse removed.')
  await page.keyboard.press('Backspace')
  await length(f, '0:08.000')
  await poll(() => made(f), ks => assert.deepEqual(ks, []))
  await poll(() => f.locator('body').evaluate(() => [document.activeElement.className, document.querySelector('#edits-found').matches(':popover-open')]), on => assert.deepEqual(on, ['chain-add', false], 'the keys in the field, its list shut'))
  assert.equal(await said(f), 'Stretch removed.')
  await f.locator('.head-end .undo').click()
  await poll(() => made(f), ks => assert.deepEqual(ks, ['Stretch 1.25×']))
  // the save, at the row's end: its menu of formats
  await f.locator('.head-end .embed-save').click()
  assert.deepEqual(await f.locator('.menubar-menu .menu-label').allTextContents(), ['WAV', 'FLAC', 'MP3', 'OGG', 'AIFF'])
  await page.keyboard.press('Escape')
  assert.deepEqual(errors, [])
})

// The field, Edit…, a button as a select's: pressed, its list under it, never over it, within the frame, a search at its
// top the keys are in; its groups parted by a hairline: Suggested under a small head, four of the page's edits, each
// its values, what it does its title; Recipes under its own, the automatic edit, the recipe the sound's kind is offered
// (the chime's word has no row: the general one's) and the next two, each how many edits it makes, what it does and its
// edits its title, then More recipes; then a row a kind, as the Process menu has them (no generator). The first lit;
// the arrows move it, round; typed in the search, every edit and every recipe whose name, values or what it does hold
// the words, flat; Enter makes the lit one, the list shut, the search empty, its settings shut, the keys on the field;
// Escape shuts it, the keys on the field; a letter typed on the field opens it, the letter in the search; a press on
// one makes it, the keys back with the page
both('the chain\'s field: Suggested, Recipes, a row a kind; typed in its search, flat', async full => {
  const { f } = await mount('chain', { full })
  await length(f, '0:08.000')
  const field = f.locator('.chain-add'), list = f.locator('#edits-found'), search = f.locator('.found-search')
  const state = () => f.locator('body').evaluate(() => { const l = document.querySelector('#edits-found'), field = document.querySelector('.chain-add'), search = document.querySelector('.found-search'), r = l.getBoundingClientRect(), fr = field.getBoundingClientRect(); return { open: l.matches(':popover-open'), expanded: field.getAttribute('aria-expanded'), lit: search.getAttribute('aria-activedescendant'), selected: [...l.querySelectorAll('[aria-selected="true"]')].map(o => o.id), within: r.top >= 0 && r.left >= 0 && r.bottom <= innerHeight + .5 && r.right <= innerWidth + .5, under: r.top >= fr.bottom, keys: document.activeElement === search ? 'search' : document.activeElement === field ? 'field' : '', value: search.value } })
  await field.click()
  await poll(state, s => assert.deepEqual(s, { open: true, expanded: 'true', lit: 'edits-found-0', selected: ['edits-found-0'], within: true, under: true, keys: 'search', value: '' }))
  const groups = await listed(f)
  assert.deepEqual(groups, [['Trim silence', 'Normalize', 'Fade', 'Stretch'], ['Repair and level this sound', 'Repair a damaged recording', 'Clean up a voice recording', 'Enhance speech', 'More recipes'], KINDS], 'Suggested: four of the page\'s edits; then Recipes, the automatic edit, the recipe the sound is offered first and the next two, the rest a row away; a row a kind, as the Process menu has them, no generator')
  assert.deepEqual(await shown(f), SUGGESTED, 'each its name and its values')
  assert.deepEqual(await list.locator('.found-head').allTextContents(), ['Suggested', 'Recipes'], 'two sections, each named by a small head')
  assert.equal(await list.locator('.found-about').count(), 0, 'no line of what each does')
  await poll(() => list.locator('.found-group').first().locator('.found-row').evaluateAll(rs => rs.map(r => r.title)), titles => assert.deepEqual(titles, ['Cut silence from both ends', 'Set peak or loudness', 'Fade in and out', 'Longer or shorter, same pitch'], 'each edit what it does, its title'))
  assert.equal(await list.locator('.found-group').first().locator('.found-row > svg:first-child path[d]').count(), 4, 'each its icon')
  assert.deepEqual(await list.locator('.found-group[aria-label="Recipes"] .found-row').evaluateAll(rs => rs.slice(1, 2).map(r => [r.querySelector('.found-hint').textContent, r.title])), [['4 edits', 'Clipped peaks rebuilt, clicks and hum taken out where they are found, the peak at −1 dB']], 'a recipe how many edits it makes, what it does its title')
  // the arrows, round
  await page.keyboard.press('ArrowUp')
  await poll(state, s => assert.equal(s.lit, `edits-found-${groups.flat().length - 1}`, 'round from the first to the last'))
  await page.keyboard.press('ArrowDown')
  await poll(state, s => assert.equal(s.lit, 'edits-found-0'))
  // typed: flat, every edit and recipe that holds the words; a plain name found by what it says (pauses: shrink)
  await page.keyboard.type('no')
  await poll(() => listed(f), gs => assert.ok(gs.flat().includes('Normalize') && gs.flat().includes('Notch') && !gs.flat().includes('Reverse') && !gs.flat().includes('Filter'), `what holds "no", flat: ${JSON.stringify(gs)}`))
  await search.fill('podcast')
  await poll(() => listed(f), gs => assert.ok(gs.flat().includes('Podcast episode'), `recipes among them: ${JSON.stringify(gs)}`))
  await search.fill('pauses')
  await poll(() => listed(f), gs => assert.equal(gs.flat()[0], 'Shrink pauses'))
  await search.fill('zzz')
  await poll(() => list.locator('.found-none').textContent(), t => assert.equal(t, 'No edit by that name'))
  // Enter makes the lit one: the list shut, the search empty, its settings shut (its values set in the list, or by
  // pressing it in the chain), the keys on the field for the next; the recipes as they were
  await search.fill('stre')
  await poll(() => listed(f), gs => assert.equal(gs[0][0], 'Stretch'))
  await page.keyboard.press('Enter')
  await length(f, '0:10.000')
  await poll(() => made(f), ks => assert.deepEqual(ks, ['Stretch 1.25×']))
  await poll(state, s => assert.deepEqual([s.open, s.expanded, s.value, s.keys], [false, 'false', '', 'field']))
  assert.equal(await f.locator('#step-settings').evaluate(p => p.matches(':popover-open')), false, 'its settings shut')
  assert.deepEqual(await shown(f), ['Trim silence −40dB', 'Normalize −1dB', 'Fade 1s, 1s', 'Pitch −2st'], 'Stretch made: gone from Suggested, the next in its place')
  // a letter typed on the field: the list open, the letter in its search; Escape: shut, the search empty, the keys on
  // the field
  await page.keyboard.type('pit')
  await poll(state, s => assert.deepEqual([s.open, s.value, s.keys], [true, 'pit', 'search']))
  await page.keyboard.press('Escape')
  await poll(state, s => assert.deepEqual([s.open, s.value, s.keys], [false, '', 'field']))
  // by the keys, a kind's: Gain, at its default
  await page.keyboard.press('Enter')
  await poll(state, s => assert.equal(s.open, true))
  await search.fill('gain')
  await page.keyboard.press('Enter')
  await poll(() => made(f), ks => assert.deepEqual(ks, ['Stretch 1.25×', 'Gain 0dB'], 'at the value its row says: gain(0)'))
  // a press on one makes it, the keys back with the page, so Space plays; pressed again, the field shuts its list
  await field.click()
  await poll(state, s => assert.equal(s.open, true))
  await field.click()
  await poll(state, s => assert.equal(s.open, false, 'pressed again, shut'))
  await field.click()
  await poll(state, s => assert.equal(s.open, true))
  await list.locator('.found-row', { hasText: 'Trim silence' }).first().click()
  await poll(() => made(f), ks => assert.deepEqual(ks, ['Stretch 1.25×', 'Gain 0dB', 'Trim −40dB'], 'the chain shows the call'))
  await poll(state, s => assert.deepEqual([s.open, s.keys], [false, '']))
  assert.deepEqual(await shown(f), ['Normalize −1dB', 'Fade 1s, 1s', 'Pitch −2st', 'Reverse'], 'made, gone from Suggested, the next in its place')
  // on a phone, the list as wide as the frame, 8 px in from either side, under the field
  if (full) return assert.deepEqual(errors, [])
  await width(390)
  await poll(() => f.locator('body').evaluate(() => innerWidth), w => assert.equal(w, 390))
  await field.click()
  await poll(() => f.locator('body').evaluate(() => { const r = document.querySelector('#edits-found').getBoundingClientRect(), fr = document.querySelector('.chain-add').getBoundingClientRect(); return [Math.round(r.left), Math.round(innerWidth - r.right), r.top >= fr.bottom] }), at => assert.deepEqual(at, [8, 8, true]))
  await page.keyboard.press('Escape')
  await width(null)
  assert.deepEqual(errors, [])
})

// An edit made, pressed: its settings drop from it, as an edit's card opens to them (settings.js): what it does, a
// slider or a choice each. A choice or a slider writes its value into the script, the edit's values with it (its tab's
// too), each one undo step; the same edit pressed again, or Escape, closes them (Escape the keys back on the edit); one
// with no settings shows what it does alone, then Remove. Pressed by the keys, the keys on its first setting
both('an edit of the chain pressed opens its settings; a choice or a slider sets it, undone as any', async full => {
  const { f } = await mount('chain', { full })
  await length(f, '0:08.000')
  for (const name of ['Normalize', 'Reverse']) { await make(f, name.toLowerCase()); await poll(() => made(f), ks => assert.ok(ks.some(k => k.startsWith(name)))) }
  const panel = f.locator('#step-settings'), open = () => panel.evaluate(p => p.matches(':popover-open'))
  const edit = f.locator('.chain-edit', { hasText: 'Normalize' }), tab = () => panel.locator('.step-tab').evaluate(t => [...t.children].map(c => c.textContent))
  await edit.click()
  await poll(open, o => assert.equal(o, true))
  assert.deepEqual([await tab(), await panel.locator('.step-about').textContent()], [['Normalize', '−1dB'], 'Set peak or loudness'])
  assert.deepEqual(await panel.locator('.param label').allTextContents(), ['target', 'mode'], 'a slider for its target, a choice of its mode')
  assert.equal(await edit.getAttribute('aria-expanded'), 'true')
  const r = [await edit.boundingBox(), await panel.locator('.step-body').boundingBox()]
  assert.ok(Math.abs(r[1].y - (r[0].y + r[0].height)) <= 1 && Math.abs(r[1].x - r[0].x) <= 1, `under the edit, at its left: ${JSON.stringify(r)}`)
  await panel.locator('.choices button', { hasText: 'lufs' }).click()
  await poll(() => made(f), ks => assert.deepEqual(ks, ['Normalize −1dB, lufs', 'Reverse']))
  assert.deepEqual(await tab(), ['Normalize', '−1dB, lufs'], 'its tab says so too')
  assert.equal(await open(), true, 'open still')
  // (the slider moved to its middle, as a drag lets it go there)
  await panel.locator('input[type="range"]').evaluate(input => { input.value = 500; input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true })) })
  await poll(() => made(f), ks => assert.deepEqual(ks, ['Normalize −18dB, lufs', 'Reverse']))
  assert.equal(await panel.locator('.param output').first().textContent(), '−18dB', 'its value by its slider')
  // pressed again: closed
  await edit.click()
  await poll(open, o => assert.equal(o, false))
  assert.equal(await edit.getAttribute('aria-expanded'), 'false')
  // the slider one step back, the choice another
  await f.locator('.head-end .undo').click()
  await poll(() => made(f), ks => assert.deepEqual(ks, ['Normalize −1dB, lufs', 'Reverse']))
  await f.locator('.head-end .undo').click()
  await poll(() => made(f), ks => assert.deepEqual(ks, ['Normalize −1dB', 'Reverse']))
  // by the keys: the keys on its first setting; Escape closes, the keys back on the edit
  await edit.focus()
  await page.keyboard.press('Enter')
  await poll(open, o => assert.equal(o, true))
  await poll(() => f.locator('body').evaluate(() => document.activeElement.matches('#step-settings input[type="range"]')), on => assert.equal(on, true))
  await page.keyboard.press('Escape')
  await poll(open, o => assert.equal(o, false))
  await poll(() => focused(f), on => assert.equal(on, 'chain-edit Normalize−1dB'))
  // one with none: what it does, then Remove, no settings shown; a press outside closes it
  await f.locator('.chain-edit', { hasText: 'Reverse' }).click()
  await poll(() => panel.locator('.step-about').textContent(), t => assert.equal(t, 'Play backwards'))
  assert.deepEqual(await panel.evaluate(p => [p.querySelector('.params').checkVisibility(), p.querySelector('.step-remove').checkVisibility()]), [false, true], 'no settings, Remove')
  await f.locator('.status-end').click({ position: { x: 4, y: 4 } })
  await poll(open, o => assert.equal(o, false))
  assert.deepEqual(errors, [])
})

// A setting that makes the sound longer or shorter takes what is selected with the sound: the same moments of it, so a
// selection past the shorter one's end is not lost, and the loop playing it plays them. A stretch's method does: of
// stretch(8), wsola stretches 4× at most, PaulStretch 8×, phase-lock any (the factor's max in @audio/stretch-wsola's
// and @audio/stretch-paulstretch's audio.js; the chime is 8 s, so 32 s and 64 s). One that keeps the length keeps the
// selection's times
test('editor: embedded, a stretch\'s method that changes the length keeps the selection on the same sound, the loop with it', async () => {
  const { f } = await mount('chain', { script: "audio('chime.wav').stretch(8)", controls: `${CONTROLS} loop` })
  await length(f, '1:04.000')
  const secs = text => text.split(':').reduce((s, p) => s * 60 + +p, 0)
  const sel = async () => (await f.locator('.clock').evaluate(e => e.title || e.dataset.popoffTitle || '')).match(/^Selected (\S+)–(\S+):/)?.slice(1).map(secs) ?? null
  const near = (got, want, what) => assert.ok(got && want.every((t, i) => Math.abs(got[i] - t) < .002), `${what}: ${JSON.stringify(got)}, not ${JSON.stringify(want)}`)
  const panel = f.locator('#step-settings'), open = () => panel.evaluate(p => p.matches(':popover-open'))
  const method = async name => {
    if (!await open()) await f.locator('.chain-edit', { hasText: 'Stretch' }).click()
    await poll(open, o => assert.equal(o, true))
    await panel.locator('.choices button', { hasText: new RegExp(`^${name}$`) }).click()
  }
  // past the half of it: 40 s to 48 s, as near as the pointer lands
  const box = await f.locator('.plot').boundingBox(), x = t => box.x + t / 64 * box.width, y = box.y + box.height * .4
  await page.mouse.move(x(40), y)
  await page.mouse.down()
  await page.mouse.move(x(48), y, { steps: 6 })
  await page.mouse.up()
  const [a, b] = await poll(sel, s => assert.ok(s && s[0] > 32 && s[1] > s[0], `selected ${s}`))
  // (the loop on as the editor opens, embedded too)
  assert.equal(await f.getByRole('button', { name: 'Loop' }).getAttribute('aria-pressed'), 'true')
  await f.getByRole('button', { name: 'Play', exact: true }).click()
  await f.getByRole('button', { name: 'Pause' }).waitFor()
  // wsola, 4×: the sound half as long, the selection half as far in and as long; once it is whole (the sound before
  // playing on till then, as any new output takes over), the loop in it
  await method('wsola')
  await poll(() => f.locator('.clock .length').textContent(), t => assert.ok(Math.abs(secs(t) - (b - a) / 2) < .002, `the selection's length ${t}`), 15000)
  await f.locator('body').evaluate(() => __settled())
  await page.waitForTimeout(250)
  for (let i = 0; i < 6; i++, await page.waitForTimeout(250)) {
    const t = secs(await f.locator('.clock .time').textContent())
    assert.ok(t >= a / 2 - .05 && t <= b / 2 + .05, `the loop plays ${t}, outside ${a / 2}–${b / 2}`)
  }
  await f.getByRole('button', { name: 'Pause' }).click()
  near(await poll(sel, s => assert.ok(s)), [a / 2, b / 2], 'on wsola')
  // PaulStretch, 8×: back where it was
  await method('paulstretch')
  await poll(sel, s => near(s, [a, b], 'on PaulStretch'), 15000)
  // phase-lock, 8× too: the length kept, the times kept
  await method('phase-lock')
  await poll(() => panel.locator('.choices button[aria-pressed="true"]').textContent(), t => assert.equal(t, 'phase-lock'))
  await f.locator('body').evaluate(() => __settled())
  near(await sel(), [a, b], 'on phase-lock')
  assert.deepEqual(errors, [])
})

// A slider's drags, each one undo step, undone and redone through each value they set: a drag's live moves never reach
// the history, which would map its steps through them and leave a step that set the same value half undone (a dither
// set to 12, then dragged to 18, undone twice read 1216). Before the code's editor comes (the first undo brings it) and
// after
test('editor: embedded, an edit\'s slider dragged twice, undone and redone through each value it set', async () => {
  const { f } = await mount('chain')
  await length(f, '0:08.000')
  await make(f, 'dither')
  await poll(() => made(f), ks => assert.deepEqual(ks, ['Dither 16bit']))
  const panel = f.locator('#step-settings'), open = () => panel.evaluate(p => p.matches(':popover-open'))
  if (!await open()) await f.locator('.chain-edit', { hasText: 'Dither' }).click()
  await poll(open, o => assert.equal(o, true))
  // (a drag: its moves live, then let go)
  const drag = (...xs) => panel.locator('input[type="range"]').first().evaluate((input, xs) => { for (const x of xs) { input.value = x; input.dispatchEvent(new Event('input', { bubbles: true })) } input.dispatchEvent(new Event('change', { bubbles: true })) }, xs)
  const undo = () => f.locator('.head-end .undo').click(), redo = () => f.locator('.head-end .redo').click()
  const steps = async (moves, ...want) => { for (let i = 0; i < moves.length; i++) { await moves[i](); await poll(() => made(f), ks => assert.deepEqual(ks, [want[i]], `after move ${i + 1}`)) } }
  for (const round of ['before the code\'s editor', 'with it']) {
    await drag(400, 300, 250)
    await poll(() => made(f), ks => assert.deepEqual(ks, ['Dither 12bit'], round))
    await drag(400, 500, 625)
    await poll(() => made(f), ks => assert.deepEqual(ks, ['Dither 18bit'], round))
    // (and one let go where it began, no step)
    await drag(700, 625)
    await steps([undo, undo, redo, redo], 'Dither 12bit', 'Dither 16bit', 'Dither 12bit', 'Dither 18bit')
    await steps([undo, undo], 'Dither 12bit', 'Dither 16bit')
    if (!await open()) await f.locator('.chain-edit', { hasText: 'Dither' }).click()
    await poll(open, o => assert.equal(o, true))
  }
  assert.deepEqual(errors, [])
})

// The settings drop from the edit as one shape with it, as the old widget's pill and its menu were: over the edit its
// tab, the edit again (its name and its values) on the settings' ground, as wide and as tall as it; joined under it at
// the edit's left edge, no gap, that corner square, the body: what it does (the name not again), its settings, Remove
// at their foot. As the list is set, the tab at the words' size, all under it at the small text's. Remove takes the
// edit away, one undo step, the settings shut, said in the live line; by the keys, the keys go on to the edit before it.
// In a phone's frame, inside it
test('editor: embedded, an edit\'s settings drop from it as one shape, Remove at their foot', async () => {
  const { f } = await mount('chain')
  await length(f, '0:08.000')
  for (const name of ['Normalize', 'Reverse']) { await make(f, name.toLowerCase()); await poll(() => made(f), ks => assert.ok(ks.some(k => k.startsWith(name)))) }
  const panel = f.locator('#step-settings'), open = () => panel.evaluate(p => p.matches(':popover-open'))
  const shape = () => f.locator('body').evaluate(() => {
    const q = s => document.querySelector(s), box = e => { const r = e.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom } }
    const tab = q('.step-tab'), body = q('.step-body'), cs = getComputedStyle(body)
    return { edit: box(q('.chain-edit[aria-expanded="true"]')), tab: box(tab), body: box(body), words: [...tab.children].map(c => c.textContent), ground: [getComputedStyle(tab).backgroundColor, cs.backgroundColor], corner: cs.borderTopLeftRadius, text: body.textContent.replace(/\s+/g, ' ').trim(), W: innerWidth, H: innerHeight }
  })
  const near = (a, b) => Math.abs(a - b) <= 1
  await f.locator('.chain-edit', { hasText: 'Normalize' }).click()
  await poll(open, o => assert.equal(o, true))
  const s = await shape()
  assert.ok(['left', 'right', 'top', 'bottom'].every(k => near(s.tab[k], s.edit[k])), `the tab over the edit, as wide and as tall: ${JSON.stringify([s.tab, s.edit])}`)
  assert.deepEqual(s.words, ['Normalize', '−1dB'], 'the tab says what the edit says')
  assert.ok(near(s.body.top, s.tab.bottom) && near(s.body.left, s.tab.left) && s.body.right > s.tab.right, `the body joined under it at its left edge, no gap: ${JSON.stringify([s.tab, s.body])}`)
  assert.deepEqual([s.ground[0] === s.ground[1], s.corner], [true, '0px'], 'one ground, the corner it joins at square')
  assert.ok(!s.text.includes('Normalize') && s.text.includes('Set peak or loudness') && s.text.endsWith('Remove'), `what it does, its settings, Remove; no name again: ${s.text}`)
  assert.deepEqual(await panel.evaluate(p => ['.step-tab', '.step-about', '.param label', '.param output', '.choices button', '.step-remove'].map(k => getComputedStyle(p.querySelector(k)).fontSize)), ['16px', '13px', '13px', '13px', '13px', '13px'], 'the tab at the words\' size, all under it at the small text\'s')
  // Remove, by the pointer: taken away, one undo step, the settings shut
  await panel.locator('.step-remove').click()
  await poll(() => made(f), ks => assert.deepEqual(ks, ['Reverse']))
  assert.equal(await open(), false, 'shut')
  assert.equal(await said(f), 'Normalize removed.')
  await f.locator('.head-end .undo').click()
  await poll(() => made(f), ks => assert.deepEqual(ks, ['Normalize −1dB', 'Reverse']))
  // one with no settings, by the keys: what it does, the keys on Remove, its one key; pressed, the keys on the edit
  // before it
  await f.locator('.chain-edit', { hasText: 'Reverse' }).focus()
  await page.keyboard.press('Enter')
  await poll(open, o => assert.equal(o, true))
  assert.equal(await panel.locator('.step-about').textContent(), 'Play backwards')
  await poll(() => focused(f), on => assert.equal(on, 'step-remove Remove'))
  await page.keyboard.press('Enter')
  await poll(() => made(f), ks => assert.deepEqual(ks, ['Normalize −1dB']))
  await poll(() => focused(f), on => assert.equal(on, 'chain-edit Normalize−1dB', 'the keys on the edit before it'))
  assert.equal(await open(), false)
  // a phone's frame: the edit on the chain's own row, its settings joined under it, inside the frame
  await width(390)
  await poll(() => f.locator('body').evaluate(() => innerWidth), w => assert.equal(w, 390))
  await f.locator('.chain-edit', { hasText: 'Normalize' }).click()
  await poll(open, o => assert.equal(o, true))
  await poll(shape, p => assert.ok(near(p.body.top, p.tab.bottom) && p.body.left >= 0 && p.body.right <= p.W && p.body.bottom <= p.H && near(p.tab.left, p.edit.left), `inside the frame: ${JSON.stringify(p)}`))
  await page.keyboard.press('Escape')
  await width(null)
  assert.deepEqual(errors, [])
})

// The field a button as wide as what it says and its chevron, in its face at its size: its list open and typed in, it
// stays as it was, so nothing on the row moves as an edit is looked for
test('editor: embedded, the chain\'s field as wide as its words, still as its list is typed in', async () => {
  const { f } = await mount('chain')
  await length(f, '0:08.000')
  const field = f.locator('.chain-add')
  const fit = () => field.evaluate(e => { const cs = getComputedStyle(e), r = e.getBoundingClientRect(), words = e.querySelector('span').getBoundingClientRect(); return { width: Math.round(r.width), left: Math.round(r.left), top: Math.round(r.top), words: words.width < r.width, size: cs.fontSize } })
  const rest = await fit()
  assert.ok(rest.words && rest.size === '16px', `its words and its chevron: ${JSON.stringify(rest)}`)
  await field.click()
  await page.keyboard.type('gain, then a long word')
  assert.deepEqual(await fit(), rest, 'typed in its list: the field as it was')
  await page.keyboard.press('Escape')
  assert.deepEqual(await fit(), rest)
  assert.deepEqual(errors, [])
})

// a drag by the pointer, pressed at the middle of `from` (a locator) and moved in steps to `to` ({ x, y }); let go there
// unless held
async function drag(from, to, hold = false) {
  const a = await point(from)
  await page.mouse.move(a.x, a.y)
  await page.mouse.down()
  await page.mouse.move(to.x, to.y, { steps: 12 })
  if (!hold) await page.mouse.up()
}
// a point in a locator's box, `fx` across, halfway down: read once the chain's edits have slid to their places (a
// drop's, a put back's slide), so the box is where it stays
async function point(loc, fx = .5) {
  await loc.evaluate(e => Promise.all(e.ownerDocument.querySelector('.embed-chain').getAnimations({ subtree: true }).map(a => a.finished.catch(() => {}))))
  const b = await loc.boundingBox()
  return { x: b.x + b.width * fx, y: b.y + b.height / 2 }
}
// the script, as the page has it now
const script = f => f.locator('body').evaluate(async () => (await import('/repl/editor/context.js')).ed.code)

// Dragged along the chain, as the old widget's pills were: the others make room as it passes; let go, it stands there,
// one undo step, the drop opening nothing, said in the live line. While one is carried, the field is a trash can,
// Remove, lit while the edit would land on it, the copy under the pointer gone there; let go there, it is taken away.
// Escape, or a drop far off the chain, puts it back, the script as it was; a press that does not move still opens its
// settings
both('an edit dragged along the chain moves there, onto the field it is taken away', async full => {
  const { f } = await mount('chain', { full })
  await length(f, '0:08.000')
  for (const name of ['normalize', 'reverse', 'stretch']) { const n = (await made(f)).length; await make(f, name); await poll(() => made(f), ks => assert.equal(ks.length, n + 1)) }
  await page.mouse.move(2, 2)
  const edit = name => f.locator('.chain-step > .chain-edit', { hasText: name }), open = () => f.locator('#step-settings').evaluate(p => p.matches(':popover-open'))
  await poll(open, o => assert.equal(o, false))
  // as laid now, left to right, the place kept for the one carried among them; the field as a trash can, lit or not,
  // and the copy carried, seen or not
  const laid = () => f.locator('.chain-step').evaluateAll(ss => ss.sort((a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left).map(s => s.textContent))
  const look = () => f.locator('body').evaluate(() => { const c = document.querySelector('.chain-carried'); return { trash: !!document.querySelector('.chain-trash').checkVisibility(), words: document.querySelector('.chain-trash').textContent, lit: document.querySelector('.chain-find').hasAttribute('data-lit'), carried: c ? getComputedStyle(c).visibility : 'none' } })
  const ORDER = ['Normalize −1dB', 'Reverse', 'Stretch 1.25×']
  assert.deepEqual(await made(f), ORDER)
  const was = await script(f)
  // Normalize past Reverse: Reverse makes room, the field a trash can, unlit; let go, it stands there
  await drag(edit('Normalize'), await point(edit('Reverse'), .9), true)
  await poll(laid, names => assert.deepEqual(names, ['Reverse', 'Normalize−1dB', 'Stretch1.25×'], 'Reverse made room'))
  assert.deepEqual(await look(), { trash: true, words: 'Remove', lit: false, carried: 'visible' })
  assert.equal(await script(f), was, 'nothing written while it is carried')
  await page.mouse.up()
  await poll(() => made(f), ks => assert.deepEqual(ks, ['Reverse', 'Normalize −1dB', 'Stretch 1.25×']))
  assert.equal(await said(f), 'Normalize moved to position 2 of 3.')
  assert.deepEqual([await open(), await look()], [false, { trash: false, words: 'Remove', lit: false, carried: 'none' }], 'the drop opened nothing; the field itself again')
  // one undo step
  await f.locator('.head-end .undo').click()
  await poll(() => made(f), ks => assert.deepEqual(ks, ORDER))
  assert.equal(await script(f), was)
  // Escape while carried: put back, the script as it was
  await drag(edit('Stretch'), await point(edit('Normalize'), .1), true)
  await poll(laid, names => assert.deepEqual(names, ['Stretch1.25×', 'Normalize−1dB', 'Reverse']))
  await page.keyboard.press('Escape')
  await page.mouse.up()
  await poll(look, l => assert.equal(l.carried, 'none'))
  assert.deepEqual([await made(f), await script(f), await open()], [ORDER, was, false], 'Escape: put back')
  // let go far off the chain, over the picture: put back
  const below = await point(edit('Reverse'))
  await drag(edit('Reverse'), { x: below.x, y: below.y + 160 })
  await poll(look, l => assert.equal(l.carried, 'none'))
  assert.deepEqual([await made(f), await script(f)], [ORDER, was], 'far off: put back')
  // onto the field: lit, the copy gone from under the pointer; let go, taken away, one undo step
  await drag(edit('Reverse'), await point(f.locator('.chain-find')), true)
  await poll(look, l => assert.deepEqual(l, { trash: true, words: 'Remove', lit: true, carried: 'hidden' }))
  await page.mouse.up()
  await poll(() => made(f), ks => assert.deepEqual(ks, ['Normalize −1dB', 'Stretch 1.25×']))
  assert.equal(await said(f), 'Reverse removed.')
  await f.locator('.head-end .undo').click()
  await poll(() => made(f), ks => assert.deepEqual(ks, ORDER))
  // a press that does not move: its settings open
  await edit('Stretch').click()
  await poll(open, o => assert.equal(o, true))
  assert.deepEqual(errors, [])
})

// By the keys on an edit, as the old widget's pills: Alt and an arrow move it a place, the keys with it, each move an
// undo step, said in the live line; none past either end. Its description says so
both('Alt and an arrow move an edit of the chain a place', async full => {
  const { f } = await mount('chain', { full })
  await length(f, '0:08.000')
  for (const name of ['normalize', 'reverse', 'stretch']) { const n = (await made(f)).length; await make(f, name); await poll(() => made(f), ks => assert.equal(ks.length, n + 1)) }
  const edit = f.locator('.chain-edit', { hasText: 'Normalize' })
  assert.match(await edit.getAttribute('aria-description'), /Drag.*Alt and an arrow move it; Delete removes it/)
  await edit.focus()
  await page.keyboard.press('Alt+ArrowRight')
  await poll(() => made(f), ks => assert.deepEqual(ks, ['Reverse', 'Normalize −1dB', 'Stretch 1.25×']))
  await poll(() => focused(f), on => assert.equal(on, 'chain-edit Normalize−1dB', 'the keys with it'))
  assert.equal(await said(f), 'Normalize moved to position 2 of 3.')
  await page.keyboard.press('Alt+ArrowRight')
  await poll(() => made(f), ks => assert.deepEqual(ks, ['Reverse', 'Stretch 1.25×', 'Normalize −1dB']))
  assert.equal(await said(f), 'Normalize moved to position 3 of 3.')
  await poll(() => focused(f), on => assert.equal(on, 'chain-edit Normalize−1dB'))
  const was = await script(f)
  await page.keyboard.press('Alt+ArrowRight')
  await page.waitForTimeout(200)
  assert.equal(await script(f), was, 'none past the end')
  await page.keyboard.press('Alt+ArrowLeft')
  await poll(() => made(f), ks => assert.deepEqual(ks, ['Reverse', 'Normalize −1dB', 'Stretch 1.25×']))
  await f.locator('.head-end .undo').click()
  await poll(() => made(f), ks => assert.deepEqual(ks, ['Reverse', 'Stretch 1.25×', 'Normalize −1dB']))
  assert.deepEqual(errors, [])
})

// A finger, as Chrome's touch screen has it: dragged along the chain, it moves an edit as the pointer does; a swipe up
// that starts on an edit is the page's, scrolling it, nothing moved (touch-action pan-y)
test('editor: embedded, a finger drags an edit along the chain; a swipe up on it scrolls the page', async () => {
  const { f } = await mount('chain')
  await length(f, '0:08.000')
  for (const name of ['normalize', 'reverse']) { const n = (await made(f)).length; await make(f, name); await poll(() => made(f), ks => assert.equal(ks.length, n + 1)) }
  await page.evaluate(() => { document.body.style.height = '3000px' })
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 })
  const touch = async (from, to) => {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [from] })
    for (let i = 1; i <= 12; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: from.x + (to.x - from.x) * i / 12, y: from.y + (to.y - from.y) * i / 12 }] })
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  }
  const edit = name => f.locator('.chain-step > .chain-edit', { hasText: name })
  await touch(await point(edit('Normalize')), await point(edit('Reverse'), .9))
  await poll(() => made(f), ks => assert.deepEqual(ks, ['Reverse', 'Normalize −1dB']))
  const was = await script(f), from = await point(edit('Reverse'))
  await touch(from, { x: from.x, y: from.y - 200 })
  await poll(() => page.evaluate(() => scrollY), y => assert.ok(y > 50, `the page scrolled: ${y}`))
  assert.deepEqual([await made(f), await script(f)], [['Reverse', 'Normalize −1dB'], was], 'nothing moved')
  assert.deepEqual(errors, [])
})

// The kind said only where it is known: a file dropped in the page's sound's place is listened to, a short noise has no
// word, and the kind goes from by the level
test('editor: embedded, the chain\'s kind only where it is known', async () => {
  const { f } = await mount('chain')
  await length(f, '0:08.000')
  assert.equal(await f.locator('.bar-kind').textContent(), 'chime')
  const dropped = await f.locator('.plot').evaluateHandle(async () => { const dt = new DataTransfer(); dt.items.add(new File([await (await fetch('/test/fixture.wav')).arrayBuffer()], 'mine.wav', { type: 'audio/wav' })); return dt })
  for (const type of ['dragover', 'drop']) await f.locator('.plot').dispatchEvent(type, { dataTransfer: dropped })
  await f.locator('.embed-sound-name', { hasText: 'mine.wav' }).waitFor()
  await poll(() => f.locator('.bar-kind').count(), n => assert.equal(n, 0, 'no kind'))
  // the page's edits still at hand, none made
  assert.equal(await f.locator('.chain-edit').count(), 0)
  assert.deepEqual(errors, [])
})

// What the engine hears a sound to be, a stub: its listeners (@audio/neural-denoise 0.7's segments(), @audio/neural-tag)
// are not installed, so the word comes from here, `ms` after it is asked (worker.js kind's answer, { id, kind })
const hears = (f, word, ms = 2000) => f.locator('body').evaluate(async (_, [word, ms]) => { const { eng } = await import('/repl/editor/context.js'); eng.kind = id => new Promise(r => setTimeout(() => r({ id, kind: word }), ms)) }, [word, ms])
// a file of the reader's dropped on the picture, in the page's sound's place
async function drop(f, name) {
  const dt = await f.locator('.plot').evaluateHandle(async (_, name) => { const dt = new DataTransfer(); dt.items.add(new File([await (await fetch('/test/fixture.wav')).arrayBuffer()], name, { type: 'audio/wav' })); return dt }, name)
  for (const type of ['dragover', 'drop']) await f.locator('.plot').dispatchEvent(type, { dataTransfer: dt })
  await f.locator('.embed-sound-name', { hasText: name }).waitFor()
}
// where the bar's parts stand, the chain and its field, and the picture over them
const where = f => f.locator('body').evaluate(() => ['.view', '.clock', '.readout', '.embed-chain', '.chain-add', '.head-end'].map(s => document.querySelector(s)).filter(e => e?.getClientRects().length).map(e => { const r = e.getBoundingClientRect(); return [e.className.split(' ')[0], Math.round(r.top), Math.round(r.left), Math.round(r.height)] }))
// Suggested follows the sound: the page's own its word's recipe and the page's edits; a sound dropped in its place,
// the page's till its kind is heard, then its kind's recipe and edits, nothing on the bar moving as they change; the
// page's sound again, the page's again
test('editor: embedded, Suggested follows a dropped sound\'s kind, the page\'s own its own', async () => {
  const { f } = await mount('chain')
  await length(f, '0:08.000')
  assert.deepEqual(await shown(f), SUGGESTED, 'the page\'s, for its own sound')
  await hears(f, 'speech')
  await drop(f, 'voice.wav')
  assert.deepEqual([await shown(f), await f.locator('.bar-kind').count()], [SUGGESTED, 0], 'till its kind is heard, the page\'s')
  // (the word stands before the level, which makes room for it as it comes: all else held)
  const held = () => where(f).then(w => w.filter(([name]) => name !== 'readout')), was = await held()
  await poll(() => shown(f), ks => assert.deepEqual(ks, SPEECH))
  assert.equal(await f.locator('.bar-kind').textContent(), 'speech')
  assert.deepEqual(await held(), was, 'nothing on the bar moved but the level, nor the picture')
  // the page's sound picked again from its name's menu: its word's, and its word
  await f.locator('.embed-sound').click()
  await f.locator('.menubar-menu .menu-row', { hasText: 'chime.wav' }).click()
  await f.locator('.embed-sound-name', { hasText: 'chime.wav' }).waitFor()
  await poll(() => shown(f), ks => assert.deepEqual(ks, SUGGESTED))
  assert.equal(await f.locator('.bar-kind').textContent(), 'chime')
  assert.deepEqual(errors, [])
})

// A page that names no edits and says its own sound is speech: speech's recipes first; a sound dropped in its place,
// the general ones till its kind is heard, then its kind's; silence, a word with no row, the general ones
test('editor: embedded, with no ops Suggested is what the sound\'s kind is offered and given', async () => {
  const { f } = await mount('chain', { ops: '', kind: 'speech' })
  await length(f, '0:08.000')
  assert.deepEqual([await f.locator('.embed-ops').count(), await f.locator('.embed-chain').count()], [0, 1], 'laid in sight, no plus')
  await poll(() => shown(f), ks => assert.deepEqual(ks, SPEECH))
  await hears(f, 'music')
  await drop(f, 'tune.wav')
  await poll(() => shown(f), ks => assert.deepEqual(ks, GENERAL, 'till its kind is heard'))
  await poll(() => shown(f), ks => assert.deepEqual(ks, MUSIC))
  assert.equal(await f.locator('.bar-kind').textContent(), 'music')
  await hears(f, 'silence', 0)
  await drop(f, 'quiet.wav')
  await poll(() => f.locator('.bar-kind').allTextContents(), words => assert.deepEqual(words, ['silence']))
  assert.equal(await f.locator('.bar-kind').getAttribute('title'), null, 'nothing more known of it than its word: no tooltip')
  assert.deepEqual(await shown(f), GENERAL)
  assert.deepEqual(errors, [])
})

// The playground's own samples say what each is, as the page says its own sound's, no listener asked: a slow phrase on
// a handpan and the Rhodes' chords music, music's recipes first; the birdsong birdsong, the heart monitor a beep, the
// chime a chime, the general ones first (no row of their own)
test('editor: embedded, a built-in sample says its word, no listener asked, Suggested following it', async () => {
  const { f } = await mount('chain', { ops: '', kind: '', script: "audio('handpan.wav')" })
  await length(f, '0:')
  await poll(() => f.locator('.bar-kind').allTextContents(), words => assert.deepEqual(words, ['music']))
  await poll(() => shown(f), ks => assert.deepEqual(ks, MUSIC))
  for (const [sample, word, edits] of [['rhodes.wav', 'music', MUSIC], ['birdsong.wav', 'birdsong', GENERAL], ['monitor.wav', 'beep', GENERAL], ['chime.wav', 'chime', GENERAL]]) {
    await f.locator('.embed-sound').click()
    await f.locator('.menubar-menu .menu-row', { hasText: sample }).click()
    await f.locator('.embed-sound-name', { hasText: sample }).waitFor()
    await poll(() => f.locator('.bar-kind').allTextContents(), words => assert.deepEqual(words, [word], sample))
    await poll(() => shown(f), ks => assert.deepEqual(ks, edits, sample))
  }
  assert.equal(await f.locator('.bar-kind').getAttribute('title'), 'Airport chime, rising and falling', 'its tooltip, its own line')
  // none of them listened to: none ever heard, nor being heard
  assert.deepEqual(await f.locator('body').evaluate(async () => (await import('/repl/editor/context.js')).state.heardKinds), {})
  assert.deepEqual(errors, [])
})

// A phone's frame: the chain on a row of its own under the name, the recipes in the field's list, so neither the word
// going with the page's sound nor another's coming moves the bar or the picture
test('editor: embedded, a narrow chain holds still as a dropped sound\'s kind comes', async () => {
  const { f } = await mount('chain')
  await length(f, '0:08.000')
  await width(390)
  await poll(() => f.locator('body').evaluate(() => innerWidth), w => assert.equal(w, 390))
  await hears(f, 'speech and music')
  await drop(f, 'voice.wav')
  // (a sound dropped is a step of the history, which comes with it, the row's right end with it: measured from there)
  await poll(() => f.locator('.head-end .history').evaluate(h => h.checkVisibility()), on => assert.equal(on, true))
  const was = await where(f)
  assert.equal(await f.locator('.bar-kind').count(), 0)
  assert.deepEqual(await where(f), was, 'no word: nothing moved')
  await poll(() => shown(f), ks => assert.deepEqual(ks, BOTH))
  assert.deepEqual(await where(f), was, 'Suggested changed: nothing moved')
  await width(null)
  assert.deepEqual(errors, [])
})

// The history, at the row's right end before the save, aligned there: none of it while there is no history at all, so
// it takes no room; once there is, both buttons in their places, the one that cannot act dimmed (aria-disabled), not
// gone, so neither moves under the pointer between presses: one made, Undo, Redo dimmed; undone, Redo, Undo dimmed;
// both. As either comes to act nothing moves (the save, the history, the chain's height), a press repeated on Undo never
// lands on Redo, and the keys stay where they are. The bar's (the edits a menu) the same
test('editor: embedded, the history takes no room till there is one, then both buttons stay, the one that cannot act dimmed', async () => {
  const { f } = await mount('chain')
  await length(f, '0:08.000')
  // the history's room, each button and whether it is dimmed, their places; the save and the row
  const seen = () => f.locator('.head-end .history').evaluate(h => {
    const r = e => e.getBoundingClientRect(), buttons = [...h.querySelectorAll('.icon-button')], save = r(document.querySelector('.head-end .embed-save'))
    return { room: Math.round(r(h).width), shown: buttons.filter(b => b.checkVisibility()).map(b => `${b.ariaLabel}${b.ariaDisabled === 'true' && +getComputedStyle(b).opacity < 1 ? ' dimmed' : ''}`), at: [r(h).left, r(h).width, ...buttons.map(b => r(b).left)].map(Math.round), save: [save.left, save.top].map(Math.round), row: Math.round(r(document.querySelector('.embed-chain')).height) }
  })
  const none = await seen()
  assert.deepEqual([none.room, none.shown], [0, []], 'no history: none of it, no room taken')
  await make(f, 'stretch')
  const one = await poll(seen, s => assert.deepEqual(s.shown, ['Undo', 'Redo dimmed'], 'one made: Undo, Redo dimmed'))
  await f.locator('.head-end .undo').click()
  await poll(seen, s => assert.deepEqual(s.shown, ['Undo dimmed', 'Redo'], 'undone: Redo, Undo dimmed, both where they were'))
  await f.locator('.head-end .redo').click()
  await poll(seen, s => assert.deepEqual(s.shown, ['Undo', 'Redo dimmed'], 'redone'))
  await make(f, 'reverse')
  await poll(() => made(f), ks => assert.equal(ks.length, 2))
  await f.locator('.head-end .undo').click()
  const both = await poll(seen, s => assert.deepEqual(s.shown, ['Undo', 'Redo'], 'both'))
  assert.deepEqual([both.at, both.save, both.row], [one.at, one.save, one.row], 'the history where it was, as wide, each button in its place; the save, the chain\'s height unmoved')
  // by the keys: Undo pressed with nothing left after it, dimmed, the keys staying on it
  await f.locator('.head-end .undo').focus()
  await page.keyboard.press('Enter')
  await poll(seen, s => assert.deepEqual(s.shown, ['Undo dimmed', 'Redo']))
  assert.equal(await focused(f), 'icon-button Undo', 'the keys where they were')
  // the bar's, the edits a menu: none, then both once one is made, Redo dimmed
  const { f: g } = await mount('')
  await length(g, '0:08.000')
  const bar = () => g.locator('.status .history').evaluate(h => [...h.querySelectorAll('.icon-button')].filter(b => b.checkVisibility()).map(b => `${b.ariaLabel}${b.ariaDisabled === 'true' ? ' dimmed' : ''}`))
  assert.deepEqual(await bar(), [], 'the bar\'s: no history, none')
  await g.locator('.embed-ops').click()
  await g.locator('.menubar-menu .menu-row', { hasText: 'Stretch' }).click()
  await poll(bar, shown => assert.deepEqual(shown, ['Undo', 'Redo dimmed'], 'the bar\'s: one made'))
  assert.deepEqual(errors, [])
})

// How the waveform's fill shows, read off the picture: of the lit pixels (brighter than the ground and the paper's
// lines), the share within six levels of the commonest brightness. One shade from peak to peak (flat) is most of them;
// density, a gradient from the axis out, few (on the chime: flat 0.94, density 0.31, the other fills 0.54 at most)
async function oneShade(f) {
  const png = await f.locator('.plot').screenshot()
  return page.evaluate(async b64 => {
    const img = new Image()
    img.src = 'data:image/png;base64,' + b64
    await img.decode()
    const c = Object.assign(document.createElement('canvas'), { width: img.width, height: img.height }), g = c.getContext('2d')
    g.drawImage(img, 0, 0)
    const d = g.getImageData(0, 0, c.width, c.height).data, bins = new Array(256).fill(0)
    for (let i = 0; i < d.length; i += 4) { const y = Math.round(.2126 * d[i] + .7152 * d[i + 1] + .0722 * d[i + 2]); if (y > 120) bins[y]++ }
    const all = bins.reduce((a, b) => a + b, 0), mode = bins.indexOf(Math.max(...bins))
    return bins.slice(Math.max(0, mode - 6), mode + 7).reduce((a, b) => a + b, 0) / all
  }, png.toString('base64'))
}

// The waveform's look as the page gives it (ui wave: the look's own settings, as View › Waveform options names them),
// each setting taken where it is one of its list, any other dropped (an unknown setting, a value not of its list):
// { fill: 'flat' } draws one shade from peak to peak; the View menu's Waveform options still change it, density drawn
// then. The spectrogram's look (ui spec) by the same rule
test('editor: embedded, the waveform\'s look as the page gives it: flat drawn, the View menu still changing it', async () => {
  const { f } = await mount('chain', { ui: { wave: { fill: 'flat', colour: 'nope', bogus: 1 }, spec: { map: 'magma', depth: 999 } } })
  await length(f, '0:08.000')
  const look = () => f.locator('body').evaluate(async () => { const { state } = await import('/repl/editor/context.js'); return { wave: { ...state.wave }, spec: { map: state.look.map, depth: state.look.depth } } })
  assert.deepEqual(await look(), { wave: { colour: 'none', lanes: 'split', fill: 'flat', map: 'temperature', weighting: 'none' }, spec: { map: 'magma', depth: 80 } }, 'flat and magma taken, the rest as they come')
  await poll(() => oneShade(f), share => assert.ok(share > .85, `flat drawn, one shade: ${share.toFixed(2)}`))
  // View › Waveform options › Fill › Density, as the menu has it
  await f.locator('body').evaluate(async () => { const { command } = await import('/repl/editor/commands.js'); command('look.wave').items().find(g => g.label === 'Fill').items.find(i => i.label === 'Density').run() })
  assert.equal((await look()).wave.fill, 'density')
  await poll(() => oneShade(f), share => assert.ok(share < .5, `density drawn, a gradient: ${share.toFixed(2)}`))
  assert.deepEqual(errors, [])
})

// The window left with the field's list open (another app; embedded, a press on the page around the frame) shuts the
// list for good: the window coming back gives the keys back to what held them, as a browser does (Firefox keeps them in
// the field as the frame loses them, Chrome after another app had them), and that opens nothing; nor do a press on the
// host page, the pointer back over the frame and a key that is not the field's. The field pressed again opens it. (The
// test's browser cannot lose its window: the events leaving it and coming back bring are sent as a browser sends them)
test('editor: embedded, the chain\'s list shut by the window left stays shut till the field is pressed', async () => {
  const { f } = await mount('chain')
  await length(f, '0:08.000')
  const open = () => f.locator('#edits-found').evaluate(l => l.matches(':popover-open'))
  await f.locator('.chain-add').click()
  await poll(open, o => assert.equal(o, true))
  // away: what holds the keys told it lost them, then the window; back: the window, then what holds the keys
  await f.locator('body').evaluate(() => { document.activeElement.dispatchEvent(new FocusEvent('blur')); dispatchEvent(new FocusEvent('blur')) })
  await poll(open, o => assert.equal(o, false, 'shut as the window is left'))
  await f.locator('body').evaluate(() => { dispatchEvent(new FocusEvent('focus')); if (document.activeElement !== document.body) document.activeElement.dispatchEvent(new FocusEvent('focus')) })
  await page.waitForTimeout(200)
  assert.equal(await open(), false, 'the window back: shut still')
  // a press on the host page, the pointer back over the frame, a key not the field's
  await page.evaluate(() => { document.body.style.minHeight = '900px' })
  await page.mouse.click(40, 700)
  const frame = await page.locator('audio-repl iframe').boundingBox()
  await page.mouse.move(frame.x + frame.width / 2, frame.y + frame.height / 2)
  await page.keyboard.press('Shift')
  await page.waitForTimeout(200)
  assert.equal(await open(), false, 'a press around the frame, back over it, a key: shut still')
  await f.locator('.chain-add').click()
  await poll(open, o => assert.equal(o, true, 'the field pressed: open'))
  assert.deepEqual(errors, [])
})

// The list open, by its parts: its rows' role, where it stands against the frame and whether its rows scroll down, the
// lit row and the search's descendant, the first row's title
const found = f => f.locator('body').evaluate(() => {
  const l = document.querySelector('#edits-found'), r = l.getBoundingClientRect(), rows = [...l.querySelectorAll('.found-row')], keys = document.querySelector('.found-search'), list = l.querySelector('.found-list')
  return {
    open: l.matches(':popover-open'), role: list.getAttribute('role'), within: r.left >= 0 && r.top >= 0 && r.right <= innerWidth + .5 && r.bottom <= innerHeight + .5, W: innerWidth,
    down: list.scrollHeight > list.clientHeight + 1, lit: l.querySelector('[aria-selected="true"] .found-name')?.textContent ?? '', active: keys?.getAttribute('aria-activedescendant') === l.querySelector('[aria-selected="true"]')?.id,
    title: rows[0]?.dataset.tip ?? ''
  }
})

// The list, a menu: with nothing typed, Suggested, a row a kind and Recipes, a chevron at its end and no number (which
// would read as a value to set; how many it holds in its tooltip); a tree to the keys (the field says so: aria-haspopup tree). ↓ to a kind, →
// opens its edits beside the list, the keys in them, ← back to its row, Enter on a kind opens it too, Enter on an edit
// makes it; Escape shuts a kind's edits first, then the list. The pointer over a kind opens its edits beside it, over
// another row of the first level shuts them; typed in, flat. In a phone's frame, a kind pressed has its edits in the
// list's place, a way back over them
test('editor: embedded, the chain\'s list as menus: a kind\'s edits beside its row, by the keys and the pointer', async () => {
  const { f } = await mount('chain')
  await length(f, '0:08.000')
  const field = f.locator('.chain-add'), row = name => f.locator('.found-row', { hasText: name }).first()
  const kinds = () => f.locator('#edits-found .found-row[aria-expanded]').evaluateAll(rs => rs.map(r => [r.querySelector('strong').textContent, r.getAttribute('aria-expanded'), !!r.querySelector('.found-more')]))
  const sub = () => f.locator('body').evaluate(() => { const l = document.querySelector('#edits-found'), g = l.querySelector('.found-group[data-sub]'), r = g?.getBoundingClientRect(), lr = l.getBoundingClientRect(); return g ? { kind: g.getAttribute('aria-label'), beside: r.left >= lr.right - 1 || r.right <= lr.left + 1, within: r.left >= 0 && r.top >= 0 && r.right <= innerWidth + .5 && r.bottom <= innerHeight + .5, owned: !!l.querySelector(`[aria-owns="${g.id}"]`) } : null })
  await field.click()
  const s = await poll(() => found(f), s => assert.equal(s.open, true))
  assert.deepEqual([s.role, await field.getAttribute('aria-haspopup'), s.title.split('\n')[0]], ['tree', 'tree', 'Cut silence from both ends'], 'a tree, the field says so')
  assert.deepEqual(await kinds(), [['More recipes', 'false', true], ...KINDS.map(k => [k, 'false', true])], 'the rest of the recipes and a row a kind, a chevron each, shut')
  assert.deepEqual(await row('Filter').evaluate(r => [r.querySelector('.found-hint').textContent, r.dataset.tip]), ['', '27 edits'], 'no number at its end; how many edits it has in its tooltip')
  // ↓ to Filter (past the four suggested, the five rows of Recipes, Silence and Level), → into its edits
  for (let i = 0; i < 11; i++) await page.keyboard.press('ArrowDown')
  await poll(() => found(f), s => assert.equal(s.lit, 'Filter'))
  await page.keyboard.press('ArrowRight')
  await poll(sub, g => assert.deepEqual(g, { kind: 'Filter', beside: true, within: true, owned: true }, 'Filter\'s edits beside the list, inside the frame, owned by its row'))
  await poll(() => found(f), s => assert.deepEqual([s.lit, s.active], ['Highpass', true], 'the keys in them'))
  await page.keyboard.press('ArrowDown')
  await poll(() => found(f), s => assert.equal(s.lit, 'Lowpass'))
  await page.keyboard.press('ArrowLeft')
  await poll(() => found(f), s => assert.equal(s.lit, 'Filter', '← back to its row'))
  assert.equal(await sub(), null, 'its edits shut')
  // Enter on a kind opens it; Escape shuts its edits, the list open; Enter twice makes its first
  await page.keyboard.press('Enter')
  await poll(sub, g => assert.equal(g?.kind, 'Filter'))
  await page.keyboard.press('Escape')
  await poll(() => found(f), s => assert.deepEqual([s.open, s.lit], [true, 'Filter'], 'Escape: its edits shut, the list open'))
  assert.equal(await sub(), null)
  await page.keyboard.press('Enter')
  await page.keyboard.press('Enter')
  await poll(() => made(f), ks => assert.deepEqual(ks.map(k => k.split(' ')[0]), ['Highpass'], 'Enter on an edit: made'))
  await poll(() => found(f), s => assert.equal(s.open, false))
  // the pointer: over Dynamics, its edits beside it; over a suggested row, shut
  await field.click()
  await poll(() => found(f), s => assert.equal(s.open, true))
  // (a row brought into the middle of the list's sight first, clear of the chevrons at its cut edges, the recipes over
  // the kinds, a frame this tall showing only some of them; the pointer coming to it from beside the list, over no other
  // row: the way across rows is the next test's)
  const at = async name => { await row(name).evaluate(r => r.scrollIntoView({ block: 'center' })); const b = await row(name).boundingBox(); await page.mouse.move(b.x - 40, b.y + b.height / 2); await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 3 }) }
  await at('Dynamics')
  await poll(sub, g => assert.equal(g?.kind, 'Dynamics', 'pointed at, its edits beside it'))
  await at('Normalize')
  await poll(sub, g => assert.equal(g, null, 'another row: shut'))
  // typed in: flat
  await page.keyboard.type('no')
  await poll(() => found(f), s => assert.equal(s.role, 'listbox'))
  assert.equal(await kinds().then(k => k.length), 0, 'no kind rows')
  await page.keyboard.press('Escape')
  // a phone's frame: Filter pressed, its edits in the list's place, a way back over them
  await width(390)
  await poll(() => f.locator('body').evaluate(() => innerWidth), w => assert.equal(w, 390))
  await field.click()
  await row('Filter').click()
  const placed = () => f.locator('#edits-found').evaluate(l => ({ first: [...l.querySelectorAll('.found-group:not([data-sub])')].some(g => g.checkVisibility()), back: l.querySelector('.found-back')?.checkVisibility() ? l.querySelector('.found-back').textContent : null }))
  await poll(placed, p => assert.deepEqual(p, { first: false, back: 'Filter' }, 'in the list\'s place, a way back'))
  await poll(() => found(f), s => assert.ok(s.within, 'inside the frame'))
  await f.locator('.found-back').click()
  await poll(placed, p => assert.deepEqual(p, { first: true, back: null }, 'back: the kinds again'))
  await row('Filter').click()
  await row('Lowpass').click()
  await poll(() => made(f), ks => assert.deepEqual(ks.map(k => k.split(' ')[0]), ['Highpass', 'Lowpass']))
  await width(null)
  assert.deepEqual(errors, [])
})

// The pointer on its way to a kind's edits open beside the list goes by the page's menus' one rule (menu.js aim):
// crossing the rows of the first level under its own, heading into the edits, they let it pass, the edits staying open
// and the row it came from lit; resting on one, that one takes it, its own edits opening; moved straight down, the next
// row takes it at once
test('editor: embedded, the pointer on its way to a kind\'s edits crosses the rows between, which take it only once it rests', async () => {
  const { f } = await mount('chain')
  await length(f, '0:08.000')
  await f.locator('.chain-add').click()
  // (a kind's row: one with a submenu, not a recipe whose name holds the kind's, Repair a clipped recording)
  const box = name => f.locator('#edits-found > .found-list > .found-group:not([data-sub]) .found-row[aria-expanded]', { hasText: name }).first().boundingBox()
  const state = () => f.locator('body').evaluate(() => ({ lit: document.querySelector('.found-row[aria-selected="true"] strong')?.textContent, sub: document.querySelector('.found-group[data-sub]')?.getAttribute('aria-label') ?? null }))
  const frame = () => f.locator('body').evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))))
  // (the kinds in the list's sight, Dynamics in its middle, clear of the chevrons at its cut edges: the recipes over
  // them, a frame this tall shows only some)
  await f.locator('#edits-found .found-row[aria-expanded]', { hasText: 'Dynamics' }).evaluate(r => r.scrollIntoView({ block: 'center', behavior: 'instant' }))
  const from = await box('Level'), far = await box('Dynamics'), down = await box('Repair')
  await page.mouse.move(from.x + 30, from.y + from.height / 2)
  await poll(state, s => assert.deepEqual(s, { lit: 'Level', sub: 'Level' }))
  const sub = await f.locator('.found-group[data-sub]').boundingBox()
  assert.ok(sub.x >= from.x + from.width - 1 && sub.y + sub.height > far.y + far.height, 'Level\'s edits beside the list, reaching past Dynamics')
  // down and right over Filter, onto Dynamics' far end, by Level's edits' edge
  await page.mouse.move(far.x + far.width - 4, far.y + far.height / 2, { steps: 12 })
  await frame()
  assert.deepEqual(await state(), { lit: 'Level', sub: 'Level' }, 'the rows crossed let it pass, Level\'s edits open')
  // resting there past the 300 ms a row takes the pointer in: Dynamics', its edits beside it
  await poll(state, s => assert.deepEqual(s, { lit: 'Dynamics', sub: 'Dynamics' }))
  // straight down a row: that row's at once
  await page.mouse.move(down.x + down.width - 4, down.y + down.height / 2, { steps: 4 })
  await frame()
  assert.deepEqual(await state(), { lit: 'Repair', sub: 'Repair' })
  assert.deepEqual(errors, [])
})

// Recipes, a section of the list after Suggested and before the kinds, More recipes its last row, the rest beside it:
// first the automatic edit made for the sound's kind (auto(type), its type at its row's end, what it does in its
// tooltip), then three recipes, then the rest beside the list: every recipe (recipes.js offered), each a goal's whole
// chain of two edits or more (the interview a script, for a sound of two channels), each its own icon (none another's,
// none an edit's or a kind's), at its row's end how many edits it makes, what it does and its edits in its tooltip;
// those the sound's kind is offered first (kind.js OFFERS). One pressed puts its whole chain on the sound at once, each
// of its edits then standing in the chain as any other, one undo step. Typed in, a recipe is found among the edits, by
// its name first. A record's on a sound of one channel is its own (no side to take its rumble from), and the interview
// none; the master to a reference asks for the reference as it is put on
test('editor: embedded, Recipes: the automatic edit, then every recipe, the sound\'s kind\'s first; one puts its whole chain on, one undo step', async () => {
  const read = (f, sel) => f.locator(sel).evaluateAll(rs => rs.map(r => ({ name: r.querySelector('.found-name').textContent, hint: r.querySelector('.found-hint').textContent, icon: r.querySelector('svg path').getAttribute('d'), tip: r.dataset.tip })))
  // (the section's rows, the automatic edit and three recipes, then, More recipes opened, the rest beside the list:
  // every one, in their order; a row by its name, wherever it stands)
  const more = f => f.locator('#edits-found .found-row[aria-expanded]', { hasText: 'More recipes' })
  const opened = async f => {
    await f.locator('.chain-add').click()
    const section = (await read(f, '#edits-found .found-group[aria-label="Recipes"] .found-row')).filter(r => r.name !== 'More recipes')
    await more(f).evaluate(r => r.scrollIntoView({ block: 'center' }))
    await more(f).click()
    return [...section, ...await poll(() => read(f, '.found-group[data-sub] .found-row'), rs => assert.ok(rs.length > 1))]
  }
  const recipe = (f, name) => f.locator('#edits-found .found-row', { has: f.locator('.found-name', { hasText: new RegExp(`^${name}$`) }) }).first()
  const press = async (f, name) => { await recipe(f, name).evaluate(r => r.scrollIntoView({ block: 'center' })); await recipe(f, name).click() }
  const offered = async kind => {
    const { f } = await mount('chain', { ops: '', kind })
    await length(f, '0:08.000')
    return { f, rows: await opened(f) }
  }
  const { rows: speech } = await offered('speech')
  assert.deepEqual(speech.map(r => r.name), ['Repair and level this voice', ...first('Clean up a voice recording', 'Podcast episode', 'Audiobook chapter', 'Voice for broadcast or video', 'Enhance speech')], 'speech: auto first, a voice\'s recipes next')
  assert.deepEqual([speech[0].hint, speech[0].tip], ['speech', 'Repairs what it finds in the voice, −16 LUFS\nOne edit: its chain is what it measures'])
  const { f, rows: music } = await offered('music')
  assert.deepEqual(music.map(r => r.name), ['Repair and level this song', ...first('Master a song for streaming', 'Master a song to a reference', 'Master a song, warm', 'Restore a vinyl record', 'Repair a damaged recording')], 'music: its own first, the rest after')
  const sets = music.slice(1), others = await f.locator('body').evaluate(async () => { const icons = (await import('/repl/icons.js')).default, { icons: kinds } = await import('/repl/ops.js'); return [...Object.values(icons), ...Object.values(kinds)] })
  assert.equal(new Set(sets.map(r => r.icon)).size, RECIPES.length, 'each its own icon')
  assert.deepEqual(sets.filter(r => others.includes(r.icon)).map(r => r.name), [], 'none an edit\'s or a kind\'s icon')
  assert.deepEqual(sets.filter(r => !(+r.hint.split(' ')[0] >= 2) && r.hint !== 'script').map(r => r.name), [], 'each two edits or more, or a script')
  const vinyl = sets.find(r => r.name === 'Restore a vinyl record')
  assert.deepEqual([vinyl.hint, vinyl.tip], ['8 edits', 'Clicks, crackle, rumble and wow off a transfer, the bass kept'], 'how many edits at its row\'s end; what it does, its tooltip')
  // (one with no model to fetch: the page here asks nothing of the world)
  await press(f, 'Master a song for streaming')
  await poll(() => made(f), ks => assert.deepEqual(ks.map(k => k.split(' ')[0]), ['Highpass', 'Normalize', 'VCA', 'Normalize'], 'its edits, each in the chain'))
  await f.locator('.head-end .undo').click()
  await poll(() => made(f), ks => assert.deepEqual(ks, [], 'one undo step: all gone'))
  // typed in: found by its name first, Enter puts it on
  await f.locator('.chain-add').click()
  await f.locator('.found-search').fill('master a song')
  await poll(() => listed(f), gs => assert.equal(gs.flat()[0], 'Master a song for streaming'))
  await page.keyboard.press('Enter')
  await poll(() => made(f), ks => assert.equal(ks.length, 4))
  await f.locator('.head-end .undo').click()
  await poll(() => made(f), ks => assert.deepEqual(ks, []))
  // and by an edit it makes, as its row says it
  await f.locator('.chain-add').click()
  await f.locator('.found-search').fill('decrackle')
  await poll(() => listed(f), gs => assert.ok(gs.flat().includes('Restore a vinyl record'), `${gs}`))
  await page.keyboard.press('Escape')
  // the master to a reference asks for it as it is put on: the file chooser opens, the file chosen is kept as the
  // reference the call names, and the master made with it
  const chooser = page.waitForEvent('filechooser')
  await opened(f)
  await press(f, 'Master a song to a reference')
  await (await chooser).setFiles({ name: 'song.wav', mimeType: 'audio/wav', buffer: readFileSync(new URL('../fixture.wav', import.meta.url)) })
  await poll(() => f.locator('body').evaluate(async () => { const { ed, state, output } = await import('/repl/editor/context.js'); return [/\.master\(audio\('reference\.wav'\)\)/.test(ed.code), state.missing, output?.code === ed.code] }), r => assert.deepEqual(r, [true, '', true], 'made with the file chosen'), 30000)
  await f.locator('.head-end .undo').click()
  await poll(() => made(f), ks => assert.deepEqual(ks, []))
  // a sound of one channel dropped in: a record's own, five edits, the side's three none, and so put on; no interview
  await hears(f, 'music', 0)
  await drop(f, 'mono.wav')
  const one = await opened(f)
  const record = one.find(r => r.name === 'Restore a vinyl record')
  assert.deepEqual([record.hint, one.some(r => r.name === 'Interview, two mics')], ['5 edits', false])
  await press(f, 'Restore a vinyl record')
  await poll(() => made(f), ks => assert.deepEqual(ks.map(k => k.split(' ')[0]), ['Declip', 'Declick', 'Decrackle', 'Highpass', 'Dewow']))
  assert.deepEqual(errors, [])
})

// Every row of both menus, the file's (the sound's name's) and the edits', has a hint at its right end in the quiet
// ink, never wrapping, 12em at most: past it cut with an ellipsis, its whole text then in the row's tooltip with what
// the row says it does; one that fits is not cut and its tooltip says only what the row does. The name is never cut
test('editor: embedded, a row\'s hint cut with an ellipsis past its room, the whole of it in the tooltip', async () => {
  const { f } = await mount('chain')
  await length(f, '0:08.000')
  // a row's name, its hint, whether either is cut, the hint's style, the row's tooltip
  const rows = sel => f.locator(sel).evaluateAll(rs => rs.map(r => { const n = r.querySelector('.found-name, .menu-label'), h = r.querySelector('.found-hint > span, .menu-keys'), cs = getComputedStyle(h); return { name: n.textContent, hint: h.textContent, cut: h.scrollWidth > h.clientWidth + 1, named: n.scrollWidth <= n.clientWidth + 1, wraps: cs.whiteSpace !== 'nowrap', ellipsis: cs.textOverflow === 'ellipsis', right: Math.abs(h.getBoundingClientRect().right - r.getBoundingClientRect().right) < 14, title: r.title } }))
  // the file's menu: a sample's word on what it is cut, its whole in the tooltip
  await f.locator('.embed-sound').click()
  const file = await poll(() => rows('.menubar-menu .menu-row'), rs => assert.ok(rs.some(r => r.cut), `a hint cut: ${JSON.stringify(rs)}`))
  for (const r of file) {
    assert.ok(!r.wraps && r.ellipsis && r.named, `${r.name}: never wrapping, cut with an ellipsis, its name whole`)
    assert.equal(r.cut ? r.title.startsWith(r.hint) : !r.title.includes(r.hint) || !r.hint, true, `${r.name}: ${r.cut ? 'cut, its whole hint in the tooltip' : 'whole, no hint in the tooltip'} (${JSON.stringify(r)})`)
  }
  await page.keyboard.press('Escape')
  // the edits': a recipe's hint how many edits it makes, short, whole, its tooltip what it does, then its edits in their
  // order (in Recipes); a value short, whole, its tooltip what it does alone
  await f.locator('.chain-add').click()
  await f.locator('#edits-found .found-row[aria-expanded]', { hasText: 'More recipes' }).evaluate(r => r.scrollIntoView({ block: 'center' }))
  await f.locator('#edits-found .found-row[aria-expanded]', { hasText: 'More recipes' }).click()
  const podcast = await poll(() => rows('#edits-found .found-row').then(rs => rs.find(r => r.name === 'Podcast episode')), r => assert.ok(r?.title, 'Podcast episode, its tooltip'))
  assert.deepEqual([podcast.hint, podcast.cut, podcast.named, podcast.right], ['5 edits', false, true, true], `short and whole, at the right end: ${JSON.stringify(podcast)}`)
  assert.equal(podcast.title, 'Apple Podcasts: −16 LUFS, peaks under −1 dBTP', 'what it does')
  await f.locator('.found-search').fill('trim')
  const trim = await poll(() => rows('#edits-found .found-row').then(rs => rs[0]), r => assert.equal(r.title, 'Cut silence from both ends'))
  assert.deepEqual([trim.name, trim.hint, trim.cut, trim.right, trim.title], ['Trim silence', '−40dB', false, true, 'Cut silence from both ends'], 'short: whole, at the right end, its tooltip what it does')
  assert.deepEqual(errors, [])
})

// Hints: an edit lit in the list (by the pointer or the keys) shows on the picture what it would do (ops.js hints, the
// view's guides): Trim −40dB, what it would cut at each end, where the library's trim reads the sound quiet (blocks of
// 1024 samples under its threshold), drawn as a veil there; Fade 1s, 1s, its two ramps; Normalize −1dB, the level the
// peak goes to, a line each side. A kind, Recipes or an edit with no hint, none; the list shut, none. And an edit
// made: its threshold dragged in its settings shows the cut, drawn on the sound before the trim (the chain shown up to
// it meanwhile), moving as the threshold does; let go, gone, the whole chain shown again
test('editor: embedded, an edit lit in the list shows what it would do on the picture; a made one\'s settings dragged too', async () => {
  const { f } = await mount('chain')
  await length(f, '0:08.000')
  // the hint's marks among the view's guides (what draws them), and the overlay's ink in a lane's middle at a time
  const marks = () => f.locator('body').evaluate(async () => (await import('/repl/editor/context.js')).v.guides.filter(g => g.cut || g.level != null || g.ramps).map(g => g.cut ? { cut: g.cut.map(t => +t.toFixed(3)) } : g.ramps ? { ramps: g.ramps.map(r => r.slice(0, 3).map(v => typeof v === 'number' ? +v.toFixed(3) : v)) } : { level: g.level }))
  // (guides are drawn in time, on the reel's marks canvas, moved as the reel is: page.js __overlay)
  const ink = t => f.locator('.plot').evaluate((plot, t) => import('/repl/editor/context.js').then(({ v }) => { const m = plot.querySelector('canvas.marks'), o = plot.querySelector('canvas.overlay'), k = m.width / m.clientWidth, shift = -new DOMMatrix(getComputedStyle(plot.querySelector('.reel')).transform).m41, px = t / v.duration * o.clientWidth + shift, y = o.clientHeight * .3; return m.getContext('2d').getImageData(Math.round(px * k), Math.round(y * k), 1, 1).data[3] }), t)
  await f.locator('.chain-add').click()
  // a recipe lit (past the four suggested and the automatic edit): none (a whole chain's would be a guess)
  await poll(() => found(f), s => assert.equal(s.lit, 'Trim silence'))
  for (let i = 0; i < 5; i++) await page.keyboard.press('ArrowDown')
  await poll(() => found(f), s => assert.equal(s.lit, 'Repair a damaged recording'))
  assert.deepEqual(await marks(), [], 'a recipe: none')
  // Trim −40dB found (the page's), lit: its cuts; the samples read as the library's trim reads them
  const search = f.locator('.found-search')
  await search.fill('trim')
  const cut = await poll(marks, ms => assert.ok(ms.length === 2 && ms.every(m => m.cut), `Trim's cuts: ${JSON.stringify(ms)}`))
  const ends = await f.locator('body').evaluate(async () => {
    const { output } = await import('/repl/editor/context.js'), ch = output.channels, total = ch[0].length, over = 10 ** (-40 / 20), B = 1024
    const loud = i => ch.some(c => { for (let j = i * B; j < Math.min(total, (i + 1) * B); j++) if (Math.abs(c[j]) > over) return true; return false })
    let s = 0, e = Math.ceil(total / B) - 1
    while (!loud(s)) s++
    while (e > s && !loud(e)) e--
    return [+(s * B / output.sampleRate).toFixed(3), +(Math.min((e + 1) * B, total) / output.sampleRate).toFixed(3), +output.duration.toFixed(3)]
  })
  assert.deepEqual(cut, [{ cut: [0, ends[0]] }, { cut: [ends[1], ends[2]] }], 'what it would cut: before the first loud block, after the last')
  await poll(() => ink(ends[0] / 2), a => assert.ok(a > 0, `drawn: a veil over what it would cut (${a})`))
  // Normalize −1dB, its level; Fade 1s, 1s, its ramps (the page's, found)
  await search.fill('normalize')
  await poll(marks, ms => assert.deepEqual(ms, [{ level: -1 }]))
  await search.fill('fade')
  await poll(marks, ms => assert.deepEqual(ms, [{ ramps: [[0, 1, 'in']] }, { ramps: [[7, 8, 'out']] }]))
  // by the pointer: Trim again
  await search.fill('trim')
  const b = await f.locator('.found-row', { hasText: 'Trim' }).first().boundingBox()
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 2 })
  await poll(marks, ms => assert.equal(ms.length, 2, 'pointed at: its cuts'))
  // shut: none
  await page.keyboard.press('Escape')
  await poll(marks, ms => assert.deepEqual(ms, [], 'shut: none'))
  // made, its settings: the threshold dragged, the cut drawn on the sound before it, moving with it; let go, gone
  await page.mouse.move(2, 2)
  await make(f, 'trim')
  await poll(() => made(f), ks => assert.deepEqual(ks, ['Trim −40dB']))
  // (its settings open on it, the keys on its threshold, which shows its cut on the sound before it: shut, the chain)
  await poll(() => f.locator('body').evaluate(async () => { const { output, ed } = await import('/repl/editor/context.js'); return output.code === ed.code ? +output.duration.toFixed(3) : 0 }), d => assert.ok(Math.abs(d - (ends[1] - ends[0])) < .01, `trimmed: ${d}`))
  await f.locator('.chain-edit', { hasText: 'Trim' }).click()
  const slider = f.locator('#step-settings input[type="range"]').first()
  await slider.waitFor()
  const slide = v => slider.evaluate((input, v) => { input.value = v; input.dispatchEvent(new Event('input', { bubbles: true })) }, v)
  const shown = () => f.locator('body').evaluate(async () => { const { output, ed } = await import('/repl/editor/context.js'); return output.code === ed.code ? 'the chain' : 'up to the trim' })
  await slide(250)
  const low = await poll(marks, ms => assert.ok(ms.length && ms.every(m => m.cut), `dragged, its cut: ${JSON.stringify(ms)}`))
  assert.equal(await shown(), 'up to the trim', 'drawn on the sound before it')
  await slide(800)
  const cuts = ms => ms.reduce((all, m) => all + m.cut[1] - m.cut[0], 0)
  await poll(marks, ms => assert.ok(ms.length && cuts(ms) > cuts(low) + .5, `a higher threshold, more cut: ${JSON.stringify(ms)} after ${JSON.stringify(low)}`))
  await slider.evaluate(input => input.dispatchEvent(new Event('change', { bubbles: true })))
  await poll(marks, ms => assert.deepEqual(ms, [], 'let go: gone'))
  await poll(shown, w => assert.equal(w, 'the chain', 'the whole chain shown again'))
  assert.deepEqual(errors, [])
})

// One vocabulary for what an edit would do (ops.js hints, view/notes.js paintGuide), all of it in the guides' colour
// (the accent), hints being guides: filled, half transparent, what it takes away or changes; a line what it sets or
// keeps. Trim's cut filled, the line where the sound kept starts; Normalize's band from the peak the sound has
// (read off its samples) to the one it brings it to; Fade's ramps with what each takes off filled; Shrink, each pause
// it shortens, as the library shortens them (the cuts summed are what the output loses); Crop, Remove, Gain, a filter's
// cut band, from what their values say; none for what changes every sample alike or adds what has no room
test('editor: embedded, an edit\'s hint fills what it takes away or changes and lines what it sets, in the accent', async () => {
  const { f } = await mount('chain')
  await length(f, '0:08.000')
  const marks = () => f.locator('body').evaluate(async () => (await import('/repl/editor/context.js')).v.guides.map(g => JSON.parse(JSON.stringify(g, (k, v) => typeof v === 'number' ? +v.toFixed(3) : v))))
  // the marks canvas at a time and a height (a share of the lane's), its colour
  const at = (t, y) => f.locator('.plot').evaluate((plot, [t, y]) => import('/repl/editor/context.js').then(({ v }) => { const m = plot.querySelector('canvas.marks'), o = plot.querySelector('canvas.overlay'), k = m.width / m.clientWidth, shift = -new DOMMatrix(getComputedStyle(plot.querySelector('.reel')).transform).m41, px = t / v.duration * o.clientWidth + shift; return [...m.getContext('2d').getImageData(Math.round(px * k), Math.round(o.clientHeight * y * k), 1, 1).data] }), [t, y])
  // (how much of a pixel is the accent, page.js __accent)
  const accent = px => f.locator('body').evaluate((_, px) => __accent().share(...px), px)
  // (each found in the search, lit)
  await f.locator('.chain-add').click()
  const search = f.locator('.found-search')
  await search.fill('trim')
  const cut = await poll(marks, ms => assert.ok(ms.length && ms.every(m => m.cut), JSON.stringify(ms)))
  const veil = await poll(() => at(cut[0].cut[1] / 2, .3), px => assert.ok(px[3] > 0 && px[3] < 128, `half transparent: ${px}`))
  assert.ok(await accent(veil) > .8, `what it cuts filled in the accent: ${veil}`)
  // Normalize: its band from the sound's peak, as its samples say
  await search.fill('normalize')
  const [level] = await poll(marks, ms => assert.equal(ms[0]?.level, -1))
  const peak = await f.locator('body').evaluate(async () => { const { output } = await import('/repl/editor/context.js'); let top = 0; for (const ch of output.channels) for (const v of ch) top = Math.max(top, Math.abs(v)); return +(20 * Math.log10(top)).toFixed(3) })
  assert.equal(level.from, peak, 'from the peak the sound has')
  // said at a glance: where the peak stands (dashed), where it will (a line), the levels between veiled, and on a tag in
  // the accent at the line's start, from where to where and by how much: an opaque pill there, the veil's being faint
  const pill = await f.locator('.plot').evaluate(plot => { const m = plot.querySelector('canvas.marks'), k = m.width / m.clientWidth, d = m.getContext('2d').getImageData(0, 0, Math.round(140 * k), m.height).data; let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i + 3] === 255 && __accent().share(d[i], d[i + 1], d[i + 2]) > .8) n++; return n })
  assert.ok(pill > 100, `a tag in the accent at the line's start: ${pill} px of it`)
  // Fade: its ramps, what each takes off filled
  await search.fill('fade')
  await poll(marks, ms => assert.deepEqual(ms.map(m => [!!m.ramps, m.fill, m.of]), [[true, true, ['in', 'curve']], [true, true, ['out', 'curve']]], 'its two ramps, each its own'))
  await page.keyboard.press('Escape')
  // the rest, from their values, on a sound of 8 s: what each fills, what each draws a line for; none for the others
  const of = await f.locator('body').evaluate(async () => {
    const { hint } = await import('/repl/ops.js'), sampleRate = 44100, ch = new Float32Array(8 * sampleRate).map((_, i) => (i / sampleRate) % 2 < 1 ? .5 * Math.sin(i / 7) : 0), sound = { duration: 8, sampleRate, channels: [ch] }
    const keys = ms => ms.map(m => Object.fromEntries(Object.entries(m).filter(([k]) => k !== 'of').map(([k, v]) => [k, Array.isArray(v) ? v.map(x => +x.toFixed(2)) : typeof v === 'number' ? +v.toFixed(2) : v])))
    return Object.fromEntries([['crop', { at: 1, duration: 2 }], ['remove', { at: 1, duration: 2 }], ['gain', { value: -6 }], ['gain', { value: 0 }], ['highpass', { freq: 80 }], ['lowpass', { freq: 8000 }], ['shrink', { gap: .3 }], ['normalize', { target: -16, mode: 'lufs' }], ['reverse', {}], ['pad', { before: 1, after: 1 }], ['stretch', { factor: 1.25 }]].map(([n, a]) => [`${n} ${JSON.stringify(a)}`, keys(hint(n, a, sound))]))
  })
  assert.deepEqual(of, {
    'crop {"at":1,"duration":2}': [{ cut: [0, 1] }, { cut: [3, 8] }],
    'remove {"at":1,"duration":2}': [{ cut: [1, 3] }],
    'gain {"value":-6}': [{ level: -12.02, from: -6.02, span: [0, 8] }],
    'gain {"value":0}': [],
    'highpass {"freq":80}': [{ cutHz: [0, 80] }, { freq: 80 }],
    'lowpass {"freq":8000}': [{ cutHz: [8000, 22050] }, { freq: 8000 }],
    'shrink {"gap":0.3}': [], 'normalize {"target":-16,"mode":"lufs"}': [], 'reverse {}': [], 'pad {"before":1,"after":1}': [], 'stretch {"factor":1.25}': []
  }, 'what each draws from its values: a cut, a band, a level from where it is; none where its values do not say it')
  // shrink at −40 dB on the same sound, a second's pause after each second sounding: a cut in each pause, 0.3 s and the
  // rest of the block it begins in past the pause's start, to its end (the library's own count: below)
  const pause = await f.locator('body').evaluate(async () => { const { hint } = await import('/repl/ops.js'), sampleRate = 44100, ch = new Float32Array(8 * sampleRate).map((_, i) => (i / sampleRate) % 2 < 1 ? .5 * Math.sin(i / 7) : 0); return hint('shrink', { gap: .3, threshold: -40 }, { duration: 8, sampleRate, channels: [ch] }).map(m => m.cut) })
  assert.equal(pause.length, 4, `a cut in each pause: ${JSON.stringify(pause)}`)
  pause.forEach(([a, b], k) => assert.ok(a >= 2 * k + 1.3 && a < 2 * k + 1.3 + 1024 / 44100 + 1e-9 && Math.abs(b - Math.min(8, 2 * k + 2 - (k < 3 ? 136 / 44100 : 0))) < 1024 / 44100, `pause ${k + 1}: ${a}, ${b}`))
  // Shrink, made and set, against what the library does: its cuts, drawn on the sound before it as its threshold is
  // dragged, summed, are what the output loses once let go
  await f.locator('body').evaluate(async () => { const { ed } = await import('/repl/editor/context.js'); ed.change({ from: ed.code.length, insert: '.shrink(0.3, -30)' }) })
  await poll(() => made(f), ks => assert.deepEqual(ks, ['Shrink 0.3s, −30dB']))
  await f.locator('.chain-edit', { hasText: 'Shrink' }).click()
  const threshold = f.locator('#step-settings input[type="range"]').nth(1)
  await threshold.waitFor()
  // (−40 dB: its slider at half of −80 to 0)
  await threshold.evaluate(input => { input.value = 500; input.dispatchEvent(new Event('input', { bubbles: true })) })
  const pauses = await poll(marks, ms => assert.ok(ms.length && ms.every(m => m.cut), `its pauses' cuts: ${JSON.stringify(ms)}`))
  const input = await f.locator('body').evaluate(async () => (await import('/repl/editor/context.js')).output.duration)
  await threshold.evaluate(input => input.dispatchEvent(new Event('change', { bubbles: true })))
  await poll(() => made(f), ks => assert.deepEqual(ks, ['Shrink 0.3s, −40dB']))
  const after = await poll(() => f.locator('body').evaluate(async () => { const { ed, output } = await import('/repl/editor/context.js'); await __settled(); return output.code === ed.code ? output.duration : null }), d => assert.ok(d))
  const lost = pauses.reduce((s, m) => s + m.cut[1] - m.cut[0], 0)
  assert.ok(Math.abs(input - lost - after) < .005, `the cuts drawn (${lost.toFixed(3)} s off ${input}) are what the library takes: ${after}`)
  assert.deepEqual(errors, [])
})

// A value of a row dragged across, as Play is held and dragged: past a few px it follows the pointer over its setting's
// range (the range across 320 px, as its slider maps it), the row saying it, a line at its foot as far along, the
// picture's hint following; let go, it stays so, nothing made, the list open; each value its own (fade's out apart from
// its in), kept as the search changes. A press on the row then makes the edit with its values as they stand, the list shut, its settings shut.
// Escape puts a value back; the list shut, every value set goes back to its own. The pointer across over a value a
// drag sets; a value that is a word has none
test('editor: embedded, a row\'s values dragged across set it, the list open; a press on the row then makes it so', async () => {
  const { f } = await mount('chain')
  await length(f, '0:08.000')
  const row = name => f.locator('#edits-found .found-row', { hasText: new RegExp(`^${name}`) }).first()
  const value = (name, i) => row(name).locator('.found-value').nth(i)
  const says = name => row(name).evaluate(r => [r.querySelector('.found-hint > span').textContent, r.hasAttribute('data-held')])
  const cutOf = () => f.locator('body').evaluate(async () => (await import('/repl/editor/context.js')).v.guides.filter(g => g.cut).reduce((s, g) => s + g.cut[1] - g.cut[0], 0))
  const open = () => f.locator('#step-settings').evaluate(p => p.matches(':popover-open')), listed = () => f.locator('#edits-found').evaluate(l => l.matches(':popover-open'))
  const drag = async (el, dx) => { const b = await el.boundingBox(), x = b.x + b.width / 2, y = b.y + b.height / 2; await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x + dx / 2, y, { steps: 4 }); await page.mouse.move(x + dx, y, { steps: 4 }) }
  await f.locator('.chain-add').click()
  // the pointer across over a value a drag sets, as over a slider's thumb; none over a kind's row
  const cursor = (name, i = 0) => row(name).evaluate((r, i) => { const v = r.querySelectorAll('.found-value')[i]; return v ? getComputedStyle(v).cursor : 'none' }, i)
  assert.equal(await cursor('Filter'), 'none')
  const search = f.locator('.found-search')
  await search.fill('fade')
  assert.deepEqual([await cursor('Fade', 0), await cursor('Fade', 1)], ['ew-resize', 'ew-resize'])
  await search.fill('trim')
  assert.equal(await cursor('Trim'), 'ew-resize')
  await poll(cutOf, c => assert.ok(c > 0))
  const at40 = await cutOf()
  // Trim's 80 px right: a quarter of −80 to 0 dB on from −40, −20 dB
  await drag(value('Trim', 0), 80)
  await poll(() => row('Trim').evaluate(r => [r.querySelector('.found-hint > span').textContent, r.hasAttribute('data-held'), +getComputedStyle(r).getPropertyValue('--along')]), s => assert.deepEqual(s, ['−20dB', true, .75], 'the row says it, a line three quarters along'))
  await poll(cutOf, c => assert.ok(c > at40 + .1, `the picture's cut follows: ${c} past ${at40}`))
  await page.mouse.up()
  await poll(() => says('Trim'), s => assert.deepEqual(s, ['−20dB', false], 'let go: it stays so'))
  assert.deepEqual([await made(f), await listed(), await open()], [[], true, false], 'nothing made, the list open')
  // Fade's out alone, found, 48 px right: 0.75 s on of 0 to 5 s from 1 s; Trim's kept as it was set
  await search.fill('fade')
  await drag(value('Fade', 1), 48)
  await page.mouse.up()
  await poll(() => says('Fade'), s => assert.deepEqual(s, ['1s, 1.75s', false], 'its out alone'))
  // Escape mid-drag: that value back
  await drag(value('Fade', 0), 60)
  await poll(() => says('Fade'), s => assert.notDeepEqual(s, ['1s, 1.75s', false]))
  await page.keyboard.press('Escape')
  await page.mouse.up()
  await poll(() => says('Fade'), s => assert.deepEqual(s, ['1s, 1.75s', false], 'Escape: put back'))
  await search.fill('trim')
  await poll(() => says('Trim'), s => assert.deepEqual(s, ['−20dB', false], 'another\'s, as it was set'))
  // a press on the row: made with its values as they stand, the list shut, its settings shut (its values were set)
  await search.fill('fade')
  await row('Fade').click()
  await poll(() => made(f), ks => assert.deepEqual(ks, ['Fade 1s, 1.75s']))
  assert.deepEqual(await listed(), false)
  await page.waitForTimeout(200)
  assert.equal(await open(), false, 'its settings shut')
  // the list shut and open again: what a drag set and was not made, back to its own
  await f.locator('.chain-add').click()
  await search.fill('trim')
  await poll(() => says('Trim'), s => assert.deepEqual(s, ['−40dB', false], 'back to its own'))
  // a word's value (vocals: isolate) has no drag
  assert.deepEqual(await f.locator('body').evaluate(async () => { const { findable } = await import('/repl/editor/menus.js'); return findable('vocals', []).flatMap(g => g.items).filter(e => e.name === 'vocals').map(e => e.parts.map(p => p.drags)) }), [[false]], 'a word: no drag')
  assert.deepEqual(errors, [])
})

// A take recording in an embed whose bar names no Record (started from the sound's menu): Play its stop, a stop sign
// (Record staying out of sight, so there is one stop); nothing plays the old sound and the caret holds, a press on the
// picture and the arrows doing nothing; Space stops it wherever the keys are but text, the sound's name, a button,
// among them; Play again. The take a new sound in the page's sound's place, not written over it: the picture empty as
// it begins, the take's own once it stops, one step from the sound before, undo bringing that back
test('editor: embedded, a take recording has its Stop in sight, the caret and the old sound held till it stops', async () => {
  const { f } = await mount('chain')
  await length(f, '0:08.000')
  const play = f.locator('.panes .play'), record = f.locator('.panes .record'), caret = () => f.locator('body').evaluate(async () => (await import('/repl/editor/context.js')).v.cursor)
  const says = () => play.evaluate(b => [b.ariaLabel, b.disabled, !!b.querySelector('.play-icon.stop')])
  assert.equal(await record.isVisible(), false, 'no Record named: none')
  await f.locator('.embed-sound').click()
  await f.locator('.menubar-menu .menu-row', { hasText: /^Record/ }).click()
  await poll(says, s => assert.deepEqual(s, ['Stop recording', false, true], 'Play its stop, a stop sign'))
  assert.equal(await record.isVisible(), false, 'Record out of sight still: one stop')
  assert.match(await play.evaluate(b => b.title || b.dataset.popoffTitle), /^Stop recording \(Space\)/)
  await poll(() => f.locator('body').evaluate(async () => (await import('/repl/editor/context.js')).state.recording?.pending === false), on => assert.equal(on, true, 'recording'))
  const at = await caret()
  // a press on the picture, the arrows: nothing
  const box = await f.locator('.plot').boundingBox()
  await page.mouse.click(box.x + box.width * .6, box.y + box.height / 2)
  await f.locator('.plot').focus()
  await page.keyboard.press('ArrowRight')
  assert.equal(await caret(), at, 'the caret where it was')
  assert.equal(await f.locator('body').evaluate(async () => (await import('/repl/editor/context.js')).pl.playing), false, 'nothing playing')
  // Space, the keys on the sound's name (a button): it ends, Play again
  await f.locator('.embed-sound').focus()
  await page.keyboard.press('Space')
  await poll(() => f.locator('body').evaluate(async () => (await import('/repl/editor/context.js')).state.recording), r => assert.equal(r, null))
  await poll(says, s => assert.deepEqual(s, ['Play', false, false], 'stopped: Play again'))
  assert.equal(await f.locator('.menubar-menu').count(), 0, 'the name\'s menu not opened by it')
  // a sound of its own in the page's sound's place; undo, the page's sound; redo, the take again, read anew
  await poll(() => script(f), c => assert.equal(c, "audio('recording.wav')", 'the take, in its place'))
  await f.locator('.head-end .undo').click()
  await poll(() => script(f), c => assert.equal(c, "audio('chime.wav')", 'undone: the page\'s sound'))
  await length(f, '0:08.000')
  await f.locator('.head-end .redo').click()
  await poll(() => script(f), c => assert.equal(c, "audio('recording.wav')"))
  await poll(() => f.locator('body').evaluate(async () => { const { output, ed } = await import('/repl/editor/context.js'); return output?.code === ed.code && output.duration > 0 }), on => assert.equal(on, true, 'redone: the take read again'))
  assert.deepEqual(errors, [])
})

// A made edit's settings and the field's list are one or the other, never both open: the list opened (the field
// pressed, by the pointer or the keys) shuts the settings; an edit pressed (or Enter on it) shuts the list, its settings
// opening. An edit made from the list opens neither
both('an edit\'s settings and the field\'s list are never open together', async full => {
  const { f } = await mount('chain', { full })
  await length(f, '0:08.000')
  const opens = () => f.locator('body').evaluate(() => [document.querySelector('#step-settings').matches(':popover-open'), document.querySelector('#edits-found').matches(':popover-open')])
  await make(f, 'reverse')
  await poll(() => made(f), ks => assert.deepEqual(ks, ['Reverse']))
  await poll(opens, b => assert.deepEqual(b, [false, false], 'made: its settings shut, the list shut'))
  await f.locator('.chain-edit', { hasText: 'Reverse' }).click()
  await poll(opens, b => assert.deepEqual(b, [true, false], 'the edit pressed: its settings'))
  await f.locator('.chain-add').click()
  await poll(opens, b => assert.deepEqual(b, [false, true], 'the field pressed: the list, the settings shut'))
  await f.locator('.chain-edit', { hasText: 'Reverse' }).click()
  await poll(opens, b => assert.deepEqual(b, [true, false], 'the edit pressed: its settings, the list shut'))
  // by the keys: the field reached (Tab from the edit) and pressed shuts them; Enter on the edit shuts the list
  await f.locator('.chain-edit', { hasText: 'Reverse' }).focus()
  await page.keyboard.press('Tab')
  await page.keyboard.press('Enter')
  await poll(opens, b => assert.deepEqual(b, [false, true]))
  await f.locator('.chain-edit', { hasText: 'Reverse' }).focus()
  await page.keyboard.press('Enter')
  await poll(opens, b => assert.deepEqual(b, [true, false]))
  assert.deepEqual(errors, [])
})

// A setting of a made edit pointed at (or focused) shows what the edit would do on the picture, the part that setting
// governs whole, the rest a third as strong: a fade's in pointed at, its in ramp; its out, its out ramp; pointed away,
// none
test('editor: embedded, a setting pointed at marks its own part of the edit\'s hint, the rest quieter', async () => {
  const { f } = await mount('chain')
  await length(f, '0:08.000')
  const marks = () => f.locator('body').evaluate(async () => (await import('/repl/editor/context.js')).v.guides.filter(g => g.ramps).map(g => `${g.ramps[0][2]}${g.quiet ? ' quiet' : ''}`))
  await make(f, 'fade')
  await opened(f)
  const rows = f.locator('#step-settings .param')
  await rows.nth(0).hover()
  await poll(marks, ms => assert.deepEqual(ms, ['in', 'out quiet'], 'in pointed at'))
  await rows.nth(1).hover()
  await poll(marks, ms => assert.deepEqual(ms, ['in quiet', 'out'], 'out pointed at'))
  await rows.nth(2).hover()
  await poll(marks, ms => assert.deepEqual(ms, ['in', 'out'], 'the curve, both its'))
  await page.mouse.move(2, 2)
  await poll(marks, ms => assert.deepEqual(ms, [], 'pointed away: none'))
  // by the keys, focused
  await rows.nth(1).locator('input').focus()
  await poll(marks, ms => assert.deepEqual(ms, ['in quiet', 'out']))
  assert.deepEqual(errors, [])
})

// An edit of the chain says the values it is made with whether the code gives them by their place or by their name, in
// its settings' order, each in its unit; not a range's place and length, which the selection sets (menus.js
// valuesOfStep)
both('the chain says each edit\'s values, given by their place or by their name', async full => {
  const { f } = await mount('chain', { full, script: "audio('chime.wav')\n  .highpass(120)\n  .highpass({ order: 4, freq: 200 })\n  .deconstruct(0, -24, 0, { separation: 4 })\n  .gain(-6, { at: 1, d: 1 })" })
  await length(f, '0:08.000')
  await poll(() => made(f), ks => assert.deepEqual(ks, ['Highpass 120Hz', 'Highpass 200Hz, 4', 'Deconstruct 0dB, −24dB, 0dB, 4×', 'Gain −6dB']))
  assert.deepEqual(errors, [])
})

// A step that throws as it is called is skipped, the rest of the chain made without it (run.js); its edit in the chain
// says so in the problem's red, its error's first line its tooltip, two lines at the most, and so does the tab of its
// settings opened; the others as they were
both('a step that throws is marked on its edit in the chain, its error its tooltip', async full => {
  const { f } = await mount('chain', { full, script: "audio('chime.wav')\n  .gain(1, 2, 3)\n  .fade(0.5, 0.5)" })
  const failed = f.locator('.chain-edit[data-failed]')
  await failed.waitFor()
  assert.deepEqual(await failed.evaluateAll(es => es.map(e => [e.querySelector('.edit-name').textContent, e.getAttribute('title') ?? e.dataset.popoffTitle, e.getAttribute('aria-label')])), [['Gain', 'Skipped: gain: expected at most 1 argument (value), got 3', 'Gain 1dB, skipped']])
  assert.equal(await f.locator('.chain-edit:not([data-failed])').count(), 1, 'the fade made')
  const [red, ink] = await Promise.all([failed.locator('.edit-name').evaluate(e => getComputedStyle(e).color), f.locator('.message.problem').evaluate(e => getComputedStyle(e).color).catch(() => null)])
  if (ink) assert.equal(red, ink, 'in the problem\'s red')
  await failed.click()
  await f.locator('.step-tab[data-failed]').waitFor({ state: 'attached' })
})

// One that fails as the chain renders, long after it is called, is marked the same: an op the script registers whose
// preparation fails, as a model that does not load does (worker.js: the call that made the edit the engine names)
both('a step that fails as the chain renders is marked on its edit in the chain, its error its tooltip', async full => {
  const { f } = await mount('chain', { full, script: "audio.op('flaky', { prepare: () => Promise.reject(new Error('the model did not load')), process: (input, output) => input.forEach((x, c) => output[c].set(x)) })\naudio('chime.wav')\n  .flaky()\n  .fade(0.5, 0.5)" })
  const failed = f.locator('.chain-edit[data-failed]')
  await failed.waitFor()
  assert.deepEqual(await failed.evaluateAll(es => es.map(e => [e.querySelector('.edit-name').textContent, e.getAttribute('title') ?? e.dataset.popoffTitle, e.getAttribute('aria-label')])), [['Flaky', 'Skipped: the model did not load', 'Flaky, skipped']])
  assert.equal(await f.locator('.chain-edit:not([data-failed])').count(), 1, 'the fade made')
  await length(f, '0:08.000')
  assert.deepEqual(errors, [])
})

// Bypass, beside Remove at an edit's settings' foot: pressed, the edit stays where it stands in the chain, struck
// through, its call commented out where it is (as the edits' cards' switch has it), the sound as without it; pressed
// again, on; each one undo step; its settings stay open, set, they go into its comment
both('an edit bypassed stays in the chain, off, the sound as without it; undone as any', async full => {
  const { f } = await mount('chain', { full })
  await length(f, '0:08.000')
  const code = () => f.locator('body').evaluate(async () => (await import('/repl/editor/context.js')).ed.code)
  const off = () => f.locator('.chain-step > .chain-edit').evaluateAll(es => es.map(e => `${e.textContent}${e.hasAttribute('data-off') ? ' off' : ''}`))
  await make(f, 'stretch')
  await poll(() => made(f), ks => assert.deepEqual(ks, ['Stretch 1.25×']))
  await length(f, '0:10.000')
  await opened(f)
  const bypass = f.locator('#step-settings .step-bypass')
  await poll(() => bypass.isVisible(), v => assert.equal(v, true, 'its settings open, Bypass at their foot'))
  assert.deepEqual(await f.locator('#step-settings .step-foot button').allTextContents(), ['Bypass', 'Remove'], 'Bypass beside Remove')
  assert.equal(await bypass.getAttribute('aria-pressed'), 'false')
  await bypass.click()
  await poll(off, ks => assert.deepEqual(ks, ['Stretch1.25× off'], 'where it stands, off'))
  await length(f, '0:08.000')
  assert.match(await code(), /\n {2}\/\/ \.stretch\(1\.25\)$/, 'commented out where it stands')
  assert.equal(await bypass.getAttribute('aria-pressed'), 'true', 'pressed while off')
  assert.equal(await f.locator('.chain-edit', { hasText: 'Stretch' }).evaluate(e => getComputedStyle(e.querySelector('.edit-name')).textDecorationLine), 'line-through')
  // Remove, which takes the edit away, in red (the error token), the one control so; Bypass not
  assert.deepEqual(await f.locator('#step-settings').evaluate(p => { const red = getComputedStyle(document.documentElement).getPropertyValue('--color-screen-error').match(/[\d.]+/g).slice(0, 3).join(','), ink = e => getComputedStyle(e).color.match(/[\d.]+/g).slice(0, 3).join(','); return [ink(p.querySelector('.step-remove')) === red, ink(p.querySelector('.step-bypass')) === red] }), [true, false], 'Remove red, Bypass not')
  // set while off: into its comment, nothing run
  await f.locator('#step-settings input[type="range"]').first().evaluate(input => { input.value = 500; input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true })) })
  await poll(code, c => assert.match(c, /\/\/ \.stretch\(1\)$/))
  await bypass.click()
  await poll(off, ks => assert.deepEqual(ks, ['Stretch1×']))
  // one undo step each
  await f.locator('.head-end .undo').click()
  await poll(off, ks => assert.deepEqual(ks, ['Stretch1× off']))
  await f.locator('.head-end .undo').click()
  await poll(off, ks => assert.deepEqual(ks, ['Stretch1.25× off']))
  await f.locator('.head-end .undo').click()
  await poll(off, ks => assert.deepEqual(ks, ['Stretch1.25×']))
  await length(f, '0:10.000')
  assert.deepEqual(errors, [])
})

// A list as tall as the frame lets it be; only where it is still cut short it scrolls, no bare scrollbar: at the cut
// edge the rows fade out under a chevron pointing there, the top's once scrolled, the foot's gone at its end; pointed
// at, the chevron scrolls the list that way at a steady pace, to its end (menu.js cue)
test('editor: embedded, a list cut short by the frame says so at its cut edges, no bare scrollbar', async () => {
  const { f } = await mount('chain')
  await length(f, '0:08.000')
  await page.setViewportSize({ width: 1280, height: 300 })
  await page.evaluate(() => { document.querySelector('audio-repl').style.height = '300px' })
  await poll(() => f.locator('body').evaluate(() => innerHeight), h => assert.ok(h <= 300))
  await f.locator('.chain-add').click()
  // (its rows scroll under its search: .found-list)
  const cut = () => f.locator('#edits-found .found-list').evaluate(l => ({ up: l.hasAttribute('data-up'), down: l.hasAttribute('data-down'), scrolls: l.scrollHeight > l.clientHeight, bar: l.offsetWidth - l.clientWidth, chevrons: [...l.querySelectorAll(':scope > .menu-more')].map(m => `${m.classList[1]} ${getComputedStyle(m).visibility}`), foot: Math.round(l.getBoundingClientRect().bottom), H: innerHeight }))
  const s = await poll(cut, c => assert.deepEqual([c.scrolls, c.up, c.down], [true, false, true], JSON.stringify(c)))
  assert.ok(s.foot >= s.H - 8 - 1, `as tall as the frame lets it be: ${s.foot} of ${s.H}`)
  assert.deepEqual([s.bar, s.chevrons], [0, ['up hidden', 'down visible']], 'no scrollbar; the foot\'s chevron')
  // the foot's chevron pointed at: the list goes down by itself, at a steady pace, to its end
  const top = () => f.locator('#edits-found .found-list').evaluate(l => l.scrollTop)
  await f.locator('#edits-found .found-list > .menu-more.down').hover()
  const t0 = await top()
  await poll(top, t => assert.ok(t > t0 + 4, `scrolling down: ${t} from ${t0}`))
  await poll(cut, c => assert.deepEqual([c.up, c.down, c.chevrons], [true, false, ['up visible', 'down hidden']], 'at its end: the top\'s, the foot\'s gone'))
  // the top's pointed at, back up to its start
  await f.locator('#edits-found .found-list > .menu-more.up').hover()
  await poll(cut, c => assert.deepEqual([c.up, c.down], [false, true], 'pointed at, the top\'s scrolls it back up'))
  await page.setViewportSize({ width: 1280, height: 720 })
  assert.deepEqual(errors, [])
})

// The history's keys wherever the keys are in the frame but where text is written: ⌘Z (Ctrl+Z) undoes and ⇧⌘Z (Ctrl+Shift+Z,
// Ctrl+Y) redoes after a row of the list was pressed (the keys back with the page), with an edit's slider in hand, on
// an edit of the chain, on the picture. In the field, while a word is typed there, its own
test('editor: embedded, the history\'s keys work wherever the keys are in the frame', async () => {
  const { f } = await mount('chain')
  await length(f, '0:08.000')
  const where = () => f.locator('body').evaluate(() => { const e = document.activeElement; return e === document.body ? 'page' : e.matches('input[type="range"]') ? 'slider' : e.className.split(' ')[0] })
  // a row pressed (found by its name): made, the keys with the page
  await f.locator('.chain-add').click()
  await f.locator('.found-search').fill('trim')
  await f.locator('#edits-found .found-row', { hasText: /^Trim/ }).first().click()
  await poll(() => made(f), ks => assert.deepEqual(ks, ['Trim −40dB']))
  assert.equal(await where(), 'page')
  await page.keyboard.press('ControlOrMeta+Z')
  await poll(() => made(f), ks => assert.deepEqual(ks, [], 'after a row pressed: undone'))
  await page.keyboard.press('ControlOrMeta+Shift+Z')
  await poll(() => made(f), ks => assert.deepEqual(ks, ['Trim −40dB'], 'redone'))
  // a slider in hand (its settings opened by a press on it)
  await opened(f)
  const slider = f.locator('#step-settings input[type="range"]').first()
  await slider.focus()
  await slider.evaluate(input => { input.value = 250; input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true })) })
  await poll(() => made(f), ks => assert.deepEqual(ks, ['Trim −60dB']))
  assert.equal(await where(), 'slider')
  await page.keyboard.press('ControlOrMeta+Z')
  await poll(() => made(f), ks => assert.deepEqual(ks, ['Trim −40dB'], 'a slider in hand: undone'))
  await page.keyboard.press('Control+Y')
  await poll(() => made(f), ks => assert.deepEqual(ks, ['Trim −60dB'], 'Ctrl+Y: redone'))
  // on an edit of the chain
  await page.keyboard.press('Escape')
  await poll(where, w => assert.equal(w, 'chain-edit'))
  await page.keyboard.press('ControlOrMeta+Z')
  await poll(() => made(f), ks => assert.deepEqual(ks, ['Trim −40dB'], 'on the edit: undone'))
  // on the picture
  await f.locator('.plot').focus()
  await page.keyboard.press('ControlOrMeta+Z')
  await poll(() => made(f), ks => assert.deepEqual(ks, [], 'on the picture: undone'))
  await page.keyboard.press('ControlOrMeta+Shift+Z')
  await poll(() => made(f), ks => assert.deepEqual(ks, ['Trim −40dB'], 'on the picture: redone'))
  // in the field, a word typed: its own undo, the chain as it is
  await f.locator('.chain-add').click()
  await page.keyboard.type('fa')
  await page.keyboard.press('ControlOrMeta+Z')
  assert.deepEqual(await made(f), ['Trim −40dB'], 'typing: the field\'s own')
  await page.keyboard.press('Escape')
  assert.deepEqual(errors, [])
})

// What the engine is doing while an edit is applied (a recipe's chain, a model's run) said in the bar in the place of
// the kind and the level by the length (the message's own words: Applying deepfilter, how far it has come), whatever
// the page names of the bar; done, the kind and the level back
test('editor: embedded, an edit being applied says so in the place of the readouts, which come back once done', async () => {
  const { f } = await mount('chain')
  await length(f, '0:08.000')
  const bar = () => f.locator('body').evaluate(() => { const q = s => document.querySelector(s), on = s => !!q(s)?.checkVisibility(); return { message: on('.message') ? q('.message').textContent : null, kind: on('.bar-kind'), level: on('.readout'), left: Math.round(q('.message').getBoundingClientRect().left), after: Math.round(q('.clock').getBoundingClientRect().right) } })
  await poll(bar, b => assert.deepEqual([b.message, b.kind, b.level], [null, true, true], 'at rest: the kind and the level'))
  // (the engine's words as status() writes them while it works: run.js)
  await f.locator('body').evaluate(async () => Object.assign((await import('/repl/editor/context.js')).state, { progress: 'Applying deepfilter', figure: '42%', working: true }))
  const b = await poll(bar, b => assert.deepEqual([b.message, b.kind, b.level], ['Applying deepfilter 42%', false, false], 'working: what is done, by name, in their place'))
  assert.ok(b.left >= b.after && b.left - b.after < 24, `by the length, where the kind stood: ${b.left}, the length's end at ${b.after}`)
  await f.locator('body').evaluate(async () => Object.assign((await import('/repl/editor/context.js')).state, { progress: '', figure: '', working: false }))
  await poll(bar, b => assert.deepEqual([b.message, b.kind, b.level], [null, true, true], 'done: the kind and the level back'))
  assert.deepEqual(errors, [])
})

// The kind's readout: before the level, the word, its tooltip what more is known of the sound, not who said the word
// nor by which rule (readouts.js kindTip): here the page's line on it (`about`), in its sample's own line's place; a
// sample's own line; a heard sound's, the classes the tagger found it most like where it named it, each a word once,
// else its shares of speech and music; nothing more known, none. Pressed, a menu of what it shows instead, the kind
// first, each with its value: the note or chords at the caret, the key, the tempo, as the repl hears them (listen)
test('editor: embedded, the kind before the level, what more is known of the sound in its tooltip; pressed, the note, the key or the tempo instead', async () => {
  const about = 'Two tones at a gate\nRising, then falling'
  const { f } = await mount('chain', { ui: { about } })
  await length(f, '0:08.000')
  const kind = f.locator('.bar-kind'), title = () => kind.evaluate(e => e.title || e.dataset.popoffTitle)
  await poll(() => kind.textContent(), t => assert.equal(t, 'chime'))
  assert.ok(await f.locator('body').evaluate(() => document.querySelector('.bar-kind').getBoundingClientRect().right <= document.querySelector('.readout').getBoundingClientRect().left), 'before the level')
  assert.equal(await title(), about)
  const tip = (name, word, facts) => f.locator('body').evaluate(async (_, [name, word, facts]) => (await import('/repl/editor/readouts.js')).kindTip(name, word, { [name]: facts }), [name, word, facts])
  assert.equal(await tip('handpan.wav', 'music'), 'Handpan, a slow phrase in D minor', 'a sample\'s own line')
  assert.equal(await tip('take.wav', 'speech', { shares: { speech: .62, music: .3, noise: .08 }, tags: null }), '62% speech, 30% music, 8% neither')
  assert.equal(await tip('take.wav', 'music', { shares: { speech: 0, music: .998, noise: .002 }, tags: null }), '100% music', 'a share under half a percent not said')
  assert.equal(await tip('phone.wav', 'telephone', { shares: { speech: 0, music: 0, noise: 1 }, like: [['telephone', .98], ['busy signal', .98], ['alarm', .91]] }), 'Most like telephone 0.98, busy signal 0.98, alarm 0.91', 'what the tagger heard it as, not its shares')
  assert.equal(await tip('quiet.wav', 'silence', { shares: null, like: null }), '', 'nothing more known: none')
  // pressed: what it shows, the kind first
  await kind.click()
  const rows = await poll(() => f.locator('.menubar-menu .menu-row').evaluateAll(rs => rs.map(r => [r.querySelector('.menu-label').textContent, r.getAttribute('aria-checked')])), rs => assert.equal(rs.length, 4))
  assert.deepEqual(rows, [['What it is', 'true'], ['Note', 'false'], ['Key', 'false'], ['Tempo', 'false']])
  await f.locator('.menubar-menu .menu-row', { hasText: 'Key' }).click()
  await poll(() => kind.textContent(), t => assert.match(t, /^([A-G][♯♭#b]? (major|minor)|–)$/, `the key, or none clear: ${t}`))
  assert.match(await title(), /^(Key |Nothing clear)/)
  await kind.click()
  await f.locator('.menubar-menu .menu-row', { hasText: 'What it is' }).click()
  await poll(() => kind.textContent(), t => assert.equal(t, 'chime', 'back to the word'))
  assert.deepEqual(errors, [])
})

// The row's right end, aligned there: the history (Undo, Redo, each only while it can act, its place kept), the save,
// its icon and its word, Save, then the way to the editor, its mark alone that it leaves the page, named Open in the editor
// (its name and its tooltip), the last thing on the row, its mark on the inset's line. The keys' way: the name, the
// edits, the field, the history, Save, the repl. On a phone, the right end on the name's row, the chain on a row of its
// own under them, nothing past the frame
test('editor: embedded, the row\'s right end: Undo, Redo, Save, the repl', async () => {
  const { f } = await mount('chain', { controls: `${CONTROLS} link` })
  await length(f, '0:08.000')
  const end = () => f.locator('body').evaluate(() => {
    const q = s => document.querySelector(s), r = s => q(s).getBoundingClientRect(), inset = parseFloat(getComputedStyle(q('.view-head')).paddingLeft)
    return { order: [...q('.view-head').children].filter(e => e.getClientRects().length).map(e => e.className.split(' ')[0]), inEnd: [...q('.head-end').children].map(e => e.className.split(' ')[0]), save: q('.head-end .embed-save').textContent.trim(), repl: [q('.embed-open').innerText.trim(), q('.embed-open').ariaLabel, q('.embed-open').title || q('.embed-open').dataset.popoffTitle, !!q('.embed-open svg'), q('.embed-open').target], adjacent: Math.round(r('.embed-open').left - r('.head-end').right), line: Math.abs(r('.embed-open svg').right - (innerWidth - inset)) <= 2, name: Math.round(r('.embed-sound').top), endTop: Math.round(r('.head-end').top), chain: Math.round(r('.embed-chain').top) }
  })
  const e = await end()
  assert.deepEqual([e.order, e.inEnd, e.save, e.repl, e.line], [['embed-sound', 'embed-chain', 'head-end', 'embed-open'], ['history', 'before', 'embed-save'], 'Save', ['', 'Open in the editor', 'Open in the editor', true, '_blank'], true], 'the history, Before (out of sight: not named), Save, then the repl\'s mark alone, named, its mark on the inset\'s line')
  assert.equal(await f.locator('.head-end .before').isVisible(), false, 'Before not named: none')
  assert.ok(e.adjacent >= 0 && e.adjacent <= 8, `the repl right after the save, the row's gap between: ${e.adjacent} px`)
  await make(f, 'reverse')
  await poll(() => made(f), ks => assert.deepEqual(ks, ['Reverse']))
  await f.locator('.embed-sound').focus()
  const walk = []
  for (let i = 0; i < 6; i++) { await page.keyboard.press('Tab'); walk.push(await f.locator('body').evaluate(() => { const e = document.activeElement; return `${e.className.split(' ')[0]} ${e.ariaLabel || e.textContent.trim()}` })) }
  assert.deepEqual(walk, ['chain-edit Reverse', 'chain-add Add an edit', 'icon-button Undo', 'icon-button Redo', 'embed-save Save as', 'embed-open Open in the editor'], `the keys' way, Redo among them, dimmed: ${walk}`)
  // a phone's frame: the right end on the name's row, the chain under it
  await width(390)
  await poll(() => f.locator('body').evaluate(() => innerWidth), w => assert.equal(w, 390))
  await poll(end, p => assert.ok(Math.abs(p.endTop - p.name) <= 2 && p.chain > p.name + 10, `the right end on the name's row, the chain under: ${JSON.stringify(p)}`))
  assert.deepEqual((await lay(f)).past, [], 'nothing past the frame')
  await width(null)
  assert.deepEqual(errors, [])
})

// The sound's name's menu and the edits' list read as one family (the list laid as the page's menus are, menu.js):
// the same ground, corners and shadow, padding, a row as tall, its words and its hints at the same sizes (16 px and
// 13 px under font sans), its icon as large and as far in, the lit row's ground the same, a hairline between groups
// as theirs between sections, each 8 px in from the frame
test('editor: embedded, the name\'s menu and the edits\' list are one family', async () => {
  const { f } = await mount('chain')
  await length(f, '0:08.000')
  const metrics = (menu, row, name, hint, icon, lit, rule) => f.locator('body').evaluate((_, [menu, row, name, hint, icon, lit, rule]) => {
    const m = document.querySelector(menu), r = m.querySelector(row), cs = e => getComputedStyle(e), ic = r.querySelector(icon)
    return { ground: cs(m).backgroundColor, corner: cs(m).borderTopLeftRadius, shadow: cs(m).boxShadow, padding: cs(r.closest('.found-list') ?? m).paddingTop, row: Math.round(r.getBoundingClientRect().height), rowCorner: cs(r).borderTopLeftRadius, name: cs(r.querySelector(name)).fontSize, hint: cs(m.querySelector(hint)).fontSize, icon: [Math.round(ic.getBoundingClientRect().width), Math.round(ic.getBoundingClientRect().left - r.getBoundingClientRect().left)], lit: cs(m.querySelector(lit)).backgroundColor, rule: m.querySelector(rule) ? cs(m.querySelector(rule)).borderTopColor : null, inset: Math.round(m.getBoundingClientRect().left) >= 8 }
  }, [menu, row, name, hint, icon, lit, rule])
  await f.locator('.embed-sound').click()
  await f.locator('.menubar-menu .menu-row').first().focus()
  const file = await metrics('.menubar-menu', '.menu-row', '.menu-label', '.menu-keys', '.menu-check svg', '.menu-row:focus', 'hr')
  await page.keyboard.press('Escape')
  await f.locator('.chain-add').click()
  const edits = await metrics('#edits-found', '.found-row', '.found-name strong', '.found-hint', 'svg', '.found-row[aria-selected="true"]', '.found-group:not([data-sub]) + .found-group:not([data-sub])')
  assert.deepEqual(edits, file, `one family: ${JSON.stringify({ file, edits })}`)
  assert.deepEqual([edits.name, edits.hint, edits.row], ['16px', '13px', 32], 'under font sans: words 16 px, hints 13 px, a row 32 px')
  assert.deepEqual(errors, [])
})

// With no sound to edit (its file not here), the field dimmed and saying so, never disabled: it takes the keys, pressed
// its list opens, dimmed too, and Enter or a press makes nothing
test('editor: embedded, with no sound the chain\'s field dimmed, the keys still its', async () => {
  const { f } = await mount('chain', { script: "audio('//elsewhere.example/x.wav')" })
  await f.locator('.panes .text-button', { hasText: 'Open it' }).waitFor()
  const field = f.locator('.chain-add')
  assert.equal(await field.getAttribute('aria-disabled'), 'true')
  assert.equal(await field.evaluate(e => getComputedStyle(e).opacity), '0.35', 'dimmed')
  await field.focus()
  assert.equal(await field.evaluate(e => document.activeElement === e), true, 'the keys still take it')
  await page.keyboard.press('Enter')
  await poll(() => f.locator('#edits-found .found-row[aria-disabled="true"]').count(), n => assert.ok(n > 10, `its list open, dimmed: ${n}`))
  await page.keyboard.press('Enter')
  await f.locator('#edits-found .found-row').first().click({ force: true })
  await page.waitForTimeout(300)
  assert.equal(await f.locator('.chain-edit').count(), 0, 'nothing made')
  assert.deepEqual(errors, [])
})

// Narrow (the bar 700 px, 360 px): every part inside the frame; the chain on a row of its own under the name, its first
// mark on the inset's line, the save on the name's row, the field within the inset's lines. A chain longer than its row
// runs on under it, the field with it, the name and the save on its first line, no line starting with a bar
test('editor: embedded, the chain in a narrow frame: whole, inside it, the field running on with it', async () => {
  const { f } = await mount('chain')
  await length(f, '0:08.000')
  for (const name of ['Normalize', 'Fade', 'Stretch']) {
    await make(f, name.toLowerCase())
    await poll(() => f.locator('.chain-edit').count(), n => assert.ok(n >= ['Normalize', 'Fade', 'Stretch'].indexOf(name) + 1))
  }
  for (const px of [700, 360]) {
    await width(px)
    await poll(() => lay(f), l => {
      const b = l.box, near = (a, c, d = 1.5) => Math.abs(a - c) <= d, row = s => b[s].top + b[s].height / 2
      assert.deepEqual(l.past, [], `at ${px}: nothing past the frame's edges`)
      assert.equal(l.W, px)
      assert.ok(b['.embed-chain'].top >= b['.embed-sound'].bottom - 1 && near(row('.head-end'), row('.embed-sound'), 2), `at ${px}: the chain under the name, the save on its row`)
      assert.ok(b['.embed-chain'].left >= l.inset - 11 && b['.chain-add'].right <= l.W - l.inset + 1, `at ${px}: the chain and its field within the inset's lines: ${JSON.stringify([b['.embed-chain'], b['.chain-add']])}`)
    })
    assert.ok(await f.locator('.embed-chain').evaluate(c => { const first = [...c.querySelectorAll('.chain-edit .edit-icon, .chain-edit .edit-name')].find(e => e.checkVisibility()).getBoundingClientRect().left, inset = parseFloat(getComputedStyle(document.querySelector('.view-head')).paddingLeft); return Math.abs(first - inset) <= 1.5 }), 'the chain\'s first edit (its icon) on the inset\'s line')
  }
  await width(null)
  // a chain longer than its row with its names: compact, each edit its icon alone, on the row still, the picture where it was
  const view = (await lay(f)).box['.view'].top
  for (const [i, name] of ['gain', 'pan', 'highpass', 'lowpass', 'bandpass', 'notch'].entries()) { await make(f, name); await poll(() => f.locator('.chain-edit').count(), n => assert.equal(n, 4 + i)) }
  await poll(async () => ({ ...await lay(f), compact: await f.locator('.embed-chain').evaluate(c => c.hasAttribute('data-compact')) }), l => {
    const b = l.box, on = l.compact
    assert.ok(on && b['.embed-chain'].height <= 30 && Math.abs(b['.embed-sound'].top - b['.embed-chain'].top) <= 1 && Math.abs(b['.head-end'].top - b['.embed-chain'].top) <= 1, `compact, on the name's row: ${JSON.stringify([b['.embed-sound'], b['.embed-chain'], b['.head-end']])}`)
    assert.equal(b['.view'].top, view, 'the picture where it was')
    assert.deepEqual(l.past, [])
  })
  // each of its lines starts with an edit or the field, never a bar; between two on a line, a bar (a frame narrow
  // enough for those made, compact as they are, to run on to lines of their own)
  await width(320)
  await poll(() => f.locator('.embed-chain').evaluate(c => [...c.querySelectorAll('.chain-step, .chain-find')].map((s, i, all) => [i > 0 && s.offsetTop > all[i - 1].offsetTop + 2, getComputedStyle(s, '::before').visibility === 'visible' && getComputedStyle(s, '::before').content === '""'])), steps => assert.ok(steps.some(([starts]) => starts) && steps.every(([starts, bar], i) => i ? starts !== bar : !bar), `no bar at a line's start: ${JSON.stringify(steps)}`))
  await width(null)
  assert.deepEqual(errors, [])
})

// Before the frame shows, its skeleton laid out as it will be: the chain's none under the bar, the picture down to the
// bar, the chain after the name and the save at the row's right end; the menu's, no chain
test('editor: embedded, the skeleton of the chain', async () => {
  const read = () => page.evaluate(() => { const el = document.querySelector('audio-repl'), top = el.getBoundingClientRect().top, parts = [...el.querySelectorAll('.wait i')].map(i => { const r = i.getBoundingClientRect(); return { top: r.top - top, bottom: r.bottom - top, left: r.left, right: r.right, height: r.height, area: i.classList.contains('area') } }); return { H: el.clientHeight, W: el.clientWidth, parts } })
  const looks = {}
  for (const edits of ['chain', '']) {
    const { release } = await mount(edits, { hold: true })
    await page.waitForFunction(() => document.querySelector('audio-repl .wait')?.childElementCount)
    looks[edits || 'menu'] = await read()
    release()
    await page.unroute('**/repl/?embed*')
  }
  const picture = edits => looks[edits].parts.find(p => p.area), { H, W } = looks.chain
  assert.equal(picture('chain').bottom, H - 60 - 8, 'chain: the picture down to the bar')
  assert.equal(picture('menu').bottom, H - 60 - 8, 'menu: as it was')
  assert.deepEqual(looks.chain.parts.filter(p => p.height === 1), [], 'no rule')
  const row = looks.chain.parts.filter(p => p.top < 30)
  assert.ok(row.length === 3 && row.some(p => p.right > W * .9) && row.every(p => p.left >= 0 && p.right <= W), `chain: the name, the chain, the save, on the row over the picture: ${JSON.stringify(row)}`)
  assert.equal(looks.menu.parts.filter(p => p.top < 30).length, 1, 'menu: the name alone over the picture')
  assert.deepEqual(errors, [])
})

// A figure's words at two sizes (ui font sans): the sound's name, the edits, the bar's small words (the level, the kind,
// the rate, the channels) at the tokens' text size (16 px), an edit's name in the field's list with them; the picture's
// labels, its times and its values, small under them (11 px); the large time stays large. Without it, the picture's
// labels at the skin's size, as they were
test('editor: embedded, a figure\'s words at one size, the picture\'s labels smaller: the name, the edits, the bar\'s facts; the times and the values', async () => {
  const { f } = await mount('chain')
  await length(f, '0:08.000')
  const sizes = () => f.locator('body').evaluate(() => {
    const px = s => getComputedStyle(document.querySelector(s)).fontSize
    return { words: ['.embed-sound-name', '.chain-add', '.readout', '.bar-kind', '.facts .fact'].map(px), label: getComputedStyle(document.querySelector('.plot')).getPropertyValue('--font-size-label').trim(), time: px('.time') }
  })
  const one = await sizes()
  assert.deepEqual([...new Set(one.words), one.label], ['16px', '11px'], `the words one size, the labels smaller: ${JSON.stringify(one)}`)
  assert.ok(parseFloat(one.time) > 30, `the time large: ${one.time}`)
  // what the field finds, as the field is set: an edit's name at the words' size, what it does under it smaller
  await f.locator('.chain-add').click()
  await f.locator('.edits-found .found-row').first().waitFor()
  assert.deepEqual(await f.locator('.edits-found').evaluate(l => ['.found-name strong', '.found-hint'].map(k => getComputedStyle(l.querySelector(k)).fontSize)), ['16px', '13px'], 'the list: names at the words\' size, values at the small text\'s')
  await page.keyboard.press('Escape')
  await page.goto(origin + '/blank.html')
  await page.evaluate(async () => { await import('/repl/embed.js'); document.body.innerHTML = `<audio-repl panel="none" height="320"><pre><code>audio('chime.wav')</code></pre></audio-repl>` })
  const plain = page.frameLocator('audio-repl iframe')
  await length(plain, '0:08.000')
  assert.equal(await plain.locator('.plot').evaluate(p => getComputedStyle(p).getPropertyValue('--font-size-label').trim()), '10px', 'as it comes: the labels at the skin\'s size')
  assert.deepEqual(errors, [])
})

// The page's own controls make an edit (embed.js edit(): a call as the ops write one), as a row of the chain's field
// does: asked before the frame is in, made once its sound is, on the chain, one undo step; a call the editor does not
// know makes nothing, said in the console
test('editor: embedded, the page makes an edit by the element\'s edit(), as the field would', async () => {
  const { f, release } = await mount('chain', { hold: true })
  const warned = []
  page.on('console', m => { if (m.type() === 'warning') warned.push(m.text()) })
  assert.equal(await page.evaluate(() => typeof document.querySelector('audio-repl').edit), 'function')
  await page.evaluate(() => { const el = document.querySelector('audio-repl'); el.edit('normalize(-1)'); el.edit('nonsense(3)') })
  release()
  await length(f, '0:08.000')
  await poll(() => made(f), ks => assert.deepEqual(ks, ['Normalize −1dB'], 'asked before the frame was in: made once its sound is'))
  await poll(() => warned, w => assert.ok(w.some(t => t.includes('no edit nonsense(3)')), `one it does not know, said: ${JSON.stringify(w)}`))
  await page.evaluate(() => document.querySelector('audio-repl').edit('reverse'))
  await poll(() => made(f), ks => assert.deepEqual(ks, ['Normalize −1dB', 'Reverse']))
  await f.locator('.head-end .undo').click()
  await poll(() => made(f), ks => assert.deepEqual(ks, ['Normalize −1dB'], 'one undo step'))
  assert.deepEqual(errors, [])
})

// What the chain's list offers, asked by the page (embed.js edits()), before the frame is in as after: by kind, in the
// list's order, recipes left out, each edit its call (what edit() takes, the list's own defaults), its row's words and
// value, its tooltip; a call of it, given to edit(), makes it as the row would
test('editor: embedded, the page asks what the list offers by the element\'s edits()', async () => {
  const { f, release } = await mount('chain', { hold: true })
  const asked = page.evaluate(() => document.querySelector('audio-repl').edits())
  release()
  const list = await asked
  assert.deepEqual(list.map(g => g.kind), ['Silence', 'Level', 'Filter', 'Dynamics', 'Repair', 'Time & pitch', 'Effect', 'Color', 'Reverb', 'Space'], 'by kind, in the list\'s order, no recipes, no generator')
  assert.deepEqual(list[0].edits, [
    { call: 'trim(-40)', name: 'Trim silence', value: '−40dB', line: 'Cut silence from both ends' },
    { call: 'shrink(0.3)', name: 'Shrink pauses', value: '0.3s', line: 'Shorten pauses' },
    { call: 'pad(0.5)', name: 'Pad with silence', value: '0.5s', line: 'Add silence before and after' },
    { call: 'insert(1)', name: 'Insert silence', value: '1s', line: 'A second of silence at the caret' }
  ])
  assert.ok(list.find(g => g.kind === 'Time & pitch').edits.some(e => e.call === 'reverse' && e.name === 'Reverse' && e.value === ''), 'one with no settings, its name its call')
  await length(f, '0:08.000')
  assert.deepEqual(await page.evaluate(() => document.querySelector('audio-repl').edits()), list, 'asked again once in: the same')
  await page.evaluate(call => document.querySelector('audio-repl').edit(call), list[0].edits[1].call)
  await poll(() => made(f), ks => assert.deepEqual(ks, ['Shrink 0.3s'], 'its call made as its row would'))
  assert.deepEqual(errors, [])
})

// Each edit of the chain its name and values; where they do not stand on one row with the field, or the frame is a
// phone's, compact: each its icon alone (its own, the list's row's, else its kind's), its name and values its tooltip's
// and a screen reader's. Alt with a press on it, or B on it, bypasses it (struck, dimmed, its call commented out), a step
// of the history, Undo bringing it back; again, on again; a plain press opens its settings
test('editor: embedded, an edit bypassed by Alt and a press or by B; compact, each edit its icon alone where the names do not fit', async () => {
  const { f } = await mount('chain')
  await length(f, '0:08.000')
  for (const name of ['normalize', 'reverse']) await make(f, name)
  await poll(() => made(f), ks => assert.equal(ks.length, 2))
  const compact = () => f.locator('.embed-chain').evaluate(c => [c.hasAttribute('data-compact'), [...c.querySelectorAll('.chain-edit')].map(e => [e.querySelector('.edit-icon').checkVisibility(), e.querySelector('.edit-name').checkVisibility(), e.getAttribute('aria-label')])])
  assert.deepEqual(await compact(), [false, [[false, true, 'Normalize −1dB'], [false, true, 'Reverse']]], 'wide: the names, no icons')
  const code = () => f.locator('body').evaluate(async () => (await import('/repl/editor/context.js')).ed.code)
  const edit = f.locator('.chain-step > .chain-edit').first()
  await edit.click({ modifiers: ['Alt'] })
  await poll(code, c => assert.match(c, /\/\/ \.normalize\(-1\)/, 'Alt and a press: its call commented out'))
  assert.deepEqual([await edit.getAttribute('data-off'), await edit.getAttribute('aria-label')], ['', 'Normalize −1dB, bypassed'])
  assert.equal(await f.locator('#step-settings').evaluate(p => p.matches(':popover-open')), false, 'its settings not opened')
  await f.locator('.head-end .undo').click()
  await poll(code, c => assert.doesNotMatch(c, /\/\/ \.normalize/, 'undone: on again'))
  await edit.focus()
  await page.keyboard.press('b')
  await poll(code, c => assert.match(c, /\/\/ \.normalize/, 'B on it: bypassed'))
  await page.keyboard.press('b')
  await poll(code, c => assert.doesNotMatch(c, /\/\/ \.normalize/, 'again: on again'))
  await edit.click()
  await poll(() => f.locator('#step-settings').evaluate(p => p.matches(':popover-open')), o => assert.equal(o, true, 'a plain press opens its settings'))
  await page.keyboard.press('Escape')
  // more edits than the row holds with their names: each its icon alone, its own, else its kind's
  for (const name of ['highpass', 'lowpass', 'stretch', 'pitch', 'fade', 'gain']) await make(f, name)
  await poll(compact, ([on]) => assert.equal(on, true, 'compact'))
  const [, rows] = await compact()
  assert.ok(rows.every(([icon, name, label]) => icon && !name && label), `each its icon alone, named: ${JSON.stringify(rows)}`)
  const icons = await f.locator('.chain-edit .edit-icon path').evaluateAll(ps => ps.map(p => p.getAttribute('d')))
  const own = await f.locator('body').evaluate(async () => (await import('/repl/icons.js')).default.normalize)
  assert.equal(icons[0], own, 'its own icon')
  assert.deepEqual(errors, [])
})

// An edit's settings open, another edit of the chain pointed at opens its own in their place, as a menu bar's menus do
// once one is open; none open, pointing opens nothing
both('while an edit\'s settings are open, pointing at another edit opens its settings', async full => {
  const { f } = await mount('chain', { full })
  await length(f, '0:08.000')
  for (const name of ['normalize', 'reverse']) await make(f, name)
  await poll(() => made(f), ks => assert.equal(ks.length, 2))
  const open = () => f.locator('#step-settings').evaluate(p => p.matches(':popover-open') ? p.querySelector('.step-tab .edit-name')?.textContent : null)
  const at = async name => { const b = await f.locator('.chain-step > .chain-edit', { hasText: name }).boundingBox(); await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 3 }) }
  await at('Reverse')
  await page.waitForTimeout(300)
  assert.equal(await open(), null, 'none open: pointing opens nothing')
  await f.locator('.chain-step > .chain-edit', { hasText: 'Normalize' }).click()
  await poll(open, n => assert.equal(n, 'Normalize'))
  await at('Reverse')
  await poll(open, n => assert.equal(n, 'Reverse', 'pointed at: its own, the first shut'))
  await at('Normalize')
  await poll(open, n => assert.equal(n, 'Normalize', 'and back'))
  // the foot's words centred in their buttons
  assert.deepEqual(await f.locator('#step-settings :is(.step-bypass, .step-remove)').evaluateAll(bs => bs.map(b => { const s = getComputedStyle(b); return [s.justifyContent, s.textAlign] })), [['center', 'center'], ['center', 'center']])
  assert.deepEqual(errors, [])
})

// Before (controls before), by the history, the bar's Before in its place: the editor's one comparison (play.js toggleAB,
// B), there while an edit is on; pressed, the sound before the edits, in the picture and in what plays, at the edits'
// loudness, playing on from where it was, the script and the history untouched; again, the edits; the bar has none
both('Before shows and plays the sound before the edits, level-matched, again the edits, the history untouched', async full => {
  const { f } = await mount('chain', { controls: `${CONTROLS} before`, full })
  await length(f, '0:08.000')
  const before = f.locator('.head-end .before')
  // no edit on: not there (the owner, 20 Nov: "let's not display \"before\" button if there was no edits"); what stands at
  // its right (embedded, Save; else the row's end) where it is when the first edit brings it
  const save = () => f.locator('.head-end').evaluate(h => { let n = h.querySelector('.before').nextElementSibling; while (n && !n.checkVisibility()) n = n.nextElementSibling; return Math.round(n ? n.getBoundingClientRect().left : h.getBoundingClientRect().right) })
  assert.equal(await before.evaluate(b => b.checkVisibility()), false, 'no edit on: no Before')
  const at = await save()
  assert.equal(await f.locator('.status .before').count(), 0, 'none in the bar: the row\'s is it')
  await make(f, 'reverse')
  await poll(() => made(f), ks => assert.deepEqual(ks, ['Reverse']))
  await poll(() => before.evaluate(b => b.checkVisibility()), shown => assert.equal(shown, true, 'an edit on: it is there'))
  assert.equal(await save(), at, 'nothing at its right moved as the first edit brought it')
  // its sign a compare view's divider: two halves, the first filled, parted by a line taller than both
  assert.deepEqual(await before.locator('svg').evaluate(s => { const ps = [...s.querySelectorAll('path')], box = p => p.getBBox(); return [ps.length, ps.filter(p => p.getAttribute('fill') === 'currentColor').length, box(ps[2]).height > box(ps[0]).height, box(ps[2]).width] }), [3, 1, true, 0], 'its sign: two halves, one filled, a divider taller than both between them')
  const read = () => f.locator('body').evaluate(async () => { const { ed, output, state, pl } = await import('/repl/editor/context.js'); return { code: ed.code, ran: output?.code, loudness: output?.stats?.loudness, gain: state.abGain, undo: state.canUndo, playing: pl.playing, time: pl.time } })
  const was = await read()
  await f.locator('.panes .play').click()
  await poll(read, r => assert.ok(r.playing))
  await page.waitForTimeout(400)
  const t0 = (await read()).time
  await before.click()
  const on = await poll(read, r => assert.equal(r.ran, "audio('chime.wav')", 'the sound before the edits'))
  assert.equal(await before.getAttribute('aria-pressed'), 'true')
  assert.deepEqual([on.code, on.undo, on.playing], [was.code, was.undo, true], 'the script and the history as they were, still playing')
  assert.ok(on.time >= t0, `on from where it was: ${on.time} after ${t0}`)
  assert.ok(Math.abs(on.gain - (was.loudness - on.loudness)) < 1e-9, `at the edits' loudness: ${on.gain} dB`)
  await before.click()
  await poll(read, r => assert.equal(r.ran, was.code, 'the edits again'))
  assert.equal(await before.getAttribute('aria-pressed'), 'false')
  await f.locator('.panes .play').click()
  // an edit made meanwhile: the edits again
  await before.click()
  await poll(() => before.getAttribute('aria-pressed'), p => assert.equal(p, 'true'))
  await make(f, 'normalize')
  await poll(() => before.getAttribute('aria-pressed'), p => assert.equal(p, 'false', 'the script changed: after again'))
  await f.locator('.head-end .undo').click()
  await poll(read, r => assert.equal(r.code, was.code, 'undo takes back the edit, not the press'))
  assert.deepEqual(errors, [])
})

// One idiom for a toggle, Before's: the loop on, a quiet lit ground behind it, its ink bright, as Before pressed has; off,
// none, its icon at full strength (not dimmed); no accent for either. The time value: a hand pointed at, the scrub's
// arrows while it is held
test('editor: embedded, the loop a toggle as Before is: on, its ground lit; off, none; the time value a hand, the arrows while held', async () => {
  const { f } = await mount('chain', { controls: `${CONTROLS} loop before` })
  await length(f, '0:08.000')
  const loop = f.locator('.status .loop')
  const look = el => el.evaluate(b => { const s = getComputedStyle(b); return { pressed: b.getAttribute('aria-pressed'), ground: s.backgroundColor, ink: s.color, strength: +getComputedStyle(b.querySelector('svg')).opacity } })
  const accent = await f.locator('body').evaluate(() => { const p = document.createElement('i'); p.style.color = 'var(--color-screen-accent)'; document.body.append(p); const c = getComputedStyle(p).color; p.remove(); return c })
  await page.mouse.move(2, 2)
  if (await loop.getAttribute('aria-pressed') === 'false') await loop.click()
  await page.mouse.move(2, 2)
  const on = await look(loop)
  await loop.click()
  await page.mouse.move(2, 2)
  const off = await look(loop)
  // Before pressed, as the loop on
  await make(f, 'reverse')
  await poll(() => f.locator('.head-end .before').getAttribute('aria-disabled'), d => assert.equal(d, null))
  await f.locator('.head-end .before').click()
  await page.mouse.move(2, 2)
  const before = await look(f.locator('.head-end .before'))
  assert.deepEqual([on.pressed, on.ground, on.strength], ['true', before.ground, 1], `on: Before's lit ground, ${on.ground}`)
  assert.equal(on.ink, before.ink, 'on: Before\'s bright ink')
  assert.deepEqual([off.pressed, off.ground, off.strength], ['false', 'rgba(0, 0, 0, 0)', 1], 'off: no ground, not dimmed')
  assert.ok(on.ground !== 'rgba(0, 0, 0, 0)' && on.ink !== accent && off.ink !== accent, 'no accent')
  const time = f.locator('.clock .time'), cursor = () => time.evaluate(t => getComputedStyle(t).cursor)
  const b = await time.boundingBox()
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2)
  assert.equal(await cursor(), 'pointer', 'pointed at: a hand')
  await page.mouse.down()
  assert.equal(await cursor(), 'ew-resize', 'held: the scrub\'s arrows')
  await page.mouse.up()
  assert.equal(await cursor(), 'pointer', 'let go: a hand again')
  assert.deepEqual(errors, [])
})

// The page opens a sample in the sound's place by the element's open(): a synthesized one by its name (the catalogue,
// /samples/index.json, is the site's: none here), as the sound's menu opens it, one step of the history; a promise of
// what is open once its sound is in, as sound() says it; one there is none of, an error, nothing changed
test('editor: embedded, the page opens a sample by the element\'s open(), and reads what is open by sound()', async () => {
  const { f } = await mount('chain')
  await length(f, '0:08.000')
  const el = fn => page.evaluate(fn)
  assert.deepEqual(await el(() => document.querySelector('audio-repl').sound()), { name: 'chime.wav', kind: 'chime', file: null, title: null, about: null })
  const got = await el(() => document.querySelector('audio-repl').open('birdsong.wav'))
  assert.deepEqual([got.name, got.kind], ['birdsong.wav', 'birdsong'], 'once its sound is in, what is open')
  await f.locator('.embed-sound-name', { hasText: 'birdsong.wav' }).waitFor()
  assert.equal((await el(() => document.querySelector('audio-repl').sound())).name, 'birdsong.wav')
  const none = await el(() => document.querySelector('audio-repl').open('nothing.wav'))
  assert.match(none.error, /^No sample nothing\.wav/)
  assert.equal((await el(() => document.querySelector('audio-repl').sound())).name, 'birdsong.wav', 'nothing changed')
  await f.locator('.head-end .undo').click()
  await f.locator('.embed-sound-name', { hasText: 'chime.wav' }).waitFor()
  assert.deepEqual(errors, [])
})

// Code (controls code), before the way on to the editor: pressed, the code for the sound as it stands in a popover
// under it, in the script editor itself, the code pane's (one CodeMirror on the page, taken in as it opens and back in
// the pane as it shuts): its words painted, long lines wrapped, written in as the pane is, the sound following; Escape or
// a press outside shuts it
test('editor: embedded, Code shows the sound\'s code in the script editor itself, Escape or a press outside shutting it', async () => {
  const { f } = await mount('chain', { controls: `${CONTROLS} code link` })
  await length(f, '0:08.000')
  await make(f, 'reverse')
  await poll(() => made(f), ks => assert.deepEqual(ks, ['Reverse']))
  const view = f.locator('#code-view'), open = () => view.evaluate(p => p.matches(':popover-open'))
  const order = await f.locator('.view-head').evaluate(h => [...h.querySelectorAll('.embed-code, .embed-open')].map(e => e.classList.contains('embed-code') ? 'embed-code' : 'embed-open'))
  assert.deepEqual(order, ['embed-code', 'embed-open'], 'before the way on to the editor')
  await f.locator('.embed-code').click()
  await poll(open, o => assert.equal(o, true))
  const lines = () => view.evaluate(v => [...v.querySelectorAll('.cm-line')].map(l => l.textContent).join('\n'))
  await poll(lines, t => assert.equal(t, "audio('chime.wav')\n  .reverse()", 'the code as it stands'))
  assert.deepEqual(await f.locator('body').evaluate(() => [document.querySelectorAll('.cm-editor').length, !!document.querySelector('#code-view > .script-editor > .cm-editor'), !document.querySelector('.script > .script-editor')]), [1, true, true], 'the script editor itself, out of its pane while open: one on the page')
  assert.deepEqual(await f.locator('.embed-code').evaluate(b => [b.textContent.trim(), b.getAttribute('aria-label'), b.title || b.dataset.popoffTitle]), ['', 'Code', 'The code for this sound'], 'an icon alone, named')
  assert.ok(await view.locator('.cm-content [class^="syntax-"]').count() > 3, 'its words painted as the script editor paints them')
  assert.deepEqual(await view.locator('.cm-content').evaluate(p => [p.classList.contains('cm-lineWrapping'), getComputedStyle(p).whiteSpace]), [true, 'break-spaces'], 'long lines wrap')
  // written in, the script: the sound follows, the chain with it
  await view.locator('.cm-line').last().click()
  await page.keyboard.press('End')
  await page.keyboard.type('.normalize(-1)')
  await poll(() => made(f), ks => assert.deepEqual(ks, ['Reverse', 'Normalize −1dB'], 'typed in, the chain follows'), 8000)
  // (Escape the editor's first where it takes it: its completions, typing having asked for them, shut, as in the pane)
  await page.mouse.move(2, 2)
  await page.keyboard.press('Escape')
  if (await open()) await page.keyboard.press('Escape')
  await poll(open, o => assert.equal(o, false, 'Escape shuts it'))
  assert.equal(await f.locator('body').evaluate(() => !!document.querySelector('.script > .script-editor > .cm-editor')), true, 'back in its pane')
  await f.locator('.embed-code').click()
  await poll(open, o => assert.equal(o, true))
  await page.mouse.click(5, 300)
  await poll(open, o => assert.equal(o, false, 'a press outside shuts it'))
  assert.deepEqual(errors, [])
})

// Before pointed at, there being edits, the sound before them a ghost over the picture: its waveform's outline in the
// guides' ink, on a canvas of its own that takes no press; asked of the engine only the first time it is pointed at for
// that script (nothing baked till then) and kept for it; gone as the pointer leaves; none once pressed (the picture is
// the sound before then)
both('Before pointed at: the sound before the edits a ghost over the picture, asked only then, gone as the pointer leaves', async full => {
  const { f } = await mount('chain', { full, script: "audio('chime.wav').gain(-12)", controls: `${CONTROLS} before` })
  await length(f, '0:08.000')
  const baked = () => f.locator('body').evaluate(() => globalThis.__baked)
  await f.locator('body').evaluate(async () => { const { eng } = await import('/repl/editor/context.js'), bake = eng.bake; globalThis.__baked = 0; eng.bake = s => (globalThis.__baked++, bake(s)) })
  const before = f.locator('.head-end .before')
  await poll(() => before.getAttribute('aria-disabled'), d => assert.equal(d, null))
  await page.waitForTimeout(300)
  assert.equal(await baked(), 0, 'nothing asked till it is pointed at')
  const ghost = () => f.locator('.before-ghost').evaluate(c => { if (c.hidden) return null; const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i]) n++; return { n, area: c.width * c.height, press: getComputedStyle(c).pointerEvents } })
  await before.hover()
  // (an outline: a line over and under, a few pixels of the canvas, where the waveform it bounds fills many)
  await poll(ghost, g => assert.ok(g && g.n > 1000 && g.n < g.area * .05 && g.press === 'none', `drawn, an outline, nothing filled, taking no press: ${JSON.stringify(g)}`))
  assert.equal(await baked(), 1, 'asked once')
  await f.locator('.plot').hover()
  await poll(ghost, g => assert.equal(g, null, 'gone as the pointer leaves'))
  await before.hover()
  await poll(ghost, g => assert.ok(g, 'again'))
  assert.equal(await baked(), 1, 'kept for that script')
  await before.click()
  await poll(ghost, g => assert.equal(g, null, 'pressed: none'))
  assert.deepEqual(errors, [])
})

// How far the engine's work has come. Embedded, the frame draws no strip: it tells the page, a `progress` event on the
// element, { p } 0 to 1 (or null while busy with no figure) as it changes, then { done: true }. A page of its own, the
// strip along its top: a tick each 6 px, on while it works, filled as far as it has come or the busy wave, gone once done
test('editor: embedded, the work\'s progress told to the page as `progress` events, then done; no strip in the frame', async () => {
  const { f } = await mount('chain', { script: "audio('chime.wav').repeat(16)" })
  await length(f, '2:16.000')
  await f.locator('body').evaluate(() => __settled())
  await page.evaluate(() => { globalThis.__told = []; document.querySelector('audio-repl').addEventListener('progress', e => __told.push(e.detail)) })
  await f.locator('body').evaluate(async () => { const { ed } = await import('/repl/editor/context.js'); ed.change({ from: ed.code.length, insert: ".stretch(1.5, { method: 'paulstretch' })" }) })
  const told = await poll(() => page.evaluate(() => __told), t => assert.ok(t.length > 1 && t.at(-1).done, `told, then done: ${JSON.stringify(t)}`), 30000)
  const steps = told.slice(0, -1)
  assert.ok(steps.every(d => Object.keys(d).join() === 'p' && (d.p === null || d.p >= 0 && d.p < 1)), `each { p }, 0 to 1 or null: ${JSON.stringify(steps)}`)
  assert.ok(steps.every((d, i) => !i || d.p !== steps[i - 1].p), 'each as it changes, none twice')
  assert.deepEqual(told.at(-1), { done: true })
  assert.equal(await f.locator('.progress').evaluate(b => getComputedStyle(b).display), 'none', 'no strip in the frame: the page draws its own')
  assert.deepEqual(errors, [])
})
test('editor: a page of its own, the work\'s progress a strip of ticks along its top, gone once done', async () => {
  const { f } = await mount('chain', { full: true, script: "audio('chime.wav').repeat(16)" })
  await length(f, '2:16.000')
  await page.evaluate(() => __settled())
  const strip = () => page.evaluate(() => { const b = document.querySelector('.progress'), r = b.getBoundingClientRect(); return { on: b.hasAttribute('data-on'), busy: b.hasAttribute('data-busy'), now: b.getAttribute('aria-valuenow'), cells: b.children.length, fit: Math.floor(innerWidth / 6), top: r.top, wide: r.width === innerWidth, role: b.getAttribute('role') } })
  await page.evaluate(async () => { const { ed } = await import('/repl/editor/context.js'); ed.change({ from: ed.code.length, insert: ".stretch(1.5, { method: 'paulstretch' })" }) })
  const on = await poll(strip, s => assert.ok(s.on, 'on while it works'), 15000)
  assert.deepEqual([on.top, on.wide, on.cells, on.role], [0, true, on.fit, 'progressbar'], `along the very top, the page's width, a tick each 6 px: ${JSON.stringify(on)}`)
  const seen = await poll(strip, s => assert.ok(s.busy || +s.now > 0, `the busy wave or a figure: ${JSON.stringify(s)}`), 15000)
  assert.ok(seen.on)
  await poll(strip, s => assert.equal(s.on, false, 'gone once done'), 30000)
  assert.deepEqual(errors, [])
})

// The code view a card's width (560 px at most), as tall as its lines (420 px at most, then scrolled down); its long
// lines wrapped, nothing scrolled sideways, a wrapped line's rest 4 ch in from where the line starts, so the calls still
// read down the left as a chain
test('editor: embedded, the code view a card\'s width, its long lines wrapped, their rest indented', async () => {
  const credit = `// ${'a credit line long enough to wrap in a card '.repeat(3).trim()}`
  const { f } = await mount('chain', { controls: `${CONTROLS} code link`, script: `${credit}\naudio('chime.wav')` })
  await length(f, '0:08.000')
  await f.locator('.embed-code').click()
  const view = f.locator('#code-view')
  await poll(() => view.locator('.cm-line').count(), n => assert.equal(n, 2))
  const laid = await view.evaluate(v => {
    const r = v.getBoundingClientRect(), line = v.querySelector('.cm-line'), range = document.createRange(), scroller = v.querySelector('.cm-scroller')
    range.selectNodeContents(line)
    const rows = [...range.getClientRects()].reduce((m, x) => (m[Math.round(x.top)] = Math.min(m[Math.round(x.top)] ?? Infinity, x.left), m), {})
    const lefts = Object.keys(rows).sort((a, b) => a - b).map(t => rows[t]), ch = parseFloat(getComputedStyle(line).fontSize) * .6
    return { width: r.width, height: r.height, most: getComputedStyle(v).maxHeight, room: Math.min(420, innerHeight - 64), rows: lefts.length, indent: lefts[1] - lefts[0], ch, sideways: scroller.scrollWidth > scroller.clientWidth + 1 }
  })
  assert.ok(laid.width <= 560 && laid.width >= 400, `a card's width: ${laid.width}`)
  assert.ok(laid.height < 260 && laid.most === `${laid.room}px`, `as tall as its lines, 420 px at most (the frame's height less 64 px, where less): ${laid.height}, ${laid.most}`)
  assert.ok(laid.rows >= 2 && !laid.sideways, `the credit wrapped, nothing sideways: ${JSON.stringify(laid)}`)
  assert.ok(Math.abs(laid.indent - 4 * laid.ch) < laid.ch, `its rest 4 ch in: ${laid.indent} px for ${laid.ch} px a ch`)
  assert.deepEqual(errors, [])
})

// Denoise, a noise learned where it plays alone, is in the list: found by its name and by the noise it takes out (a word
// that undoes something, "denoise", by what it undoes too: every edit that takes noise out, Deepfilter and RNNoise
// among them, which say so), and first of the Repair kind's; with nothing selected its row says to select the noise
// first, and a press makes nothing; with a selection, it learns there, one step
both('denoise is found by its name and by the noise it takes out; it learns from the selection', async full => {
  const { f } = await mount('chain', { full })
  await length(f, '0:08.000')
  const rows = () => f.locator('#edits-found .found-row').evaluateAll(rs => rs.map(r => `${r.querySelector('.found-name').textContent} ${r.querySelector('.found-hint').textContent}`.trim()))
  const row = name => f.locator('#edits-found .found-row', { has: f.locator('.found-name', { hasText: new RegExp(`^${name}$`) }) }).first()
  await f.locator('.chain-add').click()
  await f.locator('.found-search').fill('denoise')
  await poll(rows, rs => { assert.equal(rs[0], 'Denoise select where the noise plays alone first', `first, saying what it needs: ${rs}`); for (const n of ['OMLSA', 'Deepfilter', 'RNNoise', 'Wiener', 'Specsub']) assert.ok(rs.some(r => r.startsWith(n)), `${n} among them: ${rs}`) })
  await f.locator('.found-search').fill('noise')
  await poll(rows, rs => assert.ok(['Denoise', 'Deepfilter', 'RNNoise', 'OMLSA'].every(n => rs.some(r => r.startsWith(n))), `${rs}`))
  await f.locator('.found-search').fill('')
  await row('Repair').click()
  await poll(() => listed(f), gs => assert.ok(gs.some(g => g[0] === 'Denoise' && g.includes('OMLSA')), `first of the Repair kind's: ${JSON.stringify(gs)}`))
  const was = await script(f)
  await row('Denoise').click()
  await page.waitForTimeout(300)
  assert.equal(await script(f), was, 'nothing selected: nothing made')
  await f.locator('body').evaluate(async () => (await import('/repl/editor/context.js')).v.select(1, 1.5))
  await f.locator('.chain-add').click()
  await f.locator('.found-search').fill('denoise')
  await poll(rows, rs => assert.equal(rs[0], 'Denoise from the selection'))
  await page.keyboard.press('Enter')
  await poll(() => script(f), c => assert.match(c, /\.denoise\(\{ noise: \{ at: 1, d: 0\.5 \} \}\)$/, 'learned from the selection'))
  await poll(() => made(f), ks => assert.equal(ks.at(-1), 'Denoise'))
  assert.deepEqual(errors, [])
})

// A fragment selected, the list's Suggested is what one does to a fragment, For the selection, in place of what suits
// the whole sound: crossfaded across, deleted, silenced, cropped to, faded in, faded out, reversed, each at the length it
// would be made over; lit, each draws over it what it would do (where it goes or goes silent, a fade's ramp); pressed,
// made over it, one step. A pause in a voice selected: its noise taken out everywhere, the pause shortened as a voice's
// are. The recipes' section after it, then the kinds. Nothing selected, as it was
both('a fragment selected: Suggested is what one does to it, each drawn over it and made over it as one step', async full => {
  const { f } = await mount('chain', { full, script: "audio('chime.wav').pad(0, 2)", kind: 'speech' })
  await length(f, '0:10.000')
  const select = (a, b) => f.locator('body').evaluate(async (_, [a, b]) => (await import('/repl/editor/context.js')).v.select(a, b), [a, b])
  const first = () => f.locator('#edits-found .found-group').first().evaluate(g => [g.getAttribute('aria-label'), [...g.querySelectorAll('.found-row')].map(r => `${r.querySelector('.found-name').textContent} ${r.querySelector('.found-hint').textContent}`.trim())])
  const guides = () => f.locator('body').evaluate(async () => (await import('/repl/editor/context.js')).v.guides.map(g => g.cut ? `cut ${g.cut.map(t => +t.toFixed(3))}` : g.ramps ? `ramp ${g.ramps[0].slice(0, 3).map(t => typeof t === 'number' ? +t.toFixed(3) : t)}` : ''))
  await select(2, 3)
  await f.locator('.chain-add').click()
  await poll(first, ([g, rs]) => assert.deepEqual([g, rs], ['For the selection', ['Crossfade across it 1s', 'Delete 1s', 'Silence it −∞dB', 'Crop to it 1s', 'Fade in 1s', 'Fade out 1s', 'Reverse 1s']]))
  assert.deepEqual(await f.locator('#edits-found .found-head').allTextContents(), ['For the selection', 'Recipes'], 'its small head says what it is for, the recipes\' section after it')
  assert.deepEqual((await f.locator('#edits-found .found-group').evaluateAll(gs => gs.map(g => g.getAttribute('aria-label')))).slice(0, 3), ['For the selection', 'Recipes', 'Kinds'], 'then the recipes, then the kinds')
  await page.keyboard.press('ArrowDown')
  await poll(guides, gs => assert.ok(gs.includes('cut 2,3'), `Delete lit: where it goes, ${gs}`))
  for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowDown')
  await poll(guides, gs => assert.ok(gs.includes('ramp 2,3,out'), `Fade out lit: its ramp, ${gs}`))
  const was = await script(f)
  await f.locator('#edits-found .found-row', { hasText: /^Silence it/ }).click()
  await poll(() => script(f), c => assert.match(c, /\.gain\(-Infinity, \{ at: 2, d: 1 \}\)$/, 'silenced over it'))
  await f.locator('.head-end .undo').click()
  await poll(() => script(f), c => assert.equal(c, was, 'one step'))
  await f.locator('.chain-add').click()
  await f.locator('#edits-found .found-row', { hasText: /^Fade out/ }).click()
  await poll(() => script(f), c => assert.match(c, /\.fade\(-1, \{ at: 2 \}\)$/, 'faded out over it'))
  // a pause of the voice selected (the silence padded after it): what its kind reads there too
  await select(8.6, 9.6)
  await f.locator('.chain-add').click()
  await poll(first, ([, rs]) => assert.deepEqual(rs.slice(-2), ['Take this noise out everywhere learned here', 'Shorten the pause 0.3s']))
  await page.keyboard.press('Escape')
  // nothing selected: as it was
  await select(0, 0)
  await f.locator('.chain-add').click()
  await poll(first, ([g]) => assert.equal(g, 'Suggested'))
  assert.deepEqual(errors, [])
})

// The editor as a page of its own lays the edits as the chain where View › Edit chain is checked, as a link's ?ui= edits
// chain does: the tabs and the row's right end (Before, the history) on one line, the chain under them, Before gone from
// the bar into that row; kept for the next visit; unchecked, as it was. Its edits are the script's (the chime's three)
test('editor: View › Edit chain lays the edits as the chain on a page of its own, kept for the next visit; unchecked, as it was', async () => {
  await page.goto(origin + '/repl/')
  await page.locator('.readout[data-of="all"]').waitFor({ state: 'attached' })
  const parts = () => page.evaluate(() => ({ chain: !!document.querySelector('.view-head > .embed-chain'), end: !!document.querySelector('.view-head > .head-end'), bar: !!document.querySelector('.status .before'), save: !!document.querySelector('.head-end .embed-save') }))
  const view = async () => { await page.locator('.menubar-item', { hasText: /^View$/ }).click(); return page.locator('.menubar-list .menu-row', { has: page.locator('.menu-label', { hasText: /^Edit chain$/ }) }) }
  assert.deepEqual(await parts(), { chain: false, end: false, bar: true, save: false }, 'as it was: no chain, Before in the bar')
  let row = await view()
  assert.equal(await row.getAttribute('aria-checked'), 'false')
  await row.click()
  await poll(parts, p => assert.deepEqual(p, { chain: true, end: true, bar: false, save: false }, 'the chain over the picture, Before at its right end, no save there: the bar\'s Export is the page\'s'))
  await poll(() => made(page), ks => assert.equal(ks.length, 3, `the script's edits: ${ks}`))
  const lay = await page.evaluate(() => { const r = s => document.querySelector(s).getBoundingClientRect(); return { tabs: r('.files'), end: r('.head-end'), chain: r('.embed-chain') } })
  assert.ok(lay.chain.top >= lay.tabs.bottom - 1 && lay.end.left >= lay.tabs.right - 1 && lay.end.bottom <= lay.chain.top + 1, `the tabs and the row's end on one line, the chain under them: ${JSON.stringify(lay)}`)
  await page.locator('.chain-step > .chain-edit').first().click()
  await poll(() => page.locator('#step-settings').evaluate(p => p.matches(':popover-open')), o => assert.equal(o, true, 'an edit pressed: its settings'))
  await page.keyboard.press('Escape')
  await page.reload()
  await page.locator('.readout[data-of="all"]').waitFor({ state: 'attached' })
  await poll(parts, p => assert.equal(p.chain, true, 'kept for the next visit'))
  row = await view()
  assert.equal(await row.getAttribute('aria-checked'), 'true')
  await row.click()
  await poll(parts, p => assert.deepEqual(p, { chain: false, end: false, bar: true, save: false }, 'unchecked: as it was'))
  assert.deepEqual(errors, [])
})
