// The voices the eval holds, cut from their datasets as LICENSE.md says: node test/eval/voices/cut.js <data dir>
// (the folder holding vbdemand/ and vocalset/, ~/.cache/audiojs/data by default). Each file is the source's 16-bit
// samples, unchanged, from the first sample named to the last, as FLAC.
import { readFileSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import audio from '../../../audio.js'

const data = process.argv[2] ?? path.join(os.homedir(), '.cache', 'audiojs', 'data')
// name: [file under the data dir, first sample, samples]
export const CUTS = {
  p232_013: ['vbdemand/clean_testset_wav/p232_013.wav', 0, null],
  p257_014: ['vbdemand/clean_testset_wav/p257_014.wav', 0, null],
  p232_052: ['vbdemand/clean_testset_wav/p232_052.wav', 0, null],
  p257_087: ['vbdemand/clean_testset_wav/p257_087.wav', 0, null],
  f2_caro_vibrato: ['vocalset/FULL/female2/excerpts/vibrato/f2_caro_vibrato.wav', 0, 198450],
}

// 16-bit PCM wav: its samples as integers, and its rate
function pcm16(file) {
  let b = readFileSync(file), o = 12
  while (b.toString('ascii', o, o + 4) !== 'data') o += 8 + b.readUInt32LE(o + 4)
  if (b.readUInt16LE(34) !== 16 || b.readUInt16LE(22) !== 1) throw new Error(`${file}: not 16-bit mono PCM`)
  let n = b.readUInt32LE(o + 4) / 2, x = new Int16Array(n)
  for (let i = 0; i < n; i++) x[i] = b.readInt16LE(o + 8 + 2 * i)
  return { x, fs: b.readUInt32LE(24) }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  for (let [name, [file, from, n]] of Object.entries(CUTS)) {
    let { x, fs } = pcm16(path.join(data, file)), cut = x.subarray(from, n == null ? x.length : from + n)
    let f = Float32Array.from(cut, v => v / 32768), out = new URL(name + '.flac', import.meta.url)
    writeFileSync(out, await audio.from([f], { sampleRate: fs }).encode('flac', { bitDepth: 16 }))
    // the file holds the source's samples: decoded, every one equal
    let [y] = await audio(readFileSync(out)).read(), bad = 0
    for (let i = 0; i < f.length; i++) if (Math.round(y[i] * 32768) !== cut[i]) bad++
    if (bad || y.length !== f.length) throw new Error(`${name}: ${bad} samples differ from the source's (${y.length} of ${f.length})`)
    console.log(`${name}.flac: ${file}, samples ${from} to ${from + cut.length - 1} of ${x.length}, ${fs} Hz, ${(cut.length / fs).toFixed(3)} s`)
  }
}
