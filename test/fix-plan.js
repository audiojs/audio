/**
 * Regression tests for the 2026-07 plan-engine rework:
 * reversed-segment math (segSrcStart), per-stage pipeline buffers (remix chains),
 * resolve-stage stat remapping, ref loading/rates, engine automation/range scoping,
 * mid-stream edits, serialization, guards.
 */
import test from 'tst'
import audio from '../audio.js'

const ramp = n => { let ch = new Float32Array(n); for (let i = 0; i < n; i++) ch[i] = i; return ch }
const tone = (freq, dur, sr = 44100, amp = 1) => {
  let n = Math.round(dur * sr), ch = new Float32Array(n)
  for (let i = 0; i < n; i++) ch[i] = amp * Math.sin(2 * Math.PI * freq * i / sr)
  return ch
}
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
