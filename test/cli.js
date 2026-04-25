import test from 'tst'
import { parseValue, parseRange, parseArgs, showOpHelp, HELP, progressBar, fmtTime, isOpName, isVerb, isStatName, SOURCE_VERBS, SINK_VERBS, prompt, playerSave, defaultSavePath } from '../bin/cli.js'
import { EventEmitter } from 'events'
import audio from '../audio.js'
import { spawn } from 'child_process'
import { fileURLToPath } from 'url'
import { writeFileSync, unlinkSync, readFileSync, existsSync, mkdtempSync, rmSync } from 'fs'
import { dirname, join } from 'path'
import { tmpdir } from 'os'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const projectRoot = join(__dirname, '..')
const binPath = join(projectRoot, 'bin', 'cli.js')

let lenaPath, lenaMp3
try {
  let lena = (await import('audio-lena')).default
  lenaPath = fileURLToPath(lena.url('wav'))
  lenaMp3 = fileURLToPath(lena.url('mp3'))
} catch (e) {
  console.warn('audio-lena not available for CLI tests')
}

// ── Argument Parsing ─────────────────────────────────────────────────────

test('parseArgs — chain: source transform sink', t => {
  let r = parseArgs(['in.wav', 'gain', '-3db', 'save', 'out.wav'])
  t.is(r.source, 'in.wav', 'source')
  t.is(r.transforms.length, 1, '1 transform')
  t.is(r.transforms[0].name, 'gain', 'gain transform')
  t.is(r.sink.name, 'save', 'save sink')
  t.is(r.sink.args[0], 'out.wav', 'sink path')
})

test('parseArgs — multiple transforms', t => {
  let r = parseArgs(['in.wav', 'gain', '-3', 'trim', 'normalize', 'save', 'out.wav'])
  t.is(r.transforms.length, 3, '3 transforms')
  t.is(r.transforms[0].name, 'gain')
  t.is(r.transforms[1].name, 'trim')
  t.is(r.transforms[2].name, 'normalize')
})

test('parseArgs — transform with multiple args', t => {
  let r = parseArgs(['in.wav', 'fade', '1.5s', 'linear'])
  t.is(r.transforms[0].name, 'fade')
  t.is(r.transforms[0].args.length, 1, 'duration in args')
  t.is(r.transforms[0].curve, 'linear', 'curve as option')
})

test('parseArgs — range syntax on transform', t => {
  let r = parseArgs(['in.wav', 'gain', '-3db', '1s..10s'])
  t.is(r.transforms[0].name, 'gain')
  t.is(r.transforms[0].offset, 1, 'offset 1s')
  t.is(r.transforms[0].duration, 9, 'duration 9s')
})

test('parseArgs — split with time args', t => {
  let r = parseArgs(['in.wav', 'split', '30s', '60s', 'save', 'ch-{i}.wav'])
  t.is(r.transforms[0].name, 'split', 'op name')
  t.is(r.transforms[0].args.length, 2, '2 split points')
  t.is(r.transforms[0].args[0], 30, 'first split at 30s')
  t.is(r.transforms[0].args[1], 60, 'second split at 60s')
  t.is(r.sink.args[0], 'ch-{i}.wav', 'template sink')
})

test('parseArgs — verbose flag', t => {
  let r = parseArgs(['in.wav', '--verbose', 'gain', '-3'])
  t.ok(r.verbose, 'verbose true')
})

test('parseArgs — no source (stdin)', t => {
  let r = parseArgs(['gain', '-3'])
  t.is(r.source, null, 'no source')
  t.is(r.transforms[0].name, 'gain')
})

test('parseArgs — help flag', t => {
  let r = parseArgs(['--help'])
  t.ok(r.showHelp, 'showHelp true')
})

test('parseArgs — default sink is stat', t => {
  let r = parseArgs(['in.wav'])
  t.is(r.source, 'in.wav', 'source')
  t.is(r.sink.name, 'stat', 'default sink is stat')
  t.is(r.sink.args.length, 0, 'no stat names → overview')
})

test('parseArgs — explicit play sink', t => {
  let r = parseArgs(['in.wav', 'play'])
  t.is(r.sink.name, 'play')
  t.is(r.transforms.length, 0)
})

test('parseArgs — transform then play sink', t => {
  let r = parseArgs(['in.wav', 'gain', '-3', 'play'])
  t.is(r.sink.name, 'play')
  t.is(r.transforms.length, 1)
  t.is(r.transforms[0].name, 'gain')
})

// ── Unit Parsing ─────────────────────────────────────────────────────────

test('parseValue — dB value', t => {
  t.is(parseValue('-3db'), -3, '-3db')
  t.is(parseValue('6db'), 6, '6db')
  t.is(parseValue('-3dB'), -3, '-3dB case-insensitive')
})

test('parseValue — seconds', t => {
  t.is(parseValue('1.5s'), 1.5, '1.5s')
  t.is(parseValue('500ms'), 0.5, '500ms')
  t.is(parseValue('1'), 1, 'bare number')
})

test('parseValue — compound durations', t => {
  t.is(parseValue('1m30s'), 90, '1m30s = 90s')
  t.is(parseValue('2h'), 7200, '2h = 7200s')
  t.is(parseValue('1m'), 60, '1m = 60s')
})

test('parseValue — Hz', t => {
  t.is(parseValue('440hz'), 440)
  t.is(parseValue('2khz'), 2000)
})

test('parseValue — filename passthrough', t => {
  t.is(parseValue('out.wav'), 'out.wav')
})

test('parseValue — timecode MM:SS', t => {
  t.is(parseValue('1:30'), 90, '1:30 = 90s')
  t.is(parseValue('15:30'), 930, '15:30 = 930s')
  t.is(parseValue('0:45'), 45, '0:45 = 45s')
})

test('parseValue — timecode HH:MM:SS', t => {
  t.is(parseValue('1:30:00'), 5400, '1:30:00 = 5400s')
  t.is(parseValue('0:01:30'), 90, '0:01:30 = 90s')
})

test('parseValue — timecode with fractional seconds', t => {
  t.is(parseValue('1:30.5'), 90.5, '1:30.5 = 90.5s')
})

test('parseRange — timecode in range', t => {
  let range = parseRange('0..15:30')
  t.is(range.offset, 0)
  t.is(range.duration, 930, '15:30 = 930s')
})

test('parseRange — timecode both ends', t => {
  let range = parseRange('1:00..2:30')
  t.is(range.offset, 60)
  t.is(range.duration, 90)
})

test('parseArgs — clip transform', t => {
  let r = parseArgs(['in.wav', 'clip', '0..10s', 'save', 'out.wav'])
  t.is(r.transforms.length, 1, '1 transform')
  t.is(r.transforms[0].name, 'clip', 'clip is a transform')
  t.is(r.transforms[0].offset, 0, 'offset = 0')
  t.is(r.transforms[0].duration, 10, 'duration = 10s')
})

test('parseArgs — clip with timecode range', t => {
  let r = parseArgs(['in.wav', 'clip', '0..15:30'])
  t.is(r.transforms[0].name, 'clip')
  t.is(r.transforms[0].offset, 0, 'offset = 0')
  t.is(r.transforms[0].duration, 930, '15:30 = 930s')
})

test('parseArgs — bare range scopes the chain', t => {
  let r = parseArgs(['in.wav', '0..10s', 'save', 'out.wav'])
  t.ok(r.range, 'range set')
  t.is(r.range.offset, 0)
  t.is(r.range.duration, 10)
  t.is(r.transforms.length, 0, 'no transforms — bare range scopes chain')
})

test('parseRange — 1s..10s', t => {
  let range = parseRange('1s..10s')
  t.is(range.offset, 1)
  t.is(range.duration, 9)
})

test('parseRange — 0..0.5s', t => {
  let range = parseRange('0..0.5s')
  t.is(range.offset, 0)
  t.is(range.duration, 0.5)
})

