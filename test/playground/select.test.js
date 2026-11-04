// The caret and the selection: clicks, drags, Shift, Alt and ⌘, the cues they go onto; the server, the page and the
// helpers in page.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { page, code, readout, tipOf, wholeLevels, seconds, open, settled, frames, poll, menuRow, settings, selected, menu, noCues, write, tall, gutter, spans, axis, grab, boxDrag, drag, lengthIs, hits, handles, pixels, show, shown, bursts, struck, keyed, chime, marked, pointed, measuredOnRow, crossed } from './page.js'

// The caret is where a drag leaves the selection's moving end, as a text's: dragged either way, the end let go; the
// clock reads it, and once the selection is gone it stays there; Play still plays the selection from its start.
// Double-clicked, at its start
test('editor: the caret is where a drag left the selection\'s moving end; double-clicked, at its start', async () => {
  await open()
  await noCues()
  const before = await seconds(), { box, x } = await axis(before), clock = () => page.locator('.time').innerText()
  // (the second begun off the caret the first left, whose line a press would drag)
  for (const [from, to] of [[.25, .5], [.6, .3]]) {
    await page.mouse.move(x(before * from), box.y + 100)
    await page.mouse.down()
    await page.mouse.move(x(before * to), box.y + 120, { steps: 5 })
    await page.mouse.up()
    const [start, end] = (await selected()).split('–'), head = to > from ? end : start
    assert.equal(await clock(), head, `dragged ${from} → ${to}: the caret at ${head}`)
    await page.keyboard.press('Escape')
    assert.equal(await selected(), '')
    assert.equal(await clock(), head, 'the selection gone, the caret stays')
  }
  await page.mouse.dblclick(x(before * .4), box.y + 100)
  const [start, end] = (await selected()).split('–')
  assert.ok(end, 'a double-click selects')
  assert.equal(await clock(), start, 'double-clicked: the caret at the start')
  // Shift and a click further on: out to it, the caret there
  await page.keyboard.down('Shift')
  await page.mouse.click(x(before * .8), box.y + 100)
  await page.keyboard.up('Shift')
  const [, to] = (await selected()).split('–')
  assert.equal(await clock(), to, 'Shift-clicked: the caret at the end it moved')
})

// Cues stay out of sight, a forest over the sound otherwise: held Alt, every one, faint, as Figma shows what there is to
// snap to; held ⌘ (Ctrl), only the one under the pointer, the one a press would take; away from them, none. Lit lines
// are orange runs along a row 4 px under the lanes' top.
test('editor: held Alt, every cue shows; held ⌘, only the one under the pointer', async () => {
  await open()
  await write(hits)
  await lengthIs('0:02.000')
  const { box, x } = await axis(2), y = box.y + 40
  const lit = async () => pixels(`let n = 0, run = false; for (let x = 0; x < w - ${await gutter()}; x++) { const i = (4 * w + x) * 4, on = d[i] - d[i + 2] > 60; if (on && !run) n++; run = on } return n`)
  const w = await spans(box)
  const cue = await poll(async () => (await handles()).map(px => px / w * 2).filter(t => Math.abs(t - 1) < .02), cue => assert.equal(cue.length, 1), 8000)
  assert.equal(await lit(), 0, 'none shown')
  await page.mouse.move(x(.75), y)
  await page.keyboard.down('Alt')
  const all = await lit()
  await page.keyboard.up('Alt')
  assert.ok(all >= 3, `held Alt: every one, ${all}`)
  await page.keyboard.down('ControlOrMeta')
  assert.equal(await lit(), 0, 'held ⌘ away from them: none')
  await page.mouse.move(x(cue[0]) + 1, y)
  assert.equal(await lit(), 1, 'the one under the pointer')
  await page.keyboard.up('ControlOrMeta')
})

// Zoomed out, the cues crowd: those shown none within 24 px of a plainer one, the main ones, as a map names its larger
// towns first; zoomed in, the rest come. A strike every 0.1 s for 60 s: 600, a few px apart across the view.
test('editor: zoomed out, only the plainer cues show, none within 24 px of another; zoomed in, all', async () => {
  await open()
  await write(`audio.from(t => Math.sin(2 * Math.PI * 440 * t) * Math.exp(-(t % 0.1) * 60) * (1 + (Math.floor(t / 0.1) % 5 === 0)), { duration: 60 })`)
  await lengthIs('1:00.000')
  // the cues drawn, held Alt, across the lanes (the meter after them left out), the pointer's own line at 30 px too, and
  // what it measures there (the strikes past full scale: a triangle at the lane's top, 7 px across)
  const box = await page.locator('.plot').boundingBox(), y = box.y + 40
  const runs = async () => (await pixels(`const out = []; let run = false; for (let x = 0; x < ${await spans(box)}; x++) { const i = (4 * w + x) * 4, on = d[i] - d[i + 2] > 40; if (on && !run) out.push(x); run = on } return out`)).filter(x => Math.abs(x - 30) > 5)
  await page.mouse.move(box.x + 30, y)
  const g = await gutter()
  await page.keyboard.down('Alt')
  // a minute's cues found on a slow runner in half a minute or so
  await poll(runs, shown => {
    const apart = Math.min(...shown.slice(1).map((x, i) => x - shown[i]))
    assert.ok(shown.length > 20 && shown.length < (box.width - g) / 24 + 2, `${shown.length} shown across ${Math.round(box.width)} px`)
    assert.ok(apart >= 23, `the closest ${apart} px apart`)
  }, 60000)
  await page.keyboard.up('Alt')
  // zoomed in five halvings, under 2 s across: each of its 18 or so strikes, tens of px apart
  await page.locator('.plot').focus()
  for (let i = 0; i < 5; i++) await page.keyboard.press('=')
  await page.mouse.move(box.x + 30, y)
  await page.keyboard.down('Alt')
  await poll(runs, near => assert.ok(near.length >= 15, `zoomed in: ${near.length}`))
  await page.keyboard.up('Alt')
})

// Held Alt, a press held still is the caret's all the same, dragged and heard, no caret added, every cue showing as Alt
// shows them while it goes; without Alt, the caret dragged onto a cue keeps its colour, a small triangle in the cues'
// colour at its top and its foot marking the snap
test('editor: held Alt, a press held takes the caret along, the cues showing; onto a cue, a cross where it meets the waveform', async () => {
  await page.route('**/playground/editor.js', async route => { const r = await route.fetch(); route.fulfill({ response: r, body: (await r.text()).replace('v = view(', 'v = globalThis.__view = view(') }) })
  await open()
  await write(hits)
  await lengthIs('0:02.000')
  const { box, x } = await axis(2), y = box.y + 40, w = await spans(box)
  // the runs of the cues' colour across the lanes' top row, [x, …] px
  const lit = async () => pixels(`const out = []; let run = false; for (let x = 0; x < ${w}; x++) { const i = (4 * w + x) * 4, on = d[i] - d[i + 2] > 60; if (on && !run) out.push(x); run = on } return out`)
  const cue = await poll(async () => (await handles()).map(px => px / w * 2).filter(t => Math.abs(t - 1) < .02), cue => assert.ok(cue.length, 'the cue at 1 s'), 8000)
  const clock = async () => +(await page.locator('.time').innerText()).split(':')[1]
  await page.mouse.move(x(.75), y)
  await page.keyboard.down('Alt')
  await page.mouse.down()
  // held still: the caret's (view.js HOLD)
  await page.waitForFunction(() => document.querySelector('.plot').style.cursor === 'ew-resize')
  await page.mouse.move(x(1.25), y, { steps: 6 })
  const shown = await lit()
  await page.mouse.up()
  await page.keyboard.up('Alt')
  assert.ok(shown.length >= 3, `held Alt, the caret dragged: every cue, ${shown}`)
  assert.equal(await selected(), '', 'nothing selected')
  assert.ok(Math.abs(await clock() - 1.25) < .03, `the caret where it was let go: ${await clock()}`)
  assert.equal(await page.evaluate(() => __view.carets.length), 1, 'no caret added')
  // without Alt, the caret dragged onto the cue at 1 s: a cross in the cues' colour where its line meets the waveform,
  // its line in its own colour (the rows with the cues' colour just before it, where no wash is: a cross's arms)
  await page.mouse.move(x(.75), y)
  await page.mouse.down()
  await page.waitForFunction(() => document.querySelector('.plot').style.cursor === 'ew-resize')
  await page.mouse.move(x(cue[0]) + 1, y, { steps: 6 })
  const px = Math.round(x(cue[0]) - box.x), lane = tall(box)
  await poll(() => pixels(`const orange = (x, y) => { const i = (y * w + x) * 4; return d[i] - d[i + 2] > 30 }, rows = []
    for (let y = 0; y < Math.round(arg.lane); y++) if ([-3, -2, -1].some(dx => orange(arg.px + dx, y))) rows.push(y)
    return { rows, line: [4, Math.round(arg.lane) - 4].some(y => !rows.includes(y) && orange(arg.px, y)) }`, { px, lane }), onto => assert.ok(onto.rows.length >= 3 && onto.rows.length <= 14 && !onto.line, `a cross or two where it meets the waveform, its line its own colour: ${JSON.stringify(onto)}`))
  await page.mouse.up()
  assert.ok(Math.abs(await clock() - cue[0]) < 2e-3, `the caret on the cue: ${await clock()}`)
})

