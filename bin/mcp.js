/**
 * audio MCP server: the CLI as one tool, over stdio.
 *
 *   claude mcp add audio -- npx -y audio --mcp
 *
 * Each call runs `audio ARGS` in a child process and returns its output: stateless like the
 * protocol, reproducible in a shell. The tool description is skills/audio/SKILL.md, so agents
 * with and without a shell learn the same grammar. Hand-rolled JSON-RPC (a few tools need no
 * SDK); serves modern (2026-07-28, per-request _meta) and legacy (initialize) clients.
 *
 *   audio --mcp --repl http://127.0.0.1:7777 --key K
 *
 * adds the REPL's tools (repl_state, repl_edit, …) for the sound open in the user's browser: each
 * goes to the bridge (`audio --bridge`, bin/bridge.js), which hands it to the page and returns its answer.
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
const SERVER = 'io.modelcontextprotocol/serverInfo'
const CACHE = { ttlMs: 3600000, cacheScope: 'public' }  // modern lists must say how long they stay fresh: ours never change while the process lives
const INVALID = { code: -32600, message: 'Invalid Request' }

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

// The REPL's tools: the page implements them, the bridge carries them; names and arguments are the
// bridge protocol. The descriptions are all an agent knows of the page, so they teach the script.
const repl = (name, title, description, properties = {}, required = [], readOnlyHint = false) => ({
  name, title, description, inputSchema: { type: 'object', properties, required, additionalProperties: false },
  annotations: { readOnlyHint, destructiveHint: false }  // every change is one undo step
})
const secs = description => ({ type: 'number', description })
const REPL = [
  repl('repl_state', 'REPL state', "The sound open in the user's audio REPL, a browser page connected through `audio --bridge`: { script, duration, sampleRate, channels, selection: [a, b] in seconds or null, cursor, markers, stats: { peak dBFS, loudness LUFS }, problem }, problem being the script's error or null. Read it first, and again when the user may have acted: they edit the same sound, every repl_ tool acts on it, and each change shows and sounds in the page at once.", {}, [], true),
  repl('repl_script', 'Replace REPL script', `Replace the whole REPL script and run it; answers once the sound has rendered: { ok, problem?, duration? }. One undo step.
The script is JavaScript; its last expression is the sound the page shows and plays: the source, then a chain of the audio library's methods (API: https://github.com/audiojs/audio#api):
  audio('voice.wav')
    .highpass(80)
    .trim()
    .normalize('podcast')
    .fade(0.05, 0.05)
Keep the source the script has. Times are seconds, or '1:30', '500ms'; negative counts from the end. d = duration, xfade = crossfade. Every op takes a trailing range { at, d }: .gain(-6, { at: 10, d: 5 }).
Edit: trim shrink crop remove(at, d, xfade) cut copy paste move({ at, d, to }) insert pad repeat reverse
Level: gain(dB) normalize('podcast'|'streaming'|'broadcast'|dB, 'lufs') fade(in, out) pan mix crossfade remix dither
Filter: highpass lowpass bandpass notch allpass lowshelf highshelf eq(Hz, dB, Q) tilt geq match
Dynamics: compressor limiter gate expander deesser leveler ducker multiband
Repair: omlsa deepfilter dehum declick decrackle declip dereverb deplosive debreath dewind roomtone spectral repair
Time, pitch: speed stretch pitch warp resample tune
Effect: delay chorus flanger phaser tremolo vibrato distortion tape exciter freeverb plate widener vocals, more
Plugin ops take named params, .compressor({ threshold: -24, ratio: 3 }); the audio tool's \`OP --help\` lists an op's params.`,
    { code: { type: 'string', description: 'The whole script' } }, ['code']),
  repl('repl_edit', 'Add a REPL step', "Append one call to the end of the REPL script's chain and run it, as one undo step; answers like repl_script. Prefer it to repl_script for a single step: the rest of the user's script stays as they wrote it.",
    { call: { type: 'string', description: "One method call as repl_script describes, no leading dot: \"normalize(-16, 'lufs')\", \"remove({ at: 1, d: 0.5, xfade: 0.01 })\"" } }, ['call']),
  repl('repl_select', 'Select in REPL', 'Select a range in the page, { at, d }, or place the cursor, { cursor }: shows the user a place, changes no sound.',
    { at: secs('Range start, seconds'), d: secs('Range duration, seconds'), cursor: secs('Cursor position, seconds') }),
  repl('repl_play', 'Play REPL sound', "Play the output on the user's speakers, from at for d seconds; without them, as the page's play button would. Let the user hear a change; repl_stop stops.",
    { at: secs('Start, seconds'), d: secs('Duration, seconds') }),
  repl('repl_stop', 'Stop REPL playback', 'Stop playback in the page.'),
  repl('repl_check', 'Check REPL output', "Check the output against a delivery spec: 'podcast' (Apple, -16 LUFS), 'streaming' (Spotify, -14), 'broadcast' (EBU R 128, -23), 'netflix' (dialog -27, true peak -2 dBTP), 'acx' (audiobook). Answers the report, { spec, pass, rules: [{ name, value, unit, min, max, pass }] }: tell the user a fail as it is.",
    { spec: { type: 'string', description: 'podcast, streaming, broadcast, netflix or acx' } }, ['spec'], true),
  repl('repl_undo', 'Undo in REPL', 'Undo the last change to the REPL script, as Cmd+Z in the page.'),
  repl('repl_redo', 'Redo in REPL', 'Redo the change repl_undo undid.')
]

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

const running = new Map(), cancelled = new Set()  // request id → what to kill (a child, a fetch); ids the client gave up on
let bridge = null  // { url, key } with --repl

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
  // A failed `check` prints its report and exits 1: a result, not a tool error (its errors write only stderr)
  return text(body || 'done', code !== 0 && !(argv.includes('check') && out.trim()))
}

/** A REPL tool call, through the bridge to the page: its result as JSON text, its error as a tool error. */
async function relay(id, tool, args) {
  let ctl = new AbortController()
  running.set(id, { kill: () => ctl.abort() })
  try {
    let res = await fetch(`${bridge.url}/call`, {
      method: 'POST', signal: ctl.signal, body: JSON.stringify({ tool, args }),
      headers: { authorization: `Bearer ${bridge.key}`, 'content-type': 'application/json' }
    })
    let { result, error } = await res.json().catch(() => ({ error: `HTTP ${res.status}` }))
    if (cancelled.delete(id)) return null
    if (error != null) return text(`${tool}: ${error}`, true)  // no page, a timeout, the page's own error: the model can act on each
    return text(result == null ? 'done' : typeof result === 'string' ? result : JSON.stringify(result))
  } catch (e) {
    if (cancelled.delete(id)) return null
    return text(`${tool}: no bridge at ${bridge.url} (${e.cause?.code ?? e.message}): the user runs \`audio --bridge\` and opens the REPL`, true)
  } finally { running.delete(id) }
}

