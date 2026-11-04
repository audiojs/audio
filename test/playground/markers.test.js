// Markers: made, named, dragged, taken away, kept; the server, the page and the helpers in page.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { root, page, sine, engine, code, wholeLevels, open, frames, poll, menuRow, selected, menu, offered, noCues, write, FOOT, tall, tracksAt, axis, grab, drag, lengthIs, hits, handles, pixels, keptFiles, contextRow } from './page.js'

// M puts a marker at the caret, a mark() at the chain's end; its triangle, in the strip under the lanes, drags to move
// it, a double-click names it (its mark()'s label), its right-click menu takes it away; File exports the parts between
// markers, a file each
test('editor: markers: M at the caret, its triangle in the strip dragged, named, taken away, the parts between them exported', async () => {
  await open()
  await write(`audio('chime.wav')`)
  await lengthIs('0:08.000')
  const { box, x } = await axis(8), y = box.y + tall(box) * .3, strip = box.y + tall(box) + FOOT / 2
  // the times the script gets: the caret's, to the zoom's step
  const marks = async n => { await page.waitForFunction(n => (scriptText().match(/\.mark\(/g) || []).length === n, n); return [...(await code()).matchAll(/\.mark\(([\d.]+)/g)].map(m => +m[1]) }
  await page.mouse.click(x(2), y)
  await page.keyboard.press('m')
  await page.mouse.click(x(5), y)
  await page.keyboard.press('m')
  const [a, b] = await marks(2)
  assert.ok(Math.abs(a - 2) < .05 && Math.abs(b - 5) < .05, `${a} ${b}`)
  // its triangle shows as soon as it is made, before the output that has it
  await drag(await grab([[x(a), strip]], 'ew-resize'), [x(3) - x(2), 0])
  await page.waitForFunction(a => +(scriptText().match(/\.mark\(([\d.]+)\)/)?.[1]) > a + .9, a)
  // the menu as the output it opens over: opened again till that output has come, with its markers
  for (const until = Date.now() + 8000; Date.now() < until; await page.keyboard.press('Escape')) {
    await page.locator('.menubar-item', { hasText: /^File$/ }).click()
    await menuRow('Export as').click()
    if (await menuRow('Each part between markers').getAttribute('aria-disabled') !== 'true') break
  }
  const downloads = []
  page.on('download', d => downloads.push(d.suggestedFilename()))
  await menuRow('Each part between markers').click()
  await page.waitForFunction(() => !document.querySelector('.export-button').textContent.includes('Exporting'))
  await poll(() => [...downloads].sort(), got => assert.deepEqual(got, ['chime-edited-01.wav', 'chime-edited-02.wav', 'chime-edited-03.wav']))
  // named where its name goes
  await page.mouse.dblclick(...await grab([[x(b), strip]], 'ew-resize'))
  await page.keyboard.type('Outro')
  await page.keyboard.press('Enter')
  await page.waitForFunction(() => /\.mark\([\d.]+, 'Outro'\)/.test(scriptText()))
  // a name cleared is no name: the label goes from its mark()
  await page.mouse.dblclick(...await grab([[x(b), strip]], 'ew-resize'))
  await page.keyboard.press('Backspace')
  await page.keyboard.press('Enter')
  await page.waitForFunction(() => /\.mark\([\d.]+\)$/.test(scriptText().trim()) && !scriptText().includes('Outro'))
  await page.mouse.dblclick(...await grab([[x(b), strip]], 'ew-resize'))
  await page.keyboard.type('Outro')
  await page.keyboard.press('Enter')
  await page.waitForFunction(() => /\.mark\([\d.]+, 'Outro'\)/.test(scriptText()))
  // taken away from its own menu
  await page.mouse.click(...await grab([[x(b), strip]], 'ew-resize'), { button: 'right' })
  await page.locator('.menubar-menu .menu-row', { has: page.locator('.menu-label', { hasText: /^Delete the marker$/ }) }).click()
  assert.equal((await marks(1)).length, 1)
})

// M over a selection marks it, a range: mark({ at, d }), a region in the file. A marker made asks for its name at once,
// where its name goes (not while it plays, where M marks moment after moment); a click on the name asks again, as a field's
// text is written. A range pressed in its strip selects it.
test('editor: markers: M over the selection a range, named as it is made, renamed from its name, pressed in its strip', async () => {
  await open()
  await noCues()
  await write(`audio('chime.wav')`)
  await lengthIs('0:08.000')
  // in the strip under the lanes, a moment ▲ its name, a range ◢ its name ◣
  const { box, x } = await axis(8), y = box.y + tall(box) * .3, strip = box.y + tall(box) + FOOT / 2
  const named = () => page.evaluate(() => document.activeElement.className === 'marker-name')
  // a moment, named as it is made
  await page.mouse.click(x(1), y)
  await page.keyboard.press('m')
  assert.ok(await named(), 'its name asked for')
  await page.keyboard.type('Intro')
  await page.keyboard.press('Enter')
  await page.waitForFunction(() => /\.mark\(1, 'Intro'\)/.test(scriptText()))
  // a range, from the selection
  await drag([x(3), y], [x(5) - x(3), 0])
  assert.equal(await selected(), '0:03.000–0:05.000')
  await page.keyboard.press('m')
  assert.ok(await named(), 'its name asked for')
  await page.keyboard.type('Chorus')
  await page.keyboard.press('Enter')
  await page.waitForFunction(() => /\.mark\(\{ at: 3, d: 2 \}, 'Chorus'\)/.test(scriptText()))
  // its name clicked: named anew
  await page.mouse.click(x(7.5), y)
  await page.mouse.click(x(1) + 20, strip)
  assert.ok(await named(), 'a click on its name')
  await page.keyboard.press('ControlOrMeta+A')
  await page.keyboard.type('Start')
  await page.keyboard.press('Enter')
  await page.waitForFunction(() => /\.mark\(1, 'Start'\)/.test(scriptText()) && scriptText().includes("'Chorus'"))
  // pressed in its strip: its audio selected at once, as the takes' place selects theirs; dragged on, nothing moves
  await page.mouse.click(x(7.5), y)
  await page.mouse.move(x(4.5), strip)
  await page.mouse.down()
  await page.locator('.clock').evaluate(el => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))))
  assert.equal(await selected(), '0:03.000–0:05.000', 'selected before it is let go')
  await page.mouse.move(x(5.5), strip, { steps: 5 })
  await page.mouse.up()
  await page.waitForFunction(() => /\.mark\(\{ at: 3, d: 2 \}, 'Chorus'\)/.test(scriptText()))
  assert.equal(await selected(), '0:03.000–0:05.000')
  // its name in the strip clicked: named anew in place, the field within the strip, the selection's handles gone while it is
  // written (its fade's corner no grip to the pointer)
  await page.mouse.click(x(3) + 20, strip)
  assert.ok(await named(), 'a click on a range\'s name')
  const field = await page.locator('.marker-name').boundingBox(), lane = box.y + tall(box)
  assert.ok(field.y >= lane - 4 && field.y + field.height <= lane + FOOT, `its field by its strip: ${field.y - lane}, ${field.height}`)
  await page.mouse.move(x(3) + 9, box.y + 9)
  assert.notEqual(await page.locator('.plot').evaluate(el => el.style.cursor), 'ew-resize', 'no handle while it is named')
  await page.keyboard.press('Escape')
  assert.match(await code(), /\.mark\(\{ at: 3, d: 2 \}, 'Chorus'\)/)
  // to the page, the moments and the ranges in one list, in time order
  const [r] = await engine([`audio('x.wav').mark({ at: 0.5, d: 0.25 }, 'Chorus').mark(0.75).mark(0.25, 'In')`], { 'x.wav': [sine(1, 440)] })
  assert.deepEqual(r.output.markers, [{ time: 0.25, label: 'In' }, { time: 0.5, duration: 0.25, label: 'Chorus' }, { time: 0.75, label: '' }])
})

