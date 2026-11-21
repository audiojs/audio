# Plugins

See also: [Architecture](architecture.md)

A plugin registers ops, stats, or methods on `audio`.

```js
// my-plugin.js
import audio from 'audio'

const myOp = (input, output, ctx) => {
  for (let c = 0; c < input.length; c++)
    for (let i = 0; i < input[c].length; i++)
      output[c][i] = -input[c][i]
}

audio.op('myOp', myOp)                       // shorthand for { process: myOp }
// or explicitly:
audio.op('myOp', { process: myOp })
```

```js
import 'my-plugin.js'   // registers op + wires a.myOp()
```

## Ops

A block processor: `(input, output, ctx) => void`.

`input` and `output` are separate `Float32Array[]` per channel, `BLOCK_SIZE` samples (1024 default, last block may be shorter). Read from `input`, write to `output` — never assume they alias. The engine pre-allocates two buffer sets and rotates them per op in the pipeline chain (previous output becomes next input). Zero allocation in the hot path.

`ctx` persists across chunks — set any property for stateful computation. Fixed fields update per chunk: `at`, `duration`, `sampleRate`, `blockOffset`, `totalDuration`, plus named params and any extras from the edit object.

When an op declares `params`, positional arguments are mapped to named properties on `ctx`. Prefer `params` so processors read explicit names (`ctx.value`, `ctx.freq`, etc.) rather than positional arrays.

- `at`/`duration` — op time range (seconds), chunk-relative
- `totalDuration` — full audio duration (seconds)
- `blockOffset` — absolute position of this chunk (seconds)
- `channel` — which channel(s) the op is scoped to

Convert to samples:

```js
let sr = ctx.sampleRate
let start = ctx.at != null ? Math.round(ctx.at * sr) : 0
let end = ctx.duration != null ? start + Math.round(ctx.duration * sr) : input[0].length
```

For passthrough (no-op), copy input to output:

```js
for (let c = 0; c < input.length; c++) output[c].set(input[c])
```

### Options

By default, edits are stored as `['myOp', opts]`.

Any plain object as the last argument is treated as options. Known keys (`at`, `duration`, `channel`) are extracted; sample-based aliases `offset`/`length` convert to `at`/`duration`. **All other keys** flow through as extras and arrive in `ctx`:

```js
a.fade(1, { curve: 'exp' })
// → edit: ['fade', { in: 1, curve: 'exp' }]
// → ctx.curve === 'exp'
```

With `params`, named params can live in the options object too — no positional args needed:

```js
a.gain({value: -6, at: 0.5})
// → edit: ['gain', { value: -6, at: 0.5 }]
// → ctx.value === -6, ctx.at === 0.5
```

### Querying ops

```js
audio.op('gain')  // → descriptor { process, ... } or undefined
audio.op()        // → all ops: { gain: {...}, crop: {...}, ... }
```

## Descriptor

Each op is a descriptor object with stage handlers and options. Pass a function for the shorthand process-only form, or an object for the full form:

```js
audio.op('myOp', myProcess)                          // shorthand for { process: myProcess }
audio.op('myOp', { process, plan, resolve, ... })    // full descriptor
```

Stage handlers (each op defines one or more):

```js
audio.op('myOp', {
  params: ['arg1', 'arg2'],               // named positional arguments → ctx.arg1, ctx.arg2
  process: (input, output, ctx) => { },   // per-block PCM transform (read input, write output)
  plan: (segs, ctx) => segs,              // structural segment rewrite
  limit: (limit, ctx) => limit,           // with plan: of `limit` input samples while decoding, the output that is final
  expand: (ctx) => edit,                  // macro: rewrite into simpler edit(s), no stats
  resolve: (ctx) => edit,                 // stat-conditioned: replace using decoded stats
  ranged: true,                           // op handles {at, duration} itself — engine skips its range scoping
  auto: 'sample',                         // op samples function params itself (default: engine, 128-sample steps)
                                          // 'own': takes functions, curves and patched values as they are (a hosted processor)
  fnArgs: ['arg1'],                       // params that are genuine functions, not automation (e.g. transform's fn)
  settle: (o) => o,                       // an edit's options checked and settled as it is made (a plugin's units)
  prepare: async (a, index) => { },       // async work before render (model inference), see below
})
```

`process` ops get `{at, duration}` range scoping, function-param automation, and click-free
value ramps from the engine automatically — declare `ranged`/`auto`/`fnArgs` only to opt out
or take over.

### params

Declare named positional arguments. The first positional arg maps to `ctx[params[0]]`, the second to `ctx[params[1]]`, etc. This applies to all stages: `process`, `plan`, and `resolve`.

```js
audio.op('gain', {
  params: ['value'],
  process: (input, output, ctx) => {
    let g = 10 ** (ctx.value / 20)
    for (let c = 0; c < input.length; c++)
      for (let i = 0; i < input[c].length; i++)
        output[c][i] = input[c][i] * g
  }
})
```

With `params`, calling with a single options object works naturally — named params and range opts coexist:

