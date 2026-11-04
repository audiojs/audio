// Tracks: lanes, layers, the room under them; made, split, lined up, ducked, mastered; the server, the page and the
// helpers in page.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import audio from '../../audio.js'
import { page, origin, sine, wavBytes, code, readout, open, settled, frames, poll, still, choice, selected, tab, menu, noCues, write, TRACK, ROOM, FOOT, HEAD, tall, tracksAt, gutter, axis, grab, drag, lengthIs, pixels, chime, contextRow } from './page.js'

// A file dropped under the lanes, in the room: a track of its own, named for it, from where it was let go
test('editor: a file dropped under the lanes goes into a new track of its own there', async () => {
  const { box, x } = await chime()
  const bytes = await wavBytes([sine(.5, 440, .5)])
  await page.evaluate(({ bytes, x, y }) => {
    const target = document.querySelector('.plot'), data = new DataTransfer()
    data.items.add(new File([new Uint8Array(bytes)], 'tone.wav', { type: 'audio/wav' }))
    const at = { bubbles: true, cancelable: true, dataTransfer: data, clientX: x, clientY: y }
    target.dispatchEvent(new DragEvent('dragover', at))
    target.dispatchEvent(new DragEvent('drop', at))
  }, { bytes: [...bytes], x: x(2), y: box.y + tall(box) + FOOT + ROOM / 2 })
  await page.waitForFunction(() => /^let chime = audio\('chime\.wav'\)\n\nlet tone = audio\.from\(0\)\n  \.write\(audio\('tone\.wav'\), \{ at: (1\.99|2|2\.01) \}\)$/.test(scriptText()))
})

// A muted track's waveform drawn dim, the ground under it as it is: no veil over its lane, which lit the ground as a
// selection does
test('editor: a muted track\'s waveform is dim, its lane\'s ground as it was', async () => {
  await open()
  await noCues()
  await write(`let a = audio.from(t => .6 * Math.sin(2 * Math.PI * 220 * t), { duration: 3 })\n\nlet b = audio.from(t => .6 * Math.sin(2 * Math.PI * 330 * t), { duration: 3 })`)
  await page.locator('.track-mute').nth(1).waitFor()
  await settled()
  const box = await page.locator('.plot').boundingBox()
  const rows = await page.evaluate(() => [...document.querySelectorAll('.layer')].map(l => l.getBoundingClientRect().bottom))
  // the second lane's ground near its top, and its waveform's middle, the brightest across its middle row
  const look = () => pixels(`const at = (x, y) => d[(Math.round(y) * w + Math.round(x)) * 4]; let wave = 0; for (let x = 20; x < 400; x++) wave = Math.max(wave, at(x, arg.mid)); return { ground: at(200, arg.top), wave }`, { top: rows[1] - box.y + 6, mid: rows[1] - box.y + 80 })
  const was = await look()
  await page.locator('.track-mute').nth(1).click()
  await settled()
  await still()
  const now = await look()
  assert.ok(Math.abs(now.ground - was.ground) <= 2, `the ground as it was: ${was.ground} → ${now.ground}`)
  assert.ok(now.wave < was.wave - 40, `the waveform dim: ${was.wave} → ${now.wave}`)
})

// A selection moved to a track of its own (the context menu): a lane each, the sound as long as before; the new track
// edited, its steps the edits'. A press in the other lane edits that track: Delete takes out of it alone. The
// track deleted (the Edit menu), one sound again; undone, the tracks again
test('editor: a selection moved to a track of its own, a lane each, each edited apart', async () => {
  await open()
  await noCues()
  await write(`audio('chime.wav')`)
  await lengthIs('0:08.000')
  // the edits' first card, the sound they start from, the panel open or not
  const card = () => page.locator('.steps-list .step-name').first().textContent()
  // in the sound's lanes before there are tracks; then each track's lane's middle, the edited one's tall, the other's a
  // strip, as their layers have them
  let { box, x } = await axis(8), mid = async i => (r => r.y + r.h / 2)((await tracksAt())[i])
  await drag([x(2), box.y + tall(box) / 4], [x(3) - x(2), 0])
  await menu('Track', 'Move to a new track')
  await page.waitForFunction(() => scriptText().includes('let chime2 = '))
  assert.equal(await code(), `let chime = audio('chime.wav')\n  .gain(-Infinity, { at: 2, d: 1 })\n\nlet chime2 = audio('chime.wav')\n  .crop({ at: 2, d: 1 })\n  .pad(2, 0)`)
  await page.waitForFunction(() => document.querySelector('.steps-list .step-name')?.textContent === 'chime2 · chime.wav')
  // its output: a lane each, the lower the piece alone, nothing after it where the upper has the sound
  await page.waitForFunction(() => document.querySelector('.plot').dataset.tracks === '2')
  await lengthIs('0:08.000')
  await settled()
  await still()
  // (the layers beside the picture now, the picture after them)
  ;({ box, x } = await axis(8))
  const [u, l] = await tracksAt()
  await poll(() => pixels(`const k = w / arg.width, lit = [0, 0]
    for (let y = 0; y < Math.round(arg.foot * k); y++) for (let x = Math.round(arg.a * k); x < Math.round(arg.b * k); x++) { const i = (y * w + x) * 4; if (d[i] + d[i + 1] + d[i + 2] > 300) lit[y < arg.mid * k ? 0 : 1]++ }
    return lit`, { width: box.width, mid: l.y - box.y, foot: l.y + l.h - box.y, a: x(4.5) - box.x, b: x(7) - box.x }),
    ([upper, lower]) => assert.ok(upper > 200 && lower < upper / 20, `4.5 s to 7 s: the upper lane ${upper} lit, the lower ${lower}`))
  assert.equal(await selected(), '0:02.000–0:03.000', 'the piece stays selected, in its own lane')
  // the upper lane: the first track's, a range deleted there alone
  await page.mouse.click(x(6), await mid(0))
  await page.waitForFunction(() => document.querySelector('.steps-list .step-name')?.textContent === 'chime · chime.wav')
  await drag([x(5), await mid(0)], [x(6) - x(5), 0])
  await page.keyboard.press('Backspace')
  await page.waitForFunction(() => /\.gain\(-Infinity, \{ at: 2, d: 1 \}\)\n {2}\.remove\(\{ at: 5, d: 1(, xfade: [\d.]+)? \}\)\n\nlet chime2/.test(scriptText()))
  await lengthIs('0:07.000')
  // the lower lane's track taken away: one sound, its steps as they were
  await page.mouse.click(x(1), await mid(1))
  await page.waitForFunction(() => document.querySelector('.steps-list .step-name')?.textContent === 'chime2 · chime.wav')
  await menu('Track', 'Delete the track')
  await page.waitForFunction(() => !scriptText().includes('chime2'))
  assert.equal(await card(), 'chime.wav')
  await page.waitForFunction(() => !('tracks' in document.querySelector('.plot').dataset))
  await page.keyboard.press('ControlOrMeta+Z')
  await page.waitForFunction(() => scriptText().includes('let chime2 = ') && document.querySelector('.plot').dataset.tracks === '2')
})