// A name written while the output that has its marker is still on its way shows at once, and stays: that output, of
// the script before the name, leaves the markers the view drew ahead of it as they are
test('editor: markers: a marker named before its output comes keeps its name through that output', async () => {
  await open()
  await write(`audio('chime.wav').stretch(2)`)
  await lengthIs('0:16.000')
  const { box, x } = await axis(16), y = box.y + tall(box) * .3, row = box.y + tall(box) + FOOT / 2
  await page.mouse.click(x(3), y)
  await page.keyboard.press('m')
  // its run under way, the name written
  await page.waitForFunction(() => document.activeElement?.matches('input.marker-name'))
  await page.keyboard.type('Hello')
  await page.keyboard.press('Enter')
  // the name is there from the next frame, where a press takes hold of it (a pointer), till the output with it comes
  // and after
  await frames()
  const seen = []
  for (const until = Date.now() + 4000; Date.now() < until; await page.waitForTimeout(100)) {
    await page.mouse.move(x(3) + 22 + seen.length % 2, row)
    seen.push(await page.locator('.plot').evaluate(el => el.style.cursor))
  }
  assert.ok(seen.every(c => c === 'pointer'), JSON.stringify(seen))
  assert.match(await code(), /\.mark\([\d.]+, 'Hello'\)/)
})

// A marker's line, a moment's or a range's end, points as it is neared (a hand, lit) and takes a press onto it: the
// caret goes to the marker's time, not to the pixel pressed; with snapping off, the pixel's
test('editor: markers: a press by a marker line puts the caret on it', async () => {
  await open()
  await write(`audio('chime.wav').mark(2).mark({ at: 5, d: 1 })`)
  await lengthIs('0:08.000')
  const { box, x } = await axis(8), y = box.y + tall(box) * .3
  const caret = async () => +(await page.locator('.time').innerText()).split(':')[1]
  for (const t of [2, 5, 6]) {
    await grab([[x(t) + 4, y]], 'pointer')
    await page.mouse.click(x(t) + 4, y)
    assert.equal(await caret(), t)
  }
  await menu('View', 'Snap to cues and markers')
  await page.mouse.move(x(2) + 4, y)
  assert.notEqual(await page.locator('.plot').evaluate(el => el.style.cursor), 'pointer')
  await page.mouse.click(x(2) + 4, y)
  assert.ok(await caret() > 2, 'the pixel pressed')
})

