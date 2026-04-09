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
import { melSpectrum, toMel, fromMel } from '../fn/spectrum.js'
import parseDuration from 'parse-duration'

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
  return audio.op(s) || s === 'split' || s === 'stat'
}

// ── Per-op Help ──────────────────────────────────────────────────────────

const HELP = {
  gain:      { usage: 'gain DB [RANGE]', desc: 'Amplify in dB', examples: ['gain -3db', 'gain 6 1s..5s'] },
  fade:      { usage: 'fade [IN] [-OUT] [CURVE]', desc: 'Fade in/out (bare = 0.5s both)', examples: ['fade', 'fade 1s', 'fade .2s -1s cos'] },
  trim:      { usage: 'trim [THR]', desc: 'Auto-trim silence (threshold in dB)', examples: ['trim', 'trim -40'] },
  normalize: { usage: 'normalize [DB] [MODE]', desc: 'Normalize peak/loudness', examples: ['normalize', 'normalize -3', 'normalize streaming'] },
  crop:      { usage: 'crop OFF DUR', desc: 'Crop to time range', examples: ['crop 1s..10s', 'crop 0 5s'] },
  remove:    { usage: 'remove OFF DUR', desc: 'Delete time range', examples: ['remove 2s..4s'] },
  reverse:   { usage: 'reverse [RANGE]', desc: 'Reverse audio', examples: ['reverse', 'reverse 1s..5s'] },
  repeat:    { usage: 'repeat N', desc: 'Repeat N times', examples: ['repeat 3'] },
  pad:       { usage: 'pad [BEFORE] [AFTER]', desc: 'Add silence to start/end (single arg = both)', examples: ['pad 1s', 'pad 0.5s 2s'] },
  speed:     { usage: 'speed RATE', desc: 'Change speed — 2 = double, 0.5 = half, -1 = reverse', examples: ['speed 2', 'speed 0.5', 'speed -1'] },
  insert:    { usage: 'insert SRC [OFF]', desc: 'Insert audio at position', examples: ['insert other.wav 3s'] },
  mix:       { usage: 'mix SRC [OFF]', desc: 'Mix in another audio file', examples: ['mix bg.wav 0s'] },
  remix:     { usage: 'remix CH', desc: 'Change channel count', examples: ['remix 1', 'remix 2'] },
  pan:       { usage: 'pan VALUE [RANGE]', desc: 'Stereo balance: -1 left, 0 center, 1 right', examples: ['pan -0.5', 'pan 1 2s..5s'] },
  filter:    { usage: 'filter TYPE ...ARGS', desc: 'Generic filter dispatch', examples: ['filter highpass 80hz'] },
  highpass:  { usage: 'highpass FC [ORDER]', desc: 'High-pass filter', examples: ['highpass 80hz', 'highpass 120hz 4'] },
  lowpass:   { usage: 'lowpass FC [ORDER]', desc: 'Low-pass filter', examples: ['lowpass 8khz', 'lowpass 4khz 4'] },
  eq:        { usage: 'eq FC GAIN [Q]', desc: 'Parametric EQ', examples: ['eq 1khz -3db', 'eq 300hz 2 0.5'] },
  lowshelf:  { usage: 'lowshelf FC GAIN [Q]', desc: 'Low shelf filter', examples: ['lowshelf 200hz -3db'] },
  highshelf: { usage: 'highshelf FC GAIN [Q]', desc: 'High shelf filter', examples: ['highshelf 8khz 2db'] },
  notch:     { usage: 'notch FC [Q]', desc: 'Notch (band-reject) filter', examples: ['notch 60hz', 'notch 50hz 50'] },
  bandpass:  { usage: 'bandpass FC [Q]', desc: 'Band-pass filter', examples: ['bandpass 1khz', 'bandpass 440hz 10'] },
}

function showOpHelp(name) {
  let h = HELP[name]
  if (!h) { console.error(`No help for: ${name}`); return }
  console.log(`\n  ${h.usage}\n\n  ${h.desc}\n`)
  if (h.examples.length) console.log('  Examples:')
  for (let ex of h.examples) console.log(`    audio in.wav ${ex} -o out.wav`)
  console.log()
}

