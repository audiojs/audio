// The page's layout: the panel, a phone's and a tablet's, the bar; the server, the page and the helpers in page.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { browser, page, origin, errors, chimeLeft, code, wholeLevels, open, settled, still, tab, edits, noCues, write, tall, gutter, axis, drag, lengthIs, pixels, show, setPage } from './page.js'

// Over the picture: its tabs; at its foot, in the bar, undo and redo after the length, before the rate; what it shows
// chosen by its look, in the sound's foot under its axis; none moving as the picture turns. At the slab's top
// right, as an editor's activity bar, the panels' buttons: the recipes, the agent, the edits, the code, the export, the
// settings. A panel docks beside the picture, part of the slab, a rule between them as the slab's own, no title over
// it (its button says which); its button again closes it; its left edge drags its width; the choice and the width are
// remembered. Undo is undo, nothing else
test('editor: undo and redo after the length, a band\'s look in its foot, none moving; the panels\' buttons at the top right; a panel docks beside the picture', async () => {
  await open()
  const box = name => page.locator(name).boundingBox()
  const [panes, view] = await Promise.all(['.panes', '.view-slab'].map(box))
  assert.ok(Math.abs(view.width - panes.width) < 2, 'the picture the whole width')
  // the bar's last, Before, as far in from the slab's right edge as Play is from its left
  const before = await box('.before')
  assert.ok(panes.x + panes.width - before.x - before.width >= 12, `Before clear of the edge: ${panes.x + panes.width - before.x - before.width}`)
  const buttons = await Promise.all(['Recipes', 'Agent', 'Edits', 'Code', 'Export', 'Settings'].map(name => page.getByRole('tab', { name, exact: true }).boundingBox()))
  assert.ok(buttons.every((b, i) => b.y < view.y && (!i || b.x > buttons[i - 1].x)) && buttons.at(-1).x > panes.x + panes.width * .8, 'the panels\' buttons in order at the slab\'s top right')
  assert.equal(await page.locator('.bar .history, .status .panels').count(), 0, 'none in the page\'s bar, none at the foot')
  await tab('Edits')
  await page.locator('.stack').waitFor()
  await page.locator('.script').waitFor({ state: 'hidden' })
  assert.equal(await page.locator('.panel-head, .panel-title').count(), 0, 'no title over it: its button, lit, says which it is')
  assert.equal(await page.locator('.side-slab').getAttribute('aria-label'), 'Edits')
  const [narrow, side, plot] = await Promise.all(['.view-slab', '.side-slab', '.plot'].map(box))
  assert.ok(narrow.width < view.width - 200 && side.x >= narrow.x + narrow.width - 1 && side.y >= buttons[0].y + buttons[0].height, 'docked beside the picture, under the buttons')
  // in the bar at the picture's foot: undo, redo, after the length, before the rate; what the picture shows, chosen by
  // its look in the sound's foot under its axis, none of them moving as the picture turns
  const heads = () => Promise.all([page.getByRole('button', { name: 'Undo', exact: true }), page.getByRole('button', { name: 'Redo', exact: true }), page.locator(':is(.lane-look, .layer-look):visible')].map(b => b.boundingBox()))
  const [undo, redo, look] = await heads()
  const length = await box('.length'), rate = await box('.facts')
  assert.ok(undo.y > plot.y + plot.height && undo.x >= length.x + length.width && undo.x < redo.x && redo.x + redo.width < rate.x, 'undo, redo at the foot, after the length, before the rate')
  // one baseline: the time's, the length's, the status's words, the arrows' feet; a narrower bar's smaller time keeps it
  const baselines = () => page.evaluate(() => {
    const base = e => { const i = document.createElement('i'); i.style.cssText = 'display: inline-block; width: 0; height: 0'; e.append(i); const y = i.getBoundingClientRect().y; i.remove(); return y }
    return { time: base(document.querySelector('.time')), length: base(document.querySelector('.length')), facts: base(document.querySelector('.facts .fact')), feet: document.querySelector('.status .undo path').getBoundingClientRect().bottom }
  })
  const wide = await baselines()
  assert.ok(Object.values(wide).every(y => Math.abs(y - wide.length) <= 1.5), `on one baseline: ${JSON.stringify(wide)}`)
  const size = await page.viewportSize()
  await page.setViewportSize({ width: 860, height: size.height })
  await page.waitForFunction(() => getComputedStyle(document.querySelector('.clock')).getPropertyValue('--time-size').trim() === '28px')
  const smaller = await baselines()
  assert.ok(Math.abs(smaller.time - wide.time) <= 1 && Math.abs(smaller.feet - wide.feet) <= 1, `the smaller time on the same baseline: ${JSON.stringify(smaller)}`)
  await page.setViewportSize(size)
  const axis = plot.x + plot.width - await gutter(), foot = plot.y + tall(plot)
  assert.ok(Math.abs(look.x - axis - 1) <= 1 && Math.abs(look.y - foot - 1) <= 1, `the look in the sound's foot, under its axis: ${look.x}, ${look.y}; ${axis}, ${foot}`)
  await show('spec')
  assert.deepEqual((await heads()).map(b => b.x), [undo, redo, look].map(b => b.x), 'nothing moved as it turned')
  await show('wave')
  // part of the slab: no ground of its own; between it and the picture a rule in the slab's rule colour, as far from its
  // content as that is from the slab's edge
  assert.equal(await page.locator('.side-slab').evaluate(el => [getComputedStyle(el).backgroundColor, getComputedStyle(el).boxShadow].join(' ')), 'rgba(0, 0, 0, 0) none')
  const rule = await page.locator('.panel-edge').evaluate(el => { const r = getComputedStyle(el, '::before'), probe = Object.assign(document.createElement('i'), { style: 'color: var(--color-screen-rule)' }); el.append(probe); const want = getComputedStyle(probe).color; probe.remove(); return { color: r.backgroundColor, want, x: el.getBoundingClientRect().x + parseFloat(r.left), width: parseFloat(r.width) } })
  assert.equal(rule.color, rule.want, 'the slab\'s rule colour')
  assert.equal(rule.width, 1)
  const [card, panel] = await Promise.all([page.locator('.step').first().boundingBox(), box('.side-slab')])
  assert.ok(Math.abs((card.x - (rule.x + 1)) - (panel.x + panel.width - (card.x + card.width))) <= 1, `as far from the cards as they are from the edge: ${card.x - rule.x - 1}, ${panel.x + panel.width - card.x - card.width}`)
  await page.locator('.step-name', { hasText: 'Normalize' }).click()
  await page.locator('.step.open .params input[type=range]').first().fill('500')
  await page.locator('.readout', { hasText: '−18.0dBFS' }).waitFor()
  // a right-click on undo undoes nothing and opens nothing; a click undoes
  await page.getByRole('button', { name: 'Undo', exact: true }).click({ button: 'right' })
  await page.keyboard.press('Escape')
  assert.match(await code(), /normalize\(-18\)/, 'nothing undone')
  assert.equal(await page.locator('.side-slab').getAttribute('aria-label'), 'Edits', 'the panel as it was')
  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  await page.waitForFunction(() => scriptText().includes('.normalize(-1)'))
  // its button again closes it
  await page.getByRole('tab', { name: 'Edits', exact: true }).click()
  await page.locator('.side-slab').waitFor({ state: 'hidden' })
  // another panel's button turns it to that one; again, it closes
  await tab('Code')
  await page.locator('.script').waitFor()
  await page.getByRole('tab', { name: 'Code', exact: true }).click()
  await page.locator('.side-slab').waitFor({ state: 'hidden' })
  // its left edge drags its width, kept, and so is the panel shown
  await tab('Export')
  const was = await box('.side-slab'), edge = await box('.panel-edge'), y = edge.y + edge.height / 2
  await page.mouse.move(edge.x + edge.width / 2, y)
  await page.mouse.down()
  await page.mouse.move(edge.x + edge.width / 2 - 100, y, { steps: 5 })
  await page.mouse.up()
  const wider = await box('.side-slab')
  assert.ok(Math.abs(wider.width - was.width - 100) < 3, `${was.width} → ${wider.width}`)
  await page.reload()
  // rendered: the readout says so, out of sight where the wider panel leaves the bar too narrow for it (editor.css)
  await wholeLevels().waitFor({ state: 'attached' })
  await page.locator('.export').waitFor()
  assert.ok(Math.abs((await box('.side-slab')).width - wider.width) < 2, 'its width kept')
  await page.getByRole('tab', { name: 'Export', exact: true }).click()
  await page.locator('.side-slab').waitFor({ state: 'hidden' })
})

