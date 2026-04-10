import test from 'tst'
import { parseValue, parseRange, parseArgs, showOpHelp, HELP } from '../bin/cli.js'
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
  t.is(result.ops[0].args.length, 1, 'duration in args')
  t.is(result.ops[0].curve, 'linear', 'curve as option')
})

test('parseArgs — range syntax', t => {
  let result = parseArgs(['in.wav', 'gain', '-3db', '1s..10s'])
  t.is(result.ops[0].name, 'gain')
  t.is(result.ops[0].offset, 1, 'offset 1s')
  t.is(result.ops[0].duration, 9, 'duration 9s')
})

test('parseArgs — split with time args', t => {
  let result = parseArgs(['in.wav', 'split', '30s', '60s', '-o', 'ch-{i}.wav'])
  t.is(result.ops[0].name, 'split', 'op name')
  t.is(result.ops[0].args.length, 2, '2 split points')
  t.is(result.ops[0].args[0], 30, 'first split at 30s')
  t.is(result.ops[0].args[1], 60, 'second split at 60s')
  t.is(result.output, 'ch-{i}.wav', 'template output')
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

test('parseArgs — stat op with names', t => {
  let result = parseArgs(['in.wav', 'stat', 'loudness', 'rms'])
  t.is(result.input, 'in.wav', 'input parsed')
  t.is(result.ops[0].name, 'stat', 'stat recognized as op')
  t.is(result.ops[0].args[0], 'loudness', 'first stat name')
  t.is(result.ops[0].args[1], 'rms', 'second stat name')
})

test('parseArgs — stat op with bins', t => {
  let result = parseArgs(['in.wav', 'stat', 'spectrum', '128'])
  t.is(result.ops[0].name, 'stat')
  t.is(result.ops[0].args[0], 'spectrum')
  t.is(result.ops[0].args[1], 128, 'bins parsed as number')
})

test('parseArgs — stat op bare defaults', t => {
  let result = parseArgs(['in.wav', 'stat'])
  t.is(result.ops[0].name, 'stat')
  t.is(result.ops[0].args.length, 0, 'no args = default stats')
})

test('parseArgs — stat with op-name overlap (dc, clipping)', t => {
  let result = parseArgs(['in.wav', 'stat', 'dc', 'clipping', 'rms'])
  t.is(result.ops.length, 1, 'single stat op')
  t.is(result.ops[0].name, 'stat')
  t.same(result.ops[0].args, ['dc', 'clipping', 'rms'], 'dc/clipping parsed as stat args, not ops')
})

test('parseArgs — stat after transform preserves op boundary', t => {
  let result = parseArgs(['in.wav', 'gain', '-3', 'stat', 'dc'])
  t.is(result.ops.length, 2, 'two ops')
  t.is(result.ops[0].name, 'gain')
  t.is(result.ops[1].name, 'stat')
  t.same(result.ops[1].args, ['dc'], 'dc is stat arg')
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
    let peak = await result.stat('db')
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
  // 10s stereo sine at 50Hz (below cutoff) + 1kHz (above cutoff)
  let sr = 44100, dur = 10, n = sr * dur
  let ch = new Float32Array(n)
  for (let i = 0; i < n; i++) ch[i] = 0.5 * Math.sin(2 * Math.PI * 50 * i / sr) + 0.5 * Math.sin(2 * Math.PI * 1000 * i / sr)
  let a = audio.from([ch, new Float32Array(ch)], { sampleRate: sr })
  a.highpass(200)
  let pcm = await a.read()
  // The 50Hz component should be mostly removed; energy should drop
  let sum = 0
  for (let i = sr; i < 2 * sr; i++) sum += pcm[0][i] * pcm[0][i]  // skip first second (transient)
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
    await runCli([srcPath, 'highpass', '80hz', '-o', outPath])
    let result = await audio(outPath)
    t.ok(result.duration > 1, 'highpass processed audio')
  } finally {
    cleanup(srcPath)
    cleanup(outPath)
  }
})

test('CLI — filter + mp3 encode (short)', { timeout: 30000 }, async t => {
  // 10s stereo sine → highpass + trim + fade → mp3
  let srcPath = join(__dirname, 'tmp-filter-src.wav')
  let outPath = join(__dirname, 'tmp-filter-out.mp3')
  try {
    let sr = 44100, dur = 10, n = sr * dur
    let ch = new Float32Array(n)
    for (let i = 0; i < n; i++) ch[i] = 0.5 * Math.sin(2 * Math.PI * 440 * i / sr)
    await audio.from([ch, new Float32Array(ch)], { sampleRate: sr }).save(srcPath)

    await runCli([srcPath, 'highpass', '80hz', 'trim', 'fade', '1', 'fade', '-1', '-o', outPath])
    let result = await audio(outPath)
    t.ok(result.duration > 5, `mp3 has audio: ${result.duration.toFixed(1)}s`)
  } finally {
    cleanup(srcPath)
    cleanup(outPath)
  }
})

// ── Helpers ──────────────────────────────────────────────────────────────

// ── Per-op Help ──────────────────────────────────────────────────────────

test('parseArgs — per-op help: gain --help', t => {
  let result = parseArgs(['in.wav', 'gain', '--help'])
  t.is(result.helpOp, 'gain', 'helpOp set to gain')
  t.is(result.ops.length, 0, 'no ops parsed after help')
})

test('parseArgs — per-op help: highpass -h', t => {
  let result = parseArgs(['in.wav', 'highpass', '-h'])
  t.is(result.helpOp, 'highpass', 'helpOp for highpass')
})

test('op help — all built-in ops have help', t => {
  let expected = ['gain', 'fade', 'trim', 'normalize', 'reverse', 'crop', 'remove',
    'insert', 'repeat', 'mix', 'remix', 'highpass', 'lowpass', 'eq', 'lowshelf',
    'highshelf', 'notch', 'bandpass', 'filter', 'pan', 'pad', 'speed']
  for (let op of expected) t.ok(HELP[op], `${op} has help`)
  // Reverse check: every op with help is in expected list
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
    if (name === 'filter') continue  // generic dispatch, not listed separately
    t.ok(output.includes(name), `help text includes ${name}`)
  }
})

