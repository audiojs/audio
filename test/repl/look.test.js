// How the page and its pictures look: themes, the settings, the waveform's and the spectrogram's looks; the server, the
// page and the helpers in page.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile, open as openFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { TOP, TRACK, page, origin, tipOf, wholeLevels, open, settled, frames, poll, still, choice, settings, tab, download, menu, menuRow, write, LANES, NAMED, tall, gutter, tracksAt, lengthIs, gridShown, pixels, show, shown, themed, axis, noCues } from './page.js'
import { resolver, semantics } from '../../repl/theme.js'

// The axis at the pictures' right is as wide as its labels and the pointer's value read out on it, five characters at
// full scale: a sample value to a digit finer than the marks (−0.03), decibels to a tenth with no unit (−12.3), a
// frequency to three digits (1.23k), the spectrogram's level whole (−100); it goes on to the right of its tick, never
// back over the meters. Either picture, either unit, the same, so nothing moves as one turns to the other
test('editor: the axis is five characters wide at full scale, the same for either picture and either unit', async () => {
  await open({ edits: true })
  await tab('Edits')
  const axis = () => page.evaluate(() => parseFloat(getComputedStyle(document.querySelector('.panes')).getPropertyValue('--axis')))
  await page.waitForFunction(() => getComputedStyle(document.querySelector('.panes')).getPropertyValue('--axis'))
  const wave = await axis()
  const [five, six] = await page.evaluate(() => { const g = document.createElement('canvas').getContext('2d'); g.font = `${parseFloat(getComputedStyle(document.querySelector('.plot')).getPropertyValue('--font-size-label')) || 10}px ${getComputedStyle(document.querySelector('.plot')).getPropertyValue('--font-mono')}`; return ['−0.03', '−12.3d'].map(t => g.measureText(t).width) })
  assert.ok(wave >= five + 4 && wave < six + 4, `${wave} px: five characters, ${five} px, and not six`)
  // what the axis says with the pointer in a lane, 0.4 of full scale up: its labels and the pointer's value, none over
  // five characters
  const plot = await page.locator('.plot').boundingBox()
  await page.evaluate(() => {
    window.__said = []
    const text = CanvasRenderingContext2D.prototype.fillText
    CanvasRenderingContext2D.prototype.fillText = function (s, x, y) { if (this.canvas.matches('.overlay')) window.__said.push({ s, x }); return text.call(this, s, x, y) }
  })
  const lane = (TRACK - LANES) / 2, y = plot.y + TOP + lane / 2 - lane * .2
  const said = async () => {
    await page.evaluate(() => window.__said = [])
    await page.mouse.move(plot.x + plot.width / 3, y + (said.n = (said.n ?? 0) + 1) % 2 * 4)
    await frames()
    const list = (await page.evaluate(() => window.__said)).filter(t => t.x >= plot.width - wave).map(t => t.s)
    assert.ok(list.length && list.every(t => t.length <= 5), `five characters at most: ${list}`)
    return list
  }
  assert.ok((await said()).some(t => /^0\.\d\d$/.test(t)), 'a sample value to two decimals, 0.40 or so')
  await show('spec')
  await settled()
  assert.equal(await axis(), wave, 'the spectrogram the same')
  await said()
  await show('wave')
  await settings('Levels in', 'Decibels')
  await settled()
  assert.equal(await axis(), wave, 'the levels in decibels the same')
  assert.ok((await said()).some(t => /^−\d{1,2}\.\d$/.test(t)), 'decibels to a tenth, no unit')
})

// The lanes bare (Grid: None, the default); with Lines (View, Grid), a faint line down from each of the time row's ticks
// and across from each of the level axis', where the sound is quiet (2.5 to 3 s): at 2.5 s and at 0.5, none between the
// ticks, none behind the waveform where a hit is (0.5 s, 0). In decibels, across from −6 dB's tick. With None, or with no
// sound, nothing at all
test('editor: the lanes bare, or lines from the ticks; hidden behind the waveform, and gone with None or no sound', async () => {
  await open()
  // one lane, tall enough for the half levels' labels over their ticks (a stereo sound's half lanes keep ±1 and 0)
  await write(`audio('chime.wav')\n  .trim()\n  .normalize(-1)\n  .fade(0.02, 0.1)\n  .remix(1)`)
  await lengthIs('0:06.525')
  // (as long as the stereo sound it follows: its own output in)
  await settled()
  await page.mouse.move(2, 2)
  // the ticks drawn over the sound (the overlay's, the reel's marks: the time row's), each followed by its label
  await page.evaluate(() => {
    window.__ticks = []
    const proto = CanvasRenderingContext2D.prototype, rect = proto.fillRect, text = proto.fillText
    proto.fillRect = function (x, y, w, h) { if (this.canvas.matches('.overlay, .marks, .row')) window.__ticks.push({ x, y, w, h }); return rect.call(this, x, y, w, h) }
    proto.fillText = function (s, x, y) { if (this.canvas.matches('.overlay, .marks, .row')) window.__ticks.push({ s, y }); return text.call(this, s, x, y) }
  })
  // its rects, drawn as triangles in the waveform's canvas (view.js paintGrid; a waveform draws a strip), counted as the
  // picture is drawn
  await page.evaluate(() => {
    window.__ruled = 0
    const proto = WebGL2RenderingContext.prototype, draw = proto.drawArrays
    proto.drawArrays = function (...a) { if (a[0] === this.TRIANGLES && this.canvas.matches('.waveform')) window.__ruled += a[2]; return draw.apply(this, a) }
  })
  // none drawn as the picture is drawn again (the window a pixel narrower and back)
  const blank = async () => {
    await page.evaluate(() => window.__ruled = 0)
    const size = page.viewportSize()
    await page.setViewportSize({ ...size, width: size.width - 1 })
    await frames()
    await page.setViewportSize(size)
    await frames()
    return !await page.evaluate(() => window.__ruled)
  }
  assert.ok(await blank(), 'bare by default: nothing ruled')
  await menu('View', 'Grid')
  // the layers laid again, each only as its drawing changes (view.js, kept.js): the window a pixel narrower and back,
  // the pointer on the band's head (its axes drawn, none read out)
  await page.locator('.plot').hover({ position: { x: 10, y: NAMED } })
  await page.evaluate(() => window.__ticks = [])
  await blank()
  const calls = await page.evaluate(() => window.__ticks), at = {}
  calls.forEach((c, i) => { if (c.w && calls[i + 1]?.s) at[calls[i + 1].s] ??= c.h === 1 ? c.y : c.x })
  // the times a second apart by their ticks, the strike at 0.5 s ringing at 0.6; the levels where the view lays them, 0.5
  // between 0 and 1 unlabelled, a waveform's levels written with no tick by them (scales.js ticks)
  const [s1, c0, c1] = [at['0:01'], at['0:02'], at['0:03']], px = t => s1 + (t - 1) * (c0 - s1), hit = px(.6)
  const [r1, r5, r0, foot] = await page.evaluate(async () => {
    const { lanes } = await import('/repl/view/geometry.js'), { levelMarks, levelTicks } = await import('/repl/view/scales.js'), rect = lanes().all[0], marks = levelMarks(rect), y = text => Math.round(marks.find(m => m[1] === text)[0])
    return [y('1'), Math.round(levelTicks(rect).map(t => t[0]).find(ty => ty > y('1') && ty < y('0'))), y('0'), y('−1')]
  })
  assert.ok([s1, c0, c1].every(Number.isFinite), `ticks at 1 s, 2 s, 3 s: ${JSON.stringify(at)}`)
  assert.ok(!calls.some((c, i) => c.w && c.h === 1 && ['1', '0', '−1'].includes(calls[i + 1]?.s)), 'no tick by a level')
  assert.ok(!calls.some(c => c.s === '0.5'), '0.5 unlabelled')
  // each level's label under its line, the lane's foot one too (one lane: nothing under it to run into)
  const label = text => calls.find(c => c.s === text)?.y
  assert.ok(label('1') > r1 && label('0') > r0 && label('−1') > foot, `labels under their lines: 1 at ${label('1')} by ${r1}, −1 at ${label('−1')} by ${foot}`)
  // the most a 3 × 3 px square round each point is lit by the grid as it shows (gridShown), CSS px
  const lit = points => page.evaluate(points => {
    const { k, w, d } = window.__shown
    return points.map(([x, y]) => { let m = 0; for (let j = Math.floor((y - 1) * k); j < Math.floor((y - 1) * k) + Math.ceil(3 * k); j++) for (let i = Math.floor((x - 1) * k); i < Math.floor((x - 1) * k) + Math.ceil(3 * k); i++) m = Math.max(m, d[j * w + i]); return m })
  }, points)
  const mid = [(c0 + c1) / 2, (r5 + r0) / 2]
  await gridShown()
  const [down, across, between, behind] = await lit([[px(2.6), mid[1]], [mid[0], r5], mid, [hit, r0]])
  // from each tick between the labelled ones too, as the time row has them: a fifth of a second each, here
  assert.ok(down && across, 'a line down from 2.6 s and across from 0.5')
  assert.ok((await lit([[px(2.8), mid[1]]]))[0], 'a line down from 2.8 s, as its tick')
  assert.equal(between, 0, 'none between the ticks')
  assert.equal(behind, 0, 'none behind the waveform')
  // the levels in decibels: a line across from −6 dB, written with no tick by it
  await page.evaluate(() => window.__ticks = [])
  await settings('Levels in', 'Decibels')
  await page.locator('.plot').hover({ position: { x: 10, y: NAMED } })
  await settled()
  const db = await page.evaluate(() => window.__ticks)
  const r6 = await page.evaluate(async () => { const { lanes } = await import('/repl/view/geometry.js'), { levelMarks } = await import('/repl/view/scales.js'), m = levelMarks(lanes().all[0]).find(m => m[1] === '−6'); return m && Math.round(m[0]) })
  assert.ok(Number.isFinite(r6) && db.some(c => c.s === '−6') && !db.some((c, i) => c.w && c.h === 1 && db[i + 1]?.s === '−6'), 'the level −6 dB, written, no tick by it')
  await gridShown()
  assert.ok((await lit([[mid[0], r6]]))[0], 'a line across from −6 dB')
  assert.ok(!await blank(), 'its rects drawn')
  await menu('View', 'Grid')
  assert.ok(await blank(), 'nothing with None')
  // nor where there is no sound: a new tab, empty
  await menu('View', 'Grid')
  await page.getByRole('button', { name: 'New tab' }).click()
  await page.locator('.plot[data-empty]').waitFor()
  assert.ok(await blank(), 'nothing with no sound')
})

