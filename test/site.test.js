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

const button = name => page.getByRole('button', { name, exact: true, includeHidden: name === 'Undo' })
// A sample's length as the page shows it, m:ss.t with tenths floored at the millisecond, from site-samples.js itself:
// the tests hold for whichever samples it makes.
const shown = name => {
  const tenths = Math.floor(Math.round(built[name].make()[0].length / RATE * 1000) / 100)
  return `${Math.floor(tenths / 600)}:${String(Math.floor(tenths / 10) % 60).padStart(2, '0')}.${tenths % 10}`
}
const idle = () => page.locator('.demo[aria-busy="false"]').waitFor()
const message = () => page.locator('.demo-message').innerText()
// The demo opens on the first sample site-samples.js makes; its length in seconds.
const first = Object.keys(built)[0]
const seconds = name => built[name].make()[0].length / RATE
// The chain holds only edits. Each pill's title is its call, so chain() reads the edits as code.
const defaultChain = '.trim()\n.normalize(-1)\n.fade(0.02, 0.1)'
const pill = key => page.locator(`.pill[data-key="${key}"]`)
const steps = () => page.locator('.chain .pill')
const chain = async () => (await steps().evaluateAll(pills => pills.map(el => el.title))).join('\n')
const sourceName = () => pill('source').textContent()
const menu = () => page.locator('#pill-menu')
// A pill opens its menu: the samples under the sound, the downloads under the save, a step's sliders under the step.
async function openPill(key) {
  if (await pill(key).getAttribute('aria-expanded') === 'true') return
  // Another pill's panel may lie over this one: close it first, as a person would.
  await closeMenu()
  await pill(key).click()
  await menu().waitFor()
  await placed()
}
// The menu's tab covers its trigger exactly, with its panel joined directly below.
const placed = () => page.waitForFunction(() => {
  const menu = document.querySelector('#pill-menu'), open = document.querySelector('.pill.open')?.getBoundingClientRect(), box = menu.getBoundingClientRect()
  const tab = menu.querySelector('.pill-tab').getBoundingClientRect(), panel = menu.querySelector('.pill-body').getBoundingClientRect()
  return open && !menu.getAnimations().length && Math.abs(tab.top - open.top) < 1 && Math.abs(tab.left - open.left) < 1 && Math.abs(tab.width - open.width) < 1 && Math.abs(panel.top - open.bottom + 1) < 1 && box.left >= 16 && box.right <= innerWidth - 16
})
async function closeMenu() { if (await menu().isVisible()) await page.keyboard.press('Escape'); await menu().waitFor({ state: 'hidden' }) }
// A slider moved as a drag moves it: one gesture, one Undo step. It returns once the render has landed.
async function setParam(key, label, value) {
  await openPill(key)
  const control = menu().getByRole('slider', { name: label, exact: true })
  await control.dispatchEvent('pointerdown')
  await control.evaluate((el, value) => { el.value = value; el.dispatchEvent(new Event('input', { bubbles: true })) }, String(value))
  await idle()
}
async function removeStep(index) { await closeMenu(); await pill(index).focus(); await page.keyboard.press('Delete'); await idle() }
// Builds a chain through the pills: every step removed, then each call added from the + menu with its defaults and
// its numbers set by slider. Numbers only, within the sliders' ranges; a range on the timeline comes from a selection.
async function setChain(code) {
  while (await steps().count()) await removeStep(0)
  for (const [, type, raw] of code.matchAll(/\.(\w+)\(([^()]*)\)/g)) {
    await addMethod(type)
    const values = raw.split(',').map(value => value.trim()).filter(Boolean).map(Number)
    if (!values.length) continue
    const index = await steps().count() - 1
    await openPill(index)
    const sliders = await menu().getByRole('slider').evaluateAll(inputs => inputs.map(el => [el.getAttribute('aria-label'), +el.value]))
    for (const [i, value] of values.entries()) if (sliders[i][1] !== value) await setParam(index, sliders[i][0], value)
    await closeMenu()
  }
}
const addButton = () => button('Add a method')
async function chooseFile() { await openPill('source'); await menu().getByRole('button', { name: /^Open a file/ }).click() }
async function downloadDisabled() {
  await openPill('save')
  const disabled = await menu().getByRole('button').first().isDisabled()
  await closeMenu()
  return disabled
}
const slider = name => page.getByRole('slider', { name: `Seek ${name} audio` })
async function upload(file) { await page.locator('#audio-file').setInputFiles(file); await idle() }
async function undoEdit(wait = true) { await closeMenu(); await addButton().focus(); await page.keyboard.press('ControlOrMeta+z'); if (wait) await idle() }
async function file(name, channels, sampleRate = 48000) {
  const encoder = await wav({ sampleRate, bitDepth: 32 })
  encoder.encode(channels)
  return { name, mimeType: 'audio/wav', buffer: Buffer.from(encoder.flush()) }
}
function tone(length, frequency = 220, amplitude = .2) {
  return Float32Array.from({ length }, (_, i) => i < length / 4 || i >= length * .75 ? 0 : amplitude * Math.sin(2 * Math.PI * frequency * i / 48000))
}
// The save pill lists the downloads, one per format: choosing one saves it.
async function saveAs(format) {
  const ext = format?.toLowerCase() ?? /\.(\w+)'/.exec(await pill('save').getAttribute('title'))[1]
  await openPill('save')
  await menu().getByRole('button', { name: new RegExp(`\\.${ext}\\b`) }).click()
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
  assert.equal(result.channels.length, built[first].make().length)
  assert(result.channels[0].length < seconds(first) * result.rate)
  assert(result.channels[0].every(Number.isFinite))
  assert(result.channels[0].some(value => Math.abs(value) > .5))
})

test('site: A → A → stereo B, undo and rebuilding the chain preserve the current file samples', async () => {
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
    await setChain('')
    assert.equal(await chain(), '')
    const restored = await output()
    for (let c = 0; c < expected.length; c++) {
      assert.equal(restored.channels[c].length, expected[c].length)
      assert(restored.channels[c].every((value, i) => Math.abs(value - expected[c][i]) < 1 / 32767))
    }
    await setChain(defaultChain)
    assert.deepEqual(await output(), processed)
  }
})

test('site: cancel, invalid bytes and zero-frame WAV preserve the previous file', async () => {
  const prior = await output()
  for (const invalid of [[], { name: 'zero.wav', mimeType: 'audio/wav', buffer: Buffer.alloc(0) }, { name: 'bad.wav', mimeType: 'audio/wav', buffer: Buffer.from('bad') }, await file('empty.wav', [new Float32Array(0)])]) {
    await upload(invalid)
    assert.equal(await sourceName(), first)
    if (!Array.isArray(invalid)) assert.match(await message(), /could not be opened/)
    assert.deepEqual(await output(), prior)
  }
})

test('site: one-sample WAV remains finite and undo restores its sample', async () => {
  await upload(await file('one.wav', [new Float32Array([.25])]))
  const processed = await output()
  assert.equal(processed.channels[0].length, 1)
  assert(processed.channels[0].every(Number.isFinite))
  await setChain('')
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
  await setChain('')
  assert.equal(await message(), '')
  const restored = await output()
  assert.equal(restored.channels[0].length, 4800)
  assert(restored.channels[0].every(value => value === 0))
})

