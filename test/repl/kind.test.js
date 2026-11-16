// What a sound is, in a word (repl/kind.js): the classifier's stretches to a word, here in Node; the worker's reading
// in a page is in engine.test.js, the word under the bar in embed.test.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { shares, word, called, likest, kindOf, spans, LISTENED, STRETCH, NEXT, OFFERS, rowFor } from '../../repl/kind.js'
import { ops, presets } from '../../repl/ops.js'
import { offered } from '../../repl/recipes.js'
import audio from '../../audio.js'

const seg = (kind, start, end) => ({ kind, start, end })

test('kind: the share of the time heard each kind holds, over every stretch given', () => {
  assert.deepEqual(shares([[seg('speech', 0, 6), seg('music', 6, 10)]]), { speech: .6, music: .4, noise: 0 })
  assert.deepEqual(shares([[seg('speech', 0, 10)], [seg('music', 0, 5), seg('noise', 5, 10)], []]), { speech: .5, music: .25, noise: .25 }, 'three stretches, one with nothing said of it')
  assert.equal(shares([]), null, 'none heard')
  assert.equal(shares([[], []]), null, 'nothing said of any')
})

test('kind: a word for it: speech, music, both where each holds a quarter of it, none where it is mostly neither', () => {
  const of = (speech, music, noise) => word({ speech, music, noise })
  assert.equal(of(1, 0, 0), 'speech')
  assert.equal(of(0, 1, 0), 'music')
  assert.equal(of(.78, .22, 0), 'speech', 'a film scene with a musical opening')
  assert.equal(of(.75, .25, 0), 'speech and music', 'a quarter is enough')
  assert.equal(of(.53, .47, 0), 'speech and music', 'a programme')
  assert.equal(of(.3, .3, .4), 'speech and music', 'each a quarter, whatever the rest')
  assert.equal(of(0, 0, 1), '', 'noise to the classifier is not said: a blackbird, a door')
  assert.equal(of(.2, .1, .7), '', 'mostly neither')
  assert.equal(of(.4, .1, .5), '', 'the rest larger than the speech in it')
  assert.equal(of(.45, .15, .4), 'speech')
  assert.equal(word(null), '')
})

test('kind: what is heard of a sound: all of it up to a minute, in equal parts of 10 s at most; past it, six stretches of 10 s from its start to its end', () => {
  assert.deepEqual(spans(0), [], 'nothing of an empty one')
  assert.deepEqual(spans(2), [[0, 2]])
  assert.deepEqual(spans(STRETCH), [[0, STRETCH]], '10 s: one part')
  assert.deepEqual(spans(18.8), [[0, 9.4], [9.4, 18.8]], 'two parts once it is over 10 s')
  // up to a minute: no part over 10 s, each beginning where the one before ends, from 0 to the end; as few as that takes
  for (const end of [.01, 9.99, 10.01, 20, 33.33, 59.99, LISTENED]) {
    const parts = spans(end)
    assert.equal(parts.length, Math.ceil(end / STRETCH), `${end} s`)
    assert.equal(parts[0][0], 0, `${end} s`); assert.equal(parts.at(-1)[1], end, `${end} s`)
    parts.forEach(([p, q], i) => { assert.ok(q > p && q - p <= STRETCH + 1e-9, `${end} s: ${q - p} s`); if (i) assert.equal(p, parts[i - 1][1], `${end} s: no gap, no overlap`) })
  }
  // past it: six of exactly 10 s, the first at its start, the last at its end, evenly apart
  for (const end of [60.01, 120, 300]) {
    const far = spans(end)
    assert.equal(far.length, LISTENED / STRETCH, `${end} s`)
    assert.equal(far[0][0], 0); assert.ok(Math.abs(far.at(-1)[1] - end) < 1e-9, `${end} s: to its end`)
    far.forEach(([p, q], i) => { assert.ok(Math.abs(q - p - STRETCH) < 1e-9); if (i) assert.ok(Math.abs(p - far[i - 1][0] - (end - STRETCH) / 5) < 1e-9, `${end} s: evenly spread`) })
  }
})

