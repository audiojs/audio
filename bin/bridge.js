/**
 * audio bridge: the playground page and the user's own AI agents meet here, over HTTP on 127.0.0.1.
 *
 *   audio --bridge [--port 7777] [--key K] [--timeout 30] [--agent NAME | --agent "COMMAND"]
 *
 * The page holds the sound, so an agent reaches it through tools the page answers. The page listens
 * on GET /events (Server-Sent Events) and answers each `call` event with POST /reply; POST /call,
 * which `audio --mcp --playground` sends for an agent's playground tool, waits for that answer;
 * GET /file?path=P hands the page a media file from this machine, to open (`open`).
 * POST /chat runs an agent CLI of the user's headless, with those tools attached, and streams its
 * answer to the page as `chat` events: any of AGENTS found on PATH, the page choosing one for each
 * conversation, --agent the first; or any agent that speaks ACP, by its command line. CORS is open
 * to any origin (the page may be served from https://audiojs.dev), so the key is the auth: every
 * request carries it, as `?key=K` or `Authorization: Bearer K`. The bridge's own key, made once, is
 * kept with its address in BRIDGE (bin/mcp.js): the same each run, and an MCP server finds the bridge
 * by itself; one given (--key, AUDIO_BRIDGE_KEY) holds for that run alone, kept nowhere. Nothing the
 * page sends is executed except an agent CLI the bridge found, spawned without a shell, the user's
 * text on its stdin.
 */
