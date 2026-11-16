// The status bar's readouts: the level, the note, the chord, the facts; the server, the page and the helpers in page.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { TOP, TRACK, page, tipOf, wholeLevels, open, settled, frames, poll, menuRow, tab, download, noCues, write, LANES, tall, tracksAt, gutter, spans, axis, drag, lengthIs, pixels, show, chime, crossed } from './page.js'

// The readout pointed at marks what it reads on the sound, the peak: a plain line through where it is and at its level,
// each end crossed; a row of its table pointed at, that row's alone: the RMS, its level, no line through the peak
test('editor: the readout marks the level it reads on the sound, a row of its table that row\'s alone', async () => {
  await open()
  await noCues()
  await wholeLevels().waitFor()
  const box = await page.locator('.plot').boundingBox(), w = Math.round(await spans(box)), h = Math.round(tall(box))
  // in the cues' colour, the tallest column and the widest row of the lane, px
  const marks = () => pixels(`const on = (x, y) => accent((y * w + x) * 4) > 1 / 3
    let col = 0, row = 0
    for (let x = 0; x < arg.w; x++) { let n = 0; for (let y = 0; y < arg.h; y++) n += on(x, y); col = Math.max(col, n) }
    for (let y = 0; y < arg.h; y++) { let n = 0; for (let x = 0; x < arg.w; x++) n += on(x, y); row = Math.max(row, n) }
    return { col, row }`, { w, h })
  await page.locator('.readout').hover()
  await page.locator('#levels').waitFor()
  await poll(marks, peak => assert.ok(peak.col > h * .8 && peak.row > w * .8, `the peak, through its place and at its level: ${JSON.stringify(peak)}`))
  await page.locator('#levels tr', { hasText: 'RMS' }).hover()
  await poll(marks, rms => assert.ok(rms.col < h * .2 && rms.row > w * .8, `the RMS alone, at its level: ${JSON.stringify(rms)}`))
  await page.mouse.move(box.x + 10, box.y + TOP + 10)
  await poll(marks, none => assert.ok(none.col < h * .2 && none.row < w * .2, `let go, none: ${JSON.stringify(none)}`))
})

// The tracks mixed have no lane of their own: the level the readout reads is marked on every track's, the one not
// edited too
test('editor: with tracks, the readout marks the mix\'s level on every track\'s lane', async () => {
  await open()
  await noCues()
  await write(`let a = audio('chime.wav')\n\nlet b = audio('rhodes.wav')`)
  await lengthIs('0:09.000')
  await wholeLevels().waitFor()
  const box = await page.locator('.plot').boundingBox(), w = Math.round(await spans(box)), lanes = await tracksAt()
  // the widest row in the cues' colour within each lane, px
  const rows = () => pixels(`return arg.lanes.map(([y0, y1]) => { let row = 0; for (let y = y0; y < y1; y++) { let n = 0; for (let x = 0; x < arg.w; x++) n += accent((y * w + x) * 4) > 1 / 3; row = Math.max(row, n) } return row })`, { w, lanes: lanes.map(r => [Math.round(r.y - box.y), Math.round(r.y - box.y + r.h)]) })
  await page.locator('.readout').hover()
  await page.locator('#levels').waitFor()
  await poll(rows, got => assert.ok(got.length === 2 && got.every(n => n > w * .8), `a line at its level across each lane: ${got} of ${w}`), 3000)
})

// The depth is the export's alone (the edits run in 32-bit float): none in the bar, its Bits in the export, kept
test('editor: the depth written is the export\'s, not the bar\'s', async () => {
  await open()
  assert.equal(await page.locator('.facts .fact', { hasText: /bit/ }).count(), 0, 'none in the bar')
  await download()
  await page.locator('.export').getByRole('group', { name: 'Bits' }).getByRole('button', { name: '24', exact: true }).click()
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('audio-repl') || '{}').encoding?.bitDepth === 24)
})

