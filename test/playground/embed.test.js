// The playground embedded in another page; the server, the page and the helpers in page.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { browser, page, origin, errors, chimeLeft, wholeLevels, frames, poll, scriptOf } from './page.js'

// From before the playground moved to playground/: a link shared then (playground.html, editor.html) opens it there, its
// query and its hash along (a script's #code=…); the embed loaded from where it was (embed.js, as audio.js.org/embed.js
// loads it) is the playground's own, its frame the playground's
test('editor: links and the embed from before the playground moved open it at playground/', async () => {
  for (const [old, now] of [['/playground.html?panel=none#x', '/playground/?panel=none#x'], ['/editor.html#x', '/playground/#x']]) {
    await page.goto(origin + old)
    await page.waitForURL(url => url.pathname === '/playground/')
    assert.equal(page.url().slice(origin.length), now)
  }
  await page.goto(origin + '/blank.html')
  const frame = await page.evaluate(async () => {
    await import('/embed.js')
    const el = Object.assign(document.createElement('audio-repl'), { textContent: "audio('chime.wav')" })
    document.body.append(el)
    const found = () => el.querySelector('iframe') ?? el.shadowRoot?.querySelector('iframe')
    for (let i = 0; i < 100 && !found(); i++) await new Promise(r => setTimeout(r, 50))
    return found() && new URL(found().src).pathname
  })
  assert.equal(frame, '/playground/')
})

