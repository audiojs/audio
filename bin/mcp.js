/**
 * audio MCP server: the CLI as one tool, over stdio.
 *
 *   claude mcp add audio -- npx -y audio --mcp
 *
 * Each call runs `audio ARGS` in a child process and returns its output: stateless like the
 * protocol, reproducible in a shell. The tool description is skills/audio/SKILL.md, so agents
 * with and without a shell learn the same grammar. Hand-rolled JSON-RPC (a one-tool server needs
 * no SDK); serves modern (2026-07-28, per-request _meta) and legacy (initialize) clients.
 */
import { spawn } from 'child_process'
import { readFileSync } from 'fs'
import { homedir } from 'os'
import { createInterface } from 'readline'
import { fileURLToPath } from 'url'

const CLI = fileURLToPath(new URL('./cli.js', import.meta.url))
const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
const INFO = { name: 'audio', version }
const MODERN = ['2026-07-28'], LEGACY = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05']
const LIMIT = 20000  // chars of output per call: a beat/note list must not flood the context

const TOOL = {
  name: 'audio',
  title: 'Audio',
  description: readFileSync(new URL('../skills/audio/SKILL.md', import.meta.url), 'utf8').replace(/^---[\s\S]*?---\s*/, ''),
  inputSchema: {
    type: 'object',
    properties: {
      args: { type: 'string', description: 'Arguments after `audio`, shell-quoted, absolute paths: "/Users/me/voice.m4a trim normalize podcast save /Users/me/voice.mp3"' }
    },
    required: ['args'],
    additionalProperties: false
  }
}

/** Shell-style split: whitespace separates, quotes group, backslash escapes a quote/space/backslash (Windows paths survive), ~ is home. */
export function split(str) {
  let out = [], cur = null, q = null
  for (let i = 0; i < str.length; i++) {
    let c = str[i]
    if (c === '\\' && q !== "'" && /["'\\\s]/.test(str[i + 1] ?? '')) { cur = (cur ?? '') + str[++i]; continue }
    if (q) { if (c === q) q = null; else cur += c; continue }
    if (/\s/.test(c)) { if (cur != null) out.push(cur), cur = null; continue }
    if (c === '"' || c === "'") { q = c; cur ??= ''; continue }
    cur = (cur ?? '') + c
  }
  if (q) throw new Error(`unclosed ${q}`)
  if (cur != null) out.push(cur)
  return out.map(a => a === '~' || a.startsWith('~/') ? homedir() + a.slice(1) : a)
}

const running = new Map(), cancelled = new Set()  // request id → child process; ids the client gave up on

function run(id, argv) {
  return new Promise(resolve => {
    let child = spawn(process.execPath, [CLI, ...argv], { stdio: ['ignore', 'pipe', 'pipe'] })
    let out = '', err = ''
    running.set(id, child)
    child.stdout.setEncoding('utf8').on('data', d => out += d)
    child.stderr.setEncoding('utf8').on('data', d => err += d)
    child.on('error', e => resolve({ code: 1, out, err: err + e.message }))
    child.on('close', (code, signal) => resolve({ code: code ?? 1, out, err: err + (signal ? `killed by ${signal}` : '') }))
  }).finally(() => running.delete(id))
}

async function call(id, { args }) {
  let argv
  try { argv = Array.isArray(args) ? args.map(String) : split(String(args ?? '')) }
  catch (e) { return text(`audio: ${e.message}`, true) }
  if (argv[0] === 'audio') argv.shift()
  if (argv.includes('-')) return text('audio: stdin/stdout are not connected over MCP, use file paths', true)
  let { code, out, err } = await run(id, argv)
  if (cancelled.delete(id)) return null  // the spec forbids answering a cancelled request
  let body = [out, err].map(s => s.replace(/^\s*\n/, '').trimEnd()).filter(Boolean).join('\n')  // stderr carries "Saved …", "→ part", errors
  if (body.length > LIMIT) body = body.slice(0, LIMIT) + `\n… ${body.length - LIMIT} more chars cut: narrow with a range (0..30s) or fewer stats`
  return text(body || 'done', code !== 0)
}

const text = (t, isError = false) => ({ content: [{ type: 'text', text: t }], isError })
const send = m => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...m }) + '\n')

async function handle({ id, method, params }) {
  params ??= {}
  if (method === 'notifications/cancelled') {
    let child = running.get(params.requestId)
    if (child) cancelled.add(params.requestId), child.kill('SIGINT')  // SIGINT: a recording stops and saves
    return
  }
  if (id == null) return  // other notifications
  let ver = params._meta?.['io.modelcontextprotocol/protocolVersion']
  let supported = [...MODERN, ...LEGACY]
  if (ver && !supported.includes(ver)) return send({ id, error: { code: -32022, message: 'Unsupported protocol version', data: { supported, requested: ver } } })
  let done = result => send({ id, result: ver ? { resultType: 'complete', ...result } : result })

  switch (method) {
    case 'initialize': {
      let v = params.protocolVersion
      return done({ protocolVersion: LEGACY.includes(v) ? v : LEGACY[0], capabilities: { tools: {} }, serverInfo: INFO })
    }
    case 'server/discover': return done({ supportedVersions: supported, capabilities: { tools: {} }, _meta: { 'io.modelcontextprotocol/serverInfo': INFO } })
    case 'ping': return done({})
    case 'tools/list': return done({ tools: [TOOL] })
    case 'tools/call': {
      if (params.name !== TOOL.name) return send({ id, error: { code: -32602, message: `Unknown tool: ${params.name}` } })
      let result = await call(id, params.arguments ?? {})
      return result && done(result)
    }
    default: return send({ id, error: { code: -32601, message: `Method not found: ${method}` } })
  }
}

export default function serve() {
  let rl = createInterface({ input: process.stdin })
  rl.on('line', line => {
    if (!line.trim()) return
    let msg
    try { msg = JSON.parse(line) } catch { return send({ id: null, error: { code: -32700, message: 'Parse error' } }) }
    handle(msg).catch(e => msg.id != null && send({ id: msg.id, error: { code: -32603, message: e.message } }))
  })
  // Client closes stdin (or signals) to shut down: take in-flight children along, so no play/record outlives the server
  let exit = () => { for (let child of running.values()) child.kill(); process.exit(0) }
  rl.on('close', exit)
  process.on('SIGTERM', exit)
}