// What the sound holds, in the status bar: the note at the caret (440 Hz is A4, ISO 16), a melody's compass over a
// selection (A4 then E5, 659.26 Hz, 2^(7/12) × 440), and, over 6 s at least, the tempo and the key of all of it: clicks
// every 0.5 s are 120 BPM, a C major triad (C4 E4 G4, 261.63, 329.63, 392 Hz) over them is in C major (Krumhansl-Kessler)
test('editor: the status bar says the note at the caret, a selection\'s compass, and the tempo; the key pointed at', async () => {
  await open()
  await noCues()
  const heard = text => page.waitForFunction(text => document.querySelector('.heard')?.textContent === text, text)
  await write(`audio.from(t => (t < 1 ? Math.sin(2 * Math.PI * 440 * t) : Math.sin(2 * Math.PI * 659.26 * t)) * .5, { duration: 2 })`)
  await lengthIs('0:02.000')
  const { box, x } = await axis(2), y = box.y + TOP + TRACK / 2
  await page.mouse.click(x(.5), y)
  await heard('A4')
  await page.mouse.click(x(1.5), y)
  await heard('E5')
  assert.equal(await page.locator('#hearing .levels-head').textContent(), 'Note at the caret')
  await drag([x(.2), y], [x(1.8) - x(.2), 0])
  await heard('A4–E5')
  // no pitch, no note; too short for a tempo or a key
  await write(`audio.from(t => 0, { duration: 2 })`)
  await settled()
  await page.mouse.click(x(.5), y)
  // time for what is heard at the caret to come, which must be nothing
  await page.waitForTimeout(600)
  assert.equal(await page.locator('.heard').count(), 0)
  await write(`audio.from(t => { const b = t % 0.5; return (b < 0.03 ? Math.sin(2 * Math.PI * 1000 * t) * Math.exp(-b * 150) : 0) * .6 + [261.63, 329.63, 392].reduce((s, f) => s + Math.sin(2 * Math.PI * f * t), 0) / 15 }, { duration: 8 })`)
  await lengthIs('0:08.000')
  // the tempo said by the note, the key in its table, each of all of it
  await page.waitForFunction(() => document.querySelector('.heard-tempo')?.textContent === '120 BPM')
  await page.locator('.heard').hover()
  await page.locator('#hearing:popover-open').waitFor()
  const rows = Object.fromEntries((await page.locator('#hearing tr').allInnerTexts()).map(r => r.split('\t')))
  assert.deepEqual([rows.Key.split('\t')[0], rows.Tempo.split('\t')[0]].map(t => t.trim()), ['C major', '120 BPM'], JSON.stringify(rows))
  await page.mouse.move(0, 0)
  // none clear (2 s, short of the 6 a key and a tempo are read over): the note alone
  await write(`audio.from(t => Math.sin(2 * Math.PI * 440 * t) * .5, { duration: 2 })`)
  await lengthIs('0:02.000')
  await page.mouse.click(x(1), y)
  await heard('A4')
})

// Claps have no pitch: no note, no chord, no key said, however a frame of them reads (worker.js tonality, 0% voiced);
// their tempo is: noise bursts every 0.5 s over 8 s, 120 BPM. Pointed at, why there is no note
test('editor: claps say their tempo, never a note', async () => {
  await open()
  await noCues()
  await write(`audio.from(t => { const b = t % 0.5; return b < 0.05 ? (Math.random() * 2 - 1) * Math.exp(-b * 80) * .5 : 0 }, { duration: 8 })`)
  await lengthIs('0:08.000')
  const { box, x } = await axis(8), y = box.y + TOP + TRACK / 2
  await page.mouse.click(x(1.01), y)
  await page.waitForFunction(() => document.querySelector('.heard')?.textContent === '120 BPM')
  assert.equal(await page.locator('.heard-note').textContent(), '', 'no note')
  await page.locator('.heard').hover()
  await page.locator('#hearing:popover-open').waitFor()
  const rows = Object.fromEntries((await page.locator('#hearing tr').allInnerTexts()).map(r => { const [name, ...rest] = r.split('\t'); return [name, rest.map(c => c.trim())] }))
  assert.deepEqual(rows.Note, ['–', 'none: unpitched, 0% of it has a pitch'], JSON.stringify(rows))
  assert.deepEqual(rows.Tempo[0], '120 BPM')
})

