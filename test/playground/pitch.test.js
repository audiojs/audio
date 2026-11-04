// Pitch: the pitch curve and line, the pitch tools, the notes lanes; the server, the page and the helpers in page.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { page, CHIME, code, open, settled, poll, menuRow, menu, noCues, write, tall, gutter, axis, grab, drag, lengthIs, tap, heard, pixels, show, shown, chime, tools } from './page.js'

// Pitch is edited in its own context (View > Pitch curve), on the spectrogram, which the picture turns to: the pitch curve
// drawn on the voice's harmonics, none over the waveform; dragged up or down, by cents as the pitch tool goes (12 (dy /
// lh)²), the whole pitch line moves with it, one voice's pitch() curve (with no points, one where it was pressed), all of
// the voice moved; dragged again, the same curve set again
test('editor: dragging the pitch curve moves the whole pitch line, a voice\'s pitch() curve', async () => {
  await open()
  await write(`audio.from(t => 0.5 * Math.sin(2 * Math.PI * 220 * t) * (t > 0.5 && t < 1.5), { duration: 2 })`)
  await lengthIs('0:02.000')
  await menu('View', 'Show', 'Pitch curve')
  assert.equal(await shown(), 'Spectrogram')
  // the curve, wherever the spectrogram's scale puts 220 Hz: up its lane at 1 s
  const { box, x } = await axis(2), up = Array.from({ length: Math.floor(tall(box) / 3) }, (_, i) => [x(1), box.y + tall(box) - 3 * i])
  // none over the waveform, which has no pitch axis: where the tone's 220 Hz would be on a voice's range (60 Hz to 1 kHz
  // on octaves, view.js VOICE), nothing to grab, the pitch line's 0 half a lane away from it
  await grab(up, 'ns-resize')
  await show('wave')
  const f0y = box.y + tall(box) * (1 - Math.log(220 / 60) / Math.log(1000 / 60))
  for (let i = 0; i < 9; i++) { await page.mouse.move(x(1), f0y - 4 + i); assert.notEqual(await page.locator('.plot').evaluate(el => el.style.cursor), 'ns-resize') }
  // Pitch curve off: back to the waveform the spectrogram was turned to from; on again, the spectrogram
  await show('spec')
  await menu('View', 'Show', 'Pitch curve')
  assert.equal(await shown(), 'Waveform')
  await menu('View', 'Show', 'Pitch curve')
  assert.equal(await shown(), 'Spectrogram')
  const at = await grab(up, 'ns-resize')
  await page.mouse.move(...at)
  await page.mouse.down()
  const lh = tall(box)
  await page.mouse.move(at[0], at[1] - lh * Math.sqrt(2.5 / 12), { steps: 6 })
  assert.match(await page.locator('.hint').innerText(), /^\+2st [3-6]\dct, A3([+−]\d+ct)? → .+, all of it$/)
  await page.mouse.up()
  await page.waitForFunction(() => /\.pitch\(\{ t: \[1\], v: \[[1-9][\d.]*\] \}, \{ voice: true \}\)$/.test(scriptText().trim()))
  const st = +(await code()).match(/v: \[([\d.]+)\]/)[1]
  // dragged down again: the same curve, its semitones back toward 0
  await drag(await grab(up, 'ns-resize'), [0, lh / 4])
  await page.waitForFunction(st => { const m = scriptText().match(/v: \[([\d.]+)\]/); return m && +m[1] < st }, st)
  assert.equal((await code()).match(/\.pitch\(/g).length, 1, await code())
})

// A click on the pitch curve makes a point of the pitch line there, nothing changed yet; points are the line's, as the
// gain line's: one between two bends the line between them, heard as it goes; a double-click on it takes it away
test('editor: a click on the pitch curve makes a point of the pitch line; dragged between two, it bends what is between', async () => {
  await page.addInitScript(tap)
  await open()
  await write(`audio.from(t => 0.5 * Math.sin(2 * Math.PI * 220 * t) * (t > 0.5 && t < 1.5), { duration: 2 })`)
  await lengthIs('0:02.000')
  await menu('View', 'Show', 'Pitch curve')
  const { box, x } = await axis(2), up = t => Array.from({ length: Math.floor(tall(box) / 3) }, (_, i) => [x(t), box.y + tall(box) - 3 * i])
  await page.mouse.click(...await grab(up(.7), 'ns-resize'))
  await page.waitForFunction(() => /\.pitch\(\{ t: \[0\.7\], v: \[0\] \}, \{ voice: true \}\)$/.test(scriptText().trim()))
  await page.mouse.click(...await grab(up(1.3), 'ns-resize'))
  await page.waitForFunction(() => /\.pitch\(\{ t: \[0\.7, 1\.3\], v: \[0, 0\] \}, \{ voice: true \}\)$/.test(scriptText().trim()))
  const at = await grab(up(1), 'ns-resize')
  await page.mouse.click(...at)
  await page.waitForFunction(() => /\.pitch\(\{ t: \[0\.7, 1, 1\.3\], v: \[0, 0, 0\] \}, \{ voice: true \}\)$/.test(scriptText().trim()))
  const point = await grab(Array.from({ length: 9 }, (_, i) => [at[0], at[1] - 4 + i]), 'move')
  await heard()
  await page.mouse.move(...point)
  await page.mouse.down()
  const lh = tall(box)
  await page.mouse.move(point[0], point[1] - lh * Math.sqrt(1.5 / 12), { steps: 6 })
  await poll(() => page.locator('.hint').innerText(), hint => assert.match(hint, /^\+1st [3-6]\dct, A3([+−]\d+ct)? → /))
  await poll(heard, ({ peak }) => assert.ok(peak > .05, `heard as it goes: ${peak}`))
  await page.mouse.up()
  await page.waitForFunction(() => /\.pitch\(\{ t: \[0\.7, 1, 1\.3\], v: \[0, [1-9][\d.]*, 0\] \}, \{ voice: true \}\)$/.test(scriptText().trim()))
  // on the curve as it now is, a double-click takes it away; the two either side stay
  const raised = await grab(Array.from({ length: 40 }, (_, i) => [point[0], point[1] - 2 * i]), 'move')
  await page.mouse.dblclick(...raised)
  await page.waitForFunction(() => /\.pitch\(\{ t: \[0\.7, 1\.3\], v: \[0, 0\] \}, \{ voice: true \}\)$/.test(scriptText().trim()))
  // the curve dragged between them: every point by as much
  await drag(await grab(up(1), 'ns-resize'), [0, -lh / 3])
  await page.waitForFunction(() => { const m = scriptText().trim().match(/\.pitch\(\{ t: \[0\.7, 1\.3\], v: \[([1-9][\d.]*), ([1-9][\d.]*)\] \}, \{ voice: true \}\)$/); return m && m[1] === m[2] })
})

// The curve's bends as handles, as Praat's Manipulation shows its stylized pitch (PitchTier_stylize, 2 st): none in the
// script till one moves; dragged, a point of the line, the handles either side its anchors at 0, so only what is between
// them moves. A click on a selection's pitch tool shows the curve, the spectrogram framed on the voice
test('editor: the pitch curve\'s bends drag, bending the voice between the handles either side', async () => {
  await open()
  await noCues()
  // a voice swinging ±2.2 semitones about 200 Hz twice a second: highest at 0.5, 1 and 1.5 s (200 + 8π cos 4πt Hz)
  await write(`audio.from(t => 0.5 * Math.sin(2 * Math.PI * (200 * t + 2 * Math.sin(2 * Math.PI * 2 * t))), { duration: 2 })`)
  await lengthIs('0:02.000')
  // the pitch tool at the waveform lane's foot; the spectrogram it turns to fills the plot (lh)
  const { box, x } = await axis(2), lh = tall(box), pitch = tools(x, box, .5, 1.5).pitch
  await drag([x(.5), box.y + 80], [x(1.5) - x(.5), 0])
  await page.mouse.click(...await grab([pitch], 'ns-resize'))
  assert.equal(await shown(), 'Spectrogram')
  await page.keyboard.press('Escape')
  // a handle by the crest at 1 s (Praat's stylization keeps the points a straight line misses most, not the crests
  // themselves: here 0.95 s of a 10 ms track)
  const scan = Array.from({ length: 21 }, (_, k) => .9 + k / 100).flatMap(t => Array.from({ length: Math.floor(lh / 2) }, (_, i) => [x(t), box.y + lh - 2 * i]))
  const knot = await grab(scan, 'move')
  // a click alone changes nothing
  await page.mouse.click(...knot)
  await settled()
  assert.doesNotMatch(await code(), /\.pitch\(/)
  await drag(knot, [0, -lh * Math.sqrt(2 / 12)])
  await page.waitForFunction(() => /\.pitch\(\{ t: \[[\d.]+, [\d.]+, [\d.]+\], v: \[0, [\d.]+, 0\] \}, \{ voice: true \}\)$/.test(scriptText().trim()))
  const [, t, v] = (await code()).match(/t: \[([^\]]+)\], v: \[([^\]]+)\]/), ts = t.split(', ').map(Number), vs = v.split(', ').map(Number)
  assert.ok(Math.abs(ts[1] - 1) < .1 && ts[0] > .6 && ts[0] < ts[1] && ts[2] > ts[1] && ts[2] < 1.4, t)
  assert.ok(Math.abs(vs[1] - 2) < .2, v)
})