// A marker in silence (here padding past the sound's end) stays where it is put, at its distance from the sound nearest
// it (fn/meta.js), not drawn back onto the sound's last sample; its triangle drags on into the silence, to the end at
// most
test('editor: markers: one in silence past the sound stays there, and drags on within it', async () => {
  await open()
  await write(`audio('chime.wav').pad(0, 2).mark(9)`)
  await lengthIs('0:10.000')
  const { box, x } = await axis(10), y = box.y + tall(box) * .3, strip = box.y + tall(box) + FOOT / 2
  const caret = async () => +(await page.locator('.time').innerText()).split(':')[1]
  await page.mouse.click(...await grab([[x(9) + 4, y]], 'pointer'))
  assert.equal(await caret(), 9, 'its line where it was put, from the output')
  await drag(await grab([[x(9), strip]], 'ew-resize'), [x(9.5) - x(9), 0])
  await page.waitForFunction(() => Math.abs(+(scriptText().match(/\.mark\(([\d.]+)\)/)?.[1]) - 9.5) < .05)
  // dragged past the end, to the end
  await drag(await grab([[x(9.5), strip]], 'ew-resize'), [x(11) - x(9.5), 0])
  await page.waitForFunction(() => +(scriptText().match(/\.mark\(([\d.]+)\)/)?.[1]) === 10)
  await write(`audio('chime.wav').pad(0, 2).mark(9.75)`)
  await page.mouse.click(...await grab([[x(9.75) + 4, y]], 'pointer'))
  assert.equal(await caret(), 9.75)
})

// A press on a marker's triangle chooses it, and Delete takes it away, not the audio. A press anywhere else, or Escape,
// and Delete is what it was. A range's press between its triangles selects its audio and nothing more: Delete takes the
// audio, its menu the marker
test('editor: markers: Delete takes away the marker whose triangle was pressed', async () => {
  await open()
  await noCues()
  await write(`audio('chime.wav').mark(2).mark({ at: 5, d: 1 })`)
  await lengthIs('0:08.000')
  // in the strip under the lanes, a moment ▲, a range ◢ ◣
  const { box, x } = await axis(8), y = box.y + tall(box) * .3, strip = box.y + tall(box) + FOOT / 2
  // chosen, then let go of: Delete with nothing selected does nothing
  await page.mouse.click(...await grab([[x(2), strip]], 'ew-resize'))
  await page.keyboard.press('Escape')
  await page.keyboard.press('Delete')
  await frames()
  assert.equal(await code(), `audio('chime.wav').mark(2).mark({ at: 5, d: 1 })`)
  await page.mouse.click(x(2), strip)
  await page.mouse.click(x(4), y)
  await page.keyboard.press('Delete')
  await frames()
  assert.equal(await code(), `audio('chime.wav').mark(2).mark({ at: 5, d: 1 })`)
  // a moment's
  await page.mouse.click(x(2), strip)
  await page.keyboard.press('Delete')
  await page.waitForFunction(() => scriptText() === `audio('chime.wav').mark({ at: 5, d: 1 })`)
  // a range's, pressed in its strip: its audio selected, not chosen; Delete takes the audio, the marker staying
  await page.mouse.click(x(5.5), strip)
  assert.equal(await selected(), '0:05.000–0:06.000')
  await page.keyboard.press('Backspace')
  await lengthIs('0:07.000')
  assert.match(await code(), /\.mark\(\{ at: 5, d: 1 \}\)/)
  // its menu takes the marker away, the audio as it is
  await write(`audio('chime.wav').mark({ at: 5, d: 1 })`)
  await lengthIs('0:08.000')
  await page.mouse.click(x(5.5), strip, { button: 'right' })
  await contextRow('Delete the marker').click()
  await page.waitForFunction(() => scriptText() === `audio('chime.wav')`)
  await lengthIs('0:08.000')
  // a range's triangle pressed, the caret at that end, the range chosen: Delete takes the marker, the audio as it is
  await write(`audio('chime.wav').mark({ at: 5, d: 1 })`)
  await page.mouse.click(...await grab([[x(6) + 3, strip]], 'ew-resize'))
  assert.equal(await page.locator('.time').innerText(), '0:06.000', 'the caret at its end')
  // chosen, its triangles lit, not in the accent (the hints' alone)
  await page.mouse.move(box.x + 5, box.y + box.height - 8)
  const orange = await pixels(`let n = 0; for (let y = arg.y; y < arg.y + 9; y++) for (let x = arg.px - 6; x < arg.px + 6; x++) { const i = (y * w + x) * 4; if (d[i] - d[i + 2] > 30) n++ } return n`, { px: Math.round(x(6) - box.x), y: Math.round(tall(box)) })
  assert.equal(orange, 0, 'chosen, nothing of it in the accent')
  await page.keyboard.press('Delete')
  await page.waitForFunction(() => scriptText() === `audio('chime.wav')`)
  await lengthIs('0:08.000')
})

