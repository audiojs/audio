// The playground's tests (npm run test:playground: test/playground/*.test.js, a feature each) share this page: the
// server, the browser, a fresh page each test, and the helpers. The engine runs in a real browser worker; its output is
// compared with the library in Node, the command-line translation with the CLI itself. All requests stay local.
import { before, after, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { extname, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import wav from '@audio/encode-wav'
import { workers } from '../../.site-build.js'

// the playground's workers made from the source as it is (playground/dist, which git ignores); assets/ is committed
await workers()
const root = fileURLToPath(new URL('../..', import.meta.url)).replace(/\/$/, '')
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.wasm': 'application/wasm' }
let server, browser, page, origin, errors
// files a test made, served at /slow/<name> as the repository's are
const made = new Map()
// The page as a visitor left it on the chime's script, which a first visit opened on until it opened on an empty tab:
// what most tests start from. Stored only where nothing is, so a test's own storage, and the page's as it goes, stand
const CHIME = `audio('chime.wav')\n  .trim()\n  .normalize(-1)\n  .fade(0.02, 0.1)`
const chimeLeft = target => target.addInitScript(code => {
  if (location.pathname === '/playground/' && !new URLSearchParams(location.search).has('embed') && localStorage.getItem('audio-repl') == null) localStorage.setItem('audio-repl', JSON.stringify({ code }))
}, CHIME)

before(async () => {
  server = createServer(async (req, res) => {
    const url = req.url.split('?')[0]
    if (url === '/blank.html') { res.writeHead(200, { 'content-type': 'text/html' }).end('<!doctype html><title>blank</title>'); return }
    // a file over a slow connection: 8 KB every 120 ms (?ms=), its length said up front; the repository's, or one a test made
    if (url.startsWith('/slow/')) {
      const data = made.get(url.slice(6)) ?? await readFile(resolve(root, '.' + url.slice(5))), ms = +(req.url.match(/[?&]ms=(\d+)/)?.[1] ?? 120)
      res.writeHead(200, { 'content-type': 'audio/wav', 'content-length': data.length })
      for (let i = 0; i < data.length; i += 8192) { res.write(data.subarray(i, i + 8192)); await new Promise(r => setTimeout(r, ms)) }
      res.end()
      return
    }
    const path = resolve(root, '.' + (url === '/' ? '/playground/' : url) + (url.endsWith('/') ? 'index.html' : ''))
    if (!path.startsWith(root + sep)) { res.writeHead(403).end(); return }
    // cross-origin isolated, as .site-serve.js serves it (sw.js stays out: a page reloaded under a test would lose it)
    // read before the head is sent: a file not there is a 404, not a head sent twice and a reply that never ends
    try { const body = await readFile(path); res.writeHead(200, { 'content-type': types[extname(path)] || 'application/octet-stream', 'cross-origin-opener-policy': 'same-origin', 'cross-origin-embedder-policy': 'credentialless' }).end(body) }
    catch { res.writeHead(404).end() }
  })
  await new Promise(r => server.listen(0, '127.0.0.1', r))
  origin = `http://127.0.0.1:${server.address().port}`
  // a fake microphone plays a tone, granted without asking
  browser = await chromium.launch({ args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] })
})
after(async () => { await browser?.close(); if (server) await new Promise(r => server.close(r)) })
beforeEach(async () => {
  page = await browser.newPage()
  await chimeLeft(page)
  // the page opens with its panel closed, the picture whole: the code is written through its panel (write), and a test of
  // a panel opens it
  await page.addInitScript(() => {
    // the script, its lines as the editor has them, the code panel open or not
    globalThis.scriptText = () => [...document.querySelectorAll('.cm-content .cm-line')].map(l => l.textContent).join('\n')
    // what is drawn over the sound as it shows: the reel's time row and marks (view.js marksOf: the time row's times, the
    // carets, the cues, the markers…) where the reel is, cut where the lanes end, under the overlay; a canvas the
    // overlay's size, its box the overlay's
    globalThis.__overlay = () => {
      const plot = document.querySelector('.plot'), o = plot.querySelector('canvas.overlay'), m = plot.querySelector('canvas.marks'), row = plot.querySelector('canvas.row'), k = o.width / o.clientWidth
      const shift = -new DOMMatrix(getComputedStyle(plot.querySelector('.reel')).transform).m41 * k, end = Math.round(parseFloat(getComputedStyle(plot).getPropertyValue('--end')) * k)
      const cv = Object.assign(document.createElement('canvas'), { width: o.width, height: o.height }), g = cv.getContext('2d')
      if (row?.width && row.height && o.width > end) g.drawImage(row, Math.round(shift), 0, o.width - end, row.height, 0, Math.round(row.offsetTop * k), o.width - end, row.height)
      if (m?.width && o.width > end) g.drawImage(m, Math.round(shift), 0, o.width - end, o.height, 0, 0, o.width - end, o.height)
      g.drawImage(o, 0, 0)
      Object.defineProperties(cv, { clientWidth: { value: o.clientWidth }, clientHeight: { value: o.clientHeight }, getBoundingClientRect: { value: () => o.getBoundingClientRect() } })
      return cv
    }
  })
  errors = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); if (/^(SCRUB|NEAR|POST|AWAIT)/.test(msg.text())) console.log(msg.text()) })
  await page.route('**/*', route => {
    if (route.request().url().startsWith(origin + '/')) return route.continue()
    errors.push(`External request: ${route.request().url()}`)
    return route.abort()
  })
})
afterEach(async () => { await page?.close(); assert.deepEqual(errors, []) })