// A range dragged on the time row runs through every track's lane, as a DAW's ruler selects: Delete takes it out of each,
// one step, so they stay in time. A range in a lane is that track's: ⌘-dragged up into the other lane, its audio goes
// into that track over what is there (write(), its sound written out), silence where it was, that track edited then
test('editor: a range on the time row is every track\'s; a selection ⌘-dragged into another lane goes into that track', async () => {
  await open()
  await noCues()
  await write(`let a = audio('chime.wav')\n\nlet b = audio('chime.wav')`)
  await page.waitForFunction(() => document.querySelector('.plot').dataset.tracks === '2')
  await lengthIs('0:08.000')
  // the lanes' middles, as their layers have them; the time row under them
  const { box, x } = await axis(8), mid = async i => (r => r.y + r.h / 2)((await tracksAt())[i]), row = box.y + box.height - 11
  await drag([x(2), row], [x(3) - x(2), 0])
  assert.equal(await selected(), '0:02.000–0:03.000')
  await page.keyboard.press('Backspace')
  await page.waitForFunction(() => (scriptText().match(/\.remove\(\{ at: 2, d: 1(, xfade: [\d.]+)? \}\)/g) || []).length === 2)
  await lengthIs('0:07.000')
  await page.keyboard.press('ControlOrMeta+Z')
  await page.waitForFunction(() => !scriptText().includes('remove'))
  await lengthIs('0:08.000')
  // the lower lane's own range, ⌘-dragged up into the upper lane, 4 s on
  await page.mouse.click(x(6), await mid(1))
  const top = await mid(0), bottom = await mid(1)
  await drag([x(1), bottom], [x(2) - x(1), 0])
  await page.keyboard.down('ControlOrMeta')
  await drag([x(1.5), bottom], [x(5.5) - x(1.5), top - bottom])
  await page.keyboard.up('ControlOrMeta')
  await page.waitForFunction(() => scriptText().includes('.write('))
  assert.equal(await code(), `let a = audio('chime.wav')\n  .write(audio('chime.wav').crop({ at: 1, d: 1 }), { at: 5 })\n\nlet b = audio('chime.wav')\n  .gain(-Infinity, { at: 1, d: 1 })`)
  await page.waitForFunction(() => document.querySelector('.steps-list .step-name')?.textContent === 'a · chime.wav')
  assert.equal(await selected(), '0:05.000–0:06.000', 'the piece selected where it landed, in the track it went to')
})

// A track with steps moved out of: the steps are both parts', written once in the sound both copy, and each part's edits
// list them first, the tracks sharing them said under them; the steps after are its own. The other part deleted, the
// shared steps go back into the one left
test('editor: the steps two tracks share are written once, listed in each, said to be shared', async () => {
  await open()
  await noCues()
  await write(`audio('chime.wav')\n  .gain(-3)`)
  await lengthIs('0:08.000')
  const { box, x } = await axis(8), top = box.y + (box.height - 22) * .25
  await drag([x(2), top], [x(3) - x(2), 0])
  await menu('Track', 'Move to a new track')
  await page.waitForFunction(() => scriptText().includes('let chime2 = '))
  assert.equal(await code(), `let chimeTake = audio('chime.wav')\n  .gain(-3)\n\nlet chime = chimeTake.clone()\n  .gain(-Infinity, { at: 2, d: 1 })\n\nlet chime2 = chimeTake.clone()\n  .crop({ at: 2, d: 1 })\n  .pad(2, 0)`)
  await page.waitForFunction(() => document.querySelector('.plot').dataset.tracks === '2')
  await lengthIs('0:08.000')
  // the new track's edits (the panel open or not): the sound, the shared gain, the caption under it, then its own crop and pad
  const cards = () => page.evaluate(() => [...document.querySelectorAll('.steps-list > li')].map(li => [li.querySelector('.step-name')?.textContent, li.classList.contains('shared'), li.dataset.shared ?? '']))
  await page.waitForFunction(() => document.querySelectorAll('.steps-list > li').length === 4)
  assert.deepEqual(await cards(), [['chime2 · chime.wav', true, ''], ['Gain', true, 'Shared with chime'], ['Crop', false, ''], ['Pad', false, '']])
  // the other track's (its lane a strip over the edited one's): the same shared steps, its own after
  await page.mouse.click(x(6), (r => r.y + r.h / 2)((await tracksAt())[0]))
  await page.waitForFunction(() => document.querySelector('.steps-list .step-name')?.textContent === 'chime · chime.wav')
  assert.deepEqual(await cards(), [['chime · chime.wav', true, ''], ['Gain', true, 'Shared with chime2'], ['Gain', false, '']])
  // that track deleted: one sound, the shared steps back in the chain of the one left
  await menu('Track', 'Delete the track')
  await page.waitForFunction(() => !scriptText().includes('chimeTake'))
  assert.equal(await code(), `let chime2 = audio('chime.wav')\n  .gain(-3)\n  .crop({ at: 2, d: 1 })\n  .pad(2, 0)`)
  await page.waitForFunction(() => !('tracks' in document.querySelector('.plot').dataset))
})

// A track ending before the mix runs on in its lane: no rule at its end, its centre line stopping there, which says so;
// a double-click on its sound keeps to it, one past it takes the time from its end on, as a pause; one on a lane not
// edited, before its cues are found, keeps to the sound between its pauses
test('editor: a track ends where its sound does, its lane running on past it', async () => {
  await open()
  await noCues()
  await write(`audio('chime.wav')`)
  await lengthIs('0:08.000')
  await write(`let chime = audio('chime.wav')\n  .gain(-Infinity, { at: 2, d: 1 })\n\nlet chime2 = audio('chime.wav')\n  .crop({ at: 2, d: 1 })\n  .pad(2, 0)`)
  await page.waitForFunction(() => document.querySelector('.plot').dataset.tracks === '2')
  await lengthIs('0:08.000')
  await settled()
  await still()
  // the lanes' middles, as their layers have them: the upper a strip, the lower, edited, tall
  const { box, x } = await axis(8), mid = async i => (r => r.y + r.h / 2)((await tracksAt())[i]), [, l] = await tracksAt()
  // past the lower track's end, nothing bright in its lane: neither its centre line nor a rule
  const lower = await pixels(`const k = w / arg.width; let n = 0
    for (let y = Math.round(arg.top * k); y < Math.round(arg.foot * k); y++) for (let x = Math.round(arg.a * k); x < Math.round(arg.b * k); x++) { const i = (y * w + x) * 4; if (d[i] + d[i + 1] + d[i + 2] > 300) n++ }
    return n`, { width: box.width, top: l.y - box.y, foot: l.y + l.h - box.y, a: x(3.2) - box.x, b: x(7.5) - box.x })
  assert.equal(lower, 0, 'past its end the lower lane is plain')
  await page.mouse.dblclick(x(2.6), await mid(1))
  await page.waitForFunction(() => /–0:03\.000:/.test((e => e.title || e.dataset.tip || '')(document.querySelector('.clock'))))
  await page.mouse.dblclick(x(5), await mid(1))
  await page.waitForFunction(() => (e => e.title || e.dataset.tip || '')(document.querySelector('.clock')).startsWith('Selected 0:03.000–0:08.000:'))
  await page.mouse.click(x(6), await mid(0))
  await page.waitForFunction(() => document.querySelector('.steps-list .step-name')?.textContent === 'chime · chime.wav')
  // the lower, a strip now, double-clicked: it is edited at the first press, tall from where it was, the second in it still
  await page.mouse.dblclick(x(2.9), await mid(1))
  const [a, b] = (await selected()).split('–').map(t => +t.split(':')[1])
  assert.ok(a > 1.9 && b === 3, `the piece, not from the start: ${a}–${b}`)
})

