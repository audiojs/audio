// The time row, the overview, the scrollbar, the caret out of sight; the server, the page and the helpers in page.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { browser, page, origin, errors, tipOf, wholeLevels, open, settled, frames, poll, settings, selected, noCues, write, FOOT, tall, tracksAt, gutter, spans, axis, lengthIs, tap, heard, pixels, keyed } from './page.js'

// The caret, the selection or the playhead out of sight, past the lanes' end under the meters too: it stays at the edge
// of the lanes it is past, its line as opaque as in sight, and on the time row under it its tick with a chevron pointing
// out to it, a press there bringing the view to it; a click on the clock's time does the same. Nothing of its line shows
// past the lanes' end, between the meters and the labels. A click on the length shows the selection whole, again all of
// it. Each goes there over 300 ms, not at once
test('editor: out of sight, the caret stays at the lanes\' edge; its chevron at its line\'s foot, or the clock\'s time, brings the view to it; the length frames the selection, then all', async () => {
  await page.route('**/playground/editor.js', async route => { const r = await route.fetch(); route.fulfill({ response: r, body: (await r.text()).replace('v = view(', 'v = globalThis.__view = view(') }) })
  await open()
  await noCues()
  await write(`audio.from(t => Math.sin(2 * Math.PI * 220 * t) * .3, { duration: 20 })`)
  await lengthIs('0:20.000')
  const box = await page.locator('.plot').boundingBox(), w = box.width - (await gutter()), y = box.y + tall(box) / 3
  const range = () => page.evaluate(() => __view.range), seen = async t => { const [a, b] = await range(); return t >= a && t <= a + (b - a) * .9 }
  // the view where it goes, its travel there over (no frame moving it)
  const rest = async () => { let now = await range(), was; do { was = now; await frames(1); now = await range() } while (now[0] !== was[0] || now[1] !== was[1]); return now }
  await page.mouse.move(box.x + w / 2, y)
  for (let i = 0; i < 10; i++) { await page.keyboard.down('Control'); await page.mouse.wheel(0, -120); await page.keyboard.up('Control') }
  await page.mouse.click(box.x + w / 2, y)
  const caret = await page.evaluate(() => __view.cursor)
  // scrolled past it: at the lanes' left edge, its chevron at the foot of its line there
  await page.mouse.wheel(0, w * 3)
  await frames()
  assert.ok(!await seen(caret), 'scrolled out of sight')
  const foot = box.y + tall(box) - 7
  await page.mouse.move(box.x + 6, foot)
  assert.equal(await page.locator('.plot').evaluate(e => e.style.cursor), 'pointer')
  assert.equal(await page.locator('.hint').evaluate(e => e.hidden ? '' : e.textContent), 'To the caret')
  // the view on its way a frame after the press, there by 300 ms
  const was = await range()
  await page.mouse.click(box.x + 6, foot)
  const on = await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => r(__view.range[0])))))
  const [a, b] = await rest()
  assert.ok(on < was[0] && on > a, `on its way: ${was[0].toFixed(3)} → ${on.toFixed(3)} → ${a.toFixed(3)}`)
  assert.ok(Math.abs((caret - a) / (b - a) - .45) < .1, `brought to the middle: ${((caret - a) / (b - a)).toFixed(2)} across`)
  // the clock's time does the same, from either side
  await page.mouse.wheel(0, -w * 3)
  await frames()
  assert.ok(!await seen(caret), 'scrolled the other way out of sight')
  await page.locator('.time').click()
  await rest()
  assert.ok(await seen(caret), 'the clock\'s time brings it back')
  // past it the other way, its chevron at the lanes' right end, before the meters, brings it back too
  await page.mouse.wheel(0, -w * 3)
  await frames()
  const end = await page.locator('.plot').evaluate(el => parseFloat(getComputedStyle(el).getPropertyValue('--end')))
  await page.mouse.click(box.x + box.width - end - 6, foot)
  await rest()
  assert.ok(await seen(caret), 'the right edge\'s chevron brings it back')
  // under the meters, out of sight too: none of its line past the lanes' end (e), at it a pixel short, as opaque as its
  // line in sight, its chevron on the time row before its tick; on the lanes' last pixel, in sight, its line. The
  // overlay's columns lit on a row, px from the plot's top, past an opacity: { column: its opacity }
  const BOX = 16, e = Math.floor(box.width - end), h = box.height - 22, timeAt = px => page.evaluate(([px, w]) => { const [a, b] = __view.range; return a + px / w * (b - a) }, [px, w])
  const columns = (py, opaque = 0) => page.evaluate(([py, opaque]) => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(() => {
    const cv = __overlay(), k = cv.width / cv.getBoundingClientRect().width, row = cv.getContext('2d').getImageData(0, Math.round(py * k), cv.width, 1).data, lit = {}
    for (let i = 0; i < cv.width; i++) if (row[i * 4 + 3] > opaque) lit[Math.floor(i / k)] = Math.max(lit[Math.floor(i / k)] ?? 0, row[i * 4 + 3])
    done(lit)
  }))), [py, opaque])
  const cols = async (py, opaque) => Object.keys(await columns(py, opaque)).map(Number)
  await page.mouse.move(box.x + 40, box.y + 30)
  let opacity = null
  for (const px of [e - 1, e, e + 2, w]) {
    await page.evaluate(t => __view.setCursor(t), await timeAt(px))
    const lit = await columns(h * .1)
    assert.deepEqual(Object.keys(lit).map(Number), [e - 1], `a caret at ${px - e} px from the lanes' end`)
    opacity ??= lit[e - 1]
    assert.equal(lit[e - 1], opacity, `a caret at ${px - e} px from the lanes' end: as opaque as in sight`)
    if (px < e) continue
    const chevron = (await cols(tall(box) - 7)).filter(c => c >= e - 9 && c < e - 1)
    assert.ok(chevron.length >= 3, `a caret at ${px - e} px from the lanes' end: its chevron at its line's foot, ${chevron.length} columns`)
  }
  // a range ending there, the pointer in it: the squares of its end, its fade's in its top corner and its grip past it
  // 3/4 down the lane, with its end in sight; with it past the lanes' end, none under the meters
  for (const [px, shown] of [[e - 40, true], [e + 1, false]]) {
    await page.evaluate(([a, b]) => __view.select(a, b), [await timeAt(e - 200), await timeAt(px)])
    await page.mouse.move(box.x + e - 100, box.y + 30)
    for (const [py, from] of [[BOX / 2, px - BOX], [Math.round(tall(box) * 3 / 4) - 4, px]]) {
      const lit = (await cols(py, shown ? 128 : 0)).filter(c => c >= from && c < from + BOX)
      assert.ok(shown ? lit.length >= BOX - 4 : !lit.some(c => c >= e), `a range ending ${px - e} px from the lanes' end, at ${py} px: ${lit.length} lit`)
    }
  }
  // a selection: the length frames it, then shows all of it, then frames it again
  await page.evaluate(() => __view.select(5, 7))
  const framed = async () => { await page.locator('.length').click(); return rest() }
  let [p, q] = await framed()
  assert.ok(p <= 5 && p > 4.5 && (q - p) < 3, `the selection framed: ${p.toFixed(2)}–${q.toFixed(2)}`)
  ;[p, q] = await framed()
  assert.ok(p === 0 && q >= 20, `all of it: ${p}–${q}`)
  ;[p, q] = await framed()
  assert.ok(p <= 5 && (q - p) < 3, 'framed again')
  // playing, scrolled away from the playhead: the clock's time brings the view back to it, following it again
  await page.mouse.click(box.x + w / 2, y)
  await page.keyboard.press('Space')
  await page.waitForFunction(() => document.querySelector('.play')?.getAttribute('aria-label') === 'Pause')
  // played a while, followed
  await page.waitForTimeout(600)
  await page.mouse.wheel(0, w * 3)
  await frames()
  const clock = () => page.evaluate(() => { const [m, s] = document.querySelector('.time').textContent.split(':'), [a, b] = __view.range; return (+m * 60 + +s - a) / (b - a) })
  assert.ok(await clock() < 0, 'scrolled past the playhead')
  await page.mouse.move(box.x + 6, foot)
  await page.waitForFunction(() => !document.querySelector('.hint').hidden && document.querySelector('.hint').textContent === 'To the playhead')
  await page.locator('.time').click()
  // brought back, then playing on a while: still followed, not only brought there
  await page.waitForTimeout(800)
  const at = await clock()
  assert.ok(Math.abs(at - .45) < .15, `followed again: ${at.toFixed(2)} across`)
  await page.keyboard.press('Space')
})

