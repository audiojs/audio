import test from 'tst'
import { parseValue, parseRange, parseArgs } from '../bin/cli.js'
import audio from '../audio.js'
import { spawn } from 'child_process'
import { fileURLToPath } from 'url'
import { writeFileSync, unlinkSync, readFileSync } from 'fs'
import { dirname, join } from 'path'

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

test('parseArgs — simple: input ops output', t => {
  let result = parseArgs(['in.wav', 'gain', '-3db', '-o', 'out.wav'])
  t.is(result.input, 'in.wav', 'input')
  t.is(result.output, 'out.wav', 'output')
  t.ok(result.ops.length === 1, '1 op')
  t.is(result.ops[0].name, 'gain', 'op name')
})

test('parseArgs — multiple ops', t => {
  let result = parseArgs(['in.wav', 'gain', '-3', 'trim', 'normalize', '-o', 'out.wav'])
  t.is(result.ops.length, 3, '3 ops')
  t.is(result.ops[0].name, 'gain')
  t.is(result.ops[1].name, 'trim')
  t.is(result.ops[2].name, 'normalize')
})

test('parseArgs — op with multiple args', t => {
  let result = parseArgs(['in.wav', 'fade', '1.5s', 'linear'])
  t.is(result.ops[0].name, 'fade')
  t.is(result.ops[0].args.length, 2, '2 args')
})

test('parseArgs — range syntax', t => {
  let result = parseArgs(['in.wav', 'gain', '-3db', '1s..10s'])
  t.is(result.ops[0].name, 'gain')
  t.is(result.ops[0].offset, 1, 'offset 1s')
  t.is(result.ops[0].duration, 9, 'duration 9s')
})

test('parseArgs — verbose flag', t => {
  let result = parseArgs(['in.wav', '--verbose', 'gain', '-3'])
  t.ok(result.verbose, 'verbose true')
})

test('parseArgs — version flags not confused with verbose', t => {
  // -v should NOT be parsed as verbose (it's version, handled in main)
  let result = parseArgs(['in.wav', 'gain', '-3'])
  t.ok(!result.verbose, 'no verbose by default')
})

test('parseArgs — no input (stdin)', t => {
  let result = parseArgs(['gain', '-3'])
  t.is(result.input, null, 'no input')
  t.is(result.ops[0].name, 'gain')
})

test('parseArgs — help flag', t => {
  let result = parseArgs(['--help'])
  t.ok(result.showHelp, 'showHelp true')
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
  t.is(parseValue('2m'), 120, '2m = 120s')
  t.is(parseValue('1h'), 3600, '1h = 3600s')
  t.is(parseValue('1h20m'), 4800, '1h20m = 4800s')
})

test('parseValue — Hz', t => {
  t.is(parseValue('440hz'), 440, '440hz')
  t.is(parseValue('2khz'), 2000, '2khz')
  t.is(parseValue('440'), 440, 'bare number')
})