// The voice split to a track of its own (the context menu at the caret, or the Edit menu): the model's voice there, the
// rest here, the new one edited, the model the GPU's where there is one; undone, one sound. Its sound is the engine test's (the voice split… sounds as before)
test('editor: the voice split to a track of its own, edited apart, undone in one step', async () => {
  await page.route(/huggingface\.co/, route => route.abort())
  await open()
  await noCues()
  await write(`audio('chime.wav')`)
  await lengthIs('0:08.000')
  const { box, x } = await axis(8)
  await page.mouse.click(x(1), box.y + tall(box) * .3)
  await menu('Track', 'Split the voice to a new track')
  await page.waitForFunction(() => scriptText().includes('let voice = '))
  // headless Chromium's WebGPU is SwiftShader, on the CPU: the split takes SCNet-large there (Mel-RoFormer on a GPU)
  assert.equal(await code(), `let chime = audio('chime.wav')\n  .vocals('remove', { model: 'scnet-large' })\n\nlet voice = audio('chime.wav')\n  .vocals({ model: 'scnet-large' })`)
  await page.waitForFunction(() => document.querySelector('.steps-list .step-name')?.textContent === 'voice · chime.wav')
  await page.keyboard.press('ControlOrMeta+Z')
  await page.waitForFunction(() => !scriptText().includes('voice'))
  await menu('Track', 'Split the voice to a new track')
  await page.waitForFunction(() => scriptText().includes('let voice = '))
})

// A part taken elsewhere and brought back: a track exported alone, named after it; another lined up with it (the Edit
// menu), its sound written out as the reference, so both stay tracks
test('editor: a track exported alone; another lined up with it, both tracks still', async () => {
  await open()
  await write(`let chime = audio('chime.wav')\n\nlet late = audio('chime.wav')\n  .pad(0.25, 0)`)
  await page.waitForFunction(() => document.querySelector('.plot').dataset.tracks === '2')
  await page.waitForFunction(() => document.querySelector('.steps-list .step-name')?.textContent === 'late · chime.wav')
  const [d] = await Promise.all([page.waitForEvent('download'), menu('File', 'Export as', 'The track alone')])
  assert.match(d.suggestedFilename(), /-late\.\w+$/)
  const alone = await audio(await readFile(await d.path()))
  await alone.read()
  assert.ok(Math.abs(alone.duration - 8.25) < .01, `that track alone, 0.25 s late: ${alone.duration} s`)
  await menu('Track', 'Line up with', 'chime')
  await page.waitForFunction(() => scriptText().includes('.align('))
  assert.equal(await code(), `let chime = audio('chime.wav')\n\nlet late = audio('chime.wav')\n  .pad(0.25, 0)\n  .align(audio('chime.wav'))`)
  await page.waitForFunction(() => document.querySelector('.plot').dataset.tracks === '2')
  await lengthIs('0:08.000')
})

// Automix: a bed ducked under the voice (Edit › Duck under, the key read by name, both still tracks), a master added
// (Edit › Add a master: the tracks' sum, a lane of its own, edited as one), taken away again (Delete the track)
test('editor: a bed ducked under the voice, a master over both, a lane of its own', async () => {
  await open()
  await write(`let chime = audio('chime.wav')\n\nlet bed = audio('chime.wav')\n  .gain(-12)`)
  await page.waitForFunction(() => document.querySelector('.plot').dataset.tracks === '2')
  await page.waitForFunction(() => document.querySelector('.steps-list .step-name')?.textContent === 'bed · chime.wav')
  await menu('Track', 'Duck under', 'chime')
  await page.waitForFunction(() => scriptText().includes('.ducker('))
  assert.equal(await code(), `let chime = audio('chime.wav')\n\nlet bed = audio('chime.wav')\n  .gain(-12)\n  .ducker({ key: chime, range: -15 })`)
  await page.waitForFunction(() => document.querySelector('.plot').dataset.tracks === '2')
  await menu('Track', 'Add a master')
  await page.waitForFunction(() => scriptText().includes('.clone().mix('))
  assert.equal(await code(), `let chime = audio('chime.wav')\n\nlet bed = audio('chime.wav')\n  .gain(-12)\n  .ducker({ key: chime, range: -15 })\n\nchime.clone().mix(bed)`)
  await page.waitForFunction(() => document.querySelector('.plot').dataset.tracks === '3')
  await lengthIs('0:08.000')
  await menu('Track', 'Delete the track')
  await page.waitForFunction(() => !scriptText().includes('.clone()'))
  await page.waitForFunction(() => document.querySelector('.plot').dataset.tracks === '2')
})

// A link's script with tracks opens in a new page with none of them chosen: the page comes up on its last lane (the
// master, here), nothing thrown on the way (it threw before the page's state was made: Cannot access 'listening')
test('editor: a link to a script with tracks and a master opens, the master edited', async () => {
  const errors = []
  page.on('pageerror', e => errors.push(e.message))
  await page.goto(origin + '/blank.html')
  const url = await page.evaluate(async text => {
    const bytes = new Uint8Array(await new Response(new Blob([text]).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer())
    return location.origin + '/playground/#code=' + btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  }, `let chime = audio('chime.wav')\n\nlet bed = audio('chime.wav')\n  .ducker({ key: chime })\n\nchime.clone().mix(bed)\n  .gain(-6)`)
  await page.goto(url)
  await page.waitForFunction(() => document.querySelector('.plot')?.dataset.tracks === '3')
  await page.waitForFunction(() => [...document.querySelectorAll('.steps-list .step-name')].some(n => n.textContent.includes('Gain')))
  assert.deepEqual(errors, [])
})

// With tracks, the caret is the edited track's: out of sight, it stays at the edge in that track's lane, none in
// another's; its chevron on the time row, which runs under them all
test('editor: with tracks, the caret out of sight stays at the edge in its track\'s lane', async () => {
  await open()
  await noCues()
  await write(`let a = audio('chime.wav')\n\nlet b = audio('chime.wav')\n  .gain(-6)`)
  await page.waitForFunction(() => document.querySelector('.plot').dataset.tracks === '2')
  await lengthIs('0:08.000')
  await page.waitForFunction(() => document.querySelector('.steps-list .step-name')?.textContent === 'b · chime.wav')
  // the lanes' middles, as their layers have them: a's a strip, b's, edited, tall
  const box = await page.locator('.plot').boundingBox(), w = box.width - (await gutter()), [a, b] = await tracksAt(), top = a.y + a.h / 2, bottom = b.y + b.h / 2
  await page.mouse.move(box.x + w / 2, bottom)
  for (let i = 0; i < 7; i++) { await page.keyboard.down('Control'); await page.mouse.wheel(0, -120); await page.keyboard.up('Control') }
  await page.mouse.click(box.x + w / 2, bottom)
  await page.mouse.wheel(0, w * 3)
  await page.mouse.move(box.x + w / 2, box.y + 4)
  // the overlay's opacity at the lanes' left edge, a row px down the plot
  const edge = py => page.evaluate(py => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(() => {
    const cv = document.querySelector('.plot canvas.overlay'), k = cv.width / cv.getBoundingClientRect().width
    done(cv.getContext('2d').getImageData(0, Math.round(py * k), 1, 1).data[3])
  }))), py)
  await poll(() => edge(bottom - box.y), e => assert.ok(e > 0, 'at the edge of b\'s lane'))
  assert.equal(await edge(top - box.y), 0, 'none in a\'s')
  // its chevron at the foot of its line in b's lane
  await page.mouse.move(box.x + 6, b.y + b.h - 7)
  assert.equal(await page.locator('.plot').evaluate(e => e.style.cursor), 'pointer', 'its chevron at its line\'s foot')
})