// Editing pitch is a mode, not a setting: one stored by an earlier page is not on when it opens
test('editor: pitch editing is off when the page opens', async () => {
  await page.addInitScript(code => localStorage.setItem('audio-repl', JSON.stringify({ code, pitch: true })), CHIME)
  await open()
  await page.locator('.menubar-item', { hasText: /^View$/ }).click()
  await menuRow('Show').click()
  assert.equal(await menuRow('Pitch curve').getAttribute('aria-checked'), 'false')
  await page.keyboard.press('Escape')
})

// The notes, as Melodyne shows them: a voice's notes as blobs on a piano's rows, a row a semitone, the axis naming them;
// a note pressed is selected, and dragged up two rows goes two semitones up (pitch() over it, a voice's)
test('editor: Notes shows a sound\'s notes, a row a semitone; a note dragged up two rows goes two semitones up', async () => {
  const { box, x } = await chime()
  await menu('View', 'Notes')
  // the chime's C4 to C5, two rows past them either way, two octaves at least: MIDI 54 to 78, 25 rows filling the lane
  const h = tall(box), row = h / 25, c4 = box.y + h - (60 - 54 + .5) * row
  const [px, py] = await grab([[x(.8), c4]], 'ns-resize')
  await drag([px, py], [0, -2 * row])
  await page.waitForFunction(() => /\.pitch\(2, \{ at: 0\.5\d*, d: 0\.5\d*, voice: true \}\)/.test(scriptText()))
})

