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

By default, `a.myOp(arg, {at, duration, channel})` maps to `{ type: 'myOp', args: [arg], at, duration, channel }`.

Any plain object as the last argument is treated as options. Known keys (`at`, `duration`, `channel`) are extracted to the edit; sample-based aliases `offset`/`length` convert to `at`/`duration`. **All other keys** flow through as extras on the edit and arrive in `ctx`:

```js
a.fade(1, { curve: 'exp' })
// → edit: { type: 'fade', args: [1], curve: 'exp' }
// → ctx.curve === 'exp'
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

Rewrite the segment map without touching PCM. For ops that change timeline geometry.

`ctx` has `total`, `sampleRate`, `args`, `offset`, `length`. The `offset`/`length` are `at`/`duration` pre-converted to samples (`null` if unset).

```js
import { seg } from 'audio/plan.js'

audio.op('myRepeat', { plan(segs, ctx) {
  // segs: current segment map (copy instructions for the whole timeline)
  // ctx.total: current output length in samples
  let r = [...segs]  // keep original segments as-is
  // append a shifted copy — each segment replayed after the current end
  for (let s of segs) { let n = s.slice(); n[2] = s[2] + ctx.total; r.push(n) }
  return r  // new segment map: original + one full repeat
} })
```

**Segments** — a flat list of copy instructions: `[src, count, dst, rate?, ref?]`.

Each segment says: "copy `count` samples from `src` in source to `dst` in output."

| Index | Field | Description |
|-------|-------|-------------|
| `0` | src | Read offset in source (samples) |
| `1` | count | How many samples to copy |
| `2` | dst | Write offset in output (samples) |
| `3` | rate | Playback rate: omit or `1` = forward, `-1` = reverse. Future: `2` = double speed |
| `4` | ref | Which source: `undefined` = self, `null` = zero-fill, audio instance = external |

`seg(src, count, dst, rate?, ref?)` creates a segment array.

Example — 10s audio at 44100Hz starts as one segment:

```
[[0, 441000, 0]]
```

After `crop({at: 2, duration: 3})` — read 3s from the 2s mark, write at start:

```
[[88200, 132300, 0]]
```

After `insert(silence, {at: 1})` — split at 1s, insert 1s silence, shift the rest:

```
[[0, 44100, 0],
 [0, 44100, 44100, , null],
 [44100, 396900, 88200]]
```

After `reverse()` — same positions, read backwards:

```
[[0, 441000, 0, -1]]
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
    return { type: 'crop', args: [], at: start / sampleRate, duration: (end - start) / sampleRate }
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
