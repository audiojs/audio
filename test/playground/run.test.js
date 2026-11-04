// The page coming up, a run's output arriving and what stays as it does, an error said, the engine's worker; the
// server, the page and the helpers in page.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { dirname, relative, resolve, sep } from 'node:path'
import { workers } from '../../.site-build.js'
import { root, browser, page, origin, errors, code, readout, wholeLevels, levelsTable, lengthText, open, settled, frames, poll, still, settings, selected, tab, menu, facts, noCues, write, drawn, tall, axis, drag, lengthIs, pixels, show, bursts, chime } from './page.js'

test('editor: opens on the chime with its script, drawn and measured', async () => {
  await open()
  assert.equal(await code(), `audio('chime.wav')\n  .trim()\n  .normalize(-1)\n  .fade(0.02, 0.1)`)
  assert.equal(await page.locator('.source').innerText(), 'chime.wav')
  // the depth the export writes, the library's 16 for a sound of no depth (fn/save.js)
  assert.equal(await facts(), '44.1kHz stereo 16-bit')
  assert.equal(await readout(), '−1.0dBFS')
  assert.match(await levelsTable(), /^Peak −1\.0dBFS at 0:0\d\.\d{3}\nRMS −\d+\.\ddBFS\nCrest \d+\.\ddB\nLoudness −\d+\.\dLUFS integrated$/)
  // its lanes TRACK px of the plot, the room under them
  const box = await page.locator('.plot').boundingBox()
  assert.ok(await drawn() > .05 * tall(box) / (box.height - 22), 'the waveform covers its lanes')
})