// A panel opening beside the picture leaves it where it starts and at its scale, less of the sound showing, never
// squeezed; so does a narrower window. A range on silence, its edges' columns: the caret's line at its start, the
// wash's last, the same before and after
test('editor: a panel opening, or the window narrowing, keeps where the picture starts and its scale', async () => {
  await open()
  await noCues()
  await write(`audio.from(2)`)
  await lengthIs('0:02.000')
  const view = await page.locator('.view-slab').boundingBox()
  await drag([view.x + 300, view.y + 60], [200, 0])
  await page.mouse.move(view.x + 5, view.y + view.height - 30)
  // read on a row 60 px down the lane: where the selection's wash begins, and the caret's line, at its end (where the
  // drag left it)
  const edges = () => pixels(`const at = px => d[(60 * w + px) * 4]; let start = -1, line = 0; for (let px = 1; px < w - 60; px++) { if (at(px) > at(line)) line = px; if (start < 0 && at(px) > at(px - 1) + 4) start = px } return [start, line]`)
  const before = await edges()
  assert.ok(before[1] - before[0] > 190, JSON.stringify(before))
  await tab('Export')
  await still()
  assert.deepEqual(await edges(), before, 'the panel open')
  await page.setViewportSize({ width: 1000, height: 720 })
  await still()
  assert.deepEqual(await edges(), before, 'the window narrower')
})

