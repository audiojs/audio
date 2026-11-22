// The repl embedded in another page; the server, the page and the helpers in page.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { browser, page, origin, errors, chimeLeft, wholeLevels, frames, poll, scriptOf, wavBytes, RATE, open, write, lengthIs } from './page.js'

// From before the repl moved to repl/: a link shared then (playground.html, editor.html, playground/) opens it there,
// its query and its hash along (a script's #code=…); the embed loaded from where it was (embed.js, as
// audio.js.org/embed.js loads it, and playground/embed.js) is the repl's own, its frame the repl's
test('editor: links and the embed from before the repl moved open it at repl/', async () => {
  for (const [old, now] of [['/playground.html?panel=none#x', '/repl/?panel=none#x'], ['/editor.html#x', '/repl/#x'], ['/playground/?ui=%7B%7D#x', '/repl/?ui=%7B%7D#x']]) {
    await page.goto(origin + old)
    await page.waitForURL(url => url.pathname === '/repl/')
    assert.equal(page.url().slice(origin.length), now)
  }
  for (const from of ['/embed.js', '/playground/embed.js']) {
    await page.goto(origin + '/blank.html')
    const frame = await page.evaluate(async from => {
      await import(from)
      const el = Object.assign(document.createElement('audio-repl'), { textContent: "audio('chime.wav')" })
      document.body.append(el)
      const found = () => el.querySelector('iframe') ?? el.shadowRoot?.querySelector('iframe')
      for (let i = 0; i < 100 && !found(); i++) await new Promise(r => setTimeout(r, 50))
      return found() && new URL(found().src).pathname
    }, from)
    assert.equal(frame, '/repl/', from)
  }
})

// Embedded in another page (embed.js, <audio-repl>): the element's text becomes the frame's link; the frame runs that
// script alone, its panel as asked, the tabs and the panels' tabs gone, and reads nothing from the browser nor writes to
// it, so an editor open in another tab keeps its tabs and is not asked to step aside
test('editor: embedded, another page\'s script runs alone, its panel as asked, nothing of the editor\'s touched', async () => {
  await page.goto(origin + '/repl/')
  await wholeLevels().waitFor()
  // the element, in a page of its own: its text in the frame's link; the editor's tabs as it left them
  await page.goto(origin + '/blank.html')
  // the editor's last write lands as it goes, in its own process (its COOP page left for one without): what it kept is
  // what stays a while
  let kept = null
  for (let was; kept == null || kept !== was; await page.waitForTimeout(300)) { was = kept; kept = await page.evaluate(() => localStorage.getItem('audio-repl')) }
  assert.ok(kept)
  const src = await page.evaluate(async () => {
    await import('/repl/embed.js')
    // as a page writes it: the whole of it indented with the page's markup, which comes off
    document.body.innerHTML = `<audio-repl panel="edits" height="300"><pre><code>
      audio('handpan.wav')
        .gain(-6)
    </code></pre></audio-repl>`
    const frame = await new Promise(r => { const t = setInterval(() => { const f = document.querySelector('audio-repl iframe'); if (f) { clearInterval(t); r(f) } }, 20) })
    return frame.getAttribute('src')
  })
  const url = new URL(src, origin)
  assert.equal(url.pathname, '/repl/')
  assert.deepEqual([...url.searchParams], [['embed', ''], ['ui', JSON.stringify({ panel: 'edits' })]])
  // a link's script, deflated, base64url; the frame's, as its way to the whole editor carries it
  const unpack = hash => page.evaluate(async hash => {
    const bytes = Uint8Array.from(atob(hash.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0))
    return new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).text()
  }, hash.slice('#code='.length))
  const linked = async () => {
    await page.waitForFunction(() => document.querySelector('.embed-open')?.getAttribute('href')?.includes('#code='))
    return unpack(new URL(await page.locator('.embed-open').getAttribute('href'), origin).hash)
  }
  const script = await unpack(url.hash)
  assert.equal(script, `audio('handpan.wav')\n  .gain(-6)`)
  // the frame's page: that script, its edits open, no tabs, the way to the whole editor carrying the script
  await page.goto(url.href)
  await page.locator('.step', { hasText: 'Gain' }).waitFor()
  assert.equal(await linked(), script)
  assert.equal(await page.evaluate(() => document.documentElement.classList.contains('embed')), true)
  assert.equal(await page.locator('.panes').getAttribute('data-side'), 'open')
  assert.equal(await page.locator('.stack').isVisible(), true)
  assert.equal(await page.locator('.files').isVisible(), false)
  assert.equal(await page.locator('.side-head').isVisible(), false)
  // no code pane to show it in: no CodeMirror
  assert.equal(await page.locator('.cm-content').count(), 0)
  // past the 500 ms an editor keeps its script after (later): nothing written
  await page.waitForTimeout(700)
  assert.equal(await page.evaluate(() => localStorage.getItem('audio-repl')), kept)
  assert.equal(await page.evaluate(() => document.querySelector('dialog.elsewhere').open), false)
  // a reload runs the link again: it is all the frame has
  await page.reload()
  await page.locator('.step', { hasText: 'Gain' }).waitFor()
  assert.equal(await linked(), script)
  // its code pane asked for: CodeMirror, which comes once the page shows, its lines wrapping to the panel, none hidden
  // past its edge
  await page.goto(origin + '/repl/?embed&panel=code' + url.hash)
  await page.locator('.cm-content.cm-lineWrapping').waitFor({ state: 'attached' })
  assert.equal(await page.evaluate(() => scriptText()), script)
  assert.equal(await page.evaluate(() => localStorage.getItem('audio-repl')), kept)
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
    const editor = await open(origin + '/repl/')
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
    await frames[0].goto(origin + '/repl/?embed&panel=none#code=@@')
    await frames[0].locator('.plot[data-empty]').waitFor()
    assert.equal(await frames[0].locator('.panes').getAttribute('data-side'), 'none')
  } finally { await context.close() }
  assert.deepEqual(errors, [])
})

