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
  // duration — supports compound expressions (1m30s, 2h20m, 500ms, etc.)
  let d = parseDuration(str, 's')
  if (d != null && isFinite(d)) return d
  return str  // pass as-is (e.g. filename, op name)
}

function parseRange(str) {
  let [start, end] = str.split('..')
  let s = start ? parseValue(start) : 0
  let e = end ? parseValue(end) : undefined
  let dur = e != null ? Math.max(0, e - s) : undefined
  return { offset: s, duration: dur }
}

/** Check if a string is a bare time value (e.g. "1s", "500ms", "2.5", "1:30") — not an op name. */
function isTime(s) {
  if (typeof s !== 'string') return false
  if (s.includes('..')) return true  // range
  if (/^-?[\d.]+$/.test(s)) return false  // bare number — ambiguous, don't treat as time
  if (/^(\d+):(\d{1,2})(?::(\d{1,2}))?(?:\.(\d+))?$/.test(s)) return true  // timecode
  let d = parseDuration(s, 's')
  return d != null && isFinite(d)
}

// ── Argument Parsing ─────────────────────────────────────────────────────

function isFlag(s) {
  if (s.startsWith('--')) return true
  if (!s.startsWith('-')) return false
  let match = s.match(/^-[\d.]+(db|hz|khz|s|ms)?$/i)
  return !match
}

function isOpName(s) {
  let op = audio.op(s)
  return (op && !op.hidden) || s === 'split' || s === 'stat'
}

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
  dither:    { usage: 'dither [BITS]', desc: 'TPDF dither to target bit depth (default: 16)', examples: ['dither', 'dither 8'] },
  crossfeed: { usage: 'crossfeed [FC] [LEVEL]', desc: 'Headphone crossfeed for improved imaging', examples: ['crossfeed', 'crossfeed 500hz 0.4'] },
  crossfade: { usage: 'crossfade SRC [DUR] [CURVE]', desc: 'Crossfade into another audio file', examples: ['crossfade next.wav 2s', 'crossfade next.wav 0.5s cos'] },
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

