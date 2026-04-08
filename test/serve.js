import { createServer } from 'http'
import { readFile } from 'fs/promises'
import { join, extname, normalize, resolve } from 'path'
import { fileURLToPath } from 'url'

let root = fileURLToPath(new URL('..', import.meta.url))
let types = { '.html': 'text/html', '.js': 'text/javascript', '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.wasm': 'application/wasm' }

createServer(async (req, res) => {
  let rel = normalize(req.url === '/' ? 'test/test.html' : req.url.split('?')[0])
  let path = resolve(root, rel)
  if (!path.startsWith(root)) { res.writeHead(403); res.end('403'); return }
  try {
    res.writeHead(200, { 'content-type': types[extname(path)] || 'application/octet-stream' })
    res.end(await readFile(path))
  } catch {
    res.writeHead(404); res.end('404')
  }
}).listen(8111, () => console.log('http://localhost:8111'))