// A phone held upright: the picture over the panel, half of the slab each, the bar between them; the panels' buttons
// along the slab's foot, each staying where it is as its panel opens and closes; over the picture its head alone, undo
// in the bar after the time
test('editor: on a phone the panel opens under the picture, its buttons at the foot where they stay', async () => {
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true })
  const p = await phone.newPage()
  await chimeLeft(p)
  p.on('pageerror', e => errors.push(e.message))
  try {
    await p.goto(origin + '/playground/')
    await p.waitForFunction(() => document.querySelector('.readout')?.dataset.of === 'all')
    const box = selector => p.locator(selector).boundingBox(), edits = p.getByRole('tab', { name: 'Edits', exact: true })
    const [slab, status, button] = [await box('.panes'), await box('.status'), await edits.boundingBox()]
    assert.ok(button.y >= status.y + status.height - 1 && slab.y + slab.height - (button.y + button.height) < 12, `at the foot: ${JSON.stringify({ slab, status, button })}`)
    assert.ok(button.width >= 44 && button.height >= 44, 'a finger\'s size')
    const time = await box('.time'), undo = await box('.history .undo')
    assert.ok(undo.x >= time.x + time.width && undo.y >= status.y && undo.y + undo.height <= status.y + status.height, `undo in the bar after the time: ${JSON.stringify({ time, undo })}`)
    await edits.tap()
    await p.locator('.side-slab .add-step').waitFor()
    assert.deepEqual(await edits.boundingBox(), button, 'where it was')
    const [view, side, under] = [await box('.view-slab'), await box('.side-slab'), await box('.status')]
    assert.ok(view.y + view.height <= under.y + 1 && side.y >= under.y + under.height - 1, 'the picture, the bar, the panel')
    assert.ok(Math.abs(view.height - side.height) < 2, `half and half: ${view.height}, ${side.height}`)
    await edits.tap()
    await p.locator('.side-slab').waitFor({ state: 'hidden' })
    assert.ok((await box('.view-slab')).height > view.height * 1.8, 'closed, the picture whole again')
  } finally { await phone.close() }
})