const RATE = 48000
const sine = (seconds, frequency, amplitude = 1, rate = RATE) => Float32Array.from({ length: Math.round(seconds * rate) }, (_, i) => amplitude * Math.sin(2 * Math.PI * frequency * i / rate))
const peakDb = channels => 20 * Math.log10(Math.max(...channels.map(c => c.reduce((m, v) => Math.max(m, Math.abs(v)), 0))))
async function wavBytes(channels, sampleRate = RATE) {
  const encoder = await wav({ sampleRate, bitDepth: 32 })
  const head = encoder.encode(channels), tail = encoder.flush()
  return Buffer.concat([Buffer.from(head), Buffer.from(tail)])
}

// Runs scripts through the editor's own engine in the browser. `files` are { name: channels } or { name: bytes }.
async function engine(scripts, files = {}) {
  await page.goto(origin + '/blank.html')
  return page.evaluate(async ({ scripts, files }) => {
    const { default: engine } = await import('/playground/engine.js'), { prepare } = await import('/playground/code.js')
    const e = engine(new URL('/playground/dist/worker.js', location.href))
    for (const [name, data] of Object.entries(files))
      await e.file(name, data.bytes ? new Blob([new Uint8Array(data.bytes)]) : { channels: data.map(c => Float32Array.from(c)), sampleRate: 48000 })
    const out = []
    for (const code of scripts) {
      const r = await e.render(prepare(code))
      out.push({ ...r, output: r.output && { ...r.output, channels: r.output.channels.map(c => [...c]) } })
    }
    return out
  }, { scripts, files: Object.fromEntries(Object.entries(files).map(([k, v]) => [k, Buffer.isBuffer(v) ? { bytes: [...v] } : v.map(c => [...c])])) })
}

// Its processor (playground/scrub.js), run in Node with the worklet's globals stubbed, a 128-frame quantum at a time: the
// channels `x` at `rate`, the caret at caret(q) samples in quantum q, for `seconds`
// The scrub voice as the worklet runs it: its module imported with a worklet's globals, one class for every run
let Scrubber
async function scrubbed(x, caret, seconds, rate = 48000, mode) {
  globalThis.sampleRate = rate
  if (!Scrubber) {
    Object.assign(globalThis, { AudioWorkletProcessor: class { constructor() { this.port = { onmessage: null, postMessage() {} } } }, registerProcessor: (_, cls) => { Scrubber = cls }, currentTime: 0 })
    await import('../../playground/scrub.js')
  }
  const Proc = Scrubber
  const proc = new Proc(), send = data => proc.port.onmessage({ data }), Q = 128, n = Math.ceil(seconds * rate / Q)
  send({ x, rate, mode })
  send({ caret: caret(0), on: true })
  const out = x.map(() => new Float32Array(n * Q)), block = x.map(() => new Float32Array(Q))
  for (let q = 0; q < n; q++) { send({ caret: caret(q) }); proc.process([], [block]); out.forEach((o, c) => o.set(block[c], q * Q)) }
  return out
}
// noise 60 dB down, and a click at 0.5 s: 1 ms of noise, decaying; the same numbers every run (a 32-bit LCG)
function clicked(rate = 48000, loud = 1) {
  let seed = 1
  const noise = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 31 - 1, click = rate / 2
  return Float32Array.from({ length: rate }, (_, i) => noise() * (1e-3 + (i >= click && i < click + 48 ? loud * Math.exp(-(i - click) / 10) : 0)))
}
// attacks by their first difference, which a steady floor hardly has: where the loudest is, how sharp against the
// source's, and how far over the floor the 20 ms before it rise
function attack(y, x, rate = 48000) {
  const d = v => Float64Array.from(v, (s, i) => i ? s - v[i - 1] : 0), rms = (v, a, b) => Math.sqrt(v.slice(a, b).reduce((s, u) => s + u * u, 0) / (b - a))
  const dx = d(x), dy = d(y), click = rate / 2
  let p = 0
  for (let i = 1; i < dy.length; i++) if (Math.abs(dy[i]) > Math.abs(dy[p])) p = i
  return { at: p, dy, sharp: Math.abs(dy[p]) / Math.max(...dx.slice(click, click + 48).map(Math.abs)), before: 20 * Math.log10(rms(dy, p - .02 * rate, p - .002 * rate) / rms(dx, 0, click - 480)) }
}