test('parseRange — open-ended ..10s', t => {
  let range = parseRange('..10s')
  t.is(range.offset, 0)
  t.is(range.duration, 10)
})

test('parseRange — open-ended 5s..', t => {
  let range = parseRange('5s..')
  t.is(range.offset, 5)
  t.is(range.duration, undefined)
})

test('parseRange — with ms', t => {
  let range = parseRange('500ms..1500ms')
  t.is(range.offset, 0.5)
  t.is(range.duration, 1)
})

test('parseRange — compound durations', t => {
  let range = parseRange('1m30s..3m')
  t.is(range.offset, 90, '1m30s = 90s')
  t.is(range.duration, 90, '3m - 1m30s = 90s')
})

test('parseRange — minutes', t => {
  let range = parseRange('5m..10m')
  t.is(range.offset, 300, '5m = 300s')
  t.is(range.duration, 300, '10m - 5m = 300s')
})

test('parseRange — inverted range clamps to 0', t => {
  let range = parseRange('10s..2s')
  t.is(range.offset, 10, 'offset preserved')
  t.is(range.duration, 0, 'negative duration clamped to 0')
})

test('parseArgs — bare time as range', t => {
  let r = parseArgs(['song.mp3', '1s', 'play'])
  t.ok(r.range, 'range parsed')
  t.is(r.range.offset, 1, 'offset = 1s')
  t.is(r.range.duration, undefined, 'open-ended')
  t.is(r.transforms.length, 0, 'no transforms')
})

test('parseArgs — bare time 500ms', t => {
  let r = parseArgs(['song.mp3', '500ms', 'play'])
  t.ok(r.range, 'range parsed')
  t.is(r.range.offset, 0.5, 'offset = 500ms')
})

test('parseArgs — bare range with loop', t => {
  let r = parseArgs(['song.mp3', '1s..3s', 'play', 'loop'])
  t.ok(r.range, 'range parsed')
  t.is(r.range.offset, 1, 'offset')
  t.is(r.range.duration, 2, 'duration')
  t.is(r.sink.name, 'play')
  t.ok(r.sink.args.includes('loop'), 'loop arg on play sink')
})

test('parseArgs — -l shortcut adds loop to play', t => {
  let r = parseArgs(['song.mp3', '1s..3s', 'play', '-l'])
  t.is(r.sink.name, 'play')
  t.ok(r.sink.args.includes('loop'), '-l mapped to play loop arg')
})

test('parseArgs — -p shortcut maps to play sink', t => {
  let r = parseArgs(['song.mp3', '-p'])
  t.is(r.sink.name, 'play')
})

test('parseArgs — -o PATH shortcut maps to save', t => {
  let r = parseArgs(['song.mp3', '-o', 'out.wav'])
  t.is(r.sink.name, 'save')
  t.is(r.sink.args[0], 'out.wav', 'output path captured')
})

test('parseArgs — bare range with transforms', t => {
  let r = parseArgs(['song.mp3', '1s..5s', 'fade', '0.5', '-0.5', 'play'])
  t.ok(r.range, 'range parsed')
  t.is(r.range.offset, 1)
  t.is(r.range.duration, 4)
  t.is(r.transforms.length, 2, 'two fade ops (in + out)')
  t.is(r.sink.name, 'play')
})

// ── Player View ─────────────────────────────────────────────────────────

