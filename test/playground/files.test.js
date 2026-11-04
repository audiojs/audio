// Files: opened, dropped, arriving, kept, found, exported, checked; the server, the page and the helpers in page.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import audio from '../../audio.js'
import { root, page, origin, sine, peakDb, wavBytes, code, tipOf, wholeLevels, seconds, open, poll, settings, tab, menu, noCues, write, drawn, TRACK, ROOM, gutter, axis, drag, lengthIs, pixels, show, keptFiles, chime } from './page.js'

// The check (fn/check.js) of the result beside the file as it opened. Apple Podcasts: -16 LKFS ±1, true peak ≤ -1 dBFS
// (podcasters.apple.com/support/893). The default script peaks at -1 dBFS: its true peak sits above, and it is loud.
// The check, in the panel's Export tab: each rule, the result, the limit
test('editor: a delivery check shows each rule for the result, and follows the script', async () => {
  await open()
  await tab('Export')
  // the check, folded while no spec is chosen
  await page.locator('.export summary', { hasText: /^Check/ }).click()
  await page.locator('.export').getByRole('button', { name: 'Apple Podcasts' }).click()
  await page.locator('.check-table:not(.stale)').waitFor()
  const rows = async () => (await page.locator('.check-table tbody tr').allInnerTexts()).map(r => r.split('\t').map(c => c.trim()))
  assert.deepEqual(await page.locator('.check-table thead th').allInnerTexts(), ['Rule', 'After', 'Limit'])
  let [loud, peak] = await rows()
  assert.equal(loud[0], 'Loudness')
  assert.match(loud[1], /^✗ −1[0-4]\.\d\d$/, 'normalized to its peak, the result is too loud')
  assert.equal(loud[2], '−17 to −15LUFS')
  assert.match(peak[1], /^✗ −0\.9\d$/, 'true peak over a -1 dBFS sample peak')
  await tab('Code')
  await write(`audio('chime.wav').normalize('podcast')`)
  await tab('Export')
  await page.waitForFunction(() => document.querySelector('.check-table:not(.stale) tbody tr td')?.textContent.includes('✓'))
  ;[loud, peak] = await rows()
  assert.equal(loud[1], '✓ −16.00')
  assert.match(peak[1], /^✓ −/)
  // the format there is the one Export takes
  await page.locator('.export').getByRole('button', { name: 'FLAC' }).click()
  assert.equal(await page.locator('.export-button').innerText(), 'Export FLAC')
  await page.locator('.export').getByRole('button', { name: 'Off' }).click()
  await page.locator('.check-table').waitFor({ state: 'detached' })
})

test('editor: a recipe made for a delivery spec checks the output against it', async () => {
  await open()
  await menu('Process', 'Recipes', 'Podcast episode')
  await tab('Export')
  assert.equal(await page.locator('.export').getByRole('button', { name: 'Apple Podcasts' }).getAttribute('aria-pressed'), 'true')
  await page.waitForFunction(() => { const r = [...document.querySelectorAll('.check-table:not(.stale) tbody td:nth-of-type(1)')]; return r.length && r.every(td => !td.textContent.includes('✗')) }, null, { timeout: 30000 })
  assert.match(await code(), /\.normalize\('podcast'\)$/)
})

