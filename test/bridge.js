// The REPL bridge (bin/bridge.js) over real HTTP on 127.0.0.1, and the MCP server's --repl mode through it:
// a fake page (an SSE client), fake agent CLIs on PATH that print what Claude Code and Codex print.
import test from 'tst'
import { spawn } from 'child_process'
import { request } from 'http'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { dirname, join } from 'path'
import { createInterface } from 'readline'
import { fileURLToPath } from 'url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const bin = join(root, 'bin', 'cli.js')
const KEY = 'a1b2c3d4e5f60718293a4b5c6d7e8f90'
const CLAUDE_SESSION = '78183f40-d639-4a3d-982f-0e9c0f3c9f69', CODEX_THREAD = '0199a213-81c0-7800-8aa1-bbab2a035a53'
const sleep = ms => new Promise(r => setTimeout(r, ms))

// Fake agents: log argv and stdin, then print the lines the real CLI prints. Claude Code's are as
// `claude -p --output-format stream-json --verbose --include-partial-messages` printed them (2.1.284);
// Codex's are the `codex exec --json` events (thread.started, item.*, turn.*). The text picks the case.
const dir = mkdtempSync(join(tmpdir(), 'audio-bridge-')), fakes = join(dir, 'bin'), logs = join(dir, 'log')
mkdirSync(fakes), mkdirSync(logs), mkdirSync(join(dir, 'empty'))
process.on('exit', () => rmSync(dir, { recursive: true, force: true }))
const FAKE = `#!${process.execPath}
const fs = require('fs'), name = require('path').basename(process.argv[1]), input = fs.readFileSync(0, 'utf8')
fs.writeFileSync(${JSON.stringify(logs)} + '/' + name + '.json', JSON.stringify({ argv: process.argv.slice(2), input, toolSearch: process.env.ENABLE_TOOL_SEARCH }))
const print = lines => lines.forEach(l => process.stdout.write(JSON.stringify(l) + '\\n'))
const S = ${JSON.stringify(CLAUDE_SESSION)}, T = ${JSON.stringify(CODEX_THREAD)}
const ev = event => ({ type: 'stream_event', event, session_id: S, parent_tool_use_id: null })
const say = text => [ev({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }),
  ev({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } }),
  { type: 'assistant', message: { content: [{ type: 'text', text }] }, parent_tool_use_id: null, session_id: S }]
if (input === 'hang') setInterval(() => {}, 1000)
else if (input === 'crash') process.stderr.write('warming up\\nboom: no credit\\n'), process.exit(3)
else if (name === 'claude') print([
  { type: 'system', subtype: 'hook_started', session_id: S },
  { type: 'system', subtype: 'init', session_id: S, mcp_servers: [{ name: 'audio', status: 'connected' }] },
  ev({ type: 'message_start' }),
  ev({ type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '' } }),
  ev({ type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'hm' } }),
  { type: 'assistant', message: { content: [{ type: 'thinking', thinking: 'hm' }] }, parent_tool_use_id: null, session_id: S },
  ev({ type: 'content_block_start', index: 1, content_block: { type: 'text', text: '' } }),
  ev({ type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'Reading ' } }),
  ev({ type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'the sound.' } }),
  { type: 'assistant', message: { content: [{ type: 'text', text: 'Reading the sound.' }] }, parent_tool_use_id: null, session_id: S },
  ev({ type: 'content_block_start', index: 2, content_block: { type: 'tool_use', id: 'toolu_1', name: 'mcp__audio__repl_state', input: {} } }),
  { type: 'assistant', message: { content: [{ type: 'tool_use', id: 'toolu_1', name: 'mcp__audio__repl_state', input: {} }] }, parent_tool_use_id: null, session_id: S },
  { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: '{"duration":3}' }] }, parent_tool_use_id: null, session_id: S },
  { type: 'assistant', message: { content: [{ type: 'text', text: 'a subagent speaks' }] }, parent_tool_use_id: 'toolu_9', session_id: S },
  ...(input === 'fail' ? [{ type: 'result', subtype: 'error_during_execution', is_error: true, errors: ['API Error: 529 overloaded'], session_id: S }]
    : [...say('It is 3 s long.'), { type: 'result', subtype: 'success', is_error: false, result: 'It is 3 s long.', session_id: S }])
])
else print([
  { type: 'thread.started', thread_id: T },
  { type: 'turn.started' },
  { type: 'item.completed', item: { id: 'item_0', type: 'reasoning', text: 'thinking' } },
  { type: 'item.started', item: { id: 'item_1', type: 'mcp_tool_call', server: 'audio', tool: 'repl_state', arguments: {}, status: 'in_progress' } },
  { type: 'item.completed', item: { id: 'item_1', type: 'mcp_tool_call', server: 'audio', tool: 'repl_state', arguments: {}, status: 'completed' } },
  { type: 'error', message: 'Reconnecting... 1/5' },
  ...(input === 'fail' ? [{ type: 'turn.failed', error: { message: 'usage limit reached' } }] : [
    { type: 'item.completed', item: { id: 'item_2', type: 'agent_message', text: 'It is 3 s long.' } },
    { type: 'item.completed', item: { id: 'item_3', type: 'agent_message', text: 'Anything else?' } },
    { type: 'turn.completed', usage: { input_tokens: 10, output_tokens: 5 } }])
])
`
for (let name of ['claude', 'codex']) writeFileSync(join(fakes, name), FAKE), chmodSync(join(fakes, name), 0o755)
const logged = name => JSON.parse(readFileSync(join(logs, name + '.json'), 'utf8'))