test('kind: of stretches heard: silence where nothing sounds, none with no listener there, else the word for what the classifier hears', async () => {
  const tone = Float32Array.from({ length: 4800 }, (_, i) => .1 * Math.sin(i / 10)), asked = []
  const segments = async (x, rate) => { asked.push([x.length, rate]); return [seg('music', 0, x.length / rate)] }
  assert.deepEqual(await kindOf([new Float32Array(4800)], 48000, { segments }), { kind: 'silence' }, 'digital silence')
  assert.deepEqual(await kindOf([Float32Array.from({ length: 4800 }, (_, i) => 2e-4 * Math.sin(i))], 48000, { segments }), { kind: 'silence' }, 'under −70 dBFS throughout')
  assert.equal(asked.length, 0, 'silence is not listened to')
  assert.deepEqual(await kindOf([tone], 48000), { kind: '' }, 'no listener: nothing said')
  assert.deepEqual(await kindOf([tone, new Float32Array(2400), tone], 44100, { segments }), { kind: 'music', shares: { speech: 0, music: 1, noise: 0 } }, 'every stretch listened to, a silent one among them')
  assert.deepEqual(asked, [[4800, 44100], [2400, 44100], [4800, 44100]], 'each at its own rate')
  assert.deepEqual(await kindOf([tone], 48000, { segments: async () => [seg('noise', 0, .1)] }), { kind: '', shares: { speech: 0, music: 0, noise: 1 } }, 'what is neither has no word')
})

// (scores as @audio/neural-tag gave them, the means over each sound: this site's blackbird, the EBU's SQAM excerpts
// and audio-lena, 2026-11-12)
test('kind: what the tagger heard, in a word: a particular class over a general one, of half or more; none under that', () => {
  const t = o => Object.entries(o).map(([name, score]) => ({ name, score }))
  assert.equal(called(t({ Animal: .80, 'Wild animals': .80, Bird: .80, 'Bird vocalization, bird call, bird song': .73, 'Chirp, tweet': .64, 'Environmental noise': .15 })), 'birdsong', 'a blackbird')
  assert.equal(called(t({ Music: .88, 'Bowed string instrument': .68, 'Violin, fiddle': .68, 'Musical instrument': .58 })), 'violin')
  assert.equal(called(t({ Music: .59, Trumpet: .58, 'Brass instrument': .53, Silence: .36 })), 'trumpet')
  assert.equal(called(t({ Music: .92, 'Brass instrument': .58, 'French horn': .42, Trombone: .21 })), 'music', 'a bassoon, taken for brass: no family is said, nor a name under the bar')
  assert.equal(called(t({ Music: .99, 'Plucked string instrument': .24, Guitar: .23, 'Acoustic guitar': .23 })), 'music', 'a guitar: music alone')
  assert.equal(called(t({ Music: .39, 'Mallet percussion': .36, Glockenspiel: .36, Percussion: .30 })), '', 'nothing of half or more: no word')
  assert.equal(called(t({ Telephone: .98, 'Busy signal': .98, Alarm: .91, 'Dial tone': .89 })), 'telephone', 'the best of several particular ones, the first of two alike')
  assert.equal(called(t({ Speech: .60, 'Crying, sobbing': .06, Whimper: .06 })), 'speech')
  assert.equal(called(t({ Silence: .60, Wind: .16, Rustle: .14 })), '', 'a quiet river bank: its Silence is not said (silence is the level\'s to say)')
  assert.equal(called(t({ 'Inside, small room': .9, Reverberation: .8 })), '', 'a class with no word here')
  assert.equal(called([]), '')
  // what it heard the sound as, as the word is read: of half or more, the particular ones where there are any, each
  // word once at its best; else the general ones
  assert.deepEqual(likest(t({ Animal: .80, 'Wild animals': .80, Bird: .80, 'Bird vocalization, bird call, bird song': .73, 'Chirp, tweet': .64, Crow: .21 })), [['birdsong', .73]], 'a blackbird')
  assert.deepEqual(likest(t({ Telephone: .98, 'Busy signal': .98, Alarm: .91, 'Dial tone': .89 })), [['telephone', .98], ['busy signal', .98], ['alarm', .91], ['dial tone', .89]])
  assert.deepEqual(likest(t({ Music: .92, 'Brass instrument': .58, 'French horn': .42, Trombone: .21 })), [['music', .92]], 'no particular one of half or more')
})

