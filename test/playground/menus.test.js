// The menus, the context menu, the palette, the tooltips and the keys; the Mac's menu bar; the server, the page and the
// helpers in page.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { page, origin, tipOf, wholeLevels, open, menuRow, tab, edits, noCues, write, tall, axis, drag, lengthIs } from './page.js'

// A control pointed at says what it is on a tag pointing at it, after a moment, the next at once; the browser's own
// tooltip never, the title back once the pointer leaves
test('editor: a control pointed at says what it is and does, on a tag pointing at it', async () => {
  await open()
  const play = page.locator('button.play'), tip = page.locator('.popoff-tip')
  await play.hover()
  await tip.waitFor()
  assert.equal(await tip.locator('.popoff-tip-name').innerText(), 'Play')
  assert.equal(await tip.locator('.popoff-tip-keys').innerText(), 'Space')
  assert.equal(await tip.locator('.popoff-tip-body').innerText(), 'Hold and drag to rewind or skip')
  assert.equal(await tip.getAttribute('data-side'), 'top', 'over the bar at the window\'s foot')
  const [p, t] = await Promise.all([play.boundingBox(), tip.boundingBox()])
  assert.ok(Math.abs(t.x + parseFloat(await tip.evaluate(el => el.style.getPropertyValue('--popoff-arrow'))) - (p.x + p.width / 2)) < 1, 'its tip at the button\'s middle')
  assert.equal(await play.getAttribute('title'), null, 'no browser tooltip meanwhile')
  // across to the next: after the same moment, none on the way
  await page.locator('button.loop').hover()
  await tip.waitFor({ state: 'hidden' })
  // a moment, short of popoff's 500 ms
  await page.waitForTimeout(250)
  assert.ok(!await tip.isVisible(), 'not at once')
  await page.waitForFunction(() => document.querySelector('.popoff-tip:popover-open .popoff-tip-name')?.textContent === 'Loop')
  assert.equal(await tip.locator('.popoff-tip-keys').innerText(), 'L')
  // a control whose popover is open has none
  const depth = page.locator('.facts .fact', { hasText: '-bit' })
  await depth.click()
  await page.locator('#depth-menu:popover-open').waitFor()
  // left and pointed at again, the press forgotten: still none while its menu is open
  await page.mouse.move(4, 4)
  await depth.hover({ position: { x: 3, y: 3 } })
  // past popoff's 500 ms: a tip that would show has
  await page.waitForTimeout(700)
  assert.ok(!await tip.isVisible(), 'none over its open menu\'s control')
  await page.keyboard.press('Escape')
  await page.mouse.move(4, 4)
  await tip.waitFor({ state: 'hidden' })
  assert.match(await play.getAttribute('title'), /^Play \(Space\)/)
  // a menu's row: beside the menu
  await page.locator('.menubar-item', { hasText: /^Select$/ }).click()
  await page.locator('.menubar-list .menu-row', { hasText: 'The next one like it' }).hover()
  await tip.waitFor()
  assert.equal(await tip.getAttribute('data-side'), 'right')
  assert.equal(await tip.innerText(), 'The next pause, or stretch between cues\n\nAlt and drag adds any other range')
  await page.keyboard.press('Escape')
})

// The palette (⌘K), a notch over the picture: the edits for what is selected, then every method by kind; the words
// typed find one, the arrows go through them, Enter adds it, on the selection, and the panel turns to the edits with
// its card open. One the library can't run without a value gets its default written. Escape closes it.
test('editor: an edit from the palette goes on the selection, its card open among the edits', async () => {
  await open()
  const { box, x } = await axis(6.525), y = box.y + tall(box) * .3
  await drag([x(1.01), y], [x(2.01) - x(1.01), 0])
  await page.keyboard.press('ControlOrMeta+K')
  const groups = await page.locator('.palette-group').allInnerTexts()
  assert.ok(groups[0] === 'For the selection' && groups.includes('Filter'), groups.join())
  assert.match(await page.locator('.tool-target').innerText(), /^For the selection, 0:01\.\d+–0:02\.\d+$/)
  await page.keyboard.press('Escape')
  await page.locator('#palette:popover-open').waitFor({ state: 'detached' })
  await page.keyboard.press('ControlOrMeta+K')
  await page.keyboard.type('cut lows')
  assert.deepEqual(await page.locator('.palette-list .tool strong').allInnerTexts(), ['Highpass'])
  await page.keyboard.press('Enter')
  await page.waitForFunction(() => /\.highpass\(80, \{ at: [\d.]+, d: [\d.]+ \}\)$/.test(scriptText()))
  assert.ok(await edits(), 'the edits open on it')
  assert.equal(await page.locator('.step.open .step-name').innerText(), 'Highpass')
  await page.locator('.plot').focus()
  await page.keyboard.press('Escape')
  await wholeLevels().waitFor()
  assert.equal(await page.locator('.message.problem').count(), 0)
})

