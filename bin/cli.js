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
import { toMel } from '../fn/spectrum.js'
import { lufsFromEnergy } from '../fn/loudness.js'
import parseDuration from 'parse-duration'
import fft from 'fourier-transform'

// FIXME: why do we have so many dynamic imports here? They can be static, no?

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
  // comma-separated channel map: 0,1 or 1,0,null
  if (/^[\d,_]+$/.test(str) && str.includes(',')) {
    return str.split(',').map(s => s === '_' ? null : Number(s))
  }
  // timecode: MM:SS or HH:MM:SS[.mmm]
  let tc = str.match(/^(\d+):(\d{1,2})(?::(\d{1,2}))?(?:\.(\d+))?$/)
  if (tc) {
    let [, a, b, c, frac] = tc
    let s = c != null ? +a * 3600 + +b * 60 + +c : +a * 60 + +b
    if (frac) s += +('0.' + frac)
    return s
  }
  // duration — only parse if string is purely time tokens (digits + time units),
  // never on path-like input (e.g. tmp-1.wav must not become 1)
  if (/^[\d.]+(ms|[smhdwy])([\d.]+(ms|[smhdwy]))*$/i.test(str)) {
    let d = parseDuration(str, 's')
    if (d != null && isFinite(d)) return d
  }
  return str  // pass as-is (e.g. filename, op name)
}

function parseRange(str) {
  let [start, end] = str.split('..')
  let s = start ? parseValue(start) : 0
  let e = end ? parseValue(end) : undefined
  let dur = e != null ? Math.max(0, e - s) : undefined
  return { offset: s, duration: dur }
}

/** Check if a string is a bare time value (e.g. "1s", "500ms", "1:30", "0..10s") — not an op name or path. */
function isTime(s) {
  if (typeof s !== 'string') return false
  if (s.includes('..')) return true  // range
  if (/^-?[\d.]+$/.test(s)) return false  // bare number — ambiguous, don't treat as time
  if (/^(\d+):(\d{1,2})(?::(\d{1,2}))?(?:\.(\d+))?$/.test(s)) return true  // timecode
  return /^[\d.]+(ms|[smhdwy])([\d.]+(ms|[smhdwy]))*$/i.test(s)  // strict: digits + time units, no path-like input
}

// ── Argument Parsing ─────────────────────────────────────────────────────

function isFlag(s) {
  if (s === '-') return false  // stdin/stdout marker
  if (s.startsWith('--')) return true
  if (!s.startsWith('-')) return false
  let match = s.match(/^-[\d.]+(db|hz|khz|s|ms)?$/i)
  return !match
}

function isOpName(s) {
  let op = audio.op(s)
  return (op && !op.hidden) || s === 'split' || s === 'clip'
}

// Verb taxonomy — sources produce audio, sinks terminate the chain
const SOURCE_VERBS = new Set(['record'])
const SINK_VERBS = new Set(['play', 'stat', 'save'])
const STAT_AGG = new Set(['key', 'notes', 'chords'])  // stat names handled via dedicated methods
function isVerb(s) { return SOURCE_VERBS.has(s) || SINK_VERBS.has(s) }
function isStatName(s) { return audio.stat(s) != null || STAT_AGG.has(s) }

// ── Per-op Help (injected into op descriptors for registry-driven CLI) ───

const HELP = {
  gain:      { usage: 'gain DB [RANGE]', desc: 'Amplify in dB', examples: ['gain -3db', 'gain 6 1s..5s'] },
  fade:      { usage: 'fade [IN] [-OUT] [CURVE]', desc: 'Fade in/out (bare = 0.5s both)', examples: ['fade', 'fade 1s', 'fade .2s -1s cos'] },
  trim:      { usage: 'trim [THR]', desc: 'Auto-trim silence (threshold in dB)', examples: ['trim', 'trim -40'] },
  normalize: { usage: 'normalize [DB] [MODE]', desc: 'Normalize peak/loudness', examples: ['normalize', 'normalize -3', 'normalize streaming'] },
  crop:      { usage: 'crop OFF DUR', desc: 'Crop to time range', examples: ['crop 1s..10s', 'crop 0 5s'] },
  clip:      { usage: 'clip OFF DUR', desc: 'Create a shared-page clip', examples: ['clip 1s..10s', 'clip 0 5s'] },
  remove:    { usage: 'remove OFF DUR', desc: 'Delete time range', examples: ['remove 2s..4s'] },
  reverse:   { usage: 'reverse [RANGE]', desc: 'Reverse audio', examples: ['reverse', 'reverse 1s..5s'] },
  repeat:    { usage: 'repeat N', desc: 'Repeat N times', examples: ['repeat 3'] },
  pad:       { usage: 'pad [BEFORE] [AFTER]', desc: 'Add silence to start/end (single arg = both)', examples: ['pad 1s', 'pad 0.5s 2s'] },
  speed:     { usage: 'speed RATE', desc: 'Change speed — 2 = double, 0.5 = half, -1 = reverse', examples: ['speed 2', 'speed 0.5', 'speed -1'] },
  stretch:   { usage: 'stretch FACTOR', desc: 'Time-stretch (same pitch) — 2 = 2× slower, 0.5 = 2× faster', examples: ['stretch 2', 'stretch 0.5', 'stretch 1.25'] },
  pitch:     { usage: 'pitch SEMI', desc: 'Pitch-shift in semitones (same duration)', examples: ['pitch 7', 'pitch -12', 'pitch 5'] },
  insert:    { usage: 'insert SRC [OFF]', desc: 'Insert audio at position', examples: ['insert other.wav 3s'] },
  mix:       { usage: 'mix SRC [OFF]', desc: 'Mix in another audio file', examples: ['mix bg.wav 0s'] },
  remix:     { usage: 'remix CH|MAP', desc: 'Change channel count or remap', examples: ['remix 1', 'remix 2', 'remix 1,0'] },
  pan:       { usage: 'pan VALUE [RANGE]', desc: 'Stereo balance: -1 left, 0 center, 1 right', examples: ['pan -0.5', 'pan 1 2s..5s'] },
  filter:    { usage: 'filter TYPE ...ARGS', desc: 'Generic filter dispatch', examples: ['filter highpass 80hz'] },
  highpass:  { usage: 'highpass FC [ORDER]', desc: 'High-pass filter', examples: ['highpass 80hz', 'highpass 120hz 4'] },
  lowpass:   { usage: 'lowpass FC [ORDER]', desc: 'Low-pass filter', examples: ['lowpass 8khz', 'lowpass 4khz 4'] },
  eq:        { usage: 'eq FC GAIN [Q]', desc: 'Parametric EQ', examples: ['eq 1khz -3db', 'eq 300hz 2 0.5'] },
  lowshelf:  { usage: 'lowshelf FC GAIN [Q]', desc: 'Low shelf filter', examples: ['lowshelf 200hz -3db'] },
  highshelf: { usage: 'highshelf FC GAIN [Q]', desc: 'High shelf filter', examples: ['highshelf 8khz 2db'] },
  notch:     { usage: 'notch FC [Q]', desc: 'Notch (band-reject) filter', examples: ['notch 60hz', 'notch 50hz 50'] },
  bandpass:  { usage: 'bandpass FC [Q]', desc: 'Band-pass filter', examples: ['bandpass 1khz', 'bandpass 440hz 10'] },
  allpass:   { usage: 'allpass FC [Q]', desc: 'All-pass filter (phase shift)', examples: ['allpass 1khz', 'allpass 440hz 10'] },
  vocals:    { usage: 'vocals [MODE]', desc: 'Vocal isolation (default) or removal', examples: ['vocals', 'vocals remove'] },
  dither:    { usage: 'dither [BITS] [shape:true]', desc: 'TPDF dither to target bit depth (default: 16). shape:true enables 2nd-order noise shaping.', examples: ['dither', 'dither 8', 'dither 16 shape:true'] },
  crossfeed: { usage: 'crossfeed [FC] [LEVEL]', desc: 'Headphone crossfeed for improved imaging', examples: ['crossfeed', 'crossfeed 500hz 0.4'] },
  resample:  { usage: 'resample RATE', desc: 'Change sample rate with anti-aliased downsampling', examples: ['resample 48000', 'resample 22050'] },
  crossfade: { usage: 'crossfade SRC [DUR] [CURVE]', desc: 'Crossfade into another audio file', examples: ['crossfade next.wav 2s', 'crossfade next.wav 0.5s cos'] },
  // ── sinks (terminate chain) ─────────────────────────────────────────────
  play:   { usage: 'play [loop]', desc: 'Open player UI (autoplay)', examples: ['play', 'play loop', '1s..10s play loop', 'normalize play'], kind: 'sink' },
  stat:   { usage: 'stat [NAMES...]', desc: 'Print analysis (default: overview)', examples: ['stat', 'stat loudness rms', 'stat spectrum 128'], kind: 'sink' },
  save:   { usage: 'save PATH', desc: 'Encode and write to file (or - for stdout)', examples: ['save out.wav', 'normalize save out.flac', 'save -'], kind: 'sink' },
  // ── sources (provide input) ─────────────────────────────────────────────
  record: { usage: 'record [DUR]', desc: 'Capture from microphone', examples: ['record save out.wav', 'record 30s save out.wav', 'record gain -3 play'], kind: 'source' },
}