// Embedded with the parts the page names and edits a press away (embed.js controls, ops, background): the parts named
// there and no others, record's slot gone with it; the readout reading the level named; after the loop one button,
// a menu of the edits, each with its icon, none the library has left out; one picked, its call written with its own
// arguments, as the menus write theirs, the sound made by it; undone, as it was; over the picture the sound's name, a
// menu of its ways in, a sample taken in its place; a file opened in its place, the result saved; no slab where the
// page asks for its own ground
// How far time zooms and scrolls past the sound's end, as the page asks (ui zoom and overshoot, repl/README.md): a
// hero's picture, zoomed out no further than the sound, scrolled never past its end, zoomed in no closer than 0.1 s
test('editor: embedded, the page sets how far time zooms and how far past the end it scrolls', async () => {
  await page.route('**/repl/editor.js', async route => { const r = await route.fetch(); route.fulfill({ response: r, body: (await r.text()).replace('v = view(', 'v = globalThis.__view = view(') }) })
  await page.goto(origin + '/blank.html')
  const src = await page.evaluate(async () => {
    await import('/repl/embed.js')
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

// Framed in a page that scrolls, as it comes (?ui= wheel across): a wheel up or down over the picture is the page's,
// zoomed in or not, the picture staying; one across is the picture's, and a zoom
test('editor: embedded, a wheel up or down scrolls the page around it, one across the picture', async () => {
  await page.route('**/repl/editor.js', async route => { const r = await route.fetch(); route.fulfill({ response: r, body: (await r.text()).replace('v = view(', 'v = globalThis.__view = view(') }) })
  await page.goto(origin + '/blank.html')
  await page.evaluate(async () => {
    await import('/repl/embed.js')
    document.body.innerHTML = `<audio-repl panel="none"><pre><code>audio('chime.wav')</code></pre></audio-repl><div style="height: 3000px"></div>`
  })
  const frame = page.frameLocator('audio-repl iframe'), plot = frame.locator('.plot')
  await frame.locator('.clock .length', { hasText: '0:08.000' }).waitFor()
  const range = () => plot.evaluate(() => __view.range), scrolled = () => page.evaluate(() => scrollY)
  const box = await page.locator('audio-repl').boundingBox(), whole = await range()
  assert.equal(await plot.evaluate(el => getComputedStyle(el).touchAction), 'pan-y', 'a finger up or down is the page\'s too')
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.wheel(0, 200)
  await poll(scrolled, y => assert.ok(y > 100, `the sound whole in the picture, the page scrolls: ${y}`))
  assert.deepEqual(await range(), whole, 'and the picture stays')
  await page.mouse.wheel(0, -200)
  await poll(scrolled, y => assert.equal(y, 0))
  // zoomed in: still the page's, the view where it was
  await plot.focus()
  for (let i = 0; i < 4; i++) await page.keyboard.press('=')
  await frames()
  const [a, b] = await range()
  assert.ok(b - a < whole[1] - whole[0], `zoomed in: ${a}–${b}`)
  await page.mouse.wheel(0, 200)
  await poll(scrolled, y => assert.ok(y > 100, `zoomed in, the page scrolls: ${y}`))
  assert.deepEqual(await range(), [a, b], 'and the view stays')
  await page.mouse.wheel(0, -200)
  await poll(scrolled, y => assert.equal(y, 0))
  const taken = delta => plot.evaluate((el, delta) => { const r = el.getBoundingClientRect(), e = new WheelEvent('wheel', { ...delta, clientX: r.x + r.width / 2, clientY: r.y + r.height / 2, bubbles: true, cancelable: true }); el.dispatchEvent(e); return e.defaultPrevented }, delta)
  assert.equal(await taken({ deltaY: 50 }), false, 'up or down: left to the page')
  assert.equal(await taken({ deltaX: 50 }), true, 'across: the picture\'s')
  await poll(range, ([p]) => assert.ok(p > a, `time scrolled on: ${p} from ${a}`))
  assert.equal(await taken({ deltaY: 50, ctrlKey: true }), true, 'a zoom: the picture\'s')
  assert.deepEqual(errors, [])
})

// Asked for both ways (?ui= wheel both): a wheel up or down over a picture with no time to scroll through (the sound
// whole in it) scrolls the page on under the pointer, the picture staying; zoomed in, it scrolls time and the page
// stays, till the view is at the sound's end, and from there the page again. A wheel across is the picture's always
test('editor: embedded, the wheel both ways: up or down scrolls time where there is time, else the page', async () => {
  await page.route('**/repl/editor.js', async route => { const r = await route.fetch(); route.fulfill({ response: r, body: (await r.text()).replace('v = view(', 'v = globalThis.__view = view(') }) })
  await page.goto(origin + '/blank.html')
  await page.evaluate(async () => {
    await import('/repl/embed.js')
    document.body.innerHTML = `<audio-repl panel="none" ui='{"wheel":"both"}'><pre><code>audio('chime.wav')</code></pre></audio-repl><div style="height: 3000px"></div>`
  })
  const frame = page.frameLocator('audio-repl iframe'), plot = frame.locator('.plot')
  await frame.locator('.clock .length', { hasText: '0:08.000' }).waitFor()
  const range = () => plot.evaluate(() => __view.range), scrolled = () => page.evaluate(() => scrollY)
  const box = await page.locator('audio-repl').boundingBox(), whole = await range()
  assert.equal(await plot.evaluate(el => getComputedStyle(el).touchAction), 'none')
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.wheel(0, 200)
  await poll(scrolled, y => assert.ok(y > 100, `the sound whole in the picture, the page scrolls: ${y}`))
  assert.deepEqual(await range(), whole, 'and the picture stays')
  await page.mouse.wheel(0, -200)
  await poll(scrolled, y => assert.equal(y, 0))
  // zoomed in: the wheel scrolls time, the page staying
  await plot.focus()
  for (let i = 0; i < 4; i++) await page.keyboard.press('=')
  await frames()
  const [a, b] = await range()
  assert.ok(b - a < whole[1] - whole[0], `zoomed in: ${a}–${b}`)
  await page.mouse.wheel(0, 100)
  await poll(range, ([p]) => assert.ok(p > a, `time scrolled on: ${p} from ${a}`))
  assert.equal(await scrolled(), 0, 'the page where it was')
  // on and on: the view at the sound's end, then the page
  for (let i = 0; i < 60; i++) await page.mouse.wheel(0, 4000)
  await poll(scrolled, y => assert.ok(y > 100, `at the sound's end the page scrolls on: ${y}`))
  const taken = delta => plot.evaluate((el, delta) => { const r = el.getBoundingClientRect(), e = new WheelEvent('wheel', { ...delta, clientX: r.x + r.width / 2, clientY: r.y + r.height / 2, bubbles: true, cancelable: true }); el.dispatchEvent(e); return e.defaultPrevented }, delta)
  assert.equal(await taken({ deltaY: 50 }), false, 'on down at the end: left to the page')
  assert.equal(await taken({ deltaX: 50 }), true, 'across at the end: the picture\'s still')
  assert.equal(await taken({ deltaY: -50 }), true, 'back up: time again')
  assert.deepEqual(errors, [])
})

// A page's figure (?ui= grid paper, axis false, font sans, inset; a background): the picture the frame's whole width,
// no scale at its right, on squared paper finer than the lines the ticks give; its words in the display face and one
// ink, the time's; the sound's name, the way to the repl and the bar standing in from the frame's sides as far as asked,
// the first mark of each on that line; the bar's small words on the time's baseline. The skeleton before it, the same
test('editor: embedded, a page\'s figure: squared paper the frame\'s width, its words the page\'s, in from its sides', async () => {
  await page.goto(origin + '/blank.html')
  let release
  const held = new Promise(r => release = r)
  await page.route('**/repl/?embed*', async route => { await held; await route.continue() })
  await page.evaluate(async () => {
    await import('/repl/embed.js')
    document.body.style.margin = '0'
    const at = (ui, more = '') => `<audio-repl panel="none" height="320" background="rgb(40, 40, 40)" controls="sound play clock history loudness rate channels link" ui='${JSON.stringify(ui)}'${more}><pre><code>audio('chime.wav')</code></pre></audio-repl>`
    document.body.innerHTML = at({ grid: 'paper', axis: false, font: 'sans', inset: '5vw' }) + at({ grid: 'lines' })
  })
  // the skeleton: the name's block on the inset's line (5vw of a 1280 px window), the picture's from side to side
  await page.waitForFunction(() => [...document.querySelectorAll('audio-repl .wait')].every(w => w.childElementCount))
  const wait = await page.evaluate(() => { const el = document.querySelector('audio-repl'), x = i => i.getBoundingClientRect().x, parts = [...el.querySelectorAll('.wait i')]; return { name: x(parts[0]), area: [x(el.querySelector('.wait .area')), el.querySelector('.wait .area').getBoundingClientRect().width], width: el.clientWidth } })
  assert.deepEqual(wait, { name: wait.width * .05, area: [0, wait.width], width: wait.width })
  release()
  const [paper, lines] = [0, 1].map(i => page.frameLocator('audio-repl iframe').nth(i))
  for (const f of [paper, lines]) await f.locator('.clock .length', { hasText: '0:08.000' }).waitFor()
  await page.unroute('**/repl/?embed*')
  const read = f => f.locator('.plot').evaluate(plot => {
    const q = s => document.querySelector(s), box = e => e.getBoundingClientRect(), css = (e, p) => getComputedStyle(e)[p]
    const base = e => { const i = document.createElement('i'); i.style.cssText = 'display: inline-block; width: 0; height: 0'; e.append(i); const y = i.getBoundingClientRect().y; i.remove(); return y }
    const words = ['.embed-sound-name', '.embed-open', '.length', '.readout', '.facts .fact'].map(q)
    return {
      width: innerWidth, plot: [box(plot).x, box(plot).width], end: getComputedStyle(plot).getPropertyValue('--end').trim(),
      head: [css(q('.view-head'), 'paddingLeft'), css(q('.view-head'), 'paddingRight')], bar: css(q('.status'), 'paddingLeft'),
      marks: [box(q('.embed-sound-name')).x, box(q('.play-icon')).x, innerWidth - box(q('.embed-open svg')).right],
      faces: words.map(e => css(e, 'fontFamily').split(',')[0].replace(/"/g, '')), label: getComputedStyle(plot).getPropertyValue('--font-mono').split(',')[0].replace(/['"]/g, '').trim(),
      inks: words.map(e => css(e, 'color')), ink: css(q('.time'), 'color'),
      bases: ['.time', '.length', '.readout > span', '.facts .fact'].map(s => +base(q(s)).toFixed(2))
    }
  })
  const p = await read(paper), l = await read(lines), inset = p.width * .05
  assert.deepEqual(p.plot, [0, p.width], 'the picture from side to side')
  assert.equal(p.end, '0px', 'no scale at its right')
  assert.ok(parseFloat(l.end) > 20 && l.plot[0] === 8, `as it comes: its scale, its left margin: ${l.end}, ${l.plot}`)
  assert.deepEqual([p.head, p.bar], [[`${inset}px`, `${inset}px`], `${inset}px`], 'the name row and the bar in from the sides')
  assert.ok(p.marks.every(x => Math.abs(x - inset) <= 2), `the first mark of each row, and the last of the first, on that line: ${p.marks} for ${inset}`)
  assert.deepEqual([...new Set(p.faces), p.label], ['Geist', 'Geist'], 'one face, the display\'s')
  assert.ok(l.faces.includes('ui-monospace'), `as it comes, the mono for its name and figures: ${l.faces}`)
  assert.deepEqual([...new Set([...p.inks, ...l.inks])], [p.ink], 'on the page\'s ground, one ink: the time\'s')
  for (const b of [p.bases, l.bases]) assert.ok(b.every(y => Math.abs(y - b[0]) <= .5), `the bar's words on the time's baseline: ${b}`)
  // the paper's rects, drawn as triangles in the waveform's canvas as the picture is drawn again (the element a pixel
  // narrower): finer than the lines from the ticks alone
  const ruled = async (f, i) => {
    await f.locator('.plot').evaluate(() => {
      window.__ruled = 0
      const proto = WebGL2RenderingContext.prototype, draw = proto.__draw ??= proto.drawArrays
      proto.drawArrays = function (...a) { if (a[0] === this.TRIANGLES && this.canvas.matches('.waveform')) window.__ruled += a[2] / 6; return draw.apply(this, a) }
    })
    await page.evaluate(i => { document.querySelectorAll('audio-repl')[i].style.width = 'calc(100% - 1px)' }, i)
    await poll(() => f.locator('.plot').evaluate(() => window.__ruled), n => assert.ok(n > 0, 'ruled'))
    return f.locator('.plot').evaluate(() => window.__ruled)
  }
  const [squares, rules] = [await ruled(paper, 0), await ruled(lines, 1)]
  assert.ok(squares > rules * 1.5, `paper ruled finer than lines: ${squares} rects, ${rules}`)
  assert.deepEqual(errors, [])
})

// A figure that does not stand evenly about the page's text (a page with a bar at one side): two insets, its left
// side's and its right's, each a length that may name the page's own custom properties, given their values on the
// element as the frame loads (the frame cannot see them). The skeleton before it, the same
test('editor: embedded, a figure\'s two insets, the page\'s custom properties in them', async () => {
  await page.goto(origin + '/blank.html')
  let release
  const held = new Promise(r => release = r)
  await page.route('**/repl/?embed*', async route => { await held; await route.continue() })
  await page.evaluate(async () => {
    await import('/repl/embed.js')
    document.body.style.margin = '0'
    document.documentElement.style.setProperty('--gutter', '20px')
    const ui = { grid: 'paper', axis: false, font: 'sans', inset: ['calc(var(--gutter, 0px) + 5vw)', 'max(5vw - var(--none, 4px), 0px)'] }
    document.body.innerHTML = `<audio-repl panel="none" height="320" background="rgb(40, 40, 40)" controls="sound play clock history loudness rate channels link" ui='${JSON.stringify(ui)}'><pre><code>audio('chime.wav')</code></pre></audio-repl>`
  })
  // the skeleton: the name's block on the left inset's line (the gutter and 5vw of a 1280 px window), the facts' block
  // ending on the right one's (5vw less the fallback, 4 px)
  await page.waitForFunction(() => document.querySelector('audio-repl .wait')?.childElementCount)
  const wait = await page.evaluate(() => { const el = document.querySelector('audio-repl'), parts = [...el.querySelectorAll('.wait i')].map(i => i.getBoundingClientRect()); return { name: parts[0].x, far: el.clientWidth - Math.max(...parts.filter(p => p.width < el.clientWidth).map(p => p.right)), width: el.clientWidth } })
  assert.deepEqual([wait.name, wait.far], [20 + wait.width * .05, wait.width * .05 - 4], 'the skeleton on the two lines')
  release()
  const f = page.frameLocator('audio-repl iframe')
  await f.locator('.clock .length', { hasText: '0:08.000' }).waitFor()
  await page.unroute('**/repl/?embed*')
  // (in the frame: its src says the lengths with the page's values in them)
  const said = await page.$eval('audio-repl iframe', i => JSON.parse(new URL(i.src).searchParams.get('ui')).inset)
  assert.deepEqual(said, ['calc(20px + 5vw)', 'max(5vw - 4px, 0px)'], 'the page\'s custom properties given their values, a fallback where the page has none')
  const p = await f.locator('.plot').evaluate(plot => {
    const q = s => document.querySelector(s), box = e => e.getBoundingClientRect(), css = (e, p) => parseFloat(getComputedStyle(e)[p])
    return { width: innerWidth, plot: [box(plot).x, box(plot).width], head: [css(q('.view-head'), 'paddingLeft'), css(q('.view-head'), 'paddingRight')], bar: [css(q('.status'), 'paddingLeft'), css(q('.status'), 'paddingRight')], marks: [box(q('.embed-sound-name')).x, box(q('.play-icon')).x], last: innerWidth - box(q('.embed-open svg')).right }
  })
  const left = 20 + p.width * .05, right = p.width * .05 - 4
  assert.deepEqual(p.plot, [0, p.width], 'the picture from side to side')
  assert.deepEqual([p.head, p.bar], [[left, right], [left, right]], 'the name row and the bar in from each side as far as asked')
  assert.ok(p.marks.every(x => Math.abs(x - left) <= 2) && Math.abs(p.last - right) <= 2, `the first mark of each row on the left line, the last of the first on the right one: ${p.marks}, ${p.last} for ${left}, ${right}`)
  assert.deepEqual(errors, [])
})

// A room under the picture, as a page asks for it (ui foot: a length, the page's custom properties in it): from the
// picture's foot to the frame's, the bar's one row that tall, the picture taking the rest; the time's digits (their ink)
// midway between the grid's last line and the frame's foot, within a pixel, the strip of times under the grid counted
// in, at two heights of the frame; play on the time's line; the skeleton before it lays the bar there too
test('editor: embedded, the bar in the room the page gives under the picture, the time midway under the grid', async () => {
  await page.goto(origin + '/blank.html')
  let release
  const held = new Promise(r => release = r)
  await page.route('**/repl/?embed*', async route => { await held; await route.continue() })
  await page.evaluate(async () => {
    await import('/repl/embed.js')
    document.body.style.margin = '0'
    document.documentElement.style.setProperty('--room', '150px')
    const ui = { grid: 'paper', axis: 'inside', font: 'sans', inset: '5vw', foot: 'var(--room)' }
    document.body.innerHTML = `<audio-repl panel="none" height="480" background="rgb(40, 40, 40)" controls="sound play clock loudness rate channels" ui='${JSON.stringify(ui)}'><pre><code>audio('chime.wav')</code></pre></audio-repl>`
  })
  // the skeleton: the play block's middle midway between the grid's last line, the strip of times (26 px) over the
  // last 150 px, and the frame's foot
  await page.waitForFunction(() => document.querySelector('audio-repl .wait')?.childElementCount)
  const wait = await page.evaluate(() => { const el = document.querySelector('audio-repl'), box = el.getBoundingClientRect(), play = [...el.querySelectorAll('.wait i')].find(i => i.style.width === '24px').getBoundingClientRect(); return { mid: play.top + play.height / 2 - box.top, H: box.height } })
  assert.ok(Math.abs(wait.mid - (wait.H - (150 + 26) / 2)) <= 1, `the skeleton's play midway under the grid: ${wait.mid} of ${wait.H}`)
  release()
  const f = page.frameLocator('audio-repl iframe')
  await f.locator('.clock .length', { hasText: '0:08.000' }).waitFor()
  await page.unroute('**/repl/?embed*')
  assert.equal(await page.$eval('audio-repl iframe', i => JSON.parse(new URL(i.src).searchParams.get('ui')).foot), '150px', 'the page\'s custom property given its value')
  // (the time's digits' ink, its rows far from the bar's ground, in the frame's px)
  const inkOf = async () => {
    const box = await f.locator('.status .clock').boundingBox(), frame = await page.locator('audio-repl iframe').boundingBox(), png = await f.locator('.status .clock').screenshot()
    const [a, b] = await page.evaluate(async b64 => {
      const img = new Image()
      img.src = 'data:image/png;base64,' + b64
      await img.decode()
      const g = Object.assign(document.createElement('canvas'), { width: img.width, height: img.height }).getContext('2d')
      g.drawImage(img, 0, 0)
      const d = g.getImageData(0, 0, img.width, img.height).data, rows = []
      for (let y = 0; y < img.height; y++) for (let x = 0; x < img.width; x++) { const k = (y * img.width + x) * 4; if (Math.abs(d[k] - d[0]) + Math.abs(d[k + 1] - d[1]) + Math.abs(d[k + 2] - d[2]) > 120) { rows.push(y); break } }
      return [rows[0], rows.at(-1) + 1]
    }, png.toString('base64'))
    return box.y - frame.y + (a + b) / 2
  }
  for (const height of [480, 700]) {
    if (height !== 480) {
      await page.evaluate(h => document.querySelector('audio-repl').style.setProperty('--audio-repl-height', `${h}px`), height)
      await page.waitForFunction(h => Math.abs(document.querySelector('audio-repl iframe').getBoundingClientRect().height - h) <= 1, height)
    }
    const read = () => f.locator('body').evaluate(async () => {
      const { state } = await import('/repl/editor/context.js'), L = state.layout, box = s => document.querySelector(s).getBoundingClientRect(), status = box('.status'), play = box('.play')
      return { H: innerHeight, plot: box('.plot').bottom, grid: box('.plot').top + Math.min(L.h, Math.max(...L.rows.map(r => r.bottom))), status: [status.top, status.height], play: play.top + play.height / 2 }
    })
    const p = await poll(read, p => assert.ok(Math.abs(p.status[1] - 150) <= 1 && Math.abs(p.status[0] + p.status[1] - p.H) <= 1, `the room the frame's last 150 px: ${JSON.stringify(p)}`))
    assert.ok(p.plot <= p.status[0] + 1 && p.plot >= p.status[0] - 12, `the picture down to the room: ${p.plot} for ${p.status[0]}`)
    // (the picture's lanes follow the frame a frame after the bar's row does: read until they have, the grid's last line
    // read off a layout a frame old stood where the lower frame had it, 304 px for 524)
    const q = await poll(async () => ({ ...await read(), digits: await inkOf() }), q => assert.ok(Math.abs(q.digits - (q.grid + q.H) / 2) <= 1, `${height} px: the time's digits ${q.digits.toFixed(1)}, ${(q.digits - q.grid).toFixed(1)} under the grid and ${(q.H - q.digits).toFixed(1)} over the foot`))
    assert.ok(Math.abs(q.play - q.digits) <= 3, `play on the time's line: ${q.play} for ${q.digits}`)
  }
  assert.deepEqual(errors, [])
})

// A figure's scales lie within its sheet (axis inside), no scale apart: the lanes and the grid that rules them run
// from the frame's left edge to its right one, the grid ruling the lanes' values alone and ending on the last lane's
// foot, a labelled line. Under it the times stand plain in a strip as low as their line: each flush under its own
// labelled line, quieter than the values, no line or tick run down through them and no edge under them. A value over
// the lanes at the sheet's right edge, in the square under its line, the squares it stands across laid with the page's
// ground so it reads over the waveform, its line across and the one under it whole; the last lane's foot value (the
// waveform's −1) under its line as every other is, plain in the times' strip at its right end, no time written under
// it; the pointer's value read out there too. Another sound opened in the page's place is listened to, and what it is
// heard to be said where the page's word was
test('editor: embedded, a figure\'s scales within its sheet: the values over the lanes at its edge, the times plain under it', async () => {
  await page.goto(origin + '/blank.html')
  await page.evaluate(async () => {
    await import('/repl/embed.js')
    Object.assign(document.body.style, { margin: '0', background: 'rgb(40, 40, 40)' })
    document.body.innerHTML = `<audio-repl panel="none" height="420" background="page" controls="sound play clock history save loudness rate channels view" ops="trim(-40) normalize(-1) fade(1, 1) stretch(1.25) pitch(-2) reverse" ui='${JSON.stringify({ grid: 'paper', axis: 'inside', inset: '5vw', edits: 'chain', kind: 'chime', font: 'sans' })}'><pre><code>audio('chime.wav')</code></pre></audio-repl>`
  })
  const list = page.frameLocator('audio-repl iframe')
  await list.locator('.clock .length', { hasText: '0:08.000' }).waitFor()
  await page.mouse.move(0, 0)
  // the sheet, read off what draws it over the lanes (the overlay) and the times' strip (on the reel), each line a
  // pixel wide. `runs`: the stretches lit along a line of pixels, [from, long] px; `patches`, those the overlay lays
  // opaque down the sheet's right edge over the lanes, each with whether a value is written in it (a pixel brighter
  // than the ground)
  const sheet = () => list.locator('.plot').evaluate(plot => {
    const o = plot.querySelector('canvas.overlay'), row = plot.querySelector('canvas.row'), k = o.width / o.clientWidth, W = o.clientWidth
    const data = (cv, x, y, long, down) => long > 0 ? cv.getContext('2d').getImageData(Math.round(x * k), Math.round(y * k), down ? 1 : Math.round(long * k), down ? Math.round(long * k) : 1).data : []
    const alpha = (cv, x, y, long, down) => [...data(cv, x, y, long, down)].filter((_, i) => i % 4 === 3)
    const runs = (cv, x, y, long, down = false, least = 1) => alpha(cv, x, y, long, down).reduce((out, a, i, all) => { if (a >= least && !(all[i - 1] >= least)) out.push([i / k, 0]); if (a >= least) out.at(-1)[1] += 1 / k; return out }, []).map(r => r.map(Math.round))
    // (the strip's canvas runs on over the scrollbar's strip under it, 8 px: geometry.js BAR)
    const top = Math.round(row.getBoundingClientRect().top - plot.getBoundingClientRect().top), tall = Math.round(row.getBoundingClientRect().height) - 8
    const patches = runs(o, W - 2, 0, top, true, 255).map(([y, long]) => { const d = data(o, W - 36, y + Math.round(long / 2), 36), lit = [...d].some((v, i) => i % 4 === 0 && v > 90); return [y, long, lit] })
    return {
      W, end: getComputedStyle(plot).getPropertyValue('--end').trim(), top, tall, patches,
      // the strip: across it a pixel under its top and at its foot, clear of its words; across its middle, its words
      lines: runs(row, 0, 1, W), edge: runs(row, 0, tall - 1, W), words: runs(row, 0, Math.round(tall / 2), W)
    }
  })
  const drawn = await sheet()
  assert.equal(drawn.end, '0px', 'the lanes run the frame\'s whole width')
  assert.deepEqual([drawn.lines, drawn.edge], [[], []], 'no line nor tick down the times\' strip, no edge under it')
  assert.ok(drawn.tall >= 12 && drawn.tall <= 20, `the strip as low as the times' line and a little air: ${drawn.tall} px`)
  // the values over the lanes at the right edge, each in its square on a patch of the ground one line of it tall, written
  // on it: two lanes, a channel each, their 1 and their 0 at least
  const valued = drawn.patches.filter(p => p[2])
  assert.ok(valued.length >= 4 && valued.length === drawn.patches.length && valued.every(([y]) => y < drawn.top), `a value written in each square of the ground at the right edge: ${JSON.stringify(drawn.patches)}`)
  const high = valued.map(([, long]) => long + 1)
  assert.ok(high.every(h => h >= 11 && h <= 16), `each patch one line of its value tall, no more: ${high} px`)
  // the waveform and the grid run on under them: the overlay clear down the edge but over the values
  const lanes = await list.locator('.plot').evaluate(plot => { const o = plot.querySelector('canvas.overlay'), k = o.width / o.clientWidth, d = o.getContext('2d').getImageData(o.width - Math.round(2 * k), 0, 1, o.height).data; let clear = 0; for (let i = 3; i < d.length; i += 4) if (!d[i]) clear++; return clear / k })
  assert.ok(lanes > drawn.top * .6, `the lanes seen at the frame's edge between the values: ${lanes} px of ${drawn.top}`)
  // read off the page as it is shown, rows of pixels (their red): the last lane's foot, the first lane's top (the line
  // over its 1's square, where the view lays the lane), the ground just under the foot; 3 px over the foot, the lines down; the strip's middle, its words
  const shot = await list.locator('.plot').screenshot(), mid = drawn.top + Math.round(drawn.tall / 2)
  const [footRow, topRow, under, downRow, wordRow] = await list.locator('.plot').evaluate(async (plot, [b64, rows]) => {
    const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode()
    const k = img.width / plot.clientWidth, c = Object.assign(document.createElement('canvas'), { width: img.width, height: img.height }), g = c.getContext('2d')
    g.drawImage(img, 0, 0)
    return rows.map(y => { const d = g.getImageData(0, Math.round(y * k), img.width, 1).data, v = []; for (let x = 0; x < plot.clientWidth; x++) v.push(d[Math.round(x * k) * 4]); return v })
  }, [shot.toString('base64'), [drawn.top - 1, await list.locator('body').evaluate(async () => Math.round((await import('/repl/view/geometry.js')).lanes().all[0][1])), drawn.top + 1, drawn.top - 3, mid]])
  const median = v => [...v].sort((p, q) => p - q)[v.length >> 1], ground = median(under)
  // the foot a labelled line, as strong as the lane's top
  assert.ok(median(footRow) > ground + 30 && Math.abs(median(footRow) - median(topRow)) <= 6, `the foot a labelled line (${median(footRow)}), as the lane's top (${median(topRow)}) over the ground (${ground})`)
  // each time flush under a labelled line: the lines down read 3 px over the foot (the labelled the brightest), the
  // times' words as runs of ink across the strip's middle, a time's figures closer than 10 px; a time's first ink at
  // its line or a pixel or two after it (its figure's side bearing). Past the caret, at the sound's start: at rest it is
  // brighter than any line of the grid (render.js caretColour)
  const lit = (v, least) => v.reduce((out, p, x) => { if (p >= least && !(v[x - 1] >= least)) out.push([x, x]); if (p >= least) out.at(-1)[1] = x; return out }, [])
  const lines = downRow.slice(0, drawn.W - 60).map((p, x) => x < 2 ? 0 : p), ink = Math.max(...lines), labelled = lit(lines, ink - 12).map(([x]) => x)
  const times = lit(wordRow, ground + 25).reduce((out, run) => { if (out.length && run[0] - out.at(-1)[1] < 10) out.at(-1)[1] = run[1]; else out.push([...run]); return out }, [])
  const shown = times.slice(0, -1).filter(([x]) => x > 2), foot = times.at(-1)
  assert.ok(labelled.length >= 7 && shown.length >= 5, `the labelled lines and the times read: ${labelled}; ${JSON.stringify(times)}`)
  assert.deepEqual(shown.filter(([x]) => !labelled.some(l => x >= l && x <= l + 2)).map(([x]) => x), [], `each time flush under a labelled line: ${JSON.stringify(shown)}; ${labelled}`)
  // the foot's value last, at the strip's right end, no time under it; the times quieter than it
  assert.ok(foot[1] > drawn.W - 8 && foot[0] > drawn.W - 24 && times.at(-2)[1] < foot[0] - 8, `the foot's value at the strip's right end, alone: ${JSON.stringify(times.slice(-2))} of ${drawn.W}`)
  const bright = ([a, b]) => Math.max(...wordRow.slice(a, b + 1)), soft = Math.max(...shown.map(bright))
  assert.ok(soft < bright(foot) - 30, `the times quieter than the values: ${soft}, the foot's value ${bright(foot)}`)
  // the pointer's value, held Ctrl, read out at the edge too, a square of its own
  const plot = await list.locator('.plot').boundingBox()
  await page.keyboard.down('Control')
  await page.mouse.move(plot.x + plot.width * .3, plot.y + valued[0][0] + Math.max(...high) * 2.5)
  await poll(sheet, d => assert.equal(d.patches.filter(p => p[2]).length, valued.length + 1, 'the pointer\'s value at the edge'))
  await page.keyboard.up('Control')
  await page.mouse.move(0, 0)
  await poll(sheet, d => assert.deepEqual(d.patches, drawn.patches))
  // a taller frame: the lanes ruled finer as they have the room, the strip as low as before, the patches one line still
  const lined = d => d.patches.filter(p => p[2]).map(([, long]) => long + 1)
  const tall = px => page.evaluate(px => { document.querySelector('audio-repl').style.setProperty('--audio-repl-height', `${px}px`) }, px)
  await tall(560)
  await poll(sheet, d => assert.ok(lined(d).every(h => h >= 11 && h <= 16) && d.tall === drawn.tall && d.top > drawn.top + 100, `a frame 560 px tall: patches ${lined(d)} px, the strip ${d.tall} at ${d.top}`))
  await tall(420)
  await poll(sheet, d => assert.deepEqual(d.patches, drawn.patches))
  // narrower: the sheet still whole
  await page.evaluate(() => { document.querySelector('audio-repl').style.width = '700px' })
  await poll(sheet, d => assert.ok(d.end === '0px' && d.patches.filter(p => p[2]).length >= 4 && !d.edge.length && d.tall === drawn.tall, JSON.stringify(d.patches)))
  await page.evaluate(() => { document.querySelector('audio-repl').style.width = '' })
  // a file dropped on the picture opens in the sound's place (not into it, as the whole editor's picture takes one),
  // the page's edits still at hand, none made; the kind was the page's sound's: gone with it
  const dropped = await list.locator('.plot').evaluateHandle(async () => { const dt = new DataTransfer(); dt.items.add(new File([await (await fetch('/test/fixture.wav')).arrayBuffer()], 'mine.wav', { type: 'audio/wav' })); return dt })
  for (const type of ['dragover', 'drop']) await list.locator('.plot').dispatchEvent(type, { dataTransfer: dropped })
  await list.locator('.embed-sound-name', { hasText: 'mine.wav' }).waitFor()
  await poll(async () => [await list.locator('#edits-found .found-group').first().locator('.found-row').count(), await list.locator('.chain-edit').count(), await list.locator('.bar-kind').count()], seen => assert.deepEqual(seen, [4, 0, 0], 'four suggested'))
  // a sound that is not the page's is listened to (worker.js kind) and what it is heard to be is said in that place:
  // the file dropped, a short noise, is neither speech nor music and has no word; one with nothing in it is silence
  const quiet = await list.locator('.plot').evaluateHandle((_, bytes) => { const dt = new DataTransfer(); dt.items.add(new File([new Uint8Array(bytes)], 'quiet.wav', { type: 'audio/wav' })); return dt }, [...await wavBytes([new Float32Array(RATE)])])
  for (const type of ['dragover', 'drop']) await list.locator('.plot').dispatchEvent(type, { dataTransfer: quiet })
  await list.locator('.embed-sound-name', { hasText: 'quiet.wav' }).waitFor()
  await poll(() => list.locator('.bar-kind').allTextContents(), words => assert.deepEqual(words, ['silence']))
  assert.deepEqual(errors, [])
})

// A value never lies over a time: within the sheet, the one value in the times' strip under the grid is the last
// lane's foot's (the waveform's −1), written under its line as every other is, at the strip's right end, on the
// strip's own ground, which hides a time scrolled under it, and no time standing across that ground's edge; every
// other value over the strip's top, a lane with another under it writing none at its foot (the square under that line
// is the next lane's, its top value's); nothing else the lanes draw reaches into the strip. Read off what is drawn, as
// the picture's own tests do: every value's words (as the overlay writes them), what the overlay lights over the strip,
// and every time in sight written whole within the frame where the sound is shown whole, all before the foot's value. A sound in one lane and in two, and a spectrogram (its lowest frequency, 20, the foot's value),
// three widths, zoomed out and zoomed in; and the whole editor's levels, never across its row's top
test('editor: a value never lies over a time, the last lane\'s foot value alone in the times\' strip, at its right end', async () => {
  // the overlay's and the row's words as written, by their canvas (a value's middle its y; a time's left its x)
  const hook = target => target.evaluate(() => {
    const fill = CanvasRenderingContext2D.prototype.__fill ??= CanvasRenderingContext2D.prototype.fillText
    window.__said = []
    CanvasRenderingContext2D.prototype.fillText = function (text, x, y) {
      const on = this.canvas.matches('.overlay') ? 'value' : this.canvas.matches('.row') ? 'time' : null
      if (on && /\d/.test(text)) window.__said.push({ on, text, x, y, align: this.textAlign, w: this.measureText(text).width, size: parseFloat(this.font) })
      return fill.call(this, text, x, y)
    }
  })
  // what was written since `from`, and the overlay over the row: where it lights first from the left (`from`, CSS px;
  // the frame's width where nothing is lit) and how much is lit before the frame's last 80 px; the row's top and
  // height, the frame's width
  const read = (target, from) => target.evaluate(from => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(() => {
    const plot = document.querySelector('.plot'), o = plot.querySelector('canvas.overlay'), row = plot.querySelector('canvas.row'), k = o.width / o.clientWidth
    const top = row.getBoundingClientRect().top - plot.getBoundingClientRect().top, tall = row.getBoundingClientRect().height - 8
    const d = o.getContext('2d').getImageData(0, Math.ceil(top * k), o.width, Math.max(1, Math.floor(tall * k))).data
    let first = o.width
    for (let i = 3; i < d.length; i += 4) if (d[i]) first = Math.min(first, (i >> 2) % o.width)
    // (a time written on the reel, as far as it is drawn past the view; the reel moved as the view is: its offset)
    const reel = plot.querySelector('.reel'), at = reel ? new DOMMatrix(getComputedStyle(reel).transform).e : 0
    done({ top, tall, W: o.clientWidth, at, lit: first / k, said: window.__said.slice(from) })
  }))), from)
  const values = r => r.said.filter(s => s.on === 'value' && !/:/.test(s.text))
  // (motion reduced: a zoom or a fit lands at once, no picture between)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  for (const [script, display, lowest] of [[`audio('chime.wav').remix(1)`, 'wave', '−1'], [`audio('chime.wav')`, 'wave', '−1'], [`audio('chime.wav').remix(1)`, 'spec', '20']]) for (const px of [1440, 1024, 390]) {
    // a frame of that width, its sound whole; then zoomed in by the keys
    await page.goto(origin + '/blank.html')
    await page.evaluate(async ([script, px, display]) => {
      await import('/repl/embed.js')
      Object.assign(document.body.style, { margin: '0', background: 'rgb(40, 40, 40)' })
      document.body.innerHTML = `<audio-repl panel="none" height="420" background="page" style="width: ${px}px" controls="sound play clock history save loudness rate channels view" ui='${JSON.stringify({ grid: 'paper', axis: 'inside', inset: '5vw', edits: 'chain', font: 'sans', zoom: { out: 1 }, overshoot: 0, display })}'><pre><code>${script}</code></pre></audio-repl>`
    }, [script, px, display])
    const f = page.frameLocator('audio-repl iframe')
    await f.locator('.clock .length', { hasText: '0:08.000' }).waitFor({ state: 'attached' })
    await page.mouse.move(0, 0)
    const frame = page.frames().find(fr => fr.url().includes('/repl/?embed'))
    await hook(frame)
    for (const zoomed of [false, true]) {
      if (zoomed) { await f.locator('.plot').focus(); for (let i = 0; i < 2; i++) await page.keyboard.press('='); await page.mouse.move(0, 0) }
      const from = await frame.evaluate(() => window.__said.length)
      // drawn again whole: the frame a pixel narrower, drawn so, and back (each a canvas of a new size, laid anew)
      await page.evaluate(px => { document.querySelector('audio-repl').style.width = `${px - 1}px` }, px)
      await poll(() => frame.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => r(innerWidth))))), w => assert.equal(w, px - 1))
      await page.evaluate(px => { document.querySelector('audio-repl').style.width = `${px}px` }, px)
      await poll(() => read(frame, from), r => {
        const where = `${script}, ${display}, ${px} px${zoomed ? ', zoomed in' : ''}`, vs = values(r), times = r.said.filter(s => s.on === 'time')
        assert.ok(vs.length >= 3, `${where}: its values written (${vs.map(v => v.text)})`)
        // one value in the row: the last lane's foot's, −1 (the spectrogram's 20), in its middle, at its right end (as drawn last, the frame
        // whole again: those since `from` include the draw a pixel narrower); every other over its top
        const low = vs.filter(v => v.y + v.size / 2 > r.top + .5), foot = low.at(-1)
        assert.deepEqual([...new Set(low.map(v => `${v.text} ${v.align}`))], [`${lowest} right`], `${where}: the foot's value alone in the times' strip (its top ${r.top}): ${low.map(v => `${v.text} at ${v.x}, ${v.y}`)}`)
        assert.ok(Math.abs(r.W - foot.x - 4) <= .5 && Math.abs(foot.y - (r.top + r.tall / 2)) <= 2, `${where}: at its right end, in its middle: ${foot.x}, ${foot.y}; the row ${r.top} + ${r.tall}, ${r.W} px`)
        // the overlay lit over the strip only for it: its ground, a gap before its words, to the edge
        assert.ok(r.lit > r.W - 80 && r.lit <= foot.x - foot.w - 2, `${where}: nothing else of the lanes' over the strip: lit from ${r.lit} px of ${r.W}, the value from ${foot.x - foot.w}`)
        // the sound whole: every time in sight whole, none across the frame's edges (one past them, or under the foot's
        // value's ground, out of sight, is the reel's, drawn for the view to scroll onto), and none across that ground's edge
        const shown = times.map(t => ({ ...t, left: t.x + r.at })).filter(t => t.left + t.w > 0 && t.left < r.lit)
        assert.ok(shown.length >= 3, `${where}: its times written`)
        if (!zoomed) assert.deepEqual(shown.filter(t => t.left < -.5 || t.left + t.w > r.W + .5).map(t => `${t.text} at ${Math.round(t.left)}`), [], `${where}: every time in sight whole within the frame (${r.W} px)`)
        assert.deepEqual(shown.filter(t => t.left + t.w > r.lit).map(t => `${t.text} at ${Math.round(t.left)}`), [], `${where}: no time across the foot's value's ground (from ${r.lit} px)`)
      })
    }
  }
  // the whole editor: two tracks' levels, the last pointed at, in a window tall and short (the tracks then running on
  // past the time row): the lowest over its line where its lane leaves no room under it; none across the row's top
  for (const height of [720, 480]) {
    await page.setViewportSize({ width: 1280, height })
    await open()
    await write(`let a = audio('chime.wav')\n\nlet b = audio('chime.wav').gain(-6)`)
    await lengthIs('0:08.000')
    await hook(page)
    const box = await page.locator('.plot').boundingBox(), lanes = await page.locator('.layer').evaluateAll(els => els.map(e => e.dataset.lane.split(' ').map(Number)))
    const last = lanes.at(-1), from = await page.evaluate(() => window.__said.length)
    await page.mouse.move(box.x + box.width * .4, box.y + Math.min(last[0] + last[1] * .3, box.height - 60))
    await poll(() => read(page, from), r => {
      const vs = values(r)
      assert.ok(vs.length >= 2, `${height} px: the levels shown, pointed at (${vs.map(v => v.text)})`)
      // (one of a band scrolled under the row is cut away whole there: none across its top)
      assert.deepEqual(vs.filter(v => v.y - v.size / 2 < r.top - .5 && v.y + v.size / 2 > r.top + .5).map(v => `${v.text} at ${v.y}`), [], `${height} px: no level across the time row's top (${r.top})`)
    })
  }
  await page.setViewportSize({ width: 1280, height: 720 })
  await page.emulateMedia({ reducedMotion: null })
  assert.deepEqual(errors, [])
})