// Two edits on the picture, the second made while the first's script still runs (each run held 1.5 s by a loop): the
// first's output, when it comes, is not the one the picture waits for, and the view holds where it is and its scale
// until the second's comes. Taken for it (once, now and then, under load), it ended the wait, and the second's output,
// arriving unlooked-for, showed all of the sound again, moving it under the pointer
test('editor: an older output arriving while a newer edit is drawn ahead leaves the view where it is', async () => {
  await open()
  await noCues()
  await write(`for (const t = Date.now(); Date.now() - t < 1500;);\naudio('chime.wav')`)
  await lengthIs('0:08.000')
  const { box, x } = await axis(8), y = box.y + tall(box) * .3
  await drag([x(1), y], [x(2) - x(1), 0])
  await page.keyboard.press('Delete')
  // its run under way (1.5 s at least), said once it takes a moment
  await page.locator('.message', { hasText: /^(Rendering|Applying)/ }).waitFor()
  await drag([x(3), y], [x(4) - x(3), 0])
  await page.keyboard.press('Delete')
  await page.waitForFunction(() => (scriptText().match(/\.remove\(/g) || []).length === 2)
  await lengthIs('0:06.000')
  await settled()
  await drag([x(5), y], [x(5.5) - x(5), 0])
  assert.equal(await selected(), '0:05.000–0:05.500', 'the scale as it was: 8 s across')
})

// The page's state is one object literal, as are its menus' and its views': a key written twice there is silently the
// last one (the ring's share of the sound, named `progress` for a moment, took the status bar's word away), so none is.
// Nor does a module write a binding it imports, which throws (a module's own `let` is written there, or through
// editor/context.js assign()): every module of the page, playground/dist's builds aside
test('editor: no object literal in the page names a key twice', async () => {
  const { build } = await import('esbuild')
  const entryPoints = (await readdir(`${root}/playground`, { recursive: true })).filter(f => f.endsWith('.js') && f.split(sep)[0] !== 'dist').map(f => `${root}/playground/${f}`)
  const { warnings } = await build({ entryPoints, write: false, bundle: false, outdir: 'out', logLevel: 'silent' })
  assert.deepEqual(warnings.filter(w => w.id === 'duplicate-object-key' || w.id === 'assign-to-import').map(w => `${w.location.file}:${w.location.line} ${w.text}`), [])
})

// The engine sets off before the page's own scripts: its worker is asked for while editor.js is still held back, and
// the page, once up, runs on that worker, not a second one
test('editor: the engine\'s worker loads ahead of the page\'s scripts, and the page takes it', async () => {
  let release
  const held = new Promise(r => release = r)
  await page.route('**/playground/editor.js', async route => { await held; route.continue() })
  await page.addInitScript(() => { const W = Worker; window.workers = 0; window.Worker = class extends W { constructor(...a) { super(...a); workers++ } } })
  const asked = page.waitForRequest('**/playground/dist/worker.js')
  await page.goto(origin + '/playground/', { waitUntil: 'commit' })
  await asked
  release()
  await wholeLevels().waitFor()
  assert.equal(await page.evaluate(() => workers), 1, 'one worker')
})
// One set off ahead that fails to load is let go: the page starts its own, and runs
test('editor: an engine worker that fails to load ahead is replaced by the page\'s own', async () => {
  let first = true
  await page.route('**/playground/dist/worker.js', route => first ? (first = false, route.abort()) : route.continue())
  await page.goto(origin + '/playground/')
  await wholeLevels().waitFor()
  assert.equal(first, false, 'the first one failed')
})

// A first visit opens on an empty tab, its ways in offered as the page comes up: no sound nobody chose, and none of what
// an empty tab doesn't need waited for, the engine, CodeMirror or the library, which come after it shows
test('editor: a first visit opens on an empty tab, its ways in shown before the engine, CodeMirror or the library come', async () => {
  const p = await browser.newPage()
  p.on('pageerror', e => errors.push(e.message))
  let release
  const held = new Promise(r => release = r)
  await p.route(/\/(playground\/dist\/worker\.js|assets\/codemirror\.js|assets\/audio\.js)$/, async route => { await held; route.continue() })
  try {
    await p.goto(origin + '/playground/')
    await p.locator('.empty').waitFor()
    assert.equal(await p.locator('#app').getAttribute('data-boot'), null, 'shown')
    assert.deepEqual(await p.locator('.files [role="tab"]').allInnerTexts(), ['untitled'])
    assert.equal(await p.locator('.cm-content').count(), 0, 'CodeMirror not come yet')
  } finally { release(); await p.close() }
})

// Every module the editor imports, however deep, is preloaded by the page, and none it doesn't import: none is found
// an import at a time, a round trip each, and CodeMirror and the library, which come after the page shows, are not
// among them (playground/index.html)
test('editor: the page preloads every module the editor imports, and nothing else', async () => {
  const html = await readFile(resolve(root, 'playground/index.html'), 'utf8'), preloaded = [...html.matchAll(/<link rel="modulepreload" href="([^"]+)"/g)].map(m => relative(root, resolve(root, 'playground', m[1])))
  const graph = new Set()
  const walk = async file => {
    if (graph.has(file)) return
    graph.add(file)
    const src = await readFile(resolve(root, file), 'utf8')
    for (const [, spec] of src.matchAll(/(?:^|[;}\s])(?:import|export)\s*(?:[^'"()]*?\s*from\s*)?['"](\.[^'"]+)['"]/gm)) await walk(relative(root, resolve(root, dirname(file), spec)))
  }
  await walk('playground/editor.js')
  assert.deepEqual([...preloaded].sort(), [...graph].sort())
  assert.ok(!graph.has('assets/codemirror.js') && !graph.has('assets/audio.js'), 'CodeMirror and the library come once the page shows')
})

// CodeMirror comes after the page shows: an edit made before it, a sound opened, is a step of its history once it
// does, undone and redone as any
test('editor: an edit made before CodeMirror comes is undone and redone once it has', async () => {
  const p = await browser.newPage()
  p.on('pageerror', e => errors.push(e.message))
  let release
  const held = new Promise(r => release = r)
  await p.route('**/assets/codemirror.js', async route => { await held; route.continue() })
  const text = () => p.evaluate(() => [...document.querySelectorAll('.cm-content .cm-line')].map(l => l.textContent).join('\n'))
  try {
    await p.goto(origin + '/playground/')
    await p.locator('.empty').waitFor()
    await p.locator('.menubar-item', { hasText: /^File$/ }).click()
    for (const name of ['Sample or generate', 'chime.wav']) await p.locator('.menubar-list .menu-row:visible').filter({ has: p.locator('.menu-label', { hasText: new RegExp(`^${name.replace('.', '\\.')}$`) }) }).last().click()
    await p.waitForFunction(() => document.querySelector('.readout')?.dataset.of === 'all')
    assert.equal(await p.locator('.history .undo').getAttribute('aria-disabled'), null, 'undoable already')
    release()
    await p.locator('.cm-content').waitFor({ state: 'attached' })
    assert.equal(await text(), `audio('chime.wav')`)
    await p.getByRole('button', { name: 'Undo', exact: true }).click()
    await p.locator('.empty').waitFor()
    assert.equal(await text(), '')
    await p.getByRole('button', { name: 'Redo', exact: true }).click()
    await p.waitForFunction(() => document.querySelector('.readout')?.dataset.of === 'all')
    assert.equal(await text(), `audio('chime.wav')`)
  } finally { release(); await p.close() }
})

test('editor: before the script runs, the intro shows nothing dead; while the first run renders, it stays away', async () => {
  // no script at all: the conditional parts (intro, toolbar) stay hidden instead of showing inert buttons
  await page.route('**/playground/editor.js', route => route.abort())
  await page.goto(origin + '/playground/')
  await still()
  assert.equal(await page.locator('.empty').isVisible(), false, '.empty')
  // and what does show takes no clicks yet: the File menu stays shut
  assert.equal(await page.locator('#app').evaluate(el => getComputedStyle(el).pointerEvents), 'none')
  await page.locator('.menubar-item', { hasText: /^File$/ }).click({ force: true, timeout: 2000 }).catch(() => {})
  assert.equal(await page.locator('.menubar-list:popover-open').count(), 0)
  await page.unroute('**/playground/editor.js')
  errors.splice(0)  // the script this part withheld on purpose
  // a slow engine: the script is up, the first output isn't, and the view doesn't claim there's no sound
  let release
  const held = new Promise(r => release = r)
  await page.route('**/playground/dist/worker.js', async route => { await held; route.continue() })
  await page.goto(origin + '/playground/')
  await page.locator('.cm-content').waitFor({ state: 'attached' })
  // its run asked and held a moment, said so
  await page.locator('.message', { hasText: /^(Decoding|Rendering)/ }).waitFor()
  assert.equal(await page.locator('.empty').isVisible(), false, 'no intro while the first run renders')
  release()
  await wholeLevels().waitFor()
  assert.equal(await page.locator('.empty').count(), 0)
  assert.equal(await page.locator('#app').evaluate(el => getComputedStyle(el).pointerEvents), 'auto', 'taken over, it answers')
})

test('editor: an output of no samples shows the empty view; the next output replaces it', async () => {
  await open()
  await write(`audio('chime.wav').crop({ at: 0, duration: 0 })`)
  await page.locator('.empty', { hasText: 'Drop audio here' }).waitFor()
  assert.equal(await readout(), '')
  assert.ok(await page.getByRole('button', { name: 'Play' }).isDisabled())
  await write(`audio('chime.wav').reverse()`)
  await wholeLevels().waitFor()
  await page.locator('.empty').waitFor({ state: 'detached' })
  assert.equal(await lengthText(), '0:08.000')
})

// While the worker is held (a loop, until its 5 s guard), a script naming a sample not made yet, then a newer script:
// the page must end on the newer one, not on the older one arriving late.
test('editor: the newest script is the one shown, even when an older one waited for a sample', async () => {
  await open()
  await write(`while (true) {}`)
  await page.locator('.message', { hasText: 'Rendering' }).waitFor()
  // the ring that stops it in Record's place, Play still Play
  await page.waitForFunction(() => !document.querySelector('.busy').inert && document.querySelector('.record').inert && !document.querySelector('.play').inert, null, { timeout: 4000 })
  await write(`audio('handpan.wav')`)
  // its run asked, the file new to the view
  await page.locator('.message', { hasText: /^Decoding/ }).waitFor()
  await write(`audio('chime.wav').reverse()`)
  await page.locator('.message', { hasText: 'Rendering' }).waitFor()
  await page.waitForFunction(() => !document.querySelector('.message').textContent && document.querySelector('.readout')?.dataset.of === 'all', null, { timeout: 30000 })
  // every run asked answered: none left to arrive late
  await settled()
  assert.equal(await page.locator('.source').innerText(), 'chime.wav')
  assert.equal(await lengthText(), '0:08.000')
})

// The page holds no library of its own: it plays through deck.js (its AudioContext, the library's playback on it), the
// library running in the workers alone, the deck's (voices.js) as playback needs it, not the engine's whole; a deck's
// worker that fails to load plays through the engine's
for (const failing of [false, true]) test(`editor: the page plays through deck.js alone, no library of its own, ${failing ? 'a deck that fails through the engine' : 'the deck a worker of its own'}`, async () => {
  const asked = []
  page.on('request', r => asked.push(new URL(r.url()).pathname))
  if (failing) await page.route('**/playground/dist/voices.js', route => route.abort())
  // what each worker answers, by its script
  await page.addInitScript(() => { const W = Worker; window.answers = []; window.Worker = class extends W { constructor(url, o) { super(url, o); this.addEventListener('message', e => answers.push([String(url).split('/').pop(), !!e.data?.inst])) } } })
  await page.route('**/playground/editor.js', async route => { const r = await route.fetch(); route.fulfill({ response: r, body: (await r.text()).replace('v = view(', 'v = globalThis.__view = view(') }) })
  await open()
  await write(`audio.from(t => Math.sin(2 * Math.PI * 220 * t) * .3, { duration: 20 })`)
  await lengthIs('0:20.000')
  await page.locator('.plot').focus()
  await page.keyboard.press('Space')
  await page.waitForFunction(() => __view.playhead > .5)
  assert.ok(asked.includes('/deck.js') && asked.includes('/playground/dist/voices.js'), 'deck.js and the deck\'s worker')
  const voiced = await page.evaluate(() => answers.filter(([, inst]) => inst).map(([from]) => from))
  assert.equal(voiced[0], failing ? 'worker.js' : 'voices.js', 'the voice made where it plays')
  assert.deepEqual(asked.filter(p => p === '/assets/audio.js' || p === '/audio.js' || p === '/core.js'), [], 'no library on the page')
})

// What plays is rendered by the engine, as it plays (player.js, worker.js voice): the page's own thread held up three
// seconds, longer than the library renders ahead of the speakers (fn/play.js AHEAD), leaves no gap in it. The speakers' feed taken on the audio thread (taken), past the page's
// An output longer than the page holds (over 30 channel-minutes) is drawn from its picture: the waveform from its peaks,
// the spectrogram from its spectra, the whole of it at once, the page's own memory a fraction of its samples; zoomed in,
// its samples come and the line runs through them, those far behind let go as the view moves on; it plays from the
// engine; a selection's levels read from its leaves
test('editor: a sound longer than the page holds is drawn from its peaks and spectra, its samples where it is zoomed in, and plays', async () => {
  await open()
  // the page's memory as the engine counts it, its arrays' storage too
  const cdp = await page.context().newCDPSession(page)
  const heap = () => cdp.send('Runtime.getHeapUsage').then(u => u.usedSize + (u.backingStorageSize ?? 0))
  await write(`audio.from(t => Math.sin(2 * Math.PI * 220 * t) * (.25 + .2 * Math.sin(t / 40)), { duration: 1820, sampleRate: 48000 })`)
  await page.waitForFunction(() => (e => e.title || e.dataset.tip || '')(document.querySelector('.source')).endsWith('30:20.000'), null, { timeout: 120000 })
  await page.waitForFunction(() => !document.querySelector('.message').textContent, null, { timeout: 120000 })
  await cdp.send('HeapProfiler.collectGarbage')
  const used = await heap()
  assert.ok(used < 150e6, `the page holds ${(used / 1e6).toFixed(0)} MB, its samples would be ${(1820 * 48000 * 4 / 1e6).toFixed(0)}`)
  assert.ok(await drawn() > .02, 'all of it drawn from its peaks')
  // the overview of all of it, from its leaves: ink all along it
  await settings('Scroll', 'Overview')
  const w0 = (await page.locator('.plot').boundingBox()).width
  assert.ok(await pixels(`let n = 0; for (let x = 0; x < w * .9; x++) for (let y = h - 26; y < h - 4; y++) { const i = (y * w + x) * 4; if (d[i] > 60) n++ } return n`) > w0 * 2, 'the overview drawn from its leaves')
  await settings('Scroll', 'Bar')
  // the spectrogram of all of it, from its spectra: the tone a bright row, at 220 Hz
  await show('spec')
  await poll(() => page.locator('.plot canvas.spectrum').screenshot().then(png => page.evaluate(async b64 => {
    const img = new Image()
    img.src = 'data:image/png;base64,' + b64
    await img.decode()
    const c = Object.assign(document.createElement('canvas'), { width: img.width, height: img.height }), g = c.getContext('2d')
    g.drawImage(img, 0, 0)
    const d = g.getImageData(0, 0, c.width - 60, c.height - 30).data, w = c.width - 60, lit = []
    // each row's share of bright pixels, across the lane
    for (let y = 0; y < c.height - 30; y++) { let n = 0; for (let x = 0; x < w; x++) if (d[(y * w + x) * 4] > 100) n++; lit.push(n / w) }
    return lit
  }, png.toString('base64'))), rows => assert.ok(rows.filter(v => v > .9).length >= 1 && rows.filter(v => v > .9).length < rows.length / 10, `a row lit across: ${rows.filter(v => v > .9).length} of ${rows.length}`))
  // zoomed in to two minutes and scrolled across a quarter of it: its samples come where it is, those far behind let go,
  // the page's memory bounded (the samples of where it went would be 8 × 2 minutes, twice: waveform and spectrogram)
  const plotBox = await page.locator('.plot').boundingBox()
  await page.mouse.move(plotBox.x + plotBox.width / 2, plotBox.y + plotBox.height / 2)
  await page.locator('.plot').focus()
  for (let i = 0; i < 4; i++) await page.keyboard.press('=')
  // a while at each place: its samples come as the view rests there, those far behind let go
  for (let i = 0; i < 8; i++) { await page.mouse.wheel(plotBox.width, 0); await page.waitForTimeout(700) }
  await cdp.send('HeapProfiler.collectGarbage')
  const after = await heap()
  assert.ok(after < used + 200e6, `having gone across, the page holds ${(after / 1e6).toFixed(0)} MB, ${(used / 1e6).toFixed(0)} before`)
  await page.keyboard.press('0')
  await show('wave')
  // zoomed in on the caret, 20 ms or so across, under a sample a pixel: the samples come, the line through them (the
  // peaks alone draw nothing there)
  const { box } = await axis(1820)
  await page.mouse.click(box.x + box.width / 2, box.y + tall(box) * .3)
  await page.locator('.plot').focus()
  for (let i = 0; i < 17; i++) await page.keyboard.press('=')
  // columns with ink off the silence line: the sine's, a twentieth of full scale either side; without its samples, at
  // most a line across (the caret's). The samples come from the engine as the view zooms in: waited for, as long as a
  // shared runner takes (1.5 s held locally, not there)
  const ink = () => page.locator('.plot canvas.waveform').screenshot().then(png => page.evaluate(async b64 => {
    const img = new Image()
    img.src = 'data:image/png;base64,' + b64
    await img.decode()
    const c = Object.assign(document.createElement('canvas'), { width: img.width, height: img.height }), g = c.getContext('2d')
    g.drawImage(img, 0, 0)
    const d = g.getImageData(0, 0, c.width, c.height).data, mid = c.height / 2, columns = new Set()
    // within 40 px of the silence line, clear of the labels at the foot and the right
    for (let i = 0; i < d.length; i += 4) { const y = Math.floor(i / 4 / c.width), x = i / 4 % c.width; if (d[i] > 120 && Math.abs(y - mid) > 6 && Math.abs(y - mid) < 40 && x < c.width - 60) columns.add(x) }
    return columns.size
  }, png.toString('base64')))
  await poll(ink, off => assert.ok(off > 200, `zoomed in: the line through its samples, ${off} columns off the axis`), 15000)
  // it plays, from the engine
  await page.keyboard.press('Space')
  await page.getByRole('button', { name: 'Pause' }).waitFor()
  // the clock runs once the engine's first render reaches the deck: within 600 ms here, longer on a shared runner
  const t0 = await page.locator('.time').innerText()
  await page.waitForFunction(t => document.querySelector('.time').innerText !== t, t0, { timeout: 10000 }).catch(() => {})
  assert.notEqual(await page.locator('.time').innerText(), t0, 'the clock runs')
  await page.getByRole('button', { name: 'Pause' }).click()
  // a selection's levels, from its leaves
  await page.keyboard.press('Shift+ArrowRight')
  await page.locator('.readout[data-of="selection"]').waitFor()
  assert.match(await levelsTable(), /^\S+–\S+\nPeak −\d+\.\ddBFS at \S+\nRMS −\d+\.\ddBFS\nCrest \d+\.\ddB$/)
})

test('editor: an error is said once, beside the time and at its line; the last output stays', async () => {
  await open()
  await write(`audio('chime.wav').gain(`)
  // said once, beside the time, in place of the output's figures; the output stays
  await page.locator('.message.problem', { hasText: 'Syntax error on line 1' }).waitFor()
  const box = await page.locator('.plot').boundingBox()
  assert.ok(await drawn() > .05 * tall(box) / (box.height - 22), 'the last output still drawn')
  await write(`let a = audio('chime.wav')\na.nope()`)
  await page.locator('.message.problem', { hasText: /nope.*line 2/ }).waitFor()
  await tab('Code')
  await page.locator('.cm-lintRange-error').first().waitFor()
  assert.equal(await page.locator('.console .line.error').count(), 0, 'not again in the console')
  // a file the page doesn't have (a script kept from before a reload) is named once, and the view invites a drop
  await write(`audio('missing.wav').trim()`)
  await page.locator('.message.problem', { hasText: /^missing\.wav is not open here: open it, or drop it on the page$/ }).waitFor()
  await page.getByRole('button', { name: 'Open it…' }).waitFor()
  // the script is kept 500 ms after its last change
  await page.waitForFunction(() => { const s = JSON.parse(localStorage.getItem('audio-repl')); return s.docs[s.doc].code === "audio('missing.wav').trim()" })
  await page.reload()
  await page.locator('.message.problem', { hasText: 'missing.wav is not open' }).waitFor()
  assert.equal(await page.locator('.source').innerText(), 'missing.wav')
  assert.match(await page.locator('.empty').innerText(), /^Drop audio here/)
  // the fix clears it and the figures return
  await write(`audio('chime.wav')`)
  await wholeLevels().waitFor()
  assert.equal(await page.locator('.message.problem').count(), 0)
})

// An edit's output takes the picture in one step, all that is drawn of it ready: weighted (K), never a picture drawn
// from its samples with the last output's levels as heard, the edit drawn ahead holding till they come (a delete once
// flashed the old waveform for a frame, its new samples in before their levels)
test('editor: weighted, an edit\'s output comes in one step, never a frame of the last one\'s levels', async () => {
  await page.route('**/playground/view/render.js', async route => { const r = await route.fetch(); route.fulfill({ response: r, body: (await r.text()).replace('function draw() {\n', 'function draw() {\n  globalThis.__draws?.push({ ahead: !!pieces, stale: twinOf.size > 0 && twinsOf !== heardOf })\n') }) })
  // the levels as heard withheld at will (`__deaf`), as when the worker has none to give; those given counted (`__weighed`)
  await page.route('**/playground/editor.js', async route => { const r = await route.fetch(); route.fulfill({ response: r, body: (await r.text()).replace('onheard: weighting => output && !incoming ? eng.heard(output.id, weighting) : null', 'onheard: weighting => !globalThis.__deaf && output && !incoming ? eng.heard(output.id, weighting).then(l => (globalThis.__weighed = (globalThis.__weighed ?? 0) + 1, l)) : null') }) })
  const { x, y } = await chime()
  await settings('Weighting', 'K-weighted')
  await page.waitForFunction(() => globalThis.__weighed)
  await settled()
  await drag([x(2), y], [x(3) - x(2), 0])
  const weighed = await page.evaluate(() => { globalThis.__draws = []; return globalThis.__weighed })
  await page.keyboard.press('Delete')
  await page.waitForFunction(() => /\.remove\(/.test(scriptText()))
  await lengthIs('0:07.000')
  // its output's levels as heard come, and drawn
  await page.waitForFunction(n => globalThis.__weighed > n, weighed)
  await settled()
  const draws = await page.evaluate(() => globalThis.__draws)
  assert.ok(draws.some(d => d.ahead) && draws.some(d => !d.ahead), `drawn ahead, then its output: ${JSON.stringify(draws)}`)
  assert.deepEqual(draws.filter(d => d.stale), [], 'no picture of its samples with the last one\'s levels')
  // none to be had for the next, as long as it (a level over a stretch): its samples drawn as they are, the last one's
  // levels gone, never over them
  await page.evaluate(() => { globalThis.__deaf = true; globalThis.__draws = [] })
  await write(`${await code()}\n  .gain(-12, { at: 4, d: 1 })`)
  await page.waitForFunction(() => globalThis.__draws.length > 1)
  await settled()
  assert.deepEqual((await page.evaluate(() => globalThis.__draws)).filter(d => d.stale), [], 'none withheld: no picture with the last one\'s levels')
})

// Stopped while an edit renders, the worker keeps what it made: the edit undone, the picture and the script agree, and
// the caret steps by the cues as before
test('editor: Stop while an edit renders undoes it, the caret still stepping by the cues', async () => {
  await open()
  await write(bursts)
  await lengthIs('0:02.500')
  await write(`${bursts}.repeat(40).stretch(0.5)`)
  await page.locator('.message', { hasText: /^Applying .*stretch \d+%$/ }).waitFor()
  await page.getByRole('button', { name: 'Stop', exact: true }).click()
  await page.locator('.message', { hasText: /^Stopped: .+ undone/ }).waitFor()
  assert.equal(await page.evaluate(() => scriptText()), bursts)
  await lengthIs('0:02.500')
  const { box, x } = await axis(2.5), step = async () => { await page.keyboard.press(process.platform === 'darwin' ? 'Alt+ArrowRight' : 'Control+ArrowRight'); return +(await page.locator('.time').innerText()).split(':')[1] }
  await page.mouse.click(x(.1), box.y + tall(box) / 3)
  let at = 0
  for (const until = Date.now() + 5000; !(Math.abs(at - .4) < .03) && Date.now() < until; await page.waitForTimeout(200)) { await page.mouse.click(x(.1), box.y + tall(box) / 3); at = await step() }
  assert.ok(Math.abs(at - .4) < .03, `to the next cue: ${at}`)
  assert.ok(Math.abs(await step() - .5) < .03, 'and the one after')
})

// An edit made while a step holds the worker in one pass over its input (decrackle's, 20 s of it here) is not kept
// waiting for it: the worker is replaced, and the new script's output comes in a second or so
test('editor: an edit made while a step holds the engine takes over at once', async () => {
  await open()
  await write(`audio('chime.wav').repeat(20).decrackle()`)
  await page.locator('.message', { hasText: /decrackle [1-9]/ }).waitFor({ timeout: 20000 })
  const t0 = Date.now()
  await write(`audio('chime.wav').gain(-3)`)
  await page.waitForFunction(() => !document.querySelector('.message').textContent && document.querySelector('.readout')?.dataset.of === 'all', null, { timeout: 10000 })
  assert.ok(Date.now() - t0 < 5000, `${Date.now() - t0} ms`)
  await lengthIs('0:08.000')
  // Stopped there, the worker is replaced too: the edit undone, the output shown made again in the new one, the caret
  // stepping by its cues (the chime's fourth strike, 1.81 s, after 1.5 s)
  await write(`audio('chime.wav').gain(-3).repeat(20).decrackle()`)
  await page.locator('.message', { hasText: /decrackle [1-9]/ }).waitFor({ timeout: 20000 })
  await page.getByRole('button', { name: 'Stop', exact: true }).click()
  await page.locator('.message', { hasText: /^Stopped: .+ undone/ }).waitFor()
  assert.equal(await page.evaluate(() => scriptText()), `audio('chime.wav').gain(-3)`)
  const { box, x } = await axis(8), step = async () => { await page.keyboard.press(process.platform === 'darwin' ? 'Alt+ArrowRight' : 'Control+ArrowRight'); return +(await page.locator('.time').innerText()).split(':')[1] }
  let at = 0
  for (const until = Date.now() + 8000; !(at > 1.5 && at < 2.5) && Date.now() < until; await page.waitForTimeout(200)) { await page.mouse.click(x(1.5), box.y + box.height / 3); at = await step() }
  assert.ok(at > 1.5 && at < 2.5, `to the next cue: ${at}`)
})

// What goes wrong when the script runs shows over the picture, once, as well as beside the time
test('editor: an error the script meets shows over the picture, once', async () => {
  await open()
  await write(`audio('chime.wav').crossfade()`)
  await page.locator('.message.problem', { hasText: 'crossfade: expected a source to blend into' }).waitFor()
  await page.locator('.message.problem', { hasText: 'crossfade: expected a source' }).waitFor()
})

// Zoomed out past the whole: the sound starts at the left edge, the room on its right; the time row is marked
// An edit that takes a while arrives as it renders, in place of the output shown: the view keeps where it was zoomed to
// (it once showed the whole again, an output of no length said yet read as a new sound)
test('editor: an output rendering in place of the one shown keeps the zoom, the selection and the caret', async () => {
  await open()
  await noCues()
  await write(`audio('chime.wav')`)
  await lengthIs('0:08.000')
  const { box, x } = await axis(8), y = box.y + tall(box) * .3
  await page.mouse.click(x(4), y)
  await page.locator('.plot').focus()
  for (let i = 0; i < 2; i++) await page.keyboard.press('=')
  await frames()
  // the time at the view's left edge, from a click there
  const left = async () => { await page.mouse.click(box.x + 1, y); return (await page.locator('.time').innerText()).split(':').reduce((m, s) => m * 60 + +s, 0) }
  const before = await left()
  assert.ok(before > 2 && before < 4, `zoomed in about the caret: the view from ${before}`)
  await write(`audio('chime.wav').pitch(3)`)
  await page.waitForFunction(() => !document.querySelector('.message').textContent && (e => e.title || e.dataset.tip || '')(document.querySelector('.source')).endsWith('0:08.000'), null, { timeout: 30000 })
  await settled()
  assert.ok(Math.abs(await left() - before) < .01, 'the view where it was')
  // zoomed in while a sound still arrives, it stays zoomed in once the sound is whole (it went back to all of it)
  await write(`audio('${origin}/slow/test/fixture.wav')`)
  await page.locator('.message', { hasText: /^Decoding/ }).waitFor()
  await page.locator('.plot').focus()
  for (let i = 0; i < 2; i++) await page.keyboard.press('=')
  await page.waitForFunction(() => !document.querySelector('.message').textContent && (e => e.title || e.dataset.tip || '')(document.querySelector('.source')).endsWith('0:02.000'), null, { timeout: 30000 })
  await settled()
  assert.ok(await left() > .2, 'still zoomed in')
})

// The page comes up once, whole. The paper and the slabs are in the first paint; everything in them — the menus, the
// tabs, the script, the picture where the sound was left — waits out of sight until it is all laid out (data-boot),
// then comes up together, so nothing is laid out twice and nothing jumps. After that the lanes keep their end (the
// meters hold their room whether they read anything yet or not), and the sound only ever rises into the picture: never
// drawn, taken away and drawn again.
test('editor: the page comes up once, whole, and the sound only rises into it', async () => {
  await open()
  await show('spec')
  await wholeLevels().waitFor()
  await settled()
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('audio-repl')).display === 'spec')
  // every frame of the next load, from before its own scripts run
  await page.addInitScript(() => {
    window.__boot = []
    const tick = () => {
      const app = document.querySelector('#app'), plot = document.querySelector('.plot'), spec = plot?.querySelector('canvas.spectrum')
      if (app?.querySelector('.menubar')) window.__boot.push({
        boot: app.hasAttribute('data-boot'),
        menu: getComputedStyle(app.querySelector('.menubar')).opacity,
        light: spec ? +(spec.style.opacity || 0) : null,
        over: spec ? +(plot.querySelector('canvas.overlay').style.opacity || 0) : null,
        end: plot ? getComputedStyle(plot).getPropertyValue('--end').trim() : null,
        undo: Math.round(app.querySelector('.status .undo').getBoundingClientRect().x)
      })
      requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  })
  await page.reload()
  await wholeLevels().waitFor()
  await settled()
  await still()
  const seen = await page.evaluate(() => window.__boot)
  // every frame seen, said in full when one of these fails: how it came up
  const told = JSON.stringify(seen.map(f => [+f.boot, f.menu, f.light, f.over, f.end, f.undo].join(' ')))
  assert.ok(seen.some(f => f.boot), `the page waits to be wired: ${told}`)
  assert.ok(seen.every(f => !f.boot || f.menu === '0'), `nothing of it shows until it is: ${told}`)
  assert.ok(!seen.at(-1).boot && seen.at(-1).menu === '1', `and then all of it does: ${told}`)
  const light = seen.map(f => f.light).filter(v => v != null)
  assert.ok(light.every((v, i) => !i || v >= light[i - 1]), `the picture only brightens: ${[...new Set(light)]}`)
  assert.equal(light.at(-1), 1, 'full once the output is there')
  assert.ok(seen.every(f => f.light == null || f.light > 0 || !f.over), `no empty lanes, no axes, waiting for the sound: they come with it: ${told}`)
  const ends = new Set(seen.filter(f => !f.boot).map(f => f.end))
  assert.equal(ends.size, 1, `the lanes keep their end: ${[...ends]}`)
  const heads = new Set(seen.filter(f => !f.boot).map(f => f.undo))
  assert.equal(heads.size, 1, `undo stays where it is as the sound comes: ${[...heads]}`)
})

// An edit made on the picture is drawn at once, and its output takes the picture's place without a move: zoomed in near
// the end, a delete that shortens the sound leaves the view where it was, not scrolled back; showing all of it, a
// delete keeps the scale, the room at the end where the sound went. Only a new file shows all of itself.
test('editor: an edit on the picture keeps the view where it is, at its scale, as its output comes', async () => {
  await open()
  await noCues()
  await write(`audio('chime.wav')`)
  await lengthIs('0:08.000')
  const { box, x } = await axis(8), y = box.y + tall(box) * .3
  // the time at a pixel, from a click there (the caret's)
  const at = async px => { await page.mouse.click(px, y); return (await page.locator('.time').innerText()).split(':').reduce((m, s) => m * 60 + +s, 0) }
  await drag([x(1), y], [x(2) - x(1), 0])
  await page.keyboard.press('Delete')
  await lengthIs('0:07.000')
  await settled()
  assert.equal(await at(x(4)), 4, 'the scale kept: 4 s where it was')
  await page.keyboard.press('ControlOrMeta+Z')
  await lengthIs('0:08.000')
  await page.locator('.plot').focus()
  await page.keyboard.press('0')
  // zoomed in on the last seconds: a delete before them leaves the view where it was
  await page.mouse.click(x(7.2), y)
  for (let i = 0; i < 2; i++) await page.keyboard.press('=')
  await frames()
  const left = await at(box.x + 1)
  assert.ok(left > 5, `zoomed in near the end: from ${left}`)
  // the sound shorter by what goes: the view stays past its end
  await drag([box.x + 20, y], [100, 0])
  await page.keyboard.press('Delete')
  await page.waitForFunction(() => /\.remove\(/.test(scriptText()))
  await page.waitForFunction(() => !document.querySelector('.message').textContent)
  await settled()
  assert.ok(Math.abs(await at(box.x + 1) - left) < .01, 'the view where it was')
})

// An action on how the sound is seen or heard renders nothing: muting, soloing or renaming a track mixes again what is
// kept (a run, no track's block made again: the mix, for the levels and the export); the window resized, the
// spectrogram shown, a theme, a tab shown again run nothing at all. Each track's step counts its blocks in the worker
// (`tick`, over a BroadcastChannel), the runs the page asks counted as they are sent
test('editor: a mute, a solo, a rename, a resize, the spectrogram, a theme or a tab shown renders nothing', async () => {
  await page.addInitScript(() => {
    globalThis.__runs = 0
    globalThis.__ticks = 0
    new BroadcastChannel('ticks').onmessage = () => __ticks++
    const post = Worker.prototype.postMessage
    Worker.prototype.postMessage = function (m, t) { if (m?.type === 'run') __runs++; return post.call(this, m, t) }
  })
  await open()
  await noCues()
  await write(`audio.op('tick', { process: (input, output) => { (globalThis.ticked ??= new BroadcastChannel('ticks')).postMessage(1); input.forEach((x, c) => output[c].set(x)) } })

let a = audio('chime.wav').tick()

let b = audio('rhodes.wav').tick()`)
  await page.locator('.layer').nth(1).waitFor({ state: 'attached' })
  await settled()
  assert.ok(await page.evaluate(() => __ticks) > 0, 'the tracks rendered, counted')
  // what an action asked of the engine, once the page has settled after it
  const after = async act => {
    await settled()
    await page.evaluate(() => { __runs = 0; __ticks = 0 })
    await act()
    await settled()
    return page.evaluate(() => ({ runs: __runs, ticks: __ticks }))
  }
  for (const [name, act] of [
    ['mute', () => page.getByRole('button', { name: 'Mute b' }).click()],
    ['unmute', () => page.getByRole('button', { name: 'Mute b' }).click()],
    ['solo', () => page.getByRole('button', { name: 'Mute a' }).click({ modifiers: ['Alt'] })],
    ['unsolo', () => page.getByRole('button', { name: 'Mute a' }).click({ modifiers: ['Alt'] })],
    ['rename', async () => { await page.locator('.layer-name', { hasText: /^b$/ }).click(); await page.keyboard.type('bed'); await page.keyboard.press('Enter'); await page.waitForFunction(() => /\nlet bed = /.test(scriptText())) }]
  ]) {
    const { runs, ticks } = await after(act)
    assert.ok(runs <= 1 && ticks === 0, `${name}: ${runs} runs, ${ticks} blocks made again`)
  }
  for (const [name, act] of [
    ['resize', () => page.setViewportSize({ width: 1000, height: 700 })],
    ['spectrogram', () => show('spec')],
    ['waveform', () => show('wave')],
    ['theme', () => menu('View', 'Theme', 'Light+')],
    ['new tab', () => page.getByRole('button', { name: 'New tab' }).click()],
    ['tab shown again', () => page.locator('.file [role="tab"]').first().click()],
    ['the other again', () => page.locator('.file [role="tab"]').last().click()]
  ]) assert.deepEqual(await after(act), { runs: 0, ticks: 0 }, `${name}: nothing run`)
})
