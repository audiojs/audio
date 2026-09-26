/**
 * Regression tests for the 2026-07 plan-engine rework:
 * reversed-segment math (segSrcStart), per-stage pipeline buffers (remix chains),
 * resolve-stage stat remapping, ref loading/rates, engine automation/range scoping,
 * mid-stream edits, serialization, guards.
 */
import test from 'tst'
import { tone as genTone } from './gen.js'
import audio from '../audio.js'

const ramp = n => { let ch = new Float32Array(n); for (let i = 0; i < n; i++) ch[i] = i; return ch }
const tone = (freq, dur, sr = 44100, amp = 1) => genTone(freq, dur, amp, sr)
const rms = buf => { let s = 0; for (let v of buf) s += v * v; return Math.sqrt(s / buf.length) }
const arrEq = (a, b) => a.length === b.length && [...a].every((v, i) => v === b[i])

// Reference model: apply reverse/crop/etc. on plain arrays
const refReverse = (arr, at, dur) => { let a = [...arr]; let seg = a.slice(at, at + dur).reverse(); a.splice(at, dur, ...seg); return a }

test('reverse + crop (asymmetric window inside reversed range)', async t => {
  let a = audio.from([ramp(20)], { sampleRate: 1 })
  a.reverse({ at: 1, duration: 8 }).crop({ at: 4, duration: 3 })
  let out = [...(await a.read())[0]]
  let expect = refReverse([...ramp(20)], 1, 8).slice(4, 7)
  t.ok(arrEq(out, expect), JSON.stringify([...out].slice(0,12))) // [5,4,3]
})

test('reverse + remove (split inside reversed range)', async t => {
  let a = audio.from([ramp(20)], { sampleRate: 1 })
  a.reverse({ at: 1, duration: 8 }).remove({ at: 3, duration: 4 })
  let ref = refReverse([...ramp(20)], 1, 8); ref.splice(3, 4)
  t.ok(arrEq([...(await a.read())[0]], ref), JSON.stringify([...[...(await a.read())[0]]].slice(0,12)))
})

test('reverse + insert (split preserves reversed content order)', async t => {
  let a = audio.from([ramp(20)], { sampleRate: 1 })
  a.reverse({ at: 1, duration: 8 }).insert(audio.from([new Float32Array([-1, -1])], { sampleRate: 1 }), { at: 4 })
  let ref = refReverse([...ramp(20)], 1, 8); ref.splice(4, 0, -1, -1)
  t.ok(arrEq([...(await a.read())[0]], ref), JSON.stringify([...[...(await a.read())[0]]].slice(0,12))) // [...,6,-1,-1,5,...]
})

test('nested reverse (asymmetric sub-range un-reverses)', async t => {
  let a = audio.from([ramp(20)], { sampleRate: 1 })
  a.reverse({ at: 1, duration: 8 }).reverse({ at: 4, duration: 3 })
  let ref = refReverse(refReverse([...ramp(20)], 1, 8), 4, 3)
  t.ok(arrEq([...(await a.read())[0]], ref), JSON.stringify([...[...(await a.read())[0]]].slice(0,12))) // [0,8,7,6,3,4,5,2,1,9,...]
})

test('repeat straddling a reversed range', async t => {
  let a = audio.from([ramp(20)], { sampleRate: 1 })
  a.reverse({ at: 1, duration: 8 }).repeat(1, { at: 2, duration: 4 })
  let ref = refReverse([...ramp(20)], 1, 8)
  let rep = ref.slice(2, 6); ref.splice(6, 0, ...rep)
  t.ok(arrEq([...(await a.read())[0]], ref), JSON.stringify([...[...(await a.read())[0]]].slice(0,12)))
})

test('remix chained with 2+ process ops (per-stage buffers)', async t => {
  let sr = 44100
  let a = audio.from([tone(440, 1, sr), tone(220, 1, sr)], { sampleRate: sr })
  a.remix(1).highpass(200).gain(-3)
  let read = await a.read()
  t.is(read.length, 1, 'downmix to mono survives 2 subsequent ops')
  let streamed = []
  for await (let chunk of a.stream()) streamed.push(chunk[0].slice())
  let total = streamed.reduce((s, c) => s + c.length, 0)
  t.is(total, read[0].length, 'stream length matches read')
  // stream ≡ read
  let flat = new Float32Array(total), p = 0
  for (let c of streamed) { flat.set(c, p); p += c.length }
  let maxDiff = 0
  for (let i = 0; i < flat.length; i++) maxDiff = Math.max(maxDiff, Math.abs(flat[i] - read[0][i]))
  t.ok(maxDiff < 1e-3, `stream≡read maxDiff ${maxDiff}`)

  // widening remix: mono → stereo then two ops
  let b = audio.from([tone(440, 0.5, sr)], { sampleRate: sr })
  b.remix(2).lowpass(2000).gain(-1)
  let rb = await b.read()
  t.is(rb.length, 2, 'upmix to stereo survives 2 subsequent ops')
})

test('trim after crop is a no-op (stats remapped to output space)', async t => {
  let BS = audio.BLOCK_SIZE
  audio.BLOCK_SIZE = 100
  try {
    let ch = new Float32Array(300)
    for (let i = 100; i < 200; i++) ch[i] = 0.5 * Math.sin(2 * Math.PI * 50 * (i - 100) / 1000)
    let a = audio.from([ch], { sampleRate: 1000 })
    a.crop({ at: 0.1, duration: 0.1 }).trim()
    t.is((await a.read())[0].length, 100, 'crop already isolated the loud block — trim removes nothing')
  } finally { audio.BLOCK_SIZE = BS }
})

