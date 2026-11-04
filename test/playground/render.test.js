// The pictures drawn: lanes, ends, clipping, the selection, weighting; the server, the page and the helpers in page.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { page, CHIME, code, open, settled, poll, still, settings, selected, noCues, write, drawn, LANES, tall, gutter, TAIL, spans, axis, boxDrag, drag, lengthIs, gridShown, pixels, show, chime } from './page.js'

// The sound's end, three quarters across the view zoomed out as far as it goes: where its centre line stops, its silence
// drawn up to it as the level it is, and the grid with it; no rule over it, nothing past it
test('editor: the sound\'s end is where its centre line stops: no rule over it, nothing past it, no grid either', async () => {
  await page.route('**/playground/editor.js', async route => { const r = await route.fetch(); route.fulfill({ response: r, body: (await r.text()).replace('v = view(', 'v = globalThis.__view = view(') }) })
  await open()
  await noCues()
  await write(`audio.from(t => t < 1 ? .5 * Math.sin(2 * Math.PI * 220 * t) : 0, { duration: 2 })`)
  await lengthIs('0:02.000')
  await page.evaluate(() => { __view.frame = { range: [0, 8 / 3] } })
  await page.mouse.move(2, 2)
  await settled()
  assert.deepEqual(await page.evaluate(() => __view.range), [0, 8 / 3])
  // the plot's CSS px: the end three quarters across; a column bright anywhere down the lane, in the screenshot (the
  // centre line, 78% grey, over a near-black screen); past it, to 0.9 of the way, short of the meters
  const box = await page.locator('.plot').boundingBox(), w = box.width - (await gutter()), end = w * 3 / 4, far = w * .9
  const { k, lit } = await pixels(`const k = w / arg.width, lane = h - 22 * k, lit = []
    for (let x = 0; x < Math.round(arg.to * k); x++) for (let y = 0; y < lane; y++) { const i = (y * w + x) * 4; if (d[i] + d[i + 1] + d[i + 2] > 300) { lit.push(x / k); break } }
    return { k, lit }`, { width: box.width, to: w * .9 })
  const last = Math.max(...lit), silent = lit.filter(x => x > end * .6 && x < end - 2).length / Math.floor((end * .4 - 2) * k)
  assert.ok(Math.abs(last - end) <= 1.5, `the centre line ends at the end: ${last} px, the end ${end} px`)
  assert.ok(silent > .95, `the silence before it drawn, its centre line: ${(silent * 100).toFixed(0)}% of its columns`)
  // the overlay, the grid: nothing at the end column or past it in the overlay; the grid where the sound is, not past it
  await settings('Grid', 'Lines')
  await gridShown('Lines')
  const { rule, inside, beyond } = await page.evaluate(([end, far]) => {
    const sum = (canvas, from, to) => { const k = canvas.width / canvas.clientWidth, { data, width, height } = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height - Math.round(22 * k)); let s = 0; for (let x = Math.round(from * k); x < Math.round(to * k); x++) for (let y = 0; y < height; y++) s += data[(y * width + x) * 4 + 3]; return s }
    // what shows of it: a level apart or more (a canvas composited a fraction of a pixel over is a level off here and there)
    const shown = (from, to) => { const { k, w, h, d } = window.__shown; let s = 0; for (let x = Math.round(from * k); x < Math.round(to * k); x++) for (let y = 0; y < h - Math.round(22 * k); y++) s += d[y * w + x] > 1 ? d[y * w + x] : 0; return s }
    return { rule: sum(document.querySelector('canvas.overlay'), end - 1, far), inside: shown(0, end - 1), beyond: shown(end + 1, far) }
  }, [end, far])
  assert.equal(rule, 0, 'no rule over the end, nothing past it')
  assert.ok(inside > 0, 'the grid where the sound is')
  assert.equal(beyond, 0, 'none past its end')
})