```js
a.gain({value: -6, at: 0.5})  // named param + range opt → ctx.value = -6
a.eq({freq: 1000, Q: 2})      // multiple named params
```

Positional args override opts for the same param. If both `a.gain(-6, {value: -3})` are present, the positional `-6` wins.

### plan

Rewrite the segment map without touching PCM. For ops that change timeline geometry (crop, insert, remove, repeat, pad, reverse, speed).

`compilePlan(a, len, final)` compiles `a.edits` into a segment map + sample pipeline + limit. Edits are the source of truth; segments are the compiled form — like bytecode from source, or DOM patches from VDOM. Segments are never maintained manually — they rebuild on any edit change.

During streaming (`final=false`), compilePlan is called repeatedly as more source data arrives. Each call recompiles all edits from scratch and tracks a `limit` — the safe output boundary given current source length. `adjustLimit(limit, type, ctx)` transforms the limit per op. When `final=true` (fully decoded), limit equals `totalLen`.

`ctx` has `total`, `sampleRate`, `offset`, `length`, plus named params from `params`. The `offset`/`length` are `at`/`duration` pre-converted to samples (`null` if unset).

```js
import { seg } from 'audio/plan.js'

audio.op('myRepeat', { plan(segs, ctx) {
  let r = [...segs]
  for (let s of segs) { let n = s.slice(); n[2] = s[2] + ctx.total; r.push(n) }
  return r
} })
```

Most structural ops already have reusable segment transforms you can import instead of writing raw segment math:

```js
import { cropSegs } from 'audio/fn/crop.js'       // cropSegs(segs, offset, length)
import { insertSegs } from 'audio/fn/insert.js'   // insertSegs(segs, at, length, ref)
import { removeSegs } from 'audio/fn/remove.js'   // removeSegs(segs, offset, duration)
import { reverseSegs } from 'audio/fn/reverse.js' // reverseSegs(segs, offset, end)
import { speedSegs } from 'audio/fn/speed.js'     // speedSegs(segs, rate)
```

#### Segment format

A segment is a copy instruction: `[from, count, to, rate?, ref?, interp?]`.

Read `count` samples from source at `from`, write to output at `to`. All offsets are absolute — segments are independent, not linked. You can process them in any order, binary search by output position, or skip segments for partial renders.

| Index | Field | Description |
|-------|-------|-------------|
| `0` | from | Read offset in source (samples) |
| `1` | count | Number of samples to copy |
| `2` | to | Write offset in output (samples) |
| `3` | rate | Source read rate. Omit or `1` = forward. `-1` = reverse (used by `reverse()`). `2` = read 2× faster, halving duration (used by `speed()`). `0.5` = half speed, doubling duration. The `speed` op multiplies existing rates and adjusts `count` — `speed(2)` on a 10s segment produces `count/2` at `rate*2`. The renderer uses linear interpolation for non-unit rates unless `interp` is set. |
| `4` | ref | Source: `undefined` = self, `null` = zero-fill (silence), audio instance = external |
| `5` | interp | Optional interpolation function for non-unit `rate` reads. It receives `(src, target, tOff, n, rate, phase)` and may expose `.margin` for source context. |
| `6` | env | Optional fade envelope: flat pairs `[p0, p1, …]` of fade phase at the segment's start and end, linear between; gain Π sin(p·π/2). Envelope segments are summed, not written, so a fade-out and fade-in over the same span form an equal-power crossfade (`remove`/`insert` with `crossfade`). |

`seg(from, count, to, rate?, ref?, interp?, env?)` creates a segment; `subSeg(s, at, n, to)` cuts one to a sub-range (envelope included); derive segments through it rather than by hand.

#### Examples

10s audio at 44100 Hz starts as one segment — the whole source maps 1:1 to output:

```
[0, 441000, 0]       →  read all 441000 samples from 0, write at 0
```

After `crop({at: 2, duration: 3})` — keep only 3s starting at the 2s mark:

```
[88200, 132300, 0]   →  read 132300 samples from 88200, write at 0
```

After `insert(silence, {at: 1})` — split at 1s, insert 1s silence, shift the rest:

```
[0, 44100, 0]              →  first 1s unchanged
[0, 44100, 44100, , null]  →  1s silence (ref=null means zero-fill)
[44100, 396900, 88200]     →  remainder shifted right by 1s
```

After `reverse()` — same range, negative rate:

```
[0, 441000, 0, -1]  →  read backwards
```

### expand

Pure macro expansion — rewrite this op into simpler edits, no stats needed. Same return
contract as `resolve` below, same ctx minus `stats`. Use it whenever the rewrite depends
only on parameters (fade in+out → two fades, stretch → segment rate + DSP stage,
resample → `_resample_seg`, crossfade → pad + blend). Reading `expand` vs `resolve` in a
descriptor tells you at a glance whether an op needs decoded audio before it can plan.

```js
audio.op('fade', {
  params: ['in', 'out'],
  process: fade,
  expand: (ctx) => typeof ctx.out === 'number'
    ? [['fade', { in: ctx.in }], ['fade', { in: -Math.abs(ctx.out) }]]
    : null  // single-sided — fall through to own process
})
```

