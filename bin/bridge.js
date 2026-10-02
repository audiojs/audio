/**
 * audio bridge: the REPL page and the user's own AI agents meet here, over HTTP on 127.0.0.1.
 *
 *   audio --bridge [--port 7777] [--key K] [--timeout 30]
 *
 * The page holds the sound, so an agent reaches it through tools the page answers. The page listens
 * on GET /events (Server-Sent Events) and answers each `call` event with POST /reply; POST /call,
 * which `audio --mcp --repl URL --key K` sends for an agent's repl_* tool, waits for that answer.
 * POST /chat runs an agent CLI found on PATH headless, with those tools attached, and streams its
 * answer to the page as `chat` events. CORS is open to any origin (the page may be served from
 * https://audiojs.dev), so the key is the auth: every request carries it, as `?key=K` or
 * `Authorization: Bearer K`. Nothing the page sends is executed except an agent CLI from the
 * registry below, spawned without a shell, the user's text on its stdin.
 */
import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { accessSync, constants, readFileSync, statSync } from 'node:fs'
import { delimiter, isAbsolute, join } from 'node:path'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'

const CLI = fileURLToPath(new URL('./cli.js', import.meta.url))
const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
const LIMIT = 8 << 20  // bytes of a request body: a script or a page's answer, never audio
const SESSION = /^\w[\w-]{0,127}$/  // an agent's session id lands in argv: no leading dash, so never a flag
const USAGE = 'audio --bridge [--port 7777] [--key K] [--timeout 30]'
const PREFLIGHT = {
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'content-type, authorization',
  'Access-Control-Allow-Private-Network': 'true',  // Chrome's Private Network Access: a public https page may reach 127.0.0.1
  'Access-Control-Max-Age': '600'
}

// What a chat agent is told besides its own setup: where it is and what the tools touch.
const PROMPT = `You are chatting with the user inside the audio REPL, a browser page where they edit one sound with the audio JS library. The repl_* tools of the MCP server "audio" read and change that sound; the user sees and hears each change at once. Read repl_state first. Prefer repl_edit for one step, repl_script to rewrite, repl_check against a delivery spec, repl_play to let them hear it. Reply briefly: the page shows your words beside the sound.`

const toml = v => JSON.stringify(v)  // a JSON string or array of strings is TOML too

/**
 * Agent CLIs /chat can run, offered when found on PATH. A turn spawns `NAME ...args(mcp, session)`:
 * `mcp` is { command, args } of the MCP server serving the repl_* tools, `session` the id the agent
 * gave on an earlier turn, to continue that conversation. The user's text goes to stdin, never into
 * argv, where a text like `--dangerously-skip-permissions` would read as a flag; `env` adds to its
 * environment. read() makes a parser
 * for one turn: each JSON line the agent prints → chat events, { text } | { tool } | { session } |
 * { done, error? }, or { error } to report should the agent exit without finishing.
 *
 * To add an agent: its headless command, a JSON-lines output, a way to attach an MCP server for one
 * run. Found here but left out for want of one:
 *   gemini    gemini -p … -o stream-json: MCP servers only from settings.json (`gemini mcp add` writes
 *             it for good); --resume takes "latest" or an index, not an id
 *   opencode  opencode run --format json -s ID: MCP servers only from opencode.json
 */
export const AGENTS = {
  // Claude Code: https://code.claude.com/docs/en/headless; stream-json lines carry the session id,
  // token deltas (with --include-partial-messages), whole assistant messages, a closing `result`.
  // Its tool search would defer our ten small tools behind a ToolSearch round trip on every turn.
  claude: {
    env: { ENABLE_TOOL_SEARCH: 'false' },
    args: (mcp, session) => ['-p', '--output-format', 'stream-json', '--verbose', '--include-partial-messages',
      '--mcp-config', JSON.stringify({ mcpServers: { audio: mcp } }), '--strict-mcp-config',
      '--allowedTools', 'mcp__audio__*', '--append-system-prompt', PROMPT, ...(session ? ['--resume', session] : [])],
    read() {
      let streamed = false, said = false
      return m => {
        if (m.parent_tool_use_id) return []  // a subagent's own messages
        let out = m.session_id ? [{ session: m.session_id }] : []
        let e = m.type === 'stream_event' && m.event
        if (e?.type === 'content_block_start' && e.content_block?.type === 'text' && said) out.push({ text: '\n\n' })
        if (e?.type === 'content_block_delta' && e.delta?.type === 'text_delta') streamed = said = true, out.push({ text: e.delta.text })
        if (m.type === 'assistant') for (let b of m.message?.content ?? []) {
          if (b.type === 'tool_use') out.push({ tool: b.name.replace(/^mcp__audio__/, '') })
          else if (b.type === 'text' && !streamed) out.push({ text: (said ? '\n\n' : '') + b.text }), said = true
        }
        if (m.type === 'result') out.push(m.is_error ? { done: true, error: m.errors?.join('\n') || m.result || m.subtype } : { done: true })
        return out
      }
    }
  },
  // Codex: `codex exec --json` prints thread/turn/item events; -c overrides add the MCP server for
  // this run only and approve its tools, which exec has no one to ask about.
  codex: {
    args: (mcp, session) => ['exec', ...(session ? ['resume'] : []), '--json', '--skip-git-repo-check',
      '-c', `mcp_servers.audio.command=${toml(mcp.command)}`, '-c', `mcp_servers.audio.args=${toml(mcp.args)}`,
      '-c', 'mcp_servers.audio.default_tools_approval_mode="approve"', '-c', `developer_instructions=${toml(PROMPT)}`,
      ...(session ? [session] : []), '-'],
    read() {
      let said = false
      return m => {
        let item = m.item ?? {}
        if (m.type === 'thread.started') return [{ session: m.thread_id }]
        if (m.type === 'item.started' && !['agent_message', 'reasoning', 'todo_list', 'error'].includes(item.type)) return [{ tool: item.tool ?? item.type }]
        if (m.type === 'item.completed' && item.type === 'agent_message') {
          let text = (said ? '\n\n' : '') + item.text
          said = true
          return [{ text }]
        }
        if (m.type === 'turn.completed') return [{ done: true }]
        if (m.type === 'turn.failed') return [{ done: true, error: m.error?.message ?? 'turn failed' }]
        if (m.type === 'error') return [{ error: m.message }]  // may be a retry: final only if the agent then exits
        return []
      }
    }
  }
}