// Embedded in another page (embed.js, <audio-repl>): the element's text becomes the frame's link; the frame runs that
// script alone, its panel as asked, the tabs and the panels' tabs gone, and reads nothing from the browser nor writes to
// it, so an editor open in another tab keeps its tabs and is not asked to step aside
test('editor: embedded, another page\'s script runs alone, its panel as asked, nothing of the editor\'s touched', async () => {
  await page.goto(origin + '/playground/')
  await wholeLevels().waitFor()
  // the element, in a page of its own: its text in the frame's link; the editor's tabs as it left them
  await page.goto(origin + '/blank.html')
  // the editor's last write lands as it goes, in its own process (its COOP page left for one without): what it kept is
  // what stays a while
  let kept = null
  for (let was; kept == null || kept !== was; await page.waitForTimeout(300)) { was = kept; kept = await page.evaluate(() => localStorage.getItem('audio-repl')) }
  assert.ok(kept)
  const src = await page.evaluate(async () => {
    await import('/playground/embed.js')
    // as a page writes it: the whole of it indented with the page's markup, which comes off
    document.body.innerHTML = `<audio-repl panel="edits" height="300"><pre><code>
      audio('handpan.wav')
        .gain(-6)
    </code></pre></audio-repl>`
    const frame = await new Promise(r => { const t = setInterval(() => { const f = document.querySelector('audio-repl iframe'); if (f) { clearInterval(t); r(f) } }, 20) })
    return frame.getAttribute('src')
  })
  const url = new URL(src, origin)
  assert.equal(url.pathname, '/playground/')
  assert.deepEqual([...url.searchParams], [['embed', ''], ['ui', JSON.stringify({ panel: 'edits' })]])
  const script = await page.evaluate(async hash => {
    const bytes = Uint8Array.from(atob(hash.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0))
    return new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).text()
  }, url.hash.slice('#code='.length))
  assert.equal(script, `audio('handpan.wav')\n  .gain(-6)`)
  // the frame's page: that script, its edits open, no tabs, the way to the whole editor carrying the script
  await page.goto(url.href)
  await page.locator('.step', { hasText: 'Gain' }).waitFor()
  // CodeMirror, which comes once the page shows
  await page.locator('.cm-content').waitFor({ state: 'attached' })
  assert.equal(await page.evaluate(() => scriptText()), script)
  assert.equal(await page.evaluate(() => document.documentElement.classList.contains('embed')), true)
  assert.equal(await page.locator('.panes').getAttribute('data-side'), 'open')
  assert.equal(await page.locator('.stack').isVisible(), true)
  assert.equal(await page.locator('.files').isVisible(), false)
  assert.equal(await page.locator('.side-head').isVisible(), false)
  // its lines wrap to the panel, none hidden past its edge
  assert.equal(await page.locator('.cm-content.cm-lineWrapping').count(), 1)
  await page.waitForFunction(() => document.querySelector('.embed-open')?.getAttribute('href')?.includes('#code='))
  // past the 500 ms an editor keeps its script after (later): nothing written
  await page.waitForTimeout(700)
  assert.equal(await page.evaluate(() => localStorage.getItem('audio-repl')), kept)
  assert.equal(await page.evaluate(() => document.querySelector('dialog.elsewhere').open), false)
  // a reload runs the link again: it is all the frame has
  await page.reload()
  await page.locator('.step', { hasText: 'Gain' }).waitFor()
  await page.locator('.cm-content').waitFor({ state: 'attached' })
  assert.equal(await page.evaluate(() => scriptText()), script)
  // two frames beside an editor open in another tab of the same browser: none asks another to step aside, and the
  // editor's tabs stay as they were
  const context = await browser.newContext(), open = async href => {
    const p = await context.newPage()
    await chimeLeft(p)
    p.on('pageerror', error => errors.push(error.message))
    p.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()) })
    await p.addInitScript(() => { globalThis.scriptText = () => [...document.querySelectorAll('.cm-content .cm-line')].map(l => l.textContent).join('\n') })
    await p.goto(href)
    return p
  }
  try {
    const editor = await open(origin + '/playground/')
    await editor.locator('.readout[data-of="all"]').waitFor()
    // past the 500 ms it keeps its script after (later): what it keeps, written
    await editor.waitForTimeout(700)
    const tabs = await editor.evaluate(() => localStorage.getItem('audio-repl'))
    // the whole editor's lines run on, scrolled, as a code editor's do
    assert.equal(await editor.locator('.cm-content.cm-lineWrapping').count(), 0)
    const frames = [await open(url.href), await open(url.href)]
    for (const f of frames) await f.locator('.step', { hasText: 'Gain' }).waitFor()
    // past the 1.5 s an editor waits for the one open to let go before it asks (keep.js own)
    await editor.waitForTimeout(2500)
    for (const p of [editor, ...frames]) assert.equal(await p.evaluate(() => document.querySelector('dialog.elsewhere').open), false)
    assert.equal(await editor.evaluate(() => localStorage.getItem('audio-repl')), tabs)
    // no link, or one that does not read: an empty tab, its ways in, as a first visit's; no panel asked for, none
    await frames[0].goto(origin + '/playground/?embed&panel=none#code=@@')
    await frames[0].locator('.empty').waitFor()
    assert.equal(await frames[0].locator('.panes').getAttribute('data-side'), 'none')
  } finally { await context.close() }
  assert.deepEqual(errors, [])
})

