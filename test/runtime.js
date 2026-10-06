// The library under another runtime, as the README claims it runs: bun test/runtime.js, deno run -A test/runtime.js.
// A file decoded, edited, measured, encoded and decoded back, with no test framework, so any runtime runs it as is.
import audio from '../audio.js'

const fail = msg => { console.error(`not ok ${msg}`); globalThis.process ? process.exit(1) : Deno.exit(1) }
const a = audio('test/fixture.wav').trim().normalize('podcast')
const lufs = await a.stat('loudness')
if (Math.abs(lufs + 16) > 0.1) fail(`normalize('podcast'): ${lufs} LUFS, not -16`)
const back = await audio(await a.encode('flac'))
if (Math.abs(back.duration - a.duration) > 1e-3) fail(`flac round trip: ${back.duration} s, not ${a.duration}`)
const { pass } = await a.check('podcast')
if (!pass) fail(`check('podcast') after normalize('podcast')`)
console.log(`ok ${lufs.toFixed(2)} LUFS, ${a.duration.toFixed(3)} s, flac round trip, check podcast`)
