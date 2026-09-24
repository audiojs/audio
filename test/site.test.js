// Static-site regressions: npm run test:site. All audio and requests stay local.
import { test, before, after, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { tmpdir } from 'node:os'
import { extname, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import wav from '@audio/encode-wav'
import audio from '../audio.js'
import { samples as built, RATE } from '../site-samples.js'
import '../.site-build.js'

const root = fileURLToPath(new URL('..', import.meta.url)).replace(/\/$/, '')
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' }
let server, browser, page, origin, errors

before(async () => {
  server = createServer(async (req, res) => {
    const path = resolve(root, '.' + (req.url === '/' ? '/index.html' : req.url.split('?')[0]))
    if (!path.startsWith(root + sep)) { res.writeHead(403).end(); return }
    try {
      const body = await readFile(path)
      res.writeHead(200, { 'content-type': types[extname(path)] || 'application/octet-stream' }).end(body)
    } catch { res.writeHead(404).end() }
  })
  await new Promise(r => server.listen(0, '127.0.0.1', r))
  origin = `http://127.0.0.1:${server.address().port}`
  browser = await chromium.launch()
})

after(async () => { await browser?.close(); if (server) await new Promise(r => server.close(r)) })
beforeEach(async () => {
  page = await browser.newPage()
  // Browsers decode at the output device's rate, which follows whatever audio hardware the machine has on:
  // the fixtures are 48 kHz, so the page's AudioContext is pinned there for every machine alike.
  await page.addInitScript(() => {
    const Native = window.AudioContext
    window.AudioContext = class extends Native { constructor(options) { super({ sampleRate: 48000, ...options }) } }
  })
  errors = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()) })
  await page.route('**/*', route => {
    if (route.request().url().startsWith(origin + '/')) return route.continue()
    errors.push(`External request: ${route.request().url()}`)
    return route.abort()
  })
  await page.goto(origin, { waitUntil: 'networkidle' })
  await idle()
})
afterEach(async () => { await page?.close(); assert.deepEqual(errors, []) })

const button = name => page.getByRole('button', { name, exact: true })
// A sample's length as the page shows it, m:ss.t with tenths floored at the millisecond, from site-samples.js itself:
// the tests hold for whichever samples it makes.
const shown = name => {
  const tenths = Math.floor(Math.round(built[name].make()[0].length / RATE * 1000) / 100)
  return `${Math.floor(tenths / 600)}:${String(Math.floor(tenths / 10) % 60).padStart(2, '0')}.${tenths % 10}`
}
const idle = () => page.locator('.demo[aria-busy="false"]').waitFor()
const message = () => page.locator('.demo-message').innerText()
const editor = () => page.getByRole('textbox', { name: 'Audio program' })
// The program is audio('…'), one edit per line, .save('…'). Tests type the edits between the two names; chain()
// reads them back, without the two-space indent the page writes them with.
const defaultChain = '.trim()\n.normalize(-1)\n.fade(0.02, 0.1)'
const programOf = (edits = defaultChain, from = 'chime', to = 'chime.wav') =>
  [`audio(${from.includes('.') ? `'${from}'` : from})`, ...(edits ? edits.split('\n').map(line => '  ' + line) : []), `  .save('${to}')`].join('\n')
async function fillChain(code) {
  const lines = (await editor().inputValue()).split('\n')
  await editor().fill([lines[0], ...(code ? [code] : []), lines.at(-1)].join('\n'))
  // The caret stays after what was typed, as when typing it.
  await editor().evaluate((el, at) => { el.setSelectionRange(at, at); el.dispatchEvent(new Event('select')) }, lines[0].length + 1 + code.length)
}
async function editChain(code) { await fillChain(code); await idle() }
const chain = async () => (await editor().inputValue()).split('\n').slice(1, -1).map(line => line.replace(/^  (?=\.)/, '')).join('\n')
const sourceName = async () => /^audio\((.*)\)/.exec(await editor().inputValue())?.[1].replace(/^'(.*)'$/, '$1')
// A caret at an offset into the edits, as a click would leave it.
const caret = (from, to = from) => editor().evaluate((el, [from, to]) => {
  const at = el.value.indexOf('\n') + 1
  el.focus(); el.setSelectionRange(at + from, at + to); el.dispatchEvent(new Event('select'))
}, [from, to])
// A click on a name of the program: audio(…) lists the samples, .save('…') the formats.
async function clickName(choice) {
  // An open panel may lie over the name: a click outside closes it first, as a person would.
  if (await page.locator('[popover]:popover-open').count()) await page.mouse.click(1, 1)
  // Brought into view and measured in one step: a pointer re-render of the code cannot detach it in between. The scroll
  // is instant, so the page's smooth scrolling (or one a key started) cannot move it after it is measured.
  const { x, y } = await page.evaluate(choice => {
    document.querySelector('.program').scrollIntoView({ block: 'nearest', behavior: 'instant' })
    const box = document.querySelector(`.program-highlight [data-choice="${choice}"]`).getBoundingClientRect()
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
  }, choice)
  await page.mouse.click(x, y)
}
// audio(…) lists the samples, the last item opening a file; .save('…') lists the formats, each one a download; the +
// after Undo adds a method.
const addButton = () => button('Add a method')
async function chooseFile() { await clickName('source'); await page.getByRole('option', { name: /^Open a file/ }).click() }
async function downloadDisabled() {
  await clickName('save')
  const disabled = await page.getByRole('option').first().isDisabled()
  await editor().press('Escape')
  return disabled
}
const slider = name => page.getByRole('slider', { name: `Seek ${name} audio` })
async function upload(file) { await page.locator('#audio-file').setInputFiles(file); await idle() }
// Undo is Ctrl/Command+Z in the editor.
async function undoEdit() { await editor().press('ControlOrMeta+z'); await idle() }
async function undoAll() { for (let i = 0; i < 3; i++) await undoEdit() }
async function file(name, channels, sampleRate = 48000) {
  const encoder = await wav({ sampleRate, bitDepth: 32 })
  encoder.encode(channels)
  return { name, mimeType: 'audio/wav', buffer: Buffer.from(encoder.flush()) }
}
function tone(length, frequency = 220, amplitude = .2) {
  return Float32Array.from({ length }, (_, i) => i < length / 4 || i >= length * .75 ? 0 : amplitude * Math.sin(2 * Math.PI * frequency * i / 48000))
}
// The name in .save('…') is the download: choosing a format from its list writes that extension and saves.
async function saveAs(format) {
  const ext = format?.toLowerCase() ?? /\.(\w+)['"]\)\s*$/.exec(await editor().inputValue())[1]
  await clickName('save')
  await page.getByRole('option', { name: new RegExp(`\\.${ext}\\b`) }).click()
}
async function exported(format = 'WAV') {
  const waiting = page.waitForEvent('download')
  await saveAs(format)
  const download = await waiting, stream = await download.createReadStream(), chunks = []
  for await (const chunk of stream) chunks.push(chunk)
  await idle()
  return { bytes: Buffer.concat(chunks), filename: download.suggestedFilename() }
}
async function output() { return decode((await exported()).bytes) }
async function decode(bytes) {
  // Decode the actual downloaded file, independently of the engine's PCM caches. Bytes cross to the page and back as
  // base64: a JSON number per byte or sample costs seconds on a few seconds of stereo.
  const { rate, channels } = await page.evaluate(async base64 => {
    const ctx = new AudioContext({ sampleRate: 48000 })
    try {
      const decoded = await ctx.decodeAudioData(Uint8Array.from(atob(base64), c => c.charCodeAt(0)).buffer)
      const encode = data => {
        const view = new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
        let text = ''
        for (let i = 0; i < view.length; i += 32768) text += String.fromCharCode(...view.subarray(i, i + 32768))
        return btoa(text)
      }
      return { rate: decoded.sampleRate, channels: Array.from({ length: decoded.numberOfChannels }, (_, c) => encode(decoded.getChannelData(c))) }
    } finally { await ctx.close() }
  }, Buffer.from(bytes).toString('base64'))
  return { rate, channels: channels.map(text => { const b = Buffer.from(text, 'base64'); return Array.from(new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength))) }) }
}

test('site: static bundle hydrates offline and exports finite, trimmed PCM', async () => {
  assert.equal(await chain(), defaultChain)
  await page.evaluate(() => document.fonts.ready)
  assert(await page.evaluate(() => document.fonts.check('80px Wavefont')))
  const glyphs = await page.locator('#edited-wave .wave-glyphs').first().textContent()
  assert(glyphs.length > 0)
  assert([...glyphs].every(char => char.charCodeAt(0) >= 0x101 && char.charCodeAt(0) <= 0x164))
  assert(new Set(glyphs).size > 1)
  const result = await output()
  assert.equal(result.channels.length, built.chime.make().length)
  assert(result.channels[0].length < 8 * result.rate)
  assert(result.channels[0].every(Number.isFinite))
  assert(result.channels[0].some(value => Math.abs(value) > .5))
})

test('site: A → A → stereo B, undo and retyping the chain preserve the current file samples', async () => {
  const aPCM = [tone(48000)], bPCM = [tone(24000, 330), tone(24000, 550, .1)]
  const a = await file('a.wav', aPCM), b = await file('b.wav', bPCM)
  let first
  for (const [input, expected] of [[a, aPCM], [a, aPCM], [b, bPCM]]) {
    await upload(input)
    assert.equal(await sourceName(), input.name)
    const processed = await output()
    assert.equal(processed.channels.length, expected.length)
    assert(processed.channels[0].length < expected[0].length)
    for (const channel of processed.channels) {
      assert(channel.every(Number.isFinite))
      assert(channel.every(value => Math.abs(value) <= .892))
      assert(Math.abs(channel[0]) < .01)
      assert(Math.abs(channel.at(-1)) < .01)
    }
    if (input === a) {
      if (first) assert.deepEqual(processed, first)
      first = processed
    }
    await undoAll()
    assert.equal(await chain(), '')
    const restored = await output()
    for (let c = 0; c < expected.length; c++) {
      assert.equal(restored.channels[c].length, expected[c].length)
      assert(restored.channels[c].every((value, i) => Math.abs(value - expected[c][i]) < 1 / 32767))
    }
    await editChain(defaultChain)
    assert.deepEqual(await output(), processed)
  }
})

test('site: cancel, invalid bytes and zero-frame WAV preserve the previous file', async () => {
  const prior = await output()
  for (const invalid of [[], { name: 'zero.wav', mimeType: 'audio/wav', buffer: Buffer.alloc(0) }, { name: 'bad.wav', mimeType: 'audio/wav', buffer: Buffer.from('bad') }, await file('empty.wav', [new Float32Array(0)])]) {
    await upload(invalid)
    assert.equal(await sourceName(), 'chime')
    if (!Array.isArray(invalid)) assert.match(await message(), /could not be opened/)
    assert.deepEqual(await output(), prior)
  }
})

test('site: one-sample WAV remains finite and undo restores its sample', async () => {
  await upload(await file('one.wav', [new Float32Array([.25])]))
  const processed = await output()
  assert.equal(processed.channels[0].length, 1)
  assert(processed.channels[0].every(Number.isFinite))
  await undoAll()
  const restored = await output()
  assert.equal(restored.channels[0].length, 1)
  assert(Math.abs(restored.channels[0][0] - .25) < 1 / 32767)
})

test('site: silence trimmed to zero disables output; undo restores valid silent PCM', async () => {
  await upload(await file('silence.wav', [new Float32Array(4800)]))
  assert.match(await message(), /removed all samples/)
  assert(await button('Play edited audio').isDisabled())
  assert(await button('Play original audio').isEnabled())
  assert(await slider('edited').isDisabled())
  assert(await slider('original').isEnabled())
  assert(await downloadDisabled())
  await undoAll()
  assert.equal(await message(), '')
  const restored = await output()
  assert.equal(restored.channels[0].length, 4800)
  assert(restored.channels[0].every(value => value === 0))
})

