// The recordings the sound menus list by category (repl/library.js), from a small catalogue of the test's own and files
// made here, nothing fetched past the test's server: the catalogue read and laid by category, in Node; in a page,
// asked for only once a list of the samples first opens, listed by category with the synthesized samples in a place of
// their own, one opened saying its catalogue's word and line; the synthesized alone where the catalogue cannot be had
// or the page turns it off; one the page points elsewhere read from there
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { read, shelves, titled, credit } from '../../repl/library.js'
import { page, origin, errors, poll, sine, wavBytes, menu, open } from './page.js'

const CATALOGUE = [
  { file: 'speech/talk.wav', name: 'A talk', category: 'speech', kind: 'speech', about: 'A voice reading\nA reader, public domain', by: 'A reader', license: 'Public domain', page: 'https://example.org/talk' },
  { file: 'music/classical/piece.wav', name: 'A piece', category: 'music', group: 'classical', kind: 'music', about: 'A piece on piano\nA pianist, CC0', by: 'A pianist', license: 'CC0', page: 'https://example.org/piece' },
  { file: 'music/8-bit/loop.wav', name: 'A loop', category: 'music', group: '8-bit', kind: 'music', about: 'A loop\nA tracker, CC0, an excerpt', by: 'A tracker', license: 'CC0', page: 'https://example.org/loop' },
  { file: 'animals/frog.wav', name: 'A frog', category: 'animals', kind: 'frogs', about: 'A frog at night\nA recordist, CC BY 4.0', by: 'A recordist', license: 'CC BY 4.0', page: 'https://example.org/frog' }
]
const SYNTHESIZED = ['chime.wav', 'handpan.wav', 'birdsong.wav', 'rhodes.wav', 'monitor.wav']

test('library: a catalogue read, each recording by its address from the site\'s root, laid by category and group in its order', () => {
  const from = 'https://site.test/samples/index.json', here = read(CATALOGUE, from, 'https://site.test')
  assert.deepEqual(here.map(r => [r.address, r.label]), [['/samples/speech/talk.wav', 'talk.wav'], ['/samples/music/classical/piece.wav', 'piece.wav'], ['/samples/music/8-bit/loop.wav', 'loop.wav'], ['/samples/animals/frog.wav', 'frog.wav']])
  assert.equal(read(CATALOGUE, from, 'https://elsewhere.test')[0].address, 'https://site.test/samples/speech/talk.wav', 'another site\'s, by its whole address')
  assert.deepEqual(shelves(here).map(s => [s.category, s.groups.map(g => [g.group, g.recordings.map(r => r.name)])]), [
    ['speech', [['', ['A talk']]]],
    ['music', [['classical', ['A piece']], ['8-bit', ['A loop']]]],
    ['animals', [['', ['A frog']]]]
  ])
  assert.deepEqual(['speech', 'music', '8-bit'].map(titled), ['Speech', 'Music', '8-bit'])
  assert.equal(credit(here[3]), '// "A frog" by A recordist, CC BY 4.0, example.org/frog')
  // what does not say what it is and where, or is not a sound's address, is left out; a name a second time too
  const odd = [{ name: 'No file', category: 'speech' }, { file: 'a.wav', category: 'speech' }, { file: 'b.wav', name: 'No category' }, { file: 'javascript:alert(1)', name: 'Script', category: 'speech' }, { file: 'other/talk.wav', name: 'Same name', category: 'speech' }, null, 7]
  assert.deepEqual(read([...CATALOGUE, ...odd], from, 'https://site.test').map(r => r.name), CATALOGUE.map(r => r.name))
  assert.deepEqual(read({ sounds: CATALOGUE }, from, 'https://site.test'), [], 'no list, none')
})