test('normalize after crop measures cropped range only', async t => {
  let ch = new Float32Array(3000)
  for (let i = 2000; i < 3000; i++) ch[i] = 0.1 * Math.sin(2 * Math.PI * 100 * i / 1000)
  let a = audio.from([ch], { sampleRate: 1000 })
  a.crop({ at: 2 }).normalize({ mode: 'rms', target: -6 })
  let out = (await a.read())[0]
  let db = 20 * Math.log10(rms(out))
  t.ok(Math.abs(db - -6) < 0.2, `post-crop RMS ${db.toFixed(2)} dB ≈ target -6 dB`)
})

test('insert foreign-sample-rate source: duration + pitch preserved', async t => {
  let target = audio.from([new Float32Array(2 * 44100)], { sampleRate: 44100 })
  let foreign = audio.from([tone(440, 1, 22050)], { sampleRate: 22050 })
  target.insert(foreign, { at: 0.5 })
  t.is(target.duration, 3, 'inserted 1s stays 1s at target rate')
  let out = (await target.read())[0]
  // zero-crossing pitch probe over the inserted middle second
  let seg = out.subarray(Math.round(0.6 * 44100), Math.round(1.4 * 44100))
  let zc = 0
  for (let i = 1; i < seg.length; i++) if (seg[i - 1] < 0 && seg[i] >= 0) zc++
  let freq = zc / (seg.length / 44100)
  t.ok(Math.abs(freq - 440) < 10, `inserted tone reads ~440Hz (got ${freq.toFixed(1)}), not 880`)
})

test('mix foreign-sample-rate source occupies real duration', async t => {
  let base = audio.from([new Float32Array(44100)], { sampleRate: 44100 })
  let src = audio.from([tone(440, 1, 22050, 0.5)], { sampleRate: 22050 })
  base.mix(src)
  let out = (await base.read())[0]
  let last = out.length - 1
  while (last > 0 && out[last] === 0) last--
  t.ok(last > 44000, `mixed content spans the full second (last nonzero at ${last})`)
})

test('insert awaits a still-decoding ref (loadRefs)', async t => {
  let ref = audio('test/fixture.wav')  // async decode, not awaited
  let main = audio.from([new Float32Array(10)], { sampleRate: 44100 })
  main.insert(ref, { at: 0 })
  let out = await main.read()
  t.ok(out[0].length > 10, `inserted ref contributes samples (len ${out[0].length})`)
  let nonzero = out[0].some(v => v !== 0)
  t.ok(nonzero, 'inserted region carries the ref PCM, not silence')
})

test('circular source reference throws instead of stack overflow', async t => {
  let a = audio.from([tone(440, 0.1)], { sampleRate: 44100 })
  a.insert(a)
  let err = null
  try { await a.read() } catch (e) { err = e }
  t.ok(/circular/.test(err?.message), `throws circular-ref error (got: ${err?.message})`)
})

test('toJSON keeps edits with instance sources', t => {
  let a = audio.from([tone(440, 0.2)], { sampleRate: 44100 })
  let src = audio.from([tone(220, 0.1)], { sampleRate: 44100 })
  a.mix(src, { at: 0 })
  t.is(a.toJSON().edits.length, 1, 'mix edit survives serialization')
  let b = audio.from([tone(440, 0.2)], { sampleRate: 44100 })
  b.gain(t2 => Math.sin(t2))  // function-valued edit still omitted
  t.is(b.toJSON().edits.length, 0)
})

test('speed/stretch honor {at, duration}', async t => {
  let a = audio.from([tone(440, 1)], { sampleRate: 44100 })
  a.speed(2, { at: 0.4, duration: 0.2 })
  t.ok(Math.abs(a.duration - 0.9) < 0.01, `ranged speed(2) → 0.9s (got ${a.duration.toFixed(3)})`)

  let b = audio.from([tone(440, 1)], { sampleRate: 44100 })
  b.stretch(2, { at: 0, duration: 0.5 })
  t.ok(Math.abs(b.duration - 1.5) < 0.02, `ranged stretch(2) → 1.5s (got ${b.duration.toFixed(3)})`)
})

test('mid-stream edits apply to an in-flight stream of decoded audio', async t => {
  let a = audio.from([tone(440, 10 * 1024 / 44100)], { sampleRate: 44100 })
  let maxAbs = [], i = 0
  for await (let chunk of a.stream()) {
    let m = 0; for (let v of chunk[0]) m = Math.max(m, Math.abs(v))
    maxAbs.push(m)
    if (++i === 2) a.gain(-100)
  }
  t.ok(maxAbs[0] > 0.4, 'pre-edit chunks at full level')
  t.ok(maxAbs.at(-1) < 1e-4, `post-edit chunks attenuated (last ${maxAbs.at(-1)})`)
})