test('site: render failure disables stale output; a new edit recovers', async () => {
  for (const operation of ['Undo', 'menu', 'slider']) {
    if (operation === 'Undo') await removeStep(0)
    await page.evaluate(async () => {
      const { default: audio } = await import('/assets/audio.js')
      const read = audio.fn.read
      audio.fn.read = function () { audio.fn.read = read; return Promise.reject(new Error('render failed')) }
    })
    if (operation === 'slider') await setParam(1, 'Peak (dB)', -3)
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
    await setChain(defaultChain)
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

test('site: edits change PCM and all code examples; undo restores the chain', async () => {
  await upload(await file('edits.wav', [tone(48000)]))
  const initial = await output()
  const initialWave = await page.locator('#edited-wave .wave-glyphs').first().textContent()
  await removeStep(0)
  assert.equal(await chain(), '.normalize(-1)\n.fade(0.02, 0.1)')
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
  await removeStep(1)
  const quieter = (await output()).channels[0]
  assert.equal(quieter.length, initial.channels[0].length)
  assert(Math.max(...quieter.map(Math.abs)) < .21)
  // A nonzero signal makes both fade boundaries observable, independent of trim's block alignment.
  await upload(await file('fade.wav', [new Float32Array(9600).fill(.2)]))
  await removeStep(1)
  const faded = await output()
  await removeStep(1)
  const unfaded = (await output()).channels[0]
  assert.equal(unfaded.length, 9600)
  assert(unfaded.every(value => Math.abs(value - .2) < 1 / 32767))
  assert(Math.abs(faded.channels[0][0]) < .0001)
  assert(Math.abs(faded.channels[0].at(-1)) < .001)
  assert(Math.abs(faded.channels[0][4800] - .2) < 1 / 32767)
  await setChain(defaultChain)
  assert.deepEqual(await output(), faded)
  await setChain('')
  for (const tab of ['Node.js', 'Browser', 'CLI', 'MCP']) {
    await button(tab).click()
    assert(!/\b(trim|normalize|fade)\b/.test(await page.locator('.code-example pre').innerText()))
  }
})

async function watchPlayback() {
  await page.evaluate(async () => {
    const { default: audio } = await import('/assets/audio.js')
    const stream = audio.fn.stream
    window.streams = []
    window.blocks = []
    audio.fn.stream = function (opts = {}) {
      const playback = { duration: this.duration, channels: this.channels, offset: opts.at || 0, limit: opts.duration ?? this.duration - (opts.at || 0) }
      streams.push(playback)
      played.push(playback)
      return stream.call(this, opts)
    }
    const start = AudioBufferSourceNode.prototype.start, stop = AudioBufferSourceNode.prototype.stop
    window.played = []
    window.buffers = new Set()
    window.stops = 0
    AudioBufferSourceNode.prototype.start = function (...args) {
      if (args.length > 1) {
        buffers.add(this.buffer)
        played.push({ duration: this.buffer.duration, channels: this.buffer.numberOfChannels, offset: args[1] || 0, limit: args[2] })
      } else {
        const pcm = this.buffer.getChannelData(0)
        blocks.push({ at: args[0], now: this.context.currentTime, duration: this.buffer.duration, rms: Math.sqrt(pcm.reduce((sum, value) => sum + value * value, 0) / pcm.length) })
      }
      return start.apply(this, args)
    }
    AudioBufferSourceNode.prototype.stop = function (...args) { stops++; return stop.apply(this, args) }
  })
}

test('site: live filter sliders change streamed samples without restarting playback or the cursor', async () => {
  const pcm = Float32Array.from({ length: 48000 * 6 }, (_, i) => .2 * Math.sin(2 * Math.PI * 6000 * i / 48000))
  await upload(await file('live-filter.wav', [pcm]))
  await setChain('.lowpass(10000)')
  await watchPlayback()
  await button('Play edited audio').click()
  await page.waitForFunction(() => blocks.length >= 8)
  await page.evaluate(() => {
    window.transportFrames = []
    window.recordTransport = true
    const sample = () => {
      if (!recordTransport) return
      const row = document.querySelector('.edited-row')
      transportFrames.push({ position: +row.querySelector('input').value, playing: row.querySelector('.play').getAttribute('aria-label') === 'Pause edited audio' })
      requestAnimationFrame(sample)
    }
    sample()
  })
  await openPill(0)
  const control = menu().getByRole('slider', { name: 'Cutoff (Hz)', exact: true })
  await control.focus()
  await control.dispatchEvent('pointerdown')
  for (const cutoff of [500, 10000]) {
    const before = await page.evaluate(() => blocks.length)
    await control.evaluate((el, cutoff) => { el.value = cutoff; el.dispatchEvent(new Event('input', { bubbles: true })) }, String(cutoff))
    await idle()
    await page.waitForFunction(({ before, cutoff }) => blocks.length > before + 8 && blocks.slice(-3).every(block => cutoff === 500 ? block.rms < .005 : block.rms > .1), { before, cutoff })
    assert(await button('Pause edited audio').isEnabled())
    assert.equal(await page.locator('#edited-wave').evaluate(el => getComputedStyle(el, '::after').opacity), '1', 'playing caret remains visible while adjusting the slider')
  }
  await control.dispatchEvent('pointerup')
  await page.evaluate(() => { recordTransport = false })
  const actual = await page.evaluate(() => ({ streams: streams.length, stops, blocks, frames: transportFrames }))
  assert.equal(actual.streams, 1, 'one live iterator for the whole gesture')
  assert.equal(actual.stops, 0, 'no queued audio was stopped')
  assert(actual.frames.length > 5 && actual.frames.every(frame => frame.playing))
  assert(actual.frames.every((frame, i, frames) => !i || frame.position >= frames[i - 1].position), 'cursor never resets')
  assert(actual.frames.at(-1).position > actual.frames[0].position, 'cursor advances during the gesture')
  assert(actual.blocks.every((block, i, blocks) => !i || Math.abs(block.at - blocks[i - 1].at - blocks[i - 1].duration) < 1e-6), 'audio blocks meet on the audio clock without gaps')
  await closeMenu()
  await button('Pause edited audio').click()
  const count = await page.evaluate(() => blocks.length)
  await page.waitForTimeout(150)
  assert.equal(await page.evaluate(() => blocks.length), count, 'pause stops the producer as well as queued audio')
})

for (const name of ['original', 'edited']) test(`site: ${name} playback and pause remain available during a delayed parameter render`, async () => {
  await upload(await file('live-original.wav', [new Float32Array(48000 * 4).fill(.2)]))
  await setChain('.gain(0)')
  await watchPlayback()
  await button(`Play ${name} audio`).click()
  await openPill(0)
  await page.evaluate(async () => {
    const { default: audio } = await import('/assets/audio.js'), read = audio.fn.read
    audio.fn.read = function (...args) {
      audio.fn.read = read
      return new Promise((resolve, reject) => { window.finishRender = () => read.apply(this, args).then(resolve, reject) })
    }
  })
  await menu().getByRole('slider').evaluate(el => { el.value = '-12'; el.dispatchEvent(new Event('input', { bubbles: true })) })
  await page.waitForFunction(() => window.finishRender)
  const before = +(await slider(name).inputValue())
  await page.waitForFunction(({ before, name }) => +document.querySelector(`#${name}-wave input`).value > before, { before, name })
  if (name === 'edited') await page.waitForFunction(() => blocks.slice(-3).length === 3 && blocks.slice(-3).every(block => Math.abs(block.rms - .2 * 10 ** (-12 / 20)) < 1e-6))
  assert.equal(await page.evaluate(() => stops), 0)
  await closeMenu()
  assert(await button(`Pause ${name} audio`).isEnabled())
  await button(`Pause ${name} audio`).click()
  await page.evaluate(() => finishRender()); await idle()
  assert(await button(`Play ${name} audio`).isVisible())
  assert((await page.evaluate(() => stops)) >= 1)
  assert((await output()).channels[0].every(value => Math.abs(value - .2 * 10 ** (-12 / 20)) < 1 / 32767))
})

test('site: streaming handles a one-sample A, replay A, and a different stereo B', async () => {
  await upload(await file('one.wav', [new Float32Array([.25])]))
  await setChain('')
  await watchPlayback()
  for (const count of [1, 2]) {
    await button('Play edited audio').click()
    await page.waitForFunction(count => streams.length === count && document.querySelector('#edited-wave input').value === '1000' && document.querySelector('.edited-row .play').getAttribute('aria-label') === 'Play edited audio', count)
  }
  assert.deepEqual(await page.evaluate(() => blocks.map(({ duration, rms }) => [duration, rms])), [[1 / 48000, .25], [1 / 48000, .25]])
  await upload(await file('three.wav', [new Float32Array([.25, -.125, .0625]), new Float32Array([-.5, .25, -.125])]))
  await setChain('')
  await button('Play edited audio').click()
  await page.waitForFunction(() => streams.length === 3 && document.querySelector('.edited-row .play').getAttribute('aria-label') === 'Play edited audio')
  assert.deepEqual(await page.evaluate(() => streams[2]), { duration: 3 / 48000, channels: 2, offset: 0, limit: 3 / 48000 })
  const last = await page.evaluate(() => blocks.at(-1))
  assert.equal(last.duration, 3 / 48000)
  assert(Math.abs(last.rms - Math.sqrt((.25 ** 2 + .125 ** 2 + .0625 ** 2) / 3)) < 1e-8)
})

test('site: a live duration change reaches its new end; removing all samples stops output', async () => {
  await upload(await file('live-duration.wav', [new Float32Array(48000 * 4).fill(.2)]))
  await setChain('.crop(0,4)')
  await watchPlayback()
  await button('Play edited audio').click()
  await setParam(0, 'Duration (s)', 1)
  await page.waitForFunction(() => document.querySelector('#edited-wave input').value === '1000' && document.querySelector('.edited-row .play').getAttribute('aria-label') === 'Play edited audio')
  assert.equal(await page.evaluate(() => streams.length), 1)
  assert(Math.abs(await page.evaluate(() => blocks.reduce((sum, block) => sum + block.duration, 0)) - 1) < 1 / 48000)
  await closeMenu()
  await dragWave('edited', .2, .8)
  await button('Play edited audio').click()
  await setParam(0, 'Duration (s)', 0)
  assert(await button('Play edited audio').isDisabled())
  assert.equal(await page.locator('.range').count(), 0, 'an empty result clears its obsolete selection')
  assert.match(await message(), /removed all samples/)
  const count = await page.evaluate(() => blocks.length)
  await page.waitForTimeout(150)
  assert.equal(await page.evaluate(() => blocks.length), count)
})

test('site: a playing selection keeps its time boundaries when a live parameter changes track length', async () => {
  await upload(await file('live-range.wav', [new Float32Array(48000 * 4).fill(.2)]))
  await setChain('.pad(0,0)')
  await dragWave('edited', .25, .5)
  const selected = await page.locator('.range output').textContent()
  await watchPlayback()
  await button('Play edited audio').click()
  await setParam(0, 'After (s)', 2)
  assert.equal(await page.locator('.range output').textContent(), selected)
  await page.waitForFunction(() => document.querySelector('.edited-row .play').getAttribute('aria-label') === 'Play edited audio')
  assert.equal(await page.evaluate(() => streams.length), 1)
  const actual = await page.evaluate(() => ({ duration: blocks.reduce((sum, block) => sum + block.duration, 0), limit: streams[0].limit, offset: streams[0].offset }))
  assert(Math.abs(actual.duration - actual.limit) < 1 / 48000)
  assert(Math.abs(+(await slider('edited').inputValue()) / 1000 * 6 - actual.offset - actual.limit) < .006)
})

for (const outcome of ['resolve', 'reject']) test(`site: stale stream ${outcome} cannot interrupt a switch to the original`, async () => {
  await watchPlayback()
  await page.evaluate(async () => {
    const { default: audio } = await import('/assets/audio.js'), stream = audio.fn.stream
    audio.fn.stream = async function* (...args) {
      audio.fn.stream = stream
      await new Promise((resolve, reject) => { window.finishStream = resolve; window.failStream = reject })
      yield* stream.apply(this, args)
    }
  })
  await button('Play edited audio').click()
  await page.waitForFunction(() => window.finishStream)
  await button('Play original audio').click()
  await page.evaluate(outcome => outcome === 'resolve' ? finishStream() : failStream(new Error('stale stream')), outcome)
  await page.waitForTimeout(150)
  assert(await button('Pause original audio').isVisible())
  assert.equal(await message(), '')
  assert.equal(await page.evaluate(() => blocks.length), 0)
  assert.equal(await page.evaluate(() => stops), 0)
})

test('site: a live render failure stops queued edited audio and a new parameter value recovers', async () => {
  await upload(await file('live-error.wav', [new Float32Array(48000 * 3).fill(.2)]))
  await setChain('.gain(0)')
  await watchPlayback()
  await button('Play edited audio').click()
  await page.waitForFunction(() => blocks.length > 3)
  await page.evaluate(async () => {
    const { default: audio } = await import('/assets/audio.js'), read = audio.fn.read
    audio.fn.read = function () { audio.fn.read = read; return Promise.reject(new Error('render failed')) }
  })
  await setParam(0, 'Gain (dB)', -6)
  assert(await button('Play edited audio').isDisabled())
  assert.match(await message(), /could not be applied/)
  const count = await page.evaluate(() => blocks.length)
  await page.waitForTimeout(150)
  assert.equal(await page.evaluate(() => blocks.length), count)
  assert(await downloadDisabled())
  await setParam(0, 'Gain (dB)', -12)
  await closeMenu()
  await button('Play edited audio').click()
  await page.waitForFunction(count => blocks.length > count + 3 && Math.abs(blocks.at(-1).rms - .2 * 10 ** (-12 / 20)) < 1e-6, count)
  assert.equal(await message(), '')
  assert(await button('Pause edited audio').isVisible())
})

test('site: a stream failure cancels queued blocks and playback can retry', async () => {
  await watchPlayback()
  await page.evaluate(async () => {
    const { default: audio } = await import('/assets/audio.js'), stream = audio.fn.stream
    audio.fn.stream = async function* (...args) {
      audio.fn.stream = stream
      let count = 0
      for await (const block of stream.apply(this, args)) {
        if (++count === 4) throw new Error('stream failed')
        yield block
      }
    }
  })
  await button('Play edited audio').click()
  await page.waitForFunction(() => document.querySelector('.demo-message').textContent.includes('playback is unavailable'))
  assert(await button('Play edited audio').isEnabled())
  const count = await page.evaluate(() => blocks.length)
  await page.waitForTimeout(150)
  assert.equal(await page.evaluate(() => blocks.length), count)
  assert((await page.evaluate(() => stops)) > 0)
  await button('Play edited audio').click()
  await page.waitForFunction(count => blocks.length > count + 3, count)
  assert.equal(await message(), '')
  assert(await button('Pause edited audio').isVisible())
})

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
  await setChain(defaultChain)
  assert((await output()).channels[0].length < 24000)
})

test('site: per-wave playback preserves positions, streams edits and replaces the source buffer after upload', async () => {
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
  assert.equal(await page.evaluate(() => buffers.size), 1)
  assert.equal(await page.evaluate(() => streams.length), 1)
  assert.equal(played[0].duration, seconds(first))
  assert(played[1].duration < played[0].duration)
  await page.waitForFunction(() => +document.querySelector('#edited-wave input').value > 10)
  await button('Pause edited audio').click()
  const editedPosition = await slider('edited').inputValue()
  await button('Play original audio').click()
  await page.waitForFunction(() => played.length === 3)
  assert((await page.evaluate(() => stops)) >= 2)
  assert((await page.evaluate(() => played[2].offset)) > 0)
  assert.equal(await slider('edited').inputValue(), editedPosition)
  await setChain('.normalize(-1).fade(0.02, 0.1)')
  await button('Play edited audio').click()
  await page.waitForFunction(() => played.length === 4)
  assert.equal(await page.evaluate(() => played[3].duration), seconds(first))
  assert.equal(await page.evaluate(() => buffers.size), 1)
  assert.equal(await page.evaluate(() => streams.length), 2)
  await upload(await file('stereo.wav', [tone(24000), tone(24000, 330)]))
  await button('Play original audio').click()
  await page.waitForFunction(() => played.length === 5)
  assert.deepEqual(await page.evaluate(() => played[4]), { duration: .5, channels: 2, offset: 0, limit: .5 })
  assert.equal(await page.evaluate(() => buffers.size), 2)
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
  assert((await page.evaluate(() => stops)) >= 1)
  assert.equal(await page.evaluate(() => streams.length), 2)
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

for (const name of ['original', 'edited']) test(`site: ${name} replays from zero after natural end and seeking to EOF`, async () => {
  await watchPlayback()
  for (const count of [1, 1025, 48000]) {
    await upload(await file('short.wav', [new Float32Array(count).fill(.25), new Float32Array(count).fill(.125)]))
    await setChain('')
    for (let take = 0; take < 2; take++) {
      await page.evaluate(() => { played.length = 0; blocks.length = 0 })
      await button(`Play ${name} audio`).click()
      await page.waitForFunction(name => played.length === 1 && document.querySelector(`#${name}-wave input`).value === '1000' && !document.querySelector('.play-icon.paused'), name)
      assert.equal(await page.evaluate(() => played[0].offset), 0, `${name} ${count} frames, take ${take}`)
      assert.equal(await page.evaluate(() => played[0].channels), 2)
      if (name === 'edited') {
        const result = await page.evaluate(() => blocks)
        assert.equal(Math.round(result.reduce((sum, block) => sum + block.duration * 48000, 0)), count)
        assert(result.every(block => Math.abs(block.rms - .25) < 1 / 32767))
      }
    }
    await cursor(name, 1000)
    await page.evaluate(() => { played.length = 0 })
    await button(`Play ${name} audio`).click()
    await page.waitForFunction(() => played.length === 1)
    assert.equal(await page.evaluate(() => played[0].offset), 0)
    await page.waitForFunction(() => !document.querySelector('.play-icon.paused'))
  }
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
  await setChain('')
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
  assert(await pill('source').isDisabled())
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

// A method appended with its defaults: gain(-6), reverse(), speed(1.25).
const addProcessing = type => addMethod(type)

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
  await setChain('')
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
  await setChain('')
  assert.equal(await page.locator('.edited-row.active').count(), 1)
  // Fractional pointer positions, as a trackpad reports them.
  await dragWave('original', .3037, .6071)
  assert.equal(await page.locator('.audio-row.active .track-name').textContent(), 'Original')
  assert.match(await page.locator('.range output').textContent(), /^0:00\.\d–0:01\.\d$/)
  // The range reads in the position's face.
  const faces = await page.evaluate(() => [...document.querySelectorAll('.timecode output')].map(el => { const style = getComputedStyle(el); return style.fontFamily + ' ' + style.fontWeight }))
  assert.equal(faces.length, 1)
  assert.match(faces[0], /Geist.*300/)
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
  await setChain('.gain(0)')
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
  await undoEdit()
  assert(near((await lines())[0], [.2, .4]))
  await undoEdit()
  assert.equal((await lines()).length, 2)
  assert.equal(await message(), '')
})

test('site: with a range of the edit selected, the add menu applies methods there, as the library does in Node', async () => {
  const pcm = tone(96000, 220, .5)
  await upload(await file('ranges.wav', [pcm]))
  await setChain('')
  assert(await button('Undo').isVisible())
  const library = async edit => { const clip = audio.from([pcm], { sampleRate: 48000 }); edit(clip); return clip.read() }
  const same = async expected => {
    const result = await output()
    assert.equal(result.channels[0].length, expected[0].length)
    assert(result.channels[0].every((value, i) => Math.abs(value - expected[0][i]) < 1 / 32767))
  }
  // A range scopes an ordinary method as its last argument; Undo stays at hand.
  await dragWave('edited', .25, .5)
  assert(!(await button('Undo').isVisible()))
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
  // The original's selection crops or removes first; other methods then apply to the whole edit.
  await dragWave('original', .25, .5)
  await addButton().click()
  assert(await button('Add remove').isEnabled())
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
  await setChain('.gain(0)')
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
  for (const cancel of ['pointercancel', 'lostpointercapture', 'pagehide']) {
    await track.evaluate(track => track.addEventListener('pointerdown', event => track.pointer = event.pointerId, { once: true }))
    await page.mouse.move(box.x + box.width * .4, y)
    await page.mouse.down()
    await page.mouse.move(box.x + box.width * .6, y, { steps: 4 })
    await track.evaluate((track, cancel) => {
      if (cancel === 'pointercancel') track.dispatchEvent(new PointerEvent(cancel, { pointerId: track.pointer }))
      else if (cancel === 'pagehide') dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }))
      else track.releasePointerCapture(track.pointer)
    }, cancel)
    await page.mouse.up()
    assert.equal(await page.locator('.range').innerText(), prior)
    assert.equal(await track.evaluate(track => track.hasPointerCapture(track.pointer)), false)
  }
})

test('site: sub-sample selection at the final boundary crops one sample', async () => {
  await upload(await file('one.wav', [new Float32Array([.25])]))
  await setChain('')
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
  await setChain('')
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
  await removeStep(1)
  assert.deepEqual(await output(), gained)
  await undoEdit()
  assert.deepEqual(await output(), reversed)
})

test('site: Remove takes a step out, focus moves to the pill before it, and an empty chain keeps the samples', async () => {
  const pcm = tone(4800)
  await upload(await file('empty-chain.wav', [pcm]))
  const prior = await output()
  await removeStep(1)
  assert.equal(await chain(), '.trim()\n.fade(0.02, 0.1)')
  assert.equal(await page.evaluate(() => document.activeElement.dataset.key), '0')
  await removeStep(0)
  await removeStep(0)
  assert.equal(await chain(), '')
  // With no step left, the focus rests on the sound.
  assert(await addButton().evaluate(el => el === document.activeElement))
  assert.equal(await page.locator('.chain .joint').count(), 0)
  const clean = await output()
  assert.equal(clean.channels[0].length, pcm.length)
  assert(clean.channels[0].every((value, i) => Math.abs(value - pcm[i]) < 1 / 32767))
  assert(!/\b(trim|normalize|fade)\b/.test(await page.locator('.code-example pre').innerText()))
  for (let i = 0; i < 3; i++) await undoEdit()
  assert.equal(await chain(), defaultChain)
  assert.deepEqual(await output(), prior)
})

test('site: a slider updates the bars, level reading and PCM as it moves', async () => {
  // Both lanes share one linear scale, full height at 0 dBFS: gain shows as bar height and in the reading.
  const pcm = tone(4800), top = Math.max(...pcm.map(Math.abs))
  const tallest = name => page.locator(`#${name}-wave .wave-glyphs`).first().evaluate(el => Math.max(...[...el.textContent].map(char => char.charCodeAt(0) - 0x100)))
  await upload(await file('live.wav', [pcm]))
  await setChain('.gain(-3)')
  await cursor('edited', 500)
  for (const db of [-3, -12, -6]) {
    await setParam(0, 'Gain (dB)', db)
    const expected = await reading([pcm], 48000, clip => clip.gain(db))
    await page.waitForFunction(text => document.querySelector('.timecode .meters').textContent === text, expected)
    // Amplitude is 10^(dB/20) of the source: dBFS is 20·log10 of a sample's magnitude (AES17).
    assert.equal(await tallest('edited'), Math.round(top * 10 ** (db / 20) * 100))
    assert.equal(await tallest('original'), Math.round(top * 100))
    const result = await output()
    assert.equal(result.channels[0].length, pcm.length)
    assert(result.channels[0].every((value, i) => Math.abs(value - pcm[i] * 10 ** (db / 20)) < 1 / 32767))
  }
})

test('site: a slider moved during a delayed render keeps its menu usable and the latest value wins', async () => {
  const pcm = tone(4800)
  await upload(await file('queued.wav', [pcm]))
  await setChain('.gain(-6)')
  await openPill(0)
  const move = async value => {
    const control = menu().getByRole('slider', { name: 'Gain (dB)', exact: true })
    await control.evaluate((el, value) => { el.value = value; el.dispatchEvent(new Event('input', { bubbles: true })) }, String(value))
  }
  await page.evaluate(async () => {
    const { default: audio } = await import('/assets/audio.js')
    const read = audio.fn.read
    window.finishRender = null
    audio.fn.read = function (...args) {
      audio.fn.read = read
      return new Promise((resolve, reject) => { window.finishRender = () => read.apply(this, args).then(resolve, reject) })
    }
  })
  await menu().getByRole('slider', { name: 'Gain (dB)', exact: true }).dispatchEvent('pointerdown')
  await move(-3)
  await page.waitForFunction(() => window.finishRender)
  assert(await menu().isVisible())
  await move(-9)
  await move(-12)
  await page.evaluate(() => finishRender())
  await idle()
  assert.equal(await chain(), '.gain(-12)')
  assert.match(await page.locator('.code-example pre').innerText(), /gain\(-12\)/)
  const result = await output()
  assert.equal(result.channels[0].length, pcm.length)
  assert(result.channels[0].every((value, i) => Math.abs(value - pcm[i] * 10 ** (-12 / 20)) < 1 / 32767))
  // The whole drag is one Undo step.
  await undoEdit()
  assert.equal(await chain(), '.gain(-6)')
})

test('site: a slider value moved during a menu or Undo render lands once that render ends', async () => {
  const pcm = tone(4800)
  await upload(await file('queued-history.wav', [pcm]))
  for (const operation of ['menu', 'Undo']) {
    await setChain('.gain(-6)')
    if (operation === 'Undo') await addMethod('reverse')
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
    else await undoEdit(false)
    await page.waitForFunction(() => window.finishRender)
    await openPill(0)
    const control = menu().getByRole('slider', { name: 'Gain (dB)', exact: true })
    await control.dispatchEvent('pointerdown')
    await control.evaluate(el => { el.value = '-12'; el.dispatchEvent(new Event('input', { bubbles: true })) })
    // Let the scheduled apply meet the render in flight before releasing it.
    await page.waitForTimeout(250)
    await page.evaluate(() => finishRender())
    await page.locator('.demo[aria-busy="false"]').waitFor({ timeout: 2000 })
    const expected = operation === 'menu' ? '.gain(-12)\n.reverse()' : '.gain(-12)'
    assert.equal(await chain(), expected, operation)
    const result = await output()
    assert.equal(result.channels[0].length, pcm.length)
    const reversed = operation === 'menu'
    assert(result.channels[0].every((value, i) => Math.abs(value - (reversed ? pcm.at(-1 - i) : pcm[i]) * 10 ** (-12 / 20)) < 1 / 32767), operation)
    await closeMenu()
  }
})

test('site: a slider moved during a delayed file decode lands on the previous source when the decode fails', async () => {
  const pcm = tone(4800)
  await upload(await file('kept.wav', [pcm]))
  await setChain('.gain(-6)')
  await page.evaluate(() => {
    const decode = AudioContext.prototype.decodeAudioData
    AudioContext.prototype.decodeAudioData = function () {
      AudioContext.prototype.decodeAudioData = decode
      return new Promise((resolve, reject) => { window.failDecode = () => reject(new Error('decode failed')) })
    }
  })
  await page.locator('#audio-file').setInputFiles(await file('rejected.wav', [tone(2400, 330)]))
  await page.waitForFunction(() => window.failDecode)
  await openPill(0)
  const control = menu().getByRole('slider', { name: 'Gain (dB)', exact: true })
  await control.dispatchEvent('pointerdown')
  await control.evaluate(el => { el.value = '-9'; el.dispatchEvent(new Event('input', { bubbles: true })) })
  await page.waitForTimeout(250)
  await page.evaluate(() => failDecode())
  await page.locator('.demo[aria-busy="false"]').waitFor({ timeout: 2000 })
  assert.equal(await sourceName(), 'kept.wav')
  assert.equal(await chain(), '.gain(-9)')
  const result = await output()
  assert.equal(result.channels[0].length, pcm.length)
  assert(result.channels[0].every((value, i) => Math.abs(value - pcm[i] * 10 ** (-9 / 20)) < 1 / 32767))
})

