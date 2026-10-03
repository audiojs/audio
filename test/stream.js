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
// registry plugins load before the clock starts: input goes in at 100 times real time (0.1 s a millisecond), so a
// plugin's first import would count as seconds of latency; what is measured is the stream's own
await audio.use('limiter', 'compressor', 'freeverb')

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
  'stretch(1.25, { voice: true })': [a => a.stretch(1.25, { voice: true }), 0.5],
  'remix(2), crossover': [a => a.remix(2).crossover(1000), 0.4],
  'spectral([200, 400], -20, 1 s at 1 s)': [a => a.spectral([200, 400], -20, { at: 1, duration: 1 }), 0.6],
  'spectral 1 s at -2 s: placed once the end is known': [a => a.spectral([200, 400], -20, { at: -2, duration: 1 }), Infinity],
  'repair(50 ms at 1 s)': [a => a.repair({ at: 1, duration: 0.05 }), 1.3],
  'repair(50 ms at -1.5 s)': [a => a.repair({ at: -1.5, duration: 0.05 }), Infinity],
  'repair(1 s at 3.6 s): a transplant searched in the past adds no latency': [a => a.repair({ at: 3.6, duration: 1 }), 2.1],
  'denoise(noise 0.5 s at 1 s): learned once the range has arrived': [a => a.denoise({ noise: { at: 1, duration: 0.5 } }), 1.7],
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
  let first = null, fed = 0, n = 0, out = new Promise(r => p.stdout.once('data', r))
  p.stdout.on('data', d => { first ??= fed; n += d.length })
  let closed = new Promise(r => p.on('close', r))
  for (let o = 0; o < bytes.length; o += 8000) { p.stdin.write(bytes.subarray(o, o + 8000)); fed = Math.min(o + 8000, bytes.length); await new Promise(r => setTimeout(r, 20)) }
  // a loaded machine can take longer to start the CLI than the input takes to send: EOF waits for the first output, 10 s at most
  await Promise.race([out, new Promise(r => setTimeout(r, 10000).unref())])
  let early = first != null
  p.stdin.end(); await closed
  t.ok(early, `first output before EOF, after ${first} of ${bytes.length} bytes in`)
  t.ok(n > bytes.length * 0.9, 'all of it out')
})

// An edit while streaming changes what renders at the playhead: the old render crossfades into the new one over
// ~20 ms (linear), so a cut, an insert or an op added mid-stream never steps the signal
test('stream: an edit that changes the render mid-stream crossfades into it, no step', async t => {
  // the largest step between samples: the sine's, and the crossfade's own (at most 2A over its length); a cut
  // without it steps by up to 2A
  let f = 300, A = 0.4, fade = Math.round(SR * 0.02), slope = 2 * Math.PI * f * A / SR + 2 * A / fade
  let steps = x => { let m = 0; for (let i = 1; i < x.length; i++) m = Math.max(m, Math.abs(x[i] - x[i - 1])); return m }
  const run = async edit => {
    let a = audio.from(t => A * Math.sin(2 * Math.PI * f * t), { duration: 3, sampleRate: SR }), out = [], n = 0
    for await (let b of a.stream()) { out.push(...b[0]); if (++n === 4) edit(a) }
    return { out, a }
  }
  // a cut behind the playhead: the sound under it jumps by 0.2537 s (a phase jump for this sine)
  let { out, a } = await run(a => a.remove({ at: 0.1, duration: 0.2537 }))
  let at = 4 * 1024
  t.ok(steps(out) <= slope, `cut: largest step ${steps(out).toFixed(3)} ≤ ${slope.toFixed(3)}`)
  let [after] = await a.read({ at: (at + fade) / SR })
  t.ok(same(out.slice(at + fade), after), 'after the crossfade: the edited render, sample for sample')
  t.is(out.length, at + fade + after.length, 'length follows the edit')
  // an op added: from the old chain's output (not the dry signal) into the new chain's
  ;({ out } = await run(a => a.gain(-6).highpass(20)))
  let before = await run(() => {}), max = 0
  for (let i = at; i < at + fade; i++) max = Math.max(max, Math.abs(out[i]))
  t.ok(max <= A * 1.01, `op added: no level above the source through the fade (${max.toFixed(3)})`)
  t.ok(steps(out) <= slope, `op added: largest step ${steps(out).toFixed(3)}`)
  t.ok(before.out.length === out.length, 'op added: same length')
})

