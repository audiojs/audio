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
 *   audio --mcp --editor [URL] [--key K]
 *
 * adds the editor's tools (state, measure, edit, …) for the sound open in the user's audio editor,
 * a browser page: each goes to the bridge (`audio --bridge`, bin/bridge.js), which hands it to the
 * page and returns its answer: JSON as text, a picture ({ image: data URL }) as image content.
 * Without URL and key, the bridge running now, as it left them in BRIDGE: one line installs it in
 * any agent, `npx -y audio --mcp --editor`.
 */
import { spawn } from 'child_process'
import { readFileSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import { fileURLToPath } from 'url'

const CLI = fileURLToPath(new URL('./cli.js', import.meta.url))
const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
const INFO = { name: 'audio', version }
const MODERN = ['2026-07-28'], LEGACY = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05']
const LIMIT = 20000  // chars of output per call: a beat/note list must not flood the context
const SERVER = 'io.modelcontextprotocol/serverInfo'
const CACHE = { ttlMs: 3600000, cacheScope: 'public' }  // modern lists must say how long they stay fresh: ours never change while the process lives
const INVALID = { code: -32600, message: 'Invalid Request' }
/** Where a running bridge keeps its address and key, for an editor tool to find it */
export const BRIDGE = join(process.env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'audio', 'bridge.json')

export const TOOL = {
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

// The editor's tools: the page implements them, the bridge carries them; names and arguments are the
// bridge protocol. Bare verbs: clients name them by the server, mcp__audio__edit. The descriptions
// are all an agent knows of the page, so they teach the script.
const def = (name, title, description, properties = {}, required = [], readOnlyHint = false) => ({
  name, title, description, inputSchema: { type: 'object', properties, required, additionalProperties: false },
  annotations: { readOnlyHint, destructiveHint: false }  // every change is one undo step
})
const secs = description => ({ type: 'number', description })
export const EDITOR = [
  def('state', 'Editor state', "The sound open in the user's audio editor, a browser page connected through `audio --bridge`: { script, duration, sampleRate, channels, selection: [a, b] in seconds or null, band: [low, high] Hz or null, cursor, markers, stats: { peak dBFS, loudness LUFS }, steps: [{ call, on }] the script's edits in order (`step` takes their index), problem }, problem being the script's error or null. Read it first, and again when the user may have acted: they edit the same sound, every tool here acts on it, and each change shows and sounds in the page at once. Measure anything else with `measure`, see it with `look`.", {}, [], true),
  def('script', 'Replace the script', `Replace the whole script and run it; answers once the sound has rendered: { ok, problem?, duration? }. One undo step.
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
Mark: mark(time, 'label') puts a finding on the user's timeline; markers export as WAV cues and MP3 chapters.
Plugin ops take named params, .compressor({ threshold: -24, ratio: 3 }); the audio tool's \`OP --help\` lists an op's params.`,
    { code: { type: 'string', description: 'The whole script' } }, ['code']),
  def('edit', 'Add an edit', "Append one call to the end of the script's chain and run it, as one undo step; answers as `script` does. Prefer it to `script` for a single step: the rest of the user's script stays as they wrote it.",
    { call: { type: 'string', description: "One method call as `script` describes, no leading dot: \"normalize(-16, 'lufs')\", \"remove({ at: 1, d: 0.5, xfade: 0.01 })\"" } }, ['call']),
  def('measure', 'Measure the sound', `Run JavaScript on the sound open in the page; its last expression, awaited, comes back as JSON (arrays whole, -Infinity as "-Infinity"). Read-only: the script, the sound and its history stay as they are. In scope: out, the output as the user hears it, every edit in, its markers; src, the file as it opened (null for a generated sound); audio, the library. Times are seconds; a stat takes { at, d } for a range, { bins: n } for n values across it (where, not only how much), { channel: i } for one channel.
  out.stat(['loudness', 'dialog', 'truepeak', 'lra', 'noisefloor'])
  out.stat('loudness', { bins: Math.ceil(out.duration) })  // each second
  out.stat('db', { at: 12, d: 0.5 })
  out.stat('spectrum', { at: 3, d: 1, bins: 64 })  // dB per mel band from 30 Hz, A-weighted unless weight: false
  out.silence({ threshold: -45, minDuration: 0.3 })  // pauses, [{ at, duration }]
  out.stat('notes'); out.stat('onsets'); out.detect()  // pitch, attacks, tempo
  src.stat('loudness')  // before the edits
Stats: db rms peak crest dc clipping loudness momentary shortterm dialog truepeak lra dr replaygain noisefloor correlation centroid flatness rolloff slope spectrum ltas cepstrum silence hits onsets beats bpm key chords notes melody; Object.keys(audio.stat()) lists the built-in ones. An answer over 20000 chars is cut: ask for fewer bins or a range.`,
    { code: { type: 'string', description: 'JavaScript; its last expression is the answer' } }, ['code'], true),
  def('look', 'Look at the sound', 'A picture of the output as the page draws it, a PNG: the waveform over the spectrogram, the times and frequencies labelled, from at for d seconds; without them, what the user sees. Clicks, breaths, sibilance, hum lines, a band cut off show here before any number does. Your last edit shows over it as its card draws it (its range, a threshold, a fade); a pitch edit, the pitch curve before it, dashed, and after. The user\'s view stays as it is.',
    { at: secs('Start, seconds'), d: secs('Duration, seconds') }, [], true),
  def('select', 'Select', "Select a range in the page, { at, d }; with low and high, a box of that band on the spectrogram, which then shows (for spectral([low, high], dB, { at, d }), repair()); or place the cursor, { cursor }. Brought into the user's view; shows them a place, changes no sound.",
    { at: secs('Range start, seconds'), d: secs('Range duration, seconds'), low: { type: 'number', description: 'Band bottom, Hz' }, high: { type: 'number', description: 'Band top, Hz' }, cursor: secs('Cursor position, seconds') }),
  def('scrub', 'Scrub', "Move the user's cursor as a held one moves, the moment under it sounding: held at `at` for d seconds, or swept to `to` over d seconds (by default as fast as it plays). To point the user's ear at a place; `play` plays it as it is.",
    { at: secs('Where it starts, seconds'), to: secs('Where it ends, seconds'), d: secs('How long, seconds') }, ['at']),
  def('step', 'Change an edit', 'Act on one edit of the chain, by its index in `state`.steps, as its card in the Edits panel does: on: false turns it off (commented out, kept), on: true back on; remove: true takes it away; to: n moves it to stand at index n. One undo step; answers as `script` does.',
    { index: { type: 'integer', description: 'The edit, its index in `state`.steps' }, on: { type: 'boolean', description: 'Turn it on or off' }, remove: { type: 'boolean', description: 'Take it away' }, to: { type: 'integer', description: 'Move it to this index' } }, ['index']),
  def('open', 'Open a file', "Open an audio or video file of the user's machine in the editor, in a tab of its own, by its absolute path (~ the home): the bridge reads it. Answers as `script` does, with the name the script opens it by.",
    { path: { type: 'string', description: 'Absolute path, as /Users/me/voice.wav or ~/voice.wav' } }, ['path']),
  def('play', 'Play', "Play the output on the user's speakers, from at for d seconds; without them, as the page's play button would. Let the user hear a change; `stop` stops. original: true plays the file as it opened, level-matched to the output, so the two compare fairly (the page's B key); false, the output again.",
    { at: secs('Start, seconds'), d: secs('Duration, seconds'), original: { type: 'boolean', description: 'true: the file as it opened, level-matched; false: the output' } }),
  def('stop', 'Stop', 'Stop playback in the page.'),
  def('check', 'Check against a spec', "Check the output against a delivery spec: 'podcast' (Apple, -16 LUFS), 'streaming' (Spotify, -14), 'broadcast' (EBU R 128, -23), 'netflix' (dialog -27, true peak -2 dBTP), 'acx' (audiobook). Answers the report, { spec, pass, rules: [{ name, value, unit, min, max, pass }] }: tell the user a fail as it is.",
    { spec: { type: 'string', description: 'podcast, streaming, broadcast, netflix or acx' } }, ['spec'], true),
  def('undo', 'Undo', 'Undo the last change to the script, as Cmd+Z in the page.'),
  def('redo', 'Redo', 'Redo the change `undo` undid.')
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
let bridge = null  // with --editor: { url, key } as given, either one possibly missing

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
  // A failed `check` prints its report and exits 1: a result, not a tool error (its errors write only stderr)
  return text(cut(body, 'narrow with a range (0..30s) or fewer stats') || 'done', code !== 0 && !(argv.includes('check') && out.trim()))
}

/** The bridge an editor call goes to: URL and key as given, what is missing as the running bridge left it in BRIDGE. */
function locate({ url, key } = {}) {
  let saved = {}
  if (!url || !key) try { saved = JSON.parse(readFileSync(BRIDGE, 'utf8')) } catch {}
  return { url: url || saved.url || 'http://127.0.0.1:7777', key: key || saved.key }
}
const given = () => ({ url: process.env.AUDIO_EDITOR, key: process.env.AUDIO_BRIDGE_KEY })

/**
 * An editor tool call, through the bridge to the page, as MCP content: its result as JSON text, a picture as an image;
 * its error a tool error the model can act on (no bridge, no page, a timeout, the page's own). `to`: { url, key },
 * either one missing found as locate() finds it; by default AUDIO_EDITOR and AUDIO_BRIDGE_KEY. Throws only aborted.
 */
export async function reach(tool, args, { signal, to = given() } = {}) {
  let { url, key } = locate(to), res
  if (!key) return text(`${tool}: no bridge running: the user runs \`audio --bridge\` and opens the editor`, true)
  try {
    res = await fetch(`${url}/call`, {
      method: 'POST', signal, body: JSON.stringify({ tool, args }),
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' }
    })
  } catch (e) {
    if (signal?.aborted) throw e
    return text(`${tool}: no bridge at ${url} (${e.cause?.code ?? e.message}): the user runs \`audio --bridge\` and opens the editor`, true)
  }
  let { result, error } = await res.json().catch(() => ({ error: `HTTP ${res.status}` }))
  if (error != null) return text(`${tool}: ${error}`, true)
  let png = typeof result?.image === 'string' && result.image.match(/^data:(image\/\w+);base64,(.+)$/)
  if (png) return { content: [{ type: 'image', mimeType: png[1], data: png[2] }, ...result.text ? [{ type: 'text', text: result.text }] : []], isError: false }
  return text(cut(result == null ? 'done' : typeof result === 'string' ? result : JSON.stringify(result)))
}

async function relay(id, tool, args) {
  let ctl = new AbortController()
  running.set(id, { kill: () => ctl.abort() })
  try {
    let result = await reach(tool, args, { signal: ctl.signal, to: bridge })
    return cancelled.delete(id) ? null : result
  } catch (e) {
    if (cancelled.delete(id)) return null
    throw e
  } finally { running.delete(id) }
}

/** Each line of a stream to `fn`, split at \n alone: JSON holds U+2028 and U+2029 as they are, where readline splits too. */
export function lines(stream, fn) {
  let rest = ''
  stream.setEncoding('utf8')
  stream.on('data', d => {
    let all = (rest + d).split('\n')
    rest = all.pop()
    for (let line of all) fn(line.endsWith('\r') ? line.slice(0, -1) : line)
  })
  stream.on('end', () => rest && fn(rest))
  return stream
}

const text = (t, isError = false) => ({ content: [{ type: 'text', text: t }], isError })
const cut = (t, how = 'ask for fewer bins or a range') => t.length > LIMIT ? t.slice(0, LIMIT) + `\n… ${t.length - LIMIT} more chars cut: ${how}` : t
const wrap = m => ({ jsonrpc: '2.0', ...m })
const send = m => process.stdout.write(JSON.stringify(Array.isArray(m) ? m.map(wrap) : wrap(m)) + '\n')
const tools = () => bridge ? [TOOL, ...EDITOR] : [TOOL]

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

/** argv after --mcp: [--editor [URL]] [--key K], URL and key also from AUDIO_EDITOR and AUDIO_BRIDGE_KEY. */
function options(argv) {
  if (!argv.includes('--editor')) return null
  let value = flag => { let v = argv[argv.indexOf(flag) + 1]; return argv.includes(flag) && v && !v.startsWith('--') ? v : undefined }
  let url = value('--editor') || given().url
  return { url: url && (/^https?:\/\//.test(url) ? url : 'http://' + url).replace(/\/+$/, ''), key: value('--key') || given().key }
}

export default function serve(argv = []) {
  bridge = options(argv)
  lines(process.stdin, async line => {
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
  process.stdin.on('end', exit)
  process.on('SIGTERM', exit)
}
