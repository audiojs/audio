// <audio-wave> and <audio-spectrogram> (elements/picture.js, wave.js, spectrogram.js): a sound's pictures, drawn by
// the renderers the editor's view draws with. Each is held to what its renderer says it draws (gl-waveform's and
// gl-spectrogram's READMEs): a wave's column the extremes of its samples between the amplitudes −1 and 1, bottom to
// top; a spectrogram's rows from 20 Hz (log) or 0 Hz (lin) at the bottom to the Nyquist frequency at the top
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { page, origin, poll, made, wavBytes, sine, RATE } from './page.js'

async function stage(body) {
  await page.goto(`${origin}/blank.html`)
  await page.evaluate(html => { document.body.style.margin = '0'; document.body.innerHTML = html }, body)
  await page.addScriptTag({ type: 'module', url: '/elements/index.js' })
  await page.evaluate(() => Promise.all(['audio-sound', 'audio-wave', 'audio-spectrogram', 'audio-play', 'audio-time'].map(n => customElements.whenDefined(n))))
}
function asked() { const got = []; page.on('request', r => got.push(new URL(r.url()).pathname)); return got }
// a picture's canvas as its pixels: [width, height, alpha of each, rows from the top]
const pixels = q => page.locator(q).evaluate(el => {
  const c = el.querySelector('canvas'), flat = Object.assign(document.createElement('canvas'), { width: c.width, height: c.height }), g = flat.getContext('2d')
  g.drawImage(c, 0, 0)
  const d = g.getImageData(0, 0, c.width, c.height).data, a = []
  for (let i = 0; i < d.length; i += 4) a.push(d[i + 3] ? (d[i] + d[i + 1] + d[i + 2]) / 3 * d[i + 3] / 255 + 1 : 0)
  return { width: c.width, height: c.height, a }
})
const TONE = `<audio-sound id="tone">
  <audio src="/slow/tone.wav?ms=0" data-name="tone.wav" preload="none"></audio>
  <audio-wave style="width: 400px; height: 100px; color: rgb(255, 255, 255)"></audio-wave>
  <audio-spectrogram style="width: 400px; height: 200px; color: rgb(255, 255, 255)" background="black"></audio-spectrogram>
  <audio-code><pre><code>audio('tone.wav')</code></pre></audio-code>
  <audio-play></audio-play><audio-time></audio-time>
</audio-sound>`
const drawn = (q = 'audio-wave') => poll(() => page.locator(q).evaluate(e => e.hasAttribute('data-drawn')), d => assert.ok(d), 20000)

test('audio-wave: in sight it has its sound run and draws it: a tone of amplitude 0.5 from a quarter to three quarters of its height', async () => {
  // two seconds of 1 kHz at half scale, one channel
  made.set('tone.wav', await wavBytes([sine(2, 1000, .5)]))
  const got = asked()
  await stage(TONE)
  await drawn()
  assert.ok(got.includes('/repl/engine.js') && got.includes('/assets/gl-waveform.js'), 'the engine and the renderer, asked for by the picture in sight')
  const { width, height, a } = await pixels('audio-wave'), k = await page.evaluate(() => devicePixelRatio)
  assert.deepEqual([width, height], [400 * k, 100 * k], 'the canvas the element\'s size in device pixels')
  // each column's ink: its first and last row (gl-waveform: amplitude [-1, 1] bottom to top, a column its samples' extremes)
  const tops = [], foots = []
  for (let x = Math.round(width * .1); x < width * .9; x += 7) {
    let top = -1, foot = -1
    for (let y = 0; y < height; y++) if (a[y * width + x]) { if (top < 0) top = y; foot = y }
    tops.push(top / k); foots.push((foot + 1) / k)
  }
  const mean = v => v.reduce((s, x) => s + x, 0) / v.length
  assert.ok(Math.abs(mean(tops) - 25) <= 1.5 && Math.abs(mean(foots) - 75) <= 1.5, `ink from ${mean(tops).toFixed(1)} to ${mean(foots).toFixed(1)} px of 100: +0.5 at 25, −0.5 at 75`)
  // a slider to a screen reader, its length the sound's
  assert.deepEqual(await page.locator('audio-wave').evaluate(e => [e.getAttribute('role'), e.getAttribute('aria-valuemin'), e.getAttribute('aria-valuemax'), e.getAttribute('aria-valuetext'), e.tabIndex]), ['slider', '0', '2', '0:00 of 0:02', 0])
})