// Dragged into another track, a piece shows there as it goes, over what it covers, and where it left, silence; let go,
// both stay so at once, frozen (veiled, a light passing along, nothing pressed there) till the output comes, as Suno
// Studio's parts calculating; it was gone from both till then
test('editor: a piece dragged into another track shows there as it goes; dropped, both lanes as they will be, frozen till done', async () => {
  await open()
  await noCues()
  await write(`let a = audio('chime.wav')\n\nlet b = audio.from(t => 0, { duration: 8 })`)
  await page.locator('.layer').nth(1).waitFor()
  // a edited (a press in its strip), its lane tall, b's a strip under it, as their layers have them
  const { box, x } = await axis(8)
  await page.mouse.click(x(6), (r => r.y + r.h / 2)((await tracksAt())[0]))
  await page.waitForFunction(() => document.querySelector('.steps-list .step-name')?.textContent === 'a · chime.wav')
  const mid = (await tracksAt()).map(r => r.y + r.h / 2)
  // bright pixels in a lane's upper half, as the lanes are laid out then, off its centre line, over [t0, t1], the caret's
  // line at its start left out, whichever side of x(t0) it rounds to (bright: a track's colour, its waveform's, is lit at
  // 400 as the screen's white at 540)
  const lit = async (k, t0, t1) => { const r = (await tracksAt())[k]; return pixels(`let n = 0; for (let y = Math.round(arg.top); y < arg.mid - 4; y++) for (let x = arg.x0; x < arg.x1; x++) { const i = (y * w + x) * 4; if (d[i] + d[i + 1] + d[i + 2] > 400) n++ } return n`,
    { top: r.y - box.y, mid: r.y + r.h / 2 - box.y, x0: Math.floor(x(t0) - box.x) + 2, x1: Math.round(x(t1) - box.x) }) }
  await drag([x(1), mid[0]], [x(3) - x(1), 0])
  const before = [await lit(0, 1, 3), await lit(1, 4, 6)]
  assert.ok(before[0] > 100 && before[1] === 0, `the chime in a, silence in b: ${before}`)
  await page.mouse.move(x(2), mid[0])
  await page.mouse.down()
  for (let i = 1; i <= 8; i++) await page.mouse.move(x(2 + 3 * i / 8), mid[0] + (mid[1] - mid[0]) * i / 8)
  await poll(async () => [await lit(0, 1, 3), await lit(1, 4, 6)], going => assert.ok(going[0] < before[0] / 10 && going[1] > 20, `a silent where it was, b (a strip) with it where it goes: ${going}`))
  // the most lights at once from the drop on, each frame (the edit may be made a frame or two after)
  await page.evaluate(() => { window.__veils = 0; const look = () => { window.__veils = Math.max(window.__veils, document.querySelectorAll('.plot .veil:not([hidden])').length); if (!window.__veiled) requestAnimationFrame(look) }; requestAnimationFrame(look) })
  await page.mouse.up()
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))))
  const [left, landed] = [await lit(0, 1, 3), await lit(1, 4, 6)]
  assert.ok(left < before[0] / 10 && landed > 20, `let go, at once as it will be: ${left}, ${landed}`)
  assert.equal(await page.evaluate(() => (window.__veiled = true, window.__veils)), 2, 'where it left and where it went, a light along them while they are made')
  await page.waitForFunction(() => /let b = audio\.from\(t => 0, \{ duration: 8 \}\)\n  \.write\(audio\('chime\.wav'\)\.crop\(\{ at: 1, d: 2 \}\), \{ at: 4 \}\)/.test(scriptText()))
  await page.waitForFunction(() => !document.querySelector('.plot .veil:not([hidden])'))
})

// The edited track flattened (a row's menu): that track's chain made one sound, its own (not another its chain makes on
// the way, a mix's source): the mix sounds as it did; the other track as it was
test('editor: with tracks, the edited track flattened is that track alone', async () => {
  await open()
  await write(`let a = audio('chime.wav')\n  .gain(-6)\n\nlet b = audio('chime.wav')\n  .reverse()\n  .mix(audio.from(1))`)
  await page.waitForFunction(() => document.querySelector('.plot').dataset.tracks === '2')
  await lengthIs('0:08.000')
  await page.waitForFunction(() => document.querySelector('.steps-list .step-name')?.textContent === 'b · chime.wav')
  const level = await readout()
  await tab('Edits')
  await page.locator('.steps-list .step', { has: page.locator('.step-name', { hasText: /^Mix$/ }) }).locator('.step-toggle').click({ button: 'right' })
  await contextRow('Flatten all').click()
  await page.waitForFunction(() => scriptText() === "let a = audio('chime.wav')\n  .gain(-6)\n\nlet b = audio('chime-flat.wav')")
  await page.waitForFunction(() => document.querySelector('.plot').dataset.tracks === '2')
  await page.waitForFunction(level => document.querySelector('.readout').textContent === level, level)
})

// A file opened as a track of its own (File): under the one edited, named for it, the one edited after; the sound as
// long as the longer of the two
test('editor: a file opened as a new track goes under the one edited', async () => {
  await open()
  await write(`audio('chime.wav')`)
  await lengthIs('0:08.000')
  const chooser = page.waitForEvent('filechooser')
  await menu('Track', 'New track from a file…')
  await (await chooser).setFiles({ name: 'bed.wav', mimeType: 'audio/wav', buffer: await wavBytes([sine(10, 220, .1)]) })
  await page.waitForFunction(() => scriptText().includes('let bed = '))
  assert.equal(await code(), `let chime = audio('chime.wav')\n\nlet bed = audio('bed.wav')`)
  await page.waitForFunction(() => document.querySelector('.plot').dataset.tracks === '2')
  await lengthIs('0:10.000')
  assert.equal(await page.locator('.steps-list .step-name').first().textContent(), 'bed · bed.wav')
})

// Under the lanes, the room, where a new track is made by putting sound there, as a layer in Figma is made by drawing,
// never added empty: pointed at, a new track's lane there, its centre line faint; pressed, its caret, the selection
// gone; a paste there makes the track, the clip in it where the caret was, the one edited then. A double-click there
// makes nothing; its right-click menu makes an empty one (Ableton's, Reaper's), under the last, whichever is edited
test('editor: under the lanes, a press puts a new track\'s caret; a paste there makes the track; its menu makes an empty one', async () => {
  const { box, x } = await chime()
  await drag([x(1), box.y + 40], [x(2) - x(1), 0])
  await page.keyboard.press('ControlOrMeta+C')
  await page.waitForFunction(() => scriptText().includes('.copy('))
  // the room ROOM px tall, under the sound's lanes' foot
  const under = box.y + tall(box) + FOOT + ROOM / 2
  await page.mouse.dblclick(x(4), under)
  assert.equal(await selected(), '', 'pressed, the selection gone, the caret there')
  assert.ok(!/let track/.test(await code()), 'a double-click makes no track')
  await page.keyboard.press('ControlOrMeta+V')
  await page.waitForFunction(() => /^let chime = audio\('chime\.wav'\)\n  \.copy\(\{ at: 1, d: 1 \}\)\n\nlet track = audio\.from\(0\)\n  \.write\(audio\('chime\.wav'\)\.crop\(\{ at: 1, d: 1 \}\), \{ at: [\d.]+ \}\)$/.test(scriptText()))
  // the new track the edited one, its layer the second
  await page.waitForFunction(() => document.querySelectorAll('.layer')[1]?.classList.contains('on'))
  // an empty one from its menu, under the last, the first edited
  await page.waitForFunction(() => (l => l.length === 2 && l.every(e => e.dataset.lane))([...document.querySelectorAll('.layer')]))
  await page.mouse.click(x(4), (r => r.y + r.h / 2)((await tracksAt())[0]))
  await page.waitForFunction(() => (l => l.length === 2 && l.every(e => e.dataset.lane))([...document.querySelectorAll('.layer')]))
  const [, last] = await tracksAt()
  await page.mouse.click(x(4), last.y + last.h + FOOT + ROOM / 2, { button: 'right' })
  await page.locator('.menu-row', { hasText: /^New track/ }).click()
  await page.waitForFunction(() => /\n\nlet track2 = audio\.from\(0\)$/.test(scriptText()))
})

