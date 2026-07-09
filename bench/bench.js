// Cross-tool audio benchmark — audio vs SoX, FFmpeg, librosa, Pedalboard on one
// shared input. Each cell is the best of N warm wall-clock runs of the *whole task*
// from the input file: decode for the decode rows, decode+analyze for analysis rows,
// decode+op+encode→file for transform rows (a CLI can't separate these). Missing
// cell = tool lacks the op.
//
// Measurement basis, by how the tool is actually invoked:
//  - CLI tools (audio, sox, ffmpeg) run as a fresh subprocess per rep — includes
//    process startup + full decode every run (Node's startup is heavier than a C
//    binary's; that cost is real and counted). A fresh process each rep also means
//    no cross-run decode caching can flatter any tool.
//  - Library tools (librosa, Pedalboard) run in-process (that is how you use them);
//    their cells exclude interpreter startup. Noted in the doc.
//
//   node bench/bench.js [durationSeconds=600] [reps=3]
//
// Prints a markdown table + writes bench/results.json. librosa/Pedalboard cells
// need a python with `pip install librosa pedalboard soundfile` — point $BENCH_PY
// at it (e.g. a venv's bin/python); otherwise those columns are skipped.

import { execFileSync } from 'node:child_process'
import { writeFileSync, existsSync, rmSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ensureFixtures } from './fixtures.js'

const BIN = fileURLToPath(new URL('../bin/cli.js', import.meta.url))

const HERE = dirname(fileURLToPath(import.meta.url))
const DUR = Number(process.argv[2] || 600)
const REPS = Number(process.argv[3] || 3)
const CACHE = process.env.BENCH_CACHE || join(HERE, '.cache')
const TMP = join(CACHE, 'out')
const PY = process.env.BENCH_PY || 'python3'

/** Best-of-REPS wall-clock ms for a CLI subprocess; one warm-up first.
 *  Node ≤25 can deadlock in platform shutdown AFTER the work is done
 *  (nodejs/node#54918 — pthread_join on a V8 worker stuck allocating), so each
 *  rep gets a ceiling scaled from the warm-up and one retry: a timed-out rep
 *  measures the deadlock, not the op, and is discarded. */
function cliBest(bin, args) {
  const run = timeout => { let s = performance.now(); execFileSync(bin, args, { stdio: 'ignore', timeout, killSignal: 'SIGKILL' }); return performance.now() - s }
  let warm = run(600_000)
  let ceil = Math.max(30_000, Math.ceil(warm * 3))
  let t = []
  for (let i = 0; i < REPS; i++) {
    try { t.push(run(ceil)) }
    catch (e) {
      if (e.code !== 'ETIMEDOUT' && e.signal !== 'SIGKILL') throw e
      console.error(`  (rep timed out — node shutdown deadlock, retrying)`)
      try { t.push(run(ceil)) } catch { /* second timeout: fall back on remaining reps */ }
    }
  }
  return t.length ? Math.min(...t) : warm
}

const has = cmd => { try { execFileSync('which', [cmd], { stdio: 'ignore' }); return true } catch { return false } }
const HAS_SOX = has('sox'), HAS_FF = has('ffmpeg'), HAS_PY = existsSync(PY) || has(PY)

// ── Rows: op key → { label, tools } ─────────────────────────────────────────
// Each tool fn returns a task closure, or null if the tool lacks the op.
const results = {} // op → { tool → ms | null }
const rec = (op, tool, ms) => { (results[op] ??= {})[tool] = ms }