test('site: render failure disables stale output; a new edit recovers', async () => {
  for (const operation of ['Undo', 'menu', 'typing']) {
    await page.evaluate(async () => {
      const { default: audio } = await import('/assets/audio.js')
      const read = audio.fn.read
      audio.fn.read = function () { audio.fn.read = read; return Promise.reject(new Error('render failed')) }
    })
    if (operation === 'typing') await editChain('.gain(-3)')
    else if (operation === 'menu') await addMethod('reverse')
    else await undoEdit()
    assert.match(await message(), /could not be/)
    assert(await downloadDisabled())
    assert(await button('Play edited audio').isDisabled())
    assert(await button('Play original audio').isEnabled())
    const renderError = await message()
    await button('Play original audio').click()
    await page.waitForFunction(() => +document.querySelector('#original-wave input').value > 0)
    assert.equal(await message(), renderError)
    await editChain(defaultChain)
    assert.equal(await message(), '')
    assert((await output()).channels[0].some(value => value !== 0))
  }
})

test('site: 20 MB accepts decoding, over-limit skips it; 120 seconds accepts, one frame over rejects', async () => {
  await page.evaluate(() => {
    const decode = AudioContext.prototype.decodeAudioData
    window.decodes = 0
    AudioContext.prototype.decodeAudioData = function (...args) { decodes++; return decode.apply(this, args) }
  })
  // Zero-filled payload distinguishes the byte gate from the decoder's format error.
  await upload({ name: 'limit.wav', mimeType: 'audio/wav', buffer: Buffer.alloc(20 * 1024 * 1024) })
  assert.equal(await page.evaluate(() => decodes), 1)
  assert.match(await message(), /could not be opened/)
  await upload({ name: 'over.wav', mimeType: 'audio/wav', buffer: Buffer.alloc(20 * 1024 * 1024 + 1) })
  assert.equal(await page.evaluate(() => decodes), 1)
  assert.match(await message(), /20 MB/)
  const frames = 120 * 8000
  const pcm = Float32Array.from({ length: frames + 1 }, (_, i) => .2 * Math.sin(2 * Math.PI * 220 * i / 8000))
  await upload(await file('120s.wav', [pcm.subarray(0, frames)], 8000))
  assert.equal(await sourceName(), '120s.wav')
  assert.equal(await message(), '')
  assert(!(await downloadDisabled()))
  await upload(await file('over-120s.wav', [pcm], 8000))
  assert.equal(await sourceName(), '120s.wav')
  assert.match(await message(), /two minutes/)
})

for (const outcome of ['resolve', 'reject']) test(`site: stale resume ${outcome} cannot replace or stop newer playback`, async () => {
  await page.evaluate(() => {
    const resume = AudioContext.prototype.resume
    const start = AudioBufferSourceNode.prototype.start
    window.resumes = []
    window.starts = 0
    AudioBufferSourceNode.prototype.start = function (...args) { starts++; return start.apply(this, args) }
    AudioContext.prototype.resume = function () {
      return new Promise((resolve, reject) => window.resumes.push({ resolve: () => resume.call(this).then(resolve), reject }))
    }
  })
  await button('Play edited audio').click()
  await button('Play original audio').click()
  assert.equal(await page.evaluate(() => resumes.length), 2)
  await page.evaluate(() => resumes[1].resolve())
  await button('Pause original audio').waitFor()
  await page.evaluate(outcome => outcome === 'resolve' ? resumes[0].resolve() : resumes[0].reject(new Error('stale resume')), outcome)
  assert.equal(await message(), '')
  assert(await button('Pause original audio').isVisible())
  assert.equal(await page.evaluate(() => starts), 1)
})

test('site: playback failure permits export and a successful playback retry', async () => {
  const prior = await output()
  await page.evaluate(() => {
    const resume = AudioContext.prototype.resume
    AudioContext.prototype.resume = function () { AudioContext.prototype.resume = resume; return Promise.reject(new Error('resume failed')) }
  })
  await button('Play edited audio').click()
  assert.match(await message(), /playback is unavailable/)
  assert(await button('Play edited audio').isEnabled())
  assert.deepEqual(await output(), prior)
  await button('Play edited audio').click(); await button('Pause edited audio').waitFor()
  await page.waitForFunction(() => +document.querySelector('#edited-wave input').value > 0)
  assert.equal(await message(), '')
})

test('site: export failure clears busy state and retry preserves the edited PCM', async () => {
  const prior = await output()
  await page.evaluate(async () => {
    const { default: audio } = await import('/assets/audio.js')
    const encode = audio.fn.encode
    audio.fn.encode = function () { audio.fn.encode = encode; return Promise.reject(new Error('export failed')) }
  })
  await saveAs(); await idle()
  assert.match(await message(), /Export failed/)
  assert(await button('Play edited audio').isEnabled())
  assert(!(await downloadDisabled()))
  assert.deepEqual(await output(), prior)
  assert.equal(await message(), '')
})

test('site: pagehide followed by return creates a usable audio context', async () => {
  await watchPlayback()
  await button('Play edited audio').click(); await button('Pause edited audio').waitFor()
  await page.waitForFunction(() => +document.querySelector('#edited-wave input').value > 0)
  await page.evaluate(() => dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true })))
  await button('Play edited audio').click(); await button('Pause edited audio').waitFor()
  await page.waitForFunction(() => played.length === 2)
  assert.equal(await message(), '')
})

test('site: typed edits change PCM and all code examples; undo restores the chain', async () => {
  await upload(await file('edits.wav', [tone(48000)]))
  const initial = await output()
  const initialWave = await page.locator('#edited-wave .wave-glyphs').first().textContent()
  await editChain('.normalize(-1).fade(0.02, 0.1)')
  assert.equal(await chain(), '.normalize(-1).fade(0.02, 0.1)')
  assert.equal((await output()).channels[0].length, 48000)
  assert.notEqual(await page.locator('#edited-wave .wave-glyphs').first().textContent(), initialWave)
  for (const tab of ['Node.js', 'Browser', 'CLI', 'MCP']) {
    await button(tab).click()
    const code = await page.locator('.code-example pre').innerText()
    assert(!/\btrim\b/.test(code))
    assert(/\bnormalize\b/.test(code))
    assert(/\bfade\b/.test(code))
  }
  await undoEdit()
  assert.equal(await chain(), defaultChain)
  assert.deepEqual(await output(), initial)
  await editChain('.trim().fade(0.02, 0.1)')
  const quieter = (await output()).channels[0]
  assert.equal(quieter.length, initial.channels[0].length)
  assert(Math.max(...quieter.map(Math.abs)) < .21)
  // A nonzero signal makes both fade boundaries observable, independent of trim's block alignment.
  await upload(await file('fade.wav', [new Float32Array(9600).fill(.2)]))
  await editChain('.trim().fade(0.02, 0.1)')
  const faded = await output()
  await editChain('.trim()')
  const unfaded = (await output()).channels[0]
  assert.equal(unfaded.length, 9600)
  assert(unfaded.every(value => Math.abs(value - .2) < 1 / 32767))
  assert(Math.abs(faded.channels[0][0]) < .0001)
  assert(Math.abs(faded.channels[0].at(-1)) < .001)
  assert(Math.abs(faded.channels[0][4800] - .2) < 1 / 32767)
  await editChain(defaultChain)
  assert.deepEqual(await output(), faded)
  await editChain('')
  for (const tab of ['Node.js', 'Browser', 'CLI', 'MCP']) {
    await button(tab).click()
    assert(!/\b(trim|normalize|fade)\b/.test(await page.locator('.code-example pre').innerText()))
  }
})

async function watchPlayback() {
  await page.evaluate(() => {
    const start = AudioBufferSourceNode.prototype.start, stop = AudioBufferSourceNode.prototype.stop
    window.played = []
    window.buffers = new Set()
    window.stops = 0
    AudioBufferSourceNode.prototype.start = function (...args) {
      buffers.add(this.buffer)
      played.push({ duration: this.buffer.duration, channels: this.buffer.numberOfChannels, offset: args[1] || 0, limit: args[2] })
      return start.apply(this, args)
    }
    AudioBufferSourceNode.prototype.stop = function (...args) { stops++; return stop.apply(this, args) }
  })
}

test('site: failed edits on a new file still show and play the current original', async () => {
  const previousWave = await page.locator('#original-wave .wave-glyphs').first().textContent()
  await page.evaluate(async () => {
    const { default: audio } = await import('/assets/audio.js')
    const read = audio.fn.read
    audio.fn.read = function () { audio.fn.read = read; return Promise.reject(new Error('render failed')) }
  })
  await upload(await file('new-original.wav', [tone(24000)]))
  assert.match(await message(), /could not be applied/)
  assert.equal(await sourceName(), 'new-original.wav')
  assert.match(await page.locator('.wave-label').first().innerText(), /0:00\.5/)
  assert.notEqual(await page.locator('#original-wave .wave-glyphs').first().textContent(), previousWave)
  assert(await button('Play edited audio').isDisabled())
  await watchPlayback()
  await button('Play original audio').click()
  await page.waitForFunction(() => played.length === 1)
  assert.equal(await page.evaluate(() => played[0].duration), .5)
  await editChain(defaultChain)
  assert((await output()).channels[0].length < 24000)
})

test('site: per-wave playback preserves positions and replaces buffers after edits or uploads', async () => {
  await watchPlayback()
  await button('Play original audio').click()
  await page.waitForFunction(() => +document.querySelector('#original-wave input').value > 10)
  await button('Play edited audio').click()
  await page.waitForFunction(() => played.length === 2)
  const originalPosition = await slider('original').inputValue()
  assert(+originalPosition > 0)
  assert(await button('Play original audio').isVisible())
  assert(await button('Pause edited audio').isVisible())
  assert.equal(await page.evaluate(() => stops), 1)
  const played = await page.evaluate(() => window.played)
  assert.equal(await page.evaluate(() => buffers.size), 2)
  assert.equal(played[0].duration, 8)
  assert(played[1].duration < played[0].duration)
  await page.waitForFunction(() => +document.querySelector('#edited-wave input').value > 10)
  await button('Pause edited audio').click()
  const editedPosition = await slider('edited').inputValue()
  await button('Play original audio').click()
  await page.waitForFunction(() => played.length === 3)
  assert.equal(await page.evaluate(() => stops), 2)
  assert((await page.evaluate(() => played[2].offset)) > 0)
  assert.equal(await slider('edited').inputValue(), editedPosition)
  await editChain('.normalize(-1).fade(0.02, 0.1)')
  await button('Play edited audio').click()
  await page.waitForFunction(() => played.length === 4)
  assert.equal(await page.evaluate(() => played[3].duration), 8)
  assert.equal(await page.evaluate(() => buffers.size), 3)
  await upload(await file('stereo.wav', [tone(24000), tone(24000, 330)]))
  await button('Play original audio').click()
  await page.waitForFunction(() => played.length === 5)
  assert.deepEqual(await page.evaluate(() => played[4]), { duration: .5, channels: 2, offset: 0, limit: .5 })
  assert.equal(await page.evaluate(() => buffers.size), 4)
})

test('site: seek supports keyboard boundaries, playback continuation and menu edits', async () => {
  await watchPlayback()
  await slider('edited').focus()
  await page.keyboard.press('End')
  assert.equal(await slider('edited').inputValue(), '1000')
  assert.equal(await slider('original').inputValue(), '0')
  await button('Play edited audio').click()
  await page.waitForFunction(() => played.length === 1)
  assert.equal(await page.evaluate(() => played[0].offset), 0)
  await slider('edited').evaluate(input => { input.value = '500'; input.dispatchEvent(new Event('input', { bubbles: true })) })
  await page.waitForFunction(() => played.length === 2)
  const resumed = await page.evaluate(() => played[1])
  assert(Math.abs(resumed.offset - resumed.duration / 2) < .001)
  assert.equal(await page.evaluate(() => stops), 1)
  assert.equal(await page.evaluate(() => buffers.size), 1)
  await slider('edited').focus()
  await page.keyboard.press('End')
  assert(await button('Play edited audio').isVisible())
  assert.equal(await slider('edited').inputValue(), '1000')
  await page.keyboard.press('Home')
  assert.equal(await slider('edited').inputValue(), '0')
  await page.keyboard.press('ArrowRight')
  assert.equal(await slider('edited').inputValue(), '1')
  await addMethod('reverse')
  assert.equal(await slider('edited').inputValue(), '0')
  assert.equal(await slider('original').inputValue(), '0')
})