### whole

Whole-render processing — same `(input, output, ctx)` signature as `process`, called
**once** with the entire signal (`streaming: false` contract plugins register this way
via `audio.use`). At compile the engine materializes the plan so far, runs the hook,
and continues from the result as a reference segment — downstream ops apply to the
processed output, undo unwinds the single edit, and the materialization is cached per
version. During a live decode the safe limit stays 0 (the whole signal isn't known
yet); output begins once decode completes. Bounded by the flat-render guard (2³⁰
samples). Cannot be emitted by `expand`/`resolve`. A `streaming: false` plugin given `{ at, duration }`
reads the whole signal and keeps its output in the range alone; the hook gets `ctx.at`/`ctx.duration` to do so itself.
An edit on chosen channels (`channel`) hands the hook those alone, in and out, and the others stay as they came, as
with `process`; a hook that changes the length (`frames`) is handed every channel, with `ctx.channel`.

### sidechain key

A contract plugin declaring more than one input bus (`channels: { inputs: [2, 2] }`)
receives bus 1 from the op's `key` option: an audio instance, an AudioBuffer (what
`decodeAudioData` gives) or `Float32Array[]`, each carrying as many channels as it holds
(any other value is an error at the call), rendered per block at the op's timeline
position, sample-rate-reconciled, page-primed and awaited like any ref:

```js
music.ducker({ key: voice, threshold: -30 })
```

### load

A lazy module for the op, resolved before any plan compiles. The atom stays out of the bundle
until an edit uses it; `process`/`whole` read it from `desc.mod`:

```js
audio.op('repair', {
  params: ['band'],
  load: () => import('@audio/denoise-repair'),
  process: (input, output, ctx) => { let repair = audio.op('repair').mod.default /* … */ }
})
```

### prepare

`async (a, index) => void`, awaited per edit after `load`, before anything renders: work an
edit needs that cannot run inside the synchronous render, such as model inference over its
whole input. The edit's input is `a` as the edits before it leave it; the op keeps its result
on the edit's options under a symbol key, which reaches `ctx` and stays out of serialization.
`vocals({ model })` separates this way, then its `process` copies the result block by block.
A prepare that needs only part of its input reads that range, and a source still arriving is
waited for only that far: `denoise({ noise: { at, duration } })` learns its noise print from the
range, then streams (its input `audio.from(a)`, which follows a source still arriving, with `a`'s
edits before `index`).

An op made once over its whole input and played back by offset takes both halves from `plan.js`:

```js
import { prepared, playback } from 'audio/plan'
const MADE = Symbol('myop.made')
audio.op('myop', {
  params: ['amount'],
  // own(o) checks the options and names what they change; make(pcm, sampleRate, o) gives the output's channels
  prepare: prepared(MADE, o => `${o.amount ?? 1}`, (pcm, sampleRate, o) => pcm.map(x => x.map(v => v * (o.amount ?? 1)))),
  process: playback('myop', MADE)
})
```

It reads the input once, the channels the edit's `channel` picks, and makes it again only when the input changes: the
instance's stamp first (`stampOf`), then the samples' fingerprint, so an edit before it that leaves the samples as they
were runs nothing. `inputOf(a, index)` is that input, for a prepare of its own.

### ranges

An op that reads its own `at`/`duration` (`ranged: true`) takes them from `plan.js` too: `opRange(ctx, len)`, the
range in this block's samples, for an op without state; `rangeOf(ctx)`, the range on the timeline, for one that keeps
state across blocks (an STFT's frames); `spanOf(n, at, duration, sr)`, the range of a whole signal, for a whole-render
op. A duration alone starts at 0, as the engine's own range scoping reads it.

### latency

Declared lookahead in samples — a number, or `(opts, sampleRate) => samples` for
param-dependent delay lines. The engine compensates at the plan level (plugin delay
compensation): render cursors run the pipeline's total latency ahead of the requested
timeline, so delayed output lands aligned and the final samples flush through
past-the-end silence. Contract plugins declare `latency` per CONTRACT.md and
get this automatically.

### warmup

Input the op must see before an output position to produce it: a number of samples or
`(opts, sampleRate) => samples`. Seeks and ranged reads start the pipeline that much earlier
and discard the lead-in, so a read from the middle equals the same span of a full render. An
STFT op warms up over the frames overlapping its first output; a repair over the context it
interpolates from.

### holdback

How much output depends on the unknown end of a live stream: `(opts, sampleRate, total) => samples`,
for pipeline and resolve ops alike (`total` for a decision that needs all of it).
While the source is still arriving, output stops that far before the current end and resumes
as more arrives, so a week-long stream with a fade-out holds back the fade's length, not the
week. Ranges counted from the end (`{at: -2}`) hold back by themselves; declare `holdback` for
end-relative parameters the engine can't see:

```js
audio.op('fade', { holdback: (o, sr) => o.in < 0 && o.at == null ? -o.in * sr : 0, /* … */ })
```

### streaming

A live source (`audio()` + `push`, a pipe, a socket, a response body) renders as it arrives,
and its output equals the whole-file render. Every op streams, holding back only its declared
`latency`, `warmup` and `holdback`, except `whole` ops, plugins registered `streaming: false`,
`reverse()` of everything and the clipboard: those wait for the end, and so does a decision that
reads the whole input (declared as a holdback of all of it: trim's automatic threshold, normalize's
one gain for the selection). A resolve op after an op its stats can't be derived through (trim
after a filter) gets the stats of the stage before it, accumulated as that stage renders. Nothing
is processed past what is settled, the latency pre-roll included. [test/stream.js](../test/stream.js) checks each chain live against the
whole file and keeps the list of ops that still wait; that list only shrinks.

