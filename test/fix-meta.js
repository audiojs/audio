import test from 'tst'
import audio from '../audio.js'

/**
 * Regression tests for the fn/meta.js projectRegions fix.
 *
 * Bug: projectRegions zipped remapSample(start)[i] with remapSample(end)[i] purely by array
 * index. A structural op that duplicates one endpoint's source segment (e.g. repeat()) but not
 * the other's produced a mismatched-length zip — pairing the wrong start with the wrong end and
 * emitting one bogus region spanning far more than the source region actually covered.
 *
 * Fix: project each region's [a,b) source interval through every plan segment independently,
 * collect all resulting output intervals, then sort + merge overlapping/adjacent ones per region.
 */

// ── repeat() duplicates a source range: the exact case from the audit repro ──
// 4s silence @ 8000 Hz, region = source [1s, 3s), then repeat(1, {at:0, duration:1.5}).
//
// repeatSegs produces 3 segments (in samples, sr=8000):
//   [0, 12000, 0]       source [0,1.5s)   -> output [0,1.5s)      (original playthrough)
//   [0, 12000, 12000]   source [0,1.5s)   -> output [1.5s,3s)     (repeated copy)
//   [12000, 20000, 24000] source [1.5s,4s) -> output [3s,5.5s)    (shifted tail)
//
// Region source [1s,3s) intersected against each segment's source window:
//   seg1 window [0,1.5s) ∩ [1,3) = [1,1.5)   -> output [1,1.5)          (0.5s)
//   seg2 window [0,1.5s) ∩ [1,3) = [1,1.5)   -> output [1.5+1, 1.5+1.5) = [2.5,3)
//   seg3 window [1.5,4s) ∩ [1,3) = [1.5,3)   -> output [3+(1.5-1.5), 3+(3-1.5)) = [3,4.5)
// [2.5,3) and [3,4.5) touch -> merge to [2.5,4.5).
// Final: [{at:1, duration:0.5}, {at:2.5, duration:2}]  (total 2.5s > source's 2s: the
// sub-range [1,1.5) of the source region appears in both playthroughs, so it's double-counted).
test('projectRegions — repeat() duplicates a source range, splits into 2 correct intervals', t => {
  let sr = 8000, len = sr * 4
  let a = audio.from([new Float32Array(len)], { sampleRate: sr })
  a.regions = [{ at: 1, duration: 2, label: 'r1' }]
  a.repeat(1, { at: 0, duration: 1.5 })

  t.is(a.length / a.sampleRate, 5.5, 'repeat extends length to 5.5s')
  let regions = a.regions
  t.is(regions.length, 2, 'splits into exactly 2 regions (not 1 bogus one)')
  t.almost(regions[0].at, 1, 1e-9, 'region 1 at')
  t.almost(regions[0].duration, 0.5, 1e-9, 'region 1 duration')
  t.is(regions[0].label, 'r1', 'region 1 label preserved')
  t.almost(regions[1].at, 2.5, 1e-9, 'region 2 at')
  t.almost(regions[1].duration, 2, 1e-9, 'region 2 duration')
  t.is(regions[1].label, 'r1', 'region 2 label preserved')
})

// ── reverse(): region entirely inside a reversed range maps through the tail-relative formula ──
// 10s silence @ 1000 Hz, region source [2s,3s), reverse({at:0, duration:5}).
// Segment: [from=0, count=5000, to=0, rate=-1]. Region samples [2000,3000) both fall inside the
// reversed window [0,5000). Reversed map: output = to+count-(i-from)/|r|.
//   i=2000 -> 0+5000-2000 = 3000
//   i=3000 -> 0+5000-3000 = 2000
// interval = [2000,3000) = [2s,3s) — a region strictly inside a symmetric reverse keeps its
// position (the reversed range is a palindrome point-for-point only when centered; here the
// region [2,3) sits at distance 2..3 from the start of a 5s reversed span, which reverses to
// distance 2..3 from the end — i.e. the same absolute window, since 5-3=2 and 5-2=3).
test('projectRegions — reverse() maps region through the tail-relative formula', t => {
  let sr = 1000, len = sr * 10
  let a = audio.from([new Float32Array(len)], { sampleRate: sr })
  a.regions = [{ at: 2, duration: 1, label: 'r' }]
  a.reverse({ at: 0, duration: 5 })

  let regions = a.regions
  t.is(regions.length, 1, 'single region, no spurious split')
  t.almost(regions[0].at, 2, 1e-9, 'region at (reversed-but-symmetric case maps back to itself)')
  t.almost(regions[0].duration, 1, 1e-9, 'region duration preserved')
})