/** Strip ANSI escape sequences, return visible chars only. */
function stripAnsi(s) { return s.replace(/\x1b\[[0-9;]*m/g, '') }

test('progressBar — empty player (0/0/0)', t => {
  let bar = progressBar(0, 0, 0, 40)
  let vis = stripAnsi(bar)
  t.is(vis.length, 40, `visible width = 40 (got ${vis.length})`)
  t.is((vis.match(/─/g) || []).length, 40, 'all track chars')
})

test('progressBar — during decode (played < decoded, total unknown)', t => {
  let bar = progressBar(5, 10, 0, 40)
  let vis = stripAnsi(bar)
  t.is(vis.length, 40, `visible width = 40 (got ${vis.length})`)
  let solid = (vis.match(/━/g) || []).length
  t.ok(solid > 0, `has played region (${solid} chars)`)
  t.ok(bar.includes('\x1b[2m'), 'has dim track for unknown remaining')
})

test('progressBar — fully decoded (total known)', t => {
  let bar = progressBar(30, 120, 120, 40)
  let vis = stripAnsi(bar)
  t.is(vis.length, 40, `visible width = 40 (got ${vis.length})`)
  let solid = (vis.match(/━/g) || []).length
  let track = (vis.match(/─/g) || []).length
  t.is(solid, 10, 'played = 30/120 * 40 = 10')
  t.is(track, 30, 'rest is decoded-ahead')
  t.ok(!bar.includes('\x1b[2m'), 'no dim track when fully decoded')
})

test('progressBar — full-width in all states', t => {
  let w = 50
  t.is(stripAnsi(progressBar(0, 0, 0, w)).length, w, 'empty')
  t.is(stripAnsi(progressBar(5, 10, 0, w)).length, w, 'during decode')
  t.is(stripAnsi(progressBar(5, 60, 60, w)).length, w, 'after decode')
  t.is(stripAnsi(progressBar(60, 60, 60, w)).length, w, 'at end')
})

test('fmtTime — formats correctly', t => {
  t.is(fmtTime(0), '0:00')
  t.is(fmtTime(65), '1:05')
  t.is(fmtTime(3661, true), '1:01:01')
  t.is(fmtTime(0, true), '0:00:00')
})

// ── Verb Taxonomy ────────────────────────────────────────────────────────

test('verbs — sources and sinks classified', t => {
  t.ok(SOURCE_VERBS.has('record'), 'record is source')
  t.ok(SINK_VERBS.has('play'), 'play is sink')
  t.ok(SINK_VERBS.has('stat'), 'stat is sink')
  t.ok(SINK_VERBS.has('save'), 'save is sink')
  t.ok(isVerb('record'))
  t.ok(isVerb('play'))
  t.ok(!isVerb('gain'))
})

test('isOpName — registry-aware', t => {
  t.ok(isOpName('gain'))
  t.ok(isOpName('split'))
  t.ok(isOpName('clip'))
  t.ok(!isOpName('xyz'))
  t.ok(!isOpName('stat'), 'stat is sink, not op')
  t.ok(!isOpName('play'), 'play is sink, not op')
})

test('isStatName — registered stats and aggregates', t => {
  t.ok(isStatName('loudness'))
  t.ok(isStatName('rms'))
  t.ok(isStatName('key'))
  t.ok(isStatName('notes'))
  t.ok(isStatName('chords'))
  t.ok(!isStatName('xyz'))
})

// ── Stat Sink ────────────────────────────────────────────────────────────

test('parseArgs — stat sink with names', t => {
  let r = parseArgs(['in.wav', 'stat', 'loudness', 'rms'])
  t.is(r.source, 'in.wav', 'source parsed')
  t.is(r.sink.name, 'stat', 'stat sink')
  t.is(r.sink.args[0], 'loudness', 'first stat name')
  t.is(r.sink.args[1], 'rms', 'second stat name')
})

test('parseArgs — stat sink with bins', t => {
  let r = parseArgs(['in.wav', 'stat', 'spectrum', '128'])
  t.is(r.sink.name, 'stat')
  t.is(r.sink.args[0], 'spectrum')
  t.is(r.sink.args[1], 128, 'bins parsed as number')
})

test('parseArgs — stat sink bare defaults', t => {
  let r = parseArgs(['in.wav', 'stat'])
  t.is(r.sink.name, 'stat')
  t.is(r.sink.args.length, 0, 'no args = default overview')
})

test('parseArgs — stat sink consumes overlapping names', t => {
  let r = parseArgs(['in.wav', 'stat', 'dc', 'clipping', 'rms'])
  t.is(r.transforms.length, 0, 'no transforms')
  t.is(r.sink.name, 'stat')
  t.same(r.sink.args, ['dc', 'clipping', 'rms'], 'all names go to sink')
})

test('parseArgs — transform then stat sink preserves boundary', t => {
  let r = parseArgs(['in.wav', 'gain', '-3', 'stat', 'dc'])
  t.is(r.transforms.length, 1, 'one transform')
  t.is(r.transforms[0].name, 'gain')
  t.is(r.sink.name, 'stat', 'stat sink')
  t.same(r.sink.args, ['dc'], 'dc is stat arg')
})

// ── Save Sink ────────────────────────────────────────────────────────────

test('parseArgs — save sink path', t => {
  let r = parseArgs(['in.wav', 'save', 'out.wav'])
  t.is(r.sink.name, 'save')
  t.is(r.sink.args[0], 'out.wav')
})

test('parseArgs — save sink with stdout marker', t => {
  let r = parseArgs(['in.wav', 'save', '-'])
  t.is(r.sink.name, 'save')
  t.is(r.sink.args[0], '-')
})

// ── Source: record ───────────────────────────────────────────────────────

test('parseArgs — record source', t => {
  let r = parseArgs(['record', 'save', 'out.wav'])
  t.is(r.source, 'record', 'record source verb')
  t.is(r.sink.name, 'save', 'save sink')
})

test('parseArgs — record with duration then save', t => {
  let r = parseArgs(['record', '30s', 'save', 'out.wav'])
  t.is(r.source, 'record')
  // Duration is captured as a transform that runRecord interprets at runtime
  t.is(r.sink.name, 'save')
})

// ── Op Discovery ─────────────────────────────────────────────────────────

test('ops registry — all built-ins available', async t => {
  let audio = (await import('../audio.js')).default
  t.ok(audio.op('gain'), 'gain op exists')
  t.ok(audio.op('fade'), 'fade op exists')
  t.ok(audio.op('trim'), 'trim op exists')
  t.ok(audio.op('normalize'), 'normalize op exists')
  t.ok(audio.op('remix'), 'remix op exists')
  t.ok(typeof audio.fn.trim === 'function', 'trim is function')
  t.ok(typeof audio.fn.normalize === 'function', 'normalize is function')
})

// ── CLI Execution ────────────────────────────────────────────────────────

test('CLI — basic: source gain normalize save', async t => {
  if (!lenaPath) { t.skip('audio-lena not available'); return }
  let outPath = join(__dirname, 'tmp-cli-1.wav')
  try {
    await runCli([lenaPath, 'gain', '-3', 'normalize', 'save', outPath])
    let result = await audio(outPath)
    t.ok(result.duration > 12, 'file exists and has correct duration')
  } finally { cleanup(outPath) }
})

test('CLI — multiple ops save', async t => {
  if (!lenaPath) { t.skip('audio-lena not available'); return }
  let outPath = join(__dirname, 'tmp-cli-2.wav')
  try {
    await runCli([lenaPath, 'trim', 'gain', '-6', 'normalize', 'save', outPath])
    let result = await audio(outPath)
    t.ok(result.duration > 10, 'trimmed and gained')
  } finally { cleanup(outPath) }
})

test('CLI — format override', async t => {
  if (!lenaPath) { t.skip('audio-lena not available'); return }
  let outPath = join(__dirname, 'tmp-cli-4.wav')
  try {
    await runCli([lenaPath, 'normalize', '--format', 'wav', 'save', outPath])
    let result = await audio(outPath)
    t.ok(result.duration > 12, 'wav saved with explicit format')
  } finally { cleanup(outPath) }
})

test('CLI — help flag', async t => {
  let output = await runCliCapture(['--help'])
  t.ok(output.includes('Usage:'), 'shows usage')
  t.ok(output.includes('gain'), 'documents gain op')
  t.ok(output.includes('trim'), 'documents trim op')
  t.ok(output.includes('Sinks'), 'documents sinks')
  t.ok(output.includes('save'), 'documents save sink')
})

test('CLI — version flag', async t => {
  let { version } = JSON.parse(await import('fs').then(f => f.promises.readFile(new URL('../package.json', import.meta.url), 'utf8')))
  let output = await runCliCapture(['--version'])
  t.ok(output.includes('audio'), 'shows version')
  t.ok(output.includes(version), `shows ${version}`)
})

test('CLI — chain 5 ops', async t => {
  if (!lenaPath) { t.skip('audio-lena not available'); return }
  let outPath = join(__dirname, 'tmp-cli-5.wav')
  try {
    await runCli([lenaPath, 'trim', 'gain', '-6', 'normalize', 'reverse', 'save', outPath])
    let result = await audio(outPath)
    t.ok(result.duration > 10, 'all 5 ops applied')
  } finally { cleanup(outPath) }
})

test('CLI — normalize to different target', async t => {
  if (!lenaPath) { t.skip('audio-lena not available'); return }
  let outPath = join(__dirname, 'tmp-cli-6.wav')
  try {
    await runCli([lenaPath, 'normalize', '-6', 'save', outPath])
    let result = await audio(outPath)
    let peak = await result.stat('db')
    t.ok(Math.abs(peak - (-6)) < 1, 'normalized to -6dB')
  } finally { cleanup(outPath) }
})

test('CLI — remix stereo to mono', async t => {
  if (!lenaPath) { t.skip('audio-lena not available'); return }
  let outPath = join(__dirname, 'tmp-cli-7.wav')
  try {
    await runCli([lenaPath, 'remix', '1', 'save', outPath])
    let result = await audio(outPath)
    t.is(result.channels, 1, 'remixed to mono')
  } finally { cleanup(outPath) }
})

test('CLI — default sink prints overview', async t => {
  if (!lenaPath) { t.skip('audio-lena not available'); return }
  let { stdout } = await runCli([lenaPath])
  t.ok(stdout.includes('Duration'), 'overview shows duration')
  t.ok(stdout.includes('Channels'), 'overview shows channels')
  t.ok(stdout.includes('Loudness'), 'overview shows loudness')
})

test('CLI — explicit stat sink prints specific stats', async t => {
  if (!lenaPath) { t.skip('audio-lena not available'); return }
  let { stdout } = await runCli([lenaPath, 'stat', 'loudness', 'rms'])
  t.ok(stdout.includes('loudness'), 'shows loudness')
  t.ok(stdout.includes('rms'), 'shows rms')
})

test('CLI — stat sink with range', async t => {
  if (!lenaPath) { t.skip('audio-lena not available'); return }
  let { stdout } = await runCli([lenaPath, '1s..3s', 'stat', 'loudness'])
  t.ok(stdout.includes('loudness'), 'loudness over range')
})

// ── Range-from-stdin equivalence: `audio 0..Xs` ⇔ `audio stat 0..Xs` ─────

test('parseArgs — bare range alone equals stat with range', t => {
  let a = parseArgs(['song.mp3', '0..5s'])
  let b = parseArgs(['song.mp3', 'stat', '0..5s'])
  t.is(a.sink.name, 'stat', 'bare range defaults to stat sink')
  t.is(b.sink.name, 'stat', 'explicit stat sink')
  t.is(a.range.offset, b.range.offset, 'same offset')
  t.is(a.range.duration, b.range.duration, 'same duration')
  t.is(a.range.offset, 0)
  t.is(a.range.duration, 5)
})

test('parseArgs — sink-args range hoists to top-level range', t => {
  // `audio stat 0..5s` — range string inside stat's args is hoisted out
  let r = parseArgs(['in.wav', 'stat', '0..5s'])
  t.ok(r.range, 'range hoisted from sink args')
  t.is(r.range.offset, 0)
  t.is(r.range.duration, 5)
  t.is(r.sink.args.length, 0, 'sink args cleared (range hoisted out)')
})

test('CLI — bare range and explicit stat with range produce same overview', async t => {
  if (!lenaPath) { t.skip('audio-lena not available'); return }
  let [{ stdout: a }, { stdout: b }] = await Promise.all([
    runCli([lenaPath, '0..5s']),
    runCli([lenaPath, 'stat', '0..5s']),
  ])
  // Strip the variable "Loaded in: Xs" line — both runs decode independently
  let strip = s => s.replace(/Loaded in:.*$/m, '').trim()
  t.is(strip(a), strip(b), 'overview is identical')
  t.ok(a.includes('Duration:'), 'has duration')
  t.ok(a.includes('Peak:'), 'has peak')
  t.ok(a.includes('Loudness:'), 'has loudness')
})

// ── Crop + normalize broadcast end-to-end (regression: must not hang) ────

test('CLI — crop + normalize broadcast prints overview without hanging', { timeout: 60000 }, async t => {
  if (!lenaPath) { t.skip('audio-lena not available'); return }
  let t0 = Date.now()
  // Lena is ~12s — crop a 5s window so the chain is non-trivial
  let { stdout } = await runCli([lenaPath, 'crop', '0..5s', 'normalize', 'broadcast'])
  let elapsed = Date.now() - t0
  t.ok(stdout.includes('Duration:'), 'overview printed')
  t.ok(stdout.includes('Peak:'), 'has Peak')
  t.ok(stdout.includes('Loudness:'), 'has Loudness')
  t.ok(stdout.includes('BPM:'), 'has BPM')
  t.ok(stdout.includes('Key:'), 'has Key')
  // Block-stat algebra path should be fast — assert under 30s for the 12s fixture.
  // (The original bug had this hanging > 1 min on a 16-min file.)
  t.ok(elapsed < 30000, `completes fast (${elapsed}ms < 30s)`)
})

// ── Player prompt — preserves stdin 'data' listeners ─────────────────────

test('prompt — preserves stdin data listeners', async t => {
  // Mock stdin/stderr emulating raw-mode TTY
  let stdin = new EventEmitter()
  Object.assign(stdin, {
    isTTY: true, isRaw: true,
    setRawMode(v) { this.isRaw = v },
    setEncoding() {},
    resume() {},
  })
  let stderr = { write() {} }

  // Player attaches its own 'data' listener
  let playerKeys = []
  let playerHandler = chunk => playerKeys.push(chunk.toString())
  stdin.on('data', playerHandler)
  t.is(stdin.listenerCount('data'), 1, 'player listener attached')

  // Call prompt; while it's awaiting input the player listener should be detached
  let p = prompt('Save as: ', 'out.wav', { stdin, stderr })
  await new Promise(r => setImmediate(r))
  t.is(stdin.listenerCount('data'), 1, 'one listener (prompt only) during prompt')
  // Verify the player handler is NOT receiving data while prompt is active
  stdin.emit('data', 'x')
  t.is(playerKeys.length, 0, 'player handler did not receive prompt input')

  // Submit the prompt
  stdin.emit('data', '\n')
  let result = await p
  t.is(result, 'x', 'prompt returned typed value')

  // After prompt: player listener restored, raw mode restored
  t.is(stdin.listenerCount('data'), 1, 'player listener restored')
  t.is(stdin.listeners('data')[0], playerHandler, 'same handler restored')
  t.ok(stdin.isRaw, 'raw mode restored')

  // Subsequent keypresses now flow back to the player
  stdin.emit('data', 'q')
  t.is(playerKeys.length, 1, 'player resumes receiving keys')
  t.is(playerKeys[0], 'q', 'received q after prompt')
})

test('prompt — returns null on non-TTY without touching listeners', async t => {
  let stdin = new EventEmitter()
  Object.assign(stdin, { isTTY: false })
  let onData = () => {}
  stdin.on('data', onData)
  let r = await prompt('?', '', { stdin, stderr: { write() {} } })
  t.is(r, null, 'returns null when not a TTY')
  t.is(stdin.listenerCount('data'), 1, 'listener untouched')
})

// Regression: pressing 's' during playback used to leave the prompt invisible
// because the 40ms render tick kept overwriting stderr. The fix gates render
// behind a `prompting` flag while the prompt is active. This test exercises
// that exact pattern with a synthetic tick + prompt.
test('player prompt — render tick is gated while prompt is active', async t => {
  let writes = []
  let stderr = { write: s => writes.push(s) }
  let prompting = false
  let render = () => { if (prompting) return; stderr.write('TICK') }
  let tick = setInterval(render, 5)

  let stdin = new EventEmitter()
  Object.assign(stdin, {
    isTTY: true, isRaw: true,
    setRawMode(v) { this.isRaw = v }, setEncoding() {}, resume() {}
  })
  // Player attaches a key listener
  let playerHandler = () => {}
  stdin.on('data', playerHandler)

  // Let some ticks fire pre-prompt
  await new Promise(r => setTimeout(r, 30))
  let baseTickCount = writes.filter(w => w === 'TICK').length
  t.ok(baseTickCount > 0, 'tick is firing before prompt')

  // Enter prompt
  prompting = true
  let writesAtPromptStart = writes.length
  let p = prompt('Save as: ', 'out.wav', { stdin, stderr })

  // Let the tick try to fire while prompting — it should NOT write 'TICK'
  await new Promise(r => setTimeout(r, 30))
  let writesDuringPrompt = writes.slice(writesAtPromptStart)
  let ticksDuringPrompt = writesDuringPrompt.filter(w => w === 'TICK').length
  t.is(ticksDuringPrompt, 0, 'no render ticks while prompting')
  // The prompt label IS in the output (visible to the user)
  t.ok(writesDuringPrompt.some(w => w.includes('Save as: ')), 'prompt label written to stderr')

  // Submit and resume
  stdin.emit('data', 'song.out.wav\n')
  let result = await p
  t.is(result, 'song.out.wav', 'prompt captured input')

  prompting = false
  await new Promise(r => setTimeout(r, 30))
  clearInterval(tick)
  let postTickCount = writes.filter(w => w === 'TICK').length
  t.ok(postTickCount > baseTickCount, 'tick resumes writing after prompt')
})

// ── playerSave — save lands next to source ───────────────────────────────

test('defaultSavePath — places .out next to source preserving folder + ext', t => {
  t.is(defaultSavePath('/Users/foo/song.mp3'), '/Users/foo/song.out.mp3', 'absolute path preserved')
  t.is(defaultSavePath('a/b/c.wav'), 'a/b/c.out.wav', 'relative path preserved')
  t.is(defaultSavePath('song.flac'), 'song.out.flac', 'bare filename')
  t.is(defaultSavePath('noext'), 'noext.out', 'no extension')
  t.is(defaultSavePath(''), 'out.wav', 'empty falls back to out.wav')
  t.is(defaultSavePath(null), 'out.wav', 'null falls back to out.wav')
})

// Regression: when invoked from the player UI, "Save as:" defaulted to the right
// folder but the file may not have actually been written there. This test runs
// the real save flow via playerSave with a mocked stdin (Enter accepts the
// default path) and asserts the file lands literally next to the source.
test('playerSave — accepts default and writes file next to source', { timeout: 15000 }, async t => {
  let dir = mkdtempSync(join(tmpdir(), 'audio-cli-save-'))
  let srcPath = join(dir, 'song.wav')
  let expectedOut = join(dir, 'song.out.wav')
  try {
    let sr = 22050, n = sr  // 1s mono
    let ch = new Float32Array(n)
    for (let i = 0; i < n; i++) ch[i] = 0.2 * Math.sin(2 * Math.PI * 440 * i / sr)
    await audio.from([ch], { sampleRate: sr }).save(srcPath)
    t.ok(existsSync(srcPath), 'source written')

    let a = await audio(srcPath)

    // Mock TTY stdin — emit '\n' on next tick to accept the default path
    let stdin = new EventEmitter()
    Object.assign(stdin, {
      isTTY: true, isRaw: false,
      setRawMode(v) { this.isRaw = v },
      setEncoding() {}, resume() {}
    })
    let stderr = { write() {} }
    setImmediate(() => stdin.emit('data', '\n'))

    let result = await playerSave(a, srcPath, { force: true }, { stdin, stderr })

    t.is(result.path, expectedOut, 'returned path is next to source')
    t.ok(existsSync(expectedOut), 'file actually written next to source')
    t.ok(!result.cancelled, 'not cancelled')
    t.ok(!result.failed, 'not failed')

    // Verify the written file is actually decodable audio
    let saved = await audio(expectedOut)
    t.ok(saved.duration > 0.5, `saved file decodes (duration=${saved.duration.toFixed(2)}s)`)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

// Regression: there used to be a perceived hang between confirming the save
// path and seeing progress, because the spinner only started AFTER
// `await a.ready` and encoder warm-up. The fix fires `onStart` before any
// awaits so the user sees feedback immediately.
test('playerSave — onStart fires before await a.ready (no hang)', async t => {
  let order = []
  let resolveReady
  let a = {
    decoded: false,
    ready: new Promise(r => { resolveReady = r }),
    save: async () => { order.push('save') },
    on() {}, off() {}
  }
  let stdin = new EventEmitter()
  Object.assign(stdin, {
    isTTY: true, isRaw: false,
    setRawMode(v) { this.isRaw = v }, setEncoding() {}, resume() {}
  })
  setImmediate(() => stdin.emit('data', '\n'))
  let p = playerSave(a, '/tmp/x.wav', {
    force: true,
    onStart: () => order.push('onStart')
  }, { stdin, stderr: { write() {} } })

  // Give prompt + microtasks time to settle. ready is still pending.
  await new Promise(r => setTimeout(r, 30))
  t.is(order[0], 'onStart', 'onStart fired before save')
  t.is(order.length, 1, 'save NOT yet called — still waiting on a.ready')

  // Now release ready — save should proceed
  resolveReady()
  await p
  t.is(order[1], 'save', 'save fires after ready resolves')
})

test('playerSave — empty path returns cancelled', async t => {
  let stdin = new EventEmitter()
  Object.assign(stdin, {
    isTTY: true, isRaw: false,
    setRawMode(v) { this.isRaw = v }, setEncoding() {}, resume() {}
  })
  let stderr = { write() {} }
  // User clears the default ("\b" * many) then submits empty — easier: pass src=null so default is 'out.wav'
  // and emit an empty line. But empty submission falls back to the default. To force cancel we need
  // prompt to return null, which happens on non-TTY. So test the non-TTY path.
  Object.assign(stdin, { isTTY: false })
  let a = { decoded: true, save: async () => { throw new Error('should not be called') }, on() {}, off() {} }
  let result = await playerSave(a, '/tmp/x.wav', {}, { stdin, stderr })
  t.ok(result.cancelled, 'non-TTY → cancelled (prompt returns null)')
})

// ── Error Handling ───────────────────────────────────────────────────────

test('CLI — unknown op produces clear error', async t => {
  try {
    await runCli([lenaPath || 'test/fixture.wav', 'foobar', 'save', '/dev/null'])
    t.fail('should have thrown')
  } catch (e) {
    t.ok(e.message.includes('foobar'), 'error mentions op name')
  }
})

test('CLI — missing source produces error', async t => {
  try {
    await runCli(['nonexistent.wav', 'save', '/dev/null'])
    t.fail('should have thrown')
  } catch (e) {
    t.ok(e.message.includes('stderr'), 'exits with error')
  }
})

test('CLI — mono trim normalize save mp3', async t => {
  let fixture = join(__dirname, 'fixture.wav')
  let { existsSync } = await import('fs')
  if (!existsSync(fixture)) { t.skip('fixture.wav not available'); return }
  let outPath = join(__dirname, 'tmp-cli-mono.mp3')
  try {
    await runCli([fixture, 'trim', 'normalize', 'save', outPath])
    let result = await audio(outPath)
    t.ok(result.duration > 0, 'mp3 has audio')
    t.ok(result.channels >= 1, 'has channels')
  } finally { cleanup(outPath) }
})

// ── Filters ──────────────────────────────────────────────────────────────

test('ops registry — filter ops available', t => {
  t.ok(audio.op('highpass'), 'highpass op')
  t.ok(audio.op('lowpass'), 'lowpass op')
  t.ok(audio.op('eq'), 'eq op')
  t.ok(audio.op('lowshelf'), 'lowshelf op')
  t.ok(audio.op('highshelf'), 'highshelf op')
  t.ok(audio.op('notch'), 'notch op')
  t.ok(audio.op('bandpass'), 'bandpass op')
})

test('API — highpass filter applies correctly', async t => {
  let sr = 44100, dur = 10, n = sr * dur
  let ch = new Float32Array(n)
  for (let i = 0; i < n; i++) ch[i] = 0.5 * Math.sin(2 * Math.PI * 50 * i / sr) + 0.5 * Math.sin(2 * Math.PI * 1000 * i / sr)
  let a = audio.from([ch, new Float32Array(ch)], { sampleRate: sr })
  a.highpass(200)
  let pcm = await a.read()
  let sum = 0
  for (let i = sr; i < 2 * sr; i++) sum += pcm[0][i] * pcm[0][i]
  let rms = Math.sqrt(sum / sr)
  t.ok(rms < 0.6, `50Hz attenuated, rms=${rms.toFixed(3)} < 0.6`)
  t.ok(rms > 0.2, `1kHz preserved, rms=${rms.toFixed(3)} > 0.2`)
})

test('CLI — filter highpass works', { timeout: 15000 }, async t => {
  let srcPath = join(__dirname, 'tmp-filter-alias.wav')
  let outPath = join(__dirname, 'tmp-filter-alias-out.wav')
  try {
    let sr = 44100, n = sr * 2
    let ch = new Float32Array(n)
    for (let i = 0; i < n; i++) ch[i] = 0.5 * Math.sin(2 * Math.PI * 440 * i / sr)
    await audio.from([ch], { sampleRate: sr }).save(srcPath)
    await runCli([srcPath, 'highpass', '80hz', 'save', outPath])
    let result = await audio(outPath)
    t.ok(result.duration > 1, 'highpass processed audio')
  } finally {
    cleanup(srcPath); cleanup(outPath)
  }
})

test('CLI — filter + mp3 encode (short)', { timeout: 30000 }, async t => {
  let srcPath = join(__dirname, 'tmp-filter-src.wav')
  let outPath = join(__dirname, 'tmp-filter-out.mp3')
  try {
    let sr = 44100, dur = 10, n = sr * dur
    let ch = new Float32Array(n)
    for (let i = 0; i < n; i++) ch[i] = 0.5 * Math.sin(2 * Math.PI * 440 * i / sr)
    await audio.from([ch, new Float32Array(ch)], { sampleRate: sr }).save(srcPath)
    await runCli([srcPath, 'highpass', '80hz', 'trim', 'fade', '1', 'fade', '-1', 'save', outPath])
    let result = await audio(outPath)
    t.ok(result.duration > 5, `mp3 has audio: ${result.duration.toFixed(1)}s`)
  } finally {
    cleanup(srcPath); cleanup(outPath)
  }
})

// ── Per-op Help ──────────────────────────────────────────────────────────

test('parseArgs — per-op help: gain --help', t => {
  let r = parseArgs(['in.wav', 'gain', '--help'])
  t.is(r.helpOp, 'gain', 'helpOp set to gain')
  t.is(r.transforms.length, 0, 'no transforms parsed after help')
})

test('parseArgs — per-op help: highpass -h', t => {
  let r = parseArgs(['in.wav', 'highpass', '-h'])
  t.is(r.helpOp, 'highpass', 'helpOp for highpass')
})

test('parseArgs — per-sink help: save --help', t => {
  let r = parseArgs(['in.wav', 'save', '--help'])
  t.is(r.helpOp, 'save', 'helpOp for save sink')
})

test('op help — all built-in ops have help', t => {
  let expected = ['gain', 'fade', 'trim', 'normalize', 'reverse', 'crop', 'clip', 'remove',
    'insert', 'repeat', 'mix', 'crossfade', 'remix', 'highpass', 'lowpass', 'eq', 'lowshelf',
    'highshelf', 'notch', 'bandpass', 'allpass', 'filter', 'pan', 'pad', 'speed', 'stretch',
    'pitch', 'vocals', 'dither', 'crossfeed', 'resample',
    // sinks + sources
    'play', 'stat', 'save', 'record']
  for (let op of expected) t.ok(HELP[op], `${op} has help`)
  for (let name in HELP) t.ok(expected.includes(name), `${name} in expected list`)
})

test('CLI — per-op help output', async t => {
  let output = await runCliCapture(['gain', '--help'])
  t.ok(output.includes('gain'), 'shows gain in help')
  t.ok(output.includes('dB'), 'shows description')
})

test('CLI — showUsage mentions every op with help', async t => {
  let output = await runCliCapture(['--help'])
  for (let [name, h] of Object.entries(HELP)) {
    if (name === 'filter') continue
    t.ok(output.includes(name), `help text includes ${name}`)
  }
})

// ── Macro System ─────────────────────────────────────────────────────────

test('parseArgs — macro flag', t => {
  let r = parseArgs(['in.wav', '--macro', 'recipe.json', 'save', 'out.wav'])
  t.is(r.macro, 'recipe.json', 'macro file parsed')
})

test('CLI — macro applies edits from JSON', async t => {
  if (!lenaPath) { t.skip('audio-lena not available'); return }
  let macroPath = join(__dirname, 'tmp-macro.json')
  let outPath = join(__dirname, 'tmp-macro-out.wav')
  try {
    writeFileSync(macroPath, JSON.stringify([['gain', { value: -6 }]]))
    await runCli([lenaPath, '--macro', macroPath, 'save', outPath])
    let result = await audio(outPath)
    let orig = await (await audio(lenaPath)).stat('db')
    let peak = await result.stat('db')
    t.ok(Math.abs(peak - (orig - 6)) < 1, `macro gain applied (got ${peak.toFixed(1)}, expected ~${(orig - 6).toFixed(1)})`)
  } finally {
    cleanup(macroPath); cleanup(outPath)
  }
})

test('CLI — macro combined with inline ops', async t => {
  if (!lenaPath) { t.skip('audio-lena not available'); return }
  let macroPath = join(__dirname, 'tmp-macro2.json')
  let outPath = join(__dirname, 'tmp-macro2-out.wav')
  try {
    writeFileSync(macroPath, JSON.stringify([{ type: 'gain', args: [-3] }]))
    await runCli([lenaPath, 'gain', '-6', '--macro', macroPath, 'save', outPath])
    let result = await audio(outPath)
    let orig = await (await audio(lenaPath)).stat('db')
    let peak = await result.stat('db')
    t.ok(Math.abs(peak - (orig - 9)) < 1, `inline + macro: peak ≈ ${(orig - 9).toFixed(0)}dB (got ${peak.toFixed(1)})`)
  } finally {
    cleanup(macroPath); cleanup(outPath)
  }
})

// ── Pan / Pad CLI ────────────────────────────────────────────────────────

test('parseArgs — pan op', t => {
  let r = parseArgs(['in.wav', 'pan', '-0.5', 'save', 'out.wav'])
  t.is(r.transforms[0].name, 'pan', 'pan op parsed')
  t.is(r.transforms[0].args[0], -0.5, 'pan value')
})

test('parseArgs — pad op', t => {
  let r = parseArgs(['in.wav', 'pad', '1s', '2s', 'save', 'out.wav'])
  t.is(r.transforms[0].name, 'pad', 'pad op parsed')
  t.is(r.transforms[0].args[0], 1, 'before')
  t.is(r.transforms[0].args[1], 2, 'after')
})

test('op help — pan and pad have help', t => {
  t.ok(HELP.pan, 'pan help exists')
  t.ok(HELP.pad, 'pad help exists')
  t.ok(HELP.pan.desc, 'pan has description')
  t.ok(HELP.pad.desc, 'pad has description')
})

test('CLI — pad adds silence', async t => {
  if (!lenaPath) { t.skip('audio-lena not available'); return }
  let outPath = join(__dirname, 'tmp-pad-out.wav')
  try {
    let orig = await audio(lenaPath)
    let origDur = orig.duration
    await runCli([lenaPath, 'pad', '1s', '0', 'save', outPath, '--force'])
    let result = await audio(outPath)
    t.ok(Math.abs(result.duration - (origDur + 1)) < 0.1, `duration increased by ~1s (got ${result.duration.toFixed(2)} from ${origDur.toFixed(2)})`)
  } finally { cleanup(outPath) }
})

// ── Glob / Batch ─────────────────────────────────────────────────────────

test('parseArgs — glob source preserved', t => {
  let r = parseArgs(['*.wav', 'gain', '-3', 'save', '{name}.out.wav'])
  t.is(r.source, '*.wav', 'glob preserved as source')
  t.is(r.sink.args[0], '{name}.out.wav', 'template sink')
})

test('CLI — batch glob processes multiple files', async t => {
  if (!lenaPath) { t.skip('audio-lena not available'); return }
  let { copyFileSync } = await import('fs')
  let src1 = join(__dirname, 'tmp-batch-a.wav')
  let src2 = join(__dirname, 'tmp-batch-b.wav')
  let out1 = join(__dirname, 'tmp-batch-a.done.wav')
  let out2 = join(__dirname, 'tmp-batch-b.done.wav')
  try {
    copyFileSync(lenaPath, src1)
    copyFileSync(lenaPath, src2)
    await runCli(['test/tmp-batch-?.wav', 'gain', '-3', 'save', 'test/{name}.done.wav'])
    let a = await audio(out1), b = await audio(out2)
    t.ok(a.duration > 0, 'first output has audio')
    t.ok(b.duration > 0, 'second output has audio')
  } finally {
    cleanup(src1); cleanup(src2); cleanup(out1); cleanup(out2)
  }
})

test('CLI — batch template {name} and {ext}', async t => {
  if (!lenaPath) { t.skip('audio-lena not available'); return }
  let { copyFileSync } = await import('fs')
  let src1 = join(__dirname, 'tmp-btpl-a.wav')
  let src2 = join(__dirname, 'tmp-btpl-b.wav')
  let out1 = join(__dirname, 'tmp-btpl-a.clean.wav')
  let out2 = join(__dirname, 'tmp-btpl-b.clean.wav')
  try {
    copyFileSync(lenaPath, src1)
    copyFileSync(lenaPath, src2)
    await runCli(['test/tmp-btpl-?.wav', 'normalize', 'save', 'test/{name}.clean.{ext}'])
    let a = await audio(out1), b = await audio(out2)
    t.ok(a.duration > 0, 'template output 1 created')
    t.ok(b.duration > 0, 'template output 2 created')
  } finally {
    cleanup(src1); cleanup(src2); cleanup(out1); cleanup(out2)
  }
})

test('CLI — batch silently overwrites without prompt (non-TTY)', async t => {
  if (!lenaPath) { t.skip('audio-lena not available'); return }
  let { copyFileSync } = await import('fs')
  let src1 = join(__dirname, 'tmp-bforce-a.wav')
  let src2 = join(__dirname, 'tmp-bforce-b.wav')
  let out1 = join(__dirname, 'tmp-bforce-a.done.wav')
  let out2 = join(__dirname, 'tmp-bforce-b.done.wav')
  try {
    copyFileSync(lenaPath, src1)
    copyFileSync(lenaPath, src2)
    await runCli(['test/tmp-bforce-?.wav', 'gain', '-3', 'save', 'test/{name}.done.wav', '--force'])
    await runCli(['test/tmp-bforce-?.wav', 'gain', '-3', 'save', 'test/{name}.done.wav'])
    let a = await audio(out1)
    t.ok(a.duration > 0, 'silently overwrote existing output')
  } finally {
    cleanup(src1); cleanup(src2); cleanup(out1); cleanup(out2)
  }
})

test('CLI — batch --force overwrites', async t => {
  if (!lenaPath) { t.skip('audio-lena not available'); return }
  let { copyFileSync } = await import('fs')
  let src1 = join(__dirname, 'tmp-bf2-a.wav')
  let src2 = join(__dirname, 'tmp-bf2-b.wav')
  let out1 = join(__dirname, 'tmp-bf2-a.done.wav')
  let out2 = join(__dirname, 'tmp-bf2-b.done.wav')
  try {
    copyFileSync(lenaPath, src1)
    copyFileSync(lenaPath, src2)
    await runCli(['test/tmp-bf2-?.wav', 'gain', '-3', 'save', 'test/{name}.done.wav'])
    await runCli(['test/tmp-bf2-?.wav', 'gain', '-6', 'save', 'test/{name}.done.wav', '--force'])
    let a = await audio(out1), b = await audio(out2)
    t.ok(a.duration > 0, 'overwritten output 1 valid')
    t.ok(b.duration > 0, 'overwritten output 2 valid')
  } finally {
    cleanup(src1); cleanup(src2); cleanup(out1); cleanup(out2)
  }
})

test('CLI — overwrite: non-TTY stdin silently overwrites', async t => {
  if (!lenaPath) { t.skip('audio-lena not available'); return }
  let { copyFileSync } = await import('fs')
  let outPath = join(__dirname, 'tmp-ow-silent.wav')
  try {
    copyFileSync(lenaPath, outPath)
    await runCli([lenaPath, 'gain', '-3', 'save', outPath])
    let a = await audio(outPath)
    t.ok(a.duration > 0, 'silently overwrote')
  } finally { cleanup(outPath) }
})

test('CLI — overwrite: --force skips prompt entirely', async t => {
  if (!lenaPath) { t.skip('audio-lena not available'); return }
  let { copyFileSync } = await import('fs')
  let outPath = join(__dirname, 'tmp-ow-force.wav')
  try {
    copyFileSync(lenaPath, outPath)
    await runCli([lenaPath, 'gain', '-3', 'save', outPath, '--force'])
    let a = await audio(outPath)
    t.ok(a.duration > 0, '--force overwrote without prompt')
  } finally { cleanup(outPath) }
})

test('CLI — split saves multiple files', async t => {
  if (!lenaPath) { t.skip('audio-lena not available'); return }
  let out1 = join(__dirname, 'tmp-split-1.wav')
  let out2 = join(__dirname, 'tmp-split-2.wav')
  try {
    await runCli([lenaPath, 'split', '6', 'save', join(__dirname, 'tmp-split-{i}.wav'), '--force'])
    let a1 = await audio(out1)
    let a2 = await audio(out2)
    t.ok(a1.duration > 5 && a1.duration < 7, `part 1 ≈ 6s (${a1.duration.toFixed(1)})`)
    t.ok(a2.duration > 5 && a2.duration < 7, `part 2 ≈ 6s (${a2.duration.toFixed(1)})`)
  } finally {
    cleanup(out1); cleanup(out2)
  }
})

test('CLI — glob no matches throws', async t => {
  try {
    await runCli(['test/nonexistent-glob-*.wav', 'gain', '-3', 'save', 'out.wav'])
    t.fail('should have thrown')
  } catch (e) {
    t.ok(e.message.includes('No files matching') || e.stderr?.includes('No files matching'), 'error mentions no matches')
  }
})

// ── CLI Execution — Remaining Ops (actual file processing) ──────────────

test('CLI — stretch 0.75x shortens duration', async t => {
  if (!lenaPath) { t.skip('audio-lena not available'); return }
  let outPath = join(__dirname, 'tmp-cli-stretch.wav')
  try {
    let orig = await audio(lenaPath)
    await runCli([lenaPath, 'stretch', '0.75', 'save', outPath, '--force'])
    let result = await audio(outPath)
    let ratio = result.duration / orig.duration
    t.ok(Math.abs(ratio - 0.75) < 0.1, `stretch 0.75: dur ratio ${ratio.toFixed(2)} ≈ 0.75`)
  } finally { cleanup(outPath) }
})

test('CLI — pitch shift +5 semitones', async t => {
  if (!lenaPath) { t.skip('audio-lena not available'); return }
  let outPath = join(__dirname, 'tmp-cli-pitch.wav')
  try {
    await runCli([lenaPath, 'pitch', '5', 'save', outPath, '--force'])
    let result = await audio(outPath)
    t.ok(result.duration > 0, 'pitch-shifted file produced')
  } finally { cleanup(outPath) }
})

test('CLI — dither to 16-bit', async t => {
  if (!lenaPath) { t.skip('audio-lena not available'); return }
  let outPath = join(__dirname, 'tmp-cli-dither.wav')
  try {
    await runCli([lenaPath, 'dither', '16', 'save', outPath, '--force'])
    let result = await audio(outPath)
    t.ok(result.duration > 0, 'dithered file produced')
  } finally { cleanup(outPath) }
})

test('CLI — crossfeed', async t => {
  if (!lenaPath) { t.skip('audio-lena not available'); return }
  let srcPath = join(__dirname, 'tmp-cli-crossfeed-src.wav')
  let outPath = join(__dirname, 'tmp-cli-crossfeed.wav')
  try {
    let sr = 44100, n = sr * 2
    let L = new Float32Array(n), R = new Float32Array(n)
    for (let i = 0; i < n; i++) { L[i] = 0.5 * Math.sin(2 * Math.PI * 440 * i / sr); R[i] = 0 }
    await audio.from([L, R], { sampleRate: sr }).save(srcPath)
    await runCli([srcPath, 'crossfeed', 'save', outPath, '--force'])
    let result = await audio(outPath)
    t.ok(result.duration > 0, 'crossfeed processed')
    t.is(result.channels, 2, 'stereo preserved')
  } finally { cleanup(srcPath); cleanup(outPath) }
})

test('CLI — vocals isolate', async t => {
  if (!lenaPath) { t.skip('audio-lena not available'); return }
  let srcPath = join(__dirname, 'tmp-cli-vocals-src.wav')
  let outPath = join(__dirname, 'tmp-cli-vocals.wav')
  try {
    let sr = 44100, n = sr * 2
    let c = new Float32Array(n), s = new Float32Array(n)
    for (let i = 0; i < n; i++) { c[i] = 0.4 * Math.sin(2 * Math.PI * 440 * i / sr); s[i] = 0.2 * Math.sin(2 * Math.PI * 2000 * i / sr) }
    let L = new Float32Array(n), R = new Float32Array(n)
    for (let i = 0; i < n; i++) { L[i] = c[i] + s[i]; R[i] = c[i] - s[i] }
    await audio.from([L, R], { sampleRate: sr }).save(srcPath)
    await runCli([srcPath, 'vocals', 'save', outPath, '--force'])
    let result = await audio(outPath)
    t.ok(result.duration > 0, 'vocals isolate processed')
  } finally { cleanup(srcPath); cleanup(outPath) }
})

test('CLI — allpass filter', async t => {
  if (!lenaPath) { t.skip('audio-lena not available'); return }
  let outPath = join(__dirname, 'tmp-cli-allpass.wav')
  try {
    await runCli([lenaPath, 'allpass', '1khz', 'save', outPath, '--force'])
    let result = await audio(outPath)
    t.ok(result.duration > 0, 'allpass processed')
  } finally { cleanup(outPath) }
})

test('CLI — speed 2x', async t => {
  if (!lenaPath) { t.skip('audio-lena not available'); return }
  let outPath = join(__dirname, 'tmp-cli-speed.wav')
  try {
    let orig = await audio(lenaPath)
    await runCli([lenaPath, 'speed', '2', 'save', outPath, '--force'])
    let result = await audio(outPath)
    t.ok(Math.abs(result.duration - orig.duration / 2) < 0.1, `speed 2x halves duration: ${result.duration.toFixed(2)} ≈ ${(orig.duration / 2).toFixed(2)}`)
  } finally { cleanup(outPath) }
})

test('CLI — pan full-left', async t => {
  if (!lenaPath) { t.skip('audio-lena not available'); return }
  let srcPath = join(__dirname, 'tmp-cli-pan-src.wav')
  let outPath = join(__dirname, 'tmp-cli-pan.wav')
  try {
    let sr = 44100, n = sr * 2, L = new Float32Array(n), R = new Float32Array(n)
    for (let i = 0; i < n; i++) { L[i] = 0.5 * Math.sin(2 * Math.PI * 440 * i / sr); R[i] = 0.5 * Math.sin(2 * Math.PI * 660 * i / sr) }
    await audio.from([L, R], { sampleRate: sr }).save(srcPath)
    await runCli([srcPath, 'pan', '-1', 'save', outPath, '--force'])
    let result = await audio(outPath)
    t.is(result.channels, 2, 'stereo')
    let pcm = await result.read()
    let rPeak = 0
    for (let i = 0; i < pcm[1].length; i++) rPeak = Math.max(rPeak, Math.abs(pcm[1][i]))
    t.ok(rPeak < 0.1, `right silenced: peak ${rPeak.toFixed(3)}`)
  } finally { cleanup(srcPath); cleanup(outPath) }
})

test('CLI — lowpass filter', async t => {
  if (!lenaPath) { t.skip('audio-lena not available'); return }
  let outPath = join(__dirname, 'tmp-cli-lp.wav')
  try {
    await runCli([lenaPath, 'lowpass', '1khz', 'save', outPath, '--force'])
    let result = await audio(outPath)
    t.ok(result.duration > 0, 'lowpass processed')
  } finally { cleanup(outPath) }
})

test('CLI — eq peak boost', async t => {
  if (!lenaPath) { t.skip('audio-lena not available'); return }
  let outPath = join(__dirname, 'tmp-cli-eq.wav')
  try {
    await runCli([lenaPath, 'eq', '1khz', '6', 'save', outPath, '--force'])
    let result = await audio(outPath)
    t.ok(result.duration > 0, 'eq processed')
  } finally { cleanup(outPath) }
})

test('CLI — crop subrange', async t => {
  if (!lenaPath) { t.skip('audio-lena not available'); return }
  let outPath = join(__dirname, 'tmp-cli-crop.wav')
  try {
    await runCli([lenaPath, 'crop', '2s..5s', 'save', outPath, '--force'])
    let result = await audio(outPath)
    t.ok(Math.abs(result.duration - 3) < 0.1, `cropped to 3s (got ${result.duration.toFixed(2)})`)
  } finally { cleanup(outPath) }
})

test('CLI — remove subrange', async t => {
  if (!lenaPath) { t.skip('audio-lena not available'); return }
  let outPath = join(__dirname, 'tmp-cli-remove.wav')
  try {
    let orig = await audio(lenaPath)
    await runCli([lenaPath, 'remove', '2s..5s', 'save', outPath, '--force'])
    let result = await audio(outPath)
    t.ok(Math.abs(result.duration - (orig.duration - 3)) < 0.1, `removed 3s: ${result.duration.toFixed(2)} ≈ ${(orig.duration - 3).toFixed(2)}`)
  } finally { cleanup(outPath) }
})

test('CLI — repeat doubles duration', async t => {
  if (!lenaPath) { t.skip('audio-lena not available'); return }
  let outPath = join(__dirname, 'tmp-cli-repeat.wav')
  try {
    let orig = await audio(lenaPath)
    await runCli([lenaPath, 'repeat', '1', 'save', outPath, '--force'])
    let result = await audio(outPath)
    t.ok(Math.abs(result.duration - orig.duration * 2) < 0.1, `repeat 1 doubles: ${result.duration.toFixed(2)} ≈ ${(orig.duration * 2).toFixed(2)}`)
  } finally { cleanup(outPath) }
})

test('CLI — bare range scopes save (crops on save)', async t => {
  if (!lenaPath) { t.skip('audio-lena not available'); return }
  let outPath = join(__dirname, 'tmp-cli-range-save.wav')
  try {
    await runCli([lenaPath, '1s..3s', 'save', outPath, '--force'])
    let result = await audio(outPath)
    t.ok(Math.abs(result.duration - 2) < 0.1, `range scopes save to 2s (got ${result.duration.toFixed(2)})`)
  } finally { cleanup(outPath) }
})

test('CLI — save - writes to stdout', async t => {
  if (!lenaPath) { t.skip('audio-lena not available'); return }
  let { stdout } = await runCli([lenaPath, 'save', '-'])
  // wav header begins with 'RIFF'
  t.ok(stdout.startsWith('RIFF'), 'stdout has WAV RIFF header')
})


// ── Helper Functions ─────────────────────────────────────────────────────

function runCli(args) {
  return new Promise((resolve, reject) => {
    let proc = spawn('node', [binPath, ...args], {
      stdio: ['inherit', 'pipe', 'pipe'],
      cwd: projectRoot
    })
    let stdout = '', stderr = ''
    proc.stdout?.on('data', d => stdout += d)
    proc.stderr?.on('data', d => stderr += d)
    proc.on('close', code => {
      if (code === 0) resolve({ stdout, stderr })
      else reject(new Error(`CLI exited with code ${code}\nstderr: ${stderr}`))
    })
    proc.on('error', reject)
  })
}

function runCliCapture(args) {
  return new Promise((resolve, reject) => {
    let proc = spawn('node', [binPath, ...args], {
      stdio: ['inherit', 'pipe', 'pipe'],
      cwd: projectRoot
    })
    let output = ''
    proc.stdout?.on('data', d => output += d)
    proc.stderr?.on('data', d => output += d)
    proc.on('close', () => resolve(output))
    proc.on('error', reject)
  })
}

function cleanup(path) {
  try { unlinkSync(path) } catch {}
}


// ── Heavy (forked — runs in worker, last so parallel output streams first) ──

test('API — filter + mp3 encode (large, >28min stereo 48kHz)', { fork: true, timeout: 300000, skip: !process.env.CI }, async t => {
  let { default: audio } = await import('./audio.js')
  let { join } = await import('path')
  let { unlinkSync } = await import('fs')
  let outPath = join(process.cwd(), 'test', 'tmp-filter-large.mp3')
  try {
    let sr = 48000, dur = 1800, n = sr * dur
    let ch = new Float32Array(n)
    for (let i = 0; i < n; i++) ch[i] = 0.3 * Math.sin(2 * Math.PI * 440 * i / sr)
    let a = audio.from([ch, new Float32Array(ch)], { sampleRate: sr })
    a.highpass(50)
    a.trim()
    a.fade(2)
    a.fade(-2)
    await a.save(outPath)
    let result = await audio(outPath)
    t.ok(result.duration > 1700, `mp3 duration: ${result.duration.toFixed(0)}s`)
  } finally {
    try { unlinkSync(outPath) } catch {}
  }
})
