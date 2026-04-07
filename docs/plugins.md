# Plugins

A plugin registers ops, stats, or methods on `audio`.

```js
// my-plugin.js
import audio from 'audio/core.js'

const myOp = (chs, ctx) => {
  for (let ch of chs)
    for (let i = 0; i < ch.length; i++) ch[i] = -ch[i]
  return chs
}

audio.op('myOp', myOp)
```

```js
import 'my-plugin.js'   // registers op + wires a.myOp()
```

## Ops

A reducer: `(chs, ctx) => chs | false`.

`chs` is `Float32Array[]` per channel, page-length (65536 samples, last page may be shorter). `ctx` persists across chunks — set any property for stateful computation. Fixed fields update per chunk: `args`, `at`, `duration`, `sampleRate`, `blockOffset`, `totalDuration`, plus any extras from the edit object.

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

For sugar beyond what the default method handles, wrap `audio.fn.myOp` after registration:

```js
audio.op('myOp', myOp)

let _myOp = audio.fn.myOp
audio.fn.myOp = function(arg) {
  // desugar, then delegate to the registered default
  if (typeof arg === 'string') return _myOp.call(this, PRESETS[arg])
  return _myOp.call(this, arg)
}
```

Wrappers desugar user-facing API into canonical calls. The default method handles edit creation.

### Querying ops

```js
audio.op('gain')  // → descriptor { process, ... } or undefined
```

## Hooks

Every op has a processor. Plan is the second positional arg. Other hooks go in opts:

```js
audio.op('myOp', process, plan, {
  resolve: (args, ctx) => edit,      // pre-render: replace with simpler edit(s)
  overlap: 128,                      // extra samples across chunk boundaries
})
```

Ops without a plan hook pass opts directly:

```js
audio.op('myFilter', process, { overlap: 128 })
```

### plan

Rewrite the segment map without touching PCM. For ops that change timeline geometry.

`ctx` has `total`, `sampleRate`, `args`, `offset`, `span`. The `offset`/`span` are `at`/`duration` pre-converted to samples (`null` if unset).

```js
import { seg } from 'audio/history.js'

audio.op('myRepeat', process, (segs, ctx) => {
  // segs: current segment map (copy instructions for the whole timeline)
  // ctx.total: current output length in samples
  let r = [...segs]  // keep original segments as-is
  // append a shifted copy — each segment replayed after the current end
  for (let s of segs) { let n = s.slice(); n[2] = s[2] + ctx.total; r.push(n) }
  return r  // new segment map: original + one full repeat
})
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
audio.op('trim', process, {
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

### overlap / persistent ctx

For ops that need context across streaming chunk boundaries.

```js
const filter = (chs, ctx) => {
  if (!ctx.z) ctx.z = chs.map(() => 0)  // init once, persists across chunks
  // ...use ctx.z for filter memory
}

audio.op('filter', filter, { overlap: 128 })
```

`ctx` is the same object across all chunks — any property you set persists. Fixed fields (`at`, `blockOffset`) update each chunk; everything else stays.

## Stats

A per-block reducer:

```js
audio.stat.mystat = (chs, ctx) => chs.map(ch => /* number */)
```

Called per 1024-sample block during decode. Return number (all channels) or array (per-channel). Stored in `a.stats.mystat` as `Float32Array[]`.

`ctx` has `sampleRate` and persists across blocks within one decode session — set any property for stateful computation.