import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { accessSync, constants, createReadStream, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, delimiter, dirname, extname, isAbsolute, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { BRIDGE, EDITOR, TOOL, lines, split } from './mcp.js'

const CLI = fileURLToPath(new URL('./cli.js', import.meta.url))
const PI = fileURLToPath(new URL('./pi.js', import.meta.url))
const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
const LIMIT = 8 << 20  // bytes of a request body: a script or a page's answer, never audio
const SESSION = /^\w[\w-]{0,127}$/  // an agent's session id lands in argv: no leading dash, so never a flag
const USAGE = 'audio --bridge [--port 7777] [--key K] [--timeout 30] [--agent NAME | --agent "COMMAND"]'
const RECALL = 30000  // chars of an earlier conversation told to an agent that does not hold it
const PREFLIGHT = {
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'content-type, authorization',
  'Access-Control-Allow-Private-Network': 'true',  // Chrome's Private Network Access: a public https page may reach 127.0.0.1
  'Access-Control-Max-Age': '600'
}

// What a chat agent is told besides its own setup: where it is and what the tools touch.
const PROMPT = `You are chatting with the user inside the audio playground, a browser page where they edit one sound with the audio JS library. The playground's tools (state, measure, look, edit, step, script, select, scrub, play, check, open, undo; the MCP server "audio") read and change that sound; the user sees and hears each change at once. Work on the sound in the page, not on files: a file dropped into the page has no path, and the page's sound is the script's output, edits included. Call state first. Measure with measure (any stat, over time or a range, silences, notes), see with look, mark findings on the timeline with edit("mark(time, 'label')"), point the user at a place with select (a band too) or scrub. Open a file of theirs with open. Prefer edit for one step; step turns an edit off (over a range alone, too), takes it away, moves it or rewrites it; script rewrites the whole; when something sounds wrong somewhere, find the edit that did it by measuring through the edits (step(i) in measure: the sound before and after it, what it takes out) before changing any; check measures against a delivery spec; play lets them hear it (original: true for the file as it opened, level-matched). Reply briefly, in Markdown: the page renders it beside the sound.`

const toml = v => JSON.stringify(v)  // a JSON string or array of strings is TOML too
// What GET /file hands a page, by extension: the audio and video the editor opens, nothing else on the machine
const MEDIA = {
  wav: 'audio/wav', mp3: 'audio/mpeg', flac: 'audio/flac', ogg: 'audio/ogg', oga: 'audio/ogg', opus: 'audio/ogg', m4a: 'audio/mp4',
  aac: 'audio/aac', aif: 'audio/aiff', aiff: 'audio/aiff', caf: 'audio/x-caf', webm: 'audio/webm', mka: 'audio/x-matroska',
  wma: 'audio/x-ms-wma', amr: 'audio/amr', mp4: 'video/mp4', mov: 'video/quicktime', mkv: 'video/x-matroska'
}

/**
 * Agent CLIs /chat can run, by the executable's name on PATH (`command`, where it differs). `name` is
 * what the page calls it. Most speak ACP, the Agent Client Protocol (acp(), below): `acp` is the
 * arguments that start one as an ACP server, the MCP server handed to it as a session opens.
 *
 * The others print JSON lines of their own: a turn spawns `KEY ...args(mcp, session)`, `mcp` being
 * { command, args } of the MCP server serving the editor's tools, `session` the id the agent gave on
 * an earlier turn, to continue that conversation. The user's text goes to stdin, never into argv,
 * where a text like `--dangerously-skip-permissions` would read as a flag; `env` adds to its
 * environment. read() makes a parser for one turn: each JSON line the agent prints → chat events,
 * { text } | { tool, input, id } (a call starts, with what it was given) | { answered: id, failed }
 * (that call's answer, in whatever order they come) | { thinking } (it thinks, or composes a call) |
 * { session } | { done, error? }, or { error } to report should the agent exit without finishing.
 *
 * Any other ACP agent runs by its command line, --agent "goose acp". Every agent runs with
 * AUDIO_EDITOR and AUDIO_BRIDGE_KEY, the bridge's address and key, which bin/pi.js reaches it by.
 */
export const AGENTS = {
  // Claude Code: https://code.claude.com/docs/en/headless; stream-json lines carry the session id,
  // token deltas (with --include-partial-messages), whole assistant messages, the tools' results
  // as user messages, a closing `result`. Its tool search would defer our small tools behind a
  // ToolSearch round trip on every turn.
  claude: {
    name: 'Claude Code',
    env: { ENABLE_TOOL_SEARCH: 'false' },
    // its aliases, each the newest of its line (--model)
    models: [{ id: 'opus', name: 'Opus' }, { id: 'sonnet', name: 'Sonnet' }, { id: 'haiku', name: 'Haiku' }],
    args: (mcp, session, model) => ['-p', '--output-format', 'stream-json', '--verbose', '--include-partial-messages',
      '--mcp-config', JSON.stringify({ mcpServers: { audio: mcp } }), '--strict-mcp-config',
      '--allowedTools', 'mcp__audio__*', '--append-system-prompt', PROMPT, ...(session ? ['--resume', session] : []), ...(model ? ['--model', model] : [])],
    read() {
      let streamed = false, said = false
      return m => {
        if (m.parent_tool_use_id) return []  // a subagent's own messages
        // the session its messages carry; a closing result names the one asked for, though it may have found none
        let out = m.session_id && m.type !== 'result' ? [{ session: m.session_id }] : []
        let e = m.type === 'stream_event' && m.event
        if (e?.type === 'content_block_start' && e.content_block?.type === 'text' && said) out.push({ text: '\n\n' })
        if (e?.type === 'content_block_start' && e.content_block?.type !== 'text') out.push({ thinking: true })
        if (e?.type === 'content_block_delta' && e.delta?.type === 'text_delta') streamed = said = true, out.push({ text: e.delta.text })
        if (m.type === 'assistant') for (let b of m.message?.content ?? []) {
          if (b.type === 'tool_use') out.push({ tool: b.name.replace(/^mcp__audio__/, ''), input: b.input, id: b.id })
          else if (b.type === 'text' && !streamed) out.push({ text: (said ? '\n\n' : '') + b.text }), said = true
        }
        if (m.type === 'user' && Array.isArray(m.message?.content)) for (let b of m.message.content) if (b.type === 'tool_result') out.push({ answered: b.tool_use_id ?? true, failed: !!b.is_error })
        if (m.type === 'result') out.push(m.is_error ? { done: true, error: m.errors?.join('\n') || m.result || m.subtype } : { done: true })
        return out
      }
    }
  },
  // Codex: `codex exec --json` prints thread/turn/item events; -c overrides add the MCP server for
  // this run only and approve its tools, which exec has no one to ask about.
  codex: {
    name: 'Codex',
    args: (mcp, session) => ['exec', ...(session ? ['resume'] : []), '--json', '--skip-git-repo-check',
      '-c', `mcp_servers.audio.command=${toml(mcp.command)}`, '-c', `mcp_servers.audio.args=${toml(mcp.args)}`,
      '-c', 'mcp_servers.audio.default_tools_approval_mode="approve"', '-c', `developer_instructions=${toml(PROMPT)}`,
      ...(session ? [session] : []), '-'],
    read() {
      let said = false
      return m => {
        let item = m.item ?? {}
        if (m.type === 'thread.started') return [{ session: m.thread_id }]
        let tool = !['agent_message', 'reasoning', 'todo_list', 'error'].includes(item.type)
        // another server's tool by its server's name too: `edit` is ours alone
        if (m.type === 'item.started' && tool) return [{ tool: item.server && item.server !== 'audio' ? `${item.server}.${item.tool}` : item.tool ?? item.type, input: item.arguments ?? (item.command != null ? { command: item.command } : item.query != null ? { query: item.query } : undefined), id: item.id }]
        if (m.type === 'item.completed' && tool) return [{ answered: item.id ?? true, failed: item.status === 'failed' }]
        if (m.type === 'item.completed' && item.type === 'agent_message') {
          let text = (said ? '\n\n' : '') + item.text
          said = true
          return [{ text }]
        }
        if (m.type === 'turn.completed') return [{ done: true }]
        if (m.type === 'turn.failed') return [{ done: true, error: plain(m.error?.message) || 'turn failed' }]
        if (m.type === 'error') return [{ error: plain(m.message) }]  // may be a retry: final only if the agent then exits
        return []
      }
    }
  },
  // Pi: https://pi.dev, `pi --mode json` prints its session, then its events (docs/json.md), the text on stdin its
  // prompt. It takes no MCP server: the editor's tools come as an extension (bin/pi.js), its own (read, bash, edit,
  // write) left out. A run that fails says so in its last assistant message, exiting 0.
  pi: {
    name: 'Pi',
    args: (mcp, session) => ['--mode', 'json', '--no-builtin-tools', '-e', PI, '--append-system-prompt', PROMPT, ...(session ? ['--session', session] : [])],
    read() {
      let said = false, failed = null
      return m => {
        let e = m.assistantMessageEvent
        if (m.type === 'session') return [{ session: m.id }]
        if (e?.type === 'text_start' && said) return [{ text: '\n\n' }]
        if (e?.type === 'text_delta') return said = true, [{ text: e.delta }]
        if (e?.type === 'thinking_start' || e?.type === 'toolcall_start') return [{ thinking: true }]
        if (m.type === 'tool_execution_start') return [{ tool: m.toolName, input: m.args, id: m.toolCallId }]
        if (m.type === 'tool_execution_end') return [{ answered: m.toolCallId, failed: !!m.isError }]
        // a retry may follow a failure: the last one decides, once pi settles
        if (m.type === 'message_end' && m.message?.role === 'assistant') failed = ['error', 'aborted'].includes(m.message.stopReason) ? plain(m.message.errorMessage) || m.message.stopReason : null
        if (m.type === 'agent_settled') return [failed ? { done: true, error: failed } : { done: true }]
        return []
      }
    }
  },
  // ACP agents, as the ACP registry starts them (https://agentclientprotocol.com/get-started/registry). Left out: Copilot
  // CLI, which drops a session's MCP servers; OpenHands, whose loaded session loses them; Crush and Aider speak no ACP
  gemini: { name: 'Gemini CLI', acp: ['--acp'] },
  qwen: { name: 'Qwen Code', acp: ['--acp'] },
  kimi: { name: 'Kimi Code', acp: ['acp'] },
  opencode: { name: 'OpenCode', acp: ['acp'] },
  kilo: { name: 'Kilo Code', acp: ['acp'] },
  cline: { name: 'Cline', acp: ['--acp'] },
  goose: { name: 'Goose', acp: ['acp'] },
  droid: { name: 'Factory Droid', acp: ['exec', '--output-format', 'acp'] },
  cursor: { name: 'Cursor', command: 'cursor-agent', acp: ['acp'] },
  auggie: { name: 'Augment', acp: ['--acp'] },
  kiro: { name: 'Kiro', command: 'kiro-cli', acp: ['acp'] },
  vibe: { name: 'Mistral Vibe', command: 'vibe-acp', acp: [] }
}

// A provider's error as a person reads it: a JSON body, bare or after its status (`400: {…}`), its message, at its top or
// under `error` (Codex prints OpenAI's body whole)
const plain = s => { try { const e = JSON.parse(String(s).replace(/^\d{3}: /, '')); return e.message || e.error?.message || s } catch { return s } }

// What an ACP turn's end says, by its stop reason, where it ended short
const STOPPED = { max_tokens: 'It ran out of tokens', max_turn_requests: 'It reached its limit of steps', refusal: 'It declined to go on', cancelled: 'Stopped' }
// The kinds of an ACP agent's own tool calls that only read, allowed as Claude Code's reading is
const READS = new Set(['read', 'search', 'think', 'fetch'])
const OURS = [TOOL, ...EDITOR]

/**
 * The editor's tool an ACP tool call is, by its title as agents write an MCP server's tool, mcp__audio__edit,
 * audio_edit, audio/edit, Tool: audio/edit, edit (audio MCP Server); or bare, given only what that tool takes.
 */
function ours({ title, rawInput }) {
  let t = String(title ?? '').trim()
  let name = t.match(/(?:^|[^a-z\d])audio(?:__|[_./:-])(\w+)(?=$|[\s(:])/i)?.[1] ?? t.match(/^(\w+)\s*\(\s*audio\b/i)?.[1]
  if (OURS.some(x => x.name === name)) return name
  let tool = OURS.find(x => x.name === t)
  if (tool && Object.keys(rawInput ?? {}).every(k => Object.hasOwn(tool.inputSchema.properties, k))) return t
}

// An ACP error as said: its details where it has them, else its message; one that wants a sign-in, how to give it
function failure(e, name) {
  let said = String(typeof e?.data === 'string' ? e.data : typeof e?.data?.details === 'string' ? e.data.details : e?.message ?? 'failed').replace(/\.$/, '')
  return /auth/i.test(said) ? `${said}: sign in to ${name} in a terminal, then ask again` : said
}

/**
 * One turn with an agent that speaks the Agent Client Protocol (https://agentclientprotocol.com), JSON-RPC
 * over its stdio, `write` sending a message: initialize; the conversation gone on with (session/resume,
 * or session/load, its replay unheard) or begun (session/new, the prompt before the user's text), the
 * MCP server handed to it either way; the text prompted. What happens comes to `take` as chat events,
 * as a parsed line of another agent's does. Returns the parser of what the agent prints, which
 * answers its requests: a permission granted for the editor's tools and for reading, refused for the
 * rest, as Claude Code runs here; no other of a client's (files, terminals) offered.
 */
function acp(write, take, { text, session, mcp, name, model }) {
  let n = 0, asked = new Map(), calls = new Map(), quiet = false, said = false, gap = false
  let ask = (method, params) => new Promise((resolve, reject) => { asked.set(++n, { resolve, reject }); write({ jsonrpc: '2.0', id: n, method, params }) })
  let opened = { cwd: process.cwd(), mcpServers: [{ name: 'audio', command: mcp.command, args: mcp.args, env: [] }] }
  ;(async () => {
    let { agentCapabilities: can = {} } = await ask('initialize', { protocolVersion: 1, clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false }, clientInfo: { name: 'audio', version } })
    let sessionId = session, got
    if (!session) ({ sessionId, ...got } = await ask('session/new', opened))
    else if (can.sessionCapabilities?.resume) got = await ask('session/resume', { sessionId, ...opened })
    else if (can.loadSession) { quiet = true; got = await ask('session/load', { sessionId, ...opened }); quiet = false }
    else throw new Error(`${name} cannot go on with an earlier conversation`)
    take({ session: sessionId })
    // the models it has, if it says (ACP's session models), and the one asked for, set
    let { availableModels = [], currentModelId } = got?.models ?? {}
    if (availableModels.length) take({ models: availableModels.map(m => ({ id: m.modelId, name: m.name || m.modelId })) })
    if (model && model !== currentModelId && availableModels.some(m => m.modelId === model)) await ask('session/set_model', { sessionId, modelId: model })
    let { stopReason } = await ask('session/prompt', { sessionId, prompt: [{ type: 'text', text: session ? text : `${PROMPT}\n\n---\n\n${text}` }] })
    take(STOPPED[stopReason] ? { done: true, error: STOPPED[stopReason] } : { done: true })
  })().catch(e => take({ done: true, error: e.message }))

  // A call said once it says what it was given, or runs; answered once it ends. An update carries only what changed.
  function called({ sessionUpdate, ...u }) {
    let c = { ...calls.get(u.toolCallId), ...u }, out = [], ended = c.status === 'completed' || c.status === 'failed'
    calls.set(u.toolCallId, c)
    if (!c.said && (ended || c.status === 'in_progress' || Object.keys(c.rawInput ?? {}).length)) {
      c.said = gap = true
      let title = String(c.title ?? '').trim().split('\n')[0].slice(0, 120) || c.kind || 'tool'
      // its own, by its title: one titled as an editor tool is, its own all the same (`edit` is ours alone)
      out.push({ tool: ours(c) ?? (OURS.some(x => x.name === title) ? `${title} (${name}'s)` : title), input: c.rawInput, id: c.toolCallId })
    }
    if (ended && !c.answered) c.answered = true, out.push({ answered: c.toolCallId, failed: c.status === 'failed' })
    return out
  }
  function grant({ toolCall = {}, options = [] }) {
    let c = { ...calls.get(toolCall.toolCallId), ...toolCall }
    let pick = ([kind, or]) => options.find(o => o.kind === kind) ?? options.find(o => o.kind === or)
    let o = ours(c) || READS.has(c.kind) ? pick(['allow_once', 'allow_always']) : pick(['reject_once', 'reject_always'])
    return o ? { outcome: 'selected', optionId: o.optionId } : { outcome: 'cancelled' }
  }

  return m => {
    if (m.method == null) {  // an answer to the bridge
      let w = asked.get(m.id)
      asked.delete(m.id)
      m.error ? w?.reject(new Error(failure(m.error, name))) : w?.resolve(m.result ?? {})
      return []
    }
    if (m.id != null) {  // the agent asks
      write({ jsonrpc: '2.0', id: m.id, ...m.method === 'session/request_permission' ? { result: { outcome: grant(m.params ?? {}) } } : { error: { code: -32601, message: `Method not found: ${m.method}` } } })
      return []
    }
    let u = m.method === 'session/update' && !quiet && m.params?.update || {}
    if (u.sessionUpdate === 'agent_message_chunk' && u.content?.type === 'text' && u.content.text) {
      let t = (said && gap ? '\n\n' : '') + u.content.text
      said = true, gap = false
      return [{ text: t }]
    }
    if (u.sessionUpdate === 'agent_thought_chunk') return [{ thinking: true }]
    if (u.sessionUpdate === 'tool_call' || u.sessionUpdate === 'tool_call_update') return called(u)
    return []
  }
}

/** The executable NAME on PATH (or at its absolute path), or undefined. Relative PATH entries are skipped: no binary from the cwd. */
function which(name) {
  let exts = process.platform === 'win32' ? (process.env.PATHEXT ?? '.EXE').split(';') : ['']
  let dirs = isAbsolute(name) ? [''] : (process.env.PATH ?? '').split(delimiter).filter(dir => isAbsolute(dir))
  for (let dir of dirs) for (let ext of exts) {
    let file = dir ? join(dir, name + ext) : name + ext
    try { if (statSync(file).isFile()) return accessSync(file, constants.X_OK), file } catch {}
  }
}

/** The agents to chat with: --agent's first (a name, or an ACP agent's command line), then the rest of AGENTS on PATH. */
function agentsOf(chosen) {
  let out = new Map()
  if (chosen != null && !Object.hasOwn(AGENTS, chosen)) {
    let [command, ...args] = split(chosen), path = command && which(command)
    if (!path) throw new Error(`--agent: ${command ? `${command} not found` : 'empty'}; one of ${Object.keys(AGENTS).join(', ')}, or the command line of an agent that speaks ACP`)
    out.set(chosen, { name: chosen, path, acp: args })
  } else if (chosen != null && !which(AGENTS[chosen].command ?? chosen)) throw new Error(`--agent ${chosen}: not on PATH`)
  for (let id of [chosen, ...Object.keys(AGENTS)]) {
    let path = Object.hasOwn(AGENTS, id) && which(AGENTS[id].command ?? id)
    if (path && !out.has(id)) out.set(id, { ...AGENTS[id], path })
  }
  return out
}

/** What the last bridge kept: { url, key }. */
const kept = () => { try { return JSON.parse(readFileSync(BRIDGE, 'utf8')) } catch { return {} } }
// The address and the bridge's own key, kept for the next run and for MCP servers to find: the user's alone to read
function keep(url, key) {
  try {
    mkdirSync(dirname(BRIDGE), { recursive: true, mode: 0o700 })
    writeFileSync(BRIDGE, JSON.stringify({ url, key }) + '\n', { mode: 0o600 })
  } catch {}
}

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
  let o = { port: 7777, timeout: 30 }
  for (let i = 0; i < argv.length; i += 2) {
    let name = argv[i].replace(/^--/, ''), value = argv[i + 1]
    if (!['port', 'key', 'timeout', 'agent'].includes(name) || argv[i] === name) throw new Error(`unknown option ${argv[i]}: ${USAGE}`)
    if (value == null) throw new Error(`${argv[i]} needs a value: ${USAGE}`)
    o[name] = name === 'key' || name === 'agent' ? value : +value
  }
  if (!Number.isInteger(o.port) || o.port < 0 || o.port > 65535) throw new Error('--port: 0..65535, 0 picks a free one')
  if (!(o.timeout > 0)) throw new Error('--timeout: seconds a page has to answer a call, over 0')
  if (o.key === '') throw new Error('--key: not empty')
  o.key ??= process.env.AUDIO_BRIDGE_KEY || undefined
  o.own = !o.key  // a key given is that run's alone: a test's, a one-off's, never the user's next
  o.key ??= kept().key || randomBytes(16).toString('hex')
  o.agents = agentsOf(o.agent)
  return o
}

export default function bridge(argv = []) {
  let { port, key, own, timeout, agents } = options(argv)
  let first = agents.keys().next().value  // the agent a conversation starts with, unless the page names another
  let learned = new Map()  // agent id → the models an ACP agent said it has
  let listed = () => [...agents].map(([id, a]) => ({ id, name: a.name, models: learned.get(id) ?? a.models ?? [] }))
  timeout *= 1000
  let url, page = null              // the one connected page's event stream
  let calls = new Map()             // call id → { page, answer([status, body]) }
  let turns = new Map()             // chat turn id → { child, stop() }
  let send = (to, event) => to?.write(`data: ${JSON.stringify(event)}\n\n`)

  // GET /events: one page at a time; a new one replaces the old, which may still answer the calls it holds.
  function listen(res) {
    if (page) send(page, { type: 'replaced' }), page.end()
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store' })
    page = res
    send(res, { type: 'hello', version, agent: listed()[0] ?? null, agents: listed() })
    let beat = setInterval(() => res.write(':\n\n'), 15000)  // keeps proxies and idle timers from closing it
    res.on('close', () => {
      clearInterval(beat)
      if (page !== res) return
      page = null
      for (let c of calls.values()) if (c.page === res) c.answer([503, { error: 'The playground page disconnected' }])
    })
  }

  // POST /call: a tool call for the page; holds the request until the page replies, gives up after `timeout`.
  async function call({ tool, args }, res) {
    if (typeof tool !== 'string' || !tool) return reply(res, 400, { error: 'tool: a name, as state' })
    if (!page) return reply(res, 503, { error: 'No playground page is connected' })
    let id = randomBytes(8).toString('hex'), to = page
    let [status, out] = await new Promise(resolve => {
      let timer = setTimeout(() => resolve([504, { error: `The playground page did not answer ${tool} within ${timeout / 1000} s` }]), timeout)
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

  // POST /chat: one agent turn, its output streamed to the page as chat events. `agent`, one of those hello listed, the
  // first unless named. `history`, the conversation so far as the page keeps it ([{ role: 'user' | 'agent', text }]), is
  // told to an agent that does not hold it: no `session`, or one it no longer has.
  function chat({ text, session, history = [], agent = first, model }, res) {
    if (typeof text !== 'string' || !text.trim()) return reply(res, 400, { error: 'text: what to tell the agent' })
    if (!agents.size) return reply(res, 400, { error: `No agent on PATH: install one (${Object.values(AGENTS).slice(0, 6).map(a => a.name).join(', ')}, …), then start the bridge again` })
    if (!agents.has(agent)) return reply(res, 400, { error: `agent: one of ${[...agents.keys()].join(', ')}` })
    if (session && !(typeof session === 'string' && SESSION.test(session))) return reply(res, 400, { error: 'session: an id the agent gave' })
    if (!Array.isArray(history) || !history.every(m => typeof m?.text === 'string')) return reply(res, 400, { error: 'history: [{ role, text }]' })
    let models = listed().find(a => a.id === agent).models
    if (model != null && !models.some(m => m.id === model)) return reply(res, 400, { error: `model: one of ${models.map(m => m.id).join(', ') || `none (${agent} names none)`}` })
    if (!page) return reply(res, 503, { error: 'No playground page is connected' })
    let turn = randomBytes(8).toString('hex')
    run(turn, agent, text, session || undefined, history, model)
    reply(res, 202, { turn })
  }

  // The newest of what was said, up to RECALL chars, before the message
  function recall(history, text) {
    let told = [], size = 0
    for (let m of history.toReversed()) {
      if ((size += m.text.length) > RECALL) break
      told.unshift(`${m.role === 'user' ? 'User' : 'You'}: ${m.text}`)
    }
    return told.length ? `Our conversation so far, which you no longer hold:\n\n${told.join('\n\n')}\n\nThe user now says:\n\n${text}` : text
  }

  function run(turn, id, text, session, history, model) {
    let a = agents.get(id), parse
    let mcp = { command: process.execPath, args: [CLI, '--mcp', '--playground', url, '--key', key] }
    let child = spawn(a.path, a.acp ?? a.args(mcp, session, model), { stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, ...a.env, AUDIO_EDITOR: url, AUDIO_BRIDGE_KEY: key } })
    let over = false, said, problem, err = ''
    let emit = e => send(page, { type: 'chat', turn, ...e })
    // A session the agent cannot resume (started in another folder, another machine's, cleared) fails before the agent
    // names one: the same turn again, afresh, told what was said. An ACP agent stays to serve: its turn over, it goes.
    let end = (error, again = true) => {
      if (over) return
      over = true
      if (a.acp) child.kill()
      if (error && again && session && !said) return child.kill(), run(turn, id, text, undefined, history, model)
      emit(error ? { done: true, error } : { done: true })
    }
    let take = e => {
      if (over) return
      if (e.done) return end(e.error)
      if ('error' in e) problem = e.error
      // an agent's models, learned: every page told, as a hello tells them
      else if (e.models) { if (JSON.stringify(e.models) !== JSON.stringify(learned.get(id))) learned.set(id, e.models), send(page, { type: 'hello', version, agent: listed()[0] ?? null, agents: listed() }) }
      else if (!e.session) emit(e)
      else if (e.session !== said) emit({ session: said = e.session })
    }
    turns.set(turn, { child, stop() { end('Stopped', false); child.kill(); setTimeout(() => child.kill('SIGKILL'), 3000).unref() } })
    child.stdin.on('error', () => {})  // an agent may exit before reading
    let input = session ? text : recall(history, text)
    parse = a.acp ? acp(m => child.stdin.write(JSON.stringify(m) + '\n'), take, { text: input, session, mcp, name: a.name, model }) : (child.stdin.end(input), a.read())
    child.stderr.setEncoding('utf8').on('data', d => err = (err + d).slice(-4000))
    lines(child.stdout, line => {
      let m
      try { m = JSON.parse(line) } catch { return }
      if (!over) for (let e of parse(m)) take(e)
    })
    child.on('error', e => end(`${id}: ${e.message}`))
    child.on('close', (code, signal) => {
      if (turns.get(turn)?.child === child) turns.delete(turn)
      end(code === 0 ? problem : problem || err.trim().split('\n').at(-1) || `${id} exited with ${signal ?? `code ${code}`}`)
    })
  }

  // GET /file?path=P: a media file of this machine's, by its absolute path (~ the home), streamed for the page to open
  function file(path, res) {
    path = path?.replace(/^~(?=$|[\\/])/, homedir())
    if (!path || !isAbsolute(path)) return reply(res, 400, { error: 'path: an absolute path to an audio or video file' })
    let type = MEDIA[extname(path).slice(1).toLowerCase()], st
    if (!type) return reply(res, 415, { error: `Not an audio or video file: ${basename(path)}` })
    try { st = statSync(path) } catch {}
    if (!st?.isFile()) return reply(res, 404, { error: `No file at ${path}` })
    res.writeHead(200, { 'Content-Type': type, 'Content-Length': st.size })
    createReadStream(path).on('error', () => res.destroy()).pipe(res)
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
      if (req.method === 'GET' && pathname === '/file') return file(searchParams.get('path'), res)
      if (req.method === 'GET' && pathname === '/health') return reply(res, 200, { ok: true, page: !!page, agent: first ?? null, agents: [...agents.keys()] })
      if (req.method === 'POST' && Object.hasOwn(POST, pathname)) return await POST[pathname](await body(req), res)
      reply(res, 404, { error: `No ${req.method} ${pathname}` })
    } catch (e) { reply(res, e.status ?? 500, { error: e.message }) }
  })

  // stopped: the turns stopped, the page's stream ended as a stream ends (cut, the page sees a broken response, a
  // network error in its console), then gone
  let quit = () => {
    for (let t of turns.values()) t.stop()
    if (!page || page.writableEnded) process.exit(0)
    page.end(() => process.exit(0))
    setTimeout(() => process.exit(0), 500).unref()
  }
  process.on('SIGINT', quit)
  process.on('SIGTERM', quit)

  return new Promise((resolve, reject) => {
    server.once('error', e => reject(e.code === 'EADDRINUSE' ? new Error(`port ${port} is in use, another bridge? Pick one: --port N`) : e))
    server.listen(port, '127.0.0.1', () => {
      url = `http://127.0.0.1:${server.address().port}`
      if (own) keep(url, key)
      // where it is, the key to paste, the agents found, what to do: the key bold, the rest quiet, in a terminal
      let tty = process.stdout.isTTY && !process.env.NO_COLOR, ink = code => s => tty ? `\x1b[${code}m${s}\x1b[0m` : s
      let [dim, bold] = [ink(2), ink(1)], names = [...agents.values()].map(a => a.name)
      console.log([
        `audio bridge on ${url}`, '',
        `  ${dim('key')}     ${bold(key)}`,
        `  ${dim('agents')}  ${names.length ? names.join(', ') : `none found: install one (${Object.values(AGENTS).slice(0, 6).map(a => a.name).join(', ')}, …), then start again`}`, '',
        dim(`  In the playground's Agent panel, paste the key, then Connect.${own ? ' It stays the same next time.' : ''}`)
      ].join('\n'))
      resolve(server)
    })
  })
}