// The overview, chosen in the settings for the scroll: the whole sound in a strip under the time row, the part in view
// lit; a press beside it takes the view there, a drag moves it. The lanes end above it
test('editor: the overview shows the whole sound under the time row; pressed or dragged, the view goes there', async () => {
  await page.route('**/playground/editor.js', async route => { const r = await route.fetch(); route.fulfill({ response: r, body: (await r.text()).replace('v = view(', 'v = globalThis.__view = view(') }) })
  await open()
  await noCues()
  await write(`audio.from(t => t < 10 ? Math.sin(2 * Math.PI * 220 * t) * .5 : 0, { duration: 20 })`)
  await lengthIs('0:20.000')
  await settings('Scroll', 'Overview')
  const box = await page.locator('.plot').boundingBox(), w = box.width - (await gutter()), foot = box.y + box.height - 12
  const range = () => page.evaluate(() => __view.range)
  // drawn where there is sound, its first half; a line where it is silent
  const ink = f => pixels(`const x = Math.round(arg), xs = []; let n = 0; for (let y = h - 26; y < h - 4; y++) { const i = (y * w + x) * 4; if (d[i] > 60) n++ } return n`, w * f)
  assert.ok(await ink(.25) > 4, 'the sound drawn in the overview')
  assert.ok(await ink(.75) <= 2, 'silence a line')
  // zoomed out past the end, the sound's strip ends where the sound does
  await page.mouse.move(box.x + w / 2, box.y + 40)
  for (let i = 0; i < 2; i++) { await page.keyboard.down('Control'); await page.mouse.wheel(0, 120); await page.keyboard.up('Control') }
  const [, past] = await range()
  assert.ok(past > 25, `zoomed out past the end: ${past}`)
  assert.ok(await ink(.25 * 20 / past) > 4 && await ink(.75 * 20 / past) <= 2, 'the strip narrowed to the sound')
  await page.evaluate(() => __view.fit())
  for (let i = 0; i < 10; i++) { await page.keyboard.down('Control'); await page.mouse.wheel(0, -120); await page.keyboard.up('Control') }
  const [a0, b0] = await range()
  // pressed at 3/4 of the strip: the view centred at 15 s, then dragged left a tenth of it, 2 s earlier
  await page.mouse.move(box.x + w * .75, foot)
  await page.mouse.down()
  let [a, b] = await range()
  assert.ok(Math.abs((a + b) / 2 - 15) < .5 && Math.abs((b - a) - (b0 - a0)) < 1e-6, `centred at 15 s: ${a.toFixed(2)}–${b.toFixed(2)}`)
  await page.mouse.move(box.x + w * .65, foot, { steps: 4 })
  await page.mouse.up()
  const [c] = await range()
  assert.ok(Math.abs(c - a + 2) < .1, `dragged 2 s back: ${a.toFixed(2)} → ${c.toFixed(2)}`)
})