// The status bar holds still: the transport, the clock, the levels and the rate stay where they are as a selection is made,
// held at its start and dragged, played, and the levels are never cut short, in a wide window and a narrow one (the
// message between them is the one that gives way)
for (const width of [1280, 880]) test(`repl: the status bar holds still as a selection is made, scrubbed and played, a ${width}px window`, async () => {
  await page.setViewportSize({ width, height: 720 })
  await open()
  const still = () => page.evaluate(() => {
    const rect = s => { const r = document.querySelector(`#status ${s}`).getBoundingClientRect(); return [Math.round(r.left), Math.round(r.width)] }
    return { ...Object.fromEntries(['.play', '.record', '.loop', '.clock', '.readout', '.facts'].map(s => [s, rect(s)])), message: rect('.message')[0] }
  })
  const idle = await still(), { box, x } = await axis(6.525), y = box.y + tall(box) / 2
  await page.mouse.move(x(1), y)
  await page.mouse.down()
  await page.mouse.move(x(3), y, { steps: 6 })
  await page.mouse.up()
  await page.locator('.length', { hasText: /^0:02\.\d+$/ }).waitFor()
  assert.deepEqual(await still(), idle, 'a selection made')
  await page.mouse.move(x(1) + 1, y)
  await page.mouse.down()
  for (let i = 1; i <= 4; i++) {
    await page.mouse.move(x(1 + i / 4), y, { steps: 3 })
    // a moment for what the drag sets off (the selection's levels) to land
    await page.waitForTimeout(80)
    assert.deepEqual(await still(), idle, 'its start held and dragged')
  }
  await page.mouse.up()
  await page.keyboard.press('Space')
  await page.getByRole('button', { name: 'Pause' }).waitFor()
  // playing a moment, the clock running
  await page.waitForTimeout(200)
  assert.deepEqual(await still(), idle, 'played')
  assert.ok(await page.locator('.readout').evaluate(e => e.scrollWidth <= e.clientWidth), 'the levels whole')
})

// The level and the facts after it one row of figures, as far apart each from the next, embedded as in the whole editor
// (where nothing comes before the level, it keeps by the facts); a tablet's bar, an iPad's 768 px held upright, has
// them all
test('repl: the level and the facts as far apart as each other, embedded or not, a tablet\'s bar showing them', async () => {
  const gaps = () => page.evaluate(() => {
    const text = el => { const r = document.createRange(); r.selectNodeContents(el); return r.getBoundingClientRect() }
    const all = [document.querySelector('.readout'), ...document.querySelectorAll('.facts .fact')].filter(e => getComputedStyle(e).display !== 'none' && e.getClientRects().length).map(text)
    return all.slice(1).map((b, i) => Math.round(b.left - all[i].right))
  })
  await page.setViewportSize({ width: 768, height: 720 })
  await open()
  await wholeLevels().waitFor()
  const whole = await gaps()
  assert.ok(whole.length === 3 && whole.every(g => g === whole[0]), `the level and three facts, evenly: ${whole}`)
  await page.goto(origin + '/blank.html')
  const src = await page.evaluate(async () => {
    await import('/playground/embed.js')
    document.body.innerHTML = `<audio-repl panel="none" controls="play clock history loudness rate channels"><pre><code>audio('chime.wav')</code></pre></audio-repl>`
    return new Promise(r => { const t = setInterval(() => { const f = document.querySelector('audio-repl iframe'); if (f) { clearInterval(t); r(f.getAttribute('src')) } }, 20) })
  })
  await page.setViewportSize({ width: 560, height: 400 })
  await page.goto(new URL(src, origin).href)
  await page.waitForFunction(() => /LUFS$/.test(document.querySelector('.readout')?.textContent))
  const embedded = await gaps()
  assert.ok(embedded.length === 2 && embedded.every(g => g === whole[0]), `embedded, as far apart: ${embedded}, the whole editor's ${whole[0]}`)
})