// ── reverse(): asymmetric region inside the reversed range actually flips position ──
// Same reverse({at:0,duration:5}) but region source [0.5s,1.5s) (asymmetric: 0.5 from the head).
//   i=500  -> 0+5000-500 = 4500
//   i=1500 -> 0+5000-1500 = 3500
// interval = [3500,4500) = [3.5s,4.5s) — confirms the mapping actually reverses position
// (not just a coincidental identity, as the symmetric case above could be misread).
test('projectRegions — reverse() flips an asymmetric region to the mirrored position', t => {
  let sr = 1000, len = sr * 10
  let a = audio.from([new Float32Array(len)], { sampleRate: sr })
  a.regions = [{ at: 0.5, duration: 1, label: 'r' }]
  a.reverse({ at: 0, duration: 5 })

  let regions = a.regions
  t.is(regions.length, 1, 'single region')
  t.almost(regions[0].at, 3.5, 1e-9, 'region at mirrors to 3.5s')
  t.almost(regions[0].duration, 1, 1e-9, 'region duration preserved')
})

// ── crop(): region partially clipped by the crop window (no duplication, plain offset shift) ──
// 10s silence @ 1000 Hz, region source [2s,5s), crop({at:1, duration:6}) keeps source [1s,7s)
// at output [0s,6s). Region ∩ crop window = [2,5) (fully inside) -> output [2-1, 5-1) = [1,4).
test('projectRegions — crop() shifts a fully-contained region by the crop offset', t => {
  let sr = 1000, len = sr * 10
  let a = audio.from([new Float32Array(len)], { sampleRate: sr })
  a.regions = [{ at: 2, duration: 3, label: 'r' }]
  a.crop({ at: 1, duration: 6 })

  let regions = a.regions
  t.is(regions.length, 1, 'single region')
  t.almost(regions[0].at, 1, 1e-9, 'region at shifted by crop offset')
  t.almost(regions[0].duration, 3, 1e-9, 'region duration unchanged (fully inside crop window)')
})

// ── crop(): region straddling the crop boundary is clipped to what survives ──
// Region source [0s,4s), crop({at:2, duration:5}) keeps source [2s,7s) at output [0s,5s).
// Region ∩ crop window = [2,4) -> output [2-2, 4-2) = [0,2) (the [0,2) part of the region that
// fell before the crop start is gone — correctly clipped, not stretched or dropped entirely).
test('projectRegions — crop() clips a straddling region to the surviving portion', t => {
  let sr = 1000, len = sr * 10
  let a = audio.from([new Float32Array(len)], { sampleRate: sr })
  a.regions = [{ at: 0, duration: 4, label: 'r' }]
  a.crop({ at: 2, duration: 5 })

  let regions = a.regions
  t.is(regions.length, 1, 'single region')
  t.almost(regions[0].at, 0, 1e-9, 'region at clipped to crop start')
  t.almost(regions[0].duration, 2, 1e-9, 'region duration clipped to surviving portion')
})

// ── crop(): region entirely outside the crop window disappears ──
test('projectRegions — crop() drops a region entirely outside the kept window', t => {
  let sr = 1000, len = sr * 10
  let a = audio.from([new Float32Array(len)], { sampleRate: sr })
  a.regions = [{ at: 8, duration: 1, label: 'r' }]
  a.crop({ at: 0, duration: 5 })

  t.is(a.regions.length, 0, 'region outside crop window is gone, not corrupted')
})

// ── No edits: regions pass through untouched (baseline, guards against over-fixing) ──
test('projectRegions — no edits, region passes through unchanged', t => {
  let sr = 1000, len = sr * 10
  let a = audio.from([new Float32Array(len)], { sampleRate: sr })
  a.regions = [{ at: 2, duration: 3, label: 'r' }]

  let regions = a.regions
  t.is(regions.length, 1, 'single region')
  t.almost(regions[0].at, 2, 1e-9, 'at unchanged')
  t.almost(regions[0].duration, 3, 1e-9, 'duration unchanged')
})

