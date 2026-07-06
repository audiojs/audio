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
