/**
 * Browser test runner — builds bundle, starts server, launches headless Chromium via Playwright, captures tst output.
 * Two pages: the library suite (test/test.html), then playback recorded at the destination (test/play.html).
 * `--serve` (npm run test:browser -- --serve): keep the test pages up to run and debug in a real browser instead.
 */
import { createServer } from 'http'
import { readFile } from 'fs/promises'
import { extname, normalize, resolve, sep } from 'path'
import { fileURLToPath } from 'url'
import { execSync } from 'child_process'
import { builtinModules } from 'module'
import { build } from 'esbuild'
import { chromium } from 'playwright'

let root = fileURLToPath(new URL('..', import.meta.url)).replace(/\/+$/, '')

// Build browser bundle
console.log('Building browser bundle...')
execSync('npm run build', { cwd: root, stdio: 'inherit' })

// Worker entries, bundled in memory: a worker has no import map. The engine's own entry (audio/worker) and an app's
// (test/worker-app.js); what loads on first use (codecs, registry plugins) stays out, as in dist/.
let bundles = new Map()
for (let [name, entry] of [['worker.js', 'worker.js'], ['worker-app.js', 'test/worker-app.js']]) {
  let { outputFiles } = await build({
    entryPoints: [resolve(root, entry)], bundle: true, format: 'esm', platform: 'browser', write: false,
    external: builtinModules.flatMap(m => [m, 'node:' + m]),
    plugins: [{ name: 'lazy', setup(b) { b.onResolve({ filter: /^@audio\// }, a => a.kind === 'dynamic-import' && !/^@audio\/speaker\b/.test(a.path) ? { path: a.path, external: true } : undefined) } }],
  })
  bundles.set('test/dist/' + name, outputFiles[0].contents)
}

let types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.wasm': 'application/wasm' }

// Start server
let server = createServer(async (req, res) => {
  let rel = normalize(req.url === '/' ? 'test/test.html' : req.url.split('?')[0]).replace(/^\//, '')
  let path = resolve(root, rel)
  if (!path.startsWith(root + sep)) { res.writeHead(403); res.end('403'); return }
  try {
    let body = bundles.get(rel) ?? await readFile(path)
    res.writeHead(200, {
      'content-type': types[extname(path)] || 'application/octet-stream',
      'cross-origin-opener-policy': 'same-origin',
      'cross-origin-embedder-policy': 'require-corp'
    })
    res.end(body)
  } catch {
    res.writeHead(404); res.end('404')
  }
})

await new Promise(r => server.listen(0, r))
let port = server.address().port

if (process.argv.includes('--serve')) {
  console.log(`Browser tests: http://localhost:${port} and http://localhost:${port}/test/play.html (Ctrl-C stops)`)
  await new Promise(() => {})
}

let browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] })
let failed = false

// Run one tst page to its summary
async function run(url, timeout) {
  let page = await browser.newPage(), earlyExit
  page.on('console', msg => {
    // Strip browser CSS styling from tst output
    let clean = msg.text().replace(/%c/g, '').replace(/ color: #[0-9a-f]+/gi, '').replace(/ color: \w+/gi, '').trim()
    if (clean && clean !== 'console.groupEnd') process.stdout.write(clean + '\n')
  })
  page.on('pageerror', err => {
    console.error('PAGE ERROR:', err.message)
    failed = true
    earlyExit?.()
  })
  // Wait for tst summary — look for "# total" line
  let done = new Promise(resolve => {
    earlyExit = resolve
    page.on('console', msg => {
      let text = msg.text()
      if (text.includes('# fail')) failed = true
      if (text.includes('# total')) setTimeout(resolve, 1000)
    })
  })
  try {
    await page.goto(`http://localhost:${port}${url}`)
    await Promise.race([done, new Promise((_, r) => setTimeout(() => r(new Error(`Browser tests timed out (${timeout / 1000}s): ${url}`)), timeout))])
  } catch (e) {
    console.error(e.message)
    failed = true
  } finally {
    await page.close()
  }
}

try {
  await run('/', 60000)
  await run('/test/play.html', 120000)
} finally {
  await browser.close()
  server.close()
}
process.exit(failed ? 1 : 0)