test('site: a step\'s pill opens a slider per number, each changing only its own, a range\'s too', async () => {
  const pcm = tone(96000, 220, .5)
  await upload(await file('options.wav', [pcm]))
  await setChain('')
  // A selection scopes the added fade: its range joins its numbers.
  await dragWave('edited', .25, .5)
  await addMethod('fade')
  await addMethod('reverse')
  const sliders = () => menu().getByRole('slider').evaluateAll(inputs => inputs.map(el => el.getAttribute('aria-label')))
  await openPill(0)
  assert.equal(await menu().getAttribute('aria-label'), 'fade()')
  assert.deepEqual(await sliders(), ['Fade in (s)', 'Fade out (s)', 'Start (s)', 'Duration (s)'])
  assert.equal(await menu().locator('.step-actions').count(), 0)
  assert(await menu().locator('.parameter').evaluateAll(fields => fields.every(el => { const css = getComputedStyle(el); return css.rowGap === '2px' && css.paddingTop === '4px' && css.paddingBottom === '4px' })))
  await setParam(0, 'Start (s)', .5)
  assert.match(await chain(), /^\.fade\(0\.02, 0\.1, \{ at: 0\.5, duration: [\d.]+ \}\)\n\.reverse\(\)$/)
  await setParam(0, 'Duration (s)', 1.5)
  assert.equal(await chain(), '.fade(0.02, 0.1, { at: 0.5, duration: 1.5 })\n.reverse()')
  // Differential: the library applying the same chain in Node.
  const clip = audio.from([pcm], { sampleRate: 48000 })
  clip.fade(.02, .1, { at: .5, duration: 1.5 }).reverse()
  const expected = await clip.read(), result = await output()
  assert(result.channels[0].every((value, i) => Math.abs(value - expected[0][i]) < 1 / 32767))
  // A step without parameters does not open an empty dropdown.
  await closeMenu(); await pill(1).click()
  assert(!(await menu().isVisible()))
  assert.equal(await pill(1).getAttribute('aria-haspopup'), null)
})

test('site: a parameter slider updates only its step, renders during a drag and undoes the gesture once', async () => {
  const pcm = tone(4800)
  await upload(await file('slider.wav', [pcm]))
  await setChain('.gain(-6).reverse()')
  const prior = await output()
  await openPill(0)
  const control = menu().getByRole('slider', { name: 'Gain (dB)', exact: true })
  const element = await pill(0).elementHandle()
  await control.dispatchEvent('pointerdown')
  for (const value of [-8, -10, -12]) {
    await control.evaluate((el, value) => { el.value = value; el.dispatchEvent(new Event('input', { bubbles: true })) }, String(value))
    await idle()
    assert.equal(await chain(), `.gain(${value})\n.reverse()`)
    // The pill and its menu read the new value while the menu stays open.
    assert.equal(await pill(0).textContent(), `gain−${-value}dB`)
    assert.equal(await menu().locator('output').textContent(), `−${-value}dB`)
    assert(await menu().isVisible())
    assert.match(await page.locator('.code-example pre').innerText(), new RegExp(`gain\\(${value}\\)`))
    // The pill stays the same element; its menu follows and the slider fills up to its value.
    assert(await element.evaluate(el => el.isConnected))
    await placed()
    assert.equal(await control.evaluate(el => el.style.getPropertyValue('--fill')), `${(value + 36) / 48 * 100}%`)
  }
  await control.dispatchEvent('pointerup')
  const changed = await output()
  assert(changed.channels[0].every((value, i) => Math.abs(value - pcm.at(-1 - i) * 10 ** (-12 / 20)) < 1 / 32767))
  await undoEdit()
  assert.equal(await chain(), '.gain(-6)\n.reverse()')
  assert.deepEqual(await output(), prior)
})

test('site: edits form the chain; the flat open crumb joins its menu; fade sliders keep the cursors visible', async () => {
  // Each step reads with its values and is titled with its call.
  assert.deepEqual(await page.locator('.chain .pill').evaluateAll(pills => pills.map(el => [el.textContent, el.title])), [
    ['trim', '.trim()'], ['normalize−1dB', '.normalize(-1)'], ['fade0.02s, 0.1s', '.fade(0.02, 0.1)']
  ])
  // A trailing chevron wraps with the preceding pill.
  assert.equal(await page.locator('.chain .joint:visible').count(), 2)
  assert(await page.locator('.chain .link').evaluateAll(links => links.every(el => el.firstElementChild.matches('.pill') && el.lastElementChild.matches('.joint'))))
  // The border uses the divider's exact color and alpha, with the fill clipped out from under it.
  const look = key => pill(key).evaluate(el => { const style = getComputedStyle(el); return { border: style.borderTopWidth, borderColor: style.borderTopColor, clip: style.backgroundClip, shadow: style.boxShadow, transform: style.transform, background: style.backgroundColor } })
  const rest = await look(1)
  assert.equal(rest.border, '1px')
  const divider = await page.locator('.chain').evaluate(el => getComputedStyle(el).borderTopColor)
  assert.equal(rest.borderColor, divider)
  assert.equal(rest.clip, 'padding-box')
  const colors = await page.locator('.demo').evaluate(el => {
    const probe = document.createElement('span'); el.append(probe)
    const colors = ['--color-screen', '--color-screen-rule'].map(token => {
      probe.style.color = `var(${token})`
      return getComputedStyle(probe).color
    })
    probe.remove(); return colors
  })
  assert.equal(rest.background, colors[0])
  assert.equal(rest.borderColor, colors[1])
  assert(!colors.some(color => color.includes('/')), 'fill and divider token are opaque')
  assert.equal(rest.shadow, 'none')
  await openPill(1)
  await page.waitForFunction(([key, color]) => getComputedStyle(document.querySelector(`.chain .pill[data-key="${key}"]`)).backgroundColor !== color && !document.querySelector('.chain .pill.open').getAnimations().length, [1, rest.background])
  const open = await look(1)
  assert.equal(open.borderColor, rest.borderColor)
  const lightness = color => { const context = document.createElement('canvas').getContext('2d'); context.fillStyle = color; context.fillRect(0, 0, 1, 1); return context.getImageData(0, 0, 1, 1).data[0] }
  const [dark, light] = await page.evaluate(([a, b, fn]) => { const f = new Function('return ' + fn)(); return [f(a), f(b)] }, [rest.background, open.background, lightness.toString()])
  assert(light > dark, `open ${light} lighter than rest ${dark}`)
  // The active pill is flat, and its menu grows from the matching tab.
  assert.equal(open.shadow, 'none')
  assert.equal(open.transform, 'none')
  const borders = await menu().locator('.pill-tab, .pill-body').evaluateAll(els => els.map(el => {
    const style = getComputedStyle(el)
    return [style.borderLeftWidth, style.borderLeftColor, style.backgroundColor]
  }))
  assert.deepEqual(borders, Array(2).fill([open.border, open.borderColor, open.background]), 'tab and panel have the selected pill’s border and material')
  assert.equal(await pill(1).evaluate(el => getComputedStyle(el).opacity), '1')
  await placed()
  // The pointer over a resting pill only lightens it: the outline stays the divider's.
  await closeMenu()
  const box = await pill(0).boundingBox()
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.waitForFunction(color => getComputedStyle(document.querySelector('.chain .pill[data-key="0"]')).backgroundColor !== color && !document.querySelector('.chain .pill[data-key="0"]').getAnimations().length, rest.background)
  const hovered = await look(0)
  assert.equal(hovered.borderColor, rest.borderColor)
  assert.equal(hovered.clip, rest.clip)
  const [before, after] = await page.evaluate(([a, b, fn]) => { const f = new Function('return ' + fn)(); return [f(a), f(b)] }, [rest.background, hovered.background, lightness.toString()])
  assert(after - before >= 10, `hover ${after} over rest ${before}`)
  assert.equal(hovered.shadow, rest.shadow)
  await page.mouse.move(0, 0)
  // A slider's inactive track is a groove darker than the panel, outlined lighter than it: read off the drawn pixels,
  // down one column past the knob, since the track's pseudo-element reports no style.
  await openPill(2)
  await menu().evaluate(el => Promise.all(el.getAnimations({ subtree: true }).map(animation => animation.finished)))
  const { x, y, width, height } = await menu().getByRole('slider').first().boundingBox()
  const png = await page.screenshot({ clip: { x: x + width - 24, y, width: 1, height } })
  const column = await page.evaluate(async src => {
    const image = new Image()
    image.src = src
    await image.decode()
    const context = document.createElement('canvas').getContext('2d')
    context.canvas.height = image.height
    context.drawImage(image, 0, 0)
    return [...context.getImageData(0, 0, 1, image.height).data].filter((_, i) => i % 4 === 0)
  }, `data:image/png;base64,${png.toString('base64')}`)
  const [panel, edge, groove] = [column[0], Math.max(...column), Math.min(...column)]
  assert(edge - panel >= 8, `track outline ${edge} over panel ${panel}`)
  assert(groove < panel, `groove ${groove} under panel ${panel}`)
  // Focus and edits in both fade sliders preserve the paused waveforms’ carets.
  await cursor('original', 400)
  await cursor('edited', 200)
  const positions = await page.locator('.wave-track').evaluateAll(tracks => tracks.map(el => el.style.getPropertyValue('--progress')))
  await openPill(2)
  for (const label of ['Fade in (s)', 'Fade out (s)']) {
    await menu().getByRole('slider', { name: label, exact: true }).focus()
    await page.keyboard.press('ArrowRight'); await idle()
    assert.deepEqual(await page.locator('.wave-track').evaluateAll(tracks => tracks.map(el => getComputedStyle(el, '::after').opacity)), ['1', '1'])
    assert.deepEqual(await page.locator('.wave-track').evaluateAll(tracks => tracks.map(el => el.style.getPropertyValue('--progress'))), positions)
  }
  await addButton().focus()
  assert.deepEqual(await page.locator('.wave-track').evaluateAll(tracks => tracks.map(el => getComputedStyle(el, '::after').opacity)), ['1', '1'])
})

test('site: the sound\'s pill lists the samples and a file; the save\'s, the downloads; keys and a press outside close them', async () => {
  // Files and recording come first, then a divider and the samples; choosing a sample keeps the edits.
  const [, second] = Object.keys(built)
  await openPill('source')
  assert.equal(await menu().getAttribute('aria-label'), 'Original')
  assert.equal(await menu().locator('hr').count(), 1)
  assert(!(await menu().innerText()).includes('Samples'))
  assert.deepEqual(await menu().getByRole('button').evaluateAll(items => items.map(el => el.querySelector('code').textContent)), ['Open a file…', 'Record', ...Object.keys(built)])
  assert.equal(await menu().locator('[aria-current="true"] code').textContent(), first)
  await menu().getByRole('button', { name: new RegExp(`^${second}\\b`) }).click(); await idle()
  assert.equal(await sourceName(), second)
  assert.equal(await chain(), defaultChain)
  assert.equal(await page.locator('.audio-row .duration').first().textContent(), shown(second))
  // The save's menu lists the downloads, named as they arrive; one saves in its format.
  await openPill('save')
  assert.equal(await menu().getAttribute('aria-label'), 'Download')
  assert.deepEqual(await menu().getByRole('button').evaluateAll(items => items.map(el => el.querySelector('code').textContent)), ['wav', 'mp3', 'flac', 'aiff', 'ogg'].map(ext => `${second}-edited.${ext}`))
  const downloaded = page.waitForEvent('download')
  await menu().getByRole('button', { name: new RegExp(`^${second}-edited\\.mp3`) }).click()
  assert.equal((await downloaded).suggestedFilename(), `${second}-edited.mp3`); await idle()
  assert.equal(await pill('save').textContent(), `${second}-edited`)
  assert.equal(await pill('save').getAttribute('title'), `.save('${second}-edited.mp3')`)
  // Arrow keys open a pill's menu and step into it; Escape closes it and gives the pill its focus back.
  await pill('source').focus()
  await page.keyboard.press('ArrowDown')
  await page.waitForFunction(() => document.activeElement.closest('#pill-menu'))
  assert.equal(await page.evaluate(() => document.activeElement.querySelector('code').textContent), second)
  // The panel follows the source beside Original.
  await placed()
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Escape')
  await menu().waitFor({ state: 'hidden' })
  assert.equal(await page.evaluate(() => document.activeElement.dataset.key), 'source')
  // Dismiss the source panel before opening a covered edit; outside and repeated presses close it.
  await pill('source').click()
  await closeMenu()
  await pill(1).click()
  assert.equal(await menu().getAttribute('aria-label'), 'normalize()')
  assert.equal(await pill('source').getAttribute('aria-expanded'), 'false')
  await placed()
  await pill(1).click()
  await menu().waitFor({ state: 'hidden' })
  await pill(1).click()
  await page.locator('h1').click()
  await menu().waitFor({ state: 'hidden' })
  // Open a file… opens the picker.
  const chooser = page.waitForEvent('filechooser')
  await chooseFile()
  await chooser
})