// the script, its lines as the editor has them, the code panel open or not
const code = () => page.evaluate(() => [...document.querySelectorAll('.cm-content .cm-line')].map(l => l.textContent).join('\n').replace(/ /g, ' '))
const readout = () => page.locator('.readout').textContent()
// A title, or, pointed at, what the tooltip took of it (popoff keeps it as data-tip till the pointer leaves)
const tipOf = el => el.title || el.dataset.tip || ''
// The levels of all of it, nothing selected: the peak on the bar, every level in its table (#levels), pointed at
const wholeLevels = () => page.locator('.readout[data-of="all"]')
// that table, its head and a row a line, its cells apart: "Peak −1.0dBFS at 0:00.120"
const levelsTable = () => page.locator('#levels').evaluate(el => [el.querySelector('.levels-head')?.textContent, ...[...el.querySelectorAll('tr')].map(r => [...r.cells].map(c => c.textContent).filter(Boolean).join(' '))].filter(Boolean).join('\n'))
// The output's length, from the name's tooltip ("chime.wav · 0:06.525"): the axes show it, so the page doesn't repeat it
const lengthText = () => page.evaluate(() => (e => e.title || e.dataset.tip || '')(document.querySelector('.source')).split(' · ').pop())
const seconds = async () => { const [m, s] = (await lengthText()).split(':'); return +m * 60 + +s }
async function open() {
  await page.goto(origin + '/playground/')
  // the whole sound's levels read, shown or not (a narrow bar gives them way)
  await wholeLevels().waitFor({ state: 'attached' })
}
// The page settled (editor.js __settled): no run waiting to start, asked or on its way, then two frames drawn; within `ms`
async function settled(p = page, ms = 30000) {
  await p.waitForFunction(() => globalThis.__settled, null, { timeout: ms })
  await p.evaluate(ms => Promise.race([__settled(), new Promise((_, no) => setTimeout(() => no(new Error(`Not settled in ${ms} ms`)), ms))]), ms)
}
// Frames drawn, `n`: what the last input changed is on the screen (the view draws on the next animation frame)
const frames = (n = 2, p = page) => p.evaluate(async n => { for (let i = 0; i < n; i++) await new Promise(requestAnimationFrame) }, n)
// What `read` reads once `check` (its assertions) passes on it, read again a frame after each failing check, `ms` at
// most: the reading that passed, else the last failure thrown
async function poll(read, check, ms = 5000, p = page) {
  for (const end = Date.now() + ms; ; await frames(1, p)) {
    const got = await read()
    try { await check(got); return got } catch (e) { if (Date.now() > end) throw e }
  }
}
// The page still: no transition running (a panel opening, a fade), then two frames drawn
const still = (p = page) => p.waitForFunction(() => !document.getAnimations().some(a => a instanceof CSSTransition && a.playState === 'running')).then(() => frames(2, p))
// A row of the menu open, by its label, exactly
const menuRow = label => page.locator('.menubar-menu .menu-row', { has: page.locator('.menu-label', { hasText: new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`) }) }).last()
// The groups of how a picture draws, in the dropdown a band's look opens (playground/index.html .dropdown); the others are the
// settings', in their panel
const DRAWS = ['Levels in', 'Weighting', 'Colour', 'Colormap', 'Fill', 'Channels', 'Frequency scale', 'Method', 'Colours', 'Gamma', 'Range', 'FFT size', 'Meter']
// A choice among the options open (a picture's dropdown, the settings' panel), by its group's name and its own: its
// section unfolded first, where it is folded; a look's, in its select, the select opened first
function choice(group, name) {
  const open = page.locator('.dropdown:popover-open, .settings'), button = open.getByRole('group', { name: group, exact: true }).getByRole('button', { name, exact: true })
  const option = page.getByRole('listbox', { name: group, exact: true }).getByRole('option', { name, exact: true })
  const unfold = () => page.evaluate(g => { for (const d of document.querySelectorAll('.settings details:not([open])')) if (d.querySelector(`[aria-label="${g}"]`)) d.querySelector('summary').click() }, group)
  const listed = () => page.evaluate(g => !!document.querySelector(`.dropdown:popover-open [role="listbox"][aria-label="${g}"]`), group)
  const pick = async () => { if (await listed()) { await page.locator(`.dropdown:popover-open .select-button[popovertarget="select-${group}"]`).click(); return option } await unfold(); return button }
  return { click: async o => (await pick()).click(o), getAttribute: async a => (await pick()).getAttribute(a) }
}
// A choice made: how a picture draws in its dropdown, opened by the band's look in its layer (the last band's), and
// closed again by it; else in the settings' panel, the panel as it was again after
async function settings(group, name) {
  if (DRAWS.includes(group)) {
    const button = page.locator(':is(.lane-look, .layer-look):visible').last()
    await button.click()
    await choice(group, name).click()
    return button.click()
  }
  const was = await page.evaluate(() => document.querySelector('.side-head [aria-selected="true"]')?.getAttribute('aria-label') ?? null)
  await tab('Settings')
  await choice(group, name).click()
  if (was !== 'Settings') await page.getByRole('tab', { name: was ?? 'Settings', exact: true }).click()
}
// What is selected, as the clock's title says it ("0:01.000–0:03.000"; '' for none, or several ranges): the clock
// itself reads the caret
const selected = async () => (await page.locator('.clock').evaluate(tipOf)).match(/^Selected (\S+–\S+):/)?.[1] ?? ''
// The panel on one of its buttons (the edits, the code, the export, the settings, at the top right); a click on the one
// shown would close it
async function tab(name) {
  const t = page.getByRole('tab', { name, exact: true })
  if (await t.getAttribute('aria-selected') !== 'true') await t.click()
}
// whether the panel shows the edits
const edits = async () => await page.getByRole('tab', { name: 'Edits', exact: true }).getAttribute('aria-selected') === 'true'
// Runs an item of the app menu: the menu by its name, then each submenu and the item, by their words
async function menu(...path) {
  await page.locator('.menubar-item', { hasText: new RegExp(`^${path[0]}$`) }).click()
  for (const name of path.slice(1)) {
    const words = typeof name === 'string' ? new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`) : name
    await page.locator('.menubar-list .menu-row:visible').filter({ has: page.locator('.menu-label', { hasText: words }) }).last().click()
  }
}
const facts = async () => (await page.locator('.facts').innerText()).replace(/\s*\n\s*/g, ' ')
// Whether the palette (⌘K) offers an edit by that name, within a few seconds (what it offers follows the output), the
// keys back on the picture after
async function offered(name) {
  let items = []
  for (const until = Date.now() + 5000; !items.includes(name) && Date.now() < until; await page.waitForTimeout(100)) {
    await page.keyboard.press('ControlOrMeta+K')
    items = await page.locator('.palette-list .tool strong').allInnerTexts()
    await page.keyboard.press('Escape')
  }
  await page.locator('.plot').focus()
  return items.includes(name)
}
// Runs an edit from the palette (⌘K), the first whose name has `words`
async function palette(words) {
  await page.keyboard.press('ControlOrMeta+K')
  await page.locator('.palette-list .tool', { has: page.locator('strong', { hasText: words }) }).first().click()
}
// The cues hidden and snapping off: a dragged edge goes where it is let go, not onto a cue near it, shown or not (a test
// of snapping keeps them)
const noCues = async () => { await menu('View', 'Show', 'Cues'); await menu('View', 'Snap to cues and markers') }
// The script written in the code panel (over the picture, from the bar), the panel then as it was
async function write(text) {
  const shown = await page.getByRole('tab', { name: 'Code', exact: true }).getAttribute('aria-selected') === 'true'
  await tab('Code')
  await page.locator('.cm-content').click()
  await page.keyboard.press('ControlOrMeta+A')
  await page.keyboard.insertText(text)
  if (!shown) await page.getByRole('tab', { name: 'Code', exact: true }).click()
}
// Bright pixels in the plot, from a screenshot: the waveform is drawn.
async function drawn(of = '.plot') {
  const png = await page.locator(of).screenshot()
  return page.evaluate(async b64 => {
    const img = new Image()
    img.src = 'data:image/png;base64,' + b64
    await img.decode()
    const c = Object.assign(document.createElement('canvas'), { width: img.width, height: img.height }), g = c.getContext('2d')
    g.drawImage(img, 0, 0)
    const d = g.getImageData(0, 0, c.width, c.height).data
    let bright = 0
    for (let i = 0; i < d.length; i += 4) if (d[i] > 120) bright++
    return bright / (d.length / 4)
  }, png.toString('base64'))
}

// The time axis spans the plot less the level axis at its right, as wide as its labels (view.js axisWidth, --axis on the
// slab); the lanes are 2 px apart (GAP), over the time row (RULER, 22 px)
const LANES = 2
// A sound's lanes fill the picture all told but their foot (FOOT px) and the room under it (ROOM px); a track's lane
// TRACK px, its head line HEAD px over it where the layers are not beside the picture (view.js). `tall(box)`: a sound's
// lanes, all told, in the plot `box`
const TRACK = 160, ROOM = 80, FOOT = 18, HEAD = 20
const tall = box => box.height - 22 - FOOT - ROOM
// Each track's lane, as its layer has it (data-lane: its top and height from the picture's top), CSS px in the page:
// { y, h } in order
const tracksAt = () => page.locator('.layer').evaluateAll(els => els.map(e => { const [y, h] = e.dataset.lane.split(' ').map(Number), p = document.querySelector('.plot').getBoundingClientRect(); return { y: p.y + y, h } }))
const gutter = () => page.evaluate(() => parseFloat(getComputedStyle(document.querySelector('.panes')).getPropertyValue('--axis')))
// All of a sound shown spans the lanes less TAIL px (view.js): to --end px short of the plot's right, the meters past it
const TAIL = 4
const spans = async box => box.width - TAIL - await page.locator('.plot').evaluate(el => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(() => done(parseFloat(getComputedStyle(el).getPropertyValue('--end')))))))
async function axis(duration) {
  const box = await page.locator('.plot').boundingBox(), w = await spans(box)
  return { box, x: t => box.x + t / duration * w }
}
// Moves the pointer along `points` until the plot shows `cursor` (a name, or a pattern): where the tool can grab. Marks
// load after the output.
async function grab(points, cursor) {
  const is = c => typeof cursor === 'string' ? c === cursor : cursor.test(c)
  for (const until = Date.now() + 8000; Date.now() < until; await page.waitForTimeout(200))
    for (const [x, y] of points) {
      await page.mouse.move(x, y)
      if (is(await page.locator('.plot').evaluate(el => el.style.cursor))) return [x, y]
    }
  assert.fail(`nothing to grab with ${cursor}`)
}
// the stretch grip's pointer: arrows out to bars, its own (view.js STRETCH)
const STRETCHING = /^url\(.*ew-resize$/
const warps = async () => JSON.parse((await code()).match(/\.warp\((\[.*\])\)/)[1])
// A box on the spectrogram, ⌘ (Ctrl) held as it is pressed: a band of time and frequency; with Alt as well, another
async function boxDrag(from, by, ...keys) {
  for (const k of ['ControlOrMeta', ...keys]) await page.keyboard.down(k)
  await page.mouse.move(...from)
  await page.mouse.down()
  for (const k of ['ControlOrMeta', ...keys]) await page.keyboard.up(k)
  await page.mouse.move(from[0] + by[0], from[1] + by[1], { steps: 6 })
  await page.mouse.up()
}
async function drag([x, y], [dx, dy]) {
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x + dx, y + dy, { steps: 6 })
  await page.mouse.up()
}
const lengthIs = text => page.waitForFunction(text => (e => e.title || e.dataset.tip || '')(document.querySelector('.source')).endsWith(' · ' + text), text)
// What reaches the speakers: every AudioContext's destination becomes a tap recording its left channel, run before the page
function tap() {
  const Real = window.AudioContext
  window.__heard = []
  window.AudioContext = class extends Real {
    constructor(...args) {
      super(...args)
      const gain = this.createGain(), rec = this.createScriptProcessor(4096, 2, 2), out = super.destination
      gain.connect(out); gain.connect(rec); rec.connect(out)
      rec.onaudioprocess = e => window.__heard.push(Float32Array.from(e.inputBuffer.getChannelData(0)))
      Object.defineProperty(this, 'destination', { get: () => gain })
    }
  }
}
// What reaches the speakers, taken on the audio thread, the page's thread busy or not: every AudioContext's destination
// becomes a worklet keeping its left channel, block by block, in window.__taken; run before the page
function taken() {
  const Real = window.AudioContext
  window.__taken = []
  window.AudioContext = class extends Real {
    constructor(...args) {
      super(...args)
      const gain = this.createGain(), out = super.destination
      gain.connect(out)
      window.__rate = this.sampleRate
      const code = `registerProcessor('taken', class extends AudioWorkletProcessor { process([[left]]) { if (left) this.port.postMessage(left.slice()); return true } })`
      this.audioWorklet.addModule(URL.createObjectURL(new Blob([code], { type: 'text/javascript' }))).then(() => {
        const node = new AudioWorkletNode(this, 'taken')
        node.port.onmessage = e => window.__taken.push(e.data)
        gain.connect(node)
        node.connect(out)
      })
      Object.defineProperty(this, 'destination', { get: () => gain })
    }
  }
}
// The peak heard since the last call, and whether every sample was a number
const heard = () => page.evaluate(() => {
  let peak = 0, finite = true
  for (const block of window.__heard.splice(0)) for (const v of block) { if (!Number.isFinite(v)) finite = false; else if (Math.abs(v) > peak) peak = Math.abs(v) }
  return { peak, finite }
})