// Nothing in the bar runs past its end at any width, the panel shut or open: as it narrows, its parts give way (editor.css
// @container bar, picture), the time and the length keeping their size where they did before undo and redo came after them
test('repl: the status bar never runs past its end, from a wide window to a phone\'s', async () => {
  await page.setViewportSize({ width: 1280, height: 720 })
  await open()
  assert.equal(await page.locator('.clock').evaluate(e => getComputedStyle(e).getPropertyValue('--time-size').trim()), '40px', 'the time at its full size, wide')
  const over = []
  for (const side of [false, true]) {
    if (side) await tab('Edits')
    for (let width = 1400; width >= 340; width -= 6) {
      await page.setViewportSize({ width, height: 720 })
      const o = await page.evaluate(() => ['.status', '.status-main'].map(s => { const e = document.querySelector(s); return e.scrollWidth - e.clientWidth }))
      if (Math.max(...o) > 1) over.push(`${width}${side ? ' open' : ''}: ${o}`)
    }
  }
  assert.deepEqual(over, [])
})

// A resized canvas is blank until drawn; drawn a frame later, every step of a resize flashes empty (20 of these 40
// frames were, before the view drew in its resize callback). The panel's width is the view's to give up.
test('editor: resizing the panes never shows a blank frame', async () => {
  await open()
  const blank = await page.evaluate(async () => {
    const panes = document.querySelector('.panes'), overlay = document.querySelector('.plot canvas.overlay'), g = overlay.getContext('2d')
    let empty = 0
    for (let i = 0; i < 20; i++) {
      panes.style.setProperty('--panel', `${300 + i * 7}px`)
      for (let f = 0; f < 2; f++) {
        await new Promise(r => requestAnimationFrame(r))
        const d = g.getImageData(0, 0, overlay.width, overlay.height).data
        let lit = 0
        for (let k = 3; k < d.length; k += 4 * 97) if (d[k]) lit++
        if (!lit) empty++
      }
    }
    return empty
  })
  assert.equal(blank, 0)
})

// One block: a head over the picture and the panel, the bar along the foot of both, the transport at its start, a
// status bar as an editor's; the panel docked at the picture's right
test('editor: output and bar are one block, the panel docked at the output\'s right, from under the head to the bar', async () => {
  await open()
  await tab('Edits')
  const box = name => page.locator(name).boundingBox()
  const [panes, bar, record, play, view, side, head] = await Promise.all(['.panes', '.status', 'button.record', 'button.play', '.view-slab', '.side-slab', '.view-head'].map(box))
  assert.ok(Math.abs(bar.y + bar.height - (panes.y + panes.height)) <= 1, 'the bar ends the block')
  assert.ok(Math.abs(bar.x - panes.x) <= 1 && Math.abs(bar.x + bar.width - (panes.x + panes.width)) <= 1, 'the whole width')
  const loop = await box('button.loop')
  assert.ok(play.x - bar.x < 24 && play.x < record.x && record.x < loop.x && loop.x + loop.width < view.x + view.width, 'play, record, loop, at its start')
  assert.equal(await page.locator('.status').evaluate(el => getComputedStyle(el).borderTopWidth), '0px')
  const over = await box('.side-head')
  assert.ok(Math.abs(head.width + over.width - panes.width) <= 1 && head.y + head.height <= view.y + 1 && Math.abs(over.x - side.x) <= 1, 'the head over both: the picture\'s and the panel\'s')
  // the panel beside the output at its right, under the head, short of the bar, whatever an older page left stored
  assert.ok(side.x >= view.x + view.width - 1 && side.x + side.width <= panes.x + panes.width, 'beside the output, at its right')
  assert.ok(side.y >= head.y + head.height - 1 && side.y + side.height <= bar.y, 'under the head, short of the bar')
  await page.evaluate(() => localStorage.setItem('audio-repl', JSON.stringify({ ...JSON.parse(localStorage.getItem('audio-repl')), layout: 'column', side: 'stack' })))
  await page.reload()
  await wholeLevels().waitFor()
  const [picture, panel] = await Promise.all(['.view-slab', '.side-slab'].map(box))
  assert.ok(panel.x >= picture.x + picture.width - 1, 'still beside it')
  assert.ok(await edits(), 'a panel stored under an old name opens on the edits')
})

