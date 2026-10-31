/** Serve the playground and local media files for Audio.app on 127.0.0.1. */
import { createServer } from 'node:http'
import { createReadStream, fstatSync } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, extname, isAbsolute, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const port = +(process.argv[process.argv.indexOf('--port') + 1] || process.env.AUDIO_PORT || 7781)
const origin = `http://127.0.0.1:${port}`
const hosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`])

const TYPES = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.map': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.gif': 'image/gif', '.woff2': 'font/woff2',
  '.wasm': 'application/wasm', '.md': 'text/markdown', '.onnx': 'application/octet-stream'
}
// a file of this machine the pages may read by its path (GET /f/PATH): audio and video, nothing else
const MEDIA = {
  '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.flac': 'audio/flac', '.ogg': 'audio/ogg', '.oga': 'audio/ogg', '.opus': 'audio/ogg',
  '.m4a': 'audio/mp4', '.aac': 'audio/aac', '.aif': 'audio/aiff', '.aiff': 'audio/aiff', '.caf': 'audio/x-caf', '.webm': 'audio/webm',
  '.mka': 'audio/x-matroska', '.wma': 'audio/x-ms-wma', '.amr': 'audio/amr', '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.mkv': 'video/x-matroska'
}
// cross-origin isolated where the engine takes COEP credentialless (Chromium); WebKit ignores it and runs models on one thread
const ISOLATED = { 'cross-origin-opener-policy': 'same-origin', 'cross-origin-embedder-policy': 'credentialless' }

const expand = p => normalize(String(p).replace(/^~(?=$|[\\/])/, homedir()))

const reply = (res, code, data) => res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' }).end(JSON.stringify(data))

// a media file by its path, a range of it when asked (an <audio> seeking)
async function file(path, req, res) {
  path = expand(decodeURIComponent(path))
  const type = MEDIA[extname(path).toLowerCase()]
  if (!isAbsolute(path) || !type) return reply(res, 415, { error: `Not an audio or video file: ${basename(path)}` })
  const s = await stat(path).catch(() => null)
  if (!s?.isFile()) return reply(res, 404, { error: `No file ${path}` })
  const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '')
  if (m && (m[1] || m[2])) {
    const from = m[1] ? +m[1] : Math.max(0, s.size - +m[2]), to = m[1] && m[2] ? Math.min(+m[2], s.size - 1) : s.size - 1
    if (from > to) return res.writeHead(416, { 'content-range': `bytes */${s.size}` }).end()
    res.writeHead(206, { 'content-type': type, 'content-length': to - from + 1, 'content-range': `bytes ${from}-${to}/${s.size}`, 'accept-ranges': 'bytes', 'cache-control': 'no-store' })
    return createReadStream(path, { start: from, end: to }).pipe(res)
  }
  res.writeHead(200, { 'content-type': type, 'content-length': s.size, 'accept-ranges': 'bytes', 'cache-control': 'no-store' })
  createReadStream(path).pipe(res)
}

// the repo's own files, as `npm run serve` serves them: never cached, so a reload runs them as they are
async function serve(pathname, res) {
  let path = normalize(join(root, decodeURIComponent(pathname)))
  // nothing hidden (.git, .work, a .env): a dot-name anywhere under the root
  if (!path.startsWith(root) || /(^|[\\/])\.(?!well-known)/.test(path.slice(root.length))) return res.writeHead(403).end()
  if ((await stat(path).catch(() => null))?.isDirectory()) path = join(path, 'index.html')
  const data = await readFile(path).catch(() => null)
  if (!data) return res.writeHead(404, { 'content-type': 'text/plain' }).end(`Not found: ${pathname}`)
  res.writeHead(200, { 'content-type': TYPES[extname(path)] || 'application/octet-stream', 'cache-control': 'no-store', ...ISOLATED }).end(data)
}

const server = createServer(async (req, res) => {
  if (!hosts.has(req.headers.host)) return res.writeHead(421).end()
  const { pathname } = new URL(req.url, origin)
  const site = req.headers['sec-fetch-site']
  const ours = !site || site === 'same-origin' || site === 'none'
  try {
    if (pathname.startsWith('/f/')) {
      if (!ours) return reply(res, 403, { error: "Only the app's own pages" })
      if (req.method !== 'GET' && req.method !== 'HEAD') return res.writeHead(405).end()
      return await file(pathname.slice(2), req, res)
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') return res.writeHead(405).end()
    // This server supplies the isolation headers; the service worker only claims the page.
    if (pathname === '/sw.js') return res.writeHead(200, { 'content-type': 'text/javascript', 'cache-control': 'no-store' }).end("self.addEventListener('install', () => self.skipWaiting())\nself.addEventListener('activate', e => e.waitUntil(self.clients.claim()))\n")
    await serve(pathname === '/' ? '/playground.html' : pathname, res)
  } catch (e) { reply(res, e.status ?? 500, { error: e.message, code: e.code }) }
})

// The shell holds stdin open; when it exits, this server exits with it.
const quit = () => process.exit(0)
for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP']) process.on(signal, quit)
if (fstatSync(0).isFIFO()) process.stdin.resume().on('end', quit).on('error', quit)

server.on('error', e => { console.error(e.code === 'EADDRINUSE' ? `port ${port} is in use` : e.message); process.exit(1) })
server.listen(port, '127.0.0.1', () => console.log(`ready ${origin}`))