test('site: every sample is generated sound: stereo, finite, silent at both edges, its length, and near -16 LUFS', async () => {
  // Generated, not random: making a sample twice gives the same samples.
  for (const [name, { make }] of Object.entries(built)) assert.deepEqual(make(), make(), name)
  // Loudness targets -16 LUFS, which the library measures per ITU-R BS.1770.
  await setChain('')
  for (const name of Object.keys(built)) {
    if (name !== first) { await openPill('source'); await menu().getByRole('button', { name: new RegExp(`^${name}\\b`) }).click(); await idle() }
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

test('site: the download picks the format: a real MP3, loaded only then; WAV again preserves PCM', async () => {
  const requested = []
  page.on('request', request => requested.push(request.url()))
  await upload(await file('formats.wav', [tone(24000)]))
  const prior = await output()
  assert(!requested.some(url => url.endsWith('/mp3.js')))
  const mp3 = await exported('MP3')
  assert.equal(await pill('save').textContent(), 'formats-edited')
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
})

test('site: a crop\'s Duration at zero removes every sample, and Undo brings the sample back', async () => {
  await upload(await file('one-crop.wav', [new Float32Array([.25])]))
  await setChain('')
  await addMethod('crop')
  assert.equal((await output()).channels[0].length, 1)
  await setParam(0, 'Duration (s)', 0)
  assert.match(await message(), /removed all samples/)
  assert(await downloadDisabled())
  assert(await button('Play original audio').isEnabled())
  await undoEdit()
  const result = await output()
  assert.equal(result.channels[0].length, 1)
  assert(Math.abs(result.channels[0][0] - .25) < 1 / 32767)
})

test('site: an edit past two minutes disables output and recovers within them', async () => {
  // 15 s repeated 8 more times is 135 s; once more, 30 s.
  const pcm = tone(15 * 8000)
  await upload(await file('limits.wav', [pcm], 8000))
  await setChain('.repeat(2)')
  await setParam(0, 'Times (×)', 8)
  assert.match(await message(), /within two minutes/)
  assert(await downloadDisabled())
  assert(await button('Play edited audio').isDisabled())
  assert(await button('Play original audio').isEnabled())
  await setParam(0, 'Times (×)', 1)
  assert.equal(await message(), '')
  const clip = audio.from([pcm], { sampleRate: 8000 })
  clip.repeat(1)
  const result = await output()
  assert.equal(result.channels[0].length, Math.round(clip.duration * 48000))
  assert(result.channels[0].every(Number.isFinite))
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

test('site: the CLI shown for a chain renders the same samples as the demo', async () => {
  const dir = await mkdtemp(resolve(tmpdir(), 'audio-site-cli-'))
  try {
    const input = await file('recording.wav', [Float32Array.from({ length: 4800 }, (_, i) => .2 + .05 * Math.sin(i / 20))])
    await writeFile(resolve(dir, input.name), input.buffer)
    await upload(input)
    // Each chain as a person builds it: added from the menu, numbers set by slider, a range from a selection.
    const builds = [
      ['.fade(0.02, 0.1)'], ['.fade(0, 0.02)'], ['.fade(0.02, 0)'], ['.normalize(-1)'],
      ['.pitch(7)'], ['.stretch(1.5)'], ['.lowpass(1000)'], ['.highpass(500)'], ['.eq(1000, 6)'], ['.pad(0.5, 0.5)'], ['.repeat(2)'], ['.shrink(0.3)'],
      ['', 'crop'], ['', 'remove'], ['', 'gain'], ['', 'fade'], ['', 'reverse'], ['', 'lowpass']
    ]
    await button('CLI').click()
    for (const [code, ranged] of builds) {
      await setChain(code)
      if (ranged) { await dragWave('edited', .2, .6); await addMethod(ranged) }
      const expected = await output(), label = await chain()
      const shown = await page.locator('.code-example pre').innerText()
      const command = shown.split('\n\n').find(part => part.startsWith('audio recording.wav'))
      const args = command.replace(/\\\n/g, ' ').trim().split(/\s+/).slice(1)
      // Execute exactly the displayed command, without a shell or mirrored formatter.
      await promisify(execFile)(process.execPath, [resolve(root, 'bin/cli.js'), ...args, '--force'], { cwd: dir })
      const actual = await decode(await readFile(resolve(dir, 'edited.wav')))
      assert.equal(actual.rate, expected.rate, label)
      assert.equal(actual.channels.length, expected.channels.length, label)
      for (let c = 0; c < actual.channels.length; c++) {
        assert.equal(actual.channels[c].length, expected.channels[c].length, label)
        assert(actual.channels[c].every((value, i) => Number.isFinite(value) && Math.abs(value - expected.channels[c][i]) < 1 / 32767), label)
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
  await setChain('')
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
  await setChain('')
  for (const [index, name] of names.entries()) {
    await addMethod(name)
    assert.equal(await steps().nth(index).locator('span').first().textContent(), name)
    assert.match(await steps().nth(index).getAttribute('title'), new RegExp(`^\\.${name}\\(`))
  }
})

test('site: the add menu stays usable on an empty result, and clearing the chain recovers the samples', async () => {
  await upload(await file('silent-menu.wav', [new Float32Array(4800)]))
  assert(await button('Play edited audio').isDisabled())
  assert(await downloadDisabled())
  assert(await addButton().isEnabled())
  await addMethod('gain')
  assert.match(await message(), /removed all samples/)
  await setChain('')
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
  assert((await page.evaluate(() => stops)) > 0, 'queued stream blocks are stopped')
  const count = await page.evaluate(() => blocks.length)
  await page.waitForTimeout(150)
  assert.equal(await page.evaluate(() => blocks.length), count, 'the cancelled producer schedules no more blocks')
  await setChain('.reverse()')
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
    // The menu tab stays directly over the trigger.
    return Math.abs(rect.top - anchor.top) < 1
  }, id, { timeout: 2000 })
  const before = await page.locator(id).boundingBox()
  await page.evaluate(() => window.scrollBy({ top: 50, behavior: 'instant' }))
  await page.waitForFunction(({ id, top }) => Math.abs(document.querySelector(id).getBoundingClientRect().top - top + 50) < 1, { id, top: before.y }, { timeout: 2000 })
  // A scroll event must not be mistaken for opening: let the trigger leave the viewport.
  const target = await trigger().evaluate(el => {
    const top = scrollY + el.getBoundingClientRect().top + 24
    window.scrollTo({ top, behavior: 'instant' })
    return top
  })
  await page.waitForFunction(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true)))))
  assert(Math.abs(await page.evaluate(() => scrollY) - target) < 1, 'scrolling does not pull the trigger back onscreen')
  assert(Math.abs((await page.locator(id).boundingBox()).y - (await trigger().boundingBox()).y) < 1, 'the menu still follows its offscreen trigger')
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

test('site: cursor level follows local samples; track headers show duration without peak levels', async () => {
  const pcm = [Float32Array.from({ length: 48000 }, (_, i) => i < 12000 ? 0 : i < 24000 ? .1 : .5)]
  await upload(await file('levels.wav', pcm))
  await setChain('')
  for (const name of ['original', 'edited']) {
    for (const [fraction, expected] of [[0, '−∞ dBFS'], [.3, '−20.0 dBFS'], [.6, '−6.0 dBFS'], [1, '−6.0 dBFS']]) {
      await cursor(name, fraction * 1000)
      assert.equal(await meter(), expected)
      assert(!(await page.locator(`.audio-row${name === 'edited' ? '.edited-row' : ':not(.edited-row)'} .wave-label`).textContent()).includes('dBFS'))
    }
  }
  await setChain('.gain(-6)')
  await cursor('edited', 300)
  assert.equal(await meter(), '−26.0 dBFS')
  await cursor('edited', 0)
  await button('Play edited audio').click()
  await page.waitForFunction(() => document.querySelector('.meters').textContent === '−26.0 dBFS')
  await page.waitForFunction(() => document.querySelector('.meters').textContent === '−12.0 dBFS')
  await button('Pause edited audio').click()
  await upload(await file('silent.wav', [new Float32Array(4800)]))
  assert.equal(await meter(), '–')
  await cursor('original', 0)
  assert.equal(await meter(), '−∞ dBFS')
})

test('site: the chain runs from the sound to the download, named after the source, in its format', async () => {
  // A file starts from the default edits, with nothing to undo.
  assert(await button('Undo').isDisabled())
  assert.equal(await sourceName(), first)
  assert.equal(await chain(), defaultChain)
  assert.equal(await pill('save').textContent(), `${first}-edited`)
  await exported('MP3')
  assert.equal(await pill('save').textContent(), `${first}-edited`)
  const expected = { 'Node.js': "save('edited.mp3')", Browser: "encode('mp3')", CLI: 'save edited.mp3' }
  for (const [tab, text] of Object.entries(expected)) {
    await button(tab).click()
    const code = await page.locator('.code-example pre').innerText()
    assert(code.includes(text), tab)
    if (tab === 'Browser') assert(code.includes("type: 'audio/mpeg'"))
  }
  // The MCP tab puts setup first, then the request in words and the tool call: the CLI's arguments.
  await button('MCP').click()
  const [install, config, ask, call] = (await page.locator('.code-example pre').innerText()).split('\n\n')
  assert.equal(install, '# Once, in Claude Code\nclaude mcp add audio -- npx -y audio --mcp')
  assert.match(config, /^# Or Claude Desktop, Cursor, VS Code\n/)
  assert.equal(ask.replace(/\n/g, ' '), '# Ask your agent In recording.wav, trim the silence, normalize the peak to −1dB, fade in 0.02s and out 0.1s, then save it as edited.mp3.')
  assert.equal(call, '# It calls the audio tool\nrecording.wav trim normalize -1 fade 0.02 -0.1 save edited.mp3')
  // Only the call's numbers read as code: the words' values stay plain.
  assert.deepEqual(await page.locator('.code-example pre .syntax-number').allTextContents(), ['-1', '0.02', '-0.1'])
  await setChain('')
  await button('MCP').click()
  assert.match(await page.locator('.code-example pre').innerText(), /\n\n# Ask your agent\nSave recording\.wav as edited\.mp3\.\n/)
  await setChain(defaultChain)
  // Opening a file names both ends after it, in the chosen format, and starts from the default edits.
  await upload(await file('field.wav', [tone(4800)]))
  assert.equal(await sourceName(), 'field.wav')
  assert.equal(await pill('source').getAttribute('title'), 'audio(file)')
  assert.equal(await pill('save').textContent(), 'field-edited')
  assert.equal(await chain(), defaultChain)
  // Command or Control+Z undoes, from anywhere in the demo.
  await removeStep(0)
  await pill(0).focus()
  await page.keyboard.press('ControlOrMeta+z'); await idle()
  assert.equal(await chain(), defaultChain)
})

test('site: the devices keep their height through menus, selection, playback errors, files, formats and tabs', async () => {
  // Only edits may resize a device; every other interaction fills a reserved slot.
  const height = selector => page.locator(selector).evaluate(el => el.getBoundingClientRect().height)
  const same = async (selector, expected, step) => assert(Math.abs(await height(selector) - expected) < .5, step)
  const demo = await height('.demo')
  // A step's menu floats over the page.
  await openPill(1)
  await same('.demo', demo, 'menu')
  await closeMenu()
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
  await setChain('.fade(0.02, 0.1)')
  await openPill(0)
  const control = menu().getByRole('slider', { name: 'Fade out (s)', exact: true })
  const before = await page.locator('#edited-wave .wave-glyphs').first().textContent()
  // Sample every frame of the drag: tracks and controls never fade, the waveform is never blank.
  await page.evaluate(() => {
    const watched = ['#original-wave', '#edited-wave', '.audio-row .play', '.edited-row .play', '.pill[data-key="0"]', '.undo', '.tool.add']
    window.samples = []
    window.watching = true
    const watch = () => {
      samples.push({ opacity: watched.map(selector => getComputedStyle(document.querySelector(selector)).opacity), bars: document.querySelector('#edited-wave .wave-glyphs').textContent.length })
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
    return { track: style(track).opacity, play: style(row.querySelector('.play')).opacity, caret: style(track, '::after').opacity, caretColor: style(track, '::after').backgroundColor, label: style(row.querySelector('.wave-label')).color }
  })
  await page.mouse.move(0, 0)
  const active = await look('edited'), inactive = await look('original')
  assert.deepEqual([active.track, active.play, active.caret], ['1', '1', '1'])
  assert.deepEqual([inactive.track, inactive.play, inactive.caret], ['1', '1', '1'])
  assert.notEqual(inactive.label, active.label)
  // Hover lights the label and caret; neither the track nor its playback button fades.
  const box = await page.locator('#original-wave').boundingBox()
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  assert.deepEqual(await look('original'), { ...inactive, label: active.label, caretColor: active.caretColor })
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
  assert.deepEqual(await look('edited'), { ...active, label: inactive.label, caretColor: inactive.caretColor })
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

test('site: selection actions replace Undo on the baseline without shifting the readout', async () => {
  assert.equal(await page.locator('.readout button:visible').count(), 1)
  assert(!(await button('Undo').isVisible()))
  await addMethod('gain')
  assert(await button('Undo').isEnabled())
  const layout = () => page.locator('.readout').evaluate(readout => {
    const baseline = el => { const probe = document.createElement('span'); probe.style.cssText = 'display: inline-block; width: 0; height: 0'; el.append(probe); const y = probe.getBoundingClientRect().top; probe.remove(); return y }
    const times = readout.querySelector('.timecode output'), meter = readout.querySelector('.meters'), box = times.getBoundingClientRect()
    return { time: baseline(times) - readout.getBoundingClientRect().top, meter: baseline(meter) - readout.getBoundingClientRect().top, height: readout.closest('.demo').offsetHeight, fits: box.right <= readout.querySelector('.readout-slot').getBoundingClientRect().right + .5, font: parseFloat(getComputedStyle(times).fontSize), loop: readout.querySelector('.loop svg').getBoundingClientRect().width }
  })
  for (const width of [1440, 1280, 960, 768, 414, 390, 375, 320]) {
    await page.setViewportSize({ width, height: 900 })
    const before = await layout()
    await dragWave('edited', .25, .5)
    const selected = await layout()
    assert.equal(selected.height, before.height, `${width}: player height`)
    assert(Math.abs(selected.time - before.time) < 1, `${width}: time baseline ${before.time} → ${selected.time}`)
    assert(Math.abs(selected.meter - before.meter) < 1, `${width}: level baseline ${before.meter} → ${selected.meter}`)
    assert(selected.fits && selected.font <= 32, `${width}: compact range fits`)
    assert.equal(selected.loop, 12)
    assert(!(await button('Undo').isVisible()))
    assert(await button('Crop selection').isVisible())
    assert(await button('Remove selection').isVisible())
    const actions = await page.locator('.action-buttons').evaluate(el => {
      const time = el.closest('.readout').querySelector('.timecode output'), probe = document.createElement('span')
      probe.style.cssText = 'display:inline-block;width:0;height:0'; time.append(probe)
      const baseline = probe.getBoundingClientRect().top; probe.remove()
      return [...el.querySelectorAll('button:not([hidden]) svg')].map(icon => icon.getBoundingClientRect().bottom - baseline)
    })
    assert(actions.every(drift => Math.abs(drift) < 1), `${width}: action icons on the time baseline ${actions}`)
    await slider('edited').press('Escape')
    assert.deepEqual(await layout(), before, `${width}: clearing restores the layout`)
  }
  await button('Undo').click(); await idle()
  assert.equal(await chain(), defaultChain)
  assert(!(await button('Undo').isVisible()))
})

for (const track of ['original', 'edited']) for (const method of ['crop', 'remove']) test(`site: quick ${method} uses the ${track} timeline and Undo restores the exact stereo audio`, async () => {
  const pcm = [tone(48000, 220, .5), tone(48000, 330, .25)]
  await upload(await file('quick.wav', pcm))
  await setChain('.gain(-6).reverse()')
  const before = await output()
  await dragWave(track, .25, .5)
  assert(!(await button('Undo').isVisible()))
  const action = button(method === 'crop' ? 'Crop selection' : 'Remove selection')
  await action.focus(); await page.keyboard.press('Enter'); await idle()
  assert.equal(await page.locator('.range').count(), 0)
  assert(await button('Undo').isVisible())
  assert(await button('Undo').evaluate(el => el === document.activeElement))
  const clip = audio.from(pcm, { sampleRate: 48000 }), range = { at: .25, duration: .25 }
  if (track === 'original') clip[method](range)
  clip.gain(-6).reverse()
  if (track === 'edited') clip[method](range)
  const expected = await clip.read(), result = await output()
  assert.equal(result.channels.length, 2)
  result.channels.forEach((channel, c) => {
    assert.equal(channel.length, expected[c].length)
    assert(channel.every((value, i) => Math.abs(value - expected[c][i]) < 1 / 32767))
  })
  clip.dispose()
  await button('Undo').click(); await idle()
  assert.equal(await chain(), '.gain(-6)\n.reverse()')
  assert.deepEqual(await output(), before)
})

test('site: quick actions recover from an empty result and render failure with Undo still available', async () => {
  await upload(await file('one-sample.wav', [new Float32Array([.25])]))
  await setChain('')
  const before = await output()
  await slider('edited').focus(); await page.keyboard.press('ControlOrMeta+a')
  await button('Remove selection').click(); await idle()
  assert(await button('Play edited audio').isDisabled())
  assert(!(await button('Remove selection').isVisible()))
  assert(await button('Undo').isVisible())
  await button('Undo').click(); await idle()
  assert.deepEqual(await output(), before)
  await slider('edited').focus(); await page.keyboard.press('ControlOrMeta+a')
  await page.evaluate(async () => {
    const { default: audio } = await import('./assets/audio.js'), read = audio.fn.read
    audio.fn.read = function () { audio.fn.read = read; return Promise.reject(new Error('quick edit failed')) }
  })
  await button('Crop selection').click(); await idle()
  assert.match(await message(), /could not be applied/)
  assert(await button('Undo').isVisible())
  await button('Undo').click(); await idle()
  assert.equal(await message(), '')
  assert.deepEqual(await output(), before)
})

// Coordinate-based drags must start after the previous crumb's return/swap animation.
const settled = locator => locator.evaluate(el => Promise.allSettled(el.getAnimations({ subtree: true }).map(animation => animation.finished)))

async function dragStep(from, to, release = true) {
  await closeMenu()
  await settled(page.locator('.chain'))
  const a = await pill(from).boundingBox(), b = await pill(to).boundingBox()
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2)
  await page.mouse.down()
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 12 })
  if (release) { await page.mouse.up(); await idle() }
}

async function dragToTrash(index, release = true) {
  await closeMenu()
  await settled(page.locator('.chain'))
  await pill(index).scrollIntoViewIfNeeded()
  const box = await pill(index).boundingBox(), x = box.x + box.width / 2, y = box.y + box.height / 2
  await page.mouse.move(x, y); await page.mouse.down()
  await page.mouse.move(x + 8, y)
  const trash = button('Remove effect')
  await trash.waitFor()
  const target = await trash.boundingBox()
  await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2, { steps: 8 })
  assert.equal(await page.locator('.add.drop-target').count(), 1)
  assert.equal(await page.locator('.pill.dragged').evaluate(el => getComputedStyle(el).visibility), 'hidden', 'the crumb does not obscure the trash target')
  if (release) { await page.mouse.up(); await idle() }
}

test('site: dropping on the plus-turned-trash removes only that effect, Undo restores PCM, and the last drop leaves Add', async () => {
  const pcm = tone(4800)
  await upload(await file('trash.wav', [pcm]))
  await setChain('.gain(-6).gain(-12).reverse()')
  const before = await output()
  await dragToTrash(1, false)
  assert.equal(await chain(), '.gain(-6)\n.gain(-12)\n.reverse()')
  await page.mouse.up(); await idle()
  assert.equal(await chain(), '.gain(-6)\n.reverse()')
  assert.equal(await page.locator('.pill.dragged, .add.trash, .add.drop-target').count(), 0)
  assert(!(await page.locator('#add-menu').isVisible()))
  assert.equal(await page.locator(':focus').getAttribute('data-key'), '0')
  const result = await output()
  assert(result.channels[0].every((value, i) => Math.abs(value - pcm.at(-1 - i) * 10 ** (-6 / 20)) < 1 / 32767))
  await button('Undo').click(); await idle()
  assert.equal(await chain(), '.gain(-6)\n.gain(-12)\n.reverse()')
  assert.deepEqual(await output(), before)
  await setChain('.reverse()')
  await dragToTrash(0)
  assert.equal(await chain(), '')
  assert(await addButton().evaluate(el => el === document.activeElement))
  const unchanged = await output()
  assert(unchanged.channels[0].every((value, i) => Math.abs(value - pcm[i]) < 1 / 32767))
  await addMethod('gain')
  await closeMenu(); await pill(0).focus(); await page.keyboard.press('Backspace'); await idle()
  assert.equal(await chain(), '')
  await button('Undo').click(); await idle()
  assert.equal(await chain(), '.gain(-6)')
})

test('site: cancelled trash drops restore Add without editing; touch can delete a wrapped crumb', async () => {
  for (const cancel of ['escape', 'pointercancel', 'lostpointercapture', 'blur', 'resize', 'pagehide', 'outside']) {
    await dragToTrash(0, false)
    if (cancel === 'escape') await page.keyboard.press('Escape')
    if (cancel === 'pointercancel') await page.evaluate(() => dispatchEvent(new PointerEvent('pointercancel', { pointerId: 1 })))
    if (cancel === 'lostpointercapture') await page.locator('.chain').evaluate(el => el.releasePointerCapture(1))
    if (cancel === 'blur' || cancel === 'resize') await page.evaluate(type => dispatchEvent(new Event(type)), cancel)
    if (cancel === 'pagehide') await page.evaluate(() => dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true })))
    if (cancel === 'outside') {
      await page.mouse.move(0, 0)
      assert.equal(await page.locator('.pill.dragged').evaluate(el => getComputedStyle(el).visibility), 'visible')
    }
    await page.mouse.up(); await idle()
    assert.equal(await chain(), defaultChain, cancel)
    assert.equal(await page.locator('.pill.dragged, .add.trash, .add.drop-target').count(), 0, cancel)
    assert(await addButton().isVisible(), cancel)
    assert(await button('Undo').isDisabled(), cancel)
    assert(!(await page.locator('#add-menu').isVisible()), cancel)
  }
  await page.setViewportSize({ width: 320, height: 900 })
  await settled(page.locator('.chain'))
  await pill(2).scrollIntoViewIfNeeded()
  const box = await pill(2).boundingBox(), x = box.x + box.width / 2, y = box.y + box.height / 2
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] })
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + 8, y }] })
  const trash = await button('Remove effect').boundingBox()
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: trash.x + trash.width / 2, y: trash.y + trash.height / 2 }] })
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await idle()
  assert.equal(await chain(), '.trim()\n.normalize(-1)')
  assert(await addButton().isVisible())
  await button('Undo').click(); await idle()
  assert.equal(await chain(), defaultChain)
})