// The view short of the sound's end, its lanes fade there into the ground they lie on, the slab's, shaded to its foot: at
// the lane's foot as at its top, the fade's last column the ground's colour, no band of another; the centre line fading
// into it; the foot under the lanes, past the caret's reach, untouched
test('editor: zoomed in, the lanes fade at their end into the slab\'s own ground, as tall as the caret', async () => {
  await open()
  await noCues()
  await write(`audio.from(t => .2 * Math.sin(2 * Math.PI * 220 * t), { duration: 4 })`)
  await lengthIs('0:04.000')
  await page.locator('.plot').focus()
  await page.keyboard.press('=')
  await page.mouse.move(2, 2)
  const box = await page.locator('.plot').boundingBox(), end = Math.round(await spans(box)) + TAIL, lane = tall(box)
  const same = ([a, b]) => Math.abs(a - b) <= 2
  await poll(() => pixels(`const at = (x, y) => d[(Math.round(y) * w + Math.round(x)) * 4], row = y => [at(arg.end - 2, y), at(arg.end - 100, y)]
    return { top: row(3), foot: row(arg.lane - 6), under: row(arg.lane + 8), centre: row(arg.lane / 2) }`, { end, lane }), r => {
    assert.ok(same(r.top) && same(r.foot) && same(r.under), `the ground's colour at the fade's end: ${JSON.stringify(r)}`)
    assert.ok(r.centre[0] < r.centre[1] - 40, `the centre line faded: ${JSON.stringify(r.centre)}`)
  })
})

// The slab is plain, its ground shaded to its foot: no lines over it, which read as the lanes' rules
test('editor: the slab has no scanlines', async () => {
  await open()
  assert.equal(await page.locator('.panes').evaluate(e => getComputedStyle(e).backgroundImage.match(/gradient/g).length), 1)
})

// A selection dragged draws what is over the sound alone, never the sound's own pictures again: each drawn anew every
// move held a phone's drag back, a window-wide waveform and the grid cut by it at each
test('editor: dragging a selection draws no picture of the sound again, only what is over it', async () => {
  await page.addInitScript(() => {
    window.drawn = 0
    const draw = WebGL2RenderingContext.prototype.drawArrays
    WebGL2RenderingContext.prototype.drawArrays = function (...args) { if (this.canvas.closest?.('.plot')) window.drawn++; return draw.apply(this, args) }
  })
  await open()
  await settled()
  const box = await page.locator('.plot').boundingBox(), y = box.y + tall(box) / 3, frame = () => page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))))
  await page.mouse.move(box.x + 100, y)
  await page.mouse.down()
  await frame()
  const from = await page.evaluate(() => drawn)
  for (let i = 1; i <= 16; i++) { await page.mouse.move(box.x + 100 + i * 12, y); await frame() }
  const moved = await page.evaluate(() => drawn) - from
  await page.mouse.up()
  assert.equal(moved, 0, 'no picture drawn as it moved')
  assert.match(await selected(), /–/)
})

test('editor: each channel has its own lane: a sound in the left lights only the left', async () => {
  await open()
  await write(`audio.from(t => 0.8 * Math.sin(2 * Math.PI * 220 * t), { duration: 1, channels: 2 }).pan(-1)`)
  await lengthIs('0:01.000')
  await settled()
  // lit pixels in the upper lane (left) and the lower (right), the ruler below excluded
  await poll(() => pixels(`const lanes = [0, 0]; for (let y = 0; y < h - 44; y++) for (let x = 0; x < w; x++) { const i = (y * w + x) * 4; if (d[i] + d[i + 1] + d[i + 2] > 300) lanes[y < (h - 44) / 2 ? 0 : 1]++ } return lanes`),
    ([upper, lower]) => assert.ok(upper > 1000 && lower < upper / 50, `left lane ${upper} lit, right lane ${lower}`))
})

