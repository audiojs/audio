// Streaming conformance. A source still arriving (a live feed, a pipe, a stream that runs for
// days) must produce output as it arrives: an op either streams, with output equal to the
// whole-file render and held back at most by what it declares (latency, a fade-out, a range
// counted from the end, a pause still open), or it is listed in WHOLE with why. WHOLE may only
// shrink: an entry that starts streaming fails here until it is removed.
import test from 'tst'
import audio from '../audio.js'

const SR = 8000, CHUNK = 800
// silence, tone, a 1.5 s pause, tone, trailing silence: something for trim and shrink to do
const X = Float32Array.from({ length: SR * 6 }, (_, i) => { let t = i / SR; return (t > 0.5 && t < 2) || (t > 3.5 && t < 5) ? 0.4 * Math.sin(2 * Math.PI * 300 * t) : 0 })
const B = () => audio.from(t => 0.2, { duration: 0.5, sampleRate: SR })
const pause = () => new Promise(r => setTimeout(r, 1))

/** Push X in chunks into a live source with `chain` applied, reading its stream concurrently.
 *  `first`: seconds of input pushed when the first output arrived. */
async function live(chain, input = X, ch = 1) {
  let src = audio(null, { sampleRate: SR, channels: ch })
  chain(src)
  let out = [], first = null, pushed = 0
  let reader = (async () => { for await (let b of src.stream()) { if (first == null && b[0].length) first = pushed; out.push(...b[0]) } })()
  for (let o = 0; o < input.length; o += CHUNK) { let c = input.slice(o, o + CHUNK); src.push(ch > 1 ? [c, c.slice()] : c); pushed += c.length; await pause() }
  src.stop()
  await reader
  return { out, first: (first ?? pushed) / SR }
}

const same = (a, b) => a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) < 1e-5)

// Live output ≡ whole-file render, first output within `bound` seconds of input (Infinity: the op
// decides from the whole input, so it waits for the end, then renders exactly as the file does)
const EXACT = {
  'gain(-3)': [a => a.gain(-3), 0.4],
  'fade(0.5, -0.5): fade-out held back 0.5 s': [a => a.fade(0.5, -0.5), 1],
  'gain(-3, {at: -2}): range from the end held back 2 s': [a => a.gain(-3, { at: -2 }), 2.5],
  'trim(-40): silent tail held until sound resumes': [a => a.trim(-40), 1],
  'shrink(0.3, -40): open pause held at its gap': [a => a.shrink(0.3, -40), 0.5],
  'trim(-40).shrink(0.3, -40)': [a => a.trim(-40).shrink(0.3, -40), 1],
  'highpass(80).trim(-40): stats of the filtered stage accumulate as it renders': [a => a.highpass(80).trim(-40), 1],
  'highpass(80).shrink(0.3, -40)': [a => a.highpass(80).shrink(0.3, -40), 0.5],
  'trim(): automatic threshold waits for the whole input': [a => a.trim(), Infinity],
  'shrink(): automatic threshold waits': [a => a.shrink(), Infinity],
  "normalize(-16, 'lufs'): one gain for the whole selection waits": [a => a.normalize(-16, 'lufs'), Infinity],
  'normalize(-6): peak': [a => a.normalize(-6), Infinity],
  "highpass(80).normalize('podcast')": [a => a.highpass(80).normalize('podcast'), Infinity],
  'filters': [a => a.highpass(80, 4).eq(1000, 3).lowshelf(200, 3).notch(50), 0.4],
  'crop({at: 1, duration: 3})': [a => a.crop({ at: 1, duration: 3 }), 1.5],
  'remove(1, 0.5, 10ms)': [a => a.remove(1, 0.5, '10ms'), 0.4],
  'insert(B, 1, 10ms)': [a => a.insert(B(), 1, '10ms'), 0.4],
  'insert(B) appended, 10ms': [a => a.insert(B(), 6, '10ms'), 0.4],
  'mix(B, 1, -6)': [a => a.mix(B(), 1, -6), 0.4],
  'crossfade(B, 0.2): blend held for the end': [a => a.crossfade(B(), 0.2), 0.8],
  'pad, repeat': [a => a.pad(0.5, 0.5).repeat(1), 0.4],
  'reverse({at: 1, duration: 1}): range held until complete': [a => a.reverse({ at: 1, duration: 1 }), 0.4],
  'speed, stretch, pitch, resample': [a => a.speed(1.5).stretch(1.25).pitch(3).resample(16000), 0.5],
  'remix(2), crossover': [a => a.remix(2).crossover(1000), 0.4],
  'spectral([200, 400], -20, 1 s at 1 s)': [a => a.spectral([200, 400], -20, { at: 1, duration: 1 }), 0.6],
  'spectral 1 s at -2 s: placed once the end is known': [a => a.spectral([200, 400], -20, { at: -2, duration: 1 }), Infinity],
  'repair(50 ms at 1 s)': [a => a.repair({ at: 1, duration: 0.05 }), 1.3],
  'repair(50 ms at -1.5 s)': [a => a.repair({ at: -1.5, duration: 0.05 }), Infinity],
  'plugins: limiter, compressor, freeverb': [a => a.limiter().compressor().freeverb(), 0.5],
}

