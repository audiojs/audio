// The website as deployed, in a browser: node test/live.js [URL] (default https://audio.js.org/).
// The home page shows this package's version; the playground opens on an empty tab, its ways in offered, and a link's
// script opens its sound, decoded and measured: what a visitor sees first, from the files the server actually serves
// (CI builds them; a page that loads one of them from a path the deploy left out hangs at "Decoding…").
import { chromium } from 'playwright'
import { readFileSync } from 'node:fs'

const base = (process.argv[2] || 'https://audio.js.org/').replace(/\/?$/, '/')
const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
const browser = await chromium.launch()
let failed = 0
const check = async (name, fn) => {
  const page = await browser.newPage(), missing = []
  page.on('response', r => r.status() >= 400 && missing.push(`${r.status()} ${r.url()}`))
  try { await fn(page); console.log(`ok ${name}`) }
  catch (e) { failed++; console.log(`not ok ${name}: ${e.message.split('\n')[0]}${missing.length ? '\n  ' + missing.join('\n  ') : ''}`) }
  finally { await page.close() }
}

await check(`home page shows v${version}`, async page => {
  await page.goto(base)
  await page.locator('.header .version', { hasText: `v${version}` }).waitFor({ timeout: 30000 })
})
// a link to a script, as Share copies it: the script deflated, base64url
const link = async script => base + 'playground.html#code=' + Buffer.from(await new Response(new Blob([script]).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer()).toString('base64url')
const chime = await link(`audio('chime.wav').trim().normalize(-1)`)
await check('playground opens on an empty tab, its ways in offered', async page => {
  await page.goto(base + 'playground.html')
  await page.locator('.empty-button', { hasText: 'Record' }).waitFor({ timeout: 30000 })
})
await check('playground opens a link\'s sound, measured', async page => {
  await page.goto(chime)
  await page.locator('.readout', { hasText: 'peak' }).waitFor({ timeout: 60000 })
})
// GitHub Pages sends no COOP or COEP: sw.js adds them, so a model's wasm runs on threads
await check('playground cross-origin isolated', async page => {
  await page.goto(chime)
  await page.waitForFunction(() => crossOriginIsolated, null, { timeout: 30000 })
  await page.locator('.readout', { hasText: 'peak' }).waitFor({ timeout: 60000 })
})
await check('editor.html still leads to the playground', async page => {
  await page.goto(base + 'editor.html#code=x')
  await page.waitForURL(/playground\.html/, { timeout: 30000 })
})

await browser.close()
process.exitCode = failed ? 1 : 0