/** The executable NAME on PATH, or undefined. Relative PATH entries are skipped: no binary from the cwd. */
function which(name) {
  let exts = process.platform === 'win32' ? (process.env.PATHEXT ?? '.EXE').split(';') : ['']
  for (let dir of (process.env.PATH ?? '').split(delimiter)) if (isAbsolute(dir)) for (let ext of exts) {
    let file = join(dir, name + ext)
    try { if (statSync(file).isFile()) return accessSync(file, constants.X_OK), file } catch {}
  }
}
const found = () => Object.keys(AGENTS).filter(which)

const same = (a, b) => {
  if (typeof a !== 'string') return false
  let x = Buffer.from(a), y = Buffer.from(b)
  return x.length === y.length && timingSafeEqual(x, y)
}

const reply = (res, status, body) => res.headersSent || res.destroyed ? undefined
  : body === undefined ? res.writeHead(status).end()
  : res.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(body))

const fail = (status, message) => Object.assign(new Error(message), { status })

/** A JSON object body, at most LIMIT bytes. */
const body = req => new Promise((resolve, reject) => {
  let chunks = [], size = 0
  req.on('data', c => (size += c.length) <= LIMIT && chunks.push(c))
  req.on('error', reject)
  req.on('end', () => {
    if (size > LIMIT) return reject(fail(413, `Body over ${LIMIT} bytes`))
    let v
    try { v = JSON.parse(Buffer.concat(chunks).toString() || '{}') } catch { return reject(fail(400, 'Body: not JSON')) }
    v?.constructor === Object ? resolve(v) : reject(fail(400, 'Body: a JSON object'))
  })
})

function options(argv) {
  let o = { port: 7777, key: process.env.AUDIO_BRIDGE_KEY || randomBytes(16).toString('hex'), timeout: 30 }
  for (let i = 0; i < argv.length; i += 2) {
    let name = argv[i].replace(/^--/, ''), value = argv[i + 1]
    if (!['port', 'key', 'timeout'].includes(name) || argv[i] === name) throw new Error(`unknown option ${argv[i]}: ${USAGE}`)
    if (value == null) throw new Error(`${argv[i]} needs a value: ${USAGE}`)
    o[name] = name === 'key' ? value : +value
  }
  if (!Number.isInteger(o.port) || o.port < 0 || o.port > 65535) throw new Error('--port: 0..65535, 0 picks a free one')
  if (!(o.timeout > 0)) throw new Error('--timeout: seconds a page has to answer a call, over 0')
  if (!o.key) throw new Error('--key: not empty')
  return o
}