function parseArgs(args) {
  let input = null, ops_ = [], output = null, format = null
  let verbose = false, showHelp = false, play = false, force = false
  let macro = null, helpOp = null, info = false
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
    } else if (arg === '-i' || arg === '--info') {
      info = true
      i++
    } else if (arg === '--play' || arg === '-p') {
      play = true
      i++
    } else if (arg === '--force' || arg === '-f') {
      force = true
      i++
    } else if (arg === '--macro') {
      macro = args[++i]
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

  return { input, ops: ops_, output, format, verbose, showHelp, play, force, macro, helpOp, info }
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

function spinner(lbl) {
  let i = 0, info = '', t0 = Date.now(), spin = '⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏'
  let id = setInterval(() => process.stderr.write(`\r\x1b[K${spin[i++ % 10]} ${lbl}${info}`), 80)
  return {
    label(l) { lbl = l },
    set(s) { info = s },
    stop() { clearInterval(id); process.stderr.write('\r\x1b[K'); return ((Date.now() - t0) / 1000).toFixed(1) }
  }
}

const DIM = '\x1b[2m', RST = '\x1b[0m'

function progressBar(played, decoded, total, width) {
  let ref = total > 0 ? total : decoded > 0 ? decoded : 1
  let pFill = Math.round(played / ref * width)
  let dFill = Math.round(decoded / ref * width)
  pFill = Math.max(0, Math.min(width, pFill))
  dFill = Math.max(pFill, Math.min(width, dFill))
  let empty = width - dFill
  return '━'.repeat(pFill) + '─'.repeat(dFill - pFill) + ' '.repeat(empty)
}

async function playback(p, totalSec, decodedSec, a, src) {
  let fft
  try { fft = (await import('fourier-transform')).default } catch {}

  let cols = () => process.stderr.columns || 80
  let nLines = 1
  const SPIN = '⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏'
  let spinIdx = 0

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

  // FFT spectrum state
  const N = 1024, SBARS = ' ▁▂▃▄▅▆▇█'
  let prev = null

  // Auto-scaling: track running peak dB for spectrum
  let specMax = -60

  let spec = (block, sr, w, paused) => {
    if (!fft) return ' '.repeat(w)
    let fMin = 30, fMax = Math.min(sr / 2, 20000)
    if (block && block.length >= N) {
      let mag = melSpectrum(block.subarray(0, N), sr, { bins: w, fMin, fMax })
      if (!prev || prev.length !== w) prev = new Float32Array(w)
      for (let b = 0; b < w; b++) prev[b] = paused ? mag[b] : Math.max(mag[b], prev[b] * 0.85)
    } else if (prev && !paused) {
      for (let b = 0; b < prev.length; b++) prev[b] *= 0.85
    }
    if (!prev) return ' '.repeat(w)
    // Auto-scale: find current max dB, decay peak slowly
    let curMax = -100
    let specDb = new Float32Array(w)
    for (let b = 0; b < w; b++) {
      specDb[b] = 20 * Math.log10(prev[b] + 1e-10)
      if (specDb[b] > curMax) curMax = specDb[b]
    }
    specMax = Math.max(curMax, specMax - 0.3)
    let floor = specMax - 48  // 48dB dynamic range, 6dB per level
    let out = ''
    for (let b = 0; b < w; b++) {
      let level = Math.round((specDb[b] - floor) / 6)
      out += SBARS[Math.max(0, Math.min(8, level))]
    }
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
  let volBar = db => {
    let n = Math.round((db + 12) / 3) + 1
    n = Math.max(1, Math.min(7, n))
    return VOL.slice(0, n) + '_'.repeat(7 - n)
  }

  // File info (computed eagerly after decode, refreshed after ops)
  let fileInfo = null, msg = '', msgTimer = null
  let flash = m => { msg = m; clearTimeout(msgTimer); msgTimer = setTimeout(() => { msg = ''; render(p.currentTime) }, 1500) }
  let fmtRate = sr => { let k = sr / 1000; return (k % 1 ? k.toFixed(1) : k) + 'k' }
  let refreshInfo = async () => {
    if (!a?.decoded) return
    try {
      let [peak, , l, clips, dcOff] = await a.stat(['db', 'rms', 'loudness', 'clip', 'dc'])
      let warn = ''
      if (clips.length) warn += `   clip:${clips.length}`
      if (Math.abs(dcOff) > 0.001) warn += `   dc:${dcOff.toFixed(4)}`
      fileInfo = `${fmtRate(a.sampleRate)}   ${a.channels}ch   ${fmtTime(a.duration)}   ${peak.toFixed(1)}dBFS   ${l.toFixed(1)}LUFS${warn}`
    } catch { fileInfo = '(info unavailable)' }
    render(p.currentTime)
  }
  ;(async () => {
    if (!a) return
    if (!a.decoded) await new Promise(r => { let id = setInterval(() => { if (a.decoded) { clearInterval(id); r() } }, 200) })
    await refreshInfo()
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
    let pad = barStart + tt.length + vb.length + 5  // +1 loop +1 space
    let barW = Math.max(10, w - pad)
    let bar = progressBar(t, ds, ts, barW)

    // Cursor at playback position in progress bar
    let ref = ts > 0 ? ts : ds > 0 ? ds : 1
    let pFill = Math.round(Math.min(t / ref, 1) * barW)
    let cursorCol = barStart + pFill

    let out = `\r\x1b[K${icon} ${ct} ${bar} ${tt} ${loop} ${vb}`
    let newLines = 1

    if (fft) {
      let sw = Math.min(barW, Math.max(4, w - barStart - 2))
      let sr = p.sampleRate || 44100
      let s = spec(getBlock(), sr, sw, p.paused)
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
      let peakDb = peakMax > 1e-10 ? (20 * Math.log10(peakMax)).toFixed(1) + ' dBFS' : ''
      decoding = `   ${peakDb ? peakDb + '   ' : ''}${SPIN[spinIdx++ % 10]} decoding`
    }
    let infoStr = msg || (fileInfo ? fileInfo + decoding : (a ? `${fmtRate(a.sampleRate)}   ${a.channels}ch${decoding}` : ''))
    out += '\n\x1b[K'; newLines++
    if (infoStr) { out += `\n\x1b[K${lpad}${DIM}${infoStr}${RST}`; newLines++ }

    for (let i = newLines; i < nLines; i++) out += '\n\x1b[K'
    let up = Math.max(newLines, nLines) - 1
    if (up > 0) out += `\x1b[${up}A`
    out += `\x1b[${cursorCol + 1}G`

    nLines = newLines
    process.stderr.write(out)
  }

  let getBlock = () => {
    if (p.block) return p.block
    if (a?.pages?.[0]?.[0]) return a.pages[0][0].subarray(0, Math.min(1024, a.pages[0][0].length))
    return null
  }

  render(0)
  let tick = setInterval(() => render(p.currentTime), 40)

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
      else if (k === '\x1b[A') { p.volume = Math.min(p.volume + 3, 6); render(p.currentTime) }
      else if (k === '\x1b[B') { p.volume = Math.max(p.volume - 3, -12); render(p.currentTime) }
      else if (k === 'l') { p.loop = !p.loop; render(p.currentTime) }
      else if (k === 'q' || k === '\x03') p.stop()
    })
  }

  await new Promise(r => { p.on('ended', r) })
  clearInterval(tick)

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
    let flags = ['--play', '--info', '--force', '--verbose', '--format', '--macro', '--help', '--version', '-o', '-p', '-i', '-f']

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
    } else if (prev === 'remix') {
      out = ['1', '2']
    } else if (prev === 'stat') {
      out = ['db', 'rms', 'loudness', 'clip', 'dc', 'silence', 'spectrum', 'cepstrum']
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
      macroOps = edits.map(e => ({ name: e.type || e.name, args: e.args || [], offset: e.at ?? null, duration: e.duration ?? null }))
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
          let fullArgs = op.args.slice()
          let rangeOpts = {}
          if (op.offset != null) rangeOpts.at = op.offset
          if (op.duration != null) rangeOpts.duration = op.duration
          if (op.curve) rangeOpts.curve = op.curve
          if (Object.keys(rangeOpts).length) fullArgs.push(rangeOpts)
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

    // Streaming player — file source, no ops, no output (default mode)
    // -p = autoplay, otherwise starts paused
    if (!allOps.length && !opts.output && !opts.info && typeof source === 'string') {
      if (opts.verbose) console.error(`Opening: ${source}`)
      let spin = !opts.verbose ? spinner('decoding') : null
      let a = audio(source)
      await new Promise(r => a.on('metadata', r))
      spin?.stop()
      let p = a.play()
      if (!opts.play) a.pause()
      await playback(p,
        () => a.decoded ? a.duration : 0,
        () => a.pages.length * audio.PAGE_SIZE / a.sampleRate,
        a, source
      )
      process.exit(0)
    }

    // Load audio (full decode)
    if (opts.verbose) console.error(`Loading: ${typeof source === 'string' ? source : '(stdin)'}`)
    let spin = !opts.verbose ? spinner('decoding') : null
    let a = audio(source)
    if (opts.verbose) a.on('data', ({ offset }) => process.stderr.write(`\rDecoding... ${fmtTime(offset)}`))
    await a
    let loadTime = spin?.stop()
    if (opts.verbose) console.error('\n')

    // Show info: -i flag, or stdin with no ops/output
    if (opts.info || (!allOps.length && !opts.output && !opts.play)) {
      let [peak, , l, clips, dcOff] = await a.stat(['db', 'rms', 'loudness', 'clip', 'dc'])
      console.log(`  Duration:   ${fmtTime(a.duration)}`)
      console.log(`  Channels:   ${a.channels}`)
      console.log(`  SampleRate: ${a.sampleRate} Hz`)
      console.log(`  Samples:    ${a.length}`)
      console.log(`  Peak:       ${peak.toFixed(1)} dBFS`)
      console.log(`  Loudness:   ${l.toFixed(1)} LUFS`)
      console.log(`  Clipping:   ${clips.length || 'none'}`)
      console.log(`  DC offset:  ${Math.abs(dcOff) > 0.0001 ? dcOff.toFixed(4) : 'none'}`)
      if (loadTime) console.log(`  Loaded in:  ${loadTime}s`)
      if (!allOps.length && !opts.output) process.exit(0)
    }

    // Split — special handling for multi-output
    let splitOp = allOps.find(op => op.name === 'split')
    if (splitOp) {
      let preOps = allOps.slice(0, allOps.indexOf(splitOp))
      let postOps = allOps.slice(allOps.indexOf(splitOp) + 1)
      for (let op of preOps) {
        let fullArgs = op.args.slice()
        let rangeOpts = {}
        if (op.offset != null) rangeOpts.at = op.offset
        if (op.duration != null) rangeOpts.duration = op.duration
        if (op.curve) rangeOpts.curve = op.curve
        if (Object.keys(rangeOpts).length) fullArgs.push(rangeOpts)
        a[op.name](...fullArgs)
      }

      let parts = a.split(...splitOp.args)
      for (let op of postOps)
        for (let part of parts) {
          let fullArgs = op.args.slice()
          let rangeOpts = {}
          if (op.offset != null) rangeOpts.at = op.offset
          if (op.duration != null) rangeOpts.duration = op.duration
          if (op.curve) rangeOpts.curve = op.curve
          if (Object.keys(rangeOpts).length) fullArgs.push(rangeOpts)
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

    // Apply operations
    if (allOps.length) {
      if (opts.verbose) console.error(`Applying ${allOps.length} operation(s)...`)
      for (let op of allOps) {
        let { name, args, offset, duration, curve } = op
        let fullArgs = args.slice()
        let rangeOpts = {}
        if (offset != null) rangeOpts.at = offset
        if (duration != null) rangeOpts.duration = duration
        if (curve) rangeOpts.curve = curve
        if (Object.keys(rangeOpts).length) fullArgs.push(rangeOpts)
        if (typeof a[name] !== 'function') throw new Error(`Unknown operation: ${name}`)
        try { a[name](...fullArgs) }
        catch (e) { throw new Error(`${name}: ${formatError(e)}`) }
      }
    }

    // Play the result: -p flag, or ops without -o (default to player)
    if (opts.play || (allOps.length && !opts.output)) {
      await playback(a.play(), () => a.duration, () => a.duration, a, typeof source === 'string' ? source : null)
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
        if (output === '-') {
          let bytes = await a.read({ format: fmt })
          process.stdout.write(Buffer.from(bytes))
        } else {
          let spin = !opts.verbose ? spinner(allOps.length ? 'Processing' : 'Saving') : null
          await new Promise(r => setTimeout(r, 100))  // let spinner render before blocking render()
          if (spin) a.on('progress', ({ offset, total }) => spin.set(' ' + Math.round(offset / total * 100) + '%'))
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

const FILTERS = new Set(['highpass', 'lowpass', 'eq', 'lowshelf', 'highshelf', 'notch', 'bandpass', 'filter'])

function showUsage() {
  let ops = [], filters = []
  for (let [name, h] of Object.entries(HELP)) {
    let line = `  ${h.usage.padEnd(28)} ${h.desc}`
    ;(FILTERS.has(name) ? filters : ops).push(line)
  }
  console.log(`
audio ${audio.version} — load, edit, save, play, analyze

Usage:
  audio [input] [ops...] [-o output] [options]

Input:
  input         File path, URL, or omit for stdin
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
  --info, -i    Show file information (duration, peak, loudness, etc.)
  --play, -p    Autoplay (default opens player paused)
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
  audio in.mp3 -i                           Show file info
  audio in.mp3 gain -3db trim -o out.wav    Edit and save
  audio in.mp3 normalize streaming -o out.wav
  audio in.mp3 highpass 80hz eq 300hz -2db lowshelf 200hz -3db -o out.wav
  audio in.mp3 gain -3db -p -o out.wav      Edit, play, and save
  cat in.wav | audio gain -3db > out.wav    Pipe mode

Player controls:
  space     Pause / resume
  ←/→       Seek ±10s
  ⇧←/⇧→    Seek ±60s
  ↑/↓       Volume ±3dB
  l         Toggle loop
  q         Quit

For more info: https://github.com/audiojs/audio
`)
}

// Exports for testing
export { parseValue, parseRange, parseArgs, showOpHelp, HELP }

// Run CLI if invoked directly (not imported)
let argv1 = process.argv[1]
try { argv1 = (await import('fs')).realpathSync(argv1) } catch {}
if (import.meta.url === `file://${argv1}`) {
  main().catch(err => {
    console.error(`audio: ${formatError(err)}`)
    process.exit(1)
  })
}
