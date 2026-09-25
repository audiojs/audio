import test from 'tst'
import audio from '../audio.js'

const make = (left = [.125, .25, .375, .5], sr = 4) => audio.from([
  Float32Array.from(left), Float32Array.from(left, v => -v / 2)
], { sampleRate: sr })
const values = pcm => pcm.map(ch => [...ch])
const stereo = left => [left, left.map(v => -v / 2)]
async function streamed(a, opts) {
  const out = Array.from({ length: a.channels }, () => [])
  for await (const block of a.stream(opts)) block.forEach((ch, c) => out[c].push(...ch))
  return out
}

test('clipboard: copy preserves audio; repeated paste inserts the same stereo range', async t => {
  const a = make(), pages = a.pages.slice()
  t.is(a.copy({ at: .25, duration: .5 }), a, 'copy is chainable')
  t.is(values(await a.read()), stereo([.125, .25, .375, .5]))
  t.is(a.paste().paste({ at: 0 }), a, 'paste is chainable and does not consume the clipboard')
  const expected = stereo([.25, .375, .125, .25, .375, .5, .25, .375])
  t.is(values(await a.read()), expected)
  t.is(await streamed(a), expected)
  t.is(a.edits, [['copy', { at: .25, duration: .5 }], ['paste', {}], ['paste', { at: 0 }]])
  t.ok(a.pages.every((page, i) => page === pages[i]), 'source pages stay shared and untouched')
  t.is([...pages[0][0]], [.125, .25, .375, .5])
})

test('clipboard: captures processed samples at Copy without repeating earlier effects at Paste', async t => {
  const a = make().gain(2, { unit: 'linear' }).fade(1)
  a.copy({ at: .5 }).gain(0, { unit: 'linear' }).paste()
  const expected = stereo([0, 0, 0, 0, .375, .75])
  t.is(values(await a.read()), expected, 'copied fade keeps its original time coordinates')
  t.is(await streamed(a), expected)
  a.gain(2, { unit: 'linear' })
  t.is(values(await a.read()), stereo([0, 0, 0, 0, .75, 1.5]), 'effects after Paste affect the whole result')
})

test('clip: excerpts preserve processed coordinates and can transfer between independent clipboards', async t => {
  for (const n of [0, 1, 4, 1023, 1024, 1025]) {
    const a = make(Array.from({ length: n }, (_, i) => (i % 17) / 32), 48000).fade(n / 48000)
    const pcm = await a.read()
    for (const range of [{ at: 0 }, { at: 0, duration: 0 }, { at: Math.max(0, n - 1) / 48000 }, { at: n / 48000 }, { at: -1 / 48000 }]) {
      const start = Math.max(0, range.at < 0 ? n - 1 : Math.round(range.at * 48000))
      const expected = values(pcm.map(ch => ch.slice(start, range.duration === 0 ? start : n)))
      const clip = a.clip(range)
      t.is(values(await clip.read()), expected, `${n} frames: ${JSON.stringify(range)}`)
      t.is(await streamed(clip), expected)
      const b = make([], 48000).insert(clip)
      t.is(values(await b.read()), expected, 'cross-instance insert preserves the excerpt')
      b.dispose(); clip.dispose()
    }
    const clip = a.clip({ at: 0 })
    a.gain(0, { unit: 'linear' })
    t.is(values(await clip.read()), values(pcm), 'later source edits do not change captured samples')
    a.dispose()
    t.is(values(await clip.read()), values(pcm), 'shared pages survive source disposal')
    clip.dispose()
  }
})

test('clipboard: Cut removes processed samples and Undo restores the audio and previous clipboard together', async t => {
  const a = make().gain(2, { unit: 'linear' }).fade(1).copy({ duration: .25 })
  t.is(a.cut(.25, .5), a)
  t.is(a.edits.at(-1), ['cut', { at: .25, duration: .5 }])
  t.is(values(await a.read()), stereo([0, .75]))
  a.paste(0)
  t.is(values(await a.read()), stereo([.125, .375, 0, .75]))
  t.is(await streamed(a), stereo([.125, .375, 0, .75]))
  a.undo()
  t.is(a.undo(), ['cut', { at: .25, duration: .5 }])
  t.is(values(await a.read()), stereo([0, .125, .375, .75]))
  a.paste()
  t.is(values(await a.read()), stereo([0, .125, .375, .75, 0]), 'one Undo restored the earlier Copy')
  const b = make().cut()
  t.is(values(await b.read()), [[], []])
  b.paste().paste()
  t.is(values(await b.read()), stereo([.125, .25, .375, .5, .125, .25, .375, .5]))
  b.undo(3)
  t.throws(() => b.paste(), /clipboard/, 'Undoing the only Cut empties the clipboard')
})