// A 440 Hz hit every half second, decaying from full scale, within 0.02 of zero (its end, the ground's) a third of a
// second after.
const hits = `audio.from(t => Math.sin(2 * Math.PI * 440 * t) * Math.exp(-(t % 0.5) * 12), { duration: 2 })`
// The hits' lines, where the caret steps by cues as by words (⌥ → on a Mac, Ctrl → elsewhere) from the start to the end,
// each time it lands on as the clock says it, in px from the plot's left; the caret back at the start
async function handles() {
  await page.locator('.plot').focus()
  const now = async () => { const [m, s] = (await page.locator('.time').innerText()).split(':'); return +m * 60 + +s }
  await page.keyboard.press('End')
  const end = await now(), w = await spans(await page.locator('.plot').boundingBox()), out = []
  await page.keyboard.press('Home')
  for (let t = 0; ;) {
    await page.keyboard.press(process.platform === 'darwin' ? 'Alt+ArrowRight' : 'Control+ArrowRight')
    const next = await now()
    if (next <= t || next >= end - .001) break
    out.push((t = next) / end * w)
  }
  await page.keyboard.press('Home')
  return out
}
// A hit's line dragged, ⌘ (Ctrl) held: grabbed where the pointer finds it along `points`
async function dragCue(points, by) {
  await page.keyboard.down('ControlOrMeta')
  await drag(await grab(points, 'col-resize'), by)
  await page.keyboard.up('ControlOrMeta')
}

