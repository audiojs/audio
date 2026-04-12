# Architecture

See also: [Plugins](plugins.md)

## Files

| File | Role |
|------|------|
| `core.js` | Engine — decode, paginate, plugin registry, instance factory, page I/O. The only required file. |
| `stats.js` | Block-level stat engine — min/max/energy/clip/dc per `BLOCK_SIZE`-sample block during decode. Powers waveform, loudness, stat queries without touching PCM. |
| `cache.js` | Page cache — LRU eviction to OPFS, on-demand restore. Large files stay playable without exhausting RAM. |
| `plan.js` | Edit pipeline — non-destructive edit list, plan builder, stream renderer. `a.gain(-3).trim()` becomes a declarative plan materialized on read. |
| `audio.js` | Full bundle — core + stats + cache + plan + all plugins. The default import. |
| `fn/*.js` | Plugins — each file is one op, stat, or method. Self-contained, independently importable. |
| `bin/cli.js` | CLI — arg parsing, plugin auto-discovery, batch/glob/macro/playback. |

## Three import paths

```js
import audio from 'audio'            // full bundle — all ops, stats, cache
import audio from 'audio/core.js'    // bare engine — no ops, no cache
import gain from 'audio/fn/gain.js'  // individual plugin
```

## Stream-first

No operation touches full PCM at once. Audio is stored in pages. Decode streams pages progressively. Every output — `stream()`, `play()`, `save()`, `stat()` — walks pages one chunk at a time through the edit pipeline. `read()` materializes into memory but still processes through the same chunk pipeline internally.

A 2-hour file never needs 2 hours of float arrays in memory unless you `read()` the whole thing.

## Non-destructive editing

Ops don't mutate source pages. `a.gain(-3).crop({at: 1, duration: 5})` pushes two entries to `a.edits`. Source data stays immutable. The edit list replays on demand — undo, serialize, or reapply.

## Plan

`compilePlan(a, len, final)` compiles `a.edits` into a plan object:

- **Segment map** — copy instructions: which source ranges map to which output positions. Structural ops (crop, remove, insert, repeat, pad, reverse, speed) rewrite segments. Each segment is `[from, count, to, rate?, ref?]` — "read `count` samples from `from`, write at `to`."
- **Sample pipeline** — per-block transforms applied in order (gain, fade, filter, pan). Each op receives separate `input` and `output` buffers (`Float32Array[]` per channel, `BLOCK_SIZE` samples). The engine pre-allocates two buffer sets and rotates them per op — previous output becomes next input, zero allocation in the hot path. Ops read from input, write to output (never alias). Stateful ops carry state across blocks via `ctx`.
- **Limit** — the safe output boundary. During incremental streaming (`final=false`), `adjustLimit` tracks how far output is deterministic given partial source data.

`buildPlan(a)` is the cached wrapper for fully-decoded audio — calls `compilePlan(a, len, true)` once per version.

During streaming, `compilePlan` is called repeatedly as more data arrives (`final=false`). Each call recomputes the segment map and limit from scratch — stateless, pure, cheap. The limit tells the stream loop how far it can safely render without waiting for more source data.

```
a.edits ──→ compilePlan(a, len, final) ──→ { segs, pipeline, totalLen, sr, limit }
                                                    ↓
source pages ──→ segment map ──→ sample pipeline ──→ output blocks
(Float32)        (structural)    (per-block ops)    (stream or flat)
```

### Incremental streaming

Structural ops (crop, repeat, pad, reverse, etc.) stream incrementally — output begins before decode completes. `adjustLimit(limit, type, ctx)` is a pure function that transforms the safe output boundary per op type during compilation:

- **crop**: limit clamps to cropped range
- **insert**: limit extends by inserted length (when insertion point is reachable)
- **remove**: limit shrinks by removed portion
- **pad**: limit extends by pad amount
- **reverse**: limit collapses to 0 for open-end reverse (needs total), passes through for ranged
- **speed**: limit scales by rate
- **negative `at`**: limit drops to 0 (position depends on total)

The stream loop waits when `outPos >= plan.limit`, resumes when new source data arrives and recompilation extends the limit.

### Progressive resolve

Ops with `resolve` (trim, normalize) can work with partial stats during incremental streaming. `stats.snapshot()` returns whatever block stats are available so far (marked `partial: true`). The resolved result refines as more data decodes — e.g. trim can determine head silence early, normalize can apply gain from available peaks.

## Pages and blocks

Audio is fragmented at two levels — **pages** for storage, **blocks** for processing:

| | `PAGE_SIZE` (1024 × BLOCK_SIZE) | `BLOCK_SIZE` (1024) |
|-|---|---|
| **What** | Samples per storage chunk | Samples per processing unit |
| **Stores** | Float32Array[] per channel | min, max, energy, clip, dc per block |
| **Purpose** | Memory management, cache eviction, decode streaming | Op processing, stat computation, waveform resolution |
| **Memory** | PCM data — evictable to OPFS | Stats — always resident (~7 MB for 2h stereo) |

The edit pipeline materializes one block at a time: read source → apply structural ops (segment map) → run sample transforms (rotating pre-allocated input/output buffers) → yield output block. Peak memory is two blocks per channel regardless of file length or op chain depth.

Cache eviction works at page granularity: cold pages offload to OPFS, hot pages near the playhead stay resident.

Ops and stats both process in `BLOCK_SIZE` chunks — same unit, same granularity. Stateful ops like filters carry state sample-to-sample within and across blocks.

Both are configurable — set before creating any instances:

```js
audio.BLOCK_SIZE = 256
audio.PAGE_SIZE = 2048 * audio.BLOCK_SIZE
```

Each instance's stats record `stats.blockSize` — the block size used at decode time.

### Waveform zoom and block resolution

`BLOCK_SIZE` sets the finest pre-computed stat resolution. Three zoom regimes:

- **Zoomed out** (many samples per pixel): `stat('max', { bins })` aggregates multiple blocks into fewer bins. Pre-computed stats suffice — no PCM access.
- **1:1** (one block per pixel): stats render directly.
- **Zoomed in** (fewer samples than one block per pixel): read PCM from pages for sample-accurate waveform. Page cache makes this fast for the visible region.

Changing `BLOCK_SIZE` cannot retroactively refine existing stats. For finer resolution in a zoomed region, read the PCM.
