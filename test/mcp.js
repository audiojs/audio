// MCP server (bin/mcp.js): protocol over real stdio, the one tool end-to-end, the argument splitter.
import test from 'tst'
import { spawn } from 'child_process'
import { mkdtempSync, readFileSync, rmSync, statSync } from 'fs'
import { homedir, tmpdir } from 'os'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import audio from '../audio.js'
import { split } from '../bin/mcp.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const bin = join(root, 'bin', 'cli.js')
const lena = fileURLToPath((await import('audio-lena')).default.url('wav'))
const sleep = ms => new Promise(r => setTimeout(r, ms))

/** Minimal MCP client over the server's stdio; stdin stays open until close(). */
function client() {
  let proc = spawn(process.execPath, [bin, '--mcp'], { cwd: root, stdio: ['pipe', 'pipe', 'inherit'] })
  let pending = new Map(), seen = [], buf = '', id = 0
  proc.stdout.setEncoding('utf8').on('data', d => {
    let lines = (buf += d).split('\n')
    buf = lines.pop()
    for (let line of lines) {
      let msg = JSON.parse(line)
      seen.push(msg)
      pending.get(msg.id)?.(msg)
      pending.delete(msg.id)
    }
  })
  let write = m => proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', ...m }) + '\n')
  let request = (method, params) => new Promise(r => { let i = ++id; pending.set(i, r); write({ id: i, method, params }) })
  return {
    seen, request,
    notify: (method, params) => write({ method, params }),
    call: async args => (await request('tools/call', { name: 'audio', arguments: { args } })).result,
    close: () => new Promise(r => { proc.on('close', r); proc.stdin.end() })
  }
}

const E2E = { timeout: 30000 }  // each call spawns the CLI
const MODERN = { _meta: { 'io.modelcontextprotocol/protocolVersion': '2026-07-28' } }

test('mcp: legacy initialize echoes a known version, falls back to latest legacy for unknown', E2E, async t => {
  let c = client()
  try {
    let a = await c.request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '0' } })
    t.is(a.result.protocolVersion, '2025-06-18')
    t.is(a.result.serverInfo.name, 'audio')
    t.ok(a.result.capabilities.tools, 'tools capability')
    t.ok(!('resultType' in a.result), 'legacy results carry no resultType')
    let b = await c.request('initialize', { protocolVersion: '2099-01-01' })
    t.is(b.result.protocolVersion, '2025-11-25')
  } finally { await c.close() }
})

test('mcp: modern discover, stateless call, unsupported version error', E2E, async t => {
  let c = client()
  try {
    let d = await c.request('server/discover', MODERN)
    t.is(d.result.resultType, 'complete')
    t.ok(d.result.supportedVersions.includes('2026-07-28'), 'modern version supported')
    t.ok(d.result.supportedVersions.includes('2025-11-25'), 'legacy version supported')
    t.is(d.result._meta['io.modelcontextprotocol/serverInfo'].name, 'audio')

    // no initialize: a modern client may call tools directly
    let r = await c.request('tools/call', { ...MODERN, name: 'audio', arguments: { args: `${lena} stat loudness` } })
    t.is(r.result.resultType, 'complete')
    t.ok(/loudness\s+-\d/.test(r.result.content[0].text), r.result.content[0].text)

    let e = await c.request('tools/list', { _meta: { 'io.modelcontextprotocol/protocolVersion': '1900-01-01' } })
    t.is(e.error.code, -32022, 'UnsupportedProtocolVersionError')
    t.is(e.error.data.requested, '1900-01-01')
  } finally { await c.close() }
})

test('mcp: one tool, described by the skill, within the 2048-char client limit', E2E, async t => {
  let c = client()
  try {
    let { result } = await c.request('tools/list')
    t.is(result.tools.length, 1)
    let [tool] = result.tools
    t.is(tool.name, 'audio')
    t.is(tool.inputSchema.required[0], 'args')
    let skill = readFileSync(join(root, 'skills/audio/SKILL.md'), 'utf8')
    t.ok(skill.startsWith('---\nname: audio\n'), 'skill frontmatter')
    t.ok(skill.endsWith(tool.description), 'description is the skill body')
    t.ok(!tool.description.startsWith('---'), 'frontmatter stripped')
    // Claude Code truncates MCP tool descriptions past 2048 chars (anthropics/claude-code#87650)
    t.ok(tool.description.length <= 2048, `description ${tool.description.length} ≤ 2048 chars`)
  } finally { await c.close() }
})