// ── Markers (point projections) still use remapSample and still split on repeat() ──
test('projectMarkers — still correct: repeat() duplicates a marker inside the repeated span', t => {
  let sr = 8000, len = sr * 4
  let a = audio.from([new Float32Array(len)], { sampleRate: sr })
  a.markers = [{ time: 1, label: 'm1' }]
  a.repeat(1, { at: 0, duration: 1.5 })

  let markers = a.markers
  t.is(markers.length, 2, 'marker at source 1s (inside repeated [0,1.5) span) appears twice')
  t.almost(markers[0].time, 1, 1e-9, 'first occurrence')
  t.almost(markers[1].time, 2.5, 1e-9, 'second occurrence (shifted by the repeat)')
  t.is(markers[0].label, 'm1', 'label preserved')
})

test('projectMarkers — marker outside a repeated span appears once, shifted', t => {
  let sr = 8000, len = sr * 4
  let a = audio.from([new Float32Array(len)], { sampleRate: sr })
  a.markers = [{ time: 3, label: 'tail' }]  // in the un-repeated tail [1.5s,4s)
  a.repeat(1, { at: 0, duration: 1.5 })

  let markers = a.markers
  t.is(markers.length, 1, 'single occurrence — tail is not duplicated')
  t.almost(markers[0].time, 4.5, 1e-9, 'shifted by the 1.5s repeat insertion')
})

// ── Dead-state cleanup: _.markersV/_.regionsV are gone (were write-only, never read) ──
test('meta — no dead markersV/regionsV bookkeeping left on the instance', t => {
  let a = audio.from([new Float32Array(1000)], { sampleRate: 1000 })
  a.markers = [{ time: 0.1, label: 'x' }]
  a.regions = [{ at: 0.1, duration: 0.2, label: 'y' }]
  t.is(a._.markersV, undefined, 'markersV no longer written')
  t.is(a._.regionsV, undefined, 'regionsV no longer written')
})

// ── silence.js: single registration (not double), stat still functional ──
test('silence stat — registered exactly once (canonical bare descriptor, no dead second call)', t => {
  let desc = audio.stat('silence')
  t.ok(desc, 'silence stat is registered')
  t.is(Object.keys(desc).length, 0, 'bare {} descriptor — a stray {query:null} second registration would leave a "query" key')
})

test('silence stat — still detects silent regions correctly', async t => {
  let sr = 8000
  let ch = new Float32Array(sr * 3)  // 1s silence, 1s tone, 1s silence
  for (let i = sr; i < sr * 2; i++) ch[i] = 0.5 * Math.sin(2 * Math.PI * 440 * i / sr)
  let a = audio.from([ch], { sampleRate: sr })
  await a

  let segs = await a.stat('silence', { threshold: -20 })
  t.is(segs.length, 2, 'two silent segments found (before and after the tone)')
  t.almost(segs[0].at, 0, 0.15, 'first silence starts near 0')
  t.almost(segs[0].duration, 1, 0.2, 'first silence ~1s')
  t.almost(segs[1].at, 2, 0.2, 'second silence starts near 2s')
  t.almost(segs[1].duration, 1, 0.2, 'second silence ~1s')

  // a.silence(...) shorthand dispatches through the same registered stat
  let viaShorthand = await a.silence({ threshold: -20 })
  t.is(viaShorthand.length, 2, 'a.silence() shorthand matches a.stat("silence")')
})

test('fix save.js — encoder construction waits for metadata (mono file → mp3 defaulted to stereo and threw)', async t => {
  let d = new Float32Array(44100).map((_, i) => Math.sin(2 * Math.PI * 440 * i / 44100) * 0.4)
  await audio.from([d], { sampleRate: 44100 }).save('/tmp/fix-mono.wav')
  await audio('/tmp/fix-mono.wav').save('/tmp/fix-mono.mp3')
  let size = (await import('fs')).statSync('/tmp/fix-mono.mp3').size
  t.ok(size > 1000, `mono file encodes to mp3 straight off the source (${size}B)`)
})

