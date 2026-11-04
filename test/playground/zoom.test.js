// Zoom: the pinch and the wheel, the view kept; the server, the page and the helpers in page.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { page, origin, readout, wholeLevels, open, settled, frames, selected, noCues, write, tall, gutter, spans, axis, boxDrag, lengthIs, hits, pixels, show, chime, crossed } from './page.js'

// A trackpad's pinch (Chrome's: Ctrl and the wheel, no key held, −100·ln s of deltaY for a spread s) zooms twice as far
// as the fingers spread, about the pointer, its events one by one or merged: spread 2×, the span a quarter. With Ctrl
// held, the wheel a fifth as keen, by e^(0.004·deltaY), at most 1.5× a turn of it: a Windows mouse's notch (100 px)
// 1.49×, a Mac's (40) 1.17×, a trackpad's swipe gently
test('editor: a pinch zooms twice as far as the fingers spread, the wheel with Ctrl more gently', async () => {
  await page.route('**/playground/editor.js', async route => { const r = await route.fetch(); route.fulfill({ response: r, body: (await r.text()).replace('v = view(', 'v = globalThis.__view = view(') }) })
  await open()
  await noCues()
  await write(`audio.from(t => Math.sin(2 * Math.PI * 220 * t) * .3, { duration: 20 })`)
  await lengthIs('0:20.000')
  // at a whole pixel: Chrome's pinch lands where its x truncates to, and half a pixel off there is more than the time
  // kept is held to
  const box = await page.locator('.plot').boundingBox(), w = box.width - (await gutter()), y = box.y + box.height / 3, px = Math.round(box.x + w * .3), k = (px - box.x) / w
  const range = () => page.evaluate(() => __view.range), span = async () => { const [a, b] = await range(); return b - a }
  const [a, b] = await range(), at = a + k * (b - a)
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Input.synthesizePinchGesture', { x: px, y, scaleFactor: 2, relativeSpeed: 800, gestureSourceType: 'mouse' })
  // its last events may still be on their way: the view as it settles
  let now = await range(), was
  do { was = now; await page.waitForTimeout(150); now = await range() } while (now[0] !== was[0] || now[1] !== was[1])
  const [p, q] = await range()
  assert.ok(Math.abs((q - p) / (b - a) - .25) < .005, `spread 2×, the span ×${((q - p) / (b - a)).toFixed(3)}`)
  assert.ok(Math.abs(p + k * (q - p) - at) < 1e-3 * (q - p), 'the time under the pointer kept')
  // its events merged into one, as when the page lags behind: as far all the same, here pinched in to half
  await page.evaluate(([x, y]) => document.querySelector('.plot').dispatchEvent(new WheelEvent('wheel', { deltaY: 100 * Math.log(2), ctrlKey: true, clientX: x, clientY: y, bubbles: true, cancelable: true })), [px, y])
  assert.ok(Math.abs(await span() / (q - p) - 4) < 1e-6, `merged, the span ×${(await span() / (q - p)).toFixed(3)}`)
  await page.mouse.move(px, y)
  // in, then out again, within the half again past the whole it zooms out to
  for (const dy of [-100, -40, 100, 40]) {
    const was = await span()
    await page.keyboard.down('Control'); await page.mouse.wheel(0, dy); await page.keyboard.up('Control')
    assert.ok(Math.abs(await span() / was - Math.exp(.004 * dy)) < 1e-6, `a ${dy} px notch: ×${(await span() / was).toFixed(3)}`)
  }
})