// Colour in a screenshot of the plot: the largest spread between a pixel's channels, and brightness along a column.
// The grid as it shows (window.__shown): the plot's screenshot with it less one with Grid: None, the grid being drawn in
// the waveform's canvas, under the waveform (view.js paintGrid); { k (device px a CSS px), w, h, d (each pixel's largest
// difference over its channels) }. `name`, the grid set now, set again after
async function gridShown(name) {
  // each shot of the page at rest: the settings' panel closed and gone, the plot its width again, nothing fading still
  // (a hint going, a panel closing, faint over the picture)
  const width = await page.locator('.plot').evaluate(el => el.clientWidth)
  const rest = async () => {
    await page.mouse.move(2, 2)
    await page.waitForFunction(w => document.querySelector('.plot').clientWidth === w && !document.getAnimations().some(a => a instanceof CSSTransition && a.playState === 'running'), width)
    await page.waitForTimeout(200)
  }
  const shot = async () => { await rest(); return (await page.locator('.plot').screenshot()).toString('base64') }
  const on = await shot()
  await settings('Grid', 'None')
  const off = await shot()
  await settings('Grid', name)
  await rest()
  await page.evaluate(async ([a, b, width]) => {
    const read = async src => {
      const img = new Image()
      img.src = 'data:image/png;base64,' + src
      await img.decode()
      const c = Object.assign(document.createElement('canvas'), { width: img.width, height: img.height }), g = c.getContext('2d')
      g.drawImage(img, 0, 0)
      return g.getImageData(0, 0, c.width, c.height)
    }
    const [p, q] = [await read(a), await read(b)], d = new Uint8Array(p.width * p.height)
    for (let i = 0; i < d.length; i++) d[i] = Math.max(Math.abs(p.data[i * 4] - q.data[i * 4]), Math.abs(p.data[i * 4 + 1] - q.data[i * 4 + 1]), Math.abs(p.data[i * 4 + 2] - q.data[i * 4 + 2]))
    window.__shown = { k: p.width / width, w: p.width, h: p.height, d }
  }, [on, off, (await page.locator('.plot').boundingBox()).width])
}
async function pixels(fn, arg) {
  const png = await page.locator('.plot').screenshot()
  return page.evaluate(async ([b64, src, arg]) => {
    const img = new Image()
    img.src = 'data:image/png;base64,' + b64
    await img.decode()
    const c = Object.assign(document.createElement('canvas'), { width: img.width, height: img.height }), g = c.getContext('2d')
    g.drawImage(img, 0, 0)
    return new Function('d', 'w', 'h', 'arg', src)(g.getImageData(0, 0, c.width, c.height).data, c.width, c.height, arg)
  }, [png.toString('base64'), fn, arg])
}