// Wide and short, a laptop's window or a landscape phone's: the panel beside the picture, not a sheet over its tracks
test('editor: a wide, short window keeps the panel beside the picture', async () => {
  await page.setViewportSize({ width: 1280, height: 480 })
  await open()
  await tab('Edits')
  const [side, view] = await Promise.all(['.side-slab', '.view-slab'].map(s => page.locator(s).boundingBox()))
  assert.ok(side.x >= view.x + view.width - 1 && side.y < view.y + view.height / 2, `the panel at ${side.x},${side.y}, the picture ${view.x}–${view.x + view.width}`)
})

// On a narrow screen held upright a panel opens under the output, the whole width, the bar between them, as much of the
// slab as the picture keeps; its buttons stay in reach
test('editor: a shared link restores the script; on a narrow screen the panel opens under the output, the whole width', async () => {
  await open()
  await write(`audio('chime.wav').reverse()`)
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin })
  await page.getByRole('button', { name: 'Share' }).click()
  await page.waitForFunction(() => location.hash.startsWith('#code='))
  const url = page.url()
  await page.close()
  setPage(await browser.newPage({ viewport: { width: 390, height: 844 } }))
  page.on('pageerror', error => errors.push(error.message))
  await page.goto(url)
  await wholeLevels().waitFor({ state: 'attached' })
  assert.equal(await code(), `audio('chime.wav').reverse()`)
  await tab('Edits')
  const view = await page.locator('.view-slab').boundingBox(), chain = await page.locator('.side-slab').boundingBox(), bar = await page.locator('.status').boundingBox()
  assert.ok(chain.width >= view.width - 14 && chain.y >= bar.y + bar.height - 1 && bar.y >= view.y + view.height - 1, `under the output and its bar: ${JSON.stringify(chain)} under ${JSON.stringify(view)}`)
  assert.ok(Math.abs(chain.height - view.height) < 2, 'as tall as the picture')
  for (const name of ['Code', 'Export', 'Settings']) assert.ok(await page.getByRole('tab', { name, exact: true }).isVisible(), name)
  assert.ok(await page.getByRole('button', { name: 'Undo', exact: true }).isVisible())
})

// ── Loading and the gestures ───────────────────────────────────

// The page is controls, not text: none of it selected by a press that misses; the code, the fields, keep theirs
test('editor: the page selects no text but where there is text to copy', async () => {
  await open()
  const select = sel => page.locator(sel).first().evaluate(e => getComputedStyle(e).userSelect || getComputedStyle(e).webkitUserSelect)
  assert.equal(await select('.status'), 'none')
  assert.equal(await select('.view'), 'none')
  await page.evaluate(() => document.querySelector('.panes .side-head button[aria-label="Code"]')?.click())
  assert.equal(await select('.cm-content'), 'text')
})

