// The level's mark over a waveform (view/overlay.js, view/strips.js waveAt): one, at the pointer, on the wave's end on
// the pointer's side of the centre line, as the column it stands on is drawn, never past the wave, whole within its
// lane, at any zoom, in either channel; a snap's cross wins over it (select.test.js 'held Alt, a press held takes the
// caret along'). The server, the page and the helpers in page.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { page, open, write, lengthIs, frames, poll, pixels } from './page.js'

// two channels: the left up to +0.8 and down to −0.3 for a second, then at full scale; the right ±0.5
const SOUND = `audio.from(t => { const s = Math.sin(2 * Math.PI * 440 * t); return [t < 1 ? (s > 0 ? .8 * s : .3 * s) : Math.sign(s), .5 * Math.sin(2 * Math.PI * 660 * t)] }, { duration: 2, channels: 2 })`
// the view as it is drawn: its span, the lanes' width, each waveform lane's top and height (CSS px from the picture's top)
const view = () => page.evaluate(async () => {
  const m = await import('/repl/view/model.js'), g = await import('/repl/view/geometry.js')
  return { start: m.start, end: m.end, w: g.plot().w, lanes: g.lanes().wave.map(r => [r[1], r[3]]) }
})
// the marks in the caret's ink, whole (not the caret's ghost, half seen through), in columns [x0, x1) of the lanes:
// each a run of rows, { top, foot, mid, x } (x its widest row's middle)
const marks = (x0, x1, y0, y1) => page.evaluate(([x0, x1, y0, y1]) => {
  const cv = __overlay(), k = cv.width / cv.clientWidth, g = cv.getContext('2d')
  const [r, gr, b] = getComputedStyle(document.documentElement).getPropertyValue('--color-screen-caret').match(/[\d.]+/g).map(Number)
  const rows = []
  for (let y = y0; y < y1; y++) {
    const d = g.getImageData(Math.round(x0 * k), Math.round(y * k), Math.round((x1 - x0) * k), 1).data, on = []
    for (let i = 0; i < d.length / 4; i++) if (d[i * 4 + 3] > 200 && Math.abs(d[i * 4] - r) < 16 && Math.abs(d[i * 4 + 1] - gr) < 16 && Math.abs(d[i * 4 + 2] - b) < 16) on.push(x0 + i / k)
    if (on.length) rows.push({ y, n: on.length, x: (on[0] + on.at(-1)) / 2 })
  }
  const out = []
  for (const row of rows) { const last = out.at(-1); if (last && row.y === last.foot + 1) { last.foot = row.y; if (row.n > last.n) Object.assign(last, { n: row.n, x: row.x }) } else out.push({ top: row.y, foot: row.y, n: row.n, x: row.x }) }
  return out.map(m => ({ ...m, mid: (m.top + m.foot) / 2 }))
}, [x0, x1, y0, y1])
// the wave as drawn down column `x` over rows [y0, y1), the pointer away: whether each row holds it (lighter than the
// ground by more than a faint body's edge)
const drawn = (x, y0, y1) => pixels(`const out = []; let ground = 765; for (let y = arg.y0; y < arg.y1; y++) { const i = (y * w + arg.x) * 4; ground = Math.min(ground, d[i] + d[i + 1] + d[i + 2]) } for (let y = arg.y0; y < arg.y1; y++) { const i = (y * w + arg.x) * 4; out.push(d[i] + d[i + 1] + d[i + 2] - ground > 30) } return out`, { x: Math.round(x), y0, y1 })

// Over or under the centre line in each lane, at three zooms (all of it, 16 times in, 256 times in, where a pixel holds
// under a sample and the wave is a line): one mark, on the wave as its column is drawn there, whole within its lane;
// all of it in sight, where a column holds both halves, over the line with the pointer over it, under it under
test('editor: one level mark at the pointer, on the wave\'s end on its side of the centre line, at any zoom, in either channel', async () => {
  await open()
  await write(SOUND)
  await lengthIs('0:02.000')
  const box = await page.locator('.plot').boundingBox()
  for (const zoom of [0, 4, 8]) {
    await page.locator('.plot').focus()
    for (let i = 0; i < (zoom ? 4 : 0); i++) await page.keyboard.press('=')
    const g = await view(), top = Math.min(...g.lanes.map(l => l[0])), foot = Math.max(...g.lanes.map(([y, h]) => y + h))
    for (const [lane, side] of [[0, -1], [0, 1], [1, -1], [1, 1]]) {
      const [ly, lh] = g.lanes[lane], cx = Math.round(g.w * .4), axis = ly + lh / 2, py = Math.round(axis + side * lh / 4), say = `zoom ${zoom}, lane ${lane}, ${side < 0 ? 'over' : 'under'} the line`
      await page.mouse.move(box.x + box.width / 2, box.y - 20)
      await frames()
      const columns = await Promise.all(Array.from({ length: 13 }, (_, k) => drawn(cx - 6 + k, Math.round(ly), Math.round(ly + lh))))
      await page.mouse.move(box.x + cx, box.y + py)
      const found = await poll(() => marks(cx - 8, cx + 8, Math.round(top), Math.round(foot)), m => assert.equal(m.length, 1, `${say}: one mark, ${JSON.stringify(m)}`))
      const [m] = found, col = columns[Math.round(m.x) - (cx - 6)], at = Math.round(m.mid - ly)
      assert.ok(m.top >= ly - .5 && m.foot <= ly + lh, `${say}: whole within its lane, ${m.top}–${m.foot} in ${ly}–${ly + lh}`)
      assert.ok(col && col.slice(Math.max(0, at - 2), at + 3).some(Boolean), `${say}: on the wave drawn at its column, row ${at} of ${col?.map(Number).join('')}`)
      if (!zoom) assert.ok(side < 0 ? m.mid < axis : m.mid > axis, `${say}: on the pointer's side of the centre line, ${m.mid} by ${axis}`)
    }
  }
})

// Where the old mark stood off the wave: over the line on the left channel, its mirror under it, past a wave that goes
// no lower than −0.3; over a wave at full scale, half past the lane's edge. Now one, on the wave, whole in the lane
test('editor: the level mark never stands past the wave: none mirrored under a wave that does not go there, none past the lane\'s edge', async () => {
  await open()
  await write(SOUND)
  await lengthIs('0:02.000')
  const box = await page.locator('.plot').boundingBox(), g = await view(), [ly, lh] = g.lanes[0], x = t => (t - g.start) / (g.end - g.start) * g.w
  for (const t of [.5, 1.5]) {
    const cx = Math.round(x(t))
    await page.mouse.move(box.x + cx, box.y + Math.round(ly + lh * .2))
    const [m] = await poll(() => marks(cx - 8, cx + 8, Math.round(ly), Math.round(ly + lh)), m => assert.equal(m.length, 1, `at ${t} s: one mark in the lane, ${JSON.stringify(m)}`))
    assert.ok(m.mid < ly + lh / 2, `at ${t} s: over the line, ${m.mid}`)
    assert.ok(m.top >= ly - .5, `at ${t} s: whole within the lane, its top ${m.top} under the lane's ${ly}`)
  }
})
