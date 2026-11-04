// Recording and takes; the server, the page and the helpers in page.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { writeFile, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium } from 'playwright'
import { page, origin, errors, code, wholeLevels, lengthText, open, settled, frames, poll, still, choice, settings, selected, tab, menu, facts, noCues, write, drawn, TRACK, ROOM, FOOT, tall, tracksAt, gutter, TAIL, axis, drag, lengthIs, pixels, show, keptFiles, takesLeft, recordFor, chime, contextRow } from './page.js'

// With nothing open, the take is the sound, drawn as it comes
test('editor: a recording becomes a file the script opens', async () => {
  await open()
  await write('')
  await page.locator('.empty').waitFor()
  // stopped before the microphone answers (Record clicked twice at once): nothing recorded, the microphone let go, the
  // next take free to start
  await page.evaluate(() => { const b = document.querySelector('button.record'); b.click(); b.click() })
  // a moment for the microphone's late answer to start a take, which it must not
  await page.waitForTimeout(500)
  assert.equal(await page.locator('.empty').isVisible(), true, 'nothing recorded')
  assert.equal(await page.getByRole('button', { name: 'Stop recording', exact: true }).count(), 0)
  await page.getByRole('button', { name: 'Record', exact: true }).first().click()
  const started = Date.now()
  await page.waitForFunction(() => /^0:0[1-9]/.test(document.querySelector('.time').textContent))
  assert.ok(await drawn() > .001, 'the take draws as it comes')
  // at a recording app's scale, 10 s across, the take growing from the left: its right half bare
  const right = () => pixels(`let n = 0; for (let y = 10; y < h - 30; y++) for (let x = Math.round(w * .5); x < w * .9; x++) if (d[(y * w + x) * 4] > 120) n++; return n`)
  assert.equal(await right(), 0, 'the right half bare')
  // Play is off while it records
  assert.equal(await page.locator('button.play').isDisabled(), true, 'no playing while recording')
  // Space stops it, as it stops playback
  await page.locator('.plot').focus()
  await page.keyboard.press('Space')
  const ran = (Date.now() - started) / 1000
  await page.getByRole('button', { name: 'Record', exact: true }).first().waitFor()
  await page.waitForFunction(() => scriptText().startsWith("audio('recording.wav')"))
  await wholeLevels().waitFor()
  assert.equal(await right(), 0, 'its output at the same scale')
  // the caret where the take ended, not at its start: Record again records on
  await page.waitForFunction(() => +document.querySelector('.time').textContent.split(':')[1] > .9)
  // the take itself, untrimmed: about as long as the recording ran (a slow machine's run, however long)
  await write(`audio('recording.wav')`)
  const long = () => page.waitForFunction(most => { const s = +(e => e.title || e.dataset.tip || '')(document.querySelector('.source')).split(' · ').pop().split(':')[1]; return s > .9 && s < most }, ran + .5)
  await long()
  const before = await lengthText()
  // kept for the next visit, as a file is (a 32-bit float WAV): the same length after a reload, nothing missing
  await page.waitForFunction(() => { const s = JSON.parse(localStorage.getItem('audio-repl')); return s.docs[s.doc].code === "audio('recording.wav')" })
  await page.reload()
  await wholeLevels().waitFor()
  assert.equal(await lengthText(), before)
  assert.equal(await page.locator('.message.problem').count(), 0)
})

// Recording, the playhead is where the take has got to, and the microphone's blocks come in bursts, those of an audio
// callback at once, none between: it runs on by the frames' own time, frame to frame as far as the frame's time, within
// 5% (it was as many blocks as came, a frame half as far as the next)
test('editor: recording, the playhead keeps its speed as the blocks come in bursts', async () => {
  await page.route('**/playground/editor.js', async route => { const r = await route.fetch(); route.fulfill({ response: r, body: (await r.text()).replace('v = view(', 'v = globalThis.__view = view(') }) })
  await open()
  await write('')
  await page.locator('.empty').waitFor()
  await page.getByRole('button', { name: 'Record', exact: true }).first().click()
  await page.waitForFunction(() => __view.playhead > .3)
  const frames = await page.evaluate(() => new Promise(done => {
    const out = []
    const each = ts => { out.push([ts, __view.playhead]); out.length < 90 ? requestAnimationFrame(each) : done(out) }
    requestAnimationFrame(each)
  }))
  await page.locator('.plot').focus()
  await page.keyboard.press('Space')
  await page.waitForFunction(() => scriptText().startsWith("audio('recording.wav')"))
  const off = frames.slice(1).map(([ts, t], i) => Math.abs((t - frames[i][1]) * 1000 / (ts - frames[i][0]) - 1)).sort((p, q) => p - q)
  assert.ok(off[Math.floor(off.length * .9)] < .05, `speeds off 1× by ${off.map(v => v.toFixed(3)).join()}`)
})

test('editor: a recording is kept until it is deleted: its tab closed, it waits under Open recent', async () => {
  await open()
  await write('')
  await page.locator('.empty').waitFor()
  await recordFor(1)
  await page.locator('.plot').focus()
  await page.keyboard.press('Space')
  await page.waitForFunction(() => scriptText().startsWith("audio('recording.wav')"))
  await wholeLevels().waitFor()
  const before = await lengthText()
  // kept as a file, the parts it was written in as it came let go
  await poll(async () => [await keptFiles(), await takesLeft()], ([files, left]) => assert.ok(files.join() === 'recording.wav' && !left, `kept: ${files}, ${left} takes left`))
  await menu('File', 'Close tab')
  await page.reload()
  await page.locator('.empty').waitFor()
  assert.deepEqual(await keptFiles(), ['recording.wav'])
  await menu('File', 'Open recent', 'recording.wav')
  await page.waitForFunction(() => scriptText().startsWith("audio('recording.wav')"))
  await wholeLevels().waitFor()
  assert.equal(await lengthText(), before)
  assert.equal(await page.locator('.message.problem').count(), 0)
  // a new one takes a name of its own, never the kept one's
  await menu('File', 'Close tab')
  await recordFor(.5)
  await page.locator('.plot').focus()
  await page.keyboard.press('Space')
  await page.waitForFunction(() => scriptText().startsWith("audio('recording-2.wav')"))
  await poll(keptFiles, files => assert.ok(files.length >= 2, String(files)))
  // deleted when asked, and only once said: dismissed, it stays
  page.once('dialog', d => d.dismiss())
  await menu('File', 'Open recent', 'Delete kept sounds…')
  // a moment for a deletion that must not come
  await page.waitForTimeout(200)
  assert.deepEqual(await keptFiles(), ['recording-2.wav', 'recording.wav'])
  page.once('dialog', d => { assert.match(d.message(), /^Delete recording\.wav kept in this browser/); d.accept() })
  await menu('File', 'Open recent', 'Delete kept sounds…')
  await poll(keptFiles, files => assert.ok(files.length <= 1, String(files)), 3000)
  assert.deepEqual(await keptFiles(), ['recording-2.wav'], 'the one a tab opens stays')
})

// A take the page closes on as it records (a reload, a crash) is kept, all but its last second, under the name it was
// to have, in a tab of its own
test('editor: a take the page closes on as it records is kept on the next visit', async () => {
  await open()
  await write('')
  await page.locator('.empty').waitFor()
  await recordFor(2.6)
  // the browser asks before a take is left
  page.once('dialog', d => { assert.equal(d.type(), 'beforeunload'); d.accept() })
  await page.reload()
  await page.waitForFunction(() => scriptText().startsWith("audio('recording.wav')"))
  // said as it is kept, for a few seconds (note), likely gone by the time the levels of all of it are read
  await page.locator('.message', { hasText: 'recording.wav, recorded as the page closed, is kept.' }).waitFor()
  await wholeLevels().waitFor()
  const s = +(await lengthText()).split(':')[1]
  assert.ok(s >= 1.5 && s < 3.5, `${s} s kept`)
  await poll(takesLeft, left => assert.ok(!left, 'its parts let go'), 3000)
})

