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
import { kWeighting } from 'audio-filter/weighting'
import freqz from 'digital-filter/core/freqz.js'
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

// ── CLI Aliases ──────────────────────────────────────────────────────────

const ALIAS = {
  norm: 'normalize',
  hp: 'highpass',
  lp: 'lowpass',
  ls: 'lowshelf',
  hs: 'highshelf',
  bp: 'bandpass',
  peaking: 'eq',
}

// ── Argument Parsing ─────────────────────────────────────────────────────

function isFlag(s) {
  if (s.startsWith('--')) return true
  if (!s.startsWith('-')) return false
  let match = s.match(/^-[\d.]+(db|hz|khz|s|ms)?$/i)
  return !match
}

function isOpName(s) {
  return s in audio.op || s in ALIAS
}

function parseArgs(args) {
  let input = null, ops_ = [], output = null, format = null
  let verbose = false, showHelp = false, play = false, force = false
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
      let name = ALIAS[arg] || arg
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

  // Expand fade shorthand: bare `fade` or `fade IN -OUT` → two fade ops
  let expanded = []
  for (let op of ops_) {
    if (op.name === 'fade') {
      let nums = op.args.filter(a => typeof a === 'number')
      let curve = op.args.find(a => typeof a === 'string')
      let curveArgs = curve ? [curve] : []

      if (nums.length === 0) {
        // bare `fade` → 0.5s in + 0.5s out
        expanded.push({ name: 'fade', args: [0.5, ...curveArgs], offset: null, duration: null })
        expanded.push({ name: 'fade', args: [-0.5, ...curveArgs], offset: null, duration: null })
      } else if (nums.length === 1 && nums[0] > 0) {
        // `fade 0.3` → both at 0.3s
        expanded.push({ name: 'fade', args: [nums[0], ...curveArgs], offset: null, duration: null })
        expanded.push({ name: 'fade', args: [-nums[0], ...curveArgs], offset: null, duration: null })
      } else if (nums.length === 2 && nums[0] > 0 && nums[1] < 0) {
        // `fade 0.2 -1` → in 0.2s, out 1s
        expanded.push({ name: 'fade', args: [nums[0], ...curveArgs], offset: null, duration: null })
        expanded.push({ name: 'fade', args: [nums[1], ...curveArgs], offset: null, duration: null })
      } else {
        expanded.push(op)
      }
    } else {
      expanded.push(op)
    }
  }
  ops_ = expanded

  return { input, ops: ops_, output, format, verbose, showHelp, play, force }
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
  let h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), sec = Math.floor(s % 60)
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`
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

function playTime(s) {
  s = Math.max(0, s)
  let h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), sec = Math.floor(s % 60)
  return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
}

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
  const win = new Float32Array(N)
  for (let i = 0; i < N; i++) win[i] = 0.5 * (1 - Math.cos(2 * Math.PI * i / (N - 1)))
  let prev = null

  // Mel scale (perceptual frequency mapping)
  let toMel = f => 2595 * Math.log10(1 + f / 700)
  let fromMel = m => 700 * (10 ** (m / 2595) - 1)

  // Auto-scaling: track running peak dB for spectrum
  let specMax = -60, specFreqs = null, specDb = null, kWeights = null

  let spec = (block, sr, w, paused) => {
    if (!fft) return ' '.repeat(w)
    let fMin = 30, fMax = Math.min(sr / 2, 20000), binHz = sr / N
    let mMin = toMel(fMin), mMax = toMel(fMax)
    if (!specFreqs || specFreqs.length !== w) {
      specFreqs = new Float32Array(w)
      for (let b = 0; b < w; b++) {
        let f0 = fromMel(mMin + (mMax - mMin) * b / w)
        let f1 = fromMel(mMin + (mMax - mMin) * (b + 1) / w)
        specFreqs[b] = (f0 + f1) / 2
      }
      let { magnitude } = freqz(kWeighting.coefs(sr), Array.from(specFreqs), sr)
      kWeights = magnitude
    }
    if (block && block.length >= N) {
      let buf = new Float32Array(N)
      for (let i = 0; i < N; i++) buf[i] = block[i] * win[i]
      let mag = fft(buf)
      if (!prev || prev.length !== w) prev = new Float32Array(w)
      for (let b = 0; b < w; b++) {
        let f0 = fromMel(mMin + (mMax - mMin) * b / w)
        let f1 = fromMel(mMin + (mMax - mMin) * (b + 1) / w)
        let k0 = Math.max(1, Math.floor(f0 / binHz))
        let k1 = Math.min(mag.length - 1, Math.ceil(f1 / binHz))
        let sum = 0, cnt = 0
        for (let k = k0; k <= k1; k++) { sum += mag[k] ** 2; cnt++ }
        let rms = cnt > 0 ? Math.sqrt(sum / cnt) : 0
        rms *= kWeights[b]
        prev[b] = paused ? rms : Math.max(rms, prev[b] * 0.85)
      }
    } else if (prev && !paused) {
      for (let b = 0; b < prev.length; b++) prev[b] *= 0.85
    }
    if (!prev) return ' '.repeat(w)
    // Auto-scale: find current max dB, decay peak slowly
    let curMax = -100
    specDb = new Float32Array(w)
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
      let [peak, , l, clips, dcOff] = await Promise.all([a.db(), a.rms(), a.loudness(), a.clip(), a.dc()])
      let warn = ''
      if (clips) warn += `   clip:${clips}`
      if (Math.abs(dcOff) > 0.001) warn += `   dc:${dcOff.toFixed(4)}`
      fileInfo = `${fmtRate(a.sampleRate)}   ${a.channels}ch   ${formatDuration(a.duration)}   ${peak.toFixed(1)}dBFS   ${l.toFixed(1)}LUFS${warn}`
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
    let icon = p.paused ? '⏸' : '▶'
    let ct = playTime(t), tt = ts > 0 ? '-' + playTime(ts - t) : '-0:00:00'
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
      let s = spec(p.block, sr, sw, p.paused)
      out += `\n\x1b[K${lpad}${s}`
      newLines++
      let fl = freqLabels(sr, sw)
      if (fl.trim()) {
        out += `\n\x1b[K${lpad}${DIM}${fl.trimEnd()}${RST}`; newLines++
      }
    }

    // Info line
    let decoding = a && !a.decoded ? `   ${SPIN[spinIdx++ % 10]} decoding` : ''
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

  render(0)
  p.ontimeupdate = render

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

  await new Promise(r => { p.onended = r })

  if (process.stdin.isTTY) {
    process.stdin.setRawMode(false)
    process.stdin.removeAllListeners('data')
  }

  let out = '\r\x1b[K'
  for (let i = 1; i < nLines; i++) out += '\n\x1b[K'
  if (nLines > 1) out += `\x1b[${nLines - 1}A`
  process.stderr.write(out)
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
    if (opts.play && !opts.ops.length && !opts.output && typeof source === 'string') {
      if (opts.verbose) console.error(`Opening: ${source}`)
      let spin = !opts.verbose ? spinner('Loading') : null
      let a = await audio.open(source)
      spin?.stop()
      await playback(a.play(),
        () => a.decoded ? a.duration : 0,
        () => a.pages.length * 65536 / a.sampleRate,
        a, source
      )
      process.exit(0)
    }

    // Load audio (full decode)
    if (opts.verbose) console.error(`Loading: ${typeof source === 'string' ? source : '(stdin)'}`)
    let spin = !opts.verbose ? spinner('Loading') : null
    let a = await audio(source, {
      onprogress: opts.verbose
        ? ({ offset }) => process.stderr.write(`\rDecoding... ${formatDuration(offset)}`)
        : undefined
    })
    let loadTime = spin?.stop()
    if (opts.verbose) console.error('\n')

    // no-ops: show audio info
    if (!opts.ops.length && !opts.output && !opts.play) {
      let [peak, , l, clips, dcOff] = await Promise.all([a.db(), a.rms(), a.loudness(), a.clip(), a.dc()])
      console.log(`  Duration:   ${formatDuration(a.duration)}`)
      console.log(`  Channels:   ${a.channels}`)
      console.log(`  SampleRate: ${a.sampleRate} Hz`)
      console.log(`  Samples:    ${a.length}`)
      console.log(`  Peak:       ${peak.toFixed(1)} dBFS`)
      console.log(`  Loudness:   ${l.toFixed(1)} LUFS`)
      console.log(`  Clipping:   ${clips || 'none'}`)
      console.log(`  DC offset:  ${Math.abs(dcOff) > 0.0001 ? dcOff.toFixed(4) : 'none'}`)
      if (loadTime) console.log(`  Loaded in:  ${loadTime}s`)
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
      await playback(a.play(), () => a.duration, () => a.duration, a, typeof source === 'string' ? source : null)
      if (!opts.output) process.exit(0)
    }

    // Save output
    if (opts.output || (!opts.play && opts.ops.length)) {
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
          let spin = !opts.verbose ? spinner(opts.ops.length ? 'Processing' : 'Saving') : null
          await new Promise(r => setTimeout(r, 100))  // let spinner render before blocking render()
          await a.save(output, {
            format: fmt,
            onprogress: spin ? ({ offset, total }) => spin.set(' ' + Math.round(offset / total * 100) + '%') : undefined
          })
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
  gain DB [RANGE]  Amplify in dB (e.g., gain -3db, gain 6 1s..5s)
  fade [IN] [-OUT] [CURVE]  Fade in/out (bare = 0.5s both, single = both same)
  trim [THR]       Auto-trim silence (threshold in dB, optional)
  normalize [DB] [RANGE]  Peak normalize (default: 0dB). Presets: streaming, podcast, broadcast
  reverse [RANGE]  Reverse audio
  crop OFF DUR     Crop to range in seconds
  remove OFF DUR   Delete range in seconds
  insert SRC OFF   Insert audio from file/duration
  repeat N         Repeat N times
  mix SRC OFF      Mix in another audio file
  remix CH         Remix channels (e.g., remix 2 for stereo)

Filters (ORDER = steepness: 2 = -12dB/oct, 4 = -24dB/oct, default: 2):
  highpass | hp FC [ORDER]   Remove below FC (e.g., hp 120hz 4)
  lowpass | lp FC [ORDER]    Remove above FC
  eq FC GAIN [Q]             Parametric EQ boost/cut at FC
  lowshelf | ls FC GAIN [Q]  Shelf boost/cut below FC
  highshelf | hs FC GAIN [Q] Shelf boost/cut above FC
  notch FC [Q]               Kill a single frequency (default Q=30)
  bandpass | bp FC [Q]       Pass only around FC

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
  --force, -f   Overwrite output file if it exists
  --verbose     Show progress and debug info
  --format FMT  Override output format (default: from extension)
  --help, -h    Show this help
  --version, -v Show version

Examples:
  audio in.mp3
  audio in.mp3 gain -3db trim normalize -o out.wav
  audio in.wav --play
  audio in.mp3 fade -o out.mp3
  audio in.mp3 fade .2s -1s cos -o out.mp3
  audio in.wav gain -3db 1s..10s -o out.wav
  audio in.mp3 normalize streaming -o out.wav
  audio in.mp3 highpass 80hz -o clean.mp3
  audio in.mp3 hp 80hz eq 300hz -2db lowshelf 200hz -3db -o out.wav
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
