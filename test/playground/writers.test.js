// Edits made on the picture: fades, levels, stretches, cues dragged, silence opened; the server, the page and the
// helpers in page.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { page, code, wholeLevels, levelsTable, open, settled, frames, poll, still, settings, selected, tab, menu, palette, noCues, write, LANES, tall, gutter, spans, axis, grab, STRETCHING, warps, boxDrag, drag, lengthIs, tap, heard, hits, handles, dragCue, pixels, show, bursts, way, turn, keyed, chime } from './page.js'

// Moved past the sound's end, a slice opens silence up to where it lands: the sound gets longer
test('editor: a slice moved past the end opens silence up to where it lands', async () => {
  const { x, y } = await chime()
  await drag([x(6), y], [x(7) - x(6), 0])
  await keyed(['ControlOrMeta'], () => drag([x(6.5), y], [x(7.9) - x(6.5), 0]))
  // where it lands, to the pixel the zoom's step rounds to (fonts and widths differ from one machine to another)
  await page.waitForFunction(() => /\.move\(\{ at: 6, d: 1, to: [\d.]+, xfade: 0\.01 \}\)$/.test(scriptText()))
  const to = +(await code()).match(/to: ([\d.]+), xfade/)[1]
  assert.ok(Math.abs(to - 7.4) <= .011, `lands at ${to}`)
  await lengthIs(`0:0${(to + 1).toFixed(3)}`)
})