// A take as keep.js writes it as it comes, a part each second (here a "second" of 4 frames, so parts split often): read
// back as a WAV, its samples are the ones written, interleaved, for blocks ending before, at and past a part's end; a
// slice from a pass on, as long as asked; one written to nothing has no file and no folder left; one the page closed
// on (no wav() asked) comes back whole on the next visit, under its name, and its parts go once kept
test('editor: a take written as it comes reads back sample for sample, sliced as asked, and whole after a close', async () => {
  await page.goto(origin + '/blank.html')
  const r = await page.evaluate(async () => {
    const { tape, tapes } = await import('/playground/keep.js')
    const read = async blob => { const b = await blob.arrayBuffer(), v = new DataView(b); return { format: v.getUint16(20, true), k: v.getUint16(22, true), rate: v.getUint32(24, true), bytes: v.getUint32(40, true), data: [...new Float32Array(b, 44)] } }
    // blocks of 3, 1, 4 and 5 frames: part ends at 4, 8, 12 fall inside, at and after them; 13 frames, 3 parts and one held
    const blocks = [3, 1, 4, 5], at = [0]
    for (const n of blocks) at.push(at.at(-1) + n)
    const stereo = tape({ name: 's.wav', sampleRate: 4 })
    blocks.forEach((n, b) => stereo.write([Float32Array.from({ length: n }, (_, i) => at[b] + i), Float32Array.from({ length: n }, (_, i) => -(at[b] + i))]))
    const whole = await read(await stereo.wav(0, null)), slice = await read(await stereo.wav(5, 6)), past = await read(await stereo.wav(11, 10))
    await stereo.drop()
    // mono, one block past a part's end
    const mono = tape({ name: 'm.wav', sampleRate: 4 })
    mono.write([Float32Array.from({ length: 6 }, (_, i) => i / 10)])
    const one = await read(await mono.wav())
    await mono.drop()
    // nothing written: no file
    const none = tape({ name: 'n.wav', sampleRate: 4 })
    const empty = await none.wav()
    await none.drop()
    // closed on: written, never asked for
    const cut = tape({ name: 'cut.wav', sampleRate: 4 })
    cut.write([Float32Array.from({ length: 9 }, (_, i) => i)])
    await cut.flush()
    const found = await tapes(), back = found.length === 1 ? { name: found[0].name, ...await read(found[0].wav) } : null
    for (const t of found) await t.drop()
    return { whole, slice, past, one, empty, back, left: (await tapes()).length }
  })
  const frames = (a, b) => Array.from({ length: b - a }, (_, i) => [a + i, -(a + i)]).flat().map(v => v || 0)
  assert.deepEqual([r.whole.format, r.whole.k, r.whole.rate, r.whole.bytes], [3, 2, 4, 13 * 8], 'IEEE float, 2 channels, its rate, 13 frames')
  assert.deepEqual(r.whole.data.map(v => v || 0), frames(0, 13), 'every sample, in order, interleaved')
  assert.deepEqual(r.slice.data.map(v => v || 0), frames(5, 11), 'from frame 5, 6 of them')
  assert.deepEqual(r.past.data.map(v => v || 0), frames(11, 13), 'asked past the end: what there is')
  assert.equal(r.past.bytes, 2 * 8)
  assert.deepEqual(r.one.data.map(v => +v.toFixed(6)), [0, .1, .2, .3, .4, .5], 'mono, across a part')
  assert.equal(r.empty, null, 'nothing written, no file')
  // a take the page closed on: all of it that reached the disk (the 9th frame was flushed too), under its name
  assert.deepEqual([r.back?.name, r.back?.data], ['cut.wav', [0, 1, 2, 3, 4, 5, 6, 7, 8]])
  assert.equal(r.left, 0, 'its parts let go once kept')
})

// Stopped, the caret is where the take ended from the first frame on: what stopping waits for after (the tape read
// back, the engine given the file) takes frames, in which it once showed where the take had begun
test('editor: a take stopped, the caret at its end from the first frame, never back at its start', async () => {
  await page.route('**/playground/editor.js', async route => { const r = await route.fetch(); route.fulfill({ response: r, body: (await r.text()).replace('v = view(', 'v = globalThis.__view = view(') }) })
  await open()
  await noCues()
  await write(`audio('chime.wav')`)
  await lengthIs('0:08.000')
  await page.evaluate(() => __view.setCursor(2))
  await page.getByRole('button', { name: 'Record', exact: true }).click()
  await page.waitForFunction(() => __view.playhead > 2.6, null, { timeout: 15000 })
  // the stop's own task, before anything it waits for: the next frame drawn already has the caret there
  const frames = await page.evaluate(async () => {
    document.querySelector('button.record').click()
    const out = [[__view.playhead, __view.cursor]]
    for (let i = 0; i < 12; i++) { await new Promise(r => requestAnimationFrame(r)); out.push([__view.playhead, __view.cursor]) }
    return out
  })
  for (const [playhead, cursor] of frames) assert.ok(playhead != null || cursor > 2.5, `a frame after stop: playhead ${playhead}, caret ${cursor}`)
})

// The microphone is opened once and kept between takes (sources.js): the second take asks the device for nothing and
// starts on the next block; a hidden page lets it go (its tracks ended), the next take opens it again; another channel
// count opens another
test('editor: the microphone kept between takes, let go once the page is hidden, opened again for stereo', async () => {
  await open()
  await write('')
  await page.locator('.empty').waitFor()
  // mono to start from, whatever an earlier test kept
  await settings('Record in', 'Mono')
  await page.evaluate(() => {
    const md = navigator.mediaDevices, ask = md.getUserMedia.bind(md)
    window.__asked = []
    md.getUserMedia = async c => { const s = await ask(c); window.__asked.push(s); return s }
  })
  // a take: recording (Record lit, no longer armed: the microphone answered), a third of a second of it, stopped
  const take = async () => {
    await page.getByRole('button', { name: 'Record', exact: true }).click()
    await page.waitForFunction(() => { const b = document.querySelector('button.record'); return b.classList.contains('on') && !b.classList.contains('armed') }, null, { timeout: 15000 })
    await page.waitForTimeout(300)
    await page.getByRole('button', { name: 'Stop recording', exact: true }).click()
    await page.getByRole('button', { name: 'Record', exact: true }).waitFor()
  }
  await take()
  await take()
  assert.equal(await page.evaluate(() => window.__asked.length), 1, 'the second take asked the device for nothing')
  assert.equal(await page.evaluate(() => window.__asked[0].getAudioTracks()[0].readyState), 'live', 'kept open')
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange')) })
  await page.waitForFunction(() => window.__asked[0].getAudioTracks()[0].readyState === 'ended')
  await page.evaluate(() => { delete document.hidden })
  await take()
  assert.equal(await page.evaluate(() => window.__asked.length), 2, 'hidden, let go; the next take opened it again')
  await settings('Record in', 'Stereo')
  await take()
  assert.equal(await page.evaluate(() => window.__asked.length), 3, 'stereo: opened again, for two channels')
  assert.equal(await page.evaluate(() => window.__asked[1].getAudioTracks()[0].readyState), 'ended', 'the mono one let go')
  await settings('Record in', 'Mono')
})

