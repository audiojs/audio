# Plugins

See also: [Architecture](architecture.md)

A plugin registers ops, stats, or methods on `audio`.

```js
// my-plugin.js
import audio from 'audio'

const myOp = (chs, ctx) => {
  for (let ch of chs)
    for (let i = 0; i < ch.length; i++) ch[i] = -ch[i]
  return chs
}

audio.op('myOp', myOp)                       // shorthand for { process: myOp }
// or explicitly:
audio.op('myOp', { process: myOp })
```

```js
import 'my-plugin.js'   // registers op + wires a.myOp()
```

## Ops

A reducer: `(chs, ctx) => chs | false`.

`chs` is `Float32Array[]` per channel, `BLOCK_SIZE` samples (1024 default, last block may be shorter). `ctx` persists across chunks — set any property for stateful computation. Fixed fields update per chunk: `args`, `at`, `duration`, `sampleRate`, `blockOffset`, `totalDuration`, plus any extras from the edit object.

- `at`/`duration` — op time range (seconds), chunk-relative
- `totalDuration` — full audio duration (seconds)
- `blockOffset` — absolute position of this chunk (seconds)
- `channel` — which channel(s) the op is scoped to

Convert to samples:

```js
let sr = ctx.sampleRate
let start = ctx.at != null ? Math.round(ctx.at * sr) : 0
let end = ctx.duration != null ? start + Math.round(ctx.duration * sr) : chs[0].length
```

Return `false` to skip (no change).

### Options

By default, `a.myOp(arg, {at, duration, channel})` maps to `['myOp', arg, {at, duration, channel}]`.

Any plain object as the last argument is treated as options. Known keys (`at`, `duration`, `channel`) are extracted; sample-based aliases `offset`/`length` convert to `at`/`duration`. **All other keys** flow through as extras and arrive in `ctx`:

```js
a.fade(1, { curve: 'exp' })
// → edit: ['fade', 1, { curve: 'exp' }]
// → ctx.curve === 'exp'
```

### Edit format

Edits are arrays — same convention as method calls (`[type, ...args, opts?]`), trailing plain object = options:

```js
a.run(
  ['gain', -3, { at: 10, duration: 5 }],
  ['crop', { at: 1, duration: 2 }],
  ['fade', 1, { curve: 'exp' }],
  ['insert', ref, { at: 2 }],
  ['gain', -3],                            // no opts needed
)
```

Useful for serialization — edits roundtrip as JSON arrays:

```js
let saved = JSON.stringify([['gain', -3], ['crop', { at: 1, duration: 2 }]])
a.run(...JSON.parse(saved))
```

### Custom wrappers

For sugar beyond what the default method handles, pass a `call` function in the descriptor. It receives the default method as its first argument, followed by the user's arguments:

```js
audio.op('normalize', {
  resolve: (args, ctx) => { /* ... */ },
  call(op, arg) {
    // string preset: normalize('streaming') → op('streaming')
    if (typeof arg === 'string' || typeof arg === 'number') return op.call(this, arg)
    // options object: normalize({target: -3, mode: 'rms'}) → op(-3, {mode: 'rms'})
    if (arg != null && typeof arg === 'object') {
      let { target, mode, at, duration, channel, ...extra } = arg
      return op.call(this, target, { mode, at, duration, channel, ...extra })
    }
    return op.call(this)
  }
})
```

`op` is the standard method that `audio.op` generates — it parses `{at, duration, channel}` from the last arg and calls `this.run(edit)`. The `call` function defines the exact call signature and desugars user-facing argument patterns before delegating to it.

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
  process: (chs, ctx) => chs,          // per-block PCM transform
  plan: (segs, ctx) => segs,           // structural segment rewrite
  resolve: (args, ctx) => edit,        // pre-render: replace with simpler edit(s) using stats
  call(op, ...args) { ... },           // define call signature, desugar before delegating to op
})
```

### plan

Rewrite the segment map without touching PCM. For ops that change timeline geometry (crop, insert, remove, repeat, pad, reverse, speed).

`buildPlan()` compiles `a.edits` into a segment map + sample pipeline, cached per version. Edits are the source of truth; segments are the compiled form — like bytecode from source, or DOM patches from VDOM. Segments are never maintained manually — they rebuild on any edit change.

`ctx` has `total`, `sampleRate`, `args`, `offset`, `length`. The `offset`/`length` are `at`/`duration` pre-converted to samples (`null` if unset).

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

Pre-render replacement using decoded stats.

```js
audio.op('trim', {
  process: trim,
  resolve: (args, ctx) => {
    let { stats, sampleRate, totalDuration } = ctx
    if (!stats?.min) return null  // no stats — fall back to per-page
    // ...analyze stats to find silence boundaries...
    return ['crop', { at: start / sampleRate, duration: (end - start) / sampleRate }]
  }
})
```

`ctx` has `stats`, `sampleRate`, `channelCount`, `channel`, `at`, `duration`, `totalDuration`, plus edit extras. Return:
- **edit(s)** — replace this op with simpler op(s)
- **`false`** — skip (no change needed)
- **`null`** — fall back to per-page processing

Wrappers run at call time before edits are recorded. `resolve` runs at render time with decoded audio stats. Wrappers canonicalize input; `resolve` replaces abstract ops with concrete ones.

### Persistent ctx

`ctx` is the same object across all chunks — any property you set persists. Fixed fields (`at`, `blockOffset`) update each chunk; everything else stays. This handles algorithmic state like IIR filter memory:

```js
const filter = (chs, ctx) => {
  if (!ctx.z) ctx.z = chs.map(() => 0)  // init once, persists across chunks
  // ...use ctx.z for filter memory
}

audio.op('filter', { process: filter })
```

When seeking mid-stream, the engine silently renders 8 prior blocks to warm up stateful ops before producing output.

## Stats

Register a stat descriptor:

```js
audio.stat('mystat', {
  block: (chs, ctx) => chs.map(ch => /* number */),
  reduce: (src, from, to) => { let v = 0; for (let i = from; i < to; i++) v += src[i]; return v },
})
```

Or shorthand (block-only, no scalar/binned query):

```js
audio.stat('mystat', (chs, ctx) => chs.map(ch => /* number */))
```

`block` is called per 1024-sample block during decode. Return number (all channels) or array (per-channel). Stored in `a.stats.mystat` as `Float32Array[]`.

`reduce` is `(src, from, to) → number` — enables `a.stat('mystat')` scalar and `a.stat('mystat', {bins})` binned queries.

`query` adds a derived aggregation: `query(stats, chs, from, to, sr) → value`. Used for stats that derive from other block data (e.g. `db` derives from `min`/`max`).

`ctx` has `sampleRate` and persists across blocks within one decode session — set any property for stateful computation.