test('clipboard: Cut handles empty and clamped ranges, replay and clone isolation', async t => {
  for (const left of [[], [.25], [.125, .25, .375, .5]]) {
    for (const opts of [null, { at: '-250ms' }, { at: 99 }, { at: -99, duration: .25 }, { duration: 0 }, { duration: -1 }]) {
      const a = make(left).copy().cut(opts), removed = values(await a.read())
      const at = Math.min(left.length, Math.max(0, opts?.at === '-250ms' ? left.length - 1 : (opts?.at ?? 0) * 4))
      const count = Math.max(0, Math.min(left.length - at, (opts?.duration ?? left.length / 4) * 4))
      t.is(removed, stereo([...left.slice(0, at), ...left.slice(at + count)]))
      const b = a.clone().paste(0), expected = stereo([...left.slice(at, at + count), ...left.slice(0, at), ...left.slice(at + count)])
      t.is(values(await b.read()), expected)
      t.is(await streamed(b), expected)
      t.is(values(await a.read()), removed, 'clone paste leaves source alone')
      const replay = make(left).run(...JSON.parse(JSON.stringify(b.toJSON().edits)))
      t.is(values(await replay.read()), expected)
    }
  }
  t.is(values(await make().remove({ duration: -1 }).read()), stereo([.125, .25, .375, .5]), 'Remove also clamps negative lengths')
})

test('clipboard: latest Copy, Undo, replay and clone have independent clipboard histories', async t => {
  const a = make().copy({ duration: .25 }).paste()
  a.copy({ at: .25, duration: .5 }).paste()
  t.is(values(await a.read()), stereo([.125, .25, .375, .5, .125, .25, .375]))
  const paste = a.undo(), copy = a.undo()
  a.paste()
  t.is(values(await a.read()), stereo([.125, .25, .375, .5, .125, .125]), 'Undo restores the earlier clipboard')
  a.undo(); a.run(copy, paste)
  t.is(values(await a.read()), stereo([.125, .25, .375, .5, .125, .25, .375]), 'undone edits replay')
  const b = a.clone().copy({ at: 0, duration: .25 }).paste()
  a.paste()
  t.is(values(await a.read()), stereo([.125, .25, .375, .5, .125, .25, .375, .25, .375]))
  t.is(values(await b.read()), stereo([.125, .25, .375, .5, .125, .25, .375, .125]))
  // A copied range can include an earlier paste, without a self-reference.
  const c = make([.25]).copy().paste().copy().paste()
  t.is(values(await c.read()), stereo([.25, .25, .25, .25]))
})

test('clipboard: empty, one-sample and clamped ranges; empty Copy replaces a previous value', async t => {
  for (const samples of [[], [.25]]) {
    const a = make(samples).copy().paste().paste()
    t.is(values(await a.read()), stereo([...samples, ...samples, ...samples]))
    t.is(await streamed(a), stereo([...samples, ...samples, ...samples]))
    t.is(values(await a.read({ duration: 0 })), [[], []])
    t.is(await streamed(a, { duration: 0 }), [[], []])
  }
  for (const range of [{ at: 1 }, { at: 99 }, { duration: 0 }, { duration: -1 }]) {
    const a = make().copy().copy(range).paste()
    t.is(values(await a.read()), stereo([.125, .25, .375, .5]), JSON.stringify(range))
  }
  const a = make().copy({ at: '-250ms', duration: '1s' }).paste({ at: -99 }).paste({ at: 99 })
  t.is(values(await a.read()), stereo([.5, .125, .25, .375, .5, .5]))
  const b = make().copy({ at: -99, duration: .25 }).paste({ at: -.25 })
  t.is(values(await b.read()), stereo([.125, .25, .375, .125, .5]))
  t.is(values(await make().copy('250ms', '.5s').paste(0).read()), stereo([.25, .375, .125, .25, .375, .5]), 'positional shorthand')
  t.is(values(await make([.25]).copy(null).paste(null).read()), stereo([.25, .25]), 'null options use the defaults')
})