// The catalogue at `at` (the site's own by default) and its files, each a tone made here; `status` other than 200 for a
// catalogue that cannot be had. What was asked of it, counted
async function serve({ at = '/samples/index.json', status = 200 } = {}) {
  const asked = [], tone = await wavBytes([sine(2, 440, .5)]), files = new Set(CATALOGUE.map(r => new URL(r.file, new URL(at, origin)).pathname))
  await page.route(url => url.pathname === at, route => { asked.push(at); route.fulfill(status === 200 ? { contentType: 'application/json', body: JSON.stringify(CATALOGUE) } : { status }) })
  await page.route(url => files.has(url.pathname), route => route.fulfill({ contentType: 'audio/wav', body: tone }))
  return asked
}
// An <audio-repl> with its sound's menu and the chain, which says a sound's word by the level; `ui`, more of the page's
async function mount(ui = {}) {
  await page.goto(origin + '/blank.html')
  await page.evaluate(async ui => {
    await import('/repl/embed.js')
    document.body.innerHTML = `<audio-repl panel="none" height="420" controls="sound play clock loudness" ui='${JSON.stringify({ edits: 'chain', kind: 'chime', ...ui })}'><pre><code>audio('chime.wav')</code></pre></audio-repl>`
  }, ui)
  const f = page.frameLocator('audio-repl iframe')
  await f.locator('.clock .length', { hasText: '0:08.000' }).waitFor({ state: 'attached' })
  return f
}
// the menu open's own rows, each its words (a submenu's not among them); a submenu's, by the row that opens it
const rowsOf = (f, of = null) => f.locator('.menubar-menu').evaluate((menu, of) => {
  const list = of ? [...menu.querySelectorAll('.menu-row')].find(r => r.querySelector('.menu-label').textContent === of).nextElementSibling : menu
  return [...list.children].flatMap(e => e.matches('.menu-group') ? [`(${e.textContent})`] : e.matches('.menu-row') ? [e.querySelector('.menu-label').textContent] : [])
}, of)
const script = f => f.locator('body').evaluate(async () => (await import('/repl/editor/context.js')).ed.code)

test('library: embedded, the sound\'s menu lists the recordings by category once it first opens, the synthesized in a place of their own; one opened says its word and its line', async () => {
  const asked = await serve(), f = await mount()
  assert.deepEqual(asked, [], 'nothing asked as the editor loads')
  await f.locator('.embed-sound').click()
  await poll(() => rowsOf(f), rows => assert.deepEqual(rows, ['File…', 'Record', 'New', 'Find a sound…', 'Generate', '(Samples)', 'Speech', 'Music', 'Animals', 'Synthesized']))
  assert.deepEqual(asked, ['/samples/index.json'])
  assert.deepEqual(await rowsOf(f, 'Music'), ['(Classical)', 'A piece', '(8-bit)', 'A loop'], 'music under its groups\' heads')
  assert.deepEqual(await rowsOf(f, 'Synthesized'), SYNTHESIZED, 'the synthesized as they were')
  // a recording: its name, its maker at the row's end, its line its tooltip
  await f.locator('.menubar-menu .menu-row', { hasText: 'Animals' }).hover()
  const frog = f.locator('.menubar-menu .menu-row', { hasText: 'A frog' })
  assert.deepEqual([await frog.locator('.menu-keys').textContent(), await frog.getAttribute('title')], ['A recordist', 'A frog at night\nA recordist, CC BY 4.0'])
  await frog.click()
  // opened in the page's sound's place: by its address, its credit over it; named by its file, its word the catalogue's,
  // its tooltip its line, no listener asked
  await f.locator('.embed-sound-name', { hasText: 'frog.wav' }).waitFor()
  assert.equal(await script(f), `// "A frog" by A recordist, CC BY 4.0, example.org/frog\naudio('/samples/animals/frog.wav')`)
  await poll(() => f.locator('.bar-kind').allTextContents(), words => assert.deepEqual(words, ['frogs']))
  assert.equal(await f.locator('.bar-kind').getAttribute('title'), 'A frog at night\nA recordist, CC BY 4.0')
  assert.deepEqual(await f.locator('body').evaluate(async () => (await import('/repl/editor/context.js')).state.heardKinds), {})
  // the menu again: the catalogue not asked for again, the recording open checked
  await f.locator('.embed-sound').click()
  await poll(() => rowsOf(f), rows => assert.ok(rows.includes('Animals'), rows.join(', ')))
  assert.equal(await f.locator('.menubar-menu .menu-row', { hasText: 'A frog' }).getAttribute('aria-checked'), 'true')
  assert.deepEqual(asked, ['/samples/index.json'])
  assert.deepEqual(errors, [])
})