// The export's icon an arrow down onto a line (Iconoir's download), the switches in it joined (raised keys in one bezel); a band's look opens
// on a click alone
test('editor: the settled icons; the switches are keys in a bezel; a band\'s look right-clicked opens nothing', async () => {
  await open()
  assert.equal(await page.locator('.status .download path').getAttribute('d'), 'M6 20h12M12 4v12m0 0 3.5-3.5M12 16l-3.5-3.5', 'an arrow down onto a line, Iconoir\'s')
  await download()
  // the switches, settled: raised keys in one bezel, each touching the next
  const group = page.locator('.export .choices').first()
  const [first, second] = await group.locator('button').evaluateAll(list => list.slice(0, 2).map(b => b.getBoundingClientRect()).map(r => [r.left, r.right]))
  assert.equal(second[0], first[1], 'raised keys in one bezel')
  assert.match(await group.evaluate(el => getComputedStyle(el).boxShadow), /0px 0px 0px 1px inset/, 'the bezel a ring round them')
  // a band's look right-clicked opens nothing, nor turns it
  await page.keyboard.press('Escape')
  await page.locator(':is(.lane-look, .layer-look):visible').click({ button: 'right' })
  assert.equal(await page.locator('.dropdown:popover-open').count(), 0, 'no dropdown')
  assert.equal(await shown(), 'Waveform', 'not turned')
})

// The frequency scale is the spectrogram's own, in the dropdown its tab opens, pressed again; snapping is a setting, the
// panel's last tab; both kept
test('editor: the spectrogram\'s frequency scale from its dropdown, snapping from the settings, both remembered', async () => {
  await open()
  await show('spec')
  const plot = page.locator('.plot'), now = () => plot.getAttribute('data-scale')
  assert.equal(await now(), 'log')
  await show('spec')
  assert.equal(await now(), 'log', 'shown again, the same')
  // its look, its dropdown, the spectrogram's groups in it; Esc closes it, a choice pressed or not
  await page.locator(':is(.lane-look, .layer-look):visible').click()
  await choice('Frequency scale', 'Hertz').click()
  assert.equal(await now(), 'lin')
  await page.keyboard.press('Escape')
  assert.equal(await page.locator('.dropdown:popover-open').count(), 0, 'Esc closes it')
  // the window left (another app; embedded, a press on the page around it): it closes, as the menus do, its look let go
  await page.locator(':is(.lane-look, .layer-look):visible').click()
  await page.locator('.dropdown:popover-open').waitFor()
  await page.evaluate(() => dispatchEvent(new Event('blur')))
  assert.equal(await page.locator('.dropdown:popover-open').count(), 0, 'it closes as the window leaves')
  assert.equal(await page.locator(':is(.lane-look, .layer-look):visible').getAttribute('aria-expanded'), 'false')
  // a click on the frequencies switches nothing
  const box = await plot.boundingBox()
  await page.mouse.click(box.x + box.width - 20, box.y + TOP + TRACK * .1)
  assert.equal(await now(), 'lin')
  await menu('View', 'Snap')
  await page.waitForFunction(() => (s => s.snap === false && s.scale === 'lin')(JSON.parse(localStorage.getItem('audio-repl'))))
  await page.reload()
  await wholeLevels().waitFor()
  assert.equal(await now(), 'lin')
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('audio-repl')).snap), false)
})

test('editor: the waveform fill is as bright as the signal is often at that level', async () => {
  await open()
  // noise spends most of its time near silence and rarely reaches its peaks
  await write(`audio.from(t => (Math.random() - 0.5) * (Math.random() - 0.5) * 3, { duration: 2 })`)
  await lengthIs('0:02.000')
  await settled()
  await still()
  // brightness down the middle column, from the top of the lane to its centre line
  const column = await pixels(`const x = w >> 1, out = []; for (let y = 0; y < h; y++) { const i = (y * w + x) * 4; out.push(d[i] + d[i + 1] + d[i + 2]) } return out`)
  const box = await page.locator('.plot').boundingBox()
  const lit = column.map((v, y) => [v, y]).filter(([v]) => v > 90), top = lit[0][1], mid = Math.round(column.length * tall(box) / box.height / 2)
  const near = column[mid - 2], far = column[Math.round(top + (mid - top) * .15)]
  assert.ok(near > far * 1.4, `near the centre line ${near}, near the peak ${far}`)
  // a body, not a line at silence: a tenth of the way out to the peak nearly as bright as by the centre line (gl-waveform
  // 5.2's Gaussian about the RMS: 0.93 here; 5.1's crest-fitted power fell to 0.74, a line drawn at zero)
  const tenth = column[Math.round(mid - (mid - top) * .1)]
  assert.ok(tenth > near * .85, `a tenth of the way out ${tenth}, by the centre line ${near}`)
})

// Every setting kept comes back as it was kept; a value the page no longer has, its default; a store that does not read
// is set aside, not written over
test('editor: every setting comes back as it was kept; one the page no longer has, its default', async () => {
  const all = { display: 'spec', scale: 'mel', format: 'flac', encoding: { markers: false, bitDepth: 24 }, spec: 'podcast', cuts: { format: 'otio', fps: 25 }, side: 'code', snap: false, curve: 'cos', levels: 'db', look: { map: 'magma', gamma: .5, depth: 100, size: 2048, method: 'bands' }, wave: { colour: 'centroid', lanes: 'one', fill: 'flat', map: 'magma', weighting: 'k' }, agent: { url: 'http://127.0.0.1:7778', key: '' }, grip: 'speed' }
  await page.addInitScript(all => { if (!sessionStorage.seeded) { sessionStorage.seeded = 1; localStorage.setItem('audio-repl', JSON.stringify({ ...all, docs: [{ code: "audio('chime.wav')" }] })) } }, all)
  await open()
  const kept = () => page.evaluate(() => JSON.parse(localStorage.getItem('audio-repl')))
  const now = await kept()
  for (const [key, value] of Object.entries(all)) assert.deepEqual(now[key], value, key)
  // written from another page of the site, so the editor's own store as it closes doesn't write over it
  const seed = async value => { await page.goto(origin + '/blank.html'); await page.evaluate(v => localStorage.setItem('audio-repl', v), value); await page.goto(origin + '/repl/') }
  await seed(JSON.stringify({ scroll: 'bogus', format: 'wma', look: { map: 'nope', gamma: 2 }, spec: 'radio', docs: [{ code: 5 }, { code: "audio('chime.wav')" }] }))
  await wholeLevels().waitFor()
  const fixed = await kept()
  assert.deepEqual([fixed.scroll, fixed.format, fixed.look.map, fixed.look.gamma, fixed.spec, fixed.docs.length], ['hover', 'wav', 'grey', 1, '', 1])
  // unreadable, set aside: the page as a first visit finds it, an empty tab
  await seed('{"docs": [{"code": "audio(\'chime.wav\')"')
  await page.locator('.plot[data-empty]').waitFor()
  assert.equal(await page.evaluate(() => localStorage.getItem('audio-repl-unread')), '{"docs": [{"code": "audio(\'chime.wav\')"')
})

// The level axis: each level under its tick, in dB or as the sample values; Ctrl and the wheel on it zooms the levels,
// so a quiet sound fills the lane, and 0 shows full scale again
test('editor: the level axis reads in dB or sample values, and zooms', async () => {
  await open()
  await write(`audio.from(t => 0.05 * Math.sin(2 * Math.PI * 220 * t), { duration: 1 })`)
  await lengthIs('0:01.000')
  await settled()
  await still()
  // the pointer on the axis at the lane's middle, 0: the levels zoom about it
  const box = await page.locator('.plot').boundingBox(), ax = box.x + box.width - 26, ay = box.y + TOP + TRACK / 2
  // the waveform's height: bright pixels down the middle column
  const height = () => pixels(`const x = w >> 1; let n = 0; for (let y = 0; y < h - 48; y++) { const i = (y * w + x) * 4; if (d[i] > 120) n++ } return n`)
  const before = await height()
  await page.mouse.move(ax, ay)
  // (a quarter as keen as time's zoom: four turns for one of time's)
  for (let i = 0; i < 24; i++) { await page.keyboard.down('Control'); await page.mouse.wheel(0, -100); await page.keyboard.up('Control') }
  await poll(height, zoomed => assert.ok(zoomed > before * 4, `the quiet sine fills the lane: ${before} → ${zoomed} px`))
  await page.locator('.plot').focus()
  await page.keyboard.press('0')
  await poll(height, n => assert.ok(Math.abs(n - before) <= 2, 'full scale again'))
  // full scale a detent: a few small steps, as a trackpad's pinch gives as the fingers lift, leave it there (they once
  // left it at once, the levels unsnapping as the pinch ended); gathered past 5 px, they zoom in
  await page.mouse.move(ax, ay)
  for (let i = 0; i < 3; i++) { await page.keyboard.down('Control'); await page.mouse.wheel(0, -5); await page.keyboard.up('Control') }
  await frames()
  assert.ok(Math.abs(await height() - before) <= 2, 'held at full scale')
  for (let i = 0; i < 80; i++) { await page.keyboard.down('Control'); await page.mouse.wheel(0, -10); await page.keyboard.up('Control') }
  await poll(height, n => assert.ok(n > before * 1.5, 'small steps zoom in'))
  // in sample values: the pointer on the lane's top edge reads 1
  await settings('Levels in', 'Sample values')
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('audio-repl')).levels), 'linear')
})

// The black-and-white spectrogram is screened over the page (editor.js paint): where the sound is quiet the page shows
// through it, its shading and all, and the louder is the whiter, up to white
test('editor: the black-and-white spectrogram is screened over the page, the page seen through it', async () => {
  await open()
  await write(`audio.from(t => 0.5 * Math.sin(2 * Math.PI * 440 * t), { duration: 1 })`)
  await lengthIs('0:01.000')
  await show('spec')
  await settled()
  // where its quietest tenth sits, and its brightest, in the lane, clear of the gutter and the meters
  await poll(() => pixels(`const lum = i => Math.max(d[i], d[i + 1], d[i + 2]), all = []
    for (let y = Math.round(h * .1); y < Math.round(h * .8); y++) for (let x = 10; x < w - 120; x++) all.push(lum((y * w + x) * 4))
    all.sort((a, b) => a - b)
    return [all[Math.floor(all.length * .1)], all.at(-1)]`), ([floor, top]) => {
    // the screen under it is oklch(21%) to oklch(15.5%) (assets/tokens.css); a picture of its own would cover it in black
    assert.ok(floor >= 10, `its floor is the page, seen through: ${floor}`)
    assert.ok(top > 230, `its loudest is white: ${top}`)
  })
})