// A notes lane's rows shaded as its keys, as a DAW's piano roll: the white keys and their rows the lighter (on a dark
// screen, the white rows lifted), the black keys and theirs the darker. G3 (55) white, G♯3 (56) black, under the
// chime's notes (C4 up): the lane's rows and the keys at their start
test('editor: a notes lane\'s rows are shaded as its keys, the white keys\' the lighter', async () => {
  const { box, x } = await chime()
  await menu('View', 'Notes')
  const h = tall(box), row = h / 25, y = m => Math.round(h - (m - 54 + .5) * row), key = Math.round(box.width - await gutter() - 21 + 4), lane = Math.round(x(4) - box.x)
  const lum = () => pixels(`return arg.map(([x, y]) => { const i = (y * w + x) * 4; return d[i] + d[i + 1] + d[i + 2] })`, [[lane, y(55)], [lane, y(56)], [key, y(55)], [key, y(56)]])
  await poll(lum, ([laneWhite, laneBlack, keyWhite, keyBlack]) => assert.ok(laneWhite > laneBlack && keyWhite > keyBlack, `white rows and keys the lighter: lane ${laneWhite} > ${laneBlack}, keys ${keyWhite} > ${keyBlack}`))
})

// A note sung apart (quiet either side) dragged moves whole, from its first cycle to its last: its pitch curve stepping in
// the quiet, half way into it (50 ms at most), not a range gliding in and out over the note's first and last 90 ms
test('editor: a note sung apart, dragged, steps in the quiet either side', async () => {
  await open()
  await noCues()
  await write(`audio.from(t => (t > .4 && t < .9 ? Math.sin(2 * Math.PI * 220 * t) : t > 1.3 && t < 1.8 ? Math.sin(2 * Math.PI * 330 * t) : 0) * .5, { duration: 2.2 })`)
  await lengthIs('0:02.200')
  await menu('View', 'Notes')
  // A3 (MIDI 57) and E4 (64), two rows past them either way, two octaves at least: MIDI 49 to 73, 25 rows
  const { box, x } = await axis(2.2), h = tall(box), row = h / 25, a3 = box.y + h - (57 - 49 + .5) * row
  const [px, py] = await grab([[x(.65), a3], [x(.65), a3 - row / 3], [x(.65), a3 + row / 3]], 'ns-resize')
  await drag([px, py], [0, -2 * row])
  await page.waitForFunction(() => /\.pitch\(\{ t: \[0\.3[5-9]\d*, 0\.3[5-9]\d*, 0\.9\d*, 0\.9\d*\], v: \[0, 2, 2, 0\] \}, \{ voice: true \}\)/.test(scriptText()))
  // dragged again a row, once its notes are found again (the keys about them: a row or two on): the same steps a
  // semitone higher, one call
  const steps = (await code()).match(/t: \[[^\]]+\]/)[0]
  const [qx, qy] = await grab(Array.from({ length: 13 }, (_, k) => [x(.65), a3 - 3 * row + k * row / 3]), 'ns-resize')
  await drag([qx, qy], [0, -row])
  await page.waitForFunction(() => /v: \[0, 3, 3, 0\]/.test(scriptText()))
  assert.equal((await code()).match(/\.pitch\(/g).length, 1, 'one call')
  assert.equal((await code()).match(/t: \[[^\]]+\]/)[0], steps, 'the same steps')
})