test('site: pause cancels pending resume before an audio source starts', async () => {
  await watchPlayback()
  await page.evaluate(() => {
    const resume = AudioContext.prototype.resume
    AudioContext.prototype.resume = function () { return new Promise(resolve => { window.finishResume = () => resume.call(this).then(resolve) }) }
  })
  await button('Play edited audio').click()
  await button('Pause edited audio').click()
  await page.evaluate(() => finishResume())
  assert.equal(await page.evaluate(() => played.length), 0)
  assert(await button('Play edited audio').isVisible())
  assert.equal(await slider('edited').inputValue(), '0')
})

test('site: natural playback end preserves the full progress and replay starts at zero', async () => {
  await upload(await file('short.wav', [tone(4800)]))
  await watchPlayback()
  await button('Play original audio').click()
  await page.waitForFunction(() => played.length === 1 && document.querySelector('#original-wave input').value === '1000' && document.querySelector('.audio-row .play').getAttribute('aria-label') === 'Play original audio')
  assert(await button('Play original audio').isVisible())
  await button('Play original audio').click()
  await page.waitForFunction(() => played.length === 2)
  assert.equal(await page.evaluate(() => played[1].offset), 0)
})

test('site: original playback preserves the empty-edit error after a playback retry', async () => {
  await upload(await file('silence.wav', [new Float32Array(4800)]))
  const editError = await message()
  assert.match(editError, /removed all samples/)
  await page.evaluate(() => {
    const resume = AudioContext.prototype.resume
    AudioContext.prototype.resume = function () { AudioContext.prototype.resume = resume; return Promise.reject(new Error('resume failed')) }
  })
  await button('Play original audio').click()
  assert.match(await message(), /playback is unavailable/)
  await watchPlayback()
  await button('Play original audio').click()
  await page.waitForFunction(() => played.length === 1)
  assert.equal(await message(), editError)
  assert(await button('Play edited audio').isDisabled())
  assert(await downloadDisabled())
  await undoAll()
  assert.equal(await message(), '')
  const restored = await output()
  assert.equal(restored.channels[0].length, 4800)
  assert(restored.channels[0].every(value => value === 0))
})

test('site: a pending WAV export permits pause, seek and switching previews', async () => {
  await watchPlayback()
  await button('Play original audio').click()
  await page.waitForFunction(() => played.length === 1)
  await page.evaluate(async () => {
    const { default: audio } = await import('/assets/audio.js')
    const encode = audio.fn.encode
    audio.fn.encode = function (...args) {
      audio.fn.encode = encode
      return new Promise((resolve, reject) => { window.finishExport = () => encode.apply(this, args).then(resolve, reject) })
    }
  })
  const downloaded = page.waitForEvent('download')
  await saveAs()
  assert.equal(await page.locator('.demo').getAttribute('aria-busy'), 'true')
  assert(await editor().isDisabled())
  assert(await addButton().isDisabled())
  await button('Pause original audio').click()
  assert.equal(await page.evaluate(() => stops), 1)
  await slider('edited').focus()
  await page.keyboard.press('ArrowRight')
  assert.equal(await slider('edited').inputValue(), '1')
  await button('Play edited audio').click()
  await page.waitForFunction(() => played.length === 2)
  assert((await page.evaluate(() => played[1].offset)) > 0)
  assert(await button('Pause edited audio').isEnabled())
  await page.evaluate(() => finishExport())
  await downloaded; await idle()
  assert.equal(await message(), '')
})

async function addProcessing(type) {
  const calls = { gain: '.gain(-6)', reverse: '.reverse()', speed: '.speed(1.25)' }
  await editChain(await chain() + calls[type])
}

async function cursor(name, value) {
  await slider(name).evaluate((input, value) => { input.value = value; input.dispatchEvent(new Event('input', { bubbles: true })) }, String(value))
}

async function dragWave(name, from, to) {
  await slider(name).scrollIntoViewIfNeeded()
  const box = await slider(name).boundingBox(), y = box.y + box.height / 2
  await page.mouse.move(box.x + box.width * from, y)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width * to, y, { steps: 8 })
  await page.mouse.up()
}

test('site: selection fill stays independent of the playback cursor and waveform opacity', async () => {
  await cursor('edited', 400)
  const appearance = await page.locator('#edited-wave').evaluate(track => {
    const [upcoming, played] = track.children
    return { upcoming: getComputedStyle(upcoming).opacity, played: getComputedStyle(played).opacity, fill: getComputedStyle(played).backgroundColor, selection: track.style.getPropertyValue('--selection-end') }
  })
  assert.equal(appearance.upcoming, '0.5')
  assert.equal(appearance.played, '1')
  assert.equal(appearance.fill, 'rgba(0, 0, 0, 0)')
  assert.equal(appearance.selection, '0%')
  await dragWave('edited', .75, .25)
  const selectedGlyph = await page.locator('#edited-wave .wave-selection .wave-glyphs').evaluate(glyph => {
    const style = getComputedStyle(glyph), context = document.createElement('canvas').getContext('2d')
    context.fillStyle = style.color
    context.fillRect(0, 0, 1, 1)
    return { opacity: style.opacity, color: [...context.getImageData(0, 0, 1, 1).data] }
  })
  assert.deepEqual(selectedGlyph, { opacity: '1', color: [255, 255, 255, 255] })
  const selected = await page.locator('#edited-wave').evaluate(track => [parseFloat(track.style.getPropertyValue('--selection-start')), parseFloat(track.style.getPropertyValue('--selection-end'))])
  assert(Math.abs(selected[0] - 25) < .5)
  assert(Math.abs(selected[1] - 75) < .5)
  await watchPlayback()
  await button('Play edited audio').click()
  await page.waitForFunction(() => played.length === 1)
  const started = await page.evaluate(() => played[0])
  assert(Math.abs(started.offset / started.duration - .25) < .005)
  assert(Math.abs(started.limit / started.duration - .5) < .005)
  assert.deepEqual(await page.locator('#edited-wave').evaluate(track => [parseFloat(track.style.getPropertyValue('--selection-start')), parseFloat(track.style.getPropertyValue('--selection-end'))]), selected)
  await slider('edited').press('Escape')
  await page.waitForFunction(() => played.length === 2)
  const resumed = await page.evaluate(() => played[1])
  assert(Math.abs(resumed.offset + resumed.limit - resumed.duration) < .00001)
  assert.equal(await page.locator('.range').count(), 0)
})

test('site: selected playback stops at its end; click seeks and clears the range', async () => {
  await upload(await file('short.wav', [tone(4800)]))
  await dragWave('original', .2, .8)
  await watchPlayback()
  await button('Play original audio').click()
  await page.waitForFunction(() => played.length === 1 && document.querySelector('.audio-row .play').getAttribute('aria-label') === 'Play original audio')
  assert(Math.abs(+(await slider('original').inputValue()) - 800) < 5)
  assert.equal(await page.locator('.range').count(), 1)
  const box = await slider('original').boundingBox()
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
  assert.equal(await page.locator('.range').count(), 0)
  assert(Math.abs(+(await slider('original').inputValue()) - 500) < 5)
})

for (const name of ['original', 'edited']) test(`site: cropping ${name} selection uses that timeline and undo restores PCM`, async () => {
  await upload(await file('crop.wav', [tone(48000)]))
  await undoAll()
  await addProcessing('speed')
  const prior = await output()
  await cursor(name, 250)
  await slider(name).focus()
  await page.keyboard.press('Shift+End')
  assert.equal(await page.locator('.range').count(), 1)
  await addMethod('crop')
  const cropped = await output()
  assert.equal(cropped.channels[0].length, 28800)
  const expected = prior.channels[0].slice(9600)
  assert(cropped.channels[0].every((value, i) => Math.abs(value - expected[i]) < 1 / 32767))
  const code = await page.locator('.code-example pre').innerText()
  assert(name === 'original' ? code.indexOf('.crop(') < code.indexOf('.speed(') : code.indexOf('.crop(') > code.indexOf('.speed('))
  assert.equal(await page.locator('.range').count(), 0)
  await undoEdit()
  assert.deepEqual(await output(), prior)
})

test('site: a pointer selection lights its track, shows its range in the readout digits, and crops at readable precision', async () => {
  const pcm = tone(96000, 220, .5)
  await upload(await file('pointer.wav', [pcm]))
  await undoAll()
  assert.equal(await page.locator('.edited-row.active').count(), 1)
  // Fractional pointer positions, as a trackpad reports them.
  await dragWave('original', .3037, .6071)
  assert.equal(await page.locator('.audio-row.active .track-name').textContent(), 'Original')
  assert.match(await page.locator('.range output').textContent(), /^0:00\.\d–0:01\.\d$/)
  // The range reads in the position's face.
  const faces = await page.evaluate(() => [...document.querySelectorAll('.timecode output')].map(el => { const style = getComputedStyle(el); return style.fontFamily + ' ' + style.fontWeight }))
  assert.equal(faces.length, 2)
  assert.equal(faces[1], faces[0])
  await addMethod('crop')
  // A thousandth of a 2 s track is a millisecond, so the crop keeps three decimals.
  const [, at, duration] = /^\.crop\(\{ at: (\d\.\d{1,3}), duration: (\d\.\d{1,3}) \}\)$/.exec(await chain())
  assert(Math.abs(at - .3037 * 2) < .01 && Math.abs(duration - (.6071 - .3037) * 2) < .01)
  // Differential: the library cropping the same samples in Node.
  const clip = audio.from([pcm], { sampleRate: 48000 })
  clip.crop({ at: +at, duration: +duration })
  const expected = await clip.read()
  const result = await output()
  assert.equal(result.channels[0].length, expected[0].length)
  assert(result.channels[0].every((value, i) => Math.abs(value - expected[0][i]) < 1 / 32767))
})

test('site: Crop and Undo keep working across selections, and cropping again updates the crop in place', async () => {
  await upload(await file('cycles.wav', [tone(96000, 220, .5)]))
  // A step between the crops keeps the original's crop first and the edit's last.
  await editChain('.gain(0)')
  // Every selection mounts Crop anew; it must respond every time.
  for (let i = 0; i < 4; i++) {
    const name = i % 2 ? 'original' : 'edited'
    await dragWave(name, .2, .6)
    assert.equal(await page.locator('.range').count(), 1, `cycle ${i}`)
    await slider(name).press('Escape')
    assert.equal(await page.locator('.range').count(), 0, `cycle ${i}`)
    assert.deepEqual(await page.locator('.wave-track').evaluateAll(tracks => tracks.map(track => track.style.getPropertyValue('--selection-end'))), ['0%', '0%'])
  }
  const crop = async (name, from, to) => { await dragWave(name, from, to); await addMethod('crop') }
  const lines = async () => (await chain()).split('\n')
  const near = (line, expected) => /^\.crop\(\{ at: ([\d.]+), duration: ([\d.]+) \}\)$/.exec(line).slice(1).every((value, i) => Math.abs(value - expected[i]) < .01)
  // Cropping the edit again narrows its crop: 0.5 + 0.5 s in, 0.5 s long.
  await crop('edited', .25, .75)
  await crop('edited', .5, 1)
  assert.equal((await lines()).length, 2)
  assert(near((await lines())[1], [1, .5]))
  // Cropping the original again replaces its crop, even while the result is empty.
  await crop('original', .1, .3)
  assert.match(await message(), /removed all samples/)
  await crop('original', .6, .9)
  assert.equal((await lines()).length, 3)
  assert(near((await lines())[0], [1.2, .6]))
  // The Undo button steps back one crop at a time.
  await button('Undo').click(); await idle()
  assert(near((await lines())[0], [.2, .4]))
  await button('Undo').click(); await idle()
  assert.equal((await lines()).length, 2)
  assert.equal(await message(), '')
})

