// Tabs: a sound each, dragged, closed and opened again, kept; the server, the page and the helpers in page.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import audio from '../../audio.js'
import { browser, page, origin, errors, chimeLeft, sine, wavBytes, code, wholeLevels, open, settled, frames, menuRow, selected, tab, menu, noCues, write, tall, tracksAt, axis, drag, lengthIs, scriptOf, keyed, chime } from './page.js'

// A slice dragged up over the head onto the tabs goes to a tab of its own, this one's script cropped to it: copied (Alt),
// this one as it was; moved (⌘), it leaves this one, the rest closing up as a cut's
test('editor: a slice dragged onto the tabs goes to a tab of its own; moved, it leaves this one', async () => {
  const { x, y } = await chime()
  const up = async (keys, select = true) => {
    if (select) await drag([x(1), y], [x(2) - x(1), 0])
    const files = await page.locator('.files').boundingBox()
    await keyed(keys, () => drag([x(1.5), y], [files.x + files.width / 2 - x(1.5), files.y + files.height / 2 - y]))
  }
  await up(['Alt'])
  await page.waitForFunction(() => document.querySelectorAll('.file').length === 2)
  await page.waitForFunction(() => scriptText() === "audio('chime.wav')\n  .crop({ at: 1, d: 1 })")
  await lengthIs('0:01.000')
  await page.locator('.file [role="tab"]').first().click()
  await page.waitForFunction(() => scriptText() === "audio('chime.wav')")
  await lengthIs('0:08.000')
  // the tab's selection as it was left
  await page.waitForFunction(() => (e => e.title || e.dataset.tip || '')(document.querySelector('.clock')).startsWith('Selected 0:01.000–0:02.000:'))
  await up(['ControlOrMeta'], false)
  await page.waitForFunction(() => document.querySelectorAll('.file').length === 3)
  await page.waitForFunction(() => scriptText() === "audio('chime.wav')\n  .crop({ at: 1, d: 1 })")
  await page.locator('.file [role="tab"]').first().click()
  await page.waitForFunction(() => scriptText() === "audio('chime.wav')\n  .remove({ at: 1, d: 1, xfade: 0.01 })")
  await lengthIs('0:07.000')
})

// Tabs drag along to reorder, as a browser's; the order is kept for the next visit
test('editor: a tab dragged along the others goes where it is let go, kept for the next visit', async () => {
  await open()
  await page.getByRole('button', { name: 'New tab' }).click()
  const names = () => page.locator('.file [role="tab"]').allInnerTexts()
  assert.deepEqual(await names(), ['chime.wav', 'untitled'])
  const [first, second] = await Promise.all([0, 1].map(i => page.locator('.file').nth(i).boundingBox()))
  await page.mouse.move(first.x + 20, first.y + first.height / 2)
  await page.mouse.down()
  // short of half the other: it holds its place; past it, it steps aside
  await page.mouse.move(first.x + 20 + second.x + second.width / 2 - (first.x + first.width) - 4, first.y + first.height / 2, { steps: 4 })
  assert.equal(await page.locator('.file').nth(1).evaluate(el => el.style.transform), '', 'held under half')
  await page.mouse.move(first.x + 20 + second.x + second.width / 2 - (first.x + first.width) + 4, first.y + first.height / 2, { steps: 2 })
  // held under the pointer, the other stepped aside to make room
  const shifts = await page.locator('.file').evaluateAll(els => els.map(el => el.style.transform))
  assert.ok(/^translateX\(\d/.test(shifts[0]) && /^translateX\(-/.test(shifts[1]), JSON.stringify(shifts))
  await page.mouse.up()
  assert.deepEqual(await names(), ['untitled', 'chime.wav'])
  assert.deepEqual(await page.locator('.file').evaluateAll(els => els.map(el => el.style.transform)), ['', ''], 'laid out as it was let go')
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('audio-repl')).docs.map(d => d.code.includes('chime.wav')).join() === 'false,true')
  await page.reload()
  await page.locator('.file').first().waitFor()
  assert.deepEqual(await names(), ['untitled', 'chime.wav'])
})