// A notes lane's keys zoom as the levels and the frequencies do: a pinch, or Ctrl and the wheel, on them, about the key
// under the pointer, which stays where it is; zoomed, the wheel scrolls them; 0 shows them all again
test('editor: a notes lane\'s keys zoom about the key under the pointer, a row then taller', async () => {
  const { box, x } = await chime()
  await menu('View', 'Notes')
  // 25 rows, MIDI 54 to 78 (as above); a notch of Ctrl and the wheel on the keys takes them to 25 × e^−0.4, C4 kept
  const h = tall(box), c4 = box.y + h - (60 - 54 + .5) * h / 25, row = h / (25 * Math.exp(-.4))
  await grab([[x(.8), c4]], 'ns-resize')
  await page.mouse.move(box.x + box.width - 20, c4)
  await page.keyboard.down('Control')
  await page.mouse.wheel(0, -100)
  await page.keyboard.up('Control')
  // the C4 where it was, two of its new rows up two semitones (three of the old)
  const [px, py] = await grab([[x(.8), c4]], 'ns-resize')
  await drag([px, py], [0, -2 * row])
  await page.waitForFunction(() => /\.pitch\(2, \{ at: 0\.5\d*, d: 0\.5\d*, voice: true \}\)/.test(scriptText()))
  // undone; zoomed, the wheel over the lane scrolls the keys, the C4 gone from where it was; 0 shows them as they were,
  // the C4 back
  await page.keyboard.press('ControlOrMeta+Z')
  await page.waitForFunction(() => !scriptText().includes('pitch('))
  await grab([[x(.8), c4]], 'ns-resize')
  await page.mouse.move(x(4), c4)
  for (let i = 0; i < 3; i++) await page.mouse.wheel(0, 100)
  await page.mouse.move(x(.8), c4)
  assert.notEqual(await page.locator('.plot').evaluate(el => el.style.cursor), 'ns-resize', 'scrolled, no note where the C4 was')
  await page.keyboard.press('0')
  await grab([[x(.8), c4]], 'ns-resize')
})