// How a band shows, its look in its layer pressed: a dropdown by it, as Figma's: what it shows (the waveform, the
// spectrogram, the notes), then how that draws, every group in sight, what the chosen one does said under it (the
// waveform's units, weighting, colour, colormap, fill, channels and its level meter; the spectrogram's scale, method, colours, gamma, range,
// FFT size and its spectrum; the notes' piano keys). The View menu has no meters. Turned there, the band and the groups turn at once, the dropdown open; the look again, a press outside or
// Esc closes it; what it shows and its looks are kept
test('editor: a band\'s look in its layer opens how it shows: what it shows, then how that draws', async () => {
  await open()
  const look = page.locator(':is(.lane-look, .layer-look):visible'), dropdown = page.locator('.dropdown'), groups = () => dropdown.locator('.option-label').allInnerTexts()
  const opened = () => page.locator('.dropdown:popover-open').count()
  assert.equal(await look.count(), 1, 'a sound\'s one, its channels\' lanes alike')
  assert.equal(await shown(), 'Waveform')
  assert.match(await look.evaluate(tipOf), /^Waveform\nClick for how it shows$/)
  await look.click()
  assert.equal(await look.getAttribute('aria-expanded'), 'true')
  const [b, d] = await Promise.all([look.boundingBox(), dropdown.boundingBox()])
  assert.ok(Math.abs(d.x + d.width - b.x - b.width) <= 1 && (d.y >= b.y + b.height || d.y + d.height <= b.y), 'by it, its right edge at its look\'s, at the band\'s foot\'s right')
  assert.deepEqual(await groups(), ['Shows', 'Levels in', 'Weighting', 'Colour', 'Colormap', 'Fill', 'Channels'], 'what it shows, then the waveform\'s: its units, its weighting, its colour, its colormap, its fill, its channels, its meter')
  // its meter always there, the level bar by the lanes' end, no choice of it
  const end = () => page.locator('.plot').evaluate(p => parseFloat(getComputedStyle(p).getPropertyValue('--end')))
  assert.ok(await end() > 0, 'the level\'s bar by the lanes\' end')
  assert.deepEqual(await dropdown.getByRole('group', { name: 'Shows', exact: true }).getByRole('button').allInnerTexts(), ['Waveform', 'Spectrogram', 'Notes'])
  assert.deepEqual(await dropdown.getByRole('group', { name: 'Fill', exact: true }).getByRole('button').allInnerTexts(), ['Density', 'Cloud', 'Body', 'RMS', 'Flat'], 'gl-waveform\'s three densities, its RMS band, its peaks')
  // what a choice does in its tooltip, no line under the group; a colour with its preview
  assert.match(await choice('Fill', 'Cloud').getAttribute('title'), /^A soft cloud/)
  assert.equal(await dropdown.locator('.option-note').count(), 0)
  // the colour a select, as Figma's: the one chosen named on it, its list each with its preview
  assert.equal(await dropdown.getByRole('button', { name: 'Colour: One colour' }).count(), 1)
  await dropdown.getByRole('button', { name: 'Colour: One colour' }).click()
  const colours = page.getByRole('listbox', { name: 'Colour', exact: true })
  assert.deepEqual(await colours.getByRole('option').allInnerTexts(), ['One colour', 'RGB', 'Three bands', 'Centroid', 'Dominant'], 'one, then as DJ software and DAWs colour it')
  assert.equal(await colours.locator('.swatch').count(), 5, 'each its preview')
  await colours.getByRole('option', { name: 'Centroid' }).click()
  assert.equal(await colours.isVisible(), false, 'picked, the list closes')
  assert.equal(await opened(), 1, 'the dropdown stays')
  assert.equal(await dropdown.getByRole('button', { name: 'Colour: Centroid' }).count(), 1)
  // its colormap the spectrogram's list, temperature its own first; its weighting none, K or A
  assert.equal(await dropdown.getByRole('button', { name: 'Colormap: Temperature' }).count(), 1)
  assert.deepEqual(await page.getByRole('listbox', { name: 'Colormap', exact: true, includeHidden: true }).getByRole('option', { includeHidden: true }).allTextContents(), ['Grey', 'Magma', 'Inferno', 'Viridis', 'Temperature'])
  assert.deepEqual(await dropdown.getByRole('group', { name: 'Weighting', exact: true }).getByRole('button').allInnerTexts(), ['None', 'K-weighted', 'A-weighted'])
  await choice('Fill', 'RMS').click()
  await choice('Shows', 'Spectrogram').click()
  assert.equal(await shown(), 'Spectrogram')
  assert.equal(await opened(), 1, 'turned, the dropdown stays')
  assert.deepEqual(await groups(), ['Shows', 'Frequency scale', 'Method', 'Colours', 'Gamma', 'Range', 'FFT size'], 'the spectrogram\'s')
  assert.deepEqual(await dropdown.getByRole('group', { name: 'Frequency scale', exact: true }).getByRole('button').allInnerTexts(), ['Hertz', 'Mel', 'ERB', 'Octaves'], 'plainest first')
  assert.deepEqual(await dropdown.getByRole('group', { name: 'Method', exact: true }).getByRole('button').allInnerTexts(), ['Frames', 'Reassigned', 'By band'])
  assert.deepEqual(await page.getByRole('listbox', { name: 'Colours', exact: true, includeHidden: true }).getByRole('option', { includeHidden: true }).allTextContents(), ['Grey', 'Magma', 'Inferno', 'Viridis', 'Temperature'], 'each colormap in a select, its preview, the waveform\'s list')
  // gamma, one quantity: a slider through its steps; moved, the look follows
  const gamma = dropdown.getByRole('slider', { name: 'Gamma' })
  assert.deepEqual(await dropdown.locator('.option-ticks span').allInnerTexts(), ['0.5', '0.75', '1', '1.5'])
  await gamma.fill('0')
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('audio-repl') || '{}').look?.gamma === .5)
  // the notes: what it shows alone, their piano's keys by the lanes' end always
  await choice('Shows', 'Notes').click()
  assert.deepEqual(await groups(), ['Shows'], 'the notes\'')
  await choice('Shows', 'Spectrogram').click()
  await look.click()
  assert.equal(await opened(), 0, 'its look again closes it')
  assert.equal(await look.getAttribute('aria-expanded'), 'false')
  assert.equal(await page.locator('.plot').getAttribute('data-scale'), 'log', 'the scale as it was')
  await page.waitForFunction(() => (s => s.display === 'spec' && s.wave?.fill === 'rms')(JSON.parse(localStorage.getItem('audio-repl') || '{}')))
  await page.reload()
  await wholeLevels().waitFor()
  assert.equal(await shown(), 'Spectrogram', 'kept')
  await look.click()
  await page.mouse.click(10, 10)
  assert.equal(await opened(), 0, 'a press outside closes it')
  await look.click()
  await page.keyboard.press('Escape')
  assert.equal(await opened(), 0, 'Esc closes it')
})

// The view's few, checks in the View menu, kept, no panel of settings: the minimap, the grid, snapping; the rest is the
// app's config (?ui=). How the pictures draw is theirs, in their dropdown
test('editor: the View menu checks the minimap, the grid and snapping, kept', async () => {
  await open()
  assert.equal(await page.getByRole('tab', { name: 'Settings', exact: true }).count(), 0, 'no panel of settings')
  const checked = async name => { await page.locator('.menubar-item', { hasText: /^View$/ }).click(); const on = await menuRow(name).getAttribute('aria-checked'); await page.keyboard.press('Escape'); return on }
  assert.deepEqual([await checked('Minimap'), await checked('Grid'), await checked('Snap')], ['false', 'false', 'true'])
  for (const name of ['Minimap', 'Grid', 'Snap']) await menu('View', name)
  await page.waitForFunction(() => (s => s.scroll === 'overview' && s.grid === 'lines' && s.snap === false)(JSON.parse(localStorage.getItem('audio-repl') || '{}')))
  await page.reload()
  await wholeLevels().waitFor()
  assert.deepEqual([await checked('Minimap'), await checked('Grid'), await checked('Snap')], ['true', 'true', 'false'], 'kept')
})

// How the spectrogram draws its frames (gl-spectrogram's methods): each a picture of its own, kept for the next visit;
// ERB among the scales, each of the four taken in turn
test('editor: the spectrogram\'s method draws a picture of its own, kept; each of its four scales', async () => {
  await open()
  await show('spec')
  const plot = page.locator('.plot'), print = () => pixels(`let s = 0; for (let i = 0; i < d.length; i += 4 * 97) s = (s * 31 + d[i]) % 1000000007; return s`)
  // the picture once drawn whole: two prints in a row the same
  const whole = async () => { await settled(); let was = await print(); for (const end = Date.now() + 5000; Date.now() < end;) { await frames(); const now = await print(); if (now === was) break; was = now } return was }
  const pictures = new Set([await whole()])
  for (const method of ['Frames', 'By band']) {
    await settings('Method', method)
    pictures.add(await whole())
  }
  assert.equal(pictures.size, 3, 'three methods, three pictures')
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('audio-repl')).look.method), 'bands')
  await page.reload()
  await wholeLevels().waitFor()
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('audio-repl')).look.method), 'bands')
  const scales = []
  for (const name of ['Hertz', 'Mel', 'ERB', 'Octaves']) { await settings('Frequency scale', name); scales.push(await plot.getAttribute('data-scale')) }
  assert.deepEqual(scales, ['lin', 'mel', 'erb', 'log'])
})

// How the waveform draws, from its dropdown (and the View menu): coloured by where its spectrum centres as a colour
// temperature, 100 Hz at 1,800 K (a warm orange: more red than blue, on the black-body locus, Krystek 1985), its
// channels in one lane
test('editor: the waveform\'s look, from its dropdown: coloured by its spectrum\'s warmth, its channels in one lane', async () => {
  await open()
  await write(`audio.from(t => 0.8 * Math.sin(2 * Math.PI * 100 * t), { duration: 1, channels: 2 }).pan(-1)`)
  await lengthIs('0:01.000')
  await settled()
  // lit pixels in the upper and lower half of the lanes, TRACK px all told, and how red they are
  const lanes = tall(await page.locator('.plot').boundingBox())
  const lit = () => pixels(`const out = [0, 0], tint = [0, 0]; for (let y = 0; y < arg; y++) for (let x = 0; x < w - 60; x++) { const i = (y * w + x) * 4; if (d[i] + d[i + 1] + d[i + 2] > 300) { const k = y < arg / 2 ? 0 : 1; out[k]++; tint[k] += d[i] - d[i + 2] } } return [...out, (tint[0] + tint[1]) / (out[0] + out[1] || 1)]`, lanes)
  const [upper, lower, grey] = await lit()
  assert.ok(lower < upper / 10 && Math.abs(grey) < 10, `split, grey: ${[upper, lower, grey]}`)
  // the waveform's dropdown
  await settings('Channels', 'One lane')
  await settings('Colour', 'Centroid')
  await poll(lit, ([top, bottom, red]) => assert.ok(bottom > top / 2 && red > 40, `one lane, red: ${[top, bottom, red]}`))
  await page.waitForFunction(() => (w => w?.colour === 'centroid' && w.map === 'temperature')(JSON.parse(localStorage.getItem('audio-repl') || '{}').wave))
})

