/** Serve the playground and local media files for Audio.app on 127.0.0.1. */
import { createServer } from 'node:http'
import { execFileSync } from 'node:child_process'
import { createReadStream, fstatSync } from 'node:fs'
import { stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, extname, isAbsolute, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'
import { serve } from '../.site-serve.js'

const root = fileURLToPath(new URL('..', import.meta.url))
const port = +(process.argv[process.argv.indexOf('--port') + 1] || process.env.AUDIO_PORT || 7781)
const origin = `http://127.0.0.1:${port}`
const hosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`])

// a file of this machine the pages may read by its path (GET /f/PATH): audio and video, nothing else
const MEDIA = {
  '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.flac': 'audio/flac', '.ogg': 'audio/ogg', '.oga': 'audio/ogg', '.opus': 'audio/ogg',
  '.m4a': 'audio/mp4', '.aac': 'audio/aac', '.aif': 'audio/aiff', '.aiff': 'audio/aiff', '.caf': 'audio/x-caf', '.webm': 'audio/webm',
  '.mka': 'audio/x-matroska', '.wma': 'audio/x-ms-wma', '.amr': 'audio/amr', '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.mkv': 'video/x-matroska'
}
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

const server = createServer(async (req, res) => {
  if (!hosts.has(req.headers.host)) return res.writeHead(421).end()
  const { pathname, search } = new URL(req.url, origin)
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
    if (pathname === '/playground/sw.js') return res.writeHead(200, { 'content-type': 'text/javascript', 'cache-control': 'no-store' }).end("self.addEventListener('install', () => self.skipWaiting())\nself.addEventListener('activate', e => e.waitUntil(self.clients.claim()))\n")
    // the repo's own files, as `npm run serve` serves them
    await serve(root, pathname, search, res)
  } catch (e) { reply(res, e.status ?? 500, { error: e.message, code: e.code }) }
})

// The shell holds stdin open; when it exits, this server exits with it.
const quit = () => process.exit(0)
for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP']) process.on(signal, quit)
if (fstatSync(0).isFIFO()) process.stdin.resume().on('end', quit).on('error', quit)

// the bundles as the repo is now (git holds none): one that can't be made leaves what was made last
try { execFileSync(process.execPath, ['.site-build.js'], { cwd: root, stdio: 'ignore' }) } catch {}

server.on('error', e => { console.error(e.code === 'EADDRINUSE' ? `port ${port} is in use` : e.message); process.exit(1) })
server.listen(port, '127.0.0.1', () => console.log(`ready ${origin}`))