// The spectrogram (gl-spectrogram) draws each channel's tone on the row its scale's formula gives: log2 from 20 Hz, or
// mel, 2595 · log10(1 + f / 700) (O'Shaughnessy 1987, as in HTK), to Nyquist. The lanes share one scale of levels, the
// loudest channel's, so a tone 20 dB under the other draws dimmer, where a scale per lane would draw both white.
test('editor: the spectrogram draws each channel\'s tone on its row, every lane at one scale of levels', async () => {
  await open()
  await write(`const tone = (f, a) => Float32Array.from({ length: 48000 }, (_, i) => a * Math.sin(2 * Math.PI * f * i / 48000))
audio.from([tone(1000, .5), tone(4000, .05)], { sampleRate: 48000 })`)
  await lengthIs('0:01.000')
  await show('spec')
  await settled()
  const box = await page.locator('.plot').boundingBox(), lh = (tall(box) - LANES) / 2, lanes = [[0, lh], [lh + LANES, 2 * lh + LANES]]
  const mel = f => 2595 * Math.log10(1 + f / 700), at = { log: f => Math.log2(f / 20) / Math.log2(24000 / 20), mel: f => mel(f) / mel(24000) }
  // the brightest pixel down the middle of each lane: its height in CSS px, its level
  const brightest = async () => pixels(`const k = w / arg.width, x = Math.round(arg.x * k)
    return arg.lanes.map(([a, b]) => { let top = 0, at = 0; for (let y = Math.ceil(a * k); y < Math.floor(b * k); y++) { const v = d[(y * w + x) * 4 + 1]; if (v > top) { top = v; at = y } } return [(at + .5) / k, top] })`, { width: box.width, x: (box.width - (await gutter())) / 2, lanes })
  for (const scale of ['log', 'mel']) {
    // its frequencies on the next scale, octaves to mel
    if (scale === 'mel') await settings('Frequency scale', 'Mel')
    const row1 = lh * (1 - at[scale](1000)), row4 = lanes[1][0] + lh * (1 - at[scale](4000))
    await poll(brightest, ([[y1, loud], [y4, quiet]]) => {
      assert.ok(Math.abs(y1 - row1) < 2 && Math.abs(y4 - row4) < 2, `${scale}: 1 kHz at ${y1.toFixed(1)} of ${row1.toFixed(1)}, 4 kHz at ${y4.toFixed(1)} of ${row4.toFixed(1)}`)
      assert.ok(loud > 200 && quiet > 90 && quiet < loud - 30, `${scale}: the loud tone ${loud}, the quiet ${quiet}`)
    })
  }
})

// A selection is one highlight in both pictures, a wash over it, the rest as it was (no focus, nothing around it
// darkened): on a spectrogram full of noise, a wash that lifts as plainly as the waveform's does on its dark ground
test('editor: a selection is the same highlight on a spectrogram full of noise, plain, nothing around it darkened', async () => {
  await open()
  await noCues()
  await write(`audio.from(4).noise({ color: 'pink' }).gain(-20)`)
  await lengthIs('0:04.000')
  await show('spec')
  const { box, x } = await axis(4), y = box.y + box.height / 2
  const mean = (a, b) => pixels(`let s = 0, n = 0; for (let y = 20; y < h - 30; y++) for (let x = arg[0]; x < arg[1]; x++) { const i = (y * w + x) * 4; s += d[i] + d[i + 1] + d[i + 2]; n++ } return s / n`, [Math.round(a - box.x), Math.round(b - box.x)])
  await page.mouse.click(x(3.9), y)
  await page.mouse.move(x(3.9), box.y + box.height + 40)
  const around = await mean(x(.2), x(1.2))
  await drag([x(1.5), y], [x(2.5) - x(1.5), 0])
  await page.mouse.move(x(3.9), box.y + box.height + 40)
  const inside = await mean(x(1.7), x(2.3)), outside = await mean(x(.2), x(1.2))
  // lifted over 20 levels a channel: twice what the waveform's 5% wash lifts its dark ground by (about 11)
  assert.ok(inside - outside > 60, `inside ${inside.toFixed(1)}, outside ${outside.toFixed(1)}`)
  assert.ok(Math.abs(outside - around) < around * .03, `around it as it was: ${outside.toFixed(1)}, ${around.toFixed(1)} before`)
})