// The cues are where sounds start and end and where they hit, one list: each hit here (0.5 s apart), and where each falls
// quiet before the next. A cue dragged warps the audio between the cues either side, which hold.
test('editor: dragging a cue moves it, the audio on either side stretching to fit, the cues either side holding', async () => {
  // the cues each output brings, counted as the view takes them (__cued)
  await page.route('**/playground/view.js', async route => { const r = await route.fetch(); route.fulfill({ response: r, body: (await r.text()).replace('    set cues(list) {\n', '    set cues(list) {\n      if (list) globalThis.__cued = (globalThis.__cued ?? 0) + 1\n') }) })
  await page.route('**/playground/editor/context.js', async route => { const r = await route.fetch(); route.fulfill({ response: r, body: (await r.text()).replace('let output = null, incoming', 'globalThis.__output = () => output\nlet output = null, incoming') }) })
  await open()
  await write(hits)
  await lengthIs('0:02.000')
  // the cues are lines in the lanes, each grabbed there with ⌘ (Ctrl) held; without it, a press there is the caret's
  const { box, x } = await axis(2), y = box.y + 20, cursor = () => page.locator('.plot').evaluate(el => el.style.cursor)
  // the hit at 1 s, and the cues either side of it, before it moves
  const w = await spans(box)
  const cues = await poll(async () => (await handles()).map(px => px / w * 2), cues => assert.ok(cues.some(t => Math.abs(t - 1) < .02), `the cue at 1 s: ${cues}`), 8000)
  const prev = cues.findLast(t => t < .95), next = cues.find(t => t > 1.05)
  assert.ok(prev > .5 && next < 1.5, `a cue where the hit before falls quiet, and where this one does: ${JSON.stringify(cues)}`)
  await page.keyboard.down('ControlOrMeta')
  const at = await grab(Array.from({ length: Math.ceil(x(1.05) - x(.95)) }, (_, i) => [x(.95) + i, y]), 'col-resize')
  // the hit the sound starts with is the start, which warp() holds: no line there
  await page.mouse.move(x(.25), y)
  assert.notEqual(await cursor(), 'col-resize')
  await page.mouse.move(x(0) + 2, y)
  assert.notEqual(await cursor(), 'col-resize')
  await page.keyboard.up('ControlOrMeta')
  await page.mouse.move(...at)
  assert.notEqual(await cursor(), 'col-resize', 'no cue to take without ⌘')
  await page.keyboard.down('ControlOrMeta')
  const cued = await page.evaluate(() => globalThis.__cued)
  await drag(await grab([at], 'col-resize'), [x(1.2) - x(1), 0])
  await page.keyboard.up('ControlOrMeta')
  await page.waitForFunction(() => /\.warp\(/.test(scriptText()))
  const markers = await warps(), [moved] = markers.filter(([a, b]) => a !== b), held = markers.filter(([a, b]) => a === b).map(([a]) => a)
  // the hit at 1 s lands 0.2 s later; the cues either side hold the rest in place
  assert.equal(markers.length, 3, JSON.stringify(markers))
  assert.ok(Math.abs(moved[0] - 1) < .03 && Math.abs(moved[1] - moved[0] - .2) < .01, JSON.stringify(markers))
  assert.ok(Math.abs(held[0] - prev) < .01 && Math.abs(held[1] - next) < .01, JSON.stringify([held, prev, next]))
  // the moved hit is its marker now: dragged again, that marker moves on, once the output of the first drag has come and
  // its cues with it (they replace the ones the view moved, a few pixels off, under a press on its way)
  await page.waitForFunction(n => globalThis.__output()?.editor?.includes('.warp(') && globalThis.__cued > n, cued)
  await dragCue(Array.from({ length: 13 }, (_, i) => [x(moved[1]) - 6 + i, y]), [x(.1) - x(0), 0])
  await page.waitForFunction(to => scriptText().includes(`, ${to}`) === false, moved[1])
  const later = await warps()
  assert.equal(later.length, 3, JSON.stringify(later))
  assert.ok(later.some(([a, b]) => a === moved[0] && Math.abs(b - moved[1] - .1) < .01), JSON.stringify(later))
  // another cue joins the same call: the one held before it moves 0.1 s later
  const [first] = later
  await dragCue(Array.from({ length: 13 }, (_, i) => [x(first[1]) - 6 + i, y]), [x(.1) - x(0), 0])
  const it = list => list.find(([a]) => a === first[0])
  const last = await poll(warps, last => assert.ok(Math.abs(it(last)[1] - first[1] - .1) < .01, JSON.stringify(last)))
  assert.equal((await code()).match(/\.warp\(/g).length, 1)
  // it moved, the cue before it now holding too (the hit at 0.5 s), the rest as they were
  assert.ok(Math.abs(it(last)[1] - first[1] - .1) < .01, JSON.stringify(last))
  assert.equal(last.length, 4, JSON.stringify(last))
  assert.ok(Math.abs(last[0][0] - .5) < .01 && last[0][0] === last[0][1], JSON.stringify(last))
  assert.deepEqual(last.slice(2), later.slice(1))
  await wholeLevels().waitFor()
  await lengthIs('0:02.000')
})

// The chime rings on, its partials beating: its cues are its eight strikes and where its rings fall quiet, not the swells
// of its rings, and one dragged moves alone.
test('editor: a dragged cue moves alone; the sound stretched around it makes no new cues', async () => {
  // the cues each output brings, counted as the view takes them (__cued)
  await page.route('**/playground/view.js', async route => { const r = await route.fetch(); route.fulfill({ response: r, body: (await r.text()).replace('    set cues(list) {\n', '    set cues(list) {\n      if (list) globalThis.__cued = (globalThis.__cued ?? 0) + 1\n') }) })
  await open()
  // the chime's strikes after its first, which the caret starts on
  const before = await poll(handles, before => assert.ok(before.length >= 7, JSON.stringify(before)), 8000)
  // 0.2 s later, a cue with room for it either side
  const box = await page.locator('.plot').boundingBox(), dx = .2 / 6.525 * await spans(box)
  const k = before.findIndex((p, i) => i > 0 && i < before.length - 1 && before[i + 1] - p > dx * 1.5 && p - before[i - 1] > dx * .5)
  assert.ok(k > 0, JSON.stringify(before))
  const cued = await page.evaluate(() => globalThis.__cued)
  await dragCue([[box.x + before[k], box.y + 20]], [dx, 0])
  await page.waitForFunction(() => /\.warp\(/.test(scriptText()))
  // the warped output's own cues come
  await page.waitForFunction(n => globalThis.__cued > n, cued)
  await settled()
  const after = await handles()
  // a while on, none moving after
  await page.waitForTimeout(1000)
  assert.deepEqual(await handles(), after, 'settled')
  assert.equal(after.length, before.length, JSON.stringify(after))
  assert.ok(Math.abs(after[k] - before[k] - dx) <= 2, `${before[k]} → ${after[k]}`)
  assert.ok(after.every((x, i) => i === k || Math.abs(x - before[i]) <= 1), JSON.stringify([before, after]))
})

// A chord's ring, stretched, swells anew under the piano's tremolo: found again in the warped output, a drag would
// grow cues in the spans it stretched. Carried from before warp(), every other cue stays on its pixel.
test('editor: a cue dragged over a sustained sound leaves every other cue where it was', async () => {
  // the cues each output brings, counted as the view takes them (__cued)
  await page.route('**/playground/view.js', async route => { const r = await route.fetch(); route.fulfill({ response: r, body: (await r.text()).replace('    set cues(list) {\n', '    set cues(list) {\n      if (list) globalThis.__cued = (globalThis.__cued ?? 0) + 1\n') }) })
  await open()
  await write(`audio('rhodes.wav')`)
  await lengthIs('0:09.000')
  const { box, x } = await axis(9), y = box.y + 20
  const before = await poll(handles, before => assert.ok(before.length, 'its cues'), 8000)
  // the chord struck at 4.85 s, moved half a second earlier
  const from = before.reduce((a, h) => Math.abs(h - (x(4.853) - box.x)) < Math.abs(a - (x(4.853) - box.x)) ? h : a), to = from - (x(.5) - x(0))
  const cued = await page.evaluate(() => globalThis.__cued)
  await dragCue([[box.x + from, y]], [to - from, 0])
  await page.waitForFunction(() => /\.warp\(/.test(scriptText()))
  // the warped output's own cues come
  await page.waitForFunction(n => globalThis.__cued > n, cued)
  await settled()
  const after = await handles()
  // a while on, none moving after
  await page.waitForTimeout(1000)
  assert.deepEqual(await handles(), after, 'settled')
  const others = list => list.filter(h => Math.abs(h - from) > 8 && Math.abs(h - to) > 8)
  assert.ok(after.some(h => Math.abs(h - to) <= 2), `a cue where it was dropped (${to})`)
  assert.equal(others(after).length, others(before).length, JSON.stringify([before, after]))
  assert.ok(others(after).every((h, i) => Math.abs(h - others(before)[i]) <= 1), JSON.stringify([before, after]))
})

// The gain line shows once there is a curve: a level change on a selection makes one (a trapezoid, its ramps 5 ms)
// The line shows while its step is chosen in the edits, to be worked on; else it is out of sight
test('editor: a level change draws the gain line; its points drag, above or mirrored below, and a double-click takes one away', async () => {
  await open()
  await write(`audio.from(t => 0.5 * Math.sin(2 * Math.PI * 440 * t), { duration: 2 })`)
  await lengthIs('0:02.000')
  // the edits open, beside the picture, all of the sound shown again in what is left of it
  await tab('Edits')
  await still()
  await page.locator('.plot').focus()
  await page.keyboard.press('0')
  const { box, x } = await axis(2), mid = box.y + tall(box) * .4
  await page.mouse.move(x(.5), mid)
  await page.mouse.down()
  await page.mouse.move(x(1.5), mid, { steps: 5 })
  await page.mouse.up()
  await palette('3 dB louder')
  await page.waitForFunction(() => /\.gain\(\{ t: \[/.test(scriptText()))
  const curve = async () => (await code()).match(/\.gain\(\{ t: (\[.*?\]), v: (\[.*?\]) \}\)/).slice(1).map(s => JSON.parse(s.replace(/−/g, '-')))
  const [t, v] = await curve()
  assert.deepEqual(v, [0, 3, 3, 0])
  // the sine's −6.02 dBFS (20·log10 .5), 3 dB up where the curve is flat: −3.0, the selection's and the output's
  // the selection's: its peak on the bar, its levels in the tooltip
  await page.waitForFunction(() => (e => e.dataset.of === 'selection' && e.textContent === '−3.0dBFS')(document.querySelector('.readout')))
  assert.match(await levelsTable(), /\nPeak −3\.0dBFS at /)
  await page.keyboard.press('Escape')
  await wholeLevels().filter({ hasText: '−3.0dBFS' }).waitFor()
  // none till its step is chosen
  const card = page.locator('.step', { has: page.locator('.step-name', { hasText: 'Gain' }) })
  await card.locator('.step-toggle').click()
  // nothing selected, so a press on the line is the line's, not the selection's audio
  await page.mouse.click(x(1.9), mid)
  // the line on its own scale (view.js GAIN): −36 dB at the lane's centre line to +12 at its edges, mirrored below
  const lane = tall(box), centre = box.y + lane / 2, gy = (db, sign = 1) => centre - sign * (db + 36) / 48 * lane / 2
  // its height first, then out to 5 px either side: the points of a 5 ms ramp, 3 px across and 5 px up the lane, apart
  const near = (t, db, sign = 1) => Array.from({ length: 11 }, (_, i) => [x(t), gy(db, sign) + (i % 2 ? -1 : 1) * Math.ceil(i / 2)])
  // between its points, the line itself: a press there adds one
  const line = await grab(near(1, 3), 'ns-resize')
  // a point, dragged toward the centre line: quieter
  await drag(await grab(near(t[1], 3), 'move'), [0, 40])
  await page.waitForFunction(() => { const m = scriptText().match(/v: \[[^,]+, ([−\d.-]+),/); return m && +m[1].replace('−', '-') < 3 })
  assert.equal((await curve())[0][1], t[1], 'the point keeps its time')
  // its mirror image below the centre line drags it too
  await drag(await grab(near(t[2], 3, -1), 'move'), [0, -20])
  await page.waitForFunction(() => { const m = scriptText().match(/v: \[[^,]+, [^,]+, ([−\d.-]+),/); return m && +m[1].replace('−', '-') < 3 })
  // a double-click on a point takes it away
  await page.mouse.dblclick(...await grab(near(t[3], 0), 'move'))
  await page.waitForFunction(() => scriptText().match(/t: \[([^\]]+)\]/)?.[1].split(',').length === 3)
  assert.ok(line, 'the line is there to grab between its points')
})

test('editor: louder and quieter ease a range in and out on the one gain curve the pen draws', async () => {
  await open()
  await noCues()
  const { box, x } = await axis(6.525)
  await drag([x(2), box.y + 100], [x(3) - x(2), 0])
  const louder = () => palette('3 dB louder'), gain = () => code().then(c => c.match(/\.gain\((.*)\)$/)?.[1])
  await louder()
  await page.waitForFunction(() => /\.gain\(/.test(scriptText()))
  assert.equal(await gain(), '{ t: [2, 2.005, 2.995, 3], v: [0, 3, 3, 0] }')
  // again adds again, to the same curve
  await louder()
  await page.waitForFunction(() => /v: \[0, 6, 6, 0\]/.test(scriptText()))
  // a range from the start has no ramp there; the curve keeps the points of both
  await drag([x(1), box.y + 40], [x(0) - x(1) - 10, 0])
  await palette('3 dB quieter')
  await page.waitForFunction(() => /v: \[-3, -3, 0, 0, 6, 6, 0\]/.test(scriptText()))
  assert.equal(await gain(), '{ t: [0, 0.995, 1, 2, 2.005, 2.995, 3], v: [-3, -3, 0, 0, 6, 6, 0] }')
})

test('editor: a band quieter or louder is one spectral() call, changed in place while the band and range stay', async () => {
  await open()
  await noCues()
  await write(hits)
  await lengthIs('0:02.000')
  await show('spec')
  const { box, x } = await axis(2)
  await boxDrag([x(.5), box.y + tall(box) * .3], [x(1) - x(.5), box.height * .2])
  await palette('This band 6 dB quieter')
  await page.waitForFunction(() => /\.spectral\(\[\d+, \d+\], -6, \{ at: 0\.5, d: 0\.5 \}\)$/.test(scriptText()))
  await palette('This band 6 dB quieter')
  await page.waitForFunction(() => /\.spectral\(\[\d+, \d+\], -12, /.test(scriptText()))
  assert.equal((await code()).match(/\.spectral\(/g).length, 1)
})

// A script that opens with a gain() step draws its gain line from the start: the page must finish loading
test('editor: a script that opens with gain() loads, its gain line drawn', async () => {
  await page.addInitScript(() => localStorage.setItem('audio-repl', JSON.stringify({ side: 'code', code: `audio('chime.wav').gain(-6).gain({ t: [0, 1], v: [0, -6] })` })))
  await open()
  assert.match(await code(), /\.gain\(-6\)/)
})

// A selection's grip, past its end three quarters down each lane, sets its length: trimmed (cut back, the seam
// crossfaded as a delete's, or silence added), stretched with the pitch kept, or sped with the pitch following, a click
// on it turning it to the next; a stretch just made changes with it. Its pill sets its level; the first of the tools at
// the lanes' foot, its pitch. Each is one step.
test('editor: a selection\'s grip trims, stretches or speeds it, its pill sets its level and its pitch tool its pitch', async () => {
  const { box, x, y } = await chime(), lh = (tall(box) - LANES) / 2
  const select = async (a, b) => { await page.mouse.click(x(7.5), y); await drag([x(a), y], [x(b) - x(a), 0]) }
  const last = async pattern => { await page.waitForFunction(p => new RegExp(p).test(scriptText()), pattern.source); return code() }
  const undo = async () => {
    for (let i = 0; i < 3 && await code() !== "audio('chime.wav')"; i++) { await page.keyboard.press('ControlOrMeta+Z'); await page.waitForTimeout(150) }
    await page.waitForFunction(() => scriptText() === "audio('chime.wav')")
    await lengthIs('0:08.000')
  }
  const grip = b => grab([[x(b) + 8, box.y + lh * 3 / 4]], /^url\(|ew-resize/), pill = (a, b) => grab([[(x(a) + x(b)) / 2, box.y + 4]], 'ns-resize')
  await select(1, 2)
  await drag(await grip(2), [x(1.5) - x(1), 0])
  assert.match(await last(/\.stretch\(/), /\.stretch\(1\.5, \{ at: 1, d: 1 \}\)$/)
  await lengthIs('0:08.500')
  await turn(await grip(2.5), 'grip', 'speed')
  assert.match(await last(/\.speed\(/), /\.speed\(0\.66667, \{ at: 1, d: 1 \}\)$/)
  await undo()
  await select(1, 2)
  await turn(await grip(2), 'grip', 'trim')
  await drag(await grip(2), [x(1.5) - x(2), 0])
  assert.match(await last(/\.remove\(/), /\.remove\(\{ at: 1\.5, d: 0\.5, xfade: 0\.01 \}\)$/)
  await lengthIs('0:07.500')
  assert.equal(await selected(), '0:01.000–0:01.500')
  await undo()
  await select(1, 2)
  await drag(await grip(2), [x(2.5) - x(2), 0])
  assert.match(await last(/\.insert\(/), /\.insert\(0\.5, \{ at: 2, xfade: 0\.01 \}\)$/)
  await lengthIs('0:08.500')
  await undo()
  await select(1, 2)
  await drag(await pill(1, 2), [0, -box.height / 10])
  const text = await last(/\.gain\(/), [, v] = text.match(/\.gain\(\{ t: \[1, 1\.005, 1\.995, 2\], v: \[0, ([\d.]+), [\d.]+, 0\] \}\)$/) || [, text]
  assert.ok(+v > 0, v)
  await undo()
  await select(1, 2)
  // the tools inside its foot, side by side from its middle (view.js BOX, 16 px, 2 apart): pitch, intonation, formants
  await drag(await grab([[(x(1) + x(2)) / 2 - 18, box.y + tall(box) - 8]], 'ns-resize'), [0, -box.height / 10])
  await last(/\.pitch\(/)
})

// A selection's top corners, each drawn as the fade it makes, fade it: inward, in from its start or out to its end;
// outward, past its edge, the audio out there goes, crossfading into the selection (fn/crossfade.js). A click on one
// turns the curve to the next: the fade just made takes it, and so do the next.
test('editor: a selection fades from its top corners: inward from its edge, outward a crossfade, on the curve turned to', async () => {
  await open()
  await noCues()
  await write(`audio('chime.wav')`)
  await lengthIs('0:08.000')
  const { box, x } = await axis(8), y = box.y + tall(box) * .3, dot = box.y + 9
  const select = async () => { await page.mouse.click(x(7.5), y); await page.mouse.move(x(2.2), y); await page.mouse.down(); await page.mouse.move(x(4.2), y, { steps: 4 }); await page.mouse.up() }
  await select()
  await drag(await grab([[x(2.2) + 9, dot]], 'ew-resize'), [x(2.7) - x(2.2), 0])
  await page.waitForFunction(() => /\.fade\(0\.5, \{ at: 2\.2 \}\)$/.test(scriptText()))
  // a click on the corner: the next curve, which the fade just made takes, each click one step
  await turn([x(2.2) + 3, box.y + 3], 'curve', 'cos')
  await page.waitForFunction(() => /\.fade\(0\.5, \{ at: 2\.2, curve: 'cos' \}\)$/.test(scriptText()))
  for (let i = 0; i < 4; i++) await page.keyboard.press('ControlOrMeta+Z')
  await page.waitForFunction(() => !scriptText().includes('fade'))
  await select()
  await drag(await grab([[x(4.2) - 9, dot]], 'ew-resize'), [x(3.7) - x(4.2), 0])
  await page.waitForFunction(() => /\.fade\(-0\.5, \{ at: 3\.7, curve: 'cos' \}\)$/.test(scriptText()))
  // out past the start: the 0.4 s before it go, crossfading into it; the selection moves back with its audio
  await select()
  await drag(await grab([[x(2.2) + 9, dot]], 'ew-resize'), [x(1.8) - x(2.2), 0])
  await page.waitForFunction(() => /\.crossfade\(\{ at: 1\.8, d: 0\.4 \}\)$/.test(scriptText()))
  assert.equal(await selected(), '0:01.800–0:03.800')
  await lengthIs('0:07.600')
  // out past the end: the 0.3 s after it go
  await select()
  await drag(await grab([[x(4.2) - 9, dot]], 'ew-resize'), [x(4.5) - x(4.2), 0])
  await page.waitForFunction(() => /\.crossfade\(\{ at: 4\.2, d: 0\.3 \}\)$/.test(scriptText()))
})

// Denoise: where the noise plays alone is selected, learned there and taken out everywhere, in one step; the rack sets how
// far down, the selection stays the noise. Nothing selected, it asks for that first.
test('editor: Denoise learns the noise where it is selected and takes it out everywhere', async () => {
  await open()
  await write(`audio('chime.wav')`)
  await lengthIs('0:08.000')
  await menu('Process', 'Repair', 'Denoise')
  await page.locator('.message', { hasText: 'Select where the noise plays alone first.' }).waitFor()
  const { box, x } = await axis(8), y = box.y + tall(box) * .3, readout = await page.locator('.readout').textContent()
  await page.mouse.move(x(6), y); await page.mouse.down(); await page.mouse.move(x(7.5), y, { steps: 4 }); await page.mouse.up()
  await palette('The noise here, taken 12 dB down everywhere')
  await page.waitForFunction(() => /\.denoise\(\{ noise: \{ at: 6, d: 1\.5 \} \}\)$/.test(scriptText()))
  await tab('Edits')
  await page.locator('.step.open .step-name', { hasText: 'Denoise' }).waitFor()
  assert.deepEqual(await page.locator('.step.open .param label').allInnerTexts(), ['reduction', 'threshold'])
  // the output comes with the noise taken out: its level changes, nothing goes wrong
  await page.waitForFunction(was => document.querySelector('.readout').textContent !== was, readout)
  assert.equal(await page.locator('.message.problem').count(), 0)
  // pauses selected together, a whine under them all: learned from every one
  await tab('Code')
  await write(bursts.replace('Math.sin(2 * Math.PI * 440 * t)', 'Math.sin(2 * Math.PI * 440 * t) + .002 * Math.sin(2 * Math.PI * 7919 * t)'))
  await lengthIs('0:02.500')
  // all of it in view (a shorter sound keeps the last one's scale), so the pause at 0.45 s is where it is pressed
  await page.locator('.plot').focus()
  await page.keyboard.press('0')
  const at = await axis(2.5)
  await page.mouse.dblclick(at.x(.45), at.box.y + tall(at.box) / 3)
  await page.waitForFunction(() => /^Selected 0:00\.4\d+–0:00\.4\d+/.test((e => e.title || e.dataset.tip || '')(document.querySelector('.clock'))))
  await page.keyboard.press('ControlOrMeta+D')
  await page.keyboard.press('ControlOrMeta+D')
  await palette('The noise alone in all 3')
  await page.waitForFunction(() => /\.denoise\(\{ noise: \[\{ at: [\d.]+, d: [\d.]+ \}(, \{ at: [\d.]+, d: [\d.]+ \}){2}\] \}\)$/.test(scriptText()))
  // a box on the spectrogram: its time where the noise plays alone, its band where it goes, the rest as it was
  await page.keyboard.press('ControlOrMeta+Z')
  await show('spec')
  const lane = tall(at.box)
  await page.mouse.click(at.x(.2), at.box.y + lane * .5)
  await page.keyboard.press('0')
  await boxDrag([at.x(1), at.box.y + lane * .1], [at.x(1.4) - at.x(1), lane * .15])
  assert.match(await selected(), /^0:01\.0\d\d–0:01\.4\d\d$/)
  await palette('The noise here, taken 12 dB down in this band everywhere')
  await page.waitForFunction(() => /\.denoise\(\{ noise: \{ at: 1(\.0\d*)?, d: 0\.[34]\d* \}, band: \[\d+, \d+\] \}\)$/.test(scriptText()))
  const [lo, hi] = (await code()).match(/band: \[(\d+), (\d+)\]/).slice(1).map(Number)
  assert.ok(lo > 3000 && hi > lo && hi < 22050, `${lo}–${hi}`)
  await page.waitForFunction(() => !document.querySelector('.message.problem'))
})

// A selection's handles each do one thing: the square past its end, a square's height off each lane's foot (lanes 2 px apart
// over the plot less its 22 px time row, view.js), stretches it, however the pointer wanders up or down; the pill on its
// top edge, dragged first up, sets its level, however it wanders across after.
// A stretch dragged to anywhere, not a round factor: the output it makes ends the stretched range where the drag let go,
// to the sample, so nothing after it moves when it comes (the library's length, round(n × factor), fn/stretch.js)
test('editor: a stretch dragged anywhere ends where it was let go, to the sample', async () => {
  const { box, x, y } = await chime(), lh = (tall(box) - LANES) / 2
  await settings('Times in', 'samples')
  await page.mouse.click(x(7.5), y)
  await drag([x(1), y], [x(1.7) - x(1), 0])
  assert.equal(await selected(), '44100–74970')
  const grip = await grab([[x(1.7) + 8, box.y + lh * 3 / 4]], /^url\(|ew-resize/)
  await drag(grip, [x(2.07) - x(1.7) + 3, 0])
  await page.waitForFunction(() => /\.stretch\(/.test(scriptText()))
  const [a, to] = (await selected()).split('–').map(Number)
  // its length, in the samples the times are in, no longer 8 s'
  await page.waitForFunction(() => !(e => e.title || e.dataset.tip || '')(document.querySelector('.source')).endsWith(' · 352800'))
  // all of it selected, in samples: 0 to its length
  await page.locator('.plot').focus()
  await page.keyboard.press('ControlOrMeta+A')
  const total = +(await selected()).split('–')[1]
  assert.equal(total - 8 * 44100, to - a - 30870, await code())
})

test('editor: a selection\'s grip only stretches it, its pill dragged up only sets its level', async () => {
  await page.addInitScript(tap)
  await open()
  await noCues()
  await write(`audio('chime.wav')`)
  await lengthIs('0:08.000')
  const { box, x } = await axis(8), y = box.y + tall(box) * .3, lh = (tall(box) - LANES) / 2
  const select = async () => { await page.mouse.click(x(7.5), y); await drag([x(2.2), y], [x(4.2) - x(2.2), 0]) }
  await select()
  await drag(await grab([[x(4.2) + 8, box.y + lh * 3 / 4], [x(4.2) + 8, box.y + lh + LANES + lh * 3 / 4]], STRETCHING), [x(5.2) - x(4.2), -80])
  await page.waitForFunction(() => /\.stretch\(1\.5, \{ at: 2\.2, d: 2 \}\)$/.test(scriptText()))
  assert.equal(await selected(), '0:02.200–0:05.200')
  assert.doesNotMatch(await code(), /gain/)
  await page.keyboard.press('ControlOrMeta+Z')
  await page.waitForFunction(() => !scriptText().includes('stretch'))
  // the 8 s output back in view before selecting on it: x() maps 8 s, and the 9 s stretched one may still show
  await lengthIs('0:08.000')
  await select()
  // the pill dragged: heard at the level it goes to as it goes, as a pitch dragged is
  const pill = await grab([[(x(2.2) + x(4.2)) / 2, box.y + 4]], 'ns-resize')
  await heard()
  await page.mouse.move(...pill)
  await page.mouse.down()
  for (let i = 1; i <= 6; i++) await page.mouse.move(pill[0] + 10 * i, pill[1] - 80 * i / 6)
  // (the chime peaks at half of full scale: 12 dB up, past it)
  await poll(heard, ({ peak }) => assert.ok(peak > .9, `heard as the level goes, 12 dB up: ${peak}`))
  await page.mouse.up()
  await page.waitForFunction(() => /\.gain\(\{ t: \[2\.2, 2\.205, 4\.195, 4\.2\], v: \[0, [\d.]+, [\d.]+, 0\] \}\)$/.test(scriptText()))
  assert.doesNotMatch(await code(), /stretch/)
})

// Crossfade on a selection, as an editor's: the audio either side meets across it, and it goes (fn/crossfade.js)
test('editor: the crossfade tool on a selection crossfades across it', async () => {
  await open()
  await noCues()
  await write(`audio('chime.wav')`)
  await lengthIs('0:08.000')
  const { box, x } = await axis(8), y = box.y + tall(box) * .3
  await drag([x(2.2), y], [x(2.3) - x(2.2), 0])
  await page.keyboard.press('ControlOrMeta+K')
  await page.keyboard.type('crossfade')
  await page.keyboard.press('Enter')
  await page.waitForFunction(() => /\.crossfade\(\{ at: 2\.2, d: 0\.1 \}\)$/.test(scriptText()))
  await lengthIs('0:07.900')
  assert.equal(await page.locator('.message.problem').count(), 0)
})

// With nothing selected, the square past the caret, where a selection's stretch square is, pulls silence open there:
// insert() of the length it is dragged, what follows moving on
test('editor: the square past the caret opens silence there', async () => {
  await open()
  await noCues()
  await write(`audio('chime.wav')`)
  await lengthIs('0:08.000')
  const { box, x } = await axis(8), lh = (tall(box) - LANES) / 2
  await page.mouse.click(x(2), box.y + tall(box) * .3)
  // its pointer trim's, as it does what trimming out does
  await drag(await grab([[x(2) + 9, box.y + lh * 3 / 4]], 'ew-resize'), [x(3) - x(2), 0])
  await page.waitForFunction(() => /\.insert\(1, \{ at: 2, xfade: 0\.01 \}\)$/.test(scriptText()))
  await lengthIs('0:09.000')
})

// At the end the caret's square is before it, there being no room past it; pulled out past where the pictures end, the
// view widens a frame at a time while the pointer stays out there, and the silence is as long as it is pulled
test('editor: at the end, the square before the caret opens silence past the picture\'s edge, as far as it is pulled', async () => {
  await open()
  await noCues()
  await write(`audio('chime.wav')`)
  await lengthIs('0:08.000')
  const { box, x } = await axis(8), lh = (tall(box) - LANES) / 2
  await page.locator('.plot').focus()
  await page.keyboard.press('End')
  const at = await grab([[x(8) - 8, box.y + lh * 3 / 4]], 'ew-resize')
  await page.mouse.move(...at)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width - 20, at[1], { steps: 5 })
  // held out there 600 ms: the view runs on a frame at a time (view.js overrun), the silence with it
  await page.waitForTimeout(600)
  // said by the pointer out there, as it grows
  assert.match(await page.locator('.hint').innerText(), /^silence \d+:\d\d\.\d+$/)
  await page.mouse.up()
  await page.waitForFunction(() => /\.insert\([\d.]+, \{ at: 8, xfade: 0\.01 \}\)$/.test(scriptText()))
  const d = +(await code()).match(/\.insert\(([\d.]+),/)[1]
  assert.ok(d > 1, `as far as it was pulled: ${d} s`)
  await page.waitForFunction(total => { const [m, s] = (e => e.title || e.dataset.tip || '')(document.querySelector('.source')).split(' · ').pop().split(':'); return Math.abs(+m * 60 + +s - total) < 1e-3 }, 8 + d)
})

// The fade squares on whole pixels, flush with what they sit by and never over the caret's line: the one in from the
// selection's first pixel (the caret, where the drag left it, past its last), the one out to its last pixel, 16 px each,
// their edges as dark as their middles (no half pixel blurred), the wash either side of them. On silence, so only the
// wash and the squares show
test('editor: a selection\'s fade squares sit on whole pixels, flush with its start and its end', async () => {
  await open()
  await noCues()
  await write(`audio.from(2)`)
  await lengthIs('0:02.000')
  const { box, x } = await axis(2)
  await drag([x(.5) + .3, box.y + 60], [x(1.5) - x(.5), 0])
  // the pointer by it, so its squares show, in its middle on the time row, clear of the rows measured
  await page.mouse.move(x(1), box.y + box.height - 11)
  await poll(() => pixels(`
    const at = (px, y) => d[(y * w + px) * 4]
    // on a row under the squares, between the grid's dots (a tenth of full scale apart, 8 px in a lane TRACK px tall):
    // the wash's first column, and the caret's line, the brightest, after its last (where the drag left it)
    let start = -1, line = 0
    for (let px = 1; px < w - 60; px++) { if (at(px, 20) > at(line, 20)) line = px; if (start < 0 && at(px, 20) > at(px - 1, 20) + 4) start = px }
    return { start, line, row: [start, start + 8, start + 15, start + 16, line - 17, line - 16, line - 8, line - 1].map(px => at(px, 1)) }`), r => {
    const [in0, inMid, in1, washIn, washOut, out0, outMid, out1] = r.row
    assert.ok(in0 < washIn - 4 && in1 < washIn - 4 && out0 < washOut - 4 && out1 < washOut - 4, `squares darker than the wash at their edges: ${JSON.stringify(r)}`)
    assert.ok(Math.abs(in0 - inMid) <= 2 && Math.abs(in1 - inMid) <= 2 && Math.abs(out0 - outMid) <= 2 && Math.abs(out1 - outMid) <= 2, `edges as dark as middles: ${JSON.stringify(r)}`)
  })
})

// ⌘ (Ctrl) empowers: held at a range's end, the end sets its length, as the grip past it does (a stretch, by default),
// with the stretch's pointer; a plain press there only resizes the range
test('editor: held ⌘, a range\'s end stretches it, as its grip does', async () => {
  const { x, y } = await chime()
  await drag([x(1), y], [x(2) - x(1), 0])
  await page.mouse.move(x(2), y)
  await keyed(['ControlOrMeta'], async () => {
    await page.waitForFunction(() => /^url\(/.test(document.querySelector('.plot').style.cursor))
    await drag([x(2), y], [x(2.5) - x(2), 0])
  })
  await page.waitForFunction(() => /\.stretch\(1\.5, \{ at: 1, d: 1 \}\)$/.test(scriptText()))
  assert.equal(await selected(), '0:01.000–0:02.500')
  await lengthIs('0:08.500')
})

// Delete closes up the audio either side of what goes, crossfaded over 10 ms so the seam makes no click (remove(),
// fn/remove.js); the settings set it, or turn it off
test('editor: Delete crossfades the seam it leaves, as long as the settings say', async () => {
  await open()
  await noCues()
  await write(`audio('chime.wav')`)
  await lengthIs('0:08.000')
  const { box, x } = await axis(8), y = box.y + tall(box) * .3
  await drag([x(1), y], [x(2) - x(1), 0])
  await page.keyboard.press('Delete')
  await page.waitForFunction(() => /\.remove\(\{ at: 1, d: 1, xfade: 0\.01 \}\)$/.test(scriptText()))
  await lengthIs('0:07.000')
  await page.keyboard.press('ControlOrMeta+Z')
  await lengthIs('0:08.000')
  await settings('Splices', 'Off')
  // the selection Undo brought back, gone first: a press on its edge would drag the edge
  await page.mouse.click(x(6), y)
  await drag([x(1), y], [x(2) - x(1), 0])
  await page.keyboard.press('Delete')
  await page.waitForFunction(() => /\.remove\(\{ at: 1, d: 1 \}\)$/.test(scriptText()))
})

// A click on a handle turns it to its next way, in turn, no menu: the selection stays, and so does what the next click
// turns it to
test('editor: a click on a fade corner turns it to the next curve, no menu, the selection kept', async () => {
  await open()
  await noCues()
  await write(`audio('chime.wav')`)
  await lengthIs('0:08.000')
  const { box, x } = await axis(8), y = box.y + tall(box) * .3
  await drag([x(2), y], [x(4) - x(2), 0])
  for (const curve of ['exp', 'log', 'cos', 'linear']) {
    await page.mouse.click(x(2) + 8, box.y + 8)
    assert.equal(await way('curve'), curve)
  }
  assert.equal(await page.locator('[popover]:popover-open').count(), 0)
  assert.match(await selected(), /^0:02\.0\d\d–0:04\.0\d\d$/)
})

// A fade drags from a selection's dot and shows on the waveform as it goes, before its output comes
test('editor: a fade shows on the waveform while its dot is dragged', async () => {
  await open()
  await noCues()
  await write(`audio('chime.wav')`)
  await lengthIs('0:08.000')
  const { box, x } = await axis(8), y = box.y + tall(box) * .3
  await drag([x(2), y], [x(4) - x(2), 0])
  // the waveform's bright pixels there: a fade draws it smaller
  const light = () => pixels(`let n = 0; for (let x = Math.round(arg[0] * w); x < arg[1] * w; x++) for (let y = 0; y < h * .9; y++) { const i = (y * w + x) * 4; if (d[i] + d[i + 1] + d[i + 2] > 450) n++ } return n`, [(x(2.05) - box.x) / box.width, (x(2.6) - box.x) / box.width])
  const before = await light()
  await page.mouse.move(x(2) + 9, box.y + 9)
  await page.mouse.down()
  await page.mouse.move(x(3) + 9, box.y + 9, { steps: 6 })
  await frames()
  const during = await light()
  await page.mouse.up()
  assert.ok(during < before * .8, `dimmer as it fades: ${during} of ${before}`)
  await page.waitForFunction(() => /\.fade\(1, \{ at: 2 \}\)$/.test(scriptText()))
})

// A fade corner dragged outward is a crossfade: remove() with a crossfade as long splices it, centred on the seam
// (fn/remove.js), the audio before the cut fading out over the half before the seam and on past it, the audio after it
// fading in from the half before. Drawn as it will sound: the two equal-power curves crossing over the seam, from half
// its length before it to half after, not over the audio that goes
test('editor: a crossfade dragged out of a range\'s end draws both sides\' fades over each other, centred on the seam', async () => {
  await open()
  await noCues()
  await write(`audio.from(t => 0.5 * Math.sin(2 * Math.PI * 220 * t), { duration: 2 })`)
  await lengthIs('0:02.000')
  const { box, x } = await axis(2)
  await drag([x(.4), box.y + 80], [x(1) - x(.4), 0])
  // the corner at the range's end, at the lanes' top
  await page.mouse.move(x(1) - 8, box.y + 8)
  await page.mouse.down()
  await page.mouse.move(x(1.4) - 8, box.y + 8, { steps: 6 })
  await frames()
  // the accent's columns, the curves
  const [a, b] = await pixels(`let lo = w, hi = -1; for (let y = 0; y < h - 30; y++) for (let x = 0; x < w - ${await gutter()}; x++) { const i = (y * w + x) * 4; if (d[i] > 120 && d[i] - d[i + 2] > 60) { lo = Math.min(lo, x); hi = Math.max(hi, x) } } return [lo, hi]`)
  assert.equal(await page.locator('.hint').innerText(), 'crossfade 0:00.400')
  await page.mouse.up()
  const at = t => x(t) - box.x
  assert.ok(Math.abs(a - at(.8)) <= 3 && Math.abs(b - at(1.2)) <= 3, `the curves from ${a} to ${b}, the seam ±0.2 s ${at(.8)} to ${at(1.2)}`)
  await page.waitForFunction(() => /\.crossfade\(\{ at: 1, d: 0\.4 \}\)$/.test(scriptText()))
})

// A fade's corner dragged out and back to where it was pressed, give or take a few pixels, makes no edit
test('editor: a fade corner dragged back to where it began makes nothing', async () => {
  const { box, x, y } = await chime()
  await drag([x(2), y], [x(4) - x(2), 0])
  const before = await code()
  await page.mouse.move(x(2) + 9, box.y + 9)
  await page.mouse.down()
  await page.mouse.move(x(1.5), box.y + 9, { steps: 4 })
  await page.mouse.move(x(2) + 10, box.y + 9, { steps: 4 })
  await page.mouse.up()
  await settled()
  assert.equal(await code(), before)
})
