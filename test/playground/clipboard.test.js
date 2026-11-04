// Copy and paste, within a tab, between tabs and windows, and with the system; the server, the page and the helpers in
// page.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import audio from '../../audio.js'
import clock from '../../playground/time.js'
import { samples, RATE as SAMPLES } from '../../playground/samples.js'
import { browser, page, origin, errors, chimeLeft, code, open, settled, selected, palette, noCues, write, tall, axis, drag, lengthIs } from './page.js'

// The clipboard's keys: ⌘C copies the selection, ⌘X cuts it, ⌘V pastes at the caret, each a call on the chain. ⌘C once
// wrote the copy an Alt-drag makes, from a selection that has no destination: `copy: at is NaN`.
test('editor: ⌘C copies the selection, ⌘X cuts it, ⌘V pastes at the caret', async () => {
  await open()
  await noCues()
  await write(`audio('chime.wav')`)
  await lengthIs('0:08.000')
  const { box, x } = await axis(8), y = box.y + tall(box) * .3, last = () => code().then(c => c.trim().split('\n').at(-1))
  await drag([x(1), y], [x(2) - x(1), 0])
  await page.keyboard.press('ControlOrMeta+C')
  await page.waitForFunction(() => /\.copy\(\{ at: [\d.]+, d: [\d.]+ \}\)$/.test(scriptText().trim()))
  const [, at, duration] = (await last()).match(/\.copy\(\{ at: ([\d.]+), d: ([\d.]+) \}\)$/).map(Number)
  assert.ok(Math.abs(at - 1) < .02 && Math.abs(duration - 1) < .02, `${at} ${duration}`)
  // a copy keeps the selection, so the next edit takes it: reverse() of it, not of all (it once dropped the selection,
  // and the reverse turned the whole sound round)
  assert.match(await selected(), /^0:01\.\d+–0:02\.\d+$/)
  await palette('Reverse')
  await page.waitForFunction(() => /\.reverse\(\{ at: [\d.]+, d: [\d.]+ \}\)$/.test(scriptText().trim()))
  await page.mouse.click(x(5), y)
  await page.keyboard.press('ControlOrMeta+V')
  await page.waitForFunction(() => /\.paste\([\d.]+, 0\.01\)$/.test(scriptText().trim()))
  await drag([x(1), y], [x(2) - x(1), 0])
  await page.keyboard.press('ControlOrMeta+X')
  await page.waitForFunction(() => /\.cut\(\{ at: [\d.]+, d: [\d.]+, xfade: 0\.01 \}\)$/.test(scriptText().trim()))
  await settled()
  assert.equal(await page.locator('.message.problem').count(), 0, await page.locator('.message').allInnerTexts().then(t => t.join()))
})