test('site: with a range of the edit selected, the add menu applies methods there, as the library does in Node', async () => {
  const pcm = tone(96000, 220, .5)
  await upload(await file('ranges.wav', [pcm]))
  await undoAll()
  assert(await button('Undo').isVisible())
  const library = async edit => { const clip = audio.from([pcm], { sampleRate: 48000 }); edit(clip); return clip.read() }
  const same = async expected => {
    const result = await output()
    assert.equal(result.channels[0].length, expected[0].length)
    assert(result.channels[0].every((value, i) => Math.abs(value - expected[0][i]) < 1 / 32767))
  }
  // A range scopes an ordinary method as its last argument; Undo stays at hand.
  await dragWave('edited', .25, .5)
  assert(await button('Undo').isVisible())
  await addButton().click()
  assert.match(await page.locator('.menu-scope').innerText(), /^Apply to 0:00\.\d–0:01\.\d$/)
  // Pad has no range: it waits for the whole edit.
  assert(await button('Add pad').isDisabled())
  await button('Add gain').click(); await idle()
  let [, at, duration] = /^\.gain\(-6, \{ at: ([\d.]+), duration: ([\d.]+) \}\)$/.exec(await chain())
  assert(Math.abs(at - .5) < .01 && Math.abs(duration - .5) < .01)
  await same(await library(clip => clip.gain(-6, { at: +at, duration: +duration })))
  // Remove takes the range as its own and cuts it out.
  await undoEdit()
  await dragWave('edited', .25, .5)
  await addMethod('remove')
  ;[, at, duration] = /^\.remove\(\{ at: ([\d.]+), duration: ([\d.]+) \}\)$/.exec(await chain())
  await same(await library(clip => clip.remove({ at: +at, duration: +duration })))
  // Without a selection, methods apply to the whole edit.
  await undoEdit()
  await addButton().click()
  assert(await page.locator('.menu-scope').isHidden())
  assert(await button('Add pad').isEnabled())
  await page.keyboard.press('Escape')
  // The original's selection crops only, first in the chain; other methods then apply to the whole edit.
  await dragWave('original', .25, .5)
  await addButton().click()
  assert(await button('Add remove').isDisabled())
  await page.keyboard.press('Escape')
  await addMethod('gain')
  assert.equal(await chain(), '.gain(-6)')
  await dragWave('original', .25, .5)
  await addMethod('crop')
  assert.match(await chain(), /^\.crop\(\{ at: [\d.]+, duration: [\d.]+ \}\)\n\.gain\(-6\)$/)
})

test('site: a crop chain with no overlap disables output and Undo restores the prior samples', async () => {
  await upload(await file('no-overlap.wav', [tone(48000)]))
  // A step between the crops keeps them apart: the edit's crop is last, the original's first.
  await editChain('.gain(0)')
  await cursor('edited', 500)
  await slider('edited').focus()
  await page.keyboard.press('Shift+End')
  await addMethod('crop')
  const prior = await output()
  await cursor('original', 250)
  await slider('original').focus()
  await page.keyboard.press('Shift+Home')
  await addMethod('crop')
  assert.equal(await message(), 'The edits removed all samples. Undo an edit or open another file.')
  assert(await downloadDisabled())
  assert(await button('Play edited audio').isDisabled())
  assert(await slider('edited').isDisabled())
  assert(await button('Play original audio').isEnabled())
  await undoEdit()
  assert.equal(await message(), '')
  assert.deepEqual(await output(), prior)
})

test('site: selection cancellation restores the previous range and keyboard selection reaches boundaries', async () => {
  await cursor('original', 250)
  await slider('original').focus()
  await page.keyboard.press('Shift+End')
  const prior = await page.locator('.range').innerText()
  const box = await slider('original').boundingBox(), y = box.y + box.height / 2
  await page.mouse.move(box.x + box.width * .4, y)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width * .6, y, { steps: 4 })
  await page.keyboard.press('Escape')
  await page.mouse.up()
  assert.equal(await page.locator('.range').innerText(), prior)
  await page.keyboard.press('Escape')
  assert.equal(await page.locator('.range').count(), 0)
  await slider('original').focus()
  await page.keyboard.press('Control+a')
  assert.deepEqual(await page.locator('#original-wave').evaluate(track => [track.style.getPropertyValue('--selection-start'), track.style.getPropertyValue('--selection-end')]), ['0%', '100%'])
  await addMethod('reverse')
  assert.equal(await page.locator('.range').count(), 0)
})

test('site: interrupted pointer selection restores the prior range and releases capture', async () => {
  await cursor('original', 250)
  await slider('original').focus()
  await page.keyboard.press('Shift+End')
  const prior = await page.locator('.range').innerText()
  const track = page.locator('#original-wave'), box = await track.boundingBox(), y = box.y + box.height / 2
  for (const cancel of ['pointercancel', 'lostpointercapture']) {
    await track.evaluate(track => track.addEventListener('pointerdown', event => track.pointer = event.pointerId, { once: true }))
    await page.mouse.move(box.x + box.width * .4, y)
    await page.mouse.down()
    await page.mouse.move(box.x + box.width * .6, y, { steps: 4 })
    await track.evaluate((track, cancel) => {
      if (cancel === 'pointercancel') track.dispatchEvent(new PointerEvent(cancel, { pointerId: track.pointer }))
      else track.releasePointerCapture(track.pointer)
    }, cancel)
    await page.mouse.up()
    assert.equal(await page.locator('.range').innerText(), prior)
    assert.equal(await track.evaluate(track => track.hasPointerCapture(track.pointer)), false)
  }
})

test('site: sub-sample selection at the final boundary crops one sample', async () => {
  await upload(await file('one.wav', [new Float32Array([.25])]))
  await undoAll()
  await cursor('original', 1000)
  await slider('original').focus()
  await page.keyboard.press('Shift+ArrowLeft')
  await addMethod('crop')
  const result = await output()
  assert.equal(result.channels[0].length, 1)
  assert(Math.abs(result.channels[0][0] - .25) < 1 / 32767)
  assert.equal(await page.locator('.range').count(), 0)
})

test('site: added processing composes in order, duplicates work, and removal is undoable', async () => {
  const pcm = tone(4800)
  await upload(await file('chain.wav', [pcm]))
  await undoAll()
  await addProcessing('gain')
  const gained = await output()
  assert(gained.channels[0].every((value, i) => Math.abs(value - pcm[i] * 10 ** (-6 / 20)) < 1 / 32767))
  await addProcessing('gain')
  const twice = await output()
  assert(twice.channels[0].every((value, i) => Math.abs(value - pcm[i] * 10 ** (-12 / 20)) < 1 / 32767))
  await undoEdit()
  assert.deepEqual(await output(), gained)
  await addProcessing('reverse')
  const reversed = await output()
  assert(reversed.channels[0].every((value, i) => Math.abs(value - gained.channels[0].at(-1 - i)) < 1 / 32767))
  const code = await page.locator('.code-example pre').innerText()
  assert(code.indexOf('.gain(-6)') < code.indexOf('.reverse()'))
  await editChain('.gain(-6)')
  assert.deepEqual(await output(), gained)
  await undoEdit()
  assert.deepEqual(await output(), reversed)
})

test('site: an empty live chain preserves samples and typing retains editor focus', async () => {
  const pcm = tone(4800)
  await upload(await file('empty-chain.wav', [pcm]))
  const prior = await output()
  await editChain('   ')
  assert(await editor().evaluate(el => el === document.activeElement))
  assert.equal(await chain(), '   ')
  const clean = await output()
  assert.equal(clean.channels[0].length, pcm.length)
  assert(clean.channels[0].every((value, i) => Math.abs(value - pcm[i]) < 1 / 32767))
  assert(!/\b(trim|normalize|fade)\b/.test(await page.locator('.code-example pre').innerText()))
  await undoEdit()
  assert.equal(await chain(), defaultChain)
  assert.deepEqual(await output(), prior)
  for (const code of ['.reverse()'.repeat(64), '.gain(0)'.padEnd(4096)]) {
    await editChain(code)
    assert.equal(await editor().getAttribute('aria-invalid'), 'false')
    assert.deepEqual(await output(), clean)
  }
})

test('site: typed numeric arguments and repeated A → A → B chains produce the expected stereo PCM', async () => {
  const pcm = [tone(4800), tone(4800, 330, .1)]
  await upload(await file('typed.wav', pcm))
  let first
  for (const [code, db, reverse] of [
    ['.gain(-3e0) .gain(-.5)', -3.5, false],
    ['.gain(-3).gain(-0.5)', -3.5, false],
    ['.gain(+0).reverse()', 0, true]
  ]) {
    await editChain(code)
    assert.equal(await editor().getAttribute('aria-invalid'), 'false')
    const result = await output()
    assert.equal(result.channels.length, 2)
    for (let c = 0; c < 2; c++) {
      assert.equal(result.channels[c].length, pcm[c].length)
      assert(result.channels[c].every((value, i) => Number.isFinite(value) && Math.abs(value - pcm[c][reverse ? pcm[c].length - i - 1 : i] * 10 ** (db / 20)) < 1 / 32767))
    }
    if (!reverse) {
      if (first) assert.deepEqual(result, first)
      first = result
    }
  }
  await undoEdit()
  assert.equal(await chain(), '.gain(-3)\n.gain(-0.5)')
  assert.deepEqual(await output(), first)
})

test('site: incomplete and unsupported chains leave preview, examples and history unchanged', async () => {
  const pcm = tone(4800)
  await upload(await file('syntax.wav', [pcm]))
  const prior = await output(), code = await page.locator('.code-example pre').innerText()
  await dragWave('edited', .2, .8)
  const range = await page.locator('.range output').textContent()
  const selection = () => page.locator('#edited-wave').evaluate(track => [track.style.getPropertyValue('--selection-start'), track.style.getPropertyValue('--selection-end')])
  const selected = await selection()
  const invalid = [
    '.', '.gain(', '.gain(-', '.gain(-6', '.gain(-6).', '.gain(-6).reverse(',
    '.gain()', '.reverse(1)', '.fade(1, 2, 3)', '.gain(-6,)', '.gain(null)',
    '.gain(NaN)', '.gain(Infinity)', '.gain(1e309)', '.gain(1 + 1)',
    '.speed(0)', '.crop(0, 1)', '.crop({})', '.crop({ duration: -1 })',
    '.crop({ at: -1, duration: 1 })', '.crop({ at: 0, at: 1, duration: 1 })',
    '.crop({ duration: 1, other: 2 })', '.remove(0.5)', '.pad(0.5, { at: 0, duration: 1 })', '.gain({ at: 0, duration: 1 })', '.gain(-6, { at: -1, duration: 1 })', '.constructor()', '.constructor(1)', '.toString()', '.toString(1)',
    '.gain((window.executed = 1))', '.gain(-6);window.executed = 1',
    '.reverse()'.repeat(65), ' '.repeat(4097)
  ]
  for (const text of invalid) {
    await editChain(text)
    assert.equal(await editor().getAttribute('aria-invalid'), 'true', text)
    // Method suggestions hold the error back; once they close, it takes the readout and the selection waits behind it.
    if (await page.locator('#method-menu').isVisible()) await editor().press('Escape')
    assert.match(await page.locator('#demo-status').innerText(), /Preview unchanged/)
    assert(await page.locator('.range').isHidden())
    assert.equal(await page.locator('.code-example pre').innerText(), code)
    assert.deepEqual(await selection(), selected)
    assert(await button('Play edited audio').isEnabled())
  }
  assert.equal(await page.evaluate(() => window.executed), undefined)
  // A program with an error does not download: Escape brings back the applied one, whose preview never changed.
  assert(await downloadDisabled())
  await editor().press('Escape')
  assert.deepEqual(await output(), prior)
  assert.equal(await chain(), defaultChain)
  assert.equal(await editor().getAttribute('aria-invalid'), 'false')
  assert.equal(await page.locator('.range output').textContent(), range)
  // Failed submissions add no history entries.
  await undoAll()
  assert.equal(await chain(), '')
  await editChain('.gain(-6)')
  const result = await output()
  assert(result.channels[0].every((value, i) => Math.abs(value - pcm[i] * 10 ** (-6 / 20)) < 1 / 32767))
})