// With tracks, the overview is the edited track's, as the bar's view is of it: another's lane pressed, that one's
test('editor: with tracks, the overview shows the track edited', async () => {
  await open()
  await noCues()
  await write(`let a = audio.from(t => t < 5 ? Math.sin(2 * Math.PI * 220 * t) * .5 : 0, { duration: 10 })\n\nlet b = audio.from(t => t < 5 ? 0 : Math.sin(2 * Math.PI * 220 * t) * .5, { duration: 10 })`)
  await lengthIs('0:10.000')
  await page.locator('.layer').nth(1).waitFor({ state: 'attached' })
  await settings('Scroll', 'Overview')
  const box = await page.locator('.plot').boundingBox(), w = box.width - (await gutter())
  // (lit in any channel: a track's own colour, its waveform's)
  const ink = f => pixels(`const x = Math.round(arg); let n = 0; for (let y = h - 26; y < h - 4; y++) { const i = (y * w + x) * 4; if (Math.max(d[i], d[i + 1], d[i + 2]) > 60) n++ } return n`, w * f)
  const drawn = async (first, second) => { for (let i = 0; i < 20; i++) { if ((await ink(.25) > 4) === first && (await ink(.75) > 4) === second) return true; await frames(1) } return false }
  const lane = async i => (await tracksAt())[i].y + 20
  await page.mouse.click(box.x + w / 2, await lane(0))
  assert.ok(await drawn(true, false), 'a\'s: its first half')
  await page.mouse.click(box.x + w / 2, await lane(1))
  assert.ok(await drawn(false, true), 'b\'s: its second half')
})