// Where chords sound, the status bar names the chord at the caret, a selection's chords in order, and, as it plays, the
// chord at the playhead (Chordino on NNLS chroma, stat('chords')), not the pitch a triad's tones share (C4 E4 G4, 4:5:6,
// a period of C2): C major, A minor, F major triads, 2 s each, in equal temperament from A4 = 440 Hz (C4 261.63, E4
// 329.63, G4 392, A3 220, F3 174.61 Hz)
test('editor: the status bar names the chord at the caret, a selection\'s chords, and the chord playing', async () => {
  await open()
  await noCues()
  const heard = re => page.waitForFunction(re => new RegExp(re).test(document.querySelector('.heard-note')?.textContent), re.source)
  await write(`audio.from(t => [[261.63, 329.63, 392], [220, 261.63, 329.63], [174.61, 220, 261.63]][Math.min(2, Math.floor(t / 2))].reduce((s, f) => s + Math.sin(2 * Math.PI * f * t), 0) * .2, { duration: 6 })`)
  await lengthIs('0:06.000')
  const { box, x } = await axis(6), y = box.y + TOP + TRACK / 2
  await page.mouse.click(x(1), y)
  await heard(/^C$/)
  assert.match(await page.locator('#hearing .levels-head').textContent(), /^Chord at the caret/)
  await page.mouse.click(x(3), y)
  await heard(/^Am$/)
  await page.mouse.click(x(5), y)
  await heard(/^F$/)
  // a selection just past a change: the chord it only touches is not counted
  await drag([x(.5), y], [x(4.1) - x(.5), 0])
  await heard(/^C – Am$/)
  // as it plays, the chord at the playhead, said as it changes
  await page.mouse.click(x(.1), y)
  await page.locator('button.play').click()
  const said = await page.evaluate(() => new Promise(done => {
    const out = []
    const look = () => {
      const t = document.querySelector('.heard-note')?.textContent
      if (t && t !== out.at(-1)) out.push(t)
      if (+document.querySelector('.time').textContent.split(':')[1] > 5.8) return done(out)
      requestAnimationFrame(look)
    }
    look()
  }))
  assert.deepEqual(said, ['C', 'Am', 'F'])
})

// With tracks, what is heard is the edited track's, not their mix's: a C major triad over a louder C2 bass (65.41 Hz)
// is the chord in its own track, the note in the bass's
test('editor: with tracks, the status bar names what the edited track holds', async () => {
  await open()
  await noCues()
  const heard = re => page.waitForFunction(re => new RegExp(re).test(document.querySelector('.heard-note')?.textContent), re.source)
  await write(`let keys = audio.from(t => [261.63, 329.63, 392].reduce((s, f) => s + Math.sin(2 * Math.PI * f * t), 0) * .15, { duration: 8 })\nlet bass = audio.from(t => Math.sin(2 * Math.PI * 65.41 * t) * .8, { duration: 8 })`)
  await lengthIs('0:08.000')
  await page.locator('.layer').nth(1).waitFor({ state: 'attached' })
  const { x } = await axis(8), lane = async i => (await tracksAt())[i].y + 20
  await page.mouse.click(x(3), await lane(0))
  await heard(/^C$/)
  await page.mouse.click(x(3), await lane(1))
  await heard(/^C2/)
})

// The pointer on the spectrogram, held ⌘ (measuring), reads the level its colour stands for (gl-spectrogram pick) and
// marks it with a dot in the accent on the spectrum meter, which spans the spectrogram's own levels, its floor to
// its top (view.js meterX): tones of amplitude 0.5 and 0.05, 20 dB apart (20 · log10(0.5 / 0.05)), marked 20/80 of
// the meter's 40 px apart at the default 80 dB range, the louder, the loudest there is, at the top
test('editor: the pointer on the spectrogram, measuring, marks its level on the spectrum meter, on the spectrogram\'s scale', async () => {
  await open()
  await write(`const tone = (f, a) => Float32Array.from({ length: 48000 }, (_, i) => a * Math.sin(2 * Math.PI * f * i / 48000))
audio.from([tone(1000, .5), tone(4000, .05)], { sampleRate: 48000 })`)
  await lengthIs('0:01.000')
  await show('spec')
  await settled()
  const box = await page.locator('.plot').boundingBox(), lh = (TRACK - LANES) / 2, left = box.width - (await gutter()) - 45
  const at = f => 1 - Math.log2(f / 20) / Math.log2(24000 / 20)
  // the meter's columns in the accent along a row a pixel under the pointer's (its guide runs on the pointer's)
  const red = y => page.evaluate(([y, left]) => {
    const cv = document.querySelector('canvas.overlay'), k = cv.width / cv.clientWidth, n = Math.round(40 * k)
    const d = cv.getContext('2d').getImageData(Math.round(left * k), Math.round((y + 1) * k), n, 1).data
    return { k, lit: Array.from({ length: n }, (_, i) => i).filter(i => d[4 * i + 2] - d[4 * i] > 60 && d[4 * i + 3] > 200) }
  }, [y, left])
  // where the pointer's mark is, px into the meter
  const mark = async y => {
    await page.mouse.move(box.x + box.width * .4, box.y + y)
    await page.keyboard.down('ControlOrMeta')
    const { k, lit } = await poll(() => red(y), ({ lit }) => assert.ok(lit.length, `a mark on the meter at ${y}`))
    await page.keyboard.up('ControlOrMeta')
    return (lit[0] + lit.at(-1) + 1) / 2 / k
  }
  const loud = await mark(Math.round(TOP + lh * at(1000))), quiet = await mark(Math.round(TOP + lh + LANES + lh * at(4000)))
  assert.ok(loud > 37, `the loudest at the top: ${loud.toFixed(1)} of 40 px`)
  assert.ok(Math.abs(loud - quiet - 10) <= 1.5, `20 dB apart, 10 px: ${(loud - quiet).toFixed(1)}`)
})