test('mid-stream parameter patches update range, zero duration and channel through the final sample', async t => {
  const sr = 48000, n = audio.BLOCK_SIZE, gain = 10 ** (-6 / 20)
  const a = audio.from([new Float32Array(5 * n + 1).fill(.25), new Float32Array(5 * n + 1).fill(.5)], { sampleRate: sr })
  a.gain(-6, { at: 4 * n / sr, duration: n / sr, channel: 0 })
  const stream = a.stream()
  const check = (chunk, left, right, label) => {
    t.ok(chunk[0].every((value, i) => Math.abs(value - left(i)) < 1e-7), label + ': left samples')
    t.ok(chunk[1].every((value, i) => Math.abs(value - right(i)) < 1e-7), label + ': right samples')
  }
  check((await stream.next()).value, () => .25, () => .5, 'before range')
  a.undo(); a.gain(-6, { at: 1.5 * n / sr, duration: .5 * n / sr, channel: 1 })
  check((await stream.next()).value, () => .25, i => i < n / 2 ? .5 : .5 * gain, 'moved half-block range and channel')
  a.undo(); a.gain(-6, { at: 2 * n / sr, duration: 0 })
  check((await stream.next()).value, () => .25, () => .5, 'empty range')
  a.undo(); a.gain(-6, { at: -(n + 1) / sr, channel: 0 })
  check((await stream.next()).value, () => .25, () => .5, 'before negative range')
  check((await stream.next()).value, () => .25 * gain, () => .5, 'negative range with duration removed')
  const last = (await stream.next()).value
  t.is(last[0].length, 1, 'partial final block')
  check(last, () => .25 * gain, () => .5, 'final sample')
  t.ok((await stream.next()).done, 'ends exactly after the final sample')
  a.dispose()
})

test('stream boundaries: zero work, EOF, final sample and replay around one block', async t => {
  const sr = 48000, gain = 10 ** (-6 / 20)
  for (const n of [1, audio.BLOCK_SIZE - 1, audio.BLOCK_SIZE, audio.BLOCK_SIZE + 1]) {
    const pcm = Float32Array.from({ length: n }, (_, i) => (i + 1) / (n + 1))
    const a = audio.from([pcm], { sampleRate: sr }).gain(-6)
    const collect = async opts => {
      const result = []
      for await (const chunk of a.stream(opts)) result.push(...chunk[0])
      return result
    }
    t.is((await collect({ duration: 0 })).length, 0, `${n}: zero-duration request`)
    t.is((await collect({ at: n / sr })).length, 0, `${n}: request at EOF`)
    const last = await collect({ at: (n - 1) / sr, duration: 1 / sr })
    t.is(last.length, 1, `${n}: final sample only`)
    t.ok(Math.abs(last[0] - pcm[n - 1] * gain) < 1e-7, `${n}: final sample value`)
    const first = await collect(), second = await collect()
    t.is(first.length, n, `${n}: complete stream length after empty requests`)
    t.ok(first.every((value, i) => Math.abs(value - pcm[i] * gain) < 1e-7), `${n}: exact gained samples`)
    t.ok(arrEq(first, second), `${n}: replay is identical`)
    a.dispose()
  }
})

test('flat read guard: huge virtual length throws instead of allocating', async t => {
  let a = audio.from([new Float32Array(1e6)], { sampleRate: 44100 })
  a.repeat(600)  // 601M virtual samples > 2^29
  let err = null
  try { await a.read() } catch (e) { err = e }
  t.ok(/too large/i.test(err?.message), `read() refuses flat render (${err?.message})`)
})

test('NaN op params throw at call time', t => {
  let a = audio.from([tone(440, 0.1)], { sampleRate: 44100 })
  let err = null
  try { a.gain(NaN) } catch (e) { err = e }
  t.ok(/NaN/.test(err?.message), 'gain(NaN) rejected')
})

test('engine range scoping: dither/lowpass leave out-of-range samples bit-exact', async t => {
  let sr = 44100
  let src = tone(440, 1, sr, 0.5)
  let a = audio.from([src.slice()], { sampleRate: sr })
  a.dither(8, { at: 0.5 })
  let out = (await a.read())[0]
  let pre = Math.round(0.4 * sr)
  let same = true
  for (let i = 0; i < pre; i++) if (out[i] !== src[i]) { same = false; break }
  t.ok(same, 'samples before {at} untouched by dither')
  let changed = false
  for (let i = Math.round(0.6 * sr); i < Math.round(0.7 * sr); i++) if (out[i] !== src[i]) { changed = true; break }
  t.ok(changed, 'samples inside range are dithered')

  let b = audio.from([src.slice()], { sampleRate: sr })
  b.lowpass(200, { at: 0.5 })
  let ob = (await b.read())[0]
  let same2 = true
  for (let i = 0; i < pre; i++) if (ob[i] !== src[i]) { same2 = false; break }
  t.ok(same2, 'samples before {at} untouched by lowpass')
  t.ok(rms(ob.subarray(Math.round(0.6 * sr), sr)) < rms(src.subarray(Math.round(0.6 * sr), sr)) * 0.5,
    '440Hz tone attenuated inside lowpass(200) range')
})

test('filter automation: function-valued freq sweeps the cutoff', async t => {
  let sr = 44100
  let a = audio.from([tone(4000, 1, sr, 0.5)], { sampleRate: sr })
  // sweep cutoff from wide open (10kHz) down to 100Hz — tail must be attenuated
  a.lowpass(t2 => 10000 - 9900 * Math.min(1, t2))
  let out = (await a.read())[0]
  let head = rms(out.subarray(0, Math.round(0.2 * sr)))
  let tail = rms(out.subarray(Math.round(0.8 * sr)))
  t.ok(head > 0.2, `head passes 4kHz under 10kHz cutoff (rms ${head.toFixed(3)})`)
  t.ok(tail < head * 0.2, `tail attenuated as cutoff sweeps below 4kHz (rms ${tail.toFixed(4)})`)
})