test('mcp: overview, preview chain, save to a quoted path with spaces', E2E, async t => {
  let c = client(), dir = mkdtempSync(join(tmpdir(), 'audio-mcp-'))
  try {
    let o = await c.call(lena)
    t.is(o.isError, false)
    t.ok(o.content[0].text.includes('Duration:') && o.content[0].text.includes('LUFS'), 'overview')

    // preview: stats after transforms, nothing written; normalize podcast targets -16 LUFS (README, Apple Podcasts spec)
    let p = await c.call(`${lena} normalize podcast stat loudness`)
    let lufs = +p.content[0].text.match(/loudness\s+(-?[\d.]+)/)[1]
    t.ok(Math.abs(lufs + 16) < 0.5, `preview ${lufs} LUFS ≈ -16`)

    let out = join(dir, 'my take.wav')
    let s = await c.call(`audio ${lena} normalize podcast save "${out}"`)  // leading `audio` tolerated
    t.is(s.isError, false, s.content[0].text)
    t.ok(s.content[0].text.startsWith('Saved '), s.content[0].text)
    t.ok(!/\x1b|\r/.test(s.content[0].text), 'no terminal escapes in piped output')
    let a = await audio(out)
    t.ok(Math.abs(await a.stat('loudness') + 16) < 0.5, 'saved file measures ≈ -16 LUFS')

    // never clobbers without -f
    let size = statSync(out).size
    let e = await c.call(`${lena} gain -6db save "${out}"`)
    t.is(e.isError, true)
    t.ok(e.content[0].text.includes('--force'), e.content[0].text)
    t.is(statSync(out).size, size, 'file untouched')
  } finally { await c.close(); rmSync(dir, { recursive: true, force: true }) }
})

test('mcp: errors come back as tool errors the model can act on', E2E, async t => {
  let c = client()
  try {
    let missing = await c.call('/no/such/file.wav')
    t.is(missing.isError, true)
    t.ok(missing.content[0].text.startsWith('audio: '), missing.content[0].text)

    let stdio = await c.call(`${lena} save -`)
    t.is(stdio.isError, true)
    t.ok(stdio.content[0].text.includes('file paths'), stdio.content[0].text)

    let empty = await c.call('')
    t.is(empty.isError, true)
    t.ok(empty.content[0].text.includes('Usage:'), 'no args → usage')

    let nul = (await c.request('tools/call', { name: 'audio', arguments: null })).result
    t.is(nul.isError, true, 'null arguments → usage, not a crash')

    let noInput = await c.call('normalize')
    t.is(noInput.isError, true)
    t.ok(noInput.content[0].text.includes('no input'), noInput.content[0].text)

    let quote = await c.call(`"${lena}`)
    t.is(quote.isError, true)
    t.ok(quote.content[0].text.includes('unclosed'), quote.content[0].text)

    let tool = await c.request('tools/call', { name: 'nope', arguments: {} })
    t.is(tool.error.code, -32602)
    let method = await c.request('nope/nope')
    t.is(method.error.code, -32601)
    t.is((await c.request('ping')).result, {}, 'ping')
  } finally { await c.close() }
})

test('mcp: help reaches the model: ops, stat names, plugins', E2E, async t => {
  let c = client()
  try {
    let h = (await c.call('--help')).content[0].text
    t.ok(h.includes('Stats (') && h.includes('loudness'), 'stat names listed')
    t.ok(h.includes('Plugins (') && h.includes('compressor') && h.includes('truepeak'), 'plugin names listed')
    let s = (await c.call('stat --help')).content[0].text
    t.ok(s.includes('centroid') && s.includes('chords'), 'stat --help lists names')
    t.ok(!s.includes('-o out.wav'), 'sink examples carry no save flag')
  } finally { await c.close() }
})

test('mcp: long output is cut with a hint', E2E, async t => {
  let c = client()
  try {
    let r = await c.call(`${lena} stat min 3000`)  // ~54k chars uncut
    let text = r.content[0].text
    t.is(r.isError, false)
    t.ok(text.length < 20200, `${text.length} chars`)
    t.ok(text.includes('more chars cut'), 'says it was cut and how to narrow')
  } finally { await c.close() }
})

test('mcp: cancelled call is killed and never answered', { timeout: 15000 }, async t => {
  let c = client()
  try {
    c.request('tools/call', { name: 'audio', arguments: { args: `${lena} stat notes chords` } })  // id 1, ~4s uncancelled
    c.notify('notifications/cancelled', { requestId: 1, reason: 'test' })
    t.ok((await c.request('ping')).result, 'server stays responsive')
    await sleep(5000)
    t.ok(!c.seen.some(m => m.id === 1), 'no response for the cancelled request')
  } finally { await c.close() }
})

test('mcp: split: quotes, escapes, tilde, Windows paths', t => {
  t.is(split('a.wav gain -3db save out.wav'), ['a.wav', 'gain', '-3db', 'save', 'out.wav'])
  t.is(split(`"my take.wav" save 'out file.mp3'`), ['my take.wav', 'save', 'out file.mp3'])
  t.is(split('my\\ take.wav'), ['my take.wav'])
  t.is(split(`"Krishna's kirtan.mp3"`), ["Krishna's kirtan.mp3"])
  t.is(split(`'say "hi".wav'`), ['say "hi".wav'])
  t.is(split('C:\\Users\\me\\a.wav save C:\\out.wav'), ['C:\\Users\\me\\a.wav', 'save', 'C:\\out.wav'])
  t.is(split('~/a.wav'), [homedir() + '/a.wav'])
  t.is(split('a~b.wav'), ['a~b.wav'])
  t.is(split(`''`), [''])
  t.is(split('  '), [])
  t.throws(() => split('"open'), /unclosed/)
})