// On the spectrogram, the pointer's level under its frequency is the level its colour stands for: where there is no
// energy at all (silence, or under the lowest bin), its colours' floor, under it ('<' and the floor), never −∞
test('editor: on the spectrogram, a level under its colours\' floor reads as under it, never −∞', async () => {
  await open()
  await write(`audio.from(t => t < .5 ? .5 * Math.sin(2 * Math.PI * 1000 * t) : 0, { duration: 1 })`)
  await lengthIs('0:01.000')
  await show('spec')
  await settled()
  await page.evaluate(() => {
    window.__said = []
    const text = CanvasRenderingContext2D.prototype.fillText
    CanvasRenderingContext2D.prototype.fillText = function (s, x, y) { if (this.canvas.matches('.overlay')) window.__said.push(s); return text.call(this, s, x, y) }
  })
  const box = await page.locator('.plot').boundingBox()
  await page.mouse.move(box.x + (box.width - await gutter()) * .85, box.y + TOP + TRACK / 2)
  const said = await poll(() => page.evaluate(() => window.__said), all => assert.ok(all.some(t => /^<−\d+$/.test(t)), `under the floor: ${[...new Set(all)].join(' ')}`), 3000)
  assert.ok(!said.includes('−∞'), 'never −∞')
})

// Measuring on the spectrogram, the spectrum meter reads under the pointer: held ⌘ at two strikes of other notes, two
// spectra; let go, the caret's again
test('editor: held ⌘ over the spectrogram, the spectrum meter reads under the pointer', async () => {
  const { box, x, y } = await chime()
  await show('spec')
  await settled()
  const g = await gutter(), meter = () => pixels(`let s = 0; for (let py = 0; py < h - 30; py++) for (let px = w - ${g} - 46; px < w - ${g} - 2; px++) { const i = (py * w + px) * 4; s += (d[i] + d[i + 1] + d[i + 2]) * (py % 7 + 1) } return s`)
  const rest = await meter()
  await page.mouse.move(x(1.5), y)
  await page.keyboard.down('ControlOrMeta')
  await crossed()
  await frames()
  const one = await meter()
  await page.mouse.move(x(5.5), y)
  await frames()
  const two = await meter()
  await page.keyboard.up('ControlOrMeta')
  assert.notEqual(one, two, 'a spectrum under each place')
  await poll(meter, m => assert.equal(m, rest, 'let go, the caret\'s'))
})