// A range's triangles in its strip drag its ends, as a moment's drags it: its start, its end staying; its end, its
// length; as far as the other, let go there one moment. A moment is one triangle there, ▲ on its line, nothing of it at
// the lanes' top nor down them, but the caret's ghost where a press would put it as its triangle is pointed at; held
// Alt, its triangle dragged apart into a range from it, either way, as Photoshop's split slider's is
test('editor: markers: a range\'s triangles drag its ends; a moment is one triangle in the strip, Alt pulls it apart', async () => {
  await open()
  await noCues()
  await write(`audio('chime.wav').mark({ at: 2, d: 2 }).mark(6)`)
  await lengthIs('0:08.000')
  const { box, x } = await axis(8), lane = Math.round(tall(box)), strip = box.y + lane + FOOT / 2, px = t => Math.round(x(t) - box.x)
  // in columns [a, b) and rows [y0, y1), the pixels unlike the ground there (its column at 7.5 s, where nothing is)
  const marked = ([a, b], [y0, y1]) => pixels(`let n = 0; for (let y = arg.y0; y < arg.y1; y++) { const g = (y * w + arg.g) * 4; for (let x = arg.a; x < arg.b; x++) { const i = (y * w + x) * 4; if (Math.abs(d[i] - d[g]) + Math.abs(d[i + 1] - d[g + 1]) + Math.abs(d[i + 2] - d[g + 2]) > 45) n++ } } return n`, { a, b, y0, y1, g: px(7.5) })
  await page.mouse.move(box.x + 5, box.y + box.height - 8)
  assert.ok(await marked([px(6) - 4, px(6)], [lane + 4, lane + 9]) > 3 && await marked([px(6) + 1, px(6) + 5], [lane + 4, lane + 9]) > 3, 'a moment ▲, either side of its line')
  assert.equal(await marked([px(6) + 2, px(6) + 8], [0, 7]), 0, 'no flag at the lanes\' top')
  // the range's ◢ ends with the caret's pixel at its start, as ◣ starts with the caret's at its end: a triangle clicked,
  // the caret's column (the lanes' top rows) the last of ◢'s, the first of ◣'s
  const column = async t => { for (let d = -3; d <= 3; d++) if (await marked([px(t) + d, px(t) + d + 1], [2, 12]) >= 8) return px(t) + d; return null }
  for (const [t, edge, out] of [[2, -3, 1], [4, 3, -1]]) {
    await page.mouse.click(x(t) + edge, strip)
    await page.mouse.move(box.x + 5, box.y + box.height - 8)
    const c = await column(t)
    assert.ok(c != null && await marked([c, c + 1], [lane + 5, lane + 9]) > 0 && await marked([c + out, c + out + 1], [lane + 1, lane + 9]) === 0, `the caret's pixel ${c} its triangle's edge at ${t} s`)
  }
  await page.keyboard.press('Escape')
  // (the lanes' top rows, over the sound's quiet edge)
  assert.equal(await marked([px(6), px(6) + 1], [2, 22]), 0, 'no line down the lanes')
  await page.mouse.move(x(6), strip)
  await poll(() => marked([px(6), px(6) + 1], [2, 22]), ghost => assert.ok(ghost >= 20, `pointed at, the caret's ghost down the lanes: ${ghost} rows`), 2000)
  await page.mouse.move(box.x + 5, box.y + box.height - 8)
  // its end dragged on a second: 3 s long
  await drag(await grab([[x(4) + 3, strip]], 'ew-resize'), [x(5) - x(4), 0])
  await page.waitForFunction(() => /\.mark\(\{ at: 2, d: 3 \}\)/.test(scriptText()))
  // its start dragged on a second: from 3 s, its end where it was
  await drag(await grab([[x(2) - 3, strip]], 'ew-resize'), [x(3) - x(2), 0])
  await page.waitForFunction(() => /\.mark\(\{ at: 3, d: 2 \}\)/.test(scriptText()))
  // its start dragged past its end: held at it, and let go there, one moment at its end
  await drag(await grab([[x(3) - 3, strip]], 'ew-resize'), [x(7) - x(3), 0])
  await page.waitForFunction(() => /\.mark\(5\)\.mark\(6\)$/.test(scriptText()))
  // a moment, held Alt, dragged half a second back: a range from there to it, its name kept; another, on a second
  await write(`audio('chime.wav').mark(6.5, 'Bell')`)
  const split = async (t, to) => { const at = await grab([[x(t), strip]], 'ew-resize'); await page.keyboard.down('Alt'); await drag(at, [x(to) - x(t), 0]); await page.keyboard.up('Alt') }
  await split(6.5, 6)
  await page.waitForFunction(() => /\.mark\(\{ at: 6, d: 0\.5 \}, 'Bell'\)/.test(scriptText()))
  await write(`audio('chime.wav').mark(5, 'Bell')`)
  await split(5, 6)
  await page.waitForFunction(() => /\.mark\(\{ at: 5, d: 1 \}, 'Bell'\)/.test(scriptText()))
  // its end dragged back onto its start (within a few px), let go: one moment there again
  await drag(await grab([[x(6) + 3, strip]], 'ew-resize'), [x(5) + 2 - x(6), 0])
  await page.waitForFunction(() => /\.mark\(5, 'Bell'\)/.test(scriptText()))
})

