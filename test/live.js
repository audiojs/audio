// The website as deployed, in a browser: node test/live.js [URL] (default https://audio.js.org/audio/), or --local: this
// checkout's site, as Pages deploys it (.site-build.js site: the playground's page minified), served before a deploy
// (CI's browser suites), so the checks keep up with the page. Its root leads to the playground; the playground opens on an
// empty tab, its ways in offered, and a link's script opens its sound, decoded and measured: what a visitor sees first,
// from the files the server actually serves (CI builds them; a page that loads one of them from a path the deploy left
// out hangs at "Decoding…"); the home's hero loads no more than its budget.
import { chromium } from 'playwright'
import { gzipSync } from 'node:zlib'

// the home's hero's first load, at most (below)
const BUDGET_KB = 520

const local = process.argv[2] !== '--local' ? null : await (async () => {
  const { bundles, site } = await import('../.site-build.js'), { mkdtemp, rm } = await import('node:fs/promises'), { tmpdir } = await import('node:os'), { join } = await import('node:path')
  const root = await mkdtemp(join(tmpdir(), 'audio-site-'))
  await bundles()
  await site(root)
  const { createServer } = await import('node:http'), { serve } = await import('../.site-serve.js')
  const server = createServer((req, res) => { const { pathname, search } = new URL(req.url, 'http://localhost'); serve(root, pathname, search, res) })
  await new Promise(r => server.listen(0, '127.0.0.1', r))
  return { server, close: () => { server.close(); return rm(root, { recursive: true, force: true }) } }
})()
const base = (local ? `http://127.0.0.1:${local.server.address().port}/` : process.argv[2] || 'https://audio.js.org/audio/').replace(/\/?$/, '/')
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

// The home's hero (audio.js.org: <audio-repl> as the home writes it, playground/embed.js): what its frame loads before
// the visitor does anything, gzipped as Pages sends it, the sound apart (playground/README.md, How it is built). The
// target is 300 KB; BUDGET holds what it is down to, so it can't creep back
const BUDGET = 1024 * BUDGET_KB
await check(`the home's hero loads ${BUDGET_KB} KB or less gzipped at first`, async page => {
  const sizes = new Map(), ui = { panel: 'none', display: 'wave', controls: 'sound play clock history save loudness rate channels view link'.split(' '), ops: ['trim(-40)', 'normalize(-1)', 'fade(1, 1)', 'stretch(1.25)', 'pitch(-2)', 'reverse'], zoom: { out: 1 }, overshoot: 0, scroll: 'hover' }
  let last = Date.now()
  page.context().on('response', async r => {
    last = Date.now()
    if (!r.url().startsWith(base) || /^audio\//.test(r.headers()['content-type'] ?? '')) return
    sizes.set(r.url(), gzipSync(await r.body().catch(() => Buffer.alloc(0))).length)
  })
  await page.setViewportSize({ width: 960, height: 320 })
  await page.goto(base + 'playground/?embed&ui=' + encodeURIComponent(JSON.stringify(ui)) + new URL(await link(`audio('chime.wav')`)).hash)
  await page.locator('.readout[data-of="all"]', { hasText: 'LUFS' }).waitFor({ timeout: 60000 })
  // what comes after the sound (the deck, the cues' finders) till nothing has come for a while
  while (Date.now() - last < 2000) await page.waitForTimeout(250)
  const total = [...sizes.values()].reduce((a, b) => a + b, 0), top = [...sizes].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([u, n]) => `${new URL(u).pathname} ${(n / 1024).toFixed(0)}`)
  console.log(`  ${(total / 1024).toFixed(0)} KB in ${sizes.size} files: ${top.join(', ')}`)
  if (total > BUDGET) throw new Error(`${(total / 1024).toFixed(0)} KB, over ${BUDGET_KB}`)
})

await browser.close()
await local?.close()
process.exitCode = failed ? 1 : 0
