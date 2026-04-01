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

import audio, { ops } from '../audio.js'

const VERSION = '2.0.0'

// ── Unit Parsing ─────────────────────────────────────────────────────────

function parseValue(str) {
  if (str.includes('..')) return str  // range syntax — handled separately
  let m = str.match(/^(-?[\d.]+)(db|khz|hz|ms|s)?$/i)
  if (!m) return str  // not a number — pass as-is
  let v = Number(m[1]), unit = m[2]?.toLowerCase()
  if (unit === 'ms') return v / 1000
  if (unit === 'khz') return v * 1000
  return v  // db, hz, s, or bare number — all are just raw values
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
  return s in ops
}

function parseArgs(args) {
  let input = null, ops_ = [], output = null, format = null, verbose = false, showHelp = false
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
    } else if (arg === '--verbose' || arg === '-v') {
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
    } else if (isFlag(arg)) {
      throw new Error(`Unknown flag: ${arg}`)
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

  return { input, ops: ops_, output, format, verbose, showHelp }
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

// ── Main ─────────────────────────────────────────────────────────────────

async function main() {
  let args = process.argv.slice(2)

  if (!args.length || args[0] === '--help' || args[0] === '-h') {
    showUsage()
    process.exit(args.length ? 0 : 1)
  }

  if (args[0] === '--version' || args[0] === '-v') {
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

    // Load audio
    if (opts.verbose) console.error(`Loading: ${typeof source === 'string' ? source : '(stdin)'}`)
    let a = await audio(source, {
      onprogress: opts.verbose ? ({ delta, offset, total }) => {
        let pct = Math.round(100 * offset / total)
        process.stderr.write(`\rDecoding... ${pct}%`)
      } : undefined
    })
    if (opts.verbose) console.error('\n')

    // Apply operations
    if (opts.ops.length) {
      if (opts.verbose) console.error(`Applying ${opts.ops.length} operation(s)...`)
      for (let op of opts.ops) {
        let { name, args, offset, duration } = op
        let fullArgs = args.slice()
        if (offset != null) fullArgs.push(offset)
        if (duration != null) fullArgs.push(duration)
        if (typeof a[name] !== 'function') throw new Error(`Unknown operation: ${name}`)
        a[name](...fullArgs)
      }
    }

    // Save output
    if (opts.verbose) console.error('Rendering and saving...')
    let output = opts.output || 'out.wav'
    let fmt = opts.format || (typeof output === 'string' ? output.split('.').pop() : 'wav')

    if (output === '-') {
      let bytes = await a.read({ format: fmt })
      process.stdout.write(Buffer.from(bytes))
    } else {
      await a.save(output, { format: fmt })
      if (opts.verbose) console.error(`Saved: ${output}`)
    }
  } catch (err) {
    console.error(`audio: ${formatError(err)}`)
    process.exit(1)
  }
}

function showUsage() {
  console.log(`
audio ${VERSION} — indexed, paged audio document

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
  normalize [DB] Peak or LUFS normalize (default: 0dB)
  reverse       Reverse audio
  crop OFF DUR  Crop to range in seconds
  remove OFF DUR Delete range in seconds
  insert SRC OFF Insert audio from file/duration
  repeat N      Repeat N times
  mix SRC OFF   Mix in another audio file
  write DATA    Overwrite region (advanced)
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
  --verbose, -v Show progress and debug info
  --format FMT  Override output format (default: from extension)
  --help, -h    Show this help
  --version     Show version

Examples:
  audio in.mp3 gain -3db trim normalize -o out.wav
  audio in.wav gain -3db 1s..10s -o out.wav
  audio -i in.wav gain -3db -o out.wav
  cat in.wav | audio gain -3db > out.wav

For more info: https://github.com/audiojs/audio
`)
}

// Exports for testing
export { parseValue, parseRange, parseArgs }

// Run CLI if invoked directly (not imported)
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(err => {
    console.error(`audio: ${formatError(err)}`)
    process.exit(1)
  })
}
