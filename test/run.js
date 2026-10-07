// The suite, each file in its own process, as many at once as there are cores: the run takes as long as its slowest
// file, not their sum. Each file's output prints whole as it finishes, then one line per file and the totals.
// `node test/run.js pro deck` runs those alone; TST_* variables reach every file.
import { spawn } from 'node:child_process'
import { availableParallelism } from 'node:os'
import { fileURLToPath } from 'node:url'

// slowest first, so the long ones start at once
const SUITES = [
  'index',          // the library, isomorphic (the browser runs it too: test/test.html)
  'pro',            // delivery grade: loudness to spec, files, CLI, video, bare atom imports
  'plugin-denoise',
  'recipes',        // the editor's voice recipes against the specs they name
  'deck',           // playback offline: the deck fed by a voice, sample by sample (the browser plays it: test/play.html)
  'cuts',           // cut lists for video editors: the time map, CMX 3600, OpenTimelineIO, FCPXML read back
  'periodicity',    // voicing, hnr, harmonic against Praat, frame by frame
  'hits',           // cues: where each attack starts, where each sound stops (fn/hits.js, the editor's)
  'rx',             // RX 12's modules we lacked: wow & flutter, azimuth, phase, codec preview, deconstruct, find similar
  'pedalboard',     // Pedalboard's built-ins we lacked: convolution, MP3 VBR, GSM
  'plugin-ops',
  'plugin-notes', 'plugin-tune', 'plugin-stats', 'plugin-stretch', 'plugin-color', 'plugin-effects', 'plugin-reverb',
  'plugin-shift', 'plugin-dynamics', 'plugin-synth', 'plugin-filter', 'plugin-fate', 'plugin-spatial', 'plugin-eq',
  'plugin-host',    // native plugins (VST3, CLAP, AU, LV2) through the optional @audio/host
]
// contract suites resolve manifests from the sibling @audio checkout until their npm releases land, and the recipes
// need the editor: where those are missing (bare CI), the file is skipped, not failed
const optional = name => name === 'recipes' || (name.startsWith('plugin-') && name !== 'plugin-ops')

const names = process.argv.slice(2).map(a => a.replace(/^(test\/)?(.*?)(\.js)?$/, '$2'))
const queue = names.length ? names : SUITES
const strip = s => s.replace(/\x1b\[[0-9;]*m/g, '')

function exec(name) {
  let url = new URL(`./${name}.js`, import.meta.url).href, t0 = performance.now(), out = []
  let args = optional(name)
    ? ['--input-type=module', '-e', `import(${JSON.stringify(url)}).catch(e => { if (e.code !== 'ERR_MODULE_NOT_FOUND') throw e; console.warn('skip ${name}: ' + (e.message.split("'")[1] || '') + ' missing') })`]
    : [fileURLToPath(url)]
  return new Promise(done => {
    let p = spawn(process.execPath, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    p.stdout.on('data', d => out.push(d)); p.stderr.on('data', d => out.push(d))
    p.on('close', (code, signal) => {
      let text = Buffer.concat(out).toString(), plain = strip(text), n = k => +(plain.match(new RegExp(`^# ${k} (\\d+)`, 'm'))?.[1] ?? 0)
      process.stdout.write(text)
      done({ name, code: code ?? signal, ms: performance.now() - t0, total: n('total'), pass: n('pass'), fail: n('fail'), skip: n('skip'),
        asserts: +(plain.match(/^# total \d+ \((\d+) assertions\)/m)?.[1] ?? 0), skipped: /^skip /m.test(plain) && !n('total') })
    })
  })
}

let t0 = performance.now(), results = [], next = 0
await Promise.all(Array.from({ length: Math.min(availableParallelism(), queue.length) }, async () => {
  while (next < queue.length) results.push(await exec(queue[next++]))
}))

let sum = k => results.reduce((s, r) => s + r[k], 0), failed = results.filter(r => r.code !== 0)
console.log('\n═══')
for (let r of results.sort((a, b) => b.ms - a.ms))
  console.log(`${r.code ? '\x1b[31m×' : r.skipped ? '\x1b[90m»' : '\x1b[32m√'} ${(r.ms / 1000).toFixed(1).padStart(5)}s ${r.name}${r.skipped ? ' (skip)' : r.code ? ` (exit ${r.code})` : ''}\x1b[0m`)
console.log(`# total ${sum('total')} (${sum('asserts')} assertions), ${((performance.now() - t0) / 1000).toFixed(1)}s`)
if (sum('pass')) console.log(`\x1b[32m# pass ${sum('pass')}\x1b[0m`)
if (failed.length) console.log(`\x1b[31m# fail ${sum('fail')} in ${failed.map(r => r.name).join(', ')}\x1b[0m`)
if (sum('skip')) console.log(`\x1b[90m# skip ${sum('skip')}\x1b[0m`)
// not process.exit: on a pipe (CI's log) the output still being written would be cut, the summary with it
process.exitCode = failed.length ? 1 : 0