// Shows the waveform or the spectrogram, every band (View; shown, it stays); what the last band shows, by its look
const show = name => menu('View', name === 'spec' ? 'Spectrogram' : 'Waveform')
const shown = async () => {
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))))
  return (await page.locator(':is(.lane-look, .layer-look):visible').last().getAttribute('aria-label')).replace(/^.*: /, '')
}

// A sound between pauses, as a word between spaces: bursts of a tone at 0–0.4 s and 0.5–0.9 s, a long pause, more
// at 1.5–1.9 s and 2–2.4 s. Pauses are read in blocks of 1024 samples (23 ms at 44.1 kHz), so edges land within one.
const bursts = `audio.from(t => (t < .4 || (t > .5 && t < .9) || (t > 1.5 && t < 1.9) || (t > 2 && t < 2.4)) * .5 * Math.sin(2 * Math.PI * 440 * t), { duration: 2.5 })`
// A tone struck every half second over a held one, never quiet: its cues are its strikes, its one sound all of it. A
// double-click takes one strike to the next; a triple-click, the sound between its pauses, all of it.
const struck = `audio.from(t => Math.sin(2 * Math.PI * 440 * t) * (.2 + .8 * Math.exp(-(t % 0.5) * 20)), { duration: 2 })`
// a script as it reads, its spaces aside
const scriptOf = text => text.replace(/\s+/g, '')
// A recording, the only copy there is, is kept until the person deletes it: its tab closed and the page reloaded, it
// waits under File › Open recent, opened again from there; deleted only once they say so
const keptFiles = () => page.evaluate(async () => {
  const names = []
  try { for await (const k of (await (await navigator.storage.getDirectory()).getDirectoryHandle('audio-repl-files')).keys()) if (!k.endsWith('.crswap')) names.push(decodeURIComponent(k)) } catch {}
  return names.sort()
})
const takesLeft = () => page.evaluate(async () => {
  let n = 0
  try { for await (const _ of (await (await navigator.storage.getDirectory()).getDirectoryHandle('audio-repl-takes')).keys()) n++ } catch {}
  return n
})
async function recordFor(seconds) {
  await page.getByRole('button', { name: 'Record', exact: true }).first().click()
  await page.waitForFunction(s => { const [m, sec] = document.querySelector('.time').textContent.split(':'); return +m * 60 + +sec >= s }, seconds)
}
// The keys, one gesture each (view.js selectDown): small tests, as these are the easiest to break
// A handle clicked until it is turned to `name`, its way as kept for the next visit (grip, pill, curve), each click the
// next, no menu
const way = key => page.evaluate(k => JSON.parse(localStorage.getItem('audio-repl'))[k], key)
async function turn(at, key, name) {
  for (let i = 0; i < 4 && await way(key) !== name; i++) await page.mouse.click(...at)
  assert.equal(await way(key), name)
}
const keyed = async (keys, act) => { for (const k of keys) await page.keyboard.down(k); await act(); for (const k of [...keys].reverse()) await page.keyboard.up(k) }
async function chime() {
  await open()
  await noCues()
  await write(`audio('chime.wav')`)
  await lengthIs('0:08.000')
  const { box, x } = await axis(8)
  return { box, x, y: box.y + tall(box) * .3, ranges: async () => (await page.locator('.clock').evaluate(tipOf)).match(/^Selected (\d+) ranges: ([\d:.]+),/)?.slice(1) ?? [] }
}
// every caret, as M marks them (and takes them back)
async function marked() {
  await page.keyboard.press('m')
  await page.waitForFunction(() => /\.mark\(/.test(scriptText()))
  const c = await code()
  await page.keyboard.press('ControlOrMeta+Z')
  await page.waitForFunction(() => !/\.mark\(/.test(scriptText()))
  return [...c.matchAll(/mark\(([\d.]+)\)/g)].map(m => +m[1])
}

// Shift sums, as Shift and a press in a text: the selection goes out to the press at once, from where it was begun, a
// drag going on with it, never another range; held, the pointer an I-beam with a plus on the side it goes out from
const pointed = () => page.locator('.plot').evaluate(el => decodeURIComponent(el.style.cursor))
// Held Alt, what the time row has in the measuring red between `a` and `b` (page x): on its row most lit, how many pixels
const measuredOnRow = (box, a, b) => pixels(`let best = 0; for (let y = h - 20; y < h - 2; y++) { let n = 0; for (let x = ${Math.round(a - box.x)}; x < ${Math.round(b - box.x)}; x++) { const i = (y * w + x) * 4; if (d[i] - d[i + 2] > 60) n++ } best = Math.max(best, n) } return best`)
const crossed = () => page.waitForFunction(() => document.querySelector('.plot').style.cursor === 'crosshair')
// The context menu's row by its words, a submenu's too
const contextRow = name => page.locator('.menubar-menu .menu-row', { has: page.locator('.menu-label', { hasText: new RegExp(`^${name}$`) }) }).last()

// A selection's tools inside its foot, flush with it, side by side from its middle (view.js BOX, 16 px, 2 apart): pitch,
// intonation, formants; the pill on its top edge its level alone
const tools = (x, box, a, b) => Object.fromEntries(['pitch', 'intonation', 'formant'].map((name, i) => [name, [(x(a) + x(b)) / 2 + (i - 1) * 18, box.y + tall(box) - 8]]))

// VS Code's colour themes (theme.js), read from its own files (playground/themes, as microsoft/vscode ships them): each
// part of the editor in the colour of the part of VS Code it stands for (theme.js MAP), as the theme writes it, or VS
// Code's default for its kind where it does not (registerColor, VS Code 1.143: src/vs/platform/theme/common/colors/*.ts,
// src/vs/workbench/common/theme.ts). Dark+ (dark_plus.json over dark_vs.json): the background #1E1E1E, the text
// #D4D4D4, numbers #b5cea8, headings #569cd6, the inactive selection #3A3D41, a menu #252526 and its row #0078d4, an
// inactive tab's words #A6A6A6; defaults for dark: line numbers #858585, a group's border #444444, an input #3C3C3C, the
// selection #264F78, the focus #007FD4, a menu row's words #FFFFFF (list.activeSelectionForeground), the active tab the
// editor's background, its words #FFFFFF, the tabs' row and the sidebar #252526, a range #ffffff0b, the title bar
// #3C3C3C. Light+ (light_plus.json over light_vs.json): #FFFFFF, #000000, #098658, #800000, the inactive selection
// #E5EBF1, a list's row pointed at #E8E8E8, an inactive tab's words #616161; defaults for light: #237893, #E7E7E7,
// #FFFFFF, #ADD6FF, #0090F1, a menu #FFFFFF (dropdown.background) and its row #0060C0 (list.activeSelectionBackground),
// the active tab's words #333333, the tabs' row and the sidebar #F3F3F3, a range #fdff0033, the title bar #DDDDDD.
// Monokai (monokai-color-theme.json): #272822, #f8f8f2, a group's border #34352f, an input #414339, the focus #99947c,
// headings #A6E22E, the selection #878b9180, no inactive one, so the selection at half (#878b9140), a menu #1e1f1c and
// its row the list's selection #75715E, the tabs' row, the sidebar and the title bar #1e1f1c
const themed = async name => {
  const { THEMES, load, skin } = await import('../../playground/theme.js'), t = THEMES.find(t => t.name === name)
  return skin(await load(new URL(`../../playground/themes/${t.file}`, import.meta.url).href, { kind: t.kind, get: u => readFile(new URL(u), 'utf8') }))
}

// a test's own page in place of the one it was given, closed after it as that one is
const setPage = p => { page = p }

export { root, browser, page, origin, errors, made, CHIME, chimeLeft, RATE, sine, peakDb, wavBytes, engine, scrubbed, clicked, attack, code, readout, tipOf, wholeLevels, levelsTable, lengthText, seconds, open, settled, frames, poll, still, menuRow, choice, settings, selected, tab, edits, menu, facts, offered, palette, noCues, write, drawn, LANES, TRACK, ROOM, FOOT, HEAD, tall, tracksAt, gutter, TAIL, spans, axis, grab, STRETCHING, warps, boxDrag, drag, lengthIs, tap, taken, heard, hits, handles, dragCue, gridShown, pixels, show, shown, bursts, struck, scriptOf, keptFiles, takesLeft, recordFor, way, turn, keyed, chime, marked, pointed, measuredOnRow, crossed, contextRow, tools, themed, setPage }