test('kind: the tagger is asked only where the first listener has no word, over the stretches end to end; its failing says nothing', async () => {
  const tone = Float32Array.from({ length: 4800 }, (_, i) => .1 * Math.sin(i / 10)), asked = []
  const tag = async (x, rate) => { asked.push([x.length, rate]); return [{ name: 'Music', score: .9 }, { name: 'Clarinet', score: .7 }, { name: 'Wind instrument, woodwind instrument', score: .71 }, { name: 'Flute', score: .07 }, { name: 'Ding', score: .04 }, { name: 'Speech', score: .01 }] }
  const neither = async (x, rate) => [seg('noise', 0, x.length / rate)], music = async (x, rate) => [seg('music', 0, x.length / rate)]
  assert.deepEqual(await kindOf([tone, tone], 48000, { segments: music, tag }), { kind: 'music', shares: { speech: 0, music: 1, noise: 0 } }, 'the first has a word')
  assert.equal(asked.length, 0, 'the tagger not asked')
  const r = await kindOf([tone, tone.subarray(0, 100)], 48000, { segments: neither, tag })
  assert.deepEqual([r.kind, r.shares, asked], ['clarinet', { speech: 0, music: 0, noise: 1 }, [[4900, 48000]]], 'the first has none: the tagger, once, over both stretches')
  assert.deepEqual(r.tags.map(t => t.name), ['Music', 'Wind instrument, woodwind instrument', 'Clarinet', 'Flute', 'Ding'], 'its five best, ranked')
  assert.deepEqual(r.like, [['clarinet', .7]], 'what it heard it as, as the word is read')
  assert.equal((await kindOf([tone], 48000, { tag })).kind, 'clarinet', 'no first listener: the tagger alone')
  assert.deepEqual(await kindOf([tone], 48000, { segments: neither, tag: async () => { throw Error('no model') } }), { kind: '', shares: { speech: 0, music: 0, noise: 1 } }, 'the tagger failing (its model not fetched): no word, no error')
  assert.deepEqual(await kindOf([new Float32Array(480)], 48000, { segments: neither, tag }), { kind: 'silence' })
})

// What each kind is given next (NEXT): a row for '' (the general one) and for words the listeners say; each call one
// the embedded editor reads as a quick edit (config.js quickOf's form: a name, its arguments), an edit of the editor's
// (repl/ops.js) that the library has, built in or a plugin it loads by name; a string argument one of that edit's
// presets (repl/ops.js presets: fn/specs.js's loudness targets), a number within its setting's range; each rendered on a
// second of tone, but DeepFilterNet3, whose model is fetched on first use (fn/deepfilter.js)
test('kind: what each kind of sound is given next: edits the editor and the library have, with their presets', async () => {
  const said = ['', 'silence', ...[[1, 0, 0], [0, 1, 0], [.5, .5, 0]].map(([speech, music, noise]) => word({ speech, music, noise }))]
  const tone = Float32Array.from({ length: 48000 }, (_, i) => .3 * Math.sin(i / 10))
  assert.ok(NEXT[''].length, 'a general row')
  for (const [kind, calls] of Object.entries(NEXT)) {
    assert.ok(said.includes(kind), `'${kind}': a word the listeners say (a tagger's word: name it here)`)
    assert.ok(calls.length >= 1 && calls.length <= 6, `${kind}: a few, as the page's six at most`)
    for (const call of calls) {
      const [, name, args] = call.match(/^([\w-]+)(?:\(([^)]*)\))?$/) ?? []
      assert.ok(ops[name], `${kind}: ${call}, an edit of the editor's`)
      assert.ok(audio.op(name) || audio.plugins[name], `${kind}: ${call}, the library's`)
      const values = args ? args.split(',').map(a => a.trim()).map(a => /^'.*'$/.test(a) ? a.slice(1, -1) : +a) : []
      assert.ok(values.length <= ops[name].params.length, `${call}: no more arguments than its settings`)
      values.forEach((v, i) => {
        const s = ops[name].params[i]
        if (typeof v === 'string') assert.ok(presets[name]?.includes(v), `${call}: '${v}', a preset of ${name}'s`)
        else assert.ok(Number.isFinite(v) && v >= s.min && v <= s.max, `${call}: ${v} within ${s.name}'s ${s.min} to ${s.max}`)
      })
      if (name === 'deepfilter') continue
      const out = await audio.from([tone], { sampleRate: 48000 })[name](...values).read()
      assert.ok(out[0].length > 0, `${call} renders`)
    }
  }
})