// Inject help into op descriptors so registry is the source of truth
for (let [name, h] of Object.entries(HELP)) {
  let op = audio.op(name)
  if (op) op.help = h
}

function showOpHelp(name) {
  let h = audio.op(name)?.help || HELP[name]
  if (!h) { console.error(`No help for: ${name}`); return }
  console.log(`\n  ${h.usage}\n\n  ${h.desc}\n`)
  if (h.examples.length) console.log('  Examples:')
  for (let ex of h.examples) console.log(`    audio in.wav ${ex} -o out.wav`)
  console.log()
}

/**
 * Parse audio CLI args as a pipeline:
 *   audio [source] [transforms...] [sink] [options]
 *
 * Source: file path | 'record' | null (stdin)
 * Transforms: positional ops from audio.op() registry (gain, eq, fade, …)
 * Sink: 'play' | 'stat [NAMES...]' | 'save PATH'  (default: 'stat')
 */
function parseArgs(args) {
  let source = null, transforms = [], sink = null, range = null
  let format = null, verbose = false, showHelp = false, force = false
  let macro = null, helpOp = null, concatFiles = []
  let i = 0

  // First positional: source — `record` verb or file path (skip ranges/times/ops/sinks → those keep source = stdin)
  if (args.length && !isFlag(args[0])) {
    let a0 = args[0]
    if (SOURCE_VERBS.has(a0)) source = args[i++]
    else if (!isOpName(a0) && !SINK_VERBS.has(a0) && !a0.includes('..') && !isTime(a0)) source = args[i++]
  }

  while (i < args.length) {
    let arg = args[i]

    if (arg === '--help' || arg === '-h') { showHelp = true; i++; continue }
    if (arg === '--verbose') { verbose = true; i++; continue }
    if (arg === '--format') { format = args[++i]; i++; continue }
    if (arg === '--force' || arg === '-f') { force = true; i++; continue }
    if (arg === '--macro') { macro = args[++i]; i++; continue }
    // Compat shortcuts: -p ⇔ play, -o PATH ⇔ save PATH, -l ⇔ play loop
    if (arg === '--play' || arg === '-p') { sink = sink || { name: 'play', args: [] }; i++; continue }
    if (arg === '--output' || arg === '-o') { sink = { name: 'save', args: [args[++i]] }; i++; continue }
    if (arg === '--loop' || arg === '-l') { sink = sink || { name: 'play', args: [] }; if (!sink.args.includes('loop')) sink.args.push('loop'); i++; continue }

    if (arg === '+') {
      i++
      if (i < args.length && !isFlag(args[i]) && !isOpName(args[i]) && !isVerb(args[i])) {
        concatFiles.push(args[i++])
      } else throw new Error('Expected file after +')
      continue
    }

    if (isFlag(arg)) throw new Error(`Unknown flag: ${arg}`)

    // Bare range: `song.mp3 10s..20s play` — scopes the entire chain
    if (typeof arg === 'string' && arg.includes('..') && !isOpName(arg)) {
      range = parseRange(arg); i++; continue
    }
    // Bare time: `audio 1s play` / `audio song.mp3 1s play` — start offset, open-ended
    if (!isOpName(arg) && !SINK_VERBS.has(arg) && isTime(arg)) {
      range = { offset: parseValue(arg), duration: undefined }
      i++; continue
    }

    // Sink — terminates the chain; collect remaining positional args (ranges hoisted to top-level)
    if (SINK_VERBS.has(arg)) {
      let name = arg; i++
      let sinkArgs = []
      while (i < args.length && !isFlag(args[i])) {
        let a = args[i++]
        if (typeof a === 'string' && a.includes('..')) range = parseRange(a)
        else sinkArgs.push(parseValue(a))
      }
      if (sinkArgs.length === 0 && i < args.length && (args[i] === '--help' || args[i] === '-h')) {
        helpOp = name; i++; continue
      }
      sink = { name, args: sinkArgs }
      continue
    }

    // Transform op
    let name = arg, opArgs = []
    i++
    while (i < args.length && !isFlag(args[i])) {
      if (isOpName(args[i]) || isVerb(args[i])) break
      opArgs.push(parseValue(args[i]))
      i++
    }
    let offset = null, duration = null
    if (opArgs.length > 0 && typeof opArgs[opArgs.length - 1] === 'string' && opArgs[opArgs.length - 1].includes('..')) {
      let r = parseRange(opArgs.pop())
      offset = r.offset; duration = r.duration
    }
    if (opArgs.length === 0 && i < args.length && (args[i] === '--help' || args[i] === '-h')) {
      helpOp = name; i++; continue
    }
    transforms.push({ name, args: opArgs, offset, duration })
  }

  // Expand fade shorthand: bare `fade` or `fade IN -OUT` → two fade ops
  transforms = transforms.flatMap(op => {
    if (op.name !== 'fade') return [op]
    let nums = op.args.filter(a => typeof a === 'number')
    let curve = op.args.find(a => typeof a === 'string')
    if (nums.length === 0)
      return [{ name: 'fade', args: [0.5], curve, offset: null, duration: null },
              { name: 'fade', args: [-0.5], curve, offset: null, duration: null }]
    if (nums.length === 1 && nums[0] > 0)
      return [{ name: 'fade', args: [nums[0]], curve, offset: null, duration: null },
              { name: 'fade', args: [-nums[0]], curve, offset: null, duration: null }]
    if (nums.length === 2 && nums[0] > 0 && nums[1] < 0)
      return [{ name: 'fade', args: [nums[0]], curve, offset: null, duration: null },
              { name: 'fade', args: [nums[1]], curve, offset: null, duration: null }]
    return [op]
  })

  // Default sink: `stat` (overview) — when no explicit sink and audio is finite
  if (!sink && !showHelp && !helpOp) sink = { name: 'stat', args: [] }

  return { source, transforms, sink, range, format, verbose, showHelp, force, macro, helpOp, concatFiles }
}

const SOURCE_OPS = new Set(['mix', 'insert', 'crossfade'])

async function resolveSourceArgs(op) {
  if (!SOURCE_OPS.has(op.name)) return
  for (let i = 0; i < op.args.length; i++) {
    if (typeof op.args[i] === 'string' && !op.args[i].startsWith('-')) {
      op.args[i] = await audio(op.args[i])
    }
  }
}