// mark(time, label): a moment in the audio as it is after its edits, kept to through the edits after it
test('mark — a moment marked after edits keeps to it through later ones', t => {
  let a = audio.from([new Float32Array(4 * 8000)], { sampleRate: 8000 })
  a.remove({ at: 0, duration: 1 }).mark(1, 'here')
  t.is(a.markers, [{ time: 1, label: 'here' }], 'where it was put')
  a.pad(0.5, 0)
  t.is(a.markers, [{ time: 1.5, label: 'here' }], 'moved on by what came before it')
  a.crop({ at: 1, duration: 1.5 })
  t.is(a.markers, [{ time: 0.5, label: 'here' }], 'and by a crop')
  // in padding, which plays none of the source, where it was put: as far from the sound as it was
  let b = audio.from([new Float32Array(8000)], { sampleRate: 8000 }).pad(1, 0).mark(0.2)
  t.is(b.markers, [{ time: 0.2, label: '' }])
  // chainable, several, in time order
  let c = audio.from([new Float32Array(8000)], { sampleRate: 8000 }).mark(0.75, 'b').mark(0.25, 'a')
  t.is(c.markers.map(m => m.label), ['a', 'b'])
  // through a reversal and a speed change, where it was put, to a sample
  let r = audio.from([new Float32Array(8000)], { sampleRate: 8000 }).reverse().mark(0.25)
  t.ok(Math.abs(r.markers[0].time - 0.25) <= 1 / 8000, `reversed: ${r.markers[0].time}`)
  let f = audio.from([new Float32Array(16000)], { sampleRate: 8000 }).speed(2).mark(0.25)
  t.ok(Math.abs(f.markers[0].time - 0.25) <= 1 / 8000, `twice as fast: ${f.markers[0].time}`)
  // past the end, the end; on nothing, nothing
  t.is(audio.from([new Float32Array(8000)], { sampleRate: 8000 }).mark(5).markers, [{ time: 1, label: '' }])
  t.is(audio.from([new Float32Array(8000)], { sampleRate: 8000 }).crop({ at: 0.5, duration: 0.25 }).mark(3).markers, [{ time: 0.25, label: '' }])
  t.is(audio.from([new Float32Array(0)], { sampleRate: 8000 }).mark(1).markers, [])
})

// A file still opening has no rate yet: what is marked on it waits, as its edits do, and lands where it would on the file
// opened (a reload of the editor runs its script on files that are still opening); the file's own markers stay
test('mark — on a file still opening, where it would be on the file opened, beside its own markers', async t => {
  await audio.from([new Float32Array(4 * 8000)], { sampleRate: 8000 }).mark(3, 'own').save('/tmp/fix-mark-early.wav')
  let early = audio('/tmp/fix-mark-early.wav')
  t.is(early.sampleRate, 0, 'no rate yet')
  early.mark(1.25, 'a').remove({ at: 0, duration: 0.5 }).mark({ at: 1.5, duration: 0.5 }, 'r')
  await early
  let opened = (await audio('/tmp/fix-mark-early.wav')).mark(1.25, 'a').remove({ at: 0, duration: 0.5 }).mark({ at: 1.5, duration: 0.5 }, 'r')
  t.is(early.markers, opened.markers, 'the moments alike')
  t.is(early.regions, opened.regions, 'the ranges alike')
  t.is(early.markers, [{ time: 0.75, label: 'a' }, { time: 2.5, label: 'own' }], 'its own kept, moved by the edit')
  t.is(early.regions, [{ at: 1.5, duration: 0.5, label: 'r' }])
  // set, not marked, alike: the times as the audio has them when set, kept to through the edits after
  let set = audio('/tmp/fix-mark-early.wav')
  set.remove({ at: 0, duration: 0.5 })
  set.markers = [{ time: 0.75, label: 'a' }]
  set.regions = [{ at: 1, duration: 0.5, label: 'r' }, { at: 2, duration: 0, label: 'none' }]
  set.pad(1, 0)
  await set
  t.is(set.markers, [{ time: 1.75, label: 'a' }], 'the file\'s own replaced')
  t.is(set.regions, [{ at: 2, duration: 0.5, label: 'r' }], 'a range of no length none')
  // read and set again, the same
  set.markers = set.markers
  set.regions = set.regions
  t.is([set.markers, set.regions], [[{ time: 1.75, label: 'a' }], [{ at: 2, duration: 0.5, label: 'r' }]])
})