test('site: live typing preserves formatting and multiline input without Run or Reset controls', async () => {
  assert.equal(await button('Run').count(), 0)
  assert.equal(await button('Reset').count(), 0)
  await editChain('.gain(-6)')
  await editor().press('End')
  await editor().press('Enter')
  await editor().pressSequentially('.reverse()')
  await idle()
  assert.equal(await chain(), '.gain(-6)\n.reverse()')
  const changed = await output()
  assert.equal(changed.channels[0].length, 48000 * 8)
  // A menu edit over an invalid draft builds on the last valid chain.
  await fillChain('.bad(')
  await addMethod('gain')
  assert.equal(await chain(), '.gain(-6)\n.reverse()\n.gain(-6)')
  await undoEdit()
  assert.deepEqual(await output(), changed)
})

test('site: changing a numeric argument updates the bars, level reading and PCM without submitting', async () => {
  // Both lanes share one linear scale, full height at 0 dBFS: gain shows as bar height and in the reading.
  const pcm = tone(4800), top = Math.max(...pcm.map(Math.abs))
  const tallest = name => page.locator(`#${name}-wave .wave-glyphs`).first().evaluate(el => Math.max(...[...el.textContent].map(char => char.charCodeAt(0) - 0x100)))
  await upload(await file('live.wav', [pcm]))
  for (const db of [-3, -12, -6]) {
    await editChain(`.gain(${db})`)
    const expected = await reading([pcm], 48000, clip => clip.gain(db))
    await page.waitForFunction(text => document.querySelector('.meters').textContent === text, expected)
    // Amplitude is 10^(dB/20) of the source: dBFS is 20·log10 of a sample's magnitude (AES17).
    assert.equal(await tallest('edited'), Math.round(top * 10 ** (db / 20) * 100))
    assert.equal(await tallest('original'), Math.round(top * 100))
    const result = await output()
    assert.equal(result.channels[0].length, pcm.length)
    assert(result.channels[0].every((value, i) => Math.abs(value - pcm[i] * 10 ** (db / 20)) < 1 / 32767))
  }
})

test('site: edits typed during a delayed render keep the editor usable and the latest chain wins', async () => {
  const pcm = tone(4800)
  await upload(await file('queued.wav', [pcm]))
  await page.evaluate(async () => {
    const { default: audio } = await import('/assets/audio.js')
    const read = audio.fn.read
    audio.fn.read = function (...args) {
      audio.fn.read = read
      return new Promise((resolve, reject) => { window.finishRender = () => read.apply(this, args).then(resolve, reject) })
    }
  })
  await fillChain('.gain(-3)')
  await page.waitForFunction(() => window.finishRender)
  assert(await editor().isEnabled())
  await fillChain('.gain(-9)')
  await fillChain('.gain(-12).reverse()')
  await page.evaluate(() => finishRender())
  await idle()
  assert.equal(await chain(), '.gain(-12).reverse()')
  assert.match(await page.locator('.code-example pre').innerText(), /gain\(-12\)/)
  const result = await output()
  assert.equal(result.channels[0].length, pcm.length)
  assert(result.channels[0].every((value, i) => Math.abs(value - pcm.at(-1 - i) * 10 ** (-12 / 20)) < 1 / 32767))
})

test('site: pending edits resume after menu and Undo renders outlast the debounce timer', async () => {
  const pcm = tone(4800)
  await upload(await file('queued-history.wav', [pcm]))
  for (const operation of ['menu', 'Undo']) {
    await editChain('.gain(-6)')
    await page.evaluate(async () => {
      const { default: audio } = await import('/assets/audio.js')
      const read = audio.fn.read
      window.finishRender = null
      audio.fn.read = function (...args) {
        audio.fn.read = read
        return new Promise((resolve, reject) => { window.finishRender = () => read.apply(this, args).then(resolve, reject) })
      }
    })
    if (operation === 'menu') { await addButton().click(); await button('Add reverse').click() }
    else await editor().press('ControlOrMeta+z')
    await page.waitForFunction(() => window.finishRender)
    assert(await editor().isEnabled())
    await fillChain('.gain(-12).reverse()')
    // Let the scheduled apply encounter busy=true before releasing the render.
    await page.waitForTimeout(250)
    await page.evaluate(() => finishRender())
    await page.locator('.demo[aria-busy="false"]').waitFor({ timeout: 2000 })
    assert.equal(await chain(), '.gain(-12).reverse()')
    const result = await output()
    assert.equal(result.channels[0].length, pcm.length)
    assert(result.channels[0].every((value, i) => Math.abs(value - pcm.at(-1 - i) * 10 ** (-12 / 20)) < 1 / 32767), operation)
  }
})

test('site: pending edits resume on the previous source after a delayed file decode fails', async () => {
  const pcm = tone(4800)
  await upload(await file('kept.wav', [pcm]))
  await page.evaluate(() => {
    const decode = AudioContext.prototype.decodeAudioData
    AudioContext.prototype.decodeAudioData = function () {
      AudioContext.prototype.decodeAudioData = decode
      return new Promise((resolve, reject) => { window.failDecode = () => reject(new Error('decode failed')) })
    }
  })
  await page.locator('#audio-file').setInputFiles(await file('rejected.wav', [tone(2400, 330)]))
  await page.waitForFunction(() => window.failDecode)
  await fillChain('.gain(-9)')
  await page.waitForTimeout(250)
  await page.evaluate(() => failDecode())
  await page.locator('.demo[aria-busy="false"]').waitFor({ timeout: 2000 })
  assert.equal(await sourceName(), 'kept.wav')
  assert.equal(await chain(), '.gain(-9)')
  const result = await output()
  assert.equal(result.channels[0].length, pcm.length)
  assert(result.channels[0].every((value, i) => Math.abs(value - pcm[i] * 10 ** (-9 / 20)) < 1 / 32767))
})

test('site: IME composition delays rendering until the completed input', async () => {
  await page.evaluate(async () => {
    const { default: audio } = await import('/assets/audio.js')
    const read = audio.fn.read
    window.reads = 0
    audio.fn.read = function (...args) { reads++; return read.apply(this, args) }
  })
  await editor().focus()
  await editor().dispatchEvent('compositionstart')
  await fillChain('.gain(-6)')
  await editor().dispatchEvent('keydown', { key: 'Enter', isComposing: true })
  await editor().dispatchEvent('keydown', { key: 'Escape', isComposing: true })
  await page.waitForTimeout(250)
  assert.equal(await page.evaluate(() => reads), 0)
  assert.equal(await chain(), '.gain(-6)')
  await editor().dispatchEvent('compositionend')
  await idle()
  assert.equal(await page.evaluate(() => reads), 1)
})

test('site: method completion filters, wraps, accepts Tab or clicks, and ignores decimal dots', async () => {
  await fillChain('.')
  await idle()
  assert.equal(await page.getByRole('option').count(), 16)
  assert.equal(await page.locator('#method-menu .method-option svg').count(), 16)
  const scroll = await page.evaluate(() => scrollY)
  await editor().press('ArrowUp')
  assert.equal(await editor().getAttribute('aria-activedescendant'), 'method-eq')
  await editor().press('ArrowDown')
  assert.equal(await editor().getAttribute('aria-activedescendant'), 'method-trim')
  await editor().pressSequentially('sp')
  assert.equal(await page.getByRole('option').count(), 1)
  await editor().press('Tab'); await idle()
  assert.equal(await chain(), '.speed(1.25)')
  assert(await page.getByRole('slider', { name: 'Speed (×)' }).isVisible())
  assert.equal(await page.evaluate(() => scrollY), scroll)
  assert(await editor().evaluate(el => el === document.activeElement))
  await fillChain('.rev')
  await page.getByRole('option').click(); await idle()
  assert.equal(await chain(), '.reverse()')
  await fillChain('.fade(.')
  await page.getByRole('listbox').waitFor({ state: 'hidden' })
  // Escape keeps suggestions closed until the text changes, even when a late select event arrives.
  await fillChain('.ga')
  await editor().press('Escape')
  await page.getByRole('listbox').waitFor({ state: 'hidden' })
  await editor().evaluate(el => el.dispatchEvent(new Event('select')))
  await page.waitForTimeout(100)
  assert(await page.getByRole('listbox').isHidden())
  assert.equal(await chain(), '.ga')
  await editor().press('End')
  await editor().pressSequentially('i')
  assert.equal(await page.getByRole('option').count(), 1)
  // A completion changes the method itself without duplicating existing parentheses.
  await fillChain('.ga(-3)')
  await caret(3)
  await editor().press('Enter'); await idle()
  assert.equal(await chain(), '.gain(-6)')
  // In the name of an existing call, the caret offers that call's options rather than a one-item list.
  await caret(3)
  await page.locator('#parameter-menu').waitFor()
  assert(await page.getByRole('listbox').isHidden())
  assert.deepEqual(await page.getByRole('slider').evaluateAll(sliders => sliders.filter(el => el.closest('#parameter-menu')).map(el => el.getAttribute('aria-label'))), ['Gain (dB)'])
})

test('site: the caret in an existing call opens its options: a slider per number, each changing only its own', async () => {
  await editChain('.fade(0.02, 0.1, { at: 1, duration: 2 })\n.reverse()')
  const sliders = () => page.locator('#parameter-menu input').evaluateAll(inputs => inputs.map(el => el.getAttribute('aria-label')))
  // Anywhere in the call, name included.
  await caret(3)
  await page.locator('#parameter-menu').waitFor()
  assert.deepEqual(await sliders(), ['Fade in (s)', 'Fade out (s)', 'Start (s)', 'Duration (s)'])
  // Nothing is marked until a number is chosen.
  assert.equal(await page.locator('.program-highlight mark').count(), 0)
  const control = page.getByRole('slider', { name: 'Start (s)' })
  await control.dispatchEvent('pointerdown')
  await control.evaluate(el => { el.value = '1.25'; el.dispatchEvent(new Event('input', { bubbles: true })) })
  assert.equal(await page.locator('.program-highlight mark').textContent(), '1.25')
  await control.evaluate(el => { el.value = '0.5'; el.dispatchEvent(new Event('input', { bubbles: true })) })
  await idle()
  assert.equal(await chain(), '.fade(0.02, 0.1, { at: 0.5, duration: 2 })\n.reverse()')
  // The later number moved with the shorter text: its slider still edits it.
  await page.getByRole('slider', { name: 'Duration (s)' }).evaluate(el => { el.value = '1.5'; el.dispatchEvent(new Event('input', { bubbles: true })) })
  await idle()
  assert.equal(await chain(), '.fade(0.02, 0.1, { at: 0.5, duration: 1.5 })\n.reverse()')
  // A call without numbers offers nothing.
  await editor().press('Escape')
  await editor().evaluate(el => { const i = el.value.indexOf('reverse') + 2; el.setSelectionRange(i, i); el.dispatchEvent(new Event('select')) })
  await page.waitForTimeout(150)
  assert(await page.locator('#parameter-menu').isHidden())
  assert(await page.getByRole('listbox').isHidden())
})