test('crossfade "equal" curve holds power constant for uncorrelated signals', async t => {
  // Equal-power law g1=cos(xπ/2), g2=sin(xπ/2): g1²+g2²=1 (W3C Web Audio equal-power panning)
  let sr = 44100
  let a = audio.from([tone(440, 1, sr, 0.8)], { sampleRate: sr })
  let b = audio.from([tone(1000, 1, sr, 0.8)], { sampleRate: sr })
  a.crossfade(b, 0.5, 'equal')
  let out = (await a.read())[0]
  let before = rms(out.subarray(Math.round(0.2 * sr), Math.round(0.4 * sr)))
  let mid = rms(out.subarray(Math.round(0.7 * sr), Math.round(0.8 * sr)))  // transition center
  let dip = 20 * Math.log10(mid / before)
  t.ok(Math.abs(dip) < 1, `mid-transition RMS within ±1 dB (got ${dip.toFixed(2)} dB)`)
})

test('ref mutation invalidates the plan cache (refVersion)', async t => {
  let sr = 44100
  let ref = audio.from([tone(440, 0.2, sr, 0.5)], { sampleRate: sr })
  let a = audio.from([new Float32Array(sr)], { sampleRate: sr })
  a.insert(ref, { at: 0 })
  let before = rms((await a.read())[0].subarray(0, Math.round(0.15 * sr)))
  ref.gain(-40)  // mutate the ref AFTER the plan was built and cached
  let after = rms((await a.read())[0].subarray(0, Math.round(0.15 * sr)))
  t.ok(after < before * 0.05, `re-read reflects ref edit (${before.toFixed(3)} → ${after.toFixed(4)})`)
})

test('mix awaits a still-decoding ref', async t => {
  let ref = audio('test/fixture.wav')  // async decode, not awaited
  let main = audio.from([new Float32Array(44100)], { sampleRate: 44100 })
  main.mix(ref, { at: 0 })
  let out = (await main.read())[0]
  t.ok(out.some(v => v !== 0), 'mixed region carries the ref PCM, not silence')
})

test('resolve exact-stats fallback: unaligned crop + normalize', async t => {
  // crop offset not block-aligned → algebraic remap infeasible → full sync stat pass
  let sr = 44100
  let ch = new Float32Array(sr * 2)
  for (let i = sr; i < 2 * sr; i++) ch[i] = 0.1 * Math.sin(2 * Math.PI * 440 * i / sr)
  let a = audio.from([ch], { sampleRate: sr })
  a.crop({ at: 1.0037 }).normalize({ mode: 'rms', target: -6 })
  let db = 20 * Math.log10(rms((await a.read())[0]))
  t.ok(Math.abs(db - -6) < 0.2, `unaligned crop + normalize hits target (${db.toFixed(2)} dB)`)
})

test('stat() on a fresh un-awaited instance (README recipe)', async t => {
  let a = audio('test/fixture.wav')  // no await — decode in flight
  let clips = await a.stat('clipping')
  t.ok(Array.isArray(clips) || typeof clips === 'object', 'stat(clipping) resolves without null-deref')
  let b = audio('test/fixture.wav')
  let [mins, maxs] = await b.stat(['min', 'max'], { bins: 64 })
  t.is(mins.length, 64, 'binned waveform query works pre-await')
  t.is(maxs.length, 64)
})

test('streaming stretch extends the safe limit (adjustLimit _stretch_seg)', async t => {
  let sr = 44100, N = 8192
  let a = audio(null, { sampleRate: sr, channels: 1 })
  a.stretch(2)
  let got = 0
  let consumer = (async () => {
    for await (let c of a.stream()) { got += c[0].length; if (got >= 12000) return got }
    return got
  })()
  a.push(tone(440, N / sr, sr, 0.5))
  // With the limit scaled by the stretch factor, ~2·N output samples are deterministic
  // from N source samples — the consumer must pass 12000 without waiting for stop().
  let r = await Promise.race([consumer, new Promise(res => setTimeout(() => res('stalled'), 2000))])
  a.stop()
  t.ok(r !== 'stalled' && r >= 12000, `streamed ${r} samples from ${N} pushed (expect ≥12000 pre-stop)`)
})

test('range options rejected on channel-changing ops', t => {
  let a = audio.from([tone(440, 0.2), tone(220, 0.2)], { sampleRate: 44100 })
  let err = null
  try { a.remix(1, { at: 0.05 }) } catch (e) { err = e }
  t.ok(/range/.test(err?.message), `remix with {at} throws (${err?.message})`)
})

test('expand hook: macro ops rewrite without stats', async t => {
  // Plugin-facing contract: expand receives no stats and rewrites into simpler edits
  let seen = null
  audio.op('_test_double', {
    params: ['times'],
    hidden: false,
    expand: ctx => { seen = ctx; return ['repeat', { times: ctx.times }] }
  })
  let a = audio.from([tone(440, 0.1)], { sampleRate: 44100 })
  a._test_double(1)
  t.is(a.length, 2 * Math.round(0.1 * 44100), 'expansion applied structurally')
  t.ok(!('stats' in seen), 'expand ctx carries no stats (pure macro)')
  // built-in macros migrated: descriptor tells the story
  t.ok(audio.op('fade').expand && audio.op('stretch').expand && audio.op('resample').expand && audio.op('crossfade').expand, 'macro ops declare expand')
  t.ok(audio.op('trim').resolve && audio.op('normalize').resolve, 'stat-conditioned ops keep resolve')
})

