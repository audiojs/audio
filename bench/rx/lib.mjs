// bench/rx's shared parts: iZotope RX 12's plugins (bench/rx/host.py) and our ops (`audio`) on the same buffers,
// WAV in and out, the seeded generator, and the measures every module reports.
//
//   const vdn = rx('Voice De-noise', { reduction: 20 }), om = op('omlsa()')
//   let y = await vdn({ ch, sr }), z = await om({ ch, sr })      // { ch: Float32Array[], sr }
//
// RX runs in one host process per Node process (Python from RX_PYTHON, else ~/.cache/audiojs/venv), plugins loaded
// once, jobs in order; outputs are aligned to the input (host.py lag: 0 samples for every plugin at 16, 44.1, 48 kHz).
// Renders are kept in ~/.cache/audiojs/data/rx/ by `keep(file, fn)`.
import { readFileSync, writeFileSync, renameSync, mkdirSync, existsSync, unlinkSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import audio from '../../audio.js'

export const DATA = path.join(os.homedir(), '.cache', 'audiojs', 'data')
export const OUT = path.join(DATA, 'rx')
const HERE = path.dirname(fileURLToPath(import.meta.url))
const PY = process.env.RX_PYTHON || path.join(os.homedir(), '.cache', 'audiojs', 'venv', 'bin', 'python')

/** WAV (16-bit PCM or 32-bit float) → { ch, sr } */
export function readWav(file) {
  let b = readFileSync(file), dv = new DataView(b.buffer, b.byteOffset, b.byteLength), o = 12, fmt, nc, sr
  while (o < b.length) {
    let id = b.toString('ascii', o, o + 4), len = dv.getUint32(o + 4, true)
    if (id === 'fmt ') fmt = dv.getUint16(o + 8, true), nc = dv.getUint16(o + 10, true), sr = dv.getUint32(o + 12, true)
    if (id === 'data') {
      let n = len / (fmt === 3 ? 4 : 2) / nc, ch = Array.from({ length: nc }, () => new Float32Array(n))
      for (let i = 0; i < n; i++) for (let c = 0; c < nc; c++)
        ch[c][i] = fmt === 3 ? dv.getFloat32(o + 8 + 4 * (i * nc + c), true) : dv.getInt16(o + 8 + 2 * (i * nc + c), true) / 32768
      return { ch, sr }
    }
    o += 8 + len + (len & 1)
  }
  throw new Error(`no data chunk in ${file}`)
}

/** { ch, sr } → 32-bit float WAV; written whole or not at all */
export function writeWav(file, ch, sr) {
  let n = ch[0].length, nc = ch.length, b = Buffer.alloc(44 + 4 * n * nc)
  b.write('RIFF', 0); b.writeUInt32LE(36 + 4 * n * nc, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16)
  b.writeUInt16LE(3, 20); b.writeUInt16LE(nc, 22); b.writeUInt32LE(sr, 24); b.writeUInt32LE(4 * sr * nc, 28)
  b.writeUInt16LE(4 * nc, 32); b.writeUInt16LE(32, 34); b.write('data', 36); b.writeUInt32LE(4 * n * nc, 40)
  for (let i = 0, p = 44; i < n; i++) for (let c = 0; c < nc; c++, p += 4) b.writeFloatLE(ch[c][i], p)
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(file + '.part', b)
  renameSync(file + '.part', file)
}

// the host process: one job per line, answered in order
let host, pending = [], seq = 0
function start() {
  host = spawn(PY, [path.join(HERE, 'host.py'), 'serve'], { stdio: ['pipe', 'pipe', 'ignore'] })
  createInterface({ input: host.stdout }).on('line', l => {
    let r = JSON.parse(l), p = pending.shift()
    r.error ? p.reject(new Error(r.error)) : p.resolve(r.out)
    if (!pending.length) hold(false)  // idle: the host doesn't keep Node alive
  })
  host.on('exit', c => { for (let p of pending.splice(0)) p.reject(new Error(`rx host exited ${c}`)); host = null })
}
const hold = on => [host, host.stdout, host.stdin].forEach(h => on ? h.ref() : h.unref())
function job(j) {
  if (!host) start()
  hold(true)
  return new Promise((resolve, reject) => { pending.push({ resolve, reject }); host.stdin.write(JSON.stringify(j) + '\n') })
}

/** RX 12 <plugin> with `params` (Pedalboard names; -Infinity for a gain's off) as ({ ch, sr }) → { ch, sr } */
export const rx = (plugin, params = {}) => async ({ ch, sr }) => {
  let tmp = path.join(OUT, 'tmp', `${process.pid}-${seq++}`), i = tmp + '-in.wav', o = tmp + '-out.wav'
  writeWav(i, ch, sr)
  let p = Object.fromEntries(Object.entries(params).map(([k, v]) => [k, v === -Infinity ? '-inf' : v]))
  try { await job({ plugin, params: p, in: i, out: o }); return readWav(o) }
  finally { for (let f of [i, o]) existsSync(f) && unlinkSync(f) }
}

/** Our op as audio's chain reads it: op('declick(5)'), op('omlsa({ gMin: -12 })') → ({ ch, sr }) → { ch, sr } */
export const op = stages => async ({ ch, sr }) => {
  let a = new Function('a', `return a.${stages}`)(audio.from(ch.map(c => Float32Array.from(c)), { sampleRate: sr }))
  return { ch: (await a.read()).map(c => Float32Array.from(c)), sr }
}

/** A render kept on disk: fn() → { ch, sr } once, the file after */
export async function keep(file, fn) {
  if (existsSync(file)) return readWav(file)
  let y = await fn()
  writeWav(file, y.ch, y.sr)
  return y
}

/** Seeded uniform [0, 1) (Numerical Recipes' LCG) */
export const lcg = seed => { let s = seed >>> 0; return () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296 }

// Measures. SI-SDR: Le Roux, Wisdom, Erdogan, Hershey, ICASSP 2019, eq. 3 (zero-mean, dB). SNR: 10·log10 of the
// reference's energy over the error's. `gone`: how much of the error a repair removes over [a, b), 10·log10 of the
// error before over the error after (dB; the README "Measured" tables of @audio/denoise use it).
const sum = (f, n) => { let s = 0; for (let i = 0; i < n; i++) s += f(i); return s }
export function sisdr(ref, est) {
  let n = Math.min(ref.length, est.length), mr = sum(i => ref[i], n) / n, me = sum(i => est[i], n) / n
  let rr = sum(i => (ref[i] - mr) ** 2, n), re = sum(i => (ref[i] - mr) * (est[i] - me), n), a = re / rr
  let t = a * a * rr, e = sum(i => (est[i] - me - a * (ref[i] - mr)) ** 2, n)
  return 10 * Math.log10(t / e)
}
export const snr = (ref, est, a = 0, b = Math.min(ref.length, est.length)) => {
  let s = 0, e = 0
  for (let i = a; i < b; i++) s += ref[i] ** 2, e += (est[i] - ref[i]) ** 2
  return 10 * Math.log10(s / (e || 1e-30))
}
export const gone = (clean, before, after, a, b) => {
  let x = 0, y = 0
  for (let i = a; i < b; i++) x += (before[i] - clean[i]) ** 2, y += (after[i] - clean[i]) ** 2
  return 10 * Math.log10(x / (y || 1e-30))
}
export const median = v => { let s = [...v].sort((p, q) => p - q), n = s.length; return n % 2 ? s[n >> 1] : (s[n / 2 - 1] + s[n / 2]) / 2 }
export const mean = v => v.reduce((s, x) => s + x, 0) / v.length

/** Markdown table: header cells, rows of cells */
export const table = (head, rows) => [`| ${head.join(' | ')} |`, `|${head.map((_, i) => i ? '---:' : '---').join('|')}|`, ...rows.map(r => `| ${r.join(' | ')} |`)].join('\n')