// A tab left as its sound renders renders on: its mark turns in the close button's place as it does, a dot once it is
// made; shown again, its sound is there at once, the dot gone. The tab shown meanwhile works as ever
test('editor: a tab left as it renders renders on, marked, its sound there when it is shown again', async () => {
  await open()
  const SLOW = `audio.op('slow', { prepare: () => new Promise(done => setTimeout(done, 2500)), process: (input, output) => input.forEach((x, c) => output[c].set(x)) })\n`
  const mark = i => page.locator('.file').nth(i).getAttribute('data-mark')
  await write(SLOW + `audio('chime.wav').slow()`)
  await page.waitForFunction(() => document.querySelector('.file')?.dataset.mark === 'working')
  await page.getByRole('button', { name: 'New tab' }).click()
  await write(`audio('chime.wav').gain(-6)`)
  await lengthIs('0:08.000')
  assert.equal(await mark(0), 'working', 'the tab left still renders')
  assert.equal(await page.locator('.file').first().locator('[role="tab"]').getAttribute('aria-busy'), 'true')
  await page.waitForFunction(() => document.querySelector('.file')?.dataset.mark === 'ready', null, { timeout: 10000 })
  assert.equal(await mark(1), null, 'the tab shown, at rest, unmarked')
  await page.locator('.file [role="tab"]').first().click()
  await lengthIs('0:08.000')
  assert.equal(await mark(0), null, 'seen: the dot goes')
  assert.equal(await page.locator('.status .message').innerText(), '', 'nothing rendering')
})

// A new sound goes into a tab of its own, and the script it came over stays in its tab; an empty script takes it whole
test('editor: a new sound opens in a tab of its own, the script shown before it kept; an empty one takes it', async () => {
  const bytes = await wavBytes([sine(.5, 440, .5)])
  const tabs = () => page.locator('.files [role="tab"]').allInnerTexts()
  await open()
  // a note alone: it stays, in its tab; the file in a tab after it
  await write('// my notes')
  await page.locator('.empty').waitFor()
  const chooser = page.waitForEvent('filechooser')
  await menu('File', 'Open file…')
  await (await chooser).setFiles({ name: 'tone.wav', mimeType: 'audio/wav', buffer: bytes })
  await page.waitForFunction(() => scriptText() === "audio('tone.wav')")
  await lengthIs('0:00.500')
  assert.deepEqual(await tabs(), ['untitled', 'tone.wav'])
  await page.getByRole('tab', { name: 'untitled' }).click()
  await page.waitForFunction(() => scriptText() === '// my notes')
  // an empty script takes a generator, and then a sample goes into a tab of its own
  await tab('Code')
  await page.locator('.cm-content').click()
  await page.keyboard.press('ControlOrMeta+A')
  await page.keyboard.press('Backspace')
  await page.locator('.empty').waitFor()
  await menu('File', 'Sample or generate', 'Noise')
  await page.waitForFunction(() => /^audio\.from/.test(scriptText()))
  await menu('File', 'Sample or generate', 'chime.wav')
  await page.waitForFunction(() => scriptText() === "audio('chime.wav')")
  await lengthIs('0:08.000')
  assert.deepEqual(await tabs(), ['generated', 'tone.wav', 'chime.wav'])
})