function opCallArgs(op) {
  let args = (op.args || []).slice()
  let callOpts = op.opts ? { ...op.opts } : {}
  if (op.offset != null) callOpts.at = op.offset
  if (op.duration != null) callOpts.duration = op.duration
  if (op.curve) callOpts.curve = op.curve
  if (Object.keys(callOpts).length) args.push(callOpts)
  return args
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

/** Single-line prompt with optional default. Returns trimmed input, or null if cancelled.
 *  Preserves any existing 'data' listeners so callers (like the player UI) keep working after.
 *  io params are injectable for tests (default: process.stdin/stderr). */
async function prompt(label, defVal = '', { stdin = process.stdin, stderr = process.stderr } = {}) {
  if (!stdin.isTTY) return null
  let wasRaw = stdin.isRaw
  let saved = stdin.listeners('data')
  for (let l of saved) stdin.removeListener('data', l)
  stdin.setRawMode(false)
  stderr.write(`\r\x1b[K${label}${defVal ? `[${defVal}] ` : ''}`)
  stdin.resume()
  stdin.setEncoding('utf8')
  let line = await new Promise(resolve => {
    let buf = ''
    let onData = chunk => {
      for (let ch of chunk.toString()) {
        if (ch === '\r' || ch === '\n') { stdin.removeListener('data', onData); stderr.write('\n'); return resolve(buf) }
        if (ch === '\x03') { stdin.removeListener('data', onData); return resolve(null) }
        if (ch === '\x7f' || ch === '\b') buf = buf.slice(0, -1)
        else buf += ch
      }
    }
    stdin.on('data', onData)
  })
  if (wasRaw) stdin.setRawMode(true)
  for (let l of saved) stdin.on('data', l)
  return (line ?? '').trim() || defVal || null
}

/** Default save path for an audio source — writes next to it (e.g. "a/b.mp3" → "a/b.out.mp3"). */
function defaultSavePath(src) {
  if (typeof src !== 'string' || !src) return 'out.wav'
  return src.replace(/(\.[^.]+)?$/, '.out$1')
}

/** Player 'save as' flow — prompt for path, confirm overwrite, encode + write.
 *  Returns { path, msg, cancelled, failed }. Pure-ish: I/O is injectable for tests. */
async function playerSave(a, src, opts = {}, io = {}) {
  let path = await prompt('Save as: ', defaultSavePath(src), io)
  if (!path) return { cancelled: true, msg: '' }
  if (!opts.force) {
    let { existsSync } = await import('fs')
    if (existsSync(path)) {
      let yn = await prompt(`${path} exists. Overwrite? [y/N] `, '', io)
      if (yn?.toLowerCase() !== 'y') return { cancelled: true, msg: 'Save cancelled.' }
    }
  }
  // Start the spinner BEFORE awaits — `await a.ready` and the encoder warm-up
  // can take seconds for big/streaming sources, and progress events only fire
  // once chunks start encoding. Without this, the UI looks frozen.
  let { onProgress, onStart } = opts
  if (onStart) onStart(path)
  if (!a.decoded) await a.ready
  let fmt = opts.format || path.split('.').pop()
  if (onProgress) a.on('progress', onProgress)
  try {
    await a.save(path, { format: fmt })
    return { path, msg: `Saved → ${path}` }
  } catch (e) {
    return { failed: true, path, msg: `Save failed: ${formatError(e)}` }
  } finally {
    if (onProgress) a.off?.('progress', onProgress)
  }
}

/** Prompt to overwrite if TTY, silently allow if piped/scripted. */
async function confirmOverwrite(path) {
  let { existsSync } = await import('fs')
  if (!existsSync(path)) return
  if (!process.stderr.isTTY) return  // piped/scripted — silent overwrite (sox/cp behaviour)
  process.stderr.write(`audio: ${path} already exists. Overwrite? [Y/n] `)
  await new Promise(resolve => {
    process.stdin.setRawMode(true)
    process.stdin.setEncoding('utf8')
    process.stdin.once('data', d => {
      process.stdin.setRawMode(false)
      process.stdin.pause()
      process.stderr.write('\n')
      if (d.toLowerCase() === 'n') { process.stderr.write('Aborted.\n'); process.exit(1) }
      resolve()
    })
    process.stdin.resume()
  })
}

function formatError(err) {
  return typeof err === 'string' ? err : err.message || String(err)
}

function fmtTime(s, full) {
  s = Math.max(0, s)
  let h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), sec = Math.floor(s % 60)
  return full || h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`
}

const STAT_UNITS = { db: 'dBFS', loudness: 'LUFS', bpm: 'BPM' }

function fmtStat(name, result) {
  if (result instanceof Float32Array || result instanceof Float64Array || Array.isArray(result)) {
    if (!result.length) { console.log(`  ${name.padEnd(12)} none`); return }
    // Object array (silence regions)
    if (result[0]?.at != null) {
      console.log(`  ${name}:`)
      for (let r of result) console.log(`    ${r.at.toFixed(3)}s  ${r.duration.toFixed(3)}s`)
    } else if (result instanceof Float64Array) {
      // Timestamp array (beats, onsets) — display as seconds
      console.log(`  ${name.padEnd(12)} ${result.length} events`)
      for (let i = 0; i < result.length; i++) console.log(`    ${result[i].toFixed(3)}s`)
    } else {
      // Indexed array (spectrum, cepstrum, binned stats)
      console.log(`  ${name}:`)
      let pad = String(result.length - 1).length
      for (let i = 0; i < result.length; i++) console.log(`    ${String(i).padStart(pad)}  ${Number(result[i]).toFixed(4)}`)
    }
  } else {
    let unit = STAT_UNITS[name] || ''
    let val = typeof result === 'number' ? (Number.isFinite(result) ? result.toFixed(4) : '-Inf') : String(result)
    console.log(`  ${name.padEnd(12)} ${val}${unit ? ' ' + unit : ''}`)
  }
}

function spinner(lbl) {
  let i = 0, info = '', t0 = Date.now(), spin = '⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏'
  let id = setInterval(() => process.stderr.write(`\r\x1b[K${spin[i++ % 10]} ${lbl}${info}`), 80)
  return {
    label(l) { lbl = l },
    set(s) { info = s },
    stop() { clearInterval(id); process.stderr.write('\r\x1b[K'); return ((Date.now() - t0) / 1000).toFixed(1) }
  }
}

function spinnerBar(lbl) {
  let i = 0, pct = 0, speed = 0, info = '', t0 = Date.now(), spin = '⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏'
  let cols = () => process.stderr.columns || 80
  let id = setInterval(() => {
    let spd = speed > 0 ? `  · ${speed.toFixed(1)}×` : ''
    let w = Math.max(8, Math.min(16, cols() - lbl.length - info.length - spd.length - 15))
    let fill = Math.round(pct / 100 * w)
    let bar = '━'.repeat(fill) + DIM + '─'.repeat(w - fill) + RST
    process.stderr.write(`\r\x1b[K${spin[i++ % 10]} ${lbl} ${bar} ${pct}%${spd}${info}`)
  }, 80)
  return {
    label(l) { lbl = l },
    set(s) { info = s },
    progress(p, audioSec) {
      pct = Math.max(0, Math.min(100, Math.round(p * 100)))
      if (audioSec) {
        let dt = (Date.now() - t0) / 1000
        if (dt > 0.1) speed = audioSec / dt
      }
    },
    stop() { clearInterval(id); process.stderr.write('\r\x1b[K'); return ((Date.now() - t0) / 1000).toFixed(1) }
  }
}

const DIM = '\x1b[2m', RST = '\x1b[0m'

function progressBar(played, decoded, total, width) {
  // When total unknown, add headroom so decoded doesn't fill to the end
  let ref = total > 0 ? total : decoded > 0 ? decoded + Math.max(decoded * 0.2, 2) : 1
  let pFill = Math.round(played / ref * width)
  let dFill = Math.round(decoded / ref * width)
  pFill = Math.max(0, Math.min(width, pFill))
  dFill = Math.max(pFill, Math.min(width, dFill))
  let empty = width - dFill
  // Dim track for unknown remaining — keeps bar visually full-width
  return '━'.repeat(pFill) + '─'.repeat(dFill - pFill) + (empty > 0 ? DIM + '─'.repeat(empty) + RST : '')
}

const GERUNDS = { gain: 'Applying gain', fade: 'Fading', trim: 'Trimming', normalize: 'Normalizing', crop: 'Cropping', clip: 'Clipping', remove: 'Removing', reverse: 'Reversing', repeat: 'Repeating', pad: 'Padding', speed: 'Changing speed', stretch: 'Stretching', pitch: 'Pitch shifting', insert: 'Inserting', mix: 'Mixing', crossfade: 'Crossfading', remix: 'Remixing', pan: 'Panning', eq: 'Filtering', filter: 'Filtering', highpass: 'Filtering', lowpass: 'Filtering', notch: 'Filtering', bandpass: 'Filtering', lowshelf: 'Filtering', highshelf: 'Filtering', allpass: 'Filtering', vocals: 'Processing vocals', dither: 'Dithering', crossfeed: 'Applying crossfeed', resample: 'Resampling' }
function opsLabel(ops) {
  return [...new Set(ops.map(o => GERUNDS[o.name] || (o.name[0].toUpperCase() + o.name.slice(1) + 'ing')))]
}

async function playback(p, totalSec, decodedSec, a, src, opts) {
  let hasEdits = opts?.hasEdits ?? false
  let editLabel = opts?.editLabel || ''

  let cols = () => process.stderr.columns || 80
  let nLines = 1
  const SPIN = '⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏'
  let spinIdx = 0, smoothLufs = null

  // Waveform peak cache (one peak per page, computed incrementally)
  // Braille centered bars: expand from middle of 2×4 dot grid
  const WAVE = '\u2800\u2824\u2836\u28B6\u28FE\u28FF' // ⠀ ⠤ ⠶ ⢶ ⣾ ⣿
  let pagePeaks = [], peakMax = 0
  let updatePagePeaks = () => {
    if (!a) return
    for (let i = pagePeaks.length; i < a.pages.length; i++) {
      let pg = a.pages[i]
      if (!pg) break
      let ch0 = pg[0], max = 0
      for (let j = 0; j < ch0.length; j++) { let v = Math.abs(ch0[j]); if (v > max) max = v }
      pagePeaks.push(max)
      if (max > peakMax) peakMax = max
    }
  }

  let waveBar = (played, decoded, total, w) => {
    updatePagePeaks()
    if (!pagePeaks.length) return progressBar(played, decoded, total, w)
    let ref = total > 0 ? total : decoded > 0 ? decoded : 1
    let pCol = Math.round(played / ref * w), dCol = Math.round(decoded / ref * w)
    pCol = Math.max(0, Math.min(w, pCol)); dCol = Math.max(pCol, Math.min(w, dCol))
    let norm = peakMax > 1e-6 ? peakMax : 1
    let pStr = '', dStr = '', eStr = ''
    for (let i = 0; i < w; i++) {
      let pi = Math.min(Math.floor(i / w * pagePeaks.length), pagePeaks.length - 1)
      let level = pi < pagePeaks.length ? Math.round(pagePeaks[pi] / norm * 8) : 0
      let ch = '\u2581\u2582\u2583\u2584\u2585\u2586\u2587\u2588'[Math.max(0, Math.min(7, level - 1))] || ' '
      if (i < pCol) pStr += ch
      else if (i < dCol) dStr += ch
      else eStr += ' '
    }
    return pStr + DIM + dStr + RST + eStr
  }

  // FFT spectrum — via meter probe (listener-gated, peak-hold via meter opts)
  const SBARS = ' ▁▂▃▄▅▆▇█', SPEC_BINS = 128
  let liveSpec = null  // latest per-frame mel magnitudes, length SPEC_BINS
  if (fft) a?.meter({ type: 'spectrum', bins: SPEC_BINS, hold: 0.5 }, bins => { liveSpec = bins })

  // Auto-scaling: track running peak dB for spectrum
  let specMax = -60

  let spec = (sr, w, paused) => {
    if (!fft || !liveSpec) return DIM + '▁'.repeat(w) + RST
    // Downsample/upsample SPEC_BINS → w using area-weighted averaging
    let src = liveSpec, sn = src.length
    let resized = new Float32Array(w)
    for (let i = 0; i < w; i++) {
      let a0 = i / w * sn, a1 = (i + 1) / w * sn
      let lo = Math.floor(a0), hi = Math.min(sn - 1, Math.ceil(a1) - 1), n = 0, s = 0
      for (let k = lo; k <= hi; k++) { s += src[k]; n++ }
      resized[i] = n ? s / n : 0
    }
    // Auto-scale: find current max dB, decay peak slowly
    let curMax = -100, specDb = new Float32Array(w)
    for (let b = 0; b < w; b++) {
      specDb[b] = 20 * Math.log10(resized[b] + 1e-10)
      if (specDb[b] > curMax) curMax = specDb[b]
    }
    specMax = paused ? curMax : Math.max(curMax, specMax - 0.3)
    let floor = specMax - 48  // 48dB dynamic range, 6dB per level
    let levels = new Int8Array(w)
    for (let b = 0; b < w; b++) levels[b] = Math.round((specDb[b] - floor) / 6)
    let lo = 0, hi = w - 1
    while (lo < w && levels[lo] <= 0) lo++
    while (hi > lo && levels[hi] <= 0) hi--
    let out = lo > 0 ? DIM + '▁'.repeat(lo) + RST : ''
    for (let b = lo; b <= hi; b++) out += SBARS[Math.max(1, Math.min(8, levels[b]))]
    let tail = w - 1 - hi
    if (tail > 0) out += DIM + '▁'.repeat(tail) + RST
    return out
  }

  let freqLabels = (sr, w) => {
    if (!fft || w < 20) return ''
    let fMax = Math.min(sr / 2, 20000), mMin = toMel(30), mMax = toMel(fMax)
    let marks = [[50,'50'],[100,'100'],[200,'200'],[500,'500'],[1000,'1k'],[2000,'2k'],[5000,'5k'],[10000,'10k']]
    let srLbl = fMax >= 1000 ? Math.round(fMax / 1000) + 'k' : Math.round(fMax) + ''
    let arr = new Array(w).fill(' ')
    // Max freq at right
    let srStart = w - srLbl.length
    if (srStart > 0) for (let i = 0; i < srLbl.length; i++) arr[srStart + i] = srLbl[i]
    // Freq marks
    for (let [f, lbl] of marks) {
      if (f > fMax) continue
      let pos = Math.round((toMel(f) - mMin) / (mMax - mMin) * (w - 1))
      let start = pos - Math.floor(lbl.length / 2)
      if (start < 0) start = 0
      if (start + lbl.length > srStart - 1) continue
      let ok = true
      for (let c = Math.max(0, start - 1); c < start + lbl.length + 1 && ok; c++) if (c < w && arr[c] !== ' ') ok = false
      if (!ok) continue
      for (let c = 0; c < lbl.length; c++) arr[start + c] = lbl[c]
    }
    return arr.join('')
  }

  const VOL = '▁▂▃▄▅▆▇'
  let volBar = v => {
    let n = Math.max(1, Math.min(7, Math.round(v * 7)))
    let tail = 7 - n
    return VOL.slice(0, n) + (tail ? DIM + '▁'.repeat(tail) + RST : '')
  }

  // File info (computed eagerly after decode, refreshed after ops)
  let fileInfo = null, msg = '', msgTimer = null
  // For edited audio that's already decoded, show basic info immediately
  if (hasEdits && a?.decoded) fileInfo = `${a.sampleRate >= 1000 ? Math.round(a.sampleRate / 1000) + 'k' : a.sampleRate}   ${a.channels}ch   ${fmtTime(a.duration)}`
  let flash = m => { msg = m; clearTimeout(msgTimer); msgTimer = setTimeout(() => { msg = ''; render(p.currentTime) }, 1500) }
  let fmtRate = sr => { let k = sr / 1000; return (k % 1 ? k.toFixed(1) : k) + 'k' }
  let refreshing = false
  let refreshInfo = async () => {
    if (!a?.decoded) return
    refreshing = true
    render(p.currentTime)
    try {
      let [clips, dcOff] = await a.stat(['clipping', 'dc'])
      let warn = ''
      if (clips.length) warn += `   ${clips.length} clip${clips.length > 1 ? 's' : ''}`
      if (Math.abs(dcOff) > 0.001) warn += `   dc:${dcOff.toFixed(4)}`
      fileInfo = `${fmtRate(a.sampleRate)}   ${a.channels}ch   ${fmtTime(a.duration)}${warn}`
    } catch { fileInfo = '(info unavailable)' }
    refreshing = false
    render(p.currentTime)
  }

  // Live BPM — 8s sliding window around current position, updated every 2s.
  // Cheap: reads from energy blocks already in memory, no second stream.
  let liveBpmStr = '   … BPM'  // placeholder until first detection completes
  let bpmHistory = [], lastBpmVal = 0
  let updateLiveBpm = async () => {
    if (!a?.decoded) return
    let t = p.currentTime, dur = a.duration, win = Math.min(8, dur)
    let at = Math.max(0, Math.min(t - win / 2, dur - win))
    // Energy ODF from cached blocks — instant, no streaming, no event-loop blocking.
    let reading = await a.stat('bpm', { at, duration: win, minConfidence: 0.04 })
    reading = reading > 0 ? Math.round(reading) : 0
    bpmHistory = [...bpmHistory.slice(-3), reading]
    let valid = bpmHistory.filter(b => b > 0)
    if (valid.length >= 1) {
      let sorted = [...valid].sort((a, b) => a - b)
      let median = sorted[Math.floor(sorted.length / 2)]
      let relSpread = (sorted[sorted.length - 1] - sorted[0]) / median
      lastBpmVal = median
      // Too variable (>25% spread): rhythm real but tempo unclear — show marker only
      // Somewhat variable (10-25%): show approximate value with ~
      // Stable (<10%): show clean value
      liveBpmStr = relSpread > 0.25 ? `   ~ BPM` : relSpread > 0.10 ? `   ~${median} BPM` : `   ${median} BPM`
    } else if (lastBpmVal > 0) {
      liveBpmStr = `   ~ BPM`
    } else {
      liveBpmStr = ''
    }
    render(p.currentTime)
  }

  ;(async () => {
    if (!a) return
    if (!a.decoded) await new Promise(r => { let id = setInterval(() => { if (a.decoded) { clearInterval(id); r() } }, 200) })
    await refreshInfo()
    await updateLiveBpm()
  })()

  let prompting = false
  // Clear all player UI lines so a prompt has unobstructed space.
  let clearUI = () => {
    let out = '\r\x1b[K'
    for (let i = 1; i < nLines; i++) out += '\n\x1b[K'
    if (nLines > 1) out += `\x1b[${nLines - 1}A`
    process.stderr.write(out)
    nLines = 1
  }

  let render = t => {
    if (prompting) return  // suspend during 'Save as:' / overwrite prompts
    let w = cols()
    let ts = totalSec?.() || 0, ds = decodedSec?.() ?? ts
    let icon = p.paused ? '▶' : '⏸'
    let ct = fmtTime(t, true), tt = ts > 0 ? '-' + fmtTime(ts - t, true) : '-0:00:00'
    let loop = p.loop ? '↻' : ' '
    let vb = volBar(p.volume)
    let barStart = ct.length + 3  // icon + space + time + space
    let lpad = ' '.repeat(barStart)
    let pad = barStart + tt.length + 7 + 5  // 7 = vol visual width, +1 loop +1 space
    let barW = Math.max(10, w - pad)
    let bar = progressBar(t, ds, ts, barW)

    // Cursor at playback position in progress bar
    // Cursor position — same ref as progressBar so cursor stays within the bar's played region
    let cRef = ts > 0 ? ts : ds > 0 ? ds + Math.max(ds * 0.2, 2) : 1
    let pFill = Math.round(Math.min(t / cRef, 1) * barW)
    let cursorCol = barStart + pFill

    let out = `\r\x1b[K${icon} ${ct} ${bar} ${tt} ${loop} ${vb}`
    let newLines = 1

    if (fft) {
      let sw = barW
      let sr = p.sampleRate || 44100
      let s = spec(sr, sw, p.paused)
      out += `\n\x1b[K${lpad}${s}`
      newLines++
      let fl = freqLabels(sr, sw)
      if (fl.trim()) {
        out += `\n\x1b[K${lpad}${DIM}${fl.trimEnd()}${RST}`; newLines++
      }
    }

    // Info line
    let decoding = ''
    if (a && !a.decoded) {
      updatePagePeaks()
      decoding = `   ${SPIN[spinIdx++ % 10]} decoding`
    } else if (refreshing || (hasEdits && !p.block && !p.ended)) {
      decoding = `   ${SPIN[spinIdx++ % 10]} ${editLabel || 'processing'}`
    }

    // Rolling dBFS — peak of stats.max blocks over last 3s; real-time, seek-safe
    let localDbStr = ''
    if (a?.stats?.max?.[0]?.length) {
      let bs = a.stats.blockSize, sr = a.sampleRate
      let toB = Math.min(Math.floor(t * sr / bs) + 1, a.stats.max[0].length)
      let fromB = Math.max(0, toB - Math.ceil(3 * sr / bs))
      if (toB > fromB) {
        let peak = 0
        for (let c = 0; c < a.channels; c++)
          for (let i = fromB; i < toB; i++) if (a.stats.max[c][i] > peak) peak = a.stats.max[c][i]
        if (peak > 1e-6) localDbStr = `   ${(20 * Math.log10(peak)).toFixed(1)} dBFS`
      }
    }

    // Rolling LUFS — K-weighted energy over last 3s; real-time, seek-safe
    let localLufsStr = ''
    if (a?.stats?.energy?.[0]?.length) {
      let bs = a.stats.blockSize, sr = a.sampleRate
      let toB = Math.min(Math.floor(t * sr / bs) + 1, a.stats.energy[0].length)
      let fromB = Math.max(0, toB - Math.ceil(3 * sr / bs))
      if (toB > fromB) {
        let chs = Array.from({ length: a.channels }, (_, i) => i)
        let lufs = lufsFromEnergy(a.stats.energy, chs, sr, bs, fromB, toB)
        if (lufs !== null) {
          smoothLufs = smoothLufs == null ? lufs : 0.05 * lufs + 0.95 * smoothLufs
          localLufsStr = `   ${smoothLufs.toFixed(1)} LUFS`
        }
      }
    }

    let infoStr = msg || (fileInfo ? fileInfo + localDbStr + localLufsStr + liveBpmStr + decoding : (a ? `${fmtRate(a.sampleRate)}   ${a.channels}ch${decoding}` : ''))
    out += '\n\x1b[K'; newLines++
    if (infoStr) { out += `\n\x1b[K  ${DIM}${infoStr}${RST}`; newLines++ }

    for (let i = newLines; i < nLines; i++) out += '\n\x1b[K'
    let up = Math.max(newLines, nLines) - 1
    if (up > 0) out += `\x1b[${up}A`
    out += `\x1b[${cursorCol + 1}G`

    nLines = newLines
    process.stderr.write(out)
  }

  render(0)
  let tick = setInterval(() => render(p.currentTime), 40)
  let bpmTick = setInterval(updateLiveBpm, 2000)

  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true)
    process.stdin.resume()
    process.stdin.on('data', async key => {
      let k = key.toString()
      if (k === ' ') { p.paused ? p.resume() : p.pause(); render(p.currentTime) }
      else if (k === '\x1b[1;2C' || k === '\x1b[1;5C' || k === '\x1bf') { let t = Math.max(0, p.currentTime + 60); p.seek(t); render(t) }
      else if (k === '\x1b[1;2D' || k === '\x1b[1;5D' || k === '\x1bb') { let t = Math.max(0, p.currentTime - 60); p.seek(t); render(t) }
      else if (k === '\x1b[C') { let t = Math.max(0, p.currentTime + 10); p.seek(t); render(t) }
      else if (k === '\x1b[D') { let t = Math.max(0, p.currentTime - 10); p.seek(t); render(t) }
      else if (k === '\x1b[A') { p.volume = Math.min(p.volume + 0.1, 1); render(p.currentTime) }
      else if (k === '\x1b[B') { p.volume = Math.max(p.volume - 0.1, 0); render(p.currentTime) }
      else if (k === 'l') { p.loop = !p.loop; render(p.currentTime) }
      else if (k === 's' && a) {
        let wasPaused = p.paused
        if (!wasPaused) p.pause()
        prompting = true
        clearUI()  // wipe player UI so prompt isn't overwritten by tick renders
        let sp = null
        let result
        try {
          result = await playerSave(a, src, {
            force: opts.force,
            format: opts.format,
            onStart: path => { sp = spinnerBar(`Saving → ${path}`) },
            onProgress: ({ offset, total }) => { if (sp && total) sp.progress(offset / total, offset) }
          })
        } finally {
          let elapsed = sp ? sp.stop() : null
          prompting = false
          if (!wasPaused) p.resume()
          let msg = result?.cancelled ? result.msg
            : result?.failed ? result.msg
            : result?.path ? `Saved → ${result.path}${elapsed ? ` (${elapsed}s)` : ''}`
            : ''
          if (msg) flash(msg)
          else render(p.currentTime)
        }
      }
      else if (k === 'q' || k === '\x03') p.stop()
    })
  }

  await new Promise(r => { p.on('ended', r) })
  clearInterval(tick)
  clearInterval(bpmTick)

  if (process.stdin.isTTY) {
    process.stdin.setRawMode(false)
    process.stdin.removeAllListeners('data')
  }

  clearUI()
}

// ── Plugin Auto-Discovery ────────────────────────────────────────────────

async function discoverPlugins() {
  try {
    let { readdir } = await import('fs/promises')
    let { join } = await import('path')
    let { createRequire } = await import('module')
    let require = createRequire(import.meta.url)
    let nmDir = join(require.resolve('../package.json'), '..', 'node_modules')
    let entries
    try { entries = await readdir(nmDir) } catch { return }
    let plugins = entries.filter(n => n.startsWith('audio-') && !n.startsWith('audio-decode') && !n.startsWith('audio-type')
      && !n.startsWith('audio-lena') && !n.startsWith('audio-speaker') && !n.startsWith('audio-filter') && !n.startsWith('audio-encode'))
    for (let name of plugins) {
      try {
        let mod = await import(join(nmDir, name, 'index.js'))
        let plugin = mod.default || mod
        if (typeof plugin === 'function') audio.use(plugin)
      } catch {}
    }
  } catch {}
}

// ── Main ─────────────────────────────────────────────────────────────────

async function main() {
  let args = process.argv.slice(2)

  if (!args.length || args[0] === '--help' || args[0] === '-h') {
    showUsage()
    process.exit(args.length ? 0 : 1)
  }

  if (args[0] === '--version' || args[0] === '-v' || args[0] === '-V') {
    console.log(`audio ${audio.version}`)
    process.exit(0)
  }

  // ── Shell Completions ──────────────────────────────────────────────────
  if (args[0] === '--completions') {
    let shell = args[1]
    if (shell === 'zsh') {
      console.log(`#compdef audio
_audio() {
  local -a reply
  if (( CURRENT == 2 )); then
    _files
    return
  fi
  reply=(\${(f)"$(audio --completions-list "\${words[CURRENT-1]}" "\${words[CURRENT]}" 2>/dev/null)"})
  if (( \${#reply} )); then
    compadd -Q -- \${reply}
  else
    _files
  fi
}
compdef _audio audio`)
    } else if (shell === 'bash') {
      console.log(`_audio() {
  local cur prev
  cur="\${COMP_WORDS[COMP_CWORD]}"
  prev="\${COMP_WORDS[COMP_CWORD-1]}"
  if [[ \$COMP_CWORD -eq 1 ]]; then
    COMPREPLY=($(compgen -f -- "$cur"))
    return
  fi
  local IFS=$'\\n'
  COMPREPLY=($(compgen -W "$(audio --completions-list "$prev" "$cur" 2>/dev/null)" -- "$cur"))
  [[ \${#COMPREPLY[@]} -eq 0 ]] && COMPREPLY=($(compgen -f -- "$cur"))
}
complete -o default -F _audio audio`)
    } else if (shell === 'fish') {
      console.log(`function __audio_needs_command
  test (count (commandline -cop)) -gt 1
end
complete -c audio -n __audio_needs_command -f -a '(audio --completions-list (commandline -cop)[-1] (commandline -ct) 2>/dev/null)'`)
    } else {
      console.error('Usage: audio --completions <zsh|bash|fish>')
      console.error('  eval "$(audio --completions zsh)"')
      process.exit(1)
    }
    process.exit(0)
  }

  if (args[0] === '--completions-list') {
    await discoverPlugins()
    let prev = args[1] || '', cur = args[2] || ''
    let ops = Object.keys(HELP).concat('split')
    let flags = ['--force', '--verbose', '--format', '--macro', '--help', '--version', '-f']

    // Context-aware completions
    let out = []
    if (prev === 'save') {
      // Need filename — return empty, shell falls back to file completion
      process.exit(0)
    } else if (prev === 'stat') {
      out = ['db', 'rms', 'loudness', 'clipping', 'dc', 'silence', 'spectrum', 'cepstrum', 'bpm', 'beats', 'onsets', 'key', 'notes', 'chords']
    } else if (prev === 'normalize') {
      out = ['streaming', 'podcast', 'broadcast', '-1', '-3', '-6']
    } else if (prev === 'fade') {
      out = ['linear', 'exp', 'log', 'cos']
    } else if (prev === 'speed') {
      out = ['0.5', '2', '-1', '0.25', '1.5']
    } else if (prev === 'stretch') {
      out = ['0.5', '0.75', '1.25', '1.5', '2']
    } else if (prev === 'pitch') {
      out = ['-12', '-7', '-5', '5', '7', '12']
    } else if (prev === 'remix') {
      out = ['1', '2']
    } else if (prev === 'gain') {
      out = ['-3db', '-6db', '-12db', '3db', '6db']
    } else if (prev === 'highpass') {
      out = ['80hz', '120hz', '200hz', '400hz']
    } else if (prev === 'lowpass') {
      out = ['4khz', '8khz', '12khz', '16khz']
    } else if (prev === 'notch') {
      out = ['50hz', '60hz']
    } else if (prev === 'eq') {
      out = ['100hz', '300hz', '1khz', '3khz', '8khz']
    } else if (prev === 'lowshelf') {
      out = ['100hz', '200hz', '300hz']
    } else if (prev === 'highshelf') {
      out = ['4khz', '8khz', '12khz']
    } else if (prev === 'pan') {
      out = ['-1', '-0.5', '0', '0.5', '1']
    } else if (prev === 'trim') {
      out = ['-20db', '-30db', '-40db', '-50db']
    } else if (prev === 'allpass') {
      out = ['100hz', '440hz', '1khz', '4khz']
    } else if (prev === 'vocals') {
      out = ['isolate', 'remove']
    } else if (prev === 'dither') {
      out = ['8', '16', '24']
    } else if (prev === 'crossfeed') {
      out = ['500hz', '700hz', '1khz']
    } else if (prev === '--format') {
      out = ['wav', 'mp3', 'flac', 'ogg', 'opus', 'aiff']
    } else if (cur.startsWith('-')) {
      out = flags
    } else {
      out = ops
    }
    console.log(out.join('\n'))
    process.exit(0)
  }

  try {
    await discoverPlugins()
    let opts = parseArgs(args)

    if (opts.showHelp) {
      showUsage()
      process.exit(0)
    }

    // Per-op help
    if (opts.helpOp) {
      showOpHelp(opts.helpOp)
      process.exit(0)
    }

    // Macro edits — folded into the transform list
    let macroOps = []
    if (opts.macro) {
      let { readFileSync } = await import('fs')
      let raw = JSON.parse(readFileSync(opts.macro, 'utf-8'))
      let edits = Array.isArray(raw) ? raw : raw.edits || raw.ops
      if (!Array.isArray(edits)) throw new Error('Macro file must contain an array of edits')
      macroOps = edits.map(e => {
        if (!Array.isArray(e)) {
          let name = e.type || e.name || e.op
          let args = Array.isArray(e.args) ? [...e.args] : []
          let o = { ...e }
          delete o.type; delete o.name; delete o.op; delete o.args
          return { name, args, opts: o, offset: o.at ?? o.offset ?? null, duration: o.duration ?? null }
        }
        let hasOpts = e.length > 1 && typeof e.at(-1) === 'object' && !Array.isArray(e.at(-1))
        let o = hasOpts ? { ...e.at(-1) } : {}
        let args = hasOpts ? e.slice(1, -1) : e.slice(1)
        return { name: e[0], args, opts: o, offset: o.at ?? null, duration: o.duration ?? null }
      })
    }
    let transforms = [...opts.transforms, ...macroOps]
    let { source, sink, range } = opts

    // Validate transform names
    for (let op of transforms) {
      if (op.name !== 'split' && op.name !== 'clip' && !audio.op(op.name))
        throw new Error(`Unknown operation: ${op.name}`)
    }

    // ── source: record ──────────────────────────────────────────────────
    if (source === 'record') return runRecord(transforms, sink, range, opts)

    // ── source: glob → batch ────────────────────────────────────────────
    if (typeof source === 'string' && (source.includes('*') || source.includes('?')))
      return runBatch(source, transforms, sink, range, opts)

    // ── source: file/stdin ──────────────────────────────────────────────
    let actualSource = source
    if (!actualSource) {
      process.stderr.write('Reading from stdin...\n')
      actualSource = await getStdinBuffer()
    } else if (opts.concatFiles.length) {
      actualSource = [actualSource, ...opts.concatFiles]
    }

    // ── sink: play ──────────────────────────────────────────────────────
    if (sink.name === 'play') {
      let canStream = transforms.every(op => {
        let desc = audio.op(op.name)
        return desc && !desc.plan && !(desc.resolve && !desc.streamable) && op.name !== 'clip' && op.name !== 'split'
      })
      let isFile = typeof actualSource === 'string' || Array.isArray(actualSource)
      let a = audio(actualSource)
      await new Promise(r => a.on('metadata', r))

      let loop = sink.args.includes('loop')
      let playOpts = { paused: !canStream || !isFile, loop }
      if (range) { playOpts.at = range.offset; playOpts.duration = range.duration }

      if (canStream && isFile) {
        for (let op of transforms) {
          let args = opCallArgs(op)
          if (op.name === 'clip') a = a.clip(...args)
          else a[op.name](...args)
        }
      } else {
        ;(async () => {
          await a
          for (let op of transforms) {
            await resolveSourceArgs(op)
            let args = opCallArgs(op)
            if (op.name === 'clip') a = a.clip(...args)
            else a[op.name](...args)
          }
          p.resume()
        })()
      }
      var p = a.play(playOpts)
      await playback(p,
        () => a.decoded ? a.duration : a._.estDur || 0,
        () => a.pages.length * audio.PAGE_SIZE / a.sampleRate,
        a, actualSource, { hasEdits: !!transforms.length, editLabel: opsLabel(transforms).join(', ').toLowerCase(), range, transforms, format: opts.format, force: opts.force }
      )
      process.exit(0)
    }

    // ── sink: stat / save  (full decode) ────────────────────────────────
    if (opts.verbose) console.error(`Loading: ${typeof actualSource === 'string' ? actualSource : '(stdin)'}`)
    let spin = !opts.verbose ? spinnerBar('Decoding') : null
    let a = audio(actualSource)
    if (spin) a.on('data', ({ offset }) => { if (a._.estDur) spin.progress(offset / a._.estDur, offset) })
    if (opts.verbose) a.on('data', ({ offset }) => process.stderr.write(`\rDecoding... ${fmtTime(offset)}`))
    await a
    let loadTime = spin?.stop()
    if (opts.verbose) console.error('\n')

    // ── sink: save ──────────────────────────────────────────────────────
    if (sink.name === 'save') return runSave(a, transforms, sink.args, range, opts, actualSource, loadTime)

    // ── sink: stat ──────────────────────────────────────────────────────
    // Apply transforms (clip rebinds a)
    for (let op of transforms) {
      await resolveSourceArgs(op)
      let args = opCallArgs(op)
      if (op.name === 'clip') a = a.clip(...args)
      else { try { a[op.name](...args) } catch (e) { throw new Error(`${op.name}: ${formatError(e)}`) } }
    }

    let statNames = sink.args.filter(v => typeof v === 'string')
    if (!statNames.length) return printOverview(a, range, loadTime)
    return printStats(a, sink.args, statNames, range)
  } catch (err) {
    console.error(`audio: ${formatError(err)}`)
    process.exit(1)
  }
}

const FILTERS = new Set(['highpass', 'lowpass', 'eq', 'lowshelf', 'highshelf', 'notch', 'bandpass', 'allpass', 'filter'])

function showUsage() {
  let sources = [], sinks = [], ops = [], filters = [], seen = new Set()
  for (let [name, desc] of Object.entries(audio.op())) {
    let h = desc.help
    if (!h || desc.hidden) continue
    seen.add(name)
    let line = `  ${h.usage.padEnd(28)} ${h.desc}`
    if (h.kind === 'source') sources.push(line)
    else if (h.kind === 'sink') sinks.push(line)
    else if (FILTERS.has(name)) filters.push(line)
    else ops.push(line)
  }
  for (let [name, h] of Object.entries(HELP)) {
    if (seen.has(name)) continue
    let line = `  ${h.usage.padEnd(28)} ${h.desc}`
    if (h.kind === 'source') sources.push(line)
    else if (h.kind === 'sink') sinks.push(line)
    else if (FILTERS.has(name)) filters.push(line)
    else ops.push(line)
  }
  console.log(`
audio ${audio.version} — load, edit, save, play, analyze

Usage:
  audio [source] [transforms...] [sink] [options]

A pipeline: a source produces audio, transforms reshape it, a sink consumes it.
The default sink is 'stat' — printing an overview.

Source:
  FILE          Path, URL, or glob ('*.wav' for batch)
  -             Read from stdin (or omit when piping in)
${sources.join('\n')}

Transforms (chained left-to-right):
${ops.join('\n')}

Filters (ORDER = steepness: 2 = -12dB/oct, 4 = -24dB/oct, default: 2):
${filters.join('\n')}

Sinks (terminate the chain — at most one):
${sinks.join('\n')}

Range syntax (scopes the chain — applies to sink):
  1s..10s       From 1s to 10s
  0..0.5s       First half second
  -1s..         Last second to end
  5s            Just offset (no duration)

Units:
  Seconds: 1.5s, 500ms, 1.5, 1:30 (default seconds)
  dB: -3db, 0, 6db
  Hz: 440hz, 2khz

Options:
  --force, -f   Overwrite output file if it exists
  --macro FILE  Apply edits from JSON file
  --verbose     Show progress and debug info
  --format FMT  Override output format (default: from extension)
  --help, -h    Show this help (or after an op: audio gain --help)
  --version, -v Show version
  --completions SHELL  Print tab-completion script (zsh, bash, fish)

Batch:
  audio '*.wav' gain -3db save '{name}.out.{ext}'

Examples:
  audio in.mp3                              Show overview (default sink)
  audio in.mp3 play                         Open player
  audio 10s..20s stat                       Range from stdin
  audio in.mp3 10s..20s play loop           Play range, loop
  audio in.mp3 10s..20s fade 1s 1s play     Play range with effects
  audio in.mp3 stat loudness rms            Specific stats
  audio in.mp3 gain -3db trim save out.wav  Edit and save
  audio in.mp3 normalize save out.wav
  audio in.mp3 highpass 80hz eq 300hz -2db save out.wav
  audio record 30s save voice.wav           Capture mic
  audio in.mp3 + b.mp3 + c.mp3 save out.wav Concat sources
  cat in.wav | audio gain -3db save -       Pipe mode (stdin → stdout)

Player controls:
  space     Pause / resume
  ←/→       Seek ±10s
  ⇧←/⇧→    Seek ±60s
  ↑/↓       Volume ±10%
  l         Toggle loop
  s         Save as…
  q         Quit

For more info: https://github.com/audiojs/audio
`)
}

// ── Sink/Source Implementations ─────────────────────────────────────────

async function applyTransforms(a, transforms) {
  for (let op of transforms) {
    await resolveSourceArgs(op)
    let args = opCallArgs(op)
    if (op.name === 'clip') a = a.clip(...args)
    else { try { a[op.name](...args) } catch (e) { throw new Error(`${op.name}: ${formatError(e)}`) } }
  }
  return a
}

async function runSave(a, transforms, sinkArgs, range, opts, source, loadTime) {
  let output = sinkArgs.find(v => typeof v === 'string')
  if (!output) throw new Error('save: missing output path (use - for stdout)')

  // Split: pre-ops apply to whole, split fans out, post-ops apply per-part, save per-part
  let splitIdx = transforms.findIndex(o => o.name === 'split')
  if (splitIdx >= 0) {
    let pre = transforms.slice(0, splitIdx), splitOp = transforms[splitIdx], post = transforms.slice(splitIdx + 1)
    a = await applyTransforms(a, pre)
    let parts = a.split(...splitOp.args)
    for (let op of post) for (let part of parts) part[op.name](...opCallArgs(op))
    let { basename, extname } = await import('path')
    let srcExt = typeof source === 'string' ? extname(source) : '.wav'
    let srcName = typeof source === 'string' ? basename(source, srcExt) : 'audio'
    for (let [i, part] of parts.entries()) {
      let outFile = output
        .replace('{i}', String(i + 1))
        .replace('{name}', srcName)
        .replace('{ext}', srcExt.slice(1))
      let fmt = opts.format || outFile.split('.').pop()
      await part.save(outFile, { format: fmt })
      process.stderr.write(`  → ${outFile}\n`)
    }
    process.exit(0)
  }

  if (output !== '-' && !opts.force) await confirmOverwrite(output)

  a = await applyTransforms(a, transforms)
  if (!a.decoded) {
    let sp = !opts.verbose ? spinnerBar('Decoding') : null
    if (sp && a._.estDur) a.on('data', ({ offset }) => sp.progress(offset / a._.estDur, offset))
    await a.ready
    sp?.stop()
  }

  let fmt = opts.format || (output === '-' ? 'wav' : output.split('.').pop())
  let saveOpts = { format: fmt }
  if (range) { saveOpts.at = range.offset; saveOpts.duration = range.duration }

  try {
    if (output === '-') {
      let bytes = await a.encode(fmt, saveOpts)
      process.stdout.write(Buffer.from(bytes))
    } else {
      let lbl = transforms.length
        ? (() => { let n = opsLabel(transforms); return n.length === 1 ? `${n[0]} + saving` : 'Applying edits + saving' })()
        : 'Saving'
      let sp = !opts.verbose ? spinnerBar(lbl) : null
      await new Promise(r => setTimeout(r, 100))
      if (sp) a.on('progress', ({ offset, total }) => sp.progress(offset / total, offset))
      await a.save(output, saveOpts)
      let elapsed = sp?.stop()
      if (opts.verbose) console.error(`Saved: ${output}`)
      else if (elapsed) console.error(`Saved ${output} in ${elapsed}s`)
    }
  } catch (e) { throw new Error(`save ${output}: ${formatError(e)}`) }
  process.exit(0)
}

async function printOverview(a, range, loadTime) {
  let statOpts = range ? { at: range.offset, duration: range.duration } : undefined
  let [peak, , l, clips, dcOff] = await a.stat(['db', 'rms', 'loudness', 'clipping', 'dc'], statOpts)
  let dur = range?.duration ?? a.duration
  let bpmStr = await (async () => {
    let win = Math.min(8, dur)
    if (dur < 4) { let b = await a.stat('bpm', statOpts); return b > 0 ? `${Math.round(b)} BPM` : 'n/a' }
    let off = range?.offset || 0, n = Math.min(4, Math.floor(dur / win)), step = dur / (n + 1)
    let bpms = (await Promise.all(Array.from({ length: n }, (_, i) => {
      let at = Math.max(0, off + step * (i + 1) - win / 2)
      return a.stat('bpm', { at, duration: win })
    }))).filter(b => b > 0)
    if (!bpms.length) return 'n/a'
    let mn = Math.min(...bpms), mx = Math.max(...bpms)
    return mx - mn < 10 ? `${Math.round((mn + mx) / 2)} BPM` : `${Math.round(mn)}–${Math.round(mx)} BPM`
  })()
  let keyStr = await (async () => {
    // Sample a 30s window from the middle for long inputs — chroma analysis is per-frame and dominates wall time
    let win = Math.min(30, dur), off = (range?.offset || 0) + Math.max(0, (dur - win) / 2)
    let kOpts = win < dur ? { at: off, duration: win } : statOpts
    try { let k = await a.key(kOpts); return k && k.confidence > 0.3 ? k.label : 'n/a' } catch { return 'n/a' }
  })()
  console.log(`  Duration:   ${fmtTime(dur)}`)
  console.log(`  Channels:   ${a.channels}`)
  console.log(`  SampleRate: ${a.sampleRate} Hz`)
  console.log(`  Samples:    ${a.length}`)
  console.log(`  Peak:       ${peak.toFixed(1)} dBFS`)
  console.log(`  Loudness:   ${l.toFixed(1)} LUFS`)
  console.log(`  BPM:        ${bpmStr}`)
  console.log(`  Key:        ${keyStr}`)
  console.log(`  Clipping:   ${clips.length || 'none'}`)
  console.log(`  DC offset:  ${Math.abs(dcOff) > 0.0001 ? dcOff.toFixed(4) : 'none'}`)
  if (loadTime) console.log(`  Loaded in:  ${loadTime}s`)
  process.exit(0)
}

async function printStats(a, sinkArgs, names, range) {
  for (let name of names) {
    let idx = sinkArgs.indexOf(name)
    let bins = idx >= 0 && idx + 1 < sinkArgs.length && typeof sinkArgs[idx + 1] === 'number' ? sinkArgs[idx + 1] : undefined
    let statOpts = {}
    if (bins != null) statOpts.bins = bins
    if (range) { statOpts.at = range.offset; statOpts.duration = range.duration }
    let result
    if (name === 'key') {
      let k = await a.key(Object.keys(statOpts).length ? statOpts : undefined)
      result = k?.label || 'N'
    } else if (name === 'notes') {
      result = await a.notes(Object.keys(statOpts).length ? statOpts : undefined)
      for (let n of result) console.log(`  ${n.time.toFixed(3)}s  ${n.note.padEnd(4)} ${n.freq.toFixed(1)}Hz  ${n.duration.toFixed(3)}s  clarity:${n.clarity.toFixed(2)}`)
      continue
    } else if (name === 'chords') {
      result = await a.chords(Object.keys(statOpts).length ? statOpts : undefined)
      for (let c of result) console.log(`  ${c.time.toFixed(3)}s  ${c.label.padEnd(6)} ${c.duration.toFixed(3)}s  conf:${c.confidence.toFixed(2)}`)
      continue
    } else {
      result = await a.stat(name, Object.keys(statOpts).length ? statOpts : undefined)
    }
    fmtStat(name, result)
  }
  process.exit(0)
}

async function runBatch(globPattern, transforms, sink, range, opts) {
  let { readdirSync } = await import('fs')
  let { dirname, basename, extname, join } = await import('path')
  let dir = dirname(globPattern), pat = basename(globPattern)
  let re = new RegExp('^' + pat.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$')
  let files = readdirSync(dir).filter(f => re.test(f)).map(f => join(dir, f)).sort()
  if (!files.length) throw new Error(`No files matching: ${globPattern}`)

  if (sink.name !== 'save') throw new Error(`batch mode requires 'save' sink, got '${sink.name}'`)
  let pattern = sink.args.find(v => typeof v === 'string')

  for (let file of files) {
    let ext = extname(file), name = basename(file, ext)
    let outFile = pattern
      ? pattern.replace('{name}', name).replace('{ext}', ext.slice(1))
      : join(dirname(file), name + '.out' + ext)
    if (!opts.force) await confirmOverwrite(outFile)
    process.stderr.write(`Processing: ${file}\n`)
    let a = await audio(file)
    a = await applyTransforms(a, transforms)
    let saveOpts = {}
    if (range) { saveOpts.at = range.offset; saveOpts.duration = range.duration }
    if (opts.format) saveOpts.format = opts.format
    await a.save(outFile, saveOpts)
    process.stderr.write(`  → ${outFile}\n`)
  }
  process.exit(0)
}

function makeLevelBar(level, w) {
  let n = Math.max(0, Math.min(w, Math.round(level * w)))
  let red = Math.round(0.85 * w)
  let bar = ''
  for (let i = 0; i < w; i++) {
    if (i < n) bar += i >= red ? '\x1b[31m█\x1b[0m' : '\x1b[32m█\x1b[0m'
    else bar += DIM + '─' + RST
  }
  return bar
}

async function recordingUI(a, durationSec) {
  let cols = () => process.stderr.columns || 80
  let t0 = Date.now()
  let stopped = false, stop = () => { if (!stopped) { stopped = true; a.stop() } }
  let curLevel = 0
  a.on('data', () => {
    let last = a.pages[a.pages.length - 1]
    if (!last) return
    let max = 0
    for (let ch of last) for (let i = 0; i < ch.length; i++) { let v = Math.abs(ch[i]); if (v > max) max = v }
    curLevel = max
  })

  let SPIN = '⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏', sp = 0
  let render = () => {
    let elapsed = (Date.now() - t0) / 1000
    let icon = SPIN[sp++ % 10]
    let timeStr = fmtTime(elapsed, true)
    let durStr = durationSec ? ' / ' + fmtTime(durationSec, true) : ''
    let prefix = `\x1b[31m●\x1b[0m REC ${icon}  ${timeStr}${durStr}  `
    let suffix = `  ${(20 * Math.log10(curLevel + 1e-9)).toFixed(1)} dBFS`
    let w = Math.max(10, cols() - prefix.length - suffix.length - 2 + 18)  // +18 for ANSI codes
    process.stderr.write(`\r\x1b[K${prefix}${makeLevelBar(curLevel, Math.max(8, cols() - 50))}${suffix}`)
  }
  render()
  let tick = setInterval(render, 80)

  let durTimer = durationSec ? setTimeout(stop, durationSec * 1000) : null

  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true)
    process.stdin.resume()
    process.stdin.on('data', key => {
      let k = key.toString()
      if (k === ' ' || k === 'q' || k === '\r' || k === '\x03') stop()
    })
  } else {
    process.on('SIGINT', stop)
  }

  await new Promise(r => {
    let id = setInterval(() => { if (stopped) { clearInterval(id); r() } }, 50)
  })
  clearInterval(tick)
  if (durTimer) clearTimeout(durTimer)
  if (process.stdin.isTTY) {
    process.stdin.setRawMode(false)
    process.stdin.removeAllListeners('data')
    process.stdin.pause()
  }
  process.stderr.write('\r\x1b[K')
  // Drain pending mic data — push() is async via dynamic import
  await new Promise(r => setTimeout(r, 100))
}

async function runRecord(transforms, sink, range, opts) {
  let durationSec = null
  // record can take an optional duration arg as parsed from sink-walk; but sink is mandatory here
  // record [DUR] sink [...] — duration was consumed by parseArgs as transform? No — record is just source verb.
  // We rely on the user putting `record 30s save x.wav` — '30s' parses as a transform op which doesn't exist.
  // Simpler: support --duration flag, or accept first transform arg as time if it's a bare time and op is not registered.
  // Heuristic: if first transform looks like a bare time (no args, name is parseable as duration), use it.
  if (transforms.length && !audio.op(transforms[0].name) && transforms[0].name !== 'split' && transforms[0].name !== 'clip') {
    let t = parseValue(transforms[0].name)
    if (typeof t === 'number' && transforms[0].args.length === 0) {
      durationSec = t
      transforms = transforms.slice(1)
    }
  }
  if (!sink) sink = { name: 'save', args: ['recording.wav'] }
  if (sink.name === 'play') throw new Error("record: 'play' sink not supported (live monitoring is its own beast). Try: record save out.wav")

  let a = audio({ sampleRate: 44100, channels: 1 })
  process.stderr.write(`Recording — press space/q to stop${durationSec ? ` (max ${fmtTime(durationSec)})` : ''}\n`)
  a.record()
  await recordingUI(a, durationSec)

  // Wait for recording to finalize
  await a

  if (sink.name === 'save') return runSave(a, transforms, sink.args, range, opts, '(mic)', null)
  // stat
  a = await applyTransforms(a, transforms)
  let names = sink.args.filter(v => typeof v === 'string')
  if (!names.length) return printOverview(a, range, null)
  return printStats(a, sink.args, names, range)
}

// Exports for testing
export { parseValue, parseRange, parseArgs, showOpHelp, HELP, progressBar, fmtTime, isOpName, isVerb, isStatName, SOURCE_VERBS, SINK_VERBS, prompt, playerSave, defaultSavePath }

// Run CLI if invoked directly (not imported)
let argv1 = process.argv[1]
try { argv1 = (await import('fs')).realpathSync(argv1) } catch {}
if (import.meta.url === `file://${argv1}`) {
  main().catch(err => {
    console.error(`audio: ${formatError(err)}`)
    process.exit(1)
  })
}
