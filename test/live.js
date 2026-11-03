// The website as deployed, in a browser: node test/live.js [URL] (default https://audio.js.org/audio/), or --local: this
// checkout built and served as `npm run serve` serves it, before a deploy (CI's browser suites), so the checks keep up
// with the page. Its root leads to the playground; the playground opens on an empty tab, its ways in offered, and a link's
// script opens its sound, decoded and measured: what a visitor sees first, from the files the server actually serves
// (CI builds them; a page that loads one of them from a path the deploy left out hangs at "Decoding…").
import { chromium } from 'playwright'

const local = process.argv[2] === '--local' && await (async () => {
  await import('../.site-build.js')
  const { createServer } = await import('node:http'), { serve } = await import('../.site-serve.js'), { fileURLToPath } = await import('node:url')
  const root = fileURLToPath(new URL('..', import.meta.url))
  const server = createServer((req, res) => { const { pathname, search } = new URL(req.url, 'http://localhost'); serve(root, pathname, search, res) })
  await new Promise(r => server.listen(0, '127.0.0.1', r))
  return server
})()
const base = (local ? `http://127.0.0.1:${local.address().port}/` : process.argv[2] || 'https://audio.js.org/audio/').replace(/\/?$/, '/')
const browser = await chromium.launch()
let failed = 0
const check = async (name, fn) => {
  const page = await browser.newPage(), missing = []
  page.on('response', r => r.status() >= 400 && missing.push(`${r.status()} ${r.url()}`))
  try { await fn(page); console.log(`ok ${name}`) }
  catch (e) { failed++; console.log(`not ok ${name}: ${e.message.split('\n')[0]}${missing.length ? '\n  ' + missing.join('\n  ') : ''}`) }
  finally { await page.close() }
}

await check('the repository\'s root opens the playground', async page => {
  await page.goto(base)
  await page.waitForURL(/\/playground\/$/, { timeout: 30000 })
})
// a link to a script, as Share copies it: the script deflated, base64url
const link = async script => base + 'playground/#code=' + Buffer.from(await new Response(new Blob([script]).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer()).toString('base64url')
const chime = await link(`audio('chime.wav').trim().normalize(-1)`)
await check('playground opens on an empty tab, its ways in offered', async page => {
  await page.goto(base + 'playground/')
  await page.locator('.empty', { hasText: 'record' }).waitFor({ timeout: 30000 })
})
await check('playground opens a link\'s sound, measured', async page => {
  await page.goto(chime)
  await page.locator('.readout[data-of="all"]', { hasText: 'dBFS' }).waitFor({ timeout: 60000 })
})
// GitHub Pages sends no COOP or COEP: sw.js adds them, so a model's wasm runs on threads
await check('playground cross-origin isolated', async page => {
  await page.goto(chime)
  await page.waitForFunction(() => crossOriginIsolated, null, { timeout: 30000 })
  await page.locator('.readout[data-of="all"]', { hasText: 'dBFS' }).waitFor({ timeout: 60000 })
})

await browser.close()
local?.close()
process.exitCode = failed ? 1 : 0