// An empty tab is an empty track, its caret at its start, its time row over 10 s, a word in it of what goes there, and
// nothing to press: File › Open recent lists what to open again, a tab closed, as it was left, its edits counted, which
// opens in the empty tab's place; no band's look while there is no sound to show
test('editor: an empty tab is an empty track; File › Open recent opens a closed tab in its place, no look while there is no sound', async () => {
  await open()
  await write(`audio('chime.wav').gain(-3)`)
  await menu('File', 'Close tab')
  await page.locator('.empty').waitFor()
  await page.waitForFunction(() => ![...document.querySelectorAll('.view button')].some(b => b.checkVisibility()))
  // the time row's labels drawn, 0 to 9 s, as a take into it is first watched over
  await page.waitForFunction(() => document.querySelector('.plot canvas.row').style.opacity === '1')
  await page.locator('.menubar-item', { hasText: /^File$/ }).click()
  await menuRow('Open recent').click()
  const row = page.locator('.menubar-sub:popover-open .menu-row').first()
  assert.equal(await row.locator('.menu-label').innerText(), 'chime.wav')
  assert.equal(await row.locator('.menu-keys').innerText(), '1 edit, closed just now')
  await row.click()
  await page.waitForFunction(() => scriptText().includes('gain(-3)'))
  assert.deepEqual(await page.locator('.files [role="tab"]').allInnerTexts(), ['chime.wav'], 'in the empty tab\'s place')
  await wholeLevels().waitFor()
  await page.locator(':is(.lane-look, .layer-look):visible').waitFor()
  // a sound made in the script, opening no file: named by its first line; the newest first (chime.wav, closed after it)
  await page.getByRole('button', { name: 'New tab' }).click()
  await write(`audio.from(t => Math.sin(t * 2000), { duration: 1 })`)
  await menu('File', 'Close tab')
  await menu('File', 'Close tab')
  await page.locator('.empty').waitFor()
  await page.locator('.menubar-item', { hasText: /^File$/ }).click()
  await menuRow('Open recent').click()
  await page.locator('.menubar-sub:popover-open .menu-row').first().waitFor()
  assert.deepEqual(await page.locator('.menubar-sub:popover-open .menu-row .menu-label').allInnerTexts(), ['chime.wav', 'audio.from(t => Math.sin(t * 2000), { du', 'Delete kept sounds…'])
  await page.keyboard.press('Escape')
})

