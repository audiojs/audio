// The website as deployed, in a browser: node test/live.js [URL] (default https://audiojs.dev/audio/).
// The home page shows this package's version, and the playground opens its sound, decoded and measured: what a
// visitor sees first, from the files the server actually serves (CI builds them; a page that loads one of them from
// a path the deploy left out hangs at "Decoding…").
import { chromium } from 'playwright'
import { readFileSync } from 'node:fs'

const base = (process.argv[2] || 'https://audiojs.dev/audio/').replace(/\/?$/, '/')
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
await check('playground opens its sound, measured', async page => {
  await page.goto(base + 'playground.html')
  await page.locator('.readout', { hasText: 'LUFS' }).waitFor({ timeout: 60000 })
})
await check('editor.html still leads to the playground', async page => {
  await page.goto(base + 'editor.html#code=x')
  await page.waitForURL(/playground\.html/, { timeout: 30000 })
})

await browser.close()
process.exitCode = failed ? 1 : 0
