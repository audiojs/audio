// Sounds kept by a key: the store (store.js, in memory here; the browser's files in test/memory.test.js)
import test from 'tst'
import audio from '../audio.js'
import { memo } from '../core.js'

let seed = 1
const noise = n => Float32Array.from({ length: n }, () => (seed = seed * 16807 % 2147483647) / 2147483647 - .5)
const same = (x, y) => x.length === y.length && x.every((c, k) => c.length === y[k].length && c.every((v, i) => v === y[k][i]))


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