// Alt-click puts another caret, as a text editor's; M marks each, and a click leaves one
// Tabs, as an audio editor's open files: a sound opened goes into a tab of its own, each tab keeps its script and its
// own history, the page keeps them all, and closing the last leaves an empty one
test('editor: each sound opens in a tab of its own, with its own script and history, kept across a reload', async () => {
  await open()
  const tabs = () => page.locator('.files [role="tab"]').allInnerTexts()
  const shown = () => code().then(c => c.replace(/\s+/g, ''))
  await write(`audio('chime.wav').gain(-3)`)
  await lengthIs('0:08.000')
  await menu('File', 'Sample or generate', 'handpan.wav')
  await page.waitForFunction(() => scriptText().trim() === "audio('handpan.wav')")
  assert.deepEqual(await tabs(), ['chime.wav', 'handpan.wav'])
  await tab('Code')
  await page.locator('.cm-content').click()
  await page.keyboard.press('End')
  await page.keyboard.insertText('.gain(-6)')
  await page.getByRole('tab', { name: 'chime.wav' }).click()
  assert.equal(await shown(), `audio('chime.wav').gain(-3)`)
  await lengthIs('0:08.000')
  // the undo is this tab's: the handpan's edit stays
  await page.locator('.cm-content').click()
  await page.keyboard.press('ControlOrMeta+Z')
  assert.notEqual(await shown(), `audio('chime.wav').gain(-3)`)
  await page.getByRole('tab', { name: 'handpan.wav' }).click()
  assert.equal(await shown(), `audio('handpan.wav').gain(-6)`)
  await page.waitForFunction(() => (s => s.docs.length === 2 && s.doc === 1 && s.docs[1].code.replace(/\s+/g, '') === "audio('handpan.wav').gain(-6)")(JSON.parse(localStorage.getItem('audio-repl'))))
  await page.reload()
  await wholeLevels().waitFor()
  assert.deepEqual(await tabs(), ['chime.wav', 'handpan.wav'])
  assert.equal(await shown(), `audio('handpan.wav').gain(-6)`)
  // a link's script: in a tab of its own, or in the tab that holds it already
  const link = text => page.evaluate(async text => {
    const bytes = new Uint8Array(await new Response(new Blob([text]).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer())
    return location.origin + '/playground/#code=' + btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  }, text)
  const visit = async url => { await page.goto(url); await page.reload(); await wholeLevels().waitFor() }
  const reversed = await link(`audio('chime.wav').reverse()`)
  await visit(reversed)
  assert.equal((await tabs()).length, 3)
  assert.equal(await shown(), `audio('chime.wav').reverse()`)
  await page.getByRole('tab', { name: 'handpan.wav' }).click()
  await page.waitForFunction(() => (s => s.docs[s.doc]?.code.includes('handpan.wav'))(JSON.parse(localStorage.getItem('audio-repl'))))
  await visit(reversed)
  assert.equal((await tabs()).length, 3)
  assert.equal(await shown(), `audio('chime.wav').reverse()`)
  // closing a tab not shown leaves the one shown; closing the one shown shows its neighbour; the last leaves an empty one
  await page.getByRole('button', { name: 'Close chime.wav' }).first().click()
  assert.deepEqual(await tabs(), ['handpan.wav', 'chime.wav'])
  assert.equal(await shown(), `audio('chime.wav').reverse()`)
  await page.getByRole('button', { name: 'Close chime.wav' }).click()
  assert.deepEqual(await tabs(), ['handpan.wav'])
  assert.equal(await shown(), `audio('handpan.wav').gain(-6)`)
  await page.getByRole('button', { name: 'Close handpan.wav' }).click()
  assert.deepEqual(await tabs(), ['untitled'])
  assert.equal(await shown(), '')
  await page.getByText('Drop audio here').waitFor()
  assert.deepEqual(errors, [])
})

// A tab closed opens again where it was, as it was left (⇧⌘T, as a browser's): its script, its selection; one closed
// before a reload too. What each tab selected stays with it as the tabs are switched
test('editor: a closed tab opens again where it was, as it was left, after a reload too', async () => {
  const { x, y } = await chime()
  const tabs = () => page.locator('.files [role="tab"]').allInnerTexts()
  await write(`audio('chime.wav').gain(-3)`)
  await lengthIs('0:08.000')
  await drag([x(1), y], [x(3) - x(1), 0])
  const was = await selected()
  assert.match(was, /^0:0[01]\.\d+–0:0[23]\.\d+$/)
  await menu('File', 'Sample or generate', 'handpan.wav')
  await page.waitForFunction(() => scriptText().trim() === "audio('handpan.wav')")
  await page.getByRole('tab', { name: 'chime.wav' }).click()
  await page.waitForFunction(was => (e => e.title || e.dataset.tip || '')(document.querySelector('.clock')).startsWith(`Selected ${was}:`), was)
  await menu('File', 'Close tab')
  assert.deepEqual(await tabs(), ['handpan.wav'])
  await page.locator('.plot').focus()
  await page.keyboard.press('ControlOrMeta+Shift+T')
  assert.deepEqual(await tabs(), ['chime.wav', 'handpan.wav'])
  assert.equal(scriptOf(await code()), `audio('chime.wav').gain(-3)`)
  await page.waitForFunction(was => (e => e.title || e.dataset.tip || '')(document.querySelector('.clock')).startsWith(`Selected ${was}:`), was)
  // in this visit, the tab itself: its history with it
  await menu('Edit', 'Undo')
  await page.waitForFunction(() => !scriptText().includes('gain(-3)'))
  await menu('Edit', 'Redo')
  // closed, and the page reloaded: kept, in the menu
  await menu('File', 'Close tab')
  await page.waitForFunction(() => (s => s.docs.length === 1 && s.docs[0].code.includes('handpan.wav'))(JSON.parse(localStorage.getItem('audio-repl'))))
  await page.reload()
  await wholeLevels().waitFor()
  assert.deepEqual(await tabs(), ['handpan.wav'])
  await menu('File', 'Reopen closed tab')
  assert.deepEqual(await tabs(), ['chime.wav', 'handpan.wav'])
  await lengthIs('0:08.000')
  await page.waitForFunction(was => (e => e.title || e.dataset.tip || '')(document.querySelector('.clock')).startsWith(`Selected ${was}:`), was)
  // none left to open
  await page.locator('.menubar-item', { hasText: /^File$/ }).click()
  assert.equal(await menuRow('Reopen closed tab').getAttribute('aria-disabled'), 'true')
})

// One editor writes at a time: opened in a second tab, it asks; asked, the first stores what it has (a change made a
// moment before) and steps aside, saying where it is now
test('editor: a second tab asks to be the editor; the first stores and steps aside', async () => {
  // two tabs of one browser: one context, its storage theirs
  const context = await browser.newContext(), first = await context.newPage(), second = await context.newPage()
  await chimeLeft(context)
  const script = p => p.evaluate(() => [...document.querySelectorAll('.cm-content .cm-line')].map(l => l.textContent).join('\n'))
  try {
    for (const p of [first, second]) p.on('pageerror', e => errors.push(e.message))
    await first.goto(origin + '/playground/')
    await first.locator('.readout[data-of="all"]').waitFor()
    await first.getByRole('tab', { name: 'Code' }).click()
    await first.locator('.cm-content').click()
    await first.keyboard.press('ControlOrMeta+End')
    await first.keyboard.insertText('.gain(-2)')
    await second.goto(origin + '/playground/')
    // the page asking came up as it was stored, behind the question; once the first has stored, it reads it again
    await Promise.all([second.waitForEvent('load'), second.getByRole('button', { name: 'Use it here' }).click()])
    await second.locator('.readout[data-of="all"]').waitFor()
    assert.match(scriptOf(await script(second)), /\.gain\(-2\)$/, 'the change made a moment before')
    await first.locator('dialog.elsewhere[open]').waitFor()
    // and back, with one click there
    await Promise.all([first.waitForEvent('load'), first.getByRole('button', { name: 'Use it here' }).click()])
    await first.locator('.readout[data-of="all"]').waitFor()
    await second.locator('dialog.elsewhere[open]').waitFor()
    assert.match(scriptOf(await script(first)), /\.gain\(-2\)$/)
  } finally { await context.close() }
})

// Tabs play at once, as a browser's do: one left playing plays on, its speaker on its tab; a press on the speaker mutes
// it, crossed out, and again hears it
test('editor: tabs play at once, each playing its speaker on its tab, a press on it muting it', async () => {
  await open()
  const speakers = () => page.evaluate(() => [...document.querySelectorAll('.files .file')].map(f => f.querySelector('.file-sound')?.getAttribute('aria-pressed') ?? null))
  await page.getByRole('button', { name: 'Loop', exact: true }).click()
  await page.getByRole('button', { name: 'Play', exact: true }).click()
  await page.waitForFunction(() => document.querySelector('.file.current .file-sound'))
  await page.getByRole('button', { name: 'New tab', exact: true }).click()
  await write(`audio('chime.wav').gain(-6)`)
  await wholeLevels().waitFor()
  assert.deepEqual(await speakers(), ['false', null], 'the tab left plays on')
  await page.getByRole('button', { name: 'Play', exact: true }).click()
  await page.waitForFunction(() => document.querySelectorAll('.file .file-sound').length === 2)
  await page.locator('.files .file').first().locator('.file-sound').click()
  assert.deepEqual(await speakers(), ['true', 'false'], 'the first muted, playing on')
  await page.locator('.files .file').first().locator('.file-sound').click()
  assert.deepEqual(await speakers(), ['false', 'false'])
  // shown again, it plays as it was left: its Play a pause
  await page.locator('.files [role=tab]').first().click()
  await page.getByRole('button', { name: 'Pause', exact: true }).waitFor()
  await page.getByRole('button', { name: 'Pause', exact: true }).click()
  await page.waitForFunction(() => !document.querySelector('.file.current .file-sound') && document.querySelectorAll('.file .file-sound').length === 1)
  // the other, playing on, closed: what it played stops with it, nothing sounding
  await page.locator('.files .file').nth(1).locator('.file-close').click()
  await page.waitForFunction(() => document.querySelectorAll('.files .file').length === 1 && !document.querySelector('.file .file-sound'))
})

// A slice of a track dragged onto the tabs: a tab of that track's alone, its chain cropped to it
test('editor: with tracks, a slice dragged onto the tabs is the edited track\'s alone', async () => {
  await open()
  await noCues()
  await write(`let a = audio('chime.wav')\n\nlet b = audio('chime.wav')\n  .gain(-6)`)
  await page.waitForFunction(() => document.querySelector('.plot').dataset.tracks === '2')
  await lengthIs('0:08.000')
  // b's lane's middle, edited, tall under a's strip
  const { box, x } = await axis(8), y = (r => r.y + r.h / 2)((await tracksAt())[1]), files = await page.locator('.files').boundingBox()
  await drag([x(1), y], [x(2) - x(1), 0])
  await keyed(['Alt'], () => drag([x(1.5), y], [files.x + files.width / 2 - x(1.5), files.y + files.height / 2 - y]))
  await page.waitForFunction(() => document.querySelectorAll('.file').length === 2)
  await page.waitForFunction(() => scriptText() === "audio('chime.wav')\n  .gain(-6)\n  .crop({ at: 1, d: 1 })")
  await lengthIs('0:01.000')
})

// A track and a tab are one sound each, heard with the others or alone: a tab dragged down onto the picture is a track
// of the sound shown, its tab gone; the track moved to its own tab again, gone from here
test('editor: a tab dragged onto the picture is a track; a track moved to its own tab', async () => {
  await open()
  await write(`audio('chime.wav')`)
  await lengthIs('0:08.000')
  await menu('File', 'Sample or generate', 'handpan.wav')
  await page.waitForFunction(() => scriptText().trim() === "audio('handpan.wav')")
  await page.getByRole('tab', { name: 'chime.wav' }).click()
  await page.waitForFunction(() => scriptText().trim() === "audio('chime.wav')")
  const t = await page.getByRole('tab', { name: 'handpan.wav' }).boundingBox(), plot = await page.locator('.plot').boundingBox()
  await page.mouse.move(t.x + t.width / 2, t.y + t.height / 2)
  await page.mouse.down()
  await page.mouse.move(t.x + t.width / 2, plot.y + plot.height / 3, { steps: 8 })
  assert.ok(await page.locator('#app.dropping').count(), 'the picture says it takes it')
  await page.mouse.up()
  await page.waitForFunction(() => scriptText().includes("let handpan = audio('handpan.wav')"))
  assert.equal(await code(), `let chime = audio('chime.wav')\n\nlet handpan = audio('handpan.wav')`)
  // named by its tracks, as their layers are
  assert.deepEqual(await page.locator('.files [role="tab"]').allInnerTexts(), ['chime + handpan'])
  await page.waitForFunction(() => document.title === 'chime + handpan · audio playground')
  await page.waitForFunction(() => document.querySelector('.plot').dataset.tracks === '2')
  await menu('Track', 'Move the track to its own tab')
  await page.waitForFunction(() => scriptText().trim() === "audio('handpan.wav')")
  assert.deepEqual(await page.locator('.files [role="tab"]').allInnerTexts(), ['chime.wav', 'handpan.wav'])
  await page.getByRole('tab', { name: 'chime.wav' }).click()
  await page.waitForFunction(() => scriptText().trim() === "let chime = audio('chime.wav')")
  await page.waitForFunction(() => !document.querySelector('.plot').dataset.tracks)
})

// Where a tab's sound was zoomed to stays with the tab: another tab shows its own sound whole, and the first comes back
// as it was left, after a reload too
test('editor: each tab keeps where its sound was zoomed, switched away and back and after a reload', async () => {
  await open()
  await noCues()
  await write(`audio('chime.wav')`)
  await lengthIs('0:08.000')
  const { box, x } = await axis(8), y = box.y + tall(box) * .3
  // the time at the view's left edge, from a click there
  const left = async () => { await page.mouse.click(box.x + 1, y); return (await page.locator('.time').innerText()).split(':').reduce((m, s) => m * 60 + +s, 0) }
  await page.mouse.click(x(4), y)
  await page.locator('.plot').focus()
  for (let i = 0; i < 2; i++) await page.keyboard.press('=')
  await frames()
  const before = await left()
  assert.ok(before > 2 && before < 4, `zoomed in about the caret: the view from ${before}`)
  await page.getByRole('button', { name: 'New tab' }).click()
  await write(`audio.from(2)`)
  await lengthIs('0:02.000')
  await settled()
  assert.ok(await left() < .05, 'the other tab\'s sound whole')
  await page.locator('.file [role="tab"]').first().click()
  await lengthIs('0:08.000')
  await settled()
  assert.ok(Math.abs(await left() - before) < .01, 'the first as it was left')
  await page.reload()
  await wholeLevels().waitFor()
  await lengthIs('0:08.000')
  await settled()
  assert.ok(Math.abs(await left() - before) < .01, 'and after a reload')
})
// A name is a field: a track's clicked is written at once, focused, in the name's own font and weight, no box round
// it, as wide as its text; the tab shown, clicked, the same, its name kept with the tab and over a reload
test('editor: a track\'s name or the shown tab\'s, clicked, is written in place at once, as it looks', async () => {
  await open()
  await noCues()
  await write(`let a = audio('chime.wav')\n\nlet b = audio('rhodes.wav')`)
  await lengthIs('0:09.000')
  const look = sel => page.evaluate(sel => { const e = document.querySelector(sel), s = getComputedStyle(e); return { font: s.fontFamily + ' ' + s.fontSize + ' ' + s.fontWeight, outline: s.outlineStyle, focused: document.activeElement === e, width: e.getBoundingClientRect().width } }, sel)
  const name = await look('.layer:nth-child(2) .layer-name')
  await page.locator('.layer-name', { hasText: /^b$/ }).click()
  const field = await look('.layer-field')
  assert.ok(field.focused, 'focused at once')
  assert.equal(field.font, name.font, 'in the name\'s font and weight')
  assert.equal(field.outline, 'none', 'no box round it')
  assert.ok(field.width < 40, `as wide as its text: ${field.width}`)
  await page.keyboard.type('bed')
  await page.keyboard.press('Enter')
  await page.waitForFunction(() => /\nlet bed = audio\('rhodes\.wav'\)/.test(scriptText()))
  // another track's name: that one edited, its name in hand as soon as its layers are laid out so
  await page.locator('.layer-name', { hasText: /^a$/ }).click()
  await page.waitForFunction(() => document.activeElement?.classList.contains('layer-field') && document.activeElement.value === 'a')
  await page.keyboard.press('Escape')
  // the tab shown
  await page.locator('.file.current [role="tab"]').click()
  assert.ok((await look('.file-field')).focused, 'the tab\'s name focused at once')
  await page.keyboard.type('Session')
  await page.keyboard.press('Enter')
  await page.waitForFunction(() => document.querySelector('.file.current [role="tab"]')?.textContent === 'Session')
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('audio-repl')).docs[0].title === 'Session')
  await page.reload()
  await wholeLevels().waitFor()
  assert.equal(await page.locator('.file.current [role="tab"]').textContent(), 'Session', 'kept over a reload')
})