test('ensurePlan primes evicted pages of mix pull sources', async t => {
  let sr = 44100
  let src = audio.from([tone(440, 1, sr, 0.5)], { sampleRate: sr })
  // mock page cache + zero budget → all pages evicted
  let store = new Map()
  src.cache = {
    read: async i => store.get(i), write: async (i, d) => { store.set(i, d) },
    has: async i => store.has(i), evict: async () => {}, clear: async () => {}
  }
  src.budget = 0
  await audio.evict(src)
  t.ok(src.pages.every(p => p === null), 'source pages evicted')
  let target = audio.from([new Float32Array(sr)], { sampleRate: sr })
  target.mix(src)
  let out = (await target.read())[0]
  t.ok(rms(out) > 0.2, `mixed content restored from cache, not silence (rms ${rms(out).toFixed(3)})`)
})

test('effective format derives through edits (single home)', t => {
  let a = audio.from([tone(440, 0.1), tone(220, 0.1)], { sampleRate: 44100 })
  a.remix(1)
  t.is(a.channels, 1)
  a.resample(22050)
  t.is(a.sampleRate, 22050)
  t.is(a.channels, 1, 'both hooks fold through one derivation')
})

test('breakpoint curves: serializable automation ≡ function automation', async t => {
  let sr = 44100, src = tone(440, 1, sr, 0.8)
  let fn = t2 => -24 * Math.min(1, t2)                    // linear dive to -24dB
  let cv = { t: [0, 1], v: [0, -24] }                     // same shape as breakpoints
  let a = audio.from([src.slice()], { sampleRate: sr }); a.gain(fn)
  let b = audio.from([src.slice()], { sampleRate: sr }); b.gain(cv)
  let [ra, rb] = [(await a.read())[0], (await b.read())[0]]
  let maxDiff = 0
  for (let i = 0; i < ra.length; i++) maxDiff = Math.max(maxDiff, Math.abs(ra[i] - rb[i]))
  t.ok(maxDiff < 1e-6, `curve ≡ fn (maxDiff ${maxDiff})`)

  t.is(a.toJSON().edits.length, 0, 'fn edit omitted from JSON (not serializable)')
  t.is(b.toJSON().edits.length, 1, 'curve edit survives JSON')

  // engine-level: curves work on any op param (filter sweep)
  let c = audio.from([tone(4000, 1, sr, 0.5)], { sampleRate: sr })
  c.lowpass({ t: [0, 1], v: [10000, 100] })
  let out = (await c.read())[0]
  let head = rms(out.subarray(0, Math.round(0.2 * sr)))
  let tail = rms(out.subarray(Math.round(0.8 * sr)))
  t.ok(tail < head * 0.2, `curve sweeps filter cutoff (head ${head.toFixed(3)} → tail ${tail.toFixed(4)})`)
})

test('stat after undo restores source stats (wavearea undo/redo path)', async t => {
  let ch = new Float32Array(44100)
  ch.fill(0.9, 0, 22050); ch.fill(0.1, 22050)
  let a = audio.from([ch], { sampleRate: 44100 })
  let before = await a.stat('max')
  a.remove({ at: 0, duration: 0.5 })
  t.ok(Math.abs(await a.stat('max') - 0.1) < 1e-3, 'edited stats reflect remove')
  a.undo()
  t.is(await a.stat('max'), before, 'undo to zero edits restores source stats')
  let bins = await a.stat('max', { bins: Math.ceil(a.length / 1024) })
  t.ok(Math.abs(bins[0] - 0.9) < 1e-3, 'binned waveform restored')
  a.remove({ at: 0, duration: 0.5 })  // redo-equivalent: re-apply after undo
  t.ok(Math.abs(await a.stat('max') - 0.1) < 1e-3, 're-applied edit derives fresh stats')
})

test('mix/write past the first block — unranged position ops anchor at absolute 0', async t => {
  // opRange defaulted `at` to 0 per block, so mix/write restarted at every block
  // boundary: mix tiled the source's first BLOCK_SIZE samples across the whole file.
  // Fixed: unset `at` resolves to −blockOffset (absolute 0 in block-relative terms).
  let sr = 44100
  let ramp = new Float32Array(sr / 2)
  for (let i = 0; i < ramp.length; i++) ramp[i] = i / sr

  let a = audio.from([new Float32Array(sr)], { sampleRate: sr })
  a.mix(audio.from([ramp], { sampleRate: sr }))
  let pcm = (await a.read())[0]
  t.ok(Math.abs(pcm[5000] - 5000 / sr) < 1e-6, `mix source offset advances across blocks (${pcm[5000].toFixed(5)})`)
  t.ok(Math.abs(pcm[20000] - 20000 / sr) < 1e-6, 'deep into the source, still aligned')
  t.is(pcm[30000], 0, 'no source energy past its end (was tiled)')

  let b = audio.from([new Float32Array(sr).fill(0.5)], { sampleRate: sr })
  b.write(new Float32Array(3000).fill(-0.9))  // spans 3 blocks, default position
  let q = (await b.read())[0]
  t.ok(Math.abs(q[2000] + 0.9) < 1e-6, 'write covers its full span')
  t.is(q[3500], 0.5, 'untouched after data ends')

  // ranged behavior unchanged
  let c = audio.from([new Float32Array(sr).fill(0.5)], { sampleRate: sr })
  c.mix(audio.from([new Float32Array(sr).fill(0.3)], { sampleRate: sr }), { at: 0.2, duration: 0.3 })
  let r = (await c.read())[0]
  t.ok(Math.abs(r[Math.round(sr * 0.3)] - 0.8) < 0.01, 'ranged mix adds inside range')
  t.ok(Math.abs(r[Math.round(sr * 0.6)] - 0.5) < 0.01, 'ranged mix silent outside range')
})

// ── Sequential semantics: a structural op works on the processed audio before it ──
// Reference: render the processed audio, then apply the structural edit to plain arrays.