// The room under tracks: a new track's band, its lane as tall as the last's (one dragged shorter here); pressed, the caret
// down that lane alone, and the track made there has that lane, where the caret was, as tall as the last
test('editor: the room under the tracks is a new track\'s lane as tall as the last; the track made there has it', async () => {
  await open()
  await noCues()
  await write(`let a = audio('chime.wav')\n\nlet b = audio('rhodes.wav')`)
  await lengthIs('0:09.000')
  await page.locator('.layer').nth(1).waitFor({ state: 'attached' })
  const box = await page.locator('.plot').boundingBox(), short = TRACK - 40
  let [, b] = await tracksAt()
  await drag([box.x + 300, b.y + b.h + FOOT / 2], [0, -40])
  await page.waitForFunction(h => document.querySelectorAll('.layer')[1].dataset.lane.split(' ')[1] === String(h), short)
  ;[, b] = await tracksAt()
  const top = b.y + b.h + FOOT + HEAD, x = 300
  await page.mouse.click(box.x + x, top + short / 2)
  // the pointer off it, over a's lane: none of the room's words over the caret
  await page.mouse.move(box.x + 40, b.y - 60)
  // the caret's rows, CSS px from the plot's top: the column at x lit past half opacity
  const [from, to] = await page.evaluate(x => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(() => {
    const cv = __overlay(), k = cv.width / cv.clientWidth, g = cv.getContext('2d'), d = g.getImageData(Math.round(x * k), 0, 1, cv.height - Math.round(22 * k)).data, lit = []
    for (let y = 0; y < d.length / 4; y++) if (d[y * 4 + 3] > 128) lit.push(y / k)
    done([Math.min(...lit), Math.max(...lit)])
  }))), x)
  assert.ok(Math.abs(box.y + from - top) <= 2 && Math.abs(box.y + to - (top + short)) <= 2, `the caret down the new lane: ${box.y + from}…${box.y + to}, the lane ${top}…${top + short}`)
  await page.mouse.click(box.x + x, top + short / 2, { button: 'right' })
  await page.locator('.menu-row', { hasText: /^New track/ }).click()
  await page.waitForFunction(() => document.querySelectorAll('.layer').length === 3)
  const [, , made] = await tracksAt()
  assert.ok(Math.abs(made.y - top) <= 1 && Math.round(made.h) === short, `the track made where the lane was, as tall: ${made.y}, ${made.h}`)
  assert.equal(JSON.parse(await page.evaluate(() => localStorage.getItem('audio-repl'))).docs[0].heights.track, short, 'kept with the tab')
})