// mark({ at, duration }, label): a range, a region kept to what it marks as a moment is
test('mark — a range marked is a region, kept to through later edits', t => {
  let a = audio.from([new Float32Array(4 * 8000)], { sampleRate: 8000 })
  a.remove({ at: 0, duration: 1 }).mark({ at: 1, d: 0.5 }, 'chorus')
  t.is(a.regions, [{ at: 1, duration: 0.5, label: 'chorus' }], 'where it was put, `d` read as duration')
  t.is(a.markers, [], 'no marker of its own')
  a.pad(0.5, 0)
  t.is(a.regions, [{ at: 1.5, duration: 0.5, label: 'chorus' }], 'moved on by what came before it')
  a.remove({ at: 1.75, duration: 0.125 })
  t.is(a.regions, [{ at: 1.5, duration: 0.375, label: 'chorus' }], 'shortened by what is taken out of it')
  // past the end, to the end; reversed, the same span; no length, a moment
  t.is(audio.from([new Float32Array(8000)], { sampleRate: 8000 }).mark({ at: 0.5, duration: 5 }).regions, [{ at: 0.5, duration: 0.5, label: '' }])
  t.is(audio.from([new Float32Array(8000)], { sampleRate: 8000 }).reverse().mark({ at: 0.25, duration: 0.5 }).regions, [{ at: 0.25, duration: 0.5, label: '' }])
  t.is(audio.from([new Float32Array(8000)], { sampleRate: 8000 }).mark({ at: 0.25, duration: 0 }).markers, [{ time: 0.25, label: '' }])
  // on nothing, nothing
  t.is(audio.from([new Float32Array(0)], { sampleRate: 8000 }).mark({ at: 0, duration: 1 }).regions, [])
})

// Where a mark falls on what an edit made, not the source: a sound put in, it keeps to that sound; silence (a pad, a gap
// opened, a take written past the end), the sound nearest it, as far from it as it was, through the edits after it
test('mark — on silence or a sound put in, kept to as on the source', t => {
  let sr = 8000, one = s => audio.from([Float32Array.from({ length: s * sr }, (_, i) => Math.sin(i / 5))], { sampleRate: sr })
  let at = a => a.markers.map(m => m.time), ranges = a => a.regions.map(r => [r.at, r.duration])
  t.is(at(one(2).pad(0, 2).mark(3)), [3], 'in padding past the end')
  t.is(at(one(2).pad(0, 2).mark(3).remove({ at: 0, duration: 1 })), [2], 'moved on by what is taken out before it')
  // reversed, as far the other way, to a sample (a sample i reversed is n − 1 − i)
  let r = at(one(2).pad(0, 2).mark(3).reverse())
  t.ok(r.length === 1 && Math.abs(r[0] - 1) <= 1.01 / sr, `reversed: ${r}`)
  t.is(at(one(2).pad(0, 2).mark(3).speed(2)), [1.5], 'twice as fast, half as far')
  t.is(at(one(2).pad(0, 2).mark(3.5).crop({ at: 0, duration: 3 })), [], 'cropped away, gone')
  t.is(at(one(2).insert(1, { at: 1 }).mark(1.4)), [1.4], 'in a gap opened')
  t.is(at(one(2).write(one(2), { at: 2 }).mark(3).remove({ at: 0, duration: 0.5 })), [2.5], 'in a take written past the end')
  // a sound put in: its own sample, so what is taken out of it before the mark moves it
  t.is(at(one(2).insert(one(1), { at: 1 }).mark(1.5).remove({ at: 1, duration: 0.25 })), [1.25], 'in a sound inserted')
  // ranges alike: in silence alone, and from the sound on into silence
  t.is(ranges(one(2).pad(0, 2).mark({ at: 2.5, d: 1 })), [[2.5, 1]], 'a range in padding')
  t.is(ranges(one(2).pad(0, 2).mark({ at: 2.5, d: 1 }).reverse()), [[0.5, 1]], 'reversed')
  t.is(ranges(one(2).pad(0, 2).mark({ at: 1.5, d: 2 }).speed(2)), [[0.75, 1]], 'from the sound into padding, twice as fast')
  t.is(ranges(one(2).pad(1, 1).mark({ at: 0.5, d: 3 })), [[0.5, 3]], 'over the sound, from padding to padding')
  // set by time, as marked
  let s = one(2).pad(0, 2)
  s.markers = [{ time: 3, label: 'x' }]
  t.is(s.markers, [{ time: 3, label: 'x' }], 'set into padding')
})

// A whole render (roomtone) reads the timeline before it in place: a mark before it stays where it was
test('mark — through a whole render that keeps the time', async t => {
  let a = audio.from([Float32Array.from({ length: 2 * 8000 }, (_, i) => i % 8000 < 4000 ? Math.sin(i / 5) : 1e-4 * Math.sin(i))], { sampleRate: 8000 }).mark(1, 'kept').roomtone()
  await a
  t.is(a.markers, [{ time: 1, label: 'kept' }])
})