// The menus by what they act on: the file, the selection, what is selected, the view, the tracks, the methods, what
// plays and records. Each row does something: no row that only says what to do elsewhere (a disabled sentence), the
// methods once (Process, not Edit too), the takes under Transport, as Record is
test('editor: the menus, each by what it acts on, every row an action', async () => {
  await open()
  assert.deepEqual(await page.locator('.menubar-item').allInnerTexts(), ['File', 'Edit', 'Select', 'View', 'Track', 'Process', 'Transport', 'Help'])
  const rows = async name => {
    await page.locator('.menubar-item', { hasText: new RegExp(`^${name}$`) }).click()
    const list = await page.locator('.menubar-list:popover-open > .menu-row').evaluateAll(r => r.map(x => ({ label: x.querySelector('.menu-label').textContent, sub: x.classList.contains('has-sub') })))
    await page.keyboard.press('Escape')
    return list
  }
  const all = {}
  for (const name of ['File', 'Edit', 'Select', 'View', 'Track', 'Process', 'Transport']) all[name] = await rows(name)
  const labels = Object.values(all).flat().map(r => r.label)
  assert.ok(labels.every(l => !/^(A click|Another range|Shift with)/.test(l)), 'no sentence for a row')
  assert.deepEqual(labels.filter((l, i) => labels.indexOf(l) !== i), [], 'each row once')
  assert.ok(all.Edit.length <= 12 && all.Select.length <= 7, `Edit ${all.Edit.length}, Select ${all.Select.length}`)
  assert.ok(all.Transport.some(r => r.label === 'Takes') && all.Transport.some(r => /^Record/.test(r.label)))
})

// A tooltip only where the control doesn't say it: every button of no words (an icon) has one, a button that names
// itself none needed; the levels say their next fact pointed at
test('editor: every button of no words says what it is when pointed at', async () => {
  await open()
  const untitled = await page.evaluate(() => [...document.querySelectorAll('button, output')]
    .filter(el => !el.textContent.trim() && !el.closest('[title], [data-tip], .cm-editor')).map(el => el.outerHTML.slice(0, 100)))
  assert.deepEqual(untitled, [])
  assert.equal(await page.locator('.readout').getAttribute('data-of'), 'all')
})

// Crop is clicked, never dragged, so it is no handle: the context menu has it, and K
test('editor: the context menu, or K, keeps only the selection', async () => {
  await open()
  await noCues()
  await write(`audio('chime.wav')`)
  await lengthIs('0:08.000')
  const { box, x } = await axis(8), y = box.y + tall(box) * .3
  await drag([x(2), y], [x(4) - x(2), 0])
  await page.mouse.click(x(3), y, { button: 'right' })
  await page.locator('.menubar-menu .menu-row', { has: page.locator('.menu-label', { hasText: /^Crop$/ }) }).click()
  await page.waitForFunction(() => /\.crop\(\{ at: 2(\.0\d*)?, d: 2(\.0\d*)? \}\)$/.test(scriptText().trim()))
  await lengthIs('0:02.000')
  await page.keyboard.press('ControlOrMeta+Z')
  await lengthIs('0:08.000')
  await page.mouse.click(x(7.5), y)
  await drag([x(5), y], [x(6) - x(5), 0])
  await page.keyboard.press('k')
  await page.waitForFunction(() => /\.crop\(\{ at: 5(\.0\d*)?, d: 1(\.0\d*)? \}\)$/.test(scriptText().trim()))
  await lengthIs('0:01.000')
})