// A track made by a paste into the room is as tall as the last too (editor.js intoNew: the last read before the paste
// writes the new one in)
test('editor: a paste into the room under the tracks makes a track as tall as the last', async () => {
  await open()
  await noCues()
  await write(`let a = audio('chime.wav')\n\nlet b = audio('rhodes.wav')`)
  await lengthIs('0:09.000')
  await page.locator('.layer').nth(1).waitFor({ state: 'attached' })
  const { box, x } = await axis(9), short = TRACK - 40
  let [a, b] = await tracksAt()
  await page.mouse.click(x(4), a.y + 40)
  await drag([x(1), a.y + 40], [x(2) - x(1), 0])
  await page.keyboard.press('ControlOrMeta+C')
  await page.waitForFunction(() => scriptText().includes('.copy('))
  await drag([box.x + 300, b.y + b.h + FOOT / 2], [0, -40])
  await page.waitForFunction(h => document.querySelectorAll('.layer')[1].dataset.lane.split(' ')[1] === String(h), short)
  ;[, b] = await tracksAt()
  await page.mouse.click(x(4), b.y + b.h + FOOT + HEAD + short / 2)
  await page.keyboard.press('ControlOrMeta+V')
  await page.waitForFunction(() => document.querySelectorAll('.layer').length === 3)
  assert.match(await code(), /\n\nlet track = audio\.from\(0\)\n  \.write\(/)
  assert.equal(Math.round((await tracksAt())[2].h), short)
  assert.equal(JSON.parse(await page.evaluate(() => localStorage.getItem('audio-repl'))).docs[0].heights.track, short)
})

// Under the tracks, where a new one's title would be, a placeholder, + New track: pressed, the track made, empty, its
// name in hand, written and Enter, the track so named. The caret in the room a plus by its top; the meters by the lanes
// read nothing there, nothing being there yet
test('editor: under the tracks, New track where its title would be: pressed, made and named', async () => {
  await open()
  await noCues()
  await write(`let a = audio('chime.wav')\n\nlet b = audio('rhodes.wav')`)
  await lengthIs('0:09.000')
  const placeholder = page.locator('.layer-new')
  await placeholder.waitFor()
  assert.equal(await placeholder.innerText(), 'New track')
  // a plus where a layer's look is, its words where a layer's name starts
  const starts = await page.evaluate(() => { const text = el => { const r = document.createRange(); r.selectNodeContents([...el.childNodes].find(n => n.nodeType === 3)); return r.getBoundingClientRect().left }; return [text(document.querySelector('.layer-name')), text(document.querySelector('.layer-new')), document.querySelector('.layer-new svg path')?.getAttribute('d')] })
  assert.ok(Math.abs(starts[0] - starts[1]) <= 1 && starts[2] === 'M12 5v14M5 12h14', `a plus, then its words where a name starts: ${starts}`)
  const [, b] = await tracksAt(), head = await placeholder.boundingBox()
  assert.ok(Math.abs(head.y - (b.y + b.h + FOOT)) <= 1, `where its title would be: ${head.y}, under ${b.y + b.h + FOOT}`)
  // lit as the room under the lanes is pointed at, as if it were
  const tint = () => placeholder.evaluate(e => getComputedStyle(e).color)
  const idle = await tint()
  await page.mouse.move(head.x + 300, head.y + 40)
  await page.waitForFunction(was => getComputedStyle(document.querySelector('.layer-new')).color !== was, idle)
  // the meters read the caret's place in a lane; in the room, nothing
  const box = await page.locator('.plot').boundingBox(), lit = () => page.evaluate(() => { const m = document.querySelector('.plot canvas.meters'), d = m.getContext('2d').getImageData(0, 0, m.width, m.height).data; let n = 0; for (let i = 3; i < d.length; i += 4) n += d[i] > 0; return n })
  await page.mouse.click(box.x + 300, b.y + b.h / 2)
  await page.waitForFunction(() => { const m = document.querySelector('.plot canvas.meters'), d = m.getContext('2d').getImageData(0, 0, m.width, m.height).data; for (let i = 3; i < d.length; i += 4) if (d[i]) return true })
  await page.mouse.click(box.x + 300, head.y + 40)
  await poll(lit, n => assert.equal(n, 0, 'in the room, no meters'))
  await placeholder.click()
  await page.waitForFunction(() => /\n\nlet track = audio\.from\(0\)$/.test(scriptText()))
  await page.waitForFunction(() => document.activeElement?.classList.contains('layer-field'))
  await page.keyboard.type('drums')
  await page.keyboard.press('Enter')
  await page.waitForFunction(() => /\n\nlet drums = audio\.from\(0\)$/.test(scriptText()))
})

// The room's caret let go (Esc): back in the sound's lanes, a paste there the sound's own, no track made
test('editor: Esc takes the caret under the lanes back; a paste then goes into the sound', async () => {
  const { box, x } = await chime()
  await drag([x(1), box.y + 40], [x(2) - x(1), 0])
  await page.keyboard.press('ControlOrMeta+C')
  await page.waitForFunction(() => scriptText().includes('.copy('))
  await page.mouse.click(x(4), box.y + tall(box) + FOOT + ROOM / 2)
  await page.keyboard.press('Escape')
  // (Edit › Paste: the editor's own clip, not the system's clipboard, which the copy fills a while after)
  await menu('Edit', 'Paste')
  await page.waitForFunction(() => /\.paste\([\d.]+/.test(scriptText()))
  assert.ok(!/let track/.test(await code()), 'no track made')
})

// A piece dragged under the last track goes to a new track there, as a clip dropped under a DAW's tracks: shown there as
// it goes, a track made for it once let go, silence where it was; a track taken away and made again under its name is
// as a new one is, its mute not the one it had
test('editor: a piece dragged under the tracks goes to a new track; a track made again is as a new one', async () => {
  const { box, x } = await chime()
  await drag([x(1), box.y + 40], [x(2) - x(1), 0])
  await frames()
  await page.mouse.move(x(1.5), box.y + 40)
  await page.mouse.down()
  const under = box.y + tall(box) + FOOT + ROOM / 2
  for (let i = 1; i <= 8; i++) await page.mouse.move(x(1.5 + 2 * i / 8), box.y + 40 + (under - box.y - 40) * i / 8)
  await page.mouse.up()
  await page.waitForFunction(() => /^let chime = audio\('chime\.wav'\)\n  \.gain\(-Infinity, \{ at: 1, d: 1 \}\)\n\nlet track = audio\.from\(0\)\n  \.write\(audio\('chime\.wav'\)\.crop\(\{ at: 1, d: 1 \}\), \{ at: 3 \}\)$/.test(scriptText()))
  // muted, then taken away (its layer's menu) and made again (the room's): its name again, heard
  await page.locator('.layer').nth(1).waitFor({ state: 'attached' })
  await page.getByRole('button', { name: 'Mute track' }).click()
  await page.locator('.layer').nth(1).click({ button: 'right' })
  await page.locator('.menu-row', { hasText: /^Delete the track/ }).click()
  await page.waitForFunction(() => !/let track\b/.test(scriptText()))
  await page.waitForFunction(() => !document.querySelector('.plot').dataset.tracks)
  const plot = await page.locator('.plot').boundingBox()
  await page.mouse.click(plot.x + 300, plot.y + tall(plot) + FOOT + ROOM / 2, { button: 'right' })
  await page.locator('.menu-row', { hasText: /^New track/ }).click()
  await page.waitForFunction(() => /let track = audio\.from\(0\)$/.test(scriptText()))
  await page.locator('.layer').nth(1).waitFor({ state: 'attached' })
  assert.equal(await page.getByRole('button', { name: 'Mute track' }).getAttribute('aria-pressed'), 'false')
})

// A track's speaker with Alt: solo, the others muted; so again, every one heard
test('editor: Alt and a track\'s speaker solos it', async () => {
  await open()
  await noCues()
  await write(`let a = audio('chime.wav')\n\nlet b = audio('rhodes.wav')\n\nlet c = audio('handpan.wav')`)
  await page.locator('.layer').nth(2).waitFor({ state: 'attached' })
  const pressed = () => Promise.all(['a', 'b', 'c'].map(n => page.getByRole('button', { name: `Mute ${n}` }).getAttribute('aria-pressed')))
  await page.getByRole('button', { name: 'Mute b' }).click({ modifiers: ['Alt'] })
  assert.deepEqual(await pressed(), ['true', 'false', 'true'])
  await page.getByRole('button', { name: 'Mute b' }).click({ modifiers: ['Alt'] })
  assert.deepEqual(await pressed(), ['false', 'false', 'false'])
})

// What a track's name holds outside the script stays while typing has the name gone (a name half written, a line broken)
// and is there when it comes back; the sound is heard without the mute a name no track has
test('editor: a mute kept by a name the script lost, back with the name', async () => {
  await open()
  await noCues()
  const two = name => `let a = audio('chime.wav')\n\nlet ${name} = audio('rhodes.wav')`
  await write(two('b'))
  await page.locator('.layer').nth(1).waitFor({ state: 'attached' })
  await page.getByRole('button', { name: 'Mute b' }).click()
  await write(two('c'))
  await page.getByRole('button', { name: 'Mute c' }).waitFor()
  assert.equal(await page.getByRole('button', { name: 'Mute c' }).getAttribute('aria-pressed'), 'false', 'c, a name of its own, heard')
  await write(`let a = audio('chime.wav')\n\nlet b = audio(`)
  await write(two('b'))
  await page.getByRole('button', { name: 'Mute b' }).waitFor()
  assert.equal(await page.getByRole('button', { name: 'Mute b' }).getAttribute('aria-pressed'), 'true', 'b again, muted')
})

// A track taken away is laid out at once, before the mix without it comes, the mix playing still with it: a lane pressed
// then edits the track it shows, and its speaker mutes no track it does not show
test('editor: a track taken away, a lane pressed before the mix without it comes is the track it shows', async () => {
  await open()
  await noCues()
  await write(`let a = audio('chime.wav')\n\nlet b = audio('rhodes.wav')\n\nlet c = audio('handpan.wav')\n\nlet d = audio('chime.wav')`)
  await page.locator('.layer').nth(3).waitFor({ state: 'attached' })
  // b's lane a strip, the second; pressed, edited, tall from where it was, as c's then is, shown at once in its place
  const box = await page.locator('.plot').boundingBox(), second = (r => r.y + r.h / 2)((await tracksAt())[1])
  const card = () => page.evaluate(() => document.querySelector('.steps-list .step-name')?.textContent)
  await page.mouse.click(box.x + 200, second)
  await page.waitForFunction(() => document.querySelector('.steps-list .step-name')?.textContent.startsWith('b '))
  await menu('Track', 'Delete the track')
  // laid out at once: a, c, d. c's lane pressed, c edited (not d, the lane's index in the mix that still has b); its
  // speaker, c's or none
  await page.waitForFunction(() => [...document.querySelectorAll('.layer-name')].map(e => e.textContent).join() === 'a,c,d')
  await page.mouse.click(box.x + 200, (r => r.y + r.h / 2)((await tracksAt())[1]))
  await page.getByRole('button', { name: 'Mute c' }).click()
  await page.waitForFunction(() => document.querySelector('.plot').dataset.tracks === '3' && !/let b\b/.test(scriptText()))
  await page.waitForFunction(() => document.querySelector('.steps-list .step-name')?.textContent.startsWith('c '))
  await settled()
  await page.waitForFunction(() => (JSON.parse(localStorage.getItem('audio-repl')).docs[0].muted ?? []).includes('c'))
  assert.match(await card(), /^c · /)
  assert.ok(!(await page.evaluate(() => JSON.parse(localStorage.getItem('audio-repl')).docs[0].muted ?? [])).includes('b'), 'b, gone, not muted in c\'s place')
})

// A track's lane shows what its own look or its menu chose (Waveform, Spectrogram or Notes: its look in its layer,
// its name right-clicked), as Audacity's tracks each show a view of their own, kept with the tab; View sets every track's
test('editor: a track\'s lane shows a waveform, a spectrogram or notes, as its look or menu chose; View sets every track\'s', async () => {
  await open()
  await noCues()
  await write(`let a = audio('chime.wav')\n\nlet b = audio('chime.wav')`)
  await page.locator('.layer').nth(1).waitFor({ state: 'attached' })
  // b edited, its lane tall under a's strip, as their layers have them
  const { box, x } = await axis(8), [a, b] = await tracksAt(), top = b.y, middle = b.y + b.h / 2
  // a lane's centre line through the quiet before the first strike, a waveform's: none on a spectrogram or under notes
  const line = y => pixels(`let n = 0; for (let x = 2; x < arg.x1; x++) for (let y = arg.y - 4; y <= arg.y + 4; y++) { const i = (y * w + x) * 4; if (d[i] + d[i + 1] + d[i + 2] > 360) n++ } return n`, { x1: Math.round(x(.4) - box.x), y: Math.round(y - box.y) })
  const kinds = () => page.evaluate(() => JSON.parse(localStorage.getItem('audio-repl')).docs[0].kinds)
  const menuOf = () => page.locator('.layer').nth(1).click({ button: 'right', position: { x: 30, y: 10 } })
  const choose = async label => { await menuOf(); await page.locator('.menu-row:visible', { hasText: new RegExp(`^${label}$`) }).click() }
  const wave = await line(middle)
  assert.ok(wave > 20, `b's centre line: ${wave}`)
  await choose('Spectrogram')
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('audio-repl')).docs[0].kinds?.b === 'spec')
  await poll(() => line(middle), n => assert.ok(n < wave / 10, 'a spectrogram in b\'s lane'))
  assert.ok(await line(a.y + a.h / 2) > 10, 'a waveform in a\'s strip')
  // kept: reloaded, b's lane a spectrogram again, its menu saying so
  await page.reload()
  await page.locator('.layer').nth(1).waitFor({ state: 'attached' })
  await settled()
  assert.ok(await line(middle) < wave / 10, 'b\'s spectrogram kept')
  await menuOf()
  assert.equal(await page.locator('.menu-row:visible[aria-checked="true"]').textContent(), 'Spectrogram')
  await page.keyboard.press('Escape')
  // Notes, from b's look in its layer: b's notes, one taking the pointer where its blob is, on the chime's first note
  await page.getByRole('button', { name: 'b: Spectrogram', exact: true }).click()
  await choice('Shows', 'Notes').click()
  await page.keyboard.press('Escape')
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('audio-repl')).docs[0].kinds?.b === 'notes')
  await page.getByRole('button', { name: 'b: Notes', exact: true }).waitFor()
  await grab(Array.from({ length: 120 }, (_, k) => [x(.8), top + 20 + k * 3]), 'ns-resize')
  // View's Waveform, the one the picture shows: every track's a waveform again
  await menu('View', 'Waveform')
  await page.waitForFunction(() => !Object.keys(JSON.parse(localStorage.getItem('audio-repl')).docs[0].kinds ?? {}).length)
  await poll(() => line(middle), n => assert.ok(n > wave / 2, 'b\'s waveform again'))
  assert.deepEqual(await kinds(), {})
})