test('clipboard: missing Copy and invalid times fail without adding an edit', async t => {
  const a = make()
  for (const apply of [a => a.paste(), a => a.run(['paste', {}]),
    a => a.copy({ at: NaN }), a => a.copy({ duration: Infinity }), a => a.copy({ at: 'wrong' }),
    a => a.cut({ at: NaN }), a => a.cut({ duration: Infinity }), a => a.cut({ at: 'wrong' })]) {
    let error
    try { apply(a) } catch (e) { error = e }
    t.ok(error instanceof Error, 'invalid edit rejects')
    t.is(a.edits.length, 0)
  }
  a.copy(); a.undo()
  let error
  try { a.paste() } catch (e) { error = e }
  t.ok(/clipboard.*copy/.test(error?.message), 'Undoing the only Copy empties the clipboard')
  const b = make()
  a.copy()
  t.throws(() => b.paste(), /clipboard/, 'clipboard does not leak between instances')
})

test('clipboard: read and stream agree before, at and after the final block boundary, A → A → B', async t => {
  for (const n of [1, audio.BLOCK_SIZE - 1, audio.BLOCK_SIZE, audio.BLOCK_SIZE + 1]) {
    const left = Array.from({ length: n }, (_, i) => (i % 15 + 1) / 32)
    const a = make(left, 48000).copy({ at: (n - 1) / 48000, duration: 1 / 48000 }).paste({ at: 1 / 48000 }).paste()
    const expected = stereo([left[0], left.at(-1), ...left.slice(1), left.at(-1)])
    t.is(values(await a.read()), expected)
    t.is(await streamed(a), expected, `A: ${n} source frames`)
    t.is(await streamed(a), expected, 'replay A')
    a.copy({ at: 0, duration: 1 / 48000 }).paste({ at: 0 })
    t.is(await streamed(a), expected.map(ch => [ch[0], ...ch]), 'different B on the same instance')
  }
})

test('clipboard: Copy/Cut and Paste queued before decode and across final push boundaries use the completed source', async t => {
  const path = typeof process !== 'undefined' && process.versions?.node ? 'test/fixture.wav' : '/test/fixture.wav'
  const original = await audio(path), pcm = await original.read()
  const a = audio(path).copy({ at: -1 / original.sampleRate }).paste()
  const result = await a.read()
  t.is(values(result), pcm.map(ch => [...ch, ch.at(-1)]))
  for (const type of ['copy', 'cut']) for (const left of [[], [.25], [.125, .25, .375, .5]]) for (const split of new Set([0, Math.max(0, left.length - 1), left.length])) {
    const a = audio(null, { sampleRate: 4, channels: 2 })[type]({ at: -.5 }).paste(0)
    const pending = streamed(a)
    const pcm = stereo(left).map(ch => Float32Array.from(ch))
    a.push(pcm.map(ch => ch.slice(0, split)))
    await Promise.resolve()
    a.push(pcm.map(ch => ch.slice(split))); a.stop()
    const rest = type === 'cut' ? left.slice(0, -2) : left
    t.is(await pending, stereo([...left.slice(-2), ...rest]), `${type}: ${left.length} frames, decode split at ${split}`)
  }
})

test('clipboard: Cut and Paste cross block boundaries on A → A → B without losing samples', async t => {
  for (const n of [1, audio.BLOCK_SIZE - 1, audio.BLOCK_SIZE, audio.BLOCK_SIZE + 1]) {
    const left = Array.from({ length: n }, (_, i) => (i % 15 + 1) / 32)
    const a = make(left, 48000).cut({ at: (n - 1) / 48000 }).paste(0)
    const expected = stereo([left.at(-1), ...left.slice(0, -1)])
    t.is(values(await a.read()), expected)
    t.is(await streamed(a), expected, 'A')
    t.is(await streamed(a), expected, 'A again')
    a.cut({ duration: 1 / 48000 }).paste()
    t.is(await streamed(a), stereo(left), 'different B restores the original order')
  }
})

