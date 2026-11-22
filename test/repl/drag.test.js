// A selection's audio dragged (view/pointer.js carry): its start or its end onto where it came from and onto the cues
// near it (view/scales.js landings), every place it may go onto showing, faint, the line it went onto whole and a cross
// at the top and the foot of the edge that took hold; put in, what follows moving on (cut(), then paste()), or, each
// key held before the press or pressed on the way, ⌘ over what is there (move()), Alt a copy put in (copy(), then
// paste()), both a copy over what is there (copy(), paste(), then as much taken out after it); each drop one step. The
// server, the page and the helpers in page.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { TOP, page, code, open, settled, frames, poll, write, tall, axis, drag, lengthIs, hits, handles, spans, pixels, keyed, chime, selected, hintsAt, hinted, engine } from './page.js'

// The hits' cues, s, as the caret steps by them: a strike every half second, each falling quiet a third of a second on
async function cuesOf(box) {
  const w = await spans(box)
  return poll(async () => (await handles()).map(px => px / w * 2), cues => assert.ok(cues.some(t => Math.abs(t - 1) < .02), `the cue at 1 s: ${cues}`), 8000)
}
// The hits written, a piece of the first strike's tail selected, 0.6 to 0.75 s, clear of every cue: its ends as the
// clock says them, and where to press to carry it
async function piece() {
  await open()
  await write(hits)
  await lengthIs('0:02.000')
  const { box, x } = await axis(2), y = box.y + TOP + 40, cues = await cuesOf(box)
  await drag([x(.6), y], [x(.75) - x(.6), 0])
  const [a, b] = (await selected()).split('–').map(t => +t.split(':')[1])
  return { box, x, y, cues, a, b, mid: x((a + b) / 2) }
}
// the line a drag went onto, whole, across the lane's middle, within 3 px of `px` (CSS px from the picture's left)
const lineBy = px => hintsAt(TOP + 80, px - 3, px + 4, .9)
// a small cross at (`px`, `y`): the accent in the 7 px square about it, its own column left out
async function crossAt(px, y) {
  const pts = []
  for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) if (dx) pts.push([px + dx, y + dy])
  return (await hinted(pts)).filter(a => a > 48).length
}
const crosses = async px => [await crossAt(px, TOP + 3), await crossAt(px, tall() - 3)]
// where the piece let go was written to: move()'s `to`, or paste()'s after a cut() or a copy(); a range as the clock
// writes it; where the piece carried starts now
const landedAt = async () => +(await code()).match(/\.move\(\{ at: [\d.]+, d: [\d.]+, to: ([\d.]+)|\.(?:cut|copy)\(\{[^}]*\}\)\.paste\(([\d.]+)/).slice(1).find(Boolean)
const range = (a, b) => [a, b].map(t => `0:0${t.toFixed(3)}`).join('–')
const carriedTo = () => page.evaluate(async () => { const d = (await import('/repl/view/pointer.js')).drag; return d && { to: d.to, d: d.b - d.a } })

// In every way it goes (put in, ⌘ over what is there, Alt a copy, both a copy over), its start goes onto a cue it is
// carried 2 px past, and so does its end, carried on (onto the cue at 1 s) and carried back (its start onto the one at
// 0.5 s, its end onto where the first strike falls quiet): the cue's line drawn whole, a cross at the top and the foot of
// the edge on it, none by the other, that edge on the cue's time; brought back where it came from, let go, nothing written
test('editor: a selection\'s audio goes onto a cue by its start or by its end, either way, in every way it goes; the line shown, crosses on the edge that took hold', async () => {
  const { box, x, y, cues, a, b, mid } = await piece(), d = b - a, before = await code()
  const on = (t, near) => cues.find(c => Math.abs(c - t) < near)
  const cases = [[on(1, .02), 0, 'on'], [on(1, .02), 1, 'on'], [on(.5, .02), 0, 'back'], [on(.35, .03), 1, 'back']]
  for (const [way, keys] of [['put in', []], ['over', ['ControlOrMeta']], ['a copy', ['Alt']], ['a copy over', ['ControlOrMeta', 'Alt']]]) for (const [at, edge, dir] of cases) {
    const say = `${way}, carried ${dir}, by its ${edge ? 'end' : 'start'} onto ${at}`
    for (const k of keys) await page.keyboard.down(k)
    await page.mouse.move(mid, y)
    await page.mouse.down()
    await page.mouse.move(mid + x(at) + (dir === 'on' ? 2 : -2) - x(edge ? b : a), y, { steps: 8 })
    const [px] = await poll(() => lineBy(Math.round(x(at) - box.x)), l => assert.equal(l.length, 1, `${say}: the cue's line, whole: ${l}`))
    const other = Math.round(x(edge ? at - d : at + d) - box.x), held = await crosses(Math.round(px)), free = await crosses(other), now = await carriedTo()
    await page.mouse.move(mid, y, { steps: 8 })
    await page.mouse.up()
    for (const k of keys) await page.keyboard.up(k)
    assert.ok(held.every(n => n >= 4), `${say}: a cross at the top and the foot of that edge, ${held}`)
    assert.ok(free.every(n => n < 2), `${say}: none by the other edge, ${free}`)
    assert.ok(Math.abs(now.to + edge * now.d - at) < 1e-3, `${say}: that edge on the cue's time (as the clock reads it, to the ms), its start at ${now.to}`)
    assert.equal(await code(), before, `${say}: brought back, nothing written`)
  }
})

// Carried off and brought back within a few px of where it came from, it goes onto it: both edges took hold, a cross at
// each; let go there, nothing is written and it stays selected where it was
test('editor: a selection\'s audio carried back by where it came from goes onto it, a cross at both edges; let go there, nothing written', async () => {
  const { box, x, y, a, b, mid } = await piece()
  const before = await code()
  await page.mouse.move(mid, y)
  await page.mouse.down()
  await page.mouse.move(mid + 40, y, { steps: 4 })
  await page.mouse.move(mid + 2, y, { steps: 4 })
  await poll(async () => [await crosses(Math.round(x(a) - box.x)), await crosses(Math.round(x(b) - box.x))], e => assert.ok(e.flat().every(n => n >= 4), `a cross at the top and the foot of each edge: ${JSON.stringify(e)}`))
  await page.mouse.up()
  assert.equal(await code(), before, 'nothing written')
  assert.equal(await selected(), range(a, b), 'selected where it was')
})

// Carried a pixel and a third at a time, the piece is drawn the same at each step, moved by whole pixels, and what is
// past where it was and where it goes holds still: each column's top and foot (the waveform alone, the layers over it
// hidden) as the step before had them, the piece's shifted by the whole pixels that match best, within a row, as the
// edge of an anti-aliased body reads either side of the brightness it is read at. gl-waveform's columns once took other
// samples at each fraction of a pixel (view/render.js steady): tens of rows apart where a hit is
test('editor: a selection\'s audio carried a pixel at a time is drawn the same at each step, moved by whole pixels; what it leaves holds still', async () => {
  const { box, x, y, a, b, mid } = await piece(), d = b - a, px = t => x(t) - box.x
  await page.addStyleTag({ content: '.plot canvas:not(.waveform), .hint { visibility: hidden !important }' })
  const profile = () => pixels(`const out = []; for (let x = 0; x < w; x++) { let t = -1, f = -1; for (let y = ${TOP}; y < ${tall()}; y++) { const i = (y * w + x) * 4; if (d[i] + d[i + 1] + d[i + 2] > 450) { if (t < 0) t = y; f = y } } out.push([t, f]) } return out`)
  const carried = () => page.evaluate(async () => (await import('/repl/view/pointer.js')).drag?.to)
  const apart = (p, q) => p && q ? Math.max(Math.abs(p[0] - q[0]), Math.abs(p[1] - q[1])) : 0
  await page.mouse.move(mid, y)
  await page.mouse.down()
  await page.mouse.move(mid + 30, y, { steps: 6 })
  let was = await profile(), from = await carried()
  for (let k = 1; k <= 12; k++) {
    await page.mouse.move(mid + 30 + k * 1.37, y)
    await frames()
    const now = await profile(), to = await carried(), c0 = Math.ceil(px(to)) + 2, c1 = Math.floor(px(to + d)) - 2, by = Math.round(px(to) - px(from))
    const piece = Math.min(...[by - 1, by, by + 1].map(s => Math.max(0, ...Array.from({ length: c1 - c0 }, (_, i) => apart(was[c0 + i - s], now[c0 + i])))))
    const lo = Math.min(px(a), px(to)) - 3, hi = Math.max(px(b), px(to + d)) + 3
    const rest = Math.max(0, ...now.map((q, c) => c >= lo && c <= hi ? 0 : apart(was[c], q)))
    assert.ok(piece <= 1, `step ${k}: the piece as it was, shifted ${by} px: ${piece} rows apart at most`)
    assert.ok(rest <= 1, `step ${k}: the rest as it was: ${rest} rows apart at most`)
    was = now; from = to
  }
  await page.mouse.up()
})

// Carried, every place it may go onto shows, faint, no key held (⌘ there lays it over what is there): the cues either
// side of where it came from and those past it; it goes onto them, its end onto the cue at 1.5 s, put in
test('editor: a selection\'s audio carried shows every place it may go onto, no key held, and goes onto them', async () => {
  const { box, x, y, cues, a, b, mid } = await piece(), w = await spans(box), at = cues.find(t => Math.abs(t - 1.5) < .02)
  await page.mouse.move(mid, y)
  await page.mouse.down()
  await page.mouse.move(mid + x(1.25) - x(b), y, { steps: 6 })
  await poll(() => hintsAt(TOP + 4, 0, w), l => assert.ok(l.length >= cues.length, `every place (${cues.length} cues and where it came from): ${l}`))
  await page.mouse.move(mid + x(at) + 2 - x(b), y, { steps: 6 })
  await poll(() => lineBy(Math.round(x(at) - box.x)), l => assert.equal(l.length, 1, `onto the cue at ${at}: ${l}`))
  await page.mouse.up()
  await page.waitForFunction(() => scriptText().includes('.cut('))
  assert.ok(Math.abs(await landedAt() + b - a - at) < 2e-3, `its end on the cue at ${at}: ${await code()}`)
})

// Each way one step, as its calls (the chime, nothing snapping): no key, put in, cut() then paste() at where it lands
// of what the cut left; ⌘, over what is there, move(); Alt, a copy put in, copy() then paste(), and so with Shift; ⌘
// and Alt, a copy over what is there, copy(), paste() and as much taken out after it. Undo takes each back whole, what
// was selected with it
test('editor: a selection\'s audio dragged writes cut() then paste(), with ⌘ move(), with Alt copy() then paste(), with both a copy over, each one step', async () => {
  const { x, y } = await chime()
  await drag([x(1), y], [x(2) - x(1), 0])
  for (const [keys, call, length] of [
    [[], /\.cut\(\{ at: 1, d: 1, xfade: 0\.01 \}\)\.paste\(4, 0\.01\)$/, '0:08.000'],
    [['ControlOrMeta'], /\.move\(\{ at: 1, d: 1, to: 4, xfade: 0\.01 \}\)$/, '0:08.000'],
    [['Alt'], /\.copy\(\{ at: 1, d: 1 \}\)\.paste\(4, 0\.01\)$/, '0:09.000'],
    [['Alt', 'Shift'], /\.copy\(\{ at: 1, d: 1 \}\)\.paste\(4, 0\.01\)$/, '0:09.000'],
    [['ControlOrMeta', 'Alt'], /\.copy\(\{ at: 1, d: 1 \}\)\.paste\(4\)\.remove\(\{ at: 5, d: 1 \}\)$/, '0:08.000']
  ]) {
    await keyed(keys, () => drag([x(1.5), y], [x(4) - x(1), 0]))
    await page.waitForFunction(re => new RegExp(re).test(scriptText()), call.source)
    await lengthIs(length)
    assert.equal(await selected(), '0:04.000–0:05.000', `${keys.join('+') || 'no key'}: selected where it went`)
    await page.keyboard.press('ControlOrMeta+Z')
    await page.waitForFunction(() => scriptText() === "audio('chime.wav')")
    await lengthIs('0:08.000')
    assert.equal(await selected(), '0:01.000–0:02.000', 'undone whole, the selection as it was')
    await page.waitForFunction(() => !document.querySelector('.plot .veil:not([hidden])'))
    await settled()
  }
})

// ⌘ or Alt pressed on the way turns the drag at once, let go turns it back: what is where it was, what followed it,
// closed up behind it (put in), or silence (over what is there), and its words by the pointer; let go with ⌘ held,
// move(); ⌘ or Alt held at the press and let go on the way, put in, cut() then paste()
test('editor: ⌘ or Alt pressed or let go as a selection\'s audio is carried turns it at once, the picture and its words with it', async () => {
  const { box, x, y } = await chime()
  await drag([x(1), y], [x(2) - x(1), 0])
  const said = () => page.locator('.hint').evaluate(e => e.hidden ? '' : e.textContent)
  // where it was, 1.1 to 1.9 s: the columns with a waveform's body down the lanes (more bright pixels than the centre
  // lines silence draws)
  const there = () => pixels(`let n = 0; for (let x = ${Math.round(x(1.1) - box.x)}; x < ${Math.round(x(1.9) - box.x)}; x++) { let k = 0; for (let y = ${TOP + 2}; y < ${tall() - 2}; y++) { const i = (y * w + x) * 4; if (d[i] + d[i + 1] + d[i + 2] > 300) k++ } if (k > 4) n++ } return n`)
  await page.mouse.move(x(1.5), y)
  await page.mouse.down()
  await page.mouse.move(x(4.5), y, { steps: 6 })
  await poll(said, s => assert.match(s, /^insert at 0:04\.0+$/))
  const put = await poll(there, n => assert.ok(n > 20, `put in: what followed it closed up there, ${n} bright px`))
  await page.keyboard.down('ControlOrMeta')
  await poll(said, s => assert.match(s, /^overwrite at 0:04\.0+$/))
  await poll(there, n => assert.ok(3 * n + 20 < put, `held ⌘: silence where it was, ${n} bright px, ${put} put in`))
  await page.keyboard.up('ControlOrMeta')
  await poll(said, s => assert.match(s, /^insert at 0:04\.0+$/))
  await poll(there, n => assert.ok(n > put / 2, `let go: what followed it there again, ${n}`))
  await page.keyboard.down('Alt')
  await poll(said, s => assert.match(s, /^insert a copy at 0:04\.0+$/))
  await page.keyboard.down('ControlOrMeta')
  await poll(said, s => assert.match(s, /^overwrite with a copy at 0:04\.0+$/))
  await poll(there, n => assert.ok(n > put / 2, `held ⌘ and Alt: where it was, as it is, ${n}`))
  await page.keyboard.up('Alt')
  await page.mouse.up()
  await page.keyboard.up('ControlOrMeta')
  await page.waitForFunction(() => /\.move\(\{ at: 1, d: 1, to: 4, xfade: 0\.01 \}\)$/.test(scriptText()))
  await page.keyboard.press('ControlOrMeta+Z')
  await page.waitForFunction(() => scriptText() === "audio('chime.wav')")
  for (const key of ['ControlOrMeta', 'Alt']) {
    await page.waitForFunction(() => !document.querySelector('.plot .veil:not([hidden])'))
    await settled()
    await page.keyboard.down(key)
    await page.mouse.move(x(1.5), y)
    await page.mouse.down()
    await page.mouse.move(x(3.5), y, { steps: 4 })
    await poll(said, s => assert.match(s, key === 'Alt' ? /^insert a copy at 0:03\.0+$/ : /^overwrite at 0:03\.0+$/))
    await page.keyboard.up(key)
    await page.mouse.move(x(4.5), y, { steps: 4 })
    await page.mouse.up()
    await page.waitForFunction(() => /\.cut\(\{ at: 1, d: 1, xfade: 0\.01 \}\)\.paste\(4, 0\.01\)$/.test(scriptText()))
    await page.keyboard.press('ControlOrMeta+Z')
    await page.waitForFunction(() => scriptText() === "audio('chime.wav')")
  }
})

// What the picture draws of a piece put in (view/render.js arrange 'shuffle': at `to` of what the cut left) is what the
// library makes of cut(), then paste() at that `to`: a ramp, each sample its own time, read where each part landed
test('engine: cut() then paste(to) puts the piece at `to` of what the cut left, what was between closed up behind it', async () => {
  const [later, sooner] = await engine([
    `audio.from(t => t, { duration: 3, sampleRate: 1000 }).cut({ at: 0.5, d: 0.5 }).paste(1.5)`,
    `audio.from(t => t, { duration: 3, sampleRate: 1000 }).cut({ at: 2, d: 0.5 }).paste(0.5)`
  ])
  const read = (r, t) => r.output.channels[0][Math.round(t * 1000)]
  // put later: 1 to 2 s moved back to 0.5 to 1.5, the piece at 1.5 to 2, the rest where it was
  for (const [t, v] of [[.25, .25], [.75, 1.25], [1.25, 1.75], [1.75, .75], [2.5, 2.5]]) assert.ok(Math.abs(read(later, t) - v) < 2e-3, `put later, at ${t} s: ${read(later, t)}, not ${v}`)
  // put sooner: the piece at 0.5 to 1, 0.5 to 2 s moved on to 1 to 2.5, the rest where it was
  for (const [t, v] of [[.25, .25], [.75, 2.25], [1.25, .75], [2.25, 1.75], [2.75, 2.75]]) assert.ok(Math.abs(read(sooner, t) - v) < 2e-3, `put sooner, at ${t} s: ${read(sooner, t)}, not ${v}`)
  assert.deepEqual([later, sooner].map(r => r.output.channels[0].length), [3000, 3000], 'the length kept')
})

// What the picture draws of a copy over what is there (view/render.js arrange 'stamp': its copy from `to`, the rest
// where it was) is what the library makes of copy(), paste() at `to`, then as much taken out after it: put before where
// it was copied from, after it, over it, and running past the end, longer there as move() makes it. And `to` is where
// the piece's start lands whichever way it goes: over what is there, put in, a copy put in, a copy over it
test('engine: a copy over what is there, copy() then paste(to) then remove() after it, replaces what was there, before, after, over its source and past the end', async () => {
  const ramp = 'audio.from(t => t, { duration: 3, sampleRate: 1000 })', stamp = to => `${ramp}.copy({ at: 1, d: 0.5 }).paste(${to}).remove({ at: ${to + .5}, d: 0.5 })`
  const read = (r, t) => r.output.channels[0][Math.round(t * 1000)], near = (r, t, v, say) => assert.ok(Math.abs(read(r, t) - v) < 2e-3, `${say}, at ${t} s: ${read(r, t)}, not ${v}`)
  const tos = { before: .25, after: 2, 'over its source': 1.25, 'past the end': 2.75 }, outs = await engine(Object.values(tos).map(stamp))
  Object.entries(tos).forEach(([say, to], k) => {
    const r = outs[k]
    assert.equal(r.output.channels[0].length, Math.round(Math.max(3, to + .5) * 1000), `${say}: the length kept, or longer to its end past the sound's`)
    for (const t of [to + .05, to + .25, to + .45]) near(r, t, 1 + t - to, `${say}: the copy`)
    for (const t of [to - .1, to + .6].filter(t => t >= 0 && t < 3)) near(r, t, t, `${say}: what is either side where it was`)
  })
  const ways = [`${ramp}.move({ at: 1, d: 0.5, to: 2 })`, `${ramp}.cut({ at: 1, d: 0.5 }).paste(2)`, `${ramp}.copy({ at: 1, d: 0.5 }).paste(2)`, stamp(2)]
  ;(await engine(ways)).forEach((r, k) => { for (const t of [2.05, 2.25, 2.45]) near(r, t, 1 + t - 2, `${['moved', 'put in', 'a copy put in', 'a copy over'][k]}: its start at 2 s`) })
})