// The pitch tool: dragged up, by the square of how far, a few cents near where it was pressed, semitones further, 12 a
// picture's height away; the note it goes to said by it (a 220 Hz tone is A3, A4 being 440 Hz, ISO 16), the range heard
// as it will sound while it moves, from the first move on (the library's pitch(), a voice's), one pitch() step let go
test('editor: the pitch tool goes by cents near, semitones far, says the note it goes to and is heard as it goes', async () => {
  await page.addInitScript(tap)
  await open()
  await noCues()
  await write(`audio.from(t => 0.5 * Math.sin(2 * Math.PI * 220 * t), { duration: 2 })`)
  await lengthIs('0:02.000')
  await menu('View', 'Show', 'Pitch curve')
  await show('wave')
  // the waveform's tools inside its lane's foot; selected off its centre line, where the pitch line is
  const { box, x } = await axis(2), pitch = [tools(x, box, .5, 1.5).pitch[0], box.y + tall(box) - 8]
  await drag([x(.5), box.y + tall(box) * .3], [x(1.5) - x(.5), 0])
  const said = () => page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))).then(() => page.locator('.hint').innerText())
  for (const until = Date.now() + 8000; Date.now() < until; await page.waitForTimeout(200)) { await page.mouse.move(...pitch); if (/^Pitch A3/.test(await said())) break; await page.mouse.move(pitch[0] + 30, pitch[1] - 40) }
  assert.match(await said(), /^Pitch A3([+−][1-5]ct)?, by cents; a click hides the curve$/)
  // 12 semitones a lane's height away (view.js glide): st = 12 (dy / lh)²; the tool at the lane's foot, all of it over it
  const lh = tall(box), at = st => pitch[1] - lh * Math.sqrt(st / 12)
  await heard()
  await page.mouse.down()
  // pressed and moved a little: at 0, heard as it is
  await page.mouse.move(pitch[0], pitch[1] - 4)
  await poll(heard, h => assert.ok(h.peak > .05, 'at 0 semitones, heard as it is'))
  // a fifth of a semitone: cents alone
  await page.mouse.move(pitch[0], at(.2), { steps: 6 })
  await poll(said, t => assert.match(t, /^\+(1\d|2\d)ct, A3([+−][1-5]ct)? → A3\+\d+ct$/))
  await poll(heard, ({ peak }) => assert.ok(peak > .05, `heard as it goes: ${peak}`))
  // two and a half semitones, then most of the lane's height: ten and more
  // the words where it was pressed, the pointer hidden: only what they say changes
  const place = () => page.locator('.hint').evaluate(e => { const r = e.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.top)] })
  const was = await place()
  await page.mouse.move(pitch[0], at(2.5), { steps: 6 })
  assert.match(await said(), /^\+2st [3-6]\dct, A3/)
  await page.mouse.move(pitch[0], pitch[1] - lh * .95, { steps: 6 })
  assert.match(await said(), /^\+10st [6-9]\dct, /)
  assert.deepEqual(await place(), was, 'the words stay where it was pressed')
  await page.mouse.up()
  await page.waitForFunction(() => /\.pitch\(10\.\d\d?, \{ at: 0\.5, d: 1, voice: true \}\)$/.test(scriptText()))
})