test('clipboard: serialization replays the chain and leaves its clipboard usable', async t => {
  const path = typeof process !== 'undefined' && process.versions?.node ? 'test/fixture.wav' : '/test/fixture.wav'
  const a = audio(path).gain(-6).copy({ at: .1, duration: .2 }).remove({ at: .1, duration: .2 }).paste({ at: .5 })
  await a
  const json = JSON.parse(JSON.stringify(a)), b = audio(json)
  t.is(json.edits.map(e => e[0]), ['gain', 'copy', 'remove', 'paste'])
  t.is(values(await b.read()), values(await a.read()))
  a.paste(); b.paste()
  t.is(values(await b.read()), values(await a.read()), 'restored clipboard supports another paste')
})

test('clipboard: channel/rate changes and clone preserve the copied format and duration', async t => {
  const a = make().copy().remix(1).resample(8).paste()
  const out = await a.read()
  t.is(a.sampleRate, 8); t.is(a.channels, 1); t.is(out[0].length, 16)
  const expected = await audio.from([Float32Array.of(.125, .25, .375, .5)], { sampleRate: 4 }).resample(8).read()
  t.is([...out[0].slice(8)], [...expected[0]], 'copied stereo uses insert channel mapping and rate conversion')
  const b = make().resample(8).copy().clone().paste()
  t.is(b.duration, 2, 'clone retains the source rate before replaying resample')
  t.is(values(await b.read()), values(await make().resample(8).copy().paste().read()))
  t.is(await streamed(b), values(await b.read()))
})

test('clipboard: evicted source pages are restored through the copied range', async t => {
  const n = audio.PAGE_SIZE, left = new Float32Array(n + 2)
  left.set([.125, .25, .5], n - 1)
  for (const rate of [48000, 96000]) {
    const a = make(left, 48000), saved = a.pages.slice()
    a.cache = { has: async i => !!saved[i], read: async i => saved[i] }
    a.pages.fill(null)
    const edit = a => a.resample(rate).copy({ at: (n - 1) / 48000, duration: 3 / 48000 }).remove().paste()
    edit(a)
    const expected = rate === 48000 ? stereo([.125, .25, .5]) : values(await edit(make(left, 48000)).read())
    t.is(values(await a.read()), expected, `restored pages at ${rate} Hz`)
    t.is(await streamed(a), expected)
  }
})

test('clipboard: cached filters restore warm-up pages through direct, copied, inserted and pulled ranges', async t => {
  const sr = 48000, n = audio.PAGE_SIZE, left = new Float32Array(n + 20).fill(.25)
  for (const route of ['direct', 'copy', 'insert', 'mix', 'crossfade']) {
    const source = make(left, sr), saved = source.pages.slice(), restored = []
    source.cache = { has: async i => !!saved[i], read: async i => { restored.push(i); return saved[i] } }
    source.pages.fill(null)
    source.lowpass(100)
    let target = source, opts = { at: n / sr, duration: 10 / sr }
    if (route !== 'direct') {
      source.copy(opts).remove().paste()
      opts = undefined
      if (route === 'insert') target = make([], sr).insert(source)
      if (route === 'mix') target = make(new Array(10).fill(0), sr).mix(source)
      if (route === 'crossfade') target = make(new Array(4).fill(0), sr).crossfade(source, 4 / sr, 'linear')
    }
    t.is(values(await target.read({ duration: 0 })), [[], []])
    t.is(restored, [], `${route}: zero-work read restores no pages`)
    const expected = new Array(10).fill(.25)
    if (route === 'crossfade') for (let i = 0; i < 4; i++) expected[i] *= i / 4
    t.is(values(await target.read(opts)), stereo(expected), `${route}: filter state is warm at the range start`)
    t.ok(restored.includes(0) && restored.includes(1), `${route}: both sides of the page boundary restored`)
    t.is(await streamed(target, opts), stereo(expected), `${route}: stream matches read`)
  }
})

test('clipboard: cyclic pull references reject and a corrected chain remains usable', async t => {
  for (const mutual of [false, true]) {
    const a = make(), b = mutual ? make().mix(a) : a
    a.mix(b)
    await t.rejects(() => a.read(), /circular source reference/)
    a.undo(); a.copy({ duration: .25 }).paste()
    t.is(values(await a.read()), stereo([.125, .25, .375, .5, .125]))
  }
})