/** `audio --bridge` as a user runs it, on a free port, the fakes alone on PATH. */
async function bridge(flags = ['--key', KEY], env = {}) {
  let proc = spawn(process.execPath, [bin, '--bridge', '--port', '0', ...flags], { env: { ...process.env, AUDIO_BRIDGE_KEY: '', PATH: fakes, ...env }, stdio: ['ignore', 'pipe', 'inherit'] })
  let line = await new Promise((resolve, reject) => {
    createInterface({ input: proc.stdout }).once('line', resolve)
    proc.once('exit', code => reject(new Error(`bridge exited ${code}`)))
  })
  return { line, url: line.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0], close: () => new Promise(r => { proc.once('close', r); proc.kill() }) }
}

/** A REPL page: its event stream, each `data:` line parsed; next(pred) takes the first unread event that matches. */
function page(url, key = KEY) {
  let events = [], waiters = [], status, ended
  let done = new Promise(r => ended = r)
  let push = e => { let w = waiters.find(w => w.pred(e)); w ? (waiters.splice(waiters.indexOf(w), 1), w.resolve(e)) : events.push(e) }
  let req = request(`${url}/events?key=${key}`, res => {
    status = res.statusCode
    let buf = ''
    res.setEncoding('utf8').on('data', d => {
      let parts = (buf += d).split('\n\n')
      buf = parts.pop()
      for (let part of parts) for (let line of part.split('\n')) if (line.startsWith('data: ')) push(JSON.parse(line.slice(6)))
    })
    res.on('end', ended)
  })
  req.on('error', () => ended())
  req.end()
  return {
    get status() { return status }, ended: done, events,
    next: (pred = () => true, ms = 5000) => {
      let i = events.findIndex(pred)
      if (i >= 0) return Promise.resolve(events.splice(i, 1)[0])
      return new Promise((resolve, reject) => {
        let w = { pred, resolve: e => { clearTimeout(timer); resolve(e) } }, timer = setTimeout(() => { waiters.splice(waiters.indexOf(w), 1); reject(new Error(`no event in ${ms} ms; unread: ${JSON.stringify(events)}`)) }, ms)
        waiters.push(w)
      })
    },
    close: () => req.destroy()
  }
}

async function post(url, path, body, key = KEY) {
  let res = await fetch(`${url}${path}?key=${key}`, { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body) })
  return { status: res.status, body: res.status === 204 ? null : await res.json() }
}
const health = async url => (await fetch(`${url}/health?key=${KEY}`)).json()
const until = async (cond, ms = 3000) => { for (let t = Date.now(); !(await cond()); await sleep(20)) if (Date.now() - t > ms) throw new Error('timed out') }