function parseArgs(args) {
  let input = null, ops_ = [], output = null, format = null
  let verbose = false, showHelp = false, play = false, force = false, loop = false
  let macro = null, helpOp = null, concatFiles = [], range = null
  let i = 0

  // First positional arg as input if it looks like a file
  if (args.length && !isFlag(args[0]) && !isOpName(args[0])) {
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
    } else if (arg === '--play' || arg === '-p') {
      play = true
      i++
    } else if (arg === '--force' || arg === '-f') {
      force = true
      i++
    } else if (arg === '--loop' || arg === '-l') {
      loop = true
      i++
    } else if (arg === '--macro') {
      macro = args[++i]
      i++
    } else if (arg === '+') {
      // Concat: `audio a.mp3 + b.wav + c.mp3 ...`
      i++
      if (i < args.length && !isFlag(args[i]) && !isOpName(args[i])) {
        concatFiles.push(args[i])
        i++
      } else {
        throw new Error('Expected file after +')
      }
    } else if (isFlag(arg)) {
      throw new Error(`Unknown flag: ${arg}`)
    } else if (typeof arg === 'string' && arg.includes('..') && !isOpName(arg)) {
      // Bare range: `audio song.mp3 10s..20s -p`
      range = parseRange(arg)
      i++
    } else if (input && !isOpName(arg) && isTime(arg)) {
      // Bare time: `audio song.mp3 1s -p` = start at 1s
      range = { offset: parseValue(arg), duration: undefined }
      i++
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
      // For stat op, stat names (bpm, dc, etc.) are args, not op boundaries
      while (i < args.length && !isFlag(args[i])) {
        if (isOpName(args[i]) && !(name === 'stat' && audio.stat(args[i]))) break
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

      // Per-op help: `gain --help`
      if (opArgs.length === 0 && i < args.length && (args[i] === '--help' || args[i] === '-h')) {
        helpOp = name; i++; continue
      }

      ops_.push({ name, args: opArgs, offset, duration })
    }
  }

  // Expand fade shorthand: bare `fade` or `fade IN -OUT` → two fade ops
  let expanded = []
  for (let op of ops_) {
    if (op.name === 'fade') {
      let nums = op.args.filter(a => typeof a === 'number')
      let curve = op.args.find(a => typeof a === 'string')

      if (nums.length === 0) {
        // bare `fade` → 0.5s in + 0.5s out
        expanded.push({ name: 'fade', args: [0.5], curve, offset: null, duration: null })
        expanded.push({ name: 'fade', args: [-0.5], curve, offset: null, duration: null })
      } else if (nums.length === 1 && nums[0] > 0) {
        // `fade 0.3` → both at 0.3s
        expanded.push({ name: 'fade', args: [nums[0]], curve, offset: null, duration: null })
        expanded.push({ name: 'fade', args: [-nums[0]], curve, offset: null, duration: null })
      } else if (nums.length === 2 && nums[0] > 0 && nums[1] < 0) {
        // `fade 0.2 -1` → in 0.2s, out 1s
        expanded.push({ name: 'fade', args: [nums[0]], curve, offset: null, duration: null })
        expanded.push({ name: 'fade', args: [nums[1]], curve, offset: null, duration: null })
      } else {
        expanded.push(op)
      }
    } else {
      expanded.push(op)
    }
  }
  ops_ = expanded

  return { input, ops: ops_, output, format, verbose, showHelp, play, force, loop, macro, helpOp, concatFiles, range }
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

const GERUNDS = { gain: 'Applying gain', fade: 'Fading', trim: 'Trimming', normalize: 'Normalizing', crop: 'Cropping', clip: 'Clipping', remove: 'Removing', reverse: 'Reversing', repeat: 'Repeating', pad: 'Padding', speed: 'Changing speed', stretch: 'Stretching', pitch: 'Pitch shifting', insert: 'Inserting', mix: 'Mixing', crossfade: 'Crossfading', remix: 'Remixing', pan: 'Panning', eq: 'Filtering', filter: 'Filtering', highpass: 'Filtering', lowpass: 'Filtering', notch: 'Filtering', bandpass: 'Filtering', lowshelf: 'Filtering', highshelf: 'Filtering', allpass: 'Filtering', vocals: 'Processing vocals', dither: 'Dithering', crossfeed: 'Applying crossfeed' }
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

  let render = t => {
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

  let out = '\r\x1b[K'
  for (let i = 1; i < nLines; i++) out += '\n\x1b[K'
  if (nLines > 1) out += `\x1b[${nLines - 1}A`
  process.stderr.write(out)
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
    let ops = Object.keys(HELP).concat('split', 'stat')
    let flags = ['--play', '--force', '--verbose', '--format', '--macro', '--help', '--version', '-o', '-p', '-f']

    // Context-aware completions
    let out = []
    if (prev === '-o' || prev === '--output') {
      // Need filename — return empty, shell falls back to file completion
      process.exit(0)
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
    } else if (prev === 'stat') {
      out = ['db', 'rms', 'loudness', 'clipping', 'dc', 'silence', 'spectrum', 'cepstrum', 'bpm', 'beats', 'onsets', 'key', 'notes', 'chords']
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

    // Load macro edits
    let macroOps = []
    if (opts.macro) {
      let { readFileSync } = await import('fs')
      let raw = JSON.parse(readFileSync(opts.macro, 'utf-8'))
      let edits = Array.isArray(raw) ? raw : raw.edits || raw.ops
      if (!Array.isArray(edits)) throw new Error('Macro file must contain an array of edits')
      macroOps = edits.map(e => {
        // Support both array edits ['gain', opts] and object edits { type: 'gain', args: [-6] }
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
    let allOps = [...opts.ops, ...macroOps]

    // Validate ops early — before any decode
    for (let op of allOps) {
      if (op.name !== 'split' && op.name !== 'stat' && !audio.op(op.name))
        throw new Error(`Unknown operation: ${op.name}`)
    }

    // Resolve input(s) — support glob for batch processing
    let inputs = []
    if (opts.input) {
      if (opts.input.includes('*') || opts.input.includes('?')) {
        let { readdirSync } = await import('fs')
        let { dirname, basename, join } = await import('path')
        let dir = dirname(opts.input), pat = basename(opts.input)
        let re = new RegExp('^' + pat.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$')
        inputs = readdirSync(dir).filter(f => re.test(f)).map(f => join(dir, f)).sort()
        if (!inputs.length) throw new Error(`No files matching: ${opts.input}`)
      } else {
        inputs.push(opts.input)
      }
    }

    // Batch mode: multiple inputs
    if (inputs.length > 1) {
      let { basename, extname, dirname, join } = await import('path')
      let { existsSync } = await import('fs')
      for (let file of inputs) {
        let ext = extname(file), name = basename(file, ext)
        let outFile = opts.output
          ? opts.output.replace('{name}', name).replace('{ext}', ext.slice(1))
          : join(dirname(file), name + '.out' + ext)
        if (!opts.force && existsSync(outFile)) {
          process.stderr.write(`audio: ${outFile} already exists (use --force to overwrite)\n`)
          process.exit(1)
        }
        process.stderr.write(`Processing: ${file}\n`)
        let a = await audio(file)
        for (let op of allOps) {
          await resolveSourceArgs(op)
          let fullArgs = opCallArgs(op)
          if (typeof a[op.name] !== 'function') throw new Error(`Unknown operation: ${op.name}`)
          a[op.name](...fullArgs)
        }
        await a.save(outFile)
        process.stderr.write(`  → ${outFile}\n`)
      }
      process.exit(0)
    }

    // Determine input source
    let source
    if (inputs.length) {
      source = inputs[0]
    } else {
      process.stderr.write('Reading from stdin...\n')
      let buf = await getStdinBuffer()
      source = buf
    }

    // Concat mode: `audio a.mp3 + b.wav + c.mp3`
    if (opts.concatFiles.length && typeof source === 'string') {
      source = [source, ...opts.concatFiles]
    }

    // Streaming player — file source, no ops, no output (default mode)
    // -p = autoplay, otherwise starts paused
    // Bare range: `audio song.mp3 10s..20s` scopes playback (seek + stop), not clip
    if (!allOps.length && !opts.output && typeof source === 'string') {
      if (opts.verbose) console.error(`Opening: ${source}`)
      let a = audio(source)
      await new Promise(r => a.on('metadata', r))
      let playOpts = { paused: !opts.play, loop: opts.loop }
      if (opts.range) { playOpts.at = opts.range.offset; playOpts.duration = opts.range.duration }
      let p = a.play(playOpts)
      await playback(p,
        () => a.decoded ? a.duration : a._.estDur || 0,
        () => a.pages.length * audio.PAGE_SIZE / a.sampleRate,
        a, source, {}
      )
      process.exit(0)
    }

    // Check if all ops are process-only (can stream during decode)
    let canStream = allOps.length > 0 && !opts.output
    if (canStream) for (let op of allOps) {
      if (op.name === 'stat' || op.name === 'split') { canStream = false; break }
      let desc = audio.op(op.name)
      if (!desc || desc.plan || (desc.resolve && !desc.streamable)) { canStream = false; break }
    }

    // Streaming player with process ops — show player immediately, start playback during decode
    if (canStream && typeof source === 'string') {
      if (opts.verbose) console.error(`Opening: ${source}`)
      let a = audio(source)
      await new Promise(r => a.on('metadata', r))
      // Apply ops (just pushes edits — sync, no computation)
      for (let op of allOps) {
        let { name } = op
        let fullArgs = opCallArgs(op)
        if (name === 'clip') a = a[name](...fullArgs)
        else a[name](...fullArgs)
      }
      let playOpts = { paused: !opts.play, loop: opts.loop }
      if (opts.range) { playOpts.at = opts.range.offset; playOpts.duration = opts.range.duration }
      let p = a.play(playOpts)
      await playback(p,
        () => a.decoded ? a.duration : a._.estDur || 0,
        () => a.pages.length * audio.PAGE_SIZE / a.sampleRate,
        a, source, { hasEdits: true, editLabel: opsLabel(allOps).join(', ').toLowerCase() }
      )
      process.exit(0)
    }

    // Separate stat ops from transform ops
    let statOps = allOps.filter(op => op.name === 'stat')
    let transformOps = allOps.filter(op => op.name !== 'stat')

    // Full-decode playback: show player immediately, decode + apply ops in background
    // Only when: play-only (no save), no stat, no clip (clip creates new instance), file source
    let wantsPlay = !opts.output && (opts.play || transformOps.length)
    let hasClip = transformOps.some(o => o.name === 'clip')
    if (wantsPlay && !statOps.length && !hasClip && typeof source === 'string') {
      let a = audio(source)
      await new Promise(r => a.on('metadata', r))
      let playOpts = { paused: true, loop: opts.loop }
      if (opts.range) { playOpts.at = opts.range.offset; playOpts.duration = opts.range.duration }
      let p = a.play(playOpts)
      // Decode + apply ops in background, then resume
      ;(async () => {
        await a  // full decode
        for (let op of transformOps) {
          await resolveSourceArgs(op)
          let { name } = op
          let fullArgs = opCallArgs(op)
          if (name === 'clip') a = a[name](...fullArgs)
          else a[name](...fullArgs)
        }
        if (opts.play) p.resume()
      })()
      await playback(p,
        () => a.decoded ? a.duration : a._.estDur || 0,
        () => a.pages.length * audio.PAGE_SIZE / a.sampleRate,
        a, source, { hasEdits: !!transformOps.length, editLabel: opsLabel(transformOps).join(', ').toLowerCase() }
      )
      process.exit(0)
    }

    // Load audio (full decode) — needed for stat, save, non-play paths
    if (opts.verbose) console.error(`Loading: ${typeof source === 'string' ? source : '(stdin)'}`)
    let spin = !opts.verbose ? spinnerBar('Decoding') : null
    let a = audio(source)
    if (spin) a.on('data', ({ offset }) => { if (a._.estDur) spin.progress(offset / a._.estDur, offset) })
    if (opts.verbose) a.on('data', ({ offset }) => process.stderr.write(`\rDecoding... ${fmtTime(offset)}`))
    await a
    let loadTime = spin?.stop()
    if (opts.verbose) console.error('\n')

    // No ops, no output, no play → show info and exit
    if (!allOps.length && !opts.output && !opts.play) {
      let [peak, , l, clips, dcOff] = await a.stat(['db', 'rms', 'loudness', 'clipping', 'dc'])
      let bpmStr = await (async () => {
        let dur = a.duration, win = Math.min(8, dur)
        if (dur < 4) { let b = await a.stat('bpm'); return b > 0 ? `${Math.round(b)} BPM` : 'n/a' }
        let n = Math.min(4, Math.floor(dur / win)), step = dur / (n + 1)
        let bpms = (await Promise.all(Array.from({ length: n }, (_, i) => {
          let at = Math.max(0, step * (i + 1) - win / 2)
          return a.stat('bpm', { at, duration: win })
        }))).filter(b => b > 0)
        if (!bpms.length) return 'n/a'
        let mn = Math.min(...bpms), mx = Math.max(...bpms)
        return mx - mn < 10 ? `${Math.round((mn + mx) / 2)} BPM` : `${Math.round(mn)}–${Math.round(mx)} BPM`
      })()
      let keyStr = await (async () => {
        try {
          let k = await a.key()
          return k && k.confidence > 0.3 ? k.label : 'n/a'
        } catch { return 'n/a' }
      })()
      console.log(`  Duration:   ${fmtTime(a.duration)}`)
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

    // Split — special handling for multi-output
    let splitOp = allOps.find(op => op.name === 'split')
    if (splitOp) {
      let preOps = allOps.slice(0, allOps.indexOf(splitOp))
      let postOps = allOps.slice(allOps.indexOf(splitOp) + 1)
      for (let op of preOps) {
        let fullArgs = opCallArgs(op)
        a[op.name](...fullArgs)
      }

      let parts = a.split(...splitOp.args)
      for (let op of postOps)
        for (let part of parts) {
          let fullArgs = opCallArgs(op)
          part[op.name](...fullArgs)
        }

      let { basename, extname } = await import('path')
      let output = opts.output || `split-{i}.wav`
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

    // Apply transform operations
    if (transformOps.length) {
      if (opts.verbose) console.error(`Applying ${transformOps.length} operation(s)...`)
      for (let op of transformOps) {
        await resolveSourceArgs(op)
        let { name } = op
        let fullArgs = opCallArgs(op)
        // clip returns a new audio instance, so we gotta update `a`
        if (name === 'clip') {
          if (typeof a[name] !== 'function') throw new Error(`Unknown operation: ${name}`)
          a = a[name](...fullArgs)
        } else {
          if (typeof a[name] !== 'function') throw new Error(`Unknown operation: ${name}`)
          try { a[name](...fullArgs) }
          catch (e) { throw new Error(`${name}: ${formatError(e)}`) }
        }
      }
    }

    // Execute stat queries
    if (statOps.length) {
      for (let op of statOps) {
        let names = op.args.filter(a => typeof a === 'string')
        if (!names.length) names = ['db', 'rms', 'loudness', 'clipping', 'dc']
        for (let name of names) {
          let idx = op.args.indexOf(name)
          let bins = idx >= 0 && idx + 1 < op.args.length && typeof op.args[idx + 1] === 'number' ? op.args[idx + 1] : undefined
          let statOpts = {}
          if (bins != null) statOpts.bins = bins
          if (op.offset != null) statOpts.at = op.offset
          if (op.duration != null) statOpts.duration = op.duration
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
      }
      if (!transformOps.length && !opts.output && !opts.play) process.exit(0)
    }

    // Play the result: -p flag, or ops without -o (default to player)
    if (opts.play || (transformOps.length && !opts.output)) {
      let playOpts = { loop: opts.loop }
      if (opts.range) { playOpts.at = opts.range.offset; playOpts.duration = opts.range.duration }
      await playback(a.play(playOpts), () => a.duration, () => a.duration, a, typeof source === 'string' ? source : null, { hasEdits: !!transformOps.length, editLabel: opsLabel(transformOps).join(', ').toLowerCase() })
      if (!opts.output) process.exit(0)
    }

    // Save output
    if (opts.output) {
      let output = opts.output || 'out.wav'

      // Check for overwrite
      if (!opts.force && output !== '-') {
        let { existsSync } = await import('fs')
        if (existsSync(output)) {
          process.stderr.write(`audio: ${output} already exists (use --force to overwrite)\n`)
          process.exit(1)
        }
      }

      let fmt = opts.format || (typeof output === 'string' ? output.split('.').pop() : 'wav')

      try {
        // Saving a static file requires full decode to apply uniform global edits (e.g. normalize)
        if (!a.decoded) {
          let spin2 = !opts.verbose ? spinnerBar('Decoding') : null
          if (spin2 && a._.estDur) a.on('data', ({ offset }) => spin2.progress(offset / a._.estDur, offset))
          await a.ready
          spin2?.stop()
        }

        if (output === '-') {
          let bytes = await a.read({ format: fmt })
          process.stdout.write(Buffer.from(bytes))
        } else {
          let lbl = 'Saving'
          if (allOps.length) {
            let names = opsLabel(allOps)
            lbl = names.length === 1 ? `${names[0]} + saving` : 'Applying edits + saving'
          }
          let spin = !opts.verbose ? spinnerBar(lbl) : null
          await new Promise(r => setTimeout(r, 100))  // let spinner render before blocking render()
          if (spin) a.on('progress', ({ offset, total }) => spin.progress(offset / total, offset))
          await a.save(output, { format: fmt })
          let elapsed = spin?.stop()
          if (opts.verbose) console.error(`Saved: ${output}`)
          else if (elapsed) console.error(`Saved ${output} in ${elapsed}s`)
        }
      } catch (e) { throw new Error(`save ${output}: ${formatError(e)}`) }
    }
  } catch (err) {
    console.error(`audio: ${formatError(err)}`)
    process.exit(1)
  }
}

const FILTERS = new Set(['highpass', 'lowpass', 'eq', 'lowshelf', 'highshelf', 'notch', 'bandpass', 'allpass', 'filter'])

function showUsage() {
  let ops = [], filters = [], seen = new Set()
  for (let [name, desc] of Object.entries(audio.op())) {
    let h = desc.help
    if (!h || desc.hidden) continue
    seen.add(name)
    let line = `  ${h.usage.padEnd(28)} ${h.desc}`
    ;(FILTERS.has(name) ? filters : ops).push(line)
  }
  // Include HELP entries for methods not registered as ops (e.g. clip)
  for (let [name, h] of Object.entries(HELP)) {
    if (seen.has(name)) continue
    let line = `  ${h.usage.padEnd(28)} ${h.desc}`
    ;(FILTERS.has(name) ? filters : ops).push(line)
  }
  console.log(`
audio ${audio.version} — load, edit, save, play, analyze

Usage:
  audio [input] [range] [ops...] [-o output] [options]

Input:
  input         File path, URL, or omit for stdin
  range         Bare range scopes playback: audio song.mp3 10s..20s
  -o, --output  Output file or '-' for stdout (default: out.wav)

Operations (positional):
${ops.join('\n')}

Filters (ORDER = steepness: 2 = -12dB/oct, 4 = -24dB/oct, default: 2):
${filters.join('\n')}

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
  --play, -p    Autoplay (default opens player paused)
  --loop, -l    Loop playback (or loop within range)
  --force, -f   Overwrite output file if it exists
  --macro FILE  Apply edits from JSON file
  --verbose     Show progress and debug info
  --format FMT  Override output format (default: from extension)
  --help, -h    Show this help (or after an op: audio gain --help)
  --version, -v Show version
  --completions SHELL  Print tab-completion script (zsh, bash, fish)

Batch:
  audio '*.wav' gain -3db -o '{name}.out.{ext}'  Process multiple files

Examples:
  audio in.mp3                              Open player
  audio in.mp3 -p                           Autoplay
  audio in.mp3 10s..20s                     Play range
  audio in.mp3 10s..20s fade 1s 1s -p       Play range with effects
  audio in.mp3 stat                         Show file stats
  audio in.mp3 stat loudness rms            Specific stats
  audio in.mp3 gain -3db trim -o out.wav    Edit and save
  audio in.mp3 normalize streaming -o out.wav
  audio in.mp3 highpass 80hz eq 300hz -2db lowshelf 200hz -3db -o out.wav
  audio in.mp3 gain -3db -p -o out.wav      Edit, play, and save
  cat in.wav | audio gain -3db > out.wav    Pipe mode

Player controls:
  space     Pause / resume
  ←/→       Seek ±10s
  ⇧←/⇧→    Seek ±60s
  ↑/↓       Volume ±10%
  l         Toggle loop
  q         Quit

For more info: https://github.com/audiojs/audio
`)
}

// Exports for testing
export { parseValue, parseRange, parseArgs, showOpHelp, HELP, progressBar, fmtTime }

// Run CLI if invoked directly (not imported)
let argv1 = process.argv[1]
try { argv1 = (await import('fs')).realpathSync(argv1) } catch {}
if (import.meta.url === `file://${argv1}`) {
  main().catch(err => {
    console.error(`audio: ${formatError(err)}`)
    process.exit(1)
  })
}