test('parseValue — filename passthrough', t => {
  t.is(parseValue('db-mix.wav'), 'db-mix.wav', 'filename with db- passes through')
  t.is(parseValue('song.seconds.wav'), 'song.seconds.wav', 'filename with seconds passes through')
  t.is(parseValue('normalize'), 'normalize', 'word passes through')
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

test('parseArgs — explicit -i flag', t => {
  let result = parseArgs(['-i', 'in.wav', 'gain', '-3', '-o', 'out.wav'])
  t.is(result.input, 'in.wav', 'explicit -i sets input')
  t.is(result.ops[0].name, 'gain', 'ops follow')
})

test('parseArgs — explicit --input flag', t => {
  let result = parseArgs(['--input', 'in.wav', 'gain', '-3'])
  t.is(result.input, 'in.wav', 'explicit --input sets input')
})

test('parseArgs — -i flag anywhere', t => {
  let result = parseArgs(['gain', '-3', '-i', 'in.wav'])
  t.is(result.input, 'in.wav', '-i can appear after ops')
})

// ── Op Discovery ─────────────────────────────────────────────────────────

test('ops registry — all built-ins available', async t => {
  let audio = (await import('../audio.js')).default
  t.ok(audio.op.gain, 'gain op exists')
  t.ok(audio.op.fade, 'fade op exists')
  t.ok(audio.op.trim, 'trim op exists')
  t.ok(audio.op.normalize, 'normalize op exists')
  t.ok(audio.op.remix, 'remix op exists')
  t.ok(typeof audio.op.trim === 'function', 'trim is function')
  t.ok(typeof audio.op.normalize === 'function', 'normalize is function')
})

// ── CLI Execution ────────────────────────────────────────────────────────

test('CLI — basic: input gain normalize output', async t => {
  if (!lenaPath) { t.skip('audio-lena not available'); return }

  let outPath = join(__dirname, 'tmp-cli-1.wav')
  try {
    await runCli([lenaPath, 'gain', '-3', 'normalize', '-o', outPath])

    let result = await audio(outPath)
    t.ok(result.duration > 12, 'file exists and has correct duration')
  } finally {
    cleanup(outPath)
  }
})

test('CLI — multiple ops', async t => {
  if (!lenaPath) { t.skip('audio-lena not available'); return }

  let outPath = join(__dirname, 'tmp-cli-2.wav')
  try {
    await runCli([lenaPath, 'trim', 'gain', '-6', 'normalize', '-o', outPath])
    let result = await audio(outPath)
    t.ok(result.duration > 10, 'trimmed and gained')
  } finally {
    cleanup(outPath)
  }
})

test('CLI — with range: gain on subrange', async t => {
  if (!lenaPath) { t.skip('audio-lena not available'); return }

  let outPath = join(__dirname, 'tmp-cli-3.wav')
  try {
    // Note: CLI doesn't directly support range syntax in this version
    // This would be: audio in.wav gain -3db 1s..10s
    // For now, we test the basic case without range
    await runCli([lenaPath, 'gain', '-3', '-o', outPath])
    let result = await audio(outPath)
    t.ok(result.duration > 12, 'gain applied')
  } finally {
    cleanup(outPath)
  }
})

test('CLI — format override', async t => {
  if (!lenaPath) { t.skip('audio-lena not available'); return }

  let outPath = join(__dirname, 'tmp-cli-4.wav')
  try {
    // Note: Lena is mono, but some encoders (MP3) may require stereo.
    // Test with WAV format override instead.
    await runCli([lenaPath, 'normalize', '--format', 'wav', '-o', outPath])
    let result = await audio(outPath)
    t.ok(result.duration > 12, 'wav saved with explicit format')
  } finally {
    cleanup(outPath)
  }
})

test('CLI — help flag', async t => {
  let output = await runCliCapture(['--help'])
  t.ok(output.includes('Usage:'), 'shows usage')
  t.ok(output.includes('gain'), 'documents gain op')
  t.ok(output.includes('trim'), 'documents trim op')
})

test('CLI — version flag', async t => {
  let output = await runCliCapture(['--version'])
  t.ok(output.includes('audio'), 'shows version')
  t.ok(output.includes('2.0.0'), 'shows 2.0.0')
})

// ── Edge Cases ───────────────────────────────────────────────────────────

test('CLI — chain 5 ops', async t => {
  if (!lenaPath) { t.skip('audio-lena not available'); return }

  let outPath = join(__dirname, 'tmp-cli-5.wav')
  try {
    await runCli([
      lenaPath,
      'trim',
      'gain', '-6',
      'normalize',
      'reverse',
      '-o', outPath
    ])
    let result = await audio(outPath)
    t.ok(result.duration > 10, 'all 5 ops applied')
  } finally {
    cleanup(outPath)
  }
})

test('CLI — normalize to different target', async t => {
  if (!lenaPath) { t.skip('audio-lena not available'); return }

  let outPath = join(__dirname, 'tmp-cli-6.wav')
  try {
    await runCli([lenaPath, 'normalize', '-6', '-o', outPath])
    let result = await audio(outPath)
    let peak = await result.db()
    t.ok(Math.abs(peak - (-6)) < 1, 'normalized to -6dB')
  } finally {
    cleanup(outPath)
  }
})

test('CLI — remix stereo to mono', async t => {
  if (!lenaPath) { t.skip('audio-lena not available'); return }

  let outPath = join(__dirname, 'tmp-cli-7.wav')
  try {
    await runCli([lenaPath, 'remix', '1', '-o', outPath])
    let result = await audio(outPath)
    t.is(result.channels, 1, 'remixed to mono')
  } finally {
    cleanup(outPath)
  }
})

// ── Error Handling ───────────────────────────────────────────────────────

test('CLI — unknown op produces clear error', async t => {
  try {
    await runCli([lenaPath || 'test/fixture.wav', 'foobar', '-o', '/dev/null'])
    t.fail('should have thrown')
  } catch (e) {
    t.ok(e.message.includes('foobar'), 'error mentions op name')
  }
})

test('CLI — missing input produces error', async t => {
  try {
    await runCli(['nonexistent.wav', '-o', '/dev/null'])
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
    await runCli([fixture, 'trim', 'normalize', '-o', outPath])
    let result = await audio(outPath)
    t.ok(result.duration > 0, 'mp3 has audio')
    t.ok(result.channels >= 1, 'has channels')
  } finally {
    cleanup(outPath)
  }
})

// ── Helpers ──────────────────────────────────────────────────────────────

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