// A range begun within a few px of a cue starts on it, as the pointer's time said it would; its end dragged onto one is
// the caret's line there (the caret at the end a drag moves), the crosses where it meets the waveform saying it snapped
test('editor: a range begun by a cue starts on it; its end dragged onto one, the caret\'s line there', async () => {
  await open()
  await write(hits)
  await lengthIs('0:02.000')
  const { box, x } = await axis(2), y = box.y + 40, w = await spans(box)
  const cues = await poll(async () => (await handles()).map(px => px / w * 2), cues => assert.ok(cues.some(t => Math.abs(t - 1) < .02), `the cue at 1 s: ${cues}`), 8000)
  const a = cues.find(t => Math.abs(t - .5) < .02), b = cues.find(t => Math.abs(t - 1) < .02)
  // white down the lane's top rows, over the sound's quiet edge, at a column (or a pixel either side): how many of rows
  // 6 to 16
  const white = px => pixels(`let most = 0; for (let x = arg - 1; x <= arg + 1; x++) { let n = 0; for (let y = 6; y < 16; y++) { const i = (y * w + x) * 4; if (d[i] > 150 && d[i + 2] > 150 && Math.abs(d[i] - d[i + 2]) < 30) n++ } most = Math.max(most, n) } return most`, Math.round(px - box.x))
  await page.mouse.move(x(a) + 2, y)
  await page.mouse.down()
  await page.mouse.move(x(b) - 2, y, { steps: 6 })
  const line = await poll(() => white(x(b)), line => assert.ok(line >= 8, `the end on the cue, a line there: ${line} of 10 rows`), 2000)
  const off = await white(x(b) - 6)
  await page.mouse.up()
  assert.ok(line >= 8 && off < 3, `the end on the cue, a line there: ${line} of 10 rows, beside it ${off}`)
  const [from, to] = (await selected()).split('–').map(t => +t.split(':')[1])
  assert.ok(Math.abs(from - a) < .002 && Math.abs(to - b) < .002, `from the cue to the cue: ${from}–${to}, the cues ${a}, ${b}`)
})

// What a drag went onto: a marker by its name, a range's end by its name and end, as Figma names what an object snapped
// to, a cross over its triangle in the strip; a cue, nothing said, a faint wash fading from it to the side its sound is
// on (here a tone struck every half second, gone quiet between: each strike where a sound starts, after it; where it has
// faded under the pauses' level, before)
test('editor: a caret dragged onto a cue or a marker says what it went onto', async () => {
  await open()
  await write(hits + `\n  .mark(0.75, 'Intro')\n  .mark({ at: 1.6, d: 0.2 }, 'Coda')`)
  await lengthIs('0:02.000')
  const { box, x } = await axis(2), y = box.y + 40, w = await spans(box)
  const cues = await poll(async () => (await handles()).map(px => px / w * 2), cues => assert.ok(cues.some(t => Math.abs(t - 1) < .02), `the cue at 1 s: ${cues}`), 8000)
  const start = cues.find(t => Math.abs(t - 1) < .02), end = cues.find(t => t > 1.1 && t < 1.45)
  const said = () => page.locator('.hint').evaluate(e => e.hidden ? '' : e.textContent)
  // the cues' colour 5 px either side of the line (its wash WASH, 8 px), half way down the lane: [before, after]
  const washed = t => pixels(`const orange = x => { const i = (arg.y * w + x) * 4; return d[i] - d[i + 2] > 12 }; return [orange(arg.px - 5), orange(arg.px + 5)]`, { px: Math.round(x(t) - box.x), y: Math.round(tall(box) / 2) })
  // the cues' colour by the line, its own column left out, in the 7 px square about the line's foot, over the strip's
  // triangles
  const crossed = t => pixels(`let n = 0; for (let y = arg.y - 3; y <= arg.y + 3; y++) for (let x = arg.px - 3; x <= arg.px + 3; x++) { const i = (y * w + x) * 4; if (x !== arg.px && d[i] - d[i + 2] > 30) n++ } return n`, { px: Math.round(x(t) - box.x), y: Math.round(tall(box)) - 1 })
  for (const [t, words, wash] of [[start, '', [false, true]], [end, '', [true, false]], [.75, 'Intro'], [1.8, 'Coda end']]) {
    await page.mouse.move(x(.25), y)
    await page.mouse.down()
    // held, the press is the caret's: dragged, it goes along
    await page.waitForFunction(() => document.querySelector('.plot').style.cursor === 'ew-resize')
    await page.mouse.move(x(t) + 1, y, { steps: 6 })
    await frames()
    await poll(said, s => assert.equal(s, words, `onto ${t}`))
    if (wash) await poll(() => washed(t), w => assert.deepEqual(w, wash, `onto ${t}, the wash on the sound's side`))
    if (words) await poll(() => crossed(t), n => assert.ok(n >= 4, `onto ${t}, a cross on the line's foot, over its triangle: ${n}`))
    await page.mouse.up()
  }
  // let go and moved off it, nothing said
  await page.mouse.move(x(1.75), box.y + 40)
  await poll(said, s => assert.equal(s, ''))
})

// A marker by a cue is one snap with it, the marker's: the caret dragged there goes onto the marker's time, a cross over
// its triangle on the line's foot and where the line meets the waveform, as onto the cue
test('editor: a caret dragged onto a marker by a cue snaps once, a cross at each', async () => {
  await open()
  await write(hits + `\n  .mark({ at: 1, d: 0.2 }, 'Hit')`)
  await lengthIs('0:02.000')
  const { box, x } = await axis(2), y = box.y + 40, w = await spans(box), lane = Math.round(tall(box))
  const cues = await poll(async () => (await handles()).map(px => px / w * 2), cues => assert.ok(cues.some(t => Math.abs(t - 1) < .02), `the cue at 1 s: ${cues}`), 8000)
  const cue = cues.find(t => Math.abs(t - 1) < .02)
  await page.mouse.move(x(.25), y)
  await page.mouse.down()
  await page.waitForFunction(() => document.querySelector('.plot').style.cursor === 'ew-resize')
  await page.mouse.move(x(cue) + 1, y, { steps: 6 })
  // the cues' colour just before the line (no wash there: the strike's sound is after it), about its foot and up the lane
  await poll(() => pixels(`const orange = (x, y) => { const i = (y * w + x) * 4; return d[i] - d[i + 2] > 30 }; let foot = 0, up = 0
    for (let y = 0; y <= arg.lane + 2; y++) for (let x = arg.px - 3; x < arg.px; x++) if (orange(x, y)) y >= arg.lane - 4 ? foot++ : up++
    return { foot, up }`, { px: Math.round(x(1) - box.x), lane }), marks => assert.ok(marks.foot >= 2 && marks.up >= 2, `a cross on its foot and where it meets the waveform: ${JSON.stringify(marks)}`))
  await page.mouse.up()
  assert.equal(await page.locator('.time').innerText(), '0:01.000', 'the marker\'s time')
})

// A drag that snaps shows where it would: the caret held and dragged, or a range's edge, the cues either side of it
// faint; held Alt, every one, the edge's drag too; pressed with Alt on a range's edge, the edge, as the caret held with
// Alt is the caret, no range added
test('editor: dragged, the caret or an edge shows the cues either side of it; with Alt every one, an edge pressed with Alt its own', async () => {
  await open()
  await write(hits)
  await lengthIs('0:02.000')
  const { box, x } = await axis(2), y = box.y + 40, w = await spans(box)
  const lit = async () => pixels(`const out = []; let run = false; for (let x = 0; x < ${w}; x++) { const i = (4 * w + x) * 4, on = d[i] - d[i + 2] > 30; if (on && !run) out.push(x); run = on } return out`)
  const cues = await poll(async () => (await handles()).map(px => px / w * 2), cues => assert.ok(cues.length >= 5, `its cues: ${cues}`), 8000)
  // the caret held at 0.7 s, between the cues at 0.5 s and where that hit falls quiet, a third of a second on
  const [before, after] = [cues.findLast(t => t < .7), cues.find(t => t > .7)]
  await page.mouse.move(x(.65), y)
  await page.mouse.down()
  await page.waitForFunction(() => document.querySelector('.plot').style.cursor === 'ew-resize')
  await page.mouse.move(x(.7), y, { steps: 3 })
  const beside = await lit()
  await page.mouse.up()
  const near = (px, t) => Math.abs(px - (x(t) - box.x)) < 2
  assert.ok(beside.length === 2 && near(beside[0], before) && near(beside[1], after), `the cues either side, at ${before} and ${after} s: ${beside}`)
  // a range's edge pressed with Alt, dragged: the edge's own drag, every cue showing
  await drag([x(.6), y], [x(1.2) - x(.6), 0])
  await page.keyboard.down('Alt')
  await page.mouse.move(x(1.2), y)
  await page.mouse.down()
  await page.mouse.move(x(1.4), y, { steps: 4 })
  const all = await lit()
  await page.mouse.up()
  await page.keyboard.up('Alt')
  assert.ok(all.length >= 5, `held Alt, every cue: ${all}`)
  assert.match(await selected(), /^0:00\.\d+–0:01\.[34]\d+$/, 'its end dragged, no range added')
})