// A range pointed at in its strip shows a fork (⌥) at its end inside it, where takes' numbers stand: pressed, takes
// start there, an empty take over it, turned off, the sound heard as it was, its place selected for R to record into.
// Its number pressed hears it; pressed again, turned off, the sound as it was again. None on a range with takes
test('editor: markers: a named range\'s fork starts takes there; the take heard, pressed again, off', async () => {
  await open()
  await noCues()
  await write(`audio('chime.wav').mark({ at: 3, d: 2 }, 'Chorus').mark({ at: 6, d: 1 })`)
  await lengthIs('0:08.000')
  const { box, x } = await axis(8), strip = box.y + tall(box) + FOOT / 2, fork = page.locator('.plot .fork')
  assert.ok(await fork.isHidden(), 'none till it is pointed at')
  // a range with no name has it too
  await page.mouse.move(x(6.5), strip)
  await fork.waitFor()
  assert.equal(await fork.getAttribute('title'), 'Another take')
  await page.mouse.move(x(4), strip)
  await fork.waitFor()
  const at = await fork.boundingBox()
  assert.ok(Math.abs(at.x + at.width - x(5) + 2) < 2, `at its end, inside: ${at.x + at.width - x(5)}`)
  await fork.click()
  await page.waitForFunction(() => scriptText().endsWith(`// .write(audio.from(2), { at: 3 })`))
  assert.equal(await selected(), '0:03.000–0:05.000')
  const chip = page.locator('.plot .takes:not([hidden])')
  await chip.waitFor()
  const numbers = () => chip.locator('button').evaluateAll(b => b.map(x => [x.value === 'add' ? 'fork' : x.textContent, x.getAttribute('aria-pressed') ?? x.getAttribute('aria-disabled')]))
  assert.deepEqual(await numbers(), [['1', 'false'], ['fork', 'true']])
  await page.mouse.move(x(4), strip)
  await frames()
  assert.ok(await fork.isHidden(), 'no fork where takes are')
  await chip.locator('button[value="0"]').click()
  await page.waitForFunction(() => scriptText().endsWith(`\n  .write(audio.from(2), { at: 3 })`))
  await chip.locator('button[value="0"]').click()
  await page.waitForFunction(() => scriptText().endsWith(`// .write(audio.from(2), { at: 3 })`))
  // its place selected (pressed in the strip), Record records into the empty take, heard from then on, stopping at the
  // place's end by itself
  await page.mouse.click(x(4.5), strip)
  assert.equal(await selected(), '0:03.000–0:05.000')
  await page.getByRole('button', { name: 'Record', exact: true }).click()
  await page.getByRole('button', { name: 'Record', exact: true }).waitFor({ timeout: 15000 })
  await page.waitForFunction(() => /\n {2}\.write\(audio\('take(-\d)?\.wav'\), \{ at: 3[^)]*\)$/.test(scriptText()) && !scriptText().includes('audio.from(2)'))
})

// A marker's triangle dragged goes onto a cue it comes within a few px of, as a selection's edge does, not onto where
// the marker was: a range's end, its length to the hit; 5 px past it, where it was let go
test('editor: markers: a range\'s end dragged by its triangle snaps to a cue near it', async () => {
  await open()
  await write(`${hits}.mark({ at: 0.6, d: 0.2 })`)
  await lengthIs('0:02.000')
  const { box, x } = await axis(2), strip = box.y + tall(box) + FOOT / 2
  const cues = await poll(handles, cues => assert.ok(cues.length >= 3, `its cues found: ${cues}`), 8000)
  const cue = box.x + cues.find(h => Math.abs(h - (x(1) - box.x)) < 20)
  const end = async was => { await page.waitForFunction(was => !scriptText().includes(was), was); const [, a, d] = (await code()).match(/\.mark\(\{ at: ([\d.]+), d: ([\d.]+) \}\)/); return +a + +d }
  // 2 px past the cue at 1 s, where the hit starts: on it
  await drag(await grab([[x(.8) + 3, strip]], 'ew-resize'), [cue + 2 - x(.8), 0])
  const on = await end('d: 0.2 }')
  assert.ok(Math.abs(on - 1) < .012, `on the cue at 1 s: ${on}`)
  // 5 px past it, where it was let go
  await drag(await grab([[x(on) + 3, strip]], 'ew-resize'), [5, 0])
  const past = await end(`d: ${+(on - .6).toFixed(6)} }`)
  assert.ok(past - on > .005, `5 px past it, where it was put: ${past}, the cue ${on}`)
})

// A marker is its track's, in its lane's strip: one a track not edited set is taken away from its triangle all the
// same, its mark() gone
test('editor: with tracks, a marker of a track not edited is taken away from its triangle', async () => {
  await open()
  await write(`let a = audio('chime.wav')\n  .mark(1, 'here')\n\nlet b = audio('chime.wav')\n  .gain(-6)`)
  await page.waitForFunction(() => document.querySelector('.plot').dataset.tracks === '2')
  await lengthIs('0:08.000')
  // its triangle in the strip under its lane
  const { x } = await axis(8), [a] = await tracksAt()
  await page.mouse.click(x(1), a.y + a.h + FOOT / 2, { button: 'right' })
  await contextRow('Delete the marker').click()
  await page.waitForFunction(() => !scriptText().includes('.mark('))
  assert.match(await code(), /^let a = audio\('chime.wav'\)\s*let b = audio\('chime.wav'\)\n {2}\.gain\(-6\)$/)
})

