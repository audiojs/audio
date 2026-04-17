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
  resolve: (ctx) => edit,                 // pre-render: replace with simpler edit(s) using stats
})
```

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
a.eq({freq: 1000, q: 2})      // multiple named params
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

A segment is a copy instruction: `[from, count, to, rate?, ref?]`.

Read `count` samples from source at `from`, write to output at `to`. All offsets are absolute — segments are independent, not linked. You can process them in any order, binary search by output position, or skip segments for partial renders.

| Index | Field | Description |
|-------|-------|-------------|
| `0` | from | Read offset in source (samples) |
| `1` | count | Number of samples to copy |
| `2` | to | Write offset in output (samples) |
| `3` | rate | Source read rate. Omit or `1` = forward. `-1` = reverse (used by `reverse()`). `2` = read 2× faster, halving duration (used by `speed()`). `0.5` = half speed, doubling duration. The `speed` op multiplies existing rates and adjusts `count` — `speed(2)` on a 10s segment produces `count/2` at `rate*2`. The renderer uses linear interpolation to resample at non-unit rates. |
| `4` | ref | Source: `undefined` = self, `null` = zero-fill (silence), audio instance = external |

`seg(from, count, to, rate?, ref?)` creates a segment.

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

### resolve

Pre-render replacement using decoded stats. During incremental streaming, `ctx.stats` may come from `stats.snapshot()` with `partial: true` — resolve can return partial results that refine as more data decodes (e.g. trim detects head silence early, normalize applies gain from available peaks).

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

### pointwise

Mark an op as a pure per-sample transform — output depends only on input value, not position or history.

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

The engine auto-derives min/max/clipping stats by probing `process` with edge values — no full stream recompute needed after edits. `a.stat('db')` resolves instantly.

Don't use for stateful ops (filters) or position-dependent ops (fades, automation).

For advanced cases where rms/dc/energy need algebraic precision, use `deriveStats: (stats, opts) => {}` instead — see `gain` and `dc` ops for examples.

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

`reduce` is `(blockValues, from, to) → number` — it combines the values returned by `block`, enabling `a.stat('mystat')` scalar and `a.stat('mystat', {bins})` binned queries.

`query` adds a derived aggregation: `query(stats, chs, from, to, sr) → value`. Used for stats that derive from other block data (e.g. `db` derives from `min`/`max`, `peak` from `min`/`max`, `rms` from `ms`).

`ctx` has `sampleRate` and persists across blocks within one decode session — set any property for stateful computation.

Registered stats auto-participate in the playback meter — `a.meter('mystat', cb)` streams per-block values during playback. Block-defined stats emit the raw block value; `query`-defined stats are evaluated against a single-block pseudo-stats window.
