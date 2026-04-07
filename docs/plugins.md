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

A reducer: `(channels, ctx) => channels | false`.

`channels` is `Float32Array[]` per channel, page-length (65536 samples, last page may be shorter). `ctx` has `args`, `at`, `duration`, `sampleRate`, `blockOffset`, `length`, `state`, and any extras from the edit object.

`at`/`duration` arrive chunk-relative. Convert to samples:

```js
let sr = ctx.sampleRate
let start = ctx.at != null ? Math.round(ctx.at * sr) : 0
let end = ctx.duration != null ? start + Math.round(ctx.duration * sr) : chs[0].length
```

Return `false` to skip (no change).

### Named options

By default, `a.myOp(arg, {at, duration, channel})` maps to `{ type: 'myOp', args: [arg], at, duration, channel }`.

For sugar, override the generated method and emit canonical edit(s) yourself:

```js
audio.op('myOp', myOp)

audio.fn.myOp = function(arg) {
  if (typeof arg === 'object' && arg && !Array.isArray(arg)) {
    let edit = { type: 'myOp', args: [] }
    let { at, duration, channel, ...extra } = arg
    Object.assign(edit, { at, duration, channel }, extra)
    return this.run(edit)
  }

  return this.run({ type: 'myOp', args: [arg] })
}
```

Extras on the edit flow to `ctx` — read `ctx.curve`, `ctx.ceiling`, etc.

## Hooks

Every op is a processor. Hooks are optional — pass any combination in opts:

```js
audio.op('myOp', process, {
  plan:    (segs, ctx) => newSegs,   // structural: rewrite segment map
  outLen:  (len, ctx) => newLen,     // fast virtual length prediction
  lower:   (args, ctx) => edit,      // pre-render: replace with simpler edit(s)
  overlap: 128,                      // extra samples across chunk boundaries
})
```

### plan

Rewrite the segment map without touching PCM. For ops that change timeline geometry.

`ctx` has `total`, `sampleRate`, `args`, `at`, `duration`, `offset`, `span`. The `offset`/`span` are `at`/`duration` pre-converted to samples (`null` if unset).

```js
audio.op('myRepeat', process, {
  plan: (segs, ctx) => {
    let r = [...segs]
    for (let s of segs) r.push({ ...s, out: s.out + ctx.total })
    return r
  }
})
```

**Segments** — a flat list of copy instructions: `{ src, out, len, ref?, rev? }`.

Each segment says: "read `len` samples starting at `src` from source, write at `out` in output."

| Field | Description |
|-------|-------------|
| `src` | Read offset in source (samples) |
| `out` | Write offset in output (samples) |
| `len` | How many samples |
| `ref` | Which source: `undefined` = self, `SILENCE` = zero-fill, audio instance = external |
| `rev` | Read backwards. Propagate when splitting segments |

Example — 10s audio at 44100Hz starts as one segment:

```
[{ src: 0, out: 0, len: 441000 }]
```

After `crop({at: 2, duration: 3})` — read 3s from the 2s mark, write at start:

```
[{ src: 88200, out: 0, len: 132300 }]
```

After `insert(silence, {at: 1})` — split at 1s, insert 1s silence, shift the rest:

```
[{ src: 0, out: 0, len: 44100 },
 { src: 0, out: 44100, len: 44100, ref: SILENCE },
 { src: 44100, out: 88200, len: 396900 }]
```

After `reverse()` — same positions, read backwards:

```
[{ src: 0, out: 0, len: 441000, rev: true }]
```

### outLen

Predict output length without building the full plan. Powers `.length`/`.duration` getters.

`len` is current length in samples. `ctx` has `sampleRate`, `args`, `offset`, `span`. Return new length in samples.

```js
audio.op('crop', process, {
  outLen: (len, ctx) => {
    let { offset, span } = ctx
    let s = offset != null ? (offset < 0 ? len + offset : offset) : 0
    return span ?? len - s
  }
})
```

### lower

Pre-render replacement using decoded stats.

```js
audio.op('trim', process, {
  lower: (args, ctx) => {
    let { stats, sampleRate, length } = ctx
    if (!stats?.min) return null  // no stats — fall back to per-page
    // ...analyze stats to find silence boundaries...
    return { type: 'crop', args: [], at: start / sampleRate, duration: (end - start) / sampleRate }
  }
})
```

`ctx` has `stats`, `sampleRate`, `channels`, `channel`, `at`, `duration`, `length`, plus edit extras. Return:
- **edit(s)** — replace this op with simpler op(s)
- **`false`** — skip (no change needed)
- **`null`** — fall back to per-page processing

Method sugar runs at call time before edits are recorded. `lower` runs at render time with decoded audio stats. Sugar canonicalizes input; `lower` replaces abstract ops with concrete ones.

### overlap / ctx.state

For ops that need context across streaming chunk boundaries.

```js
const filter = (chs, ctx) => {
  if (!ctx.state.z) ctx.state.z = chs.map(() => 0)  // init once, persists across chunks
  // ...use ctx.state.z for filter memory
}
filter.overlap = 128  // extra samples per chunk boundary
```

## Stats

A factory returning a per-block reducer:

```js
audio.stat.mystat = () => (channels, ctx) => channels.map(ch => /* number */)
```

Called per 1024-sample block during decode. Return number (all channels) or array (per-channel). Stored in `a.stats.mystat` as `Float32Array[]`.