// A click seen on the picture: selected, the context menu's Repair takes the clicks out there alone (declick over the
// range), or rebuilds all of it from around it (repair); the length kept. Every method is there by its kind
test('editor: the context menu takes the clicks out of the selection, or rebuilds it', async () => {
  await open()
  await noCues()
  await write(`audio('chime.wav')`)
  await lengthIs('0:08.000')
  const { box, x } = await axis(8), y = box.y + tall(box) * .3
  await drag([x(2), y], [x(4) - x(2), 0])
  await page.mouse.click(x(3), y, { button: 'right' })
  await menuRow('Process').click()
  await menuRow('Repair').click()
  await menuRow('Remove the clicks here').click()
  await page.waitForFunction(() => /\.declick\(\{ at: 2(\.0\d*)?, d: 2(\.0\d*)? \}\)$/.test(scriptText().trim()))
  await page.mouse.click(x(3), y, { button: 'right' })
  await menuRow('Process').click()
  await menuRow('Repair').click()
  await menuRow('Rebuild from around it').click()
  await page.waitForFunction(() => /\.repair\(\{ at: 2(\.0\d*)?, d: 2(\.0\d*)? \}\)$/.test(scriptText().trim()))
  await lengthIs('0:08.000')
  // any method, by its kind: a filter over the selection
  await page.mouse.click(x(3), y, { button: 'right' })
  await menuRow('Process').click()
  await menuRow('Filter').click()
  // what each does, said in its row (the menus' words once took the tooltip's place, all at the window's corner)
  const row = await menuRow('Highpass').boundingBox(), said = await menuRow('Highpass').locator('.menu-keys').boundingBox()
  assert.ok(said.y >= row.y && said.y + said.height <= row.y + row.height + 1 && said.x > row.x, 'its words in its row')
  assert.equal(await menuRow('Highpass').locator('.menu-keys').innerText(), 'Cut lows')
  await menuRow('Highpass').click()
  await page.waitForFunction(() => /\.highpass\(80, \{ at: 2(\.0\d*)?, d: 2(\.0\d*)? \}\)$/.test(scriptText().trim()))
})

// A right-click, as in a text: inside the selection, the edits for it, then every method under one Process, by its kind,
// one written for it offered again first there among the recent ones; what the picture has a handle for (the fades, the
// level), how it draws, what the menus have for the sound as a whole (Select all, the voice split) are not its. Elsewhere
// the caret goes there first, the selection gone, and the menu has what a caret takes
test('editor: a right-click gives the edits for the selection, or puts the caret there and gives the caret\'s', async () => {
  await open()
  await noCues()
  await write(`audio('chime.wav')`)
  await lengthIs('0:08.000')
  const { box, x } = await axis(8), y = box.y + tall(box) * .3
  const item = name => page.locator('.menubar-menu .menu-row', { has: page.locator('.menu-label', { hasText: new RegExp(`^${name}$`) }) })
  await drag([x(1), y], [x(3) - x(1), 0])
  await page.mouse.click(x(2), y, { button: 'right' })
  // its own: the edits of what is there, then Process, the methods by kind and the search for one, no more
  const own = () => page.locator('.menubar-menu > .menu-row .menu-label').allInnerTexts(), kinds = ['Edit', 'Level', 'Filter', 'Dynamics', 'Repair', 'Time & pitch', 'Effect', 'Color', 'Reverb', 'Space', 'Generate', 'Find an edit…']
  const processed = () => page.locator('.menubar-sub:popover-open > .menu-row .menu-label').allInnerTexts()
  assert.deepEqual(await own(), ['Cut', 'Copy', 'Paste', 'Delete', 'Crop', 'Mark it', 'Process'])
  await item('Process').click()
  assert.deepEqual(await processed(), kinds)
  // under its kind, Edit, the first of it
  await item('Edit').click()
  await item('Reverse').click()
  await page.waitForFunction(() => /\.reverse\(\{ at: 1, d: 2 \}\)$/.test(scriptText()))
  assert.equal(await page.locator('.menubar-menu').count(), 0)
  // an edit in place: no panel opens over the picture
  assert.equal(await page.locator('.side-slab').isVisible(), false, 'the edits stay closed')
  // offered again, at once, as it was worded; kept with the page
  await page.mouse.click(x(2), y, { button: 'right' })
  await item('Process').click()
  assert.equal(await page.locator('.menubar-sub:popover-open > .menu-group').innerText(), 'Recent')
  assert.deepEqual((await processed()).slice(0, 2), ['Reverse', 'Edit'])
  await page.locator('.menubar-sub:popover-open > .menu-row', { hasText: /^Reverse/ }).click()
  await page.waitForFunction(() => (scriptText().match(/\.reverse\(\{ at: 1, d: 2 \}\)/g) || []).length === 2)
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('audio-repl') || '{}').recent?.[0] === 'reverse')
  await page.mouse.click(x(6), y, { button: 'right' })
  assert.equal(await page.locator('.time').innerText(), '0:06.000')
  assert.deepEqual(await own(), ['Paste', 'Add a marker', 'Process'], 'the caret\'s own, no Cut')
  // Esc closes it, the caret staying
  await page.keyboard.press('Escape')
  await page.locator('.menubar-menu').waitFor({ state: 'detached' })
  await page.mouse.click(x(6), y, { button: 'right' })
  await item('Add a marker').click()
  await page.waitForFunction(() => /\.mark\(6\)$/.test(scriptText()))
})