// The export's rows of choices each on one line, every label whole, at the panel's narrowest as at its default: a field's
// choices under its name when they want the row; nothing past the panel's edge
test('editor: the export\'s choices keep to one row each, labels whole, the panel wide or narrow', async () => {
  await open()
  await tab('Export')
  await page.locator('.export summary', { hasText: 'Edit list' }).click()
  await page.locator('.export summary', { hasText: 'Check' }).click()
  for (const format of ['MP3', 'OGG', 'WAV']) {
    await page.locator('.export').getByRole('button', { name: format, exact: true }).click()
    for (const px of [440, 280]) {
      await page.evaluate(px => document.querySelector('.panes').style.setProperty('--panel', px + 'px'), px)
      const r = await page.locator('.export').evaluate(e => ({
        over: e.scrollWidth - e.clientWidth,
        rows: [...e.querySelectorAll('.choices')].filter(c => c.offsetParent).map(c => ({ name: c.getAttribute('aria-label'), lines: new Set([...c.children].map(b => b.offsetTop)).size, cut: [...c.children].filter(b => b.scrollWidth > b.clientWidth + 1).map(b => b.textContent) }))
      }))
      assert.equal(r.over, 0, `${format} at ${px}px: nothing past the edge`)
      for (const row of r.rows) assert.ok(row.lines === 1 && !row.cut.length, `${format} at ${px}px, ${row.name}: ${row.lines} lines, cut ${row.cut}`)
    }
  }
})

// A file dropped where nothing plays opens it; held over the waveform it shows where it goes in, a caret of its own,
// and dropped there it goes in at that time, its seams crossfaded; over the tabs it opens in a tab of its own
test('editor: a file opens where nothing plays, goes in where its caret shows over the waveform, or into a tab of its own', async () => {
  await open()
  const bytes = await wavBytes([sine(.5, 440, .5)])
  const hold = (selector, name, x, kinds = ['dragover', 'drop']) => page.evaluate(({ selector, name, bytes, x, kinds }) => {
    const target = document.querySelector(selector), rect = target.getBoundingClientRect(), data = new DataTransfer()
    data.items.add(new File([new Uint8Array(bytes)], name, { type: 'audio/wav' }))
    const at = { bubbles: true, cancelable: true, dataTransfer: data, clientX: x ?? rect.left + 40, clientY: rect.top + 40 }
    for (const kind of kinds) target.dispatchEvent(new DragEvent(kind, at))
  }, { selector, name, bytes: [...bytes], x, kinds })
  await write('')
  await hold('.view', 'tone.wav')
  await page.waitForFunction(() => scriptText() === "audio('tone.wav')")
  await lengthIs('0:00.500')
  // held over the middle: the caret where it would go in, the accent's colour, a line down the lanes
  const { x } = await axis(.5)
  await hold('.plot', 'tone.wav', x(.25), ['dragover'])
  const lit = await pixels(`const out = []; for (let x = 0; x < w; x++) { const i = (80 * w + x) * 4; if (d[i] - d[i + 2] > 60) out.push(x) } return out`)
  const box = await page.locator('.plot').boundingBox()
  assert.ok(lit.length && lit.every(px => Math.abs(px - (x(.25) - box.x)) < 3), JSON.stringify(lit))
  await hold('.plot', 'tone.wav', x(.25), ['drop'])
  await page.waitForFunction(() => scriptText() === "audio('tone.wav')\n  .insert(audio('tone-2.wav'), { at: 0.25, xfade: 0.01 })")
  await lengthIs('0:01.000')
  // over the tabs: a tab of its own
  const tabs = await page.locator('.files .file').count()
  await hold('.files', 'tone.wav')
  await page.waitForFunction(n => document.querySelectorAll('.files .file').length === n + 1, tabs)
  await page.waitForFunction(() => scriptText() === "audio('tone-3.wav')")
})