// A marker is its track's alone: a double-click in another track's lane goes past it, in its own stops at it; a press
// on its line edits its track
test('editor: with tracks, a track\'s markers are its own', async () => {
  await open()
  await write(`let a = audio('chime.wav')\n  .mark(1)\n\nlet b = audio('chime.wav')\n  .gain(-6)`)
  await page.waitForFunction(() => document.querySelector('.plot').dataset.tracks === '2')
  await lengthIs('0:08.000')
  await page.waitForFunction(() => document.querySelector('.steps-list .step-name')?.textContent === 'b · chime.wav')
  // the lanes' middles, as their layers have them; a's marker's line down its lane
  const { box, x } = await axis(8), mid = async i => (r => r.y + r.h / 2)((await tracksAt())[i])
  const from = async () => +(await selected()).split('–')[0].split(':')[1]
  await page.mouse.dblclick(x(1.05), await mid(1))
  assert.ok(await from() < .99, `b's fragment from ${await from()}, past a's marker`)
  await page.mouse.dblclick(x(1.05), await mid(0))
  await page.waitForFunction(() => document.querySelector('.steps-list .step-name')?.textContent === 'a · chime.wav')
  assert.equal(await from(), 1, 'a\'s fragment from its marker')
  await page.mouse.click(x(6), await mid(1))
  await page.waitForFunction(() => document.querySelector('.steps-list .step-name')?.textContent === 'b · chime.wav')
  await page.mouse.click(x(1), box.y + 4)
  await page.waitForFunction(() => document.querySelector('.steps-list .step-name')?.textContent === 'a · chime.wav')
  assert.equal(await page.locator('.time').innerText(), '0:01.000', 'the caret on it')
})

test('editor: Alt-click adds carets; M puts a marker at each', async () => {
  await page.route('**/playground/editor.js', async route => { const r = await route.fetch(); route.fulfill({ response: r, body: (await r.text()).replace('v = view(', 'v = globalThis.__view = view(') }) })
  await open()
  await write(`audio('chime.wav')`)
  await lengthIs('0:08.000')
  const { box, x } = await axis(8), y = box.y + tall(box) * .3
  await page.mouse.click(x(2.2), y)
  await page.keyboard.down('Alt')
  // the caret there as the press goes down, not as it is let go
  await page.mouse.move(x(4.2), y)
  await page.mouse.down()
  const pressed = await page.evaluate(() => __view.carets)
  await page.mouse.up()
  assert.ok(pressed.length === 2 && Math.abs(pressed[1] - 4.2) < .05, `pressed, a caret there: ${pressed}`)
  await page.mouse.click(x(6.2), y)
  await page.keyboard.up('Alt')
  assert.ok(await offered('A marker at each of the 3 carets'))
  await page.keyboard.press('m')
  await page.waitForFunction(() => (scriptText().match(/\.mark\(/g) || []).length === 3)
  assert.deepEqual([...(await code()).matchAll(/\.mark\(([\d.]+)\)/g)].map(m => Math.round(+m[1] * 10) / 10), [2.2, 4.2, 6.2])
  // Alt-click on a caret takes it away; a paste goes to each left, from the last back so each time holds
  await write(`audio('chime.wav').copy({ at: 0, duration: 0.5 })`)
  await lengthIs('0:08.000')
  await page.mouse.click(x(2.2), y)
  await page.keyboard.down('Alt')
  await page.mouse.click(x(4.2), y)
  await page.mouse.click(x(6.2), y)
  await page.mouse.click(x(4.2), y)
  await page.keyboard.up('Alt')
  assert.ok(await offered('Paste at all 2'))
  await page.keyboard.press('ControlOrMeta+V')
  await page.waitForFunction(() => (scriptText().match(/\.paste\(/g) || []).length === 2)
  assert.deepEqual([...(await code()).matchAll(/\.paste\(([\d.]+), 0\.01\)/g)].map(m => Math.round(+m[1] * 10) / 10), [6.2, 2.2])
  // a plain click leaves one caret: a paste there alone
  await page.mouse.click(x(3), y)
  assert.ok(await offered('Paste at the caret'))
})

// The markers are the script's: a reload runs it again on the file kept, which is still opening as it runs, and they
// come back where they were, a moment's and a range's
test('editor: markers on a file opened come back where they were after a reload', async () => {
  await open()
  const file = await readFile(resolve(root, 'test/fixture.wav'))
  await page.locator('.file-input').setInputFiles({ name: 'marked.wav', mimeType: 'audio/wav', buffer: file })
  await lengthIs('0:02.000')
  await write(`audio('marked.wav').mark(0.5, 'a').mark({ at: 1.2, d: 0.4 }, 'r')`)
  // kept: the file in the browser's files, the script with the page
  await poll(keptFiles, k => assert.ok(k.includes('marked.wav'), `kept: ${k}`))
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('audio-repl')).docs.some(d => d.code.includes(".mark({ at: 1.2, d: 0.4 }, 'r')")))
  await page.reload()
  await wholeLevels().waitFor()
  const { box, x } = await axis(2), strip = box.y + tall(box) + FOOT / 2
  const at = async (t, y = strip) => { await page.mouse.move(x(t), y); return page.locator('.plot').evaluate(el => el.style.cursor) }
  await grab([[x(0.5), strip]], 'ew-resize')
  assert.equal(await at(1.4), 'pointer', 'the range, in its strip')
  assert.notEqual(await at(0.9), 'pointer', 'none before it')
  assert.notEqual(await at(1.8), 'pointer', 'none past it')
})