### resolve

Pre-render replacement using decoded stats (stat-conditioned — trim, normalize). The engine
remaps stats through any structural edits already in the chain, so `ctx.stats` is always in
this op's own output space. During incremental streaming, `ctx.stats` may come from
`stats.snapshot()` with `partial: true` — resolve can return partial results that refine as
more data decodes (e.g. trim detects head silence early, normalize applies gain from
available peaks). Output stops at the stats horizon, and a decision the rest of the stream can
still change is held back: trim holds a silent tail until sound resumes or the stream ends,
shrink holds an open pause at its target gap.

```js
audio.op('trim', {
  params: ['threshold'],
  process: trim,
  resolve: (ctx) => {
    let { stats, sampleRate, totalDuration, threshold } = ctx
    if (!stats?.min) return null  // no stats — fall back to per-page
    // ...analyze stats to find silence boundaries...
    return ['crop', { at: start / sampleRate, duration: (end - start) / sampleRate }]
  }
})
```

`ctx` has `stats`, `sampleRate`, `channelCount`, `channel`, `at`, `duration`, `totalDuration`, plus named params and edit extras. Return:
- **edit(s)** — replace this op with simpler op(s)
- **`false`** — skip (no change needed)
- **`null`** — fall back to per-page processing

`resolve` runs at render time with decoded audio stats and replaces abstract ops with concrete ones.

Once the whole signal is known (`ctx.final`), `ctx.measure(edits)` renders the plan so far plus
candidate pipeline edits and returns their block stats: a what-if pass for decisions stats alone
can't make exactly. `normalize` uses it to land loudness through its true-peak limiter, after
stepping on a block model; its `adaptive` mode, which decides while a stream is live, stays on the
model. An op that measures holds its output until the end (holdback), so nothing it decides is
emitted before it measures.

### pointwise

Mark an op as a pure, monotonic per-sample transform: output depends only on input value, not position or history.

```js
audio.op('clamp', {
  pointwise: true,
  params: ['limit'],
  process: (input, output, ctx) => {
    let limit = ctx.limit
    for (let c = 0; c < input.length; c++)
      for (let i = 0; i < input[c].length; i++)
        output[c][i] = Math.max(-limit, Math.min(limit, input[c][i]))
  }
})
```

The engine auto-derives min/max/clipping stats by probing `process` with edge values — no full stream recompute needed after edits. `a.stat('db')` resolves instantly. Energy, mean square and DC of a nonlinear map aren't functions of block extremes, so queries that need them (`loudness`, `rms`, `dc`) render instead.

Don't use for stateful ops (filters) or position-dependent ops (fades, automation).

For advanced cases where rms/dc/energy need algebraic precision, use `deriveStats: (stats, opts) => {}` instead — see `gain` and `dc` ops for examples. It moves the fields it can (min, max, dc, ms, energy); the engine recounts clipping from the new extremes.

### Persistent ctx

`ctx` is the same object across all chunks — any property you set persists. Fixed fields (`at`, `blockOffset`) update each chunk; everything else stays. This handles algorithmic state like IIR filter memory:

```js
const filter = (input, output, ctx) => {
  if (!ctx.z) ctx.z = input.map(() => 0)  // init once, persists across chunks
  for (let c = 0; c < input.length; c++) {
    output[c].set(input[c])
    // ...use ctx.z[c] for filter memory, mutate output[c] in-place
  }
}

audio.op('filter', { process: filter })
```

When seeking mid-stream, the engine silently renders 8 prior blocks to warm up stateful ops before producing output.

## Stats

Register a stat descriptor:

```js
audio.stat('mystat', {
  block: (chs, ctx) => chs.map(ch => /* number */),
  reduce: (blockValues, from, to) => { let v = 0; for (let i = from; i < to; i++) v += blockValues[i]; return v },
})
```

Or shorthand (block-only, no scalar/binned query):

```js
audio.stat('mystat', (chs, ctx) => chs.map(ch => /* number */))
```

`block` is called per 1024-sample block during decode. Return number (all channels) or array (per-channel). Stored in `a.stats.mystat` as `Float32Array[]`.

One pass can serve several stats: register the same `block` function for each and return a record keyed by stat name. The engine calls a shared function once per block; the built-in `min`/`max`/`dc`/`clipping`/`ms`/`correlation` share one pass.