// Each tab shows its own sound at once when it is shown again, before its script has run again
test('editor: a tab shown again shows its sound at once', async () => {
  await open()
  await page.getByRole('button', { name: 'New tab' }).click()
  await write(`audio.from(t => 0.5 * Math.sin(2 * Math.PI * 220 * t), { d: 3 })`)
  await lengthIs('0:03.000')
  const length = () => page.evaluate(() => (e => e.title || e.dataset.tip || '')(document.querySelector('.source')).split(' · ').pop())
  await page.locator('.file [role="tab"]').first().click()
  assert.equal(await length(), '0:06.525', 'the chime at once')
  await page.locator('.file [role="tab"]').last().click()
  assert.equal(await length(), '0:03.000', 'the tone at once')
  await page.getByRole('button', { name: 'New tab' }).click()
  assert.equal(await page.locator('.source').count(), 1)
  await page.locator('.empty').waitFor()
})

// A tab shown again whose sound is what its script makes shows it as it was, nothing run again (the worker keeps each
// tab's last output, for its cues, checks and export): its sound, what its run printed, its export. With nothing
// selected, the clock says how long all of it is, softer than a selection's length
test('editor: a tab shown again runs nothing; its sound, its words and its export as they were', async () => {
  await page.addInitScript(() => {
    const post = Worker.prototype.postMessage
    globalThis.runs = 0
    Worker.prototype.postMessage = function (m, t) { if (m?.type === 'run') runs++; return post.call(this, m, t) }
  })
  await open()
  await write(`console.log('the chime')\naudio('chime.wav').gain(-3)`)
  await lengthIs('0:08.000')
  await page.waitForFunction(() => !document.querySelector('.message').textContent)
  assert.equal(await page.locator('.length').innerText(), '0:08.000', 'all of it, nothing selected')
  assert.ok(await page.locator('.length').evaluate(el => el.classList.contains('whole')))
  await page.getByRole('button', { name: 'New tab' }).click()
  // no sound: its length nothing, 0:00.000, as a player's with nothing in it
  assert.deepEqual(await page.locator('.length').evaluate(e => [e.textContent, getComputedStyle(e).visibility]), ['0:00.000', 'visible'], 'no sound')
  await write(`audio.from(2)`)
  await lengthIs('0:02.000')
  const ran = await page.evaluate(() => runs)
  await page.locator('.file [role="tab"]').first().click()
  await lengthIs('0:08.000')
  await settled()
  assert.equal(await page.evaluate(() => runs), ran, 'nothing ran again')
  assert.deepEqual(await page.locator('.console .line').evaluateAll(l => l.map(e => e.textContent)), ['the chime'])
  await tab('Export')
  const [d] = await Promise.all([page.waitForEvent('download'), page.locator('.export .export-button').click()])
  const exported = await audio(await readFile(await d.path()))
  assert.ok(Math.abs(exported.duration - 8) < .001, `its own sound exported: ${exported.duration} s`)
  await page.locator('.file [role="tab"]').last().click()
  await lengthIs('0:02.000')
  assert.equal(await page.evaluate(() => runs), ran, 'nor the other')
  // left before its output came: shown again, it runs, and its own output comes
  await write(`audio.from(3)`)
  await page.locator('.file [role="tab"]').first().click()
  await lengthIs('0:08.000')
  await page.locator('.file [role="tab"]').last().click()
  await lengthIs('0:03.000')
  assert.ok(await page.evaluate(() => runs) > ran, 'ran again')
})