// The overview drawn as a lane draws its waveform: gl-waveform's envelope, its body (Density) brightest at the centre
// line and fading out to the peaks, where it was one shade, edge to edge (its min and max a column, at .55)
test('editor: the overview draws the sound as its lanes do, its body brightest at its centre', async () => {
  await open()
  await noCues()
  await write(`audio.from(t => Math.sin(2 * Math.PI * 220 * t) * .5, { duration: 4 })`)
  await lengthIs('0:04.000')
  await settings('Scroll', 'Overview')
  const box = await page.locator('.plot').boundingBox(), w = box.width - (await gutter())
  // a column at the middle: the brightest of each row of the strip, its lit rows' middle and a fifth of the way in
  const shades = () => pixels(`const x = Math.round(arg), rows = []; for (let y = h - 26; y < h - 4; y++) { const i = (y * w + x) * 4; rows.push(Math.max(d[i], d[i + 1], d[i + 2])) } return rows`, w / 2)
  const rows = await poll(shades, rows => assert.ok(rows.filter(v => v > 40).length >= 6, `the strip drawn: ${rows.join(' ')}`))
  const lit = rows.map((v, i) => v > 40 ? i : -1).filter(i => i >= 0), top = lit[0], bottom = lit.at(-1), mid = Math.round((top + bottom) / 2), near = Math.round(top + (mid - top) / 5)
  assert.ok(rows[mid] > rows[near] * 1.3, `the body brighter at its centre than near its peak: ${rows[mid]}, ${rows[near]} (${rows.join(' ')})`)
})

test('editor: the caret drags like an edge from its line, a press on the time row puts it there, and the moment under it sounds while held', async () => {
  await page.addInitScript(tap)
  await open()
  const { box, x } = await axis(6.525), row = box.y + box.height - 8, lane = box.y + tall(box) / 2
  // the mark in the bar: the logo at rest, the wave under the caret while it sounds, turned by the caret's travel
  const markShot = () => page.locator('.bar .wordmark .logo > canvas').screenshot()
  // how far apart two shots are, gray levels a pixel: a turn that ends back at the pose leaves a hair's width of it
  const gap = async (a, b) => page.evaluate(async ([a, b]) => {
    const read = async png => {
      const image = new Image()
      image.src = 'data:image/png;base64,' + png
      await image.decode()
      const context = new OffscreenCanvas(image.width, image.height).getContext('2d')
      context.drawImage(image, 0, 0)
      return context.getImageData(0, 0, image.width, image.height).data
    }
    const [x, y] = [await read(a), await read(b)]
    let sum = 0
    for (let i = 0; i < x.length; i += 4) sum += Math.abs(x[i] - y[i])
    return sum / (x.length / 4)
  }, [a.toString('base64'), b.toString('base64')])
  // the mark at rest, the run's turning over: two shots in a row alike
  await settled()
  let last = await markShot()
  const rest = (await poll(async () => [last, last = await markShot()], ([was, now]) => assert.ok(now.equals(was), 'the mark at rest')))[1]
  // a press on the time row puts the caret there and sounds the moment under it at once: sooner than the 200 ms a press
  // was once held for before it sounded, on a machine however busy
  await page.mouse.move(x(3), row)
  await page.mouse.down()
  // 150 ms into the press: shown and sounding by then
  await page.waitForTimeout(150)
  const under = await markShot()
  assert.ok(!under.equals(rest), 'the mark shows the moment under the caret')
  const pressed = await heard()
  assert.ok(pressed.finite && pressed.peak > .01, `sounds within 150 ms of the press: peak ${pressed.peak}`)
  await page.mouse.up()
  await page.locator('.time', { hasText: /^0:03\.000$/ }).waitFor()
  // its sound let go before the next press is heard
  await page.waitForTimeout(300)
  await heard()
  // the caret's line grabbed and held sounds; dragged, it moves, no range made
  await page.mouse.move(x(3), lane)
  await page.mouse.down()
  // held half a second, sounding
  await page.waitForTimeout(500)
  const before = await markShot()
  // dragged at a hand's pace, 20 ms a step
  for (let i = 1; i <= 10; i++) { await page.mouse.move(x(3 + i * .1), lane); await page.waitForTimeout(20) }
  assert.ok(!(await markShot()).equals(before), 'dragged, the mark turns with the caret')
  const held = await heard()
  assert.ok(held.finite && held.peak > .01 && held.peak <= 1, `peak ${held.peak}`)
  await page.mouse.up()
  await page.locator('.time', { hasText: /^0:04\.000$/ }).waitFor()
  // let go, it falls silent: its tail out, then 300 ms of nothing
  await page.waitForTimeout(300)
  await heard()
  await page.waitForTimeout(300)
  assert.equal((await heard()).peak, 0, 'silent after letting go')
  // and the mark is the logo again
  await poll(async () => gap(await markShot(), rest), apart => assert.ok(apart <= .5, `the mark comes back to the logo, ${apart} apart`))
})

