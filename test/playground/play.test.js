// Playing: the playhead and the view following it, the shuttle, Loop and Before, the mark, scrubbing; the server, the
// page and the helpers in page.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { page, origin, readout, tipOf, open, settled, frames, poll, settings, selected, menu, facts, noCues, write, LANES, FOOT, tall, tracksAt, gutter, axis, grab, boxDrag, drag, lengthIs, tap, taken, heard, show, chime, measuredOnRow, crossed } from './page.js'

// Before, a key at the bar's right end, after the rate and channels: pressed, the file as it opened, as B does, lit while it is heard; again, or B,
// the output. A generated sound has no file to hear it against: the key is off
test('editor: Before, at the bar\'s right, hears the file as it opened, lit while it does; off for a generated sound', async () => {
  await open()
  await write(`audio('chime.wav').gain(-6)`)
  await lengthIs('0:08.000')
  const before = page.getByRole('button', { name: 'Before', exact: true })
  await page.waitForFunction(() => !document.querySelector('button.before').disabled)
  assert.equal(await before.getAttribute('aria-pressed'), 'false')
  await before.click()
  await page.waitForFunction(() => document.querySelector('button.before').getAttribute('aria-pressed') === 'true')
  assert.match(await page.locator('.status').innerText(), /Hearing before the edits/)
  const lit = await before.evaluate(e => getComputedStyle(e).backgroundColor)
  await page.mouse.move(2, 2)
  assert.equal(await before.evaluate(e => getComputedStyle(e).backgroundColor), lit, 'lit, the pointer on it or not')
  await page.locator('.plot').focus()
  await page.keyboard.press('b')
  await page.waitForFunction(() => document.querySelector('button.before').getAttribute('aria-pressed') === 'false')
  await write(`audio.from(t => Math.sin(2 * Math.PI * 440 * t), { duration: 1 })`)
  await lengthIs('0:01.000')
  assert.equal(await before.isDisabled(), true, 'a generated sound: nothing to hear it against')
})

// B: the file as it opened, level-matched, at the same place; B again, the output. What is heard is said over the picture
// and checked in Play > Hear it before the edits
test('editor: B plays the file as it opened, level-matched to the result, and a new output returns to the result', async () => {
  await open()
  const heardBefore = async () => { await page.locator('.menubar-item', { hasText: /^Transport$/ }).click(); const on = await page.locator('.menubar-list .menu-row', { has: page.locator('.menu-label', { hasText: /^Hear it before the edits$/ }) }).getAttribute('aria-checked'); await page.keyboard.press('Escape'); return on === 'true' }
  await page.locator('body').press('b')
  await page.locator('.message', { hasText: /^Hearing before the edits: the file as it opened, level-matched \([+−]\d+\.\ddB\)/ }).waitFor()
  assert.ok(await heardBefore())
  await page.locator('body').press('b')
  await page.locator('.message', { hasText: 'Hearing the output, after the edits' }).waitFor()
  assert.ok(!await heardBefore())
  await page.locator('body').press('b')
  await page.locator('.message', { hasText: /^Hearing before the edits/ }).waitFor()
  await write(`audio('chime.wav').normalize(-6)`)
  await page.locator('.readout', { hasText: '−6.0dBFS' }).waitFor()
  assert.ok(!await heardBefore(), 'the new output is heard')
  await write(`audio.from(t => Math.sin(2 * Math.PI * 440 * t), { duration: 1 })`)
  await page.locator('.source', { hasText: 'generated' }).waitFor()
  await page.locator('.plot').focus()
  await page.keyboard.press('b')
  await page.locator('.message', { hasText: 'A generated sound has no file as it opened' }).waitFor()
})

// Play pressed while it plays pauses at its release (a press held still searches), the caret where the playhead line
// got to, not back where the press was, as Space's pause leaves it
test('editor: Play let go pauses with the caret where the playhead got to, as Space does', async () => {
  await page.route('**/playground/editor.js', async route => { const r = await route.fetch(); route.fulfill({ response: r, body: (await r.text()).replace('v = view(', 'v = globalThis.__view = view(') }) })
  await open()
  await write(`audio.from(t => Math.sin(2 * Math.PI * 220 * t) * .3, { duration: 20 })`)
  await lengthIs('0:20.000')
  await page.locator('.plot').focus()
  await page.keyboard.press('Space')
  await page.waitForFunction(() => __view.playhead > .5)
  const box = await page.locator('button.play').boundingBox()
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  const pressed = await page.evaluate(() => __view.playhead)
  await page.waitForFunction(p => __view.playhead - p > .25, pressed, { timeout: 5000 }).catch(() => {})
  const before = await page.evaluate(() => __view.playhead)
  await page.mouse.up()
  await page.getByRole('button', { name: 'Play', exact: true }).waitFor()
  const caret = await page.evaluate(() => __view.cursor)
  assert.ok(before - pressed > .2, `played on while held: ${pressed} → ${before}`)
  assert.ok(caret >= before - .01 && caret - before < .2, `the caret ${caret.toFixed(3)} where the line got to, ${before.toFixed(3)}, not back at ${pressed.toFixed(3)}`)
})

test('editor: play moves the clock, and a new output keeps playing where it was', async () => {
  await open()
  await page.locator('body').press('Space')
  await page.getByRole('button', { name: 'Pause' }).waitFor()
  await page.waitForFunction(() => document.querySelector('.time').textContent > '0:00.300')
  await write(`audio('chime.wav').normalize(-6)`)
  await page.locator('.readout', { hasText: '−6.0dBFS' }).waitFor()
  assert.ok(await page.getByRole('button', { name: 'Pause' }).isVisible())
  await page.getByRole('button', { name: 'Pause' }).click()
  await page.getByRole('button', { name: 'Play' }).waitFor()
})

test('editor: playback goes on without a gap while the page is busy', async () => {
  await page.addInitScript(taken)
  await open()
  await write(`audio.from(t => Math.sin(2 * Math.PI * 440 * t) / 2, { duration: 8 })`)
  await page.locator('.readout', { hasText: '−6.0dBFS' }).waitFor()
  await page.locator('.plot').focus()
  await page.keyboard.press('Space')
  await page.getByRole('button', { name: 'Pause' }).waitFor()
  await page.waitForFunction(() => document.querySelector('.time').textContent > '0:00.300')
  await page.evaluate(() => { window.__taken.length = 0; const t = performance.now(); while (performance.now() - t < 3000); })
  // the feed taken while the page was held, come to it after
  await page.waitForFunction(() => window.__taken.reduce((n, b) => n + b.length, 0) > window.__rate * 3, null, { timeout: 5000 }).catch(() => {})
  const [x, sr] = await page.evaluate(() => [window.__taken.flatMap(b => [...b]), window.__rate])
  // the longest run of silence while it played: a sine has none longer than a sample or two
  let run = 0, longest = 0
  for (const v of x) { run = Math.abs(v) < 1e-4 ? run + 1 : 0; longest = Math.max(longest, run) }
  assert.ok(x.length > sr * 3, `${x.length} samples taken`)
  assert.ok(longest < sr * .005, `a gap of ${(longest / sr * 1000).toFixed(0)} ms`)
  await page.getByRole('button', { name: 'Pause' }).click()
})

// Playback is the deck's (engine.js), a worker of its own: a script holding the engine 3 s, then its output taking over
// as it plays, leaves no gap in what is heard
test('editor: playback goes on without a gap while the engine processes, and its output takes over', async () => {
  await page.addInitScript(taken)
  await open()
  const sine = `audio.from(t => Math.sin(2 * Math.PI * 440 * t) / 2, { duration: 12 })`
  await write(sine)
  await page.locator('.readout', { hasText: '−6.0dBFS' }).waitFor()
  await page.locator('.plot').focus()
  await page.keyboard.press('Space')
  await page.getByRole('button', { name: 'Pause' }).waitFor()
  await page.waitForFunction(() => document.querySelector('.time').textContent > '0:00.300')
  await page.evaluate(() => { window.__taken.length = 0 })
  await write(`const s0 = performance.now()\nwhile (performance.now() - s0 < 3000);\n${sine}.gain(-1)`)
  await page.locator('.readout', { hasText: '−7.0dBFS' }).waitFor({ timeout: 15000 })
  // half a second heard past the takeover
  await page.waitForTimeout(500)
  const [x, sr] = await page.evaluate(() => [window.__taken.flatMap(b => [...b]), window.__rate])
  let run = 0, longest = 0
  for (const v of x) { run = Math.abs(v) < 1e-4 ? run + 1 : 0; longest = Math.max(longest, run) }
  assert.ok(x.length > sr * 3.5, `${x.length} samples taken`)
  assert.ok(longest < sr * .005, `a gap of ${(longest / sr * 1000).toFixed(0)} ms`)
  assert.equal(await page.getByRole('button', { name: 'Pause' }).count(), 1, 'still playing')
  await page.getByRole('button', { name: 'Pause' }).click()
})