/** One chat turn: POST /chat, then its events through done, turn and type stripped. */
async function chat(p, url, body) {
  let r = await post(url, '/chat', body)
  if (r.status !== 202) throw new Error(JSON.stringify(r))
  let events = []
  for (;;) {
    let { type, turn, ...e } = await p.next(e => e.type === 'chat' && e.turn === r.body.turn)
    events.push(e)
    if (e.done) return events
  }
}

/** `audio --mcp ARGS` and a minimal client over its stdio. */
function mcp(args, env = {}) {
  let proc = spawn(process.execPath, [bin, '--mcp', ...args], { cwd: root, env: { ...process.env, AUDIO_BRIDGE_KEY: '', ...env }, stdio: ['pipe', 'pipe', 'pipe'] })
  let pending = new Map(), id = 0, err = ''
  proc.stderr.setEncoding('utf8').on('data', d => err += d)
  createInterface({ input: proc.stdout }).on('line', line => { let m = JSON.parse(line); pending.get(m.id)?.(m); pending.delete(m.id) })
  let write = m => proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', ...m }) + '\n')
  return {
    request: (method, params) => new Promise(r => { let i = ++id; pending.set(i, r); write({ id: i, method, params }) }),
    get id() { return id },
    notify: (method, params) => write({ method, params }),
    exit: new Promise(r => proc.once('close', code => r({ code, err }))),
    close: () => { proc.stdin.end(); return new Promise(r => proc.exitCode != null ? r() : proc.once('close', r)) }
  }
}
const REPL_TOOLS = ['repl_state', 'repl_script', 'repl_edit', 'repl_select', 'repl_play', 'repl_stop', 'repl_check', 'repl_undo', 'repl_redo']


test('bridge: prints its address and key; a random 128-bit key unless given, or from AUDIO_BRIDGE_KEY', async t => {
  let a = await bridge([]), b = await bridge([], { AUDIO_BRIDGE_KEY: 'from-env' }), c = await bridge()
  try {
    t.ok(/^audio bridge on http:\/\/127\.0\.0\.1:\d+ {2}key [0-9a-f]{32}$/.test(a.line), a.line)
    t.ok(b.line.endsWith('  key from-env'), b.line)
    t.ok(c.line.endsWith(`  key ${KEY}`), c.line)
    t.is((await fetch(`${a.url}/health?key=${a.line.split('key ')[1]}`)).status, 200, 'the printed key opens it')
  } finally { await a.close(); await b.close(); await c.close() }
})

test('bridge: bad options fail with usage', async t => {
  for (let flags of [['--port', 'x'], ['--nope', '1'], ['--timeout', '0'], ['--key']]) {
    let proc = spawn(process.execPath, [bin, '--bridge', ...flags], { stdio: ['ignore', 'ignore', 'pipe'] }), err = ''
    proc.stderr.setEncoding('utf8').on('data', d => err += d)
    let code = await new Promise(r => proc.on('close', r))
    t.is(code, 1, flags.join(' '))
    t.ok(err.startsWith('audio: '), err)
  }
})

test('bridge: the key on every endpoint, by query or bearer; CORS for any origin, preflight with private network', async t => {
  let b = await bridge()
  try {
    for (let [method, path] of [['GET', '/health'], ['GET', '/events'], ['POST', '/call'], ['POST', '/reply'], ['POST', '/chat'], ['POST', '/chat/stop'], ['GET', '/nope']]) {
      let r = await fetch(b.url + path, { method })
      t.is(r.status, 401, `${method} ${path} without key`)
      t.is(r.headers.get('access-control-allow-origin'), '*', '401 readable cross-origin')
    }
    t.is((await fetch(`${b.url}/health?key=wrong`)).status, 401, 'wrong key')
    t.is((await fetch(`${b.url}/health?key=${KEY}x`)).status, 401, 'longer key')
    t.is((await fetch(`${b.url}/health`, { headers: { authorization: `Bearer ${KEY}` } })).status, 200, 'bearer')
    t.is((await fetch(`${b.url}/nope?key=${KEY}`)).status, 404, 'unknown path with key')
    t.is((await post(b.url, '/call', 'not json')).status, 400, 'body not JSON')

    let pre = await fetch(`${b.url}/call`, { method: 'OPTIONS', headers: { origin: 'https://audiojs.dev', 'access-control-request-method': 'POST', 'access-control-request-headers': 'content-type, authorization', 'access-control-request-private-network': 'true' } })
    t.is(pre.status, 204, 'preflight needs no key')
    t.is(pre.headers.get('access-control-allow-origin'), '*')
    t.is(pre.headers.get('access-control-allow-methods'), 'GET, POST, OPTIONS')
    t.is(pre.headers.get('access-control-allow-headers'), 'content-type, authorization')
    t.is(pre.headers.get('access-control-allow-private-network'), 'true')
  } finally { await b.close() }
})