// The time row is a ruler, as a DAW's: dragged, it selects from where it was pressed; clicked, the caret goes there
// alone, what is selected staying; held still 0.4 s (HOLD, view.js, as Play's), the caret, dragged, the
// selection staying; with Alt, another range beside it
test('editor: a drag on the time row selects, a click there moves the caret alone, held it drags the caret', async () => {
  await open()
  await noCues()
  const { box, x } = await axis(6.525), row = box.y + box.height - 8
  const caret = async () => { const [m, s] = (await page.locator('.time').innerText()).split(':'); return +m * 60 + +s }
  // pressed, held still `wait` ms (past HOLD, it drags the caret), then dragged
  const along = async (a, b, wait = 0) => { await page.mouse.move(x(a), row); await page.mouse.down(); await page.waitForTimeout(wait); for (let i = 1; i <= 8; i++) await page.mouse.move(x(a + (b - a) * i / 8), row); await page.mouse.up() }
  await along(1, 3)
  const range = await selected(), [a, b] = range.split('–').map(t => +t.split(':')[1])
  assert.ok(Math.abs(a - 1) < .03 && Math.abs(b - 3) < .03, `dragged, a range: ${range}`)
  assert.equal(await page.locator('.plot').evaluate(el => el.style.cursor), '', 'the I-beam over it, as over the lanes: it selects')
  await page.mouse.click(x(5), row)
  assert.ok(Math.abs(await caret() - 5) < .03, `clicked, the caret there: ${await caret()}`)
  assert.equal(await selected(), range, 'the range staying')
  await along(4, 4.5, 700)
  assert.ok(Math.abs(await caret() - 4.5) < .03, `held, the caret dragged: ${await caret()}`)
  assert.equal(await selected(), range, 'no range made, the one there staying')
  await keyed(['Alt'], () => along(5, 6))
  assert.match(await page.locator('.clock').evaluate(tipOf), /^Selected 2 ranges:/, 'with Alt, another')
})