for (let [name, [chain, bound]] of Object.entries(EXACT)) test(`stream: ${name}`, async t => {
  let { out, first } = await live(chain)
  let [ref] = await chain(audio.from([X], { sampleRate: SR })).read()
  t.ok(same(out, ref), 'live ≡ whole-file render')
  if (bound < Infinity) t.ok(first <= bound, `first output after ${first.toFixed(1)} s of input (≤ ${bound})`)
})

// Adaptive ops start at once and refine from what they have heard: the gain can't know the loud
// part coming, so the ceiling holds it (quiet, then 6x louder: a fixed gain from the quiet part
// would overshoot to ~3)
test('stream: adaptive normalize and match start early; the ceiling guards what they have not heard', async t => {
  let Q = Float32Array.from({ length: SR * 6 }, (_, i) => (i < SR * 3 ? 0.08 : 0.5) * Math.sin(2 * Math.PI * 300 * i / SR))
  for (let [name, chain, peak] of [
    ["normalize(-6, {adaptive})", a => a.normalize(-6, { adaptive: true }), 10 ** (-6 / 20)],
    ["normalize('podcast', {adaptive})", a => a.normalize('podcast', { adaptive: true }), 10 ** (-1 / 20)],
    ['match(ref, 1 s lookahead)', a => a.match(B(), { lookahead: 1 }), Infinity],
  ]) {
    let { out, first } = await live(chain, Q)
    t.ok(first <= 1.5, `${name}: first output after ${first.toFixed(1)} s`)
    t.is(out.length, Q.length, `${name}: full length`)
    if (peak < Infinity) { let p = out.reduce((m, v) => Math.max(m, Math.abs(v)), 0); t.ok(p <= peak * 1.02, `${name}: peak ${p.toFixed(3)} ≤ ${peak.toFixed(3)}`) }
  }
})

// Stats after a filter accumulate as the stage renders: once, not once per recompile
test('stream: a filtered stage renders its stats once, however often the plan recompiles', async t => {
  let rendered = 0, session = audio.statSession
  audio.statSession = (...args) => { let s = session(...args), page = s.page; s.page = p => (rendered += p[0].length, page.call(s, p)); return s }
  try {
    let { out } = await live(a => a.highpass(80).trim(-40))
    t.ok(out.length > 0, 'trimmed output')
    t.ok(rendered <= 2.05 * X.length, `stat pages ${(rendered / X.length).toFixed(2)}× the input (source + stage)`)
  } finally { audio.statSession = session }
})

// Byte streams decode as they arrive: a pipe, a socket, a response body
test('stream: a byte stream decodes as it arrives', async t => {
  let bytes = await audio.from([X], { sampleRate: SR }).encode('wav'), fed = 0, at = null, n = 0
  let chunks = (async function* () { for (let o = 0; o < bytes.length; o += 4096) { fed = o; yield bytes.subarray(o, o + 4096); await pause() } fed = bytes.length })()
  for await (let b of audio(chunks).gain(-3).stream()) { at ??= fed; n += b[0].length }
  t.ok(at < bytes.length / 2, `first output after ${at} of ${bytes.length} bytes`)
  t.is(n, X.length)
})