// Shift and a double-click extend what is selected to the fragment clicked, as Shift and a double-click extend a text's
// selection by words: before it or after it, what was selected staying in it; from the caret, the caret to it. Shift and
// a drag, held before the press or after it, show the cues either side of the end it moves, as an edge's drag does
test('editor: Shift and a double-click extend the selection to the fragment; Shift and a drag shows the cues either side', async () => {
  await open()
  await write(bursts)
  await lengthIs('0:02.500')
  const { box, x } = await axis(2.5), y = box.y + tall(box) / 3, w = await spans(box)
  const range = async () => (await selected()).split('–').map(t => +t.split(':')[1])
  const near = ([a, b], [p, q]) => Math.abs(a - p) < .03 && Math.abs(b - q) < .03
  await poll(async () => (await handles()).map(h => h / w * 2.5), at => assert.ok(at.length >= 7, `its cues: ${at}`), 8000)
  await page.mouse.dblclick(x(.7), y)
  assert.ok(near(await range(), [.5, .9]), String(await range()))
  await keyed(['Shift'], () => page.mouse.dblclick(x(1.7), y))
  assert.ok(near(await range(), [.5, 1.9]), `after it: ${await range()}`)
  await keyed(['Shift'], () => page.mouse.dblclick(x(.2), y))
  assert.ok(near(await range(), [0, 1.9]), `before it, what was selected staying: ${await range()}`)
  await page.mouse.click(x(1.2), y)
  await keyed(['Shift'], () => page.mouse.dblclick(x(2.2), y))
  assert.ok(near(await range(), [1.2, 2.4]), `from the caret: ${await range()}`)
  // Shift held, a drag from the caret: the cues either side of where its end is
  await page.mouse.click(x(.2), y)
  const lit = async () => pixels(`const out = []; let run = false; for (let x = 0; x < ${w}; x++) { const i = (4 * w + x) * 4, on = d[i] - d[i + 2] > 30; if (on && !run) out.push(x); run = on } return out`)
  await page.keyboard.down('Shift')
  await page.mouse.move(x(1.1), y)
  await page.mouse.down()
  await page.mouse.move(x(1.2), y, { steps: 3 })
  const beside = await lit()
  await page.mouse.up()
  await page.keyboard.up('Shift')
  const edge = t => beside.some(px => Math.abs(px - (x(t) - box.x)) < 3)
  assert.ok(beside.length === 2 && edge(.9) && edge(1.5), `the cues either side of 1.2 s, where the pause before is: ${beside}`)
})

// The third click of a triple-click, where the double one was, is a click: dragged a little on its way, never the audio
// the double-click selected, which a press inside a selection otherwise carries
test('editor: a triple-click\'s third press, nudged, moves no audio', async () => {
  await open()
  await noCues()
  await write(bursts)
  await lengthIs('0:02.500')
  const { box, x } = await axis(2.5), y = box.y + tall(box) / 3
  await page.mouse.dblclick(x(.7), y)
  assert.notEqual(await selected(), '', 'the burst selected')
  const before = await code()
  await page.mouse.down()
  await page.mouse.move(x(.7) + 20, y, { steps: 4 })
  await page.mouse.up()
  await settled()
  assert.equal(await code(), before, 'no audio moved')
})

// A sound's cues, however quiet it is beside a loud one, at any zoom, but none of the ground's: strikes every second, the
// first 0.5 high, the next two 0.03 (a noise that is a sound), the last 0.01 (within 0.02 of zero, the ground)
test('editor: a quiet sound has its cues by a loud one; within 0.02 of zero, none', async () => {
  await open()
  await write(`audio.from(t => Math.sin(2 * Math.PI * 440 * t) * Math.exp(-(t % 1) * 20) * (t < 1 ? 0 : t < 2 ? .5 : t < 4 ? .03 : .01), { duration: 5 })`)
  await lengthIs('0:05.000')
  const w = await spans(await page.locator('.plot').boundingBox()), near = (at, t) => at.some(s => Math.abs(s - t) < .03)
  const at = await poll(async () => (await handles()).map(h => h / w * 5), at => assert.ok(near(at, 1) && near(at, 3), `the loud strike's and the quiet ones': ${at}`), 8000)
  assert.ok(near(at, 1) && near(at, 2) && near(at, 3), `the loud strike's and the quiet ones': ${at}`)
  assert.deepEqual(at.filter(t => t > 3.9), [], `none of the ground's: ${at}`)
})

// The ground is no sound: between two bursts, blips of a tone 0.006 high, 100 ms on and off, within 0.02 of zero, where
// the pauses are read (once over their level, an edge each); none of them a cue, the bursts' own edges staying
test('editor: blips of the ground between two sounds make no cues; the sounds\' edges stay', async () => {
  await open()
  await write(`audio.from(t => t > .2 && t < .6 || t > 2.4 && t < 2.8 ? .5 * Math.sin(2 * Math.PI * 440 * t) : t > .6 && t < 2.4 && Math.floor(t * 10) % 2 ? .006 * Math.sin(2 * Math.PI * 1000 * t) : 0, { duration: 3 })`)
  await lengthIs('0:03.000')
  const w = await spans(await page.locator('.plot').boundingBox()), near = (at, t) => at.some(s => Math.abs(s - t) < .03)
  const at = await poll(async () => (await handles()).map(h => h / w * 3), at => assert.ok(near(at, .6) && near(at, 2.4), `the bursts' edges: ${at}`), 8000)
  assert.deepEqual(at.filter(t => t > .65 && t < 2.35), [], 'none in the blips between')
})