// A track's view goes with its name: named anew, it keeps it; taken away, it goes, so one made again under the name shows
// the picture's. A silent track's notes are none: its lane a voice's keys, nothing taking the pointer, nothing failing
test('editor: a track\'s view goes with its name; a silent track shows no notes', async () => {
  await open()
  await noCues()
  await write(`let a = audio('chime.wav')\n\nlet b = audio.from(t => 0, { duration: 8 })`)
  await page.locator('.layer').nth(1).waitFor({ state: 'attached' })
  const { box, x } = await axis(8), top = (await tracksAt())[1].y
  const kinds = () => page.evaluate(() => JSON.parse(localStorage.getItem('audio-repl')).docs[0].kinds)
  const menuOf = () => page.locator('.layer').nth(1).click({ button: 'right', position: { x: 30, y: 10 } })
  await menuOf()
  await page.locator('.menu-row:visible', { hasText: /^Notes$/ }).click()
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('audio-repl')).docs[0].kinds?.b === 'notes')
  // a while for the engine to find notes, were there any (eng.notes): nothing says it found none
  await page.waitForTimeout(1000)
  for (let y = top + 20; y < box.y + box.height - 40; y += 8) {
    await page.mouse.move(x(2), y)
    assert.notEqual(await page.locator('.plot').evaluate(el => el.style.cursor), 'ns-resize', `no note at ${y - top}px`)
  }
  // named anew from its layer, its name clicked
  await page.locator('.layer-name', { hasText: /^b$/ }).click()
  await page.keyboard.press('ControlOrMeta+A')
  await page.keyboard.type('bed')
  await page.keyboard.press('Enter')
  await page.waitForFunction(() => /\nlet bed = audio\.from/.test(scriptText()))
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('audio-repl')).docs[0].kinds?.bed === 'notes')
  assert.deepEqual(await kinds(), { bed: 'notes' })
  await menuOf()
  await page.locator('.menu-row:visible', { hasText: /^Delete the track/ }).click()
  await page.waitForFunction(() => !/let bed\b/.test(scriptText()))
  await page.waitForFunction(() => !JSON.parse(localStorage.getItem('audio-repl')).docs[0].kinds?.bed)
  assert.deepEqual(await kinds(), {})
})