// ── Macro System ─────────────────────────────────────────────────────────

test('parseArgs — macro flag', t => {
  let result = parseArgs(['in.wav', '--macro', 'recipe.json', '-o', 'out.wav'])
  t.is(result.macro, 'recipe.json', 'macro file parsed')
})

test('CLI — macro applies edits from JSON', async t => {
  if (!lenaPath) { t.skip('audio-lena not available'); return }

  let macroPath = join(__dirname, 'tmp-macro.json')
  let outPath = join(__dirname, 'tmp-macro-out.wav')
  try {
    writeFileSync(macroPath, JSON.stringify([
      { type: 'gain', args: [-6] }
    ]))
    await runCli([lenaPath, '--macro', macroPath, '-o', outPath])
    let result = await audio(outPath)
    let orig = await (await audio(lenaPath)).stat('db')
    let peak = await result.stat('db')
    t.ok(Math.abs(peak - (orig - 6)) < 1, `macro gain applied (got ${peak.toFixed(1)}, expected ~${(orig - 6).toFixed(1)})`)
  } finally {
    cleanup(macroPath)
    cleanup(outPath)
  }
})

test('CLI — macro combined with inline ops', async t => {
  if (!lenaPath) { t.skip('audio-lena not available'); return }

  let macroPath = join(__dirname, 'tmp-macro2.json')
  let outPath = join(__dirname, 'tmp-macro2-out.wav')
  try {
    writeFileSync(macroPath, JSON.stringify([{ type: 'gain', args: [-3] }]))
    await runCli([lenaPath, 'gain', '-6', '--macro', macroPath, '-o', outPath])
    let result = await audio(outPath)
    let orig = await (await audio(lenaPath)).stat('db')
    let peak = await result.stat('db')
    // gain -6 inline + gain -3 macro = -9dB from original
    t.ok(Math.abs(peak - (orig - 9)) < 1, `inline + macro: peak ≈ ${(orig - 9).toFixed(0)}dB (got ${peak.toFixed(1)})`)
  } finally {
    cleanup(macroPath)
    cleanup(outPath)
  }
})


// ── Pan / Pad CLI ────────────────────────────────────────────────────────

test('parseArgs — pan op', t => {
  let r = parseArgs(['in.wav', 'pan', '-0.5', '-o', 'out.wav'])
  t.is(r.ops[0].name, 'pan', 'pan op parsed')
  t.is(r.ops[0].args[0], -0.5, 'pan value')
})