// Several files dropped at once open together, a track each in one tab, the first edited; exported, a file each. Over
// the tabs, a tab each
test('editor: several files dropped open as tracks of one tab, exported a file each; over the tabs, a tab each', async () => {
  await open()
  const bytes = [await wavBytes([sine(.5, 440, .5)]), await wavBytes([sine(.75, 220, .5)])]
  const hold = (selector, names) => page.evaluate(({ selector, names, bytes }) => {
    const target = document.querySelector(selector), rect = target.getBoundingClientRect(), data = new DataTransfer()
    names.forEach((name, i) => data.items.add(new File([new Uint8Array(bytes[i])], name, { type: 'audio/wav' })))
    const at = { bubbles: true, cancelable: true, dataTransfer: data, clientX: rect.left + 40, clientY: rect.top + 10 }
    for (const kind of ['dragover', 'drop']) target.dispatchEvent(new DragEvent(kind, at))
  }, { selector, names, bytes: bytes.map(b => [...b]) })
  await write('')
  await hold('.view', ['low.wav', 'high.wav'])
  await page.waitForFunction(() => scriptText() === "let low = audio('low.wav')\n\nlet high = audio('high.wav')")
  await page.waitForFunction(() => document.querySelector('.plot').dataset.tracks === '2')
  await page.waitForFunction(() => document.querySelector('.steps-list .step-name')?.textContent === 'low · low.wav')
  await lengthIs('0:00.750')
  const files = []
  page.on('download', d => files.push(d))
  await menu('File', 'Export as', 'Each track')
  while (files.length < 2) await new Promise(r => setTimeout(r, 50))
  assert.deepEqual(files.map(d => d.suggestedFilename().replace(/^.*-/, '')), ['low.wav', 'high.wav'])
  const lengths = []
  for (const d of files) { const a = await audio(await readFile(await d.path())); await a.read(); lengths.push(+a.duration.toFixed(3)) }
  assert.deepEqual(lengths, [.5, .75], 'each track alone')
  // over the tabs: a tab each
  const tabs = await page.locator('.files .file').count()
  await hold('.files', ['low.wav', 'high.wav'])
  await page.waitForFunction(n => document.querySelectorAll('.files .file').length === n + 2, tabs)
  await page.waitForFunction(() => scriptText() === "audio('high-2.wav')")
  // picked together (Open file…): a track each, as dropped
  await page.setInputFiles('.file-input', [{ name: 'low.wav', mimeType: 'audio/wav', buffer: bytes[0] }, { name: 'high.wav', mimeType: 'audio/wav', buffer: bytes[1] }])
  await page.waitForFunction(() => scriptText() === "let low3 = audio('low-3.wav')\n\nlet high3 = audio('high-3.wav')")
  await page.waitForFunction(() => document.querySelector('.plot').dataset.tracks === '2')
})

test('editor: a file dropped on the waveform of a generated sound goes in where it is dropped', async () => {
  await open()
  await write(`audio.from(0.5)`)
  await page.waitForFunction(() => (e => e.title || e.dataset.tip || '')(document.querySelector('.source')).split(' · ').pop() === '0:00.500')
  const bytes = await wavBytes([sine(.5, 440, .5)]), { x } = await axis(.5)
  await page.evaluate(({ bytes, x }) => {
    const target = document.querySelector('.plot'), rect = target.getBoundingClientRect(), data = new DataTransfer()
    data.items.add(new File([new Uint8Array(bytes)], 'tone.wav', { type: 'audio/wav' }))
    const at = { bubbles: true, cancelable: true, dataTransfer: data, clientX: x, clientY: rect.top + 40 }
    target.dispatchEvent(new DragEvent('dragover', at))
    target.dispatchEvent(new DragEvent('drop', at))
  }, { bytes: [...bytes], x: x(.5) })
  await page.waitForFunction(() => scriptText() === "audio.from(0.5)\n  .insert(audio('tone.wav'), { at: 0.5, xfade: 0.01 })")
  await page.waitForFunction(() => (e => e.title || e.dataset.tip || '')(document.querySelector('.source')).split(' · ').pop() === '0:01.000')
})

test('editor: export downloads the output, encoded', async () => {
  await open()
  const length = await seconds()
  const waiting = page.waitForEvent('download')
  await tab('Export')
  await page.locator('.export-button').click()
  const download = await waiting
  assert.equal(download.suggestedFilename(), 'chime-edited.wav')
  const pcm = await audio(await readFile(await download.path())).read()
  assert.ok(Math.abs(pcm[0].length / 44100 - length) < .001)
  assert.ok(Math.abs(peakDb(pcm) + 1) < .05, `peak ${peakDb(pcm)}`)
})