test('audio-spectrogram: a 1 kHz tone one bright row, where its scale puts 1 kHz between its floor and the Nyquist frequency', async () => {
  made.set('tone.wav', await wavBytes([sine(2, 1000, .5)]))
  for (const [scale, at] of [['log', Math.log(1000 / 20) / Math.log(RATE / 2 / 20)], ['lin', 1000 / (RATE / 2)]]) {
    await stage(TONE.replace('<audio-spectrogram ', `<audio-spectrogram scale="${scale}" `))
    await drawn('audio-spectrogram')
    // (its columns come over a few frames: gl-spectrogram pending)
    const row = await poll(async () => {
      const { width, height, a } = await pixels('audio-spectrogram')
      const rows = Array.from({ length: height }, (_, y) => { let s = 0; for (let x = Math.round(width * .2); x < width * .8; x++) s += a[y * width + x]; return s })
      const peak = rows.indexOf(Math.max(...rows))
      return { y: (peak + .5) / height, lit: Math.max(...rows) }
    }, r => assert.ok(r.lit > 0, 'something drawn'), 10000)
    assert.ok(Math.abs(1 - row.y - at) < .02, `${scale}: the brightest row ${(1 - row.y).toFixed(3)} of the way up, 1 kHz at ${at.toFixed(3)}`)
  }
})

test('audio-wave: a press on it, the pointer dragged along it and the arrows go there; the place it plays is drawn on it', async () => {
  made.set('tone.wav', await wavBytes([sine(2, 1000, .5)]))
  await stage(TONE)
  await drawn()
  const time = () => page.locator('#tone').evaluate(s => s.time)
  const box = await page.locator('audio-wave').boundingBox()
  await page.mouse.click(box.x + box.width * .25, box.y + 50)
  assert.ok(Math.abs(await time() - .5) < .01, 'a press a quarter along: half a second of two')
  assert.ok(Math.abs(await page.locator('audio-wave > i').evaluate(i => new DOMMatrix(getComputedStyle(i).transform).m41) - 100) < 1, 'its line there')
  await page.mouse.move(box.x + box.width * .25, box.y + 50); await page.mouse.down(); await page.mouse.move(box.x + box.width * .75, box.y + 50, { steps: 4 }); await page.mouse.up()
  assert.ok(Math.abs(await time() - 1.5) < .01, 'dragged to three quarters')
  await page.locator('audio-wave').focus()
  await page.keyboard.press('ArrowLeft')
  assert.ok(Math.abs(await time() - .5) < .01, 'an arrow a second')
  await page.keyboard.press('End')
  assert.equal(await time(), 2)
  await page.keyboard.press('Home')
  assert.equal(await time(), 0)
  assert.equal(await page.locator('audio-spectrogram').getAttribute('aria-valuenow'), '0', 'the other picture of the sound says the same place')
  // played: the line moves
  await page.locator('audio-play button').click()
  await poll(() => page.locator('audio-wave > i').evaluate(i => new DOMMatrix(getComputedStyle(i).transform).m41), x => assert.ok(x > 20))
  await page.locator('audio-play button').click()
})

test('audio-wave: lazy, it runs nothing till its sound is played; a sound of two channels, a lane each', async () => {
  made.set('pair.wav', await wavBytes([sine(1, 440, .8), sine(1, 440, .2)]))
  const got = asked()
  await stage(`<audio-sound id="pair"><audio src="/slow/pair.wav?ms=0" data-name="pair.wav" preload="none"></audio>
  <audio-wave lazy style="width: 300px; height: 120px; color: rgb(255, 255, 255)"></audio-wave>
  <audio-code><pre><code>audio('pair.wav')</code></pre></audio-code><audio-play></audio-play></audio-sound>`)
  await page.waitForTimeout(500)
  assert.ok(!got.includes('/repl/engine.js'), 'no engine for a lazy picture in sight')
  assert.equal(await page.locator('audio-wave').evaluate(e => e.hasAttribute('data-drawn')), false)
  await page.locator('audio-play button').click()
  await drawn()
  await page.locator('audio-play button').click()
  // the first channel in the upper half, as tall as its 0.8; the second in the lower, its 0.2
  const { width, height, a } = await pixels('audio-wave')
  const span = (from, to) => { let top = -1, foot = -1; const x = Math.round(width / 2); for (let y = from; y < to; y++) if (a[y * width + x]) { if (top < 0) top = y; foot = y }; return foot - top + 1 }
  const [first, second] = [span(0, height / 2), span(height / 2, height)]
  assert.ok(Math.abs(first - .8 * height / 2) <= 3 && Math.abs(second - .2 * height / 2) <= 3, `lanes ${first} and ${second} px tall of ${height / 2}: 0.8 and 0.2 of a lane`)
})