// Embedded with the parts the page names and edits a press away (embed.js controls, ops, background): the parts named
// there and no others, record's slot gone with it; the readout reading the level named; after the history one button,
// a menu of the edits, each with its icon, none the library has left out; one picked, its call written with its own
// arguments, as the menus write theirs, the sound made by it; undone, as it was; over the picture the sound's name, a
// menu of its ways in, a sample taken in its place; a file opened in its place, the result saved; no slab where the
// page asks for its own ground
// How far time zooms and scrolls past the sound's end, as the page asks (ui zoom and overshoot, playground/README.md): a
// hero's picture, zoomed out no further than the sound, scrolled never past its end, zoomed in no closer than 0.1 s
test('editor: embedded, the page sets how far time zooms and how far past the end it scrolls', async () => {
  await page.route('**/playground/editor.js', async route => { const r = await route.fetch(); route.fulfill({ response: r, body: (await r.text()).replace('v = view(', 'v = globalThis.__view = view(') }) })
  await page.goto(origin + '/blank.html')
  const src = await page.evaluate(async () => {
    await import('/playground/embed.js')
    document.body.innerHTML = `<audio-repl panel="none" ui='{"zoom":{"in":4410,"out":1},"overshoot":0}'><pre><code>audio('chime.wav')</code></pre></audio-repl>`
    return new Promise(r => { const t = setInterval(() => { const f = document.querySelector('audio-repl iframe'); if (f) { clearInterval(t); r(f.getAttribute('src')) } }, 20) })
  })
  await page.goto(new URL(src, origin).href)
  await wholeLevels().waitFor()
  const range = () => page.evaluate(() => __view.range), box = await page.locator('.plot').boundingBox()
  const fit = await range()
  await page.locator('.plot').focus()
  await page.keyboard.press('-')
  await frames()
  assert.deepEqual(await range(), fit, 'zoomed out: the sound across the view, no further')
  for (let i = 0; i < 10; i++) await page.keyboard.press('=')
  await frames()
  const [a, b] = await range()
  assert.ok(Math.abs(b - a - .1) < 1e-6, `zoomed in: 0.1 s across at the closest, ${b - a}`)
  // scrolled on and on: the sound's end no further left than the lanes' end (their 0.9 of the view, at least)
  await page.mouse.move(box.x + box.width / 2, box.y + 40)
  for (let i = 0; i < 40; i++) await page.mouse.wheel(4000, 0)
  await poll(range, ([p, q]) => assert.ok(p > 7.5 && p + (q - p) * .9 <= 8, `scrolled to the end, not past it: ${p}–${q}`))
})