test('site: a parameter slider updates only its number, renders during a drag and undoes the gesture once', async () => {
  const pcm = tone(4800)
  await upload(await file('slider.wav', [pcm]))
  await editChain('.gain(-6)')
  const prior = await output()
  await editor().focus()
  await caret(6, 8)
  const control = page.getByRole('slider', { name: 'Gain (dB)' })
  await control.waitFor()
  await control.dispatchEvent('pointerdown')
  for (const value of [-8, -10, -12]) {
    await control.evaluate((el, value) => { el.value = value; el.dispatchEvent(new Event('input', { bubbles: true })) }, String(value))
    await idle()
    assert.equal(await chain(), `.gain(${value})`)
    // The adjusted value stays marked in the code while the slider has focus, in the colors of selected text.
    assert.equal(await page.locator('.program-highlight mark').textContent(), String(value))
    assert(await page.evaluate(() => {
      const mark = document.querySelector('.program-highlight mark'), selected = getComputedStyle(document.querySelector('.program-editor'), '::selection')
      return getComputedStyle(mark.querySelector('.syntax-number')).color === selected.color && getComputedStyle(mark).backgroundColor === selected.backgroundColor
    }))
    assert.match(await page.locator('.code-example pre').innerText(), new RegExp(`gain\\(${value}\\)`))
  }
  await control.dispatchEvent('pointerup')
  const changed = await output()
  assert(changed.channels[0].every((value, i) => Math.abs(value - pcm[i] * 10 ** (-12 / 20)) < 1 / 32767))
  await undoEdit()
  assert.equal(await chain(), '.gain(-6)')
  assert.deepEqual(await output(), prior)
})

test('site: editor focus hides waveform cursors and highlights code without a focus decoration', async () => {
  await cursor('original', 400)
  const before = await slider('original').inputValue()
  await editor().focus()
  const styles = await page.evaluate(() => {
    const input = document.querySelector('.program-editor'), style = getComputedStyle(input)
    return { outline: style.outlineStyle, shadow: style.boxShadow, background: style.backgroundColor, cursors: [...document.querySelectorAll('.wave-track')].map(el => getComputedStyle(el, '::after').opacity) }
  })
  assert.equal(styles.outline, 'none')
  assert.equal(styles.shadow, 'none')
  assert.equal(styles.background, 'rgba(0, 0, 0, 0)')
  assert.deepEqual(styles.cursors, ['0', '0'])
  assert.equal(await slider('original').inputValue(), before)
  // The whole program is plain code: audio('…'), the edits, .save('…').
  assert.equal(await page.locator('.program-highlight').textContent(), programOf() + '\n')
  assert.deepEqual(await page.locator('.program-highlight .syntax-call').allTextContents(), ['audio', 'trim', 'normalize', 'fade', 'save'])
  assert.equal(await page.locator('.program-highlight .syntax-number').count(), 3)
  await editChain('.gain(-1e-7).fade(.02, .1)')
  assert.deepEqual(await page.locator('.program-highlight .syntax-number').allTextContents(), ['-1e-7', '.02', '.1'])
  await addButton().focus()
  // Each track keeps its caret; the active one is white.
  assert.deepEqual(await page.locator('.wave-track').evaluateAll(tracks => tracks.map(el => getComputedStyle(el, '::after').opacity)), ['1', '1'])
  await editChain('.reverse()'.repeat(64))
  await editor().evaluate(el => { el.scrollTop = 80; el.dispatchEvent(new Event('scroll')) })
  assert.equal(await page.locator('.program-highlight').evaluate(el => el.scrollTop), await editor().evaluate(el => el.scrollTop))
})

test('site: names and numbers light under the pointer; a name lists its choices: samples and a file, or downloads', async () => {
  const lit = () => page.locator('.program-highlight .lit').allTextContents()
  const at = async choice => { const box = await page.locator(`.program-highlight [data-choice="${choice}"]`).first().boundingBox(); await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2) }
  const selected = await editor().evaluate(el => getComputedStyle(el, '::selection').backgroundColor)
  await at('param')
  assert.deepEqual(await lit(), ['-1'])
  assert.equal(await page.locator('.program-highlight .lit').evaluate(el => getComputedStyle(el).backgroundColor), selected)
  await at('source')
  assert.deepEqual(await lit(), ['chime'])
  await page.mouse.move(0, 0)
  assert.deepEqual(await lit(), [])
  // The program is only code: no buttons ride its lines.
  assert.equal(await page.locator('.program button').count(), 0)
  // audio(…) lists the samples; one keeps the edits and names the download after itself. The second is chosen from
  // the list, the third typed.
  const [, second, third] = Object.keys(built)
  await clickName('source')
  assert.deepEqual((await page.getByRole('option').allTextContents()).map(text => text.match(/^[a-z]+|^Open a file…/)[0]), [...Object.keys(built), 'Open a file…'])
  await page.getByRole('option', { name: new RegExp(`^${second}\\b`) }).click(); await idle()
  assert.equal(await editor().inputValue(), programOf(defaultChain, second, `${second}.wav`))
  await page.getByRole('listbox').waitFor({ state: 'hidden' })
  assert.equal(await page.locator('.audio-row .duration').first().textContent(), shown(second))
  // .save('…') lists the formats, each the download named as it arrives; one writes its extension and downloads.
  await clickName('save')
  assert.equal(await page.getByRole('listbox').getAttribute('aria-label'), 'Download')
  assert.deepEqual((await page.getByRole('option').allTextContents()).map(text => /^\S+\.(wav|mp3)/.exec(text)[0]), [`${second}.wav`, `${second}.mp3`])
  const downloaded = page.waitForEvent('download')
  await page.getByRole('option', { name: new RegExp(`^${second}\\.mp3`) }).click()
  assert.equal((await downloaded).suggestedFilename(), `${second}.mp3`); await idle()
  assert.equal(await editor().inputValue(), programOf(defaultChain, second, `${second}.mp3`))
  // Only Enter or a click downloads: Tab leaves the list.
  let downloads = 0
  page.on('download', () => downloads++)
  await clickName('save')
  await editor().press('Tab')
  await page.getByRole('listbox').waitFor({ state: 'hidden' })
  assert.equal(downloads, 0)
  // Typing a sample's name switches to it; an unknown name, or a file name while a sample plays, is refused.
  await editor().fill(programOf(defaultChain, third, `${second}.mp3`)); await idle()
  assert.equal(await sourceName(), third)
  assert.equal(await page.locator('.audio-row .duration').first().textContent(), shown(third))
  assert(!Object.hasOwn(built, 'drums'))
  await editor().fill(programOf(defaultChain, 'drums', `${second}.mp3`)); await idle()
  assert.match(await message(), /no sample named drums/)
  await editor().press('Escape')
  await editor().fill(programOf(defaultChain, 'take.wav', `${second}.mp3`)); await idle()
  assert.match(await message(), /Open a file from the list in audio/)
  await editor().press('Escape')
  // "Open a file…", the list's last item, opens the picker.
  await clickName('source')
  const chooser = page.waitForEvent('filechooser')
  await page.getByRole('option', { name: /^Open a file/ }).click()
  await chooser
})

test('site: every sample is generated sound: stereo, finite, silent at both edges, its length, and near -16 LUFS', async () => {
  // Generated, not random: making a sample twice gives the same samples.
  for (const [name, { make }] of Object.entries(built)) assert.deepEqual(make(), make(), name)
  // Loudness targets -16 LUFS, which the library measures per ITU-R BS.1770.
  for (const name of Object.keys(built)) {
    await editor().fill(programOf('', name, name + '.wav')); await idle()
    assert.equal(await page.locator('.audio-row .duration').first().textContent(), shown(name))
    const clip = audio(new Uint8Array((await exported()).bytes).buffer), channels = await clip.read(), edge = Math.round(.3 * clip.sampleRate)
    assert.equal(channels.length, 2, name)
    for (const pcm of channels) {
      assert(pcm.every(Number.isFinite), name)
      assert(pcm.subarray(0, edge).every(v => Math.abs(v) < 1e-3) && pcm.subarray(-edge).every(v => Math.abs(v) < 1e-3), `${name}: edges below -60 dBFS`)
    }
    const lufs = await clip.stat('loudness')
    assert(Math.abs(lufs + 16) < 1.5, `${name}: ${lufs.toFixed(1)} LUFS`)
  }
})

test('site: a length reads its tenths exactly: 441,600 frames at 48 kHz show 0:09.2, a millisecond less 0:09.1', async () => {
  // 441,600 / 48,000 is the double just below 9.2: flooring its tenths directly read 0:09.1. Tenths floor at the
  // millisecond: 441,552 frames, 9.199 s, still read 0:09.1.
  await upload(await file('tenths.wav', [tone(441600)]))
  assert.equal(await page.locator('.audio-row .duration').first().textContent(), '0:09.2')
  await upload(await file('tenths-less.wav', [tone(441552)]))
  assert.equal(await page.locator('.audio-row .duration').first().textContent(), '0:09.1')
})

test('site: the extension in .save(\'…\') picks the format: a real MP3 lazily, WAV again preserves PCM, others are refused', async () => {
  const requested = []
  page.on('request', request => requested.push(request.url()))
  await upload(await file('formats.wav', [tone(24000)]))
  const prior = await output()
  assert(!requested.some(url => url.endsWith('/mp3.js')))
  const mp3 = await exported('MP3')
  assert.match(await editor().inputValue(), /\.save\('formats-edited\.mp3'\)$/)
  assert.equal(mp3.filename, 'formats-edited.mp3')
  assert(requested.some(url => url.endsWith('/mp3.js')))
  assert(mp3.bytes.subarray(0, 3).toString() === 'ID3' || (mp3.bytes[0] === 255 && (mp3.bytes[1] & 224) === 224))
  const result = await decode(mp3.bytes), samples = result.channels[0]
  assert.equal(result.channels.length, prior.channels.length)
  assert(Math.abs(samples.length - prior.channels[0].length) <= 2304)
  assert(samples.every(Number.isFinite))
  assert(Math.max(...samples.map(Math.abs)) > .5)
  const restored = await exported('WAV')
  assert.equal(restored.filename, 'formats-edited.wav')
  assert.deepEqual(await decode(restored.bytes), prior)
  // The name is the file: typed, it downloads as typed.
  await editor().fill((await editor().inputValue()).replace("'formats-edited.wav'", "'take 2.wav'")); await idle()
  const renamed = page.waitForEvent('download')
  await saveAs()
  assert.equal((await renamed).suggestedFilename(), 'take 2.wav')
  // An extension the demo cannot encode is refused in the readout; choosing a format from the list fixes the name and saves.
  await editor().fill((await editor().inputValue()).replace("'take 2.wav'", "'take 2.ogg'")); await idle()
  assert.match(await message(), /Save as \.wav or \.mp3, not \.ogg/)
  const fixed = page.waitForEvent('download')
  await saveAs('WAV')
  assert.equal((await fixed).suggestedFilename(), 'take 2.wav')
  assert.equal(await message(), '')
})

test('site: typed crop accepts the final sample, zero work and reversed field order', async () => {
  await upload(await file('one-typed.wav', [new Float32Array([.25])]))
  for (const code of ['', '.crop({ duration: 1e-4, at: 0 }).gain(0)', '.speed(-1)']) {
    await editChain(code)
    const result = await output()
    assert.equal(result.channels[0].length, 1)
    assert(Math.abs(result.channels[0][0] - .25) < 1 / 32767)
  }
  for (const code of ['.crop({ duration: 0 })', '.crop({ at: 0.0001, duration: 1 })']) {
    await editChain(code)
    assert.match(await message(), /removed all samples/)
    assert(await downloadDisabled())
    assert(await button('Play original audio').isEnabled())
    await undoEdit()
    assert.equal((await output()).channels[0].length, 1)
  }
})

test('site: excessive duration and nonfinite sample results disable output and recover with another chain', async () => {
  await upload(await file('limits.wav', [tone(4800)]))
  for (const code of ['.speed(1e-9)', '.gain(1e6)', '.gain(400).gain(400)']) {
    await editChain(code)
    assert(await downloadDisabled())
    assert(await button('Play edited audio').isDisabled())
    assert(await button('Play original audio').isEnabled())
    assert.match(await message(), /within two minutes|could not be applied/)
    await editChain('.reverse()')
    assert.equal(await message(), '')
    const result = await output()
    assert.equal(result.channels[0].length, 4800)
    assert(result.channels[0].every(Number.isFinite))
  }
})