test('editor: embedded, the parts the page names, its edits a press away, its files in and out', async () => {
  // the script as the editor holds it: CodeMirror, with no code pane to show it in, comes only with the first undo
  await page.route('**/repl/editor.js', async route => { const r = await route.fetch(); route.fulfill({ response: r, body: (await r.text()).replace('assign({ ed: codeEditor(', 'assign({ ed: globalThis.__ed = codeEditor(') }) })
  const script = () => page.evaluate(() => __ed.code), mirrored = []
  page.on('request', r => r.url().endsWith('/assets/codemirror.js') && mirrored.push(r.url()))
  await page.goto(origin + '/blank.html')
  const src = await page.evaluate(async () => {
    await import('/repl/embed.js')
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
  for (const part of ['.embed-sound', '.play', '.embed-open-file', '.embed-save', '.readout', '.fact[popovertarget="rate-menu"]', '.embed-view', '.embed-open', '.embed-ops']) assert.equal(await shown(`.panes ${part}`), true, part)
  // (the history named: none of it till there is one, index.html .history)
  assert.equal(await page.locator('.panes .history').first().evaluate(h => h.hidden && !h.checkVisibility()), true, 'the history named, none till there is one')
  for (const part of ['.record', '.deck-slot:has(.record)', '.loop', '.clock', '.message', '.before', '.fact[popovertarget="channels-menu"]', '.embed-name', '.lane-look']) assert.equal(await shown(`.panes ${part}`), false, part)
  // on the page's ground, no slab's edge to keep off: the play button under the sound's name
  const lefts = await page.evaluate(() => ['.play .play-icon', '.embed-sound-name'].map(s => document.querySelector(`.panes ${s}`).getBoundingClientRect().left))
  assert.ok(Math.abs(lefts[0] - lefts[1]) < 3, `play at ${lefts[0]}, the sound's name at ${lefts[1]}`)
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
  // the edits after the loop, in the bar
  assert.equal(await page.evaluate(() => document.querySelector('.status .loop').nextElementSibling?.classList.contains('embed-ops')), true)
  const menu = () => page.locator('.menubar-menu .menu-row')
  await page.locator('.embed-ops').click()
  assert.deepEqual(await menu().locator('.menu-label').allTextContents(), ['Stretch', 'Fade', 'Reverse'])
  // each its values at the right, in the units its settings read in
  assert.deepEqual(await menu().locator('.menu-keys').allTextContents(), ['1.25×', '1s, 1s', ''])
  assert.equal(await menu().locator('.menu-check svg').count(), 3)
  // a line under each on what it does
  assert.deepEqual(await menu().locator('.menu-about').allTextContents(), ['Longer or shorter, same pitch', 'Fade in and out', 'Play backwards'])
  await menu().filter({ hasText: 'Stretch' }).click()
  await length('0:10.000')
  assert.equal(scriptOf(await script()), scriptOf(`audio('chime.wav').stretch(1.25)`))
  // made: counted by the plus; in the menu first, checked, the others after it; pressed again, taken away
  assert.deepEqual([await page.locator('.embed-ops').getAttribute('aria-label'), await page.locator('.embed-ops span').textContent()], ['Edits, 1 made', '1'])
  await page.locator('.embed-ops').click()
  assert.deepEqual(await menu().evaluateAll(rows => rows.map(r => [r.querySelector('.menu-label').textContent, r.getAttribute('aria-checked')])), [['Stretch', 'true'], ['Fade', null], ['Reverse', null]])
  await menu().filter({ hasText: 'Stretch' }).click()
  await length('0:08.000')
  assert.equal(scriptOf(await script()), scriptOf(`audio('chime.wav')`))
  assert.deepEqual([await page.locator('.embed-ops').getAttribute('aria-label'), await page.locator('.embed-ops span').count()], ['Add an edit', 0])
  // no code pane: no CodeMirror, till the first undo brings it, the press undoing once it has
  assert.deepEqual(mirrored, [])
  // taken away as any edit is, undone as one: back, then gone again
  await page.locator('.history .undo').click()
  await length('0:10.000')
  await page.locator('.history .undo').click()
  await length('0:08.000')
  assert.equal(scriptOf(await script()), scriptOf(`audio('chime.wav')`))
  assert.equal(mirrored.length, 1)
  // the sound's name over the picture; pressed, its ways in: a file, a take, the samples; one picked, in its place
  assert.equal(await page.locator('.embed-sound-name').textContent(), 'chime.wav')
  await page.locator('.embed-sound').click()
  const ways = await menu().locator('.menu-label').allTextContents()
  assert.deepEqual(ways.slice(0, 2), ['File…', 'Record'])
  assert.ok(ways.includes('handpan.wav'), ways.join(', '))
  await menu().filter({ hasText: 'handpan.wav' }).click()
  await page.waitForFunction(() => document.querySelector('.embed-sound-name')?.textContent === 'handpan.wav')
  assert.equal(scriptOf(await script()), scriptOf(`audio('handpan.wav')`))
  // saved: the format picked from its menu, the result as the export saves it; opened: a file of the reader's in its place
  await page.locator('.embed-save').click()
  assert.deepEqual(await menu().locator('.menu-label').allTextContents(), ['WAV', 'FLAC', 'MP3', 'OGG', 'AIFF'])
  const [saved] = await Promise.all([page.waitForEvent('download'), menu().filter({ hasText: 'FLAC' }).click()])
  assert.match(saved.suggestedFilename(), /\.flac$/)
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.locator('.embed-open-file').click()])
  await chooser.setFiles(fileURLToPath(new URL('../fixture.wav', import.meta.url)))
  await page.waitForFunction(() => __ed.code.includes('fixture.wav'))
  // no controls asked for: the parts as ever, the files' buttons not among them; no ops, no row of them
  await page.goto(origin + '/repl/?embed&panel=none' + url.hash)
  await wholeLevels().waitFor()
  assert.equal(await page.locator('.embed-ops').count(), 0)
  for (const part of ['.record', '.loop', '.before', '.embed-name']) assert.equal(await shown(`.panes ${part}`), true, part)
  for (const part of ['.embed-sound', '.embed-open-file', '.embed-save', '.embed-view']) assert.equal(await shown(`.panes ${part}`), false, part)
  assert.equal(await shown('.panes .lane-look'), true, 'the look, where no list names the parts')
  assert.notEqual(await page.evaluate(() => getComputedStyle(document.querySelector('.panes')).backgroundImage), 'none')
  // the lanes fill the picture: no room kept under them for a new track, as the whole editor keeps. How far the
  // caret's line, put in the middle, ends short of the picture's foot, CSS px (the pointer away: no time of its own on
  // the time row)
  const put = async () => {
    const box = await page.locator('.plot').boundingBox()
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 3)
    await page.mouse.move(0, 0)
    await frames()
  }
  // (the caret where the press snapped it: of the columns within 10 px of the middle, the one lit down the most rows;
  // its line's foot, down its lanes past the gaps between them, a tick on the time row under it apart)
  const gap = () => page.evaluate(() => {
    const cv = __overlay(), k = cv.width / cv.clientWidth, x0 = Math.round(cv.width / 2 - 10 * k), cw = Math.round(20 * k), d = cv.getContext('2d').getImageData(x0, 0, cw, cv.height).data
    const lit = x => { let n = 0, last = -1; for (let y = 0; y < cv.height; y++) { const on = d[(y * cw + x) * 4 + 3] > 128; if (on) { n++; last = y } else if (last >= 0 && y - last > 3 * k) break } return { n, last } }
    const { last } = Array.from({ length: cw }, (_, x) => lit(x)).reduce((a, b) => b.n > a.n ? b : a)
    return cv.clientHeight - (last + 1) / k
  })
  await put()
  assert.ok(await gap() < 40, `embedded, the lanes reach the picture's foot (${await gap()} px short)`)
  const ruled = await gap()
  // no ruler asked for: no time row, the lanes reaching on into its place (14 px; the scrollbar's strip under it still
  // its own), and no time for the playhead on it
  await page.goto(origin + '/repl/?embed&ui=' + encodeURIComponent(JSON.stringify({ panel: 'none', controls: ['play', 'clock', 'look'] })) + url.hash)
  await length('0:08.000')
  await put()
  assert.ok(await gap() < ruled - 12, `no time row: the lanes ${ruled - await gap()} px further down`)
  await page.locator('.play').click()
  await page.waitForFunction(() => document.querySelector('.play')?.getAttribute('aria-label') === 'Pause')
  await frames()
  assert.equal(await page.locator('.playhead .when').isVisible(), false)
  await page.locator('.play').click()
  // the whole editor keeps its room under the lanes
  await page.goto(origin + '/repl/' + url.hash)
  await wholeLevels().waitFor()
  await put()
  assert.ok(await gap() > 80, `whole, the room under the lanes kept (${await gap()} px)`)
  // a sound by its path from the site's root, as the page around it names its own files: opened, not asked for
  const rooted = await page.evaluate(async () => {
    await import('/repl/embed.js')
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
    await import('/repl/embed.js')
    document.body.innerHTML = `<audio-repl panel="none"><pre><code>audio('//elsewhere.example/x.wav')</code></pre></audio-repl>`
    const frame = await new Promise(r => { const t = setInterval(() => { const f = document.querySelector('audio-repl iframe'); if (f) { clearInterval(t); r(f) } }, 20) })
    return frame.getAttribute('src')
  })
  await page.goto(new URL(other, origin).href)
  await page.locator('.panes .text-button', { hasText: 'Open it' }).waitFor()
  assert.deepEqual(fetched, [])
  assert.deepEqual(errors, [])
})