// On the log axis, 20 Hz to 24 kHz, a box a fifth of the lane tall spans a fifth of log2(1200) ≈ 2 octaves (×4.1).
// The wheel zooms along the axis it is on: on the frequencies (at the right of the picture) only them, on the times
// (the row below) only time; Ctrl and the wheel over the picture, a trackpad's pinch, only time. 0 shows all again.
test('editor: a pinch zooms the axis under the pointer, the frequencies or the times; the wheel scrolls; 0 shows all again', async () => {
  await open()
  await noCues()
  await write(hits)
  await lengthIs('0:02.000')
  await show('spec')
  const { box, x } = await axis(2)
  // a box, as a ratio of its top frequency to its bottom, and its times
  const band = async () => {
    await boxDrag([x(.5), box.y + tall(box) * .4], [x(1) - x(.5), tall(box) * .2])
    const [lo, hi] = (await readout()).match(/[\d.]+k?Hz/g).map(v => parseFloat(v) * (v.includes('k') ? 1000 : 1))
    const times = await selected()
    // the caret away from where the next box starts, which would drag it instead
    await page.keyboard.press('Escape')
    await page.mouse.click(x(1.9), box.y + box.height * .2)
    return [hi / lo, times]
  }
  const [whole, span] = await band()
  assert.ok(whole > 3 && whole < 4.6, `whole axis: ×${whole}`)
  assert.match(span, /^0:00\.50\d–0:01\.00\d$/)
  // Ctrl and the wheel (a trackpad's pinch) on the frequencies: they zoom, time stays
  const pinch = async (px, py) => { await page.mouse.move(px, py); for (let i = 0; i < 12; i++) { await page.keyboard.down('Control'); await page.mouse.wheel(0, -60); await page.keyboard.up('Control') } }
  await pinch(box.x + box.width - 20, box.y + box.height * .5)
  const [zoomed, same] = await band()
  assert.ok(zoomed < 1.5, `zoomed in: ×${zoomed}`)
  assert.equal(same, span)
  // the wheel alone there scrolls through them, as it scrolls a page: a box the same height spans the same ratio
  await page.mouse.move(box.x + box.width - 20, box.y + box.height * .5)
  for (let i = 0; i < 3; i++) await page.mouse.wheel(0, 60)
  const [scrolled] = await band()
  assert.ok(Math.abs(scrolled - zoomed) < .05, `the same span: ×${scrolled}`)
  await page.mouse.move(box.x + box.width - 20, box.y + box.height * .5)
  for (let i = 0; i < 3; i++) await page.mouse.wheel(0, -60)
  // Ctrl and the wheel over the picture: time zooms, the frequencies stay
  await page.mouse.move(x(1), box.y + box.height * .5)
  for (let i = 0; i < 12; i++) { await page.keyboard.down('Control'); await page.mouse.wheel(0, -60); await page.keyboard.up('Control') }
  const [kept, closer] = await band()
  assert.ok(Math.abs(kept - zoomed) < .05, `frequencies kept: ×${kept}`)
  assert.notEqual(closer, span)
  // on the times, Ctrl and the wheel zoom time
  await page.locator('.plot').focus()
  await page.keyboard.press('0')
  await pinch(x(1), box.y + box.height - 8)
  const [, ruler] = await band()
  assert.notEqual(ruler, span)
  await page.locator('.plot').focus()
  await page.keyboard.press('0')
  const [again, all] = await band()
  assert.ok(Math.abs(again - whole) < .3 && all === span, 'all of both again')
  // on the spectrum just before the frequencies, a pinch zooms them as there
  await pinch(box.x + box.width - (await gutter()) - 20, box.y + box.height * .5)
  const [strip, still] = await band()
  assert.ok(strip < 1.5 && still === span, `zoomed in from the spectrum: ×${strip}`)
})

// A key let go while the page heard nothing (a gesture under way, the window elsewhere) shows let go with the next wheel
// event, which has the keys as they are: ⌘'s aiming, held as the page last heard it, gone as the wheel turns
test('editor: the keys as a wheel event has them: ⌘ let go unheard, the aiming goes with the wheel', async () => {
  const { x, y } = await chime()
  await page.mouse.move(x(3), y)
  await page.evaluate(() => dispatchEvent(new KeyboardEvent('keydown', { key: 'Meta', metaKey: true, ctrlKey: !/Mac/.test(navigator.platform) })))
  if (await page.evaluate(() => /Mac/.test(navigator.platform))) await crossed()
  else return
  await page.mouse.wheel(0, 10)
  await page.waitForFunction(() => document.querySelector('.plot').style.cursor !== 'crosshair')
})

