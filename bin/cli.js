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
import { parseArgs, formatError, getStdinBuffer } from './cli-utils.js'

const VERSION = '2.0.0'

async function main() {
  let args = process.argv.slice(2)

  // Handle --version and --help at top level
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
      // Read from stdin
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
        applyOp(a, op)
      }
    }

    // Save output
    if (opts.verbose) console.error('Rendering and saving...')
    let output = opts.output || 'out.wav'
    let format = opts.format || (typeof output === 'string' ? output.split('.').pop() : 'wav')

    if (output === '-' || !output) {
      // stdout
      let bytes = await a.read({ format })
      process.stdout.write(Buffer.from(bytes))
    } else {
      // file
      await a.save(output, { format })
      if (opts.verbose) console.error(`Saved: ${output}`)
    }
  } catch (err) {
    console.error(`audio: ${formatError(err)}`)
    process.exit(1)
  }
}

function applyOp(a, op) {
  let { name, args, offset, duration } = op

  // Build full arg list: op-specific args + range (offset, duration)
  let fullArgs = args.slice()
  if (offset != null) fullArgs.push(offset)
  if (duration != null) fullArgs.push(duration)

  // Find nargs from audio.op() registry or use heuristics
  switch (name) {
    // Structural ops
    case 'crop': a.crop(...fullArgs); break
    case 'remove': a.remove(...fullArgs); break
    case 'insert': a.insert(...fullArgs); break
    case 'repeat': a.repeat(...fullArgs); break

    // Sample ops
    case 'gain': a.gain(...fullArgs); break
    case 'fade': a.fade(...fullArgs); break
    case 'reverse': a.reverse(...fullArgs); break
    case 'mix': a.mix(...fullArgs); break
    case 'write': a.write(...fullArgs); break
    case 'remix': a.remix(...fullArgs); break

    // Smart ops
    case 'trim': a.trim(...fullArgs); break
    case 'normalize': a.normalize(...fullArgs); break

    default:
      // Try as custom op if available
      if (typeof a[name] === 'function') {
        a[name](...fullArgs)
      } else {
        throw new Error(`Unknown operation: ${name}`)
      }
  }
}

function showUsage() {
  console.log(`
audio ${VERSION} — indexed, paged audio document

Usage:
  audio [input] [ops...] [-o output] [options]

Input:
  input         File path, URL, or omit for stdin
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
  --macro FILE  Apply serialized edit list (v2+)
  --help, -h    Show this help
  --version     Show version

Examples:
  audio in.mp3 gain -3db trim normalize -o out.wav
  audio in.wav gain -3db 1s..10s -o out.wav
  cat in.raw | audio gain -3db > out.raw
  audio in.wav trim normalize --verbose -o podcast.mp3

For more info: https://github.com/audiojs/audio
`)
}

main().catch(err => {
  console.error(`audio: ${formatError(err)}`)
  process.exit(1)
})