test('editor: a found sound opens in a tab of its own, with its credit', async () => {
  await page.route('https://api.openverse.org/**', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({
    result_count: 1, results: [{ title: 'Door Creak', creator: 'stib', source: 'freesound', duration: 1000, license: 'cc0', license_version: '1.0', foreign_landing_url: 'https://freesound.org/people/stib/sounds/346267', url: origin + '/test/fixture.wav' }]
  }) }))
  await open()
  await menu('File', 'Find a sound…')
  // it searches half a second after the typing stops
  await page.getByRole('searchbox', { name: 'Find a sound' }).fill('door')
  await page.getByRole('button', { name: 'Use' }).click()
  assert.equal(await code(), `// "Door Creak" by stib, CC0 1.0, freesound.org/people/stib/sounds/346267\naudio('${origin}/test/fixture.wav')`)
  await page.locator('.source', { hasText: 'fixture.wav' }).waitFor()
  // the chime's script, as it was, in its tab
  await page.getByRole('tab', { name: 'chime.wav' }).click()
  await page.waitForFunction(() => scriptText().includes('.normalize(-1)'))
})

// ── The tools ──────────────────────────────────────────────────

// A file comes over the network as it arrives: the script runs at once on what has come, the output streams, the
// waveform grows across the time the file's header says it lasts, the readout says how much has come
test('editor: a file over a slow connection shows as it arrives, with how much has come, then is whole', async () => {
  await open()
  await write(`audio('${origin}/slow/test/fixture.wav').gain(-1)`)
  // under 60% of it come: some drawn, not all
  await page.locator('.message', { hasText: /^Decoding [1-5]?\d%$/ }).waitFor()
  // its length not yet known: in its place an ellipsis between the bars, plain, how much has come in its title
  assert.deepEqual(await page.locator('.length').evaluate(e => [e.textContent, getComputedStyle(e).visibility, getComputedStyle(e).backgroundImage, getComputedStyle(e, '::before').content]), ['…', 'visible', 'none', '"|"'])
  assert.match(await page.locator('.length').evaluate(tipOf), /^Length\n[1-5]?\d% here$/)
  // in Record's place, a ring of how much has come, which stops it
  const ring = page.getByRole('button', { name: 'Stop', exact: true })
  assert.ok(await ring.isVisible(), 'the ring in Record\'s place')
  assert.ok(await page.locator('.record').evaluate(e => e.inert), 'Record gives way')
  const arrived = +await ring.evaluate(e => getComputedStyle(e).getPropertyValue('--arrived'))
  assert.ok(arrived > 0 && arrived < .6, `the ring as far as it has come: ${arrived}`)
  const early = await drawn()
  assert.ok(early > 0, 'some of it is drawn before it has all come')
  await page.waitForFunction(() => !document.querySelector('.message').textContent && document.querySelector('.readout')?.dataset.of === 'all', null, { timeout: 20000 })
  assert.ok(await drawn() > early, 'more once it has')
  await lengthIs('0:02.000')
})