```js
const band = chs => ({ lo: chs.map(lowEnergy), hi: chs.map(highEnergy) })
audio.stat('lo', { block: band, reduce: rMean })
audio.stat('hi', { block: band, reduce: rMean })
```

A record can also carry fields no stat is named after: list them in `extra` and they land in `a.stats` beside the stat's own. A field that holds its block's place on a grid counted from the start of the stats names the grid's `period: sr => samples`: an edit that moves blocks by other than whole periods drops the field, and a query that needs it measures again (a range: the range itself). The `energy` stat does this for the 100 ms grid of BS.1770's gating blocks (`kcut1`, `kcut2`), so integrated loudness is exact from block stats. `a.stats.length` is the samples the blocks cover; the last block can be short.

`reduce` is `(blockValues, from, to) → number` — it combines the values returned by `block`, enabling `a.stat('mystat')` scalar and `a.stat('mystat', {bins})` binned queries.

`query` adds a derived aggregation: `query(stats, chs, from, to, sr) → value`. Used for stats that derive from other block data (e.g. `db` derives from `min`/`max`, `peak` from `min`/`max`, `rms` from `ms`).

`a.stat(name, { bins: n })` gives n numbers on the block grid: `reduce` over each bin's blocks, else `query` over them, else a stat plugin (or a stat with its own method) over each bin's `{ at, duration }`; a null is NaN. A stat whose value is not a number (events, a key, a spectrum) answers once for the whole range.

`ctx` has `sampleRate` and persists across blocks within one decode session (and across the blocks of a playback, for the meter) — set any property for stateful computation.

Registered stats auto-participate in the playback meter — `a.meter('mystat', cb)` streams per-block values during playback. Block-defined stats emit the raw block value; `query`-defined stats are evaluated against a single-block pseudo-stats window.