test('site: an open crumb can be dragged through its connected menu tab', async () => {
  await openPill(0)
  const a = await pill(0).boundingBox(), b = await pill(2).boundingBox()
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2)
  await page.mouse.down()
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 12 })
  assert(await page.locator('.pill.dragged').isVisible())
  assert(!(await menu().isVisible()))
  await page.mouse.up(); await idle()
  assert.equal(await chain(), '.normalize(-1)\n.fade(0.02, 0.1)\n.trim()')
  assert(!(await menu().isVisible()), 'dropping does not reopen the menu')
  await undoEdit()
  assert.equal(await chain(), defaultChain)
  assert(await button('Undo').isDisabled(), 'one drop creates one history entry')
})

test('site: Add shows all methods without a scrollbar; a short viewport still reaches the last method', async () => {
  const menu = page.locator('#add-menu')
  for (const [width, height] of [[1440, 1000], [320, 900], [320, 350]]) {
    await page.setViewportSize({ width, height })
    await addButton().click()
    await page.waitForFunction(() => {
      const menu = document.querySelector('#add-menu')
      return menu.style.top && !menu.getAnimations().length
    })
    assert.equal(await menu.getByRole('button').count(), 16)
    const layout = await menu.evaluate(el => {
      const box = el.getBoundingClientRect()
      const body = el.querySelector('.add-body')
      return { top: box.top, bottom: box.bottom, client: body.clientHeight, scroll: body.scrollHeight, scrollbar: getComputedStyle(body).scrollbarWidth }
    })
    assert.equal(layout.scrollbar, 'none')
    assert(layout.top >= 16 && layout.bottom <= height - 16 + .5, `${width}×${height}: menu stays in the viewport`)
    if (height >= 900) assert.equal(layout.client, layout.scroll, 'all methods fit without scrolling')
    await menu.getByRole('button').first().focus()
    await page.keyboard.press('End')
    const last = menu.getByRole('button', { name: 'Add eq', exact: true })
    assert(await last.evaluate(el => el === document.activeElement))
    assert(await last.evaluate(el => {
      const box = el.getBoundingClientRect(), panel = el.closest('[popover]').getBoundingClientRect()
      return box.top >= panel.top && box.bottom <= panel.bottom
    }), 'the last method scrolls into view')
    await page.keyboard.press('Escape')
  }
})

test('site: dragging a crumb previews an animated swap, commits audio once, and Undo restores it', async () => {
  await upload(await file('reorder.wav', [tone(4800)]))
  await setChain('.gain(-6).normalize(-1)')
  const prior = await output()
  await dragStep(0, 1, false)
  assert.equal(await chain(), '.gain(-6)\n.normalize(-1)', 'dragging has not changed the audio chain yet')
  assert(await page.locator('.pill.dragged').isVisible())
  assert.equal(await page.locator('.pill.dragged').evaluate(el => getComputedStyle(el).opacity), '1')
  assert.equal(await page.locator('.chain .link').last().evaluate(el => el.style.order), '0')
  assert(await page.locator('.chain .link').last().evaluate(el => el.getAnimations().length > 0), 'neighbor animates into its new place')
  await page.mouse.up(); await idle()
  assert.equal(await chain(), '.normalize(-1)\n.gain(-6)')
  assert.equal(await page.locator('.pill.dragged').count(), 0)
  assert.equal(await menu().isVisible(), false, 'dropping does not click the crumb')
  const changed = await output()
  assert(changed.channels[0].every((value, i) => Math.abs(value - prior.channels[0][i] * 10 ** (-6 / 20)) < 1 / 32767))
  await undoEdit()
  assert.equal(await chain(), '.gain(-6)\n.normalize(-1)')
  assert.deepEqual(await output(), prior)
})

test('site: interrupted crumb drags restore the chain without an Undo entry', async () => {
  for (const cancel of ['escape', 'pointercancel', 'lostpointercapture', 'blur', 'resize', 'pagehide', 'outside']) {
    await dragStep(0, 2, false)
    if (cancel === 'escape') await page.keyboard.press('Escape')
    if (cancel === 'pointercancel') await page.evaluate(() => window.dispatchEvent(new PointerEvent('pointercancel', { pointerId: 1 })))
    if (cancel === 'lostpointercapture') await page.locator('.chain').evaluate(el => el.releasePointerCapture(1))
    if (cancel === 'blur') await page.evaluate(() => dispatchEvent(new Event('blur')))
    if (cancel === 'resize') {
      await page.setViewportSize({ width: 1264, height: 720 })
      await page.locator('.pill.dragged').waitFor({ state: 'detached' })
    }
    if (cancel === 'pagehide') await page.evaluate(() => dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true })))
    if (cancel === 'outside') await page.mouse.move(0, 0)
    await page.mouse.up(); await idle()
    assert.equal(await chain(), defaultChain, cancel)
    assert.equal(await page.locator('.pill.dragged').count(), 0, cancel)
    assert(await button('Undo').isDisabled(), cancel)
    assert(await page.locator('.chain .link').evaluateAll(els => els.every(el => !el.style.order)), cancel)
  }
})

test('site: keyboard arrows reorder duplicate methods, respect boundaries, and preserve focus', async () => {
  await setChain('.gain(-6).gain(-12).reverse()')
  await closeMenu()
  await pill(0).focus()
  await page.keyboard.press('Alt+ArrowLeft'); await idle()
  assert.equal(await chain(), '.gain(-6)\n.gain(-12)\n.reverse()')
  await page.keyboard.press('Alt+ArrowRight'); await idle()
  assert.equal(await chain(), '.gain(-12)\n.gain(-6)\n.reverse()')
  assert.equal(await page.locator(':focus').getAttribute('data-key'), '1')
  await page.keyboard.press('Alt+ArrowRight'); await idle()
  assert.equal(await chain(), '.gain(-12)\n.reverse()\n.gain(-6)')
  assert.equal(await page.locator(':focus').getAttribute('data-key'), '2')
  await page.keyboard.press('Alt+ArrowRight'); await idle()
  assert.equal(await chain(), '.gain(-12)\n.reverse()\n.gain(-6)')
  await page.keyboard.press('Alt+ArrowLeft'); await idle()
  assert.equal(await chain(), '.gain(-12)\n.gain(-6)\n.reverse()')
})

test('site: touch reorders wrapped crumbs and reduced motion skips swap animation', async () => {
  await page.setViewportSize({ width: 320, height: 900 })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.locator('.chain').scrollIntoViewIfNeeded()
  const a = await pill(0).boundingBox(), b = await pill(2).boundingBox()
  assert(b.y > a.y, 'crumbs wrap at this width')
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: a.x + a.width / 2, y: a.y + a.height / 2 }] })
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: b.x + b.width / 2, y: b.y + b.height / 2 }] })
  assert(await page.locator('.pill.dragged').isVisible())
  assert.equal(await page.locator('.chain').evaluate(el => el.getAnimations({ subtree: true }).length), 0)
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await idle()
  assert.equal(await chain(), '.normalize(-1)\n.fade(0.02, 0.1)\n.trim()')
  assert(await addButton().isVisible())
})

test('site: rules and players meet the dot grid; matching file pills fit beside their tracks', async () => {
  await upload(await file('a-very-long-field-recording-filename-that-must-fit.wav', [tone(4800)]))
  for (const width of [320, 375, 414, 768, 1024, 1440, 1920]) {
    await page.setViewportSize({ width, height: 900 })
    await page.mouse.move(0, 0)
    await page.locator('.pill').evaluateAll(pills => Promise.all(pills.flatMap(pill => pill.getAnimations().map(animation => animation.finished))))
    await page.waitForFunction(() => {
      return [...document.querySelectorAll('.footer, .demo, .code-example')].every(el => {
        const top = el.getBoundingClientRect().top + scrollY
        return Math.abs(top / 16 - Math.round(top / 16)) < .01
      })
    })
    const layout = await page.evaluate(() => {
      const box = el => el.getBoundingClientRect(), header = box(document.querySelector('.header')), footer = box(document.querySelector('.footer'))
      const onGrid = x => Math.abs((x - innerWidth / 2) / 16 - Math.round((x - innerWidth / 2) / 16)) < .01
      return {
        edges: [header, footer, ...[...document.querySelectorAll('.demo, .code-example')].map(box)].every(rect => onGrid(rect.left) && onGrid(rect.right)),
        header: (header.bottom + scrollY) % 16,
        phase: getComputedStyle(document.body).backgroundPosition,
        fits: [...document.querySelectorAll('.wave-label')].every(row => {
          const label = box(row.querySelector('.track-name')), file = box(row.querySelector('.track-file')), duration = box(row.querySelector('.duration'))
          return file.left >= label.right && file.right <= duration.left && duration.right <= box(row).right + .5 && Math.abs(file.top - box(row).top) < 1
        }),
        overflow: document.documentElement.scrollWidth > innerWidth
      }
    })
    assert(layout.edges && layout.header === 0, `${width}: aligned rules and players`)
    assert.equal(layout.phase.split(',')[0], '50% -8px')
    assert(layout.fits && !layout.overflow, `${width}: track controls fit`)
    const style = key => pill(key).evaluate(el => {
      const css = getComputedStyle(el)
      return ['height', 'fontSize', 'paddingLeft', 'paddingRight', 'borderTopWidth', 'borderTopColor', 'backgroundColor'].map(name => css[name])
    })
    assert.deepEqual(await style('source'), await style(0), `${width}: source matches edit pills`)
    assert.deepEqual(await style('save'), await style(0), `${width}: output matches edit pills`)
    for (const key of ['source', 'save']) {
      assert.equal(await pill(key).evaluate(el => getComputedStyle(el).gap), '6px')
      await openPill(key)
      assert.equal(await menu().locator('.pill-tab').evaluate(el => getComputedStyle(el).gap), '6px')
      await closeMenu()
    }
    if (width === 375) {
      const top = () => page.locator('.code-example').evaluate(el => el.getBoundingClientRect().top + scrollY)
      const before = await top()
      await setParam(1, 'Peak (dB)', -3)
      await closeMenu()
      assert(Math.abs(await top() - before) < .5, 'updating the code preserves its grid alignment')
    }
  }
})

test('site: an empty chain accepts a first edit; single-crumb boundary moves and same-slot drops add no Undo step', async () => {
  await upload(await file('single-step.wav', [tone(4800)]))
  await setChain('')
  assert.equal(await steps().count(), 0)
  const unchanged = await output()
  await addMethod('reverse')
  await closeMenu()
  await pill(0).focus()
  await page.keyboard.press('Alt+ArrowLeft')
  await page.keyboard.press('Alt+ArrowRight')
  await pill(0).click()
  assert(!(await menu().isVisible()))
  const box = await pill(0).boundingBox(), x = box.x + box.width / 2, y = box.y + box.height / 2
  await page.mouse.move(x, y); await page.mouse.down()
  await page.mouse.move(x + 10, y)
  assert(await page.locator('.pill.dragged').isVisible())
  await page.mouse.up(); await idle()
  assert.equal(await chain(), '.reverse()')
  assert.equal(await menu().isVisible(), false)
  await undoEdit()
  assert.equal(await chain(), '', 'one Undo removes the edit, not an ineffective reorder')
  assert.deepEqual(await output(), unchanged)
})

test('site: a pending reorder rejects another drag; a render failure disables stale output and Undo restores PCM', async () => {
  await upload(await file('reorder-failure.wav', [tone(4800)]))
  await setChain('.gain(-6).normalize(-1)')
  const prior = await output()
  await page.evaluate(async () => {
    const { default: audio } = await import('./assets/audio.js'), read = audio.fn.read
    audio.fn.read = function () {
      audio.fn.read = read
      return new Promise((_, reject) => { window.rejectReorder = () => reject(new Error('render failed')) })
    }
  })
  await dragStep(0, 1, false)
  await page.mouse.up()
  await page.waitForFunction(() => typeof rejectReorder === 'function')
  assert.equal(await chain(), '.normalize(-1)\n.gain(-6)')
  await dragStep(0, 1, false)
  assert.equal(await page.locator('.pill.dragged').count(), 0)
  await page.mouse.up()
  await page.evaluate(() => rejectReorder()); await idle()
  assert.match(await message(), /could not be applied/)
  assert(await button('Play edited audio').isDisabled())
  assert(await downloadDisabled())
  assert(await button('Play original audio').isEnabled())
  await undoEdit()
  assert.equal(await chain(), '.gain(-6)\n.normalize(-1)')
  assert.equal(await message(), '')
  assert.deepEqual(await output(), prior)
})

for (const name of ['original', 'edited']) test(`site: ${name} loops a selected range and stops at its end when toggled off`, async () => {
  await upload(await file('loop.wav', [new Float32Array(28800).fill(.25)]))
  await setChain('.gain(0)')
  await dragWave(name, .25, .75)
  await watchPlayback()
  assert.equal(await button('Loop playback').getAttribute('aria-pressed'), 'false')
  await button('Loop playback').click()
  await button(`Play ${name} audio`).click()
  await page.waitForTimeout(1000)
  assert(await button(`Pause ${name} audio`).isVisible())
  const value = +(await slider(name).inputValue())
  assert(value >= 249 && value <= 751, `loop cursor ${value}`)
  if (name === 'edited') {
    const blocks = await page.evaluate(() => blocks)
    for (let i = 1; i < blocks.length; i++) assert(Math.abs(blocks[i].at - blocks[i - 1].at - blocks[i - 1].duration) < 1e-6)
    await setParam(0, 'Gain (dB)', -6)
    await page.waitForFunction(() => blocks.at(-1).rms < .14)
    assert(await button('Pause edited audio').isVisible())
    await closeMenu()
  }
  await button('Loop playback').click()
  assert.equal(await button('Loop playback').getAttribute('aria-pressed'), 'false')
  await button(`Play ${name} audio`).waitFor()
  assert(Math.abs(+(await slider(name).inputValue()) - 750) <= 2)
})

test('site: a one-sample edited loop batches repetitions and pause cancels its producer', async () => {
  await upload(await file('one.wav', [Float32Array.of(.25)]))
  await setChain('')
  await watchPlayback()
  await button('Loop playback').click()
  await button('Play edited audio').click()
  await page.waitForTimeout(200)
  const blocks = await page.evaluate(() => blocks)
  assert(blocks.length > 2 && blocks.length < 30)
  assert(blocks.every(block => block.duration === 1024 / 48000 && Math.abs(block.rms - .25) < 1e-5))
  await button('Pause edited audio').click()
  const count = await page.evaluate(() => blocks.length)
  await page.waitForTimeout(150)
  assert.equal(await page.evaluate(() => blocks.length), count)
  await button('Play edited audio').click()
  await page.waitForFunction(count => blocks.length > count, count)
  await button('Pause edited audio').click()
  await upload(await file('stereo-b.wav', [Float32Array.of(.5, .5, .5), Float32Array.of(-.25, -.25, -.25)]))
  await setChain('')
  await button('Play edited audio').click()
  await page.waitForFunction(() => blocks.at(-1).rms === .5)
  assert.equal(await page.evaluate(() => streams.at(-1).channels), 2)
  await button('Pause edited audio').click()
})

test('site: trim exposes automatic and explicit thresholds, including silence and both slider boundaries', async () => {
  const pcm = Float32Array.from({ length: 10240 }, (_, i) => i < 3072 || i >= 7168 ? .005 : .25)
  await upload(await file('threshold.wav', [pcm]))
  await setChain('.trim()')
  await openPill(0)
  assert.equal(await button('Auto').getAttribute('aria-pressed'), 'true')
  assert.equal(await menu().getByRole('slider', { name: 'Threshold (dB)' }).count(), 1)
  for (const db of [-80, -30, 0]) {
    await setParam(0, 'Threshold (dB)', db)
    assert.equal(await chain(), `.trim(${db})`)
    const expected = await audio.from([pcm], { sampleRate: 48000 }).trim(db).read()
    if (!expected[0].length) assert(await downloadDisabled())
    else {
      const actual = (await output()).channels[0]
      assert.equal(actual.length, expected[0].length)
      assert(actual.every((sample, i) => Math.abs(sample - expected[0][i]) < 1 / 32767))
    }
  }
  await openPill(0)
  await button('Auto').click(); await idle()
  assert.equal(await chain(), '.trim()')
  assert(!(await downloadDisabled()))
  await undoEdit()
  assert.equal(await chain(), '.trim(0)')
  assert(await downloadDisabled())
})