// The tools beside it: a voice's intonation, its rises and falls wider up and flatter down (half a lane twice as wide,
// or a monotone), by 0.05; its formants, as the pitch tool its pitch. Each heard as it goes, from the first
// move, and one step over the selection; the same again over it sets the same step again
test('editor: the tools set a voice\'s intonation and its formants, heard as they go, a step each', async () => {
  await page.addInitScript(tap)
  await open()
  await noCues()
  // a voice whose pitch rises and falls, ±2 semitones about 200 Hz twice a second
  await write(`audio.from(t => 0.5 * Math.sin(2 * Math.PI * (200 * t + 2 * Math.sin(2 * Math.PI * 2 * t))), { duration: 2 })`)
  await lengthIs('0:02.000')
  await menu('View', 'Show', 'Pitch curve')
  const { box, x } = await axis(2), lh = tall(box), { intonation, formant } = tools(x, box, .5, 1.5), said = () => page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))).then(() => page.locator('.hint').innerText())
  await drag([x(.5), box.y + 80], [x(1.5) - x(.5), 0])
  await page.mouse.move(...intonation)
  assert.equal(await said(), 'Intonation, wider or flatter')
  await heard()
  await page.mouse.down()
  await page.mouse.move(intonation[0], intonation[1] - 4)
  await poll(heard, h => assert.ok(h.peak > .05, 'at ×1, heard as it is'))
  // down a quarter of the lane: half as wide
  await page.mouse.move(intonation[0], intonation[1] + lh / 4, { steps: 6 })
  await poll(said, t => assert.match(t, /^×0\.50, [\d.]+st → [\d.]+st wide$/))
  await poll(heard, h => assert.ok(h.peak > .05, 'heard as it goes'))
  await page.mouse.up()
  await page.waitForFunction(() => /\.intonation\(0\.5, \{ at: 0\.5, d: 1 \}\)$/.test(scriptText()))
  // and again: the same step, its factor times the one more
  await drag(await grab([intonation], 'ns-resize'), [0, lh / 4])
  await page.waitForFunction(() => /\.intonation\(0\.25, \{ at: 0\.5, d: 1 \}\)$/.test(scriptText()))
  assert.equal((await code()).match(/\.intonation\(/g).length, 1)
  // formants: up half the plot's height, 3 semitones, as the pitch tool goes (12 (dy / lh)²)
  await page.mouse.move(...await grab([formant], 'ns-resize'))
  assert.equal(await said(), 'Formants, by cents')
  await page.mouse.down()
  await page.mouse.move(formant[0], formant[1] - lh / 2, { steps: 6 })
  await poll(said, t => assert.match(t, /^formants \+(2st 9\dct|3st( [1-9]ct)?)$/))
  await poll(heard, h => assert.ok(h.peak > .05, 'heard as it goes'))
  await page.mouse.up()
  await page.waitForFunction(() => /\.formant\((2\.9\d?|3(\.0\d?)?), \{ at: 0\.5, d: 1 \}\)$/.test(scriptText()))
})

// In the pitch context (View > Pitch curve) the pitch line is edited as the gain line is, on its own scale (half a lane
// an octave): a press on its 0 makes a point, dragged up, to the cent; one pitch() curve, a voice's, set again in
// place; a double-click on a point takes it away, the last one the call
test('editor: the pitch line, in the pitch context, edits a pitch() curve as the gain line edits gain()', async () => {
  await open()
  await noCues()
  await write(`audio.from(t => 0.5 * Math.sin(2 * Math.PI * 220 * t), { d: 2 })`)
  await lengthIs('0:02.000')
  await menu('View', 'Show', 'Pitch curve')
  // the line on the waveform (the spectrogram, which the picture turns to, draws its points on the pitch curve)
  await show('wave')
  // its one lane, TRACK px tall
  const { box, x } = await axis(2), lh = tall(box), mid = box.y + lh / 2, st = lh / 2 / 12
  const near = v => page.waitForFunction(v => { const m = scriptText().trim().match(/\.pitch\(\{ t: \[1\], v: \[([\d.]+)\] \}, \{ voice: true \}\)$/); return m && Math.abs(m[1] - v) < .1 }, v)
  await drag(await grab([[x(1), mid]], 'ns-resize'), [0, -3 * st])
  await near(3)
  await drag(await grab([[x(1), mid - 3 * st]], 'move'), [0, -2 * st])
  await near(5)
  assert.equal((await code()).match(/\.pitch\(/g).length, 1)
  await page.mouse.dblclick(...await grab([[x(1), mid - 5 * st]], 'move'))
  await page.waitForFunction(() => !scriptText().includes('pitch('))
})
