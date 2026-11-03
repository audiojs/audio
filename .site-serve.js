// The repository's files as the pages read them, for `npm run serve`, the Mac app's server (desktop/server.js) and the
// tests: each with its type, cross-origin isolated (the models' wasm runs on threads, as sw.js makes the playground on
// GitHub Pages), never cached, so a reload always runs the files as they are; a folder is its index.html, at its path
// with a slash, so the page's own links resolve inside it; nothing hidden (.git, .work, a .env). Run, it serves this
// folder: node .site-serve.js [port] [--watch] (npm run serve: the bundles made first and again as their sources change)
import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { extname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'

export const TYPES = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.map': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.gif': 'image/gif', '.woff2': 'font/woff2',
  '.wasm': 'application/wasm', '.md': 'text/markdown', '.onnx': 'application/octet-stream',
  '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.flac': 'audio/flac', '.ogg': 'audio/ogg'
}
// Chromium takes COEP credentialless; WebKit ignores it and runs the models on one thread
export const ISOLATED = { 'cross-origin-opener-policy': 'same-origin', 'cross-origin-embedder-policy': 'credentialless' }

/** Answers `pathname` (+ `search`, kept on a folder's redirect) with the file of `root` it names, or 403, 404 */
export async function serve(root, pathname, search, res) {
  let path = normalize(join(root, decodeURIComponent(pathname)))
  if (!path.startsWith(root) || /(^|[\\/])\.(?!well-known)/.test(path.slice(root.length))) return res.writeHead(403).end()
  if ((await stat(path).catch(() => null))?.isDirectory()) {
    if (!pathname.endsWith('/')) return res.writeHead(301, { location: pathname + '/' + search }).end()
    path = join(path, 'index.html')
  }
  const data = await readFile(path).catch(() => null)
  if (!data) return res.writeHead(404, { 'content-type': 'text/plain' }).end(`Not found: ${pathname}`)
  res.writeHead(200, { 'content-type': TYPES[extname(path)] || 'application/octet-stream', 'cache-control': 'no-store', ...ISOLATED }).end(data)
}

if (process.argv[1] && fileURLToPath(import.meta.url) === normalize(process.argv[1])) {
  if (process.argv.includes('--watch')) { const { assets, workers } = await import('./.site-build.js'); await assets(true); await workers(true) }
  const root = fileURLToPath(new URL('.', import.meta.url)), port = +(process.argv.slice(2).find(a => /^\d+$/.test(a)) || process.env.PORT || 8080)
  createServer((req, res) => { const { pathname, search } = new URL(req.url, 'http://localhost'); serve(root, pathname, search, res) })
    .on('error', e => { console.error(e.code === 'EADDRINUSE' ? `Port ${port} is taken: node .site-serve.js <port>` : e.message); process.exit(1) })
    .listen(port, () => console.log(`http://localhost:${port}/playground/  playground`))
}