// More tabs than fit keep their width and scroll, as a code editor's: the one shown in sight, the wheel moving them along,
// no scrollbar, a side with more past it faded
test('editor: tabs keep their width and scroll, the one shown in sight', async () => {
  await page.setViewportSize({ width: 900, height: 700 })
  await open()
  for (let i = 0; i < 12; i++) await page.getByRole('button', { name: 'New tab' }).click()
  const strip = page.locator('.files-list')
  const { scroll, client } = await strip.evaluate(e => ({ scroll: e.scrollWidth, client: e.clientWidth }))
  assert.ok(scroll > client, 'more than fit: they scroll')
  const widths = await page.locator('.file').evaluateAll(l => l.map(e => e.getBoundingClientRect().width))
  assert.ok(Math.min(...widths) > 60, `none squeezed: ${Math.min(...widths)}`)
  const sight = () => page.locator('.file.current').evaluate(e => { const r = e.getBoundingClientRect(), s = e.parentElement.getBoundingClientRect(); return r.left >= s.left - 1 && r.right <= s.right + 1 })
  await frames()
  assert.ok(await sight(), 'the one shown, the last made, in sight')
  assert.equal(await strip.evaluate(e => e.offsetHeight - e.clientHeight), 0, 'no scrollbar')
  await page.waitForFunction(() => document.querySelector('.files-list').dataset.more === 'start')
  await strip.hover()
  await page.mouse.wheel(0, -4000)
  await page.waitForFunction(() => document.querySelector('.files-list').scrollLeft === 0)
  await page.waitForFunction(() => document.querySelector('.files-list').dataset.more === 'end')
  await page.locator('.file [role="tab"]').first().click()
  await frames()
  assert.ok(await sight())
})