test('site: source menu fits its content and trailing chevrons stay on the preceding wrapped line', async () => {
  for (const width of [1440, 375, 320]) {
    await page.setViewportSize({ width, height: 900 })
    await openPill('source')
    const body = await menu().locator('.pill-body').evaluate(el => ({ width: el.clientWidth, scrollWidth: el.scrollWidth, height: el.clientHeight, scrollHeight: el.scrollHeight, scrollbar: getComputedStyle(el).scrollbarWidth }))
    assert.equal(body.width, body.scrollWidth)
    assert(body.scrollHeight - body.height <= 1)
    assert.equal(body.scrollbar, 'none')
    await closeMenu()
    assert(await page.locator('.chain .link').evaluateAll(links => links.every(el => {
      const pill = el.querySelector('.pill').getBoundingClientRect(), joint = el.querySelector('.joint').getBoundingClientRect()
      return !joint.width || (joint.left >= pill.right && joint.top >= pill.top && joint.bottom <= pill.bottom)
    })))
  }
})

test('site: FLAC, AIFF and Ogg export real stereo audio and load codecs only on demand', async () => {
  const requested = []
  page.on('request', request => requested.push(request.url()))
  const pcm = [tone(48000, 220), tone(48000, 550, .1)]
  await upload(await file('formats.wav', pcm))
  await setChain('')
  for (const ext of ['flac', 'aiff', 'ogg']) {
    assert(!requested.some(url => url.endsWith(`/${ext}.js`)))
    const result = await exported(ext)
    assert.equal(result.filename, `formats-edited.${ext}`)
    assert.equal(await pill('save').textContent(), 'formats-edited')
    assert(requested.some(url => url.endsWith(`/${ext}.js`)))
    assert.equal(result.bytes.subarray(0, 4).toString(), { flac: 'fLaC', aiff: 'FORM', ogg: 'OggS' }[ext])
    const clip = await audio(result.bytes), decoded = await clip.read()
    assert.equal(decoded.length, 2)
    assert(Math.abs(decoded[0].length - pcm[0].length) < 1024)
    for (let c = 0; c < 2; c++) {
      assert(decoded[c].every(Number.isFinite))
      const error = Math.sqrt(decoded[c].slice(12000, 36000).reduce((sum, value, i) => sum + (value - pcm[c][i + 12000]) ** 2, 0) / 24000)
      assert(error < (ext === 'ogg' ? .03 : 1 / 32767), `${ext} channel ${c}: ${error}`)
    }
    clip.dispose()
  }
})

async function recordFromMenu() {
  await openPill('source')
  await menu().getByRole('button', { name: 'Record', exact: true }).click()
}
async function syntheticMicrophone(level = 1) {
  await page.evaluate(level => {
    navigator.mediaDevices.getUserMedia = async constraints => {
      window.micConstraints = constraints
      const ctx = window.micContext = new AudioContext(), source = ctx.createOscillator(), destination = ctx.createMediaStreamDestination()
      const gain = window.micGain = ctx.createGain()
      gain.gain.value = level
      source.frequency.value = 440
      source.connect(gain).connect(destination); source.start(); await ctx.resume()
      window.micStream = destination.stream
      return destination.stream
    }
  }, level)
}

test('site: Record captures a local microphone twice, releases tracks, and loads playable exportable samples', async () => {
  await syntheticMicrophone()
  await page.evaluate(() => {
    const timeout = window.setTimeout
    window.setTimeout = (fn, ms, ...args) => {
      if (ms === 120000) window.recordingLimit = fn
      return timeout(fn, ms, ...args)
    }
  })
  for (let take = 0; take < 2; take++) {
    await recordFromMenu()
    await button('Stop recording').waitFor()
    assert.deepEqual(await page.evaluate(() => micConstraints), { audio: true })
    assert(await button('Stop recording').evaluate(el => el.matches('.audio-row:not(.edited-row) .play') && el.querySelector('.stopped')))
    assert(!(await page.locator('.loop').isVisible()))
    assert(await page.locator('.loop').isDisabled())
    await page.waitForTimeout(400)
    if (take) await page.evaluate(() => recordingLimit())
    else await button('Stop recording').click()
    await idle()
    assert.equal(await sourceName(), 'recording')
    assert.equal(await pill('save').textContent(), 'recording-edited')
    assert(await page.evaluate(() => micStream.getTracks().every(track => track.readyState === 'ended')))
    const result = await output()
    assert(result.channels[0].length > 4800)
    assert(result.channels[0].every(Number.isFinite))
    assert(result.channels[0].some(value => Math.abs(value) > .1))
    await button('Play original audio').click()
    await button('Pause original audio').waitFor()
    await button('Pause original audio').click()
    await page.evaluate(() => micContext.close())
  }
})

test('site: recording fills the original waveform with a red caret and stops from its play control', async () => {
  await setChain('.trim(0)')
  assert.match(await message(), /removed all samples/)
  await syntheticMicrophone(0)
  const height = (await page.locator('.demo').boundingBox()).height
  const live = () => page.locator('#original-wave').evaluate(track => ({
    progress: parseFloat(track.style.getPropertyValue('--progress')),
    peaks: [...track.querySelector('.wave-glyphs').textContent].map(char => char.charCodeAt(0) - 256),
    caret: getComputedStyle(track, '::after').backgroundColor,
    opacity: getComputedStyle(track, '::after').opacity,
    clip: getComputedStyle(track.querySelector('.wave-glyphs')).clipPath
  }))
  await recordFromMenu(); await button('Stop recording').waitFor()
  assert.equal(await message(), '')
  await page.waitForTimeout(200)
  const silent = await live()
  assert(silent.peaks.every(peak => peak === 1))
  assert(silent.progress > 0 && silent.progress < 20)
  assert.equal(silent.opacity, '1')
  assert.notEqual(silent.clip, 'none')
  const red = await page.locator('.demo').evaluate(el => {
    const probe = document.createElement('span')
    probe.style.color = 'var(--color-screen-record)'; el.append(probe)
    const color = getComputedStyle(probe).color; probe.remove(); return color
  })
  assert.equal(silent.caret, red)
  await page.evaluate(() => { micGain.gain.value = .5 })
  await page.waitForFunction(() => [...document.querySelector('#original-wave .wave-glyphs').textContent].some(char => char.charCodeAt(0) > 280))
  const loud = await live()
  assert(loud.progress > silent.progress)
  assert.equal((await page.locator('.demo').boundingBox()).height, height)
  await page.setViewportSize({ width: 375, height: 900 })
  await page.waitForTimeout(100)
  assert((await live()).peaks.some(peak => peak > 24))
  // Crossing the first five-second window keeps the recorded peaks and makes room for more.
  await page.waitForFunction(() => document.querySelector('.recording-status output')?.textContent === '0:05.2')
  const expanded = await live()
  assert(expanded.progress > 50 && expanded.progress < 60)
  assert(expanded.peaks.some(peak => peak > 24))
  await button('Stop recording').click(); await idle()
  assert(await button('Play original audio').isVisible())
  assert(!(await button('Loop playback').isDisabled()))
  assert.equal(await page.locator('.audio-row.recording').count(), 0)
  assert.equal((await live()).progress, 0)
  assert.notEqual((await live()).caret, red)
  assert.equal((await live()).clip, 'none')
  await page.evaluate(() => micContext.close())
})

test('site: denied, missing and cancelled microphone requests preserve the source and release late tracks', async () => {
  const before = await output()
  for (const name of ['NotAllowedError', 'NotFoundError']) {
    await page.evaluate(name => { navigator.mediaDevices.getUserMedia = async () => { throw new DOMException('Unavailable', name) } }, name)
    await recordFromMenu(); await idle()
    assert.match(await message(), name === 'NotAllowedError' ? /denied/ : /unavailable/)
    assert.equal(await sourceName(), first)
    assert.deepEqual(await output(), before)
  }
  await syntheticMicrophone()
  await page.evaluate(() => { const get = navigator.mediaDevices.getUserMedia; navigator.mediaDevices.getUserMedia = () => new Promise(resolve => { window.allowMic = async () => resolve(await get({ audio: true })) }) })
  await recordFromMenu()
  await button('Cancel recording').click(); await idle()
  await page.evaluate(() => allowMic())
  await page.waitForFunction(() => micStream.getTracks().every(track => track.readyState === 'ended'))
  assert.equal(await sourceName(), first)
  await page.evaluate(() => micContext.close())
})

test('site: an empty recording and recorder errors recover; pagehide releases an active microphone', async () => {
  const waveform = await page.locator('#original-wave .wave-glyphs').first().textContent()
  await syntheticMicrophone()
  await page.evaluate(() => {
    window.NativeRecorder = MediaRecorder
    window.MediaRecorder = class {
      state = 'inactive'
      constructor() { window.recorder = this }
      start() { this.state = 'recording' }
      stop() { this.state = 'inactive'; queueMicrotask(() => this.onstop?.()) }
    }
  })
  await recordFromMenu(); await button('Stop recording').click(); await idle()
  assert.match(await message(), /No audio/)
  assert.equal(await sourceName(), first)
  assert.equal(await page.locator('#original-wave .wave-glyphs').first().textContent(), waveform)
  assert(await page.evaluate(() => micStream.getTracks().every(track => track.readyState === 'ended')))
  await page.evaluate(() => micContext.close())
  await recordFromMenu(); await page.evaluate(() => recorder.onerror()); await idle()
  assert.match(await message(), /Recording failed/)
  assert.equal(await page.locator('#original-wave .wave-glyphs').first().textContent(), waveform)
  assert(await page.evaluate(() => micStream.getTracks().every(track => track.readyState === 'ended')))
  await page.evaluate(() => micContext.close())
  await recordFromMenu()
  await page.evaluate(() => window.dispatchEvent(new Event('pagehide'))); await idle()
  assert(await page.evaluate(() => micStream.getTracks().every(track => track.readyState === 'ended')))
  assert.equal(await sourceName(), first)
  assert.equal(await page.locator('#original-wave .wave-glyphs').first().textContent(), waveform)
  await page.evaluate(() => micContext.close())
})

test('site: scoped trim keeps its range when switching between Auto and explicit thresholds', async () => {
  const pcm = Float32Array.from({ length: 48000 }, (_, i) => i < 12000 || i >= 36000 ? .005 : .25)
  await upload(await file('scoped-trim.wav', [pcm]))
  await setChain('')
  await dragWave('edited', .1, .9)
  await addMethod('trim')
  await setParam(0, 'Start (s)', .2)
  const scope = { at: .2, duration: .8 }
  assert.equal(await chain(), '.trim({ at: 0.2, duration: 0.8 })')
  await setParam(0, 'Threshold (dB)', -30)
  assert.equal(await chain(), '.trim(-30, { at: 0.2, duration: 0.8 })')
  let expected = await audio.from([pcm], { sampleRate: 48000 }).trim(-30, scope).read()
  let actual = (await output()).channels[0]
  assert.equal(actual.length, expected[0].length)
  assert(actual.every((value, i) => Math.abs(value - expected[0][i]) < 1 / 32767))
  await openPill(0); await button('Auto').click(); await idle()
  await setParam(0, 'Duration (s)', .5)
  assert.equal(await chain(), '.trim({ at: 0.2, duration: 0.5 })')
  expected = await audio.from([pcm], { sampleRate: 48000 }).trim({ at: .2, duration: .5 }).read()
  actual = (await output()).channels[0]
  assert.equal(actual.length, expected[0].length)
  assert(actual.every((value, i) => Math.abs(value - expected[0][i]) < 1 / 32767))
})

test('site: pagehide ignores a recording whose decode finishes after suspension', async () => {
  await syntheticMicrophone()
  await recordFromMenu(); await button('Stop recording').waitFor()
  await page.waitForTimeout(300)
  await page.evaluate(() => {
    const decode = AudioContext.prototype.decodeAudioData
    AudioContext.prototype.decodeAudioData = function(...args) {
      return new Promise(resolve => { window.finishCapture = async () => resolve(await decode.apply(this, args)) })
    }
  })
  await button('Stop recording').click()
  await page.waitForFunction(() => window.finishCapture)
  await page.evaluate(() => window.dispatchEvent(new Event('pagehide'))); await idle()
  await page.evaluate(() => finishCapture())
  assert.equal(await sourceName(), first)
  assert(await page.evaluate(() => micStream.getTracks().every(track => track.readyState === 'ended')))
  await page.evaluate(() => micContext.close())
})

test('site: stale recording callbacks cannot stop a newer take', async () => {
  await syntheticMicrophone()
  await page.evaluate(() => {
    const timeout = window.setTimeout
    window.setTimeout = (fn, ms, ...args) => {
      if (ms === 120000) window.recordingLimit = fn
      return timeout(fn, ms, ...args)
    }
    window.MediaRecorder = class {
      state = 'inactive'
      constructor() { window.recorder = this }
      start() { this.state = 'recording' }
      stop() { this.state = 'inactive'; queueMicrotask(() => this.onstop?.()) }
    }
  })
  await recordFromMenu(); await button('Stop recording').waitFor()
  await page.evaluate(() => { window.oldError = recorder.onerror; window.oldLimit = recordingLimit; window.dispatchEvent(new Event('pagehide')) })
  await idle(); await page.evaluate(() => micContext.close())
  await recordFromMenu(); await button('Stop recording').waitFor()
  for (const callback of ['oldError', 'oldLimit']) {
    await page.evaluate(callback => window[callback](), callback)
    assert(await button('Stop recording').isVisible())
    assert(await page.evaluate(() => micStream.getTracks().every(track => track.readyState === 'live')))
    assert.equal(await message(), '')
  }
  await page.evaluate(() => recorder.onerror()); await idle()
  assert.match(await message(), /Recording failed/)
  assert(await page.evaluate(() => micStream.getTracks().every(track => track.readyState === 'ended')))
  await page.evaluate(() => micContext.close())
})

test('site: the desktop widget fits its default chain and the add menu joins its trigger', async () => {
  for (const width of [960, 1024, 1120, 1280, 1440, 1920, 375, 320]) {
    await page.setViewportSize({ width, height: 1000 })
    const layout = await page.locator('.demo').evaluate(demo => ({
      width: demo.getBoundingClientRect().width,
      rows: new Set([...demo.querySelectorAll('.link')].map(el => el.offsetTop)).size,
      overflow: document.documentElement.scrollWidth > innerWidth
    }))
    assert(!layout.overflow)
    if (width >= 960) { assert(layout.width >= 464); assert.equal(layout.rows, 1) }
    await addButton().click()
    await page.waitForFunction(() => {
      const menu = document.querySelector('#add-menu'), tab = menu.querySelector('.add-tab').getBoundingClientRect()
      const trigger = document.querySelector('.tool.add').getBoundingClientRect(), body = menu.querySelector('.add-body').getBoundingClientRect()
      return !menu.getAnimations().length && Math.abs(tab.x - trigger.x) < 1 && Math.abs(tab.y - trigger.y) < 1 && Math.abs(tab.width - trigger.width) < 1 && Math.abs(tab.height - trigger.height) < 1 && Math.abs(body.y - trigger.bottom + 1) < 1
    })
    await addButton().click()
    await page.locator('#add-menu').waitFor({ state: 'hidden' })
  }
})

test('site: add stays beside the final crumb at every wrap boundary', async () => {
  for (const chain of [defaultChain, '.trim()\n.normalize(-1)\n.fade(0.02, 0.1)\n.gain(-6)', '.fade(0.02, 0.1)', '']) {
    await setChain(chain)
    await closeMenu()
    const failures = await page.locator('.demo').evaluate(demo => {
      const failures = []
      for (let width = 256; width <= 560; width += 4) {
        demo.style.width = width + 'px'
        const css = getComputedStyle(demo), box = demo.getBoundingClientRect()
        const add = demo.querySelector('.add').getBoundingClientRect(), last = demo.querySelector('.link:last-child .pill')?.getBoundingClientRect()
        const center = add.y + add.height / 2
        if (last && (Math.abs(center - last.y - last.height / 2) > 1 || last.right > add.left || Math.abs(last.bottom + parseFloat(css.paddingBottom) - box.bottom) > 1)) failures.push(width)
        if (!last && Math.abs(center - box.bottom + parseFloat(css.paddingBottom) + 15) > 1) failures.push(width)
      }
      demo.style.width = ''
      return failures
    })
    assert.deepEqual(failures, [], chain || 'empty chain')
  }
  await addMethod('gain')
  assert.equal(await steps().count(), 1)
})