// What the sound is, on the display: its rate resamples it (a common rate, or any written in), its channels mix it,
// each setting the chain's one call; fewer channels each way to get there (mixed down, or some kept), two swapped or
// one's polarity flipped, again taking it back
test('editor: the display\'s rate resamples and its channels mix, each the chain\'s one call', async () => {
  await open()
  const rate = label => page.locator('#rate-menu .menu-item', { has: page.locator('strong', { hasText: new RegExp(`^${label.replace('.', '\\.')}$`) }) })
  await page.getByRole('button', { name: '44.1kHz', exact: true }).click()
  await rate('48kHz').click()
  await page.waitForFunction(() => scriptText().includes('.resample(48000)'))
  await page.waitForFunction(() => document.querySelector('.facts').textContent.startsWith('48kHz'))
  await page.getByRole('button', { name: '48kHz', exact: true }).click()
  // the standard rates (audiojs/sample-rate), each with what it is for; another written in
  assert.deepEqual(await page.locator('#rate-menu .menu-item strong').allInnerTexts(), ['8kHz', '11.025kHz', '16kHz', '22.05kHz', '44.1kHz', '48kHz', '88.2kHz', '96kHz', '176.4kHz', '192kHz', '352.8kHz', '384kHz'])
  await page.locator('#rate-menu input[name=hz]').fill('22050')
  await page.locator('#rate-menu input[name=hz]').press('Enter')
  await page.waitForFunction(() => { const t = scriptText(); return t.includes('.resample(22050)') && !t.includes('48000') })
  const mix = async (from, to, call) => {
    await page.getByRole('button', { name: from, exact: true }).click()
    await page.locator('#channels-menu .menu-item', { has: page.locator('strong', { hasText: new RegExp(`^${to.replace('.', '\\.')}$`) }) }).click()
    await page.waitForFunction(call => scriptText().trimEnd().endsWith(call), call)
  }
  // two: mono averaged, or one side alone; swapped; a side's polarity flipped, again taken back
  await page.getByRole('button', { name: 'stereo', exact: true }).click()
  assert.deepEqual(await page.locator('#channels-menu .menu-item strong').allInnerTexts(), ['Mono', 'Mono, the left alone', 'Mono, the right alone', '5.1', '7.1', 'Swap them', 'Flip the left\'s polarity', 'Flip the right\'s polarity'])
  await page.keyboard.press('Escape')
  await mix('stereo', 'Flip the right\'s polarity', '.phase(180, { channel: 1 })')
  await mix('stereo', 'Flip the right\'s polarity', '.resample(22050)')
  await mix('stereo', 'Swap them', '.remix([1, 0])')
  await mix('stereo', 'Mono', '.remix(1)')
  await page.waitForFunction(() => document.querySelector('.facts').innerText.replace(/\s+/g, ' ').trim() === '22.05kHz mono')
  // up from mono, the sound in the centre; 5.1 to 7.1, its surrounds in the back pair too; down, the ITU downmix, or the
  // fronts alone
  await mix('mono', '5.1', '.remix([null, null, 0, null, null, null])')
  await mix('5.1', '7.1', '.remix([0, 1, 2, 3, 4, 5, 4, 5])')
  await mix('7.1', '5.1, the backs dropped', '.remix([0, 1, 2, 3, 6, 7])')
  await mix('5.1', 'Stereo', '.remix(2)')
  // stereo to 5.1: the matrix upmix
  await mix('stereo', '5.1', '.surround()')
  await page.waitForFunction(() => document.querySelector('.facts').innerText.replace(/\s+/g, ' ').trim() === '22.05kHz 5.1')
})

// The level at the bar's right, one measure, chosen from its menu (the readout pressed) and kept: the peak, the RMS, the
// loudness of all of it; with a selection, its peak or RMS
test('editor: the level reads the peak, the RMS or the loudness, as chosen', async () => {
  const { box, x } = await chime()
  const read = () => page.locator('.readout').textContent()
  assert.match(await read(), /^−\d+\.\ddBFS$/)
  await page.locator('.readout').click()
  await menuRow('Loudness').click()
  await page.waitForFunction(() => /^−\d+\.\dLUFS$/.test(document.querySelector('.readout').textContent))
  assert.equal(JSON.parse(await page.evaluate(() => localStorage.getItem('audio-repl'))).reads, 'loudness')
  // a selection's own: its peak, the loudness being all of it's; its RMS, under its peak (the value alone, no word: the
  // menu and the tip say which)
  await drag([x(1), box.y + TOP + 40], [x(2) - x(1), 0])
  const peak = await read()
  assert.match(peak, /^−\d+\.\ddBFS$/)
  await page.locator('.readout').click()
  await menuRow('RMS').click()
  await page.waitForFunction(peak => { const t = document.querySelector('.readout').textContent; return /^−\d+\.\ddBFS$/.test(t) && parseFloat(t.slice(1)) > parseFloat(peak.slice(1)) }, peak)
})