const sr0 = 8000
const dc = (v, n = sr0) => audio.from([new Float32Array(n).fill(v)], { sampleRate: sr0 })
const maxDiff = (a, b) => { let m = a.length === b.length ? 0 : Infinity; for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i] - b[i])); return m }

test('gain then insert: inserted audio stays unprocessed', async t => {
  let pcm = (await dc(0.5).gain(-6).insert(dc(0.5), { at: 0.5 }).read())[0]
  t.ok(Math.abs(pcm[100] - 0.5 * 10 ** (-6 / 20)) < 1e-6, `before splice: gained (${pcm[100]})`)
  t.is(pcm[sr0 / 2 + 100], 0.5, 'inserted: untouched')
  t.ok(Math.abs(pcm[sr0 + sr0 / 2 + 100] - 0.5 * 10 ** (-6 / 20)) < 1e-6, 'after splice: gained')
})

test('ranged gain then insert before it: the range follows its samples', async t => {
  let pcm = (await dc(0.5).gain(-60, { at: 0.5, duration: 0.25 }).insert(dc(0.5, sr0 / 4), { at: 0 }).read())[0]
  t.is(pcm[sr0 / 2 + 100], 0.5, 'old range position now holds unprocessed audio')
  t.ok(pcm[sr0 * 0.75 + 100] < 0.001, `range moved by the insert (${pcm[sr0 * 0.75 + 100]})`)
})

test('fade-out then pad: the fade stays on the original end', async t => {
  let pcm = (await dc(0.5).fade(0, 0.5).pad(0, 0.5).read())[0]
  t.ok(pcm[sr0 - 10] < 0.01, `original end faded (${pcm[sr0 - 10]})`)
  t.is(pcm[sr0 + 100], 0, 'padding is silence')
})

test('automation then remove: time follows the original samples', async t => {
  let pcm = (await dc(1).gain(t => t < 0.5 ? 0 : -60).remove({ at: 0, duration: 0.25 }).read())[0]
  t.ok(Math.abs(pcm[sr0 / 4 + 100]) < 0.01, `sample from 0.5s keeps its -60dB (${pcm[sr0 / 4 + 100]})`)
  t.ok(Math.abs(pcm[100] - 1) < 1e-6, 'sample from 0.25s keeps 0dB')
})

// Unbounded memory: any state restart shows, however long the warm-up
audio.op('runsum', { process: (input, output, ctx) => {
  for (let c = 0; c < input.length; c++) {
    let acc = (ctx.acc ??= [])[c] ?? 0
    for (let i = 0; i < input[c].length; i++) output[c][i] = acc += input[c][i]
    ctx.acc[c] = acc
  }
}})

test('stateful op then insert: contiguous stage reads keep state exact', async t => {
  let src = () => dc(1e-4, sr0 * 3)
  let summed = (await src().runsum().read())[0]
  let out = (await src().runsum().insert(0.25, { at: 2 }).read())[0]
  let expect = new Float32Array(summed.length + sr0 / 4)
  expect.set(summed.subarray(0, sr0 * 2)); expect.set(summed.subarray(sr0 * 2), sr0 * 2 + sr0 / 4)
  t.is(maxDiff(out, expect), 0, 'bit-exact vs render-then-splice, past the warm-up horizon')
})

test('filter then crop / reverse match render-then-edit', async t => {
  let src = () => audio.from([tone(440, 1, sr0)], { sampleRate: sr0 })
  let filtered = (await src().lowpass(1000).read())[0]
  let crop = (await src().lowpass(1000).crop({ at: 0.5, duration: 0.25 }).read())[0]
  t.ok(maxDiff(crop, filtered.subarray(sr0 / 2, sr0 * 0.75)) < 1e-4, `crop within warm-up tolerance (${maxDiff(crop, filtered.subarray(sr0 / 2, sr0 * 0.75))})`)
  let rev = (await src().lowpass(1000).reverse().read())[0]
  t.ok(maxDiff(rev, filtered.slice().reverse()) < 1e-4, `reverse within warm-up tolerance (${maxDiff(rev, filtered.slice().reverse())})`)
})

test('stream equals read across a baked prefix', async t => {
  let mk = () => audio.from([tone(440, 1, sr0)], { sampleRate: sr0 }).highpass(200).gain(-3).insert(dc(0.1, sr0 / 3), { at: 0.3 }).fade(0.1, 0.1)
  let flat = (await mk().read())[0], parts = []
  for await (let b of mk()) parts.push(b[0])
  let streamed = new Float32Array(parts.reduce((n, p) => n + p.length, 0)), o = 0
  for (let p of parts) { streamed.set(p, o); o += p.length }
  t.is(maxDiff(streamed, flat), 0, 'streamed output identical')
})

test('gain then trim: resolve-emitted crop bakes the prefix too', async t => {
  let x = new Float32Array(sr0).fill(0.5); x.fill(0, 0, sr0 / 4)
  let plain = audio.from([x], { sampleRate: sr0 }).trim(-40)
  let a = audio.from([x], { sampleRate: sr0 }).gain(-6).trim(-40)
  let pcm = (await a.read())[0]
  await plain.read()
  t.ok(a.duration < 1 && a.duration === plain.duration, `trims like the ungained source (${a.duration} vs ${plain.duration})`)
  t.ok(Math.abs(pcm[pcm.length - 100] - 0.5 * 10 ** (-6 / 20)) < 1e-6, 'gain applied')
})

test('stats after a baked prefix stay on the fast path and correct', async t => {
  let a = dc(0.5).gain(-6).crop({ at: 0.25, duration: 0.5 })
  let db = await a.stat('db')
  t.ok(Math.abs(db - 20 * Math.log10(0.5 * 10 ** (-6 / 20))) < 0.01, `db (${db})`)
})

