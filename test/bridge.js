// The editor's bridge (bin/bridge.js) over real HTTP on 127.0.0.1, and the MCP server's --editor mode through it:
// a fake page (an SSE client), fake agent CLIs on PATH that print what Claude Code, Codex and Pi print, and one that
// speaks ACP as Kimi Code, Gemini CLI and the others do.
import test from 'tst'
import { spawn } from 'child_process'
import { request } from 'http'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'fs'
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
const dir = mkdtempSync(join(tmpdir(), 'audio-bridge-')), fakes = join(dir, 'bin'), logs = join(dir, 'log'), config = join(dir, 'config')
mkdirSync(fakes), mkdirSync(logs), mkdirSync(join(dir, 'empty'))
process.env.XDG_CONFIG_HOME = config  // where the bridges here keep their address and key, bin/pi.js imported here finds them
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
// a session it does not hold, as each says so: Claude Code a result naming it, Codex its stderr alone
else if (process.argv.includes('gone')) name === 'claude'
  ? (print([{ type: 'result', subtype: 'error_during_execution', is_error: true, num_turns: 0, session_id: 'gone', errors: ['No conversation found with session ID: gone'] }]), process.exit(1))
  : (process.stderr.write('Error: thread/resume: thread/resume failed: no rollout found for thread id gone (code -32600)\\n'), process.exit(1))
