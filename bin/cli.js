#!/usr/bin/env node
/**
 * audio CLI — sox-style positional ops interface
 *
 * audio [input] [ops...] [--options]
 *
 * Examples:
 *   audio in.mp3 gain -3db trim normalize -o out.wav
 *   audio in.wav gain -3db 1s..10s -o out.wav
 *   cat in.wav | audio gain -3db > out.wav
 */

import audio from '../audio.js'
import parseDuration from 'parse-duration'

const VERSION = '2.0.0'

// ── Unit Parsing ─────────────────────────────────────────────────────────

function parseValue(str) {
  if (str.includes('..')) return str  // range syntax — handled separately
  // dB
  let m = str.match(/^(-?[\d.]+)(db)$/i)
  if (m) return Number(m[1])
  // Hz / kHz
  m = str.match(/^(-?[\d.]+)(khz)$/i)
  if (m) return Number(m[1]) * 1000
  m = str.match(/^(-?[\d.]+)(hz)$/i)
  if (m) return Number(m[1])
  // bare number
  if (/^-?[\d.]+$/.test(str)) return Number(str)
  // duration — supports compound expressions (1m30s, 2h20m, 500ms, etc.)
  let d = parseDuration(str, 's')
  if (d != null && isFinite(d)) return d
  return str  // pass as-is (e.g. filename, op name)
}

function parseRange(str) {
  let [start, end] = str.split('..')
  let s = start ? parseValue(start) : 0
  let e = end ? parseValue(end) : undefined
  return { offset: s, duration: e != null ? e - s : undefined }
}

// ── Argument Parsing ─────────────────────────────────────────────────────

function isFlag(s) {
  if (s.startsWith('--')) return true
  if (!s.startsWith('-')) return false
  let match = s.match(/^-[\d.]+(db|hz|khz|s|ms)?$/i)
  return !match
}

function isOpName(s) {
  return s in audio.op
}

function parseArgs(args) {
  let input = null, ops_ = [], output = null, format = null
  let verbose = false, showHelp = false, play = false, stat = false, force = false
  let i = 0

  // Check for explicit -i / --input flag at start
  if (args[0] === '-i' || args[0] === '--input') {
    input = args[1]
    i = 2
  }
  // Otherwise try positional first arg if it looks like a file
  else if (args.length && !isFlag(args[0]) && !isOpName(args[0])) {
    input = args[i++]
  }

  // Process remaining args
  while (i < args.length) {
    let arg = args[i]

    if (arg === '--help' || arg === '-h') {
      showHelp = true
      i++
    } else if (arg === '--verbose') {
      verbose = true
      i++
    } else if (arg === '--output' || arg === '-o') {
      output = args[++i]
      i++
    } else if (arg === '--format') {
      format = args[++i]
      i++
    } else if (arg === '-i' || arg === '--input') {
      input = args[++i]
      i++
    } else if (arg === '--play' || arg === '-p') {
      play = true
      i++
    } else if (arg === '--stat' || arg === '--info') {
      stat = true
      i++
    } else if (arg === '--force' || arg === '-f') {
      force = true
      i++
    } else if (isFlag(arg)) {
      throw new Error(`Unknown flag: ${arg}`)
    } else if (!input && !isOpName(arg)) {
      // Positional input file (even after flags)
      input = arg
      i++
    } else {
      // Parse operation
      let name = arg
      let opArgs = []
      i++

      // Collect args until next op or flag
      while (i < args.length && !isOpName(args[i]) && !isFlag(args[i])) {
        opArgs.push(parseValue(args[i]))
        i++
      }

      // Check for range syntax at end of args
      let offset = null, duration = null
      if (opArgs.length > 0 && typeof opArgs[opArgs.length - 1] === 'string' && opArgs[opArgs.length - 1].includes('..')) {
        let range = parseRange(opArgs.pop())
        offset = range.offset
        duration = range.duration
      }

      ops_.push({ name, args: opArgs, offset, duration })
    }
  }

  return { input, ops: ops_, output, format, verbose, showHelp, play, stat, force }
}

// ── I/O ──────────────────────────────────────────────────────────────────

async function getStdinBuffer() {
  return new Promise((resolve, reject) => {
    let chunks = []
    let stdin = process.stdin

    stdin.on('data', chunk => chunks.push(chunk))
    stdin.on('end', () => resolve(Buffer.concat(chunks)))
    stdin.on('error', reject)
  })
}

function formatError(err) {
  return typeof err === 'string' ? err : err.message || String(err)
}

function formatDuration(s) {
  let m = Math.floor(s / 60), sec = (s % 60).toFixed(2)
  return m > 0 ? `${m}m${sec}s` : `${sec}s`
}

// ── Main ─────────────────────────────────────────────────────────────────