// A file arriving with nothing to wait for draws as it decodes, all the way: the file itself, dim, then the output in
// its place from its first piece on, as the engine stops sending the file then (worker.js arriving); what is still to
// come, its length known from its header, the centre line across it to its end
test('editor: a file arriving draws as it decodes, what is still to come a centre line to its end', async () => {
  await open()
  await noCues()
  await write(`audio('${origin}/slow/test/fixture.wav')`)
  await page.locator('.message', { hasText: /^Decoding/ }).waitFor()
  const { box, x } = await axis(2), end = Math.min(x(2), box.x + box.width - (await gutter()) - 50) - box.x
  // CSS px: where the line of how far it has come is (past the caret's), and the share of the columns after it, to the
  // end, that the centre line lights; in its lane, at most TRACK px tall
  const read = () => page.evaluate(([end, most, room]) => {
    const cv = __overlay(), k = cv.width / cv.clientWidth, g = cv.getContext('2d'), h = Math.max(most, cv.clientHeight - 22 - 18 - room)
    const row = y => g.getImageData(0, Math.round(y) * k, cv.width, 1).data, top = row(h * .25), mid = row(h / 2)
    let come = -1
    for (let i = 3 * k; i < cv.width; i++) if (top[4 * i + 3] > 100) { come = i / k; break }
    let lit = 0, n = 0
    for (let i = Math.ceil((come + 3) * k); i < end * k; i++, n++) lit += mid[4 * i + 3] > 0
    return { come, line: n ? lit / n : 1, decoding: /^Decoding/.test(document.querySelector('.message').textContent) }
  }, [end, TRACK, ROOM])
  const early = await read()
  const later = await poll(read, later => {
    assert.ok(early.decoding && later.decoding, 'still decoding')
    assert.ok(early.come > 0 && later.come > early.come + 20, `as it decodes: come to ${early.come} px, then ${later.come}`)
  })
  assert.ok(early.line > .98 && later.line > .98, `the centre line to its end: ${early.line}, ${later.line}`)
  await page.waitForFunction(() => !document.querySelector('.message').textContent, null, { timeout: 20000 })
  const whole = (await read()).come
  assert.ok(whole < 0 || whole >= x(2) - box.x - 1, `whole: no line of how far it has come, the end's rule at most: ${whole}`)
})

// A step reading its input whole first (auto's analysis, its stages) holds the output back, the page reloaded on it: the
// file shows meanwhile as it is, dim, and plays; the status says the step and its stages in words, how long it has taken
// after them, apart, no dots between
test('editor: the file shows while a step reading it whole holds the output, its stages said in words', async () => {
  await open()
  await write(`audio('chime.wav').auto()`)
  await page.locator('.message', { hasText: /^Applying auto/ }).waitFor()
  await page.reload()
  await page.locator('.message-words', { hasText: /^Applying auto: \w/ }).waitFor({ timeout: 10000 })
  assert.ok(await drawn() > 0, 'the file drawn while the output is made')
  assert.equal(await page.locator('.play').isDisabled(), false, 'and plays')
  await page.locator('.message-figure', { hasText: /^ \d+\.\ds$/ }).waitFor()
  const words = await page.locator('.message-words').textContent()
  assert.doesNotMatch(words, /[·…+]/, `in words: ${words}`)
  await page.waitForFunction(() => !document.querySelector('.message').textContent && document.querySelector('.readout')?.dataset.of === 'all', null, { timeout: 60000 })
})

// The ring stops what is on its way, as an editor's Cancel: the script that set it off is undone, the status says so,
// and Record comes back
test('editor: the ring in Record\'s place stops a file still arriving', async () => {
  await open()
  const was = await page.evaluate(() => scriptText())
  await write(`audio('${origin}/slow/test/fixture.wav')`)
  await page.locator('.message', { hasText: /^Decoding/ }).waitFor()
  await page.getByRole('button', { name: 'Stop', exact: true }).click()
  await page.locator('.message', { hasText: /^Stopped: .+ undone, Redo applies it again$/ }).waitFor()
  assert.equal(await page.evaluate(() => scriptText()), was)
  await page.waitForFunction(() => !document.querySelector('.record').inert && document.querySelector('.busy').inert)
})

// A sound that fails to open says so beside the time; choosing another clears that at once, before it has loaded
test('editor: a file that will not open says so, until another sound is chosen', async () => {
  await open()
  await write(`audio('nowhere.wav')`)
  await page.locator('.message.problem', { hasText: 'nowhere.wav is not open' }).waitFor()
  await menu('File', 'Sample or generate', 'handpan.wav')
  assert.equal(await page.locator('.message.problem').count(), 0)
  await wholeLevels().waitFor()
})