test('library: embedded, no catalogue to be had or none asked for, the synthesized alone as ever; one pointed elsewhere read from there', async () => {
  const flat = ['File…', 'Record', 'New', 'Find a sound…', 'Generate', '(Samples)', ...SYNTHESIZED]
  // not there: the menu as it was, nothing said of it
  let asked = await serve({ status: 404 }), f = await mount()
  await f.locator('.embed-sound').click()
  await poll(() => asked.length, n => assert.equal(n, 1))
  await f.locator('body').evaluate(() => new Promise(r => setTimeout(r, 200)))
  assert.deepEqual(await rowsOf(f), flat)
  // (the browser's own line on the 404, not the page's)
  errors.splice(0, errors.length, ...errors.filter(e => !/status of 404/.test(e)))
  await f.locator('.menubar-menu .menu-row', { hasText: 'handpan.wav' }).click()
  await f.locator('.embed-sound-name', { hasText: 'handpan.wav' }).waitFor()
  // turned off: never asked for
  await page.unrouteAll()
  asked = await serve()
  f = await mount({ samples: false })
  await f.locator('.embed-sound').click()
  await f.locator('body').evaluate(() => new Promise(r => setTimeout(r, 200)))
  assert.deepEqual([await rowsOf(f), asked], [flat, []])
  // pointed at another list: asked there, its files by their addresses from it
  await page.unrouteAll()
  asked = await serve({ at: '/other/list.json' })
  f = await mount({ samples: '/other/list.json' })
  await f.locator('.embed-sound').click()
  await poll(() => rowsOf(f), rows => assert.ok(rows.includes('Speech'), rows.join(', ')))
  assert.deepEqual(asked, ['/other/list.json'])
  await f.locator('.menubar-menu .menu-row', { hasText: 'Speech' }).hover()
  await f.locator('.menubar-menu .menu-row', { hasText: 'A talk' }).click()
  await f.locator('.embed-sound-name', { hasText: 'talk.wav' }).waitFor()
  assert.equal(await script(f), `// "A talk" by A reader, Public domain, example.org/talk\naudio('/other/speech/talk.wav')`)
  assert.deepEqual(errors, [])
})

test('library: the page of its own lists them under File › Sample or generate, asked for as that submenu first opens', async () => {
  const asked = await serve()
  await open()
  await page.locator('.menubar-item', { hasText: /^File$/ }).click()
  assert.deepEqual(asked, [], 'not as the editor loads, nor as File opens')
  await page.keyboard.press('Escape')
  await menu('File', 'Sample or generate', 'Speech', 'A talk')
  assert.deepEqual(asked, ['/samples/index.json'])
  // in a tab of its own, named by its file, its word after its name
  await page.locator('.source', { hasText: 'talk.wav' }).waitFor()
  await poll(() => page.locator('.head-kind').allTextContents(), words => assert.ok(words.includes('speech'), words.join(', ')))
  // the synthesized in a place of their own there too
  await menu('File', 'Sample or generate', 'Synthesized', 'handpan.wav')
  await page.locator('.source', { hasText: 'handpan.wav' }).waitFor()
  assert.deepEqual(asked, ['/samples/index.json'])
  assert.deepEqual(errors, [])
})