// The status bar at a desktop's, a tablet's and a phone's width, a sound shown and one decoding: one row in reading
// order (the transport, the time, its length, undo and redo, what the engine says, the levels and facts, Before), each
// part whole in the bar and in the window, none over another, the time and its length never cut; the length shown but
// on a phone. Layout read from the boxes, not from pixels
for (const [device, width, height, touch] of [['desktop', 1280, 800, false], ['tablet', 820, 1180, true], ['phone', 390, 844, true]]) test(`editor: the bar on a ${device}: the time, the length, the status, undo and redo in a row, whole, none over another`, async () => {
  const ctx = await browser.newContext({ viewport: { width, height }, isMobile: touch, hasTouch: touch })
  try {
    // its parts in reading order, those shown: { name, x, y, w, h, cut }; the bar's box; the page's width and the window's
    const parts = p => p.evaluate(() => {
      const box = e => { const r = e.getBoundingClientRect(), s = getComputedStyle(e); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' ? { x: r.x, y: r.y, w: r.width, h: r.height, cut: e.scrollWidth > e.clientWidth + 1 } : null }
      const named = [['play', '.deck-slot:has(.play)'], ['record', '.deck-slot:has(.record)'], ['loop', '.loop'], ['time', '.time'], ['length', '.length'], ['undo', '.history .undo'], ['redo', '.history button:last-child'],
        ['status', '.message-words'], ['readout', '.readout'], ['facts', '.facts'], ['before', '.before']]
      const shown = named.map(([name, s]) => { const e = document.querySelector(s), b = e && (name !== 'status' || e.textContent) && box(e); return b && { name, ...b } }).filter(Boolean)
      return { shown, bar: box(document.querySelector('.status')), page: document.documentElement.scrollWidth, window: innerWidth }
    })
    const check = async (p, state, must) => {
      const { shown, bar, page: wide, window } = await parts(p), at = name => shown.find(s => s.name === name), play = at('play')
      const say = `${device}, ${state}: ${JSON.stringify(shown.map(({ name, x, w }) => [name, Math.round(x), Math.round(w)]))}`
      assert.ok(wide <= window, `${device}, ${state}: the page ${wide} px wide in a window of ${window}`)
      for (const name of must) assert.ok(at(name), `${device}, ${state}: ${name} shown`)
      for (const s of shown) {
        assert.ok(s.x >= bar.x - .5 && s.x + s.w <= bar.x + bar.w + .5 && s.y >= bar.y - .5 && s.y + s.h <= bar.y + bar.h + .5, `${say}: ${s.name} in the bar`)
        assert.ok(s.x >= 0 && s.x + s.w <= window + .5, `${say}: ${s.name} in the window`)
        assert.ok(s.y < play.y + play.h && s.y + s.h > play.y, `${say}: ${s.name} on the transport's row`)
      }
      for (const name of ['time', 'length', 'status']) assert.ok(!at(name)?.cut, `${say}: the ${name} whole, not cut`)
      // in reading order, each after the last, none over another
      shown.slice(1).forEach((s, i) => assert.ok(s.x >= shown[i].x + shown[i].w - .5, `${say}: ${s.name} after ${shown[i].name}, clear of it`))
    }
    const p = await ctx.newPage()
    await chimeLeft(p)
    p.on('pageerror', e => errors.push(e.message))
    await p.goto(origin + '/playground/')
    await p.locator('.readout[data-of="all"]').waitFor({ state: 'attached' })
    await settled(p)
    await check(p, 'a sound shown', ['play', 'record', 'time', 'undo', 'redo', ...device === 'phone' ? [] : ['length', 'readout', 'facts', 'before']])
    await p.close()
    // a file decoding, said in the status, how much has come
    const q = await ctx.newPage()
    await q.addInitScript(url => localStorage.setItem('audio-repl', JSON.stringify({ code: `audio('${url}')` })), `${origin}/slow/test/fixture.wav`)
    q.on('pageerror', e => errors.push(e.message))
    await q.goto(origin + '/playground/')
    await q.locator('.message', { hasText: /^Decoding/ }).waitFor()
    await check(q, 'a file decoding', ['play', 'record', 'time', 'undo', 'redo', 'status', ...device === 'phone' ? [] : ['length']])
  } finally { await ctx.close() }
})