test('editor: embedded, the parts the page names, its edits a press away, its files in and out', async () => {
  await page.goto(origin + '/blank.html')
  const src = await page.evaluate(async () => {
    await import('/playground/embed.js')
    document.body.innerHTML = `<audio-repl panel="none" controls="sound play  history open save loudness rate view link" ops="stretch(1.25) fade(1, 1) reverse nosuch" background="page"><pre><code>audio('chime.wav')</code></pre></audio-repl>`
    const frame = await new Promise(r => { const t = setInterval(() => { const f = document.querySelector('audio-repl iframe'); if (f) { clearInterval(t); r(f) } }, 20) })
    return frame.getAttribute('src')
  })
  const url = new URL(src, origin)
  // one JSON of it all, the page's ground read off the page (blank.html paints none: the page's own, white)
  assert.deepEqual([...url.searchParams.keys()], ['embed', 'ui'])
  assert.deepEqual(JSON.parse(url.searchParams.get('ui')), { panel: 'none', background: 'white', controls: ['sound', 'play', 'history', 'open', 'save', 'loudness', 'rate', 'view', 'link'], ops: ['stretch(1.25)', 'fade(1, 1)', 'reverse', 'nosuch'] })
  // the page told how its mark moves (a mark event on the element): at rest once the sound is in, playing as it plays
  await page.evaluate(() => { window.moods = []; document.querySelector('audio-repl').addEventListener('mark', e => e.detail.mode && moods.push(e.detail.mode)) })
  await page.waitForFunction(() => moods.at(-1) === 'rest', null, { timeout: 30000 })
  await page.frameLocator('audio-repl iframe').locator('.play').click()
  await page.waitForFunction(() => moods.at(-1) === 'play', null, { timeout: 10000 })
  await page.frameLocator('audio-repl iframe').locator('.play').click()
  // a press on the page around it closes what is open in it, its menus and its lists, as a press in it would
  const inside = page.frameLocator('audio-repl iframe')
  for (const [opener, open] of [['.embed-sound', '.menubar-menu'], ['.embed-ops', '.menubar-menu'], ['.fact[popovertarget="rate-menu"]', '#rate-menu:popover-open']]) {
    await inside.locator(opener).click()
    await inside.locator(open).waitFor()
    await page.mouse.click(2, 2)
    await inside.locator(open).waitFor({ state: 'detached' })
  }
  await page.goto(url.href)
  await wholeLevels().waitFor()
  const length = text => page.waitForFunction(text => document.querySelector('.clock .length')?.textContent.includes(text), text)
  await length('0:08.000')
  const shown = sel => page.locator(sel).first().isVisible()
  for (const part of ['.embed-sound', '.play', '.history', '.embed-open-file', '.embed-save', '.readout', '.fact[popovertarget="rate-menu"]', '.embed-view', '.embed-open', '.embed-ops']) assert.equal(await shown(`.panes ${part}`), true, part)
  for (const part of ['.record', '.deck-slot:has(.record)', '.loop', '.clock', '.message', '.before', '.fact[popovertarget="channels-menu"]', '.embed-name', '.lane-look']) assert.equal(await shown(`.panes ${part}`), false, part)
  // on the page's ground, no slab's edge to keep off: the play button under the sound's name
  const lefts = await page.evaluate(() => ['.play .play-icon', '.embed-sound svg'].map(s => document.querySelector(`.panes ${s}`).getBoundingClientRect().left))
  assert.ok(Math.abs(lefts[0] - lefts[1]) < 3, `play at ${lefts[0]}, the sound's icon at ${lefts[1]}`)
  // the level as the facts beside it are: its value and its unit apart, in their colour
  assert.match(await page.locator('.panes .readout').textContent(), /^−\d+\.\dLUFS$/)
  assert.equal(...await page.evaluate(() => ['.readout', '.facts'].map(s => getComputedStyle(document.querySelector(`.panes ${s}`)).color)))
  // the view, a switch among the facts, the look's icon: pressed, the other picture, its icon
  const look = () => page.locator('.lane-look').last().getAttribute('aria-label')
  assert.deepEqual([await page.locator('.embed-view').getAttribute('aria-label'), await look()], ['Waveform', 'Waveform'])
  await page.locator('.embed-view').click()
  await page.waitForFunction(() => document.querySelector('.embed-view').ariaLabel === 'Spectrogram')
  await page.waitForFunction(() => [...document.querySelectorAll('.lane-look')].at(-1)?.getAttribute('aria-label') === 'Spectrogram', null, { timeout: 5000 })
  assert.equal(await page.locator('.embed-view path').getAttribute('d'), await page.locator('.lane-look path').last().getAttribute('d'))
  await page.locator('.embed-view').click()
  await page.waitForFunction(() => document.querySelector('.embed-view').ariaLabel === 'Waveform')
  // on the page's ground, the slab's gradient gone (its edges, masked, fade into whatever is under them)
  assert.deepEqual(await page.evaluate(() => [getComputedStyle(document.querySelector('.panes')).backgroundColor, getComputedStyle(document.querySelector('.panes')).backgroundImage]), ['rgb(255, 255, 255)', 'none'])
  // the edits after the history, in the bar
  assert.equal(await page.evaluate(() => document.querySelector('.status .history').nextElementSibling?.classList.contains('embed-ops')), true)
  const menu = () => page.locator('.menubar-menu .menu-row')
  await page.locator('.embed-ops').click()
  assert.deepEqual(await menu().locator('.menu-label').allTextContents(), ['Stretch', 'Fade', 'Reverse'])
  // each its values at the right, in the units its settings read in
  assert.deepEqual(await menu().locator('.menu-keys').allTextContents(), ['1.25×', '1s · 1s', ''])
  assert.equal(await menu().locator('.menu-check svg').count(), 3)
  // a line under each on what it does
  assert.deepEqual(await menu().locator('.menu-about').allTextContents(), ['Longer or shorter, same pitch', 'Fade in and out', 'Play backwards'])
  await menu().filter({ hasText: 'Stretch' }).click()
  await length('0:10.000')
  assert.equal(scriptOf(await page.evaluate(() => scriptText())), scriptOf(`audio('chime.wav').stretch(1.25)`))
  // made: counted by the plus; in the menu first, checked, the others after it; pressed again, taken away
  assert.deepEqual([await page.locator('.embed-ops').getAttribute('aria-label'), await page.locator('.embed-ops span').textContent()], ['Edits, 1 made', '1'])
  await page.locator('.embed-ops').click()
  assert.deepEqual(await menu().evaluateAll(rows => rows.map(r => [r.querySelector('.menu-label').textContent, r.getAttribute('aria-checked')])), [['Stretch', 'true'], ['Fade', null], ['Reverse', null]])
  await menu().filter({ hasText: 'Stretch' }).click()
  await length('0:08.000')
  assert.equal(scriptOf(await page.evaluate(() => scriptText())), scriptOf(`audio('chime.wav')`))
  assert.deepEqual([await page.locator('.embed-ops').getAttribute('aria-label'), await page.locator('.embed-ops span').count()], ['Add an edit', 0])
  // taken away as any edit is, undone as one: back, then gone again
  await page.locator('.history .undo').click()
  await length('0:10.000')
  await page.locator('.history .undo').click()
  await length('0:08.000')
  assert.equal(scriptOf(await page.evaluate(() => scriptText())), scriptOf(`audio('chime.wav')`))
  // the sound's name over the picture; pressed, its ways in: a file, a take, the samples; one picked, in its place
  assert.equal(await page.locator('.embed-sound-name').textContent(), 'chime.wav')
  await page.locator('.embed-sound').click()
  const ways = await menu().locator('.menu-label').allTextContents()
  assert.deepEqual(ways.slice(0, 2), ['Open a file…', 'Record'])
  assert.ok(ways.includes('handpan.wav'), ways.join(', '))
  await menu().filter({ hasText: 'handpan.wav' }).click()
  await page.waitForFunction(() => document.querySelector('.embed-sound-name')?.textContent === 'handpan.wav')
  assert.equal(scriptOf(await page.evaluate(() => scriptText())), scriptOf(`audio('handpan.wav')`))
  // saved: the format picked from its menu, the result as the export saves it; opened: a file of the reader's in its place
  await page.locator('.embed-save').click()
  assert.deepEqual(await menu().locator('.menu-label').allTextContents(), ['WAV', 'FLAC', 'MP3', 'OGG', 'AIFF'])
  const [saved] = await Promise.all([page.waitForEvent('download'), menu().filter({ hasText: 'FLAC' }).click()])
  assert.match(saved.suggestedFilename(), /\.flac$/)
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.locator('.embed-open-file').click()])
  await chooser.setFiles(fileURLToPath(new URL('../fixture.wav', import.meta.url)))
  await page.waitForFunction(() => document.querySelector('.cm-content')?.textContent.includes('fixture.wav'))
  // no controls asked for: the parts as ever, the files' buttons not among them; no ops, no row of them
  await page.goto(origin + '/playground/?embed&panel=none' + url.hash)
  await wholeLevels().waitFor()
  assert.equal(await page.locator('.embed-ops').count(), 0)
  for (const part of ['.record', '.loop', '.before', '.embed-name']) assert.equal(await shown(`.panes ${part}`), true, part)
  for (const part of ['.embed-sound', '.embed-open-file', '.embed-save', '.embed-view']) assert.equal(await shown(`.panes ${part}`), false, part)
  assert.equal(await shown('.panes .lane-look'), true, 'the look, where no list names the parts')
  assert.notEqual(await page.evaluate(() => getComputedStyle(document.querySelector('.panes')).backgroundImage), 'none')
  // the lanes fill the picture: no room kept under them for a new track, as the whole editor keeps
  const gap = () => page.evaluate(() => document.querySelector('.plot').getBoundingClientRect().bottom - document.querySelector('.lane-look').getBoundingClientRect().bottom)
  assert.ok(await gap() < 40, `embedded, the lanes reach the picture's foot (${await gap()} px short)`)
  const ruled = await gap()
  // no ruler asked for: no time row, the lanes reaching on into its place, and no time for the playhead on it
  await page.goto(origin + '/playground/?embed&ui=' + encodeURIComponent(JSON.stringify({ panel: 'none', controls: ['play', 'clock', 'look'] })) + url.hash)
  await length('0:08.000')
  assert.ok(await gap() < ruled - 15, `no time row: the lanes ${ruled - await gap()} px further down`)
  await page.locator('.play').click()
  await page.waitForFunction(() => document.querySelector('.play')?.getAttribute('aria-label') === 'Pause')
  await frames()
  assert.equal(await page.locator('.playhead .when').isVisible(), false)
  await page.locator('.play').click()
  // the whole editor keeps its room under the lanes
  await page.goto(origin + '/playground/' + url.hash)
  await wholeLevels().waitFor()
  assert.ok(await gap() > 80, `whole, the room under the lanes kept (${await gap()} px)`)
  // a sound by its path from the site's root, as the page around it names its own files: opened, not asked for
  const rooted = await page.evaluate(async () => {
    await import('/playground/embed.js')
    document.body.innerHTML = `<audio-repl panel="none"><pre><code>audio('/test/fixture.wav')</code></pre></audio-repl>`
    const frame = await new Promise(r => { const t = setInterval(() => { const f = document.querySelector('audio-repl iframe'); if (f) { clearInterval(t); r(f) } }, 20) })
    return frame.getAttribute('src')
  })
  await page.goto(new URL(rooted, origin).href)
  await wholeLevels().waitFor()
  assert.equal(await page.locator('.message').textContent().then(t => /not open here/.test(t)), false)
  assert.equal(await page.locator('.panes .text-button', { hasText: 'Open it' }).count(), 0)
  // two slashes are another host's, not a path of this site: asked for as a file, never fetched
  const fetched = []
  page.on('request', r => r.url().includes('elsewhere.example') && fetched.push(r.url()))
  await page.goto(origin + '/blank.html')
  const other = await page.evaluate(async () => {
    await import('/playground/embed.js')
    document.body.innerHTML = `<audio-repl panel="none"><pre><code>audio('//elsewhere.example/x.wav')</code></pre></audio-repl>`
    const frame = await new Promise(r => { const t = setInterval(() => { const f = document.querySelector('audio-repl iframe'); if (f) { clearInterval(t); r(f) } }, 20) })
    return frame.getAttribute('src')
  })
  await page.goto(new URL(other, origin).href)
  await page.locator('.panes .text-button', { hasText: 'Open it' }).waitFor()
  assert.deepEqual(fetched, [])
  assert.deepEqual(errors, [])
})