test('markers and regions project through a baked prefix', async t => {
  let a = dc(0.5, sr0 * 2)
  a.markers = [{ time: 1, label: 'm' }]
  a.regions = [{ at: 1, duration: 0.5, label: 'r' }]
  a.gain(-6).insert(dc(0.5, sr0 / 2), { at: 0 })
  t.is(a.markers.map(m => m.time).join(), '1.5', 'marker shifted by the insert')
  t.is(a.regions.map(r => [r.at, r.duration].join('/')).join(), '1.5/0.5', 'region shifted by the insert')
})

test('an edited source inserted elsewhere streams with continuous state', async t => {
  let b = dc(1e-4, sr0 * 3).runsum()
  let own = (await b.read())[0]
  let out = (await dc(0, sr0 / 2).insert(b, { at: 0.25 }).read())[0]
  t.is(maxDiff(out.subarray(sr0 / 4, sr0 / 4 + own.length), own), 0, 'bit-exact vs its own render (no per-block re-warm)')
})

// ── Bake edge cases ──

const g6 = 0.5 * 10 ** (-6 / 20)
const cat = parts => { let o = new Float32Array(parts.reduce((n, p) => n + p.length, 0)), i = 0; for (let p of parts) { o.set(p, i); i += p.length }; return o }

test('bake: empty source, and splices at the start and at the very end', async t => {
  let empty = await audio.from([new Float32Array(0)], { sampleRate: sr0 }).gain(-6).insert(dc(0.5, 100), { at: 0 }).read()
  t.is(empty[0].length, 100, 'empty processed prefix + insert → only the insert')
  t.ok(empty[0].every(v => v === 0.5), 'inserted samples untouched')
  let a = (await dc(0.5, 1000).gain(-6).insert(dc(0.5, 10), { at: 0 }).insert(dc(0.5, 10), { at: 1010 / sr0 }).read())[0]
  t.is(a.length, 1020, 'lengths add')
  t.ok(a.subarray(0, 10).every(v => v === 0.5) && a.subarray(1010).every(v => v === 0.5), 'head and tail inserts untouched')
  t.ok(a.subarray(10, 1010).every(v => Math.abs(v - g6) < 1e-6), 'processed body in between')
})

test('bake: A → A — the same instance reads and streams identically twice', async t => {
  let a = dc(1e-4, sr0 * 3).runsum().insert(0.1, { at: 1 })
  let r1 = (await a.read())[0], r2 = (await a.read())[0]
  t.is(maxDiff(r1, r2), 0, 'two reads match')
  let s1 = [], s2 = []
  for await (let b of a) s1.push(b[0])
  for await (let b of a) s2.push(b[0])
  t.is(maxDiff(cat(s1), r1), 0, 'first stream matches read')
  t.is(maxDiff(cat(s2), r1), 0, 'second stream matches read')
})

test('bake: one edited source inserted twice reads exactly both times', async t => {
  let b = dc(1e-4, sr0 * 3).runsum()
  let own = (await b.read())[0]
  let out = (await dc(0, 10).insert(b, { at: 0 }).insert(b, { at: 3 }).read())[0]
  t.is(maxDiff(out.subarray(0, own.length), own), 0, 'first copy exact')
  t.is(maxDiff(out.subarray(sr0 * 3, sr0 * 3 + own.length), own), 0, 'second copy exact (cursor re-seeks to 0)')
})

test('bake: channel-changing, latency and resampling prefixes', async t => {
  let st = (await dc(0.5, 1000).remix(2).gain(-6).insert(audio.from([new Float32Array(10).fill(0.5), new Float32Array(10).fill(0.5)], { sampleRate: sr0 }), { at: 0 }).read())
  t.is(st.length, 2, 'stage keeps the widened channel count')
  t.ok(st.every(c => c.subarray(0, 10).every(v => v === 0.5) && Math.abs(c[500] - g6) < 1e-6), 'both channels: insert untouched, body processed')

  let mk = () => audio.from([tone(440, 1, sr0)], { sampleRate: sr0 }).pitch(2).insert(dc(0.25, sr0 / 4), { at: 0.5 })
  let flat = (await mk().read())[0], parts = []
  for await (let b of mk()) parts.push(b[0])
  t.is(maxDiff(cat(parts), flat), 0, 'latency stage (pitch): stream ≡ read')
  t.ok(flat.subarray(sr0 / 2, sr0 * 0.75).every(v => v === 0.25), 'insert after a latency stage lands aligned and untouched')

  let rs = (await dc(0.5).gain(-6).resample(16000).read())[0]
  t.is(rs.length, 16000, 'resampled prefix length')
  t.ok(rs.subarray(4, -4).every(v => Math.abs(v - g6) < 1e-5), 'resampled stage reads contiguous overlaps without re-seeking artifacts')
})

test('bake: streaming a still-decoding source equals reading it decoded', async t => {
  let done = await audio('test/fixture.wav'), sr = done.sampleRate
  let ins = () => audio.from(Array.from({ length: done.channels }, () => new Float32Array(sr / 10).fill(0.25)), { sampleRate: sr })
  let flat = await done.clone().highpass(200).gain(-6).insert(ins(), { at: 0.05 }).read()
  let live = audio('test/fixture.wav').highpass(200).gain(-6).insert(ins(), { at: 0.05 }), parts = []
  for await (let b of live) parts.push(b[0])
  t.is(maxDiff(cat(parts), flat[0]), 0, 'recompiles during decode carry the stage cursor without seams')
})