// Coloured in a colormap, flat, the spectrogram's list: where the spectrum centres, 100 Hz up to 10 kHz in octaves,
// along the colormap's upper half, so 100 Hz takes magma's middle, #b5367a, a pink, and 10 kHz its top, #fcfdbf, a pale
// yellow (matplotlib _cm_listed.py, entries 128 and 255)
test('editor: the waveform coloured in a colormap of the spectrogram\'s list, low at its middle, high at its top', async () => {
  await page.addInitScript(() => { if (!sessionStorage.seeded) { sessionStorage.seeded = 1; localStorage.setItem('audio-repl', JSON.stringify({ wave: { colour: 'centroid', map: 'magma', fill: 'flat' }, docs: [{ code: 'audio.from(t => 0.8 * Math.sin(2 * Math.PI * (t < 1 ? 100 : 10000) * t), { duration: 2 })' }] })) } })
  await open()
  await lengthIs('0:02.000')
  await settled()
  // the lit pixels' mean colour about the zero line, mid its lane (TRACK px), a third of the way in and two thirds
  // (100 Hz's cycles stand apart)
  const lane = tall(await page.locator('.plot').boundingBox())
  const at = x => pixels(`const y = Math.round(arg.lane / 2), s = [0, 0, 0]; let n = 0; for (let dx = -20; dx < 20; dx++) for (let dy = -3; dy <= 3; dy++) { const i = ((y + dy) * w + Math.round(w * arg.x) + dx) * 4; if (d[i] + d[i + 1] + d[i + 2] < 250) continue; s[0] += d[i]; s[1] += d[i + 1]; s[2] += d[i + 2]; n++ } return s.map(v => Math.round(v / n))`, { x, lane })
  const ends = async () => [await at(1 / 3), await at(2 / 3)]
  await poll(ends, ([low, high]) => {
    assert.ok(low[0] - low[1] > 80 && low[2] > low[1], `100 Hz pink, red over green, blue over green: ${low}`)
    assert.ok(high[1] > 200 && Math.abs(high[0] - high[1]) < 30 && high[2] < high[1], `10 kHz pale yellow: ${high}`)
  })
  // its own colormap changed, the spectrogram's as it was: viridis, its middle #21908d, a teal, its top #fde725, a
  // yellow (entries 128 and 255)
  await settings('Colormap', 'Viridis')
  await poll(ends, ([teal, yellow]) => {
    assert.ok(teal[1] - teal[0] > 60 && teal[2] - teal[0] > 60, `100 Hz teal: ${teal}`)
    assert.ok(yellow[0] > 200 && yellow[1] > 180 && yellow[2] < 100, `10 kHz yellow: ${yellow}`)
  })
  assert.deepEqual(await page.evaluate(() => (s => [s.wave.map, s.look?.map ?? 'grey'])(JSON.parse(localStorage.getItem('audio-repl')))), ['viridis', 'grey'])
})

// The colour modes, as DJ software and DAWs colour a waveform, on a 100 Hz sine, then a 10 kHz one, each 0.8, flat
// (tint.js coloured): RGB, the lows red and the highs blue (Serato's, Mixxx's: 600 Hz and 4 kHz its bands); three
// bands, each band a waveform of its own, the 100 Hz one in the colormap's low (magma's middle, #b5367a), the 10 kHz
// one in its top (#fcfdbf); dominant, a tone in full colour, white noise greyed (REAPER's: its tonality its saturation)
test('editor: the waveform coloured by its bands, in layers, or by its strongest frequency greyed as it is noisy', async () => {
  await page.addInitScript(() => { if (!sessionStorage.seeded) { sessionStorage.seeded = 1; localStorage.setItem('audio-repl', JSON.stringify({ wave: { colour: 'bands', map: 'magma', fill: 'flat' }, docs: [{ code: 'audio.from(t => 0.8 * Math.sin(2 * Math.PI * (t < 1 ? 100 : 10000) * t), { duration: 2 })' }] })) } })
  await open()
  await lengthIs('0:02.000')
  await settled()
  const lane = tall(await page.locator('.plot').boundingBox())
  const at = x => pixels(`const y = Math.round(arg.lane / 2), s = [0, 0, 0]; let n = 0; for (let dx = -20; dx < 20; dx++) for (let dy = -3; dy <= 3; dy++) { const i = ((y + dy) * w + Math.round(w * arg.x) + dx) * 4; if (d[i] + d[i + 1] + d[i + 2] < 250) continue; s[0] += d[i]; s[1] += d[i + 1]; s[2] += d[i + 2]; n++ } return s.map(v => Math.round(v / n))`, { x, lane })
  const ends = async () => [await at(1 / 3), await at(2 / 3)]
  await poll(ends, ([red, blue]) => {
    assert.ok(red[0] - red[2] > 60 && red[0] - red[1] > 60, `100 Hz red: ${red}`)
    assert.ok(blue[2] - blue[0] > 60 && blue[2] > blue[1], `10 kHz blue: ${blue}`)
  })
  await settings('Colour', 'Three bands')
  await poll(ends, ([pink, pale]) => {
    assert.ok(pink[0] - pink[1] > 80 && pink[2] > pink[1], `100 Hz in the lows' layer, pink: ${pink}`)
    assert.ok(pale[1] > 200 && Math.abs(pale[0] - pale[1]) < 30 && pale[2] < pale[1], `10 kHz in the highs' layer, pale yellow: ${pale}`)
  })
  // a tone, then noise: the strongest frequency in colour, the noise grey
  await write('audio.from(t => t < 1 ? 0.8 * Math.sin(2 * Math.PI * 300 * t) : 0.5 * (Math.random() * 2 - 1), { duration: 2 })')
  await settings('Colour', 'Dominant')
  await settled()
  const chroma = ([r, g, b]) => Math.max(r, g, b) - Math.min(r, g, b)
  await poll(ends, ([tone, noise]) => assert.ok(chroma(tone) > 80 && chroma(noise) < chroma(tone) / 3, `the tone in colour, the noise grey: ${tone}, ${noise}`))
})

// A track's waveform coloured as a sound's is, by its colour mode, not a hue of its own: two tracks, a 100 Hz tone over
// a 10 kHz one, RGB, each lane's middle red and blue (it was each track's own colour, the mode left out for tracks)
test('editor: tracks\' waveforms coloured by the colour mode, as a sound\'s', async () => {
  await page.addInitScript(() => { if (!sessionStorage.seeded) { sessionStorage.seeded = 1; localStorage.setItem('audio-repl', JSON.stringify({ wave: { colour: 'bands', map: 'magma', fill: 'flat' }, docs: [{ code: 'let low = audio.from(t => 0.8 * Math.sin(2 * Math.PI * 100 * t), { duration: 2 })\n\nlet high = audio.from(t => 0.8 * Math.sin(2 * Math.PI * 10000 * t), { duration: 2 })' }] })) } })
  await open()
  await lengthIs('0:02.000')
  await page.locator('.layer').nth(1).waitFor({ state: 'attached' })
  await settled()
  const box = await page.locator('.plot').boundingBox(), lanes = await tracksAt()
  const at = r => pixels(`const y = Math.round(arg.y), s = [0, 0, 0]; let n = 0; for (let dx = -20; dx < 20; dx++) for (let dy = -3; dy <= 3; dy++) { const i = ((y + dy) * w + Math.round(w / 2) + dx) * 4; if (d[i] + d[i + 1] + d[i + 2] < 250) continue; s[0] += d[i]; s[1] += d[i + 1]; s[2] += d[i + 2]; n++ } return s.map(v => Math.round(v / n))`, { y: r.y + r.h / 2 - box.y })
  await poll(async () => [await at(lanes[0]), await at(lanes[1])], ([red, blue]) => {
    assert.ok(red[0] - red[2] > 60 && red[0] - red[1] > 60, `the 100 Hz track red: ${red}`)
    assert.ok(blue[2] - blue[0] > 60 && blue[2] > blue[1], `the 10 kHz track blue: ${blue}`)
  })
})

test('theme: a VS Code theme read into the skin, each part the colour of the part of VS Code it stands for', async () => {
  const rgb = hex => `rgb(${[1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)).join(' ')}${hex.length > 7 ? ` / ${Math.round(parseInt(hex.slice(7), 16) / 255 * 1e3) / 1e3}` : ''})`
  for (const [name, want] of [
    ['Dark+', { screen: '#1E1E1E', 'screen-ink': '#D4D4D4', 'screen-accent': '#007FD4', 'screen-mark': '#569cd6', 'screen-line-number': '#858585', 'syntax-number': '#b5cea8', bezel: '#444444', 'screen-well': '#3C3C3C', 'screen-select': '#264F78', 'screen-select-inactive': '#3A3D41',
      menu: '#252526', 'menu-select': '#0078d4', 'menu-select-ink': '#FFFFFF', tab: '#1E1E1E', 'tab-ink': '#FFFFFF', 'tab-off-ink': '#A6A6A6', tabs: '#252526', side: '#252526', 'screen-range': '#ffffff0b', paper: '#3C3C3C' }],
    ['Light+', { screen: '#FFFFFF', 'screen-ink': '#000000', 'screen-accent': '#0090F1', 'screen-mark': '#800000', 'screen-line-number': '#237893', 'syntax-number': '#098658', bezel: '#E7E7E7', 'screen-well': '#FFFFFF', 'screen-select': '#ADD6FF', 'screen-select-inactive': '#E5EBF1',
      menu: '#FFFFFF', 'menu-select': '#0060C0', 'tab-ink': '#333333', 'tab-off-ink': '#616161', tabs: '#F3F3F3', side: '#F3F3F3', 'screen-hover': '#E8E8E8', 'screen-range': '#fdff0033', paper: '#DDDDDD' }],
    ['Monokai', { screen: '#272822', 'screen-ink': '#f8f8f2', 'screen-accent': '#99947c', 'screen-mark': '#A6E22E', 'syntax-number': '#AE81FF', bezel: '#34352f', 'screen-well': '#414339', 'screen-select': '#878b9180', 'screen-select-inactive': '#878b9140',
      menu: '#1e1f1c', 'menu-select': '#75715E', tabs: '#1e1f1c', side: '#1e1f1c', paper: '#1e1f1c' }]
  ]) {
    const s = await themed(name)
    for (const [k, hex] of Object.entries(want)) assert.equal(s[`--color-${k}`], rgb(hex), `${name}: ${k}`)
    assert.equal(s['--color-screen-wave'], s['--color-screen-ink'], `${name}: the waveform the text's colour`)
    assert.equal(s['--color-screen-channel-1'], s['--color-screen-ink'], `${name}: the first channel the text's colour`)
  }
  // every theme VS Code ships reads whole: a colour for every part, each one a canvas takes; a word's font style one CSS
  // takes
  const { THEMES, MAP } = await import('../../repl/theme.js')
  for (const t of THEMES) {
    const s = await themed(t.name)
    for (const k of Object.keys(MAP)) assert.ok(k in s, `${t.name}: ${k}`)
    for (const [k, v] of Object.entries(s)) assert.match(v, /^--(italic|bold|line)-/.test(k) ? /^(italic|bold|normal|none|underline|line-through|underline line-through)$/ : /^(rgb\(\d+ \d+ \d+( \/ [\d.]+)?\)|transparent)$/, `${t.name}: ${k}`)
  }
})

// The skin's own default is a theme (themes/screen.json): skin.css's colours are what the theme reads as, token for
// token, so the first paint and the theme worn are one. Every part mapped (theme.js MAP) a colour skin.css declares;
// the script's words those the screen gives them, no more, while no theme is worn (wear: a theme's words their own)
test('theme: the screen a theme, skin.css its colours', async () => {
  const { MAP, load, skin } = await import('../../repl/theme.js')
  const screen = skin(await load(new URL('../../repl/themes/screen.json', import.meta.url).href, { get: u => readFile(new URL(u), 'utf8') }))
  const css = await readFile(new URL('../../repl/skin.css', import.meta.url), 'utf8')
  const block = start => Object.fromEntries([...css.slice(css.indexOf(start), css.indexOf('\n}', css.indexOf(start))).matchAll(/(--[\w-]+):\s*([^;]+);/g)].map(m => [m[1], m[2].trim()]))
  const declared = block(':root {')
  for (const k of Object.keys(MAP)) assert.equal(declared[k], screen[k], k)
  const words = Object.fromEntries(Object.entries(screen).filter(([k]) => /-(syntax|semantic)-/.test(k)))
  assert.deepEqual(block(':root:not([data-worn]) {'), words)
  // a theme of greys gives no channel hues: the screen's channels the even round
  assert.equal(screen['--color-screen-channel-2'], undefined)
})