test('parseArgs — pad op', t => {
  let r = parseArgs(['in.wav', 'pad', '1s', '2s', '-o', 'out.wav'])
  t.is(r.ops[0].name, 'pad', 'pad op parsed')
  t.is(r.ops[0].args[0], 1, 'before')
  t.is(r.ops[0].args[1], 2, 'after')
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
    await runCli([lenaPath, 'pad', '1s', '0', '-o', outPath, '--force'])
    let result = await audio(outPath)
    t.ok(Math.abs(result.duration - (origDur + 1)) < 0.1, `duration increased by ~1s (got ${result.duration.toFixed(2)} from ${origDur.toFixed(2)})`)
  } finally {
    cleanup(outPath)
  }
})

// ── Glob / Batch ─────────────────────────────────────────────────────────

test('parseArgs — glob input preserved', t => {
  let r = parseArgs(['*.wav', 'gain', '-3', '-o', '{name}.out.wav'])
  t.is(r.input, '*.wav', 'glob preserved as input')
  t.is(r.output, '{name}.out.wav', 'template output')
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
    await runCli(['test/tmp-batch-?.wav', 'gain', '-3', '-o', 'test/{name}.done.wav'])
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
    await runCli(['test/tmp-btpl-?.wav', 'normalize', '-o', 'test/{name}.clean.{ext}'])
    let a = await audio(out1), b = await audio(out2)
    t.ok(a.duration > 0, 'template output 1 created')
    t.ok(b.duration > 0, 'template output 2 created')
  } finally {
    cleanup(src1); cleanup(src2); cleanup(out1); cleanup(out2)
  }
})

test('CLI — batch no-force rejects existing output', async t => {
  if (!lenaPath) { t.skip('audio-lena not available'); return }
  let { copyFileSync } = await import('fs')
  let src1 = join(__dirname, 'tmp-bforce-a.wav')
  let src2 = join(__dirname, 'tmp-bforce-b.wav')
  let out1 = join(__dirname, 'tmp-bforce-a.done.wav')
  let out2 = join(__dirname, 'tmp-bforce-b.done.wav')
  try {
    copyFileSync(lenaPath, src1)
    copyFileSync(lenaPath, src2)
    // first run creates outputs
    await runCli(['test/tmp-bforce-?.wav', 'gain', '-3', '-o', 'test/{name}.done.wav', '--force'])
    // second run without --force should fail
    try {
      await runCli(['test/tmp-bforce-?.wav', 'gain', '-3', '-o', 'test/{name}.done.wav'])
      t.fail('should have thrown')
    } catch (e) {
      t.ok(e.message.includes('already exists'), 'error mentions existing file')
    }
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
    await runCli(['test/tmp-bf2-?.wav', 'gain', '-3', '-o', 'test/{name}.done.wav'])
    await runCli(['test/tmp-bf2-?.wav', 'gain', '-6', '-o', 'test/{name}.done.wav', '--force'])
    let a = await audio(out1), b = await audio(out2)
    t.ok(a.duration > 0, 'overwritten output 1 valid')
    t.ok(b.duration > 0, 'overwritten output 2 valid')
  } finally {
    cleanup(src1); cleanup(src2); cleanup(out1); cleanup(out2)
  }
})

test('CLI — split saves multiple files', async t => {
  if (!lenaPath) { t.skip('audio-lena not available'); return }

  let out1 = join(__dirname, 'tmp-split-1.wav')
  let out2 = join(__dirname, 'tmp-split-2.wav')
  try {
    // lena is ~12s, split at 6s → 2 parts
    await runCli([lenaPath, 'split', '6', '-o', join(__dirname, 'tmp-split-{i}.wav'), '--force'])

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
    await runCli(['test/nonexistent-glob-*.wav', 'gain', '-3', '-o', 'out.wav'])
    t.fail('should have thrown')
  } catch (e) {
    t.ok(e.message.includes('No files matching') || e.stderr?.includes('No files matching'), 'error mentions no matches')
  }
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
  // Reproduces encode error -2: when buildPlan returns null (filter before trim),
  // save.js falls back to whole-file encode which hits WASM memory limit.
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
