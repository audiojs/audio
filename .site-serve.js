// Serve the website and the REPL from this folder, nothing cached, so a reload always runs the files as they are:
// npm run serve (builds first), or node .site-serve.js [port]
import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { extname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('.', import.meta.url)), port = +(process.argv[2] || process.env.PORT || 8080)
const types = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.map': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.gif': 'image/gif', '.woff2': 'font/woff2',
  '.wasm': 'application/wasm', '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.flac': 'audio/flac', '.ogg': 'audio/ogg', '.md': 'text/markdown'
}

createServer(async (req, res) => {
  const { pathname } = new URL(req.url, 'http://localhost'), path = normalize(join(root, decodeURIComponent(pathname)))
  if (!path.startsWith(root)) return res.writeHead(403).end()
  try {
    // a folder is its index.html, at a path ending in / so the page's relative links resolve inside it
    if ((await stat(path)).isDirectory()) {
      if (!pathname.endsWith('/')) return res.writeHead(301, { location: pathname + '/' }).end()
      return await send(res, join(path, 'index.html'))
    }
    await send(res, path)
  } catch { res.writeHead(404, { 'content-type': 'text/plain' }).end(`Not found: ${pathname}`) }
})
  .on('error', e => { console.error(e.code === 'EADDRINUSE' ? `Port ${port} is taken: node .site-serve.js <port>` : e.message); process.exit(1) })
  .listen(port, () => console.log(`http://localhost:${port}/           website\nhttp://localhost:${port}/repl.html  REPL`))

async function send(res, path) {
  const body = await readFile(path)
  res.writeHead(200, { 'content-type': types[extname(path)] || 'application/octet-stream', 'cache-control': 'no-store' }).end(body)
}