// The registry the skin reads a theme by is VS Code's own: each colour's default as VS Code 1.143 registers it
// (themes/vscode-colors.json, read out of its workbench), and every colour a part or a default names is in it
test('theme: VS Code\'s colours and their defaults, as VS Code registers them', async () => {
  const { MAP, REGISTRY } = await import('../../repl/theme.js')
  const all = JSON.parse(await readFile(new URL('../../repl/themes/vscode-colors.json', import.meta.url), 'utf8'))
  for (const [id, v] of Object.entries(REGISTRY)) if (!id.startsWith('audio.')) assert.deepEqual(v, all[id], id)
  const ids = v => typeof v === 'string' ? (v[0] === '#' ? [] : [v]) : Array.isArray(v) ? v.slice(1).flatMap(ids) : v && typeof v === 'object' ? Object.values(v).flatMap(ids) : []
  for (const v of [...Object.values(MAP).filter(v => v[0] !== 'scope'), ...Object.values(REGISTRY)]) for (const id of ids(v)) assert.ok(id in REGISTRY, id)
})

// The colours made of others as VS Code makes them, against VS Code's own Color (src/vs/base/common/color.ts) and its
// registry's defaults, read out of the workbench VS Code ships, where it is installed: for random themes, every colour
// the skin reads, the same to the bit
test('theme: colours made of others as VS Code\'s own Color makes them', async t => {
  const app = '/Applications/Visual Studio Code.app/Contents/Resources/app/out/vs/workbench/workbench.desktop.main.js'
  let src
  try { src = await readFile(app, 'utf8') } catch { return t.skip('VS Code is not installed here') }
  const a = src.indexOf('function Ace('), b = src.indexOf('static{this.white=new s(new bi(255,255,255,1))}'), e = src.indexOf('}', src.indexOf('static{this.cyan', b))
  if (a < 0 || b < 0 || e < 0) return t.skip('this VS Code\'s Color is not where 1.143\'s was')
  const { Je: Color, bi: RGBA } = new Function(`${src.slice(a, e + 1)}}; return { Je, bi }`)()
  const { REGISTRY, resolver } = await import('../../repl/theme.js')
  const parse = h => { h = h.slice(1); const n = i => parseInt(h.slice(i, i + 2), 16); return new Color(new RGBA(n(0), n(2), n(4), h.length > 6 ? n(6) / 255 : 1)) }
  const vscode = (kind, colors) => {
    const memo = {}, color = id => id in memo ? memo[id] : (memo[id] = colors[id] ? parse(colors[id]) : value(REGISTRY[id]))
    const value = v => {
      if (v == null) return undefined
      if (typeof v === 'string') return v[0] === '#' ? parse(v) : color(v)
      if (!Array.isArray(v)) return value(v[kind])
      const [op, x, y, f, k] = v
      if (op === 'transparent') return value(x)?.transparent(y)
      if (op === 'lighten') return value(x)?.lighten(y)
      if (op === 'darken') return value(x)?.darken(y)
      if (op === 'oneOf') { for (const w of v.slice(1)) { const c = value(w); if (c) return c } return }
      const c = value(x), bg = value(y)
      if (op === 'lessProminent') return c && (bg ? c.isDarkerThan(bg) ? Color.getLighterColor(c, bg, f).transparent(k) : Color.getDarkerColor(c, bg, f).transparent(k) : c.transparent(f * k))
      throw new Error(op)
    }
    return color
  }
  let seed = 7
  const random = () => (seed = seed * 16807 % 2147483647) / 2147483647, hex = () => '#' + Array.from({ length: 4 }, () => Math.floor(random() * 256).toString(16).padStart(2, '0')).join('')
  for (let n = 0; n < 100; n++) for (const kind of ['dark', 'light', 'hcDark', 'hcLight']) {
    const colors = Object.fromEntries(Object.keys(REGISTRY).filter(() => random() < .3).map(id => [id, hex()]))
    const mine = resolver({ kind, colors }), theirs = vscode(kind, colors)
    for (const id of Object.keys(REGISTRY)) {
      const p = mine(id), q = theirs(id)?.rgba
      assert.deepEqual(p && [p.r, p.g, p.b, p.a], q && [q.r, q.g, q.b, q.a], `${kind} ${id} ${JSON.stringify(colors)}`)
    }
  }
})

// VS Code's own, where it is installed: its TextMate engine and the regular expressions it runs on (vscode-textmate,
// vscode-oniguruma, in node_modules.asar: a header of JSON naming each file's place, the files after it; the wasm
// unpacked beside it), its JavaScript grammar, the TypeScript its language features run and its workbench; null where
// it is not
const APP = '/Applications/Visual Studio Code.app/Contents/Resources/app'
let installed
const vscode = () => installed ??= (async () => {
  let asar
  try { asar = await openFile(`${APP}/node_modules.asar`) } catch { return null }
  const read = async (at, n) => { const b = Buffer.alloc(n); await asar.read(b, 0, n, at); return b }
  const head = await read(0, 16), header = JSON.parse(await read(16, head.readUInt32LE(12))), base = 8 + head.readUInt32LE(4)
  const file = async path => { const f = path.split('/').reduce((n, k) => n.files[k], header); return String(await read(base + +f.offset, f.size)) }
  const cjs = src => { const module = { exports: {} }; new Function('module', 'exports', src)(module, module.exports); return module.exports }
  const tm = cjs(await file('vscode-textmate/release/main.js')), onig = cjs(await file('vscode-oniguruma/release/main.js'))
  await asar.close()
  await onig.loadWASM((await readFile(`${APP}/node_modules.asar.unpacked/vscode-oniguruma/release/onig.wasm`)).buffer)
  const grammar = JSON.parse(await readFile(`${APP}/extensions/javascript/syntaxes/JavaScript.tmLanguage.json`, 'utf8'))
  const registry = new tm.Registry({ onigLib: Promise.resolve({ createOnigScanner: p => new onig.OnigScanner(p), createOnigString: s => new onig.OnigString(s) }), loadGrammar: async s => s === 'source.js' ? grammar : null })
  const ts = createRequire(import.meta.url)(`${APP}/extensions/node_modules/typescript/lib/typescript.js`)
  return { tm, registry, js: await registry.loadGrammar('source.js'), ts, workbench: () => readFile(`${APP}/out/vs/workbench/workbench.desktop.main.js`, 'utf8') }
})()
const themesOf = async () => {
  const { THEMES, load } = await import('../../repl/theme.js')
  return Promise.all([...THEMES, { name: 'The screen', file: 'screen.json', kind: 'dark' }].map(async t => ({ ...t, theme: await load(new URL(`../../repl/themes/${t.file}`, import.meta.url).href, { kind: t.kind, get: u => readFile(new URL(u), 'utf8') }) })))
}

// A word's colour and font style as VS Code's own TextMate engine gives them (vscode-textmate Theme.match, each scope's
// over its parent's), for every word of the script and every kind the channels take, in every theme VS Code ships and
// the screen's: of each scope the most specific rule, by its parts, then its ancestors, which must be the scope's in
// order; what a scope's rule leaves unset, its parent's
test('theme: each word\'s colour and font style as VS Code\'s TextMate engine gives them, in every theme it ships', async t => {
  const code = await vscode()
  if (!code) return t.skip('VS Code is not installed here')
  const { SYNTAX, styler, hex } = await import('../../repl/theme.js'), { WORDS } = await import('../../repl/syntax.js')
  const stacks = [...Object.values(SYNTAX), ...Object.entries(WORDS).map(([w, s]) => w === 'source' ? [s] : ['source.js', ...s.replace(' / ', ' ').split(' ').filter(Boolean)])]
  for (const { name, theme } of await themesOf()) {
    code.registry.setTheme({ settings: theme.tokenColors.filter(r => r?.scope && r.settings) })
    const engine = code.registry._syncRegistry._theme, map = code.registry.getColorMap(), mine = styler(theme.tokenColors)
    for (const stack of stacks) {
      let path = null, fg = 0, font = -1
      for (const scopeName of stack) { path = { scopeName, parent: path }; const m = engine.match(path); if (m?.foregroundId) fg = m.foregroundId; if (m && m.fontStyle !== -1) font = m.fontStyle }
      const own = mine(stack)
      assert.deepEqual([own.fg, own.font], [fg ? hex(map[fg]) : null, font], `${name}: ${stack.join(' ')}`)
    }
  }
})