test('editor: the caret goes where the pointer presses; Play starts on its press; the loop switch leaves Space to play', async () => {
  await open()
  const { box, x } = await axis(6.525)
  await page.mouse.move(x(2), box.y + tall(box) / 2)
  await page.mouse.down()
  // times go by the zoom's 1-2-5 step just above a pixel (view.js unit): 6.5 s over this plot, 0.02 s
  await page.locator('.time', { hasText: /^0:02\.000$/ }).waitFor()
  await page.mouse.move(x(3), box.y + tall(box) / 2, { steps: 4 })
  await page.mouse.up()
  // the clock shows the caret (where the drag left the selection's moving end), one time always, in the units the
  // settings choose, as the time row writes them; after it how long the selection is, in white, between bars as a length
  // is marked; pointed at, the selection and its samples. The display above the levels still says what the sound is.
  // The settings keep the selection
  const length = () => page.locator('.length').innerText()
  assert.equal(await page.locator('.time').innerText(), '0:03.000')
  assert.equal(await length(), '0:01.000')
  const white = await page.evaluate(() => { const i = document.body.appendChild(document.createElement('i')); i.style.color = 'var(--color-screen-bright)'; const c = getComputedStyle(i).color; i.remove(); return c })
  assert.equal(await page.locator('.length').evaluate(el => getComputedStyle(el).color), white)
  assert.match(await page.locator('.clock').evaluate(tipOf), /^Selected 0:02\.000–0:03\.000: 0:01\.000, 44100 samples/)
  assert.equal(await facts(), '44.1kHz stereo 16-bit')
  assert.match(await readout(), /^−/)
  await settings('Times in', 's')
  assert.equal(await page.locator('.time').innerText(), '3.000s')
  assert.equal(await length(), '1.000s')
  await settings('Times in', 'samples')
  assert.equal(await selected(), '88200–132300')
  assert.equal(await length(), '44100')
  await settings('Times in', 'm:s')
  assert.equal(await selected(), '0:02.000–0:03.000')
  // the press alone plays; the release changes nothing
  const play = await page.locator('button.play').boundingBox()
  await page.mouse.move(play.x + play.width / 2, play.y + play.height / 2)
  await page.mouse.down()
  await page.getByRole('button', { name: 'Pause' }).waitFor()
  await page.mouse.up()
  await frames()
  assert.ok(await page.getByRole('button', { name: 'Pause' }).isVisible())
  await page.keyboard.press('Space')
  await page.getByRole('button', { name: 'Play', exact: true }).waitFor()
  // the loop switch toggles without taking focus, so Space still plays
  await page.getByRole('button', { name: 'Loop' }).click()
  assert.equal(await page.getByRole('button', { name: 'Loop' }).getAttribute('aria-pressed'), 'true')
  assert.notEqual(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')), 'Loop')
  await page.keyboard.press('Space')
  await page.getByRole('button', { name: 'Pause' }).waitFor()
  assert.equal(await page.getByRole('button', { name: 'Loop' }).getAttribute('aria-pressed'), 'true')
})

test('editor: the playhead starts at the caret and only moves on, however late the device sounds', async () => {
  await open()
  const { box, x } = await axis(6.525)
  await page.mouse.click(x(2), box.y + tall(box) / 2)
  await page.locator('.time', { hasText: '0:02.000' }).waitFor()
  await page.keyboard.press('Space')
  // the clock each frame for half a second: never before 2 s (the device lags the render), never backwards
  const times = await page.evaluate(() => new Promise(done => {
    const out = [], end = performance.now() + 500
    const read = () => { const [m, s] = document.querySelector('.time').textContent.split(':'); out.push(+m * 60 + +s); performance.now() < end ? requestAnimationFrame(read) : done(out) }
    read()
  }))
  assert.ok(times.every(t => t >= 2), times.join())
  assert.ok(times.every((t, i) => !i || t >= times[i - 1]), times.join())
  assert.ok(times.at(-1) > 2.2, times.at(-1))
})

// The caret put elsewhere while it plays, ahead or back: from the press on, the clock reads where it went and runs on from
// there, never a frame where it was (what the speakers still play of it)
test('editor: the caret put elsewhere while it plays goes there at once, never back', async () => {
  await open()
  const { box, x } = await axis(6.525), y = box.y + tall(box) / 2
  await page.mouse.click(x(1), y)
  await page.keyboard.press('Space')
  await page.waitForFunction(() => document.querySelector('.play')?.getAttribute('aria-label') === 'Pause')
  // sounding, the speakers' place running ahead of the caret
  await page.waitForTimeout(800)
  // the clock each frame after a press at `to` s
  const after = async to => {
    await page.evaluate(() => {
      window.__clock = []
      addEventListener('pointerdown', () => { window.__pressed = performance.now() }, { once: true, capture: true })
      const end = performance.now() + 1500, read = () => { const [m, s] = document.querySelector('.time').textContent.split(':'); window.__clock.push([performance.now(), +m * 60 + +s]); performance.now() < end && requestAnimationFrame(read) }
      read()
    })
    await page.mouse.click(x(to), y)
    await page.waitForFunction(() => window.__clock.filter(([t]) => t > window.__pressed).length >= 20, null, { timeout: 2000 }).catch(() => {})
    return page.evaluate(() => window.__clock.filter(([t]) => t > window.__pressed).slice(0, 20).map(([, s]) => s))
  }
  for (const to of [4, .5]) {
    const times = await after(to)
    assert.ok(times.length > 3, times.join())
    assert.ok(times.every(t => t >= to - .01 && t < to + 1), `from ${to} s: ${times.join()}`)
    assert.ok(times.every((t, i) => !i || t >= times[i - 1]), times.join())
  }
  await page.keyboard.press('Space')
})

// Played from a caret past the middle of a zoomed view, the view glides till the playhead holds the middle, never
// jumping there: where it stands across the view, read once paused from the caret and the times two clicks put
test('editor: played from past the middle of a zoomed view, the view glides the playhead to the middle', async () => {
  await open()
  await noCues()
  await write(`audio.from(t => Math.sin(2 * Math.PI * 220 * t) * .3, { duration: 20 })`)
  await lengthIs('0:20.000')
  const box = await page.locator('.plot').boundingBox(), w = box.width - (await gutter()), y = box.y + tall(box) / 2, at = f => box.x + f * w
  await page.mouse.move(at(.5), y)
  for (let i = 0; i < 7; i++) { await page.keyboard.down('Control'); await page.mouse.wheel(0, -120); await page.keyboard.up('Control') }
  const time = async () => { const [m, s] = (await page.locator('.time').innerText()).split(':'); return +m * 60 + +s }
  const across = async () => {
    const t = await time()
    await page.mouse.click(at(.1), y)
    const a = await time()
    await page.mouse.click(at(.9), y)
    const b = await time()
    return .1 + (t - a) / (b - a) * .8
  }
  const play = async ms => {
    await page.mouse.click(at(.85), y)
    await page.keyboard.press('Space')
    await page.waitForFunction(() => document.querySelector('.play')?.getAttribute('aria-label') === 'Pause')
    // played `ms`: just started, or long enough to have glided
    await page.waitForTimeout(ms)
    await page.keyboard.press('Space')
    return across()
  }
  const soon = await play(50), later = await play(2500)
  assert.ok(soon > .65, `just after it starts, still where it started: ${soon.toFixed(2)}`)
  // (the clock, read paused, is a frame or so past the playhead last drawn)
  assert.ok(Math.abs(later - .5) < .1, `then in the middle: ${later.toFixed(2)}`)
})

// Scrolled while it plays, the view is the hand's: ahead of the playhead or behind it, it stays where it was put; once
// the playhead, seen in it, passes its edge, the view follows again, gliding the playhead to its middle
test('editor: scrolled while it plays, the view stays where it was put till the playhead passes its edge, then follows', async () => {
  await page.route('**/playground/editor.js', async route => { const r = await route.fetch(); route.fulfill({ response: r, body: (await r.text()).replace('v = view(', 'v = globalThis.__view = view(') }) })
  await open()
  await noCues()
  await write(`audio.from(t => Math.sin(2 * Math.PI * 220 * t) * .3, { duration: 20 })`)
  await lengthIs('0:20.000')
  const box = await page.locator('.plot').boundingBox(), w = box.width - (await gutter()), y = box.y + tall(box) / 3
  await page.mouse.move(box.x + 20, y)
  for (let i = 0; i < 10; i++) { await page.keyboard.down('Control'); await page.mouse.wheel(0, -120); await page.keyboard.up('Control') }
  await page.mouse.click(box.x + 20, y)
  await page.keyboard.press('Space')
  await page.waitForFunction(() => document.querySelector('.play')?.getAttribute('aria-label') === 'Pause')
  const range = () => page.evaluate(() => __view.range), time = async () => { const [m, s] = (await page.locator('.time').innerText()).split(':'); return +m * 60 + +s }
  // played a while, followed
  await page.waitForTimeout(600)
  for (const [where, by] of [['ahead', 3], ['behind', -5]]) {
    await page.mouse.wheel(0, w * by)
    await frames()
    const put = await range()
    // half a second on, playing: not taken back to the playhead
    await page.waitForTimeout(500)
    assert.deepEqual(await range(), put, `${where}, left where it was put`)
  }
  // the playhead in sight, near the left edge: it crosses the view and passes its right edge, and the view follows it to
  // the middle
  const [a, b] = await range(), t = await time()
  await page.mouse.wheel(0, (t - .1 * (b - a) - a) / (b - a) * w)
  const put = await range()
  // a moment on, playing: not taken back to the playhead
  await page.waitForTimeout(100)
  assert.deepEqual(await range(), put, 'in sight, left where it was put')
  // the clock and the view read in one go: a frame apart, the view's span is a few frames' play
  await poll(() => page.evaluate(() => { const [m, s] = document.querySelector('.time').textContent.split(':'), [p, q] = __view.range; return [p, (+m * 60 + +s - p) / (q - p)] }), ([c, at]) => assert.ok(c > put[0] && Math.abs(at - .5) < .15, `past the edge, followed: ${at.toFixed(2)} across`))
  // over the scrollbar, at the time row's top, the arrow, as over any scrollbar
  await page.mouse.move(box.x + w / 2, box.y + box.height - 22 + 4)
  assert.equal(await page.locator('.plot').evaluate(e => e.style.cursor), 'default')
  await page.keyboard.press('Space')
})

// Zoomed while it plays, the view scales about the playhead, wherever the pointer is, and goes on following it: a zoom
// is no hand's scroll taking the view off it. Scrolled away by hand, the view is the hand's, a zoom there the pointer's
test('editor: zoomed while it plays, about the playhead, still followed', async () => {
  await page.route('**/playground/editor.js', async route => { const r = await route.fetch(); route.fulfill({ response: r, body: (await r.text()).replace('v = view(', 'v = globalThis.__view = view(') }) })
  await open()
  await noCues()
  await write(`audio.from(t => Math.sin(2 * Math.PI * 220 * t) * .3, { duration: 20 })`)
  await lengthIs('0:20.000')
  const box = await page.locator('.plot').boundingBox(), w = box.width - (await gutter()), y = box.y + tall(box) / 3
  await page.mouse.move(box.x + 20, y)
  for (let i = 0; i < 10; i++) { await page.keyboard.down('Control'); await page.mouse.wheel(0, -120); await page.keyboard.up('Control') }
  await page.mouse.click(box.x + 20, y)
  await page.keyboard.press('Space')
  await page.waitForFunction(() => document.querySelector('.play')?.getAttribute('aria-label') === 'Pause')
  // played a while: followed, the playhead held in the middle
  await page.waitForTimeout(1000)
  const range = () => page.evaluate(() => __view.range)
  const across = () => page.evaluate(() => { const [a, b] = __view.range; return (__view.playhead - a) / (b - a) })
  const was = await across()
  // the pointer at the left edge, far from the playhead in the middle: in, then out past where it was, by the wheel and
  // by the keys
  for (const [dy, key] of [[-120, '='], [-120, null], [120, '-'], [120, null], [120, null]]) {
    await page.keyboard.down('Control'); await page.mouse.wheel(0, dy); await page.keyboard.up('Control')
    if (key) await page.keyboard.press(key)
    assert.ok(Math.abs(await across() - was) < .05, `the playhead where it was: ${was.toFixed(2)} → ${(await across()).toFixed(2)} across`)
  }
  // playing on a second after the zooms: still followed
  await page.waitForTimeout(1000)
  const at = await across()
  assert.ok(Math.abs(at - .5) < .1, `followed on: ${at.toFixed(2)} across`)
  // scrolled away by hand, the view the hand's: a zoom there keeps the time under the pointer, the playhead not followed
  await page.mouse.move(box.x + w / 2, y)
  await page.mouse.wheel(0, w * 3)
  await frames()
  const pointed = async () => { const [a, b] = await range(); return a + (b - a) / 2 }, t = await pointed()
  await page.keyboard.down('Control'); await page.mouse.wheel(0, -120); await page.keyboard.up('Control')
  const put = await range()
  assert.ok(Math.abs(await pointed() - t) < 1e-3 * (put[1] - put[0]), `the time under the pointer kept: ${t.toFixed(3)} → ${(await pointed()).toFixed(3)}`)
  // half a second on, playing: not taken back to the playhead
  await page.waitForTimeout(500)
  assert.deepEqual(await range(), put, 'left where it was put')
  await page.keyboard.press('Space')
})

// Followed, the pictures and what is drawn in time over them are on a reel drawn past the view's end: the compositor
// runs it on at the speed it plays at, an animation left to run, the pictures drawn again only as the view nears their end
// (the waveform's canvas wider than the view)
test('editor: followed, the reel runs on by the compositor, its pictures not drawn each frame', async () => {
  await open()
  await noCues()
  await write(`audio.from(t => Math.sin(2 * Math.PI * 220 * t) * .3, { duration: 20 })`)
  await lengthIs('0:20.000')
  const box = await page.locator('.plot').boundingBox(), w = box.width - (await gutter()), y = box.y + box.height / 3
  await page.mouse.move(box.x + w * .1, y)
  for (let i = 0; i < 9; i++) { await page.keyboard.down('Control'); await page.mouse.wheel(0, -120); await page.keyboard.up('Control') }
  await page.mouse.click(box.x + w * .6, y)
  await page.mouse.move(box.x + w * .1, box.y - 20)
  await page.evaluate(() => {
    const reel = document.querySelector('.plot .reel'), animate = reel.animate.bind(reel), gl = document.querySelector('.plot canvas.waveform').getContext('webgl2')
    window.__set = 0; window.__drawn = 0
    reel.animate = (...a) => { window.__set++; return animate(...a) }
    const clear = gl.clear.bind(gl)
    gl.clear = m => { window.__drawn++; clear(m) }
  })
  await page.keyboard.press('Space')
  await page.waitForFunction(() => document.querySelector('.play')?.getAttribute('aria-label') === 'Pause')
  // played a while: followed, the view steady
  await page.waitForTimeout(1500)
  const [set0, drawn0, frames] = await page.evaluate(() => new Promise(done => { const s = [window.__set, window.__drawn]; let n = 0; const f = () => ++n < 60 ? requestAnimationFrame(f) : done([...s, n]); requestAnimationFrame(f) }))
  const [set1, drawn1, running, wide] = await page.evaluate(() => [window.__set, window.__drawn, document.querySelector('.plot .reel').getAnimations().filter(a => a.playState === 'running').length, document.querySelector('.plot canvas.waveform').clientWidth / document.querySelector('.plot').clientWidth])
  await page.keyboard.press('Space')
  // drawn again only as the view nears the tape's end (here, zoomed in to half a second, a few times a second), the
  // animation set again only then
  assert.equal(running, 1, 'the reel runs on')
  assert.ok(drawn1 - drawn0 <= frames / 6, `the waveform drawn ${drawn1 - drawn0} times over ${frames} frames`)
  assert.ok(set1 - set0 <= drawn1 - drawn0 + 2, `its animation set ${set1 - set0} times, drawn ${drawn1 - drawn0}`)
  assert.ok(wide > 1.3, `the waveform's canvas ${wide.toFixed(2)} views wide`)
  // the reel past the view's end is no overflow of the page's: nothing around the picture has more to scroll to (a focus
  // once scrolled the picture half off its pane)
  const over = await page.evaluate(() => { const out = []; for (let e = document.querySelector('.plot'); e; e = e.parentElement) if (e.scrollWidth > e.clientWidth + 1) out.push(e.className); return out })
  assert.deepEqual(over, [], 'no overflow around the picture')
})

// Followed, the view's start sits on the device's pixels, so the waveform and the marks over it step a whole pixel at a
// time together, and the playhead stays on one pixel column, never a pixel back and forth
test('editor: followed, the view steps by whole device pixels and the playhead holds its column', async () => {
  await page.route('**/playground/editor.js', async route => { const r = await route.fetch(); route.fulfill({ response: r, body: (await r.text()).replace('v = view(', 'v = globalThis.__view = view(') }) })
  await open()
  await noCues()
  await write(`audio.from(t => Math.sin(2 * Math.PI * 220 * t) * .3, { duration: 20 })`)
  await lengthIs('0:20.000')
  const box = await page.locator('.plot').boundingBox(), w = box.width - (await gutter()), y = box.y + box.height / 3
  await page.mouse.move(box.x + w * .1, y)
  for (let i = 0; i < 9; i++) { await page.keyboard.down('Control'); await page.mouse.wheel(0, -120); await page.keyboard.up('Control') }
  await page.mouse.click(box.x + w * .1, y)
  await page.mouse.move(box.x + w * .1, box.y - 20)
  await page.keyboard.press('Space')
  await page.waitForFunction(() => document.querySelector('.play')?.getAttribute('aria-label') === 'Pause')
  // played a while: followed, the view steady
  await page.waitForTimeout(1500)
  // each frame: the view's start in device pixels, and where the playhead's layer stands, in device pixels
  const frames = await page.evaluate(() => new Promise(done => {
    const out = [], canvas = document.querySelector('.plot canvas.overlay'), head = document.querySelector('.plot .playhead .head')
    const each = () => {
      const [a, b] = __view.range, W = Math.round((canvas.clientWidth - parseFloat(getComputedStyle(document.querySelector('.panes')).getPropertyValue('--axis'))) * devicePixelRatio)
      out.push([a * W / (b - a), new DOMMatrix(getComputedStyle(head).transform).m41 * devicePixelRatio])
      out.length < 60 ? requestAnimationFrame(each) : done(out)
    }
    requestAnimationFrame(each)
  }))
  await page.keyboard.press('Space')
  const moved = frames.filter(([s], i) => i && s !== frames[i - 1][0]), at = frames.map(([, x]) => x)
  assert.ok(moved.length > 30, `${moved.length} frames scrolled`)
  assert.ok(frames.every(([s]) => Math.abs(s - Math.round(s)) < 1e-3), `starts off the pixels: ${frames.map(([s]) => (s % 1).toFixed(3)).join()}`)
  assert.ok(Math.max(...at) - Math.min(...at) < .5, `the playhead at ${at.map(x => x.toFixed(2)).join()}`)
})

// The playhead is a layer of its own, moved by an animation of its transform, which the compositor runs at the speed it
// plays at: it moves on smoothly however busy the page's thread, between device pixels, set again only as the clock's
// trim takes it a quarter of a device pixel off. Zoomed out it moves less than a pixel a frame: drawn on the pixels by
// the page, it stepped one every few frames, now 2 apart, now 3, which the eye takes for a speed that changes
test('editor: the playhead is a layer the compositor moves at the speed it plays at', async () => {
  await page.route('**/playground/editor.js', async route => { const r = await route.fetch(); route.fulfill({ response: r, body: (await r.text()).replace('v = view(', 'v = globalThis.__view = view(') }) })
  await page.addInitScript(() => {
    const animate = Element.prototype.animate
    globalThis.__slid = 0
    Element.prototype.animate = function (...a) { if (this.classList.contains('head')) __slid++; return animate.apply(this, a) }
  })
  await open()
  await noCues()
  await write(`audio.from(t => Math.sin(2 * Math.PI * 220 * t) * .3, { duration: 45 })`)
  await lengthIs('0:45.000')
  const box = await page.locator('.plot').boundingBox()
  await page.mouse.move(box.x + 20, box.y - 20)
  await page.locator('.plot').focus()
  await page.keyboard.press('Space')
  await page.waitForFunction(() => document.querySelector('.play')?.getAttribute('aria-label') === 'Pause')
  // playing a moment, past its start
  await page.waitForTimeout(500)
  // each frame for a second and a half: where the layer is, where the playhead is, the view's width a second
  const { frames, slid, overlay, dpr } = await page.evaluate(() => new Promise(done => {
    const out = [], head = document.querySelector('.plot .playhead .head'), w = document.querySelector('.plot .playhead').clientWidth, n = __slid
    const each = ts => {
      const [a, b] = __view.range
      out.push([ts, new DOMMatrix(getComputedStyle(head).transform).m41, (__view.playhead - a) / (b - a) * w])
      out.length < 90 ? requestAnimationFrame(each) : done({ frames: out, slid: __slid - n, overlay: head.getAnimations().map(a => a.playState), dpr: devicePixelRatio })
    }
    requestAnimationFrame(each)
  }))
  await page.keyboard.press('Space')
  await page.locator('.plot .playhead').waitFor({ state: 'hidden' })
  assert.deepEqual(overlay, ['running'])
  assert.ok(slid <= 3, `set ${slid} times in ${frames.length} frames`)
  const off = frames.map(([, x, p]) => Math.abs(x - p)).sort((p, q) => p - q)
  assert.ok(off[Math.floor(off.length * .9)] < 1, `off the playhead by ${off.map(v => v.toFixed(2)).join()} px`)
  const span = frames.at(-1)[1] - frames[0][1], fractions = new Set(frames.map(([, x]) => Math.round(x * dpr % 1 * 20)))
  assert.ok(span > 0 && span / frames.length < .9, `${span.toFixed(1)} px over ${frames.length} frames`)
  assert.ok(fractions.size >= 8, `on ${fractions.size} places within a pixel`)
})

// The bar's mark, playing, is a loop of the logo's own wave the compositor steps through, the canvas hidden and nothing
// drawn on the page's thread; paused, the canvas again, the loop gone
test('editor: playing, the bar\'s mark is a loop the compositor runs', async () => {
  await open()
  await noCues()
  await write(`audio.from(t => Math.sin(2 * Math.PI * 220 * t) * .3, { duration: 20 })`)
  await lengthIs('0:20.000')
  const mark = () => page.evaluate(() => {
    const logo = document.querySelector('.bar .wordmark .logo'), canvas = logo.querySelector(':scope > canvas'), loop = logo.querySelector(':scope > div canvas')
    return { canvas: getComputedStyle(canvas).visibility, loop: loop?.getAnimations().map(a => [a.playState, a.effect.getTiming().easing]) ?? null }
  })
  await page.locator('.plot').focus()
  await page.keyboard.press('Space')
  // the loop once the device sounds (Pause shows from the press)
  const shown = v => page.waitForFunction(v => getComputedStyle(document.querySelector('.bar .wordmark .logo > canvas')).visibility === v, v)
  await shown('hidden')
  assert.deepEqual(await mark(), { canvas: 'hidden', loop: [['running', 'steps(40)']] })
  await page.keyboard.press('Space')
  await shown('visible')
  assert.deepEqual(await mark(), { canvas: 'visible', loop: null })
})

// The device's clock comes in steps, each a fraction of a ms off where the last ran on to; zoomed in, that is pixels, back
// and forth. The playhead runs on by the frames' own time instead, its speed trimmed toward the clock: frame to frame it
// moves as far as the frame's time at the speed, within 50 µs, and stays within a few ms of the clock
test('editor: the playhead runs on by the frames\' own time, not by the device clock\'s steps', async () => {
  await page.route('**/playground/editor.js', async route => { const r = await route.fetch(); route.fulfill({ response: r, body: (await r.text()).replace('v = view(', 'v = globalThis.__view = view(') }) })
  await page.route('**/playground/editor/context.js', async route => { const r = await route.fetch(); route.fulfill({ response: r, body: (await r.text()).replace('let pl = null', 'let pl = null; Object.defineProperty(globalThis, "__pl", { get: () => pl })') }) })
  await open()
  await noCues()
  await write(`audio.from(t => Math.sin(2 * Math.PI * 220 * t) * .3, { duration: 20 })`)
  await lengthIs('0:20.000')
  await page.locator('.plot').focus()
  await page.keyboard.press('Space')
  await page.waitForFunction(() => document.querySelector('.play')?.getAttribute('aria-label') === 'Pause')
  // playing a moment, past its start
  await page.waitForTimeout(500)
  const frames = await page.evaluate(() => new Promise(done => {
    const out = []
    const each = ts => { out.push([ts, __view.playhead, __pl.time]); out.length < 120 ? requestAnimationFrame(each) : done(out) }
    requestAnimationFrame(each)
  }))
  await page.keyboard.press('Space')
  const off = frames.slice(1).map(([ts, t], i) => Math.abs((t - frames[i][1]) * 1000 - (ts - frames[i][0]))).sort((p, q) => p - q)
  assert.ok(off[Math.floor(off.length * .9)] < .05, `steps off the frames' by ${off.map(v => v.toFixed(3)).join()} ms`)
  const lag = frames.map(([, t, c]) => Math.abs(c - t) * 1000).sort((p, q) => p - q)
  assert.ok(lag[Math.floor(lag.length * .9)] < 25, `off the clock by ${lag.map(v => v.toFixed(1)).join()} ms`)
})

// Firefox's clock and Safari's move by the audio callbacks, standing between them: here by 512 frames (10.7 ms at 48 kHz).
// The playhead takes no step for a change of speed: frame to frame it moves as far as the frame's time, within 3% (it
// was a tenth and more), and stays within a few ms of the clock
test('editor: the playhead keeps its speed on a clock that moves by the audio callbacks', async () => {
  await page.route('**/playground/editor.js', async route => { const r = await route.fetch(); route.fulfill({ response: r, body: (await r.text()).replace('v = view(', 'v = globalThis.__view = view(') }) })
  await page.route('**/playground/editor/context.js', async route => { const r = await route.fetch(); route.fulfill({ response: r, body: (await r.text()).replace('let pl = null', 'let pl = null; Object.defineProperty(globalThis, "__pl", { get: () => pl })') }) })
  await open()
  await noCues()
  await write(`audio.from(t => Math.sin(2 * Math.PI * 220 * t) * .3, { duration: 20 })`)
  await lengthIs('0:20.000')
  await page.evaluate(() => { const { get } = Object.getOwnPropertyDescriptor(__pl, 'time'), q = 512 / 48000; Object.defineProperty(__pl, 'time', { get: () => Math.floor(get.call(__pl) / q) * q }) })
  await page.locator('.plot').focus()
  await page.keyboard.press('Space')
  await page.waitForFunction(() => document.querySelector('.play')?.getAttribute('aria-label') === 'Pause')
  // playing a moment, past its start
  await page.waitForTimeout(500)
  const frames = await page.evaluate(() => new Promise(done => {
    const out = []
    const each = ts => { out.push([ts, __view.playhead, __pl.time]); out.length < 120 ? requestAnimationFrame(each) : done(out) }
    requestAnimationFrame(each)
  }))
  await page.keyboard.press('Space')
  const off = frames.slice(1).map(([ts, t], i) => Math.abs((t - frames[i][1]) * 1000 / (ts - frames[i][0]) - 1)).sort((p, q) => p - q)
  assert.ok(off[Math.floor(off.length * .9)] < .05, `speeds off 1× by ${off.map(v => v.toFixed(3)).join()}`)
  const lag = frames.map(([, t, c]) => Math.abs(c - t) * 1000).sort((p, q) => p - q)
  assert.ok(lag[Math.floor(lag.length * .9)] < 25, `off the clock by ${lag.map(v => v.toFixed(1)).join()} ms`)
})

// Zoomed in, a ms is many pixels: the playhead goes on by each frame's own time, however late a busy page runs the
// frame's work (here 0 to 10 ms, at random, before it), so the view never jolts back and forth. And the pictures'
// window-wide layers are clipped, not masked: a mask is a pass of its own over each, every frame the view scrolls
test('editor: zoomed in, the playhead goes on by the frames\' own time, however late the page gets to them', async () => {
  await open()
  await noCues()
  await write(`audio.from(t => Math.sin(2 * Math.PI * 220 * t) * .3, { duration: 20 })`)
  await lengthIs('0:20.000')
  for (const layer of ['waveform', 'spectrum']) assert.equal(await page.locator(`.plot canvas.${layer}`).evaluate(e => getComputedStyle(e).maskImage), 'none', layer)
  const box = await page.locator('.plot').boundingBox(), y = box.y + box.height / 2
  await page.mouse.move(box.x + 20, y)
  for (let i = 0; i < 10; i++) { await page.keyboard.down('Control'); await page.mouse.wheel(0, -120); await page.keyboard.up('Control') }
  await page.mouse.click(box.x + 20, y)
  // each frame: its time, and the clock as the frame before left it, read first, then the frame held up
  await page.evaluate(() => {
    window.__frames = []
    const each = ts => {
      const [m, s] = document.querySelector('.time').textContent.split(':')
      window.__frames.push([ts, +m * 60 + +s])
      const until = performance.now() + Math.random() * 10
      while (performance.now() < until);
      if (window.__frames.length < 120) requestAnimationFrame(each)
    }
    requestAnimationFrame(each)
  })
  await page.keyboard.press('Space')
  await page.waitForFunction(() => window.__frames.length >= 120, null, { timeout: 10000 })
  await page.keyboard.press('Space')
  const frames = await page.evaluate(() => window.__frames)
  // while it runs, the clock's step each frame is the frame's step, to the ms the clock shows; the readout, redrawn by the
  // page's own schedule, may show a frame or two late, and a frame held up may take two, so a step is off by what is
  // left over whole frames (the display's, the shortest steps)
  const steps = frames.slice(1).map(([t], i) => t - frames[i][0]).sort((p, q) => p - q), frame = steps[Math.floor(steps.length / 10)], off = []
  for (let i = 2; i < frames.length; i++) {
    const [t0, a] = frames[i - 1], [t1, b] = frames[i], d = (b - a) * 1000 - (t1 - t0)
    if (a > frames[0][1] && b > a) off.push(Math.abs(d - Math.round(d / frame) * frame))
  }
  off.sort((p, q) => p - q)
  assert.ok(off.length > 30, `${off.length} frames running`)
  assert.ok(off[Math.floor(off.length * .9)] < 2.5, `steps off the frames' by ${off.map(v => v.toFixed(1)).join()} ms`)
})

// A search held at 0 a while, then let go: it stops there, the playhead gone with it (its layer hidden), the caret where
// it stood and drawn, not the playhead's line left standing in its place
test('editor: Play held at 0, let go, stops there, the caret drawn where the playhead stood', async () => {
  await open()
  const play = await page.locator('button.play').boundingBox(), cx = play.x + play.width / 2, cy = play.y + play.height / 2
  await page.mouse.move(cx, cy)
  await page.mouse.down()
  await page.getByRole('button', { name: 'Pause' }).waitFor()
  // played past the start
  await page.waitForFunction(() => document.querySelector('.time').textContent > '0:00.100')
  await page.mouse.move(cx - 40, cy, { steps: 4 })
  assert.equal(await page.locator('.speed-mark').innerText(), '0.0×')
  // held at 0 a while
  await page.waitForTimeout(600)
  await page.mouse.up()
  await page.getByRole('button', { name: 'Play', exact: true }).waitFor()
  await poll(() => page.locator('.plot .playhead').evaluate(e => e.hidden), hidden => assert.equal(hidden, true, 'no playhead left'))
  const t = await page.locator('.time').innerText().then(s => { const [m, x] = s.split(':'); return +m * 60 + +x })
  assert.ok(t > .05, `the caret where it stood, past the start: ${t}`)
})

// Play held and dragged across searches, as a shuttle ring: from the speed it plays at, a tenth of 1× each 4 px, −2× to
// 4×, on a line over it, its mark a tenth always, the pointer hidden; forward the deck plays at it, at 0 the moment
// holds, back the scrub voice hears the moments it passes; a step taken only three quarters of the way to the next, so a
// hand resting between two holds one; held still, the line shows. Let go forward, it plays on at that speed until it
// stops; at 0 or back, it stops there. Stopped, 1× again; the Play menu sets the next playback's. Record is off while it plays, in its place. Round
// Play a ring, how far through the sound it plays, there while it plays
test('editor: Play held and dragged searches, let go it plays on at that speed till stopped; record off while it plays; a ring how far it has played', async () => {
  await page.addInitScript(tap)
  await open()
  const play = await page.locator('button.play').boundingBox(), cx = play.x + play.width / 2, cy = play.y + play.height / 2
  const clock = () => page.locator('.time').innerText().then(t => { const [m, s] = t.split(':'); return +m * 60 + +s })
  const record = () => page.locator('button.record').evaluate(el => [el.disabled, el.inert, getComputedStyle(el).visibility])
  const ring = () => page.locator('button.play').evaluate(el => [el.classList.contains('rolling'), +el.style.getPropertyValue('--played')])
  const mark = () => page.locator('.speed-mark').innerText()
  // how far the clock runs over 400 ms
  const runs = async () => { const t0 = await clock(); await page.waitForTimeout(400); return await clock() - t0 }
  assert.deepEqual(await record(), [false, false, 'visible'], 'at rest, record')
  assert.equal(await page.locator('.speed-pill').count(), 0, 'no pill: the speed is the playback\'s')
  await page.mouse.move(cx, cy)
  await page.mouse.down()
  await page.getByRole('button', { name: 'Pause' }).waitFor()
  // 80 px right of 1×: 3×, the line over Play, the pointer hidden; record off, where it is
  await page.mouse.move(cx + 80, cy, { steps: 8 })
  await page.locator('.speed-axis').waitFor()
  assert.equal(await mark(), '3.0×')
  assert.deepEqual(await page.locator('.speed-tick').allInnerTexts(), ['−2×', '−1×', '0', '1×', '2×', '3×', '4×'])
  assert.equal(await page.locator('#app').evaluate(el => getComputedStyle(el).cursor), 'none')
  assert.deepEqual(await record(), [true, false, 'visible'], 'record off while it plays')
  // the speed taken up before it is timed
  await page.waitForTimeout(300)
  const [rolling, p0] = await ring(), fast = await runs(), [, p1] = await ring()
  assert.ok(fast > .8 && fast < 1.7, `at 3× 400 ms ran ${fast} s`)
  // the ring: how far through the whole sound, 6.525 s, it has played
  assert.ok(rolling && p1 > p0 && Math.abs(p1 - await clock() / 6.525) < .1, `the ring round Play: ${p0} then ${p1}`)
  // at 0 the moment holds; back, at −2×, the clock runs back and the moments it passes sound
  await page.mouse.move(cx - 40, cy, { steps: 4 })
  assert.equal(await mark(), '0.0×')
  // the speed taken up before it is timed
  await page.waitForTimeout(100)
  assert.equal(await runs(), 0, 'held at 0')
  assert.ok(await page.getByRole('button', { name: 'Pause' }).isVisible(), 'a search, Play its pause')
  await page.mouse.move(cx - 120, cy, { steps: 4 })
  assert.equal(await mark(), '−2.0×')
  // the speed taken up before it is timed
  await page.waitForTimeout(100)
  await heard()
  const back = await runs(), sounded = await heard()
  assert.ok(back < -.5 && back > -1.1, `at −2× 400 ms ran ${back} s`)
  assert.ok(sounded.finite && sounded.peak > .01, `heard backwards: ${sounded.peak}`)
  // past the ends it stops at them
  await page.mouse.move(cx - 600, cy, { steps: 4 })
  assert.equal(await mark(), '−2.0×')
  await page.mouse.move(cx + 600, cy, { steps: 4 })
  assert.equal(await mark(), '4.0×')
  // about 1×: a pixel or two either way holds the step it has, the next taken at three quarters of the way to it (3 px),
  // and left again only at three quarters of the way back
  for (const [dx, at] of [[0, '1.0×'], [2, '1.0×'], [3, '1.1×'], [1.5, '1.1×'], [1, '1.0×']]) {
    await page.mouse.move(cx + dx, cy)
    assert.equal(await mark(), at, `at ${dx} px`)
  }
  // let go at 2×, it plays on at 2×
  await page.mouse.move(cx + 40, cy)
  assert.equal(await mark(), '2.0×')
  await page.mouse.up()
  assert.equal(await page.locator('.speed-axis').count(), 0)
  assert.ok(await page.getByRole('button', { name: 'Pause' }).isVisible(), 'plays on')
  const kept = await runs()
  assert.ok(kept > .55 && kept < 1.1, `at 2× kept 400 ms ran ${kept} s`)
  // a press while it plays, let go at once, pauses, the caret where the playhead got to, as a key's pause leaves it (at
  // 2× held 150 ms, 0.3 s on from the press); record on again, no ring; played again, 1×
  await page.mouse.move(cx, cy)
  await page.mouse.down()
  const pressed = await clock()
  // held 150 ms
  await page.waitForTimeout(150)
  await page.mouse.up()
  await page.getByRole('button', { name: 'Play', exact: true }).waitFor()
  const paused = await clock()
  assert.ok(paused - pressed > .15 && paused - pressed < .8, `paused at ${paused}, pressed at ${pressed}`)
  assert.deepEqual(await record(), [false, false, 'visible'], 'record again')
  assert.equal((await ring())[0], false, 'no ring at rest')
  await page.locator('button.play').click()
  await page.getByRole('button', { name: 'Pause' }).waitFor()
  // playing a moment, past its start, before it is timed
  await page.waitForTimeout(200)
  const again = await runs()
  assert.ok(again > .25 && again < .6, `played again, 1×: 400 ms ran ${again} s`)
  // held still past HOLD (400 ms, view.js), the line shows, the speed marked; let go, it plays on as it was
  await page.mouse.move(cx, cy)
  await page.mouse.down()
  // held, short of HOLD
  await page.waitForTimeout(200)
  assert.equal(await page.locator('.speed-axis').count(), 0, 'not yet')
  await page.locator('.speed-axis').waitFor({ timeout: 600 })
  assert.equal(await mark(), '1.0×')
  await page.mouse.up()
  assert.equal(await page.locator('.speed-axis').count(), 0)
  assert.ok(await page.getByRole('button', { name: 'Pause' }).isVisible(), 'held, it plays on')
  // let go backwards, it stops where the search got to
  await page.mouse.move(cx, cy)
  await page.mouse.down()
  await page.mouse.move(cx - 80, cy, { steps: 4 })
  assert.equal(await mark(), '−1.0×')
  // searching back a moment before it is let go
  await page.waitForTimeout(200)
  await page.mouse.up()
  await page.getByRole('button', { name: 'Play', exact: true }).waitFor()
  assert.equal(await runs(), 0, 'stopped there')
  // the Play menu, fastest at the top, sets the next playback's speed
  await menu('Transport', 'Speed')
  assert.deepEqual((await page.locator('.menubar-list .menu-row:visible .menu-label').allInnerTexts()).filter(t => /×$/.test(t)), ['3×', '2×', '1.5×', '1.25×', '1×', '0.75×', '0.5×'], 'the fastest at the top')
  await page.keyboard.press('Escape')
  await page.keyboard.press('Escape')
  await menu('Transport', 'Speed', '1.5×')
  await page.locator('button.play').click()
  await page.getByRole('button', { name: 'Pause' }).waitFor()
  // playing a moment, past its start, before it is timed
  await page.waitForTimeout(200)
  const chosen = await runs()
  assert.ok(chosen > .4 && chosen < .85, `at 1.5× 400 ms ran ${chosen} s`)
  await page.locator('button.play').click()
})

// A band plays through two Butterworth biquads per edge. Its first highpass was once connected to itself: a feedback
// loop with no delay, whose output ran to 1e35.
test('editor: a band plays through stable filters: what reaches the speakers stays within full scale', async () => {
  await page.addInitScript(tap)
  await open()
  await show('spec')
  const { box, x } = await axis(6.525)
  await boxDrag([x(1), box.y + box.height * .2], [x(2) - x(1), box.height * .1])
  assert.match(await readout(), /Hz–/)
  await heard()
  await page.keyboard.press('Space')
  await page.getByRole('button', { name: 'Pause' }).waitFor()
  // 800 ms of it playing, what reached the speakers meanwhile
  await page.waitForTimeout(800)
  const { peak, finite } = await heard()
  assert.ok(finite && peak > 1e-3 && peak <= 1, `peak ${peak}`)
})

// Scrubbing (playground/scrub.js): a vocoder whose tonal peaks keep their phase advance, the rest of the bins random phases.
// A sound longer than the page holds scrubs as any does: a press on the time row sounds the moment under it, from the
// samples about it the player fetches (player.js near); the mark shows them too. Where it is held still, it holds
test('editor: a sound longer than the page holds sounds under the caret as it is pressed', async () => {
  await page.addInitScript(tap)
  await open()
  await write(`audio.from(t => Math.sin(2 * Math.PI * 220 * t) * .5, { duration: 1820, sampleRate: 48000 })`)
  await page.waitForFunction(() => (e => e.title || e.dataset.tip || '')(document.querySelector('.source')).endsWith('30:20.000'), null, { timeout: 120000 })
  await page.waitForFunction(() => !document.querySelector('.message').textContent, null, { timeout: 120000 })
  const { box, x } = await axis(1820), row = box.y + box.height - 8
  await settled()
  await heard()
  for (const t of [600, 1500]) {
    await page.mouse.move(x(t), row)
    await page.mouse.down()
    // held 600 ms: what sounds meanwhile
    await page.waitForTimeout(600)
    const pressed = await heard()
    await page.mouse.up()
    assert.ok(pressed.finite && pressed.peak > .05, `pressed at ${t} s: peak ${pressed.peak}`)
    // its sound let go before the next press is heard
    await page.waitForTimeout(300)
    await heard()
  }
})

test('editor: stopping settles the mark into the logo in about 300 ms', async () => {
  // every frame the mark draws, read back as it is drawn
  await page.addInitScript(() => {
    const draw = WebGL2RenderingContext.prototype.drawArrays
    window.__marks = []
    WebGL2RenderingContext.prototype.drawArrays = function (...args) {
      draw.apply(this, args)
      const c = this.canvas
      if (window.__watch && c.closest?.('.wordmark')) {
        const k = new OffscreenCanvas(c.width, c.height).getContext('2d')
        k.drawImage(c, 0, 0)
        window.__marks.push([performance.now(), k.getImageData(0, 0, c.width, c.height).data])
      }
    }
  })
  await open()
  await page.locator('.view-slab').click({ position: { x: 300, y: 150 } })
  await page.keyboard.press('Space')
  // playing a while, the mark turning at its pace
  await page.waitForTimeout(1200)
  await page.evaluate(() => {
    window.__marks.length = 0
    window.__watch = true
    document.addEventListener('keydown', e => { if (e.code === 'Space') window.__t0 = performance.now() }, true)
  })
  await page.keyboard.press('Space')
  // its frames for 1.2 s after Stop, well past its settling
  await page.waitForTimeout(1200)
  // the frame after which the mark is within half a gray level of where it ends
  const settled = await page.evaluate(() => {
    const marks = window.__marks, last = marks.at(-1)[1]
    let at = 0
    marks.forEach(([t, d], i) => {
      let sum = 0
      for (let k = 3; k < d.length; k += 4) sum += Math.abs(d[k] - last[k])
      if (sum / (d.length / 4) > .5) at = marks[i + 1]?.[0] ?? t
    })
    return at - window.__t0
  })
  assert.ok(settled > 50 && settled < 400, `the mark stopped ${Math.round(settled)} ms after Stop`)
})

// While the engine loads, the mark turns gently at its own size, solid ink from its first frame: it does not fade in, shrink
// or pale, and comes back from loading as the logo, not as a shape growing to size
test('editor: the bar\'s mark is plain while the engine loads: whole from its first frame, no smaller, no paler', async () => {
  await page.addInitScript(() => {
    const draw = WebGL2RenderingContext.prototype.drawArrays
    window.__frames = []
    WebGL2RenderingContext.prototype.drawArrays = function (...args) {
      draw.apply(this, args)
      const c = this.canvas
      if (!c.closest?.('.wordmark')) return
      const k = new OffscreenCanvas(c.width, c.height).getContext('2d')
      k.drawImage(c, 0, 0)
      const d = k.getImageData(0, 0, c.width, c.height).data
      let solid = 0, half = 0
      for (let i = 3; i < d.length; i += 4) { if (d[i] > 215) solid++; else if (d[i] > 40) half++ }
      window.__frames.push([c.width, solid, half, !!c.closest('.wordmark').querySelector('svg')])
    }
  })
  await open()
  // the engine loaded and its run over, the mark back in the logo pose
  await settled()
  await poll(() => page.evaluate(async () => (await import('/logo/mark.js')).mark(document.querySelector('.bar .wordmark')).phase), p => assert.ok(Math.abs(p - Math.round(p)) < .001, `back in the logo, ${p}`))
  const frames = await page.evaluate(() => window.__frames)
  const width = frames.at(-1)[0], sized = frames.filter(f => f[0] === width), ink = sized.map(f => f[1])
  assert.ok(sized.length > 5, `${sized.length} frames at its size`)
  assert.ok(Math.min(...ink) > .85 * Math.max(...ink), `the same size throughout, ${Math.min(...ink)}–${Math.max(...ink)} solid pixels`)
  assert.ok(Math.max(...sized.map(f => f[2] / f[1])) < .6, 'and flat, a rim of half-tone only, not a gradient')
  assert.equal(frames[frames.findIndex(f => !f[3])][0], width, 'the static mark stays until the live one has drawn at its size')
})

// Over the bar's wordmark the mark copies the pointer's sideways moves, half as far as a drag would turn it, and catches
// in the logo pose when the pointer leaves; while a sound plays it leaves the pointer alone
test('editor: the mark copies the pointer over the wordmark, and catches in the logo pose when the pointer leaves', async () => {
  await open()
  const bar = page.locator('.bar .wordmark'), box = await bar.boundingBox(), y = box.y + box.height / 2
  const width = await bar.locator('canvas').evaluate(c => c.clientWidth)
  const phase = () => page.evaluate(async () => (await import('/logo/mark.js')).mark(document.querySelector('.bar .wordmark')).phase)
  await settled()
  // at rest: the logo pose, still ten frames on (the live mark sized, its first pose eased into)
  const [, rest] = await poll(async () => [await phase(), await frames(10).then(phase)], ([was, rest]) => assert.ok(Math.abs(rest - was) < 1e-6 && Math.abs(rest - Math.round(rest)) < .001, `at rest it is the logo, ${was} then ${rest}`))
  await page.mouse.move(box.x + box.width - 10, y)
  // a while over it, still: nothing moves it
  await page.waitForTimeout(700)
  assert.ok(Math.abs(await phase() - rest) < .001, 'hovering alone does nothing to it')
  await page.mouse.move(box.x + box.width - 40, y, { steps: 10 })
  const left = await poll(phase, left => assert.ok(Math.abs(left - rest + 15 / width) < .01, `30 px left is ${15 / width} of a turn back, half a drag's, ${left - rest}`))
  await page.mouse.move(box.x + box.width - 25, y, { steps: 5 })
  await poll(phase, now => assert.ok(Math.abs(now - (left + 7.5 / width)) < .01, 'and 15 px right, some of it forward again'))
  // let go of it and it catches in the pose nearest, within 400 ms (read for 500)
  await page.mouse.move(box.x + box.width + 300, y + 300)
  await poll(phase, caught => assert.ok(Math.abs(caught - Math.round(caught)) < .001, `the pointer has left: caught in a pose, ${caught}`), 500)
  // a sound playing is the mark's business: the pointer moves it no more, so a sweep to the left never turns it back
  await page.locator('.plot').click({ position: { x: 120, y: 60 } })
  await page.keyboard.press('Space')
  await page.mouse.move(box.x + box.width - 10, y)
  // the play's turning come on, the pointer's mimic let go (its lag, the pace easing in)
  await page.waitForTimeout(300)
  await page.evaluate(async () => {
    const it = (await import('/logo/mark.js')).mark(document.querySelector('.bar .wordmark'))
    window.__phases = []
    const sample = () => { window.__phases.push(it.phase); requestAnimationFrame(sample) }
    sample()
  })
  await page.mouse.move(box.x + box.width - 40, y, { steps: 10 })
  await page.mouse.move(box.x + box.width - 10, y, { steps: 10 })
  // past a mimic's lag (about 60 ms): a turn back would show by now
  await page.waitForTimeout(200)
  const phases = await page.evaluate(() => window.__phases)
  assert.ok(phases.length > 10 && phases.every((p, i) => !i || p >= phases[i - 1] - 1e-9), 'while it plays it only turns on, at its own pace')
  await page.keyboard.press('Space')
})

// The mark's wave after an edit that pitches a fragment down: the sound there has little a pitch tracker can hold, and a wave
// once lost to it stayed lost. What shows a few rows above the axis is a wave.
test('editor: the mark still shows the wave of a fragment pitched down, playing, and again after it', async () => {
  await open()
  await write(`audio('chime.wav').pitch(-24, { at: 1, duration: 3 })`)
  await lengthIs('0:08.000')
  const { box, x } = await axis(8)
  const crest = async () => {
    const png = (await page.locator('.bar .wordmark .logo').screenshot()).toString('base64')
    return page.evaluate(async png => {
      const image = new Image()
      image.src = 'data:image/png;base64,' + png
      await image.decode()
      const c = new OffscreenCanvas(image.width, image.height).getContext('2d')
      c.drawImage(image, 0, 0)
      const d = c.getImageData(0, 0, image.width, image.height).data
      let ink = 0
      // dark pixels a few rows above the middle, where the axis lies
      for (let y = 0; y < image.height / 2 - 3 * image.height / 32; y++) for (let k = 0; k < image.width; k++) if (d[(y * image.width + k) * 4] < 100) ink++
      return ink
    }, png)
  }
  // the most wave shown over about a second of it playing
  const shapes = async () => { let most = 0; for (let i = 0; i < 12; i++) { await page.waitForTimeout(90); most = Math.max(most, await crest()) } return most }
  await page.mouse.click(x(1.3), box.y + box.height / 2)
  await page.keyboard.press('Space')
  { const n = await shapes(); assert.ok(n > 5, `a wave while the fragment plays: ${n}`) }
  await page.keyboard.press('Space')
  await page.getByRole('button', { name: 'Play', exact: true }).waitFor()
  // again, from before the fragment, and after it
  await page.mouse.click(x(.2), box.y + box.height / 2)
  await page.keyboard.press('Space')
  assert.ok(await shapes() > 5, 'and while what is before it plays')
  await page.keyboard.press('Space')
})

// A file still arriving plays as far as it has come, its pieces pushed to the deck as they come: the file's own, where
// the output waits for all of it (normalize), or the output's, where it comes as the file does; then on into the output
// once it is whole, to its end. The fixture sounds from 0.2 s to 1.8 s without a pause: so does what is heard
test('editor: a file still decoding plays as far as it has come', async () => {
  await page.addInitScript(taken)
  await open()
  for (const [ms, chain] of [[60, ''], [70, '.normalize(-3)']]) {
    await write(`audio('${origin}/slow/test/fixture.wav?ms=${ms}')${chain}`)
    await page.locator('.message', { hasText: /^Decoding/ }).waitFor()
    await page.waitForFunction(() => !document.querySelector('.play').disabled)
    await page.evaluate(() => { window.__taken.length = 0 })
    await page.getByRole('button', { name: 'Play', exact: true }).click()
    await page.getByRole('button', { name: 'Pause' }).waitFor()
    assert.match(await page.locator('.message').innerText(), /^(Decoding|Applying)/, `${chain}: still arriving`)
    await poll(() => page.evaluate(() => [window.__taken.flatMap(b => [...b]), document.querySelector('.time').textContent]), ([x, clock]) => {
      assert.ok(x.some(v => Math.abs(v) > .01), `${chain}: heard`)
      assert.ok(+clock.split(':')[1] > .2, `${chain}: the clock runs: ${clock}`)
    })
    await lengthIs('0:02.000')
    await page.getByRole('button', { name: 'Play', exact: true }).waitFor({ timeout: 10000 })
    const [all, sr] = await page.evaluate(() => [window.__taken.flatMap(b => [...b]), window.__rate])
    const loud = all.map((v, i) => Math.abs(v) >= 1e-4 ? i : -1).filter(i => i >= 0), heard = all.slice(loud[0], loud.at(-1))
    let run = 0, longest = 0
    for (const v of heard) { run = Math.abs(v) < 1e-4 ? run + 1 : 0; longest = Math.max(longest, run) }
    assert.ok(heard.length > sr * 1.5, `${chain}: ${(heard.length / sr).toFixed(2)} s of it heard`)
    assert.ok(longest < sr * .005, `${chain}: a gap of ${(longest / sr * 1000).toFixed(0)} ms`)
    await page.keyboard.press('Home')
  }
})

// While a selection loops, the caret put elsewhere takes playback there, over all of the output (nothing is selected)
test('editor: the caret put elsewhere while a selection loops plays from there, past the old loop', async () => {
  await open()
  const { box, x } = await axis(6.525), y = box.y + tall(box) * .3
  await drag([x(1), y], [x(1.5) - x(1), 0])
  await page.getByRole('button', { name: 'Loop' }).click()
  await page.keyboard.press('Space')
  await page.getByRole('button', { name: 'Pause' }).waitFor()
  // looping a while
  await page.waitForTimeout(400)
  await page.mouse.click(x(4), y)
  // played on longer than the old loop (0.5 s): not taken back into it
  await page.waitForTimeout(700)
  const t = +(await page.locator('.time').innerText()).split(':')[1]
  assert.ok(t > 4.1 && t < 5.5, `plays on from the click (${t})`)
  await page.keyboard.press('Space')
})

// The pointer goes while an operation draws what it does: holding the caret to hear it, dragging a range
test('editor: the pointer hides while the caret sounds, and comes back', async () => {
  await open()
  const { box, x } = await axis(6.525), row = box.y + box.height - 8, cursor = () => page.locator('.plot').evaluate(el => el.style.cursor)
  await page.mouse.move(x(3), row)
  await page.mouse.down()
  assert.equal(await cursor(), 'none')
  await page.mouse.move(x(3.2), row, { steps: 3 })
  assert.equal(await cursor(), 'none')
  await page.mouse.up()
  assert.notEqual(await cursor(), 'none')
})

// Handles are for editing: while it plays there are none, the caret's square past it too
test('editor: no handles while it plays', async () => {
  const { box, x, y } = await chime(), lh = (tall(box) - LANES) / 2, at = [x(2) + 9, box.y + lh * 3 / 4]
  await page.mouse.click(x(2), y)
  await grab([at], 'ew-resize')
  await page.keyboard.press('Space')
  await page.waitForFunction(() => document.querySelector('.time').textContent !== '0:02.000')
  await page.mouse.move(at[0] + 1, at[1])
  assert.equal(await page.locator('.plot').evaluate(el => el.style.cursor), '')
  await page.keyboard.press('Space')
  await page.getByRole('button', { name: 'Play' }).waitFor()
})

// A selection, as a text's: the arrows move the caret and keep it; a click on the time row moves only the caret, as
// a ruler's; Play goes on from the caret inside it, and paused, from where it paused; a click inside it, as anywhere,
// leaves the caret there alone
test('editor: the caret moves within a selection from the time row or the arrows; Play goes on from it; a click drops it', async () => {
  await open()
  await noCues()
  await write(`audio('chime.wav')`)
  await lengthIs('0:08.000')
  const { box, x } = await axis(8), y = box.y + tall(box) * .3, row = box.y + box.height - 11
  const clock = () => page.locator('.time').innerText(), seconds = t => t.split(':').reduce((m, s) => m * 60 + +s, 0)
  await drag([x(1), y], [x(5) - x(1), 0])
  assert.equal(await selected(), '0:01.000–0:05.000')
  await page.keyboard.press('ArrowRight')
  assert.equal(await selected(), '0:01.000–0:05.000')
  await page.mouse.click(x(2), row)
  assert.equal(await selected(), '0:01.000–0:05.000')
  assert.equal(await clock(), '0:02.000')
  await page.keyboard.press('Space')
  await page.getByRole('button', { name: 'Pause' }).waitFor()
  const t = seconds(await clock())
  assert.ok(t >= 2 && t < 2.5, `plays on from the caret (${t})`)
  // playing on a while
  await page.waitForFunction(t => document.querySelector('.time').textContent.split(':').reduce((m, s) => m * 60 + +s, 0) > t + .2, t)
  await page.keyboard.press('Space')
  const paused = seconds(await clock())
  await page.keyboard.press('Space')
  await page.getByRole('button', { name: 'Pause' }).waitFor()
  const again = seconds(await clock())
  assert.ok(again >= paused && again < paused + .3, `on from where it paused (${paused} → ${again})`)
  await page.keyboard.press('Space')
  assert.equal(await selected(), '0:01.000–0:05.000')
  await page.mouse.click(x(3), y)
  assert.equal(await selected(), '')
  assert.equal(await clock(), '0:03.000')
})

// While it plays, held Alt measures from the playhead, the caret moving, not from where it started: the line on the time
// row runs from the playhead to the pointer, none of it back to the caret it started from
test('editor: held Alt while it plays, it measures from the playhead', async () => {
  const { box, x, y } = await chime()
  await page.mouse.click(x(1), y)
  await page.mouse.move(x(5), y)
  await page.keyboard.press('Space')
  // the playhead, and the tick measured from on it, well past where it started
  await page.waitForFunction(() => document.querySelector('.time').textContent > '0:01.600')
  await page.keyboard.down('Alt')
  await crossed()
  const [behind, ahead] = [await measuredOnRow(box, x(1) + 2, x(1.3)), await measuredOnRow(box, x(3), x(5) - 2)]
  await page.keyboard.up('Alt')
  await page.keyboard.press('Space')
  assert.equal(behind, 0, 'nothing back to where it started')
  assert.ok(ahead > (x(5) - 2 - x(3)) * .6, `from the playhead to the pointer: ${ahead} px`)
})

// Held, a range in its strip or a note plays from its start, all of it as it is, till let go (the page's auditions, as
// view.js asks for them: { at, duration, whole }, then none); a range's name pressed plays nothing, it is written
test('editor: a range pressed in its strip, or a note, plays while held, from its start', async () => {
  await page.route('**/playground/editor.js', async route => { const r = await route.fetch(); route.fulfill({ response: r, body: (await r.text()).replace('  onaudition(o) {', '  onaudition(o) {\n    (globalThis.__heard ??= []).push(o && { at: o.at, duration: o.duration, whole: o.whole })') }) })
  await open()
  await noCues()
  await write(`audio('chime.wav').mark({ at: 2, d: 2 }, 'Chorus')`)
  await lengthIs('0:08.000')
  const { box, x } = await axis(8), strip = box.y + tall(box) + FOOT / 2, heard = () => page.evaluate(() => globalThis.__heard ?? [])
  await page.mouse.move(x(3.5), strip)
  await page.mouse.down()
  await page.waitForFunction(() => globalThis.__heard?.length === 1)
  assert.deepEqual(await heard(), [{ at: 2, duration: 2, whole: true }], 'held: all of it, from its start')
  await page.mouse.up()
  assert.deepEqual((await heard()).at(-1), null, 'let go: none')
  assert.equal(await selected(), '0:02.000–0:04.000')
  // its name pressed: named, nothing heard
  await page.mouse.click(x(2) + 14, strip)
  await page.waitForFunction(() => document.activeElement?.className === 'marker-name')
  assert.equal((await heard()).length, 2, 'its name: nothing heard')
  await page.keyboard.press('Escape')
  // a note held: the chime's first strike, C4, from its start
  await menu('View', 'Notes')
  const h = tall(box), c4 = box.y + h - (60 - 54 + .5) * h / 25
  const [px, py] = await grab([[x(.8), c4]], 'ns-resize')
  await page.mouse.move(px, py)
  await page.mouse.down()
  await page.waitForFunction(() => globalThis.__heard?.length === 3)
  const [note] = (await heard()).slice(-1), sel = (await selected()).split('–').map(t => +t.split(':')[1])
  await page.mouse.up()
  assert.ok(note.whole && Math.abs(note.at - sel[0]) < 1e-3 && Math.abs(note.at + note.duration - sel[1]) < 1e-3, `the note, as selected: ${JSON.stringify(note)}, ${sel}`)
  assert.equal((await heard()).at(-1), null, 'let go: none')
})

// How a held caret sounds, chosen in the settings: the lab's tape (scrub-methods.js), its head chasing the caret, plays
// the chime while the caret is dragged across it, and is silent held still
test('editor: the tape scrub, chosen in the settings, plays the sound as the caret is dragged, silent held still', async () => {
  await page.addInitScript(tap)
  await open()
  await settings('Scrub', 'Tape')
  const { box, x } = await axis(6.525), y = box.y + box.height - 8
  await page.mouse.move(x(.2), y)
  await page.mouse.down()
  await heard()
  // dragged at a pace: a step each 40 ms
  for (let t = .2; t < 1.4; t += .05) { await page.mouse.move(x(t), y); await page.waitForTimeout(40) }
  const moving = (await heard()).peak
  // the tape come to rest, then what it plays held still a while
  await page.waitForTimeout(400)
  await heard()
  await page.waitForTimeout(400)
  const still = (await heard()).peak
  await page.mouse.up()
  assert.ok(moving > .05 && still < moving / 10, `dragged ${moving}, held still ${still}`)
})

// With tracks, a scrub hears the track edited alone, as its lane shows it, not their mix: the quiet one quiet, the loud
// one loud. A track's mute, beside its name: its lane dim, the mix without it, kept with the tab; the heads part the
// bands with no rule between them, nor say how many channels each has
test('editor: with tracks, a scrub hears the track edited alone; a muted track leaves the mix', async () => {
  await page.addInitScript(tap)
  await open()
  await settings('Scrub', 'Tape')
  await write(`const tone = (f, a) => Float32Array.from({ length: 48000 }, (_, i) => a * Math.sin(2 * Math.PI * f * i / 48000))
let quiet = audio.from([tone(220, .1)], { sampleRate: 48000 })

let loud = audio.from([tone(330, .4), tone(330, .4)], { sampleRate: 48000 })`)
  await page.waitForFunction(() => document.querySelector('.plot').dataset.tracks === '2')
  await lengthIs('0:01.000')
  // the layers open (their mutes in sight), each lane's middle as they have it
  const { box, x } = await axis(1), row = box.y + box.height - 8, lane = async k => (r => r.y + r.h / 2)((await tracksAt())[k])
  // a track pressed, then the caret held and dragged along the time row: that track heard
  const scrub = async k => {
    await page.mouse.click(x(.1), await lane(k))
    await frames()
    await page.mouse.move(x(.2), row)
    await page.mouse.down()
    // held a moment, what the press sounds let go of before the drag's is heard
    await page.waitForTimeout(600)
    await heard()
    // dragged at a pace: a step each 40 ms
    for (let t = .2; t < .8; t += .03) { await page.mouse.move(x(t), row); await page.waitForTimeout(40) }
    const { peak } = await heard()
    await page.mouse.up()
    return peak
  }
  const quiet = await scrub(0), loud = await scrub(1)
  assert.ok(quiet > .02 && quiet < .2, `the quiet track alone: ${quiet}, the mix would be ~.5`)
  assert.ok(loud > .25, `the loud track: ${loud}`)
  // the loud one muted: the mix the quiet one's alone (−20 dBFS, 20 · log10 0.1); heard again, both (over −8: 0.4 and
  // 0.1 summed)
  const mutes = page.locator('.track-mute'), both = /^−[0-7]\.\ddBFS/
  assert.deepEqual(await mutes.evaluateAll(b => b.map(b => [b.ariaLabel, b.getAttribute('aria-pressed')])), [['Mute quiet', 'false'], ['Mute loud', 'false']])
  await page.keyboard.press('Escape')
  await page.waitForFunction(re => new RegExp(re).test(document.querySelector('.readout').textContent), both.source)
  await mutes.nth(1).click()
  await page.waitForFunction(() => /^−20\.0dBFS/.test(document.querySelector('.readout').textContent))
  assert.equal(await mutes.nth(1).getAttribute('aria-pressed'), 'true')
  assert.equal(await page.locator('.plot').getAttribute('data-tracks'), '2', 'its lane still there')
  // kept with the tab, past a reload
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('audio-repl') || '{}').docs?.some(d => d.muted?.includes('loud')))
  await page.reload()
  await page.waitForFunction(() => document.querySelector('.track-mute[aria-pressed="true"]')?.ariaLabel === 'Mute loud', null, { timeout: 15000 })
  await page.waitForFunction(() => /^−20\.0dBFS/.test(document.querySelector('.readout').textContent))
  await page.locator('.track-mute').nth(1).click()
  await page.waitForFunction(re => new RegExp(re).test(document.querySelector('.readout').textContent), both.source)
})