// The strip under the lanes, as Photoshop's split slider marks a range under its bar: a named range ◢ its name ◣
// there, small triangles hanging from the lanes' foot, nothing between them but a fill while it is selected, nothing of
// it over the sound but its stretch pointed at; its name still in sight once it is selected, no line of the selection
// in the strip. Plain
// hovered over the lanes, as a scrub shows them: the cues either side of the pointer, a line each down the lanes in the
// cues' colour; on one, a short wash on its sound's side
test('editor: the strip under the lanes marks a range ◢ named ◣, nothing over the sound; hovered, the cues either side', async () => {
  await open()
  await write(`audio('chime.wav').mark({ at: 2, d: 2 }, 'Chorus')`)
  await lengthIs('0:08.000')
  const { box, x } = await axis(8), lane = Math.round(tall(box)), px = t => Math.round(x(t) - box.x)
  // in a strip of columns [a, b) and rows [y0, y1), the pixels unlike the ground there (its column at 7 s, where nothing
  // is) by more than `by`
  const marked = ([a, b], [y0, y1], by = 45) => pixels(`let n = 0; for (let y = arg.y0; y < arg.y1; y++) { const g = (y * w + arg.g) * 4; for (let x = arg.a; x < arg.b; x++) { const i = (y * w + x) * 4; if (Math.abs(d[i] - d[g]) + Math.abs(d[i + 1] - d[g + 1]) + Math.abs(d[i + 2] - d[g + 2]) > arg.by) n++ } } return n`, { a, b, y0, y1, by, g: px(7) })
  const row = [lane + 1, lane + FOOT - 1]
  await page.mouse.move(box.x + 5, box.y + box.height - 8)
  await page.waitForFunction(() => document.querySelector('.readout')?.dataset.of === 'all')
  assert.ok(await marked([px(2) - 6, px(2) + 1], [lane, lane + 9]) > 10 && await marked([px(4), px(4) + 7], [lane, lane + 9]) > 10, 'its triangles hanging from the lanes\' foot, at its start and its end')
  assert.equal(await marked([px(1.9), px(2) + 1], [lane + 10, lane + FOOT]), 0, 'as tall as its name\'s capitals')
  // from its name to its end nothing of it: no line, no fill
  assert.equal(await marked([px(3.2), px(3.8)], [lane, lane + 9], 30), 0, 'nothing between its name and its end')
  // pointed at, its stretch lit over the sound, as a press there would select it; between its triangles, nothing
  await page.mouse.move(x(3.5), box.y + lane + 4)
  await poll(() => marked([px(3.2), px(3.8)], [2, 6], 15), over => assert.ok(over >= (px(3.8) - px(3.2)) * 3, `lit over the sound pointed at: ${over}`), 2000)
  assert.equal(await marked([px(3.2), px(3.8)], [lane + 1, lane + 7], 15), 0, 'nothing between its triangles pointed at')
  await page.mouse.move(box.x + 5, box.y + box.height - 8)
  // its name after its start
  assert.ok(await marked([px(2) + 3, px(2) + 50], row, 240) > 15, 'its name between them')
  // nothing of it over the sound: the lanes' top row, over it and past it, alike
  const top = [2, 6]
  assert.equal(await marked([px(2.5), px(3.5)], top), 0, 'no wash over the sound')
  // pressed there: selected, its name still in sight, its triangles lit, nothing between them; a selection elsewhere,
  // nothing of it in the strip (the end's triangle's ink, all its channels summed)
  const ink = () => pixels(`let n = 0; for (let y = arg.y0; y < arg.y1; y++) for (let x = arg.a; x < arg.b; x++) { const i = (y * w + x) * 4; n += d[i] + d[i + 1] + d[i + 2] } return n`, { a: px(4), b: px(4) + 6, y0: lane + 1, y1: lane + 10 })
  const resting = await ink()
  await page.mouse.click(x(3), box.y + lane + FOOT / 2)
  assert.equal(await selected(), '0:02.000–0:04.000')
  await page.mouse.move(box.x + 5, box.y + box.height - 8)
  assert.ok(await marked([px(2) + 3, px(2) + 50], row, 240) > 15, 'its name, selected')
  assert.equal(await marked([px(3.2), px(3.8)], [lane + 1, lane + 7], 15), 0, 'selected, nothing between its triangles')
  assert.ok(await ink() > resting * 1.1, `selected, its triangles lit: ${resting} → ${await ink()}`)
  await drag([x(5), box.y + lane / 2], [x(6) - x(5), 0])
  await page.mouse.move(box.x + 5, box.y + box.height - 8)
  assert.equal(await marked([px(5.2), px(5.8)], [lane + 1, lane + FOOT - 1]), 0, 'no line of the selection in the strip')
  await page.mouse.click(x(.5), box.y + lane / 2)
  // plain hovered over the lanes between two strikes: a line at the cue either side, in the cues' colour, down the lanes
  // (their top rows, over the sound's quiet edge)
  const lines = () => pixels(`const out = []; for (let x = 0; x < arg.w; x++) { const i = (arg.y * w + x) * 4; if (d[i] - d[i + 2] > 30 && (!out.length || x - out.at(-1) > 2)) out.push(x) } return out`, { y: 3, w: px(7.9) })
  let near = []
  for (const until = Date.now() + 8000; near.length < 2 && Date.now() < until; await page.waitForTimeout(200)) { await page.mouse.move(x(5.3), box.y + lane / 3); near = await lines() }
  assert.ok(near.length === 2 && near[0] < px(5.3) && near[1] > px(5.3), `a line either side of 5.3 s: ${near}`)
  // between them, no wash; on one (within 3 px, where a press would snap), a short wash on the side its sound is on
  // (after a strike), gone within WASH (8) px, none before it
  const tint = (xs, dx) => pixels(`return arg.xs.map(x => { const i = (arg.y * w + x + arg.dx) * 4; return d[i] - d[i + 2] })`, { xs, y: 3, dx })
  assert.ok((await tint(near, 3)).every(v => v < 4), 'between them, no wash')
  const [on] = near
  await page.mouse.move(box.x + on + 1, box.y + lane / 3)
  await poll(async () => [await tint([on], 3), await tint([on], -3), await tint([on], 12)], ([after, before, past]) => assert.ok(after[0] >= 8 && before[0] < 4 && past[0] < 4, `on it, washed after it: ${after}; before: ${before}; 12 px on: ${past}`), 3000)
  // held Alt, every cue's line
  await page.keyboard.down('Alt')
  await poll(lines, all => assert.ok(all.length > 2, `held Alt, ${all.length} lines`), 3000)
  await page.keyboard.up('Alt')
  // snapping off: none, a press going where it is
  await menu('View', 'Snap to cues and markers')
  await page.mouse.move(x(5.3), box.y + lane / 3)
  await poll(lines, near => assert.deepEqual(near, [], 'none with snapping off'), 3000)
  // the pointer gone from the lanes: none
  await page.mouse.move(box.x + 5, box.y + box.height - 8)
  await poll(lines, near => assert.deepEqual(near, [], 'none with the pointer off the lanes'), 3000)
})