// The defaults VS Code draws a semantic token with where a theme sets none, as it registers them: the scopes it probes
// for each type and modifier (tokenClassificationRegistry.ts, read out of the workbench), then the JavaScript
// extension's (extensions/javascript/package.json); and the globals TypeScript's library declares, each the token
// TypeScript makes of it
test('theme: semantic tokens\' defaults as VS Code registers them, the library\'s globals as TypeScript reads them', async t => {
  const code = await vscode()
  if (!code) return t.skip('VS Code is not installed here')
  const { PROBES } = await import('../../repl/theme.js'), { LIBRARY } = await import('../../repl/syntax.js')
  const src = await code.workbench(), a = src.indexOf('o("comment",d('), b = src.indexOf('}function', src.indexOf('e("member.defaultLibrary"'))
  if (a < 0 || b < 0) return t.skip('this VS Code\'s registry is not where 1.143\'s was')
  const theirs = [...src.slice(a, b).matchAll(/(?:\bo\("(\w+)",d\(\d+,null\)|\be\("([\w.]+)"),(\[(?:\[[^\]]*\],?)*\])/g)].map(m => [m[1] ?? m[2], JSON.parse(m[3]).map(p => p.join(' ')).join(' ')])
  const js = JSON.parse(await readFile(`${APP}/extensions/javascript/package.json`, 'utf8')).contributes.semanticTokenScopes.find(s => s.language === 'javascript').scopes
  assert.deepEqual(PROBES, [...theirs, ...Object.entries(js).map(([k, v]) => [`${k}:javascript`, v.join(' ')])])
  const names = Object.keys(LIBRARY), text = names.join(';\n'), tokens = semanticTokens(code.ts, text)
  assert.deepEqual(tokens.map(([from, to, m]) => [text.slice(from, to), m]), names.map(n => [n, `${LIBRARY[n][0]}.defaultLibrary`]))
})

// TypeScript's semantic tokens of a script, as VS Code's TypeScript features ask for them of a JavaScript file in a
// project of its own (extensions/typescript-language-features: encodedSemanticClassifications-full, format 2020, its
// legend; the inferred project's options): [from, to, 'type.modifier…'], `local` left out, as MEANINGS leaves it. Its
// library read once for them all (a document registry), each script a file of its own
let documents, scripts = 0
function semanticTokens(ts, text) {
  const file = `/script-${++scripts}.js`, lib = ts.getDefaultLibFilePath({ target: ts.ScriptTarget.ES2024 })
  const options = { target: ts.ScriptTarget.ES2024, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler, jsx: ts.JsxEmit.ReactJSX, allowJs: true, checkJs: false, strictNullChecks: true, strictFunctionTypes: true, allowNonTsExtensions: true }
  const service = ts.createLanguageService({
    getScriptFileNames: () => [file], getScriptVersion: () => '1', getCurrentDirectory: () => '/', getCompilationSettings: () => options, getDefaultLibFileName: () => lib,
    getScriptSnapshot: f => f === file ? ts.ScriptSnapshot.fromString(text) : ts.sys.fileExists(f) ? ts.ScriptSnapshot.fromString(ts.sys.readFile(f)) : undefined,
    fileExists: f => f === file || ts.sys.fileExists(f), readFile: f => f === file ? text : ts.sys.readFile(f)
  }, documents ??= ts.createDocumentRegistry())
  const spans = service.getEncodedSemanticClassifications(file, { start: 0, length: text.length }, '2020').spans, out = []
  const TYPES = ['class', 'enum', 'interface', 'namespace', 'typeParameter', 'type', 'parameter', 'variable', 'enumMember', 'property', 'function', 'method']
  for (let i = 0; i < spans.length; i += 3) {
    const c = spans[i + 2]
    if (c > 255) out.push([spans[i], spans[i] + spans[i + 1], [TYPES[(c >> 8) - 1], ...['declaration', 'readonly', 'defaultLibrary'].filter(m => c & 1 << { declaration: 0, readonly: 3, defaultLibrary: 4 }[m])].join('.')])
  }
  return out
}

// The scripts a page has: the recipes as the page opens them, and the parts of a script the page writes and one writes
// (a marker, an edit's range, a curve, tracks; a function, constants, a template's expressions, a regular expression,
// comments, a doc comment)
const SCRIPTS = async () => [
  ...(await import('../../repl/recipes.js')).default.map(r => r.code.replaceAll('$src', `audio('chime.wav')`)),
  `let voice = audio('handpan.wav')\n  .write(audio('birdsong.wav'), { at: 4 })\n  // .write(audio('monitor.wav'), { at: 4 })\n  .mark(0.8, 'Verse')\n  .mark({ at: 1.4, duration: 1.6 }, 'Chorus')\nlet keys = audio('rhodes.wav').gain(-6)\nlet bell = audio('chime.wav')`,
  `audio('chime.wav').gain(-3, { at: 1.2, duration: 0.5 }).gain({ t: [0, 0.5, 1], v: [0, -6, -6, 0] }).crop({ at: 0, d: 30 }).fade(0.05, 0.4).mark({ at: 0, d: 1.5 }, 'intro')`,
  [
    '/** A kick: a sine falling in pitch. @param {number} t seconds */',
    'const kick = t => {',
    '  let s = t % 0.25',
    '  return Math.sin(2 * Math.PI * (120 * s + 18 * (1 - Math.exp(-40 * s)))) * Math.exp(-12 * s)',
    '}',
    'const LOUD = -1, beat = audio.from(kick, { d: 2 }), k = new Float32Array(4)',
    "let [lufs, peak] = await beat.stat(['loudness', 'db'])",
    "console.log(`${lufs.toFixed(1)} LUFS, peak ${peak} dB, ${'o'}${{ k }}`)",
    "if (typeof peak === 'number' && peak > LOUD) beat.normalize(LOUD)",
    'else if (peak == null || !Number.isFinite(peak)) beat.gain(-Infinity)',
    'for (const name of [\'a.wav\', "b.wav"]) audio(name).trim().save(name.replace(/\\.\\w+$/, \'-clean.wav\'))',
    'function shape(x, n = 2) { return x < 0 ? -shape(-x, n) : 1 - (1 - x) ** n }',
    '/* noise under it, shaped */ beat.mix(audio.from(t => shape(Math.random() * 2 - 1) * 0.1, { duration: beat.duration }), { at: 0.5 })',
    'let o = { fn: shape, n: null, on: true, off: false, f(x) { return x }, g: () => this }',
    'k[0] += 1 << 2'
  ].join('\n')
]

// What VS Code draws of a script in a theme, each character's colour (opaque over the screen, as the skin writes one)
// and font style: the grammar's tokens, styled by its engine with the theme's rules after VS Code's own first (the
// editor's colours: colorThemeData.ts tokenColors), then TypeScript's semantic tokens over them, styled as VS Code
// styles one (theme.js semantics: its rules, the scopes it probes, as VS Code's sources have them; the probes checked
// against VS Code's own above)
const css = c => `rgb(${c.r} ${c.g} ${c.b}${c.a < 1 ? ` / ${c.a}` : ''})`
function theirs(code, { kind, theme }, text, tokens = semanticTokens(code.ts, text)) {
  const value = resolver({ kind, colors: theme.colors }), screen = ['opaque', 'editor.background', '#000000'], seen = new Map()
  const colour = c => seen.get(c) ?? seen.set(c, css(value(['opaque', c, screen]))).get(c)
  const fg = value('editor.foreground'), two = v => Math.round(v).toString(16).padStart(2, '0')
  code.registry.setTheme({ settings: [{ settings: { foreground: '#' + [fg.r, fg.g, fg.b].map(two).join('') + (fg.a < 1 ? two(fg.a * 255) : ''), background: '#000000' } }, ...theme.tokenColors.filter(r => r?.scope && r.settings)] })
  const map = code.registry.getColorMap(), out = []
  let rule = code.tm.INITIAL
  for (const line of text.split('\n')) {
    const { tokens, ruleStack } = code.js.tokenizeLine2(line, rule)
    for (let i = 0; i < tokens.length; i += 2) {
      const meta = tokens[i + 1], font = meta >>> 11 & 15, end = i + 2 < tokens.length ? tokens[i + 2] : line.length
      for (let k = tokens[i]; k < end; k++) out.push({ fg: colour(map[meta >>> 15 & 511]), italic: !!(font & 1), bold: !!(font & 2), underline: !!(font & 4), strike: !!(font & 8) })
    }
    out.push(null)
    rule = ruleStack
  }
  const style = semantics(theme), hex = c => '#' + c.map((v, i) => i < 3 || v < 1 ? two(v * 255) : '').join('')
  for (const [from, to, m] of tokens) {
    const s = style(m)
    for (let k = from; k < to; k++) Object.assign(out[k], s.fg && { fg: colour(hex(s.fg)) }, ...['italic', 'bold', 'underline'].map(p => s[p] !== undefined && { [p]: s[p] }), s.strikethrough !== undefined && { strike: s.strikethrough })
  }
  return out
}
// What the page draws (script.js): each character's words laid over one another, outermost first, each its own colour
// and font style where the skin sets them, the innermost's semantic token over them; the script's own under them all
function ours(vars, list, text) {
  const out = Array.from(text, () => ({ fg: vars['--color-syntax-source'] ?? vars['--color-screen-ink'], italic: false, bold: false, underline: false, strike: false }))
  const lay = (x, v) => {
    if (v('color')) x.fg = v('color')
    if (v('italic')) x.italic = v('italic') === 'italic'
    if (v('bold')) x.bold = v('bold') === 'bold'
    if (v('line')) { x.underline = v('line').includes('underline'); x.strike = v('line').includes('line-through') }
  }
  for (const [from, to, w] of list) for (let k = from; k < to; k++) lay(out[k], p => vars[`--${p}-syntax-${w}`])
  for (const [from, to, , m] of list) if (m) for (let k = from; k < to; k++) lay(out[k], p => vars[`--${p}-semantic-${m.replaceAll('.', '-')}`])
  return out
}

// Every character of the page's scripts as VS Code draws it, in every theme it ships and the screen's: the grammar's
// colours and font styles, which a theme gives by scopes, compared to the scopes syntax.js gives the parser's tree, and
// TypeScript's semantic tokens to those it finds by the script's names (what TypeScript infers of a type it does not:
// a member of a string, an array, an object a name holds; a doc comment's {@link}; see syntax.js). Spaces aside
test('script: every character of the page\'s scripts as VS Code draws it, in every theme it ships', async t => {
  const code = await vscode()
  if (!code) return t.skip('VS Code is not installed here')
  const { skin } = await import('../../repl/theme.js'), { default: words } = await import('../../repl/syntax.js'), { parser } = await import('@lezer/javascript')
  const scripts = (await SCRIPTS()).map(text => ({ text, list: words(parser.parse(text), text), tokens: semanticTokens(code.ts, text) })), report = []
  for (const th of await themesOf()) {
    const vars = skin(th.theme), wrong = []
    let all = 0
    for (const { text, list, tokens } of scripts) {
      const a = theirs(code, th, text, tokens), b = ours(vars, list, text)
      for (let k = 0; k < text.length; k++) if (!/\s/.test(text[k])) { all++; if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) wrong.push(`${JSON.stringify(text.slice(Math.max(0, k - 16), k))} [${text[k]}]: ${JSON.stringify(a[k])}, ours ${JSON.stringify(b[k])}`) }
    }
    report.push(`${th.name}: ${all - wrong.length} of ${all}`)
    assert.deepEqual(wrong.slice(0, 5), [], `${th.name}: ${wrong.length} characters drawn otherwise`)
  }
  t.diagnostic(report.join('; '))
})

// The page draws each character of the script as its words and the skin say (ours above): a word's colour and font
// style its own, else the part's round it, a semantic token's over them, a part round a word of its own range
// (`${r}`, `${'x'}`); in the screen's own skin, then in themes worn from the View menu, one with a font style its
// comments do not take (Dark+), one with parameters italic and types underlined (Monokai), the screen's back after
test('editor: each character of the script drawn as its words and the skin say, a theme worn or none', async () => {
  const { skin, load, THEMES } = await import('../../repl/theme.js'), { default: words } = await import('../../repl/syntax.js'), { parser } = await import('@lezer/javascript')
  const text = (await SCRIPTS()).at(-1), list = words(parser.parse(text), text)
  await open()
  await tab('Code')
  await page.locator('.cm-content').click()
  await page.keyboard.press('ControlOrMeta+A')
  await page.keyboard.insertText(text)
  // each character as drawn: its colour, its font style, the lines of the words it is in (a decoration is drawn by the
  // element that sets it, over all inside it; an error's own aside)
  const drawn = () => page.evaluate(() => {
    const out = [], lines = el => { const on = new Set(); for (let e = el; !e.classList.contains('cm-content'); e = e.parentElement) if (/\bsyntax-/.test(e.className)) for (const l of getComputedStyle(e).textDecorationLine.split(' ')) if (l !== 'none') on.add(l); return on }
    const walk = n => {
      if (n.nodeType !== 3) return n.childNodes.forEach(walk)
      const s = getComputedStyle(n.parentElement), d = lines(n.parentElement)
      for (const _ of n.textContent) out.push({ fg: s.color.replace(/,/g, ''), italic: s.fontStyle === 'italic', bold: +s.fontWeight >= 600, underline: d.has('underline'), strike: d.has('line-through') })
    }
    document.querySelectorAll('.cm-content .cm-line').forEach((l, i) => { if (i) out.push(null); walk(l) })
    return out
  })
  const theme = async name => { const t = THEMES.find(t => t.name === name) ?? { file: 'screen.json', kind: 'dark' }; return skin(await load(new URL(`../../repl/themes/${t.file}`, import.meta.url).href, { kind: t.kind, get: u => readFile(new URL(u), 'utf8') })) }
  for (const name of ['The screen', 'Dark+', 'Monokai', 'The screen']) {
    if (name !== 'The screen' || await page.evaluate(() => document.documentElement.hasAttribute('data-worn'))) await menu('View', 'Theme', name)
    const want = ours(await theme(name), list, text)
    await poll(drawn, got => { for (let k = 0; k < text.length; k++) if (!/\s/.test(text[k])) assert.deepEqual(got[k], want[k], `${name}: ${JSON.stringify(text.slice(Math.max(0, k - 16), k))} [${text[k]}]`) })
  }
})