test('site: grayscale highlighting keeps literal code in every tab, and the underline follows the chosen tab', async () => {
  await addProcessing('gain')
  for (const tab of ['Node.js', 'Browser', 'CLI', 'MCP']) {
    await button(tab).click()
    // The underline sits under the chosen tab.
    assert(await button(tab).evaluate(el => getComputedStyle(el.parentElement).getPropertyValue('--tab-x') === el.offsetLeft + 'px' && getComputedStyle(el.parentElement).getPropertyValue('--tab-w') === el.offsetWidth + 'px'))
    const code = await page.locator('.code-example pre').innerText()
    assert(await page.locator('.code-example pre [class^="syntax-"]').count() > 0)
    assert.equal(await page.locator('.code-example pre input').count(), 0)
    if (tab === 'Browser') assert(code.includes('<input type="file">'))
    const colors = await page.locator('.code-example pre [class^="syntax-"]').evaluateAll(tokens => {
      const context = document.createElement('canvas').getContext('2d')
      return tokens.map(token => { context.fillStyle = getComputedStyle(token).color; context.fillRect(0, 0, 1, 1); return [...context.getImageData(0, 0, 1, 1).data] })
    })
    assert(colors.every(([r, g, b]) => r === g && g === b))
  }
})

test('site: generated CLI preserves typed fade direction, zero durations and exponent arguments', async () => {
  const dir = await mkdtemp(resolve(tmpdir(), 'audio-site-cli-'))
  try {
    const input = await file('recording.wav', [Float32Array.from({ length: 4800 }, (_, i) => .2 + .05 * Math.sin(i / 20))])
    await writeFile(resolve(dir, input.name), input.buffer)
    await upload(input)
    await button('CLI').click()
    for (const chain of [
      '.fade(0.02)', '.fade(-0.02)', '.fade(0, 0.02)', '.fade(0.02, 0)', '.fade(0.02, 0.04)',
      '.normalize(-1e-7).gain(-1e-7).fade(1e-7)', '.gain(-1e21)',
      '.crop({ at: 1e-7, duration: 0.05 })', '.crop({ at: 0, duration: 1e308 })',
      '.remove({ at: 0.01, duration: 0.02 })', '.remove({ at: 0.05, duration: 1e308 })',
      '.pitch(7)', '.stretch(1.5)', '.lowpass(1000)', '.highpass(500)', '.eq(1000, 6, 2)', '.pad(0.01, 0.02)', '.repeat(2)', '.shrink(0.01)',
      '.gain(-6, { at: 0.02, duration: 0.03 })', '.fade(0.01, 0.01, { at: 0.02, duration: 0.05 })', '.reverse({ at: 0.01, duration: 0.02 })', '.lowpass(800, { at: 0.03, duration: 0.04 })'
    ]) {
      await editChain(chain)
      const expected = await output()
      const code = await page.locator('.code-example pre').innerText()
      const command = code.split('\n\n').find(part => part.startsWith('audio recording.wav'))
      const args = command.replace(/\\\n/g, ' ').trim().split(/\s+/).slice(1)
      // Execute exactly the displayed command, without a shell or mirrored formatter.
      await promisify(execFile)(process.execPath, [resolve(root, 'bin/cli.js'), ...args, '--force'], { cwd: dir })
      const actual = await decode(await readFile(resolve(dir, 'edited.wav')))
      assert.equal(actual.rate, expected.rate, chain)
      assert.equal(actual.channels.length, expected.channels.length, chain)
      for (let c = 0; c < actual.channels.length; c++) {
        assert.equal(actual.channels[c].length, expected.channels[c].length, chain)
        assert(actual.channels[c].every((value, i) => Number.isFinite(value) && Math.abs(value - expected.channels[c][i]) < 1 / 32767), chain)
      }
    }
  } finally { await rm(dir, { recursive: true, force: true }) }
})

// The add menu appends a method with its default arguments.
async function addMethod(name) {
  await addButton().click()
  await button('Add ' + name).click()
  await idle()
  await page.locator('#add-menu').waitFor({ state: 'hidden' })
}

test('site: the add menu appends each method with its defaults, and Undo removes it', async () => {
  const pcm = tone(24000)
  await upload(await file('menu.wav', [pcm]))
  await undoAll()
  await addMethod('gain')
  assert.equal(await chain(), '.gain(-6)')
  const quiet = await output()
  assert(quiet.channels[0].every((value, i) => Math.abs(value - pcm[i] * 10 ** (-6 / 20)) < 1 / 32767))
  for (const tab of ['Node.js', 'Browser', 'CLI', 'MCP']) {
    await button(tab).click()
    assert.match(await page.locator('.code-example pre').innerText(), /gain/)
  }
  await addMethod('reverse')
  assert.equal(await chain(), '.gain(-6)\n.reverse()')
  const reversed = await output()
  assert(reversed.channels[0].every((value, i) => Math.abs(value - pcm.at(-1 - i) * 10 ** (-6 / 20)) < 1 / 32767))
  await undoEdit()
  assert.deepEqual(await output(), quiet)
  // Every method in the menu adds its own call, which the editor accepts back.
  const names = await page.locator('#add-menu button').evaluateAll(buttons => buttons.map(button => button.getAttribute('aria-label').slice(4)))
  assert.deepEqual(names, ['trim', 'crop', 'remove', 'pad', 'shrink', 'repeat', 'reverse', 'gain', 'normalize', 'fade', 'speed', 'stretch', 'pitch', 'lowpass', 'highpass', 'eq'])
  for (const name of names) {
    await editChain('')
    await addMethod(name)
    assert.match(await chain(), new RegExp(`^\\.${name}\\(`))
    assert.equal(await editor().getAttribute('aria-invalid'), 'false')
  }
})

test('site: the add menu stays usable on an empty result, and Undo recovers the samples', async () => {
  await upload(await file('silent-menu.wav', [new Float32Array(4800)]))
  assert(await button('Play edited audio').isDisabled())
  assert(await downloadDisabled())
  assert(await addButton().isEnabled())
  await addMethod('gain')
  assert.match(await message(), /removed all samples/)
  // The defaults' three steps and the added gain.
  for (let i = 0; i < 4; i++) await undoEdit()
  assert.equal(await chain(), '')
  assert.equal(await message(), '')
  const silent = await output()
  assert.equal(silent.channels[0].length, 4800)
  assert(silent.channels[0].every(value => value === 0))
})

test('site: menu edits stop playback, clear the selection, and recover after a render error', async () => {
  // Long enough (1.6 s selected) that playback is still running when the menu edit lands, even under load.
  const pcm = tone(48000 * 4)
  await upload(await file('recover-menu.wav', [pcm]))
  await dragWave('edited', .1, .9)
  await watchPlayback()
  await button('Play edited audio').click()
  await page.waitForFunction(() => played.length === 1)
  await page.evaluate(async () => {
    const { default: audio } = await import('/assets/audio.js')
    const read = audio.fn.read
    audio.fn.read = function () { audio.fn.read = read; return Promise.reject(new Error('render failed')) }
  })
  assert(await button('Pause edited audio').isVisible())
  await addMethod('gain')
  assert.match(await message(), /could not be applied/)
  assert(await button('Play edited audio').isDisabled())
  assert(await downloadDisabled())
  assert(await button('Play original audio').isEnabled())
  assert.equal(await page.locator('.range').count(), 0)
  assert.equal(await page.evaluate(() => stops), 1)
  await editChain('.reverse()')
  assert.equal(await message(), '')
  const restored = await output()
  assert(restored.channels[0].every((value, i) => Math.abs(value - pcm.at(-1 - i)) < 1 / 32767))
})

test('site: Open a file… and the keyboard open the file picker; cancel and same-file reuse preserve audio', async () => {
  const prior = await output()
  let chooser = page.waitForEvent('filechooser')
  await chooseFile()
  await (await chooser).setFiles([])
  assert.deepEqual(await output(), prior)
  const source = await file('title.wav', [tone(4800)])
  chooser = page.waitForEvent('filechooser')
  await chooseFile()
  await (await chooser).setFiles(source); await idle()
  assert.equal(await sourceName(), 'title.wav')
  const changed = await output()
  chooser = page.waitForEvent('filechooser')
  await page.getByLabel('Open file', { exact: true }).focus()
  await page.keyboard.press('Space')
  await (await chooser).setFiles(source); await idle()
  assert.deepEqual(await output(), changed)
})

test('site: the add menu supports keyboard boundaries, dismissal and focus return', async () => {
  const [id, first, last] = ['#add-menu', 'Add trim', 'Add eq'], plus = await addButton().elementHandle()
  const trigger = { focus: () => plus.focus(), click: () => plus.click(), evaluate: fn => plus.evaluate(fn) }
  await trigger.focus()
  await page.keyboard.press('ArrowDown')
  assert(await page.locator(id).isVisible())
  assert.equal(await page.locator(':focus').getAttribute('aria-label'), first)
  await page.keyboard.press('End')
  assert.equal(await page.locator(':focus').getAttribute('aria-label'), last)
  await page.keyboard.press('ArrowDown')
  assert.equal(await page.locator(':focus').getAttribute('aria-label'), first)
  await page.keyboard.press('ArrowUp')
  assert.equal(await page.locator(':focus').getAttribute('aria-label'), last)
  await page.keyboard.press('Home')
  assert.equal(await page.locator(':focus').getAttribute('aria-label'), first)
  await page.keyboard.press('Escape')
  await page.locator(id).waitFor({ state: 'hidden' })
  assert(await trigger.evaluate(button => button === document.activeElement))
  await trigger.click()
  await page.locator('h1').click()
  await page.locator(id).waitFor({ state: 'hidden' })
  await trigger.focus()
  await page.keyboard.press('ArrowUp')
  await page.keyboard.press('Enter'); await idle()
  await page.locator(id).waitFor({ state: 'hidden' })
  assert(await trigger.evaluate(button => button === document.activeElement))
  assert.equal(await chain(), defaultChain + '\n.eq(1000, 6)')
})

test('site: the open add menu stays in the viewport after resize and follows its trigger on scroll', async () => {
  const id = '#add-menu', trigger = () => addButton()
  await page.setViewportSize({ width: 1440, height: 1000 })
  await trigger().click()
  await page.setViewportSize({ width: 320, height: 900 })
  await page.waitForFunction(id => {
    const rect = document.querySelector(id).getBoundingClientRect()
    return rect.left >= 16 && rect.right <= innerWidth - 16 && rect.top >= 16 && rect.bottom <= innerHeight - 16
  }, id, { timeout: 2000 })
  await trigger().evaluate(el => window.scrollTo({ top: scrollY + el.getBoundingClientRect().top - 250, behavior: 'instant' }))
  await page.waitForFunction(id => {
    const rect = document.querySelector(id).getBoundingClientRect(), anchor = document.querySelector(`[popovertarget="${id.slice(1)}"]`).getBoundingClientRect()
    // Below the trigger by 8 px, or above it when there is no room below.
    return Math.abs(rect.top - anchor.bottom - 8) < 1 || Math.abs(anchor.top - rect.bottom - 8) < 1
  }, id, { timeout: 2000 })
  const before = await page.locator(id).boundingBox()
  await page.evaluate(() => window.scrollBy({ top: 50, behavior: 'instant' }))
  await page.waitForFunction(({ id, top }) => Math.abs(document.querySelector(id).getBoundingClientRect().top - top + 50) < 1, { id, top: before.y }, { timeout: 2000 })
  await page.keyboard.press('Escape')
  await page.locator(id).waitFor({ state: 'hidden' })
})