// The embed before its frame shows: a skeleton of the playground's parts where they will be, laid out from the
// element's size and its panel, its text out of sight; gone once the frame's sound is in
test('editor: embedded, a skeleton of its parts holds their places till its sound is in', async () => {
  await page.goto(origin + '/blank.html')
  // the frames held back till the skeletons are read
  let release
  const held = new Promise(r => release = r)
  await page.route('**/playground/?embed*', async route => { await held; await route.continue() })
  await page.evaluate(async () => {
    await import('/playground/embed.js')
    document.body.innerHTML = `<audio-repl panel="none" height="320" style="width: 742px"><pre><code>audio('chime.wav')</code></pre></audio-repl><audio-repl panel="code" height="420" style="width: 736px"><pre><code>audio('chime.wav')</code></pre></audio-repl>`
  })
  await page.waitForFunction(() => [...document.querySelectorAll('audio-repl .wait')].every(w => w.childElementCount))
  // the picture alone, or with its panel beside it; every part inside the element; the text not shown
  const look = await page.evaluate(() => [...document.querySelectorAll('audio-repl')].map(el => {
    const box = el.getBoundingClientRect(), parts = [...el.querySelectorAll('.wait i')].map(i => i.getBoundingClientRect())
    return { text: getComputedStyle(el.querySelector('pre')).display, parts: parts.length, areas: el.querySelectorAll('.wait i.area').length, inside: parts.every(b => b.width > 0 && b.height > 0 && b.left >= box.left && b.right <= box.right && b.top >= box.top && b.bottom <= box.bottom) }
  }))
  assert.deepEqual(look, [{ text: 'none', parts: 7, areas: 1, inside: true }, { text: 'none', parts: 8, areas: 2, inside: true }])
  release()
  await page.waitForFunction(() => [...document.querySelectorAll('audio-repl')].every(el => 'ready' in el.dataset && !el.querySelector('.wait')), null, { timeout: 30000 })
  await page.unroute('**/playground/?embed*')
})

// ── Guards for what was caught by eye ──────────────────────────
