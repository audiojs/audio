/**
 * Browser test runner — builds bundle, starts server, launches headless Chromium via Playwright, captures tst output.
 */
import { createServer } from 'http'
import { readFile } from 'fs/promises'
import { extname, normalize, resolve, sep } from 'path'
import { fileURLToPath } from 'url'
import { execSync } from 'child_process'
import { chromium } from 'playwright'

let root = fileURLToPath(new URL('..', import.meta.url)).replace(/\/+$/, '')

// Build browser bundle
console.log('Building browser bundle...')
execSync('npm run build', { cwd: root, stdio: 'inherit' })

let types = { '.html': 'text/html', '.js': 'text/javascript', '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.wasm': 'application/wasm' }

// Start server
let server = createServer(async (req, res) => {
  let rel = normalize(req.url === '/' ? 'test/test.html' : req.url.split('?')[0]).replace(/^\//, '')
  let path = resolve(root, rel)
  if (!path.startsWith(root + sep)) { res.writeHead(403); res.end('403'); return }
  try {
    res.writeHead(200, {
      'content-type': types[extname(path)] || 'application/octet-stream',
      'cross-origin-opener-policy': 'same-origin',
      'cross-origin-embedder-policy': 'require-corp'
    })
    res.end(await readFile(path))
  } catch {
    res.writeHead(404); res.end('404')
  }
})

await new Promise(r => server.listen(0, r))
let port = server.address().port

let browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] })
let page = await browser.newPage()

let lines = [], failed = false

page.on('console', msg => {
  let text = msg.text()
  lines.push(text)
  // Strip browser CSS styling from tst output
  let clean = text.replace(/%c/g, '').replace(/ color: #[0-9a-f]+/gi, '').replace(/ color: \w+/gi, '').trim()
  if (clean && clean !== 'console.groupEnd') process.stdout.write(clean + '\n')
})

page.on('pageerror', err => {
  console.error('PAGE ERROR:', err.message)
  failed = true
  earlyExit?.()
})

// Wait for tst summary — look for "# total" line
let earlyExit
let done = new Promise(resolve => {
  earlyExit = resolve
  page.on('console', msg => {
    let text = msg.text()
    if (text.includes('# fail')) failed = true
    if (text.includes('# total')) setTimeout(resolve, 1000)
  })
})

try {
  await page.goto(`http://localhost:${port}`)
  await Promise.race([done, new Promise((_, r) => setTimeout(() => r(new Error('Browser tests timed out (60s)')), 60000))])
} catch (e) {
  console.error(e.message)
  failed = true
} finally {
  await browser.close()
  server.close()
}
process.exit(failed ? 1 : 0)