async function main() {
  let args = process.argv.slice(2)

  if (!args.length || args[0] === '--help' || args[0] === '-h') {
    showUsage()
    process.exit(args.length ? 0 : 1)
  }

  if (args[0] === '--version' || args[0] === '-v' || args[0] === '-V') {
    console.log(`audio ${VERSION}`)
    process.exit(0)
  }

  try {
    let opts = parseArgs(args)

    if (opts.showHelp) {
      showUsage()
      process.exit(0)
    }

    // Determine input source
    let source
    if (opts.input) {
      source = opts.input
    } else {
      process.stderr.write('Reading from stdin...\n')
      let buf = await getStdinBuffer()
      source = buf
    }

    // Streaming playback — start playing as pages decode (no ops needed)
    if (opts.play && !opts.ops.length && !opts.output && !opts.stat && typeof source === 'string') {
      if (opts.verbose) console.error(`Opening: ${source}`)
      let a = await audio.open(source)
      let p = a.play()
      await new Promise(resolve => { p.onended = resolve })
      process.exit(0)
    }

    // Load audio (full decode)
    if (opts.verbose) console.error(`Loading: ${typeof source === 'string' ? source : '(stdin)'}`)
    let a = await audio(source, {
      onprogress: opts.verbose ? ({ offset, total }) => {
        let pct = Math.round(100 * offset / total)
        process.stderr.write(`\rDecoding... ${pct}%`)
      } : undefined
    })
    if (opts.verbose) console.error('\n')

    // --stat / --info / no-ops: show audio info
    if (opts.stat || (!opts.ops.length && !opts.output && !opts.play)) {
      let [peak, r, l] = await Promise.all([a.db(), a.rms(), a.loudness()])
      console.log(`  Duration:   ${formatDuration(a.duration)}`)
      console.log(`  Channels:   ${a.channels}`)
      console.log(`  SampleRate: ${a.sampleRate} Hz`)
      console.log(`  Samples:    ${a.length}`)
      console.log(`  Peak:       ${peak.toFixed(1)} dBFS`)
      console.log(`  RMS:        ${(20 * Math.log10(r)).toFixed(1)} dB`)
      console.log(`  Loudness:   ${l.toFixed(1)} LUFS`)
      if (!opts.ops.length && !opts.output) process.exit(0)
    }

    // Apply operations
    if (opts.ops.length) {
      if (opts.verbose) console.error(`Applying ${opts.ops.length} operation(s)...`)
      for (let op of opts.ops) {
        let { name, args, offset, duration } = op
        let fullArgs = args.slice()
        if (offset != null) fullArgs.push(offset)
        if (duration != null) fullArgs.push(duration)
        if (typeof a[name] !== 'function') throw new Error(`Unknown operation: ${name}`)
        try { a[name](...fullArgs) }
        catch (e) { throw new Error(`${name}: ${formatError(e)}`) }
      }
    }

    // --play: play the result
    if (opts.play) {
      let p = a.play()
      await new Promise(resolve => { p.onended = resolve })
      if (!opts.output) process.exit(0)
    }

    // Save output (skip if only --stat or --play without -o)
    if (opts.output || (!opts.stat && !opts.play && opts.ops.length)) {
      let output = opts.output || 'out.wav'

      // Check for overwrite
      if (!opts.force && output !== '-') {
        let { existsSync } = await import('fs')
        if (existsSync(output)) {
          process.stderr.write(`audio: ${output} already exists (use --force to overwrite)\n`)
          process.exit(1)
        }
      }

      if (opts.verbose) console.error('Rendering and saving...')
      let fmt = opts.format || (typeof output === 'string' ? output.split('.').pop() : 'wav')

      try {
        if (output === '-') {
          let bytes = await a.read({ format: fmt })
          process.stdout.write(Buffer.from(bytes))
        } else {
          await a.save(output, { format: fmt })
          if (opts.verbose) console.error(`Saved: ${output}`)
        }
      } catch (e) { throw new Error(`save ${output}: ${formatError(e)}`) }
    }
  } catch (err) {
    console.error(`audio: ${formatError(err)}`)
    process.exit(1)
  }
}

function showUsage() {
  console.log(`
audio ${VERSION} — load, edit, save, play, analyze

Usage:
  audio [input] [ops...] [-o output] [options]

Input:
  input         File path, URL, or omit for stdin
  -i, --input   Explicit input file (use with ops as first args)
  -o, --output  Output file or '-' for stdout (default: out.wav)

Operations (positional):
  gain DB       Amplify in dB (e.g., gain -3db, gain 6)
  fade DUR      Fade in/out (positive = in from start, negative = out from end)
  trim [THR]    Auto-trim silence (threshold in dB, optional)
  normalize [DB] Peak normalize (default: 0dB). Presets: streaming, podcast, broadcast
  reverse       Reverse audio
  crop OFF DUR  Crop to range in seconds
  remove OFF DUR Delete range in seconds
  insert SRC OFF Insert audio from file/duration
  repeat N      Repeat N times
  mix SRC OFF   Mix in another audio file
  remix CH      Remix channels (e.g., remix 2 for stereo)

Range syntax (for offset+duration):
  1s..10s       From 1s to 10s
  0..0.5s       First half second
  -1s..         Last second to end
  5s            Just offset (no duration)

Units:
  Seconds: 1.5s, 500ms, 1.5 (default)
  dB: -3db, 0, 6db
  Hz: 440hz, 2khz

Options:
  --play, -p    Play the result (after ops, before save)
  --stat        Show audio info (duration, channels, peak, loudness)
  --force, -f   Overwrite output file if it exists
  --verbose     Show progress and debug info
  --format FMT  Override output format (default: from extension)
  --help, -h    Show this help
  -v, --version Show version

Examples:
  audio in.mp3 --stat
  audio in.mp3 gain -3db trim normalize -o out.wav
  audio in.wav --play
  audio in.wav gain -3db 1s..10s -o out.wav
  audio in.mp3 normalize streaming -o out.wav
  cat in.wav | audio gain -3db > out.wav

For more info: https://github.com/audiojs/audio
`)
}

// Exports for testing
export { parseValue, parseRange, parseArgs }

// Run CLI if invoked directly (not imported)
let argv1 = process.argv[1]
try { argv1 = (await import('fs')).realpathSync(argv1) } catch {}
if (import.meta.url === `file://${argv1}`) {
  main().catch(err => {
    console.error(`audio: ${formatError(err)}`)
    process.exit(1)
  })
}