Stat option values that are audio instances (e.g. `similarity`'s `ref`) pre-render to PCM:

```js
await audio.use('truepeak', 'similarity')
await a.stat('truepeak')                    // −0.4 dBTP (inter-sample, BS.1770)
await a.stat('similarity', { ref: b })
```

## Codecs

Codec plugins — `{ codec: fmt, test?(bytes), decode?(bytes), encode?(opts) }` — extend what `audio()` can open (header sniffed via `test` where magic-byte detection draws a blank) and what `save()`/`encode()` can write. Every `@audio/decode-*` / `@audio/encode-*` package ships its half as an `audio.js` manifest — halves merge by format name; the bundled umbrellas keep precedence for formats they already serve (streaming decode stays streaming), so codec plugins matter for standalone hosts and formats beyond the bundled set.

## Engine-less hosts

Plugins also run without the engine: `audio/batch` hosts one over a whole signal, `audio/stream` over live chunks — same param semantics (defaults, automation functions and curves, smoothing), no plan or context.

```js
import { toBatch, toStream } from 'audio/batch'
const compress = toBatch(compressor, { sampleRate: 44100 })
const out = compress(samples, { params: { threshold: -24 } })
```

Both take, beside `params` (a value, a function of the time in seconds, or a curve `{ t, v }`): `buffers` (`{ ir: Float32Array[] }`: planar arrays at the render's rate; a sound is an error, as these hosts cannot render one), `notes` (`[{ time, midi, duration, velocity }]`, seconds), `transport` (`{ bpm, timeSig: [6, 8] }`, which sets `ctx.transport` at each call) and `maxBlockSize`. They keep the host's duties as audio does: a value changes between calls only, a call starts where one jumps, and while one moves (an automation function, a curve's slope, a `smoothing` ramp) no call is longer than 32 frames; where nothing moves, a call is a whole block. `smoothing` ramps a jump (a value set anew, a curve's step) from the value in force; a function or a curve's slope is its own value, not smoothed again, and a step into a slope ends on the slope. A number reaches the processor clamped to its range and, where it declares a `step`, on the nearest step from `min` (a tie upward): a value, automation and a smoothing ramp alike. A processor that declares a count on an input bus (`channels: 2`, a key of 2) gets that many: one channel fed is copied to each, another count is an error naming both. Its input holds no NaN or Infinity: one in what is fed reaches it as 0, in a copy of that channel, the arrays given left as they are; a clean input is handed over as it is. `toBatch` returns what the processor wrote, raw: as many frames as it was given (a whole-signal processor's `frames` says how many it writes), its latency not compensated and no tail rendered. For either, use `toStream` (its `latency` says how many frames lead the output, `end()` renders the tail) or audio itself (`audio.use(processor)`: an op that compensates latency and renders the tail). `toStream` builds its instance at the first `write`, from that chunk's channels: a bus carries from then on what it carried there, a later chunk of one channel copied to each of more; a chunk of another count is an error, since other channels are another instance (another `toStream`); `write(chunk, params)` takes values by name or alias (a jump at the chunk's first frame, ramped over a param's `smoothing`), not functions or curves; `write(n)` renders n frames with nothing fed (a generator); `end()` renders the tail, its function read with the values in force then, and none for a tail of `Infinity`, which cannot be flushed. A `latency`, `tail` or `frames` function is handed `{ sampleRate, params, buffers, transport }`, `transport` as `ctx.transport` is where the host asks, of the `transport` option's tempo (none: 120 bpm, 4/4, standing still): where the input ends for a tail (so a delay synced to the tempo can declare its echoes at that tempo, not the longest its line holds), at the start for the others. Each is asked outside the block loop (`frames` at the call, `latency` as `toStream` is made, `tail` at `end()`; audio asks all three as it plans a render), so it may allocate.

## Note events

Note-event instruments (`voice`, `poly`) take a `notes` list — the host compiles it to contract §events slots:

```js
await audio.use('poly')
audio(4).poly({ notes: [{ time: 0, midi: 60, duration: 1 }, { time: 0, midi: 64, duration: 1 }] })
```

Each call's `ctx.events` holds its notes as `{ time, kind: 'on' | 'off', midi, velocity, id }`: `time` the frame within the call, sorted, at one frame an off before an on; `velocity` 0..1; ids from 0 in the list's order, an off carrying its on's. Each slot also has `pitch`, the same as `midi`, for manifests published before 1.0.

## A processor's options

A processor hosted as an op takes, beside its params: its buffers by name (`a.cabinet({ ir: speakerSound })`: a sound is rendered at the op's rate, samples pass as they are); a further input bus by its `name`, `key` where it has none, a sound (`a.ducker({ key: voice })`), the first one also as the call's first argument where that is a sound (`a.ducker(voice, -30)`: key and threshold; any other first argument is the first param, `a.compressor(-30, 8)`: threshold and ratio, whether the compressor has a key bus or not); `notes`; `bpm` and `timeSignature`, the tempo `ctx.transport` counts beats by from the timeline's start (with none, it stands still at 120 bpm, 4/4), and the transport its `latency`, `tail` and `frames` functions are handed, as in the engine-less hosts above (a tail's where its input ends); and `emitted(name, value, time)`, which receives what it reports with `ctx.emit`. A change of a `restart` param, of a buffer or of `layouts` while it plays builds a new instance, crossfaded in as a changed chain is; other values change in place. A processor that declares a count on input bus 0 (`channels: 2`) gets that many channels: a mono sound is copied to each, as a plugin host feeds a mono track to a stereo plugin, and the edits after it read its output's width (a range, or a `mix` where the processor has no `mix` param of its own, is then an error, where the width changes: make the sound that wide first, `a.remix(2)`); a sound of another count is an error at the render, naming both. A further bus that declares a count is fed the same way (a mono key to a key of 2). On chosen channels (`channel`) such a processor runs only on as many as it takes and makes, written back in place, the others as they came, whether it streams or reads the whole signal (`streaming: false`): `a.panner({ channel: [2, 3] })` on a sound of four; a generator (no input bus) writes into a choice of as many channels as it makes, and takes a range or a `mix` there, the sound's width kept. Another choice (`channel: 0` of a stereo sound) is an error at the call, or at the first read for a registry op called before it loaded. A processor that changes the length (`frames`: a stretch) is handed every channel whatever `channel` chooses and stretches them all, and a choice the sound lacks is no error: audio's own length-changing ops (`speed`, `resample`, `crop`, `remove`, `pad`, `repeat`, `reverse`) ignore a choice too. Its params, buses and samples reach it as in the engine-less hosts above: numbers clamped and on their step, no NaN or Infinity. Its tail is rendered after the input, whole however long; of an endless one (a `tail` of `Infinity`: a reverb held open, a ladder at full resonance, an integrator) `audio.TAIL` seconds, 10 by default and read at the render (`audio.TAIL = 30` before reading the sound). A repair or a pitch shift keeps the take's length: the registry's repairs (dehum, specsub, wiener, omlsa, deplosive, dewind, dewow, debleed, declip, decrackle, debreath, desqueak, rnnoise, deesser) and pitch shifts (vocoder, formant-shift, paulstretch, pitch-shift and the shifters `pitch(n, { method })` loads), whose packages say `restoration` or `pitch-shift` in their keywords (the finer category the contract has a host read there), render none of the tail they declare, since what they ring past the end is their own processing spread there (an STFT frame's, a grain's), not sound the take had. A time stretch makes the length its factor says, `round(n · factor)` frames: the registry's stretches (the `stretch-*` ops `stretch(f, { method })` loads), whose packages say `time-stretch`, render none of the tail they declare either (paulstretch's smear past the stretched end, which @audio/stretch-paulstretch declares since 1.2.3). The rule is the op's, by its name: the same processor handed in (`import { vocoder } from '@audio/shift-pvoc/audio'`, then `audio.use(vocoder)` or `audio.op('vocoder', vocoder)`) is hosted as the registry hosts it; under a name of your own (`audio.op('my-shift', vocoder)`) it is your op and renders the tail it declares, unless the edit says `tail: false`. Over the take a streaming processor's samples are the same either way; a whole-signal one's are too, unless it sets them by a measure of all it makes (a gain matched to its output's peak, which the ring can hold). An edit's `tail` says otherwise, as `convolve`'s and `plugin`'s does: `true`, the ring it declares (`a.vocoder({ semitones: 5, tail: true })`, `a.pitch(5, { method: 'psola', tail: true })`); `false`, none (`a.freeverb({ tail: false })`); a number, that many seconds, where the processor declares a tail (one that declares none renders none). A processor with a param of its own named `tail` takes the option as that param. A processor of your own under one of these names (`audio.op('vocoder', myVocoder)`) is hosted the same way: its tail renders only where the edit says `tail: true`.

## Registry

`audio.plugins` maps name → package; the packages install with `audio`. Registry ops are instance methods from the start: `a.compressor(-30, 8)` records the edit and the package loads (dynamic import) at the first render, mapping the positional args onto its params; `a.run(['compressor', { args: [-30, 8] }])` records them so too, since an edit is `[name]` or `[name, options]` and any other shape (`['compressor', -30, 8]`) is an error; a trailing `undefined` is one not passed, as in a call, and a param given `null` is its default. Until then the edit can't be planned at once: `a.duration` throws, saying so, and a `mark()` after it waits for the first read; `a.channels` answers, with the width such an op makes where it changes it (`surround`: six; `widener` or `panner` on a mono sound: two), and throws, naming the op, only where a `layouts` option picks the width (the ambisonic ops); `await audio.use('compressor')` before the call plans it at once. Registry stats load inside `a.stat(name)`. The CLI resolves names the same way; a param is named `name:value`, a one-letter one too (`deesser Q:3`; `C:\take.wav` stays a path), and a sidechain file is `key:FILE` (`ducker key:voice.wav`).

A plugin's parameter that declares a `unit` takes a value written with one, in that unit, here, in `audio/batch` and on the command line: `a.compressor({ attack: '10ms' })`, `{ attack: '0.01s' }` and `{ attack: 10 }` are one attack, in ms; `a.delay({ time: '250ms' })` is 0.25 s; `attack: '3db'` is an error. Here and in `audio/batch` a value of another kind than its parameter's is an error at the call too, naming what was passed: a number takes a number (not `NaN`) or a value with a unit (`a.ducker(oneChannel, -30)`: `ducker: threshold takes dB, not a Float32Array`), an enum one of its values (`a.expander(-30)`: `expander: mode takes 'downward' or 'upward', not -30`), a bool `true` or `false` (on the command line the word, by its place too: `limiter -1 5 50 false`), and each a function of the time or a curve, which is an error where it gives a value of another kind (an enum's or a bool's curve holds each point's value to the next). A parameter flagged `restart` (`restart: true`, or `flags: ['restart']` as manifests published before 1.0 mark it) is read once, as the processor is built: a function or a curve for it is an error, and so is a change between `audio/stream` chunks. A processor registers under its `id`, else its function's name: one with neither throws. Under a built-in op's name it throws too, and `audio.op('my-gain', processor)` registers it under another; under the name of a processor registered before, it replaces that one (a script run again defines its processor again); the same processor again is already there; under an instance method's name (`read`, `save`), which no call could reach, it throws. A stat plugin follows the same rule: a built-in stat's, an op's or a method's name throws, another stat plugin's is replaced. An op whose name is not an identifier (a dashed id, `transient-shaper`) is also a method under its camelCase, `a.transientShaper()`, which records the edit under the name, unless that is a method already (an instance's own, another op's).

`audio.import(spec)` is how a registry package loads, `import(spec)` by default. A bundle whose bundler cannot follow a computed `import()` (a worker has no import map) replaces it with literal imports: `audio.import = spec => loaders[spec]()`. The editor's worker does this with one generated `() => import('…')` per registry package.

Op plugins:

**dynamics** compressor · limiter · gate · expander · deesser · ducker · compand · softclip · leveler · transient-shaper · multiband · fet · opto · varimu · vca —
**denoise** dehum · specsub · wiener · omlsa · dereverb · deplosive · dewind · dewow · declip · decrackle · debreath · rnnoise (optional package: `@audio/neural-denoise`) · vocos (optional package: `@audio/neural-vocode`) —
**effects** delay · chorus · flanger · phaser · tremolo · vibrato · autowah · wah · bitcrusher · distortion · exciter · ringmod · freqshift · multitap · pingpong · slew · noiseshaper · lofi · graindelay · stutter · subbass · sbr · rotary · tapestop —
**reverb** freeverb · schroeder · plate · fdn · spring · shimmer —
**filter** moog · korg35 · diode · oberheim · resonator · spectral-tilt · variable · comb · dcblocker · emphasis · deemphasis · derivative · integral · a-weighting · b-weighting · c-weighting · d-weighting · k-weighting · itu468 · riaa —
**eq** geq · tilt · baxandall · dyneq —
**spatial** widener · haas · panner · autopan · midside · microshift · surround · ambisonic-panner · ambisonic-decoder · ambisonic-rotate —
**shift** pitch-shift · vocoder · formant-shift · paulstretch —
**color** tape · transistor · waveshaper · multisat · amp · cabinet · defeedback —
**generate** osc · noise · chirp · pluck · risset · rhythm · sfx · kick · cymbal · snare · adsr · voice · poly · tonewheel · fm · bell · epiano · modal —
**more** tube · isolate · tune

Stat plugins (land on `a.stat(name)`):

**loudness** truepeak · lra · replaygain · dr · speech-contrast · sounds —
**spectral** rolloff · spread · slope · flux · contrast · ltas · zcr —
**mir** structure · tempogram · melody · downbeat · fingerprint · drums · multif0 · transcribe · similarity · coversong · chroma · tonnetz

Beyond the registry — kernels whose inputs aren't scalar params ship as plain packages for direct import: `@audio/reverb-convolution` (impulse response), `@audio/eq-fir` (response curve), `@audio/eq-crossover` (SOS designer), `@audio/tune-midi` (guide notes), `@audio/denoise-repair` (regions), `@audio/synth-dtmf` (digit string), `@audio/synth-wavetable` (tables), per-band forms of multiband/dyneq/multisat, and the `@audio/measure`, `@audio/sinusoidal`, `@audio/voice` tool/substrate families.

## The eval

`npm run eval` (test/eval.js) puts sounds through the library as installed and reads what comes back: it fails when
a release makes a sound worse. Each case (test/eval/cases.js) is a sound, what is done to it (an op, `auto()`, the
chain's plan, or a package's own call as its users make it) and what must hold after it:

- **no harm**: the take is not worse than its input on the measure by more than a margin: a part's level 3 dB, two
  channels' balance 1 dB, a tone's onset 6 dB, SI-SDR and the noise in a voice's pauses 0.5 dB, a voice's frames under
  or silenced 2.5 %, no denoiser planned on a take that holds no noise, a pitch shift's length not a frame other than its input's;
- **no step back**: the take is not worse than its bound in test/eval/bounds.json, read with the packages it names on
  the date it names, by more than the scatter read across machines.

The sounds: four VoiceBank+DEMAND voices and a VocalSet phrase (test/eval/voices, CC BY 4.0, their sources and cuts in
its LICENSE.md, 750 kB), every other one made from a seed: voices under noise that stands still and that moves at 0, 5
and 15 dB, noise alone, a radio channel (300 to 3400 Hz), a short word, tones, a chord and a sung phrase over digital
silence, clipped takes beside their originals, and through each of `pitch()`'s methods a take cut loud, two phrases
12 dB apart, a pure tone and two channels holding different sounds. Read by the measures in test/eval/measures.js:
SI-SDR, the noise in the pauses against the voice, the voice's frames lost against the clean voice, what is left of
noise alone, `compare()`'s voice against the input, a part's level, a tone's onset and its power at the frequency asked of the shift, the balance, the plan's denoisers, and a take's length against its input's (read on the take as the op gave it, where the others read it cut to the input's length).

A harm today's packages do is a known failure, held at its reading: the run passes while it stays there, fails the day
it gets worse, and says when it is gone. The bounds move only by a command: `npm run eval -- --tighten` makes a better
reading the bound (never a worse one; `--tighten=a.json,b.json` takes the readings of other machines, written by
`--readings=file`, the worst of them the bound and their spread its scatter); `--accept=case/measure --why=text` takes
a step back, with its reason.

Before a family package is published, the eval runs with it in place of the installed copy, its dependencies from its
own folder where it holds them, else from audio's install (a range the install does not meet is named, and the run
stops):

```sh
node test/eval.js @audio/denoise-declip=../denoise/packages/denoise-declip
node test/eval.js @audio/shift-lpc=../shift/packages/shift-lpc @audio/shift-delay=../shift/packages/shift-delay
node test/eval.js --audio=/tmp/fresh/node_modules/audio     # another install's audio, whole
```

DeepFilterNet3 (8 MB) downloads on the first run into ~/.cache/audiojs/neural; `--offline` skips the cases that need it
where it is not cached, saying each; `--strict` (CI) fails a run that skipped any.

What it cannot see, measured on its own takes: a gain on everything (SI-SDR is scale-free; it also reads a tone filter
as error, a 300 Hz high-pass on a clean voice as -8.5 dB); noise left within 0.3 s of a phrase (the bed is read
past that); noise under the voice itself (at 0 dB it moves the voice lost by 2.8 %); a voice turned down alike
everywhere, or changed outside 300 to 3400 Hz (`compare()`'s voice band: a low-pass at 3 kHz reads none of it); the
shape of noise left at the same power; what happens inside a part at its power; a click after a tone's first 4096
frames; channels mixed into each other at their levels; a stage other than a denoiser that a plan puts on a tone (a
1 kHz tone over silence is planned a dehum); and every sound it holds no case of: music beyond a chord and a sung
phrase, rooms, codecs, rates other than 8, 16, 44.1 and 48 kHz.