// A stretch is one method, its algorithm a choice on its card (fn/stretch.js, { method }), and so is a pitch shift
// (fn/pitch.js): the menus list Stretch once and Pitch once, as they name every method, in capitals; a method chosen is written into its call, the output as long as the factor says
test('editor: one Stretch, its algorithm a choice; the menus name each method in capitals', async () => {
  await open()
  await noCues()
  await write(`audio('chime.wav')`)
  await lengthIs('0:08.000')
  const { box, x } = await axis(8), y = box.y + tall(box) * .3
  await page.mouse.click(x(2), y, { button: 'right' })
  await menuRow('Process').click()
  await menuRow('Time & pitch').click()
  const names = await page.locator('.menubar-sub:popover-open .menu-label').allInnerTexts()
  assert.deepEqual(names.filter(n => /^stretch/i.test(n)), ['Stretch'], names.join(', '))
  assert.deepEqual(names.filter(n => /^(pitch|formant shift|vocoder|paulstretch)/i.test(n)), ['Pitch'], 'the pitch shifts one Pitch, its method a choice')
  assert.ok(names.every(n => n[0] === n[0].toUpperCase()), names.join(', '))
  await page.keyboard.press('Escape')
  await write(`audio('chime.wav').stretch(1.5)`)
  await lengthIs('0:12.000')
  await tab('Edits')
  await page.locator('.step-name', { hasText: /^Stretch$/ }).click()
  const more = page.locator('.step.open .step-more')
  if (await more.count() && await more.getAttribute('aria-expanded') === 'false') await more.click()
  const method = page.locator('.step.open .param', { hasText: 'method' })
  assert.match(await method.evaluate(tipOf), /^How it stretches\./)
  await method.getByRole('button', { name: 'wsola', exact: true }).click()
  await page.waitForFunction(() => /stretch\(1\.5, \{ method: 'wsola' \}\)/.test(scriptText()))
  await lengthIs('0:12.000')
})

// The menu from the keys: F10 reaches it, the arrows go across and down and into a submenu, Enter runs, and the keys
// go back where they were
test('editor: the menu works from the keys, and gives them back', async () => {
  await open()
  await page.locator('.plot').focus()
  await page.keyboard.press('F10')
  assert.equal(await page.evaluate(() => document.activeElement.textContent), 'File')
  for (const key of ['ArrowRight', 'ArrowRight', 'ArrowRight', 'ArrowDown', 'ArrowDown', 'Enter']) await page.keyboard.press(key)
  // View, its second item: the spectrogram, in place of the waveform
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('audio-repl') || '{}').display === 'spec')
  assert.ok(await page.locator('.plot').evaluate(el => el === document.activeElement), 'the keys are back on the picture')
})