test('editor: a box on the spectrogram selects a band, plays it alone, and Delete writes spectral() for it', async () => {
  await open()
  await noCues()
  await write(hits)
  await lengthIs('0:02.000')
  await show('spec')
  const { box, x } = await axis(2)
  // a drag there selects time, as on the waveform
  await drag([x(.5), box.y + tall(box) * .3], [x(1) - x(.5), box.height * .2])
  assert.match(await selected(), /^0:00\.50\d–0:01\.00\d$/)
  assert.doesNotMatch(await readout(), /Hz/)
  await page.keyboard.press('Escape')
  await boxDrag([x(.5), box.y + tall(box) * .3], [x(1) - x(.5), box.height * .2])
  // the palette offers what a band takes first
  await page.keyboard.press('ControlOrMeta+K')
  assert.equal(await page.locator('.palette-group').first().innerText(), 'For the band')
  assert.deepEqual((await page.locator('.palette-list .tool strong').allInnerTexts()).slice(0, 4), ['Remove this band', 'This band 6 dB quieter', 'This band 6 dB louder', 'Rebuild this band from its surroundings'])
  await page.keyboard.press('Escape')
  assert.match(await selected(), /^0:00\.50\d–0:01\.00\d$/)
  assert.match(await readout(), /^[\d.]+k?Hz–[\d.]+k?Hz$/)
  assert.match(await page.locator('button.play').evaluate(tipOf), /^Play the band/)
  // the waveform shows no band: the time range stays, the band goes
  await show('wave')
  assert.doesNotMatch(await readout(), /Hz/)
  assert.match(await page.locator('button.play').evaluate(tipOf), /^Play the selection/)
  // the spectrogram again, its frequencies on another scale from its dropdown (mel), then on octaves again
  await show('spec')
  await settings('Frequency scale', 'Mel')
  assert.equal(await shown(), 'Spectrogram')
  assert.equal(await page.locator('.plot').getAttribute('data-scale'), 'mel')
  await settings('Frequency scale', 'Octaves')
  assert.equal(await page.locator('.plot').getAttribute('data-scale'), 'log')
  await page.keyboard.press('Escape')
  await boxDrag([x(.5), box.y + tall(box) * .3], [x(1) - x(.5), box.height * .2])
  await page.keyboard.press('Delete')
  await page.waitForFunction(() => /\.spectral\(/.test(scriptText()))
  const [, lo, hi, at, duration] = (await code()).match(/\.spectral\(\[([\d.]+), ([\d.]+)\], \{ at: ([\d.]+), d: ([\d.]+) \}\)/).map(Number)
  assert.ok(30 < lo && lo < hi && hi < 22050, `${lo} ${hi}`)
  assert.ok(Math.abs(at - .5) < .01 && Math.abs(at + duration - 1) < .01, `${at} ${duration}`)
  // near a mark on the frequency axis, an edge takes its value: 2 kHz and 500 Hz on the log axis, 20 Hz to Nyquist
  const lane = tall(box), fy = f => box.y + lane - Math.log2(f / 20) / Math.log2(22050 / 20) * lane
  await page.mouse.click(x(1.9), box.y + 20)
  await boxDrag([x(1.2), fy(2000) + 3], [x(1.6) - x(1.2), fy(500) - fy(2000) - 5])
  await page.keyboard.press('Delete')
  await page.waitForFunction(() => /\.spectral\(\[500, 2000\]/.test(scriptText()))
})

// ⌘ pressed partway through a range dragged on the spectrogram makes it a box from where the drag began, at once, before
// the pointer moves again: its band from the press's height to the pointer's, heard alone as it goes
test('editor: ⌘ pressed while a range is dragged on the spectrogram makes it a box', async () => {
  await open()
  await noCues()
  await write(hits)
  await lengthIs('0:02.000')
  await show('spec')
  const { box, x } = await axis(2), lane = tall(box)
  await page.mouse.move(x(.25), box.y + lane * .3)
  await page.mouse.down()
  await page.mouse.move(x(.5), box.y + lane * .5, { steps: 4 })
  assert.doesNotMatch(await readout(), /Hz/)
  await page.keyboard.down('ControlOrMeta')
  await page.waitForFunction(() => /Hz–[\d.]+k?Hz$/.test(document.querySelector('.readout').textContent))
  await page.mouse.move(x(.75), box.y + lane * .6, { steps: 4 })
  await page.mouse.up()
  await page.keyboard.up('ControlOrMeta')
  assert.match(await selected(), /^0:00\.25\d–0:00\.75\d$/)
  const [lo, hi] = (await readout()).match(/[\d.]+k?Hz/g).map(v => parseFloat(v) * (v.includes('k') ? 1000 : 1))
  // 30% to 60% down the log axis, 20 Hz to 22.05 kHz: 20 · 1102.5^0.7 ≈ 2.7 kHz down to 20 · 1102.5^0.4 ≈ 330 Hz
  assert.ok(lo > 250 && lo < 450 && hi > 2000 && hi < 3500, `${lo}–${hi}`)
  assert.match(await page.locator('button.play').evaluate(tipOf), /^Play the band/)
})

// Several boxes, as Photoshop's several selections: Alt and a drag adds another; Play plays each band over its time,
// Delete takes each out, one step, and the caret runs through the band alone
test('editor: Alt and a drag on the spectrogram adds another box; Delete takes every box out at once', async () => {
  await open()
  await noCues()
  await write(`audio('chime.wav')`)
  await lengthIs('0:08.000')
  await show('spec')
  const { box, x } = await axis(8), lane = tall(box)
  await boxDrag([x(1), box.y + lane * .2], [x(2) - x(1), lane * .1])
  // Shift pressed and let go on the way loses none
  await page.keyboard.down('Alt')
  await page.mouse.move(x(4), box.y + lane * .6)
  await page.mouse.down()
  await page.mouse.move(x(4.5), box.y + lane * .65, { steps: 3 })
  await page.keyboard.down('Shift')
  await page.mouse.move(x(4.7), box.y + lane * .67, { steps: 2 })
  await page.keyboard.up('Shift')
  await page.mouse.move(x(5), box.y + lane * .7, { steps: 3 })
  await page.mouse.up()
  await page.keyboard.up('Alt')
  assert.equal(await readout(), '2 bands')
  assert.match(await page.locator('button.play').evaluate(tipOf), /^Play the bands/)
  await page.keyboard.press('ControlOrMeta+K')
  assert.equal(await page.locator('.palette-group').first().innerText(), 'For the 2 bands')
  await page.keyboard.press('Escape')
  // a method from the context menu, for each box's time: the clicks in each taken out
  await page.mouse.click(x(1.5), box.y + lane * .25, { button: 'right' })
  await menuRow('Process').click()
  await menuRow('Repair').click()
  await menuRow('Remove the clicks in each').click()
  await page.waitForFunction(() => (scriptText().match(/\.declick\(\{ at: [\d.]+, d: [\d.]+ \}\)/g) || []).length === 2)
  const clicks = [...(await code()).matchAll(/\.declick\(\{ at: ([\d.]+), d: ([\d.]+) \}\)/g)].map(m => +m[1]).sort((p, q) => p - q)
  assert.ok(Math.abs(clicks[0] - 1) < .02 && Math.abs(clicks[1] - 4) < .02, JSON.stringify(clicks))
  assert.equal(await readout(), '2 bands', 'the boxes stay')
  await page.locator('.plot').focus()
  await page.keyboard.press('Delete')
  await page.waitForFunction(() => (scriptText().match(/\.spectral\(\[\d+, \d+\], \{ at: [\d.]+, d: [\d.]+ \}\)/g) || []).length === 2)
  const calls = [...(await code()).matchAll(/\.spectral\(\[(\d+), (\d+)\], \{ at: ([\d.]+), d: ([\d.]+) \}\)/g)].map(m => m.slice(1).map(Number))
  assert.ok(Math.abs(calls[0][2] - 1) < .02 && Math.abs(calls[1][2] - 4) < .02 && calls.every(([lo, hi]) => lo < hi), JSON.stringify(calls))
  assert.equal(await page.locator('.message.problem').count(), 0)
})

// Inside a selection the caret's line drags as it does without one, the selection kept; where a selection puts it, on
// its start, the edge takes the press; only clicked, it is a click: the caret there alone
test('editor: inside a selection the caret drags, the selection kept; on the selection\'s edge, the edge drags', async () => {
  await open()
  const { box, x } = await axis(6.525), row = box.y + box.height - 8, lane = box.y + tall(box) / 2
  const drag = async (a, b) => { await page.mouse.move(x(a), lane); await page.mouse.down(); for (let i = 1; i <= 8; i++) await page.mouse.move(x(a + (b - a) * i / 8), lane); await page.mouse.up() }
  const caret = async () => { const [m, s] = (await page.locator('.time').innerText()).split(':'); return +m * 60 + +s }
  await drag(1, 3)
  const range = await selected()
  assert.ok(range, 'a range selected')
  // the time row moves the caret alone, into the range
  await page.mouse.click(x(2), row)
  assert.ok(Math.abs(await caret() - 2) < .06, `caret at 2s: ${await caret()}`)
  assert.equal(await selected(), range)
  // its line there dragged: the caret goes, the range stays as it was
  await drag(2, 2.5)
  assert.ok(Math.abs(await caret() - 2.5) < .06, `caret dragged to 2.5s: ${await caret()}`)
  assert.equal(await selected(), range)
  // the range's end, the caret on it once a range is made again (where the drag left it): the edge's, the range longer,
  // no caret dragged off it
  await page.mouse.click(x(5), lane)
  await drag(1, 3)
  const made = await selected(), end = await caret()
  await drag(end, end + .4)
  const [a, b] = (await selected()).split('–'), at = t => t.split(':').reduce((m, s) => m * 60 + +s, 0)
  assert.ok(Math.abs(at(b) - end - .4) < .06 && at(a) === at(made.split('–')[0]), `the end dragged: ${made} → ${a}–${b}`)
  // a click on the caret's line inside the range, no drag: the caret there alone
  await page.mouse.click(x(2), row)
  await page.mouse.click(x(2), lane)
  assert.equal(await selected(), '')
})

// Their cues are the pauses' edges, each burst's start and end, as a text's words are found.
// A bell's ring is its strike's till it falls within 0.02 of zero, where it ends, and a double-click on its tail takes it
// from its strike to there: no tail hanging on over the quiet to the next. The page's chime rings from its fourth strike
// (1.81 s once trimmed) down into the quiet before its fifth (3.31 s), 60 ms of it at least.
test('editor: a double-click on a ringing tail selects from its strike to where it falls quiet', async () => {
  await open()
  const { box, x } = await axis(6.525), seconds = t => t.split(':').reduce((m, s) => m * 60 + +s, 0)
  let range = []
  for (const until = Date.now() + 8000; Date.now() < until && !(range[1] < 6); await page.waitForTimeout(200)) {
    await page.mouse.dblclick(x(2.8), box.y + tall(box) * .3)
    range = (await selected()).split('–').map(seconds)
  }
  assert.ok(Math.abs(range[0] - 1.81) < .02 && range[1] > 3 && range[1] < 3.25, range.join('–'))
})

test('editor: a double-click selects the fragment between its cues, or the pause it is in; a triple-click the sound between its pauses; ⌥ and ⌘ arrows step by them', async () => {
  await open()
  await write(bursts)
  await lengthIs('0:02.500')
  const { box, x } = await axis(2.5), y = box.y + tall(box) / 3
  const range = async () => (await selected()).split('–').map(t => +t.split(':')[1])
  const near =([a, b], [p, q]) => Math.abs(a - p) < .03 && Math.abs(b - q) < .03
  // its cues, each burst's start (where its attack starts) and end (where the quiet begins, within a block)
  // (the chime's stay until the new output's come)
  const edges = [.4, .5, .9, 1.5, 1.9, 2, 2.4], found = at => at.length === edges.length && at.every((t, i) => t - edges[i] > -.005 && t - edges[i] < .03)
  const w = await spans(box)
  const at = await poll(async () => (await handles()).map(h => h / w * 2.5), at => assert.ok(found(at), JSON.stringify(at)), 8000)
  // the sound alone, from its start to its end, as a word between its spaces
  await page.mouse.dblclick(x(.2), y)
  assert.ok(near(await range(), [0, .4]), String(await range()))
  await page.mouse.dblclick(x(1.7), y)
  assert.ok(near(await range(), [1.5, 1.9]), String(await range()))
  // the sound between its pauses: here, where the cues are the pauses' edges, the same
  await page.mouse.click(x(.6), y, { clickCount: 3 })
  assert.ok(near(await range(), [.5, .9]), String(await range()))
  // in a pause, the pause
  await page.mouse.dblclick(x(1.2), y)
  assert.ok(near(await range(), [.9, 1.5]), String(await range()))
  await page.mouse.click(x(.1), y)
  const step = async key => { await page.keyboard.press(key); return +(await page.locator('.time').innerText()).split(':')[1] }
  const mac = process.platform === 'darwin'
  assert.ok(Math.abs(await step(mac ? 'Alt+ArrowRight' : 'Control+ArrowRight') - .4) < .03, 'to the next cue, the end of the sound')
  assert.ok(Math.abs(await step(mac ? 'Alt+ArrowRight' : 'Control+ArrowRight') - .5) < .03, 'over the pause, to the start of the next')
  assert.ok(Math.abs(await step(mac ? 'Meta+ArrowRight' : 'Control+ArrowDown') - .9) < .03, 'to the end of the sound')
  assert.ok(Math.abs(await step(mac ? 'Meta+ArrowRight' : 'Control+ArrowDown') - 1.5) < .03, 'over the pause, to the next sound')
  const back = await step(mac ? 'Meta+ArrowLeft' : 'Control+ArrowUp')
  assert.ok(Math.abs(back - .9) < .03, `back to the end of the sound before (${back})`)
  // to the end and the start, as a text's ⌘ ↓ ↑ (Home and End anywhere)
  assert.equal(await step(mac ? 'Meta+ArrowDown' : 'End'), 2.5)
  assert.equal(await step(mac ? 'Meta+ArrowUp' : 'Home'), 0)
  // the long pause deleted: the cues after it move back with the audio at once, never where they were a moment before,
  // whether its output has come or not (the times the caret steps to, the sound's end not one of them)
  await page.mouse.dblclick(x(1.2), y)
  const [p, q] = await range()
  await page.keyboard.press('Delete')
  const moved = [], now = async () => +(await page.locator('.time').innerText()).split(':')[1]
  await page.keyboard.press('Home')
  for (let t = 0; ;) { await page.keyboard.press(mac ? 'Alt+ArrowRight' : 'Control+ArrowRight'); const next = await now(); if (next <= t || next > 2.5 - (q - p) - .03) break; moved.push(t = next) }
  const after = at.filter(t => t > q + .01)
  assert.ok(!moved.some(t => after.some(e => Math.abs(t - e) < .01)), `none left behind: ${JSON.stringify(moved)}`)
  // (the caret steps over two cues within 3 px as one: the pause's end, moved 12 ms after the sound's end before it)
  assert.ok(after.every(e => moved.some(t => Math.abs(t - (e - (q - p))) < .015)), JSON.stringify([moved, after, p, q]))
})

test('editor: on strikes with no pause between them, a double-click takes one strike to the next, a triple-click the whole sound', async () => {
  await open()
  await write(struck)
  await lengthIs('0:02.000')
  const { box, x } = await axis(2), y = box.y + tall(box) / 3
  const range = async () => (await selected()).split('–').map(t => +t.split(':')[1])
  let r = []
  for (const until = Date.now() + 8000; Date.now() < until && !(Math.abs(r[0] - .5) < .02 && Math.abs(r[1] - 1) < .02); await page.waitForTimeout(200)) {
    await page.mouse.dblclick(x(.7), y)
    r = await range()
  }
  assert.ok(Math.abs(r[0] - .5) < .02 && Math.abs(r[1] - 1) < .02, `one strike to the next: ${r}`)
  await page.mouse.click(x(.7), y, { clickCount: 3 })
  assert.deepEqual(await range(), [0, 2], 'the whole sound')
})

// A dragged edge, or the caret, goes onto a cue it comes within 3 px of, as Figma's objects snap; one short of it, or 5 px
// past it, stays
test('editor: a selection\'s dragged edge, or the caret, snaps to a cue near it', async () => {
  await open()
  await write(hits)
  await lengthIs('0:02.000')
  const { box, x } = await axis(2), y = box.y + tall(box) * .3
  const cues = await poll(handles, cues => assert.ok(cues.length >= 3, `its cues found: ${cues}`), 8000)
  const at = cues.find(h => Math.abs(h - (x(1) - box.x)) < 20)
  await drag([x(.7), y], [box.x + at + 2 - x(.7), 0])
  const end = +(await selected()).split('–')[1].split(':')[1]
  assert.ok(Math.abs(end - 1) < .012, `on the cue at 1 s, where the hit starts: ${end}`)
  await page.mouse.click(x(1.8), y)
  await drag([x(.7), y], [box.x + at + 5 - x(.7), 0])
  const past = +(await selected()).split('–')[1].split(':')[1]
  assert.ok(past - end > .005, `5 px past it, where it was put: ${past}, the cue ${end}`)
  await page.mouse.click(x(1.8), y)
  await drag([x(.3), y], [x(.45) - x(.3), 0])
  assert.match(await selected(), /^0:00\.30\d–0:00\.45\d$/)
  // the caret, pressed on the time row two pixels after a cue, goes onto it (with nothing selected, the clock is
  // the caret's)
  await page.keyboard.press('Escape')
  await page.mouse.click(box.x + at + 2, box.y + box.height - 8)
  const caret = +(await page.locator('.time').innerText()).split(':')[1]
  assert.ok(Math.abs(caret - end) < 1e-3, `the caret on the hit: ${caret}, the edge was ${end}`)
  // the cues hidden, an edge still goes onto them
  await menu('View', 'Show', 'Cues')
  await page.mouse.click(x(1.8), y)
  await drag([x(.7), y], [box.x + at + 2 - x(.7), 0])
  assert.ok(Math.abs(+(await selected()).split('–')[1].split(':')[1] - end) < .012, 'snapped, hidden')
})

// A dragged edge goes onto a marked range's ends, and onto the ends of the place takes went in, as onto a marker
test('editor: a selection\'s dragged edge snaps to a range\'s ends and to the takes\' place', async () => {
  await open()
  // a steady tone, no cue in it; a range 2–5 s; takes from 1 s, the longer to 9 s (chime.wav 8 s)
  await write(`audio.from(t => Math.sin(2 * Math.PI * 220 * t) * .3, { duration: 10 })\n  .mark({ at: 2, d: 3 }, 'verse')\n  // .write(audio('chime.wav'), { at: 1 })\n  .write(audio('birdsong.wav'), { at: 1 })`)
  await lengthIs('0:10.000')
  await page.locator('.plot .takes:not([hidden])').waitFor()
  const { box, x } = await axis(10), y = box.y + tall(box) * .6
  const end = async (to, by = 2) => { await page.mouse.click(x(9.8), y); await drag([x(.4), y], [x(to) + by - x(.4), 0]); return (await selected()).split('–')[1] }
  assert.equal(await end(5), '0:05.000', 'the range\'s end')
  assert.equal(await end(2), '0:02.000', 'its start')
  // (from before it: the birdsong's first cue a few pixels after it is the nearer from after)
  assert.equal(await end(1, -2), '0:01.000', 'where the takes go in')
  assert.equal(await end(9), '0:09.000', 'where the longest ends')
})

// The handles show with the pointer on or by what they are for, none with it away: a selection's fade square in its
// top corner, the caret's square past it; to a touch or a pen, which may have no pointer to bring near, always. On
// silence, so only the wash, the lines and the squares show: a square's pixels, with the pointer away and by it, the
// pointer's own line clear of them
test('editor: the handles show only with the pointer on or by the selection or the caret', async () => {
  await open()
  await noCues()
  await write(`audio.from(2)`)
  await lengthIs('0:02.000')
  const { box, x } = await axis(2), y = box.y + 60, away = [box.x + 5, y]
  const region = ([x0, y0]) => pixels(`const out = []; for (let y = arg[1]; y < arg[1] + 12; y++) for (let x = arg[0]; x < arg[0] + 12; x++) out.push(d[(y * w + x) * 4]); return out`, [Math.round(x0 - box.x), Math.round(y0)])
  const differ = (a, b) => a.filter((v, i) => Math.abs(v - b[i]) > 8).length
  const seen = async (at, square) => { await page.mouse.move(...at); await frames(); return region(square) }
  // a selection's fade-in square, in from its start's line at its top
  await drag([x(.5) + .3, y], [x(1.5) - x(.5), 0])
  const fade = [x(.5) + 3, 2], none = await seen(away, fade)
  assert.ok(differ(none, await seen([x(1), y], fade)) > 20, 'the pointer in it: its square')
  assert.ok(differ(none, await seen([x(1.5) + 12, y], fade)) > 20, 'the pointer just past its end: its square')
  assert.ok(differ(none, await seen(away, fade)) <= 2, 'the pointer away again: none')
  // to a touch or a pen, the selection's handles with no pointer by it
  for (const pointerType of ['touch', 'pen']) {
    await page.mouse.move(...away)
    await page.locator('.plot').dispatchEvent('pointermove', { pointerType, clientX: away[0], clientY: y })
    await poll(() => region(fade), got => assert.ok(differ(none, got) > 20, `${pointerType}: its square`))
  }
  // the caret's square, past it in the middle of the lane's lower half (one lane, a mono sound's)
  await page.mouse.click(x(1), y)
  const gap = [x(1) + 3, tall(box) * 3 / 4 - 6], bare = await seen(away, gap)
  assert.ok(differ(bare, await seen([x(1) - 12, y], gap)) > 20, 'the pointer by the caret: its square')
  assert.ok(differ(bare, await seen(away, gap)) <= 2, 'the pointer away again: none')
})

// A press inside the selection keeps it, as a press on selected text does: dragged, its audio moves; let go where it
// went down, the caret there alone (it once dropped the selection at once, a drag from inside selecting anew)
test('editor: a press inside the selection keeps it until let go, then the caret there alone', async () => {
  const { x, y } = await chime()
  await drag([x(1), y], [x(3) - x(1), 0])
  await page.mouse.move(x(2), y)
  await page.mouse.down()
  assert.equal(await selected(), '0:01.000–0:03.000')
  await page.mouse.up()
  assert.equal(await selected(), '')
  assert.equal(await page.locator('.time').innerText(), '0:02.000')
})

test('editor: Shift and a click extends from where the selection was begun, or from the caret', async () => {
  const { x, y } = await chime()
  await drag([x(1), y], [x(3) - x(1), 0])
  await keyed(['Shift'], () => page.mouse.click(x(2), y))
  assert.equal(await selected(), '0:01.000–0:02.000', 'begun at 1: its end comes back')
  await drag([x(3), y], [x(1) - x(3), 0])
  await keyed(['Shift'], () => page.mouse.click(x(2), y))
  assert.equal(await selected(), '0:02.000–0:03.000', 'begun at 3: its start goes on')
  await page.mouse.click(x(5), y)
  await keyed(['Shift'], () => page.mouse.click(x(6), y))
  assert.equal(await selected(), '0:05.000–0:06.000', 'from the caret')
})

test('editor: Shift and a drag inside the selection moves its far end from where it was begun, whichever way', async () => {
  const { x, y } = await chime()
  await drag([x(1), y], [x(3) - x(1), 0])
  await keyed(['Shift'], () => drag([x(2.5), y], [x(1.5) - x(2.5), 0]))
  assert.equal(await selected(), '0:01.000–0:01.500')
})

test('editor: Shift and a press elsewhere extends the selection at once, a drag going on with it; the pointer says which way', async () => {
  const { x, y, ranges } = await chime()
  await drag([x(1), y], [x(2) - x(1), 0])
  await page.mouse.move(x(4), y)
  await page.keyboard.down('Shift')
  await page.waitForFunction(() => decodeURIComponent(document.querySelector('.plot').style.cursor).includes('M6 9v6M3 12h6'))
  await page.mouse.down()
  assert.equal(await selected(), '0:01.000–0:04.000', 'on the press')
  await page.mouse.move(x(5), y, { steps: 3 })
  await page.mouse.up()
  assert.equal(await selected(), '0:01.000–0:05.000', 'the drag goes on with it')
  assert.deepEqual(await ranges(), [], 'no other range')
  await page.mouse.move(x(.5), y)
  assert.match(await pointed(), /M18 9v6M15 12h6/, 'before it, the plus on the other side')
  await page.keyboard.up('Shift')
})

// Alt measures as Figma's Alt does: held, the pointer a cross, the waveform's level at its time (the peak of the column,
// on the pointer's side of the centre line, not the pointer's own height) dashed in the measuring red across to the level
// axis and from there down to the time row, and on the time row a line from the selection's nearer edge to it, how far
// it is; let go, none. It shows as the key goes down, before the pointer moves. ⌘ aims: the pointer a cross, nothing
// measured
test('editor: held Alt, the pointer measures how far it is from the selection, dashed out to the axes', async () => {
  const { box, x, y } = await chime()
  await drag([x(1), y], [x(2) - x(1), 0])
  // high over the lane, far over the sound there
  const py = box.y + 12
  await page.mouse.move(x(4), py)
  const span = x(4) - x(2) - 4, red = (x0, x1, y0, y1) => pixels(`let n = 0; for (let py = ${Math.round(y0)}; py < ${Math.round(y1)}; py++) for (let px = ${Math.round(x0)}; px < ${Math.round(x1)}; px++) { const i = (py * w + px) * 4; if (d[i] - d[i + 2] > 60 && d[i] > 150) n++ } return n`)
  // the row of the most red right of the pointer's column, over the lane's upper half; the waveform's top a few px
  // before that column (its first pixel down from the lane's top lit as the waveform is)
  const across = () => pixels(`let best = 0, at = -1; for (let py = 0; py < arg.h; py++) { let n = 0; for (let px = arg.x0; px < arg.x1; px++) { const i = (py * w + px) * 4; if (d[i] - d[i + 2] > 60 && d[i] > 150) n++ } if (n > best) { best = n; at = py } } return { at, n: best }`, { x0: Math.round(x(4) - box.x + 4), x1: Math.round(x(5) - box.x), h: Math.round(tall(box) / 4) })
  const top = () => pixels(`for (let py = 0; py < arg.h; py++) { const i = (py * w + arg.x) * 4; if (d[i] > 120 && Math.abs(d[i] - d[i + 2]) < 30) return py } return -1`, { x: Math.round(x(4) - box.x - 3), h: Math.round(tall(box) / 4) })
  assert.equal(await measuredOnRow(box, x(2) + 2, x(4) - 2), 0)
  await page.keyboard.down('ControlOrMeta')
  await crossed()
  assert.equal(await measuredOnRow(box, x(2) + 2, x(4) - 2), 0, '⌘ measures nothing')
  await page.keyboard.up('ControlOrMeta')
  const wave = await top()
  await page.keyboard.down('Alt')
  await crossed()
  const [n, level] = [await measuredOnRow(box, x(2) + 2, x(4) - 2), await across()]
  const below = await red(x(4) - box.x - 2, x(4) - box.x + 3, level.at + 4, level.at + 60)
  await page.keyboard.up('Alt')
  assert.ok(n > span * .6, `a line across the time row: ${n} of ${Math.round(span)} px`)
  assert.ok(level.n > (x(5) - x(4) - 4) * .3, `dashed across to the axis: ${level.n} px lit`)
  // (its drawn top a few px under its peak, the tips of a density fill faint)
  assert.ok(wave > 0 && Math.abs(level.at - wave) <= 8 && level.at > py - box.y + 20, `at the waveform's level (${wave} px down), not the pointer's (${Math.round(py - box.y)}): ${level.at}`)
  assert.ok(below > 20 && below < 56 * .8, `dashed down from it to the time row: ${below} px lit`)
  assert.equal(await measuredOnRow(box, x(2) + 2, x(4) - 2), 0, 'gone with the key')
})

// Held Alt over a waveform whose levels are zoomed in past its peaks: the level measured is the waveform's as it is,
// past the lane's top, the line held at that edge, a small triangle there pointing out to it
test('editor: held Alt where the waveform runs past the levels shown, the line stops at the edge, a triangle pointing on', async () => {
  await page.route('**/playground/editor.js', async route => { const r = await route.fetch(); route.fulfill({ response: r, body: (await r.text()).replace('v = view(', 'v = globalThis.__view = view(') }) })
  await open()
  await noCues()
  await write(`audio.from(t => 0.9 * Math.sin(2 * Math.PI * 220 * t), { duration: 2 })`)
  await lengthIs('0:02.000')
  await page.evaluate(() => { __view.frame = { levels: [-.2, .2] } })
  const { box, x } = await axis(2), red = (x0, x1, y0, y1) => pixels(`let n = 0; for (let py = arg[2]; py < arg[3]; py++) for (let px = arg[0]; px < arg[1]; px++) { const i = (py * w + px) * 4; if (d[i] - d[i + 2] > 60 && d[i] > 150) n++ } return n`, [x0, x1, y0, y1].map(Math.round))
  const px = x(1) - box.x
  await page.mouse.move(x(1), box.y + tall(box) / 6)
  await page.keyboard.down('Alt')
  await poll(() => red(px - 4, px + 5, 0, 6), tip => assert.ok(tip >= 6, `a triangle at the lane's top: ${tip} px`), 3000)
  const across = await red(px + 8, px + 80, 0, 2)
  await page.keyboard.up('Alt')
  assert.ok(across > 20, `the line along the top edge, out to the axis: ${across} px`)
})

test('editor: Alt and a click makes a caret, the one Shift then extends: ranges made in order', async () => {
  const { x, y, ranges } = await chime()
  await page.mouse.click(x(1), y)
  await keyed(['Alt'], () => page.mouse.click(x(3), y))
  assert.deepEqual(await marked(), [1, 3])
  await keyed(['Shift'], () => page.mouse.click(x(4), y))
  assert.equal(await selected(), '0:03.000–0:04.000')
  assert.deepEqual(await marked(), [1], 'the first caret stays')
  await keyed(['Alt'], () => page.mouse.click(x(5), y))
  await keyed(['Shift'], () => page.mouse.click(x(6), y))
  assert.deepEqual(await ranges(), ['2', '0:02.000'])
  assert.deepEqual(await marked(), [1])
})

test('editor: Alt and Shift always make another, never extending', async () => {
  const { x, y, ranges } = await chime()
  await drag([x(1), y], [x(2) - x(1), 0])
  await keyed(['Alt', 'Shift'], () => drag([x(4), y], [x(5) - x(4), 0]))
  assert.deepEqual(await ranges(), ['2', '0:02.000'])
  await keyed(['Alt', 'Shift'], () => page.mouse.click(x(6), y))
  assert.deepEqual(await ranges(), ['2', '0:02.000'], 'the ranges stay')
  assert.deepEqual(await marked(), [6], 'a caret beside them')
})

// A copy goes in where it is let go, what was there moving on after it, as a text's dragged copy goes in. Moved, the
// audio slides over what is there, silence where it was, as a graphic editor's object or a DAW's clip (move(), the
// length kept), dragged as selected text is, no key held (once only with ⌘, a drag inside the selection selecting
// anew). Each seam crossfaded as a delete's (the settings, 10 ms). Clicked inside it, the caret there alone
test('editor: dragged inside the selection, its audio slides over what is there; with Alt a copy goes in where it lands', async () => {
  const { x, y } = await chime()
  const before = await seconds()
  await drag([x(1), y], [x(2) - x(1), 0])
  await keyed(['Alt'], () => drag([x(1.5), y], [x(4) - x(1), 0]))
  await page.waitForFunction(() => /\.copy\(\{ at: 1, d: 1 \}\)\.paste\(4, 0\.01\)$/.test(scriptText()))
  assert.equal(await selected(), '0:04.000–0:05.000', 'the copy selected where it went')
  await page.waitForFunction(expected => Math.abs(+(e => e.title || e.dataset.tip || '')(document.querySelector('.source')).split(' · ').pop().split(':')[1] - expected) < .002, before + 1)
  await page.keyboard.press('ControlOrMeta+Z')
  await page.waitForFunction(() => scriptText() === "audio('chime.wav')")
  await page.mouse.click(x(7.5), y)
  await drag([x(1), y], [x(2) - x(1), 0])
  await drag([x(1.5), y], [x(4) - x(1), 0])
  await page.waitForFunction(() => /\.move\(\{ at: 1, d: 1, to: 4, xfade: 0\.01 \}\)$/.test(scriptText()))
  assert.equal(await selected(), '0:04.000–0:05.000', 'the moved audio stays selected where it went')
  await lengthIs('0:08.000')
  assert.equal(await page.locator('.plot').evaluate(el => el.style.cursor), 'grab', 'over the selection, a hand')
  // (once made: till then what it moved is frozen, no press taking it)
  await page.waitForFunction(() => !document.querySelector('.plot .veil:not([hidden])'))
  await page.mouse.click(x(4.5), y)
  assert.equal(await selected(), '', 'clicked inside it, no selection')
  assert.equal((await code()).match(/\.move\(/g).length, 1)
})

test('editor: what there is stays as one of it is dragged, a caret by its line, a range by its edge; an edge onto the other leaves a caret', async () => {
  const { x, y, ranges } = await chime()
  await page.mouse.click(x(1), y)
  await keyed(['Alt'], () => page.mouse.click(x(3), y))
  await drag(await grab([[x(3), y]], 'ew-resize'), [x(3.5) - x(3), 0])
  assert.deepEqual(await marked(), [1, 3.5])
  // a caret's line only clicked: that caret alone, as a click anywhere
  await page.mouse.click(x(3.5), y)
  assert.deepEqual(await marked(), [3.5])
  await drag([x(1), y], [x(2) - x(1), 0])
  await keyed(['Alt'], () => drag([x(4), y], [x(5) - x(4), 0]))
  await drag(await grab([[x(2), y]], 'ew-resize'), [x(2.5) - x(2), 0])
  assert.deepEqual(await ranges(), ['2', '0:02.500'])
  // its start onto its end: a caret there, the other range staying
  await drag(await grab([[x(1), y]], 'ew-resize'), [x(2.5) - x(1), 0])
  assert.equal(await page.locator('.time').innerText(), '0:02.500')
  await page.keyboard.press('Delete')
  await page.waitForFunction(() => /\.remove\(\{ at: 4, d: 1, xfade: 0\.01 \}\)$/.test(scriptText()))
})

// An edge dragged on past the other turns the range over, as a drag from the other edge would make it: its end past its
// start, the range from its start back to where it is let go, its start past its end the same the other way
test('editor: a range\'s edge dragged past the other turns it over from there', async () => {
  const { x, y } = await chime()
  await drag([x(3), y], [x(4) - x(3), 0])
  await drag(await grab([[x(4), y]], 'ew-resize'), [x(2) - x(4), 0])
  assert.equal(await selected(), '0:02.000–0:03.000', 'its end past its start')
  await drag(await grab([[x(2), y]], 'ew-resize'), [x(5) - x(2), 0])
  assert.equal(await selected(), '0:03.000–0:05.000', 'its start past its end')
})

test('editor: ⌘ aims, a drag going a quarter as far; a right-click on what a press would take moves nothing', async () => {
  const { x, y } = await chime(), clock = () => page.locator('.time').innerText()
  await page.mouse.click(x(2), y)
  await keyed(['ControlOrMeta'], async () => drag(await grab([[x(2), y]], 'ew-resize'), [x(3) - x(2), 0]))
  const t = +(await clock()).split(':')[1]
  assert.ok(Math.abs(t - 2.25) < .02, `a quarter of a second, not a second: ${t}`)
  await page.mouse.move(x(t) + 4, y)
  await page.mouse.click(x(t) + 4, y, { button: 'right' })
  await page.keyboard.press('Escape')
  assert.equal(+(await clock()).split(':')[1], t)
  await drag([x(4), y], [x(5) - x(4), 0])
  await page.mouse.move(x(5) - 2, y)
  await page.mouse.click(x(5) - 2, y, { button: 'right' })
  await page.keyboard.press('Escape')
  assert.equal(await selected(), '0:04.000–0:05.000')
})

// A word added to the words selected, as a text editor's several selections: Alt and a double-click; Shift and a
// double-click, the selection out to the word
test('editor: Alt and a double-click adds a word; Shift and a double-click extends to one', async () => {
  await open()
  await write(bursts)
  await lengthIs('0:02.500')
  const { box, x } = await axis(2.5), y = box.y + tall(box) / 3
  for (const until = Date.now() + 8000; Date.now() < until; await page.waitForTimeout(200)) { await page.mouse.dblclick(x(.2), y); if (/^0:00\.4/.test((await selected()).split('–')[1] ?? '')) break }
  await page.keyboard.down('Alt'); await page.mouse.dblclick(x(1.7), y); await page.keyboard.up('Alt')
  assert.match(await page.locator('.clock').evaluate(tipOf), /^Selected 2 ranges: 0:00\.8/)
  await page.locator('.plot').focus()
  await page.keyboard.press('Delete')
  await page.waitForFunction(() => (scriptText().match(/\.remove\(/g) || []).length === 2)
  await page.keyboard.press('ControlOrMeta+Z')
  await lengthIs('0:02.500')
  // its cues come with its output again (its pauses' edges first): a word at .2, extended with Shift to the one at .7,
  // once they have
  for (const until = Date.now() + 8000; Date.now() < until; await page.waitForTimeout(200)) {
    await page.mouse.dblclick(x(.2), y)
    await page.keyboard.down('Shift'); await page.mouse.dblclick(x(.7), y); await page.keyboard.up('Shift')
    if (/^0:00\.000–0:00\.9\d*$/.test(await selected())) break
  }
  assert.match(await selected(), /^0:00\.000–0:00\.9\d*$/)
})

// The caret dragged, Shift held on the way: a range from where the caret was pressed
test('editor: a caret dragged with Shift held becomes a range from where it was pressed', async () => {
  await open()
  await noCues()
  await write(`audio('chime.wav')`)
  await lengthIs('0:08.000')
  const { box, x } = await axis(8), row = box.y + box.height - 8
  await page.mouse.move(x(2), row)
  await page.mouse.down()
  await page.mouse.move(x(2.5), row, { steps: 3 })
  await page.keyboard.down('Shift')
  await page.mouse.move(x(3), row, { steps: 3 })
  await page.mouse.up()
  await page.keyboard.up('Shift')
  assert.equal(await selected(), '0:02.000–0:03.000')
})

// The caret, as the selection, inactive while the picture is not focused: faint, still where play starts; whole again as
// the picture is pressed
test('editor: the caret faint while the picture is not focused', async () => {
  await open()
  await noCues()
  await write(`audio('chime.wav')`)
  await lengthIs('0:08.000')
  const box = await page.locator('.plot').boundingBox(), x = box.x + box.width * .3, y = box.y + box.height * .15
  // the caret's alpha: the most along a row in the lanes, a few px either side of where the picture was pressed
  const alpha = () => page.evaluate(([x, y]) => {
    const cv = __overlay(), r = cv.getBoundingClientRect(), k = cv.width / r.width
    const d = cv.getContext('2d').getImageData(Math.round((x - r.x) * k) - 4, Math.round((y - r.y) * k), 9, 1).data
    return Math.max(...Array.from({ length: 9 }, (_, i) => d[4 * i + 3]))
  }, [x, y])
  const reads = async ok => { let a; for (const end = Date.now() + 3000; !ok(a = await alpha()) && Date.now() < end;) await frames(1); return a }
  const press = async () => { await page.mouse.click(x, box.y + box.height * .4); await page.mouse.move(1, 1) }
  await press()
  assert.equal(await reads(a => a === 255), 255, 'focused, the caret whole')
  await page.evaluate(() => document.activeElement?.blur())
  const faint = await reads(a => a < 255)
  assert.ok(faint > 40 && faint < 140, `unfocused, the caret faint (.35 of its alpha): ${faint}`)
  await press()
  assert.equal(await reads(a => a === 255), 255, 'pressed again, whole')
})
// A selection's end dragged leaves the caret there (the end a drag moves), its line the end's, one pixel wide: the end
// lit on the caret's own line, not its last pixel beside it
test('editor: the end of a selection dragged, the caret its one line', async () => {
  await open()
  await noCues()
  await write(`audio('chime.wav')`)
  await lengthIs('0:08.000')
  const { box, x } = await axis(8), y = box.y + tall(box) * .5, px = t => Math.round(x(t) - box.x)
  await drag([x(2), y], [x(3) - x(2), 0])
  await drag([x(3), y], [x(4) - x(3), 0])
  assert.equal(await selected(), '0:02.000–0:04.000')
  // pointed at, the end lit: the bright columns by it in the lanes' top rows (over the sound's quiet edge)
  await page.mouse.move(x(4) - 2, y)
  await frames()
  const lit = await pixels(`const out = []; for (let x = arg - 3; x <= arg + 3; x++) { const i = (4 * w + x) * 4; if (d[i] + d[i + 1] + d[i + 2] > 600) out.push(x - arg) } return out`, px(4))
  assert.equal(lit.length, 1, `one line at its end: ${lit}`)
})

// The sound's own start and end are cues as any: a press within a few px of them, there
test('editor: a press by the sound\'s start or end goes onto it', async () => {
  await open()
  await write(`audio('chime.wav')`)
  await lengthIs('0:08.000')
  const { box, x } = await axis(8), y = box.y + tall(box) * .3
  for (const [t, dx, want] of [[0, 2, '0:00.000'], [8, -2, '0:08.000']]) {
    for (const until = Date.now() + 8000; Date.now() < until; await page.waitForTimeout(200)) {
      await page.mouse.click(x(t) + dx, y)
      if (await page.locator('.time').innerText() === want) break
    }
    assert.equal(await page.locator('.time').innerText(), want, `by ${t} s, onto it`)
  }
})

// Held Alt over a lane, the pointer's guides out to the axes, dashed in the measuring red, at once, on the caret too,
// where there is nothing to measure; and as a drag sets a time, Alt pressed on the way
test('editor: held Alt, the guides to the axes at once, on the caret and as a drag goes', async () => {
  const { x, y } = await chime()
  const guides = () => page.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(() => { const o = document.querySelector('.plot canvas.overlay'), d = o.getContext('2d').getImageData(0, 0, o.width, o.height).data; let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i] > 180 && d[i + 1] < 120 && d[i + 3] > 100) n++; done(n) }))))
  await page.mouse.click(x(2), y)
  assert.equal(await guides(), 0, 'none without Alt')
  await page.keyboard.down('Alt')
  assert.ok(await guides() > 50, 'Alt pressed, the pointer on the caret: at once')
  await page.keyboard.up('Alt')
  assert.equal(await guides(), 0, 'let go, gone')
  await page.mouse.move(x(3), y)
  await page.mouse.down()
  await page.mouse.move(x(4), y, { steps: 4 })
  await page.keyboard.down('Alt')
  await page.mouse.move(x(4.5), y, { steps: 2 })
  assert.ok(await guides() > 50, 'a range dragged, Alt pressed on the way')
  await page.mouse.up()
  await page.keyboard.up('Alt')
})

