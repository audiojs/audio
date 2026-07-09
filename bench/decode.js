// Minimal decode-to-PCM for the benchmark's decode rows — load a file and
// materialize full PCM, nothing else (the CLI's default stat sink additionally
// computes a LUFS/spectrum/clipping summary for display, which is not decode).
// Run as a fresh subprocess per rep, same basis as `sox in -n` / `ffmpeg -f null`.
//
//   node bench/decode.js <file>

import audio from '../audio.js'
let a = await audio(process.argv[2])
await a.read()