// A submenu and the pointer on its way to it (menu.js aims): crossing the rows under its own, heading into it, they let
// it pass, the submenu staying; resting on one, that one takes it; moved straight up or down, the next row takes it at once
test('editor: the pointer on its way to a submenu crosses the rows between, which take it only once it rests', async () => {
  await open()
  const lit = () => page.evaluate(() => document.activeElement.querySelector?.('.menu-label')?.textContent ?? '')
  const subs = () => page.locator('.menubar-sub:popover-open').count()
  const frame = () => page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))))
  await page.locator('.menubar-item', { hasText: /^View$/ }).click()
  const show = await menuRow('Show').boundingBox(), zoom = await menuRow('Zoom').boundingBox()
  await page.mouse.move(show.x + 30, show.y + show.height / 2)
  await page.locator('.menubar-sub:popover-open').waitFor()
  const sub = await page.locator('.menubar-sub:popover-open').boundingBox()
  assert.ok(sub.y + sub.height > zoom.y + zoom.height, 'the Show submenu reaches past Zoom, two rows down')
  // down and right over Snap and onto Zoom's far end, by the submenu's edge
  await page.mouse.move(zoom.x + zoom.width - 4, zoom.y + zoom.height / 2, { steps: 12 })
  await frame()
  assert.equal(await lit(), 'Show', 'the row crossed lets it pass')
  assert.equal(await subs(), 1, 'Show\'s submenu still open')
  // gone out of the menus from there and resting: nothing, the row it last crossed taking nothing
  await page.mouse.move(zoom.x + zoom.width - 4, zoom.y + zoom.height + 400)
  // resting past the 300 ms a row takes the pointer in (menu.js REST)
  await page.waitForTimeout(500)
  assert.equal(await lit(), 'Show', 'out of the menus, nothing changes')
  assert.equal(await subs(), 1)
  await page.mouse.move(show.x + 30, show.y + show.height / 2)
  await page.mouse.move(zoom.x + zoom.width - 4, zoom.y + zoom.height / 2, { steps: 12 })
  // rested there: Zoom's, its own submenu opening a moment on
  await page.waitForFunction(() => document.activeElement.querySelector?.('.menu-label')?.textContent === 'Zoom')
  await page.locator('.menubar-sub:popover-open .menu-row', { hasText: /^In/ }).waitFor()
  // straight up a row: Snap's at once, Zoom's submenu gone
  await page.mouse.move(zoom.x + zoom.width - 4, zoom.y - zoom.height / 2, { steps: 4 })
  await frame()
  assert.equal(await lit(), 'Snap to cues and markers')
  assert.equal(await subs(), 0)
  await page.keyboard.press('Escape')
})

test('desktop: the app is told the panels and the menus with the page\'s own icons; an item picked there runs here', async () => {
  await page.addInitScript(() => {
    globalThis.__told = []
    globalThis.webkit = { messageHandlers: { app: { postMessage: m => __told.push(JSON.parse(JSON.stringify(m))) } } }
  })
  // the page as the app opens it (?desktop): laid out for it from the first paint, its bar and its panels' buttons the
  // app's own; the bridge to the app (desktop/app.js) the page's to load
  await page.goto(origin + '/playground/?desktop')
  await wholeLevels().waitFor({ state: 'attached' })
  assert.deepEqual(await page.evaluate(() => [document.documentElement.classList.contains('desktop'), ...['.app > .bar', '.panes > .side-head'].map(s => getComputedStyle(document.querySelector(s)).display)]), [true, 'none', 'none'])
  await page.waitForFunction(() => __told.some(m => m.menus && m.toolbar?.length))
  const { told, panels, drawn } = await page.evaluate(async () => {
    const { glyph } = await import('/playground/icons.js')
    const walk = items => items.filter(it => it !== '-' && !it.group).map(it => ({ label: it.label, icon: it.icon ? glyph(it.icon) : '', ...it.items && { items: walk(it.items) } }))
    const shape = items => items.filter(it => !it.separator && !it.group).map(it => ({ label: it.label, icon: it.icon, ...it.items && { items: shape(it.items) } }))
    const told = __told.findLast(m => m.menus)
    return {
      told: { toolbar: told.toolbar.map(({ label, icon }) => ({ label, icon })), menus: told.menus.map(m => shape(m.items)) },
      panels: [...document.querySelectorAll('.side-head .panels button[role="tab"]')].map(b => ({ label: b.getAttribute('aria-label'), icon: b.querySelector('svg').outerHTML })),
      drawn: document.querySelector('.menubar').menus().map(m => walk(m.items))
    }
  })
  assert.deepEqual(told.toolbar, panels, 'each panel, its button\'s icon')
  assert.ok(panels.length >= 6 && panels.every(p => /<path d="[^"]+"/.test(p.icon)))
  assert.deepEqual(told.menus, drawn, 'each item\'s icon as the page\'s menus draw it, none where it has none')
  const icons = told.menus.flat(Infinity).flatMap(function all(it) { return [it, ...(it.items ?? []).flatMap(all)] }).filter(it => it.icon)
  assert.ok(icons.length >= 11, 'the Process menu\'s kinds at least, an icon each')
  // View › Waveform options › Colormap › Magma, picked in the app's menu
  const id = await page.evaluate(() => {
    const menus = __told.findLast(m => m.menus).menus, find = (items, label) => items.find(it => it.label === label)
    return find(find(find(menus.find(m => m.name === 'View').items, 'Waveform options').items, 'Colormap').items, 'Magma').id
  })
  await page.evaluate(id => audioHost.run(id), id)
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('audio-repl') || '{}').wave?.map === 'magma')
})