// A range pointed at in its strip lights its stretch over the sound, as a press there would select it; selected
// already, nothing more: its stretch is not lit twice
test('editor: a range selected, pointed at in its strip, is not lit over the sound again', async () => {
  await open()
  await noCues()
  await write(`audio('chime.wav').mark({ at: 2, d: 2 })`)
  await lengthIs('0:08.000')
  const { box, x } = await axis(8), lane = tall(box), strip = box.y + lane + FOOT / 2
  // the lanes' top row in it, over the sound's quiet edge, once the pointer there is drawn
  const shade = async (px, py) => { await page.mouse.move(px, py); await frames(); return pixels(`const i = (arg.y * w + arg.x) * 4; return d[i] + d[i + 1] + d[i + 2]`, { x: Math.round(x(3.5) - box.x), y: 3 }) }
  const away = [box.x + 5, box.y + box.height - 8]
  const ground = await shade(...away), lit = await shade(x(3.5), strip)
  assert.ok(lit > ground + 10, `pointed at, lit: ${ground} → ${lit}`)
  await page.mouse.click(x(3.5), strip)
  assert.equal(await selected(), '0:02.000–0:04.000')
  const chosen = await shade(...away), again = await shade(x(3.5), strip)
  assert.ok(Math.abs(again - chosen) <= 3, `selected, pointed at again: ${chosen} → ${again}`)
})

// A marker's triangle dragged moves the marker alone: the caret stays where it was, and what plays plays on, not from
// the marker; clicked, the caret goes to it
test('editor: a marker dragged moves alone, the caret and what plays staying where they are', async () => {
  await open()
  await noCues()
  await write(`audio('chime.wav').mark(2)`)
  await lengthIs('0:08.000')
  const { box, x } = await axis(8), y = box.y + tall(box) * .3, row = box.y + tall(box) + FOOT / 2
  const now = async () => +(await page.locator('.time').innerText()).split(':')[1]
  await page.mouse.click(x(6), y)
  await drag(await grab([[x(2), row]], 'ew-resize'), [x(3) - x(2), 0])
  await page.waitForFunction(() => +(scriptText().match(/\.mark\(([\d.]+)\)/)?.[1]) > 2.9)
  assert.equal(await now(), 6, 'the caret where it was')
  // playing from the start: dragged back, the marker moves, the playhead goes on from where it was
  await page.mouse.click(x(.2), y)
  await page.keyboard.press('Space')
  await page.getByRole('button', { name: 'Pause' }).waitFor()
  await drag(await grab([[x(3), row]], 'ew-resize'), [x(5) - x(3), 0])
  await page.waitForFunction(() => +(scriptText().match(/\.mark\(([\d.]+)\)/)?.[1]) > 4.9)
  assert.ok(await now() < 2.5, `played on from the start, not from the marker: ${await now()}`)
  await page.keyboard.press('Space')
  // clicked: the caret to it
  await page.mouse.click(...await grab([[x(5), row]], 'ew-resize'))
  assert.ok(Math.abs(await now() - 5) < .05, String(await now()))
})