// The sound held as it was left, its file gone: the view lets it go and invites a drop, as with nothing kept
test('editor: a view kept for a file no longer here gives way to the drop', async () => {
  await page.addInitScript(() => localStorage.setItem('audio-repl', JSON.stringify({ docs: [{ code: `audio('missing.wav')`, frame: { range: [1, 2], freqs: [0, 1], levels: [-1, 1], duration: 8, rate: 44100, channels: 2 } }] })))
  await page.goto(origin + '/playground/')
  await page.locator('.empty', { hasText: 'Drop audio here' }).waitFor()
  await page.locator('.message.problem', { hasText: 'missing.wav is not open' }).waitFor({ state: 'attached' })
})

// A file arriving shows as the picture shows: on the spectrogram, its spectrogram, dim, as it comes, never a waveform first
test('editor: a file arriving on the spectrogram draws its spectrogram as it comes', async () => {
  await open()
  await show('spec')
  // no grid, which is drawn in the waveform's canvas (view.js paintGrid): what that canvas shows is a waveform's
  await settings('Grid', 'None')
  // an edit that waits for the whole file (normalize): what shows meanwhile is the file itself. Slower than the other
  // slow files (8 KB every 300 ms, 6.6 s in all), so a slow machine's first draw still finds it arriving
  await write(`audio('${origin}/slow/test/fixture.wav?ms=300').normalize()`)
  await page.locator('.message', { hasText: /^Decoding/ }).waitFor()
  const lit = async layer => {
    await page.evaluate(layer => { for (const c of document.querySelectorAll('.plot canvas')) c.style.visibility = c.classList.contains(layer) ? '' : 'hidden' }, layer)
    const n = await pixels(`let n = 0; for (let y = 10; y < h - 30; y++) for (let x = 0; x < w - 60; x++) { const i = (y * w + x) * 4; if (Math.max(d[i], d[i + 1], d[i + 2]) > 40) n++ } return n`)
    await page.evaluate(() => { for (const c of document.querySelectorAll('.plot canvas')) c.style.visibility = '' })
    return n
  }
  await poll(() => lit('spectrum'), spectrum => assert.ok(spectrum > 50, `its spectrogram as it comes: ${spectrum} lit`))
  const waveform = await lit('waveform')
  assert.match(await page.locator('.message').textContent(), /^Decoding/, 'still arriving')
  assert.equal(waveform, 0, 'no waveform')
})

// A file opened here is kept in this browser (its own file system) by the name the script calls it: a reload opens it
// again, nothing asked. One
// the browser no longer has says so, with Open it…, and the file opened there takes its name, the script running again.
test('editor: a file opened is kept for the next visit; one gone asks to be opened again', async () => {
  await open()
  const file = await readFile(resolve(root, 'test/fixture.wav'))
  await page.locator('.file-input').setInputFiles({ name: 'take one.wav', mimeType: 'audio/wav', buffer: file })
  await page.waitForFunction(() => scriptText().includes("audio('take one.wav')"))
  await lengthIs('0:02.000')
  // kept: the file in the browser's files, the script with the page
  await poll(keptFiles, k => assert.ok(k.includes('take one.wav'), `kept: ${k}`))
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('audio-repl')).docs.some(d => d.code.includes("audio('take one.wav')")))
  await page.reload()
  await wholeLevels().waitFor()
  await lengthIs('0:02.000')
  assert.equal(await page.locator('.message.problem').count(), 0)
  // gone from the browser
  await page.evaluate(async () => (await navigator.storage.getDirectory()).removeEntry('audio-repl-files', { recursive: true }))
  await page.reload()
  await page.locator('.message.problem', { hasText: "take one.wav is not open here" }).waitFor()
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.getByRole('button', { name: 'Open it…' }).click()])
  await chooser.setFiles({ name: 'elsewhere.wav', mimeType: 'audio/wav', buffer: file })
  await wholeLevels().waitFor()
  assert.equal(await page.locator('.message.problem').count(), 0)
  assert.match(await code(), /audio\('take one\.wav'\)/)
})