async function main() {
  console.error(`# fixtures: ${DUR}s @ ${44100}Hz stereo, reps=${REPS}`)
  let { wav, mp3 } = await ensureFixtures(CACHE, DUR)
  rmSync(TMP, { recursive: true, force: true })
  execFileSync('mkdir', ['-p', TMP])
  const out = name => join(TMP, name)

  // ── audio (CLI subprocess — same basis as sox/ffmpeg) ──────────────────────
  const acli = (...a) => cliBest('node', [BIN, ...a])
  const DECODE = fileURLToPath(new URL('./decode.js', import.meta.url))
  const adec = f => cliBest('node', [DECODE, f])
  rec('wav_decode', 'audio', adec(wav))                                    // decode → PCM (no analysis summary)
  rec('mp3_decode', 'audio', adec(mp3))
  rec('normalize', 'audio', acli(wav, 'normalize', '0', '-f', '-o', out('a_norm.wav')))
  rec('lufs', 'audio', acli(wav, 'stat', 'loudness'))
  rec('resample', 'audio', acli(wav, 'resample', '48000', '-f', '-o', out('a_rs.wav')))
  rec('stretch', 'audio', acli(wav, 'stretch', '0.8', '-f', '-o', out('a_st.wav')))
  rec('pitch', 'audio', acli(wav, 'pitch', '2', '-f', '-o', out('a_pi.wav')))
  rec('fft', 'audio', acli(wav, 'stat', 'spectrum'))
  rec('mfcc', 'audio', acli(wav, 'stat', 'cepstrum'))
  rec('beat', 'audio', acli(wav, 'stat', 'beats'))
  console.error('audio done')

  // ── SoX ─────────────────────────────────────────────────────────────────
  if (HAS_SOX) {
    const sox = (...a) => cliBest('sox', a)
    rec('wav_decode', 'sox', sox(wav, '-n'))                          // decode → null sink
    rec('normalize', 'sox', sox(wav, out('s_norm.wav'), 'norm', '0'))
    rec('resample', 'sox', sox(wav, '-r', '48000', out('s_rs.wav')))
    rec('stretch', 'sox', sox(wav, out('s_st.wav'), 'tempo', '0.8'))
    rec('pitch', 'sox', sox(wav, out('s_pi.wav'), 'pitch', '200'))    // +2 semitones = 200 cents
    console.error('sox done')
  }

  // ── FFmpeg ────────────────────────────────────────────────────────────────
  if (HAS_FF) {
    const ff = (...a) => cliBest('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', ...a])
    rec('wav_decode', 'ffmpeg', ff('-i', wav, '-f', 'null', '-'))
    rec('mp3_decode', 'ffmpeg', ff('-i', mp3, '-f', 'null', '-'))
    rec('lufs', 'ffmpeg', ff('-i', wav, '-af', 'ebur128=framelog=quiet', '-f', 'null', '-'))
    rec('resample', 'ffmpeg', ff('-i', wav, '-ar', '48000', out('f_rs.wav')))
    rec('stretch', 'ffmpeg', ff('-i', wav, '-af', 'atempo=0.8', out('f_st.wav')))
    // asetrate+aresample = classic pitch shift (also changes tempo → not identical to sox/audio,
    // but the canonical ffmpeg one-liner without the rubberband build dependency)
    rec('pitch', 'ffmpeg', ff('-i', wav, '-af', `asetrate=${44100 * 2 ** (2 / 12)},aresample=44100`, out('f_pi.wav')))
    console.error('ffmpeg done')
  }

  // ── librosa + Pedalboard (python sidecar) ──────────────────────────────────
  if (HAS_PY) {
    try {
      let raw = execFileSync(PY, [join(HERE, 'bench.py'), wav, mp3, TMP, String(REPS)], { encoding: 'utf8', maxBuffer: 1 << 24 })
      for (let line of raw.trim().split('\n')) {
        if (!line) continue
        let { tool, op, ms } = JSON.parse(line)
        if (ms != null) rec(op, tool, ms)
      }
      console.error('python done')
    } catch {
      console.error('librosa/pedalboard skipped — $BENCH_PY python lacks librosa/pedalboard/soundfile')
    }
  }

  // ── Emit ────────────────────────────────────────────────────────────────
  const ROWS = [
    ['wav_decode', 'WAV decode'], ['mp3_decode', 'MP3 decode'], ['normalize', 'Peak normalize'],
    ['lufs', 'LUFS measurement'], ['resample', 'Resample 44.1k→48k'], ['stretch', 'Time stretch 0.8×'],
    ['pitch', 'Pitch shift +2 st'], ['fft', 'FFT spectrum (1024-pt)'], ['mfcc', 'MFCC (13 coeff)'], ['beat', 'Beat tracking'],
  ]
  const TOOLS = [['audio', '`audio` (Node)'], ['librosa', 'librosa'], ['pedalboard', 'Pedalboard'], ['sox', 'SoX'], ['ffmpeg', 'FFmpeg']]
  const cell = ms => ms == null ? '—' : ms >= 1000 ? (ms / 1000).toFixed(2) + ' s' : ms.toFixed(0) + ' ms'

  let head = `| Operation | ${TOOLS.map(t => t[1]).join(' | ')} |`
  let sep = `|${'---|'.repeat(TOOLS.length + 1)}`
  let body = ROWS.map(([op, label]) => `| ${label} | ${TOOLS.map(([t]) => cell(results[op]?.[t])).join(' | ')} |`)
  let table = [head, sep, ...body].join('\n')
  console.log('\n' + table + '\n')

  writeFileSync(join(HERE, 'results.json'), JSON.stringify({ dur: DUR, reps: REPS, sr: 44100, at: new Date().toISOString(), results }, null, 2) + '\n')
  console.error(`wrote ${join(HERE, 'results.json')}`)
}

main().then(() => process.exit(0), e => { console.error(e); process.exit(1) })