// A view kept from before shows at once on a reload, the sound coming into it as it arrives, not all of it first
test('editor: after a reload the view is where it was left while its sound still arrives', async () => {
  await open()
  await noCues()
  await write(`audio('${origin}/slow/test/fixture.wav')`)
  await page.waitForFunction(() => !document.querySelector('.message').textContent && (e => e.title || e.dataset.tip || '')(document.querySelector('.source')).endsWith('0:02.000'), null, { timeout: 30000 })
  const { box, x } = await axis(2), y = box.y + tall(box) * .3
  const left = async () => { await page.mouse.click(box.x + 1, y); return (await page.locator('.time').innerText()).split(':').reduce((m, s) => m * 60 + +s, 0) }
  await page.mouse.click(x(1.5), y)
  await page.locator('.plot').focus()
  for (let i = 0; i < 2; i++) await page.keyboard.press('=')
  await frames()
  const before = await left()
  assert.ok(before > .8, `zoomed in about the caret: the view from ${before}`)
  // before the engine is up (its worker held back a second and a half), the view is there, where it was left
  const worker = '**/playground/dist/worker.js'
  await page.route(worker, async route => { await new Promise(r => setTimeout(r, 1500)); await route.continue() })
  const shown = Date.now()
  await page.reload()
  await page.locator('.plot canvas').first().waitFor()
  assert.ok(Math.abs(await left() - before) < .01, 'where it was, before the engine is up')
  assert.match(await page.locator('.message').textContent(), /^(Decoding)?$/, 'nothing come yet')
  assert.ok(Date.now() - shown < 1500, 'before the worker came')
  await page.unroute(worker)
  await page.locator('.message', { hasText: /^Decoding/ }).waitFor()
  // past the 250 ms a view held waits (editor.js WAIT): the file shows as it comes, the view not moved by it
  await page.waitForTimeout(300)
  assert.ok(Math.abs(await left() - before) < .01, 'where it was, while it loads')
  await page.waitForFunction(() => !document.querySelector('.message').textContent && (e => e.title || e.dataset.tip || '')(document.querySelector('.source')).endsWith('0:02.000'), null, { timeout: 30000 })
  await settled()
  assert.ok(Math.abs(await left() - before) < .01, 'and once it is whole')
  // an edit that waits for the whole file (normalize): the file shows dim as it arrives, in the view as it was left
  await write(`audio('${origin}/slow/test/fixture.wav').normalize()`)
  await page.waitForFunction(() => !document.querySelector('.message').textContent && (e => e.title || e.dataset.tip || '')(document.querySelector('.source')).endsWith('0:02.000'), null, { timeout: 30000 })
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('audio-repl')).docs.some(d => d.code.includes('.normalize()')))
  await page.reload()
  await page.locator('.message', { hasText: /^Decoding/ }).waitFor()
  // past the 250 ms a view held waits (editor.js WAIT): the file shows dim as it comes, the view not moved by it
  await page.waitForTimeout(300)
  assert.ok(Math.abs(await left() - before) < .01, 'the file, dim, where it was')
  await page.waitForFunction(() => !document.querySelector('.message').textContent && (e => e.title || e.dataset.tip || '')(document.querySelector('.source')).endsWith('0:02.000'), null, { timeout: 30000 })
  await settled()
  assert.ok(Math.abs(await left() - before) < .01, 'its output too')
})