// Every byte-source shape decodes to the same samples, however the header is split; nothing hangs
test('stream: byte sources: header split in tiny chunks, response body, empty and garbage', async t => {
  let bytes = await audio.from([X], { sampleRate: SR }).encode('wav'), [ref] = await audio.from([X], { sampleRate: SR }).read()
  const pcm = async src => (await (await audio(src)).read())[0]
  const eq = (a, b) => a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) < 1e-4)
  let sizes = [1, 3, 7, 1, 4096]  // the 12-byte sniff spans five chunks
  let split = (async function* () { let o = 0; for (let k of sizes) { yield bytes.subarray(o, o + k); o += k } yield bytes.subarray(o) })()
  t.ok(eq(await pcm(split), ref), 'header in 1/3/7/1-byte chunks')
  t.ok(eq(await pcm(new Response(bytes)), ref), 'Response')
  t.ok(eq(await pcm(new Response(bytes).body), ref), 'ReadableStream')
  let one = (async function* () { yield bytes.subarray(0, 44 + 2) })()  // header + one sample
  t.is((await pcm(one)).length, 1, 'smallest: one sample')
  await t.rejects(audio((async function* () {})()), /./, 'empty stream rejects')
  await t.rejects(audio((async function* () { yield new Uint8Array(64).fill(7) })()), /./, 'garbage rejects')
})

// read() waits for what it asks: a range as the stream settles it, all of it at the end
test('stream: read() of a live source waits for its range, or for the end', async t => {
  let src = audio(null, { sampleRate: SR, channels: 1 }), t0 = Date.now()
  let ranged = src.read({ at: 0.5, duration: 1 }).then(p => [p[0].length, Date.now() - t0])
  let whole = src.read().then(p => [p[0].length, Date.now() - t0])
  for (let o = 0; o < X.length; o += CHUNK) { src.push(X.slice(o, o + CHUNK)); await pause() }
  let [n, at] = await ranged
  t.is(n, SR, 'ranged: its samples')
  let stopped = Date.now() - t0
  t.ok(at <= stopped, 'ranged: resolved while the stream was still live')
  src.stop()
  let [m] = await whole
  t.is(m, X.length, 'unranged: all of it, once stopped')
})

// A file or bytes still decoding: read() without awaiting the source returns all of it, not what
// had decoded so far (it returned 0 samples), and a range returns exactly the range
test('stream: read() of a source still decoding returns what it asks for', async t => {
  let bytes = await audio.from([X], { sampleRate: SR }).encode('wav')
  t.is((await audio(bytes).read())[0].length, X.length, 'all of it')
  t.is((await audio(bytes).read({ at: 1, duration: 0.5 }))[0].length, SR / 2, 'a range')
  t.is((await audio(bytes).read({ at: -1 }))[0].length, SR, 'a range from the end')
})

// Disposing a source still reading an open Node stream ends it: the stream destroyed, decode settled
test('stream: dispose() ends a Node stream source that is still open', async t => {
  let { PassThrough } = await import('node:stream')
  let bytes = await audio.from([X], { sampleRate: SR }).encode('wav'), pt = new PassThrough()
  pt.write(Buffer.from(bytes.subarray(0, 4000)))   // some bytes, then nothing: upstream stays open
  let a = audio(pt)
  await new Promise(r => setTimeout(r, 100))
  a.dispose()
  let settled = await Promise.race([a.ready.then(() => true, () => true), new Promise(r => setTimeout(() => r(false), 1000))])
  t.ok(pt.destroyed, 'source destroyed')
  t.ok(settled, 'decode settled')
})

