// Sounds kept by a key: the store (store.js, in memory here; the browser's files in test/memory.test.js) and the
// checkpoints of what edits make (checkpoint.js), counted by the samples each step processes
import test from 'tst'
import audio, { keysOf, recall, keep } from '../audio.js'
import { memo } from '../core.js'

const sr = 44100
let seed = 1
const noise = n => Float32Array.from({ length: n }, () => (seed = seed * 16807 % 2147483647) / 2147483647 - .5)
const same = (x, y) => x.length === y.length && x.every((c, k) => c.length === y[k].length && c.every((v, i) => v === y[k][i]))

// a step that passes its input on, counting the samples it processes by its name
const counted = {}
audio.op('tally', { params: ['name'], process: (input, output, ctx) => { counted[ctx.name] = (counted[ctx.name] ?? 0) + input[0].length; input.forEach((x, c) => output[c].set(x)) } })
const reset = () => { for (let k in counted) delete counted[k] }


// ── The store ───────────────────────────────────────────────────

test('store — in memory: channels and sounds round trip, by get (channels) and open (a sound and its meta)', async t => {
  let kept = audio.store(), x = [noise(1000), noise(1000)]
  t.is(await kept.get('none'), null, 'nothing kept: null')
  t.is(await kept.open('none'), null)
  await kept.set('x', x, { sampleRate: 48000 })
  t.ok(same(await kept.get('x'), x), 'channels back as kept')
  let { sound, meta } = await kept.open('x')
  t.is([sound.sampleRate, sound.channels, sound.length, meta.sampleRate], [48000, 2, 1000, 48000], 'opened: a sound of them at the rate its meta says')
  t.ok(same(await sound.read(), x))
  let s = audio.from(x, { sampleRate: 22050 }).gain(-6), m = { label: 'quieter' }
  await kept.set('s', s, m)
  let got = await kept.open('s')
  t.ok(got.sound === s && got.meta === m, 'a sound and its meta given back as they were kept')
  t.ok(same(await kept.get('s'), await s.read()), 'its channels: what it makes')
  t.is([await kept.has('x'), await kept.has('none')], [true, false])
  t.is(await kept.keys(), ['x', 's'])
  await kept.delete('x')
  t.is([await kept.has('x'), await kept.get('x')], [false, null], 'deleted')
})

test('store — in memory: past max bytes the least lately used goes, the one just kept never', async t => {
  let kept = audio.store({ max: 3 * 4000 }), page = () => [noise(1000)]
  await kept.set('a', page()); await kept.set('b', page()); await kept.set('c', page())
  t.is(await kept.keys(), ['a', 'b', 'c'], 'within max: all kept')
  await kept.get('a')
  await kept.set('d', page())
  t.is(await kept.keys(), ['c', 'a', 'd'], 'over it: b, the least lately used, gone (a was read)')
  await kept.set('big', [noise(5000)])
  t.is(await kept.keys(), ['big'], 'one over max alone: kept, the rest gone')
})

test('store — as audio.memo: what a model makes is made once', async t => {
  let made = 0, make = async () => (made++, [Float32Array.of(1, 2)])
  audio.memo = audio.store()
  try {
    await memo('m', make)
    await new Promise(r => setTimeout(r))
    t.is((await memo('m', make))[0][1], 2)
    t.is(made, 1, 'read back, not made again')
  } finally { delete audio.memo }
})


// ── Checkpoints ─────────────────────────────────────────────────

test('checkpoint — keys: the same settings say the same, other settings otherwise; a function or samples, nothing past them', t => {
  let src = audio.from([noise(100)], { sampleRate: sr })
  let k1 = keysOf(src.clone().gain(-3, { at: .001, duration: .001 })), k2 = keysOf(src.clone().run(['gain', { duration: .001, at: .001, value: -3 }]))
  t.is(k1, k2, 'settings in any order: one key')
  t.not(keysOf(src.clone().gain(-3)).at(-1), keysOf(src.clone().gain(-4)).at(-1))
  t.not(keysOf(src.clone().gain(-Infinity)).at(-1), keysOf(src.clone().gain(null)).at(-1), '-Infinity is not null')
  t.is(keysOf(src.clone().gain(-3).gain(t => -t).gain(-1)).length, 2, 'a function: its step and those after it have none')
  t.is(keysOf(src.clone().gain(-3).insert([new Float32Array(10)], 0).gain(-1)).length, 2, 'samples: none')
  t.is(keysOf(audio.from([noise(100)])).at(0) === keysOf(audio.from([noise(100)])).at(0), false, 'two sounds: two names')
  t.is(keysOf(src.clone()).at(0), keysOf(src.clone().clone()).at(0), 'a copy of a copy: the sound they play')
  t.is(keysOf(src, () => null), [], 'a sound the host names not: no key at all')
})