test('site: utility icons share the content edge and loop colors stay stable through clicks and hover', async () => {
  for (const width of [1440, 375, 320]) {
    await page.setViewportSize({ width, height: 1000 })
    const geometry = await page.locator('.demo').evaluate(demo => {
      const edge = demo.getBoundingClientRect().right - parseFloat(getComputedStyle(demo).paddingRight)
      const crumb = demo.querySelector('.link:last-child').getBoundingClientRect(), add = demo.querySelector('.add svg').getBoundingClientRect()
      return [
        ...['.add svg', '.duration'].map(selector => ({ selector, gap: edge - demo.querySelector(selector).getBoundingClientRect().right })),
        { selector: 'last crumb center', gap: crumb.y + crumb.height / 2 - add.y - add.height / 2 }
      ]
    })
    assert(geometry.every(({ gap }) => Math.abs(gap) < 1), JSON.stringify(geometry))
  }
  await page.mouse.move(0, 0)
  const look = () => button('Loop playback').evaluate(el => { const style = getComputedStyle(el); return { color: style.color, background: style.backgroundColor, opacity: style.opacity } })
  const rest = await look()
  assert.equal(rest.opacity, '1')
  await button('Loop playback').hover()
  assert.deepEqual(await look(), rest)
  await page.evaluate(() => {
    window.loopFrames = []
    window.watchLoop = true
    const watch = () => {
      const button = document.querySelector('.loop')
      const style = getComputedStyle(button)
      loopFrames.push([button.getAttribute('aria-pressed'), style.color, style.opacity])
      if (watchLoop) requestAnimationFrame(watch)
    }
    watch()
  })
  await page.mouse.down(); await page.waitForTimeout(80)
  assert.deepEqual(await look(), rest)
  await page.mouse.up()
  const on = await look()
  assert.notEqual(on.color, rest.color)
  assert.equal(on.background, rest.background)
  await page.mouse.down(); await page.waitForTimeout(80)
  assert.deepEqual(await look(), on)
  await page.mouse.up()
  assert.deepEqual(await look(), rest)
  for (let i = 0; i < 4; i++) await button('Loop playback').click()
  for (const expected of [rest, on]) {
    await button('Loop playback').focus()
    await page.keyboard.down('Space'); await page.waitForTimeout(80)
    assert.deepEqual(await look(), expected)
    await page.keyboard.up('Space')
  }
  await page.mouse.move(0, 0)
  assert.deepEqual(await look(), rest)
  const frames = await page.evaluate(() => { watchLoop = false; return loopFrames })
  assert(frames.every(([pressed, color, opacity]) => color === (pressed === 'true' ? on.color : rest.color) && opacity === '1'), JSON.stringify(frames))
  assert.equal(await page.locator('.track-peak').count(), 0)
  await openPill('save')
  assert.equal(await pill('save').locator('svg').count(), 1)
  assert.deepEqual(await menu().locator('.format-icon').allTextContents(), ['WAV', 'MP3', 'FLAC', 'AIFF', 'OGG'])
  assert.equal(await menu().locator('.method-option > svg:not(.format-icon)').count(), 0)
})

async function workshop() {
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto(origin + '/workshop.html', { waitUntil: 'networkidle' })
  for (const element of await page.locator('iframe').all()) {
    await element.scrollIntoViewIfNeeded()
    const frame = await element.contentFrame()
    await frame.locator('.demo[aria-busy="false"]').waitFor()
  }
  await page.waitForFunction(() => document.querySelectorAll('iframe[data-ready]').length === 6)
}

test('workshop: all six live layouts preserve the original and fit desktop, narrow and mobile widths', async () => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  const appearance = demo => {
    const css = getComputedStyle(demo), pill = getComputedStyle(demo.querySelector('.pill'))
    return [css.padding, pill.borderColor, pill.backgroundColor, getComputedStyle(demo.querySelector('.timecode')).fontSize]
  }
  const original = await page.locator('.demo').evaluate(appearance)
  await workshop()
  assert.deepEqual(await page.frameLocator('#round-bottom iframe').locator('.demo').evaluate(appearance), original)
  for (const element of await page.locator('iframe').all()) {
    const frame = await element.contentFrame()
    assert.equal((await frame.locator('.chain .pill').evaluateAll(pills => pills.map(p => p.title))).join('\n'), defaultChain)
    const layout = await frame.locator('.demo').evaluate(demo => {
      const box = selector => demo.querySelector(selector).getBoundingClientRect()
      return { middle: !!demo.querySelector('.pipeline'), first: box('.audio-row'), edited: box('.edited-row'), chain: box('.chain'), pills: [...demo.querySelectorAll('.chain .pill')].map(p => p.getBoundingClientRect().top) }
    })
    assert(layout.middle ? layout.chain.top >= layout.first.bottom && layout.chain.bottom <= layout.edited.top : layout.chain.top >= layout.edited.bottom)
    assert(layout.pills.every(top => top === layout.pills[0]), 'the default three crumbs fit one row')
  }
  for (const width of [320, 512]) {
    await page.getByLabel(`${width} px`, { exact: true }).check()
    await page.waitForFunction(width => [...document.querySelectorAll('iframe')].every(f => f.contentDocument.querySelector('.demo').offsetWidth === width), width)
  }
  for (const width of [320, 375, 414, 768, 1920]) {
    await page.setViewportSize({ width, height: 1000 })
    const failures = await page.evaluate(() => {
      const failures = []
      if (document.documentElement.scrollWidth > innerWidth) failures.push('page overflow')
      for (const frame of document.querySelectorAll('iframe')) {
        const doc = frame.contentDocument, chain = doc.querySelector('.chain').getBoundingClientRect()
        const pills = [...doc.querySelectorAll('.chain .pill')].map(p => p.getBoundingClientRect())
        const add = doc.querySelector('.add').getBoundingClientRect(), last = pills.at(-1)
        if (doc.documentElement.scrollWidth > frame.clientWidth || pills.some(p => p.left < chain.left || p.right > chain.right + 1)) failures.push(frame.title + ': overflow')
        if (Math.abs(add.top + add.height / 2 - last.top - last.height / 2) > 1 || last.right > add.left) failures.push(frame.title + ': plus placement')
      }
      return failures
    })
    assert.deepEqual(failures, [], `${width}px`)
  }
})

test('workshop: pointed pills keep opaque token outlines, connected menus and live parameter editing', async () => {
  await workshop()
  for (const shape of ['soft', 'chevron']) {
    const frame = page.frameLocator(`#${shape}-middle iframe`), fade = frame.locator('.pill[data-key="2"]')
    const paint = () => fade.evaluate(pill => {
      const path = getComputedStyle(pill.querySelector('path')), source = getComputedStyle(document.querySelector('.track-file'))
      return { fill: path.fill, stroke: path.stroke, rule: source.borderColor, background: source.backgroundColor }
    })
    await page.mouse.move(0, 0)
    const rest = await paint()
    assert.equal(rest.fill, rest.background)
    assert.equal(rest.stroke, rest.rule)
    await fade.hover()
    assert.equal((await paint()).stroke, rest.stroke)
    await frame.getByRole('button', { name: 'Loop playback' }).click()
    await frame.getByRole('button', { name: 'Play edited audio' }).click()
    await fade.click()
    const control = frame.getByRole('slider', { name: 'Fade out (s)', exact: true })
    await control.dispatchEvent('pointerdown')
    await control.evaluate(el => { el.value = '1.25'; el.dispatchEvent(new Event('input', { bubbles: true })) })
    await control.dispatchEvent('pointerup')
    await frame.locator('.demo[aria-busy="false"]').waitFor()
    assert.equal(await fade.getAttribute('title'), '.fade(0.02, 1.25)')
    assert(await frame.getByRole('button', { name: 'Pause edited audio' }).isEnabled())
    await page.waitForFunction(id => {
      const doc = document.querySelector(`#${id} iframe`).contentDocument, pill = doc.querySelector('.pill[data-key="2"]')
      const p = pill.getBoundingClientRect(), tab = doc.querySelector('.pill-tab').getBoundingClientRect(), panel = doc.querySelector('.pill-body').getBoundingClientRect()
      return pill.querySelector('svg').viewBox.baseVal.width === pill.offsetWidth && Math.abs(tab.left - p.left) < 1 && Math.abs(tab.top - p.top) < 1 && Math.abs(panel.top - p.bottom + 1) < 1
    }, `${shape}-middle`)
    await page.keyboard.press('Escape')
    await frame.getByRole('button', { name: 'Pause edited audio' }).click()
    await frame.locator('.pill[data-key="1"]').focus(); await page.keyboard.press('Tab')
    assert.notEqual(await fade.evaluate(el => getComputedStyle(el).outlineStyle), 'none')
  }
  assert.equal(await page.frameLocator('#round-bottom iframe').locator('.pill[data-key="2"]').getAttribute('title'), '.fade(0.02, 0.1)', 'edits stay in their own preview')
})

test('workshop: menus fit, and the middle pipeline supports reordering, trash, Undo and an empty chain', async () => {
  await workshop()
  for (const id of ['soft-bottom', 'chevron-middle']) {
    const element = page.locator(`#${id} iframe`), frame = element.contentFrame()
    const initialHeight = await element.evaluate(el => el.offsetHeight)
    for (const keys of [[0, 2], ['source'], ['save'], ['add']]) {
      for (const key of keys) {
        const trigger = key === 'add' ? frame.getByRole('button', { name: 'Add a method', exact: true }) : frame.locator(`.pill[data-key="${key}"]`)
        await trigger.click()
        await page.waitForFunction(id => {
          const doc = document.querySelector(`#${id} iframe`).contentDocument, menu = doc.querySelector('[popover]:popover-open')
          if (!menu) return false
          const panel = menu.querySelector('.pill-body, .add-body'), rect = panel.getBoundingClientRect()
          return rect.bottom <= doc.defaultView.innerHeight - 16 && panel.scrollHeight <= panel.clientHeight + 1
        }, id)
      }
      await page.keyboard.press('Escape')
      await page.waitForFunction(({ id, height }) => document.querySelector(`#${id} iframe`).offsetHeight === height, { id, height: initialHeight })
    }
    await frame.locator('.pill[data-key="0"]').scrollIntoViewIfNeeded()
    const first = await frame.locator('.pill[data-key="0"]').boundingBox(), last = await frame.locator('.pill[data-key="2"]').boundingBox()
    await page.mouse.move(first.x + first.width / 2, first.y + first.height / 2); await page.mouse.down()
    await page.mouse.move(last.x + last.width / 2, last.y + last.height / 2, { steps: 12 }); await page.mouse.up()
    await frame.locator('.demo[aria-busy="false"]').waitFor()
    assert.deepEqual(await frame.locator('.chain .pill').evaluateAll(pills => pills.map(p => p.title)), ['.normalize(-1)', '.fade(0.02, 0.1)', '.trim()'])
    await frame.getByRole('button', { name: 'Undo', exact: true }).click()
    await frame.locator('.demo[aria-busy="false"]').waitFor()
    await settled(frame.locator('.chain'))
    await frame.locator('.pill[data-key="0"]').scrollIntoViewIfNeeded()
    const start = await frame.locator('.pill[data-key="0"]').boundingBox()
    await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2)
    await page.mouse.down(); await page.mouse.move(start.x + start.width / 2 + 8, start.y + start.height / 2)
    await frame.getByRole('button', { name: 'Remove effect', exact: true }).waitFor()
    const target = await frame.locator('.add').boundingBox()
    await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2, { steps: 8 })
    assert.equal(await frame.locator('.add.drop-target').count(), 1)
    await page.mouse.up(); await frame.locator('.demo[aria-busy="false"]').waitFor()
    assert.deepEqual(await frame.locator('.chain .pill').evaluateAll(pills => pills.map(p => p.title)), ['.normalize(-1)', '.fade(0.02, 0.1)'])
    await frame.getByRole('button', { name: 'Undo', exact: true }).click()
    await frame.locator('.demo[aria-busy="false"]').waitFor()
    assert.equal(await frame.locator('.chain .pill').count(), 3)
    for (let i = 0; i < 3; i++) {
      await frame.locator('.pill[data-key="0"]').focus(); await page.keyboard.press('Delete')
      await frame.locator('.demo[aria-busy="false"]').waitFor()
    }
    assert.equal(await frame.locator('.chain .pill').count(), 0)
    await frame.getByRole('button', { name: 'Add a method', exact: true }).click()
    await frame.getByRole('button', { name: 'Add gain', exact: true }).click()
    await frame.locator('.demo[aria-busy="false"]').waitFor()
    assert.equal(await frame.locator('.chain .pill').getAttribute('title'), '.gain(-6)')
    if (await frame.locator('html[data-outlined]').count()) await frame.locator('.chain .crumb-outline').waitFor()
  }
})

test('workshop: the continuous strip has one divider per join and rounded ends after wrapping and deletion', async () => {
  await workshop()
  const frame = page.frameLocator('#strip-bottom iframe')
  const joins = () => page.waitForFunction(() => {
    const doc = document.querySelector('#strip-bottom iframe').contentDocument
    const pills = [...doc.querySelectorAll('.chain .pill')]
    if (!pills.length) return false
    return pills.every((pill, i) => {
      const svg = pill.querySelector('.crumb-outline')
      if (!svg) return false
      const width = pill.getBoundingClientRect().width, fill = svg.firstElementChild, edge = svg.lastElementChild
      const first = !i || pills[i - 1].offsetTop !== pill.offsetTop, last = i === pills.length - 1 || pills[i + 1].offsetTop !== pill.offsetTop
      // A left end is solid; every other left edge has the sole chevron stroke.
      return Math.abs(svg.viewBox.baseVal.width - width) < .01 &&
        fill.isPointInFill({ x: 1, y: 15 }) === first &&
        edge.isPointInStroke({ x: 6, y: 15 }) === !first &&
        edge.isPointInStroke({ x: width - .5, y: 15 }) === last &&
        !edge.isPointInStroke({ x: width + 6, y: 15 }) &&
        (first || Math.abs(pill.getBoundingClientRect().left - pills[i - 1].getBoundingClientRect().right) < .01)
    })
  })
  for (const [width, rows] of [[512, 1], [320, 2], [512, 1]]) {
    await page.getByLabel(`${width} px`, { exact: true }).check()
    await page.waitForFunction(width => document.querySelector('#strip-bottom iframe').contentDocument.querySelector('.demo').offsetWidth === width, width)
    await joins()
    assert.equal(await frame.locator('.chain .pill').evaluateAll(pills => new Set(pills.map(p => p.offsetTop)).size), rows)
  }
  await frame.locator('.pill[data-key="0"]').focus(); await page.keyboard.press('Delete')
  await frame.locator('.demo[aria-busy="false"]').waitFor(); await joins()
  assert.equal(await frame.locator('.chain .pill').count(), 2)
  await frame.getByRole('button', { name: 'Undo', exact: true }).click()
  await frame.locator('.demo[aria-busy="false"]').waitFor(); await settled(frame.locator('.chain')); await joins()
  assert.equal(await frame.locator('.chain .pill').count(), 3)
})

test('workshop: wrapped connectors follow the chain and point along its direction through resize, reorder and removal', async () => {
  await workshop()
  const ids = ['linked-bottom', 'triangle-end-bottom', 'triangle-bottom', 'triangle-outline-bottom', 'line-chevron-bottom', 'line-arrow-bottom']
  const end = page.frameLocator('#triangle-end-bottom iframe')
  assert(await end.locator('.chain .joint:visible').evaluateAll(joints => joints.length === 2 && joints.every(svg => {
    const path = svg.firstElementChild, width = svg.viewBox.baseVal.width
    return path.isPointInFill({ x: width - 4.5, y: 7 }) && !path.isPointInFill({ x: width / 2, y: 5 }) && !path.isPointInFill({ x: width - 1, y: 7 })
  })), 'straight connectors put the filled triangle at the destination, pointing right')
  const joined = id => page.waitForFunction(id => {
    const doc = document.querySelector(`#${id} iframe`).contentDocument, svg = doc.querySelector('.chain-routes')
    const links = [...doc.querySelectorAll('.chain .link')].sort((a, b) => a.offsetTop - b.offsetTop || a.offsetLeft - b.offsetLeft)
    const expected = links.flatMap((link, i) => links[i + 1]?.offsetTop > link.offsetTop ? [[link, links[i + 1]]] : [])
    if (svg.children.length !== expected.length || getComputedStyle(svg).pointerEvents !== 'none') return false
    const box = doc.querySelector('.demo').getBoundingClientRect(), pills = links.map(link => link.querySelector('.pill').getBoundingClientRect())
    return expected.every(([from, to], i) => {
      const group = svg.children[i], path = group.firstElementChild, a = from.querySelector('.pill'), b = to.querySelector('.pill')
      if (group.dataset.from !== a.dataset.key || group.dataset.to !== b.dataset.key || getComputedStyle(from.querySelector('.joint')).visibility !== 'hidden') return false
      const start = a.getBoundingClientRect(), end = b.getBoundingClientRect(), length = path.getTotalLength()
      const point = distance => path.getPointAtLength(distance).matrixTransform(path.getScreenCTM())
      const p = point(0), q = point(length)
      if (Math.abs(p.x - start.right) > .1 || Math.abs(p.y - (start.top + start.bottom) / 2) > .1 || Math.abs(q.x - end.left) > .1 || Math.abs(q.y - (end.top + end.bottom) / 2) > .1) return false
      const shape = doc.documentElement.dataset.shape
      if (shape !== 'linked') {
        const head = group.lastElementChild, bounds = head.getBBox(), rect = head.getBoundingClientRect()
        const centered = ['triangle', 'triangle-outline', 'line-chevron'].includes(shape)
        const centerY = bounds.y + bounds.height / 2
        if (centered) {
          if (Math.abs(rect.x + rect.width / 2 - (start.right + end.left) / 2) > .1 || Math.abs(rect.y + rect.height / 2 - (start.bottom + end.top) / 2) > .1) return false
        } else if (Math.abs(rect.right - end.left + .5) > .1 || Math.abs(rect.y + rect.height / 2 - q.y) > .1) return false
        if (shape.startsWith('triangle')) {
          // A leftward triangle is broad on the right, narrow on the left; end triangles are the opposite.
          if (head.isPointInFill({ x: bounds.x + 1, y: centerY + 2 }) === centered || head.isPointInFill({ x: bounds.x + bounds.width - 1, y: centerY + 2 }) !== centered) return false
        } else {
          if (!head.isPointInStroke({ x: centered ? bounds.x : bounds.x + bounds.width, y: centerY }) || head.isPointInStroke({ x: centered ? bounds.x + bounds.width : bounds.x, y: centerY })) return false
        }
      }
      for (let n = 1; n < 128; n++) {
        const p = point(length * n / 128)
        if (p.x < box.left || p.x > box.right || pills.some(b => p.x > b.left + .5 && p.x < b.right - .5 && p.y > b.top + .5 && p.y < b.bottom - .5)) return false
      }
      return true
    })
  }, id)
  for (const [width, count] of [[512, 0], [320, 1], [512, 0], [320, 1]]) {
    await page.getByLabel(`${width} px`, { exact: true }).check()
    await page.waitForFunction(width => document.querySelector('#linked-bottom iframe').contentDocument.querySelector('.demo').offsetWidth === width, width)
    for (const id of ids) {
      await joined(id)
      assert.equal(await page.frameLocator(`#${id} iframe`).locator('.chain-routes g').count(), count, id)
    }
  }
  const frame = page.frameLocator('#triangle-bottom iframe')
  await page.setViewportSize({ width: 320, height: 1000 })
  await joined('triangle-bottom')
  assert.equal(await frame.locator('.chain-routes g').count(), 2, 'three rows have two return paths')
  await frame.locator('.pill[data-key="0"]').scrollIntoViewIfNeeded()
  const first = await frame.locator('.pill[data-key="0"]').boundingBox(), last = await frame.locator('.pill[data-key="2"]').boundingBox()
  await page.mouse.move(first.x + first.width / 2, first.y + first.height / 2); await page.mouse.down()
  await page.mouse.move(last.x + last.width / 2, last.y + last.height / 2, { steps: 12 })
  await settled(frame.locator('.chain')); await joined('triangle-bottom')
  await page.keyboard.press('Escape'); await page.mouse.up()
  await settled(frame.locator('.chain')); await joined('triangle-bottom')
  assert.equal((await frame.locator('.chain .pill').evaluateAll(pills => pills.map(p => p.title))).join('\n'), defaultChain)
  await frame.locator('.pill[data-key="0"]').focus(); await page.keyboard.press('Alt+ArrowRight')
  await frame.locator('.demo[aria-busy="false"]').waitFor(); await settled(frame.locator('.chain')); await joined('triangle-bottom')
  assert.deepEqual(await frame.locator('.chain .pill').evaluateAll(pills => pills.map(p => p.title)), ['.normalize(-1)', '.trim()', '.fade(0.02, 0.1)'])
  await frame.getByRole('button', { name: 'Undo', exact: true }).click()
  await frame.locator('.demo[aria-busy="false"]').waitFor(); await settled(frame.locator('.chain')); await joined('triangle-bottom')
  for (let count = 2; count >= 0; count--) {
    await frame.locator('.pill[data-key="0"]').focus(); await page.keyboard.press('Delete')
    await frame.locator('.demo[aria-busy="false"]').waitFor(); await joined('triangle-bottom')
    assert.equal(await frame.locator('.chain-routes g').count(), Math.max(0, count - 1))
  }
  await frame.getByRole('button', { name: 'Add a method', exact: true }).click()
  await frame.getByRole('button', { name: 'Add gain', exact: true }).click()
  await frame.locator('.demo[aria-busy="false"]').waitFor(); await joined('triangle-bottom')
  assert.equal(await frame.locator('.chain .pill').getAttribute('title'), '.gain(-6)')
  assert.equal(await frame.locator('.chain-routes g').count(), 0)
})