// The bar's record button starts a take and stops it
// Recording over a sound, as a dictaphone or a tape: from the caret, into the waveform as it comes, what it covers
// replaced and the end extended past; one write() step, which Undo takes back. Into a selection, it ends at its end.
test('editor: the record button records over the sound from the caret, into the waveform, one step Undo takes back', async () => {
  await open()
  // a selection's edges go where they are let go: the take's own hits, still shown a moment after Undo, take none
  await noCues()
  await write(`audio('chime.wav')`)
  await lengthIs('0:08.000')
  const { box, x } = await axis(8), y = box.y + tall(box) * .3
  await page.mouse.click(x(7.5), box.y + box.height - 8)
  await page.getByRole('button', { name: 'Record', exact: true }).click()
  await page.getByRole('button', { name: 'Stop recording', exact: true }).waitFor()
  // the one or the other: Play is off while it records
  assert.equal(await page.locator('button.play').isDisabled(), true)
  // the clock runs from the caret, past the old end
  await page.waitForFunction(() => /^0:0(8\.[3-9]|9)/.test(document.querySelector('.time').textContent), null, { timeout: 15000 })
  // the level meter by the lanes reads the microphone, not the sound where the caret was: its bar on the meters' strip
  // (view.js onStrip), read as drawn (8 px short of the level axis, --axis: SPACE before it, 3 wide), up as it beeps and falling back between,
  // by a fifth at least (its beeps half a second apart, a peak meter falls 6 dB between them: meters.js ballistics)
  await page.waitForFunction(gutter => {
    const o = document.querySelector('.plot canvas.overlay'), c = document.querySelector('.plot canvas.meters'), k = c.width / c.clientWidth, w = o.clientWidth - gutter
    const d = c.getContext('2d').getImageData(Math.round((w - 8 - c.offsetLeft) * k), 10 * k, Math.round(3 * k), c.height - 40 * k).data
    let n = 0
    for (let i = 3; i < d.length; i += 4) if (d[i] > 60) n++
    const seen = globalThis.metered ??= { top: 0, down: false }
    seen.top = Math.max(seen.top, n)
    if (seen.top > 20 && n < seen.top * .8) seen.down = true
    return seen.down
  }, await gutter(), { timeout: 10000 })
  await page.getByRole('button', { name: 'Stop recording', exact: true }).click()
  await page.waitForFunction(() => /\.write\(audio\('take\.wav'\), \{ at: 7\.5 \}\)$/.test(scriptText()))
  await page.waitForFunction(() => +(e => e.title || e.dataset.tip || '')(document.querySelector('.source')).split(' · ').pop().split(':')[1] > 8.2)
  // stopped, the caret waits where the take ended, as a tape's head: Record again records on from there, the takes
  // meeting to the sample
  const ended = +(await page.locator('.time').innerText()).split(':')[1]
  assert.ok(ended > 8.2, `the caret where the take ended: ${ended}`)
  await page.getByRole('button', { name: 'Record', exact: true }).click()
  await page.getByRole('button', { name: 'Stop recording', exact: true }).waitFor()
  await page.waitForFunction(ended => +document.querySelector('.time').textContent.split(':')[1] > ended + .3, ended, { timeout: 15000 })
  await page.getByRole('button', { name: 'Stop recording', exact: true }).click()
  await page.waitForFunction(() => /\.write\(audio\('take-2\.wav'\), \{ at: [\d.]+ \}\)$/.test(scriptText()))
  const on = +(await code()).match(/take-2\.wav'\), \{ at: ([\d.]+)/)[1]
  assert.ok(Math.abs(on - ended) < .001, `on from ${ended}: ${on}`)
  await page.keyboard.press('ControlOrMeta+Z')
  await page.keyboard.press('ControlOrMeta+Z')
  await lengthIs('0:08.000')
  // into a selection: it stops at its end by itself, the length kept
  await page.mouse.click(x(6), y)
  await drag([x(2), y], [x(2.5) - x(2), 0])
  await page.getByRole('button', { name: 'Record', exact: true }).click()
  await page.getByRole('button', { name: 'Record', exact: true }).waitFor({ timeout: 15000 })
  await page.waitForFunction(() => /\.write\(audio\('take(-\d)?\.wav'\), \{ at: 2 \}\)$/.test(scriptText()))
  await lengthIs('0:08.000')
  // with the loop on, pass after pass over the selection until stopped; the clock goes round within it
  await page.keyboard.press('ControlOrMeta+Z')
  await lengthIs('0:08.000')
  await page.mouse.click(x(6), y)
  await drag([x(2), y], [x(2.5) - x(2), 0])
  assert.equal(await selected(), '0:02.000–0:02.500')
  await page.getByRole('button', { name: 'Loop' }).click()
  await page.getByRole('button', { name: 'Record', exact: true }).click()
  await page.getByRole('button', { name: 'Stop recording', exact: true }).waitFor()
  // recording 1.3 s: passes over the half second selected
  await page.waitForTimeout(1300)
  const clock = +(await page.locator('.time').innerText()).split(':')[1]
  assert.ok(clock >= 2 && clock <= 2.5, `within the selection, pass after pass: ${clock}`)
  await page.getByRole('button', { name: 'Stop recording', exact: true }).click()
  await page.waitForFunction(() => /\.write\(audio\('take-\d\.wav'\), \{ at: 2 \}\)$/.test(scriptText()))
  await lengthIs('0:08.000')
  // each pass a take there, the last heard, the others turned off, the last cut short left out (1.3 s over 0.5 s: two or three, as the microphone starts)
  const heard = async () => (await code()).split('\n').filter(l => /\.write\(audio\('take/.test(l)).map(l => !l.trim().startsWith('//'))
  // the takes heard, as the script comes to say, in order
  const hearing = want => page.waitForFunction(w => JSON.stringify(scriptText().split('\n').filter(l => /\.write\(audio\('take/.test(l)).map(l => !l.trim().startsWith('//'))) === w, JSON.stringify(want))
  const passes = await heard()
  assert.ok(passes.length >= 2 && passes.at(-1) && passes.slice(0, -1).every(on => !on), `the passes, the last heard: ${passes}`)
  await page.locator('.message', { hasText: `Recorded ${passes.length} takes of 0:00.500` }).waitFor()
  // a number pressed in the strip hears that take, the first, then the last again; each one step Undo takes back (no
  // key switches them)
  const pressed = k => page.locator(`.plot .takes:not([hidden]) button[value="${k}"]`).click()
  await page.keyboard.press('t')
  await settled()
  await hearing(passes)
  await pressed(0)
  await hearing(passes.map((_, i) => i === 0))
  await pressed(passes.length - 1)
  await hearing(passes)
  await page.keyboard.press('ControlOrMeta+Z')
  await hearing(passes.map((_, i) => i === 0))
  await lengthIs('0:08.000')
  // recorded there again, the loop off: one more take, heard, the one heard before turned off
  await page.getByRole('button', { name: 'Loop' }).click()
  await page.mouse.click(x(6), y)
  await drag([x(2), y], [x(2.5) - x(2), 0])
  await page.getByRole('button', { name: 'Record', exact: true }).click()
  await page.getByRole('button', { name: 'Record', exact: true }).waitFor({ timeout: 15000 })
  await page.waitForFunction(n => (scriptText().match(/\.write\(audio\('take/g) ?? []).length === n, passes.length + 1)
  await hearing([...passes.map(() => false), true])
  await lengthIs('0:08.000')
  // Edit › Takes hears the one picked; in the edits, a take turned on is heard alone
  const n = passes.length + 1
  await menu('Transport', 'Takes', 'Take 1')
  await hearing(Array.from({ length: n }, (_, i) => i === 0))
  await tab('Edits')
  await page.getByRole('button', { name: 'Turn write on' }).last().click()
  await hearing(Array.from({ length: n }, (_, i) => i === n - 1))
  // on the picture, the place's numbers in its corner, the one heard lit, then +; a press on one hears it
  const chip = page.locator('.plot .takes')
  const numbers = () => chip.locator('button').evaluateAll(b => b.map(x => [x.value === 'add' ? 'fork' : x.textContent, x.getAttribute('aria-pressed')]))
  await page.waitForFunction(k => document.querySelector('.plot .takes:not([hidden]) button[aria-pressed="true"]')?.value === k, String(n - 1))
  assert.deepEqual(await numbers(), [...Array.from({ length: n }, (_, k) => [String(k + 1), String(k === n - 1)]), ['fork', null]])
  await chip.locator('button[value="1"]').click()
  await hearing(Array.from({ length: n }, (_, i) => i === 1))
  await page.waitForFunction(() => document.querySelector('.plot .takes button[aria-pressed="true"]')?.value === '1')
  // ⌥R, Alt adding: another take of the place the caret is in, into it, to its end, heard (the picture narrower now,
  // the panel open)
  const narrow = await axis(8)
  await page.mouse.click(narrow.x(2.25), narrow.box.y + narrow.box.height - 8)
  await page.keyboard.press('Alt+KeyR')
  await page.getByRole('button', { name: 'Stop recording', exact: true }).waitFor()
  await page.getByRole('button', { name: 'Record', exact: true }).waitFor({ timeout: 15000 })
  await page.waitForFunction(n => (scriptText().match(/\.write\(audio\('take/g) ?? []).length === n, n + 1)
  await hearing(Array.from({ length: n + 1 }, (_, i) => i === n))
  assert.match(await code(), /\.write\(audio\('take-\d+\.wav'\), \{ at: 2 \}\)$/)
  await lengthIs('0:08.000')
})

// Takes are marked in the strip under the lanes, from where they go in to where the longest of them ends (each measured,
// those turned off too, a sample's or a file kept as a recording's), pressed there selecting all of it, as a range
// marker's, their numbers at its end inside it (held in sight at the picture's right), on a name's line, + selecting
// their place, nothing said by them; on a visit's first run too
test('editor: takes are marked in the strip under all they span, pressed there selecting it, their numbers in it', async () => {
  await open()
  // the one heard 4.5 s long, the one turned off 8 s: to 9 s, the sound's end
  await write(`audio('rhodes.wav')\n  // .write(audio('chime.wav'), { at: 1 })\n  .write(audio('birdsong.wav'), { at: 1 })`)
  await lengthIs('0:09.000')
  const { box, x } = await axis(9), chip = page.locator('.plot .takes:not([hidden])')
  await chip.waitFor()
  // at its end inside it, here the sound's, on a name's line (NAMES, 6 px under the lanes' foot)
  const corner = await chip.boundingBox()
  assert.ok(corner.x > x(8) && corner.x + corner.width <= x(9) + TAIL + 1 && Math.abs(corner.y + corner.height / 2 - box.y - tall(box) - 6) < 2, `in its strip, by its end: ${JSON.stringify(corner)}`)
  // its place in the strip, pressed near its end: all of it selected, to 9 s
  const strip = box.y + tall(box) + FOOT / 2
  const line = async () => { await page.mouse.move(x(8.7), strip); return page.evaluate(() => document.querySelector('.plot').style.cursor) }
  assert.equal(await line(), 'pointer')
  await frames()
  assert.equal(await page.locator('.hint').evaluate(e => e.hidden ? '' : e.textContent), '', 'nothing said: a press there is plain')
  await page.mouse.click(x(8.7), strip)
  assert.equal(await selected(), '0:01.000–0:09.000')
  // + adds an empty take there, as long as the place, heard, its place selected, recording nothing; + then off till it
  // is recorded into or deleted (Delete take, a right-click there: the one before heard again)
  await page.mouse.click(x(5), box.y + tall(box) * .5)
  await chip.locator('button[value="add"]').click()
  await page.waitForFunction(() => scriptText().endsWith(`// .write(audio('birdsong.wav'), { at: 1 })\n  .write(audio.from(8), { at: 1 })`))
  assert.equal(await selected(), '0:01.000–0:09.000')
  assert.equal(await page.getByRole('button', { name: 'Stop recording', exact: true }).count(), 0)
  await page.locator('.plot .takes button[value="add"][aria-disabled="true"]').waitFor()
  await chip.locator('button[value="add"]').click({ force: true })
  assert.equal((await code()).match(/audio\.from\(8\)/g).length, 1, 'one empty take at a time')
  await page.mouse.click(x(5), box.y + tall(box) * .5, { button: 'right' })
  await page.locator('.menu-row', { hasText: 'Delete take' }).click()
  await page.waitForFunction(() => scriptText().endsWith(`  .write(audio('birdsong.wav'), { at: 1 })`))
  await page.mouse.click(x(5), box.y + tall(box) * .5)
  await page.reload()
  await wholeLevels().waitFor()
  for (const until = Date.now() + 5000; await line() !== 'pointer'; await page.waitForTimeout(100)) assert.ok(Date.now() < until, 'measured on the first run too')
  // another tab shown and this one again, its sound as it was left, nothing run: its takes there still
  const tabs = page.locator('.file [role="tab"]')
  await page.getByRole('button', { name: 'New tab' }).click()
  await page.locator('.plot .takes').waitFor({ state: 'hidden' })
  await tabs.first().click()
  await chip.waitFor({ timeout: 2000 })
  assert.equal(await line(), 'pointer', 'shown again, its takes there')
})

// A range marked over the takes' place names it: its name at their start, their numbers at their end, inside it (as
// far from it as the name is from the start: the last number's padding, 2 px, then 2 px)
test('editor: a range over the takes\' place names it, its name at their start, their numbers at their end', async () => {
  await open()
  await write(`audio('rhodes.wav')\n  // .write(audio('chime.wav'), { at: 1 })\n  .write(audio('birdsong.wav'), { at: 1 })\n  .pad(0, 3)\n  .mark({ at: 1, d: 8 }, 'Verse')`)
  await lengthIs('0:12.000')
  const { box, x } = await axis(12), lane = Math.round(tall(box)), chip = page.locator('.plot .takes:not([hidden])')
  await chip.waitFor()
  const at = await chip.boundingBox()
  assert.ok(Math.abs(at.x + at.width - x(9) + 2) < 2, `at their end, inside: ${at.x + at.width - x(9)} px`)
  // the rows the bright ink of columns [a, b) takes in the strip, from the lanes' foot
  const rows = (a, b) => pixels(`const out = []; for (let y = arg.y0; y < arg.y1; y++) { for (let x = arg.a; x < arg.b; x++) { const i = (y * w + x) * 4; if (d[i] > 120) { out.push(y - arg.lane); break } } } return out`, { a, b, y0: lane, y1: lane + 18, lane })
  // its name from 4 px past their start, bright on the strip's line (once its marker has come with the output)
  const ink = () => pixels(`let n = 0; for (let y = arg.y0; y < arg.y1; y++) for (let x = arg.a; x < arg.b; x++) { const i = (y * w + x) * 4; if (d[i] > 120) n++ } return n`, { a: Math.round(x(1) - box.x) + 3, b: Math.round(x(1) - box.x) + 34, y0: lane + 1, y1: lane + 12 })
  await poll(ink, lit => assert.ok(lit >= 15, `its name at their start: ${lit}`))
  // their numbers' text on its name's rows, from a pixel under the lanes' foot (its middle NAMES, 6 px, under it)
  const named = await rows(Math.round(x(1) - box.x) + 3, Math.round(x(1) - box.x) + 34), numbers = await rows(Math.round(at.x - box.x), Math.round(at.x - box.x + at.width))
  assert.ok(named[0] === 1 && JSON.stringify(numbers) === JSON.stringify(named), `the numbers on the name's rows: ${numbers}, ${named}`)
})

// More takes than four show three about the one heard, in sight, as a pager keeps its page, … either side for those
// past them, a menu of them all, the one heard checked; four, each its number (… would take a number's room and hide
// one); after them a fork, another take
test('editor: takes past the third fold into a menu, the one heard in sight', async () => {
  await open()
  const takes = (n, k) => `audio('rhodes.wav')` + Array.from({ length: n }, (_, i) => `\n  ${i === k ? '' : '// '}.write(audio('chime.wav'), { at: 1 })`).join('')
  const chip = page.locator('.plot .takes:not([hidden])')
  const shown = () => chip.locator('button').evaluateAll(b => b.map(x => x.value === 'add' ? (x.querySelector('svg') ? 'fork' : x.textContent) : x.textContent + (x.getAttribute('aria-pressed') === 'true' ? '*' : '')))
  const heard = k => page.waitForFunction(k => document.querySelector('.plot .takes:not([hidden]) button[aria-pressed="true"]')?.value === k, String(k))
  await write(takes(4, 3))
  await heard(3)
  assert.deepEqual(await shown(), ['1', '2', '3', '4*', 'fork'])
  // five, the fewest that fold, the fourth heard: the third to the fifth, the first two folded before them
  await write(takes(5, 3))
  await page.waitForFunction(() => document.querySelector('.plot .takes:not([hidden]) button[value="more"]'))
  assert.deepEqual(await shown(), ['…', '3', '4*', '5', 'fork'])
  await write(takes(6, 1))
  await heard(1)
  assert.deepEqual(await shown(), ['1', '2*', '3', '…', 'fork'])
  await write(takes(6, 4))
  await heard(4)
  assert.deepEqual(await shown(), ['…', '4', '5*', '6', 'fork'])
  // … pressed: all six as a menu under it, the one heard checked; one picked there, heard, in sight after …
  await chip.locator('button[value="more"]').click()
  assert.equal(await chip.locator('button[value="more"]').getAttribute('aria-expanded'), 'true')
  const rows = await page.locator('.menubar-menu .menu-row').evaluateAll(r => r.map(x => [x.querySelector('.menu-label').textContent, x.getAttribute('aria-checked')]))
  assert.deepEqual(rows, Array.from({ length: 6 }, (_, k) => [`Take ${k + 1}`, String(k === 4)]))
  await contextRow('Take 6').click()
  await heard(5)
  assert.match(await code(), /\/\/ \.write\(audio\('chime\.wav'\), \{ at: 1 \}\)\n {2}\.write\(audio\('chime\.wav'\), \{ at: 1 \}\)$/)
  assert.deepEqual(await shown(), ['…', '4', '5', '6*', 'fork'])
  // the third heard of six: the second to the fourth, … either side
  await write(takes(6, 2))
  await heard(2)
  assert.deepEqual(await shown(), ['…', '2', '3*', '4', '…', 'fork'])
})

// Takes stay drawn through an edit after them that leaves their place where it is (a delete of the tail), drawn where it
// goes after one that moves it (a delete before them), and as the script alone can't place them (a trim), not drawn
test('editor: takes drawn where the steps after them take their place', async () => {
  await open()
  const takes = `audio('rhodes.wav')\n  // .write(audio('chime.wav'), { at: 1 })\n  .write(audio('birdsong.wav'), { at: 1 })`, chip = page.locator('.plot .takes:not([hidden])')
  // their place, pressed in the strip just past where it starts: selected from there
  const corner = async (n, t, from) => { await lengthIs(n); const { box, x } = await axis(+n.slice(3)); await chip.waitFor(); await page.mouse.click(x(t) + 10, box.y + tall(box) + FOOT / 2); assert.equal((await selected()).split('–')[0], from) }
  await write(`${takes}\n  .remove({ at: 8, d: 1 })`)
  await corner('0:08.000', 1, '0:01.000')
  await write(`${takes}\n  .remove({ at: 0, d: 0.5 })`)
  await corner('0:08.500', .5, '0:00.500')
  await write(`${takes}\n  .trim()`)
  await page.locator('.plot .takes').waitFor({ state: 'hidden' })
})

// Takes under a sound written over their place after them: one more recorded there brings them over it, heard (it once
// stayed under it, the picture going back to what covered it as it stopped, the take unheard); so does a take switched
// there, by its number
test('editor: a take recorded where takes are under a later write brings them over it, heard; a take switched too', async () => {
  await open()
  const buried = `audio('rhodes.wav')\n  // .write(audio('chime.wav'), { at: 1 })\n  .write(audio('birdsong.wav'), { at: 1 })\n  .write(audio('chime.wav'), { at: 1.5 })`
  await write(buried)
  await lengthIs('0:09.500')
  const { box, x } = await axis(9.5), chip = page.locator('.plot .takes:not([hidden])')
  await chip.waitFor()
  // their place selected (pressed in the strip), Record records into it, from its start
  await page.mouse.click(x(5), box.y + tall(box) + FOOT / 2)
  assert.equal(await selected(), '0:01.000–0:09.000')
  await page.getByRole('button', { name: 'Record', exact: true }).click()
  await page.getByRole('button', { name: 'Stop recording', exact: true }).waitFor()
  await page.waitForFunction(() => /^0:0(1\.[5-9]|[2-9])/.test(document.querySelector('.time').textContent), null, { timeout: 15000 })
  await page.getByRole('button', { name: 'Stop recording', exact: true }).click()
  await page.waitForFunction(() => /take\.wav/.test(scriptText()))
  assert.equal(await code(), `audio('rhodes.wav')\n  .write(audio('chime.wav'), { at: 1.5 })\n  // .write(audio('chime.wav'), { at: 1 })\n  // .write(audio('birdsong.wav'), { at: 1 })\n  .write(audio('take.wav'), { at: 1 })`)
  // a take switched where they are under it: they come over it, that one heard
  await write(buried)
  await chip.waitFor()
  // (its two takes shown, the recorded one gone with the script that had it)
  await chip.locator('button[value="2"]').waitFor({ state: 'detached' })
  await chip.locator('button[value="0"]').click()
  await page.waitForFunction(() => scriptText().endsWith(`.write(audio('chime.wav'), { at: 1.5 })\n  .write(audio('chime.wav'), { at: 1 })\n  // .write(audio('birdsong.wav'), { at: 1 })`))
})

// Recorded with the spectrogram shown, the take is drawn as one: its columns on the spectrogram's layer where it goes, no
// waveform on the waveform's. The fake microphone (Chromium's --use-fake-device-for-media-stream) beeps each second.
test('editor: recording with the spectrogram shown draws the take as a spectrogram', async t => {
  // real time on software GL: headless Chromium draws the live spectrogram on the CPU as the take grows, which a CI
  // runner's few cores can't keep up with (a click on Stop waited past 30 s). CI runs it apart, as advice (test.yml)
  if (process.env.CI) return t.skip('real time on software GL: CI runs it apart')
  await open()
  await noCues()
  await write(`audio('chime.wav')`)
  await lengthIs('0:08.000')
  await show('spec')
  const { box, x } = await axis(8)
  await page.mouse.click(x(1), box.y + box.height - 8)
  await page.getByRole('button', { name: 'Record', exact: true }).click()
  await page.getByRole('button', { name: 'Stop recording', exact: true }).waitFor()
  // past 3.5 s (a slow machine's clock, drawn seconds apart, may pass it between two looks)
  await page.waitForFunction(() => { const [m, s] = document.querySelector('.time').textContent.split(':'); return +m * 60 + +s >= 3.5 }, null, { timeout: 15000 })
  // each layer alone: lit pixels between 1.2 s and 2.8 s, inside the take, over the lanes
  const lit = async layer => {
    await page.evaluate(layer => { for (const c of document.querySelectorAll('.plot canvas')) c.style.visibility = c.classList.contains(layer) ? '' : 'hidden' }, layer)
    const n = await pixels(`let n = 0; for (let y = 10; y < h - 30; y++) for (let x = arg[0]; x < arg[1]; x++) { const i = (y * w + x) * 4; if (Math.max(d[i], d[i + 1], d[i + 2]) > 90) n++ } return n`, [Math.round(x(1.2) - box.x), Math.round(x(2.8) - box.x)])
    await page.evaluate(() => { for (const c of document.querySelectorAll('.plot canvas')) c.style.visibility = '' })
    return n
  }
  const [spectrum, waveform] = [await lit('spectrum'), await lit('waveform')]
  await page.getByRole('button', { name: 'Stop recording', exact: true }).click()
  assert.ok(spectrum > 50, `the take's spectrogram: ${spectrum} lit`)
  assert.equal(waveform, 0)
})

// Pressed under the lanes, the caret a new track's to be; R records into it from there, the others playing: the track
// made as the take starts, under the last, the take written into it where the caret was
test('editor: R at the caret under the lanes records a new track there', async () => {
  const { box, x } = await chime()
  await page.mouse.click(x(2), box.y + tall(box) + FOOT + ROOM / 2)
  await page.keyboard.press('r')
  await page.getByRole('button', { name: 'Stop recording', exact: true }).waitFor()
  await page.waitForFunction(() => { const [m, s] = document.querySelector('.time').textContent.split(':'); return +m * 60 + +s >= 3 }, null, { timeout: 15000 })
  await page.keyboard.press('r')
  await page.waitForFunction(() => /^let chime = audio\('chime\.wav'\)\n\nlet track = audio\.from\(0\)\n  \.write\(audio\('take\.wav'\), \{ at: 2 \}\)$/.test(scriptText()))
})

// The same with the Record button, as with R: the caret in the room makes the take a new track's, not the last one's
test('editor: the Record button with the caret under the lanes records a new track there', async () => {
  const { box, x } = await chime()
  await page.mouse.click(x(2), box.y + tall(box) + FOOT + ROOM / 2)
  await page.getByRole('button', { name: 'Record', exact: true }).click()
  await page.getByRole('button', { name: 'Stop recording', exact: true }).waitFor()
  await page.waitForFunction(() => { const [m, s] = document.querySelector('.time').textContent.split(':'); return +m * 60 + +s >= 3 }, null, { timeout: 15000 })
  await page.getByRole('button', { name: 'Stop recording', exact: true }).click()
  await page.waitForFunction(() => /^let chime = audio\('chime\.wav'\)\n\nlet track = audio\.from\(0\)\n  \.write\(audio\('take\.wav'\), \{ at: 2 \}\)$/.test(scriptText()))
})

// Recorded into a track, the others play as it records, the track it goes into muted; the take goes where what played
// was as the microphone heard it: both clocks read at once, the speakers' and the microphone's, less the microphone's
// latency. Here the microphone hears the page's own output, digitally, as it is rendered, before the speakers: the take
// lands that much early, the output's latency (the browser's, baseLatency and outputLatency), give or take the stream
// between the two contexts, which holds it some tens of ms more (Chromium's: 20 to 30). Not lined up, it would land as
// late as the device took to start playing, 0.2 to 0.5 s here
test('editor: ⇧R records a new track as the others play, lined up with what played', async () => {
  await page.route('**/playground/editor.js', async route => { const r = await route.fetch(); route.fulfill({ response: r, body: (await r.text()).replace('const eng = engine()', 'const eng = globalThis.__eng = engine()') }) })
  await page.route('**/playground/editor/context.js', async route => { const r = await route.fetch(); route.fulfill({ response: r, body: (await r.text()).replace('let output = null, incoming', 'globalThis.__output = () => output\nlet output = null, incoming') }) })
  // the microphone: what the page plays, tapped where it goes out
  await page.addInitScript(() => {
    const connect = AudioNode.prototype.connect, taps = new Map()
    AudioNode.prototype.connect = function (dest, ...rest) {
      const r = connect.call(this, dest, ...rest)
      if (dest instanceof AudioDestinationNode) {
        let t = taps.get(dest.context)
        if (!t) taps.set(dest.context, t = dest.context.createMediaStreamDestination())
        connect.call(this, t)
        globalThis.__tapped = { stream: t.stream, context: dest.context }
      }
      return r
    }
    navigator.mediaDevices.getUserMedia = async () => globalThis.__tapped.stream
  })
  const { box, x, y } = await chime()
  // played once, so its output goes somewhere to be tapped
  await page.keyboard.press('Space')
  await page.waitForFunction(() => globalThis.__tapped)
  await page.keyboard.press('Space')
  await page.mouse.click(x(.01), y)
  await page.keyboard.press('Home')
  await page.keyboard.press('Shift+R')
  await page.getByRole('button', { name: 'Stop recording', exact: true }).waitFor()
  await page.waitForFunction(() => { const [m, s] = document.querySelector('.time').textContent.split(':'); return +m * 60 + +s >= 3 }, null, { timeout: 15000 })
  await page.keyboard.press('r')
  await page.waitForFunction(() => /^let chime = audio\('chime\.wav'\)\n\nlet track = audio\.from\(0\)\n  \.write\(audio\('take\.wav'\), \{ at: [\d.]+ \}\)$/.test(scriptText()))
  await page.waitForFunction(() => __output()?.tracks?.length === 2)
  // the lag of the take's lane against the chime's, over its first 3 s, ms; read off the output shown once the engine has
  // it whole (none of one a newer output replaced as it came: the one shown then is that one)
  const { lag, late } = await page.evaluate(async () => {
    let out, lanes
    for (const until = Date.now() + 8000; !lanes && Date.now() < until;) lanes = await __eng.samples((out = __output()).id, 0, Math.round(3 * out.sampleRate)) ?? await new Promise(r => setTimeout(r, 100))
    const n = Math.round(3 * out.sampleRate), [a, b] = lanes, rate = out.sampleRate
    let best = { lag: 0, c: -Infinity }
    for (let k = -4000; k <= 4000; k += 2) { let c = 0; for (let i = 8000; i < n - 8000; i += 3) c += a[i] * (b[i + k] ?? 0); if (c > best.c) best = { lag: k, c } }
    return { lag: best.lag / rate * 1000, late: (__tapped.context.baseLatency + __tapped.context.outputLatency) * 1000 }
  })
  assert.ok(Math.abs(lag + late) < 60, `the take ${lag.toFixed(1)} ms from the chime, the output's latency ${late.toFixed(1)} ms`)
})

// A take recorded as the others play is drawn as it comes where its output will put it, lined up with what played: the
// same strike in the same column as it records and once it is done, no shift as it stops (it once jumped left by the
// output's latency, the samples heard before its start left out only once it was written)
test('editor: a take recorded as the others play is drawn where it will be, no shift once it is done', async () => {
  await page.route('**/playground/editor.js', async route => { const r = await route.fetch(); route.fulfill({ response: r, body: (await r.text()).replace('const state = sprae(root, {', 'const state = globalThis.__state = sprae(root, {') }) })
  await page.route('**/playground/editor/context.js', async route => { const r = await route.fetch(); route.fulfill({ response: r, body: (await r.text()).replace('let output = null, incoming', 'globalThis.__output = () => output\nlet output = null, incoming') }) })
  // the microphone: what the page plays, tapped where it goes out
  await page.addInitScript(() => {
    const connect = AudioNode.prototype.connect, taps = new Map()
    AudioNode.prototype.connect = function (dest, ...rest) {
      const r = connect.call(this, dest, ...rest)
      if (dest instanceof AudioDestinationNode) {
        let t = taps.get(dest.context)
        if (!t) taps.set(dest.context, t = dest.context.createMediaStreamDestination())
        connect.call(this, t)
        globalThis.__tapped = { stream: t.stream, context: dest.context }
      }
      return r
    }
    navigator.mediaDevices.getUserMedia = async () => globalThis.__tapped.stream
  })
  const { x, y } = await chime()
  await page.keyboard.press('Space')
  await page.waitForFunction(() => globalThis.__tapped)
  await page.keyboard.press('Space')
  await page.mouse.click(x(.01), y)
  await page.keyboard.press('Home')
  await page.keyboard.press('Shift+R')
  await page.getByRole('button', { name: 'Stop recording', exact: true }).waitFor()
  // the first of three columns running of the take's lane lit, px: its first strike (the caret's and the playhead's
  // lines a column wide)
  const strike = () => page.evaluate(() => __state.layout?.rows?.[1]).then(row => row && pixels(`let run = 0; for (let x = 0; x < w - 60; x++) { let n = 0; for (let y = Math.round(arg.y); y < arg.y + arg.h; y++) { const i = (y * w + x) * 4; if (d[i] + d[i + 1] + d[i + 2] > 450) n++ } run = n > 8 ? run + 1 : 0; if (run === 3) return x - 2 } return -1`, row))
  await page.waitForFunction(() => { const [m, s] = document.querySelector('.time').textContent.split(':'); return +m * 60 + +s >= 3 }, null, { timeout: 15000 })
  // (a busy runner draws the take a few frames behind the clock)
  const during = await poll(strike, d => assert.ok(!(d < 0)), 5000).catch(strike)
  await page.keyboard.press('r')
  await page.waitForFunction(() => /\.write\(audio\('take\.wav'\)/.test(scriptText()))
  await page.waitForFunction(() => __output()?.tracks?.length === 2 && !document.querySelector('.message').textContent.includes('Rendering'))
  await settled()
  const after = await strike()
  assert.ok(during > 0 && Math.abs(after - during) <= 1, `its first strike at ${during} px as it recorded, ${after} px done`)
})

// Record pressed with Shift, as ⇧R: a new track, recorded into as the others play
test('editor: Record with Shift records a new track', async () => {
  const { box, x } = await chime()
  await page.mouse.click(x(1), box.y + 40)
  await page.getByRole('button', { name: 'Record', exact: true }).click({ modifiers: ['Shift'] })
  await page.getByRole('button', { name: 'Stop recording', exact: true }).waitFor()
  await page.waitForFunction(() => /let track = audio\.from\(0\)$/.test(scriptText()))
  await page.waitForFunction(() => { const [m, s] = document.querySelector('.time').textContent.split(':'); return +m * 60 + +s >= 2 }, null, { timeout: 15000 })
  await page.getByRole('button', { name: 'Stop recording', exact: true }).click()
  await page.waitForFunction(() => /let track = audio\.from\(0\)\n  \.write\(audio\('take\.wav'\), \{ at: 1 \}\)$/.test(scriptText()))
})

// A take recorded again into a track, from earlier than the last ended: the others play from the caret, so it goes
// where the caret was (it once went where the last take had stopped them: the player took the voice paused there over,
// its place over the new start, the take written seconds late and the track ever longer)
test('editor: a second take into a track goes where its caret was, after a first that ran on past it', async () => {
  const { box, x } = await chime()
  await page.mouse.click(x(1), box.y + 40)
  await page.keyboard.press('Shift+R')
  await page.getByRole('button', { name: 'Stop recording', exact: true }).waitFor()
  await page.waitForFunction(() => { const [m, s] = document.querySelector('.time').textContent.split(':'); return +m * 60 + +s >= 3 }, null, { timeout: 15000 })
  await page.keyboard.press('r')
  await page.waitForFunction(() => /\.write\(audio\('take\.wav'\), \{ at: 1 \}\)$/.test(scriptText()))
  await page.locator('.layer').nth(1).waitFor({ state: 'attached' })
  // (the layers beside the picture now, the picture after them)
  await settled()
  await still()
  const { x: x8 } = await axis(8)
  await page.mouse.click(x8(.5), (r => r.y + r.h / 2)((await tracksAt())[1]))
  await page.keyboard.press('r')
  await page.getByRole('button', { name: 'Stop recording', exact: true }).waitFor()
  await page.waitForFunction(() => { const [m, s] = document.querySelector('.time').textContent.split(':'); return +m * 60 + +s >= 1.5 }, null, { timeout: 15000 })
  await page.keyboard.press('r')
  await page.waitForFunction(() => /\.write\(audio\('take-2\.wav'\), \{ at: [\d.]+ \}\)$/.test(scriptText()))
  const at = +(await code()).match(/take-2\.wav'\), \{ at: ([\d.]+) \}/)[1]
  assert.ok(Math.abs(at - .5) < .02, `the second take at ${at} s, the caret at 0.5`)
  await lengthIs('0:08.000')
})

// Into a track, the others playing, over a selection with the loop on: pass after pass, the others looping with it,
// each a take, shown as one as it is done, the one recording lit (it once stopped after the first, short of the
// selection's end by the microphone's latency)
test('editor: recorded into a track over a selection, the loop on, pass after pass, each a take as it goes', async () => {
  await open()
  await noCues()
  await write(`let a = audio('rhodes.wav')\n\nlet b = audio('chime.wav')`)
  await lengthIs('0:09.000')
  await page.locator('.layer').nth(1).waitFor({ state: 'attached' })
  const { x } = await axis(9), lane = (r => r.y + r.h / 2)((await tracksAt())[1])
  await page.mouse.click(x(1), lane)
  await drag([x(6), lane], [x(7) - x(6), 0])
  assert.equal(await selected(), '0:06.000–0:07.000')
  await page.getByRole('button', { name: 'Loop' }).click()
  await page.keyboard.press('r')
  await page.getByRole('button', { name: 'Stop recording', exact: true }).waitFor()
  // the second pass under way: the first a take there, the one recording lit, nothing to switch to yet
  const numbers = () => page.locator('.plot .takes:not([hidden]) button').evaluateAll(b => b.map(x => x.value === 'add' ? 'fork' : x.textContent + (x.getAttribute('aria-pressed') === 'true' ? '*' : '')))
  await page.waitForFunction(() => document.querySelectorAll('.plot .takes:not([hidden]) button').length === 3, null, { timeout: 15000 })
  assert.deepEqual(await numbers(), ['1', '2*', 'fork'])
  await page.waitForFunction(() => document.querySelectorAll('.plot .takes:not([hidden]) button').length === 4, null, { timeout: 15000 })
  await page.keyboard.press('r')
  await page.waitForFunction(() => (scriptText().match(/\.write\(audio\('take/g) ?? []).length >= 2)
  const lines = (await code()).split('\n').filter(l => /\.write\(audio\('take/.test(l))
  assert.ok(lines.length >= 2 && lines.every(l => /\{ at: 6 \}\)$/.test(l)), lines.join('\n'))
  assert.ok(lines.slice(0, -1).every(l => l.trim().startsWith('//')) && !lines.at(-1).trim().startsWith('//'), 'the last heard')
  assert.match(await code(), /^let b = audio\('chime\.wav'\)$/m, 'into the track recorded into')
})

// Recorded into nothing, however quiet, a take is watched at full scale (±1), held still as it comes and once it is the
// sound, as a recording app's: its levels as they are, not widened to fill its lane (they were, 6 dB at a time, the
// picture jumping as it got louder)
test('editor: a quiet take recorded into nothing is drawn at full scale', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'audio-take-')), file = join(dir, 'quiet.wav'), rate = 48000, n = rate * 4
  // 220 Hz at 0.08 of full scale, as 16-bit PCM, which Chromium's fake capture reads and loops
  const wav = Buffer.alloc(44 + n * 2)
  wav.write('RIFF', 0); wav.writeUInt32LE(36 + n * 2, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22)
  wav.writeUInt32LE(rate, 24); wav.writeUInt32LE(rate * 2, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(n * 2, 40)
  for (let i = 0; i < n; i++) wav.writeInt16LE(Math.round(32767 * .08 * Math.sin(2 * Math.PI * 220 * i / rate)), 44 + 2 * i)
  await writeFile(file, wav)
  const quiet = await chromium.launch({ args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', `--use-file-for-fake-audio-capture=${file}`] })
  try {
    const p = await quiet.newPage()
    p.on('pageerror', e => errors.push(e.message))
    // how far up its lane the waveform reaches over the first fifth of the view, from the centre line: 1 at its top. Its
    // one lane the picture's, TRACK px at least, but the room under it, kept as it records and once it is a sound (`room`,
    // px), so its lane is the same as it comes and done
    const reach = async (room = 0) => {
      const png = await p.locator('.plot').screenshot()
      return p.evaluate(async ([b64, most, room]) => {
        const img = new Image()
        img.src = 'data:image/png;base64,' + b64
        await img.decode()
        const c = Object.assign(document.createElement('canvas'), { width: img.width, height: img.height }), g = c.getContext('2d')
        g.drawImage(img, 0, 0)
        const d = g.getImageData(0, 0, c.width, c.height).data, mid = Math.max(most, c.height - 22 - 18 - room) / 2
        let top = mid
        for (let y = 0; y < mid; y++) for (let x = Math.round(c.width * .04); x < c.width * .2; x++) { const i = (y * c.width + x) * 4; if (Math.max(d[i], d[i + 1], d[i + 2]) > 120 && y < top) top = y }
        return (mid - top) / mid
      }, [png.toString('base64'), TRACK, room])
    }
    await p.goto(origin + '/playground/')
    await p.locator('.empty').waitFor()
    await p.locator('button.record').click()
    await p.waitForFunction(() => { const [m, s] = document.querySelector('.time').textContent.split(':'); return +m * 60 + +s >= 2.5 })
    const taking = await reach(ROOM)
    await p.getByRole('button', { name: 'Stop recording', exact: true }).click()
    await p.waitForFunction(() => document.querySelector('.readout')?.dataset.of === 'all')
    await settled(p)
    const taken = await reach(ROOM)
    // 0.08 in ±1
    assert.ok(taking > .05 && taking < .15, `as it records: ${taking}`)
    assert.ok(taken > .05 && taken < .15, `recorded: ${taken}`)
  } finally { await quiet.close(); await rm(dir, { recursive: true, force: true }) }
})

// A take is drawn as the output holding it will be: the spectrogram at the levels the output's will have (the loudest
// cell, here the take's own), the waveform in its fill and colour; stopped, the same pixels light the same. Within 10%:
// the loudest cell is a beep's, and how loud depends on how that beep's frames align, so the take's levels can move a
// little once it is whole (two runs' outputs differ by up to 6%; a slow runner's take gets more beeps before the stop)
test('editor: a take draws while it records as its output does after', async () => {
  const looks = [['spec'], ['wave'], ['wave', { Colour: 'Centroid', Fill: 'RMS' }]]
  for (const [view, wave] of looks) {
    await open()
    if (wave) for (const [group, name] of Object.entries(wave)) await settings(group, name)
    await write('')
    await page.locator('.empty').waitFor()
    await page.getByRole('button', { name: 'Record', exact: true }).first().click()
    await show(view)
    await page.waitForFunction(() => /^0:0[3-9]/.test(document.querySelector('.time').textContent), null, { timeout: 15000 })
    const { box, x } = await axis(10), layer = view === 'spec' ? 'spectrum' : 'waveform'
    // the layer alone, its mean red, green and blue over 0.2 to 2 s, recorded whole by now
    const mean = async () => {
      await page.evaluate(layer => { for (const c of document.querySelectorAll('.plot canvas')) c.style.visibility = c.classList.contains(layer) ? '' : 'hidden' }, layer)
      const v = await pixels(`const s = [0, 0, 0]; let n = 0; for (let y = 10; y < h - 30; y++) for (let x = arg[0]; x < arg[1]; x++, n++) for (let k = 0; k < 3; k++) s[k] += d[(y * w + x) * 4 + k]; return s.map(v => v / n)`, [Math.round(x(.2) - box.x), Math.round(x(2) - box.x)])
      await page.evaluate(() => { for (const c of document.querySelectorAll('.plot canvas')) c.style.visibility = '' })
      return v
    }
    const during = await mean()
    await page.getByRole('button', { name: 'Stop recording', exact: true }).click()
    await page.waitForFunction(() => /^audio\('recording/.test(scriptText()))
    await wholeLevels().waitFor()
    await settled()
    const after = await mean(), off = Math.hypot(...during.map((v, k) => v - after[k])) / Math.hypot(...after)
    assert.ok(Math.hypot(...after) > 5, `${view}: the output drawn (${after})`)
    assert.ok(off < .1, `${view} ${JSON.stringify(wave ?? {})}: ${during.map(v => v.toFixed(1))} while recording, ${after.map(v => v.toFixed(1))} after`)
  }
})

// A take is mono, the input's first channel, as a recorder takes a voice; the settings record stereo
test('editor: a recording is mono, unless the settings say stereo', async () => {
  await open()
  await write('')
  await page.locator('.empty').waitFor()
  await recordFor(1)
  await page.locator('.plot').focus()
  await page.keyboard.press('Space')
  await page.waitForFunction(() => scriptText().startsWith("audio('recording.wav')"))
  await wholeLevels().waitFor()
  // as it was written down, 32-bit float
  assert.match(await facts(), / mono 32-bit$/)
  await settings('Record in', 'Stereo')
  await page.reload()
  await tab('Settings')
  assert.equal(await choice('Record in', 'Stereo').getAttribute('aria-pressed'), 'true', 'kept')
})

// The page in the Mac app (desktop/app.js, put in as the shell puts it): the app told the panels, each with its button's
// icon as the page draws it, and the menus, each item with its icon drawn as the page's menus draw it (icons.js glyph),
// none where it has none, so the toolbar and the menu bar wear the page's icons and no set of their own; an item
// picked in the app's menu runs here
// In the Mac app, as a DAW: the microphone opened as the page opens, nothing pressed, its permission asked then, and
// kept, the page hidden too (sources.js hold), so a take starts on the next block
test('desktop: the microphone opens as the app opens and stays open', async () => {
  await page.addInitScript(() => {
    const md = navigator.mediaDevices, ask = md.getUserMedia.bind(md)
    window.__asked = []
    md.getUserMedia = async c => { const s = await ask(c); window.__asked.push(s); return s }
  })
  await page.goto(origin + '/playground/?desktop')
  await page.waitForFunction(() => window.__asked.length === 1 && window.__asked[0].getAudioTracks()[0].readyState === 'live', null, { timeout: 15000 })
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange')) })
  // a moment: a page not the app's would have let it go by now (sources.js)
  await page.waitForTimeout(300)
  assert.equal(await page.evaluate(() => window.__asked[0].getAudioTracks()[0].readyState), 'live', 'hidden, still open')
  assert.equal(await page.evaluate(() => window.__asked.length), 1, 'asked once')
})
