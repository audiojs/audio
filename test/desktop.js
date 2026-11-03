// The Mac app's server (desktop/server.js) as the app asks it: the site's root, which forwards to the editor (the app
// opens /?desktop, and where the editor lives only the root knows), a folder at its own address with a slash so its
// page's links resolve inside it, nothing hidden, nothing missing answered as found.
import test, { is, ok } from 'tst'
import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { fileURLToPath } from 'node:url'

const script = fileURLToPath(new URL('../desktop/server.js', import.meta.url))
const free = () => new Promise(done => { const s = createServer().listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => done(port)) }) })

test('desktop server: the root forwards to the editor, a folder is its index at its address with a slash', async () => {
  const port = await free(), origin = `http://127.0.0.1:${port}`
  // stdin held open, as the app holds it: the server ends with it
  const server = spawn(process.execPath, [script, '--port', String(port)], { stdio: ['pipe', 'pipe', 'inherit'] })
  try {
    await new Promise((done, fail) => { server.stdout.on('data', d => String(d).includes('ready') && done()); server.on('exit', fail) })
    const get = path => fetch(origin + path, { redirect: 'manual' })
    const root = await get('/?desktop')
    is(root.status, 200, 'the root')
    ok((await root.text()).includes("location.replace('playground/' + location.search + location.hash)"), 'the root forwards, its query and hash along')
    const bare = await get('/playground?desktop')
    is([bare.status, bare.headers.get('location')], [301, '/playground/?desktop'], 'a folder without its slash: to it, its query along')
    const editor = await get('/playground/?desktop')
    is(editor.status, 200, 'the editor')
    ok((await editor.text()).includes('<div id="app"'), 'its page')
    is((await get('/.git/HEAD')).status, 403, 'nothing hidden')
    is((await get('/playground/no-such.js')).status, 404, 'a file not there')
  } finally { server.stdin.end(); server.kill() }
})