// The clipboard is the editor's, not a tab's: a range copied in one tab pastes in another as the sound it was copied
// from (its sinks left out) cropped to the range; the tab it was copied in pastes its own copy step
test('editor: a range copied in one tab pastes in another', async () => {
  await open()
  await noCues()
  await write(`audio('chime.wav').gain(-3).save('out.wav')`)
  await lengthIs('0:08.000')
  const { box, x } = await axis(8), y = box.y + tall(box) * .3
  await drag([x(1), y], [x(2) - x(1), 0])
  await page.keyboard.press('ControlOrMeta+C')
  await page.waitForFunction(() => /\.copy\(\{ at: [\d.]+, d: [\d.]+ \}\)/.test(scriptText()))
  const [, at, d] = (await code()).match(/\.copy\(\{ at: ([\d.]+), d: ([\d.]+) \}\)/)
  const piece = `audio('chime.wav').gain(-3).crop({ at: ${at}, d: ${d} })`
  await page.getByRole('button', { name: 'New tab' }).click()
  await write(`audio('rhodes.wav')`)
  await lengthIs('0:09.000')
  const r = await axis(9)
  await page.mouse.click(r.x(3), y)
  await page.keyboard.press('ControlOrMeta+V')
  await page.waitForFunction(p => scriptText().includes(`.insert(${p}, { at: `), piece)
  await lengthIs(clock(9 + +d))
  // the first tab pastes its own copy
  await page.getByRole('tab', { name: 'chime.wav' }).click()
  await page.waitForFunction(() => scriptText().includes('.copy('))
  await page.mouse.click(x(5), y)
  await page.keyboard.press('ControlOrMeta+V')
  await page.waitForFunction(() => /\.paste\([\d.]+, 0\.01\)/.test(scriptText()))
  // its copy step undone, it pastes the clip as any other tab does
  await page.keyboard.press('ControlOrMeta+Z')
  await page.keyboard.press('ControlOrMeta+Z')
  await page.waitForFunction(() => !scriptText().includes('.copy('))
  await page.mouse.click(x(5), y)
  await page.keyboard.press('ControlOrMeta+V')
  await page.waitForFunction(p => scriptText().includes(`.insert(${p}, { at: `), piece)
})
// ... and from one window of the editor to another of the same browser: one copies all of its chime, the other, used
// there, pastes it into the same tab, as another's sound
test('editor: a range copied in one window pastes in another', async () => {
  const context = await browser.newContext(), first = await context.newPage(), second = await context.newPage()
  await chimeLeft(context)
  const script = p => p.evaluate(() => [...document.querySelectorAll('.cm-content .cm-line')].map(l => l.textContent).join('\n'))
  const caret = async p => { const b = await p.locator('.plot').boundingBox(); await p.mouse.click(b.x + b.width * .3, b.y + b.height * .3) }
  try {
    for (const p of [first, second]) p.on('pageerror', e => errors.push(e.message))
    await first.goto(origin + '/playground/')
    await first.locator('.readout[data-of="all"]').waitFor()
    await caret(first)
    await first.keyboard.press('ControlOrMeta+A')
    await first.keyboard.press('ControlOrMeta+C')
    await first.waitForFunction(() => localStorage.getItem('audio-repl-clip'))
    await second.goto(origin + '/playground/')
    await Promise.all([second.waitForEvent('load'), second.getByRole('button', { name: 'Use it here' }).click()])
    // (all of it selected, as the first left it: the readout the selection's)
    await second.waitForFunction(() => document.querySelector('.readout')?.dataset.of === 'selection')
    await caret(second)
    await second.keyboard.press('ControlOrMeta+V')
    await second.waitForFunction(() => /\.insert\(audio\('chime\.wav'\)\.trim\(\)\.normalize\(-1\)\.fade\(0\.02, 0\.1\)\.crop\(\{ at: 0, d: [\d.]+ \}\), \{ at: [\d.]+, xfade: 0\.01 \}\)$/.test([...document.querySelectorAll('.cm-content .cm-line')].map(l => l.textContent).join('').trim()))
    assert.equal((await script(second)).match(/\.copy\(/g).length, 1, 'the first window\'s copy step, as it stored it')
  } finally { await context.close() }
})

// A copy reaches the system's clipboard: the sound cropped to the range, as code, and in Chrome the range as a WAV (its
// web format), at the depth Export writes (16 bits for a generated sound), its samples the output's there: the library's
// own render of the same chain, read in Node, the reference
test('editor: a copy puts the range on the system clipboard, as code and as a WAV', async () => {
  await open()
  await noCues()
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin })
  await write(`audio('chime.wav').gain(-3)`)
  await lengthIs('0:08.000')
  const { box, x } = await axis(8), y = box.y + tall(box) * .3
  await drag([x(1), y], [x(2) - x(1), 0])
  await page.keyboard.press('ControlOrMeta+C')
  await page.waitForFunction(() => /\.copy\(/.test(scriptText()))
  const [, at, d] = (await code()).match(/\.copy\(\{ at: ([\d.]+), d: ([\d.]+) \}\)/).map(Number)
  // the WAV encoded in the worker, the clipboard written once it comes
  await page.waitForFunction(async () => { try { return (await navigator.clipboard.read())[0]?.types.includes('web audio/wav') } catch { return false } })
  const got = await page.evaluate(async () => {
    const [item] = await navigator.clipboard.read()
    return { types: item.types, text: await (await item.getType('text/plain')).text(), wav: [...new Uint8Array(await (await item.getType('web audio/wav')).arrayBuffer())] }
  })
  assert.equal(got.text, `audio('chime.wav').gain(-3).crop({ at: ${at}, d: ${d} })`)
  const a = await audio(new Uint8Array(got.wav)), [y0] = await a.read()
  assert.equal(a.bitDepth, 16)
  assert.equal(a.sampleRate, SAMPLES)
  // the range to the view's precision (a millisecond): its samples, wherever in that it starts, the render's to 16 bits
  assert.ok(Math.abs(y0.length - d * SAMPLES) < SAMPLES / 500, `${y0.length} samples for ${d} s`)
  const [ref] = await audio.from(samples.chime.make(), { sampleRate: SAMPLES }).gain(-3).read()
  const off = Math.round(at * SAMPLES), err = k => y0.reduce((m, v, i) => Math.max(m, Math.abs(v - ref[off + k + i])), 0)
  const best = Math.min(...Array.from({ length: 2 * 45 + 1 }, (_, k) => err(k - 45)))
  assert.ok(best <= 1 / 32768, `off by ${best}`)
})
// ⌘V takes what the system's clipboard holds that is newer than the editor's own copy: a WAV another page copied (as a
// page of this editor elsewhere does, its storage not this one's), and an audio file copied in the Finder, each going in
// at the caret as a file dropped there does
test('editor: ⌘V pastes a WAV another page copied, and an audio file copied elsewhere', async () => {
  await open()
  await noCues()
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin })
  await write(`audio('rhodes.wav')`)
  await lengthIs('0:09.000')
  const tone = [...await audio.from([Float32Array.from({ length: SAMPLES }, (_, i) => .5 * Math.sin(2 * Math.PI * 440 * i / SAMPLES))], { sampleRate: SAMPLES }).encode('wav')]
  await page.evaluate(bytes => navigator.clipboard.write([new ClipboardItem({ 'text/plain': new Blob(['elsewhere'], { type: 'text/plain' }), 'web audio/wav': new Blob([new Uint8Array(bytes)], { type: 'audio/wav' }) })]), tone)
  const { box, x } = await axis(9), y = box.y + tall(box) * .3
  await page.mouse.click(x(3), y)
  await page.keyboard.press('ControlOrMeta+V')
  await page.waitForFunction(() => /\.insert\(audio\('pasted\.wav'\), \{ at: 3(\.\d+)?, xfade: 0\.01 \}\)$/.test(scriptText().trim()))
  await lengthIs('0:10.000')
  // a file, as the browser hands one copied in the Finder with the paste
  await page.mouse.click((await axis(10)).x(5), y)
  await page.locator('.plot').evaluate((plot, bytes) => {
    const data = new DataTransfer()
    data.items.add(new File([new Uint8Array(bytes)], 'tone.wav', { type: 'audio/wav' }))
    plot.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }))
  }, tone)
  await page.waitForFunction(() => /\.insert\(audio\('tone\.wav'\), \{ at: 5(\.\d+)?, xfade: 0\.01 \}\)$/.test(scriptText().trim()))
  await lengthIs('0:11.000')
  const paste = (name, type) => page.locator('.plot').evaluate((plot, [bytes, name, type]) => {
    const data = new DataTransfer()
    data.items.add(new File([new Uint8Array(bytes)], name, { type }))
    plot.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }))
  }, [tone, name, type])
  // at two carets, at each, the last first
  const r = await axis(11)
  await page.mouse.click(r.x(2), y)
  await page.keyboard.down('Alt')
  await page.mouse.click(r.x(8), y)
  await page.keyboard.up('Alt')
  await paste('tone-2.wav', 'audio/wav')
  await page.waitForFunction(() => /\.insert\(audio\('tone-2\.wav'\), \{ at: 8(\.\d+)?, xfade: 0\.01 \}\)\.insert\(audio\('tone-2\.wav'\), \{ at: 2(\.\d+)?, xfade: 0\.01 \}\)$/.test(scriptText().trim()))
  await lengthIs('0:13.000')
  // a range copied here: its WAV on the system's clipboard is this editor's own, its copy step pasted, a file that is
  // not audio (an image copied) passed over
  const q = await axis(13)
  await page.mouse.click(q.x(6), y)
  await drag([q.x(1), y], [q.x(2) - q.x(1), 0])
  await page.keyboard.press('ControlOrMeta+C')
  await page.waitForFunction(() => /\.copy\(/.test(scriptText()))
  // (read as it changes, the write's WAV landing, a read throws: read again)
  await page.waitForFunction(async () => { try { const [i] = await navigator.clipboard.read(); return i?.types.includes('web audio/wav') && (await (await i.getType('text/plain')).text()).startsWith(`audio('rhodes.wav')`) } catch { return false } })
  await page.mouse.click(q.x(4), y)
  await paste('picture.png', 'image/png')
  await page.waitForFunction(() => /\.copy\(\{ at: [\d.]+, d: [\d.]+ \}\)\s*\.paste\([\d.]+, 0\.01\)$/.test(scriptText().trim()))
  // a ⌘V no paste follows (a browser that pastes only where text is written): the editor's own, as its key is let go
  await page.locator('.plot').evaluate(plot => { for (const type of ['keydown', 'keyup']) plot.dispatchEvent(new KeyboardEvent(type, { key: 'v', metaKey: true, ctrlKey: true, bubbles: true, cancelable: true })) })
  await page.waitForFunction(() => (scriptText().match(/\.paste\(/g) || []).length === 2)
  assert.equal((await code()).match(/pasted\.wav/g).length, 1, 'its own WAV not pasted as another page\'s')
})