// A time past the end is as far past the last sound: the end while the audio is shorter, where it was put once an edit
// after it makes the audio reach it (a marker dragged past a take written later, as the editor writes it)
test('mark — past the end, the end until an edit after it reaches it', t => {
  let sr = 8000, one = s => audio.from([Float32Array.from({ length: s * sr }, (_, i) => Math.sin(i / 5))], { sampleRate: sr })
  let at = a => a.markers.map(m => m.time)
  t.is(at(one(2).mark(3)), [2], 'the end')
  t.is(at(one(2).mark(3).pad(0, 0.5)), [2.5], 'not reached yet: the end')
  t.is(at(one(2).mark(3).pad(0, 2)), [3], 'padded past it: where it was put')
  t.is(at(one(2).insert(1, { at: 2 }).mark(4.5).write(one(3), { at: 2.5 })), [4.5], 'a take written past the end')
  t.is(at(one(2).pad(0, 2).mark(3.5).crop({ at: 0, duration: 3 })), [], 'in the audio, then cropped away: gone')
  // a range all past the end: none while the audio is shorter, where it was put once it reaches it
  let ranges = a => a.regions.map(r => [+r.at.toFixed(3), +r.duration.toFixed(3)])
  t.is(ranges(one(2).mark({ at: 3, d: .5 })), [], 'a range past the end: none yet')
  t.is(ranges(one(2).mark({ at: 3, d: .5 }).pad(0, 2)), [[3, .5]], 'padded past it: where it was put')
})

// A copy is the sound: the file's own markers and those marked on it come with it, kept to through its edits, and an
// undone edit takes them back to where they were before it (a region of the output, found at an earlier step)
test('clone — keeps markers and regions; undone, they go back with the audio', async t => {
  await audio.from([new Float32Array(4 * 8000)], { sampleRate: 8000 }).mark(3, 'own').save('/tmp/fix-clone-own.wav')
  let file = await audio('/tmp/fix-clone-own.wav')
  t.is(file.clone().markers, [{ time: 3, label: 'own' }], "a file's own, on a copy of it opened")
  let a = audio.from([Float32Array.from({ length: 10 * 8000 }, (_, i) => Math.sin(i / 5))], { sampleRate: 8000 })
  a.remove({ at: 1, d: 2 }).stretch(1.5, { at: 4, d: 2 }).lowpass(1000).mark(0.5, 'm').mark({ at: 5, d: 1.5 }, 'r')
  let b = a.clone()
  t.is([b.markers, b.regions], [a.markers, a.regions], 'the copy has them')
  b.undo(2)
  // to the sample (1/8000 s) the stretch rounds to
  let ms = r => [+r.at.toFixed(3), +r.duration.toFixed(3)]
  t.is(b.regions.map(ms), [[4.667, 1]], 'before the stretch: 2 s stretched to 3 there')
  b.undo()
  t.is(b.regions.map(ms), [[6.667, 1]], 'before the remove: 2 s later')
  t.is(a.regions.map(ms), [[5, 1.5]], 'the original as it was')
})

// An edit prepared before it renders (a model's run over its input: deepfilter(), vocals({ model })) leaves the timeline
// unknown till then where a later edit reads the sound (normalize(), trim()): a mark after them waits till the audio is
// read, then lands where it was put. Its length asked before that fails, and the read after renders all the same, the
// stages that failed sought again
test('mark — after an edit prepared before rendering, once the audio is read', async t => {
  let PREPARED = Symbol('prepared')
  audio.op('prepared', {
    prepare: async (a, i) => { a.edits[i][1][PREPARED] = true },
    process: (input, output, ctx) => { if (!ctx[PREPARED]) throw new Error('prepared: not yet'); input.forEach((x, c) => output[c].set(x)) }
  })
  let one = () => audio.from([Float32Array.from({ length: 3 * 8000 }, (_, i) => (i >= 8000 && i < 16000 ? .5 : 1e-3) * Math.sin(i / 5))], { sampleRate: 8000 })
  let a = one().prepared().normalize().mark(1, 'm').mark({ at: 1.5, d: .5 }, 'r')
  t.throws(() => a.duration, /prepared: not yet/, 'its length, before it is read')
  await a.read()
  t.is(a.markers, [{ time: 1, label: 'm' }])
  t.is(a.regions, [{ at: 1.5, duration: .5, label: 'r' }])
  let b = one().prepared().trim().mark(.5, 'half')
  await b.read()
  t.is(b.markers.map(m => m.label), ['half'], 'after a trim it reads the sound for')
  // a sound mixed in, its edit not prepared either: its length asked first fails, and leaves the read after to render
  let c = one().mix(one().prepared()).normalize()
  t.throws(() => c.duration, /prepared: not yet/)
  t.is((await c.read())[0].length, 3 * 8000, 'the mix read after')
})