// A view kept from before that makes no sense (another version's, edited by hand) is let go: the sound shows whole
test('editor: a kept view that makes no sense shows the sound whole', async () => {
  await page.addInitScript(() => localStorage.setItem('audio-repl', JSON.stringify({ docs: [{ code: `audio('chime.wav')`, frame: { range: [5, 'x'], freqs: [1, 0], levels: null, duration: 8, rate: 0, channels: 1e6 } }] })))
  await open()
  await lengthIs('0:08.000')
  const { box } = await axis(8), y = box.y + tall(box) * .3
  await page.mouse.click(box.x + 1, y)
  assert.ok((await page.locator('.time').innerText()).split(':').reduce((m, s) => m * 60 + +s, 0) < .05, 'from its start')
})

// Zoomed out as far as it goes, the lanes show the sound and a third of it again (zoom.out 4/3, a quarter of the view
// room after it): two presses of −, the second held there
test('editor: zoomed out past the whole, the sound starts at the left and the room is on its right', async () => {
  await open()
  await page.locator('.plot').focus()
  for (let i = 0; i < 2; i++) await page.keyboard.press('-')
  await settled()
  // lit columns of the picture, the labels at its right left out
  const [first, last] = await pixels(`let a = -1, b = -1; for (let x = 0; x < w - 60; x++) { let lit = 0; for (let y = 0; y < h * .8; y += 2) { const i = (y * w + x) * 4; if (d[i] + d[i + 1] + d[i + 2] > 300) lit++ } if (lit > 3) { if (a < 0) a = x; b = x } } return [a / w, b / w]`)
  const box = await page.locator('.plot').boundingBox(), lanes = await spans(box) / box.width
  // its end, its tail faint, short of three quarters of the lanes and past half of them (zoomed out to twice it, it would
  // end there)
  assert.ok(first < .03 && last < lanes * 3 / 4 && last > lanes / 2, `lit from ${first} to ${last}, the lanes to ${lanes}`)
})

// A view zoomed out past the sound's end, the room on its right, is kept as it was left: a reload shows the sound at the
// same scale, not fitted to the view; an edit that shortens it, as far out as the shorter one goes, not fitted either;
// one that makes it longer than the view, fitted
test('editor: a view zoomed out past the end stays so after a reload', async () => {
  await open()
  await noCues()
  await write(`audio('chime.wav')`)
  await lengthIs('0:08.000')
  await page.locator('.plot').focus()
  for (let i = 0; i < 2; i++) await page.keyboard.press('-')
  await settled()
  // the time at `t` s on a view `across` s wide: zoomed out as far as it goes, the sound and a third of it again, 10.67 s,
  // 3/8 of the way across is 4 s in, where fitted to the sound it would be 3 s
  const at = async (t = 4, across = 32 / 3) => {
    const { box, x } = await axis(across)
    await page.mouse.click(x(t), box.y + tall(box) * .3)
    return (await page.locator('.time').innerText()).split(':').reduce((m, s) => m * 60 + +s, 0)
  }
  assert.ok(Math.abs(await at() - 4) < .1, 'zoomed out')
  await page.waitForFunction(() => (s => (r => r[1] - r[0] > 10)(s.docs[s.doc].frame?.range ?? [0, 0]))(JSON.parse(localStorage.getItem('audio-repl'))))
  await page.reload()
  await wholeLevels().waitFor()
  await settled()
  assert.ok(Math.abs(await at() - 4) < .1, 'as it was left')
  await write(`audio('chime.wav').crop({ at: 0, duration: 4 })`)
  await lengthIs('0:04.000')
  await settled()
  // 5.33 s wide: 3/8 of the way across is 2 s in, where fitted it would be 1.5 s
  assert.ok(Math.abs(await at(2, 16 / 3) - 2) < .1, 'shortened: as far out as it goes')
  await write(`audio('chime.wav').speed(0.2)`)
  await lengthIs('0:40.000')
  await settled()
  assert.ok(Math.abs(await at(10, 40) - 10) < .1, 'longer than the view: all of it')
})