// The tracks' layers, each on a head line over its lane, the picture as wide as without them. A layer's name
// double-clicked, a field there, Enter names the track, as a script names a sound. Each lane as tall as its foot was
// dragged (with Alt, every one), none grown for being edited; a locked one's taken by no press, the edited one locked
// giving way to the next. More tracks than the picture holds scroll up and down through it, their layers with them, as
// a DAW's, the room under them always in reach
test('editor: the layers over each lane name and lock the tracks; a foot dragged, its height, with Alt every one\'s; more tracks than fit scroll', async () => {
  await open()
  await noCues()
  const wide = (await page.locator('.plot').boundingBox()).width
  await write(`let a = audio('chime.wav')\n\nlet b = audio('rhodes.wav')`)
  await lengthIs('0:09.000')
  await page.locator('.layer').nth(1).waitFor({ state: 'attached' })
  assert.equal((await page.locator('.plot').boundingBox()).width, wide, 'the picture as wide as with one sound')
  // on a head line over its lane, the head's top over the lane's
  const [a0] = await tracksAt(), head0 = await page.locator('.layer').first().boundingBox()
  assert.ok(Math.abs(head0.y + HEAD - a0.y) <= 1 && head0.height <= HEAD + 1, `its head line over its lane: ${head0.y}, ${head0.height}, ${a0.y}`)
  await page.locator('.layer-name', { hasText: /^b$/ }).click()
  await page.keyboard.press('ControlOrMeta+A')
  await page.keyboard.type('Lead vocal')
  await page.keyboard.press('Enter')
  await page.waitForFunction(() => scriptText() === "let a = audio('chime.wav')\n\nlet leadVocal = audio('rhodes.wav')")
  // each TRACK px, the edited one too; a's foot dragged 60 px down, a 60 px taller, kept with the tab; double-clicked,
  // as it was made
  const card = () => page.evaluate(() => document.querySelector('.steps-list .step-name')?.textContent)
  const box = await page.locator('.plot').boundingBox(), heights = async () => (await tracksAt()).map(r => Math.round(r.h))
  assert.deepEqual(await heights(), [TRACK, TRACK], 'none grown for being edited')
  const [a1] = await tracksAt(), foot = a1.y + a1.h + FOOT / 2
  await page.mouse.move(box.x + 300, foot)
  assert.equal(await page.locator('.plot').evaluate(el => el.style.cursor), 'row-resize', 'its foot, its height to drag')
  await drag([box.x + 300, foot], [0, 60])
  await page.waitForFunction(() => document.querySelector('.layer').dataset.lane.split(' ')[1] === String(160 + 60))
  assert.equal(JSON.parse(await page.evaluate(() => localStorage.getItem('audio-repl'))).docs[0].heights.a, TRACK + 60)
  await page.mouse.dblclick(box.x + 300, foot + 60)
  await page.waitForFunction(() => document.querySelector('.layer').dataset.lane.split(' ')[1] === '160')
  // with Alt, pressed on the way, every band to the one dragged; with Alt double-clicked, every band as it was made
  const tall = () => page.evaluate(() => [...document.querySelectorAll('.layer')].map(e => +e.dataset.lane.split(' ')[1]))
  await page.mouse.move(box.x + 300, foot)
  await page.mouse.down()
  await page.mouse.move(box.x + 300, foot + 20, { steps: 3 })
  await page.keyboard.down('Alt')
  await page.mouse.move(box.x + 300, foot + 40, { steps: 3 })
  await page.mouse.up()
  await page.keyboard.up('Alt')
  await page.waitForFunction(() => [...document.querySelectorAll('.layer')].every(e => e.dataset.lane.split(' ')[1] === '200'))
  assert.deepEqual(await tall(), [TRACK + 40, TRACK + 40], 'every band')
  assert.deepEqual(JSON.parse(await page.evaluate(() => localStorage.getItem('audio-repl'))).docs[0].heights, { a: TRACK + 40, leadVocal: TRACK + 40 })
  // Alt let go on the way: the others as they were where it was pressed, the one dragged alone
  await page.mouse.move(box.x + 300, foot + 40)
  await page.mouse.down()
  await page.keyboard.down('Alt')
  await page.mouse.move(box.x + 300, foot + 60, { steps: 3 })
  await page.keyboard.up('Alt')
  await page.mouse.move(box.x + 300, foot + 50, { steps: 3 })
  await page.mouse.up()
  await page.waitForFunction(() => [...document.querySelectorAll('.layer')].map(e => e.dataset.lane.split(' ')[1]).join() === '210,200')
  await page.keyboard.down('Alt')
  await page.mouse.dblclick(box.x + 300, foot + 50)
  await page.keyboard.up('Alt')
  await page.waitForFunction(() => [...document.querySelectorAll('.layer')].every(e => e.dataset.lane.split(' ')[1] === '160'))
  // a locked while edited: leadVocal edited; a press in a's lane takes it no more
  await page.getByRole('button', { name: 'Lock a' }).click()
  await page.waitForFunction(() => document.querySelector('.steps-list .step-name')?.textContent.startsWith('leadVocal '))
  await page.mouse.click(box.x + 300, (await tracksAt())[0].y + 20)
  await settled()
  assert.match(await card(), /^leadVocal /, 'a locked, a press in its lane edits nothing there')
  assert.deepEqual(JSON.parse(await page.evaluate(() => localStorage.getItem('audio-repl'))).docs[0].locked, ['a'])
  // a range dragged on the time row, through every track, deleted: a, locked, untouched
  await drag([box.x + 300, box.y + box.height - 11], [100, 0])
  await page.keyboard.press('Backspace')
  await page.waitForFunction(() => /let leadVocal = audio\('rhodes\.wav'\)\n  \.remove\(/.test(scriptText()))
  assert.match(await code(), /^let a = audio\('chime\.wav'\)\n\n/, 'a as it was')
  await page.keyboard.press('ControlOrMeta+Z')
  await page.waitForFunction(() => !scriptText().includes('remove('))
  // four tracks: more than the picture holds; the wheel over the lanes brings the last into sight, its layer with it, and
  // the room under it, where a press puts a new track's caret
  await write(Array.from({ length: 4 }, (_, i) => `let t${i} = audio.from(t => Math.sin(2 * Math.PI * ${220 + 20 * i} * t) * .2, { duration: 2 })`).join('\n\n'))
  await page.locator('.layer').nth(3).waitFor({ state: 'attached' })
  const time = box.y + box.height - 22, last = async () => (await tracksAt())[3]
  assert.ok((r => r.y + r.h > time)(await last()), 'the last out of sight')
  await page.mouse.move(box.x + box.width / 2, box.y + 100)
  for (let i = 0; i < 8; i++) await page.mouse.wheel(0, 120)
  await page.waitForFunction(time => (([y, h]) => document.querySelector('.plot').getBoundingClientRect().y + y + h + 18 + 40 <= time + 1)(document.querySelectorAll('.layer')[3].dataset.lane.split(' ').map(Number)), time)
  const r = await last()
  await page.mouse.move(box.x + 300, r.y + r.h + FOOT + ROOM / 2)
  assert.equal(await page.locator('.plot').evaluate(el => el.style.cursor), '', 'the room in reach')
  // the scrollbar at the right edge, its thumb dragged to the top: the first in sight again
  await drag([box.x + box.width - 2, time - 30], [0, -(box.height - 22)])
  assert.ok(Math.abs((await tracksAt())[0].y - box.y - HEAD) < 1, 'the first at the top again, under its head line')
})

// With tracks, the first card of the edits is the track's: its ×, or its right-click, deletes the track, as a DAW's track
// header does; one step, undone in one
test('editor: with tracks, the track\'s card deletes it', async () => {
  await open()
  const A = `let a = audio('chime.wav')\n  .gain(-3)`, B = `let b = audio('chime.wav')\n  .gain(-6)`
  await write(`${A}\n\n${B}`)
  await tab('Edits')
  await page.waitForFunction(() => document.querySelector('.plot').dataset.tracks === '2')
  const card = page.locator('.steps-list .step').first(), name = () => page.locator('.steps-list .step-name').first().textContent()
  const left = text => page.waitForFunction(text => scriptText().replace(/\u00a0/g, ' ') === text, text)
  await page.waitForFunction(() => document.querySelector('.steps-list .step-name')?.textContent === 'b · chime.wav')
  await card.hover()
  await card.getByRole('button', { name: 'Delete track b', exact: true }).click()
  await left(A)
  await page.waitForFunction(() => !('tracks' in document.querySelector('.plot').dataset))
  assert.equal(await name(), 'chime.wav', 'one sound: no track')
  assert.equal(await card.getByRole('button', { name: /^Delete track/ }).count(), 0, 'nothing to delete')
  await page.keyboard.press('ControlOrMeta+Z')
  await page.waitForFunction(() => document.querySelector('.plot').dataset.tracks === '2' && / · chime\.wav$/.test(document.querySelector('.steps-list .step-name')?.textContent))
  const edited = (await name()).split(' · ')[0]
  await card.click({ button: 'right' })
  await contextRow('Delete the track').click()
  await left(edited === 'a' ? B : A)
  // a track made in the script, its first card the call making it
  await write(`${B}\n\nlet tone = audio.from(t => Math.sin(t * 2000), { d: 1 })`)
  await tab('Edits')
  await page.waitForFunction(() => document.querySelector('.plot').dataset.tracks === '2' && document.querySelector('.steps-list .step-name')?.textContent === 'From')
  await card.hover()
  await card.getByRole('button', { name: 'Delete track tone', exact: true }).click()
  await left(B)
})