// A canvas as gray levels, one byte a pixel: the logo's tones are neutral, so red carries the whole image
async function logoShot(canvas = page.locator('canvas')) {
  const png = (await canvas.screenshot()).toString('base64')
  const { w, h, gray } = await page.evaluate(async png => {
    const image = new Image()
    image.src = 'data:image/png;base64,' + png
    await image.decode()
    const context = new OffscreenCanvas(image.width, image.height).getContext('2d')
    context.drawImage(image, 0, 0)
    const rgba = context.getImageData(0, 0, image.width, image.height).data
    let gray = ''
    for (let i = 0; i < rgba.length; i += 4) gray += String.fromCharCode(rgba[i])
    return { w: image.width, h: image.height, gray }
  }, png)
  return { w, h, gray, at: (x, y) => gray.charCodeAt(y * w + x), lit: gray.split('').some(pixel => pixel.charCodeAt(0) > 200) }
}
async function logoStill() {
  let last = await logoShot()
  for (let i = 0; i < 40; i++) {
    await page.waitForTimeout(100)
    const next = await logoShot()
    if (next.gray === last.gray) return next
    last = next
  }
  assert.fail('the logo never came to rest')
}
// How far a drawing is from landing on itself after half a turn about its centre, in gray levels a pixel: the logo is odd
function asymmetry({ w, h, at }) {
  let off = 0
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) off += Math.abs(at(x, y) - at(w - 1 - x, h - 1 - y))
  return off / (w * h)
}

test('logo: a signal through a window, filled by half a window as its gradient, turned by hand or moving, printed in two tones', async () => {
  // Reduced motion opens it at rest
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.setViewportSize({ width: 800, height: 760 })
  await page.goto(origin + '/logo.html', { waitUntil: 'networkidle' })
  assert.equal(await page.locator('#fail').isVisible(), false)
  // The control band is lit from above: its light a radial mask, which a browser drops whole if it can't parse it
  assert.match(await page.locator('.bar').evaluate(bar => getComputedStyle(bar, '::before').maskImage), /^radial-gradient/)
  // No hover, so a pointer over the drawing changes nothing
  const pick = (name, value) => page.selectOption(`select[name="${name}"]`, value)
  await pick('hover', 'none')
  const offered = name => page.locator(`select[name="${name}"] option`).evaluateAll(options => options.map(option => option.value))
  // The waveform and the gradient offer the same windows, the whole collection, rectangular first
  const windows = await offered('window')
  assert.deepEqual(await offered('gradient'), windows)
  assert(windows.length === 34 && windows[0] === 'rectangular' && ['bartlett', 'hann', 'dolphChebyshev'].every(name => windows.includes(name)), windows.join())
  // Every print style is drawn in its picker by the shader, and the tab's icon is the waveform
  const prints = await offered('print')
  assert.equal(await page.locator('select[name="print"] option .mask[style*="data:image/png"]').count(), prints.length)
  assert.match(await page.locator('link[rel=icon]').getAttribute('href'), /^data:image\/png/)

  await pick('print', 'smooth')
  const rest = await logoStill(), { w, h } = rest, axis = h >> 1, ground = rest.at(0, 0)
  // The lit pixels up a column from the axis
  const column = (shot, x) => {
    const lit = []
    for (let y = axis - 1; y >= 0 && shot.at(x, y) > ground + 8; y--) lit.push(shot.at(x, y))
    return lit
  }
  // At rest a sine cycle through Hann is the logo, odd: half a turn about the centre lands it on itself
  assert(asymmetry(rest) < 1, `the rest pose differs from its half turn by ${asymmetry(rest)} a pixel`)
  // Half of Bartlett is a straight fall: up the tallest column paper fades to ink, never brightening
  let peak = 0
  for (let x = 0; x < w / 2; x++) if (column(rest, x).length > column(rest, peak).length) peak = x
  const fall = column(rest, peak)
  assert(fall.length > h / 4 && fall[0] > 200 && fall.at(-1) < ground + 40, JSON.stringify([fall.length, fall[0], fall.at(-1)]))
  assert(fall.every((v, n) => !n || v <= fall[n - 1] + 1), 'the tone never brightens toward the edge')
  // Rectangular has no fall, so as a gradient it fills flat
  await pick('gradient', 'rectangular')
  const flat = column(await logoStill(), peak)
  assert(flat[0] > 200 && flat.slice(0, -2).every(v => Math.abs(v - flat[0]) <= 1), JSON.stringify(flat))
  await pick('gradient', 'bartlett')
  await logoStill()

  // A drag turns the phase by hand; brought back, it lands on the rest pose again
  const box = await page.locator('canvas').boundingBox(), y = box.y + box.height / 2
  await page.mouse.move(box.x + box.width / 2, y)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width / 2 + 60, y, { steps: 6 })
  assert(asymmetry(await logoStill()) > 5, 'a drag turns the signal under its window')
  await page.mouse.move(box.x + box.width / 2 + 1, y, { steps: 6 })
  await page.mouse.up()
  assert(asymmetry(await logoStill()) < 1, 'back near where it started, the drag lands on the rest pose')
  // At speed it moves on its own
  await page.locator('#speed').fill('0.5')
  const moving = await logoShot()
  await page.waitForTimeout(150)
  assert.notEqual((await logoShot()).gray, moving.gray, 'the signal moves at speed')
  await page.locator('#speed').fill('0')

  for (const mode of ['bayer2', 'bayer4', 'bayer8', 'blue', 'white', 'floyd', 'atkinson']) {
    await pick('print', mode)
    await logoStill()
    assert.equal(new Set((await logoShot()).gray).size, 2, `${mode} dithers to ink and paper only`)
  }
  // Engravings print paper inside the shape and leave the ground bare
  for (const mode of ['halftone', 'lines', 'spikes', 'bars', 'contours', 'traces', 'mesh', 'guilloche', 'stipple']) {
    await pick('print', mode)
    const { lit, at } = await logoStill()
    assert(lit && at(0, 0) === ground && at(w - 1, h - 1) === ground, mode)
  }
  // Gap is the space between lines: closer, more of them print. Traces are the mesh without its columns.
  const paper = ({ gray }) => gray.split('').filter(pixel => pixel.charCodeAt(0) > 128).length
  await pick('print', 'traces')
  await page.locator('#gap').fill('2')
  const close = paper(await logoStill())
  await page.locator('#gap').fill('16')
  const apart = paper(await logoStill())
  await pick('print', 'mesh')
  const mesh = paper(await logoStill())
  assert(close > apart && mesh > apart, JSON.stringify({ close, apart, mesh }))
  // Bars stand a size wide and a gap apart: along the row above the axis, lit runs and dark gaps alternate at those widths
  await pick('print', 'bars')
  await page.locator('#size').fill('4')
  await page.locator('#gap').fill('4')
  const bars = await logoStill(), runs = { true: [], false: [] }
  for (let x = 1, run = 1; x < w; x++, run++) {
    const lit = bars.at(x, axis - 2) > ground + 40
    if (lit !== bars.at(x - 1, axis - 2) > ground + 40) runs[!lit].push(run), run = 0
  }
  const [widths, gaps] = [runs.true, runs.false.slice(1, -1)]
  assert(widths.length > 8 && [...widths, ...gaps].every(run => run >= 3 && run <= 5), JSON.stringify({ widths, gaps }))
  await page.locator('#size').fill('2')
  await pick('print', 'bayer4')
  assert(await page.locator('#gap').isDisabled(), 'dithers have no gap')

  // Haar, a square cycle through a rectangular window, is the gradient rectangle itself: every column alike
  await pick('print', 'smooth')
  await pick('signal', 'square')
  await pick('window', 'rectangular')
  const haar = await logoStill()
  const inside = [...Array(w >> 1).keys()].filter(x => haar.at(x, axis - 2) > ground + 8)
  const l = inside[0], r = inside.at(-1), a = Math.round(l + (r - l) / 4), b = Math.round(l + (r - l) * 3 / 4)
  for (let y = 0; y < axis; y++) assert(Math.abs(haar.at(a, y) - haar.at(b, y)) <= 1, `row ${y}: ${haar.at(a, y)} ≠ ${haar.at(b, y)}`)
})

test('logo motion: at rest it is the logo; near its middle it stirs; flung it spins on and settles; a tap or Space gives the next signal; a lift can stretch it', async () => {
  // Reduced motion gives it no speed of its own
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.setViewportSize({ width: 800, height: 760 })
  await page.goto(origin + '/logo.html', { waitUntil: 'networkidle' })
  await page.selectOption('#print', 'smooth')
  const canvas = page.locator('canvas'), box = await canvas.boundingBox(), x = box.x + box.width / 2, y = box.y + box.height / 2
  const away = () => page.mouse.move(x, box.y + box.height + 30)
  const apart = (a, b) => { let sum = 0; for (let i = 0; i < a.gray.length; i++) sum += Math.abs(a.gray.charCodeAt(i) - b.gray.charCodeAt(i)); return sum / a.gray.length }
  const top = shot => { for (let row = 0; row < shot.h; row++) for (let col = 0; col < shot.w; col++) if (shot.at(col, row) > 60) return row }

  const rest = await logoStill()
  assert(asymmetry(rest) < 1, 'at rest it is the logo')
  assert.equal(await page.locator('#sound').inputValue(), 'none', 'silent until asked')
  // Hover counts near its middle only: at the stage's edge it rests; over its centre it stirs
  await page.mouse.move(box.x + 30, y)
  assert(apart(rest, await logoStill()) < .05, 'at the edge of the stage it rests')
  await page.mouse.move(x, y)
  await page.waitForTimeout(600)
  assert(apart(rest, await logoShot()) > .5, 'near its middle, it stirs')
  // Flung mid-drag, it spins on; left alone, it settles into the logo again
  await page.mouse.down()
  await page.mouse.move(x + 90, y, { steps: 3 })
  await page.mouse.up()
  const early = await logoShot()
  await page.waitForTimeout(150)
  assert(apart(early, await logoShot()) > .5, 'flung, it spins on')
  await away()
  assert(asymmetry(await logoStill()) < 1, 'it settles into the logo')

  // A tap, a press that never moves, gives the next signal, and the picker follows; so does Space
  const sine = await logoStill()
  await canvas.click()
  await away()
  const triangle = await logoStill()
  assert(apart(sine, triangle) > .5 && await page.locator('#signal').inputValue() === 'triangle', 'a tap changes the signal')
  await canvas.focus()
  await page.keyboard.press('Space')
  await canvas.blur()
  assert(apart(triangle, await logoStill()) > .5 && await page.locator('#signal').inputValue() === 'square', 'Space changes it too')

  // Lifting does nothing by default; set to amplitude, a drag upward pulls it taller at once
  const lifted = async () => {
    await page.mouse.move(x, y)
    await page.mouse.down()
    await page.mouse.move(x, y - 80, { steps: 8 })
    await page.waitForTimeout(300)
    const shot = await logoShot()
    await page.mouse.up()
    await away()
    return shot
  }
  const still = await logoStill(), plain = await lifted()
  await logoStill()
  await page.selectOption('#lift', 'amplitude')
  const tall = await lifted()
  assert(top(tall) < top(plain) - 10 && Math.abs(top(plain) - top(still)) < 30, JSON.stringify({ still: top(still), plain: top(plain), tall: top(tall) }))

  // A tick for each peak through the middle, crest and trough: two a turn, none at the rest turn itself
  assert.deepEqual(await page.evaluate(async () => { const { peak } = await import('/logo-motion.js'); return [-.26, 0, .24, .26, .74, .76, 1, 1.26].map(peak) }), [-2, -1, -1, 0, 0, 1, 1, 2])
  // Both sounds play under the hand
  for (const sound of ['tone', 'ticks']) {
    await page.selectOption('#sound', sound)
    await page.mouse.move(x, y)
    await page.mouse.down()
    await page.mouse.move(x + 60, y, { steps: 4 })
    await page.mouse.up()
    await away()
  }
  await logoStill()
})

test('site: the header mark is the logo drawn live; the whole title tightens it, a drag turns it without following the link, the tab icon turns with it', async () => {
  const title = page.locator('.header .wordmark'), canvas = title.locator('canvas'), url = page.url()
  assert(await canvas.isVisible() && await title.locator('svg').count() === 0, 'the live mark stands in for the static one')
  assert.match(await page.locator('link[rel~=icon]').getAttribute('href'), /^data:image\/png/)
  const apart = (a, b) => { let sum = 0; for (let i = 0; i < a.gray.length; i++) sum += Math.abs(a.gray.charCodeAt(i) - b.gray.charCodeAt(i)); return sum / a.gray.length }
  const rest = await logoShot(canvas)
  assert(rest.gray.split('').some(pixel => pixel.charCodeAt(0) < 80), 'inked on the paper')
  // Small, it prints flat, and so does the tab's icon: ink or paper, gray only along an edge, where a gradient is gray throughout
  const tones = values => ({ ink: values.filter(v => v < 60).length, mid: values.filter(v => v >= 60 && v <= 180).length })
  const mark = tones(rest.gray.split('').map(pixel => pixel.charCodeAt(0)))
  const icon = tones(await page.evaluate(async () => {
    const image = new Image()
    image.src = document.querySelector('link[rel~=icon]').href
    await image.decode()
    const context = new OffscreenCanvas(image.width, image.height).getContext('2d')
    context.drawImage(image, 0, 0)
    return [...context.getImageData(0, 0, image.width, image.height).data].filter((_, i) => i % 4 === 3).filter(a => a).map(a => 255 - a)
  }))
  assert(mark.mid < mark.ink && icon.mid < icon.ink, JSON.stringify({ mark, icon }))
  // Hovered on the word, not the mark, it tightens: more cycles than a drift could make in the time
  const box = await title.boundingBox(), y = box.y + box.height / 2
  await page.mouse.move(box.x + box.width - 20, y)
  await page.waitForTimeout(900)
  const tight = await logoShot(canvas)
  assert(apart(rest, tight) > 8, `hovering the title tightens the mark, ${apart(rest, tight)}`)
  // A drag across the title turns it, whole, not dimmed as a pressed link, and is no click on the link
  await page.mouse.down()
  assert.equal(await title.evaluate(title => getComputedStyle(title).opacity), '1')
  await page.mouse.move(box.x + box.width - 90, y, { steps: 6 })
  await page.mouse.up()
  assert.equal(page.url(), url)
  // A plain click after it is still the link's
  await title.click()
  assert.equal(page.url(), url.replace(/#.*$/, '') + '#')
})