// Zoomed in, the scrollbar at the time row's top, its labels under it, at the row's foot (view.js bar): its thumb
// dragged a quarter of the row across moves the view a quarter of the sound on, a press beside it takes the view there;
// the caret stays where it was. Showing all of it, there is none, and a press there moves the caret, as on the rest of
// the time row
test('editor: zoomed in, the scrollbar at the time row\'s top moves the view, the caret staying', async () => {
  await open()
  await noCues()
  await write(`audio('chime.wav')`)
  await lengthIs('0:08.000')
  const { box, x } = await axis(8), y = box.y + tall(box) * .3, foot = box.y + box.height - 22 + 4, w = box.width - (await gutter())
  const time = async () => (await page.locator('.time').innerText()).split(':').reduce((m, s) => m * 60 + +s, 0)
  const left = async () => { await page.mouse.click(box.x + 1, y); return time() }
  await page.mouse.click(x(6), foot)
  assert.ok(Math.abs(await time() - 6) < .05, `whole, the foot is the time row's: the caret at ${await time()}`)
  await page.mouse.click(x(2), y)
  await page.locator('.plot').focus()
  for (let i = 0; i < 2; i++) await page.keyboard.press('=')
  await frames()
  const before = await left(), caret = await time(), span = 8 / 4
  assert.ok(before > .5 && before < 2, `zoomed in: the view from ${before}`)
  // the thumb's middle, where the view shows
  const thumb = t => box.x + (t + span / 2) / 8 * w
  // a pixel under the lanes, 4 px thick at rest, as a native overlay scrollbar's; under the pointer 6 px, as the page's
  // scrollbars draw theirs (editor.css). The rows lit down the thumb's middle on its strip (view.js onStrip, the view's
  // width, from the lanes' foot): [thick, off], CSS px
  const drawn = () => page.evaluate(px => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(() => {
    const cv = document.querySelector('.plot canvas.scrollbar'), k = cv.width / cv.getBoundingClientRect().width, { data } = cv.getContext('2d').getImageData(Math.round(px * k), 0, 1, cv.height), rows = []
    for (let y = 0; y < cv.height; y++) if (data[y * 4 + 3] > 0) rows.push(y)
    done([rows.length / k, rows[0] / k])
  }))), thumb(before) - box.x)
  assert.deepEqual(await drawn(), [4, 1], 'the thumb, 4 px thick, a pixel under the lanes')
  await page.mouse.move(thumb(before), foot)
  assert.deepEqual(await drawn(), [6, 1], 'under the pointer, 6 px')
  // the strip laid anew as the thumb moves, cleared as its canvas is resized (kept.js), never by reset(): WebKit's
  // clears the bitmap but leaves the thumbs laid before on screen, a trail of them along the row
  await page.evaluate(() => { const reset = CanvasRenderingContext2D.prototype.reset; window.__resets = 0; CanvasRenderingContext2D.prototype.reset = function () { window.__resets++; return reset.call(this) } })
  await page.mouse.down()
  await page.mouse.move(thumb(before) + w / 8, foot, { steps: 4 })
  await page.mouse.move(thumb(before) + w / 4, foot, { steps: 4 })
  await page.mouse.up()
  assert.equal(await page.evaluate(() => window.__resets), 0, 'no layer reset()')
  assert.equal(await time(), caret, 'the caret where it was')
  const dragged = await left()
  assert.ok(Math.abs(dragged - before - 2) < .1, `a quarter of the row, a quarter of the sound: from ${before} to ${dragged}`)
  await page.mouse.click(box.x + 4, foot)
  assert.ok(await left() < .05, 'pressed at its start, the view from the start')
})
// On hover (the settings' Scroll, or the ui config's `scroll`), the scrollbar as an overlay scrollbar is (view.js
// barLight): shown while the pointer is over the picture, and for a second after the view is zoomed or scrolled; its
// layer faded out otherwise. Bar, always shown
test('editor: on hover, the scrollbar shows only while the pointer is over the picture or a second after a zoom', async () => {
  await open()
  await noCues()
  await write(`audio('chime.wav')`)
  await lengthIs('0:08.000')
  await settings('Scroll', 'Bar on hover')
  const shows = on => page.waitForFunction(o => document.querySelector('.plot canvas.scrollbar').style.opacity === o, on ? '1' : '0')
  const box = await page.locator('.plot').boundingBox()
  await page.mouse.move(1, 1)
  await shows(false)
  // zoomed in by the keys, the pointer away: shown, then gone a second after
  await page.locator('.plot').focus()
  await page.keyboard.press('=')
  await shows(true)
  const zoomed = Date.now()
  await shows(false)
  assert.ok(Date.now() - zoomed > 700, `held after the zoom: ${Date.now() - zoomed} ms`)
  // the pointer over the picture: shown, and kept while it stays
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await shows(true)
  const at = await page.evaluate(() => performance.now())
  await page.waitForFunction(t => performance.now() > t + 1500, at)
  assert.equal(await page.evaluate(() => document.querySelector('.plot canvas.scrollbar').style.opacity), '1', 'kept while the pointer stays')
  // the mouse gone, the bar with it, no second held
  const left = Date.now()
  await page.mouse.move(1, 1)
  await shows(false)
  assert.ok(Date.now() - left < 500, `held after the pointer left: ${Date.now() - left} ms`)
  // Bar: shown with the pointer away
  await settings('Scroll', 'Bar')
  await shows(true)
  // embedded, the ui config's scroll its start
  const src = await page.evaluate(async () => {
    await import('/playground/embed.js')
    document.body.innerHTML = `<audio-repl panel="none" ui='{"scroll":"hover"}'><pre><code>audio('/test/fixture.wav')</code></pre></audio-repl>`
    return new Promise(r => { const t = setInterval(() => { const f = document.querySelector('audio-repl iframe'); if (f) { clearInterval(t); r(f.getAttribute('src')) } }, 20) })
  })
  await page.goto(new URL(src, origin).href)
  await page.mouse.move(1, 1)
  // (the sound drawn, the layers over it lit)
  await page.waitForFunction(() => document.querySelector('.plot canvas.overlay')?.style.opacity === '1')
  await shows(false)
  const framed = await page.locator('.plot').boundingBox()
  await page.mouse.move(framed.x + framed.width / 2, framed.y + framed.height / 2)
  await shows(true)
})
// On a touch screen, nothing hovers: the bar on hover shows a second after a zoom, then hides, and a tap where it was
// is the time row's, the caret going there, the view staying where it is
test('editor: on hover, a tap where the hidden scrollbar was moves the caret, not the view', async () => {
  const phone = await browser.newContext({ viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true })
  const p = await phone.newPage()
  p.on('pageerror', e => errors.push(e.message))
  try {
    await p.route('**/playground/editor.js', async route => { const r = await route.fetch(); route.fulfill({ response: r, body: (await r.text()).replace('v = view(', 'v = globalThis.__view = view(') }) })
    await p.goto(origin + '/blank.html')
    const src = await p.evaluate(async () => {
      await import('/playground/embed.js')
      document.body.innerHTML = `<audio-repl panel="none" ui='{"scroll":"hover"}'><pre><code>audio('/test/fixture.wav')</code></pre></audio-repl>`
      return new Promise(r => { const t = setInterval(() => { const f = document.querySelector('audio-repl iframe'); if (f) { clearInterval(t); r(f.getAttribute('src')) } }, 20) })
    })
    await p.goto(new URL(src, origin).href)
    await p.waitForFunction(() => document.querySelector('.plot canvas.overlay')?.style.opacity === '1')
    const bar = o => p.waitForFunction(o => document.querySelector('.plot canvas.scrollbar').style.opacity === o, o)
    await p.locator('.plot').focus()
    for (let i = 0; i < 2; i++) await p.keyboard.press('=')
    await bar('1')
    await bar('0')
    const range = () => p.evaluate(() => __view.range), time = () => p.locator('.time').innerText()
    const [before, caret] = [await range(), await time()]
    // the bar's row at the picture's foot, near its right end: beside the thumb, which shown would take the view there
    const box = await p.locator('.plot').boundingBox(), w = box.width - parseFloat(await p.evaluate(() => getComputedStyle(document.querySelector('.panes')).getPropertyValue('--axis')))
    await p.touchscreen.tap(box.x + w * .9, box.y + box.height - 22 + 4)
    await p.waitForFunction(was => document.querySelector('.time').innerText !== was, caret)
    assert.deepEqual(await range(), before, 'the view where it was')
  } finally { await phone.close() }
})
// Zoomed out past the sound's end: its lanes' centre line on, faint, to the view's end, as the room's new track's is; the
// pointer's time on the time row there too, past the end, where nothing is yet
test('editor: past the sound\'s end, its centre line on to the view\'s end, the pointer\'s time on the row', async () => {
  await open()
  await noCues()
  await write(`audio('chime.wav')`)
  await lengthIs('0:08.000')
  await page.locator('.plot').focus()
  for (let i = 0; i < 2; i++) await page.keyboard.press('-')
  await settled()
  const box = await page.locator('.plot').boundingBox(), w = await spans(box), lane = tall(box)
  // the first lane's middle row past the end (the last tenth of the lanes, where the sound is not), its ink
  const line = () => pixels(`let n = 0; for (let x = Math.round(arg.w * .92); x < arg.w - 2; x++) { let most = 0; for (let y = arg.y - 1; y <= arg.y + 1; y++) { const i = (y * w + x) * 4; most = Math.max(most, d[i] + d[i + 1] + d[i + 2]) } if (most > 120) n++ } return n`, { w, y: Math.round(lane / 4) })
  await page.mouse.move(box.x + 5, box.y + box.height - 4)
  assert.ok(await line() > w * .07 - 4, `its centre line on past its end: ${await line()}`)
  // the pointer past the end, over the lanes: its tick on the row, where it is, bright
  const at = Math.round(w * .95)
  await page.mouse.move(box.x + at, box.y + lane / 2)
  await frames()
  const tick = await pixels(`for (let x = arg.at - 2; x <= arg.at + 2; x++) { const i = ((h - 6) * w + x) * 4; if (d[i] + d[i + 1] + d[i + 2] > 450) return x - arg.at } return null`, { at })
  assert.ok(tick != null, 'its time on the row, past the end')
})