// A selection behind the sound, as an editor's is behind its text: Light+'s #ADD6FF where the lane is clear, the
// waveform over it in its own black; the picture not focused, Light+'s inactive selection, #E5EBF1 (light_vs.json)
test('editor: a selection behind the sound, as behind text; focused elsewhere, the inactive selection\'s colour', async () => {
  await page.addInitScript(async () => {
    if (sessionStorage.seeded) return
    sessionStorage.seeded = 1
    const m = await import('/playground/theme.js'), t = m.THEMES.find(t => t.name === 'Light+')
    localStorage.setItem('audio-theme', JSON.stringify({ name: t.name, theme: await m.load(new URL('/playground/themes/' + t.file, location.href).href, { kind: t.kind }) }))
  })
  await open()
  await page.reload()
  await wholeLevels().waitFor()
  await write(`audio.from(t => 0.3 * Math.sin(2 * Math.PI * 220 * t), { duration: 2 })`)
  await lengthIs('0:02.000')
  const box = await page.locator('.plot').boundingBox(), w = box.width - (await gutter()), lane = tall(box)
  await page.mouse.move(box.x + w * .3, box.y + lane * .5)
  await page.mouse.down()
  await page.mouse.move(box.x + w * .6, box.y + lane * .5, { steps: 4 })
  await page.mouse.up()
  await page.mouse.move(box.x + w * .9, box.y + 5)
  // the colour in the selection's middle, above the sound (an eighth of the way down its one lane, TRACK px), and the
  // darkest of four on its centre line (a column holds a third of a cycle, not always where it crosses the line)
  const at = () => pixels(`const px = (y, x) => { const i = (Math.round(y) * w + Math.round(x)) * 4; return [d[i], d[i + 1], d[i + 2]] }, sum = c => c[0] + c[1] + c[2]
    return [px(arg / 8, w * .45), [0, 1, 2, 3].map(dx => px(arg / 2, w * .45 + dx)).reduce((a, b) => sum(a) <= sum(b) ? a : b)]`, lane)
  const near = (c, rgb) => c.every((v, i) => Math.abs(v - rgb[i]) < 6)
  await poll(at, ([clear, sound]) => {
    assert.ok(near(clear, [173, 214, 255]), `behind the sound, the selection: ${clear}`)
    assert.ok(sound.every(v => v < 60), `the waveform over it, black: ${sound}`)
  })
  await page.locator('.readout').click()
  await page.evaluate(() => document.activeElement?.blur())
  await poll(at, ([clear]) => assert.ok(near(clear, [229, 235, 241]), `not focused, the inactive selection: ${clear}`))
})

// A press held still half a second, as a touch's long press puts a text's caret: no selection, the caret dragged, the
// moment under it heard as it goes
test('editor: a press held still, then dragged, takes the caret along without selecting', async () => {
  const { x, y } = await chime()
  await page.mouse.move(x(2), y)
  await page.mouse.down()
  // held past HOLD (view.js): the caret's, the pointer says
  await page.waitForFunction(() => document.querySelector('.plot').style.cursor === 'ew-resize')
  await page.mouse.move(x(4), y, { steps: 8 })
  await page.mouse.up()
  assert.equal(await selected(), '', 'nothing selected')
  assert.ok(Math.abs(+(await page.locator('.time').innerText()).split(':')[1] - 4) < .03, 'the caret where it was let go')
  // a press dragged at once still selects
  await drag([x(5), y], [x(6) - x(5), 0])
  assert.equal(await selected(), '0:05.000–0:06.000')
})