test('bridge: a page gets hello, answers a call; /call round-trips result and error', async t => {
  let b = await bridge(), p
  try {
    t.is(await health(b.url), { ok: true, page: false, agents: ['claude', 'codex'] }, 'health before a page; fakes on PATH')
    p = page(b.url)
    let { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
    t.is(await p.next(), { type: 'hello', version, agents: ['claude', 'codex'] })
    t.is(p.status, 200)
    t.is((await health(b.url)).page, true)

    let pending = post(b.url, '/call', { tool: 'repl_select', args: { at: 1, d: 0.5 } })
    let call = await p.next(e => e.type === 'call')
    t.is(call.tool, 'repl_select')
    t.is(call.args, { at: 1, d: 0.5 })
    t.ok(typeof call.id === 'string' && call.id, 'string id')
    t.is(await post(b.url, '/reply', { id: call.id, result: { ok: true } }), { status: 204, body: null })
    t.is(await pending, { status: 200, body: { result: { ok: true } } })

    pending = post(b.url, '/call', { tool: 'repl_edit', args: { call: 'nope(' } })
    call = await p.next(e => e.type === 'call')
    await post(b.url, '/reply', { id: call.id, error: 'SyntaxError: Unexpected end of input' })
    t.is(await pending, { status: 200, body: { error: 'SyntaxError: Unexpected end of input' } })

    pending = post(b.url, '/call', { tool: 'repl_stop' })
    call = await p.next(e => e.type === 'call')
    t.is(call.args, {}, 'args default to {}')
    await post(b.url, '/reply', { id: call.id })
    t.is((await pending).body, { result: null }, 'no result is null')

    t.is((await post(b.url, '/reply', { id: call.id, result: 1 })).status, 404, 'a second answer finds no call')
    t.is((await post(b.url, '/call', {})).status, 400, 'a call names its tool')
  } finally { p?.close(); await b.close() }
})

test('bridge: no page → 503; a page that leaves fails its calls at once', async t => {
  let b = await bridge()
  try {
    t.is(await post(b.url, '/call', { tool: 'repl_state' }), { status: 503, body: { error: 'No REPL page is connected' } })
    let p = page(b.url)
    await p.next()
    let pending = post(b.url, '/call', { tool: 'repl_state' })
    await p.next(e => e.type === 'call')
    let t0 = Date.now()
    p.close()
    t.is(await pending, { status: 503, body: { error: 'The REPL page disconnected' } })
    t.ok(Date.now() - t0 < 1000, 'not after the timeout')
    await until(async () => !(await health(b.url)).page)
  } finally { await b.close() }
})

test('bridge: a second page replaces the first, which still answers what it holds', async t => {
  let b = await bridge(), p1 = page(b.url), p2
  try {
    await p1.next()
    let held = post(b.url, '/call', { tool: 'repl_state' })
    let call1 = await p1.next(e => e.type === 'call')
    p2 = page(b.url)
    t.is((await p2.next()).type, 'hello')
    t.is(await p1.next(), { type: 'replaced' })
    await p1.ended
    t.ok(true, 'the old stream ends')

    await post(b.url, '/reply', { id: call1.id, result: 'from the first' })
    t.is((await held).body, { result: 'from the first' }, 'the replaced page answered its call')

    let pending = post(b.url, '/call', { tool: 'repl_undo' })
    let call2 = await p2.next(e => e.type === 'call')
    t.is(call2.tool, 'repl_undo', 'new calls go to the new page')
    await post(b.url, '/reply', { id: call2.id, result: { ok: true } })
    t.is((await pending).body, { result: { ok: true } })
    t.is(p1.events.length, 0, 'nothing more reached the first')
    t.is((await health(b.url)).page, true)
  } finally { p1.close(); p2?.close(); await b.close() }
})

test('bridge: a call the page does not answer times out with 504', async t => {
  let b = await bridge(['--key', KEY, '--timeout', '0.2']), p = page(b.url)
  try {
    await p.next()
    let t0 = Date.now()
    let r = await post(b.url, '/call', { tool: 'repl_script', args: { code: 'x' } })
    t.is(r.status, 504)
    t.ok(r.body.error.includes('did not answer repl_script within 0.2 s'), r.body.error)
    t.ok(Date.now() - t0 < 2000, `${Date.now() - t0} ms`)
    let call = await p.next(e => e.type === 'call')
    t.is((await post(b.url, '/reply', { id: call.id, result: 1 })).status, 404, 'a late answer finds no call')
  } finally { p.close(); await b.close() }
})

test('mcp --repl: lists the repl tools; a call goes through the bridge to the page and back', { timeout: 30000 }, async t => {
  let b = await bridge(), p = page(b.url), c = mcp(['--repl', b.url, '--key', KEY])
  try {
    await p.next()
    let { result } = await c.request('tools/list')
    t.is(result.tools.map(x => x.name), ['audio', ...REPL_TOOLS])
    for (let tool of result.tools) {
      t.ok(tool.description.length <= 2048, `${tool.name} ${tool.description.length} ≤ 2048 chars`)
      t.ok(!tool.description.includes('\u2014'), `${tool.name}: no em dash`)
      t.is(tool.inputSchema.type, 'object')
    }
    let tool = name => result.tools.find(x => x.name === name)
    t.is(tool('repl_script').inputSchema.required, ['code'])
    t.is(tool('repl_edit').inputSchema.required, ['call'])
    t.is(tool('repl_check').inputSchema.required, ['spec'])
    t.ok(tool('repl_state').annotations.readOnlyHint, 'state reads only')
    t.ok(/\bd = duration\b/.test(tool('repl_script').description) && /xfade = crossfade/.test(tool('repl_script').description), 'aliases taught')

    let pending = c.request('tools/call', { name: 'repl_state', arguments: {} })
    let call = await p.next(e => e.type === 'call')
    t.is([call.tool, call.args], ['repl_state', {}])
    let state = { script: "audio('voice.wav')", duration: 3, sampleRate: 48000, channels: 1, selection: null, cursor: 0, markers: [], stats: { peak: -1, loudness: -20 }, problem: null }
    await post(b.url, '/reply', { id: call.id, result: state })
    let r = (await pending).result
    t.is(r.isError, false)
    t.is(JSON.parse(r.content[0].text), state, 'the page state as JSON text')

    pending = c.request('tools/call', { name: 'repl_edit', arguments: { call: "normalize('podcast')" } })
    call = await p.next(e => e.type === 'call')
    t.is(call.args, { call: "normalize('podcast')" })
    await post(b.url, '/reply', { id: call.id, error: 'normalize: unknown preset' })
    r = (await pending).result
    t.is(r.isError, true)
    t.is(r.content[0].text, 'repl_edit: normalize: unknown preset')

    pending = c.request('tools/call', { name: 'repl_undo' })
    call = await p.next(e => e.type === 'call')
    await post(b.url, '/reply', { id: call.id })
    t.is((await pending).result.content[0].text, 'done', 'no result reads done')

    // Cancelled: the fetch is dropped, no response goes out, the server stays responsive
    let answered = false
    c.request('tools/call', { name: 'repl_play', arguments: { at: 1 } }).then(() => answered = true)
    call = await p.next(e => e.type === 'call')
    c.notify('notifications/cancelled', { requestId: c.id, reason: 'test' })
    t.ok((await c.request('ping')).result, 'responsive after cancel')
    await sleep(100)
    t.is((await post(b.url, '/reply', { id: call.id, result: 1 })).status, 404, 'the bridge dropped the abandoned call')
    await sleep(100)
    t.ok(!answered, 'no response for the cancelled request')
  } finally { await c.close(); p.close(); await b.close() }
})

test('mcp --repl: no page, no bridge, wrong key come back as tool errors that say what to do', { timeout: 30000 }, async t => {
  let b = await bridge()
  let calls = async (c, name = 'repl_state') => (await c.request('tools/call', { name, arguments: {} })).result
  let c1 = mcp(['--repl', b.url, '--key', KEY]), c2 = mcp(['--repl', 'http://127.0.0.1:9', '--key', KEY]), c3 = mcp(['--repl', b.url, '--key', 'wrong'])
  let c4 = mcp(['--repl', b.url], { AUDIO_BRIDGE_KEY: KEY })
  try {
    let r = await calls(c1)
    t.is([r.isError, r.content[0].text], [true, 'repl_state: No REPL page is connected'])
    r = await calls(c2)
    t.is(r.isError, true)
    t.ok(r.content[0].text.includes('no bridge at http://127.0.0.1:9') && r.content[0].text.includes('audio --bridge'), r.content[0].text)
    r = await calls(c3)
    t.is(r.isError, true)
    t.ok(r.content[0].text.includes('key'), r.content[0].text)
    r = await calls(c4)
    t.is(r.content[0].text, 'repl_state: No REPL page is connected', 'key from AUDIO_BRIDGE_KEY')
    let plain = mcp([])
    t.is((await plain.request('tools/list')).result.tools.length, 1, 'without --repl, the audio tool alone')
    t.is((await plain.request('tools/call', { name: 'repl_state', arguments: {} })).error.code, -32602, 'repl tools unknown without --repl')
    await plain.close()
  } finally { await Promise.all([c1, c2, c3, c4].map(c => c.close())); await b.close() }
  let nokey = mcp(['--repl', 'http://127.0.0.1:7777'])
  let { code, err } = await nokey.exit
  t.is(code, 1, 'no key: refuses to start')
  t.ok(err.includes('--key'), err)
})

test('bridge chat: claude streams text, tool, session, done in order; the text on stdin, never in argv', { timeout: 15000 }, async t => {
  let b = await bridge(), p = page(b.url)
  try {
    await p.next()
    let text = '--dangerously-skip-permissions how long is it?'
    let events = await chat(p, b.url, { text })
    t.is(events, [
      { session: CLAUDE_SESSION },
      { text: 'Reading ' }, { text: 'the sound.' },
      { tool: 'repl_state' },
      { text: '\n\n' }, { text: 'It is 3 s long.' },
      { done: true }
    ])
    let { argv, input, toolSearch } = logged('claude')
    t.is(input, text, 'the text arrives on stdin')
    t.is(toolSearch, 'false', 'tools load up front, no ToolSearch round trip')
    t.ok(!argv.includes(text), 'and nowhere in argv')
    for (let flag of ['-p', '--verbose', '--include-partial-messages', '--strict-mcp-config']) t.ok(argv.includes(flag), flag)
    t.is(argv[argv.indexOf('--output-format') + 1], 'stream-json')
    t.is(argv[argv.indexOf('--allowedTools') + 1], 'mcp__audio__*')
    t.ok(!argv.includes('--resume'), 'a new conversation')
    let { mcpServers } = JSON.parse(argv[argv.indexOf('--mcp-config') + 1])
    t.is(mcpServers.audio, { command: process.execPath, args: [bin, '--mcp', '--repl', b.url, '--key', KEY] }, 'this repo\'s MCP server, absolute paths')

    await chat(p, b.url, { text: 'and now?', agent: 'claude', session: CLAUDE_SESSION })
    argv = logged('claude').argv
    t.is(argv[argv.indexOf('--resume') + 1], CLAUDE_SESSION, 'continues the session')

    t.is((await chat(p, b.url, { text: 'fail' })).at(-1), { done: true, error: 'API Error: 529 overloaded' })
    t.is((await chat(p, b.url, { text: 'crash' })).at(-1), { done: true, error: 'boom: no credit' }, 'exit without a result: the last stderr line')
  } finally { p.close(); await b.close() }
})

test('bridge chat: codex events and its exec command line', { timeout: 15000 }, async t => {
  let b = await bridge(), p = page(b.url)
  try {
    await p.next()
    let events = await chat(p, b.url, { text: 'how long?', agent: 'codex' })
    t.is(events, [{ session: CODEX_THREAD }, { tool: 'repl_state' }, { text: 'It is 3 s long.' }, { text: '\n\nAnything else?' }, { done: true }])
    let { argv, input } = logged('codex')
    t.is(input, 'how long?')
    t.is(argv.slice(0, 3), ['exec', '--json', '--skip-git-repo-check'])
    t.is(argv.at(-1), '-', 'the prompt from stdin')
    t.ok(argv.includes(`mcp_servers.audio.command=${JSON.stringify(process.execPath)}`), 'node, absolute')
    t.ok(argv.includes(`mcp_servers.audio.args=${JSON.stringify([bin, '--mcp', '--repl', b.url, '--key', KEY])}`), 'the MCP server args as a TOML array')

    await chat(p, b.url, { text: 'more', agent: 'codex', session: CODEX_THREAD })
    argv = logged('codex').argv
    t.is(argv.slice(0, 2), ['exec', 'resume'])
    t.is(argv.slice(-2), [CODEX_THREAD, '-'])

    t.is((await chat(p, b.url, { text: 'fail', agent: 'codex' })).at(-1), { done: true, error: 'usage limit reached' })
  } finally { p.close(); await b.close() }
})

test('bridge chat: stop kills the turn; bad requests are refused before anything runs', { timeout: 15000 }, async t => {
  let b = await bridge(), p = page(b.url)
  try {
    await p.next()
    let r = await post(b.url, '/chat', { text: 'hang' })
    t.is(r.status, 202)
    let t0 = Date.now()
    t.is(await post(b.url, '/chat/stop', { turn: r.body.turn }), { status: 204, body: null })
    t.is(await p.next(e => e.turn === r.body.turn), { type: 'chat', turn: r.body.turn, done: true, error: 'Stopped' })
    t.ok(Date.now() - t0 < 1000, 'at once')
    await sleep(200)
    t.is((await post(b.url, '/chat/stop', { turn: r.body.turn })).status, 404, 'gone once killed')
    t.is(p.events.filter(e => e.turn === r.body.turn).length, 0, 'nothing after done')

    let bad = async body => (await post(b.url, '/chat', body))
    t.is((await bad({})).status, 400, 'no text')
    t.is((await bad({ text: '  ' })).status, 400, 'blank text')
    t.is((await bad({ text: 'hi', agent: 'rm' })).status, 400, 'unknown agent')
    t.is((await bad({ text: 'hi', agent: '__proto__' })).status, 400, 'not a registry key')
    t.is((await bad({ text: 'hi', session: '--dangerously-skip-permissions' })).status, 400, 'a session id is never a flag')
    t.is((await bad({ text: 'hi', session: 5 })).status, 400, 'a session id is a string')
  } finally { p.close(); await b.close() }

  let none = await bridge(['--key', KEY], { PATH: join(dir, 'empty') }), q = page(none.url)
  try {
    t.is((await q.next()).agents, [], 'no agents on PATH')
    t.is(await post(none.url, '/chat', { text: 'hi' }), { status: 400, body: { error: 'claude is not on PATH' } })
    q.close()
    await until(async () => !(await health(none.url)).page)
    t.is((await post(none.url, '/chat', { text: 'hi', agent: 'claude' })).status, 400, 'agent checked first')
  } finally { await none.close() }
  let lone = await bridge()
  try { t.is(await post(lone.url, '/chat', { text: 'hi' }), { status: 503, body: { error: 'No REPL page is connected' } }) }
  finally { await lone.close() }
})
