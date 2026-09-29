// denoise() on the VoiceBank+DEMAND test set (Valentini-Botinhao 2017, CC BY 4.0, doi:10.7488/ds/2117), each file's
// noise learned from its lead-in: 0 s to 50 ms before the clean reference's speech starts (its first 20 ms frame 15 dB
// over the 10th percentile of its frame energies; at least 0.1 s; median 0.55 s). Outputs are 48 kHz float32 in
// ~/.cache/audiojs/data/vbdemand/out/<SYSTEM>/<name>.f32, the layout @audio/denoise's scripts/speech.py scores:
//
//   node bench/denoise.mjs [REDUCTION] [SYSTEM]      (12, `denoise-12`)
//   python <@audio/denoise>/scripts/speech.py score vbdemand denoise-12      PESQ, STOI, SI-SDR, DNSMOS, musical noise
//
// Data: clean_testset_wav and noisy_testset_wav in ~/.cache/audiojs/data/vbdemand/ (bench/speech.mjs says where from).
import { readFileSync, readdirSync, mkdirSync, writeFileSync, existsSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import audio from '../audio.js'

const D = path.join(os.homedir(), '.cache', 'audiojs', 'data', 'vbdemand')

// 16-bit PCM mono wav → { x, fs }
function wav(file) {
  let b = readFileSync(file), o = 12
  while (b.toString('ascii', o, o + 4) !== 'data') o += 8 + b.readUInt32LE(o + 4)
  let n = b.readUInt32LE(o + 4) / 2, x = new Float32Array(n)
  for (let i = 0; i < n; i++) x[i] = b.readInt16LE(o + 8 + 2 * i) / 32768
  return { x, fs: b.readUInt32LE(24) }
}

// seconds of noise before the speaker starts, from the clean reference
export function lead(x, fs) {
  let n = Math.round(0.02 * fs), m = Math.floor(x.length / n), e = []
  for (let j = 0; j < m; j++) { let s = 0; for (let i = j * n; i < (j + 1) * n; i++) s += x[i] * x[i]; e.push(10 * Math.log10(s / n + 1e-20)) }
  let floor = [...e].sort((a, b) => a - b)[Math.floor(0.1 * (m - 1))], j = e.findIndex(v => v > floor + 15)
  return Math.max(0.1, (j < 0 ? m : j) * n / fs - 0.05)
}

if (import.meta.url === `file://${process.argv[1]}`) {
  let reduction = Number(process.argv[2] ?? 12), system = process.argv[3] ?? `denoise-${reduction}`, out = path.join(D, 'out', system)
  mkdirSync(out, { recursive: true })
  let names = readdirSync(path.join(D, 'noisy_testset_wav')).filter(f => f.endsWith('.wav')).sort().map(f => f.slice(0, -4)), c0 = process.cpuUsage()
  for (let name of names) {
    let file = path.join(out, name + '.f32')
    if (existsSync(file)) continue
    let { x, fs } = wav(path.join(D, 'noisy_testset_wav', name + '.wav')), dur = lead(wav(path.join(D, 'clean_testset_wav', name + '.wav')).x, fs)
    let [y] = await audio.from([x], { sampleRate: fs }).denoise(reduction, { noise: { at: 0, duration: Math.round(dur * fs) / fs } }).read()
    writeFileSync(file, new Uint8Array(y.buffer, y.byteOffset, y.length * 4))
  }
  let c = process.cpuUsage(c0)
  console.log(`${system}: ${names.length} files in ${out}, ${((c.user + c.system) / 1e6).toFixed(1)} s CPU`)
}