// The embed before its frame shows: a skeleton of the repl's parts where they will be, laid out from the
// element's size and its panel, its text out of sight; gone once the frame's sound is in
test('editor: embedded, a skeleton of its parts holds their places till its sound is in', async () => {
  await page.goto(origin + '/blank.html')
  // the frames held back till the skeletons are read
  let release
  const held = new Promise(r => release = r)
  await page.route('**/repl/?embed*', async route => { await held; await route.continue() })
  await page.evaluate(async () => {
    await import('/repl/embed.js')
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
  await page.unroute('**/repl/?embed*')
})

// A selection's fork, takes started there, is an editor's, not a figure's: embedded, none, whatever is selected, the
// fades and the level still in its corners' reach; a page that wants takes names it (controls fork), and there it stands
test('editor: embedded, a selection has no fork, but where the page names it', async () => {
  await page.goto(origin + '/blank.html')
  await page.evaluate(async () => {
    await import('/repl/embed.js')
    document.body.style.margin = '0'
    const at = controls => `<audio-repl panel="none" height="240"${controls ? ` controls="${controls}"` : ''}><pre><code>audio('chime.wav')</code></pre></audio-repl>`
    document.body.innerHTML = at('') + at('play clock') + at('play clock fork')
  })
  const forks = []
  for (const i of [0, 1, 2]) {
    const f = page.frameLocator('audio-repl iframe').nth(i)
    await f.locator('.clock .length', { hasText: '0:08.000' }).waitFor()
    const box = await f.locator('.plot').boundingBox()
    await page.mouse.move(box.x + box.width * .3, box.y + box.height / 2)
    await page.mouse.down()
    await page.mouse.move(box.x + box.width * .6, box.y + box.height / 2, { steps: 6 })
    await page.mouse.up()
    // selected, the fork placed by the picture (not hidden by it): shown or not is the page's word
    await f.locator('.plot .fork:not([hidden])').waitFor({ state: 'attached' })
    forks.push(await f.locator('.plot .fork').isVisible())
  }
  assert.deepEqual(forks, [false, false, true], 'none as it comes, none among parts that do not name it, there where named')
  assert.deepEqual(errors, [])
})

// ── Guards for what was caught by eye ──────────────────────────