const text = (t, isError = false) => ({ content: [{ type: 'text', text: t }], isError })
const wrap = m => ({ jsonrpc: '2.0', ...m })
const send = m => process.stdout.write(JSON.stringify(Array.isArray(m) ? m.map(wrap) : wrap(m)) + '\n')
const tools = () => bridge ? [TOOL, ...REPL] : [TOOL]

/** One message → its response, or null for a notification, a response, a cancelled request. */
async function handle(msg) {
  if (msg?.constructor !== Object) return { id: null, error: INVALID }
  let { id, method, params } = msg
  if (typeof method !== 'string') return 'result' in msg || 'error' in msg ? null : { id: id ?? null, error: INVALID }  // we send no requests, so no response is ours to answer
  params = params?.constructor === Object ? params : {}
  if (method === 'notifications/cancelled') {
    let job = running.get(params.requestId)
    if (job) cancelled.add(params.requestId), job.kill('SIGINT')  // SIGINT: a recording stops and saves
    return null
  }
  if (id == null) return null  // other notifications
  let ver = params._meta?.['io.modelcontextprotocol/protocolVersion']
  let supported = [...MODERN, ...LEGACY]
  if (ver && !supported.includes(ver)) return { id, error: { code: -32022, message: 'Unsupported protocol version', data: { supported, requested: ver } } }
  // Modern results carry their type and the server's identity; list results, how long to cache them
  let done = (result, cache) => ({ id, result: ver ? { resultType: 'complete', ...result, ...(cache && CACHE), _meta: { [SERVER]: INFO } } : result })

  switch (method) {
    case 'initialize': {
      let v = params.protocolVersion
      return done({ protocolVersion: LEGACY.includes(v) ? v : LEGACY[0], capabilities: { tools: {} }, serverInfo: INFO })
    }
    case 'server/discover': return done({ supportedVersions: supported, capabilities: { tools: {} } }, true)
    case 'ping': return done({})
    case 'tools/list': return done({ tools: tools() }, true)
    case 'tools/call': {
      let tool = tools().find(t => t.name === params.name)
      if (!tool) return { id, error: { code: -32602, message: `Unknown tool: ${params.name}` } }
      let args = params.arguments ?? {}
      let result = tool === TOOL ? await call(id, args) : await relay(id, tool.name, args?.constructor === Object ? args : {})
      return result && done(result)
    }
    default: return { id, error: { code: -32601, message: `Method not found: ${method}` } }
  }
}
const answer = msg => handle(msg).catch(e => msg?.id != null ? { id: msg.id, error: { code: -32603, message: e.message } } : null)

/** argv after --mcp: [--repl URL] [--key K], the key also from AUDIO_BRIDGE_KEY. */
function options(argv) {
  if (!argv.includes('--repl')) return null
  let value = flag => argv.includes(flag) ? argv[argv.indexOf(flag) + 1] : undefined
  let url = value('--repl'), key = value('--key') ?? process.env.AUDIO_BRIDGE_KEY
  if (!key) throw new Error('--repl needs the key `audio --bridge` printed: --key K, or AUDIO_BRIDGE_KEY')
  return { url: url?.startsWith('http') ? url.replace(/\/+$/, '') : 'http://127.0.0.1:7777', key }
}

export default function serve(argv = []) {
  bridge = options(argv)
  let rl = createInterface({ input: process.stdin })
  rl.on('line', async line => {
    if (!line.trim()) return
    let msg
    try { msg = JSON.parse(line) } catch { return send({ id: null, error: { code: -32700, message: 'Parse error' } }) }
    if (!Array.isArray(msg)) return answer(msg).then(r => r && send(r))
    // A batch (JSON-RPC 2.0, which 2025-03-26 clients may send): one array of the responses it has
    if (!msg.length) return send({ id: null, error: INVALID })
    let out = (await Promise.all(msg.map(answer))).filter(Boolean)
    if (out.length) send(out)
  })
  // Client closes stdin (or signals) to shut down: take in-flight children along, so no play/record outlives the server
  let exit = () => { for (let child of running.values()) child.kill(); process.exit(0) }
  rl.on('close', exit)
  process.on('SIGTERM', exit)
}