// A live save streams (bounded memory) and patches its header where it can seek: exact totals
test('stream: a live save writes as it goes, headers exact once it ends (wav sizes, flac STREAMINFO)', async t => {
  let { mkdtempSync, readFileSync, rmSync } = await import('node:fs'), { tmpdir } = await import('node:os'), { join } = await import('node:path')
  let dir = mkdtempSync(join(tmpdir(), 'audio-stream-'))
  try {
    for (let fmt of ['wav', 'flac']) {
      let src = audio(null, { sampleRate: SR, channels: 1 }), path = join(dir, 'live.' + fmt)
      let saving = src.gain(-3).save(path)
      for (let o = 0; o < X.length; o += CHUNK) { src.push(X.slice(o, o + CHUNK)); await pause() }
      src.stop(); await saving
      let b = readFileSync(path)
      if (fmt === 'wav') t.is(b.readUInt32LE(4), b.length - 8, 'wav: RIFF size exact')
      else t.is((b[21] & 15) * 2 ** 32 + b.readUInt32BE(22), X.length, 'flac: STREAMINFO total samples')
      t.is((await audio(path)).length, X.length, fmt + ': reads back whole')
    }
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

// The CLI passes a pipe through as it arrives: the first bytes out before the input ends
test('stream: CLI stdin → stdout streams (first output before EOF)', { timeout: 30000 }, async t => {
  let { spawn } = await import('node:child_process'), { fileURLToPath } = await import('node:url')
  let bytes = await audio.from([Float32Array.from({ length: SR * 10 }, (_, i) => 0.3 * Math.sin(i / 7))], { sampleRate: SR }).encode('wav')
  let p = spawn(process.execPath, [fileURLToPath(new URL('../bin/cli.js', import.meta.url)), 'gain', '-3db', 'save', '-'], { stdio: ['pipe', 'pipe', 'ignore'] })
  let first = null, fed = 0, n = 0
  p.stdout.on('data', d => { first ??= fed; n += d.length })
  let closed = new Promise(r => p.on('close', r))
  for (let o = 0; o < bytes.length; o += 8000) { p.stdin.write(bytes.subarray(o, o + 8000)); fed = o + 8000; await new Promise(r => setTimeout(r, 20)) }
  p.stdin.end(); await closed
  t.ok(first != null && first < bytes.length, `first output after ${first} of ${bytes.length} bytes in`)
  t.ok(n > bytes.length * 0.9, 'all of it out')
})

// Waiting for the whole input today: the only list allowed to hold such ops, and only to shrink
const WHOLE = {
  'reverse()': [a => a.reverse(), 'inherent: the last sample plays first'],
  'trim()': [a => a.trim(), 'inherent: the automatic threshold reads the whole input'],
  'shrink()': [a => a.shrink(), 'inherent: the automatic threshold reads the whole input'],
  'normalize(-6)': [a => a.normalize(-6), 'inherent: one gain for the whole selection'],
  'copy(1, 1).paste(3)': [a => a.copy(1, 1).paste(3), 'clipboard captures at the end of decode'],
  // registry atoms declared streaming: false, for their batch kernels (whole-signal oversampling,
  // state built per call, one-call synthesis); each moves out as its atom gains a streaming form
  ...Object.fromEntries(['softclip', 'leveler', 'auto', 'declick', 'declip', 'decrackle', 'debreath', 'tapestop', 'tube', 'fm', 'modal', 'surround', 'paulstretch', 'pitch-shift', 'tune', 'plate', 'fdn', 'spring', 'shimmer', 'multiband', 'dyneq', 'tape', 'transistor', 'waveshaper', 'multisat', 'amp', 'cabinet', 'noise', 'chirp', 'pluck', 'risset', 'rhythm', 'sfx', 'kick', 'cymbal', 'snare', 'adsr', 'voice', 'poly', 'stretch-pvoc-lock', 'stretch-pvoc', 'stretch-pghi', 'stretch-wsola', 'stretch-psola', 'stretch-sms', 'stretch-transient', 'stretch-hybrid', 'stretch-paul'].map(n => [`${n}()`, [a => a[n](), 'atom declared streaming: false']])),
}

for (let [call, [chain, why]] of Object.entries(WHOLE)) test(`stream: waits for the whole input: ${call} (${why})`, async t => {
  let { first } = await live(chain, X.subarray(0, SR * 3), 2)
  t.ok(first >= 3, first >= 3 ? 'still waits' : `streams now (first output after ${first.toFixed(1)} s): remove it from WHOLE`)
})

test.todo('stream: a day-long stream runs in bounded memory (pages consumed, stats kept as running aggregates)')