// Edits closer together than the crossfade: the second waits for the first's crossfade, and both are heard; an edit
// that ends the audio where it plays ends the stream there
test('stream: two edits within one crossfade both land; one ending the audio where it plays ends the stream', async t => {
  let sine = () => audio.from(t => .4 * Math.sin(2 * Math.PI * 300 * t), { duration: 3, sampleRate: SR }), at = 4 * 1024, fade = Math.round(SR * 0.02)
  let a = sine(), out = [], n = 0
  for await (let b of a.stream()) { out.push(...b[0]); if (++n === 4) { a.gain(-6); a.remove({ at: 0.1, duration: 0.25 }) } }
  let [after] = await sine().gain(-6).remove({ at: 0.1, duration: 0.25 }).read({ at: (at + 2 * fade) / SR })
  t.ok(same(out.slice(at + 2 * fade), after), 'after both crossfades: the render with both edits, sample for sample')
  t.is(out.length, at + 2 * fade + after.length, 'its length, both edits')
  let c = sine(), got = 0
  n = 0
  for await (let b of c.stream()) { got += b[0].length; if (++n === 4) c.crop({ at: 0, duration: at / SR }) }
  t.is(got, at, 'nothing past the new end')
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

// A copy made while its source decodes (clone, audio.from) reads the pages as they land and ends with the source:
// it streams, edited, as the whole file renders; disposing it leaves the source whole.
const slowly = bytes => (async function* () { for (let o = 0; o < bytes.length; o += 4096) { await pause(); yield bytes.subarray(o, o + 4096) } })()
test('stream: a copy of a source still decoding follows it and ends with it', async t => {
  let bytes = await audio.from([X], { sampleRate: SR }).encode('wav', { bitDepth: 32 })
  let src = audio(slowly(bytes)), copy = src.clone(), edited = src.clone().gain(-6), twice = src.clone().clone(), plain = audio.from(src)
  // a rate asked for stays the copy's; the samples still follow
  let faster = audio.from(src, { sampleRate: SR * 2 })
  t.is(copy.decoded, false, 'follows while its source arrives')
  let out = []
  for await (let b of edited.stream()) out.push(...b[0])
  t.ok(src.decoded && copy.decoded && edited.decoded && twice.decoded && plain.decoded, 'ends with it')
  t.is([copy.sampleRate, copy.channels], [SR, 1], 'the rate and channels its header brought')
  let whole = (await audio.from([X], { sampleRate: SR }).gain(-6).read())[0]
  t.ok(out.length === whole.length && out.every((v, i) => Math.abs(v - whole[i]) < 1e-6), 'streamed as the whole file renders')
  for (let [name, a] of [['clone', copy], ['clone of a clone', twice], ['audio.from', plain]]) t.is((await a.read())[0].length, X.length, name)
  t.is([faster.sampleRate, faster.length], [SR * 2, X.length], 'its own rate, the source\'s samples')
  copy.dispose()
  t.is((await src.read())[0].length, X.length, 'disposing the copy leaves the source whole')
})

test('stream: a copy of a source that fails fails too; one whose source is disposed ends with it', async t => {
  let bad = audio(slowly(new Uint8Array(20000).fill(7))), copy = bad.clone()
  let failed = await copy.read().then(() => null, e => e)
  t.ok(failed instanceof Error, `reading it rejects: ${failed?.message}`)
  let bytes = await audio.from([X], { sampleRate: SR }).encode('wav', { bitDepth: 32 })
  let src = audio(slowly(bytes)), follower = src.clone(), got = 0
  for await (let b of follower.stream()) { got += b[0].length; if (got >= SR) src.dispose() }
  t.ok(got >= SR && got < X.length, `its stream ended where the source was disposed: ${got} of ${X.length}`)
  t.ok(follower._.disposed, 'and it is disposed as its source is')
})

// How long a stream lasts, known from its header before it has arrived (metadata's estDuration): a WAV or AIFF data
// size, FLAC's sample count, an MP3's Xing/Info frame count or, at a constant bitrate, its first frame's rate; the
// size-free ones with no length said for the bytes either. MPEG-1 Layer III frames (ISO/IEC 11172-3 §2.4.2.3): 1152
// samples, 144000 · kbps / Hz bytes plus a padding byte.
test('stream: how long a stream lasts is known from its header before it arrives', async t => {
  let x = Float32Array.from({ length: 44100 * 7.3 }, (_, i) => .3 * Math.sin(i / 20) * Math.sin(i / 3000))
  let estimate = async (bytes, size = true) => {
    let a = audio(new Response(new Blob([bytes]).stream(), size ? { headers: { 'content-length': String(bytes.length) } } : {})), e = null
    a.on('metadata', m => e = m.estDuration)
    await a
    return [e, a.duration]
  }
  for (let [type, opts] of [['wav', {}], ['wav', { bitDepth: 24 }], ['flac', {}], ['aiff', {}], ['mp3', {}], ['mp3', { bitrate: 64 }]]) {
    let bytes = await audio.from([x, x], { sampleRate: 44100 }).encode(type, opts)
    let [e, d] = await estimate(bytes)
    t.ok(Math.abs(e - d) < 1e-3, `${type} ${JSON.stringify(opts)}: ${e} s, is ${d} s`)
    if (type === 'aiff' || opts.bitrate) continue
    ;[e, d] = await estimate(bytes, false)
    // the MP3's Info frame counts its frames (LAME's delay and padding off), so it needs no size either
    t.ok(Math.abs(e - d) < 1e-3, `${type} ${JSON.stringify(opts)}, no length said: ${e} s, is ${d} s`)
  }
  // a constant-bitrate MP3 without its Info frame, bare and after an ID3v2 tag of 3000 bytes: its first frame's rate
  let mp3 = await audio.from([x, x], { sampleRate: 44100 }).encode('mp3', { bitrate: 128 })
  let frame = (h, o) => Math.floor(144000 * [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320][h[o + 2] >> 4] / 44100) + (h[o + 2] >> 1 & 1)
  let o = 0
  while (!(mp3[o] === 0xff && (mp3[o + 1] & 0xe0) === 0xe0)) o++
  let bare = new Uint8Array([...mp3.subarray(0, o), ...mp3.subarray(o + frame(mp3, o))])
  let tag = new Uint8Array(3010); tag.set([0x49, 0x44, 0x33, 4, 0, 0, 0, 0, 3000 >> 7, 3000 & 127])
  for (let [name, bytes] of [['bare', bare], ['after ID3v2', new Uint8Array([...tag, ...bare])]]) {
    let [e, d] = await estimate(bytes)
    t.ok(Math.abs(e - d) < 0.03, `CBR mp3, ${name}: ${e} s, is ${d} s`)
  }
  // with no frame count, only the size gives the length by its bitrate: unknown, not guessed
  t.is((await estimate(bare, false))[0], null, 'CBR mp3, bare, no length said: not known')
  // FFmpeg writes LAME's tag under its own name (Lavc, Lavf): the same delay and padding
  let lavc = mp3.slice(), lame = Buffer.from(lavc).indexOf('LAME')
  lavc.set([0x4c, 0x61, 0x76, 0x63], lame)
  let [le, ld] = await estimate(lavc, false)
  t.ok(lame > 0 && Math.abs(le - ld) < 1e-3, `mp3 with FFmpeg's tag name: ${le} s, is ${ld} s`)
  // a Xing (flags: frame count) or VBRI frame ahead of the audio, 32 bytes of side information into a stereo MPEG-1
  // frame: its frame count, with no size said
  let count = 0
  for (let p = 0; p + 4 <= mp3.length && mp3[p] === 0xff; p += frame(mp3, p)) count++
  for (let name of ['Xing', 'VBRI']) {
    let head = new Uint8Array(frame(mp3, 0)), v = new DataView(head.buffer)
    head.set(mp3.subarray(0, 4))
    head.set([...name].map(c => c.charCodeAt(0)), 36)
    if (name === 'Xing') { v.setUint32(40, 1); v.setUint32(44, count) } else v.setUint32(50, count)
    let [e] = await estimate(new Uint8Array([...head, ...mp3]), false)
    t.is(e, count * 1152 / 44100, `${name}: its ${count} frames of 1152 samples`)
  }
  // a WAV written to a pipe, its data size unknown (all ones): the rest of the file, when its size is said
  let piped = await audio.from([x], { sampleRate: 44100 }).encode('wav'), at = Buffer.from(piped).indexOf('data')
  new DataView(piped.buffer, piped.byteOffset).setUint32(at + 4, 0xffffffff, true)
  let [pe, pd] = await estimate(piped)
  t.ok(Math.abs(pe - pd) < 1e-3, `wav of unknown data size: ${pe} s, is ${pd} s`)
  t.is((await estimate(piped, false))[0], null, 'and with no size said, not known')
  // the smallest WAV there is: one sample
  let [e, d] = await estimate(await audio.from([Float32Array.of(.5)], { sampleRate: 8000 }).encode('wav'))
  t.is([e, d], [1 / 8000, 1 / 8000], 'one sample')
})