test('bake: replacing the edits mid-stream (A → B) keeps streaming the new chain', async t => {
  let a = dc(0.5, sr0 * 4).gain(-6).insert(dc(0.1, sr0 / 4), { at: 1 }), parts = [], n = 0
  for await (let b of a) {
    parts.push(b[0])
    if (++n === 2) { a.undo(a.edits.length); a.run(['gain', { value: -12 }], ['insert', { source: dc(0.2, sr0 / 4), at: 3 }]) }
  }
  let out = cat(parts)
  t.is(out.length, sr0 * 4 + sr0 / 4, 'length follows the new chain')
  t.ok(Math.abs(out[sr0 * 2] - 0.5 * 10 ** (-12 / 20)) < 1e-6, `new gain after the switch (${out[sr0 * 2]})`)
  t.ok(out.subarray(sr0 * 3, sr0 * 3.25).every(v => v === Math.fround(0.2)), 'new insert untouched')
})

// ── Streaming guarantees over baked prefixes ──
// A baked prefix is read like any stream: contiguous reads continue its state, a jump
// (crop far in, reverse, seek) re-seeks with the same warm-up as seeking the prefix itself.
// runsum never forgets, so these pin the exact seek model, not just "close enough".

const collect = async it => { let p = []; for await (let b of it) p.push(b[0]); return cat(p) }

test('stream: a jump into a baked prefix equals seeking that prefix', async t => {
  let src = () => dc(1e-4, sr0 * 4).runsum()
  let seek = (await src().read({ at: 2, duration: 1 }))[0]
  t.is(maxDiff((await src().crop({ at: 2, duration: 1 }).read())[0], seek), 0, 'crop far into the effect ≡ read({at}) of the effect')
  t.is(maxDiff(await collect(src().crop({ at: 2, duration: 1 })), seek), 0, 'streamed crop ≡ the same seek')
})

test('stream: reverse over a long-memory effect is blockwise seeks, stream ≡ read', async t => {
  let T = sr0 * 3, n = audio.BLOCK_SIZE
  let src = () => dc(1e-4, T).runsum()
  let out = (await src().reverse().read())[0]
  t.is(maxDiff(await collect(src().reverse()), out), 0, 'stream ≡ read')
  t.is(maxDiff((await src().reverse().read())[0], out), 0, 'deterministic across renders')
  for (let o of [0, n * 10]) {
    let seek = (await src().read({ at: (T - o - n) / sr0, duration: n / sr0 }))[0]
    t.is(maxDiff(out.subarray(o, o + n), seek.slice().reverse()), 0, `output block at ${o} ≡ reversed seek into the effect`)
  }
})

test('stream: stream({at}) ≡ read({at}) on a baked chain, and a backward seek on the same instance', async t => {
  let mk = () => dc(1e-4, sr0 * 4).runsum().insert(dc(0.25, sr0 / 2), { at: 1 }).fade(0.1, 0.1)
  for (let at of [0.5, 1.25, 3]) {
    let read = (await mk().read({ at }))[0]
    t.is(maxDiff(await collect(mk().stream({ at })), read), 0, `stream({at: ${at}}) ≡ read({at: ${at}})`)
  }
  let a = mk()
  await collect(a.stream({ at: 3 }))
  t.is(maxDiff(await collect(a.stream({ at: 0.5 })), (await mk().read({ at: 0.5 }))[0]), 0, 'seek back on a used instance ≡ fresh seek')
})

test('stream: a reversed effect over a huge virtual length streams without materializing', async t => {
  let a = audio.from([new Float32Array(1e6).fill(0.5)], { sampleRate: 44100 }).repeat(600).gain(-3).reverse()
  let err = null
  try { await a.read() } catch (e) { err = e }
  t.ok(/too large/i.test(err?.message), 'too large to materialize')
  let blocks = 0, ok = true
  for await (let b of a.stream()) { ok &&= b[0].every(v => Math.abs(v - 0.5 * 10 ** (-3 / 20)) < 1e-6); if (++blocks === 16) break }
  t.is(blocks, 16, 'first blocks stream')
  t.ok(ok, 'streamed blocks carry the processed samples')
})

test('stream: reverse and far crop while the source is still decoding ≡ decoded read', async t => {
  let done = await audio('test/fixture.wav')
  let cut = Math.min(0.3, done.duration / 2)
  for (let [name, chain] of [['reverse', a => a.runsum().reverse()], ['crop', a => a.runsum().crop({ at: cut })], ['splice', a => a.runsum().remove({ at: cut, duration: cut / 2 })]]) {
    let flat = (await chain(done.clone()).read())[0]
    t.is(maxDiff(await collect(chain(audio('test/fixture.wav'))), flat), 0, `${name}: live ≡ decoded`)
  }
})

test('stream: seeks and crops at the final boundary of a baked chain', async t => {
  let T = sr0 * 4, src = () => dc(1e-4, T).runsum()
  let last = (await src().read({ at: (T - 1) / sr0 }))[0]
  t.is(last.length, 1, 'one sample left before the end')
  t.is(maxDiff((await src().crop({ at: (T - 1) / sr0 }).read())[0], last), 0, 'crop to the last sample ≡ seek to it')
  let mk = () => src().insert(dc(0.25, sr0 / 2), { at: 1 })
  t.is((await collect(mk().stream({ at: 4.5 }))).length, 0, 'stream({at: end}) yields nothing')
  t.is((await mk().read({ at: 4.5 }))[0].length, 0, 'read({at: end}) is empty')
})