export default function bridge(argv = []) {
  let { port, key, timeout } = options(argv)
  timeout *= 1000
  let url, page = null              // the one connected page's event stream
  let calls = new Map()             // call id → { page, answer([status, body]) }
  let turns = new Map()             // chat turn id → { stop() }
  let send = (to, event) => to?.write(`data: ${JSON.stringify(event)}\n\n`)

  // GET /events: one page at a time; a new one replaces the old, which may still answer the calls it holds.
  function listen(res) {
    if (page) send(page, { type: 'replaced' }), page.end()
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store' })
    page = res
    send(res, { type: 'hello', version, agents: found() })
    let beat = setInterval(() => res.write(':\n\n'), 15000)  // keeps proxies and idle timers from closing it
    res.on('close', () => {
      clearInterval(beat)
      if (page !== res) return
      page = null
      for (let c of calls.values()) if (c.page === res) c.answer([503, { error: 'The REPL page disconnected' }])
    })
  }

  // POST /call: a tool call for the page; holds the request until the page replies, gives up after `timeout`.
  async function call({ tool, args }, res) {
    if (typeof tool !== 'string' || !tool) return reply(res, 400, { error: 'tool: a name, as repl_state' })
    if (!page) return reply(res, 503, { error: 'No REPL page is connected' })
    let id = randomBytes(8).toString('hex'), to = page
    let [status, out] = await new Promise(resolve => {
      let timer = setTimeout(() => resolve([504, { error: `The REPL page did not answer ${tool} within ${timeout / 1000} s` }]), timeout)
      calls.set(id, { page: to, answer: a => { clearTimeout(timer); resolve(a) } })
      res.on('close', () => res.writableFinished || calls.get(id)?.answer([]))  // the caller gave up
      send(to, { type: 'call', id, tool, args: args ?? {} })
    })
    calls.delete(id)
    status && reply(res, status, out)
  }

  // POST /reply: the page's answer to a call.
  function answer({ id, result, error }, res) {
    let c = calls.get(id)
    if (!c) return reply(res, 404, { error: 'No call waits for this id: answered, timed out or given up' })
    c.answer([200, error != null ? { error: String(error.message ?? error) } : { result: result ?? null }])
    reply(res, 204)
  }

  // POST /chat: one agent turn, its output streamed to the page as chat events.
  function chat({ text, agent = 'claude', session }, res) {
    if (typeof text !== 'string' || !text.trim()) return reply(res, 400, { error: 'text: what to tell the agent' })
    if (!Object.hasOwn(AGENTS, agent)) return reply(res, 400, { error: `Unknown agent ${agent}: ${Object.keys(AGENTS).join(', ')}` })
    let bin = which(agent)
    if (!bin) return reply(res, 400, { error: `${agent} is not on PATH` })
    if (session && !(typeof session === 'string' && SESSION.test(session))) return reply(res, 400, { error: 'session: an id the agent gave' })
    if (!page) return reply(res, 503, { error: 'No REPL page is connected' })
    let turn = randomBytes(8).toString('hex')
    run(turn, agent, bin, text, session || undefined)
    reply(res, 202, { turn })
  }

  function run(turn, agent, bin, text, session) {
    let { args, read, env } = AGENTS[agent], parse = read()
    let mcp = { command: process.execPath, args: [CLI, '--mcp', '--repl', url, '--key', key] }
    let child = spawn(bin, args(mcp, session), { stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, ...env } })
    let over = false, said, problem, err = ''
    let emit = e => send(page, { type: 'chat', turn, ...e })
    let end = error => over || (over = true, emit(error ? { done: true, error } : { done: true }))
    turns.set(turn, { stop() { end('Stopped'); child.kill(); setTimeout(() => child.kill('SIGKILL'), 3000).unref() } })
    child.stdin.on('error', () => {})  // an agent may exit before reading
    child.stdin.end(text)
    child.stderr.setEncoding('utf8').on('data', d => err = (err + d).slice(-4000))
    createInterface({ input: child.stdout }).on('line', line => {
      let m
      try { m = JSON.parse(line) } catch { return }
      if (!over) for (let e of parse(m)) {
        if (e.done) return end(e.error)
        if ('error' in e) problem = e.error
        else if (!e.session) emit(e)
        else if (e.session !== said) emit({ session: said = e.session })
      }
    })
    child.on('error', e => end(`${agent}: ${e.message}`))
    child.on('close', (code, signal) => {
      turns.delete(turn)
      end(code === 0 ? problem : problem || err.trim().split('\n').at(-1) || `${agent} exited with ${signal ?? `code ${code}`}`)
    })
  }

  function stop({ turn }, res) {
    let t = turns.get(turn)
    if (!t) return reply(res, 404, { error: 'No such turn running' })
    t.stop()
    reply(res, 204)
  }

  const POST = { '/call': call, '/reply': answer, '/chat': chat, '/chat/stop': stop }

  let server = createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*')
    if (req.method === 'OPTIONS') return res.writeHead(204, PREFLIGHT).end()  // a preflight carries no key
    let { pathname, searchParams } = new URL(req.url, 'http://127.0.0.1')
    let given = searchParams.get('key') ?? req.headers.authorization?.replace(/^Bearer\s+/i, '')
    if (!same(given, key)) return reply(res, 401, { error: 'Wrong or missing key: the one `audio --bridge` printed' })
    try {
      if (req.method === 'GET' && pathname === '/events') return listen(res)
      if (req.method === 'GET' && pathname === '/health') return reply(res, 200, { ok: true, page: !!page, agents: found() })
      if (req.method === 'POST' && Object.hasOwn(POST, pathname)) return await POST[pathname](await body(req), res)
      reply(res, 404, { error: `No ${req.method} ${pathname}` })
    } catch (e) { reply(res, e.status ?? 500, { error: e.message }) }
  })

  let quit = () => { for (let t of turns.values()) t.stop(); process.exit(0) }
  process.on('SIGINT', quit)
  process.on('SIGTERM', quit)

  return new Promise((resolve, reject) => {
    server.once('error', e => reject(e.code === 'EADDRINUSE' ? new Error(`port ${port} is in use, another bridge? Pick one: --port N`) : e))
    server.listen(port, '127.0.0.1', () => {
      url = `http://127.0.0.1:${server.address().port}`
      console.log(`audio bridge on ${url}  key ${key}`)
      resolve(server)
    })
  })
}