// A trial (?row=band): the time row in the strip of the track pointed at, under its sound, not at the picture's foot;
// pointed elsewhere, under the edited track's
test('editor: ?row=band puts the time row in the strip of the track pointed at', async () => {
  await page.goto(origin + '/playground/?row=band')
  await wholeLevels().waitFor({ state: 'attached' })
  await noCues()
  await write(`let a = audio('chime.wav')\n\nlet b = audio('chime.wav')\n  .gain(-6)`)
  await page.waitForFunction(() => document.querySelector('.plot').dataset.tracks === '2')
  await lengthIs('0:08.000')
  const box = await page.locator('.plot').boundingBox(), lanes = await tracksAt()
  // the time row's text in rows [y0, y1) of the plot, across the lanes: light grey pixels
  const text = ([y0, y1]) => pixels(`let n = 0; for (let y = arg.y0; y < arg.y1; y++) for (let x = 0; x < arg.w; x++) { const i = (y * w + x) * 4; if (d[i] > 90 && Math.abs(d[i] - d[i + 2]) < 20) n++ } return n`, { y0, y1, w: Math.round(box.width - 80) })
  const strip = i => (y => [y + 2, y + FOOT - 2])(Math.round(lanes[i].y + lanes[i].h - box.y)), foot = [Math.round(box.height) - 10, Math.round(box.height)]
  // where the row is, once the pointer is at (px, py): the strips' and the foot's text
  const rowAt = async (px, py, want) => {
    await page.mouse.move(px, py)
    const read = async () => [await text(strip(0)), await text(strip(1)), await text(foot)]
    return poll(read, got => assert.equal(got.map(n => n > 30).join(), want.join()), 3000).catch(read)
  }
  const [a0, a1, af] = await rowAt(box.x + box.width / 2, lanes[0].y + lanes[0].h / 2, [true, false, false])
  assert.ok(a0 > 30 && a1 < 5 && af < 5, `pointed at a: under a, ${a0}; under b, ${a1}; at the foot, ${af}`)
  const [b0, b1, bf] = await rowAt(box.x + box.width / 2, lanes[1].y + lanes[1].h / 2, [false, true, false])
  assert.ok(b0 < 5 && b1 > 30 && bf < 5, `pointed at b: under a, ${b0}; under b, ${b1}; at the foot, ${bf}`)
  const [r0, r1] = await rowAt(box.x + box.width / 2, box.y + box.height - 4, [false, true, false])
  assert.ok(r0 < 5 && r1 > 30, `pointed under them: under the edited one, b: ${r0}, ${r1}`)
})