// Search runs as it is typed, half a second after the last key, once
test('editor: sound search runs half a second after the typing stops, once', async () => {
  let asked = []
  await page.route('https://api.openverse.org/**', route => { asked.push(new URL(route.request().url()).searchParams.get('q')); route.fulfill({ contentType: 'application/json', body: JSON.stringify({ result_count: 0, results: [] }) }) })
  await open()
  await menu('File', 'Find a sound…')
  await page.getByRole('searchbox', { name: 'Find a sound' }).pressSequentially('rain', { delay: 120 })
  await page.locator('.search-state', { hasText: 'Nothing found' }).waitFor()
  // past the half second a search waits after a key (editor.js typeSearch): none more
  await page.waitForTimeout(700)
  assert.deepEqual(asked, ['rain'])
})

// The export writes the format as its settings say (the library's encode options): a WAV at 24 bits (its fmt chunk's
// bits per sample, 22 bytes into the chunk's body, after its id and size, RIFF/WAVE), its markers as cue points, or none
test('editor: the export writes the depth chosen, and the markers as cue points or none', async () => {
  await open()
  await write(`audio('chime.wav').mark(1)`)
  await lengthIs('0:08.000')
  await tab('Export')
  const panel = page.locator('.export')
  await panel.getByRole('group', { name: 'Bits' }).getByRole('button', { name: '24', exact: true }).click()
  const exported = async () => { const [d] = await Promise.all([page.waitForEvent('download'), panel.locator('.export-button').click()]); return readFile(await d.path()) }
  let bytes = await exported()
  assert.equal(bytes.readUInt16LE(bytes.indexOf('fmt ') + 8 + 14), 24)
  assert.ok(bytes.includes('cue '), 'its marker a cue point')
  await panel.getByRole('switch', { name: 'Markers in the file' }).click()
  bytes = await exported()
  assert.ok(!bytes.includes('cue '), 'no cue points')
  // a format that keeps none: the switch off and still
  await panel.getByRole('button', { name: 'FLAC', exact: true }).click()
  assert.equal(await panel.getByRole('switch', { name: 'Markers in the file' }).isDisabled(), true)
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('audio-repl') || '{}').encoding?.bitDepth === 24)
})

// The cuts as an edit list for a video editor (the library's cuts()): a deletion splits the chime into two events of
// its own clip, at the rate chosen, CMX 3600
test('editor: the export writes the cuts as an edit list, the clip named, at the rate chosen', async () => {
  const { x, y } = await chime()
  await drag([x(2), y], [x(3) - x(2), 0])
  await page.keyboard.press('Delete')
  await lengthIs('0:07.000')
  await tab('Export')
  const panel = page.locator('.export')
  await panel.locator('summary', { hasText: /^Edit list/ }).click()
  await panel.getByRole('group', { name: 'Frames a second' }).getByRole('button', { name: '25', exact: true }).click()
  const [download] = await Promise.all([page.waitForEvent('download'), panel.getByRole('button', { name: 'Export EDL' }).click()])
  assert.equal(download.suggestedFilename(), 'chime-edited.edl')
  const edl = await readFile(await download.path(), 'utf8'), events = edl.split('\n').filter(l => /^\d{3}\s/.test(l))
  assert.match(edl, /^TITLE: /m)
  assert.equal(events.length, 2, edl)
  assert.match(edl, /\* FROM CLIP NAME: chime\.wav/)
  // the second event starts in the source a second after the first ends: 00:00:03:00 in, at 00:00:02:00 on the record
  assert.match(events[1], /00:00:03:00 00:00:08:00 00:00:02:00 00:00:07:00/, events[1])
})