// The recipes each kind is offered first (OFFERS), read by the one rule NEXT is read by (rowFor): the kinds NEXT has,
// and the words the listener says of what a recipe is made for (wind, hum), each name one of repl/recipes.js's offered,
// once; a kind with no row of its own (silence, a bird, a word that is a name on Object's prototype) the general row
test('kind: the recipes each kind is offered first: NEXT\'s kinds, wind and hum, each one offered, read by the rule NEXT is', () => {
  const heard = { 'wind noise': 'Wind noise (microphone)', 'mains hum': 'Mains hum' }
  assert.deepEqual(Object.keys(NEXT).filter(k => !Object.hasOwn(OFFERS, k)), [], 'every kind NEXT has')
  assert.deepEqual(Object.keys(OFFERS).filter(k => !Object.hasOwn(NEXT, k)).sort(), Object.keys(heard).sort(), 'and wind and hum')
  for (const [kind, name] of Object.entries(heard)) assert.equal(called([{ name, score: .9 }]), kind, `'${kind}': what the listener calls ${name}`)
  const names = offered.map(p => p.name)
  for (const [kind, row] of Object.entries(OFFERS)) {
    assert.ok(row.length >= 1 && row.length <= 6 && new Set(row).size === row.length, `${kind}: a few, each once`)
    assert.deepEqual(row.filter(n => !names.includes(n)), [], `${kind}: each one offered`)
  }
  for (const table of [NEXT, OFFERS]) {
    for (const kind of Object.keys(table)) assert.equal(rowFor(table, kind), table[kind], `'${kind}', its own row`)
    for (const kind of [undefined, 'silence', 'bird', 'constructor']) assert.equal(rowFor(table, kind), table[''], `${kind}: the general row`)
  }
})

// The classifier itself, where the package installed has it (0.7): a band, plucked chords over a bass (the package's
// own test signal), is music; white noise is neither
test('kind: with @audio/neural-denoise\'s segments(): a band is music, hiss has no word', async t => {
  const { segments } = await import('@audio/neural-denoise').catch(() => ({}))
  if (!segments) return t.skip('@audio/neural-denoise installed has no segments(): 0.7 or later has')
  const sr = 48000, band = new Float32Array(5 * sr), chords = [[60, 64, 67], [57, 60, 64], [53, 57, 60], [55, 59, 62]], hz = m => 440 * 2 ** ((m - 69) / 12)
  let s = 9
  const rnd = () => (s = (s * 1664525 + 1013904223) % 4294967296, s / 4294967296 - .5)
  for (let b = 0; b * .5 < 5; b++) {
    const t0 = Math.round(b * .5 * sr), c = chords[(b >> 2) % 4]
    for (const n of [...c, c[0] - 24]) for (let h = 1; h <= 8 && hz(n) * h < 8000; h++)
      for (let i = 0; i < sr && t0 + i < band.length; i++) band[t0 + i] += .05 / h * Math.exp(-i / sr * (2 + h)) * Math.sin(2 * Math.PI * hz(n) * h * i / sr)
    for (let i = 0; i < 2000 && t0 + i < band.length; i++) band[t0 + i] += .1 * rnd() * Math.exp(-i / 300)
  }
  assert.equal((await kindOf([band], sr, { segments })).kind, 'music')
  assert.equal((await kindOf([Float32Array.from({ length: 4 * sr }, () => .2 * rnd())], sr, { segments })).kind, '')
})