// The page's reading: sample peak in dBFS.
const signed = value => (value < 0 ? '−' : value > 0 ? '+' : '') + Math.abs(value).toFixed(1)
// The reading the page must show: the same engine measuring the same samples in Node.
async function reading(pcm, sampleRate, edit) {
  const clip = audio.from(pcm, { sampleRate })
  edit(clip)
  const db = await audio.from(await clip.read(), { sampleRate }).stat('db')
  return `${Number.isFinite(db) ? signed(db) : '−∞'} dBFS`
}
// The readout shows the active track's levels beside its position.
const meter = () => page.locator('.meters').textContent()
const measured = () => page.waitForFunction(() => { const text = document.querySelector('.meters').textContent; return text && !text.includes('…') })

test('site: the readout shows the active track\'s levels, the library measuring the same PCM', async () => {
  const pcm = [tone(48000), tone(48000, 330, .1)]
  await upload(await file('meters.wav', pcm))
  // Differential: the same engine measures the same samples in Node; the page must show exactly this.
  const levels = async edit => {
    const clip = audio.from(pcm, { sampleRate: 48000 })
    edit(clip)
    const db = await audio.from(await clip.read(), { sampleRate: 48000 }).stat('db')
    return `${signed(db)} dBFS`
  }
  await measured()
  const edited = await meter()
  assert.equal(edited, await levels(clip => clip.trim().normalize(-1).fade(.02, .1)))
  assert.match(edited, /^−1\.0 dBFS$/)
  // Seeking a track makes it active, and the readout follows with its reading.
  await cursor('original', 0)
  await measured()
  assert.equal(await meter(), await levels(() => {}))
  await cursor('edited', 0)
  assert.equal(await meter(), edited)
  // An edit keeps the last reading on screen until the new one arrives: no blank '…' in between.
  await page.evaluate(() => {
    const meter = document.querySelector('.meters')
    window.readings = []
    new MutationObserver(() => readings.push(meter.textContent)).observe(meter, { childList: true, characterData: true, subtree: true })
  })
  await editChain('.gain(-6)')
  const gained = await levels(clip => clip.gain(-6))
  await page.waitForFunction(text => document.querySelector('.meters').textContent === text, gained)
  assert(!(await page.evaluate(() => readings)).includes('…'))
  // Silence has no peak and no gated loudness; trimming it to nothing leaves nothing to measure.
  await upload(await file('silence.wav', [new Float32Array(4800)]))
  await measured()
  assert.equal(await meter(), '–')
  await cursor('original', 0)
  await measured()
  assert.equal(await meter(), '−∞ dBFS')
})

test('site: the demo shows the program: one editable chain from the opened file to the saved one, in its format', async () => {
  assert.equal(await editor().inputValue(), programOf())
  assert.equal(await page.locator('.program-highlight').textContent(), programOf() + '\n')
  await exported('MP3')
  assert.equal(await editor().inputValue(), programOf(defaultChain, 'chime', 'chime.mp3'))
  const expected = { 'Node.js': "save('edited.mp3')", Browser: "encode('mp3')", CLI: 'save edited.mp3' }
  for (const [tab, text] of Object.entries(expected)) {
    await button(tab).click()
    const code = await page.locator('.code-example pre').innerText()
    assert(code.includes(text), tab)
    if (tab === 'Browser') assert(code.includes("type: 'audio/mpeg'"))
  }
  // Opening a file names both ends after it, in the chosen format.
  await upload(await file('field.wav', [tone(4800)]))
  assert.equal(await editor().inputValue(), programOf(defaultChain, 'field.wav', 'field-edited.mp3'))
  // Both ends are required.
  const field = programOf(defaultChain, 'field.wav', 'field-edited.mp3')
  for (const [code, error] of [[field.replace("audio('field.wav')", "open('field.wav')"), /Start with audio/], [field.replace(/\n {2}\.save\(.*\)$/, ''), /End with \.save/]]) {
    await editor().fill(code); await idle()
    assert.match(await message(), error)
    await editor().press('Escape')
  }
})

test('site: the devices keep their height through chain errors, selection, playback errors, files, formats and tabs', async () => {
  // Only code edits may resize a device; every other interaction fills a reserved slot.
  const height = selector => page.locator(selector).evaluate(el => el.getBoundingClientRect().height)
  const same = async (selector, expected, step) => assert(Math.abs(await height(selector) - expected) < .5, step)
  const demo = await height('.demo')
  // A chain error shows in the readout, so an invalid chain of the same lines keeps the height.
  await editChain(defaultChain.replace('.fade(0.02, 0.1)', '.fade('))
  assert.match(await message(), /Preview unchanged/)
  await same('.demo', demo, 'chain error')
  await editor().press('Escape')
  await dragWave('edited', .2, .6)
  assert.equal(await page.locator('.range').count(), 1)
  await same('.demo', demo, 'selection')
  await slider('edited').press('Escape')
  await same('.demo', demo, 'clear')
  await page.evaluate(() => {
    const resume = AudioContext.prototype.resume
    AudioContext.prototype.resume = function () { AudioContext.prototype.resume = resume; return Promise.reject(new Error('resume failed')) }
  })
  await button('Play edited audio').click()
  assert.match(await message(), /playback is unavailable/)
  assert.equal(await page.locator('.timecode').isVisible(), false)
  await same('.demo', demo, 'playback error')
  await upload(await file('field-recording.wav', [tone(4800)]))
  await same('.demo', demo, 'file')
  await exported('MP3')
  await same('.demo', demo, 'format')
  const code = await height('.code-example')
  for (const tab of ['Browser', 'CLI', 'MCP', 'Node.js']) {
    await button(tab).click()
    await same('.code-example', code, tab)
  }
})

test('site: a slider drag keeps the waveform and controls steady until each render lands', async () => {
  await upload(await file('steady.wav', [tone(48000)]))
  await editChain('.fade(0.02, 0.1)')
  await editor().focus()
  await caret(12, 15)
  const control = page.getByRole('slider', { name: 'Fade out (s)' })
  await control.waitFor()
  const before = await page.locator('#edited-wave .wave-glyphs').first().textContent()
  // Sample every frame of the drag: tracks and controls never fade, the waveform is never blank.
  await page.evaluate(() => {
    const watched = ['#original-wave', '#edited-wave', '.audio-row .play', '.edited-row .play', '.program-editor', '.undo', '.tool.add'].map(selector => document.querySelector(selector))
    window.samples = []
    window.watching = true
    const watch = () => {
      samples.push({ opacity: watched.map(el => getComputedStyle(el).opacity), bars: document.querySelector('#edited-wave .wave-glyphs').textContent.length })
      if (watching) requestAnimationFrame(watch)
    }
    watch()
  })
  await control.dispatchEvent('pointerdown')
  for (const value of [.3, .4, .5, .6, .7]) {
    await control.evaluate((el, value) => { el.value = value; el.dispatchEvent(new Event('input', { bubbles: true })) }, String(value))
    await page.waitForTimeout(40)
  }
  await control.dispatchEvent('pointerup')
  await idle()
  const samples = await page.evaluate(() => { window.watching = false; return window.samples })
  assert(samples.length > 5)
  assert(samples.every(sample => sample.opacity.every((value, i) => value === samples[0].opacity[i])), 'a track or control faded during the drag')
  assert(samples.every(sample => sample.bars > 0), 'the waveform was cleared during the drag')
  assert.notEqual(await page.locator('#edited-wave .wave-glyphs').first().textContent(), before)
})

test('site: both tracks stay drawn in full with their carets; a press activates its track and moves its caret at once', async () => {
  const look = name => page.locator(`#${name}-wave`).evaluate(track => {
    const row = track.closest('.audio-row'), style = el => getComputedStyle(el)
    return { track: style(track).opacity, play: style(row.querySelector('.play')).opacity, caret: style(track, '::after').opacity, label: style(row.querySelector('.wave-label')).color }
  })
  await page.mouse.move(0, 0)
  const active = await look('edited'), inactive = await look('original')
  assert.deepEqual([active.track, active.play, active.caret], ['1', '1', '1'])
  assert.deepEqual([inactive.track, inactive.play, inactive.caret], ['1', '1', '1'])
  assert.notEqual(inactive.label, active.label)
  // The pointer over a track lights its label, nothing else; nothing a track switch changes is animated.
  const box = await page.locator('#original-wave').boundingBox()
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  assert.deepEqual(await look('original'), { ...inactive, label: active.label })
  const animated = (selector, props) => page.locator(selector).first().evaluate((el, props) => {
    const style = getComputedStyle(el), names = style.transitionProperty.split(', '), times = style.transitionDuration.split(', ')
    return names.filter((name, i) => parseFloat(times[i % times.length]) > 0 && (name === 'all' || props.includes(name)))
  }, props)
  assert.deepEqual(await animated('.wave-label', ['color']), [])
  // The press itself makes the track active and puts its caret under the pointer, before any release.
  await page.mouse.move(box.x + box.width * .3, box.y + box.height / 2)
  await page.mouse.down()
  assert.equal(await page.locator('.audio-row.active .track-name').textContent(), 'Original')
  assert(Math.abs(+(await slider('original').inputValue()) - 300) <= 2)
  await page.mouse.up()
  assert(Math.abs(+(await slider('original').inputValue()) - 300) <= 2)
  assert.deepEqual(await look('edited'), { ...active, label: inactive.label })
})

test('site: a selected range shows its peak in dBFS, the library measuring the same samples', async () => {
  const pcm = [tone(48000), tone(48000, 330, .1)]
  await upload(await file('range.wav', pcm))
  await dragWave('original', .3, .45)
  const [at, end] = await page.evaluate(() => {
    const track = document.querySelector('#original-wave'), style = track.style
    return [parseFloat(style.getPropertyValue('--selection-start')), parseFloat(style.getPropertyValue('--selection-end'))]
  })
  const clip = audio.from(pcm, { sampleRate: 48000 })
  const db = await clip.stat('db', { at: at / 100, duration: (end - at) / 100 })
  await page.waitForFunction(() => /dBFS$/.test(document.querySelector('.range .meters')?.textContent || ''))
  assert.equal(await page.locator('.range .meters').textContent(), `${Number.isFinite(db) ? signed(db) : '−∞'} dBFS`)
  // A quiet stretch reads lower than the whole track.
  await dragWave('original', .05, .2)
  await page.waitForFunction(text => document.querySelector('.range .meters')?.textContent !== text, `${signed(db)} dBFS`)
  assert.equal(await page.locator('.range .meters').textContent(), '−∞ dBFS')
})

test('site: Undo and + share the readout; + appends; a range reads start–end on one line, its peak on its baseline', async () => {
  assert.deepEqual(await page.locator('.readout button').evaluateAll(buttons => buttons.map(el => el.getAttribute('aria-label'))), ['Undo', 'Add a method'])
  await addMethod('gain')
  assert.equal(await chain(), defaultChain + '\n.gain(-6)')
  // One line, and the peak stands on the same baseline, down to the narrowest screen.
  const line = () => page.locator('.range').evaluate(range => {
    const [times, meter] = range.children, slot = range.parentElement.getBoundingClientRect(), box = times.getBoundingClientRect()
    const baseline = el => { const probe = document.createElement('span'); probe.style.cssText = 'display: inline-block; width: 0; height: 0'; el.append(probe); const y = probe.getBoundingClientRect().top; probe.remove(); return y }
    return { text: times.textContent, lines: box.height / parseFloat(getComputedStyle(times).lineHeight), fits: box.right <= slot.right + .5, drift: Math.abs(baseline(times) - baseline(meter)) }
  })
  // The narrowest phone keeps the range whole and lets the peak wrap under it, as the position's does.
  for (const width of [1280, 390, 320]) {
    await page.setViewportSize({ width, height: 900 })
    await dragWave('edited', .25, .5)
    assert(await button('Undo').isVisible(), `${width}: Undo stays through a selection`)
    const { text, lines, fits, drift } = await line()
    assert.match(text, /^\d:\d\d\.\d–\d:\d\d\.\d$/)
    assert(lines < 1.5 && fits, `${width}: one line within the slot`)
    if (width > 320) assert(drift < 1, `${width}: peak on the range's baseline (off by ${drift}px)`)
    await slider('edited').press('Escape')
  }
})