// A step turned off or on: the output before it is kept, and only what follows it renders
test('checkpoint — a step toggled off or on renders only the steps after it', async t => {
  let x = [noise(2 * sr)], src = audio.from(x, { sampleRate: sr }), kept = audio.store()
  let chain = (...names) => names.reduce((a, n) => a.tally(n), src.clone())
  let ac = chain('a', 'c')
  for (let k = 1; k <= 2; k++) await keep(ac, kept, { step: k })
  t.is(counted, { a: 2 * sr, c: 2 * sr }, 'kept step by step: each step once')
  reset()
  let on = await recall(chain('a', 'b', 'c'), kept)
  t.is(on.edits.map(e => e[1].name), ['b', 'c'], 'b turned on: from a\'s output, b and c after it')
  t.ok(same(await on.read(), x), 'the samples the chain makes')
  t.is(counted, { b: 2 * sr, c: 2 * sr }, 'only the steps after it render')
  reset()
  let off = await recall(chain('a', 'c'), kept)
  t.is(off.edits.length, 0, 'turned off again: kept whole')
  t.ok(same(await off.read(), x))
  t.is(counted, {}, 'nothing renders')
  let more = await recall(chain('a', 'c', 'd'), kept)
  await more.read()
  t.is(counted, { d: 2 * sr }, 'a step added at the end: it alone')
})

// What is kept is found again by what makes it, not by the instance that kept it
test('checkpoint — an unchanged prefix comes from the store: another instance with the same source and edits renders nothing kept', async t => {
  let x = [noise(sr), noise(sr)], src = audio.from(x, { sampleRate: sr }), kept = audio.store()
  let first = src.clone().tally('a').gain(-6).tally('b')
  let made = await keep(first, kept)
  reset()
  t.is(made.length, sr)
  let again = await recall(src.clone().tally('a').gain(-6).tally('b'), kept)
  let y = await again.read(), want = await src.clone().gain(-6).read()
  t.is(counted, {}, 'a second instance: nothing renders')
  t.ok(same(y, want), 'the same samples')
  t.is(await recall(audio.from(x, { sampleRate: sr }).tally('a').gain(-6).tally('b'), kept), null, 'the same samples in another sound: not the same source')
  // its marks come with it
  let marked = src.clone().tally('a').mark(.5, 'half').tally('b')
  await keep(marked, kept)
  reset()
  let back = await recall(src.clone().tally('a').mark(.5, 'half').tally('b'), kept)
  t.is(back.markers.map(m => [m.time, m.label]), [[.5, 'half']], 'the marks it made, on it')
  t.is(counted, {})
})

// stampOf's lesson: what a step reads is part of what it makes
test('checkpoint — a sound a step reads, edited, invalidates what was kept of it', async t => {
  let x = [noise(sr)], src = audio.from(x, { sampleRate: sr }), other = audio.from([noise(sr)], { sampleRate: sr }), kept = audio.store()
  let make = () => src.clone().mix(other).tally('m')
  await keep(make(), kept)
  reset()
  await (await recall(make(), kept)).read()
  t.is(counted, {}, 'as kept: nothing renders')
  other.gain(-6)
  t.is(await recall(make(), kept), null, 'the sound it mixes edited: nothing kept of it')
  let y = await make().read(), z = await src.clone().mix(other).read()
  t.is(counted, { m: sr }, 'rendered again')
  t.ok(same(y, z), 'with the edit')
  other.undo()
  t.ok(await recall(make(), kept), 'undone: kept again')
})

test('checkpoint — a function-valued step, or a sound with no name, keeps nothing past it', async t => {
  let x = [noise(sr)], src = audio.from(x, { sampleRate: sr }), kept = audio.store()
  let a = src.clone().tally('a').gain(t => -t).tally('b')
  t.is(await keep(a, kept), null, 'its output: not kept')
  t.is(await keep(a, kept, { step: 2 }), null, 'nor the function\'s step')
  t.ok(await keep(a, kept, { step: 1 }), 'the step before it: kept')
  reset()
  let b = await recall(src.clone().tally('a').gain(t => -t).tally('b'), kept)
  await b.read()
  t.is([b.edits.length, counted.a, counted.b], [2, undefined, sr], 'from the step before it, the function\'s and those after render')
  let unnamed = () => null
  t.is(await keep(src.clone().tally('c'), kept, { id: unnamed }), null, 'a sound the host names not: nothing kept')
  t.is(await recall(src.clone().tally('c'), kept, unnamed), null)
  let pushed = audio(null, { sampleRate: sr, channels: 1 })
  pushed.push([noise(100)])
  t.is(await keep(pushed.clone().tally('d'), kept), null, 'a sound still arriving: not kept')
})
