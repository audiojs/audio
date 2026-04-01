/**
 * CLI utilities: argument parsing, op tokenization, range syntax, unit parsing
 */

import { readSync } from 'fs'

// ── Helpers ──────────────────────────────────────────────────────────────

/**
 * Check if a string is a flag (starts with -- or starts with single - followed by non-digit/unit)
 * Does NOT treat negative numbers or unit values (like -3db, -5s) as flags
 */
function isFlag(s) {
  if (s.startsWith('--')) return true  // definitely a flag
  if (!s.startsWith('-')) return false // not a flag
  // Starts with single -, check if it's a number or unit value
  // -3, -3.5, -3db, -3s, -500ms, etc. are NOT flags
  let match = s.match(/^-[\d.]+(db|hz|khz|s|ms)?$/i)
  return !match  // it's a flag if it doesn't match the value pattern
}

/**
 * Recognize if a string looks like an op name (not a flag, not a value).
 */
function isOpName(s) {
  if (s.startsWith('-')) return false
  let opNames = new Set([
    'gain', 'fade', 'reverse', 'trim', 'normalize',
    'crop', 'remove', 'insert', 'repeat', 'mix', 'write', 'remix'
  ])
  return opNames.has(s)
}

// ── Main API ─────────────────────────────────────────────────────────────

/**
 * Parse command-line arguments into structured format.
 * Returns: { input, ops: [{name, args}], output, format, verbose, showHelp }
 */
export function parseArgs(args) {
  let input = null
  let ops = []
  let output = null
  let format = null
  let verbose = false
  let showHelp = false
  let macro = null

  let i = 0

  // First non-flag, non-op arg is input file
  if (args.length && !isFlag(args[0]) && !isOpName(args[0])) {
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
    } else if (arg === '--macro') {
      macro = args[++i]
      i++
    } else if (isFlag(arg)) {
      // It's a flag
      throw new Error(`Unknown flag: ${arg}`)
    } else {
      // Parse operation
      let op = parseOp(args, i)
      ops.push(op.op)
      i = op.nextIndex
    }
  }

  return { input, ops, output, format, verbose, showHelp, macro }
}

/**
 * Parse a single operation from args array.
 * Handles: opName [arg1] [arg2] [--range 1s..10s]
 * Returns: { op: {name, args}, nextIndex }
 */
function parseOp(args, startIdx) {
  let name = args[startIdx]
  let opArgs = []
  let i = startIdx + 1
  let rangeOffset = null
  let rangeDuration = null

  // Collect positional arguments until next op or flag
  while (i < args.length && !isOpName(args[i]) && !isFlag(args[i])) {
    opArgs.push(parseValue(args[i], name))
    i++
  }

  // Check for range syntax: op arg 1s..10s
  // or in the op args: gain -3db 1s..10s
  for (let j = opArgs.length - 1; j >= 0; j--) {
    if (typeof opArgs[j] === 'string' && opArgs[j].includes('..')) {
      let range = parseRange(opArgs.pop())
      rangeOffset = range.offset
      rangeDuration = range.duration
      break
    }
  }

  return {
    op: {
      name,
      args: opArgs,
      offset: rangeOffset,
      duration: rangeDuration
    },
    nextIndex: i
  }
}

/**
 * Parse a value: handle units (dB, seconds, Hz), booleans, numbers
 * Context: opName tells us what op we're in (for unit hints)
 * IMPORTANT: Does NOT parse values with '..' in them (range syntax is handled separately)
 */
function parseValue(str, opName) {
  // Don't parse range syntax here
  if (str.includes('..')) return str

  // Try unit parsing first
  if (str.includes('db')) return parseDb(str)
  if (str.includes('hz')) return parseHz(str)
  if (str.includes('s') || str.includes('ms')) return parseSeconds(str)

  // Try number
  let n = Number(str)
  if (!isNaN(n)) return n

  // Return as string (for op names, file paths, etc.)
  return str
}

/**
 * Parse dB value: -3db, -3dB, -3, etc.
 */
function parseDb(str) {
  let match = str.match(/^(-?[\d.]+)\s*db?$/i)
  if (match) return Number(match[1])
  return Number(str) // fallback
}

/**
 * Parse Hz value: 440hz, 440Hz, 440, 2khz, etc.
 */
function parseHz(str) {
  let match = str.match(/^(-?[\d.]+)\s*(k)?hz?$/i)
  if (match) return Number(match[1]) * (match[2] ? 1000 : 1)
  return Number(str) // fallback
}

/**
 * Parse time value: 1s, 500ms, 1.5, etc.
 */
function parseSeconds(str) {
  let match = str.match(/^(-?[\d.]+)\s*(ms|s)?$/i)
  if (!match) return Number(str)
  let num = Number(match[1])
  let unit = match[2]?.toLowerCase()
  if (unit === 'ms') return num / 1000
  return num
}

/**
 * Parse range syntax: 1s..10s, 0..0.5s, -1s.., etc.
 * Returns: { offset, duration }
 */
export function parseRange(str) {
  if (!str.includes('..')) return { offset: null, duration: null }

  let [start, end] = str.split('..')
  let startVal = start ? parseSeconds(start) : 0
  let endVal = end ? parseSeconds(end) : undefined

  return {
    offset: startVal,
    duration: endVal != null ? endVal - startVal : endVal
  }
}

/**
 * Format error message for display.
 */
export function formatError(err) {
  if (typeof err === 'string') return err
  if (err.message) return err.message
  return String(err)
}

/**
 * Read stdin as Buffer (Node.js).
 * Returns Promise<Buffer>
 */
export async function getStdinBuffer() {
  return new Promise((resolve, reject) => {
    let chunks = []
    let stdin = process.stdin

    stdin.on('data', chunk => chunks.push(chunk))
    stdin.on('end', () => resolve(Buffer.concat(chunks)))
    stdin.on('error', reject)

    // If stdin is already ended or not a TTY, read immediately
    if (stdin.isTTY) {
      return reject(new Error('No input data piped to stdin'))
    }
  })
}