// a call the tool refused, as each reports it
else if (input === 'refused') print(name === 'claude' ? [
  { type: 'system', subtype: 'init', session_id: S },
  { type: 'assistant', message: { content: [{ type: 'tool_use', id: 't', name: 'mcp__audio__edit', input: { call: 'nope()' } }] }, parent_tool_use_id: null, session_id: S },
  { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't', content: 'edit: no nope', is_error: true }] }, parent_tool_use_id: null, session_id: S },
  { type: 'result', subtype: 'success', is_error: false, result: '', session_id: S }
] : [
  { type: 'thread.started', thread_id: T },
  { type: 'item.started', item: { id: 'i', type: 'mcp_tool_call', server: 'audio', tool: 'edit', arguments: { call: 'nope()' }, status: 'in_progress' } },
  { type: 'item.completed', item: { id: 'i', type: 'mcp_tool_call', server: 'audio', tool: 'edit', arguments: { call: 'nope()' }, status: 'failed' } },
  { type: 'turn.completed' }
])
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
  ev({ type: 'content_block_start', index: 2, content_block: { type: 'tool_use', id: 'toolu_1', name: 'mcp__audio__state', input: {} } }),
  { type: 'assistant', message: { content: [{ type: 'tool_use', id: 'toolu_1', name: 'mcp__audio__state', input: {} }] }, parent_tool_use_id: null, session_id: S },
  { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: '{"duration":3}' }] }, parent_tool_use_id: null, session_id: S },
  { type: 'assistant', message: { content: [{ type: 'text', text: 'a subagent speaks' }] }, parent_tool_use_id: 'toolu_9', session_id: S },
  ...(input === 'fail' ? [{ type: 'result', subtype: 'error_during_execution', is_error: true, errors: ['API Error: 529 overloaded'], session_id: S }]
    : [...say('It is 3 s long.'), { type: 'result', subtype: 'success', is_error: false, result: 'It is 3 s long.', session_id: S }])
])
else print([
  { type: 'thread.started', thread_id: T },
  { type: 'turn.started' },
  { type: 'item.completed', item: { id: 'item_0', type: 'reasoning', text: 'thinking' } },
  { type: 'item.started', item: { id: 'item_1', type: 'mcp_tool_call', server: 'audio', tool: 'state', arguments: {}, status: 'in_progress' } },
  { type: 'item.completed', item: { id: 'item_1', type: 'mcp_tool_call', server: 'audio', tool: 'state', arguments: {}, status: 'completed' } },
  { type: 'item.started', item: { id: 'item_9', type: 'mcp_tool_call', server: 'files', tool: 'edit', arguments: { path: 'a' }, status: 'in_progress' } },
  { type: 'item.completed', item: { id: 'item_9', type: 'mcp_tool_call', server: 'files', tool: 'edit', arguments: { path: 'a' }, status: 'completed' } },
  { type: 'error', message: 'Reconnecting... 1/5' },
  ...(input === 'fail' ? [{ type: 'turn.failed', error: { message: 'usage limit reached' } }]
    // a model the account may not use: OpenAI's error body whole, as Codex 0.156 prints it
    : input === 'model' ? [{ type: 'turn.failed', error: { message: JSON.stringify({ type: 'error', status: 400, error: { type: 'invalid_request_error', message: "The 'gpt-6.1-sol' model is not supported when using Codex with a ChatGPT account." } }) } }] : [
    { type: 'item.completed', item: { id: 'item_2', type: 'agent_message', text: 'It is 3 s long.' } },
    { type: 'item.completed', item: { id: 'item_3', type: 'agent_message', text: 'Anything else?' } },
    { type: 'turn.completed', usage: { input_tokens: 10, output_tokens: 5 } }])
])
`
for (let name of ['claude', 'codex']) writeFileSync(join(fakes, name), FAKE), chmodSync(join(fakes, name), 0o755)
const logged = name => JSON.parse(readFileSync(join(logs, name + '.json'), 'utf8'))

// Pi: its session, then its events, as `pi --mode json` prints them (0.87, docs/json.md); a failed run says so in its
// last assistant message and exits 0. A text delta holds U+2028, where readline would split the line.
const PI_SESSION = '0199e1a2-4e66-7269-9585-5048be4b749f'
const FAKE_PI = `#!${process.execPath}
const fs = require('fs'), input = fs.readFileSync(0, 'utf8'), argv = process.argv.slice(2), at = argv.indexOf('--session')
fs.writeFileSync(${JSON.stringify(logs)} + '/pi.json', JSON.stringify({ argv, input, editor: process.env.AUDIO_EDITOR, key: process.env.AUDIO_BRIDGE_KEY }))
if (argv[at + 1] === 'gone' && at >= 0) process.stderr.write("No session found matching 'gone'\\n"), process.exit(1)
const print = lines => lines.forEach(l => process.stdout.write(JSON.stringify(l) + '\\n'))
const delta = (type, more) => ({ type: 'message_update', usage: {}, assistantMessageEvent: { type, contentIndex: 0, ...more } })
const end = (stopReason, errorMessage) => ({ type: 'message_end', message: { role: 'assistant', content: [], stopReason, ...errorMessage && { errorMessage } } })
print([
  { type: 'session', version: 3, id: ${JSON.stringify(PI_SESSION)}, timestamp: '2026-10-03T02:58:56.232Z', cwd: '/x' },
  { type: 'agent_start' }, { type: 'turn_start' },
  ...input === 'fail' ? [end('error', '400: {"message":"registry.ollama.ai/library/dolphin3:latest does not support tools","type":"invalid_request_error"}')] : [
    delta('thinking_start'), delta('thinking_delta', { delta: 'hm' }), delta('thinking_end', { content: 'hm' }),
    delta('text_start'), delta('text_delta', { delta: 'Reading ' }), delta('text_delta', { delta: 'the sound\\u2028.' }), delta('text_end', { content: 'Reading the sound.' }),
    delta('toolcall_start', { id: 'call_1', toolName: 'state' }), end('toolUse'),
    { type: 'tool_execution_start', toolCallId: 'call_1', toolName: 'state', args: {} },
    { type: 'tool_execution_end', toolCallId: 'call_1', toolName: 'state', result: { content: [{ type: 'text', text: '{}' }] }, isError: false },
    { type: 'turn_end' }, { type: 'turn_start' },
    delta('text_start'), delta('text_delta', { delta: 'It is 3 s long.' }), end('stop')],
  { type: 'agent_end', messages: [], willRetry: false }, { type: 'agent_settled' }
])
`
writeFileSync(join(fakes, 'pi'), FAKE_PI), chmodSync(join(fakes, 'pi'), 0o755)

// An ACP agent, JSON-RPC on its stdio, as Kimi Code (which goes on by session/resume) and Gemini CLI (session/load, its
// replay) speak it: each message it gets logged, a line each. A turn says, thinks, calls the editor's tools as agents
// title an MCP tool (asking leave for one), calls its own shell (asking leave), asks to read a file of the client's.
const FAKE_ACP = `#!${process.execPath}
const fs = require('fs'), name = require('path').basename(process.argv[1]), log = ${JSON.stringify(logs)} + '/' + name + '.jsonl'
fs.writeFileSync(log, JSON.stringify({ argv: process.argv.slice(2), editor: process.env.AUDIO_EDITOR }) + '\\n')
const out = m => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...m }) + '\\n')
const update = (sessionId, update) => out({ method: 'session/update', params: { sessionId, update } })
const waiting = new Map(), ask = (method, params) => new Promise(r => { let id = 'a' + waiting.size; waiting.set(id, r); out({ id, method, params }) })
const can = name === 'kimi' ? { loadSession: true, sessionCapabilities: { resume: {} } } : { loadSession: true }
let rest = ''
process.stdin.setEncoding('utf8').on('data', d => { let all = (rest + d).split('\\n'); rest = all.pop(); for (let l of all) if (l) on(JSON.parse(l)) })
async function on(m) {
  fs.appendFileSync(log, JSON.stringify(m) + '\\n')
  if (m.method == null) return waiting.get(m.id)?.(m)
  let { id, method, params } = m
  if (method === 'initialize') return out({ id, result: { protocolVersion: 1, agentCapabilities: can, authMethods: [] } })
  // its models, as ACP's session models say them; one set by session/set_model
  if (method === 'session/new') return out({ id, result: { sessionId: 'sess-1', models: { availableModels: [{ modelId: 'k2', name: 'K2' }, { modelId: 'k2-think', name: 'K2 Thinking' }], currentModelId: 'k2' } } })
  if (method === 'session/set_model') return out({ id, result: {} })
  if (method === 'session/resume' || method === 'session/load') {
    if (params.sessionId === 'gone') return out({ id, error: { code: -32002, message: 'Resource not found: gone' } })
    if (method === 'session/load') update(params.sessionId, { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'said before' } })
    return out({ id, result: {} })
  }
  if (method !== 'session/prompt') return out({ id, error: { code: -32601, message: 'Method not found' } })
  const s = params.sessionId, text = params.prompt[0].text.split('\\n\\n---\\n\\n').pop()
  if (text === 'hang') return
  if (text === 'fail') return out({ id, error: { code: -32603, message: 'Internal error', data: { details: 'openai-codex requires re-authentication.' } } })
  if (text === 'refuse') return out({ id, result: { stopReason: 'refusal' } })
  update(s, { sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: 'hm' } })
  update(s, { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Reading ' } })
  update(s, { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'the sound.' } })
  update(s, { sessionUpdate: 'tool_call', toolCallId: 'c1', title: 'mcp__audio__state', kind: 'other', status: 'pending', rawInput: {} })
  await ask('session/request_permission', { sessionId: s, toolCall: { toolCallId: 'c1' }, options: [{ optionId: 'always', name: 'Always allow', kind: 'allow_always' }, { optionId: 'yes', name: 'Allow', kind: 'allow_once' }, { optionId: 'no', name: 'Reject', kind: 'reject_once' }] })
  update(s, { sessionUpdate: 'tool_call_update', toolCallId: 'c1', status: 'in_progress' })
  update(s, { sessionUpdate: 'tool_call_update', toolCallId: 'c1', status: 'completed', content: [] })
  update(s, { sessionUpdate: 'tool_call', toolCallId: 'c2', title: 'audio_edit', kind: 'other', status: 'pending' })
  update(s, { sessionUpdate: 'tool_call_update', toolCallId: 'c2', rawInput: { call: 'nope()' } })
  update(s, { sessionUpdate: 'tool_call_update', toolCallId: 'c2', status: 'failed' })
  update(s, { sessionUpdate: 'tool_call', toolCallId: 'c3', title: 'Run rm -rf ~', kind: 'execute', status: 'pending', rawInput: { command: 'rm -rf ~' } })
  await ask('session/request_permission', { sessionId: s, toolCall: { toolCallId: 'c3' }, options: [{ optionId: 'yes', name: 'Allow', kind: 'allow_once' }, { optionId: 'no', name: 'Reject', kind: 'reject_once' }] })
  update(s, { sessionUpdate: 'tool_call_update', toolCallId: 'c3', status: 'failed' })
  update(s, { sessionUpdate: 'tool_call', toolCallId: 'c4', title: 'Read voice.txt', kind: 'read', status: 'pending', rawInput: { path: 'voice.txt' } })
  await ask('session/request_permission', { sessionId: s, toolCall: { toolCallId: 'c4' }, options: [{ optionId: 'yes', name: 'Allow', kind: 'allow_once' }, { optionId: 'no', name: 'Reject', kind: 'reject_once' }] })
  update(s, { sessionUpdate: 'tool_call_update', toolCallId: 'c4', status: 'completed' })
  update(s, { sessionUpdate: 'tool_call', toolCallId: 'c5', title: 'state (audio MCP Server)', kind: 'other', status: 'completed', rawInput: {} })
  update(s, { sessionUpdate: 'tool_call', toolCallId: 'c6', title: 'edit', kind: 'edit', status: 'completed', rawInput: { filePath: 'a.js', oldString: 'x' } })
  update(s, { sessionUpdate: 'tool_call', toolCallId: 'c7', title: 'Read audio/state.js', kind: 'read', status: 'completed', rawInput: { path: 'audio/state.js' } })
  await ask('fs/read_text_file', { sessionId: s, path: '/etc/hosts' })
  update(s, { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'It is 3 s long.' } })
  update(s, { sessionUpdate: 'plan', entries: [] })
  out({ id, result: { stopReason: 'end_turn' } })
}
`
for (let name of ['gemini', 'kimi', 'my-acp']) writeFileSync(join(fakes, name), FAKE_ACP), chmodSync(join(fakes, name), 0o755)
// what an ACP fake was started with, and each message it got
const told = name => readFileSync(join(logs, name + '.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l))

/** `audio --bridge` as a user runs it, on a free port, the fakes alone on PATH: what it prints, its address and key. */
async function bridge(flags = ['--key', KEY], env = {}) {
  let proc = spawn(process.execPath, [bin, '--bridge', '--port', '0', ...flags], { env: { ...process.env, AUDIO_BRIDGE_KEY: '', PATH: fakes, XDG_CONFIG_HOME: config, ...env }, stdio: ['ignore', 'pipe', 'inherit'] })
  let printed = await new Promise((resolve, reject) => {
    let got = []
    createInterface({ input: proc.stdout }).on('line', l => (got.push(l), l.includes('Connect')) && resolve(got))
    proc.once('exit', code => reject(new Error(`bridge exited ${code}`)))
  })
  return { printed, url: printed[0].match(/http:\/\/127\.0\.0\.1:\d+/)?.[0], key: printed[2].match(/^ {2}key {5}(\S+)$/)?.[1], close: () => new Promise(r => { proc.once('close', r); proc.kill() }) }
}

/** An editor page: its event stream, each `data:` line parsed; next(pred) takes the first unread event that matches. */
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
  let proc = spawn(process.execPath, [bin, '--mcp', ...args], { cwd: root, env: { ...process.env, AUDIO_BRIDGE_KEY: '', AUDIO_EDITOR: '', XDG_CONFIG_HOME: config, ...env }, stdio: ['pipe', 'pipe', 'pipe'] })
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
const EDITOR_TOOLS = ['state', 'script', 'edit', 'measure', 'look', 'select', 'scrub', 'step', 'open', 'play', 'stop', 'check', 'undo', 'redo']
// the fakes on PATH the bridge knows, in its order, and what the page calls them
const FOUND = ['claude', 'codex', 'pi', 'gemini', 'kimi'], NAMES = { claude: 'Claude Code', codex: 'Codex', pi: 'Pi', gemini: 'Gemini CLI', kimi: 'Kimi Code' }
// the models hello lists for each: Claude Code's aliases; the others say theirs once a session opens, if they do
const MODELS = { claude: [{ id: 'opus', name: 'Opus' }, { id: 'sonnet', name: 'Sonnet' }, { id: 'haiku', name: 'Haiku' }] }


test('bridge: prints its address, key and agents; its own key random, kept for the next run; one given, that run\'s alone', async t => {
  rmSync(config, { recursive: true, force: true })
  let a = await bridge([]), key = a.key, file = join(config, 'audio', 'bridge.json'), again, b, c
  try {
    t.is(a.printed, [
      `audio bridge on ${a.url}`, '',
      `  key     ${key}`,
      '  agents  Claude Code, Codex, Pi, Gemini CLI, Kimi Code', '',
      '  In the editor\'s Agent panel, paste the key, then Connect. It stays the same next time.'
    ], 'plain, not a terminal')
    t.ok(/^[0-9a-f]{32}$/.test(key), '128 random bits')
    t.is((await fetch(`${a.url}/health?key=${key}`)).status, 200, 'the printed key opens it')
    t.is(JSON.parse(readFileSync(file, 'utf8')), { url: a.url, key }, 'its address and key kept')
    if (process.platform !== 'win32') t.is(statSync(file).mode & 0o777, 0o600, 'for the user alone to read')
    await a.close(), a = null
    again = await bridge([])
    t.is(again.key, key, 'the next run keeps the key')
    let last = again.url
    await again.close(), again = null
    b = await bridge([], { AUDIO_BRIDGE_KEY: 'from-env' }), c = await bridge()
    t.is([b.key, c.key], ['from-env', KEY])
    t.is(c.printed.at(-1), '  In the editor\'s Agent panel, paste the key, then Connect.', 'a key given: not said to stay')
    t.is(JSON.parse(readFileSync(file, 'utf8')), { url: last, key }, 'a key given is kept nowhere: the own one stays')
    await b.close(), b = null, await c.close(), c = null
    c = await bridge([])
    t.is(c.key, key, 'the next run without one: the own key, as before')
    await c.close(), c = null
    writeFileSync(file, '{ not json')
    c = await bridge([])
    t.ok(/^[0-9a-f]{32}$/.test(c.key) && c.key !== key, 'a kept file unreadable: a new random key')
    t.is(JSON.parse(readFileSync(file, 'utf8')), { url: c.url, key: c.key }, 'and kept anew')
  } finally { await a?.close(); await again?.close(); await b?.close(); await c?.close() }
})

test('bridge: bad options fail with usage', async t => {
  for (let flags of [['--port', 'x'], ['--nope', '1'], ['--timeout', '0'], ['--key'], ['--key', ''], ['--agent', 'gemini'], ['--agent', '__proto__'], ['--agent', 'codex']]) {
    let proc = spawn(process.execPath, [bin, '--bridge', ...flags], { env: { ...process.env, PATH: join(dir, 'empty') }, stdio: ['ignore', 'ignore', 'pipe'] }), err = ''
    proc.stderr.setEncoding('utf8').on('data', d => err += d)
    let code = await new Promise(r => proc.on('close', r))
    t.is(code, 1, flags.join(' '))
    t.ok(err.startsWith('audio: '), err)
  }
})

test('bridge: the key on every endpoint, by query or bearer; CORS for any origin, preflight with private network', async t => {
  let b = await bridge()
  try {
    for (let [method, path] of [['GET', '/health'], ['GET', '/events'], ['GET', '/file?path=' + join(root, 'test/fixture.wav')], ['POST', '/call'], ['POST', '/reply'], ['POST', '/chat'], ['POST', '/chat/stop'], ['GET', '/nope']]) {
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

test('bridge: /file hands a media file of this machine to the page, by its absolute path; nothing else', async t => {
  let b = await bridge(), get = path => fetch(`${b.url}/file?key=${KEY}&path=${encodeURIComponent(path)}`)
  try {
    let wav = join(root, 'test/fixture.wav'), r = await get(wav)
    t.is([r.status, r.headers.get('content-type'), +r.headers.get('content-length')], [200, 'audio/wav', readFileSync(wav).length])
    t.ok(Buffer.from(await r.arrayBuffer()).equals(readFileSync(wav)), 'the bytes as on disk')
    t.is((await get('test/fixture.wav')).status, 400, 'a relative path')
    t.is((await get(join(root, 'package.json'))).status, 415, 'not audio or video')
    t.is((await get(join(root, 'test/nope.wav'))).status, 404, 'no such file')
    mkdirSync(join(dir, 'folder.wav'), { recursive: true })
    t.is((await get(join(dir, 'folder.wav'))).status, 404, 'a folder')
    t.is((await fetch(`${b.url}/file?key=${KEY}`)).status, 400, 'no path')
  } finally { await b.close() }
})

test('bridge: a page gets hello, answers a call; /call round-trips result and error', async t => {
  let b = await bridge(), p
  try {
    t.is(await health(b.url), { ok: true, page: false, agent: 'claude', agents: FOUND }, 'health before a page; the agents on PATH, the first')
    p = page(b.url)
    let { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
    t.is(await p.next(), { type: 'hello', version, agent: { id: 'claude', name: 'Claude Code', models: MODELS.claude }, agents: FOUND.map(id => ({ id, name: NAMES[id], models: MODELS[id] ?? [] })) })
    t.is(p.status, 200)
    t.is((await health(b.url)).page, true)

    let pending = post(b.url, '/call', { tool: 'select', args: { at: 1, d: 0.5 } })
    let call = await p.next(e => e.type === 'call')
    t.is(call.tool, 'select')
    t.is(call.args, { at: 1, d: 0.5 })
    t.ok(typeof call.id === 'string' && call.id, 'string id')
    t.is(await post(b.url, '/reply', { id: call.id, result: { ok: true } }), { status: 204, body: null })
    t.is(await pending, { status: 200, body: { result: { ok: true } } })

    pending = post(b.url, '/call', { tool: 'edit', args: { call: 'nope(' } })
    call = await p.next(e => e.type === 'call')
    await post(b.url, '/reply', { id: call.id, error: 'SyntaxError: Unexpected end of input' })
    t.is(await pending, { status: 200, body: { error: 'SyntaxError: Unexpected end of input' } })

    pending = post(b.url, '/call', { tool: 'stop' })
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
    t.is(await post(b.url, '/call', { tool: 'state' }), { status: 503, body: { error: 'No editor page is connected' } })
    let p = page(b.url)
    await p.next()
    let pending = post(b.url, '/call', { tool: 'state' })
    await p.next(e => e.type === 'call')
    let t0 = Date.now()
    p.close()
    t.is(await pending, { status: 503, body: { error: 'The editor page disconnected' } })
    t.ok(Date.now() - t0 < 1000, 'not after the timeout')
    await until(async () => !(await health(b.url)).page)
  } finally { await b.close() }
})

test('bridge: a second page replaces the first, which still answers what it holds', async t => {
  let b = await bridge(), p1 = page(b.url), p2
  try {
    await p1.next()
    let held = post(b.url, '/call', { tool: 'state' })
    let call1 = await p1.next(e => e.type === 'call')
    p2 = page(b.url)
    t.is((await p2.next()).type, 'hello')
    t.is(await p1.next(), { type: 'replaced' })
    await p1.ended
    t.ok(true, 'the old stream ends')

    await post(b.url, '/reply', { id: call1.id, result: 'from the first' })
    t.is((await held).body, { result: 'from the first' }, 'the replaced page answered its call')

    let pending = post(b.url, '/call', { tool: 'undo' })
    let call2 = await p2.next(e => e.type === 'call')
    t.is(call2.tool, 'undo', 'new calls go to the new page')
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
    let r = await post(b.url, '/call', { tool: 'script', args: { code: 'x' } })
    t.is(r.status, 504)
    t.ok(r.body.error.includes('did not answer script within 0.2 s'), r.body.error)
    t.ok(Date.now() - t0 < 2000, `${Date.now() - t0} ms`)
    let call = await p.next(e => e.type === 'call')
    t.is((await post(b.url, '/reply', { id: call.id, result: 1 })).status, 404, 'a late answer finds no call')
  } finally { p.close(); await b.close() }
})

test('mcp --editor: lists the editor tools; a call goes through the bridge to the page and back', { timeout: 30000 }, async t => {
  let b = await bridge(), p = page(b.url), c = mcp(['--editor', b.url, '--key', KEY])
  try {
    await p.next()
    let { result } = await c.request('tools/list')
    t.is(result.tools.map(x => x.name), ['audio', ...EDITOR_TOOLS])
    for (let tool of result.tools) {
      t.ok(tool.description.length <= 2048, `${tool.name} ${tool.description.length} ≤ 2048 chars`)
      t.ok(!tool.description.includes('\u2014'), `${tool.name}: no em dash`)
      t.is(tool.inputSchema.type, 'object')
    }
    let tool = name => result.tools.find(x => x.name === name)
    t.is(tool('script').inputSchema.required, ['code'])
    t.is(tool('edit').inputSchema.required, ['call'])
    t.is(tool('check').inputSchema.required, ['spec'])
    t.ok(tool('state').annotations.readOnlyHint, 'state reads only')
    t.is(tool('measure').inputSchema.required, ['code'])
    t.ok(tool('measure').annotations.readOnlyHint && tool('look').annotations.readOnlyHint, 'eval and view read only')
    t.ok(/\bd = duration\b/.test(tool('script').description) && /xfade = crossfade/.test(tool('script').description), 'aliases taught')

    let pending = c.request('tools/call', { name: 'state', arguments: {} })
    let call = await p.next(e => e.type === 'call')
    t.is([call.tool, call.args], ['state', {}])
    let state = { script: "audio('voice.wav')", duration: 3, sampleRate: 48000, channels: 1, selection: null, cursor: 0, markers: [], stats: { peak: -1, loudness: -20 }, problem: null }
    await post(b.url, '/reply', { id: call.id, result: state })
    let r = (await pending).result
    t.is(r.isError, false)
    t.is(JSON.parse(r.content[0].text), state, 'the page state as JSON text')

    pending = c.request('tools/call', { name: 'edit', arguments: { call: "normalize('podcast')" } })
    call = await p.next(e => e.type === 'call')
    t.is(call.args, { call: "normalize('podcast')" })
    await post(b.url, '/reply', { id: call.id, error: 'normalize: unknown preset' })
    r = (await pending).result
    t.is(r.isError, true)
    t.is(r.content[0].text, 'edit: normalize: unknown preset')

    // a picture comes back as image content; an answer too long, cut, saying how to narrow it
    pending = c.request('tools/call', { name: 'look', arguments: { at: 1, d: 2 } })
    call = await p.next(e => e.type === 'call')
    t.is(call.args, { at: 1, d: 2 })
    await post(b.url, '/reply', { id: call.id, result: { image: 'data:image/png;base64,iVBORw0KGgo=', text: '1 s to 3 s' } })
    t.is((await pending).result.content, [{ type: 'image', mimeType: 'image/png', data: 'iVBORw0KGgo=' }, { type: 'text', text: '1 s to 3 s' }])
    pending = c.request('tools/call', { name: 'measure', arguments: { code: "out.stat('ms', { bins: 1e5 })" } })
    call = await p.next(e => e.type === 'call')
    await post(b.url, '/reply', { id: call.id, result: Array(30000).fill(0) })
    r = (await pending).result
    t.ok(r.content[0].text.length < 20200 && /more chars cut: ask for fewer bins or a range$/.test(r.content[0].text), r.content[0].text.slice(-80))

    pending = c.request('tools/call', { name: 'undo' })
    call = await p.next(e => e.type === 'call')
    await post(b.url, '/reply', { id: call.id })
    t.is((await pending).result.content[0].text, 'done', 'no result reads done')

    // Cancelled: the fetch is dropped, no response goes out, the server stays responsive
    let answered = false
    c.request('tools/call', { name: 'play', arguments: { at: 1 } }).then(() => answered = true)
    call = await p.next(e => e.type === 'call')
    c.notify('notifications/cancelled', { requestId: c.id, reason: 'test' })
    t.ok((await c.request('ping')).result, 'responsive after cancel')
    await sleep(100)
    t.is((await post(b.url, '/reply', { id: call.id, result: 1 })).status, 404, 'the bridge dropped the abandoned call')
    await sleep(100)
    t.ok(!answered, 'no response for the cancelled request')
  } finally { await c.close(); p.close(); await b.close() }
})

test('mcp --editor: no page, no bridge, wrong key come back as tool errors that say what to do', { timeout: 30000 }, async t => {
  let b = await bridge()
  let calls = async (c, name = 'state') => (await c.request('tools/call', { name, arguments: {} })).result
  let c1 = mcp(['--editor', b.url, '--key', KEY]), c2 = mcp(['--editor', 'http://127.0.0.1:9', '--key', KEY]), c3 = mcp(['--editor', b.url, '--key', 'wrong'])
  let c4 = mcp(['--editor', b.url], { AUDIO_BRIDGE_KEY: KEY })
  try {
    let r = await calls(c1)
    t.is([r.isError, r.content[0].text], [true, 'state: No editor page is connected'])
    r = await calls(c2)
    t.is(r.isError, true)
    t.ok(r.content[0].text.includes('no bridge at http://127.0.0.1:9') && r.content[0].text.includes('audio --bridge'), r.content[0].text)
    r = await calls(c3)
    t.is(r.isError, true)
    t.ok(r.content[0].text.includes('key'), r.content[0].text)
    r = await calls(c4)
    t.is(r.content[0].text, 'state: No editor page is connected', 'key from AUDIO_BRIDGE_KEY')
    let plain = mcp([])
    t.is((await plain.request('tools/list')).result.tools.length, 1, 'without --editor, the audio tool alone')
    t.is((await plain.request('tools/call', { name: 'state', arguments: {} })).error.code, -32602, 'editor tools unknown without --editor')
    await plain.close()
  } finally { await Promise.all([c1, c2, c3, c4].map(c => c.close())); await b.close() }
  let none = mcp(['--editor'], { XDG_CONFIG_HOME: join(dir, 'empty') })
  let r = await calls(none)
  t.is([r.isError, r.content[0].text], [true, 'state: no bridge running: the user runs `audio --bridge` and opens the editor'], 'no key, no bridge kept')
  await none.close()
})

test('mcp --editor: with no address or key, the bridge running now, as it kept them', { timeout: 30000 }, async t => {
  let b = await bridge([]), p = page(b.url, b.key), c = mcp(['--editor'])
  try {
    await p.next()
    t.is((await c.request('tools/list')).result.tools.map(x => x.name), ['audio', ...EDITOR_TOOLS])
    let pending = c.request('tools/call', { name: 'select', arguments: { at: 1, d: 2 } })
    let call = await p.next(e => e.type === 'call')
    t.is([call.tool, call.args], ['select', { at: 1, d: 2 }])
    await post(b.url, '/reply', { id: call.id, result: { selection: [1, 3] } }, b.key)
    t.is(JSON.parse((await pending).result.content[0].text), { selection: [1, 3] })
  } finally { await c.close(); p.close(); await b.close() }
  let env = mcp(['--editor'], { AUDIO_EDITOR: 'http://127.0.0.1:9', AUDIO_BRIDGE_KEY: KEY })
  let r = (await env.request('tools/call', { name: 'state', arguments: {} })).result
  t.ok(r.isError && r.content[0].text.includes('no bridge at http://127.0.0.1:9'), 'AUDIO_EDITOR before what was kept: ' + r.content[0].text)
  await env.close()
})

test('bridge chat: claude streams text, tool, session, done in order; the text on stdin, never in argv', { timeout: 15000 }, async t => {
  let b = await bridge(), p = page(b.url)
  try {
    await p.next()
    let text = '--dangerously-skip-permissions how long is it?'
    let events = await chat(p, b.url, { text })
    t.is(events, [
      { session: CLAUDE_SESSION },
      { thinking: true },
      { text: 'Reading ' }, { text: 'the sound.' },
      { thinking: true }, { tool: 'state', input: {}, id: 'toolu_1' }, { answered: 'toolu_1', failed: false },
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
    t.is(mcpServers.audio, { command: process.execPath, args: [bin, '--mcp', '--editor', b.url, '--key', KEY] }, 'this repo\'s MCP server, absolute paths')

    let history = [{ role: 'user', text: 'how long is it?' }, { role: 'agent', text: 'It is 3 s long.' }]
    await chat(p, b.url, { text: 'and now?', session: CLAUDE_SESSION, history })
    ;({ argv, input } = logged('claude'))
    t.is(argv[argv.indexOf('--resume') + 1], CLAUDE_SESSION, 'continues the session')
    t.is(input, 'and now?', 'which holds what was said')
    t.ok(!argv.includes('--model'), 'no model asked: its own choice')
    await chat(p, b.url, { text: 'and now?', session: CLAUDE_SESSION, model: 'haiku' })
    t.is(logged('claude').argv.slice(-2), ['--model', 'haiku'], 'a model asked: --model, the same session')
    let refused = await post(b.url, '/chat', { text: 'x', model: 'gpt-9' })
    t.is([refused.status, refused.body.error], [400, 'model: one of opus, sonnet, haiku'], 'one it has not: refused, its models said')

    // a session it no longer holds: the same turn afresh, told what was said; a new one with no session, told too
    let told = 'Our conversation so far, which you no longer hold:\n\nUser: how long is it?\n\nYou: It is 3 s long.\n\nThe user now says:\n\nand now?'
    t.is((await chat(p, b.url, { text: 'and now?', session: 'gone', history }))[0], { session: CLAUDE_SESSION }, 'the session it starts instead')
    ;({ argv, input } = logged('claude'))
    t.ok(!argv.includes('--resume'), 'afresh')
    t.is(input, told)
    t.is((await chat(p, b.url, { text: 'and now?', history })).at(-1), { done: true })
    t.is(logged('claude').input, told, 'a conversation another agent began')

    t.is(await chat(p, b.url, { text: 'refused' }), [{ session: CLAUDE_SESSION }, { tool: 'edit', input: { call: 'nope()' }, id: 't' }, { answered: 't', failed: true }, { done: true }], 'a call refused')
    t.is((await chat(p, b.url, { text: 'fail' })).at(-1), { done: true, error: 'API Error: 529 overloaded' })
    t.is((await chat(p, b.url, { text: 'crash' })).at(-1), { done: true, error: 'boom: no credit' }, 'exit without a result: the last stderr line')
  } finally { p.close(); await b.close() }
})

test('bridge chat: codex events and its exec command line', { timeout: 15000 }, async t => {
  let b = await bridge(['--key', KEY, '--agent', 'codex']), p = page(b.url)
  try {
    t.is((await p.next()).agent, { id: 'codex', name: 'Codex', models: [] }, '--agent chooses it')
    t.is(b.printed[3], '  agents  Codex, Claude Code, Pi, Gemini CLI, Kimi Code', '--agent first')
    let events = await chat(p, b.url, { text: 'how long?' })
    t.is(events, [{ session: CODEX_THREAD }, { tool: 'state', input: {}, id: 'item_1' }, { answered: 'item_1', failed: false }, { tool: 'files.edit', input: { path: 'a' }, id: 'item_9' }, { answered: 'item_9', failed: false }, { text: 'It is 3 s long.' }, { text: '\n\nAnything else?' }, { done: true }])
    let { argv, input } = logged('codex')
    t.is(input, 'how long?')
    t.is(argv.slice(0, 3), ['exec', '--json', '--skip-git-repo-check'])
    t.is(argv.at(-1), '-', 'the prompt from stdin')
    t.ok(argv.includes(`mcp_servers.audio.command=${JSON.stringify(process.execPath)}`), 'node, absolute')
    t.ok(argv.includes(`mcp_servers.audio.args=${JSON.stringify([bin, '--mcp', '--editor', b.url, '--key', KEY])}`), 'the MCP server args as a TOML array')

    await chat(p, b.url, { text: 'more', session: CODEX_THREAD })
    argv = logged('codex').argv
    t.is(argv.slice(0, 2), ['exec', 'resume'])
    t.is(argv.slice(-2), [CODEX_THREAD, '-'])
    t.is((await chat(p, b.url, { text: 'more', session: 'gone', history: [{ role: 'user', text: 'how long?' }] })).at(-1), { done: true }, 'a thread it lacks: afresh')
    t.ok(logged('codex').input.startsWith('Our conversation so far'), logged('codex').input)

    t.is(await chat(p, b.url, { text: 'refused' }), [{ session: CODEX_THREAD }, { tool: 'edit', input: { call: 'nope()' }, id: 'i' }, { answered: 'i', failed: true }, { done: true }], 'a call refused')
    t.is((await chat(p, b.url, { text: 'fail' })).at(-1), { done: true, error: 'usage limit reached' })
    t.is((await chat(p, b.url, { text: 'model' })).at(-1), { done: true, error: "The 'gpt-6.1-sol' model is not supported when using Codex with a ChatGPT account." }, 'an error body, its message')
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
    t.is((await bad({ text: 'hi', history: 'all of it' })).status, 400, 'history a list')
    t.is((await bad({ text: 'hi', history: [{ role: 'user', text: 5 }] })).status, 400, 'of texts')
    t.is((await bad({ text: 'hi', session: '--dangerously-skip-permissions' })).status, 400, 'a session id is never a flag')
    t.is((await bad({ text: 'hi', session: 5 })).status, 400, 'a session id is a string')
  } finally { p.close(); await b.close() }

  let none = await bridge(['--key', KEY], { PATH: join(dir, 'empty') }), q = page(none.url)
  try {
    t.is((await q.next()).agent, null, 'no agent on PATH')
    t.is(none.printed[3], '  agents  none found: install one (Claude Code, Codex, Pi, Gemini CLI, Qwen Code, Kimi Code, …), then start again')
    t.is(await post(none.url, '/chat', { text: 'hi' }), { status: 400, body: { error: 'No agent on PATH: install one (Claude Code, Codex, Pi, Gemini CLI, Qwen Code, Kimi Code, …), then start the bridge again' } })
    q.close()
    await until(async () => !(await health(none.url)).page)
    t.is((await post(none.url, '/chat', { text: 'hi' })).status, 400, 'agent checked first')
  } finally { await none.close() }
  let lone = await bridge()
  try { t.is(await post(lone.url, '/chat', { text: 'hi' }), { status: 503, body: { error: 'No editor page is connected' } }) }
  finally { await lone.close() }
})

test('bridge chat: pi prints its events; the editor tools come as its extension, which finds the bridge by the env', { timeout: 15000 }, async t => {
  let b = await bridge(['--key', KEY, '--agent', 'pi']), p = page(b.url)
  try {
    t.is((await p.next()).agent, { id: 'pi', name: 'Pi', models: [] }, '--agent chooses the first')
    t.is(await chat(p, b.url, { text: 'how long?' }), [
      { session: PI_SESSION }, { thinking: true }, { text: 'Reading ' }, { text: 'the sound .' },
      { thinking: true }, { tool: 'state', input: {}, id: 'call_1' }, { answered: 'call_1', failed: false },
      { text: '\n\n' }, { text: 'It is 3 s long.' }, { done: true }
    ], 'a line holding U+2028 is one line')
    let { argv, input, editor, key } = logged('pi')
    t.is(input, 'how long?', 'the text on stdin')
    t.is(argv.slice(0, 3), ['--mode', 'json', '--no-builtin-tools'], 'its own tools left out')
    t.is(argv[argv.indexOf('-e') + 1], join(root, 'bin', 'pi.js'), 'the editor tools, an extension')
    t.ok(argv[argv.indexOf('--append-system-prompt') + 1].startsWith('You are chatting'), 'told where it is')
    t.is([editor, key], [b.url, KEY], 'the bridge, for the extension to reach')
    t.ok(!argv.includes('--session'), 'a new conversation')

    await chat(p, b.url, { text: 'and now?', session: PI_SESSION })
    argv = logged('pi').argv
    t.is(argv[argv.indexOf('--session') + 1], PI_SESSION, 'goes on with its session')
    t.is((await chat(p, b.url, { text: 'and now?', session: 'gone', history: [{ role: 'user', text: 'how long?' }] }))[0], { session: PI_SESSION }, 'a session it lacks: afresh')
    t.ok(logged('pi').input.startsWith('Our conversation so far'), 'told what was said')
    t.is(await chat(p, b.url, { text: 'fail' }), [{ session: PI_SESSION }, { done: true, error: 'registry.ollama.ai/library/dolphin3:latest does not support tools' }], 'a failed run, as its last message says, the provider\'s message')
  } finally { p.close(); await b.close() }
})

test('pi extension (bin/pi.js): the editor tools, each reaching the page through the bridge', { timeout: 15000 }, async t => {
  let b = await bridge([]), p = page(b.url, b.key), tools = {}
  let { default: extend } = await import('../bin/pi.js')
  extend({ registerTool: tool => tools[tool.name] = tool })
  try {
    await p.next()
    t.is(Object.keys(tools), EDITOR_TOOLS)
    t.is(tools.edit.parameters.required, ['call'], 'its parameters, the MCP tool\'s schema')
    t.is(tools.edit.label, 'Add an edit')
    process.env.AUDIO_EDITOR = b.url, process.env.AUDIO_BRIDGE_KEY = b.key
    let pending = tools.look.execute('id', { at: 1, d: 2 })
    let call = await p.next(e => e.type === 'call')
    t.is([call.tool, call.args], ['look', { at: 1, d: 2 }])
    await post(b.url, '/reply', { id: call.id, result: { image: 'data:image/png;base64,iVBORw0KGgo=', text: '1 s to 3 s' } }, b.key)
    t.is(await pending, { content: [{ type: 'image', mimeType: 'image/png', data: 'iVBORw0KGgo=' }, { type: 'text', text: '1 s to 3 s' }], details: undefined }, 'a picture as pi takes one')
    pending = tools.edit.execute('id', { call: 'nope()' })
    call = await p.next(e => e.type === 'call')
    await post(b.url, '/reply', { id: call.id, error: 'nope is not an op' }, b.key)
    await pending.then(() => t.fail('resolved'), e => t.is(e.message, 'edit: nope is not an op', 'an error, thrown: a failed result'))
    delete process.env.AUDIO_EDITOR, delete process.env.AUDIO_BRIDGE_KEY
    pending = tools.state.execute('id', {})
    call = await p.next(e => e.type === 'call')
    await post(b.url, '/reply', { id: call.id, result: { duration: 3 } }, b.key)
    t.is((await pending).content, [{ type: 'text', text: '{"duration":3}' }], 'with no env, the bridge kept')
  } finally { delete process.env.AUDIO_EDITOR, delete process.env.AUDIO_BRIDGE_KEY; p.close(); await b.close() }
})

test('bridge chat: an ACP agent; its session gone on with by session/resume, its requests answered', { timeout: 15000 }, async t => {
  let b = await bridge(['--key', KEY, '--agent', 'kimi']), p = page(b.url)
  try {
    t.is((await p.next()).agent, { id: 'kimi', name: 'Kimi Code', models: [] }, 'its models not said yet')
    let r = await post(b.url, '/chat', { text: 'how long?' }), events = []
    for (;;) { let { type, turn, ...e } = await p.next(e => e.turn === r.body.turn); events.push(e); if (e.done) break }
    t.is(events, [
      { session: 'sess-1' }, { thinking: true }, { text: 'Reading ' }, { text: 'the sound.' },
      { tool: 'state', input: {}, id: 'c1' }, { answered: 'c1', failed: false },
      { tool: 'edit', input: { call: 'nope()' }, id: 'c2' }, { answered: 'c2', failed: true },
      { tool: 'Run rm -rf ~', input: { command: 'rm -rf ~' }, id: 'c3' }, { answered: 'c3', failed: true },
      { tool: 'Read voice.txt', input: { path: 'voice.txt' }, id: 'c4' }, { answered: 'c4', failed: false },
      { tool: 'state', input: {}, id: 'c5' }, { answered: 'c5', failed: false },
      { tool: "edit (Kimi Code's)", input: { filePath: 'a.js', oldString: 'x' }, id: 'c6' }, { answered: 'c6', failed: false },
      { tool: 'Read audio/state.js', input: { path: 'audio/state.js' }, id: 'c7' }, { answered: 'c7', failed: false },
      { text: '\n\nIt is 3 s long.' }, { done: true }
    ], 'its words, the editor tools by their names, however titled; its own by their titles, never taken for ours')
    let log = told('kimi'), [{ argv, editor }] = log, sent = method => log.find(m => m.method === method)
    t.is(argv, ['acp'], 'started as an ACP server')
    t.is(editor, b.url)
    t.is(sent('initialize').params, { protocolVersion: 1, clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false }, clientInfo: { name: 'audio', version: JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version } })
    t.is(sent('session/new').params, { cwd: process.cwd(), mcpServers: [{ name: 'audio', command: process.execPath, args: [bin, '--mcp', '--editor', b.url, '--key', KEY], env: [] }] }, 'the MCP server handed to it, absolute paths')
    let { text } = sent('session/prompt').params.prompt[0]
    t.ok(text.startsWith('You are chatting') && text.endsWith('\n\n---\n\nhow long?'), 'told where it is, then the text')
    let answers = log.slice(1).filter(m => m.method == null).map(m => m.result?.outcome ?? m.error?.code)
    t.is(answers, [{ outcome: 'selected', optionId: 'yes' }, { outcome: 'selected', optionId: 'no' }, { outcome: 'selected', optionId: 'yes' }, -32601],
      'the editor\'s tool allowed once, its shell refused, its reading allowed, a client\'s file not offered')
    await until(async () => (await post(b.url, '/chat/stop', { turn: r.body.turn })).status === 404)
    t.ok(true, 'its turn over, the agent goes')
    t.is((await p.next(e => e.type === 'hello')).agents.find(a => a.id === 'kimi').models, [{ id: 'k2', name: 'K2' }, { id: 'k2-think', name: 'K2 Thinking' }], 'the models its session said it has, told the page')
    await chat(p, b.url, { text: 'think', model: 'k2-think' })
    t.is(told('kimi').find(m => m.method === 'session/set_model')?.params, { sessionId: 'sess-1', modelId: 'k2-think' }, 'a model asked for: set before the prompt')
    await chat(p, b.url, { text: 'as it was', model: 'k2' })
    t.ok(!told('kimi').some(m => m.method === 'session/set_model'), 'the one it has already: left as it is')
    t.is((await post(b.url, '/chat', { text: 'x', model: 'gpt-9' })).status, 400, 'a model it doesn\'t have: refused')

    await chat(p, b.url, { text: 'and now?', session: 'sess-1' })
    log = told('kimi')
    t.is(log.find(m => m.method === 'session/resume')?.params.sessionId, 'sess-1', 'goes on by session/resume')
    t.ok(!log.some(m => m.method === 'session/new'), 'not a new one')
    t.is(log.find(m => m.method === 'session/prompt').params.prompt[0].text, 'and now?', 'the text alone')
    t.is((await chat(p, b.url, { text: 'and now?', session: 'gone', history: [{ role: 'user', text: 'how long?' }] }))[0], { session: 'sess-1' }, 'a session it lacks: afresh')
    t.ok(told('kimi').find(m => m.method === 'session/prompt').params.prompt[0].text.includes('Our conversation so far'), 'told what was said')

    t.is((await chat(p, b.url, { text: 'fail' })).at(-1), { done: true, error: 'openai-codex requires re-authentication: sign in to Kimi Code in a terminal, then ask again' }, 'its error, its details, what to do')
    t.is((await chat(p, b.url, { text: 'refuse' })).at(-1), { done: true, error: 'It declined to go on' })
    r = await post(b.url, '/chat', { text: 'hang' })
    await p.next(e => e.turn === r.body.turn && e.session)
    await post(b.url, '/chat/stop', { turn: r.body.turn })
    t.is(await p.next(e => e.turn === r.body.turn), { type: 'chat', turn: r.body.turn, done: true, error: 'Stopped' })
  } finally { p.close(); await b.close() }
})

test('bridge chat: the page picks the agent; session/load replays unheard; any ACP agent by its command line', { timeout: 15000 }, async t => {
  let b = await bridge(), p = page(b.url)
  try {
    t.is((await p.next()).agents.map(a => a.id), FOUND)
    let events = await chat(p, b.url, { text: 'how long?', agent: 'gemini' })
    t.is(events.at(-1), { done: true }, 'gemini, as the page asked')
    t.is(told('gemini')[0].argv, ['--acp'])
    events = await chat(p, b.url, { text: 'and now?', session: 'sess-1', agent: 'gemini' })
    t.ok(told('gemini').some(m => m.method === 'session/load'), 'one that cannot resume loads')
    t.ok(!events.some(e => e.text === 'said before'), 'its replay unheard')
    t.is((await post(b.url, '/chat', { text: 'hi', agent: 'nope' })).body, { error: `agent: one of ${FOUND.join(', ')}` })
  } finally { p.close(); await b.close() }

  let any = await bridge(['--key', KEY, '--agent', 'my-acp --model x']), q = page(any.url)
  try {
    t.is((await q.next()).agent, { id: 'my-acp --model x', name: 'my-acp --model x', models: [] })
    t.is(any.printed[3], '  agents  my-acp --model x, Claude Code, Codex, Pi, Gemini CLI, Kimi Code')
    t.is((await chat(q, any.url, { text: 'how long?' })).at(-1), { done: true })
    t.is(told('my-acp')[0].argv, ['--model', 'x'], 'its arguments as given')
  } finally { q.close(); await any.close() }
  let proc = spawn(process.execPath, [bin, '--bridge', '--agent', 'nowhere acp'], { env: { ...process.env, PATH: fakes, XDG_CONFIG_HOME: config }, stdio: ['ignore', 'ignore', 'pipe'] }), err = ''
  proc.stderr.setEncoding('utf8').on('data', d => err += d)
  t.is(await new Promise(r => proc.on('close', r)), 1)
  t.ok(err.includes('nowhere not found'), err)
})