// The spectrogram's grey (tint.js inked): in white ink, the grey screened over the page as it was drawn before themes,
// white at the opacity of the grey's encoded sRGB value at OKLab lightness u^γ (IEC 61966-2-1; Y = L³, Ottosson 2020);
// in black ink on a light screen, transparent at the floor and opaque at the top, lightness falling evenly
test('theme: the spectrogram\'s grey in white ink is the grey screened over the page; in black, its multiply', async () => {
  const { inked, lightness } = await import('../../repl/tint.js')
  const screened = L => { const y = L ** 3; return y <= .0031308 ? 12.92 * y : 1.055 * y ** (1 / 2.4) - .055 }
  for (const gamma of [.5, .75, 1, 1.5]) assert.deepEqual(inked([1, 1, 1, 1], 17, gamma), Array.from({ length: 17 }, (_, k) => `rgb(255 255 255 / ${screened((k / 16) ** gamma).toFixed(4)})`))
  const black = inked([0, 0, 0, 1], 5).map(s => +s.split('/ ')[1].slice(0, -1))
  assert.deepEqual([black[0], black[4]], [0, 1])
  // to the four places the opacity is written to
  black.forEach((a, k) => assert.ok(Math.abs(lightness([1 - a, 1 - a, 1 - a]) - (1 - k / 4)) < 1e-3, `step ${k}`))
})

// What a stretch holds in frequency (tint.js measure), on signals whose answer is known, its places in octaves from 100
// Hz to 10 kHz: a sine centres and peaks at its own frequency, its strongest found between bins to a hundredth of an
// octave (a parabola through the peak's three bins in dB), a tone through and through, all of it in its band (Mixxx's,
// split at 600 Hz and 4 kHz); white noise, flat by definition, far from a tone, each band's power as wide as the band
// (600 Hz, 3.4 kHz and the rest of 24 kHz), its amplitude's share the root of that. Its colours: RGB of the lows the
// red, at the waveform's lightness, to the just noticeable difference CSS Color 4's gamut mapping allows (ΔEOK .02); a
// colour greyed all the way, no chroma; three bands each their share of the height, in the colormap's low, middle and
// top; the centroid's one, its place's
test('theme: a stretch\'s frequencies measured, and coloured as DJ software and DAWs colour them', async () => {
  const { default: measure, coloured, rgb, greyed, lightness } = await import('../../repl/tint.js')
  const rate = 48000, n = 4096, place = f => Math.log2(f / 100) / Math.log2(100), octaves = Math.log2(100)
  const sine = f => Float32Array.from({ length: n }, (_, i) => .8 * Math.sin(2 * Math.PI * f * i / rate))
  for (const [f, band] of [[100, 0], [300, 0], [1000, 1], [3000, 1], [7000, 2]]) {
    const m = measure(sine(f), 0, n, rate)
    assert.ok(Math.abs(m.centroid - place(f)) * octaves < .01 && Math.abs(m.dominant - place(f)) * octaves < .01, `${f} Hz at ${place(f).toFixed(3)}: ${m.centroid.toFixed(3)}, ${m.dominant.toFixed(3)}`)
    assert.ok(m.tonal > .99 && m.bands[band] > .99, `${f} Hz a tone, in band ${band}: ${m.tonal}, ${m.bands}`)
  }
  let seed = 1
  const random = () => (seed = seed * 16807 % 2147483647) / 2147483647, noise = Float32Array.from({ length: n }, () => random() * 2 - 1)
  const m = measure(noise, 0, n, rate), wide = [600, 3400, 20000].map(w => Math.sqrt(w / 24000))
  assert.ok(m.tonal < .1, `noise no tone: ${m.tonal}`)
  m.bands.forEach((s, j) => assert.ok(Math.abs(s - wide[j]) < .06, `band ${j}: ${s.toFixed(3)} for ${wide[j].toFixed(3)}`))
  assert.equal(measure(new Float32Array(n), 0, n, rate), null, 'silence, none')
  const red = rgb([1, 0, 0], .7)
  assert.ok(Math.abs(lightness(red) - .7) <= .02 && red[0] > red[1] + .3 && red[0] > red[2] + .3, `the lows red at L .7: ${red}`)
  const grey = greyed([.9, .3, .2, 1], 0)
  assert.ok(Math.max(...grey.slice(0, 3)) - Math.min(...grey.slice(0, 3)) < .01 && Math.abs(lightness(grey) - lightness([.9, .3, .2])) < .01, `greyed, its lightness kept: ${grey}`)
  const tone = u => [u, u, u, 1], tones = coloured('layers', m, tone)
  assert.deepEqual(tones, m.bands.map((s, j) => [tone(j / 2), s]))
  assert.deepEqual(coloured('centroid', m, tone), [[tone(m.centroid), 1]])
})

// The least a theme can be, and the odd forms VS Code reads: `{}`, VS Code's defaults for a dark theme (the background
// #1E1E1E, the foreground #BBBBBB: src/vs/platform/theme/common/colors/editorColors.ts), every word the foreground as
// VS Code draws a word no rule colours; a light background alone, a light theme; tokenColors as a .tmTheme path, no
// rules; JSONC, its comments and trailing commas gone, a "//" in a string kept; selectors in one comma list, the
// deepest matching winning, the later of two alike, one whose ancestor is another language's never
test('theme: the least a theme can be, and the odd forms VS Code reads', async () => {
  const { parse, load, skin, scoper, hex } = await import('../../repl/theme.js')
  const empty = skin({})
  assert.deepEqual([empty['--color-screen'], empty['--color-screen-ink'], empty['--color-screen-mark']], ['rgb(30 30 30)', 'rgb(187 187 187)', 'rgb(187 187 187)'])
  // the softer words a fifth of the way from the text to the ground in OKLab: #BBBBBB to #1E1E1E, L .797 to .235
  assert.equal(empty['--color-screen-soft'], 'rgb(154 154 154)')
  assert.equal(empty['--color-screen-channel-1'], 'rgb(187 187 187)')
  assert.equal(empty['--color-screen-channel-2'], undefined, 'one hue only: the rest the even round')
  // no inactive selection given: the selection at half, as VS Code's default is; at .7 in high contrast dark
  // (editor.inactiveSelectionBackground: transparent(editor.selectionBackground, .5), .7 for hcDark): #264F78, #f3f518
  assert.equal(empty['--color-screen-select-inactive'], 'rgb(38 79 120 / 0.5)')
  assert.equal(skin({ kind: 'hcDark' })['--color-screen-select-inactive'], 'rgb(243 245 24 / 0.7)')
  assert.equal(skin({ colors: { 'editor.background': '#fafafa' } })['--color-screen-line-number'], 'rgb(35 120 147)', 'light, by its background: the light line numbers, #237893')
  assert.deepEqual((await load(null, { theme: { tokenColors: './x.tmTheme' } })).tokenColors, [])
  assert.deepEqual(parse('{ /* a */ "url": "http://a//b", // c\n "list": [1, 2,], }'), { url: 'http://a//b', list: [1, 2] })
  assert.throws(() => parse('not a theme'))
  const rule = scoper([
    { scope: 'keyword, string', settings: { foreground: '#111111' } },
    { scope: 'keyword.control', settings: { foreground: '#222222' } },
    { scope: 'keyword.control', settings: { foreground: '#333333' } },
    { scope: 'source.python keyword.control.flow', settings: { foreground: '#444444' } }
  ])
  assert.deepEqual(['keyword.operator.js', 'string.quoted.js', 'keyword.control.flow.js', 'comment.js'].map(s => rule(s)?.fg ?? null), [hex('#111111'), hex('#111111'), hex('#333333'), null])
  assert.deepEqual([hex('#abc'), hex('#aabbcc80'), hex('red'), hex(42)], [[170 / 255, 187 / 255, 204 / 255, 1], [170 / 255, 187 / 255, 204 / 255, 128 / 255], null, null])
  // a colour or a selector of the wrong kind passed over, as VS Code does, the rest read
  assert.equal(skin({ colors: { 'editor.background': 42 }, tokenColors: [{ scope: [7, 'constant.numeric'], settings: { foreground: '#ff0000' } }] })['--color-syntax-number'], 'rgb(255 0 0)')
  // a word's font style only where a rule gives one: a comment's italic, a string's none of its own; a semantic token's
  // none where the theme turns semantic highlighting off
  const s = skin({ tokenColors: [{ scope: 'comment', settings: { foreground: '#00ff00', fontStyle: 'italic underline' } }, { scope: 'string', settings: { foreground: '#ff0000' } }], semanticTokenColors: { variable: '#0000ff' } })
  assert.deepEqual([s['--italic-syntax-comment'], s['--bold-syntax-comment'], s['--line-syntax-comment'], s['--italic-syntax-string'], s['--color-semantic-variable']], ['italic', 'normal', 'underline', undefined, undefined])
})

// A theme from its own file (View, Theme, Open a VS Code theme…), one to another leaving nothing of the first (A, then
// B with fewer channel hues: the first's last hues gone), a file that is not a theme said so, the theme kept; a theme
// kept that no longer reads, the page up in the screen's own skin
test('editor: a VS Code theme opened from its file; one to another, nothing of the first left; one that does not read', async () => {
  await open()
  const pick = async (name, text) => {
    const chooser = page.waitForEvent('filechooser')
    await menu('View', 'Theme', 'Open a VS Code theme…')
    await (await chooser).setFiles({ name, mimeType: 'application/json', buffer: Buffer.from(text) })
  }
  const style = k => page.evaluate(k => document.documentElement.style.getPropertyValue(k), k)
  // a theme of its own words: two hues apart, then one
  await pick('mine.json', `{ "name": "Mine", // a comment, as VS Code allows
    "type": "dark", "colors": { "editor.background": "#102030" },
    "tokenColors": [{ "scope": "constant.numeric", "settings": { "foreground": "#ff8000" } }, { "scope": "string", "settings": { "foreground": "#00c0ff" } },] }`)
  await page.waitForFunction(() => document.documentElement.style.getPropertyValue('--color-screen') === 'rgb(16 32 48)')
  assert.deepEqual([await style('--color-screen-ink'), await style('--color-screen-channel-2'), await style('--color-screen-channel-3')], ['rgb(187 187 187)', 'rgb(255 128 0)', 'rgb(0 192 255)'])
  await pick('other.json', `{ "name": "Other", "colors": { "editor.background": "#f0f0f0" } }`)
  await page.waitForFunction(() => document.documentElement.style.getPropertyValue('--color-screen') === 'rgb(240 240 240)')
  assert.equal(await style('--color-screen-channel-3'), '', 'the first theme\'s third hue gone')
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('audio-theme')).name), 'Other')
  // not a theme: said so, the theme worn as it was
  await pick('broken.json', '{ nope')
  await page.locator('.message.problem', { hasText: 'broken.json is not a VS Code colour theme' }).waitFor()
  assert.equal(await style('--color-screen'), 'rgb(240 240 240)')
  // kept, but no longer read: the page comes up whole, in the screen's own skin
  await page.evaluate(() => localStorage.setItem('audio-theme', '{"name":"Gone","theme":null}'))
  await page.reload()
  await wholeLevels().waitFor()
  assert.equal(await style('--color-screen'), '')
})