// A band taken out of a long sound: the picture holds as it renders, nothing outside the box drawn again, and only the
// box's span changes once the output comes (the view patches what differs, gl-spectrogram's set())
test('editor: a band taken out redraws only where it was, the rest of the picture holding as it renders', async () => {
  await open()
  await noCues()
  await write(`audio.from(240).noise({ color: 'pink' }).gain(-20)`)
  await lengthIs('4:00.000')
  await show('spec')
  const { box, x } = await axis(240), lane = tall(box)
  // the left quarter of the lanes, as a fingerprint of its pixels
  const left = () => pixels(`let s = 0; for (let y = 10; y < h - 30; y += 3) for (let x = 0; x < arg; x += 2) { const i = (y * w + x) * 4; s = (s * 31 + d[i] + d[i + 1] * 7 + d[i + 2] * 13) % 1000000007 } return s`, Math.round(x(54) - box.x))
  await page.mouse.click(x(180), box.y + lane * .5)
  await settled()
  // the spectrogram whole: zoomed out, it fills its columns over several renders, two readings in a row alike
  let last = await left()
  const before = (await poll(async () => [last, last = await left()], ([was, now]) => assert.equal(now, was, 'the spectrogram drawn whole'), 15000))[1]
  await boxDrag([x(120), box.y + lane * .2], [x(144) - x(120), lane * .2])
  await page.keyboard.press('Escape')
  await settled()
  const held = await left()
  assert.equal(held, before, 'the box drawn, nothing else')
  await page.mouse.click(x(180), box.y + lane * .5)
  await boxDrag([x(120), box.y + lane * .2], [x(144) - x(120), lane * .2])
  await settled()
  const boxed = await left()
  await page.keyboard.press('Delete')
  const seen = new Set()
  for (const until = Date.now() + 3000; Date.now() < until;) seen.add(await left())
  assert.ok(/\.spectral\(/.test(await code()))
  assert.deepEqual([...seen], [boxed], `the left quarter drawn ${seen.size} ways as the output came`)
})

// What goes over full scale: the time row underlined red where the output clips (stat('clipping')), and zoomed out, the
// levels past ±1 tinted red
test('editor: where the output clips is underlined red on the time row; zoomed out, past full scale is red', async () => {
  await open()
  await write(`audio.from(t => (t > 0.5 ? 1.5 : 0.5) * Math.sin(2 * Math.PI * 220 * t), { duration: 1 })`)
  await lengthIs('0:01.000')
  await settled()
  const box = await page.locator('.plot').boundingBox(), h = box.height - 22, w = box.width - (await gutter())
  // red pixels along the time row's top, under the room: their first and last x, as a share of the plot's width
  const red = () => pixels(`const y = Math.round(arg + 1), xs = []; for (let x = 0; x < w; x++) { const i = (y * w + x) * 4; if (d[i] - d[i + 2] > 80 && d[i] > 120) xs.push(x) } return xs.length ? [xs[0], xs.at(-1)] : []`, h)
  await poll(red, ([first, last]) => assert.ok(Math.abs(first / w - .5) < .03 && last / w > .95, `clipping from ${first / w} to ${last / w} of the width`))
  // zoomed out past full scale: a red tint over what lies beyond ±1
  const tint = () => pixels(`const x = Math.round(arg), y = 3, i = (y * w + x) * 4; return d[i] - d[i + 2]`, w * .25)
  const flat = await tint()
  await page.mouse.move(box.x + box.width - 26, box.y + tall(box) / 2)
  for (let i = 0; i < 4; i++) { await page.keyboard.down('Control'); await page.mouse.wheel(0, 60); await page.keyboard.up('Control') }
  await poll(tint, t => assert.ok(t > flat + 3, 'past full scale, red'))
})

// Esc closes the fade menu, and nothing else: the selection it was opened from stays
// The meters stand clear: the waveform, the cues and the pitch curve end before the level bar, never behind it
test('editor: nothing is drawn behind the meters', async () => {
  await page.addInitScript(code => localStorage.setItem('audio-repl', JSON.stringify({ code, side: null, show: { hits: true, pitch: true, gain: true, meters: true } })), CHIME)
  await open()
  await write(`audio.from(t => 0.8 * Math.sin(2 * Math.PI * 220 * t), { duration: 1 })`)
  await lengthIs('0:01.000')
  await settled()
  await still()
  const box = await page.locator('.plot').boundingBox(), w = box.width - (await gutter())
  // bright pixels down a column of the lanes
  const lit = at => pixels(`const x = Math.round(arg); let n = 0; for (let y = 0; y < h - 30; y++) { const i = (y * w + x) * 4; if (d[i] + d[i + 1] + d[i + 2] > 300) n++ } return n`, at)
  await poll(() => lit(w - 40), n => assert.ok(n > 20, 'the waveform runs up to the meters'))
  assert.equal(await lit(w - 9), 0, 'and stops before the level bar')
  // all of it shown, its end 4 px short of where the lanes end (view.js TAIL), SPACE (6 px) before the bar, as before
  // the spectrum on the spectrogram: its last moment in sight, never behind the meters
  assert.ok(await lit(w - 19) > 20, 'its last moment by the bar')
  assert.equal(await lit(w - 17), 0, 'its end 10 px before it')
  await show('spec')
  await settled()
  await still()
  await poll(() => lit(w - 56), n => assert.ok(n > 0, 'its last moment by the spectrum'))
  assert.equal(await lit(w - 54), 0, 'its end 10 px before it')
})

// Where a sound crosses full scale, a small cross on the line it crosses, in the measuring red, where it first does in
// each stretch that clips: here a tone pushed past it for 10 ms at half a second
test('editor: where a sound clips, a cross on the full scale line it crosses', async () => {
  await open()
  await write(`audio.from(t => (t > 0.5 && t < 0.51 ? 1.3 : 0.3) * Math.sin(2 * Math.PI * 440 * t), { duration: 1 })`)
  await lengthIs('0:01.000')
  const { box, x } = await axis(1)
  // the measuring red's pixels over the lanes, by column, px from the plot's left
  const red = () => pixels(`const out = new Set(); for (let y = 0; y < arg.h; y++) for (let x = 0; x < w; x++) { const i = (y * w + x) * 4; if (d[i] > 170 && d[i + 1] < 110 && d[i + 2] < 110) out.add(x) } return [...out]`, { h: Math.round(tall(box)) })
  const cols = await poll(red, c => assert.ok(c.length), 8000).catch(red)
  const at = x(.5) - box.x
  assert.ok(cols.length && cols.every(c => Math.abs(c - at) <= 5), `crosses at 0.5 s alone: ${cols.slice(0, 12)} about ${at}`)
})

// Where the view stops short of the sound, its lanes fade out at that edge: zoomed in at its start, at the lanes' end;
// scrolled on, at their start too; all of it shown, at neither
test('editor: the lanes fade out at an edge the sound runs on past', async () => {
  const { box, x } = await chime()
  const fades = () => page.evaluate(() => [...document.querySelectorAll('.plot .fade')].map(f => !f.hidden))
  assert.deepEqual(await fades(), [false, false], 'all of it shown')
  await page.mouse.move(x(.5), box.y + 40)
  for (let i = 0; i < 4; i++) { await page.keyboard.down('Control'); await page.mouse.wheel(0, -120); await page.keyboard.up('Control') }
  await page.waitForFunction(() => (([a, b]) => !a.hidden || !b.hidden)(document.querySelectorAll('.plot .fade')))
  const [, end] = await fades()
  assert.ok(end, 'the sound on past the lanes\' end')
  await page.mouse.wheel(box.width, 0)
  await page.waitForFunction(() => !document.querySelector('.plot .fade-start').hidden)
  await page.locator('.plot').focus()
  await page.keyboard.press('0')
  await page.waitForFunction(() => [...document.querySelectorAll('.plot .fade')].every(f => f.hidden))
})

// Weighted, the waveform zoomed out is its levels as heard, zoomed in its samples as they are (view.js weigh): a 100 Hz
// sine, then a 1 kHz one, 0.8 each, at 44.1 kHz, flat, 12 s across the view, so zoomed out past a leaf a px. A-weighted, the 100 Hz
// one as tall as 0.8 at −19.1 dB, the 1 kHz one at 0 dB (IEC 61672-1:2013, Table 3), its heights against the weighting
// package's own response (@audio/weighting-a, the filter the worker runs); K-weighted, 100 Hz at the package's −1.1 dB
// (@audio/weighting-k, ITU-R BS.1770-4's two stages). Zoomed in on the 100 Hz one, the sine itself, 0.8
test('editor: the waveform weighted zoomed out, as heard, and as it is zoomed in', async () => {
  const { default: a } = await import('@audio/weighting/a'), { default: k } = await import('@audio/weighting/k')
  const dB = v => 20 * Math.log10(v)
  // the package's response against IEC 61672-1's table, to its tenth of a dB
  assert.ok(Math.abs(dB(a.response(100, 44100)) + 19.1) < .1 && Math.abs(dB(a.response(1000, 44100))) < .05, 'A as IEC 61672-1 has it at 100 Hz and 1 kHz')
  await page.addInitScript(() => { if (!sessionStorage.seeded) { sessionStorage.seeded = 1; localStorage.setItem('audio-repl', JSON.stringify({ wave: { fill: 'flat' }, docs: [{ code: 'audio.from(t => 0.8 * Math.sin(2 * Math.PI * (t < 6 ? 100 : 1000) * t), { duration: 12 })' }] })) } })
  await open()
  await lengthIs('0:12.000')
  await settled()
  const box = await page.locator('.plot').boundingBox(), lane = tall(box)
  // the rows lit across most of 40 px about a share `x` of the way in: the waveform's height there, px
  const high = x => pixels(`let n = 0; for (let y = 0; y < arg.lane; y++) { let m = 0; for (let dx = -20; dx < 20; dx++) { const i = (y * w + Math.round(w * arg.x) + dx) * 4; if (d[i] + d[i + 1] + d[i + 2] > 250) m++ } if (m > 30) n++ } return n`, { x, lane })
  const heights = async () => [await high(.25), await high(.7)]
  const [low, mid] = await poll(heights, ([low, mid]) => assert.ok(Math.abs(low / lane - .8) < .06 && Math.abs(mid / lane - .8) < .06, `as it is, 0.8 of the lane: ${low}, ${mid} of ${lane}`))
  // the worker weighs it: the heights as it comes
  const weighed = async (name, want) => {
    await settings('Weighting', name)
    return poll(heights, got => assert.ok(Math.abs(got[0] / low - want[0]) < .2 * want[0]), 10000).catch(heights)
  }
  const A = [a.response(100, 44100), a.response(1000, 44100)], [aLow, aMid] = await weighed('A-weighted', A)
  // within 2 px of the weighted height, a px each side of the band rounding
  assert.ok(Math.abs(aLow - low * A[0]) <= 2.5 && Math.abs(aMid - mid * A[1]) <= 2.5, `A: 100 Hz ${aLow} px for ${(low * A[0]).toFixed(1)}, 1 kHz ${aMid} for ${(mid * A[1]).toFixed(1)}`)
  const K = [k.response(100, 44100), k.response(1000, 44100)], [kLow] = await weighed('K-weighted', K)
  assert.ok(Math.abs(kLow - low * K[0]) <= 2.5, `K: 100 Hz ${kLow} px for ${(low * K[0]).toFixed(1)}`)
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('audio-repl') || '{}').wave?.weighting === 'k')
  // zoomed in 16× on the 100 Hz sine, under 64 samples a px: the sine as it is
  const [px, py] = [box.x + box.width * .25, box.y + lane / 2]
  await page.evaluate(([x, y]) => document.querySelector('.plot').dispatchEvent(new WheelEvent('wheel', { deltaY: 50 * Math.log(1 / 16), ctrlKey: true, clientX: x, clientY: y, bubbles: true, cancelable: true })), [px, py])
  await settled()
  // the rows the line lights across the middle of the view (its cycles' crests, a few px each, many), top to bottom
  await poll(() => pixels(`let top = -1, bottom = -1; for (let y = 0; y < arg.lane; y++) { let m = 0; for (let x = Math.round(w * .1); x < w * .8; x++) { const i = (y * w + x) * 4; if (d[i] + d[i + 1] + d[i + 2] > 250) m++ } if (m > 20) { if (top < 0) top = y; bottom = y } } return bottom - top + 1`, { lane }), span => assert.ok(Math.abs(span / lane - .8) < .06, `zoomed in, the sine at 0.8: ${span} of ${lane}`))
})