// The mark in the bar drawn in the bar's ink as a theme changes it: on Dark Modern's title bar (#181818) its words'
// #CCCCCC, never the screen's dark ink left on a dark page
test('editor: the mark in the bar takes the theme\'s ink', async () => {
  await open()
  const light = async () => { const png = (await page.locator('.bar .wordmark .logo').screenshot()).toString('base64'); return page.evaluate(async png => {
    const image = new Image(); image.src = 'data:image/png;base64,' + png; await image.decode()
    const g = new OffscreenCanvas(image.width, image.height).getContext('2d'); g.drawImage(image, 0, 0)
    const d = g.getImageData(0, 0, image.width, image.height).data; let n = 0
    for (let i = 0; i < d.length; i += 4) if (d[i] > 150 && d[i + 1] > 150 && d[i + 2] > 150) n++
    return n / (d.length / 4)
  }, png) }
  await menu('View', 'Theme', 'Dark Modern')
  await page.waitForFunction(() => document.documentElement.style.getPropertyValue('--color-ink') === 'rgb(204 204 204)')
  await poll(light, n => assert.ok(n >= .05, 'the mark in the light ink'), 3000)
})

// VS Code's fonts, not a theme's (a theme has none): unset, its defaults by platform, the editor's EDITOR_FONT_DEFAULTS
// (src/vs/editor/common/config/fontInfo.ts: Menlo 12 on a Mac, Consolas 14 on Windows, Droid Sans Mono 14 elsewhere)
// and the workbench's (style.css .mac, .windows, .linux); the editor's size the picture's numbers' too, as its line
// numbers'; set, as they are set
test('theme: VS Code\'s fonts by platform, the picture\'s numbers at the editor\'s size; set, as set', async () => {
  const { fonts } = await import('../../repl/theme.js')
  assert.deepEqual(fonts({}, 'MacIntel'), { '--font-mono': "Menlo, Monaco, 'Courier New', monospace", '--font-body': '-apple-system, BlinkMacSystemFont, sans-serif', '--font-size-code': '12px', '--font-size-label': '12px' })
  assert.deepEqual(fonts({}, 'Win32'), { '--font-mono': "Consolas, 'Courier New', monospace", '--font-body': "'Segoe WPC', 'Segoe UI', sans-serif", '--font-size-code': '14px', '--font-size-label': '14px' })
  assert.equal(fonts({}, 'Linux x86_64')['--font-mono'], "'Droid Sans Mono', monospace")
  assert.deepEqual(fonts({ editor: 'Fira Code', size: '15px', ui: 'Inter' }, 'MacIntel'), { '--font-mono': 'Fira Code', '--font-body': 'Inter', '--font-size-code': '15px', '--font-size-label': '15px' })
})

// Flat: the waveform one solid shade, peak to peak, nothing graded (gl-waveform with neither its RMS band nor its
// density: its envelope in the line's colour); Density grades it, most of it lighter. On Light+, its text black
test('editor: the waveform\'s Flat fill one solid shade; Density graded', async () => {
  await page.addInitScript(async () => {
    if (sessionStorage.seeded) return
    sessionStorage.seeded = 1
    const m = await import('/repl/theme.js'), t = m.THEMES.find(t => t.name === 'Light+')
    localStorage.setItem('audio-theme', JSON.stringify({ name: t.name, theme: await m.load(new URL('/repl/themes/' + t.file, location.href).href, { kind: t.kind }) }))
  })
  await open()
  await page.reload()
  await wholeLevels().waitFor()
  await write(`audio.from(t => 0.6 * Math.sin(2 * Math.PI * 3 * t) * Math.sin(2 * Math.PI * 220 * t), { duration: 2 })`)
  await lengthIs('0:02.000')
  // of the lanes' inked pixels (darker than the screen's white: the grid's dots and the sound's anti-aliased edges among
  // them), the share that is the text's black
  const solid = () => pixels(`let ink = 0, black = 0; for (let y = 0; y < h - 44; y++) for (let x = 0; x < w - 60; x++) { const i = (y * w + x) * 4, v = d[i] + d[i + 1] + d[i + 2]; if (v < 600 && d[i + 2] < 240) { ink++; if (v < 60) black++ } } return black / (ink || 1)`)
  await settled()
  const graded = await solid()
  await menu('View', 'Waveform options', 'Fill', 'Flat')
  await poll(solid, flat => assert.ok(flat > .6 && graded < flat - .3, `flat ${flat.toFixed(2)}, density ${graded.toFixed(2)}`))
})

// A theme from the View menu: the screen its background, the waveform its text's colour; kept as the page comes back;
// the screen's own skin back, nothing of the theme left
test('editor: a VS Code theme from the View menu, the waveform in its text\'s colour, kept; the screen\'s own back', async () => {
  await open()
  await write(`audio.from(t => 0.8 * Math.sin(2 * Math.PI * 220 * t), { duration: 1 })`)
  await lengthIs('0:01.000')
  // the share of the lane's pixels near a colour, TRACK px down
  const lane = tall(await page.locator('.plot').boundingBox())
  const near = rgb => pixels(`const [r, g, b] = arg.rgb; let n = 0, all = 0; for (let y = 0; y < arg.lane; y++) for (let x = 0; x < w - 60; x++) { const i = (y * w + x) * 4; all++; if (Math.abs(d[i] - r) + Math.abs(d[i + 1] - g) + Math.abs(d[i + 2] - b) < 40) n++ } return n / all`, { rgb, lane })
  await menu('View', 'Theme', 'Light+')
  const shares = async () => [await near([0, 0, 0]), await near([255, 255, 255])]
  await poll(shares, ([black, white]) => {
    // its density fill lightens most of it; at its densest, the text's black itself
    assert.ok(black > .03, 'the waveform Light+\'s text, #000000')
    assert.ok(white > .3, 'the screen its white')
  })
  await page.reload()
  await wholeLevels().waitFor()
  await poll(shares, ([black, white]) => assert.ok(black > .03 && white > .3, 'kept as the page comes back'))
  await menu('View', 'Theme', 'The screen')
  // (the caret's line aside, white in the screen's own skin too: a column of the lanes, a thousandth of them)
  await poll(() => near([255, 255, 255]), white => assert.ok(white < .002, 'none of its white left'))
  assert.deepEqual(await page.evaluate(() => [document.documentElement.style.getPropertyValue('--color-screen'), localStorage.getItem('audio-theme')]), ['', null])
})

// Inside a VS Code webview the page wears the theme VS Code does: its colours as VS Code sets them on the page
// (--vscode-*), its kind the body's class (code.visualstudio.com/api/extension-guides/webview, Theming webview content)
test('editor: in a VS Code webview, the theme VS Code wears', async () => {
  // set as the page is parsed, before its scripts run, as VS Code sets them before the webview's
  await page.addInitScript(() => document.addEventListener('readystatechange', () => {
    // a see-through colour as VS Code writes one there, rgba() (Color.Format.CSS.format)
    for (const [k, v] of Object.entries({ 'editor-background': '#fffffe', 'editor-foreground': '#202020', 'editorLineNumber-foreground': '#237893', 'editorWhitespace-foreground': 'rgba(10, 20, 30, 0.5)', 'editor-font-family': 'Fira Code', 'editor-font-size': '15px', 'font-family': 'Inter' })) document.documentElement.style.setProperty(`--vscode-${k}`, v)
    document.body.classList.add('vscode-light')
  }, { once: true }))
  await open()
  assert.deepEqual(await page.evaluate(() => ['--color-screen', '--color-screen-line-number', '--color-screen-ink', '--color-screen-grid', '--font-mono', '--font-body', '--font-size-label'].map(k => document.documentElement.style.getPropertyValue(k))), ['rgb(255 255 254)', 'rgb(35 120 147)', 'rgb(32 32 32)', 'rgb(10 20 30 / 0.502)', 'Fira Code', 'Inter', '15px'])
})

// Pointed nowhere on the picture, no level axis, a player's picture; pointed at the sound, there, of its band. The time
// row over the bands always
test('editor: the level axis shows only while the band is pointed at; the time row always', async () => {
  await open()
  await settled()
  const box = await page.locator('.plot').boundingBox(), g = await gutter()
  // light text in the axis' column by the lanes, or along the time row over the scrollbar's strip at the picture's foot
  // (its 14 px over the strip's 8), from the overlay and the row as they show
  const ink = ([y0, y1], x0) => pixels(`let n = 0; for (let y = arg.y0; y < arg.y1; y++) for (let x = arg.x0; x < w; x++) { const i = (y * w + x) * 4; if (d[i] > 90 && Math.abs(d[i] - d[i + 2]) < 20) n++ } return n`, { y0, y1, x0 })
  const axis = () => ink([TOP, TOP + TRACK], Math.round(box.width - g)), row = () => ink([Math.round(box.height) - 22, Math.round(box.height) - 8], 40)
  await page.mouse.move(box.x + 200, box.y + TOP + TRACK / 3)
  await poll(axis, n => assert.ok(n > 40, `pointed at, its axis: ${n}`), 3000)
  assert.ok(await row() > 100, 'the time row')
  await page.mouse.move(2, 2)
  await poll(axis, n => assert.ok(n < 10, `pointed nowhere, none: ${n}`), 3000)
  assert.ok(await row() > 100, 'the time row still')
})


// The levels' labels give way to the value read only where it is written: over a waveform, at the waveform's level at
// the pointer's time, so the pointer high over a quiet stretch leaves the top's label as it is (the value, 0, written
// at the middle); held ⌘, the value its own height's, the top's label gives way
test('editor: an axis label gives way to the value read where it is written, not to the pointer', async () => {
  await open()
  await noCues()
  await write(`audio('chime.wav')\n  .remix(1)`)
  await lengthIs('0:08.000')
  await settled()
  const { box, x } = await axis(8)
  await page.evaluate(() => {
    window.__said = new Set()
    const text = CanvasRenderingContext2D.prototype.fillText
    CanvasRenderingContext2D.prototype.fillText = function (s, x, y) { if (this.canvas.matches('.overlay')) window.__said.add(s); return text.call(this, s, x, y) }
  })
  // what the overlay writes as the pointer comes to the tail at 7.9 s, near silence, a few px under the top's tick
  let nudge = 0
  const said = async () => { await page.evaluate(() => window.__said = new Set()); await page.mouse.move(x(7.9) + (nudge ^= 1), box.y + TOP + 6); await page.waitForTimeout(150); return page.evaluate(() => [...window.__said]) }
  await poll(said, s => assert.ok(s.includes('1'), `the top's label kept: ${s}`), 3000)
  await page.keyboard.down('ControlOrMeta')
  await poll(said, s => assert.ok(!s.includes('1'), `held ⌘, the top's giving way: ${s}`), 3000)
  await page.keyboard.up('ControlOrMeta')
})
